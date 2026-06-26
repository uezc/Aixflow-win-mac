import { useRef, useSyncExternalStore } from 'react';
import { PERF_POLICY, SILENCE_PERF_MONITOR, TAPNOW_INTERACTION_SUSPEND } from '../config/perfPolicy';

type InteractionSnapshot = {
  isGlobalInteracting: boolean;
  /** 零闪烁：缩放/拖拽期间为 true，结束 300ms 后才 false，冻结 LOD/unmount */
  isInteracting: boolean;
  visualLockState: 'interacting_locked' | 'cooldown' | 'unlocked';
  isVisualInteractionLocked: boolean;
  velocityX: number;
  velocityY: number;
  runtimeFps: number;
  /** 画布连接线 Canvas 的真实绘制帧率（EdgeCanvasLayer drawFrame 次数/秒），静止时为 0 */
  canvasDrawFps: number;
  perfLevel: 0 | 1 | 2 | 3;
  emergencyVideoFreezeUntilMap: Record<string, number>;
  emergencyUnloadCount: number;
  /** 当前悬停的视频节点 ID，全局唯一：只有该节点播放，其他全部暂停 */
  hoveredVideoNodeId: string | null;
  /** 全局单例播放：仅此 ID 挂载 video 并播放，其余显示 poster/缓存帧并 releaseVideo */
  activeVideoNodeId: string | null;
  /** VideoNode 使用的视口快照，交互期间冻结，避免订阅 transform 触发重渲染 */
  videoViewportSnapshot: { x: number; y: number; zoom: number };
  /** 正在退出到项目列表，Workspace 停止渲染重型节点，仅保留加载动画 */
  isExiting: boolean;
  /** 视频剪辑节点全屏时的节点 ID，全屏时按退格键不删除该节点 */
  videoSpliceFullscreenNodeId: string | null;
};

let snapshot: InteractionSnapshot = {
  isGlobalInteracting: false,
  isInteracting: false,
  visualLockState: 'unlocked',
  isVisualInteractionLocked: false,
  velocityX: 0,
  velocityY: 0,
  runtimeFps: 0,
  canvasDrawFps: 0,
  perfLevel: 0,
  emergencyVideoFreezeUntilMap: {},
  emergencyUnloadCount: 0,
  hoveredVideoNodeId: null,
  activeVideoNodeId: null,
  videoViewportSnapshot: { x: 0, y: 0, zoom: 1 },
  isExiting: false,
  videoSpliceFullscreenNodeId: null,
};

let activeVideoClearTimer: ReturnType<typeof setTimeout> | null = null;
const ACTIVE_VIDEO_LEAVE_DEBOUNCE_MS = 100;

// 拖拽/缩放期间速度值会高频变化；这里做全局限流，避免每帧广播导致全节点重渲染。
const VELOCITY_EMIT_INTERVAL_MS = PERF_POLICY.velocityEmitIntervalMs;
const VELOCITY_EPSILON = 45;
const VELOCITY_QUANTIZE_STEP = 25;
let lastVelocityEmitAt = 0;

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function setGlobalInteracting(next: boolean) {
  if (snapshot.isGlobalInteracting === next) return;
  const wasInteracting = snapshot.isGlobalInteracting;
  snapshot = { ...snapshot, isGlobalInteracting: next };
  if (next) {
    snapshot = { ...snapshot, isInteracting: true };
  } else {
    snapshot = { ...snapshot, isInteracting: false };
  }
  emit();
  if (wasInteracting && !next && snapshot.hoveredVideoNodeId == null) {
    scheduleClearActiveVideoNodeId();
  }
}

/** 更新 VideoNode 视口快照，仅当 !isInteracting 时更新，交互期间冻结 */
export function setVideoViewportSnapshot(x: number, y: number, zoom: number) {
  if (snapshot.isInteracting) return;
  const prev = snapshot.videoViewportSnapshot;
  if (prev.x === x && prev.y === y && prev.zoom === zoom) return;
  snapshot = { ...snapshot, videoViewportSnapshot: { x, y, zoom } };
  emit();
}

export function setGlobalVisualLockState(next: InteractionSnapshot['visualLockState']) {
  if (snapshot.visualLockState === next) return;
  snapshot = {
    ...snapshot,
    visualLockState: next,
    isVisualInteractionLocked: next !== 'unlocked',
  };
  emit();
}

export function setGlobalViewportVelocity(velocityX: number, velocityY: number) {
  if (SILENCE_PERF_MONITOR || (TAPNOW_INTERACTION_SUSPEND && snapshot.isGlobalInteracting)) return;
  const now = Date.now();
  const quantizedX = Math.round(velocityX / VELOCITY_QUANTIZE_STEP) * VELOCITY_QUANTIZE_STEP;
  const quantizedY = Math.round(velocityY / VELOCITY_QUANTIZE_STEP) * VELOCITY_QUANTIZE_STEP;
  const deltaX = Math.abs(snapshot.velocityX - quantizedX);
  const deltaY = Math.abs(snapshot.velocityY - quantizedY);
  const becameZero = (snapshot.velocityX !== 0 || snapshot.velocityY !== 0) && quantizedX === 0 && quantizedY === 0;
  const shouldEmitByDelta = deltaX >= VELOCITY_EPSILON || deltaY >= VELOCITY_EPSILON || becameZero;
  const shouldEmitByTime = now - lastVelocityEmitAt >= VELOCITY_EMIT_INTERVAL_MS;
  if (!shouldEmitByDelta && !shouldEmitByTime) return;
  if (snapshot.velocityX === quantizedX && snapshot.velocityY === quantizedY) return;
  snapshot = { ...snapshot, velocityX: quantizedX, velocityY: quantizedY };
  lastVelocityEmitAt = now;
  emit();
}

export function setGlobalRuntimeFps(runtimeFps: number) {
  if (TAPNOW_INTERACTION_SUSPEND && snapshot.isGlobalInteracting) return;
  const normalized = Number.isFinite(runtimeFps) ? Math.max(0, Math.round(runtimeFps)) : 0;
  if (snapshot.runtimeFps === normalized) return;
  snapshot = { ...snapshot, runtimeFps: normalized };
  emit();
}

/** 画布连接线 Canvas 的真实绘制帧率（EdgeCanvasLayer drawFrame 次数/秒） */
export function setGlobalCanvasDrawFps(fps: number) {
  const normalized = Number.isFinite(fps) ? Math.max(0, Math.round(fps)) : 0;
  if (snapshot.canvasDrawFps === normalized) return;
  snapshot = { ...snapshot, canvasDrawFps: normalized };
  emit();
}

export function setGlobalPerfLevel(perfLevel: 0 | 1 | 2 | 3) {
  if (SILENCE_PERF_MONITOR || (TAPNOW_INTERACTION_SUSPEND && snapshot.isGlobalInteracting)) return;
  if (snapshot.perfLevel === perfLevel) return;
  snapshot = { ...snapshot, perfLevel };
  emit();
}

export function getGlobalInteractionSnapshot(): InteractionSnapshot {
  return snapshot;
}

export function setHoveredVideoNodeId(nodeId: string | null) {
  if (snapshot.hoveredVideoNodeId === nodeId) return;
  snapshot = { ...snapshot, hoveredVideoNodeId: nodeId };
  emit();
}

/** 设置当前激活的视频节点（挂载 video 并播放）；onMouseEnter 时调用 */
export function setActiveVideoNodeId(nodeId: string | null) {
  if (activeVideoClearTimer) {
    clearTimeout(activeVideoClearTimer);
    activeVideoClearTimer = null;
  }
  if (snapshot.activeVideoNodeId === nodeId) return;
  snapshot = { ...snapshot, activeVideoNodeId: nodeId };
  emit();
}

/** 延时清空激活视频节点；onMouseLeave 时调用，100ms 抖动。
 *  拖拽画布/移动模块期间不清空，保留当前激活视频的画面，避免拖拽时全部模块显示占位符。 */
export function scheduleClearActiveVideoNodeId() {
  if (activeVideoClearTimer) return;
  activeVideoClearTimer = setTimeout(() => {
    activeVideoClearTimer = null;
    if (snapshot.isGlobalInteracting || snapshot.isVisualInteractionLocked) return;
    if (snapshot.activeVideoNodeId !== null) {
      snapshot = { ...snapshot, activeVideoNodeId: null };
      emit();
    }
  }, ACTIVE_VIDEO_LEAVE_DEBOUNCE_MS);
}

export function setVideoSpliceFullscreenNodeId(nodeId: string | null) {
  if (snapshot.videoSpliceFullscreenNodeId === nodeId) return;
  snapshot = { ...snapshot, videoSpliceFullscreenNodeId: nodeId };
  emit();
}

export function setIsExiting(value: boolean) {
  if (snapshot.isExiting === value) return;
  snapshot = { ...snapshot, isExiting: value };
  emit();
}

export function triggerEmergencyVideoUnload(nodeIds: string[], freezeMs = 1200) {
  if (SILENCE_PERF_MONITOR || (TAPNOW_INTERACTION_SUSPEND && snapshot.isGlobalInteracting)) return;
  if (!nodeIds.length) return;
  const now = Date.now();
  const nextMap = { ...snapshot.emergencyVideoFreezeUntilMap };
  nodeIds.forEach((id) => {
    nextMap[id] = Math.max(nextMap[id] || 0, now + freezeMs);
  });
  snapshot = {
    ...snapshot,
    emergencyVideoFreezeUntilMap: nextMap,
    emergencyUnloadCount: snapshot.emergencyUnloadCount + 1,
  };
  emit();
}

export function useGlobalInteraction(): InteractionSnapshot {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot
  );
}

export function useGlobalInteractionSelector<T>(
  selector: (state: InteractionSnapshot) => T,
  isEqual: (a: T, b: T) => boolean = Object.is
): T {
  const selectedRef = useRef<T>(selector(snapshot));
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => {
      const nextSelected = selector(snapshot);
      if (isEqual(selectedRef.current, nextSelected)) {
        return selectedRef.current;
      }
      selectedRef.current = nextSelected;
      return nextSelected;
    },
    () => selectedRef.current
  );
}

