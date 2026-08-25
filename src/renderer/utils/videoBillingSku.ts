/**
 * NEXFLOW 视频复合计费 Key（与主进程 src/main/utils/videoBillingSku.ts 一致）V2.3
 */

function lc(s: string): string {
  return String(s || '').trim().toLowerCase();
}

function joinKey(...parts: (string | undefined | null | false)[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (p == null || p === false) continue;
    const t = lc(String(p));
    if (!t) continue;
    out.push(t);
  }
  return out.join('-');
}

/** Grok video3 可选时长（秒） */
export const GROK3_DURATION_SEC_OPTIONS = [6, 10, 15, 30] as const;
/** 全能视频X：文生/图生时长 6|8|10|15|30 */
export const RHART_VIDEO_X_DURATION_SEC_OPTIONS = [6, 8, 10, 15, 30] as const;

/** Grok video3（稳定版）可选时长（秒） */
export const GROK3_STABLE_DURATION_SEC_OPTIONS = [6, 10] as const;

/** LTX2.3 图生/文生可选时长（秒） */
export const LTX23_DURATION_SEC_OPTIONS = [5, 10, 15] as const;

/** MiniMax-H3 文生/图生/多参可选时长（秒） */
export const MINIMAX_H3_DURATION_SEC_OPTIONS = [6, 10, 15, 20] as const;
/** MiniMax-H3 音参计费档：按参考音时长向上取整到档（无 5s） */
export const MINIMAX_H3_AUDIO_DURATION_SEC_OPTIONS = [6, 10, 15, 20] as const;

/** Seedance 2.0 Fast 多模态视频可选时长（秒） */
export const SEEDANCE_DURATION_SEC_OPTIONS = [5, 10, 15] as const;

export type SeedanceDurationChoice = `${(typeof SEEDANCE_DURATION_SEC_OPTIONS)[number]}`;

export const SEEDANCE_FAST_RESOLUTION_OPTIONS = ['720p', '1080p'] as const;
export const SEEDANCE_MINI_RESOLUTION_OPTIONS = ['480p', '720p', '1080p', '2k', '4k'] as const;

export type SeedanceFastResolutionChoice = (typeof SEEDANCE_FAST_RESOLUTION_OPTIONS)[number];
export type SeedanceMiniResolutionChoice = (typeof SEEDANCE_MINI_RESOLUTION_OPTIONS)[number];
export type SeedanceResolutionChoice = SeedanceFastResolutionChoice | SeedanceMiniResolutionChoice;

function seedanceMiniResSeg(raw: string): SeedanceMiniResolutionChoice {
  const s = lc(raw);
  if (s === '4k' || s === '2160p') return '4k';
  if (s === '2k' || s === '1440p') return '2k';
  if (s === '1080p' || s === '1080' || s === '1920x1080' || s === '1080x1920') return '1080p';
  if (s === '480p' || s === '480') return '480p';
  return '720p';
}

function seedanceFastResSeg(raw: string): SeedanceFastResolutionChoice {
  const s = lc(raw);
  if (s === '1080p' || s === '1080' || s === '1920x1080' || s === '1080x1920') return '1080p';
  return '720p';
}

/** Seedance 分辨率：Fast 仅 720p/1080p；Mini 另支持 2k/4k */
export function coerceSeedanceResolution(
  raw: string | undefined | null,
  model: string,
): SeedanceResolutionChoice {
  if (lc(model) === 'seedance-2.0-mini') return seedanceMiniResSeg(String(raw ?? ''));
  return seedanceFastResSeg(String(raw ?? ''));
}

/** Seedance API ratio：adaptive | 16:9 | 4:3 | 1:1 | 3:4 | 9:16 | 21:9 */
export const SEEDANCE_RATIO_OPTIONS = [
  'adaptive',
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16',
  '21:9',
] as const;

export type SeedanceRatioChoice = (typeof SEEDANCE_RATIO_OPTIONS)[number];

export function coerceSeedanceRatio(
  raw: string | undefined | null,
  fallback: SeedanceRatioChoice = 'adaptive',
): SeedanceRatioChoice {
  const s = String(raw ?? '').trim();
  return (SEEDANCE_RATIO_OPTIONS as readonly string[]).includes(s)
    ? (s as SeedanceRatioChoice)
    : fallback;
}

export function normalizeSeedanceDurationSec(raw: string | number | undefined, fallback = 10): number {
  const allowed = SEEDANCE_DURATION_SEC_OPTIONS;
  const n = parseInt(String(raw ?? '').trim(), 10);
  if ((allowed as readonly number[]).includes(n)) return n;
  if (!Number.isFinite(n)) return fallback;
  let best: number = fallback;
  let minDist = Infinity;
  for (const v of allowed) {
    const d = Math.abs(v - n);
    if (d < minDist) {
      minDist = d;
      best = v;
    }
  }
  return best;
}

export function normalizeSeedanceDurationChoice(
  raw: string | number | undefined,
  fallback = 10,
): SeedanceDurationChoice {
  return String(normalizeSeedanceDurationSec(raw, fallback)) as SeedanceDurationChoice;
}

export const GEMINI_OMNI_DURATION_SEC_OPTIONS = [6, 8, 10] as const;

export type GeminiOmniDurationChoice = `${(typeof GEMINI_OMNI_DURATION_SEC_OPTIONS)[number]}`;

/** 全能视频 Omni Flash：6 / 8 / 10 秒 */
export const GEMINI_OMNI_FLASH_DURATION_SEC_OPTIONS = [6, 8, 10] as const;

export type GeminiOmniFlashDurationChoice = `${(typeof GEMINI_OMNI_FLASH_DURATION_SEC_OPTIONS)[number]}`;

export function normalizeGeminiOmniDurationSec(raw: string | number | undefined, fallback = 6): number {
  const allowed = GEMINI_OMNI_DURATION_SEC_OPTIONS;
  const n = parseInt(String(raw ?? '').trim(), 10);
  if ((allowed as readonly number[]).includes(n)) return n;
  if (!Number.isFinite(n)) return fallback;
  let best: number = fallback;
  let minDist = Infinity;
  for (const v of allowed) {
    const d = Math.abs(v - n);
    if (d < minDist) {
      minDist = d;
      best = v;
    }
  }
  return best;
}

export function normalizeGeminiOmniDurationChoice(
  raw: string | number | undefined,
  fallback = 6,
): GeminiOmniDurationChoice {
  return String(normalizeGeminiOmniDurationSec(raw, fallback)) as GeminiOmniDurationChoice;
}

export function normalizeGeminiOmniFlashDurationSec(raw: string | number | undefined, fallback = 6): number {
  const allowed = GEMINI_OMNI_FLASH_DURATION_SEC_OPTIONS;
  const n = parseInt(String(raw ?? '').trim(), 10);
  if ((allowed as readonly number[]).includes(n)) return n;
  if (!Number.isFinite(n)) return fallback;
  let best: number = fallback;
  let minDist = Infinity;
  for (const v of allowed) {
    const d = Math.abs(v - n);
    if (d < minDist) {
      minDist = d;
      best = v;
    }
  }
  return best;
}

export function normalizeGeminiOmniFlashDurationChoice(
  raw: string | number | undefined,
  fallback = 6,
): GeminiOmniFlashDurationChoice {
  return String(normalizeGeminiOmniFlashDurationSec(raw, fallback)) as GeminiOmniFlashDurationChoice;
}

export type Ltx23DurationChoice = `${(typeof LTX23_DURATION_SEC_OPTIONS)[number]}`;
export type MinimaxH3DurationChoice = `${(typeof MINIMAX_H3_DURATION_SEC_OPTIONS)[number]}`;
export type MinimaxH3AudioDurationChoice = `${(typeof MINIMAX_H3_AUDIO_DURATION_SEC_OPTIONS)[number]}`;

export function normalizeLtx23DurationSec(raw: string | number | undefined, fallback = 10): number {
  const allowed = LTX23_DURATION_SEC_OPTIONS;
  const n = parseInt(String(raw ?? '').trim(), 10);
  if ((allowed as readonly number[]).includes(n)) return n;
  if (n === 25) return 15;
  if (!Number.isFinite(n)) return fallback;
  let best: number = fallback;
  let minDist = Infinity;
  for (const v of allowed) {
    const d = Math.abs(v - n);
    if (d < minDist) {
      minDist = d;
      best = v;
    }
  }
  return best;
}

export function normalizeLtx23DurationChoice(
  raw: string | number | undefined,
  fallback = 10,
): Ltx23DurationChoice {
  return String(normalizeLtx23DurationSec(raw, fallback)) as Ltx23DurationChoice;
}

export function normalizeMinimaxH3DurationSec(raw: string | number | undefined, fallback = 10): number {
  const allowed = MINIMAX_H3_DURATION_SEC_OPTIONS;
  const n = parseInt(String(raw ?? '').trim(), 10);
  if ((allowed as readonly number[]).includes(n)) return n;
  if (!Number.isFinite(n)) return fallback;
  let best: number = fallback;
  let minDist = Infinity;
  for (const v of allowed) {
    const d = Math.abs(v - n);
    if (d < minDist) {
      minDist = d;
      best = v;
    }
  }
  return best;
}

export function normalizeMinimaxH3DurationChoice(
  raw: string | number | undefined,
  fallback = 10,
): MinimaxH3DurationChoice {
  return String(normalizeMinimaxH3DurationSec(raw, fallback)) as MinimaxH3DurationChoice;
}

/**
 * 参考音实际秒数 → 计费档：≥ 实际秒的最小档；>20 封顶 20；读不到保守 20。
 */
export function mapMinimaxH3AudioBillingDurationSec(
  actualSec: number | undefined | null,
): (typeof MINIMAX_H3_AUDIO_DURATION_SEC_OPTIONS)[number] {
  const tiers = MINIMAX_H3_AUDIO_DURATION_SEC_OPTIONS;
  const n = Number(actualSec);
  if (!Number.isFinite(n) || n <= 0) return 20;
  for (const t of tiers) {
    if (t >= n) return t;
  }
  return 20;
}

/** 规范化已选/已映射的计费档（向上取整请用 mapMinimaxH3AudioBillingDurationSec） */
export function normalizeMinimaxH3AudioDurationSec(
  raw: string | number | undefined,
  fallback = 20,
): number {
  const allowed = MINIMAX_H3_AUDIO_DURATION_SEC_OPTIONS;
  const n = parseInt(String(raw ?? '').trim(), 10);
  if ((allowed as readonly number[]).includes(n)) return n;
  if (n === 5) return 6;
  if (!Number.isFinite(n)) return fallback;
  return mapMinimaxH3AudioBillingDurationSec(n);
}

export function normalizeMinimaxH3AudioDurationChoice(
  raw: string | number | undefined,
  fallback = 20,
): MinimaxH3AudioDurationChoice {
  return String(normalizeMinimaxH3AudioDurationSec(raw, fallback)) as MinimaxH3AudioDurationChoice;
}

export function normalizeGrok3StableDurationSec(raw: string | number | undefined, fallback = 10): number {
  const allowed = GROK3_STABLE_DURATION_SEC_OPTIONS;
  const n = parseInt(String(raw ?? '').trim(), 10);
  if ((allowed as readonly number[]).includes(n)) return n;
  if (!Number.isFinite(n)) return fallback;
  let best = fallback;
  let minDist = Infinity;
  for (const v of allowed) {
    const d = Math.abs(v - n);
    if (d < minDist) {
      minDist = d;
      best = v;
    }
  }
  return best;
}

export function normalizeGrok3StableDurationStr(raw: string | number | undefined, fallback = '10'): string {
  return String(normalizeGrok3StableDurationSec(raw, parseInt(fallback, 10) || 10));
}

export function normalizeGrok3DurationSec(raw: string | number | undefined, fallback = 10): number {
  const allowed = GROK3_DURATION_SEC_OPTIONS;
  const n = parseInt(String(raw ?? '').trim(), 10);
  if ((allowed as readonly number[]).includes(n)) return n;
  if (!Number.isFinite(n)) return fallback;
  let best = fallback;
  let minDist = Infinity;
  for (const v of allowed) {
    const d = Math.abs(v - n);
    if (d < minDist) {
      minDist = d;
      best = v;
    }
  }
  return best;
}
export function normalizeRhartVideoXDurationSec(raw: string | number | undefined, fallback = 10): number {
  const allowed = RHART_VIDEO_X_DURATION_SEC_OPTIONS;
  const n = parseInt(String(raw ?? '').trim(), 10);
  if ((allowed as readonly number[]).includes(n)) return n;
  if (!Number.isFinite(n)) return fallback;
  let best = fallback;
  let minDist = Infinity;
  for (const v of allowed) {
    const d = Math.abs(v - n);
    if (d < minDist) {
      minDist = d;
      best = v;
    }
  }
  return best;
}

export function normalizeRhartVideoXDurationStr(raw: string | number | undefined, fallback = '10'): string {
  return String(normalizeRhartVideoXDurationSec(raw, parseInt(fallback, 10) || 10));
}


export function normalizeGrok3DurationStr(raw: string | number | undefined, fallback = '10'): string {
  return String(normalizeGrok3DurationSec(raw, parseInt(fallback, 10) || 10));
}

/** Grok 3 分辨率：480p | 720p（stable 仅 720p，由 UI 另行钉死） */
export const GROK3_RESOLUTION_OPTIONS = ['480p', '720p'] as const;
export type Grok3ResolutionChoice = (typeof GROK3_RESOLUTION_OPTIONS)[number];

export function normalizeGrok3Resolution(
  raw: string | undefined | null,
  fallback: Grok3ResolutionChoice = '720p',
): Grok3ResolutionChoice {
  const s = String(raw ?? '').trim().toLowerCase();
  return (GROK3_RESOLUTION_OPTIONS as readonly string[]).includes(s)
    ? (s as Grok3ResolutionChoice)
    : fallback;
}

const IMAGE_REVERSE_KEYS: Record<string, string> = {
  'gpt-4o': 'gpt-4o-image-reverse',
  'joy-caption-two': 'joy-caption-two-image-reverse',
  'openai/gpt-5.6-terra': 'openai/gpt-5.6-terra-image-reverse',
};

function klingO1CapabilitySuffix(model: string): string {
  const m = lc(model);
  const p = 'kling-video-o1';
  if (!m.startsWith(p)) return '';
  if (m.length <= p.length) return '';
  return m.slice(p.length + 1);
}

function hailuoSeriesAndI2v(model: string): { series: string; isI2v: boolean } | null {
  const m = lc(model);
  if (!m.startsWith('hailuo-')) return null;
  if (m.startsWith('hailuo-02-')) return { series: '02', isI2v: m.includes('i2v') };
  if (m.startsWith('hailuo-2.3-')) return { series: '2-3', isI2v: m.includes('i2v') };
  return null;
}

function veoVariantFromRhart(model: string): string | null {
  const m = lc(model);
  const prefix = 'rhart-v3.1-';
  if (!m.startsWith(prefix)) return null;
  return m.slice(prefix.length);
}

export function buildVideoBillingModelIdCore(baseModel: string, input: Record<string, unknown>): string {
  const model = String(baseModel || '').trim();
  if (!model) return '';

  const m = lc(model);

  const rev = IMAGE_REVERSE_KEYS[m];
  if (rev) return rev;

  const hi = hailuoSeriesAndI2v(m);
  if (hi) {
    const durSec = input.durationHailuo02 === '10' ? 10 : 6;
    const durSeg = `${durSec}s`;
    // 海螺 02 / 2.3 均不区分分辨率计费：统一按时长档计费
    if (hi.isI2v) return joinKey('hailuo', hi.series, 'i2v', durSeg);
    return joinKey('hailuo', hi.series, durSeg);
  }

  if (m === 'wan-2.6') {
    const resRaw = input.resolutionWan26 != null && String(input.resolutionWan26).trim() !== '' ? lc(String(input.resolutionWan26)) : '';
    const resSeg = resRaw === '720p' ? '720p' : undefined;
    let durNum: number | undefined;
    if (input.duration === '15') durNum = 15;
    else if (input.duration === '10') durNum = 10;
    else if (input.duration === '5') durNum = 5;
    const durSeg = durNum != null && durNum !== 10 ? `${durNum}s` : undefined;
    return joinKey('wan', '2-6', resSeg, durSeg);
  }

  if (m === 'wan-2.6-flash') {
    const resRaw = input.resolutionWan26 != null && String(input.resolutionWan26).trim() !== '' ? lc(String(input.resolutionWan26)) : '';
    const resSeg = resRaw === '720p' ? '720p' : undefined;
    const n = parseInt(String(input.durationWan26Flash ?? ''), 10);
    const durNum = Number.isFinite(n) ? Math.max(2, Math.min(15, n)) : undefined;
    const durSeg = durNum != null && durNum !== 5 ? `${durNum}s` : undefined;
    const audioSeg = input.enableAudio === false ? 'noaudio' : undefined;
    return joinKey('wan', '2-6', 'flash', resSeg, durSeg, audioSeg);
  }

  if (m === 'wan-animate') {
    const resRaw = String(input.resolutionWanAnimate ?? '').trim().toLowerCase();
    const resSeg =
      resRaw === '1080p' || resRaw === '1080' || resRaw === '1920x1080' || resRaw === '1080x1920'
        ? '1080p'
        : '720p';
    const clipRaw = String(input.wanAnimateClipSec ?? '8').trim();
    const sec = clipRaw === '5' || clipRaw === '10' || clipRaw === '15' ? clipRaw : '8';
    return joinKey('wan', 'animate', resSeg, `${sec}s`);
  }

  // Wan animate2：按原视频秒数计费；SKU 仅分辨率，Quantity = mediaDurationSec（ceil）
  if (m === 'wan-animate-2') {
    const resRaw = String(input.resolutionWanAnimate ?? '').trim().toLowerCase();
    const resSeg =
      resRaw === '1080p' || resRaw === '1080' || resRaw === '1920x1080' || resRaw === '1080x1920'
        ? '1080p'
        : '720p';
    return joinKey('wan', 'animate', '2', resSeg);
  }

  if (m === 'hey-gem') {
    return joinKey('hey', 'gem', 'plus');
  }

  if (m === 'seedance-2.0-fast') {
    const resRaw = String(input.resolutionSeedance ?? '').trim().toLowerCase();
    const resSeg = resRaw === '1080p' ? '1080p' : '720p';
    const durNum = normalizeSeedanceDurationSec(input.durationSeedance as string | number | undefined, 10);
    return joinKey('seedance', '2-0-fast', resSeg, `${durNum}s`);
  }

  if (m === 'seedance-2.0-mini') {
    const resSeg = seedanceMiniResSeg(String(input.resolutionSeedance ?? ''));
    const durNum = normalizeSeedanceDurationSec(input.durationSeedance as string | number | undefined, 10);
    return joinKey('seedance', '2-0-mini', resSeg, `${durNum}s`);
  }

  if (m === 'gemini-omni') {
    const resRaw = String(input.resolutionGeminiOmni ?? '').trim().toLowerCase();
    const resSeg = resRaw === '1080p' || resRaw === '4k' ? resRaw : '720p';
    const durNum = normalizeGeminiOmniDurationSec(input.durationGeminiOmni as string | number | undefined, 6);
    return joinKey('gemini', 'omni', resSeg, `${durNum}s`);
  }

  if (m === 'gemini-omni-flash') {
    const resRaw = String(input.resolutionGeminiOmni ?? '').trim().toLowerCase();
    const resSeg = resRaw === '1080p' || resRaw === '4k' ? resRaw : '720p';
    const durNum = normalizeGeminiOmniFlashDurationSec(
      input.durationGeminiOmni as string | number | undefined,
      6,
    );
    return joinKey('gemini', 'omni', 'flash', resSeg, `${durNum}s`);
  }

  if (m === 'kling-v2.6-pro') {
    let durNum: number | undefined;
    if (input.duration === '10') durNum = 10;
    else if (input.duration === '5') durNum = 5;
    const durSeg = durNum != null && durNum !== 10 ? `${durNum}s` : undefined;
    const audioSeg = input.sound === 'true' ? 'audio' : undefined;
    return joinKey('kling', 'v2-6', 'pro', durSeg, audioSeg);
  }

  if (m.startsWith('kling-video-o1')) {
    const cap = klingO1CapabilitySuffix(model);
    const modeSeg = input.modeKlingO1 === 'pro' ? 'pro' : '';
    let durNum: number | undefined;
    if (input.durationKlingO1 === '10') durNum = 10;
    else if (input.durationKlingO1 === '5') durNum = 5;
    const durSeg = durNum != null && durNum !== 5 ? `${durNum}s` : undefined;
    const variant = joinKey(cap, modeSeg);
    return joinKey('kling', 'o1', variant || undefined, durSeg);
  }

  if (m === 'grok-3-stable') {
    const durNum = normalizeGrok3StableDurationSec(input.durationGrok3 as string | number | undefined, 10);
    return joinKey('grok-3-stable', '720p', `${durNum}s`);
  }

  /** 全能视频X：固定 720p，时长 6|8|10|15|30s */
  if (m === 'rhart-video-x') {
    const durNum = normalizeRhartVideoXDurationSec(input.durationGrok3 as string | number | undefined, 10);
    return joinKey('rhart-video-x', '720p', `${durNum}s`);
  }

  /** Grok video3：固定 720p，时长 6|10|15|30s */
  if (m === 'grok-3' || m === 'rhart-video-g') {
    if (m === 'rhart-video-g') {
      const dg = String(input.durationRhartVideoG || '').toLowerCase();
      const durNum = dg === '10s' || dg === '10' ? 10 : 6;
      return joinKey('grok-3', '720p', `${durNum}s`);
    }
    const resSeg = '720p';
    const durNum = normalizeGrok3DurationSec(input.durationGrok3 as string | number | undefined, 10);
    return joinKey('grok-3', resSeg, `${durNum}s`);
  }

  const vv = veoVariantFromRhart(m);
  if (vv && m !== 'rhart-v3.1-pro-official-i2v') {
    const resRaw = input.resolutionRhartV31 != null && String(input.resolutionRhartV31).trim() !== '' ? lc(String(input.resolutionRhartV31)) : '';
    const res =
      resRaw === '720p' || resRaw === '1080p' || resRaw === '4k' ? resRaw : '1080p';
    return joinKey('veo', '3-1', res, vv);
  }

  if (m === 'rhart-v3.1-pro-official-i2v') {
    const resRaw = input.resolutionRhartV31 != null && String(input.resolutionRhartV31).trim() !== '' ? lc(String(input.resolutionRhartV31)) : '';
    const res =
      resRaw === '720p' || resRaw === '1080p' || resRaw === '4k' ? resRaw : '1080p';
    const d = String(input.durationVeo31ProOfficial || '');
    const durNum = d === '8' ? 8 : d === '6' ? 6 : d === '4' ? 4 : undefined;
    const durSeg = durNum != null && durNum !== 4 ? `${durNum}s` : undefined;
    const audioSeg = input.generateAudioVeo31ProOfficial === true ? 'audio' : undefined;
    return joinKey('veo', '3-1', res, 'official-i2v', durSeg, audioSeg);
  }

  if (m === 'ltx-2.3-lipsync') {
    const resRaw = input.resolutionLtx23Lipsync != null && String(input.resolutionLtx23Lipsync).trim() !== '' ? String(input.resolutionLtx23Lipsync).trim() : '';
    const res = ['720', '1280', '1920'].includes(resRaw) ? lc(resRaw) : '';
    return joinKey('ltx', '2-3', 'lipsync', res);
  }

  if (m === 'ltx-2.3-i2v') {
    const resRaw = input.resolutionLtx23I2v != null && String(input.resolutionLtx23I2v).trim() !== '' ? String(input.resolutionLtx23I2v).trim() : '';
    const res = ['720', '1280', '1920'].includes(resRaw) ? lc(resRaw) : '';
    const durNum = normalizeLtx23DurationSec(input.durationLtx23I2v as string | number | undefined, 10);
    const dur = `${durNum}s`;
    return joinKey('ltx', '2-3', 'i2v', res, dur);
  }

  if (m === 'ltx-2.3-t2v') {
    const resRaw = input.resolutionLtx23T2v != null && String(input.resolutionLtx23T2v).trim() !== '' ? String(input.resolutionLtx23T2v).trim() : '';
    const res = ['720', '1280', '1920'].includes(resRaw) ? lc(resRaw) : '';
    const durNum = normalizeLtx23DurationSec(input.durationLtx23T2v as string | number | undefined, 10);
    const dur = `${durNum}s`;
    return joinKey('ltx', '2-3', res, dur);
  }

  if (m === 'minimax-h3-t2v') {
    const res = '720p'; // 仅 720P（megapixels 0.9）
    const durSec = normalizeMinimaxH3DurationSec(input.durationMinimaxH3 as string | number | undefined, 10);
    return joinKey('minimax', 'h3', 't2v', res, `${durSec}s`);
  }
  if (m === 'minimax-h3-i2v') {
    const res = '720p'; // 仅 720P（megapixels 0.9）
    const durSec = normalizeMinimaxH3DurationSec(input.durationMinimaxH3 as string | number | undefined, 10);
    return joinKey('minimax', 'h3', 'i2v', res, `${durSec}s`);
  }
  // 全能参考：720p × 时长 6|10|15|20（OTS: minimax-h3-multi-720p-{6|10|15|20}s）
  if (m === 'minimax-h3-multi') {
    const res = '720p';
    const durSec = normalizeMinimaxH3DurationSec(input.durationMinimaxH3 as string | number | undefined, 10);
    return joinKey('minimax', 'h3', 'multi', res, `${durSec}s`);
  }
  // 口型同步：720p × 时长 6|10|15|20（OTS: minimax-h3-audio-720p-{6|10|15|20}s；已删 5s）
  if (m === 'minimax-h3-audio') {
    const res = '720p';
    const durSec = normalizeMinimaxH3AudioDurationSec(
      input.durationMinimaxH3 as string | number | undefined,
      20,
    );
    return joinKey('minimax', 'h3', 'audio', res, `${durSec}s`);
  }

  if (m === 'ltx-2.3-hdr-multi') {
    const resRaw =
      input.resolutionLtx23HdrMulti != null && String(input.resolutionLtx23HdrMulti).trim() !== ''
        ? String(input.resolutionLtx23HdrMulti).trim()
        : '';
    let res = resRaw === '720' || resRaw === '1280' ? lc(resRaw) : '';
    if (resRaw === '1920' || resRaw === '1080') res = '1280';
    const durNum = normalizeLtx23DurationSec(input.durationLtx23HdrMulti as string | number | undefined, 15);
    const dur = `${durNum}s`;
    return joinKey('ltx', '2-3', 'hdr-multi', res, dur);
  }

  if (m === 'ltx-2.3-msr-av') {
    const resRaw =
      input.resolutionLtx23HdrMulti != null && String(input.resolutionLtx23HdrMulti).trim() !== ''
        ? String(input.resolutionLtx23HdrMulti).trim()
        : '';
    let res = resRaw === '720' || resRaw === '1280' ? lc(resRaw) : '';
    if (resRaw === '1920' || resRaw === '1080') res = '1280';
    const durNum = normalizeLtx23DurationSec(input.durationLtx23HdrMulti as string | number | undefined, 10);
    const dur = `${durNum}s`;
    return joinKey('ltx', '2-3', 'msr-av', res, dur);
  }

  if (m === 'rh-video-start-end') {
    const resRaw =
      input.resolutionRhartV31 != null && String(input.resolutionRhartV31).trim() !== ''
        ? lc(String(input.resolutionRhartV31))
        : '';
    // OTS: ltx-2-3-start-end-{720p|1080p|1920p}-{5s|10s|15s}；旧 4k→1920p
    const res =
      resRaw === '720' || resRaw === '720p'
        ? '720p'
        : resRaw === '1920' || resRaw === '1920p' || resRaw === '4k' || resRaw === '2160p'
          ? '1920p'
          : '1080p'; // 含 1080 / 1280 / 1080p
    const d = parseInt(String(input.duration ?? ''), 10);
    const durNum = Number.isFinite(d) && d > 0 ? Math.max(5, Math.min(15, d)) : 5;
    const dur = durNum >= 15 ? '15s' : durNum >= 10 ? '10s' : '5s';
    return joinKey('ltx', '2-3', 'start-end', res, dur);
  }

  if (m === 'rhart-video-upscaler') {
    const r = lc(String(input.targetResolution ?? '1080p'));
    const res = r === '720p' || r === '1080p' || r === '2k' || r === '4k' ? r : '1080p';
    return joinKey('rhart', 'video', 'upscaler', res);
  }

  return lc(model);
}

export function buildVideoBillingModelId(baseModel: string, input: Record<string, unknown>): string {
  const compositeKey = buildVideoBillingModelIdCore(baseModel, input);
  return compositeKey;
}

export function getVideoBillingQuantity(baseModel: string, input: Record<string, unknown>): number {
  const m = String(baseModel || '').trim();
  // 视频超分：按秒基价；Quantity = max(floor(时长), 5)，与播放器时钟对齐
  if (m === 'rhart-video-upscaler') {
    const raw =
      input.mediaDurationSec ?? input.durationRhartVideoUpscaler ?? input.duration ?? 0;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 5;
    return Math.max(5, Math.floor(Math.min(n, 10 * 60) + 1e-6));
  }
  // Wan animate2：按原视频秒数；Quantity = max(1, ceil(时长))，最长 10 分钟
  if (m === 'wan-animate-2') {
    const raw = input.mediaDurationSec ?? input.duration ?? 0;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 1;
    return Math.max(1, Math.ceil(Math.min(n, 10 * 60) - 1e-9));
  }
  const sku = buildVideoBillingModelIdCore(baseModel, input);
  const matches = [...sku.matchAll(/-(\d+)s(?=-|$)/gi)];
  if (matches.length === 0) return 1;
  const last = matches[matches.length - 1];
  const sec = parseInt(last[1], 10);
  if (Number.isFinite(sec) && sec > 0) return sec;
  return 1;
}
