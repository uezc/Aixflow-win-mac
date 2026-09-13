# Queue 云端 Timer 自治报告

日期：2026-09-07  
目标：真正云端自治（不依赖 Windows / Cursor / 客户端 / `/tasks/status`）

---

## A. 云端 Timer 是否已经真正部署

**是。**

- 区域：`cn-hongkong`
- 函数：`nexflow-api`
- 触发器：`nexflow-queue-pipeline`
- triggerId：`12c604ed-6ea0-44d6-9ab8-47f19ca82b8c`
- createdTime：`2026-09-07T10:14:58Z`
- 记录：`scripts/deploy-queue-timer-result.json`

## B. 具体触发入口

1. **阿里云 FC Timer** 每分钟唤醒 `nexflow-api`
2. 事件 payload：`{ "action": "run-queue-pipeline", ... }`
3. 函数内 `parseFcTimerEvent` → `handleQueuePipelineTimer` → `runQueuePipeline`  
   （等价于 HTTP `/internal/run-queue-pipeline`，但不走 HTTP、不依赖本机调用）

HTTP `/internal/run-queue-pipeline` 仍保留，供排障手工调用。

## C. 触发频率

`@every 1m`（每分钟）

## D. 是否还依赖本机

**否。**  
验收期间已杀掉本机 minute-loop；脚本**未**调用 `/tasks/status` 与 `/internal/run-queue-pipeline`。

## E. 断开客户端后的真实任务是否自动完成

**是（PASS）。**

| 项 | 值 |
|----|-----|
| task_id | `5f2b638a-771b-4e86-a750-0af3fb66d23e` |
| model | `minimax-h3-t2v-720p-6s` |
| skip_queue_pipeline | true |
| 观察序列 | queued → claimed → running/provider_submitted → success |
| provider_task_id | `2096905706077913089` |
| charged_at | 有；余额 55657 → 55652（−5） |
| slot release | 最终 u/p = false；平台 video 0/100 |
| result | RH COS mp4 已写入 |

完整证据：`scripts/accept-queue-fc-timer-result.json`

## F. 若无法部署的原因

不适用——**已成功部署**，未用本机 minute-loop 冒充。

---

## 变更摘要（非 Phase 4/5/6 核心）

- `index.mjs` / `app/app.mjs`：Timer 事件入口 → Queue Pipeline
- `scripts/deploy-queue-timer.mjs`：创建/更新 FC Timer
- 京港函数代码已重新部署（Timer 挂在香港）

**暂停。** 不进入剩余模型迁移。
