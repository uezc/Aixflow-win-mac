/**
 * 原生节点位置同步：脱离 React 生命周期，通过 RAF 直接操作 DOM 更新节点 transform。
 * 位置缓存中心：每帧先更新 currentActivePositionsMap，再触发 Canvas 重绘，最后写入 DOM。
 */

const positionMap = new Map<string, { x: number; y: number }>();

/** 全局位置缓存中心：每帧先更新此 Map，Canvas 优先从此读取，实现线与节点同源同步 */
export const currentActivePositionsMap = new Map<string, { x: number; y: number }>();

let containerRef: { current: HTMLElement | null } | null = null;
let rafId: number | null = null;
let isRunning = false;

/** 写入节点位置到原生 Map，不触发 React */
export function setNodePosition(nodeId: string, x: number, y: number): void {
  positionMap.set(nodeId, { x, y });
}

/** 批量写入 */
export function setNodePositions(entries: Array<{ id: string; x: number; y: number }>): void {
  for (const { id, x, y } of entries) {
    positionMap.set(id, { x, y });
  }
}

/** 移除节点 */
export function removeNodePosition(nodeId: string): void {
  positionMap.delete(nodeId);
  currentActivePositionsMap.delete(nodeId);
}

/** 清空 Map 并返回当前所有位置（用于 flush 到 React state） */
export function flushPositions(): Map<string, { x: number; y: number }> {
  const snapshot = new Map(positionMap);
  positionMap.clear();
  currentActivePositionsMap.clear();
  return snapshot;
}

/** 是否有待处理的拖拽位置 */
export function hasPendingPositions(): boolean {
  return positionMap.size > 0;
}

/** 绑定容器 ref，用于 querySelector 查找节点 */
export function bindContainerRef(ref: { current: HTMLElement | null } | null): void {
  containerRef = ref;
}

let onBeforeDomWrite: (() => void) | null = null;

/** 在位置写入 DOM 之前调用，供 Canvas 重绘；顺序：更新 Map -> 本回调(重绘) -> 写 DOM */
export function setOnAfterPositionApply(cb: (() => void) | null): void {
  onBeforeDomWrite = cb;
}

function applyPositionsToDOM(): void {
  if (!containerRef?.current) return;
  const viewport = containerRef.current.querySelector('.react-flow__viewport');
  if (!viewport) return;

  // 第一步：更新位置缓存中心
  currentActivePositionsMap.clear();
  if (positionMap.size > 0) {
    for (const [nodeId, pos] of positionMap) {
      currentActivePositionsMap.set(nodeId, { x: pos.x, y: pos.y });
    }
  }

  // 第二步：触发 Canvas 重绘（传 Map，Canvas 优先从 currentActivePositionsMap 读）
  onBeforeDomWrite?.();

  // 第三步：位置写入 DOM
  for (const [nodeId, pos] of positionMap) {
    const el = viewport.querySelector(`[data-id="${nodeId}"]`) as HTMLElement | null;
    if (el) {
      const wrapper = el.closest('.react-flow__node') as HTMLElement | null;
      const target = wrapper || el;
      target.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    }
  }
}

function loop(): void {
  if (!isRunning) return;
  applyPositionsToDOM();
  rafId = requestAnimationFrame(loop);
}

/** 启动 RAF 同步循环 */
export function startSyncLoop(): void {
  if (isRunning) return;
  isRunning = true;
  rafId = requestAnimationFrame(loop);
}

/** 停止 RAF 同步循环 */
export function stopSyncLoop(): void {
  isRunning = false;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

/** 重置拖拽节点的 transform（flush 后恢复 React 控制） */
export function clearNodeTransform(nodeId: string): void {
  if (!containerRef?.current) return;
  const viewport = containerRef.current.querySelector('.react-flow__viewport');
  if (!viewport) return;
  const el = viewport.querySelector(`[data-id="${nodeId}"]`) as HTMLElement | null;
  if (el) {
    const wrapper = el.closest('.react-flow__node') as HTMLElement | null;
    const target = wrapper || el;
    target.style.transform = '';
  }
}
