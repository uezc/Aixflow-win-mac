import { scaleModulePx } from '../utils/moduleDisplayScale';

export const RVC_TRAIN_WIDTH = scaleModulePx(320);
export const RVC_TRAIN_HEIGHT = scaleModulePx(200);

/** 训练节点内边距（用于估算头像列高度） */
export const RVC_TRAIN_BODY_PAD_Y_PX = 24;

export const RVC_TRAIN_NAME_FONT_DEFAULT_PX = 45;
export const RVC_TRAIN_NAME_FONT_MIN_PX = 18;
export const RVC_TRAIN_NAME_FONT_MAX_PX = 72;
export const RVC_TRAIN_NAME_FONT_STEP_PX = 3;

export function clampRvcTrainNameFontPx(value: unknown): number {
  const n = Math.round(Number(value) || RVC_TRAIN_NAME_FONT_DEFAULT_PX);
  return Math.max(RVC_TRAIN_NAME_FONT_MIN_PX, Math.min(RVC_TRAIN_NAME_FONT_MAX_PX, n));
}
