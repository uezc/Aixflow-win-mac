# Queue 稳定性 P0 报告

日期：2026-09-07  
范围：自动推进 / 残骸清理 / 根因 / 无 `/tasks/status` 验收  
冻结：未改 Phase 4/5/6 核心 CAS；仅编排层 + 运维脚本。

---

## A. 自动 Queue 是否已可脱离客户端独立运行

**是（服务端链路已通），运维挂载需补齐。**

已落地：

| 组件 | 说明 |
|------|------|
| `POST /internal/run-queue-pipeline` | promote → charge → dispatch → poll 一键编排（京港已部署） |
| `scripts/cron-queue-pipeline.mjs` | 每分钟调用上述接口（需 `x-admin-settle-secret` + `x-nexflow-token`） |
| `scripts/run-cron-queue-pipeline.cmd` | Windows 包装 |
| create `skip_queue_pipeline` | 可跳过 create 后异步，专靠 cron 推进 |

验收任务 **未调用** `/tasks/status`，仅靠 pipeline 完成全生命周期 → **PASS**。

挂载缺口：本机 `schtasks` **拒绝访问**（无管理员权限），未能写入系统计划任务。当前依赖本会话内的 minute-loop 进程；**重启后需重新挂**，或用管理员执行：

```bat
schtasks /Create /TN "NEXFLOW-QueuePipeline" /SC MINUTE /MO 1 /F /TR "D:\NEXFLOW\demo\aliyun-fc-init-user\scripts\run-cron-queue-pipeline.cmd"
```

更稳方案：阿里云 FC **Timer 触发器**每分钟打香港 `nexflow-api` 的 `/internal/run-queue-pipeline`（不依赖本机开机）。

---

## B. 压测残骸是否已清理

**是。** 全表扫描约 23k 行后：

- queued / claimed / running 的 `__p5*` / `__p81*` 活跃残骸：**0**
- 平台视频槽：`0/100`（清理前后均为 0）
- 详见 `scripts/cleanup-p5-p81-junk-result.json`

此前手推/部分清理已消化大部分；本次确认无残留活跃 junk。

---

## C. 是否存在并发槽泄漏

**当前无泄漏。** `nx_queue_counters` video/image occupied = 0。

验收任务在 `provider_submitted` 期间持槽，settled 后 `user_slot_held/platform_slot_held=false`，平台 running 回 0。

---

## D. 是否存在任务饥饿

**当前低风险**（junk queued=0）。

根因（历史已实证，逻辑仍在）：

1. **无 cron** → lease 过期 claimed 不 recover → 槽可挂死；queued 不推进。
2. **压测**常 `NX_SKIP_QUEUE_PIPELINE_ON_CREATE` + 中途退出 → claimed/无 forward 残骸。
3. **promote 按 PK 扫前 N** → 大量 junk queued 会饿死真实用户。
4. **Reconcile** 默认不随每分钟 promote（需 `RECONCILE=1` 低频）。

Lease 默认 60s、orphan 120s；**有每分钟 pipeline 时** lease recovery 会跑，expired claimed 可恢复。

---

## E. 真实自动出队证据链

| 项 | 值 |
|----|-----|
| task_id | `70de0c5b-6e5e-4491-829b-6a8245df567b` |
| model | `minimax-h3-t2v-720p-6s` |
| skip_queue_pipeline | true |
| called `/tasks/status` | **false** |
| queue_entered_at | 1788775500418 |
| claimed_at | 1788775500779 |
| charged_at | 1788775527131 |
| provider_task_id | `2096902702788476929` |
| execution_stage | `done` |
| status | `success` |
| completed_at | 1788775776743 |
| slot release | u=false, p=false |
| 余额 | 55662 → 55657（cost=5） |
| result | RH COS mp4 已写入 |

Pipeline ticks：① claim+charge+dispatch → ② inflight → ③ poll settle success。

完整 JSON：`scripts/accept-queue-auto-lifecycle-result.json`

`/tasks/status` timeout 不影响服务端：本验收零 status 调用仍成功，证明客户端超时不会卡死 Queue 生命周期。

---

## F. 目前 Queue 仍有的 P0 风险

1. **系统 cron 未持久化**（schtasks 被拒）→ 机器重启后可能再次「只入队不推进」。
2. **无阿里云 Timer** → 依赖开发机进程，不是纯云端自治。
3. **junk 再现**（若再跑 skip-pipeline 压测且无清理）仍可能 PK 扫描饥饿。
4. **低频 reconcile** 未默认挂上（orphan reservation）。
5. create 后异步流水在 FC 回包后仍可能被掐（已有 cron 兜底，前提是 cron 活着）。

---

## 本步变更清单（非 Phase 核心）

- `lib/runQueuePipeline.mjs` + `/internal/run-queue-pipeline`
- `handleTasksCreate`：`skip_queue_pipeline`
- `scripts/cron-queue-pipeline.mjs` / `run-cron-queue-pipeline.cmd`
- `scripts/cleanup-p5-p81-junk-remnants.mjs`
- `scripts/accept-queue-auto-lifecycle.mjs`
- 京港 FC 已重新部署含上述代码

**暂停。** 不进入剩余模型迁移，直至你确认 cron 持久挂载方式（管理员 schtasks 或 FC Timer）。
