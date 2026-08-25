/**
 * 前端视频模型下架：可灵 / 万相 / 海螺 / Veo 3.1 Pro 文生与官方图生 / Veo 3.1 fast（含首尾帧）/
 * Grok video3 / Gemini Omni / LTX2.3 MSR（多图）·MSR 图像+声音 不再出现在下拉中；
 * LTX2.3 保留：图生（i2v）、文生（t2v）、首位帧（rh-video-start-end）、对口型（lipsync）；
 * rhart-v3.1-pro-se、全能视频 Omni Flash、全能视频X 等保持上架；旧工程 data.model 会归一到安全默认。
 */
export const RETIRED_VIDEO_MODEL_IDS = [
  'kling-v2.6-pro',
  'kling-video-o1',
  'kling-video-o1-i2v',
  'kling-video-o1-start-end',
  'kling-video-o1-ref',
  'wan-2.6',
  'wan-2.6-flash',
  'hailuo-02-t2v-standard',
  'hailuo-2.3-t2v-standard',
  'hailuo-02-i2v-standard',
  'hailuo-2.3-i2v-standard',
  'rhart-v3.1-pro',
  'rhart-v3.1-pro-official-i2v',
  'rhart-v3.1-fast',
  'rhart-v3.1-fast-se',
  'grok-3',
  'gemini-omni',
  'ltx-2.3-msr-av',
  'ltx-2.3-hdr-multi',
] as const;

export type RetiredVideoModelId = (typeof RETIRED_VIDEO_MODEL_IDS)[number];

const RETIRED_SET = new Set<string>(RETIRED_VIDEO_MODEL_IDS);

/** 新建节点、下架模型迁移时的默认视频模型 */
export const DEFAULT_VIDEO_MODEL = 'rhart-video-x' as const;

/**
 * 首尾帧 fast → V3.1-pro 首尾帧；
 * MSR 图像+声音 → LTX 对口型；
 * LTX MSR（多图）→ LTX 图生。
 */
const RETIRED_MODEL_FALLBACK: Partial<Record<RetiredVideoModelId, string>> = {
  'rhart-v3.1-fast-se': 'rhart-v3.1-pro-se',
  'ltx-2.3-msr-av': 'ltx-2.3-lipsync',
  'ltx-2.3-hdr-multi': 'ltx-2.3-i2v',
};

export function isRetiredVideoModel(model: string | undefined | null): boolean {
  return RETIRED_SET.has(String(model ?? '').trim());
}

export function normalizeVideoModelIfRetired(model: string | undefined | null): string {
  const m = String(model ?? '').trim();
  if (!isRetiredVideoModel(m)) return m;
  return RETIRED_MODEL_FALLBACK[m as RetiredVideoModelId] ?? DEFAULT_VIDEO_MODEL;
}

/** 从候选列表中去掉已下架模型 */
export function filterActiveVideoModels<T extends string>(models: readonly T[]): T[] {
  return models.filter((m) => !isRetiredVideoModel(m)) as T[];
}

/**
 * 导演台普通生视频活跃 i2v 目录。
 * 不含：对口型（含 MiniMax-H3 口型同步）、首尾帧（rhart-v3.1-pro-se / rh-video-start-end）、
 * WanAnimate、文生-only、已下架。
 */
export const ACTIVE_I2V_CATALOG_MODEL_IDS = [
  'ltx-2.3-i2v',
  'minimax-h3-i2v',
  'minimax-h3-multi',
  'seedance-2.0-fast',
  'seedance-2.0-mini',
  'gemini-omni-flash',
  'rhart-video-x',
] as const;

export type ActiveI2vCatalogModelId = (typeof ACTIVE_I2V_CATALOG_MODEL_IDS)[number];

/** 活跃 i2v 目录（再过滤一次下架，便于与 VideoInputPanel 共用） */
export function getActiveI2vCatalogModelIds(): ActiveI2vCatalogModelId[] {
  return filterActiveVideoModels(ACTIVE_I2V_CATALOG_MODEL_IDS);
}
