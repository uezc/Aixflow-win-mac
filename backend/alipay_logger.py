"""统一结构化日志：log_type + user_id + out_trade_no + timestamp"""

from __future__ import annotations

import json
import time
from typing import Any


def alipay_log(log_type: str, **fields: Any) -> None:
    payload = {
        "log_type": log_type,
        "ts": int(time.time() * 1000),
        **{k: v for k, v in fields.items() if v is not None},
    }
    try:
        print(json.dumps(payload, ensure_ascii=False))
    except Exception:
        print(f"[alipay] {log_type} {fields}")
