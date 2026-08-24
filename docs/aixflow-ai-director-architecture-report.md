# AIXFLOW AI剧本导演台 — 架构接入报告（Phase 0）

> **状态**：只审不改。确认本报告后进入 Phase 1（Domain / Types / Prompt Registry / Adapter 骨架，不做 UI）。  
> **产品对外名**：AIXFLOW / Aixflow；仓库与本地数据目录仍为 NEXFLOW。  
> **日期**：2026-08-11  
> **原则**：不复制 waoowaoo 源码/Prompt/UI；不擅自大规模重构 Canvas / Task / Model Gateway / RunningHub / Storage。

---

## 0. 执行摘要

现有 AIXFLOW 已具备：无限画布、粗粒度 AI Provider 网关、RunningHub 经 FC 转发与元宝计费、MiniMax H3 四路视频（t2v / i2v / multi / audio）、以及「导演节点」短剧/MV 双类型流水线原型。

目标「AI剧本导演台」**应挂接现有枢纽扩展**，而不是新建第二套任务/计费/存储。长文本引擎、Story Bible、Prompt 版本库、H3 Adapter 能力注册表目前**基本缺失**，需在 Domain 层新建；UI 可演进现有 `directorDrama`，但数据模型需从「单节点内 `DirectorPipelineState`」升级为可持久化的 Project / Bible / Shot 域模型。

推荐最终分工：

| 角色 | 模型 / 系统 |
|------|-------------|
| 编剧/导演大脑 | 文本 LLM（建议后续接 MiniMax M3 或现有高能力 chat；**勿把 H3 当长文大脑**） |
| 摄影机/视频 | MiniMax H3（multi / i2v / audio / t2v） |
| 制片系统 + 画布 | AIXFLOW（Workspace + AICore + FC 计费 + 项目图持久化） |

两种视频模式与现有 H3 能力对齐：

- **模式 A（质量）**：分镜图 → `minimax-h3-i2v`（+ 可选人物/场景参考进 multi）
- **模式 B（极速）**：人物参考 + 场景参考 + 自然语言导演指令 → `minimax-h3-multi`（有对白音则 `minimax-h3-audio`）

---

## A. 可以直接复用的代码

### A1. 画布与节点

| 能力 | 路径 | 说明 |
|------|------|------|
| React Flow 宿主 / `nodeTypes` | `src/renderer/components/Workspace.tsx` | 注册、创建、选中、IPC 回调枢纽 |
| 右键菜单 | `src/renderer/components/Canvas/ContextMenu.tsx` | 已有 `director` / `directorDrama` |
| 连线规则 | `src/renderer/utils/connectionRules.ts` | 菜单类型 ↔ 节点类型、禁连 |
| 导演类型工具 | `src/renderer/utils/directorNodeType.ts` | `director` = MV，`directorDrama` = 短剧，mode 由 type 锁定 |
| 导演 UI | `src/renderer/components/Canvas/DirectorNode.tsx` | 向导壳、出图/出视频入口（可演进，勿推倒重写为唯一方案） |
| 角色卡 / 剪辑 / 图片 / 视频节点 | `CharacterNode`、`VideoSpliceNode`、`ImageNode`、`VideoNode` 等 | 「发送到画布」的落点 |

### A2. AI 调用与任务进度

| 能力 | 路径 |
|------|------|
| 唯一调度 | `src/main/ai/AICore.ts` |
| Provider 注册 | `src/main/ai/Registry.ts`、`src/main/index.ts` |
| Chat / Image / Video / Audio | `src/main/ai/providers/*Provider.ts` |
| 状态包 | `src/main/ai/types.ts` → `AIStatusPacket` |
| 渲染订阅 | `src/renderer/hooks/useAI.ts` |
| 模拟进度 | `src/main/ai/utils/ProgressHelper.ts` |

链路：`useAI.execute` → `electronAPI.invokeAI` → `ai:invoke` → Provider → `ai:status-update`。

### A3. MiniMax H3 / RunningHub / FC

| 能力 | 路径 |
|------|------|
| H3 multi 常量与组包 | `src/common/minimaxH3Multi.ts` |
| H3 audio 常量与组包 | `src/common/minimaxH3Audio.ts` |
| VideoProvider 分支 | `src/main/ai/providers/VideoProvider.ts`（t2v/i2v/multi/audio） |
| FC 转发 + 计费开关 | `src/main/utils/fcForwardTask.ts`（`billing: charge\|none`） |
| FC 客户端 | `src/main/services/nxFcClient.ts` |
| H3 Prompt skill 本地镜像 | `src/main/utils/minimaxH3SkillGuide.ts`、`resources/skills/minimax-h3/` |
| UI 侧智能提示 | `src/shared/minimaxH3*.ts`、视频面板 H3 控件 |

### A4. 计费 / 元宝

| 能力 | 路径 |
|------|------|
| 云端门禁 | `src/main/utils/cloudAiGate.ts` |
| SKU 键 | `src/main/utils/videoBillingSku.ts` ↔ 根目录 `pricing/videoBillingSku.mjs` ↔ FC `demo/aliyun-fc-init-user/**/videoBillingSku.mjs` |
| 计价 | `pricing/price_calculator.mjs`、`model_yuanbao_rates.mjs`、`cost_table.mjs` |
| 渲染侧展示价 | `src/renderer/utils/cloudModelPricing.ts` 等 |

### A5. 媒体与存储

| 能力 | 路径 |
|------|------|
| 项目图持久化 | `src/main/utils/projectDataDurability.ts`（`data.json` + A/B 槽） |
| 元数据 store | `src/main/services/store.ts`（`nexflow-config`，非画布图） |
| `local-resource://` | `src/main/index.ts` protocol |
| 结果落盘 | `src/main/utils/resourceDownloader.ts` |
| OSS 上传辅助 | `src/main/services/ossUploadSession.ts`、`ossFcProxyUpload.ts` |

### A6. 现有导演领域雏形（可演进，非最终 Domain）

| 能力 | 路径 |
|------|------|
| 状态 / 阶段 | `src/shared/directorPipeline/schema.ts`（`DirectorMode`、`DRAMA_PHASES`、`DirectorShot`、资产箱） |
| Prompt 雏形 | `src/shared/directorPipeline/prompts.ts`、`buildPrompt.ts` |
| 短剧解析 | `src/shared/directorPipeline/dramaHelpers.ts` |
| 分镜合成 | `composeFinalPrompt.ts`、`bindAssetRefs.ts`、`plotBeatSheet.ts` |
| 状态补丁 | `statePatch.ts` |

---

## B. 需要新增的代码

按总指令 Phase 1～8，建议新建（名称可微调，职责不可缺）：

| 模块 | 建议放置 | 职责 |
|------|----------|------|
| Director Domain 类型 | `src/shared/directorDomain/` | Project、Document、Chapter、StoryBible、CharacterBible、SceneBible、Episode、Segment、Shot、GenerationHistory、videoGenerationMode |
| Long Context Engine | `src/shared/directorDomain/longContext/` 或 `src/main/director/longContext/` | 文档解析、章节识别、章节分析、摘要合并、Context Builder（主进程可跑重任务） |
| Prompt Registry（版本化） | `src/shared/director/prompts/`（或 `src/shared/directorDomain/prompts/`） | `STORY_ANALYSIS_V1` 等；禁止散落在 React 组件 |
| Model Adapter | `src/main/director/adapters/` | `MiniMaxH3VideoAdapter`、未来 Veo/Kling…；**不**让 UI 直调 RH |
| ModelCapabilityRegistry | `src/shared/directorDomain/capabilities.ts` + 可配置 JSON | H3 能力探测/配置，禁止硬编码「假装支持」 |
| Continuity Checker | `src/shared/directorDomain/continuity.ts` | PASS/WARNING/ERROR |
| 导演台 UI（后期） | `src/renderer/components/DirectorStudio/` 或演进 `DirectorNode` | 左结构 / 中内容 / 右属性；顶栏模式 A\|B |
| 画布输出助手 | `src/renderer/utils/directorCanvasExport.ts` | Shot/角色/场景/图/视频 → 现有节点 |

**长文本相关现状缺口**：仅有 `textSplit`、导演「整段草稿一次 LLM」；**无** Document/Chapter/Embedding/RAG 实现。必须新建 Long Context Engine，禁止百万字一次送 LLM。

**文本大脑**：现有 `ChatProvider`（`modelId: 'chat'`）经 FC/上游；M3 未接入。Phase 2 起应用「低成本章节分析 / 高能力 Bible」分流，通过 Adapter 选 chat 模型，不绑死 H3。

---

## C. 需要修改的代码（小步、可审）

| 文件 | 修改意图 |
|------|----------|
| `VideoProvider.ts` / `minimaxH3*.ts` | 由 Adapter 调用现有分支；补能力矩阵字段；模式 A/B 参数映射 |
| `videoBillingSku.ts` + FC 镜像 pricing | 新计费维度若有必须三端对齐 |
| `Workspace.tsx` | 注册导出节点（若 Phase 8 增加 Director Character/Scene/Shot 节点）；导演批量出片读 `videoGenerationMode` |
| `DirectorNode.tsx` / `directorPipeline/*` | **渐进迁移**：V1 可继续用节点壳，内部 state 切到 Domain；或 Studio 面板读写 Domain 再投影到节点 |
| `connectionRules.ts` / ContextMenu / i18n | 新节点类型入口 |
| `ChatProvider` 或 chat `input.model` | 接入 M3（或现有高能力模型）作「导演大脑」档位 |

**不要**为导演台改写：FC 鉴权协议、元宝账本核心、`projectDataDurability` 防缩逻辑、React Flow 全局交互锁。

---

## D. 不允许修改的核心代码（除非另立 RFC）

1. `AICore.invoke` 调度契约与 `AIStatusPacket` 形状  
2. `fcForwardRequest` 的 charge/none 语义与 token 头  
3. 元宝扣费账本与 FC `run-task` 计费源（只能对齐 SKU，不另起账本）  
4. `local-resource://` 协议与项目 `assets/` 落盘约定  
5. `projectDataDurability` 空写/缩量保护  
6. RunningHub 密钥存放（仅 FC，客户端不直持）  
7. 为「像 waoowaoo」而复制其 Prompt/库表/UI  

若现有架构无法支持某需求：**先报告，再 RFC**，禁止静默大重构。

---

## E. Director Domain 放置位置

```
src/shared/directorDomain/          # 纯数据与纯函数（渲染 + 主进程可共用）
  types.ts                          # Project, Document, Chapter, Bible, Shot, ...
  schemaVersion.ts
  normalize.ts                      # JSON Schema 校验入口
  continuity.ts
  contextBuilder.ts
  videoMode.ts                      # storyboard_to_video | direct_reference_to_video
  capabilities.ts

src/main/director/                  # 仅主进程：IO、长任务、Adapter
  longContext/
  adapters/MiniMaxH3VideoAdapter.ts
  adapters/ChatDirectorAdapter.ts   # 包装现有 chat
  services/directorProjectStore.ts  # 可选：项目级旁路文件，或嵌入 data.json
```

与现有 `src/shared/directorPipeline/` 关系：

- **短期**：Pipeline 作为「画布节点投影 / 兼容层」，读 Domain 子集。  
- **中期**：新逻辑只进 `directorDomain`；Pipeline 标记 deprecated 迁移。  
- **禁止**：两套并行业务真理源长期分叉。

---

## F. Prompt 系统放置位置

```
src/shared/directorDomain/prompts/
  registry.ts                 # 按 id + version 取模板
  versions/
    STORY_ANALYSIS_V1.ts
    STORY_BIBLE_V1.ts
    CHARACTER_V1.ts
    SCENE_V1.ts
    STORYBOARD_V1.ts
    SHOT_V1.ts
    VIDEO_PROMPT_V1.ts
    CONTINUITY_V1.ts
```

规则：

- 全部内置代码；组件内禁止长 System Prompt。  
- 只增版本、不覆盖历史文件。  
- 生成记录写入 `promptVersion`。  
- **不**搬入 waoowaoo 的 prompt 文本。

现有 `src/shared/directorPipeline/prompts.ts` 可作迁移素材（自研短剧/MV 文案），纳入版本库后逐步删除散落调用。

---

## G. H3 Adapter 放置位置

```
src/main/director/adapters/MiniMaxH3VideoAdapter.ts
```

职责：

- 输入：`DirectorShot` + `DirectorContext` + `ReferenceAssets` + `videoGenerationMode`  
- 输出：现有 `invokeAI({ modelId: 'video', input: { model: 'minimax-h3-*', ... }})` 可消费的 payload  
- 模式 A → 优先 `minimax-h3-i2v`（首帧=确认分镜图）；需要多参考时升 `multi`  
- 模式 B → `minimax-h3-multi`；有镜头配音 → `minimax-h3-audio`  
- 能力以 `ModelCapabilityRegistry` 为准；官方不支持的参数记 `unsupported`，UI 隐藏/降级  
- **禁止** Adapter 内新开 HTTP 到 RH；必须走 `VideoProvider` / `fcForwardRequest`

常量继续复用：`src/common/minimaxH3Multi.ts`、`minimaxH3Audio.ts`。

---

## H. 长文本 Engine 放置位置

```
src/main/director/longContext/
  parseDocument.ts          # txt/md/pdf/docx → DirectorDocument
  detectChapters.ts         # 章节标题规则 + 回退
  analyzeChapter.ts         # 单章 LLM + JSON Schema 校验 + 重试
  mergeStoryBible.ts
  chunkIndex.ts             # DirectorDocumentChunk（后续 embedding 可接）
  contextBuilder.ts         # 按任务裁剪上下文（优先级见总指令十八）
```

渲染进程只发「分析章节 / 构建 Bible」IPC；**重 CPU/IO 在主进程**。  
禁止：渲染进程读完整本小说一次 `chat`。

章节分析默认**低成本 chat 模型**；Story Bible / 关系 / 分镜用**高能力模型**（配置项，预留 M3）。

---

## I. 数据存储方案

| 数据 | 方案 |
|------|------|
| 画布节点图 | 继续 `projectDataDurability`（`data.json`） |
| 导演台 Domain（Bible、章节、Shot 历史） | **推荐**：项目目录下 `director/project.json`（+ 分片 `chapters/*.json`、`generations/`），与画布图同级，走同类原子写；节点 `data.directorProjectId` 引用 |
| 用户库（角色库等） | 现有 `electron-store` / 库面板，可「导入为 Character Bible 参考」 |
| 媒体文件 | 现有项目 `assets/` + `local-resource://` + OSS 上传仅用于提交 RH |
| 向量 embedding | V1 可先不做；预留 `DirectorDocumentChunk`；上线前另评模型与成本 |

**不要**把整本小说正文塞进每个 React Flow 节点 `data`（会撑爆保存与 IPC）。

---

## J. Task 如何复用

| 任务类型 | 复用方式 |
|----------|----------|
| 章节 LLM 分析 | `modelId: 'chat'` + `useAI` / 主进程批量队列（简单串行即可） |
| 角色/场景/分镜图 | `modelId: 'image'` |
| 视频 A/B | `modelId: 'video'` + H3 model 子类型 |
| 配音 | `modelId: 'audio'` |
| 进度 UI | 现有 START/PROCESSING/SUCCESS/ERROR |
| 失败重试 | 现有节点/导演表内 status + 用户点重试；不引入 BullMQ |

导演台「任务列表」UI 只做**投影**（读各 Shot/Generation 状态），不新建队列中间件。

---

## K. Canvas 如何接入

**V1（低风险）**  
- 保持一个 `directorDrama`（或升级后的导演台）节点作为「制片入口」。  
- 「发送到画布」：生成 `character` / `image` / `video` / `minimalistText` 节点 + 边，复用现有类型。  

**V1.1（按总指令四十八）**  
- 按需增加薄节点：`directorCharacter`、`directorScene`、`directorShot`（只读引用 Domain id + 预览），避免一次注册过多。  

**禁止**：为每个 Bible 字段新建互不相通的节点生态。

连线目标：Shot → Image / H3 Video → LipSync / 剪辑 / 字幕（均已有或可接现有模块）。

---

## L. Billing 如何接入

1. 一切生成走现有 `ai:invoke` → Provider → FC `charge`。  
2. 视频 SKU：继续 `minimax-h3-{t2v|i2v|multi|audio}-720p-{6|10|15|20}s`。  
3. 文本/生图：沿用现有 chat/image 计价表；新模型先加 rates 再上线。  
4. UI：高成本操作前展示预计元宝（复用 `cloudModelPricing` / 导演节点现有元宝 tip 模式）。  
5. **禁止**导演台本地「白嫖」绕过 cloudAiGate。

---

## M. 两种视频模式如何接入

```text
项目/镜头 videoGenerationMode
  ├─ storyboard_to_video (模式 A)
  │    确认 Shot.generatedImage
  │    → MiniMaxH3VideoAdapter
  │    → input.model = minimax-h3-i2v
  │      （可选附加人物/场景参考 → 升 multi）
  │    → VideoProvider → FC/RH
  │
  └─ direct_reference_to_video (模式 B)
       Character Current Appearance + Scene Reference
       + Video Prompt（含参考关系自然语言）
       → Adapter
       → input.model = minimax-h3-multi
         （有 dialogueAudio → minimax-h3-audio）
       → VideoProvider → FC/RH
```

Adapter 必须生成「参考关系」描述（哪张是人物、哪张是场景、哪张是首帧），对齐 H3 全模态上下文能力；不要只扔一句「男人站在街上」。

镜头级可覆盖项目默认模式。生成历史（图 V1/V2、视频 V1/V2）存在 Domain，**重生成不删历史**。

---

## N. 与当前「短剧导演」实现的差距（务实）

| 总指令要求 | 现状 | 优先级 |
|------------|------|--------|
| 长文本章节引擎 | 无，整段一次分析 | P0 |
| Story / Character / Scene Bible | 弱（sections + assets 列表） | P0 |
| Prompt 版本库 | 单文件 prompts.ts | P0 |
| H3 Adapter + 能力注册表 | VideoProvider 内硬分支 | P0 |
| 模式 A / B 可切换 | 导演内默认 multi，无项目级模式开关 | P0 |
| Continuity Checker | 无 | P1 |
| 生成历史多版本 | 基本单 URL 覆盖 | P1 |
| 独立 Studio 三栏 UI | 单节点向导 | P1 |
| 新 Director* 画布节点 | 仅 director/directorDrama | P2 |
| Embedding RAG | 无 | P2 |
| M3 接入 | 无 | P1（大脑档） |
| 对标 waoowaoo 左栏六步 UI | 部分已做独立节点，未完 | **让位于 Domain Phase** |

结论：先前「对标 waoowaoo UI」待办应**暂停**；按总指令 **Phase 1 Domain 先行**，UI 在 Domain 稳定后做 Studio，避免界面绑死旧 `DirectorPipelineState`。

---

## O. 建议的落地顺序（确认后执行）

与总指令五十五对齐，结合本仓库现状微调：

0. **本报告确认** ← 当前停点  
1. Phase 1：`directorDomain` 类型 + Prompt Registry 骨架 + `MiniMaxH3VideoAdapter` 空壳 + CapabilityRegistry（对接现有四 model id）  
2. Phase 2：Document / Chapter / 章节分析 / Bible 合并（主进程 Engine）  
3. Phase 3：Episode / Segment / Storyboard / Shot  
4. Phase 4：角色图 / 场景图 / 分镜图（复用 ImageProvider）  
5. Phase 5：模式 A 接通  
6. Phase 6：模式 B 接通  
7. Phase 7：Continuity + Generation History  
8. Phase 8：画布导出与（可选）薄节点  

每阶段结束给出可测验收点；不跨阶段「顺手重构」Canvas。

---

## P. 风险与开放问题（需产品确认）

1. **Domain 存哪**：独立 `director/project.json` vs 全部塞进节点 `data`？（报告推荐前者）  
2. **是否保留现有 MV 导演节点**：建议保留；剧本导演台以 `directorDrama` 或新入口演进，MV 不回归同一 mode 切换。  
3. **M3 商务与 FC 是否已通**：未通前用现有 chat 高能力档占位。  
4. **PDF/DOCX 解析依赖**：主进程需引入解析库或走云端；确认许可与体积。  
5. **「导演台」是全屏独立路由还是继续画布节点**：总指令倾向专业模块；建议 Phase 8 前用节点全屏，之后可加路由壳，数据仍是 Domain。

---

## Q. 验收对照（总指令五十九）— Phase 0 视角

当前**不能**宣称 1–22 条验收已满足。本报告仅保证：已定位复用点与禁改点，后续按 Phase 实施可逐项打勾。

---

**下一步**：请确认本报告（尤其是 E/F/G/H/I 放置方案与「先 Domain 后 UI」）。确认后从 **Phase 1** 开始写代码；在此之前不修改业务实现。
