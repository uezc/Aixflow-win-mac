/**
 * 导演批量生成视频：模型参数 + 分镜图优先参考图组装。
 * 普通 MV 生视频 = 活跃图生（i2v）目录（不含对口型）；
 * 对口型单独下拉：LTX2.3 对口型 / MiniMax-H3 口型同步。
 *
 * MV 试运行：DIRECTOR_MV_FORCE_H3_LIPSYNC=true 时视频模型固定 MiniMax-H3 口型同步，
 * 其它模型下拉隐藏；逐镜「对口型」按钮仍控制提示词（关=角色保持沉默、不要说话）。
 * 稳定后改 false 或再删其它模型。
 */

import {
  ACTIVE_I2V_CATALOG_MODEL_IDS,
  getActiveI2vCatalogModelIds,
  isRetiredVideoModel,
  normalizeVideoModelIfRetired,
  type ActiveI2vCatalogModelId,
} from '../config/videoModelUiPolicy';
import {
  GEMINI_OMNI_FLASH_DURATION_SEC_OPTIONS,
  LTX23_DURATION_SEC_OPTIONS,
  MINIMAX_H3_DURATION_SEC_OPTIONS,
  RHART_VIDEO_X_DURATION_SEC_OPTIONS,
  SEEDANCE_DURATION_SEC_OPTIONS,
  SEEDANCE_FAST_RESOLUTION_OPTIONS,
  SEEDANCE_MINI_RESOLUTION_OPTIONS,
  SEEDANCE_RATIO_OPTIONS,
  coerceSeedanceRatio,
  coerceSeedanceResolution,
  normalizeGeminiOmniFlashDurationChoice,
  normalizeLtx23DurationChoice,
  normalizeMinimaxH3DurationChoice,
  normalizeMinimaxH3AudioDurationChoice,
  mapMinimaxH3AudioBillingDurationSec,
  normalizeRhartVideoXDurationStr,
  normalizeSeedanceDurationChoice,
  type MinimaxH3DurationChoice,
  type MinimaxH3AudioDurationChoice,
  type SeedanceRatioChoice,
} from './videoBillingSku';
import { normalizeMinimaxH3Resolution, type MinimaxH3Resolution } from '../../common/minimaxH3Resolution.js';
import { DEFAULT_VIDEO_ASPECT_RATIO } from './nodeSizeFromAspectRatio';
import { ensureDirectorMvVideoPromptGuards, ensureDirectorDramaVideoPromptGuards, adaptDirectorPromptForLtxI2v, stripDirectorPromptInventedLook, isDirectorEmptyShotPrompt, DIRECTOR_EMPTY_SHOT_NEGATIVE_PROMPT, DIRECTOR_MV_SCENE_NEGATIVE_PROMPT } from '../../shared/directorPipeline';
import {
  buildMinimaxH3ZhRefImageSlots,
  composeMinimaxH3ChineseOfficialRefPrompt,
} from '../../shared/directorPipeline/minimaxH3DramaPrompt';
import {
  extractSeedanceImageMentionIndices,
  sliceDirectorShotAssetsForVideo,
  type DirectorVideoAssetRef,
} from './seedanceImageMentions';
import type { DirectorShot } from '../../shared/directorPipeline';
import { NEXFLOW_MAX_TASK_CONCURRENCY } from '../../shared/nexflowTaskConcurrency';

export const DIRECTOR_VIDEO_LIPSYNC_MODEL = 'ltx-2.3-lipsync' as const;
/** 导演台对口型：MiniMax-H3 口型同步（不出现在左侧视频模型） */
export const DIRECTOR_VIDEO_MINIMAX_LIPSYNC_MODEL = 'minimax-h3-audio' as const;

/**
 * MV 导演试运行：视频模型固定 MiniMax-H3 口型同步。
 * true → 隐藏其它模型下拉；逐镜「对口型」开关仍控制提示词（关=保持沉默、不要说话）。
 */
export const DIRECTOR_MV_FORCE_H3_LIPSYNC = true;

/** MV 导演台：批量生视频同时进行中的上限，超出的自动排队 */
export const DIRECTOR_MV_VIDEO_BATCH_SIZE = NEXFLOW_MAX_TASK_CONCURRENCY;

/** MV 导演台：每波同时优化的镜头数（超出排队到下一波） */
export const DIRECTOR_MV_PROMPT_OPTIMIZE_PARALLEL = 2;
/** 两波之间的间隔，降低 run-task 429 限流 */
export const DIRECTOR_MV_PROMPT_OPTIMIZE_WAVE_GAP_MS = 8000;

/** 标签与 VideoInputPanel VIDEO_I2V_MODEL_LABELS / videoInputPanelI18n 对齐 */
const DIRECTOR_I2V_MODEL_META: Record<
  ActiveI2vCatalogModelId,
  { label: string; title: string }
> = {
  'ltx-2.3-i2v': {
    label: 'LTX2.3 图生视频',
    title: '单张参考图（优先分镜图）；时长 5/10/15 秒；可独立选清晰度',
  },
  'minimax-h3-i2v': {
    label: 'MiniMax-H3 图生视频',
    title: '1 张参考图；480P/720P；时长 6/10/15/20 秒',
  },
  'minimax-h3-multi': {
    label: 'MiniMax H3 全能参考',
    title:
      '无参考可文生；最多 9 张参考图 + 最多 3 路参考音；480P/720P；时长 6/10/15/20 秒',
  },
  'seedance-2.0-fast': {
    label: 'Seedance 2.0 Fast',
    title: '支持 0–9 张参考图',
  },
  'seedance-2.0-mini': {
    label: 'Seedance 2.0 Mini',
    title: '支持参考图/视频/音频，0–9 张参考图',
  },
  'gemini-omni-flash': {
    label: '全能视频 Omni Flash',
    title: '图生视频：1 或 3 张参考图（不支持 2 张）；时长 6/8/10；720p/1080p/4k',
  },
  'rhart-video-x': {
    label: '全能视频X',
    title: '文生/图生；海外站；720p；时长 6/8/10/15/30；图生最多 7 张',
  },
};

/** 普通图生视频模型（不含对口型）；与活跃 i2v 目录一致 */
export const DIRECTOR_VIDEO_BATCH_MODELS = getActiveI2vCatalogModelIds().map((value) => ({
  value,
  label: DIRECTOR_I2V_MODEL_META[value].label,
  title: DIRECTOR_I2V_MODEL_META[value].title,
}));

/** 对口型模型（与左侧图生清晰度分开选） */
export const DIRECTOR_VIDEO_LIPSYNC_MODELS = [
  {
    value: DIRECTOR_VIDEO_LIPSYNC_MODEL,
    label: 'LTX2.3 对口型',
    title: '需参考图 + 音频；有对白镜头推荐；可独立选清晰度',
  },
  {
    value: DIRECTOR_VIDEO_MINIMAX_LIPSYNC_MODEL,
    label: 'MiniMax-H3 口型同步',
    title: '1–5 张参考图 + 必填参考音；480P/720P；成片跟参考音；计费 6/10/15/20 秒档向上取整',
  },
] as const;

export type DirectorVideoBatchModelId = ActiveI2vCatalogModelId;
export type DirectorVideoLipsyncModelId = (typeof DIRECTOR_VIDEO_LIPSYNC_MODELS)[number]['value'];

const MODEL_SET = new Set<string>(ACTIVE_I2V_CATALOG_MODEL_IDS);
const LIPSYNC_MODEL_SET = new Set<string>(DIRECTOR_VIDEO_LIPSYNC_MODELS.map((m) => m.value));

export function normalizeDirectorVideoBatchModel(
  raw: string | undefined | null,
): DirectorVideoBatchModelId {
  const m = String(raw ?? '').trim();
  // 旧工程若把对口型写在 videoBatchModel，回落到默认图生
  if (LIPSYNC_MODEL_SET.has(m) || m === DIRECTOR_VIDEO_MINIMAX_LIPSYNC_MODEL) {
    return 'ltx-2.3-i2v';
  }
  if (MODEL_SET.has(m)) return m as DirectorVideoBatchModelId;
  if (isRetiredVideoModel(m)) {
    const next = normalizeVideoModelIfRetired(m);
    if (MODEL_SET.has(next)) return next as DirectorVideoBatchModelId;
  }
  return 'ltx-2.3-i2v';
}

export function normalizeDirectorVideoLipsyncModel(
  raw: string | undefined | null,
): DirectorVideoLipsyncModelId {
  const m = String(raw ?? '').trim();
  // 旧 MSR 图像+声音 → LTX 对口型
  if (m === 'ltx-2.3-msr-av') return DIRECTOR_VIDEO_LIPSYNC_MODEL;
  if (LIPSYNC_MODEL_SET.has(m)) return m as DirectorVideoLipsyncModelId;
  return DIRECTOR_VIDEO_MINIMAX_LIPSYNC_MODEL;
}

/** MV 对口型模型：试运行期固定 H3，其它模型仍保留在 DIRECTOR_VIDEO_LIPSYNC_MODELS */
export function resolveDirectorMvLipsyncModel(
  raw: string | undefined | null,
): DirectorVideoLipsyncModelId {
  if (DIRECTOR_MV_FORCE_H3_LIPSYNC) return DIRECTOR_VIDEO_MINIMAX_LIPSYNC_MODEL;
  return normalizeDirectorVideoLipsyncModel(raw);
}

/** 提示词是否对口型：跟逐镜开关，不再因固定 H3 模型而强制全开 */
export function resolveDirectorMvForceLipsyncOn(
  _isMv: boolean,
  fallback: boolean,
): boolean {
  return fallback;
}

/** MV 试运行：生视频模型固定 H3，与逐镜「对口型」提示词开关无关 */
export function resolveDirectorMvShotVideoModel(opts: {
  isMv: boolean;
  preferLipsync: boolean;
  batchLipsyncModel: string;
  batchModel: string;
}): string {
  if (DIRECTOR_MV_FORCE_H3_LIPSYNC && opts.isMv) {
    return resolveDirectorMvLipsyncModel(opts.batchLipsyncModel);
  }
  return opts.preferLipsync ? opts.batchLipsyncModel : opts.batchModel;
}

/**
 * 批量生视频默认只补失败/缺失/生成中；已 ready 且有成片 URL 的跳过。
 * 单镜显式传入 shotNos 时仍强制重跑，不走此判断。
 */
export function directorShotNeedsVideoGeneration(sb: {
  videoUrl?: string | null;
  videoStatus?: string | null;
} | null | undefined): boolean {
  const status = String(sb?.videoStatus || '')
    .trim()
    .toLowerCase();
  const url = String(sb?.videoUrl || '').trim();
  if (status === 'error' || status === 'pending' || status === 'generating') return true;
  if (status === 'ready') return !url;
  return !url;
}

export function isDirectorLipsyncModel(model: string | undefined | null): boolean {
  return LIPSYNC_MODEL_SET.has(String(model ?? '').trim());
}

export function isDirectorMinimaxLipsyncModel(model: string | undefined | null): boolean {
  return String(model ?? '').trim() === DIRECTOR_VIDEO_MINIMAX_LIPSYNC_MODEL;
}

/** MV H3 口型同步：分镜图 + 本镜角色图（最多 2 个角色），不传场景/风格/其它资产 */
export const DIRECTOR_MV_H3_AUDIO_MAX_CHAR_IMAGES = 2;

export function collectDirectorMvH3AudioInputImages(opts: {
  storyboardImageUrl?: string;
  characterImageUrls?: string[];
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined | null) => {
    const url = String(raw || '').trim();
    if (!url || seen.has(url)) return false;
    seen.add(url);
    out.push(url);
    return true;
  };
  push(opts.storyboardImageUrl);
  let chars = 0;
  for (const u of opts.characterImageUrls || []) {
    if (chars >= DIRECTOR_MV_H3_AUDIO_MAX_CHAR_IMAGES) break;
    if (push(u)) chars += 1;
  }
  return out;
}

/** LTX 图生/对口型：只吃 1 张分镜图，不传角色图 */
export function isDirectorLtxSingleImageModel(model: string | undefined | null): boolean {
  const m = String(model ?? '').trim();
  return m === 'ltx-2.3-i2v' || m === DIRECTOR_VIDEO_LIPSYNC_MODEL;
}

export function directorVideoBatchMaxImages(model: string): number {
  if (isDirectorMinimaxLipsyncModel(model)) return 5;
  if (isDirectorLipsyncModel(model)) return 1;
  const m = normalizeDirectorVideoBatchModel(model);
  if (m === 'ltx-2.3-i2v' || m === 'minimax-h3-i2v') return 1;
  if (m === 'minimax-h3-multi') return 9;
  if (m === 'rhart-v3.1-pro-se') return 2;
  if (m === 'gemini-omni-flash') return 3;
  if (m === 'rhart-video-x') return 7;
  return 9; // seedance
}

const LTX_I2V_RES_OPTIONS = ['720', '1280', '1920'] as const;
const P_RES_OPTIONS = ['720p', '1080p', '4k'] as const;
const MINIMAX_H3_DURATION_OPTIONS = MINIMAX_H3_DURATION_SEC_OPTIONS.map(String) as readonly MinimaxH3DurationChoice[];
const MINIMAX_H3_RES_OPTIONS = ['480p', '720p'] as const;
const MINIMAX_H3_ASPECT_OPTIONS = [
  '16:9',
  '9:16',
  '1:1',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '21:9',
] as const;
const RHART_VIDEO_X_ASPECT_OPTIONS = ['2:3', '3:2', '1:1', '16:9', '9:16'] as const;

export type DirectorVideoBatchFieldOption = { value: string; label: string };

/** 将导演台统一存储的分辨率串归一为 720p|1080p|4k */
function coercePResolution(
  raw: string | undefined | null,
  fallback: (typeof P_RES_OPTIONS)[number] = '720p',
): (typeof P_RES_OPTIONS)[number] {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === '720' || s === '720p') return '720p';
  if (s === '1280' || s === '1080' || s === '1080p') return '1080p';
  if (s === '1920' || s === '4k' || s === '2160p') return '4k';
  if ((P_RES_OPTIONS as readonly string[]).includes(s)) return s as (typeof P_RES_OPTIONS)[number];
  return fallback;
}

function coerceLtxI2vResolution(raw: string | undefined | null): (typeof LTX_I2V_RES_OPTIONS)[number] {
  const s = String(raw ?? '').trim();
  if ((LTX_I2V_RES_OPTIONS as readonly string[]).includes(s)) {
    return s as (typeof LTX_I2V_RES_OPTIONS)[number];
  }
  const p = coercePResolution(s, '720p');
  if (p === '1080p') return '1280';
  if (p === '4k') return '1920';
  return '720';
}

export function getDirectorVideoBatchDurationOptions(
  model: string,
): DirectorVideoBatchFieldOption[] | null {
  // 对口型（含 MiniMax 口型同步）：无时长下拉；成片跟参考音，计费后台映射
  if (isDirectorLipsyncModel(model)) return null;
  const m = normalizeDirectorVideoBatchModel(model);
  if (m === 'ltx-2.3-i2v') {
    return LTX23_DURATION_SEC_OPTIONS.map((s) => ({ value: String(s), label: `${s}s` }));
  }
  if (m === 'minimax-h3-i2v' || m === 'minimax-h3-multi') {
    return MINIMAX_H3_DURATION_OPTIONS.map((s) => ({ value: s, label: `${s}s` }));
  }
  if (m === 'rhart-v3.1-pro-se') {
    return [{ value: '8', label: '8s' }];
  }
  if (m === 'gemini-omni-flash') {
    return GEMINI_OMNI_FLASH_DURATION_SEC_OPTIONS.map((s) => ({ value: String(s), label: `${s}s` }));
  }
  if (m === 'rhart-video-x') {
    return RHART_VIDEO_X_DURATION_SEC_OPTIONS.map((s) => ({ value: String(s), label: `${s}s` }));
  }
  return SEEDANCE_DURATION_SEC_OPTIONS.map((s) => ({ value: String(s), label: `${s}s` }));
}

/** 当前模型可提交的时长档（秒）。对口型模型无下拉时仍返回 H3 6/10/15/20，供短剧规划。 */
export function listDirectorVideoDurationTiersSec(model: string): number[] {
  const opts = getDirectorVideoBatchDurationOptions(model);
  if (opts && opts.length > 0) {
    const nums = opts
      .map((o) => parseInt(String(o.value), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (nums.length) return nums;
  }
  if (String(model || '').startsWith('minimax-h3')) {
    return [...MINIMAX_H3_DURATION_SEC_OPTIONS];
  }
  return [6, 10, 15, 20];
}

/** 返回 null 表示该模型不展示比例下拉 */
export function getDirectorVideoBatchAspectOptions(
  model: string,
): DirectorVideoBatchFieldOption[] | null {
  if (isDirectorMinimaxLipsyncModel(model)) {
    return MINIMAX_H3_ASPECT_OPTIONS.map((r) => ({ value: r, label: r }));
  }
  if (isDirectorLipsyncModel(model)) return null;
  const m = normalizeDirectorVideoBatchModel(model);
  if (m === 'ltx-2.3-i2v') return null;
  if (m === 'minimax-h3-i2v' || m === 'minimax-h3-multi') {
    return MINIMAX_H3_ASPECT_OPTIONS.map((r) => ({ value: r, label: r }));
  }
  if (m === 'seedance-2.0-fast' || m === 'seedance-2.0-mini') {
    return SEEDANCE_RATIO_OPTIONS.map((r) => ({
      value: r,
      label: r === 'adaptive' ? 'adaptive' : r,
    }));
  }
  if (m === 'rhart-video-x') {
    return RHART_VIDEO_X_ASPECT_OPTIONS.map((r) => ({ value: r, label: r }));
  }
  // gemini / rhart-v3.1-pro-se
  return [
    { value: '16:9', label: '16:9' },
    { value: '9:16', label: '9:16' },
  ];
}

/** 返回 null 表示分辨率固定展示或无此项 */
export function getDirectorVideoBatchResolutionOptions(
  model: string,
): DirectorVideoBatchFieldOption[] | null {
  if (isDirectorMinimaxLipsyncModel(model)) {
    return MINIMAX_H3_RES_OPTIONS.map((r) => ({
      value: r,
      label: r === '480p' ? '480P' : '720P',
    }));
  }
  if (isDirectorLipsyncModel(model)) {
    return [
      { value: '720', label: '720p' },
      { value: '1280', label: '1280' },
      { value: '1920', label: '1920' },
    ];
  }
  const m = normalizeDirectorVideoBatchModel(model);
  if (m === 'ltx-2.3-i2v') {
    return [
      { value: '720', label: '720p' },
      { value: '1280', label: '1280' },
      { value: '1920', label: '1920' },
    ];
  }
  if (m === 'minimax-h3-i2v' || m === 'minimax-h3-multi') {
    return MINIMAX_H3_RES_OPTIONS.map((r) => ({
      value: r,
      label: r === '480p' ? '480P' : '720P',
    }));
  }
  if (m === 'rhart-video-x') return null; // 固定 720p
  if (m === 'seedance-2.0-fast' || m === 'seedance-2.0-mini') {
    const opts =
      m === 'seedance-2.0-mini' ? SEEDANCE_MINI_RESOLUTION_OPTIONS : SEEDANCE_FAST_RESOLUTION_OPTIONS;
    return opts.map((r) => ({ value: r, label: r }));
  }
  // gemini / rhart-v3.1-pro-se
  return P_RES_OPTIONS.map((r) => ({ value: r, label: r }));
}

export function normalizeDirectorVideoBatchDuration(model: string, raw: string | undefined | null): string {
  const rawIn = raw ?? undefined;
  if (isDirectorMinimaxLipsyncModel(model)) {
    return normalizeMinimaxH3AudioDurationChoice(rawIn, 20);
  }
  if (isDirectorLipsyncModel(model)) {
    return normalizeLtx23DurationChoice(rawIn, 10);
  }
  const m = normalizeDirectorVideoBatchModel(model);
  if (m === 'ltx-2.3-i2v') return normalizeLtx23DurationChoice(rawIn, 10);
  if (m === 'minimax-h3-i2v' || m === 'minimax-h3-multi') {
    return normalizeMinimaxH3DurationChoice(rawIn, 10);
  }
  if (m === 'rhart-v3.1-pro-se') return '8';
  if (m === 'gemini-omni-flash') return normalizeGeminiOmniFlashDurationChoice(rawIn, 6);
  if (m === 'rhart-video-x') return normalizeRhartVideoXDurationStr(rawIn, '10');
  return normalizeSeedanceDurationChoice(rawIn, 10);
}

/**
 * 按镜头规划时长取当前视频模型支持的档位（秒数字符串）。
 * 已是模型整数档则原样提交（选 10s 必须出 10s）；
 * 非整数再向上取整到「≥ 规划秒」的最小档，避免成片短于分镜；
 * 若全部档位都更短则取最长档。
 */
export function pickNearestDirectorVideoBatchDuration(
  model: string,
  shotDurationSec: number,
  fallbackSec = 10,
): string {
  const m = String(model || '').trim();
  if (isDirectorMinimaxLipsyncModel(m)) {
    if (!(Number.isFinite(shotDurationSec) && shotDurationSec > 0)) {
      return String(mapMinimaxH3AudioBillingDurationSec(undefined));
    }
    const rounded = Math.round(shotDurationSec);
    const tiers = listDirectorVideoDurationTiersSec(m);
    if (tiers.includes(rounded) && Math.abs(shotDurationSec - rounded) < 0.05) {
      return String(rounded);
    }
    return String(mapMinimaxH3AudioBillingDurationSec(shotDurationSec));
  }
  const sec =
    Number.isFinite(shotDurationSec) && shotDurationSec > 0 ? shotDurationSec : fallbackSec;
  const rounded = Math.round(sec);
  const opts = getDirectorVideoBatchDurationOptions(model);
  if (opts && opts.length > 0) {
    const nums = opts
      .map((o) => parseInt(String(o.value), 10))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
    if (nums.length > 0) {
      if (nums.includes(rounded) && Math.abs(sec - rounded) < 0.05) return String(rounded);
      const ceil = nums.find((n) => n >= sec);
      if (ceil != null) return String(ceil);
      return String(nums[nums.length - 1]);
    }
  }
  return normalizeDirectorVideoBatchDuration(model, String(Math.round(sec)));
}

/** 固定清晰度展示；可选手动时返回选项 label */
export function getDirectorVideoBatchResolutionDisplay(
  model: string,
  resolution: string,
): string {
  if (isDirectorLipsyncModel(model)) {
    const opts = getDirectorVideoBatchResolutionOptions(model);
    const r = normalizeDirectorVideoBatchResolution(model, resolution);
    if (!opts) return r || '—';
    return opts.find((o) => o.value === r)?.label || r;
  }
  const m = normalizeDirectorVideoBatchModel(model);
  const opts = getDirectorVideoBatchResolutionOptions(m);
  const r = normalizeDirectorVideoBatchResolution(m, resolution);
  if (!opts) return r || '—';
  return opts.find((o) => o.value === r)?.label || r;
}

export function normalizeDirectorVideoBatchAspect(model: string, raw: string | undefined | null): string {
  const s = String(raw ?? '').trim();
  if (isDirectorMinimaxLipsyncModel(model)) {
    return (MINIMAX_H3_ASPECT_OPTIONS as readonly string[]).includes(s) ? s : '16:9';
  }
  if (isDirectorLipsyncModel(model)) {
    return s === '9:16' ? '9:16' : '16:9';
  }
  const m = normalizeDirectorVideoBatchModel(model);
  if (m === 'ltx-2.3-i2v') {
    return s === '9:16' ? '9:16' : '16:9';
  }
  if (m === 'minimax-h3-i2v' || m === 'minimax-h3-multi') {
    return (MINIMAX_H3_ASPECT_OPTIONS as readonly string[]).includes(s) ? s : '16:9';
  }
  if (m === 'seedance-2.0-fast' || m === 'seedance-2.0-mini') {
    return coerceSeedanceRatio(s, '16:9');
  }
  if (m === 'rhart-video-x') {
    return (RHART_VIDEO_X_ASPECT_OPTIONS as readonly string[]).includes(s) ? s : '16:9';
  }
  return s === '9:16' ? '9:16' : '16:9';
}

export function normalizeDirectorVideoBatchResolution(
  model: string,
  raw: string | undefined | null,
): string {
  if (isDirectorMinimaxLipsyncModel(model)) return normalizeMinimaxH3Resolution(raw);
  if (isDirectorLipsyncModel(model)) {
    const s = String(raw ?? '').trim();
    return (LTX_I2V_RES_OPTIONS as readonly string[]).includes(s) ? s : '720';
  }
  const m = normalizeDirectorVideoBatchModel(model);
  if (m === 'ltx-2.3-i2v') return coerceLtxI2vResolution(raw);
  if (m === 'minimax-h3-i2v' || m === 'minimax-h3-multi') {
    return normalizeMinimaxH3Resolution(raw);
  }
  if (m === 'rhart-video-x') return '720p';
  if (m === 'seedance-2.0-fast' || m === 'seedance-2.0-mini') {
    return coerceSeedanceResolution(coercePResolution(raw, '720p'), m);
  }
  return coercePResolution(raw, m === 'rhart-v3.1-pro-se' ? '1080p' : '720p');
}

export function directorVideoBatchLayoutAspect(model: string, aspect: string): string {
  const a = normalizeDirectorVideoBatchAspect(model, aspect);
  if (a === 'adaptive') return DEFAULT_VIDEO_ASPECT_RATIO;
  return a || DEFAULT_VIDEO_ASPECT_RATIO;
}

/**
 * 本镜角色参考图：优先用 UI 勾选的 castAssetIds。
 * 禁止在匹配失败时把选角库全员塞进视频请求。
 */
export function resolveDirectorShotVideoCharacterRefs(opts: {
  assetRefs: DirectorVideoAssetRef[];
  castAssetIds?: string[];
  emptyShot?: boolean;
  prompt: string;
  fallbackText?: string;
  maxImages: number;
  includeNonCharacter?: boolean;
}): DirectorVideoAssetRef[] {
  const pool = (opts.assetRefs || []).filter((a) => String(a.imageUrl || '').trim());
  const chars = pool.filter((a) => a?.kind === 'character');
  if (opts.emptyShot) return [];
  if (Array.isArray(opts.castAssetIds)) {
    const ids = [
      ...new Set(opts.castAssetIds.map((id) => String(id || '').trim()).filter(Boolean)),
    ];
    const picked: DirectorVideoAssetRef[] = [];
    for (const id of ids) {
      const hit = chars.find((a) => String(a.id || '') === id);
      if (hit && !picked.some((p) => String(p.id || p.imageUrl) === String(hit.id || hit.imageUrl))) {
        picked.push(hit);
      }
    }
    return picked;
  }
  const searchPool = opts.includeNonCharacter ? pool : chars;
  const assetSlice = sliceDirectorShotAssetsForVideo(opts.prompt, searchPool, {
    fallbackText: opts.fallbackText,
    maxImages: Math.max(1, opts.maxImages),
  });
  const matched: DirectorVideoAssetRef[] = [];
  for (const url of assetSlice.inputImages) {
    const ref = searchPool.find((a) => String(a.imageUrl || '').trim() === url);
    if (ref) matched.push(ref);
  }
  return matched;
}

/**
 * 组装单镜视频参考图与提示词。
 * 参考图只提交分镜图 + 本镜角色图；提示词序号与提交顺序 1:1。
 */
export function prepareDirectorShotVideoPayload(opts: {
  rawPrompt: string;
  assetRefs: DirectorVideoAssetRef[];
  model: string;
  storyboardImageUrl?: string;
  styleReferenceImageUrl?: string;
  fallbackText?: string;
  /** 短剧 H3：输出中文官方六段式 */
  chineseH3Official?: boolean;
  /** 短剧：保留对白声景，禁止 MV 闭嘴/去台词 */
  drama?: boolean;
  shot?: Partial<DirectorShot>;
  globalStyle?: string;
  durationSec?: number;
  /** 本镜是否对口型：写入中文六段式口型约束 */
  lipsync?: boolean;
  /** 镜头变化档：影响毫秒时轴切段密度 */
  shotChangePace?: string | null;
  stylePictureIndex?: number | null;
  stylePresetId?: string | null;
  /** 本镜勾选的角色资产 id；空数组=明确空镜；缺省才按提示词匹配 */
  castAssetIds?: string[];
  /** 本镜为空镜：不传任何角色图 */
  emptyShot?: boolean;
}): { prompt: string; inputImages: string[] } {
  const model = isDirectorLipsyncModel(opts.model)
    ? normalizeDirectorVideoLipsyncModel(opts.model)
    : normalizeDirectorVideoBatchModel(opts.model);
  const maxImages = directorVideoBatchMaxImages(model);
  const storyboardUrl = String(opts.storyboardImageUrl || '').trim();
  void opts.styleReferenceImageUrl;
  const storySource = [opts.shot?.['地点'], opts.shot?.['画面描述'], opts.fallbackText]
    .map((v) => String(v || '').trim())
    .filter((v) => v && v !== '—')
    .join('\n');
  const rawPrompt = stripDirectorPromptInventedLook(String(opts.rawPrompt || ''), storySource);
  const useChineseH3 =
    !!opts.chineseH3Official || model === 'minimax-h3-multi' || model === 'minimax-h3-audio';
  const lockedCast = Array.isArray(opts.castAssetIds);
  // 空镜只看 emptyShot；匹配不到角色图 ≠ 空镜（仍传分镜，不把素材库第一人补上）
  const emptyCast = !!opts.emptyShot;
  const ltxSingle = isDirectorLtxSingleImageModel(model);
  const mvH3Audio = isDirectorMinimaxLipsyncModel(model) && !opts.drama;
  const charMax = mvH3Audio ? DIRECTOR_MV_H3_AUDIO_MAX_CHAR_IMAGES : Math.max(1, maxImages);
  const matchedAssets = ltxSingle
    ? []
    : resolveDirectorShotVideoCharacterRefs({
        assetRefs: opts.assetRefs || [],
        castAssetIds: opts.castAssetIds,
        emptyShot: emptyCast,
        prompt: rawPrompt,
        fallbackText: opts.fallbackText,
        maxImages: charMax,
        includeNonCharacter: !!opts.drama && !lockedCast && !emptyCast,
      });

  if (useChineseH3 && maxImages > 1) {
    const includeAllRefs = !!opts.drama;
    const slots = buildMinimaxH3ZhRefImageSlots({
      styleReferenceImageUrl: '',
      storyboardImageUrl: storyboardUrl,
      matchedAssets: mvH3Audio
        ? matchedAssets.filter((a) => a?.kind === 'character').slice(0, charMax)
        : matchedAssets,
      maxImages: mvH3Audio ? 1 + charMax : maxImages,
      onlyStoryboardAndCharacters: !includeAllRefs,
    });
    const inputImages = mvH3Audio
      ? collectDirectorMvH3AudioInputImages({
          storyboardImageUrl: storyboardUrl,
          characterImageUrls: slots
            .filter((s) => s.role === 'character')
            .map((s) => s.url),
        })
      : slots.map((s) => s.url);
    const existingFinal = String(opts.shot?.['最终提示词'] || rawPrompt || '').trim();
    if (
      /integrated_multimodal_description/i.test(existingFinal) ||
      /subject_definitions\s*:/i.test(existingFinal)
    ) {
      const kept = stripDirectorPromptInventedLook(existingFinal, storySource);
      return {
        prompt: opts.drama
          ? ensureDirectorDramaVideoPromptGuards(kept, {
              dialogue: String(opts.shot?.['对白旁白'] || '').trim(),
              sfx: String(opts.shot?.['音效'] || '').trim(),
              sourcePrompt: storySource,
              skipDialogueSfxFlatten: true,
              skipSoundscapeGuard: /\[NO_DIALOGUE\]/.test(kept),
              hasDialogue: /\[NO_DIALOGUE\]/.test(kept) ? false : undefined,
            })
          : kept,
        inputImages,
      };
    }
    const shot = opts.shot || {};
    const slotCast = matchedAssets
      .filter((a) => a?.kind === 'character')
      .map((a) => String(a.name || '').trim())
      .filter(Boolean);
    let prompt = composeMinimaxH3ChineseOfficialRefPrompt({
      shot: {
        ...shot,
        最终提示词: String(shot['最终提示词'] || rawPrompt || ''),
        画面描述: String(shot['画面描述'] || opts.fallbackText || ''),
        出场人物: emptyCast ? '' : slotCast.join('、') || String(shot['出场人物'] || ''),
      },
      globalStyle: opts.globalStyle,
      stylePictureIndex: opts.stylePictureIndex ?? 1,
      slots,
      durationSec: opts.durationSec,
      lipsync: !!opts.lipsync,
      hasLipsyncAudio: !!opts.lipsync,
      shotChangePace: opts.shotChangePace,
      emptyShot: emptyCast,
    });
    if (opts.drama) {
      prompt = ensureDirectorDramaVideoPromptGuards(prompt, {
        dialogue: String(shot['对白旁白'] || '').trim(),
        sfx: String(shot['音效'] || '').trim(),
        sourcePrompt: storySource,
        skipDialogueSfxFlatten: true,
        skipSoundscapeGuard: /\[NO_DIALOGUE\]/.test(prompt),
        hasDialogue: /\[NO_DIALOGUE\]/.test(prompt) ? false : undefined,
      });
    }
    return { prompt, inputImages };
  }

  const assetSlice = sliceDirectorShotAssetsForVideo(
    rawPrompt,
    matchedAssets.filter((a) => String(a.imageUrl || '').trim()),
    {
      fallbackText: opts.fallbackText,
      maxImages: Math.max(1, maxImages - (storyboardUrl ? 1 : 0)),
    },
  );

  const inputImages: string[] = [];
  if (storyboardUrl) inputImages.push(storyboardUrl);
  const charUrls = lockedCast || emptyCast
    ? matchedAssets.map((a) => String(a.imageUrl || '').trim()).filter(Boolean)
    : assetSlice.inputImages;
  for (const url of charUrls) {
    if (!url || inputImages.includes(url)) continue;
    inputImages.push(url);
    if (inputImages.length >= maxImages) break;
  }

  // 全能视频 Omni Flash：仅允许 1 或 3 张（2 张时降为分镜单图）
  if (!isDirectorLipsyncModel(opts.model) && model === 'gemini-omni-flash') {
    if (inputImages.length === 2) {
      inputImages.splice(1);
    } else if (inputImages.length > 3) {
      inputImages.length = 3;
    }
  }

  // 单图模型：只保留分镜图（无分镜则退回资产首图）。LTX 不传角色图、不写图片2。
  if (maxImages <= 1) {
    const only = storyboardUrl || inputImages[0] || '';
    const body = stripAndKeepPromptBody(assetSlice.prompt || rawPrompt);
    const prompt = ltxSingle
      ? adaptDirectorPromptForLtxI2v(body)
      : only
        ? appendPrimaryImageBinding(body, '分镜图 / 主参考')
        : body;
    return { prompt, inputImages: only ? [only] : [] };
  }

  // 多图：重编号 —— 分镜图=@图片1，其后为资产
  const body = stripAndKeepPromptBody(assetSlice.prompt || rawPrompt);
  const bindings: string[] = [];
  if (storyboardUrl) {
    bindings.push('@图片1 作为第1张参考图｜分镜｜本镜分镜图｜性别：分镜｜用途：构图与画风锁');
  }
  const assetStart = storyboardUrl ? 2 : 1;
  const assetCount = Math.max(0, inputImages.length - (storyboardUrl ? 1 : 0));
  for (let i = 0; i < assetCount; i++) {
    const n = assetStart + i;
    const url = inputImages[storyboardUrl ? i + 1 : i];
    const ref = (opts.assetRefs || []).find((a) => String(a.imageUrl || '').trim() === url);
    const kind =
      ref?.kind === 'character'
        ? '角色'
        : ref?.kind === 'scene'
          ? '场景'
          : ref?.kind === 'prop'
            ? '道具'
            : ref?.kind === 'creature'
              ? '生物'
              : '参考';
    const name = String(ref?.name || '').trim() || `图片${n}`;
    let gender = '未知';
    if (ref?.kind === 'scene') gender = '场景';
    else if (ref?.kind === 'prop') gender = '道具';
    else if (ref?.kind === 'creature') gender = '生物';
    else if (/女主|性别\s*[:：]\s*女|女性/.test(`${ref?.name || ''}`)) gender = '女';
    else if (/男主|性别\s*[:：]\s*男|男性/.test(`${ref?.name || ''}`)) gender = '男';
    const use =
      ref?.kind === 'character'
        ? '角色身份锁'
        : ref?.kind === 'scene'
          ? '场景环境锁'
          : ref?.kind === 'prop'
            ? '道具外观锁'
            : ref?.kind === 'creature'
              ? '生物外观锁'
              : '参考锁';
    bindings.push(`@图片${n} 作为第${n}张参考图｜${kind}｜${name}｜性别：${gender}｜用途：${use}`);
  }

  const prompt = bindings.length
    ? `${body}${/[。.!？?]$/.test(body) ? '' : '。'}${bindings.join('，')}`
    : body;

  return { prompt, inputImages };
}

function stripAndKeepPromptBody(prompt: string): string {
  return String(prompt || '')
    .replace(/@图片\s*\d+\s*作为第\d+张参考图｜[^\n@]+/g, '')
    .replace(/@(?:图片|Image)\s*\d+/gi, '')
    .replace(/N\/A\s*\.\s*$/i, 'N/A')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[，,。；;\s]+|[，,。；;\s]+$/g, '')
    .trim();
}

function appendPrimaryImageBinding(body: string, label: string): string {
  const b = String(body || '').trim();
  const clause = `@图片1 作为${label}`;
  if (!b) return clause;
  return `${b}${/[。.!？?]$/.test(b) ? '' : '。'}${clause}`;
}

export function buildDirectorSpawnedVideoNodeData(input: {
  model: string;
  duration: string;
  aspectRatio: string;
  resolution: string;
  prompt: string;
  inputImages: string[];
  title: string;
  width: number;
  height: number;
  /** MV：镜号，生视频成功后替换剪辑轨占位 */
  directorShotNo?: string;
  directorSourceId?: string;
  /** 对口型：本镜裁剪后的歌曲片段 URL */
  inputAudioUrl?: string;
  /** 对口型：本镜歌曲片段在原曲中的起止（秒） */
  directorAudioClipStartSec?: number;
  directorAudioClipEndSec?: number;
  directorAudioClipDurationSec?: number;
  /** 空镜：生成时禁人 + 写入负面提示词 */
  emptyShot?: boolean;
  sourcePrompt?: string;
  /** 短剧：勿套用 MV 闭嘴/去台词 */
  drama?: boolean;
  dialogue?: string;
  sfx?: string;
  /** Domain 编译结果：有对白才注入「成片须包含台词」 */
  hasDialogue?: boolean;
  skipSoundscapeGuard?: boolean;
  /** 全能参考：多路参考音（本镜声音优先，最多 3） */
  inputAudioUrls?: string[];
  /**
   * 提示词是否对口型。缺省则跟模型（H3-audio / LTX lipsync 视为开）。
   * MV 固定 H3 时仍可能关闭：提示词要求角色保持沉默、不要说话。
   */
  lipsync?: boolean;
}): Record<string, unknown> {
  const modelIsLipsync = isDirectorLipsyncModel(input.model);
  const model = modelIsLipsync
    ? normalizeDirectorVideoLipsyncModel(input.model)
    : normalizeDirectorVideoBatchModel(input.model);
  const duration = normalizeDirectorVideoBatchDuration(model, input.duration);
  const aspectRatio = normalizeDirectorVideoBatchAspect(model, input.aspectRatio);
  const resolution = normalizeDirectorVideoBatchResolution(model, input.resolution);
  const maxImages = directorVideoBatchMaxImages(model);
  const inputImages = (input.inputImages || []).slice(0, maxImages);
  const inputAudioUrl = String(input.inputAudioUrl || '').trim();
  const extraAudioUrls = (input.inputAudioUrls || [])
    .map((u) => String(u || '').trim())
    .filter(Boolean);
  const mergedAudioUrls = [...new Set([inputAudioUrl, ...extraAudioUrls].filter(Boolean))].slice(
    0,
    3,
  );
  const clipStart = Number(input.directorAudioClipStartSec);
  const clipEnd = Number(input.directorAudioClipEndSec);
  const clipDur = Number(input.directorAudioClipDurationSec);
  const clipMeta =
    Number.isFinite(clipStart) &&
    Number.isFinite(clipEnd) &&
    clipEnd > clipStart
      ? {
          directorAudioClipStartSec: clipStart,
          directorAudioClipEndSec: clipEnd,
          directorAudioClipDurationSec:
            Number.isFinite(clipDur) && clipDur > 0 ? clipDur : clipEnd - clipStart,
        }
      : {};

  const emptyShot =
    !!input.emptyShot ||
    isDirectorEmptyShotPrompt(String(input.prompt || ''), input.sourcePrompt);
  const promptLipsync =
    emptyShot ? false : typeof input.lipsync === 'boolean' ? input.lipsync : modelIsLipsync;
  let prompt = input.drama
    ? ensureDirectorDramaVideoPromptGuards(String(input.prompt || ''), {
        emptyShot,
        sourcePrompt: input.sourcePrompt,
        dialogue: input.dialogue,
        sfx: input.sfx,
        skipDialogueSfxFlatten: true,
        skipSoundscapeGuard:
          !!input.skipSoundscapeGuard || /\[NO_DIALOGUE\]/.test(String(input.prompt || '')),
        hasDialogue:
          typeof input.hasDialogue === 'boolean'
            ? input.hasDialogue
            : /\[NO_DIALOGUE\]/.test(String(input.prompt || ''))
              ? false
              : undefined,
      })
    : ensureDirectorMvVideoPromptGuards(String(input.prompt || ''), {
        lipsync: promptLipsync,
        emptyShot,
        sourcePrompt: input.sourcePrompt,
        skipOnscreenText: isDirectorLtxSingleImageModel(model),
      });
  if (isDirectorLtxSingleImageModel(model)) {
    prompt = adaptDirectorPromptForLtxI2v(prompt);
  }
  const base: Record<string, unknown> = {
    label: '导演视频',
    width: input.width,
    height: input.height,
    title: input.title,
    prompt,
    model,
    aspectRatio,
    inputImages: inputImages.length > 0 ? inputImages : undefined,
    directorVideoSpawnedAt: Date.now(),
    directorPreferLipsync: promptLipsync,
    ...(input.directorShotNo ? { directorShotNo: String(input.directorShotNo) } : {}),
    ...(input.directorSourceId ? { directorSourceId: String(input.directorSourceId) } : {}),
    ...(inputImages.length > 0
      ? {
          negativePrompt: emptyShot
            ? DIRECTOR_EMPTY_SHOT_NEGATIVE_PROMPT
            : DIRECTOR_MV_SCENE_NEGATIVE_PROMPT,
        }
      : {}),
  };

  if (modelIsLipsync) {
    if (isDirectorMinimaxLipsyncModel(model)) {
      return {
        ...base,
        durationMinimaxH3: normalizeMinimaxH3AudioDurationChoice(duration, 20),
        resolutionMinimaxH3: normalizeMinimaxH3Resolution(resolution) as MinimaxH3Resolution,
        inputAudioUrl: inputAudioUrl || '',
        ...clipMeta,
      };
    }
    return {
      ...base,
      resolutionLtx23Lipsync: resolution as '720' | '1280' | '1920',
      inputAudioUrl: inputAudioUrl || '',
      ...clipMeta,
    };
  }
  if (model === 'ltx-2.3-i2v') {
    return {
      ...base,
      durationLtx23I2v: duration,
      resolutionLtx23I2v: resolution as '720' | '1280' | '1920',
    };
  }
  if (model === 'minimax-h3-i2v') {
    return {
      ...base,
      durationMinimaxH3: normalizeMinimaxH3DurationChoice(duration, 10),
      resolutionMinimaxH3: normalizeMinimaxH3Resolution(resolution) as MinimaxH3Resolution,
    };
  }
  if (model === 'minimax-h3-multi') {
    return {
      ...base,
      durationMinimaxH3: normalizeMinimaxH3DurationChoice(duration, 10),
      resolutionMinimaxH3: normalizeMinimaxH3Resolution(resolution) as MinimaxH3Resolution,
      ...(mergedAudioUrls[0] ? { inputAudioUrl: mergedAudioUrls[0] } : {}),
      ...(mergedAudioUrls.length > 0 ? { inputAudioUrls: mergedAudioUrls } : {}),
    };
  }
  if (model === 'rhart-v3.1-pro-se') {
    return {
      ...base,
      resolutionRhartV31: resolution as '720p' | '1080p' | '4k',
    };
  }
  if (model === 'gemini-omni-flash') {
    return {
      ...base,
      durationGeminiOmni: duration as '6' | '8' | '10',
      resolutionGeminiOmni: resolution as '720p' | '1080p' | '4k',
    };
  }
  if (model === 'rhart-video-x') {
    return {
      ...base,
      durationGrok3: duration,
      resolutionGrok3: '720p' as const,
    };
  }
  return {
    ...base,
    durationSeedance: duration,
    resolutionSeedance: resolution,
    aspectRatio: aspectRatio as SeedanceRatioChoice,
  };
}

/** 导演批量/单镜视频元宝计价参数（与 spawn 节点 data 字段对齐） */
export function buildDirectorVideoPriceParams(opts: {
  model: string;
  duration: string;
  resolution: string;
}): {
  model: string;
  durationGrok3?: string;
  resolutionGrok3?: '720p';
  durationLtx23I2v?: '5' | '10' | '15';
  resolutionLtx23I2v?: '720' | '1280' | '1920';
  resolutionLtx23Lipsync?: string;
  durationMinimaxH3?: MinimaxH3DurationChoice | MinimaxH3AudioDurationChoice;
  resolutionMinimaxH3?: MinimaxH3Resolution;
  durationSeedance?: '5' | '10' | '15';
  resolutionSeedance?: '480p' | '720p' | '1080p' | '2k' | '4k';
  resolutionRhartV31?: '720p' | '1080p' | '4k';
  resolutionGeminiOmni?: '720p' | '1080p' | '4k';
  durationGeminiOmni?: '6' | '8' | '10';
} {
  const lipsync = isDirectorLipsyncModel(opts.model);
  const model = lipsync
    ? normalizeDirectorVideoLipsyncModel(opts.model)
    : normalizeDirectorVideoBatchModel(opts.model);
  const duration = normalizeDirectorVideoBatchDuration(model, opts.duration);
  const resolution = normalizeDirectorVideoBatchResolution(model, opts.resolution);
  if (lipsync) {
    if (isDirectorMinimaxLipsyncModel(model)) {
      return {
        model,
        durationMinimaxH3: normalizeMinimaxH3AudioDurationChoice(duration, 20),
        resolutionMinimaxH3: normalizeMinimaxH3Resolution(resolution),
      };
    }
    return { model, resolutionLtx23Lipsync: resolution };
  }
  if (model === 'ltx-2.3-i2v') {
    return {
      model,
      durationLtx23I2v: duration as '5' | '10' | '15',
      resolutionLtx23I2v: resolution as '720' | '1280' | '1920',
    };
  }
  if (model === 'minimax-h3-i2v') {
    return {
      model,
      durationMinimaxH3: normalizeMinimaxH3DurationChoice(duration, 10),
      resolutionMinimaxH3: normalizeMinimaxH3Resolution(resolution),
    };
  }
  if (model === 'minimax-h3-multi') {
    return {
      model,
      durationMinimaxH3: normalizeMinimaxH3DurationChoice(duration, 10),
      resolutionMinimaxH3: normalizeMinimaxH3Resolution(resolution),
    };
  }
  if (model === 'rhart-v3.1-pro-se') {
    return {
      model,
      resolutionRhartV31: resolution as '720p' | '1080p' | '4k',
    };
  }
  if (model === 'gemini-omni-flash') {
    return {
      model,
      durationGeminiOmni: duration as '6' | '8' | '10',
      resolutionGeminiOmni: resolution as '720p' | '1080p' | '4k',
    };
  }
  if (model === 'rhart-video-x') {
    return {
      model,
      durationGrok3: duration,
      resolutionGrok3: '720p',
    };
  }
  return {
    model,
    durationSeedance: duration as '5' | '10' | '15',
    resolutionSeedance: resolution as '480p' | '720p' | '1080p' | '2k' | '4k',
  };
}

export function directorVideoBatchModelLabel(model: string): string {
  if (isDirectorLipsyncModel(model)) {
    const id = normalizeDirectorVideoLipsyncModel(model);
    return DIRECTOR_VIDEO_LIPSYNC_MODELS.find((x) => x.value === id)?.label || id;
  }
  const m = normalizeDirectorVideoBatchModel(model);
  return DIRECTOR_I2V_MODEL_META[m]?.label || m;
}

/** 从导演生成的视频节点 data 组装 invokeAI input（表内生成，不依赖面板） */
export function buildDirectorSpawnedVideoInvokeInput(
  nodeData: Record<string, unknown>,
  opts?: { projectId?: string },
): Record<string, unknown> | null {
  const rawModel = String(nodeData.model || '').trim();
  if (!rawModel) return null;
  const lipsync = isDirectorLipsyncModel(rawModel);
  const model = lipsync
    ? normalizeDirectorVideoLipsyncModel(rawModel)
    : normalizeDirectorVideoBatchModel(rawModel);
  const prompt = String(nodeData.actionPrompt || nodeData.prompt || '').trim();
  const images = Array.isArray(nodeData.inputImages)
    ? (nodeData.inputImages as string[]).map((u) => String(u || '').trim()).filter(Boolean)
    : [];
  if (!prompt && !lipsync) return null;
  // H3 全能参考允许 0 张参考图（文生）；口型同步仍必须有图
  if (images.length === 0 && model !== 'minimax-h3-multi') return null;

  const aspectRatio = String(nodeData.aspectRatio || '16:9');
  const projectId = String(opts?.projectId || '').trim();
  const base: Record<string, unknown> = {
    model,
    prompt,
    aspect_ratio: aspectRatio,
    nodeTitle: String(nodeData.title || ''),
    ...(projectId ? { projectId } : {}),
  };

  if (lipsync) {
    const audio = String(nodeData.inputAudioUrl || '').trim();
    const isDrama = !!nodeData.drama;
    const lipsyncPrompt = isDrama
      ? prompt
      : ensureDirectorMvVideoPromptGuards(prompt, {
          lipsync: nodeData.directorPreferLipsync !== false,
        });
    if (!lipsyncPrompt || images.length === 0 || !audio) return null;
    const clipDur = Number(nodeData.directorAudioClipDurationSec);
    const clipStart = Number(nodeData.directorAudioClipStartSec);
    const clipEnd = Number(nodeData.directorAudioClipEndSec);
    const clipFields = {
      ...(Number.isFinite(clipDur) && clipDur > 0 ? { directorAudioClipDurationSec: clipDur } : {}),
      ...(Number.isFinite(clipStart) ? { directorAudioClipStartSec: clipStart } : {}),
      ...(Number.isFinite(clipEnd) ? { directorAudioClipEndSec: clipEnd } : {}),
    };
    if (isDirectorMinimaxLipsyncModel(model)) {
      const mediaDur = Number(nodeData.mediaDurationSec);
      const mappedFromAudio =
        Number.isFinite(clipDur) && clipDur > 0
          ? mapMinimaxH3AudioBillingDurationSec(clipDur)
          : Number.isFinite(mediaDur) && mediaDur > 0
            ? mapMinimaxH3AudioBillingDurationSec(mediaDur)
            : null;
      return {
        ...base,
        prompt: lipsyncPrompt,
        actionPrompt: lipsyncPrompt,
        images: images.slice(0, 5),
        durationMinimaxH3:
          mappedFromAudio != null
            ? (String(mappedFromAudio) as MinimaxH3AudioDurationChoice)
            : normalizeMinimaxH3AudioDurationChoice(
                nodeData.durationMinimaxH3 as string | number | undefined,
                20,
              ),
        resolutionMinimaxH3: normalizeMinimaxH3Resolution(nodeData.resolutionMinimaxH3),
        inputAudioUrl: audio,
        ...clipFields,
      };
    }
    const resRaw = String(nodeData.resolutionLtx23Lipsync || '720');
    const resolutionLtx23Lipsync =
      resRaw === '1280' || resRaw === '1920' ? resRaw : '720';
    return {
      ...base,
      prompt: lipsyncPrompt,
      actionPrompt: lipsyncPrompt,
      images: images.slice(0, 1),
      inputAudioUrl: audio,
      resolutionLtx23Lipsync,
      ...clipFields,
    };
  }

  if (model === 'ltx-2.3-i2v') {
    return {
      ...base,
      images: images.slice(0, 1),
      durationLtx23I2v: String(nodeData.durationLtx23I2v || '10'),
      resolutionLtx23I2v: String(nodeData.resolutionLtx23I2v || '720'),
    };
  }
  if (model === 'minimax-h3-i2v') {
    return {
      ...base,
      images: images.slice(0, 1),
      durationMinimaxH3: normalizeMinimaxH3DurationChoice(
        nodeData.durationMinimaxH3 as string | number | undefined,
        10,
      ),
      resolutionMinimaxH3: normalizeMinimaxH3Resolution(nodeData.resolutionMinimaxH3),
    };
  }
  if (model === 'minimax-h3-multi') {
    const fromArr = Array.isArray(nodeData.inputAudioUrls)
      ? (nodeData.inputAudioUrls as unknown[])
          .map((u) => String(u || '').trim())
          .filter(Boolean)
      : [];
    const aud = String(nodeData.inputAudioUrl || '').trim();
    const audios = [...new Set([aud, ...fromArr].filter(Boolean))].slice(0, 3);
    return {
      ...base,
      images: images.slice(0, 9),
      durationMinimaxH3: normalizeMinimaxH3DurationChoice(
        nodeData.durationMinimaxH3 as string | number | undefined,
        10,
      ),
      resolutionMinimaxH3: normalizeMinimaxH3Resolution(nodeData.resolutionMinimaxH3),
      ...(audios[0] ? { inputAudioUrl: audios[0] } : {}),
      ...(audios.length > 0 ? { inputAudioUrls: audios } : {}),
    };
  }
  if (model === 'rhart-v3.1-pro-se') {
    return {
      ...base,
      images: images.slice(0, 2),
      resolutionRhartV31: String(nodeData.resolutionRhartV31 || '1080p'),
    };
  }
  if (model === 'gemini-omni-flash') {
    let geminiImages = images.slice(0, 3);
    if (geminiImages.length === 2) geminiImages = geminiImages.slice(0, 1);
    return {
      ...base,
      images: geminiImages,
      durationGeminiOmni: String(nodeData.durationGeminiOmni || '6'),
      resolutionGeminiOmni: String(nodeData.resolutionGeminiOmni || '720p'),
    };
  }
  if (model === 'rhart-video-x') {
    return {
      ...base,
      images: images.slice(0, 7),
      durationGrok3: String(nodeData.durationGrok3 || '10'),
      resolutionGrok3: '720p',
    };
  }
  return {
    ...base,
    images: images.slice(0, 9),
    durationSeedance: String(nodeData.durationSeedance || '10'),
    resolutionSeedance: String(nodeData.resolutionSeedance || '720p'),
  };
}

/** @deprecated 旧签名兼容 */
export function prepareDirectorShotVideoPayloadLegacy(
  rawPrompt: string,
  assetRefs: DirectorVideoAssetRef[],
  model: string,
  fallbackText?: string,
): { prompt: string; inputImages: string[] } {
  return prepareDirectorShotVideoPayload({
    rawPrompt,
    assetRefs,
    model,
    fallbackText,
  });
}

export { extractSeedanceImageMentionIndices };
