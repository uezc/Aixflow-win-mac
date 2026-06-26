import devOverrides from './perf.dev.json';

/** [彻底静默化] 硬编码 true 时：perfLevel 恒为 0，禁用 FPS 监测、velocity 广播、emergencyFreeze */
export const SILENCE_PERF_MONITOR = true;

/** [Tapnow] true 时：isInteracting 期间断开 FPS/velocity/LOD 等非核心订阅，主线程仅执行原生 transform 同步 */
export const TAPNOW_INTERACTION_SUSPEND = true;

/** svg = TapNow / RunningHub 无限画布：React Flow 内置 SVG 边，与 viewport 同矩阵；auto = 超大图才切 Canvas */
export type EdgeRenderMode = 'svg' | 'auto';

type PerfPolicy = {
  edgeRenderMode: EdgeRenderMode;
  prefetchScreenFactor: number;
  fpsP1Threshold: number;
  velocityEmitIntervalMs: number;
  edgeCanvasSwitchEdgeCount: number;
  /** 模块总数超过此值时，缩放过程中将连线切换到 Canvas 模式以减轻重绘 */
  edgeCanvasSwitchNodeCount: number;
  /** 节点数超过此值时，拖拽期间使用原生 RAF 同步位置，不经过 React onNodesChange */
  nativePositionSyncNodeCount: number;
  /** 节点数达到此值后启用视口剔除（屏外不挂载 DOM） */
  guillotineMinNodeCount: number;
  /** 静止时视口扩展倍数（相对屏幕宽/高，每侧） */
  guillotinePaddingScreenFactor: number;
  /** 平移/缩放时扩展倍数（更大，避免缩放时节点误消失） */
  guillotinePaddingPanFactor: number;
  crossFadeMs: number;
  interactionUnlockDelayMs: number;
  lowResOpacity: number;
  lodHysteresis: number;
  farPlaceholderHysteresis: number;
};

const DEFAULT_PERF_POLICY: PerfPolicy = {
  edgeRenderMode: 'svg',
  prefetchScreenFactor: 2.0,
  fpsP1Threshold: 59,
  velocityEmitIntervalMs: 80,
  /** auto 模式：约 100 节点峰值才切 Canvas 连线；日常 ≤50 保持 SVG（TapNow 手感） */
  edgeCanvasSwitchEdgeCount: 150,
  edgeCanvasSwitchNodeCount: 100,
  /** ≥35 节点拖拽时走原生位置同步，减轻 50 节点工程拖模块卡顿 */
  nativePositionSyncNodeCount: 35,
  /** ≥25 节点启用视口剔除（100 节点峰值时屏外 DOM 不挂载） */
  guillotineMinNodeCount: 25,
  /** 50 节点工程：预取环稍大，快拖回视口时图/视频仍在 */
  guillotinePaddingScreenFactor: 2.0,
  guillotinePaddingPanFactor: 2.5,
  crossFadeMs: 150,
  interactionUnlockDelayMs: 100,
  lowResOpacity: 0.6,
  lodHysteresis: 0.06, // 加大迟滞，减少缩放时 LOD 切换频率
  farPlaceholderHysteresis: 0.08, // 加大迟滞，避免缩放时 placeholder↔图像 频繁切换导致刷新
};

function toSafeNumber(value: unknown, fallback: number, min: number, max: number) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

export const PERF_POLICY: PerfPolicy = import.meta.env.DEV
  ? {
      edgeRenderMode:
        (devOverrides as { edgeRenderMode?: string }).edgeRenderMode === 'auto' ? 'auto' : 'svg',
      prefetchScreenFactor: toSafeNumber(devOverrides.prefetchScreenFactor, DEFAULT_PERF_POLICY.prefetchScreenFactor, 0, 3),
      fpsP1Threshold: toSafeNumber(devOverrides.fpsP1Threshold, DEFAULT_PERF_POLICY.fpsP1Threshold, 20, 60),
      velocityEmitIntervalMs: toSafeNumber(devOverrides.velocityEmitIntervalMs, DEFAULT_PERF_POLICY.velocityEmitIntervalMs, 16, 500),
      edgeCanvasSwitchEdgeCount: toSafeNumber(devOverrides.edgeCanvasSwitchEdgeCount, DEFAULT_PERF_POLICY.edgeCanvasSwitchEdgeCount, 1, 5000),
      edgeCanvasSwitchNodeCount: toSafeNumber((devOverrides as any).edgeCanvasSwitchNodeCount, DEFAULT_PERF_POLICY.edgeCanvasSwitchNodeCount, 1, 5000),
      nativePositionSyncNodeCount: toSafeNumber((devOverrides as any).nativePositionSyncNodeCount, DEFAULT_PERF_POLICY.nativePositionSyncNodeCount, 1, 5000),
      guillotineMinNodeCount: toSafeNumber((devOverrides as any).guillotineMinNodeCount, DEFAULT_PERF_POLICY.guillotineMinNodeCount, 1, 5000),
      guillotinePaddingScreenFactor: toSafeNumber(
        (devOverrides as any).guillotinePaddingScreenFactor,
        DEFAULT_PERF_POLICY.guillotinePaddingScreenFactor,
        0,
        5,
      ),
      guillotinePaddingPanFactor: toSafeNumber(
        (devOverrides as any).guillotinePaddingPanFactor,
        DEFAULT_PERF_POLICY.guillotinePaddingPanFactor,
        0,
        5,
      ),
      crossFadeMs: toSafeNumber(devOverrides.crossFadeMs, DEFAULT_PERF_POLICY.crossFadeMs, 0, 1000),
      interactionUnlockDelayMs: toSafeNumber(
        devOverrides.interactionUnlockDelayMs,
        DEFAULT_PERF_POLICY.interactionUnlockDelayMs,
        0,
        1000
      ),
      lowResOpacity: toSafeNumber(devOverrides.lowResOpacity, DEFAULT_PERF_POLICY.lowResOpacity, 0, 1),
      lodHysteresis: toSafeNumber(devOverrides.lodHysteresis, DEFAULT_PERF_POLICY.lodHysteresis, 0, 0.2),
      farPlaceholderHysteresis: toSafeNumber(
        devOverrides.farPlaceholderHysteresis,
        DEFAULT_PERF_POLICY.farPlaceholderHysteresis,
        0,
        0.2
      ),
    }
  : DEFAULT_PERF_POLICY;

