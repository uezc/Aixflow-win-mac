/**
 * @deprecated 直连 RunningHub 已弃用；去水印/视频深度转换/去字幕经 FC 扣元宝，见 runningHubAiAppFc.ts
 */
export type { WatermarkRemovalResult, WatermarkRemovalError } from './runningHubAiAppFc.js';
export type {
  VideoWatermarkRemovalFcOk,
  VideoWatermarkRemovalFcErr,
  VideoDepthConvertFcOk,
  VideoDepthConvertFcErr,
  VideoSubtitleWatermarkFcOk,
  VideoSubtitleWatermarkFcErr,
} from './runningHubAiAppFc.js';
export {
  runWatermarkRemovalViaFc,
  WATERMARK_REMOVAL_AI_APP_ID,
  runVideoWatermarkRemovalViaFc,
  VIDEO_WATERMARK_REMOVAL_AI_APP_ID,
  runVideoDepthConvertViaFc,
  VIDEO_DEPTH_CONVERT_AI_APP_ID,
  runVideoSubtitleWatermarkRemovalViaFc,
  VIDEO_SUBTITLE_WATERMARK_AI_APP_ID,
} from './runningHubAiAppFc.js';
