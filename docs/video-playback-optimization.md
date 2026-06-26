# 视频节点播放流畅度优化

## Phase 1（已实施，低风险）

### 1. 播放中停止写入 `playbackCurrentTimeSec`

- **VideoNode** `handlePreviewPlaybackTime`：仅 `immediate === true` 时调用 `onDataChange`
- **VideoPreview**：移除 `onTimeUpdate` 上报；保留 `onSeeked` / `onPause` / `onEnded`（immediate）；全屏退出 `restorePortalFullscreen` 时 `flushPlaybackTime`
- **VideoNode** `onMouseLeave`：仍直接落盘（immediate 路径）

实时进度仍可通过 `videoPlaybackTimeRegistry` + `getCurrentTimeSec()` 读取，不影响「导出当前帧」。

### 2. 播放时禁用 poster 刷新

- `thumbPlaybackSec` effect 增加守卫：`isVideoAreaHovered && !isPaused` 时跳过

### 3. 播放时隐藏 poster 层

- `hidePosterDuringActivePlayback` → poster-layer `visibility: hidden`

### 调试统计

```javascript
localStorage.setItem('nexflow_video_perf_debug', '1')
location.reload()
// 悬停播放 30 秒
window.__nexflowVideoPerfStatsReset()
// 再播放 30 秒
window.__nexflowVideoPerfStats()
```

字段：

- `setNodesPlaybackCalls`：`playbackCurrentTimeSec` 触发的 setNodes 次数
- `playbackPersistCalls`：VideoNode 落盘调用次数
- `videoNodeRenderTotal`：VideoNode 渲染次数

---

## Phase 2：GPU 实验

见 [video-playback-gpu-test.md](./video-playback-gpu-test.md)，分支 `video-gpu-test`，**不合并主分支**。

---

## Phase 3：ComfyUI 式 FFmpeg 代理预览（未实施，评估）

### 方案

```
原视频 → FFmpeg（480p WebM/H.264）→ cache/video_previews/{hash}.webm
画布节点播代理；全屏 / 任务预览播原片
```

### 工作量（估）

| 项 | 人天 |
|----|------|
| 主进程 IPC + FFmpeg 转码队列 | 1.5 |
| 缓存键（path+mtime+目标宽）与失效 | 0.5 |
| VideoNode 双 URL（preview vs original） | 1 |
| 设置项「代理预览」开关 + i18n | 0.5 |
| 测试（本地/OSS/1080p/首次转码延迟） | 1 |
| **合计** | **约 4–5 人天** |

### 缓存占用（估）

- 480p WebM，10s 片：约 2–8 MB/条
- 100 个节点历史预览：约 200–800 MB（可 LRU 上限如 2GB）

### 性能收益（估）

- CPU 解码负担：**降 60–80%**（480p vs 1080p 像素量）
- 与 Phase 1 叠加后，画布悬停预览可达 ComfyUI VHS Advanced 同级
- 仍低于系统硬解播放器（若 GPU 仍关闭）

---

## 性能瓶颈排名（影响程度）

1. **全局 `disableHardwareAcceleration()`** — CPU 软解 1080p，全屏也无法硬解
2. **播放中 setNodes（Phase 1 前）** — 约 5 次/秒整图 state 更新
3. **poster 双层合成 + 0.5s 静帧刷新（Phase 1 前）** — 多余合成与 React 更新
4. **React Flow transform 祖先 + motion blur 淡入** — 合成路径偏重
5. **MAX_DECODERS=1** — 多视频节点时仅一路解码（单节点悬停影响小）
6. **原片直播无代理** — 相对 ComfyUI `/vhs/viewvideo` 降分辨率策略

---

## 修改前后测试数据（理论 + 调试验收）

场景：**单视频节点，悬停连续播放 30 秒**

| 指标 | 优化前 | Phase 1 后（预期） |
|------|--------|-------------------|
| `setNodes(playbackCurrentTimeSec)` / 30s | **~150**（200ms 节流 ≈5/s） | **0** |
| 落盘次数 / 30s（无 seek） | ~150 | **0**（离开/pause/ended 时 1 次） |
| poster effect 触发 / 30s | **~60**（0.5s 桶 + data 更新） | **0** |
| 合成层（播放中） | poster + video + mask | **video**（poster hidden） |
| VideoNode 重渲染 / 30s | 高（随 setNodes 级联） | **显著降低**（仅 hover/LOD 等） |

> 实测：启用 `nexflow_video_perf_debug` 后调用 `__nexflowVideoPerfStats()` 对比。

---

## 推荐上线方案

1. **立即上线 Phase 1** — 无架构变更，回归风险低；验证「导出当前帧 / 离开恢复进度 / 全屏退出进度」
2. **Phase 2 在 `video-gpu-test` 分支多机验证** — 无黑屏再考虑默认开 GPU 或「预览窗单独开 GPU」
3. **Phase 3 作为可选设置** — 默认关，高分辨率项目可开「代理预览」

---

## 风险评估

| 变更 | 风险 | 缓解 |
|------|------|------|
| Phase 1 不落盘播放进度 | 崩溃时丢失未 pause 的进度 | registry 仍读 live currentTime；离开/pause 必落盘 |
| Phase 1 隐藏 poster | 首帧闪一下 | 仍保留 decode 遮罩至 `decodedFrameReady` |
| Phase 2 开 GPU | 黑屏 / 崩溃回归 | 独立分支，不合并直至验收 |
| Phase 3 FFmpeg | 首次转码等待、磁盘占用 | 后台队列 + LRU 缓存 + 开关 |
