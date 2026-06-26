#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
一键启动模型管理后台：本机起 Streamlit，再用桌面窗口或系统浏览器打开。

- 已安装 pywebview 时：内嵌窗口（更像「客户端」）
- 未安装时：自动打开默认浏览器，本进程占用终端直至 Ctrl+C

首次使用内嵌窗口请执行：
  pip install -r requirements-desktop.txt

默认端口 8510，避免与本机其他 Streamlit（8501）冲突。可通过环境变量覆盖：
  set NEXFLOW_ADMIN_PORT=8510
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
APP_PY = ROOT / "app.py"


def _running_without_console() -> bool:
    if sys.platform != "win32":
        return False
    if sys.executable.lower().endswith("pythonw.exe"):
        return True
    try:
        import ctypes

        return ctypes.windll.kernel32.GetConsoleWindow() == 0
    except Exception:
        return False


def _gui_alert(title: str, text: str) -> None:
    if sys.platform != "win32":
        return
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(0, text, title, 0x00000010)
    except Exception:
        pass


def _port() -> int:
    raw = os.environ.get("NEXFLOW_ADMIN_PORT", "").strip()
    if raw.isdigit():
        p = int(raw)
        if 1024 <= p <= 65535:
            return p
    return 8510


def _start_streamlit(port: int) -> subprocess.Popen:
    cmd = [
        sys.executable,
        "-m",
        "streamlit",
        "run",
        str(APP_PY),
        "--server.port",
        str(port),
        "--server.address",
        "127.0.0.1",
        "--server.headless",
        "true",
        "--browser.gatherUsageStats",
        "false",
    ]
    env = os.environ.copy()
    env.setdefault("PYTHONUTF8", "1")
    return subprocess.Popen(
        cmd,
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )


def _wait_http_ok(url: str, timeout_sec: float = 45.0) -> bool:
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        try:
            urllib.request.urlopen(url, timeout=1.0)
            return True
        except (urllib.error.URLError, OSError):
            time.sleep(0.35)
    return False


def _kill_tree(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if sys.platform == "win32":
        subprocess.run(
            ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
            capture_output=True,
            check=False,
        )
    else:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def _run_with_webview(url: str, proc: subprocess.Popen) -> None:
    import webview

    webview.create_window(
        "Aixflow",
        url,
        width=1280,
        height=840,
        resizable=True,
    )
    try:
        webview.start(debug=False)
    finally:
        _kill_tree(proc)


def _run_with_browser(url: str, proc: subprocess.Popen) -> int:
    import webbrowser

    webbrowser.open(url)
    print(f"已打开浏览器：{url}")
    print("关闭服务：在本窗口按 Ctrl+C 或关闭终端。")
    try:
        return proc.wait()
    except KeyboardInterrupt:
        _kill_tree(proc)
        return 0


def main() -> int:
    if not APP_PY.is_file():
        msg = f"未找到 app.py：{APP_PY}"
        print(msg, file=sys.stderr)
        if _running_without_console():
            _gui_alert(
                "Aixflow",
                msg + "\n\n请确认与 launch_desktop.py 同目录下有 app.py。\n便携包请双击文件夹内的启动脚本，勿只复制单个文件。",
            )
        return 2

    port = _port()
    url = f"http://127.0.0.1:{port}/"

    proc = _start_streamlit(port)
    try:
        if not _wait_http_ok(url):
            msg = (
                "Streamlit 在约 45 秒内未就绪。\n"
                "常见原因：依赖损坏、8510 端口被占用、或首次启动过慢。\n\n"
                "请双击同目录下的 START-with-console.bat 查看详细报错。"
            )
            print("Streamlit 启动超时，请检查是否已安装依赖：pip install -r requirements.txt", file=sys.stderr)
            if _running_without_console():
                _gui_alert("Aixflow", msg)
            return 1

        try:
            import webview  # noqa: F401

            _run_with_webview(url, proc)
            return 0
        except ImportError:
            return _run_with_browser(url, proc)
    except Exception as e:
        print(f"启动失败：{e}", file=sys.stderr)
        _kill_tree(proc)
        if _running_without_console():
            _gui_alert(
                "Aixflow",
                f"启动失败：{e}\n\n请双击 START-with-console.bat 用命令行启动以查看完整错误。",
            )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
