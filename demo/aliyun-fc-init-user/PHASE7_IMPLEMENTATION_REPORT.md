# Phase 7 Implementation Report

**状态**：实施完成 · 专项测试 PASSED · Phase 5 / Phase 6 回归 PASSED  
**基线**：`PHASE7_DESIGN_REVIEW.md` → READY FOR IMPLEMENTATION（未改架构）  
**入口**：`status=claimed` + `execution_stage=charged`  
**出口**：`success|failed` + `execution_stage=done` + 槽位释放（若 held）

---

## 0. 一句话结论

已按设计落地云端 **Dispatch / Poll / Settle / Recovery** Worker：`provider_task_id` 为 Provider 绑定 SoT；RH submit **timeout → `dispatch_unknown`，禁盲重 POST、禁盲退**；Dispatch Lease 与 Phase 5 Claim Lease **字段分离**；Money SoT / Phase 5 CAS **未改**；charged **不释槽**；legacy `/run-task` 对管线任务 **409 拒绝双提交**。

---

## 1. 修改文件

| 文件 | 变更 |
|------|------|
| `lib/providerStages.mjs` | stage 常量、`blocksLegacyProviderSubmit`、RH 状态归一 |
| `lib/providerRhClient.mjs` | `submitRunningHub` / `queryRunningHub`（可注入 mock） |
| `lib/providerPipeline.mjs` | `dispatchOneChargedTask` / `pollOneProviderTask` / `settleOneTask` / `recoverOneProviderTask` + batch runners |
| `lib/db-tablestore.mjs` | Phase7 字段读写、`tryAcquireDispatchLease`、`atomicSetProviderTaskId`、`markTaskProviderSubmitted`、list helpers、runners；**settle-stale 排除 Phase7 管线** |
| `index.mjs` | legacy guard + 4 个 `/internal/*` 路由；清理误粘贴 orphan catch |
| `app/lib/*`（上述模块同步） | 部署树镜像 |
| `app/app.mjs` | 同 index：guard + 路由；修复 orphan 语法块 |
| `scripts/test-phase7-provider-pipeline.mjs` | mock RH + 实库 OTS 专项 |
| `PHASE7_IMPLEMENTATION_REPORT.md` | 本报告 |

**未修改（禁改清单）**：Phase 5 CAS / reservation / claim lease 算法；Phase 6 Money SoT（`dr_*`/`rr_*`）；MV Director `pump=5`；客户端 Provider 主路径（本阶段只记录旁路风险）。

---

## 2. 状态流转

```text
claimed + charged
  → (CAS dispatch lease) dispatching
  → RH submit OK → atomicSet provider_task_id → provider_submitted + status=running
  → poll SUCCESS → settling → success + release → done
  → poll FAILED  → settling → refund(ref_*) → failed + release → done

submit timeout / uncertain
  → dispatching + dispatch_unknown=1
  → 禁止再 POST / 禁止 refund（Recovery 仅告警停）

submit 明确失败（无 taskId）
  → refund(ref_*) + failed + release → done
```

| `execution_stage` | 含义 |
|-------------------|------|
| `charged` | 可被 Dispatch 选中 |
| `dispatching` | 持有 dispatch lease；可能 UNKNOWN |
| `provider_submitted` | 已绑定 `provider_task_id` |
| `settling` | Provider 终态，写结果/退款/释槽中 |
| `done` | 本地结算完成 |

Dispatch 字段（与 Phase 5 `lease_owner` / `lease_expires_at` **分离**）：

- `dispatch_lease_owner` / `dispatch_lease_expires_at` / `dispatch_attempt`
- `dispatch_unknown`
- `provider_status` / `provider_last_checked_at` / `provider_error`
- `provider_forward_json`（Dispatch 载荷）

---

## 3. Crash A–J 处理

| # | 场景 | 实现 |
|---|------|------|
| A | charged 未调 RH | Recovery / 再 Dispatch；lease 过期可重抢 |
| B | RH 已创建但 HTTP timeout | `dispatch_unknown=1`；**禁重提交、禁退** |
| C | 有返回 id，写库前崩 | 最坏同 B；缓解：先 `atomicSetProviderTaskId` 再标 running |
| D | RH 明确创建失败 | `failed` + `refundTaskCharge` + release |
| E | 有 id，写 running 失败 | 有 SoT → Poll/Recovery 补 `running` |
| F | Provider SUCCESS，写 success 失败 | Poll 再见 SUCCESS → settle 幂等 |
| G | Provider FAILED，写 failed 失败 | 再 settle；refund 幂等 |
| H | refund 已执行，worker 崩 | Phase 6 `rr_*` → 再 settle 跳过双退，补 release |
| I | success，release 失败 | Recovery：`release_only`（终态+held） |
| J | failed+refund 成功，release 失败 | 同 I |

---

## 4. 幂等 / 安全

| 规则 | 结果 |
|------|------|
| RH 无提交幂等键 | timeout → UNKNOWN，**不**盲重 POST |
| `provider_task_id` 非空 | 视为 SoT，**禁止**再 submit |
| Dispatch lease CAS | `status=claimed` + owner 空/同名/过期观测值匹配；冲突 `LEASE_RACE` |
| 20 worker 同 task | 实测 **RH submit 调用 = 1** |
| Refund | 仅 `db.refundTaskCharge`（Phase 6 `ref_*` / `rr_*`） |
| charged 释槽 | **否**（仅 terminal settle / 明确 submit 失败路径） |
| Money SoT | **未改** |
| Phase 5 CAS | **未改** |
| legacy `/run-task` | `blocksLegacyProviderSubmit` → **409 PHASE7_PIPELINE_ACTIVE**（`/query` 仍允许） |
| settle-stale | **跳过** Phase7 stage / `provider_task_id` / `dispatch_unknown`，避免盲退 |

---

## 5. Internal 路由

| Method | Path | 作用 |
|--------|------|------|
| POST | `/internal/dispatch-charged-tasks` | 扫描 charged → Dispatch |
| POST | `/internal/poll-provider-tasks` | 有 `provider_task_id` → Poll/Settle |
| POST | `/internal/settle-terminal-tasks` | `settling` 收尾 |
| POST | `/internal/recover-provider-tasks` | Crash 修复（UNKNOWN 不盲 submit） |

鉴权：`ADMIN_SETTLE_SECRET`（与 charge/promote 一致）。

---

## 6. 测试结果

### 6.1 专项 `scripts/test-phase7-provider-pipeline.mjs`（mock RH + 实库）

```text
PASSED= true
```

| 用例 | 结果 |
|------|------|
| A_dispatch_success | PASS |
| B_timeout_no_blind_retry | PASS |
| C_provider_id_sot_no_resubmit | PASS |
| D_explicit_submit_fail | PASS |
| F_provider_success_settle | PASS |
| G_provider_failed_settle | PASS |
| H_refund_settle_idempotent | PASS |
| I_release_recovery | PASS |
| C20_dispatch_storm（20 worker） | PASS（submits=1） |
| legacy_run_task_blocked | PASS |
| CrashA_recover_dispatch | PASS |

### 6.2 回归

| 脚本 | 结果 |
|------|------|
| `test-phase5-queue-scheduler.mjs` | **ALL OK** |
| `test-phase6-charge.mjs` | **PASSED=true**（A–J 全过） |

### 6.3 风险指标（专项可观测）

| 指标 | 结果 |
|------|------|
| 重复 RH 提交（同 task storm） | **否**（1 次） |
| timeout 后盲重试 | **否** |
| 重复扣费 | **否**（本阶段不 charge；不碰 Money SoT） |
| 重复退款 | **否**（settle 二次 → idempotent） |
| 槽位泄漏（终态 recovery） | **否**（I 用例 held→0） |
| charged 误释槽 | **否** |

---

## 7. 未解决 / 已知风险（不扩需求）

| 风险 | 等级 | 说明 |
|------|------|------|
| RH 无幂等 → timeout 无法 100% 分辨是否已创建 | **P0 残留** | 已用 UNKNOWN 封死自动路径；需人工/后续 RH 能力 |
| 客户端仍可走 legacy create+run-task（未 charged） | P0（迁移） | 本阶段仅阻断**已入管线**任务双提交；MV pump=5 **未改** |
| 「有响应未落盘」极窄窗 | P1 | 已缩小为先写 `provider_task_id`；仍非零 |
| list charged 全表扫描 | P2 | 与 Phase5/6 同构；量上来需索引 |
| Dispatch 需任务带 `provider_forward_json`（或 prompt 内嵌 forward） | 产品接线 | 缺载荷 → `NO_FORWARD_PAYLOAD`，不调 RH |

---

## 8. 实施顺序对照

1. DB dispatch 字段 + list + lease CAS — **完成**  
2. Dispatch Worker + 禁盲重试 — **完成**  
3. `provider_task_id` + Poll — **完成**  
4. Settle + refund + release — **完成**  
5. Recovery + UNKNOWN — **完成**  
6. Phase 2–6 回归 — Phase5 / Phase6 **PASSED**  
7. 客户端 queue-only — **明确后置（本报告不扩展）**  
8. 冻结 — 建议验收本报告后冻结 Worker 语义  

---

*Phase 7 Implementation · 2026-09-03*
