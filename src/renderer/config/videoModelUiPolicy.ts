/**
 * 前端视频模型下架：可灵 / 万相 / 海螺 / Veo 3.1 Pro 系列不再出现在下拉中；
 * 旧工程 data.model 仍会归一到 DEFAULT_VIDEO_MODEL。
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
  'rhart-v3.1-pro-se',
  'rhart-v3.1-pro-official-i2v',
] as const;

export type RetiredVideoModelId = (typeof RETIRED_VIDEO_MODEL_IDS)[number];

const RETIRED_SET = new Set<string>(RETIRED_VIDEO_MODEL_IDS);

/** 新建节点、下架模型迁移时的默认视频模型 */
export const DEFAULT_VIDEO_MODEL = 'grok-3' as const;

export function isRetiredVideoModel(model: string | undefined | null): boolean {
  return RETIRED_SET.has(String(model ?? '').trim());
}

export function normalizeVideoModelIfRetired(model: string | undefined | null): string {
  const m = String(model ?? '').trim();
  return isRetiredVideoModel(m) ? DEFAULT_VIDEO_MODEL : m;
}

/** 从候选列表中去掉已下架模型 */
export function filterActiveVideoModels<T extends string>(models: readonly T[]): T[] {
  return models.filter((m) => !isRetiredVideoModel(m)) as T[];
}
