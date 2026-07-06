import type { NxModelConfigRow } from './nxModelConfigPricingCache';
import {
  getImagePrice,
  getVideoPrice,
  getAudioPrice,
  getImageReversePrice,
  isModelNotPricedError,
  yuanbaoCostFromTableDimensions,
  cnyRetailToYuanbaoInt,
  resolveImageBillingModelId,
  IMAGE_BILLING_MULTIPLIER_BY_MODEL,
} from './priceCalc';
import type { VideoPriceParams } from './priceCalc';
import { buildVideoBillingModelId, getVideoBillingQuantity } from './videoBillingSku';

/**
 * 运营公式（与 Tablestore nx_model_config 一致）：
 * Cost(元宝) = Base_Price × Multiplier × Yuanbao_Rate × Quantity
 * - Base_Price / Multiplier / Yuanbao_Rate：表列 base_price、multiplier、yuanbao_rate
 * - Quantity：图片/音频/反推多为 1；视频为「秒数」或与具体 SKU 行约定（见 getVideoQuantityForCloudKey）
 * yuanbao_rate 缺省或非正时回退 10（1 元 = 10 元宝）
 */
export const DEFAULT_YUANBAO_RATE_FALLBACK = 10;

/** 零售价（元）= base_price × multiplier */
export function displayCnyFromCloudRow(row: NxModelConfigRow | undefined): number | null {
  if (!row || row.is_active === false) return null;
  const bp = Number(row.base_price);
  const mul = Number(row.multiplier);
  const bpN = Number.isFinite(bp) && bp >= 0 ? bp : NaN;
  const mulN = Number.isFinite(mul) && mul >= 0 ? mul : 1;
  if (!Number.isFinite(bpN)) return null;
  const v = bpN * mulN;
  if (!Number.isFinite(v) || v < 0) return null;
  return v;
}

/**
 * 视频：若命中的 cloud key 以 -{N}s 结尾（整条 SKU），认为 base_price 已是该档打包价 → Quantity=1；
 * 否则（仅模型 id）认为 base_price 按「每计费单位」× 前端秒数 → Quantity=UI 秒数。
 */
export function getVideoQuantityForCloudKey(cloudKey: string, uiSeconds: number): number {
  const m = String(cloudKey || '').match(/-(\d+)s(?:-(?:audio|noaudio))?$/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0) return 1;
  }
  return Math.max(1, uiSeconds);
}

/** 表行 + Quantity → 元宝：base_price × multiplier × yuanbao_rate × Quantity（与 yuanbaoCostFromTableDimensions 一致） */
export function yuanbaoCostFromCloudRow(
  row: NxModelConfigRow | undefined,
  quantity: number,
): number | null {
  if (!row || row.is_active === false) return null;
  const bpRaw = Number(row.base_price);
  const mulRaw = Number(row.multiplier);
  const yrRaw = Number(row.yuanbao_rate);
  const qRaw = Number(quantity);
  const bp = Number.isFinite(bpRaw) && bpRaw >= 0 ? bpRaw : 0;
  const mul = Number.isFinite(mulRaw) && mulRaw >= 0 ? mulRaw : 1;
  const rate = Number.isFinite(yrRaw) && yrRaw > 0 ? yrRaw : DEFAULT_YUANBAO_RATE_FALLBACK;
  const q = Number.isFinite(qRaw) && qRaw > 0 ? qRaw : 1;
  return yuanbaoCostFromTableDimensions(bp, mul, rate, q);
}

function pickRow(map: Record<string, NxModelConfigRow> | null | undefined, id: string): NxModelConfigRow | undefined {
  if (!map || !id) return undefined;
  const t = id.trim();
  if (map[t]) return map[t];
  const lower = t.toLowerCase();
  for (const k of Object.keys(map)) {
    if (k.toLowerCase() === lower) return map[k];
  }
  return undefined;
}

/** 无云端行时：与 FC getFinalPrice 一致，零售价(CNY)→元宝（cnyRetailToYuanbaoInt，默认倍率 10） */
function localRetailCnyToYuanbao(cnyRetail: number, quantity = 1): number {
  const c = Number(cnyRetail);
  const q = Math.max(1, Number(quantity) || 1);
  if (!Number.isFinite(c) || c <= 0) return 1;
  return Math.max(1, cnyRetailToYuanbaoInt(c * q));
}

/** banana / nano 与面板一致：无 resolution 时按 1k 档计价，避免误用 default 与 1k 混档 */
function effectiveImageResolutionForFallback(model: string, resolution: string | undefined): string | undefined {
  const m = String(model || '').trim();
  const r = String(resolution ?? '').trim();
  if (r) return r;
  if (m === 'banana-2.0' || m === 'nano-banana') return '1k';
  if (m === 'z-image' || m === 'lens' || m === 'flux2-klein') return '1080p';
  return undefined;
}

/** 无云端表时图片：与 FC getFinalPrice 一致（getImagePrice 含 markup × IMAGE_BILLING_MULTIPLIER × 扣费倍率） */
function localImageYuanbaoFallback(
  params: { model: string; resolution?: string; quantity?: number },
): number {
  const m = String(params.model || '').trim();
  const qty = Math.max(1, Number(params.quantity) > 0 ? Number(params.quantity) : 1);
  const res = effectiveImageResolutionForFallback(m, params.resolution);
  const key = resolveImageBillingModelId(m);
  const mult = IMAGE_BILLING_MULTIPLIER_BY_MODEL[key] ?? 1;
  const cnyRetail = getImagePrice({ model: m, resolution: res }, {});
  return Math.max(1, cnyRetailToYuanbaoInt(cnyRetail * mult * qty));
}

export function getImageDisplayPrice(
  params: { model: string; resolution?: string; quantity?: number },
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
): number {
  const qty = Math.max(1, Number(params.quantity) > 0 ? Number(params.quantity) : 1);
  const m = String(params.model || '').trim();
  const r = String(params.resolution || '').trim().toLowerCase();
  /** 有分辨率时先查「model-resolution」主键（与 OTS 如 banana-2.0-2k 一致），再回退裸 model，避免一档价盖住分档价 */
  const keys = r ? [`${m}-${r}`, m] : [m];
  for (const k of keys) {
    const y = yuanbaoCostFromCloudRow(pickRow(cloudMap, k), qty);
    if (y != null) return y;
  }
  return localImageYuanbaoFallback(params);
}

export function getVideoDisplayPrice(params: VideoPriceParams, cloudMap: Record<string, NxModelConfigRow> | null | undefined): number {
  const model = String(params.model || '').trim();
  const data = params as unknown as Record<string, unknown>;
  const sku = buildVideoBillingModelId(model, data);
  const uiSeconds = getVideoBillingQuantity(model, data);
  const order = [sku, model].filter(Boolean);
  for (const k of order) {
    const q = getVideoQuantityForCloudKey(k, uiSeconds);
    const y = yuanbaoCostFromCloudRow(pickRow(cloudMap, k), q);
    if (y != null) return y;
  }
  return localRetailCnyToYuanbao(getVideoPrice(params as unknown as Record<string, unknown>), 1);
}

export function getAudioDisplayPrice(
  model: string,
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
): number {
  const m = String(model || '').trim();
  if (m === 'ai-voice-cover') return 0;
  const qty = Math.max(1, Number(quantity) || 1);
  const y = yuanbaoCostFromCloudRow(pickRow(cloudMap, m), qty);
  if (y != null) return y;
  return localRetailCnyToYuanbao(getAudioPrice(m), qty);
}

export function getImageReverseDisplayPrice(
  model: 'gpt-4o' | 'joy-caption-two',
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
): number {
  const qty = Math.max(1, Number(quantity) || 1);
  const y = yuanbaoCostFromCloudRow(pickRow(cloudMap, model), qty);
  if (y != null) return y;
  return localRetailCnyToYuanbao(getImageReversePrice(model), qty);
}

/** 与 LLMInputPanel / FC 默认对话模型一致（sync_to_tablestore nx_model_config） */
export const LLM_CHAT_DISPLAY_MODEL_ID = 'gpt-3.5-turbo';

/** RunningHub 视频分析应用 ID（与 VideoAnalysisProvider、sync_to_tablestore 一致） */
const VIDEO_ANALYSIS_APP_ID = '2033537159944212482';

/**
 * 普通对话单次运行预估元宝：优先 nx_model_config 行 gpt-3.5-turbo，否则按种子 base 0.01 元 × 折算率。
 */
export function getLlmChatDisplayPrice(
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
): number {
  const qty = Math.max(1, Number(quantity) || 1);
  const y = yuanbaoCostFromCloudRow(pickRow(cloudMap, LLM_CHAT_DISPLAY_MODEL_ID), qty);
  if (y != null) return y;
  return localRetailCnyToYuanbao(0.01, qty);
}

/**
 * 视频分析单次预估：优先表主键 RunningHub 应用 ID，其次 video-analysis；无表时按 VIDEO 类默认 base 0.1 元。
 */
export function getVideoAnalysisDisplayPrice(
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
): number {
  const qty = Math.max(1, Number(quantity) || 1);
  for (const id of [VIDEO_ANALYSIS_APP_ID, 'video-analysis']) {
    const y = yuanbaoCostFromCloudRow(pickRow(cloudMap, id), qty);
    if (y != null) return y;
  }
  return localRetailCnyToYuanbao(0.1, qty);
}

/**
 * SORA2 角色创建单次预估（画布「角色」节点 / upload-character-video）：
 * 优先 nx_model_config 主键 `sora-2-character-plugin`（插件算力 / RunningHub）或 `sora-2-character-core`（核心算力 / BLTCY），
 * 其次回退 `sora-2-character`；无表时与视频分析一致按种子 base 0.1 元折算元宝。
 */
export function getSora2CharacterDisplayPrice(
  channel: 'plugin' | 'core',
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
): number {
  const qty = Math.max(1, Number(quantity) || 1);
  const specific = channel === 'core' ? 'sora-2-character-core' : 'sora-2-character-plugin';
  for (const id of [specific, 'sora-2-character']) {
    const y = yuanbaoCostFromCloudRow(pickRow(cloudMap, id), qty);
    if (y != null) return y;
  }
  return localRetailCnyToYuanbao(0.1, qty);
}

/** RunningHub 抠图应用 ID（与 matting.ts、sync_to_tablestore 一致） */
export const MATTING_AI_APP_ID = '2021955919764000770';
/** RunningHub 去水印应用 ID（与 watermarkRemoval.ts、sync_to_tablestore 一致） */
export const WATERMARK_REMOVAL_AI_APP_ID = '2022127885233950721';
/** RunningHub 视频去水印 AI 应用 ID（与 runningHubAiAppFc、FC billing 一致） */
export const VIDEO_WATERMARK_REMOVAL_AI_APP_ID = '2049450731266121729';
/** 人物多角度 RunningHub AI 应用 ID（与 runningHubAiAppFc、FC billingModelId 一致） */
export const CHARACTER_MULTI_ANGLE_AI_APP_ID = '1990056102572290049';
/** 图片转 3D（GLB）RunningHub AI App — Hy3D 经典 */
export const IMAGE_TO_3D_AI_APP_ID = '2059618241806430209';
export { TRELLIS2_IMAGE_TO_3D_APP_ID } from '../../shared/imageTo3dModels';
import { imageTo3dAppIdForModel, resolveImageTo3dModelId } from '../../shared/imageTo3dModels';

/**
 * 抠图 / 去水印单次预估：nx_model_config 主键为 RunningHub 应用 ID；无表时按种子 base 0.01 元（sync BASE_PRICE_CNY）。
 */
function getRunningHubImageAuxDisplayPrice(
  appId: string,
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
): number {
  const qty = Math.max(1, Number(quantity) || 1);
  const y = yuanbaoCostFromCloudRow(pickRow(cloudMap, String(appId).trim()), qty);
  if (y != null) return y;
  return localRetailCnyToYuanbao(0.01, qty);
}

export function getMattingDisplayPrice(
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
): number {
  return getRunningHubImageAuxDisplayPrice(MATTING_AI_APP_ID, cloudMap, quantity);
}

export function getImageTo3dDisplayPrice(
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
  modelId?: string | null,
): number {
  const appId = imageTo3dAppIdForModel(resolveImageTo3dModelId(modelId));
  return getRunningHubImageAuxDisplayPrice(appId, cloudMap, quantity);
}

export function getWatermarkRemovalDisplayPrice(
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
): number {
  return getRunningHubImageAuxDisplayPrice(WATERMARK_REMOVAL_AI_APP_ID, cloudMap, quantity);
}

export function getVideoWatermarkRemovalDisplayPrice(
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
): number {
  return getRunningHubImageAuxDisplayPrice(VIDEO_WATERMARK_REMOVAL_AI_APP_ID, cloudMap, quantity);
}

/**
 * 人物多角度单次预估：nx_model_config 主键为 RunningHub 应用 ID `1990056102572290049`；
 * 无表时按 cost_table 中该 ID 的零售价（与 getImagePrice/markup 一致），勿误用当前画布文生图模型价。
 */
export function getCharacterMultiAngleDisplayPrice(
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
): number {
  const qty = Math.max(1, Number(quantity) || 1);
  const y = yuanbaoCostFromCloudRow(pickRow(cloudMap, CHARACTER_MULTI_ANGLE_AI_APP_ID), qty);
  if (y != null) return y;
  return localImageYuanbaoFallback({ model: CHARACTER_MULTI_ANGLE_AI_APP_ID, quantity: qty });
}

export function getNodeDisplayPrice(
  nodeType: string,
  data: Record<string, unknown> | undefined,
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
): number | null {
  if (!data) return null;
  const imageQty =
    typeof data.billingQuantity === 'number' && data.billingQuantity > 0
      ? data.billingQuantity
      : typeof data.quantity === 'number' && data.quantity > 0
        ? data.quantity
        : 1;

  if (nodeType === 'llm') {
    const reverseModel = data.reverseCaptionModel;
    if (reverseModel === 'gpt-4o' || reverseModel === 'joy-caption-two') {
      try {
        return getImageReverseDisplayPrice(reverseModel, cloudMap, 1);
      } catch (e) {
        if (isModelNotPricedError(e)) return null;
        throw e;
      }
    }
    return getLlmChatDisplayPrice(cloudMap, 1);
  }
  try {
    if (nodeType === 'image') {
      return getImageDisplayPrice(
        {
          model: String(data.model || 'banana-2.0'),
          resolution: typeof data.resolution === 'string' ? data.resolution : undefined,
          quantity: imageQty,
        },
        cloudMap,
      );
    }
    if (nodeType === 'video' || nodeType === 'wanAnimate' || nodeType === 'heyGem') {
      const vd = {
        ...data,
        model:
          nodeType === 'wanAnimate' ? 'wan-animate' : nodeType === 'heyGem' ? 'hey-gem' : String(data.model || 'sora-2'),
      } as VideoPriceParams;
      return getVideoDisplayPrice(vd, cloudMap);
    }
    if (nodeType === 'audio') {
      return getAudioDisplayPrice(String(data.model || ''), cloudMap, 1);
    }
    if (nodeType === 'character') {
      const ch = data.characterChannel === 'plugin' ? 'plugin' : 'core';
      return getSora2CharacterDisplayPrice(ch, cloudMap, 1);
    }
  } catch (e) {
    if (isModelNotPricedError(e)) return null;
    throw e;
  }
  return null;
}
