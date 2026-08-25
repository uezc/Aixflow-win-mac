/** MiniMax H3 全能参考（原「多参生视频」）RunningHub AI App（国内站） */

export const MINIMAX_H3_MULTI_MODEL_ID = 'minimax-h3-multi' as const;

/**
 * RH `/run/ai-app/`：MiniMax H3 全能参考
 * （官方文档 app id；替代旧 ai-app `2085677798773051394` / workflow `2085671993520771073`）
 */
export const MINIMAX_H3_MULTI_APP_ID = '2086289185186603010';

/** @deprecated 旧 workflow；勿再提交 */
export const MINIMAX_H3_MULTI_WORKFLOW_ID = '2085671993520771073';

/** @deprecated 旧 ai-app；仅作迁移对照 */
export const MINIMAX_H3_MULTI_APP_ID_LEGACY = '2085677798773051394';

/** 最多 9 张参考图 */
export const MINIMAX_H3_MULTI_MAX_IMAGES = 9;

/** 最多 3 路参考音；未使用的槽位不要写入 nodeInfoList */
export const MINIMAX_H3_MULTI_MAX_AUDIOS = 3;

/**
 * 参考图顺序 → RH 工作流节点（image1…image9）。
 * 未使用的槽位不要写入 nodeInfoList。
 */
export const MINIMAX_H3_MULTI_IMAGE_NODES = [
  { nodeId: '18', description: 'image1' },
  { nodeId: '23', description: 'image2' },
  { nodeId: '22', description: 'image3' },
  { nodeId: '24', description: 'image4' },
  { nodeId: '32', description: 'image5' },
  { nodeId: '33', description: 'image6' },
  { nodeId: '34', description: 'image7' },
  { nodeId: '35', description: 'image8' },
  { nodeId: '76', description: 'image9' },
] as const;

export const MINIMAX_H3_MULTI_PROMPT_NODE = {
  nodeId: '25',
  fieldName: 'value',
  description: '提示词',
} as const;

export const MINIMAX_H3_MULTI_ASPECT_NODE = {
  nodeId: '26',
  fieldName: 'aspect_ratio',
  description: '比例',
} as const;

export const MINIMAX_H3_MULTI_MEGA_NODE = {
  nodeId: '26',
  fieldName: 'megapixels',
  description: '分辨率（看介绍）',
} as const;

/** 时长（秒数字符串，如 "6"|"10"|"15"|"20"）；官方文档 node 28/value */
export const MINIMAX_H3_MULTI_DURATION_NODE = {
  nodeId: '28',
  fieldName: 'value',
  description: '时长',
} as const;

/**
 * 可选参考音（最多 3 路）；不需要时勿放入 nodeInfoList。
 * fieldValue 必须为 RH `/media/upload/binary` 返回的 `filename`/`fileName`
 *（如 `openapi/xxx.mp3` 或 `api/xxx.mp3`），不要用 HTTPS download_url。
 */
export const MINIMAX_H3_MULTI_AUDIO_NODES = [
  { nodeId: '38', fieldName: 'audio', description: '参考音1' },
  { nodeId: '67', fieldName: 'audio', description: '参考音2' },
  { nodeId: '68', fieldName: 'audio', description: '参考音3' },
] as const;

/** @deprecated 仅 1 路时的兼容别名；请用 MINIMAX_H3_MULTI_AUDIO_NODES */
export const MINIMAX_H3_MULTI_AUDIO_NODE = MINIMAX_H3_MULTI_AUDIO_NODES[0];

/** 仅 720P → megapixels 0.9（与 H3 t2v/i2v 一致，勿传 1080） */
export const MINIMAX_H3_MULTI_MEGAPIXELS = '0.9';

/** 产品侧时长档（与 H3 文生/图生一致） */
export const MINIMAX_H3_MULTI_DURATION_SEC_OPTIONS = [6, 10, 15, 20] as const;

/**
 * OTS 写入 SKU（720p × 时长）：
 * minimax-h3-multi-720p-6s / -10s / -15s / -20s
 */

export function isMinimaxH3MultiModel(model: string | undefined | null): boolean {
  return String(model || '').trim() === MINIMAX_H3_MULTI_MODEL_ID;
}

/** 规范化最多 9 张非空参考图（保持顺序、去空） */
export function normalizeMinimaxH3MultiImages(images: string[] | undefined | null): string[] {
  const out: string[] = [];
  for (const u of images || []) {
    const t = String(u || '').trim();
    if (!t) continue;
    out.push(t);
    if (out.length >= MINIMAX_H3_MULTI_MAX_IMAGES) break;
  }
  return out;
}

/** 规范化最多 3 路非空参考音（保持顺序、去空、去重） */
export function normalizeMinimaxH3MultiAudios(audios: string[] | undefined | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of audios || []) {
    const t = String(u || '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MINIMAX_H3_MULTI_MAX_AUDIOS) break;
  }
  return out;
}
