#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import os
import re
import sqlite3
from typing import Any, List, Set

DB_PATH = r"D:/NEXFLOW/repair_state.vscdb"
OUT_PATH = r"D:/NEXFLOW/real_content.txt"

# 优先抓取这些典型对话字段
TARGET_FIELDS = {
    "bubbles",
    "text",
    "content",
    "query",
    "response",
    "prompt",
    "message",
    "messages",
    "answer",
    "question",
    "input",
    "output",
    "body",
}

# 明确跳过可能导致“脱水失败”的大二进制相关字段
SKIP_FIELDS = {
    "image",
    "images",
    "blob",
    "binary",
    "thumbnail",
    "attachment",
    "filedata",
    "base64",
    "datauri",
}


def maybe_json_loads(value: str) -> Any:
    s = value.strip()
    if not s:
        return value
    if (s.startswith("{") and s.endswith("}")) or (s.startswith("[") and s.endswith("]")):
        try:
            return json.loads(s)
        except Exception:
            return value
    return value


def looks_like_noise(value: str) -> bool:
    s = value.strip()
    if not s:
        return True
    # 过滤 workbench.panel.aichat.view.xxxxx 这种 ID 串
    if s.startswith("workbench.panel.aichat.view."):
        return True
    # 过滤明显 data uri/base64
    if s.startswith("data:image/") or s.startswith("data:application/octet-stream"):
        return True
    if len(s) > 600 and re.fullmatch(r"[A-Za-z0-9+/=\r\n]+", s) is not None:
        return True
    return False


def extract_from_obj(obj: Any, parent_key: str = "", depth: int = 0) -> List[str]:
    if depth > 30:
        return []
    out: List[str] = []

    if isinstance(obj, dict):
        for k, v in obj.items():
            lk = str(k).lower()
            if any(skip in lk for skip in SKIP_FIELDS):
                continue

            if lk in TARGET_FIELDS:
                out.extend(extract_from_obj(v, lk, depth + 1))
            else:
                out.extend(extract_from_obj(v, lk, depth + 1))
        return out

    if isinstance(obj, list):
        for item in obj:
            out.extend(extract_from_obj(item, parent_key, depth + 1))
        return out

    if isinstance(obj, str):
        parsed = maybe_json_loads(obj)
        if parsed is not obj:
            out.extend(extract_from_obj(parsed, parent_key, depth + 1))
            return out

        text = obj.strip()
        if looks_like_noise(text):
            return out

        # 重点字段直接收集
        if parent_key.lower() in TARGET_FIELDS:
            out.append(text)
            return out

        # 兜底：对非重点字段，只有“像自然语言”的内容才收集
        # 条件：至少包含中文，或包含空格且长度较长
        if re.search(r"[\u4e00-\u9fff]", text) or (len(text) >= 20 and " " in text):
            out.append(text)
        return out

    # 标量只在重点字段下保留
    if parent_key.lower() in TARGET_FIELDS and isinstance(obj, (int, float, bool)):
        out.append(str(obj))
    return out


def dedup_keep_order(items: List[str]) -> List[str]:
    seen: Set[str] = set()
    result: List[str] = []
    for s in items:
        t = s.strip()
        if not t or t in seen:
            continue
        seen.add(t)
        result.append(t)
    return result


def run() -> None:
    if not os.path.exists(DB_PATH):
        print(f"数据库不存在: {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT id, source_key, chat_text FROM dehydrated_chat ORDER BY id"
        ).fetchall()
    except Exception as e:
        conn.close()
        print(f"读取 dehydrated_chat 失败: {e}")
        return

    hit_records = 0
    total_lines = 0

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("=== REAL DIALOG CONTENT ===\n\n")

        for r in rows:
            rec_id = int(r["id"])
            source_key = str(r["source_key"])
            raw = "" if r["chat_text"] is None else str(r["chat_text"])
            parsed = maybe_json_loads(raw)
            obj = parsed if parsed is not raw else raw

            lines = extract_from_obj(obj)
            lines = dedup_keep_order(lines)
            if not lines:
                continue

            hit_records += 1
            total_lines += len(lines)
            f.write(f"{'=' * 20} RECORD {rec_id} {'=' * 20}\n")
            f.write(f"KEY: {source_key}\n")
            for i, line in enumerate(lines, start=1):
                f.write(f"{i}. {line}\n")
            f.write("\n")

        if hit_records == 0:
            f.write("未提取到可识别的对话正文。\n")
            f.write("这通常意味着 repair_state.vscdb 内仅剩 UI 状态/会话 ID，正文已不在该库中。\n")

    conn.close()
    print(f"扫描记录: {len(rows)}")
    print(f"命中记录: {hit_records}")
    print(f"提取行数: {total_lines}")
    print(f"输出文件: {OUT_PATH}")


if __name__ == "__main__":
    run()
