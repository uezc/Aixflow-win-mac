# NEXFLOW 安装包构建说明

## Windows 一键安装包（当前）

- **输出**：`release/` 目录下生成 NSIS 安装程序（如 `NEXFLOW Setup 2.0.0.exe`）
- **安装方式**：一键安装，默认当前用户、创建桌面与开始菜单快捷方式
- **首次运行**：草稿（任务列表、项目列表）不保留；提示词（全局 LLM 人设）保留；API Key 需用户在设置中手动填写
- **离线安装（最终用户）**：成功执行 `npm run electron:build` 生成的安装包会把 **ffmpeg**、**yt-dlp** 一并打入（`electron-builder` 的 `extraResources`），用户侧**无需**再访问 GitHub 或执行 pip；构建流水线在 `verify-offline-bundle-resources.mjs` 校验通过后才继续打包，避免漏打二进制。

### 构建命令

```bash
npm run electron:build
```

将依次执行：`build:all` → `convert-icon` → `sync-llm-personas` → `copy-ffmpeg` → **`copy-yt-dlp`** → **`verify-offline-bundle`（确认 `resources/ffmpeg` 与 `resources/yt-dlp` 二进制存在且体积合理，否则中止打包）** → **`copy-env-for-packaging`（把项目根 `.env` 复制为 `resources/.env` 并打入安装包）** → `download-vc-redist` → `electron-builder`。完成后在 `release/` 下得到 Windows 安装包。

#### yt-dlp 与国内构建（重要）

默认脚本会尝试从 **GitHub** 拉取官方二进制；**国内构建机若无法访问 GitHub**，任选其一即可，无需改代码：

1. **镜像前缀**（由团队自行替换为当前可用的 GitHub 代理域名，示例仅作格式参考）  
   `set NEXFLOW_YTDLP_GITHUB_PROXY=https://ghproxy.net/`  
   脚本会下载：`代理前缀` + `https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe`（或当前平台对应文件名）。

2. **自定义下载基址**（整条替换到 `…/releases/latest/download` 为止）  
   `set NEXFLOW_YTDLP_RELEASE_BASE=https://你的镜像/yt-dlp/yt-dlp/releases/latest/download`

3. **单个文件完整 URL**（与当前构建平台一致）  
   `set YT_DLP_DOWNLOAD_URL=https://…/yt-dlp.exe`

4. **离线**：在可联网环境用浏览器从 [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases) 下载对应文件（Windows x64 为 `yt-dlp.exe`），放入仓库 **`resources/yt-dlp/`**（与 `resources/ffmpeg/` 同级）。`npm run copy-yt-dlp` 带 **`--if-missing`**：已有有效文件则**跳过下载**，适合内网流水线把该目录作为缓存或从制品库拷贝后再打包。

安装包内路径与主进程 `resolveYtDlpInvocation` 一致；最终用户仍可通过 **`YT_DLP_PATH`** 指定本机其它 yt-dlp。

**云端地址（ALIYUN_FC_INIT_USER_URL 等）**：开发时读项目根 `.env`；安装包需在**构建前**配置好根目录 `.env`，否则打好的程序内没有 FC 地址，会出现「未配置 ALIYUN_FC_INIT_USER_URL」、图片生成失败等。亦可仅在已安装机器上，把 `.env` 放到该应用的用户数据目录（与日志同级），启动时会覆盖内置配置。

**一键安装**：安装程序会自动静默安装 VC++ 运行库，用户无需额外安装任何依赖。

### 可选：将人声分离（Demucs）打包进安装包

若希望用户**无需安装 Python**即可使用人声分离功能，需先构建 `demucs_cli.exe`：

```bash
python scripts/build-demucs-cli/build_demucs.py
```

脚本会克隆 Demucs、安装依赖、用 PyInstaller 构建 exe，并复制到 `resources/demucs/`。之后执行 `npm run electron:build` 时，Demucs 将自动打包进安装包。

- **前置要求**：Python 3.9+、Git
- **构建时间**：约 5–15 分钟
- **体积**：demucs_cli.exe 约 500MB–1GB，安装包会显著增大
- **首次使用**：模型会在首次人声分离时自动下载（需联网）

**说明**：构建脚本使用 `diffq-fixed`（含 Windows 预编译 wheel）替代原版 `diffq`，无需安装 Visual C++ 编译工具。若仍遇构建失败，可安装 [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) 后重试。

### 可选：自定义图标

在项目根目录创建 `build/icon.ico`（256×256 或含多尺寸的 ICO），并在 `package.json` 的 `build.win` 中增加：

```json
"icon": "build/icon.ico"
```

---

## 其他系统安装包（后期）

当前已在 `package.json` 的 `build` 中预留配置，后续可按需执行：

| 系统   | 命令（在对应系统上执行）     | 目标格式 |
|--------|------------------------------|----------|
| macOS  | `npm run electron:build -- --mac`   | DMG      |
| Linux  | `npm run electron:build -- --linux` | AppImage |

- **macOS**：需在 Mac 上构建；`build.mac` 已配置 `dmg` 与 category
- **Linux**：可在 Linux 或 WSL 中构建；`build.linux` 已配置 `AppImage`

首次运行逻辑（草稿不保留、提示词保留）在所有平台一致。

---

## 模型管理后台：独立便携包（Windows）

目标：生成**可单独拷贝运行的文件夹**（内含 Python 运行时与依赖），目标机器**无需**预先安装 Python，用法接近普通绿色软件。

- **前置**：本机构建机为 Windows x64，已安装 PowerShell 5+，可访问外网（首次需下载 embeddable Python 与 pip 包）。
- **构建**：在仓库中执行：

```bat
cd tools\aixflow_model_admin\scripts
build_portable.bat
```

或在 `tools\aixflow_model_admin` 下：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build_portable.ps1
```

可选参数示例：`-PythonVersion 3.12.8`（需与官方 embed 包版本一致）。

- **产物**：`tools/aixflow_model_admin/dist_portable/NEXFLOW-Model-Admin/`
  - `python/`：官方 embeddable 解释器及 `site-packages`
  - `app/`：`app.py`、`launch_desktop.py`、`.streamlit/secrets.toml.example`
  - **双击 `START-with-console.bat`**：启动管理后台（会保留命令行窗口便于查看日志；内嵌 WebView2 需已打入 `requirements-desktop.txt` 中的 `pywebview`）
- **分发**：将整个 `NEXFLOW-Model-Admin` 文件夹打 zip 给用户；首次使用在 `app\.streamlit\` 下按 `secrets.toml.example` 复制为 `secrets.toml` 并填写密码与 OTS 密钥。
- **体积**：含 Streamlit / Pandas 等，通常为数百 MB 量级；构建缓存位于 `tools/aixflow_model_admin/.build_portable_cache/`（已加入 `.gitignore`）。
