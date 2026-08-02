/**
 * 定价计算器：组合 cost_table + markup_table + price_tiers
 * 逻辑与 src/renderer/utils/priceCalc.ts 对齐；云端元宝与 FC 默认对齐。
 */

import {
  FC_CLOUD_YUANBAO_DEFAULTS,
  IMAGE_MODEL_CNY,
  REVERSE_CAPTION_CNY,
  AUDIO_MODEL_CNY,
  mergeVideoPriceDefaults,
  normalizeGrok3DurationSec,
  normalizeRhartVideoXDurationSec,
  normalizeGrok3StableDurationSec,
  normalizeGeminiOmniDurationSec,
  normalizeGeminiOmniFlashDurationSec,
  tryComputeRawVideoCny,
  VIDEO_BILLING_SKU_CNY,
} from './cost_table.mjs';
import { buildVideoBillingSkuKey } from './videoBillingSku.mjs';
import {
  buildVideoBillingModelIdCore,
  getVideoBillingQuantity,
  getVideoQuantityForCloudKey,
  inferUiSecondsFromBillingSkuOnly,
} from './videoBillingCloud.mjs';
import { applyMarkup } from './markup_table.mjs';
import { resolveCloudYuanbaoFromEnv } from './price_tiers.mjs';
import { resolveModelYuanbao } from './model_yuanbao_rates.mjs';

/** 模型在 pricing 表中无定价或参数无法匹配到档位时抛出 */
export class ModelNotPricedError extends Error {
  /**
   * @param {string} modelId
   * @param {'image'|'video'|'audio'|'reverse'} category
   * @param {string} [detail]
   */
  constructor(modelId, category, detail) {
    super(detail || `Model not priced: ${category}:${modelId}`);
    this.name = 'ModelNotPricedError';
    this.modelId = modelId;
    this.category = category;
  }
}

export function isModelNotPricedError(e) {
  return e instanceof ModelNotPricedError || (typeof e === 'object' && e !== null && e.name === 'ModelNotPricedError');
}

/** @param {string} [resolution] */
function normRes(resolution) {
  return String(resolution || '')
    .trim()
    .toLowerCase();
}

/**
 * 图片展示价（CNY/张）
 * @param {{ model: string; resolution?: string }} params
 * @param {{ applyMarkup?: boolean }} [opts]
 * @returns {number}
 */
export function getImagePrice(params, opts = {}) {
  const model = resolveImageBillingModelId(params.model);
  const { resolution } = params;
  const apply = opts.applyMarkup !== false;

  let base = null;
  if (model === 'banana-2.0') {
    const r = normRes(resolution);
    const t = IMAGE_MODEL_CNY['banana-2.0'];
    if (r === '2k' || r === '4k') base = t['2k'];
    else base = t.default;
  } else if (model === 'rhart-image-g-2') {
    const r = normRes(resolution);
    const t = IMAGE_MODEL_CNY['rhart-image-g-2'];
    if (r === '2k' || r === '4k') base = t['2k'];
    else base = t.default;
  } else if (model === 'rhart-image-g') {
    base = IMAGE_MODEL_CNY['rhart-image-g'];
  } else if (model === 'nano-banana') {
    const r = normRes(resolution);
    const t = IMAGE_MODEL_CNY['nano-banana'];
    if (r === '4k') base = t['4k'];
    else base = t.default;
  } else if (model === 'nano-banana-2') base = IMAGE_MODEL_CNY['nano-banana-2'];
  else if (model === 'nano-banana-2-2k') base = IMAGE_MODEL_CNY['nano-banana-2-2k'];
  else if (model === 'nano-banana-2-4k') base = IMAGE_MODEL_CNY['nano-banana-2-4k'];
  else if (model === 'mj-v7') base = IMAGE_MODEL_CNY['mj-v7'];
  else if (model === 'gpt-image-2') base = IMAGE_MODEL_CNY['gpt-image-2'];
  else if (model === 'youchuan-text-to-image-v7') base = IMAGE_MODEL_CNY['youchuan-text-to-image-v7'];
  else if (model === 'youchuan-text-to-image-v81') {
    const t = IMAGE_MODEL_CNY['youchuan-text-to-image-v81'];
    const r = normRes(resolution);
    if (r === 'hd' || r === '2k') base = t.hd ?? t.default;
    else base = t.default;
  }   else if (model === 'seedream-v4.5') base = IMAGE_MODEL_CNY['seedream-v4.5'];
  else if (model === 'seedream-v5') {
    const r = normRes(resolution);
    const t = IMAGE_MODEL_CNY['seedream-v5'];
    if (t && typeof t === 'object') {
      if (r === '3k') base = t['3k'] ?? t.default;
      else if (r === '2k') base = t['2k'] ?? t.default;
      else base = t.default;
    } else {
      base = t;
    }
  } else if (model === 'z-image') {
    const r = normRes(resolution);
    const t = IMAGE_MODEL_CNY['z-image'];
    if (r === '720p') base = t['720p'];
    else if (r === '1080p') base = t['1080p'] ?? t.default;
    else base = t.default;
  } else if (model === 'z-image-720p') base = IMAGE_MODEL_CNY['z-image']['720p'];
  else if (model === 'z-image-1080p') base = IMAGE_MODEL_CNY['z-image']['1080p'] ?? IMAGE_MODEL_CNY['z-image'].default;
  else if (model === 'lens') {
    const r = normRes(resolution);
    const t = IMAGE_MODEL_CNY['lens'];
    if (r === '720p') base = t['720p'];
    else if (r === '1080p') base = t['1080p'] ?? t.default;
    else base = t.default;
  } else if (model === 'lens-720p') base = IMAGE_MODEL_CNY['lens']['720p'];
  else if (model === 'lens-1080p') base = IMAGE_MODEL_CNY['lens']['1080p'] ?? IMAGE_MODEL_CNY['lens'].default;
  else if (model === 'flux2-klein') {
    const r = normRes(resolution);
    const t = IMAGE_MODEL_CNY['flux2-klein'];
    if (r === '720p') base = t['720p'];
    else if (r === '1080p') base = t['1080p'] ?? t.default;
    else base = t.default;
  } else if (model === 'flux2-klein-720p') base = IMAGE_MODEL_CNY['flux2-klein']['720p'];
  else if (model === 'flux2-klein-1080p') base = IMAGE_MODEL_CNY['flux2-klein']['1080p'] ?? IMAGE_MODEL_CNY['flux2-klein'].default;
  else {
    const scalar = IMAGE_MODEL_CNY[model];
    if (typeof scalar === 'number' && Number.isFinite(scalar)) base = scalar;
  }

  if (base == null) throw new ModelNotPricedError(model, 'image');
  return apply ? applyMarkup(base, 'image', model) : base;
}

/**
 * @typedef {object} VideoPriceParams
 * @property {string} model
 * @property {'5'|'10'|'15'|'25'} [duration]
 * @property {'true'|'false'} [sound]
 * @property {'6'|'10'} [durationHailuo02]
 * @property {'5'|'10'} [durationKlingO1]
 * @property {'std'|'pro'} [modeKlingO1]
 * @property {'720p'|'1080p'|'4k'} [resolutionRhartV31]
 * @property {'720p'|'1080p'} [resolutionWan26]
 * @property {string} [durationWan26Flash]
 * @property {boolean} [enableAudio]
 * @property {'4'|'6'|'8'} [durationVeo31ProOfficial]
 * @property {boolean} [generateAudioVeo31ProOfficial]
 * @property {'480p'|'720p'} [resolutionWanAnimate]
 * @property {'5'|'8'|'10'|'15'} [wanAnimateClipSec]
 */

/**
 * @param {VideoPriceParams} params
 * @param {{ applyMarkup?: boolean }} [opts]
 * @returns {number}
 */
export function getVideoPrice(params, opts = {}) {
  const apply = opts.applyMarkup !== false;
  const modelNorm = normalizeVideoBillingModelId(params.model);
  const merged = mergeVideoPriceDefaults(modelNorm, { ...params, model: modelNorm });
  const { model, ...input } = merged;
  const sku = buildVideoBillingSkuKey(model, input);
  let base =
    sku && Object.prototype.hasOwnProperty.call(VIDEO_BILLING_SKU_CNY, sku)
      ? VIDEO_BILLING_SKU_CNY[sku]
      : undefined;
  if (base === undefined) base = tryComputeRawVideoCny(merged);
  if (base == null) throw new ModelNotPricedError(model, 'video');
  return apply ? applyMarkup(base, 'video', model) : base;
}

/**
 * @param {'gpt-4o'|'joy-caption-two'|'openai/gpt-5.6-terra'|'gpt-4o-image-reverse'|'joy-caption-two-image-reverse'|'openai/gpt-5.6-terra-image-reverse'} model
 * @param {{ applyMarkup?: boolean }} [opts]
 */
export function getImageReversePrice(model, opts = {}) {
  const apply = opts.applyMarkup !== false;
  const raw = REVERSE_CAPTION_CNY[model];
  if (raw == null) throw new ModelNotPricedError(String(model), 'reverse');
  return apply ? applyMarkup(raw, 'reverse', model) : raw;
}

/**
 * @param {string} model
 * @param {{ applyMarkup?: boolean }} [opts]
 */
export function getAudioPrice(model, opts = {}) {
  const apply = opts.applyMarkup !== false;
  const m = normalizeVideoBillingModelId(model);
  if (!m) throw new ModelNotPricedError('', 'audio', 'empty model');
  const raw = AUDIO_MODEL_CNY[m];
  if (raw == null) throw new ModelNotPricedError(m, 'audio');
  return apply ? applyMarkup(raw, 'audio', m) : raw;
}

/**
 * @param {string} nodeType
 * @param {Record<string, unknown> | undefined} data
 * @param {{ applyMarkup?: boolean }} [opts]
 */
export function getNodePrice(nodeType, data, opts = {}) {
  if (!data) return null;
  if (nodeType === 'llm') {
    const reverseModel = data.reverseCaptionModel;
    if (
      reverseModel === 'gpt-4o' ||
      reverseModel === 'joy-caption-two' ||
      reverseModel === 'openai/gpt-5.6-terra' ||
      reverseModel === 'gpt-4o-image-reverse' ||
      reverseModel === 'joy-caption-two-image-reverse' ||
      reverseModel === 'openai/gpt-5.6-terra-image-reverse'
    ) {
      try {
        return getImageReversePrice(reverseModel, opts);
      } catch (e) {
        if (isModelNotPricedError(e)) return null;
        throw e;
      }
    }
    return null;
  }
  try {
    if (nodeType === 'image') {
      return getImagePrice(
        {
          model: /** @type {string} */ (data.model || 'banana-2.0'),
          resolution: /** @type {string|undefined} */ (data.resolution),
        },
        opts,
      );
    }
    if (nodeType === 'video') {
      return getVideoPrice(
        {
          model: /** @type {string} */ (data.model || 'sora-2'),
          duration: /** @type {'5'|'10'|'15'|'25'|undefined} */ (data.duration),
          sound: /** @type {'true'|'false'|undefined} */ (data.sound),
          durationHailuo02: /** @type {'6'|'10'|undefined} */ (data.durationHailuo02),
          resolutionHailuo: /** @type {'720p'|'1080p'|'4k'|undefined} */ (data.resolutionHailuo),
          durationKlingO1: /** @type {'5'|'10'|undefined} */ (data.durationKlingO1),
          modeKlingO1: /** @type {'std'|'pro'|undefined} */ (data.modeKlingO1),
          resolutionRhartV31: /** @type {'720p'|'1080p'|'4k'|undefined} */ (data.resolutionRhartV31),
          resolutionWan26: /** @type {'720p'|'1080p'|undefined} */ (data.resolutionWan26),
          durationWan26Flash: data.durationWan26Flash != null ? String(data.durationWan26Flash) : undefined,
          enableAudio: /** @type {boolean|undefined} */ (data.enableAudio),
          durationVeo31ProOfficial: /** @type {'4'|'6'|'8'|undefined} */ (data.durationVeo31ProOfficial),
          generateAudioVeo31ProOfficial: /** @type {boolean|undefined} */ (data.generateAudioVeo31ProOfficial),
          resolutionLtx23Lipsync: data.resolutionLtx23Lipsync != null ? String(data.resolutionLtx23Lipsync) : undefined,
          resolutionLtx23I2v: data.resolutionLtx23I2v != null ? String(data.resolutionLtx23I2v) : undefined,
          resolutionLtx23T2v: data.resolutionLtx23T2v != null ? String(data.resolutionLtx23T2v) : undefined,
          durationLtx23I2v: data.durationLtx23I2v != null ? String(data.durationLtx23I2v) : undefined,
          durationLtx23T2v: data.durationLtx23T2v != null ? String(data.durationLtx23T2v) : undefined,
          resolutionWanAnimate:
            data.resolutionWanAnimate != null ? String(data.resolutionWanAnimate) : undefined,
          wanAnimateClipSec: data.wanAnimateClipSec != null ? String(data.wanAnimateClipSec) : undefined,
        },
        opts,
      );
    }
    if (nodeType === 'audio') {
      return getAudioPrice(String(data.model || ''), opts);
    }
  } catch (e) {
    if (isModelNotPricedError(e)) return null;
    throw e;
  }
  return null;
}

/**
 * 云端单次任务扣费（元宝），不含 markup（元宝为整数）
 * @param {'llm'|'image'|'video'|'audio'} taskType
 * @param {Record<string, string | undefined>} [env]
 */
export function getCloudDeductYuanbao(taskType, env) {
  const resolved = resolveCloudYuanbaoFromEnv(env);
  return resolved[taskType] ?? FC_CLOUD_YUANBAO_DEFAULTS[taskType];
}

/**
 * 任务扣费：零售价(CNY) → 元宝（与 nx_model_config 的 yuanbao_rate、客户端 cloudModelPricing 一致）。
 * 仅读 NX_BILLING_YUANBAO_PER_CNY；默认 10（1 元 = 10 元宝）。充值入账 NX_YUANBAO_PER_CNY 默认同值。
 * @param {number} cny
 * @param {Record<string, string | undefined>} [env]
 */
export function cnyRetailToYuanbaoInt(cny, env) {
  const e = env ?? (typeof process !== 'undefined' && process.env ? process.env : {});
  const raw = e.NX_BILLING_YUANBAO_PER_CNY;
  const per = raw != null && String(raw).trim() !== '' ? parseFloat(String(raw)) : 10;
  const rate = Number.isFinite(per) && per > 0 ? per : 10;
  const n = Number(cny);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(1, Math.round(n * rate));
}

/**
 * 图片零售价乘数（与 src/renderer/utils/cloudModelPricing IMAGE_OTS_MULTIPLIER_FALLBACK、OTS 运营倍率一致）
 * @type {Record<string, number>}
 */
export const IMAGE_BILLING_MULTIPLIER_BY_MODEL = {
  'banana-2.0': 4,
  'rhart-image-g-2': 4,
  'rhart-image-g': 1,
  'nano-banana': 1,
  'nano-banana-2': 1,
  'nano-banana-2-2k': 1,
  'nano-banana-2-4k': 1,
  'mj-v7': 1,
  'gpt-image-2': 1,
  'youchuan-text-to-image-v7': 1,
  'youchuan-text-to-image-v81': 1,
  'seedream-v4.5': 1,
  'seedream-v5': 1,
  'z-image': 1,
  'z-image-720p': 1,
  'z-image-1080p': 1,
  'lens': 1,
  'lens-720p': 1,
  'lens-1080p': 1,
  'flux2-klein': 1,
  'flux2-klein-720p': 1,
  'flux2-klein-1080p': 1,
  '2021955919764000770': 1,
  '2022127885233950721': 1,
  '2082378062234214401': 1,
  '1990056102572290049': 1,
};

/**
 * Tablestore nx_model_config 运营公式（与客户端展示一致）：
 * Cost(元宝) = base_price × multiplier × yuanbao_rate × quantity
 * @returns {number|null} 非法参数时 null
 */
export function yuanbaoCostFromTableDimensions(basePrice, multiplier, yuanbaoRate, quantity) {
  const bp = Number(basePrice);
  const mul = Number(multiplier);
  const yr = Number(yuanbaoRate);
  const q = Number(quantity);
  if (![bp, mul, yr, q].every(Number.isFinite) || bp < 0 || mul < 0 || yr <= 0 || q <= 0) return null;
  const v = bp * mul * yr * q;
  if (!Number.isFinite(v)) return null;
  return Math.max(1, Math.round(v));
}

/** @param {number} cny @param {Record<string, string | undefined>} [env] */
function cnyToYuanbaoInt(cny, env) {
  return cnyRetailToYuanbaoInt(cny, env);
}

/**
 * @param {unknown} v
 */
function mapImageSizeHint(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === '4k' || s.includes('4k')) return '4k';
  if (s === '2k' || s.includes('2k')) return '2k';
  return undefined;
}

/**
 * 与客户端/OTS 主键对齐：去 BOM、统一连字符与全角点号、小写。
 * 避免不可见字符或「Banana‑2.0」类 Unicode 连字符导致 cost 表匹配失败。
 * @param {unknown} raw
 */
export function normalizeImageBillingModelId(raw) {
  return String(raw ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\uFE63\uFF0D\u2212]/g, '-')
    .replace(/\uFF0E/g, '.')
    .toLowerCase();
}

/**
 * 视频 / 音频计费用的 model_id 字符归一（与图片一致：BOM、Unicode 连字符、全角点号、小写）。
 * 不含 RunningHub 图片路径 slug 映射；图片请用 resolveImageBillingModelId。
 */
export const normalizeVideoBillingModelId = normalizeImageBillingModelId;

/** RunningHub OpenAPI 路径首段（或易混 slug）→ 与 cost_table / 客户端 billingModelId 一致 */
const RH_IMAGE_SLUG_TO_BILLING_MODEL = {
  'rhart-image-n-g31-flash': 'banana-2.0',
  'rhart-image-g-2': 'rhart-image-g-2',
  'rhart-image-g-2-official': 'rhart-image-g-2',
  'rhart-image-g': 'rhart-image-g',
  /** 路径首段与计费 id 相同，显式列出便于归一后命中、并与文档对齐 */
  'seedream-v4.5': 'seedream-v4.5',
  /** OpenAPI 路径为 seedream-v5-lite/*，定价表为 seedream-v5 */
  'seedream-v5-lite': 'seedream-v5',
  /** 路径首段仅为 youchuan 时默认 v7；v8.1 用完整 path 段 */
  youchuan: 'youchuan-text-to-image-v7',
  'text-to-image-v81': 'youchuan-text-to-image-v81',
  'youchuan-text-to-image-v81': 'youchuan-text-to-image-v81',
  /** RunningHub AI App：MJ V7 */
  'mj-v7': 'mj-v7',
  'gpt-image-2': 'gpt-image-2',
  /** Z-image AI App：无 billingModelId 时默认按 1080p 档（与客户端默认一致） */
  '2059599553522921474': 'z-image-1080p',
  'z-image-720p': 'z-image-720p',
  'z-image-1080p': 'z-image-1080p',
  /** Lens AI App：无 billingModelId 时默认按 1080p 档 */
  '2063798801864945666': 'lens-1080p',
  'lens-720p': 'lens-720p',
  'lens-1080p': 'lens-1080p',
  '2059939823342936066': 'flux2-klein-1080p',
  'flux2-klein-720p': 'flux2-klein-720p',
  'flux2-klein-1080p': 'flux2-klein-1080p',
  '2059618241806430209': '2059618241806430209',
  'image-to-3d': 'image-to-3d',
  '2072903678922674177': '2072903678922674177',
  trellis2: 'trellis2',
  'image-to-3d-trellis2': 'image-to-3d-trellis2',
};

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function resolveImageBillingModelId(raw) {
  const n = normalizeImageBillingModelId(raw);
  return RH_IMAGE_SLUG_TO_BILLING_MODEL[n] || n;
}

/**
 * 脱水复合 Key 前缀 → 节点内 canonical model_id（与 src/main/utils/videoBillingSku.ts 对仗）
 */
const VIDEO_BILLING_DEHYDRATED_TO_CANONICAL = {
  'kling-v2-6-pro': 'kling-v2.6-pro',
  'kling-o1-start-end': 'kling-video-o1-start-end',
  'kling-o1-i2v': 'kling-video-o1-i2v',
  'kling-o1-ref': 'kling-video-o1-ref',
  'kling-o1': 'kling-video-o1',
  'hailuo-02-i2v': 'hailuo-02-i2v-standard',
  'hailuo-2-3-i2v': 'hailuo-2.3-i2v-standard',
  'hailuo-02': 'hailuo-02-t2v-standard',
  'hailuo-2-3': 'hailuo-2.3-t2v-standard',
  'wan-2-6-flash': 'wan-2.6-flash',
  'wan-2-6': 'wan-2.6',
  'ltx-2-3-lipsync': 'ltx-2.3-lipsync',
  'ltx-2-3-i2v': 'ltx-2.3-i2v',
  'ltx-2-3': 'ltx-2.3-t2v',
  'ltx-2-3-hdr-multi': 'ltx-2.3-hdr-multi',
  'ltx-2-3-msr-av': 'ltx-2.3-msr-av',
  'grok-3': 'grok-3',
  'rhart-video-x': 'rhart-video-x',
  'grok-3-stable': 'grok-3-stable',
  grok: 'grok-3',
  'gemini-omni-flash': 'gemini-omni-flash',
  'gemini-omni': 'gemini-omni',
};

const VIDEO_BILLING_DEHYDRATED_PREFIXES = Object.keys(VIDEO_BILLING_DEHYDRATED_TO_CANONICAL).sort(
  (a, b) => b.length - a.length,
);

/**
 * V2.3：veo-3-1-{720p|1080p|4k}-{fast|pro|fast-se|pro-se|official-i2v…}
 * @returns {{ baseModel: string, mid: string, durationSec: number, audioSuffix: string } | null}
 */
function tryParseVeo31Sku(s, durationSec, audioSuffix) {
  const p = 'veo-3-1-';
  if (!s.startsWith(p)) return null;
  const rest0 = s.slice(p.length);
  if (!rest0) return null;

  const RES = ['720p', '1080p', '4k'];
  /** @type {Record<string, string>} */
  const VARIANT = {
    fast: 'rhart-v3.1-fast',
    'fast-se': 'rhart-v3.1-fast-se',
    pro: 'rhart-v3.1-pro',
    'pro-se': 'rhart-v3.1-pro-se',
  };

  if (rest0.startsWith('official-i2v')) {
    return {
      baseModel: 'rhart-v3.1-pro-official-i2v',
      mid: '1080p',
      durationSec,
      audioSuffix,
    };
  }

  for (const r of RES) {
    if (!rest0.startsWith(`${r}-`)) continue;
    const tail = rest0.slice(r.length + 1);
    if (tail.startsWith('official-i2v')) {
      return {
        baseModel: 'rhart-v3.1-pro-official-i2v',
        mid: r,
        durationSec,
        audioSuffix,
      };
    }
    if (VARIANT[tail]) {
      return { baseModel: VARIANT[tail], mid: r, durationSec, audioSuffix };
    }
  }

  if (VARIANT[rest0]) {
    return { baseModel: VARIANT[rest0], mid: '1080p', durationSec, audioSuffix };
  }

  return null;
}

/**
 * @param {string} billingId
 * @returns {{ baseModel: string, mid: string, durationSec: number, audioSuffix: string } | null}
 */
function tryParseVideoBillingSku(billingId) {
  let s = String(billingId || '').trim().toLowerCase();
  if (!s) return null;

  if (/^(gpt-4o-image-reverse|joy-caption-two-image-reverse|openai\/gpt-5\.6-terra-image-reverse)$/.test(s)) {
    return null;
  }

  let audioSuffix = '';
  const am = s.match(/-(audio|noaudio)$/i);
  if (am) {
    const x = am[1].toLowerCase();
    if (x === 'audio') audioSuffix = 'audio';
    else if (x === 'noaudio') audioSuffix = 'noaudio';
    s = s.slice(0, -am[0].length);
  }

  let durationSec = 0;
  const dm = s.match(/-(\d+)s$/i);
  if (dm) {
    durationSec = parseInt(dm[1], 10);
    if (!Number.isFinite(durationSec) || durationSec < 0) return null;
    s = s.slice(0, -dm[0].length);
  }

  const veo31 = tryParseVeo31Sku(s, durationSec, audioSuffix);
  if (veo31) return veo31;

  for (const prefix of VIDEO_BILLING_DEHYDRATED_PREFIXES) {
    const canonical = VIDEO_BILLING_DEHYDRATED_TO_CANONICAL[prefix];
    if (s === prefix) {
      return { baseModel: canonical, mid: '', durationSec, audioSuffix };
    }
    if (s.startsWith(`${prefix}-`)) {
      const rest = s.slice(prefix.length + 1);
      return { baseModel: canonical, mid: rest, durationSec, audioSuffix };
    }
  }

  return null;
}

/**
 * 将 SKU 解码为 nodeData 覆盖（再交给既有 getVideoPrice 字段映射）
 * @param {{ baseModel: string, mid: string, durationSec: number, audioSuffix?: string }} parsed
 * @param {Record<string, unknown>} nodeData
 */
function applyVideoSkuToNodeData(parsed, nodeData) {
  const out = { ...nodeData };
  const { baseModel, mid, durationSec, audioSuffix = '' } = parsed;

  if (/^hailuo-/.test(baseModel)) {
    out.durationHailuo02 = durationSec >= 10 ? '10' : '6';
    if (mid && mid !== 'na' && (mid === '720p' || mid === '1080p' || mid === '4k')) {
      out.resolutionHailuo = mid;
    }
  } else if (baseModel === 'wan-2.6') {
    if (mid === '720p' || mid === '1080p') out.resolutionWan26 = mid;
    else out.resolutionWan26 = '1080p';
    if (durationSec >= 15) out.duration = '15';
    else if (durationSec >= 10) out.duration = '10';
    else if (durationSec > 0) out.duration = '5';
    else out.duration = '10';
  } else if (baseModel === 'wan-2.6-flash') {
    if (mid === '720p' || mid === '1080p') out.resolutionWan26 = mid;
    else out.resolutionWan26 = '1080p';
    if (durationSec > 0) out.durationWan26Flash = String(Math.max(2, Math.min(15, durationSec)));
    else out.durationWan26Flash = '5';
    out.enableAudio = audioSuffix !== 'noaudio';
  } else if (baseModel === 'kling-v2.6-pro') {
    out.sound = audioSuffix === 'audio' ? 'true' : 'false';
    if (durationSec > 0) out.duration = durationSec <= 5 ? '5' : '10';
    else out.duration = '10';
  } else if (baseModel === 'rhart-video-x') {
    out.model = 'rhart-video-x';
    out.resolutionGrok3 = '720p';
    if (durationSec > 0) out.durationGrok3 = String(normalizeRhartVideoXDurationSec(durationSec, 10));
    else out.durationGrok3 = '10';
  } else if (baseModel === 'grok-3') {
    out.resolutionGrok3 = '720p';
    if (durationSec > 0) out.durationGrok3 = String(normalizeGrok3DurationSec(durationSec, 10));
    else out.durationGrok3 = '10';
  } else if (baseModel === 'grok-3-stable') {
    out.model = 'grok-3-stable';
    out.resolutionGrok3 = '720p';
    if (durationSec > 0) out.durationGrok3 = String(normalizeGrok3StableDurationSec(durationSec, 10));
    else out.durationGrok3 = '10';
  } else if (
    baseModel === 'rhart-v3.1-fast' ||
    baseModel === 'rhart-v3.1-fast-se' ||
    baseModel === 'rhart-v3.1-pro' ||
    baseModel === 'rhart-v3.1-pro-se'
  ) {
    if (mid === '720p' || mid === '1080p' || mid === '4k') out.resolutionRhartV31 = mid;
    else out.resolutionRhartV31 = '1080p';
  } else if (
    baseModel === 'kling-video-o1' ||
    baseModel === 'kling-video-o1-i2v' ||
    baseModel === 'kling-video-o1-start-end' ||
    baseModel === 'kling-video-o1-ref'
  ) {
    out.modeKlingO1 = mid === 'pro' ? 'pro' : 'std';
    if (durationSec > 0) out.durationKlingO1 = durationSec <= 5 ? '5' : '10';
    else out.durationKlingO1 = '5';
  } else if (baseModel === 'rhart-v3.1-pro-official-i2v') {
    if (mid === '720p' || mid === '1080p' || mid === '4k') out.resolutionRhartV31 = mid;
    else out.resolutionRhartV31 = '1080p';
    out.generateAudioVeo31ProOfficial = audioSuffix === 'audio';
    if (durationSec >= 8) out.durationVeo31ProOfficial = '8';
    else if (durationSec >= 6) out.durationVeo31ProOfficial = '6';
    else if (durationSec >= 4) out.durationVeo31ProOfficial = '4';
    else out.durationVeo31ProOfficial = '4';
  } else if (baseModel === 'gemini-omni' || baseModel === 'gemini-omni-flash') {
    out.model = baseModel;
    if (mid === '720p' || mid === '1080p' || mid === '4k') out.resolutionGeminiOmni = mid;
    else out.resolutionGeminiOmni = '720p';
    if (durationSec > 0) {
      out.durationGeminiOmni =
        baseModel === 'gemini-omni-flash'
          ? String(normalizeGeminiOmniFlashDurationSec(durationSec, 6))
          : String(normalizeGeminiOmniDurationSec(durationSec, 6));
    } else {
      out.durationGeminiOmni = '6';
    }
  } else if (baseModel === 'ltx-2.3-lipsync') {
    if (mid === '720' || mid === '1280' || mid === '1920') out.resolutionLtx23Lipsync = mid;
  } else if (baseModel === 'ltx-2.3-i2v') {
    const parts = mid.split('-');
    const res = parts.find((p) => p === '720' || p === '1280' || p === '1920');
    if (res) out.resolutionLtx23I2v = res;
    if (durationSec > 0) out.durationLtx23I2v = String(durationSec);
  } else if (baseModel === 'ltx-2.3-t2v') {
    let res;
    if (mid === '720' || mid === '1280' || mid === '1920') res = mid;
    else if (mid) res = mid.split('-').find((p) => p === '720' || p === '1280' || p === '1920');
    if (res) out.resolutionLtx23T2v = res;
    else out.resolutionLtx23T2v = '720';
    if (durationSec > 0) out.durationLtx23T2v = String(durationSec);
    else out.durationLtx23T2v = '10';
  } else if (baseModel === 'ltx-2.3-hdr-multi') {
    const parts = mid.split('-');
    const res = parts.find((p) => p === '720' || p === '1280' || p === '1920');
    if (res) out.resolutionLtx23HdrMulti = res;
    else out.resolutionLtx23HdrMulti = '720';
    if (durationSec > 0) out.durationLtx23HdrMulti = String(durationSec);
    else out.durationLtx23HdrMulti = '15';
  } else if (baseModel === 'ltx-2.3-msr-av') {
    const parts = mid.split('-');
    const res = parts.find((p) => p === '720' || p === '1280' || p === '1920');
    if (res) out.resolutionLtx23HdrMulti = res;
    else out.resolutionLtx23HdrMulti = '720';
    if (durationSec > 0) out.durationLtx23HdrMulti = String(durationSec);
    else out.durationLtx23HdrMulti = '10';
  }

  return out;
}

/**
 * @typedef {{ is_active?: boolean; base_price?: number; multiplier?: number; yuanbao_rate?: number }} NxModelConfigRowLike
 */

/**
 * Tablestore nx_model_config 行 → 元宝；与客户端 cloudModelPricing / 后台改价一致。
 * @param {NxModelConfigRowLike|null|undefined} row
 * @param {number} quantity
 * @returns {number|null}
 */
function nxModelRowToYuanbao(row, quantity) {
  if (!row || typeof row !== 'object') return null;
  if (row.is_active === false) return null;
  return yuanbaoCostFromTableDimensions(
    row.base_price,
    row.multiplier != null ? row.multiplier : 1,
    row.yuanbao_rate != null ? row.yuanbao_rate : 10,
    quantity,
  );
}

/**
 * @param {Record<string, NxModelConfigRowLike>|null|undefined} map
 * @param {string} modelId
 * @param {number} [quantity]
 */
function tryNxModelConfigById(map, modelId, quantity = 1) {
  if (!map || typeof map !== 'object' || !modelId) return null;
  const row = map[String(modelId).trim()];
  return nxModelRowToYuanbao(row, quantity);
}

/**
 * 图片：优先 `model-resolution` 再裸 model（与 src/renderer/utils/cloudModelPricing getImageDisplayPrice 一致）
 * @param {string} mNorm
 * @param {Record<string, unknown>} nodeData
 * @param {Record<string, NxModelConfigRowLike>|null|undefined} map
 */
function tryNxModelConfigImage(mNorm, nodeData, map) {
  if (!map || typeof map !== 'object') return null;
  const resRaw = nodeData.resolution;
  const res =
    (typeof resRaw === 'string' && resRaw.trim()) ||
    (resRaw != null && String(resRaw).trim()) ||
    mapImageSizeHint(nodeData.image_size) ||
    mapImageSizeHint(nodeData.size);
  const m = String(mNorm || '').trim();
  const r = res ? String(res).trim().toLowerCase() : '';
  /** Z-image：OTS 主键为 z-image-720p / z-image-1080p，勿仅用裸 z-image */
  let keys;
  if (m === 'z-image-720p' || m === 'z-image-1080p') {
    keys = [m];
  } else if (m === 'z-image') {
    keys = r
      ? [`z-image-${r}`, 'z-image-1080p', 'z-image-720p', m]
      : ['z-image-1080p', 'z-image-720p', m];
  } else if (m === 'lens-720p' || m === 'lens-1080p') {
    keys = [m];
  } else if (m === 'lens') {
    keys = r
      ? [`lens-${r}`, 'lens-1080p', 'lens-720p', m]
      : ['lens-1080p', 'lens-720p', m];
  } else if (m === 'flux2-klein-720p' || m === 'flux2-klein-1080p') {
    keys = [m];
  } else if (m === 'flux2-klein') {
    keys = r
      ? [`flux2-klein-${r}`, 'flux2-klein-1080p', 'flux2-klein-720p', m]
      : ['flux2-klein-1080p', 'flux2-klein-720p', m];
  } else {
    keys = r ? [`${m}-${r}`, m] : [m];
  }
  for (const k of keys) {
    const y = tryNxModelConfigById(map, k, 1);
    if (y != null) return y;
  }
  return null;
}

/**
 * 视频：nx_model_config 扣费与客户端 getVideoDisplayPrice 对齐（同 keys、同 uiSeconds、同 getVideoQuantityForCloudKey）。
 * @param {string} mNorm billingModelId（已 normalize）
 * @param {Record<string, unknown>} nodeData 转发 body，须含与客户端一致的 model / duration 等槽位
 * @param {Record<string, NxModelConfigRowLike>|null|undefined} nxMap
 */
function tryNxModelConfigVideo(mNorm, nodeData, nxMap) {
  if (!nxMap || typeof nxMap !== 'object') return null;
  const nd = nodeData && typeof nodeData === 'object' ? nodeData : {};
  const baseModel = typeof nd.model === 'string' && String(nd.model).trim() !== '' ? String(nd.model).trim() : '';
  const billingPayload = String(mNorm || '').trim();

  let uiSeconds;
  /** @type {string[]} */
  let keysOrdered;
  if (baseModel) {
    const sku = buildVideoBillingModelIdCore(baseModel, nd);
    uiSeconds = getVideoBillingQuantity(baseModel, nd);
    keysOrdered = [sku, baseModel].filter(Boolean);
    if (billingPayload && billingPayload !== sku && !keysOrdered.includes(billingPayload)) {
      keysOrdered.unshift(billingPayload);
    }
  } else {
    uiSeconds = inferUiSecondsFromBillingSkuOnly(billingPayload);
    keysOrdered = billingPayload ? [billingPayload] : [];
  }

  const seen = new Set();
  for (const k of keysOrdered) {
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const q = getVideoQuantityForCloudKey(k, uiSeconds);
    const y = tryNxModelConfigById(nxMap, k, q);
    if (y != null) return y;
  }

  const parsed = tryParseVideoBillingSku(billingPayload);
  const eff = parsed ? normalizeVideoBillingModelId(parsed.baseModel) : '';
  if (eff && !seen.has(eff)) {
    const q = getVideoQuantityForCloudKey(eff, uiSeconds);
    const y = tryNxModelConfigById(nxMap, eff, q);
    if (y != null) return y;
  }
  return null;
}

/**
 * FC run-task 单次扣费元宝（整数）。
 * - 若 ctx.modelConfigMap 来自 Tablestore listModelConfig（与 /model-config 同源），则 **优先按表扣费**，与客户端预估、后台改价一致。
 * - llm：表无行时用环境变量档位（与 NX_CHAT_COST 一致）。
 * - image / video / audio：表无行时回退 cost_table（CNY×倍率）；无法定价时抛 ModelNotPricedError。
 *
 * @param {string} modelId 与前端节点 data.model 或 LLM body.model 一致
 * @param {{
 *   taskType: 'llm'|'image'|'video'|'audio';
 *   nodeData?: Record<string, unknown>;
 *   modelConfigMap?: Record<string, NxModelConfigRowLike> | null;
 * }} ctx modelConfigMap 为 OTS nx_model_config（与 /model-config 同源）时优先按表扣费
 * @returns {number}
 */
export function getFinalPrice(modelId, ctx) {
  const env = typeof process !== 'undefined' && process.env ? process.env : {};
  const taskType = ctx?.taskType;
  const nodeData = ctx?.nodeData && typeof ctx.nodeData === 'object' ? ctx.nodeData : {};
  const nxMap = ctx?.modelConfigMap && typeof ctx.modelConfigMap === 'object' ? ctx.modelConfigMap : null;

  if (taskType === 'llm') {
    const mid = String(modelId || '').trim() || 'gpt-3.5-turbo';
    const fromNx = tryNxModelConfigById(nxMap, mid, 1);
    if (fromNx != null) return fromNx;
    const rate = resolveModelYuanbao(mid, 0);
    if (rate && Number(rate.yuanbao) > 0) return Math.max(1, Math.round(Number(rate.yuanbao)));
    return getCloudDeductYuanbao('llm', env);
  }

  const mNorm = normalizeVideoBillingModelId(modelId);
  if (!mNorm) {
    throw new ModelNotPricedError('', 'unknown', 'empty modelId');
  }

  if (taskType === 'image') {
    const fromNx = tryNxModelConfigImage(mNorm, nodeData, nxMap);
    if (fromNx != null) return fromNx;
    const resRaw = nodeData.resolution;
    const res =
      (typeof resRaw === 'string' && resRaw.trim()) ||
      (resRaw != null && String(resRaw).trim()) ||
      mapImageSizeHint(nodeData.image_size) ||
      mapImageSizeHint(nodeData.size);
    const cnyUnit = getImagePrice({ model: mNorm, resolution: res }, {});
    const imageKey = resolveImageBillingModelId(mNorm);
    const mult = IMAGE_BILLING_MULTIPLIER_BY_MODEL[imageKey] ?? 1;
    return cnyToYuanbaoInt(cnyUnit * mult, env);
  }

  if (taskType === 'video') {
    if (nxMap) {
      const fromNx = tryNxModelConfigVideo(mNorm, nodeData, nxMap);
      if (fromNx != null) return fromNx;
    }
    const parsed = tryParseVideoBillingSku(mNorm);
    const effectiveModel = normalizeVideoBillingModelId(parsed ? parsed.baseModel : mNorm);
    const ndRaw = /** @type {Record<string, unknown>} */ (nodeData && typeof nodeData === 'object' ? nodeData : {});
    const nd = /** @type {Record<string, unknown>} */ (parsed ? applyVideoSkuToNodeData(parsed, { ...ndRaw }) : ndRaw);
    const cny = getVideoPrice(
      {
        model: effectiveModel,
        duration: /** @type {'5'|'10'|'15'|'25'|undefined} */ (nd.duration != null ? String(nd.duration) : undefined),
        sound: /** @type {'true'|'false'|undefined} */ (nd.sound != null ? String(nd.sound) : undefined),
        durationHailuo02: /** @type {'6'|'10'|undefined} */ (nd.durationHailuo02 != null ? String(nd.durationHailuo02) : undefined),
        resolutionHailuo: /** @type {'720p'|'1080p'|'4k'|undefined} */ (nd.resolutionHailuo != null ? String(nd.resolutionHailuo) : undefined),
        durationKlingO1: /** @type {'5'|'10'|undefined} */ (nd.durationKlingO1 != null ? String(nd.durationKlingO1) : undefined),
        modeKlingO1: /** @type {'std'|'pro'|undefined} */ (nd.modeKlingO1 != null ? String(nd.modeKlingO1) : undefined),
        resolutionRhartV31: /** @type {'720p'|'1080p'|'4k'|undefined} */ (nd.resolutionRhartV31 != null ? String(nd.resolutionRhartV31) : undefined),
        resolutionWan26: /** @type {'720p'|'1080p'|undefined} */ (nd.resolutionWan26 != null ? String(nd.resolutionWan26) : undefined),
        durationWan26Flash: nd.durationWan26Flash != null ? String(nd.durationWan26Flash) : undefined,
        enableAudio: /** @type {boolean|undefined} */ (nd.enableAudio),
        durationVeo31ProOfficial: /** @type {'4'|'6'|'8'|undefined} */ (nd.durationVeo31ProOfficial != null ? String(nd.durationVeo31ProOfficial) : undefined),
        generateAudioVeo31ProOfficial: /** @type {boolean|undefined} */ (nd.generateAudioVeo31ProOfficial),
        resolutionLtx23Lipsync: nd.resolutionLtx23Lipsync != null ? String(nd.resolutionLtx23Lipsync) : undefined,
        resolutionLtx23I2v: nd.resolutionLtx23I2v != null ? String(nd.resolutionLtx23I2v) : undefined,
        resolutionLtx23T2v: nd.resolutionLtx23T2v != null ? String(nd.resolutionLtx23T2v) : undefined,
        durationLtx23I2v: nd.durationLtx23I2v != null ? String(nd.durationLtx23I2v) : undefined,
        durationLtx23T2v: nd.durationLtx23T2v != null ? String(nd.durationLtx23T2v) : undefined,
      },
      {},
    );
    return cnyToYuanbaoInt(cny, env);
  }

  if (taskType === 'audio') {
    const fromNx = tryNxModelConfigById(nxMap, mNorm, 1);
    if (fromNx != null) return fromNx;
    const cny = getAudioPrice(mNorm, {});
    return cnyToYuanbaoInt(cny, env);
  }

  throw new ModelNotPricedError(mNorm, 'unknown', 'invalid taskType');
}

export { FC_CLOUD_YUANBAO_DEFAULTS } from './cost_table.mjs';
export { MARKUP_DEFAULT_BY_CATEGORY, MARKUP_OVERRIDE_BY_MODEL_ID } from './markup_table.mjs';
export { CLOUD_TASK_TYPES, resolveCloudYuanbaoFromEnv, DISPLAY_UNIT } from './price_tiers.mjs';
