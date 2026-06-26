/**
 * 模型元宝计费与前端消耗提示（与 pricing/model_yuanbao_rates.mjs 对齐）
 */

export type ConsumeTier = 'low' | 'medium' | 'high';

export type ModelYuanbaoRate = {
  yuanbao: number;
  tier: ConsumeTier;
  label?: string;
};

export const YUANBAO_PER_CNY = 10;

export const MODEL_YUANBAO_RATES: Record<string, ModelYuanbaoRate> = {
  'gpt-3.5-turbo': { yuanbao: 1, tier: 'low', label: 'GPT-3.5' },
  'gpt-4o': { yuanbao: 2, tier: 'low', label: 'GPT-4o' },
  'gpt-4o-mini': { yuanbao: 1, tier: 'low' },
  'image-reverse': { yuanbao: 2, tier: 'low', label: '图像反推' },
  'text-to-image-basic': { yuanbao: 4, tier: 'medium', label: '文生图' },
  'mj-stylize': { yuanbao: 8, tier: 'medium', label: 'MJ风格化' },
  'hd-edit': { yuanbao: 8, tier: 'medium', label: '高清改图' },
  'video-5s': { yuanbao: 20, tier: 'high', label: '5秒视频' },
  'video-10s': { yuanbao: 40, tier: 'high', label: '10秒视频' },
  'video-15s': { yuanbao: 80, tier: 'high', label: '15秒视频' },
  'video-4k': { yuanbao: 100, tier: 'high', label: '4K视频' },
  'tts-basic': { yuanbao: 5, tier: 'medium', label: 'TTS配音' },
  'music-gen': { yuanbao: 15, tier: 'medium', label: '音乐生成' },
  'image-to-3d': { yuanbao: 20, tier: 'high', label: '3D转换' },
};

export function yuanbaoToCnyApprox(yuanbao: number): number {
  const n = Number(yuanbao);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round((n / YUANBAO_PER_CNY) * 100) / 100;
}

export function resolveModelYuanbao(modelId: string, fallback = 5): ModelYuanbaoRate {
  const key = String(modelId ?? '').trim().toLowerCase();
  const row = MODEL_YUANBAO_RATES[key];
  if (row) return row;
  for (const [k, v] of Object.entries(MODEL_YUANBAO_RATES)) {
    if (key.includes(k)) return v;
  }
  return { yuanbao: fallback, tier: 'medium', label: modelId };
}

export function formatConsumeHint(yuanbao: number, locale: 'zh' | 'en' = 'zh'): string {
  const n = Math.max(0, Math.round(Number(yuanbao) || 0));
  const cny = yuanbaoToCnyApprox(n);
  if (locale === 'en') return `Cost: ${n} Yuanbao (~¥${cny})`;
  return `本次消耗：${n}元宝（约${cny}元）`;
}

export function consumeTierLabel(tier: ConsumeTier, locale: 'zh' | 'en' = 'zh'): string {
  if (locale === 'en') return tier === 'low' ? 'Low' : tier === 'high' ? 'High' : 'Medium';
  return tier === 'low' ? '低消耗' : tier === 'high' ? '高消耗' : '中消耗';
}

/** 余额是否足够 */
export function hasEnoughYuanbao(balance: number, cost: number): boolean {
  return Number(balance) >= Math.max(0, Math.round(Number(cost) || 0));
}
