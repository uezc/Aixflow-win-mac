"""支付宝密钥 PEM 规范化（支持控制台复制的纯 Base64）。"""

from __future__ import annotations

import re
import textwrap

_PKCS1_PRIVATE_BEGIN = "-----BEGIN RSA PRIVATE KEY-----"
_PKCS1_PRIVATE_END = "-----END RSA PRIVATE KEY-----"
_PUBLIC_BEGIN = "-----BEGIN PUBLIC KEY-----"
_PUBLIC_END = "-----END PUBLIC KEY-----"


def _strip_pem_input(raw: str) -> str:
    text = raw.strip().strip('"').strip("'")
    return text.replace("\\n", "\n").strip()


def _extract_b64(raw: str) -> str:
    text = _strip_pem_input(raw)
    if "BEGIN" in text and "END" in text:
        lines = [
            line.strip()
            for line in text.splitlines()
            if line.strip() and not line.strip().startswith("-----")
        ]
        return "".join(lines)
    return re.sub(r"\s+", "", text)


def normalize_private_key(raw: str) -> str:
    """应用私钥：支持完整 PEM 或支付宝控制台的一行 Base64。"""
    text = _strip_pem_input(raw)
    if text.startswith(_PKCS1_PRIVATE_BEGIN) and _PKCS1_PRIVATE_END in text:
        return text

    b64 = _extract_b64(raw)
    if not b64 or not re.fullmatch(r"[A-Za-z0-9+/=]+", b64):
        raise ValueError("应用私钥格式无效，请从支付宝开放平台重新复制")

    if len(b64) > 1900:
        raise ValueError(
            f"应用私钥长度异常（{len(b64)} 字符），可能粘贴重复。"
            "请只复制一段 Base64，或带 BEGIN/END 的完整 PEM。"
        )

    lines = [_PKCS1_PRIVATE_BEGIN, *textwrap.wrap(b64, 64), _PKCS1_PRIVATE_END]
    return "\n".join(lines)


def normalize_public_key(raw: str) -> str:
    """支付宝公钥：支持完整 PEM 或一行 Base64。"""
    text = _strip_pem_input(raw)
    if text.startswith(_PUBLIC_BEGIN) and _PUBLIC_END in text:
        return text

    b64 = _extract_b64(raw)
    if not b64 or not re.fullmatch(r"[A-Za-z0-9+/=]+", b64):
        raise ValueError("支付宝公钥格式无效，请从开放平台重新复制")

    if len(b64) > 600:
        raise ValueError(
            f"支付宝公钥长度异常（{len(b64)} 字符），可能粘贴重复。"
            "请只复制一段 Base64，或带 BEGIN/END 的完整 PEM。"
        )

    lines = [_PUBLIC_BEGIN, *textwrap.wrap(b64, 64), _PUBLIC_END]
    return "\n".join(lines)


def pem_to_env_line(pem: str) -> str:
    escaped = pem.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')
    return f'"{escaped}"'
