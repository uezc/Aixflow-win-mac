"""
AIXFLOW 支付宝电脑网站支付（alipay.trade.page.pay）联调测试路由。

密钥只通过环境变量注入，禁止在代码中硬编码。
- 本地开发：复制 `.env.example` 为 `.env`（已在 .gitignore 中忽略）
- 云端部署：阿里云 FC / ECS 控制台环境变量或凭据管家，不落盘、不进 Git

环境变量（必填）：
  ALIPAY_APP_ID
  ALIPAY_APP_PRIVATE_KEY     单行 PEM，换行写 \\n
  ALIPAY_PUBLIC_KEY
  ALIPAY_NOTIFY_URL          公网 HTTPS 异步通知地址

可选：
  ALIPAY_RETURN_URL          同步跳转（默认 http://127.0.0.1:8000/）
  ALIPAY_DEBUG=true          沙箱网关

独立启动：
  cd backend && python -m uvicorn alipay_test:app --reload --port 8000
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, Query, Request
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field

try:
    from alipay import AliPay
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "缺少 python-alipay-sdk，请执行: pip install python-alipay-sdk"
    ) from exc

_BACKEND_DIR = Path(__file__).resolve().parent
# 本地 .env；生产环境由 WorkingDirectory 下 .env 注入（勿用 systemd EnvironmentFile 加载 PEM，会截断密钥）
load_dotenv(_BACKEND_DIR / ".env", override=True)

router = APIRouter(prefix="/api/v1/alipay", tags=["alipay-test"])

_GATEWAY_PROD = "https://openapi.alipay.com/gateway.do"
_GATEWAY_SANDBOX = "https://openapi.alipaydev.com/gateway.do"

# 与 pricing/recharge_packages.mjs 保持一致（基础元宝 + 套餐固定赠送）
RECHARGE_PACKAGES: list[dict[str, Any]] = [
    {"id": "starter", "label": "入门包", "price_cny": 50, "base_yuanbao": 500},
    {"id": "popular", "label": "标准包", "price_cny": 100, "base_yuanbao": 1000, "bonus_yuanbao": 50, "tag": "most_popular"},
    {"id": "value", "label": "进阶包", "price_cny": 300, "base_yuanbao": 3000, "bonus_yuanbao": 300, "tag": "best_value"},
    {"id": "premium", "label": "尊享包", "price_cny": 1000, "base_yuanbao": 10000, "bonus_yuanbao": 1500, "tag": "max_discount"},
]


class CreateOrderBody(BaseModel):
    package_id: str = Field(..., description="starter|popular|value|premium")
    user_id: str = Field(..., description="Tablestore user_id")
    access_token: str = Field(..., description="用户 JWT，用于校验 user_id")


def _find_package(package_id: str) -> dict[str, Any] | None:
    pid = (package_id or "").strip()
    for p in RECHARGE_PACKAGES:
        if p["id"] == pid:
            return p
    return None


def _build_page_pay(amount: str, subject: str, out_trade_no: str) -> str:
    alipay = build_alipay_client()
    return_url = _env("ALIPAY_RETURN_URL", "http://127.0.0.1:8000/")
    notify_url = _require_env("ALIPAY_NOTIFY_URL")
    order_string = alipay.api_alipay_trade_page_pay(
        out_trade_no=out_trade_no,
        total_amount=amount,
        subject=subject,
        return_url=return_url,
        notify_url=notify_url,
    )
    return f"{_gateway_url()}?{order_string}"


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def _load_pem(env_name: str) -> str:
    """
    从环境变量读取 PEM。
    支持：单行 \\n 转义、首尾引号、支付宝控制台纯 Base64（自动补 BEGIN/END）。
    """
    from pem_utils import normalize_private_key, normalize_public_key

    raw = _env(env_name)
    if not raw:
        raise RuntimeError(f"环境变量 {env_name} 未设置")
    if env_name == "ALIPAY_APP_PRIVATE_KEY":
        return normalize_private_key(raw)
    if env_name == "ALIPAY_PUBLIC_KEY":
        return normalize_public_key(raw)
    pem = raw.strip().strip('"').strip("'")
    return pem.replace("\\n", "\n")


def _require_env(name: str) -> str:
    value = _env(name)
    if not value:
        raise RuntimeError(f"环境变量 {name} 未设置")
    return value


def _safe_log(message: str) -> None:
    """Windows 控制台可能是 GBK，避免 emoji 导致 notify 处理崩溃。"""
    try:
        print(message)
    except UnicodeEncodeError:
        print(message.encode("ascii", errors="replace").decode("ascii"))


def _warn_notify_url_config() -> None:
    """启动时检查 notify 是否可被支付宝公网访问。"""
    notify = _env("ALIPAY_NOTIFY_URL")
    if not notify:
        _safe_log("[alipay] 警告: ALIPAY_NOTIFY_URL 未设置")
        return
    lowered = notify.lower()
    if "localhost" in lowered or "127.0.0.1" in lowered or "0.0.0.0" in lowered:
        _safe_log(
            "[alipay] WARN: ALIPAY_NOTIFY_URL 含 localhost/127.0.0.1。\n"
            "       支付宝在公网无法回调本机；请用 HTTPS 域名或 cpolar 穿透到 :8000。\n"
            "       仍可打开 pay_url 付款，但终端里不会出现 notify 日志。"
        )
    elif not notify.startswith("https://"):
        _safe_log("[alipay] WARN: ALIPAY_NOTIFY_URL 建议使用 https://（正式环境必填）")


def build_alipay_client() -> AliPay:
    debug = _env("ALIPAY_DEBUG", "false").lower() in ("1", "true", "yes")
    notify_url = _require_env("ALIPAY_NOTIFY_URL")

    return AliPay(
        appid=_require_env("ALIPAY_APP_ID"),
        app_notify_url=notify_url,
        app_private_key_string=_load_pem("ALIPAY_APP_PRIVATE_KEY"),
        alipay_public_key_string=_load_pem("ALIPAY_PUBLIC_KEY"),
        sign_type="RSA2",
        debug=debug,
    )


def _gateway_url() -> str:
    debug = _env("ALIPAY_DEBUG", "false").lower() in ("1", "true", "yes")
    return _GATEWAY_SANDBOX if debug else _GATEWAY_PROD


def _print_notify_payload(label: str, payload: Any) -> None:
    _safe_log(f"[alipay notify] {label}: {payload!r}")


@router.get("/packages")
async def list_packages() -> JSONResponse:
    """充值套餐列表（供客户端展示）。"""
    return JSONResponse({"packages": RECHARGE_PACKAGES, "yuanbao_per_cny": 10})


@router.post("/create_order")
async def create_order(body: CreateOrderBody) -> JSONResponse:
    """按套餐创建支付宝电脑网站支付订单，并在 FC nx_orders 写入 pending。"""
    from alipay_logger import alipay_log
    from fc_client import create_alipay_order_record, verify_user_access_token

    pkg = _find_package(body.package_id)
    if not pkg:
        return JSONResponse({"error": "INVALID_PACKAGE"}, status_code=400)

    user_id = (body.user_id or "").strip()
    if not user_id:
        return JSONResponse({"error": "USER_ID_REQUIRED"}, status_code=400)

    try:
        me = await verify_user_access_token(body.access_token)
    except ValueError as exc:
        code = str(exc)
        status = 401 if code in ("ACCESS_TOKEN_REQUIRED", "USER_NOT_LOGGED_IN") else 400
        return JSONResponse({"error": code}, status_code=status)
    except Exception as exc:
        alipay_log("order_create_verify_fail", user_id=user_id, error=str(exc))
        return JSONResponse({"error": "FC_VERIFY_FAILED", "message": str(exc)}, status_code=502)

    me_user_id = str(me.get("user_id") or me.get("userId") or "").strip()
    if me_user_id != user_id:
        return JSONResponse({"error": "USER_ID_MISMATCH"}, status_code=403)

    amount = f"{float(pkg['price_cny']):.2f}".rstrip("0").rstrip(".")
    out_trade_no = f"AIXFLOW-{body.package_id.upper()}-{uuid.uuid4().hex[:12].upper()}"
    total_yuanbao = int(pkg["base_yuanbao"]) + int(pkg.get("bonus_yuanbao") or 0)

    try:
        await create_alipay_order_record(
            user_id=user_id,
            package_id=pkg["id"],
            out_trade_no=out_trade_no,
            amount_cny=float(pkg["price_cny"]),
            package_yuanbao=total_yuanbao,
        )
        alipay_log("order_created", user_id=user_id, out_trade_no=out_trade_no, package_id=pkg["id"])
    except Exception as exc:
        alipay_log("order_create_fc_fail", user_id=user_id, out_trade_no=out_trade_no, error=str(exc))
        return JSONResponse({"error": "ORDER_CREATE_FAILED", "message": str(exc)}, status_code=502)

    subject = f"AIXFLOW元宝充值·{pkg['label']}"
    pay_url = _build_page_pay(amount, subject, out_trade_no)
    return JSONResponse(
        {
            "package_id": pkg["id"],
            "out_trade_no": out_trade_no,
            "total_amount": amount,
            "package_yuanbao": total_yuanbao,
            "subject": subject,
            "pay_url": pay_url,
            "user_id": user_id,
        }
    )


@router.get("/order-status/{out_trade_no}")
async def order_status(out_trade_no: str) -> JSONResponse:
    """客户端轮询订单状态（paid 时返回 balance）。"""
    from alipay_settlement_service import fetch_order_status

    key = (out_trade_no or "").strip()
    if not key:
        return JSONResponse({"error": "OUT_TRADE_NO_REQUIRED"}, status_code=400)
    try:
        data = await fetch_order_status(key)
        if data.get("error") == "ORDER_NOT_FOUND":
            return JSONResponse(data, status_code=404)
        return JSONResponse(data)
    except Exception as exc:
        return JSONResponse({"error": "ORDER_STATUS_FAILED", "message": str(exc)}, status_code=502)


@router.get("/events/stream")
async def alipay_events_stream(out_trade_no: str = Query(..., alias="out_trade_no")) -> StreamingResponse:
    """SSE：settlement-queued / recharge-settled 事件（客户端优先监听）。"""
    import asyncio

    from sse_hub import format_sse, subscribe, unsubscribe

    key = (out_trade_no or "").strip()
    if not key:
        return JSONResponse({"error": "OUT_TRADE_NO_REQUIRED"}, status_code=400)

    queue = subscribe(key)

    async def event_generator():
        try:
            yield format_sse({"event": "connected", "out_trade_no": key})
            while True:
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=25.0)
                    yield format_sse(msg)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            unsubscribe(key, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/test_pay")
async def test_pay() -> JSONResponse:
    """生成 0.01 元联调订单，返回电脑网站支付跳转 URL（无需数据库）。"""
    out_trade_no = f"AIXFLOW-TEST-{uuid.uuid4().hex[:16].upper()}"
    pay_url = _build_page_pay("0.01", "AIXFLOW联调测试", out_trade_no)

    return JSONResponse(
        {
            "out_trade_no": out_trade_no,
            "total_amount": "0.01",
            "subject": "AIXFLOW联调测试",
            "pay_url": pay_url,
        }
    )


@router.post("/notify")
async def alipay_notify(request: Request) -> PlainTextResponse:
    """支付宝异步通知：验签 → settlement service → success/failure。"""
    from alipay_logger import alipay_log
    from alipay_settlement_service import handle_alipay_notify_settlement

    raw_body = (await request.body()).decode("utf-8", errors="replace")
    alipay_log("notify_received", body_len=len(raw_body))

    form = await request.form()
    data: dict[str, str] = {k: str(v) for k, v in form.items()}
    sign = data.pop("sign", None)
    out_trade_no = (data.get("out_trade_no") or "").strip()
    alipay_log("notify_parsed", out_trade_no=out_trade_no or None, trade_status=data.get("trade_status"))

    alipay = build_alipay_client()
    verified = False
    verify_error: str | None = None

    try:
        if not sign:
            verify_error = "missing sign"
        else:
            verified = alipay.verify(dict(data), sign)
    except Exception as exc:  # pragma: no cover
        verify_error = str(exc)

    trade_status = data.get("trade_status", "")
    alipay_log(
        "signature_verified" if verified else "signature_failed",
        out_trade_no=out_trade_no or None,
        trade_status=trade_status,
        error=verify_error,
    )

    if not verified:
        return PlainTextResponse("failure")

    if trade_status not in ("TRADE_SUCCESS", "TRADE_FINISHED"):
        return PlainTextResponse("failure")

    trade_no = (data.get("trade_no") or "").strip()
    total_amount = (data.get("total_amount") or "").strip()

    if not out_trade_no:
        alipay_log("notify_missing_out_trade_no")
        return PlainTextResponse("failure")

    try:
        result = await handle_alipay_notify_settlement(
            out_trade_no=out_trade_no,
            trade_no=trade_no,
            total_amount=total_amount,
        )
        if result.get("should_ack_success"):
            return PlainTextResponse("success")
        return PlainTextResponse("failure")
    except Exception as exc:
        alipay_log("notify_settlement_fail", out_trade_no=out_trade_no, error=str(exc))
        return PlainTextResponse("failure")


app = FastAPI(title="AIXFLOW Alipay Test")
app.include_router(router)


@app.get("/")
async def alipay_sync_return(request: Request) -> PlainTextResponse:
    """支付宝同步 return_url 跳转（异步 notify 才是入账依据）。"""
    trade_status = (request.query_params.get("trade_status") or "").strip()
    out_trade_no = (request.query_params.get("out_trade_no") or "").strip()
    if trade_status in ("TRADE_SUCCESS", "TRADE_FINISHED"):
        return PlainTextResponse(
            f"支付成功，元宝将自动到账。\n订单号：{out_trade_no or '—'}\n请返回 Aixflow 客户端查看余额。",
            media_type="text/plain; charset=utf-8",
        )
    return PlainTextResponse("支付处理中，请返回 Aixflow 客户端查看余额。", media_type="text/plain; charset=utf-8")


@app.on_event("startup")
async def _alipay_startup_checks() -> None:
    _warn_notify_url_config()
    try:
        from retry_scheduler import start_background_retry

        start_background_retry()
    except Exception as exc:
        _safe_log(f"[alipay] retry worker not started: {exc!r}")
