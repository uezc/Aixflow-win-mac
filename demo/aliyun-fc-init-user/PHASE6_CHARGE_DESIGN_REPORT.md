# Phase 6 Charge Design Report

**状态**：设计待确认（本报告通过前不改业务代码）  
**基线**：Phase 5 Freeze（2026-09-03）只读  
**目标**：`claimed (+ awaiting_charge) → 幂等扣元宝 → claimed + execution_stage=charged`  
**禁止**：写 `running`、调用 RunningHub、修改 Phase 5 并发 CAS / claim 顺序 / 冻结表语义

---

## 1. 当前账务系统结构（阅读结论）

### 1.1 核心表

| 表 | 作用 |
|----|------|
| `nx_users` | `balance`（INTEGER 元宝） |
| `nx_transactions` | 流水账本；PK=`transaction_id`（可 env 覆盖）；GSI `idx_user_id` |
| `nx_tasks` | 任务；已有 `quoted_cost`、`cost`/`amount`、slot/lease 字段；**无** `execution_stage` |

### 1.2 已有扣费 API（`lib/db-tablestore.mjs`）

| 函数 | 行为 | 幂等键 |
|------|------|--------|
| `deductWithTransaction(userId, taskId, amount, meta)` | 写 `consume_pending` → put 用户余额 → 升格 `consume` | `idemTxId = idem_sha256(userId\|taskId)` |
| `refundWithLedger(userId, taskId, amount, meta)` | 加余额 + 写 `REFUND` 流水 | `refund_{idemTxId}` |
| `refundConsumedTask(userId, taskId, meta)` | 仅当存在 `type=consume` 且无 refund 行时退款 | 同上 |

`idemTxId`：

```text
idem_${sha256(`${userId}|${taskId}`)}
```

### 1.3 Legacy 调用点（保持不动）

- `handleTasksCreate` + `execution_mode=legacy`：create 时 `deductWithTransaction` → `status=pending`
- `index.mjs`：LLM / forward / ASR / VIAPI 等路径同样预扣 + 失败 `refundWithLedger`
- `/internal/admin-refund-task`、`refundConsumedTask`

Phase 6 **不**把 legacy 迁入新管线。

### 1.4 现网扣费的已知缺口（必须在 Phase 6 正视）

| 问题 | 现网 `deductWithTransaction` | Phase 6 要求 |
|------|------------------------------|--------------|
| 同 task 幂等 | `EXPECT_NOT_EXIST` 抢 `idem_*` 行，基本可用 | 必须 |
| 余额原子性 | **先读 balance，再无条件 put 新余额** | **禁止**；须 CAS / 等价原子 |
| 双 task 抢余额 | 可能双成功 → 透支 | 必须一成一败、余额非负 |
| Crash：`consume_pending` 已写、余额未改 | 他端见 pending 直接 `idempotent:true`，可能**误判已扣** | 须可查询、可恢复、不重复扣 |
| Crash：余额已改、task 未标 charged | 无 task 级 stage | 须以 charge/ledger 为 SoT 补齐 stage |
| 查后再扣 | GetRow 仅加速路径，真实锁靠 put 条件；但仍非余额 CAS | 余额侧必须条件更新 |

**结论**：Phase 6 **复用账本表与 idem 键约定**，但 **不能把现网 `deductWithTransaction` 原样当作唯一实现** 来满足「余额原子 + crash 可恢复」。应新增 Phase 6 专用原子扣费路径；legacy 函数保持原样以免破坏 Phase 2–5 / 现网 Provider。

### 1.5 Phase 5 claim 与扣费的关系

- `execution_mode=queue`：create 只写 `quoted_cost`，`cost/amount=0`，**不扣费**
- `atomicClaimQueuedTask`：只写 `claimed` + slots/lease；**不写** `execution_stage`、不扣费
- Freeze：**不改** claim 顺序与 CAS

---

## 2. 可以复用什么

1. **`quoted_cost`**：create 阶段锁定金额；Phase 6 只读，不重算价。  
2. **`idemTxId(userId, taskId)`**：继续作为 `nx_transactions` 扣费 PK，便于复用 `refundConsumedTask`。  
3. **流水类型约定**：`consume` / `REFUND`（及过渡 `consume_pending`）；refund 键 `refund_{idemTxId}`。  
4. **槽位释放 API（只调用，不改语义）**：  
   `releaseUserConcurrencySlot` / `releasePlatformConcurrencySlot` / `updateSlotReservation`  
5. **状态机已允许**：`claimed → failed|cancelled`（余额不足失败无需改 `taskStatusMachine` 转移表）。  
6. **OTS 条件更新模式**：与 Phase 5 平台/用户 CAS 同风格的 `SingleColumnCondition` + `INCREMENT`。  
7. **Promote/Reconcile 入口模式**：新增独立 `/internal/charge-claimed-tasks`，不塞进 `queueScheduler` 核心。

---

## 3. 新增什么

| 项 | 说明 |
|----|------|
| 表 `nx_task_charges` | 每 task 至多一行有效 charge（PK=`task_id`） |
| 字段 `nx_tasks.execution_stage` | 字符串；Phase 6 用 `awaiting_charge` / `charged` / `done`（失败可 `error`） |
| 字段 `nx_tasks.charge_id` / `charged_at`（可选） | 便于观测；`charge_id` 可等于 `task_id` |
| 模块 `lib/taskCharge.mjs`（新） | 编排：前置校验 → 抢 charge 行 → 原子扣余额 → 写 ledger → 标 stage；refund；recovery |
| DB 原语（`db-tablestore.mjs` 增量） | `putTaskCharge` / `tryBeginTaskCharge` / `deductBalanceCas` / `finalizeTaskCharge` / `refundTaskCharge` / `recoverTaskCharge` |
| HTTP/cron | `/internal/charge-claimed-tasks`（SECRET）；可选 create 后异步 charge（与 promote 并列，不改 Phase 5 scheduler） |
| 测试 | `scripts/test-phase6-charge.mjs`（A–I + crash） |
| 日志事件 | `PHASE6_CHARGE_*` / `PHASE6_REFUND_*` / `PHASE6_CHARGE_RECOVERY` |

**明确不新增**：钱包第二套余额、RunningHub 调用、`running` 写入、对 Phase 5 冻结模块的重构。

---

## 4. OTS 表结构

### 4.1 新建 `nx_task_charges`（仅 HK）

| 列 | 类型 | 说明 |
|----|------|------|
| **PK `task_id`** | STRING | **幂等主键**：一 task 一行 |
| `charge_id` | STRING | 默认 = `task_id`（或 UUID，但唯一性靠 PK） |
| `user_id` | STRING | |
| `amount` | INTEGER | = `quoted_cost` |
| `status` | STRING | `pending` \| `charged` \| `failed` \| `refunded` |
| `ledger_tx_id` | STRING | = `idemTxId(userId, taskId)` |
| `error_code` | STRING | 如 `BALANCE_INSUFFICIENT` |
| `created_at` / `charged_at` / `refunded_at` / `updated_at` | INTEGER ms | |

状态机：

```text
(absent) --EXPECT_NOT_EXIST--> pending
pending --> charged
pending --> failed          # 确定未扣费时可标失败（或删行允许重试，见 §7）
charged --> refunded        # 至多一次
```

### 4.2 `nx_tasks` 增量属性（无表结构迁移也可动态加列）

| 列 | Phase 6 用法 |
|----|----------------|
| `execution_stage` | `awaiting_charge` → `charged`；失败 → `done`/`error` |
| `charge_id` | 可选镜像 |
| `charged_at` | 可选 |
| `cost` / `amount` | charge 成功后回填为实际扣费额（与 legacy 字段对齐） |

### 4.3 不改动的 Phase 5 表

`nx_queue_counters` / `nx_user_concurrency_counters` / `nx_slot_reservations` — **只读/只调用释放**。

---

## 5. 原子扣费方案

### 5.1 新增 `deductBalanceCas(userId, amount)`

```text
条件：nx_users.balance >= amount   (GREATER_EQUAL)
操作：INCREMENT balance = -amount
       PUT updated_at
```

- 条件失败 → `BALANCE_INSUFFICIENT`（确定未扣）  
- 成功后读回 balance（或返回 expected）  
- **禁止** read → JS 判断 → 普通 put 全量覆盖

`amount === 0`：跳过余额 CAS，视为成功（免费任务）；仍写 charge 记录以保证幂等。

### 5.2 与 ledger 的组合顺序（推荐）

```text
① tryBeginTaskCharge(task_id)     # PK EXPECT_NOT_EXIST → status=pending
② put ledger consume_pending      # idemTxId EXPECT_NOT_EXIST（与 ① 双保险）
③ deductBalanceCas                # 原子扣余额
④ ledger → type=consume + balance_after
⑤ charge.status = charged + charged_at
⑥ task: execution_stage=charged, cost=amount（条件 status=claimed）
```

任一步失败的处理见 §7 / §8。

### 5.3 为何不直接改 `deductWithTransaction`

- Legacy 全网依赖其行为与错误字符串；原地改 CAS 风险高。  
- Phase 6 需要与 `nx_task_charges`、stage、slot 释放强绑定。  
- 实施时：**新函数供 Phase 6**；`deductWithTransaction` 保持兼容（可选后续单独 hardening，不在本 Phase 范围）。

---

## 6. 幂等方案

### 6.1 唯一真实扣费门闩

**主键门闩**：`nx_task_charges` PK=`task_id` + `EXPECT_NOT_EXIST`。

20 workers 同时 `charge(T001)`：

- 1 个拿到 `pending`
- 其余 `ConditionCheckFail` → 读现有 charge：
  - `charged` → `PHASE6_CHARGE_IDEMPOTENT`，余额不变
  - `pending` → 进入 **recovery**（§7），**禁止**再走 `deductBalanceCas`
  - `refunded` / `failed` → 按策略拒绝或恢复（失败且确定未扣可人工/定时重试，默认不自动重扣）

辅门闩：`nx_transactions` 的 `idem_*` `EXPECT_NOT_EXIST`（与 legacy 同键），防止 charge 表异常时双扣。

### 6.2 禁止事项

- 禁止「仅 GetRow 无 charge → 扣费」作为唯一保障。  
- 禁止在不确定账务结果时重试扣余额。

### 6.3 Charge 前置条件（全部满足才 ①）

```text
status == claimed
AND execution_stage ∈ { awaiting_charge, ''/absent }   # 见 §9 引导
AND user_slot_held && platform_slot_held
AND reservation_id 非空
AND quoted_cost 为有限数且 >= 0
AND 不存在 status∈{charged,refunded} 的有效 charge（由 PK 抢占保证）
```

否则：拒绝，不扣费。  
`quoted_cost` 缺失/NaN/负数：标 `failed` + 释放槽（§8），**不**调 RH、**不**写 running。

---

## 7. Crash Window 处理方案

| 崩溃点 | 证据 | 恢复动作 |
|--------|------|----------|
| ① 前 | 无 charge 行 | 可安全重试整段 charge |
| ① 后、② 前 | charge=pending，无 ledger | 可继续 ②–⑥；或失败释放（若业务选择 abort：删/标 failed **仅当确认无余额变动**） |
| ② 后、③ 前 | consume_pending，余额未变 | **禁止**再开新扣费；recovery 继续 ③–⑥ 或 abort：删 pending ledger + 标 charge failed + 释放槽 |
| ③ 后、④ 前 | 余额已减，ledger 仍 pending | **必须** finalize ledger→consume；**禁止**再次 CAS 扣款；再 ⑤⑥ |
| ④ 后、⑥ 前 | ledger=consume，charge 可能仍 pending，task 仍 awaiting | 补 ⑤⑥：`PHASE6_CHARGE_RECOVERY`；**不扣费** |
| ⑥ 成功，响应超时 | stage=charged | 重试 → idempotent |

**可靠事实来源优先级**：

```text
ledger type=consume  ∨  charge.status=charged
  → 视为已扣费 → 只补齐 task.execution_stage=charged
```

Recovery 入口：同 `chargeClaimedTask(taskId)` 开头；或 cron `/internal/charge-claimed-tasks` 扫描 `claimed` + `awaiting_charge` + 已有 pending/charged 行。

---

## 8. 余额不足与确定失败

### 8.1 `BALANCE_INSUFFICIENT`（确定未扣）

```text
task.status = failed
execution_stage = done 或 error
error_code = BALANCE_INSUFFICIENT
release platform → user（现有 API）
reservation → released / rolled_back
charge.status = failed（若已 pending）或根本未创建成功扣费行
余额不变
```

禁止：余额不足仍长期占槽。

### 8.2 其它错误分类

| 类别 | 例 | 动作 |
|------|-----|------|
| **确定未扣费** | 前置校验失败；① 前异常；③ 条件失败 | failed + 释放槽（若已 claim） |
| **无法确认** | ③ 超时/网络；④ 超时 | **禁止重扣**；查 charge + ledger；走 recovery |
| **数据异常** | quoted 非法；slot 标志不一致 | failed + 释放（若可证明未扣）或挂起人工 |

---

## 9. 状态转换与 `execution_stage` 引导

对外主状态仍为：

```text
queued → claimed → running → terminal
```

Phase 6 只叠加 stage：

```text
claimed + (absent|awaiting_charge)  --charge ok-->  claimed + charged
claimed + (absent|awaiting_charge)  --fail------>  failed + done/error
```

**不写 `running`。**

### 9.1 `awaiting_charge` 如何出现（不改 Phase 5 claim CAS）

推荐（对 Freeze 最友好）：

1. **Charge 入口懒引导**：若 `status=claimed` 且 stage 空，则条件更新  
   `execution_stage='' → awaiting_stage`（或直接把「空」视为 awaiting，成功后再写 `charged`）。  
2. **不修改** `atomicClaimQueuedTask` / `queueScheduler`。

备选（若确认可接受的「最小文档化增量」）：仅在 claim 成功的 **调用方**（如 `runPromoteQueuedTasks` 外包一层 Phase 6 hook）写 stage——仍不改 scheduler 文件内部 CAS 顺序。默认采用方案 1。

---

## 10. Refund 方案

### 10.1 API

```text
refundTaskCharge(taskId) → { refunded, idempotent, amount, balance }
```

流程：

1. 读 `nx_task_charges`：必须 `status=charged`  
2. 复用 / 强化：`refundConsumedTask` 路径（依赖 `idem_*` consume 行）  
3. Refund 行：`refund_{idemTxId}` + `EXPECT_NOT_EXIST`（强化现网 `IGNORE` 为条件写，Phase 6 路径内保证）  
4. 余额：`INCREMENT +amount`（可选 CAS 风格，防并发双退）  
5. `charge.status = refunded`，`refunded_at`  
6. **不**自动改 task 为 cancelled（留给 Phase 7 / 调用方）；本 Phase 只保证退款幂等

重复 `refund × N` → 只退一次金额。

### 10.2 预留

Phase 7：`charged` 后 RH 失败 → 调 `refundTaskCharge` → 再释放槽 / 标 failed。

---

## 11. 编排与触发（仍不进 running / RH）

```text
[Phase 5] promote → claimed (+ slots)
     ↓
[Phase 6] chargeClaimedTask / batch charge-claimed-tasks
     ↓
claimed + charged   ← 停在这里
     ↓
[Phase 7 未开始] dispatch → running → RH …
```

触发源（实施时选配，均不改 Phase 5 核心）：

- Cron / 内部 HTTP：`/internal/charge-claimed-tasks`  
- Create 异步：promote 之后再 fire-and-forget charge（可选）  
- 单测直接调 `chargeClaimedTask`

---

## 12. 日志

结构化一行 JSON（无密钥、无完整 prompt）：

| event | 何时 |
|-------|------|
| `PHASE6_CHARGE_ATTEMPT` | 通过前置校验后 |
| `PHASE6_CHARGE_SUCCESS` | 首次真实扣费完成 |
| `PHASE6_CHARGE_IDEMPOTENT` | 已 charged 的重复请求 |
| `PHASE6_CHARGE_INSUFFICIENT_BALANCE` | 余额不足 |
| `PHASE6_CHARGE_FAILED` | 其它失败 |
| `PHASE6_CHARGE_RECOVERY` | 补齐 stage / finalize ledger |
| `PHASE6_REFUND_SUCCESS` | 首次退款 |
| `PHASE6_REFUND_IDEMPOTENT` | 重复退款 |

字段：`task_id, user_id, amount, charge_id, ledger_tx_id, status, timestamp`（+ `error_code` 可选）。

---

## 13. 测试方案

文件：`scripts/test-phase6-charge.mjs`（OTS 实库或可注入 deps 的双模式；与 Phase 5 live 风格一致）。

| ID | 场景 | 期望 |
|----|------|------|
| A | balance=100, cost=20 | charged；balance=80 |
| B | balance=10, cost=20 | failed；balance=10；user/platform occupied 回落 |
| C | 20 workers × charge(T001) | 真实扣费=1；其余 idempotent |
| D | balance=100；T1=80,T2=80 并发 | 成功1 失败1；balance=20；无负余额 |
| E | 同 task charge×10 | 有效扣费=1 |
| F | success 后模拟 timeout 再 retry | 不重复扣费 |
| G | charge20 + refund×10 | 只退 20 |
| H | 500 queued；user限5；plat100 | Phase5 claimed≤5；Phase6 charged≤5 |
| I | 50 users×限5；plat100 | claimed≤100；charged≤100 |
| Crash1 | 扣费成功、stage 未写 | recovery → stage=charged；余额只少一次 |
| Crash2 | stage 已 charged、响应丢 | retry idempotent |
| 回归 | Phase2/3/4/5 既有脚本 | 全部通过 |
| 禁令 | 全套 Phase6 跑完 | RH 调用=0；无任何 task 被 Phase6 标 running |

---

## 14. 实施边界与纪律

### 允许修改/新增

- 新模块 `taskCharge.mjs`、DB 增量 API、`upsertTask`/`getTask` 读写 `execution_stage`  
- `index.mjs` 增加 charge 内部路由  
- 测试与文档  
- **调用**现有 release API  

### 禁止修改（Freeze）

- `taskStatusMachine` 转移语义（除非仅文档注释；**优先零改动**）  
- `queueScheduler` claim/lease/reconcile 算法  
- User/Platform CAS 实现与三表语义  
- Legacy create/pending/processing 扣费路径  

### 验收前不做

- Phase 7（RH / `running`）  
- 默认把全站 create 切到 queue（产品决策另议）

---

## 15. 设计结论摘要

| 问题 | 方案 |
|------|------|
| 复用什么 | `quoted_cost`、`idemTxId`、consume/refund 流水、`refundConsumedTask` 思路、slot release API |
| 新写什么 | `nx_task_charges`、`execution_stage`、`deductBalanceCas`、`taskCharge` 编排与 recovery |
| 同 task 幂等 | charge 表 PK + ledger idem 双门闩 |
| 余额安全 | `balance >= amt` 条件 + `INCREMENT -amt` |
| Crash | ledger/charge 为 SoT；只补 stage，不重扣 |
| 不足 | failed + 释放双槽 |
| Refund | 每 task 至多一次；供 Phase 7 预留 |
| 停点 | `claimed + charged`；RH=0；running 不写 |

---

**请确认本设计后，再进入代码实施（第三步）。**
