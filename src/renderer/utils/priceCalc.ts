// @ts-nocheck
/**
 * 定价入口：全部来自 pricing/price_calculator.mjs，不在此写死价格。
 * 未定价模型会抛出 ModelNotPricedError；UI 应捕获并显示「暂未定价」。
 */

export {
  ModelNotPricedError,
  isModelNotPricedError,
  getCloudDeductYuanbao,
  cnyRetailToYuanbaoInt,
  yuanbaoCostFromTableDimensions,
  getImagePrice,
  getVideoPrice,
  getImageReversePrice,
  getAudioPrice,
  getNodePrice,
  resolveImageBillingModelId,
  IMAGE_BILLING_MULTIPLIER_BY_MODEL,
} from '@pricing/price_calculator.mjs';

/** 图片节点参数（与 pricing 一致） */
export interface ImagePriceParams {
  model: string;
  resolution?: string;
}

/** 视频节点参数（与 pricing 一致） */
export interface VideoPriceParams {
  model: string;
  duration?: '5' | '10' | '15' | '25';
  sound?: 'true' | 'false';
  durationHailuo02?: '6' | '10';
  /** 海螺计费 SKU 用；与主进程 buildVideoBillingModelId 一致 */
  resolutionHailuo?: 'na' | '720p' | '1080p' | '4k';
  durationKlingO1?: '5' | '10';
  modeKlingO1?: 'std' | 'pro';
  /** Grok video3 图生视频：秒数 6–30（字符串与节点 data 一致） */
  durationGrok3?: string;
  resolutionGrok3?: '720p';
  resolutionRhartV31?: '720p' | '1080p' | '4k' | '1920p' | '720' | '1280' | '1920';
  resolutionWan26?: '720p' | '1080p';
  durationWan26Flash?: string;
  enableAudio?: boolean;
  durationVeo31ProOfficial?: '4' | '6' | '8';
  generateAudioVeo31ProOfficial?: boolean;
  durationLtx23I2v?: '5' | '10' | '15';
  resolutionLtx23I2v?: '720' | '1280' | '1920';
  /** 与 buildVideoBillingModelId / 节点 data 一致 */
  resolutionLtx23Lipsync?: string;
  durationLtx23T2v?: string;
  resolutionLtx23T2v?: string;
  /** MiniMax-H3 文生/图生/多参/音参：480p→0.4 / 720p→0.9；音参为映射后的计费档 6|10|15|20 */
  durationMinimaxH3?: '6' | '10' | '15' | '20';
  resolutionMinimaxH3?: '480p' | '720p';
  /** WanAnimate 角色替换：与 buildVideoBillingModelId / VideoProvider 一致 */
  resolutionWanAnimate?: '720p' | '1080p';
  wanAnimateClipSec?: '5' | '8' | '10' | '15';
  resolutionSeedance?: '480p' | '720p' | '1080p' | '2k' | '4k';
  durationSeedance?: '5' | '10' | '15';
  resolutionGeminiOmni?: '720p' | '1080p' | '4k';
  durationGeminiOmni?: '6' | '8' | '10';
  /** 视频超分放大：目标分辨率 */
  targetResolution?: '720p' | '1080p' | '2k' | '4k';
  /** 视频超分放大：输入视频时长（秒）；计费 Quantity = max(ceil(时长), 5) */
  mediaDurationSec?: number;
}
