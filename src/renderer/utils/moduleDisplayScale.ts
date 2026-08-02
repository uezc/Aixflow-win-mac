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

export function needsModuleSizeScaleUpgrade(
  data: { moduleSizeScaleVersion?: unknown } | null | undefined,
): boolean {
  const v = Number(data?.moduleSizeScaleVersion);
  return !Number.isFinite(v) || v < MODULE_SIZE_SCALE_VERSION;
}
