# PHASE8_1_RUNNINGHUB_DIAGNOSTIC_REPORT.md

**日期**：2026-09-05  
**范围**：只读排查 + RunningHub 直连诊断（**不经** AIXFLOW `/tasks/create` / charge / slot）  
**关联失败任务**：`164a3fb2-3381-43a0-ba80-b1a8a84abc31`  
**结论类型**：**A. RunningHub 接口/区域问题**  
**本轮是否改代码**：**否**

---

## 最终结论（三选一）

```text
A. RunningHub 接口/参数问题
```

具体：

```text
AIXFLOW 将 /rhart-video-s/text-to-video（sora-2）默认打到 CN：
https://www.runninghub.cn/openapi/v2/rhart-video-s/text-to-video

RunningHub 返回 HTTP 200 + errorCode=40310：
该模型在 CN 节点已因合规下线，须改用全球站 runninghub.ai

taskId 为空字符串 → AIXFLOW 判定 PROVIDER_NO_TASK_ID → 退款释放
```

**不是** B（parser 误读官方成功结构）。  
**不是** C（CN 调用未创建 provider 任务；taskId 为空）。

---

## 1. AIXFLOW 实际 RunningHub endpoint

运行时（与 `providerRhClient.submitRunningHub` / `runningHubTarget` 一致）：

| 项 | 值 |
|----|-----|
| forward path | `/rhart-video-s/text-to-video` |
| `forceOverseasByBillingOrPath('…', 'sora-2')` | **false** |
| `pathMatchesOverseasPrefix` | **false** |
| region | **cn** |
| **最终 URL** | **`https://www.runninghub.cn/openapi/v2/rhart-video-s/text-to-video`** |
| API Key 来源（FC） | `RUNNINGHUB_API_KEY`（PRESENT；本报告不打印值） |

对照官方文档示例站：`https://www.runninghub.cn/openapi/v2/rhart-video-s/text-to-video`（文档仍写 CN；**现网业务已拒绝 CN**）。

---

## 2. AIXFLOW 实际 request body

失败任务 `provider_forward_json`：

```json
{
  "provider": "runninghub",
  "path": "/rhart-video-s/text-to-video",
  "method": "POST",
  "billingModelId": "sora-2",
  "body": {
    "prompt": "P81 live sora2 t2v golden path e2e",
    "duration": "10",
    "aspectRatio": "16:9"
  }
}
```

字段名与官方契约一致（`duration` / `prompt` / `aspectRatio`；`storyboard` 可选，未传）。

---

## 3–5. RunningHub HTTP / 原始 body / JSON 结构

### 直连诊断 · CN（复现 AIXFLOW 路径）

**凭证**：从 HK FC `nexflow-api` 环境注入（不经 queue）。  
**脚本**：`scripts/diag-runninghub-sora2-t2v.mjs`  
**结果文件**：`scripts/phase8-1-rh-diag-result.json`

| 项 | 值 |
|----|-----|
| HTTP status | **200** |
| Content-Type | `application/json` |
| Authorization | `Bearer ***REDACTED***` |

**原始 body：**

```json
{
  "taskId": "",
  "status": "",
  "errorCode": "40310",
  "errorMessage": "Due to compliance requirements, this model is no longer available on the CN endpoint. Please migrate to the AI endpoint (runninghub.ai). | 因合规要求，该模型在当前CN节点已下线，请前往全球站 (runninghub.ai) 接入使用。",
  "results": null,
  "clientId": "",
  "promptTips": "",
  "failedReason": {},
  "usage": null,
  "parentTaskId": null,
  "taskUsageList": null
}
```

### 直连诊断 · AI（对照）

**脚本**：`scripts/diag-runninghub-sora2-t2v-ai.mjs`  
**结果文件**：`scripts/phase8-1-rh-diag-ai-result.json`  
**URL**：`https://www.runninghub.ai/openapi/v2/rhart-video-s/text-to-video`  
**Key**：`RUNNINGHUB_API_KEY_AI`（FC PRESENT）

| 项 | 值 |
|----|-----|
| HTTP status | **200** |
| taskId | **`2096068387561435138`** |
| status | `QUEUED` → query 后 `RUNNING` |

**说明**：对照调用在全球站**真实创建了** RH 任务 `2096068387561435138`（诊断用途，未写 AIXFLOW nx_tasks / 未扣 AIXFLOW 费）。  

---

## 6. taskId 实际位于哪里

| 场景 | taskId 位置 |
|------|-------------|
| 官方成功契约 | **顶层** `taskId`（string） |
| CN 40310 失败 | 顶层 `taskId: ""`（空） |
| AI 成功 | 顶层 `taskId: "2096…"` |

无嵌套 `data.taskId` 需求；当前失败不是「字段改名躲在别处」。

---

## 7. 当前 parser 如何取 taskId

`extractRhTaskIdFromForwardData`（`lib/runningHubTarget.mjs`）：

```text
data.taskId || data.task_id || data.data.taskId || data.data.task_id
```

对官方成功响应：**正确**。  
对 CN 40310：`taskId === ""` → 解析为空 → **正确触发** `PROVIDER_NO_TASK_ID`。

`submitRunningHub` 仅以 `res.ok`（HTTP）为 `submit.ok`；HTTP 200 + 空 taskId → Phase7：

```text
submit.ok && !provider_task_id → failDispatchClearAndRefund(PROVIDER_NO_TASK_ID)
```

与任务 `164a3fb2-…` 的 charge/refund 行为一致。

---

## 8. 为什么得到 PROVIDER_NO_TASK_ID

```text
HTTP 200
+ taskId 为空
+ errorCode 40310（CN 模型下线）
→ parser 取不到非空 taskId
→ PROVIDER_NO_TASK_ID
→ 退款 + 释放 slot
```

不是 queue/charge bug；是 **站点选错（CN vs AI）**。

---

## 9–11. RunningHub 是否创建了任务 / sora-2 是否可调用

| 调用 | 是否创建 RH 任务 | 说明 |
|------|----------------|------|
| AIXFLOW Live（CN）`164a3fb2-…` | **否** | 响应 taskId 空 + 40310 |
| 直连诊断 CN | **否** | 同上 |
| 直连诊断 AI | **是** | `2096068387561435138`（诊断任务） |

```text
sora-2（AIXFLOW billing id）≠ RH「模型名」参数
AIXFLOW 映射为 RH Model API path：/rhart-video-s/text-to-video（全能视频S 文生）
该 API 对当前 FC 账号：
  · CN Key → 不可用（40310）
  · AI Key → 可用（返回真实 taskId）
```

**确认**：Live 失败那次 **provider task 未被创建**（非 C 类丢失 taskId）。

---

## 12. 是否需要修改代码？

本轮纪律：**先诊断，不改代码。**

| 选项 | 是否本轮执行 |
|------|----------------|
| 改 PROVIDER_NO_TASK_ID 判定 / 假 taskId | **禁止** |
| 改 charge/queue/concurrency | **禁止** |
| 修 parser 去「猜多个字段」 | **不需要**（parser 符合官方成功契约） |
| **路由**：将 `rhart-video-s/*`（或 sora-2 billing）强制走 **`.ai` + `RUNNINGHUB_API_KEY_AI`** | **需要，但须你另授权**（属 A 类配置/分流修复，非改 Phase 5/6 钱并发） |

可选增强（另授权）：HTTP 200 且 `errorCode` 非空时，把 `errorMessage` 写入 `provider_error`（便于观测）；**不得**因此把失败当成功。

---

## 映射链（确认）

```text
AIXFLOW model_id     = sora-2
    ↓
billing model_id     = sora-2
    ↓
provider             = runninghub
    ↓
path                 = /rhart-video-s/text-to-video
    ↓
当前选站             = CN（未命中海外白名单 / forceOverseas）
    ↓
URL                  = https://www.runninghub.cn/openapi/v2/rhart-video-s/text-to-video
    ↓
body                 = { prompt, duration, aspectRatio }
    ↓
RH 响应              = 200 + errorCode 40310 + taskId ""
```

---

## 风险与纪律

- **C 类风险（丢失已创建 taskId）**：对本次 Live CN 失败 **不成立**。  
- AI 诊断创建了 RH 任务 `2096068387561435138`：仅诊断；未入 AIXFLOW 账本。  
- **未修改**业务代码；**未跑 G**；**未进 Phase 8.2**。

```text
PHASE 8.1 = NOT_READY
F = FAIL（根因：RH CN 40310 / 须迁 AI 站）
G = NOT_RUN
```

等待你授权是否将 `rhart-video-s`（sora-2 Golden Path）强制路由到 `runninghub.ai` 后再重跑 F。
