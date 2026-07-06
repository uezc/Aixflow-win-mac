# 构建本地 RVC 推理引擎（首次下载 / 可选打进安装包）

NEXFLOW **RVC 翻唱**在客户端本地完成（Demucs 分离 → RVC 推理 → 与伴奏混回），不调用 RunningHub 翻唱 API。

## 产物布局

```
resources/rvc/                    # 可选：随安装包携带 manifest
  manifest.json

userData/rvc-engine/              # 首次下载默认解压位置
  rvc_infer_cli.exe
  assets/hubert_base.pt
  assets/rmvpe.pt
```

## 开发态（无 exe）

1. 安装 Python 3.9+ 与 Visual C++ 运行库
2. `pip install infer-rvc-python torch torchaudio`
3. 将 HuBERT / RMVPE 放入 `userData/rvc-engine/assets/`（或通过应用内「下载本地 RVC 引擎」）

直接测试：

```bash
python scripts/build-rvc-cli/launch_rvc_infer.py \
  --model-pth path/to/model.pth \
  --input path/to/vocals.wav \
  --output path/to/out.wav \
  --hubert path/to/hubert_base.pt \
  --rmvpe path/to/rmvpe.pt \
  --pitch 0
```

## 打包 exe（发布用）

参考 `scripts/build-demucs-cli/`，使用 PyInstaller 将 `launch_rvc_infer.py` 及依赖打成 `rvc_infer_cli.exe`，上传 OSS 后在 `resources/rvc/manifest.json` 填写 `bundleUrl`。

## 环境变量

- `NEXFLOW_RVC_ENGINE_BUNDLE_URL`：覆盖 manifest 中的引擎 zip 下载地址
