/**
 * MiniMax-H3 全系（t2v / i2v / multi / audio）分辨率 → RH megapixels。
 * 480P → 0.4；720P → 0.9（勿传 1080）。
 */

export const MINIMAX_H3_RESOLUTION_OPTIONS = ['480p', '720p'] as const;

export type MinimaxH3Resolution = (typeof MINIMAX_H3_RESOLUTION_OPTIONS)[number];

export const MINIMAX_H3_DEFAULT_RESOLUTION: MinimaxH3Resolution = '720p';

/** UI / SKU 档位 → RH `megapixels` fieldValue */
export const MINIMAX_H3_MEGAPIXELS_BY_RESOLUTION: Record<MinimaxH3Resolution, string> = {
  '480p': '0.4',
  '720p': '0.9',
};

export function isMinimaxH3Resolution(raw: unknown): raw is MinimaxH3Resolution {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  return s === '480p' || s === '720p';
}

/** 非法 / 旧 1080p → 默认 720p */
export function normalizeMinimaxH3Resolution(
  raw: unknown,
  fallback: MinimaxH3Resolution = MINIMAX_H3_DEFAULT_RESOLUTION,
): MinimaxH3Resolution {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === '480p' || s === '480' || s === '0.4') return '480p';
  if (s === '720p' || s === '720' || s === '0.9') return '720p';
  return fallback;
}

export function minimaxH3MegapixelsForResolution(raw: unknown): string {
  const res = normalizeMinimaxH3Resolution(raw);
  return MINIMAX_H3_MEGAPIXELS_BY_RESOLUTION[res];
}
