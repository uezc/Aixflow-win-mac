import { scaleModulePx } from './moduleDisplayScale';

/**
 * 图片模块短边统一长度：横版高度 = 竖版宽度 = 此值，保证横竖看起来差不多大。
 * （旧版 minW/minH 按 16:9 拆开会导致竖版短边被撑到接近横版长边。）
 */
export const IMAGE_NODE_SHORT_SIDE = scaleModulePx(211.12);
/** 任一边下限均为短边（横竖统一） */
export const IMAGE_NODE_MIN_W = IMAGE_NODE_SHORT_SIDE;
export const IMAGE_NODE_MIN_H = IMAGE_NODE_SHORT_SIDE;
/** 空图 / 默认 16:9 外框（短边 = IMAGE_NODE_SHORT_SIDE） */
export const IMAGE_NODE_DEFAULT_W = Math.round(IMAGE_NODE_SHORT_SIDE * (16 / 9));
export const IMAGE_NODE_DEFAULT_H = Math.round(IMAGE_NODE_SHORT_SIDE);
export const IMAGE_NODE_MAX_W = 2048;
export const IMAGE_NODE_MAX_H = 2048;

/** 视频模块与图片模块同默认大小：短边统一 + 默认 16:9 外框 */
export const VIDEO_NODE_SHORT_SIDE = IMAGE_NODE_SHORT_SIDE;
export const VIDEO_NODE_MIN_W = VIDEO_NODE_SHORT_SIDE;
export const VIDEO_NODE_MIN_H = VIDEO_NODE_SHORT_SIDE;
export const VIDEO_NODE_DEFAULT_W = IMAGE_NODE_DEFAULT_W;
export const VIDEO_NODE_DEFAULT_H = IMAGE_NODE_DEFAULT_H;
export const VIDEO_NODE_MAX_W = 4096;
export const VIDEO_NODE_MAX_H = 4096;

/** 图片 / 视频模块创建与面板默认比例 */
export const DEFAULT_IMAGE_ASPECT_RATIO = '16:9';
export const DEFAULT_VIDEO_ASPECT_RATIO = '16:9';

/** 切换宽高比时模块外框尺寸过渡（拖拽/缩放时由组件内关闭） */
export const NODE_SIZE_TRANSITION =
  'width 0.32s cubic-bezier(0.22, 1, 0.36, 1), height 0.32s cubic-bezier(0.22, 1, 0.36, 1)';

export function parseAspectRatioValue(value: string | undefined | null): { w: number; h: number } | null {
  if (!value || value === 'auto' || value === 'empty') return null;
  const m = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { w, h };
}

export function computeNodeSizeFromMedia(
  mediaW: number | undefined,
  mediaH: number | undefined,
  minW: number,
  minH: number,
  maxW: number,
  maxH: number,
  fallbackW = minW,
  fallbackH = minH,
): { w: number; h: number } {
  if (!mediaW || !mediaH || mediaW <= 0 || mediaH <= 0) {
    return {
      w: Math.max(minW, Math.min(maxW, fallbackW)),
      h: Math.max(minH, Math.min(maxH, fallbackH)),
    };
  }
  let w = mediaW;
  let h = mediaH;
  // minW===minH 时等价于「短边对齐」：横版高、竖版宽同长
  const scaleToMin = Math.max(minW / w, minH / h);
  w *= scaleToMin;
  h *= scaleToMin;
  const scaleToMax = Math.min(maxW / w, maxH / h, 1);
  w *= scaleToMax;
  h *= scaleToMax;
  return {
    w: Math.round(w),
    h: Math.round(h),
  };
}

export function computeNodeSizeFromAspectRatio(
  aspectRatio: string | undefined | null,
  minW: number,
  minH: number,
  maxW: number,
  maxH: number,
): { w: number; h: number } | null {
  const parsed = parseAspectRatioValue(aspectRatio);
  if (!parsed) return null;
  return computeNodeSizeFromMedia(parsed.w, parsed.h, minW, minH, maxW, maxH);
}

export function imageNodeSizeForAspectRatio(aspectRatio: string | undefined | null): { w: number; h: number } | null {
  return computeNodeSizeFromAspectRatio(
    aspectRatio,
    IMAGE_NODE_MIN_W,
    IMAGE_NODE_MIN_H,
    IMAGE_NODE_MAX_W,
    IMAGE_NODE_MAX_H,
  );
}

export function videoNodeSizeForAspectRatio(aspectRatio: string | undefined | null): { w: number; h: number } | null {
  return computeNodeSizeFromAspectRatio(
    aspectRatio,
    VIDEO_NODE_MIN_W,
    VIDEO_NODE_MIN_H,
    VIDEO_NODE_MAX_W,
    VIDEO_NODE_MAX_H,
  );
}

export function aspectRatioLabelFromPixelSize(width: number, height: number): string {
  if (!width || !height || width <= 0 || height <= 0) return DEFAULT_IMAGE_ASPECT_RATIO;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(Math.round(width), Math.round(height));
  return `${Math.round(width / g)}:${Math.round(height / g)}`;
}

/** 浏览器侧探测图片像素尺寸（生成/上传后用于模块外框比例自适应） */
export function probeImagePixelSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = String(src || '').trim();
    if (!url) {
      reject(new Error('empty image src'));
      return;
    }
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      if (width > 0 && height > 0) resolve({ width, height });
      else reject(new Error('invalid image dimensions'));
    };
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
}

/** 视频底部面板可选比例 */
export const VIDEO_PANEL_ASPECT_OPTIONS = ['16:9', '9:16', '1:1', '2:3', '3:2'] as const;
export type VideoPanelAspectRatio = (typeof VIDEO_PANEL_ASPECT_OPTIONS)[number];

export function snapToVideoPanelAspectRatio(label: string): VideoPanelAspectRatio {
  const parsed = parseAspectRatioValue(label);
  if (!parsed) return '16:9';
  const target = parsed.w / parsed.h;
  let best: VideoPanelAspectRatio = '16:9';
  let bestDiff = Infinity;
  for (const opt of VIDEO_PANEL_ASPECT_OPTIONS) {
    const p = parseAspectRatioValue(opt);
    if (!p) continue;
    const diff = Math.abs(Math.log(target / (p.w / p.h)));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = opt;
    }
  }
  return best;
}

export function hasVideoOutputMedia(data: Record<string, unknown> | undefined | null): boolean {
  if (!data) return false;
  return !!(String(data.outputVideo || '').trim() || String(data.originalVideoUrl || '').trim());
}

export function hasImageOutputMedia(data: Record<string, unknown> | undefined | null): boolean {
  if (!data) return false;
  if (String(data.outputImage || '').trim() || String(data.originalImageUrl || '').trim()) return true;
  const list = data.outputImages;
  if (Array.isArray(list) && list.some((u) => String(u || '').trim())) return true;
  return false;
}

/** 从节点 data 读取素材像素尺寸（优先 videoAsset / imageAsset；无成片时不读残留 asset） */
export function resolveMediaPixelSizeFromNodeData(
  data: Record<string, unknown> | undefined | null,
  kind: 'image' | 'video',
): { width: number; height: number } | null {
  if (!data) return null;
  const hasMedia = kind === 'video' ? hasVideoOutputMedia(data) : hasImageOutputMedia(data);
  if (!hasMedia) return null;
  const asset =
    kind === 'video'
      ? (data.videoAsset as { width?: number; height?: number } | undefined)
      : (data.imageAsset as { width?: number; height?: number } | undefined);
  const aw = Number(asset?.width);
  const ah = Number(asset?.height);
  if (Number.isFinite(aw) && aw > 0 && Number.isFinite(ah) && ah > 0) {
    return { width: aw, height: ah };
  }
  const nw = Number(data.width);
  const nh = Number(data.height);
  if (Number.isFinite(nw) && nw > 0 && Number.isFinite(nh) && nh > 0) {
    return { width: nw, height: nh };
  }
  return null;
}

/** 已有画面时优先用素材比例，否则回退节点记录的 aspectRatio */
export function resolveAspectRatioFromNodeData(
  data: Record<string, unknown> | undefined | null,
  kind: 'image' | 'video',
  fallback = kind === 'image' ? DEFAULT_IMAGE_ASPECT_RATIO : DEFAULT_VIDEO_ASPECT_RATIO,
): string {
  const px = resolveMediaPixelSizeFromNodeData(data, kind);
  if (px) return aspectRatioLabelFromPixelSize(px.width, px.height);
  const stored = String(data?.aspectRatio || '').trim();
  if (parseAspectRatioValue(stored)) return stored;
  return fallback;
}

export function resolveVideoPanelAspectRatioFromNodeData(
  data: Record<string, unknown> | undefined | null,
): VideoPanelAspectRatio {
  const label = resolveAspectRatioFromNodeData(data, 'video', DEFAULT_VIDEO_ASPECT_RATIO);
  const exact = VIDEO_PANEL_ASPECT_OPTIONS.find((o) => o === label);
  if (exact) return exact;
  return snapToVideoPanelAspectRatio(label);
}

export function resolveNodeSizeFromMediaData(
  data: Record<string, unknown> | undefined | null,
  kind: 'image' | 'video',
): { w: number; h: number } | null {
  const px = resolveMediaPixelSizeFromNodeData(data, kind);
  if (!px) return null;
  if (kind === 'image') {
    return computeNodeSizeFromMedia(
      px.width,
      px.height,
      IMAGE_NODE_MIN_W,
      IMAGE_NODE_MIN_H,
      IMAGE_NODE_MAX_W,
      IMAGE_NODE_MAX_H,
    );
  }
  return computeNodeSizeFromMedia(
    px.width,
    px.height,
    VIDEO_NODE_MIN_W,
    VIDEO_NODE_MIN_H,
    VIDEO_NODE_MAX_W,
    VIDEO_NODE_MAX_H,
  );
}

export function applyAspectRatioToNodeData(
  nodeData: Record<string, unknown>,
  aspectRatio: string,
  kind: 'image' | 'video',
): Record<string, unknown> {
  const size =
    kind === 'image' ? imageNodeSizeForAspectRatio(aspectRatio) : videoNodeSizeForAspectRatio(aspectRatio);
  if (!size) return { ...nodeData, aspectRatio };
  return {
    ...nodeData,
    aspectRatio,
    width: size.w,
    height: size.h,
    isUserResized: false,
  };
}

export function nodeStyleDimensions(w: number, h: number): { width: string; height: string } {
  return { width: `${w}px`, height: `${h}px` };
}
