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
  /** 与视频画面裁剪一致：居中留边，便于拖选 */
  return clampCropRect({ x: 0.12, y: 0.14, w: 0.76, h: 0.72 });
}

/** 图片宽高比是否接近目标（默认约 4%） */
export function aspectsApproximatelyEqual(
  imageAspect: number,
  targetAspect: number,
  tolerance = 0.04,
): boolean {
  if (!(imageAspect > 0) || !(targetAspect > 0)) return false;
  return Math.abs(imageAspect - targetAspect) / targetAspect <= tolerance;
}

/**
 * 在归一化图像坐标中，生成最大居中裁剪框，使其像素宽高比为 `lockAspect`（宽/高）。
 * `imageAspect` = naturalWidth / naturalHeight。
 */
export function defaultCropRectForAspect(
  imageAspect: number,
  lockAspect: number,
): NormalizedCropRect {
  if (!(imageAspect > 0) || !(lockAspect > 0)) return defaultCropRect();
  // 归一化空间中 w/h = lockAspect / imageAspect
  const normRatio = lockAspect / imageAspect;
  let nw: number;
  let nh: number;
  if (normRatio >= 1) {
    nw = 1;
    nh = 1 / normRatio;
  } else {
    nh = 1;
    nw = normRatio;
  }
  return clampCropRect({ x: (1 - nw) / 2, y: (1 - nh) / 2, w: nw, h: nh });
}

/**
 * object-fit:cover + object-position(百分比) → 归一化裁剪框。
 * posX/posY：0=贴齐起边，100=贴齐终边（与 CSS object-position 一致）。
 */
export function objectPositionCoverToCropRect(
  imageAspect: number,
  frameAspect: number,
  posXPercent: number,
  posYPercent: number,
): NormalizedCropRect {
  if (!(imageAspect > 0) || !(frameAspect > 0)) return defaultCropRect();
  const px = Math.max(0, Math.min(100, posXPercent)) / 100;
  const py = Math.max(0, Math.min(100, posYPercent)) / 100;
  let nw: number;
  let nh: number;
  if (imageAspect > frameAspect) {
    nh = 1;
    nw = frameAspect / imageAspect;
  } else {
    nw = 1;
    nh = imageAspect / frameAspect;
  }
  return clampCropRect({
    x: (1 - nw) * px,
    y: (1 - nh) * py,
    w: nw,
    h: nh,
  });
}

/** cover 铺满后的显示尺寸与可平移边界：maxX/maxY 恒为 0，min ≤ 0 */
export function coverTranslateLayout(
  imgW: number,
  imgH: number,
  cellW: number,
  cellH: number,
): {
  scale: number;
  dispW: number;
  dispH: number;
  minX: number;
  minY: number;
  maxX: 0;
  maxY: 0;
} {
  const iw = Math.max(1, imgW);
  const ih = Math.max(1, imgH);
  const cw = Math.max(1, cellW);
  const ch = Math.max(1, cellH);
  const scale = Math.max(cw / iw, ch / ih);
  const dispW = iw * scale;
  const dispH = ih * scale;
  return {
    scale,
    dispW,
    dispH,
    minX: cw - dispW,
    minY: ch - dispH,
    maxX: 0,
    maxY: 0,
  };
}

export function clampCoverTranslate(
  offsetX: number,
  offsetY: number,
  minX: number,
  minY: number,
): { offsetX: number; offsetY: number } {
  // 上限锚点恒为 0：不能往正方向拖出空白
  return {
    offsetX: Math.min(0, Math.max(minX, offsetX)),
    offsetY: Math.min(0, Math.max(minY, offsetY)),
  };
}

/** cover + translate(offset)（max=0）→ 归一化裁剪框 */
export function coverTranslateToCropRect(
  imgW: number,
  imgH: number,
  cellW: number,
  cellH: number,
  offsetX: number,
  offsetY: number,
): NormalizedCropRect {
  const { scale, minX, minY } = coverTranslateLayout(imgW, imgH, cellW, cellH);
  const { offsetX: ox, offsetY: oy } = clampCoverTranslate(offsetX, offsetY, minX, minY);
  const iw = Math.max(1, imgW);
  const ih = Math.max(1, imgH);
  const cw = Math.max(1, cellW);
  const ch = Math.max(1, cellH);
  return clampCropRect({
    x: -ox / scale / iw,
    y: -oy / scale / ih,
    w: cw / scale / iw,
    h: ch / scale / ih,
  });
}

export function loadImageNaturalSize(src: string): Promise<{ w: number; h: number }> {
  return loadImageElement(src).then((img) => ({
    w: img.naturalWidth || 0,
    h: img.naturalHeight || 0,
  }));
}

/** @deprecated 使用 defaultCropRect（已与图像统一） */
export function defaultVideoCropRect(): NormalizedCropRect {
  return defaultCropRect();
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
