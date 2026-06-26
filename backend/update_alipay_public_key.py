#!/usr/bin/env python3
"""仅更新 .env 中的 ALIPAY_PUBLIC_KEY（上传新应用公钥后，从开放平台「查看」复制支付宝公钥）。"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from pem_utils import normalize_public_key, pem_to_env_line

BACKEND = Path(__file__).resolve().parent
ENV_PATH = BACKEND / ".env"


def main() -> None:
    print("请粘贴【支付宝公钥】（开放平台 → 接口加签方式 → 查看）")
    print("粘贴完成后单独一行输入 END：")
    lines: list[str] = []
    while True:
        line = input()
        if line.strip() == "END":
            break
        lines.append(line.rstrip("\r"))
    raw = "\n".join(lines).strip()
    if not raw:
        print("错误：未收到内容", file=sys.stderr)
        sys.exit(1)

    pem = normalize_public_key(raw)
    new_line = f"ALIPAY_PUBLIC_KEY={pem_to_env_line(pem)}"

    if not ENV_PATH.is_file():
        print(f"错误：未找到 {ENV_PATH}", file=sys.stderr)
        sys.exit(1)

    out: list[str] = []
    replaced = False
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("ALIPAY_PUBLIC_KEY="):
            out.append(new_line)
            replaced = True
        else:
            out.append(line)
    if not replaced:
        out.append(new_line)
    ENV_PATH.write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"✅ 已更新 {ENV_PATH} 中的 ALIPAY_PUBLIC_KEY")
    print("请执行: npm run alipay:start")


if __name__ == "__main__":
    main()
