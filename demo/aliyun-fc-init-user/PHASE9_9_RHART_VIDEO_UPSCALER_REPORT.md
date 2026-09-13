# PHASE 9.9 — rhart-video-upscaler → Unified Queue Migration Report

**结论：`rhart-video-upscaler Queue Migration: PASS`**

本阶段仅迁移 `rhart-video-upscaler`。未改 Queue Core / Cloud Timer / Claim / Charge。未动 H3 Multi / H3 Audio / Wan Animate / Wan Animate 2。**未触碰 `hey-gem`。**

---

## C. 审计结果（先于改代码）

### 类别判定

**视频处理 / 超分（video processing / upscale）**，不是 T2V/I2V 视频生成。

依据：输入为已有视频；RH OpenAPI body 仅 `{ videoUrl, targetResolution }`；无 prompt 生成语义；无 `nodeInfoList` / ai-app。

### Direct 链路清单

| # | 项 | 值 |
|---|----|-----|
| 1 | modelId | `rhart-video-upscaler` |
| 2 | Provider | `VideoProvider` |
| 3 | RH region | `cn`（OpenAPI v2 → runninghub.cn） |
| 4 | API path | `/rhart-video/video-upscaler` |
| 5 | appId | **无**（非 ai-app） |
| 6 | nodeInfoList | **无**；JSON body `{ videoUrl, targetResolution }` |
| 7 | 输入视频 | 恰好 1 条参考视频；`prepareWanAnimateVideoRemoteUrl` → OSS HTTPS |
| 8 | 输出分辨率 | UI `targetResolution`：`720p`/`1080p`/`2k`/`4k`（写入 RH body） |
| 9 | prompt | UI 强制空；不进 RH |
| 10 | duration → RH | **不参与请求** |
| 11 | duration → 计费 | **仅计费**：Quantity=`max(floor(sec), 5)`，最长 10 分钟 |
| 12 | SKU | `rhart-video-upscaler-{720p\|1080p\|2k\|4k}` |
| 13 | OTS | 每秒 `base_price`；Live 见 720p：0.14×2×10×qty |
| 14 | 计费 | Cost = base × multiplier × yuanbao_rate × Quantity |
| 15 | Poll | `rhQueryPollVideo` / Queue poll（prefer mp4） |
| 16 | Result | SUCCESS → mp4 URL |
| 17 | Refund | Direct：`rhart_video_upscaler_failed`；Queue：统一 refund |
| 18 | 入口 | `VideoInputPanel` / `Workspace` / `VideoNode` 价格条 |
| 19 | Direct fallback | 迁移前存在；迁移后 **硬拒绝** |

### 与最接近模型差异（vs wan-animate / seedance OpenAPI）

| 项 | wan-animate | seedance-2.0-fast | **rhart-video-upscaler** |
|----|-------------|-------------------|--------------------------|
| 类别 | 角色替换生成 | 多模态生成 | **超分处理** |
| region | cn | cn | cn |
| appId | 有 | 无 | **无** |
| path | `/run/ai-app/...` | multimodal OpenAPI | `/rhart-video/video-upscaler` |
| method | POST | POST | POST |
| body | nodeInfoList | prompt+images… | **`{videoUrl,targetResolution}`** |
| input | 1 图 + 1 视频 | 0–9 图 | **仅 1 视频** |
| output res | RH 节点 720/1080 | resolution 字段 | **targetResolution 四档** |
| duration | clip 节点 | RH duration | **不进 RH，仅计费** |
| prompt | 强制空 | 必填 | 空（不发送） |
| SKU | `wan-animate-{res}-{Ns}` | seedance 档位 | `rhart-video-upscaler-{res}` |
| Poll/Result | cn + mp4 | cn + mp4 | cn + mp4 |

**仅复用：** Unified Queue 架构、OSS HTTPS 视频预处理、cn poll/settle/refund/slot。  
**不复用：** ai-app / nodeInfoList / 生成类 prompt·duration 语义。

---

## A. 原 Direct 链路

```
UI → VideoProvider
  → prepareWanAnimateVideoRemoteUrl（OSS HTTPS）
  → 探测时长（上限 10min；计费用）
  → rhPostChargeVideo POST /rhart-video/video-upscaler { videoUrl, targetResolution }
  → rhQueryPollVideo
  → Result mp4 / Refund rhart_video_upscaler_failed
```

---

## B. 新 Queue 链路

```
UI → isVideoQueueOnlyModel → nxCloudQueueGoldenPath
  → Gate：isCanvasRhartVideoUpscalerQueueGoldenPathInput
  → Create 前：视频 OSS + mediaDurationSec 归一（min 5）
  → buildRhartVideoUpscalerRhForward → /tasks/create
  → Claim → Charge → Provider Forward
  → provider_task_id → Poll → Success / Refund + Slot Release
```

推进依赖 FC `run-queue-pipeline`，**不依赖客户端**。

---

## D. 改动文件

| 文件 | 变更 |
|------|------|
| `src/shared/videoQueueGoldenPath.ts` | `VIDEO_QUEUE_RHART_VIDEO_UPSCALER_MODEL`、ONLY 列表、Gate、`buildRhartVideoUpscalerRhForward` |
| `src/main/ai/providers/VideoProvider.ts` | Queue adapter；Direct 硬拒绝 |
| `src/renderer/components/Canvas/VideoInputPanel.tsx` | 注释：仅 hey-gem 仍 Direct |
| `scripts/test-phase9-9-rhart-video-upscaler-queue.mjs` | Mock |
| `scripts/live-phase9-9-rhart-video-upscaler-queue.mjs` | Live |
| `PHASE9_9_RHART_VIDEO_UPSCALER_REPORT.md` | 本报告 |

---

## E. Queue-only / Gate

- 已入 `VIDEO_QUEUE_ONLY_MODEL_IDS`
- 主进程 `queueForcedInput` 强制 flag
- Gate：非空 `referenceVideoUrl`；排除 drama/director
- Direct：`rhart-video-upscaler 已强制云端排队，禁止 Direct…`
- **禁止** Queue → Direct fallback
- `hey-gem` **不在** ONLY 列表

---

## F. Provider 参数

与 Direct 一致：

- path `/rhart-video/video-upscaler`，method POST，rhRegion=`cn`
- body：`{ videoUrl: HTTPS, targetResolution }`
- **无** nodeInfoList / instanceType / prompt / duration
- 计费：`billingModelId` + `nodeData.mediaDurationSec`（Quantity）

---

## G. Mock

`scripts/phase9-9-rhart-video-upscaler-queue-test-result.json`

**PASS 22/22**

覆盖：forward、分辨率 SKU、OSS HTTPS、duration 不进 RH、Create/Claim/Charge/Dispatch/`provider_task_id`、Poll、Success+Slot、幂等、失败退款、timeout/unknown、Gate/Queue-only、hey-gem 未迁移、H3/Wan 回归。

---

## H. Live

`scripts/phase9-9-rhart-video-upscaler-live-e2e-result.json`

**SKU：** `rhart-video-upscaler-720p` × 5s → **14 元宝**  
**推进：** 仅 FC `run-queue-pipeline`

| 字段 | 值 |
|------|-----|
| task_id | `7e36593a-9117-413b-987a-e4b1a33a1e2b` |
| queue_entered_at | `1788782470294` |
| claimed_at | `1788782467838` |
| charged_at | `1788782483784` |
| provider_task_id | `2096931890165862401` |
| execution_stage | `done` |
| completed_at | `1788782598587` |
| status | `success` |
| actual_charge | `14` |
| slots | user/platform released |

**Live：PASS**

---

## I. provider_task_id

`2096931890165862401`

---

## J. Charge

quoted=14，actual_charge=14，`charge_status=charged`

---

## K. Refund

可控失败 `failure_refund=PASS`（bal 500→500→500；重复 poll 不重复加余额）

---

## L. Slot Release

Live success：occupied=0，held=false。失败路径 slot 释放。

---

## M. Direct fallback

Queue-only + Direct 硬拒绝 + Mock 拦截 PASS。

---

## N. Regression

| 检查 | 结果 |
|------|------|
| H3 Multi / Audio Queue-only | PASS |
| Wan Animate / Wan Animate 2 Queue-only | PASS |
| Queue Core / Cloud Timer | 未改 |
| hey-gem | 仍 Direct，未迁移 |
| 已 PASS 模型 Direct fallback | 无新增回落 |

---

## 最终判定

**`rhart-video-upscaler Queue Migration: PASS`**

**停止。** 不继续 `hey-gem` 或其他模型。等待验收。
