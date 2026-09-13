# Phase 9.6 — minimax-h3-multi Unified Queue 迁移报告

**结论：H3 Multi PASS**（Mock + Live 各 1 轮成功）  
**状态：本阶段停止改码；待确认后开始 H3 Audio**

未改动：Queue Core / Phase 4/5/6 / Cloud Timer / 已 PASS 模型 / wan-animate-2 / upscaler / hey-gem / H3 Audio。

---

## A. 原 Direct 调用链

```
UI (VideoInputPanel / Workspace)
  → IPC VideoProvider.execute
  → OSS 上传参考图（0–9）+ 参考音（0–3，转码 MP3）
  → RH /media/upload/binary → fileName（openapi/…）
  → buildMinimaxH3MultiNodeInfoList（+ seal）
  → rhPostChargeVideo(/run/ai-app/2086289185186603010, .cn)
       instanceType=plus（803 再试 default）→ 双扣风险
  → 客户端 rhQueryPollVideo 轮询
  → SUCCESS / 失败 tryRefundFcForwardCharge
```

要点：计费走 Direct `billing=charge`；客户端是运行前提（提交+轮询）。

---

## B. 新 Queue 调用链

```
UI
  → Queue Gate（nxCloudQueueGoldenPath / VIDEO_QUEUE_ONLY）
  → VideoProvider.executeMinimaxH3MultiCloudQueueGoldenPath
       Create 前：同 Direct 的图/音预处理 + nodeInfoList
  → POST /tasks/create（execution_mode=queue + provider_forward_json）
  → Claim → Charge → Provider Forward（RH.cn ai-app）
  → Poll → Result → Release / Refund
```

Cloud Timer / `/internal/run-queue-pipeline` 可在断开客户端后推进；客户端不再是运行前提。

---

## C. 修改了哪些文件

| 文件 | 变更 |
|------|------|
| `src/shared/videoQueueGoldenPath.ts` | `VIDEO_QUEUE_H3_MULTI_MODEL`、列入 `VIDEO_QUEUE_ONLY`、Gate、`buildMinimaxH3MultiRhForward` |
| `src/main/ai/providers/VideoProvider.ts` | Queue 执行路径；Direct 分支改为硬拒绝 |
| `src/renderer/.../VideoInputPanel.tsx` | 无改（已有 `isVideoQueueOnlyModel` → `nxCloudQueueGoldenPath`） |
| `scripts/test-phase9-6-h3-multi-queue.mjs` | Mock |
| `scripts/live-phase9-6-h3-multi-queue.mjs` | Live（单 SKU） |

FC / Queue Core：**未改**。

---

## D. Queue Gate 是否已经强制

**是。**

- `minimax-h3-multi` ∈ `VIDEO_QUEUE_ONLY_MODEL_IDS`
- Provider 强制 `nxCloudQueueGoldenPath=true` 后走 Gate
- Gate：0–9 图；排除 `directorSpawned` / `drama`
- Direct 兜底：`已强制云端排队，禁止 Direct`
- `rhPostChargeVideo` 对 Queue-only billingId 抛 `QUEUE_ONLY_MODEL_DIRECT_FORBIDDEN`

---

## E. Provider 请求是否保持原行为

**是（Queue 侧固定 plus，不再 803 双提交）。**

| 项 | Direct | Queue |
|----|--------|-------|
| path | `/run/ai-app/2086289185186603010` | 同 |
| region | cn | cn |
| nodeInfoList | buildMinimaxH3MultiNodeInfoList | 同（Create 前） |
| megapixels | 0.9（720p） | 同 |
| duration | 6\|10\|15\|20 string | 同 |
| randomSeed / retainSeconds | true / 0 | 同 |
| instanceType | plus→default(803) | **仅 plus** |
| usePersonalQueue | false | `'false'`（与其它 Adapter 一致） |

SKU：`minimax-h3-multi-720p-{6\|10\|15\|20}s`

---

## F. Mock 结果

- 脚本：`scripts/test-phase9-6-h3-multi-queue.mjs`
- 结果：`scripts/phase9-6-h3-multi-queue-test-result.json`
- **conclusion: PASS**（22/22）
- 覆盖：forward 形状、时长 SKU、音槽、create→claim→charge→dispatch→poll→release、重复 charge/dispatch、submit/provider 失败退款+释槽、Gate/Queue-only

---

## G. Live 结果

- 脚本：`scripts/live-phase9-6-h3-multi-queue.mjs`
- 结果：`scripts/phase9-6-h3-multi-live-e2e-result.json`
- **conclusion: PASS**
- task：`af2ec7b5-5327-41ad-984b-6358e94d0953`
- 生命周期字段均已写入（见下）

| 字段 | 值 |
|------|-----|
| queue_entered_at | 1788777196689 |
| claimed_at | 1788777194455 |
| charged_at | 1788777206001 |
| provider_task_id | 2096909748019613698 |
| execution_stage | done |
| completed_at | 1788777479452（finished_at） |
| status | success |

---

## H. 扣费金额

- SKU：`minimax-h3-multi-720p-6s`
- quoted / actual：**8**
- charge_status：`charged`（1 次，无重复退款）

---

## I. provider_task_id

`2096909748019613698`（RH.cn）

---

## J. 槽位是否释放

**是。** `user_slot_held=false`，`platform_slot_held=false`，user/platform occupied=0。

---

## K. 是否存在 Direct 回落

**否（画布路径）。**

- VIDEO_QUEUE_ONLY + Gate early-return + Direct 硬拒绝 + `rhPostChargeVideo` 守卫
- 导演/短剧（`directorSpawned`/`drama`）仍被 Gate 排除；若走旧 Direct 会报错而非静默回落

---

## 备注

- 结果 URL 示例见 live result JSON。
- **下一阶段：H3 Audio**（需你确认后再改码）。
