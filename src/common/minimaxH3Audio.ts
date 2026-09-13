/** MiniMax-H3 口型同步 RunningHub AI App（国内站） */

export const MINIMAX_H3_AUDIO_MODEL_ID = 'minimax-h3-audio' as const;

/** RH ai-app：MiniMax H3 口型同步 */
export const MINIMAX_H3_AUDIO_APP_ID = '2086260808442531842';

/** 最多 5 张参考图（image1 通常必填；2–5 不需要时勿写入 nodeInfoList） */
export const MINIMAX_H3_AUDIO_MAX_IMAGES = 5;

/**
 * 参考图顺序 → RH 工作流节点（image1…image5）。
 * 未使用的槽位不要写入 nodeInfoList。
 */
export const MINIMAX_H3_AUDIO_IMAGE_NODES = [
  { nodeId: '137', description: 'image1' },
  { nodeId: '182', description: 'image2' },
  { nodeId: '199', description: 'image3' },
  { nodeId: '200', description: 'image4' },
  { nodeId: '202', description: 'image5' },
] as const;

export const MINIMAX_H3_AUDIO_PROMPT_NODE = {
  nodeId: '138',
  fieldName: 'value',
  description: '提示词',
} as const;

export const MINIMAX_H3_AUDIO_ASPECT_NODE = {
  nodeId: '115',
  fieldName: 'aspect_ratio',
  description: '比例选择',
} as const;

export const MINIMAX_H3_AUDIO_MEGA_NODE = {
  nodeId: '115',
  fieldName: 'megapixels',
  description: '分辨率（看介绍）',
} as const;

/**
 * 参考音（必填）；fieldValue 必须为 RH `/media/upload/binary` 返回的 `filename`/`fileName`
 *（如 `openapi/xxx.mp3`），不要用 HTTPS download_url。
 * 客户端应对参考音强制转码为干净 MP3 再上传。
 * 工作流按参考音自动读时长，不再传时长节点。
 */
export const MINIMAX_H3_AUDIO_AUDIO_NODE = {
  nodeId: '171',
  fieldName: 'audio',
  description: '参考音',
} as const;

/** 480P → 0.4；720P → 0.9（与其它 H3 一致，勿传 1080） */
export {
  MINIMAX_H3_DEFAULT_RESOLUTION,
  MINIMAX_H3_MEGAPIXELS_BY_RESOLUTION,
  MINIMAX_H3_RESOLUTION_OPTIONS,
  minimaxH3MegapixelsForResolution,
  normalizeMinimaxH3Resolution,
  type MinimaxH3Resolution,
} from './minimaxH3Resolution.js';

/** @deprecated 请用 minimaxH3MegapixelsForResolution；默认 720P */
export const MINIMAX_H3_AUDIO_MEGAPIXELS = '0.9';

/**
 * 计费档位（秒）：按参考音实际时长向上取整到档。
 * OTS SKU：minimax-h3-audio-720p-{6|10|15|20}s（勿再写 5s）
 */
export const MINIMAX_H3_AUDIO_DURATION_SEC_OPTIONS = [6, 10, 15, 20] as const;

export type MinimaxH3AudioBillingDurationSec =
  (typeof MINIMAX_H3_AUDIO_DURATION_SEC_OPTIONS)[number];

/**
 * 参考音实际秒数 → 计费档：取 ≥ 实际秒数的最小档；超过 20s 封顶 20；
 * 读不到/无效时长保守按 20s。
 *
 * 例：6.0→6；7.1→10；10.01→15；20.1→20；NaN→20
 */
export function mapMinimaxH3AudioBillingDurationSec(
  actualSec: number | undefined | null,
): MinimaxH3AudioBillingDurationSec {
  const tiers = MINIMAX_H3_AUDIO_DURATION_SEC_OPTIONS;
  const n = Number(actualSec);
  if (!Number.isFinite(n) || n <= 0) return 20;
  for (const t of tiers) {
    if (t >= n) return t;
  }
  return 20;
}

export function isMinimaxH3AudioModel(model: string | undefined | null): boolean {
  return String(model || '').trim() === MINIMAX_H3_AUDIO_MODEL_ID;
}

/** 规范化最多 5 张非空参考图（保持顺序、去空） */
export function normalizeMinimaxH3AudioImages(images: string[] | undefined | null): string[] {
  const out: string[] = [];
  for (const u of images || []) {
    const t = String(u || '').trim();
    if (!t) continue;
    out.push(t);
    if (out.length >= MINIMAX_H3_AUDIO_MAX_IMAGES) break;
  }
  return out;
}
