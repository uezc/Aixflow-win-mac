# Phase 8.1 视频模型现状盘点（只读）

**日期**：2026-09-05  
**约束**：不修改代码；不推进 Sora-2；不改 `.cn/.ai` 路由。  
**前提**：产品已确认 **Sora-2 下架**，`HIDE_SORA2_AND_SORA_CHARACTER_UI = true`。

---

## 1. 当前仍启用的视频模型（前端可选项）

来源：`videoModelUiPolicy.ts`（下架表）+ `VideoInputPanel` 下拉 + `sora2UiPolicy.ts`。

### 1.1 文生视频（无参考图）下拉当前会列出

| model_id | 展示名 | 备注 |
|----------|--------|------|
| `minimax-h3-multi` | MiniMax-H3 全能参考 | 文生也可选（无参考时当文生） |
| `ltx-2.3-t2v` | LTX2.3 文生视频 | |
| `minimax-h3-t2v` | MiniMax-H3 文生视频 | |
| `seedance-2.0-fast` | Seedance 2.0 Fast | |
| `seedance-2.0-mini` | Seedance 2.0 Mini | |
| **`rhart-video-x`** | **全能视频X** | **默认模型**（替代 Sora） |

另：有参考视频时额外出现 `wan-animate-2` / `wan-animate`（角色替换，非纯文生）。

### 1.2 图生 / 其它仍上架（节选）

| model_id | 用途 |
|----------|------|
| `ltx-2.3-i2v` / `ltx-2.3-lipsync` | 图生 / 对口型 |
| `minimax-h3-i2v` / `minimax-h3-audio` / `minimax-h3-multi` | H3 图生 / 口型 / 全能参考 |
| `rhart-v3.1-pro-se` / `rh-video-start-end` | 首尾帧 |
| `seedance-2.0-fast` / `seedance-2.0-mini` | 多模态图生 |
| `gemini-omni-flash` | Omni Flash 图生 |
| `rhart-video-x` | 图生（1–7 图）也可 |
| `wan-animate` / `wan-animate-2` | 角色替换 |
| `rhart-video-upscaler` | 超分（独立路径） |

### 1.3 明确下架 / 前端隐藏（本轮不推进）

| 类别 | model_id |
|------|----------|
| **Sora** | `sora-2`、`sora-2-pro`（UI 隐藏；旧节点归一到 `rhart-video-x`） |
| `RETIRED_VIDEO_MODEL_IDS` | 可灵全家桶、万相 2.6、海螺、Veo fast/pro 文生与官方图生、`grok-3`、`gemini-omni`、LTX MSR 等 |
| 代码拦截 | 旧 `rhart-video-g` 节点直接报错引导改用 `rhart-video-x` |

---

## 2. 每个启用模型实际走 `.cn` 还是 `.ai`

**决定点（两层）：**

1. **Electron 主进程**提交时是否带 `rhRegion: 'ai'|'cn'`（`VideoProvider` → `fcForward` / `rhPostChargeVideo`）。  
2. **FC** `lib/runningHubTarget.mjs`：  
   - `forceOverseasByBillingOrPath(path, billingModelId)`  
   - `pathMatchesOverseasPrefix(path)` / `ALWAYS_OVERSEAS_*` / `DEFAULT_OVERSEAS_*`  
   - 显式 `forward.rhRegion`  
   → `pickRunningHubTarget` → `runninghub.cn` 或 `runninghub.ai` + 对应 API Key。

未命中海外规则且无 `rhRegion` 时，**默认 CN**。

| model_id | RH path / 形态 | 预期站点 | 依据 |
|----------|----------------|----------|------|
| **rhart-video-x** | `/rhart-video-g/text-to-video`（及 image-to-video） | **`.ai`** | 客户端强制 `rhRegion:'ai'`；FC `forceOverseas` 含 `rhart-video-x*` 与 path `rhart-video-g` |
| **gemini-omni-flash** | `/gemini-omni-flash/image-to-video` | **`.ai`** | 客户端 `rhRegion:'ai'`；ALWAYS/DEFAULT 海外前缀 |
| **rhart-v3.1-pro-se** | `/rhart-video-v3.1-pro/...` | **`.ai`** | 客户端 `rhRegion:'ai'`；海外前缀 / forceOverseas |
| **ltx-2.3-t2v** | `/run/ai-app/2034994243982336001` | **`.cn`（默认）** | AI App；未强制海外 |
| **ltx-2.3-i2v / lipsync** | `/run/ai-app/...` | **`.cn`（默认）** | 同上 |
| **minimax-h3-*** | `/run/ai-app/...` + `fetchRhAiAppCallDemoNodes(..., { rhRegion:'cn' })` | **`.cn`** | 显式 CN |
| **seedance-2.0-*** | `/rhart-video/sparkvideo-2.0-*/multimodal-video` | **`.cn`（默认）** | path 不在海外白名单；未见强制 `rhRegion:'ai'` |
| **rh-video-start-end** | AI App / 专用 path | **`.cn`（默认）** | 未见强制海外 |
| **wan-animate / wan-animate-2** | 专用 RH/App 路径 | **`.cn`（默认）** | 未见强制海外 |
| ~~sora-2~~ | `/rhart-video-s/text-to-video` | ~~曾默认 CN~~ | **已下架；本轮禁止改其路由** |

> Electron 侧 URL 常写 `nexflow-fc-rh.stub/openapi/v2/...`，真实 `.cn/.ai` **在 FC 转发时解析**，不以 stub 主机名为准。

---

## 3. 地址在哪里决定（汇总）

| 层级 | 文件 | 作用 |
|------|------|------|
| 产品默认 / 下架 | `src/renderer/config/sora2UiPolicy.ts`、`videoModelUiPolicy.ts` | 隐藏 Sora；默认 `rhart-video-x` |
| 选模型 UI | `VideoInputPanel.tsx` | 启用列表、文生下拉 |
| 提交 path + 可选 rhRegion | `VideoProvider.ts` | 拼 RH path；海外模型带 `rhRegion:'ai'` |
| FC 选站 | `demo/aliyun-fc-init-user/lib/runningHubTarget.mjs` | ALWAYS/DEFAULT 海外前缀、`forceOverseasByBillingOrPath`、`pickRunningHubTarget` |
| Queue Dispatch | `providerRhClient.mjs` + `provider_forward_json.rhRegion` | Golden Path 时以 forward 为准 |

---

## 4. 哪些模型「已确认」能正常提交 RunningHub

**本对话内直连证据（严格口径）：**

| 调用 | 结果 |
|------|------|
| CN `/rhart-video-s/text-to-video` | **失败** HTTP 200 + `errorCode=40310`（CN 下线） |
| AI `/rhart-video-s/text-to-video` | **成功** 返回 `taskId`，query → `RUNNING` |

**未在本轮对下列启用模型做新的 RH 直连 smoke**（不能写成「本轮已证实」）：

- `rhart-video-x`、`ltx-2.3-t2v`、`minimax-h3-t2v`、`seedance-*` 等  

工程侧：**`rhart-video-x` 已是现网默认替代模型**，且整条链路已按 **`.ai` Model API** 设计；与本次 AI 站 Model API 成功形态一致，适合作为下一候选，但仍建议授权后做一次最小直连确认。

---

## 5. 推荐作为新的视频队列 Golden Path 测试模型

### 推荐作为新的 Golden Path 模型：`rhart-video-x`

**理由（只读结论）：**

1. **产品真实默认**：`DEFAULT_VIDEO_MODEL` / `DEFAULT_VIDEO_MODEL_REPLACING_SORA2` 均为 `rhart-video-x`；Sora 隐藏后用户自然走它。  
2. **纯文生形态清晰**：`/rhart-video-g/text-to-video`，body 为 `prompt + aspectRatio + resolution + duration`，贴近现有 `provider_forward_json` 设计，比 LTX/H3 的 `nodeInfoList` AI App 更适合 Phase 8.1「单 path 转发」。  
3. **站点已明确为 `.ai`**：客户端与 FC `forceOverseas` 均已对准，**无需**为 Golden Path 再做全局 `.cn→.ai` 替换，也**不会**动到其它模型现有分流。  
4. **范围可控**：仅 Canvas 文生 + Flag + 无参考图即可门控，与现有 Golden Path 门控形状一致（替换模型 id / forward builder 即可）。  
5. **避开已下架 Sora 与 CN 40310 路径**。

**次选（若你希望坚持 CN / AI App）：** `ltx-2.3-t2v`  
- 文生仍启用；但 forward 需承载 `run/ai-app/{id}` + `nodeInfoList`，Golden Path 改造面更大，且默认 CN。

---

## 6. Phase 8.1 哪些代码可继续复用

| 模块 | 复用价值 |
|------|----------|
| FC `/tasks/create` + `execution_mode=queue` | ✅ |
| Phase 5 claim / slot CAS | ✅ |
| Phase 6 charge / refund 幂等 | ✅（已在失败路径验证） |
| Phase 7 dispatch / poll / settle / `provider_task_id` SoT | ✅ |
| Feature Gate `VIDEO_QUEUE_*` | ✅ |
| `provider_forward_json` + `submitRunningHub` | ✅（换 path/body/`rhRegion`） |
| Live / mock E2E 脚本骨架 | ✅（换 model_id / forward） |
| `charge` 扫描 `taskIdFromTaskRow` 修复 | ✅ 保留 |

---

## 7. Sora-2 专用：可废弃 vs 暂时保留但不再调用

| 资产 | 建议 |
|------|------|
| `HIDE_SORA2_AND_SORA_CHARACTER_UI` / 归一到 `rhart-video-x` | **保留**（产品下架策略） |
| `VIDEO_QUEUE_GOLDEN_MODEL = 'sora-2'`、`isCanvasSora2T2v…`、`buildSora2T2vRhForward` | **暂时保留但不再调用**；后续换成新模型 builder 后可删或改名 |
| `VideoProvider.executeSora2T2vCloudQueueGoldenPath` | **暂时保留但不再调用**（UI 已无 Sora 入口） |
| VideoInputPanel 中 `nxCloudQueueGoldenPath` 仅绑 sora-2 的分支 | **暂时保留但不再调用** |
| Live/mock 脚本写死 `sora-2` / `/rhart-video-s/...` | **停用推进**；改测新模型前勿再当验收标准 |
| `nx_model_config` 的 `sora-2` 定价行 | **可不删**（无害）；新模型需有独立定价 key |
| **禁止**：为 Sora 改 `.cn→.ai`、全局替换、动其它模型路由 | **遵守** |

---

## 8. 当前 Phase 8.1 状态（不变）

```text
PHASE 8.1 = NOT_READY（原 Sora Golden Path 停推）
F = FAIL（Sora / CN 40310，不再修复该路径）
G = NOT_RUN
Phase 8.2 = 禁止
本盘点 = 只读，无代码变更
```

---

## 明确推荐

**推荐作为新的 Golden Path 模型：`rhart-video-x`（全能视频X）**

理由：现网默认替代 Sora、文生 Model API 形态简单、已单独强制 `.ai`、与 Phase 8.1 queue/forward 架构匹配最好，且不要求全局改路由。

等你确认后，再进行「切换 Golden Path 目标模型」的代码修改与验收。
