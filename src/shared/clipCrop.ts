/** 源画面裁剪：相对源素材宽高的边距（归一化 0–1），内侧为保留区域 */
export type ClipCrop = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export const DEFAULT_CLIP_CROP: ClipCrop = { left: 0, top: 0, right: 0, bottom: 0 };
/** 裁后至少保留的宽/高比例 */
export const CLIP_CROP_MIN_SIZE = 0.05;

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function normalizeClipCrop(raw?: Partial<ClipCrop> | null): ClipCrop {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CLIP_CROP };
  let left = clamp01(Number(raw.left));
  let top = clamp01(Number(raw.top));
  let right = clamp01(Number(raw.right));
  let bottom = clamp01(Number(raw.bottom));
  if (left + right > 1 - CLIP_CROP_MIN_SIZE) {
    const overflow = left + right - (1 - CLIP_CROP_MIN_SIZE);
    const sum = left + right;
    left = Math.max(0, left - (overflow * left) / sum);
    right = Math.max(0, 1 - CLIP_CROP_MIN_SIZE - left);
  }
  if (top + bottom > 1 - CLIP_CROP_MIN_SIZE) {
    const overflow = top + bottom - (1 - CLIP_CROP_MIN_SIZE);
    const sum = top + bottom;
    top = Math.max(0, top - (overflow * top) / sum);
    bottom = Math.max(0, 1 - CLIP_CROP_MIN_SIZE - top);
  }
  return { left, top, right, bottom };
}

export function isDefaultClipCrop(crop?: Partial<ClipCrop> | null): boolean {
  const C = normalizeClipCrop(crop);
  return C.left <= 0.001 && C.top <= 0.001 && C.right <= 0.001 && C.bottom <= 0.001;
}

/** 转为源坐标系归一化矩形 { x, y, w, h } */
export function clipCropToRect(crop?: Partial<ClipCrop> | null): { x: number; y: number; w: number; h: number } {
  const C = normalizeClipCrop(crop);
  return {
    x: C.left,
    y: C.top,
    w: Math.max(CLIP_CROP_MIN_SIZE, 1 - C.left - C.right),
    h: Math.max(CLIP_CROP_MIN_SIZE, 1 - C.top - C.bottom),
  };
}

/**
 * ffmpeg crop 滤镜片段（含末尾逗号，可拼到 scale/pad 前）。
 * 使用 iw/ih 表达式，无需探测源尺寸；宽高/偏移取偶数以兼容 yuv420。
 */
export function buildClipCropFilterPrefix(crop?: Partial<ClipCrop> | null): string {
  if (isDefaultClipCrop(crop)) return '';
  const C = normalizeClipCrop(crop);
  const vw = 1 - C.left - C.right;
  const vh = 1 - C.top - C.bottom;
  // floor(x/2)*2 保证偶数
  return (
    `crop=` +
    `floor(iw*${vw.toFixed(6)}/2)*2:` +
    `floor(ih*${vh.toFixed(6)}/2)*2:` +
    `floor(iw*${C.left.toFixed(6)}/2)*2:` +
    `floor(ih*${C.top.toFixed(6)}/2)*2,`
  );
}
