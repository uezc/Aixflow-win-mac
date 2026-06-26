/**
 * AIXFLOW 充值相关 Tablestore 表
 *
 * nx_orders — PK out_trade_no
 *   status: pending | processing | paid | failed | refunded
 *   （无 processing 布尔列；processing 状态即锁）
 *
 * nx_pending_settlement — PK out_trade_no
 *   status: queued | processing | settled | failed
 *   user_id, trade_no, amount_cny, retry_count, next_retry_at, last_error, settled_at
 *
 * nx_repair_log — PK log_id
 */

console.log(`
Tablestore 表：

1) nx_orders (PK out_trade_no)
   status 单字段状态机，勿再建 processing 列

2) nx_pending_settlement (PK out_trade_no)
   预入账异步队列；notify 写 queued，worker 执行后 settled

3) nx_repair_log (PK log_id)

客户端：SSE /api/v1/alipay/events/stream + 5s polling fallback
`);
