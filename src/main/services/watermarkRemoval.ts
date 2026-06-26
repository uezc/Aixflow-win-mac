/**
 * @deprecated 直连 RunningHub 已弃用；去水印经 FC 扣元宝，见 runningHubAiAppFc.ts
 */
export type { WatermarkRemovalResult, WatermarkRemovalError } from './runningHubAiAppFc.js';
export type { VideoWatermarkRemovalFcOk, VideoWatermarkRemovalFcErr } from './runningHubAiAppFc.js';
export {
  runWatermarkRemovalViaFc,
  WATERMARK_REMOVAL_AI_APP_ID,
  runVideoWatermarkRemovalViaFc,
  VIDEO_WATERMARK_REMOVAL_AI_APP_ID,
} from './runningHubAiAppFc.js';
