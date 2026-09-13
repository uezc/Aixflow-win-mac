# Phase 6 Charge Design Review V2

**状态**：Crash Consistency 重审 · **未批准实施** · 禁止实施代码  
**文件**：`PHASE6_CHARGE_DESIGN_REVIEW_V2.md`  
**取代**：V1 中「① pending → ② consume_pending → ③ balance CAS → ④…」在 CAS 成功后崩溃不可判定的路径  
**验收句**：对任意 `task_id`，任意崩溃/超时/重试次数，真实扣费只能是 **0 或 1**，绝不为 2。

---

## 0. 结论先行

| 问题 | 结论 |
|------|------|
| `nx_users.balance` 与 `nx_transactions` 能否跨表原子提交？ | **不能**（不同分区键；现网也未用局部事务） |
| V1「先 CAS 余额、再写 charge/ledger」在超时后能否 100% 判定？ | **不能** → **否决裸 CAS** |
| Charge 是否允许 `UNKNOWN` 作为终态？ | **不允许**；中途可 `RECOVERING`，恢复后必须落到 `APPLIED` / `NOT_APPLIED` |
| V2 采用什么？ | **否决方案 A（裸余额 CAS）**；采用 **方案 B′：Operation 门闩 + 单行原子扣款（余额 Δ 与 operation 回执同一次 `updateRow`）** |
| Charge 金钱事实 SoT | **`nx_users` 上与余额同事务写入的 `debit_receipt_{opHash}=1`** |
| 业务幂等 SoT（每 task 一次 charge） | **`nx_task_charges` PK=`task_id`**（绑定固定 `operation_id`） |

---

## 1. 当前账务架构审计

### 1.1 组件

| 组件 | 实现要点 |
|------|----------|
| `nx_users.balance` | INTEGER；`putRow` 全量覆盖更新为主 |
| `nx_transactions` | PK=`transaction_id`；扣费键 `idem_${sha256(userId\|taskId)}` |
| `deductWithTransaction` | GetRow 快路径 → `consume_pending` EXPECT_NOT_EXIST → **无条件 put 用户余额** → 升格 `consume` |
| `refundWithLedger` | GetRow refund 键 → put 余额+amount → put `REFUND`（条件 IGNORE） |
| `refundConsumedTask` | 要求已有 `type=consume`，再调 `refundWithLedger` |
| Phase 5 CAS | `running`/`occupied` 用条件 + INCREMENT；**账务未复用该模式** |
| 局部事务 | **代码库中未使用** `startLocalTransaction` |

### 1.2 现网扣费顺序（简化）

```text
read user
→ put tx consume_pending (EXPECT_NOT_EXIST)   // 幂等门闩
→ put user balance = balance - amt            // 非 CAS，整行覆盖
→ put tx consume
```

### 1.3 与「真实扣费事实」相关的可查询键

| 键 | 可查？ | 能否单独证明「余额已因该 task 减少」？ |
|----|--------|----------------------------------------|
| `idem_*` 行存在且 `consume` | 是 | **意图/账本事实**；与余额变更 **非原子**，不能单独在 timeout 后证明余额已动 |
| `idem_*` 且 `consume_pending` | 是 | **不能**证明余额已扣（见 B/C） |
| `task_id` 本身 | 任务表有 | **无**余额变更事实 |
| 读 `balance` 差值 | 是 | **禁止**：并发充值/扣费/退款使差值不可归因 |

---

## 2. balance 与 ledger 的原子性结论

### 2.1 问题 1：能否原子提交？

**不能。**

- `nx_users` PK = `user_id`
- `nx_transactions` PK = `transaction_id`（`idem_*` / `refund_*`）
- OTS **局部事务**仅支持**同一表、同一分区键**内多行原子提交
- 现网两表 PK 域不同 → **无法**把「改余额 + 写流水」放进同一次 OTS commit
- `batchWriteRow` 跨行/跨表 **不提供**跨分区原子性

因此任意「先余额后流水」或「先流水后余额」的**两步协议**，两步之间都存在 Crash Window。  
**唯一消除「余额是否已因本 operation 变动」歧义的办法**：让「余额变动」与「本 operation 的已应用回执」落在 **同一次单行 `updateRow`（或同分区局部事务）** 里。

### 2.2 两操作之间的 Crash Window（现网）

```text
consume_pending 已写
        ⋮  window W1：余额未改；若误判 idempotent → 假「已扣」
put user balance 成功
        ⋮  window W2：余额已改；consume 未升格
put consume 成功
```

V1 若改为 CAS：

```text
CAS -amount 成功
        ⋮  window W3：余额已改；charge/ledger 仍 pending —— 正是本次否决点
写 charge=charged
```

**W3 无法用余额现值反推 T001。**

---

## 3. 现网 `deductWithTransaction` 分场景结果

> 现网 **没有** balance CAS；下列按实际 `putRow` 行为回答。`C`/`D` 按「超时、客户端不知成败」理解。

### A. balance 更新成功，transaction 写失败（升格 `consume` 失败）

- 状态：`consume_pending` + **余额已减少**
- 重入：GetRow 见 `consume_pending` → 直接 `idempotent: true`，**不会**再改余额，也**不一定**升格 `consume`
- 结果：钱已扣；流水可能永久停在 pending；**与 task 无 stage 对齐**

### B. transaction 写成功（`consume_pending`），balance 更新失败

- 代码尝试 `deleteRow` pending；成功则近似回滚门闩，可重试
- 若 **delete 失败/超时**：留下 `consume_pending`、余额未改；重入返回 `idempotent: true` → **假已扣、真未扣**（严重一致性洞）

### C. balance 写请求超时，服务器不知成败

- 可能：未写入 / 已写入
- 若 pending 仍在：重入可能直接 idempotent，**无论余额是否已变**
- 若客户端走失败分支删 pending：可能对**已成功的余额写**失去门闩 → **重试可能二次扣款**（覆盖写在并发下更危险）
- **无法 100% 判定**，且无 per-operation 回执列

### D. transaction 请求超时，不知 `consume_pending` 是否写入

- 重试 put：若已存在 → ConditionCheckFail → 当 idempotent（余额可能从未改）
- 若不存在 → 再走全流程
- **存在「以为成功实际未扣」与竞态窗口**

### 小结

现网函数：

- 同 `task_id` 的 `idem_*` **意图上**防双流水主键，但
- **不能**作为 Phase 6 所要求的「超时后 100% APPLIED/NOT_APPLIED」金钱 SoT
- **不能**安全支撑「CAS timeout 禁止再扣」除非改造单行原子回执

---

## 4. 问题 3–5 直接回答

### 3. 是否存在以 `task_id / idem_tx_id` 为键的「余额变更事实」？

- **账本行**：有（`idem_*`）——是「流水/意图」事实，**不是**与余额同原子的变更事实  
- **余额变更事实**：当前 **不存在** 可按 `task_id` 查询的、与 `INCREMENT/put balance` 同原子提交的回执  

### 4. CAS 成功但 charge 仍 pending 时，如何 100% 判断 T001 是否已扣？

在 **V1 裸 CAS** 下：**不能**。禁止用余额差值猜测。

### 5. 若无法判断？

必须重协议 → 下文 V2。不允许保留终态 `UNKNOWN`。

---

## 5. 方案评估

### 方案 A：现有余额 CAS + 独立 Charge SoT（裸 CAS）

```text
charge pending → CAS balance → 记录 applied
```

| 场景 | 能否可靠恢复 |
|------|----------------|
| CAS 成功后崩溃，charge 未写 | **否**（不知是否 CAP 成功以外的并发干扰；且无 op 回执） |
| CAS timeout | **否**；重试 CAS 可能双扣（OTS 官方亦声明 INCREMENT **本身不幂等**） |

**结论：否决。** 不得采用「独立 Charge 行作为金钱 SoT、余额 CAS 无 op 回执」的架构。

### 方案 B：账务操作唯一入口（ledger → balance）

若仅「先写 ledger、再改余额」而无同原子回执：

- ledger 先成功、余额 timeout → 仍歧义  
- 余额先成功、ledger 后写 → 回到 W3  

**纯顺序方案 B 不足。**

### 方案 B′（采纳）：Charge Operation 门闩 + **单行原子扣款**

核心思想：

1. **业务层**：每个 `task_id` 仅一个 `operation_id`（写入 `nx_task_charges`）  
2. **金钱层**：一次 `updateRow(nx_users)` **同时**：
   - 条件：`balance >= amount` **且** 本 `operation_id` 回执列尚未应用  
   - `INCREMENT balance -= amount`  
   - `PUT debit_receipt_{opHash} = 1`  
3. 该次 RPC 的成功 / 条件失败 / 超时后的 **GetRow 回执列** → 判定 `APPLIED` / `NOT_APPLIED`  
4. ledger / charge.status / `execution_stage` 全部是 **可重试的派生写**，以金钱回执为准

可选增强（非必须）：新建同分区钱包表 + 局部事务；与 B′ 等价更干净，但迁余额成本高。Phase 6 **优先 B′ 落在现有 `nx_users` 行**，控制范围。

---

## 6. Charge SoT（唯一权威）

### 6.1 分层（避免「看起来像」）

| 层级 | 存储 | 含义 |
|------|------|------|
| **Money SoT（扣款是否发生）** | `nx_users` 属性 `debit_receipt_{opHash}` **与余额同次 updateRow 写入** | `==1` ⇒ **APPLIED**；缺失 ⇒ **NOT_APPLIED**（在无并发半写单行语义下） |
| **Business SoT（本 task 是否已完成 charge 编排）** | `nx_task_charges.status` | `charged` 仅在 Money SoT=APPLIED 后置位；可落后，可靠 recovery 补齐 |
| **Ledger 镜像** | `nx_transactions` `idem_*` → `consume` | 对账/退款/展示；**不**单独定义金钱 APPLIED |
| **Task 投影** | `execution_stage=charged` | UI/调度；可落后，recovery 补齐 |

### 6.2 判定规则（禁止猜测）

```text
读 Money SoT（debit_receipt_{opHash}）:

  = 1     → APPLIED
            → 禁止再次 INCREMENT
            → 允许/必须 finalize：ledger consume、charge=charged、stage=charged

  缺失    → NOT_APPLIED
            → 允许再次尝试「同一 operation_id」的单行原子扣款
            → 或在业务失败路径标记 charge=failed 并释槽（确定未扣）

禁止：
  - 用 balance 差值推断
  - 仅凭 charge=pending / ledger=consume_pending 推断已扣或未扣
  - CAS/updateRow timeout 后直接再扣而不先读回执
```

超时路径：

```text
AtomicDebit timeout
  → GetRow nx_users
  → 看 debit_receipt_{opHash}
  → APPLIED | NOT_APPLIED
  → 禁止第三态作为对外结果（内部可短暂 RECOVERING）
```

---

## 7. operation_id 设计

```text
task_id        = T001                    // 业务任务
charge_id      = T001                    // 与 task 1:1，等于 PK
operation_id   = chg_{task_id}           // 本次唯一扣款操作身份（固定、可重算）
ledger_tx_id   = idem_${sha256(userId|taskId)}   // 复用现网键，便于 refundConsumedTask 思路
refund_operation_id = ref_{task_id}      // 至多一次退款操作
opHash         = first16(sha256(operation_id))   // 短列名
receipt_col    = dr_{opHash}             // debit receipt 列名
refund_col     = cr_{opHashRefund}       // credit receipt
```

约束：

- 同一 `task_id` → **永远同一个** `operation_id`（禁止每次请求 new UUID，否则 timeout 无法对回收据）  
- `nx_task_charges` 创建时写入 `operation_id`；冲突则读出已有行，沿用其 `operation_id`

---

## 8. task_id 幂等机制

```text
putRow nx_task_charges
  PK = task_id
  EXPECT_NOT_EXIST
  status = accepting
  operation_id, user_id, amount=quoted_cost, ledger_tx_id, created_at
```

- 成功：本 worker 获得编排权  
- ConditionCheckFail：读出行 → 进入 **共享 recovery**（同一 `operation_id`），**不**生成新 operation  

状态建议：

```text
accepting → applied_pending_finalize → charged
         → failed          // 仅 Money SoT=NOT_APPLIED 且确定放弃
charged  → refunded        // 退款成功后
```

`charged` 的前置条件：**Money SoT 必须已是 APPLIED**。

---

## 9. balance 并发安全（单行原子扣款）

### 9.1 `AtomicDebit(userId, operation_id, amount)`

```text
updateRow nx_users
  condition (AND):
    row EXPECT_EXIST
    balance >= amount                          // GREATER_EQUAL
    receipt_col != 1  (passIfMissing=true)     // 未应用才允许
  ops:
    INCREMENT balance = -amount
    PUT receipt_col = 1
    PUT updated_at = now
```

| 结果 | 含义 |
|------|------|
| OK | Money SoT=APPLIED（本瞬间完成） |
| ConditionFail | 读回执：若已是 1 → 幂等 APPLIED；若余额不足且回执缺失 → NOT_APPLIED / INSUFFICIENT |
| Timeout | GetRow → 回执 1/缺失 → APPLIED / NOT_APPLIED |

并发两 task（不同 `operation_id`）：各用不同 `receipt_col`，`INCREMENT` 串行化余额；至多扣到非负（由条件保证）。

同 task 20 worker：同一 `receipt_col`；仅一次条件成功；其余见回执=1 → idempotent。

`amount=0`：可只 PUT 回执=1（或跳过余额），仍建立 Money SoT。

### 9.2 列膨胀说明

每成功扣款一列回执。缓解：

- 列名短哈希  
- 属性 TTL / 定期 GC 冷列（运维）；或中期迁 **钱包局部事务表**  

不影响正确性。

### 9.3 为何不把 ledger 放进同一次原子

ledger 在别的表/PK，无法同 commit。ledger 必须是 **APPLIED 之后的可重试镜像**。

---

## 10. CAS / AtomicDebit timeout 处理

```text
禁止：
  timeout → 再次无条件 INCREMENT

必须：
  timeout → GetRow → 检查 receipt_col
    APPLIED     → finalize only
    NOT_APPLIED → 可再次调用 AtomicDebit（同一 operation_id；条件仍防双扣）
```

与 OTS 文档一致：INCREMENT 重试必须带「版本/标记」条件；本设计用 **receipt 列** 充当该标记。

---

## 11. Crash recovery / pending recovery

### 11.1 主流程（V2）

```text
0. 校验 Phase 6 前置（claimed、slots、quoted_cost…）—— 失败且未开 op 则不扣费
1. Ensure charge row（task_id 幂等）+ 固定 operation_id
2. AtomicDebit(...)          // Money SoT 唯一写入点
3. 若 NOT_APPLIED + insufficient → charge=failed，释槽，结束
4. 若 APPLIED：
     a. put/upsert ledger consume（可重试；已存在则跳过）
     b. charge.status=charged（可重试）
     c. task.execution_stage=charged，cost=amount（可重试；status 仍 claimed）
```

### 11.2 Recovery 伪代码

```text
function recover(task_id):
  charge = get charge(task_id)
  if !charge: return NOT_STARTED
  op = charge.operation_id
  money = getReceipt(user, op)   // APPLIED | NOT_APPLIED

  if money == APPLIED:
    finalize ledger + charge=charged + stage=charged
    return APPLIED

  if money == NOT_APPLIED:
    if charge.status == charged:  // 不应发生；告警，以 Money 为准纠偏
      repair
    if giving up / insufficient on retry:
      charge=failed; release slots
      return NOT_APPLIED
    else:
      return RETRY_ATOMIC_DEBIT

  // 无 UNKNOWN 出口
```

### 11.3 原 V1 窗口对照

| 原窗口 | V2 |
|--------|-----|
| CAS 成功、charge 仍 pending | GetRow 回执=1 → APPLIED → 只 finalize |
| CAS timeout | 回执判定，禁止盲重扣 |
| ledger consume_pending 半态 | 降级为镜像；以回执为准补写 consume |

---

## 12. Refund idempotency

```text
refund_operation_id = ref_{task_id}

前置：charge.status=charged 且 Money debit 回执=1
且 refund 回执缺失

AtomicCredit:
  condition: credit_receipt != 1 (pass if missing)
  INCREMENT balance += amount
  PUT credit_receipt = 1

然后：
  ledger refund_{idem} EXPECT_NOT_EXIST（可重试）
  charge.status=refunded
```

重复 `refund` × N：第一次 Credit APPLIED；其后见 credit 回执 → `REFUND_IDEMPOTENT`，金额只退一次。

Timeout：同样先读 credit 回执再决定。

---

## 13. 与 Phase 5 / legacy 边界

| 项 | 策略 |
|----|------|
| Phase 5 CAS / claim / 三表 | **只读 + 仅调用 release** |
| `taskStatusMachine` / `queueScheduler` | **不改核心**；stage 由 Phase 6 模块写 |
| legacy `deductWithTransaction` | **不改**；Phase 6 **不调用**它做扣款 |
| RunningHub / `running` | **禁止** |
| queued | **不扣费**；仅 `claimed` + 前置条件进 charge |

---

## 14. 测试方案（设计级；实施阶段执行）

### 14.1 用户余额并发（Test D）

`balance=100`，T001=80，T002=80，两 worker 并发 AtomicDebit：

- 成功 1 / 失败 1  
- 终态 balance=20  
- 两回执列仅一列对成功 task 为 1  
- **无负余额**

### 14.2 20 worker 同 task（Test C）

- 同一 `operation_id`  
- Money APPLIED 恰好 1 次  
- 余额只减一次  
- 其余 IDEMPOTENT / recovery finalize  

### 14.3 两 task 竞争余额

同 14.1；并断言 ledger 至多两行中只有一行 consume（或一行 consume + 一行无 Money 回执的 failed charge）。

### 14.4 Timeout / Crash 注入

| 注入点 | 期望 |
|--------|------|
| AtomicDebit 返回前杀进程 | 恢复后回执判定；0 或 1 次扣款 |
| AtomicDebit 成功后、charge 写前杀 | 回执=1；finalize；不重扣 |
| finalize ledger 失败 | 重试补 ledger；余额不变 |
| Refund timeout | credit 回执判定；只退一次 |

### 14.5 Phase 5 回归

- `test-phase5-queue-scheduler.mjs`  
- platform pool / user entitlement / status machine  
- 槽：余额不足释槽后 occupied 回落；charge 路径不泄漏  
- 全套 Phase 6 中 RH 调用计数=0；无 `status=running` 由 Phase 6 写入  

### 14.6 其它（A/B/E/F/G/H/I）

保持原 Phase 6 任务书用例；判定断言改为 **Money SoT 回执 + charge 行**，不用余额差猜测。

---

## 15. 日志（恢复可观测）

在 V1 事件上增加：

- `operation_id` / `opHash` / `money_sot=APPLIED|NOT_APPLIED`  
- `PHASE6_CHARGE_RECOVERY` 必须打印 recovery 前后 SoT  

禁止敏感信息。

---

## 16. 最终验收原则（V2）

Phase 6 **仅当**满足：

> 对任意 `task_id`，无论在 AtomicDebit / finalize / refund 任一步崩溃、超时、重复执行，系统仅通过查询 `operation_id` 对应的 **Money SoT 回执**（及 charge 行），确定真实扣费 **0 或 1 次**，且可通过同一套规则确定退款 **0 或 1 次**；**不存在**依赖余额差值的猜测；**不出现**双扣、负余额、双退、Phase 5 槽泄漏；queued 不扣费；不写 running；不调 RunningHub。

---

## 17. 本轮停止条件

- 已输出本 V2 Review  
- **不修改代码、不建表、不部署、不改 Phase 5/legacy、不进 Phase 7**  
- **等待确认**后再实施  

**待确认点（请明示）**：是否接受在 `nx_users` 上使用 `dr_{opHash}` 回执列作为 Money SoT（方案 B′）；若否，则改为「钱包表 + 局部事务」等价方案后再审。
