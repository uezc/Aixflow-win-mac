import type { CSSProperties } from 'react';

export interface CollageLayerTransform {
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
}

/** 拼图图层关联的画布源节点（由连线创建时写入，或从 layer id 解析） */
export function collageLayerSourceNodeId(layer: {
  id: string;
  sourceNodeId?: string;
}): string | null {
  const explicit = layer.sourceNodeId?.trim();
  if (explicit) return explicit;
  const m = layer.id.match(/^layer-\d+-(.+)$/);
  return m?.[1] ?? null;
}

export function isPhotoCollageLayerEdge(
  edge: { target: string; source: string; targetHandle?: string | null },
  collageNodeId: string,
  sourceNodeId: string,
): boolean {
  return (
    edge.target === collageNodeId &&
    edge.source === sourceNodeId &&
    (!edge.targetHandle || edge.targetHandle === 'input')
  );
}

export function layerRotationDeg(layer: CollageLayerTransform): number {
  const r = layer.rotation ?? 0;
  return Number.isFinite(r) ? r : 0;
}

export function layerHasTransform(layer: CollageLayerTransform): boolean {
  return !!(layer.flipH || layer.flipV || Math.abs(layerRotationDeg(layer)) > 0.05);
}

export function layerTransformStyle(layer: CollageLayerTransform): CSSProperties {
  const rot = layerRotationDeg(layer);
  const sx = layer.flipH ? -1 : 1;
  const sy = layer.flipV ? -1 : 1;
  return {
    width: '100%',
    height: '100%',
    transform: `rotate(${rot}deg) scale(${sx}, ${sy})`,
    transformOrigin: 'center center',
  };
}

export function layerImageWrapperStyle(_layer?: CollageLayerTransform): CSSProperties {
  return {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}

/** 拖动旋钮时即时写 DOM，避免每帧 setState */
export function applyLayerTransform(el: HTMLElement, layer: CollageLayerTransform): void {
  const rot = layerRotationDeg(layer);
  const sx = layer.flipH ? -1 : 1;
  const sy = layer.flipV ? -1 : 1;
  el.style.transform = `rotate(${rot}deg) scale(${sx}, ${sy})`;
}

/** @deprecated 使用 applyLayerTransform */
export const applyLayerImageWrapperTransform = applyLayerTransform;

/** 在图层中心坐标系内按 object-contain 绘制图片（不裁剪旋转后的外扩区域） */
export function drawLayerImageContained(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  boxW: number,
  boxH: number,
) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (!iw || !ih) return;
  const s = Math.min(boxW / iw, boxH / ih);
  const dw = iw * s;
  const dh = ih * s;
  const dx = -boxW / 2 + (boxW - dw) / 2;
  const dy = -boxH / 2 + (boxH - dh) / 2;
  try {
    ctx.drawImage(img, dx, dy, dw, dh);
  } catch {
    /* 跨域等 */
  }
}

export function paintLayerWithTransform(
  ctx: CanvasRenderingContext2D,
  layer: CollageLayerTransform & { x: number; y: number; w: number; h: number },
  img: HTMLImageElement,
) {
  const cx = layer.x + layer.w / 2;
  const cy = layer.y + layer.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((layerRotationDeg(layer) * Math.PI) / 180);
  ctx.scale(layer.flipH ? -1 : 1, layer.flipV ? -1 : 1);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(-layer.w / 2, -layer.h / 2, layer.w, layer.h);
  drawLayerImageContained(ctx, img, layer.w, layer.h);
  ctx.restore();
}
