#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
一键启动模型管理后台：本机起 Streamlit，再用桌面窗口或系统浏览器打开。

默认用系统浏览器（更稳）。若要内嵌窗口：
  set NEXFLOW_ADMIN_WEBVIEW=1
  pip install -r requirements-desktop.txt
  （需本机已装 Microsoft Edge WebView2 Runtime）

默认端口 9510。可用环境变量覆盖：
  set NEXFLOW_ADMIN_PORT=9510
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
LOG_DIR = ROOT / ".local"
STREAMLIT_LOG = LOG_DIR / "streamlit-launch.log"


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
    return 9510


def _want_webview() -> bool:
    raw = os.environ.get("NEXFLOW_ADMIN_WEBVIEW", "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def _http_ok(url: str, timeout: float = 1.0) -> bool:
    try:
        urllib.request.urlopen(url, timeout=timeout)
        return True
    except (urllib.error.URLError, OSError):
        return False


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
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_f = open(STREAMLIT_LOG, "w", encoding="utf-8", errors="replace")
    log_f.write(f"# streamlit launch {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
    log_f.write("cmd: " + " ".join(cmd) + "\n\n")
    log_f.flush()
    return subprocess.Popen(
        cmd,
        cwd=str(ROOT),
        env=env,
        stdout=log_f,
        stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )


def _wait_http_ok(url: str, timeout_sec: float = 45.0) -> bool:
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        if _http_ok(url):
            return True
        time.sleep(0.35)
    return False


def _kill_tree(proc: subprocess.Popen | None) -> None:
    if proc is None or proc.poll() is not None:
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


def _run_with_webview(url: str) -> None:
    import webview

    webview.create_window(
        "Aixflow 模型管理后台",
        url,
        width=1280,
        height=840,
        resizable=True,
    )
    webview.start(debug=False)


def _run_with_browser(url: str, proc: subprocess.Popen | None) -> int:
    import webbrowser

    webbrowser.open(url)
    print(f"已打开浏览器：{url}")
    print(f"Streamlit 日志：{STREAMLIT_LOG}")
    print("关闭服务：在本窗口按 Ctrl+C 或关闭终端。")
    if proc is None:
        print("（检测到端口上已有可用服务，未再启动新进程）")
        try:
            while _http_ok(url, timeout=2.0):
                time.sleep(1.0)
        except KeyboardInterrupt:
            return 0
        return 0
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
    proc: subprocess.Popen | None = None
    reused = False

    try:
        # 端口上已有健康服务时直接打开，避免二次启动失败却“像打不开”
        if _http_ok(url):
            print(f"检测到 {url} 已在运行，直接打开。")
            reused = True
        else:
            proc = _start_streamlit(port)
            if not _wait_http_ok(url):
                bind_hint = ""
                try:
                    import socket

                    s = socket.socket()
                    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                    s.bind(("127.0.0.1", port))
                    s.close()
                except OSError as e:
                    bind_hint = (
                        f"\n\n本机无法绑定端口 {port}：{e}\n"
                        "常见原因：Windows「排除端口范围」（Hyper-V/WSL 等）占用了该端口。\n"
                        "可改用：set NEXFLOW_ADMIN_PORT=18510 后再启动，"
                        "或管理员执行 netsh interface ipv4 show excludedportrange protocol=tcp 查看排除段。"
                    )

                log_tail = ""
                try:
                    if STREAMLIT_LOG.is_file():
                        log_tail = "\n\n--- streamlit-launch.log ---\n" + STREAMLIT_LOG.read_text(
                            encoding="utf-8",
                            errors="replace",
                        )[-2000:]
                except Exception:
                    pass

                msg = (
                    f"Streamlit 在约 45 秒内未就绪（端口 {port}）。\n"
                    "常见原因：端口被占用、依赖损坏、或首次启动过慢。"
                    f"{bind_hint}\n\n"
                    f"日志：{STREAMLIT_LOG}\n"
                    "或在本目录命令行运行：\n"
                    f"  python -m streamlit run app.py --server.port {port}\n"
                    f"{log_tail}"
                )
                print(msg, file=sys.stderr)
                _kill_tree(proc)
                if _running_without_console():
                    _gui_alert("Aixflow", msg[:800])
                return 1

        if _want_webview():
            try:
                import webview  # noqa: F401

                print(f"内嵌窗口打开：{url}")
                try:
                    _run_with_webview(url)
                    return 0
                except Exception as e:
                    print(f"内嵌窗口失败（将改用浏览器）：{e}", file=sys.stderr)
            except ImportError:
                print("未安装 pywebview，改用浏览器。可执行：pip install -r requirements-desktop.txt")

        return _run_with_browser(url, None if reused else proc)
    except Exception as e:
        print(f"启动失败：{e}", file=sys.stderr)
        _kill_tree(proc)
        if _running_without_console():
            _gui_alert(
                "Aixflow",
                f"启动失败：{e}\n\n请在本目录命令行运行启动脚本以查看完整错误。\n日志：{STREAMLIT_LOG}",
            )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
