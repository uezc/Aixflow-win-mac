# AI短剧导演台 V2 — 实现说明

> 对应方案：短剧导演台 V2 架构改造。与 Phase 0 报告互补。

## 已落地

### Domain（`src/shared/directorDomain/`）

- 实体：ProjectBible / Character(换装) / Scene(变体) / Prop / Creature / Voice / SceneBeat / Shot / GenerationPackage / Review
- `migrateDramaV1ToDomainV2`：旧扁平行镜头表 → V2 Session
- `projectDramaSessionToPipeline`：出片前投影回 V1，兼容现有 `onSpawnVideos`
- `runDramaContinuityCheck` + `reviewAllDramaShots`
- `buildDramaGenerationPackage` + `VideoModelAdapter`（H3 multi/i2v/audio 已注册；Seedance/Veo/Runway 占位）
- 分析 Prompt：`prompts/analyze.ts` → `normalizeDramaDomainAnalyzeResult`

### 落盘 IPC

- `{projectDir}/director-v2/session.json` 等
- `director-v2-save-session` / `load` / `exists`（preload + vite-env）

### UI

- `DramaStudioHost`：六步 ①分析 ②圣经 ③资产 ④分镜 ⑤视频 ⑥审核
- `directorDrama` 节点全屏/窗口内短剧路径改为 Studio Host
- `DRAMA_PHASES` 扩展为六步，旧 `story/shots/preview` 自动映射

## 未做（有意延后）

- 跨工程全局资产库
- Seedance/Veo/Runway 真实 Adapter
- 长文本章节引擎 / RAG
- 成片视觉 LLM 深度审核（当前为启发式评分）
