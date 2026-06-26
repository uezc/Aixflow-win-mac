#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
import os
import re
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple


TARGET_FIELDS = {
    "bubbles", "text", "content", "query", "response", "prompt", "message",
    "messages", "answer", "question", "input", "output", "body", "parts",
}
SKIP_FIELDS = {
    "image", "images", "blob", "binary", "thumbnail", "attachment",
    "filedata", "base64", "datauri", "icon", "avatar", "jpeg", "png",
}


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def backup_file(src: Path, backup_dir: Path) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    dst = backup_dir / f"{src.name}.backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    shutil.copy2(src, dst)
    log(f"备份完成: {dst}")
    return dst


def open_ro(db_path: Path) -> sqlite3.Connection:
    uri = f"file:{db_path.as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=90)
    conn.row_factory = sqlite3.Row
    return conn


def maybe_json_loads(s: str) -> Any:
    txt = s.strip()
    if not txt:
        return s
    if (txt.startswith("{") and txt.endswith("}")) or (txt.startswith("[") and txt.endswith("]")):
        try:
            return json.loads(txt)
        except Exception:
            return s
    return s


def looks_like_noise(text: str) -> bool:
    s = text.strip()
    if not s:
        return True
    if s.startswith("workbench.panel.aichat.view."):
        return True
    if s.startswith("workbench.panel.composerChatViewPane."):
        return True
    if s.startswith("data:image/") or s.startswith("data:application/octet-stream"):
        return True
    if len(s) > 600 and re.fullmatch(r"[A-Za-z0-9+/=\r\n]+", s) is not None:
        return True
    return False


def is_binary_bytes(b: bytes) -> bool:
    if not b:
        return False
    if b"\x00" in b:
        return True
    bad = sum(1 for x in b[:2048] if x < 9 or (13 < x < 32))
    return (bad / max(1, min(len(b), 2048))) > 0.3


def extract_dialog_text(obj: Any, parent_key: str = "", depth: int = 0) -> List[str]:
    if depth > 40:
        return []
    out: List[str] = []

    if isinstance(obj, dict):
        for k, v in obj.items():
            lk = str(k).lower()
            if any(x in lk for x in SKIP_FIELDS):
                continue
            out.extend(extract_dialog_text(v, lk, depth + 1))
        return out

    if isinstance(obj, list):
        for item in obj:
            out.extend(extract_dialog_text(item, parent_key, depth + 1))
        return out

    if isinstance(obj, bytes):
        if is_binary_bytes(obj):
            return out
        try:
            obj = obj.decode("utf-8", errors="replace")
        except Exception:
            return out

    if isinstance(obj, str):
        parsed = maybe_json_loads(obj)
        if parsed is not obj:
            out.extend(extract_dialog_text(parsed, parent_key, depth + 1))
            return out
        s = obj.strip()
        if looks_like_noise(s):
            return out
        if parent_key.lower() in TARGET_FIELDS:
            out.append(s)
            return out
        # 兜底：看起来像自然语言再收
        if re.search(r"[\u4e00-\u9fff]", s) or (len(s) >= 20 and " " in s):
            out.append(s)
        return out

    if parent_key.lower() in TARGET_FIELDS and isinstance(obj, (int, float, bool)):
        out.append(str(obj))
    return out


def dedup_keep_order(items: Sequence[str]) -> List[str]:
    seen: Set[str] = set()
    out: List[str] = []
    for s in items:
        t = s.strip()
        if not t or t in seen:
            continue
        seen.add(t)
        out.append(t)
    return out


def get_tables(conn: sqlite3.Connection) -> List[str]:
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
    return [str(r["name"]) for r in rows]


def get_columns(conn: sqlite3.Connection, table: str) -> List[Tuple[str, str]]:
    rows = conn.execute(f"PRAGMA table_info('{table}')").fetchall()
    return [(str(r["name"]), str(r["type"] or "")) for r in rows]


def pick_scan_columns(cols: List[Tuple[str, str]]) -> List[str]:
    selected = []
    for name, ctype in cols:
        t = ctype.upper()
        if ("CHAR" in t) or ("TEXT" in t) or ("CLOB" in t) or ("BLOB" in t) or (t == ""):
            selected.append(name)
    return selected


def rowid_min_max(conn: sqlite3.Connection, table: str) -> Optional[Tuple[int, int]]:
    try:
        row = conn.execute(f"SELECT MIN(rowid) mn, MAX(rowid) mx FROM '{table}'").fetchone()
        if row is None or row["mn"] is None or row["mx"] is None:
            return None
        return int(row["mn"]), int(row["mx"])
    except sqlite3.DatabaseError:
        return None


def fetch_range_safe(
    conn: sqlite3.Connection,
    table: str,
    cols: List[str],
    lo: int,
    hi: int,
    bad_ranges: List[Tuple[str, int, int, str]],
) -> List[sqlite3.Row]:
    if lo > hi:
        return []
    col_sql = ", ".join([f"'{c}' as _dummy_{i}" if c == "" else c for i, c in enumerate(cols)])
    sql = f"SELECT rowid AS _rid, {col_sql} FROM '{table}' WHERE rowid BETWEEN ? AND ? ORDER BY rowid"
    try:
        return conn.execute(sql, (lo, hi)).fetchall()
    except sqlite3.DatabaseError as e:
        if lo == hi:
            bad_ranges.append((table, lo, hi, str(e)))
            return []
        mid = (lo + hi) // 2
        left = fetch_range_safe(conn, table, cols, lo, mid, bad_ranges)
        right = fetch_range_safe(conn, table, cols, mid + 1, hi, bad_ranges)
        return left + right


def main() -> None:
    parser = argparse.ArgumentParser(description="从损坏 state.vscdb 全表深度提取聊天正文")
    parser.add_argument(
        "--input",
        default=r"C:\Users\Administrator\AppData\Roaming\Cursor\User\globalStorage\state.vscdb.corrupted.1770629096907",
        help="损坏数据库路径",
    )
    parser.add_argument("--backup-dir", default=r"D:\CursorRestore\backup", help="备份目录")
    parser.add_argument("--out-txt", default=r"D:\NEXFLOW\real_content_fullscan.txt", help="输出文本路径")
    parser.add_argument("--chunk-size", type=int, default=5000, help="rowid 扫描分块")
    args = parser.parse_args()

    src = Path(args.input).resolve()
    if not src.exists():
        raise FileNotFoundError(f"输入数据库不存在: {src}")

    backup = backup_file(src, Path(args.backup_dir).resolve())
    conn = None
    bad_ranges: List[Tuple[str, int, int, str]] = []

    try:
        conn = open_ro(backup)
        try:
            q = conn.execute("PRAGMA quick_check").fetchone()
            if q:
                log(f"quick_check: {q[0]}")
        except sqlite3.DatabaseError as e:
            log(f"quick_check 跳过: {e}")

        tables = get_tables(conn)
        log(f"检测到表数量: {len(tables)}")

        extracted_blocks: List[Dict[str, Any]] = []
        total_rows = 0
        chunk = max(1, args.chunk_size)

        for table in tables:
            cols_all = get_columns(conn, table)
            scan_cols = pick_scan_columns(cols_all)
            if not scan_cols:
                continue

            rr = rowid_min_max(conn, table)
            if rr is None:
                continue
            mn, mx = rr
            log(f"扫描表: {table} | rowid: {mn}-{mx} | 列数: {len(scan_cols)}")

            lo = mn
            while lo <= mx:
                hi = min(mx, lo + chunk - 1)
                rows = fetch_range_safe(conn, table, scan_cols, lo, hi, bad_ranges)
                total_rows += len(rows)

                for row in rows:
                    rid = int(row["_rid"])
                    lines: List[str] = []
                    for c in scan_cols:
                        try:
                            val = row[c]
                        except Exception:
                            continue
                        if val is None:
                            continue
                        lines.extend(extract_dialog_text(val, c))

                    lines = dedup_keep_order(lines)
                    if lines:
                        extracted_blocks.append(
                            {"table": table, "rowid": rid, "lines": lines[:100]}
                        )
                lo = hi + 1

        out_txt = Path(args.out_txt).resolve()
        out_txt.parent.mkdir(parents=True, exist_ok=True)
        with out_txt.open("w", encoding="utf-8") as f:
            f.write("=== FULLSCAN REAL CONTENT ===\n\n")
            for i, block in enumerate(extracted_blocks, start=1):
                f.write(f"{'=' * 20} HIT {i} {'=' * 20}\n")
                f.write(f"TABLE: {block['table']} | ROWID: {block['rowid']}\n")
                for idx, line in enumerate(block["lines"], start=1):
                    f.write(f"{idx}. {line}\n")
                f.write("\n")
            if not extracted_blocks:
                f.write("未发现可识别的对话正文。\n")

        err_path = out_txt.with_suffix(".errors.log")
        with err_path.open("w", encoding="utf-8") as ef:
            for t, a, b, e in bad_ranges:
                ef.write(f"{t} [{a}, {b}] {e}\n")

        log(f"扫描总行数: {total_rows}")
        log(f"命中区块: {len(extracted_blocks)}")
        log(f"输出文件: {out_txt}")
        log(f"坏区间日志: {err_path}")

    finally:
        if conn is not None:
            conn.close()


if __name__ == "__main__":
    main()
