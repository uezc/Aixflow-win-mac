#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将定价基准数据同步到 Tablestore 表 nx_model_config。

SKU 命名建议（与客户端 FC billingModelId 一致）：
  视频等多档位模型推荐使用「模型名-分辨率/选项-时长」形式的主键，例如：
  hailuo-02-t2v-standard-1080p-10s、wan-2.6-720p-5s、kling-v2.6-pro-snd-10s。
  运营可在 Streamlit 后台「克隆模型行」由已有行快速复制新 SKU，再改 ID 与价格。

依赖：pip install tablestore

AccessKey 不在文件中保存；非 --dry-run 时将在终端提示输入（ID 与 Secret 均为可见输入，便于确认是否键入）。

清空并重灌（慎用）：
  python sync_to_tablestore.py --delete-all --yes
  python sync_to_tablestore.py --replace-all --yes
  # 或指定 JSON：
  python sync_to_tablestore.py --replace-all --yes --json path/to/models.json

一键替换会先删除表中 **全部** model_id 行，再写入 --json 或内置 DEFAULT_MODEL_ROWS。

请确认控制台已创建表 nx_model_config：
  - 主键：model_id (STRING)
  - 属性列：function_name, is_active, base_price, multiplier, yuanbao_rate
    （类型需与脚本写入一致：STRING / BOOLEAN / DOUBLE；
     数值列在代码中强制为 Python float，OTS SDK 会按 DOUBLE 编码。）
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Tablestore 连接信息
# ---------------------------------------------------------------------------
OTS_ENDPOINT = "https://nexflow-db.cn-hongkong.ots.aliyuncs.com"
OTS_INSTANCE_NAME = "nexflow-db"
TABLE_NAME = "nx_model_config"

# ---------------------------------------------------------------------------
# 与 pricing/cost_table.mjs 一致的基准价（CNY/次或 CNY/张）
# 视频类：与 price_calculator.mjs 中 getVideoPrice 的默认形参一致
#   （如 duration=10、sound=false、durationHailuo02=6、resolutionWan26=1080p、
#   durationWan26Flash=5、enableAudio=true 等）
# 图片类：与 getImagePrice 默认/未指定分辨率时的档位一致
# 未出现在此表的 model_id：回退到 resolve_prices(current_logic) 的粗粒度价
# ---------------------------------------------------------------------------
BASE_PRICE_CNY_BY_MODEL_ID: dict[str, float] = {
    # --- 图片 IMAGE_MODEL_CNY ---
    "banana-2.0": 0.05,
    "nano-banana": 0.2,
    "nano-banana-2": 0.2,
    "nano-banana-2-2k": 0.2,
    "nano-banana-2-4k": 0.3,
    "rhart-image-g-1.5": 0.03,
    "youchuan-text-to-image-v7": 0.54,
    "seedream-v4.5": 0.2,
    "seedream-v5": 0.2,
    # --- 视频 flat ---
    "sora-2": 1.5,
    "sora-2-pro": 2.0,
    "ltx-2.3-lipsync": 1.5,
    "ltx-2.3-i2v": 1.5,
    "ltx-2.3-t2v": 1.5,
    # --- 海螺 6s ---
    "hailuo-02-t2v-standard": 1.5,
    "hailuo-02-i2v-standard": 1.5,
    "hailuo-2.3-t2v-standard": 1.5,
    "hailuo-2.3-i2v-standard": 1.5,
    # --- 可灵 2.6 Pro：10s + 无声 ---
    "kling-v2.6-pro": 3.5,
    # --- 可灵 O1：std + 5s ---
    "kling-video-o1": 2.1,
    "kling-video-o1-i2v": 2.1,
    "kling-video-o1-ref": 3.15,
    # 首尾帧无 cost 表价：与 o1 std 5s 同档作运营参考基准
    "kling-video-o1-start-end": 2.1,
    # --- 全能 G 6s ---
    "rhart-video-g": 0.2,
    # --- Veo fast / pro：1080p ---
    "rhart-v3.1-fast": 0.25,
    "rhart-v3.1-fast-se": 0.25,
    "rhart-v3.1-pro": 1.0,
    "rhart-v3.1-pro-se": 1.0,
    # --- 万相 2.6：1080p + duration 默认 10 ---
    "wan-2.6": 7.5,
    # --- 万相 2.6 flash：1080p + 5s + 带音频 ---
    "wan-2.6-flash": 0.38 * 5,
    # --- Veo 官方图生：4s + 无声 ---
    "rhart-v3.1-pro-official-i2v": 4.7,
    # --- 音频 ---
    "fun-asr": 0.5,
    "rhart-song": 0.5,
    # --- 反推 ---
    "gpt-4o": 0.002422,
    "joy-caption-two": 0.036,
    # --- LLM 对话无 CNY 细表：占位 ---
    "gpt-3.5-turbo": 0.1,
    "openai/gpt-5.6-terra": 0.02,
    # --- 未在 AUDIO_MODEL_CNY：占位 ---
    "speech-2.8-hd": 0.01,
    "index-tts2": 0.01,
    # --- RunningHub 应用 ID：无 pricing 细表：占位 ---
    "2021955919764000770": 0.01,
    "2022127885233950721": 0.01,
    "2082378062234214401": 0.05,
    "2082392424818757633": 0.15,
    "2082437486235709441": 0.15,
    "2082682378039943169": 0.15,
    "2033537159944212482": 0.01,
}


# ---------------------------------------------------------------------------
# 默认种子数据（与审计「定价基准表 JSON」一致；可用 --json 覆盖）
# ---------------------------------------------------------------------------
DEFAULT_MODEL_ROWS: list[dict[str, str]] = [
    {
        "model_id": "banana-2.0",
        "function_name": "图片模块-文生图/图生图（banana 2.0）",
        "current_logic": "pricing/cost_table.mjs IMAGE_MODEL_CNY['banana-2.0']（default/2k/4k）；FC 按 type=image 扣元宝",
    },
    {
        "model_id": "nano-banana",
        "function_name": "图片模块-Nano banana（分辨率 1k/2k/4k）",
        "current_logic": "IMAGE_MODEL_CNY['nano-banana']；FC type=image",
    },
    {
        "model_id": "nano-banana-2",
        "function_name": "图片模块-历史兼容 ID（已映射为 nano-banana + 1k）",
        "current_logic": "IMAGE 类兼容迁移；定价同 nano-banana default",
    },
    {
        "model_id": "nano-banana-2-2k",
        "function_name": "图片模块-历史兼容 ID（已映射为 nano-banana + 2k）",
        "current_logic": "IMAGE 类兼容迁移；定价同 nano-banana 2k",
    },
    {
        "model_id": "nano-banana-2-4k",
        "function_name": "图片模块-历史兼容 ID（已映射为 nano-banana + 4k）",
        "current_logic": "IMAGE 类兼容迁移；定价同 nano-banana 4k",
    },
    {
        "model_id": "rhart-image-g-1.5",
        "function_name": "图片模块-Grok 1.5",
        "current_logic": "IMAGE_MODEL_CNY['rhart-image-g-1.5']；FC type=image",
    },
    {
        "model_id": "youchuan-text-to-image-v7",
        "function_name": "图片模块-Midjourney v7（文悠船）",
        "current_logic": "IMAGE_MODEL_CNY['youchuan-text-to-image-v7']；FC type=image",
    },
    {
        "model_id": "seedream-v4.5",
        "function_name": "图片模块-Seedream 4.5",
        "current_logic": "IMAGE_MODEL_CNY['seedream-v4.5']；FC type=image",
    },
    {
        "model_id": "seedream-v5",
        "function_name": "图片模块-Seedream v5",
        "current_logic": "IMAGE_MODEL_CNY['seedream-v5']；FC type=image",
    },
    {
        "model_id": "sora-2",
        "function_name": "视频模块-Sora2",
        "current_logic": "VIDEO_FLAT_CNY['sora-2']；FC type=video",
    },
    {
        "model_id": "sora-2-pro",
        "function_name": "视频模块-Sora2 Pro",
        "current_logic": "VIDEO_FLAT_CNY['sora-2-pro']；FC type=video",
    },
    {
        "model_id": "kling-v2.6-pro",
        "function_name": "视频模块-可灵 2.6 Pro",
        "current_logic": "VIDEO_KLING_26_PRO_CNY × 时长×有声；FC type=video",
    },
    {
        "model_id": "kling-video-o1",
        "function_name": "视频模块-可灵 O1（文生）",
        "current_logic": "VIDEO_KLING_O1_CNY × mode×秒；FC type=video",
    },
    {
        "model_id": "kling-video-o1-i2v",
        "function_name": "视频模块-可灵 O1（图生）",
        "current_logic": "同 kling-video-o1 表；FC type=video",
    },
    {
        "model_id": "kling-video-o1-ref",
        "function_name": "视频模块-可灵 O1（参考图）",
        "current_logic": "VIDEO_KLING_O1_REF_CNY；FC type=video",
    },
    {
        "model_id": "kling-video-o1-start-end",
        "function_name": "视频模块-可灵 O1（首尾帧）",
        "current_logic": "VIDEO_MODELS_WITHOUT_LIST_PRICE 列出；getVideoPrice 会 ModelNotPricedError；FC 仍 type=video 粗扣",
    },
    {
        "model_id": "hailuo-02-t2v-standard",
        "function_name": "视频模块-海螺 02 文生",
        "current_logic": "VIDEO_HAILUO_SEC_CNY；FC type=video",
    },
    {
        "model_id": "hailuo-2.3-t2v-standard",
        "function_name": "视频模块-海螺 2.3 文生",
        "current_logic": "VIDEO_HAILUO_SEC_CNY；FC type=video",
    },
    {
        "model_id": "hailuo-02-i2v-standard",
        "function_name": "视频模块-海螺 02 图生",
        "current_logic": "VIDEO_HAILUO_SEC_CNY；FC type=video",
    },
    {
        "model_id": "hailuo-2.3-i2v-standard",
        "function_name": "视频模块-海螺 2.3 图生",
        "current_logic": "VIDEO_HAILUO_SEC_CNY；FC type=video",
    },
    {
        "model_id": "wan-2.6",
        "function_name": "视频模块-万相 2.6",
        "current_logic": "VIDEO_WAN_26_CNY；FC type=video",
    },
    {
        "model_id": "wan-2.6-flash",
        "function_name": "视频模块-万相 2.6 flash",
        "current_logic": "VIDEO_WAN_26_FLASH_PER_SEC_CNY × 秒；FC type=video",
    },
    {
        "model_id": "rhart-video-g",
        "function_name": "视频模块-Grok 1.5 视频",
        "current_logic": "VIDEO_RHART_VIDEO_G_CNY；FC type=video",
    },
    {
        "model_id": "rhart-v3.1-fast",
        "function_name": "视频模块-Veo 3.1 fast",
        "current_logic": "VIDEO_RHART_V31_FAST_CNY；FC type=video",
    },
    {
        "model_id": "rhart-v3.1-fast-se",
        "function_name": "视频模块-Veo3.1 fast（首尾帧）",
        "current_logic": "VIDEO_RHART_V31_FAST_CNY；FC type=video",
    },
    {
        "model_id": "rhart-v3.1-pro",
        "function_name": "视频模块-Veo3.1 Pro（文生）",
        "current_logic": "VIDEO_RHART_V31_PRO_CNY；FC type=video",
    },
    {
        "model_id": "rhart-v3.1-pro-se",
        "function_name": "视频模块-全能视频V3.1-pro-首尾帧生视频",
        "current_logic": "VIDEO_RHART_V31_PRO_CNY；FC type=video",
    },
    {
        "model_id": "rhart-v3.1-pro-official-i2v",
        "function_name": "视频模块-Veo 3.1 Pro 官方图生",
        "current_logic": "VIDEO_VEO_31_PRO_OFFICIAL_CNY；FC type=video",
    },
    {
        "model_id": "ltx-2.3-lipsync",
        "function_name": "视频模块-LTX2.3 对口型",
        "current_logic": "VIDEO_FLAT_CNY['ltx-2.3-lipsync']；底层 run/ai-app/2029400959335534594；FC type=video",
    },
    {
        "model_id": "ltx-2.3-i2v",
        "function_name": "视频模块-LTX2.3 图生视频",
        "current_logic": "VIDEO_FLAT_CNY['ltx-2.3-i2v']；run/ai-app/2034955204851933186；FC type=video",
    },
    {
        "model_id": "ltx-2.3-t2v",
        "function_name": "视频模块-LTX2.3 文生视频",
        "current_logic": "VIDEO_FLAT_CNY['ltx-2.3-t2v']；run/ai-app/2034994243982336001；FC type=video",
    },
    {
        "model_id": "speech-2.8-hd",
        "function_name": "音频模块-MiniMax 2.8 HD 语音合成",
        "current_logic": "未在 AUDIO_MODEL_CNY 登记；getAudioPrice 会失败；FC type=audio 粗扣",
    },
    {
        "model_id": "index-tts2",
        "function_name": "音频模块-Index-TTS 2.0 配音",
        "current_logic": "未在 AUDIO_MODEL_CNY；run/ai-app/2008113338793857025；FC type=audio",
    },
    {
        "model_id": "fun-asr",
        "function_name": "音频模块-云端录音文件转写（百炼 fun-asr）",
        "current_logic": "AUDIO_MODEL_CNY['fun-asr']=0.5；POST /asr/file-transcribe 按次扣；FC type=audio",
    },
    {
        "model_id": "rhart-song",
        "function_name": "音频模块-SUNO v5 写歌",
        "current_logic": "AUDIO_MODEL_CNY['rhart-song']；run/ai-app/2021841072451756033；FC type=audio",
    },
    {
        "model_id": "gpt-4o",
        "function_name": "LLM 模块-图像反推（GPT-4o）",
        "current_logic": "REVERSE_CAPTION_CNY['gpt-4o']；走 BLTCY/FC LLM 路径时 type=llm",
    },
    {
        "model_id": "joy-caption-two",
        "function_name": "LLM 模块-图像反推（Joy Caption Two）",
        "current_logic": "REVERSE_CAPTION_CNY['joy-caption-two']；ChatProvider 内 RunningHub ai-app/2021821541272526850（非 FC 转发分支）",
    },
    {
        "model_id": "gpt-3.5-turbo",
        "function_name": "LLM 模块-对话（默认模型）",
        "current_logic": "无 CNY 细表；callFCChat 默认 model；FC type=llm 粗扣（NX_CHAT_COST 或默认 1 元宝）",
    },
    {
        "model_id": "openai/gpt-5.6-terra",
        "function_name": "LLM 模块-大语言模型-5.6",
        "current_logic": "cost_table openai/gpt-5.6-terra；对话/图像反推共用；FC type=llm；API model id 不变",
    },
    {
        "model_id": "2021955919764000770",
        "function_name": "图片模块-抠图（RunningHub AI 应用 ID）",
        "current_logic": "IMAGE 处理；无 pricing 表项；matting.ts；先 OSS 再 POST run/ai-app",
    },
    {
        "model_id": "2022127885233950721",
        "function_name": "图片模块-去水印（RunningHub AI 应用 ID）",
        "current_logic": "IMAGE 处理；无 pricing 表项；watermarkRemoval.ts；先 OSS 再 POST run/ai-app",
    },
    {
        "model_id": "2082378062234214401",
        "function_name": "图片模块-图像超分放大V3（RunningHub AI 应用 ID）",
        "current_logic": "IMAGE 处理；pricing IMAGE_MODEL_CNY['2082378062234214401']=0.05；imageUpscaleV3；先 OSS 再 POST run/ai-app/2082378062234214401（plus）",
    },
    {
        "model_id": "2082392424818757633",
        "function_name": "视频模块-视频深度转换（RunningHub AI 应用 ID）",
        "current_logic": "VIDEO 处理；VIDEO_FLAT_CNY['2082392424818757633']=0.15；videoDepthConvert；先 OSS 再 POST run/ai-app/2082392424818757633（default）",
    },
    {
        "model_id": "2082437486235709441",
        "function_name": "视频模块-视频去字幕/水印（旧 RunningHub AI 应用 ID，已停用）",
        "current_logic": "已替换为 2082682378039943169；保留行仅兼容历史账单",
    },
    {
        "model_id": "2082682378039943169",
        "function_name": "视频模块-视频去字幕/水印（RunningHub AI 应用 ID）",
        "current_logic": "VIDEO 处理；VIDEO_FLAT_CNY['2082682378039943169']=0.15；videoSubtitleWatermarkRemoval；先 OSS 再 POST run/ai-app/2082682378039943169（node38=1080,node36=video,default）",
    },
    {
        "model_id": "2033537159944212482",
        "function_name": "视频分析-描述生成（RunningHub AI 应用 ID）",
        "current_logic": "VIDEO 分析；无 pricing 表项；VideoAnalysisProvider；本地视频先 OSS",
    },
]


def as_ots_double(v: float | int) -> float:
    """Tablestore Python SDK：仅 isinstance(x, float) 会按 DOUBLE 写入；避免用 int 误写成 INTEGER。"""
    return float(v)


def resolve_prices(current_logic: str) -> tuple[float, float, float]:
    """
    根据 current_logic 子串初始化 multiplier / yuanbao_rate；以及「未登记 model_id」时的 base_price 回退。
    已登记 model_id 的 base_price 由 BASE_PRICE_CNY_BY_MODEL_ID（对齐 pricing/cost_table.mjs）提供。
    - 含 'VIDEO'：回退 base_price=0.1, multiplier=1.0, yuanbao_rate=10.0（1 元=10 元宝）
    - 含 'IMAGE'：回退 base_price=0.05, multiplier=1.0, yuanbao_rate=10.0
    - 其他：回退 base_price=0.01, multiplier=1.0, yuanbao_rate=10.0
    （VIDEO 优先于 IMAGE，避免同一描述中同时命中时歧义）
    """
    logic = current_logic or ""
    if "VIDEO" in logic:
        return 0.1, 1.0, 10.0
    if "IMAGE" in logic:
        return 0.05, 1.0, 10.0
    return 0.01, 1.0, 10.0


def default_base_price_cny(model_id: str, current_logic: str) -> float:
    """同步写入 OTS 的默认 base_price：与 pricing/cost_table.mjs 对齐，未知 model_id 时回退 resolve_prices。"""
    key = str(model_id or "").strip()
    if key in BASE_PRICE_CNY_BY_MODEL_ID:
        return float(BASE_PRICE_CNY_BY_MODEL_ID[key])
    bp, _, _ = resolve_prices(current_logic)
    return float(bp)


def read_credentials_interactive() -> tuple[str, str]:
    """终端交互读取 AK；Secret 使用 input，输入可见以便确认。"""
    ak_id = input("请输入 AccessKey ID: ").strip()
    ak_secret = input("请输入 AccessKey Secret: ").strip()
    if not ak_id or not ak_secret:
        print("错误：AccessKey ID 与 Secret 均不能为空。", file=sys.stderr)
        sys.exit(2)
    return ak_id, ak_secret


def load_rows(path: Path | None) -> list[dict[str, Any]]:
    if path is None:
        return list(DEFAULT_MODEL_ROWS)
    text = path.read_text(encoding="utf-8")
    data = json.loads(text)
    if not isinstance(data, list):
        raise ValueError("JSON 根节点必须是数组")
    return data


def fetch_all_model_ids(client: Any, table_name: str) -> list[str]:
    """全表扫描，收集主键 model_id（与 Streamlit 后台 fetch 逻辑一致）。"""
    from tablestore import Direction, INF_MAX, INF_MIN, Row

    inclusive = [("model_id", INF_MIN)]
    exclusive = [("model_id", INF_MAX)]
    cursor = inclusive
    out: list[str] = []

    while True:
        consumed, next_pk, row_list, next_token = client.get_range(
            table_name,
            Direction.FORWARD,
            cursor,
            exclusive,
            columns_to_get=None,
            limit=500,
        )
        del consumed, next_token

        for row in row_list:
            if not isinstance(row, Row):
                continue
            for k, v in row.primary_key:
                if k == "model_id" and v is not None:
                    out.append(str(v))

        if not next_pk:
            break
        cursor = next_pk

    return out


def delete_all_rows(
    client: Any,
    table_name: str,
    *,
    dry_run: bool,
) -> int:
    """按主键逐条 DeleteRow；返回删除条数（dry-run 时为将要删除的条数）。"""
    from tablestore import Row, Condition, RowExistenceExpectation

    ids = fetch_all_model_ids(client, table_name)
    if dry_run:
        for mid in ids:
            print(f"[dry-run] 将删除 model_id={mid!r}")
        return len(ids)

    cond = Condition(RowExistenceExpectation.IGNORE, None)
    n = 0
    for mid in ids:
        row = Row([("model_id", mid)])
        client.delete_row(table_name, row, cond)
        print(f"已删除: {mid}")
        n += 1
    return n


def put_rows(
    rows: list[dict[str, Any]],
    dry_run: bool,
    *,
    access_key_id: str | None = None,
    access_key_secret: str | None = None,
) -> None:
    try:
        from tablestore import OTSClient, Row, Condition, RowExistenceExpectation
    except ImportError as e:
        print("请先安装：pip install tablestore", file=sys.stderr)
        raise e

    if not dry_run:
        if not access_key_id or not access_key_secret:
            print("错误：缺少 AccessKey，请通过 read_credentials_interactive() 获取后再调用。", file=sys.stderr)
            sys.exit(2)
        client: OTSClient | None = OTSClient(
            OTS_ENDPOINT,
            access_key_id,
            access_key_secret,
            OTS_INSTANCE_NAME,
        )
    else:
        client = None

    # IGNORE：不校验行是否已存在；PutRow 对已存在行会先删后写整行，实现覆盖（与控制台手工数据兼容）
    cond = Condition(RowExistenceExpectation.IGNORE, None)

    for i, item in enumerate(rows):
        if not isinstance(item, dict):
            raise ValueError(f"第 {i} 条不是对象")
        model_id = item.get("model_id")
        function_name = item.get("function_name", "")
        current_logic = str(item.get("current_logic", ""))
        if not model_id or not isinstance(model_id, str):
            raise ValueError(f"第 {i} 条缺少有效 model_id")

        _, multiplier, yuanbao_rate = resolve_prices(current_logic)
        base_price = default_base_price_cny(model_id, current_logic)
        if item.get("base_price") is not None:
            base_price = float(item["base_price"])
        if item.get("multiplier") is not None:
            multiplier = float(item["multiplier"])
        if item.get("yuanbao_rate") is not None:
            yuanbao_rate = float(item["yuanbao_rate"])
        if item.get("is_active") is not None:
            is_active = bool(item["is_active"])
        else:
            is_active = True

        # 显式 float → PlainBuffer 中 VT_DOUBLE，与控制台「Double」属性列一致
        base_price_d = as_ots_double(base_price)
        multiplier_d = as_ots_double(multiplier)
        yuanbao_rate_d = as_ots_double(yuanbao_rate)

        primary_key = [("model_id", model_id)]
        attribute_columns = [
            ("function_name", str(function_name)),
            ("is_active", is_active),
            ("base_price", base_price_d),
            ("multiplier", multiplier_d),
            ("yuanbao_rate", yuanbao_rate_d),
        ]
        row = Row(primary_key, attribute_columns)

        if dry_run:
            print(
                f"[dry-run] {model_id!r} function_name={function_name!r} "
                f"base_price={base_price_d} multiplier={multiplier_d} yuanbao_rate={yuanbao_rate_d}"
            )
            continue

        assert client is not None
        client.put_row(TABLE_NAME, row, cond)
        print(f"已写入: {model_id}")

    if dry_run:
        print(f"共 {len(rows)} 条（未实际写入）")
    else:
        print(f"完成，共写入 {len(rows)} 条 -> {TABLE_NAME}")


def main() -> None:
    parser = argparse.ArgumentParser(description="同步模型定价基准到 Tablestore nx_model_config")
    parser.add_argument(
        "--json",
        type=Path,
        default=None,
        help="可选：从文件加载 JSON 数组（每项含 model_id, function_name, current_logic；"
        "可选 base_price, multiplier, yuanbao_rate, is_active 覆盖默认推导）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="仅打印将写入的字段，不调用 OTS",
    )
    parser.add_argument(
        "--delete-all",
        action="store_true",
        help="删除表中全部行（需配合 --yes；不可与 --dry-run 同时使用）",
    )
    parser.add_argument(
        "--replace-all",
        action="store_true",
        help="先删除全部行，再写入 --json 或内置默认数据（需配合 --yes）",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="确认执行删除类危险操作（--delete-all / --replace-all）",
    )
    args = parser.parse_args()

    if args.delete_all and args.replace_all:
        print("错误：请只选其一：--delete-all（仅清空）或 --replace-all（清空后写入）。", file=sys.stderr)
        sys.exit(2)

    if (args.delete_all or args.replace_all) and args.dry_run:
        print("错误：--delete-all / --replace-all 不可与 --dry-run 同时使用。", file=sys.stderr)
        sys.exit(2)

    if args.delete_all or args.replace_all:
        if not args.yes:
            print("错误：删除或全量替换必须附加 --yes 以确认。", file=sys.stderr)
            sys.exit(2)

    rows = load_rows(args.json)

    if args.delete_all or args.replace_all:
        ak_id, ak_secret = read_credentials_interactive()
        from tablestore import OTSClient

        client = OTSClient(OTS_ENDPOINT, ak_id, ak_secret, OTS_INSTANCE_NAME)
        n_del = delete_all_rows(client, TABLE_NAME, dry_run=False)
        print(f"删除完成，共 {n_del} 条。")

        if args.delete_all and not args.replace_all:
            print("仅删除模式结束。若要写入新数据，请再次运行本脚本（不带 --delete-all）。")
            return

        put_rows(rows, dry_run=False, access_key_id=ak_id, access_key_secret=ak_secret)
        return

    if args.dry_run:
        put_rows(rows, dry_run=True)
    else:
        ak_id, ak_secret = read_credentials_interactive()
        put_rows(
            rows,
            dry_run=False,
            access_key_id=ak_id,
            access_key_secret=ak_secret,
        )


if __name__ == "__main__":
    main()
