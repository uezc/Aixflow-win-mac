/**
 * Shot duration allocation engine (pure functions).
 * Inputs: size / action / dialogue / emotion_play.
 */

import type { DramaShotSuggestion } from './types.js';

export type ShotDurationPaceStyle = 'standard' | 'fast' | 'slow';

export type ShotDurationEngineInput = {
  size?: string;
  action?: string;
  dialogue?: string;
  emotion_play?: string;
  duration_locked?: boolean;
  user_sec?: number | null;
};

export type ShotDurationBand = {
  ai_suggested: number;
  suggested: number;
  min_sec: number;
  max_sec: number;
  reason: string;
  out_of_band: boolean;
};

export type FitShotDurationBudgetOptions = {
  paceStyle?: ShotDurationPaceStyle | string;
  totalCapSec?: number | null;
};

export const SHOT_DURATION_EXPORT_TIERS = [6, 10, 15, 20] as const;

export const SIZE_BASE: ReadonlyArray<{ key: string; mid: number; half: number }> = [
  { key: '\u5927\u7279\u5199', mid: 2.2, half: 0.4 },
  { key: '\u7279\u5199', mid: 2.5, half: 0.5 },
  { key: '\u8fd1\u666f', mid: 3.2, half: 0.6 },
  { key: '\u4e2d\u8fd1\u666f', mid: 4.0, half: 0.8 },
  { key: '\u4e2d\u666f', mid: 5.0, half: 1.0 },
  { key: '\u5168\u666f', mid: 6.0, half: 1.5 },
  { key: '\u8fdc\u666f', mid: 7.0, half: 1.5 },
  { key: '\u5927\u8fdc\u666f', mid: 7.5, half: 1.5 },
];

export const ACTION_COST: ReadonlyArray<{ verb: string; cost: number }> = [
  { verb: '\u6df1\u8e29\u6cb9\u95e8', cost: 1.2 },
  { verb: '\u8e29\u6cb9\u95e8', cost: 1.0 },
  { verb: '\u6025\u505c', cost: 1.2 },
  { verb: '\u5239\u8f66', cost: 1.0 },
  { verb: '\u62cd\u6253', cost: 0.8 },
  { verb: '\u63a8\u95e8', cost: 1.2 },
  { verb: '\u5f00\u95e8', cost: 1.5 },
  { verb: '\u6572\u95e8', cost: 1.0 },
  { verb: '\u5954\u8dd1', cost: 1.5 },
  { verb: '\u8d70\u8def', cost: 2.0 },
  { verb: '\u70b9\u70df', cost: 2.0 },
  { verb: '\u6478\u70df', cost: 1.0 },
  { verb: '\u63e1\u65b9\u5411\u76d8', cost: 0.6 },
  { verb: '\u770b\u624b\u673a', cost: 1.2 },
  { verb: '\u70b9\u5f00', cost: 0.8 },
  { verb: '\u7184\u706d', cost: 0.5 },
  { verb: '\u558a', cost: 1.0 },
];

const TENSE_SHORTEN = /\u6781\u5ea6\u7d27\u5f20|\u6025\u4fc3|\u614c\u4e71|\u7206\u53d1|\u51b2\u523a|\u731b\u5730/;
const SUSPENSE_LENGTHEN = /\u538b\u6291|\u60ac\u7591|\u4f4e\u6c14\u538b|\u6050\u60e7|\u6127\u95f7|\u72b9\u8c6b|\u6c89\u9ed8/;

export const CHARS_PER_SEC = 3.3;
export const PERF_PADDING = 1.2;
export const INTERVAL_RATIO = 0.18;
export const MIN_SHOT_SEC = 1.5;
export const MAX_SHOT_SEC = 12.0;

const PACE_FACTOR: Record<ShotDurationPaceStyle, number> = {
  standard: 1.0,
  fast: 0.82,
  slow: 1.18,
};

export function normalizeShotDurationPaceStyle(raw: unknown): ShotDurationPaceStyle {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'fast' || s === '\u5feb' || s === '\u5feb\u8282\u594f' || s === '\u52a8\u4f5c') return 'fast';
  if (s === 'slow' || s === '\u6162' || s === '\u6162\u8282\u594f' || s === '\u60ac\u7591') return 'slow';
  return 'standard';
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function clampShotDurationSec(n: number, lo = MIN_SHOT_SEC, hi = MAX_SHOT_SEC): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function stripSpokenSubtext(dialogue: string): string {
  return String(dialogue || '')
    .replace(/\u3010\u6f5c\u53f0\u8bcd[:\uff1a]?[^\u3011]*\u3011/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function sizeBase(size: string): { mid: number; half: number } {
  const s = String(size || '');
  for (const row of SIZE_BASE) {
    if (s.includes(row.key)) return { mid: row.mid, half: row.half };
  }
  return { mid: 4.0, half: 0.8 };
}

export function actionSeconds(action: string): number {
  const a = String(action || '');
  const hits: number[] = [];
  for (const { verb, cost } of ACTION_COST) {
    if (a.includes(verb)) hits.push(cost);
  }
  if (!hits.length) {
    const verbs = (a.match(/\u731b|\u6025|\u8e29|\u62cd|\u63a8|\u8d70|\u770b|\u63e1|\u6478|\u6572|\u558a/g) || []).length;
    return Math.min(4.0, 1.0 + 0.7 * verbs);
  }
  let base = Math.max(...hits);
  if (/[+\uff0b]|\u7136\u540e|\u63a5\u7740|\u540c\u65f6/.test(a)) base *= 1.4;
  return base;
}

export function dialogueSeconds(dialogue: string): number {
  const text = stripSpokenSubtext(dialogue);
  const chars = (text.match(/[\u4e00-\u9fffA-Za-z0-9]/g) || []).length;
  if (!chars) return 0;
  return (chars / CHARS_PER_SEC) * PERF_PADDING;
}

export function emotionFactor(emotion: string): number {
  const e = String(emotion || '');
  let f = 1.0;
  if (TENSE_SHORTEN.test(e)) f *= 0.85;
  if (SUSPENSE_LENGTHEN.test(e)) f *= 1.15;
  return f;
}

export function paceFactor(style: ShotDurationPaceStyle | unknown): number {
  return PACE_FACTOR[normalizeShotDurationPaceStyle(style)];
}

export function computeShotDurationBand(
  shot: ShotDurationEngineInput,
  paceStyle: ShotDurationPaceStyle | unknown = 'standard',
): ShotDurationBand {
  const { mid, half } = sizeBase(shot.size || '');
  const a = actionSeconds(shot.action || '');
  const d = dialogueSeconds(shot.dialogue || '');
  const raw = clampShotDurationSec(
    Math.max(mid, a, d) * emotionFactor(shot.emotion_play || '') * paceFactor(paceStyle),
  );
  const band = Math.max(half, raw * INTERVAL_RATIO);
  const min_sec = round1(clampShotDurationSec(raw - band));
  const max_sec = round1(clampShotDurationSec(raw + band));
  const ai_suggested = round1(raw);
  const user =
    shot.user_sec != null && Number.isFinite(Number(shot.user_sec)) && Number(shot.user_sec) > 0
      ? round1(Number(shot.user_sec))
      : null;
  const suggested = user != null ? user : ai_suggested;
  const out_of_band = suggested < min_sec || suggested > max_sec;
  const reason =
    '\u666f\u522b' + mid.toFixed(1) + 's / \u52a8\u4f5c' + a.toFixed(1) + 's / \u53f0\u8bcd' + d.toFixed(1) +
    's \u2192 max\u540e\u00d7\u60c5\u7eea\u00d7\u8282\u594f=' + ai_suggested.toFixed(1) + 's';
  return { ai_suggested, suggested, min_sec, max_sec, reason, out_of_band };
}

export function fitShotDurationBudget(
  shots: ShotDurationEngineInput[],
  opts?: FitShotDurationBudgetOptions,
): ShotDurationBand[] {
  const pace = normalizeShotDurationPaceStyle(opts?.paceStyle);
  const outs = (shots || []).map((s) => computeShotDurationBand(s, pace));
  const cap =
    opts?.totalCapSec != null && Number.isFinite(Number(opts.totalCapSec)) && Number(opts.totalCapSec) > 0
      ? Number(opts.totalCapSec)
      : null;
  if (cap == null || !outs.length) return outs;
  const freeIdx: number[] = [];
  let lockedSum = 0;
  let freeSum = 0;
  for (let i = 0; i < shots.length; i += 1) {
    if (shots[i]?.duration_locked) {
      lockedSum += outs[i].suggested;
    } else {
      freeIdx.push(i);
      freeSum += outs[i].suggested;
    }
  }
  const remain = Math.max(0, cap - lockedSum);
  if (freeSum <= 0 || freeSum <= remain + 1e-6) return outs;
  const scale = remain / freeSum;
  for (const i of freeIdx) {
    const next = round1(Math.max(outs[i].min_sec, outs[i].suggested * scale));
    outs[i] = {
      ...outs[i],
      suggested: next,
      reason: outs[i].reason + '\uff1b\u603b\u65f6\u957f\u538b\u7f29\u00d7' + scale.toFixed(2) + '\u2192' + next.toFixed(1) + 's',
      out_of_band: next < outs[i].min_sec || next > outs[i].max_sec,
    };
  }
  return outs;
}

export function snapToTier(
  sec: number,
  tiers: readonly number[] = SHOT_DURATION_EXPORT_TIERS,
): number {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0 || !tiers.length) return tiers[0] ?? 6;
  let best = tiers[0];
  let bestDist = Math.abs(best - n);
  for (let i = 1; i < tiers.length; i += 1) {
    const t = tiers[i];
    const d = Math.abs(t - n);
    if (d < bestDist || (d === bestDist && t >= n)) {
      best = t;
      bestDist = d;
    }
  }
  return best;
}

export function shotSuggestionToDurationInput(
  s: Pick<DramaShotSuggestion, 'size' | 'action' | 'dialogue' | 'emotion_play' | 'duration_sec' | 'duration_locked'>,
  opts?: { preferStoredAsUser?: boolean },
): ShotDurationEngineInput {
  return {
    size: s.size,
    action: s.action,
    dialogue: s.dialogue,
    emotion_play: s.emotion_play,
    duration_locked: !!s.duration_locked,
    user_sec: opts?.preferStoredAsUser && Number(s.duration_sec) > 0 ? Number(s.duration_sec) : null,
  };
}

export function applyDurationBandToSuggestion(
  shot: DramaShotSuggestion,
  band: ShotDurationBand,
): DramaShotSuggestion {
  const locked = !!shot.duration_locked;
  const kept =
    locked && Number(shot.duration_sec) > 0 ? round1(Number(shot.duration_sec)) : band.suggested;
  return {
    ...shot,
    duration_ai: band.ai_suggested,
    duration_min: band.min_sec,
    duration_max: band.max_sec,
    duration_why: band.reason,
    duration_sec: kept,
  };
}

export function suggestionsNeedDurationInit(suggestions: DramaShotSuggestion[]): boolean {
  const list = suggestions || [];
  if (!list.length) return false;
  return list.some(
    (s) => !(Number(s.duration_min) > 0) || !(Number(s.duration_max) > 0) || !(Number(s.duration_ai) > 0),
  );
}

export function finalizeShotSuggestionDurations(
  suggestions: DramaShotSuggestion[],
  opts?: FitShotDurationBudgetOptions & { previous?: DramaShotSuggestion[] },
): DramaShotSuggestion[] {
  const list = [...(suggestions || [])];
  const prev = opts?.previous || [];
  const sameStructure =
    prev.length === list.length &&
    list.every((s, i) => String(s.shot || '') === String(prev[i]?.shot || ''));
  let merged = list;
  if (sameStructure && prev.length) {
    merged = list.map((s, i) => {
      const p = prev[i];
      return {
        ...s,
        duration_sec: Number(p.duration_sec) > 0 ? Number(p.duration_sec) : s.duration_sec,
        duration_min: p.duration_min ?? s.duration_min,
        duration_max: p.duration_max ?? s.duration_max,
        duration_ai: p.duration_ai ?? s.duration_ai,
        duration_locked: p.duration_locked ?? s.duration_locked,
        duration_why: p.duration_why || s.duration_why,
      };
    });
  }
  if (!sameStructure || suggestionsNeedDurationInit(merged)) {
    return recalculateShotSuggestionDurations(merged, {
      paceStyle: opts?.paceStyle,
      totalCapSec: opts?.totalCapSec,
    });
  }
  return merged;
}

export function recalculateShotSuggestionDurations(
  suggestions: DramaShotSuggestion[],
  opts?: FitShotDurationBudgetOptions,
): DramaShotSuggestion[] {
  const list = suggestions || [];
  const inputs: ShotDurationEngineInput[] = list.map((s) => ({
    size: s.size,
    action: s.action,
    dialogue: s.dialogue,
    emotion_play: s.emotion_play,
    duration_locked: !!s.duration_locked,
    user_sec: s.duration_locked && Number(s.duration_sec) > 0 ? Number(s.duration_sec) : null,
  }));
  const bands = fitShotDurationBudget(inputs, opts);
  return list.map((s, i) =>
    applyDurationBandToSuggestion(s, bands[i] || computeShotDurationBand(s, opts?.paceStyle)),
  );
}
