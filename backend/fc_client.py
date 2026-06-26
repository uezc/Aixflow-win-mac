"""AIXFLOW 支付服务 → 阿里云 FC（订单创建 / notify 入账）。"""

from __future__ import annotations

import os
from typing import Any

import httpx

_TIMEOUT = 20.0


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def fc_base_url() -> str:
    raw = _env("HK_FC_ENDPOINT") or _env("ALIYUN_FC_INIT_USER_URL") or _env("ALIYUN_FC_ENDPOINT")
    if not raw:
        raise RuntimeError("未配置 HK_FC_ENDPOINT 或 ALIYUN_FC_INIT_USER_URL")
    base = raw.rstrip("/")
    for suffix in ("/init-user", "/run-task"):
        if base.endswith(suffix):
            base = base[: -len(suffix)]
    return base.rstrip("/")


def _fc_token() -> str:
    token = _env("ALIYUN_FC_TOKEN") or _env("API_SECRET_TOKEN")
    if not token:
        raise RuntimeError("未配置 ALIYUN_FC_TOKEN（须与 FC API_SECRET_TOKEN 一致）")
    return token


def _pay_secret() -> str:
    secret = _env("NX_ALIPAY_PAY_SECRET") or _env("NX_ADMIN_ISSUE_COUPON_SECRET")
    if not secret:
        raise RuntimeError("未配置 NX_ALIPAY_PAY_SECRET")
    return secret


def _service_headers() -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "x-nexflow-token": _fc_token(),
        "x-alipay-pay-secret": _pay_secret(),
    }


async def verify_user_access_token(access_token: str) -> dict[str, Any]:
    """校验 JWT 并返回 /me 用户信息。"""
    token = (access_token or "").strip()
    if not token:
        raise ValueError("ACCESS_TOKEN_REQUIRED")
    url = f"{fc_base_url()}/me"
    headers = {**_service_headers(), "Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(url, headers=headers, json={})
        if resp.status_code == 401:
            raise ValueError("USER_NOT_LOGGED_IN")
        resp.raise_for_status()
        data = resp.json()
        if not isinstance(data, dict):
            raise ValueError("INVALID_ME_RESPONSE")
        return data


async def create_alipay_order_record(
    *,
    user_id: str,
    package_id: str,
    out_trade_no: str,
    amount_cny: float,
    package_yuanbao: int,
) -> dict[str, Any]:
    url = f"{fc_base_url()}/internal/alipay-create-order"
    payload = {
        "user_id": user_id,
        "package_id": package_id,
        "out_trade_no": out_trade_no,
        "amount_cny": amount_cny,
        "package_yuanbao": package_yuanbao,
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(url, headers=_service_headers(), json=payload)
        if resp.status_code >= 400:
            detail = resp.text[:500]
            raise RuntimeError(f"FC create order failed ({resp.status_code}): {detail}")
        return resp.json()


async def settle_alipay_order(
    *,
    out_trade_no: str,
    trade_no: str,
    total_amount: str | float,
) -> dict[str, Any]:
    url = f"{fc_base_url()}/internal/alipay-notify-settle"
    payload = {
        "out_trade_no": out_trade_no,
        "trade_no": trade_no,
        "total_amount": total_amount,
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(url, headers=_service_headers(), json=payload)
        if resp.status_code >= 400:
            detail = resp.text[:500]
            raise RuntimeError(f"FC settle failed ({resp.status_code}): {detail}")
        return resp.json()


async def get_order_status(out_trade_no: str) -> dict[str, Any]:
    url = f"{fc_base_url()}/internal/alipay-order-status"
    payload = {"out_trade_no": out_trade_no}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(url, headers=_service_headers(), json=payload)
        if resp.status_code == 404:
            return {"error": "ORDER_NOT_FOUND", "out_trade_no": out_trade_no}
        if resp.status_code >= 400:
            detail = resp.text[:500]
            raise RuntimeError(f"FC order status failed ({resp.status_code}): {detail}")
        return resp.json()


async def process_retry_queue(*, max_items: int = 20) -> dict[str, Any]:
    url = f"{fc_base_url()}/internal/alipay-retry-process"
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            url,
            headers=_service_headers(),
            json={"max_items": max_items},
        )
        if resp.status_code >= 400:
            detail = resp.text[:500]
            raise RuntimeError(f"FC retry process failed ({resp.status_code}): {detail}")
        return resp.json()


async def execute_pending_settlement(out_trade_no: str) -> dict[str, Any]:
    url = f"{fc_base_url()}/internal/alipay-execute-pending"
    payload = {"out_trade_no": out_trade_no}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(url, headers=_service_headers(), json=payload)
        if resp.status_code >= 400:
            detail = resp.text[:500]
            raise RuntimeError(f"FC execute pending failed ({resp.status_code}): {detail}")
        return resp.json()


async def run_consistency_check(*, max_scan: int = 200) -> dict[str, Any]:
    url = f"{fc_base_url()}/internal/check-balance-consistency"
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(url, headers=_service_headers(), json={"max_scan": max_scan})
        resp.raise_for_status()
        return resp.json()
