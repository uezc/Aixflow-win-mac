"""SSE 事件 hub：按 out_trade_no 推送 settlement / recharge 事件"""

from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import Any

_subscribers: dict[str, list[asyncio.Queue[dict[str, Any]]]] = defaultdict(list)


def subscribe(out_trade_no: str) -> asyncio.Queue:
    key = (out_trade_no or "").strip()
    q: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    _subscribers[key].append(q)
    return q


def unsubscribe(out_trade_no: str, q: asyncio.Queue) -> None:
    key = (out_trade_no or "").strip()
    lst = _subscribers.get(key, [])
    if q in lst:
        lst.remove(q)
    if not lst and key in _subscribers:
        del _subscribers[key]


async def publish(out_trade_no: str, event: dict[str, Any]) -> None:
    key = (out_trade_no or "").strip()
    if not key:
        return
    payload = {"out_trade_no": key, **event}
    for q in list(_subscribers.get(key, [])):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            pass


def format_sse(data: dict[str, Any]) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
