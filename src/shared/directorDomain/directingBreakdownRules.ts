/**
 * 导演拆戏规则库：约束时长、口型、镜头语言、表演、轴线。
 * LLM 只提供判断；本模块负责不可违反的硬规则。
 */

import type {
  DramaAxisStatus,
  DramaDirectingBeat,
  DramaEmotionTrend,
  DramaShotCastMember,
} from './types.js';
import {
  applyLockedCameraToBeatFields,
  decideLockedCamera,
  inferDramaPrimaryPurpose,
} from './directorCameraSchema.js';
import { expandVisiblePerformance } from './visiblePerformance.js';

export type DramaLensPreset = '24' | '35' | '50' | '85' | '135';

export type DramaCameraLanguage = {
  shotType: string;
  camera: string;
  lens: DramaLensPreset;
  composition: string;
  movement: string;
};

export function expandDramaPerformance(emotion: string, action: string): string {
  return expandVisiblePerformance(emotion, action);
}

export function inferDramaEmotionTrend(prevIntensity: number, nextIntensity: number): DramaEmotionTrend {
  if (nextIntensity >= prevIntensity + 2) return 'rise';
  if (nextIntensity <= prevIntensity - 2) return 'fall';
  return 'hold';
}

export function clampDramaEmotionIntensity(n: number): number {
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(10, Math.round(n)));
}

function estimateDirectingDialogueSeconds(text: string): number {
  const chars = String(text || '').replace(/\s+/g, '').length;
  if (!chars) return 0;
  return Math.max(1.4, chars / 4 + 0.5);
}

export function chooseDramaCameraLanguage(input: {
  purpose: string;
  emotion: string;
  emotionIntensity: number;
  hasDialogue: boolean;
  action: string;
  preferredShotType?: string;
  preferredMovement?: string;
}): DramaCameraLanguage {
  const purpose = inferDramaPrimaryPurpose({
    purpose: input.purpose,
    action: input.action,
    emotion: input.emotion,
    hasDialogue: input.hasDialogue,
    index: 0,
    total: 1,
  });
  const cam = decideLockedCamera({
    purpose,
    emotionIntensity: input.emotionIntensity,
  });
  const fields = applyLockedCameraToBeatFields(cam);
  return {
    shotType: fields.shotType,
    camera: fields.camera,
    lens: String(cam.lensMm) as DramaLensPreset,
    composition: fields.composition,
    movement: fields.movement,
  };
}

export function lensLabel(lens: DramaLensPreset | string): string {
  const n = String(lens).replace(/mm$/i, '');
  return `${n}mm`;
}

export function cameraActionLine(lang: DramaCameraLanguage): string {
  return lang.camera;
}

export function inferDramaAxisStatus(
  prevCast: DramaShotCastMember[] | undefined,
  curCast: DramaShotCastMember[] | undefined,
  action: string,
): { status: DramaAxisStatus; note: string } {
  const chaos = /混乱|战斗|打斗|失控|精神/.test(action || '');
  const side = (list?: DramaShotCastMember[]) => {
    const map = new Map<string, string>();
    for (const c of list || []) {
      const pos = String(c.screen_position || '').trim();
      if (/left|左/.test(pos)) map.set(c.character_id, 'L');
      else if (/right|右/.test(pos)) map.set(c.character_id, 'R');
    }
    return map;
  };
  const a = side(prevCast);
  const b = side(curCast);
  let flipped = 0;
  for (const [id, pos] of a) {
    const next = b.get(id);
    if (next && next !== pos) flipped += 1;
  }
  if (a.size + b.size < 2) return { status: 'n/a', note: '不足双人轴线信息' };
  if (flipped >= 2) {
    return chaos
      ? { status: 'cross', note: '故意越轴：混乱/战斗' }
      : { status: 'cross', note: '疑似无理由越轴' };
  }
  return { status: 'hold', note: '保持左右关系' };
}

export function lipSyncAllowed(dialogue: string, dialogueCharacterId: string): boolean {
  return !!(String(dialogue || '').trim() && String(dialogueCharacterId || '').trim());
}

export type DramaAudioAnchor = { text: string; start: number; end: number };

function beatWeight(
  b: Pick<DramaDirectingBeat, 'dialogue' | 'dialogueCharacterId' | 'purpose' | 'event'>,
): number {
  const dlg = String(b.dialogue || '').trim();
  if (dlg && b.dialogueCharacterId) return Math.max(estimateDirectingDialogueSeconds(dlg) + 0.8, 2);
  if (/发现|反应|惊恐|爆发/.test(`${b.purpose} ${b.event}`)) return 1.6;
  if (/铺垫|建立|环境/.test(`${b.purpose} ${b.event}`)) return 1.3;
  return 1;
}

function matchAudioAnchor(
  dialogue: string,
  anchors: DramaAudioAnchor[] | undefined,
  durationSec: number,
  used: Set<number>,
): DramaAudioAnchor | null {
  const dlg = String(dialogue || '').trim();
  if (!dlg || !anchors?.length) return null;
  const key = dlg.slice(0, 10);
  for (let i = 0; i < anchors.length; i += 1) {
    if (used.has(i)) continue;
    const a = anchors[i];
    const span = Math.max(0, a.end - a.start);
    if (span < 0.4 || span >= durationSec * 0.9) continue;
    const text = String(a.text || '').trim();
    if (!text) continue;
    if (text.includes(key) || dlg.includes(text.slice(0, 10))) {
      used.add(i);
      return a;
    }
  }
  return null;
}

/** 对白是硬锚点：先锁对白窗（含音频时间），再把反应/发现拍塞进剩余时间，禁止平均切。 */
export function allocateBeatWindows(
  durationSec: number,
  beats: Array<Pick<DramaDirectingBeat, 'dialogue' | 'dialogueCharacterId' | 'duration' | 'purpose' | 'event'>>,
  audioAnchors?: DramaAudioAnchor[],
): Array<{ start: number; end: number }> {
  const dur = Math.max(0.5, Number(durationSec) || 10);
  const n = beats.length;
  if (!n) return [{ start: 0, end: dur }];

  const used = new Set<number>();
  const locks = beats.map((b) => {
    const a = matchAudioAnchor(String(b.dialogue || ''), audioAnchors, dur, used);
    if (!a) return null;
    return { start: round1(Math.max(0, a.start)), end: round1(Math.min(dur, Math.max(a.start + 0.4, a.end))) };
  });
  const hasLock = locks.some(Boolean);

  if (!hasLock) {
    const weights = beats.map(beatWeight);
    const sum = weights.reduce((a, b) => a + b, 0) || n;
    const out: Array<{ start: number; end: number }> = [];
    let t = 0;
    for (let i = 0; i < n; i += 1) {
      const slice = i === n - 1 ? dur - t : (weights[i] / sum) * dur;
      const end = i === n - 1 ? dur : Math.min(dur, t + Math.max(0.4, slice));
      out.push({ start: round1(t), end: round1(Math.max(t + 0.4, end)) });
      t = out[i].end;
    }
    if (out.length) out[out.length - 1].end = round1(dur);
    return out;
  }

  const out: Array<{ start: number; end: number }> = new Array(n);
  let i = 0;
  let t = 0;
  while (i < n) {
    if (locks[i]) {
      const lock = locks[i]!;
      const start = round1(Math.max(t, lock.start));
      const end = round1(Math.max(start + 0.4, lock.end));
      out[i] = { start, end };
      t = end;
      i += 1;
      continue;
    }
    let j = i;
    while (j < n && !locks[j]) j += 1;
    const gapEnd = j < n && locks[j] ? locks[j]!.start : dur;
    const span = Math.max(0.4 * (j - i), gapEnd - t);
    const group = beats.slice(i, j);
    const weights = group.map(beatWeight);
    const sum = weights.reduce((a, b) => a + b, 0) || group.length;
    let cursor = t;
    for (let k = 0; k < group.length; k += 1) {
      const last = k === group.length - 1;
      const slice = last ? t + span - cursor : (weights[k] / sum) * span;
      const end = round1(Math.min(gapEnd, cursor + Math.max(0.4, slice)));
      out[i + k] = { start: round1(cursor), end: Math.max(round1(cursor + 0.4), end) };
      cursor = out[i + k].end;
    }
    t = cursor;
    i = j;
  }
  if (out.length) out[out.length - 1].end = round1(dur);
  return out;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
