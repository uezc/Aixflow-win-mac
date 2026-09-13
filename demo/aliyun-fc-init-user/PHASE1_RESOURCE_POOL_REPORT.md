# AIXFLOW Phase1 资源池与自动补位 — 实施报告

日期：2026-09-09

## 结论

一期已落地：**按 RH 站点×能力拆平台池**；**释 1 槽最多补 1 个 waiting**；补位必须再走 OTS `acquire`；不计费/Provider 大改；不接 MNS；不迁 ASR/VIAPI/Apilio。

## 资源池与并发配置

| pool_id | 默认上限 | 环境变量 |
|---|---|---|
| `cn_video` | 100 | `GLOBAL_CN_VIDEO_CONCURRENCY`（回退 `GLOBAL_VIDEO_CONCURRENCY`） |
| `cn_image` | 100 | `GLOBAL_CN_IMAGE_CONCURRENCY`（回退 `GLOBAL_IMAGE_CONCURRENCY`） |
| `overseas_video` | 100 | `GLOBAL_OVERSEAS_VIDEO_CONCURRENCY` |
| `overseas_image` | 100 | `GLOBAL_OVERSEAS_IMAGE_CONCURRENCY` |
| `audio` | 同国内图 | `GLOBAL_AUDIO_CONCURRENCY` |

别名：`video`→`cn_video`，`image`→`cn_image`。用户套餐并发仍按 `video|image|audio`。

未迁入：Apilio / DashScope ASR / VIAPI（旁路不变）。

## 调度与补位

1. `POST /tasks/create`（queue）：解析 `resource_pool` → OTS → 异步 promote（经 acquire）
2. settle / charge fail / lease recover / orphan：`release` 成功且非 `already_empty` → **同池 `maxRefill=1`** → 再 `tryClaim`（含 platform acquire）
3. Timer：空闲秒退；有活时 lease/orphan recovery + promote 兜底（非正常主路径）

## 防重

- claim：`queued→claimed` CAS
- 扣费：现有 `nx_task_charges` 幂等（未改）

## 修改文件

- `lib/platformConcurrencyConfig.mjs`（+ app/lib）
- `lib/resourcePool.mjs`（新）
- `lib/queueScheduler.mjs`
- `lib/db-tablestore.mjs`
- `lib/handleTasksCreate.mjs`
- `lib/providerPipeline.mjs`
- `lib/taskCharge.mjs`
- `lib/runQueuePipeline.mjs`
- `.env.example`
- `scripts/test-resource-pool-phase1.mjs`（新）
- `scripts/test-phase5-queue-scheduler.mjs`（适配）

## 阿里云待办

- **无需**新建 MNS/RocketMQ/Trigger/DLQ（一期未做真消息队列）
- **需要**：重新打包部署 FC（`nexflow-api` / 若启用北京备用亦同步）
- **建议**：在 FC 环境变量显式写入上表并发配置
- 旧 `video`/`image` 计数：`ensure` 时若新池为 0 会尽力迁入 `cn_*`

## 本地自测

```
node scripts/test-resource-pool-phase1.mjs  # PASS
node scripts/test-phase5-queue-scheduler.mjs # PASS
```

线上验收（101 并发等）需部署后压测；本报告未替你假设线上资源已就绪。
