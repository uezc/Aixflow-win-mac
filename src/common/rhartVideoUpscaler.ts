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

/** 最短计费时长（秒） */
export const RHART_VIDEO_UPSCALER_MIN_BILLING_SEC = 5;

/**
 * 计费秒数：先与播放器时钟对齐（floor 秒，如 6.2→6 / 显示 0:06），再不少于 5 秒；未知按 5 秒。
 * （RH 文档为 ceil；产品侧与画布进度条时长展示对齐，避免 6.x 被算成 7。）
 */
export function normalizeRhartVideoUpscalerBillingSec(durationSec: unknown): number {
  const n = Number(durationSec);
  if (!Number.isFinite(n) || n <= 0) return RHART_VIDEO_UPSCALER_MIN_BILLING_SEC;
  const capped = Math.min(n, RHART_VIDEO_UPSCALER_MAX_DURATION_SEC);
  const aligned = Math.max(0, Math.floor(capped + 1e-6));
  return Math.max(RHART_VIDEO_UPSCALER_MIN_BILLING_SEC, aligned);
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
