"""后台补偿：每 30 秒重试 FC 入账失败订单。"""

from __future__ import annotations

import asyncio
import os

from alipay_logger import alipay_log
from alipay_settlement_service import run_retry_compensation

_worker_task: asyncio.Task | None = None


async def _retry_loop() -> None:
    interval = float(os.getenv("ALIPAY_RETRY_INTERVAL_SEC", "30"))
    while True:
        await asyncio.sleep(max(5.0, interval))
        try:
            r = await run_retry_compensation(max_items=20)
            if r.get("processed"):
                alipay_log("retry_worker_done", **r)
        except Exception as exc:
            alipay_log("retry_worker_error", error=str(exc))


def start_background_retry() -> None:
    global _worker_task
    if _worker_task and not _worker_task.done():
        return
    _worker_task = asyncio.create_task(_retry_loop())
    alipay_log("retry_worker_started", interval_sec=os.getenv("ALIPAY_RETRY_INTERVAL_SEC", "30"))
