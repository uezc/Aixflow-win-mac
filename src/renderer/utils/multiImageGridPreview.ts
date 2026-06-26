/** 多图结果合并为单张预览图（画布平移时与 DOM 宫格视觉一致） */

export type OutputImageGridLayout = {
  cols: 2 | 3;
  rows: number;
  maxSlots: number;
};

/** 与 ImageNode `gap-1 p-1`、格内 `rounded-lg` 一致 */
export const MULTI_GRID_PAD_PX = 4;
export const MULTI_GRID_GAP_PX = 4;
export const MULTI_GRID_CELL_RADIUS_PX = 8;
/** 展开弹层宫格区仅 `gap-2`（外层 modal 已有 p-3，合成不再加 padding） */
export const EXPAND_ALL_GRID_PAD_PX = 0;
export const EXPAND_ALL_GRID_GAP_PX = 8;
/** 与格子上 `bg-black/20` 一致 */
const CELL_PLACEHOLDER_FILL = 'rgba(0, 0, 0, 0.2)';
const FRAME_FILL = '#0a0a0a';

export function gridClassForLayout(cols: 2 | 3): 'grid-cols-2' | 'grid-cols-3' {
  return cols === 2 ? 'grid-cols-2' : 'grid-cols-3';
}

/** 与 ImageNode / 任务列表缩略图一致：2–4 张 2×2；5–6 张 3×2；7+ 张 3×3 */
export function getOutputImageGridLayout(count: number): OutputImageGridLayout {
  if (count <= 4) {
    return { cols: 2, rows: 2, maxSlots: 4 };
  }
  if (count <= 6) {
    return { cols: 3, rows: 2, maxSlots: 6 };
  }
  return { cols: 3, rows: 3, maxSlots: 9 };
}

/** 展开全部：含 10+ 张时 3 列多行，与弹层 grid-cols-3 一致 */
export function getFullOutputImagesGridLayout(count: number): OutputImageGridLayout {
  if (count <= 4) {
    return { cols: 2, rows: 2, maxSlots: count };
  }
  if (count <= 6) {
    return { cols: 3, rows: 2, maxSlots: count };
  }
  if (count <= 9) {
    return { cols: 3, rows: 3, maxSlots: count };
  }
  const cols = 3 as const;
  const rows = Math.ceil(count / cols);
  return { cols, rows, maxSlots: count };
}

/** 与 CSS `aspect-square` + `grid-cols-N gap-2` 一致的高度估算 */
export function computeSquareGridFrameFromWidth(
  cols: number,
  rows: number,
  width: number,
  gapPx = EXPAND_ALL_GRID_GAP_PX,
): { frameWidth: number; frameHeight: number } {
  const w = Math.max(1, width);
  const cell = (w - gapPx * (cols - 1)) / cols;
  const frameHeight = rows * cell + gapPx * Math.max(0, rows - 1);
  return { frameWidth: Math.round(w), frameHeight: Math.round(frameHeight) };
}

export function estimateExpandAllGridFrameSize(count: number, maxContentWidth = 1024): {
  frameWidth: number;
  frameHeight: number;
} {
  const layout = getFullOutputImagesGridLayout(count);
  const frameWidth = Math.max(320, Math.min(maxContentWidth, typeof window !== 'undefined' ? window.innerWidth - 48 : maxContentWidth));
  return computeSquareGridFrameFromWidth(layout.cols, layout.rows, frameWidth);
}

export function computeMultiGridCellRects(
  frameWidth: number,
  frameHeight: number,
  cols: number,
  rows: number,
  pad = MULTI_GRID_PAD_PX,
  gap = MULTI_GRID_GAP_PX,
): { x: number; y: number; w: number; h: number }[] {
  const innerW = Math.max(0, frameWidth - pad * 2);
  const innerH = Math.max(0, frameHeight - pad * 2);
  const cellW = Math.max(1, (innerW - gap * (cols - 1)) / cols);
  const cellH = Math.max(1, (innerH - gap * (rows - 1)) / rows);
  const slots = cols * rows;
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (let i = 0; i < slots; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.push({
      x: pad + col * (cellW + gap),
      y: pad + row * (cellH + gap),
      w: cellW,
      h: cellH,
    });
  }
  return out;
}

export function getOutputGridCellScreenRectsFromBounds(
  bounds: { left: number; top: number; width: number; height: number },
  cols: number,
  rows: number,
): { left: number; top: number; width: number; height: number }[] {
  return computeMultiGridCellRects(bounds.width, bounds.height, cols, rows).map((c) => ({
    left: bounds.left + c.x,
    top: bounds.top + c.y,
    width: c.w,
    height: c.h,
  }));
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

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** 与 CSS object-cover 一致 */
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

function fillRoundedCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  fill: string,
) {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

function drawCoverInRoundedCell(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
) {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.clip();
  drawCover(ctx, img, x, y, w, h);
  ctx.restore();
}

function drawMoreTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  remain: number,
) {
  fillRoundedCell(ctx, x, y, w, h, radius, 'rgba(0, 0, 0, 0.6)');
  const fontSize = Math.max(12, Math.min(18, Math.round(Math.min(w, h) * 0.22)));
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`+${remain}`, x + w / 2, y + h / 2);
  ctx.restore();
}

export type BuildMultiGridPreviewOptions = {
  /** 与节点 content 区域像素一致 */
  frameWidth: number;
  frameHeight: number;
  padPx?: number;
  gapPx?: number;
  cellRadiusPx?: number;
  /** node=节点最多 9 格；all=展开全部，绘制全部张数 */
  layoutMode?: 'node' | 'all';
};

/**
 * 按节点框尺寸拼宫格：保留间隙、圆角、格内 object-cover。
 */
export async function buildMultiImageGridPreviewDataUrl(
  urls: string[],
  resolveDisplaySrc: (url: string) => Promise<string>,
  options: BuildMultiGridPreviewOptions,
): Promise<string> {
  const layoutMode = options.layoutMode ?? 'node';
  const layout =
    layoutMode === 'all' ? getFullOutputImagesGridLayout(urls.length) : getOutputImageGridLayout(urls.length);
  const capped =
    layoutMode === 'all'
      ? urls.filter(Boolean)
      : urls.slice(0, layout.maxSlots).filter(Boolean);
  if (capped.length < 2) {
    throw new Error('need at least 2 images for grid preview');
  }

  const pad = options.padPx ?? MULTI_GRID_PAD_PX;
  const gap = options.gapPx ?? MULTI_GRID_GAP_PX;
  const radius = options.cellRadiusPx ?? MULTI_GRID_CELL_RADIUS_PX;
  const canvasW = Math.max(1, Math.round(options.frameWidth));
  const canvasH = Math.max(1, Math.round(options.frameHeight));
  const { cols, rows, maxSlots } = layout;
  const cells = computeMultiGridCellRects(canvasW, canvasH, cols, rows, pad, gap);
  const remain = layoutMode === 'node' ? urls.length - maxSlots : 0;

  const resolved = await Promise.all(
    capped.map(async (u) => {
      const s = await resolveDisplaySrc(u);
      if (!s) throw new Error('empty src');
      return loadHtmlImage(s);
    }),
  );

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');

  ctx.fillStyle = FRAME_FILL;
  ctx.fillRect(0, 0, canvasW, canvasH);

  const drawCount = layoutMode === 'all' ? resolved.length : cells.length;
  for (let i = 0; i < cells.length; i++) {
    if (i >= drawCount) {
      continue;
    }
    const { x, y, w, h } = cells[i];
    const isMoreTile = layoutMode === 'node' && maxSlots === 9 && i === 8 && remain > 0;
    if (isMoreTile) {
      drawMoreTile(ctx, x, y, w, h, radius, remain);
      continue;
    }
    if (i >= resolved.length) {
      continue;
    }
    fillRoundedCell(ctx, x, y, w, h, radius, CELL_PLACEHOLDER_FILL);
    drawCoverInRoundedCell(ctx, resolved[i], x, y, w, h, radius);
  }

  return canvas.toDataURL('image/jpeg', 0.92);
}
