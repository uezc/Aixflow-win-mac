# PHASE8_1_VIDEO_GOLDEN_PATH_LIVE_E2E_REPORT.md

**阶段**：Phase 8.1 · Staging / Live E2E 验收  
**最后更新**：2026-09-05（charge `task_id` 解析修复 + Live 重跑）  
**结论**：**PHASE 8.1 = NOT_READY**（F 仍失败；**G 未执行**）

---

## 0. 本轮授权范围

仅修复：

```text
FC charge-claimed-tasks 扫描 → task_id 被解析成字面量 "task_id"
```

未改 Phase 5/6 扣费语义 / Phase 7 RH 流程 / 定价 / Canvas / Legacy / 状态机。

---

## 1. 根因定位（修复前）

OTS `getRange` 主键常见形态：

```text
primaryKey: [{ name: 'task_id', value: '<uuid>' }]
```

`runChargeClaimedTasks` 旧逻辑：

```js
pk[0].task_id ?? Object.values(pk[0])[0]
```

在 `{ name, value }` 下 `Object.values(pk[0])[0] === "task_id"`（列名），导致：

```text
candidates → "task_id"
→ getTaskById("task_id") → TASK_NOT_FOUND
→ 永不 charge / dispatch / RH
```

同文件其它扫描路径（`listQueuedTasksForPromote` / `scanTasksMatching`）已正确使用 `taskIdFromTaskRow`。

---

## 2. 代码修复（仅解析）

| 文件 | 变更 |
|------|------|
| `lib/db-tablestore.mjs` | `runChargeClaimedTasks` 改用 `taskIdFromTaskRow`；导出并注释该 helper |
| `app/lib/db-tablestore.mjs` | 同上同步 |

新增回归：`scripts/test-charge-scan-task-id.mjs`

- 证明 `[{name:'task_id',value:UUID}]` → 真实 UUID，且 `!== "task_id"`
- 证明旧 buggy 逻辑仍复现字面量 `"task_id"`
- OTS：写入 claimed 任务后 `runChargeClaimedTasks` 结果含真实 UUID

---

## 3. 部署前回归

| 套件 | 结果 |
|------|------|
| `test-charge-scan-task-id.mjs` | **PASS** |
| Phase 5 `test-phase5-queue-scheduler.mjs` | **PASS** |
| Phase 6 `test-phase6-charge.mjs` | **PASS** |
| Phase 7 `test-phase7-provider-pipeline.mjs` | **PASS** |
| Phase 8.1 mock `test-phase8-1-video-golden-path.mjs` | **PASS** |

---

## 4. FC 部署

- 打包：`npm run deploy` → `nexflow-fc.zip`
- 上传：`upload-fc-code.mjs` → **cn-hongkong/nexflow-api** + cn-beijing/aixflow-api（2026-09-05T02:35:36Z）
- 探活：promote/charge/dispatch/poll = **200**
- 部署后 charge 响应：**无** `task_id: "task_id"` / 字面量 `TASK_NOT_FOUND`

---

## A–G 矩阵

| 项 | 状态 | 说明 |
|----|------|------|
| **A Mock** | **PASS** | |
| **B Code Review** | **PASS** | 仅 task_id 解析 |
| **C FC Deployment** | **PASS** | HK 已更新 |
| **D OTS** | **PASS** | sora-2 定价仍在；`getFinalPrice=15` |
| **E RH Connectivity** | **REACHED / FAIL** | FC 已真实 submit；响应无可用 taskId |
| **F Real Live E2E** | **FAIL** | 见下 |
| **G Canvas Network** | **NOT_RUN** | F ≠ PASS |

---

## F：本轮 Live E2E（prefix `__p81live_mtnrvc1e_`）

**命令**：`node scripts/live-phase8-1-video-golden-path.mjs`  
**Raw**：`scripts/phase8-1-video-golden-live-e2e-result.json`

### 主链路任务

| 字段 | 值 |
|------|-----|
| **task_id** | `164a3fb2-3381-43a0-ba80-b1a8a84abc31` |
| **model_id / billing SKU** | `sora-2` |
| **quoted_cost** | 15 |
| **create** | HTTP 200 → queued |
| **claim** | claimed（user_occ=1, plat=1） |
| **charge** | **成功**（ledger consume **-15**；`task_charges.status=refunded`） |
| **dispatch_attempt** | **1** |
| **provider_task_id** | **空** |
| **error_code** | **`PROVIDER_NO_TASK_ID`** |
| **error_msg** | `PROVIDER_NO_TASK_ID` |
| **RunningHub** | HTTP 层被判定 `submit.ok` 但 **未解析出 taskId** → 明确失败路径退款 |
| **refund** | **+15**（余额回到 **2000**） |
| **最终 status / stage** | `failed` / `done` |
| **user slot / platform slot** | **已释放**（u=false, p=false；user_occ=0） |

### 扣费验证（该 task）

```text
consume -15 → refund +15 → balance 2000
扣费次数 = 1（非 0 / 非 30 / 非双扣）
无负余额
```

### 解析修复是否生效？

**是。** 上一轮卡在 claimed + 永不 charge；本轮已：

```text
claim → charge(15) → dispatch(1) → PROVIDER_NO_TASK_ID → refund → terminal failed
```

说明 **字面量 `task_id` 阻断已解除**。当前阻断变为 **真实 RH submit 响应无 provider_task_id**。

### 矩阵其它项

| 场景 | 结果 |
|------|------|
| insufficient_balance | **PASS** |
| concurrency 5/6 + 6th after release | **PASS** |
| dispatch storm RH=1（local mock） | **PASS** |
| timeout dispatch_unknown（模拟） | **PASS** |
| provider_failure_refund（模拟） | **FAIL**（退款金额正确 1985→2000，但 `platform_video_running=12` 被并发测试残留抬高） |

---

## 旧任务 `893b137d-77e3-4024-b35f-6207cf8977fa`

| 字段 | 当前 |
|------|------|
| status | `queued`（与 stage 不一致的历史残留） |
| execution_stage | `charged` |
| provider_task_id | 空 |
| slots | **未占用**（u/p false） |
| 对应用户 occ | 0 |

**未强行改库。** 不永久占并发槽；建议后续用现有 reconcile/运营工具处理「queued+charged」脏状态，本轮不手工 delete。

---

## 最终结论

```text
PHASE 8.1 = NOT_READY
F = FAIL
G = NOT_RUN
```

### 已解决

```text
charge-claimed-tasks 扫描 task_id = "task_id" → TASK_NOT_FOUND
```

### 当前阻断（新）

```text
真实 RunningHub submit → PROVIDER_NO_TASK_ID
（charge/refund/slot 行为符合 Phase6/7 明确失败策略；未进入 poll/success）
```

### 下一步（需另行授权）

1. 查清 RH `/rhart-video-s/text-to-video` 真实响应体为何无 taskId（鉴权区域、body 字段、海外端点等）——**不要猜，不要为过测试改状态机**  
2. 修复后重跑 Live；仅 F=PASS 后再做 G  
3. **不要进入 Phase 8.2**
