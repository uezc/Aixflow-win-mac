/** Z-image 文生图：可选比例（与图片节点面板一致） */

export const Z_IMAGE_ASPECT_RATIOS = [

  '1:1',

  '2:3',

  '3:2',

  '3:4',

  '4:3',

  '4:5',

  '5:4',

  '9:16',

  '16:9',

  '21:9',

] as const;



export type ZImageResolutionTier = '720p' | '1080p';



/** 面板 / node.data.resolution 取值 */

export const Z_IMAGE_RESOLUTION_VALUES = ['720p', '1080p'] as const;



const Z_IMAGE_SHORT_EDGE: Record<ZImageResolutionTier, number> = {

  '720p': 720,

  '1080p': 1080,

};



export function normalizeZImageResolutionTier(resolution?: string): ZImageResolutionTier {

  const r = String(resolution || '')

    .trim()

    .toLowerCase();

  if (r === '720p' || r === '720') return '720p';

  return '1080p';

}



/** 与 nx_model_config / FC 扣费主键一致：z-image-720p | z-image-1080p */

export function zImageBillingModelId(resolution?: string): string {

  return normalizeZImageResolutionTier(resolution) === '720p' ? 'z-image-720p' : 'z-image-1080p';

}

/** Flux2 Klein 图生图扣费主键：flux2-klein-720p | flux2-klein-1080p */
export function flux2KleinBillingModelId(resolution?: string): string {
  return normalizeZImageResolutionTier(resolution) === '720p' ? 'flux2-klein-720p' : 'flux2-klein-1080p';
}

/** Lens 文生图扣费主键：lens-720p | lens-1080p */
export function lensBillingModelId(resolution?: string): string {
  return normalizeZImageResolutionTier(resolution) === '720p' ? 'lens-720p' : 'lens-1080p';
}

function parseAspectRatio(ratio: string): { w: number; h: number } | null {

  const m = String(ratio || '')

    .trim()

    .match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);

  if (!m) return null;

  const w = Number(m[1]);

  const h = Number(m[2]);

  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;

  return { w, h };

}



/**

 * 按比例 + 720P/1080P 档位换算像素：短边 = 720 或 1080，长边按比例推算。

 * 例：9:16 + 720P → 720×1280；16:9 + 1080P → 1920×1080；3:4 + 1080P → 1080×1440。

 */

export function zImageDimensionsForAspect(

  ratio: string,

  resolution?: string,

): { width: number; height: number } {

  const tier = normalizeZImageResolutionTier(resolution);

  const shortEdge = Z_IMAGE_SHORT_EDGE[tier];

  const parsed = parseAspectRatio(ratio) ?? { w: 16, h: 9 };



  if (parsed.w >= parsed.h) {

    const height = shortEdge;

    const width = Math.round((shortEdge * parsed.w) / parsed.h);

    return { width, height };

  }

  const width = shortEdge;

  const height = Math.round((shortEdge * parsed.h) / parsed.w);

  return { width, height };

}



/** 兼容旧引用 */

export const Z_IMAGE_1080P_MAP: Record<string, { width: number; height: number }> = Object.fromEntries(

  Z_IMAGE_ASPECT_RATIOS.map((r) => [r, zImageDimensionsForAspect(r, '1080p')]),

);



export const Z_IMAGE_720P_MAP: Record<string, { width: number; height: number }> = Object.fromEntries(

  Z_IMAGE_ASPECT_RATIOS.map((r) => [r, zImageDimensionsForAspect(r, '720p')]),

);


