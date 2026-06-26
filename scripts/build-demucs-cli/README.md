# 构建 Demucs 独立可执行文件（用于打包进 NEXFLOW 安装包）

人声分离功能依赖 Demucs。若希望安装包**无需用户安装 Python**即可使用，需先构建 `demucs_cli.exe` 并放入 `resources/demucs/`。

## 前置要求

- **Python 3.9**（推荐 3.9.13）：https://www.python.org/ftp/python/3.9.13/python-3.9.13-am64.exe
- **Git**
- **Visual C++ 运行库**：https://aka.ms/vc14/vc_redist.x64.exe

## 一键构建（推荐）

在项目根目录执行：

```bash
python scripts/build-demucs-cli/build_demucs.py
```

脚本会自动：克隆 demucs、安装依赖、构建 exe，并复制到 `resources/demucs/demucs_cli.exe`。

## 手动构建

若自动脚本失败，可手动执行：

```bash
cd scripts/build-demucs-cli
git clone https://github.com/facebookresearch/demucs.git
cd demucs
pip install -r requirements.txt
pip install "numpy<2"
pip install pyinstaller
# 复制 launch_demucs.py 和 demucs_cli.spec 到当前目录
pyinstaller demucs_cli.spec
# 将 dist/demucs_cli.exe 复制到 项目根/resources/demucs/
```

## 构建后

执行 `npm run electron:build` 时，若存在 `resources/demucs/demucs_cli.exe`，将自动打包进安装包。用户安装后无需再安装 Python 或 Demucs。

## 注意事项

- **体积**：demucs_cli.exe 约 500MB–1GB（含 PyTorch），安装包会显著增大
- **首次运行**：模型会在首次使用时下载到 `%USERPROFILE%\.cache\torch\hub\checkpoints`，需联网
- **FFmpeg**：NEXFLOW 已内置 ffmpeg，demucs 会通过系统 PATH 或同目录查找
