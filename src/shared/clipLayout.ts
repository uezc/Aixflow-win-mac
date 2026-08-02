import {
  CLIP_CROP_MIN_SIZE,
  normalizeClipCrop,
  type ClipCrop,
} from './clipCrop.js';

/** 视频/图片片段在合成画面中的布局（归一化 0–1，相对预览/导出画布） */
export type ClipLayout = {
  /** 左上角 x，相对画布宽 */
  x: number;
  /** 左上角 y，相对画布高 */
  y: number;
  /** 占位框宽，相对画布宽 */
  w: number;
  /** 占位框高，相对画布高 */
  h: number;
};

/** 归一化矩形（可不落在画布 0–1 内，用于由 layout+crop 反推的源占位） */
export type NormRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export const DEFAULT_CLIP_LAYOUT: ClipLayout = { x: 0, y: 0, w: 1, h: 1 };
export const CLIP_LAYOUT_MIN = 0.05;

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function normalizeClipLayout(raw?: Partial<ClipLayout> | null): ClipLayout {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CLIP_LAYOUT };
  let w = clamp01(Number(raw.w));
  let h = clamp01(Number(raw.h));
  if (!(w > 0)) w = DEFAULT_CLIP_LAYOUT.w;
  if (!(h > 0)) h = DEFAULT_CLIP_LAYOUT.h;
  w = Math.max(CLIP_LAYOUT_MIN, w);
  h = Math.max(CLIP_LAYOUT_MIN, h);
  let x = clamp01(Number(raw.x));
  let y = clamp01(Number(raw.y));
  if (x + w > 1) x = Math.max(0, 1 - w);
  if (y + h > 1) y = Math.max(0, 1 - h);
  return { x, y, w, h };
}

export function isDefaultClipLayout(layout?: Partial<ClipLayout> | null): boolean {
  const L = normalizeClipLayout(layout);
  return L.x <= 0.001 && L.y <= 0.001 && L.w >= 0.999 && L.h >= 0.999;
}

/** 不夹紧到画布：仅保证有限正宽高（裁剪编辑时源占位可超出画布） */
export function asNormRect(raw?: Partial<NormRect> | null): NormRect {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CLIP_LAYOUT };
  let w = Number(raw.w);
  let h = Number(raw.h);
  if (!Number.isFinite(w) || !(w > 0)) w = DEFAULT_CLIP_LAYOUT.w;
  if (!Number.isFinite(h) || !(h > 0)) h = DEFAULT_CLIP_LAYOUT.h;
  w = Math.max(CLIP_LAYOUT_MIN, w);
  h = Math.max(CLIP_LAYOUT_MIN, h);
  let x = Number(raw.x);
  let y = Number(raw.y);
  if (!Number.isFinite(x)) x = 0;
  if (!Number.isFinite(y)) y = 0;
  return { x, y, w, h };
}

/**
 * 由「裁切后画面」的 layout + 源 crop，反推未裁源在画布上的占位矩形。
 * 约定：layout 始终是裁切后可见区域在画布上的外接框。
 */
export function sourceRectFromLayoutAndCrop(
  layout?: Partial<ClipLayout> | null,
  crop?: Partial<ClipCrop> | null,
): NormRect {
  const L = normalizeClipLayout(layout);
  const C = normalizeClipCrop(crop);
  const vw = Math.max(CLIP_CROP_MIN_SIZE, 1 - C.left - C.right);
  const vh = Math.max(CLIP_CROP_MIN_SIZE, 1 - C.top - C.bottom);
  const sw = L.w / vw;
  const sh = L.h / vh;
  return asNormRect({
    x: L.x - C.left * sw,
    y: L.y - C.top * sh,
    w: sw,
    h: sh,
  });
}

/** 在固定源占位内套用 crop，得到裁切后画面的 layout */
export function layoutFromSourceRectAndCrop(
  sourceRect?: Partial<NormRect> | null,
  crop?: Partial<ClipCrop> | null,
): ClipLayout {
  const S = asNormRect(sourceRect);
  const C = normalizeClipCrop(crop);
  const vw = Math.max(CLIP_CROP_MIN_SIZE, 1 - C.left - C.right);
  const vh = Math.max(CLIP_CROP_MIN_SIZE, 1 - C.top - C.bottom);
  return normalizeClipLayout({
    x: S.x + C.left * S.w,
    y: S.y + C.top * S.h,
    w: vw * S.w,
    h: vh * S.h,
  });
}

/**
 * crop 变化时保持源占位不动，按新 crop 反推 layout，
 * 使画布上可见区域随琥珀色保留框变化、切换「位置」时蓝框贴合可见区。
 */
export function syncLayoutAfterCropChange(
  prevLayout?: Partial<ClipLayout> | null,
  prevCrop?: Partial<ClipCrop> | null,
  nextCrop?: Partial<ClipCrop> | null,
): ClipLayout {
  const sourceRect = sourceRectFromLayoutAndCrop(prevLayout, prevCrop);
  return layoutFromSourceRectAndCrop(sourceRect, nextCrop);
}

/**
 * ffmpeg -vf：将（已 crop 的）素材 contain 进 layout 占位框，再 pad 到 outW×outH。
 * layout 表示裁切后画面在画布上的占位；默认全画幅时与旧逻辑一致（居中 letterbox）。
 * 若需源画面 crop，请在此前拼接 buildClipCropFilterPrefix（见 clipCrop.ts）。
 */
export function buildClipLayoutScaleFilter(
  outW: number,
  outH: number,
  layout?: Partial<ClipLayout> | null,
): string {
  const W = Math.max(2, Math.round(outW) & ~1);
  const H = Math.max(2, Math.round(outH) & ~1);
  const baseTail = 'setsar=1,fps=30,format=yuv420p';
  if (isDefaultClipLayout(layout)) {
    return `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,${baseTail}`;
  }
  const L = normalizeClipLayout(layout);
  const boxW = Math.max(2, Math.round(L.w * W) & ~1);
  const boxH = Math.max(2, Math.round(L.h * H) & ~1);
  const x = Math.round(L.x * W);
  const y = Math.round(L.y * H);
  return (
    `scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease,` +
    `pad=${W}:${H}:${x}+(${boxW}-iw)/2:${y}+(${boxH}-ih)/2,${baseTail}`
  );
}
