# PHASE 9.10 — hey-gem → Unified Queue Migration Report

**结论：`hey-gem Queue Migration: PASS`**

本阶段仅迁移 `hey-gem`。未改 Queue Core / Cloud Timer / Claim / Charge / `runQueuePipeline`。未动已 PASS 模型。本轮模型迁移到此结束。

---

## C. 模型类别

**数字人 / 人物视频（参考视频 + 驱动音频口型驱动）**

不是纯 T2V/I2V 生成，也不是超分处理。TTS（一键配音）在 UI Create **之前**完成，不进入 RH / Queue Provider Forward。

---

## D. 审计结果

| # | 项 | 值 |
|---|----|-----|
| 1 | modelId | `hey-gem` |
| 2 | Provider | `VideoProvider` |
| 3 | region | `cn` |
| 4 | appId | `2071200225913565185` |
| 5 | path | `/run/ai-app/2071200225913565185` |
| 6 | method | `POST` |
| 7 | nodeInfoList | `1/file`（参考视频）、`4/audio`（驱动音频） |
| 8 | image | 无 |
| 9 | video | 1 × 参考视频 → OSS HTTPS |
| 10 | audio | 1 × 驱动音频 → OSS HTTPS（可先 TTS） |
| 11 | prompt | 强制空 |
| 12 | duration | 不进 RH |
| 13 | resolution / aspect | 无 |
| 14–15 | 其他 | `instanceType: plus`，`usePersonalQueue: false` |
| 16 | SKU | **唯一** `hey-gem-plus` |
| 17 | OTS | `hey-gem-plus` base=0.1 × mult=10 × rate=10 → **10 元宝** |
| 18 | 计费 | 固定档（Quantity=1） |
| 19–20 | Poll / Result | `rhQueryPollVideo` → mp4 |
| 21 | Refund | Direct：`hey_gem_failed`；Queue：统一 refund |
| 22 | UI 入口 | 独立 `heyGemStandalone` 模块 + `VideoInputPanel` |
| 23 | Direct fallback | 迁移前存在；现硬拒绝 |
| 24 | 特殊鉴权 | 无额外头；走 FC→RH 标准转发 |

### hey-gem vs 最接近模型（ltx-2.3-lipsync / H3 Audio）

| 项 | ltx-2.3-lipsync | minimax-h3-audio | **hey-gem** |
|----|-----------------|------------------|-------------|
| 类别 | 图+音对口型 | 图+音口型 | **视频+音数字人** |
| region | cn | cn | cn |
| appId | LTX lipsync | H3 audio | `2071200225913565185` |
| media | 1 图 + 1 音 | 1–5 图 + 1 音 | **1 视频 + 1 音** |
| prompt | 有 | 有 | **无** |
| SKU | 固定档 | 720p×时长档 | **hey-gem-plus** |
| Poll | cn mp4 | cn mp4 | cn mp4 |

**仅复用 Queue 架构与 OSS 预处理模式；不复制 nodeInfoList。**

---

## A. 原 Direct 链路

```
UI（HeyGem 模块 / TTS 可选）
  → VideoProvider
  → prepareWanAnimateVideoRemoteUrl + ensureAudioRemoteHg（OSS HTTPS）
  → rhPostChargeVideo POST /run/ai-app/2071200225913565185
  → rhQueryPollVideo → mp4 / Refund hey_gem_failed
```

---

## B. 新 Queue 链路

```
UI → isVideoQueueOnlyModel → nxCloudQueueGoldenPath
  → Gate：isCanvasHeyGemQueueGoldenPathInput（视频+音频）
  → Create 前：视频/音频 OSS HTTPS
  → buildHeyGemRhForward → /tasks/create
  → Claim → Charge → Forward → provider_task_id → Poll
  → Success / Refund + Slot Release
```

推进仅依赖 FC `run-queue-pipeline`。

---

## E. 改动文件

| 文件 | 变更 |
|------|------|
| `src/shared/videoQueueGoldenPath.ts` | `VIDEO_QUEUE_HEY_GEM_MODEL`、ONLY、Gate、`buildHeyGemRhForward` |
| `src/main/ai/providers/VideoProvider.ts` | Queue adapter；Direct 硬拒绝 |
| `src/renderer/components/Canvas/VideoInputPanel.tsx` | Queue-only 打标注释更新 |
| `scripts/test-phase9-10-hey-gem-queue.mjs` | Mock |
| `scripts/live-phase9-10-hey-gem-queue.mjs` | Live |
| `PHASE9_10_HEY_GEM_REPORT.md` | 本报告 |

---

## F. Queue-only / Gate

- 已入 `VIDEO_QUEUE_ONLY_MODEL_IDS`
- 主进程强制 `queueForcedInput`
- Gate：`referenceVideoUrl` + `inputAudioUrl`；排除 drama/director
- Direct：`hey-gem 已强制云端排队，禁止 Direct…`
- **无** Queue → Direct fallback
- TTS 入口仍在 UI Create 前；**不**走 RH Direct

---

## G. Provider 参数

与 Direct 一致：path、nodeInfoList `1/file`+`4/audio`、plus、rhRegion=cn。无 prompt/duration/resolution。

---

## H. 媒体预处理

Create 前一次性完成：

- 视频：`prepareWanAnimateVideoRemoteUrl` → HTTPS OSS  
- 音频：OSS / 下载转传 / local-resource / data URL → HTTPS OSS  

Forward 持久化 HTTPS URL；Poll/重试不重复不安全预处理。

---

## I. Mock

`scripts/phase9-10-hey-gem-queue-test-result.json` — **PASS 19/19**

---

## J. Live

`scripts/phase9-10-hey-gem-live-e2e-result.json`

**SKU：** `hey-gem-plus`（唯一 / 最低成本）= **10 元宝**

| 字段 | 值 |
|------|-----|
| task_id | `45a40b0f-bfaa-4344-b908-277525b730a0` |
| queue_entered_at | `1788783298000` |
| claimed_at | `1788783295580` |
| charged_at | `1788783328207` |
| provider_task_id | `2096935395232280577` |
| execution_stage | `done` |
| completed_at | `1788783414685` |
| status | `success` |
| actual_charge | `10` |
| slots | released |

**Live：PASS**（仅 FC pipeline，不依赖客户端）

---

## K. provider_task_id

`2096935395232280577`

---

## L. Charge

quoted=10，actual=10，`charged`

---

## M. Refund

可控失败 PASS（bal 500 不变；重复 poll 不重复加余额）

---

## N / O. Slot Release

Live：user/platform occupied=0，held=false。失败路径亦释放。

---

## P. Direct fallback

Queue Adapter + Gate + VIDEO_QUEUE_ONLY + Direct 硬拒绝。无隐式 Direct 兜底。

---

## Q. Regression

| 检查 | 结果 |
|------|------|
| H3 Multi / Audio / Wan Animate / Wan Animate 2 / Upscaler Queue-only | PASS（静态） |
| Queue Core / Timer / runQueuePipeline | 未改 |
| 已 PASS 模型 Direct fallback | 无新增回落 |

---

## R. ACTIVE 模型扫描结果（仅审计，不迁移）

依据：`VIDEO_QUEUE_ONLY_MODEL_IDS`、`VideoInputPanel` 候选、`videoModelUiPolicy`、`VideoProvider.retiredVideoModels`。

### 已 Queue-only（Adapter 完成）

`rhart-video-x`, `minimax-h3-t2v/i2v/multi/audio`, `ltx-2.3-t2v/i2v/lipsync`, `gemini-omni-flash`, `rh-video-start-end`, `rhart-v3.1-pro-se`, `seedance-2.0-fast/mini`, `wan-animate`, `wan-animate-2`, `rhart-video-upscaler`, **`hey-gem`**

### 仍可能出现在类型/历史工程、但 Provider 已硬拒绝或 UI 下架（非本轮迁移目标）

Retired / 下架示例：`kling-*`, `wan-2.6*`, `hailuo-*`, `rhart-v3.1-fast*`, `grok-3`, `gemini-omni`, `ltx-2.3-msr-av`, `ltx-2.3-hdr-multi`, `rhart-video-g`

### UI 仍可见且已在 Queue-only 的主路径模型

文生/图生候选与独立模块：`ltx-2.3-t2v`, `minimax-h3-*`, `seedance-*`, `rhart-video-x`, `gemini-omni-flash`, `rhart-v3.1-pro-se`, `rh-video-start-end`, `ltx-2.3-lipsync/i2v`, `wan-animate(-2)`, `rhart-video-upscaler`, `hey-gem`（独立模块）

### 扫描结论

- 本轮目标模型中，**无残留可静默 Direct 的 hey-gem 路径**
- **不宣称「仓库内一切视频模型均已 Queue」**：类型联合与历史工程仍可能含已下架 id；它们走 Retired 错误，而非 Queue
- `sora-2` / `sora-2-pro` 受 `HIDE_SORA2_AND_SORA_CHARACTER_UI` 策略影响；**未在本轮迁移**
- Gate 排除：drama / director 旁路（与既有约定一致）

**未因扫描发现其他 Direct 模型而自动迁移。**

---

## 最终判定

**`hey-gem Queue Migration: PASS`**

**立即停止。** 不继续迁移 / 重构 Queue / Timer / 计费 / 并发。本轮模型迁移结束，等待验收。
