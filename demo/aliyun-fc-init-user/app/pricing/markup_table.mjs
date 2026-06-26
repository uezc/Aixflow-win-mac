/**
 * 加价/毛利率配置（相对 cost_table 基准价的乘数）
 * 默认 1.0 = 与当前产品内标价一致；运营可调 category 或单模型覆盖。
 */

/** 大类默认乘数 */
export const MARKUP_DEFAULT_BY_CATEGORY = {
  image: 1,
  video: 1,
  audio: 1,
  reverse: 1,
  llm: 1,
  cloudYuanbao: 1,
};

/**
 * 按模型 ID 覆盖（可选）
 * @type {Record<string, number>}
 */
export const MARKUP_OVERRIDE_BY_MODEL_ID = {
  // 示例：'sora-2': 1.1,
};

/**
 * @param {'image'|'video'|'audio'|'reverse'|'llm'|'cloudYuanbao'} category
 * @param {string} [modelId]
 * @returns {number}
 */
export function getMarkupMultiplier(category, modelId) {
  if (modelId && Object.prototype.hasOwnProperty.call(MARKUP_OVERRIDE_BY_MODEL_ID, modelId)) {
    return MARKUP_OVERRIDE_BY_MODEL_ID[modelId];
  }
  return MARKUP_DEFAULT_BY_CATEGORY[category] ?? 1;
}

/**
 * @param {number} baseCost
 * @param {'image'|'video'|'audio'|'reverse'|'llm'|'cloudYuanbao'} category
 * @param {string} [modelId]
 * @returns {number}
 */
export function applyMarkup(baseCost, category, modelId) {
  if (baseCost == null || Number.isNaN(baseCost)) return baseCost;
  return baseCost * getMarkupMultiplier(category, modelId);
}
