#!/usr/bin/env python3
"""
构建 rvc_infer_cli.exe + assets，输出到 resources/rvc/engine/
供 NEXFLOW 本地 RVC 翻唱首次下载或随包分发。
"""
from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
BUILD_DIR = SCRIPT_DIR / "build_workspace"
VENV_DIR = SCRIPT_DIR / ".build-venv"
OUT_ENGINE = PROJECT_ROOT / "resources" / "rvc" / "engine"
ASSETS_DIR = OUT_ENGINE / "assets"

HUBERT_URL = "https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/hubert_base.pt"
RMVPE_URL = "https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/rmvpe.pt"
FAIRSEQ_CP311_WIN_WHEEL = (
    "https://github.com/gdiaz384/fairseq/releases/download/v0.12.2.2024Feb07/"
    "fairseq-0.12.3.1-cp311-cp311-win_amd64.whl"
)
PIP_MIRROR = os.environ.get("NEXFLOW_PIP_MIRROR", "").strip()


def pip_extra_args() -> list[str]:
    args = ["--default-timeout", "1000"]
    if PIP_MIRROR:
        args.extend(["-i", PIP_MIRROR])
    return args


def run(cmd: list[str], cwd: Path | None = None, env: dict | None = None) -> None:
    print(f"  $ {' '.join(cmd)}")
    r = subprocess.run(cmd, cwd=cwd or SCRIPT_DIR, env=env)
    if r.returncode != 0:
        sys.exit(r.returncode)


def venv_python() -> Path:
    if os.name == "nt":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def venv_pip() -> Path:
    if os.name == "nt":
        return VENV_DIR / "Scripts" / "pip.exe"
    return VENV_DIR / "bin" / "pip"


def ensure_venv() -> Path:
    py = venv_python()
    if not py.exists():
        print("1. 创建构建 venv…")
        run([sys.executable, "-m", "venv", str(VENV_DIR)])
        run([str(venv_pip()), "install", "pip==24.0"])
    return py


def install_deps(py: Path) -> None:
    print("\n2. Install PyTorch + infer-rvc-python (may take a while)...")
    pip = str(venv_pip())
    pip_timeout = pip_extra_args()
    r = subprocess.run([pip, "show", "torch"], capture_output=True)
    if r.returncode != 0:
        for attempt in range(1, 4):
            print(f"  PyTorch install attempt {attempt}/3 ...")
            r = subprocess.run(
                [pip, "install", *pip_timeout, "torch", "torchaudio", "--index-url", "https://download.pytorch.org/whl/cu118"],
                cwd=SCRIPT_DIR,
            )
            if r.returncode == 0:
                break
            if attempt == 3:
                print("  CUDA wheel failed, fallback to CPU torch ...")
                run([pip, "install", *pip_timeout, "torch", "torchaudio"], cwd=SCRIPT_DIR)
    else:
        print("  PyTorch already installed, skip.")
    # Pre-install wheels that infer-rvc / rvc-python build chains need
    run([pip, "install", *pip_timeout, "numpy<2", "cython", "setuptools", "wheel"], cwd=SCRIPT_DIR)
    if sys.version_info[:2] == (3, 11) and os.name == "nt":
        print("  Installing prebuilt fairseq wheel (Windows cp311, no MSVC)...")
        run([pip, "install", *pip_timeout, FAIRSEQ_CP311_WIN_WHEEL], cwd=SCRIPT_DIR)
        run([pip, "install", *pip_timeout, "-r", str(SCRIPT_DIR / "requirements-rvc-build.txt")], cwd=SCRIPT_DIR)
        print("  Installing rvc-python (--no-deps, fairseq already satisfied)...")
        run([pip, "install", *pip_timeout, "rvc-python", "--no-deps"], cwd=SCRIPT_DIR)
    run(
        [pip, "install", *pip_timeout, "av", "faiss-cpu", "omegaconf==2.0.6", "hydra-core==1.0.7", "praat-parselmouth", "pyworld", "torchcrepe"],
        cwd=SCRIPT_DIR,
    )
    # Python 3.11 + hydra 1.0.7 会触发 dataclass 错误，需升级
    run(
        [pip, "install", *pip_timeout, "hydra-core==1.3.2", "omegaconf==2.3.0", "antlr4-python3-runtime==4.9.3", "tensorboardX"],
        cwd=SCRIPT_DIR,
    )
    else:
        run([pip, "install", *pip_timeout, "rvc-python", "-r", str(SCRIPT_DIR / "requirements-rvc-build.txt")], cwd=SCRIPT_DIR)


def download_file(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 1024 * 1024:
        print(f"  跳过已存在: {dest.name} ({dest.stat().st_size // (1024*1024)} MB)")
        return
    print(f"  下载 {url} -> {dest}")
    req = urllib.request.Request(url, headers={"User-Agent": "NEXFLOW-build/1.0"})
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")
    if proxy:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
    else:
        opener = urllib.request.build_opener()
    with opener.open(req, timeout=600) as resp:
        data = resp.read()
    dest.write_bytes(data)
    print(f"  完成 {dest.name} ({len(data) // (1024*1024)} MB)")


def download_assets() -> None:
    print("\n3. 下载 HuBERT / RMVPE 权重…")
    download_file(HUBERT_URL, ASSETS_DIR / "hubert_base.pt")
    download_file(RMVPE_URL, ASSETS_DIR / "rmvpe.pt")


def pyinstaller_build(py: Path) -> Path:
    print("\n4. PyInstaller 打包 rvc_infer_cli.exe（约 10–30 分钟）…")
    work = BUILD_DIR
    work.mkdir(parents=True, exist_ok=True)
    shutil.copy(SCRIPT_DIR / "launch_rvc_infer.py", work / "launch_rvc_infer.py")
    shutil.copy(SCRIPT_DIR / "rvc_infer_cli.spec", work / "rvc_infer_cli.spec")
    run([str(py), "-m", "PyInstaller", "rvc_infer_cli.spec", "--noconfirm"], cwd=work)
    exe = work / "dist" / "rvc_infer_cli.exe"
    if not exe.exists():
        print(f"错误: 未找到 {exe}")
        sys.exit(1)
    return exe


def copy_outputs(exe_src: Path) -> None:
    print(f"\n5. 复制到 {OUT_ENGINE}")
    OUT_ENGINE.mkdir(parents=True, exist_ok=True)
    shutil.copy(exe_src, OUT_ENGINE / "rvc_infer_cli.exe")
    print(f"   exe: {OUT_ENGINE / 'rvc_infer_cli.exe'}")
    print(f"   assets: {ASSETS_DIR}")


def update_manifest_size() -> None:
    manifest_path = PROJECT_ROOT / "resources" / "rvc" / "manifest.json"
    if not manifest_path.exists():
        return
    import json

    total = 0
    for p in OUT_ENGINE.rglob("*"):
        if p.is_file():
            total += p.stat().st_size
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    data["builtAt"] = __import__("datetime").datetime.utcnow().isoformat() + "Z"
    data["localSizeBytes"] = total
    manifest_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\n6. manifest 已更新 localSizeBytes={total // (1024*1024)} MB")


def main() -> None:
    print("=== NEXFLOW RVC 推理引擎构建 ===\n")
    py = ensure_venv()
    install_deps(py)
    download_assets()
    exe = pyinstaller_build(py)
    copy_outputs(exe)
    update_manifest_size()
    print("\n[DONE] resources/rvc/engine/ is ready.")


if __name__ == "__main__":
    main()
