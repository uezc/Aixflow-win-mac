# 支付宝充值闭环（生产级）

## 订单状态（单字段 status）

`pending` | `processing` | `paid` | `failed` | `refunded`

- **processing** = 支付已确认、入账锁（无单独 processing 布尔列）
- 流转：`pending → processing → paid`

## 预入账队列（FC 异步执行器）

表 **`nx_pending_settlement`**（PK `out_trade_no`）

| settlement status | 含义 |
|-------------------|------|
| `queued` | notify 入队，待 FC 执行 |
| `processing` | 正在 rechargeWithLedger |
| `settled` | 已写 nx_transactions |
| `failed` | 预留 |

notify 流程：

1. 验签 → 订单 `pending→processing`
2. 写 `nx_pending_settlement(queued)` → **立即 ack 支付宝**
3. 异步 `executePendingSettlement` → 写流水 → 订单 `paid`

失败：`queued` 保留，30s worker 重试。

## 客户端更新（事件优先）

1. **SSE** `GET /api/v1/alipay/events/stream?out_trade_no=...`
   - `settlement-queued`
   - `recharge-settled`
2. **IPC** `recharge-settled` → 刷新余额
3. **Polling fallback** 每 **5s** 查 order-status

## Tablestore 表

- `nx_orders`
- `nx_pending_settlement`（替代 nx_recharge_retry）
- `nx_repair_log`

建表：`node scripts/create-nx-orders-table.mjs`

## FC 内部接口

- `POST /internal/alipay-notify-settle` — 入队
- `POST /internal/alipay-execute-pending` — 单条执行
- `POST /internal/alipay-retry-process` — 批量 worker

## 环境变量

```
NX_ALIPAY_PAY_SECRET=...
ALIPAY_RETRY_INTERVAL_SEC=30
MODEL_COST_THRESHOLD_RATIO=0.6
```
