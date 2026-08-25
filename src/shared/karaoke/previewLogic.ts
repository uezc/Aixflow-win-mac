/**
 * 卡拉OK 预览/CSS 烧录共用的纯逻辑（选行、wipe 比例、样式合并、PlayRes 布局）。
 * 与 KaraokeSubtitleEditor 预览路径保持一致，供离屏烧录窗口复用。
 */

import { estimateAssTextWidth, karaokeLineSingEndSec, karaokeLineSingStartSec, karaokeCharWipeVisualEndSec } from './buildAss.js';
import {
  ASS_PLAY_RES_X,
  ASS_PLAY_RES_Y,
  clampKaraokeLineFadeOutSec,
  clampKaraokeOutline,
  DEFAULT_KARAOKE_STYLE,
  KARAOKE_LINE_FADE_OUT_SEC,
  KARAOKE_LYRIC_OUTLINE_DEFAULT,
  KARAOKE_LYRIC_SHADOW_DEFAULT,
  KARAOKE_LYRIC_SUNG_OUTLINE_DEFAULT,
  karaokeClampAppearAfterInterludes,
  karaokeCountdownLitDots,
  karaokeCountdownWindowStartSec,
  karaokeLineDisplayAppearSec,
  karaokeLineFadeOutOpacity,
  karaokeLineVisibleEndSec,
  karaokeReentryTimeline,
  karaokeSelectCountdownReentryLineIndexes,
  resolveKaraokeCountdown,
  resolveKaraokeInterludeTiming,
  resolveKaraokeRoleColors,
  type KaraokeCharTiming,
  type KaraokeCountdownOptions,
  type KaraokeCountdownWindow,
  type KaraokeLine,
  type KaraokeOpeningTimeline,
  type KaraokePos,
  type KaraokeStyleOptions,
} from './types.js';

const PREVIEW_EDGE_MARGIN_PX = 12;

export function buildRoundedTextOutlineShadow(
  outlinePx: number,
  outlineColor: string,
  extraLayers: string[] = [],
  opts?: { fast?: boolean },
): string {
  const layers: string[] = [];
  const r = Math.max(0, outlinePx);
  if (r > 0.01) {
    const rings = opts?.fast
      ? Math.max(1, Math.min(2, Math.ceil(r)))
      : Math.max(1, Math.ceil(r));
    const steps = opts?.fast
      ? Math.max(8, Math.min(12, Math.round(6 + r * 2)))
      : Math.max(12, Math.min(28, Math.round(8 + r * 3)));
    for (let ring = 1; ring <= rings; ring++) {
      const radius = (r * ring) / rings;
      for (let i = 0; i < steps; i++) {
        const a = (i * 2 * Math.PI) / steps;
        layers.push(
          `${(Math.cos(a) * radius).toFixed(2)}px ${(Math.sin(a) * radius).toFixed(2)}px 0 ${outlineColor}`,
        );
      }
    }
  }
  for (const extra of extraLayers) {
    if (extra) layers.push(extra);
  }
  return layers.length ? layers.join(', ') : 'none';
}

/**
 * 正歌描边：未唱侧用 `outer`（outline）；已唱半边只用 `sungOutline`（inner 参数保留兼容）。
 * 半扫时：底层未唱字+未唱描边；上层已唱半边带白边 + 角色填色，用 overflow 遮罩从左扫到右。
 */
export function buildKaraokeFixedLyricOutlineShadow(
  outerPx: number,
  outerColor: string,
  _innerPx: number,
  _innerColor: string,
  extraLayers: string[] = [],
  opts?: { fast?: boolean },
): string {
  void _innerPx;
  void _innerColor;
  const outer = Math.max(0, Number(outerPx) || 0);
  if (outer > 0.01) {
    return buildRoundedTextOutlineShadow(outer, outerColor, extraLayers, opts);
  }
  if (extraLayers.length) {
    const parts = extraLayers.filter(Boolean);
    return parts.length ? parts.join(', ') : 'none';
  }
  return 'none';
}

/** 已唱半边 / 唱完 hold 用的白描边 */
export function buildKaraokeSungOutlineShadow(
  sungOutlinePx: number,
  sungOutlineColor: string,
  extraLayers: string[] = [],
  opts?: { fast?: boolean },
): string {
  return buildKaraokeFixedLyricOutlineShadow(
    sungOutlinePx,
    sungOutlineColor,
    0,
    'transparent',
    extraLayers,
    opts,
  );
}

export function karaokePreviewSoftGlowLayers(outlinePx: number, shadowPx: number): string[] {
  if (!(outlinePx > 0)) return [];
  const base = Math.max(outlinePx * 0.55, shadowPx * 0.25, 0.5);
  return [
    `0 0 ${(base * 1.0).toFixed(2)}px rgba(255,255,255,0.22)`,
    `0 0 ${(base * 1.7).toFixed(2)}px rgba(255,255,255,0.1)`,
  ];
}

export function mergeKaraokePreviewStyle(
  base: KaraokeStyleOptions | undefined,
  patch: Partial<KaraokeStyleOptions> = {},
): KaraokeStyleOptions {
  const merged = {
    ...DEFAULT_KARAOKE_STYLE,
    ...(base || {}),
    ...patch,
  };
  const roleColors = resolveKaraokeRoleColors({
    ...DEFAULT_KARAOKE_STYLE.roleColors,
    ...(base?.roleColors || {}),
    ...(patch.roleColors || {}),
  });
  const sungOutlineWidth = clampKaraokeOutline(
    merged.sungOutlineWidth,
    KARAOKE_LYRIC_SUNG_OUTLINE_DEFAULT,
  );
  return {
    ...merged,
    roleColors,
    sungColor: roleColors.male,
    outline: clampKaraokeOutline(merged.outline, KARAOKE_LYRIC_OUTLINE_DEFAULT),
    sungOutlineWidth,
    shadow: KARAOKE_LYRIC_SHADOW_DEFAULT,
    posA: { ...(patch.posA || base?.posA || DEFAULT_KARAOKE_STYLE.posA) },
    posB: { ...(patch.posB || base?.posB || DEFAULT_KARAOKE_STYLE.posB) },
    openingTitlePos: {
      ...(patch.openingTitlePos || base?.openingTitlePos || DEFAULT_KARAOKE_STYLE.openingTitlePos),
    },
    openingLyricistPos: {
      ...(patch.openingLyricistPos ||
        base?.openingLyricistPos ||
        DEFAULT_KARAOKE_STYLE.openingLyricistPos),
    },
    openingComposerPos: {
      ...(patch.openingComposerPos ||
        base?.openingComposerPos ||
        DEFAULT_KARAOKE_STYLE.openingComposerPos),
    },
    indicator: {
      ...DEFAULT_KARAOKE_STYLE.indicator,
      ...(base?.indicator || {}),
      ...(patch.indicator || {}),
    },
    countdown: (() => {
      const mergedCd = {
        ...DEFAULT_KARAOKE_STYLE.countdown,
        ...(base?.countdown || {}),
        ...(patch.countdown || {}),
      };
      const resolved = resolveKaraokeCountdown(
        patch.countdown && 'anchor' in patch.countdown
          ? { ...mergedCd, anchor: patch.countdown.anchor, positions: [] }
          : {
              ...mergedCd,
              positions: base?.countdown?.positions || patch.countdown?.positions || [],
            },
      );
      return {
        ...mergedCd,
        anchor: resolved.anchor,
        positions: [],
      };
    })(),
  };
}

export function singableLines(lines: KaraokeLine[]): KaraokeLine[] {
  return lines.filter((l) => !l.instrumental);
}

export function contentfulSingableLines(lines: KaraokeLine[]): KaraokeLine[] {
  return lines.filter(
    (l) => !l.instrumental && (l.chars?.length || String(l.text || '').trim()),
  );
}

export function lineWipeWindow(line: KaraokeLine): { start: number; end: number } {
  const start0 = Number(line.startSec) || 0;
  const end0 = Math.max(start0 + 0.05, Number(line.endSec) || 0);
  if (!line.chars?.length) return { start: start0, end: end0 };
  const singStart = karaokeLineSingStartSec(line);
  const lastEnd = line.chars.reduce(
    (m, c) => (c.roleTag ? m : Math.max(m, c.endSec)),
    start0,
  );
  return {
    start: Math.min(start0, singStart),
    end: Math.max(end0, lastEnd),
  };
}

export function findActiveSingableIndex(lines: KaraokeLine[], t: number): number {
  const singable = singableLines(lines);
  if (!singable.length) return -1;

  let bestCharIdx = -1;
  let bestCharStart = -Infinity;
  for (let i = 0; i < singable.length; i++) {
    const line = singable[i];
    if (!line.chars?.length) continue;
    const start = karaokeLineSingStartSec(line);
    const end = karaokeLineSingEndSec(line);
    if (t >= start && t < end && start >= bestCharStart) {
      bestCharIdx = i;
      bestCharStart = start;
    }
  }
  if (bestCharIdx >= 0) return bestCharIdx;

  let bestLineIdx = -1;
  let bestLineStart = -Infinity;
  for (let i = 0; i < singable.length; i++) {
    const line = singable[i];
    const start = Number(line.startSec) || 0;
    const end = karaokeLineSingEndSec(line);
    if (t >= start && t < end && start >= bestLineStart) {
      bestLineIdx = i;
      bestLineStart = start;
    }
  }
  return bestLineIdx;
}

export function findFadingSingableLine(
  lines: KaraokeLine[],
  t: number,
  fadeOutSec: number = KARAOKE_LINE_FADE_OUT_SEC,
): { idx: number; line: KaraokeLine; opacity: number } | null {
  const fade = clampKaraokeLineFadeOutSec(fadeOutSec);
  const singable = singableLines(lines);
  for (let i = singable.length - 1; i >= 0; i--) {
    const line = singable[i];
    const singEnd = karaokeLineSingEndSec(line);
    if (t < singEnd - 1e-6) continue;
    const nextSingStart =
      i + 1 < singable.length ? karaokeLineSingStartSec(singable[i + 1]) : null;
    const visibleEnd = karaokeLineVisibleEndSec(singEnd, nextSingStart, fade);
    const opacity = karaokeLineFadeOutOpacity(visibleEnd, t, fade, singEnd);
    if (opacity > 0.001) {
      return { idx: i, line, opacity };
    }
  }
  return null;
}

export function findNextSingableIndex(
  lines: KaraokeLine[],
  t: number,
  opts?: {
    firstLyricAppearSec?: number;
    dual?: boolean;
    fadeOutSec?: number;
    gapThresholdSec?: number;
    countdownGapThresholdSec?: number;
    leadInMaxSec?: number;
  },
): number {
  const singable = singableLines(lines);
  const dual = !!opts?.dual;
  const fade = clampKaraokeLineFadeOutSec(opts?.fadeOutSec ?? KARAOKE_LINE_FADE_OUT_SEC);
  const timing = resolveKaraokeInterludeTiming({
    interludeClearGapSec: opts?.gapThresholdSec,
    countdownReentryGapSec: opts?.countdownGapThresholdSec,
    countdownLeadInMaxSec: opts?.leadInMaxSec,
  });
  const singMeta = singable.map((l) => ({
    singStart: karaokeLineSingStartSec(l),
    singEnd: karaokeLineSingEndSec(l),
  }));
  const countdownReentrySet = new Set(
    karaokeSelectCountdownReentryLineIndexes(singMeta, {
      fadeOutSec: fade,
      gapThresholdSec: timing.countdownReentryGapSec,
      leadInMaxSec: timing.countdownLeadInMaxSec,
    }),
  );
  const appearOpts = {
    fadeOutSec: fade,
    gapThresholdSec: timing.interludeClearGapSec,
    countdownGapThresholdSec: timing.countdownReentryGapSec,
    leadInMaxSec: timing.countdownLeadInMaxSec,
    countdownReentryIndexes: countdownReentrySet,
  };
  for (let i = 0; i < singable.length; i++) {
    const singStart = singMeta[i].singStart;
    if (!(t < singStart)) continue;
    if (i === 0 && opts?.firstLyricAppearSec != null) {
      if (t < opts.firstLyricAppearSec - 1e-6) return -1;
      return i;
    }
    const prevAdj = i - 1;
    const prevSame = dual ? i - 2 : i - 1;
    let appear: number;
    if (i === 0) {
      appear = karaokeLineDisplayAppearSec(singStart, {
        isFirstLine: true,
        firstLyricAppearSec: opts?.firstLyricAppearSec,
        fadeOutSec: fade,
      });
    } else if (dual && i === 1 && prevSame < 0) {
      appear = Math.min(
        singStart,
        karaokeLineDisplayAppearSec(singMeta[0].singStart, {
          isFirstLine: true,
          firstLyricAppearSec: opts?.firstLyricAppearSec,
          fadeOutSec: fade,
        }),
      );
      appear = karaokeClampAppearAfterInterludes(
        appear,
        singStart,
        i,
        singMeta,
        appearOpts,
      );
    } else {
      appear = karaokeLineDisplayAppearSec(singStart, {
        prevAdjacentSingEndSec: prevAdj >= 0 ? singMeta[prevAdj].singEnd : null,
        prevSameSlotSingEndSec: prevSame >= 0 ? singMeta[prevSame].singEnd : null,
        fadeOutSec: fade,
        isCountdownReentry: countdownReentrySet.has(i),
        gapThresholdSec: timing.interludeClearGapSec,
        countdownGapThresholdSec: timing.countdownReentryGapSec,
        leadInMaxSec: timing.countdownLeadInMaxSec,
      });
      appear = karaokeClampAppearAfterInterludes(appear, singStart, i, singMeta, appearOpts);
    }
    if (t < appear - 1e-6) {
      if (!dual) return -1;
      continue;
    }
    return i;
  }
  return -1;
}

export type DualSlotState = {
  line: KaraokeLine | null;
  idx: number;
  fade: number;
  held: boolean;
  singing: boolean;
  awaiting: boolean;
};

export function resolveDualSlotAtTime(
  singable: KaraokeLine[],
  t: number,
  slotIsA: boolean,
  opts?: {
    firstLyricAppearSec?: number;
    fadeOutSec?: number;
    gapThresholdSec?: number;
    countdownGapThresholdSec?: number;
    leadInMaxSec?: number;
  },
): DualSlotState {
  const empty: DualSlotState = {
    line: null,
    idx: -1,
    fade: 1,
    held: false,
    singing: false,
    awaiting: false,
  };
  if (!singable.length) return empty;

  const lineFade = clampKaraokeLineFadeOutSec(opts?.fadeOutSec ?? KARAOKE_LINE_FADE_OUT_SEC);
  const timing = resolveKaraokeInterludeTiming({
    interludeClearGapSec: opts?.gapThresholdSec,
    countdownReentryGapSec: opts?.countdownGapThresholdSec,
    countdownLeadInMaxSec: opts?.leadInMaxSec,
  });
  const onSlot = (i: number) => (i % 2 === 0) === slotIsA;
  const singMeta = singable.map((l) => ({
    singStart: karaokeLineSingStartSec(l),
    singEnd: karaokeLineSingEndSec(l),
  }));
  const countdownReentrySet = new Set(
    karaokeSelectCountdownReentryLineIndexes(singMeta, {
      fadeOutSec: lineFade,
      gapThresholdSec: timing.countdownReentryGapSec,
      leadInMaxSec: timing.countdownLeadInMaxSec,
    }),
  );
  const clampOpts = {
    fadeOutSec: lineFade,
    gapThresholdSec: timing.interludeClearGapSec,
    countdownGapThresholdSec: timing.countdownReentryGapSec,
    leadInMaxSec: timing.countdownLeadInMaxSec,
    countdownReentryIndexes: countdownReentrySet,
  };

  const dualAppearSec = (i: number): number => {
    const singStart = singMeta[i].singStart;
    const prevSame = i - 2;
    const prevAdj = i - 1;
    let appear: number;
    if (i === 0) {
      appear = karaokeLineDisplayAppearSec(singStart, {
        isFirstLine: true,
        firstLyricAppearSec: opts?.firstLyricAppearSec,
        fadeOutSec: lineFade,
      });
    } else if (i === 1 && prevSame < 0) {
      appear = Math.min(singStart, dualAppearSec(0));
    } else {
      appear = karaokeLineDisplayAppearSec(singStart, {
        prevAdjacentSingEndSec: prevAdj >= 0 ? singMeta[prevAdj].singEnd : null,
        prevSameSlotSingEndSec: prevSame >= 0 ? singMeta[prevSame].singEnd : null,
        fadeOutSec: lineFade,
        isCountdownReentry: countdownReentrySet.has(i),
        gapThresholdSec: timing.interludeClearGapSec,
        countdownGapThresholdSec: timing.countdownReentryGapSec,
        leadInMaxSec: timing.countdownLeadInMaxSec,
      });
    }
    return karaokeClampAppearAfterInterludes(appear, singStart, i, singMeta, clampOpts);
  };

  for (let i = 0; i < singable.length; i++) {
    if (!onSlot(i)) continue;
    const start = singMeta[i].singStart;
    const end = singMeta[i].singEnd;
    if (t >= start - 1e-9 && t < end - 1e-9) {
      return {
        line: singable[i],
        idx: i,
        fade: 1,
        held: false,
        singing: true,
        awaiting: false,
      };
    }
  }

  for (let i = 0; i < singable.length; i++) {
    if (!onSlot(i)) continue;
    const singStart = singMeta[i].singStart;
    if (!(t < singStart - 1e-9)) continue;
    const appear = dualAppearSec(i);
    if (t >= appear - 1e-6) {
      return {
        line: singable[i],
        idx: i,
        fade: 1,
        held: false,
        singing: false,
        awaiting: true,
      };
    }
  }

  for (let i = singable.length - 1; i >= 0; i--) {
    if (!onSlot(i)) continue;
    const line = singable[i];
    const singEnd = singMeta[i].singEnd;
    if (t < singEnd - 1e-6) continue;
    const nextSame = i + 2;
    const nextSingStart = nextSame < singable.length ? singMeta[nextSame].singStart : null;
    const visibleEnd = karaokeLineVisibleEndSec(singEnd, nextSingStart, lineFade);
    const opacity = karaokeLineFadeOutOpacity(visibleEnd, t, lineFade, singEnd);
    if (opacity > 0.001) {
      return {
        line,
        idx: i,
        fade: opacity,
        held: true,
        singing: false,
        awaiting: false,
      };
    }
  }

  return empty;
}

/** 双行交替预览态（编辑器预览 / 方案 A 烧录共用） */
export type DualPreviewState = {
  lineA: KaraokeLine | null;
  lineB: KaraokeLine | null;
  activeSlot: 'A' | 'B';
  singing: boolean;
  awaitingSing: boolean;
  heldA: boolean;
  heldB: boolean;
  fadeA: number;
  fadeB: number;
  idxA: number;
  idxB: number;
};

export type DualPreviewResolveOpts = {
  /** 开场首句提前显词时刻；无倒计时窗时可省略 */
  firstLyricAppearSec?: number;
  fadeOutSec?: number;
  gapThresholdSec?: number;
  countdownGapThresholdSec?: number;
  leadInMaxSec?: number;
  /** 每句倒计时（显式开启时强制挂待唱行） */
  countdown?: KaraokeCountdownOptions | null;
  hasTiming?: boolean;
};

/**
 * 双行交替：A=偶数行(0,2,…)，B=奇数行(1,3,…)，两槽独立。
 * 一侧唱完只换本槽下一句（i+2）；长间奏清两侧，再入前提前显词。
 * 编辑器预览与 KaraokeBurnOverlayApp 必须同调此函数。
 */
export function resolveDualPreviewAtTime(
  lines: KaraokeLine[],
  t: number,
  opts?: DualPreviewResolveOpts,
): DualPreviewState {
  const empty: DualPreviewState = {
    lineA: null,
    lineB: null,
    activeSlot: 'A',
    singing: false,
    awaitingSing: false,
    heldA: false,
    heldB: false,
    fadeA: 1,
    fadeB: 1,
    idxA: -1,
    idxB: -1,
  };
  const singable = singableLines(lines);
  if (!singable.length) return empty;

  const slotOpts = {
    firstLyricAppearSec: opts?.firstLyricAppearSec,
    fadeOutSec: opts?.fadeOutSec,
    gapThresholdSec: opts?.gapThresholdSec,
    countdownGapThresholdSec: opts?.countdownGapThresholdSec,
    leadInMaxSec: opts?.leadInMaxSec,
  };
  let slotA = resolveDualSlotAtTime(singable, t, true, slotOpts);
  let slotB = resolveDualSlotAtTime(singable, t, false, slotOpts);

  const countdown = opts?.countdown;
  if (countdown?.enabled && opts?.hasTiming) {
    let cdIdx = -1;
    let cdStart = Infinity;
    for (let i = 0; i < singable.length; i++) {
      const start = karaokeLineSingStartSec(singable[i]);
      if (!Number.isFinite(start)) continue;
      const prevEnd = i > 0 ? karaokeLineSingEndSec(singable[i - 1]) : null;
      const windowStart = karaokeCountdownWindowStartSec(start, prevEnd, countdown);
      if (t >= windowStart && t < start && start < cdStart) {
        cdIdx = i;
        cdStart = start;
      }
    }
    if (cdIdx >= 0) {
      const cdLine = singable[cdIdx];
      if (cdIdx % 2 === 0) {
        if (!slotA.singing) {
          slotA = {
            line: cdLine,
            idx: cdIdx,
            fade: 1,
            held: false,
            singing: false,
            awaiting: true,
          };
        }
      } else if (!slotB.singing) {
        slotB = {
          line: cdLine,
          idx: cdIdx,
          fade: 1,
          held: false,
          singing: false,
          awaiting: true,
        };
      }
    }
  }

  const singing = slotA.singing || slotB.singing;
  const awaitingSing = !singing && (slotA.awaiting || slotB.awaiting);
  let activeSlot: 'A' | 'B' = 'A';
  if (slotA.singing) activeSlot = 'A';
  else if (slotB.singing) activeSlot = 'B';
  else if (slotA.awaiting && slotB.awaiting) {
    activeSlot =
      slotA.idx >= 0 && (slotB.idx < 0 || slotA.idx <= slotB.idx) ? 'A' : 'B';
  } else if (slotB.awaiting) activeSlot = 'B';
  else if (slotA.awaiting) activeSlot = 'A';

  return {
    lineA: slotA.line,
    lineB: slotB.line,
    activeSlot,
    singing,
    awaitingSing,
    heldA: slotA.held,
    heldB: slotB.held,
    fadeA: slotA.fade,
    fadeB: slotB.fade,
    idxA: slotA.idx,
    idxB: slotB.idx,
  };
}

/** 单行预览：当前挂行 + 是否句末渐隐 + fade 透明度 */
export type SinglePreviewState = {
  line: KaraokeLine | null;
  held: boolean;
  fade: number;
};

/**
 * 单行：须等旧句淡到 0（appear = prevSingEnd + fade；长间奏则再入窗）后再换新。
 * 编辑器预览与方案 A 烧录共用。
 */
export function resolveSinglePreviewAtTime(
  lines: KaraokeLine[],
  t: number,
  opts?: DualPreviewResolveOpts,
): SinglePreviewState {
  const empty: SinglePreviewState = { line: null, held: false, fade: 1 };
  const singable = singableLines(lines);
  if (!singable.length) return empty;

  const fadeOutSec = clampKaraokeLineFadeOutSec(
    opts?.fadeOutSec ?? KARAOKE_LINE_FADE_OUT_SEC,
  );
  const timingOpts = {
    gapThresholdSec: opts?.gapThresholdSec,
    countdownGapThresholdSec: opts?.countdownGapThresholdSec,
    leadInMaxSec: opts?.leadInMaxSec,
  };
  const idx = findActiveSingableIndex(lines, t);
  if (idx >= 0) {
    return { line: singable[idx] || null, held: false, fade: 1 };
  }
  const fading = findFadingSingableLine(lines, t, fadeOutSec);

  const resolveNext = (): KaraokeLine | null => {
    const countdown = opts?.countdown;
    if (countdown?.enabled && opts?.hasTiming) {
      let cdIdx = -1;
      let cdStart = Infinity;
      for (let i = 0; i < singable.length; i++) {
        const start = karaokeLineSingStartSec(singable[i]);
        if (!Number.isFinite(start)) continue;
        const prevEnd = i > 0 ? karaokeLineSingEndSec(singable[i - 1]) : null;
        const windowStart = karaokeCountdownWindowStartSec(start, prevEnd, countdown);
        if (t >= windowStart && t < start && start < cdStart) {
          cdIdx = i;
          cdStart = start;
        }
      }
      if (cdIdx >= 0) return singable[cdIdx] || null;
    }
    const nextIdx = findNextSingableIndex(lines, t, {
      firstLyricAppearSec: opts?.firstLyricAppearSec,
      dual: false,
      fadeOutSec,
      ...timingOpts,
    });
    if (nextIdx >= 0) return singable[nextIdx] || null;
    return null;
  };

  let line: KaraokeLine | null;
  if (fading) {
    const nextLine = resolveNext();
    if (nextLine && nextLine !== fading.line) {
      const nextIdx = singable.indexOf(nextLine);
      const fadingIdx = singable.indexOf(fading.line);
      if (nextIdx >= 0 && fadingIdx >= 0) {
        const singMeta = singable.map((l) => ({
          singStart: karaokeLineSingStartSec(l),
          singEnd: karaokeLineSingEndSec(l),
        }));
        const countdownReentrySet = new Set(
          karaokeSelectCountdownReentryLineIndexes(singMeta, {
            fadeOutSec,
            gapThresholdSec: opts?.countdownGapThresholdSec,
            leadInMaxSec: opts?.leadInMaxSec,
          }),
        );
        let appear = karaokeLineDisplayAppearSec(singMeta[nextIdx].singStart, {
          prevAdjacentSingEndSec: nextIdx > 0 ? singMeta[nextIdx - 1].singEnd : null,
          prevSameSlotSingEndSec: singMeta[fadingIdx].singEnd,
          fadeOutSec,
          isCountdownReentry: countdownReentrySet.has(nextIdx),
          ...timingOpts,
        });
        appear = karaokeClampAppearAfterInterludes(
          appear,
          singMeta[nextIdx].singStart,
          nextIdx,
          singMeta,
          {
            fadeOutSec,
            countdownReentryIndexes: countdownReentrySet,
            ...timingOpts,
          },
        );
        if (t >= appear - 1e-6) line = nextLine;
        else line = fading.line;
      } else {
        line = fading.line;
      }
    } else {
      line = fading.line;
    }
  } else {
    line = resolveNext();
  }

  if (!line) return empty;
  const held = fading?.line === line;
  return {
    line,
    held,
    fade: held ? fading!.opacity : 1,
  };
}

/**
 * 开场时间线 → 首句提前显词时刻（无实质倒计时窗则 undefined）。
 * 预览 / 烧录 firstLyricAppearSec 同源。
 */
export function karaokeFirstLyricAppearSec(
  openingTimeline: Pick<KaraokeOpeningTimeline, 'countdownDur' | 'lyricAppearSec'> | null | undefined,
): number | undefined {
  if (!openingTimeline) return undefined;
  return openingTimeline.countdownDur > 0.05 ? openingTimeline.lyricAppearSec : undefined;
}

export function linePreviewChars(line: KaraokeLine | null): KaraokeCharTiming[] {
  if (line?.chars?.length) {
    return line.chars
      .map((ch) => ({
        ...ch,
        text: String(ch.text || '').replace(/\r?\n/g, ''),
      }))
      .filter((ch) => ch.text.length > 0);
  }
  const fromLine = String(line?.text || '')
    .replace(/\r?\n/g, '')
    .trim();
  if (!fromLine) return [];
  return Array.from(fromLine).map((ch) => ({ text: ch, startSec: 0, endSec: 0 }));
}

/**
 * 已唱半扫 CSS `clip-path`（兼容旧调用）。
 * **预览/方案 A 正歌请用 `karaokeSungWipeMaskStyles`**：Electron capturePage 下
 * `clip-path` 常裁不掉 `text-shadow`，会变成「填色半扫 + 整字白边」。
 * 右缘严格按 fillRatio；左/上/下可外扩 outlinePad。
 */
export function karaokeSungWipeClipPathCss(
  fillRatio01: number,
  outlinePadPx = 0,
): string {
  const clamped = Math.max(0, Math.min(1, Number(fillRatio01) || 0));
  // 保留更高精度，避免短字半扫在 30fps 下被 0.1% 量化成可见台阶
  const pct = Math.round(clamped * 10000) / 100;
  const rightInset = Math.round((100 - pct) * 100) / 100;
  const pad = Math.max(0, Math.ceil(Number(outlinePadPx) || 0));
  if (pad > 0) {
    return `inset(-${pad}px ${rightInset}% -${pad}px -${pad}px)`;
  }
  return `inset(0 ${rightInset}% 0 0)`;
}

/** 半扫上层 overflow 遮罩样式（与 `karaokeSungWipeMaskStyles` 配套） */
export type KaraokeSungWipeMaskStyles = {
  /** 裁切容器：overflow:hidden；右缘=fill% */
  mask: {
    position: 'absolute';
    left: number;
    top: number;
    width: string;
    height: string;
    overflow: 'hidden';
    pointerEvents: 'none';
  };
  /** 内层字形：相对 mask 回正 pad，带已唱色+白边 textShadow */
  inner: {
    position: 'absolute';
    left: number;
    top: number;
    whiteSpace: 'nowrap';
    pointerEvents: 'none';
  };
};

/**
 * 半扫上层：用 `overflow:hidden` + 宽度裁切（填色与白边同一层、同一进度）。
 * 比 `clip-path` 更能裁掉 text-shadow（capturePage/透明窗下 clip-path 易漏描边 → 整字白边）。
 * 右缘严格 = fillRatio；左/上/下外扩 outlinePad 只为露出已唱白边，不改变竖缝。
 *
 * 结构：
 * ```
 * <span base 未唱填+黑边>{字}
 *   <span style={mask}><span style={inner 已唱填+白边}>{字}</span></span>
 * </span>
 * ```
 */
export function karaokeSungWipeMaskStyles(
  fillRatio01: number,
  outlinePadPx = 0,
): KaraokeSungWipeMaskStyles {
  const clamped = Math.max(0, Math.min(1, Number(fillRatio01) || 0));
  const pct = Math.round(clamped * 10000) / 100;
  const pad = Math.max(0, Math.ceil(Number(outlinePadPx) || 0));
  return {
    mask: {
      position: 'absolute',
      left: pad > 0 ? -pad : 0,
      top: pad > 0 ? -pad : 0,
      // 右缘 = left(-pad) + width(pct%+pad) = pct%（相对字盒）
      width: pad > 0 ? `calc(${pct}% + ${pad}px)` : `${pct}%`,
      height: pad > 0 ? `calc(100% + ${pad * 2}px)` : '100%',
      overflow: 'hidden',
      pointerEvents: 'none',
    },
    inner: {
      position: 'absolute',
      left: pad,
      top: pad,
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
    },
  };
}

/**
 * 行内各非角色字的视觉扫字结束时刻（短字拉长，夹到下一字/行末）。
 */
export function karaokeLineCharWipeVisualEnds(line: KaraokeLine | null | undefined): number[] {
  const chars = line?.chars || [];
  const lineEnd = karaokeLineSingEndSec(line as KaraokeLine);
  return chars.map((ch, i) => {
    if (!ch || ch.roleTag) return Number(ch?.endSec) || 0;
    let nextStart: number | undefined;
    for (let j = i + 1; j < chars.length; j++) {
      const nc = chars[j];
      if (nc && !nc.roleTag) {
        nextStart = Number(nc.startSec);
        break;
      }
    }
    return karaokeCharWipeVisualEndSec(Number(ch.startSec) || 0, Number(ch.endSec) || 0, {
      nextStartSec: nextStart,
      lineEndSec: Number.isFinite(lineEnd) ? lineEnd : undefined,
    });
  });
}

/**
 * 单字渐进填充比例 0..1。
 * 预览/方案 A：该比例同时驱动填色与描边半扫（左=已唱填+白边，右=未唱填+黑边）。
 * `visualEndSec`：可选；传入则用平滑视觉终点（短字拉长），与方案 C 对齐。
 */
export function charWipeRatio(
  ch: KaraokeCharTiming,
  t: number,
  enableWipe: boolean,
  visualEndSec?: number,
): number {
  if (!enableWipe) return 0;
  const start = Number(ch.startSec) || 0;
  const endRaw = Number(ch.endSec);
  const asrEnd = Math.max(start + 0.01, Number.isFinite(endRaw) ? endRaw : start);
  const end =
    visualEndSec != null && Number.isFinite(Number(visualEndSec))
      ? Math.max(start + 0.01, Number(visualEndSec))
      : asrEnd;
  if (t <= start) return 0;
  if (t >= end) return 1;
  return Math.min(1, Math.max(0, (t - start) / (end - start)));
}

/**
 * 开场抓帧忙碌截止：须覆盖曲名/署名渐隐 **与** 蓝点倒计时窗（hold + 逐点渐隐至 countdownEnd）。
 * 旧逻辑只用 `endSec`（= lyricAppear，曲名消失点），会把 `[lyricAppear, firstSing)` 误判静止并复用首帧，导致 4 点冻住不逐个消失。
 */
export function karaokeOpeningCaptureBusyUntilSec(
  timeline: KaraokeOpeningTimeline | null | undefined,
  previewOpeningCredits?: boolean | null,
): number {
  if (!timeline || previewOpeningCredits === false) return 0;
  const titleUntil =
    Math.max(0, Number(timeline.endSec) || 0) + Math.max(0, Number(timeline.fadeSec) || 0);
  const cdUntil =
    timeline.maxDots > 0 && Number(timeline.countdownDur) > 0.05
      ? Math.max(0, Number(timeline.countdownEnd) || 0)
      : 0;
  const until = Math.max(titleUntil, cdUntil);
  return until > 1e-6 ? until + 0.05 : 0;
}

/** 倒计时窗内蓝点 opacity 随 t 变化，抓帧不可复用 */
export function karaokeCountdownWindowActiveAt(
  t: number,
  window:
    | Pick<KaraokeCountdownWindow, 'countdownStart' | 'countdownEnd' | 'maxDots'>
    | null
    | undefined,
  eps = 1e-4,
): boolean {
  if (!window || !(window.maxDots > 0)) return false;
  if (!Number.isFinite(t)) return false;
  const e = Math.max(1e-4, Number(eps) || 1e-4);
  return t + e > window.countdownStart && t < window.countdownEnd + e;
}

/**
 * 间奏再入蓝点窗（与 BurnOverlay / 预览同一套 select + reentry timeline）。
 */
export function karaokeReentryCountdownWindowsForLines(
  lines: KaraokeLine[],
  opts?: { fadeOutSec?: number; style?: KaraokeStyleOptions | null },
): Array<Pick<KaraokeCountdownWindow, 'countdownStart' | 'countdownEnd' | 'maxDots'>> {
  const fadeOutSec = clampKaraokeLineFadeOutSec(
    opts?.fadeOutSec ?? opts?.style?.lineFadeOutSec ?? KARAOKE_LINE_FADE_OUT_SEC,
  );
  const timing = resolveKaraokeInterludeTiming(opts?.style);
  const singable = singableLines(lines);
  const singMeta = singable.map((l) => ({
    singStart: karaokeLineSingStartSec(l),
    singEnd: karaokeLineSingEndSec(l),
  }));
  const indexes = karaokeSelectCountdownReentryLineIndexes(singMeta, {
    fadeOutSec,
    gapThresholdSec: timing.countdownReentryGapSec,
    leadInMaxSec: timing.countdownLeadInMaxSec,
  });
  const out: Array<
    Pick<KaraokeCountdownWindow, 'countdownStart' | 'countdownEnd' | 'maxDots'>
  > = [];
  for (const i of indexes) {
    const re = karaokeReentryTimeline(singMeta[i].singStart, singMeta[i - 1].singEnd, {
      fadeOutSec,
      gapThresholdSec: timing.countdownReentryGapSec,
      leadInMaxSec: timing.countdownLeadInMaxSec,
    });
    if (!re || re.maxDots <= 0) continue;
    out.push({
      countdownStart: re.countdownStart,
      countdownEnd: re.countdownEnd,
      maxDots: re.maxDots,
    });
  }
  return out;
}

export function karaokeCountdownOverlayNeedsUniqueFrame(
  t: number,
  windows: ReadonlyArray<
    | Pick<KaraokeCountdownWindow, 'countdownStart' | 'countdownEnd' | 'maxDots'>
    | null
    | undefined
  >,
  eps?: number,
): boolean {
  for (const w of windows) {
    if (karaokeCountdownWindowActiveAt(t, w, eps)) return true;
  }
  return false;
}

/**
 * 方案 A 抓帧：该时刻字幕层是否在动画（半扫/渐隐/需唯一帧）。
 * 静止段可复用上一帧 raw，减少 capturePage 等待。
 * 注意：开场/再入蓝点不在此检测，见 `karaokeOpeningCaptureBusyUntilSec` /
 * `karaokeCountdownOverlayNeedsUniqueFrame`。
 */
export function karaokeOverlayNeedsUniqueFrame(
  lines: KaraokeLine[],
  t: number,
  opts?: { fadeOutSec?: number; eps?: number },
): boolean {
  const eps = Math.max(1e-4, Number(opts?.eps) || 1 / 60);
  const fadeOut = Math.max(0, Number(opts?.fadeOutSec) || 0);
  const list = Array.isArray(lines) ? lines : [];
  for (const line of list) {
    if (!line?.chars?.length) continue;
    const ends = karaokeLineCharWipeVisualEnds(line);
    for (let i = 0; i < line.chars.length; i++) {
      const ch = line.chars[i];
      if (!ch || ch.roleTag) continue;
      const start = Number(ch.startSec) || 0;
      const end = ends[i] ?? (Number(ch.endSec) || start);
      if (t + eps > start && t < end - eps) return true;
    }
    if (fadeOut > 0) {
      const singEnd = karaokeLineSingEndSec(line);
      if (Number.isFinite(singEnd) && t >= singEnd - eps && t < singEnd + fadeOut + eps) {
        return true;
      }
    }
  }
  return false;
}

export function activeCharProgress(line: KaraokeLine | null, t: number): number {
  if (!line?.chars?.length) return 0;
  const singable = line.chars.filter((c) => !c.roleTag);
  if (!singable.length) return 0;
  const { start, end } = lineWipeWindow(line);
  if (t < start) return 0;
  if (t >= end) return 1;
  for (let i = 0; i < singable.length; i++) {
    const ch = singable[i];
    if (t < ch.startSec) return i / singable.length;
    if (t < ch.endSec) {
      const span = Math.max(0.001, ch.endSec - ch.startSec);
      return (i + (t - ch.startSec) / span) / singable.length;
    }
  }
  return 1;
}

export function openingCreditsOpacity(
  playTime: number,
  endSec: number,
  fadeOutSec: number,
): number {
  if (endSec <= 0.05 || playTime >= endSec - 1e-4) return 0;
  if (fadeOutSec <= 0) return playTime < endSec ? 1 : 0;
  const fadeStart = endSec - fadeOutSec;
  if (playTime <= fadeStart) return 1;
  return Math.max(0, Math.min(1, 1 - (playTime - fadeStart) / fadeOutSec));
}

export function computePlayResPreviewLayout(
  stageW: number,
  stageH: number,
): {
  scale: number;
  contentW: number;
  contentH: number;
  offsetX: number;
  offsetY: number;
} {
  const w = Math.max(1, stageW);
  const h = Math.max(1, stageH);
  const scale = Math.min(w / ASS_PLAY_RES_X, h / ASS_PLAY_RES_Y);
  const contentW = ASS_PLAY_RES_X * scale;
  const contentH = ASS_PLAY_RES_Y * scale;
  return {
    scale,
    contentW,
    contentH,
    offsetX: (w - contentW) / 2,
    offsetY: (h - contentH) / 2,
  };
}

export type PreviewLineLayout = {
  fontSizePx: number;
  style: {
    left: string;
    top: string;
    transform: string;
    textAlign: 'left' | 'right' | 'center';
  };
};

/** 单行适配：缩小字号 + 左/右半区改左右锚点（与 ASS fitKaraokeLineLayout 一致） */
export function fitPreviewLineLayout(
  pos: KaraokePos,
  text: string,
  baseFontPx: number,
  stageW: number,
): PreviewLineLayout {
  const topPct = (pos.y / ASS_PLAY_RES_Y) * 100;
  const playX = Math.max(0, Math.min(ASS_PLAY_RES_X, Number(pos.x) || 0));
  const cx = (playX / ASS_PLAY_RES_X) * Math.max(1, stageW);
  const maxFrame = Math.max(40, stageW - PREVIEW_EDGE_MARGIN_PX * 2);
  const estAtBase = estimateAssTextWidth(text, baseFontPx) * 1.02;
  let fontSizePx = baseFontPx;
  if (estAtBase > maxFrame && estAtBase > 0) {
    fontSizePx = Math.max(10, baseFontPx * (maxFrame / estAtBase));
  }
  const tw = estimateAssTextWidth(text, fontSizePx) * 1.02;
  const half = tw / 2;
  const rightLimit = stageW - PREVIEW_EDGE_MARGIN_PX;
  const leftLimit = PREVIEW_EDGE_MARGIN_PX;
  const midPlay = ASS_PLAY_RES_X / 2;
  const SIDE_BAND = 200;
  const BOTTOM_BAND = ASS_PLAY_RES_Y * 0.67;
  const playY = Math.max(0, Math.min(ASS_PLAY_RES_Y, Number(pos.y) || 0));

  if (playX <= midPlay - SIDE_BAND) {
    let leftPx = cx;
    if (tw > 0 && leftPx + tw > rightLimit) {
      leftPx = Math.max(leftLimit, rightLimit - tw);
    }
    return {
      fontSizePx,
      style: {
        left: `${(Math.max(leftLimit, leftPx) / stageW) * 100}%`,
        top: `${topPct}%`,
        transform: 'translate(0, -50%)',
        textAlign: 'left',
      },
    };
  }
  if (playX >= midPlay + SIDE_BAND) {
    let rightPx = cx;
    if (tw > 0 && rightPx - tw < leftLimit) {
      rightPx = Math.min(rightLimit, leftLimit + tw);
    }
    return {
      fontSizePx,
      style: {
        left: `${(Math.min(rightLimit, rightPx) / stageW) * 100}%`,
        top: `${topPct}%`,
        transform: 'translate(-100%, -50%)',
        textAlign: 'right',
      },
    };
  }

  if (cx + half > rightLimit && tw > 0) {
    const rightPx = Math.min(rightLimit, Math.max(leftLimit + tw, cx + half));
    return {
      fontSizePx,
      style: {
        left: `${(rightPx / stageW) * 100}%`,
        top: `${topPct}%`,
        transform: 'translate(-100%, -50%)',
        textAlign: 'right',
      },
    };
  }
  if (cx - half < leftLimit && tw > 0) {
    const leftPx = Math.max(leftLimit, Math.min(rightLimit - tw, cx - half));
    return {
      fontSizePx,
      style: {
        left: `${(leftPx / stageW) * 100}%`,
        top: `${topPct}%`,
        transform: 'translate(0, -50%)',
        textAlign: 'left',
      },
    };
  }
  const bottomCenter = playY >= BOTTOM_BAND;
  return {
    fontSizePx,
    style: {
      left: `${(playX / ASS_PLAY_RES_X) * 100}%`,
      top: `${topPct}%`,
      transform: bottomCenter ? 'translate(-50%, -100%)' : 'translate(-50%, -50%)',
      textAlign: 'center',
    },
  };
}

/** 将倒计时挂到即将开唱行所在槽（与预览 countdownPreview 一致） */
export function resolveCountdownSlotAtTime(
  singable: KaraokeLine[],
  playTime: number,
  countdown: KaraokeCountdownOptions,
  dual: boolean,
): { slot: 'A' | 'B' | null; lit: number; lineIdx: number } {
  if (!countdown.enabled || !singable.length) {
    return { slot: null, lit: 0, lineIdx: -1 };
  }
  let bestIdx = -1;
  let bestStart = Infinity;
  let bestWindowStart = 0;
  for (let i = 0; i < singable.length; i++) {
    const start = karaokeLineSingStartSec(singable[i]);
    if (!Number.isFinite(start)) continue;
    const prevEnd = i > 0 ? karaokeLineSingEndSec(singable[i - 1]) : null;
    const windowStart = karaokeCountdownWindowStartSec(start, prevEnd, countdown);
    if (playTime >= windowStart && playTime < start && start < bestStart) {
      bestIdx = i;
      bestStart = start;
      bestWindowStart = windowStart;
    }
  }
  if (bestIdx < 0) return { slot: null, lit: 0, lineIdx: -1 };
  const lit = karaokeCountdownLitDots(bestStart, playTime, countdown, {
    windowStartSec: bestWindowStart,
  });
  if (lit <= 0) return { slot: null, lit: 0, lineIdx: -1 };
  const slot: 'A' | 'B' = dual ? (bestIdx % 2 === 0 ? 'A' : 'B') : 'A';
  return { slot, lit, lineIdx: bestIdx };
}
