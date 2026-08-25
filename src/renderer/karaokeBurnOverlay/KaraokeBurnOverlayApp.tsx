/**
 * 离屏卡拉OK字幕层：与编辑器预览同一套 CSS wipe / 双行 / 开场逻辑。
 * 透明背景，供主进程 capturePage → ffmpeg overlay。
 */

import React, { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  activeCharProgress,
  applyGlobalOffsetToLines,
  ASS_PLAY_RES_X,
  ASS_PLAY_RES_Y,
  assBgrToCssHex,
  buildKaraokeSungOutlineShadow,
  karaokeSungWipeMaskStyles,
  buildRoundedTextOutlineShadow,
  charWipeRatio,
  karaokeLineCharWipeVisualEnds,
  clampKaraokeLineFadeOutSec,
  clampKaraokeOpeningCreditFontSize,
  clampKaraokeOpeningTitleFontSize,
  clampKaraokeOutline,
  computePlayResPreviewLayout,
  contentfulSingableLines,
  DEFAULT_KARAOKE_STYLE,
  findActiveSingableIndex,
  fitPreviewLineLayout,
  karaokeCountdownDotOpacity,
  karaokeCountdownResolvedDotPos,
  karaokeFirstLyricAppearSec,
  karaokeLineSingEndSec,
  karaokeLineSingStartSec,
  karaokeOpeningCountdownAnchorPos,
  karaokeOpeningTimelineForProject,
  karaokePreviewSoftGlowLayers,
  karaokeReentryTimeline,
  karaokeLineLeadSungCss,
  karaokeRoleSungCss,
  karaokeSelectCountdownReentryLineIndexes,
  KARAOKE_FALLBACK_FONT,
  KARAOKE_LINE_FADE_OUT_SEC,
  KARAOKE_LYRIC_OUTLINE_DEFAULT,
  KARAOKE_LYRIC_SUNG_OUTLINE_DEFAULT,
  KARAOKE_OPENING_CREDIT_OUTLINE,
  KARAOKE_OPENING_OUTLINE_CSS,
  KARAOKE_OPENING_PRIMARY_CSS,
  KARAOKE_OPENING_TITLE_OUTLINE,
  KARAOKE_PREFERRED_FONT,
  ensureKaraokeEmbeddedFonts,
  linePreviewChars,
  lineWipeWindow,
  mergeKaraokePreviewStyle,
  openingCreditsOpacity,
  prepareKaraokeLinesForRender,
  resolveCountdownSlotAtTime,
  resolveDualPreviewAtTime,
  resolveSinglePreviewAtTime,
  resolveKaraokeCountdown,
  resolveKaraokeCreditName,
  resolveKaraokeIndicator,
  resolveKaraokeInterludeTiming,
  resolveKaraokeLayoutMode,
  resolveKaraokeOpeningComposerPos,
  resolveKaraokeOpeningLyricistPos,
  resolveKaraokeOpeningTitlePos,
  resolveKaraokePosA,
  resolveKaraokePosB,
  resolveKaraokeRoleColors,
  singableLines,
  type KaraokeLine,
  type KaraokePos,
  type KaraokeProject,
} from '../../shared/karaoke';

type BurnCmd =
  | { type: 'init'; project: KaraokeProject; width: number; height: number }
  | { type: 'setTime'; t: number; frameIndex: number }
  | { type: 'shutdown' };

declare global {
  interface Window {
    karaokeBurnOverlayAPI?: {
      onCommand: (cb: (msg: BurnCmd) => void) => () => void;
      send: (msg: { type: string; frameIndex?: number; error?: string }) => void;
    };
  }
}

const OPENING_LYRICIST_PREFIX = '作詞：';
const OPENING_COMPOSER_PREFIX = '作曲：';

/**
 * flushSync 后等一帧绘制即可（双 rAF 偏保守，烧录时拖慢吞吐）。
 * 字幕层为纯 CSS，单 rAF 足够保证 capturePage 读到新几何。
 */
function waitPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function waitFontsReady(): Promise<void> {
  try {
    const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts;
    if (fonts?.ready) await fonts.ready;
  } catch {
    /* ignore */
  }
}

export default function KaraokeBurnOverlayApp() {
  const [project, setProject] = useState<KaraokeProject | null>(null);
  const [stageW, setStageW] = useState(ASS_PLAY_RES_X);
  const [stageH, setStageH] = useState(ASS_PLAY_RES_Y);
  const [playTime, setPlayTime] = useState(0);

  useEffect(() => {
    const api = window.karaokeBurnOverlayAPI;
    if (!api) {
      console.error('[karaoke-burn-overlay] API missing');
      return;
    }
    let cancelled = false;
    const off = api.onCommand((msg) => {
      void (async () => {
        try {
          if (msg.type === 'init') {
            flushSync(() => {
              setProject(msg.project);
              setStageW(Math.max(2, Math.round(msg.width) || ASS_PLAY_RES_X));
              setStageH(Math.max(2, Math.round(msg.height) || ASS_PLAY_RES_Y));
              setPlayTime(0);
            });
            await ensureKaraokeEmbeddedFonts();
            await waitFontsReady();
            await waitPaint();
            api.send({ type: 'ready' });
            return;
          }
          if (msg.type === 'setTime') {
            flushSync(() => {
              setPlayTime(Number(msg.t) || 0);
            });
            await waitPaint();
            api.send({ type: 'painted', frameIndex: msg.frameIndex });
            return;
          }
          if (msg.type === 'shutdown') {
            api.send({ type: 'shutdown-ack' });
          }
        } catch (e: any) {
          api.send({ type: 'error', error: String(e?.message || e || 'overlay error') });
        }
      })();
    });
    void ensureKaraokeEmbeddedFonts().then(() => {
      if (!cancelled) api.send({ type: 'boot' });
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const style = useMemo(
    () => mergeKaraokePreviewStyle(project?.style, {}),
    [project?.style],
  );
  const layoutMode = resolveKaraokeLayoutMode(style.layoutMode);
  const posA = useMemo(() => resolveKaraokePosA(style), [style]);
  const posB = useMemo(() => resolveKaraokePosB(style), [style]);
  const indicator = useMemo(() => resolveKaraokeIndicator(style.indicator), [style.indicator]);
  const countdown = useMemo(() => resolveKaraokeCountdown(style.countdown), [style.countdown]);
  const lineFadeOutSec = clampKaraokeLineFadeOutSec(
    style.lineFadeOutSec ?? KARAOKE_LINE_FADE_OUT_SEC,
  );
  const interludeTiming = useMemo(
    () => resolveKaraokeInterludeTiming(style),
    [style.countdownLeadInMaxSec, style.countdownReentryGapSec, style.interludeClearGapSec],
  );
  const {
    interludeClearGapSec,
    countdownReentryGapSec,
    countdownLeadInMaxSec,
  } = interludeTiming;

  const offsetLines = useMemo(() => {
    if (!project) return [] as KaraokeLine[];
    return prepareKaraokeLinesForRender(
      applyGlobalOffsetToLines(project.lines || [], Number(project.globalOffsetSec) || 0),
      undefined,
      project.lyrics,
    );
  }, [project]);

  const hasSingableLyrics = useMemo(
    () => contentfulSingableLines(project?.lines || []).length > 0,
    [project?.lines],
  );
  const hasTiming = useMemo(() => {
    if (!project) return false;
    const chars = (project.lines || []).reduce(
      (n, l) => n + (l.chars?.filter((c) => !c.roleTag).length || 0),
      0,
    );
    if (chars <= 0) return false;
    const hasMedia = !!(
      String(project.audioUrl || '').trim() || String(project.videoUrl || '').trim()
    );
    if (hasMedia) {
      return (
        project.timingSource === 'asrWords' &&
        Array.isArray(project.asrWords) &&
        project.asrWords.length > 0
      );
    }
    return true;
  }, [project]);

  const openingTimeline = useMemo(
    () => (project ? karaokeOpeningTimelineForProject(project) : null),
    [project],
  );
  const openingOpacity = useMemo(
    () =>
      openingTimeline
        ? openingCreditsOpacity(playTime, openingTimeline.endSec, openingTimeline.fadeSec)
        : 0,
    [openingTimeline, playTime],
  );
  const openingCountdownDotOpacities = useMemo(() => {
    if (!openingTimeline) return [] as number[];
    const n = openingTimeline.maxDots;
    if (n <= 0) return [];
    return Array.from({ length: n }, (_, i) =>
      karaokeCountdownDotOpacity(playTime, openingTimeline, i),
    );
  }, [openingTimeline, playTime]);
  const openingCountdownAnchor = useMemo(
    () => karaokeOpeningCountdownAnchorPos(posA),
    [posA],
  );

  const reentryCountdownDots = useMemo(() => {
    const singable = singableLines(offsetLines);
    const empty = { opacities: [] as number[], lineIdx: -1 };
    const singMeta = singable.map((l) => ({
      singStart: karaokeLineSingStartSec(l),
      singEnd: karaokeLineSingEndSec(l),
    }));
    const indexes = karaokeSelectCountdownReentryLineIndexes(singMeta, {
      fadeOutSec: lineFadeOutSec,
      gapThresholdSec: countdownReentryGapSec,
      leadInMaxSec: countdownLeadInMaxSec,
    });
    for (const i of indexes) {
      const re = karaokeReentryTimeline(singMeta[i].singStart, singMeta[i - 1].singEnd, {
        fadeOutSec: lineFadeOutSec,
        gapThresholdSec: countdownReentryGapSec,
        leadInMaxSec: countdownLeadInMaxSec,
      });
      if (!re) continue;
      const opacities = Array.from({ length: re.maxDots }, (_, di) =>
        karaokeCountdownDotOpacity(playTime, re, di),
      );
      if (opacities.some((o) => o > 0.001)) return { opacities, lineIdx: i };
    }
    return empty;
  }, [
    countdownLeadInMaxSec,
    countdownReentryGapSec,
    lineFadeOutSec,
    offsetLines,
    playTime,
  ]);
  const reentryCountdownDotOpacities = reentryCountdownDots.opacities;

  const notYetSinging = findActiveSingableIndex(offsetLines, playTime) < 0;
  const showOpeningLayer =
    (project?.previewOpeningCredits !== false) && notYetSinging;
  const showOpeningCredits = showOpeningLayer && openingOpacity > 0.001;
  const showOpeningCountdown =
    showOpeningLayer && openingCountdownDotOpacities.some((o) => o > 0.001);
  const showReentryCountdown = reentryCountdownDotOpacities.some((o) => o > 0.001);

  const openingSongTitle = String(project?.songTitle || '').trim();
  const openingLyricist = resolveKaraokeCreditName(project?.lyricist);
  const openingComposer = resolveKaraokeCreditName(project?.composer);
  const openingTitlePos = useMemo(() => resolveKaraokeOpeningTitlePos(style), [style]);
  const openingLyricistPos = useMemo(() => resolveKaraokeOpeningLyricistPos(style), [style]);
  const openingComposerPos = useMemo(() => resolveKaraokeOpeningComposerPos(style), [style]);
  const openingTitleFontSize = clampKaraokeOpeningTitleFontSize(style.openingTitleFontSize);
  const openingCreditFontSize = clampKaraokeOpeningCreditFontSize(style.openingCreditFontSize);
  const openingTitleOutline = clampKaraokeOutline(
    style.openingTitleOutline ?? DEFAULT_KARAOKE_STYLE.openingTitleOutline,
    KARAOKE_OPENING_TITLE_OUTLINE,
  );
  const openingCreditOutline = clampKaraokeOutline(
    style.openingCreditOutline ?? DEFAULT_KARAOKE_STYLE.openingCreditOutline,
    KARAOKE_OPENING_CREDIT_OUTLINE,
  );

  const lyricSungOutline = clampKaraokeOutline(
    style.sungOutlineWidth ?? DEFAULT_KARAOKE_STYLE.sungOutlineWidth,
    KARAOKE_LYRIC_SUNG_OUTLINE_DEFAULT,
  );
  const lyricOutline = clampKaraokeOutline(
    style.outline ?? DEFAULT_KARAOKE_STYLE.outline,
    KARAOKE_LYRIC_OUTLINE_DEFAULT,
  );

  const unsungCss = assBgrToCssHex(style.unsungColor, '#FFFFFF');
  const roleColors = resolveKaraokeRoleColors(style.roleColors);
  const sungCss = assBgrToCssHex(roleColors.male, '#0000FF');
  const outlineCss = assBgrToCssHex(style.outlineColor, '#000000');
  const sungOutlineCss = assBgrToCssHex(style.sungOutlineColor, '#FFFFFF');
  /** 开场倒计时点色：跟随后面首句歌词已唱角色色 */
  const openingCountdownCss = useMemo(() => {
    const first = singableLines(offsetLines)[0] || null;
    return karaokeLineLeadSungCss(first, roleColors);
  }, [offsetLines, roleColors]);
  /** 间奏再入倒计时点色：跟随即将开唱那句 */
  const reentryCountdownCss = useMemo(() => {
    const singable = singableLines(offsetLines);
    const line =
      reentryCountdownDots.lineIdx >= 0
        ? singable[reentryCountdownDots.lineIdx] || null
        : null;
    return karaokeLineLeadSungCss(line, roleColors);
  }, [offsetLines, reentryCountdownDots.lineIdx, roleColors]);
  const leadInCountdownCss = showOpeningCountdown
    ? openingCountdownCss
    : reentryCountdownCss;

  const dualPreview = useMemo(() => {
    if (!openingTimeline) {
      return resolveDualPreviewAtTime([], playTime);
    }
    return resolveDualPreviewAtTime(offsetLines, playTime, {
      firstLyricAppearSec: karaokeFirstLyricAppearSec(openingTimeline),
      fadeOutSec: lineFadeOutSec,
      gapThresholdSec: interludeClearGapSec,
      countdownGapThresholdSec: countdownReentryGapSec,
      leadInMaxSec: countdownLeadInMaxSec,
      countdown,
      hasTiming,
    });
  }, [
    countdown,
    countdownLeadInMaxSec,
    countdownReentryGapSec,
    hasTiming,
    interludeClearGapSec,
    lineFadeOutSec,
    offsetLines,
    openingTimeline,
    playTime,
  ]);

  const singlePreview = useMemo(() => {
    if (!openingTimeline) {
      return resolveSinglePreviewAtTime([], playTime);
    }
    return resolveSinglePreviewAtTime(offsetLines, playTime, {
      firstLyricAppearSec: karaokeFirstLyricAppearSec(openingTimeline),
      fadeOutSec: lineFadeOutSec,
      gapThresholdSec: interludeClearGapSec,
      countdownGapThresholdSec: countdownReentryGapSec,
      leadInMaxSec: countdownLeadInMaxSec,
      countdown,
      hasTiming,
    });
  }, [
    countdown,
    countdownLeadInMaxSec,
    countdownReentryGapSec,
    hasTiming,
    interludeClearGapSec,
    lineFadeOutSec,
    offsetLines,
    openingTimeline,
    playTime,
  ]);
  const singlePreviewLine = singlePreview.line;
  const singlePreviewHeld = singlePreview.held;
  const singlePreviewFade = singlePreview.fade;

  const countdownPreview = useMemo(() => {
    const empty = {
      slot: null as 'A' | 'B' | null,
      lit: 0,
      lineIdx: -1,
      css: sungCss,
    };
    if (!countdown.enabled || !hasTiming) return empty;
    const singable = singableLines(offsetLines);
    const slot = resolveCountdownSlotAtTime(
      singable,
      playTime,
      countdown,
      layoutMode === 'dualAlternate',
    );
    if (slot.lineIdx < 0 || slot.lit <= 0) return empty;
    return {
      ...slot,
      css: karaokeLineLeadSungCss(singable[slot.lineIdx], roleColors),
    };
  }, [countdown, hasTiming, layoutMode, offsetLines, playTime, roleColors, sungCss]);

  const { scale, contentW, contentH, offsetX, offsetY } = useMemo(
    () => computePlayResPreviewLayout(stageW, stageH),
    [stageH, stageW],
  );
  const baseFontSizePx = Math.max(
    10,
    (Number(style.fontSize) || DEFAULT_KARAOKE_STYLE.fontSize) * scale,
  );
  const sungOutlinePx = Math.max(0, lyricSungOutline * scale);
  const unsungOutlinePx = Math.max(0, lyricOutline * scale);
  /** 已唱白描边；未唱用 outline。半扫：上层 clip 带白边，底层未唱描边 */
  const sungSoftExtras = karaokePreviewSoftGlowLayers(sungOutlinePx, 0);
  const sungOutlineShadow = buildKaraokeSungOutlineShadow(
    sungOutlinePx,
    sungOutlineCss,
    sungSoftExtras,
  );
  const unsungOutlineShadow = buildRoundedTextOutlineShadow(
    unsungOutlinePx,
    outlineCss,
  );
  const fontName =
    String(style.fontName || DEFAULT_KARAOKE_STYLE.fontName).trim() ||
    DEFAULT_KARAOKE_STYLE.fontName;
  const baseTextStyle: React.CSSProperties = {
    fontFamily: `"${fontName}", "${KARAOKE_PREFERRED_FONT}", "${KARAOKE_FALLBACK_FONT}", "PingFang SC", sans-serif`,
    lineHeight: 1.15,
    fontWeight: 400,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
    wordBreak: 'keep-all',
    overflow: 'visible',
    userSelect: 'none',
    pointerEvents: 'none',
  };

  const renderChars = (line: KaraokeLine | null) => {
    const chars = linePreviewChars(line);
    const enableWipe = !!line?.chars?.length;
    const visualEnds = enableWipe ? karaokeLineCharWipeVisualEnds(line) : [];
    return chars.map((ch, i) => {
      const roleCss = karaokeRoleSungCss(ch.role, roleColors) || null;
      const charSungCss = roleCss || sungCss;
      const isRoleTag = !!ch.roleTag;
      const fill = isRoleTag
        ? 0
        : charWipeRatio(ch, playTime, enableWipe, visualEnds[i]);
      const baseSungLook = isRoleTag || fill >= 1;
      // 半扫中底层必须保持未唱黑边；仅 fill>=1 / 角色标记用白边
      const baseOutline = baseSungLook ? sungOutlineShadow : unsungOutlineShadow;
      const outlinePadCss = Math.ceil(Math.max(sungOutlinePx, unsungOutlinePx) + 1);
      const wipeMask =
        fill > 0 && fill < 1 ? karaokeSungWipeMaskStyles(fill, outlinePadCss) : null;
      return (
        <span
          key={`${i}-${ch.text}`}
          style={{
            position: 'relative',
            display: 'inline-block',
            color: baseSungLook ? charSungCss : unsungCss,
            // 未唱/未扫半边：未唱描边；已唱/唱完：已唱白描边
            textShadow: baseOutline,
          }}
        >
          {ch.text}
          {wipeMask ? (
            <span aria-hidden style={wipeMask.mask}>
              <span
                style={{
                  ...wipeMask.inner,
                  color: charSungCss,
                  // overflow:hidden 裁切填色+白边（勿用 clip-path：capture 易漏 text-shadow）
                  textShadow: sungOutlineShadow,
                }}
              >
                {ch.text}
              </span>
            </span>
          ) : null}
        </span>
      );
    });
  };

  const renderIndicator = (line: KaraokeLine | null, active: boolean) => {
    if (!indicator.enabled || !active || !line?.chars?.length) return null;
    const { start, end } = lineWipeWindow(line);
    if (playTime < start || playTime >= end) return null;
    const progress = activeCharProgress(line, playTime);
    const singable = line.chars.filter((c) => !c.roleTag);
    let indCss = sungCss;
    for (const ch of singable) {
      if (playTime < ch.endSec) {
        indCss = karaokeRoleSungCss(ch.role, roleColors) || sungCss;
        break;
      }
      indCss = karaokeRoleSungCss(ch.role, roleColors) || sungCss;
    }
    const sizePx = Math.max(6, indicator.size * scale);
    const ox = (indicator.offsetX + indicator.gap) * scale;
    const oy = indicator.offsetY * scale;
    return (
      <div
        style={{
          position: 'absolute',
          zIndex: 4,
          borderRadius: '50%',
          width: sizePx,
          height: sizePx,
          left: `calc(${progress * 100}% + ${ox}px)`,
          top: oy,
          transform: 'translate(-50%, -50%)',
          background: `radial-gradient(circle at 35% 30%, #fff 0%, ${indCss} 45%, rgba(0,0,0,0.35) 100%)`,
          boxShadow: `0 0 ${Math.max(2, sizePx * 0.25)}px ${indCss}`,
          opacity: 0.92,
          pointerEvents: 'none',
        }}
        aria-hidden
      />
    );
  };

  const renderCountdownDots = (slot: 'A' | 'B') => {
    if (countdownPreview.slot !== slot || countdownPreview.lit <= 0) return null;
    const dotPx = Math.max(8, countdown.size * scale * 0.55);
    const stepPx = Math.max(dotPx, countdown.spacing * scale);
    const dotCss = countdownPreview.css || sungCss;
    return (
      <div
        style={{
          position: 'absolute',
          zIndex: 8,
          left: 0,
          top: `-${dotPx + Math.max(4, 6 * scale)}px`,
          display: 'flex',
          gap: Math.max(2, stepPx - dotPx),
          pointerEvents: 'none',
        }}
        aria-hidden
      >
        {Array.from({ length: countdownPreview.lit }, (_, i) => (
          <span
            key={i}
            style={{
              width: dotPx,
              height: dotPx,
              boxSizing: 'border-box',
              borderRadius: '50%',
              border: '2px solid #fff',
              background: dotCss,
              display: 'inline-block',
            }}
          />
        ))}
      </div>
    );
  };

  const renderLine = (opts: {
    slot: 'A' | 'B';
    pos: KaraokePos;
    line: KaraokeLine | null;
    active: boolean;
    held?: boolean;
    fadeOpacity?: number;
  }) => {
    const plain =
      String(opts.line?.text || '')
        .replace(/\r?\n/g, '')
        .trim() ||
      (opts.line?.chars?.length ? opts.line.chars.map((c) => c.text).join('') : '');
    if (!plain) return null;
    const fitted = fitPreviewLineLayout(opts.pos, plain, baseFontSizePx, Math.max(1, contentW));
    const fade =
      opts.fadeOpacity != null && Number.isFinite(opts.fadeOpacity)
        ? Math.max(0, Math.min(1, opts.fadeOpacity))
        : 1;
    if (fade <= 0.001 && opts.held) return null;
    const baseOpacity = !opts.line ? 0.55 : opts.active ? 1 : opts.held ? 1 : 0.72;
    const lineOpacity = baseOpacity * fade;
    return (
      <div
        key={opts.slot}
        style={{
          position: 'absolute',
          zIndex: 3,
          overflow: 'visible',
          ...fitted.style,
          ...baseTextStyle,
          fontSize: `${fitted.fontSizePx}px`,
          opacity: 1,
        }}
      >
        <div style={{ position: 'relative', display: 'inline-block', overflow: 'visible' }}>
          {renderCountdownDots(opts.slot)}
          {renderIndicator(opts.line, opts.active)}
          <span style={{ opacity: lineOpacity }}>{renderChars(opts.line)}</span>
        </div>
      </div>
    );
  };

  if (!project) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          margin: 0,
          background: 'transparent',
        }}
      />
    );
  }

  return (
    <div
      data-nexflow-karaoke-burn-root="1"
      style={{
        width: stageW,
        height: stageH,
        margin: 0,
        padding: 0,
        overflow: 'hidden',
        background: 'transparent',
        position: 'relative',
      }}
    >
      <div
        data-nexflow-karaoke-overlay="1"
        style={{
          position: 'absolute',
          left: offsetX,
          top: offsetY,
          width: contentW,
          height: contentH,
          overflow: 'visible',
          pointerEvents: 'none',
          opacity: 1,
        }}
      >
        {showOpeningLayer || showReentryCountdown ? (
          <div style={{ position: 'absolute', inset: 0, zIndex: 4, pointerEvents: 'none' }}>
            {showOpeningCountdown || showReentryCountdown ? (
              <div style={{ position: 'absolute', inset: 0 }} aria-hidden>
                {(showOpeningCountdown
                  ? openingCountdownDotOpacities
                  : reentryCountdownDotOpacities
                ).map((dotOpacity, i) => {
                  if (dotOpacity <= 0.001) return null;
                  const pos = karaokeCountdownResolvedDotPos(
                    countdown,
                    openingCountdownAnchor,
                    i,
                  );
                  const dotPx = Math.max(8, countdown.size * scale * 0.55);
                  return (
                    <span
                      key={`cd-${i}`}
                      style={{
                        position: 'absolute',
                        zIndex: 8,
                        left: `${(pos.x / ASS_PLAY_RES_X) * 100}%`,
                        top: `${(pos.y / ASS_PLAY_RES_Y) * 100}%`,
                        width: dotPx,
                        height: dotPx,
                        boxSizing: 'border-box',
                        transform: 'translate(-50%, -50%)',
                        borderRadius: '50%',
                        border: '2px solid #fff',
                        background: leadInCountdownCss,
                        display: 'inline-block',
                        opacity: dotOpacity,
                      }}
                    />
                  );
                })}
              </div>
            ) : null}
            {showOpeningCredits ? (
              <div style={{ position: 'absolute', inset: 0, opacity: openingOpacity }}>
                {openingSongTitle ? (
                  <div
                    style={{
                      position: 'absolute',
                      left: `${(openingTitlePos.x / ASS_PLAY_RES_X) * 100}%`,
                      top: `${(openingTitlePos.y / ASS_PLAY_RES_Y) * 100}%`,
                      transform: 'translate(-50%, 0)',
                      fontSize: `${Math.max(14, openingTitleFontSize * scale)}px`,
                      color: KARAOKE_OPENING_PRIMARY_CSS,
                      textShadow: buildRoundedTextOutlineShadow(
                        Math.max(0, openingTitleOutline * scale),
                        KARAOKE_OPENING_OUTLINE_CSS,
                      ),
                      fontWeight: 700,
                      textAlign: 'center',
                      maxWidth: '90%',
                      wordBreak: 'break-word',
                      lineHeight: 1,
                    }}
                  >
                    {openingSongTitle}
                  </div>
                ) : null}
                <div
                  style={{
                    position: 'absolute',
                    left: `${(openingLyricistPos.x / ASS_PLAY_RES_X) * 100}%`,
                    top: `${(openingLyricistPos.y / ASS_PLAY_RES_Y) * 100}%`,
                    fontSize: `${Math.max(10, openingCreditFontSize * scale)}px`,
                    color: KARAOKE_OPENING_PRIMARY_CSS,
                    textShadow: buildRoundedTextOutlineShadow(
                      Math.max(0, openingCreditOutline * scale),
                      KARAOKE_OPENING_OUTLINE_CSS,
                    ),
                    fontWeight: 600,
                    lineHeight: 1.25,
                  }}
                >
                  {OPENING_LYRICIST_PREFIX}
                  {openingLyricist}
                </div>
                <div
                  style={{
                    position: 'absolute',
                    left: `${(openingComposerPos.x / ASS_PLAY_RES_X) * 100}%`,
                    top: `${(openingComposerPos.y / ASS_PLAY_RES_Y) * 100}%`,
                    fontSize: `${Math.max(10, openingCreditFontSize * scale)}px`,
                    color: KARAOKE_OPENING_PRIMARY_CSS,
                    textShadow: buildRoundedTextOutlineShadow(
                      Math.max(0, openingCreditOutline * scale),
                      KARAOKE_OPENING_OUTLINE_CSS,
                    ),
                    fontWeight: 600,
                    lineHeight: 1.25,
                  }}
                >
                  {OPENING_COMPOSER_PREFIX}
                  {openingComposer}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {layoutMode === 'dualAlternate' ? (
          <>
            {renderLine({
              slot: 'A',
              pos: posA,
              line: hasSingableLyrics ? dualPreview.lineA : null,
              active:
                hasSingableLyrics &&
                dualPreview.activeSlot === 'A' &&
                (dualPreview.singing || dualPreview.awaitingSing),
              held: hasSingableLyrics && dualPreview.heldA,
              fadeOpacity: hasSingableLyrics ? dualPreview.fadeA : 1,
            })}
            {renderLine({
              slot: 'B',
              pos: posB,
              line: hasSingableLyrics ? dualPreview.lineB : null,
              active:
                hasSingableLyrics &&
                dualPreview.activeSlot === 'B' &&
                (dualPreview.singing || dualPreview.awaitingSing),
              held: hasSingableLyrics && dualPreview.heldB,
              fadeOpacity: hasSingableLyrics ? dualPreview.fadeB : 1,
            })}
          </>
        ) : (
          renderLine({
            slot: 'A',
            pos: posA,
            line: hasSingableLyrics ? singlePreviewLine : null,
            active: hasSingableLyrics && !!singlePreviewLine && !singlePreviewHeld,
            held: hasSingableLyrics && singlePreviewHeld,
            fadeOpacity: hasSingableLyrics ? singlePreviewFade : 1,
          })
        )}
      </div>
    </div>
  );
}
