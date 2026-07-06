/** RVC 翻唱输出：带伴奏混音 / 仅转换后人声 */
export type RvcCoverOutputMode = 'with_accompaniment' | 'vocals_only';

export function normalizeRvcCoverOutputMode(value: unknown): RvcCoverOutputMode {
  return value === 'vocals_only' ? 'vocals_only' : 'with_accompaniment';
}

/** RVC 翻唱音调（半音） */
export function clampCoverPitch(value: unknown): number {
  const n = Math.round(Number(value) || 0);
  return Math.max(-12, Math.min(12, n));
}

/** RVC index 检索占比 0~1 */
export function clampCoverIndexRate(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.75;
  return Math.round(Math.max(0, Math.min(1, n)) * 100) / 100;
}

/** 混音人声音量百分比（0~300，100=不变；0=不输出人声轨） */
export function clampCoverVocalMixPct(value: unknown): number {
  const n = Math.round(Number(value) || 100);
  return Math.max(0, Math.min(300, n));
}

/** 混音伴奏音量百分比（0~300，100=不变；0=纯人声效果） */
export function clampCoverAccompanimentMixPct(value: unknown): number {
  const n = Math.round(Number(value) || 100);
  return Math.max(0, Math.min(300, n));
}

/** 兼容旧「纯人声」输出模式：未单独调伴奏滑条时映射为 0% */
export function resolveCoverAccompanimentMixPct(mixPct: unknown, legacyOutputMode?: unknown): number {
  const clamped = clampCoverAccompanimentMixPct(mixPct);
  if (legacyOutputMode === 'vocals_only' && (mixPct == null || mixPct === '' || Number(mixPct) === 100)) {
    return 0;
  }
  return clamped;
}

/** 训练/连线昵称 → RH RVC 翻唱 model_name（ComfyUI models/RVC 相对路径） */
import { isRhRvcPresetModelPath } from './rhRvcPresetModels.js';

/** 音色库条目中的训练参考音 URL（local-resource / http） */
export function resolveRvcVoiceTrainAudioUrl(item?: {
  trainAudioUrl?: string;
  localTrainAudioPath?: string;
  originalTrainAudioUrl?: string;
} | null): string {
  const lp = (item?.localTrainAudioPath || '').trim();
  if (lp) {
    let normalized = lp.replace(/\\/g, '/');
    if (/^\/[a-zA-Z]:/.test(normalized)) normalized = normalized.substring(1);
    return `local-resource://${normalized}`;
  }
  const u = (item?.trainAudioUrl || '').trim();
  if (u) return u;
  return (item?.originalTrainAudioUrl || '').trim();
}

/** 音色库条目中的模型包 URL（local-resource / http） */
export function resolveRvcVoiceModelPackageUrl(item?: {
  modelPackageUrl?: string;
  localModelPath?: string;
  originalModelUrl?: string;
} | null): string {
  const lp = (item?.localModelPath || '').trim();
  if (lp) {
    let normalized = lp.replace(/\\/g, '/');
    if (/^\/[a-zA-Z]:/.test(normalized)) normalized = normalized.substring(1);
    return `local-resource://${normalized}`;
  }
  const u = (item?.modelPackageUrl || '').trim();
  if (u) return u;
  return (item?.originalModelUrl || '').trim();
}

const INVALID_RVC_COVER_NAMES = new Set([
  'audio',
  '翻唱',
  'rvc翻唱',
  'rvc 翻唱',
  '声音节点',
  'rvctrain',
  'rvc train',
  'ai cover',
]);

export function deriveRvcCoverModelPath(modelName: string): string {
  const n = (modelName || '').trim();
  if (!n || INVALID_RVC_COVER_NAMES.has(n.toLowerCase())) return '';
  if (/^https?:\/\//i.test(n)) return '';
  if (/\.zip(\?|$)/i.test(n)) return '';
  if (/\.pth(\?|$)/i.test(n)) {
    if (n.includes('/')) return n;
    const base = n.replace(/\.pth(\?.*)?$/i, '').trim();
    return base ? `${base}/${base}.pth` : '';
  }
  if (n.includes('/')) return n;
  return `${n}/${n}.pth`;
}

/** 面板手动填写的 model_name：拒绝 URL / zip / 无效占位名 */
export function normalizeExplicitRvcCoverModelPath(explicit: string): string {
  const v = (explicit || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return '';
  if (v.startsWith('local-resource://') || v.startsWith('file://')) return '';
  if (/\.zip(\?|$)/i.test(v)) return '';
  const firstSeg = v.split('/')[0]?.trim().toLowerCase() ?? '';
  if (firstSeg && INVALID_RVC_COVER_NAMES.has(firstSeg)) return '';
  if (INVALID_RVC_COVER_NAMES.has(v.toLowerCase())) return '';
  return v;
}

export function isRvcCoverPathHintOnly(value: string): boolean {
  const v = (value || '').trim();
  if (!v) return false;
  if (v.startsWith('http://') || v.startsWith('https://')) return false;
  if (v.startsWith('local-resource://') || v.startsWith('file://')) return false;
  if (/\.zip(\?|$)/i.test(v)) return false;
  return true;
}

/**
 * RVC 翻唱统一走本地推理（Demucs + RVC + 伴奏混回），不再使用 RH 翻唱 API。
 */
export function shouldUseLegacyReferenceCover(_data?: unknown): boolean {
  return false;
}

/** @deprecated RH 云端翻唱已废弃，保留供历史兼容 */
export function buildRhRvcCoverModelNodeField(modelPath: string): {
  nodeId: string;
  fieldName: string;
  fieldValue: string;
  description: string;
} {
  const path = (modelPath || '').trim();
  return {
    nodeId: '1',
    fieldName: 'model_name',
    fieldValue: path,
    description: 'model_name',
  };
}
