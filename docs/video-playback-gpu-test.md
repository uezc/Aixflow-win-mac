# 视频播放 GPU 实验分支（video-gpu-test）

> **勿合并主分支**，仅用于验证恢复硬件加速后的黑屏回归与播放帧率。

## 创建 / 切换分支

```powershell
cd D:\NEXFLOW
git checkout -b video-gpu-test
```

## 修改 `src/main/index.ts`

将以下段落：

```typescript
// 【解决黑屏】保留 disableHardwareAcceleration；允许软件光栅化以便在无 GPU 时仍能出图
app.commandLine.appendSwitch('disable-gpu');
// app.commandLine.appendSwitch('disable-software-rasterizer');
app.disableHardwareAcceleration();
```

替换为：

```typescript
// 【video-gpu-test 实验】恢复 Chromium GPU / 硬解，验证播放流畅度；黑屏回归则回退
// app.commandLine.appendSwitch('disable-gpu');
// app.disableHardwareAcceleration();
```

## 测试步骤

1. **完全重启 Electron**（主进程改动必须冷启动）
2. 打开含 1080p 视频节点的工程
3. 画布静止 + 鼠标悬停节点内视频，播放 30 秒
4. 点击控件全屏，播放 30 秒
5. 打开任务管理器，记录 **Electron CPU %** 与 **GPU Video Decode**（若有）

## 记录项

| 项目 | 主分支 (GPU 关) | video-gpu-test |
|------|-----------------|----------------|
| 启动是否黑屏 | | |
| 画布 UI 是否正常 | | |
| 1080p 悬停播放主观流畅度 (1–5) | | |
| 全屏播放主观流畅度 (1–5) | | |
| 播放 30s 平均 CPU % | | |
| DevTools Performance 主线程尖峰 | | |

## 性能调试统计（Phase 1 已合入时）

DevTools Console：

```javascript
localStorage.setItem('nexflow_video_perf_debug', '1')
location.reload()
// 播放 30 秒后
window.__nexflowVideoPerfStats()
```

## 回退

```powershell
git checkout main
```

主分支保持 `disable-gpu` + `disableHardwareAcceleration()` 不变。
