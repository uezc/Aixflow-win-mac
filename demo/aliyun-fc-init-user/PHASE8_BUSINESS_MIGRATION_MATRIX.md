# PHASE8_BUSINESS_MIGRATION_MATRIX.md

**阶段**：Phase 8 · Business Migration Matrix（**Audit only · 不改业务代码**）  
**日期**：2026-09-03  
**基线**：Phase 5 / 6 / 7 已冻结实现；现网客户端仍走 legacy  
**纪律**：本文件为只读审计产物；禁止据此直接改 MV / Drama / Image / Video / Phase5–7 / RH API

---

## 0. 两条链路的真实关系（总览）

### 0.1 目标云端队列（Phase 5→7，FC 已实现，**业务未接入**）

```text
POST /tasks/create execution_mode=queue
  → status=queued（不扣费、不调 RH）
  → cron/internal promote-queued-tasks（Phase 5 Claim）
  → status=claimed + slots held
  → internal charge-claimed-tasks（Phase 6）
  → claimed + execution_stage=charged（仍持槽，不调 RH）
  → internal dispatch-charged-tasks（Phase 7）
  → RH submit → 写 provider_task_id → running + provider_submitted
  → internal poll-provider-tasks → settle → success|failed + release
```

| 能力 | 现状 |
|------|------|
| FC 支持 `execution_mode=queue` | **是**（`handleTasksCreate.mjs`） |
| 客户端传入 `execution_mode=queue` | **否**（全仓 `src` 无调用） |
| Claim / Charge / Dispatch / Poll / Recover HTTP | **已实现**（需 `ADMIN_SETTLE_SECRET` cron） |
| 业务任务带 `provider_forward_json` | **否**（Dispatch 无载荷则 `NO_FORWARD_PAYLOAD`） |
| 现网生产主路径走此链 | **否** |

### 0.2 现网 legacy（**全部 RH 业务当前路径**）

```text
Renderer invokeAI / 插件服务
  → Main AICore（本地并发 ≤5）
  → Image|Video|AudioProvider | runningHubAiAppFc
  → 可选 POST /tasks/create（默认 legacy → 立即扣费 + status=pending）
  → POST /run-task forward RunningHub（billing=none 若已 prepaid；否则 billing=charge）
  → 客户端解析 RH taskId → 本地存 runningHubTaskId
  → 客户端经 /run-task path=/query 轮询直至终态
  → 客户端/主进程写回节点；FC 对已有 OTS 行可能 upsert running/success/failed
```

| 对比项 | Legacy | Phase 5–7 |
|--------|--------|-----------|
| 扣费时机 | create 预扣 **或** run-task `billing=charge` | Claim 后 Phase 6 `dr_*` |
| RH 谁调 | **客户端驱动** FC `/run-task` | **云端 Dispatch Worker** |
| `provider_task_id` | **OTS 通常不写**；客户端持有 RH id | Dispatch 原子写入 SoT |
| Poll | 客户端 `/query` | `/internal/poll-provider-tasks` |
| Settle / 释槽 | 客户端终态 + legacy refund/settle-stale | Phase7 settle + Phase5 release |
| 并发 | `NEXFLOW_MAX_TASK_CONCURRENCY=5`（AICore + Director pump） | 云端 user/platform CAS（100 池等） |
| 双提交防护 | Phase7 仅对 **已 charged/管线** 任务拦 run-task submit | 未入队任务仍可 legacy 提交 |

**结论**：两条链路 **并行存在、业务侧未合流**。Phase 8 迁移 = 把下列业务从 0.2 切到 0.1，并关掉双提交窗口。

---

## 1. MV Director

| 字段 | 现状 |
|------|------|
| **创建任务入口** | `Workspace.tsx` 导演批量/单镜生视频 → `electronAPI.invokeAI`；提示词优化等另走 chat 队列 |
| **task_type** | 视频：`video`（`/tasks/create type=video`）；资源图另走 `image` |
| **是否进入 queued** | **否**（create 默认 legacy → `pending`） |
| **是否 Phase 5 Claim** | **否** |
| **是否 Phase 6 Charge** | **否**（用 legacy deduct / create 预扣） |
| **是否 Phase 7 Dispatch** | **否** |
| **RunningHub 调用位置** | `VideoProvider` → `rhPostChargeVideo` → `fcForwardRequest` → FC `/run-task`；模型多为 `/run/ai-app/*`（H3 / LTX 等）。`DIRECTOR_MV_FORCE_H3_LIPSYNC=true` 时视频固定 MiniMax-H3 口型同步 |
| **provider_task_id 如何产生** | RH 响应 taskId 由客户端解析；**不写** OTS `provider_task_id`；节点/任务列表写 `runningHubTaskId` |
| **Poll 在哪里** | 主进程 `rhQueryPollVideo` / `pollRunningHubVideoUntilTerminal`（`/run-task` + `/query`）；Workspace 可 resume |
| **Settle 在哪里** | 客户端 SUCCESS/FAILED 写节点；FC 对 prepaid 行可能 upsert success/failed；失败退款走 legacy ledger，非 Phase6 `ref_*` |
| **当前客户端并发** | `DIRECTOR_MV_VIDEO_BATCH_SIZE = NEXFLOW_MAX_TASK_CONCURRENCY`（**5**）本地 pump；另受 `AICore.maxConcurrentTasks=5` 全局限制 |
| **当前 legacy 路径** | **是**：create(legacy) + run-task submit + client query |
| **重复提交风险** | **高**：本地 5 泵 + 客户端可重试 invoke；与未来云端 Dispatch 双轨若未关 legacy → 双 RH；create 超时跳过预扣后 run-task `billing=charge` 可与其它路径叠扣 |
| **是否已经迁移** | **否** |
| **迁移所需修改文件（预估，本轮不改）** | `Workspace.tsx`；`directorVideoBatch.ts`；`VideoProvider.ts`；`runningHubFcHelpers.ts` / `fcForwardTask.ts`；`aliyunService.ts`（`execution_mode=queue` + forward 载荷入库）；可选停用本地 pump 改轮询 `/tasks/status` |

---

## 2. AI Short Drama（短剧 / DramaStudio）

| 字段 | 现状 |
|------|------|
| **创建任务入口** | `DramaStudioHost.tsx` + `DramaExecuteTablePanel` → 复用 `directorVideoBatch` / Workspace 表内生成 → `invokeAI`；镜头音频 `DramaShotRefZones.generateShotAudio`（侧链） |
| **task_type** | 成片 `video`；分镜/资产图 `image`；配音等 `audio`；剧本分析多为 `llm`/chat（非 RH 主链） |
| **是否进入 queued** | **否** |
| **是否 Phase 5 Claim** | **否** |
| **是否 Phase 6 Charge** | **否** |
| **是否 Phase 7 Dispatch** | **否** |
| **RunningHub 调用位置** | 与 MV 同源：`VideoProvider` / `ImageProvider` / `AudioProvider` 经 FC forward；短剧模型偏好 MiniMax-H3 系（`directorVideoBatch` / Drama 提示词编译） |
| **provider_task_id 如何产生** | 同 MV：客户端 RH id，OTS 字段基本空 |
| **Poll 在哪里** | 同 MV：客户端 `/query` |
| **Settle 在哪里** | 同 MV：客户端 + legacy FC upsert |
| **当前客户端并发** | 表内批量仍用 `DIRECTOR_MV_VIDEO_BATCH_SIZE=5`；AICore 全局 5；Director 内图像批另有 `IMAGE_GEN_MAX_PARALLEL_*` / `SB_GEN_MAX_PARALLEL`（均为 5） |
| **当前 legacy 路径** | **是** |
| **重复提交风险** | **高**（同 MV）；短剧单镜重跑 / 批量补缺与本地 resume 可能二次 submit |
| **是否已经迁移** | **否** |
| **迁移所需修改文件（预估）** | `DramaStudioHost.tsx`；`DramaExecuteTablePanel.tsx`；`DramaShotRefZones.tsx`；`directorVideoBatch.ts`；`Workspace.tsx`；`VideoProvider.ts` / `ImageProvider.ts` / `AudioProvider.ts`；`aliyunService.ts` |

---

## 3. Image Generation（画布生图）

| 字段 | 现状 |
|------|------|
| **创建任务入口** | `ImageInputPanel` → `useAI` → `invokeAI` → `AICore` → `ImageProvider` |
| **task_type** | `image` |
| **是否进入 queued** | **否** |
| **是否 Phase 5 Claim** | **否** |
| **是否 Phase 6 Charge** | **否** |
| **是否 Phase 7 Dispatch** | **否** |
| **RunningHub 调用位置** | `ImageProvider.rhPostCharge` → FC `/run-task`；文生/图生等多模型 path |
| **provider_task_id 如何产生** | `ensureLedgerImageTask` → `/tasks/create` legacy 得 `task_id`（AIXFLOW id）；RH id 客户端解析；**OTS `provider_task_id` 不写** |
| **Poll 在哪里** | `rhQueryPollImage` / `pollRunningHubImageUntilTerminal` |
| **Settle 在哪里** | 客户端写 `outputImage`；prepaid 行 FC upsert；失败回退 run-task 内扣费路径 |
| **当前客户端并发** | `AICore` ≤5；批量运行 `Workspace` 顺序/并行受同一上限 |
| **当前 legacy 路径** | **是**；create 失败或 **15s 超时** → 跳过预扣，run-task `billing=charge` |
| **重复提交风险** | **中高**：超时跳过预扣后可能「未建单却 charge」；用户重试 / 批量再跑 |
| **是否已经迁移** | **否** |
| **迁移所需修改文件（预估）** | `ImageProvider.ts`；`ImageInputPanel.tsx`；`useAI.ts`；`aliyunService.ts`；`runningHubFcHelpers.ts`；`AICore.ts`（并发与 queue 语义） |

---

## 4. Video Generation（画布生视频，非导演台）

| 字段 | 现状 |
|------|------|
| **创建任务入口** | `VideoInputPanel` → `useAI` → `VideoProvider` |
| **task_type** | `video` |
| **是否进入 queued** | **否** |
| **是否 Phase 5 Claim** | **否** |
| **是否 Phase 6 Charge** | **否** |
| **是否 Phase 7 Dispatch** | **否** |
| **RunningHub 调用位置** | `rhPostChargeVideo` → 大量 `/run/ai-app/{id}` 与 OpenAPI path（Seedance / Kling / Wan / H3 / LTX / Gemini Omni 等） |
| **provider_task_id 如何产生** | 同 Image：ledger `task_id` ≠ RH id；RH id 客户端持有 |
| **Poll 在哪里** | `rhQueryPollVideo` / `AICore` resume poll |
| **Settle 在哪里** | 客户端节点 + legacy FC |
| **当前客户端并发** | AICore ≤5 |
| **当前 legacy 路径** | **是** |
| **重复提交风险** | **中高**（同 Image；视频更贵，双提交伤害更大） |
| **是否已经迁移** | **否** |
| **迁移所需修改文件（预估）** | `VideoProvider.ts`；`VideoInputPanel.tsx`；`runningHubFcHelpers.ts`；`runningHubVideoQueryResume.ts`；`aliyunService.ts`；`AICore.ts` |

---

## 5. Batch Generation（批量）

| 子类型 | 入口 | 底层 Provider | 并发 | 入队 Phase5–7？ | 已迁移？ |
|--------|------|---------------|------|-----------------|----------|
| **画布批量运行** | `Workspace` `batchRunInProgress` → 多节点 `invokeAI` | Image/Video/Audio | AICore 5 | **否** | **否** |
| **MV/Drama 批量视频** | `Workspace` 导演表内 pump | `VideoProvider` | Director pump **5** | **否** | **否** |
| **导演批量场景图** | `DirectorNode` `batch-scene-images` | `ImageProvider` | `IMAGE_GEN_MAX_PARALLEL_*=5` | **否** | **否** |
| **导演批量分镜图** | `DirectorNode` storyboard batch | `ImageProvider` | `SB_GEN_MAX_PARALLEL=5` | **否** | **否** |
| **提示词批量优化** | `DIRECTOR_MV_PROMPT_OPTIMIZE_PARALLEL=2` | Chat/LLM（多为 FC LLM，非 RH 视频） | 波次+间隔防 429 | N/A（非 RH 视频主链） | N/A |

**统一字段（批量 RH 生图/生视频）**

| 字段 | 现状 |
|------|------|
| **创建任务入口** | 见上表；均最终 `invokeAI` |
| **task_type** | `image` / `video`（按节点） |
| **queued / Claim / Charge / Dispatch** | **全否** |
| **RH / provider_task_id / Poll / Settle** | 与 §3 / §4 / §1 相同 legacy |
| **重复提交风险** | **高**：批量补跑 + 本地 resume + 无云端 SoT |
| **迁移所需修改文件（预估）** | `Workspace.tsx`；`DirectorNode.tsx`；`directorVideoBatch.ts`；对应 Provider；队列 create API 接线 |

---

## 6. 其他实际调用 RunningHub 的业务

### 6.1 Audio（配音 / SUNO / RVC / TTS）

| 字段 | 现状 |
|------|------|
| **创建任务入口** | `AudioInputPanel` / `RvcTrainInputPanel` / Drama 镜头音频 → `AudioProvider` |
| **task_type** | `audio` |
| **queued / P5 / P6 / P7** | **全否** |
| **RH 位置** | `rhPostChargeAudio`：`/rhart-audio/*`、`/bytedance/*`、`/run/ai-app/*`（RVC 等） |
| **provider_task_id** | 客户端 RH id；OTS 不写 SoT |
| **Poll / Settle** | `rhQueryPollAudio` / 客户端；legacy |
| **客户端并发** | AICore ≤5 |
| **legacy** | **是**（create 可选 + run-task） |
| **重复提交风险** | **中** |
| **已迁移** | **否** |
| **预估改文件** | `AudioProvider.ts`；`runningHubFcHelpers.ts`；音频面板；`aliyunService.ts` |

### 6.2 RunningHub AI App 插件族（`runningHubAiAppFc.ts`）

均经 `fcForwardRequest(..., 'charge'|'none', ...)` → `/run-task`，**不经** queued→claimed→charged→dispatch。

| 业务 | 导出函数 | task_type（FC） | 扣费 | Poll |
|------|----------|-----------------|------|------|
| 抠图 | `runMattingViaFc` | image + charge | run-task 内扣 | 同文件 submitAndPoll |
| 去水印（图） | `runWatermarkRemovalViaFc` | image | 同上 | 同上 |
| 超分 | `runImageUpscaleV3ViaFc` | image | 同上 | 同上 |
| 人物多角度 | `runCharacterMultiAngleViaFc` | image | 同上 | 同上（多图累积） |
| 图生 3D | `runImageTo3dViaFc` / Model | image | 同上 | 同上 |
| Joy Caption Two | `runJoyCaptionTwoViaFc`（ChatProvider） | image | 同上 | 同上 |
| 视频分析 | `runVideoAnalysisViaFc` | video | 同上 | 同上 |
| 视频去水印 | `runVideoWatermarkRemovalViaFc` | video | 同上 | 同上 |
| 视频深度 | `runVideoDepthConvertViaFc` | video | 同上 | 同上 |
| 去字幕水印 | `runVideoSubtitleWatermarkRemovalViaFc` | video | 同上 | 同上 |
| RH 媒体上传 | `uploadRunningHubMedia*ViaFc` | image/video + none | 通常不扣生成费 | 非任务生命周期 |

| 字段 | 统一现状 |
|------|----------|
| **queued / P5 / P6 / P7** | **否** |
| **provider_task_id** | 函数内局部变量；**不写** OTS SoT |
| **客户端并发** | 随调用方；多数仍进 AICore 或独立 await |
| **重复提交风险** | **中**（用户连点 / 无幂等键） |
| **已迁移** | **否** |
| **预估改文件** | `runningHubAiAppFc.ts`；`imageUpscaleV3.ts` / `watermarkRemoval.ts` 等薄封装；各 UI 入口；`CharacterCreatePanel.tsx` 等 |

### 6.3 角色创建 / 其它面板直调

| 业务 | 入口 | 说明 |
|------|------|------|
| 角色创建生图 | `CharacterCreatePanel` → `invokeAI` | 走 ImageProvider legacy |
| LLM 反推 / 导演分析 | `ChatProvider` / `LLMInputPanel` | 主路径 BLTCY/RH LLM；JoyCaption 走 RH App（§6.2） |
| Workspace 云任务列表 | 轮询 `/tasks/status` 等 | **跟踪** prepaid `pending/running`，**不**驱动 Phase7 Dispatch |

### 6.4 FC 侧仍存活的 legacy 结算

| 入口 | 与 Phase7 关系 |
|------|----------------|
| `/internal/settle-stale-tasks` | 对 RUNNING 等 **盲退**；Phase7 已排除管线字段，但 **legacy pending/running** 仍可被扫 |
| `/run-task` billing=charge | Provider 未 prepaid 时的主扣费路径 |
| Phase7 `PHASE7_PIPELINE_ACTIVE` | **仅**当任务已 charged/管线时拦 submit；现网任务几乎触达不到 |

---

## 7. 矩阵汇总表

| # | 业务 | queued | P5 Claim | P6 Charge | P7 Dispatch | RH 谁调 | OTS provider_task_id | Poll | 已迁移 |
|---|------|--------|----------|-----------|-------------|---------|----------------------|------|--------|
| 1 | MV Director | 否 | 否 | 否 | 否 | 客户端→run-task | 否（客户端 id） | 客户端 /query | **否** |
| 2 | AI Short Drama | 否 | 否 | 否 | 否 | 同上 | 否 | 客户端 | **否** |
| 3 | Image Generation | 否 | 否 | 否 | 否 | 同上 | 否 | 客户端 | **否** |
| 4 | Video Generation | 否 | 否 | 否 | 否 | 同上 | 否 | 客户端 | **否** |
| 5 | Batch（画布/导演） | 否 | 否 | 否 | 否 | 同上 | 否 | 客户端 | **否** |
| 6a | Audio | 否 | 否 | 否 | 否 | 同上 | 否 | 客户端 | **否** |
| 6b | RH AI Apps | 否 | 否 | 否 | 否 | run-task charge | 局部变量 | 同文件 poll | **否** |
| 6c | RH Upload | — | — | — | — | run-task none | — | — | N/A |
| — | Phase5–7 FC 能力本身 | 支持 | 支持 | 支持 | 支持 | Worker | **是** | Worker | 基建就绪 / **业务 0%** |

---

## 8. 迁移前置缺口（Audit 观察，非实施）

1. **无业务**传 `execution_mode=queue`。  
2. **无业务**写入 `provider_forward_json`（Dispatch 必需）。  
3. **无产品 cron** 保证 promote→charge→dispatch→poll 对用户任务连续跑通（仅有脚本样例）。  
4. 本地并发 **5** 与云端 CAS **未对齐**。  
5. Legacy create 预扣（`pending`）与 Phase6 Money SoT（`claimed→charged`）是 **两套扣费**；迁移期必须防双扣。  
6. MV Director `pump=5` **本阶段仅记录**（与 Phase7 纪律一致）。

---

## 9. 建议迁移顺序（仅建议，等确认后再编码）

```text
1) 基建接线：queue create + forward 载荷 + cron 全链路（单模型金丝雀）
2) Image 单节点 → Video 单节点
3) Audio / RH AI Apps
4) Batch / Director 图像批
5) MV Director / Short Drama（最后：并发泵与双提交风险最高）
6) 关掉对应路径的 run-task billing=charge / 客户端 RH submit
```

**本轮不开始上述编码。**

---

*Phase 8 Business Migration Matrix · audit-only · 2026-09-03*
