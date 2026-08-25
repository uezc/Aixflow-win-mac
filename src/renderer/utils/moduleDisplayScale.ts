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

/** 文本模块默认 / 上限（防止 RO 或历史脏数据撑满画布导致发糊） */
export const TEXT_MODULE_DEFAULT_W = scaleModulePx(280);
export const TEXT_MODULE_DEFAULT_H = scaleModulePx(160);
export const TEXT_MODULE_MAX_W = scaleModulePx(560);
export const TEXT_MODULE_MAX_H = scaleModulePx(480);

export function clampTextModuleSize(width: number, height: number): { width: number; height: number } {
  const w = Number(width);
  const h = Number(height);
  return {
    width: Math.min(
      TEXT_MODULE_MAX_W,
      Math.max(TEXT_MODULE_DEFAULT_W, Number.isFinite(w) && w > 0 ? w : TEXT_MODULE_DEFAULT_W),
    ),
    height: Math.min(
      TEXT_MODULE_MAX_H,
      Math.max(TEXT_MODULE_DEFAULT_H, Number.isFinite(h) && h > 0 ? h : TEXT_MODULE_DEFAULT_H),
    ),
  };
}

export function needsModuleSizeScaleUpgrade(
  data: { moduleSizeScaleVersion?: unknown } | null | undefined,
): boolean {
  const v = Number(data?.moduleSizeScaleVersion);
  return !Number.isFinite(v) || v < MODULE_SIZE_SCALE_VERSION;
}
