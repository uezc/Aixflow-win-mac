#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AIXflow 私人模型管理后台（Streamlit + 阿里云 Tablestore）

运行（务必在本目录启动，以便加载同目录下 .streamlit/secrets.toml）:

【推荐 · Windows 客户端式启动】双击同目录「启动模型管理后台.bat」；
  可选内嵌窗口：先 pip install -r requirements-desktop.txt（依赖 pywebview）。

【独立便携包 · 类似绿色软件】在本机执行 tools/aixflow_model_admin/scripts/build_portable.bat，
  产物在 dist_portable/NEXFLOW-Model-Admin/：内含 Python 运行时，目标电脑无需安装 Python；
  双击其中 START-with-console.bat 启动（详见 docs/BUILD.md）。

【命令行】
  cd tools/aixflow_model_admin
  pip install -r requirements.txt
  python launch_desktop.py
  # 或仅浏览器：python -m streamlit run app.py

默认桌面启动使用端口 9510（可用环境变量 NEXFLOW_ADMIN_PORT 修改）。
Windows 若提示找不到 streamlit 命令，请使用「python -m streamlit」。

配置优先级（访问密码、OTS AK、算力接口）:
  1) st.secrets（推荐：本目录 .streamlit/secrets.toml）
  2) 环境变量 AIXFLOW_ADMIN_PASSWORD / ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET；
     核心算力：platform_api_base、platform_api_token；
     插件算力：plugin_api_base、plugin_api_token
  3) 侧栏「保存凭据到本地」：写入 .local/aixflow_credentials.enc（PBKDF2+Fernet，密钥为访问密码；勿提交 Git）

若 secrets 中已配置完整 AK/SK，登录后会自动拉取 Tablestore，无需再在侧边栏填写。
兑换码「按用户查询」依赖 **nx_email_user**（邮箱→user_id）与 **nx_users**，表名可通过 `OTS_TABLE_EMAIL` / `OTS_TABLE_USERS` 或 secrets 对齐 FC。
"""

from __future__ import annotations

import csv
import io
import json
import os
import secrets as secrets_std
from urllib import error as urlerror
from urllib import request as urlrequest
from urllib.parse import urlparse
from typing import Any

import pandas as pd
import streamlit as st

from credential_store import (
    credential_file_path,
    decrypt_credentials,
    delete_credential_file,
    encrypt_credentials,
    read_credential_file,
    write_credential_file,
)

# ---------------------------------------------------------------------------
# 默认连接（与仓库内 sync_to_tablestore.py 对齐，可在侧边栏覆盖）
# ---------------------------------------------------------------------------
DEFAULT_OTS_ENDPOINT = "https://nexflow-db.cn-hongkong.ots.aliyuncs.com"
DEFAULT_OTS_INSTANCE = "nexflow-db"
DEFAULT_TABLE_NAME = "nx_model_config"
DEFAULT_COUPONS_TABLE = "nx_coupons"
DEFAULT_OTS_TX_TABLE = "nx_transactions"
DEFAULT_OTS_TX_GSI = "idx_user_id"
DEFAULT_OTS_TX_PK = "transaction_id"
DEFAULT_OTS_EMAIL_TABLE = "nx_email_user"
DEFAULT_OTS_USERS_TABLE = "nx_users"
DEFAULT_OTS_TASKS_TABLE = "nx_tasks"
DEFAULT_OTS_QUEUE_COUNTERS_TABLE = "nx_queue_counters"
DEFAULT_PLATFORM_API_BASE = "https://api.apilio.ai"
DEFAULT_PLUGIN_API_BASE = "https://www.runninghub.cn"

# 与 FC demo/aliyun-fc-init-user RECHARGE_TIERS_CNY 一致
COUPON_TIERS_CNY: tuple[int, ...] = (30, 50, 100, 200, 500)
_COUPON_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

# 表格展示用中文列名（底层 Tablestore 字段名仍为英文）
_COL_ZH = {
    "model_id": "模型 ID（主键）",
    "function_name": "功能名称",
    "is_active": "启用",
    "base_price": "基准价",
    "multiplier": "倍率",
    "yuanbao_rate": "元宝折算率",
}


def _get_secret(key: str, default: str = "") -> str:
    """仅从 Streamlit secrets.toml 读取（启动 cwd 下 .streamlit/secrets.toml）。"""
    try:
        v = st.secrets.get(key, default)
        return str(v).strip() if v is not None else default
    except Exception:
        return default


def admin_password_expected() -> str:
    """优先 secrets，其次环境变量。"""
    s = _get_secret("admin_password", "")
    if s:
        return s
    return os.environ.get("AIXFLOW_ADMIN_PASSWORD", "").strip()


def get_ots_access_key_id() -> str:
    """优先 st.secrets，其次环境变量。"""
    s = _get_secret("ots_access_key_id", "")
    if s:
        return s
    return os.environ.get("ALIYUN_ACCESS_KEY_ID", "").strip()


def get_ots_access_key_secret() -> str:
    """优先 st.secrets，其次环境变量。"""
    s = _get_secret("ots_access_key_secret", "")
    if s:
        return s
    return os.environ.get("ALIYUN_ACCESS_KEY_SECRET", "").strip()


def _load_repo_dotenv_once() -> None:
    """从仓库根 .env 补齐 RESEND_*（不覆盖已有环境变量）。仅本机管理后台用。"""
    if os.environ.get("_AIXFLOW_ADMIN_DOTENV_LOADED") == "1":
        return
    os.environ["_AIXFLOW_ADMIN_DOTENV_LOADED"] = "1"
    try:
        root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        env_path = os.path.join(root, ".env")
        if not os.path.isfile(env_path):
            return
        with open(env_path, "r", encoding="utf-8") as f:
            text = f.read()
        if text.startswith("\ufeff"):
            text = text[1:]
        for line in text.splitlines():
            if not line or line.strip().startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            v = v.strip()
            if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                v = v[1:-1]
            if not k:
                continue
            if k.startswith("RESEND_") and not os.environ.get(k):
                os.environ[k] = v
    except Exception:
        pass


def get_resend_api_key() -> str:
    _load_repo_dotenv_once()
    s = _get_secret("resend_api_key", "")
    if s:
        return s
    return os.environ.get("RESEND_API_KEY", "").strip()


def get_resend_from_email() -> str:
    _load_repo_dotenv_once()
    s = _get_secret("resend_from_email", "")
    if s:
        return s
    env = os.environ.get("RESEND_FROM_EMAIL", "").strip()
    return env or "AIXFLOW <auth@aixflow.ai>"


def send_official_resend_email(
    *,
    to_email: str,
    subject: str,
    body_text: str,
    body_html: str | None = None,
    from_email: str | None = None,
) -> dict[str, Any]:
    """
    以 AIXFLOW 官方身份经 Resend 发信。
    成功返回 {ok: True, id: ...}；失败返回 {ok: False, error: ...}。
    """
    api_key = get_resend_api_key()
    if not api_key:
        return {"ok": False, "error": "未配置 RESEND_API_KEY（secrets 或仓库 .env）"}
    to_addr = str(to_email or "").strip()
    if not to_addr or "@" not in to_addr:
        return {"ok": False, "error": "收件人邮箱无效"}
    subj = str(subject or "").strip()
    if not subj:
        return {"ok": False, "error": "主题不能为空"}
    text = str(body_text or "").strip()
    if not text:
        return {"ok": False, "error": "正文不能为空"}
    frm = str(from_email or get_resend_from_email()).strip() or "AIXFLOW <auth@aixflow.ai>"

    html = body_html
    if not html:
        # 简单把换行转成段落，深色品牌风
        paras = "".join(
            f'<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#d1d5db;">{p}</p>'
            for p in text.replace("\r\n", "\n").split("\n\n")
            if p.strip()
        )
        if not paras:
            paras = f'<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#d1d5db;">{text}</p>'
        html = (
            "<!DOCTYPE html><html><head><meta charset=\"utf-8\" /></head>"
            '<body style="margin:0;padding:0;background:#0b0f14;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;">'
            '<div style="max-width:560px;margin:40px auto;padding:32px 28px;background:#121820;border-radius:12px;color:#e5e7eb;">'
            '<p style="margin:0 0 8px;font-size:13px;letter-spacing:0.12em;color:#9ca3af;">AIXFLOW</p>'
            f"{paras}"
            '<p style="margin:24px 0 0;font-size:13px;color:#6b7280;">— AIXFLOW 团队</p>'
            "</div></body></html>"
        )

    payload = json.dumps(
        {
            "from": frm,
            "to": [to_addr],
            "subject": subj,
            "text": text,
            "html": html,
        },
        ensure_ascii=False,
    ).encode("utf-8")
    req = urlrequest.Request(
        "https://api.resend.com/emails",
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            # Cloudflare 会拦截 Python-urllib 默认 UA，表现为 HTTP 403 error code: 1010
            "User-Agent": "AixflowAdmin/1.0 (+https://aixflow.ai; Resend)",
        },
    )
    try:
        with urlrequest.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            data = json.loads(raw) if raw else {}
            return {"ok": True, "id": data.get("id"), "from": frm, "to": to_addr}
    except urlerror.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace") if e.fp else ""
        hint = ""
        if e.code == 403 and "1010" in (err_body or ""):
            hint = "（疑似 Cloudflare 拦截请求；已设置 User-Agent，请再试一次）"
        return {"ok": False, "error": f"HTTP {e.code}: {err_body or e.reason}{hint}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def get_ots_coupons_table_default() -> str:
    s = _get_secret("ots_table_coupons", "")
    if s:
        return s.strip()
    return os.environ.get("OTS_TABLE_COUPONS", DEFAULT_COUPONS_TABLE).strip() or DEFAULT_COUPONS_TABLE


def get_ots_transactions_table_default() -> str:
    """nx_transactions，与 FC 环境变量 OTS_TABLE_TRANSACTIONS 一致。"""
    s = _get_secret("ots_table_transactions", "")
    if s:
        return s.strip()
    return os.environ.get("OTS_TABLE_TRANSACTIONS", DEFAULT_OTS_TX_TABLE).strip() or DEFAULT_OTS_TX_TABLE


def get_ots_tx_gsi_name_default() -> str:
    """按 user_id 查流水的全局二级索引名，与 OTS_TX_GSI_NAME 一致。"""
    s = _get_secret("ots_tx_gsi_name", "")
    if s:
        return s.strip()
    return os.environ.get("OTS_TX_GSI_NAME", DEFAULT_OTS_TX_GSI).strip() or DEFAULT_OTS_TX_GSI


def get_ots_tx_sort_key_default() -> str:
    """索引第二列 / 流水主键列名，通常与 OTS_TRANSACTIONS_PK 一致。"""
    s = _get_secret("ots_transactions_pk", "")
    if s:
        return s.strip()
    sk = os.environ.get("OTS_TX_GSI_SORT_KEY", "").strip()
    if sk:
        return sk
    return os.environ.get("OTS_TRANSACTIONS_PK", DEFAULT_OTS_TX_PK).strip() or DEFAULT_OTS_TX_PK


def get_ots_email_table_default() -> str:
    """邮箱 → user_id 映射表，与 OTS_TABLE_EMAIL 一致。"""
    s = _get_secret("ots_table_email", "")
    if s:
        return s.strip()
    return os.environ.get("OTS_TABLE_EMAIL", DEFAULT_OTS_EMAIL_TABLE).strip() or DEFAULT_OTS_EMAIL_TABLE


def get_ots_users_table_default() -> str:
    """用户主表，与 OTS_TABLE_USERS 一致。"""
    s = _get_secret("ots_table_users", "")
    if s:
        return s.strip()
    return os.environ.get("OTS_TABLE_USERS", DEFAULT_OTS_USERS_TABLE).strip() or DEFAULT_OTS_USERS_TABLE


def get_ots_tasks_table_default() -> str:
    """任务表 nx_tasks，与 OTS_TABLE_TASKS 一致。"""
    s = _get_secret("ots_table_tasks", "")
    if s:
        return s.strip()
    return os.environ.get("OTS_TABLE_TASKS", DEFAULT_OTS_TASKS_TABLE).strip() or DEFAULT_OTS_TASKS_TABLE


def get_ots_queue_counters_table_default() -> str:
    """平台并发计数表，与 OTS_TABLE_QUEUE_COUNTERS / nx_queue_counters 一致。"""
    s = _get_secret("ots_table_queue_counters", "")
    if s:
        return s.strip()
    return (
        os.environ.get("OTS_TABLE_QUEUE_COUNTERS", DEFAULT_OTS_QUEUE_COUNTERS_TABLE).strip()
        or DEFAULT_OTS_QUEUE_COUNTERS_TABLE
    )

def get_platform_api_base_default() -> str:
    s = _get_secret("platform_api_base", "")
    if s:
        return s.strip()
    return os.environ.get("AIXFLOW_PLATFORM_API_BASE", DEFAULT_PLATFORM_API_BASE).strip() or DEFAULT_PLATFORM_API_BASE


def get_platform_api_token_default() -> str:
    s = _get_secret("platform_api_token", "")
    if s:
        return s.strip()
    return os.environ.get("AIXFLOW_PLATFORM_API_TOKEN", "").strip()


def get_plugin_api_base_default() -> str:
    s = _get_secret("plugin_api_base", "")
    if s:
        return s.strip()
    return os.environ.get("AIXFLOW_PLUGIN_API_BASE", DEFAULT_PLUGIN_API_BASE).strip() or DEFAULT_PLUGIN_API_BASE


def get_plugin_api_token_default() -> str:
    s = _get_secret("plugin_api_token", "")
    if s:
        return s.strip()
    return os.environ.get("AIXFLOW_PLUGIN_API_TOKEN", "").strip()


def _defaults_map() -> dict[str, str]:
    """侧边栏各字段默认值（secrets / 环境变量 / 常量）。"""
    return {
        "endpoint": DEFAULT_OTS_ENDPOINT,
        "instance": DEFAULT_OTS_INSTANCE,
        "table_name": DEFAULT_TABLE_NAME,
        "coupons_table": get_ots_coupons_table_default(),
        "ots_ak": get_ots_access_key_id(),
        "ots_sk": get_ots_access_key_secret(),
        "core_base": get_platform_api_base_default(),
        "core_key": get_platform_api_token_default(),
        "plugin_base": get_plugin_api_base_default(),
        "plugin_key": get_plugin_api_token_default(),
    }


def _field_key(name: str) -> str:
    return f"fld_{name}"


def init_vault_session_state() -> None:
    """
    登录成功后：从本地加密文件解密并写入 st.session_state[fld_*]；
    加密密钥为当前会话中的访问密码（与进入后台时输入的一致）。
    """
    if st.session_state.get("_vault_seeded"):
        return
    st.session_state["_vault_seeded"] = True
    st.session_state.pop("_vault_decrypt_failed", None)
    pw = (st.session_state.get("_vault_pw") or "").strip()
    dm = _defaults_map()
    blob = read_credential_file()
    if blob and pw:
        try:
            data = decrypt_credentials(pw, blob)
            if isinstance(data, dict):
                for k in dm:
                    v = data.get(k)
                    if v is not None and str(v).strip() != "":
                        st.session_state[_field_key(k)] = str(v).strip()
        except Exception:
            st.session_state["_vault_decrypt_failed"] = True
    for k, d in dm.items():
        fk = _field_key(k)
        if fk not in st.session_state:
            st.session_state[fk] = d


def _collect_fields_for_save() -> dict[str, str]:
    keys = [
        "endpoint",
        "instance",
        "table_name",
        "coupons_table",
        "ots_ak",
        "ots_sk",
        "core_base",
        "core_key",
        "plugin_base",
        "plugin_key",
    ]
    return {k: str(st.session_state.get(_field_key(k), "") or "").strip() for k in keys}


def clear_vault_ui_keys() -> None:
    for k in list(st.session_state.keys()):
        if k.startswith("fld_"):
            del st.session_state[k]


def resolve_token_quota_url(user_base: str) -> str:
    """
    拼出 GET /v1/token/quota 的完整 URL。
    若用户已填完整地址（含 /v1/token/quota），不再重复拼接，避免出现 …/quota/v1/token/quota。
    """
    s = str(user_base or "").strip()
    if not s:
        return ""
    s = s.rstrip("/")
    low = s.lower()
    if low.endswith("/v1/token/quota"):
        return s
    return f"{s}/v1/token/quota"


def _host_header_for_plugin_api(api_base: str) -> str:
    """与 OpenAPI 示例一致，默认 www.runninghub.cn；若 URL 含域名则使用该域名。"""
    s = str(api_base or "").strip()
    if not s:
        return "www.runninghub.cn"
    if "://" not in s:
        s = "https://" + s
    try:
        h = urlparse(s).hostname
        if h:
            return h
    except Exception:
        pass
    return "www.runninghub.cn"


def resolve_account_status_url(user_base: str) -> str:
    """
    POST /uc/openapi/accountStatus 完整 URL。
    若已粘贴含该路径的完整地址，不再重复拼接。
    """
    s = str(user_base or "").strip()
    if not s:
        return ""
    s = s.rstrip("/")
    low = s.lower()
    if low.endswith("/uc/openapi/accountstatus"):
        return s
    return f"{s}/uc/openapi/accountStatus"


def _parse_token_quota_payload(data: Any) -> tuple[float | None, str | None, dict[str, Any] | None]:
    """
    解析 GET /v1/token/quota 返回：{ id, name, quota }。
    兼容外层包一层 data / result，或返回列表取第一条。
    """
    if data is None:
        return None, None, None
    if isinstance(data, list) and data:
        data = data[0]
    if not isinstance(data, dict):
        return None, None, None
    obj: dict[str, Any] = data
    if "quota" not in obj and isinstance(data.get("data"), dict):
        obj = data["data"]
    elif "quota" not in obj and isinstance(data.get("result"), dict):
        obj = data["result"]
    q = obj.get("quota")
    name = obj.get("name")
    token_name = str(name).strip() if name is not None and str(name).strip() else None
    if q is None:
        return None, token_name, data
    try:
        return float(q), token_name, data
    except (TypeError, ValueError):
        return None, token_name, data


def fetch_token_quota(api_base: str, token: str) -> dict[str, Any]:
    """GET /v1/token/quota，Header: Authorization: Bearer <API_KEY>"""
    tk = str(token or "").strip()
    url = resolve_token_quota_url(api_base)
    if not url or not tk:
        return {
            "ok": False,
            "quota": None,
            "token_name": None,
            "raw": None,
            "error": "请填写核心算力 API URL 与 API Key",
        }
    req = urlrequest.Request(
        url=url,
        method="GET",
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {tk}",
        },
    )
    try:
        with urlrequest.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8", errors="ignore")
            parsed = json.loads(raw) if raw else {}
            quota, token_name, raw_dict = _parse_token_quota_payload(parsed)
            if quota is None:
                return {
                    "ok": False,
                    "quota": None,
                    "token_name": token_name,
                    "raw": raw_dict if isinstance(raw_dict, dict) else None,
                    "error": "接口返回成功，但未识别到 quota 字段",
                }
            return {
                "ok": True,
                "quota": quota,
                "token_name": token_name,
                "raw": raw_dict if isinstance(raw_dict, dict) else None,
                "error": None,
            }
    except urlerror.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="ignore")[:800]
        except Exception:
            pass
        return {
            "ok": False,
            "quota": None,
            "token_name": None,
            "raw": None,
            "error": f"HTTP {e.code}: {e.reason}" + (f" — {body}" if body else ""),
        }
    except Exception as e:
        return {
            "ok": False,
            "quota": None,
            "token_name": None,
            "raw": None,
            "error": f"请求失败：{e}",
        }


def fetch_runninghub_account_status(api_base: str, token: str) -> dict[str, Any]:
    """
    POST /uc/openapi/accountStatus
    Body: {"apikey": "<API_KEY>"}；Header: Authorization Bearer、Host（与 OpenAPI 一致）。
    主要展示 data.remainMoney（钱包余额）；附带 RH 币、运行中任务等。
    """
    tk = str(token or "").strip()
    url = resolve_account_status_url(api_base)
    if not url or not tk:
        return {
            "ok": False,
            "remain_money": None,
            "remain_coins": None,
            "current_tasks": None,
            "currency": None,
            "api_type": None,
            "raw": None,
            "error": "请填写插件算力 API URL 与 API Key",
        }
    host = _host_header_for_plugin_api(api_base)
    payload = json.dumps({"apikey": tk}).encode("utf-8")
    req = urlrequest.Request(
        url=url,
        data=payload,
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": f"Bearer {tk}",
            "Host": host,
        },
    )
    try:
        with urlrequest.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8", errors="ignore")
            parsed = json.loads(raw) if raw else {}
            if not isinstance(parsed, dict):
                return {
                    "ok": False,
                    "remain_money": None,
                    "remain_coins": None,
                    "current_tasks": None,
                    "currency": None,
                    "api_type": None,
                    "raw": None,
                    "error": "返回格式异常（非 JSON 对象）",
                }
            code = parsed.get("code")
            if code is not None and code != 0:
                return {
                    "ok": False,
                    "remain_money": None,
                    "remain_coins": None,
                    "current_tasks": None,
                    "currency": None,
                    "api_type": None,
                    "raw": parsed,
                    "error": str(parsed.get("msg") or f"业务 code={code}"),
                }
            data = parsed.get("data")
            if not isinstance(data, dict):
                return {
                    "ok": False,
                    "remain_money": None,
                    "remain_coins": None,
                    "current_tasks": None,
                    "currency": None,
                    "api_type": None,
                    "raw": parsed,
                    "error": "返回中缺少 data 对象",
                }
            rm = data.get("remainMoney")
            remain_money: str | None = None
            if rm is not None and str(rm).strip() != "":
                remain_money = str(rm).strip()
            rc = data.get("remainCoins")
            ct = data.get("currentTaskCounts")
            cur = data.get("currency")
            apit = data.get("apiType")
            return {
                "ok": True,
                "remain_money": remain_money,
                "remain_coins": str(rc).strip() if rc is not None and str(rc).strip() != "" else None,
                "current_tasks": str(ct).strip() if ct is not None and str(ct).strip() != "" else None,
                "currency": str(cur).strip() if cur is not None and str(cur).strip() != "" else None,
                "api_type": str(apit).strip() if apit is not None and str(apit).strip() != "" else None,
                "raw": parsed,
                "error": None,
            }
    except urlerror.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="ignore")[:800]
        except Exception:
            pass
        return {
            "ok": False,
            "remain_money": None,
            "remain_coins": None,
            "current_tasks": None,
            "currency": None,
            "api_type": None,
            "raw": None,
            "error": f"HTTP {e.code}: {e.reason}" + (f" — {body}" if body else ""),
        }
    except Exception as e:
        return {
            "ok": False,
            "remain_money": None,
            "remain_coins": None,
            "current_tasks": None,
            "currency": None,
            "api_type": None,
            "raw": None,
            "error": f"请求失败：{e}",
        }


def random_coupon_code() -> str:
    import random

    s = "NX"
    for _ in range(10):
        s += random.choice(_COUPON_CODE_ALPHABET)
    return s


def issue_coupon_once(
    client: Any,
    table_name: str,
    amount_cny: int,
    *,
    issued_for_user_id: str | None = None,
) -> str:
    """
    向 nx_coupons 写入一行未使用兑换码（与 Node issueCouponCode 字段一致）。
    主键 code；属性 amount_cny（字符串档位）、used=false、created_at（毫秒时间戳，INTEGER）。
    可选 issued_for_user_id：便于后台按「目标用户」筛选（FC 核销时会写入 used_by_user_id）。
    """
    from tablestore import Condition, Row, RowExistenceExpectation

    import time

    if amount_cny not in COUPON_TIERS_CNY:
        raise ValueError(f"档位须为：{' / '.join(str(x) for x in COUPON_TIERS_CNY)} 元")
    now_ms = int(time.time() * 1000)
    last_err: Exception | None = None
    for _ in range(12):
        code = random_coupon_code()
        primary_key = [("code", code)]
        attribute_columns = [
            ("amount_cny", str(amount_cny)),
            ("used", "false"),
            ("created_at", now_ms),
        ]
        extra_uid = str(issued_for_user_id or "").strip()
        if extra_uid:
            attribute_columns.append(("issued_for_user_id", extra_uid))
        row = Row(primary_key, attribute_columns)
        cond = Condition(RowExistenceExpectation.EXPECT_NOT_EXIST, None)
        try:
            client.put_row(table_name, row, cond)
            return code
        except Exception as e:
            last_err = e
            err_low = str(e).lower()
            if "condition" in err_low or "exist" in err_low or "already" in err_low:
                continue
            raise
    raise RuntimeError(f"多次碰撞后仍无法生成唯一码：{last_err!r}")


def render_password_gate() -> None:
    expected = admin_password_expected()
    if not expected:
        st.error(
            "未配置访问密码：请设置环境变量 **AIXFLOW_ADMIN_PASSWORD**，"
            "或在 `.streamlit/secrets.toml` 中填写 **admin_password**。"
        )
        return
    pwd = st.text_input("访问密码", type="password", key="gate_pwd")
    if st.button("进入后台", type="primary"):
        if secrets_std.compare_digest(pwd.encode("utf-8"), expected.encode("utf-8")):
            st.session_state["_aixflow_auth_ok"] = True
            st.session_state["_vault_pw"] = pwd
            st.rerun()
        else:
            st.error("密码错误")


def build_client(endpoint: str, instance: str, ak: str, sk: str):
    from tablestore import OTSClient

    return OTSClient(endpoint.strip(), ak.strip(), sk.strip(), instance.strip())


def fetch_all_rows(client, table_name: str) -> list[dict[str, Any]]:
    from tablestore import Direction, INF_MAX, INF_MIN, Row

    inclusive = [("model_id", INF_MIN)]
    exclusive = [("model_id", INF_MAX)]
    cursor = inclusive
    out: list[dict[str, Any]] = []

    while True:
        consumed, next_pk, row_list, next_token = client.get_range(
            table_name,
            Direction.FORWARD,
            cursor,
            exclusive,
            columns_to_get=None,
            limit=500,
        )
        del consumed, next_token

        for row in row_list:
            if not isinstance(row, Row):
                continue
            rec: dict[str, Any] = {}
            for k, v in row.primary_key:
                rec[k] = v
            if row.attribute_columns:
                for cell in row.attribute_columns:
                    if len(cell) >= 2:
                        rec[cell[0]] = cell[1]
            out.append(rec)

        if not next_pk:
            break
        cursor = next_pk

    return out


def _row_to_dict(row: Any) -> dict[str, Any]:
    """OTS Row → dict（主键 + 属性列）。"""
    from tablestore import Row

    if not isinstance(row, Row):
        return {}
    rec: dict[str, Any] = {}
    for k, v in row.primary_key:
        rec[k] = v
    if row.attribute_columns:
        for cell in row.attribute_columns:
            if len(cell) >= 2:
                rec[cell[0]] = cell[1]
    return rec


def _ots_get_row_dict(client: Any, table_name: str, primary_key: list) -> dict[str, Any] | None:
    """GetRow 单行 → dict；无行或异常时返回 None。"""
    from tablestore import Row

    try:
        consumed, return_row, next_token = client.get_row(table_name, primary_key)
    except Exception:
        return None
    del consumed, next_token
    if not return_row:
        return None
    if isinstance(return_row, Row):
        d = _row_to_dict(return_row)
        return d if d else None
    return None


def resolve_account_to_user_id(
    client: Any,
    *,
    email_table: str,
    users_table: str,
    raw: str,
) -> tuple[str | None, str | None]:
    """
    将用户输入解析为 user_id：
    1) 在 nx_email_user 按主键 email（小写）查 user_id；
    2) 若无行，再在 nx_users 按主键 user_id 试查（兼容直接填主键）。
    返回 (user_id, error_message)。
    """
    s = str(raw or "").strip()
    if not s:
        return None, "请输入用户账号（注册邮箱）。"

    em = email_table.strip()
    ut = users_table.strip()
    key_email = s.lower()

    rec = _ots_get_row_dict(client, em, [("email", key_email)])
    if rec:
        uid = str(rec.get("user_id") or "").strip()
        if uid:
            return uid, None

    urec = _ots_get_row_dict(client, ut, [("user_id", s)])
    if urec:
        uid = str(urec.get("user_id") or "").strip()
        if uid:
            return uid, None

    return None, (
        f"未找到用户。请使用**注册邮箱**（与客户端登录一致），"
        f"或正确的 **user_id**；当前输入：`{s}`"
    )


def _parse_yuanbao_balance(v: Any) -> int:
    n = _scalar_display(v)
    if n is None:
        return 0
    try:
        return int(n)
    except (TypeError, ValueError):
        try:
            return int(float(n))
        except (TypeError, ValueError):
            return 0


def admin_adjust_user_balance(
    client: Any,
    *,
    users_table: str,
    tx_table: str,
    tx_pk_col: str,
    user_id: str,
    delta_yuanbao: int,
    remark: str,
) -> dict[str, Any]:
    """
    运营调账：更新 nx_users.balance 并写入 nx_transactions（type=adjust）。
    delta_yuanbao：负数扣费，正数补发（与 FC 流水 amount 符号一致）。
    """
    import time
    import uuid

    from tablestore import Condition, Row, RowExistenceExpectation

    uid = str(user_id or "").strip()
    if not uid:
        raise ValueError("缺少 user_id")

    delta = int(delta_yuanbao)
    if delta == 0:
        raise ValueError("变动元宝不能为 0")

    memo = str(remark or "").strip() or "管理员调整"
    ut = users_table.strip()
    tt = tx_table.strip()
    pk_name = str(tx_pk_col or "transaction_id").strip() or "transaction_id"

    urec = _ots_get_row_dict(client, ut, [("user_id", uid)])
    if not urec:
        raise ValueError(f"用户不存在：{uid}")

    status = str(urec.get("status") or "normal").strip().lower()
    if status == "frozen":
        raise ValueError("用户已冻结，无法调账")

    balance_before = _parse_yuanbao_balance(urec.get("balance"))
    balance_after = balance_before + delta
    if balance_after < 0:
        raise ValueError(
            f"余额不足：当前 {balance_before} 元宝，变动 {delta:+d}，结果将为 {balance_after}"
        )

    now_ms = int(time.time() * 1000)
    user_row = Row([("user_id", uid)], {"PUT": [("balance", balance_after)]})
    user_cond = Condition(RowExistenceExpectation.EXPECT_EXIST, None)
    client.update_row(ut, user_row, user_cond)

    tx_id = f"adjust_{uuid.uuid4().hex}"
    tx_row = Row(
        [(pk_name, tx_id)],
        [
            ("user_id", uid),
            ("task_id", "admin_adjust"),
            ("amount", delta),
            ("type", "adjust"),
            ("provider", "admin"),
            ("description", memo),
            ("created_at", now_ms),
            ("balance_after", balance_after),
        ],
    )
    tx_cond = Condition(RowExistenceExpectation.EXPECT_NOT_EXIST, None)
    try:
        client.put_row(tt, tx_row, tx_cond)
    except Exception as e:
        try:
            rollback_row = Row([("user_id", uid)], {"PUT": [("balance", balance_before)]})
            client.update_row(ut, rollback_row, user_cond)
        except Exception:
            pass
        raise RuntimeError(f"流水写入失败，已尝试回滚余额：{e}") from e

    return {
        "user_id": uid,
        "transaction_id": tx_id,
        "balance_before": balance_before,
        "balance_after": balance_after,
        "delta_yuanbao": delta,
        "description": memo,
    }


def _scalar_display(v: Any) -> Any:
    """DataFrame 展示用：尽量转为可打印标量。"""
    if v is None:
        return None
    if isinstance(v, (bool, str)):
        return v
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, bytes):
        try:
            return int.from_bytes(v, byteorder="little", signed=False)
        except Exception:
            return v.hex()[:32]
    try:
        n = int(v)  # Tablestore Long 等
        return n
    except Exception:
        return str(v)


def fetch_all_coupon_rows(client: Any, table_name: str) -> list[dict[str, Any]]:
    """全表扫描 nx_coupons（主键 code）。"""
    from tablestore import Direction, INF_MAX, INF_MIN, Row

    inclusive = [("code", INF_MIN)]
    exclusive = [("code", INF_MAX)]
    cursor = inclusive
    out: list[dict[str, Any]] = []

    while True:
        consumed, next_pk, row_list, next_token = client.get_range(
            table_name,
            Direction.FORWARD,
            cursor,
            exclusive,
            columns_to_get=None,
            limit=500,
        )
        del consumed, next_token

        for row in row_list:
            out.append(_row_to_dict(row))

        if not next_pk:
            break
        cursor = next_pk

    return out


def _ots_attr_ts_to_ms(v: Any) -> int | None:
    """Tablestore 时间列 → 毫秒时间戳；无效返回 None。"""
    if v is None:
        return None
    n = _scalar_display(v)
    if isinstance(n, int) and n > 0:
        return n if n > 1_000_000_000_000 else n * 1000
    try:
        x = int(float(n))
        if x > 0:
            return x if x > 1_000_000_000_000 else x * 1000
    except Exception:
        pass
    return None


def fetch_all_users_sanitized(
    client: Any,
    users_table: str,
    *,
    max_users: int = 200_000,
) -> tuple[list[dict[str, Any]], bool]:
    """
    全表扫描 nx_users（主键 user_id），仅返回脱敏字段（不含 password_hash）。
    返回 (rows, scan_truncated)。
    """
    from tablestore import Direction, INF_MAX, INF_MIN, Row

    ut = users_table.strip()
    inclusive = [("user_id", INF_MIN)]
    exclusive = [("user_id", INF_MAX)]
    cursor = inclusive
    out: list[dict[str, Any]] = []
    truncated = False

    while True:
        consumed, next_pk, row_list, next_token = client.get_range(
            ut,
            Direction.FORWARD,
            cursor,
            exclusive,
            columns_to_get=None,
            limit=500,
        )
        del consumed, next_token

        for row in row_list:
            if len(out) >= max_users:
                break
            if not isinstance(row, Row):
                continue
            rec = _row_to_dict(row)
            uid = str(rec.get("user_id") or "").strip()
            if not uid:
                continue
            reg = _ots_attr_ts_to_ms(rec.get("created_at")) or 0
            last = _ots_attr_ts_to_ms(rec.get("last_login_at"))
            out.append(
                {
                    "user_id": uid,
                    "email": str(rec.get("email") or ""),
                    "registration_date": reg,
                    "last_login": last,
                    "status": str(rec.get("status") or "normal"),
                }
            )

        if len(out) >= max_users:
            if next_pk:
                truncated = True
            break
        if not next_pk:
            break
        cursor = next_pk

    return out, truncated


def users_admin_rows_to_dataframe(rows: list[dict[str, Any]]) -> pd.DataFrame:
    """用户管理页表格展示（中文列名）。"""
    if not rows:
        return pd.DataFrame(columns=["用户 ID", "邮箱", "注册时间", "最近登录", "状态"])
    out: list[dict[str, Any]] = []
    for r in rows:
        reg = int(r.get("registration_date") or 0)
        reg_s = "—"
        if reg > 0:
            try:
                reg_s = pd.Timestamp(reg, unit="ms").strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                reg_s = str(reg)
        ll = r.get("last_login")
        ll_s = "—"
        if ll is not None:
            try:
                ln = int(ll)
                if ln > 0:
                    ll_s = pd.Timestamp(ln, unit="ms").strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                ll_s = str(ll)
        out.append(
            {
                "用户 ID": r.get("user_id"),
                "邮箱": r.get("email") or "—",
                "注册时间": reg_s,
                "最近登录": ll_s,
                "状态": r.get("status") or "normal",
            }
        )
    return pd.DataFrame(out)


def users_admin_rows_to_csv(rows: list[dict[str, Any]]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["user_id", "email", "registration_date_ms", "last_login_ms", "status"])
    for r in rows:
        w.writerow(
            [
                r.get("user_id"),
                r.get("email") or "",
                r.get("registration_date") or "",
                r.get("last_login") if r.get("last_login") is not None else "",
                r.get("status") or "",
            ]
        )
    return buf.getvalue()


def _shanghai_calendar_keys_profit(ms: int) -> tuple[str, str, str]:
    ts = pd.Timestamp(ms, unit="ms", tz="Asia/Shanghai")
    return ts.strftime("%Y-%m-%d"), ts.strftime("%Y-%m"), ts.strftime("%Y")


def _model_id_from_tx_description_profit(desc: str) -> str:
    s = str(desc or "").strip()
    if not s:
        return ""
    if s.startswith("create:"):
        return s[7:].strip()
    if s.startswith("{"):
        return ""
    return (s.split()[0].split("|")[0]).strip()


def _tx_consume_created_ms(attrs: dict[str, Any]) -> int:
    raw = attrs.get("created_at")
    n = _scalar_display(raw)
    if isinstance(n, int) and n > 0:
        return n if n > 1_000_000_000_000 else n * 1000
    try:
        return int(pd.Timestamp(str(raw), tz="Asia/Shanghai").timestamp() * 1000)
    except Exception:
        return 0


def _tx_amount_abs_int(attrs: dict[str, Any]) -> int:
    raw = attrs.get("amount")
    n = _scalar_display(raw)
    if isinstance(n, int):
        return abs(int(n))
    try:
        return abs(int(float(n)))
    except Exception:
        return 0


def fetch_transaction_rows_scan(
    client: Any,
    tx_table: str,
    pk_col: str,
    *,
    max_rows: int = 60000,
) -> tuple[list[dict[str, Any]], bool]:
    """nx_transactions 主表按主键范围扫描。"""
    from tablestore import Direction, INF_MAX, INF_MIN, Row

    pk = str(pk_col or "transaction_id").strip() or "transaction_id"
    tt = tx_table.strip()
    inclusive = [(pk, INF_MIN)]
    exclusive = [(pk, INF_MAX)]
    cursor = inclusive
    out: list[dict[str, Any]] = []
    scanned = 0
    truncated = False

    while scanned < max_rows:
        consumed, next_pk, row_list, next_token = client.get_range(
            tt,
            Direction.FORWARD,
            cursor,
            exclusive,
            columns_to_get=None,
            limit=500,
        )
        del consumed, next_token
        for row in row_list:
            if scanned >= max_rows:
                break
            scanned += 1
            if isinstance(row, Row):
                out.append(_row_to_dict(row))
        if scanned >= max_rows:
            if next_pk:
                truncated = True
            break
        if not next_pk:
            break
        cursor = next_pk
    return out, truncated


def _load_model_profit_map_from_config_rows(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    m: dict[str, dict[str, Any]] = {}
    for r in rows:
        mid = str(r.get("model_id") or "").strip()
        if not mid:
            continue

        def fnum(key: str) -> float | None:
            if key not in r and key.lower() not in {k.lower() for k in r}:
                for k in r:
                    if str(k).lower() == key.lower():
                        key = k
                        break
            v = r.get(key)
            if v is None:
                return None
            try:
                x = float(_scalar_display(v))
                if x != x:
                    return None
                return x
            except Exception:
                return None

        bp = fnum("base_price")
        bp = float(bp) if bp is not None else 0.0
        yr = fnum("yuanbao_rate")
        yr = float(yr) if yr is not None and yr > 0 else 10.0
        m[mid] = {
            "base_price": bp,
            "base_cost": fnum("base_cost"),
            "user_price": fnum("user_price"),
            "yuanbao_rate": yr,
        }
    return m


def scan_coupons_used_summary(
    client: Any,
    coupons_table: str,
    *,
    max_scan: int = 50000,
) -> tuple[int, int, int]:
    """已核销券数量、面值合计(元)、扫描行数。"""
    from tablestore import Direction, INF_MAX, INF_MIN, Row

    ct = coupons_table.strip()
    inclusive = [("code", INF_MIN)]
    exclusive = [("code", INF_MAX)]
    cursor = inclusive
    used_n = 0
    cny_sum = 0
    scanned = 0

    while scanned < max_scan:
        consumed, next_pk, row_list, next_token = client.get_range(
            ct,
            Direction.FORWARD,
            cursor,
            exclusive,
            columns_to_get=None,
            limit=500,
        )
        del consumed, next_token
        for row in row_list:
            if scanned >= max_scan:
                break
            scanned += 1
            if not isinstance(row, Row):
                continue
            rec = _row_to_dict(row)
            if not _coupon_used_flag(rec):
                continue
            used_n += 1
            try:
                tier = int(float(str(rec.get("amount_cny") or "0")))
                if tier > 0:
                    cny_sum += tier
            except Exception:
                pass
        if scanned >= max_scan:
            break
        if not next_pk:
            break
        cursor = next_pk
    return used_n, cny_sum, scanned


def scan_queue_factory_stats(
    client: Any,
    *,
    tasks_table: str,
    queue_counters_table: str = DEFAULT_OTS_QUEUE_COUNTERS_TABLE,
    max_task_scan: int = 40000,
) -> dict[str, Any]:
    """
    扫描全站 nx_tasks：排队中 / 生产中（全用户）。
    生产中 = claimed + running + legacy pending/processing。
    可选读取 nx_queue_counters 平台槽占用。
    """
    from tablestore import Direction, INF_MAX, INF_MIN

    tt = tasks_table.strip()
    inclusive = [("task_id", INF_MIN)]
    exclusive = [("task_id", INF_MAX)]
    cursor = inclusive
    scanned = 0
    queued = 0
    claimed = 0
    running = 0
    pending = 0
    processing = 0
    failed = 0
    queued_video = 0
    queued_image = 0
    producing_video = 0
    producing_image = 0
    failed_statuses = {"failed", "timeout", "time_out"}

    while scanned < max_task_scan:
        _consumed, next_pk, row_list, _next_token = client.get_range(
            tt,
            Direction.FORWARD,
            cursor,
            exclusive,
            columns_to_get=["status", "task_type"],
            limit=min(500, max_task_scan - scanned),
        )
        for row in row_list or []:
            if scanned >= max_task_scan:
                break
            scanned += 1
            rec = _row_to_dict(row)
            st_raw = str(rec.get("status") or "").strip().lower()
            ttype = str(rec.get("task_type") or "").strip().lower()
            if st_raw in failed_statuses:
                failed += 1
            if st_raw == "queued":
                queued += 1
                if ttype == "video":
                    queued_video += 1
                elif ttype == "image":
                    queued_image += 1
            elif st_raw == "claimed":
                claimed += 1
                if ttype == "video":
                    producing_video += 1
                elif ttype == "image":
                    producing_image += 1
            elif st_raw == "running":
                running += 1
                if ttype == "video":
                    producing_video += 1
                elif ttype == "image":
                    producing_image += 1
            elif st_raw == "pending":
                pending += 1
                if ttype == "video":
                    producing_video += 1
                elif ttype == "image":
                    producing_image += 1
            elif st_raw == "processing":
                processing += 1
                if ttype == "video":
                    producing_video += 1
                elif ttype == "image":
                    producing_image += 1
        if not next_pk or scanned >= max_task_scan:
            break
        cursor = next_pk

    producing = claimed + running + pending + processing

    platform_video_running: int | None = None
    platform_image_running: int | None = None
    qt = (queue_counters_table or "").strip()
    if qt:
        for pool_id, key in (("video", "platform_video_running"), ("image", "platform_image_running")):
            rec = _ots_get_row_dict(client, qt, [("pool_id", pool_id)])
            if not rec:
                continue
            n = int(float(rec.get("running") or 0)) if str(rec.get("running") or "").strip() != "" else 0
            if key == "platform_video_running":
                platform_video_running = n
            else:
                platform_image_running = n

    return {
        "queued_tasks": queued,
        "producing_tasks": producing,
        "claimed_tasks": claimed,
        "running_tasks": running,
        "pending_tasks": pending,
        "processing_tasks": processing,
        "queued_video_tasks": queued_video,
        "queued_image_tasks": queued_image,
        "producing_video_tasks": producing_video,
        "producing_image_tasks": producing_image,
        "pending_failed_or_timeout_tasks": failed,
        "platform_video_running": platform_video_running,
        "platform_image_running": platform_image_running,
        "task_rows_scanned": scanned,
        "task_scan_truncated": scanned >= max_task_scan,
        "tasks_table": tt,
        "queue_counters_table": qt,
    }


def aggregate_recent_usage_and_active(
    client: Any,
    *,
    tx_table: str,
    tx_pk: str,
    users_table: str,
    window_days: int = 7,
    max_tx_scan: int = 80000,
    top_accounts: int = 200,
    include_login_active: bool = True,
    max_detail_rows: int = 8000,
) -> dict[str, Any]:
    """
    近期全站用量（nx_transactions type=consume）与活跃账号。
    活跃 = 窗口内至少 1 笔扣费；可选同窗 last_login 登录活跃数（用户表）。
    另附 detail_rows：全站混合逐笔明细（账号/时间/模型/元宝），供按日筛选展示。
    """
    from datetime import datetime, timedelta, timezone

    days = max(1, min(90, int(window_days)))
    tz = timezone(timedelta(hours=8))  # Asia/Shanghai（无夏令时）
    now = datetime.now(tz)
    end_ms = int(now.timestamp() * 1000)
    start_ms = int((now - timedelta(days=days)).timestamp() * 1000)
    window_label = f"近 {days} 天（上海时区）"
    today_key = now.strftime("%Y-%m-%d")

    tx_rows, tx_truncated = fetch_transaction_rows_scan(
        client, tx_table, tx_pk, max_rows=max_tx_scan
    )

    total_yuanbao = 0
    total_count = 0
    # user_id -> stats
    by_user: dict[str, dict[str, Any]] = {}
    # day key YYYY-MM-DD -> stats
    by_day: dict[str, dict[str, Any]] = {}
    # model_id -> {n, yuanbao}
    by_model: dict[str, dict[str, float]] = {}
    detail_raw: list[dict[str, Any]] = []

    for rec in tx_rows:
        typ = str(rec.get("type") or "").strip().lower()
        if typ != "consume":
            continue
        cms = _tx_consume_created_ms(rec)
        if cms < start_ms or cms > end_ms:
            continue
        amt = _tx_amount_abs_int(rec)
        if amt <= 0:
            continue
        uid = str(rec.get("user_id") or "").strip()
        if not uid:
            continue

        total_yuanbao += amt
        total_count += 1

        u = by_user.get(uid)
        if u is None:
            u = {
                "user_id": uid,
                "consume_yuanbao": 0,
                "consume_count": 0,
                "last_consume_ms": 0,
            }
            by_user[uid] = u
        u["consume_yuanbao"] += amt
        u["consume_count"] += 1
        if cms > int(u["last_consume_ms"]):
            u["last_consume_ms"] = cms

        dkey = _shanghai_calendar_keys_profit(cms)[0]
        d = by_day.get(dkey)
        if d is None:
            d = {"day": dkey, "consume_yuanbao": 0, "consume_count": 0, "_uids": set()}
            by_day[dkey] = d
        d["consume_yuanbao"] += amt
        d["consume_count"] += 1
        d["_uids"].add(uid)

        mid = _model_id_from_tx_description_profit(str(rec.get("description") or "")) or "_unknown"
        m = by_model.get(mid)
        if m is None:
            m = {"model_id": mid, "consume_yuanbao": 0.0, "consume_count": 0.0}
            by_model[mid] = m
        m["consume_yuanbao"] += float(amt)
        m["consume_count"] += 1.0

        detail_raw.append(
            {
                "day": dkey,
                "created_at_ms": cms,
                "user_id": uid,
                "model_id": mid,
                "yuanbao": int(amt),
                "task_id": str(rec.get("task_id") or "").strip(),
                "transaction_id": str(
                    rec.get("transaction_id") or rec.get("tx_id") or ""
                ).strip(),
                "description": str(rec.get("description") or "").strip(),
            }
        )

    active_n = len(by_user)
    ranked = sorted(
        by_user.values(),
        key=lambda x: (int(x["consume_yuanbao"]), int(x["consume_count"])),
        reverse=True,
    )
    top = ranked[: max(1, min(2000, int(top_accounts)))]

    # 明细：按时间倒序，截断
    detail_cap = max(100, min(50_000, int(max_detail_rows)))
    detail_raw.sort(key=lambda x: int(x.get("created_at_ms") or 0), reverse=True)
    detail_truncated = len(detail_raw) > detail_cap
    detail_rows = detail_raw[:detail_cap]

    # 补邮箱：Top 账号 + 明细涉及的用户（上限，避免全表）
    ut = users_table.strip()
    email_cache: dict[str, str] = {}

    def _email_for(uid: str) -> str:
        if uid in email_cache:
            return email_cache[uid]
        urec = _ots_get_row_dict(client, ut, [("user_id", uid)]) if ut else None
        email = str((urec or {}).get("email") or "").strip() or "—"
        email_cache[uid] = email
        return email

    for row in top:
        uid = str(row["user_id"])
        urec = _ots_get_row_dict(client, ut, [("user_id", uid)]) if ut else None
        email = str((urec or {}).get("email") or "").strip()
        row["email"] = email or "—"
        email_cache[uid] = row["email"]
        ll = _ots_attr_ts_to_ms((urec or {}).get("last_login_at")) if urec else None
        row["last_login_ms"] = ll
        row["status"] = str((urec or {}).get("status") or "normal") if urec else "—"

    detail_email_budget = 2500
    seen_detail_uids: set[str] = set()
    for dr in detail_rows:
        uid = str(dr["user_id"])
        if uid in email_cache:
            dr["email"] = email_cache[uid]
            continue
        if len(seen_detail_uids) >= detail_email_budget and uid not in email_cache:
            dr["email"] = "—"
            continue
        seen_detail_uids.add(uid)
        dr["email"] = _email_for(uid)

    day_rows = []
    for dkey in sorted(by_day.keys()):
        d = by_day[dkey]
        day_rows.append(
            {
                "day": dkey,
                "consume_yuanbao": int(d["consume_yuanbao"]),
                "consume_count": int(d["consume_count"]),
                "active_accounts": len(d["_uids"]),
            }
        )

    model_rows = sorted(
        (
            {
                "model_id": m["model_id"],
                "consume_yuanbao": int(m["consume_yuanbao"]),
                "consume_count": int(m["consume_count"]),
            }
            for m in by_model.values()
        ),
        key=lambda x: x["consume_yuanbao"],
        reverse=True,
    )[:50]

    # 登录活跃：窗口内 last_login_at（可选，全表扫描较慢）
    login_active = -1 if not include_login_active else 0
    users_scanned = 0
    users_trunc = False
    if include_login_active:
        try:
            all_users, users_trunc = fetch_all_users_sanitized(client, ut, max_users=100_000)
            users_scanned = len(all_users)
            login_active = 0
            for ur in all_users:
                ll = ur.get("last_login")
                if ll is None:
                    continue
                try:
                    ln = int(ll)
                except Exception:
                    continue
                if start_ms <= ln <= end_ms:
                    login_active += 1
        except Exception:
            login_active = -1  # 表示未能统计

    avg_yb = int(round(total_yuanbao / active_n)) if active_n > 0 else 0

    return {
        "window_days": days,
        "window_label": window_label,
        "today_key": today_key,
        "start_ms": start_ms,
        "end_ms": end_ms,
        "total_consume_yuanbao": total_yuanbao,
        "total_consume_count": total_count,
        "active_accounts": active_n,
        "avg_yuanbao_per_active": avg_yb,
        "login_active_accounts": login_active,
        "users_scanned_for_login": users_scanned,
        "users_login_scan_truncated": users_trunc,
        "include_login_active": include_login_active,
        "daily": day_rows,
        "top_accounts": top,
        "top_models": model_rows,
        "detail_rows": detail_rows,
        "detail_rows_total": len(detail_raw),
        "detail_rows_truncated": detail_truncated,
        "tx_rows_scanned": len(tx_rows),
        "tx_scan_truncated": tx_truncated,
    }


def aggregate_profit_analytics_streamlit(
    client: Any,
    *,
    model_table: str,
    tx_table: str,
    tx_pk: str,
    coupons_table: str,
    tasks_table: str,
    max_tx_scan: int = 60000,
    max_coupon_scan: int = 50000,
) -> dict[str, Any]:
    """
    与桌面端 FC /internal/admin-profit-analytics 逻辑一致（内存聚合）。
    售价：user_price 或实扣元宝；底价：base_cost 或 base_price。
    """
    cfg_rows = fetch_all_rows(client, model_table.strip())
    model_map = _load_model_profit_map_from_config_rows(cfg_rows)
    rates = [float(m["yuanbao_rate"]) for m in model_map.values() if float(m.get("yuanbao_rate") or 0) > 0]
    default_yuanbao_per_cny = sum(rates) / len(rates) if rates else 10.0

    coupon_used, coupon_cny, cp_scanned = scan_coupons_used_summary(
        client, coupons_table, max_scan=max_coupon_scan
    )
    coupon_est_yb = int(round(coupon_cny * default_yuanbao_per_cny))

    tx_rows, tx_truncated = fetch_transaction_rows_scan(
        client, tx_table, tx_pk, max_rows=max_tx_scan
    )

    day_agg: dict[str, dict[str, float]] = {}
    month_agg: dict[str, dict[str, float]] = {}
    year_agg: dict[str, dict[str, float]] = {}
    model_agg: dict[str, dict[str, float]] = {}

    total_rev = 0.0
    total_cost = 0.0
    task_cache: dict[str, str] = {}
    tt = tasks_table.strip()

    for rec in tx_rows:
        typ = str(rec.get("type") or "").strip().lower()
        if typ != "consume":
            continue
        cms = _tx_consume_created_ms(rec)
        if cms <= 0:
            continue
        user_charge = _tx_amount_abs_int(rec)
        if user_charge <= 0:
            continue

        mid = _model_id_from_tx_description_profit(str(rec.get("description") or ""))
        tid = str(rec.get("task_id") or "").strip()
        if not mid and tid:
            if tid in task_cache:
                mid = task_cache[tid]
            else:
                trec = _ots_get_row_dict(client, tt, [("task_id", tid)])
                mid = _extract_billing_model_from_task_record(trec or {}) if trec else ""
                task_cache[tid] = mid or "_unknown"
                mid = mid or "_unknown"
        if not mid:
            mid = "_unknown"

        cfg = model_map.get(mid) or {
            "base_price": 0.0,
            "base_cost": None,
            "user_price": None,
            "yuanbao_rate": 10.0,
        }
        bc_raw = cfg.get("base_cost")
        base_c = float(bc_raw) if bc_raw is not None else float(cfg.get("base_price") or 0)
        up_raw = cfg.get("user_price")
        sell = float(up_raw) if up_raw is not None else float(user_charge)
        prof = sell - base_c

        total_rev += sell
        total_cost += base_c

        dkey, mkey, ykey = _shanghai_calendar_keys_profit(cms)
        for agg, k in ((day_agg, dkey), (month_agg, mkey), (year_agg, ykey)):
            if k not in agg:
                agg[k] = {"profit": 0.0, "revenue": 0.0, "cost": 0.0}
            agg[k]["profit"] += prof
            agg[k]["revenue"] += sell
            agg[k]["cost"] += base_c

        if mid not in model_agg:
            model_agg[mid] = {"profit": 0.0, "revenue": 0.0, "cost": 0.0, "n": 0.0}
        model_agg[mid]["profit"] += prof
        model_agg[mid]["revenue"] += sell
        model_agg[mid]["cost"] += base_c
        model_agg[mid]["n"] += 1.0

    def sorted_period_list(agg: dict[str, dict[str, float]]) -> list[dict[str, Any]]:
        return [
            {
                "period": p,
                "profit_yuanbao": round(agg[p]["profit"]),
                "revenue_yuanbao": round(agg[p]["revenue"]),
                "cost_yuanbao": round(agg[p]["cost"]),
            }
            for p in sorted(agg.keys())
        ]

    leaderboard = sorted(
        [
            {
                "model_id": mid,
                "profit_yuanbao": round(v["profit"]),
                "revenue_yuanbao": round(v["revenue"]),
                "cost_yuanbao": round(v["cost"]),
                "task_count": int(v["n"]),
            }
            for mid, v in model_agg.items()
        ],
        key=lambda x: x["profit_yuanbao"],
        reverse=True,
    )

    now_ms = int(pd.Timestamp.now(tz="Asia/Shanghai").timestamp() * 1000)
    _, cur_month_key, _ = _shanghai_calendar_keys_profit(now_ms)
    cur_m = month_agg.get(cur_month_key, {"profit": 0.0, "revenue": 0.0, "cost": 0.0})

    return {
        "timezone": "Asia/Shanghai",
        "daily_profits": sorted_period_list(day_agg),
        "monthly_profits": sorted_period_list(month_agg),
        "yearly_profits": sorted_period_list(year_agg),
        "total_revenue": round(total_rev),
        "total_cost": round(total_cost),
        "total_profit": round(total_rev - total_cost),
        "current_month_profit_yuanbao": round(cur_m["profit"]),
        "current_month_revenue_yuanbao": round(cur_m["revenue"]),
        "current_month_key": cur_month_key,
        "model_profit_leaderboard": leaderboard[:80],
        "coupon_used_count": coupon_used,
        "coupon_face_value_cny_sum": coupon_cny,
        "coupon_estimated_yuanbao": coupon_est_yb,
        "yuanbao_per_cny_assumed": round(default_yuanbao_per_cny, 3),
        "tx_rows_scanned": len(tx_rows),
        "coupon_rows_scanned": cp_scanned,
        "tx_scan_truncated": tx_truncated,
    }


def fetch_recharge_like_transactions_for_user(
    client: Any,
    gsi_table_name: str,
    sort_key_name: str,
    user_id: str,
    *,
    max_rows: int = 800,
) -> list[dict[str, Any]]:
    """
    在全局二级索引上按 user_id 范围读流水，筛选 type 为 recharge / redeem（元宝入账类）。
    tableName 须为索引名（如 idx_user_id），不可传主表名。
    """
    from tablestore import Direction, INF_MAX, INF_MIN, Row

    uid = str(user_id or "").strip()
    if not uid:
        return []

    sk = str(sort_key_name or "transaction_id").strip() or "transaction_id"
    inclusive = [("user_id", uid), (sk, INF_MIN)]
    exclusive = [("user_id", uid), (sk, INF_MAX)]
    cursor = inclusive
    collected: list[dict[str, Any]] = []
    safety = 0

    while len(collected) < max_rows and safety < 300:
        safety += 1
        consumed, next_pk, row_list, next_token = client.get_range(
            gsi_table_name,
            Direction.FORWARD,
            cursor,
            exclusive,
            columns_to_get=None,
            limit=100,
        )
        del consumed, next_token

        for row in row_list:
            if not isinstance(row, Row):
                continue
            rec = _row_to_dict(row)
            t = str(rec.get("type") or "").strip().lower()
            if t not in ("recharge", "redeem"):
                continue
            collected.append(rec)
            if len(collected) >= max_rows:
                break

        if len(collected) >= max_rows or not next_pk:
            break
        cursor = next_pk

    def _ts_ms(rec: dict[str, Any]) -> int:
        v = rec.get("created_at")
        n = _scalar_display(v)
        if isinstance(n, int) and n > 0:
            return n if n > 1_000_000_000_000 else n * 1000
        try:
            p = pd.Timestamp(str(v))
            return int(p.timestamp() * 1000)
        except Exception:
            return 0

    collected.sort(key=_ts_ms, reverse=True)
    return collected


def fetch_all_transactions_for_user_via_gsi(
    client: Any,
    gsi_table_name: str,
    sort_key_name: str,
    user_id: str,
    *,
    max_rows: int = 2000,
) -> list[dict[str, Any]]:
    """
    nx_transactions：在全局二级索引上按 user_id 范围读流水（**不筛选 type**，含充值/扣费/退款等）。
    tableName 须为索引名（如 idx_user_id），与 FC 侧 listRecentTransactionsForUser 一致。
    """
    from tablestore import Direction, INF_MAX, INF_MIN, Row

    uid = str(user_id or "").strip()
    if not uid:
        return []

    sk = str(sort_key_name or "transaction_id").strip() or "transaction_id"
    inclusive = [("user_id", uid), (sk, INF_MIN)]
    exclusive = [("user_id", uid), (sk, INF_MAX)]
    cursor = inclusive
    collected: list[dict[str, Any]] = []
    safety = 0

    while len(collected) < max_rows and safety < 400:
        safety += 1
        consumed, next_pk, row_list, next_token = client.get_range(
            gsi_table_name,
            Direction.FORWARD,
            cursor,
            exclusive,
            columns_to_get=None,
            limit=100,
        )
        del consumed, next_token

        for row in row_list:
            if not isinstance(row, Row):
                continue
            rec = _row_to_dict(row)
            collected.append(rec)
            if len(collected) >= max_rows:
                break

        if len(collected) >= max_rows or not next_pk:
            break
        cursor = next_pk

    def _ts_ms(rec: dict[str, Any]) -> int:
        v = rec.get("created_at")
        n = _scalar_display(v)
        if isinstance(n, int) and n > 0:
            return n if n > 1_000_000_000_000 else n * 1000
        try:
            p = pd.Timestamp(str(v))
            return int(p.timestamp() * 1000)
        except Exception:
            return 0

    collected.sort(key=_ts_ms, reverse=True)

    tx_table = get_ots_transactions_table_default()
    pk_col = get_ots_tx_sort_key_default()
    collected = hydrate_transaction_rows_from_main_table(client, tx_table, collected, tx_pk_col=pk_col)
    return collected


def hydrate_transaction_rows_from_main_table(
    client: Any,
    tx_table: str,
    rows: list[dict[str, Any]],
    *,
    tx_pk_col: str,
) -> list[dict[str, Any]]:
    """
    GSI 行可能未投影 created_at / description 等；与 FC listRecentTransactionsForUser 一样回表 nx_transactions 补全。
    """
    pk = (tx_pk_col or "transaction_id").strip()
    tt = tx_table.strip()
    out: list[dict[str, Any]] = []
    for r in rows:
        tid = str(r.get("transaction_id") or r.get("tx_id") or r.get(pk) or "").strip()
        if not tid:
            out.append(dict(r))
            continue
        full = _ots_get_row_dict(client, tt, [(pk, tid)])
        if full:
            out.append({**dict(r), **full})
        else:
            out.append(dict(r))
    return out


def _format_tx_created_at_display(v: Any) -> str | None:
    """流水 created_at → 上海时区可读时间（OTS 存的是 epoch ms / UTC）。"""
    if v is None:
        return None
    n = _scalar_display(v)
    if isinstance(n, int) and n > 0:
        ms = n if n > 1_000_000_000_000 else n * 1000
        try:
            return (
                pd.Timestamp(ms, unit="ms", tz="UTC")
                .tz_convert("Asia/Shanghai")
                .strftime("%Y-%m-%d %H:%M:%S")
            )
        except Exception:
            try:
                # Windows 无 tzdata 时退回固定 +08:00
                return (pd.Timestamp(ms, unit="ms") + pd.Timedelta(hours=8)).strftime(
                    "%Y-%m-%d %H:%M:%S"
                )
            except Exception:
                return str(n)
    try:
        ts = pd.Timestamp(str(v))
        if ts.tzinfo is None:
            ts = ts.tz_localize("UTC").tz_convert("Asia/Shanghai")
        else:
            ts = ts.tz_convert("Asia/Shanghai")
        return ts.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return str(v) if str(v).strip() else None


def _extract_billing_model_from_task_record(rec: dict[str, Any]) -> str:
    """从 nx_tasks 的 workflow_json / prompt_json 中解析 billingModelId。"""
    for key in ("workflow_json", "prompt_json"):
        raw = rec.get(key)
        if raw is None:
            continue
        s = str(raw).strip()
        if not s:
            continue
        try:
            j = json.loads(s)
        except Exception:
            continue
        if isinstance(j, dict):
            if j.get("billingModelId"):
                return str(j["billingModelId"]).strip()
            inner = j.get("inner")
            if isinstance(inner, dict) and inner.get("billingModelId"):
                return str(inner["billingModelId"]).strip()
    return ""


def build_task_model_lookup_by_task_ids(
    client: Any,
    tasks_table: str,
    rows: list[dict[str, Any]],
) -> dict[str, str]:
    """对扣费类流水且 description 为空时，按 task_id 读 nx_tasks 补模型名。"""
    need: set[str] = set()
    for r in rows:
        t = str(r.get("type") or "").strip().lower()
        if t not in ("consume", "consume_pending"):
            continue
        if str(r.get("description") or "").strip():
            continue
        tid = str(r.get("task_id") or "").strip()
        if tid and tid not in ("recharge", "welcome", "welcome_bonus"):
            need.add(tid)
    out: dict[str, str] = {}
    tt = tasks_table.strip()
    for tid in need:
        rec = _ots_get_row_dict(client, tt, [("task_id", tid)])
        if rec:
            m = _extract_billing_model_from_task_record(rec)
            if m:
                out[tid] = m
    return out


def transactions_task_records_display_dataframe(
    rows: list[dict[str, Any]],
    *,
    task_model_by_id: dict[str, str],
) -> pd.DataFrame:
    """任务记录：使用模型、扣费时间、扣费金额 + 辅助列。"""
    cols = [
        "使用模型",
        "扣费时间",
        "扣费金额(元宝)",
        "类型",
        "transaction_id",
        "task_id",
        "交易后余额",
        "备注",
    ]
    if not rows:
        return pd.DataFrame(columns=cols)

    out: list[dict[str, Any]] = []
    for r in rows:
        tt = str(r.get("type") or "").strip().lower()
        desc = str(r.get("description") or "").strip()
        tid = str(r.get("task_id") or "").strip()
        txid = str(r.get("transaction_id") or r.get("tx_id") or "").strip()

        if tt in ("consume", "consume_pending"):
            if desc:
                model = desc
            elif tid and tid in task_model_by_id:
                model = task_model_by_id[tid]
            else:
                model = "—"
        else:
            model = "—"

        ct = _format_tx_created_at_display(r.get("created_at"))

        if tt in ("consume", "consume_pending"):
            amt_raw = r.get("amount")
            n = _scalar_display(amt_raw)
            try:
                fee = abs(int(n))
            except Exception:
                try:
                    fee = abs(int(float(n)))
                except Exception:
                    fee = str(amt_raw) if amt_raw is not None else "—"
        elif tt in ("recharge", "adjust", "refund", "welcome_bonus"):
            amt_raw = r.get("amount")
            n = _scalar_display(amt_raw)
            try:
                iv = int(n)
                fee = f"+{iv}" if iv > 0 else str(iv)
            except Exception:
                try:
                    fv = float(n)
                    iv = int(fv)
                    fee = f"+{iv}" if iv > 0 else str(iv)
                except Exception:
                    fee = str(amt_raw) if amt_raw is not None else "—"
        else:
            fee = "—"

        bal = _scalar_display(r.get("balance_after"))

        out.append(
            {
                "使用模型": model,
                "扣费时间": ct if ct else "—",
                "扣费金额(元宝)": fee,
                "类型": str(r.get("type") or ""),
                "transaction_id": txid,
                "task_id": tid if tid else "—",
                "交易后余额": bal if bal is not None else "—",
                "备注": desc if desc else "—",
            }
        )
    return pd.DataFrame(out)


def _coupon_used_flag(rec: dict[str, Any]) -> bool:
    u = rec.get("used")
    if u is True or u == 1:
        return True
    s = str(u).strip().lower()
    if s in ("true", "1", "yes"):
        return True
    iu = rec.get("is_used")
    if iu is True or iu == 1:
        return True
    si = str(iu).strip().lower()
    return si in ("true", "1", "yes")


def filter_coupon_rows_by_used_state(
    rows: list[dict[str, Any]],
    mode: str,
) -> list[dict[str, Any]]:
    """mode: all | used | unused；与列 used / is_used 一致（经 _coupon_used_flag）。"""
    m = (mode or "all").strip().lower()
    if m == "used":
        return [r for r in rows if _coupon_used_flag(r)]
    if m == "unused":
        return [r for r in rows if not _coupon_used_flag(r)]
    return list(rows)


def fetch_user_emails_by_ids(client: Any, users_table: str, uids: set[str]) -> dict[str, str]:
    """user_id → 注册邮箱（nx_users 列 email）。"""
    out: dict[str, str] = {}
    ut = users_table.strip()
    for uid in uids:
        u = str(uid).strip()
        if not u:
            continue
        rec = _ots_get_row_dict(client, ut, [("user_id", u)])
        if rec:
            em = str(rec.get("email") or "").strip()
            if em:
                out[u] = em
    return out


def issued_for_user_ids_from_coupon_rows(rows: list[dict[str, Any]]) -> set[str]:
    s: set[str] = set()
    for r in rows:
        x = str(r.get("issued_for_user_id") or "").strip()
        if x:
            s.add(x)
    return s


def coupons_to_display_dataframe(
    rows: list[dict[str, Any]],
    *,
    email_by_uid: dict[str, str] | None = None,
) -> pd.DataFrame:
    """兑换码表展示用 DataFrame（中文列名）。签发目标后的「用户账号」为 nx_users.email。"""
    email_by_uid = email_by_uid or {}
    if not rows:
        return pd.DataFrame(
            columns=[
                "兑换码",
                "面值(元)",
                "是否已核销",
                "核销用户 ID",
                "核销时间",
                "创建时间",
                "签发目标用户 ID",
                "用户账号",
            ]
        )
    rows2: list[dict[str, Any]] = []
    for r in rows:
        code = str(r.get("code") or "")
        amt = str(r.get("amount_cny") or "").strip()
        used = _coupon_used_flag(r)
        uby = str(r.get("used_by_user_id") or "").strip() or None
        uat = str(r.get("used_at") or "").strip() or None
        cat = r.get("created_at")
        cat_disp: Any = None
        if cat is not None:
            n = _scalar_display(cat)
            if isinstance(n, int) and n > 0:
                ms = n if n > 1_000_000_000_000 else n * 1000
                try:
                    cat_disp = pd.Timestamp(ms, unit="ms").strftime("%Y-%m-%d %H:%M:%S")
                except Exception:
                    cat_disp = str(n)
            else:
                cat_disp = str(cat)
        issued_for = str(r.get("issued_for_user_id") or "").strip() or None
        if issued_for:
            acct = email_by_uid.get(issued_for) or "—"
        else:
            acct = None
        rows2.append(
            {
                "兑换码": code,
                "面值(元)": amt,
                "是否已核销": "是" if used else "否",
                "核销用户 ID": uby,
                "核销时间": uat,
                "创建时间": cat_disp,
                "签发目标用户 ID": issued_for,
                "用户账号": acct,
            }
        )
    return pd.DataFrame(rows2)


def coupons_to_display_dataframe_with_emails(
    client: Any,
    users_table: str,
    rows: list[dict[str, Any]],
) -> pd.DataFrame:
    """兑换码表 + 签发目标对应的注册邮箱（nx_users）。"""
    emap = fetch_user_emails_by_ids(
        client,
        users_table,
        issued_for_user_ids_from_coupon_rows(rows),
    )
    return coupons_to_display_dataframe(rows, email_by_uid=emap)


def transactions_recharge_to_display_dataframe(rows: list[dict[str, Any]]) -> pd.DataFrame:
    """充值类流水展示。"""
    if not rows:
        return pd.DataFrame(
            columns=[
                "transaction_id",
                "user_id",
                "amount",
                "type",
                "provider",
                "description",
                "created_at",
                "balance_after",
            ]
        )
    out: list[dict[str, Any]] = []
    for r in rows:
        tid = str(r.get("transaction_id") or r.get("tx_id") or "").strip()
        ca = r.get("created_at")
        ca_disp = ca
        if ca is not None:
            n = _scalar_display(ca)
            if isinstance(n, int) and n > 0:
                ms = n if n > 1_000_000_000_000 else n * 1000
                try:
                    ca_disp = pd.Timestamp(ms, unit="ms").strftime("%Y-%m-%d %H:%M:%S")
                except Exception:
                    ca_disp = n
        amt = r.get("amount")
        bal = r.get("balance_after")
        out.append(
            {
                "transaction_id": tid,
                "user_id": str(r.get("user_id") or ""),
                "amount": _scalar_display(amt),
                "type": str(r.get("type") or ""),
                "provider": str(r.get("provider") or ""),
                "description": str(r.get("description") or ""),
                "created_at": ca_disp,
                "balance_after": _scalar_display(bal),
            }
        )
    return pd.DataFrame(out)


def filter_coupons_by_used_user_id(rows: list[dict[str, Any]], user_id: str) -> list[dict[str, Any]]:
    uid = str(user_id or "").strip()
    if not uid:
        return []
    return [r for r in rows if str(r.get("used_by_user_id") or "").strip() == uid]


def filter_coupons_by_issued_for_user_id(rows: list[dict[str, Any]], user_id: str) -> list[dict[str, Any]]:
    uid = str(user_id or "").strip()
    if not uid:
        return []
    return [r for r in rows if str(r.get("issued_for_user_id") or "").strip() == uid]


def rows_to_dataframe(rows: list[dict[str, Any]]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame(
            columns=[
                "model_id",
                "function_name",
                "is_active",
                "base_price",
                "multiplier",
                "yuanbao_rate",
            ]
        )
    df = pd.DataFrame(rows)
    for c in ("model_id", "function_name", "is_active", "base_price", "multiplier", "yuanbao_rate"):
        if c not in df.columns:
            df[c] = None
    cols = ["model_id", "function_name", "is_active", "base_price", "multiplier", "yuanbao_rate"]
    extra = [c for c in df.columns if c not in cols]
    return df[cols + extra]


def update_model_row(
    client,
    table_name: str,
    model_id: str,
    *,
    function_name: str,
    base_price: float,
    multiplier: float,
    is_active: bool,
    yuanbao_rate: float,
) -> None:
    from tablestore import Condition, Row, RowExistenceExpectation

    primary_key = [("model_id", model_id)]
    put_attrs: list[tuple[str, Any]] = [
        ("function_name", str(function_name).strip() or str(model_id).strip()),
        ("base_price", float(base_price)),
        ("multiplier", float(multiplier)),
        ("is_active", bool(is_active)),
        ("yuanbao_rate", float(yuanbao_rate)),
    ]
    update_of_attribute_columns = {"put": put_attrs}
    row = Row(primary_key, update_of_attribute_columns)
    cond = Condition(RowExistenceExpectation.EXPECT_EXIST, None)
    client.update_row(table_name, row, cond)


def delete_model_row(client, table_name: str, model_id: str) -> None:
    from tablestore import Condition, Row, RowExistenceExpectation

    row = Row([("model_id", str(model_id).strip())])
    cond = Condition(RowExistenceExpectation.EXPECT_EXIST, None)
    client.delete_row(table_name, row, cond)


def insert_model_row(
    client,
    table_name: str,
    *,
    model_id: str,
    function_name: str,
    base_price: float = 0.01,
    multiplier: float = 1.0,
    yuanbao_rate: float = 10.0,
    is_active: bool = True,
) -> None:
    from tablestore import Condition, Row, RowExistenceExpectation

    primary_key = [("model_id", model_id.strip())]
    attribute_columns = [
        ("function_name", str(function_name).strip()),
        ("is_active", bool(is_active)),
        ("base_price", float(base_price)),
        ("multiplier", float(multiplier)),
        ("yuanbao_rate", float(yuanbao_rate)),
    ]
    row = Row(primary_key, attribute_columns)
    cond = Condition(RowExistenceExpectation.EXPECT_NOT_EXIST, None)
    client.put_row(table_name, row, cond)


def _norm_float(v: Any, default: float = 0.0) -> float:
    try:
        if v is None or (isinstance(v, float) and pd.isna(v)):
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


def _norm_bool(v: Any) -> bool:
    if v is None:
        return False
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)) and not (isinstance(v, float) and pd.isna(v)):
        return bool(int(v))
    return bool(v)


def sort_rows_by_model_id(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(rows, key=lambda r: str(r.get("model_id") or ""))


def dataframe_for_editor(rows: list[dict[str, Any]]) -> pd.DataFrame:
    """仅保留可编辑表所需列，类型适合 data_editor。"""
    core = ["model_id", "function_name", "is_active", "base_price", "multiplier", "yuanbao_rate"]
    df = rows_to_dataframe(sort_rows_by_model_id(rows))
    df = df[[c for c in core if c in df.columns]].copy()
    for c in ("base_price", "multiplier", "yuanbao_rate"):
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    if "is_active" in df.columns:
        df["is_active"] = df["is_active"].apply(_norm_bool)
    return df


def _row_fields_equal(
    o: dict[str, Any],
    fn: str,
    bp: float,
    mul: float,
    yr: float,
    act: bool,
) -> bool:
    eps = 1e-9
    fn_old = str(o.get("function_name", "") or "").strip()
    if fn_old != fn:
        return False
    if abs(_norm_float(o.get("base_price"), 0.01) - bp) > eps:
        return False
    if abs(_norm_float(o.get("multiplier"), 1.0) - mul) > eps:
        return False
    if abs(_norm_float(o.get("yuanbao_rate"), 10.0) - yr) > eps:
        return False
    if _norm_bool(o.get("is_active")) != act:
        return False
    return True


def save_full_table(
    client,
    table_name: str,
    original_rows: list[dict[str, Any]],
    edited_df: pd.DataFrame,
) -> tuple[int, int, int, list[str]]:
    """
    将表格内容同步到 OTS：更新已有主键、插入新主键、删除表格中已去掉的行。
    返回 (更新条数, 插入条数, 删除条数, 错误信息列表)。
    """
    orig_by_id = {str(r.get("model_id", "")).strip(): r for r in original_rows if r.get("model_id")}
    orig_ids = set(orig_by_id.keys())
    errors: list[str] = []
    updated = inserted = deleted = 0

    by_mid: dict[str, Any] = {}
    for i in range(len(edited_df)):
        row = edited_df.iloc[i]
        mid = str(row.get("model_id", "") or "").strip()
        if not mid:
            continue
        by_mid[mid] = row

    edited_ids = set(by_mid.keys())

    for oid in orig_ids - edited_ids:
        try:
            delete_model_row(client, table_name, oid)
            deleted += 1
        except Exception as e:
            errors.append(f"删除 {oid}: {e}")

    for mid, row in by_mid.items():
        fn = str(row.get("function_name", "") or "").strip() or mid
        bp = _norm_float(row.get("base_price"), 0.01)
        mul = _norm_float(row.get("multiplier"), 1.0)
        yr = _norm_float(row.get("yuanbao_rate"), 10.0)
        act = _norm_bool(row.get("is_active"))
        if mid in orig_ids:
            o = orig_by_id[mid]
            if _row_fields_equal(o, fn, bp, mul, yr, act):
                continue
            try:
                update_model_row(
                    client,
                    table_name,
                    mid,
                    function_name=fn,
                    base_price=bp,
                    multiplier=mul,
                    is_active=act,
                    yuanbao_rate=yr,
                )
                updated += 1
            except Exception as e:
                errors.append(f"更新 {mid}: {e}")
        else:
            try:
                insert_model_row(
                    client,
                    table_name,
                    model_id=mid,
                    function_name=fn,
                    base_price=bp,
                    multiplier=mul,
                    yuanbao_rate=yr,
                    is_active=act,
                )
                inserted += 1
            except Exception as e:
                errors.append(f"新增 {mid}: {e}")

    return updated, inserted, deleted, errors


def main() -> None:
    st.set_page_config(
        page_title="Aixflow",
        layout="wide",
        initial_sidebar_state="collapsed",
    )
    st.title("Aixflow管理员界面")
    st.caption(
        "阿里云表格存储 · **工厂队列**、**近期用量**、**官方邮件**、**模型定价**、**兑换码**、**用户管理**、**财务分析**（本页直连 OTS）；"
        "全站排队/用量请在本工具对应页签查看。"
        "桌面端 **NEXFLOW #/admin** 仅作兑换码等运营入口，不展示全站队列。"
    )

    if "_aixflow_auth_ok" not in st.session_state:
        st.session_state["_aixflow_auth_ok"] = False

    if not st.session_state["_aixflow_auth_ok"]:
        render_password_gate()
        st.stop()

    init_vault_session_state()

    if st.session_state.get("_vault_decrypt_failed"):
        st.warning(
            "本地加密凭据无法解密（例如访问密码已修改）。可点击侧栏 **清除本地凭据** 后重新填写并保存。"
        )

    with st.sidebar:
        st.subheader("表格存储连接")
        endpoint = st.text_input("服务 Endpoint（公网地址）", key=_field_key("endpoint"), help="Tablestore 公网 Endpoint")
        instance = st.text_input("实例名称", key=_field_key("instance"))
        table_name = st.text_input("模型定价表名", key=_field_key("table_name"))
        coupons_table = st.text_input(
            "兑换码表名",
            key=_field_key("coupons_table"),
            help="默认 nx_coupons，与 FC 环境变量 OTS_TABLE_COUPONS 一致",
        )
        ak = st.text_input(
            "访问密钥 ID（AccessKey ID）",
            key=_field_key("ots_ak"),
            help="可保存到本地加密文件，见下方按钮",
        )
        sk = st.text_input(
            "访问密钥（AccessKey Secret）",
            type="password",
            key=_field_key("ots_sk"),
        )
        st.divider()
        st.subheader("核心算力（BLTCY）")
        core_api_base = st.text_input(
            "核心算力 API URL",
            key=_field_key("core_base"),
            help="填根地址即可，例如 https://api.apilio.ai；若粘贴完整路径 …/v1/token/quota 也可，不会重复拼接。",
        )
        core_api_key = st.text_input(
            "核心算力 API Key",
            type="password",
            key=_field_key("core_key"),
            help="用于 GET /v1/token/quota，Header：Authorization: Bearer <API_KEY>",
        )
        st.divider()
        st.subheader("插件算力（RunningHub）")
        plugin_api_base = st.text_input(
            "插件算力 API URL",
            key=_field_key("plugin_base"),
            help="示例：https://www.runninghub.cn；请求 POST /uc/openapi/accountStatus，支持只填根地址或完整路径。",
        )
        plugin_api_key = st.text_input(
            "插件算力 API Key",
            type="password",
            key=_field_key("plugin_key"),
            help="Bearer 与 JSON body 中的 apikey 均使用此 Key（与 OpenAPI 一致）。",
        )
        st.divider()
        st.caption(
            f"本地加密文件（勿提交 Git）：`{credential_file_path()}` · 使用 **访问密码** 加密"
        )
        if st.button("保存凭据到本地（加密）", key="btn_save_vault"):
            vpw = (st.session_state.get("_vault_pw") or "").strip()
            if not vpw:
                st.error("会话已失效，请退出后重新登录再保存。")
            else:
                try:
                    payload = _collect_fields_for_save()
                    write_credential_file(encrypt_credentials(vpw, payload))
                    st.success("已保存。下次进入后台将自动填充。")
                except Exception as e:
                    st.error(f"保存失败：{e}")
        if st.button("清除本地凭据", key="btn_clear_vault"):
            delete_credential_file()
            clear_vault_ui_keys()
            st.session_state.pop("_vault_seeded", None)
            st.session_state.pop("_vault_decrypt_failed", None)
            st.rerun()
        if st.button("退出登录"):
            st.session_state["_aixflow_auth_ok"] = False
            st.session_state.pop("_vault_pw", None)
            st.session_state.pop("_vault_seeded", None)
            clear_vault_ui_keys()
            st.rerun()

    if not ak.strip() or not sk.strip():
        st.warning(
            "未检测到 AccessKey：请在 **本目录** 放置 `.streamlit/secrets.toml`（推荐），"
            "或设置环境变量 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET，或在侧边栏填写。"
        )
        st.stop()

    try:
        client = build_client(endpoint, instance, ak, sk)
    except Exception as e:
        st.error(f"创建表格存储客户端失败：{e}")
        st.stop()

    with st.sidebar:
        if st.button("测试连接"):
            try:
                from tablestore import Direction, INF_MAX, INF_MIN

                _inc = [("model_id", INF_MIN)]
                _exc = [("model_id", INF_MAX)]
                client.get_range(
                    table_name.strip(),
                    Direction.FORWARD,
                    _inc,
                    _exc,
                    columns_to_get=None,
                    limit=1,
                )
                st.success("连接正常，已能访问指定数据表。")
            except Exception as e:
                st.error(f"连接失败：{e}")
        if st.button("刷新算力数据"):
            st.session_state.pop("_platform_balance_cache", None)
            st.session_state.pop("_plugin_account_cache", None)
            st.rerun()

    bal_sig = (core_api_base.strip(), core_api_key.strip())
    if st.session_state.get("_platform_balance_sig") != bal_sig:
        st.session_state["_platform_balance_sig"] = bal_sig
        st.session_state.pop("_platform_balance_cache", None)

    plug_sig = (plugin_api_base.strip(), plugin_api_key.strip())
    if st.session_state.get("_plugin_account_sig") != plug_sig:
        st.session_state["_plugin_account_sig"] = plug_sig
        st.session_state.pop("_plugin_account_cache", None)

    if "_platform_balance_cache" not in st.session_state:
        st.session_state["_platform_balance_cache"] = fetch_token_quota(core_api_base, core_api_key)
    if "_plugin_account_cache" not in st.session_state:
        st.session_state["_plugin_account_cache"] = fetch_runninghub_account_status(plugin_api_base, plugin_api_key)

    pb = st.session_state.get("_platform_balance_cache", {})
    pb_ok = pb.get("ok") is True
    pb_val = pb.get("quota")
    pb_err = pb.get("error")

    pg = st.session_state.get("_plugin_account_cache", {})
    pg_ok = pg.get("ok") is True
    pg_money = pg.get("remain_money")
    pg_cur = pg.get("currency")
    pg_err = pg.get("error")

    m1, m2 = st.columns(2)
    with m1:
        if pb_ok and pb_val is not None:
            st.metric("核心算力", f"{float(pb_val):,.4f}")
        else:
            st.metric("核心算力", "—")
    with m2:
        if pg_ok and pg_money is not None:
            wallet_label = pg_money
            if pg_cur:
                wallet_label = f"{pg_money} {pg_cur}"
            st.metric("钱包余额", wallet_label)
        else:
            st.metric("钱包余额", "—")
    if pb_err:
        st.warning(f"【核心算力】{pb_err}")
    if pg_err:
        st.warning(f"【插件 / 钱包】{pg_err}")
    if not core_api_base.strip() or not core_api_key.strip():
        st.info("核心算力：请在左侧填写 **核心算力 API URL** 与 **核心算力 API Key**，然后点「刷新算力数据」。")
    if not plugin_api_base.strip() or not plugin_api_key.strip():
        st.info("插件算力：请在左侧填写 **插件算力 API URL** 与 **插件算力 API Key**，然后点「刷新算力数据」。")

    conn_sig = (endpoint.strip(), instance.strip(), table_name.strip(), coupons_table.strip(), ak.strip(), sk.strip())
    if st.session_state.get("_ots_conn_sig") != conn_sig:
        st.session_state["_ots_conn_sig"] = conn_sig
        st.session_state.pop("_rows_cache", None)
        st.session_state.pop("_coupons_cache", None)
        st.session_state.pop("_coupons_cache_table", None)
        st.session_state.pop("_all_users_cache", None)
        st.session_state.pop("_all_users_cache_table", None)
        st.session_state.pop("_all_users_truncated", None)
        st.session_state.pop("_all_users_cache_max", None)
        st.session_state.pop("_profit_result", None)
        st.session_state.pop("_queue_factory_stats", None)
        st.session_state.pop("_recent_usage_stats", None)

    tx_gsi_name = get_ots_tx_gsi_name_default()
    tx_sort_key = get_ots_tx_sort_key_default()
    email_table = get_ots_email_table_default()
    users_table = get_ots_users_table_default()
    tasks_table = get_ots_tasks_table_default()
    queue_counters_table = get_ots_queue_counters_table_default()

    (
        tab_queue,
        tab_usage,
        tab_mail,
        tab_model,
        tab_coupon,
        tab_users_mgmt,
        tab_finance,
        tab_user_query,
        tab_user_gen,
    ) = st.tabs(
        [
            "工厂队列",
            "近期用量",
            "官方邮件",
            "模型定价（nx_model_config）",
            "兑换码（nx_coupons）",
            "用户管理（nx_users）",
            "财务分析",
            "用户查询（账号）",
            "任务记录",
        ]
    )

    with tab_queue:
        st.subheader("全站工厂负载（所有用户）")
        st.caption(
            f"直连扫描 **`{tasks_table}`**：排队中 = `queued`；"
            "生产中 = `claimed` + `running`（含 legacy `pending` / `processing`）。"
            f" 平台槽读 **`{queue_counters_table}`**（若表存在）。"
        )
        q_max = st.number_input(
            "最多扫描任务行数",
            min_value=5000,
            max_value=200000,
            value=40000,
            step=5000,
            key="queue_factory_max_scan",
            help="越大越准但越慢；达到上限后计数可能略低。",
        )
        if st.button("刷新队列统计", type="primary", key="btn_queue_factory_refresh"):
            st.session_state.pop("_queue_factory_stats", None)
            with st.spinner("正在扫描 nx_tasks…"):
                try:
                    st.session_state["_queue_factory_stats"] = scan_queue_factory_stats(
                        client,
                        tasks_table=tasks_table,
                        queue_counters_table=queue_counters_table,
                        max_task_scan=int(q_max),
                    )
                except Exception as e:
                    st.session_state["_queue_factory_stats"] = {"_error": str(e)}

        qs: Any = st.session_state.get("_queue_factory_stats")
        if qs is None:
            st.info("点击 **刷新队列统计** 查看当前全站排队 / 生产数量。")
        elif isinstance(qs, dict) and qs.get("_error"):
            st.error(f"扫描失败：{qs['_error']}")
        elif isinstance(qs, dict):
            if qs.get("task_scan_truncated"):
                st.warning(
                    f"任务扫描已达上限（{qs.get('task_rows_scanned', 0)} 行），计数可能略低于真实值。"
                )
            c1, c2, c3 = st.columns(3)
            with c1:
                st.metric(
                    "排队中",
                    int(qs.get("queued_tasks", 0)),
                    help="status=queued",
                )
                st.caption(
                    f"视频 {int(qs.get('queued_video_tasks', 0))} · "
                    f"图片 {int(qs.get('queued_image_tasks', 0))}"
                )
            with c2:
                st.metric(
                    "生产中",
                    int(qs.get("producing_tasks", 0)),
                    help="claimed + running + pending + processing",
                )
                st.caption(
                    f"视频 {int(qs.get('producing_video_tasks', 0))} · "
                    f"图片 {int(qs.get('producing_image_tasks', 0))}"
                )
                st.caption(
                    f"claimed {int(qs.get('claimed_tasks', 0))} · "
                    f"running {int(qs.get('running_tasks', 0))}"
                )
            with c3:
                st.metric(
                    "失败 / 超时（表内）",
                    int(qs.get("pending_failed_or_timeout_tasks", 0)),
                )
                st.caption(f"已扫描 {int(qs.get('task_rows_scanned', 0))} 行任务")

            st.divider()
            p1, p2 = st.columns(2)
            with p1:
                vr = qs.get("platform_video_running")
                st.write("**平台视频并发槽占用**")
                st.write("—" if vr is None else str(int(vr)))
            with p2:
                ir = qs.get("platform_image_running")
                st.write("**平台图片并发槽占用**")
                st.write("—" if ir is None else str(int(ir)))

    with tab_usage:
        st.subheader("近期使用量与活跃账号")
        st.caption(
            f"扫描流水表 **`{get_ots_transactions_table_default()}`**（`type=consume`）统计窗口内全站消耗；"
            "活跃账号 = 窗口内至少产生 1 笔扣费的用户。登录活跃另按 **`nx_users.last_login_at`** 统计。"
            "下方 **全站模型生成明细** 可按日期、按某一模型筛选，查看该模型最近所有用户的使用（日期 / 账号 / 模型 / 消耗价格）。"
        )
        uc1, uc2, uc3 = st.columns(3)
        with uc1:
            usage_days = st.selectbox(
                "统计窗口",
                options=[1, 3, 7, 14, 30],
                index=2,
                format_func=lambda d: f"近 {d} 天",
                key="recent_usage_days",
            )
        with uc2:
            usage_max_tx = st.number_input(
                "最多扫描流水行数",
                min_value=5000,
                max_value=200000,
                value=80000,
                step=5000,
                key="recent_usage_max_tx",
            )
        with uc3:
            usage_top_n = st.number_input(
                "活跃账号榜显示条数",
                min_value=20,
                max_value=500,
                value=100,
                step=20,
                key="recent_usage_top_n",
            )
        usage_include_login = st.checkbox(
            "同时统计登录活跃（扫描用户表，较慢）",
            value=True,
            key="recent_usage_include_login",
        )

        if st.button("查询近期用量", type="primary", key="btn_recent_usage_run"):
            st.session_state.pop("_recent_usage_stats", None)
            with st.spinner("正在扫描流水与补全账号邮箱，请稍候…"):
                try:
                    st.session_state["_recent_usage_stats"] = aggregate_recent_usage_and_active(
                        client,
                        tx_table=get_ots_transactions_table_default(),
                        tx_pk=tx_sort_key,
                        users_table=users_table,
                        window_days=int(usage_days),
                        max_tx_scan=int(usage_max_tx),
                        top_accounts=int(usage_top_n),
                        include_login_active=bool(usage_include_login),
                    )
                except Exception as e:
                    st.session_state["_recent_usage_stats"] = {"_error": str(e)}

        ru: Any = st.session_state.get("_recent_usage_stats")
        if ru is None:
            st.info("选择窗口后点击 **查询近期用量**。")
        elif isinstance(ru, dict) and ru.get("_error"):
            st.error(f"查询失败：{ru['_error']}")
        elif isinstance(ru, dict):
            if ru.get("tx_scan_truncated"):
                st.warning("流水扫描已达行数上限，近期用量可能不完整；可提高扫描上限后重查。")
            st.caption(
                f"{ru.get('window_label', '')} · 流水扫描 {int(ru.get('tx_rows_scanned', 0))} 行"
            )
            m1, m2, m3, m4 = st.columns(4)
            with m1:
                st.metric("消耗元宝", f"{int(ru.get('total_consume_yuanbao', 0)):,}")
            with m2:
                st.metric("扣费笔数", f"{int(ru.get('total_consume_count', 0)):,}")
            with m3:
                st.metric("活跃账号（有扣费）", f"{int(ru.get('active_accounts', 0)):,}")
            with m4:
                st.metric("人均消耗（元宝）", f"{int(ru.get('avg_yuanbao_per_active', 0)):,}")

            login_n = ru.get("login_active_accounts")
            if ru.get("include_login_active") is False:
                st.caption("未勾选登录活跃统计。")
            elif login_n is not None and int(login_n) >= 0:
                st.caption(
                    f"同窗登录活跃（`last_login_at`）：**{int(login_n):,}** "
                    f"（用户表扫描 {int(ru.get('users_scanned_for_login', 0))} 行"
                    f"{'，已截断' if ru.get('users_login_scan_truncated') else ''}）"
                )
            elif login_n is not None and int(login_n) < 0:
                st.caption("登录活跃统计失败（用户表不可读），不影响扣费用量。")

            st.divider()
            st.markdown("##### 按日趋势")
            daily = ru.get("daily") or []
            if daily:
                df_day = pd.DataFrame(daily).rename(
                    columns={
                        "day": "日期",
                        "consume_yuanbao": "消耗元宝",
                        "consume_count": "扣费笔数",
                        "active_accounts": "当日活跃账号",
                    }
                )
                st.dataframe(df_day, use_container_width=True, hide_index=True)
                try:
                    chart_df = df_day.set_index("日期")[["消耗元宝"]]
                    st.line_chart(chart_df)
                except Exception:
                    pass
            else:
                st.info("该窗口内无扣费流水。")

            st.divider()
            st.markdown("##### 活跃账号榜（按消耗元宝）")
            tops = ru.get("top_accounts") or []
            if tops:
                rows_disp: list[dict[str, Any]] = []
                for a in tops:
                    last_c = int(a.get("last_consume_ms") or 0)
                    last_c_s = "—"
                    if last_c > 0:
                        try:
                            last_c_s = pd.Timestamp(last_c, unit="ms").strftime("%Y-%m-%d %H:%M:%S")
                        except Exception:
                            last_c_s = str(last_c)
                    ll = a.get("last_login_ms")
                    ll_s = "—"
                    if ll is not None:
                        try:
                            ln = int(ll)
                            if ln > 0:
                                ll_s = pd.Timestamp(ln, unit="ms").strftime("%Y-%m-%d %H:%M:%S")
                        except Exception:
                            pass
                    rows_disp.append(
                        {
                            "邮箱": a.get("email") or "—",
                            "用户 ID": a.get("user_id") or "",
                            "消耗元宝": int(a.get("consume_yuanbao") or 0),
                            "扣费笔数": int(a.get("consume_count") or 0),
                            "最近扣费": last_c_s,
                            "最近登录": ll_s,
                            "状态": a.get("status") or "—",
                        }
                    )
                df_acc = pd.DataFrame(rows_disp)
                st.dataframe(df_acc, use_container_width=True, hide_index=True)
                csv_buf = io.StringIO()
                df_acc.to_csv(csv_buf, index=False)
                st.download_button(
                    "下载活跃账号 CSV",
                    data=csv_buf.getvalue().encode("utf-8-sig"),
                    file_name=f"active_accounts_{int(ru.get('window_days', 7))}d.csv",
                    mime="text/csv",
                    key="dl_recent_usage_accounts",
                )
            else:
                st.info("无活跃账号。")

            st.divider()
            st.markdown("##### 模型消耗 Top（窗口内）")
            models = ru.get("top_models") or []
            if models:
                df_m = pd.DataFrame(models).rename(
                    columns={
                        "model_id": "模型 ID",
                        "consume_yuanbao": "消耗元宝",
                        "consume_count": "扣费笔数",
                    }
                )
                st.dataframe(df_m, use_container_width=True, hide_index=True)
            else:
                st.caption("无模型维度数据。")

            st.divider()
            st.markdown("##### 全站模型生成明细（所有用户混合）")
            st.caption(
                "逐笔扣费：**日期 / 账号 / 模型 / 消耗价格（元宝）**。"
                "可按日期、按某一模型筛选（查该模型最近所有用户的使用情况）。"
            )
            if ru.get("detail_rows_truncated"):
                st.warning(
                    f"明细已截断：窗口内共 {int(ru.get('detail_rows_total', 0)):,} 笔，"
                    f"仅保留最近 {len(ru.get('detail_rows') or []):,} 笔。"
                )
            details = ru.get("detail_rows") or []
            if not details:
                st.info("该窗口内无扣费明细。")
            else:
                from datetime import date as _date_cls

                today_key = str(ru.get("today_key") or "").strip()
                day_options = [str(d.get("day") or "") for d in (ru.get("daily") or []) if d.get("day")]
                day_options = sorted(set(day_options), reverse=True)

                # 窗口内出现过的模型（明细 + Top 汇总），供下拉选择
                model_ids_in_window: list[str] = []
                seen_m: set[str] = set()
                for mrow in ru.get("top_models") or []:
                    mid0 = str(mrow.get("model_id") or "").strip()
                    if mid0 and mid0 not in seen_m:
                        seen_m.add(mid0)
                        model_ids_in_window.append(mid0)
                for r0 in details:
                    mid0 = str(r0.get("model_id") or "").strip()
                    if mid0 == "_unknown":
                        mid0 = str(r0.get("description") or "").strip() or "_unknown"
                    if mid0 and mid0 not in seen_m:
                        seen_m.add(mid0)
                        model_ids_in_window.append(mid0)
                model_ids_in_window = sorted(model_ids_in_window, key=lambda s: s.lower())

                fc1, fc2 = st.columns([1, 2])
                with fc1:
                    day_mode = st.radio(
                        "日期筛选",
                        options=["今天", "指定日期", "窗口内全部"],
                        index=0,
                        horizontal=True,
                        key="recent_usage_detail_day_mode",
                    )
                pick_day = today_key
                with fc2:
                    if day_mode == "指定日期":
                        default_d = _date_cls.today()
                        if today_key:
                            try:
                                y, m, dd = today_key.split("-")
                                default_d = _date_cls(int(y), int(m), int(dd))
                            except Exception:
                                pass
                        # 可选范围：窗口内有数据的日期；否则允许任意日
                        min_d = default_d
                        max_d = default_d
                        if day_options:
                            try:
                                min_d = _date_cls.fromisoformat(day_options[-1])
                                max_d = _date_cls.fromisoformat(day_options[0])
                            except Exception:
                                pass
                        picked = st.date_input(
                            "选择日期",
                            value=default_d if min_d <= default_d <= max_d else max_d,
                            min_value=min_d,
                            max_value=max_d,
                            key="recent_usage_detail_date",
                        )
                        pick_day = picked.isoformat() if hasattr(picked, "isoformat") else str(picked)
                    elif day_mode == "今天":
                        pick_day = today_key
                        st.caption(f"今天（上海）：**{today_key or '—'}**")
                    else:
                        pick_day = ""
                        st.caption("显示统计窗口内全部明细（已按时间倒序）。")

                mc_sel, mc_kw = st.columns([2, 2])
                with mc_sel:
                    model_pick = st.selectbox(
                        "模型筛选",
                        options=["（全部模型）"] + model_ids_in_window,
                        index=0,
                        key="recent_usage_detail_model",
                        help="选择某一模型后，只看该模型在窗口内所有用户的扣费明细。",
                    )
                with mc_kw:
                    model_kw = st.text_input(
                        "或输入模型 ID（包含匹配）",
                        value="",
                        key="recent_usage_detail_model_kw",
                        placeholder="例如 rhart-video-upscaler-4k",
                        help="填写后优先按此关键字过滤（不区分大小写，子串匹配）；留空则用上方下拉。",
                    )

                filtered = details
                if day_mode != "窗口内全部" and pick_day:
                    filtered = [r for r in filtered if str(r.get("day") or "") == pick_day]

                kw = str(model_kw or "").strip().lower()
                if kw:
                    def _row_model_id(r: dict[str, Any]) -> str:
                        mid = str(r.get("model_id") or "").strip()
                        if mid == "_unknown" or not mid:
                            mid = str(r.get("description") or "").strip() or ""
                        return mid

                    filtered = [r for r in filtered if kw in _row_model_id(r).lower()]
                elif model_pick and model_pick != "（全部模型）":
                    want = str(model_pick).strip().lower()

                    def _row_model_id2(r: dict[str, Any]) -> str:
                        mid = str(r.get("model_id") or "").strip()
                        if mid == "_unknown" or not mid:
                            mid = str(r.get("description") or "").strip() or ""
                        return mid

                    filtered = [r for r in filtered if _row_model_id2(r).lower() == want]

                disp_rows: list[dict[str, Any]] = []
                sum_yb = 0
                accounts_in_filter: set[str] = set()
                for r in filtered:
                    cms = int(r.get("created_at_ms") or 0)
                    t_s = "—"
                    if cms > 0:
                        try:
                            t_s = pd.Timestamp(cms, unit="ms", tz="Asia/Shanghai").strftime(
                                "%Y-%m-%d %H:%M:%S"
                            )
                        except Exception:
                            t_s = str(cms)
                    yb = int(r.get("yuanbao") or 0)
                    sum_yb += yb
                    mid = str(r.get("model_id") or "_unknown")
                    if mid == "_unknown":
                        mid = str(r.get("description") or "—") or "—"
                    email = str(r.get("email") or "—").strip() or "—"
                    uid = str(r.get("user_id") or "").strip()
                    accounts_in_filter.add(uid or email)
                    disp_rows.append(
                        {
                            "日期": str(r.get("day") or "") or "—",
                            "账号": email,
                            "模型": mid,
                            "消耗价格（元宝）": yb,
                            "时间": t_s,
                            "用户 ID": uid,
                            "task_id": r.get("task_id") or "—",
                        }
                    )

                mc1, mc2, mc3 = st.columns(3)
                with mc1:
                    st.metric("本筛选笔数", f"{len(disp_rows):,}")
                with mc2:
                    st.metric("本筛选消耗价格（元宝）", f"{sum_yb:,}")
                with mc3:
                    st.metric("本筛选账号数", f"{len(accounts_in_filter):,}")

                if not disp_rows:
                    st.info("当前日期/模型筛选下无扣费记录。")
                else:
                    # 主表突出：日期 / 账号 / 模型 / 消耗价格
                    df_det = pd.DataFrame(disp_rows)[
                        ["日期", "账号", "模型", "消耗价格（元宝）", "时间", "用户 ID", "task_id"]
                    ]
                    st.dataframe(df_det, use_container_width=True, hide_index=True)
                    csv_det = io.StringIO()
                    df_det.to_csv(csv_det, index=False)
                    day_tag = pick_day or f"{int(ru.get('window_days', 7))}d"
                    model_tag = "all"
                    if kw:
                        model_tag = kw.replace("/", "_")[:48]
                    elif model_pick and model_pick != "（全部模型）":
                        model_tag = str(model_pick).replace("/", "_")[:48]
                    st.download_button(
                        "下载明细 CSV",
                        data=csv_det.getvalue().encode("utf-8-sig"),
                        file_name=f"usage_detail_{day_tag}_{model_tag}.csv",
                        mime="text/csv",
                        key="dl_recent_usage_detail",
                    )

    with tab_mail:
        st.subheader("以 AIXFLOW 官方身份发邮件")
        st.caption(
            "经 **Resend** 发送，发件人默认与登录验证码一致（`RESEND_FROM_EMAIL`，如 "
            "`AIXFLOW <auth@aixflow.ai>`）。密钥读取顺序：`.streamlit/secrets.toml` → 环境变量 → 仓库根目录 `.env`。"
        )
        rk = get_resend_api_key()
        rf = get_resend_from_email()
        if rk:
            st.success(f"Resend 已配置 · From：`{rf}` · Key：`re_…{rk[-4:]}`")
        else:
            st.error(
                "未找到 `RESEND_API_KEY`。请写入仓库 `.env` 或本工具 "
                "`.streamlit/secrets.toml` 的 `resend_api_key`。"
            )

        preset = st.selectbox(
            "快捷模板",
            options=["空白", "超分扣费说明（示例）"],
            index=0,
            key="admin_mail_preset",
        )
        if st.button("套用模板到下方表单", key="btn_admin_mail_apply_preset"):
            if preset == "超分扣费说明（示例）":
                st.session_state["admin_mail_to"] = "fhy1231@outlook.com"
                st.session_state["admin_mail_subj"] = "【AIXFLOW】关于视频超分放大扣费的说明"
                st.session_state["admin_mail_body"] = (
                    "AIXFLOW 用户您好：\n\n"
                    "观察到您近期使用「视频超分放大」时存在异常扣费情况：实际应扣费约 650 元宝，"
                    "实际扣费 11 元宝。系统已经补扣相应额度 500 元宝。\n\n"
                    "往期的视频超分放大扣费若也有类似情况，差额由平台自行承担，希望理解，谢谢。\n\n"
                    "如有疑问，可联系管理员微信：howells532"
                )
            else:
                st.session_state["admin_mail_to"] = ""
                st.session_state["admin_mail_subj"] = ""
                st.session_state["admin_mail_body"] = ""

        mail_to = st.text_input("收件人邮箱", key="admin_mail_to")
        mail_subj = st.text_input("主题", key="admin_mail_subj")
        mail_body = st.text_area("正文", height=220, key="admin_mail_body")
        if "admin_mail_from" not in st.session_state:
            st.session_state["admin_mail_from"] = rf
        mail_from = st.text_input(
            "发件人（一般无需改）",
            key="admin_mail_from",
        )

        if st.button("发送邮件", type="primary", key="btn_admin_mail_send", disabled=not bool(rk)):
            with st.spinner("正在通过 Resend 发送…"):
                result = send_official_resend_email(
                    to_email=mail_to,
                    subject=mail_subj,
                    body_text=mail_body,
                    from_email=mail_from,
                )
            if result.get("ok"):
                st.success(f"已发送 · id=`{result.get('id')}` → `{result.get('to')}`")
            else:
                st.error(f"发送失败：{result.get('error')}")

    with tab_coupon:
        st.subheader("云端兑换码生成")
        st.caption(
            "直接向表格存储 **写入新券**（未使用）。档位须与 FC 充值白名单一致："
            f"**{' / '.join(str(x) for x in COUPON_TIERS_CNY)} 元**。"
        )
        st.caption(
            "若此前仅在 **NEXFLOW 桌面应用** 里用 `#/admin` 生成过兑换码，那是另一入口；"
            "本页使用当前侧边栏的 AccessKey 写 OTS，无需配置 NX_ADMIN_ISSUE_COUPON_SECRET。"
        )
        tier = st.selectbox("选择面值（人民币）", options=list(COUPON_TIERS_CNY), index=2)
        issued_for_account = st.text_input(
            "关联用户账号（可选）",
            key="coupon_issued_for",
            placeholder="注册邮箱，或 user_id",
            help="填写后先按 **nx_email_user** 解析为 user_id 再写入 issued_for_user_id；也可直接填 user_id。",
        )
        st.caption(
            "作用：可选。填写后，本券会带上 **签发目标 user_id**（列 `issued_for_user_id`），"
            "可在 **「用户查询」** 里按「签发目标」筛选；**不填**则视为不记名码。"
            " **「任务记录」** 为 **nx_transactions** 流水，与是否填写本项无关。"
        )
        if st.button("生成兑换码", type="primary", key="btn_issue_coupon"):
            try:
                raw_extra = str(issued_for_account or "").strip()
                extra: str | None = None
                if raw_extra:
                    uid_r, err_r = resolve_account_to_user_id(
                        client,
                        email_table=email_table,
                        users_table=users_table,
                        raw=raw_extra,
                    )
                    if err_r:
                        st.error(err_r)
                    else:
                        extra = uid_r
                if raw_extra and extra is None:
                    pass
                else:
                    code = issue_coupon_once(
                        client,
                        coupons_table.strip(),
                        int(tier),
                        issued_for_user_id=extra,
                    )
                    st.success(f"已写入 **{coupons_table.strip()}**：{tier} 元档")
                    st.code(code, language=None)
                    st.caption("请复制上方兑换码发给用户；用户在客户端设置页「兑换码」中兑换。")
                    st.session_state.pop("_coupons_cache", None)
                    st.session_state.pop("_coupons_cache_table", None)
            except Exception as e:
                st.error(f"签发失败：{e}")

        st.divider()
        st.subheader("兑换码生成记录（全表）")
        st.caption(
            "从 **nx_coupons** 读取；**是否已核销** 依据列 `used`（或 `is_used`）。"
            "核销后 FC 会写入 `used_by_user_id`、`used_at`。"
        )
        # 横向筛选；紫色描边选中态（≈ Tailwind border-purple-500）。本应用仅此处使用 st.radio，若新增其它 radio 需收窄选择器。
        st.markdown(
            """
<style>
    div[data-testid="stRadio"] label {
        background-color: #16161a !important;
        color: #e4e4e7 !important;
        border: 1px solid #3f3f46 !important;
        border-radius: 0.5rem !important;
        padding: 0.4rem 0.85rem !important;
        margin-right: 0.5rem !important;
    }
    div[data-testid="stRadio"] label:has(input[type="radio"]:checked) {
        border: 2px solid #a855f7 !important;
        box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.35) !important;
    }
</style>
            """,
            unsafe_allow_html=True,
        )
        _filter_labels = ["全部", "已核销", "未核销"]
        _sel = st.radio(
            "核销筛选",
            options=_filter_labels,
            horizontal=True,
            key="radio__coupon_records_filter",
            label_visibility="collapsed",
        )
        _filter_mode = {"全部": "all", "已核销": "used", "未核销": "unused"}.get(
            str(_sel or "全部"), "all"
        )

        if st.button("刷新兑换码列表", key="btn_refresh_coupons"):
            st.session_state.pop("_coupons_cache", None)
            st.session_state.pop("_coupons_cache_table", None)
            st.rerun()

        need_load = (
            "_coupons_cache" not in st.session_state
            or st.session_state.get("_coupons_cache_table") != coupons_table.strip()
        )
        if need_load:
            with st.spinner("正在从云端加载兑换码表…"):
                try:
                    st.session_state["_coupons_cache"] = fetch_all_coupon_rows(client, coupons_table.strip())
                    st.session_state["_coupons_cache_table"] = coupons_table.strip()
                except Exception as e:
                    st.error(f"读取兑换码表失败：{e}")
                    st.stop()

        coupon_rows: list[dict[str, Any]] = st.session_state.get("_coupons_cache") or []
        coupon_rows_view = filter_coupon_rows_by_used_state(coupon_rows, _filter_mode)
        if issued_for_user_ids_from_coupon_rows(coupon_rows_view):
            with st.spinner("正在解析签发目标用户账号…"):
                df_coupon = coupons_to_display_dataframe_with_emails(client, users_table, coupon_rows_view)
        else:
            df_coupon = coupons_to_display_dataframe(coupon_rows_view, email_by_uid={})
        st.metric("当前筛选行数", len(coupon_rows_view))
        st.caption(f"全表共 **{len(coupon_rows)}** 行（未筛选）。")
        st.dataframe(df_coupon, use_container_width=True, hide_index=True)

    with tab_users_mgmt:
        st.subheader(f"注册用户列表（{users_table}）")
        st.caption(
            "直接读 Tablestore **用户主表**，已脱敏（**不含密码**）。列对应：`user_id`、`email`、`created_at`→注册、`last_login_at`→最近登录、`status`。"
            " 默认最多加载 **20 万** 行；超出部分请缩小范围或联系扩容扫描上限。"
        )
        max_load = st.number_input(
            "单次最多加载用户数",
            min_value=1000,
            max_value=500_000,
            value=200_000,
            step=10_000,
            key="num_max_users_scan",
            help="防止一次扫描过大导致超时，可按需调低。",
        )
        max_load_i = int(max_load)
        if st.button("从云端加载 / 刷新用户列表", type="primary", key="btn_refresh_all_users"):
            st.session_state.pop("_all_users_cache", None)
            st.session_state.pop("_all_users_cache_table", None)
            st.session_state.pop("_all_users_truncated", None)
            st.session_state.pop("_all_users_cache_max", None)
            st.rerun()

        need_u = (
            "_all_users_cache" not in st.session_state
            or st.session_state.get("_all_users_cache_table") != users_table.strip()
            or st.session_state.get("_all_users_cache_max") != max_load_i
        )
        if need_u:
            with st.spinner(f"正在扫描 {users_table} …"):
                try:
                    rows_u, trunc_u = fetch_all_users_sanitized(
                        client,
                        users_table,
                        max_users=max_load_i,
                    )
                    st.session_state["_all_users_cache"] = rows_u
                    st.session_state["_all_users_cache_table"] = users_table.strip()
                    st.session_state["_all_users_truncated"] = trunc_u
                    st.session_state["_all_users_cache_max"] = max_load_i
                except Exception as e:
                    st.error(f"读取用户表失败：{e}")
                    st.session_state["_all_users_cache"] = []
                    st.session_state["_all_users_cache_table"] = users_table.strip()
                    st.session_state["_all_users_truncated"] = False
                    st.session_state["_all_users_cache_max"] = max_load_i

        all_u: list[dict[str, Any]] = list(st.session_state.get("_all_users_cache") or [])
        trunc_flag = bool(st.session_state.get("_all_users_truncated"))
        total_n = len(all_u)

        st.markdown(
            """
<div style="padding:1rem 1.25rem;border-radius:12px;border:1px solid rgba(255,255,255,0.12);
background:linear-gradient(135deg,rgba(139,92,246,0.12),rgba(34,211,238,0.08));margin-bottom:1rem;">
  <div style="font-size:0.75rem;color:rgba(255,255,255,0.5);letter-spacing:0.05em;">当前注册用户总数</div>
  <div style="font-size:2.25rem;font-weight:700;font-variant-numeric:tabular-nums;
  background:linear-gradient(90deg,#c4b5fd,#e879f9,#67e8f9);-webkit-background-clip:text;
  -webkit-text-fill-color:transparent;background-clip:text;">"""
            + str(total_n)
            + """</div>
</div>
            """,
            unsafe_allow_html=True,
        )
        if trunc_flag:
            st.warning("列表可能不完整：已达到本次加载上限，且表中仍有更多用户行。")

        q_users = st.text_input(
            "筛选（邮箱或用户 ID）",
            key="users_mgmt_filter_q",
            placeholder="输入关键字实时筛选当前已加载列表",
        )
        qlow = str(q_users or "").strip().lower()
        if qlow:
            filtered_u = [
                r
                for r in all_u
                if qlow in str(r.get("user_id") or "").lower()
                or qlow in str(r.get("email") or "").lower()
            ]
        else:
            filtered_u = list(all_u)

        if not all_u:
            st.info("暂无用户数据。若表非空，请点击 **从云端加载 / 刷新用户列表**。")
        else:
            df_u = users_admin_rows_to_dataframe(filtered_u)
            st.caption(f"当前展示 **{len(filtered_u)}** 条（在已加载的 {total_n} 条内筛选）。")
            st.dataframe(df_u, use_container_width=True, hide_index=True)
            csv_s = "\ufeff" + users_admin_rows_to_csv(filtered_u)
            st.download_button(
                label="导出 CSV（当前筛选结果）",
                data=csv_s.encode("utf-8"),
                file_name=f"nx_users_export_{pd.Timestamp.now().strftime('%Y%m%d_%H%M')}.csv",
                mime="text/csv;charset=utf-8",
                key="dl_users_csv",
            )

    with tab_finance:
        st.subheader("财务分析")
        st.caption(
            "本页在 **本机直连 Tablestore** 扫描数据（与桌面端 **#/admin/finance** 不同入口，逻辑一致）。"
            " 依据 **nx_transactions**（`type=consume`）、侧栏 **模型定价表**、**nx_tasks**（解析 `billingModelId`）、**nx_coupons**（已核销面值）。"
            " 表格里的「基准价」对应 OTS 列 **base_price**（作默认底价）；若表中另有 **base_cost** / **user_price** 列会优先用于差价。"
        )
        tx_main_table = get_ots_transactions_table_default()
        st.caption(f"流水主表：`{tx_main_table}` · 主键列：`{tx_sort_key}` · 任务表：`{tasks_table}`")

        pc1, pc2 = st.columns(2)
        with pc1:
            profit_max_tx = st.number_input(
                "最多扫描流水行数",
                min_value=5000,
                max_value=200000,
                value=60000,
                step=5000,
                key="profit_max_tx_scan",
                help="越大越准但越慢；达到上限后合计可能截断。",
            )
        with pc2:
            profit_max_cp = st.number_input(
                "最多扫描兑换码行数",
                min_value=5000,
                max_value=200000,
                value=50000,
                step=5000,
                key="profit_max_cp_scan",
            )

        if st.button("计算财务指标", type="primary", key="btn_profit_analytics_run"):
            st.session_state.pop("_profit_result", None)
            with st.spinner("正在扫描 OTS，请稍候（可能需数十秒）…"):
                try:
                    st.session_state["_profit_result"] = aggregate_profit_analytics_streamlit(
                        client,
                        model_table=table_name.strip(),
                        tx_table=tx_main_table,
                        tx_pk=tx_sort_key,
                        coupons_table=coupons_table.strip(),
                        tasks_table=tasks_table.strip(),
                        max_tx_scan=int(profit_max_tx),
                        max_coupon_scan=int(profit_max_cp),
                    )
                except Exception as e:
                    st.session_state["_profit_result"] = {"_error": str(e)}

        pr_fin: Any = st.session_state.get("_profit_result")
        if pr_fin is None:
            st.info("点击 **计算财务指标** 生成汇总、趋势与模型排行。")
        elif isinstance(pr_fin, dict) and pr_fin.get("_error"):
            st.error(f"计算失败：{pr_fin['_error']}")
        elif isinstance(pr_fin, dict):
            if pr_fin.get("tx_scan_truncated"):
                st.warning("流水扫描已达行数上限，合计与趋势可能不完整；可提高「最多扫描流水行数」后重算。")

            g1, g2, g3 = st.columns(3)
            with g1:
                st.markdown(
                    '<div style="padding:0.85rem 1rem;border-radius:12px;border:1px solid rgba(52,211,153,0.35);'
                    'background:linear-gradient(135deg,rgba(16,185,129,0.15),rgba(20,184,166,0.08));">'
                    '<div style="font-size:0.72rem;color:rgba(255,255,255,0.5);">累计总利润（元宝）</div>'
                    '<div style="font-size:1.65rem;font-weight:700;background:linear-gradient(90deg,#6ee7b7,#2dd4bf);'
                    '-webkit-background-clip:text;-webkit-text-fill-color:transparent;">'
                    f"{int(pr_fin.get('total_profit', 0)):,}"
                    "</div></div>",
                    unsafe_allow_html=True,
                )
            with g2:
                st.markdown(
                    '<div style="padding:0.85rem 1rem;border-radius:12px;border:1px solid rgba(167,139,250,0.35);'
                    'background:linear-gradient(135deg,rgba(139,92,246,0.15),rgba(236,72,153,0.08));">'
                    '<div style="font-size:0.72rem;color:rgba(255,255,255,0.5);">本月流水收入（元宝）</div>'
                    '<div style="font-size:1.65rem;font-weight:700;background:linear-gradient(90deg,#c4b5fd,#f0abfc);'
                    '-webkit-background-clip:text;-webkit-text-fill-color:transparent;">'
                    f"{int(pr_fin.get('current_month_revenue_yuanbao', 0)):,}"
                    "</div>"
                    f'<div style="font-size:0.68rem;color:rgba(255,255,255,0.35);margin-top:0.25rem;">'
                    f'上海自然月 {pr_fin.get("current_month_key", "")}</div></div>',
                    unsafe_allow_html=True,
                )
            with g3:
                st.markdown(
                    '<div style="padding:0.85rem 1rem;border-radius:12px;border:1px solid rgba(251,191,36,0.35);'
                    'background:linear-gradient(135deg,rgba(245,158,11,0.15),rgba(234,88,12,0.08));">'
                    '<div style="font-size:0.72rem;color:rgba(255,255,255,0.5);">API 成本总额（元宝）</div>'
                    '<div style="font-size:1.65rem;font-weight:700;background:linear-gradient(90deg,#fcd34d,#fb923c);'
                    '-webkit-background-clip:text;-webkit-text-fill-color:transparent;">'
                    f"{int(pr_fin.get('total_cost', 0)):,}"
                    "</div></div>",
                    unsafe_allow_html=True,
                )

            st.divider()
            gran = st.radio(
                "利润走势粒度",
                options=["月", "日", "年"],
                horizontal=True,
                key="profit_chart_granularity",
            )
            gran_key = {"月": "monthly_profits", "日": "daily_profits", "年": "yearly_profits"}[str(gran)]
            series_raw: list[dict[str, Any]] = list(pr_fin.get(gran_key) or [])
            cap = 48 if gran == "日" else 24 if gran == "月" else 10
            series_tail = series_raw[-cap:] if len(series_raw) > cap else series_raw
            df_p = pd.DataFrame(
                [{"period": r["period"], "profit": r["profit_yuanbao"]} for r in series_tail]
            )
            if df_p.empty:
                st.caption("暂无该粒度下的利润序列。")
            else:
                st.area_chart(df_p, x="period", y="profit", height=320)

            st.caption(
                f"已核销券 **{pr_fin.get('coupon_used_count', 0)}** 张 · 面值合计 **{pr_fin.get('coupon_face_value_cny_sum', 0)}** 元 "
                f"（估 **{pr_fin.get('coupon_estimated_yuanbao', 0):,}** 元宝，折算率 {pr_fin.get('yuanbao_per_cny_assumed', 10)}）· "
                f"扫描流水 **{pr_fin.get('tx_rows_scanned', 0)}** 行 · 兑换码 **{pr_fin.get('coupon_rows_scanned', 0)}** 行"
            )

            st.subheader("模型盈利排行（元宝）")
            lb = pr_fin.get("model_profit_leaderboard") or []
            if not lb:
                st.caption("无模型级数据（可能没有匹配到 consume 或 billingModelId）。")
            else:
                df_lb = pd.DataFrame(lb)
                df_lb = df_lb.rename(
                    columns={
                        "model_id": "模型 ID",
                        "task_count": "任务数",
                        "revenue_yuanbao": "流水收入",
                        "cost_yuanbao": "底价成本",
                        "profit_yuanbao": "利润",
                    }
                )
                st.dataframe(df_lb.head(50), use_container_width=True, hide_index=True)

    with tab_user_query:
        st.subheader("按用户查询")
        q_account = st.text_input(
            "用户账号",
            key="coupon_query_user_id",
            placeholder="注册邮箱，例如 name@example.com",
        )
        qc1, qc2, qc3 = st.columns(3)
        with qc1:
            do_recharge = st.button("查充值记录", key="btn_query_user_recharge")
        with qc2:
            do_redeemed = st.button("查该用户核销的券", key="btn_query_user_redeemed")
        with qc3:
            do_issued = st.button("查签发目标为该用户的券", key="btn_query_user_issued")

        def _resolved_uid_for_query() -> tuple[str | None, str | None]:
            return resolve_account_to_user_id(
                client,
                email_table=email_table,
                users_table=users_table,
                raw=str(q_account or ""),
            )

        def _load_coupons_cache_if_needed() -> list[dict[str, Any]]:
            ct = coupons_table.strip()
            if "_coupons_cache" not in st.session_state or st.session_state.get("_coupons_cache_table") != ct:
                st.session_state["_coupons_cache"] = fetch_all_coupon_rows(client, ct)
                st.session_state["_coupons_cache_table"] = ct
            return list(st.session_state.get("_coupons_cache") or [])

        if st.button("刷新兑换码缓存", key="btn_refresh_coupons_user_tab"):
            st.session_state.pop("_coupons_cache", None)
            st.session_state.pop("_coupons_cache_table", None)
            st.rerun()

        if do_recharge:
            st.session_state.pop("_uq_coupon_err", None)
            st.session_state.pop("_uq_resolved_uid", None)
            uid_q, err_q = _resolved_uid_for_query()
            if err_q:
                st.warning(err_q)
            elif uid_q:
                st.session_state["_uq_resolved_uid"] = uid_q
                try:
                    txs = fetch_recharge_like_transactions_for_user(
                        client,
                        tx_gsi_name,
                        tx_sort_key,
                        uid_q,
                    )
                    st.session_state["_uq_recharge_df"] = transactions_recharge_to_display_dataframe(txs)
                except Exception as e:
                    st.session_state["_uq_recharge_df"] = None
                    st.session_state["_uq_coupon_err"] = f"充值记录查询失败：{e}"

        if do_redeemed:
            st.session_state.pop("_uq_coupon_err", None)
            st.session_state.pop("_uq_resolved_uid", None)
            uid_q, err_q = _resolved_uid_for_query()
            if err_q:
                st.warning(err_q)
            elif uid_q:
                st.session_state["_uq_resolved_uid"] = uid_q
                try:
                    with st.spinner("正在加载兑换码表…"):
                        cr = _load_coupons_cache_if_needed()
                    sub = filter_coupons_by_used_user_id(cr, uid_q)
                    st.session_state["_uq_redeemed_df"] = coupons_to_display_dataframe_with_emails(
                        client, users_table, sub
                    )
                except Exception as e:
                    st.session_state["_uq_coupon_err"] = f"读取兑换码表失败：{e}"

        if do_issued:
            st.session_state.pop("_uq_coupon_err", None)
            st.session_state.pop("_uq_resolved_uid", None)
            uid_q, err_q = _resolved_uid_for_query()
            if err_q:
                st.warning(err_q)
            elif uid_q:
                st.session_state["_uq_resolved_uid"] = uid_q
                try:
                    with st.spinner("正在加载兑换码表…"):
                        cr = _load_coupons_cache_if_needed()
                    sub = filter_coupons_by_issued_for_user_id(cr, uid_q)
                    st.session_state["_uq_issued_df"] = coupons_to_display_dataframe_with_emails(
                        client, users_table, sub
                    )
                except Exception as e:
                    st.session_state["_uq_coupon_err"] = f"读取兑换码表失败：{e}"

        if st.session_state.get("_uq_coupon_err"):
            st.error(st.session_state["_uq_coupon_err"])

        ruid = st.session_state.get("_uq_resolved_uid")
        if ruid:
            st.caption(f"已解析为 user_id：`{ruid}`")

        if st.session_state.get("_uq_recharge_df") is not None:
            st.markdown("##### 充值入账流水（该用户）")
            st.dataframe(st.session_state["_uq_recharge_df"], use_container_width=True, hide_index=True)

        if st.session_state.get("_uq_redeemed_df") is not None:
            st.markdown("##### 该用户核销过的兑换码（used_by_user_id）")
            st.dataframe(st.session_state["_uq_redeemed_df"], use_container_width=True, hide_index=True)

        if st.session_state.get("_uq_issued_df") is not None:
            st.markdown("##### 签发目标为该用户的券（issued_for_user_id）")
            st.dataframe(st.session_state["_uq_issued_df"], use_container_width=True, hide_index=True)

    with tab_user_gen:
        st.subheader("用户任务记录（nx_transactions）")
        st.caption(
            f"数据来源：**{get_ots_transactions_table_default()}**（GSI **`{tx_gsi_name}`** 回表补全时间与备注）；"
            f"扣费类展示 **使用模型**（流水 `description` 或 **{tasks_table}** 中 billingModelId）；"
            f"默认最多 {2000} 条，按扣费时间倒序。"
        )
        g_account = st.text_input(
            "用户账号",
            key="gen_record_user_account",
            placeholder="注册邮箱或 user_id",
        )
        do_gen_query = st.button("查询任务记录", type="primary", key="btn_gen_record_query")

        if do_gen_query:
            st.session_state.pop("_gen_record_err", None)
            uid_g, err_g = resolve_account_to_user_id(
                client,
                email_table=email_table,
                users_table=users_table,
                raw=str(g_account or ""),
            )
            if err_g:
                st.warning(err_g)
                st.session_state["_gen_record_df"] = None
                st.session_state["_gen_record_uid"] = None
            elif uid_g:
                st.session_state["_gen_record_uid"] = uid_g
                try:
                    with st.spinner("正在加载流水（回表补全）…"):
                        txs = fetch_all_transactions_for_user_via_gsi(
                            client,
                            tx_gsi_name,
                            tx_sort_key,
                            uid_g,
                        )
                        tmap = build_task_model_lookup_by_task_ids(client, tasks_table, txs)
                    st.session_state["_gen_record_df"] = transactions_task_records_display_dataframe(
                        txs,
                        task_model_by_id=tmap,
                    )
                except Exception as e:
                    st.session_state["_gen_record_df"] = None
                    st.session_state["_gen_record_err"] = str(e)

        if st.session_state.get("_gen_record_err"):
            st.error(f"查询失败：{st.session_state['_gen_record_err']}")

        uid_show = st.session_state.get("_gen_record_uid")
        if uid_show:
            st.caption(f"已解析为 user_id：`{uid_show}`")

        df_gen = st.session_state.get("_gen_record_df")
        if df_gen is not None:
            st.metric("该用户流水条数（nx_transactions）", len(df_gen))
            st.dataframe(df_gen, use_container_width=True, hide_index=True)

        st.divider()
        st.subheader("运营调账")
        st.caption(
            "对上方已解析用户扣减或补发元宝，并写入 **nx_transactions**（`type=adjust`）。"
            "**正数 = 扣费**，**负数 = 补发**；须再次输入与进入后台相同的 **访问密码**。"
        )
        tx_table_adj = get_ots_transactions_table_default()
        tx_pk_adj = get_ots_tx_sort_key_default()
        with st.form("admin_balance_adjust_form", clear_on_submit=False):
            adj_pwd = st.text_input("管理员密码", type="password", key="adj_form_pwd")
            adj_amount = st.number_input(
                "变动元宝（正数扣费，负数补发）",
                value=0,
                step=1,
                format="%d",
                help="例如填 500 表示扣 500 元宝；填 -200 表示补 200 元宝。",
                key="adj_form_amount",
            )
            adj_remark = st.text_input("备注", value="管理员调整", key="adj_form_remark")
            do_adjust = st.form_submit_button("确认调账", type="primary")

        if do_adjust:
            expected_pwd = admin_password_expected()
            if not expected_pwd:
                st.error("未配置 admin_password / AIXFLOW_ADMIN_PASSWORD，无法调账。")
            elif not secrets_std.compare_digest(
                str(adj_pwd or "").encode("utf-8"),
                expected_pwd.encode("utf-8"),
            ):
                st.error("管理员密码错误。")
            else:
                uid_adj = st.session_state.get("_gen_record_uid")
                if not uid_adj:
                    uid_try, err_try = resolve_account_to_user_id(
                        client,
                        email_table=email_table,
                        users_table=users_table,
                        raw=str(g_account or ""),
                    )
                    if err_try or not uid_try:
                        st.warning(err_try or "请先查询任务记录，或填写有效用户账号。")
                    else:
                        uid_adj = uid_try
                        st.session_state["_gen_record_uid"] = uid_try
                if uid_adj:
                    try:
                        amt_rounded = int(round(float(adj_amount)))
                    except (TypeError, ValueError):
                        st.error("变动元宝须为整数。")
                        amt_rounded = 0
                    if amt_rounded == 0:
                        st.error("变动元宝不能为 0。")
                    else:
                        delta = -amt_rounded
                        try:
                            with st.spinner("正在写入 Tablestore…"):
                                result = admin_adjust_user_balance(
                                    client,
                                    users_table=users_table,
                                    tx_table=tx_table_adj,
                                    tx_pk_col=tx_pk_adj,
                                    user_id=str(uid_adj),
                                    delta_yuanbao=delta,
                                    remark=str(adj_remark or "管理员调整"),
                                )
                            st.success(
                                f"调账成功：{result['balance_before']} → **{result['balance_after']}** 元宝 "
                                f"（变动 {result['delta_yuanbao']:+d}），流水 `{result['transaction_id']}`"
                            )
                            try:
                                txs_ref = fetch_all_transactions_for_user_via_gsi(
                                    client,
                                    tx_gsi_name,
                                    tx_sort_key,
                                    str(uid_adj),
                                )
                                tmap_ref = build_task_model_lookup_by_task_ids(
                                    client, tasks_table, txs_ref
                                )
                                st.session_state["_gen_record_df"] = (
                                    transactions_task_records_display_dataframe(
                                        txs_ref,
                                        task_model_by_id=tmap_ref,
                                    )
                                )
                            except Exception as e:
                                st.warning(f"余额已更新，但刷新流水失败：{e}")
                        except Exception as e:
                            st.error(f"调账失败：{e}")

    with tab_model:
        if st.button("从云端刷新表格", type="primary"):
            st.session_state.pop("_rows_cache", None)
            st.rerun()

        if "_rows_cache" not in st.session_state:
            with st.spinner("正在从云端加载数据表…"):
                try:
                    st.session_state["_rows_cache"] = fetch_all_rows(client, table_name.strip())
                except Exception as e:
                    st.error(f"读取失败：{e}")
                    st.stop()

        rows = st.session_state["_rows_cache"]
        rows_sorted = sort_rows_by_model_id(rows)
        df_edit = dataframe_for_editor(rows)

        st.subheader("当前配置")
        st.metric("当前云端模型总数", len(rows))
        st.caption(
            "在下方 **模型表格** 中增删改（含主键、名称、启用、基准价、倍率、元宝折算率），完成后点击 **保存到云端** 一次性写回 Tablestore。"
        )
        st.caption(
            "**主键 model_id 须与客户端计费键一致**：图片多分辨率用连字符、无空格，例如 "
            "`banana-2.0-1k` / `banana-2.0-2k` / `banana-2.0-4k`（对应界面 1k/2k/4k）。"
            "勿使用 `banana 2.0`、`banana 2.0 2k` 等含空格的 ID，否则软件无法命中该行。"
        )
        st.caption(
            "建议 **model_id** 使用 SKU：`模型名-分辨率-时长` 等，与 NEXFLOW 客户端发往 FC 的 **billingModelId** 一致。"
            "从表格中删除一行并保存，将从云端删除对应主键。"
        )

        editor_cfg: dict[str, Any] = {
            "model_id": st.column_config.TextColumn(_COL_ZH["model_id"], width="large"),
            "function_name": st.column_config.TextColumn(_COL_ZH["function_name"], width="large"),
            "is_active": st.column_config.CheckboxColumn(_COL_ZH["is_active"]),
            "base_price": st.column_config.NumberColumn(_COL_ZH["base_price"], min_value=0.0, format="%.4f", step=0.01),
            "multiplier": st.column_config.NumberColumn(_COL_ZH["multiplier"], min_value=0.0, format="%.4f", step=0.1),
            "yuanbao_rate": st.column_config.NumberColumn(_COL_ZH["yuanbao_rate"], min_value=0.0, format="%.4f", step=0.1),
        }
        edited_df = st.data_editor(
            df_edit,
            column_config=editor_cfg,
            hide_index=True,
            num_rows="dynamic",
            use_container_width=True,
            key="model_table_editor",
        )

        if st.button("保存到云端", type="primary"):
            try:
                n_up, n_in, n_del, errs = save_full_table(
                    client,
                    table_name.strip(),
                    rows_sorted,
                    edited_df,
                )
                for err in errs:
                    st.error(err)
                if n_up or n_in or n_del:
                    parts = []
                    if n_up:
                        parts.append(f"更新 {n_up} 条")
                    if n_in:
                        parts.append(f"新增 {n_in} 条")
                    if n_del:
                        parts.append(f"删除 {n_del} 条")
                    st.success("已写回云端：" + "，".join(parts) + "。")
                    st.session_state.pop("_rows_cache", None)
                    st.rerun()
                elif not errs:
                    st.info("没有检测到变更，无需保存。")
            except Exception as e:
                st.error(f"保存过程异常：{e}")


if __name__ == "__main__":
    main()
