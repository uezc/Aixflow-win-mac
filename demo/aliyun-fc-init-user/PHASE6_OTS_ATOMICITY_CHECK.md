# PHASE6_OTS_ATOMICITY_CHECK

**结果**: PASSED — 允许继续 Phase 6 实施

**时间**: 2026-09-03T12:09:42.231Z

## SDK / API

- SDK: `tablestore@5.6.3`
- API: `client.updateRow`
- 表: `nx_users`（环境 `OTS_TABLE_USERS`）

## Condition 语法（已验证）

```javascript
const cond = new TableStore.CompositeCondition(TableStore.LogicalOperator.AND);
cond.addSubCondition(new TableStore.SingleColumnCondition(
  'balance', amount, TableStore.ComparatorType.GREATER_EQUAL, false));
cond.addSubCondition(new TableStore.SingleColumnCondition(
  receiptCol, 1, TableStore.ComparatorType.NOT_EQUAL, true)); // passIfMissing=true
new TableStore.Condition(EXPECT_EXIST, cond)
```

## Operations（同一 UpdateRow）

```javascript
updateOfAttributeColumns: [
  { INCREMENT: [{ balance: -amount }] },
  { PUT: [{ [receiptCol]: 1 }, { updated_at }] },
]
```

## 语义结论

| 项 | 结论 |
|----|------|
| INCREMENT 与 PUT receipt 是否同一 UpdateRow | **是** |
| 复合条件 AND 是否生效 | **是** |
| timeout 后可否 GetRow(receipt) 判 APPLIED | **是（语义具备）** |
| 拆成两次 UpdateRow | **禁止；本次验证未拆分** |

## 测试明细

- PASS **T1_same_updateRow_increment_and_put**: `{"debitOk":true,"balance":70,"receipt":1}`
- PASS **T2_second_debit_same_receipt_idempotent_fail**: `{"debitOk":false,"balance":70,"receipt":1}`
- PASS **T3_20_workers_same_receipt**: `{"okN":1,"balance":75,"receipt":1}`
- PASS **T4_two_ops_compete_balance**: `{"a":true,"b":false,"balance":20,"ra":1,"rb":null}`
- PASS **T5_getRow_receipt_as_money_sot**: `{"moneySot":"APPLIED","balance":40,"receipt":1}`
- PASS **T6_insufficient_balance_no_receipt**: `{"debitOk":false,"balance":5,"receipt":null}`

## 判定规则

OTS 支持 B′ 所需原子语义。**可以继续 Phase 6 业务实施。**
