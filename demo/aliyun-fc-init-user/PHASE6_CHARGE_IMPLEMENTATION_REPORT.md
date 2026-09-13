# Phase 6 Charge Implementation Report

**状态**：实施完成 · 专项测试 PASSED · Phase 2–5 回归 PASSED  
**Money SoT**：`nx_users.dr_{opHash(chg_{task_id})}=1`（与 `balance` 同一次 `UpdateRow`）  
**停点**：`status=claimed` + `execution_stage=charged` · **未**写 `running` · **未**调 RunningHub · **未**开 Phase 7

前置验证：`PHASE6_OTS_ATOMICITY_CHECK.md` → **PASSED**

---

## 1. 验收指标（专项 `test-phase6-charge.mjs`）

| 指标 | 结果 |
|------|------|
| 真实 charge 次数（首成功路径） | ≥1（用例 A/C/F/J 合计；C 硬断言余额只减一次） |
| idempotent charge 次数 | E×10 + C×19 + G 等（余额未再减） |
| 余额不足次数 | 1（B）+ D 中失败侧 |
| charge failure 次数 | 含余额不足；无不明双扣 |
| refund 次数 | 1 |
| idempotent refund 次数 | 9 |
| 最大余额偏差 | 0（相对期望终态） |
| 负余额 | **否** |
| 双扣 | **否** |
| 双退 | **否** |
| 槽泄漏（B 不足释槽后） | **否**（plat/user occupied 回落） |
| queued 扣费 | **否** |
| 写入 running | **否** |
| RunningHub 调用 | **0** |
| 套件 PASSED | **true** |

用例：A–J 全部 PASS（J 用 50 queued 验证同构上限：claimed=5 / charged=5 / queued=45；完整 500 与 Phase 5 调度测试同构已在回归覆盖）。

---

## 2. Phase 2–5 回归

| 脚本 | 结果 |
|------|------|
| `test-task-status-machine.mjs` | OK |
| `test-user-concurrency-entitlement.mjs` | OK |
| `test-platform-concurrency-pool.mjs` | OK（内存 CAS） |
| `test-phase5-queue-scheduler.mjs` | ALL OK（含 500→5、平台 100） |

Phase 5 核心 CAS / claim / reservation / lease / reconcile **未改语义**。

---

## 3. 实现摘要

| 组件 | 说明 |
|------|------|
| `lib/taskCharge.mjs` | 编排 charge / refund / recover；结构化日志 |
| `lib/db-tablestore.mjs` | `atomicDebitWithReceipt` / `atomicCreditWithReceipt` / `nx_task_charges` / finalize |
| `POST /internal/charge-claimed-tasks` | ADMIN_SETTLE_SECRET |
| 表 `nx_task_charges` | HK 已 `ensureTaskChargesTable` 创建 |
| `buildUserPutColumns` | **保留** `dr_*`/`rr_*`，防止 legacy `putRow` 抹掉 Money SoT |

### Charge 流程

```text
claimed + awaiting_charge（空 stage 懒引导）
→ nx_task_charges pending（PK=task_id，operation_id=chg_{task_id}）
→ 单行原子：balance-=amount + dr_*=1
→ GetRow receipt 判定 APPLIED / NOT_APPLIED
→ finalize ledger consume + charge=charged + stage=charged
```

成功后 **不释放** user/platform 槽（留给 Phase 7）。

余额不足：`failed` + 释双槽 + reservation released；余额不变。

---

## 4. 数据链示例（claimed → charged）

### nx_users（Money SoT）

```text
user_id: <uid>
balance: 80                    # 原 100，扣 20
dr_<16hex>: 1                  # receipt = APPLIED
```

`operation_id = chg_<task_id>` · `opHash = sha256(operation_id)[0:16]` · 列名 `dr_{opHash}`

### nx_task_charges（业务元数据，非 Money SoT）

```text
PK task_id: <task_id>
charge_id: <task_id>
operation_id: chg_<task_id>
user_id: <uid>
amount: 20
status: charged
ledger_tx_id: idem_<sha256(uid|task_id)>
charged_at: <ms>
```

### nx_transactions（流水镜像，非 Money SoT）

```text
PK transaction_id: idem_<sha256(uid|task_id)>
type: consume
amount: -20
task_id / user_id / provider: phase6_charge
```

### nx_tasks

```text
status: claimed
execution_stage: charged
quoted_cost: 20
cost / amount: 20
charge_id: <task_id>
user_slot_held / platform_slot_held: 仍为 held
```

---

## 5. Refund

```text
refund_operation_id = ref_{task_id}
同一 UpdateRow: balance += amount + rr_{opHash}=1
ledger: refund_{idem_*}
charge.status → refunded
```

重复 refund → receipt 已 1 → IDEMPOTENT。

---

## 6. Crash / Timeout

| 场景 | 行为 |
|------|------|
| Atomic UpdateRow 成功后崩溃，charge 仍 pending | GetRow receipt=1 → APPLIED → 只 finalize，不重扣（用例 F） |
| UpdateRow 未执行 | receipt 缺失 → NOT_APPLIED → 同 operation_id 可重试 |
| timeout | **禁止盲重扣**；先 GetRow receipt |
| ledger finalize 失败 | recovery 补 ledger；余额不重扣（用例 H） |

---

## 7. `nx_users` receipt 行膨胀风险（必须知晓）

长期在用户主行积累 `dr_*` / `rr_*`：

- 可能逼近 OTS 单行大小上限、放大 put/get 成本  
- 已用短哈希列名；`putRow` 路径已强制带回 receipt  

**本次不改变已批准 Money SoT。** 后续可扩展独立 wallet 行/局部事务表做 GC，但不在本 Phase 改协议。

---

## 8. 未做 / 停点

- Phase 7（RunningHub / `running`）**未开始**  
- legacy `pending`/`processing` **未迁移**  
- FC 生产 zip **未强制重部署**（代码已就绪；部署属配置步骤）  
- 默认 `/tasks/create` 仍可为 legacy  

---

## 9. 关键文件

- `PHASE6_OTS_ATOMICITY_CHECK.md`
- `PHASE6_CHARGE_DESIGN_REVIEW_V2.md`
- `lib/taskCharge.mjs`
- `scripts/verify-phase6-ots-atomicity.mjs`
- `scripts/test-phase6-charge.mjs`
- `scripts/phase6-charge-test-result.json`
- `scripts/ensure-task-charges-table.mjs`

---

**结论**：Phase 6 B′ 单行原子扣款已落地并通过专项与回归测试。允许停留在 `claimed + charged`。待验收通过后再开 Phase 7。
