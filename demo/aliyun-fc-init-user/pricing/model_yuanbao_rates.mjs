/**
 * 模型元宝扣费参考表（与 FC getFinalPrice 运营配置互补；未配置模型时回落到此表）
 * 所有 AI 调用统一扣「元宝」；1 元 ≈ 10 元宝
 */

export const YUANBAO_PER_CNY = 10;

/** @typedef {'low' | 'medium' | 'high'} ConsumeTier */

/** @type {Record<string, { yuanbao: number, tier: ConsumeTier, label?: string }>} */
export const MODEL_YUANBAO_RATES = Object.freeze({
  // 文本
  'gpt-3.5-turbo': { yuanbao: 1, tier: 'low', label: 'GPT-3.5' },
  'gpt-4o': { yuanbao: 2, tier: 'low', label: 'GPT-4o' },
  'gpt-4o-mini': { yuanbao: 1, tier: 'low' },
  'image-reverse': { yuanbao: 2, tier: 'low', label: '图像反推' },
  // 图像
  'text-to-image-basic': { yuanbao: 4, tier: 'medium', label: '文生图' },
  'mj-stylize': { yuanbao: 8, tier: 'medium', label: 'MJ风格化' },
  'hd-edit': { yuanbao: 8, tier: 'medium', label: '高清改图' },
  // 视频
  'video-5s': { yuanbao: 20, tier: 'high', label: '5秒视频' },
  'video-10s': { yuanbao: 40, tier: 'high', label: '10秒视频' },
  'video-15s': { yuanbao: 80, tier: 'high', label: '15秒视频' },
  'video-4k': { yuanbao: 100, tier: 'high', label: '4K视频' },
  // 音频 / 3D
  'tts-basic': { yuanbao: 5, tier: 'medium', label: 'TTS配音' },
  'music-gen': { yuanbao: 15, tier: 'medium', label: '音乐生成' },
  'image-to-3d': { yuanbao: 20, tier: 'high', label: '3D转换' },
});

/** @param {number} yuanbao */
export function yuanbaoToCnyApprox(yuanbao) {
  const n = Number(yuanbao);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round((n / YUANBAO_PER_CNY) * 100) / 100;
}

/**
 * @param {string} modelId
 * @param {number} [fallback=5]
 */
export function resolveModelYuanbao(modelId, fallback = 5) {
  const key = String(modelId ?? '').trim().toLowerCase();
  const row = MODEL_YUANBAO_RATES[key];
  if (row) return row;
  for (const [k, v] of Object.entries(MODEL_YUANBAO_RATES)) {
    if (key.includes(k)) return v;
  }
  return { yuanbao: fallback, tier: 'medium', label: modelId };
}

/**
 * @param {number} yuanbao
 * @param {'zh'|'en'} [locale='zh']
 */
export function formatConsumeHint(yuanbao, locale = 'zh') {
  const n = Math.max(0, Math.round(Number(yuanbao) || 0));
  const cny = yuanbaoToCnyApprox(n);
  if (locale === 'en') {
    return `Cost: ${n} Yuanbao (~¥${cny})`;
  }
  return `本次消耗：${n}元宝（约${cny}元）`;
}

/** @param {ConsumeTier} tier @param {'zh'|'en'} [locale='zh'] */
export function consumeTierLabel(tier, locale = 'zh') {
  if (locale === 'en') {
    return tier === 'low' ? 'Low' : tier === 'high' ? 'High' : 'Medium';
  }
  return tier === 'low' ? '低消耗' : tier === 'high' ? '高消耗' : '中消耗';
}
