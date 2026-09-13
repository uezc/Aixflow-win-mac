# Phase 9.7 — minimax-h3-audio Unified Queue 迁移报告

**H3 Audio Queue Migration: PASS**

未改动：Queue Core / `/tasks/create` / Claim / Charge / Concurrency / Timer / `runQueuePipeline` / H3 Multi / 其它已 PASS 模型。

---

## 审计摘要（迁移前）

### A. 原 Direct 链路

```
UI (VideoInputPanel / Workspace / 导演 lipsync)
  → VideoProvider.execute（isMinimaxH3AudioModel）
  → 校验：1–5 图 + 必填 inputAudioUrl
  → OSS 图 + 音（强制 ffmpeg→MP3）
  → RH /media/upload/binary → fileName
  → getMediaDuration → mapMinimaxH3AudioBillingDurationSec（仅计费，不进 RH）
  → buildMinimaxH3AudioNodeInfoList（+ seal；无时长节点）
  → rhPostChargeVideo(/run/ai-app/2086260808442531842, .cn)
       plus → 803 再试 default（双扣风险）
  → 客户端 rhQueryPollVideo
  → 失败 tryRefundFcForwardCharge(minimax_h3_audio_*)
```

| 项 | 值 |
|----|-----|
| RH 区域 | **cn** |
| ai-app | `2086260808442531842` |
| path | `/run/ai-app/2086260808442531842` |
| nodeInfoList | 138 提示词 / 115 aspect+mega / 137–202 图(最多5) / **171 参考音必填** / **无时长节点** |
| 输入 | prompt、images(1–5)、inputAudioUrl(必填)、aspect_ratio |
| resolution | 固定 megapixels `0.9`（720p） |
| duration | RH 按参考音读；计费档 6\|10\|15\|20（向上取整，读不到→20） |
| SKU | `minimax-h3-audio-720p-{6\|10\|15\|20}s` |
| body | randomSeed=true, retainSeconds=0, usePersonalQueue=false |
| 入口 | 画布 VideoInputPanel；Workspace 短剧 lipsync；导演 `h3-audio` 编译（`directorSpawned`/`drama`） |
| Direct fallback | 迁移前唯一路径；无 Queue Adapter |

与 H3 Multi **不同点**：必填单路音、1–5 图、不同 appId/节点、**无时长节点**、计费由探测时长映射。

---

## B. 新 Queue 链路

```
UI → Queue Gate（强制 nxCloudQueueGoldenPath）
  → executeMinimaxH3AudioCloudQueueGoldenPath
       Create 前：同 Direct 图/音预处理 + 计费时长探测 + nodeInfoList
  → /tasks/create（queue + provider_forward_json）
  → Claim → Charge → Provider Forward → Poll → Release/Refund
```

客户端不参与 Queue 推进（本次 Live 用 `skip_queue_pipeline` + `run-queue-pipeline`）。

---

## C. 修改文件

| 文件 | 变更 |
|------|------|
| `src/shared/videoQueueGoldenPath.ts` | `VIDEO_QUEUE_H3_AUDIO_*`、Queue-only、Gate、`buildMinimaxH3AudioRhForward` |
| `src/main/ai/providers/VideoProvider.ts` | Queue 执行路径；Direct 硬拒绝 |
| `scripts/test-phase9-7-h3-audio-queue.mjs` | Mock |
| `scripts/live-phase9-7-h3-audio-queue.mjs` | Live + 可控退款 |

FC / Queue Core：**未改**。

---

## D. Queue-only / Gate

**是。**

- `minimax-h3-audio` ∈ `VIDEO_QUEUE_ONLY_MODEL_IDS`
- Provider 强制 Queue flag 后走 Gate：1–5 图 + `inputAudioUrl`；排除 drama/director
- Direct 兜底文案硬拒绝
- `rhPostChargeVideo` 对 Queue-only billingId 拦截

导演/短剧：Gate 排除 → Direct 硬拒绝（非静默 fallback）。

---

## E. Provider 参数保持

| 项 | Direct | Queue |
|----|--------|-------|
| region / path / appId | cn / 208626… | 同 |
| nodeInfoList | buildMinimaxH3AudioNodeInfoList | 同（Create 前） |
| 无时长节点 | 是 | 是 |
| megapixels / aspect | 0.9 / RH 长标签 | 同 |
| randomSeed / retainSeconds | true / 0 | 同 |
| instanceType | plus→default(803) | **仅 plus** |
| usePersonalQueue | false | `'false'` |
| 计费时长探测 | getMediaDuration→map | 同 |

---

## F. Mock 结果

- `scripts/phase9-7-h3-audio-queue-test-result.json`
- **PASS 24/24**
- 含：create/charge/dispatch/poll/release、重复 charge/dispatch、submit/provider 失败退款、timeout/unknown 不盲目重建、Gate/Queue-only、Direct 封堵、Multi 回归

---

## G. Live 任务

| 字段 | 值 |
|------|-----|
| task_id | `1e020ba6-4a94-48d1-85cd-23e7587186ca` |
| queue_entered_at | 1788778289786 |
| claimed_at | 1788778287612 |
| charged_at | 1788778324255 |
| execution_stage | done |
| completed_at | 1788778559164 |
| final status | **success** |
| SKU | `minimax-h3-audio-720p-6s` |

结果：`scripts/phase9-7-h3-audio-live-e2e-result.json`

---

## H. Provider Task ID

`2096914439885508610`（RH.cn）

---

## I. Charge / Refund

- Live 成功扣费：**8**（charged ×1，无退款）
- 可控失败退款：`3d769f8c-…` → failed + refund，balance 500→500 不变；重复 poll 不重复加款 → **PASS**

---

## J. Slot Release

Live：`user_slot_held=false`，`platform_slot_held=false`，occupied=0。  
失败用例：槽位亦释放。

---

## K. Direct fallback 检查

**无静默回落。** Adapter + Gate + Queue-only + Direct 硬拒绝。

---

## L. Regression

- H3 Multi 仍在 `VIDEO_QUEUE_ONLY`（Mock 校验 PASS）
- 未改 Queue Core / Timer / 其它模型

---

## 结论

**H3 Audio Queue Migration: PASS**

本阶段停止。下一模型（wan-animate-2 / upscaler / hey-gem 等）需另行确认后再开始。
