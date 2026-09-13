# AIXFLOW ACTIVE MODEL QUEUE AUDIT

> **阶段：第一步 + 第二步（全量审计 + 模型总账）**  
> **日期：2026-09-07**  
> **原则：不凭 Adapter 存在判定完成；以真实调用链为准。**  
> **本阶段不修改业务代码、不开始迁移。**

---

## 0. 审计方法（证据来源）

| 层 | 文件 / 入口 |
|----|-------------|
| 视频 ACTIVE / 下架 | `src/renderer/config/videoModelUiPolicy.ts` |
| 视频 UI 目录 | `src/renderer/components/Canvas/VideoInputPanel.tsx`（`availableModels` / `videoModelDropdownOptions` / Gate） |
| 图片 ACTIVE | `src/renderer/config/imageModelUiPolicy.ts` |
| Queue Gate + Adapter builders | `src/shared/videoQueueGoldenPath.ts` |
| 视频执行分流 | `src/main/ai/providers/VideoProvider.ts`（`executeVideoCloudQueueGoldenPath` vs `rhPostChargeVideo`） |
| 图片执行 | `src/main/ai/providers/ImageProvider.ts`（`ensureLedgerImageTask` + `rhPostCharge`，`billing=charge`） |
| Create 语义 | `demo/aliyun-fc-init-user/lib/handleTasksCreate.mjs`（`execution_mode=queue` vs `legacy`） |
| 客户端 Create | `src/main/services/aliyunService.ts` → `nxCloudTasksCreate` |

### 判定规则（本报告）

```text
FULL_QUEUE_CHAIN =
  UI → nxCloudQueueGoldenPath=true
  → VideoProvider early-return Queue 路径
  → nxCloudTasksCreate(execution_mode=queue)
  → nx_tasks status=queued
  → Claim → Charge → Dispatch → Provider → Poll → Release/Refund
```

若仍可走：

```text
UI → VideoProvider → rhPostChargeVideo(billing=charge) → FC run-task → Provider
```

则标记为 **NOT FULLY MIGRATED**（存在 Legacy Direct 旁路），即使已有 Queue Adapter。

若仅有 Queue 代码、未去掉 Direct，状态 = **QUEUE_CODE_WITH_DIRECT_FALLBACK**。

---

## 1. 总体状态（ACTIVE 生成模型）

### 1.1 汇总

| 类别 | 数量 | 说明 |
|------|------|------|
| **视频 ACTIVE（用户可触达）** | **18** | 见下表；不含已 RETIRED |
| **图片 ACTIVE** | **7** | 全部 Legacy Direct / legacy precharge |
| **音频生成（顺带）** | 多款 | 全部 Legacy；本阶段非迁移重点，记入旁路 |
| Queue 主路径代码已具备（视频） | **13 个型号/能力** | 见 §2；**仍保留 Direct 回落** |
| Queue Live 曾 PASS / 冻结 | ~11 | 以历史 Phase 报告为准；**不等于「不能绕过」** |
| 明确无 Queue Adapter（视频 ACTIVE） | **5** | multi / audio / wan-animate-2 / upscaler / hey-gem |
| 图片 Queue | **0** | 全部 `legacy` Create 或 `billing=charge` |
| 发现双路径风险 | **是** | Queue 型号未设 Gate 时静默 Direct（用户实测 `minimax-h3-t2v` 已证实） |

### 1.2 一句话结论

> **AIXFLOW 尚未做到「所有 ACTIVE 视频/图片生成都强制统一 Queue」。**  
> 约一半视频能力已有 Queue Adapter + Gate，但 Direct（`rhPostChargeVideo`）仍在同一 `VideoProvider` 内可达；全部图片与 5 个视频 ACTIVE 型号仍为 Legacy Direct。

---

## 2. AIXFLOW ACTIVE MODEL QUEUE AUDIT 总账

```text
总 ACTIVE 视频型号（用户可生成）：18
总 ACTIVE 图片型号：7
Queue 主路径代码已完成（视频）：13
Queue 未完成 / 无 Adapter（视频）：5
图片统一 Queue：0
Legacy Direct 入口仍存在：是（VideoProvider + ImageProvider）
发现未知第二套 Queue：否（未见独立私有队列；图片为 legacy pending 预扣费，非 Unified Queue）
绕过 Queue 的入口：rhPostChargeVideo / rhPostCharge / rhPostChargeAudio + tasks/create legacy
```

---

## 3. 完整表格（视频 ACTIVE）

| Model | UI | ACTIVE | Input | 真实主路径（设计） | 统一Queue? | Provider | Region | Gate | Adapter | Direct仍在? | Live | Status | 下一步 |
|-------|-----|--------|-------|-------------------|------------|----------|--------|------|---------|-------------|------|--------|--------|
| `rhart-video-x` | 全能视频X | Y | T2V/I2V | Queue Create→Claim→Charge→RH | **条件是** | RH OpenAPI | **ai** | VideoInputPanel + shared | `buildRhartVideoX*` | **是** | PASS 史 | QUEUE_CODE_WITH_DIRECT_FALLBACK | 强制 Gate；删/封 Direct |
| `minimax-h3-t2v` | MiniMax-H3 文生 | Y | T2V | 同上 | **条件是** | RH ai-app/OpenAPI | **cn** | 同上 | `buildMinimaxH3T2v*` | **是** | 代码PASS；**用户 2026-09-07 实测 Direct** | NOT_FULLY_MIGRATED | 强制 Gate；回归 Live |
| `minimax-h3-i2v` | MiniMax-H3 图生 | Y | I2V | 同上 | **条件是** | RH | **cn** | 同上 | `buildMinimaxH3I2v*` | **是** | PASS 史 | QUEUE_CODE_WITH_DIRECT_FALLBACK | 强制 Gate |
| `ltx-2.3-t2v` | LTX2.3 文生 | Y | T2V | 同上 | **条件是** | RH | **ai** | 同上 | `buildLtx23T2v*` | **是** | PASS 史 | QUEUE_CODE_WITH_DIRECT_FALLBACK | 强制 Gate |
| `ltx-2.3-i2v` | LTX2.3 图生 | Y | I2V | 同上 | **条件是** | RH | **cn** | 同上 | `buildLtx23I2v*` | **是** | PASS 史 | QUEUE_CODE_WITH_DIRECT_FALLBACK | 强制 Gate |
| `rh-video-start-end` | LTX2.3 首位帧 | Y | Start-End | 同上 | **条件是** | RH ai-app | **cn** | 同上 | `buildRhVideoStartEnd*` | **是** | PASS 史 | QUEUE_CODE_WITH_DIRECT_FALLBACK | 强制 Gate |
| `rhart-v3.1-pro-se` | V3.1-pro 首尾帧 | Y | Start-End | 同上 | **条件是** | RH OpenAPI | **ai** | 同上 | `buildRhArtV31ProSe*` | **是** | PASS 史 | QUEUE_CODE_WITH_DIRECT_FALLBACK | 强制 Gate |
| `ltx-2.3-lipsync` | LTX2.3 对口型 | Y | LipSync | 同上 | **条件是** | RH ai-app | **cn** | 同上 | `buildLtx23Lipsync*` | **是** | PASS 史 | QUEUE_CODE_WITH_DIRECT_FALLBACK | 强制 Gate |
| `seedance-2.0-fast` | Seedance Fast | Y | T2V/多图 | 同上 | **条件是** | RH multimodal | **cn** | 同上 | `buildSeedance20Fast*` | **是** | PASS 史 | QUEUE_CODE_WITH_DIRECT_FALLBACK | 强制 Gate |
| `seedance-2.0-mini` | Seedance Mini | Y | Multi | 同上 | **条件是** | RH multimodal | **cn** | 同上 | `buildSeedance20Mini*` | **是** | PASS 史 | QUEUE_CODE_WITH_DIRECT_FALLBACK | 强制 Gate |
| `wan-animate` | WanAnimate 角色替换 | Y | 图+视频 | 同上 | **条件是** | RH ai-app | **cn** | 同上 | `buildWanAnimate*` | **是** | Live 曾过；Regression 未正式冻结 | QUEUE_CODE_WITH_DIRECT_FALLBACK | 强制 Gate；补 Regression |
| `gemini-omni-flash` | 全能视频 Omni Flash | Y | I2V(1/3图) | 同上 | **条件是** | RH OpenAPI | **ai** | 同上 | `buildGeminiOmniFlash*` | **是** | Mock PASS；Live **BLOCKED_EXTERNAL** | NEEDS_REVIEW | 外部余额；强制 Gate |
| `minimax-h3-multi` | MiniMax H3 全能参考 | Y | Multi | **LEGACY DIRECT** | **否** | RH ai-app | cn | **无** | **无** | 是（唯一路径） | Direct 成功（用户流水） | **NEEDS_ADAPTER** | 写 Adapter+Gate+测 |
| `minimax-h3-audio` | MiniMax H3 口型 | Y | Audio/Lip | **LEGACY DIRECT** | **否** | RH | cn | **无** | **无** | 是 | — | **NEEDS_ADAPTER** | 迁移 |
| `wan-animate-2` | Wan animate2 换人 | Y | 图+视频 | **LEGACY DIRECT** | **否** | RH | cn | **无**（且 Gate 明确排除） | **无** | 是 | — | **NEEDS_ADAPTER** | 迁移（勿误开 wan-animate） |
| `rhart-video-upscaler` | 视频超分 | Y | 视频 | **LEGACY DIRECT** | **否** | RH | ? | **无** | **无** | 是 | — | **NEEDS_ADAPTER** | 迁移 |
| `hey-gem` | HeyGem 数字人 | Y（独立节点） | 视频+音频 | **LEGACY DIRECT** | **否** | RH | ? | **无** | **无** | 是 | — | **NEEDS_ADAPTER** | 迁移 |
| `grok-3-stable` | Grok video3 plus | **边缘** | I2V | **QUEUE** | **是** | RH OpenAPI | **ai** | `VIDEO_QUEUE_GROK_3_STABLE_MODEL` | `buildGrok3StableRhForward` | **是** | Smoke PASS | **QUEUE_ONLY** | 旧节点走 Queue；禁 Direct |

> **注：** `sora-2` / 可灵 / 海螺 / Veo / grok-3 等在 `RETIRED_VIDEO_MODEL_IDS`，默认不计入 ACTIVE。

### 图片 ACTIVE（全部 NOT FULLY MIGRATED）

| Model | UI | ACTIVE | 真实路径 | 统一Queue? | Status |
|-------|-----|--------|----------|------------|--------|
| `rhart-image-g-2` | 全能图片 G-2.0 | Y | **QUEUE** | **是** | QUEUE_ONLY |
| `banana-2.0` | 全能图片 V2 | Y | **QUEUE** | **是** | QUEUE_ONLY |
| `youchuan-text-to-image-v81` | 悠船 v8.1 | Y | **QUEUE** | **是** | QUEUE_ONLY |
| `seedream-v5` | Seedream v5 | Y | **QUEUE** | **是** | QUEUE_ONLY |
| `z-image` | Z-image | Y | **QUEUE** | **是** | QUEUE_ONLY |
| `lens` | Lens | Y | **QUEUE** | **是** | QUEUE_ONLY |
| `flux2-klein` | Flux2 Klein | Y | **QUEUE** | **是** | QUEUE_ONLY |

图片 Create **默认不传** `execution_mode=queue` → FC `handleTasksCreate` 走 **legacy 预扣费 + pending**，再由 Provider `billing=none` 或直 `charge` 调 RH。**不是** Unified Queue（无 Claim 槽位语义）。

---

## 4. 真实调用链（证据级）

### 4.1 Queue 目标链（已实现于部分视频）

```text
VideoInputPanel
  → payload.nxCloudQueueGoldenPath = true   // 仅当 isVideoQueueGoldenPathEnabledRenderer()
  → VideoProvider.execute(...)
  → isCanvasXxxQueueGoldenPathInput(...)    // 要求 nxCloudQueueGoldenPath===true
  → executeXxxCloudQueueGoldenPath
  → executeVideoCloudQueueGoldenPath
  → nxCloudTasksCreate({ execution_mode: 'queue', provider_forward_json })
  → FC handleTasksCreate mode=queue → status=queued, charged=false
  → promote/claim → charge → dispatch → poll → settle/release
```

**证据文件：**

- Gate：`VideoInputPanel.tsx` ~3118–3146  
- Provider 早退：`VideoProvider.ts` ~3040–3265 + `executeVideoCloudQueueGoldenPath` ~1182+  
- Create：`aliyunService.ts` `nxCloudTasksCreate`；`handleTasksCreate.mjs` `execution_mode=queue`

### 4.2 Legacy Direct（视频）

```text
VideoInputPanel（未设 nxCloudQueueGoldenPath 或型号无 Gate）
  → VideoProvider 落入后半段分支
  → rhPostChargeVideo(..., billing='charge')
  → FC run-task / forward
  → RunningHub
  → 客户端轮询
```

**证据：** `VideoProvider.ts` 大量 `rhPostChargeVideo`（约 4083+ 行起，含 multi/audio/wan-animate-2/upscaler/hey-gem/以及 Queue 型号回落）。

**用户实证（2026-09-07）：**

- 流水：`minimax-h3-t2v-720p-6s` / task `64469765-e32f-450f-bf03-1e1b249f3f9c`
- OTS：`prompt_json.forward=/run/ai-app/...`，无 `queue_entered_at` / `execution_stage` / `provider_task_id`  
→ **判定：LEGACY DIRECT，非 Queue。**

### 4.3 Legacy 图片

```text
ImageInputPanel → ImageProvider
  → ensureLedgerImageTask → nxCloudTasksCreate(无 execution_mode=queue) → legacy pending
  → rhPostCharge(..., billing=none|charge)
  → RunningHub
```

---

## 5. Legacy Direct 清单（必须迁移 / 封堵）

| 模型 | 旧入口 | 旧调用 | 为何绕过 Queue | 需改位置 |
|------|--------|--------|----------------|----------|
| `minimax-h3-multi` | VideoInputPanel 默认多模态首选之一 | `rhPostChargeVideo` + H3 Multi body | 无 Gate/Adapter | VideoInputPanel Gate；`videoQueueGoldenPath` Adapter；VideoProvider early-return；删 Direct |
| `minimax-h3-audio` | 图+音下拉 | 同上 | 无 Gate/Adapter | 同上 |
| `wan-animate-2` | 图+视频自动切到 animate2 | 同上 | Gate 仅 `wan-animate` | 新 Adapter；勿破坏 animate1 / Seedance 视频预处理 |
| `rhart-video-upscaler` | 有参考视频时上架 | 同上 | 无 Adapter | 同上 |
| `hey-gem` | 独立 HeyGem 节点 | 同上 | 无 Adapter | 同上 |
| 全部 ACTIVE 图片 | ImageProvider | `rhPostCharge` / legacy Create | 从未接入 Unified Queue | Image 侧 Gate + Create queue + Adapter；或明确「图片不进视频队列」产品决策 |
| 已有 Adapter 的 12+ 视频 | 同文件后半 Direct | `rhPostChargeVideo` | Gate 关 / 未打标则静默 Direct | **强制** `nxCloudQueueGoldenPath` 或移除 Direct 分支 |

---

## 6. 风险清单

### 高风险

1. **双路径静默回落**：Queue 型号可无标记走 Direct → 计费时机、并发槽、幂等与 Queue 不一致（已发生）。  
2. **图片 100% 不进 Unified Queue**：平台/用户视频并发与图片扣费模型分裂。  
3. **Provider timeout 双创建**：Direct 路径历史风险；Queue 有 UNKNOWN 机制，Direct 需单独审计。  
4. **wan-animate vs wan-animate-2**：UI 自动偏好 animate2（Direct），用户以为「Wan 已排队」。

### 中风险

5. `gemini-omni-flash` Live 外部阻塞，易被当成「Queue 坏了」。  
6. `grok-3-stable` ACTIVE 边界不清。  
7. Gate 依赖 env（已改默认 on，但安装包/旧构建可能仍关）。  
8. Wan Animate Regression 未正式 FROZEN。

### 低风险

9. RETIRED 型号代码残留 Direct（用户不可达，可后续清理）。  
10. 音频/TTS 仍 Direct（若本轮范围含「所有生成」则升级为高）。

---

## 7. 第三阶段迁移优先级（仅建议，本阶段不执行）

```text
P0  封堵：已有 Adapter 的视频型号禁止 rhPostChargeVideo 回落
P1  Adapter：minimax-h3-multi、minimax-h3-audio
P2  Adapter：wan-animate-2、rhart-video-upscaler、hey-gem
P3  图片 ACTIVE 全量进 Unified Queue（或产品书面排除）
P4  清理 RETIRED Direct；补全 Live/异常矩阵与回归
```

---

## 8. 验收对照（当前是否满足最终条件）

| # | 条件 | 当前 |
|---|------|------|
| 1 | 所有 ACTIVE 生成进统一 Queue | **否** |
| 2 | 无 UI→Provider Direct | **否** |
| 3 | 无第二套私有 Queue | **是**（未见） |
| 4 | 每模型明确 Adapter | **否** |
| 5 | Phase 6 计费 | Queue 路径是；Direct 为 charge/legacy |
| 6 | 统一并发 | 仅 Queue Claim 路径 |
| 7 | Timeout 不双创建 | Queue 有设计；Direct 未本阶段证明 |
| 8 | PASS 回归不退化 | 迁移时必须守住 |
| 9 | 核心 Live | 部分有；全量未完成 |
| 10 | 一眼看清是否还有绕过 | **本报告：仍有大量绕过** |

---

## 9. 下一步（待你确认后进入第三步）

本文件为 **审计冻结点**。确认后按：

```text
第三步：封堵已 Adapter 型号的 Direct
第四步：逐个 NEEDS_ADAPTER 迁移
第五步起：Mock → Live → 异常 → 回归 → 更新本报告终态
```

**在你确认前，不开始大规模改代码。**

---

## 10. P0 完成：封堵已 Adapter 型号 Direct 回落（2026-09-07）

### 范围
仅封堵 `VIDEO_QUEUE_ONLY_MODEL_IDS`（12 个已有 Adapter 型号）。**未**迁移 multi / audio / wan-animate-2 / upscaler / hey-gem；**未**改图片。

### 修改入口

| 文件 | 改动 |
|------|------|
| `src/shared/videoQueueGoldenPath.ts` | 新增 `VIDEO_QUEUE_ONLY_MODEL_IDS`、`isVideoQueueOnlyModel`、`assertNotDirectChargeForQueueOnlyModel` |
| `src/main/ai/providers/VideoProvider.ts` | Queue 判定强制 `nxCloudQueueGoldenPath=true`；未命中 Queue 分支的 only 型号 **ERROR 返回**，禁止落入 Direct |
| `src/main/utils/runningHubFcHelpers.ts` | `rhPostChargeVideo`：若 `billingModelId` 属于 only 型号前缀 → 抛 `QUEUE_ONLY_MODEL_DIRECT_FORBIDDEN` |
| `src/renderer/components/Canvas/VideoInputPanel.tsx` | only 型号一律打 `nxCloudQueueGoldenPath=true` |

### 如何证明无法绕过 Queue

1. **重启桌面端**后跑 `minimax-h3-t2v`（无图）一次。  
2. UI 应出现「任务已提交云端队列… / 排队中…」。  
3. 管理员后台查 task：应有 `queue_entered_at` / `execution_stage`；`prompt_json` **不应**再是仅 `/run/ai-app/...` 的 Direct 形态。  
4. 若人为关掉 `VIDEO_QUEUE_ENABLED=0`：应 **报错**，而不是偷偷 Direct 成功。  
5. 代码层：`rhPostChargeVideo({ billingModelId: 'minimax-h3-t2v-720p-6s' })` 会直接抛错。

### Queue-only 型号清单
`rhart-video-x`、`minimax-h3-t2v`、`minimax-h3-i2v`、`ltx-2.3-t2v`、`ltx-2.3-i2v`、`gemini-omni-flash`、`rh-video-start-end`、`rhart-v3.1-pro-se`、`ltx-2.3-lipsync`、`seedance-2.0-fast`、`seedance-2.0-mini`、`wan-animate`
