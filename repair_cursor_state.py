#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
import re
import sqlite3
from pathlib import Path
from typing import Any, List, Optional, Tuple


def log(msg: str) -> None:
    print(msg, flush=True)


def open_ro(db_path: Path) -> sqlite3.Connection:
    uri = f"file:{db_path.as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=60)
    conn.row_factory = sqlite3.Row
    return conn


def open_rw(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path.as_posix(), timeout=60)
    conn.row_factory = sqlite3.Row
    return conn


def list_tables(conn: sqlite3.Connection) -> List[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    return [str(r["name"]) for r in rows]


def detect_key_value_columns(
    conn: sqlite3.Connection, table: str
) -> Tuple[Optional[str], Optional[str], List[str]]:
    cols = [r["name"] for r in conn.execute(f"PRAGMA table_info('{table}')").fetchall()]
    lower = {c.lower(): c for c in cols}

    key_candidates = ["key", "k", "name", "id"]
    value_candidates = ["value", "val", "data", "json", "content", "blob"]

    key_col = next((lower[c] for c in key_candidates if c in lower), None)
    val_col = next((lower[c] for c in value_candidates if c in lower), None)
    return key_col, val_col, cols


def detect_source(conn: sqlite3.Connection) -> Tuple[str, str, str]:
    preferred = ["memento", "ItemTable", "itemtable", "itemTable"]
    tables = list_tables(conn)
    checked = []

    for table in preferred + tables:
        if table in checked:
            continue
        checked.append(table)
        try:
            key_col, val_col, _ = detect_key_value_columns(conn, table)
            if key_col and val_col:
                return table, key_col, val_col
        except sqlite3.DatabaseError:
            continue

    raise RuntimeError(f"未能识别 key/value 来源表。当前表: {tables}")


def rowid_range(conn: sqlite3.Connection, table: str) -> Tuple[int, int]:
    row = conn.execute(f"SELECT MIN(rowid) AS mn, MAX(rowid) AS mx FROM '{table}'").fetchone()
    if not row or row["mn"] is None or row["mx"] is None:
        return 0, -1
    return int(row["mn"]), int(row["mx"])


IMG_OR_BIN_KEYWORDS = (
    "image",
    "img",
    "blob",
    "binary",
    "thumbnail",
    "base64",
    "filedata",
    "attachment",
)
TEXT_KEYWORDS = ("content", "text", "message", "prompt", "response", "assistant", "user", "role")


def looks_like_base64_or_data_uri(s: str) -> bool:
    s2 = s.strip()
    if s2.startswith("data:image/") or s2.startswith("data:application/octet-stream"):
        return True
    if len(s2) > 800 and re.fullmatch(r"[A-Za-z0-9+/=\r\n]+", s2) is not None:
        return True
    return False


def is_binary_bytes(b: bytes) -> bool:
    if not b:
        return False
    if b"\x00" in b:
        return True
    bad = sum(1 for x in b[:2048] if x < 9 or (13 < x < 32))
    return (bad / max(1, min(len(b), 2048))) > 0.3


def collect_text_from_json(obj: Any, parent_key: str = "") -> List[str]:
    out: List[str] = []

    if isinstance(obj, dict):
        for k, v in obj.items():
            lk = str(k).lower()
            if any(w in lk for w in IMG_OR_BIN_KEYWORDS):
                continue
            out.extend(collect_text_from_json(v, lk))
        return out

    if isinstance(obj, list):
        for item in obj:
            out.extend(collect_text_from_json(item, parent_key))
        return out

    if isinstance(obj, str):
        s = obj.strip()
        if not s:
            return out
        if looks_like_base64_or_data_uri(s):
            return out
        if parent_key and any(w in parent_key for w in TEXT_KEYWORDS):
            out.append(s)
            return out
        if len(s) >= 2:
            out.append(s)
        return out

    return out


def dehydrate_value_to_text(value: Any) -> Optional[str]:
    if isinstance(value, bytes):
        if is_binary_bytes(value):
            return None
        try:
            value = value.decode("utf-8", errors="replace")
        except Exception:
            return None

    if value is None:
        return None

    s = str(value).strip()
    if not s:
        return None

    try:
        parsed = json.loads(s)
        texts = collect_text_from_json(parsed)
        uniq = list(dict.fromkeys([t for t in texts if t.strip()]))
        if not uniq:
            return None
        return "\n".join(uniq)
    except Exception:
        if looks_like_base64_or_data_uri(s):
            return None
        return s


def safe_fetch(
    conn: sqlite3.Connection,
    table: str,
    key_col: str,
    val_col: str,
    lo: int,
    hi: int,
    key_patterns: List[str],
    bad_ranges: List[Tuple[int, int, str]],
) -> List[Tuple[int, str, Any]]:
    if lo > hi:
        return []

    where_like = " OR ".join([f"{key_col} LIKE ?" for _ in key_patterns])
    sql = (
        f"SELECT rowid AS _rid, {key_col} AS _key, {val_col} AS _val "
        f"FROM '{table}' "
        f"WHERE rowid BETWEEN ? AND ? AND ({where_like}) "
        f"ORDER BY rowid"
    )
    params = [lo, hi] + key_patterns

    try:
        rows = conn.execute(sql, params).fetchall()
        return [(int(r["_rid"]), str(r["_key"]), r["_val"]) for r in rows]
    except sqlite3.DatabaseError as e:
        if lo == hi:
            bad_ranges.append((lo, hi, str(e)))
            return []
        mid = (lo + hi) // 2
        left = safe_fetch(conn, table, key_col, val_col, lo, mid, key_patterns, bad_ranges)
        right = safe_fetch(conn, table, key_col, val_col, mid + 1, hi, key_patterns, bad_ranges)
        return left + right


def init_output_db(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode=DELETE")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS dehydrated_chat (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_table TEXT NOT NULL,
            source_rowid INTEGER NOT NULL,
            source_key TEXT NOT NULL,
            chat_text TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_dehydrated_key ON dehydrated_chat(source_key)")
    conn.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description="修复并脱水 Cursor state.vscdb 聊天数据")
    parser.add_argument(
        "--input",
        default=r"C:\Users\Administrator\AppData\Roaming\Cursor\User\globalStorage\state.vscdb.corrupted.1770629096907",
        help="损坏数据库路径",
    )
    parser.add_argument(
        "--output",
        default="repair_state.vscdb",
        help="输出精简数据库路径（默认当前目录 repair_state.vscdb）",
    )
    parser.add_argument("--chunk-size", type=int, default=20000, help="分块扫描大小")
    args = parser.parse_args()

    in_db = Path(args.input).resolve()
    out_db = Path(args.output).resolve()

    if not in_db.exists():
        raise FileNotFoundError(f"输入数据库不存在: {in_db}")

    if out_db.exists():
        out_db.unlink()

    ro_conn = None
    rw_conn = None
    try:
        ro_conn = open_ro(in_db)
        rw_conn = open_rw(out_db)
        init_output_db(rw_conn)

        try:
            q = ro_conn.execute("PRAGMA quick_check").fetchone()
            if q:
                log(f"quick_check: {q[0]}")
        except sqlite3.DatabaseError as e:
            log(f"quick_check 跳过: {e}")

        table, key_col, val_col = detect_source(ro_conn)
        log(f"来源表: {table}, key列: {key_col}, value列: {val_col}")

        mn, mx = rowid_range(ro_conn, table)
        if mx < mn:
            log("来源表为空，任务结束。")
            return

        key_patterns = [
            "%cursor.chat.history%",
            "%chat.history%",
            "%composer%",
            "%conversation%",
            "%chat%",
        ]

        bad_ranges: List[Tuple[int, int, str]] = []
        total_rows = 0
        saved_rows = 0

        lo = mn
        chunk = max(1, args.chunk_size)
        while lo <= mx:
            hi = min(mx, lo + chunk - 1)
            rows = safe_fetch(ro_conn, table, key_col, val_col, lo, hi, key_patterns, bad_ranges)
            total_rows += len(rows)

            batch = []
            for rid, key, val in rows:
                try:
                    text = dehydrate_value_to_text(val)
                    if not text:
                        continue
                    batch.append((table, rid, key, text))
                except Exception:
                    continue

            if batch:
                try:
                    rw_conn.executemany(
                        "INSERT INTO dehydrated_chat (source_table, source_rowid, source_key, chat_text) VALUES (?, ?, ?, ?)",
                        batch,
                    )
                    rw_conn.commit()
                    saved_rows += len(batch)
                except sqlite3.DatabaseError:
                    for row in batch:
                        try:
                            rw_conn.execute(
                                "INSERT INTO dehydrated_chat (source_table, source_rowid, source_key, chat_text) VALUES (?, ?, ?, ?)",
                                row,
                            )
                            saved_rows += 1
                        except sqlite3.DatabaseError:
                            pass
                    rw_conn.commit()

            log(f"扫描区间 [{lo}, {hi}]，命中候选 {len(rows)}，已保存 {saved_rows}")
            lo = hi + 1

        rw_conn.execute(
            """
            CREATE TABLE IF NOT EXISTS repair_meta (
                k TEXT PRIMARY KEY,
                v TEXT
            )
            """
        )
        rw_conn.executemany(
            "INSERT OR REPLACE INTO repair_meta (k, v) VALUES (?, ?)",
            [
                ("input_db", str(in_db)),
                ("source_table", table),
                ("source_key_col", key_col),
                ("source_value_col", val_col),
                ("candidate_rows", str(total_rows)),
                ("saved_rows", str(saved_rows)),
                ("bad_ranges_count", str(len(bad_ranges))),
            ],
        )
        rw_conn.commit()

        err_path = out_db.with_suffix(".errors.log")
        with err_path.open("w", encoding="utf-8") as f:
            for a, b, e in bad_ranges:
                f.write(f"[{a}, {b}] {e}\n")

        log(f"完成。输出数据库: {out_db}")
        log(f"坏区间记录数: {len(bad_ranges)}，详见: {err_path}")
        log(f"最终保存纯文本记录: {saved_rows}")

    finally:
        if ro_conn is not None:
            ro_conn.close()
        if rw_conn is not None:
            rw_conn.close()


if __name__ == "__main__":
    main()
