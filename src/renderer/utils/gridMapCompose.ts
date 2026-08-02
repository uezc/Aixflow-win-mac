import { computeMultiGridCellRects } from './multiImageGridPreview';
import { resolveImageUrlFromNodeForPhotoCollage } from './photoCollageFromEdges';

export type GridMapCell = {
  /** 稳定 id，用于拖拽换位时的 layout 动画 */
  id?: string;
  src?: string;
  sourceNodeId?: string;
};

export type GridMapSize = { cols: number; rows: number };

export const GRID_MAP_PRESETS: GridMapSize[] = [
  { cols: 2, rows: 2 },
  { cols: 2, rows: 3 },
  { cols: 3, rows: 2 },
  { cols: 3, rows: 3 },
  { cols: 4, rows: 4 },
];

export const DEFAULT_GRID_MAP_COLS = 3;
export const DEFAULT_GRID_MAP_ROWS = 3;
export const DEFAULT_GRID_MAP_CANVAS_W = 1080;
export const DEFAULT_GRID_MAP_CANVAS_H = 1080;
export const DEFAULT_GRID_MAP_GAP_PX = 6;

/**
 * 「比例」指单格画面比例。按 cols×rows 与间距反推整张合成画布像素，
 * 使 computeMultiGridCellRects 得到的单格宽高比 ≈ cellRw:cellRh。
 * 短边优先对齐 1080。
 */
export function resolveGridMapCanvasSizeForCellAspect(
  cellRw: number,
  cellRh: number,
  cols: number,
  rows: number,
  gapPx: number = DEFAULT_GRID_MAP_GAP_PX,
): [number, number] {
  const c = Math.max(1, Math.floor(cols));
  const r = Math.max(1, Math.floor(rows));
  const gap = Math.max(0, gapPx);
  const cellAspect = Math.max(0.05, cellRw) / Math.max(0.05, cellRh);

  // 忽略间距时的画布比例，先定短边 1080
  const canvasAspectApprox = (c / r) * cellAspect;
  let cw: number;
  let ch: number;
  if (canvasAspectApprox >= 1) {
    ch = 1080;
    cw = Math.round(ch * canvasAspectApprox);
  } else {
    cw = 1080;
    ch = Math.round(cw / Math.max(canvasAspectApprox, 0.05));
  }

  // 用间距修正，保证单格精确等于目标比例（固定 cellH，调 canvasW）
  const cellH = (ch - gap * (r - 1)) / r;
  const targetCellW = Math.max(1, cellH * cellAspect);
  cw = Math.round(targetCellW * c + gap * (c - 1));
  ch = Math.round(cellH * r + gap * (r - 1));

  return [Math.max(64, cw), Math.max(64, ch)];
}

/** 从当前画布反推单格宽高比 */
export function resolveGridMapCellAspectFromCanvas(
  canvasW: number,
  canvasH: number,
  cols: number,
  rows: number,
  gapPx: number = DEFAULT_GRID_MAP_GAP_PX,
): number {
  const rects = computeMultiGridCellRects(
    Math.max(64, canvasW),
    Math.max(64, canvasH),
    Math.max(1, cols),
    Math.max(1, rows),
    gapPx,
    gapPx,
  );
  const cell = rects[0];
  if (cell && cell.h > 0) return cell.w / cell.h;
  return Math.max(64, canvasW) / Math.max(64, canvasH);
}

type NodeLike = { id: string; type?: string; data?: Record<string, unknown> };
type EdgeLike = {
  source: string;
  target: string;
  targetHandle?: string | null;
  data?: Record<string, unknown>;
};

export function gridMapSlotCount(cols: number, rows: number): number {
  return Math.max(1, cols) * Math.max(1, rows);
}

export function newGridMapCellId(): string {
  return `gm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyGridMapCells(cols: number, rows: number): GridMapCell[] {
  return Array.from({ length: gridMapSlotCount(cols, rows) }, () => ({ id: newGridMapCellId() }));
}

/** 调整行列时尽量保留已有内容（按索引映射） */
export function resizeGridMapCells(
  prev: GridMapCell[] | undefined,
  cols: number,
  rows: number,
): GridMapCell[] {
  const next = emptyGridMapCells(cols, rows);
  const src = Array.isArray(prev) ? prev : [];
  for (let i = 0; i < Math.min(next.length, src.length); i += 1) {
    const cell = src[i] || {};
    next[i] = { ...cell, id: cell.id || next[i]!.id || newGridMapCellId() };
  }
  return next;
}

export function formatGridMapImagePath(path: string): string {
  if (!path) return '';
  if (
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('data:') ||
    path.startsWith('blob:')
  ) {
    return path;
  }
  if (path.startsWith('local-resource://')) return path;
  const cleanPath = path.replace(/^(file:\/\/|local-resource:\/\/)/, '');
  let normalizedPath = cleanPath.replace(/\\/g, '/');
  if (normalizedPath.match(/^([a-zA-Z])\//)) {
    normalizedPath = normalizedPath[0].toUpperCase() + ':' + normalizedPath.substring(1);
  }
  if (normalizedPath.match(/^\/[a-zA-Z]:/)) normalizedPath = normalizedPath.substring(1);
  const pathParts = normalizedPath.split('/');
  const encodedParts = pathParts.map((part, index) => {
    if (index === 0 && /^[a-zA-Z]:$/.test(part)) return part;
    if (/[\u4e00-\u9fa5\s]/.test(part)) return encodeURIComponent(part);
    return part;
  });
  return `local-resource://${encodedParts.join('/')}`;
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`load failed: ${src.slice(0, 80)}`));
    img.src = src;
  });
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const nw = img.naturalWidth || 1;
  const nh = img.naturalHeight || 1;
  const scale = Math.max(w / nw, h / nh);
  const dw = nw * scale;
  const dh = nh * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

/**
 * 将宫格细胞合成为一张 PNG dataUrl（object-cover 填满各格）。
 */
export async function composeGridMapToDataUrl(opts: {
  canvasW: number;
  canvasH: number;
  cols: number;
  rows: number;
  gapPx?: number;
  cells: GridMapCell[];
}): Promise<string> {
  const cw = Math.max(64, Math.round(opts.canvasW));
  const ch = Math.max(64, Math.round(opts.canvasH));
  const cols = Math.max(1, opts.cols);
  const rows = Math.max(1, opts.rows);
  const gap = Math.max(0, opts.gapPx ?? DEFAULT_GRID_MAP_GAP_PX);
  const pad = gap;
  const rects = computeMultiGridCellRects(cw, ch, cols, rows, pad, gap);

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');

  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, cw, ch);

  const slots = cols * rows;
  for (let i = 0; i < slots; i += 1) {
    const rect = rects[i];
    if (!rect) continue;
    const cell = opts.cells[i];
    const src = formatGridMapImagePath(String(cell?.src || '').trim());
    ctx.fillStyle = '#16161a';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    if (!src) continue;
    try {
      const img = await loadHtmlImage(src);
      drawCover(ctx, img, rect.x, rect.y, rect.w, rect.h);
    } catch {
      /* skip broken cell */
    }
  }

  return canvas.toDataURL('image/png');
}

/**
 * 按入边自动填入空格：已有 sourceNodeId 的格保留；新连线按顺序填入空位。
 * 用户手动放入的无 source 格也会保留。
 */
export function buildGridMapCellsFromEdges(
  gridNodeId: string,
  edges: EdgeLike[],
  nodes: NodeLike[],
  existingCells: GridMapCell[] | undefined,
  cols: number,
  rows: number,
): GridMapCell[] {
  const slots = gridMapSlotCount(cols, rows);
  const prev = resizeGridMapCells(existingCells, cols, rows);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const incoming = edges.filter(
    (e) => e.target === gridNodeId && (!e.targetHandle || e.targetHandle === 'input'),
  );

  const edgeSources: Array<{ sourceId: string; url: string }> = [];
  for (const edge of incoming) {
    const sourceNode = nodeById.get(edge.source);
    if (sourceNode?.type !== 'image') continue;
    const url = resolveImageUrlFromNodeForPhotoCollage(sourceNode.data, edge);
    if (!url) continue;
    edgeSources.push({ sourceId: edge.source, url: formatGridMapImagePath(url) });
  }

  const next = prev.map((c) => ({ ...c }));
  const occupiedSourceIds = new Set(
    next.map((c) => c.sourceNodeId).filter((id): id is string => !!id),
  );

  // 更新已绑定 source 的格 URL
  for (const { sourceId, url } of edgeSources) {
    const idx = next.findIndex((c) => c.sourceNodeId === sourceId);
    if (idx >= 0) {
      next[idx] = { ...next[idx], src: url, sourceNodeId: sourceId };
      occupiedSourceIds.add(sourceId);
    }
  }

  // 移除已断开边的 source 绑定（保留手动图）
  const liveSourceIds = new Set(edgeSources.map((e) => e.sourceId));
  for (let i = 0; i < next.length; i += 1) {
    const sid = next[i]?.sourceNodeId;
    if (sid && !liveSourceIds.has(sid)) {
      next[i] = {};
    }
  }

  // 新连线填空格
  for (const { sourceId, url } of edgeSources) {
    if (next.some((c) => c.sourceNodeId === sourceId)) continue;
    const emptyIdx = next.findIndex((c) => !c.src);
    if (emptyIdx < 0) break;
    next[emptyIdx] = { src: url, sourceNodeId: sourceId };
  }

  // 保证长度
  while (next.length < slots) next.push({});
  return next.slice(0, slots);
}

export function firstEmptyGridCellIndex(cells: GridMapCell[]): number {
  return cells.findIndex((c) => !String(c?.src || '').trim());
}

export function swapGridMapCells(cells: GridMapCell[], a: number, b: number): GridMapCell[] {
  if (a === b || a < 0 || b < 0 || a >= cells.length || b >= cells.length) return cells;
  const next = cells.map((c) => ({ ...c }));
  const tmp = next[a]!;
  next[a] = next[b]!;
  next[b] = tmp;
  return next;
}
