/**
 * 卡拉OK字幕编辑器浮层（V1.0）：时间轴生成 / 样式调节 / 实时预览 / 烧录到新视频节点。
 * 布局：宽模态 + 左预览右控件，尽量一屏展示、避免竖向滚动条。
 */

import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal, flushSync } from 'react-dom';
import {
  ChevronDown,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  Play,
  Scissors,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  detectKaraokeLowSpecMachine,
  KARAOKE_CSS_BURN_FAST_FPS,
  KARAOKE_CSS_BURN_FLUID_FPS,
  KARAOKE_CSS_BURN_STANDARD_FPS,
  loadKaraokeComposeQualityPreset,
  runKaraokePreviewCompose,
  saveKaraokeComposeQualityPreset,
  type KaraokeCssBurnQualityPreset,
} from '../../utils/karaokePreviewComposeCapture';
import { KARAOKE_CSS_BURN_QUALITY_PRESET_IDS } from '../../../shared/karaoke';
import { runKaraokePreviewRecord } from '../../utils/karaokePreviewRecordCapture';
import {
  applyAsrSegmentsToKaraokeProject,
  applyGlobalOffsetToLines,
  ASS_PLAY_RES_X,
  ASS_PLAY_RES_Y,
  assBgrToCssHex,
  buildKaraokeSungOutlineShadow,
  karaokeSungWipeMaskStyles,
  karaokeLineCharWipeVisualEnds,
  buildKaraokeLinesFromAvailable,
  countSingableChars,
  cssHexToAssBgr,
  DEFAULT_KARAOKE_COUNTDOWN,
  DEFAULT_KARAOKE_COUNTDOWN_ANCHOR,
  DEFAULT_KARAOKE_POS_A,
  DEFAULT_KARAOKE_POS_B,
  DEFAULT_KARAOKE_POS_SINGLE,
  DEFAULT_KARAOKE_STYLE,
  createDefaultKaraokeStyle,
  isInterpolatedKaraokeTiming,
  shouldMigrateKaraokeDualPosToDefault,
  shouldMigrateKaraokeSinglePosToDefault,
  karaokeLyricStrokeLegacyPatch,
  KARAOKE_FALLBACK_FONT,
  KARAOKE_FONT_PRESETS,
  KARAOKE_PREFERRED_FONT,
  ensureKaraokeEmbeddedFonts,
  isKaraokeEmbeddedFontsReady,
  KARAOKE_ASR_LANGUAGE_OPTIONS,
  karaokeAsrLanguageToApiParam,
  karaokeFirstLyricAppearSec,
  karaokeLineSingEndSec,
  karaokeLineSingStartSec,
  karaokeMarginAlignmentFromPos,
  karaokeOpeningCountdownAnchorPos,
  karaokeOpeningTimelineForProject,
  karaokeCountdownDotOpacity,
  karaokeReentryTimeline,
  karaokeSelectCountdownReentryLineIndexes,
  computePlayResPreviewLayout,
  contentfulSingableLines,
  findActiveSingableIndex,
  fitPreviewLineLayout,
  linePreviewChars,
  lineWipeWindow,
  mergeKaraokePreviewStyle,
  openingCreditsOpacity,
  resolveCountdownSlotAtTime,
  resolveDualPreviewAtTime,
  resolveDualSlotAtTime,
  resolveSinglePreviewAtTime,
  singableLines,
  karaokeCountdownGroupAnchor,
  karaokeCountdownResolvedDotPos,
  KARAOKE_COUNTDOWN_DOT_SIZE_DEFAULT,
  KARAOKE_COUNTDOWN_DOT_SIZE_MAX,
  KARAOKE_COUNTDOWN_DOT_SIZE_MIN,
  KARAOKE_COUNTDOWN_LEAD_IN_MAX_SEC_MAX,
  KARAOKE_COUNTDOWN_LEAD_IN_MAX_SEC_MIN,
  KARAOKE_COUNTDOWN_REENTRY_GAP_SEC_MAX,
  KARAOKE_COUNTDOWN_REENTRY_GAP_SEC_MIN,
  KARAOKE_COUNTDOWN_SPACING_DEFAULT,
  KARAOKE_COUNTDOWN_SPACING_MAX,
  KARAOKE_COUNTDOWN_SPACING_MIN,
  KARAOKE_INTERLUDE_CLEAR_GAP_SEC_MAX,
  KARAOKE_INTERLUDE_CLEAR_GAP_SEC_MIN,
  clampKaraokeCountdownAnchor,
  clampKaraokeCountdownLeadInMaxSec,
  clampKaraokeCountdownReentryGapSec,
  clampKaraokeCountdownSpacing,
  clampKaraokeInterludeClearGapSec,
  KARAOKE_LINE_FADE_OUT_SEC,
  KARAOKE_LYRIC_OUTLINE_DEFAULT,
  KARAOKE_LYRIC_SUNG_OUTLINE_DEFAULT,
  KARAOKE_LYRIC_SHADOW_DEFAULT,
  KARAOKE_OPENING_CREDIT_FONT_SIZE,
  KARAOKE_OPENING_CREDIT_FONT_SIZE_MAX,
  KARAOKE_OPENING_CREDIT_FONT_SIZE_MIN,
  KARAOKE_OPENING_CREDIT_OUTLINE,
  KARAOKE_OPENING_OUTLINE_CSS,
  KARAOKE_OPENING_PRIMARY_CSS,
  KARAOKE_OPENING_TITLE_FONT_SIZE,
  KARAOKE_OPENING_TITLE_FONT_SIZE_MAX,
  KARAOKE_OPENING_TITLE_FONT_SIZE_MIN,
  KARAOKE_OPENING_TITLE_OUTLINE,
  KARAOKE_OUTLINE_MAX,
  KARAOKE_OUTLINE_MIN,
  karaokeLineLeadSungCss,
  karaokeRoleSungCss,
  normalizeKaraokeAsrLanguage,
  planKaraokeTiming,
  prepareKaraokeLinesForRender,
  applyCharTimingRipple,
  remapKaraokeLineText,
  insertKaraokeLineChars,
  insertKaraokeCharPreservingTiming,
  deleteKaraokeLineChar,
  lyricsTextFromKaraokeLines,
  patchKaraokeLyricsForChangedLines,
  recomputeKaraokeWeakLineAlignment,
  isWeakOrInterpolatedKaraokeLine,
  resolveKaraokeAudioSource,
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
  clampKaraokeLineFadeOutSec,
  clampKaraokeOpeningCreditFontSize,
  clampKaraokeOpeningTitleFontSize,
  clampKaraokeOutline,
  type KaraokeAsrLanguage,
  type KaraokeAudioSource,
  type KaraokeCharTiming,
  type KaraokeLayoutMode,
  type KaraokeLine,
  type KaraokePos,
  type KaraokeProject,
  type KaraokeStyleOptions,
} from '../../../shared/karaoke';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import { karaokeT } from '../../i18n/karaokeI18n';
import { normalizeVideoUrl, toElectronVideoElementSrc } from '../../utils/normalizeVideoUrl';
import {
  CLOUD_BALANCE_INSUFFICIENT_ALERT,
  resolveCloudAuthErrorWithBalance,
} from '../../utils/cloudAiGateMessage';
import { getFileTranscribeDisplayPrice } from '../../utils/cloudModelPricing';
import { useNxModelPricing } from '../../contexts/NxModelPricingContext';
import { useNavigate } from 'react-router-dom';
import {
  DarkModalFrame,
  darkModalBtnCancelClass,
  darkModalBtnOkClass,
  darkModalFooterClass,
  darkModalHeaderClass,
  darkModalOverlayClass,
  darkModalPanelSmClass,
  nexflowOrangePillBtnBg,
  nexflowOrangePillBtnClass,
  yuanbaoHoverTipAboveCls,
} from '../darkModalShell';

/** 本地 / 远程媒体 URL → `<video>`/`<audio>` 可播 src */
function toPlayableMediaSrc(url: string): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (
    raw.startsWith('http://') ||
    raw.startsWith('https://') ||
    raw.startsWith('blob:') ||
    raw.startsWith('data:')
  ) {
    return raw;
  }
  const normalized = normalizeVideoUrl(raw);
  return toElectronVideoElementSrc(normalized) || normalized;
}

function formatPreviewClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

/** 输入框/可编辑区打字时不拦截空格、方向键与滚轮步进 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return !!target.closest('input, textarea, select, [contenteditable="true"]');
}

export type KaraokeSubtitleEditorBusy = 'idle' | 'timing' | 'asr' | 'burn';

/** 外置 footer（导演第 8 步）触发生成字级 / 烧录 / 录制预览 */
export type KaraokeSubtitleEditorHandle = {
  generateTiming: () => void;
  burn: () => void;
  /** 录制预览区导出（方案1） */
  recordPreview: () => void;
  /** 取消烧录并关闭（嵌入态会切回上一步） */
  cancel: () => void;
};

export type KaraokeSubtitleEditorProps = {
  open: boolean;
  onClose: () => void;
  projectId?: string | null;
  initialProject: KaraokeProject;
  /** 入口来源文案 */
  entryLabel?: string;
  /**
   * modal：独立浮层（默认，视频节点等）；
   * embedded：嵌入父容器（MV 导演第 8 步），不挡步骤条。
   */
  variant?: 'modal' | 'embedded';
  /** 嵌入模式可隐藏关闭；Esc 仍走 onClose（父级应切回其它步） */
  hideClose?: boolean;
  /**
   * 隐藏底栏「字幕生成 / 合成到视频」；
   * 嵌入第 8 步时由 Director 外置 footer 承接。
   */
  hideFooterActions?: boolean;
  /** 外置 footer 调用生成 / 烧录 / 取消 */
  actionsRef?: React.Ref<KaraokeSubtitleEditorHandle | null>;
  /** busy 变化 → 父级同步外置按钮态 */
  onBusyChange?: (busy: KaraokeSubtitleEditorBusy) => void;
  /** 工程变更（样式/偏移/时间轴）→ 父级写入 karaokeProject 以便再开恢复 */
  onProjectChange?: (project: KaraokeProject) => void;
  /** 烧录成功：父级落新 VideoNode */
  onBurned?: (result: {
    originalUrl: string;
    originalPath?: string;
    posterUrl?: string;
    width?: number;
    height?: number;
    karaokeProject: KaraokeProject;
  }) => void;
  /** 可选：烧录前解析成片（如导演台自动导出剪辑轨） */
  resolveVideoUrl?: () => Promise<string | null>;
  /** 选择本地成片（父级负责 file input / 复制进项目） */
  onPickLocalVideo?: () => void;
  /** 从剪辑轨导入合成成片 */
  onImportComposeVideo?: () => void;
  /** 清除当前成片 */
  onClearVideo?: () => void;
  /** 成片上传/导入进行中 */
  videoSourceBusy?: 'upload' | 'import' | null;
};

const FONT_CUSTOM = '__custom__';

/** 预览叠层可拖槽：歌词 A/B + 开场曲名/作词/作曲 */
type DragSlot = 'A' | 'B' | 'title' | 'lyricist' | 'composer';

/** 位移超过此像素才视为拖位置，避免与单击选字 / 双击改词冲突 */
const POS_DRAG_THRESHOLD_PX = 6;

/**
 * 环状多层 text-shadow 模拟圆角描边（round join 观感）。
 * 不用 `-webkit-text-stroke`：其拐角偏尖（近似 miter）。
 * `fast`：抓帧时减少环数，避免 html2canvas 卡死。
 */
function buildRoundedTextOutlineShadow(
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

/** #RRGGBB → rgba(..., a)；预览软阴影用略低透明度 */
function karaokePreviewShadowRgba(shadowCss: string, alpha: number): string {
  const hex = String(shadowCss || '#000000').replace('#', '');
  if (hex.length >= 6) {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    if ([r, g, b].every((n) => Number.isFinite(n))) {
      return `rgba(${r},${g},${b},${alpha})`;
    }
  }
  return `rgba(0,0,0,${alpha})`;
}

/**
 * 整行预览软阴影（CSS filter drop-shadow）：更大 blur、略低透明度；勿硬投影。
 * 只挂在行容器一次（对齐 ASS 整行阴影底），勿逐字 text-shadow，否则扫字越唱越黑。
 * 描边仍由各字 buildRoundedTextOutlineShadow 环状层负责。
 * outlineUi=0 / 高描边时收束，对齐 ASS Dialogue 层克制阴影（软阴影 ≠ 描边）。
 * `outlineUi` / `shadowUi` 为面板数值；`scale` 为 PlayRes→预览缩放。
 */
function karaokePreviewLineDropShadowFilter(
  shadowUi: number,
  shadowCss: string,
  outlineUi = 2,
  scale = 1,
): string | undefined {
  const sUi = Number(shadowUi);
  if (!(sUi > 0)) return undefined;
  const sc = Math.max(0.01, Number(scale) || 1);
  const o = Math.max(0, Number(outlineUi) || 0);
  // 与 karaokeLyricShadowDistanceForBord 同思路（PlayRes 单位），再乘 scale
  let distUi = sUi;
  if (o <= 0) distUi = sUi * 0.55;
  else if (o >= 7) distUi = Math.min(sUi, 1.2);
  else if (o >= 5) distUi = Math.min(sUi, 1.8);
  const dist = distUi * sc;
  const softA = o <= 0 || o >= 5 ? 0.36 : 0.48;
  const softerA = o <= 0 || o >= 5 ? 0.18 : 0.26;
  const blurNear = o <= 0 ? 1.1 : o >= 7 ? 1.0 : 1.7;
  const blurFar = o <= 0 ? 1.6 : o >= 7 ? 1.5 : 2.6;
  const soft = karaokePreviewShadowRgba(shadowCss, softA);
  const softer = karaokePreviewShadowRgba(shadowCss, softerA);
  return [
    `drop-shadow(${(dist * 0.2).toFixed(2)}px ${(dist * 0.9).toFixed(2)}px ${(dist * blurNear).toFixed(2)}px ${soft})`,
    `drop-shadow(${(dist * 0.06).toFixed(2)}px ${(dist * 0.45).toFixed(2)}px ${(dist * blurFar).toFixed(2)}px ${softer})`,
  ].join(' ');
}

/**
 * 柔白外发光：仅轻量，避免预览「假白边」强过真实描边色（未唱蓝边要看得见）。
 * 角色红字上的白边观感主要靠 sungOutline，不靠外发光冒充。
 * outline=0 时不加发光（否则像假描边软边）。
 */
function karaokePreviewSoftGlowLayers(outlinePx: number, shadowPx: number): string[] {
  if (!(outlinePx > 0)) return [];
  const base = Math.max(outlinePx * 0.55, shadowPx * 0.25, 0.5);
  return [
    `0 0 ${(base * 1.0).toFixed(2)}px rgba(255,255,255,0.22)`,
    `0 0 ${(base * 1.7).toFixed(2)}px rgba(255,255,255,0.1)`,
  ];
}

/** 与方案 A 烧录同一套样式合并（shared/previewLogic） */
const mergeStyle = mergeKaraokePreviewStyle;

/** 预览行（可能经拆行 / 全局偏移）→ 工程行 id + 字下标 */
function mapOffsetCharToProject(
  offsetLine: KaraokeLine,
  offsetCharIndex: number,
  projectLines: KaraokeLine[],
  globalOff: number,
): { lineId: string; charIndex: number } | null {
  const previewChar = offsetLine.chars?.[offsetCharIndex];
  if (!previewChar) return null;
  const lines = projectLines || [];
  let lineId = String(offsetLine.id || '').trim();
  if (!lineId) return null;
  if (!lines.some((l) => l.id === lineId)) {
    const base = lineId.replace(/-p\d+$/, '');
    if (base && lines.some((l) => l.id === base)) lineId = base;
    else {
      const text = String(offsetLine.text || '')
        .replace(/\r?\n/g, '')
        .trim();
      const hit = lines.find(
        (l) =>
          !l.instrumental &&
          (l.text === text ||
            String(l.text || '').includes(text) ||
            text.includes(String(l.text || ''))),
      );
      if (!hit) return null;
      lineId = hit.id;
    }
  }
  const proj = lines.find((l) => l.id === lineId);
  if (!proj?.chars?.length) return null;
  if (offsetLine.id === proj.id && offsetCharIndex >= 0 && offsetCharIndex < proj.chars.length) {
    return { lineId, charIndex: offsetCharIndex };
  }
  const targetStart = (Number(previewChar.startSec) || 0) - (Number(globalOff) || 0);
  const targetText = String(previewChar.text || '');
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < proj.chars.length; i++) {
    if (String(proj.chars[i].text || '') !== targetText) continue;
    const d = Math.abs((Number(proj.chars[i].startSec) || 0) - targetStart);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  if (best >= 0 && bestDist < 0.75) return { lineId, charIndex: best };
  // 拆行：按连续文本在工程行中定位
  const partTexts = (offsetLine.chars || []).map((c) => String(c.text || ''));
  const joined = partTexts.join('');
  const full = proj.chars.map((c) => String(c.text || '')).join('');
  const at = full.indexOf(joined);
  if (at >= 0) {
    let cursor = 0;
    let startIdx = 0;
    for (let i = 0; i < proj.chars.length; i++) {
      const t = String(proj.chars[i].text || '');
      if (cursor === at) {
        startIdx = i;
        break;
      }
      cursor += t.length;
    }
    const mapped = startIdx + offsetCharIndex;
    if (mapped >= 0 && mapped < proj.chars.length) return { lineId, charIndex: mapped };
  }
  return best >= 0 ? { lineId, charIndex: best } : null;
}

type CharTimingDragKind = 'preview-translate' | 'bar-translate' | 'bar-start' | 'bar-end';

type CharTimingDragState = {
  kind: CharTimingDragKind;
  lineId: string;
  charIndex: number;
  pointerId: number;
  originClientX: number;
  originStart: number;
  originEnd: number;
  secPerPx: number;
  /** 按下时整行字级快照：每帧从快照涟漪，避免来回拖时后续字粘住 */
  baselineChars: KaraokeCharTiming[];
  baselineLineStart: number;
  baselineLineEnd: number;
};

/** 通用轨道两端垫一点，避免贴边 */
const CHAR_BAR_PAD_SEC = 0.12;
/** 缩放=1 时默认可见时长（秒）：整曲时间轴，不按「一句字数」撑满格子 */
const CHAR_BAR_DEFAULT_VIEW_SEC = 12;
/** 放大后最短可见窗（秒） */
const CHAR_BAR_MIN_VIEW_SEC = 1.5;
/** 用户缩放：1=默认窗；>1 放大（更短窗）；<1 缩小看更长时间 */
const CHAR_BAR_ZOOM_MIN = 0.08;
const CHAR_BAR_ZOOM_MAX = 10;
/** 播放跟随：播放头落在可视区左侧该比例处（中部偏左） */
const CHAR_BAR_FOLLOW_RATIO = 0.4;
/** 用户拖/滚轮平移字轨后，暂停自动跟随的时长 */
const CHAR_BAR_FOLLOW_SUPPRESS_MS = 900;

function karaokeCharBarFullRange(opts: {
  durationSec?: number;
  lines?: Array<{
    startSec?: number;
    endSec?: number;
    chars?: Array<{ startSec?: number; endSec?: number }>;
  }>;
}): { fullLo: number; fullHi: number; fullSpan: number } {
  let hi = Math.max(0, Number(opts.durationSec) || 0);
  for (const line of opts.lines || []) {
    hi = Math.max(hi, Number(line.endSec) || 0, Number(line.startSec) || 0);
    for (const ch of line.chars || []) {
      hi = Math.max(hi, Number(ch.endSec) || 0, Number(ch.startSec) || 0);
    }
  }
  const fullLo = 0;
  const fullHi = Math.max(fullLo + 0.2, hi + CHAR_BAR_PAD_SEC);
  return { fullLo, fullHi, fullSpan: Math.max(0.2, fullHi - fullLo) };
}

/** 按存盘时间（不含全局偏移）计算插入下标：落在字上则插到其后，落在间隙则插到下一字前 */
function karaokeInsertIndexAtStoredTime(
  chars: KaraokeCharTiming[] | undefined,
  timeSec: number,
): number {
  const list = chars || [];
  if (!list.length) return 0;
  const t = Number.isFinite(timeSec) ? timeSec : 0;
  for (let i = 0; i < list.length; i++) {
    const s = Number(list[i].startSec) || 0;
    if (t < s - 1e-6) return i;
    const e = Math.max(s, Number(list[i].endSec) || 0);
    if (t >= s - 1e-6 && t < e + 1e-6) return i + 1;
  }
  return list.length;
}

/** 双行交替：A=偶数下标，B=奇数下标 */
function karaokeDualSlotHasLine(singable: KaraokeLine[], slot: 'A' | 'B'): boolean {
  const wantEven = slot === 'A';
  for (let i = 0; i < singable.length; i++) {
    if ((i % 2 === 0) === wantEven) return true;
  }
  return false;
}

/** 可唱行中该句所属轨（A=偶数 / B=奇数）；找不到返回 null */
function karaokeDualSlotOfLine(
  singable: KaraokeLine[],
  lineId: string,
): 'A' | 'B' | null {
  const idx = singable.findIndex((l) => l.id === lineId);
  if (idx < 0) return null;
  return idx % 2 === 0 ? 'A' : 'B';
}

/** 按时间在可唱行中找最近一句（不限轨） */
function karaokeNearestSingableLine(
  singable: KaraokeLine[],
  timeSec: number,
): KaraokeLine | null {
  if (!singable.length) return null;
  const t = Number.isFinite(timeSec) ? timeSec : 0;
  let best: KaraokeLine | null = null;
  let bestDist = Infinity;
  for (const line of singable) {
    const singStart = karaokeLineSingStartSec(line);
    const singEnd = karaokeLineSingEndSec(line);
    if (
      Number.isFinite(singStart) &&
      Number.isFinite(singEnd) &&
      t >= singStart - 1e-6 &&
      t < singEnd + 1e-6
    ) {
      return line;
    }
    const lo = Number.isFinite(singStart)
      ? singStart
      : Number(line.startSec) || 0;
    const hi = Number.isFinite(singEnd)
      ? singEnd
      : Math.max(lo, Number(line.endSec) || 0);
    if (t >= lo - 1e-6 && t <= hi + 1e-6) return line;
    const mid = (lo + hi) / 2;
    const dist = Math.min(
      Math.abs(lo - t),
      Math.abs(hi - t),
      Math.abs(mid - t),
    );
    if (dist < bestDist) {
      bestDist = dist;
      best = line;
    }
  }
  return best;
}

/** 该轨上：优先覆盖 timeSec 的句，否则取时间最近的一句（用完整可唱列表，奇偶即真实轨） */
function karaokeNearestDualSlotLine(
  singable: KaraokeLine[],
  slot: 'A' | 'B',
  timeSec: number,
  excludeLineId?: string,
): KaraokeLine | null {
  const wantEven = slot === 'A';
  const t = Number.isFinite(timeSec) ? timeSec : 0;
  let best: KaraokeLine | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < singable.length; i++) {
    if ((i % 2 === 0) !== wantEven) continue;
    const line = singable[i];
    if (excludeLineId && line.id === excludeLineId) continue;
    const singStart = karaokeLineSingStartSec(line);
    const singEnd = karaokeLineSingEndSec(line);
    if (
      Number.isFinite(singStart) &&
      Number.isFinite(singEnd) &&
      t >= singStart - 1e-6 &&
      t < singEnd + 1e-6
    ) {
      return line;
    }
    const lo = Number.isFinite(singStart)
      ? singStart
      : Number(line.startSec) || 0;
    const hi = Number.isFinite(singEnd)
      ? singEnd
      : Math.max(lo, Number(line.endSec) || 0);
    if (t >= lo - 1e-6 && t <= hi + 1e-6) return line;
    const mid = (lo + hi) / 2;
    const dist = Math.min(
      Math.abs(lo - t),
      Math.abs(hi - t),
      Math.abs(mid - t),
    );
    if (dist < bestDist) {
      bestDist = dist;
      best = line;
    }
  }
  return best;
}

type CharBarLane = 'A' | 'B' | 'all';
type CharBarSel = { lineId: string; charIndex: number };

function charBarSelKey(s: CharBarSel): string {
  return `${s.lineId}:${s.charIndex}`;
}

function newManualKaraokeLineId(): string {
  return `kl-m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function createEmptyManualKaraokeLine(timeSec: number): KaraokeLine {
  const t = Math.max(0, Number(timeSec) || 0);
  return {
    id: newManualKaraokeLineId(),
    text: '',
    startSec: t,
    endSec: t + 0.4,
    chars: [],
    timingQuality: 'manual',
  };
}

function karaokeLineHasNoLyricText(line: KaraokeLine | undefined | null): boolean {
  if (!line) return true;
  if (String(line.text || '').trim()) return false;
  return !(line.chars || []).some((c) => String(c.text || '').trim());
}

/**
 * 按点击时间在可唱序列中插入一整句空行（不垫上轨占位）。
 * 插入位置按可唱行时间序，splice 发生在完整 allLines 上，以免 instrumental 打乱奇偶。
 */
function insertSingableLineAtTime(
  allLines: KaraokeLine[],
  timeSec: number,
): { lines: KaraokeLine[]; line: KaraokeLine } {
  const created = createEmptyManualKaraokeLine(timeSec);
  const t = Math.max(0, Number(timeSec) || 0);
  const insertAt = allLines.findIndex((l) => {
    if (l.instrumental) return false;
    const start = karaokeLineSingStartSec(l);
    const s = Number.isFinite(start) ? start : Number(l.startSec) || 0;
    return s >= t;
  });
  const lines = allLines.slice();
  if (insertAt < 0) lines.push(created);
  else lines.splice(insertAt, 0, created);
  return { lines, line: created };
}

/** 右键加词：优先该轨已有句；没有则新建（B 轨在空工程会先垫一句上轨以保持奇偶） */
function ensureAddLyricTarget(
  allLines: KaraokeLine[],
  lane: CharBarLane,
  timeSec: number,
): { lines: KaraokeLine[]; line: KaraokeLine } {
  const singable = allLines.filter((l) => !l.instrumental);
  const existing =
    lane === 'A' || lane === 'B'
      ? karaokeNearestDualSlotLine(singable, lane, timeSec)
      : karaokeNearestSingableLine(singable, timeSec);
  if (existing) return { lines: allLines, line: existing };

  const created = createEmptyManualKaraokeLine(timeSec);
  if (lane === 'B' && singable.length % 2 === 0) {
    const placeholder = createEmptyManualKaraokeLine(Math.max(0, timeSec - 0.05));
    return { lines: [...allLines, placeholder, created], line: created };
  }
  return { lines: [...allLines, created], line: created };
}

type CharBarContextMenuState =
  | {
      kind: 'empty';
      x: number;
      y: number;
      /** 存盘时间（不含全局偏移） */
      clickTimeSec: number;
      lane: CharBarLane;
    }
  | {
      kind: 'char';
      x: number;
      y: number;
      lineId: string;
      charIndex: number;
      lane: CharBarLane;
    };

type CharBarMarqueeState = {
  pointerId: number;
  lane: CharBarLane;
  additive: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

type CharBarGroupDragState = {
  pointerId: number;
  originClientX: number;
  originClientY: number;
  secPerPx: number;
  sourceLane: CharBarLane;
  hoverLane: CharBarLane;
  moved: boolean;
  items: Array<{
    lineId: string;
    charIndex: number;
    originStart: number;
    originEnd: number;
  }>;
  baselineLines: Record<
    string,
    { chars: KaraokeCharTiming[]; startSec: number; endSec: number }
  >;
};

/** 用户缩放合法区间：缩小到约整曲，放大到最短可见窗 */
function karaokeCharBarZoomBounds(fullSpan: number): { min: number; max: number } {
  const span = Math.max(0.2, fullSpan);
  const minFromSong = CHAR_BAR_DEFAULT_VIEW_SEC / span;
  return {
    min: Math.max(CHAR_BAR_ZOOM_MIN, Math.min(1, minFromSong)),
    max: CHAR_BAR_ZOOM_MAX,
  };
}

/** 可见时间窗：按真实秒数，不按「一句有几个字」把格子撑满 */
function karaokeCharBarVisibleSpan(fullSpan: number, zoomFactor = 1): number {
  const z = Math.max(CHAR_BAR_ZOOM_MIN, Math.min(CHAR_BAR_ZOOM_MAX, zoomFactor));
  const preferred = CHAR_BAR_DEFAULT_VIEW_SEC / z;
  return Math.max(
    CHAR_BAR_MIN_VIEW_SEC,
    Math.min(Math.max(0.2, fullSpan), preferred),
  );
}

/** 双行交替：A=偶数下标整轨，B=奇数下标整轨（同一时间轴，不是一句一块） */
function karaokeLinesForDualSlot(
  singable: KaraokeLine[],
  slot: 'A' | 'B',
): KaraokeLine[] {
  const wantEven = slot === 'A';
  return singable.filter((_, i) => (i % 2 === 0) === wantEven);
}

function collectCharsInLaneMarquee(
  lines: KaraokeLine[],
  viewLo: number,
  viewSpan: number,
  laneW: number,
  x0: number,
  x1: number,
): CharBarSel[] {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  if (right - left < 4) return [];
  const tLo = viewLo + (left / Math.max(1, laneW)) * viewSpan;
  const tHi = viewLo + (right / Math.max(1, laneW)) * viewSpan;
  const out: CharBarSel[] = [];
  for (const line of lines) {
    (line.chars || []).forEach((ch, ci) => {
      const s = Number(ch.startSec) || 0;
      const e = Math.max(s + 0.03, Number(ch.endSec) || 0);
      if (e < tLo || s > tHi) return;
      out.push({ lineId: line.id, charIndex: ci });
    });
  }
  return out;
}

function hitTestCharBarLane(clientX: number, clientY: number): CharBarLane | null {
  if (typeof document === 'undefined') return null;
  const nodes = document.querySelectorAll<HTMLElement>('[data-karaoke-char-lane]');
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      const lane = el.dataset.karaokeCharLane;
      if (lane === 'A' || lane === 'B' || lane === 'all') return lane;
    }
  }
  return null;
}

/** 当前字进度 0..1（用于指示灯水平位置；跳过角色标记） */
function activeCharProgress(line: KaraokeLine | null, t: number): number {
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

/**
 * 单字渐进填充比例 0..1（预览/方案 A：overflow 半扫双描边；方案 C ASS 用整句 \\kf，无歌词 \\clip）。
 * 不依赖「是否 activeSlot」：双行同时显示时，谁的字到点谁填，避免偶行永远静态白。
 * 零/负时长字：与 buildAss wipe 的 min 0.01s 对齐，到点即填满，避免预览永远白字。
 * `visualEndSec`：短字平滑拉长后的视觉终点（与方案 A/C 共用）。
 */
function charWipeRatio(
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

const karaokePanelClass =
  'nexflow-glass-panel rounded-2xl border border-white/[0.12] shadow-2xl w-[min(1100px,92vw)] max-h-[min(92vh,900px)] mx-4 overflow-hidden min-w-[min(100%,320px)] flex flex-col';

/**
 * 嵌入导演节点时勿用 nexflow-glass-panel（backdrop-filter）。
 * 外层毛玻璃 + 内层再 blur + 视频预览，会在画布 viewport transform 时拉出横贯预览的半透明灰杠。
 * 用近不透明实底，静止略闷一点也比拖画布出横条好。
 */
const karaokeEmbeddedPanelClass =
  'nexflow-karaoke-embedded rounded-xl border border-white/[0.12] bg-[rgba(12,12,16,0.98)] overflow-hidden flex flex-col flex-1 min-h-0 w-full';

/**
 * 预览 CSS 全屏浮层 z-index（必须用内联 style，勿只靠 Tailwind arbitrary class）。
 * 高于 DarkModalFrame(100010)、导演节点全屏(100001)；合成进度弹窗另用更高值。
 */
const KARAOKE_PREVIEW_FS_Z = 200050;
/** 合成进度 modal（盖过预览全屏） */
const KARAOKE_COMPOSE_PROGRESS_Z = KARAOKE_PREVIEW_FS_Z + 50;

/** 自定义滑条：用 getBoundingClientRect 算比例，避免 modal/缩放下原生 range 拇指与鼠标错位 */
function KaraokeRangeSlider(props: {
  min: number;
  max: number;
  step?: number;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  'aria-label'?: string;
}) {
  const { min, max, step = 1, value, disabled, onChange } = props;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const snap = useCallback(
    (raw: number) => {
      const s = step > 0 ? step : 1;
      const snapped = Math.round((raw - min) / s) * s + min;
      const precision = s < 1 ? Math.round(-Math.log10(s)) : 0;
      const rounded =
        precision > 0 ? Number(snapped.toFixed(Math.min(6, precision))) : Math.round(snapped);
      return Math.max(min, Math.min(max, rounded));
    },
    [max, min, step],
  );

  const valueFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return value;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return value;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return snap(min + ratio * (max - min));
    },
    [max, min, snap, value],
  );

  const rawValue = Number(value);
  const clamped = Math.max(min, Math.min(max, Number.isFinite(rawValue) ? rawValue : min));
  const pct = max > min ? ((clamped - min) / (max - min)) * 100 : 0;

  return (
    <div
      ref={trackRef}
      className={`nodrag relative mt-1 h-5 w-full flex items-center select-none touch-none ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
      }`}
      onPointerDown={(e) => {
        if (disabled) return;
        e.preventDefault();
        e.stopPropagation();
        draggingRef.current = true;
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
          /* ignore */
        }
        onChange(valueFromClientX(e.clientX));
      }}
      onPointerMove={(e) => {
        if (!draggingRef.current || disabled) return;
        e.preventDefault();
        onChange(valueFromClientX(e.clientX));
      }}
      onPointerUp={() => {
        draggingRef.current = false;
      }}
      onPointerCancel={() => {
        draggingRef.current = false;
      }}
      role="slider"
      aria-label={props['aria-label']}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={clamped}
      aria-disabled={disabled || undefined}
    >
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-black/55 ring-1 ring-inset ring-white/[0.06]" />
      <div
        className="pointer-events-none absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full bg-sky-600/65"
        style={{ width: `${pct}%` }}
      />
      <div
        className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-500/90 shadow-[0_1px_3px_rgba(0,0,0,0.55)] ring-2 ring-[#0a0c10]/95"
        style={{ left: `${pct}%` }}
        aria-hidden
      />
    </div>
  );
}

const KaraokeSubtitleEditor: React.FC<KaraokeSubtitleEditorProps> = ({
  open,
  onClose,
  projectId,
  initialProject,
  entryLabel: _entryLabel,
  variant = 'modal',
  hideClose = false,
  hideFooterActions = false,
  actionsRef,
  onBusyChange,
  onProjectChange,
  onBurned,
  resolveVideoUrl,
  onPickLocalVideo,
  onImportComposeVideo,
  onClearVideo,
  videoSourceBusy = null,
}) => {
  const embedded = variant === 'embedded';
  const showVideoSourceActions = !!(onPickLocalVideo || onImportComposeVideo);
  const { locale } = useAppLocale();
  const navigate = useNavigate();
  const { showAlert, showConfirm } = useDarkAlert();
  const { cloudMap } = useNxModelPricing();
  const tt = useMemo(() => karaokeT(locale), [locale]);
  const fileTranscribeYuanbao = useMemo(() => {
    try {
      const y = getFileTranscribeDisplayPrice(cloudMap, 1);
      return Number.isFinite(y) && y != null && y > 0 ? y : null;
    } catch {
      return null;
    }
  }, [cloudMap]);
  const fileTranscribeYuanbaoLabel = useMemo(
    () =>
      fileTranscribeYuanbao == null
        ? null
        : locale === 'en'
          ? `${fileTranscribeYuanbao} ${tt.creditsSuffix}`
          : `${fileTranscribeYuanbao}${tt.creditsSuffix}`,
    [fileTranscribeYuanbao, locale, tt.creditsSuffix],
  );
  const [project, setProject] = useState<KaraokeProject>(initialProject);
  const [busy, setBusy] = useState<KaraokeSubtitleEditorBusy>('idle');
  /** 合成：预览级 CSS 半扫；可选「稳定」ASS；CSS 失败会自动回退 ASS */
  const [composeCapturing, setComposeCapturing] = useState(false);
  /** 导出/合成进度弹窗文案（阶段说明） */
  const [composeProgressUi, setComposeProgressUi] = useState<string | null>(null);
  /** 进度弹窗标题：区分实时录制 vs 方案 A */
  const [composeProgressTitle, setComposeProgressTitle] = useState<string | null>(null);
  /** 进度条百分比 0～100 */
  const [composeProgressPercent, setComposeProgressPercent] = useState(0);
  /**
   * 合成弹窗阶段：idle / pick（选帧率）/ running（烧录中）。
   * 录制预览仍只用 progressUi，不走 pick。
   */
  const [composeModalPhase, setComposeModalPhase] = useState<
    'idle' | 'pick' | 'running'
  >('idle');
  const [composeQualityPreset, setComposeQualityPreset] =
    useState<KaraokeCssBurnQualityPreset>(() => loadKaraokeComposeQualityPreset());
  /** pick 阶段暂存待烧录工程（已解析 videoUrl） */
  const composeReadyRef = useRef<{
    project: KaraokeProject;
    videoUrl: string;
    durationSec: number;
  } | null>(null);
  const captureOverlayRef = useRef<HTMLDivElement | null>(null);
  const composeCancelRef = useRef(false);
  const enteredFullscreenForComposeRef = useRef(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [fontSelect, setFontSelect] = useState<string>(() => {
    const name = String(initialProject.style?.fontName || DEFAULT_KARAOKE_STYLE.fontName).trim();
    return KARAOKE_FONT_PRESETS.some((f) => f.value === name) ? name : FONT_CUSTOM;
  });
  /** 右侧栏：字号/描边/颜色/坐标等高级项，默认收起 */
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const seekBarRef = useRef<HTMLDivElement | null>(null);
  const seekDraggingRef = useRef(false);
  const previewShellRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const projectRef = useRef(project);
  /** 关闭后忽略异步回调，避免烧录完成又 onBurned / 重置 busy */
  const sessionRef = useRef(0);
  const closedRef = useRef(false);
  const busyRef = useRef<KaraokeSubtitleEditorBusy>('idle');
  const dragRef = useRef<{
    slot: DragSlot;
    pointerId: number;
    originClientX: number;
    originClientY: number;
    originPos: KaraokePos;
    /** 超过阈值后才写入坐标 */
    moved: boolean;
  } | null>(null);
  /** 倒计时蓝点整组拖动（开场/再入共用 countdown.anchor） */
  const countdownDragRef = useRef<{
    pointerId: number;
    originClientX: number;
    originClientY: number;
    originAnchor: KaraokePos;
    moved: boolean;
  } | null>(null);

  const [previewSrc, setPreviewSrc] = useState('');
  const [audioSrc, setAudioSrc] = useState('');
  const [stageSize, setStageSize] = useState({ w: 640, h: 360 });
  /** 录制预览时强制舞台为片源像素尺寸 */
  const [recordStageSize, setRecordStageSize] = useState<{ w: number; h: number } | null>(
    null,
  );
  const [playTime, setPlayTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [resolvingPreviewVideo, setResolvingPreviewVideo] = useState(false);
  const [draggingSlot, setDraggingSlot] = useState<DragSlot | null>(null);
  const [draggingCountdown, setDraggingCountdown] = useState(false);
  /** CSS 固定浮层全屏（Electron 下 requestFullscreen 常失败，不依赖原生 FS） */
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  /** 字级微调：选中行 id；播放/seek 时跟随预览当前句，仅无 active 时作回退 */
  const [charEditLineId, setCharEditLineId] = useState<string | null>(null);
  /** 字级微调：选中字下标（相对工程行 chars） */
  const [charEditIndex, setCharEditIndex] = useState<number | null>(null);
  /** 双击改词：整行文本编辑草稿 */
  const [lineTextEdit, setLineTextEdit] = useState<{ lineId: string; draft: string } | null>(null);
  const lineTextEditRef = useRef<{ lineId: string; draft: string } | null>(null);
  const lineTextEditInputRef = useRef<HTMLInputElement | null>(null);
  /** 字轨插入：atIndex = 插入下标；preferSec = 落点/缝偏好（存盘时间，填缝用） */
  const [charInsertEdit, setCharInsertEdit] = useState<{
    lineId: string;
    atIndex: number;
    draft: string;
    preferSec?: number;
    /** 空白「添加句子」新建的占位行；Esc/空草稿时删掉以免翻轨残留 */
    isNewSentence?: boolean;
  } | null>(null);
  const charInsertEditRef = useRef<{
    lineId: string;
    atIndex: number;
    draft: string;
    preferSec?: number;
    isNewSentence?: boolean;
  } | null>(null);
  const charInsertInputRef = useRef<HTMLInputElement | null>(null);
  /** 字轨右键菜单（空白加字 / 单字前/后插入） */
  const [charBarCtxMenu, setCharBarCtxMenu] = useState<CharBarContextMenuState | null>(
    null,
  );
  /** 字轨多选（框选 / Shift 点选） */
  const [charBarSelection, setCharBarSelection] = useState<CharBarSel[]>([]);
  const charBarSelectionRef = useRef<CharBarSel[]>([]);
  const [charBarMarquee, setCharBarMarquee] = useState<CharBarMarqueeState | null>(null);
  const charBarMarqueeRef = useRef<CharBarMarqueeState | null>(null);
  const charBarGroupDragRef = useRef<CharBarGroupDragState | null>(null);
  const [charBarDropLane, setCharBarDropLane] = useState<CharBarLane | null>(null);
  /** 双击后抑制紧随的 click seek */
  const suppressCharClickSeekRef = useRef(false);
  /** 上次同步到字条的预览当前句 id */
  const previewFocusSyncRef = useRef<string | null>(null);
  /**
   * 双行显式钉住另一轨（暂停时可编非当前唱句）。
   * 播放中强制跟 previewFocus，避免「预览在唱 B、字轨仍停在已唱完的 A」。
   */
  const charEditPinnedRef = useRef(false);
  const playTimeRef = useRef(0);
  const previewFsKeepPlayingRef = useRef(false);
  const charTimingDragRef = useRef<CharTimingDragState | null>(null);
  const charBarRef = useRef<HTMLDivElement | null>(null);
  /** 字轨外壳（滑条+轨道），挂非 passive wheel 以便 Ctrl+滚轮缩放并拦截页面缩放 */
  const charBarShellRef = useRef<HTMLDivElement | null>(null);
  /** 字轨可见时间窗（与上方平移滑条同步）；拖字时用 viewSpan 算 secPerPx */
  const charBarViewRef = useRef({
    fullLo: 0,
    fullSpan: 0.2,
    viewLo: 0,
    viewSpan: 0.2,
    maxPan: 0,
    canPan: false,
    charCount: 0,
  });
  const charBarPanDragRef = useRef<{
    pointerId: number;
    originClientX: number;
    originPanSec: number;
    trackW: number;
    maxPan: number;
  } | null>(null);
  const charBarAutoPanKeyRef = useRef<string | null>(null);
  /** 用户手动平移后抑制自动跟随至该时间戳（performance.now） */
  const charBarFollowSuppressUntilRef = useRef(0);
  /** 字轨平移：相对整曲 fullLo 的可见窗起点偏移（秒） */
  const [charBarPanSec, setCharBarPanSec] = useState(0);
  /** 字轨用户缩放：1=默认约 12s 窗；>1 放大；<1 缩小看更长时间 */
  const [charBarZoom, setCharBarZoom] = useState(1);
  const charBarZoomRef = useRef(1);
  const charBarPanSecRef = useRef(0);
  const [charBarWidthPx, setCharBarWidthPx] = useState(0);
  const charPointerGestureRef = useRef<{
    lineId: string;
    charIndex: number;
    /** 所属歌词槽，超阈值后拖整行位置（不改字级时间） */
    slot: 'A' | 'B';
    pointerId: number;
    originClientX: number;
    originClientY: number;
    originStart: number;
    originEnd: number;
    moved: boolean;
  } | null>(null);

  const hasVideoPreview = !!previewSrc;
  const hasAudioPreview = !!audioSrc;
  const canPlayPreview = hasVideoPreview || hasAudioPreview;
  const canUseVideoAudio = !!(
    String(project.videoUrl || '').trim() ||
    previewSrc ||
    resolveVideoUrl
  );
  const canUseSongAudio = !!String(project.audioUrl || '').trim();
  const audioSource = resolveKaraokeAudioSource(project, {
    allowPendingVideo: !!resolveVideoUrl,
  });
  /** 用原曲作听感：有成片则画面 muted + 同步播 audio；无成片则仅 audio */
  const useSongAudio = audioSource === 'song' && canUseSongAudio;
  const muteVideoForSong = useSongAudio && hasVideoPreview;

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  /** 内嵌「文鼎中特圓」等：后台懒加载，不阻塞打开编辑器 */
  const [embeddedFontsReady, setEmbeddedFontsReady] = useState(() =>
    isKaraokeEmbeddedFontsReady(),
  );
  useEffect(() => {
    if (isKaraokeEmbeddedFontsReady()) {
      setEmbeddedFontsReady(true);
      return;
    }
    let cancelled = false;
    void ensureKaraokeEmbeddedFonts().finally(() => {
      if (!cancelled) setEmbeddedFontsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  /** 缺源时把选择回写到可用源，避免烧录/预览不一致 */
  useEffect(() => {
    if (!open) return;
    const resolved = resolveKaraokeAudioSource(projectRef.current, {
      allowPendingVideo: !!resolveVideoUrl,
    });
    if (resolved === projectRef.current.audioSource) return;
    const next = { ...projectRef.current, audioSource: resolved, updatedAt: Date.now() };
    projectRef.current = next;
    setProject(next);
    onProjectChange?.(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 跟可用源变化
  }, [open, project.audioUrl, project.videoUrl, previewSrc, resolveVideoUrl, onProjectChange]);

  useEffect(() => {
    if (!open) return;
    closedRef.current = false;
    sessionRef.current += 1;
    // 打开时合并默认样式：旧工程缺字段时补齐新默认（双行 A左缘147/B右缘1778 · Y759·911 / 字号96 等）
    // 指示灯默认关（用户反馈不要预览球）；旧工程 enabled:true 也强制关掉
    // 开唱倒计时蓝点暂关；打开编辑器强制 enabled:false（预览/烧录一致）
    let style = mergeStyle(initialProject.style, {
      indicator: {
        ...(initialProject.style?.indicator || {}),
        enabled: false,
      },
      countdown: {
        ...DEFAULT_KARAOKE_COUNTDOWN,
        ...(initialProject.style?.countdown || {}),
        // resolve 会把旧 positions[0] 迁入 anchor
        anchor: resolveKaraokeCountdown(initialProject.style?.countdown).anchor,
        positions: [],
        enabled: false,
      },
      // UI 已去掉渐隐滑条：打开时统一写入当前默认（1s）
      lineFadeOutSec: KARAOKE_LINE_FADE_OUT_SEC,
    });
    const migrateDualPos = shouldMigrateKaraokeDualPosToDefault(style.posA, style.posB);
    if (migrateDualPos) {
      style = mergeStyle(style, {
        layoutMode: 'dualAlternate',
        posA: { ...DEFAULT_KARAOKE_POS_A },
        posB: { ...DEFAULT_KARAOKE_POS_B },
      });
    } else if (!initialProject.style?.layoutMode) {
      style = mergeStyle(style, { layoutMode: 'dualAlternate' });
    }
    const strokeLegacy = karaokeLyricStrokeLegacyPatch(initialProject.style);
    if (strokeLegacy) {
      style = mergeStyle(style, strokeLegacy);
    }
    // 已是单行但 pos 仍停在双行左默认 → 迁到下方居中
    if (
      resolveKaraokeLayoutMode(style.layoutMode) === 'single' &&
      shouldMigrateKaraokeSinglePosToDefault(style.posA)
    ) {
      const nextPos = { ...DEFAULT_KARAOKE_POS_SINGLE };
      const aligned = karaokeMarginAlignmentFromPos(nextPos);
      style = mergeStyle(style, {
        posA: nextPos,
        marginV: aligned.marginV,
        alignment: aligned.alignment,
      });
    }
    if (!initialProject.style?.openingTitlePos) {
      style = mergeStyle(style, {
        openingTitlePos: { ...DEFAULT_KARAOKE_STYLE.openingTitlePos },
      });
    }
    if (!initialProject.style?.openingLyricistPos) {
      style = mergeStyle(style, {
        openingLyricistPos: { ...DEFAULT_KARAOKE_STYLE.openingLyricistPos },
      });
    }
    if (!initialProject.style?.openingComposerPos) {
      style = mergeStyle(style, {
        openingComposerPos: { ...DEFAULT_KARAOKE_STYLE.openingComposerPos },
      });
    }
    const seeded: KaraokeProject = {
      ...initialProject,
      audioSource: resolveKaraokeAudioSource(initialProject, {
        allowPendingVideo: !!resolveVideoUrl,
      }),
      style,
    };
    setProject(seeded);
    if (
      migrateDualPos ||
      !!strokeLegacy ||
      initialProject.style?.lineFadeOutSec !== KARAOKE_LINE_FADE_OUT_SEC ||
      !initialProject.style?.openingTitlePos ||
      !initialProject.style?.openingLyricistPos ||
      !initialProject.style?.openingComposerPos
    ) {
      onProjectChange?.(seeded);
    }
    const name = String(seeded.style?.fontName || DEFAULT_KARAOKE_STYLE.fontName).trim();
    setFontSelect(KARAOKE_FONT_PRESETS.some((f) => f.value === name) ? name : FONT_CUSTOM);
    setBusy('idle');
    setStatus('');
    setError('');
    setPlayTime(0);
    setMediaDuration(Math.max(0, Number(seeded.songDurationSec) || 0));
    setIsPlaying(false);
    setResolvingPreviewVideo(false);
    setDraggingSlot(null);
    dragRef.current = null;
    setCharEditLineId(null);
    setCharEditIndex(null);
    setLineTextEdit(null);
    lineTextEditRef.current = null;
    setCharInsertEdit(null);
    charInsertEditRef.current = null;
    setCharBarCtxMenu(null);
    previewFocusSyncRef.current = null;
    charEditPinnedRef.current = false;
    charTimingDragRef.current = null;
    charPointerGestureRef.current = null;
    charBarPanDragRef.current = null;
    charBarAutoPanKeyRef.current = null;
    charBarFollowSuppressUntilRef.current = 0;
    setCharBarPanSec(0);
    setCharBarZoom(1);
    setCharBarWidthPx(0);
    suppressCharClickSeekRef.current = false;
    setPreviewSrc(toPlayableMediaSrc(String(seeded.videoUrl || '')));
    setAudioSrc(toPlayableMediaSrc(String(seeded.audioUrl || '')));
    // 仅在打开时灌入 seed；打开期间 onProjectChange 回写不应重置本地编辑态
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open 边沿灌入
  }, [open]);

  /** 父级异步解析/上传/清除成片后同步进本地工程 */
  useEffect(() => {
    if (!open) return;
    const url = String(initialProject.videoUrl || '').trim();
    const cur = String(projectRef.current.videoUrl || '').trim();
    if (url === cur) return;
    const next = {
      ...projectRef.current,
      videoUrl: url || undefined,
      updatedAt: Date.now(),
    };
    projectRef.current = next;
    setProject(next);
    setPreviewSrc(toPlayableMediaSrc(url));
    // 父级已是真相源时不必再 onProjectChange，避免回写循环
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只跟父级 videoUrl
  }, [open, initialProject.videoUrl]);

  /** 工程内 videoUrl / audioUrl 变更时同步预览源 */
  useEffect(() => {
    if (!open) return;
    setPreviewSrc(toPlayableMediaSrc(String(project.videoUrl || '')));
  }, [open, project.videoUrl]);

  useEffect(() => {
    if (!open) return;
    setAudioSrc(toPlayableMediaSrc(String(project.audioUrl || '')));
  }, [open, project.audioUrl]);

  /** 打开时若无成片、有 resolve，后台拉一次成片供预览（烧录仍会再 resolve） */
  useEffect(() => {
    if (!open || !resolveVideoUrl) return;
    // 用 initialProject，避免与 seed 同帧时 projectRef 仍是旧值
    if (String(initialProject.videoUrl || '').trim()) return;
    let cancelled = false;
    const run = async () => {
      setResolvingPreviewVideo(true);
      try {
        const url = String((await resolveVideoUrl()) || '').trim();
        if (cancelled || !url) return;
        // 用户已在 resolve 期间上传本地成片 → 勿覆盖
        if (String(projectRef.current.videoUrl || '').trim()) return;
        // 用当前工程合并 videoUrl，避免覆盖已生成的 lines/chars
        setProject((prev) => {
          if (String(prev.videoUrl || '').trim()) return prev;
          const next = { ...prev, videoUrl: url, updatedAt: Date.now() };
          projectRef.current = next;
          onProjectChange?.(next);
          return next;
        });
      } catch {
        /* 仍可用原曲音频对轴 */
      } finally {
        if (!cancelled) setResolvingPreviewVideo(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅 open 边沿
  }, [open]);

  useEffect(() => {
    playTimeRef.current = playTime;
  }, [playTime]);

  useEffect(() => {
    if (!open) return;
    if (recordStageSize && recordStageSize.w > 0 && recordStageSize.h > 0) {
      setStageSize(recordStageSize);
      return;
    }
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setStageSize({ w, h });
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [open, previewSrc, audioSrc, previewFullscreen, recordStageSize]);

  const getMediaEl = useCallback((): HTMLMediaElement | null => {
    // 有成片时始终以 video 为时钟（含 song 模式 muted + 外挂 audio）
    if (previewSrc && videoRef.current) return videoRef.current;
    if (audioSrc && audioRef.current) return audioRef.current;
    return videoRef.current || audioRef.current;
  }, [previewSrc, audioSrc]);

  const syncSongAudioToVideo = useCallback(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a || !useSongAudio || !hasVideoPreview) return;
    try {
      if (Math.abs((a.currentTime || 0) - (v.currentTime || 0)) > 0.12) {
        a.currentTime = v.currentTime || 0;
      }
    } catch {
      /* ignore */
    }
  }, [hasVideoPreview, useSongAudio]);

  const stopRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  /** 用户拖滑条 / 滚轮平移字轨后短暂暂停自动跟随 */
  const suppressCharBarFollow = useCallback(() => {
    charBarFollowSuppressUntilRef.current =
      performance.now() + CHAR_BAR_FOLLOW_SUPPRESS_MS;
  }, []);

  /**
   * 字轨视口跟随播放头：playhead ≈ 可视区左侧 followRatio 处（中部偏左）。
   * 仅动 pan，不改字 start/end；拖 pan 或 suppress 窗口内跳过。
   */
  const syncCharBarFollowPlayhead = useCallback((playT: number) => {
    if (charBarPanDragRef.current) return;
    if (performance.now() < charBarFollowSuppressUntilRef.current) return;
    const view = charBarViewRef.current;
    if (!view.canPan || !(view.maxPan > 1e-4) || !(view.viewSpan > 1e-6)) return;
    const off = Number(projectRef.current.globalOffsetSec) || 0;
    const playStored = playT - off;
    const nextPan = Math.min(
      view.maxPan,
      Math.max(
        0,
        playStored - view.fullLo - view.viewSpan * CHAR_BAR_FOLLOW_RATIO,
      ),
    );
    if (Math.abs(nextPan - charBarPanSecRef.current) < 5e-4) return;
    charBarPanSecRef.current = nextPan;
    setCharBarPanSec(nextPan);
  }, []);

  const tickPlayTime = useCallback(() => {
    const v = getMediaEl();
    if (!v) return;
    const t = v.currentTime || 0;
    setPlayTime(t);
    if (!v.paused && !v.ended) {
      syncCharBarFollowPlayhead(t);
      rafRef.current = requestAnimationFrame(tickPlayTime);
    } else {
      rafRef.current = null;
    }
  }, [getMediaEl, syncCharBarFollowPlayhead]);

  useEffect(() => () => stopRaf(), [stopRaf]);

  /** 切源 / 切音源时停播并复位时间 */
  useEffect(() => {
    if (!open) return;
    stopRaf();
    setIsPlaying(false);
    setPlayTime(0);
    const v = videoRef.current;
    const a = audioRef.current;
    if (v) {
      v.pause();
      try {
        v.currentTime = 0;
        v.muted = muteVideoForSong;
      } catch {
        /* ignore */
      }
    }
    if (a) {
      a.pause();
      try {
        a.currentTime = 0;
      } catch {
        /* ignore */
      }
    }
  }, [open, previewSrc, audioSrc, audioSource, muteVideoForSong, stopRaf]);

  /** song 模式：video 作画面时钟，audio 跟随 play/pause/seek */
  useEffect(() => {
    if (!open || !muteVideoForSong) return;
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;
    const onPlay = () => {
      syncSongAudioToVideo();
      if (a.paused) void a.play().catch(() => {});
    };
    const onPause = () => {
      a.pause();
    };
    const onSeeked = () => {
      syncSongAudioToVideo();
    };
    const onEnded = () => {
      a.pause();
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('ended', onEnded);
    v.muted = true;
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('ended', onEnded);
    };
  }, [open, muteVideoForSong, previewSrc, audioSrc, syncSongAudioToVideo, previewFullscreen]);

  /** video 音源：确保原曲 audio 不抢声，并取消 mute */
  useEffect(() => {
    if (!open || !hasVideoPreview) return;
    const v = videoRef.current;
    const a = audioRef.current;
    if (v) {
      try {
        v.muted = muteVideoForSong;
      } catch {
        /* ignore */
      }
    }
    if (!useSongAudio && a && !a.paused) {
      a.pause();
    }
  }, [open, hasVideoPreview, muteVideoForSong, useSongAudio]);

  const syncDurationFromMedia = useCallback(
    (el: HTMLMediaElement | null) => {
      if (!el) return;
      const d = Number(el.duration);
      if (Number.isFinite(d) && d > 0) {
        setMediaDuration(d);
        return;
      }
      const fallback = Math.max(0, Number(projectRef.current.songDurationSec) || 0);
      if (fallback > 0) setMediaDuration(fallback);
    },
    [],
  );

  /** 暂停预览（进度条拖动/seek 用；松手后保持暂停，不自动续播） */
  const pausePreviewPlayback = useCallback(() => {
    stopRaf();
    setIsPlaying(false);
    try {
      videoRef.current?.pause();
      audioRef.current?.pause();
    } catch {
      /* ignore */
    }
  }, [stopRaf]);

  const togglePreviewPlayback = useCallback(() => {
    if (!canPlayPreview) return;
    // 成片画面 + 原曲声音：两边同步
    if (muteVideoForSong) {
      const v = videoRef.current;
      const a = audioRef.current;
      if (!v || !a) return;
      if (v.paused) {
        try {
          a.currentTime = v.currentTime || 0;
        } catch {
          /* ignore */
        }
        void Promise.all([v.play(), a.play()]).catch(() => {
          setIsPlaying(false);
        });
      } else {
        v.pause();
        a.pause();
      }
      return;
    }
    // 仅原曲（无成片）
    if (useSongAudio && !hasVideoPreview) {
      const a = audioRef.current;
      if (!a) return;
      if (a.paused) {
        void a.play().catch(() => setIsPlaying(false));
      } else {
        a.pause();
      }
      return;
    }
    // 成片自带音轨
    const el = getMediaEl();
    if (!el) return;
    if (el.paused) {
      if (audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
      }
      try {
        if (videoRef.current) videoRef.current.muted = false;
      } catch {
        /* ignore */
      }
      void el.play().catch(() => {
        setIsPlaying(false);
      });
    } else {
      el.pause();
    }
  }, [canPlayPreview, getMediaEl, hasVideoPreview, muteVideoForSong, useSongAudio]);

  const seekPreviewTo = useCallback(
    (t: number) => {
      const el = getMediaEl();
      if (!el) return;
      const dur =
        Number.isFinite(el.duration) && el.duration > 0
          ? el.duration
          : mediaDuration || Math.max(0, Number(projectRef.current.songDurationSec) || 0);
      const next = Math.max(0, Math.min(dur > 0 ? dur : t, t));
      try {
        el.currentTime = next;
      } catch {
        /* ignore */
      }
      if (muteVideoForSong && audioRef.current) {
        try {
          audioRef.current.currentTime = next;
        } catch {
          /* ignore */
        }
      }
      setPlayTime(next);
      // 拖进度条/微调时也让字轨视口跟上播放头（抑制窗口内跳过）
      syncCharBarFollowPlayhead(next);
    },
    [getMediaEl, mediaDuration, muteVideoForSong, syncCharBarFollowPlayhead],
  );

  const seekPreviewFromClientX = useCallback(
    (clientX: number) => {
      if (!canPlayPreview || busy !== 'idle') return;
      const bar = seekBarRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const dur =
        mediaDuration ||
        Math.max(0, Number(projectRef.current.songDurationSec) || 0) ||
        0;
      if (dur <= 0) return;
      // 拖进度条 / 点击 seek：始终暂停，不自动续播
      pausePreviewPlayback();
      seekPreviewTo(ratio * dur);
    },
    [busy, canPlayPreview, mediaDuration, pausePreviewPlayback, seekPreviewTo],
  );

  const onSeekBarPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!canPlayPreview || busy !== 'idle') return;
      e.preventDefault();
      seekDraggingRef.current = true;
      pausePreviewPlayback();
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
      seekPreviewFromClientX(e.clientX);
    },
    [busy, canPlayPreview, pausePreviewPlayback, seekPreviewFromClientX],
  );

  const onSeekBarPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!seekDraggingRef.current) return;
      seekPreviewFromClientX(e.clientX);
    },
    [seekPreviewFromClientX],
  );

  const onSeekBarPointerUp = useCallback(() => {
    // 松手后保持暂停（不恢复播放）
    seekDraggingRef.current = false;
  }, []);

  /** 预览进度微调：0.1s；Shift 时 0.5s */
  const nudgePreviewBy = useCallback(
    (dir: -1 | 1, large: boolean) => {
      if (!canPlayPreview || busyRef.current !== 'idle') return;
      const step = large ? 0.5 : 0.1;
      seekPreviewTo(playTimeRef.current + dir * step);
    },
    [canPlayPreview, seekPreviewTo],
  );

  /** 预览区滚轮微调进度（非 passive，可 preventDefault；避免抢走输入框） */
  useEffect(() => {
    if (!open) return;
    const el = previewShellRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!canPlayPreview || busyRef.current !== 'idle') return;
      if (isTypingTarget(e.target)) return;
      const delta =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!delta) return;
      e.preventDefault();
      e.stopPropagation();
      nudgePreviewBy(delta > 0 ? 1 : -1, e.shiftKey);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [open, canPlayPreview, nudgePreviewBy, previewFullscreen]);

  const bindMediaEvents = useCallback(
    (el: HTMLMediaElement | null) => {
      if (!el) return () => {};
      const onPlay = () => {
        setIsPlaying(true);
        charBarFollowSuppressUntilRef.current = 0;
        stopRaf();
        rafRef.current = requestAnimationFrame(tickPlayTime);
        syncCharBarFollowPlayhead(el.currentTime || 0);
      };
      const onPause = () => {
        setIsPlaying(false);
        stopRaf();
        setPlayTime(el.currentTime || 0);
      };
      const onEnded = () => {
        setIsPlaying(false);
        stopRaf();
        setPlayTime(el.currentTime || 0);
      };
      const onSeeked = () => setPlayTime(el.currentTime || 0);
      const onTimeUpdate = () => {
        if (el.paused) setPlayTime(el.currentTime || 0);
      };
      const onLoaded = () => syncDurationFromMedia(el);
      el.addEventListener('play', onPlay);
      el.addEventListener('pause', onPause);
      el.addEventListener('ended', onEnded);
      el.addEventListener('seeked', onSeeked);
      el.addEventListener('timeupdate', onTimeUpdate);
      el.addEventListener('loadedmetadata', onLoaded);
      el.addEventListener('durationchange', onLoaded);
      syncDurationFromMedia(el);
      return () => {
        el.removeEventListener('play', onPlay);
        el.removeEventListener('pause', onPause);
        el.removeEventListener('ended', onEnded);
        el.removeEventListener('seeked', onSeeked);
        el.removeEventListener('timeupdate', onTimeUpdate);
        el.removeEventListener('loadedmetadata', onLoaded);
        el.removeEventListener('durationchange', onLoaded);
      };
    },
    [stopRaf, syncDurationFromMedia, syncCharBarFollowPlayhead, tickPlayTime],
  );

  useEffect(() => {
    if (!open || !previewSrc) return;
    return bindMediaEvents(videoRef.current);
  }, [open, previewSrc, bindMediaEvents, previewFullscreen]);

  useEffect(() => {
    // 仅原曲、无成片时以 audio 为时钟
    if (!open || previewSrc || !audioSrc || !useSongAudio) return;
    return bindMediaEvents(audioRef.current);
  }, [open, previewSrc, audioSrc, useSongAudio, bindMediaEvents, previewFullscreen]);

  const togglePreviewFullscreen = useCallback(() => {
    // 合成抓帧中勿切全屏（portal 会拆掉 capture 节点）；日常预览不受影响
    if (busyRef.current === 'burn' || composeCapturing) return;
    const media =
      (previewSrc && videoRef.current) ||
      (audioSrc && audioRef.current) ||
      videoRef.current ||
      audioRef.current;
    previewFsKeepPlayingRef.current = !!(media && !media.paused && !media.ended) || isPlaying;
    playTimeRef.current = media?.currentTime || playTimeRef.current;
    setPreviewFullscreen((v) => !v);
  }, [audioSrc, composeCapturing, isPlaying, previewSrc]);

  /** 全屏 portal 切换可能重建 media；恢复进度与播放态 */
  useLayoutEffect(() => {
    if (!open) return;
    const media = getMediaEl();
    if (!media) return;
    const t = playTimeRef.current;
    try {
      if (Number.isFinite(t) && t >= 0 && Math.abs((media.currentTime || 0) - t) > 0.25) {
        media.currentTime = t;
      }
    } catch {
      /* ignore */
    }
    if (previewFsKeepPlayingRef.current) {
      syncSongAudioToVideo();
      setIsPlaying(true);
      stopRaf();
      rafRef.current = requestAnimationFrame(tickPlayTime);
      void media.play().catch(() => {});
    }
  }, [open, previewFullscreen, getMediaEl, syncSongAudioToVideo, stopRaf, tickPlayTime]);

  const persist = useCallback(
    (next: KaraokeProject) => {
      projectRef.current = next;
      setProject(next);
      onProjectChange?.(next);
    },
    [onProjectChange],
  );

  const patchProjectLine = useCallback(
    (lineId: string, mapper: (line: KaraokeLine) => KaraokeLine) => {
      const cur = projectRef.current;
      const lines = (cur.lines || []).map((l) => (l.id === lineId ? mapper(l) : l));
      const next: KaraokeProject = {
        ...cur,
        lines,
        weakLineAlignment: recomputeKaraokeWeakLineAlignment(lines),
        updatedAt: Date.now(),
      };
      persist(next);
    },
    [persist],
  );

  const syncCharBarSelection = useCallback((next: CharBarSel[]) => {
    charBarSelectionRef.current = next;
    setCharBarSelection(next);
  }, []);

  const beginLineTextEdit = useCallback((lineId: string) => {
    if (busyRef.current !== 'idle') return;
    const line = (projectRef.current.lines || []).find((l) => l.id === lineId);
    if (!line || line.instrumental) return;
    const draft =
      String(line.text || '').trim() ||
      (line.chars || []).map((c) => c.text).join('');
    suppressCharClickSeekRef.current = true;
    setCharEditLineId(lineId);
    charInsertEditRef.current = null;
    setCharInsertEdit(null);
    const edit = { lineId, draft };
    lineTextEditRef.current = edit;
    setLineTextEdit(edit);
    window.setTimeout(() => {
      lineTextEditInputRef.current?.focus();
      lineTextEditInputRef.current?.select();
    }, 0);
  }, []);

  const cancelLineTextEdit = useCallback(() => {
    lineTextEditRef.current = null;
    setLineTextEdit(null);
  }, []);

  /** 改行 text/chars 后回写第 1 步歌词（与双击改词同一套） */
  const persistLineCharsEdit = useCallback(
    (
      lineId: string,
      mapLine: (line: KaraokeLine) => KaraokeLine,
      selectIndex: number | null,
    ) => {
      const cur = projectRef.current;
      const lines = (cur.lines || []).map((l) => (l.id === lineId ? mapLine(l) : l));
      const lyrics = lyricsTextFromKaraokeLines(lines);
      const next: KaraokeProject = {
        ...cur,
        lines,
        lyrics,
        weakLineAlignment: recomputeKaraokeWeakLineAlignment(lines),
        updatedAt: Date.now(),
      };
      setCharEditLineId(lineId);
      const edited = lines.find((l) => l.id === lineId);
      const n = edited?.chars?.length || 0;
      if (selectIndex == null || n <= 0) {
        setCharEditIndex(null);
      } else {
        setCharEditIndex(Math.max(0, Math.min(n - 1, selectIndex)));
      }
      persist(next);
    },
    [persist],
  );

  const commitLineTextEdit = useCallback(() => {
    const edit = lineTextEditRef.current;
    if (!edit) return;
    lineTextEditRef.current = null;
    setLineTextEdit(null);
    const draft = String(edit.draft || '').replace(/\r\n/g, '\n').replace(/\n+/g, '').trim();
    if (!draft) return;
    persistLineCharsEdit(
      edit.lineId,
      (l) => {
        const prevText =
          String(l.text || '').trim() || (l.chars || []).map((c) => c.text).join('');
        if (prevText === draft) return l;
        return remapKaraokeLineText(l, draft);
      },
      null,
    );
  }, [persistLineCharsEdit]);

  const cancelCharInsertEdit = useCallback(() => {
    const edit = charInsertEditRef.current;
    charInsertEditRef.current = null;
    setCharInsertEdit(null);
    if (!edit?.isNewSentence) return;
    const cur = projectRef.current;
    const line = (cur.lines || []).find((l) => l.id === edit.lineId);
    if (!line || !karaokeLineHasNoLyricText(line)) return;
    const lines = (cur.lines || []).filter((l) => l.id !== edit.lineId);
    persist({
      ...cur,
      lines,
      lyrics: lyricsTextFromKaraokeLines(lines),
      weakLineAlignment: recomputeKaraokeWeakLineAlignment(lines),
      updatedAt: Date.now(),
    });
  }, [persist]);

  const beginCharInsertEdit = useCallback(
    (lineId: string, atIndex: number, preferSec?: number, isNewSentence?: boolean) => {
      if (busyRef.current !== 'idle') return;
      const line = (projectRef.current.lines || []).find((l) => l.id === lineId);
      if (!line || line.instrumental) return;
      lineTextEditRef.current = null;
      setLineTextEdit(null);
      const idx = Math.max(0, Math.min((line.chars || []).length, Math.floor(atIndex)));
      suppressCharClickSeekRef.current = true;
      setCharEditLineId(lineId);
      setCharEditIndex(null);
      const prefer =
        preferSec != null && Number.isFinite(preferSec) ? Number(preferSec) : undefined;
      const edit = {
        lineId,
        atIndex: idx,
        draft: '',
        preferSec: prefer,
        ...(isNewSentence ? { isNewSentence: true as const } : {}),
      };
      charInsertEditRef.current = edit;
      setCharInsertEdit(edit);
      window.setTimeout(() => {
        charInsertInputRef.current?.focus();
        charInsertInputRef.current?.select();
      }, 0);
    },
    [],
  );

  const commitCharInsertEdit = useCallback(() => {
    const edit = charInsertEditRef.current;
    if (!edit) return;
    const draft = String(edit.draft || '').replace(/\r\n/g, '\n').replace(/\n+/g, '').trim();
    if (!draft) {
      cancelCharInsertEdit();
      return;
    }
    charInsertEditRef.current = null;
    setCharInsertEdit(null);
    persistLineCharsEdit(
      edit.lineId,
      (l) =>
        insertKaraokeLineChars(l, edit.atIndex, draft, {
          preferSec: edit.preferSec,
        }),
      edit.atIndex,
    );
  }, [cancelCharInsertEdit, persistLineCharsEdit]);

  const deleteSelectedChars = useCallback(
    (items?: CharBarSel[]) => {
      if (busyRef.current !== 'idle') return;
      cancelCharInsertEdit();
      const sels =
        items && items.length ? items : charBarSelectionRef.current.slice();
      if (!sels.length) return;
      const cur = projectRef.current;
      const delByLine = new Map<string, number[]>();
      for (const it of sels) {
        const arr = delByLine.get(it.lineId) || [];
        arr.push(it.charIndex);
        delByLine.set(it.lineId, arr);
      }
      let lines = cur.lines || [];
      const changedIds: string[] = [];
      for (const [lineId, idxs] of delByLine) {
        changedIds.push(lineId);
        idxs.sort((a, b) => b - a);
        lines = lines.map((l) => {
          if (l.id !== lineId) return l;
          let next = l;
          for (const i of idxs) next = deleteKaraokeLineChar(next, i);
          return next;
        });
      }
      const lyrics = patchKaraokeLyricsForChangedLines(String(cur.lyrics || ''), lines, changedIds);
      persist({
        ...cur,
        lines,
        lyrics,
        weakLineAlignment: recomputeKaraokeWeakLineAlignment(lines),
        updatedAt: Date.now(),
      });
      syncCharBarSelection([]);
      setCharEditIndex(null);
    },
    [cancelCharInsertEdit, persist, syncCharBarSelection],
  );

  const deleteSelectedChar = useCallback(
    (lineId: string, charIndex: number) => {
      const sel = charBarSelectionRef.current;
      if (sel.length > 1 && sel.some((s) => s.lineId === lineId && s.charIndex === charIndex)) {
        deleteSelectedChars(sel);
        return;
      }
      if (busyRef.current !== 'idle') return;
      cancelCharInsertEdit();
      persistLineCharsEdit(
        lineId,
        (l) => deleteKaraokeLineChar(l, charIndex),
        Math.max(0, charIndex - 1),
      );
      syncCharBarSelection([]);
    },
    [cancelCharInsertEdit, deleteSelectedChars, persistLineCharsEdit, syncCharBarSelection],
  );

  const patchStyle = useCallback(
    (patch: Partial<KaraokeStyleOptions>) => {
      const cur = projectRef.current;
      const next = {
        ...cur,
        style: mergeStyle(cur.style, patch),
        updatedAt: Date.now(),
      };
      persist(next);
    },
    [persist],
  );

  const style = useMemo(() => mergeStyle(project.style, {}), [project.style]);
  const layoutMode = resolveKaraokeLayoutMode(style.layoutMode);
  const posA = useMemo(() => resolveKaraokePosA(style), [style]);
  const posB = useMemo(() => resolveKaraokePosB(style), [style]);
  const indicator = useMemo(() => resolveKaraokeIndicator(style.indicator), [style.indicator]);
  const countdown = useMemo(() => resolveKaraokeCountdown(style.countdown), [style.countdown]);
  const openingTitleFontSize = clampKaraokeOpeningTitleFontSize(style.openingTitleFontSize);
  const openingCreditFontSize = clampKaraokeOpeningCreditFontSize(style.openingCreditFontSize);
  const lyricOutline = clampKaraokeOutline(
    style.outline ?? DEFAULT_KARAOKE_STYLE.outline,
    KARAOKE_LYRIC_OUTLINE_DEFAULT,
  );
  const lyricSungOutline = clampKaraokeOutline(
    style.sungOutlineWidth ?? DEFAULT_KARAOKE_STYLE.sungOutlineWidth,
    KARAOKE_LYRIC_SUNG_OUTLINE_DEFAULT,
  );
  const openingTitleOutline = clampKaraokeOutline(
    style.openingTitleOutline ?? DEFAULT_KARAOKE_STYLE.openingTitleOutline,
    KARAOKE_OPENING_TITLE_OUTLINE,
  );
  const openingCreditOutline = clampKaraokeOutline(
    style.openingCreditOutline ?? DEFAULT_KARAOKE_STYLE.openingCreditOutline,
    KARAOKE_OPENING_CREDIT_OUTLINE,
  );
  const lineFadeOutSec = clampKaraokeLineFadeOutSec(style.lineFadeOutSec);
  const interludeTiming = useMemo(
    () => resolveKaraokeInterludeTiming(style),
    [
      style.interludeClearGapSec,
      style.countdownReentryGapSec,
      style.countdownLeadInMaxSec,
    ],
  );
  const {
    interludeClearGapSec,
    countdownReentryGapSec,
    countdownLeadInMaxSec,
  } = interludeTiming;
  const openingTitlePos = useMemo(() => resolveKaraokeOpeningTitlePos(style), [style]);
  const openingLyricistPos = useMemo(() => resolveKaraokeOpeningLyricistPos(style), [style]);
  const openingComposerPos = useMemo(() => resolveKaraokeOpeningComposerPos(style), [style]);
  const charCount = useMemo(() => countSingableChars(project), [project]);
  /** 有可唱歌词（字级或行文本）时禁止示例占位 */
  const hasSingableLyrics = useMemo(
    () => contentfulSingableLines(project.lines || []).length > 0,
    [project.lines],
  );
  const hasMediaForAsr = useMemo(
    () =>
      !!(String(project.audioUrl || '').trim() || String(project.videoUrl || '').trim()),
    [project.audioUrl, project.videoUrl],
  );
  /** 有音频时仅字级 ASR 算「已就绪」；均分/句级插值不算完成 */
  const hasTiming = useMemo(() => {
    if (charCount <= 0) return false;
    if (hasMediaForAsr) {
      return (
        project.timingSource === 'asrWords' &&
        Array.isArray(project.asrWords) &&
        project.asrWords.length > 0
      );
    }
    return true;
  }, [charCount, hasMediaForAsr, project.asrWords, project.timingSource]);

  // 渲染路径勿再传 asrWords：lines 已含字级；传未偏移 words 会在超长拆行时重映射打乱轴
  const offsetLines = useMemo(
    () =>
      prepareKaraokeLinesForRender(
        applyGlobalOffsetToLines(project.lines || [], Number(project.globalOffsetSec) || 0),
        undefined,
        project.lyrics,
      ),
    [project.lines, project.globalOffsetSec, project.lyrics],
  );

  const globalOff = Number(project.globalOffsetSec) || 0;

  /** 可编辑行：直接改 project.lines（未加全局偏移）；面板数字显示 = 存盘 + offset，与预览时钟一致 */
  const editableSingableLines = useMemo(
    () => singableLines(project.lines || []),
    [project.lines],
  );

  const activeOffsetLineId = useMemo(() => {
    const idx = findActiveSingableIndex(offsetLines, playTime);
    if (idx < 0) return null;
    const line = singableLines(offsetLines)[idx];
    return line?.id || null;
  }, [offsetLines, playTime]);

  /** 播放句 id 可能是拆行后缀 `-p0`；回溯到工程行 */
  const resolveProjectLineId = useCallback(
    (rawId: string | null | undefined): string | null => {
      const id = String(rawId || '').trim();
      if (!id) return null;
      const lines = project.lines || [];
      if (lines.some((l) => l.id === id)) return id;
      const base = id.replace(/-p\d+$/, '');
      if (base && lines.some((l) => l.id === base)) return base;
      // 拆行只存在于 prepare 结果时：用文本匹配工程行
      const fromOff = offsetLines.find((l) => l.id === id);
      const text = String(fromOff?.text || '').trim();
      if (text) {
        const hit = lines.find(
          (l) =>
            !l.instrumental &&
            (l.text === text || String(l.text || '').includes(text) || text.includes(String(l.text || ''))),
        );
        if (hit) return hit.id;
      }
      return null;
    },
    [offsetLines, project.lines],
  );

  const selectedCharEditLineId = useMemo(() => {
    // charEditLineId 由 playTime/previewFocus sync 写入；无 active 时回退手动选中或首行
    if (charEditLineId && editableSingableLines.some((l) => l.id === charEditLineId)) {
      return charEditLineId;
    }
    const fromPlay = resolveProjectLineId(activeOffsetLineId);
    if (fromPlay && editableSingableLines.some((l) => l.id === fromPlay)) return fromPlay;
    return editableSingableLines[0]?.id || null;
  }, [
    activeOffsetLineId,
    charEditLineId,
    editableSingableLines,
    resolveProjectLineId,
  ]);

  const selectedCharEditLine = useMemo(
    () => editableSingableLines.find((l) => l.id === selectedCharEditLineId) || null,
    [editableSingableLines, selectedCharEditLineId],
  );

  /** 选中字下标钳制到当前行 */
  const selectedCharEditIndex = useMemo(() => {
    if (!selectedCharEditLine?.chars?.length || charEditIndex == null) return null;
    if (charEditIndex < 0 || charEditIndex >= selectedCharEditLine.chars.length) return null;
    return charEditIndex;
  }, [selectedCharEditLine, charEditIndex]);

  const selectedCharEditChar = useMemo(() => {
    if (selectedCharEditIndex == null || !selectedCharEditLine) return null;
    return selectedCharEditLine.chars[selectedCharEditIndex] || null;
  }, [selectedCharEditLine, selectedCharEditIndex]);

  const charBarMediaDuration = Math.max(
    0,
    mediaDuration || Number(project.songDurationSec) || 0,
  );
  const charBarRange = useMemo(
    () =>
      karaokeCharBarFullRange({
        durationSec: charBarMediaDuration,
        lines: editableSingableLines,
      }),
    [charBarMediaDuration, editableSingableLines],
  );

  /** 测量字轨宽度，用于缩放/平移 */
  useLayoutEffect(() => {
    const el = charBarRef.current;
    if (!el) {
      setCharBarWidthPx(0);
      return;
    }
    const measure = () => {
      const w = el.getBoundingClientRect().width || el.clientWidth || 0;
      setCharBarWidthPx((prev) => (Math.abs(prev - w) < 0.5 ? prev : w));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [editableSingableLines.length, lineTextEdit?.lineId, charInsertEdit?.lineId, previewFullscreen, layoutMode]);

  /** 选中字滚入可见时间窗（换选时；不因换句重置整轨缩放） */
  useLayoutEffect(() => {
    const line = selectedCharEditLine;
    const ch = selectedCharEditChar;
    if (!line?.chars?.length || !ch || charBarWidthPx < 8) return;
    if (charBarSelection.length > 1) return;
    const key = `${line.id}:${selectedCharEditIndex}`;
    if (charBarAutoPanKeyRef.current === key) return;
    charBarAutoPanKeyRef.current = key;
    const { fullLo, fullSpan } = charBarRange;
    const viewSpan = karaokeCharBarVisibleSpan(fullSpan, charBarZoom);
    const maxPan = Math.max(0, fullSpan - viewSpan);
    if (maxPan < 1e-4) {
      setCharBarPanSec(0);
      return;
    }
    const s = Number(ch.startSec) || 0;
    const e = Math.max(s + 0.03, Number(ch.endSec) || 0);
    const mid = (s + e) / 2;
    setCharBarPanSec((prev) => {
      const pan = Math.min(maxPan, Math.max(0, prev));
      const viewLo = fullLo + pan;
      const viewHi = viewLo + viewSpan;
      const margin = viewSpan * 0.1;
      if (s >= viewLo + margin && e <= viewHi - margin) return pan;
      return Math.min(maxPan, Math.max(0, mid - viewSpan / 2 - fullLo));
    });
  }, [
    charBarRange,
    charBarWidthPx,
    charBarZoom,
    selectedCharEditChar,
    selectedCharEditIndex,
    selectedCharEditLine,
    charBarSelection.length,
  ]);

  const selectCharEdit = useCallback(
    (lineId: string, charIndex: number, opts?: { seek?: boolean }) => {
      const line = (projectRef.current.lines || []).find((l) => l.id === lineId);
      if (!line?.chars?.length) return;
      const idx = Math.max(0, Math.min(line.chars.length - 1, charIndex));
      setCharEditLineId(lineId);
      setCharEditIndex(idx);
      syncCharBarSelection([{ lineId, charIndex: idx }]);
      if (opts?.seek !== false) {
        const off = Number(projectRef.current.globalOffsetSec) || 0;
        const start = (Number(line.chars[idx].startSec) || 0) + off;
        seekPreviewTo(Math.max(0, start - 0.02));
      }
    },
    [seekPreviewTo, syncCharBarSelection],
  );

  const applyCharTimingDragDelta = useCallback(
    (drag: CharTimingDragState, clientX: number) => {
      const dx = clientX - drag.originClientX;
      const dSec = dx * drag.secPerPx;
      const dur = Math.max(0.03, drag.originEnd - drag.originStart);
      let start = drag.originStart;
      let end = drag.originEnd;
      /** 右缘拉长只改 end，避免把 start 一并传入触发前字压缩 */
      let endOnly = false;
      if (drag.kind === 'preview-translate' || drag.kind === 'bar-translate') {
        start = Math.max(0, drag.originStart + dSec);
        end = start + dur;
      } else if (drag.kind === 'bar-start') {
        start = Math.max(0, Math.min(drag.originEnd - 0.03, drag.originStart + dSec));
        end = drag.originEnd;
      } else if (drag.kind === 'bar-end') {
        end = Math.max(drag.originStart + 0.03, drag.originEnd + dSec);
        endOnly = true;
      }
      patchProjectLine(drag.lineId, (line) =>
        applyCharTimingRipple(
          {
            ...line,
            startSec: drag.baselineLineStart,
            endSec: drag.baselineLineEnd,
            chars: drag.baselineChars.map((c) => ({ ...c })),
          },
          drag.charIndex,
          endOnly ? { endSec: end } : { startSec: start, endSec: end },
        ),
      );
    },
    [patchProjectLine],
  );

  const openingTimeline = useMemo(
    () => karaokeOpeningTimelineForProject(project),
    [project],
  );
  const openingOpacity = useMemo(
    () => openingCreditsOpacity(playTime, openingTimeline.endSec, openingTimeline.fadeSec),
    [playTime, openingTimeline.endSec, openingTimeline.fadeSec],
  );
  /** 开场蓝点逐点透明度（hold 全亮 → 右→左渐隐熄灭，对齐 ASS `\fad`） */
  const openingCountdownDotOpacities = useMemo(() => {
    const n = openingTimeline.maxDots;
    if (n <= 0) return [] as number[];
    return Array.from({ length: n }, (_, i) =>
      karaokeCountdownDotOpacity(playTime, openingTimeline, i),
    );
  }, [openingTimeline, playTime]);
  const openingCountdownAnchor = useMemo(
    () => karaokeOpeningCountdownAnchorPos(posA),
    [posA],
  );
  /** 样式区展示用：整组锚点/首点中心（自定义 anchor 或 Line A 默认） */
  const countdownGroupAnchorPos = useMemo(
    () => karaokeCountdownGroupAnchor(countdown, openingCountdownAnchor),
    [countdown, openingCountdownAnchor],
  );
  /** 间奏再入蓝点（≥再入阈值最长间隙至多 1 次；与开场同锚 Line A） */
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
      const re = karaokeReentryTimeline(
        singMeta[i].singStart,
        singMeta[i - 1].singEnd,
        {
          fadeOutSec: lineFadeOutSec,
          gapThresholdSec: countdownReentryGapSec,
          leadInMaxSec: countdownLeadInMaxSec,
        },
      );
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
    project.previewOpeningCredits !== false && notYetSinging;
  const showOpeningCredits =
    showOpeningLayer && openingOpacity > 0.001;
  const showOpeningCountdown =
    showOpeningLayer && openingCountdownDotOpacities.some((o) => o > 0.001);
  /** 间奏再入点：正歌期也显示（不依赖开场层） */
  const showReentryCountdown = reentryCountdownDotOpacities.some((o) => o > 0.001);
  const openingSongTitle = String(project.songTitle || '').trim();
  const openingLyricist = resolveKaraokeCreditName(project.lyricist);
  const openingComposer = resolveKaraokeCreditName(project.composer);

  const unsungCss = assBgrToCssHex(style.unsungColor, '#FFFFFF');
  const roleColors = resolveKaraokeRoleColors(style.roleColors);
  const roleMaleCss = assBgrToCssHex(roleColors.male, '#0000FF');
  const roleFemaleCss = assBgrToCssHex(roleColors.female, '#FF0000');
  const roleChorusCss = assBgrToCssHex(roleColors.chorus, '#16E521');
  /** 无角色标记时已唱色跟随男色（与 ASS Primary / sungColor 一致） */
  const sungCss = roleMaleCss;
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
  const outlineCss = assBgrToCssHex(style.outlineColor, '#000000');
  const sungOutlineCss = assBgrToCssHex(style.sungOutlineColor, '#FFFFFF');
  const shadowCss = assBgrToCssHex(style.shadowColor, '#000000');

  /**
   * 双行交替：与方案 A（KaraokeBurnOverlayApp）共用 resolveDualPreviewAtTime。
   * A=偶数行 / B=奇数行；同槽 i+2 换行；长间奏清两侧后再入。
   */
  const dualPreview = useMemo(
    () =>
      resolveDualPreviewAtTime(offsetLines, playTime, {
        firstLyricAppearSec: karaokeFirstLyricAppearSec(openingTimeline),
        fadeOutSec: lineFadeOutSec,
        gapThresholdSec: interludeClearGapSec,
        countdownGapThresholdSec: countdownReentryGapSec,
        leadInMaxSec: countdownLeadInMaxSec,
        countdown,
        hasTiming,
      }),
    [
      countdown,
      countdownLeadInMaxSec,
      countdownReentryGapSec,
      hasTiming,
      interludeClearGapSec,
      lineFadeOutSec,
      offsetLines,
      openingTimeline,
      playTime,
    ],
  );

  /** 单行：与方案 A 共用 resolveSinglePreviewAtTime */
  const singlePreview = useMemo(
    () =>
      resolveSinglePreviewAtTime(offsetLines, playTime, {
        firstLyricAppearSec: karaokeFirstLyricAppearSec(openingTimeline),
        fadeOutSec: lineFadeOutSec,
        gapThresholdSec: interludeClearGapSec,
        countdownGapThresholdSec: countdownReentryGapSec,
        leadInMaxSec: countdownLeadInMaxSec,
        countdown,
        hasTiming,
      }),
    [
      countdown,
      countdownLeadInMaxSec,
      countdownReentryGapSec,
      hasTiming,
      interludeClearGapSec,
      lineFadeOutSec,
      offsetLines,
      openingTimeline,
      playTime,
    ],
  );
  const singlePreviewLine = singlePreview.line;
  const singlePreviewHeld = singlePreview.held;
  const singlePreviewFade = singlePreview.fade;

  /**
   * 预览「当前句」工程行 id：双行跟 activeSlot（正在唱/待唱指示那一行），单行跟 singlePreviewLine。
   * 播放与拖进度时下方字条始终跟此句。
   */
  const previewFocusProjectLineId = useMemo(() => {
    let offsetId: string | null = null;
    if (layoutMode === 'dualAlternate') {
      const line =
        dualPreview.activeSlot === 'B' ? dualPreview.lineB : dualPreview.lineA;
      offsetId = line?.id || null;
    } else {
      offsetId = singlePreviewLine?.id || activeOffsetLineId;
    }
    return resolveProjectLineId(offsetId);
  }, [
    activeOffsetLineId,
    dualPreview.activeSlot,
    dualPreview.lineA,
    dualPreview.lineB,
    layoutMode,
    resolveProjectLineId,
    singlePreviewLine,
  ]);

  /** 双行时当前屏上轨/下轨对应的工程行（与预览 A/B 同步） */
  const dualCharEditTracks = useMemo(() => {
    if (layoutMode !== 'dualAlternate') {
      return { lineA: null as KaraokeLine | null, lineB: null as KaraokeLine | null };
    }
    const idA = resolveProjectLineId(dualPreview.lineA?.id || null);
    const idB = resolveProjectLineId(dualPreview.lineB?.id || null);
    return {
      lineA: idA ? editableSingableLines.find((l) => l.id === idA) || null : null,
      lineB: idB ? editableSingableLines.find((l) => l.id === idB) || null : null,
    };
  }, [
    dualPreview.lineA,
    dualPreview.lineB,
    editableSingableLines,
    layoutMode,
    resolveProjectLineId,
  ]);

  /** 钉住字条行（仅暂停时保留；播放中仍跟正在唱/待唱句） */
  const pinCharEditLine = useCallback((lineId: string) => {
    if (busyRef.current !== 'idle') return;
    cancelCharInsertEdit();
    lineTextEditRef.current = null;
    setLineTextEdit(null);
    setCharBarCtxMenu(null);
    charEditPinnedRef.current = true;
    setCharEditLineId(lineId);
    setCharEditIndex(null);
    previewFocusSyncRef.current = lineId;
  }, [cancelCharInsertEdit]);

  /** 在指定行、按存盘时间附近开始插入（填缝用落点时间；回写第1步走现有输入流程） */
  const beginInsertOnLineAtTime = useCallback(
    (lineId: string, timeSec: number) => {
      if (busyRef.current !== 'idle') return;
      const line = (projectRef.current.lines || []).find((l) => l.id === lineId);
      if (!line || line.instrumental) return;
      pinCharEditLine(lineId);
      const atIndex = karaokeInsertIndexAtStoredTime(line.chars, timeSec);
      beginCharInsertEdit(lineId, atIndex, timeSec);
    },
    [beginCharInsertEdit, pinCharEditLine],
  );

  /**
   * 双行右键挪字：菜单可点性只看「该轨是否还有可唱行」，
   * 不再要求此刻 dualPreview / dualCharEditTracks 已挂句（间奏、空白间隙时常为空）。
   */
  const dualTrackInsertAvailable = useMemo(
    () => ({
      A: karaokeDualSlotHasLine(editableSingableLines, 'A'),
      B: karaokeDualSlotHasLine(editableSingableLines, 'B'),
    }),
    [editableSingableLines],
  );

  /**
   * 「添加歌词」目标句：优先落点所在轨最近可唱行；没有则新建。
   */
  const resolveAddCharTargetLine = useCallback(
    (timeSec: number, lane: CharBarLane = 'all'): KaraokeLine | null => {
      const singable = singableLines(projectRef.current.lines || []);
      if (lane === 'A' || lane === 'B') {
        return karaokeNearestDualSlotLine(singable, lane, timeSec);
      }
      return karaokeNearestSingableLine(singable, timeSec);
    },
    [],
  );

  /** 空白右键「添加歌词」：写入该轨当前句（或新建） */
  const beginAddCharAtTime = useCallback(
    (timeSec: number, lane: CharBarLane = 'all') => {
      const cur = projectRef.current;
      const ensured = ensureAddLyricTarget(cur.lines || [], lane, timeSec);
      if (ensured.lines !== cur.lines) {
        persist({
          ...cur,
          lines: ensured.lines,
          lyrics: lyricsTextFromKaraokeLines(ensured.lines),
          weakLineAlignment: recomputeKaraokeWeakLineAlignment(ensured.lines),
          updatedAt: Date.now(),
        });
      }
      beginInsertOnLineAtTime(ensured.line.id, timeSec);
    },
    [beginInsertOnLineAtTime, persist],
  );

  /**
   * 空白右键「添加句子」：在时间序中插入一整句空可唱行，后续句奇偶翻轨。
   * 不走 beginInsertOnLineAtTime：pin 会 cancel 插入，可能把刚插入的空行删掉。
   */
  const beginAddSentenceAtTime = useCallback(
    (timeSec: number) => {
      if (busyRef.current !== 'idle') return;
      cancelCharInsertEdit();
      const cur = projectRef.current;
      const inserted = insertSingableLineAtTime(cur.lines || [], timeSec);
      persist({
        ...cur,
        lines: inserted.lines,
        lyrics: lyricsTextFromKaraokeLines(inserted.lines),
        weakLineAlignment: recomputeKaraokeWeakLineAlignment(inserted.lines),
        updatedAt: Date.now(),
      });
      if (busyRef.current !== 'idle') return;
      lineTextEditRef.current = null;
      setLineTextEdit(null);
      setCharBarCtxMenu(null);
      charEditPinnedRef.current = true;
      setCharEditLineId(inserted.line.id);
      setCharEditIndex(null);
      previewFocusSyncRef.current = inserted.line.id;
      beginCharInsertEdit(inserted.line.id, 0, timeSec, true);
    },
    [beginCharInsertEdit, cancelCharInsertEdit, persist],
  );

  /**
   * 双行挪字：按字时间解析目标轨应写入的句。
   * 必须用完整可唱列表算奇偶；若先剔除源句，后续行下标整体翻转，会写到错误轨/错误句。
   */
  const resolveDualMoveTargetLine = useCallback(
    (slot: 'A' | 'B', timeSec: number, excludeLineId: string): KaraokeLine | null => {
      const singable = editableSingableLines;
      if (!singable.length) return null;
      const wantEven = slot === 'A';

      const asProjectLine = (line: KaraokeLine | null | undefined): KaraokeLine | null => {
        if (!line) return null;
        const id = resolveProjectLineId(line.id);
        if (!id || id === excludeLineId) return null;
        const hit = singable.find((l) => l.id === id) || null;
        if (!hit || hit.instrumental || hit.id === excludeLineId) return null;
        return hit;
      };

      // 0) 同轨且时间窗覆盖该字的句（最贴「只挪一字到对轨正在唱/重叠的那句」）
      {
        const t = Number.isFinite(timeSec) ? timeSec : 0;
        for (let i = 0; i < singable.length; i++) {
          if ((i % 2 === 0) !== wantEven) continue;
          const line = singable[i];
          if (line.id === excludeLineId) continue;
          const singStart = karaokeLineSingStartSec(line);
          const singEnd = karaokeLineSingEndSec(line);
          if (
            Number.isFinite(singStart) &&
            Number.isFinite(singEnd) &&
            t >= singStart - 1e-6 &&
            t < singEnd + 1e-6
          ) {
            return line;
          }
          const lo = Number.isFinite(singStart) ? singStart : Number(line.startSec) || 0;
          const hi = Number.isFinite(singEnd)
            ? singEnd
            : Math.max(lo, Number(line.endSec) || 0);
          if (t >= lo - 1e-6 && t <= hi + 1e-6) return line;
        }
      }

      // 1) 按字时间（+全局偏移）解析该轨当前应显示的句（完整列表，奇偶不变）
      const offsetSingable = singableLines(offsetLines);
      if (offsetSingable.length) {
        const firstAppear =
          openingTimeline.countdownDur > 0.05
            ? openingTimeline.lyricAppearSec
            : undefined;
        const playT =
          (Number.isFinite(timeSec) ? timeSec : 0) +
          (Number(projectRef.current.globalOffsetSec) || 0);
        const slotRes = resolveDualSlotAtTime(
          offsetSingable,
          playT,
          slot === 'A',
          {
            firstLyricAppearSec: firstAppear,
            fadeOutSec: lineFadeOutSec,
            gapThresholdSec: interludeClearGapSec,
            countdownGapThresholdSec: countdownReentryGapSec,
            leadInMaxSec: countdownLeadInMaxSec,
          },
        );
        const hit = asProjectLine(slotRes.line);
        if (hit) return hit;
      }

      // 2) 预览当前屏该轨挂着的句
      const fromPreview =
        slot === 'B' ? dualCharEditTracks.lineB : dualCharEditTracks.lineA;
      {
        const hit = asProjectLine(fromPreview);
        if (hit) return hit;
      }

      // 3) 该轨时间最近的一句（跳过源句）
      return karaokeNearestDualSlotLine(singable, slot, timeSec, excludeLineId);
    },
    [
      countdownLeadInMaxSec,
      countdownReentryGapSec,
      dualCharEditTracks.lineA,
      dualCharEditTracks.lineB,
      editableSingableLines,
      interludeClearGapSec,
      lineFadeOutSec,
      offsetLines,
      openingTimeline.countdownDur,
      openingTimeline.lyricAppearSec,
      resolveProjectLineId,
    ],
  );

  /**
   * 双行：把一字或多字挪到上轨(A)/下轨(B)，尽量保留时间。
   */
  const moveCharsToDualTrack = useCallback(
    (rawItems: CharBarSel[], slot: 'A' | 'B') => {
      if (busyRef.current !== 'idle') return;
      if (layoutMode !== 'dualAlternate') return;
      cancelCharInsertEdit();
      const cur = projectRef.current;
      let lines: KaraokeLine[] = (cur.lines || []).map((l) => ({
        ...l,
        chars: (l.chars || []).map((c) => ({ ...c })),
      }));
      const unique = new Map<string, CharBarSel>();
      for (const it of rawItems) {
        unique.set(charBarSelKey(it), it);
      }
      const items = [...unique.values()];
      if (!items.length) return;

      const payloads: Array<{ char: KaraokeCharTiming; fromLineId: string }> = [];
      const delByLine = new Map<string, number[]>();
      {
        const singable = singableLines(lines);
        for (const it of items) {
          if (karaokeDualSlotOfLine(singable, it.lineId) === slot) continue;
          const src = lines.find((l) => l.id === it.lineId);
          const ch = src?.chars?.[it.charIndex];
          if (!ch) continue;
          payloads.push({ char: { ...ch }, fromLineId: it.lineId });
          const arr = delByLine.get(it.lineId) || [];
          arr.push(it.charIndex);
          delByLine.set(it.lineId, arr);
        }
      }
      if (!payloads.length) return;

      const changedIds = new Set<string>();
      for (const [lineId, idxs] of delByLine) {
        changedIds.add(lineId);
        idxs.sort((a, b) => b - a);
        lines = lines.map((l) => {
          if (l.id !== lineId) return l;
          let next = l;
          for (const i of idxs) next = deleteKaraokeLineChar(next, i);
          return next;
        });
      }

      payloads.sort(
        (a, b) => (Number(a.char.startSec) || 0) - (Number(b.char.startSec) || 0),
      );
      const newSel: CharBarSel[] = [];
      for (const p of payloads) {
        const t = Number(p.char.startSec) || 0;
        const singableNow = singableLines(lines);
        let target =
          karaokeNearestDualSlotLine(singableNow, slot, t, p.fromLineId) ||
          karaokeNearestDualSlotLine(singableNow, slot, t);
        if (!target) {
          const ensured = ensureAddLyricTarget(lines, slot, t);
          lines = ensured.lines;
          target = ensured.line;
        }
        const srcLine = lines.find((l) => l.id === target.id);
        if (!srcLine || srcLine.instrumental) continue;
        const { line: after, index } = insertKaraokeCharPreservingTiming(srcLine, p.char);
        if (index < 0) continue;
        lines = lines.map((l) => (l.id === after.id ? after : l));
        changedIds.add(after.id);
        newSel.push({ lineId: after.id, charIndex: index });
      }

      const lyrics = patchKaraokeLyricsForChangedLines(String(cur.lyrics || ''), lines, [
        ...changedIds,
      ]);
      persist({
        ...cur,
        lines,
        lyrics,
        weakLineAlignment: recomputeKaraokeWeakLineAlignment(lines),
        updatedAt: Date.now(),
      });
      syncCharBarSelection(newSel);
      if (newSel[0]) {
        setCharEditLineId(newSel[0].lineId);
        charEditPinnedRef.current = true;
        previewFocusSyncRef.current = newSel[0].lineId;
        setCharEditIndex(newSel[0].charIndex);
      }
    },
    [cancelCharInsertEdit, layoutMode, persist, syncCharBarSelection],
  );

  const moveCharToDualTrack = useCallback(
    (lineId: string, charIndex: number, slot: 'A' | 'B') => {
      moveCharsToDualTrack([{ lineId, charIndex }], slot);
    },
    [moveCharsToDualTrack],
  );

  useEffect(() => {
    if (!open) return;
    if (lineTextEditRef.current) return;
    if (charInsertEditRef.current) return;
    if (charTimingDragRef.current) return;
    if (!previewFocusProjectLineId) return;
    if (!editableSingableLines.some((l) => l.id === previewFocusProjectLineId)) return;

    // 双行：仅「暂停 + 用户显式钉住当前屏另一轨」时不抢回。
    // 旧逻辑把「字轨碰巧停在仍 hold 的 A」也当成钉住 → 播放切到 B 后字轨不跟，预览/调节字不一致。
    if (layoutMode === 'dualAlternate' && charEditPinnedRef.current && !isPlaying) {
      const idA = dualCharEditTracks.lineA?.id || null;
      const idB = dualCharEditTracks.lineB?.id || null;
      if (
        charEditLineId &&
        (charEditLineId === idA || charEditLineId === idB) &&
        charEditLineId !== previewFocusProjectLineId
      ) {
        return;
      }
    }

    const focusChanged = previewFocusSyncRef.current !== previewFocusProjectLineId;
    charEditPinnedRef.current = false;
    previewFocusSyncRef.current = previewFocusProjectLineId;
    setCharEditLineId(previewFocusProjectLineId);

    // 换句或播放中：字级选中跟当前 wipe 字，与预览扫字对齐
    const focusLine = editableSingableLines.find((l) => l.id === previewFocusProjectLineId);
    const chars = focusLine?.chars;
    if (chars?.length && (focusChanged || isPlaying)) {
      const off = Number(projectRef.current.globalOffsetSec) || 0;
      const t = playTime;
      let wipeIdx: number | null = null;
      for (let i = 0; i < chars.length; i++) {
        if (chars[i].roleTag) continue;
        const s = (Number(chars[i].startSec) || 0) + off;
        const e = Math.max(s + 0.03, (Number(chars[i].endSec) || 0) + off);
        if (t >= s - 1e-3 && t < e + 1e-3) {
          wipeIdx = i;
          break;
        }
      }
      if (wipeIdx == null && focusChanged) {
        // 句间空隙：落到最近即将唱/刚唱完的唱词字
        let best = -1;
        let bestDist = Infinity;
        for (let i = 0; i < chars.length; i++) {
          if (chars[i].roleTag) continue;
          const s = (Number(chars[i].startSec) || 0) + off;
          const e = Math.max(s + 0.03, (Number(chars[i].endSec) || 0) + off);
          const dist = t < s ? s - t : t > e ? t - e : 0;
          if (dist < bestDist) {
            bestDist = dist;
            best = i;
          }
        }
        wipeIdx = best >= 0 ? best : null;
      }
      if (wipeIdx != null) setCharEditIndex(wipeIdx);
      else if (focusChanged) setCharEditIndex(null);
    } else if (focusChanged) {
      setCharEditIndex(null);
    }
  }, [
    open,
    playTime,
    isPlaying,
    previewFocusProjectLineId,
    editableSingableLines,
    layoutMode,
    dualCharEditTracks.lineA?.id,
    dualCharEditTracks.lineB?.id,
    charEditLineId,
  ]);

  /** 字轨右键菜单：点空白 / Esc / 滚动关闭 */
  useEffect(() => {
    if (!charBarCtxMenu) return;
    const close = (e?: Event) => {
      if (
        e?.target instanceof Element &&
        e.target.closest('[data-karaoke-char-ctx="1"]')
      ) {
        return;
      }
      setCharBarCtxMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCharBarCtxMenu(null);
    };
    window.addEventListener('mousedown', close, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', close, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [charBarCtxMenu]);

  const openCharBarEmptyCtxMenu = useCallback(
    (e: React.MouseEvent, clickTimeSec?: number, lane: CharBarLane = 'all') => {
      e.preventDefault();
      e.stopPropagation();
      if (busyRef.current !== 'idle') return;
      const playStored =
        playTimeRef.current - (Number(projectRef.current.globalOffsetSec) || 0);
      setCharBarCtxMenu({
        kind: 'empty',
        x: e.clientX,
        y: e.clientY,
        clickTimeSec: Number.isFinite(clickTimeSec) ? Number(clickTimeSec) : playStored,
        lane,
      });
    },
    [],
  );

  const openCharBarCharCtxMenu = useCallback(
    (e: React.MouseEvent, lineId: string, charIndex: number, lane: CharBarLane = 'all') => {
      e.preventDefault();
      e.stopPropagation();
      if (busyRef.current !== 'idle') return;
      charEditPinnedRef.current = true;
      setCharEditLineId(lineId);
      setCharEditIndex(charIndex);
      previewFocusSyncRef.current = lineId;
      const curSel = charBarSelectionRef.current;
      const inSel = curSel.some((s) => s.lineId === lineId && s.charIndex === charIndex);
      if (!inSel) {
        const next = [{ lineId, charIndex }];
        charBarSelectionRef.current = next;
        setCharBarSelection(next);
      }
      setCharBarCtxMenu({
        kind: 'char',
        x: e.clientX,
        y: e.clientY,
        lineId,
        charIndex,
        lane,
      });
    },
    [],
  );

  /** 即将开唱的那一行倒计时（与方案 A resolveCountdownSlotAtTime 同源） */
  const countdownPreview = useMemo(() => {
    const empty = {
      slot: null as DragSlot | null,
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

  const mapAsrResponseToSegs = useCallback((res: {
    segments?: Array<{
      text?: string;
      startSec?: number;
      endSec?: number;
      words?: Array<{ text?: string; startSec?: number; endSec?: number }>;
    }>;
  }) => {
    return (res?.segments || []).map((s, i) => ({
      id: `asr-${i}`,
      text: String(s.text || '').trim(),
      startSec: Number(s.startSec) || 0,
      endSec: Number(s.endSec) || 0,
      ...(Array.isArray(s.words) && s.words.length > 0
        ? {
            words: s.words
              .map((w) => {
                const text = String(w?.text || '').trim();
                if (!text) return null;
                const startSec = Number(w?.startSec) || 0;
                const endSec = Number(w?.endSec) || startSec;
                return {
                  text,
                  startSec,
                  endSec: endSec >= startSec ? endSec : startSec,
                };
              })
              .filter((w): w is { text: string; startSec: number; endSec: number } => !!w),
          }
        : {}),
    }));
  }, []);

  /** 强制云端 fun-asr 字级（enable_words）；成功才标 asrWords */
  const runCloudAsrAlign = useCallback(
    async (base: KaraokeProject): Promise<KaraokeProject | null> => {
      const audio =
        String(base.audioUrl || '').trim() || String(base.videoUrl || '').trim();
      if (!audio) {
        setError(tt.needAudioForAsr);
        return null;
      }
      if (!window.electronAPI?.transcribeSpeechSegmentsFromAudioUrl) {
        setError(tt.noApi);
        return null;
      }
      setBusy('asr');
      setStatus(tt.asrRunning);
      const asrStartedAt = Date.now();
      const asrTick = window.setInterval(() => {
        const sec = Math.floor((Date.now() - asrStartedAt) / 1000);
        if (sec >= 90) {
          setStatus(`${tt.asrRunningElapsed(sec)}\n${tt.asrRunningLongHint}`);
        } else if (sec >= 1) {
          setStatus(tt.asrRunningElapsed(sec));
        }
      }, 1000);
      try {
        const res = await window.electronAPI.transcribeSpeechSegmentsFromAudioUrl(
          projectId || undefined,
          audio,
          karaokeAsrLanguageToApiParam(base.asrLanguage),
        );
        const costN = Math.round(Number(res?.cost));
        const chargedOk =
          res?.charged !== false && Number.isFinite(costN) && costN >= 1;
        if (!chargedOk) {
          setError(tt.asrBillingMissing);
          return null;
        }
        const segs = mapAsrResponseToSegs(res);
        const wordCount = segs.reduce((n, s) => n + (s.words?.length || 0), 0);
        const hasWords =
          res?.hasWordTimestamps === true || wordCount > 0;
        if (!hasWords) {
          setError(tt.asrWordLevelFailed);
          return null;
        }
        const next = applyAsrSegmentsToKaraokeProject(base, segs);
        if (
          next.timingSource !== 'asrWords' ||
          !next.asrWords?.length ||
          countSingableChars(next) <= 0
        ) {
          setError(tt.asrWordLevelFailed);
          return null;
        }
        persist(next);
        setStatus(
          `${tt.timingRegenerated(countSingableChars(next))} · ${tt.asrChargedHint(costN)}`,
        );
        setError('');
        return next;
      } catch (e: any) {
        const raw = String(e?.message || e || '').trim() || tt.failed;
        setError(`${tt.asrWordLevelFailed}\n${raw}`);
        try {
          const gate = await resolveCloudAuthErrorWithBalance(e, {
            requiredYuanbao: fileTranscribeYuanbao,
          });
          if (gate.action === 'need-login') {
            setPreviewFullscreen(false);
            const msg = gate.balanceEnough ? tt.asrNeedLoginBalanceOk : tt.asrNeedLogin;
            const ok = await showConfirm(msg, {
              okLabel: tt.goLogin,
              stackZClass: 'z-[100060]',
            });
            if (ok) {
              void window.electronAPI?.setFullscreen?.(false);
              navigate('/settings', { replace: true });
            }
          } else if (gate.action === 'insufficient') {
            showAlert(tt.asrBalanceInsufficient || CLOUD_BALANCE_INSUFFICIENT_ALERT, {
              stackZClass: 'z-[100060]',
            });
          }
        } catch {
          /* 弹窗失败不影响红条错误 */
        }
        return null;
      } finally {
        window.clearInterval(asrTick);
        setBusy('idle');
      }
    },
    [fileTranscribeYuanbao, mapAsrResponseToSegs, navigate, persist, projectId, showAlert, showConfirm, tt],
  );

  /** 生成成功后从开场倒计时起点试播（首句开唱前 7s / 压缩窗） */
  const kickPreviewDemo = useCallback(() => {
    if (!canPlayPreview) return;
    const tl = karaokeOpeningTimelineForProject(projectRef.current);
    const t0 =
      tl.countdownDur > 0.05
        ? Math.max(0, tl.countdownStart - 0.05)
        : (() => {
            const lines = projectRef.current.lines || [];
            const firstVocal = lines.find((l) => !l.instrumental && l.chars.length > 0);
            const singStart = firstVocal ? karaokeLineSingStartSec(firstVocal) : 0;
            return Math.max(0, singStart - 0.35);
          })();
    seekPreviewTo(t0);
    window.setTimeout(() => {
      if (closedRef.current) return;
      if (muteVideoForSong) {
        const v = videoRef.current;
        const a = audioRef.current;
        if (!v || !a) return;
        try {
          a.currentTime = v.currentTime || t0;
        } catch {
          /* ignore */
        }
        if (!v.paused) return;
        void Promise.all([v.play(), a.play()]).catch(() => setIsPlaying(false));
        return;
      }
      if (useSongAudio && !hasVideoPreview) {
        const a = audioRef.current;
        if (!a || !a.paused) return;
        void a.play().catch(() => setIsPlaying(false));
        return;
      }
      const el = getMediaEl();
      if (!el || !el.paused) return;
      if (audioRef.current && !audioRef.current.paused) audioRef.current.pause();
      try {
        if (videoRef.current) videoRef.current.muted = false;
      } catch {
        /* ignore */
      }
      void el.play().catch(() => setIsPlaying(false));
    }, 40);
  }, [
    canPlayPreview,
    getMediaEl,
    hasVideoPreview,
    muteVideoForSong,
    seekPreviewTo,
    useSongAudio,
  ]);

  const ensureTiming = useCallback(async (): Promise<KaraokeProject | null> => {
    setError('');
    const cur = projectRef.current;
    const durationSec = Math.max(
      Number(cur.songDurationSec) || 0,
      mediaDuration || 0,
      1,
    );
    let next: KaraokeProject = {
      ...cur,
      songDurationSec: Math.max(
        Number(cur.songDurationSec) || 0,
        durationSec > 1 ? durationSec : Number(cur.songDurationSec) || 0,
      ),
    };

    const plan = planKaraokeTiming(next);
    if (plan.action === 'blocked') {
      setError(tt.needLyrics);
      return null;
    }
    if (plan.action === 'use-existing' && countSingableChars(next) > 0) {
      // 有音频时 plan 仅在 asrWords 时 use-existing
      persist(next);
      return next;
    }

    if (plan.action === 'need-asr') {
      return runCloudAsrAlign(next);
    }

    // 无音频本地兜底：LRC / 均分
    if (!countSingableChars(next)) {
      const built = buildKaraokeLinesFromAvailable({
        lyrics: next.lyrics,
        lyricSegments: next.lines.map((l) => ({
          id: l.id,
          text: l.text,
          startSec: l.startSec,
          endSec: l.endSec,
          instrumental: l.instrumental,
        })),
        songDurationSec: Math.max(Number(next.songDurationSec) || 0, durationSec),
        asrWords: next.asrWords,
      });
      if (built.lines.length) {
        next = {
          ...next,
          songDurationSec: Math.max(Number(next.songDurationSec) || 0, durationSec),
          lines: built.lines,
          timingSource: built.timingSource,
          updatedAt: Date.now(),
        };
        persist(next);
        return next;
      }
    }
    setError(tt.needAudioForAsr);
    return null;
  }, [mediaDuration, persist, runCloudAsrAlign, tt]);

  const handleGenerateTiming = useCallback(async () => {
    setBusy('timing');
    setStatus(tt.generating);
    setError('');
    try {
      const cur = projectRef.current;
      const durationSec = Math.max(
        Number(cur.songDurationSec) || 0,
        mediaDuration || 0,
        1,
      );
      const asrMediaUrl =
        String(cur.audioUrl || '').trim() || String(cur.videoUrl || '').trim();
      const hasLyrics = !!String(cur.lyrics || '').trim();

      if (!hasLyrics) {
        setError(tt.needLyrics);
        return;
      }

      // 有音频：每次点击强制完整重跑——清空旧 lines / timingSource / asrWords，再请求 fun-asr
      if (asrMediaUrl) {
        const cleared: KaraokeProject = {
          ...cur,
          songDurationSec: Math.max(Number(cur.songDurationSec) || 0, durationSec),
          lines: [],
          timingSource: 'manual',
          asrWords: undefined,
          weakLineAlignment: undefined,
          updatedAt: Date.now(),
        };
        // 先写入清空态，避免 UI/父节点仍显示「已有时间轴」并 early-return
        persist(cleared);
        setStatus(tt.asrRunning);
        const aligned = await runCloudAsrAlign(cleared);
        if (aligned && aligned.timingSource === 'asrWords' && countSingableChars(aligned) > 0) {
          kickPreviewDemo();
          return;
        }
        // 失败：保持清空/错误态；错误已由 runCloudAsrAlign 写入
        return;
      }

      // 无音频：仅本地 LRC / 均分（醒目警告，不当作字级完成）
      const built = buildKaraokeLinesFromAvailable({
        lyrics: cur.lyrics,
        songDurationSec: durationSec,
      });
      const localChars = built.lines.reduce(
        (n, l) => n + (l.instrumental ? 0 : l.chars.length),
        0,
      );
      if (localChars > 0) {
        const next: KaraokeProject = {
          ...cur,
          songDurationSec: Math.max(Number(cur.songDurationSec) || 0, durationSec),
          lines: built.lines,
          timingSource: built.timingSource,
          asrWords: undefined,
          updatedAt: Date.now(),
        };
        persist(next);
        setStatus(tt.timingRegenerated(localChars));
        if (isInterpolatedKaraokeTiming(next.timingSource) || next.timingSource === 'manual') {
          setError(tt.timingProvisionalWarning);
        }
        kickPreviewDemo();
        return;
      }
      setError(tt.needAudioForAsr);
    } catch (e: any) {
      setError(String(e?.message || e || '').trim() || tt.failed);
    } finally {
      setBusy('idle');
    }
  }, [kickPreviewDemo, mediaDuration, persist, runCloudAsrAlign, tt]);

  const handleBurn = useCallback(async () => {
    const session = sessionRef.current;
    const stillOpen = () => !closedRef.current && sessionRef.current === session;
    setError('');
    let ready = project;
    if (!countSingableChars(ready)) {
      const t = await ensureTiming();
      if (!stillOpen()) return;
      if (!t) return;
      ready = t;
    }
    let videoUrl = String(ready.videoUrl || '').trim();
    if (!videoUrl && resolveVideoUrl) {
      setBusy('burn');
      setStatus(tt.burning);
      try {
        videoUrl = String((await resolveVideoUrl()) || '').trim();
        if (!stillOpen()) return;
        ready = { ...ready, videoUrl };
        persist(ready);
      } catch (e: any) {
        if (!stillOpen()) return;
        setBusy('idle');
        setError(e?.message || tt.needVideo);
        return;
      }
    }
    if (!stillOpen()) return;
    if (!videoUrl) {
      setError(tt.needVideo);
      return;
    }
    const burnAudioSource = resolveKaraokeAudioSource({ ...ready, videoUrl });
    if (burnAudioSource === 'song' && !String(ready.audioUrl || '').trim()) {
      setError(tt.needSongAudio);
      return;
    }
    ready = {
      ...ready,
      videoUrl,
      audioSource: burnAudioSource,
      // 与预览同一套 mergeStyle，避免缺字段时烧录走另一套默认
      style: mergeStyle(ready.style, {}),
    };

    if (
      typeof window.electronAPI?.karaokeCssBurn !== 'function' &&
      typeof window.electronAPI?.karaokeBurnSubtitles !== 'function'
    ) {
      setError(tt.burnEngineApiMissing);
      return;
    }

    const durationSec = Math.max(
      0.2,
      mediaDuration || Number(ready.songDurationSec) || 0.2,
    );
    composeReadyRef.current = { project: ready, videoUrl, durationSec };
    setComposeQualityPreset(loadKaraokeComposeQualityPreset());
    setComposeModalPhase('pick');
    setComposeProgressTitle(tt.burnToNode);
    setComposeProgressUi(tt.burnQualityHint);
    setComposeProgressPercent(0);
    setStatus(tt.burnQualityHint);
    setBusy('burn');
    composeCancelRef.current = false;
    pausePreviewPlayback();
  }, [
    ensureTiming,
    mediaDuration,
    pausePreviewPlayback,
    persist,
    project,
    resolveVideoUrl,
    tt,
  ]);

  /** 确认帧率挡位后开始方案 A 烧录 */
  const handleConfirmComposeQuality = useCallback(async () => {
    const session = sessionRef.current;
    const stillOpen = () => !closedRef.current && sessionRef.current === session;
    const pending = composeReadyRef.current;
    if (!pending) {
      setComposeModalPhase('idle');
      setComposeProgressUi(null);
      setComposeProgressTitle(null);
      setBusy('idle');
      return;
    }
    const qualityPreset = composeQualityPreset;
    saveKaraokeComposeQualityPreset(qualityPreset);
    const ready = pending.project;
    const videoUrl = pending.videoUrl;
    const durationSec = pending.durationSec;
    const officeLowSpecHint = detectKaraokeLowSpecMachine();

    setComposeModalPhase('running');
    setStatus(tt.previewComposeRunning);
    setComposeProgressUi(tt.previewComposeRunning);
    setComposeProgressPercent(0);
    composeCancelRef.current = false;
    enteredFullscreenForComposeRef.current = false;

    try {
      let res: {
        success: boolean;
        canceled?: boolean;
        timedOut?: boolean;
        originalUrl?: string;
        originalPath?: string;
        posterUrl?: string;
        width?: number;
        height?: number;
        error?: string;
        engine?: 'css' | 'ass';
      };

      // 方案 A 在独立隐藏窗渲染，无需抓本编辑器 DOM / 全屏
      if (previewFullscreen) {
        enteredFullscreenForComposeRef.current = true;
        flushSync(() => setPreviewFullscreen(false));
      }
      setComposeCapturing(false);
      try {
        res = await runKaraokePreviewCompose({
          projectId: projectId || undefined,
          videoUrl,
          project: ready,
          durationSec,
          qualityPreset,
          isCancelled: () => composeCancelRef.current || !stillOpen(),
          onProgress: (p) => {
            if (!stillOpen()) return;
            const lowSpecUi = p.lowSpec ?? officeLowSpecHint;
            let line: string;
            if (p.phase === 'finalize') {
              line =
                p.message === 'fallback ass'
                  ? tt.previewComposeFallbackAss('')
                  : p.message === 'ass stable'
                    ? tt.burnQualityStableRunning
                    : tt.previewComposeFinalizing(p.percent);
            } else if (p.phase === 'begin') {
              line = lowSpecUi
                ? `${tt.previewComposeRunning} · ${tt.burnEngineLowSpecHint}`
                : tt.previewComposeRunning;
            } else {
              line = tt.previewComposeProgressDetail({
                frame: p.frame,
                total: p.total,
                percent: p.percent,
                fps: p.fps,
                etaSeconds: p.etaSeconds,
                lowSpec: lowSpecUi,
              });
            }
            setStatus(line);
            setComposeProgressUi(line);
            setComposeProgressPercent(
              Math.max(0, Math.min(100, Math.round(Number(p.percent) || 0))),
            );
          },
        });
      } catch (previewThrow: any) {
        res = {
          success: false,
          error: String(previewThrow?.message || previewThrow || tt.failed),
        };
      }

      if (stillOpen() && !res?.canceled && !res?.success) {
        const previewErr = String(res?.error || tt.failed);
        console.error('[karaoke] burn failed:', previewErr);
        throw new Error(previewErr);
      }
      if (stillOpen() && res?.success) {
        console.info(
          '[karaoke] burn engine=',
          res.engine || (qualityPreset === 'stable' ? 'ass' : 'css'),
          `quality=${qualityPreset}`,
        );
      }

      if (!stillOpen()) return;
      if (res?.canceled) {
        setStatus(tt.cancelled);
        setComposeProgressUi(null);
        return;
      }
      if (res?.timedOut) {
        setError(tt.burnTimeout);
        setComposeProgressUi(null);
        return;
      }
      if (!res?.success || !res.originalUrl) {
        throw new Error(res?.error || tt.failed);
      }
      setStatus(
        res.engine === 'ass'
          ? qualityPreset === 'stable'
            ? tt.successBurnStable
            : tt.successBurnViaAssFallback('')
          : tt.successPreviewCompose,
      );
      setError('');
      setComposeProgressUi(null);
      onBurned?.({
        originalUrl: res.originalUrl,
        originalPath: res.originalPath,
        posterUrl: res.posterUrl,
        width: res.width,
        height: res.height,
        karaokeProject: ready,
      });
      onClose();
    } catch (e: any) {
      if (!stillOpen()) return;
      const msg = String(e?.message || '');
      if (/cancel|abort/i.test(msg)) {
        setStatus(tt.cancelled);
        setComposeProgressUi(null);
        return;
      }
      if (/timeout/i.test(msg)) {
        setError(tt.burnTimeout);
        setComposeProgressUi(null);
        return;
      }
      const failMsg = String(e?.message || tt.failed);
      if (/memory|oom|134|crashed|allocation/i.test(failMsg)) {
        setError(tt.previewComposeOomHint);
      } else {
        setError(failMsg);
      }
      setComposeProgressUi(null);
    } finally {
      composeCancelRef.current = false;
      composeReadyRef.current = null;
      setComposeCapturing(false);
      setComposeModalPhase('idle');
      setComposeProgressUi(null);
      setComposeProgressTitle(null);
      setComposeProgressPercent(0);
      // 合成结束后务必退出全屏，避免卡在黑屏无结果
      setPreviewFullscreen(false);
      enteredFullscreenForComposeRef.current = false;
      if (stillOpen()) setBusy('idle');
    }
  }, [
    composeQualityPreset,
    onBurned,
    onClose,
    previewFullscreen,
    projectId,
    tt,
  ]);

  const handleCancelComposePick = useCallback(() => {
    if (composeModalPhase !== 'pick') return;
    composeReadyRef.current = null;
    setComposeModalPhase('idle');
    setComposeProgressUi(null);
    setComposeProgressTitle(null);
    setComposeProgressPercent(0);
    setBusy('idle');
    setStatus('');
  }, [composeModalPhase]);

  const handleRecordPreview = useCallback(async () => {
    const session = sessionRef.current;
    const stillOpen = () => !closedRef.current && sessionRef.current === session;
    setError('');
    let ready = project;
    if (!countSingableChars(ready)) {
      const t = await ensureTiming();
      if (!stillOpen()) return;
      if (!t) return;
      ready = t;
    }
    let videoUrl = String(ready.videoUrl || '').trim();
    if (!videoUrl && resolveVideoUrl) {
      setBusy('burn');
      setStatus(tt.recordPreviewRunning);
      try {
        videoUrl = String((await resolveVideoUrl()) || '').trim();
        if (!stillOpen()) return;
        ready = { ...ready, videoUrl };
        persist(ready);
      } catch (e: any) {
        if (!stillOpen()) return;
        setBusy('idle');
        setError(e?.message || tt.needVideo);
        return;
      }
    }
    if (!stillOpen()) return;
    if (!videoUrl) {
      setError(tt.needVideo);
      return;
    }
    const burnAudioSource = resolveKaraokeAudioSource({ ...ready, videoUrl });
    if (burnAudioSource === 'song' && !String(ready.audioUrl || '').trim()) {
      setError(tt.needSongAudio);
      return;
    }
    ready = {
      ...ready,
      videoUrl,
      audioSource: burnAudioSource,
      style: mergeStyle(ready.style, {}),
    };

    const recordApiReady =
      typeof window.electronAPI?.karaokePreviewRecordBegin === 'function';
    if (!recordApiReady) {
      setError(tt.recordPreviewApiMissing);
      return;
    }

    const video = videoRef.current;
    if (!video || !(video.videoWidth > 0)) {
      setError(tt.needVideo);
      return;
    }

    setBusy('burn');
    setStatus(tt.recordPreviewRunning);
    setComposeProgressUi(tt.recordPreviewRunning);
    setComposeProgressTitle(tt.recordPreviewTitle);
    setComposeProgressPercent(0);
    composeCancelRef.current = false;
    pausePreviewPlayback();

    try {
      if (previewFullscreen) {
        flushSync(() => setPreviewFullscreen(false));
      }
      const durationSec = Math.max(
        0.2,
        mediaDuration || Number(ready.songDurationSec) || 0.2,
      );
      const res = await runKaraokePreviewRecord({
        projectId: projectId || undefined,
        videoUrl,
        project: ready,
        durationSec,
        fps: 24,
        videoEl: video,
        getStageEl: () => stageRef.current,
        getOverlayEl: () => captureOverlayRef.current,
        setCaptureClean: (clean) => {
          setComposeCapturing(clean);
        },
        setPlayTime: (t) => {
          setPlayTime(t);
        },
        setRecordStageSize: (size) => {
          setRecordStageSize(size);
        },
        isCancelled: () => composeCancelRef.current || !stillOpen(),
        onProgress: (p) => {
          if (!stillOpen()) return;
          let line: string;
          if (p.phase === 'encode' || p.phase === 'done') {
            line = tt.recordPreviewFinalizing(p.percent);
          } else if (p.phase === 'prepare') {
            line = p.message || tt.recordPreviewRunning;
          } else {
            line = p.message || tt.recordPreviewProgress(p.frame, p.total, p.percent);
          }
          setStatus(line);
          setComposeProgressUi(line);
          setComposeProgressTitle(tt.recordPreviewTitle);
          setComposeProgressPercent(
            Math.max(0, Math.min(100, Math.round(Number(p.percent) || 0))),
          );
        },
      });

      if (!stillOpen()) return;
      if (res?.canceled) {
        setStatus(tt.cancelled);
        setComposeProgressUi(null);
        return;
      }
      if (res?.timedOut) {
        setError(tt.burnTimeout);
        setComposeProgressUi(null);
        return;
      }
      if (!res?.success || !res.originalUrl) {
        throw new Error(res?.error || tt.failed);
      }
      setStatus(tt.successRecordPreview);
      setError('');
      setComposeProgressUi(null);
      onBurned?.({
        originalUrl: res.originalUrl,
        originalPath: res.originalPath,
        posterUrl: res.posterUrl,
        width: res.width,
        height: res.height,
        karaokeProject: ready,
      });
      onClose();
    } catch (e: any) {
      if (!stillOpen()) return;
      const msg = String(e?.message || '');
      if (/cancel|abort/i.test(msg)) {
        setStatus(tt.cancelled);
        setComposeProgressUi(null);
        return;
      }
      if (/timeout/i.test(msg)) {
        setError(tt.burnTimeout);
        setComposeProgressUi(null);
        return;
      }
      setError(String(e?.message || tt.failed));
      setComposeProgressUi(null);
    } finally {
      composeCancelRef.current = false;
      setComposeCapturing(false);
      setRecordStageSize(null);
      setComposeProgressUi(null);
      setComposeProgressTitle(null);
      setComposeProgressPercent(0);
      setPreviewFullscreen(false);
      if (stillOpen()) setBusy('idle');
    }
  }, [
    ensureTiming,
    mediaDuration,
    onBurned,
    onClose,
    pausePreviewPlayback,
    persist,
    previewFullscreen,
    project,
    projectId,
    resolveVideoUrl,
    tt,
  ]);

  /** 取消进行中的合成/录制，保留编辑器打开 */
  const handleCancelCompose = useCallback(() => {
    if (busyRef.current !== 'burn') return;
    if (composeModalPhase === 'pick') {
      handleCancelComposePick();
      return;
    }
    composeCancelRef.current = true;
    try {
      void window.electronAPI?.karaokeCancelBurn?.();
    } catch {
      /* ignore */
    }
  }, [composeModalPhase, handleCancelComposePick]);

  const handleClose = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    sessionRef.current += 1;
    const wasBurning = busyRef.current === 'burn';
    if (wasBurning) {
      composeCancelRef.current = true;
      try {
        void window.electronAPI?.karaokeCancelBurn?.();
      } catch {
        /* ignore */
      }
    }
    stopRaf();
    setIsPlaying(false);
    setBusy('idle');
    setStatus(wasBurning ? tt.cancelled : '');
    composeReadyRef.current = null;
    setComposeModalPhase('idle');
    setComposeProgressUi(null);
    setComposeProgressTitle(null);
    setComposeProgressPercent(0);
    try {
      videoRef.current?.pause();
      audioRef.current?.pause();
    } catch {
      /* ignore */
    }
    setPreviewFullscreen(false);
    onProjectChange?.(projectRef.current);
    onClose();
  }, [onClose, onProjectChange, stopRaf, tt]);

  useImperativeHandle(
    actionsRef,
    () => ({
      generateTiming: () => {
        void handleGenerateTiming();
      },
      burn: () => {
        void handleBurn();
      },
      recordPreview: () => {
        void handleRecordPreview();
      },
      cancel: () => {
        handleClose();
      },
    }),
    [handleBurn, handleClose, handleGenerateTiming, handleRecordPreview],
  );

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(() => {
    if (!open) setPreviewFullscreen(false);
  }, [open]);

  /** Esc：合成中先取消；再取消加字/改词 / 退出预览全屏；非嵌入模式再关闭编辑器 */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (busyRef.current === 'burn') {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
        return;
      }
      if (charInsertEditRef.current) {
        e.preventDefault();
        e.stopPropagation();
        cancelCharInsertEdit();
        return;
      }
      if (lineTextEditRef.current) {
        e.preventDefault();
        e.stopPropagation();
        lineTextEditRef.current = null;
        setLineTextEdit(null);
        return;
      }
      if (previewFullscreen) {
        e.preventDefault();
        e.stopPropagation();
        // 先于导演节点全屏 Esc（stopImmediatePropagation），只退预览全屏
        e.stopImmediatePropagation();
        setPreviewFullscreen(false);
        return;
      }
      // 嵌入第 8 步：不拦截 Esc，交给导演台步骤条 / 全屏退出
      if (hideClose) return;
      e.preventDefault();
      e.stopPropagation();
      handleClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [
    open,
    handleClose,
    previewFullscreen,
    lineTextEdit,
    charInsertEdit,
    hideClose,
    cancelCharInsertEdit,
  ]);

  /** Delete / Backspace：选中字时删字（输入框打字时不拦截） */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (isTypingTarget(e.target)) return;
      if (charInsertEditRef.current || lineTextEditRef.current) return;
      if (busyRef.current !== 'idle') return;
      const lineId = charEditLineId;
      const idx = charEditIndex;
      if (!lineId || idx == null || idx < 0) return;
      e.preventDefault();
      e.stopPropagation();
      const sel = charBarSelectionRef.current;
      if (sel.length > 1) {
        deleteSelectedChars(sel);
        return;
      }
      deleteSelectedChar(lineId, idx);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, charEditLineId, charEditIndex, deleteSelectedChar, deleteSelectedChars]);

  /** ←/→ 微调预览进度（输入框打字时不拦截；Shift 加大步进） */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (isTypingTarget(e.target)) return;
      if (!canPlayPreview || busyRef.current !== 'idle') return;
      e.preventDefault();
      e.stopPropagation();
      nudgePreviewBy(e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, canPlayPreview, nudgePreviewBy]);

  /** 空格：切换播放/暂停（输入框聚焦时不拦截） */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.code !== 'Space') return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (isTypingTarget(e.target)) return;
      if (!canPlayPreview || busyRef.current !== 'idle') return;
      e.preventDefault();
      e.stopPropagation();
      togglePreviewPlayback();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, canPlayPreview, togglePreviewPlayback]);

  const busyAny = busy !== 'idle';
  const seekBarPct =
    mediaDuration > 0
      ? Math.max(0, Math.min(100, (playTime / mediaDuration) * 100))
      : 0;

  const setLayoutMode = (mode: KaraokeLayoutMode) => {
    const patch: Partial<KaraokeStyleOptions> = { layoutMode: mode };
    if (mode === 'dualAlternate') {
      const cur = projectRef.current.style;
      if (!cur?.posB) patch.posB = { ...DEFAULT_KARAOKE_POS_B };
      const posA = cur?.posA;
      const posB = cur?.posB || DEFAULT_KARAOKE_POS_B;
      if (!posA) {
        patch.posA = { ...DEFAULT_KARAOKE_POS_A };
      } else if (shouldMigrateKaraokeDualPosToDefault(posA, posB)) {
        patch.posA = { ...DEFAULT_KARAOKE_POS_A };
        patch.posB = { ...DEFAULT_KARAOKE_POS_B };
      } else if (
        Number(posA.x) === DEFAULT_KARAOKE_POS_SINGLE.x &&
        Number(posA.y) === DEFAULT_KARAOKE_POS_SINGLE.y
      ) {
        // 从单行默认居中切回双行：恢复左锚，避免中区 `\an2` 挂在 A 槽
        patch.posA = { ...DEFAULT_KARAOKE_POS_A };
        if (!cur?.posB) patch.posB = { ...DEFAULT_KARAOKE_POS_B };
      }
    } else if (mode === 'single') {
      const cur = projectRef.current.style;
      // 仍为双行左对齐默认 / 无 pos → 落到单行下方居中
      if (shouldMigrateKaraokeSinglePosToDefault(cur?.posA)) {
        const nextPos = { ...DEFAULT_KARAOKE_POS_SINGLE };
        const aligned = karaokeMarginAlignmentFromPos(nextPos);
        patch.posA = nextPos;
        patch.marginV = aligned.marginV;
        patch.alignment = aligned.alignment;
      }
    }
    patchStyle(patch);
  };

  const restoreStyleDefaults = useCallback(() => {
    const nextStyle = createDefaultKaraokeStyle();
    nextStyle.indicator = { ...nextStyle.indicator, enabled: false };
    nextStyle.countdown = {
      ...nextStyle.countdown,
      enabled: false,
      size: KARAOKE_COUNTDOWN_DOT_SIZE_DEFAULT,
      spacing: KARAOKE_COUNTDOWN_SPACING_DEFAULT,
      anchor: { ...DEFAULT_KARAOKE_COUNTDOWN_ANCHOR },
      positions: [],
    };
    // 保持当前排布：单行恢复到下方居中；双行仍为 A 左 B 右
    const keepMode = resolveKaraokeLayoutMode(projectRef.current.style?.layoutMode);
    if (keepMode === 'single') {
      nextStyle.layoutMode = 'single';
      nextStyle.posA = { ...DEFAULT_KARAOKE_POS_SINGLE };
      const aligned = karaokeMarginAlignmentFromPos(nextStyle.posA);
      nextStyle.marginV = aligned.marginV;
      nextStyle.alignment = aligned.alignment;
    }
    const next = {
      ...projectRef.current,
      style: nextStyle,
      updatedAt: Date.now(),
    };
    persist(next);
    const name = String(nextStyle.fontName || DEFAULT_KARAOKE_STYLE.fontName).trim();
    setFontSelect(KARAOKE_FONT_PRESETS.some((f) => f.value === name) ? name : FONT_CUSTOM);
  }, [persist]);

  const resolveSlotOriginPos = useCallback((slot: DragSlot): KaraokePos => {
    const s = projectRef.current.style;
    if (slot === 'A') return resolveKaraokePosA(s);
    if (slot === 'B') return resolveKaraokePosB(s);
    if (slot === 'title') return resolveKaraokeOpeningTitlePos(s);
    if (slot === 'lyricist') return resolveKaraokeOpeningLyricistPos(s);
    return resolveKaraokeOpeningComposerPos(s);
  }, []);

  const applyPosDrag = useCallback(
    (slot: DragSlot, nextPos: KaraokePos) => {
      if (slot === 'A') {
        const aligned = karaokeMarginAlignmentFromPos(nextPos);
        patchStyle({
          posA: nextPos,
          marginV: aligned.marginV,
          alignment: aligned.alignment,
        });
        return;
      }
      if (slot === 'B') {
        patchStyle({ posB: nextPos });
        return;
      }
      if (slot === 'title') {
        patchStyle({ openingTitlePos: nextPos });
        return;
      }
      if (slot === 'lyricist') {
        patchStyle({ openingLyricistPos: nextPos });
        return;
      }
      patchStyle({ openingComposerPos: nextPos });
    },
    [patchStyle],
  );

  const movePosDragToClient = useCallback(
    (e: React.PointerEvent): boolean => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return false;
      const dx = e.clientX - drag.originClientX;
      const dy = e.clientY - drag.originClientY;
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < POS_DRAG_THRESHOLD_PX) return false;
        drag.moved = true;
        setDraggingSlot(drag.slot);
      }
      const stage = stageRef.current;
      if (!stage) return true;
      const rect = stage.getBoundingClientRect();
      // 按 PlayRes contain 内容框比例映射（与字号缩放一致）
      const layout = computePlayResPreviewLayout(rect.width, rect.height);
      const sx = Math.max(1, layout.contentW);
      const sy = Math.max(1, layout.contentH);
      const dxPlay = (dx / sx) * ASS_PLAY_RES_X;
      const dyPlay = (dy / sy) * ASS_PLAY_RES_Y;
      const next: KaraokePos = {
        x: Math.max(0, Math.min(ASS_PLAY_RES_X, Math.round(drag.originPos.x + dxPlay))),
        y: Math.max(0, Math.min(ASS_PLAY_RES_Y, Math.round(drag.originPos.y + dyPlay))),
      };
      applyPosDrag(drag.slot, next);
      return true;
    },
    [applyPosDrag],
  );

  const onSubtitlePointerDown = useCallback(
    (slot: DragSlot, e: React.PointerEvent) => {
      if (busyAny) return;
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = {
        slot,
        pointerId: e.pointerId,
        originClientX: e.clientX,
        originClientY: e.clientY,
        originPos: { ...resolveSlotOriginPos(slot) },
        moved: false,
      };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [busyAny, resolveSlotOriginPos],
  );

  const onSubtitlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      movePosDragToClient(e);
    },
    [movePosDragToClient],
  );

  const endDrag = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDraggingSlot(null);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const writeCountdownGroupAnchor = useCallback(
    (nextAnchor: KaraokePos) => {
      const cur = resolveKaraokeCountdown(projectRef.current.style?.countdown);
      const clamped = clampKaraokeCountdownAnchor(nextAnchor, {
        spacing: cur.spacing,
        count: cur.count,
      });
      if (!clamped) return;
      patchStyle({
        countdown: {
          ...projectRef.current.style?.countdown,
          anchor: clamped,
          positions: [],
        },
      });
    },
    [patchStyle],
  );

  const onCountdownDotPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (busyAny) return;
      e.preventDefault();
      e.stopPropagation();
      const cur = resolveKaraokeCountdown(projectRef.current.style?.countdown);
      const defaultAnchor = karaokeOpeningCountdownAnchorPos(
        resolveKaraokePosA(projectRef.current.style),
      );
      const originAnchor = karaokeCountdownGroupAnchor(cur, defaultAnchor);
      countdownDragRef.current = {
        pointerId: e.pointerId,
        originClientX: e.clientX,
        originClientY: e.clientY,
        originAnchor: { ...originAnchor },
        moved: false,
      };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [busyAny],
  );

  const onCountdownDotPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = countdownDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const dx = e.clientX - drag.originClientX;
      const dy = e.clientY - drag.originClientY;
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < POS_DRAG_THRESHOLD_PX) return;
        drag.moved = true;
        setDraggingCountdown(true);
      }
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const layout = computePlayResPreviewLayout(rect.width, rect.height);
      const sx = Math.max(1, layout.contentW);
      const sy = Math.max(1, layout.contentH);
      const dxPlay = (dx / sx) * ASS_PLAY_RES_X;
      const dyPlay = (dy / sy) * ASS_PLAY_RES_Y;
      writeCountdownGroupAnchor({
        x: Math.round(drag.originAnchor.x + dxPlay),
        y: Math.round(drag.originAnchor.y + dyPlay),
      });
    },
    [writeCountdownGroupAnchor],
  );

  const endCountdownDotDrag = useCallback((e: React.PointerEvent) => {
    const drag = countdownDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    countdownDragRef.current = null;
    setDraggingCountdown(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const fieldCls =
    'nodrag mt-1 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-1.5 text-sm text-white/90';

  // displayFontSize = style.fontSize * min(previewW/1920, previewH/1080)；烧录 ASS 仍用绝对字号
  const playResLayout = useMemo(
    () => computePlayResPreviewLayout(stageSize.w, stageSize.h),
    [stageSize.w, stageSize.h],
  );
  const { scale, contentW, contentH, offsetX, offsetY } = playResLayout;
  /** 合成抓帧时关掉选中高亮 / 弱对齐点，避免烧进成片 */
  const captureClean = composeCapturing;
  const baseFontSizePx = Math.max(
    10,
    (Number(style.fontSize) || DEFAULT_KARAOKE_STYLE.fontSize) * scale,
  );
  const sungOutlinePx = Math.max(0, lyricSungOutline * scale);
  const unsungOutlinePx = Math.max(0, lyricOutline * scale);
  // 软阴影 UI 已移除：预览与烧录一致固定关闭
  const shadowUi = KARAOKE_LYRIC_SHADOW_DEFAULT;
  const shadowPx = 0;
  // 软阴影挂行容器一次；字级只保留描边环 + 轻量外发光（勿逐字 drop-shadow）
  const lineDropShadowFilter = karaokePreviewLineDropShadowFilter(
    shadowUi,
    shadowCss,
    Math.max(lyricSungOutline, lyricOutline),
    scale,
  );
  /** 已唱白描边外发光；未唱仅描边环 */
  const sungSoftExtras = karaokePreviewSoftGlowLayers(sungOutlinePx, shadowPx);
  const sungOutlineShadow = (fast: boolean) =>
    buildKaraokeSungOutlineShadow(
      sungOutlinePx,
      sungOutlineCss,
      captureClean || fast ? [] : sungSoftExtras,
      { fast: captureClean || fast },
    );
  const unsungOutlineShadow = (fast: boolean) =>
    buildRoundedTextOutlineShadow(unsungOutlinePx, outlineCss, [], {
      fast: captureClean || fast,
    });
  const fontName =
    String(style.fontName || DEFAULT_KARAOKE_STYLE.fontName).trim() || DEFAULT_KARAOKE_STYLE.fontName;

  const baseTextStyle: React.CSSProperties = {
    fontFamily: `"${fontName}", "${KARAOKE_PREFERRED_FONT}", "${KARAOKE_FALLBACK_FONT}", "PingFang SC", sans-serif`,
    lineHeight: 1.15,
    // 与 ASS Style Bold=0 对齐；600 会让预览比烧录更「胖」
    fontWeight: 400,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
    wordBreak: 'keep-all',
    overflow: 'visible',
    userSelect: 'none',
    touchAction: 'none',
    cursor: busyAny ? 'default' : 'grab',
  };

  const onPreviewCharPointerDown = useCallback(
    (offsetLine: KaraokeLine, offsetCharIndex: number, slot: 'A' | 'B', e: React.PointerEvent) => {
      if (busyAny) return;
      e.preventDefault();
      e.stopPropagation();
      const mapped = mapOffsetCharToProject(
        offsetLine,
        offsetCharIndex,
        projectRef.current.lines || [],
        Number(projectRef.current.globalOffsetSec) || 0,
      );
      if (!mapped) return;
      const line = (projectRef.current.lines || []).find((l) => l.id === mapped.lineId);
      const ch = line?.chars?.[mapped.charIndex];
      if (!ch) return;
      charPointerGestureRef.current = {
        lineId: mapped.lineId,
        charIndex: mapped.charIndex,
        slot,
        pointerId: e.pointerId,
        originClientX: e.clientX,
        originClientY: e.clientY,
        originStart: Number(ch.startSec) || 0,
        originEnd: Math.max((Number(ch.startSec) || 0) + 0.03, Number(ch.endSec) || 0),
        moved: false,
      };
      // 同步挂起位置拖：超阈值后挪整行，不进字级时间拖（时间改下方条）
      dragRef.current = {
        slot,
        pointerId: e.pointerId,
        originClientX: e.clientX,
        originClientY: e.clientY,
        originPos: { ...resolveSlotOriginPos(slot) },
        moved: false,
      };
      setCharEditLineId(mapped.lineId);
      setCharEditIndex(mapped.charIndex);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [busyAny, resolveSlotOriginPos],
  );

  const onPreviewCharPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const g = charPointerGestureRef.current;
      if (!g || g.pointerId !== e.pointerId) return;
      if (!movePosDragToClient(e)) return;
      g.moved = true;
      e.preventDefault();
      e.stopPropagation();
    },
    [movePosDragToClient],
  );

  const onPreviewCharPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const g = charPointerGestureRef.current;
      if (!g || g.pointerId !== e.pointerId) return;
      const wasDrag = g.moved || !!dragRef.current?.moved;
      charPointerGestureRef.current = null;
      if (dragRef.current?.pointerId === e.pointerId) {
        dragRef.current = null;
        setDraggingSlot(null);
      }
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
      if (!wasDrag) {
        if (suppressCharClickSeekRef.current) {
          suppressCharClickSeekRef.current = false;
          setCharEditLineId(g.lineId);
          setCharEditIndex(g.charIndex);
          return;
        }
        selectCharEdit(g.lineId, g.charIndex, { seek: true });
      }
    },
    [selectCharEdit],
  );

  const applyGroupCharTranslate = useCallback(
    (drag: CharBarGroupDragState, clientX: number) => {
      const dRaw = (clientX - drag.originClientX) * drag.secPerPx;
      const minStart = drag.items.reduce(
        (m, it) => Math.min(m, it.originStart),
        Infinity,
      );
      const dSec = Number.isFinite(minStart) ? Math.max(-minStart, dRaw) : dRaw;
      const cur = projectRef.current;
      const indexSet = new Map<string, Set<number>>();
      for (const it of drag.items) {
        const set = indexSet.get(it.lineId) || new Set<number>();
        set.add(it.charIndex);
        indexSet.set(it.lineId, set);
      }
      const originMap = new Map(
        drag.items.map((it) => [charBarSelKey(it), it] as const),
      );
      const lines = (cur.lines || []).map((l) => {
        const baseline = drag.baselineLines[l.id];
        const idxs = indexSet.get(l.id);
        if (!baseline || !idxs) return l;
        const chars = baseline.chars.map((c) => ({ ...c }));
        for (const ci of idxs) {
          const origin = originMap.get(charBarSelKey({ lineId: l.id, charIndex: ci }));
          if (!origin || !chars[ci]) continue;
          const dur = Math.max(0.03, origin.originEnd - origin.originStart);
          const ns = origin.originStart + dSec;
          chars[ci] = { ...chars[ci], startSec: ns, endSec: ns + dur };
        }
        let lineStart = Number(baseline.startSec) || 0;
        let lineEnd = Math.max(lineStart + 0.05, Number(baseline.endSec) || 0);
        for (const c of chars) {
          lineStart = Math.min(lineStart, Number(c.startSec) || 0);
          lineEnd = Math.max(lineEnd, Number(c.endSec) || 0);
        }
        return {
          ...l,
          chars,
          startSec: Math.max(0, lineStart),
          endSec: Math.max(lineStart + 0.05, lineEnd),
          timingQuality: 'manual' as const,
        };
      });
      persist({
        ...cur,
        lines,
        weakLineAlignment: recomputeKaraokeWeakLineAlignment(lines),
        updatedAt: Date.now(),
      });
    },
    [persist],
  );

  const onCharBarPointerDown = useCallback(
    (
      kind: 'bar-translate' | 'bar-start' | 'bar-end',
      lineId: string,
      charIndex: number,
      e: React.PointerEvent,
    ) => {
      if (busyAny) return;
      const line = (projectRef.current.lines || []).find((l) => l.id === lineId);
      if (!line?.chars?.length) return;
      e.preventDefault();
      e.stopPropagation();
      const ch = line.chars[charIndex];
      if (!ch) return;
      const bar = charBarRef.current;
      const barW = Math.max(1, bar?.getBoundingClientRect().width || bar?.clientWidth || 1);
      const view = charBarViewRef.current;
      const span = Math.max(0.2, view.viewSpan || 0.2);
      const secPerPx = span / Math.max(1, barW);

      let nextSel = charBarSelectionRef.current.slice();
      const inSel = nextSel.some((s) => s.lineId === lineId && s.charIndex === charIndex);
      if (e.shiftKey) {
        nextSel = inSel
          ? nextSel.filter((s) => !(s.lineId === lineId && s.charIndex === charIndex))
          : [...nextSel, { lineId, charIndex }];
        syncCharBarSelection(nextSel);
        if (!nextSel.some((s) => s.lineId === lineId && s.charIndex === charIndex)) {
          setCharEditLineId(lineId);
          setCharEditIndex(null);
          return;
        }
      } else if (!inSel) {
        nextSel = [{ lineId, charIndex }];
        syncCharBarSelection(nextSel);
      }

      setCharEditIndex(charIndex);
      setCharEditLineId(lineId);
      charEditPinnedRef.current = true;

      if (kind === 'bar-translate' && nextSel.length > 1) {
        const baselineLines: CharBarGroupDragState['baselineLines'] = {};
        const items: CharBarGroupDragState['items'] = [];
        const lines = projectRef.current.lines || [];
        for (const sel of nextSel) {
          const ln = lines.find((l) => l.id === sel.lineId);
          const selCh = ln?.chars?.[sel.charIndex];
          if (!ln || !selCh) continue;
          if (!baselineLines[ln.id]) {
            baselineLines[ln.id] = {
              chars: (ln.chars || []).map((c) => ({ ...c })),
              startSec: Number(ln.startSec) || 0,
              endSec: Math.max(
                (Number(ln.startSec) || 0) + 0.05,
                Number(ln.endSec) || 0,
              ),
            };
          }
          const os = Number(selCh.startSec) || 0;
          items.push({
            lineId: sel.lineId,
            charIndex: sel.charIndex,
            originStart: os,
            originEnd: Math.max(os + 0.03, Number(selCh.endSec) || 0),
          });
        }
        if (items.length > 1) {
          const sourceLane =
            (e.currentTarget.closest('[data-karaoke-char-lane]') as HTMLElement | null)
              ?.dataset.karaokeCharLane === 'B'
              ? 'B'
              : (e.currentTarget.closest('[data-karaoke-char-lane]') as HTMLElement | null)
                    ?.dataset.karaokeCharLane === 'A'
                ? 'A'
                : 'all';
          charBarGroupDragRef.current = {
            pointerId: e.pointerId,
            originClientX: e.clientX,
            originClientY: e.clientY,
            secPerPx,
            sourceLane,
            hoverLane: sourceLane,
            moved: false,
            items,
            baselineLines,
          };
          try {
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          } catch {
            /* ignore */
          }
          return;
        }
      }

      charTimingDragRef.current = {
        kind,
        lineId,
        charIndex,
        pointerId: e.pointerId,
        originClientX: e.clientX,
        originStart: Number(ch.startSec) || 0,
        originEnd: Math.max((Number(ch.startSec) || 0) + 0.03, Number(ch.endSec) || 0),
        secPerPx,
        baselineChars: line.chars.map((c) => ({ ...c })),
        baselineLineStart: Number(line.startSec) || 0,
        baselineLineEnd: Math.max(
          (Number(line.startSec) || 0) + 0.05,
          Number(line.endSec) || 0,
        ),
      };
      setCharEditIndex(charIndex);
      setCharEditLineId(lineId);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [busyAny, syncCharBarSelection],
  );

  const onCharBarPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const group = charBarGroupDragRef.current;
      if (group && group.pointerId === e.pointerId) {
        e.preventDefault();
        const bar = charBarRef.current;
        const barW = Math.max(1, bar?.getBoundingClientRect().width || bar?.clientWidth || 1);
        const span = Math.max(0.2, charBarViewRef.current.viewSpan || 0.2);
        group.secPerPx = span / barW;
        if (Math.abs(e.clientX - group.originClientX) > 2 || Math.abs(e.clientY - group.originClientY) > 2) {
          group.moved = true;
        }
        const hover = hitTestCharBarLane(e.clientX, e.clientY) || group.sourceLane;
        group.hoverLane = hover;
        if (hover !== charBarDropLane) setCharBarDropLane(hover === group.sourceLane ? null : hover);
        applyGroupCharTranslate(group, e.clientX);
        return;
      }
      const drag = charTimingDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (!drag.kind.startsWith('bar-')) return;
      e.preventDefault();
      const bar = charBarRef.current;
      const barW = Math.max(1, bar?.getBoundingClientRect().width || bar?.clientWidth || 1);
      const span = Math.max(0.2, charBarViewRef.current.viewSpan || 0.2);
      drag.secPerPx = span / barW;
      applyCharTimingDragDelta(drag, e.clientX);
      if (drag.kind === 'bar-translate') {
        const hover = hitTestCharBarLane(e.clientX, e.clientY);
        const src =
          (e.currentTarget.closest('[data-karaoke-char-lane]') as HTMLElement | null)
            ?.dataset.karaokeCharLane;
        const sourceLane: CharBarLane =
          src === 'A' || src === 'B' ? src : 'all';
        setCharBarDropLane(
          hover && hover !== sourceLane && hover !== 'all' && sourceLane !== 'all'
            ? hover
            : null,
        );
      }
    },
    [applyCharTimingDragDelta, applyGroupCharTranslate, charBarDropLane],
  );

  const onCharBarPointerUp = useCallback((e: React.PointerEvent) => {
    const group = charBarGroupDragRef.current;
    if (group && group.pointerId === e.pointerId) {
      charBarGroupDragRef.current = null;
      setCharBarDropLane(null);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
      const hover = hitTestCharBarLane(e.clientX, e.clientY) || group.hoverLane;
      if (
        group.sourceLane !== 'all' &&
        (hover === 'A' || hover === 'B') &&
        hover !== group.sourceLane
      ) {
        moveCharsToDualTrack(group.items, hover);
      }
      return;
    }
    const drag = charTimingDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    charTimingDragRef.current = null;
    setCharBarDropLane(null);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    if (drag.kind === 'bar-translate') {
      const hover = hitTestCharBarLane(e.clientX, e.clientY);
      const src =
        (e.currentTarget.closest('[data-karaoke-char-lane]') as HTMLElement | null)
          ?.dataset.karaokeCharLane;
      if ((src === 'A' || src === 'B') && (hover === 'A' || hover === 'B') && hover !== src) {
        moveCharToDualTrack(drag.lineId, drag.charIndex, hover);
      }
    }
  }, [moveCharToDualTrack, moveCharsToDualTrack]);

  const onCharBarLanePointerDown = useCallback(
    (e: React.PointerEvent, lane: CharBarLane, laneLines: KaraokeLine[]) => {
      if (busyAny || e.button !== 0) return;
      if ((e.target as HTMLElement).closest('[data-karaoke-char]')) return;
      if (charInsertEditRef.current || lineTextEditRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const next: CharBarMarqueeState = {
        pointerId: e.pointerId,
        lane,
        additive: e.shiftKey,
        x0: e.clientX - rect.left,
        y0: e.clientY - rect.top,
        x1: e.clientX - rect.left,
        y1: e.clientY - rect.top,
      };
      charBarMarqueeRef.current = next;
      setCharBarMarquee(next);
      if (!e.shiftKey) syncCharBarSelection([]);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
      void laneLines;
    },
    [busyAny, syncCharBarSelection],
  );

  const onCharBarLanePointerMove = useCallback((e: React.PointerEvent) => {
    const m = charBarMarqueeRef.current;
    if (!m || m.pointerId !== e.pointerId) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const next = {
      ...m,
      x1: e.clientX - rect.left,
      y1: e.clientY - rect.top,
    };
    charBarMarqueeRef.current = next;
    setCharBarMarquee(next);
  }, []);

  const onCharBarLanePointerUp = useCallback(
    (e: React.PointerEvent, laneLines: KaraokeLine[]) => {
      const m = charBarMarqueeRef.current;
      if (!m || m.pointerId !== e.pointerId) return;
      charBarMarqueeRef.current = null;
      setCharBarMarquee(null);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const view = charBarViewRef.current;
      const hits = collectCharsInLaneMarquee(
        laneLines,
        view.viewLo,
        view.viewSpan,
        Math.max(1, rect.width),
        m.x0,
        m.x1,
      );
      if (!hits.length) {
        if (!m.additive) {
          syncCharBarSelection([]);
          setCharEditIndex(null);
        }
        return;
      }
      const next = m.additive
        ? (() => {
            const map = new Map(
              charBarSelectionRef.current.map((s) => [charBarSelKey(s), s] as const),
            );
            for (const h of hits) map.set(charBarSelKey(h), h);
            return [...map.values()];
          })()
        : hits;
      syncCharBarSelection(next);
      if (next[0]) {
        setCharEditLineId(next[0].lineId);
        setCharEditIndex(next[0].charIndex);
        charEditPinnedRef.current = true;
      }
    },
    [syncCharBarSelection],
  );

  const clampCharBarPan = useCallback((pan: number, maxPan: number) => {
    if (!(maxPan > 0)) return 0;
    return Math.min(maxPan, Math.max(0, pan));
  }, []);

  const onCharBarPanPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const view = charBarViewRef.current;
      if (!view.canPan || busyAny) return;
      e.preventDefault();
      e.stopPropagation();
      suppressCharBarFollow();
      const track = e.currentTarget.parentElement as HTMLElement | null;
      const trackW = Math.max(1, track?.getBoundingClientRect().width || 1);
      charBarPanDragRef.current = {
        pointerId: e.pointerId,
        originClientX: e.clientX,
        originPanSec: clampCharBarPan(charBarPanSec, view.maxPan),
        trackW,
        maxPan: view.maxPan,
      };
      try {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [busyAny, charBarPanSec, clampCharBarPan, suppressCharBarFollow],
  );

  const onCharBarPanPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = charBarPanDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      const dx = e.clientX - drag.originClientX;
      // 拇指可走宽度 ≈ track − thumb；用 maxPan 映射更准
      const view = charBarViewRef.current;
      const thumbRatio = Math.min(
        0.92,
        Math.max(0.08, view.viewSpan / Math.max(1e-6, view.fullSpan)),
      );
      const travel = Math.max(1, drag.trackW * (1 - thumbRatio));
      const dSec = (dx / travel) * drag.maxPan;
      setCharBarPanSec(clampCharBarPan(drag.originPanSec + dSec, drag.maxPan));
    },
    [clampCharBarPan],
  );

  const onCharBarPanPointerUp = useCallback((e: React.PointerEvent) => {
    const drag = charBarPanDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    charBarPanDragRef.current = null;
    suppressCharBarFollow();
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  }, [suppressCharBarFollow]);

  const onCharBarScrollTrackPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const view = charBarViewRef.current;
      if (!view.canPan || busyAny) return;
      if ((e.target as HTMLElement).dataset?.charBarThumb === '1') return;
      e.preventDefault();
      e.stopPropagation();
      suppressCharBarFollow();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const trackW = Math.max(1, rect.width);
      const thumbRatio = Math.min(
        0.92,
        Math.max(0.08, view.viewSpan / Math.max(1e-6, view.fullSpan)),
      );
      const clickRatio = (e.clientX - rect.left) / trackW;
      const travel = Math.max(1e-6, 1 - thumbRatio);
      const nextPan = ((clickRatio - thumbRatio / 2) / travel) * view.maxPan;
      setCharBarPanSec(clampCharBarPan(nextPan, view.maxPan));
    },
    [busyAny, clampCharBarPan, suppressCharBarFollow],
  );

  charBarZoomRef.current = charBarZoom;
  charBarPanSecRef.current = charBarPanSec;

  /** 字轨滚轮：Ctrl/Meta=缩放；否则平移。非 passive 以拦截浏览器页面缩放 */
  useEffect(() => {
    const el = charBarShellRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const view = charBarViewRef.current;
      const barW = Math.max(
        1,
        charBarWidthPx || charBarRef.current?.clientWidth || 1,
      );
      const delta =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!delta) return;

      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        const { fullLo, fullSpan } = view;
        if (!(fullSpan > 0)) return;
        const bounds = karaokeCharBarZoomBounds(fullSpan);
        const prevZoom = Math.max(
          bounds.min,
          Math.min(bounds.max, charBarZoomRef.current || 1),
        );
        const oldViewSpan = karaokeCharBarVisibleSpan(fullSpan, prevZoom);
        const oldMaxPan = Math.max(0, fullSpan - oldViewSpan);
        const oldPan = clampCharBarPan(charBarPanSecRef.current, oldMaxPan);
        const viewLo = fullLo + oldPan;

        let anchorRatio = 0.5;
        const bar = charBarRef.current;
        const barRect = bar?.getBoundingClientRect();
        if (
          barRect &&
          barRect.width > 0 &&
          e.clientX >= barRect.left &&
          e.clientX <= barRect.right
        ) {
          anchorRatio = Math.max(
            0,
            Math.min(1, (e.clientX - barRect.left) / barRect.width),
          );
        } else {
          const playStored =
            playTimeRef.current -
            (Number(projectRef.current.globalOffsetSec) || 0);
          if (oldViewSpan > 1e-6) {
            anchorRatio = Math.max(
              0,
              Math.min(1, (playStored - viewLo) / oldViewSpan),
            );
          }
        }
        const anchorSec = viewLo + anchorRatio * oldViewSpan;

        const factor = Math.exp(-delta * 0.0022);
        const nextZoom = Math.max(
          bounds.min,
          Math.min(bounds.max, prevZoom * factor),
        );
        if (Math.abs(nextZoom - prevZoom) < 1e-4) return;

        const newViewSpan = karaokeCharBarVisibleSpan(fullSpan, nextZoom);
        const newMaxPan = Math.max(0, fullSpan - newViewSpan);
        const newPan = clampCharBarPan(
          anchorSec - anchorRatio * newViewSpan - fullLo,
          newMaxPan,
        );
        charBarZoomRef.current = nextZoom;
        charBarPanSecRef.current = newPan;
        setCharBarZoom(nextZoom);
        setCharBarPanSec(newPan);
        return;
      }

      if (!view.canPan) return;
      e.preventDefault();
      e.stopPropagation();
      suppressCharBarFollow();
      const dSec = (delta / barW) * view.viewSpan;
      setCharBarPanSec((prev) => clampCharBarPan(prev + dSec, view.maxPan));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [
    charBarWidthPx,
    clampCharBarPan,
    editableSingableLines.length,
    lineTextEdit?.lineId,
    charInsertEdit?.lineId,
    suppressCharBarFollow,
  ]);

  const renderGenericCharLane = (
    lines: KaraokeLine[],
    laneKey: CharBarLane,
    viewLo: number,
    viewSpan: number,
    toPct: (sec: number) => number,
    playPct: number,
  ) => {
    const playStored = playTime - globalOff;
    const selSet = new Set(charBarSelection.map(charBarSelKey));
    const dropOn = charBarDropLane === laneKey && laneKey !== 'all';
    return (
      <div
        key={laneKey}
        data-karaoke-char-lane={laneKey}
        className={`nodrag group/charbar relative h-11 min-h-[2.75rem] rounded-md bg-black/50 ring-1 overflow-hidden touch-pan-x ${
          dropOn ? 'ring-sky-400/80 bg-sky-500/10' : 'ring-white/10'
        }`}
        onPointerDown={(e) => onCharBarLanePointerDown(e, laneKey, lines)}
        onPointerMove={onCharBarLanePointerMove}
        onPointerUp={(e) => onCharBarLanePointerUp(e, lines)}
        onPointerCancel={(e) => onCharBarLanePointerUp(e, lines)}
        onContextMenu={(e) => {
          const bar = e.currentTarget.getBoundingClientRect();
          let clickTime = playStored;
          if (bar.width > 0) {
            const ratio = Math.max(
              0,
              Math.min(1, (e.clientX - bar.left) / bar.width),
            );
            clickTime = viewLo + ratio * viewSpan;
          }
          openCharBarEmptyCtxMenu(e, clickTime, laneKey);
        }}
      >
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-sky-300/90 z-[3]"
          style={{ left: `${playPct}%` }}
          aria-hidden
        />
        {lines.flatMap((line) => {
          const lineWeak = isWeakOrInterpolatedKaraokeLine(line);
          return (line.chars || []).map((ch, ci) => {
            const s = Number(ch.startSec) || 0;
            const e = Math.max(s + 0.03, Number(ch.endSec) || 0);
            const left = toPct(s);
            const width = Math.max(0.15, toPct(e) - left);
            if (left + width < -2 || left > 102) return null;
            const selected = selSet.size
              ? selSet.has(charBarSelKey({ lineId: line.id, charIndex: ci }))
              : selectedCharEditLineId === line.id && selectedCharEditIndex === ci;
            const wiping =
              playTime >= s + globalOff - 1e-3 &&
              playTime < e + globalOff + 1e-3;
            return (
              <div
                key={`bar-${line.id}-${ci}`}
                data-karaoke-char="1"
                className={`absolute top-0.5 bottom-0.5 rounded z-[2] flex items-stretch overflow-hidden ${
                  selected
                    ? 'bg-sky-400/55 ring-1 ring-sky-200/80'
                    : wiping
                      ? 'bg-sky-500/35 ring-1 ring-sky-400/40'
                      : lineWeak
                        ? 'bg-amber-500/30 ring-1 ring-amber-400/35'
                        : 'bg-white/18 ring-1 ring-white/12'
                } ${busyAny ? 'opacity-50' : 'cursor-ew-resize'}`}
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                }}
                title={`${ch.text}  ${(s + globalOff).toFixed(2)}s → ${(e + globalOff).toFixed(2)}s · 双击改词 · 右键菜单 · 拖空白框选 · 拖到另一轨切换`}
                onContextMenu={(ev) =>
                  openCharBarCharCtxMenu(ev, line.id, ci, laneKey)
                }
                onPointerDown={(ev) =>
                  onCharBarPointerDown('bar-translate', line.id, ci, ev)
                }
                onPointerMove={onCharBarPointerMove}
                onPointerUp={onCharBarPointerUp}
                onPointerCancel={onCharBarPointerUp}
                onDoubleClick={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  if (charTimingDragRef.current) return;
                  beginLineTextEdit(line.id);
                }}
                onClick={(ev) => {
                  ev.stopPropagation();
                  if (suppressCharClickSeekRef.current) {
                    suppressCharClickSeekRef.current = false;
                    setCharEditLineId(line.id);
                    setCharEditIndex(ci);
                    return;
                  }
                  if (!charTimingDragRef.current) {
                    setCharEditLineId(line.id);
                    setCharEditIndex(ci);
                  }
                }}
              >
                <span
                  className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-[1] hover:bg-white/30"
                  onPointerDown={(ev) =>
                    onCharBarPointerDown('bar-start', line.id, ci, ev)
                  }
                  onPointerMove={onCharBarPointerMove}
                  onPointerUp={onCharBarPointerUp}
                  onPointerCancel={onCharBarPointerUp}
                />
                <span className="pointer-events-none flex-1 flex items-center justify-center text-[12px] font-semibold text-white truncate px-0.5 select-none">
                  {ch.text}
                </span>
                <span
                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-[1] hover:bg-white/30"
                  onPointerDown={(ev) =>
                    onCharBarPointerDown('bar-end', line.id, ci, ev)
                  }
                  onPointerMove={onCharBarPointerMove}
                  onPointerUp={onCharBarPointerUp}
                  onPointerCancel={onCharBarPointerUp}
                />
                {selected && !busyAny ? (
                  <button
                    type="button"
                    className="nodrag absolute top-0.5 right-0.5 z-[5] flex h-4 w-4 items-center justify-center rounded-full bg-rose-500/90 text-white shadow ring-1 ring-white/40 hover:bg-rose-400"
                    title={tt.charTimingDeleteChar}
                    aria-label={tt.charTimingDeleteChar}
                    onPointerDown={(ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                    }}
                    onClick={(ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      deleteSelectedChar(line.id, ci);
                    }}
                  >
                    <Minus className="h-2.5 w-2.5" strokeWidth={3} />
                  </button>
                ) : null}
              </div>
            );
          });
        })}
        {charInsertEdit &&
        lines.some((l) => l.id === charInsertEdit.lineId)
          ? (() => {
              const line = lines.find((l) => l.id === charInsertEdit.lineId);
              if (!line) return null;
              const chars = line.chars || [];
              const gapIdx = charInsertEdit.atIndex;
              const emptyLine = chars.length === 0;
              const prefer =
                charInsertEdit.preferSec != null && Number.isFinite(charInsertEdit.preferSec)
                  ? Number(charInsertEdit.preferSec)
                  : undefined;
              let boundarySec: number;
              if (emptyLine) {
                boundarySec =
                  prefer != null ? prefer : Number(line.startSec) || viewLo;
              } else if (gapIdx <= 0) {
                boundarySec = Number(chars[0]?.startSec) || viewLo;
              } else if (gapIdx >= chars.length) {
                const last = chars[chars.length - 1];
                boundarySec = Math.max(
                  Number(last?.startSec) || 0,
                  Number(last?.endSec) || 0,
                );
              } else {
                const prev = chars[gapIdx - 1];
                const nxt = chars[gapIdx];
                const a = Math.max(
                  Number(prev.startSec) || 0,
                  Number(prev.endSec) || 0,
                );
                const b = Number(nxt.startSec) || a;
                boundarySec = (a + b) / 2;
              }
              const leftPct = toPct(boundarySec);
              if (leftPct < -4 || leftPct > 104) return null;
              const slotW = emptyLine
                ? Math.max(18, Math.min(42, (1.2 / viewSpan) * 100))
                : Math.max(7, Math.min(18, (0.22 / viewSpan) * 100));
              return (
                <div
                  key={`ins-${line.id}-${gapIdx}`}
                  className="absolute top-0.5 bottom-0.5 z-[6] flex items-center px-0.5"
                  style={{
                    left: `${leftPct}%`,
                    width: `${slotW}%`,
                    minWidth: emptyLine ? 160 : 56,
                    transform: 'translateX(-50%)',
                  }}
                >
                  <input
                    ref={charInsertInputRef}
                    type="text"
                    className="nodrag h-full w-full min-w-[3rem] rounded-md bg-black/70 px-1.5 text-center text-[13px] font-bold text-white outline-none ring-2 ring-rose-400/90 placeholder:text-white/35"
                    value={charInsertEdit?.draft || ''}
                    placeholder="…"
                    title={tt.charTimingInsertPlaceholder}
                    aria-label={tt.charTimingInsertPlaceholder}
                    disabled={busyAny}
                    onChange={(e) => {
                      const draft = e.target.value;
                      setCharInsertEdit((prev) => {
                        if (!prev) return prev;
                        const next = { ...prev, draft };
                        charInsertEditRef.current = next;
                        return next;
                      });
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitCharInsertEdit();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelCharInsertEdit();
                      }
                    }}
                    onBlur={() => {
                      const draft = String(
                        charInsertEditRef.current?.draft || '',
                      ).trim();
                      if (draft) commitCharInsertEdit();
                      else cancelCharInsertEdit();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onContextMenu={(e) => e.stopPropagation()}
                  />
                </div>
              );
            })()
          : null}
        {charBarMarquee && charBarMarquee.lane === laneKey ? (
          <div
            className="pointer-events-none absolute z-[8] rounded-sm border border-sky-300/90 bg-sky-400/20"
            style={{
              left: Math.min(charBarMarquee.x0, charBarMarquee.x1),
              top: Math.min(charBarMarquee.y0, charBarMarquee.y1),
              width: Math.max(1, Math.abs(charBarMarquee.x1 - charBarMarquee.x0)),
              height: Math.max(1, Math.abs(charBarMarquee.y1 - charBarMarquee.y0)),
            }}
          />
        ) : null}
      </div>
    );
  };

  const renderChars = (line: KaraokeLine | null, slot: 'A' | 'B') => {
    const chars = linePreviewChars(line);
    const enableWipe = !!(line?.chars?.length);
    const visualEnds = enableWipe ? karaokeLineCharWipeVisualEnds(line) : [];
    const interactive = enableWipe && !!line && !busyAny;
    const lineWeak = !!(line && isWeakOrInterpolatedKaraokeLine(line));
    const mappedSelected =
      interactive && selectedCharEditIndex != null && line && selectedCharEditLineId
        ? (() => {
            for (let i = 0; i < chars.length; i++) {
              const hit = mapOffsetCharToProject(line, i, project.lines || [], globalOff);
              if (
                hit &&
                hit.lineId === selectedCharEditLineId &&
                hit.charIndex === selectedCharEditIndex
              ) {
                return i;
              }
            }
            return -1;
          })()
        : -1;
    return chars.map((ch, i) => {
      const roleCss = karaokeRoleSungCss(ch.role, roleColors) || null;
      const charSungCss = roleCss || sungCss;
      // 角色标记：可显示、不参与 wipe；静态用角色色
      const isRoleTag = !!ch.roleTag;
      const fill = isRoleTag ? 0 : charWipeRatio(ch, playTime, enableWipe, visualEnds[i]);
      const selected = !captureClean && mappedSelected === i;
      const dispStart = Number(ch.startSec) || 0;
      const dispEnd = Number(ch.endSec) || 0;
      const charInteractive = !captureClean && interactive && !isRoleTag;
      // 预览 wipe：底层未唱填+黑边；上层 overflow 半扫已唱填+白边（与方案 A BurnOverlay 同款）
      const baseSungLook = isRoleTag || fill >= 1;
      const baseOutline = baseSungLook ? sungOutlineShadow(false) : unsungOutlineShadow(false);
      const wipeOutline = sungOutlineShadow(!!captureClean);
      const outlinePadCss = Math.ceil(Math.max(sungOutlinePx, unsungOutlinePx) + 1);
      const wipeMask =
        fill > 0 && fill < 1 ? karaokeSungWipeMaskStyles(fill, outlinePadCss) : null;
      return (
        <span
          key={`${i}-${ch.text}`}
          className={charInteractive ? 'nodrag' : undefined}
          onPointerDown={
            charInteractive && line
              ? (e) => onPreviewCharPointerDown(line, i, slot, e)
              : undefined
          }
          onPointerMove={charInteractive ? onPreviewCharPointerMove : undefined}
          onPointerUp={charInteractive ? onPreviewCharPointerUp : undefined}
          onPointerCancel={charInteractive ? onPreviewCharPointerUp : undefined}
          onDoubleClick={
            !captureClean && interactive && line
              ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const mapped = mapOffsetCharToProject(
                    line,
                    i,
                    projectRef.current.lines || [],
                    Number(projectRef.current.globalOffsetSec) || 0,
                  );
                  if (mapped) beginLineTextEdit(mapped.lineId);
                }
              : undefined
          }
          title={
            captureClean
              ? undefined
              : isRoleTag
                ? `${ch.text} · 角色标记（不参与扫字）`
                : interactive
                  ? `${ch.text}  ${dispStart.toFixed(2)}s → ${dispEnd.toFixed(2)}s · 单击选字 · 拖动调位置 · 双击改词`
                  : undefined
          }
          style={{
            position: 'relative',
            display: 'inline-block',
            color: baseSungLook ? charSungCss : unsungCss,
            cursor: charInteractive
              ? draggingSlot === slot
                ? 'grabbing'
                : 'grab'
              : interactive
                ? 'text'
                : undefined,
            pointerEvents: captureClean ? 'none' : interactive ? 'auto' : undefined,
            borderRadius: selected ? 4 : undefined,
            background: selected ? 'rgba(56,189,248,0.28)' : undefined,
            boxShadow: selected
              ? '0 0 0 2px rgba(56,189,248,0.85), 0 0 10px rgba(56,189,248,0.35)'
              : undefined,
            outline: selected ? '1px solid rgba(255,255,255,0.35)' : undefined,
            outlineOffset: selected ? 1 : undefined,
            textShadow: baseOutline,
          }}
        >
          {!captureClean && lineWeak && !isRoleTag ? (
            <span
              aria-hidden
              title={tt.charTimingWeakDot}
              style={{
                position: 'absolute',
                left: '50%',
                top: `-0.35em`,
                width: Math.max(4, 5 * scale),
                height: Math.max(4, 5 * scale),
                marginLeft: -Math.max(2, 2.5 * scale),
                borderRadius: '50%',
                background: '#f59e0b',
                boxShadow: '0 0 4px rgba(245,158,11,0.8)',
                pointerEvents: 'none',
                zIndex: 2,
              }}
            />
          ) : null}
          {ch.text}
          {wipeMask ? (
            <span aria-hidden style={wipeMask.mask}>
              <span
                style={{
                  ...wipeMask.inner,
                  color: charSungCss,
                  // overflow:hidden 裁切填色+白边（勿用 clip-path：易漏 text-shadow→整字白边）
                  textShadow: wipeOutline,
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

  /** 简易指示灯：圆点跟随当前唱词字（偏移/大小按 PlayRes 缩放；色随角色） */
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
        className="pointer-events-none absolute z-[4] rounded-full"
        style={{
          width: sizePx,
          height: sizePx,
          left: `calc(${progress * 100}% + ${ox}px)`,
          top: oy,
          transform: 'translate(-50%, -50%)',
          background: `radial-gradient(circle at 35% 30%, #fff 0%, ${indCss} 45%, rgba(0,0,0,0.35) 100%)`,
          boxShadow: `0 0 ${Math.max(2, sizePx * 0.25)}px ${indCss}`,
          opacity: 0.92,
        }}
        aria-hidden
        title="TODO: ASS 烧录指示灯图形尚未写入，仅预览简易跟随"
      />
    );
  };

  /** 每句歌词上方倒计时（countdown.enabled；相对行首用 spacing；开场/再入点位见下方绝对层） */
  const renderCountdownDots = (slot: 'A' | 'B') => {
    if (countdownPreview.slot !== slot || countdownPreview.lit <= 0) return null;
    const dotPx = Math.max(8, countdown.size * scale * 0.55);
    const stepPx = Math.max(dotPx, countdown.spacing * scale);
    const dotCss = countdownPreview.css || sungCss;
    return (
      <div
        className="pointer-events-none absolute z-[8]"
        style={{
          left: 0,
          top: `-${dotPx + Math.max(4, 6 * scale)}px`,
          height: dotPx,
          width: Math.max(stepPx * countdownPreview.lit, dotPx),
          opacity: 1,
        }}
        aria-hidden
        title={tt.countdownHint}
      >
        {Array.from({ length: countdownPreview.lit }).map((_, i) => (
          <span
            key={`cd-${slot}-${countdownPreview.lineIdx}-${i}`}
            style={{
              position: 'absolute',
              left: i * stepPx,
              top: 0,
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

  const renderDraggableLine = (opts: {
    slot: 'A' | 'B';
    pos: KaraokePos;
    line: KaraokeLine | null;
    active: boolean;
    /** 句间渐隐：上一句已唱完，自 singEnd 立刻 fade */
    held?: boolean;
    /** 唱完渐隐 0..1（与 ASS \fad 对应） */
    fadeOpacity?: number;
    label: string;
  }) => {
    const plain =
      String(opts.line?.text || '')
        .replace(/\r?\n/g, '')
        .trim() ||
      (opts.line?.chars?.length ? opts.line.chars.map((c) => c.text).join('') : '');
    // 无真实歌词时不渲染任何占位文案
    if (!plain) return null;
    const fitted = fitPreviewLineLayout(opts.pos, plain, baseFontSizePx, Math.max(1, contentW));
    const isDrag = draggingSlot === opts.slot;
    const fade =
      opts.fadeOpacity != null && Number.isFinite(opts.fadeOpacity)
        ? Math.max(0, Math.min(1, opts.fadeOpacity))
        : 1;
    if (fade <= 0.001 && opts.held) return null;
    const baseOpacity = !opts.line ? 0.55 : opts.active ? 1 : opts.held ? 1 : 0.72;
    const lineOpacity = baseOpacity * fade;
    const lineHasChars = !!(opts.line?.chars?.length);
    const lineWeak = !!(opts.line && isWeakOrInterpolatedKaraokeLine(opts.line));
    return (
      <div
        key={opts.slot}
        className="nodrag absolute z-[3] overflow-visible"
        style={{
          ...fitted.style,
          ...baseTextStyle,
          fontSize: `${fitted.fontSizePx}px`,
          opacity: 1,
          cursor: busyAny ? 'default' : isDrag ? 'grabbing' : 'grab',
          pointerEvents: busyAny ? 'none' : 'auto',
        }}
        onPointerDown={(e) => onSubtitlePointerDown(opts.slot, e)}
        onPointerMove={onSubtitlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        title={tt.dragHint}
        aria-label={opts.label}
      >
        {/* 位置 A/B 调试标签：仅拖动该槽时显示，正式预览/播放不出现极小蓝底字 */}
        {!captureClean && layoutMode === 'dualAlternate' && isDrag ? (
          <div
            className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide"
            style={{
              background: 'rgba(56,189,248,0.45)',
              color: '#e0f2fe',
              pointerEvents: 'none',
            }}
          >
            {opts.label}
          </div>
        ) : null}
        {!captureClean && lineWeak ? (
          <div
            className="pointer-events-none absolute -left-3 top-1/2 -translate-y-1/2"
            title={tt.charTimingWeakDot}
            aria-hidden
          >
            <span
              style={{
                display: 'block',
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: '#f59e0b',
                boxShadow: '0 0 6px rgba(245,158,11,0.85)',
              }}
            />
          </div>
        ) : null}
        <div
          className="relative inline-block overflow-visible whitespace-nowrap"
          style={{ pointerEvents: lineHasChars ? 'auto' : 'none' }}
        >
          {renderCountdownDots(opts.slot)}
          {renderIndicator(opts.line, opts.active)}
          {/* 有字级时间轴则按字填字；软阴影整行 filter 一次（对齐 ASS 整行阴影底） */}
          <span
            style={{
              opacity: lineOpacity,
              filter: lineDropShadowFilter,
            }}
          >
            {renderChars(opts.line, opts.slot)}
          </span>
        </div>
      </div>
    );
  };

  const editorBody = (
    <>
      {!hideClose ? (
        <button
          type="button"
          className="nodrag absolute right-3 top-2.5 z-20 rounded-lg p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white"
          onClick={handleClose}
          aria-label={tt.closeAria}
          title={busy === 'burn' ? tt.closeCancelsBurn : tt.close}
        >
          <X className="h-5 w-5" />
        </button>
      ) : null}
      <div className={`px-4 pt-3 pb-1 shrink-0 border-b border-white/10 ${hideClose ? '' : 'pr-12'}`}>
        <div className="text-white/95 text-base font-medium">{tt.title}</div>
        {busy === 'burn' ? (
          <div className="text-amber-200/70 text-[11px] mt-0.5">{tt.closeCancelsBurn}</div>
        ) : null}
      </div>

      {/* 左右分栏：左预览右控件；宽屏尽量不滚，极矮/窄屏才滚 */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row md:items-stretch gap-0 overflow-y-auto md:overflow-hidden">
        {/* 左：预览 flex:1 吃高；字轨+进度条 shrink-0 贴底；全屏时用 CSS fixed 浮层 */}
        <div className="flex-1 min-w-0 min-h-[220px] md:min-h-0 h-full self-stretch flex flex-col p-3 md:pr-2 md:overflow-hidden">
          {previewFullscreen ? (
            <div className="flex-1 min-h-0 rounded-xl bg-white/[0.04] ring-1 ring-white/10" aria-hidden />
          ) : null}
          {(() => {
            /* 全屏时 portal 到 body，避开 modal 的 backdrop-filter 对 fixed 的限制 */
            const previewCard = (
          <div
            ref={previewShellRef}
            className={
              previewFullscreen
                ? 'fixed inset-0 flex flex-col bg-black pointer-events-auto'
                : 'rounded-xl bg-white/[0.04] ring-1 ring-white/10 overflow-hidden flex-1 min-h-0 h-full self-stretch flex flex-col'
            }
            style={previewFullscreen ? { zIndex: KARAOKE_PREVIEW_FS_Z } : undefined}
            data-nexflow-karaoke-preview={previewFullscreen ? undefined : '1'}
            data-nexflow-karaoke-preview-fs={previewFullscreen ? '1' : undefined}
            onClick={(e) => {
              if (previewFullscreen) e.stopPropagation();
            }}
            onPointerDown={(e) => {
              if (previewFullscreen) e.stopPropagation();
            }}
          >
            <div
              className={`relative z-20 px-3 py-1.5 flex items-center justify-between gap-2 shrink-0 pointer-events-auto ${
                previewFullscreen ? 'bg-black/80 border-b border-white/10' : ''
              }`}
            >
              <span className="text-xs text-white/70 font-medium">{tt.previewSection}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                {showVideoSourceActions && onPickLocalVideo && !previewFullscreen ? (
                  <button
                    type="button"
                    className="nodrag inline-flex h-7 items-center gap-1 rounded-lg bg-white/10 px-2 text-[11px] text-white/85 hover:bg-white/20 hover:text-white disabled:opacity-40"
                    disabled={busyAny || videoSourceBusy === 'upload'}
                    title={tt.uploadLocalVideoHint}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPickLocalVideo();
                    }}
                  >
                    {videoSourceBusy === 'upload' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    {videoSourceBusy === 'upload' ? tt.uploadLocalVideoRunning : tt.uploadLocalVideo}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="nodrag relative z-30 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white/80 hover:bg-white/20 hover:text-white pointer-events-auto"
                  aria-label={previewFullscreen ? tt.previewExitFullscreen : tt.previewFullscreen}
                  title={previewFullscreen ? tt.previewExitFullscreen : tt.previewFullscreen}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    togglePreviewFullscreen();
                  }}
                >
                  {previewFullscreen ? (
                    <Minimize2 className="h-3.5 w-3.5" strokeWidth={2} />
                  ) : (
                    <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />
                  )}
                </button>
              </div>
            </div>
            <div
              ref={stageRef}
              className="relative w-full flex-1 min-h-0 bg-black overflow-hidden"
              style={
                recordStageSize
                  ? {
                      position: 'fixed',
                      left: 0,
                      top: 0,
                      width: recordStageSize.w,
                      height: recordStageSize.h,
                      zIndex: KARAOKE_PREVIEW_FS_Z + 20,
                      flex: 'none',
                    }
                  : undefined
              }
            >
              {hasVideoPreview ? (
                <video
                  ref={videoRef}
                  key={previewSrc}
                  src={previewSrc}
                  className="absolute inset-0 w-full h-full object-contain bg-black"
                  playsInline
                  preload="metadata"
                  muted={muteVideoForSong}
                />
              ) : null}
              {/* song 模式挂原曲；video 模式不挂 src，避免双声 */}
              {hasAudioPreview ? (
                <audio
                  ref={audioRef}
                  key={`${audioSrc}-${useSongAudio ? 'song' : 'off'}`}
                  src={useSongAudio ? audioSrc : undefined}
                  preload="metadata"
                  className="hidden"
                />
              ) : null}
              {!hasVideoPreview && !isPlaying ? (
                <div className="absolute inset-0 flex items-center justify-center px-6 pb-8 text-center text-[11px] text-white/35 leading-relaxed pointer-events-none">
                  {hasAudioPreview
                    ? tt.previewAudioOnly
                    : resolvingPreviewVideo
                      ? tt.previewResolvingVideo
                      : tt.previewNoMedia}
                </div>
              ) : null}
              {!hasTiming && !captureClean ? (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-[6] px-2 pt-2">
                  <div className="mx-auto max-w-[95%] rounded-lg bg-amber-500/90 px-3 py-2 text-center text-[12px] font-medium leading-snug text-black shadow-lg ring-1 ring-amber-200/50">
                    {tt.previewNeedTiming}
                  </div>
                </div>
              ) : null}
              {error && !captureClean ? (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-[7] px-2 pt-2">
                  <div
                    className={`mx-auto max-w-[95%] rounded-lg bg-zinc-700/95 px-3 py-2 text-center text-[12px] font-medium leading-snug text-zinc-100 shadow-lg ring-1 ring-white/15 whitespace-pre-wrap ${
                      !hasTiming ? 'mt-12' : ''
                    }`}
                  >
                    {error}
                  </div>
                </div>
              ) : null}
              {/* PlayRes contain 内容框：字号/坐标随预览与全屏等比缩放（对齐 object-contain 画面） */}
              {/* 预览级合成只抓本层（透明底字幕），不含 video / 播放钮 / 侧栏 */}
              <div
                ref={captureOverlayRef}
                data-nexflow-karaoke-overlay="1"
                className="absolute z-[3] overflow-visible"
                style={{
                  left: offsetX,
                  top: offsetY,
                  width: contentW,
                  height: contentH,
                  pointerEvents: 'none',
                  // 抓帧时保证层可见且无滤镜干扰
                  opacity: 1,
                }}
              >
                {showOpeningLayer || showReentryCountdown ? (
                  <div className="pointer-events-none absolute inset-0 z-[4]">
                    {showOpeningCountdown || showReentryCountdown ? (
                      <div className="absolute inset-0" aria-hidden>
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
                              key={`cd-dots-${showOpeningCountdown ? 'open' : 're'}-${i}`}
                              className="nodrag absolute z-[8] rounded-full"
                              title={tt.countdownDotDragHint}
                              style={{
                                left: `${(pos.x / ASS_PLAY_RES_X) * 100}%`,
                                top: `${(pos.y / ASS_PLAY_RES_Y) * 100}%`,
                                width: dotPx,
                                height: dotPx,
                                boxSizing: 'border-box',
                                transform: 'translate(-50%, -50%)',
                                border: '2px solid #fff',
                                background: leadInCountdownCss,
                                display: 'inline-block',
                                flexShrink: 0,
                                opacity: dotOpacity,
                                transition: 'opacity 80ms linear',
                                pointerEvents:
                                  busyAny || dotOpacity < 0.15 ? 'none' : 'auto',
                                cursor: busyAny
                                  ? 'default'
                                  : draggingCountdown
                                    ? 'grabbing'
                                    : 'grab',
                                touchAction: 'none',
                                userSelect: 'none',
                              }}
                              onPointerDown={onCountdownDotPointerDown}
                              onPointerMove={onCountdownDotPointerMove}
                              onPointerUp={endCountdownDotDrag}
                              onPointerCancel={endCountdownDotDrag}
                            />
                          );
                        })}
                      </div>
                    ) : null}
                    {showOpeningCredits ? (
                    <div className="absolute inset-0" style={{ opacity: openingOpacity, pointerEvents: 'none' }}>
                      {openingSongTitle ? (
                        <div
                          className="nodrag absolute text-center font-bold leading-none"
                          style={{
                            // 字顶锚（与 ASS `\an8` 一致；默认居中 Y=460）
                            left: `${(openingTitlePos.x / ASS_PLAY_RES_X) * 100}%`,
                            top: `${(openingTitlePos.y / ASS_PLAY_RES_Y) * 100}%`,
                            transform: 'translate(-50%, 0)',
                            fontSize: `${Math.max(14, openingTitleFontSize * scale)}px`,
                            color: KARAOKE_OPENING_PRIMARY_CSS,
                            textShadow: buildRoundedTextOutlineShadow(
                              Math.max(0, openingTitleOutline * scale),
                              KARAOKE_OPENING_OUTLINE_CSS,
                              [],
                              { fast: captureClean },
                            ),
                            maxWidth: '90%',
                            wordBreak: 'break-word',
                            userSelect: 'none',
                            touchAction: 'none',
                            pointerEvents: busyAny ? 'none' : 'auto',
                            cursor: busyAny
                              ? 'default'
                              : draggingSlot === 'title'
                                ? 'grabbing'
                                : 'grab',
                          }}
                          onPointerDown={(e) => onSubtitlePointerDown('title', e)}
                          onPointerMove={onSubtitlePointerMove}
                          onPointerUp={endDrag}
                          onPointerCancel={endDrag}
                          title={tt.dragOpeningHint}
                          aria-label={tt.previewOpeningCredits}
                        >
                          {openingSongTitle}
                        </div>
                      ) : null}
                      <div
                        className="nodrag absolute font-semibold leading-tight"
                        style={{
                          // 字顶锚（与 ASS `\an7` 一致；默认作词 114/694、作曲 115/822）
                          left: `${(openingLyricistPos.x / ASS_PLAY_RES_X) * 100}%`,
                          top: `${(openingLyricistPos.y / ASS_PLAY_RES_Y) * 100}%`,
                          fontSize: `${Math.max(10, openingCreditFontSize * scale)}px`,
                          color: KARAOKE_OPENING_PRIMARY_CSS,
                          textShadow: buildRoundedTextOutlineShadow(
                            Math.max(0, openingCreditOutline * scale),
                            KARAOKE_OPENING_OUTLINE_CSS,
                            [],
                            { fast: captureClean },
                          ),
                          userSelect: 'none',
                          touchAction: 'none',
                          pointerEvents: busyAny ? 'none' : 'auto',
                          cursor: busyAny
                            ? 'default'
                            : draggingSlot === 'lyricist'
                              ? 'grabbing'
                              : 'grab',
                        }}
                        onPointerDown={(e) => onSubtitlePointerDown('lyricist', e)}
                        onPointerMove={onSubtitlePointerMove}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        title={tt.dragOpeningHint}
                        aria-label={`${tt.openingLyricistPrefix}${openingLyricist}`}
                      >
                        {tt.openingLyricistPrefix}
                        {openingLyricist}
                      </div>
                      <div
                        className="nodrag absolute font-semibold leading-tight"
                        style={{
                          left: `${(openingComposerPos.x / ASS_PLAY_RES_X) * 100}%`,
                          top: `${(openingComposerPos.y / ASS_PLAY_RES_Y) * 100}%`,
                          fontSize: `${Math.max(10, openingCreditFontSize * scale)}px`,
                          color: KARAOKE_OPENING_PRIMARY_CSS,
                          textShadow: buildRoundedTextOutlineShadow(
                            Math.max(0, openingCreditOutline * scale),
                            KARAOKE_OPENING_OUTLINE_CSS,
                            [],
                            { fast: captureClean },
                          ),
                          userSelect: 'none',
                          touchAction: 'none',
                          pointerEvents: busyAny ? 'none' : 'auto',
                          cursor: busyAny
                            ? 'default'
                            : draggingSlot === 'composer'
                              ? 'grabbing'
                              : 'grab',
                        }}
                        onPointerDown={(e) => onSubtitlePointerDown('composer', e)}
                        onPointerMove={onSubtitlePointerMove}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        title={tt.dragOpeningHint}
                        aria-label={`${tt.openingComposerPrefix}${openingComposer}`}
                      >
                        {tt.openingComposerPrefix}
                        {openingComposer}
                      </div>
                    </div>
                    ) : null}
                  </div>
                ) : null}
                {layoutMode === 'dualAlternate' ? (
                  <>
                    {renderDraggableLine({
                      slot: 'A',
                      pos: posA,
                      line: hasSingableLyrics ? dualPreview.lineA : null,
                      active:
                        hasSingableLyrics &&
                        dualPreview.activeSlot === 'A' &&
                        (dualPreview.singing || dualPreview.awaitingSing),
                      held: hasSingableLyrics && dualPreview.heldA,
                      fadeOpacity: hasSingableLyrics ? dualPreview.fadeA : 1,
                      label: tt.posLabelA,
                    })}
                    {renderDraggableLine({
                      slot: 'B',
                      pos: posB,
                      line: hasSingableLyrics ? dualPreview.lineB : null,
                      active:
                        hasSingableLyrics &&
                        dualPreview.activeSlot === 'B' &&
                        (dualPreview.singing || dualPreview.awaitingSing),
                      held: hasSingableLyrics && dualPreview.heldB,
                      fadeOpacity: hasSingableLyrics ? dualPreview.fadeB : 1,
                      label: tt.posLabelB,
                    })}
                  </>
                ) : (
                  renderDraggableLine({
                    slot: 'A',
                    pos: posA,
                    line: hasSingableLyrics ? singlePreviewLine : null,
                    active: hasSingableLyrics && !singlePreviewHeld,
                    held: hasSingableLyrics && singlePreviewHeld,
                    fadeOpacity: hasSingableLyrics ? singlePreviewFade : 1,
                    label: tt.posLabelA,
                  })
                )}
              </div>
              {/* 中央大播放按钮（暂停时显示；录制时隐藏，避免烧进成片） */}
              {canPlayPreview && !isPlaying && !captureClean ? (
                <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
                  <button
                    type="button"
                    className="nodrag pointer-events-auto flex h-16 w-16 items-center justify-center rounded-full bg-sky-500/90 text-white shadow-lg ring-2 ring-white/30 hover:bg-sky-400 disabled:opacity-40"
                    disabled={busyAny}
                    aria-label={tt.previewPlay}
                    title={tt.previewPlay}
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePreviewPlayback();
                    }}
                  >
                    <Play className="h-8 w-8 ml-0.5" fill="currentColor" />
                  </button>
                </div>
              ) : null}
            </div>
            {/* 字轨 + 播放条：shrink-0 + mt-auto，窗口变高时仍贴预览卡片底 */}
            <div className="mt-auto shrink-0 flex flex-col">
            {/* 通用字幕轨道：整曲时间轴，按真实秒数铺字；可拖块改时序 / Ctrl+滚轮缩放 */}
            {editableSingableLines.length > 0 || charBarMediaDuration > 0.2 ? (
              <div
                className={`shrink-0 px-3 pt-2 pb-1 border-t border-white/10 ${
                  previewFullscreen ? 'bg-black/90' : 'bg-black/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  {lineTextEdit ? (
                    <span className="text-[10px] text-white/55 font-medium truncate min-w-0">
                      编辑歌词（回车保存 · Esc 取消）
                    </span>
                  ) : charInsertEdit ? (
                    <span className="text-[10px] text-white/55 font-medium truncate min-w-0">
                      插入字（回车确认 · Esc 取消）
                    </span>
                  ) : (
                    <span className="text-[10px] text-white/55 font-medium truncate min-w-0">
                      {tt.charTimingBarLabel}
                      <span className="ml-2 tabular-nums text-white/35">
                        {formatPreviewClock(charBarRange.fullLo)} – {formatPreviewClock(charBarRange.fullHi)}
                      </span>
                    </span>
                  )}
                </div>
                {lineTextEdit ? (
                  <input
                    ref={lineTextEditInputRef}
                    type="text"
                    className="nodrag w-full h-11 min-h-[2.75rem] rounded-md bg-black/50 px-3 text-base font-medium text-white ring-1 ring-sky-400/50 outline-none focus:ring-sky-300"
                    value={lineTextEdit.draft}
                    disabled={busyAny}
                    onChange={(e) => {
                      const draft = e.target.value;
                      setLineTextEdit((prev) => {
                        if (!prev) return prev;
                        const nextEdit = { ...prev, draft };
                        lineTextEditRef.current = nextEdit;
                        return nextEdit;
                      });
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitLineTextEdit();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelLineTextEdit();
                      }
                    }}
                    onBlur={() => {
                      const draft = String(lineTextEditRef.current?.draft || '').trim();
                      if (draft) commitLineTextEdit();
                      else cancelLineTextEdit();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  />
                ) : (() => {
                  const { fullLo, fullSpan } = charBarRange;
                  const viewSpan = karaokeCharBarVisibleSpan(fullSpan, charBarZoom);
                  const maxPan = Math.max(0, fullSpan - viewSpan);
                  const canPan = maxPan > 1e-4;
                  const panSec = canPan
                    ? Math.min(maxPan, Math.max(0, charBarPanSec))
                    : 0;
                  const viewLo = fullLo + panSec;
                  const charCount = editableSingableLines.reduce(
                    (n, l) => n + (l.chars?.length || 0),
                    0,
                  );
                  charBarViewRef.current = {
                    fullLo,
                    fullSpan,
                    viewLo,
                    viewSpan,
                    maxPan,
                    canPan,
                    charCount,
                  };
                  const toPct = (sec: number) =>
                    ((sec - viewLo) / Math.max(1e-6, viewSpan)) * 100;
                  const playStored = playTime - globalOff;
                  const playPct = Math.max(0, Math.min(100, toPct(playStored)));
                  const thumbWPct = canPan
                    ? Math.max(8, (viewSpan / fullSpan) * 100)
                    : 100;
                  const thumbLeftPct =
                    canPan && maxPan > 0
                      ? (panSec / maxPan) * (100 - thumbWPct)
                      : 0;
                  const dual = layoutMode === 'dualAlternate';
                  const laneA = dual
                    ? karaokeLinesForDualSlot(editableSingableLines, 'A')
                    : editableSingableLines;
                  const laneB = dual
                    ? karaokeLinesForDualSlot(editableSingableLines, 'B')
                    : [];
                  return (
                    <div ref={charBarShellRef} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 tabular-nums text-[10px] text-white/40 w-10 text-right">
                          {formatPreviewClock(viewLo)}
                        </span>
                        <div
                          className={`nodrag relative h-3 flex-1 rounded-full bg-white/10 ring-1 ${
                            canPan
                              ? 'ring-sky-400/35 cursor-pointer'
                              : 'ring-white/10'
                          }`}
                          title={canPan ? tt.charTimingBarPan : undefined}
                          aria-label={tt.charTimingBarPan}
                          role="scrollbar"
                          aria-orientation="horizontal"
                          aria-controls="karaoke-char-timing-bar"
                          aria-valuemin={0}
                          aria-valuemax={maxPan}
                          aria-valuenow={panSec}
                          aria-disabled={!canPan}
                          onPointerDown={
                            canPan ? onCharBarScrollTrackPointerDown : undefined
                          }
                        >
                          <div
                            data-char-bar-thumb="1"
                            className={`absolute top-0.5 bottom-0.5 rounded-full shadow-sm ring-1 ring-white/25 touch-none ${
                              canPan
                                ? 'bg-sky-400/65 hover:bg-sky-300/80 active:bg-sky-300/95 cursor-grab active:cursor-grabbing'
                                : 'bg-white/20 pointer-events-none'
                            }`}
                            style={{
                              left: `${thumbLeftPct}%`,
                              width: `${thumbWPct}%`,
                              minWidth: canPan ? 28 : undefined,
                            }}
                            onPointerDown={
                              canPan ? onCharBarPanPointerDown : undefined
                            }
                            onPointerMove={
                              canPan ? onCharBarPanPointerMove : undefined
                            }
                            onPointerUp={canPan ? onCharBarPanPointerUp : undefined}
                            onPointerCancel={
                              canPan ? onCharBarPanPointerUp : undefined
                            }
                          />
                        </div>
                        <span className="shrink-0 tabular-nums text-[10px] text-white/40 w-10">
                          {formatPreviewClock(viewLo + viewSpan)}
                        </span>
                      </div>
                      <div id="karaoke-char-timing-bar" className="space-y-1">
                        {dual ? (
                          <>
                            <div className="flex items-stretch gap-1.5">
                              <span className="shrink-0 w-8 self-center text-[10px] text-white/45">
                                {tt.charTimingTrackA}
                              </span>
                              <div className="min-w-0 flex-1" ref={charBarRef}>
                                {renderGenericCharLane(laneA, 'A', viewLo, viewSpan, toPct, playPct)}
                              </div>
                            </div>
                            <div className="flex items-stretch gap-1.5">
                              <span className="shrink-0 w-8 self-center text-[10px] text-white/45">
                                {tt.charTimingTrackB}
                              </span>
                              <div className="min-w-0 flex-1">
                                {renderGenericCharLane(laneB, 'B', viewLo, viewSpan, toPct, playPct)}
                              </div>
                            </div>
                          </>
                        ) : (
                          <div ref={charBarRef}>
                            {renderGenericCharLane(laneA, 'all', viewLo, viewSpan, toPct, playPct)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
                {charBarCtxMenu
                  ? createPortal(
                      <div
                        data-karaoke-char-ctx="1"
                        className="fixed z-[99999] min-w-[9.5rem] rounded-lg border border-white/15 bg-[#1a1d24]/95 py-1 shadow-xl backdrop-blur-sm"
                        style={{
                          left: Math.min(
                            charBarCtxMenu.x,
                            (typeof window !== 'undefined'
                              ? window.innerWidth
                              : 800) - 160,
                          ),
                          top: Math.min(
                            charBarCtxMenu.y,
                            (typeof window !== 'undefined'
                              ? window.innerHeight
                              : 600) - 260,
                          ),
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onContextMenu={(e) => e.preventDefault()}
                      >
                        {charBarCtxMenu.kind === 'empty' ? (
                          <>
                          <button
                            type="button"
                            disabled={busyAny}
                            className="nodrag flex w-full items-center px-3 py-1.5 text-left text-[12px] text-white/90 hover:bg-white/10 disabled:opacity-35"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const t = charBarCtxMenu.clickTimeSec;
                              setCharBarCtxMenu(null);
                              beginAddSentenceAtTime(t);
                            }}
                          >
                            {tt.charTimingCtxInsertSentence}
                          </button>
                          <button
                            type="button"
                            disabled={busyAny}
                            className="nodrag flex w-full items-center px-3 py-1.5 text-left text-[12px] text-white/90 hover:bg-white/10 disabled:opacity-35"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const t = charBarCtxMenu.clickTimeSec;
                              const lane = charBarCtxMenu.lane;
                              setCharBarCtxMenu(null);
                              beginAddCharAtTime(t, lane);
                            }}
                          >
                            {tt.charTimingCtxInsert}
                          </button>
                          {layoutMode === 'dualAlternate' &&
                          charBarSelection.length > 0 &&
                          (charBarCtxMenu.lane === 'A' || charBarCtxMenu.lane === 'B') ? (
                            <button
                              type="button"
                              disabled={busyAny}
                              className="nodrag flex w-full items-center px-3 py-1.5 text-left text-[12px] text-white/90 hover:bg-white/10 disabled:opacity-35"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const lane = charBarCtxMenu.lane;
                                const sels = charBarSelectionRef.current.slice();
                                setCharBarCtxMenu(null);
                                if (lane === 'A' || lane === 'B') {
                                  moveCharsToDualTrack(sels, lane);
                                }
                              }}
                            >
                              {charBarCtxMenu.lane === 'A'
                                ? tt.charTimingCtxAddUpper
                                : tt.charTimingCtxAddLower}
                            </button>
                          ) : null}
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={busyAny}
                              className="nodrag flex w-full items-center px-3 py-1.5 text-left text-[12px] text-white/90 hover:bg-white/10 disabled:opacity-35"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const { lineId, charIndex } = charBarCtxMenu;
                                setCharBarCtxMenu(null);
                                const line = (projectRef.current.lines || []).find(
                                  (l) => l.id === lineId,
                                );
                                const ch = line?.chars?.[charIndex];
                                const prev = line?.chars?.[charIndex - 1];
                                const preferSec = ch
                                  ? prev
                                    ? (Number(prev.endSec) + Number(ch.startSec)) / 2
                                    : Number(ch.startSec) || 0
                                  : undefined;
                                beginCharInsertEdit(lineId, charIndex, preferSec);
                              }}
                            >
                              {tt.charTimingCtxInsertBefore}
                            </button>
                            <button
                              type="button"
                              disabled={busyAny}
                              className="nodrag flex w-full items-center px-3 py-1.5 text-left text-[12px] text-white/90 hover:bg-white/10 disabled:opacity-35"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const { lineId, charIndex } = charBarCtxMenu;
                                setCharBarCtxMenu(null);
                                const line = (projectRef.current.lines || []).find(
                                  (l) => l.id === lineId,
                                );
                                const ch = line?.chars?.[charIndex];
                                const nxt = line?.chars?.[charIndex + 1];
                                const preferSec = ch
                                  ? nxt
                                    ? (Number(ch.endSec) + Number(nxt.startSec)) / 2
                                    : Number(ch.endSec) || 0
                                  : undefined;
                                beginCharInsertEdit(lineId, charIndex + 1, preferSec);
                              }}
                            >
                              {tt.charTimingCtxInsertAfter}
                            </button>
                            {layoutMode === 'dualAlternate' ? (
                              <>
                                <div className="my-1 border-t border-white/10" />
                                <button
                                  type="button"
                                  disabled={busyAny || !dualTrackInsertAvailable.A}
                                  className="nodrag flex w-full items-center px-3 py-1.5 text-left text-[12px] text-white/90 hover:bg-white/10 disabled:opacity-35"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const { lineId, charIndex } = charBarCtxMenu;
                                    const sels =
                                      charBarSelectionRef.current.length > 1
                                        ? charBarSelectionRef.current.slice()
                                        : [{ lineId, charIndex }];
                                    setCharBarCtxMenu(null);
                                    moveCharsToDualTrack(sels, 'A');
                                  }}
                                >
                                  {tt.charTimingCtxAddUpper}
                                </button>
                                <button
                                  type="button"
                                  disabled={busyAny || !dualTrackInsertAvailable.B}
                                  className="nodrag flex w-full items-center px-3 py-1.5 text-left text-[12px] text-white/90 hover:bg-white/10 disabled:opacity-35"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const { lineId, charIndex } = charBarCtxMenu;
                                    const sels =
                                      charBarSelectionRef.current.length > 1
                                        ? charBarSelectionRef.current.slice()
                                        : [{ lineId, charIndex }];
                                    setCharBarCtxMenu(null);
                                    moveCharsToDualTrack(sels, 'B');
                                  }}
                                >
                                  {tt.charTimingCtxAddLower}
                                </button>
                              </>
                            ) : null}
                            <div className="my-1 border-t border-white/10" />
                            <button
                              type="button"
                              disabled={busyAny}
                              className="nodrag flex w-full items-center px-3 py-1.5 text-left text-[12px] text-rose-300/95 hover:bg-white/10 disabled:opacity-35"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const { lineId, charIndex } = charBarCtxMenu;
                                setCharBarCtxMenu(null);
                                deleteSelectedChar(lineId, charIndex);
                              }}
                            >
                              {tt.charTimingDeleteChar}
                            </button>
                          </>
                        )}
                      </div>,
                      document.body,
                    )
                  : null}
              </div>
            ) : null}
            {/* 底部控件条：播放/暂停 + 进度 seek + 时间 + 全屏 */}
            <div
              className={`shrink-0 px-3 py-2 border-t border-white/10 space-y-1.5 ${
                previewFullscreen ? 'bg-black/90' : 'bg-black/50'
              }`}
            >
              <div
                ref={seekBarRef}
                className={`nodrag relative h-4 flex items-center ${
                  canPlayPreview && !busyAny ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'
                }`}
                onPointerDown={onSeekBarPointerDown}
                onPointerMove={onSeekBarPointerMove}
                onPointerUp={onSeekBarPointerUp}
                onPointerCancel={onSeekBarPointerUp}
                role="slider"
                aria-valuemin={0}
                aria-valuemax={mediaDuration || 0}
                aria-valuenow={playTime}
                aria-label={tt.previewSection}
              >
                <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/15" />
                <div
                  className="pointer-events-none absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full bg-sky-400/90"
                  style={{ width: `${seekBarPct}%` }}
                />
                <div
                  className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-300 shadow-md ring-2 ring-white/85"
                  style={{ left: `${seekBarPct}%` }}
                  aria-hidden
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="nodrag flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20 disabled:opacity-40"
                  disabled={!canPlayPreview || busyAny}
                  aria-label={isPlaying ? tt.previewPause : tt.previewPlay}
                  title={isPlaying ? tt.previewPause : tt.previewPlay}
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePreviewPlayback();
                  }}
                >
                  {isPlaying ? (
                    <Pause className="h-4 w-4" fill="currentColor" />
                  ) : (
                    <Play className="h-4 w-4 ml-0.5" fill="currentColor" />
                  )}
                </button>
                <span className="text-[11px] tabular-nums text-white/70 min-w-[5.5rem] flex-1">
                  {formatPreviewClock(playTime)} / {formatPreviewClock(mediaDuration)}
                </span>
                <button
                  type="button"
                  className="nodrag relative z-30 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20 pointer-events-auto"
                  aria-label={previewFullscreen ? tt.previewExitFullscreen : tt.previewFullscreen}
                  title={previewFullscreen ? tt.previewExitFullscreen : tt.previewFullscreen}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    togglePreviewFullscreen();
                  }}
                >
                  {previewFullscreen ? (
                    <Minimize2 className="h-4 w-4" strokeWidth={2} />
                  ) : (
                    <Maximize2 className="h-4 w-4" strokeWidth={2} />
                  )}
                </button>
              </div>
            </div>
            </div>
          </div>
            );
            return previewFullscreen ? createPortal(previewCard, document.body) : previewCard;
          })()}
        </div>

        {/* 右：控件（宽屏仅此栏在极矮时可滚） */}
        <div className="w-full md:w-[340px] md:max-w-[38%] shrink-0 min-h-0 self-stretch md:overflow-y-auto overscroll-contain custom-scrollbar-dark px-3 py-3 md:pl-1 space-y-2.5 text-left">
          {showVideoSourceActions ? (
            <div>
              <div className="text-xs text-white/60 mb-1">{tt.videoSourceSection}</div>
              <div className="flex flex-wrap gap-1.5">
                {onImportComposeVideo ? (
                  <button
                    type="button"
                    disabled={busyAny || !!videoSourceBusy}
                    title={tt.importComposeVideoHint}
                    className="nodrag inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs ring-1 bg-sky-500/20 text-sky-100 ring-sky-400/35 hover:bg-sky-500/30 disabled:opacity-40"
                    onClick={() => onImportComposeVideo()}
                  >
                    {videoSourceBusy === 'import' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Scissors className="h-3.5 w-3.5" />
                    )}
                    {videoSourceBusy === 'import'
                      ? tt.importComposeVideoRunning
                      : tt.importComposeVideo}
                  </button>
                ) : null}
                {onPickLocalVideo ? (
                  <button
                    type="button"
                    disabled={busyAny || videoSourceBusy === 'upload'}
                    title={tt.uploadLocalVideoHint}
                    className="nodrag inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs ring-1 bg-black/30 text-white/80 ring-white/12 hover:bg-white/[0.08] disabled:opacity-40"
                    onClick={() => onPickLocalVideo()}
                  >
                    {videoSourceBusy === 'upload' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    {videoSourceBusy === 'upload'
                      ? tt.uploadLocalVideoRunning
                      : tt.uploadLocalVideo}
                  </button>
                ) : null}
                {onClearVideo && hasVideoPreview ? (
                  <button
                    type="button"
                    disabled={busyAny || !!videoSourceBusy}
                    title={tt.clearVideoHint}
                    className="nodrag inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs ring-1 bg-black/20 text-white/55 ring-white/10 hover:bg-white/[0.06] hover:text-white/80 disabled:opacity-40"
                    onClick={() => onClearVideo()}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {tt.clearVideo}
                  </button>
                ) : null}
              </div>
              <p className="mt-1.5 text-[10px] text-white/40 leading-snug">
                {videoSourceBusy === 'upload'
                  ? tt.uploadLocalVideoRunning
                  : videoSourceBusy === 'import'
                    ? tt.importComposeVideoRunning
                    : hasVideoPreview
                      ? tt.videoReady
                      : tt.videoEmptyHint}
              </p>
            </div>
          ) : null}

          <div>
            <div className="text-xs text-white/60 mb-1">{tt.audioSourceSection}</div>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ['video', tt.audioSourceVideo, canUseVideoAudio, tt.audioSourceVideoUnavailable],
                  ['song', tt.audioSourceSong, canUseSongAudio, tt.audioSourceSongUnavailable],
                ] as const
              ).map(([key, label, enabled, unavailable]) => (
                <button
                  key={key}
                  type="button"
                  disabled={busyAny || !enabled}
                  title={!enabled ? unavailable : label}
                  className={`nodrag rounded-lg px-2.5 py-1 text-xs ring-1 transition-colors ${
                    audioSource === key
                      ? 'bg-sky-500/25 text-sky-100 ring-sky-400/40'
                      : enabled
                        ? 'bg-black/30 text-white/65 ring-white/10 hover:bg-white/[0.06]'
                        : 'bg-black/20 text-white/30 ring-white/5 cursor-not-allowed'
                  }`}
                  onClick={() => {
                    const nextSource = key as KaraokeAudioSource;
                    if (nextSource === projectRef.current.audioSource) return;
                    persist({
                      ...projectRef.current,
                      audioSource: nextSource,
                      updatedAt: Date.now(),
                    });
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <label
              className="mt-2 flex items-center gap-2 cursor-pointer select-none"
              title={tt.previewOpeningCreditsHint}
            >
              <input
                type="checkbox"
                className="nodrag"
                checked={project.previewOpeningCredits !== false}
                disabled={busyAny}
                onChange={(e) => {
                  persist({
                    ...projectRef.current,
                    previewOpeningCredits: e.target.checked,
                    updatedAt: Date.now(),
                  });
                }}
              />
              <span className="text-[11px] text-white/70 leading-snug">
                {tt.previewOpeningCredits}
              </span>
            </label>
          </div>

          <div>
            <div className="text-xs text-white/60 mb-1">{tt.asrLanguageSection}</div>
            <div className="flex flex-wrap gap-1.5">
              {KARAOKE_ASR_LANGUAGE_OPTIONS.map((key) => {
                const label =
                  key === 'zh'
                    ? tt.asrLanguageZh
                    : key === 'yue'
                      ? tt.asrLanguageYue
                      : tt.asrLanguageAuto;
                const current = normalizeKaraokeAsrLanguage(project.asrLanguage);
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={busyAny}
                    title={label}
                    className={`nodrag rounded-lg px-2.5 py-1 text-xs ring-1 transition-colors ${
                      current === key
                        ? 'bg-violet-500/25 text-violet-100 ring-violet-400/40'
                        : 'bg-black/30 text-white/65 ring-white/10 hover:bg-white/[0.06]'
                    }`}
                    onClick={() => {
                      const nextLang = key as KaraokeAsrLanguage;
                      if (normalizeKaraokeAsrLanguage(projectRef.current.asrLanguage) === nextLang) {
                        return;
                      }
                      persist({
                        ...projectRef.current,
                        asrLanguage: nextLang,
                        updatedAt: Date.now(),
                      });
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 开唱倒计时蓝点暂关闭：默认/打开编辑器均强制 off；预览与 ASS 不输出 */}

          <div>
            <div className="text-xs text-white/60 mb-1">{tt.styleLayout}</div>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ['single', tt.layoutSingle],
                  ['dualAlternate', tt.layoutDual],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  disabled={busyAny}
                  className={`nodrag rounded-lg px-2.5 py-1 text-xs ring-1 transition-colors ${
                    layoutMode === key
                      ? 'bg-sky-500/25 text-sky-100 ring-sky-400/40'
                      : 'bg-black/30 text-white/65 ring-white/10 hover:bg-white/[0.06]'
                  }`}
                  onClick={() => setLayoutMode(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            disabled={busyAny}
            className="nodrag w-full rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 ring-sky-400/35 bg-sky-500/20 text-sky-100 hover:bg-sky-500/30 transition-colors disabled:opacity-50"
            onClick={restoreStyleDefaults}
          >
            {tt.restoreStyleDefaults}
          </button>

          <div className="rounded-xl bg-white/[0.03] ring-1 ring-white/10 overflow-hidden">
            <button
              type="button"
              className="nodrag flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-white/[0.04] transition-colors"
              aria-expanded={advancedSettingsOpen}
              onClick={() => setAdvancedSettingsOpen((v) => !v)}
            >
              <span className="text-xs text-white/75 font-medium">{tt.advancedSettings}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 text-white/45 transition-transform duration-200 ${
                  advancedSettingsOpen ? 'rotate-180' : ''
                }`}
                strokeWidth={2.25}
                aria-hidden
              />
            </button>

            {advancedSettingsOpen ? (
              <div className="space-y-2.5 border-t border-white/8 px-3 py-2.5">
            <div className="text-xs text-white/70 font-medium">{tt.styleSection}</div>

            {/* 开场/歌词坐标：拖动预览时随 style 实时更新 */}
            <div
              className="rounded-lg bg-black/35 ring-1 ring-white/[0.07] px-2.5 py-1.5 space-y-0.5"
              title={tt.dragOpeningHint}
            >
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-white/75 tabular-nums leading-snug">
                <span>
                  {tt.posCoordTitle}{' '}
                  <span className="text-sky-200/90">
                    {Math.round(openingTitlePos.x)}, {Math.round(openingTitlePos.y)}
                  </span>
                </span>
                <span>
                  {tt.posCoordLyricist}{' '}
                  <span className="text-sky-200/90">
                    {Math.round(openingLyricistPos.x)}, {Math.round(openingLyricistPos.y)}
                  </span>
                </span>
                <span>
                  {tt.posCoordComposer}{' '}
                  <span className="text-sky-200/90">
                    {Math.round(openingComposerPos.x)}, {Math.round(openingComposerPos.y)}
                  </span>
                </span>
                <span>
                  {tt.posCoordCountdown}{' '}
                  <span className="text-sky-200/90">
                    {Math.round(countdownGroupAnchorPos.x)}, {Math.round(countdownGroupAnchorPos.y)}
                  </span>
                  <span className="ml-1 text-[10px] text-white/40">
                    · {countdown.spacing}
                  </span>
                </span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-white/40 tabular-nums leading-snug">
                <span>
                  {tt.posCoordLyricA}{' '}
                  <span className="text-white/55">
                    {Math.round(posA.x)}, {Math.round(posA.y)}
                  </span>
                </span>
                {layoutMode === 'dualAlternate' ? (
                  <span>
                    {tt.posCoordLyricB}{' '}
                    <span className="text-white/55">
                      {Math.round(posB.x)}, {Math.round(posB.y)}
                    </span>
                  </span>
                ) : null}
              </div>
            </div>

            <label className="block text-xs text-white/60" title={tt.interludeClearGapHint}>
              <span className="flex justify-between gap-2">
                <span>{tt.interludeClearGap}</span>
                <span className="tabular-nums text-white/45">{interludeClearGapSec}s</span>
              </span>
              <KaraokeRangeSlider
                min={KARAOKE_INTERLUDE_CLEAR_GAP_SEC_MIN}
                max={KARAOKE_INTERLUDE_CLEAR_GAP_SEC_MAX}
                step={1}
                value={interludeClearGapSec}
                disabled={busyAny}
                aria-label={tt.interludeClearGap}
                onChange={(v) => {
                  const clear = clampKaraokeInterludeClearGapSec(v);
                  const reentry = Math.max(
                    clear,
                    clampKaraokeCountdownReentryGapSec(countdownReentryGapSec),
                  );
                  patchStyle({
                    interludeClearGapSec: clear,
                    countdownReentryGapSec: Math.min(
                      KARAOKE_COUNTDOWN_REENTRY_GAP_SEC_MAX,
                      reentry,
                    ),
                  });
                }}
              />
            </label>

            <label className="block text-xs text-white/60" title={tt.countdownReentryGapHint}>
              <span className="flex justify-between gap-2">
                <span>{tt.countdownReentryGap}</span>
                <span className="tabular-nums text-white/45">{countdownReentryGapSec}s</span>
              </span>
              <KaraokeRangeSlider
                min={Math.max(KARAOKE_COUNTDOWN_REENTRY_GAP_SEC_MIN, interludeClearGapSec)}
                max={KARAOKE_COUNTDOWN_REENTRY_GAP_SEC_MAX}
                step={1}
                value={countdownReentryGapSec}
                disabled={busyAny}
                aria-label={tt.countdownReentryGap}
                onChange={(v) =>
                  patchStyle({
                    countdownReentryGapSec: Math.max(
                      interludeClearGapSec,
                      clampKaraokeCountdownReentryGapSec(v),
                    ),
                  })
                }
              />
            </label>

            <label className="block text-xs text-white/60" title={tt.countdownLeadInMaxHint}>
              <span className="flex justify-between gap-2">
                <span>{tt.countdownLeadInMax}</span>
                <span className="tabular-nums text-white/45">{countdownLeadInMaxSec}s</span>
              </span>
              <KaraokeRangeSlider
                min={KARAOKE_COUNTDOWN_LEAD_IN_MAX_SEC_MIN}
                max={KARAOKE_COUNTDOWN_LEAD_IN_MAX_SEC_MAX}
                step={1}
                value={countdownLeadInMaxSec}
                disabled={busyAny}
                aria-label={tt.countdownLeadInMax}
                onChange={(v) =>
                  patchStyle({
                    countdownLeadInMaxSec: clampKaraokeCountdownLeadInMaxSec(v),
                  })
                }
              />
            </label>

            <label className="block text-xs text-white/60" title={tt.countdownDotSizeHint}>
              <span className="flex justify-between gap-2">
                <span>{tt.countdownDotSize}</span>
                <span className="tabular-nums text-white/45">{countdown.size}</span>
              </span>
              <KaraokeRangeSlider
                min={KARAOKE_COUNTDOWN_DOT_SIZE_MIN}
                max={KARAOKE_COUNTDOWN_DOT_SIZE_MAX}
                step={1}
                value={countdown.size}
                disabled={busyAny}
                aria-label={tt.countdownDotSize}
                onChange={(size) =>
                  patchStyle({
                    countdown: {
                      ...style.countdown,
                      size: size || KARAOKE_COUNTDOWN_DOT_SIZE_DEFAULT,
                    },
                  })
                }
              />
            </label>

            <label className="block text-xs text-white/60" title={tt.countdownDotSpacingHint}>
              <span className="flex justify-between gap-2">
                <span>{tt.countdownDotSpacing}</span>
                <span className="tabular-nums text-white/45">{countdown.spacing}</span>
              </span>
              <KaraokeRangeSlider
                min={KARAOKE_COUNTDOWN_SPACING_MIN}
                max={KARAOKE_COUNTDOWN_SPACING_MAX}
                step={1}
                value={countdown.spacing}
                disabled={busyAny}
                aria-label={tt.countdownDotSpacing}
                onChange={(spacing) =>
                  patchStyle({
                    countdown: {
                      ...style.countdown,
                      spacing: clampKaraokeCountdownSpacing(
                        spacing || KARAOKE_COUNTDOWN_SPACING_DEFAULT,
                      ),
                    },
                  })
                }
              />
            </label>

            <label className="block text-xs text-white/60">
              <span className="flex justify-between gap-2">
                <span>{tt.styleFontSize}</span>
                <span className="tabular-nums text-white/45">{style.fontSize}</span>
              </span>
              <KaraokeRangeSlider
                min={24}
                max={128}
                step={1}
                value={Number(style.fontSize) || DEFAULT_KARAOKE_STYLE.fontSize}
                disabled={busyAny}
                aria-label={tt.styleFontSize}
                onChange={(fontSize) =>
                  patchStyle({ fontSize: fontSize || DEFAULT_KARAOKE_STYLE.fontSize })
                }
              />
            </label>

            <label className="block text-xs text-white/60">
              <span className="flex justify-between gap-2">
                <span>{tt.openingTitleFontSize}</span>
                <span className="tabular-nums text-white/45">{openingTitleFontSize}</span>
              </span>
              <KaraokeRangeSlider
                min={KARAOKE_OPENING_TITLE_FONT_SIZE_MIN}
                max={KARAOKE_OPENING_TITLE_FONT_SIZE_MAX}
                step={1}
                value={openingTitleFontSize}
                disabled={busyAny}
                aria-label={tt.openingTitleFontSize}
                onChange={(v) =>
                  patchStyle({
                    openingTitleFontSize: clampKaraokeOpeningTitleFontSize(
                      v || KARAOKE_OPENING_TITLE_FONT_SIZE,
                    ),
                  })
                }
              />
            </label>

            <label className="block text-xs text-white/60">
              <span className="flex justify-between gap-2">
                <span>{tt.openingCreditFontSize}</span>
                <span className="tabular-nums text-white/45">{openingCreditFontSize}</span>
              </span>
              <KaraokeRangeSlider
                min={KARAOKE_OPENING_CREDIT_FONT_SIZE_MIN}
                max={KARAOKE_OPENING_CREDIT_FONT_SIZE_MAX}
                step={1}
                value={openingCreditFontSize}
                disabled={busyAny}
                aria-label={tt.openingCreditFontSize}
                onChange={(v) =>
                  patchStyle({
                    openingCreditFontSize: clampKaraokeOpeningCreditFontSize(
                      v || KARAOKE_OPENING_CREDIT_FONT_SIZE,
                    ),
                  })
                }
              />
            </label>

            <label className="block text-xs text-white/60">
              <span className="flex justify-between gap-2">
                <span>{tt.styleUnsungOutlineWidth}</span>
                <span className="tabular-nums text-white/45">{lyricOutline}</span>
              </span>
              <KaraokeRangeSlider
                min={KARAOKE_OUTLINE_MIN}
                max={KARAOKE_OUTLINE_MAX}
                step={0.5}
                value={lyricOutline}
                disabled={busyAny}
                aria-label={tt.styleUnsungOutlineWidth}
                onChange={(v) =>
                  patchStyle({
                    outline: clampKaraokeOutline(v, KARAOKE_LYRIC_OUTLINE_DEFAULT),
                  })
                }
              />
            </label>

            <label className="block text-xs text-white/60">
              <span className="flex justify-between gap-2">
                <span>{tt.styleSungOutlineWidth}</span>
                <span className="tabular-nums text-white/45">{lyricSungOutline}</span>
              </span>
              <KaraokeRangeSlider
                min={KARAOKE_OUTLINE_MIN}
                max={KARAOKE_OUTLINE_MAX}
                step={0.5}
                value={lyricSungOutline}
                disabled={busyAny}
                aria-label={tt.styleSungOutlineWidth}
                onChange={(v) =>
                  patchStyle({
                    sungOutlineWidth: clampKaraokeOutline(v, KARAOKE_LYRIC_SUNG_OUTLINE_DEFAULT),
                  })
                }
              />
            </label>

            <label className="block text-xs text-white/60">
              <span className="flex justify-between gap-2">
                <span>{tt.styleTitleOutline}</span>
                <span className="tabular-nums text-white/45">{openingTitleOutline}</span>
              </span>
              <KaraokeRangeSlider
                min={KARAOKE_OUTLINE_MIN}
                max={KARAOKE_OUTLINE_MAX}
                step={0.5}
                value={openingTitleOutline}
                disabled={busyAny}
                aria-label={tt.styleTitleOutline}
                onChange={(v) =>
                  patchStyle({
                    openingTitleOutline: clampKaraokeOutline(v, KARAOKE_OPENING_TITLE_OUTLINE),
                  })
                }
              />
            </label>

            <label className="block text-xs text-white/60">
              <span className="flex justify-between gap-2">
                <span>{tt.styleCreditOutline}</span>
                <span className="tabular-nums text-white/45">{openingCreditOutline}</span>
              </span>
              <KaraokeRangeSlider
                min={KARAOKE_OUTLINE_MIN}
                max={KARAOKE_OUTLINE_MAX}
                step={0.5}
                value={openingCreditOutline}
                disabled={busyAny}
                aria-label={tt.styleCreditOutline}
                onChange={(v) =>
                  patchStyle({
                    openingCreditOutline: clampKaraokeOutline(v, KARAOKE_OPENING_CREDIT_OUTLINE),
                  })
                }
              />
            </label>
            <label className="block text-xs text-white/60">
              <span>{tt.styleFont}</span>
              <select
                className={fieldCls}
                value={fontSelect}
                disabled={busyAny}
                onChange={(e) => {
                  const v = e.target.value;
                  setFontSelect(v);
                  if (v === FONT_CUSTOM) return;
                  patchStyle({ fontName: v });
                }}
              >
                {KARAOKE_FONT_PRESETS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {locale === 'en' ? f.labelEn : f.labelZh}
                  </option>
                ))}
                <option value={FONT_CUSTOM}>{tt.styleFontCustom}</option>
              </select>
            </label>

            {fontSelect === FONT_CUSTOM ? (
              <label className="block text-xs text-white/60">
                <span>{tt.styleFontCustom}</span>
                <input
                  type="text"
                  className={fieldCls}
                  placeholder={tt.styleFontCustomPlaceholder}
                  value={style.fontName}
                  disabled={busyAny}
                  onChange={(e) => patchStyle({ fontName: e.target.value })}
                />
              </label>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-white/60">
                <span>{tt.styleUnsungColor}</span>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="color"
                    className="nodrag h-8 w-10 cursor-pointer rounded border border-white/15 bg-transparent"
                    value={unsungCss}
                    disabled={busyAny}
                    onChange={(e) =>
                      patchStyle({ unsungColor: cssHexToAssBgr(e.target.value, DEFAULT_KARAOKE_STYLE.unsungColor) })
                    }
                  />
                  <span className="tabular-nums text-[10px] text-white/40">{unsungCss}</span>
                </div>
              </label>
              <label className="block text-xs text-white/60">
                <span>{tt.styleRoleColorMale}</span>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="color"
                    className="nodrag h-8 w-10 cursor-pointer rounded border border-white/15 bg-transparent"
                    value={roleMaleCss}
                    disabled={busyAny}
                    onChange={(e) =>
                      patchStyle({
                        roleColors: {
                          ...roleColors,
                          male: cssHexToAssBgr(e.target.value, DEFAULT_KARAOKE_STYLE.roleColors.male),
                        },
                      })
                    }
                  />
                  <span className="tabular-nums text-[10px] text-white/40">{roleMaleCss}</span>
                </div>
              </label>
              <label className="block text-xs text-white/60">
                <span>{tt.styleRoleColorFemale}</span>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="color"
                    className="nodrag h-8 w-10 cursor-pointer rounded border border-white/15 bg-transparent"
                    value={roleFemaleCss}
                    disabled={busyAny}
                    onChange={(e) =>
                      patchStyle({
                        roleColors: {
                          ...roleColors,
                          female: cssHexToAssBgr(e.target.value, DEFAULT_KARAOKE_STYLE.roleColors.female),
                        },
                      })
                    }
                  />
                  <span className="tabular-nums text-[10px] text-white/40">{roleFemaleCss}</span>
                </div>
              </label>
              <label className="block text-xs text-white/60">
                <span>{tt.styleRoleColorChorus}</span>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="color"
                    className="nodrag h-8 w-10 cursor-pointer rounded border border-white/15 bg-transparent"
                    value={roleChorusCss}
                    disabled={busyAny}
                    onChange={(e) =>
                      patchStyle({
                        roleColors: {
                          ...roleColors,
                          chorus: cssHexToAssBgr(e.target.value, DEFAULT_KARAOKE_STYLE.roleColors.chorus),
                        },
                      })
                    }
                  />
                  <span className="tabular-nums text-[10px] text-white/40">{roleChorusCss}</span>
                </div>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-white/60">
                <span>{tt.styleUnsungOutlineColor}</span>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="color"
                    className="nodrag h-8 w-10 cursor-pointer rounded border border-white/15 bg-transparent"
                    value={outlineCss}
                    disabled={busyAny}
                    aria-label={tt.styleUnsungOutlineColor}
                    onChange={(e) =>
                      patchStyle({
                        outlineColor: cssHexToAssBgr(e.target.value, DEFAULT_KARAOKE_STYLE.outlineColor),
                      })
                    }
                  />
                  <span className="tabular-nums text-[10px] text-white/40">{outlineCss}</span>
                </div>
              </label>
              <label className="block text-xs text-white/60">
                <span>{tt.styleSungOutlineColor}</span>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="color"
                    className="nodrag h-8 w-10 cursor-pointer rounded border border-white/15 bg-transparent"
                    value={sungOutlineCss}
                    disabled={busyAny}
                    aria-label={tt.styleSungOutlineColor}
                    onChange={(e) =>
                      patchStyle({
                        sungOutlineColor: cssHexToAssBgr(
                          e.target.value,
                          DEFAULT_KARAOKE_STYLE.sungOutlineColor,
                        ),
                      })
                    }
                  />
                  <span className="tabular-nums text-[10px] text-white/40">{sungOutlineCss}</span>
                </div>
              </label>
            </div>
              </div>
            ) : null}
          </div>

          {!window.electronAPI?.karaokeCssBurn &&
          !window.electronAPI?.karaokeBurnSubtitles ? (
            <div className="rounded-lg border border-amber-400/25 bg-amber-500/5 px-3 py-2">
              <p className="text-[10px] text-amber-100/80 leading-relaxed">
                {tt.burnEngineApiMissing}
              </p>
            </div>
          ) : null}

          {!embeddedFontsReady ? (
            <p className="text-xs text-white/45">{tt.fontsLoadingHint}</p>
          ) : null}
          {status ? (
            <p className="text-xs text-emerald-300/90 whitespace-pre-wrap">{status}</p>
          ) : null}
          {error ? <p className="text-xs text-red-300/90 whitespace-pre-wrap">{error}</p> : null}
        </div>
      </div>

      {!hideFooterActions ? (
        <div className={`${darkModalFooterClass} !flex-wrap gap-2 shrink-0 border-t border-white/10 pt-3`}>
          {!hideClose ? (
            <button
              type="button"
              className={darkModalBtnCancelClass}
              onClick={handleClose}
              title={busy === 'burn' ? tt.closeCancelsBurn : tt.close}
            >
              {busy === 'burn' ? tt.cancel : tt.close}
            </button>
          ) : busy === 'burn' ? (
            <button
              type="button"
              className={darkModalBtnCancelClass}
              onClick={handleClose}
              title={tt.closeCancelsBurn}
            >
              {tt.cancel}
            </button>
          ) : null}
          <div className="group relative z-[40] overflow-visible">
            {busy !== 'timing' && busy !== 'asr' ? (
              <span
                className={`${yuanbaoHoverTipAboveCls} opacity-0 transition-opacity group-hover:opacity-100`}
                title={tt.generateTimingPriceTitle}
              >
                {fileTranscribeYuanbaoLabel}
              </span>
            ) : null}
            <button
              type="button"
              className={`${nexflowOrangePillBtnClass} !h-9 !min-h-9 !px-4 !py-0 text-sm min-w-[100px]`}
              style={{ background: nexflowOrangePillBtnBg }}
              disabled={busyAny}
              onClick={() => void handleGenerateTiming()}
              title={
                busy === 'timing' || busy === 'asr'
                  ? undefined
                  : hasTiming
                    ? tt.generateTiming
                    : tt.previewNeedTiming
              }
            >
              {busy === 'timing' || busy === 'asr' ? (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white/90"
                    aria-hidden
                  />
                  {tt.generating}
                </span>
              ) : (
                tt.generateTiming
              )}
            </button>
          </div>
          <button
            type="button"
            className={`${darkModalBtnOkClass} !h-9 !min-h-9 !py-0 box-border`}
            disabled={busyAny}
            onClick={() => void handleRecordPreview()}
            title={tt.recordPreviewHint}
          >
            {busy === 'burn' ? tt.recordPreviewRunning : tt.recordPreviewExport}
          </button>
          <button
            type="button"
            className={`${darkModalBtnCancelClass} !h-9 !min-h-9 !py-0 box-border !text-white/85`}
            disabled={busyAny}
            onClick={() => void handleBurn()}
            title={tt.burnEnginePreviewHint}
          >
            {tt.burnToNode}
          </button>
        </div>
      ) : null}
    </>
  );

  const composeQualityOptions = useMemo(() => {
    const labels: Record<
      KaraokeCssBurnQualityPreset,
      { title: string; desc: string; fpsHint: string }
    > = {
      stable: {
        title: tt.burnQualityStable,
        desc: tt.burnQualityStableDesc,
        fpsHint: 'ASS',
      },
      fast: {
        title: tt.burnQualityFast,
        desc: tt.burnQualityFastDesc,
        fpsHint: `${KARAOKE_CSS_BURN_FAST_FPS}fps`,
      },
      standard: {
        title: tt.burnQualityStandard,
        desc: tt.burnQualityStandardDesc,
        fpsHint: `${KARAOKE_CSS_BURN_STANDARD_FPS}fps`,
      },
      smooth: {
        title: tt.burnQualitySmooth,
        desc: tt.burnQualitySmoothDesc,
        fpsHint: `${KARAOKE_CSS_BURN_FLUID_FPS}fps`,
      },
      hq: {
        title: tt.burnQualityHq,
        desc: tt.burnQualityHqDesc,
        fpsHint: '≥48fps',
      },
    };
    return KARAOKE_CSS_BURN_QUALITY_PRESET_IDS.map((id) => ({
      id,
      ...labels[id],
    }));
  }, [tt]);

  const officeLowSpecMachine = useMemo(() => detectKaraokeLowSpecMachine(), []);
  const showComposeOfficeWarn =
    officeLowSpecMachine &&
    (composeQualityPreset === 'smooth' || composeQualityPreset === 'hq');

  /** 居中 modal：选帧率 / 百分比进度条 + 阶段文案 + 取消（不关编辑器） */
  const composeProgressPortal =
    (composeModalPhase === 'pick' || composeProgressUi) &&
    typeof document !== 'undefined'
      ? createPortal(
          <div
            className={darkModalOverlayClass()}
            style={{ zIndex: KARAOKE_COMPOSE_PROGRESS_Z }}
            role="presentation"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={darkModalPanelSmClass}
              role="dialog"
              aria-modal="true"
              aria-busy={composeModalPhase === 'running'}
              aria-live="polite"
              aria-label={composeProgressTitle || tt.previewComposeRunning}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={darkModalHeaderClass}>
                {composeProgressTitle || tt.previewComposeRunning}
              </div>
              {composeModalPhase === 'pick' ? (
                <div className="px-5 py-5 space-y-3">
                  <div
                    className="grid gap-2"
                    role="radiogroup"
                    aria-label={tt.burnToNode}
                  >
                    {composeQualityOptions.map((opt) => {
                      const selected = composeQualityPreset === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                            selected
                              ? 'border-sky-400/70 bg-sky-500/15'
                              : 'border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]'
                          }`}
                          onClick={() => setComposeQualityPreset(opt.id)}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-sm font-medium text-white/90">
                              {opt.title}
                            </span>
                            <span className="shrink-0 text-[11px] tabular-nums text-white/45">
                              {opt.fpsHint}
                            </span>
                          </div>
                          <div className="mt-0.5 text-[11px] leading-snug text-white/50">
                            {opt.desc}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {showComposeOfficeWarn ? (
                    <p className="text-[11px] leading-relaxed text-amber-200/80">
                      {tt.burnQualityLowSpecWarn}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="px-5 py-5 space-y-4">
                  <div className="flex items-start gap-2.5">
                    <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-sky-400" />
                    <p className="min-w-0 flex-1 text-sm leading-relaxed text-white/85 whitespace-pre-wrap">
                      {composeProgressUi}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] tabular-nums text-white/50">
                      <span>{tt.burning}</span>
                      <span className="text-white/80">{composeProgressPercent}%</span>
                    </div>
                    <div
                      className="h-2 w-full overflow-hidden rounded-full bg-white/10"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={composeProgressPercent}
                    >
                      <div
                        className="h-full rounded-full bg-sky-500 transition-[width] duration-200 ease-out"
                        style={{
                          width: `${Math.max(0, Math.min(100, composeProgressPercent))}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
              <div
                className={`${darkModalFooterClass} !justify-center gap-2`}
              >
                <button
                  type="button"
                  className={darkModalBtnCancelClass}
                  onClick={handleCancelCompose}
                  title={tt.cancel}
                >
                  {tt.cancel}
                </button>
                {composeModalPhase === 'pick' ? (
                  <button
                    type="button"
                    className={darkModalBtnOkClass}
                    onClick={() => void handleConfirmComposeQuality()}
                  >
                    {tt.burnQualityStart}
                  </button>
                ) : null}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  if (embedded) {
    if (!open) return null;
    return (
      <div
        className={`${karaokeEmbeddedPanelClass} relative h-full`}
        role="region"
        aria-label={tt.title}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {editorBody}
        {composeProgressPortal}
      </div>
    );
  }

  return (
    <DarkModalFrame
      open={open}
      onBackdropClick={handleClose}
      panelClassName={`${karaokePanelClass} relative`}
      showBrandHeader={false}
    >
      {editorBody}
      {composeProgressPortal}
    </DarkModalFrame>
  );
};

export default KaraokeSubtitleEditor;
