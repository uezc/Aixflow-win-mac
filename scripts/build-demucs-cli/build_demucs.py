#!/usr/bin/env python3
"""
构建 demucs_cli.exe 并复制到 resources/demucs/
用于将人声分离功能打包进 NEXFLOW 安装包。
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
DEMUCS_DIR = SCRIPT_DIR / "demucs"
RESOURCES_DEMUCS = PROJECT_ROOT / "resources" / "demucs"


def run(cmd, cwd=None):
    print(f"  $ {' '.join(cmd)}")
    r = subprocess.run(cmd, cwd=cwd or SCRIPT_DIR)
    if r.returncode != 0:
        sys.exit(r.returncode)


def main():
    print("=== NEXFLOW Demucs CLI 构建 ===\n")

    # 1. 克隆 demucs
    if not DEMUCS_DIR.exists():
        print("1. 克隆 demucs 仓库...")
        run(["git", "clone", "https://github.com/facebookresearch/demucs.git", str(DEMUCS_DIR)])
    else:
        print("1. demucs 已存在，跳过克隆")

    # 2. 安装依赖（使用 requirements-minimal 避免 diffq 编译，需 VC++）
    print("\n2. 安装依赖...")
    req_file = SCRIPT_DIR / "requirements-minimal.txt"
    if not req_file.exists():
        req_file = DEMUCS_DIR / "requirements.txt"
    run(["pip", "install", "-r", str(req_file)], cwd=DEMUCS_DIR)
    run(["pip", "install", "numpy<2"], cwd=DEMUCS_DIR)
    run(["pip", "install", "pyinstaller"], cwd=DEMUCS_DIR)

    # 3. 复制入口和 spec
    print("\n3. 复制构建文件...")
    shutil.copy(SCRIPT_DIR / "launch_demucs.py", DEMUCS_DIR / "launch_demucs.py")
    shutil.copy(SCRIPT_DIR / "demucs_cli.spec", DEMUCS_DIR / "demucs_cli.spec")

    # 4. PyInstaller 构建
    print("\n4. PyInstaller 构建（约 5–15 分钟）...")
    run([sys.executable, "-m", "PyInstaller", "demucs_cli.spec"], cwd=DEMUCS_DIR)

    # 5. 复制到 resources
    exe_src = DEMUCS_DIR / "dist" / "demucs_cli.exe"
    if not exe_src.exists():
        print(f"错误: 未找到 {exe_src}")
        sys.exit(1)

    RESOURCES_DEMUCS.mkdir(parents=True, exist_ok=True)
    exe_dst = RESOURCES_DEMUCS / "demucs_cli.exe"
    print(f"\n5. 复制到 {exe_dst}")
    shutil.copy(exe_src, exe_dst)

    print("\n✅ 完成！执行 npm run electron:build 时 demucs 将自动打包进安装包。")


if __name__ == "__main__":
    main()
