/** 拖线松手时：若落在磁吸「+」视觉区域内，则补全连线目标（RF 默认锚点仅 2px，视觉在节点外） */

export type PlusHandleSnap = { nodeId: string; handleId: string };

const PLUS_SNAP_HIT_RADIUS_PX = 52;

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
    const isLeft = el.classList.contains('nexflow-plus-handle-left');
    const isRight = el.classList.contains('nexflow-plus-handle-right');
    const handleType = isLeft ? 'target' : isRight ? 'source' : null;
    if (handleType !== wantType) continue;

    const computed = window.getComputedStyle(el);
    if (
      computed.pointerEvents === 'none' &&
      !el.classList.contains('plus-hot') &&
      !el.classList.contains('plus-near') &&
      !el.classList.contains('plus-snapping')
    ) {
      continue;
    }

    const rect = el.getBoundingClientRect();
    const visualX = parseFloat(computed.getPropertyValue('--plus-visual-x')) || 0;
    const magnetX = parseFloat(computed.getPropertyValue('--magnet-x')) || 0;
    const magnetY = parseFloat(computed.getPropertyValue('--magnet-y')) || 0;
    const cx = rect.left + rect.width / 2 + (visualX + magnetX) * safeZoom;
    const cy = rect.top + rect.height / 2 + magnetY * safeZoom;
    const d = Math.hypot(clientX - cx, clientY - cy);
    if (d > PLUS_SNAP_HIT_RADIUS_PX) continue;

    const nodeId =
      el.getAttribute('data-nodeid') ||
      el.closest('.react-flow__node')?.getAttribute('data-id') ||
      el.closest('[data-id]')?.getAttribute('data-id') ||
      '';
    if (!nodeId) continue;

    const handleId =
      el.getAttribute('data-handleid') ||
      el.getAttribute('id') ||
      (isLeft ? 'input' : 'output');

    const score =
      d -
      (el.classList.contains('plus-hot') ? 24 : el.classList.contains('plus-near') ? 12 : 0) -
      (el.classList.contains('plus-snapping') ? 8 : 0);

    if (!best || score < best.score) {
      best = { nodeId, handleId, score };
    }
  }

  return best ? { nodeId: best.nodeId, handleId: best.handleId } : null;
}
