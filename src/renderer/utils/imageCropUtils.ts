export type NormalizedCropRect = { x: number; y: number; w: number; h: number };

const MIN_NORM = 0.04;

export function clampCropRect(r: NormalizedCropRect): NormalizedCropRect {
  let { x, y, w, h } = r;
  w = Math.max(MIN_NORM, Math.min(1, w));
  h = Math.max(MIN_NORM, Math.min(1, h));
  x = Math.max(0, Math.min(1 - w, x));
  y = Math.max(0, Math.min(1 - h, y));
  return { x, y, w, h };
}

export function defaultCropRect(): NormalizedCropRect {
  return { x: 0, y: 0, w: 1, h: 1 };
}

/** object-contain：图片在容器内的实际显示区域 */
export function computeContainedImageRect(
  containerW: number,
  containerH: number,
  imageW: number,
  imageH: number,
): { x: number; y: number; w: number; h: number } {
  if (containerW <= 0 || containerH <= 0 || imageW <= 0 || imageH <= 0) {
    return { x: 0, y: 0, w: containerW, h: containerH };
  }
  const scale = Math.min(containerW / imageW, containerH / imageH);
  const w = imageW * scale;
  const h = imageH * scale;
  return { x: (containerW - w) / 2, y: (containerH - h) / 2, w, h };
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

export async function cropImageToPngBuffer(
  src: string,
  rect: NormalizedCropRect,
): Promise<{ buffer: ArrayBuffer; width: number; height: number }> {
  const img = await loadImageElement(src);
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (nw < 1 || nh < 1) throw new Error('无效的图片尺寸');

  const norm = clampCropRect(rect);
  const sx = Math.max(0, Math.min(nw - 1, Math.round(norm.x * nw)));
  const sy = Math.max(0, Math.min(nh - 1, Math.round(norm.y * nh)));
  const sw = Math.max(1, Math.min(nw - sx, Math.round(norm.w * nw)));
  const sh = Math.max(1, Math.min(nh - sy, Math.round(norm.h * nh)));

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('裁剪导出失败');
  const buffer = await blob.arrayBuffer();
  return { buffer, width: sw, height: sh };
}
