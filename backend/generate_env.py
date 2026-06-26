#!/usr/bin/env python3
"""
交互式生成 backend/.env（支付宝联调），密钥仅写入本机，不打印到屏幕。

用法：
  cd D:\\NEXFLOW\\backend
  .\\.venv\\Scripts\\python.exe generate_env.py
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import time
from pathlib import Path

from pem_utils import normalize_private_key, normalize_public_key, pem_to_env_line

BACKEND_DIR = Path(__file__).resolve().parent
ENV_PATH = BACKEND_DIR / ".env"
DEFAULT_APP_ID = "2021006159656144"
NOTIFY_URL = os.getenv(
    "ALIPAY_NOTIFY_URL_DEFAULT",
    "https://2cecc588.r23.cpolar.top/api/v1/alipay/notify",
)
RETURN_URL = "http://127.0.0.1:8000/"
UVICORN_HOST = "127.0.0.1"
UVICORN_PORT = 8000


def _read_multiline_pem(label: str) -> str:
    print(f"\n{'=' * 60}")
    print(f"请粘贴【{label}】")
    print("支持两种格式：")
    print("  1) 支付宝控制台复制的一行 Base64（最常见）→ 粘贴后输入 END")
    print("  2) 带 -----BEGIN ...----- / -----END ...----- 的完整 PEM → 粘贴后输入 END")
    print("粘贴完成后，单独一行输入 END 并回车：")
    print(f"{'=' * 60}")
    lines: list[str] = []
    while True:
        try:
            line = input()
        except EOFError:
            break
        if line.strip() == "END":
            break
        lines.append(line.rstrip("\r"))
    raw = "\n".join(lines).strip()
    if not raw:
        print("错误：未收到任何内容。", file=sys.stderr)
        sys.exit(1)
    return raw


def _normalize_key(raw: str, kind: str) -> str:
    try:
        if kind == "private":
            pem = normalize_private_key(raw)
        else:
            pem = normalize_public_key(raw)
    except ValueError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        sys.exit(1)
    if "BEGIN" not in raw or "END" not in raw:
        print(f"提示：已自动为【{'应用私钥' if kind == 'private' else '支付宝公钥'}】补全 PEM 头尾。")
    return pem


def _write_env(app_id: str, private_key: str, public_key: str) -> None:
    app_id = app_id.strip()
    if not app_id:
        print("错误：APPID 不能为空。", file=sys.stderr)
        sys.exit(1)

    content = (
        "# AIXFLOW 支付宝联调本地配置（由 generate_env.py 生成，勿提交 Git）\n"
        f"ALIPAY_APP_ID={app_id}\n"
        f"ALIPAY_NOTIFY_URL={NOTIFY_URL}\n"
        f"ALIPAY_RETURN_URL={RETURN_URL}\n"
        f"ALIPAY_APP_PRIVATE_KEY={pem_to_env_line(private_key)}\n"
        f"ALIPAY_PUBLIC_KEY={pem_to_env_line(public_key)}\n"
        "ALIPAY_DEBUG=false\n"
    )
    ENV_PATH.write_text(content, encoding="utf-8")


def _kill_port(port: int) -> None:
    if sys.platform == "win32":
        ps = (
            f"Get-NetTCPConnection -LocalPort {port} -ErrorAction SilentlyContinue | "
            "Select-Object -ExpandProperty OwningProcess -Unique | "
            "ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
        )
        subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps],
            cwd=str(BACKEND_DIR),
            check=False,
        )
    else:
        subprocess.run(
            ["bash", "-lc", f"lsof -ti:{port} | xargs -r kill -9"],
            check=False,
        )


def _python_executable() -> Path:
    venv_py = BACKEND_DIR / ".venv" / "Scripts" / "python.exe"
    if venv_py.is_file():
        return venv_py
    venv_py_unix = BACKEND_DIR / ".venv" / "bin" / "python"
    if venv_py_unix.is_file():
        return venv_py_unix
    return Path(sys.executable)


def _restart_uvicorn() -> None:
    print(f"\n正在重启 Uvicorn ({UVICORN_HOST}:{UVICORN_PORT})...")
    _kill_port(UVICORN_PORT)
    time.sleep(0.8)

    python = _python_executable()
    log_path = BACKEND_DIR / "uvicorn-alipay.log"
    creationflags = 0
    if sys.platform == "win32":
        # 后台启动且不要弹出空黑窗口（输出写入 log 文件）
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)

    with open(log_path, "a", encoding="utf-8") as log_file:
        subprocess.Popen(
            [
                str(python),
                "-m",
                "uvicorn",
                "alipay_test:app",
                "--host",
                UVICORN_HOST,
                "--port",
                str(UVICORN_PORT),
            ],
            cwd=str(BACKEND_DIR),
            stdin=subprocess.DEVNULL,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            creationflags=creationflags,
            close_fds=True,
        )
    print(f"Uvicorn 已在后台启动，日志：{log_path}")
    print(f"测试下单：http://{UVICORN_HOST}:{UVICORN_PORT}/api/v1/alipay/test_pay")


def _configure_console_utf8() -> None:
    if sys.platform != "win32":
        return
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass


def _parse_env_value(line: str) -> str:
    _, _, value = line.partition("=")
    value = value.strip()
    if value.startswith('"') and value.endswith('"'):
        value = value[1:-1]
    return value.replace("\\n", "\n")


def _fix_existing_env() -> None:
    if not ENV_PATH.is_file():
        print(f"错误：未找到 {ENV_PATH}", file=sys.stderr)
        sys.exit(1)

    data: dict[str, str] = {}
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.strip().startswith("#"):
            continue
        m = re.match(r"^([A-Z0-9_]+)=(.*)$", line.strip())
        if m:
            data[m.group(1)] = _parse_env_value(line)

    app_id = data.get("ALIPAY_APP_ID", "").strip()
    if not app_id:
        print("错误：.env 中缺少 ALIPAY_APP_ID", file=sys.stderr)
        sys.exit(1)

    private_raw = data.get("ALIPAY_APP_PRIVATE_KEY", "")
    public_raw = data.get("ALIPAY_PUBLIC_KEY", "")
    if not private_raw or not public_raw:
        print("错误：.env 中缺少私钥或公钥", file=sys.stderr)
        sys.exit(1)

    private_key = _normalize_key(private_raw, "private")
    public_key = _normalize_key(public_raw, "public")
    _write_env(app_id, private_key, public_key)
    print(f"\n✅ 已修复 PEM 格式：{ENV_PATH}")
    _restart_uvicorn()


def main() -> None:
    _configure_console_utf8()
    parser = argparse.ArgumentParser(description="生成或修复 backend/.env")
    parser.add_argument(
        "--fix",
        action="store_true",
        help="读取现有 .env，自动补全 PEM 头尾并重启 Uvicorn",
    )
    args = parser.parse_args()
    if args.fix:
        _fix_existing_env()
        return

    print("AIXFLOW 支付宝 .env 生成器")
    print("密钥只会写入本机 .env，不会在屏幕上回显。\n")

    app_id = input(f"请输入支付宝应用 APPID（回车默认 {DEFAULT_APP_ID}）：").strip()
    if not app_id:
        app_id = DEFAULT_APP_ID
    private_key = _normalize_key(_read_multiline_pem("应用私钥"), "private")
    public_key = _normalize_key(_read_multiline_pem("支付宝公钥"), "public")

    _write_env(app_id, private_key, public_key)
    print(f"\n✅ 生成成功：{ENV_PATH}")
    print("   ALIPAY_NOTIFY_URL 已固定为 cpolar 穿透地址。")

    _restart_uvicorn()
    print("\n全部完成。可用浏览器打开上面的 test_pay 链接获取 pay_url。")


if __name__ == "__main__":
    main()
