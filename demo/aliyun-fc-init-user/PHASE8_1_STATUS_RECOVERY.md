# PHASE8_1_STATUS_RECOVERY.md

**生成时间**：2026-09-05  
**性质**：上下文恢复 + 只读审计（**未改代码、未部署、未跑完整 Live E2E**）  
**分支**：`cursor/image-upscale-depth-comparer`  
**结论快照**：环境阻断（OTS）**已解除**；Phase 8.1 仍 **NOT_READY**（真实 RH / Canvas E2E 未完成）

---

## 1. 两天前最终状态（2026-09-03 / 09-04）

| 时间 | 状态 | 说明 |
|------|------|------|
| 09-03 Live 初验 | `NOT_READY` | charge/dispatch/poll **404**；OTS `user is disabled` |
| 09-03 部署后 | `NOT_READY` | 路由变为 **500**（已部署）；根因仍是 OTS disabled |
| 09-04 上午 | OTS 欠费停服确认；客服恢复后健康检查曾 **OTS/FC OK** | 见 `phase8-1-env-health-check-result.json`（2026-09-04） |
| 09-04 下午 | 官网 SSL 过期 → 已续期 | **与 Phase 8.1 队列无关**，属充值/官网 HTTPS |
| Live E2E | **从未 PASS** | 无真实 `task_id` / `provider_task_id` / result URL |

报告依据：
- `PHASE8_1_VIDEO_GOLDEN_PATH_REPORT.md`（实现说明 + mock PASS）
- `PHASE8_1_VIDEO_GOLDEN_PATH_LIVE_E2E_REPORT.md`（结论 NOT_READY）
- `scripts/phase8-1-video-golden-live-e2e-result.json`（初验失败 raw）
- `scripts/phase8-1-video-golden-test-result.json`（mock `passed: true`）

---

## 2. 当前代码状态

### Git / 工作区

- **branch**：`cursor/image-upscale-depth-comparer`（跟踪 origin 同名分支）
- **status**：大量未提交修改 + 大量未跟踪 Phase 5–8.1 文件（含报告与脚本）
- **最近 commit**：多为短剧/画布 checkpoint，**无**单独 Phase 8.1 正式 commit 记录
- **Phase 8.1 相关文件 mtime（本地）**：集中在 **2026-09-03 20:12～22:47**

### 关键文件存在性

| 文件 | 存在 |
|------|------|
| `src/shared/videoQueueGoldenPath.ts` | ✅ |
| `demo/.../lib/taskCharge.mjs` | ✅ |
| `demo/.../lib/providerPipeline.mjs` | ✅ |
| `demo/.../lib/handleTasksCreate.mjs` | ✅ |
| `demo/.../scripts/phase8-1-env-health-check.mjs` | ✅ |
| `demo/.../scripts/live-phase8-1-video-golden-path.mjs` | ✅ |
| `VideoProvider.executeSora2T2vCloudQueueGoldenPath` | ✅ |
| `VideoInputPanel` → `nxCloudQueueGoldenPath` | ✅（gated by renderer flag） |

Golden Path 架构（未变）：

```text
Canvas Sora-2 T2V + flags
  → /tasks/create (queue + provider_forward_json)
  → queued → promote/claim → charge → dispatch(RH)
  → provider_task_id → poll → success → release
Client: create + /tasks/status only
```

---

## 3. 当前 FC 状态（只读探测 · 未重新部署）

| 端点 | HTTP | 说明 |
|------|------|------|
| `/internal/promote-queued-tasks` | **200** | OK |
| `/internal/charge-claimed-tasks` | **200** | OK |
| `/internal/dispatch-charged-tasks` | **200** | OK |
| `/internal/poll-provider-tasks` | **200** | OK |

探测时间：2026-09-05（`phase8-1-env-health-check.mjs`）。  
相对两天前：404/500（OTS）→ **全部 200**。

HK FC 环境变量（只读，无密钥）：

| 变量 | 状态 |
|------|------|
| `VIDEO_QUEUE_ENABLED` | **1** |
| `RUNNINGHUB_API_KEY` | **PRESENT** |
| `OTS_ACCESS_KEY_ID` | **PRESENT** |
| `OTS_ENDPOINT` | set |

---

## 4. 当前 OTS 状态

```text
OTS = OK
```

- 本地直连：`video.max=100`，`write_ok=true`，`video.running=0`
- FC Worker：internal 全 200（依赖同一 OTS）
- **不再**是 `OTSAuthFailed: The user is disabled`
- 结论：本地与 FC 侧 OTS **均已恢复**（此前是欠费停服，非 Phase 8.1 代码问题）

---

## 5. 当前 Feature Flag

| 位置 | `VIDEO_QUEUE_ENABLED` | `VITE_VIDEO_QUEUE_ENABLED` |
|------|------------------------|----------------------------|
| 仓库 `.env` | **1** | **1** |
| `resources/.env` | **1** | **1** |
| HK FC | **1** | N/A（服务端不读 Vite 变量） |

注意：运行中的 Electron 是否已加载 Flag，取决于**是否用当前 env 重新构建/启动**；本轮未验证 UI 进程内存中的实际值。

---

## 6. RunningHub 配置状态

| 项 | 状态 |
|----|------|
| 本地 `.env` `RUNNINGHUB_API_KEY` | **MISSING** |
| FC `RUNNINGHUB_API_KEY` | **PRESENT** |
| 真实连通性探测（query/submit） | **UNKNOWN / NOT_RUN**（健康检查脚本对本地无 key 时 SKIP；本轮按纪律未真实提交） |

Dispatch 走 FC，以 **FC 侧 key** 为准；本地缺失不影响 FC Worker，但影响本机直连 RH 探测。

---

## 7. Legacy Path 状态

审计结论：

```text
LEGACY_PATH_SAFE
```

依据（代码门控，未改）：

- Golden Path 需同时：`VIDEO_QUEUE_ENABLED` + `VITE_VIDEO_QUEUE_ENABLED` + `nxCloudQueueGoldenPath=true` + `model=sora-2` + **无参考图**
- `directorSpawned` / `drama` 显式排除
- sora-2 **I2V**（有 images）不进入 Golden Path
- MV Director / Short Drama / Batch / Audio / 其它视频模型：未见 Phase 8.1 接管
- `/run-task` 与 Legacy billing **未删除**

现网已发布客户端若未带 Flag，行为仍为 Legacy。Flag=1 的本地开发构建仅影响 **Canvas sora-2 文生** 一条路径。

---

## 8. Phase 8.1 A–G 状态矩阵（2026-09-05）

| 项 | 状态 | 备注 |
|----|------|------|
| **A. Mock E2E** | **PASS** | `phase8-1-video-golden-test-result.json` → `passed: true` |
| **B. Code Review** | **PASS** | 实现与门控仍在；报告与代码一致 |
| **C. FC Deployment** | **PASS** | promote/charge/dispatch/poll 均为 **200** |
| **D. OTS** | **PASS** | 读写 OK；FC 依赖 OK |
| **E. RunningHub Connectivity** | **NOT_RUN** | FC key PRESENT；未做真实连通性/提交 |
| **F. Live Server E2E** | **NOT_RUN** | OTS 恢复后按纪律**未**自动跑 `live-phase8-1-video-golden-path.mjs` |
| **G. Electron Canvas E2E** | **NOT_RUN** | 未做 Network 验收（create+status，无 /run-task） |

整体产品结论仍：

```text
PHASE 8.1 = NOT_READY
```

（环境已就绪，缺真实 RH Live + Canvas 验收）

---

## 9. 当前唯一阻断

**不再是 OTS / FC 404。**

当前阻断：

```text
尚未完成真实 RunningHub Live Server E2E
+
尚未完成 Electron Canvas Network 验收
```

次要注意：

- 本地 `RUNNINGHUB_API_KEY` 为空（FC 有 key，Live 脚本若走 FC dispatch 通常够用）
- 运行中客户端是否已吃到 `VITE_VIDEO_QUEUE_ENABLED=1` 未实测
- 工作区大量未提交 Phase 5–8.1 文件（恢复上下文时注意，勿误提交密钥）

---

## 10. 下一步建议（最小动作 · 待你授权后再执行）

1. （可选）确认 Electron 用当前 Flag **重启/重建**  
2. 授权后执行：`node scripts/live-phase8-1-video-golden-path.mjs`（真实 RH，非 mock）  
3. 通过后：Canvas sora-2 文生一次，确认 Network 仅 `/tasks/create` + `/tasks/status`  
4. 更新 Live E2E 报告 → 仅当全部通过才可改为 `READY_FOR_PHASE_8_2`  
5. **仍禁止** Phase 8.2 / MV / Drama / Batch / Audio / I2V

---

## 附录：本轮检查纪律遵守情况

| 动作 | 是否执行 |
|------|----------|
| 改代码 | ❌ |
| 重新部署 FC | ❌ |
| 完整 Live E2E | ❌ |
| 健康检查（OTS/FC 只读） | ✅ |
| FC env 名称级只读 | ✅ |
| 进入 Phase 8.2 | ❌ |
