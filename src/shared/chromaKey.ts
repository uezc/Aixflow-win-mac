/**
 * 色度抠像：预览（canvas）与导出（ffmpeg）共用参数映射与键控度量。
 * - 高饱和绿/蓝幕：YUV 色度距离（对齐 ffmpeg chromakey），避免暗绿键色在 RGB 欧氏距离下误抠肤色/夹克
 * - 近黑/灰/白或低饱和：仍用 RGB 欧氏距离（对齐 ffmpeg colorkey）
 */

export type ChromaRgb = { r: number; g: number; b: number };

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function parseChromaHex(hex: string): ChromaRgb | null {
  const m = String(hex || '')
    .trim()
    .match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** 与 ffmpeg vf_chromakey RGB_TO_U / RGB_TO_V 一致（浮点近似） */
export function rgbToUv(r: number, g: number, b: number): { u: number; v: number } {
  return {
    u: -0.16874 * r - 0.33126 * g + 0.5 * b + 128,
    v: 0.5 * r - 0.41869 * g - 0.08131 * b + 128,
  };
}

/** ffmpeg chromakey：sqrt((du²+dv²)/(255²·2)) */
export function chromaUvDistance(pixel: ChromaRgb, key: ChromaRgb): number {
  const a = rgbToUv(pixel.r, pixel.g, pixel.b);
  const k = rgbToUv(key.r, key.g, key.b);
  const du = a.u - k.u;
  const dv = a.v - k.v;
  return Math.sqrt((du * du + dv * dv) / (255 * 255 * 2));
}

/** ffmpeg colorkey：sqrt((dr²+dg²+db²)/(255²·3)) */
export function chromaRgbDistance(pixel: ChromaRgb, key: ChromaRgb): number {
  const dr = pixel.r - key.r;
  const dg = pixel.g - key.g;
  const db = pixel.b - key.b;
  return Math.sqrt((dr * dr + dg * dg + db * db) / (255 * 255 * 3));
}

export function keyColorStats(key: ChromaRgb): { luma: number; sat: number } {
  const luma = (0.2126 * key.r + 0.7152 * key.g + 0.0722 * key.b) / 255;
  const maxC = Math.max(key.r, key.g, key.b);
  const minC = Math.min(key.r, key.g, key.b);
  const sat = maxC <= 0 ? 0 : (maxC - minC) / maxC;
  return { luma, sat };
}

/**
 * 典型绿/蓝幕：走色相（UV）键控。
 * 近黑/低饱和不用 UV（中性色 UV≈128，宽阈值会整帧变透）。
 */
export function shouldUseHueChromaKey(key: ChromaRgb): boolean {
  const { luma, sat } = keyColorStats(key);
  if (sat < 0.22 || luma < 0.12 || luma > 0.95) return false;
  return key.g > key.r + 25 || key.b > key.r + 25;
}

export function despillTypeForKey(key: ChromaRgb): 'green' | 'blue' | null {
  if (!shouldUseHueChromaKey(key)) return null;
  if (key.b > key.g + 15 && key.b > key.r + 25) return 'blue';
  if (key.g > key.r + 25) return 'green';
  return null;
}

/** 吸色/预设后推荐参数 */
export function suggestKeyParamsForColor(hex: string): {
  similarity: number;
  blend: number;
  warnDarkOrGray: boolean;
} {
  const key = parseChromaHex(hex);
  if (!key) return { similarity: 0.14, blend: 0.04, warnDarkOrGray: false };
  const { luma, sat } = keyColorStats(key);
  const warnDarkOrGray = luma < 0.18 || luma > 0.92 || sat < 0.18;
  if (warnDarkOrGray) {
    return { similarity: 0.08, blend: 0.02, warnDarkOrGray: true };
  }
  // 高饱和绿/蓝：默认收紧；幕布偏暗时再收一档（暗绿在 RGB 下尤其危险）
  if (sat > 0.4 && (key.g > key.r + 35 || key.b > key.r + 35)) {
    if (luma < 0.35) return { similarity: 0.11, blend: 0.03, warnDarkOrGray: false };
    if (luma < 0.55) return { similarity: 0.13, blend: 0.04, warnDarkOrGray: false };
    return { similarity: 0.15, blend: 0.05, warnDarkOrGray: false };
  }
  return { similarity: 0.14, blend: 0.04, warnDarkOrGray: false };
}

/**
 * 预览对称软边 [sim-blend, sim+blend] → ffmpeg 单侧软边：
 * 透明 [0, sim]，过渡 [sim, sim+blend]。
 */
export function mapPreviewChromaParamsToFfmpeg(
  similarity: number,
  blend: number,
): { similarity: number; blend: number } {
  const simN = Math.min(1, Math.max(0.01, Number(similarity) || 0.15));
  const blN = Math.min(simN * 0.85, Math.max(0, Number(blend) || 0));
  if (blN <= 0.0001) {
    return { similarity: simN, blend: 0 };
  }
  return {
    similarity: Math.max(0.00001, simN - blN),
    blend: Math.min(1, 2 * blN),
  };
}

/** 绿溢抑制：把偏绿通道拉回 max(R,B)（蓝幕则压蓝） */
export function applyDespillToPixel(
  data: Uint8ClampedArray,
  i: number,
  type: 'green' | 'blue',
  strength = 0.7,
): void {
  const r = data[i]!;
  const g = data[i + 1]!;
  const b = data[i + 2]!;
  if (type === 'green') {
    const lim = Math.max(r, b);
    if (g > lim) data[i + 1] = Math.round(g - (g - lim) * strength);
  } else {
    const lim = Math.max(r, g);
    if (b > lim) data[i + 2] = Math.round(b - (b - lim) * strength);
  }
}

/**
 * 就地改 RGBA：按键色写 alpha，可选 despill。
 * 软边与历史预览一致：透明区 dist<=sim-blend，过渡到 sim+blend。
 */
export function applyChromaToRgba(
  data: Uint8ClampedArray,
  key: ChromaRgb,
  similarity: number,
  blend: number,
): void {
  const simN = Math.max(0.01, clamp01(similarity));
  const blN = Math.min(simN * 0.85, Math.max(0, clamp01(blend)));
  const useHue = shouldUseHueChromaKey(key);
  const spill = despillTypeForKey(key);

  for (let i = 0; i < data.length; i += 4) {
    const pixel = { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! };
    const dist = useHue ? chromaUvDistance(pixel, key) : chromaRgbDistance(pixel, key);
    let alpha = 255;
    if (dist <= Math.max(0, simN - blN)) alpha = 0;
    else if (blN > 0.001 && dist < simN + blN) {
      alpha = Math.round(((dist - (simN - blN)) / (2 * blN)) * 255);
    }
    alpha = Math.max(0, Math.min(255, alpha));
    data[i + 3] = alpha;
    if (alpha === 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      continue;
    }
    if (spill) {
      // 边缘多压一点绿溢，实心前景轻压
      const edge = 1 - alpha / 255;
      applyDespillToPixel(data, i, spill, 0.45 + edge * 0.4);
    }
  }
}

/** 构建 ffmpeg -vf 片段（已含 format=yuva420p） */
export function buildFfmpegChromaKeyVf(
  colorHexNoHash: string,
  similarity: number,
  blend: number,
  opts?: { despill?: boolean },
): string {
  const hex = String(colorHexNoHash || '')
    .replace(/^#/, '')
    .toUpperCase();
  const key = parseChromaHex(hex);
  const mapped = mapPreviewChromaParamsToFfmpeg(similarity, blend);
  const sim = mapped.similarity.toFixed(5);
  const bl = mapped.blend.toFixed(5);
  const wantDespill = opts?.despill !== false;

  if (key && shouldUseHueChromaKey(key)) {
    const spill = wantDespill ? despillTypeForKey(key) : null;
    const despill =
      spill === 'blue'
        ? ',despill=type=blue:mix=0.55:expand=0'
        : spill === 'green'
          ? ',despill=type=green:mix=0.55:expand=0'
          : '';
    // chromakey 在 YUV 上按 UV 距离剔色，再转 yuva 供 VP9 alpha
    return `chromakey=0x${hex}:${sim}:${bl}${despill},format=yuva420p`;
  }

  return `format=rgba,colorkey=0x${hex}:${sim}:${bl},format=yuva420p`;
}
