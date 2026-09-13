# PHASE7_DESIGN_REVIEW.md

**阶段**：Phase 7 设计审计（只读 · 不改代码 · 不调 RunningHub · 不建表）  
**基线**：Phase 5 / Phase 6 正式冻结  
**入口停点**：`status=claimed` + `execution_stage=charged`  
**最终结论**：**READY FOR IMPLEMENTATION**（附 Provider API 能力缺口与强制保守策略）

---

## 0. 一句话结论

现网 Provider 路径是 **客户端驱动的 FC `run-task` 同步转发 + 客户端轮询 `/query`**，与 Phase 5/6 云端队列（queued→claimed→charged）**尚未打通**。  
Phase 7 必须新增 **云端 Dispatch / Poll / Settle / Recovery Worker**，把 RH 调用从客户端迁到 `charged` 之后；并在 **RunningHub 无提交幂等键** 的前提下，用本地 **dispatch lease + provider_task_id SoT + UNKNOWN 禁盲重试/禁盲退** 保证崩溃一致。

---

## 1. 当前 Provider 调用链（审计）

### 1.1 主路径（图 / 音 / 视）

```text
Electron Renderer / Director
  → Main AICore / ImageProvider | VideoProvider | AudioProvider | runningHubAiAppFc
    → POST /tasks/create          （多数：legacy 预扣费 → pending；可选 execution_mode=queue）
    → POST /run-task
         body.forward = { provider:'runninghub', path, method, body, ... }
         billing = 'charge' | 'none'（prepaidLedgerTaskId 时）
      → index.mjs handleRunTask / handleGenericForwardTask
        → pickRunningHubTarget + fetch(RH OpenAPI)
        → 可选 upsertTask(running/success/failed)
    → 客户端继续 run-task billing=none + path=/query 轮询
```

| 文件 | 函数 / 入口 | 调用方 | 当前状态变化 |
|------|-------------|--------|--------------|
| `src/main/ai-provider.js` | `runTaskViaFc` → `/run-task` | Provider 层 | 无本地状态机 |
| `src/main/utils/fcForwardTask.ts` | FC forward 封装 | RH helpers | 同上 |
| `src/main/utils/runningHubFcHelpers.ts` | `rhPostChargeVideo/Audio`、unwrap、extract taskId | Video/Audio/Image | 客户端持有 RH taskId |
| `src/main/ai/providers/ImageProvider.ts` | `rhPostCharge`、`/tasks/create` 预扣 + `billing=none` | AICore | create 失败会 **回退 run-task 内扣费** |
| `src/main/ai/providers/VideoProvider.ts` | 同上模式 | AICore | 同上 |
| `src/main/ai/providers/AudioProvider.ts` | 同上模式 | AICore | 同上 |
| `src/main/services/runningHubAiAppFc.ts` | AI App 经 FC | 插件/工作流 | 经 run-task |
| `demo/.../index.mjs` | `handleGenericForwardTask` | `/run-task` | 见 §2 |
| `demo/.../lib/runningHubTarget.mjs` | `pickRunningHubTarget`、`persistRhTaskRegion`、`isRhQueryPath` | forward | cn/ai 分流；`rhreg:{rhTaskId}` 粘性 |

### 1.2 LLM / 其它

| 文件 | 说明 |
|------|------|
| `handleLlmTask`（index.mjs） | BLTCY / RH LLM；扣费 + upsertTask；**非** Phase 5/6 队列 |
| `lib/llmUpstream.mjs` | RH LLM base `llm.runninghub.ai` |
| ASR / VIAPI | 独立扣费 taskId；不经 queued→claimed→charged |

### 1.3 查询 / 轮询 / 回调

| 能力 | 现状 |
|------|------|
| RH 状态查询 | 客户端经 FC `forward.path=/query`（`isRhQueryPath`）；**无 webhook 消费闭环** |
| 超时结算 | `/internal/settle-stale-tasks`：对 RUNNING/PROCESSING 等 **legacy 超时退款**（`refundConsumedTask`） |
| Phase 6 charge cron | `/internal/charge-claimed-tasks`：只到 charged |
| Phase 5 promote | `/internal/promote-queued-tasks`：只到 claimed |

**无**「charged → 云端主动 dispatch RH」的 Worker。

---

## 2. 当前 RunningHub 调用入口（FC 内）

**中心函数**：`handleGenericForwardTask`（`index.mjs` / `app/app.mjs`）

| 模式 | 行为 | 状态写入 |
|------|------|----------|
| `billing=charge` | `deductWithTransaction` → upsert `running` → `forwardOnce()` → success/failed + 失败 `refundWithLedger` | **同步占用请求生命周期**；非 Phase 6 Money SoT |
| `billing=none` | 若 OTS 已有 task 行：先标 running → forward；提交响应含 RH taskId 则保持 running；成功 URL 则 success | **常不写 `provider_task_id` 字段**（仅从响应推断） |
| `/query` 且无 OTS 行 | 纯转发，不写 tasks | 客户端临时轮询 id |

辅助：

- `FORWARD_TIMEOUT_MS`（默认 300s）Abort  
- 提交成功：`persistRhTaskRegion(userId, rhTaskId, region)`  
- 上传：`uploadFromUrl` / multipart base64  

**Phase 7 应复用** `forwardOnce` / `pickRunningHubTarget` / query 解析，**不要**让客户端再走 `billing=charge` 同步提交作为主路径。

---

## 3. 当前任务状态链

### 3.1 正式机（Phase 5/6）

```text
queued → claimed → (execution_stage: awaiting_charge → charged) → [Phase7] running → success|failed|cancelled
```

Phase 5：queued→claimed + slots  
Phase 6：charged，**不释槽**，不调 RH  

### 3.2 Legacy（仍存活）

```text
/tasks/create legacy → pending（已扣费）
/run-task charge → running → success|failed（同步）
processing 别名 → 对外常映射 running
```

### 3.3 `nx_tasks` 已有相关字段

已存在且 Phase 7 **优先复用**：

- `provider_task_id`  
- `status` / `execution_stage` / `error_code` / `error_msg` / `result_oss_url`  
- `lease_owner` / `lease_expires_at` / `claim_token` / `reservation_id`  
- `user_slot_held` / `platform_slot_held`  
- `quoted_cost` / `cost` / `amount` / `charge_id`  

**缺口**：现网 forward 成功路径 **未稳定写入 `provider_task_id`**；Phase 7 必须把它作为 **Provider 绑定 SoT**。

---

## 4. 当前 MV Director 调用链（绕过审计）

| 点 | 现状 | 风险 |
|----|------|------|
| `DIRECTOR_MV_VIDEO_BATCH_SIZE = NEXFLOW_MAX_TASK_CONCURRENCY`（**5**） | 客户端本地 pump 并发 | 与云端 user/platform CAS **双轨**；未走 queued→claimed→charged |
| `AICore.maxConcurrentTasks = 5` | 全局 ai:invoke 队列 | 同上 |
| `DirectorNode` / `Workspace` / `DramaStudioHost` | 调 Provider → `/tasks/create` + `/run-task` | **客户端决定何时 RH** |
| `uploadImageToRunningHub` | 主进程上传（经 FC） | 旁路于任务状态机，但是媒体准备 |
| `resumeRunningHub*Poll` | 崩溃后客户端恢复 RH 轮询 | Provider 生命周期在客户端 |

**发现的问题（本轮不改）**

```text
问题：客户端仍可直接触发 Provider（run-task forward），绕过 charged→云端 scheduler
文件：ImageProvider / VideoProvider / AudioProvider / AICore / directorVideoBatch / Workspace
调用链：Director 生成 → Provider → /tasks/create(legacy) → /run-task → RH
风险：双扣费路径、本地 5 并发与云端 100 池不一致、无云端 dispatch 幂等
Phase 7 建议：Provider 改为「只 create queue 任务 + 轮询 /tasks/status」；禁止对已 charged 任务再 billing=charge forward；迁移期保留 legacy 开关
```

---

## 5. Phase 7 推荐状态机

### 5.1 AIXFLOW `status`（保持既有枚举）

```text
claimed + charged
  → running          # 仅当已拿到或已安全绑定 Provider 执行意图且允许 poll
  → success | failed | cancelled
```

**禁止** Phase 7 再次引入与 Phase 5 冲突的转移；`queued↛running` 保持。

### 5.2 `execution_stage`（最小集合）

| stage | 目的 | 崩溃恢复依据 |
|-------|------|----------------|
| `charged` | Phase 6 完成；可被 Dispatch 选中 | charge Money SoT + charge 行 |
| `dispatching` | 已抢到 **dispatch lease**，可能正在/刚完成 RH 提交 | lease + 是否已有 `provider_task_id` |
| `provider_submitted` | **已确认** RH task 存在（已写 `provider_task_id`） | `provider_task_id` 非空 |
| `settling` | Provider 已终态，正在写结果 / refund / release | provider 查询结果 + refund receipt + slot flags |
| `done` | 本地结算完成（success/failed 已稳定） | terminal status + slots 已清 |

**不需要**单独的 `provider_running` / `refunding` / `released` 作为必选 stage：

- Provider 运行中：用 `status=running` + `provider_task_id` + 可选 `provider_status` 缓存即可  
- refund：Phase 6 `rr_*` 已是幂等 SoT  
- release：`user_slot_held`/`platform_slot_held` + 计数器即可判断是否已释  

### 5.3 推荐主路径

```text
charged
  → (lease) dispatching
  → RH submit OK → 写 provider_task_id → provider_submitted → status=running
  → poll → SUCCESS → settling → status=success → release → done
  → poll → FAILED  → settling → refund(ref_*) → status=failed → release → done
```

---

## 6. Provider 状态 ↔ AIXFLOW 映射

| RH（典型） | AIXFLOW |
|------------|---------|
| （无 id） | 保持 `claimed+charged` 或 `dispatching`（UNKNOWN 提交） |
| QUEUED / CREATE / RUNNING | `running` + stage `provider_submitted` |
| SUCCESS | → `settling` → `success` |
| FAILED / CANCEL | → `settling` → `failed`（+ refund 规则） |
| 查询失败/超时 | **不改终态**；记 `provider_last_checked_at`；保持 running |

**禁止**把 RH 字符串直接写入 `status`。

---

## 7. Provider Dispatch 幂等方案（最高优先级）

### 7.1 Provider API 能力缺口（已查公开文档）

RunningHub OpenAPI 提交（`/task/openapi/...`、`ai-app/run` 等）返回平台生成的 `taskId`；**未发现**可用的：

- idempotency key  
- client/external task id 反查「是否已为某 AIXFLOW task 创建过」  

→ 标注为：**Provider API 能力限制**。

### 7.2 本地强制协议

```text
operation 维度：每个 AIXFLOW task_id 至多一次「有效 submit」

1) CAS 抢 dispatch lease（见 §14）
2) 若 provider_task_id 已存在 → 禁止再 POST submit；只 poll
3) 若无 provider_task_id：
     - 允许一次 submit
     - 成功：同一次逻辑事务内尽快 updateRow 写入 provider_task_id（条件：仍为空）
4) submit HTTP timeout / 未知：
     - 进入 DISPATCH_UNKNOWN
     - 禁止第二次 submit
     - 禁止 refund
     - 人工/超时策略：延长 lease，依赖运维或未来 RH 能力；可选「用户取消」走明确 failed+政策
```

**`provider_task_id` 非空 = Provider 绑定 SoT（类似 Phase 6 receipt）。**

### 7.3 为何不能「timeout 再 POST」

RH 可能已创建任务；二次 POST → **双 Provider 任务**（双计费上游 + 双资源）。本地无法用 RH API 去重。

---

## 8. Provider timeout 方案

| 超时点 | 动作 |
|--------|------|
| Submit timeout | DISPATCH_UNKNOWN；不重 POST；不退款；保持持槽；告警 |
| Poll timeout | 重试 poll；不改终态 |
| 总墙钟超时（可配） | 查 RH 最后一次；仍 UNKNOWN → 不自动 success/refund；可转 `failed` **仅当**产品定义「超时失败且确认无结果」且政策允许（默认：**仍不盲退**） |

---

## 9. `provider_task_id` 方案

| 项 | 设计 |
|----|------|
| 字段 | **复用** `nx_tasks.provider_task_id` |
| 何时写 | RH submit 响应解析成功后，**在标 running 之前或同时** |
| 谁写 | Dispatch Worker（云端） |
| 写入失败 | task 仍 dispatching/charged；recovery 见响应缓存？若响应已丢且无 id → UNKNOWN（最坏）→ **实施时必须：先写 id 再结束请求**；可用「先写 pending_provider_payload」降险（见字段） |
| 重复写 | 条件更新：仅当空 → 新值；已有值冲突 → 保留原值并告警 |
| recovery | 非空 ⇒ 只 poll |

建议可选字段（恢复意义明确）：

- `dispatch_lease_owner` / `dispatch_lease_expires_at` / `dispatch_attempt`  
- `provider_status` / `provider_last_checked_at` / `provider_error`  
- `dispatch_unknown_at`（标记禁止重提交）

---

## 10. Crash Recovery（A–J）

| # | 场景 | 恢复 |
|---|------|------|
| A | charged，未调 RH，FC 崩 | 重新被 Dispatch 选中；lease 过期后他人可抢 |
| B | RH 已创建，HTTP timeout | **无 id** → UNKNOWN，禁重提交/禁退；有 id（若 RH 在超时前返回但未落盘）→ 实施必须缩小该窗：先持久化 id |
| C | 有返回 id，写库前崩 | 同 B 最坏；缓解：单行 update 优先写 `provider_task_id` |
| D | RH 明确创建失败 | 未写 id；可 `failed` + **refund(`ref_*`)** + release |
| E | RH 成功，写 running 失败 | id 已在则 poll Worker 可把 status 补成 running |
| F | Provider success，写 success 失败 | poll 再见 SUCCESS → settling → success → release |
| G | Provider failed，写 failed 失败 | 再 settle；refund 幂等 |
| H | refund 已执行，worker 崩 | `rr_*` APPLIED → 跳过退款，只补 failed/release |
| I | success，release 失败 | settlement recovery：held 标志仍 1 → 再调现有 release（须幂等；计数器用现有 CAS） |
| J | failed+refund 成功，release 失败 | 同 I |

**成功但本地失败（§十四）**：最终靠 poll 的 SUCCESS + settling 幂等写 success + release；**不 refund**。

---

## 11. Refund 方案（严格 Phase 6）

```text
refund_operation_id = ref_{task_id}
Money SoT = rr_{opHash}
```

| 可退 | 不可盲退 | 绝对不退 |
|------|----------|----------|
| RH **明确**未创建 / 提交 API **明确失败**（无 task） | Submit timeout、DISPATCH_UNKNOWN、poll unknown | Provider **SUCCESS** |
| RH **明确 FAILED**（且业务约定失败退款） | 无法确认是否已创建 | |

重复 refund × N = 只加一次余额（已验收）。

---

## 12. Slot Release 方案

- **只调用** Phase 5：`releaseUserConcurrencySlot` / `releasePlatformConcurrencySlot` / reservation 更新  
- **不改** CAS 核心  
- 时机：settling 末尾，terminal 写入后  
- 幂等：先条件清 `user_slot_held`/`platform_slot_held`（claimed/running→终态时），仅当标志为 held 才 release 计数器（与 lease recover 同思路）  
- charge **不** release（Phase 6 已定）

---

## 13. Scheduler / Worker 方案（FC + OTS · 无 Redis）

| Worker | 扫描 | 批量 | Lease | 防重 | 崩溃 |
|--------|------|------|-------|------|------|
| **Dispatch** | `claimed`+`charged`，无 `provider_task_id`，非 UNKNOWN | 小（如 5–20） | dispatch lease 30–120s | CAS lease；有 id 跳过 | lease 过期重抢 |
| **Poll** | `running` 或 `provider_submitted`，有 id | 20–50 | 可选 check lease | 只读 RH + 条件写终态 | 重入安全 |
| **Settle** | stage=`settling` 或终态未 release | 20 | 短 | refund/release 幂等 | 重入 |
| **Recovery** | lease 过期、UNKNOWN 超时告警、held 与 status 不一致 | 低频 | — | 只修复，不盲 submit | — |

触发：`/internal/dispatch-charged-tasks`、`/internal/poll-provider-tasks`、`/internal/settle-terminal-tasks`、`/internal/recover-provider-tasks`（均 ADMIN_SETTLE_SECRET）；可与现有 promote/charge cron 并列。

抢任务：OTS 条件更新 `dispatch_lease_owner/expires`（同类 Phase 5 claim lease），**不要**用 Redis。

---

## 14. Dispatch Lease 方案

复用任务行字段（新增列，不改 Phase 5 claim lease 语义）：

```text
dispatch_lease_owner
dispatch_lease_expires_at
dispatch_attempt
```

规则：

- 仅 `execution_stage=charged`（或 dispatching 且 lease 过期）可抢  
- 持锁期间才允许 submit  
- 写入 `provider_task_id` 后进入 submitted，lease 可释放或转 poll  
- 两 FC 同时抢：条件失败方退出  

**不要**与 Phase 5 `lease_owner`（claim）混用同一字段，以免 lease recover 把 charged 任务踢回 queued。

---

## 15. 新增字段（建议）

| 字段 | 必要？ | 恢复意义 |
|------|--------|----------|
| `dispatch_lease_owner` | 是 | 防双 dispatch |
| `dispatch_lease_expires_at` | 是 | 崩后重抢 |
| `dispatch_attempt` | 建议 | 观测/限次 |
| `provider_status` | 建议 | 减少重复解析 |
| `provider_last_checked_at` | 建议 | poll 调度 |
| `provider_error` | 建议 | 失败原因 |
| `dispatch_unknown` (0/1) | **是** | 禁重提交开关 |

不新增第二套 Money 字段。

---

## 16. 新增表

**默认不需要新表。**  
`nx_tasks` + `nx_task_charges` + 三并发表足够。

仅当要做「DISPATCH_UNKNOWN 人工工单」时可后加 `nx_provider_incidents`（非 MVP）。

---

## 17. 新增 Endpoint（设计）

```text
POST /internal/dispatch-charged-tasks
POST /internal/poll-provider-tasks
POST /internal/settle-terminal-tasks
POST /internal/recover-provider-tasks
```

客户端：

```text
POST /tasks/create execution_mode=queue
POST /tasks/status | GET 列表
（过渡期保留 run-task，但 charged 任务禁止客户端再 submit）
```

---

## 18. 需要修改的文件（实施阶段，本轮不动）

| 区域 | 文件 |
|------|------|
| FC 新模块 | `lib/providerDispatch.mjs`、`lib/providerPoll.mjs`、`lib/providerSettle.mjs` |
| FC 入口 | `index.mjs` internal 路由；复用 `runningHubTarget` / forward 内核 |
| DB | `db-tablestore.mjs`：dispatch lease CAS、写 `provider_task_id`、list charged |
| 客户端（后期 PR） | Image/Video/AudioProvider、AICore、Director：改为 queue+status |
| 测试 | `scripts/test-phase7-*.mjs` |

---

## 19. 明确禁止修改

```text
Phase 2 状态机核心转移表（除非仅注释）
Phase 3 权益解析语义
Phase 4/5 CAS 实现与三表语义
Phase 5 reservation/lease/reconcile 算法
Phase 6 Money SoT（dr_*/rr_*）、原子扣款、refund_operation_id、quoted_cost
本轮：MV Director / 生产 RunningHub 调用 / 建表
```

---

## 20. 完整测试矩阵（设计）

### Dispatch

- 单任务；20 worker 同 task；100 charged  
- lease 冲突；FC crash；submit timeout；禁二次 POST  

### Provider

- 创建成功/失败；HTTP timeout；query 成功/失败/unknown；SUCCESS/FAILED  

### Crash

- 每个写点后杀进程（lease、id、running、success、failed、refund、release）  

### Refund / Release

- ×1 / ×10；crash；timeout  

### 终态一致性

```text
charged → provider → terminal → refund? → user occupied 正确 → platform running 正确
无重复 RH 任务（在可观测范围内）
无双扣/双退/负余额/slot leak
```

---

## 21. 风险清单

| 风险 | 等级 | 缓解 |
|------|------|------|
| RH 无提交幂等 → timeout 双创建 | **P0** | UNKNOWN + 禁重试；缩小「有响应未落盘」窗口 |
| 客户端仍 run-task 旁路 | P0（迁移） | 分阶段关掉；双写检测 |
| legacy 与 Phase6 双扣费 | P0 | charged 任务禁 `billing=charge` |
| `provider_task_id` 现网未稳定写入 | P1 | Phase7 强制写 |
| receipt 列膨胀 | P2 | 已记录；不改 SoT |
| settle-stale 与新路径冲突 | P1 | 范围排除 queue 管线或统一 settle |

---

## 22. Phase 7 实施顺序（建议）

1. DB：dispatch 字段 + list charged + lease CAS  
2. Dispatch Worker（可先 dry-run / feature flag）  
3. 强制写 `provider_task_id` + Poll Worker  
4. Settle：success/failed + refund + release  
5. Recovery + UNKNOWN 告警  
6. 回归 Phase 2–6  
7. 客户端改 queue-only（**独立 PR，可后置**）  
8. 冻结 Phase 7  

**不要**在 Worker 未就绪前切断客户端 run-task。

---

## 23. Provider API 能力缺口

```text
缺口：RunningHub 公开提交 API 无可靠 idempotency / 外部 task 反查
影响：submit timeout 无法 100% 自动分辨「未创建 vs 已创建」
对策：本地 provider_task_id SoT + DISPATCH_UNKNOWN 禁盲重试禁盲退
结论：不阻塞开始实施，但阻塞「timeout 自动二次提交」与「timeout 自动退款」类需求
```

---

## 24. 最终结论

```text
READY FOR IMPLEMENTATION
```

**条件性要求（写入实施纪律）：**

1. 不得在无 `provider_task_id` 且 `dispatch_unknown=1` 时再次 POST RH submit  
2. 不得对 UNKNOWN 自动 refund  
3. 不得修改 Phase 5/6 核心  
4. 客户端旁路迁移可并行，但不作为 Dispatch MVP 的阻塞；MVP 先打通 **charged→云端 RH→terminal→release**  
5. 本轮审计 **未改任何代码**

---

*Phase 7 Design Review · 2026-09-03 · audit-only*
