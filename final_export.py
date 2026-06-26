import sqlite3
import json
import os
from typing import Any, List, Set

# 定义路径
db_path = r'D:\NEXFLOW\repair_state.vscdb'
txt_output = r'D:\NEXFLOW\real_content.txt'

TARGET_KEYS = {
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
}


def maybe_parse_json_string(value: str) -> Any:
    s = value.strip()
    if not s:
        return value
    if (s.startswith("{") and s.endswith("}")) or (s.startswith("[") and s.endswith("]")):
        try:
            return json.loads(s)
        except Exception:
            return value
    return value


def collect_dialog_text(obj: Any, parent_key: str = "") -> List[str]:
    out: List[str] = []

    if isinstance(obj, str):
        parsed = maybe_parse_json_string(obj)
        if parsed is not obj:
            return collect_dialog_text(parsed, parent_key)
        text = obj.strip()
        if not text:
            return out
        if parent_key.lower() in TARGET_KEYS:
            out.append(text)
        return out

    if isinstance(obj, dict):
        for k, v in obj.items():
            lk = str(k).lower()
            # 这些字段通常是大二进制/图片信息，直接跳过
            if any(x in lk for x in ("image", "blob", "binary", "base64", "thumbnail", "attachment", "filedata")):
                continue

            if lk in TARGET_KEYS:
                # 命中重点字段，优先展开提取
                child = collect_dialog_text(v, lk)
                if child:
                    out.extend(child)
                elif isinstance(v, (int, float, bool)):
                    out.append(str(v))
            else:
                out.extend(collect_dialog_text(v, lk))
        return out

    if isinstance(obj, list):
        for item in obj:
            out.extend(collect_dialog_text(item, parent_key))
        return out

    return out


def dedup_keep_order(items: List[str]) -> List[str]:
    seen: Set[str] = set()
    result: List[str] = []
    for s in items:
        key = s.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(key)
    return result

def export():
    if not os.path.exists(db_path):
        print(f"找不到数据库文件: {db_path}")
        return

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute('SELECT id, source_key, chat_text FROM dehydrated_chat ORDER BY id').fetchall()
        total = len(rows)
        saved = 0
        extracted_lines = 0

        with open(txt_output, 'w', encoding='utf-8') as f_txt:
            f_txt.write("=== REAL DIALOG CONTENT FROM dehydrated_chat ===\n\n")

            for r in rows:
                rec_id = int(r['id'])
                key = str(r['source_key'])
                raw = r['chat_text']
                content = "" if raw is None else str(raw)

                parsed = maybe_parse_json_string(content)
                texts = collect_dialog_text(parsed if parsed is not content else content)
                texts = dedup_keep_order(texts)

                if not texts:
                    continue

                saved += 1
                extracted_lines += len(texts)

                divider = "=" * 24
                f_txt.write(f"{divider} RECORD {rec_id} {divider}\n")
                f_txt.write(f"KEY: {key}\n")
                f_txt.write("DIALOG:\n")
                for idx, line in enumerate(texts, start=1):
                    f_txt.write(f"{idx}. {line}\n")
                f_txt.write("\n")

        print("导出成功！")
        print("输出文件: " + txt_output)
        print("扫描记录: " + str(total))
        print("命中记录: " + str(saved))
        print("提取文本行数: " + str(extracted_lines))

    except Exception as e:
        print("导出失败: " + str(e))
    finally:
        conn.close()

if __name__ == "__main__":
    export()