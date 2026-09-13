# 阿里云 FC 云函数示例

## 正式版（当前 index.mjs）

- **POST /auth/send-code**、**POST /auth/login**：邮箱验证码登录（6 位码，5 分钟有效，Resend 发信）；新用户自动写入 `nx_users`（无密码，仅验证码登录）。**send-code** 按 `nx_verify_codes.send_rate_ts` 限流（默认 **60 秒内 1 次**、**滑动 1 小时内 5 次**，见 `NX_SEND_CODE_*`）
- **POST /register**、**POST /login**、**POST /refresh**：邮箱 + 密码，JWT（access/refresh 的 payload 含 `tv`，与 `nx_users.token_version` 一致；**改密后递增版本，旧 token 全部失效**）
- **POST /auth/change-password**：邮箱 + 验证码 + 新密码；成功后返回 `session_revoked: true`
- **POST /run-task**：`Authorization: Bearer <access_token>` + `taskId`（body 或 `x-task-id`），扣费后转发 BLTCY
- **POST /me**：Bearer 鉴权，返回余额
- **POST /asr/realtime-session**：签发百炼实时 ASR 票据（需 FC 环境变量 `DASHSCOPE_API_KEY`；默认模型 `fun-asr-realtime`；`authorization` 仅供 Electron 主进程建 WebSocket）
- **POST /asr/file-transcribe**：百炼 `fun-asr` 异步录音文件识别（同 Key；入参公网 `fileUrl` + 可选 `language`；轮询任务后返回 `{ text, segments:[{ text, startSec, endSec }] }`，供 MV 歌词时间线）
- **init-user**：已废弃（410）

### 上传 ZIP 到 FC 之前（控制台必查，避免 412 / 启动失败）

1. **删掉环境变量里的 `PATH`（若存在）**  
   不要从本机复制 `PATH` 到函数配置：其中常含 Windows 路径或错误的 Linux 路径，会导致云端找不到 `node`、工作目录错乱，进而部署或运行异常（含 **412** 等前置条件失败）。  
   **做法**：在函数「环境变量」里找到名为 **`PATH`** 的项，**直接删除**；让 FC/自定义运行时使用平台默认路径。

2. **填死 `OTS_ENDPOINT`（与实例地域、网络一致）**  
   函数与 Tablestore **同地域**且走 **VPC 内网**时，应使用控制台给出的 **内网 Endpoint**（形如 `https://<实例名>.<地域>.ots-internal.aliyuncs.com`）。  
   当前项目示例（北京、实例名 `aixflow-db`）：  
   **`https://aixflow-db.cn-beijing.ots-internal.aliyuncs.com`**  
   若你改用公网或香港等地域，请改为控制台该实例对应的 Endpoint，**勿混用地域**。

打包文件名可能为仓库脚本生成的 `dist-hongkong-fc.zip`，或你重命名后的 `aixflow-backend.zip`；上传前同样执行以上检查。

### Tablestore 建表（5 张）

| 表名（环境变量） | 主键 | 属性列 |
|------------------|------|--------|
| `nx_users`（OTS_TABLE_USERS） | user_id (STRING) | email, password_hash, balance, created_at (**INTEGER** 毫秒), last_login_at, status, **token_version（INTEGER，会话版本）** |
| `nx_transactions`（OTS_TABLE_TRANSACTIONS） | transaction_id (STRING)，可用 `OTS_TRANSACTIONS_PK` 覆盖 | user_id, task_id, amount, balance_after, type, provider, description, created_at；注册成功会额外写入 `transaction_id = welcome_<user_id>`、`type = welcome_bonus`（新手礼包） |
| `nx_tasks`（OTS_TABLE_TASKS） | task_id (STRING) | user_id, status, cost, prompt_json, workflow_json, result_oss_url, **created_at / updated_at 建议 INTEGER（毫秒）** |
| `nx_email_user`（OTS_TABLE_EMAIL） | email (STRING) | user_id |
| `nx_verify_codes`（OTS_TABLE_VERIFY_CODES） | email (STRING) | code (STRING), expires_at (**INTEGER** 毫秒), created_at (**INTEGER** 毫秒), **send_rate_ts（STRING，JSON 数组，发信时间戳，用于限流）** |

### 环境变量（追加）

| 变量 | 说明 |
|------|------|
| JWT_SECRET | 必填，access_token 签名 |
| JWT_REFRESH_SECRET | 可选，默认与 JWT_SECRET 相同 |
| JWT_ACCESS_EXPIRES | 默认 30m |
| JWT_REFRESH_EXPIRES | 默认 7d |
| NX_INITIAL_BALANCE | 注册赠送点数，默认 10 |
| NX_CHAT_COST | 单次对话扣点（LLM），默认 5 |
| NX_IMAGE_COST | 图片类 forward 扣点，默认同 NX_CHAT_COST |
| NX_VIDEO_COST | 视频类 forward 扣点，默认同 NX_CHAT_COST |
| NX_AUDIO_COST | 音频类 forward 扣点，默认同 NX_CHAT_COST |
| NX_FORWARD_TIMEOUT_MS | 转发第三方超时（毫秒），默认 300000 |
| RUNNINGHUB_API_BASE | RunningHub **国内** OpenAPI 根路径，默认 `https://www.runninghub.cn/openapi/v2` |
| RUNNINGHUB_API_KEY | RunningHub **国内** Bearer（图/音/视经 FC 转发；勿放客户端） |
| RUNNINGHUB_API_BASE_AI | RunningHub **海外** OpenAPI 根路径，默认 `https://www.runninghub.ai/openapi/v2` |
| RUNNINGHUB_API_KEY_AI | RunningHub **海外** Bearer（白名单模型走 `.ai`；京/港 FC 均需配置） |
| RUNNINGHUB_LLM_API_KEY | RunningHub **LLM**（`llm.runninghub.ai`）Bearer；未设时回退 `RUNNINGHUB_API_KEY_AI` |
| RUNNINGHUB_LLM_BASE_URL | 可选，默认 `https://llm.runninghub.ai/v1` |
| RUNNINGHUB_OVERSEAS_PATH_PREFIXES | 可选。逗号分隔 path 前缀，**整表覆盖**默认海外白名单（Veo/banana/Grok/SUNO/Gemini Omni 等） |
| BLTCY_API_BASE | 核心算力 API 根路径，默认 `https://api.apilio.ai`（原 bltcy.ai；LLM 与 `forward.provider=bltcy` 时使用） |
| DASHSCOPE_API_KEY | 百炼 API Key（实时听写 + 录音文件识别共用；勿下发客户端） |
| DASHSCOPE_ASR_MODEL | 可选，实时模型，默认 `fun-asr-realtime` |
| DASHSCOPE_ASR_FILE_MODEL | 可选，文件转写模型，默认 `fun-asr`（可钉 `fun-asr-2025-11-07`） |
| DASHSCOPE_WORKSPACE_ID | 可选，业务空间 ID（实时 WS / 文件转写 HTTP 专属域名） |

> **双基址说明**：FC 按 `forward.path` 前缀分流到 `.cn` 或 `.ai`；`/query` 通过 OTS `rhreg:{taskId}` 与提交同站。北京/香港 FC 的「区域」与 RH 站点无关，两套环境变量需在京港**同步**配置。

> **文件转写**：部署含 `lib/asrFileTranscribe.mjs` 后，函数**执行超时建议 ≥ 600 秒**（FC 内轮询百炼异步任务）。

### 部署与冒烟（海外分流）

1. 在 `demo/aliyun-fc-init-user` 执行 `npm run deploy`，将生成的 `nexflow-fc.zip` / `nexflow-fc-new.zip` 分别上传到**北京与香港** FC。
2. 控制台确认：`RUNNINGHUB_API_KEY`、`RUNNINGHUB_API_KEY_AI` 均已配置（`BASE_AI` 可省略用默认）。
3. 冒烟清单：
   - **应走 `.ai`**：banana 2.0、Veo/全能 v3.1-fast、Grok 视频、SUNO、Gemini Omni — 各提交 1 次并轮询出结果；FC 日志应出现 `[RH] forward region=ai`。
   - **应走 `.cn`**：可灵或 Seedream — 提交 1 次；日志 `region=cn`。
   - Sora 角色/参考图上传经 FC（`rhRegion=cn`），不再直连 `www.runninghub.cn/openapi`。
4. 401：国内失败提示检查 `RUNNINGHUB_API_KEY`；海外失败提示检查 `RUNNINGHUB_API_KEY_AI`。

**Tablestore 连接（必填，与下面建表一致）**

| 变量 | 说明 |
|------|------|
| OTS_ENDPOINT | **须与实例、网络一致**：公网形如 `https://xxx.cn-hangzhou.ots.aliyuncs.com`；**同地域 VPC 内网**用 `https://xxx.<region>.ots-internal.aliyuncs.com`（见上文「上传 ZIP 前」示例） |
| OTS_INSTANCE / OTS_INST_NAME | **实例名称**（二选一；控制台实例列表里的名称，不是随机 ID） |
| OTS_ACCESS_KEY_ID / OTS_ACCESS_KEY_SECRET | 需有该实例的读写的 RAM 用户 |
| OTS_TABLE_USERS | 可选，默认 `nx_users`（代码内会 `.toLowerCase()`） |
| OTS_TABLE_EMAIL | 可选，默认 `nx_email_user` |
| OTS_TABLE_TRANSACTIONS | 可选，默认 `nx_transactions` |
| OTS_TABLE_TASKS | 可选，默认 `nx_tasks` |
| OTS_TABLE_VERIFY_CODES | 可选，默认 `nx_verify_codes`（验证码登录必填） |
| RESEND_API_KEY | Resend API Key（验证码邮件） |
| RESEND_FROM_EMAIL | 发件人，如 `AIXflow <onboarding@resend.dev>` |
| NX_SEND_CODE_MIN_MS | 发验证码最小间隔（毫秒），默认 `60000` |
| NX_SEND_CODE_HOUR_MS | 滑动窗口长度（毫秒），默认 `3600000`（1 小时） |
| NX_SEND_CODE_PER_HOUR_MAX | 上述窗口内最多发送次数，默认 `5` |

### 注册返回 500 时排查

1. **看 FC 日志**：每次请求会打印 `OTS config: {...}`，确认 `endpointSet/instanceSet/akSet` 均为 `true`，且 `tables` 与控制台表名一致。
2. **主键名必须完全一致**（区分大小写）：`nx_users` 只有一列主键 **`user_id`**（STRING）；`nx_email_user` 只有一列主键 **`email`**（STRING）。若控制台建成 `userid`、`UserId` 等，会 OTS 报错。
3. **属性列名**：`nx_users` 需包含 `email`、`password_hash`、`balance`（INTEGER）、`created_at`、`last_login_at`、`status` 等（见上表）；缺列可能导致写入失败（视控制台是否开宽表/自动列而定）。
4. **Endpoint 地域**：`OTS_ENDPOINT` 必须与实例所在地域一致；跨地域常报连接或权限错误。
5. 部署后若仍 500，在日志中搜 `[createUser] putRow` 或 `[register]`，错误里的 `OTS`/`code` 可对照[表格存储错误码](https://help.aliyun.com/zh/tablestore/developer-reference/error-codes)。

### 获取验证码报错 `Cannot find package 'resend'`

说明上传的函数代码包 **未包含 `resend` 依赖**（常见于用旧版 `scripts/deploy-fc.js` 打的精简包，或控制台上传时漏带 `node_modules`）。

1. 在 **`demo/aliyun-fc-init-user`** 下重新执行 **`node scripts/deploy-fc.js`**（当前脚本已在精简包中安装 **resend**），将生成的 **`nexflow-fc.zip`** 上传覆盖函数代码。  
2. 或在该目录执行 **`npm install`** 后，将整个目录（含 **`node_modules`**）按 FC 要求打成 zip 再上传。  
3. 确认 FC 环境变量 **`RESEND_API_KEY`**、**`RESEND_FROM_EMAIL`** 已配置。

---

## 旧版文档（machine_id / 旧 users 表）

以下为历史说明，**正式版请使用上表结构**。

适配 NEXFLOW 云端余额与任务中转，提供 **init-user**、**run-task**、**deduct-balance** 三个接口。

## 入口选择

| 入口文件 | 存储方式 | 说明 |
|----------|----------|------|
| index.mjs | Tablestore（账本版） | 推荐：users + ledger 双表，幂等扣费，FC 3.0 解析 |
| index-db.mjs | Tablestore / OSS JSON | 兼容 FC 2.0 格式 |

---

## 接口说明

### 1. init-user（注册/查余额）

**请求** `POST /init-user`  
Header: `x-nexflow-token: <API_SECRET_TOKEN>`
```json
{ "username": "machineId 或设备唯一标识" }
```

**响应** `200 OK`
```json
{ "userId": "user_xxx", "balance": 100, "isPro": false }
```

新用户自动注册，余额初始 100。

---

### 2. run-task（任务中转+扣费）

**请求** `POST /run-task`  
Header: `x-nexflow-token`, `x-user-id`（持久化）, `x-task-id`（UUID，防重复扣费）
```json
{
  "machineId": "设备唯一标识",
  "taskId": "uuid",
  "provider": "bltcy",
  "path": "v1/chat/completions",
  "method": "POST",
  "body": { ... }
}
```

**逻辑**：校验 token → 限流 → 幂等检查 task_id → 扣 5 元宝 + 写流水 → 转发 BLTCY → 失败自动退款 + 补写退款流水

**响应** `200 OK`：下游 API 返回数据 + 扣费后余额
```json
{ ...apiData, "balance": 95 }
```

---

### 3. deduct-balance（扣费/退费）

**请求** `POST /deduct-balance`  
Header: `x-nexflow-token: <API_SECRET_TOKEN>`
```json
{ "machineId": "设备标识", "amount": 5, "action": "deduct" }
```
或退费：`{ "machineId": "xxx", "amount": 5, "action": "refund" }`

**响应** `200 OK`
```json
{ "action": "deduct", "balance": 95 }
```

---

## 方案一：index.mjs + Tablestore（账本版）

### 1. Tablestore 建表

**users 表**（`OTS_TABLE`，默认 `users`，全小写）  
- 主键：`machine_id` (STRING)  
- 属性列：`user_id`, `balance` (INTEGER), `is_pro`, `created_at`, `updated_at`

**ledger 表**（`OTS_LEDGER_TABLE`，默认 `nexflow_ledger`，幂等+流水）  
- 主键：`machine_id` (STRING), `task_id` (STRING)  
- 属性列：`amount` (INTEGER), `created_at`

### 2. 环境变量（FC 控制台）

| 变量 | 说明 |
|------|------|
| OTS_ENDPOINT | 实例 Endpoint |
| OTS_INSTANCE | 实例名称 |
| OTS_ACCESS_KEY_ID | AccessKey ID |
| OTS_ACCESS_KEY_SECRET | AccessKey Secret |
| OTS_TABLE | users 表名，默认 users（全小写） |
| OTS_LEDGER_TABLE | ledger 表名，默认 nexflow_ledger（全小写） |
| API_SECRET_TOKEN | 必填 |
| BLTCY_API_KEY | run-task 用 |

### 3. 部署

- 入口文件：`index.mjs`，入口函数：`handler`
- 依赖：`tablestore`（无 axios，使用 fetch）
- **打包**：执行 `npm run deploy`，生成 `nexflow-fc.zip`（含 `index.mjs` + `lib/db-tablestore.mjs` + `node_modules`）
- **上传**：将 `nexflow-fc.zip` 上传到阿里云 FC 控制台，注意必须包含 `lib/` 目录，否则 [db] 日志不会出现

---

## 方案二：index-db.mjs + OSS JSON

使用 OSS 存储单个 `users.json` 文件，适合轻量场景，无需建表。

### 1. OSS 准备

- 创建 Bucket（如已有可复用）
- 无需预创建对象，首次写入时自动创建 `nexflow/users.json`

### 2. 环境变量（FC 控制台）

| 变量 | 说明 |
|------|------|
| DB_TYPE | `oss_json` |
| OSS_REGION | 如 oss-cn-hongkong |
| OSS_BUCKET | Bucket 名称 |
| OSS_ACCESS_KEY_ID | AccessKey ID |
| OSS_ACCESS_KEY_SECRET | AccessKey Secret |
| OSS_USERS_OBJECT | 可选，默认 `nexflow/users.json` |
| API_SECRET_TOKEN | 必填 |
| BLTCY_API_KEY / RUNNINGHUB_API_KEY | run-task 用 |

### 3. 部署

- 入口文件：`index-db.mjs`，入口函数：`handler`
- 依赖：`axios`、`ali-oss`

---

## 方案三：PostgreSQL（index.js 旧版）

详见 `index-pg.js`，需配置 `DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER`、`DB_PASSWORD`。

---

## NEXFLOW 端配置

在 `.env` 中设置：

```env
ALIYUN_FC_INIT_USER_URL=https://你的函数公网URL
```

例如 HTTP 触发 URL 为：
`https://1234567890.cn-hangzhou.fc.aliyuncs.com/2016-08-15/proxy/init-user`
