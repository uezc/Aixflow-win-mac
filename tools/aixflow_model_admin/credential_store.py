# -*- coding: utf-8 -*-
"""本地加密凭据：PBKDF2 + Fernet，文件位于 .local/（勿提交 Git）。"""
from __future__ import annotations

import json
import os
from typing import Any

_MAGIC = b"NXF1"
_PBKDF2_ITERS = 390_000


def credential_file_path() -> str:
    base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, ".local", "aixflow_credentials.enc")


def ensure_credential_dir() -> None:
    d = os.path.dirname(credential_file_path())
    os.makedirs(d, exist_ok=True)


def _derive_fernet_key(password: str, salt: bytes) -> bytes:
    import base64

    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=_PBKDF2_ITERS,
    )
    return base64.urlsafe_b64encode(kdf.derive(password.encode("utf-8")))


def encrypt_credentials(password: str, data: dict[str, str]) -> bytes:
    from cryptography.fernet import Fernet

    salt = os.urandom(16)
    key = _derive_fernet_key(password, salt)
    f = Fernet(key)
    payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
    token = f.encrypt(payload)
    return _MAGIC + salt + token


def decrypt_credentials(password: str, blob: bytes) -> dict[str, Any]:
    if len(blob) < 24 or not blob.startswith(_MAGIC):
        raise ValueError("invalid credential file format")
    salt = blob[4:20]
    token = blob[20:]
    from cryptography.fernet import Fernet

    key = _derive_fernet_key(password, salt)
    f = Fernet(key)
    raw = f.decrypt(token)
    return json.loads(raw.decode("utf-8"))


def read_credential_file() -> bytes | None:
    path = credential_file_path()
    if not os.path.isfile(path):
        return None
    with open(path, "rb") as fp:
        return fp.read()


def write_credential_file(blob: bytes) -> None:
    ensure_credential_dir()
    path = credential_file_path()
    with open(path, "wb") as fp:
        fp.write(blob)


def delete_credential_file() -> bool:
    path = credential_file_path()
    if os.path.isfile(path):
        os.remove(path)
        return True
    return False
