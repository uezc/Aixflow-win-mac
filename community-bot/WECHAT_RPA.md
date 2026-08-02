# 微信桌面 RPA（推荐路径）

本目录的**官方接入方式**是：对本机已登录的 **PC 微信**做截图 OCR + 拟人键鼠发送。  
**不使用**微信协议登录、Hook/注入，也**不把**企业微信 Webhook 当作主路径（`wechat-bot.mjs` 仅作可选遗留）。

## 原理

1. 截取微信聊天窗口 → RapidOCR 识别文字  
2. 检测「加入了群聊」或「1/2/3 / 下载 / 接单 / 派活」等意图  
3. 调用 Node `core.mjs`（经 `rpa-bridge.mjs`）得到 `{ messages: string[] }`  
   - 若配置了 LLM（见下文），文案会基于 `knowledge-base.json` 改写成**口语化**中文  
   - 未配置 / 调用失败 → **自动回退**原有模板，RPA 仍可离线发  
4. 剪贴板粘贴 + 随机停顿 + Enter 发送（拟人）

## 安装

```powershell
cd D:\NEXFLOW\community-bot
pip install -r requirements-rpa.txt
```

需本机已安装 **Node.js**（用于跑 `core.mjs` / `rpa-bridge.mjs`）与 **Python 3.10+**。

## 运行前

1. 打开 **PC 版微信**，进入目标群聊天窗口（尽量保持前台可见）  
2. **务必先 dry-run**，确认 OCR 能认出进群/意图文案，且不会误发

## Dry-run（只识别不发送）

PowerShell：

```powershell
cd D:\NEXFLOW\community-bot
$env:WECHAT_RPA_DRY_RUN = "1"
python wechat_rpa.py
```

或：

```powershell
npm run rpa:dry
```

仓库根目录也可：`npm run community:rpa:dry`

控制台会出现明显的 `[DRY-RUN]` 横幅，并打印「将发送」内容，**不会**真正往群里打字。

## 正式发送

```powershell
cd D:\NEXFLOW\community-bot
Remove-Item Env:WECHAT_RPA_DRY_RUN -ErrorAction SilentlyContinue
python wechat_rpa.py
# 或: npm run rpa
```

## 校准输入框坐标（可选）

若粘贴没进输入框，用环境变量指定点击位置（屏幕像素）：

```powershell
$env:WECHAT_INPUT_X = "960"
$env:WECHAT_INPUT_Y = "980"
python wechat_rpa.py
```

轮询间隔（秒，默认约 2.5）：

```powershell
$env:WECHAT_RPA_INTERVAL = "3"
```

## 安全与合规注意

- **无协议 / 无 Hook**：仅本机截图 + 键鼠模拟，降低封号相关风险，但群规与微信 ToS 仍需自行遵守。  
- **拟人延迟**：发送前后有随机停顿，避免机械连发。  
- **紧急中止**：`pyautogui` 开启 FAILSAFE——鼠标甩到屏幕**左上角**可强制中断。  
- **先 dry-run**：避免 OCR 误判导致刷屏。  
- 本助手会尽量忽略自己刚发出的文案，减少「自己回复自己」。

## 自检 Node 核心

```powershell
cd D:\NEXFLOW\community-bot
npm run bridge:test
node rpa-bridge.mjs "{\"userId\":\"t\",\"displayName\":\"测\",\"isNewJoin\":true}"
```

应打印 `bridge-ok` / 一段含 `messages` 的 JSON。未配 LLM 时 `llm` 为 false，文案为模板。

## LLM 口语化（可选）

复制 `.env.example` → `.env`，任选一种：

### A. 本机 Ollama

```powershell
# 先安装并拉取模型，例如：ollama pull qwen2.5:7b
$env:COMMUNITY_LLM_ENABLED = "1"
# 或：
# $env:LLM_PROVIDER = "ollama"
# $env:OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1"
# $env:OLLAMA_MODEL = "qwen2.5:7b"
node rpa-bridge.mjs "{\"userId\":\"t\",\"displayName\":\"小明\",\"isNewJoin\":true}"
```

### B. 阿里云 DashScope（兼容 OpenAI）

```powershell
$env:DASHSCOPE_API_KEY = "sk-..."
# 可选：$env:DASHSCOPE_MODEL = "qwen-plus"
```

### C. OpenAI / 其它兼容接口

```powershell
$env:OPENAI_API_KEY = "sk-..."
# 可选：$env:OPENAI_BASE_URL = "https://api.openai.com/v1"
# 可选：$env:OPENAI_MODEL = "gpt-4o-mini"
```

关闭 LLM：`$env:COMMUNITY_LLM_ENABLED = "0"`，或清空上述 Key。

知识库：`knowledge-base.json` 里 `product` / `replies`（模板回退）以及 `docs` / `faqs`（给 LLM 读的摘录）。

## 可选遗留：企业微信 HTTP

`npm run wechat-api` → `wechat-bot.mjs` 为企业微信 Webhook/回调遗留入口，**不是**个人微信社群的推荐方案。个人微信请用本文 RPA。
