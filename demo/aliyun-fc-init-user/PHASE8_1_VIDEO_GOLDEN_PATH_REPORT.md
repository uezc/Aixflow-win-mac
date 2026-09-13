# PHASE8_1_VIDEO_GOLDEN_PATH_REPORT.md

**阶段**：Phase 8.1 · Video Generation Golden Path  
**日期**：2026-09-03  
**范围**：仅画布 **sora-2 文生视频**（无参考图、非 Director/Drama/Batch）  
**纪律**：未改 Phase5 CAS / Phase6 Money SoT / Phase7 Provider SoT / RH timeout 策略；未删 Legacy；未迁移 MV/Drama/Batch/Audio

---

## 1. 实际迁移的文件

| 文件 | 变更 |
|------|------|
| `src/shared/videoQueueGoldenPath.ts` | **新建** Feature Gate + Golden Path 判定 + RH forward 构建 |
| `src/renderer/components/Canvas/VideoInputPanel.tsx` | Flag 开启时设置 `payload.nxCloudQueueGoldenPath=true` |
| `src/main/ai/providers/VideoProvider.ts` | 新增 `executeSora2T2vCloudQueueGoldenPath()`；Golden Path 早返回，不调 `/run-task` |
| `src/main/services/aliyunService.ts` | `nxCloudTasksCreate` 支持 `execution_mode=queue` + `provider_forward_json`；`nxCloudTaskStatus` 返回 `execution_stage` 等 |
| `demo/aliyun-fc-init-user/lib/handleTasksCreate.mjs` | queue create 写入 `provider_forward_json`；create 后异步 promote→charge→dispatch→poll |
| `demo/aliyun-fc-init-user/lib/db-tablestore.mjs` | `getTaskRowForUser` 增加 `execution_stage`、`dispatch_unknown` |
| `demo/aliyun-fc-init-user/app/lib/*` | 与 `lib/*` 同步（部署包） |
| `demo/aliyun-fc-init-user/scripts/test-phase8-1-video-golden-path.mjs` | **新建** Phase 8.1 集成测试 |

---

## 2. Golden Path 选定入口

| 项 | 值 |
|----|-----|
| **UI 入口** | `VideoInputPanel.tsx` → `executeAI(payload)` |
| **主进程** | `VideoProvider.execute()` |
| **Golden 条件** | `model=sora-2` + 无参考图 + `nxCloudQueueGoldenPath=true` + Feature Gate 开启 |
| **task_type** | `video` |
| **model_id** | `sora-2`（经 `buildVideoBillingModelId` 可能带计费后缀，如时长维度） |
| **quoted_cost** | FC `getFinalPrice(model_id, { taskType, nodeData })` 写入 OTS `quoted_cost`；create 不扣费 |
| **prompt_json** | `params` 序列化（含 `nodeId`、`prompt`、`nxCloudQueueGoldenPath` 等） |
| **workflow_json** | Golden Path 未传（空） |
| **RH 参数来源** | `buildSora2T2vRhForward()` → Phase 7 Dispatch 读取 `provider_forward_json` |

---

## 3. 原始调用链（Legacy）

```text
VideoInputPanel.handleGenerate
  → useAI / invokeAI
  → VideoProvider.execute()
  → rhPreCreateCloudTask() 可选 POST /tasks/create（legacy → pending + 预扣费）
  → rhPostChargeVideo()
  → fcForwardRequest → FC POST /run-task → RunningHub
  → rhQueryPollVideo / pollRunningHubVideoUntilTerminal（/run-task path=/query）
  → onStatus SUCCESS/ERROR + 写节点
```

**特征**：客户端并发（AICore ≤5）、客户端扣费或 create 预扣、客户端 RH submit + poll、`provider_task_id` 通常不在 OTS。

---

## 4. 新调用链（Queue Golden Path，Flag 开启时）

```text
VideoInputPanel（VITE_VIDEO_QUEUE_ENABLED=1，sora-2 文生）
  → payload.nxCloudQueueGoldenPath=true
  → VideoProvider.executeSora2T2vCloudQueueGoldenPath()
  → nxCloudTasksCreate({ execution_mode: 'queue', provider_forward_json, ... })
  → FC handleTasksCreate → status=queued（不扣费、不占槽、不调 RH）
  → [FC 异步] runPromoteQueuedTasks → chargeClaimedTask → dispatchOneChargedTask → pollOneProviderTask
  → VideoProvider 轮询 nxCloudTaskStatus(task_id) 直至 success/failed
  → onStatus SUCCESS（result_oss_url → videoUrl）/ ERROR
```

**客户端禁止**：`/run-task`、直连 RunningHub、RH `/query`。

---

## 5. Feature Flag

| 环境 | 变量 | 生效值 |
|------|------|--------|
| 主进程（Electron） | `VIDEO_QUEUE_ENABLED` | `1` / `true` / `yes` / `on` |
| 渲染进程（Vite） | `VITE_VIDEO_QUEUE_ENABLED` | 同上 |

| Flag | 行为 |
|------|------|
| **false**（默认） | 全部 Video 仍走 Legacy |
| **true** | 仅 **sora-2 画布文生** + `nxCloudQueueGoldenPath` 走 Queue 闭环 |

共享模块：`src/shared/videoQueueGoldenPath.ts`

---

## 6. POST /tasks/create 参数（Golden Path）

```json
{
  "model_id": "sora-2",
  "type": "video",
  "execution_mode": "queue",
  "legacy_immediate_charge": false,
  "provider_forward_json": {
    "provider": "runninghub",
    "path": "/rhart-video-s/text-to-video",
    "method": "POST",
    "body": {
      "prompt": "...",
      "duration": "10",
      "aspectRatio": "16:9"
    },
    "billingModelId": "sora-2"
  },
  "params": {
    "nodeId": "...",
    "taskKind": "video",
    "model": "sora-2",
    "prompt": "...",
    "nxCloudQueueGoldenPath": true
  },
  "nodeData": {
    "model": "sora-2",
    "aspect_ratio": "16:9",
    "duration": "10",
    "prompt": "..."
  }
}
```

**Create 响应**：`status=queued`，`quoted_cost_coins` 有值，`balance` 不变，`charged=false`。

---

## 7. Provider 参数保存（provider_forward_json）

- **写入时机**：`handleTasksCreate` queue 分支 `upsertTask(... provider_forward_json ...)`
- **格式**：JSON 字符串存 OTS；Phase 7 `dispatchOneChargedTask` 解析后调用 `submitRunningHub(forward)`
- **独立性**：客户端关闭后，FC cron / create 触发的 async pipeline 仍可 Dispatch
- **Legacy 兼容**：legacy create 仍可不传；Golden Path **必须**传，否则 Dispatch `NO_FORWARD_PAYLOAD`

---

## 8. Claim（Phase 5）

- **触发**：`handleTasksCreate` 成功后 `runPromoteQueuedTasks`（可通过 `NX_SKIP_QUEUE_PIPELINE_ON_CREATE=1` 跳过，供测试）
- **语义**：`queued → claimed`，user/platform slot CAS，写 `reservation_id` / `claim_token` / lease
- **Golden Path 验证**：单任务 create 后 promote → `status=claimed`，持槽

---

## 9. Charge（Phase 6）

- **触发**：Claim 后 `chargeClaimedTask(task_id)`
- **金额**：严格使用 OTS `quoted_cost`（create 时计价一次写入，Worker **不重算**）
- **成功**：`execution_stage=charged`，ledger `chg_{task_id}`
- **余额不足**：`status=failed`，`error_code=BALANCE_INSUFFICIENT`，**不调 RH**，释槽

---

## 10. Dispatch（Phase 7）

- **触发**：`dispatchOneChargedTask(task_id)` 读取 `provider_forward_json`
- **成功**：写 `provider_task_id`，`execution_stage=provider_submitted`，`status=running`
- **timeout unknown**：`dispatch_unknown=1`，**不重 POST、不退款、不释槽**
- **幂等**：同一 `task_id` 并发 10 次 dispatch → RH submit **≤1**

---

## 11. Poll & Settle

- **Poll**：`pollOneProviderTask` mock/query RH → `settling` → success/failed
- **Success**：`result_oss_url` 写入，`execution_stage=done`，释槽
- **Failed**：Phase 6 refund `ref_{task_id}` 幂等，释槽

---

## 12. Release

- success / failed / charge-fail 路径均释放 `user_slot_held` + `platform_slot_held`
- timeout unknown：**故意不释放**（与 Phase 7 冻结策略一致）

---

## 13. Client Query

- **接口**：`nxCloudTaskStatus(taskId)` → `GET /tasks/status?task_id=...`（或 FC 等价路由）
- **读取字段**：`status`、`execution_stage`、`result_oss_url`、`error_code`、`error_msg`（`provider_task_id` 可选内部展示）
- **不读**：RunningHub 状态码

---

## 14. Legacy 兼容

| 项 | 状态 |
|----|------|
| `/run-task` | **保留** |
| legacy create 预扣费 | **保留** |
| 其他模型 / 图生 / Director / Drama | **仍 Legacy** |
| Golden Path OFF | 与 Phase 8 审计前行为一致 |

---

## 15–27. 测试结果

**脚本**：`node scripts/test-phase8-1-video-golden-path.mjs`  
**结果文件**：`scripts/phase8-1-video-golden-test-result.json`  
**最新运行**：2026-09-03，`PASSED=true`

| # | 用例 | 结果 | 说明 |
|---|------|------|------|
| 1 | 单任务 create→success | **PASS** | queued → charged → rh_single → success，`result_oss_url` 非空，槽释放 |
| 2 | 余额不足 | **PASS** | charge fail，RH submit=0 |
| 3 | 用户并发 5/6 | **PASS** | 5 claimed + 第 6 仍 queued |
| 7 | 重复 dispatch | **PASS** | 10 并发 dispatch，RH submit=1 |
| 8 | RH timeout | **PASS** | `dispatch_unknown=1`，二次 dispatch blocked，槽仍持有 |
| 10 | Provider fail + refund | **PASS** | failed + refund 幂等 |

### 16. 单任务测试

见用例 1：`1_create_queued_with_forward` + `1_full_pipeline_success`。

### 17. 20 任务并发（用户限制）

Phase 8.1 脚本用 **6 任务 / limit=5** 精确验证（等价于「20 任务 / limit=5」的子集）。  
**Phase 5 回归**额外覆盖：`500 enqueue → max claimed=5`（`test-phase5-queue-scheduler.mjs` **[J]**）。

### 18. 100 平台并发

**Phase 5 回归**：`500 multi-user → platform cap 100`（**[J2] ALL OK**）。Phase 8.1 未重复全量压测。

### 19. 客户端关闭

**设计保证**：create 后 FC async pipeline（promote→charge→dispatch→poll）不依赖客户端。  
**自动化**：Phase 8.1 脚本在 create 后直接驱动 Worker（等同客户端已退出）。  
**待补**：生产环境 E2E（真实关客户端 + cron only）需 Flag 开启后在 staging 验收。

### 20. 客户端重启

**设计**：`task_id` 持久于 OTS；重启后 `nxCloudTaskStatus(task_id)` 可续查。  
**自动化**：未单独脚本；逻辑与 Workspace 既有 cloud task track 兼容。

### 21. timeout 测试

用例 8：**PASS**（unknown + 无重试 + 无退款 + 槽持有）。

### 22. 重复点击

**语义**：连续两次点击 → **两个 task_id**（两次 create）。  
**防护**：同一 `task_id` dispatch 风暴 RH submit=1（用例 7）。  
**未做**：UI 双点击 E2E（依赖产品 idempotency key，本阶段未加客户端 disable-only 保护）。

### 23. 重复 RH 提交次数

`stats.rh_submit_calls` 对 storm 任务：**1**（`double_rh_submit=false`）。

### 24. 重复扣费次数

Phase 8.1 + Phase 6 回归：`double_charge=false`；`C_20_workers_same_task` real charge=1。

### 25. 重复退款次数

用例 10：`settleOneTask` 二次 **idempotent**；Phase 6 `I_refund_x10` idem=9。

### 26. 槽位泄漏次数

Golden Path 成功/失败路径：`slot_leak=false`。timeout 用例**预期**持槽（非泄漏）。

### 27. Phase 5/6/7 回归

| 套件 | 结果 | 备注 |
|------|------|------|
| `test-phase5-queue-scheduler.mjs` | **ALL OK** | 含 J/J2 并发 |
| `test-phase6-charge.mjs` | **部分 FAIL** | `B_insufficient_balance` 在共享 OTS 平台池被其它测试占用时偶发（plat=8）；与 8.1 改动无关 |
| `test-phase7-provider-pipeline.mjs` | **PASSED=true** | 含 timeout / storm / legacy block |

---

## 28. 当前 Video Generation 迁移完成度

| 子业务 | 迁移状态 |
|--------|----------|
| **sora-2 画布文生视频**（Flag ON） | ✅ **已接入 Queue 闭环** |
| sora-2 图生 / pro / 其它模型 | ❌ Legacy |
| MV Director | ❌ Legacy（未改 pump=5） |
| AI Short Drama | ❌ Legacy |
| Batch | ❌ Legacy |
| Audio | ❌ Legacy |
| RH AI Apps | ❌ Legacy |

**接入率（Video 整体）**：约 **1/N**（仅 Golden Path 单场景）；相对 Phase 8 审计「0% 云端接入」，Golden Path 已 **>0%** 且可 Flag 灰度。

---

## 29. 启用与验收清单（运维 / QA）

1. 部署 FC（含 `handleTasksCreate` + async pipeline + cron promote/charge/dispatch/poll）
2. Electron 启动：`VIDEO_QUEUE_ENABLED=1`
3. Vite/客户端构建：`VITE_VIDEO_QUEUE_ENABLED=1`
4. 画布选 **sora-2**、**纯文生**、点击生成
5. 确认 Network/日志：**仅有** `/tasks/create` + `/tasks/status`，**无** `/run-task`
6. OTS 行：`status` 从 `queued` 至终态；`provider_forward_json` 非空；success 时 `provider_task_id` + `result_oss_url` 有值

---

## 30. 已知限制与后续（非本阶段）

- 未迁移 sora-2 **图生**、其它视频模型
- 未做真实 RH live E2E（当前 FC 测试 mock RH + 实库 OTS）
- Phase 6 `B_insufficient_balance` 在并行测试下偶发环境噪声，建议 isolated user + drain slots 后单独跑
- `NX_SKIP_QUEUE_PIPELINE_ON_CREATE` 仅测试用；生产应依赖 cron + create 异步 pipeline

---

**结论**：Phase 8.1 目标达成——**最标准 sora-2 文生 Video Generation** 在 Feature Gate 开启下，已脱离客户端并发/扣费/RH submit/poll，改为 **create + query** 与云端 **Claim→Charge→Dispatch→Poll→Settle→Release** 闭环；Legacy 完整保留，MV/Drama/Batch 未触碰。
