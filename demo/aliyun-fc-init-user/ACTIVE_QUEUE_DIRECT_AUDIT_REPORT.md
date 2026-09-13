# AIXFLOW ACTIVE 模型与 Queue / Direct 残留总审计报告

**审计性质：** 只读代码审计（本轮未修改任何业务代码 / 配置 / 数据库 / FC / Queue Core）  
**审计日期：** 2026-09-07  
**审计范围：** 全项目（桌面端 `src/` + 云端 `demo/aliyun-fc-init-user/`）  
**证据基线：** `videoQueueGoldenPath.ts`、`VideoProvider.ts`、`VideoInputPanel.tsx`、`videoModelUiPolicy.ts`、`runningHubFcHelpers.ts`、`QUEUE_CLOUD_TIMER_REPORT.md`、Phase 9.x Live 报告

---

## 1. Executive Summary

用普通人能听懂的话：

当前**普通用户在画布上能点到的视频模型，已经全部走统一云端 Queue**（创建任务 → 排队 → 扣费 → 提交 RunningHub → 轮询结果 → 释放/退款）。  
**没有发现「Queue 失败后偷偷改走 Direct」这条活路。**  
客户端关掉之后，已经进 Queue 的任务仍可由阿里云 FC Timer 每分钟推进（有独立验收证据）。

| 维度 | 数量 / 结论 |
|------|-------------|
| ACTIVE 视频模型（正常 UI 可选） | **17** |
| 其中 QUEUE | **17** |
| 其中 DIRECT（正常 UI） | **0** |
| 遗留可触发 Direct 的视频型号（非正常下拉） | **1**（`grok-3-stable`，旧工程节点） |
| SPECIAL（图片 / 音频 / TTS 等，非视频统一 Queue） | 图片 **7** + 音频若干（见 §4/§5） |
| RETIRED 视频型号（策略下架） | **16**（`RETIRED_VIDEO_MODEL_IDS`） |
| UNKNOWN（无法判定 ACTIVE） | **0**（本轮关键入口均可归类） |
| Queue → Direct fallback | **未发现** |
| ACTIVE 视频模型绕过 Queue | **未发现**（Queue-only 硬拒绝 + Direct 入口守卫） |
| 第二套生产级 Queue | **未发现** |
| 客户端必须在线才能推进 Queue | **否**（FC Timer 已部署并通过验收） |
| 整体风险等级 | **中低**（视频 Queue 主路径稳健；Direct 死代码与图片/音频旧路径为债务） |

**结论预告：** 视频侧可进入「真实 Queue 体验 + 人工验收」→ **GO**（见文末 Q8）。

---

## 2. ACTIVE 模型总表

### 2.1 视频（普通用户可选用）

| Model | UI | ACTIVE | Queue/Direct | Gate | Create | Charge | Provider | Poll | Release/Refund | Live Evidence |
|-------|----|--------|--------------|------|--------|--------|----------|------|----------------|---------------|
| rhart-video-x | 是（T2V/I2V） | 是 | QUEUE | 是 | `/tasks/create` `execution_mode=queue` | Queue Claim 后 | RH `.ai` | FC Timer + 客户端 UX poll | 云端 | Phase 8.1 / 9.3-D |
| minimax-h3-t2v | 是 | 是 | QUEUE | 是 | 同上 | 同上 | RH `.cn` | 同上 | 同上 | Phase 9.2 + Timer 验收 |
| minimax-h3-i2v | 是 | 是 | QUEUE | 是 | 同上 | 同上 | RH `.cn` | 同上 | 同上 | Phase 9.4 |
| minimax-h3-multi | 是 | 是 | QUEUE | 是 | 同上 | 同上 | RH `.cn` | 同上 | 同上 | Phase 9.6 |
| minimax-h3-audio | 是（图+音） | 是 | QUEUE | 是 | 同上 | 同上 | RH `.cn` | 同上 | 同上 | Phase 9.7 |
| ltx-2.3-t2v | 是 | 是 | QUEUE | 是 | 同上 | 同上 | RH `.ai` | 同上 | 同上 | Phase 9.3-B |
| ltx-2.3-i2v | 是 | 是 | QUEUE | 是 | 同上 | 同上 | RH `.cn` | 同上 | 同上 | Phase 9.5-B1 |
| ltx-2.3-lipsync | 是（图+音） | 是 | QUEUE | 是 | 同上 | 同上 | RH `.cn` | 同上 | 同上 | Phase 9.5-B5 |
| gemini-omni-flash | 是 | 是 | QUEUE | 是 | 同上 | 同上 | RH `.ai` | 同上 | 同上 | Phase 9.5-B2 |
| rh-video-start-end | 是（双图） | 是 | QUEUE | 是 | 同上 | 同上 | RH `.cn` | 同上 | 同上 | Phase 9.5-B3 |
| rhart-v3.1-pro-se | 是（首尾帧） | 是 | QUEUE | 是 | 同上 | 同上 | RH `.ai` | 同上 | 同上 | Phase 9.5-B4 |
| seedance-2.0-fast | 是 | 是 | QUEUE | 是 | 同上 | 同上 | RH `.cn` OpenAPI | 同上 | 同上 | Phase 9.5-B6 |
| seedance-2.0-mini | 是 | 是 | QUEUE | 是 | 同上 | 同上 | RH `.cn` OpenAPI | 同上 | 同上 | Phase 9.5-B7 |
| wan-animate | 是 / 独立节点 | 是 | QUEUE | 是 | 同上 | 同上 | RH `.cn` ai-app | 同上 | 同上 | Phase 9.5-B8 |
| wan-animate-2 | 是 | 是 | QUEUE | 是 | 同上 | 同上 | RH `.cn` ai-app | 同上 | 同上 | Phase 9.8 |
| rhart-video-upscaler | 是（纯参考视频 / 超分入口） | 是 | QUEUE | 是 | 同上 | 同上 | RH `.cn` OpenAPI | 同上 | 同上 | Phase 9.9 |
| hey-gem | 是（独立 HeyGem 节点） | 是 | QUEUE | 是 | 同上（Create 前 TTS） | 同上 | RH `.cn` ai-app | 同上 | 同上 | Phase 9.10 |

### 2.2 遗留 Direct 视频（非正常下拉）

| Model | UI | ACTIVE | Queue/Direct | 说明 |
|-------|----|--------|--------------|------|
| grok-3-stable | **否**（标签仍在代码；下拉不主动列出） | **条件 ACTIVE**：旧工程节点可保留并生成 | **DIRECT** | 不在 `VIDEO_QUEUE_ONLY`、不在 `RETIRED_VIDEO_MODEL_IDS`；`VideoProvider` 仍走 `rhPostChargeVideo` |

### 2.3 图片 ACTIVE（非视频统一 Queue）

| Model | UI | 类型 | 路径摘要 |
|-------|----|------|----------|
| rhart-image-g-2 | 是 | SPECIAL | `ImageProvider` → 可选 `/tasks/create` 预扣 → FC forward RH（失败可回退 run-task 内扣） |
| banana-2.0 | 是 | SPECIAL | 同上 |
| youchuan-text-to-image-v81 | 是 | SPECIAL | 同上 |
| seedream-v5 | 是 | SPECIAL | 同上 |
| z-image | 是 | SPECIAL | 同上 |
| lens | 是 | SPECIAL | 同上 |
| flux2-klein | 是（仅图生） | SPECIAL | 同上 |

### 2.4 音频 ACTIVE（摘要）

| Model / 入口 | UI | 类型 | 说明 |
|--------------|----|------|------|
| rhart-song-v5.5 | 是 | SPECIAL | `AudioProvider` + `rhPostChargeAudio`；非视频 Queue |
| Doubao Seed TTS / MiniMax TTS 等 | 是 | SPECIAL | 预扣失败可回退 run-task 内扣；HeyGem 驱动音也走此类 TTS |

---

## 3. QUEUE 模型

权威清单：`src/shared/videoQueueGoldenPath.ts` → `VIDEO_QUEUE_ONLY_MODEL_IDS`（17 项）。

### 3.1 统一调用链（所有 QUEUE 视频模型共享）

```text
UI（VideoInputPanel / Workspace / HeyGem / Upscale）
  → payload.nxCloudQueueGoldenPath=true（UI 侧对 Queue-only 强制打标）
  → VideoProvider.generate
  → queueForcedInput.nxCloudQueueGoldenPath=true（主进程再强制）
  → 型号 Gate（isCanvas*QueueGoldenPathInput）
  → execute*CloudQueueGoldenPath
  → nxCloudTasksCreate({ execution_mode: 'queue', provider_forward_json })
  → 云端 nx_tasks：queued
  → FC Timer → run-queue-pipeline：Claim → Charge → Provider Forward → Poll → Result
  → Release / Refund（失败路径由 Queue Core 处理）
```

客户端 `nxCloudTaskStatus` 轮询：**仅 UX 进度**，不负责生产推进。

### 3.2 逐模型链路与 Direct fallback

以下每个模型均为：

```text
Direct fallback：NO
```

原因（代码实证，非猜测）：

1. Gate 命中 → `execute*CloudQueueGoldenPath` → `return`（不再进入 Direct 分支）  
2. Gate 未命中但 `isVideoQueueOnlyModel(model)` → **ERROR 返回**（`VideoProvider.ts` ~4280–4290）  
3. `/tasks/create` 失败 → `onStatus(ERROR)` + `return`（~1274–1280），**无** catch 后转 Direct  
4. `rhPostChargeVideo` 内 `assertNotDirectChargeForQueueOnlyModel`（`runningHubFcHelpers.ts`）— 即便漏网也会抛 `QUEUE_ONLY_MODEL_DIRECT_FORBIDDEN`

| 模型 | 链路要点 |
|------|----------|
| rhart-video-x | T2V/I2V 分 Gate；`.ai`；I2V Create 前 OSS |
| minimax-h3-t2v / i2v / multi / audio | `.cn`；multi/audio 支持多图/音槽 |
| ltx-2.3-t2v / i2v / lipsync | t2v `.ai`；i2v/lipsync `.cn` |
| gemini-omni-flash | `.ai` OpenAPI |
| rh-video-start-end | `.cn` 双图 |
| rhart-v3.1-pro-se | `.ai` OpenAPI 首尾帧 |
| seedance-2.0-fast / mini | `.cn` multimodal OpenAPI |
| wan-animate / wan-animate-2 | `.cn` ai-app；图+视频 |
| rhart-video-upscaler | 视频处理 OpenAPI；非生成类 |
| hey-gem | Create 前 TTS；数字人 ai-app；SKU `hey-gem-plus` |

### 3.3 Gate 与 drama / directorSpawned

各 `isCanvas*QueueGoldenPathInput` 在 `drama===true` 或 `directorSpawned===true` 时返回 false。  
但当前 `Workspace` 批量/单节点 `invokeAI` **未把** `nodeData.drama` 写入 payload（审计检索无 `payload.drama` / `nodeData.drama` 传递）。  
因此导演台生成的视频节点在正常运行路径上 **仍可命中 Queue Gate**；即便将来误传 drama，Queue-only 也会硬 ERROR，而不是 Direct。

---

## 4. DIRECT 模型

### 4.1 视频 Direct（仍可能被触发）

#### grok-3-stable

```text
旧工程节点 data.model=grok-3-stable
  → UI 下拉不主动提供，但「当前 model 不在列表则强制塞回选项」可保留
  → VideoProvider Direct 分支
  → rhPostChargeVideo（billing 非 Queue-only → 守卫不拦截）
  → RunningHub .ai
  → 客户端轮询结果
```

**为何仍是 Direct：** 未迁入 `VIDEO_QUEUE_ONLY_MODEL_IDS`，也未列入 `RETIRED_VIDEO_MODEL_IDS`。

### 4.2 隐藏但代码仍 Direct（正常 UI 不可选 / 会归一）

| 模型 | 状态 | Direct 代码 | 正常用户触发 |
|------|------|-------------|--------------|
| sora-2 / sora-2-pro | UI 隐藏（`HIDE_SORA2_AND_SORA_CHARACTER_UI`），运行时常归一到 `rhart-video-x` | 仍在 `VideoProvider` | 实质不可达（归一后走 Queue） |
| RETIRED 列表内型号 | 加载时 `normalizeVideoModelIfRetired` | 部分 Direct 分支仍在 | 归一后走 ACTIVE/Queue |

### 4.3 图片 / 音频（产品仍 ACTIVE，但非视频统一 Queue）

**为何仍是 Direct/SPECIAL：** 业务未迁入 `VIDEO_QUEUE_ONLY` / `run-queue-pipeline` 视频编排；计费多为 `/tasks/create` 预扣 + FC `billing=charge|none` 转发，或失败回退 run-task 内扣。  
这不是「视频 Queue 失败 fallback」，而是**另一条产品线路径**。

---

## 5. RETIRED / DEPRECATED

### 5.1 视频（`videoModelUiPolicy.ts`）

- kling-v2.6-pro、kling-video-o1、kling-video-o1-i2v、kling-video-o1-start-end、kling-video-o1-ref  
- wan-2.6、wan-2.6-flash  
- hailuo-02/2.3 t2v/i2v standard  
- rhart-v3.1-pro、rhart-v3.1-pro-official-i2v、rhart-v3.1-fast、rhart-v3.1-fast-se  
- grok-3、gemini-omni  
- ltx-2.3-msr-av、ltx-2.3-hdr-multi  

部分有 fallback 映射（如 fast-se → pro-se，msr-av → lipsync）。

### 5.2 Sora

`HIDE_SORA2_AND_SORA_CHARACTER_UI=true` — 视为产品侧停用，不应进入正式验收矩阵。

### 5.3 图片下架

nano-banana*、seedream-v4.5、youchuan v7、mj-v7、gpt-image-2、rhart-image-g / g-1.5 等。

### 5.4 音频下架

rhart-song（v5）、doubao-seed-tts-2.0。

### 5.5 压测 / Demo / 脚本型号

`demo/aliyun-fc-init-user/scripts/live-phase9-*` 等仅测试入口，不计入 ACTIVE UI。

---

## 6. Direct 残留审计

### 6.1 `rhPostChargeVideo` 调用点（`VideoProvider.ts`）

| 大致用途（billing / 分支） | ACTIVE 可触发？ | 风险标记 |
|---------------------------|-----------------|----------|
| ltx-2.3-lipsync / i2v / t2v Direct 分支 | **否**（Queue-only 早退 + assert） | 仅 RETIRED 路径死代码 → **P2** |
| minimax-h3-t2v / i2v Direct | **否** | **P2** |
| ltx hdr-multi / msr-av | **否**（已 RETIRED + Queue-only 不适用） | **P2** |
| rh-video-start-end Direct | **否** | **P2** |
| wan-animate Direct | **否** | **P2** |
| gemini-omni（非 flash）Direct | **否**（RETIRED） | **P2** |
| gemini-omni-flash Direct | **否** | **P2** |
| 通用 OpenAPI 分支（含 grok-3-stable、部分旧型号） | **grok-3-stable：是（旧节点）**；Queue-only：assert 拦截 | **P1**（stable）/ **P2**（死代码） |

### 6.2 `rhPostChargeImage` / Image `rhPostCharge`

- **ACTIVE 图片可触发** → 标记为 **SPECIAL 产品路径**（非视频 Queue 绕过）  
- ImageProvider：`/tasks/create` 失败会 **回退 run-task 内扣费**（明确日志）— 属图片链路设计，不是视频 Queue fallback

### 6.3 `rhPostChargeAudio`

- **ACTIVE 音频 / HeyGem TTS 可触发** → SPECIAL  
- AudioProvider 同样存在 create 失败回退内扣

### 6.4 总结

| 类别 | 判定 |
|------|------|
| Queue-only 视频经 `rhPostChargeVideo` | **不可 ACTIVE 正常触发**（双保险） |
| `grok-3-stable` Direct | **ACTIVE 可触发（旧节点）** → HIGH（相对视频纯度）/ 产品面 LIMITED |
| 图片 / 音频 Direct | **ACTIVE 可触发**，但属 **SPECIAL**，非视频 Queue 泄漏 |

---

## 7. Queue Bypass 风险

### 7.1 搜索结果（fallback 类关键词）

全项目 `src/` 未发现：`fallbackToDirect`、`directFallback`、`bypassQueue`、`legacyDirect`、`useDirect` 作为视频 Queue 回落开关。

相关存在项：

| 符号 | 含义 |
|------|------|
| `VIDEO_QUEUE_ONLY_MODEL_IDS` / `isVideoQueueOnlyModel` | 强制 Queue，禁止 Direct |
| `execution_mode: 'queue'` | Create 显式队列模式 |
| `execution_mode?: 'queue' \| 'legacy'`（aliyunService） | 云端 API 兼容字段；视频 Golden Path 固定传 `queue` |
| Image/Audio create 失败回退 | **仅图片/音频**，非视频 Queue-only |

### 7.2 问题回答（第六节要求）

1. **哪些模型允许 Direct？**  
   - 视频：实质仅 `grok-3-stable`（及未归一的隐藏旧型号代码路径）。  
   - 图片 / 音频：全部 ACTIVE 型号（SPECIAL）。

2. **哪些理论上应该 Queue-only？**  
   - `VIDEO_QUEUE_ONLY_MODEL_IDS` 全部 17 项。

3. **Queue-only 会不会进入 Direct？**  
   - **不会**（早退 ERROR + `assertNotDirectChargeForQueueOnlyModel`）。

4. **Queue 创建失败？**  
   - `executeVideoCloudQueueGoldenPath` catch → ERROR → return。无 Direct。

5. **Queue Gate 判断失败？**  
   - Queue-only → ERROR「已强制走云端排队，无法使用 Direct」。无 Direct。

6. **`/tasks/create` 失败会不会重走旧 Provider？**  
   - **不会**（视频 Queue 路径）。图片/音频会回退内扣 — 与视频无关。

### 7.3 严重度

| 发现 | 等级 |
|------|------|
| Queue-only → Direct 活路径 | **未发现（无 P0）** |
| 死 Direct 代码仍留在 VideoProvider | **P2 / 信息项** |
| grok-3-stable 旧节点 Direct | **P1** |
| 图片 create 失败回退内扣 | **P2**（产品设计债，非视频绕过） |

---

## 8. 第二套队列审计

| 名称 | 性质 | 是否生产级 AIXFLOW Queue |
|------|------|--------------------------|
| `nx_tasks` + `runQueuePipeline` + FC Timer | 正式统一视频 Queue | **是（唯一）** |
| `scripts/cron-queue-pipeline.mjs` | 可选本机 cron / 排障 | 非必需；Timer 已接管 |
| `AICore` `maxConcurrentTasks=5` | 本地 invoke 并发闸 | **否**（客户端调度，不是任务队列状态机） |
| Director 批量并行 / `directorConcurrentChatQueue` | UI/导演批处理限流 | **否** |
| RunningHub `usePersonalQueue` | Provider 侧参数 | **否**（RH 内部） |
| VideoProvider 内 `while` + `nxCloudTaskStatus` | UX 等待 | **否**（不推进 Claim/Charge/Dispatch） |

**结论：未发现第二套生产级 Queue。**

---

## 9. Client Dependency Audit

> 用户关闭 AIXFLOW 后，已经进入 Queue 的任务是否仍然可以继续完成？

**可以。**

依据：

1. 生产推进入口：阿里云 FC Timer `nexflow-queue-pipeline` → `handleQueuePipelineTimer` → `runQueuePipeline`（`QUEUE_CLOUD_TIMER_REPORT.md`）。  
2. 验收：客户端断开 + 不调 `/tasks/status`，任务仍 queued → success（task `5f2b638a-…`）。  
3. 客户端 poll 仅在应用打开时更新节点进度；关闭后云端照样 settle，用户再次打开可读云端状态。

**半 Queue 说明：** 打开客户端时存在「客户端状态轮询循环」，但与 FC Timer 推进并行、职责分离；**不构成客户端必须在线才能完成任务**。

---

## 10. 风险清单

### P0

*无。*  
未发现 ACTIVE Queue 模型绕过、Queue→Direct fallback、或关闭客户端后任务无法推进的代码级阻断。

### P1

1. **`grok-3-stable` 仍为 Direct 可执行路径**  
   - 位置：`VideoProvider` Direct + 非 RETIRED  
   - 影响：旧工程节点可绕过统一 Queue / 计费编排差异  
   - 建议（仅记录）：下架归一或迁入 Queue-only；本轮不改代码  

2. **图片/音频仍非统一视频 Queue（产品边界）**  
   - 影响：全产品「一切生成都 Queue」尚未成立；人工验收若含图片需单独标准  
   - 建议：验收范围先锁定视频 Queue；图片另开阶段  

### P2

1. `VideoProvider` 内大量 Queue-only 型号的 `rhPostChargeVideo` 死分支（维护与误改风险）  
2. Gate 对 `drama`/`directorSpawned` 的排除与 Workspace 未传参不一致（文档/意图债务）  
3. Image/Audio `/tasks/create` 失败回退内扣（双计费语义需运维知情）  
4. 本机 `cron-queue-pipeline` 文档仍可能误导新人以为依赖 Windows  

### P3

1. 清理 Direct 死代码、统一导演 drama 语义  
2. `grok-3-stable` 从类型/标签中彻底移除  

---

## 11. 最终结论（强制 8 问）

### Q1 当前 ACTIVE 模型到底有多少？

- **视频（正常 UI 可选）：17**  
- **另：图片 ACTIVE 7；音频 ACTIVE 若干（SPECIAL）**  
- **遗留 Direct 视频（非正常 UI）：1（`grok-3-stable`）**

### Q2 其中多少已经进入统一 Queue？

- **视频 UI ACTIVE：17 / 17 全部 Queue-only**

### Q3 多少仍然是 Direct？

- **正常 UI 视频：0**  
- **遗留视频 Direct：1（stable）**  
- **图片/音频：全部仍为 SPECIAL/Direct 路径（非视频 Queue）**

### Q4 Queue 模型是否存在 Direct fallback？

- **否。**

### Q5 是否存在 ACTIVE 模型绕过 Queue？

- **正常 UI 视频 ACTIVE：否。**  
- **例外：** 旧节点 `grok-3-stable` 本就不在 Queue-only 集合。

### Q6 是否存在第二套生产级 Queue？

- **否。**

### Q7 客户端关闭后 Queue 是否仍然能够继续执行？

- **是**（FC Timer + `run-queue-pipeline`；有独立验收报告）。

### Q8 现在是否已经可以进入「用户真实 Queue 体验 + 人工验收」阶段？

- **可以（针对视频 ACTIVE 模型）。**

---

```text
GO
```

**唯一需知情的非阻塞项（非本轮 P0）：**  
人工验收应明确范围 = **17 个视频 Queue 模型**；不要默认「图片/音频也已统一 Queue」。若验收标准要求「全产品零 Direct」，则需先处理 `grok-3-stable` 与图片/音频路径——那将变成 **NO-GO**，但当前代码与任务目标（视频统一 Queue 体验）下判定为 **GO**。

---

## 附录 A：关键文件索引

| 文件 | 作用 |
|------|------|
| `src/shared/videoQueueGoldenPath.ts` | Queue-only 清单、Gate、assert |
| `src/main/ai/providers/VideoProvider.ts` | Queue Adapter + Direct 死代码 + 硬拒绝 |
| `src/main/utils/runningHubFcHelpers.ts` | `rhPostChargeVideo` 守卫 |
| `src/renderer/components/Canvas/VideoInputPanel.tsx` | UI 可见模型 + Queue 打标 |
| `src/renderer/config/videoModelUiPolicy.ts` | RETIRED / ACTIVE i2v 目录 |
| `src/renderer/config/sora2UiPolicy.ts` | Sora UI 隐藏 |
| `demo/aliyun-fc-init-user/lib/runQueuePipeline.mjs` | 云端编排 |
| `demo/aliyun-fc-init-user/QUEUE_CLOUD_TIMER_REPORT.md` | Timer 自治证据 |

## 附录 B：审计纪律确认

- 未修改业务代码  
- 未自动修复 / 重构 / 迁移  
- 未改 Queue Core / FC Timer / Charge / Concurrency / RH 配置 / DB  
- 本文件为唯一新增交付物（审计报告）
