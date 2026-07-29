/** 拖线松手时：若落在磁吸「+」视觉区域内，则补全连线目标（RF 默认锚点仅 2px，视觉在节点外） */

export type PlusHandleSnap = { nodeId: string; handleId: string };

const PLUS_SNAP_HIT_RADIUS_PX = 52;
/** 底边双口（图片对比 A/B）：连线常从侧方靠近，需更大松手吸附半径 */
const PLUS_SNAP_HIT_RADIUS_BOTTOM_PX = 96;

function resolvePlusHandleType(el: HTMLElement): 'source' | 'target' | null {
  if (el.classList.contains('nexflow-plus-handle-left')) return 'target';
  if (el.classList.contains('nexflow-plus-handle-bottom')) return 'target';
  if (el.classList.contains('nexflow-plus-handle-right')) return 'source';
  // 兼容未带方向 class 的 handle：按 data-handlepos / RF type
  const pos = (el.getAttribute('data-handlepos') || '').toLowerCase();
  if (pos === 'left' || pos === 'bottom' || pos === 'top') return 'target';
  if (pos === 'right') return 'source';
  const handleTypeAttr = (el.getAttribute('data-handletype') || '').toLowerCase();
  if (handleTypeAttr === 'target' || handleTypeAttr === 'source') return handleTypeAttr;
  return null;
}

function readHandleId(el: HTMLElement, handleType: 'source' | 'target'): string {
  const fromData = el.getAttribute('data-handleid');
  if (fromData) return fromData;
  const rawId = el.getAttribute('id') || '';
  if (rawId && !rawId.startsWith('react-flow__handle')) return rawId;
  const isLeft = el.classList.contains('nexflow-plus-handle-left');
  const isBottom = el.classList.contains('nexflow-plus-handle-bottom');
  if (isLeft || isBottom || handleType === 'target') return 'input';
  return 'output';
}

export function snapConnectionToPlusHandle(
  host: HTMLElement,
  clientX: number,
  clientY: number,
  zoom: number,
  wantType: 'source' | 'target',
): PlusHandleSnap | null {
  const safeZoom = Math.max(zoom, 0.05);
  const handles = Array.from(host.querySelectorAll<HTMLElement>('.nexflow-plus-handle'));
  let best: (PlusHandleSnap & { score: number }) | null = null;

  for (const el of handles) {
    const handleType = resolvePlusHandleType(el);
    if (handleType !== wantType) continue;

    const isBottom = el.classList.contains('nexflow-plus-handle-bottom');
    const computed = window.getComputedStyle(el);
    // 底边把手：即使 computed 为 none（被遮罩误伤），仍允许靠 plus-* / 几何命中吸附
    if (
      computed.pointerEvents === 'none' &&
      !isBottom &&
      !el.classList.contains('plus-hot') &&
      !el.classList.contains('plus-near') &&
      !el.classList.contains('plus-snapping')
    ) {
      continue;
    }

    const rect = el.getBoundingClientRect();
    const visualX = parseFloat(computed.getPropertyValue('--plus-visual-x')) || 0;
    const visualY = parseFloat(computed.getPropertyValue('--plus-visual-y')) || 0;
    const magnetX = parseFloat(computed.getPropertyValue('--magnet-x')) || 0;
    const magnetY = parseFloat(computed.getPropertyValue('--magnet-y')) || 0;
    const cx = rect.left + rect.width / 2 + (visualX + magnetX) * safeZoom;
    const cy = rect.top + rect.height / 2 + (visualY + magnetY) * safeZoom;
    const d = Math.hypot(clientX - cx, clientY - cy);
    const hitRadius = isBottom ? PLUS_SNAP_HIT_RADIUS_BOTTOM_PX : PLUS_SNAP_HIT_RADIUS_PX;
    if (d > hitRadius) continue;

    const nodeId =
      el.getAttribute('data-nodeid') ||
      el.closest('.react-flow__node')?.getAttribute('data-id') ||
      el.closest('[data-id]')?.getAttribute('data-id') ||
      '';
    if (!nodeId) continue;

    const handleId = readHandleId(el, handleType);

    const score =
      d -
      (el.classList.contains('plus-hot') ? 24 : el.classList.contains('plus-near') ? 12 : 0) -
      (el.classList.contains('plus-snapping') ? 8 : 0) -
      (isBottom ? 4 : 0);

    if (!best || score < best.score) {
      best = { nodeId, handleId, score };
    }
  }

  return best ? { nodeId: best.nodeId, handleId: best.handleId } : null;
}
