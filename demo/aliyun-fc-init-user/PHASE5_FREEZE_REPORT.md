# Phase 5 Freeze Report

**状态**：正式冻结（2026-09-03）  
**范围**：Aliyun FC + OTS（香港主库 `nexflow-db`）云端任务队列并发 — `queued → claimed`  
**冻结策略**：不再修改 Phase 5 核心逻辑（`taskStatusMachine` / `queueScheduler` / User·Platform CAS / reservation / lease / reconcile / Phase 5 OTS 结构）。仅允许明确 bug、安全、日志、测试、部署配置与文档。  
**下一阶段**：Phase 6 **未开始**。

---

## 1. 最终状态机

正式生命周期：

```
queued → claimed → running → success | failed | cancelled
```

| 阶段 | 允许推进 | 禁止 |
|------|----------|------|
| **Phase 5（已冻结）** | `queued → claimed`；lease 回收 `claimed → queued` | 扣元宝；调用 RunningHub；写入 `running` |
| **Phase 6（未实现）** | claim 后扣费 | — |
| **Phase 7（未实现）** | `claimed → running` + RH 执行 | — |

兼容旧值：`pending` / `processing` 为历史别名；读时可归一，写时尽量迁正式状态。

并发语义：

| 状态 | 占用户并发 | 占平台并发 | Phase 5 counter 对账 |
|------|------------|------------|----------------------|
| `queued` | 否 | 否 | 否 |
| `claimed` | 是 | 是 | 是（`occupiesPhase5CounterSlot`） |
| `running` | 是 | 是 | 是 |
| legacy `processing` | 业务「在飞」语义是 | 是 | **否**（从未走 CAS，不可当 counter actual） |
| legacy `pending` | 否（未 claim slot） | 否 | 否 |

状态转移约束见 `lib/taskStatusMachine.mjs`：`queued ↛ running`；`claimed → running` 仅留给 Phase 7。

---

## 2. 用户并发控制机制

- **权益来源**（Phase 3，只读消费）：套餐目录 + 用户级 override（未过期时）。默认 video=5 / image=10；可购额度与元宝余额分离。
- **计数表**：`nx_user_concurrency_counters`，PK `counter_key = {userId}#{video|image}`，字段 `occupied`。
- **CAS**：`tryAcquireUserConcurrencySlot(userId, type, limit)` — 条件 `occupied < limit` 后 `INCREMENT +1`；满则 `USER_CONCURRENCY_FULL`。
- **释放**：`releaseUserConcurrencySlot` — `occupied > 0` 才 `-1`，空则幂等。
- **Claim 路径顺序**：先 User CAS，再 Platform CAS，再原子 claim（见 §4）。

---

## 3. 平台并发控制机制

- **分池**：`video` / `image`，默认 max 各 **100**（`GLOBAL_VIDEO_CONCURRENCY` / `GLOBAL_IMAGE_CONCURRENCY`）。
- **计数表**：`nx_queue_counters`，PK `pool_id`，字段 `running`（语义为「已占用槽位数」，含 claimed+running，非仅 running 状态任务）。
- **CAS**：`tryAcquirePlatformConcurrencySlot` — 条件 `running < max` 后 `+1`；满则 `PLATFORM_POOL_FULL`。
- **释放**：`releasePlatformConcurrencySlot` — 防负值；条件失败视为已空幂等成功。
- **隔离**：video / image 池互不影响。

---

## 4. Reservation 生命周期

表：`nx_slot_reservations`（PK `reservation_id`）。

```
pending
  ├─（持有 user / platform 标志位逐步置 1）
  ├─→ claimed     （queued→claimed 成功）
  ├─→ rolled_back （任一步失败逆序释放；或 orphan reconcile）
  └─→ released    （lease 回收后）
```

单次 claim（`tryClaimOneQueuedTask`）固定顺序：

1. 写 reservation（`state=pending`，`expires_at = now + orphanMs`，默认 120s）
2. User CAS → `user_slot_held=1`
3. Platform CAS → `platform_slot_held=1`
4. `atomicClaimQueuedTask`（条件 `status==queued`）→ reservation `claimed`
5. 任一步失败：逆序释放 platform → user，reservation `rolled_back`

任务行写入：`claim_token`、`reservation_id`、`lease_owner`、`lease_expires_at`、`claimed_at`；**不写** `running` / 扣费字段。

批量 promote：按 `queue_entered_at` FIFO；每波每用户至多 1 次成功 claim（简易公平）。

---

## 5. Lease Recovery

- 默认 lease：`NX_CLAIM_LEASE_MS`，缺省 **60s**。
- `recoverOneExpiredClaim`：先 `atomicUnclaimExpiredTask`（`claimed → queued`，校验 claim_token / 过期），成功后再 `releasePlatform` → `releaseUser`，reservation → `released`。
- 与 create / cron / reconcile 路径共用同一回收语义，避免重复释放靠任务原子 unclaim 门闩。

---

## 6. Reconcile

| 能力 | 行为 |
|------|------|
| Orphan reservation | `pending` 且过期仍 held，但任务未以同 reservation 处于 claimed/running → 释放槽位并 `rolled_back` |
| 状态愈合 | 任务已绑定本 reservation 且仍占用槽 → 仅修正 reservation 为 `claimed` |
| Counter overshoot | `computeCounterOvershoot`：**仅当 `scanComplete=true`** 才允许按 actual 多出量 release；扫描不完整必须返回 0，禁止误释放 |
| Phase 5 actual | 仅统计 `claimed` + `running`；**不含** legacy `processing` |
| HTTP | `/internal/promote-queued-tasks`、`/internal/reconcile-queue-reservations`（`ADMIN_SETTLE_SECRET`） |
| 京港 | 双区 FC 指向同一 HK OTS；promote / reconcile 探测均 200；OTS 分页 `OTSInvalidPK` 已用 PK shorthand 修复 |

---

## 7. 多 Worker CAS 证明

隔离环境（与 FC 同 OTS CAS 路径，本地多 worker，排除全表 promote 串扰）：

| 实验 | 输入 | 结果 |
|------|------|------|
| 平台 CAS 风暴 | 200 路并发 `tryAcquirePlatform`（video） | ok=100, fail=100, running=100, **oversell=false**；清理后 counter=0 |
| Claim 风暴 | 1 用户 limit=200，150 queued，20 workers `tryClaimOneQueuedTask` | claimed=100, plat=100, user=100, **无超卖**；清理后全部 counter=0 |

结论：平台 CAS 与 claim 路径在极限竞争下均可硬顶在 max=100，无超卖。

---

## 8. 已验证测试结果

验收结论（最终通过）：

1. **平台 CAS**：200 竞争 → 100/100；running 最大 100；清理后 0；无平台超卖。  
2. **多 Worker Claim**：150 任务 × 20 worker → claimed=plat=user=100；无超卖；清理后 0。  
3. **京港线上**：promote / reconcile 正常；分页 PK 问题已解决。  
4. **语义确认**：queued 不占并发；claimed/running 占用户+平台；Phase 5 不扣费、不调 RH、不把 claimed 标成 running；legacy processing 不入 Phase 5 counter；reservation / rollback / lease / reconcile 具备。

补充说明（非否决项）：

- FC **全表** promote 无法隔离填充测试（会 claim 他人 queued）；填充证明依赖同路径本地 worker。  
- 曾有交叉干扰 run 出现 claimed=115 vs plat=99，隔离复测未复现，归因重叠跑批/残量，**不作为超卖证据**。

相关产物：

- 单元/调度：`scripts/test-phase5-queue-scheduler.mjs`  
- Live：`scripts/live-phase5-concurrency-stress.mjs`  
- 部署包：`nexflow-fc-phase5.zip`（HK+BJ 已部署，OTS 仅 HK）

---

## 9. OTS 表结构（Phase 5）

仅香港主实例；北京冷备未建这些表。

### `nx_queue_counters`（平台池）

| 列 | 说明 |
|----|------|
| PK `pool_id` | `video` \| `image` |
| `running` | 已占用槽（INTEGER） |
| `max_hint` | 配置 hint |
| `updated_at` | ms |

### `nx_user_concurrency_counters`（用户池）

| 列 | 说明 |
|----|------|
| PK `counter_key` | `{userId}#video\|image` |
| `user_id` / `task_type` | 冗余 |
| `occupied` | 已占用 |
| `limit_hint` / `updated_at` | hint / ms |

### `nx_slot_reservations`

| 列 | 说明 |
|----|------|
| PK `reservation_id` | UUID |
| `task_id` / `user_id` / `task_type` | 绑定 |
| `user_slot_held` / `platform_slot_held` | 0\|1 |
| `state` | pending / claimed / rolled_back / released |
| `claim_token` / `rollback_reason` | 追踪 |
| `created_at` / `expires_at` / `updated_at` | ms |

### `nx_tasks`（Phase 5 新增/使用字段）

`status`（含 `claimed`）、`queue_entered_at`、`claimed_at`、`claim_token`、`reservation_id`、`lease_owner`、`lease_expires_at`、`user_slot_held`、`platform_slot_held` 等。  
**Phase 5 claim 路径不写入计费完成态、不推进 `running`。**

---

## 10. 当前尚未实现的 Phase 6 / 7 能力

| Phase | 能力 | 状态 |
|-------|------|------|
| **6** | claim 成功后扣元宝 / 账本；失败回滚 slot 与状态策略 | **未开始** |
| **6** | 扣费与 reservation / lease 的一致性与幂等 | 未实现 |
| **7** | `claimed → running` | 未实现 |
| **7** | 调用 RunningHub / Provider 执行 | 未实现 |
| **7** | 终态后释放用户+平台槽；成功/失败/取消结算 | 未实现 |
| — | 默认把 `/tasks/create` 切到纯 queue（现默认仍可 legacy） | 产品/迁移决策，非 Phase 5 核心 |
| — | 客户端 MV / AICore 全面迁到 queue 模式 | 未做 |

---

## 11. 明确：当前仍不会扣费 / 不会调 RunningHub / 不会进入 running 的地方

以下路径在 **Phase 5 冻结面**内保证：

| 路径 | 扣元宝 | RunningHub | 写入 `running` |
|------|--------|------------|----------------|
| `execution_mode=queue` 的 `/tasks/create` | **否**（只入队 + quoted） | **否** | **否**（仅 `queued`） |
| `tryClaimOneQueuedTask` / `promoteQueuedTasks` | **否** | **否** | **否**（仅 `claimed`） |
| `atomicClaimQueuedTask` | **否** | **否** | **否** |
| lease recover / orphan reconcile / counter reconcile | **否** | **否** | **否** |
| `/internal/promote-queued-tasks` | **否** | **否** | **否** |
| `/internal/reconcile-queue-reservations` | **否** | **否** | **否** |

**例外（非 Phase 5 新队列路径，仍属 legacy）**：

- `execution_mode=legacy`（或默认 `NX_TASKS_CREATE_DEFAULT_MODE=legacy`）的 `/tasks/create`：**仍会扣费**并写 `pending`，走旧 Provider 转发 — **不属于 Phase 5 claim 管线**，冻结范围不要求改它。

---

## Freeze 声明

- Phase 5 商业硬上限（用户并发 + 平台 100 分池 + CAS + reservation/lease/reconcile）**验收通过并冻结**。  
- 核心模块与 OTS 结构进入只读维护（仅 bug / 安全 / 日志 / 测试 / 部署 / 文档）。  
- **不启动 Phase 6**，直至另行开题。

**冻结代码锚点**：

- `lib/taskStatusMachine.mjs`
- `lib/queueScheduler.mjs`
- `lib/db-tablestore.mjs`（User/Platform CAS、reservation、atomic claim/unclaim、promote/reconcile 入口）
- `lib/userConcurrencyEntitlement.mjs` / `lib/platformConcurrencyConfig.mjs`（额度解析；结构已稳定）
- `lib/handleTasksCreate.mjs`（queue 分支异步 promote；勿在此加入扣费/RH）

---

*Report generated for Phase 5 Freeze · 2026-09-03*
