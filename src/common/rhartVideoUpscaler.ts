/** RunningHub 标准模型：视频超分放大（国内站 OpenAPI v2） */

export const RHART_VIDEO_UPSCALER_MODEL_ID = 'rhart-video-upscaler' as const;

/** POST /openapi/v2/rhart-video/video-upscaler */
export const RHART_VIDEO_UPSCALER_API_PATH = '/rhart-video/video-upscaler' as const;

export const RHART_VIDEO_UPSCALER_RESOLUTIONS = ['720p', '1080p', '2k', '4k'] as const;

export type RhartVideoUpscalerResolution = (typeof RHART_VIDEO_UPSCALER_RESOLUTIONS)[number];

export const RHART_VIDEO_UPSCALER_DEFAULT_RESOLUTION: RhartVideoUpscalerResolution = '1080p';

/** 官方：输入视频最长 10 分钟 */
export const RHART_VIDEO_UPSCALER_MAX_DURATION_SEC = 10 * 60;

/**
 * 产品零售按秒价（元/秒）= RH 官方 0.14/0.21/0.35/0.56 × 1.5。
 * 与 pricing/cost_table.mjs `VIDEO_RHART_VIDEO_UPSCALER_CNY`、OTS base_price 一致。
 */
export const RHART_VIDEO_UPSCALER_CNY_PER_SEC: Record<RhartVideoUpscalerResolution, number> = {
  '720p': 0.21,
  '1080p': 0.315,
  '2k': 0.525,
  '4k': 0.84,
};

/** @deprecated 禁止「缺时长按 5 秒」；保留常量仅作文档对照，计费不再使用 */
export const RHART_VIDEO_UPSCALER_MIN_BILLING_SEC = 5;

/**
 * 计费秒数：与播放器时钟对齐（floor 秒）。
 * 缺时长 / 不足 1 秒 → null（禁止任何秒数保底，调用方必须拒跑）。
 */
export function normalizeRhartVideoUpscalerBillingSec(durationSec: unknown): number | null {
  const n = Number(durationSec);
  if (!Number.isFinite(n) || n <= 0) return null;
  const capped = Math.min(n, RHART_VIDEO_UPSCALER_MAX_DURATION_SEC);
  const aligned = Math.max(0, Math.floor(capped + 1e-6));
  if (aligned < 1) return null;
  return aligned;
}

export function normalizeRhartVideoUpscalerResolution(
  raw: unknown,
  fallback: RhartVideoUpscalerResolution = RHART_VIDEO_UPSCALER_DEFAULT_RESOLUTION,
): RhartVideoUpscalerResolution {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === '720p' || s === '720') return '720p';
  if (s === '1080p' || s === '1080') return '1080p';
  if (s === '2k' || s === '1440p') return '2k';
  if (s === '4k' || s === '2160p') return '4k';
  return fallback;
}

export function isRhartVideoUpscalerModelId(model: unknown): boolean {
  return String(model || '').trim() === RHART_VIDEO_UPSCALER_MODEL_ID;
}
