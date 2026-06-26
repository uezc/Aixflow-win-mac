# NEXFLOW 开发索引（会话恢复必读）

> 目的：当新会话上下文丢失时，先读取本文件，快速对齐当前项目已落地实现，避免误重构。

## 1) OSS 上传流

### 逻辑路径
- 入口配置：`src/main/config/ossConfig.ts`
- 核心模式：在主进程内置 Base64 常量 `ACCESS_KEY_ID_B64`、`ACCESS_KEY_SECRET_B64`，运行时通过 `decode()` 解码后由 `getBuiltInOSSConfig()` 返回。
- 固定参数：`region` 与 `bucket` 也在同文件固定返回，渲染层通过 IPC 间接使用，不要求用户填写凭证。

### 禁忌逻辑
- 严禁将 OSS AccessKey 方案改为“用户手动输入”。
- 严禁删除/绕过 `getBuiltInOSSConfig()` 的内置解码返回路径，导致凭证来源回退到 UI 表单。

---

## 2) 3D 交互流（Image 节点伴生模式）

### 逻辑路径
- Image 节点与触发按钮：`src/renderer/components/Canvas/ImageNode.tsx`
  - 3D 触发入口为 `3D 视角` 按钮（`Cuboid` 图标，位于节点操作区右侧一组按钮内）。
  - 控制器不是常驻渲染：仅在 `is3DPopoverOpen && threeDPopoverPosition && outputImage` 条件成立时通过 `createPortal` 渲染弹窗。
- 3D 控制器实现：`src/renderer/components/Canvas/CubeCameraController.tsx`
  - 负责 OrbitControls 拖拽、相机角度计算、贴图加载、草稿渲染模式切换与资源清理。
- 相机角度与中文提示词映射：
  - 映射定义与提示词拼装在 `src/renderer/utils/cameraControlUtils.ts`（由 `ImageNode.tsx` 中 `getPhotographyPrompt()` 调用）。
  - `ImageNode.tsx` 将 3D 相机值持久化为 `cameraControl`，并同步写入 `prompt_payload`（含中文摄影语义与下游 AI 消费字段）。

### 禁忌逻辑
- 严禁把 3D 控制器改成常驻挂载（必须保持按需渲染 Popover）。
- 关闭弹窗必须执行内存释放（WebGL/纹理/材质/RAF/控制器监听要在关闭或卸载路径被清理）。
  - 现有释放逻辑位于 `CubeCameraController.tsx` 的 `useEffect` cleanup 与资源 `dispose` 路径，禁止移除。

---

## 3) 性能策略（当前已实施）

### 逻辑路径
- 懒加载（图片进入视口才请求）：
  - `src/renderer/components/OSSImage.tsx`
  - 使用 `IntersectionObserver` 控制 `imageSrc` 注入时机，未进入视口不渲染实际 `<img>` 请求。
- 取消轮询（角色列表）：
  - `src/renderer/components/CharacterList.tsx`
  - 已改为挂载时 + `refreshTrigger` 变化时刷新，注释已明确“移除轮询以提升流畅度”。
- 边动画优化：
  - `src/renderer/components/Canvas/FlowContent.tsx`
    - 仅对“指向执行中节点”的边设置 `data.animated=true`，其余保持静态。
  - `src/renderer/components/Canvas/AnimatedGradientEdge.tsx`
    - 根据边是否在视口内（`inView`）决定是否启用 `<animate>`，视口外停止流光动画以减轻渲染压力。

### 禁忌逻辑
- 严禁恢复 `CharacterList` 的定时轮询（如 5s `setInterval`）。
- 严禁移除 `OSSImage` 的 Intersection Observer 懒加载机制。
- 严禁将所有边无差别设为动画态（必须保持“执行链路才动画”与“视口外降级”策略）。

---

## 4) 组件树结构（Workspace 拆分现状）

### 逻辑路径
- 主容器：`src/renderer/components/Workspace.tsx`
- 顶部：`src/renderer/components/Workspace/WorkspaceHeader.tsx`
- 侧栏：`src/renderer/components/Workspace/WorkspaceSidebar.tsx`
- 画布：`src/renderer/components/Canvas/FlowContent.tsx`
- 当前组织：`Workspace.tsx` 作为编排层，已将 Header / Sidebar / Canvas 拆分并通过 props 连接状态与回调。

### 禁忌逻辑
- 严禁在未确认前将已拆分的 Header/Sidebar/Canvas 重新回卷进单文件大组件。
- 严禁未经需求确认进行跨层重构（尤其是 `Workspace.tsx` 与 `FlowContent.tsx` 的职责边界）。

---

## 会话恢复操作约定

- 每次新会话开始时，先读取本文件，再进行任何改动建议或代码修改。
- 若发现实现与本索引不一致，先向用户确认再动手，默认以“当前代码已实现逻辑”为准，不擅自重构。

---

## 5) 项目整体架构分析（当前代码实况）

### UI 逻辑总览（Workspace 拆分 + Canvas 编排）
- 路由入口：`src/renderer/App.tsx`
  - `/workspace/:projectId` 懒加载 `Workspace`。
- 页面编排层：`src/renderer/components/Workspace.tsx`
  - 顶层拆分为 `WorkspaceHeader` + `WorkspaceSidebar` + `FlowContent`。
  - `Workspace.tsx` 负责状态编排、节点/边数据、任务列表、AI 状态监听、输入面板弹层。
- 头部与侧栏：
  - `src/renderer/components/Workspace/WorkspaceHeader.tsx`
  - `src/renderer/components/Workspace/WorkspaceSidebar.tsx`
- 画布核心：
  - `src/renderer/components/Canvas/FlowContent.tsx`
  - 承载 ReactFlow、右键菜单、连线校验、边动画、批量运行、缩放与小地图。

### 3D 伴生弹窗机制（Image 节点）
- 位置与触发：`src/renderer/components/Canvas/ImageNode.tsx`
  - 在 Image 节点操作区通过 `Cuboid` 图标按钮触发 `3D 视角`。
  - 关键状态：`is3DPopoverOpen`、`threeDPopoverPosition`、`cameraValue`、`webglAvailable`。
- 按需渲染条件：
  - 按钮显示：`selected && outputImage`
  - 弹窗渲染：`is3DPopoverOpen && threeDPopoverPosition && outputImage` 时 `createPortal(...)` 到 `document.body`。
- 定位与关闭：
  - 以节点包围盒居中定位（`updateThreeDPopoverPosition`），监听滚动/缩放/尺寸变化持续纠偏。
  - 支持按钮切换关闭、点击外部关闭、失焦自动关闭、手动 X 关闭。
- 相机与提示词映射：
  - `src/renderer/utils/cameraControlUtils.ts` 提供 `getPhotographyPrompt(...)` 与预设值。
  - `ImageNode.tsx` 持久化 `cameraControl`，并写入 `prompt_payload` 供后续 AI 节点消费。

### 数据流总览（图片/视频任务）
- 前端触发层：
  - 图片：`src/renderer/components/Canvas/ImageInputPanel.tsx`
  - 视频：`src/renderer/components/Canvas/VideoInputPanel.tsx`
  - 统一通过 `src/renderer/hooks/useAI.ts` 发起 `window.electronAPI.invokeAI(...)`。
- IPC 暴露层：
  - `src/preload/index.ts` 暴露 `invokeAI`、`onAIStatusUpdate`、`uploadImageToOSS`、`uploadVideoToOSS`、`autoSaveImage`、`autoSaveVideo`、`saveTasks`、`loadTasks` 等接口。
- 主进程入口层：
  - `src/main/index.ts` 处理 `ipcMain.handle('ai:invoke')`，交由 `AICore`。
  - 同时提供 `upload-image-to-oss`、`upload-video-to-oss`、`auto-save-image`、`auto-save-video`、`save-tasks`、`load-tasks`。
- AI/Provider 层：
  - `src/main/ai/AICore.ts` 分发到 Provider 并广播状态。
  - `src/main/ai/providers/ImageProvider.ts`、`src/main/ai/providers/VideoProvider.ts` 处理生成、轮询、URL 归一与 OSS 上传。
  - OSS 客户端凭证由 `src/main/config/ossConfig.ts` 的内置 Base64 解码配置提供。
- 前端回写层：
  - `useAI.ts` + `Workspace.tsx` 的 AI 状态回调将结果写回节点 data（`outputImage/outputVideo/localPath/...`）。
  - 同步更新任务列表（图片 `handleAddTask`、视频 `handleAddVideoTask`）并通过 IPC 持久化。

---

## 6) 项目核心逻辑图（会话恢复用）

### 图 A：UI 组件关系图（Workspace 拆分后）

```text
AppRouter (/workspace/:projectId)
  -> Workspace.tsx (编排层)
     -> WorkspaceHeader.tsx
     -> WorkspaceSidebar.tsx
     -> ReactFlowProvider
        -> FlowContent.tsx (画布交互核心)
           -> NodeTypes: MinimalistText / LLM / Image / Video / Character / Audio / TextSplit / Text
     -> 输入面板弹层: LLMInputPanel / ImageInputPanel / VideoInputPanel / CharacterInputPanel / AudioInputPanel
```

### 图 B：Image 3D 伴生弹窗图

```text
ImageNode (selected && outputImage)
  -> 点击 "3D 视角" (Cuboid) 按钮
     -> is3DPopoverOpen = true
     -> 计算 threeDPopoverPosition
     -> createPortal 渲染 3D Popover
        -> CubeCameraController (R3F + OrbitControls)
        -> cameraControlUtils.getPhotographyPrompt
        -> persistCameraValue 写回 cameraControl + prompt_payload
  -> 关闭路径:
     - 再次点击按钮 / 点击外部 / X 按钮 / 节点失选
     - 触发清理: RAF、纹理、材质、controls、webgl 资源释放
```

### 图 C：图片/视频任务数据流图（点击 -> OSS -> 展示）

```text
Renderer Panel Click (ImageInputPanel/VideoInputPanel)
  -> useAI.executeAI()
  -> preload.electronAPI.invokeAI('ai:invoke')
  -> main ipcMain('ai:invoke') -> AICore.invoke()
  -> Provider(ImageProvider/VideoProvider)
     -> (必要时) uploadImageToOSS/uploadVideoToOSS
        -> getBuiltInOSSConfig() (Base64 解码凭证)
        -> 阿里云 OSS
     -> onStatus START/PROCESSING/SUCCESS/ERROR
  -> preload.onAIStatusUpdate -> Renderer(useAI/Workspace)
  -> 节点数据回写(outputImage/outputVideo/localPath/originalUrl)
  -> 任务列表写入(handleAddTask/handleAddVideoTask)
  -> saveTasks + autoSaveImage/autoSaveVideo
  -> Sidebar/Preview 展示（优先本地路径，失败回退远程 URL）
```

---

## 7) 核心约束清单（新增补充）

- OSS 凭证策略：必须保持 `src/main/config/ossConfig.ts` 内置 Base64 解码；严禁改为用户手填 AK/SK。
- 3D 策略：必须保持按需渲染 Popover；严禁改常驻 3D 控制器；关闭/卸载必须保留资源释放逻辑。
- 性能策略：
  - 图片懒加载（`OSSImage.tsx` + `IntersectionObserver`）不得移除。
  - 角色列表轮询已取消（`CharacterList.tsx`），严禁恢复定时轮询。
  - 边动画必须保持“仅执行链路动画 + 视口外降级静态”（`FlowContent.tsx` + `AnimatedGradientEdge.tsx`）。
  - 连线与节点联动必须使用“受影响子图更新”（仅目标节点及其直接来源），禁止恢复全量 `nodes.map + edges.filter` 扫描。
  - 节点拖拽期间禁止 IPC 写盘；仅在 `onNodeDragStop` 触发最终脏检查后执行一次落盘。

---

## 8) 本地资源路径管理规范（图片轻量化）

### 目标
- 禁止在画布节点与输入面板中长期持有大体积 `data:` URL，避免 JS 堆暴涨与拖拽卡顿。
- 所有“上传/拖入/粘贴”图片统一走本地资源管理，生成：
  - 原图：`<name>-<id>.<ext>`
  - 预览图：`<name>-<id>_preview.jpg`

### 逻辑路径
- 主进程资源管理：`src/main/services/localResourceManager.ts`
  - `createImageResourceFromFile(projectId, sourceFilePath)`
  - `createImageResourceFromBuffer(projectId, fileName, buffer)`
- IPC：
  - `local-resource:create-image-from-file`
  - `local-resource:create-image-from-buffer`
- 预加载桥接：`src/preload/index.ts`
  - `createImageLocalResourceFromFile(...)`
  - `createImageLocalResourceFromBuffer(...)`
- 渲染层入口：
  - `ImageNode` 上传图片：`src/renderer/components/Canvas/ImageNode.tsx`
  - 画布拖入图片：`src/renderer/components/Workspace.tsx` `onDrop`
  - 粘贴图片：`src/renderer/components/Workspace.tsx` `handlePaste`

### 强制约束
- 画布与输入面板展示路径 **必须** 使用 `_preview.jpg`（`outputImage` 指向 preview）。
- 原图路径仅作为资源保留（如 `originalImageUrl/localPath`），不得回写为 UI 主展示地址。
- 新增图片入口（未来功能）必须复用 `LocalResourceManager`，不得直接写入 `data:` URL 到节点数据。

### Dual-Path 资产管理模式（第二阶段）
- 连线资产采用双路径对象：`{ preview, original, width, height }`。
- 规则：
  - `renderer` 层组件默认只读取 `preview`（轻量显示）。
  - 提交给 AI Provider 前，自动由 Provider 将 `_preview` 路径解析回 `original`（高画质推理）。
  - `renderer` 层严禁直接读取 `originalUrl`，除非在大图查看器模式下。

### 性能优化规范（第三阶段：子图 + LOD + I/O 隔离）
- 子图计算：
  - `onEdgesChange` 只重算受影响 `target` 节点，不得全量遍历所有节点。
  - 仅处理“变更边 + 直接关联 Source/Target”，避免拖线时 CPU 峰值抖动。
- 视口分级渲染（LOD）：
  - 统一三段阈值（`ImageNode` / `VideoNode` / `TextNode` / `LLMNode` / `AudioNode`）：
    - 近景：`zoom >= 0.5`，完整内容渲染（视频可播放）。
    - 中景：`0.1 <= zoom < 0.5`，轻量内容渲染（缩略预览/简化内容，隐藏复杂控件）。
    - 远景：`zoom < 0.1`，图标化占位（图标 + 标题）。
  - 额外子阈值：`zoom < 0.08` 时可使用纯图标极简占位；`zoom >= 0.1` 必须可见缩略内容（不能退化为纯占位）。
  - 远景状态应卸载重资源（如 `<video>` 播放）以降低 GPU 与解码内存占用；中景视频默认展示封面帧并暂停。
  - `zoom < 0.2` 时，图片优先加载 `Tiny-Thumb(64px)`，避免在超大画布缩放/移动时请求 1280 预览图。
  - 占位方案采用 `Ghost-Base64(24px, q=10%)`：节点挂载立即显示 `imageAsset.ghost`（`blur(5px)`）作为底图。
  - 图片加载采用“异步分片纹理调度器（Queue Manager）”，并发上限 3；优先级：视口中心 500px > 视口内 > 缓冲区。
  - 视口外超过 2 屏距离时必须卸载 `<img src>`（仅保留 ghost 占位），释放显存与解码占用。
- 主进程资源处理：
  - `LocalResourceManager` 生成三份资产：`original`、`_preview(1280)`、`_tiny(64)`，并计算 `avgColorHex`。
  - `sharp` 解码任务必须受并发上限控制（限流），避免 CPU 瞬时打满导致 UI 卡顿。
- I/O 隔离：
  - 拖拽过程中仅更新内存状态和哈希缓存，不允许 `saveProjectData`。
  - `onNodeDragStop` 执行一次最终 hash 脏检查并落盘。
- 持久化纯净化：
  - `save-project-data` 前必须过滤动态字段：`progress`、`progressMessage`、`tempUIState`、`_isResizing` 等运行时态字段。
