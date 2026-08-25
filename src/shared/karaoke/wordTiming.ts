/**
 * 句级/LRC → 字级时间轴。
 * - 有 fun-asr words：按真实字/词节奏映射到用户歌词单元
 * - 否则：行内按字数比例匀速插值（唱腔快慢不均时会「滑字」）
 */

import {
  isDirectorInstrumentalLyricText,
  isDirectorNonLyricMetaText,
  isLyricFillerParticleOnlyText,
  normalizeDirectorMvLyricSegments,
  parseLrcToLyricSegments,
  splitUserLyricLines,
  type DirectorMvLyricSegment,
} from '../directorPipeline/lyricTimeline.js';
import {
  annotateKaraokeLinesRoles,
  displayKaraokeRoleMarker,
  isKaraokeRoleMarker,
  normalizeKaraokeRoleMarkersInText,
  parseKaraokeRoleMarker,
  splitKaraokeUnitsKeepingRoles,
  stripKaraokeRoleMarkers,
  weaveKaraokeRoleChars,
} from './roleMarkers.js';
import type {
  KaraokeAsrWordTiming,
  KaraokeCharTiming,
  KaraokeLine,
  KaraokeProject,
  KaraokeTimingSource,
} from './types.js';

function clampSec(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function newLineId(i: number): string {
  return `kl-${i}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 是否为带时间戳的 LRC 文本 */
export function looksLikeLrc(raw: string): boolean {
  return /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/.test(String(raw || ''));
}

/**
 * 拆成卡拉OK「字」单元：CJK/标点逐字，拉丁字母按词（词末可带空格）；
 * `(男)` / `男：` / `女:` / `合：` 等角色标记为原子单元（括号/冒号全半角兼容；
 * 规范为半角括号形 `(男)` 或全角冒号形 `男：`）。
 */

export function splitKaraokeUnits(text: string): string[] {
  return splitKaraokeUnitsKeepingRoles(text);
}

/** 仅唱词单元内按长度比例插值（不含角色标记） */
function interpolateSingableUnits(
  units: string[],
  startSec: number,
  endSec: number,
): KaraokeCharTiming[] {
  const start = clampSec(startSec);
  const end = Math.max(start + 0.05, clampSec(endSec));
  if (units.length === 0) return [];
  const weights = units.map((u) => Math.max(1, Array.from(u.replace(/\s/g, '')).length || 1));
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;
  const span = end - start;
  const chars: KaraokeCharTiming[] = [];
  let cursor = start;
  for (let i = 0; i < units.length; i++) {
    const share = weights[i] / totalW;
    const dur = i === units.length - 1 ? end - cursor : Math.max(0.04, span * share);
    const s = cursor;
    const e = i === units.length - 1 ? end : Math.min(end, cursor + dur);
    chars.push({ text: units[i], startSec: s, endSec: Math.max(s + 0.03, e) });
    cursor = e;
  }
  return chars;
}

/** 行内按「单元长度」比例插值字级时间（无 ASR 字级时的回退）；角色标记不占 wipe 时长 */
export function interpolateCharsInLine(
  text: string,
  startSec: number,
  endSec: number,
): KaraokeCharTiming[] {
  const start = clampSec(startSec);
  const end = Math.max(start + 0.05, clampSec(endSec));
  const units = splitKaraokeUnits(text);
  if (units.length === 0) return [];
  const singableUnits = units.filter((u) => !isKaraokeRoleMarker(u));
  if (singableUnits.length === 0) {
    return weaveKaraokeRoleChars(units, [], null).chars.map((c) => ({
      ...c,
      startSec: start,
      endSec: start,
    }));
  }
  const timed = interpolateSingableUnits(singableUnits, start, end);
  return weaveKaraokeRoleChars(units, timed, null).chars;
}

function normalizeAsrWords(raw: unknown): KaraokeAsrWordTiming[] {
  if (!Array.isArray(raw)) return [];
  const out: KaraokeAsrWordTiming[] = [];
  for (const w of raw) {
    if (!w || typeof w !== 'object') continue;
    const o = w as Record<string, unknown>;
    const text = String(o.text || '').trim();
    if (!text) continue;
    const startSec = clampSec(Number(o.startSec));
    const endSec = clampSec(Number(o.endSec));
    out.push({
      text,
      startSec,
      endSec: endSec >= startSec ? endSec : startSec,
    });
  }
  return out.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
}

/** 从句级 segments[].words 展平字级锚点 */
export function flattenAsrWordsFromSegments(
  segments: Array<{ words?: KaraokeAsrWordTiming[] | null } | null | undefined>,
): KaraokeAsrWordTiming[] {
  const out: KaraokeAsrWordTiming[] = [];
  for (const s of segments || []) {
    if (!s?.words?.length) continue;
    out.push(...normalizeAsrWords(s.words));
  }
  return out.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
}

/**
 * 将 ASR 词展开为原子 timed 单元（多字词在词窗内再插值）。
 * 尽量保留 ASR 原始起止；仅在明显越出行窗外时轻裁，避免压扁 duration。
 */
function expandWordsToAnchors(
  words: KaraokeAsrWordTiming[],
  lineStart: number,
  lineEnd: number,
): KaraokeCharTiming[] {
  const anchors: KaraokeCharTiming[] = [];
  const softLo = lineStart - 0.12;
  const softHi = lineEnd + 0.12;
  for (const w of words) {
    const wt = String(w.text || '').trim();
    if (!wt) continue;
    const ws = clampSec(w.startSec);
    const we = Math.max(ws + 0.03, clampSec(w.endSec));
    const units = splitKaraokeUnits(wt);
    if (units.length === 0) continue;
    if (units.length === 1) {
      const s = Math.max(softLo, Math.min(softHi, ws));
      const e = Math.max(s + 0.03, Math.min(softHi, we));
      anchors.push({ text: units[0], startSec: s, endSec: e });
      continue;
    }
    for (const sub of interpolateCharsInLine(wt, ws, we)) {
      const s = Math.max(softLo, Math.min(softHi, sub.startSec));
      const e = Math.max(s + 0.03, Math.min(softHi, sub.endSec));
      anchors.push({ text: sub.text, startSec: s, endSec: e });
    }
  }
  return anchors.filter((a) => a.endSec > a.startSec + 0.01);
}

function enforceMonotonicChars(
  chars: KaraokeCharTiming[],
  lineStart: number,
  lineEnd: number,
): KaraokeCharTiming[] {
  if (!chars.length) return chars;
  // 角色标记零时长：不参与单调/最短 wipe 约束，处理完再按原序插回
  const meta = chars.map((c, i) => ({
    i,
    roleTag: !!(c.roleTag || isKaraokeRoleMarker(c.text)),
    ch: { ...c },
  }));
  const singableIdx = meta.filter((m) => !m.roleTag).map((m) => m.i);
  if (!singableIdx.length) return chars.map((c) => ({ ...c }));
  const out = singableIdx.map((i) => meta[i].ch);
  // 保留 ASR 真实起止：不把首字强行拉到 lineStart、末字强行撑到 lineEnd（那会压成「匀速感」）
  const lo = lineStart - 0.05;
  const hi = lineEnd + 0.05;
  for (let i = 0; i < out.length; i++) {
    out[i].startSec = Math.max(lo, Math.min(hi, out[i].startSec));
    out[i].endSec = Math.max(lo, Math.min(hi, out[i].endSec));
    if (out[i].endSec <= out[i].startSec) {
      out[i].endSec = out[i].startSec + 0.03;
    }
    if (i > 0 && out[i].startSec < out[i - 1].endSec) {
      // 轻微重叠：前移起点并尽量保留原 duration
      const dur = Math.max(0.03, out[i].endSec - out[i].startSec);
      out[i].startSec = out[i - 1].endSec;
      out[i].endSec = out[i].startSec + dur;
    }
  }
  const fixed = ensureMinCharWipeTiming(
    smoothCompressedCharRuns(out, lineStart, lineEnd),
    lineStart,
    lineEnd,
  );
  let si = 0;
  return meta.map((m) => {
    if (m.roleTag) {
      const t =
        si < fixed.length
          ? fixed[si].startSec
          : si > 0
            ? fixed[si - 1].endSec
            : Number(m.ch.startSec) || lineStart;
      const role = m.ch.role || parseKaraokeRoleMarker(m.ch.text) || undefined;
      return {
        ...m.ch,
        text: displayKaraokeRoleMarker(m.ch.text, role),
        roleTag: true,
        role,
        startSec: t,
        endSec: t,
      };
    }
    return fixed[si++];
  });
}

/**
 * 单字 wipe 过短时视觉会「一帧跳过多字」。
 * 0.12s ≈ 4 帧@30fps，低于此易被感知为跳字。
 */
export const MIN_CHAR_WIPE_SEC = 0.12;

/** 检测 chars 是否仍有重叠或一帧多字填满（供脚本验证）；忽略角色标记 */
export function karaokeCharsHaveWipeJumps(
  chars: KaraokeCharTiming[],
  minDurSec: number = MIN_CHAR_WIPE_SEC,
): boolean {
  const list = (chars || []).filter((c) => !c.roleTag && !isKaraokeRoleMarker(c.text));
  if (!list.length) return false;
  for (let i = 0; i < list.length; i++) {
    if (i > 0 && list[i].startSec < list[i - 1].endSec - 1e-6) return true;
  }
  // 有足够行窗时仍出现过短字
  const span =
    list.reduce((m, c) => Math.max(m, c.endSec), list[0].startSec) - list[0].startSec;
  if (span + 1e-6 >= list.length * minDurSec) {
    for (const c of list) {
      if (c.endSec - c.startSec < minDurSec - 1e-6) return true;
    }
  }
  // 一帧内多字同时填满
  const dt = 1 / 30;
  const t0 = list[0].startSec;
  const t1 = list.reduce((m, c) => Math.max(m, c.endSec), t0);
  for (let t = t0; t <= t1 + 1e-9; t += dt) {
    let filled = 0;
    for (const c of list) {
      if (c.endSec > t - dt && c.endSec <= t + 1e-12) filled += 1;
    }
    if (filled >= 2) return true;
  }
  return false;
}

/**
 * 按「密度」找连续过密段：均长 < MIN、含短字、或字间几乎无空隙。
 * 不再在「已达 MIN 的字」处截断（旧逻辑会留下两侧 0.03s 短字）。
 */
function smoothCompressedCharRuns(
  chars: KaraokeCharTiming[],
  lineStart: number,
  lineEnd: number,
): KaraokeCharTiming[] {
  if (chars.length < 2) return chars;
  const out = chars.map((c) => ({ ...c }));
  const minDur = MIN_CHAR_WIPE_SEC;
  let i = 0;
  while (i < out.length) {
    let j = i + 1;
    while (j < out.length) {
      const runStart = out[i].startSec;
      const runEnd = Math.max(runStart + 0.01, out[j].endSec);
      const n = j - i + 1;
      const avg = (runEnd - runStart) / n;
      const durJ = out[j].endSec - out[j].startSec;
      const gap = out[j].startSec - out[j - 1].endSec;
      const dense =
        avg < minDur * 0.92 ||
        durJ < minDur ||
        out[j - 1].endSec - out[j - 1].startSec < minDur ||
        gap < 0.02;
      // 大空隙且当前字已够长：结束本段
      if (!dense && gap >= 0.1 && durJ >= minDur) break;
      if (!dense && avg >= minDur && gap >= 0.06) break;
      j += 1;
    }
    // j 停在段外第一个下标
    const n = j - i;
    if (n >= 2) {
      const runStart = out[i].startSec;
      const runEnd = Math.max(runStart + 0.03, out[j - 1].endSec);
      const span = runEnd - runStart;
      const need = n * minDur;
      if (span < need - 1e-6 || span / n < minDur * 0.92) {
        // 向邻字借时：邻字最多压缩到 minDur
        let lo = i > 0 ? out[i - 1].endSec : lineStart;
        let hi = j < out.length ? out[j].startSec : lineEnd;
        if (i > 0) {
          const prev = out[i - 1];
          const prevFloor = prev.startSec + minDur;
          if (prev.endSec > prevFloor) {
            lo = Math.min(lo, Math.max(prevFloor, runStart - (need - span)));
          }
        }
        if (j < out.length) {
          const next = out[j];
          const nextCeil = next.endSec - minDur;
          if (next.startSec < nextCeil) {
            hi = Math.max(hi, Math.min(nextCeil, runEnd + (need - span)));
          }
        }
        lo = Math.max(lineStart, lo);
        hi = Math.min(lineEnd, Math.max(lo + 0.05, hi));
        const avail = Math.max(0.05, hi - lo);
        const use = Math.min(Math.max(need, span), avail);
        // 邻字同步收缩，给本段腾窗
        if (i > 0 && out[i - 1].endSec > lo) {
          out[i - 1].endSec = Math.max(out[i - 1].startSec + 0.03, lo);
        }
        if (j < out.length && out[j].startSec < lo + use) {
          out[j].startSec = Math.min(out[j].endSec - 0.03, lo + use);
        }
        let t0 = runStart;
        if (use > span + 1e-6) {
          const extra = use - span;
          const canBefore = Math.max(0, runStart - lo);
          const canAfter = Math.max(0, hi - runEnd);
          let takeBefore = Math.min(canBefore, extra / 2);
          let takeAfter = Math.min(canAfter, extra - takeBefore);
          if (takeBefore + takeAfter < extra - 1e-6) {
            const rest = extra - takeBefore - takeAfter;
            takeBefore += Math.min(canBefore - takeBefore, rest);
            takeAfter += Math.min(
              canAfter - takeAfter,
              Math.max(0, extra - takeBefore - takeAfter),
            );
          }
          t0 = runStart - takeBefore;
        } else {
          t0 = Math.max(lo, Math.min(runStart, hi - use));
        }
        // 按原 duration 权重分配，短字至少 minDur
        const raw = [];
        for (let k = 0; k < n; k++) {
          raw.push(Math.max(0.01, out[i + k].endSec - out[i + k].startSec));
        }
        const rawSum = raw.reduce((a, b) => a + b, 0) || 1;
        const base = n * Math.min(minDur, use / n);
        const rem = Math.max(0, use - base);
        let t = t0;
        for (let k = 0; k < n; k++) {
          const dur = Math.min(minDur, use / n) + (rem * raw[k]) / rawSum;
          out[i + k].startSec = t;
          out[i + k].endSec = t + Math.max(use / n, dur);
          t = out[i + k].endSec;
        }
        // 若累加越过 use，末字对齐
        if (n > 0 && Math.abs(out[i + n - 1].endSec - (t0 + use)) > 1e-4) {
          const scale = use / Math.max(0.01, out[i + n - 1].endSec - t0);
          let u = t0;
          for (let k = 0; k < n; k++) {
            const d = Math.max(0.01, (out[i + k].endSec - out[i + k].startSec) * scale);
            out[i + k].startSec = u;
            out[i + k].endSec = u + d;
            u = out[i + k].endSec;
          }
          out[i + n - 1].endSec = t0 + use;
        }
      }
    }
    i = Math.max(i + 1, j);
  }
  for (let k = 1; k < out.length; k++) {
    if (out[k].startSec < out[k - 1].endSec) {
      const dur = Math.max(0.03, out[k].endSec - out[k].startSec);
      out[k].startSec = out[k - 1].endSec;
      out[k].endSec = out[k].startSec + dur;
    }
  }
  return out;
}

/**
 * 硬保证：相邻不重叠 + 每字 ≥ MIN。
 * 在「实际占用窗」内摊开（可向行窗借）；仍不够则均分占用窗（宁可略短于 MIN，也禁止叠填跳字）。
 * 不把短唱段强行拉满整行 end（避免末字拖到句末空档）。
 */
function ensureMinCharWipeTiming(
  chars: KaraokeCharTiming[],
  lineStart: number,
  lineEnd: number,
): KaraokeCharTiming[] {
  if (chars.length === 0) return chars;
  if (chars.length === 1) {
    const c = { ...chars[0] };
    const s = Math.max(lineStart, Math.min(lineEnd - 0.03, c.startSec));
    c.startSec = s;
    c.endSec = Math.max(s + Math.min(MIN_CHAR_WIPE_SEC, Math.max(0.03, lineEnd - s)), Math.min(lineEnd, c.endSec));
    return [c];
  }
  const n = chars.length;
  const minDur = MIN_CHAR_WIPE_SEC;
  const lineLo = lineStart;
  const lineHi = Math.max(lineLo + 0.05, lineEnd);

  let hasProblem = false;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i].endSec - chars[i].startSec < minDur - 1e-6) hasProblem = true;
    if (i > 0 && chars[i].startSec < chars[i - 1].endSec - 1e-6) hasProblem = true;
  }
  // 单调堆叠把末字推出行窗：也会造成后半「瞬间赶字」或与下一句重叠
  if (chars[0].startSec < lineLo - 0.06) hasProblem = true;
  if (chars.reduce((m, c) => Math.max(m, c.endSec), 0) > lineHi + 0.06) hasProblem = true;
  if (!hasProblem) return chars;

  let lo = Math.max(lineLo, chars[0].startSec);
  let hi = Math.min(
    lineHi,
    chars.reduce((m, c) => Math.max(m, c.endSec), lo),
  );
  const need = n * minDur;
  if (hi - lo < need - 1e-6) {
    const extra = need - (hi - lo);
    const canBefore = Math.max(0, lo - lineLo);
    const canAfter = Math.max(0, lineHi - hi);
    let takeBefore = Math.min(canBefore, extra / 2);
    let takeAfter = Math.min(canAfter, extra - takeBefore);
    if (takeBefore + takeAfter < extra - 1e-6) {
      const rest = extra - takeBefore - takeAfter;
      takeBefore += Math.min(canBefore - takeBefore, rest);
      takeAfter += Math.min(canAfter - takeAfter, Math.max(0, extra - takeBefore - takeAfter));
    }
    lo -= takeBefore;
    hi += takeAfter;
  }
  lo = Math.max(lineLo, lo);
  hi = Math.min(lineHi, Math.max(lo + 0.05, hi));
  const avail = hi - lo;

  // 行内仍不够 n*MIN：均分占用窗（保单调；单字可能 < MIN，但不会一帧多字同时满）
  if (avail + 1e-6 < need) {
    const step = avail / n;
    return chars.map((c, i) => ({
      text: c.text,
      startSec: lo + i * step,
      endSec: lo + (i + 1) * step,
    }));
  }

  const orig = chars.map((c) => Math.max(0.01, c.endSec - c.startSec));
  const origSum = orig.reduce((a, b) => a + b, 0) || 1;
  const rem = avail - need;
  const out: KaraokeCharTiming[] = [];
  let t = lo;
  for (let i = 0; i < n; i++) {
    const dur = minDur + (rem * orig[i]) / origSum;
    out.push({
      text: chars[i].text,
      startSec: t,
      endSec: t + dur,
    });
    t += dur;
  }
  if (out.length) out[out.length - 1].endSec = hi;
  return out;
}

function unitKey(s: string): string {
  return String(s || '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** 锚点与用户单元是否可对齐（仅精确/首尾，禁止宽松 includes 中段误吃） */
function anchorsMatchUnit(ak: string, uk: string): boolean {
  if (!ak || !uk) return false;
  if (ak === uk) return true;
  // 单字对多字锚：仅首/尾字，避免「在」误吃「现在」中段
  if (uk.length === 1 && ak.length > 1) {
    return ak.startsWith(uk) || ak.endsWith(uk);
  }
  if (ak.length === 1 && uk.length > 1) {
    return uk.startsWith(ak) || uk.endsWith(ak);
  }
  // 多对多：仅当一方为另一方前缀/后缀且长度比 ≥0.6（不再用 includes 中缀）
  if (ak.startsWith(uk) || uk.startsWith(ak) || ak.endsWith(uk) || uk.endsWith(ak)) {
    const lenRatio = Math.min(ak.length, uk.length) / Math.max(ak.length, uk.length);
    return lenRatio >= 0.6;
  }
  return false;
}

/** 在未匹配单元之间，按权重把邻居时间窗切开（局部插值，非整行匀速） */
function fillUnmatchedCharSlots(
  chars: Array<KaraokeCharTiming | null>,
  units: string[],
  lineStart: number,
  lineEnd: number,
): KaraokeCharTiming[] {
  const n = units.length;
  const out: Array<KaraokeCharTiming | null> = chars.slice();
  let i = 0;
  while (i < n) {
    if (out[i]) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < n && !out[j]) j += 1;
    const prev = i > 0 ? out[i - 1] : null;
    const next = j < n ? out[j] : null;
    let winStart = prev ? prev.endSec : lineStart;
    let winEnd = next ? next.startSec : lineEnd;
    const gapCount = j - i;
    const need = Math.max(0.05, gapCount * MIN_CHAR_WIPE_SEC);
    // 匹配跳跃留下的极窄窗：向两侧借时间，避免多字瞬间填满
    if (winEnd - winStart < need - 1e-6) {
      const lo = prev ? prev.startSec + Math.min(MIN_CHAR_WIPE_SEC, Math.max(0.03, (prev.endSec - prev.startSec) * 0.35)) : lineStart;
      const hi = next
        ? next.endSec - Math.min(MIN_CHAR_WIPE_SEC, Math.max(0.03, (next.endSec - next.startSec) * 0.35))
        : lineEnd;
      const mid = (Math.max(winStart, lineStart) + Math.min(winEnd, lineEnd)) / 2;
      winStart = Math.max(lineStart, Math.min(lo, mid - need / 2));
      winEnd = Math.min(lineEnd, Math.max(hi, mid + need / 2));
      if (winEnd - winStart < need - 1e-6) {
        winStart = Math.max(lineStart, Math.min(winStart, lineEnd - need));
        winEnd = Math.min(lineEnd, winStart + need);
      }
      // 邻接已匹配字被压缩时同步收缩，后续 enforce/smooth 再理顺
      if (prev && prev.endSec > winStart) {
        prev.endSec = Math.max(prev.startSec + 0.03, winStart);
      }
      if (next && next.startSec < winEnd) {
        next.startSec = Math.min(next.endSec - 0.03, winEnd);
        if (next.startSec < next.endSec - 0.001) {
          /* keep */
        } else {
          next.startSec = Math.max(winEnd, next.endSec - 0.03);
        }
      }
    }
    const slice = units.slice(i, j).join('');
    const filled = interpolateCharsInLine(
      slice,
      Math.max(lineStart, winStart),
      Math.max(Math.max(lineStart, winStart) + 0.05, Math.min(lineEnd, winEnd)),
    );
    for (let k = 0; k < filled.length && i + k < j; k++) {
      out[i + k] = { ...filled[k], text: units[i + k] };
    }
    // 若插值字数不够（极端），均分剩余
    for (let k = i; k < j; k++) {
      if (out[k]) continue;
      const span = Math.max(0.05, winEnd - winStart);
      const step = span / Math.max(1, j - i);
      const s = winStart + (k - i) * step;
      out[k] = {
        text: units[k],
        startSec: s,
        endSec: Math.min(winEnd, s + Math.max(0.03, step)),
      };
    }
    i = j;
  }
  return out.map((c, idx) => c || { text: units[idx], startSec: lineStart, endSec: lineStart + 0.03 });
}

/**
 * 用 ASR 字/词级时间映射到用户歌词单元，保留唱腔快慢与每字 duration；失败则回退匀速插值。
 */
export function mapAsrWordsToLineChars(
  text: string,
  startSec: number,
  endSec: number,
  words: KaraokeAsrWordTiming[] | undefined | null,
): { chars: KaraokeCharTiming[]; usedAsrWords: boolean } {
  const start = clampSec(startSec);
  const end = Math.max(start + 0.05, clampSec(endSec));
  const allUnits = splitKaraokeUnits(text);
  if (allUnits.length === 0) return { chars: [], usedAsrWords: false };

  // 角色标记不参与 ASR 对齐（避免把「男」「女」「合」当唱词）
  const units = allUnits.filter((u) => !isKaraokeRoleMarker(u));
  if (units.length === 0) {
    return { chars: interpolateCharsInLine(text, start, end), usedAsrWords: false };
  }

  const weave = (singable: KaraokeCharTiming[], usedAsrWords: boolean) => ({
    chars: weaveKaraokeRoleChars(allUnits, singable, null).chars,
    usedAsrWords,
  });

  const inRange = normalizeAsrWords(words).filter((w) => {
    return w.endSec > start - 0.08 && w.startSec < end + 0.08;
  });
  if (inRange.length === 0) {
    return { chars: interpolateCharsInLine(text, start, end), usedAsrWords: false };
  }

  const anchors = expandWordsToAnchors(inRange, start, end);
  if (anchors.length === 0) {
    return { chars: interpolateCharsInLine(text, start, end), usedAsrWords: false };
  }

  // 1) 文本贪婪对齐：能匹配到的单元直接用 ASR 起止（保留 duration）
  // 禁止跳过「仍可能对应后续歌词」的内容锚——否则中间字被塞进极窄窗 → 跳字
  const slots: Array<KaraokeCharTiming | null> = new Array(units.length).fill(null);
  let ai = 0;
  let matched = 0;
  const lineIsFiller = isLyricFillerParticleOnlyText(stripKaraokeRoleMarkers(text));
  for (let ui = 0; ui < units.length; ui++) {
    const uk = unitKey(units[ui]);
    if (!uk) continue;
    let found = -1;
    const remainingKeys = units
      .slice(ui)
      .map((u) => unitKey(u))
      .filter(Boolean);
    const remainingJoined = remainingKeys.join('');
    const lookEnd = Math.min(anchors.length, ai + 12);
    for (let j = ai; j < lookEnd; j++) {
      const ak = unitKey(anchors[j].text);
      if (!ak) continue;
      // 正式歌词：跳过纯语气 ASR 锚
      if (
        !lineIsFiller &&
        isFillerParticleAnchor(anchors[j].text) &&
        !isLyricFillerParticleOnlyText(units[ui])
      ) {
        continue;
      }
      if (anchorsMatchUnit(ak, uk)) {
        found = j;
        break;
      }
      // 内容锚且不像后续任何歌词单元 → ASR 多识，可跳过
      const appearsLater =
        remainingKeys.some((rk) => anchorsMatchUnit(ak, rk)) ||
        (ak.length === 1 && remainingJoined.includes(ak));
      if (!appearsLater) continue;
      // 内容锚还可能对应后续字：停止前瞻，本字留空由 fill 插值
      break;
    }
    if (found < 0) continue;
    const a = anchors[found];
    slots[ui] = {
      text: units[ui],
      startSec: a.startSec,
      endSec: Math.max(a.startSec + 0.03, a.endSec),
    };
    matched += 1;
    ai = found + 1;
  }

  // 2) 匹配过少：按索引把 anchor 时间窗切开（多字共享同一锚时均分，禁止同起同止）
  if (matched < Math.max(1, Math.floor(units.length * 0.35))) {
    const chars: KaraokeCharTiming[] = [];
    for (let i = 0; i < units.length; i++) {
      const a0 = Math.min(anchors.length - 1, Math.floor((i * anchors.length) / units.length));
      const a1 = Math.min(
        anchors.length - 1,
        Math.max(a0, Math.floor(((i + 1) * anchors.length) / units.length) - 1),
      );
      if (a0 === a1) {
        const shareStart = a0;
        let shareCount = 0;
        let idxInShare = 0;
        for (let u = 0; u < units.length; u++) {
          const u0 = Math.min(
            anchors.length - 1,
            Math.floor((u * anchors.length) / units.length),
          );
          if (u0 !== shareStart) continue;
          if (u === i) idxInShare = shareCount;
          shareCount += 1;
        }
        const winS = anchors[a0].startSec;
        const winE = Math.max(winS + 0.03, anchors[a0].endSec);
        const step = (winE - winS) / Math.max(1, shareCount);
        const s = winS + idxInShare * step;
        const e = winS + (idxInShare + 1) * step;
        chars.push({
          text: units[i],
          startSec: Math.max(start, s),
          endSec: Math.max(Math.max(start, s) + 0.03, Math.min(end, e)),
        });
      } else {
        const s = anchors[a0].startSec;
        const e = anchors[a1].endSec;
        chars.push({
          text: units[i],
          startSec: Math.max(start, s),
          endSec: Math.max(Math.max(start, s) + 0.03, Math.min(end, e)),
        });
      }
    }
    return weave(enforceMonotonicChars(chars, start, end), true);
  }

  const filled = fillUnmatchedCharSlots(slots, units, start, end);
  return weave(enforceMonotonicChars(filled, start, end), true);
}

/** 对齐用归一化（先去角色标记，再去空白/标点，便于漏句时文本相似比较） */
function normalizeAlignText(s: string): string {
  return stripKaraokeRoleMarkers(s)
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace(/[，。！？、…·\-—~～"'“”‘’（）()【】\[\]《》<>：:；;,.!?]/g, '');
}

function isFillerParticleAnchor(text: string): boolean {
  return isLyricFillerParticleOnlyText(text);
}

/** 公共字符占比相似度（0–1） */
function alignTextSimilarity(a: string, b: string): number {
  const x = normalizeAlignText(a);
  const y = normalizeAlignText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.88;
  const setY = new Set(Array.from(y));
  let hit = 0;
  for (const ch of Array.from(x)) if (setY.has(ch)) hit += 1;
  return hit / Math.max(Array.from(x).length, Array.from(y).length);
}

/** 全曲 ASR 词 → 原子锚点（不按行窗裁切，供按行独立搜窗） */
function expandAllAsrAnchors(words: KaraokeAsrWordTiming[]): KaraokeCharTiming[] {
  const sorted = normalizeAsrWords(words);
  if (!sorted.length) return [];
  const lo = sorted[0].startSec - 0.5;
  const hi = sorted[sorted.length - 1].endSec + 0.5;
  return expandWordsToAnchors(sorted, lo, hi);
}

const LINE_MATCH_MIN_SCORE = 0.32;
const LINE_MATCH_WEAK_SCORE = 0.48;
/** 同分偏好更早窗：避免副歌/片尾「更像」时把游标跳飞，导致中段断档、末段挤爆 */
const LINE_MATCH_EARLY_TIE_EPS = 0.045;
/** 行均字时长低于此值视为异常压缩（秒/字） */
const LINE_CHAR_SPAN_MIN_SEC = 0.055;

type LineWindowHit = {
  startIdx: number;
  endIdx: number;
  score: number;
  startSec: number;
  endSec: number;
};

/**
 * 在 ASR 锚点流 [searchFrom, searchTo) 上为单行找最佳连续时间窗。
 * 不修改全局游标；调用方仅在匹配成功时推进，失败则跳过不吃后续锚点。
 * 近同分时取更早窗，防止后半副歌抢走前半句的匹配。
 */
function findBestLineWindowInAnchors(
  anchors: KaraokeCharTiming[],
  lineText: string,
  searchFrom: number,
  searchTo: number,
  prior?: { startSec: number; endSec: number } | null,
): LineWindowHit | null {
  const target = normalizeAlignText(lineText);
  if (!target || !anchors.length) return null;
  const targetLen = Array.from(target).length;
  if (targetLen <= 0) return null;
  const from = Math.max(0, Math.min(anchors.length, searchFrom));
  const to = Math.max(from, Math.min(anchors.length, searchTo));
  if (from >= to) return null;

  // 用户行非纯语气词时，搜窗忽略 ASR 纯「啊/啦」锚点（不把和声吃进正式歌词窗）
  const skipFiller = !isLyricFillerParticleOnlyText(lineText);
  const minLen = Math.max(1, Math.floor(targetLen * 0.45));
  const maxLen = Math.min(to - from, Math.max(minLen, Math.ceil(targetLen * 1.85) + 3));
  let best: LineWindowHit | null = null;

  for (let i = from; i < to; i++) {
    if (skipFiller && isFillerParticleAnchor(anchors[i].text)) continue;
    let concat = '';
    let used = 0;
    let lastJ = i;
    for (let j = i; j < to && used < maxLen; j++) {
      if (skipFiller && isFillerParticleAnchor(anchors[j].text)) continue;
      concat += normalizeAlignText(anchors[j].text);
      used += 1;
      lastJ = j;
      const len = Array.from(concat).length;
      if (len < minLen) continue;
      const sim = alignTextSimilarity(target, concat);
      const lenRatio = Math.min(targetLen, len) / Math.max(targetLen, len || 1);
      let score = sim * 0.78 + lenRatio * 0.22;
      if (prior) {
        const ws = anchors[i].startSec;
        const we = anchors[lastJ].endSec;
        const overlap =
          Math.max(0, Math.min(we, prior.endSec) - Math.max(ws, prior.startSec)) /
          Math.max(0.05, Math.max(we, prior.endSec) - Math.min(ws, prior.startSec));
        score += Math.min(0.12, overlap * 0.12);
      }
      // 轻微偏好更早起点（同一搜窗内），避免「后面更像」跳飞
      const earlyBias =
        ((to - from) > 1 ? (to - 1 - i) / (to - from) : 0) * 0.04;
      score += earlyBias;
      const better =
        !best ||
        score > best.score + LINE_MATCH_EARLY_TIE_EPS ||
        (Math.abs(score - best.score) <= LINE_MATCH_EARLY_TIE_EPS && i < best.startIdx);
      if (better) {
        best = {
          startIdx: i,
          endIdx: lastJ + 1,
          score,
          startSec: anchors[i].startSec,
          endSec: Math.max(anchors[i].startSec + 0.05, anchors[lastJ].endSec),
        };
      }
      // 已明显过长且相似很低：停止拉长本起点
      if (len > targetLen * 1.6 && sim < 0.28) break;
    }
  }
  if (!best || best.score < LINE_MATCH_MIN_SCORE) return null;
  return best;
}

/**
 * Pass1 局部搜窗上界：按剩余行均分锚点预算，避免扫到片尾副歌。
 * 过窄会漏长间奏后的下一句，故另有一次「强匹配才接受」的扩窗。
 */
function pass1LocalSearchTo(
  anchorsLen: number,
  cursor: number,
  lineText: string,
  remainingLines: number,
): number {
  const targetLen = Math.max(1, Array.from(normalizeAlignText(lineText)).length);
  const remAnchors = Math.max(0, anchorsLen - cursor);
  const avgBudget = Math.max(4, Math.ceil(remAnchors / Math.max(1, remainingLines)));
  return Math.min(
    anchorsLen,
    cursor + Math.max(avgBudget * 3, Math.ceil(targetLen * 2.5) + 8, 20),
  );
}

function pass1ExpandedSearchTo(
  anchorsLen: number,
  cursor: number,
  lineText: string,
  remainingLines: number,
): number {
  const targetLen = Math.max(1, Array.from(normalizeAlignText(lineText)).length);
  const remAnchors = Math.max(0, anchorsLen - cursor);
  const avgBudget = Math.max(4, Math.ceil(remAnchors / Math.max(1, remainingLines)));
  // 允许跨过间奏/漏识别，但仍远小于「扫完全曲剩余」
  return Math.min(
    anchorsLen,
    cursor + Math.max(avgBudget * 7, Math.ceil(targetLen * 4) + 16, 48),
  );
}

/** 行窗是否相对字数异常偏短（末段狂扫的典型特征） */
function isLineTimingAbnormallyCompressed(
  startSec: number,
  endSec: number,
  text: string,
): boolean {
  const chars = Math.max(1, Array.from(normalizeAlignText(text)).length || Array.from(text).length);
  if (chars < 3) return false;
  const span = Math.max(0, endSec - startSec);
  return span < chars * LINE_CHAR_SPAN_MIN_SEC;
}

/**
 * 防御：检测「前半正常、中段空洞、末段多行挤在一起」并自空洞起点起按字数重插值。
 * 不抢 ASR 锚点重搜（避免再跳飞），只摊平时间；字级再走 interpolate。
 */
function repairCompressedTailResolved(opts: {
  resolved: Array<{
    startSec: number;
    endSec: number;
    quality: 'asr' | 'weak' | 'interpolated';
    fromAsr: boolean;
  }>;
  rawTexts: string[];
  words: KaraokeAsrWordTiming[];
  songDurationSec?: number;
}): number {
  const { resolved, rawTexts, words } = opts;
  const n = resolved.length;
  if (n < 6 || words.length === 0) return 0;

  const songStart = words[0].startSec;
  const songEnd = Math.max(
    words[words.length - 1].endSec,
    Number(opts.songDurationSec) || 0,
    resolved[n - 1]?.endSec || 0,
  );
  const songSpan = Math.max(1, songEnd - songStart);

  // 找第一个「相对字数过挤」或「大空洞后尾段挤爆」的下标
  let compressFrom = -1;
  for (let i = 1; i < n; i++) {
    const jump = resolved[i].startSec - resolved[i - 1].endSec;
    const compressed = isLineTimingAbnormallyCompressed(
      resolved[i].startSec,
      resolved[i].endSec,
      rawTexts[i],
    );
    // 仅当：大空洞 + 其后多行时间明显不够字数（末段狂扫）。
    // 真间奏后副歌（跳后行窗正常）不触发，避免毁掉后半 ASR。
    if (jump > 12 && n - i >= 3) {
      const tail = resolved.slice(i);
      const tailSpan = Math.max(
        0,
        (tail[tail.length - 1]?.endSec || 0) - (tail[0]?.startSec || 0),
      );
      const tailChars = rawTexts
        .slice(i)
        .reduce(
          (a, t) => a + Math.max(1, Array.from(normalizeAlignText(t)).length || Array.from(t).length),
          0,
        );
      if (tailSpan < Math.max(2.5, tailChars * LINE_CHAR_SPAN_MIN_SEC * 0.9)) {
        compressFrom = i;
        break;
      }
    }
    if (compressed) {
      let cluster = 1;
      for (let j = i + 1; j < n && j < i + 6; j++) {
        if (
          isLineTimingAbnormallyCompressed(
            resolved[j].startSec,
            resolved[j].endSec,
            rawTexts[j],
          )
        ) {
          cluster += 1;
        } else break;
      }
      if (cluster >= 2) {
        compressFrom = i;
        break;
      }
    }
  }

  // 备选：末 30% 行只占全曲 <12% 时长，而前 50% 行占 >35%，且中段有大空洞
  if (compressFrom < 0) {
    const earlyEnd = Math.max(2, Math.floor(n * 0.5));
    const lateStart = Math.min(n - 2, Math.floor(n * 0.7));
    if (lateStart > earlyEnd) {
      const earlySpan = Math.max(
        0,
        resolved[earlyEnd - 1].endSec - resolved[0].startSec,
      );
      const lateSpan = Math.max(
        0,
        resolved[n - 1].endSec - resolved[lateStart].startSec,
      );
      const midGap = resolved[lateStart].startSec - resolved[earlyEnd - 1].endSec;
      const lateChars = rawTexts
        .slice(lateStart)
        .reduce(
          (a, t) => a + Math.max(1, Array.from(normalizeAlignText(t)).length || Array.from(t).length),
          0,
        );
      const lateCrowded = lateSpan < Math.max(2.5, lateChars * LINE_CHAR_SPAN_MIN_SEC * 0.9);
      if (
        lateCrowded &&
        earlySpan > songSpan * 0.35 &&
        lateSpan < songSpan * 0.12 &&
        midGap > songSpan * 0.15 &&
        n - lateStart >= 3
      ) {
        compressFrom = earlyEnd;
      }
    }
  }

  if (compressFrom < 1 || compressFrom >= n) return 0;

  const winStart = resolved[compressFrom - 1].endSec;
  const winEnd = Math.max(winStart + 0.05 * (n - compressFrom), songEnd);
  const gapTexts = rawTexts.slice(compressFrom);
  const totalChars =
    gapTexts.reduce((a, t) => a + Math.max(1, Array.from(normalizeAlignText(t)).length || Array.from(t).length), 0) ||
    1;
  let cursorT = winStart;
  const span = Math.max(0.05 * gapTexts.length, winEnd - winStart);
  for (let k = 0; k < gapTexts.length; k++) {
    const share =
      Math.max(1, Array.from(normalizeAlignText(gapTexts[k])).length || Array.from(gapTexts[k]).length) /
      totalChars;
    const dur =
      k === gapTexts.length - 1
        ? Math.max(0.05, winEnd - cursorT)
        : Math.max(0.25, span * share);
    const startSec = cursorT;
    const endSec =
      k === gapTexts.length - 1
        ? Math.max(startSec + 0.05, winEnd)
        : Math.min(winEnd, cursorT + dur);
    resolved[compressFrom + k] = {
      startSec,
      endSec,
      quality: 'interpolated',
      fromAsr: false,
    };
    cursorT = endSec;
  }

  try {
    // eslint-disable-next-line no-console
    console.warn(
      '[karaoke] repaired compressed tail alignment',
      `fromLine=${compressFrom}`,
      `lines=${gapTexts.length}`,
      `win=${winStart.toFixed(2)}-${winEnd.toFixed(2)}`,
    );
  } catch {
    /* ignore */
  }
  return gapTexts.length;
}

/** 行内字级总时长异常压缩 → 回退匀速插值 */
function sanitizeCompressedLineChars(
  text: string,
  startSec: number,
  endSec: number,
  chars: KaraokeCharTiming[],
): KaraokeCharTiming[] {
  const singable = (chars || []).filter((c) => !c.roleTag && !isKaraokeRoleMarker(c.text));
  if (!singable.length || singable.length < 3) return chars;
  const c0 = singable[0].startSec;
  const c1 = singable.reduce((m, c) => Math.max(m, c.endSec), c0);
  const span = Math.max(0, c1 - c0);
  const minSpan = singable.length * LINE_CHAR_SPAN_MIN_SEC;
  if (span >= minSpan * 0.85) return chars;
  try {
    // eslint-disable-next-line no-console
    console.warn(
      '[karaoke] line char timing compressed, fallback interpolate',
      `chars=${singable.length}`,
      `span=${span.toFixed(3)}`,
      `text=${text.slice(0, 24)}`,
    );
  } catch {
    /* ignore */
  }
  return interpolateCharsInLine(text, startSec, endSec);
}

/** 匹配成功后跳过尾随纯语气锚点，避免下一句游标卡在和声上 */
function advancePastTrailingFiller(
  anchors: KaraokeCharTiming[],
  idx: number,
  lineText: string,
): number {
  let cursor = Math.max(0, Math.min(anchors.length, idx));
  if (isLyricFillerParticleOnlyText(lineText)) return cursor;
  while (cursor < anchors.length && isFillerParticleAnchor(anchors[cursor].text)) {
    cursor += 1;
  }
  return cursor;
}

/** 锚点窗拼成文本，供「是否更像后续行」比较 */
function anchorsWindowText(anchors: KaraokeCharTiming[], startIdx: number, endIdx: number): string {
  const a = Math.max(0, startIdx);
  const b = Math.max(a, Math.min(anchors.length, endIdx));
  return anchors
    .slice(a, b)
    .map((x) => x.text)
    .join('');
}

/**
 * 当前命中窗若明显更像后续某行（典型：中段漏识别后误吃副歌），则放弃，留给后面行。
 * 不推进游标，使 Pass3 能把中段插值进大时间空洞。
 */
function hitWindowBelongsToLaterLine(
  anchors: KaraokeCharTiming[],
  hit: LineWindowHit,
  rawTexts: string[],
  lineIdx: number,
): boolean {
  const windowText = anchorsWindowText(anchors, hit.startIdx, hit.endIdx);
  if (!windowText) return false;
  const selfSim = alignTextSimilarity(rawTexts[lineIdx], windowText);
  const look = Math.min(rawTexts.length, lineIdx + 10);
  for (let later = lineIdx + 1; later < look; later++) {
    const laterSim = alignTextSimilarity(rawTexts[later], windowText);
    if (laterSim >= LINE_MATCH_WEAK_SCORE && laterSim > selfSim + 0.1) {
      return true;
    }
  }
  return false;
}

export interface AlignUserLinesToAsrResult {
  lines: KaraokeLine[];
  usedAsrWords: boolean;
  weakAlignment: boolean;
  weakLineCount: number;
  interpolatedLineCount: number;
}

/**
 * 按行独立对齐：每行在 ASR words 流上找最佳局部时间窗（文本相似 + 单调时间）。
 * 某行匹配失败 → 标记插值/跳过，不占用后续行的 ASR 锚点；再在前后已匹配行之间插值该行。
 */
export function alignUserLyricLinesToAsrWords(
  texts: string[],
  asrWords: KaraokeAsrWordTiming[] | undefined | null,
  opts?: {
    songDurationSec?: number;
    ids?: Array<string | undefined | null>;
    /** 可选软先验（校准句窗）；仅加分，不强制 */
    priorWindows?: Array<{ startSec: number; endSec: number } | null | undefined>;
  },
): AlignUserLinesToAsrResult {
  const rawTexts = (texts || []).map((t) => String(t || '').trim()).filter(Boolean);
  const words = normalizeAsrWords(asrWords);
  if (rawTexts.length === 0) {
    return {
      lines: [],
      usedAsrWords: false,
      weakAlignment: false,
      weakLineCount: 0,
      interpolatedLineCount: 0,
    };
  }
  if (words.length === 0) {
    const songDur = Math.max(1, Number(opts?.songDurationSec) || 1);
    const totalChars = rawTexts.reduce((a, l) => a + Math.max(1, Array.from(l).length), 0) || 1;
    const lines: KaraokeLine[] = [];
    let cursor = 0;
    for (let i = 0; i < rawTexts.length; i++) {
      const share = Math.max(1, Array.from(rawTexts[i]).length) / totalChars;
      const dur = i === rawTexts.length - 1 ? songDur - cursor : Math.max(0.4, songDur * share);
      const startSec = cursor;
      const endSec = i === rawTexts.length - 1 ? songDur : Math.min(songDur, cursor + dur);
      lines.push({
        id: String(opts?.ids?.[i] || '').trim() || newLineId(i),
        text: rawTexts[i],
        startSec,
        endSec,
        chars: interpolateCharsInLine(rawTexts[i], startSec, endSec),
        timingQuality: 'interpolated',
      });
      cursor = endSec;
    }
    return {
      lines,
      usedAsrWords: false,
      weakAlignment: true,
      weakLineCount: lines.length,
      interpolatedLineCount: lines.length,
    };
  }

  const anchors = expandAllAsrAnchors(words);
  type Slot = {
    hit: LineWindowHit | null;
    quality: 'asr' | 'weak' | 'pending';
  };
  const slots: Slot[] = rawTexts.map(() => ({ hit: null, quality: 'pending' }));

  // Pass 1：单调前进 + 局部优先搜窗（对齐 calibrateLyricSegments 的 vPtr+N 思路）。
  // 旧逻辑扫 [cursor, end) 取全局最优，副歌/重复句会把游标跳到片尾 → 中段无唱窗、末段狂扫。
  let cursor = 0;
  let lastAcceptedEndSec = words[0]?.startSec ?? 0;
  for (let li = 0; li < rawTexts.length; li++) {
    const remaining = rawTexts.length - li;
    const prior = opts?.priorWindows?.[li] || null;
    const localTo = pass1LocalSearchTo(anchors.length, cursor, rawTexts[li], remaining);
    let hit = findBestLineWindowInAnchors(
      anchors,
      rawTexts[li],
      cursor,
      localTo,
      prior,
    );
    // 局部未中或偏弱：扩窗一次，但仅接受较强匹配，避免弱分跳飞
    if (!hit || hit.score < LINE_MATCH_WEAK_SCORE) {
      const expandedTo = pass1ExpandedSearchTo(
        anchors.length,
        cursor,
        rawTexts[li],
        remaining,
      );
      if (expandedTo > localTo) {
        const wider = findBestLineWindowInAnchors(
          anchors,
          rawTexts[li],
          cursor,
          expandedTo,
          prior,
        );
        if (wider && wider.score >= LINE_MATCH_WEAK_SCORE) {
          hit = wider;
        } else if (!hit) {
          hit = null;
        }
        // 局部已有弱命中但扩窗也没有更强结果：保留局部，勿改用更远弱窗
      }
    }
    if (!hit) continue;
    // 窗更像后续行（中段漏识别后误吃副歌）→ 跳过不推进
    if (hitWindowBelongsToLaterLine(anchors, hit, rawTexts, li)) {
      continue;
    }
    // 时间大跳且自身相似度不够：宁可不吃，交给 Pass2/3 填空洞
    const timeJump = hit.startSec - lastAcceptedEndSec;
    const windowText = anchorsWindowText(anchors, hit.startIdx, hit.endIdx);
    const selfSim = alignTextSimilarity(rawTexts[li], windowText);
    if (timeJump > 10 && selfSim < 0.72) {
      continue;
    }
    // 锚点空跳过大且分数不够强
    const jumpAnchors = hit.startIdx - cursor;
    const remAnchors = Math.max(1, anchors.length - cursor);
    const avgBudget = Math.max(4, Math.ceil(remAnchors / Math.max(1, remaining)));
    if (jumpAnchors > avgBudget * 5 && hit.score < 0.72) {
      continue;
    }
    slots[li] = {
      hit,
      quality: hit.score < LINE_MATCH_WEAK_SCORE ? 'weak' : 'asr',
    };
    cursor = advancePastTrailingFiller(anchors, hit.endIdx, rawTexts[li]);
    lastAcceptedEndSec = hit.endSec;
  }

  // Pass 2：未匹配行在前后已匹配锚点之间局部再搜（仍不跨过邻居窗）
  for (let li = 0; li < rawTexts.length; li++) {
    if (slots[li].hit) continue;
    let prevEnd = 0;
    let nextStart = anchors.length;
    for (let p = li - 1; p >= 0; p--) {
      if (slots[p].hit) {
        prevEnd = slots[p].hit!.endIdx;
        break;
      }
    }
    for (let n = li + 1; n < rawTexts.length; n++) {
      if (slots[n].hit) {
        nextStart = slots[n].hit!.startIdx;
        break;
      }
    }
    if (prevEnd >= nextStart) continue;
    const hit = findBestLineWindowInAnchors(
      anchors,
      rawTexts[li],
      prevEnd,
      nextStart,
      opts?.priorWindows?.[li] || null,
    );
    if (!hit) continue;
    slots[li] = {
      hit,
      quality: hit.score < LINE_MATCH_WEAK_SCORE ? 'weak' : 'asr',
    };
  }

  // Pass 3：仍失败 → 在前后已匹配行时间之间按字数插值（不抢 ASR 锚点）
  const resolved: Array<{
    startSec: number;
    endSec: number;
    quality: 'asr' | 'weak' | 'interpolated';
    fromAsr: boolean;
  }> = rawTexts.map((_, i) => {
    const s = slots[i];
    if (s.hit) {
      return {
        startSec: s.hit.startSec,
        endSec: s.hit.endSec,
        quality: s.quality === 'weak' ? 'weak' : 'asr',
        fromAsr: true,
      };
    }
    return { startSec: 0, endSec: 0, quality: 'interpolated', fromAsr: false };
  });

  let i = 0;
  while (i < rawTexts.length) {
    if (resolved[i].fromAsr) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < rawTexts.length && !resolved[j].fromAsr) j += 1;
    const prev = i > 0 ? resolved[i - 1] : null;
    const next = j < rawTexts.length ? resolved[j] : null;
    const winStart = prev ? prev.endSec : words[0].startSec;
    const winEnd = next
      ? next.startSec
      : Math.max(
          winStart + 0.05,
          words[words.length - 1].endSec,
          Number(opts?.songDurationSec) || 0,
        );
    const gapTexts = rawTexts.slice(i, j);
    const totalChars = gapTexts.reduce((a, t) => a + Math.max(1, Array.from(t).length), 0) || 1;
    let cursorT = winStart;
    const span = Math.max(0.05 * (j - i), winEnd - winStart);
    for (let k = 0; k < gapTexts.length; k++) {
      const share = Math.max(1, Array.from(gapTexts[k]).length) / totalChars;
      const dur =
        k === gapTexts.length - 1 ? Math.max(0.05, winEnd - cursorT) : Math.max(0.2, span * share);
      const startSec = cursorT;
      const endSec =
        k === gapTexts.length - 1 ? Math.max(startSec + 0.05, winEnd) : Math.min(winEnd, cursorT + dur);
      resolved[i + k] = {
        startSec,
        endSec,
        quality: 'interpolated',
        fromAsr: false,
      };
      cursorT = endSec;
    }
    i = j;
  }

  // 防御：末段多行时间被挤扁 / 中段大空洞 → 自异常点起重插值摊平
  repairCompressedTailResolved({
    resolved,
    rawTexts,
    words,
    songDurationSec: opts?.songDurationSec,
  });

  // 单调约束：后行不得早于前行结束（轻微重叠时前移）
  for (let li = 1; li < resolved.length; li++) {
    if (resolved[li].startSec < resolved[li - 1].endSec - 0.02) {
      const dur = Math.max(0.05, resolved[li].endSec - resolved[li].startSec);
      resolved[li].startSec = resolved[li - 1].endSec;
      resolved[li].endSec = resolved[li].startSec + dur;
    }
  }

  let weakLineCount = 0;
  let interpolatedLineCount = 0;
  const lines: KaraokeLine[] = rawTexts.map((text, li) => {
    const r = resolved[li];
    let chars: KaraokeCharTiming[];
    if (r.fromAsr) {
      chars = mapAsrWordsToLineChars(text, r.startSec, r.endSec, words).chars;
    } else {
      chars = interpolateCharsInLine(text, r.startSec, r.endSec);
    }
    const singableLen = (cs: KaraokeCharTiming[]) =>
      cs.filter((c) => !c.roleTag && !isKaraokeRoleMarker(c.text)).length;
    const singableSpan = (cs: KaraokeCharTiming[]) => {
      const s = cs.filter((c) => !c.roleTag && !isKaraokeRoleMarker(c.text));
      if (!s.length) return 0;
      return s.reduce((m, c) => Math.max(m, c.endSec), s[0].startSec) - s[0].startSec;
    };
    const beforeSpan = singableSpan(chars);
    chars = sanitizeCompressedLineChars(text, r.startSec, r.endSec, chars);
    const afterSpan = singableSpan(chars);
    const nSing = singableLen(chars);
    // 字级被压扁并回退插值：行质量改为 interpolated
    const charFallback =
      r.fromAsr &&
      nSing >= 3 &&
      beforeSpan + 1e-6 < nSing * LINE_CHAR_SPAN_MIN_SEC * 0.85 &&
      afterSpan > beforeSpan + 1e-4;
    const quality = charFallback ? 'interpolated' : r.quality;
    if (quality === 'interpolated') interpolatedLineCount += 1;
    if (quality === 'weak' || quality === 'interpolated') weakLineCount += 1;
    return {
      id: String(opts?.ids?.[li] || '').trim() || newLineId(li),
      text,
      startSec: r.startSec,
      endSec: r.endSec,
      chars,
      timingQuality: quality,
    };
  });

  const weakAlignment =
    interpolatedLineCount > 0 ||
    weakLineCount >= 2 ||
    (rawTexts.length > 0 && weakLineCount / rawTexts.length >= 0.15);

  return {
    lines,
    usedAsrWords: lines.some((l) => l.timingQuality === 'asr' || l.timingQuality === 'weak'),
    weakAlignment,
    weakLineCount,
    interpolatedLineCount,
  };
}

export function segmentToKaraokeLine(
  seg: DirectorMvLyricSegment,
  index: number,
  asrWords?: KaraokeAsrWordTiming[] | null,
): KaraokeLine {
  const text = String(seg.text || '').trim();
  const instrumental =
    seg.instrumental === true || !text || isDirectorInstrumentalLyricText(text);
  const startSec = clampSec(seg.startSec);
  const endSec = Math.max(startSec + 0.05, clampSec(seg.endSec));
  let chars: KaraokeCharTiming[] = [];
  if (!instrumental) {
    if (asrWords && asrWords.length > 0) {
      chars = mapAsrWordsToLineChars(text, startSec, endSec, asrWords).chars;
    } else {
      chars = interpolateCharsInLine(text, startSec, endSec);
    }
  }
  return {
    id: String(seg.id || '').trim() || newLineId(index),
    text: instrumental ? text || '' : text,
    startSec,
    endSec,
    chars,
    ...(instrumental ? { instrumental: true } : {}),
  };
}

/**
 * 过长人声行按句读/逗号拆成多行，并按字数比例切开时间窗。
 * 避免预览/ASS 把多句粘成一行超长白字（字号被压到极小）。
 */
export function expandOverlongKaraokeLine(
  line: KaraokeLine,
  asrWords?: KaraokeAsrWordTiming[] | null,
): KaraokeLine[] {
  if (line.instrumental) return [line];
  const text = String(line.text || line.chars?.map((c) => c.text).join('') || '').trim();
  if (!text || isDirectorNonLyricMetaText(text)) {
    return [];
  }
  const parts = splitUserLyricLines(text);
  if (parts.length <= 1) {
    // 无换行/逗号可拆时：超长纯中文软断
    if (text.length > 28 && /[\u4e00-\u9fff]/.test(text) && !/[，、；;]/.test(text)) {
      const soft: string[] = [];
      const target = 14;
      for (let i = 0; i < text.length; ) {
        if (text.length - i <= target + 4) {
          soft.push(text.slice(i));
          break;
        }
        soft.push(text.slice(i, i + target));
        i += target;
      }
      if (soft.length >= 2) {
        return distributeKaraokeLineParts(line, soft, asrWords);
      }
    }
    return [line];
  }
  return distributeKaraokeLineParts(line, parts, asrWords);
}

function distributeKaraokeLineParts(
  line: KaraokeLine,
  parts: string[],
  asrWords?: KaraokeAsrWordTiming[] | null,
): KaraokeLine[] {
  const start = clampSec(line.startSec);
  const end = Math.max(start + 0.05, clampSec(line.endSec));
  const weights = parts.map((p) => Math.max(1, Array.from(p).length));
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;
  const span = end - start;
  const out: KaraokeLine[] = [];
  let cursor = start;
  for (let i = 0; i < parts.length; i++) {
    const share = weights[i] / totalW;
    const dur = i === parts.length - 1 ? end - cursor : Math.max(0.2, span * share);
    const s = cursor;
    const e = i === parts.length - 1 ? end : Math.min(end, cursor + dur);
    const partText = parts[i];
    let chars: KaraokeCharTiming[] = [];
    if (asrWords && asrWords.length > 0) {
      chars = mapAsrWordsToLineChars(partText, s, e, asrWords).chars;
    } else if (line.chars?.length) {
      // 从原字级切片（按文本顺序），避免整段重插值丢节奏
      const joined = line.chars.map((c) => c.text).join('');
      const absStart = joined.indexOf(partText);
      if (absStart >= 0) {
        let unit = 0;
        let pos = 0;
        const slice: KaraokeCharTiming[] = [];
        for (const ch of line.chars) {
          const next = pos + ch.text.length;
          if (next > absStart && pos < absStart + partText.length) {
            slice.push({ ...ch });
          }
          pos = next;
          unit++;
          if (pos >= absStart + partText.length) break;
          void unit;
        }
        if (slice.length) chars = slice;
      }
      if (!chars.length) chars = interpolateCharsInLine(partText, s, e);
    } else {
      chars = interpolateCharsInLine(partText, s, e);
    }
    out.push({
      ...line,
      id: `${line.id}-p${i}`,
      text: partText,
      startSec: s,
      endSec: Math.max(s + 0.05, e),
      chars,
      instrumental: false,
    });
    cursor = e;
  }
  return out.length ? out : [line];
}

/** 展开过长行 + 过滤纯署名元信息（作词/作曲/编曲等） */
export function prepareKaraokeLinesForRender(
  lines: KaraokeLine[],
  asrWords?: KaraokeAsrWordTiming[] | null,
  userLyrics?: string | null,
): KaraokeLine[] {
  const out: KaraokeLine[] = [];
  for (const line of lines || []) {
    const text = String(line.text || line.chars?.map((c) => c.text).join('') || '').trim();
    // 署名/编曲等元信息绝不进入预览与 ASS（开场作词作曲另走 OpeningCredit）
    if (text && isDirectorNonLyricMetaText(text)) continue;
    if (line.instrumental) {
      out.push(line);
      continue;
    }
    out.push(...expandOverlongKaraokeLine(line, asrWords));
  }
  // 角色标记状态机：标注 role/roleTag，标记不占 wipe；跨行保持上一角色色
  return annotateKaraokeLinesRoles(sanitizeKaraokeDisplayLines(out, userLyrics));
}

/**
 * 显示行必须来自用户歌词：丢掉 ASR 多出来的「啦/啊」和声行等。
 * 过长行软拆后的半句（用户行子串）仍保留；用户明确写的「啦啦啦」也保留。
 */
export function sanitizeKaraokeDisplayLines(
  lines: KaraokeLine[],
  userLyrics?: string | null,
): KaraokeLine[] {
  const allowed = splitUserLyricLines(String(userLyrics || ''));
  if (allowed.length === 0) return lines || [];
  const norms = allowed.map((t) => normalizeAlignText(t)).filter(Boolean);
  if (norms.length === 0) return lines || [];
  return (lines || []).filter((l) => {
    if (l.instrumental) return true;
    const text = String(l.text || l.chars?.map((c) => c.text).join('') || '').trim();
    if (!text) return false;
    const norm = normalizeAlignText(text);
    if (!norm) return false;
    // 整行命中，或为某用户行的连续子串（expandOverlong 拆半句）
    if (norms.some((a) => a === norm || (norm.length >= 2 && a.includes(norm)))) return true;
    return false;
  });
}

export function lyricSegmentsToKaraokeLines(
  segments: DirectorMvLyricSegment[],
  asrWords?: KaraokeAsrWordTiming[] | null,
): KaraokeLine[] {
  const segs = normalizeDirectorMvLyricSegments(segments);
  const raw = segs.map((s, i) => segmentToKaraokeLine(s, i, asrWords));
  return prepareKaraokeLinesForRender(raw, asrWords);
}

/** 对整份 lines 施加全局偏移（可再编辑） */
export function applyGlobalOffsetToLines(lines: KaraokeLine[], offsetSec: number): KaraokeLine[] {
  const off = Number(offsetSec) || 0;
  if (!off) return lines.map((l) => ({ ...l, chars: l.chars.map((c) => ({ ...c })) }));
  return lines.map((l) => {
    const startSec = Math.max(0, l.startSec + off);
    const endSec = Math.max(startSec + 0.05, l.endSec + off);
    return {
      ...l,
      startSec,
      endSec,
      chars: l.chars.map((c) => {
        const s = Math.max(0, c.startSec + off);
        const e = Math.max(s + 0.03, c.endSec + off);
        return { ...c, startSec: s, endSec: e };
      }),
    };
  });
}

/** 微调单行起止后：有 ASR 字级则重映射，否则按字数重插值 */
export function retimelineKaraokeLine(
  line: KaraokeLine,
  startSec: number,
  endSec: number,
  asrWords?: KaraokeAsrWordTiming[] | null,
): KaraokeLine {
  const s = clampSec(startSec);
  const e = Math.max(s + 0.05, clampSec(endSec));
  if (line.instrumental) {
    return { ...line, startSec: s, endSec: e, chars: [] };
  }
  const text = line.text || line.chars.map((c) => c.text).join('');
  if (asrWords && asrWords.length > 0) {
    const mapped = mapAsrWordsToLineChars(text, s, e, asrWords);
    return {
      ...line,
      text,
      startSec: s,
      endSec: e,
      chars: mapped.chars,
      timingQuality: mapped.usedAsrWords ? 'asr' : 'interpolated',
    };
  }
  return {
    ...line,
    text,
    startSec: s,
    endSec: e,
    chars: interpolateCharsInLine(text, s, e),
    timingQuality: 'interpolated',
  };
}

export interface BuildKaraokeLinesInput {
  lyrics?: string;
  lyricSegments?: DirectorMvLyricSegment[];
  songDurationSec?: number;
  /** fun-asr 字/词级锚点；有则优先映射 */
  asrWords?: KaraokeAsrWordTiming[] | null;
  /** 强制来源；默认自动推断 */
  preferSource?: KaraokeTimingSource;
}

export interface BuildKaraokeLinesResult {
  lines: KaraokeLine[];
  timingSource: KaraokeTimingSource;
  weakAlignment?: boolean;
}

/**
 * 有 asrWords 时：按用户歌词行在 words 流上独立对齐（漏句插值、不拖偏后续）。
 * 保留校准段中的间奏占位（若有）。
 */
function buildLinesWithIndependentAsrAlign(
  vocalTexts: string[],
  asrWords: KaraokeAsrWordTiming[],
  opts?: {
    songDurationSec?: number;
    ids?: Array<string | undefined | null>;
    priorWindows?: Array<{ startSec: number; endSec: number } | null | undefined>;
    instrumentals?: KaraokeLine[];
  },
): BuildKaraokeLinesResult {
  const aligned = alignUserLyricLinesToAsrWords(vocalTexts, asrWords, {
    songDurationSec: opts?.songDurationSec,
    ids: opts?.ids,
    priorWindows: opts?.priorWindows,
  });
  // 不再把 asrWords 传入 prepare：展开过长行时只按用户行文本切分/插值，避免窗口误吃 ASR 原文
  let lines = prepareKaraokeLinesForRender(
    aligned.lines,
    undefined,
    vocalTexts.join('\n'),
  );
  // 若有间奏占位，按时间插入（不覆盖人声行）
  const pads = (opts?.instrumentals || []).filter((l) => l.instrumental);
  if (pads.length > 0) {
    lines = [...lines, ...pads].sort(
      (a, b) => a.startSec - b.startSec || a.endSec - b.endSec,
    );
  }
  return {
    lines,
    timingSource: aligned.usedAsrWords ? 'asrWords' : 'manual',
    weakAlignment: aligned.weakAlignment,
  };
}

/**
 * 从 LRC / 已有 lyricSegments（+ 可选 asrWords）生成字级行。
 */
export function buildKaraokeLinesFromAvailable(
  input: BuildKaraokeLinesInput,
): BuildKaraokeLinesResult {
  const songDur = Math.max(0, Number(input.songDurationSec) || 0);
  const segs = normalizeDirectorMvLyricSegments(input.lyricSegments);
  const vocals = segs.filter((s) => !s.instrumental && String(s.text || '').trim());
  const lyrics = String(input.lyrics || '');
  const asrWords = normalizeAsrWords(input.asrWords);

  const buildFromSegs = (
    list: DirectorMvLyricSegment[],
    base: KaraokeTimingSource,
  ): BuildKaraokeLinesResult => {
    const normalized = normalizeDirectorMvLyricSegments(list);
    if (asrWords.length === 0) {
      return { lines: lyricSegmentsToKaraokeLines(normalized), timingSource: base };
    }
    const vocalSegs = normalized.filter(
      (s) => !s.instrumental && String(s.text || '').trim() && !isDirectorInstrumentalLyricText(s.text),
    );
    const instrumentals = normalized
      .filter((s) => s.instrumental || isDirectorInstrumentalLyricText(String(s.text || '')))
      .map((s, i) => ({
        id: String(s.id || '').trim() || newLineId(9000 + i),
        text: String(s.text || ''),
        startSec: clampSec(s.startSec),
        endSec: Math.max(clampSec(s.startSec) + 0.05, clampSec(s.endSec)),
        chars: [] as KaraokeCharTiming[],
        instrumental: true as const,
      }));
    // 有用户歌词时：显示文本只取用户行，避免 lyricSegments 里残留的 ASR「啦/啊」和声行
    const fromLyrics = splitUserLyricLines(lyrics);
    if (fromLyrics.length > 0) {
      const priorWindows =
        vocalSegs.length === fromLyrics.length
          ? vocalSegs.map((s) => ({ startSec: s.startSec, endSec: s.endSec }))
          : fromLyrics.map((text) => {
              let best: DirectorMvLyricSegment | null = null;
              let bestScore = 0.45;
              for (const s of vocalSegs) {
                const sc = alignTextSimilarity(String(s.text || ''), text);
                if (sc > bestScore) {
                  bestScore = sc;
                  best = s;
                }
              }
              return best ? { startSec: best.startSec, endSec: best.endSec } : null;
            });
      return buildLinesWithIndependentAsrAlign(fromLyrics, asrWords, {
        songDurationSec: songDur,
        priorWindows,
        instrumentals,
      });
    }
    if (vocalSegs.length === 0) {
      return { lines: lyricSegmentsToKaraokeLines(normalized, asrWords), timingSource: base };
    }
    return buildLinesWithIndependentAsrAlign(
      vocalSegs.map((s) => String(s.text || '').trim()),
      asrWords,
      {
        songDurationSec: songDur,
        ids: vocalSegs.map((s) => s.id),
        priorWindows: vocalSegs.map((s) => ({ startSec: s.startSec, endSec: s.endSec })),
        instrumentals,
      },
    );
  };

  if (input.preferSource !== 'lrc' && vocals.length > 0) {
    return buildFromSegs(segs, 'lyricSegments');
  }

  if (looksLikeLrc(lyrics)) {
    const lrcSegs = parseLrcToLyricSegments(lyrics, songDur);
    if (lrcSegs.some((s) => !s.instrumental && String(s.text || '').trim())) {
      return buildFromSegs(lrcSegs, 'lrc');
    }
  }

  if (vocals.length > 0) {
    return buildFromSegs(segs, 'lyricSegments');
  }

  // 纯文本歌词（无 LRC / 无句级段）：有 asrWords 则按行独立对齐
  const plain = splitUserLyricLines(lyrics);
  if (plain.length > 0) {
    if (asrWords.length > 0) {
      return buildLinesWithIndependentAsrAlign(plain, asrWords, { songDurationSec: songDur });
    }
    const end = Math.max(songDur, 1);
    const totalChars = plain.reduce((a, l) => a + Math.max(1, Array.from(l).length), 0) || 1;
    const lines: KaraokeLine[] = [];
    let cursor = 0;
    for (let i = 0; i < plain.length; i++) {
      const share = Math.max(1, Array.from(plain[i]).length) / totalChars;
      const dur = i === plain.length - 1 ? end - cursor : Math.max(0.4, end * share);
      const startSec = cursor;
      const endSec = i === plain.length - 1 ? end : Math.min(end, cursor + dur);
      const text = plain[i];
      lines.push({
        id: newLineId(i),
        text,
        startSec,
        endSec,
        chars: interpolateCharsInLine(text, startSec, endSec),
        timingQuality: 'interpolated',
      });
      cursor = endSec;
    }
    return {
      lines: prepareKaraokeLinesForRender(lines),
      timingSource: 'manual',
      weakAlignment: false,
    };
  }

  return { lines: [], timingSource: 'manual' };
}

/** 用 ASR/校准后的句级 segments（+ 可选字级）生成字级工程行 */
export function buildKaraokeLinesFromCalibratedSegments(
  segments: DirectorMvLyricSegment[],
  asrWords?: KaraokeAsrWordTiming[] | null,
  userLyrics?: string | null,
): BuildKaraokeLinesResult {
  const words = normalizeAsrWords(asrWords);
  const normalized = normalizeDirectorMvLyricSegments(segments);
  if (words.length === 0) {
    return { lines: lyricSegmentsToKaraokeLines(normalized), timingSource: 'asr' };
  }
  const vocalSegs = normalized.filter(
    (s) => !s.instrumental && String(s.text || '').trim() && !isDirectorInstrumentalLyricText(s.text),
  );
  const instrumentals = normalized
    .filter((s) => s.instrumental || isDirectorInstrumentalLyricText(String(s.text || '')))
    .map((s, i) => ({
      id: String(s.id || '').trim() || newLineId(9000 + i),
      text: String(s.text || ''),
      startSec: clampSec(s.startSec),
      endSec: Math.max(clampSec(s.startSec) + 0.05, clampSec(s.endSec)),
      chars: [] as KaraokeCharTiming[],
      instrumental: true as const,
    }));
  const songDur = Math.max(
    0,
    ...normalized.map((s) => Number(s.endSec) || 0),
    words[words.length - 1]?.endSec || 0,
  );
  // 优先用户歌词行作显示文本（校准后的 vocalSegs 理论上已是用户文本；双保险去掉残留 ASR 行）
  const fromLyrics = splitUserLyricLines(String(userLyrics || ''));
  if (fromLyrics.length > 0) {
    const priorWindows =
      vocalSegs.length === fromLyrics.length
        ? vocalSegs.map((s) => ({ startSec: s.startSec, endSec: s.endSec }))
        : fromLyrics.map((text) => {
            let best: DirectorMvLyricSegment | null = null;
            let bestScore = 0.45;
            for (const s of vocalSegs) {
              const sc = alignTextSimilarity(String(s.text || ''), text);
              if (sc > bestScore) {
                bestScore = sc;
                best = s;
              }
            }
            return best ? { startSec: best.startSec, endSec: best.endSec } : null;
          });
    return buildLinesWithIndependentAsrAlign(fromLyrics, words, {
      songDurationSec: songDur,
      priorWindows,
      instrumentals,
    });
  }
  if (vocalSegs.length === 0) {
    return { lines: lyricSegmentsToKaraokeLines(normalized, words), timingSource: 'asr' };
  }
  return buildLinesWithIndependentAsrAlign(
    vocalSegs.map((s) => String(s.text || '').trim()),
    words,
    {
      songDurationSec: songDur,
      ids: vocalSegs.map((s) => s.id),
      priorWindows: vocalSegs.map((s) => ({ startSec: s.startSec, endSec: s.endSec })),
      instrumentals,
    },
  );
}

export function countSingableChars(project: Pick<KaraokeProject, 'lines'>): number {
  return (project.lines || []).reduce(
    (n, l) =>
      n +
      (l.instrumental
        ? 0
        : (l.chars || []).filter((c) => !c.roleTag && !isKaraokeRoleMarker(c.text)).length),
    0,
  );
}

/** 时间轴是否为「句内匀速估算」（非真实字级 ASR） */
export function isInterpolatedKaraokeTiming(source: KaraokeTimingSource | undefined | null): boolean {
  return source === 'asr' || source === 'lyricSegments' || source === 'lrc' || source === 'manual';
}

/** 行是否为弱对齐 / 漏句插值（人工 manual 不算） */
export function isWeakOrInterpolatedKaraokeLine(
  line: KaraokeLine | null | undefined,
): boolean {
  if (!line || line.instrumental) return false;
  return line.timingQuality === 'weak' || line.timingQuality === 'interpolated';
}

/** 按当前 lines 重算 weakLineAlignment（忽略已人工修正的行） */
export function recomputeKaraokeWeakLineAlignment(
  lines: KaraokeLine[] | null | undefined,
): boolean {
  return (lines || []).some((l) => isWeakOrInterpolatedKaraokeLine(l));
}

/** 工程是否含弱对齐/漏句插值行，需 UI 提示 */
export function projectHasWeakLineAlignment(
  project: Pick<KaraokeProject, 'lines' | 'weakLineAlignment'> | null | undefined,
): boolean {
  if (!project) return false;
  // 以 lines 为准；全人工修好后即使旧 flag 仍 true 也不再提示
  if ((project.lines || []).length > 0) {
    return recomputeKaraokeWeakLineAlignment(project.lines);
  }
  return project.weakLineAlignment === true;
}

const MIN_MANUAL_CHAR_DUR = 0.03;

/**
 * 人工改单字起止 + 涟漪消重叠：
 * - 仅改 end（右缘拉长）：固定本字 start，0..i-1 完全不动；与后字重叠则 i+1..n 整体平移（保时长）
 * - 改小 start 撞到前字 → 前字 end 收到新 start（不够则钳制本字 start）
 * - 改大 start 不拉前字；若与后字重叠同样涟漪后移
 * - 最终保证本字及之后相邻不重叠；必要时延长 line.endSec
 * 预览时间条 / 右侧数字 / 滑条共用。
 */
export function applyCharTimingRipple(
  line: KaraokeLine,
  charIndex: number,
  patch: { startSec?: number; endSec?: number },
): KaraokeLine {
  if (!line.chars?.length || charIndex < 0 || charIndex >= line.chars.length) {
    return line;
  }
  const chars = line.chars.map((c) => ({
    ...c,
    startSec: clampSec(c.startSec),
    endSec: Math.max(clampSec(c.startSec) + MIN_MANUAL_CHAR_DUR, clampSec(c.endSec)),
  }));
  const i = charIndex;
  const pinnedStart = chars[i].startSec;
  const patchHasStart = patch.startSec != null && Number.isFinite(patch.startSec);
  const nextStart = patchHasStart ? clampSec(patch.startSec as number) : pinnedStart;
  /** 起未变（仅改 end / 右缘拉长）：不得动前字、不得改本字 start */
  const startUnchanged = !patchHasStart || Math.abs(nextStart - pinnedStart) <= 1e-9;
  const endRaw =
    patch.endSec != null && Number.isFinite(patch.endSec)
      ? clampSec(patch.endSec)
      : chars[i].endSec;
  const appliedStart = startUnchanged ? pinnedStart : nextStart;
  chars[i] = {
    ...chars[i],
    startSec: appliedStart,
    endSec: Math.max(appliedStart + MIN_MANUAL_CHAR_DUR, endRaw),
  };

  // 仅当 start 真正前移撞到前字时才压缩前字；纯拉长 end 路径绝不改 0..i-1
  if (!startUnchanged && i > 0) {
    const prev = chars[i - 1];
    if (prev.endSec > chars[i].startSec + 1e-9) {
      const wantPrevEnd = chars[i].startSec;
      if (wantPrevEnd >= prev.startSec + MIN_MANUAL_CHAR_DUR - 1e-9) {
        prev.endSec = wantPrevEnd;
      } else {
        chars[i].startSec = prev.startSec + MIN_MANUAL_CHAR_DUR;
        prev.endSec = chars[i].startSec;
        chars[i].endSec = Math.max(chars[i].startSec + MIN_MANUAL_CHAR_DUR, chars[i].endSec);
      }
    }
  }

  // 涟漪后移：从本字起，凡与下一字重叠则把后续整段平移（保持各字原时长）
  for (let j = i; j < chars.length - 1; j++) {
    if (chars[j + 1].startSec + 1e-9 >= chars[j].endSec) continue;
    const shift = chars[j].endSec - chars[j + 1].startSec;
    if (!(shift > 1e-9)) continue;
    for (let k = j + 1; k < chars.length; k++) {
      const dur = Math.max(MIN_MANUAL_CHAR_DUR, chars[k].endSec - chars[k].startSec);
      chars[k].startSec = chars[k].startSec + shift;
      chars[k].endSec = chars[k].startSec + dur;
    }
  }

  // 安全扫：保证单调、最短时长。纯拉长 end 时从 i 起扫，且本字 start 保持钉死
  const sweepFrom = startUnchanged ? i : 0;
  for (let j = sweepFrom; j < chars.length; j++) {
    if (startUnchanged && j === i) {
      chars[j].startSec = pinnedStart;
      chars[j].endSec = Math.max(pinnedStart + MIN_MANUAL_CHAR_DUR, clampSec(chars[j].endSec));
      continue;
    }
    chars[j].startSec = clampSec(chars[j].startSec);
    chars[j].endSec = Math.max(chars[j].startSec + MIN_MANUAL_CHAR_DUR, clampSec(chars[j].endSec));
    if (j > 0 && chars[j].startSec < chars[j - 1].endSec - 1e-9) {
      const dur = Math.max(MIN_MANUAL_CHAR_DUR, chars[j].endSec - chars[j].startSec);
      chars[j].startSec = chars[j - 1].endSec;
      chars[j].endSec = chars[j].startSec + dur;
    }
  }

  let lineStart = clampSec(line.startSec);
  let lineEnd = Math.max(lineStart + 0.05, clampSec(line.endSec));
  for (const c of chars) {
    lineStart = Math.min(lineStart, c.startSec);
    lineEnd = Math.max(lineEnd, c.endSec);
  }
  lineStart = Math.max(0, lineStart);

  return {
    ...line,
    startSec: lineStart,
    endSec: lineEnd,
    chars,
    timingQuality: 'manual',
  };
}

/** 人工改单字起止；写入后标 manual，行窗包住全部字（含涟漪消重叠） */
export function patchKaraokeLineCharTiming(
  line: KaraokeLine,
  charIndex: number,
  patch: { startSec?: number; endSec?: number },
): KaraokeLine {
  return applyCharTimingRipple(line, charIndex, patch);
}

/**
 * 人工改行文本：按新文本重建/remap 字级时间。
 * - 相同单元尽量保留原起止
 * - 增字：在相邻锚点时间窗内插值
 * - 删字：相邻字时间合并（锚点保留）
 * - 全无匹配：整行窗均分
 * 写入后标 manual。
 */
export function remapKaraokeLineText(line: KaraokeLine, nextText: string): KaraokeLine {
  const text = normalizeKaraokeRoleMarkersInText(
    String(nextText || '')
      .replace(/\r\n/g, '\n')
      .replace(/\n+/g, '')
      .trim(),
  );
  const lineStart = clampSec(line.startSec);
  const lineEnd = Math.max(lineStart + 0.05, clampSec(line.endSec));
  if (line.instrumental) {
    return { ...line, text, chars: [], timingQuality: 'manual' };
  }
  const newUnits = splitKaraokeUnits(text);
  if (newUnits.length === 0) {
    return { ...line, text, chars: [], timingQuality: 'manual' };
  }
  // 角色标记不参与时间匹配；唱词对唱词 remap 后再编织标记
  const newSingableUnits = newUnits.filter((u) => !isKaraokeRoleMarker(u));
  const oldChars = (line.chars || [])
    .filter((c) => !c.roleTag && !isKaraokeRoleMarker(c.text))
    .map((c) => ({
      ...c,
      startSec: clampSec(c.startSec),
      endSec: Math.max(clampSec(c.startSec) + MIN_MANUAL_CHAR_DUR, clampSec(c.endSec)),
    }));
  const winStart = oldChars.length
    ? Math.min(lineStart, oldChars[0].startSec)
    : lineStart;
  const winEnd = oldChars.length
    ? Math.max(lineEnd, oldChars[oldChars.length - 1].endSec)
    : lineEnd;

  const finish = (singable: KaraokeCharTiming[]): KaraokeLine => {
    const woven = weaveKaraokeRoleChars(newUnits, singable, null).chars;
    let nextStart = winStart;
    let nextEnd = winEnd;
    for (const c of woven) {
      if (c.roleTag) continue;
      nextStart = Math.min(nextStart, c.startSec);
      nextEnd = Math.max(nextEnd, c.endSec);
    }
    return {
      ...line,
      text,
      startSec: Math.max(0, nextStart),
      endSec: Math.max(nextStart + 0.05, nextEnd),
      chars: woven,
      timingQuality: 'manual',
    };
  };

  if (!oldChars.length || !newSingableUnits.length) {
    return finish(
      newSingableUnits.length
        ? interpolateSingableUnits(newSingableUnits, winStart, winEnd)
        : [],
    );
  }

  // 顺序贪婪匹配同文案单元，尽量保留原时间
  const matched: Array<{ newIdx: number; oldIdx: number }> = [];
  let oi = 0;
  for (let ni = 0; ni < newSingableUnits.length; ni++) {
    const want = String(newSingableUnits[ni] || '');
    let found = -1;
    for (let j = oi; j < oldChars.length; j++) {
      if (String(oldChars[j].text || '') === want) {
        found = j;
        break;
      }
    }
    if (found >= 0) {
      matched.push({ newIdx: ni, oldIdx: found });
      oi = found + 1;
    }
  }

  const fillUnits = (units: string[], s: number, e: number): KaraokeCharTiming[] => {
    if (!units.length) return [];
    const start = clampSec(s);
    const end = Math.max(start + MIN_MANUAL_CHAR_DUR * units.length, clampSec(e));
    const weights = units.map((u) => Math.max(1, Array.from(u.replace(/\s/g, '')).length || 1));
    const totalW = weights.reduce((a, b) => a + b, 0) || 1;
    const span = end - start;
    const out: KaraokeCharTiming[] = [];
    let cursor = start;
    for (let i = 0; i < units.length; i++) {
      const share = weights[i] / totalW;
      const dur = i === units.length - 1 ? end - cursor : Math.max(MIN_MANUAL_CHAR_DUR, span * share);
      const cs = cursor;
      const ce = i === units.length - 1 ? end : Math.min(end, cursor + dur);
      out.push({ text: units[i], startSec: cs, endSec: Math.max(cs + 0.03, ce) });
      cursor = ce;
    }
    return out;
  };

  if (matched.length === 0) {
    return finish(fillUnits(newSingableUnits, winStart, winEnd));
  }

  const slots: Array<KaraokeCharTiming | null> = new Array(newSingableUnits.length).fill(null);
  for (const m of matched) {
    const oc = oldChars[m.oldIdx];
    slots[m.newIdx] = {
      text: newSingableUnits[m.newIdx],
      startSec: oc.startSec,
      endSec: Math.max(oc.startSec + MIN_MANUAL_CHAR_DUR, oc.endSec),
    };
  }

  // 匹配锚点之间的缺口：插值填新字；删字则锚点自然贴紧
  let cursor = 0;
  while (cursor < newSingableUnits.length) {
    if (slots[cursor]) {
      cursor += 1;
      continue;
    }
    let gapEnd = cursor;
    while (gapEnd < newSingableUnits.length && !slots[gapEnd]) gapEnd += 1;
    const prev = cursor > 0 ? slots[cursor - 1] : null;
    const next = gapEnd < newSingableUnits.length ? slots[gapEnd] : null;
    const gapStartSec = prev ? prev.endSec : winStart;
    const gapEndSec = next ? next.startSec : winEnd;
    const filled = fillUnits(
      newSingableUnits.slice(cursor, gapEnd),
      gapStartSec,
      Math.max(gapStartSec + 0.03, gapEndSec),
    );
    for (let i = 0; i < filled.length; i++) {
      slots[cursor + i] = filled[i];
    }
    cursor = gapEnd;
  }

  const chars = slots.map((c, i) =>
    c || {
      text: newSingableUnits[i],
      startSec: winStart,
      endSec: winStart + MIN_MANUAL_CHAR_DUR,
    },
  );

  // 单调扫：消重叠、保最短时长
  for (let i = 0; i < chars.length; i++) {
    chars[i].startSec = clampSec(chars[i].startSec);
    chars[i].endSec = Math.max(chars[i].startSec + MIN_MANUAL_CHAR_DUR, clampSec(chars[i].endSec));
    if (i > 0 && chars[i].startSec < chars[i - 1].endSec - 1e-9) {
      const dur = Math.max(MIN_MANUAL_CHAR_DUR, chars[i].endSec - chars[i].startSec);
      chars[i].startSec = chars[i - 1].endSec;
      chars[i].endSec = chars[i].startSec + dur;
    }
  }

  return finish(chars);
}

/** 手动插字单字理想时长：优先吃缝里的 80–200ms，默认约 120ms */
export const INSERT_CHAR_DUR_MIN_SEC = 0.08;
export const INSERT_CHAR_DUR_MAX_SEC = 0.2;
export const INSERT_CHAR_DUR_IDEAL_SEC = 0.12;
/** 句尾外添加时，与末字之间的短间隙 */
const INSERT_TAIL_PAD_SEC = 0.02;

export type AllocateInsertTimingResult = {
  startSec: number;
  endSec: number;
  /** 若需从左邻挤时长：写回 chars[insertIndex-1].endSec */
  prevEndSec?: number;
  /** 若需从右邻挤时长：写回 chars[insertIndex].startSec */
  nextStartSec?: number;
};

function clampInsertDesiredDur(unitCount: number, desiredDurSec?: number): number {
  const n = Math.max(1, Math.floor(unitCount) || 1);
  const per =
    desiredDurSec != null && Number.isFinite(desiredDurSec)
      ? desiredDurSec
      : INSERT_CHAR_DUR_IDEAL_SEC;
  const clampedPer = Math.max(
    INSERT_CHAR_DUR_MIN_SEC,
    Math.min(INSERT_CHAR_DUR_MAX_SEC, per),
  );
  return Math.max(MIN_MANUAL_CHAR_DUR * n, clampedPer * n);
}

/**
 * 手动插字「科学填缝」：在 insertIndex 缝上为新字分配 start/end。
 * - 有 gap：新字只吃缝内空档（落点附近切一段合理时长，不越出 gap）
 * - 几乎无缝：从左右邻字时长各挤一点（对半分），不涟漪后移更远的字
 * - 句首/句尾外：落点附近一小段，不与邻字重叠；句尾可接在末字之后短间隙
 */
export function allocateInsertTiming(
  chars: ReadonlyArray<Pick<KaraokeCharTiming, 'startSec' | 'endSec'>>,
  insertIndex: number,
  preferSec?: number,
  opts?: {
    unitCount?: number;
    lineStartSec?: number;
    lineEndSec?: number;
    desiredDurSec?: number;
  },
): AllocateInsertTimingResult {
  const list = chars || [];
  const idx = Math.max(0, Math.min(list.length, Math.floor(insertIndex)));
  const unitCount = Math.max(1, Math.floor(opts?.unitCount ?? 1) || 1);
  const desired = clampInsertDesiredDur(unitCount, opts?.desiredDurSec);

  const prev = idx > 0 ? list[idx - 1] : null;
  const next = idx < list.length ? list[idx] : null;

  const prevStart = prev ? clampSec(prev.startSec) : 0;
  const prevEnd = prev
    ? Math.max(prevStart + MIN_MANUAL_CHAR_DUR, clampSec(prev.endSec))
    : 0;
  const nextStart = next ? clampSec(next.startSec) : 0;
  const nextEnd = next
    ? Math.max(nextStart + MIN_MANUAL_CHAR_DUR, clampSec(next.endSec))
    : 0;

  const lineLo =
    opts?.lineStartSec != null && Number.isFinite(opts.lineStartSec)
      ? clampSec(opts.lineStartSec)
      : prev
        ? prevStart
        : next
          ? nextStart
          : 0;

  const prefer =
    preferSec != null && Number.isFinite(preferSec) ? clampSec(preferSec) : null;

  // —— 句内自然缝（左邻 end → 右邻 start）——
  if (prev && next) {
    const gapLo = prevEnd;
    const gapHi = Math.max(gapLo, nextStart);
    const naturalGap = gapHi - gapLo;

    if (naturalGap >= desired - 1e-9) {
      // 缝够大：落点附近切一段，不越出 gap、不改邻字
      let start: number;
      if (prefer != null) {
        start = prefer - desired / 2;
      } else {
        start = gapLo + (naturalGap - desired) / 2;
      }
      start = Math.max(gapLo, Math.min(gapHi - desired, start));
      return { startSec: start, endSec: start + desired };
    }

    if (naturalGap >= MIN_MANUAL_CHAR_DUR - 1e-9) {
      // 缝偏小但仍可用：整段吃掉（可略短于理想）
      const use = Math.min(desired, naturalGap);
      let start = gapLo;
      if (prefer != null) {
        start = Math.max(gapLo, Math.min(gapHi - use, prefer - use / 2));
      }
      return { startSec: start, endSec: start + use };
    }

    // 几乎无缝：从左右邻各挤一点（保各自最短时长），新字落在挤出的窗口
    const availPrev = Math.max(0, prevEnd - prevStart - MIN_MANUAL_CHAR_DUR);
    const availNext = Math.max(0, nextEnd - nextStart - MIN_MANUAL_CHAR_DUR);
    let need = Math.max(MIN_MANUAL_CHAR_DUR, desired - Math.max(0, naturalGap));
    let stealPrev = Math.min(availPrev, need / 2);
    let stealNext = Math.min(availNext, need - stealPrev);
    let remain = need - stealPrev - stealNext;
    if (remain > 1e-9) {
      stealPrev += Math.min(availPrev - stealPrev, remain);
      remain = need - stealPrev - stealNext;
    }
    if (remain > 1e-9) {
      stealNext += Math.min(availNext - stealNext, remain);
    }
    const newPrevEnd = prevEnd - stealPrev;
    const newNextStart = nextStart + stealNext;
    const winLo = Math.min(newPrevEnd, newNextStart);
    const winHi = Math.max(newPrevEnd, newNextStart);
    const use = Math.max(MIN_MANUAL_CHAR_DUR, Math.min(desired, winHi - winLo));
    let start = winLo;
    if (prefer != null) {
      start = Math.max(winLo, Math.min(winHi - use, prefer - use / 2));
    }
    return {
      startSec: start,
      endSec: start + use,
      prevEndSec: newPrevEnd,
      nextStartSec: newNextStart,
    };
  }

  // —— 句首（无左邻）——
  if (!prev && next) {
    const hardHi = nextStart;
    const availNext = Math.max(0, nextEnd - nextStart - MIN_MANUAL_CHAR_DUR);
    let winHi = hardHi;
    let stealNext = 0;
    let winLo = Math.max(0, Math.min(lineLo, hardHi));
    // 优先落点左侧空档；不够再从右邻起点挤
    const room = Math.max(0, winHi - winLo);
    if (room < desired - 1e-9 && availNext > 1e-9) {
      stealNext = Math.min(availNext, desired - room);
      winHi = hardHi + stealNext;
    }
    const use = Math.max(
      MIN_MANUAL_CHAR_DUR,
      Math.min(desired, Math.max(MIN_MANUAL_CHAR_DUR, winHi - winLo)),
    );
    let start: number;
    if (prefer != null) {
      start = prefer - use / 2;
    } else {
      start = winHi - use;
    }
    start = Math.max(winLo, Math.min(winHi - use, start));
    // 保证不与右邻（挤完后）重叠
    const nextStartAfter = nextStart + stealNext;
    if (start + use > nextStartAfter + 1e-9) {
      start = Math.max(winLo, nextStartAfter - use);
    }
    return {
      startSec: start,
      endSec: start + use,
      ...(stealNext > 1e-9 ? { nextStartSec: nextStartAfter } : {}),
    };
  }

  // —— 句尾（无右邻）——
  if (prev && !next) {
    const availPrev = Math.max(0, prevEnd - prevStart - MIN_MANUAL_CHAR_DUR);
    // 默认接在末字之后短间隙；若落点仍在末字内且几乎无尾缝，则从末字挤一点
    const afterLo = prevEnd + INSERT_TAIL_PAD_SEC;
    const preferInPrev =
      prefer != null && prefer < prevEnd - 1e-6 && prefer > prevStart + 1e-6;
    if (preferInPrev && availPrev > MIN_MANUAL_CHAR_DUR) {
      const use = Math.min(desired, availPrev);
      let start = Math.max(prevStart + MIN_MANUAL_CHAR_DUR, prefer! - use / 2);
      start = Math.min(start, prevEnd - use);
      const newPrevEnd = start;
      return {
        startSec: start,
        endSec: start + use,
        prevEndSec: newPrevEnd,
      };
    }
    const use = desired;
    let start = afterLo;
    if (prefer != null && prefer >= prevEnd - 1e-6) {
      start = Math.max(afterLo, prefer - use / 2);
    }
    // 若落点卡在末字尾且无空档可接：从末字挤出一段再接
    if (prefer != null && prefer < afterLo && availPrev > 1e-9) {
      const steal = Math.min(availPrev, use);
      const newPrevEnd = prevEnd - steal;
      return {
        startSec: newPrevEnd,
        endSec: newPrevEnd + use,
        prevEndSec: newPrevEnd,
      };
    }
    return { startSec: start, endSec: start + use };
  }

  // —— 空行 ——
  const use = desired;
  let start = prefer != null ? Math.max(lineLo, prefer - use / 2) : lineLo;
  start = Math.max(0, start);
  return { startSec: start, endSec: start + use };
}

/**
 * 在字轨指定下标插入新字（可多单元）：科学填缝分配时长，默认不涟漪后移后续字。
 * `preferSec` 为右键落点/播放头（存盘时间，不含全局偏移）。
 */
export function insertKaraokeLineChars(
  line: KaraokeLine,
  atIndex: number,
  insertText: string,
  opts?: { preferSec?: number },
): KaraokeLine {
  const raw = normalizeKaraokeRoleMarkersInText(
    String(insertText || '')
      .replace(/\r\n/g, '\n')
      .replace(/\n+/g, '')
      .trim(),
  );
  if (!raw || line.instrumental) return line;
  const units = splitKaraokeUnits(raw);
  if (!units.length) return line;

  const chars = (line.chars || []).map((c) => ({
    ...c,
    startSec: clampSec(c.startSec),
    endSec: Math.max(clampSec(c.startSec) + MIN_MANUAL_CHAR_DUR, clampSec(c.endSec)),
  }));
  const idx = Math.max(0, Math.min(chars.length, Math.floor(atIndex)));
  const prev = idx > 0 ? chars[idx - 1] : null;
  const next = idx < chars.length ? chars[idx] : null;
  const inheritRole =
    (!prev?.roleTag && prev?.role) || (!next?.roleTag && next?.role) || undefined;

  const alloc = allocateInsertTiming(chars, idx, opts?.preferSec, {
    unitCount: units.length,
    lineStartSec: line.startSec,
    lineEndSec: line.endSec,
  });

  if (alloc.prevEndSec != null && prev) {
    prev.endSec = Math.max(prev.startSec + MIN_MANUAL_CHAR_DUR, clampSec(alloc.prevEndSec));
  }
  if (alloc.nextStartSec != null && next) {
    next.startSec = Math.min(next.endSec - MIN_MANUAL_CHAR_DUR, clampSec(alloc.nextStartSec));
    if (next.startSec < next.endSec - 1e-9) {
      // ok
    } else {
      next.startSec = Math.max(next.endSec - MIN_MANUAL_CHAR_DUR, next.startSec);
    }
  }

  const gapStart = clampSec(alloc.startSec);
  const gapEnd = Math.max(gapStart + MIN_MANUAL_CHAR_DUR, clampSec(alloc.endSec));
  // 挤缝后仍可能与邻字微重叠：钳进实际可用窗，绝不涟漪后移
  const hardLo = prev ? prev.endSec : 0;
  const hardHi = next ? next.startSec : gapEnd + 1;
  const winLo = Math.max(gapStart, prev ? hardLo : gapStart);
  const winHi = next ? Math.max(winLo + MIN_MANUAL_CHAR_DUR, Math.min(gapEnd, hardHi)) : gapEnd;
  const span = Math.max(MIN_MANUAL_CHAR_DUR, winHi - winLo);

  const weights = units.map((u) => Math.max(1, Array.from(u.replace(/\s/g, '')).length || 1));
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;
  const inserted: KaraokeCharTiming[] = [];
  let cursor = winLo;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const roleTag = isKaraokeRoleMarker(u);
    const role = roleTag ? parseKaraokeRoleMarker(u) || undefined : inheritRole;
    const share = weights[i] / totalW;
    const dur =
      i === units.length - 1 ? winLo + span - cursor : Math.max(MIN_MANUAL_CHAR_DUR, span * share);
    const cs = cursor;
    const ce = i === units.length - 1 ? winLo + span : Math.min(winLo + span, cursor + dur);
    inserted.push({
      text: roleTag ? displayKaraokeRoleMarker(u, role) : u,
      startSec: cs,
      endSec: roleTag ? cs : Math.max(cs + MIN_MANUAL_CHAR_DUR, ce),
      ...(roleTag ? { roleTag: true as const } : {}),
      ...(role ? { role } : {}),
    });
    cursor = roleTag ? cs : ce;
  }

  const nextChars = [...chars.slice(0, idx), ...inserted, ...chars.slice(idx)];
  let lineStart = clampSec(line.startSec);
  let lineEnd = Math.max(lineStart + 0.05, clampSec(line.endSec));
  for (const c of nextChars) {
    lineStart = Math.min(lineStart, c.startSec);
    lineEnd = Math.max(lineEnd, c.endSec);
  }

  return {
    ...line,
    text: nextChars.map((c) => c.text).join(''),
    chars: nextChars,
    startSec: Math.max(0, lineStart),
    endSec: Math.max(lineStart + 0.05, lineEnd),
    timingQuality: 'manual',
  };
}

/**
 * 跨行挪字：按时间插入目标行，尽量保留原 start/end。
 * - 落在邻字缝内且不重叠 → 原样保留时间
 * - 与邻字重叠 → allocateInsertTiming 填缝（仅微调左右邻，不涟漪更远的字）
 * - 同步 text / 行窗，标 manual
 */
export function insertKaraokeCharPreservingTiming(
  line: KaraokeLine,
  char: KaraokeCharTiming,
): { line: KaraokeLine; index: number } {
  if (line.instrumental) return { line, index: -1 };

  const preferStart = clampSec(char.startSec);
  const preferEnd = Math.max(
    preferStart + MIN_MANUAL_CHAR_DUR,
    clampSec(char.endSec),
  );
  const preferDur = Math.max(MIN_MANUAL_CHAR_DUR, preferEnd - preferStart);

  const chars = (line.chars || []).map((c) => ({
    ...c,
    startSec: clampSec(c.startSec),
    endSec: Math.max(clampSec(c.startSec) + MIN_MANUAL_CHAR_DUR, clampSec(c.endSec)),
  }));

  // 按 preferStart 找插入下标（落在字上则插到其后，落在间隙则插到下一字前）
  let atIndex = chars.length;
  for (let i = 0; i < chars.length; i++) {
    const s = chars[i].startSec;
    if (preferStart < s - 1e-6) {
      atIndex = i;
      break;
    }
    const e = Math.max(s, chars[i].endSec);
    if (preferStart >= s - 1e-6 && preferStart < e + 1e-6) {
      atIndex = i + 1;
      break;
    }
  }

  const prev = atIndex > 0 ? chars[atIndex - 1] : null;
  const next = atIndex < chars.length ? chars[atIndex] : null;
  const gapLo = prev ? prev.endSec : 0;
  const gapHi = next ? next.startSec : Number.POSITIVE_INFINITY;
  const fitsClean =
    preferStart >= gapLo - 1e-6 &&
    preferEnd <= gapHi + 1e-6 &&
    preferDur <= Math.max(MIN_MANUAL_CHAR_DUR, gapHi - gapLo) + 1e-6;

  // 原时间落在目标句既有窗之前的「虚空缝」：若原样保留会把整句 start 前拉（下一句位置漂移）
  const lineAnchor = chars.length
    ? Math.min(clampSec(line.startSec), chars[0].startSec)
    : clampSec(line.startSec);
  const wouldYankLineStart =
    !prev && chars.length > 0 && preferStart < lineAnchor - 1e-3;

  let movedStart = preferStart;
  let movedEnd = preferEnd;

  if (!fitsClean || wouldYankLineStart) {
    const alloc = allocateInsertTiming(chars, atIndex, preferStart, {
      unitCount: 1,
      lineStartSec: line.startSec,
      lineEndSec: line.endSec,
      desiredDurSec: preferDur,
    });
    if (alloc.prevEndSec != null && prev) {
      prev.endSec = Math.max(
        prev.startSec + MIN_MANUAL_CHAR_DUR,
        clampSec(alloc.prevEndSec),
      );
    }
    if (alloc.nextStartSec != null && next) {
      next.startSec = Math.min(
        next.endSec - MIN_MANUAL_CHAR_DUR,
        clampSec(alloc.nextStartSec),
      );
      if (next.startSec > next.endSec - MIN_MANUAL_CHAR_DUR) {
        next.startSec = Math.max(next.endSec - MIN_MANUAL_CHAR_DUR, next.startSec);
      }
    }
    const hardLo = prev ? prev.endSec : 0;
    const hardHi = next ? next.startSec : clampSec(alloc.endSec) + 1;
    movedStart = Math.max(hardLo, clampSec(alloc.startSec));
    movedEnd = next
      ? Math.max(movedStart + MIN_MANUAL_CHAR_DUR, Math.min(clampSec(alloc.endSec), hardHi))
      : Math.max(movedStart + MIN_MANUAL_CHAR_DUR, clampSec(alloc.endSec));
  }

  const moved: KaraokeCharTiming = {
    ...char,
    startSec: movedStart,
    endSec: Math.max(movedStart + MIN_MANUAL_CHAR_DUR, movedEnd),
  };
  const nextChars = [...chars.slice(0, atIndex), moved, ...chars.slice(atIndex)];

  // 行窗只跟本行字走：不涟漪其它行；若字落在原窗内则行起止可不变
  let lineStart = clampSec(line.startSec);
  let lineEnd = Math.max(lineStart + 0.05, clampSec(line.endSec));
  for (const c of nextChars) {
    if (c.roleTag) continue;
    lineStart = Math.min(lineStart, c.startSec);
    lineEnd = Math.max(lineEnd, c.endSec);
  }

  return {
    line: {
      ...line,
      text: nextChars.map((c) => c.text).join(''),
      chars: nextChars,
      startSec: Math.max(0, lineStart),
      endSec: Math.max(lineStart + 0.05, lineEnd),
      timingQuality: 'manual',
    },
    index: atIndex,
  };
}

/**
 * 按已改动的可唱行回写第 1 步歌词：保留未改行原文，避免整篇重切导致行边界漂移。
 * `changedLineIds` 对应的可唱行用 line.text（或 chars 拼接）替换；其余行尽量沿用旧 lyrics 对应行。
 */
export function patchKaraokeLyricsForChangedLines(
  prevLyrics: string,
  nextLines: KaraokeLine[] | null | undefined,
  changedLineIds: ReadonlyArray<string>,
): string {
  const singable = (nextLines || []).filter((l) => !l.instrumental);
  if (!singable.length) return String(prevLyrics || '');

  const changed = new Set(
    (changedLineIds || []).map((id) => String(id || '').trim()).filter(Boolean),
  );
  const prevParts = String(prevLyrics || '')
    .replace(/\r\n/g, '\n')
    .split('\n');

  // 旧 lyrics 与可唱行按序对齐（含空行，避免删空句后行数错位）
  const out: string[] = [];
  for (let i = 0; i < singable.length; i++) {
    const line = singable[i];
    const fromLine = normalizeKaraokeRoleMarkersInText(
      String(line.text || line.chars?.map((c) => c.text).join('') || '').trim(),
    );
    if (changed.has(line.id)) {
      out.push(fromLine);
      continue;
    }
    const fromPrev =
      i < prevParts.length
        ? normalizeKaraokeRoleMarkersInText(String(prevParts[i] || '').trim())
        : '';
    // 未改动行：优先旧 lyrics；若旧稿缺行则用当前 line 文本兜底
    out.push(fromPrev || fromLine);
  }
  return out.join('\n');
}

/** 删除字轨上指定下标的字；同步 text，标 manual。删空则清空 chars。 */
export function deleteKaraokeLineChar(line: KaraokeLine, charIndex: number): KaraokeLine {
  const chars = line.chars || [];
  if (charIndex < 0 || charIndex >= chars.length || line.instrumental) return line;
  const nextChars = chars.filter((_, i) => i !== charIndex).map((c) => ({ ...c }));
  if (!nextChars.length) {
    return {
      ...line,
      text: '',
      chars: [],
      timingQuality: 'manual',
    };
  }
  let lineStart = clampSec(line.startSec);
  let lineEnd = Math.max(lineStart + 0.05, clampSec(line.endSec));
  for (const c of nextChars) {
    lineStart = Math.min(lineStart, clampSec(c.startSec));
    lineEnd = Math.max(lineEnd, clampSec(c.endSec));
  }
  return {
    ...line,
    text: nextChars.map((c) => c.text).join(''),
    chars: nextChars,
    startSec: Math.max(0, lineStart),
    endSec: Math.max(lineStart + 0.05, lineEnd),
    timingQuality: 'manual',
  };
}

/**
 * 由可唱行拼接「第一步」歌词正文（一行一句）；
 * 角色标记：括号形→半角括号，冒号形→全角中文冒号；普通歌词半角 `:` 亦转全角。
 * 保留空行（已掏空的可唱句），避免行数变少导致后续句与第1步错位、双行奇偶翻轨。
 */
export function lyricsTextFromKaraokeLines(lines: KaraokeLine[] | null | undefined): string {
  return (lines || [])
    .filter((l) => !l.instrumental)
    .map((l) =>
      normalizeKaraokeRoleMarkersInText(
        String(l.text || l.chars?.map((c) => c.text).join('') || '').trim(),
      ),
    )
    .join('\n');
}

/**
 * 人工改行窗：按旧窗比例拉伸字级，不重跑 ASR / 不重插值。
 * 适合整句略早/略晚时先挪窗，再细调个别字。
 */
export function rescaleKaraokeLineTiming(
  line: KaraokeLine,
  startSec: number,
  endSec: number,
): KaraokeLine {
  const s = clampSec(startSec);
  const e = Math.max(s + 0.05, clampSec(endSec));
  if (line.instrumental) {
    return { ...line, startSec: s, endSec: e, chars: [], timingQuality: 'manual' };
  }
  const oldS = clampSec(line.startSec);
  const oldE = Math.max(oldS + 0.05, clampSec(line.endSec));
  const oldSpan = oldE - oldS;
  const newSpan = e - s;
  const text = line.text || line.chars.map((c) => c.text).join('');
  if (!line.chars?.length) {
    return {
      ...line,
      text,
      startSec: s,
      endSec: e,
      chars: interpolateCharsInLine(text, s, e),
      timingQuality: 'manual',
    };
  }
  const chars = line.chars.map((c) => {
    const cs = clampSec(c.startSec);
    const ce = Math.max(cs + MIN_MANUAL_CHAR_DUR, clampSec(c.endSec));
    const t0 = (cs - oldS) / oldSpan;
    const t1 = (ce - oldS) / oldSpan;
    const ns = s + Math.max(0, Math.min(1, t0)) * newSpan;
    const ne = s + Math.max(0, Math.min(1, t1)) * newSpan;
    return {
      ...c,
      startSec: ns,
      endSec: Math.max(ns + MIN_MANUAL_CHAR_DUR, ne),
    };
  });
  return {
    ...line,
    text,
    startSec: s,
    endSec: e,
    chars,
    timingQuality: 'manual',
  };
}
