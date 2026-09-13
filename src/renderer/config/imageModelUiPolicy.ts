/**
 * 前端图片模型：活跃目录、模式过滤、下架归一。
 *
 * 活跃模型（与 ImageProvider / 定价对齐）：
 * - 文+图：rhart-image-g-2.5 / rhart-image-g-2 / banana-2.0（海外）/ seedream-v5（国内 .cn）
 * - 仅文：z-image / lens / youchuan-text-to-image-v81|v82（海外）
 * - 仅图：flux2-klein
 *
 * 悠船 v7、MJ V7、GPT image 2、全能图片 X（rhart-image-g）等已下架。
 */

export type ImageModelMode = 't2i' | 'i2i';

export type ActiveImageModelDef = {
  value: string;
  label: string;
  /** 图生图最大参考图数；仅文生为 0 */
  maxRefs: number;
  /** 支持的模式 */
  modes: readonly ImageModelMode[];
};

/** 权威活跃清单（下拉 / 导演 / 场景工具同源；文生图顺序按下表） */
export const ACTIVE_IMAGE_MODELS: readonly ActiveImageModelDef[] = [
  { value: 'rhart-image-g-2.5', label: '全能图片 G-2.5', maxRefs: 10, modes: ['t2i', 'i2i'] },
  { value: 'rhart-image-g-2', label: '全能图片 G-2.0', maxRefs: 10, modes: ['t2i', 'i2i'] },
  { value: 'banana-2.0', label: '全能图片 V2', maxRefs: 10, modes: ['t2i', 'i2i'] },
  { value: 'youchuan-text-to-image-v82', label: '悠船文生图 v8.2', maxRefs: 0, modes: ['t2i'] },
  { value: 'youchuan-text-to-image-v81', label: '悠船文生图 v8.1', maxRefs: 0, modes: ['t2i'] },
  { value: 'seedream-v5', label: 'Seedream v5', maxRefs: 10, modes: ['t2i', 'i2i'] },
  { value: 'z-image', label: 'Z-image', maxRefs: 0, modes: ['t2i'] },
  { value: 'lens', label: 'Lens', maxRefs: 0, modes: ['t2i'] },
  // 仅图生图（不出现在文生图下拉）
  { value: 'flux2-klein', label: 'Flux2 Klein', maxRefs: 3, modes: ['i2i'] },
] as const;

const ACTIVE_BY_ID = new Map(ACTIVE_IMAGE_MODELS.map((m) => [m.value, m]));

/** 前端下架：不再出现在下拉中；旧工程 data.model 归一到 DEFAULT_IMAGE_MODEL */
export const RETIRED_IMAGE_MODEL_IDS = [
  'nano-banana',
  'nano-banana-2',
  'nano-banana-2-2k',
  'nano-banana-2-4k',
  'seedream-v4.5',
  'youchuan-text-to-image-v7',
  'mj-v7',
  'gpt-image-2',
  'rhart-image-g',
  'rhart-image-g-1.5',
] as const;

const RETIRED_SET = new Set<string>(RETIRED_IMAGE_MODEL_IDS);

export const DEFAULT_IMAGE_MODEL = 'rhart-image-g-2' as const;

export function isRetiredImageModel(model: string | undefined | null): boolean {
  return RETIRED_SET.has(String(model ?? '').trim());
}

export function isActiveImageModel(model: string | undefined | null): boolean {
  return ACTIVE_BY_ID.has(String(model ?? '').trim());
}

export function normalizeImageModelIfRetired(model: string | undefined | null): string {
  const m = String(model ?? '').trim();
  if (!m) return DEFAULT_IMAGE_MODEL;
  if (isRetiredImageModel(m) || !isActiveImageModel(m)) return DEFAULT_IMAGE_MODEL;
  return m;
}

export function filterActiveImageModels<T extends { value: string }>(options: readonly T[]): T[] {
  return options.filter((opt) => !isRetiredImageModel(opt.value) && isActiveImageModel(opt.value));
}

export function getImageModelMaxRefs(model: string | undefined | null): number {
  const def = ACTIVE_BY_ID.get(String(model ?? '').trim());
  return def?.maxRefs ?? 0;
}

export function getImageModelLabel(model: string | undefined | null): string {
  const id = String(model ?? '').trim();
  return ACTIVE_BY_ID.get(id)?.label || id || '未知模型';
}

export function imageModelSupportsI2I(model: string | undefined | null): boolean {
  const def = ACTIVE_BY_ID.get(String(model ?? '').trim());
  return !!def && def.modes.includes('i2i') && def.maxRefs > 0;
}

export function imageModelSupportsT2I(model: string | undefined | null): boolean {
  const def = ACTIVE_BY_ID.get(String(model ?? '').trim());
  return !!def && def.modes.includes('t2i');
}

/**
 * 按文生/图生与参考图数量过滤活跃模型。
 * - 无参考图：仅 t2i（及双模式中的文生侧）
 * - 有参考图：仅支持 i2i 且 maxRefs >= refCount
 */
export function filterImageModelsForMode(params: {
  hasRefs: boolean;
  refCount?: number;
}): ActiveImageModelDef[] {
  const hasRefs = !!params.hasRefs;
  const refCount = Math.max(0, Number(params.refCount) || 0);
  if (!hasRefs) {
    return ACTIVE_IMAGE_MODELS.filter((m) => m.modes.includes('t2i'));
  }
  return ACTIVE_IMAGE_MODELS.filter(
    (m) => m.modes.includes('i2i') && m.maxRefs > 0 && refCount <= m.maxRefs,
  );
}

/** 下拉用：{ value, label } */
export function filterImageModelOptionsForMode(params: {
  hasRefs: boolean;
  refCount?: number;
}): Array<{ value: string; label: string }> {
  return filterImageModelsForMode(params).map(({ value, label }) => ({ value, label }));
}
