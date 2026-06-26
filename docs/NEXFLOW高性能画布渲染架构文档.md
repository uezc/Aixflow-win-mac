# NEXFLOW 高性能画布渲染架构文档

**版本**: 1.0  
**更新日期**: 2025-03  
**适用范围**: NEXFLOW 画布渲染系统、CanvasEngine、EdgeCanvasLayer、EdgeCanvasHitLayer

---

## 1. 架构总览

### 1.1 架构变革：从 React 驱动到 Canvas 引擎独立驱动

**传统模式（React 驱动）**：
- 画布 transform 由 React Flow 的 Zustand store 管理
- 每次 Pan/Zoom 触发 `useStore(transform)`，导致 FlowContent、EdgeCanvasLayer 等组件全树重渲染
- 连接线依赖 props 传入的 transform，渲染节奏与 React 生命周期强耦合
- 大规模节点场景下，60fps 交互难以保证

**当前模式（Canvas 引擎独立驱动）**：
- **CanvasEngine** 作为画布 transform 的唯一数据源（Source of Truth）
- React Flow store 通过 `store.subscribe()` 单向同步到 CanvasEngine，**不触发 React setState**
- EdgeCanvasLayer 由 `requestAnimationFrame` 驱动，每帧从 CanvasEngine 读取 transform
- Pan/Zoom 时仅更新 CanvasEngine 内部矩阵，渲染层完全脱离 React 更新循环

### 1.2 CanvasEngine 作为唯一数据源

```
┌─────────────────────────────────────────────────────────────────────┐
│                        React Flow Store                             │
│  (transform 由用户 Pan/Zoom 更新，React 内部状态)                    │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ store.subscribe() 单向同步
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      CanvasEngine (Source of Truth)                  │
│  • targetTransform  ← 来自 React Flow                                │
│  • currentTransform ← Lerp 插值后的渲染用值                           │
│  • draggingNode     ← 节点拖拽期间的实时位置                          │
│  • flowToScreenPosition / screenToFlowPosition (Math.round 取整)     │
└──────────────┬──────────────────────────────────┬───────────────────┘
               │ tick() 每帧 Lerp + notify         │ subscribe()
               ▼                                  ▼
┌──────────────────────────────┐    ┌─────────────────────────────────┐
│    EdgeCanvasLayer           │    │    EdgeCanvasHitLayer            │
│  • RAF 驱动 drawFrame        │    │  • 订阅 (transform, draggingNode)│
│  • getTransform()            │    │  • SVG 热区与 Canvas 像素级一致  │
│  • flowToScreenPosition()    │    │  • 不依赖 React props 更新       │
└──────────────────────────────┘    └─────────────────────────────────┘
```

**解耦效果**：
- **渲染层**：EdgeCanvasLayer 不订阅 React 状态，由 RAF 独立驱动
- **交互层**：HitLayer 通过 `canvasEngine.subscribe()` 获取与 Canvas 同源的 transform
- **逻辑层**：FlowContent 保留 `useStore(transform)` 用于 VideoNode 快照、guillotine 等业务逻辑，但不影响画布渲染节奏

---

## 2. 渲染管道（Render Pipeline）

### 2.1 requestAnimationFrame 驱动模式

**EdgeCanvasLayer** 在 `enabled` 时启动独立 RAF 循环：

```typescript
// 简化流程
useEffect(() => {
  if (!enabled) return;
  const runLoop = () => {
    drawFrame();
    rafIdRef.current = requestAnimationFrame(runLoop);
  };
  rafIdRef.current = requestAnimationFrame(runLoop);
  return () => cancelAnimationFrame(rafIdRef.current);
}, [enabled, runLoop]);
```

**每帧执行顺序**：
1. `ctx.clearRect()` 清空画布
2. `canvasEngine.tick()` — Lerp 插值 + 通知订阅者
3. DPR 缩放、0.5px 平移
4. 根据 `getPanning()` 切换抗锯齿质量
5. 遍历 edges，调用 `getNodeHandle` 获取端点，`buildBezierPathD` 生成路径，`transformPathToScreen` 转为 Path2D
6. `ctx.stroke(path)` 绘制
7. 若有 `getDraggingNode()`，绘制半透明影子矩形

### 2.2 消除锯齿与虚线感的技术路径

| 技术点 | 实现方式 | 作用 |
|--------|----------|------|
| **DPR 适配** | `canvas.width = viewportWidth * dpr`，`ctx.scale(dpr, dpr)` | 高 DPI 屏清晰渲染，避免拉伸模糊 |
| **Math.round 取整** | `flowToScreenPosition` / `screenToFlowPosition` 输出 `Math.round()` | 消除亚像素抖动，任意缩放级别无小数异常 |
| **ctx.translate(0.5, 0.5)** | 在 `scale(dpr)` 之后、绘制路径前执行 | 1px 实线对齐物理像素网格，消除虚线感 |
| **shadowBlur = 0.5** | 静止时对每条线设置 `ctx.shadowBlur`、`ctx.shadowColor` | 利用 GPU 阴影生成亚像素过渡，防止细线断裂 |
| **path 坐标 toFixed(1)** | `buildBezierPathD` 内控制点使用 `.toFixed(1)` | 限制浮点精度，避免 Canvas 采样漂移 |
| **lineDashOffset = 0** | 绘制前显式设置 | 像素重采样修正 |
| **智能线宽** | `Math.max(1.5, 2.5 / Math.pow(zoom, 0.3)) * edgeThickness` | 缩小时线宽减小更慢，保持实心感（ComfyUI 风格） |
| **RGBA 弱透明** | `rgba(156,163,175,0.96)` 等 | 亚像素 Blend 抗锯齿 |

### 2.3 动态抗锯齿质量切换

- **平移中** (`getPanning() === true`)：`imageSmoothingQuality = 'low'`，`shadowBlur = 0`
- **静止时**：`imageSmoothingQuality = 'high'`，`shadowBlur = 0.5`

平移时降低质量以保 60fps，静止时恢复画质。

---

## 3. 交互性能优化（Interaction Layer）

### 3.1 HitLayer 与 EdgeCanvasLayer 同源对齐

**问题**：点击热区（SVG path）与 Canvas 绘制的连接线若使用不同 transform 来源，会产生偏移。

**方案**：HitLayer 与 EdgeCanvasLayer 均从 **CanvasEngine** 读取数据。

| 组件 | 数据来源 | 更新机制 |
|------|----------|----------|
| EdgeCanvasLayer | `canvasEngine.getTransform()`、`flowToScreenPosition()` | 每帧 RAF 中 `tick()` 后读取 |
| EdgeCanvasHitLayer | `canvasEngine.subscribe((t, draggingNode) => setState(...))` | 每次 `tick()` 通知时更新 state |

`tick()` 每帧执行并调用 `listeners.forEach(fn => fn(currentTransform, draggingNode))`，HitLayer 因此与 Canvas 保持**同源**，热区与连线像素级一致。

### 3.2 Lerp 平滑插值

**公式**：`current[i] += (target[i] - current[i]) * 0.2`（i = 0,1,2 对应 tx, ty, zoom）

**应用场景**：
- **Pan/Zoom**：React Flow 更新 target，`tick()` 每帧将 current 向 target 逼近，实现惯性阻尼感
- **节点拖拽**：不直接作用于 transform，但 `draggingNode` 与 current transform 配合，实现影子与连线平滑跟随

**初始同步**：首次 `setTransform` 时若 `!_hasInitialSync`，则 `current = target`，避免首帧跳变。

### 3.3 节点拖拽实时影子与连接线重算

**数据流**：
1. `onNodeDrag` / `onNodeDragStart` 调用 `canvasEngine.setDraggingNode(nodeId, { x, y, width, height })`
2. `onNodeDragStop` 调用 `canvasEngine.setDraggingNode(null, null)`

**连接线重算**：`getNodeHandle` 接受 `draggingOverride` 参数，当 `draggingOverride.nodeId === edge.source` 或 `edge.target` 时，使用 override 的 (x, y, width, height) 计算 handle 位置，实现**连接线实时跟随**。

**影子渲染**：`drawFrame` 末尾若 `getDraggingNode()` 非空，则用 `flowToScreenPosition` 将节点矩形转为屏幕坐标，绘制半透明圆角矩形，不触发 React 更新。

**原生位置同步**：`nativeNodePositionSync` 的 `currentActivePositionsMap` 作为节点位置缓存，`getNodeHandle` 优先从 nodesMap 与 draggingOverride 读取，fallback 到该 Map 或 DOM，保证线与节点同源。

---

## 4. 性能状态控制

### 4.1 已实施的性能优化策略

| 策略 | 实现位置 | 说明 |
|------|----------|------|
| 动态抗锯齿切换 | EdgeCanvasLayer drawFrame | Pan 时 low，静止时 high |
| FPS 监控 | EdgeCanvasLayer runLoop | 开发模式每秒输出 `[NEXFLOW] 画布渲染 FPS: XX` |
| 视口剔除 | drawFrame 内 | `srcOutside && tgtOutside` 时跳过边缘绘制 |
| 密度阈值切换 | FlowContent | `useEdgeCanvasForDensity`：nodes>5000 或 edges>5000 时启用 Canvas 连线 |
| 原生位置同步 | nativeNodePositionSync | 节点>50 时拖拽不经过 React onNodesChange，直接写 DOM |
| 节点断头台 | renderedNodes useMemo | 节点>80 且非交互时，仅渲染视口+padding 内节点 |
| 波点隐藏 | FlowDotBackground | zoom < 53% 时隐藏背景波点 |
| 固定画布尺寸 | FlowContent | MAX_CANVAS_SIZE=8000，不随内容拉伸 |

### 4.2 大规模节点前置设计

- **PERF_POLICY**（`perfPolicy.ts`）：`edgeCanvasSwitchNodeCount`、`edgeCanvasSwitchEdgeCount`、`nativePositionSyncNodeCount` 可配置
- **guillotine**：视口外节点不渲染，padding=2 倍视口
- **FlowDotBackground**：zoom < 53% 不渲染波点，降低重绘
- **TAPNOW_INTERACTION_SUSPEND**：交互期间断开非核心订阅，减少主线程压力
- **SILENCE_PERF_MONITOR**：可关闭 FPS 等监控以降低开销

---

## 5. 潜在技术债务与后续演进

### 5.1 第二阶段/第三阶段重构中的折中方案

| 折中 | 原因 | 影响 |
|------|------|------|
| **Lerp 与 React Flow viewport 不同步** | CanvasEngine 的 current 滞后于 React Flow 的 target，仅 Canvas 层使用 current | 极端快速 Pan 时，连线可能略滞后于节点，可接受 |
| **HitLayer 每帧订阅更新** | `tick()` 每帧 notify，HitLayer 可能 60 次/秒 setState | 依赖 React 批处理与浅比较，未来可考虑 ref+强制重绘替代 |
| **节点影子仅中心矩形** | TextSplit 等多 handle 节点的拖拽影子未区分 output 位置 | 视觉近似足够，复杂节点可后续增强 |
| **坐标取整丢失亚像素** | `Math.round` 输出整数，极精细布局可能产生 1px 误差 | 对连线与热区可接受 |
| **FPS 仅开发模式** | `import.meta.env.DEV` 下才输出 | 生产环境无监控，可后续加开关 |

### 5.2 超大规模节点（1000+）虚拟化渲染 Roadmap

**Phase 1：边虚拟化（当前部分具备）**
- [x] 视口外边不绘制（已实现）
- [ ] 边按视口分块缓存 Path2D，减少重复解析
- [ ] 超远边（如 zoom<10%）降级为直线或省略

**Phase 2：节点虚拟化**
- [ ] 仅渲染视口内节点，视口外渲染轻量 placeholder（当前 guillotine 已有雏形）
- [ ] 节点按空间索引（如 R-tree/Grid）做快速视口查询
- [ ] 占位符与真实节点切换时的交叉淡入淡出

**Phase 3：Canvas 分层与离屏缓存**
- [ ] 将静态/低频更新内容绘制到离屏 Canvas，主 Canvas 只合成
- [ ] 分层：背景波点 / 边 / 节点 / 拖拽影子，按更新频率拆分
- [ ] 缩略图/小地图使用降采样缓存

**Phase 4：WebWorker 预计算**
- [ ] 将 Path2D 解析、坐标变换等移至 Worker
- [ ] 主线程仅负责 `ctx.drawImage` 或路径绘制
- [ ] 考虑 OffscreenCanvas 支持情况

**Phase 5：增量更新与脏区**
- [ ] 仅重绘发生变化的区域（dirty rect）
- [ ] 结合 React Flow 的 nodeInternals 变更检测，减少全量遍历

---

## 附录：核心文件索引

| 文件 | 职责 |
|------|------|
| `src/renderer/utils/CanvasEngine.ts` | transform 管理、Lerp、坐标转换、draggingNode |
| `src/renderer/components/Canvas/EdgeCanvasLayer.tsx` | RAF 驱动连接线绘制、抗锯齿、影子 |
| `src/renderer/components/Canvas/EdgeCanvasHitLayer.tsx` | SVG 热区、订阅 CanvasEngine |
| `src/renderer/utils/nativeNodePositionSync.ts` | 拖拽时节点位置 RAF 同步、currentActivePositionsMap |
| `src/renderer/config/perfPolicy.ts` | 性能策略与阈值配置 |
| `src/renderer/components/Canvas/FlowContent.tsx` | store 同步、CanvasEngine 实例、事件回调 |
