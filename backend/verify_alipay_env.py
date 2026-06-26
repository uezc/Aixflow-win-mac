#!/usr/bin/env python3
"""检查 backend/.env 能否初始化支付宝客户端（不打印密钥）。"""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def main() -> int:
    try:
        from alipay_test import build_alipay_client, _env, _warn_notify_url_config, _load_pem

        _warn_notify_url_config()
        app_id = _env("ALIPAY_APP_ID")
        notify = _env("ALIPAY_NOTIFY_URL")
        print(f"ALIPAY_APP_ID={app_id}")
        print(f"ALIPAY_NOTIFY_URL={notify}")

        private_pem = _load_pem("ALIPAY_APP_PRIVATE_KEY")
        public_pem = _load_pem("ALIPAY_PUBLIC_KEY")
        try:
            from Cryptodome.PublicKey import RSA

            app_pub = RSA.import_key(private_pem).publickey().export_key(format="DER")
            cfg_pub = RSA.import_key(public_pem).export_key(format="DER")
            if app_pub == cfg_pub:
                print(
                    "WARN: ALIPAY_PUBLIC_KEY 与应用私钥推导出的公钥相同，"
                    "notify 验签会失败。请改为开放平台「查看」里的【支付宝公钥】。"
                )
        except Exception:
            pass

        build_alipay_client()
        print("OK: 密钥格式正确，AliPay 客户端已就绪。")
        return 0
    except Exception as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
