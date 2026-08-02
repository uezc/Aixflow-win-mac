/**
 * 画布平移/缩放交互期间冻结 React Flow viewport 订阅。
 * 大节点若用 useViewport()，会在每帧 transform 变化时重渲染；交互锁内视为相等以跳过。
 */
import { useStore } from 'reactflow';
import { getGlobalInteractionSnapshot } from '../utils/globalInteractionStore';

function isFlowInteractionFrozen(): boolean {
  const snap = getGlobalInteractionSnapshot();
  return snap.isGlobalInteracting || snap.isVisualInteractionLocked;
}

export function useFrozenFlowViewport(): { x: number; y: number; zoom: number } {
  return useStore(
    (s) => {
      const t = s.transform ?? [0, 0, 1];
      return { x: t[0], y: t[1], zoom: t[2] ?? 1 };
    },
    (a, b) => {
      if (isFlowInteractionFrozen()) return true;
      return a.x === b.x && a.y === b.y && a.zoom === b.zoom;
    },
  );
}

export function useFrozenFlowZoom(fallback = 1): number {
  return useStore(
    (s) => s.transform?.[2] ?? fallback,
    (a, b) => {
      if (isFlowInteractionFrozen()) return true;
      return Object.is(a, b);
    },
  );
}
