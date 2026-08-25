import type { NxModelConfigRow } from './nxModelConfigPricingCache';
import { DEFAULT_IMAGE_MODEL } from '../config/imageModelUiPolicy';
import {
  isModelNotPricedError,
  yuanbaoCostFromTableDimensions,
  resolveImageBillingModelId,
} from './priceCalc';
import type { VideoPriceParams } from './priceCalc';
import { buildVideoBillingModelId, getVideoBillingQuantity } from './videoBillingSku';
import { imageTo3dAppIdForModel, resolveImageTo3dModelId } from '../../shared/imageTo3dModels';
export { TRELLIS2_IMAGE_TO_3D_APP_ID } from '../../shared/imageTo3dModels';

/**
 * 运营公式（与 Tablestore nx_model_config 一致）：
 * Cost(元宝) = Base_Price × Multiplier × Yuanbao_Rate × Quantity
 * - Base_Price / Multiplier / Yuanbao_Rate：表列 base_price、multiplier、yuanbao_rate
 * - Quantity：图片/音频/反推多为 1；视频为「秒数」或与具体 SKU 行约定（见 getVideoQuantityForCloudKey）
 * yuanbao_rate 缺省或非正时回退 10（1 元 = 10 元宝）
 *
 * **计价规则（强制）：只认 OTS `nx_model_config`。取不到云端价则返回 null，禁止回退本地 cost_table。**
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
 * VIDEO_FLAT_CNY 等「按次」计价的裸 model_id：表行 base 已是整次价，Quantity 必须为 1。
 * 否则在仅有裸 id、无复合 SKU 行时，会把 uiSeconds（如 LTX 10s）误乘进扣费。
 */
const VIDEO_FLAT_PACK_PRICE_MODEL_IDS = new Set([
  'sora-2',
  'sora-2-pro',
  'ltx-2.3-lipsync',
  'ltx-2.3-i2v',
  'ltx-2.3-t2v',
  'ltx-2.3-hdr-multi',
  'ltx-2.3-msr-av',
  '2049450731266121729',
  '2082392424818757633',
  '2082437486235709441',
  '2082682378039943169',
]);

/**
 * 视频：若命中的 cloud key 以 -{N}s 结尾（整条 SKU），认为 base_price 已是该档打包价 → Quantity=1；
 * 若为 VIDEO_FLAT 裸 model_id，同样 Quantity=1；
 * 否则（按秒基价的裸 id）Quantity=UI 秒数。
 */
export function getVideoQuantityForCloudKey(cloudKey: string, uiSeconds: number): number {
  const key = String(cloudKey || '').trim();
  const m = key.match(/-(\d+)s(?:-(?:audio|noaudio))?$/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0) return 1;
  }
  if (VIDEO_FLAT_PACK_PRICE_MODEL_IDS.has(key)) return 1;
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

function assertCloudMap(
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
): cloudMap is Record<string, NxModelConfigRow> {
  return !!cloudMap && typeof cloudMap === 'object';
}

/** 仅查 OTS 行；无表/无行返回 null（禁止本地价；渲染路径绝不抛错） */
function requireOtsYuanbao(
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  keys: string[],
  quantity: number,
  _modelHint: string,
  _kind: string,
): number | null {
  try {
    if (!assertCloudMap(cloudMap)) return null;
    const qty = Math.max(1, Number(quantity) || 1);
    for (const k of keys) {
      const id = String(k || '').trim();
      if (!id) continue;
      const y = yuanbaoCostFromCloudRow(pickRow(cloudMap, id), qty);
      if (y != null) return y;
    }
    return null;
  } catch {
    return null;
  }
}

export function getImageDisplayPrice(
  params: { model: string; resolution?: string; quantity?: number },
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
): number | null {
  const qty = Math.max(1, Number(params.quantity) > 0 ? Number(params.quantity) : 1);
  const m = String(params.model || '').trim();
  const r = String(params.resolution || '').trim().toLowerCase();
  /** 有分辨率时先查「model-resolution」主键（与 OTS 如 banana-2.0-2k 一致），再回退裸 model */
  const keys = r ? [`${m}-${r}`, m] : [m];
  return requireOtsYuanbao(cloudMap, keys, qty, m, 'image');
}

export function getVideoDisplayPrice(
  params: VideoPriceParams,
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
): number | null {
  try {
    const model = String(params.model || '').trim();
    const data = params as unknown as Record<string, unknown>;
    const sku = buildVideoBillingModelId(model, data);
    const uiSeconds = getVideoBillingQuantity(model, data);
    if (!assertCloudMap(cloudMap)) return null;
    const order = [sku, model].filter(Boolean);
    for (const k of order) {
      const q = getVideoQuantityForCloudKey(k, uiSeconds);
      const y = yuanbaoCostFromCloudRow(pickRow(cloudMap, k), q);
      if (y != null) return y;
    }
    return null;
  } catch {
    return null;
  }
}

export function getAudioDisplayPrice(
  model: string,
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
): number | null {
  const m = String(model || '').trim();
  if (m === 'ai-voice-cover') return 0;
  return requireOtsYuanbao(cloudMap, [m], quantity, m, 'audio');
}

/** 与 LLMInputPanel / FC 默认对话模型一致（sync_to_tablestore nx_model_config） */
export const LLM_CHAT_DISPLAY_MODEL_ID = 'gpt-3.5-turbo';

/** RunningHub LLM（llm.runninghub.ai） */
export const LLM_CHAT_MODEL_GPT56_TERRA = 'openai/gpt-5.6-terra';

/** 图像反推可选模型（gpt-4o 为旧工程兼容） */
export type ImageReverseCaptionModel =
  | typeof LLM_CHAT_MODEL_GPT56_TERRA
  | 'joy-caption-two'
  | 'gpt-4o';

/** 反推默认：智能分析 = GPT-5.6 Terra（RunningHub LLM 多模态） */
export const IMAGE_REVERSE_DEFAULT_MODEL: ImageReverseCaptionModel = LLM_CHAT_MODEL_GPT56_TERRA;

/** 将节点上存的反推模型规范为当前可选值（旧 gpt-4o → Terra） */
export function normalizeImageReverseCaptionModel(
  model: string | null | undefined,
): ImageReverseCaptionModel {
  const m = String(model || '').trim();
  if (m === 'joy-caption-two') return 'joy-caption-two';
  if (m === LLM_CHAT_MODEL_GPT56_TERRA) return LLM_CHAT_MODEL_GPT56_TERRA;
  if (m === 'gpt-4o') return LLM_CHAT_MODEL_GPT56_TERRA;
  return IMAGE_REVERSE_DEFAULT_MODEL;
}

export function getImageReverseDisplayPrice(
  model: ImageReverseCaptionModel | string,
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
): number | null {
  const id = normalizeImageReverseCaptionModel(model);
  if (id === LLM_CHAT_MODEL_GPT56_TERRA) {
    return getLlmChatDisplayPrice(cloudMap, quantity, LLM_CHAT_MODEL_GPT56_TERRA);
  }
  return requireOtsYuanbao(cloudMap, [id], quantity, id, 'reverse');
}

/** 普通对话可选模型 */
export const LLM_CHAT_MODEL_IDS = [
  LLM_CHAT_DISPLAY_MODEL_ID,
  'gpt-4o',
  LLM_CHAT_MODEL_GPT56_TERRA,
] as const;

/** RunningHub 视频分析应用 ID（与 VideoAnalysisProvider、sync_to_tablestore 一致） */
const VIDEO_ANALYSIS_APP_ID = '2033537159944212482';

/** 导演 / LLM 面板对话模型展示名（与扣费 model id 对应） */
export const LLM_CHAT_MODEL_LABELS: Record<string, string> = {
  [LLM_CHAT_DISPLAY_MODEL_ID]: '大语言模型-3.5',
  'gpt-4o': '大语言模型-4o',
  [LLM_CHAT_MODEL_GPT56_TERRA]: '大语言模型-5.6',
};

/**
 * 普通对话单次运行预估元宝：仅认该 model id 的 nx_model_config 行。
 */
export function getLlmChatDisplayPrice(
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
  modelId: string = LLM_CHAT_DISPLAY_MODEL_ID,
): number | null {
  const id = String(modelId || '').trim() || LLM_CHAT_DISPLAY_MODEL_ID;
  return requireOtsYuanbao(cloudMap, [id], quantity, id, 'llm');
}

/** 云端录音文件转写（百炼 fun-asr）nx_model_config / 回退表主键 */
export const FILE_TRANSCRIBE_MODEL_ID = 'fun-asr';

/** 阿里云 VIAPI 视频人像分割（按输出时长秒级计费） */
export const VIAPI_SEGMENT_VIDEO_BODY_MODEL_ID = 'viapi-segment-video-body';

/**
 * 云端文件转写单次预估元宝：仅认 nx_model_config `fun-asr`。
 */
export function getFileTranscribeDisplayPrice(
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
): number | null {
  return requireOtsYuanbao(cloudMap, [FILE_TRANSCRIBE_MODEL_ID], quantity, FILE_TRANSCRIBE_MODEL_ID, 'audio');
}

/**
 * 智能抠像预估元宝（秒级）：billableSeconds = max(1, ceil(秒))；
 * cost = max(1, ceil(unitCostPerMinute * billableSeconds / 60))。
 * 仅认 nx_model_config `viapi-segment-video-body`。
 */
export function getViapiSegmentVideoBodyDisplayPrice(
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  durationSec = 1,
): number | null {
  const billableSeconds = Math.max(1, Math.ceil(Math.max(0, Number(durationSec) || 0)));
  const unitFromCloud = requireOtsYuanbao(
    cloudMap,
    [VIAPI_SEGMENT_VIDEO_BODY_MODEL_ID],
    1,
    VIAPI_SEGMENT_VIDEO_BODY_MODEL_ID,
    'video',
  );
  if (unitFromCloud == null) return null;
  return Math.max(1, Math.ceil((unitFromCloud * billableSeconds) / 60));
}

/**
 * 视频分析单次预估：仅认表主键 RunningHub 应用 ID 或 video-analysis。
 */
export function getVideoAnalysisDisplayPrice(
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
): number | null {
  return requireOtsYuanbao(
    cloudMap,
    [VIDEO_ANALYSIS_APP_ID, 'video-analysis'],
    quantity,
    VIDEO_ANALYSIS_APP_ID,
    'video',
  );
}

/**
 * SORA2 角色创建单次预估（画布「角色」节点 / upload-character-video）：
 * 仅认 nx_model_config 主键。
 */
export function getSora2CharacterDisplayPrice(
  channel: 'plugin' | 'core',
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
): number | null {
  const specific = channel === 'core' ? 'sora-2-character-core' : 'sora-2-character-plugin';
  return requireOtsYuanbao(cloudMap, [specific, 'sora-2-character'], quantity, specific, 'video');
}

/** RunningHub 抠图应用 ID（与 matting.ts、sync_to_tablestore 一致） */
export const MATTING_AI_APP_ID = '2021955919764000770';
/** RunningHub 去水印应用 ID（与 watermarkRemoval.ts、sync_to_tablestore 一致） */
export const WATERMARK_REMOVAL_AI_APP_ID = '2022127885233950721';
/** 超分放大 RunningHub AI 应用 ID（与 runningHubAiAppFc 一致） */
export const IMAGE_UPSCALE_V3_AI_APP_ID = '2082378062234214401';
/** RunningHub 视频去水印 AI 应用 ID（与 runningHubAiAppFc、FC billing 一致） */
export const VIDEO_WATERMARK_REMOVAL_AI_APP_ID = '2049450731266121729';
/** 视频深度转换 RunningHub AI 应用 ID */
export const VIDEO_DEPTH_CONVERT_AI_APP_ID = '2082392424818757633';
/** 视频去字幕/水印 RunningHub AI 应用 ID */
export const VIDEO_SUBTITLE_WATERMARK_AI_APP_ID = '2082682378039943169';
/** 人物多角度 RunningHub AI 应用 ID（与 runningHubAiAppFc、FC billingModelId 一致） */
export const CHARACTER_MULTI_ANGLE_AI_APP_ID = '1990056102572290049';
/** 图片转 3D（GLB）RunningHub AI App — Hy3D 经典 */
export const IMAGE_TO_3D_AI_APP_ID = '2059618241806430209';

/**
 * 抠图 / 去水印等：仅认 nx_model_config 主键为 RunningHub 应用 ID。
 */
function getRunningHubImageAuxDisplayPrice(
  appId: string,
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
): number | null {
  const id = String(appId).trim();
  return requireOtsYuanbao(cloudMap, [id], quantity, id, 'image');
}

export function getMattingDisplayPrice(
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
): number | null {
  return getRunningHubImageAuxDisplayPrice(MATTING_AI_APP_ID, cloudMap, quantity);
}

export function getImageTo3dDisplayPrice(
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
  modelId?: string | null,
): number | null {
  const appId = imageTo3dAppIdForModel(resolveImageTo3dModelId(modelId));
  return getRunningHubImageAuxDisplayPrice(appId, cloudMap, quantity);
}

export function getWatermarkRemovalDisplayPrice(
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
): number | null {
  return getRunningHubImageAuxDisplayPrice(WATERMARK_REMOVAL_AI_APP_ID, cloudMap, quantity);
}

export function getImageUpscaleV3DisplayPrice(
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
): number | null {
  return requireOtsYuanbao(cloudMap, [IMAGE_UPSCALE_V3_AI_APP_ID], quantity, IMAGE_UPSCALE_V3_AI_APP_ID, 'image');
}

export function getVideoWatermarkRemovalDisplayPrice(
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
): number | null {
  return getRunningHubImageAuxDisplayPrice(VIDEO_WATERMARK_REMOVAL_AI_APP_ID, cloudMap, quantity);
}

export function getVideoDepthConvertDisplayPrice(
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
): number | null {
  return requireOtsYuanbao(cloudMap, [VIDEO_DEPTH_CONVERT_AI_APP_ID], quantity, VIDEO_DEPTH_CONVERT_AI_APP_ID, 'video');
}

export function getVideoSubtitleWatermarkDisplayPrice(
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
): number | null {
  return requireOtsYuanbao(
    cloudMap,
    [VIDEO_SUBTITLE_WATERMARK_AI_APP_ID],
    quantity,
    VIDEO_SUBTITLE_WATERMARK_AI_APP_ID,
    'video',
  );
}

/**
 * 人物多角度单次预估：仅认 nx_model_config 主键。
 */
export function getCharacterMultiAngleDisplayPrice(
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  quantity = 1,
): number | null {
  return requireOtsYuanbao(
    cloudMap,
    [CHARACTER_MULTI_ANGLE_AI_APP_ID],
    quantity,
    CHARACTER_MULTI_ANGLE_AI_APP_ID,
    'image',
  );
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
    if (
      reverseModel === 'gpt-4o' ||
      reverseModel === 'joy-caption-two' ||
      reverseModel === LLM_CHAT_MODEL_GPT56_TERRA
    ) {
      try {
        return getImageReverseDisplayPrice(String(reverseModel), cloudMap, 1);
      } catch (e) {
        if (isModelNotPricedError(e)) return null;
        throw e;
      }
    }
    try {
      return getLlmChatDisplayPrice(cloudMap, 1, String(data.model || LLM_CHAT_DISPLAY_MODEL_ID));
    } catch (e) {
      if (isModelNotPricedError(e)) return null;
      throw e;
    }
  }
  try {
    if (nodeType === 'image') {
      return getImageDisplayPrice(
        {
          model: String(data.model || DEFAULT_IMAGE_MODEL),
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

/** @deprecated 仅兼容旧 import；图片计费 id 仍走 resolveImageBillingModelId */
export { resolveImageBillingModelId };
