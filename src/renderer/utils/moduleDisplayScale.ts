/** 画布模块显示尺寸相对初版的倍率 */
export const MODULE_DISPLAY_SCALE = 1.5;

/**
 * 工程节点尺寸迁移版本。
 * 提高 MODULE_DISPLAY_SCALE 时请递增，加载时只对 version 落后的节点放大一次。
 */
export const MODULE_SIZE_SCALE_VERSION = 1;

export function scaleModulePx(n: number): number {
  return Math.round(n * MODULE_DISPLAY_SCALE * 100) / 100;
}

/** 文本模块默认最小尺寸 */
export const TEXT_MODULE_DEFAULT_W = scaleModulePx(280);
export const TEXT_MODULE_DEFAULT_H = scaleModulePx(160);
/** 仅用于纠正「未手动缩放」的历史脏尺寸（RO 撑满视口） */
export const TEXT_MODULE_MAX_W = scaleModulePx(560);
export const TEXT_MODULE_MAX_H = scaleModulePx(480);
/** 用户拖动手柄时的 sanity 上限（防 NaN / 百万级脏数据），不挡正常拉大 */
export const TEXT_MODULE_SANITY_MAX_W = 16384;
export const TEXT_MODULE_SANITY_MAX_H = 16384;

function finitePositive(n: number, fallback: number): number {
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** 用户可自由拉大；只卡住过小和明显损坏的数值。 */
export function clampTextModuleSize(width: number, height: number): { width: number; height: number } {
  const w = finitePositive(Number(width), TEXT_MODULE_DEFAULT_W);
  const h = finitePositive(Number(height), TEXT_MODULE_DEFAULT_H);
  return {
    width: Math.min(TEXT_MODULE_SANITY_MAX_W, Math.max(TEXT_MODULE_DEFAULT_W, w)),
    height: Math.min(TEXT_MODULE_SANITY_MAX_H, Math.max(TEXT_MODULE_DEFAULT_H, h)),
  };
}

/** 加载未手动缩放的节点：把异常撑满画布的历史尺寸压回默认上限。 */
export function clampTextModuleAutoSize(width: number, height: number): { width: number; height: number } {
  const w = finitePositive(Number(width), TEXT_MODULE_DEFAULT_W);
  const h = finitePositive(Number(height), TEXT_MODULE_DEFAULT_H);
  return {
    width: Math.min(TEXT_MODULE_MAX_W, Math.max(TEXT_MODULE_DEFAULT_W, w)),
    height: Math.min(TEXT_MODULE_MAX_H, Math.max(TEXT_MODULE_DEFAULT_H, h)),
  };
}

export function needsModuleSizeScaleUpgrade(
  data: { moduleSizeScaleVersion?: unknown } | null | undefined,
): boolean {
  const v = Number(data?.moduleSizeScaleVersion);
  return !Number.isFinite(v) || v < MODULE_SIZE_SCALE_VERSION;
}
