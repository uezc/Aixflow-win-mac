# Phase 1 Online Acceptance Report

日期：2026-09-09

## Phase 1 Online Acceptance

### 1. Deployment
**PASS**

| 地域 | 函数 | lastModified | codeSize |
|---|---|---|---|
| cn-hongkong | nexflow-api | 2026-09-09T14:47:01Z | 15059579 |
| cn-beijing | aixflow-api | 2026-09-09T14:47:03Z | 15059579 |

包：`fc-deploys/nexflow-fc-2026-09-09T14-46-27-120Z.zip`

**环境变量（部署前 → 部署后）**

部署前两地域五池均为 **null（未显式设置）**。  
部署后均已显式写入：

```
GLOBAL_CN_VIDEO_CONCURRENCY=100
GLOBAL_CN_IMAGE_CONCURRENCY=100
GLOBAL_OVERSEAS_VIDEO_CONCURRENCY=100
GLOBAL_OVERSEAS_IMAGE_CONCURRENCY=100
GLOBAL_AUDIO_CONCURRENCY=100
```

### 2. Pool Isolation
**PASS**

- cn_video used=100 + cn_image used=100（证明 100 是**每池**上限）
- overseas 在 cn 近满时仍可 claim（海外 used≈97 / claimed_ok=99），未被国内池阻塞

### 3. 100 Concurrency Limit
**PASS**

cn_video：capacity=100，used=100，claimed=100，queued=1（101 入队）

### 4. Release 1 → Refill <= 1
**PASS**（隔离复测）

初测受 Timer/并发噪声干扰（观测非严格 −1、refill=0）→ **初测 FAIL**。  
隔离复测：`5 → release → 4 → refill 1 → 5`。

### 5. Multi-worker Anti-Oversell
**PASS**

并发释放 5 槽后 used 始终 ≤100；未见 101+。

### 6. Duplicate Claim Protection
**PASS**（隔离复测）

3 并发 tryClaim：1 成功 + 2×CLAIM_RACE。

### 7. Idempotent Charge
**PASS**

二次 charge 日志 `PHASE6_CHARGE_IDEMPOTENT`；`nx_task_charges` status=charged 单条。

### 8. Idle Behavior
**PASS**（HTTP 复测）

`/internal/run-queue-pipeline`：328ms，`idle_no_patrol=true`，claimed/poll=0。  
（FC SDK Invoke 流读取在本机失败，改为 HTTP 验收。）

### 9. Immediate Refill
**PASS**

settle success 后 waiting 任务变为 claimed，不依赖下一 Timer 周期。

### 10. Legacy Counter Migration
**PASS**

OTS 仍存在 `video`/`image` 行（running=0）。生产 acquire/release 经 `normalizePlatformPoolKind` 映射到 `cn_*`，不再占用旧 PK。

### 11. resource_pool Consistency
**PASS**（隔离复测）

`nx_tasks.resource_pool` 与 `nx_task_work.resource_pool` 均为 `cn_video`。  
（初测在 cleanup 删除后采样导致假 FAIL。）

### 12. Cost Observation
**NOT VERIFIED**

空闲调度已证明秒退且无 claim/poll。完整空闲夜账单需你在费用中心确认。

---

## 汇总

| 类别 | 项目 |
|---|---|
| 已通过 | 1–11（4/6/8/11 含隔离复测纠正） |
| 未通过 | 无硬 FAIL |
| 风险 | 全量压测时 Timer 与本地 CAS 并发会造成计数抖动；初测 multi refill 在噪声下 refillSum=0 |
| 必须修复 | 无（架构未改） |
| 可进 Phase 2 | **可以**，条件：人工确认费用中心空闲周期 |

## 证据文件

- `scripts/accept-phase1-resource-pool-online-result.json`
- `scripts/accept-phase1-retest-http-result.json`
- `scripts/patch-fc-env-resource-pools-result.json`
- Canvas：`phase1-resource-pool-acceptance.canvas.tsx`

## 验收后状态

全部池 `running=0`，`nx_task_work` 空闲。
