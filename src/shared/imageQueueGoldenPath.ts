/**
 * Image Unified Cloud Queue Golden Path
 * 7 ACTIVE 图片模型全部强制 Queue（禁止 Direct 回落）
 * - z-image / lens：ai-app T2I（.cn）
 * - flux2-klein：ai-app I2I 1–3 图（.cn）
 * - rhart-image-g-2：OpenAPI T2I+I2I（.ai）
 * - rhart-image-g-2.5：OpenAPI T2I+I2I（.ai，flare 文生 / sunburst 图生）
 * - banana-2.0：OpenAPI T2I+I2I（.ai）
 * - seedream-v5：OpenAPI T2I+I2I（.cn）
 * - youchuan-text-to-image-v81 / v82：OpenAPI T2I（.ai）
 * Feature Gate：IMAGE_QUEUE_ENABLED / VITE_IMAGE_QUEUE_ENABLED（未设置默认开启）
 */

import {
  flux2KleinBillingModelId,
  lensBillingModelId,
  normalizeZImageResolutionTier,
  Z_IMAGE_ASPECT_RATIOS,
  zImageBillingModelId,
  zImageDimensionsForAspect,
} from '../common/zImageDimensions.js';

function readEnvFlag(raw: string | undefined, defaultOn = true): boolean {
  if (raw == null || String(raw).trim() === '') return defaultOn;
  const v = String(raw).trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** 主进程：process.env.IMAGE_QUEUE_ENABLED（未设置默认 true） */
export function isImageQueueGoldenPathEnabled(): boolean {
  if (typeof process !== 'undefined' && process.env && 'IMAGE_QUEUE_ENABLED' in process.env) {
    return readEnvFlag(process.env.IMAGE_QUEUE_ENABLED, true);
  }
  return true;
}

/** 渲染进程：import.meta.env.VITE_IMAGE_QUEUE_ENABLED（未设置默认 true） */
export function isImageQueueGoldenPathEnabledRenderer(): boolean {
  try {
    const vite = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
    if (vite && 'VITE_IMAGE_QUEUE_ENABLED' in vite) {
      return readEnvFlag(vite.VITE_IMAGE_QUEUE_ENABLED, true);
    }
  } catch {
    /* ignore */
  }
  return true;
}

export const IMAGE_QUEUE_Z_IMAGE_MODEL = 'z-image' as const;
export const IMAGE_QUEUE_LENS_MODEL = 'lens' as const;
export const IMAGE_QUEUE_FLUX2_KLEIN_MODEL = 'flux2-klein' as const;
export const IMAGE_QUEUE_RHART_IMAGE_G2_MODEL = 'rhart-image-g-2' as const;
export const IMAGE_QUEUE_RHART_IMAGE_G25_MODEL = 'rhart-image-g-2.5' as const;
export const IMAGE_QUEUE_BANANA_20_MODEL = 'banana-2.0' as const;
export const IMAGE_QUEUE_SEEDREAM_V5_MODEL = 'seedream-v5' as const;
export const IMAGE_QUEUE_YOUCHUAN_V81_MODEL = 'youchuan-text-to-image-v81' as const;
export const IMAGE_QUEUE_YOUCHUAN_V82_MODEL = 'youchuan-text-to-image-v82' as const;

/** 已具备 Queue Adapter 的型号 —— 禁止再走 rhPostCharge Direct */
export const IMAGE_QUEUE_ONLY_MODEL_IDS = [
  IMAGE_QUEUE_Z_IMAGE_MODEL,
  IMAGE_QUEUE_LENS_MODEL,
  IMAGE_QUEUE_FLUX2_KLEIN_MODEL,
  IMAGE_QUEUE_RHART_IMAGE_G2_MODEL,
  IMAGE_QUEUE_RHART_IMAGE_G25_MODEL,
  IMAGE_QUEUE_BANANA_20_MODEL,
  IMAGE_QUEUE_SEEDREAM_V5_MODEL,
  IMAGE_QUEUE_YOUCHUAN_V81_MODEL,
  IMAGE_QUEUE_YOUCHUAN_V82_MODEL,
] as const;

export type ImageQueueOnlyModelId = (typeof IMAGE_QUEUE_ONLY_MODEL_IDS)[number];

const IMAGE_QUEUE_ONLY_SET = new Set<string>(IMAGE_QUEUE_ONLY_MODEL_IDS);

export function isImageQueueOnlyModel(modelId: unknown): boolean {
  return IMAGE_QUEUE_ONLY_SET.has(String(modelId ?? '').trim());
}

export function assertNotDirectChargeForImageQueueOnlyModel(modelId: unknown, via = 'direct'): void {
  const m = String(modelId ?? '').trim();
  if (!IMAGE_QUEUE_ONLY_SET.has(m)) return;
  throw new Error(
    `QUEUE_ONLY_MODEL_DIRECT_FORBIDDEN:${m} 已强制云端排队，禁止 Direct（via=${via}）`,
  );
}

export const Z_IMAGE_APP_ID = '2059599553522921474' as const;
export const Z_IMAGE_RUN_PATH = `/run/ai-app/${Z_IMAGE_APP_ID}` as const;

export const LENS_APP_ID = '2063798801864945666' as const;
export const LENS_RUN_PATH = `/run/ai-app/${LENS_APP_ID}` as const;

export const FLUX2_KLEIN_APP_ID = '2059939823342936066' as const;
export const FLUX2_KLEIN_RUN_PATH = `/run/ai-app/${FLUX2_KLEIN_APP_ID}` as const;

export const RHART_IMAGE_G2_T2I_PATH = '/rhart-image-g-2/text-to-image' as const;
export const RHART_IMAGE_G2_I2I_PATH = '/rhart-image-g-2/image-to-image' as const;
/** 全能图片 G-2.5 文生图（官方 flare 路径） */
export const RHART_IMAGE_G25_T2I_PATH = '/rhart-image-g-2.5/flare/text-to-image' as const;
/** 全能图片 G-2.5 图生图（官方 sunburst 路径） */
export const RHART_IMAGE_G25_I2I_PATH = '/rhart-image-g-2.5/sunburst/image-to-image' as const;

export const BANANA_20_T2I_PATH = '/rhart-image-n-g31-flash/text-to-image' as const;
export const BANANA_20_I2I_PATH = '/rhart-image-n-g31-flash/image-to-image' as const;

export const SEEDREAM_V5_T2I_PATH = '/seedream-v5-lite/text-to-image' as const;
export const SEEDREAM_V5_I2I_PATH = '/seedream-v5-lite/image-to-image' as const;

export const YOUCHUAN_V81_RUN_PATH = '/youchuan/text-to-image-v81' as const;
export const YOUCHUAN_V82_RUN_PATH = '/youchuan/text-to-image-v82' as const;

export type ImageQueueProviderForward = {
  provider: 'runninghub';
  path: string;
  method: 'POST';
  body: Record<string, unknown>;
  billingModelId?: string;
  rhRegion?: 'cn' | 'ai';
};

function isImageQueueBypass(input: Record<string, unknown>): boolean {
  if (input.directorSpawned === true || input.drama === true) return true;
  return false;
}

/** 画布图片节点参考图：支持 image (string|string[]) 与 images[] */
export function countNonEmptyImageRefs(input: Record<string, unknown>): number {
  const fromImage = input.image;
  if (Array.isArray(fromImage)) {
    return fromImage.filter((u) => String(u || '').trim()).length;
  }
  if (typeof fromImage === 'string' && fromImage.trim()) return 1;
  const images = Array.isArray(input.images) ? input.images : [];
  return images.filter((u) => String(u || '').trim()).length;
}

export function isCanvasZImageQueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '').trim() !== IMAGE_QUEUE_Z_IMAGE_MODEL) return false;
  if (countNonEmptyImageRefs(input) !== 0) return false;
  if (isImageQueueBypass(input)) return false;
  return true;
}

export function isCanvasLensQueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '').trim() !== IMAGE_QUEUE_LENS_MODEL) return false;
  if (countNonEmptyImageRefs(input) !== 0) return false;
  if (isImageQueueBypass(input)) return false;
  return true;
}

export function isCanvasFlux2KleinQueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '').trim() !== IMAGE_QUEUE_FLUX2_KLEIN_MODEL) return false;
  const n = countNonEmptyImageRefs(input);
  if (n < 1 || n > 3) return false;
  if (isImageQueueBypass(input)) return false;
  return true;
}

/** T2I（0 图）或 I2I（1–10 图） */
export function isCanvasRhartImageG2QueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '').trim() !== IMAGE_QUEUE_RHART_IMAGE_G2_MODEL) return false;
  const n = countNonEmptyImageRefs(input);
  if (n > 10) return false;
  if (isImageQueueBypass(input)) return false;
  return true;
}

/** 全能图片 G-2.5：T2I（0 图）或 I2I（1–10 图） */
export function isCanvasRhartImageG25QueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '').trim() !== IMAGE_QUEUE_RHART_IMAGE_G25_MODEL) return false;
  const n = countNonEmptyImageRefs(input);
  if (n > 10) return false;
  if (isImageQueueBypass(input)) return false;
  return true;
}

/** T2I（0 图）或 I2I（1–10 图） */
export function isCanvasBanana20QueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '').trim() !== IMAGE_QUEUE_BANANA_20_MODEL) return false;
  const n = countNonEmptyImageRefs(input);
  if (n > 10) return false;
  if (isImageQueueBypass(input)) return false;
  return true;
}

/** T2I（0 图）或 I2I（1–10 图） */
export function isCanvasSeedreamV5QueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '').trim() !== IMAGE_QUEUE_SEEDREAM_V5_MODEL) return false;
  const n = countNonEmptyImageRefs(input);
  if (n > 10) return false;
  if (isImageQueueBypass(input)) return false;
  return true;
}

/** T2I；可选 0–1 张 style 图（与 Direct 一致） */
export function isCanvasYouchuanV81QueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '').trim() !== IMAGE_QUEUE_YOUCHUAN_V81_MODEL) return false;
  const n = countNonEmptyImageRefs(input);
  if (n > 1) return false;
  if (isImageQueueBypass(input)) return false;
  return true;
}

/** T2I；可选 0–1 张垫图（官方 imageUrl，与 Direct 一致） */
export function isCanvasYouchuanV82QueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '').trim() !== IMAGE_QUEUE_YOUCHUAN_V82_MODEL) return false;
  const n = countNonEmptyImageRefs(input);
  if (n > 1) return false;
  if (isImageQueueBypass(input)) return false;
  return true;
}

export function assertImageQueueHttpsImageUrls(
  imageUrls: unknown,
  label: string,
  opts?: { min?: number; max?: number },
): string[] {
  const min = opts?.min ?? 0;
  const max = opts?.max ?? 10;
  if (!Array.isArray(imageUrls)) {
    throw new Error(`${label} imageUrls 必须为数组`);
  }
  const out: string[] = [];
  for (const raw of imageUrls) {
    const u = String(raw || '').trim();
    if (!u) continue;
    if (/^(openapi|api)\//i.test(u)) {
      throw new Error(`${label} imageUrls 须为 HTTPS OSS URL，不能是 RH Media fileName`);
    }
    if (!u.startsWith('https://')) {
      throw new Error(`${label} imageUrls 必须为 https:// 公网 URL（禁止本地/dataURL）`);
    }
    if (/^(file:|data:|blob:|local-resource:)/i.test(u)) {
      throw new Error(`${label} 禁止 local/file/data/blob 写入 Queue`);
    }
    out.push(u);
  }
  if (out.length < min || out.length > max) {
    throw new Error(`${label} 需要 ${min}–${max} 张公网图片，当前 ${out.length} 张`);
  }
  return out;
}

function pickZImageAspect(aspectRatio: string | undefined, fallback: string): string {
  const key = String(aspectRatio || '').trim();
  if ((Z_IMAGE_ASPECT_RATIOS as readonly string[]).includes(key)) return key;
  return fallback;
}

export function normalizeRunningHubImageResolution(resolution?: string): '1k' | '2k' | '4k' {
  const normalized = String(resolution || '').trim().toLowerCase();
  if (
    normalized === '4k' ||
    normalized.includes('1792') ||
    normalized.includes('2048') ||
    normalized.includes('2160')
  ) {
    return '4k';
  }
  if (normalized === '2k' || normalized.includes('1024') || normalized.includes('1280')) {
    return '2k';
  }
  return '1k';
}

const RHART_G2_ASPECTS = new Set([
  '1:1',
  '2:3',
  '3:2',
  '4:5',
  '5:4',
  '4:3',
  '3:4',
  '16:9',
  '9:16',
  '21:9',
  '9:21',
  '2:1',
  '1:2',
  '3:1',
  '1:3',
]);

const BANANA_ASPECTS = new Set([
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '5:4',
  '4:5',
  '21:9',
  '1:4',
  '4:1',
  '1:8',
  '8:1',
]);

const YOUCHUAN_ASPECTS = new Set(['1:1', '4:3', '3:2', '16:9', '3:4', '2:3', '9:16']);

/** z-image → ai-app（rhRegion=cn；billing z-image-720p|1080p） */
export function buildZImageRhForward(body: {
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  billingModelId?: string;
}): ImageQueueProviderForward {
  const promptText = String(body.prompt || '').trim();
  if (!promptText) throw new Error('Z-image 提示词不能为空');
  const tier = normalizeZImageResolutionTier(body.resolution);
  const aspectKey = pickZImageAspect(body.aspectRatio, '16:9');
  const { width, height } = zImageDimensionsForAspect(aspectKey, tier);
  const billingModelId = body.billingModelId || zImageBillingModelId(tier);
  return {
    provider: 'runninghub',
    path: Z_IMAGE_RUN_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '32', fieldName: 'text', fieldValue: promptText, description: 'text' },
        { nodeId: '37', fieldName: 'width', fieldValue: String(width), description: 'width' },
        { nodeId: '37', fieldName: 'height', fieldValue: String(height), description: 'height' },
      ],
      instanceType: 'default',
      usePersonalQueue: 'false',
      model: IMAGE_QUEUE_Z_IMAGE_MODEL,
      resolution: tier,
    },
    billingModelId,
    rhRegion: 'cn',
  };
}

/** lens → ai-app（rhRegion=cn；instanceType=plus；默认比例 9:16） */
export function buildLensRhForward(body: {
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  billingModelId?: string;
}): ImageQueueProviderForward {
  const promptText = String(body.prompt || '').trim();
  if (!promptText) throw new Error('Lens 提示词不能为空');
  const tier = normalizeZImageResolutionTier(body.resolution);
  const aspectKey = pickZImageAspect(body.aspectRatio, '9:16');
  const { width, height } = zImageDimensionsForAspect(aspectKey, tier);
  const billingModelId = body.billingModelId || lensBillingModelId(tier);
  return {
    provider: 'runninghub',
    path: LENS_RUN_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '3', fieldName: 'text', fieldValue: promptText, description: 'text' },
        { nodeId: '8', fieldName: 'width', fieldValue: String(width), description: 'width' },
        { nodeId: '8', fieldName: 'height', fieldValue: String(height), description: 'height' },
      ],
      instanceType: 'plus',
      usePersonalQueue: 'false',
      model: IMAGE_QUEUE_LENS_MODEL,
      resolution: tier,
    },
    billingModelId,
    rhRegion: 'cn',
  };
}

/** flux2-klein → ai-app I2I；缺图用最后一张补齐至 3 */
export function buildFlux2KleinRhForward(body: {
  prompt: string;
  imageUrls: string[];
  aspectRatio?: string;
  resolution?: string;
  billingModelId?: string;
}): ImageQueueProviderForward {
  const promptText = String(body.prompt || '').trim();
  if (!promptText) throw new Error('Flux2 Klein 提示词不能为空');
  const imageUrls = assertImageQueueHttpsImageUrls(body.imageUrls, 'flux2-klein', { min: 1, max: 3 });
  const img1 = imageUrls[0];
  const img2 = imageUrls.length >= 2 ? imageUrls[1] : img1;
  const img3 = imageUrls.length >= 3 ? imageUrls[2] : img2;
  const tier = normalizeZImageResolutionTier(body.resolution);
  const aspectKey = pickZImageAspect(body.aspectRatio, '16:9');
  const { width, height } = zImageDimensionsForAspect(aspectKey, tier);
  const billingModelId = body.billingModelId || flux2KleinBillingModelId(tier);
  return {
    provider: 'runninghub',
    path: FLUX2_KLEIN_RUN_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '355', fieldName: 'image', fieldValue: img1, description: 'image1' },
        { nodeId: '352', fieldName: 'image', fieldValue: img2, description: 'image2' },
        { nodeId: '357', fieldName: 'image', fieldValue: img3, description: 'image3' },
        { nodeId: '353', fieldName: 'text', fieldValue: promptText, description: 'text' },
        { nodeId: '368', fieldName: 'value', fieldValue: String(width), description: '宽' },
        { nodeId: '367', fieldName: 'value', fieldValue: String(height), description: '高' },
      ],
      instanceType: 'default',
      usePersonalQueue: 'false',
      model: IMAGE_QUEUE_FLUX2_KLEIN_MODEL,
      resolution: tier,
    },
    billingModelId,
    rhRegion: 'cn',
  };
}

/** rhart-image-g-2：有图走 I2I，无图走 T2I；rhRegion=ai */
export function buildRhartImageG2RhForward(body: {
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  imageUrls?: string[];
  billingModelId?: string;
}): ImageQueueProviderForward {
  const promptText = String(body.prompt || '').trim();
  if (!promptText) throw new Error('全能图片 G-2.0 提示词不能为空');
  const aspectRaw = String(body.aspectRatio || '').trim();
  const hasImages = Array.isArray(body.imageUrls) && body.imageUrls.some((u) => String(u || '').trim());
  const aspectRatio = RHART_G2_ASPECTS.has(aspectRaw)
    ? aspectRaw
    : hasImages
      ? '1:1'
      : '16:9';
  const resolution = normalizeRunningHubImageResolution(body.resolution);
  const billingModelId = body.billingModelId || IMAGE_QUEUE_RHART_IMAGE_G2_MODEL;
  if (hasImages) {
    const imageUrls = assertImageQueueHttpsImageUrls(body.imageUrls, 'rhart-image-g-2', {
      min: 1,
      max: 10,
    });
    return {
      provider: 'runninghub',
      path: RHART_IMAGE_G2_I2I_PATH,
      method: 'POST',
      body: {
        imageUrls,
        prompt: promptText,
        resolution,
        aspectRatio,
      },
      billingModelId,
      rhRegion: 'ai',
    };
  }
  return {
    provider: 'runninghub',
    path: RHART_IMAGE_G2_T2I_PATH,
    method: 'POST',
    body: {
      prompt: promptText,
      aspectRatio,
      resolution,
    },
    billingModelId,
    rhRegion: 'ai',
  };
}

/** rhart-image-g-2.5：有图走 sunburst I2I，无图走 flare T2I；rhRegion=ai */
export function buildRhartImageG25RhForward(body: {
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  imageUrls?: string[];
  billingModelId?: string;
}): ImageQueueProviderForward {
  const promptText = String(body.prompt || '').trim();
  if (!promptText || promptText.length > 20000) {
    throw new Error('全能图片 G-2.5 提示词长度为 1-20000 字');
  }
  const aspectRaw = String(body.aspectRatio || '').trim();
  const hasImages = Array.isArray(body.imageUrls) && body.imageUrls.some((u) => String(u || '').trim());
  const aspectRatio = RHART_G2_ASPECTS.has(aspectRaw)
    ? aspectRaw
    : hasImages
      ? '1:1'
      : '16:9';
  const resolution = normalizeRunningHubImageResolution(body.resolution);
  const billingModelId = body.billingModelId || IMAGE_QUEUE_RHART_IMAGE_G25_MODEL;
  if (hasImages) {
    const imageUrls = assertImageQueueHttpsImageUrls(body.imageUrls, 'rhart-image-g-2.5', {
      min: 1,
      max: 10,
    });
    return {
      provider: 'runninghub',
      path: RHART_IMAGE_G25_I2I_PATH,
      method: 'POST',
      body: {
        imageUrls,
        prompt: promptText,
        resolution,
        aspectRatio,
      },
      billingModelId,
      rhRegion: 'ai',
    };
  }
  return {
    provider: 'runninghub',
    path: RHART_IMAGE_G25_T2I_PATH,
    method: 'POST',
    body: {
      prompt: promptText,
      aspectRatio,
      resolution,
    },
    billingModelId,
    rhRegion: 'ai',
  };
}

/** banana-2.0：有图走 I2I，无图走 T2I；rhRegion=ai */
export function buildBanana20RhForward(body: {
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  imageUrls?: string[];
  billingModelId?: string;
}): ImageQueueProviderForward {
  const promptText = String(body.prompt || '').trim();
  if (!promptText) throw new Error('全能图片 V2 提示词不能为空');
  const aspectRaw = String(body.aspectRatio || '').trim();
  const aspectRatio = BANANA_ASPECTS.has(aspectRaw) ? aspectRaw : '1:1';
  const resolution = normalizeRunningHubImageResolution(body.resolution);
  const billingModelId = body.billingModelId || IMAGE_QUEUE_BANANA_20_MODEL;
  const hasImages = Array.isArray(body.imageUrls) && body.imageUrls.some((u) => String(u || '').trim());
  if (hasImages) {
    const imageUrls = assertImageQueueHttpsImageUrls(body.imageUrls, 'banana-2.0', {
      min: 1,
      max: 10,
    });
    return {
      provider: 'runninghub',
      path: BANANA_20_I2I_PATH,
      method: 'POST',
      body: {
        imageUrls,
        prompt: promptText,
        resolution,
        aspectRatio,
      },
      billingModelId,
      rhRegion: 'ai',
    };
  }
  return {
    provider: 'runninghub',
    path: BANANA_20_T2I_PATH,
    method: 'POST',
    body: {
      prompt: promptText,
      resolution,
      aspectRatio,
    },
    billingModelId,
    rhRegion: 'ai',
  };
}

/** seedream-v5：resolution 2k|3k 优先，否则 width/height；rhRegion=cn */
export function buildSeedreamV5RhForward(body: {
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  width?: number;
  height?: number;
  imageUrls?: string[];
  billingModelId?: string;
}): ImageQueueProviderForward {
  const promptText = String(body.prompt || '').trim();
  if (promptText.length < 5 || promptText.length > 2000) {
    throw new Error('seedream-v5 提示词长度为 5-2000 字');
  }
  const resRaw = String(body.resolution || '').trim().toLowerCase();
  const seedreamResolution = resRaw === '2k' || resRaw === '3k' ? resRaw : undefined;
  const hasImages = Array.isArray(body.imageUrls) && body.imageUrls.some((u) => String(u || '').trim());
  const billingModelId = body.billingModelId || IMAGE_QUEUE_SEEDREAM_V5_MODEL;
  const path = hasImages ? SEEDREAM_V5_I2I_PATH : SEEDREAM_V5_T2I_PATH;
  const base: Record<string, unknown> = {
    prompt: promptText,
    sequentialImageGeneration: 'disabled',
    maxImages: 1,
  };
  if (hasImages) {
    base.imageUrls = assertImageQueueHttpsImageUrls(body.imageUrls, 'seedream-v5', {
      min: 1,
      max: 10,
    });
  }
  if (seedreamResolution) {
    base.resolution = seedreamResolution;
  } else {
    const w = Number(body.width);
    const h = Number(body.height);
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) {
      throw new Error('seedream-v5 需要 resolution(2k|3k) 或有效 width/height');
    }
    base.width = Math.max(1600, Math.min(4704, Math.round(w)));
    base.height = Math.max(1344, Math.min(4096, Math.round(h)));
  }
  return {
    provider: 'runninghub',
    path,
    method: 'POST',
    body: base,
    billingModelId,
    rhRegion: 'cn',
  };
}

/** youchuan-text-to-image-v81；rhRegion=ai；计费 resolution=hd|1k */
export function buildYouchuanV81RhForward(body: {
  prompt: string;
  aspectRatio?: string;
  hd?: boolean;
  quality?: string;
  chaos?: number;
  stylize?: number;
  raw?: boolean;
  imageUrl?: string | null;
  iw?: number;
  billingModelId?: string;
}): ImageQueueProviderForward {
  const promptText = String(body.prompt || '').trim();
  if (!promptText || promptText.length > 8192) {
    throw new Error('悠船 v8.1 提示词长度为 1-8192 字');
  }
  const aspectRaw = String(body.aspectRatio || '').trim();
  const aspectRatio = YOUCHUAN_ASPECTS.has(aspectRaw) ? aspectRaw : '1:1';
  const qualityRaw = String(body.quality || '1').trim();
  const quality = qualityRaw === '4' ? '4' : '1';
  const hd = body.hd === true;
  const billingModelId = body.billingModelId || IMAGE_QUEUE_YOUCHUAN_V81_MODEL;
  const reqBody: Record<string, unknown> = {
    prompt: promptText,
    chaos: Math.max(0, Math.min(100, Number(body.chaos) || 0)),
    quality,
    stylize: Math.max(0, Math.min(1000, Number(body.stylize) || 0)),
    raw: !!body.raw,
    imageUrl: null,
    iw: 1,
    sref: null,
    sw: 100,
    sv: 6,
    aspectRatio,
    hd,
  };
  const styleUrl = body.imageUrl != null ? String(body.imageUrl).trim() : '';
  if (styleUrl) {
    const [httpsUrl] = assertImageQueueHttpsImageUrls([styleUrl], 'youchuan-text-to-image-v81', {
      min: 1,
      max: 1,
    });
    reqBody.imageUrl = httpsUrl;
    reqBody.iw = Math.max(0, Math.min(3, Number(body.iw) || 1));
  }
  return {
    provider: 'runninghub',
    path: YOUCHUAN_V81_RUN_PATH,
    method: 'POST',
    body: reqBody,
    billingModelId,
    rhRegion: 'ai',
  };
}

/** 悠船计费用 resolution：hd → hd，否则 1k */
export function youchuanV81BillingResolution(input: {
  hd?: boolean;
  resolution?: string;
}): string {
  const resRaw = String(input.resolution || '').trim().toLowerCase();
  const hd =
    input.hd === true || resRaw === 'hd' || resRaw === '2k' || resRaw === 'true';
  return hd ? 'hd' : '1k';
}

/** youchuan-text-to-image-v82；rhRegion=ai；计费 resolution=hd|1k；hd 为官方必填 */
export function buildYouchuanV82RhForward(body: {
  prompt: string;
  aspectRatio?: string;
  hd?: boolean;
  quality?: string;
  chaos?: number;
  stylize?: number;
  raw?: boolean;
  imageUrl?: string | null;
  iw?: number;
  billingModelId?: string;
}): ImageQueueProviderForward {
  const promptText = String(body.prompt || '').trim();
  if (!promptText || promptText.length > 8192) {
    throw new Error('悠船 v8.2 提示词长度为 1-8192 字');
  }
  const aspectRaw = String(body.aspectRatio || '').trim();
  const aspectRatio = YOUCHUAN_ASPECTS.has(aspectRaw) ? aspectRaw : '1:1';
  const qualityRaw = String(body.quality || '1').trim();
  const quality = qualityRaw === '4' ? '4' : '1';
  const hd = body.hd === true;
  const billingModelId = body.billingModelId || IMAGE_QUEUE_YOUCHUAN_V82_MODEL;
  const reqBody: Record<string, unknown> = {
    prompt: promptText,
    chaos: Math.max(0, Math.min(100, Number(body.chaos) || 0)),
    quality,
    stylize: Math.max(0, Math.min(1000, Number(body.stylize) || 0)),
    raw: !!body.raw,
    imageUrl: null,
    iw: 1,
    sref: null,
    sw: 100,
    sv: 6,
    aspectRatio,
    hd,
  };
  const styleUrl = body.imageUrl != null ? String(body.imageUrl).trim() : '';
  if (styleUrl) {
    const [httpsUrl] = assertImageQueueHttpsImageUrls([styleUrl], 'youchuan-text-to-image-v82', {
      min: 1,
      max: 1,
    });
    reqBody.imageUrl = httpsUrl;
    reqBody.iw = Math.max(0, Math.min(3, Number(body.iw) || 1));
  }
  return {
    provider: 'runninghub',
    path: YOUCHUAN_V82_RUN_PATH,
    method: 'POST',
    body: reqBody,
    billingModelId,
    rhRegion: 'ai',
  };
}

/** 悠船 v8.2 计费 resolution（与 v8.1 同档：hd|1k） */
export function youchuanV82BillingResolution(input: {
  hd?: boolean;
  resolution?: string;
}): string {
  return youchuanV81BillingResolution(input);
}
