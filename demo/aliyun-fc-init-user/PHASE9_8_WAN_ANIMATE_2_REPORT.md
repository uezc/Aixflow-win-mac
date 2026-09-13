# PHASE 9.8 — wan-animate-2 → Unified Queue Migration Report

**结论：`wan-animate-2 Queue Migration: PASS`**

本阶段仅迁移 `wan-animate-2`。未改 Queue Core / Gate 基础设施 / Claim / Charge / Timer / `runQueuePipeline`，未动 H3 Multi / H3 Audio / 已 PASS 的 `wan-animate`。未开始 `rhart-video-upscaler` / `hey-gem`。

---

## A. 原 Direct 链路

```
UI (VideoInputPanel / Workspace)
  → VideoProvider.execute
  → OSS：参考图 processImageToOssUrl + 参考视频 prepareWanAnimateVideoRemoteUrl（HTTPS）
  → RunningHub Direct：POST https://www.runninghub.cn/openapi/v2/run/ai-app/2086818758475210753
  → rhPostChargeVideo 即时扣费
  → rhQueryPollVideo（prefer mp4）
  → Result URL
  → 失败 refund：wan_animate_2_failed
```

| # | 项 | 值 |
|---|----|-----|
| 1 | UI 入口 | `VideoInputPanel` / `Workspace`，模型 `wan-animate-2` |
| 2 | Provider | `VideoProvider` |
| 3 | modelId | `wan-animate-2` |
| 4 | region | `cn`（runninghub.cn） |
| 5 | appId | `2086818758475210753` |
| 6 | API path | `/run/ai-app/2086818758475210753` |
| 7 | method | `POST` |
| 8–9 | nodeInfoList | 637 分辨率；642 提示词；651 原视频描述(空)；647 video；655 image |
| 10 | image | 恰好 1 张，OSS HTTPS |
| 11 | video | 恰好 1 条，OSS HTTPS（非 RH fileName） |
| 12 | audio | 不支持 |
| 13 | prompt | **选填**（空串也下发） |
| 14 | duration | RH **无 clip 节点**；计费按原视频秒数 Quantity |
| 15 | resolution | UI `720p`/`1080p` → RH `832`/`1280` |
| 16 | aspect ratio | 无独立节点 |
| 17 | randomSeed | Direct 未下发 |
| 18 | plus | `instanceType: plus`，`usePersonalQueue: false` |
| 19 | SKU | `wan-animate-2-720p` / `wan-animate-2-1080p` |
| 20 | OTS | `base_price` 为 ¥/秒；Quantity=`ceil(mediaDurationSec)` |
| 21 | Poll | `rhQueryPollVideo` / Queue 侧同 pipeline poll |
| 22 | Result | SUCCESS → mp4 URL |
| 23 | Refund | Direct：`wan_animate_2_failed`；Queue：统一 charge refund |
| 24 | Direct fallback | **已封死**（Queue-only） |

---

## B. 新 Queue 链路

```
UI
  → isVideoQueueOnlyModel → nxCloudQueueGoldenPath=true
  → Queue Gate：isCanvasWanAnimate2QueueGoldenPathInput
  → Create 前：图/视频 OSS HTTPS + mediaDurationSec 探测
  → buildWanAnimate2RhForward → /tasks/create（execution_mode=queue）
  → Claim → Charge → Provider Forward（RH.cn）
  → 保存 provider_task_id → Poll → Success / Refund + Slot Release
```

推进依赖云端 Timer / `run-queue-pipeline`，**不依赖客户端保持打开**。

---

## C. 改动文件

| 文件 | 变更 |
|------|------|
| `src/shared/videoQueueGoldenPath.ts` | `VIDEO_QUEUE_WAN_ANIMATE_2_MODEL`、`VIDEO_QUEUE_ONLY`、AppId/Path、Gate、`buildWanAnimate2RhForward` |
| `src/main/ai/providers/VideoProvider.ts` | `executeWanAnimate2CloudQueueGoldenPath`；早期 Queue 分支；Direct 硬拒绝 |
| `src/renderer/components/Canvas/VideoInputPanel.tsx` | 经 `isVideoQueueOnlyModel` 强制 Queue flag（无单独模型特例逻辑） |
| `scripts/test-phase9-8-wan-animate-2-queue.mjs` | Mock |
| `scripts/live-phase9-8-wan-animate-2-queue.mjs` | Live + 可控失败退款 |
| `PHASE9_8_WAN_ANIMATE_2_REPORT.md` | 本报告 |

**未修改：** Queue Core、handleTasksCreate、Claim/Lease、Charge/Refund 核心、Concurrency、Timer、`runQueuePipeline`、H3 Multi/Audio、`wan-animate` Adapter。

---

## D. Gate / Queue-only

- `VIDEO_QUEUE_WAN_ANIMATE_2_MODEL` ∈ `VIDEO_QUEUE_ONLY_MODEL_IDS`
- UI：`isVideoQueueOnlyModel(model)` → `nxCloudQueueGoldenPath = true`
- Gate：1 图 + `referenceVideoUrl`；禁止 audio / drama / director
- Direct 分支硬错误：`wan-animate-2 已强制云端排队，禁止 Direct…`
- **禁止** Queue → Direct fallback

---

## E. Wan Animate vs Wan Animate 2 差异

| 项 | wan-animate | wan-animate-2 |
|----|-------------|---------------|
| appId | `2048978834447409154` | `2086818758475210753` |
| region | cn | cn |
| path | `/run/ai-app/{appId}` | 同模式，不同 id |
| nodeInfoList | 57 image / 63 video / 250 clip / 259 res(`720`/`1080`) | 637 res(`832`/`1280`) / 642 prompt / 651 空描述 / 647 video / 655 image |
| image | 1 × OSS HTTPS | 1 × OSS HTTPS |
| video | 1 × OSS HTTPS | 1 × OSS HTTPS |
| audio | 否 | 否 |
| prompt | 强制空 | **选填** |
| duration | UI clip 5/8/10/15 → node 250 | **无 clip**；按视频秒数计费 |
| resolution | RH `720`/`1080` | RH `832`/`1280` |
| aspect ratio | 无 | 无 |
| randomSeed | 无 | 无 |
| plus | yes | yes |
| SKU | `wan-animate-{res}-{Ns}` | `wan-animate-2-{res}` |
| OTS | 固定档位价 | 每秒价 × Quantity |
| Poll / Result | cn + mp4 | 同 |

**仅复用：** OSS HTTPS 媒体语义、cn region、plus、统一 Queue pipeline、poll/settle/refund/slot。  
**独立实现：** appId、节点、分辨率映射、prompt、计费 SKU/Quantity。

---

## F. Provider 参数保持

Queue Forward 与 Direct 一致：

- path / method / rhRegion=cn  
- nodeInfoList 五节点（含可选 prompt、空 651）  
- `instanceType: plus`，`usePersonalQueue: 'false'`  
- 媒体仍为 OSS HTTPS（拒绝 RH fileName）  
- 计费字段仅在 `billingModelId` + `nodeData.mediaDurationSec`，不写入 RH body  

---

## G. Mock

脚本：`scripts/test-phase9-8-wan-animate-2-queue.mjs`  
结果：`scripts/phase9-8-wan-animate-2-queue-test-result.json`

**结论：PASS（24/24）**

覆盖：forward 形状、分辨率映射、可选 prompt、OSS HTTPS、Create/Claim/Charge/Dispatch/`provider_task_id`、Poll cn、Success + Slot Release、重复 Dispatch/Charge 幂等、Submit 明确失败退款、Provider FAIL 退款一次、timeout/unknown 不盲重建、Gate/Queue-only、与 wan-animate 差异、H3 Multi/Audio + wan-animate 回归静态检查。

---

## H. Live

脚本：`scripts/live-phase9-8-wan-animate-2-queue.mjs`  
结果：`scripts/phase9-8-wan-animate-2-live-e2e-result.json`

**SKU：** `wan-animate-2-720p`（最低成本）  
**mediaDurationSec：** 1 → quoted/actual **1 元宝**  
**推进：** 仅 FC `run-queue-pipeline`（模拟关客户端）

| 字段 | 值 |
|------|-----|
| task_id | `0186b0b1-ce38-4f01-9b67-566944a7ec4a` |
| queue_entered_at | `1788781132039` |
| claimed_at | `1788781129661` |
| charged_at | `1788781164276` |
| provider_task_id | `2096926333832744961` |
| execution_stage | `done` |
| completed_at | `1788781429468` |
| status | `success` |
| actual_charge | `1` |
| user / platform slot | released（occupied=0，held=false） |
| result | COS mp4 URL |

**Live 结论：PASS**

---

## I. provider_task_id

Live 写入：`2096926333832744961`（RH.cn）。Mock 幂等风暴仅 1 次 RH submit。

---

## J. Charge / Refund

- Live：quoted=1，actual_charge=1，`charge_status=charged`  
- OTS：`wan-animate-2-720p` base_price=0.1 × multiplier=1.2 × rate=10 × qty=1 → 1 元宝  
- 可控失败：`failure_refund=PASS`（bal 500→500→500，无 `provider_task_id`，重复 poll 不重复加余额）

---

## K. Slot Release

- Live success：user_occupied=0，platform_occupied=0，slots not held  
- Mock/Live 失败路径：user slot 释放  

---

## L. Direct fallback

- `VIDEO_QUEUE_ONLY` 含 `wan-animate-2`  
- Direct 分支硬拒绝文案已落地  
- Mock：`gate_on_no_direct_after_queue` / `queue_only_forced` PASS  

---

## M. Regression

| 检查 | 结果 |
|------|------|
| H3 Multi 仍 Queue-only | PASS（静态） |
| H3 Audio 仍 Queue-only | PASS（静态） |
| wan-animate AppId/Queue-only 未破坏 | PASS（静态；独立 AppId 保留） |
| Queue Core / Cloud Timer | 本阶段未改 |
| 已 PASS 模型 Direct fallback | 无新增回落 |

---

## 最终判定

**`wan-animate-2 Queue Migration: PASS`**

停止于此，等待验收。不继续迁移 `rhart-video-upscaler` 或 `hey-gem`。
