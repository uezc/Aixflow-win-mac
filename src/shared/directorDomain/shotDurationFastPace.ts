/**
 * 短剧快节奏时长估算
 * —— 多信号加权 + 分层计算，替换旧「对白 n÷4 / 动作 n÷8」字数算法。
 *
 * 公式出处（产品规格）：
 * - 对白 base = 有效中文字数 ÷ 4.5（短剧念白约 4.5~5 字/秒）
 * - 动作 base = 事件句数 × 节奏 unit + 特效数 × 1.0 + 景别数 × 0.3
 * - 开场 ×0.7；落档 6/10/15；场景累计 >20s 拆场次续
 */

import type { DramaOriginalSegment, DramaOriginalSegmentType } from './types.js';

// ================= 顶层配置（调参只改这里） =================

export const DRAMA_FAST_PACE_DURATION_CONFIG = {
  /** 短剧念白语速：字/秒 */
  dialogueCharsPerSec: 4.5,
  /** 情绪停顿：单次命中加时 / 整段封顶 */
  emotionPauseSec: 0.3,
  emotionPauseCapSec: 1.0,
  /** 动作节奏 unit（秒/事件） */
  actionUnitFastSec: 0.8,
  actionUnitMidSec: 1.2,
  actionUnitSlowSec: 2.0,
  /** 特效 / 运镜附加 */
  fxBonusSec: 1.0,
  shotMoveBonusSec: 0.3,
  /** 纯环境空镜封顶 */
  emptyEnvCapSec: 1.5,
  /** 转场 */
  cutHardSec: 1.2,
  cutFadeSec: 2.0,
  /** 开场压缩 */
  sceneStartFactor: 0.7,
  /** 3 秒信息点：连续两段合计 > 此值且中间无高潮 → 压缩系数 */
  infoPointPairSec: 6,
  infoPointCompress: 0.75,
  /** 单段 clamp */
  segmentMinSec: 1.5,
  segmentMaxSec: 15,
  /** 场景打包：优先 15，硬上限 15（与时长拆镜一致，不再并到 20） */
  packPreferSec: 15,
  packCapSec: 15,
  /** 时长拆镜：档位容差（估时不准，允许 ±35%；15 秒档可收到约 20 秒） */
  tierTolerance: 0.35,
  /** 切出来不足这么多字（去空白）则不拆 */
  splitMinChars: 25,
  /** 校准滑动窗口 */
  calibrateWindow: 10,
} as const;

export type DramaFastPaceDurationConfig = typeof DRAMA_FAST_PACE_DURATION_CONFIG;

// ================= 关键词词典 =================

export const DRAMA_FAST_PACE_EMOTION_WORDS = [
  '停顿',
  '沉默',
  '哽咽',
  '颤抖',
  '长叹',
  '深吸',
  '低语',
  '怒吼',
  '怔住',
  '呆住',
  '愣住',
  '缓缓',
] as const;

export const DRAMA_FAST_PACE_ACTION_FAST_WORDS = [
  '扑',
  '冲',
  '斩',
  '踢',
  '闪',
  '追',
  '爆',
  '裂',
  '飞',
  '撞',
  '杀',
  '刺',
  '劈',
  '砍',
] as const;

export const DRAMA_FAST_PACE_ACTION_SLOW_WORDS = [
  '缓慢',
  '慢慢',
  '凝视',
  '缓缓',
  '俯视',
  '静',
] as const;

export const DRAMA_FAST_PACE_ACTION_SLOW_MARKERS = [
  '慢动作',
  '升格',
  '大场面',
  '特写',
] as const;

export const DRAMA_FAST_PACE_CLIMAX_WORDS = [
  '怒',
  '吼',
  '杀',
  '爆',
  '斩',
  '死',
  '血',
  '哭',
  '喊',
  '啊',
  '！',
] as const;

// ================= 输入 / 输出类型 =================

export type DramaFastPaceSegmentKind =
  | 'dialogue'
  | 'system'
  | 'narration'
  | 'action'
  | 'visual'
  | 'transition';

export interface DramaFastPaceSegmentInput {
  type: DramaFastPaceSegmentKind | string;
  text: string;
  parenthetical?: string;
  fx?: string[];
  shots?: string[];
  isSceneStart?: boolean;
  /** 说话人；有值才按「同一人物」粘连，空则只按时长切 */
  speakerKey?: string;
  /** 说话人提示行 / 对白 / 演技指示：与同一人物对白视为一句没说完 */
  speechCarry?: boolean;
}

export interface DramaFastPaceSegmentEstimate {
  estSec: number;
  reason: string;
  /** 未乘校准系数前的原始估算 */
  rawSec: number;
}

export interface DramaFastPaceSceneEstimate {
  totalSec: number;
  tierSec: number;
  split: boolean;
  /** 拆场时各包的结束下标（不含），相对本场片段 */
  splitEnds: number[];
  packs: { start: number; end: number; totalSec: number; tierSec: number }[];
  segments: DramaFastPaceSegmentEstimate[];
}

// ================= 纯工具 =================

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function countCjkChars(text: string): number {
  const m = String(text || '').match(/[\u4e00-\u9fff]/g);
  return m ? m.length : 0;
}

function countHits(text: string, words: readonly string[]): number {
  const s = String(text || '');
  let n = 0;
  for (const w of words) {
    if (!w) continue;
    let from = 0;
    while (from < s.length) {
      const i = s.indexOf(w, from);
      if (i < 0) break;
      n += 1;
      from = i + w.length;
    }
  }
  return n;
}

function hasAny(text: string, words: readonly string[]): boolean {
  const s = String(text || '');
  return words.some((w) => w && s.includes(w));
}

/** 按句号/感叹号/分号/破折号切分动作事件 */
export function splitActionEvents(text: string): string[] {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const parts = raw
    .split(/[。！？!?；;]+|(?:——|–|—)/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts : [raw];
}

export function extractFxTagsFromText(text: string): string[] {
  const s = String(text || '');
  const out: string[] = [];
  const re = /【\s*特效\s*[：:]\s*([^】]+)】/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const name = String(m[1] || '').trim();
    if (name) out.push(name);
  }
  return out;
}

export function mapOriginalSegmentKind(type: DramaOriginalSegmentType | string): DramaFastPaceSegmentKind {
  const t = String(type || '').trim();
  if (t === 'dialogue' || t === '对白') return 'dialogue';
  if (t === 'system' || t === '系统') return 'system';
  if (t === 'narration' || t === '旁白') return 'narration';
  if (t === 'transition' || t === '转场') return 'transition';
  if (t === 'action' || t === '动作' || t === 'montage' || t === '蒙太奇') return 'action';
  if (t === '画面' || t === 'visual' || t === 'screen_text' || t === 'stage_direction' || t === 'performance_direction') {
    return 'visual';
  }
  return 'action';
}

function originalSegmentSpeechCarry(seg: DramaOriginalSegment): boolean {
  const t = String(seg.type || '').trim();
  if (
    t === 'dialogue' ||
    t === '对白' ||
    t === 'system' ||
    t === '系统' ||
    t === 'narration' ||
    t === '旁白' ||
    t === 'performance_direction' ||
    t === 'other'
  ) {
    return true;
  }
  const st = String(seg.speaker_type || '').trim();
  if (st !== 'character' && st !== 'system' && st !== 'narration') return false;
  return t !== 'action' && t !== 'montage' && t !== 'transition' && t !== 'screen_text' && t !== 'visual';
}

export function originalSegmentToFastPaceInput(
  seg: DramaOriginalSegment,
  opts?: { isSceneStart?: boolean; shots?: string[] },
): DramaFastPaceSegmentInput {
  const text = String(seg.original_text || '');
  const fx = extractFxTagsFromText(text);
  const speechCarry = originalSegmentSpeechCarry(seg);
  const speakerKey = speechCarry ? String(seg.character_name || '').trim() : '';
  return {
    type: mapOriginalSegmentKind(seg.type),
    text,
    parenthetical: String(seg.performance || '').trim() || undefined,
    fx: fx.length ? fx : undefined,
    shots: opts?.shots,
    isSceneStart: opts?.isSceneStart === true,
    ...(speakerKey ? { speakerKey } : {}),
    ...(speechCarry ? { speechCarry: true } : {}),
  };
}

// ================= 校准闭环（滑动 10 条） =================

const calibratePairs: { est: number; real: number }[] = [];

export function recordDramaFastPaceCalibration(estSec: number, realSec: number): void {
  const e = Number(estSec);
  const r = Number(realSec);
  if (!(e > 0) || !(r > 0)) return;
  calibratePairs.push({ est: e, real: r });
  const win = DRAMA_FAST_PACE_DURATION_CONFIG.calibrateWindow;
  while (calibratePairs.length > win) calibratePairs.shift();
}

export function getDramaFastPaceCalibrationCoeff(): number {
  if (!calibratePairs.length) return 1;
  const ratios = calibratePairs.map((p) => p.real / p.est).filter((x) => Number.isFinite(x) && x > 0);
  if (!ratios.length) return 1;
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  return clamp(mean, 0.6, 1.5);
}

export function resetDramaFastPaceCalibration(): void {
  calibratePairs.length = 0;
}

// ================= 单段估算 =================

/** 对白估时（字数÷4.5 + 情绪停顿）。未 clamp；供 Timeline 保底。 */
export function estimateDramaTalkSec(
  text: string,
  parenthetical?: string,
  cfg: DramaFastPaceDurationConfig = DRAMA_FAST_PACE_DURATION_CONFIG,
): number {
  return estimateTalkSec(
    { type: 'dialogue', text: String(text || ''), parenthetical },
    cfg,
  ).sec;
}

function estimateTalkSec(
  seg: DramaFastPaceSegmentInput,
  cfg: DramaFastPaceDurationConfig,
): { sec: number; reason: string } {
  const blob = `${seg.text || ''}${seg.parenthetical ? ` ${seg.parenthetical}` : ''}`;
  const chars = countCjkChars(blob) || Math.max(1, String(seg.text || '').replace(/\s+/g, '').length);
  // 对白 base = 有效中文字数 ÷ 4.5
  let sec = chars / cfg.dialogueCharsPerSec;
  const emotionHits = countHits(blob, DRAMA_FAST_PACE_EMOTION_WORDS);
  const emotionAdd = Math.min(cfg.emotionPauseCapSec, emotionHits * cfg.emotionPauseSec);
  sec += emotionAdd;
  // 省略号不额外加时；短对白连击由场景层处理
  const reasons = [`对白${chars}字÷${cfg.dialogueCharsPerSec}`];
  if (emotionAdd > 0) reasons.push(`情绪+${round1(emotionAdd)}s`);
  return { sec, reason: reasons.join('，') };
}

function estimateActionSec(
  seg: DramaFastPaceSegmentInput,
  cfg: DramaFastPaceDurationConfig,
): { sec: number; reason: string } {
  const text = String(seg.text || '');
  const fx = [...(seg.fx || []), ...extractFxTagsFromText(text)];
  const shots = seg.shots || [];
  const events = splitActionEvents(text);
  const eventCount = Math.max(1, events.length);
  const joined = `${text} ${fx.join(' ')}`;

  let unit: number = cfg.actionUnitMidSec;
  let rhythm: '快' | '中' | '慢' = '中';
  if (hasAny(joined, DRAMA_FAST_PACE_ACTION_SLOW_WORDS) || hasAny(joined, DRAMA_FAST_PACE_ACTION_SLOW_MARKERS)) {
    unit = cfg.actionUnitSlowSec;
    rhythm = '慢';
  } else if (hasAny(joined, DRAMA_FAST_PACE_ACTION_FAST_WORDS)) {
    unit = cfg.actionUnitFastSec;
    rhythm = '快';
  }

  // base = events × unit + fx × 1.0
  let sec = eventCount * unit + fx.length * cfg.fxBonusSec;
  // 运镜附加
  sec += shots.length * cfg.shotMoveBonusSec;

  // 纯环境段：无快动作词、无特效、无对白引号 → 压到 emptyEnvCapSec（短剧不拖空镜）
  const isPureEnv =
    !fx.length &&
    !hasAny(text, DRAMA_FAST_PACE_ACTION_FAST_WORDS) &&
    !hasAny(joined, DRAMA_FAST_PACE_ACTION_SLOW_MARKERS) &&
    !/[「」『』]/.test(text);
  if (isPureEnv) {
    sec = Math.min(sec, cfg.emptyEnvCapSec);
  }

  // 特效段爽点至少约 3s（验收）
  if (fx.length && sec < 3) sec = 3;

  const reasons = [`${eventCount}事件×${unit}s(${rhythm})`];
  if (fx.length) reasons.push(`特效${fx.length}×${cfg.fxBonusSec}`);
  if (shots.length) reasons.push(`景别${shots.length}×${cfg.shotMoveBonusSec}`);
  return { sec, reason: reasons.join('，') };
}

function estimateTransitionSec(
  seg: DramaFastPaceSegmentInput,
  cfg: DramaFastPaceDurationConfig,
): { sec: number; reason: string } {
  const t = String(seg.text || '');
  if (/淡入|淡出|FADE/i.test(t)) {
    return { sec: cfg.cutFadeSec, reason: `淡入淡出 ${cfg.cutFadeSec}s` };
  }
  return { sec: cfg.cutHardSec, reason: `硬切 ${cfg.cutHardSec}s` };
}

/**
 * 单段快节奏估算（纯函数，不含校准）。
 * 返回值已 clamp 到 [segmentMinSec, segmentMaxSec]。
 */
export function estimateDramaFastPaceSegment(
  seg: DramaFastPaceSegmentInput,
  cfg: DramaFastPaceDurationConfig = DRAMA_FAST_PACE_DURATION_CONFIG,
): DramaFastPaceSegmentEstimate {
  const kind = mapOriginalSegmentKind(String(seg.type || 'action'));
  let raw: { sec: number; reason: string };
  if (kind === 'dialogue' || kind === 'system' || kind === 'narration') {
    raw = estimateTalkSec(seg, cfg);
  } else if (kind === 'transition') {
    raw = estimateTransitionSec(seg, cfg);
  } else {
    raw = estimateActionSec(seg, cfg);
  }

  let sec = raw.sec;
  if (seg.isSceneStart) {
    sec *= cfg.sceneStartFactor;
    raw = { sec, reason: `${raw.reason}，开场×${cfg.sceneStartFactor}` };
  }

  // 转场允许硬切 1.2s（低于通用下限）；其它段 clamp 到 [min, max]
  const lo = kind === 'transition' ? Math.min(cfg.cutHardSec, cfg.segmentMinSec) : cfg.segmentMinSec;
  const clamped = round1(clamp(sec, lo, cfg.segmentMaxSec));
  const coeff = getDramaFastPaceCalibrationCoeff();
  const estSec = round1(clamp(clamped * coeff, lo, cfg.segmentMaxSec));
  const reason =
    coeff !== 1
      ? `${raw.reason} → ${clamped}s×校准${round1(coeff)}=${estSec}s`
      : `${raw.reason} → ${estSec}s`;
  return { estSec, rawSec: clamped, reason };
}

/** 批量估算片段（含「3 秒信息点」相邻压缩） */
export function estimateDramaFastPaceSegments(
  segments: DramaFastPaceSegmentInput[],
  cfg: DramaFastPaceDurationConfig = DRAMA_FAST_PACE_DURATION_CONFIG,
): DramaFastPaceSegmentEstimate[] {
  const out = (segments || []).map((s) => estimateDramaFastPaceSegment(s, cfg));
  for (let i = 0; i + 1 < out.length; i += 1) {
    const a = segments[i];
    const b = segments[i + 1];
    const sum = out[i].estSec + out[i + 1].estSec;
    if (sum <= cfg.infoPointPairSec) continue;
    const climax =
      hasAny(`${a.text}${a.parenthetical || ''}`, DRAMA_FAST_PACE_CLIMAX_WORDS) ||
      hasAny(`${b.text}${b.parenthetical || ''}`, DRAMA_FAST_PACE_CLIMAX_WORDS) ||
      hasAny(a.text || '', DRAMA_FAST_PACE_ACTION_FAST_WORDS) ||
      hasAny(b.text || '', DRAMA_FAST_PACE_ACTION_FAST_WORDS) ||
      (a.fx && a.fx.length > 0) ||
      (b.fx && b.fx.length > 0);
    if (climax) continue;
    // 连续两段偏长且无高潮 → 压缩（短剧 3 秒信息点）
    out[i] = {
      ...out[i],
      estSec: round1(clamp(out[i].estSec * cfg.infoPointCompress, cfg.segmentMinSec, cfg.segmentMaxSec)),
      reason: `${out[i].reason}；信息点压缩`,
    };
    out[i + 1] = {
      ...out[i + 1],
      estSec: round1(clamp(out[i + 1].estSec * cfg.infoPointCompress, cfg.segmentMinSec, cfg.segmentMaxSec)),
      reason: `${out[i + 1].reason}；信息点压缩`,
    };
  }
  return out;
}

// ================= 落档 / 场景打包 =================

/** MiniMax 成片可用档含 20；时长拆镜主档只用 6 / 10 / 15（一段按 15 秒拆） */
export const DRAMA_DURATION_SPLIT_TIERS = [6, 10, 15] as const;

function durationSplitTolerance(
  cfg: DramaFastPaceDurationConfig = DRAMA_FAST_PACE_DURATION_CONFIG,
): number {
  return Number(cfg.tierTolerance) || 0.35;
}

/** 时长拆镜单镜最大档（15 秒一段）；是否拆开看 ±35% 上限。 */
export const DRAMA_DURATION_SPLIT_MAX_SEC = 15;

function durationSplitMaxSec(): number {
  return DRAMA_DURATION_SPLIT_MAX_SEC;
}

/** 单镜可不拆的估时上限：15 × (1+35%) ≈ 20.25。约 20 秒仍落 15 档。 */
export function durationSplitHardCapSec(
  cfg: DramaFastPaceDurationConfig = DRAMA_FAST_PACE_DURATION_CONFIG,
): number {
  return round1(durationSplitMaxSec() * (1 + durationSplitTolerance(cfg)));
}

/**
 * 时长拆镜落档：在 ±35% 误差内取最接近的 6/10/15 档。
 * 例：8.5→10，13→15，18→15，20→15（不再落 20 档）。
 */
export function snapDramaDurationSplitTierSec(
  est: number,
  cfg: DramaFastPaceDurationConfig = DRAMA_FAST_PACE_DURATION_CONFIG,
): number {
  const n = Math.max(0.1, Number(est) || 0);
  const tol = durationSplitTolerance(cfg);
  let best: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const t of DRAMA_DURATION_SPLIT_TIERS) {
    const dist = Math.abs(n - t);
    if (dist / t > tol + 1e-9) continue;
    if (dist < bestDist - 1e-9) {
      best = t;
      bestDist = dist;
    }
  }
  if (best != null) return best;
  let nearest = DRAMA_DURATION_SPLIT_MAX_SEC;
  let nearestDist = Number.POSITIVE_INFINITY;
  for (const t of DRAMA_DURATION_SPLIT_TIERS) {
    const dist = Math.abs(n - t);
    if (dist < nearestDist - 1e-9) {
      nearest = t;
      nearestDist = dist;
    }
  }
  return nearest;
}

/**
 * 把一场的估时拆成 6/10/15 档：只有超出最大档 +35% 才拆。
 * 18 → [15]；22 → [15, 6]；35 → [15, 15]。
 */
export function splitDramaEstSecIntoTiers(
  totalSec: number,
  cfg: DramaFastPaceDurationConfig = DRAMA_FAST_PACE_DURATION_CONFIG,
): number[] {
  const cap = durationSplitMaxSec();
  const hard = durationSplitHardCapSec(cfg);
  let left = round1(Math.max(0, Number(totalSec) || 0));
  const out: number[] = [];
  while (left > hard + 1e-6) {
    out.push(cap);
    left = round1(left - cap);
  }
  if (left > 1e-6) out.push(snapDramaDurationSplitTierSec(left, cfg));
  return out.length ? out : [6];
}

type DurationSplitPack = { start: number; end: number; totalSec: number; tierSec: number };

function durationSplitMinChars(
  cfg: DramaFastPaceDurationConfig = DRAMA_FAST_PACE_DURATION_CONFIG,
): number {
  const n = Number(cfg.splitMinChars);
  return Number.isFinite(n) && n > 0 ? n : 25;
}

/** 拆镜计字：去空白后的字数（25 字门槛用这个） */
export function countDramaDurationSplitChars(text: string): number {
  return String(text || '').replace(/\s+/g, '').length;
}

function durationSplitPackCharCount(
  segments: DramaFastPaceSegmentInput[],
  start: number,
  end: number,
): number {
  let n = 0;
  for (let i = start; i < end; i += 1) {
    const seg = segments[i];
    if (!seg) continue;
    n += countDramaDurationSplitChars(seg.text);
    n += countDramaDurationSplitChars(seg.parenthetical || '');
  }
  return n;
}

function durationSplitSpeakerKey(seg: DramaFastPaceSegmentInput | undefined): string {
  return String(seg?.speakerKey || '').trim();
}

function durationSplitIsTalk(seg: DramaFastPaceSegmentInput | undefined): boolean {
  if (!seg) return false;
  const kind = mapOriginalSegmentKind(String(seg.type || ''));
  return kind === 'dialogue' || kind === 'system' || kind === 'narration';
}

function durationSplitIsSpeechCarry(seg: DramaFastPaceSegmentInput | undefined): boolean {
  if (!seg) return false;
  if (seg.speechCarry === true) return true;
  if (seg.speechCarry === false) return false;
  return durationSplitIsTalk(seg);
}

/** 对白未说完：冒号、省略号、破折号、逗号收尾，或引号未闭合 */
export function isDramaDurationSplitSpeechUnfinished(text: string): boolean {
  const t = String(text || '').replace(/\s+/g, '').trim();
  if (!t) return false;
  if (/[：:]$/.test(t)) return true;
  if (/[…─—–－～]+$/.test(t)) return true;
  if (/\.{2,}$/.test(t)) return true;
  if (/[，、,]$/.test(t)) return true;
  const leftQ = (t.match(/[「『]/g) || []).length;
  const rightQ = (t.match(/[」』]/g) || []).length;
  return leftQ > rightQ;
}

function durationSplitEndsWithColon(seg: DramaFastPaceSegmentInput | undefined): boolean {
  if (!seg) return false;
  const t = durationSplitTalkText(seg).replace(/\s+/g, '').trim();
  return /[：:]$/.test(t);
}

function durationSplitTalkText(seg: DramaFastPaceSegmentInput): string {
  return `${seg.text || ''}${seg.parenthetical ? seg.parenthetical : ''}`;
}

function lastDurationSplitTalkIndex(
  segments: DramaFastPaceSegmentInput[],
  start: number,
  end: number,
): number {
  for (let i = end - 1; i >= start; i -= 1) {
    if (durationSplitIsTalk(segments[i]) && durationSplitSpeakerKey(segments[i])) return i;
  }
  return -1;
}

function firstDurationSplitTalkIndex(
  segments: DramaFastPaceSegmentInput[],
  start: number,
  end: number,
): number {
  for (let i = start; i < end; i += 1) {
    if (durationSplitIsTalk(segments[i]) && durationSplitSpeakerKey(segments[i])) return i;
  }
  return -1;
}

function findDurationSplitSpeechRunStart(
  segments: DramaFastPaceSegmentInput[],
  index: number,
  packStart: number,
  rangeEnd: number,
): number {
  let s = index;
  while (s > packStart && isIllegalDramaDurationSplitCut(segments, s, packStart, rangeEnd)) {
    s -= 1;
  }
  return s;
}

function isSameSpeakerSpeechCarry(
  a: DramaFastPaceSegmentInput | undefined,
  b: DramaFastPaceSegmentInput | undefined,
): boolean {
  const sa = durationSplitSpeakerKey(a);
  const sb = durationSplitSpeakerKey(b);
  if (!sa || !sb || sa !== sb) return false;
  return durationSplitIsSpeechCarry(a) && durationSplitIsSpeechCarry(b);
}

/**
 * 不能在 cutIndex 前切开：同一人物连续说话，冒号收尾，或上一句没说完。
 */
export function isIllegalDramaDurationSplitCut(
  segments: DramaFastPaceSegmentInput[],
  cutIndex: number,
  packStart = 0,
  rangeEnd = segments.length,
): boolean {
  if (cutIndex <= packStart || cutIndex >= rangeEnd) return true;
  if (isSameSpeakerSpeechCarry(segments[cutIndex - 1], segments[cutIndex])) return true;
  if (durationSplitEndsWithColon(segments[cutIndex - 1])) return true;
  const leftTalk = lastDurationSplitTalkIndex(segments, packStart, cutIndex);
  const rightTalk = firstDurationSplitTalkIndex(segments, cutIndex, rangeEnd);
  if (leftTalk < 0 || rightTalk < 0) return false;
  const left = segments[leftTalk];
  const right = segments[rightTalk];
  if (durationSplitSpeakerKey(left) !== durationSplitSpeakerKey(right)) return false;
  return isDramaDurationSplitSpeechUnfinished(durationSplitTalkText(left));
}

function makeDurationSplitPack(
  start: number,
  end: number,
  estimates: { estSec: number }[],
  cfg: DramaFastPaceDurationConfig,
): DurationSplitPack {
  const totalSec = round1(estimates.slice(start, end).reduce((n, s) => n + s.estSec, 0));
  return {
    start,
    end,
    totalSec,
    tierSec: snapDramaDurationSplitTierSec(totalSec, cfg),
  };
}

function coalesceDurationSplitPacks(
  packs: DurationSplitPack[],
  segments: DramaFastPaceSegmentInput[],
  estimates: { estSec: number }[],
  cfg: DramaFastPaceDurationConfig,
): DurationSplitPack[] {
  const minChars = durationSplitMinChars(cfg);
  let out = packs.filter((p) => p.end > p.start);
  const mergeAt = (i: number) => {
    const a = out[i];
    const b = out[i + 1];
    if (!a || !b) return;
    out = [...out.slice(0, i), makeDurationSplitPack(a.start, b.end, estimates, cfg), ...out.slice(i + 2)];
  };
  let guard = 0;
  while (out.length >= 2 && guard < 80) {
    guard += 1;
    let hit = -1;
    for (let i = 0; i < out.length; i += 1) {
      const chars = durationSplitPackCharCount(segments, out[i].start, out[i].end);
      if (chars < minChars) {
        hit = i;
        break;
      }
    }
    if (hit >= 0) {
      if (hit === 0) mergeAt(0);
      else mergeAt(hit - 1);
      continue;
    }
    let speechHit = -1;
    for (let i = 0; i < out.length - 1; i += 1) {
      if (isIllegalDramaDurationSplitCut(segments, out[i + 1].start, out[i].start, out[i + 1].end)) {
        speechHit = i;
        break;
      }
    }
    if (speechHit >= 0) {
      mergeAt(speechHit);
      continue;
    }
    break;
  }
  return out;
}

/** 多段包估时仍超过 15×1.35 时，按累计秒在合法段边界再切开。 */
function explodeOversizeDurationPacks(
  packs: DurationSplitPack[],
  estimates: { estSec: number }[],
  segments: DramaFastPaceSegmentInput[],
  cfg: DramaFastPaceDurationConfig,
): DurationSplitPack[] {
  const cap = durationSplitHardCapSec(cfg);
  const out: DurationSplitPack[] = [];
  const walk = (p: DurationSplitPack) => {
    if (p.end <= p.start) return;
    const tooBig = p.totalSec > cap + 1e-6 && p.end - p.start > 1;
    if (!tooBig) {
      out.push({ ...p, tierSec: snapDramaDurationSplitTierSec(p.totalSec, cfg) });
      return;
    }
    let acc = 0;
    let start = p.start;
    let cutAny = false;
    for (let i = p.start; i < p.end; i += 1) {
      const d = estimates[i].estSec;
      const nextWould = acc + d;
      if (acc > 0 && nextWould > cap + 1e-9) {
        let cut = i;
        if (isIllegalDramaDurationSplitCut(segments, i, start, p.end)) {
          cut = findDurationSplitSpeechRunStart(segments, i, start, p.end);
        }
        if (cut > start && !isIllegalDramaDurationSplitCut(segments, cut, start, p.end)) {
          walk(makeDurationSplitPack(start, cut, estimates, cfg));
          start = cut;
          acc = estimates.slice(cut, i + 1).reduce((n, s) => n + s.estSec, 0);
          cutAny = true;
          continue;
        }
      }
      acc = nextWould;
    }
    if (!cutAny) {
      out.push({ ...p, tierSec: snapDramaDurationSplitTierSec(p.totalSec, cfg) });
      return;
    }
    walk(makeDurationSplitPack(start, p.end, estimates, cfg));
  };
  for (const p of packs) walk(p);
  return out;
}

/**
 * 按时长档打包：估时落在档位 ±35% 内不拆（约 20 秒仍是 15 档）。
 * 只有超过 15×1.35 才拆；切出来不足 25 字、或同一人物话没说完，不拆。
 */
export function packDramaFastPaceByDurationTiers(
  segments: DramaFastPaceSegmentInput[],
  cfg: DramaFastPaceDurationConfig = DRAMA_FAST_PACE_DURATION_CONFIG,
): DramaFastPaceSceneEstimate {
  const estimates = estimateDramaFastPaceSegments(segments, cfg);
  if (!estimates.length) {
    return { totalSec: 0, tierSec: 6, split: false, splitEnds: [], packs: [], segments: [] };
  }

  const cap = durationSplitHardCapSec(cfg);
  const raw: DurationSplitPack[] = [];
  let start = 0;
  let acc = 0;

  const flush = (end: number) => {
    if (end <= start) return;
    raw.push(makeDurationSplitPack(start, end, estimates, cfg));
    start = end;
    acc = 0;
  };

  for (let i = 0; i < estimates.length; i += 1) {
    const d = estimates[i].estSec;
    const nextWould = acc + d;
    if (acc > 0 && nextWould > cap + 1e-9) {
      let cut = i;
      if (isIllegalDramaDurationSplitCut(segments, i, start, estimates.length)) {
        cut = findDurationSplitSpeechRunStart(segments, i, start, estimates.length);
      }
      if (cut > start && !isIllegalDramaDurationSplitCut(segments, cut, start, estimates.length)) {
        flush(cut);
        acc = estimates.slice(cut, i + 1).reduce((n, s) => n + s.estSec, 0);
        continue;
      }
    }
    acc = nextWould;
  }
  flush(estimates.length);

  const exploded = explodeOversizeDurationPacks(raw, estimates, segments, cfg);
  const packs = coalesceDurationSplitPacks(exploded, segments, estimates, cfg);
  const totalSec = round1(estimates.reduce((n, s) => n + s.estSec, 0));
  return {
    totalSec,
    tierSec: snapDramaDurationSplitTierSec(Math.min(totalSec, cap), cfg),
    split: packs.length > 1,
    splitEnds: packs.map((p) => p.end),
    packs,
    segments: estimates,
  };
}

/** 短剧落档：≤6→6，≤10→10，否则→15（去掉 20 主档） */
export function snapDramaFastPaceTierSec(est: number): number {
  const n = Math.max(0.1, Number(est) || 0);
  if (n <= 6) return 6;
  if (n <= 10) return 10;
  return 15;
}

/**
 * 场景累计打包：优先凑满 packPreferSec，硬上限 packCapSec。
 * 拆点优先落在对白/系统/旁白边界，不拆在动作段中间（尽量）。
 */
export function packDramaFastPaceScene(
  segments: DramaFastPaceSegmentInput[],
  cfg: DramaFastPaceDurationConfig = DRAMA_FAST_PACE_DURATION_CONFIG,
): DramaFastPaceSceneEstimate {
  const estimates = estimateDramaFastPaceSegments(segments, cfg);
  if (!estimates.length) {
    return { totalSec: 0, tierSec: 6, split: false, splitEnds: [], packs: [], segments: [] };
  }

  const packs: { start: number; end: number; totalSec: number; tierSec: number }[] = [];
  let start = 0;
  let acc = 0;

  const flush = (end: number) => {
    if (end <= start) return;
    const totalSec = round1(
      estimates.slice(start, end).reduce((n, s) => n + s.estSec, 0),
    );
    packs.push({
      start,
      end,
      totalSec,
      tierSec: snapDramaFastPaceTierSec(totalSec),
    });
    start = end;
    acc = 0;
  };

  for (let i = 0; i < estimates.length; i += 1) {
    const d = estimates[i].estSec;
    const kind = mapOriginalSegmentKind(String(segments[i]?.type || ''));
    const nextWould = acc + d;

    if (acc > 0 && nextWould > cfg.packCapSec) {
      // 超硬上限：优先在对白边界拆；若当前是动作且包内已有内容，先落在 i（不拆开本动作——本动作进下一包）
      if (kind === 'action' || kind === 'visual') {
        flush(i);
        acc = d;
      } else {
        // 对白等：可以在本段前切开，本段开新包
        flush(i);
        acc = d;
      }
      continue;
    }

    // 已超过 prefer 且下一段是对白类 → 可在 prefer 处收口
    if (acc >= cfg.packPreferSec && (kind === 'dialogue' || kind === 'system' || kind === 'narration' || kind === 'transition')) {
      flush(i);
      acc = d;
      continue;
    }

    acc = nextWould;
  }
  flush(estimates.length);

  const totalSec = round1(estimates.reduce((n, s) => n + s.estSec, 0));
  const split = packs.length > 1;
  return {
    totalSec,
    tierSec: snapDramaFastPaceTierSec(totalSec),
    split,
    splitEnds: packs.map((p) => p.end),
    packs,
    segments: estimates,
  };
}

/** 给 originalScript 用的单段秒数入口（含校准） */
export function estimateOriginalSegmentDurationSecFast(
  text: string,
  type: DramaOriginalSegmentType,
  opts?: { performance?: string; isSceneStart?: boolean },
): number {
  const est = estimateDramaFastPaceSegment({
    type: mapOriginalSegmentKind(type),
    text: String(text || ''),
    parenthetical: opts?.performance,
    isSceneStart: opts?.isSceneStart,
  });
  return est.estSec;
}

/*
 * ========== 如何接入现有「场景拆分」流程 ==========
 *
 * 1. 剧本拆分（analyze / shotSuggestionsFromOriginalAnalysis）
 *    - Narrative 硬切 → Shot Beat；超 H3 上限再软拆
 *    - 落档 6/10/15（±35%）；原文整段写入 action
 *    - duration_why 形如「叙事硬切 估 19.7s → 15秒档」
 *
 * 2. 时长拆镜（shotSuggestionsFromDurationSplit）
 *    - 估时落在档位 ±35% 内不拆（约 20 秒仍是 15 档）；超过 15×1.35 再拆（35→15+15）
 *    - 切出来不足 25 字不拆；同一人物话没说完（连续对白、冒号/省略号/破折号后接着说）不拆
 *    - 每包仍是整段原文
 *    - 规划主档为 15 秒一段，不再默认拆成 20 秒镜
 *
 * 3. 脚本设计之后如需再合并短镜
 *    - mergeDramaShotSuggestionsToDurationTiers
 *
 * 4. 单段估时
 *    - estimateDramaFastPaceSegment / estimateOriginalSegmentDurationSecFast
 *
 * 5. 成片校准（可选）
 *    - recordDramaFastPaceCalibration(S_est, S_real)；滑动 10 条
 *
 * 6. 调参
 *    - DRAMA_FAST_PACE_DURATION_CONFIG 与顶部词典
 *
 * 7. 自检
 *    - npx tsx src/shared/directorDomain/shotDurationFastPace.selftest.ts
 *    - npx tsx src/shared/directorDomain/p2NarrativeSplit.selftest.ts
 */

