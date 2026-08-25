/**
 * 生成卡拉OK ASS（内部/导出/调试；UI「合成到视频」不再暴露此路径）。
 *
 * 「合成到视频」唯一走方案 A（karaokeCssBurn：与预览同款 CSS 半扫）。
 * 方案 C（karaokeBurn，内部保留）：
 *   Layer0：整行未唱白字 + 未唱黑边（扫字期描边靠此层）；
 *   Layer1 填色：Style `KaraokeWipe`（Outline=0）整句 `\\kf`；
 *     Secondary 透明 + Primary 已唱填色；`\\bord0`+`\\3a`；**无 clip**；
 *   唱完 hold：逐字 KaraokeSung 已唱填色+白边（无 clip / 无 kf）；
 *   **正歌不写描边半扫 `\\clip`**：1px 起扫 / 逐字 clip 在部分 ffmpeg/libass 下会卡成
 *     「每字一条竖白线」灾难伪影。ASS 更顺但半扫描边不分裂为白/黑边。
 * PlayRes = 设计稿 × ASS_KARAOKE_RENDER_SCALE（默认 3）；烧录再 2× 栅格超采样降回片源（karaokeBurn）。
 * 未唱 Style `Karaoke` Outline=`outline`（0 → `\\bord0`）；
 * **勿**让 `\\kf` 行共用带非零 Outline 的 `Karaoke`：libass 会把 Primary 画进描边、字心停在 Secondary 白。
 * 软阴影 = 整行仅一层：Layer0 一条阴影底（`\\shad`+半透明 Back+blur），
 * 扫字/hold/角色一律 `\\shad0`，避免逐字 Dialogue 右下影叠黑。
 * hold/角色用 `KaraokeSung`（`sungOutlineColor` / `sungOutlineWidth`）；描边抗锯齿 blur。
 * 单行禁止自动换行（WrapStyle 2 + \\q2）；过长句 \\fscx/\\fscy 缩小；靠边时改左右锚点向内伸展。
 * 开场曲名/署名 + 左行（Line A）上方倒计时蓝点（KaraokeOpeningCD）始终写入；每句歌词上方 KaraokeCD 仅 countdown.enabled===true。
 * 句末 `\\fad`：自 singEnd 立刻渐隐，Dialogue End = singEnd + fade（间隙不足时压缩；不与下一句叠化）。
 * 单行：短间隙时下一句在上一句淡完后出现；长间奏（>清屏阈值，默认 10s）清屏；真正长间奏（≥再入阈值，默认 ≥清屏/10s，全曲最多 1 次）再入前同开场蓝点+提前显词（阈值见 style）。
 * 双行经典：A=偶数行、B=奇数行，各句只挂本槽 nativePos；同槽下一句（i+2）在同槽上一句淡完后再出现；长间奏清两侧。
 *
 * `buildKaraokeWipeClipTags` / `buildKaraokeCharStaticClipTag` 仍保留供调试，正歌默认不调用。
 */

import {
  displayKaraokeRoleMarker,
  karaokeLineLeadSungAss,
  karaokeRoleSungAss,
  parseKaraokeRoleMarker,
} from './roleMarkers.js';
import {
  ASS_KARAOKE_RENDER_SCALE,
  ASS_PLAY_RES_X,
  ASS_PLAY_RES_Y,
  assColorTag,
  clampKaraokeAssAlignment,
  clampKaraokeLineFadeOutSec,
  clampKaraokeOpeningCreditFontSize,
  clampKaraokeOpeningTitleFontSize,
  clampKaraokeOutline,
  DEFAULT_KARAOKE_POS_A,
  DEFAULT_KARAOKE_POS_B,
  DEFAULT_KARAOKE_STYLE,
  defaultKaraokePosAForLayout,
  KARAOKE_ROLE_SUNG_COLORS,
  KARAOKE_OPENING_CREDIT_OUTLINE,
  KARAOKE_OPENING_FALLBACK_SEC,
  KARAOKE_OPENING_OUTLINE_ASS,
  KARAOKE_OPENING_PRIMARY_ASS,
  KARAOKE_OPENING_TITLE_OUTLINE,
  KARAOKE_LYRIC_OUTLINE_DEFAULT,
  KARAOKE_LYRIC_SHADOW_DEFAULT,
  KARAOKE_LYRIC_SUNG_OUTLINE_DEFAULT,
  karaokeClampAppearAfterInterludes,
  karaokeCountdownDefaultDotPos,
  karaokeCountdownResolvedDotPos,
  karaokeCountdownWindowStartSec,
  karaokeLineDisplayAppearSec,
  karaokeLineVisibleEndSec,
  karaokeOpeningCountdownAnchorPos,
  karaokeOpeningTimeline,
  karaokeReentryTimeline,
  karaokeSelectCountdownReentryLineIndexes,
  karaokeLyricStrokeLegacyPatch,
  normalizeKaraokeAssColor,
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
  type KaraokeCountdownOptions,
  type KaraokeLine,
  type KaraokeOpeningTimeline,
  type KaraokePos,
  type KaraokeProject,
  type KaraokeReentryTimeline,
  type KaraokeStyleOptions,
  type KaraokeStyleResolved,
} from './types.js';
import { applyGlobalOffsetToLines, prepareKaraokeLinesForRender } from './wordTiming.js';

const ASS_EDGE_MARGIN = 40;
/** 倒计时圆点字符（实心圆） */
const COUNTDOWN_DOT_CHAR = '●';

/** 逻辑 PlayRes → 烧录超采样像素（坐标 / bord / 字号） */
function assPx(logical: number, scale = ASS_KARAOKE_RENDER_SCALE): number {
  return Math.round(Number(logical) * Math.max(1, scale));
}

/** blur 随超采样放大，视觉软边与 1× 设计稿一致 */
function assBlurPx(logicalBlur: number, scale = ASS_KARAOKE_RENDER_SCALE): number {
  const b = Number(logicalBlur) * Math.max(1, scale);
  if (!(b > 0)) return 0;
  return Math.round(b * 100) / 100;
}

function escAssText(s: string): string {
  // 禁止插入换行：去掉原文换行，避免 \N 折行
  return String(s || '')
    .replace(/\r?\n/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}');
}

/** 秒 → ASS \kf / \k 百分秒（厘秒，至少 1） */
export function secToKCentis(durSec: number): number {
  const n = Math.round(Math.max(0, durSec) * 100);
  return Math.max(1, n);
}

/** 主/次/描边均透明（逐字上层里占位，不盖住底层黑边） */
const ASS_ALPHA_HIDDEN = '\\1a&HFF&\\2a&HFF&\\3a&HFF&';
/** 底层逐字不透明（含 `\2a`，以便从 HIDDEN 占位恢复） */
const ASS_ALPHA_OPAQUE = '\\1a&H00&\\2a&H00&\\3a&H00&';

/**
 * ASS `\bord` 无 round linejoin，拐角偏尖；`\blur0` 硬边再经 yuv420p 更易锯齿。
 * 描边抗锯齿 blur **跟描边粗细反相关**：已唱 bord=5 时必须更低。
 * 软阴影另见 `karaokeSoftShadowDistanceBlur`：靠 Shadow 距离抬一点 blur，
 * 把右下 `\shad` 硬拷贝化开；勿把抗锯齿与软阴影混成大 blur（易成 3D 厚坨）。
 */
export function karaokeOutlineCornerBlur(outline: number): number {
  const o = Math.max(0, Number(outline) || 0);
  if (o <= 0) return 0;
  // 办公本编码：blur 仅极轻抗锯齿，避免过大软边拖慢 libass
  if (o >= 5) return 0.12;
  if (o >= 4) return 0.14;
  if (o >= 3) return 0.16;
  // outline 1–2：轻抗锯齿
  return Math.min(0.22, Math.max(0.12, 0.12 + o * 0.04));
}

/**
 * 软阴影用 blur：随 UI `\shad` 距离略增，把阴影字廓虚开，避免「描边旁再复制一圈硬黑框」。
 * 上限压低（≤1.0），办公本 libass 友好。
 * - outline=0：无硬描边环，blur 只服务软阴影，必须更克制，否则字缘发虚像「假描边」。
 * - 高 bord（已唱 6～8）：再压 blur，避免粗描边+阴影糊成连片黑雾。
 */
export function karaokeSoftShadowDistanceBlur(shadow: number, outline = 0): number {
  const s = Number(shadow);
  if (!Number.isFinite(s) || s <= 0) return 0;
  // shadow=3 → ~0.76；再按描边粗细封顶
  let b = Math.min(1.0, Math.max(0.35, 0.25 + s * 0.17));
  const o = Math.max(0, Number(outline) || 0);
  if (o <= 0) {
    // shadow=3 → ~0.36；仅虚开右下影，不糊字身
    b = Math.min(b, Math.max(0.18, 0.12 + s * 0.08));
  } else if (o >= 7) {
    b = Math.min(b, 0.28);
  } else if (o >= 5) {
    b = Math.min(b, 0.4);
  } else if (o >= 4) {
    b = Math.min(b, 0.55);
  }
  return Math.round(b * 100) / 100;
}

/** 有描边时返回 `\\blurX.XX`，否则空串（开场等仅抗锯齿） */
export function karaokeOutlineSoftTag(outline: number): string {
  const b = karaokeOutlineCornerBlur(outline);
  return b > 0 ? `\\blur${b.toFixed(2)}` : '';
}

/**
 * 未唱层 blur = max(描边抗锯齿, 软阴影虚边)。
 * shadow=0 时退回仅抗锯齿，不会凭空加糊。
 */
export function karaokeUnsungSoftShadowBlur(outline: number, shadow?: number): number {
  return Math.max(
    karaokeOutlineCornerBlur(outline),
    karaokeSoftShadowDistanceBlur(shadow ?? 0, outline),
  );
}

/** 未唱层 `\\blur` */
export function karaokeUnsungSoftTag(outline: number, shadow?: number): string {
  const b = karaokeUnsungSoftShadowBlur(outline, shadow);
  return b > 0 ? `\\blur${b.toFixed(2)}` : '';
}

/**
 * 已唱层 blur：同未唱逻辑；粗已唱描边时 soft-shadow blur 已封顶，避免色边糊团。
 */
export function karaokeSungSoftShadowBlur(outline: number, shadow?: number): number {
  return Math.max(
    karaokeOutlineCornerBlur(outline),
    karaokeSoftShadowDistanceBlur(shadow ?? 0, outline),
  );
}

/** 已唱层 `\\blur` */
export function karaokeSungSoftTag(outline: number, shadow?: number): string {
  const b = karaokeSungSoftShadowBlur(outline, shadow);
  return b > 0 ? `\\blur${b.toFixed(2)}` : '';
}

/**
 * 歌词 Shadow 距离：与 UI `style.shadow` 一致（0～12），禁止再钳成更小值。
 * Style 行用此值保真；Dialogue 层按描边见 `karaokeLyricShadowDistanceForBord`。
 */
export function karaokeLyricShadowDistance(shadow: number): number {
  const s = Number(shadow);
  if (!Number.isFinite(s) || s <= 0) return 0;
  // 与 UI style.shadow 一致（0～12）；软边靠半透明 BackColour + 适度 blur
  return Math.max(0, Math.min(12, Math.round(s * 10) / 10));
}

/**
 * Dialogue 层有效 `\shad`：在 UI 距离基础上按描边粗细收束。
 * - outline=0：阴影拷贝紧贴字身，避免无描边时软黑晕被当成「未唱描边」。
 * - 高 bord：粗描边本身已很宽，shad 再远会与邻字糊成一条黑雾。
 */
export function karaokeLyricShadowDistanceForBord(shadow: number, outline = 0): number {
  const base = karaokeLyricShadowDistance(shadow);
  if (!(base > 0)) return 0;
  const o = Math.max(0, Number(outline) || 0);
  if (o <= 0) {
    return Math.round(Math.min(base, Math.max(0, base * 0.55)) * 10) / 10;
  }
  if (o >= 7) {
    return Math.min(base, 1.2);
  }
  if (o >= 5) {
    return Math.min(base, 1.8);
  }
  return base;
}

/**
 * ASS `\bord` 宽度：与 UI outline / sungOutlineWidth **同数值**（PlayRes 像素语义）。
 * 不再 ×0.85——那会让面板「未唱 2 / 已唱 5」在成片里对不上。
 */
export function karaokeAssBordWidth(outline: number): number {
  const o = Number(outline);
  if (!Number.isFinite(o) || o <= 0) return 0;
  return Math.max(0, Math.min(8, Math.round(o * 10) / 10));
}

/**
 * 软阴影 BackColour：保留用户阴影 RGB，写入半透明 alpha，
 * 比描边实心黑淡一截；再配合 blur，避免右下「第二道硬黑框」。
 * outline=0 / 高 bord 时更淡，减轻「软黑雾」。
 */
export function karaokeSoftShadowBackColour(shadowColor: string, outline = 2): string {
  const n = normalizeKaraokeAssColor(shadowColor, DEFAULT_KARAOKE_STYLE.shadowColor);
  const raw = n.replace(/^&H/i, '').replace(/&$/, '').toUpperCase().padStart(8, '0');
  const rgb = raw.slice(-6);
  const o = Math.max(0, Number(outline) || 0);
  // ASS alpha：00 不透明 … FF 全透明。默认 ~A0（约 62% 透明）
  let alpha = 'A0';
  if (o <= 0) alpha = 'C0';
  else if (o >= 7) alpha = 'B8';
  else if (o >= 5) alpha = 'B0';
  return `&H${alpha}${rgb}`;
}

/** 粗估 ASS 文本像素宽（CJK ≈ fontSize） */
export function estimateAssTextWidth(text: string, fontSize: number): number {
  const fs = Math.max(1, fontSize);
  let w = 0;
  for (const ch of String(text || '')) {
    if (/\s/.test(ch)) w += fs * 0.35;
    else if (/[\u0000-\u00ff]/.test(ch)) w += fs * 0.55;
    else w += fs;
  }
  return w;
}

/** 单字在行内的 PlayRes 轴对齐包围盒（用于扫字 `\clip`） */
export type KaraokeCharPlayResBox = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

/**
 * 按行 `\pos`/`\an`/`\fsc*` 粗估每个字的 PlayRes 矩形。
 * CJK ≈ fontSize；半角/空格按 estimateAssTextWidth；与 fitKaraokeLineLayout 同源。
 */
export function layoutKaraokeLineCharBoxes(
  pos: KaraokePos,
  line: KaraokeLine,
  fontSize: number,
): KaraokeCharPlayResBox[] {
  const chars = line?.chars || [];
  if (!chars.length) return [];
  const plain = String(line.text || chars.map((c) => c.text).join('')).replace(/\r?\n/g, '');
  const fitted = fitKaraokeLineLayout(pos, plain, fontSize);
  const scale = fitted.scalePercent / 100;
  const fs = Math.max(1, fontSize);
  const widths = chars.map((ch) => {
    let t = ch.text;
    if (ch.roleTag) {
      const role = ch.role || parseKaraokeRoleMarker(ch.text);
      t = displayKaraokeRoleMarker(ch.text, role);
    }
    return estimateAssTextWidth(t, fs) * scale;
  });
  const totalW = widths.reduce((a, b) => a + b, 0);
  let leftX = fitted.pos.x;
  if (fitted.an === 5 || fitted.an === 2) leftX = fitted.pos.x - totalW / 2;
  else if (fitted.an === 6) leftX = fitted.pos.x - totalW;
  const h = Math.max(1, fs * scale);
  let topY: number;
  let botY: number;
  if (fitted.an === 2) {
    botY = fitted.pos.y;
    topY = fitted.pos.y - h;
  } else {
    topY = fitted.pos.y - h / 2;
    botY = fitted.pos.y + h / 2;
  }
  const out: KaraokeCharPlayResBox[] = [];
  let x = leftX;
  for (let i = 0; i < chars.length; i++) {
    const w = Math.max(0.5, widths[i] || fs * scale);
    out.push({ x1: x, y1: topY, x2: x + w, y2: botY });
    x += w;
  }
  return out;
}

/**
 * 扫字 `\clip` 建议 `\t` 段数（调试用）。正歌固定 1 段（见 buildKaraokeWipeClipTags）。
 */
export function karaokeWipeClipSteps(boxWidthPx: number, durSec: number): number {
  void boxWidthPx;
  const durMs = Math.max(1, Math.round(Math.max(0.01, durSec) * 1000));
  const frameMs = 16;
  return Math.max(1, Math.min(180, Math.floor(durMs / frameMs)));
}

/**
 * 兼容旧调用。正歌 clip 右缘含 outlinePad（与左/上下对称），不另加 rightPad。
 */
export function karaokeWipeClipRightPad(_unsungOutline?: number): number {
  return 0;
}

/**
 * 导出扫字间歇卡顿根因：短字 (end−start 小) 在 ~30fps 下每帧跨过多 clip 像素 → 台阶；
 * 长字每帧步进小 → 丝滑。预览 CSS percent 亚像素不受影响。
 * 下列常量用于 ASS 侧「速度上限 / 最少帧数」补偿（可略拖进 hold，不改字级 ASR 轴）。
 */
/** 估算扫字步进用的目标帧率 */
export const KARAOKE_WIPE_TARGET_FPS = 30;
/**
 * PlayRes@ASS_KARAOKE_RENDER_SCALE 下每帧最多推进的 clip 右缘像素。
 * ×3 + 烧录 2× 后约数个片源像素/帧；更大则短字明显一卡一卡。
 */
export const KARAOKE_WIPE_MAX_SCALED_PX_PER_FRAME = 28;
/** 扫字至少跨这么多帧（@TARGET_FPS）≈0.2s，避免 1～2 帧闪扫 */
export const KARAOKE_WIPE_MIN_FRAMES = 6;
/** 相对 ASR 字长最多拉长（秒），避免拖到句末仍在扫 */
export const KARAOKE_WIPE_MAX_STRETCH_SEC = 0.45;

/** 与 `formatAssTime` 相同的厘秒量化（从 0 起的绝对 cs） */
export function karaokeAssCentiseconds(sec: number): number {
  const s = Math.max(0, Number(sec) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s - h * 3600 - m * 60;
  const whole = Math.floor(rest);
  const cs = Math.min(99, Math.round((rest - whole) * 100));
  return ((h * 60 + m) * 60 + whole) * 100 + cs;
}

/**
 * 保证 Dialogue End 在 Start 之后至少 minCs 厘秒（ASS 时间轴精度），
 * 避免短字 round 成同刻 → 事件长度为 0、只见首尾。
 */
export function ensureAssDialogueEndSec(
  startSec: number,
  endSec: number,
  minCs = 2,
): number {
  const sCs = karaokeAssCentiseconds(startSec);
  let eCs = karaokeAssCentiseconds(endSec);
  const need = Math.max(1, Math.round(Number(minCs) || 2));
  if (eCs < sCs + need) eCs = sCs + need;
  return eCs / 100;
}

/** Dialogue Start/End 厘秒差 → `\t` 毫秒（与事件寿命对齐，防 hold 截断扫字） */
export function karaokeWipeDurMsFromAssTimes(startSec: number, endSec: number): number {
  const dCs = Math.max(1, karaokeAssCentiseconds(endSec) - karaokeAssCentiseconds(startSec));
  return dCs * 10;
}

/** 已缩放 PlayRes 下 clip 右缘行程（含 outlinePad） */
export function karaokeWipeClipSpanPx(
  box: KaraokeCharPlayResBox,
  outlinePad = 0,
  scale = ASS_KARAOKE_RENDER_SCALE,
): number {
  const pad = Math.max(0, Number(outlinePad) || 0);
  const s = Math.max(1, Math.round(Number(scale) || ASS_KARAOKE_RENDER_SCALE));
  const xLeft = Math.round((box.x1 - pad) * s);
  const xRight = Math.round((box.x2 + pad) * s);
  return Math.max(1, xRight - xLeft);
}

/**
 * 导出扫字有效时长：max(ASR, 速度上限所需, 最少帧)，再封顶 ASR+maxStretch。
 * 短字被拉长进 hold 区间，降低 px/帧台阶；长字保持 ASR。
 */
export function karaokeWipeSmoothDurationSec(
  clipSpanScaledPx: number,
  asrDurSec: number,
  opts?: {
    fps?: number;
    maxPxPerFrame?: number;
    minFrames?: number;
    maxStretchSec?: number;
  },
): number {
  const asr = Math.max(0.01, Number(asrDurSec) || 0.01);
  const fps = Math.max(1, Number(opts?.fps) || KARAOKE_WIPE_TARGET_FPS);
  const maxPx = Math.max(
    1,
    Number(opts?.maxPxPerFrame) || KARAOKE_WIPE_MAX_SCALED_PX_PER_FRAME,
  );
  const minFrames = Math.max(1, Number(opts?.minFrames) || KARAOKE_WIPE_MIN_FRAMES);
  const maxStretch = Math.max(
    0,
    opts?.maxStretchSec != null
      ? Number(opts.maxStretchSec)
      : KARAOKE_WIPE_MAX_STRETCH_SEC,
  );
  const span = Math.max(1, Number(clipSpanScaledPx) || 1);
  const needBySpeed = span / maxPx / fps;
  const needByFrames = minFrames / fps;
  const target = Math.max(asr, needBySpeed, needByFrames);
  return Math.min(target, asr + maxStretch);
}

/** 无字盒时的默认 clip 行程（逻辑字宽 × 烧录 scale） */
const KARAOKE_WIPE_DEFAULT_SPAN_SCALED_PX = 56 * ASS_KARAOKE_RENDER_SCALE;

/**
 * 单字扫字视觉结束时刻：ASR end + smooth 拉长（短字 ≥~6 帧@30fps），
 * 可夹到下一字 start / 行末，避免严重重叠。预览 CSS 与方案 A/C 共用。
 */
export function karaokeCharWipeVisualEndSec(
  startSec: number,
  asrEndSec: number,
  opts?: {
    nextStartSec?: number;
    lineEndSec?: number;
    clipSpanScaledPx?: number;
    fps?: number;
    maxPxPerFrame?: number;
    minFrames?: number;
    maxStretchSec?: number;
  },
): number {
  const start = Math.max(0, Number(startSec) || 0);
  const asrEnd = Math.max(
    start + 0.01,
    Number.isFinite(Number(asrEndSec)) ? Number(asrEndSec) : start + 0.01,
  );
  const span =
    opts?.clipSpanScaledPx != null && Number(opts.clipSpanScaledPx) > 0
      ? Number(opts.clipSpanScaledPx)
      : KARAOKE_WIPE_DEFAULT_SPAN_SCALED_PX;
  let end =
    start +
    karaokeWipeSmoothDurationSec(span, asrEnd - start, {
      fps: opts?.fps,
      maxPxPerFrame: opts?.maxPxPerFrame,
      minFrames: opts?.minFrames,
      maxStretchSec: opts?.maxStretchSec,
    });
  if (opts?.nextStartSec != null && Number.isFinite(Number(opts.nextStartSec))) {
    const ns = Number(opts.nextStartSec);
    if (ns > start + 0.01) end = Math.min(end, ns);
  }
  if (opts?.lineEndSec != null && Number.isFinite(Number(opts.lineEndSec))) {
    end = Math.min(end, Number(opts.lineEndSec));
  }
  return ensureAssDialogueEndSec(start, Math.max(start + 0.01, end), 2);
}

/** `buildKaraokeWipeClipTags` 选项（亦兼容旧版 `(box, dur, outlinePad)`） */
export type KaraokeWipeClipOptions = {
  /** 正歌仅用 `clip`；`iclip` 仅调试 */
  mode?: 'clip' | 'iclip';
  /** 左/上/下外扩，容纳已唱描边（逻辑 PlayRes px） */
  outlinePad?: number;
  /**
   * 右缘外扩（逻辑 PlayRes px）。正歌描边半扫/hold 默认 0，避免白边伸进下一字
   * 与未唱黑边在字缝叠成双竖线。
   */
  rightPad?: number;
  delayMs?: number;
  /** 忽略：正歌固定 1 段 `\t`；多段 1ms 台阶更卡 */
  steps?: number;
  /** 烧录超采样（默认 ASS_KARAOKE_RENDER_SCALE）；box/pad 为逻辑坐标 */
  scale?: number;
  /**
   * 优先：与 Dialogue Start/End 厘秒差对齐的 `\t` 毫秒。
   * 未给则用 durSec×1000；勿让 `\t` 长于事件（会被 hold 截成首尾跳变）。
   */
  durMs?: number;
};

/**
 * 方案 C 描边半扫 Layer1：`\clip` **左缘固定**在字形左−pad，右缘单段 `\t` 从 1px→字右+rightPad。
 * 与预览 CSS `clip-path: inset(0 X% 0 0)` 同构（只动右缘）。
 * **禁止**初始零宽 `\clip(x,y,x,y)`：部分 ffmpeg/libass 会丢掉裁剪 → 整字白边。
 * **rightPad 默认 0**：右缘白边不伸进下一字，避免与未唱左黑边叠成字间双竖线。
 * box/pad 逻辑 1920 → ×scale。勿拆多段 `\t`；**勿与 `\\kf` 同 Dialogue**。
 */
export function buildKaraokeWipeClipTags(
  box: KaraokeCharPlayResBox,
  durSec: number,
  outlinePadOrOpts: number | KaraokeWipeClipOptions = 0,
  _stepsArg?: number,
): string {
  const opts: KaraokeWipeClipOptions =
    typeof outlinePadOrOpts === 'object' && outlinePadOrOpts
      ? outlinePadOrOpts
      : { outlinePad: Number(outlinePadOrOpts) || 0 };
  const mode = opts.mode === 'iclip' ? 'iclip' : 'clip';
  const tag = mode === 'iclip' ? 'iclip' : 'clip';
  const pad = Math.max(0, Number(opts.outlinePad) || 0);
  const rightPad =
    opts.rightPad != null && Number.isFinite(Number(opts.rightPad))
      ? Math.max(0, Number(opts.rightPad))
      : 0;
  const delayMs = Math.max(0, Math.round(Number(opts.delayMs) || 0));
  const scale = Math.max(1, Math.round(Number(opts.scale) || ASS_KARAOKE_RENDER_SCALE));
  const playY = ASS_PLAY_RES_Y * scale;
  // 左/上/下含 pad；右缘仅 rightPad（正歌 0）
  const xLeft = Math.round((box.x1 - pad) * scale);
  const y1 = Math.max(0, Math.round((box.y1 - pad) * scale));
  const xRight = Math.round((box.x2 + rightPad) * scale);
  const y2 = Math.min(playY, Math.round((box.y2 + pad) * scale));
  // 至少 1px 宽，避免退化矩形被渲染器当成「无裁剪/全显示」
  const xRightEnd = Math.max(xLeft + 1, xRight);
  const xRightStart = Math.min(xLeft + 1, xRightEnd);
  const durMs =
    opts.durMs != null && Number(opts.durMs) > 0
      ? Math.max(1, Math.round(Number(opts.durMs)))
      : Math.max(1, Math.round(Math.max(0.01, durSec) * 1000));
  const t0 = delayMs;
  const t1 = delayMs + durMs;
  return `\\${tag}(${xLeft},${y1},${xRightStart},${y2})\\t(${t0},${t1},\\${tag}(${xLeft},${y1},${xRightEnd},${y2}))`;
}

/**
 * 静态字盒 `\clip`（hold 用）：左/上/下可 pad，右缘默认不外扩，防已唱白边伸进下一字。
 */
export function buildKaraokeCharStaticClipTag(
  box: KaraokeCharPlayResBox,
  opts?: { outlinePad?: number; rightPad?: number; scale?: number; mode?: 'clip' | 'iclip' },
): string {
  const mode = opts?.mode === 'iclip' ? 'iclip' : 'clip';
  const pad = Math.max(0, Number(opts?.outlinePad) || 0);
  const rightPad =
    opts?.rightPad != null && Number.isFinite(Number(opts.rightPad))
      ? Math.max(0, Number(opts.rightPad))
      : 0;
  const scale = Math.max(1, Math.round(Number(opts?.scale) || ASS_KARAOKE_RENDER_SCALE));
  const playY = ASS_PLAY_RES_Y * scale;
  const xLeft = Math.round((box.x1 - pad) * scale);
  const y1 = Math.max(0, Math.round((box.y1 - pad) * scale));
  const xRight = Math.max(xLeft + 1, Math.round((box.x2 + rightPad) * scale));
  const y2 = Math.min(playY, Math.round((box.y2 + pad) * scale));
  return `\\${mode}(${xLeft},${y1},${xRight},${y2})`;
}

/**
 * 单行适配：优先缩小字号保持不换行；按 x 落在左/中/右选用锚点：
 * - 左半区：`\an4`，`\pos` = 文字左缘（默认 A：x=147）
 * - 右半区：`\an6`，`\pos` = 文字右缘（默认 B：x=1778）
 * - 中区偏下（Y≥约 2/3 画高）：`\an2` 底中（默认单行：x=960,y=950）
 * - 中区其余：`\an5` 中心点；靠边溢出时改左右锚并向内伸展
 * 返回 an（2/4/5/6）、pos、以及 20–100 的缩放百分比。
 */
export function fitKaraokeLineLayout(
  pos: KaraokePos,
  text: string,
  fontSize: number,
): { an: 2 | 4 | 5 | 6; pos: KaraokePos; scalePercent: number } {
  const x0 = Math.max(0, Math.min(ASS_PLAY_RES_X, Math.round(Number(pos?.x) || 0)));
  const y0 = Math.max(0, Math.min(ASS_PLAY_RES_Y, Math.round(Number(pos?.y) || 0)));
  const est = estimateAssTextWidth(text, fontSize);
  const maxFrame = Math.max(1, ASS_PLAY_RES_X - ASS_EDGE_MARGIN * 2);
  let scalePercent = 100;
  if (est > maxFrame) {
    scalePercent = Math.max(20, Math.min(100, Math.floor((maxFrame / est) * 100)));
  }
  const scaledW = est * (scalePercent / 100);
  const half = scaledW / 2;
  const rightLimit = ASS_PLAY_RES_X - ASS_EDGE_MARGIN;
  const leftLimit = ASS_EDGE_MARGIN;
  const mid = ASS_PLAY_RES_X / 2;
  /** 与中心拉开此距离则固定左/右锚，避免默认 A/B 被当成中心点 */
  const SIDE_BAND = 200;
  /** 下方带：中区用底中 `\an2`（与 karaokeMarginAlignmentFromPos 底带一致） */
  const BOTTOM_BAND = ASS_PLAY_RES_Y * 0.67;

  // 左半：左锚点，x = 文字左缘（示意图 A：147）
  if (x0 <= mid - SIDE_BAND) {
    let leftX = Math.max(leftLimit, Math.min(rightLimit, x0));
    if (scaledW > 0 && leftX + scaledW > rightLimit) {
      leftX = Math.max(leftLimit, rightLimit - scaledW);
    }
    return { an: 4, pos: { x: Math.round(leftX), y: y0 }, scalePercent };
  }
  // 右半：右锚点，x = 文字右缘（示意图 B：1778）
  if (x0 >= mid + SIDE_BAND) {
    let rightX = Math.max(leftLimit, Math.min(rightLimit, x0));
    if (scaledW > 0 && rightX - scaledW < leftLimit) {
      rightX = Math.min(rightLimit, leftLimit + scaledW);
    }
    return { an: 6, pos: { x: Math.round(rightX), y: y0 }, scalePercent };
  }

  if (x0 + half > rightLimit && scaledW > 0) {
    // 右锚点：向左伸展
    return {
      an: 6,
      pos: { x: Math.min(rightLimit, Math.max(leftLimit + scaledW, Math.round(x0 + half))), y: y0 },
      scalePercent,
    };
  }
  if (x0 - half < leftLimit && scaledW > 0) {
    // 左锚点：向右伸展
    return {
      an: 4,
      pos: { x: Math.max(leftLimit, Math.min(rightLimit - scaledW, Math.round(x0 - half))), y: y0 },
      scalePercent,
    };
  }
  // 中区：下方用底中对齐，其余垂直居中
  if (y0 >= BOTTOM_BAND) {
    return { an: 2, pos: { x: x0, y: y0 }, scalePercent };
  }
  return { an: 5, pos: { x: x0, y: y0 }, scalePercent };
}

/**
 * 底层 Dialogue：整句未唱白字 + 未唱描边（静态，无 `\kf`）。
 * 角色标记透明占位（色+已唱描边由 Layer1 负责）；方案 C 正歌 Layer0 用此整行底。
 */
export function buildKaraokeDialogueBaseText(
  line: KaraokeLine,
  style?: Pick<KaraokeStyleOptions, 'unsungColor' | 'outlineColor'>,
): string {
  if (line.instrumental || !line.chars.length) return '';
  const unsung = assColorTag(style?.unsungColor || DEFAULT_KARAOKE_STYLE.unsungColor);
  const outline = assColorTag(style?.outlineColor || DEFAULT_KARAOKE_STYLE.outlineColor);
  let out = '';
  let any = false;
  for (const ch of line.chars) {
    if (ch.roleTag) {
      const role = ch.role || parseKaraokeRoleMarker(ch.text);
      const markerText = role ? displayKaraokeRoleMarker(ch.text, role) : ch.text;
      out += `{${ASS_ALPHA_HIDDEN}}${escAssText(markerText)}`;
      continue;
    }
    any = true;
    out += `{${ASS_ALPHA_OPAQUE}\\1c${unsung}\\2c${unsung}\\3c${outline}}${escAssText(ch.text)}`;
  }
  return any ? out : '';
}

/**
 * 整行纯文本（含角色标记），供整行软阴影底 Dialogue 使用。
 * 填色/描边在外层 tag 里全透明，只靠 `\\shad` 出一层影。
 */
export function buildKaraokeDialoguePlainLineText(line: KaraokeLine): string {
  if (line.instrumental || !line.chars.length) return '';
  let body = '';
  for (const ch of line.chars) {
    if (ch.roleTag) {
      const role = ch.role || parseKaraokeRoleMarker(ch.text);
      const markerText = role ? displayKaraokeRoleMarker(ch.text, role) : ch.text;
      body += escAssText(markerText);
    } else {
      body += escAssText(ch.text);
    }
  }
  return body;
}

/**
 * 底层逐字未唱正文：仅 focusIdx 字不透明（白字+未唱描边色），其余透明占位对齐 `\\pos`。
 * 方案 C 正歌改用整行 `buildKaraokeDialogueBaseText`；本函数保留兼容/调试。
 */
export function buildKaraokeDialogueBaseCharText(
  line: KaraokeLine,
  focusIdx: number,
  style?: Pick<KaraokeStyleOptions, 'unsungColor' | 'outlineColor'>,
): string {
  if (line.instrumental || !line.chars.length) return '';
  if (focusIdx < 0 || focusIdx >= line.chars.length) return '';
  const focus = line.chars[focusIdx];
  if (!focus || focus.roleTag) return '';

  const unsung = assColorTag(style?.unsungColor || DEFAULT_KARAOKE_STYLE.unsungColor);
  const outline = assColorTag(style?.outlineColor || DEFAULT_KARAOKE_STYLE.outlineColor);
  let out = '';
  for (let j = 0; j < line.chars.length; j++) {
    const ch = line.chars[j];
    if (ch.roleTag) {
      const role = ch.role || parseKaraokeRoleMarker(ch.text);
      const markerText = role ? displayKaraokeRoleMarker(ch.text, role) : ch.text;
      out += `{${ASS_ALPHA_HIDDEN}}${escAssText(markerText)}`;
      continue;
    }
    if (j === focusIdx) {
      out += `{${ASS_ALPHA_OPAQUE}\\1c${unsung}\\2c${unsung}\\3c${outline}}${escAssText(ch.text)}`;
    } else {
      out += `{${ASS_ALPHA_HIDDEN}}${escAssText(ch.text)}`;
    }
  }
  return out;
}

/**
 * 底层角色标记：不再画未唱描边（避免蓝/黑边垫在角色字下）。
 * 仅透明占位对齐；角色色+已唱描边全由上层 `buildKaraokeRoleMarkersOverlayText` 负责。
 */
export function buildKaraokeDialogueBaseRoleMarkersText(
  line: KaraokeLine,
  _style?: Pick<KaraokeStyleOptions, 'unsungColor' | 'outlineColor' | 'sungOutlineColor'>,
): string {
  if (line.instrumental || !line.chars.length) return '';
  let out = '';
  let anyRole = false;
  for (const ch of line.chars) {
    if (ch.roleTag) {
      anyRole = true;
      const role = ch.role || parseKaraokeRoleMarker(ch.text);
      const markerText = role ? displayKaraokeRoleMarker(ch.text, role) : ch.text;
      out += `{${ASS_ALPHA_HIDDEN}}${escAssText(markerText)}`;
    } else {
      out += `{${ASS_ALPHA_HIDDEN}}${escAssText(ch.text)}`;
    }
  }
  return anyRole ? out : '';
}

/**
 * 角色标记上层：角色色填色 + **已唱描边色/粗细**（与预览 `(女)` 红字白边一致）。
 * 不再 `\bord0` 去蹭未唱描边——那会变成蓝/黑边，和调节页白边对不上。
 */
export function buildKaraokeRoleMarkersOverlayText(
  line: KaraokeLine,
  style?: Pick<
    KaraokeStyleOptions,
    'sungColor' | 'roleColors' | 'sungOutlineColor'
  >,
): string {
  if (line.instrumental || !line.chars.length) return '';
  const roleColors = resolveKaraokeRoleColors(style?.roleColors);
  const defaultSung = assColorTag(roleColors.male || style?.sungColor || DEFAULT_KARAOKE_STYLE.sungColor);
  const sungOutline = assColorTag(style?.sungOutlineColor || DEFAULT_KARAOKE_STYLE.sungOutlineColor);
  let out = '';
  let anyRole = false;
  for (const ch of line.chars) {
    if (ch.roleTag) {
      anyRole = true;
      const roleAss = karaokeRoleSungAss(ch.role, roleColors);
      const primary = roleAss ? assColorTag(roleAss) : defaultSung;
      const role = ch.role || parseKaraokeRoleMarker(ch.text);
      const markerText = role ? displayKaraokeRoleMarker(ch.text, role) : ch.text;
      out += `{${ASS_ALPHA_OPAQUE}\\1c${primary}\\2c${primary}\\3c${sungOutline}}${escAssText(markerText)}`;
    } else {
      out += `{${ASS_ALPHA_HIDDEN}}${escAssText(ch.text)}`;
    }
  }
  return anyRole ? out : '';
}

/**
 * 逐字已唱 hold：唱完后静态已唱填色+已唱描边（无 `\\kf`），钉住 Primary，避免扫完回落白字。
 */
export function buildKaraokeSungCharHoldText(
  line: KaraokeLine,
  focusIdx: number,
  style?: Pick<KaraokeStyleOptions, 'sungColor' | 'roleColors' | 'sungOutlineColor'>,
): string {
  if (line.instrumental || !line.chars.length) return '';
  if (focusIdx < 0 || focusIdx >= line.chars.length) return '';
  const focus = line.chars[focusIdx];
  if (!focus || focus.roleTag) return '';

  const roleColors = resolveKaraokeRoleColors(style?.roleColors);
  const defaultSung = assColorTag(roleColors.male || style?.sungColor || DEFAULT_KARAOKE_STYLE.sungColor);
  const sungOutline = assColorTag(style?.sungOutlineColor || DEFAULT_KARAOKE_STYLE.sungOutlineColor);
  let out = '';
  for (let j = 0; j < line.chars.length; j++) {
    const ch = line.chars[j];
    if (ch.roleTag) {
      const role = ch.role || parseKaraokeRoleMarker(ch.text);
      const markerText = role ? displayKaraokeRoleMarker(ch.text, role) : ch.text;
      out += `{${ASS_ALPHA_HIDDEN}}${escAssText(markerText)}`;
      continue;
    }
    if (j === focusIdx) {
      const roleAss = karaokeRoleSungAss(ch.role, roleColors);
      const primary = roleAss ? assColorTag(roleAss) : defaultSung;
      out += `{${ASS_ALPHA_OPAQUE}\\1c${primary}\\2c${primary}\\3c${sungOutline}}${escAssText(ch.text)}`;
    } else {
      out += `{${ASS_ALPHA_HIDDEN}}${escAssText(ch.text)}`;
    }
  }
  return out;
}

/**
 * 兼容旧名：无时长时等同 hold 静态已唱（正歌扫字请用 `buildKaraokeSungCharWipeText`）。
 */
export function buildKaraokeSungCharOverlayText(
  line: KaraokeLine,
  focusIdx: number,
  style?: Pick<
    KaraokeStyleOptions,
    'sungColor' | 'unsungColor' | 'roleColors' | 'sungOutlineColor'
  >,
): string {
  return buildKaraokeSungCharHoldText(line, focusIdx, style);
}

/**
 * 兼容旧名：方案 C 正歌扫字改走整句 `buildKaraokeDialogueText`（`\\kf`）。
 * 逐字路径不再默认使用；`wipeDurSec` 忽略。
 */
export function buildKaraokeSungCharWipeText(
  line: KaraokeLine,
  focusIdx: number,
  wipeDurSec: number,
  style?: Pick<
    KaraokeStyleOptions,
    'sungColor' | 'unsungColor' | 'roleColors' | 'sungOutlineColor'
  >,
): string {
  void wipeDurSec;
  return buildKaraokeSungCharHoldText(line, focusIdx, style);
}

/**
 * 方案 C 描边半扫正文：focus 字仅已唱描边（填色全透明），其余透明占位。
 * 配合 Dialogue `\\clip` 右缘 `\t`（与字 `\\kf` 同时长）；填色仍由 KaraokeWipe `\\kf` 负责。
 */
export function buildKaraokeSungOutlineWipeCharText(
  line: KaraokeLine,
  focusIdx: number,
  style?: Pick<
    KaraokeStyleOptions,
    'sungColor' | 'unsungColor' | 'roleColors' | 'sungOutlineColor'
  >,
): string {
  if (line.instrumental || !line.chars.length) return '';
  if (focusIdx < 0 || focusIdx >= line.chars.length) return '';
  const focus = line.chars[focusIdx];
  if (!focus || focus.roleTag) return '';

  const sungOutline = assColorTag(style?.sungOutlineColor || DEFAULT_KARAOKE_STYLE.sungOutlineColor);
  // 只露描边：填色透明，避免与 \\kf 填色叠成双缝感
  const outlineOnly = '\\1a&HFF&\\2a&HFF&\\3a&H00&';
  let out = '';
  for (let j = 0; j < line.chars.length; j++) {
    const ch = line.chars[j];
    if (ch.roleTag) {
      const role = ch.role || parseKaraokeRoleMarker(ch.text);
      const markerText = role ? displayKaraokeRoleMarker(ch.text, role) : ch.text;
      out += `{${ASS_ALPHA_HIDDEN}}${escAssText(markerText)}`;
      continue;
    }
    if (j === focusIdx) {
      out += `{${outlineOnly}\\3c${sungOutline}}${escAssText(ch.text)}`;
    } else {
      out += `{${ASS_ALPHA_HIDDEN}}${escAssText(ch.text)}`;
    }
  }
  return out;
}

/**
 * 方案 C 上层整句 `\kf` 正文（正歌扫字层；Style `KaraokeWipe` Outline=0）。
 * 字间/前导静默 + `\kf`：Secondary 透明 → Primary 已唱填色（字心扫上角色色）；
 * 每音节强制 `\\bord0\\3a`，避免描边吃 Primary 变成「白心彩边」。
 * 未唱字心/黑边由 Layer0 提供；扫字层未到部分透明，勿用不透明白 Secondary 盖住已唱色。
 * 与预览 wipe 共用 char.startSec/endSec：前导与字间空隙用 \k（不填色），字身用 \kf(duration)。
 * 角色标记（roleTag）：透明占位（色+描边由 Layer1 KaraokeSung）；已唱 Primary 随 char.role 分色。
 * **勿**再叠带 pad 的 `\\clip`（会与 `\\kf` 双缝）。
 */
export function buildKaraokeDialogueText(
  line: KaraokeLine,
  style?: Pick<KaraokeStyleOptions, 'sungColor' | 'unsungColor' | 'roleColors'>,
): string {
  if (line.instrumental || !line.chars.length) return '';
  const roleColors = resolveKaraokeRoleColors(style?.roleColors);
  // 无角色标记时已唱色 = 男色（与预览 / Style Primary 一致）
  const defaultSung = assColorTag(roleColors.male || style?.sungColor || DEFAULT_KARAOKE_STYLE.sungColor);
  const unsung = assColorTag(style?.unsungColor || DEFAULT_KARAOKE_STYLE.unsungColor);
  // 扫字层：无描边；Primary 不透明；Secondary 全透明（未扫露出 L0 白字黑边）
  const wipeFace = '\\bord0\\shad0\\3a&HFF&\\1a&H00&\\2a&HFF&';
  let out = '';
  let cursor = line.startSec;
  for (const ch of line.chars) {
    const roleAss = karaokeRoleSungAss(ch.role, roleColors);
    const primary = roleAss ? assColorTag(roleAss) : defaultSung;

    if (ch.roleTag) {
      // 标签：透明占位对齐（不扫字、不画色）；标记文本规范括号形/全角冒号形
      const gap = ch.startSec - cursor;
      if (gap > 0.005) {
        out += `{\\k${secToKCentis(gap)}}`;
      }
      const role = ch.role || parseKaraokeRoleMarker(ch.text);
      const markerText = role ? displayKaraokeRoleMarker(ch.text, role) : ch.text;
      out += `{\\k0${ASS_ALPHA_HIDDEN}}${escAssText(markerText)}`;
      cursor = Math.max(cursor, ch.startSec);
      continue;
    }

    const gap = ch.startSec - cursor;
    if (gap > 0.005) {
      // 静默：不推进 Primary 填充，与预览「未到 start 不 wipe」一致
      out += `{\\k${secToKCentis(gap)}}`;
    }
    const dur = Math.max(0.01, ch.endSec - ch.startSec);
    // Primary=已唱填色；Secondary=未唱色但 alpha 全透；\\kf 扫字心
    out += `{${wipeFace}\\1c${primary}\\2c${unsung}\\kf${secToKCentis(dur)}}${escAssText(ch.text)}`;
    cursor = Math.max(cursor, ch.endSec);
  }
  return out || '{\\k0}';
}

function formatAssTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s - h * 3600 - m * 60;
  const whole = Math.floor(rest);
  const cs = Math.min(99, Math.round((rest - whole) * 100));
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${h}:${pad(m)}:${pad(whole)}.${pad(cs)}`;
}

function resolveStyle(style?: KaraokeStyleOptions): KaraokeStyleResolved {
  const legacyStroke = karaokeLyricStrokeLegacyPatch(style);
  const s = legacyStroke ? { ...style, ...legacyStroke } : style;
  const layoutMode = resolveKaraokeLayoutMode(s?.layoutMode);
  const posA = resolveKaraokePosA(s);
  const posB = resolveKaraokePosB(s);
  const indicator = resolveKaraokeIndicator(s?.indicator);
  const countdown = resolveKaraokeCountdown(s?.countdown);
  const roleColors = resolveKaraokeRoleColors(s?.roleColors);
  return {
    ...DEFAULT_KARAOKE_STYLE,
    ...(s || {}),
    fontName: String(s?.fontName || DEFAULT_KARAOKE_STYLE.fontName).trim() || DEFAULT_KARAOKE_STYLE.fontName,
    fontSize: Math.max(12, Math.min(200, Math.round(Number(s?.fontSize) || DEFAULT_KARAOKE_STYLE.fontSize))),
    marginV: Math.max(0, Math.min(500, Math.round(Number(s?.marginV ?? DEFAULT_KARAOKE_STYLE.marginV)))),
    alignment: clampKaraokeAssAlignment(s?.alignment ?? DEFAULT_KARAOKE_STYLE.alignment),
    unsungColor: normalizeKaraokeAssColor(
      s?.unsungColor,
      DEFAULT_KARAOKE_STYLE.unsungColor,
    ),
    roleColors,
    // 已唱 Primary 始终跟随男色；有角色标记时逐字 \1c 覆盖
    sungColor: roleColors.male,
    outlineColor: normalizeKaraokeAssColor(
      s?.outlineColor,
      DEFAULT_KARAOKE_STYLE.outlineColor,
    ),
    sungOutlineColor: normalizeKaraokeAssColor(
      s?.sungOutlineColor,
      DEFAULT_KARAOKE_STYLE.sungOutlineColor,
    ),
    shadowColor: normalizeKaraokeAssColor(
      s?.shadowColor,
      DEFAULT_KARAOKE_STYLE.shadowColor,
    ),
    outline: clampKaraokeOutline(
      s?.outline ?? DEFAULT_KARAOKE_STYLE.outline,
      KARAOKE_LYRIC_OUTLINE_DEFAULT,
    ),
    // 旧工程无 sungOutlineWidth：缺省用已唱默认 7（不再跟随 outline）
    sungOutlineWidth: clampKaraokeOutline(
      s?.sungOutlineWidth ?? DEFAULT_KARAOKE_STYLE.sungOutlineWidth,
      KARAOKE_LYRIC_SUNG_OUTLINE_DEFAULT,
    ),
    // 软阴影 UI 已移除：烧录/导出固定关闭（旧工程 shadow>0 由 legacy patch 迁到 0）
    shadow: KARAOKE_LYRIC_SHADOW_DEFAULT,
    layoutMode,
    posA,
    posB,
    indicator,
    countdown,
    openingTitleFontSize: clampKaraokeOpeningTitleFontSize(
      s?.openingTitleFontSize ?? DEFAULT_KARAOKE_STYLE.openingTitleFontSize,
    ),
    openingCreditFontSize: clampKaraokeOpeningCreditFontSize(
      s?.openingCreditFontSize ?? DEFAULT_KARAOKE_STYLE.openingCreditFontSize,
    ),
    openingTitleOutline: clampKaraokeOutline(
      s?.openingTitleOutline ?? DEFAULT_KARAOKE_STYLE.openingTitleOutline,
      KARAOKE_OPENING_TITLE_OUTLINE,
    ),
    openingCreditOutline: clampKaraokeOutline(
      s?.openingCreditOutline ?? DEFAULT_KARAOKE_STYLE.openingCreditOutline,
      KARAOKE_OPENING_CREDIT_OUTLINE,
    ),
    lineFadeOutSec: clampKaraokeLineFadeOutSec(
      s?.lineFadeOutSec ?? DEFAULT_KARAOKE_STYLE.lineFadeOutSec,
    ),
    ...resolveKaraokeInterludeTiming(s),
    openingTitlePos: resolveKaraokeOpeningTitlePos(s),
    openingLyricistPos: resolveKaraokeOpeningLyricistPos(s),
    openingComposerPos: resolveKaraokeOpeningComposerPos(s),
  };
}

/**
 * `\an?\q2\pos`（+ 可选 \fscx/\fscy）— 禁止自动换行；过长/靠边时适配。
 * 无 text/fontSize 时回退为居中 \an5（兼容旧调用）。
 * `scale`：烧录超采样（默认 ASS_KARAOKE_RENDER_SCALE）；布局仍按逻辑 1920。
 */
export function buildKaraokePosOverride(
  pos: KaraokePos,
  opts?: { text?: string; fontSize?: number; scale?: number },
): string {
  const text = String(opts?.text || '');
  const fontSize = Math.max(1, Number(opts?.fontSize) || DEFAULT_KARAOKE_STYLE.fontSize);
  const rs = Math.max(1, Math.round(Number(opts?.scale) || ASS_KARAOKE_RENDER_SCALE));
  const fitted = text
    ? fitKaraokeLineLayout(pos, text, fontSize)
    : {
        an: 5 as const,
        pos: {
          x: Math.max(0, Math.min(ASS_PLAY_RES_X, Math.round(Number(pos?.x) || 0))),
          y: Math.max(0, Math.min(ASS_PLAY_RES_Y, Math.round(Number(pos?.y) || 0))),
        },
        scalePercent: 100,
      };
  const parts = [
    `\\an${fitted.an}`,
    '\\q2',
    `\\pos(${assPx(fitted.pos.x, rs)},${assPx(fitted.pos.y, rs)})`,
  ];
  if (fitted.scalePercent < 100) {
    parts.push(`\\fscx${fitted.scalePercent}`, `\\fscy${fitted.scalePercent}`);
  }
  return `{${parts.join('')}}`;
}

/** 行开唱时刻：优先首个唱词字 start（跳过角色标记），否则行 start */
export function karaokeLineSingStartSec(line: KaraokeLine): number {
  const first = line.chars?.find((c) => !c.roleTag);
  const t = first != null ? Number(first.startSec) : NaN;
  if (Number.isFinite(t)) return t;
  const any = line.chars?.[0]?.startSec;
  if (Number.isFinite(any)) return Number(any);
  return Number(line.startSec) || 0;
}

/** 行唱完时刻：末个唱词字 end（跳过角色标记），否则行 end */
export function karaokeLineSingEndSec(line: KaraokeLine): number {
  if (line.chars?.length) {
    let m = Number(line.endSec) || 0;
    for (const c of line.chars) {
      if (c.roleTag) continue;
      m = Math.max(m, Number(c.endSec) || 0);
    }
    return m;
  }
  return Number(line.endSec) || 0;
}

/**
 * 倒计时点锚点：歌词行首字上方（左缘），双行时跟该行 A/B 位。
 */
export function buildKaraokeCountdownPos(
  linePos: KaraokePos,
  plainText: string,
  fontSize: number,
  offsetY: number,
): { an: 4 | 5 | 6; pos: KaraokePos } {
  const fitted = fitKaraokeLineLayout(linePos, plainText, fontSize);
  const scaledW =
    estimateAssTextWidth(plainText, fontSize) * (fitted.scalePercent / 100);
  let leftX = fitted.pos.x;
  if (fitted.an === 5 || fitted.an === 2) leftX = fitted.pos.x - scaledW / 2;
  else if (fitted.an === 6) leftX = fitted.pos.x - scaledW;
  const lift = offsetY > 0 ? offsetY : Math.round(fontSize * 0.85);
  // `\an2`：pos.y 为字底；其余中排锚点 pos.y 为字心
  const midY =
    fitted.an === 2
      ? fitted.pos.y - Math.round((fontSize * fitted.scalePercent) / 200)
      : fitted.pos.y;
  const y = Math.max(8, Math.min(ASS_PLAY_RES_Y - 8, midY - lift));
  const x = Math.max(
    ASS_EDGE_MARGIN,
    Math.min(ASS_PLAY_RES_X - ASS_EDGE_MARGIN, Math.round(leftX)),
  );
  return { an: 4, pos: { x, y } };
}

/**
 * 为单行生成倒计时 Dialogue（逐秒少一个点；各点独立 `\an5\pos`）。
 * prevEndSec：上一句唱完时刻；正间隙时倒计时收进间隙，重叠时仍尽量出满 lead。
 */
export function buildKaraokeCountdownDialogues(
  line: KaraokeLine,
  linePos: KaraokePos,
  style: KaraokeStyleResolved,
  prevEndSec?: number | null,
): string[] {
  const cd = style.countdown;
  if (!cd.enabled || line.instrumental || !line.chars.length) return [];
  const singStart = karaokeLineSingStartSec(line);
  const windowStart = karaokeCountdownWindowStartSec(singStart, prevEndSec, cd);
  if (singStart - windowStart <= 0.05) return [];
  const plain = String(line.text || line.chars.map((c) => c.text).join('')).replace(/\r?\n/g, '');
  const { pos: anchor } = buildKaraokeCountdownPos(linePos, plain, style.fontSize, cd.offsetY);
  // 点色跟随本句即将开唱歌词的角色已唱色（非固定 countdown.color）
  const leadAss = assColorTag(karaokeLineLeadSungAss(line, style.roleColors));
  const colorTag = `\\1c${leadAss}\\2c${leadAss}`;
  const events: string[] = [];
  for (let lit = cd.count; lit >= 1; lit--) {
    const periodStart = singStart - lit * cd.intervalSec;
    const periodEnd = singStart - (lit - 1) * cd.intervalSec;
    if (periodEnd <= windowStart + 0.01) continue;
    if (periodEnd <= 0) continue;
    const start = Math.max(windowStart, Math.max(0, periodStart));
    if (start >= periodEnd - 0.01) continue;
    // Layer 1：叠在即将演唱行上方（可与上一句填字时间重叠，位置不同）
    for (let i = 0; i < lit; i++) {
      // 每句 KaraokeCD：仅用行锚+spacing（开场组锚 countdown.anchor 留给 OpeningCD）
      const pos = karaokeCountdownDefaultDotPos(anchor, i, cd.spacing);
      const posTag = `{\\an5\\q2${colorTag}\\pos(${assPx(pos.x)},${assPx(pos.y)})}`;
      events.push(
        `Dialogue: 1,${formatAssTime(start)},${formatAssTime(periodEnd)},KaraokeCD,,0,0,0,,${posTag}${COUNTDOWN_DOT_CHAR}`,
      );
    }
  }
  return events;
}

/** 首句人声开唱时刻（开场时间线锚点）；无首句时用固定约 4 秒 */
export function karaokeOpeningEndSec(project: KaraokeProject): number {
  const offset = Number(project.globalOffsetSec) || 0;
  // 勿传 asrWords：已对齐 lines + offset 后再用未偏移 words 重映射会打乱拆行字级
  const lines = prepareKaraokeLinesForRender(
    applyGlobalOffsetToLines(project.lines || [], offset),
    undefined,
    project.lyrics,
  );
  const singable = lines.filter((l) => !l.instrumental && (l.chars?.length || 0) > 0);
  if (singable.length > 0) {
    const first = karaokeLineSingStartSec(singable[0]);
    if (Number.isFinite(first)) {
      // 首句已在极早时刻开唱：不开场叠层（勿回退到 4s 盖住演唱）
      if (first <= 0.05) return 0;
      return first;
    }
  }
  return KARAOKE_OPENING_FALLBACK_SEC;
}

/** 开场渐隐时长：不超过开场窗，默认 KARAOKE_OPENING_FADE_OUT_SEC */
export function karaokeOpeningFadeOutSec(endSec: number): number {
  return karaokeOpeningTimeline(endSec).fadeSec;
}

/** 开场倒计时+渐隐时间线（与预览共用；lead-in 上限读 style） */
export function karaokeOpeningTimelineForProject(project: KaraokeProject): KaraokeOpeningTimeline {
  const { countdownLeadInMaxSec } = resolveKaraokeInterludeTiming(project.style);
  return karaokeOpeningTimeline(karaokeOpeningEndSec(project), {
    leadInMaxSec: countdownLeadInMaxSec,
  });
}

/**
 * 左行上方倒计时蓝点 Dialogue（开场 / 间奏再入共用）。
 * 每点一条：窗起点起亮 → hold 后按右→左依次熄灭；末尾 `\fad(0,ms)` 渐隐（勿硬切）。
 * 组锚：自定义 countdown.anchor 或 Line A 上方默认；各点 `\an5\pos` = 组锚 + i×spacing。
 */
export function buildKaraokeCountdownWindowDialogues(
  timeline: Pick<
    KaraokeOpeningTimeline,
    | 'countdownStart'
    | 'countdownEnd'
    | 'maxDots'
    | 'intervalSec'
    | 'countdownDur'
    | 'holdSec'
    | 'dotFadeSec'
  >,
  lineAPos?: KaraokePos | null,
  countdown?: KaraokeCountdownOptions | null,
  /** 即将开唱行已唱色（ASS BGR）；缺省男蓝 */
  leadSungAss?: string | null,
): string[] {
  if (timeline.maxDots <= 0 || timeline.countdownDur <= 0.05) return [];
  const cd = resolveKaraokeCountdown(countdown);
  const anchor = karaokeOpeningCountdownAnchorPos(lineAPos || DEFAULT_KARAOKE_POS_A);
  const events: string[] = [];
  const { countdownStart, countdownEnd, maxDots, intervalSec, holdSec, dotFadeSec } = timeline;
  const hold = Math.max(0, Number(holdSec) || 0);
  const interval = Math.max(1e-6, Number(intervalSec) || 1);
  const fadeSec = Math.max(0, Number(dotFadeSec) > 0 ? Number(dotFadeSec) : interval);
  const leadAss = assColorTag(
    (leadSungAss && String(leadSungAss).trim()) || KARAOKE_ROLE_SUNG_COLORS.male,
  );
  const colorTag = `\\1c${leadAss}\\2c${leadAss}`;

  for (let i = 0; i < maxDots; i++) {
    const start = Math.max(0, countdownStart);
    // 右点先灭：点 i 结束于 start + hold + (maxDots−i)×interval
    const end = Math.min(
      countdownEnd,
      countdownStart + hold + (maxDots - i) * interval,
    );
    if (end <= start + 0.01) continue;
    const fadeMs = Math.max(
      0,
      Math.round(Math.min(fadeSec, Math.max(0, end - start)) * 1000),
    );
    const fadTag = fadeMs > 0 ? `\\fad(0,${fadeMs})` : '';
    const pos = karaokeCountdownResolvedDotPos(cd, anchor, i);
    const posTag = `{\\an5\\q2${fadTag}${colorTag}\\pos(${assPx(pos.x)},${assPx(pos.y)})}`;
    events.push(
      `Dialogue: 3,${formatAssTime(start)},${formatAssTime(end)},KaraokeOpeningCD,,0,0,0,,${posTag}${COUNTDOWN_DOT_CHAR}`,
    );
  }
  return events;
}

/**
 * 开场左行上方倒计时蓝点 Dialogue（hold 全亮后逐秒渐隐熄灭；仅开场，非每句歌词）。
 * 时间窗：[firstSingStart−leadIn, firstSingStart)，满窗 leadIn=7s。
 * 点色跟随首句歌词角色已唱色。
 */
export function buildKaraokeOpeningCountdownDialogues(
  timeline: KaraokeOpeningTimeline,
  lineAPos?: KaraokePos | null,
  countdown?: KaraokeCountdownOptions | null,
  leadSungAss?: string | null,
): string[] {
  return buildKaraokeCountdownWindowDialogues(timeline, lineAPos, countdown, leadSungAss);
}

/**
 * 间奏再入左行上方倒计时蓝点（与开场同款 KaraokeOpeningCD / 锚点 / 点位样式）。
 * 点色跟随即将开唱那句角色已唱色。
 */
export function buildKaraokeReentryCountdownDialogues(
  timeline: KaraokeReentryTimeline,
  lineAPos?: KaraokePos | null,
  countdown?: KaraokeCountdownOptions | null,
  leadSungAss?: string | null,
): string[] {
  return buildKaraokeCountdownWindowDialogues(timeline, lineAPos, countdown, leadSungAss);
}

/**
 * 开场 Dialogue（曲名字顶 Y337≈x961、署名字顶 Y694/822 左缘≈114/115；三者皆白字蓝描边；空署名→致音；左行上方蓝点倒计时）。
 * 时间线：曲名/署名在 lyricAppear 前 `\fad` 渐隐完毕 → [lyricAppear, firstSingStart) 蓝点+首句白字 → 开唱扫字。
 * 烧录始终写入；时长见 karaokeOpeningEndSec / karaokeOpeningTimeline。
 */
export function buildKaraokeOpeningDialogues(project: KaraokeProject): string[] {
  const timeline = karaokeOpeningTimelineForProject(project);
  const style = resolveStyle(project.style);
  const lineA = style.posA;
  const lines = prepareKaraokeLinesForRender(
    applyGlobalOffsetToLines(project.lines || [], Number(project.globalOffsetSec) || 0),
    undefined,
    project.lyrics,
  );
  const firstSing = lines.find((l) => !l.instrumental && (l.chars?.length || 0) > 0) || null;
  const openingLeadAss = karaokeLineLeadSungAss(firstSing, style.roleColors);
  const events: string[] = [
    ...buildKaraokeOpeningCountdownDialogues(
      timeline,
      lineA,
      style.countdown,
      openingLeadAss,
    ),
  ];

  const titleEnd = timeline.endSec;
  // 无片头空档时仍可有倒计时；曲名/署名仅在 titleEnd>0 时写入
  if (titleEnd > 0.05) {
    const fadeMs = Math.round(timeline.fadeSec * 1000);
    // `\fad` 在 Dialogue 末段渐隐；End = lyricAppear（倒计时/提前歌词起点），正歌期不再出现
    const fadTag = fadeMs > 0 ? `\\fad(0,${fadeMs})` : '';
    const start = formatAssTime(0);
    const end = formatAssTime(titleEnd);
    const primary = assColorTag(KARAOKE_OPENING_PRIMARY_ASS);
    const outline = assColorTag(KARAOKE_OPENING_OUTLINE_ASS);
    const titleFs = style.openingTitleFontSize;
    const creditFs = style.openingCreditFontSize;
    const titleBord = style.openingTitleOutline;
    const creditBord = style.openingCreditOutline;
    const songTitle = String(project.songTitle || '').trim();
    const titleSoftLogical = karaokeOutlineCornerBlur(titleBord);
    const creditSoftLogical = karaokeOutlineCornerBlur(creditBord);
    const titleSoft =
      titleSoftLogical > 0 ? `\\blur${assBlurPx(titleSoftLogical).toFixed(2)}` : '';
    const creditSoft =
      creditSoftLogical > 0 ? `\\blur${assBlurPx(creditSoftLogical).toFixed(2)}` : '';
    if (songTitle) {
      const titlePos = style.openingTitlePos;
      // `\an8`：pos Y = 字顶（默认 460）；轻 `\blur` 柔化描边尖角
      const tag = `{\\an8\\q2\\pos(${assPx(titlePos.x)},${assPx(titlePos.y)})${fadTag}${titleSoft}\\fs${assPx(titleFs)}\\bord${assPx(titleBord)}\\shad0\\1c${primary}\\3c${outline}\\4c&H00000000&}`;
      events.push(
        `Dialogue: 2,${start},${end},KaraokeOpeningTitle,,0,0,0,,${tag}${escAssText(songTitle)}`,
      );
    }
    const lyricist = resolveKaraokeCreditName(project.lyricist);
    const composer = resolveKaraokeCreditName(project.composer);
    const lyricistPos = style.openingLyricistPos;
    const composerPos = style.openingComposerPos;
    // `\an7`：pos = 左上角字顶（默认左 90 / 顶 800·925）；与曲名同色系白填蓝描边
    const creditTag = (x: number, y: number) =>
      `{\\an7\\q2\\pos(${assPx(x)},${assPx(y)})${fadTag}${creditSoft}\\fs${assPx(creditFs)}\\bord${assPx(creditBord)}\\shad0\\1c${primary}\\3c${outline}\\4c&H00000000&}`;
    events.push(
      `Dialogue: 2,${start},${end},KaraokeOpeningCredit,,0,0,0,,${creditTag(lyricistPos.x, lyricistPos.y)}${escAssText(`作詞：${lyricist}`)}`,
    );
    events.push(
      `Dialogue: 2,${start},${end},KaraokeOpeningCredit,,0,0,0,,${creditTag(composerPos.x, composerPos.y)}${escAssText(`作曲：${composer}`)}`,
    );
  }
  return events;
}
/**
 * 生成完整 ASS 文件内容（方案 C）。
 * Style Karaoke：Primary=已唱色；Secondary=未唱白；OutlineColour=未唱描边（供 L0）；
 * Style KaraokeWipe：同上色，但 Outline=0（专供 L1 `\\kf`，防 Primary 渗描边）；
 * Style KaraokeSung：已唱描边色/粗细（hold/角色）。
 * Shadow = 阴影距离（默认 3）。正歌每句：
 *   Layer 0 整行软阴影底（行可见期一条；填色/描边透明；`\\shad`+半透明 Back+blur）；
 *   Layer 0 整行未唱白字+未唱描边（Style=Karaoke；扫字期黑边靠此层）；
 *   Layer 0 角色标记（若有）透明占位；
 *   Layer 1 角色标记（若有）KaraokeSung + 已唱描边（`\\shad0`）；
 *   Layer 1 整句 `\\kf` 填色扫字（Style=KaraokeWipe；`\\bord0`；无 clip）；
 *   Layer 1 逐字 hold（字 endSec→行末；KaraokeSung 已唱填色+白边；无 clip / 无 kf）；
 *   PlayRes×ASS_KARAOKE_RENDER_SCALE；烧录再 2× 栅格超采样（见 karaokeBurn）。
 * 未唱软阴影 ≠ 去掉描边：硬环是 `\\bord`+OutlineColour；右下淡影整行一层 Shadow+半透明 Back+blur。
 * 开场仍用轻 blur 专治硬边锯齿（`\\shad0`）。
 * 位置由 `\an\q2\pos` 覆盖；dualAlternate 时奇偶行用 posA/posB。
 * 双行时下一句可在对侧提前挂上；同槽须等上一句 `\fad` 渐隐到透明后再换。
 * 开场：曲名+作词作曲 `\fad` 渐隐 → 开唱前 7s 左行上方蓝点（hold3s 后逐秒渐隐扣点）+ 首句白字 → 开唱扫字。
 * 长间奏（相邻可唱行 gap>6s）清屏；倒计时再入仅 gap≥7s 且全曲最长那一次（最多 1 次）。
 * 每句歌词上方 KaraokeCD 仅 countdown.enabled===true 时写入（默认关）。
 *
 * 角色分色：歌词 `(男)` / `男：` 等标记状态机 → 逐字 \\1c（style.roleColors）；无标记用男色（= sungColor）。
 */

export function buildKaraokeAss(project: KaraokeProject): string {
  const style = resolveStyle(project.style);
  const offset = Number(project.globalOffsetSec) || 0;
  const rs = ASS_KARAOKE_RENDER_SCALE;
  // 勿传 asrWords：已对齐 lines 只做展开/过滤；重映射会用未偏移 words 破坏字级
  const lines = prepareKaraokeLinesForRender(
    applyGlobalOffsetToLines(project.lines || [], offset),
    undefined,
    project.lyrics,
  );

  const outlineLogical = karaokeAssBordWidth(style.outline);
  const sungOutlineLogical = karaokeAssBordWidth(style.sungOutlineWidth);
  const outline = assPx(outlineLogical, rs).toFixed(1);
  const sungOutlineW = assPx(sungOutlineLogical, rs).toFixed(1);
  const shadow = assPx(karaokeLyricShadowDistance(style.shadow), rs).toFixed(1);
  const styleFontSize = assPx(style.fontSize, rs);
  const marginLR = assPx(ASS_EDGE_MARGIN, rs);
  // Style BackColour 按各自描边粗细调透明度；Dialogue 再按 bord 收束 \\shad
  const softBackUnsung = karaokeSoftShadowBackColour(style.shadowColor, style.outline);
  const softBackSung = karaokeSoftShadowBackColour(style.shadowColor, style.sungOutlineWidth);
  const writeCountdown = style.countdown.enabled === true;
  const cdColor = style.countdown.color.endsWith('&')
    ? style.countdown.color
    : `${style.countdown.color}`;
  const cdSize = assPx(style.countdown.size, rs);
  const karaokeCdStyle = writeCountdown
    ? `Style: KaraokeCD,Arial,${cdSize},${cdColor},${cdColor},&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1\n`
    : '';
  // 开场：曲名+作词/作曲均为白字蓝描边（字顶锚）；左行上方蓝点倒计时（开场+间奏再入共用）
  const titleBord = assPx(style.openingTitleOutline, rs).toFixed(1);
  const creditBord = assPx(style.openingCreditOutline, rs).toFixed(1);
  const openingStyles = `Style: KaraokeOpeningTitle,${style.fontName},${assPx(style.openingTitleFontSize, rs)},${KARAOKE_OPENING_PRIMARY_ASS},${KARAOKE_OPENING_PRIMARY_ASS},${KARAOKE_OPENING_OUTLINE_ASS},&H00000000,0,0,0,0,100,100,0,0,1,${titleBord},0,8,${marginLR},${marginLR},0,1
Style: KaraokeOpeningCredit,${style.fontName},${assPx(style.openingCreditFontSize, rs)},${KARAOKE_OPENING_PRIMARY_ASS},${KARAOKE_OPENING_PRIMARY_ASS},${KARAOKE_OPENING_OUTLINE_ASS},&H00000000,0,0,0,0,100,100,0,0,1,${creditBord},0,7,${marginLR},${marginLR},0,1
Style: KaraokeOpeningCD,Arial,${cdSize},&H00FF0000,&H00FF0000,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1
`;

  // WrapStyle 2 = 不自动换行（仅显式 \N；我们不插入 \N）
  const header = `[Script Info]
Title: NEXFLOW Karaoke
ScriptType: v4.00+
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: ${ASS_PLAY_RES_X * rs}
PlayResY: ${ASS_PLAY_RES_Y * rs}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Karaoke,${style.fontName},${styleFontSize},${style.sungColor},${style.unsungColor},${style.outlineColor},${softBackUnsung},0,0,0,0,100,100,0,0,1,${outline},${shadow},5,${marginLR},${marginLR},0,1
Style: KaraokeWipe,${style.fontName},${styleFontSize},${style.sungColor},${style.unsungColor},${style.outlineColor},&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,${marginLR},${marginLR},0,1
Style: KaraokeSung,${style.fontName},${styleFontSize},${style.sungColor},${style.unsungColor},${style.sungOutlineColor},${softBackSung},0,0,0,0,100,100,0,0,1,${sungOutlineW},${shadow},5,${marginLR},${marginLR},0,1
${openingStyles}${karaokeCdStyle}[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const openingTl = karaokeOpeningTimelineForProject(project);
  const events: string[] = [...buildKaraokeOpeningDialogues(project)];
  const singable = lines.filter((l) => !l.instrumental && l.chars.length > 0);
  const lineFadeSec = style.lineFadeOutSec;
  const dual = style.layoutMode === 'dualAlternate';
  const lineAPos = style.posA || defaultKaraokePosAForLayout(style.layoutMode);
  const clearGapSec = style.interludeClearGapSec;
  const reentryGapSec = style.countdownReentryGapSec;
  const leadInMaxSec = style.countdownLeadInMaxSec;

  const singMeta = singable.map((l) => ({
    singStart: karaokeLineSingStartSec(l),
    singEnd: karaokeLineSingEndSec(l),
  }));

  // 倒计时再入：≥再入阈值间隙中取最长，全曲最多 1 次（开场另计）
  const countdownReentryIndexes = karaokeSelectCountdownReentryLineIndexes(singMeta, {
    fadeOutSec: lineFadeSec,
    gapThresholdSec: reentryGapSec,
    leadInMaxSec,
  });
  const countdownReentrySet = new Set(countdownReentryIndexes);
  for (const i of countdownReentryIndexes) {
    const re = karaokeReentryTimeline(singMeta[i].singStart, singMeta[i - 1].singEnd, {
      fadeOutSec: lineFadeSec,
      gapThresholdSec: reentryGapSec,
      leadInMaxSec,
    });
    if (re) {
      events.push(
        ...buildKaraokeReentryCountdownDialogues(
          re,
          lineAPos,
          style.countdown,
          karaokeLineLeadSungAss(singable[i], style.roleColors),
        ),
      );
    }
  }

  for (let dialogueIndex = 0; dialogueIndex < singable.length; dialogueIndex++) {
    const line = singable[dialogueIndex];
    const singStart = singMeta[dialogueIndex].singStart;
    const singEnd = singMeta[dialogueIndex].singEnd;
    const useB = dual && dialogueIndex % 2 === 1;
    const nativePos = useB
      ? style.posB || DEFAULT_KARAOKE_POS_B
      : style.posA || defaultKaraokePosAForLayout(style.layoutMode);
    const plain = String(line.text || line.chars.map((c) => c.text).join('')).replace(/\r?\n/g, '');

    // 同槽下一句开唱点：用于压缩本句 fade；长间奏中间隙大，仍按 singEnd 立刻渐隐（不 hold）
    const nextSameIdx = dual ? dialogueIndex + 2 : dialogueIndex + 1;
    const nextSameSingStart =
      nextSameIdx < singable.length ? singMeta[nextSameIdx].singStart : null;
    const dlgEnd = karaokeLineVisibleEndSec(singEnd, nextSameSingStart, lineFadeSec);

    const fadeOutSec = Math.max(
      0,
      Math.min(lineFadeSec, Math.max(0, dlgEnd - singEnd)),
    );
    const fadeOutMs = Math.round(fadeOutSec * 1000);
    const fadInner = fadeOutMs > 0 ? `\\fad(0,${fadeOutMs})` : '';

    const pushDialogue = (
      pos: KaraokePos,
      segStart: number,
      segEnd: number,
      withFade: boolean,
    ) => {
      if (!(segEnd > segStart + 0.02)) return;
      const lineForAss: KaraokeLine = { ...line, startSec: segStart, endSec: segEnd };
      const hasLyricChar = lineForAss.chars.some((c) => !c.roleTag);
      if (!hasLyricChar && !lineForAss.chars.some((c) => c.roleTag)) return;
      let posInner = buildKaraokePosOverride(pos, {
        text: plain,
        fontSize: style.fontSize,
        scale: rs,
      });
      if (posInner.startsWith('{') && posInner.endsWith('}')) {
        posInner = posInner.slice(1, -1);
      }
      const fadPrefix = withFade && fadInner ? fadInner : '';
      // bord = UI 原值×超采样（outline=0 → \\bord0）；
      // 软阴影：整行一条 Dialogue（\\shad）；逐字层一律 \\shad0，避免 hold 越多影越黑
      const unsungShadLogical = karaokeLyricShadowDistanceForBord(style.shadow, style.outline);
      const unsungShad = unsungShadLogical > 0 ? assPx(unsungShadLogical, rs) : 0;
      const lineShadTag = unsungShad > 0 ? `\\shad${unsungShad.toFixed(1)}` : '\\shad0';
      const lineShadowBlurLogical =
        unsungShadLogical > 0 ? karaokeUnsungSoftShadowBlur(style.outline, style.shadow) : 0;
      const lineShadowSoft =
        lineShadowBlurLogical > 0
          ? `\\blur${assBlurPx(lineShadowBlurLogical, rs).toFixed(2)}`
          : '\\blur0';
      // 逐字层 blur 仅描边抗锯齿（不含软阴影虚边，影已在整行底）
      const unsungBlurLogical = karaokeOutlineCornerBlur(style.outline);
      const sungBlurLogical = karaokeOutlineCornerBlur(style.sungOutlineWidth);
      const unsungOutlineSoft =
        unsungBlurLogical > 0
          ? `\\blur${assBlurPx(unsungBlurLogical, rs).toFixed(2)}`
          : '\\blur0';
      const sungOutlineSoft =
        sungBlurLogical > 0 ? `\\blur${assBlurPx(sungBlurLogical, rs).toFixed(2)}` : '\\blur0';
      const unsungOutlineCol = assColorTag(style.outlineColor);
      const softBackTag = assColorTag(softBackUnsung);
      // 整行软阴影底：填色/描边透明，只画一层右下影（与字形对齐）
      const lineShadowTag = `{${fadPrefix}${lineShadowSoft}\\bord0\\1a&HFF&\\2a&HFF&\\3a&HFF&${lineShadTag}\\4c${softBackTag}${posInner}}`;
      // 方案 C Layer0：整行未唱描边（扫字期描边靠此；上层 \\kf 用 \\bord0）
      const basePosTag = `{${fadPrefix}${unsungOutlineSoft}\\bord${outline}\\3c${unsungOutlineCol}\\shad0${posInner}}`;
      const sungOutline = assColorTag(style.sungOutlineColor);
      // hold/角色：KaraokeSung + 已唱描边；\\shad0；正歌 hold 不用 clip（防竖线伪影）
      const holdPosTag = `{${fadPrefix}${sungOutlineSoft}\\bord${sungOutlineW}\\3c${sungOutline}\\shad0${posInner}}`;
      const rolePosTag = `{${fadPrefix}${sungOutlineSoft}\\bord${sungOutlineW}\\3c${sungOutline}\\shad0${posInner}}`;
      // 方案 C 扫字：KaraokeWipe(Outline=0) + 整句 \\kf；音节内再钉 bord0/3a（勿叠 clip）
      const kfPosTag = `{${fadPrefix}\\blur0\\bord0\\shad0\\3a&HFF&${posInner}}`;
      const t0 = formatAssTime(segStart);
      const t1 = formatAssTime(Math.max(segStart + 0.05, segEnd));
      // Layer 0：整行软阴影底（先画，再叠字形）
      const lineShadowBody = buildKaraokeDialoguePlainLineText(lineForAss);
      if (lineShadowBody && unsungShad > 0) {
        events.push(
          `Dialogue: 0,${t0},${t1},Karaoke,,0,0,0,,${lineShadowTag}${lineShadowBody}`,
        );
      }
      // Layer 0：角色仅透明占位（描边改由 Layer1 KaraokeSung 画）
      const roleBaseBody = buildKaraokeDialogueBaseRoleMarkersText(lineForAss, style);
      if (roleBaseBody) {
        events.push(
          `Dialogue: 0,${t0},${t1},Karaoke,,0,0,0,,{${fadPrefix}\\blur0\\bord0\\shad0${posInner}}${roleBaseBody}`,
        );
      }
      // Layer 0：整行未唱白字+未唱描边（行可见期；角色透明）
      const baseBody = buildKaraokeDialogueBaseText(lineForAss, style);
      if (baseBody) {
        events.push(`Dialogue: 0,${t0},${t1},Karaoke,,0,0,0,,${basePosTag}${baseBody}`);
      }
      // Layer 1：整句 \\kf 填色（Style KaraokeWipe Outline=0；无 clip）
      const kfBody = buildKaraokeDialogueText(lineForAss, style);
      if (kfBody && hasLyricChar) {
        events.push(`Dialogue: 1,${t0},${t1},KaraokeWipe,,0,0,0,,${kfPosTag}${kfBody}`);
      }
      // Layer 1：角色标记（在 kf 之上，已唱描边不被 bord0 盖住）
      const roleBody = buildKaraokeRoleMarkersOverlayText(lineForAss, style);
      if (roleBody) {
        events.push(`Dialogue: 1,${t0},${t1},KaraokeSung,,0,0,0,,${rolePosTag}${roleBody}`);
      }
      // Layer 1：字唱完后 hold 已唱填色+白边（无 clip，避免竖线伪影）
      for (let ci = 0; ci < lineForAss.chars.length; ci++) {
        const ch = lineForAss.chars[ci];
        if (!ch || ch.roleTag) continue;
        const charStart = Math.max(segStart, Number(ch.startSec) || segStart);
        const rawEnd = Number(ch.endSec);
        const charEnd = Math.max(
          charStart + 0.01,
          Number.isFinite(rawEnd) ? rawEnd : charStart + 0.01,
        );
        const holdStart = Math.min(
          segEnd,
          ensureAssDialogueEndSec(charStart, Math.min(charEnd, segEnd), 1),
        );
        if (segEnd > holdStart + 0.02) {
          const holdBody = buildKaraokeSungCharHoldText(lineForAss, ci, style);
          if (holdBody) {
            events.push(
              `Dialogue: 1,${formatAssTime(holdStart)},${t1},KaraokeSung,,0,0,0,,${holdPosTag}${holdBody}`,
            );
          }
        }
      }
    };

    if (writeCountdown) {
      const prevEnd = dialogueIndex > 0 ? singMeta[dialogueIndex - 1].singEnd : null;
      events.push(...buildKaraokeCountdownDialogues(line, nativePos, style, prevEnd));
    }

    const firstAppear =
      openingTl.countdownDur > 0.05 ? openingTl.lyricAppearSec : undefined;
    const prevAdjEnd =
      dialogueIndex > 0 ? singMeta[dialogueIndex - 1].singEnd : null;
    const prevSameIdx = dual ? dialogueIndex - 2 : dialogueIndex - 1;
    const prevSameEnd =
      prevSameIdx >= 0 ? singMeta[prevSameIdx].singEnd : null;
    const isCountdownReentry = countdownReentrySet.has(dialogueIndex);
    const clampOpts = {
      fadeOutSec: lineFadeSec,
      gapThresholdSec: clearGapSec,
      countdownGapThresholdSec: reentryGapSec,
      leadInMaxSec,
      countdownReentryIndexes: countdownReentrySet,
    };

    let dlgStart: number;
    if (dialogueIndex === 0) {
      dlgStart = karaokeLineDisplayAppearSec(singStart, {
        isFirstLine: true,
        firstLyricAppearSec: firstAppear,
        fadeOutSec: lineFadeSec,
      });
    } else if (dual && dialogueIndex === 1 && prevSameIdx < 0) {
      // 首句 B：与 Line A 同时提前显词（无同槽上一句）
      let a0Start = karaokeLineDisplayAppearSec(singMeta[0].singStart, {
        isFirstLine: true,
        firstLyricAppearSec: firstAppear,
        fadeOutSec: lineFadeSec,
      });
      dlgStart = Math.min(singStart, a0Start);
      dlgStart = karaokeClampAppearAfterInterludes(
        dlgStart,
        singStart,
        dialogueIndex,
        singMeta,
        clampOpts,
      );
    } else {
      dlgStart = karaokeLineDisplayAppearSec(singStart, {
        prevAdjacentSingEndSec: prevAdjEnd,
        prevSameSlotSingEndSec: prevSameEnd,
        fadeOutSec: lineFadeSec,
        isCountdownReentry,
        gapThresholdSec: clearGapSec,
        countdownGapThresholdSec: reentryGapSec,
        leadInMaxSec,
      });
      dlgStart = karaokeClampAppearAfterInterludes(
        dlgStart,
        singStart,
        dialogueIndex,
        singMeta,
        clampOpts,
      );
    }
    pushDialogue(nativePos, dlgStart, dlgEnd, true);
  }

  return header + events.join('\n') + (events.length ? '\n' : '');
}
