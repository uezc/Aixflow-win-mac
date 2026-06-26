/**
 * 前端图片模型下架：Nano banana、Seedream 4.5、Midjourney v7（悠船）不再出现在下拉中；
 * 旧工程 data.model 归一到 DEFAULT_IMAGE_MODEL。
 */
export const RETIRED_IMAGE_MODEL_IDS = [
  'nano-banana',
  'nano-banana-2',
  'nano-banana-2-2k',
  'nano-banana-2-4k',
  'seedream-v4.5',
  'youchuan-text-to-image-v7',
] as const;

const RETIRED_SET = new Set<string>(RETIRED_IMAGE_MODEL_IDS);

export const DEFAULT_IMAGE_MODEL = 'banana-2.0' as const;

export function isRetiredImageModel(model: string | undefined | null): boolean {
  return RETIRED_SET.has(String(model ?? '').trim());
}

export function normalizeImageModelIfRetired(model: string | undefined | null): string {
  const m = String(model ?? '').trim();
  return isRetiredImageModel(m) ? DEFAULT_IMAGE_MODEL : m;
}

export function filterActiveImageModels<T extends { value: string }>(options: readonly T[]): T[] {
  return options.filter((opt) => !isRetiredImageModel(opt.value));
}
