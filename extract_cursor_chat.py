#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import datetime as dt
import json
import os
import shutil
import sqlite3
import sys
from pathlib import Path
from typing import List, Tuple, Optional


def log(msg: str) -> None:
    print(f"[{dt.datetime.now().strftime('%H:%M:%S')}] {msg}")


def backup_db(src: Path, backup_dir: Path) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    dst = backup_dir / f"{src.name}.backup_{ts}"
    log(f"开始备份数据库: {src} -> {dst}")
    shutil.copy2(src, dst)
    log("备份完成")
    return dst


def open_db_readonly(db_path: Path) -> sqlite3.Connection:
    # 使用 URI + mode=ro，避免写入；large db 场景建议增大超时
    uri = f"file:{db_path.as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=60)
    conn.row_factory = sqlite3.Row
    return conn


def list_tables(conn: sqlite3.Connection) -> List[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    return [str(r["name"]) for r in rows]


def detect_columns(conn: sqlite3.Connection, table: str) -> Tuple[Optional[str], Optional[str], List[str]]:
    """
    在指定表中自动识别 key/value 列名。
    返回 (key_col, value_col, all_columns)。
    """
    cur = conn.execute(f"PRAGMA table_info('{table}')")
    cols = [r["name"] for r in cur.fetchall()]
    lower_map = {c.lower(): c for c in cols}

    key_candidates = ["key", "k", "name", "id"]
    value_candidates = ["value", "val", "data", "json", "content", "blob"]

    key_col = next((lower_map[c] for c in key_candidates if c in lower_map), None)
    value_col = next((lower_map[c] for c in value_candidates if c in lower_map), None)
    return key_col, value_col, cols


def detect_source(conn: sqlite3.Connection) -> Tuple[str, str, str]:
    """
    自动识别来源表及 key/value 列，优先尝试已知表名，然后回退到全库扫描。
    """
    preferred_tables = ["memento", "ItemTable", "itemtable", "itemTable"]
    all_tables = list_tables(conn)
    seen = set()
    candidates = []

    for t in preferred_tables + all_tables:
        if t in seen:
            continue
        seen.add(t)
        candidates.append(t)

    for table in candidates:
        key_col, value_col, cols = detect_columns(conn, table)
        if key_col and value_col:
            return table, key_col, value_col

    raise RuntimeError(
        "无法自动识别来源表及 key/value 列。\n"
        f"现有表: {all_tables}\n"
        "请检查该文件是否真的是 Cursor/VSCode state.vscdb。"
    )


def get_rowid_range(conn: sqlite3.Connection, table: str) -> Tuple[int, int]:
    row = conn.execute(f"SELECT MIN(rowid) AS mn, MAX(rowid) AS mx FROM {table}").fetchone()
    if row is None or row["mn"] is None or row["mx"] is None:
        return 0, -1
    return int(row["mn"]), int(row["mx"])


def safe_fetch_range(
    conn: sqlite3.Connection,
    table: str,
    key_col: str,
    value_col: str,
    lo: int,
    hi: int,
    key_like: str,
    bad_ranges: List[Tuple[int, int, str]],
) -> List[Tuple[int, str, str]]:
    """
    尝试读取 [lo, hi] 区间。
    若区间报损坏，则二分递归，直到定位到单行并跳过。
    返回 (rowid, key, value) 列表。
    """
    if lo > hi:
        return []

    sql = (
        f"SELECT rowid AS _rid, {key_col} AS _key, {value_col} AS _val "
        f"FROM {table} "
        f"WHERE rowid BETWEEN ? AND ? AND {key_col} LIKE ? "
        f"ORDER BY rowid"
    )

    try:
        cur = conn.execute(sql, (lo, hi, key_like))
        rows = cur.fetchall()
        return [(int(r["_rid"]), str(r["_key"]), r["_val"]) for r in rows]
    except sqlite3.DatabaseError as e:
        # 区间有损坏，降级处理
        if lo == hi:
            bad_ranges.append((lo, hi, str(e)))
            return []

        mid = (lo + hi) // 2
        left = safe_fetch_range(conn, table, key_col, value_col, lo, mid, key_like, bad_ranges)
        right = safe_fetch_range(conn, table, key_col, value_col, mid + 1, hi, key_like, bad_ranges)
        return left + right


def parse_json_text(value_obj) -> Optional[str]:
    """
    memento.value 可能是 TEXT / BLOB / bytes。
    目标：提取可读 JSON 文本（尽量不丢信息）。
    """
    if value_obj is None:
        return None

    if isinstance(value_obj, bytes):
        # 优先 utf-8，失败再用 replace
        txt = value_obj.decode("utf-8", errors="replace")
    else:
        txt = str(value_obj)

    txt_strip = txt.strip()
    if not txt_strip:
        return None

    # 尝试标准 JSON 解析，成功后再规范化输出
    try:
        parsed = json.loads(txt_strip)
        return json.dumps(parsed, ensure_ascii=False)
    except Exception:
        # 有些记录可能是半损坏 JSON，保留原文以便后续人工处理
        return txt_strip


def save_jsonl(records: List[Tuple[int, str, str]], out_file: Path) -> None:
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with out_file.open("w", encoding="utf-8") as f:
        for rid, key, json_text in records:
            line = {
                "rowid": rid,
                "key": key,
                "chat_json": json_text,
            }
            f.write(json.dumps(line, ensure_ascii=False) + "\n")


def save_slim_db(records: List[Tuple[int, str, str]], out_db: Path) -> None:
    out_db.parent.mkdir(parents=True, exist_ok=True)
    if out_db.exists():
        out_db.unlink()

    conn = sqlite3.connect(out_db.as_posix())
    try:
        conn.execute(
            """
            CREATE TABLE chat_history_extract (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_rowid INTEGER,
                memento_key TEXT,
                chat_json TEXT
            )
            """
        )
        conn.executemany(
            "INSERT INTO chat_history_extract (source_rowid, memento_key, chat_json) VALUES (?, ?, ?)",
            records,
        )
        conn.commit()
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(
        description="从损坏的 state.vscdb 中提取 memento.cursor.chat.history 数据"
    )
    parser.add_argument("db_path", help="原始 state.vscdb 路径")
    parser.add_argument("--backup-dir", default="./db_backup", help="备份目录")
    parser.add_argument("--out-jsonl", default="./cursor_chat_history.jsonl", help="输出 JSONL 文件")
    parser.add_argument("--out-slim-db", default="", help="可选：输出精简版 SQLite 路径")
    parser.add_argument("--chunk-size", type=int, default=50000, help="按 rowid 分块扫描大小")
    args = parser.parse_args()

    db_path = Path(args.db_path).resolve()
    if not db_path.exists():
        print(f"数据库文件不存在: {db_path}", file=sys.stderr)
        sys.exit(1)

    backup_dir = Path(args.backup_dir).resolve()
    out_jsonl = Path(args.out_jsonl).resolve()
    out_slim_db = Path(args.out_slim_db).resolve() if args.out_slim_db else None

    # 1) 先备份
    backup_file = backup_db(db_path, backup_dir)

    # 2) 从备份文件读取（更安全）
    conn = None
    try:
        conn = open_db_readonly(backup_file)
        log("数据库连接成功（只读）")

        # 可选：快速检查
        try:
            check = conn.execute("PRAGMA quick_check").fetchone()
            if check:
                log(f"quick_check: {check[0]}")
        except sqlite3.DatabaseError as e:
            log(f"quick_check 执行失败（可忽略）: {e}")

        source_table, key_col, value_col = detect_source(conn)
        log(f"检测到来源表: {source_table}，列: key={key_col}, value={value_col}")

        mn, mx = get_rowid_range(conn, source_table)
        if mx < mn:
            log(f"{source_table} 表为空，无可提取内容")
            save_jsonl([], out_jsonl)
            return

        log(f"rowid 范围: {mn} ~ {mx}")

        key_like = "%cursor.chat.history%"
        bad_ranges: List[Tuple[int, int, str]] = []
        raw_rows: List[Tuple[int, str, str]] = []

        # 3) 分块 + 降级读取，尽量绕过损坏区域
        chunk = max(1, args.chunk_size)
        cur_lo = mn
        while cur_lo <= mx:
            cur_hi = min(mx, cur_lo + chunk - 1)
            rows = safe_fetch_range(
                conn, source_table, key_col, value_col,
                cur_lo, cur_hi, key_like, bad_ranges
            )
            raw_rows.extend(rows)
            log(f"已扫描区间 [{cur_lo}, {cur_hi}]，累计命中 {len(raw_rows)} 条")
            cur_lo = cur_hi + 1

        # 4) 解析 JSON 文本（坏 JSON 不中断）
        extracted: List[Tuple[int, str, str]] = []
        skipped_parse = 0
        for rid, key, val in raw_rows:
            txt = parse_json_text(val)
            if txt is None:
                skipped_parse += 1
                continue
            extracted.append((rid, key, txt))

        # 5) 写出文件
        save_jsonl(extracted, out_jsonl)
        log(f"JSONL 输出完成: {out_jsonl}，共 {len(extracted)} 条")

        if out_slim_db:
            save_slim_db(extracted, out_slim_db)
            log(f"精简版数据库输出完成: {out_slim_db}")

        if bad_ranges:
            log(f"检测到损坏区间/记录数量: {len(bad_ranges)}（已跳过）")
            err_log = out_jsonl.with_suffix(".errors.log")
            with err_log.open("w", encoding="utf-8") as ef:
                for lo, hi, err in bad_ranges:
                    ef.write(f"[{lo}, {hi}] {err}\n")
            log(f"损坏详情已写入: {err_log}")

        log("提取任务完成")

    except Exception as e:
        print(f"执行失败: {e}", file=sys.stderr)
        sys.exit(2)
    finally:
        if conn is not None:
            conn.close()


if __name__ == "__main__":
    main()