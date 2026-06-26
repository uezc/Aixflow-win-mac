"""
支付宝 notify 结算服务层：notify 仅验签 + 入队；FC 为异步执行器。
"""

from __future__ import annotations

import asyncio
from typing import Any

from alipay_logger import alipay_log
from fc_client import execute_pending_settlement, get_order_status, process_retry_queue, settle_alipay_order
from sse_hub import publish


async def _try_execute_and_push(out_trade_no: str) -> None:
    try:
        result = await execute_pending_settlement(out_trade_no)
        if result.get("settled") or result.get("already_paid"):
            await publish(
                out_trade_no,
                {
                    "event": "recharge-settled",
                    "balance": result.get("balance"),
                    "user_id": result.get("user_id") or (result.get("order") or {}).get("user_id"),
                    "total_yuanbao": result.get("total_yuanbao"),
                },
            )
    except Exception as exc:
        alipay_log("execute_deferred", out_trade_no=out_trade_no, error=str(exc))


async def handle_alipay_notify_settlement(
    *,
    out_trade_no: str,
    trade_no: str,
    total_amount: str | float,
) -> dict[str, Any]:
    """验签通过后：入队 nx_pending_settlement(queued)，立即 ack；异步尝试 FC 执行。"""
    out_trade_no = (out_trade_no or "").strip()
    trade_no = (trade_no or "").strip()
    if not out_trade_no:
        raise ValueError("OUT_TRADE_NO_REQUIRED")

    alipay_log("notify_settlement_start", out_trade_no=out_trade_no, trade_no=trade_no or None)

    result = await settle_alipay_order(
        out_trade_no=out_trade_no,
        trade_no=trade_no,
        total_amount=total_amount,
    )

    should_ack = bool(
        result.get("should_ack_success")
        or result.get("already_paid")
        or result.get("already_processing")
        or result.get("enqueued")
        or result.get("settled")
    )

    if result.get("enqueued"):
        await publish(
            out_trade_no,
            {
                "event": "settlement-queued",
                "user_id": result.get("user_id"),
                "settlement_status": result.get("settlement_status", "queued"),
            },
        )
        asyncio.create_task(_try_execute_and_push(out_trade_no))
    elif result.get("settled") or result.get("already_paid"):
        await publish(
            out_trade_no,
            {
                "event": "recharge-settled",
                "balance": result.get("balance"),
                "user_id": result.get("user_id") or (result.get("order") or {}).get("user_id"),
            },
        )

    result["should_ack_success"] = should_ack
    return result


async def fetch_order_status(out_trade_no: str) -> dict[str, Any]:
    return await get_order_status(out_trade_no)


async def run_retry_compensation(max_items: int = 20) -> dict[str, Any]:
    alipay_log("retry_worker_tick", max_items=max_items)
    result = await process_retry_queue(max_items=max_items)
    for row in result.get("details") or []:
        if row.get("ok") and row.get("event") == "recharge-settled":
            await publish(
                str(row.get("out_trade_no") or ""),
                {
                    "event": "recharge-settled",
                    "balance": row.get("balance"),
                    "user_id": row.get("user_id"),
                },
            )
    return result
