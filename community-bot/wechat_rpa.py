#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AIXFLOW 微信桌面端 RPA（截图 OCR + 拟人键鼠）

安全取向：
- 不登录微信协议、不碰 Hook/注入
- 只对本机已登录的微信窗口做截图识别与键鼠模拟
- 发送走剪贴板粘贴 + 随机停顿，降低机械化特征

依赖安装：
  pip install -r requirements-rpa.txt

运行前：
  1. 打开 PC 版微信，进入目标群聊天窗口（保持前台或至少可见）
  2. 可选：设置环境变量 WECHAT_RPA_DRY_RUN=1 只识别不发送

运行（PowerShell）：
  $env:WECHAT_RPA_DRY_RUN=1; python wechat_rpa.py
  python wechat_rpa.py
"""
from __future__ import annotations

import json
import os
import random
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BRIDGE = ROOT / "rpa-bridge.mjs"

# ---------- 可选依赖延后导入，便于先提示安装 ----------


def _need(msg: str) -> None:
    print(f"[wechat-rpa] {msg}", file=sys.stderr)
    sys.exit(1)


try:
    import pyautogui
    import pyperclip
    from PIL import ImageGrab
except ImportError:
    _need("请先安装: pip install -r requirements-rpa.txt")

try:
    from rapidocr_onnxruntime import RapidOCR
except ImportError:
    RapidOCR = None  # type: ignore

try:
    import uiautomation as auto
except ImportError:
    auto = None  # type: ignore


pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.05

# PC 微信常见进群系统提示（含 OCR 易丢引号的宽松写法）
JOIN_PATTERNS = [
    re.compile(r"邀请.+加入了群聊"),
    re.compile(r"通过扫描.+加入群聊"),
    re.compile(r"通过.+二维码加入群聊"),
    re.compile(r".+加入了群聊"),
    re.compile(r"加入了群聊"),
    re.compile(r"邀请你加入了群聊"),
    re.compile(r"你邀请.+加入了群聊"),
]

# 机器人自己发出的文案特征，避免 OCR 后再当用户消息回复
OWN_REPLY_MARKERS = (
    "欢迎",
    "加入 AIXFLOW",
    "我是群助手",
    "请回复数字选择",
    "小白学习",
    "创作者接单",
    "任务派活",
    "走「小白学习」",
    "走「创作者接单」",
    "走「任务派活」",
    "【创作者简介模板】",
    "【派活】",
    "请回复 **1 / 2 / 3**",
    "请回复 1 / 2 / 3",
    "群助手",
)

INTENT_CMD = re.compile(
    r"(?:^|\s)([123１２３]|小白学习|创作者接单|任务派活|下载|接单|派活|学习|教程)(?:\s|$)"
)


@dataclass
class SeenState:
    lines: list[str] = field(default_factory=list)
    welcomed_names: set[str] = field(default_factory=set)
    last_handled_msg: str = ""
    recent_sent: list[str] = field(default_factory=list)  # 归一化指纹，防自回复


def human_sleep(a: float = 0.35, b: float = 1.1) -> None:
    time.sleep(random.uniform(a, b))


def _norm_fp(text: str) -> str:
    return re.sub(r"\s+", "", str(text or ""))[:120]


def remember_sent(state: SeenState, text: str) -> None:
    fp = _norm_fp(text)
    if not fp:
        return
    state.recent_sent.append(fp)
    if len(state.recent_sent) > 40:
        state.recent_sent = state.recent_sent[-40:]


def looks_like_own_reply(line: str, state: SeenState) -> bool:
    s = str(line or "").strip()
    if not s:
        return True
    fp = _norm_fp(s)
    for prev in state.recent_sent:
        if fp and (fp in prev or prev in fp):
            return True
    # 长文案含多个助手特征 → 基本是自己发的
    hits = sum(1 for m in OWN_REPLY_MARKERS if m in s)
    if hits >= 2:
        return True
    if len(s) > 60 and any(m in s for m in ("AIXFLOW", "群助手", "请回复数字")):
        return True
    return False


def find_wechat_window():
    """尽量把微信窗口置于前台。"""
    if auto is None:
        print("[wechat-rpa] 未安装 uiautomation，将依赖当前前台窗口（请先点进微信群）")
        return None
    for name in ("微信", "Weixin", "WeChat"):
        win = auto.WindowControl(searchDepth=1, Name=name)
        if win.Exists(0, 0):
            try:
                win.SetActive()
                human_sleep(0.2, 0.5)
            except Exception:
                pass
            return win
    print("[wechat-rpa] 未找到微信窗口，请先打开 PC 微信并进入目标群")
    return None


def grab_chat_screenshot(win=None):
    """截取微信窗口客户区；找不到窗口则截全屏。"""
    if win is not None:
        try:
            r = win.BoundingRectangle
            box = (r.left, r.top, r.right, r.bottom)
            if box[2] > box[0] and box[3] > box[1]:
                return ImageGrab.grab(bbox=box)
        except Exception:
            pass
    return ImageGrab.grab()


def ocr_lines(img) -> list[str]:
    if RapidOCR is None:
        _need("请安装 rapidocr-onnxruntime: pip install rapidocr-onnxruntime")
    ocr = getattr(ocr_lines, "_engine", None)
    if ocr is None:
        ocr = RapidOCR()
        ocr_lines._engine = ocr  # type: ignore[attr-defined]
    result, _ = ocr(img)
    lines: list[str] = []
    if not result:
        return lines
    for item in result:
        # item: [box, text, score]
        if len(item) >= 2 and item[1]:
            t = str(item[1]).strip()
            if t:
                lines.append(t)
    return lines


def call_node_core(payload: dict) -> dict:
    """经 rpa-bridge.mjs 调用 Node 侧 handleCommunityEvent。"""
    if not BRIDGE.is_file():
        raise RuntimeError(f"缺少桥接脚本: {BRIDGE}")
    proc = subprocess.run(
        ["node", str(BRIDGE), json.dumps(payload, ensure_ascii=False)],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout or "node rpa-bridge failed")
    raw = (proc.stdout or "").strip()
    if not raw:
        return {"messages": []}
    return json.loads(raw)


def extract_join_name(line: str) -> str | None:
    s = str(line or "").strip()
    if not s:
        return None
    matched = any(pat.search(s) for pat in JOIN_PATTERNS)
    if not matched:
        return None

    # 「李四」加入了群聊 / "李四"加入了群聊（含弯引号）
    m = re.search(r'[「"“]([^」"”]{1,24})[」"”]\s*加入了群聊', s)
    if m:
        return m.group(1).strip()

    # 邀请「李四」加入 / 邀请"李四"加入
    m = re.search(r'邀请\s*[「"“]?([^」"”\s]{1,24})[」"”]?\s*加入', s)
    if m:
        name = m.group(1).strip()
        if name not in ("你", "我"):
            return name

    # 通过扫描「张三」分享的二维码加入群聊 → 取被邀请者常在句首引号
    m = re.search(r'^[「"“]([^」"”]{1,24})[」"”]\s*通过扫描', s)
    if m:
        return m.group(1).strip()

    # 无引号：张三加入了群聊 / 你邀请李四加入了群聊
    m = re.search(r"(?:你邀请)?(.+?)加入了群聊", s)
    if m:
        name = m.group(1).strip()
        name = re.sub(r"^.*?邀请", "", name).strip()
        name = re.sub(r'^[「"“]|[」"”]$', "", name).strip()
        if name and name not in ("你", "我") and len(name) < 32:
            return name
    return None


def looks_like_user_intent(line: str) -> str | None:
    s = line.strip()
    if not s or len(s) > 40:
        return None
    # 过滤系统提示
    if any(
        x in s
        for x in (
            "加入了群聊",
            "撤回了一条",
            "以下为新消息",
            "拍了拍",
            "修改群名",
            "移出了群聊",
        )
    ):
        return None
    m = INTENT_CMD.search(s)
    if not m:
        return None
    return s


def human_paste_send(text: str, dry_run: bool, state: SeenState) -> None:
    """拟人发送：剪贴板粘贴 + 随机停顿 + Enter。"""
    content = str(text or "").strip()
    if not content:
        return
    remember_sent(state, content)
    if dry_run:
        print("[wechat-rpa][DRY-RUN] ========== 将发送（未真正输入） ==========")
        print(content[:800])
        print("[wechat-rpa][DRY-RUN] ============================================\n")
        return
    # 点击输入框区域（窗口下部中央，相对坐标近似）
    find_wechat_window()
    screen_w, screen_h = pyautogui.size()
    # 默认点屏幕下半偏左（微信聊天输入区常见位置）；可用环境变量覆盖
    click_x = int(os.environ.get("WECHAT_INPUT_X", str(int(screen_w * 0.45))))
    click_y = int(os.environ.get("WECHAT_INPUT_Y", str(int(screen_h * 0.92))))
    human_sleep(0.2, 0.6)
    pyautogui.click(click_x, click_y)
    human_sleep(0.15, 0.4)
    pyperclip.copy(content)
    human_sleep(0.1, 0.35)
    pyautogui.hotkey("ctrl", "v")
    human_sleep(0.25, 0.7)
    pyautogui.press("enter")
    human_sleep(0.6, 1.4)


def process_new_lines(state: SeenState, lines: list[str], dry_run: bool) -> None:
    # 只处理相对上次新增的尾部行
    prev = state.lines
    if lines == prev:
        return
    # 找公共前缀后的新增
    i = 0
    while i < len(prev) and i < len(lines) and prev[i] == lines[i]:
        i += 1
    # 若 OCR 抖动导致整表重排，只看最后若干行
    new_lines = lines[i:] if i < len(lines) else lines[-8:]
    state.lines = lines[-40:]

    for line in new_lines:
        if looks_like_own_reply(line, state):
            continue

        name = extract_join_name(line)
        if name and name not in state.welcomed_names:
            state.welcomed_names.add(name)
            print(f"[wechat-rpa] 检测到进群: {name}")
            out = call_node_core(
                {
                    "userId": f"wx_ocr:{name}",
                    "displayName": name,
                    "isNewJoin": True,
                }
            )
            for msg in out.get("messages") or []:
                human_paste_send(msg, dry_run, state)
            continue

        intent_text = looks_like_user_intent(line)
        if intent_text and intent_text != state.last_handled_msg:
            # 若行里带昵称前缀「张三: 1」
            m = re.match(r"^([^:]{1,16})[:：]\s*(.+)$", intent_text)
            display = m.group(1).strip() if m else "群友"
            text = m.group(2).strip() if m else intent_text
            # 昵称像助手文案片段则跳过
            if looks_like_own_reply(text, state):
                continue
            print(f"[wechat-rpa] 检测到意图消息: {display} -> {text}")
            out = call_node_core(
                {
                    "userId": f"wx_ocr:{display}",
                    "displayName": display,
                    "text": text,
                    "isNewJoin": False,
                }
            )
            msgs = out.get("messages") or []
            if msgs:
                state.last_handled_msg = intent_text
                for msg in msgs:
                    human_paste_send(msg, dry_run, state)


def main() -> None:
    dry = os.environ.get("WECHAT_RPA_DRY_RUN", "").strip() in ("1", "true", "TRUE", "yes")
    interval = float(os.environ.get("WECHAT_RPA_INTERVAL", "2.5"))
    print("[wechat-rpa] 启动（截图识别 + 拟人发送）")
    if dry:
        print("=" * 56)
        print("  [DRY-RUN] 仅 OCR + 打印回复，不会向微信发送任何内容")
        print("=" * 56)
    print(f"[wechat-rpa] DRY_RUN={dry}  interval={interval}s")
    print("[wechat-rpa] 请打开微信并进入目标群；鼠标移到屏幕左上角可紧急中止 pyautogui")
    if RapidOCR is None:
        _need("缺少 rapidocr-onnxruntime，请: pip install -r requirements-rpa.txt")
    if not BRIDGE.is_file():
        _need(f"缺少 {BRIDGE.name}，请确认 community-bot 目录完整")

    # 预热 OCR + 桥接
    try:
        probe = call_node_core(
            {"userId": "wx_ocr:__probe__", "displayName": "probe", "text": "", "isNewJoin": False}
        )
        assert isinstance(probe.get("messages"), list)
        print("[wechat-rpa] Node 桥接 OK (rpa-bridge.mjs → handleCommunityEvent)")
    except Exception as e:
        _need(f"Node 桥接失败（请确认已安装 Node 且在 community-bot 目录）: {e}")

    _ = ocr_lines(ImageGrab.grab(bbox=(0, 0, 200, 80)))

    state = SeenState()
    while True:
        try:
            win = find_wechat_window()
            img = grab_chat_screenshot(win)
            # 只取窗口下 70% 聊天区，减少侧边栏噪音
            w, h = img.size
            chat = img.crop((int(w * 0.28), int(h * 0.12), int(w * 0.98), int(h * 0.82)))
            lines = ocr_lines(chat)
            if lines:
                process_new_lines(state, lines, dry)
        except KeyboardInterrupt:
            print("\n[wechat-rpa] 已停止")
            break
        except Exception as e:
            print(f"[wechat-rpa] 循环错误: {e}")
        time.sleep(interval + random.uniform(0, 0.8))


if __name__ == "__main__":
    main()
