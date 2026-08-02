/**
 * 导演批量生成视频：模型参数 + 分镜图优先参考图组装。
 * 普通 MV 生视频 = 活跃图生（i2v）全目录；对口型单独 LTX lipsync。
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
  RHART_VIDEO_X_DURATION_SEC_OPTIONS,
  SEEDANCE_DURATION_SEC_OPTIONS,
  SEEDANCE_FAST_RESOLUTION_OPTIONS,
  SEEDANCE_MINI_RESOLUTION_OPTIONS,
  SEEDANCE_RATIO_OPTIONS,
  coerceSeedanceRatio,
  coerceSeedanceResolution,
  normalizeGeminiOmniFlashDurationChoice,
  normalizeLtx23DurationChoice,
  normalizeRhartVideoXDurationStr,
  normalizeSeedanceDurationChoice,
  type SeedanceRatioChoice,
} from './videoBillingSku';
import { DEFAULT_VIDEO_ASPECT_RATIO } from './nodeSizeFromAspectRatio';
import { ensureDirectorLipsyncMouthVisiblePrompt } from '../../shared/directorPipeline';
import {
  extractSeedanceImageMentionIndices,
  sliceDirectorShotAssetsForVideo,
  type DirectorVideoAssetRef,
} from './seedanceImageMentions';

export const DIRECTOR_VIDEO_LIPSYNC_MODEL = 'ltx-2.3-lipsync' as const;

/** 标签与 VideoInputPanel VIDEO_I2V_MODEL_LABELS / videoInputPanelI18n 对齐 */
const DIRECTOR_I2V_MODEL_META: Record<
  ActiveI2vCatalogModelId,
  { label: string; title: string }
> = {
  'ltx-2.3-i2v': {
    label: 'LTX2.3 图生视频',
    title: '单张参考图（优先分镜图）；时长 5/10/15 秒；可独立选清晰度',
  },
  'rhart-v3.1-pro-se': {
    label: '全能视频V3.1-pro-首尾帧生视频',
    title: '首尾帧；海外站；首帧必填、尾帧可选；时长仅 8s；比例 16:9/9:16；分辨率 720p/1080p/4k',
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

/** 普通图生视频模型（不含对口型）；与 VideoInputPanel 活跃 i2v 目录一致 */
export const DIRECTOR_VIDEO_BATCH_MODELS = getActiveI2vCatalogModelIds().map((value) => ({
  value,
  label: DIRECTOR_I2V_MODEL_META[value].label,
  title: DIRECTOR_I2V_MODEL_META[value].title,
}));

/** 对口型模型：LTX2.3 对口型（与图生清晰度分开选） */
export const DIRECTOR_VIDEO_LIPSYNC_MODELS = [
  {
    value: DIRECTOR_VIDEO_LIPSYNC_MODEL,
    label: 'LTX2.3 对口型',
    title: '需参考图 + 音频；有对白镜头推荐；可独立选清晰度',
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
  if (MODEL_SET.has(m)) return m as DirectorVideoBatchModelId;
  if (isRetiredVideoModel(m)) {
    const next = normalizeVideoModelIfRetired(m);
    if (MODEL_SET.has(next)) return next as DirectorVideoBatchModelId;
  }
  // 旧数据若存过对口型模型，回落到默认图生模型
  return 'ltx-2.3-i2v';
}

export function normalizeDirectorVideoLipsyncModel(
  raw: string | undefined | null,
): DirectorVideoLipsyncModelId {
  const m = String(raw ?? '').trim();
  if (LIPSYNC_MODEL_SET.has(m)) return m as DirectorVideoLipsyncModelId;
  return DIRECTOR_VIDEO_LIPSYNC_MODEL;
}

export function isDirectorLipsyncModel(model: string | undefined | null): boolean {
  return LIPSYNC_MODEL_SET.has(String(model ?? '').trim());
}

export function directorVideoBatchMaxImages(model: string): number {
  if (isDirectorLipsyncModel(model)) return 1;
  const m = normalizeDirectorVideoBatchModel(model);
  if (m === 'ltx-2.3-i2v') return 1;
  if (m === 'rhart-v3.1-pro-se') return 2;
  if (m === 'gemini-omni-flash') return 3;
  if (m === 'rhart-video-x') return 7;
  return 9; // seedance
}

const LTX_I2V_RES_OPTIONS = ['720', '1280', '1920'] as const;
const P_RES_OPTIONS = ['720p', '1080p', '4k'] as const;
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
  if (isDirectorLipsyncModel(model)) return null;
  const m = normalizeDirectorVideoBatchModel(model);
  if (m === 'ltx-2.3-i2v') {
    return LTX23_DURATION_SEC_OPTIONS.map((s) => ({ value: String(s), label: `${s}s` }));
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

/** 返回 null 表示该模型不展示比例下拉 */
export function getDirectorVideoBatchAspectOptions(
  model: string,
): DirectorVideoBatchFieldOption[] | null {
  if (isDirectorLipsyncModel(model)) return null;
  const m = normalizeDirectorVideoBatchModel(model);
  if (m === 'ltx-2.3-i2v') return null;
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
  if (isDirectorLipsyncModel(model)) {
    return normalizeLtx23DurationChoice(rawIn, 10);
  }
  const m = normalizeDirectorVideoBatchModel(model);
  if (m === 'ltx-2.3-i2v') return normalizeLtx23DurationChoice(rawIn, 10);
  if (m === 'rhart-v3.1-pro-se') return '8';
  if (m === 'gemini-omni-flash') return normalizeGeminiOmniFlashDurationChoice(rawIn, 6);
  if (m === 'rhart-video-x') return normalizeRhartVideoXDurationStr(rawIn, '10');
  return normalizeSeedanceDurationChoice(rawIn, 10);
}

/**
 * 按镜头规划时长取当前视频模型支持的档位（秒数字符串）。
 * 优先取「≥ 规划秒」的最小档，避免 6s 规划落到 5s 成片后不够裁切；
 * 若全部档位都更短则取最长档。
 */
export function pickNearestDirectorVideoBatchDuration(
  model: string,
  shotDurationSec: number,
  fallbackSec = 10,
): string {
  const sec =
    Number.isFinite(shotDurationSec) && shotDurationSec > 0
      ? Math.round(shotDurationSec)
      : fallbackSec;
  const opts = getDirectorVideoBatchDurationOptions(model);
  if (opts && opts.length > 0) {
    const nums = opts
      .map((o) => parseInt(String(o.value), 10))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
    if (nums.length > 0) {
      const ceil = nums.find((n) => n >= sec);
      if (ceil != null) return String(ceil);
      return String(nums[nums.length - 1]);
    }
  }
  return normalizeDirectorVideoBatchDuration(model, String(sec));
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
  if (isDirectorLipsyncModel(model)) {
    const s = String(raw ?? '').trim();
    return s === '9:16' ? '9:16' : '16:9';
  }
  const m = normalizeDirectorVideoBatchModel(model);
  const s = String(raw ?? '').trim();
  if (m === 'ltx-2.3-i2v') {
    return s === '9:16' ? '9:16' : '16:9';
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
  if (isDirectorLipsyncModel(model)) {
    const s = String(raw ?? '').trim();
    return (LTX_I2V_RES_OPTIONS as readonly string[]).includes(s) ? s : '720';
  }
  const m = normalizeDirectorVideoBatchModel(model);
  if (m === 'ltx-2.3-i2v') return coerceLtxI2vResolution(raw);
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
 * 组装单镜视频参考图与提示词：
 * 1) 分镜图为首图（@图片1）
 * 2) 再追加本镜匹配的角色/场景/道具（去重，按模型上限裁剪）
 */
export function prepareDirectorShotVideoPayload(opts: {
  rawPrompt: string;
  assetRefs: DirectorVideoAssetRef[];
  model: string;
  storyboardImageUrl?: string;
  fallbackText?: string;
}): { prompt: string; inputImages: string[] } {
  const model = isDirectorLipsyncModel(opts.model)
    ? normalizeDirectorVideoLipsyncModel(opts.model)
    : normalizeDirectorVideoBatchModel(opts.model);
  const maxImages = directorVideoBatchMaxImages(model);
  const storyboardUrl = String(opts.storyboardImageUrl || '').trim();
  const rawPrompt = String(opts.rawPrompt || '');

  const assetBudget = Math.max(1, maxImages - (storyboardUrl ? 1 : 0));
  const assetSlice = sliceDirectorShotAssetsForVideo(rawPrompt, opts.assetRefs || [], {
    fallbackText: opts.fallbackText,
    maxImages: assetBudget,
  });

  const inputImages: string[] = [];
  if (storyboardUrl) inputImages.push(storyboardUrl);
  for (const url of assetSlice.inputImages) {
    if (!url || inputImages.includes(url)) continue;
    inputImages.push(url);
    if (inputImages.length >= maxImages) break;
  }

  // 多图模型：补齐选角步有图角色（避免提示词未 @ 到时只剩分镜/单角色）
  if (maxImages > 1 && inputImages.length < maxImages) {
    const charUrls = (opts.assetRefs || [])
      .filter((a) => a?.kind === 'character' && String(a.imageUrl || '').trim())
      .map((a) => String(a.imageUrl).trim());
    for (const url of charUrls) {
      if (!url || inputImages.includes(url)) continue;
      inputImages.push(url);
      if (inputImages.length >= maxImages) break;
    }
  }

  // 全能视频 Omni Flash：仅允许 1 或 3 张（2 张时降为分镜单图）
  if (!isDirectorLipsyncModel(opts.model) && model === 'gemini-omni-flash') {
    if (inputImages.length === 2) {
      inputImages.splice(1);
    } else if (inputImages.length > 3) {
      inputImages.length = 3;
    }
  }

  // 单图模型：只保留分镜图（无分镜则退回资产首图）
  if (maxImages <= 1) {
    const only = storyboardUrl || inputImages[0] || '';
    const body = stripAndKeepPromptBody(assetSlice.prompt || rawPrompt);
    const prompt = only
      ? appendPrimaryImageBinding(body, '分镜图 / 主参考')
      : body;
    return { prompt, inputImages: only ? [only] : [] };
  }

  // 多图：重编号 —— 分镜图=@图片1，其后为资产
  const body = stripAndKeepPromptBody(assetSlice.prompt || rawPrompt);
  const bindings: string[] = [];
  if (storyboardUrl) {
    bindings.push('@图片1 作为第1张参考图｜分镜｜本镜分镜图｜性别：场景｜用途：分镜主画面锁');
  }
  const assetStart = storyboardUrl ? 2 : 1;
  const assetCount = Math.max(0, inputImages.length - (storyboardUrl ? 1 : 0));
  for (let i = 0; i < assetCount; i++) {
    const n = assetStart + i;
    const url = inputImages[storyboardUrl ? i + 1 : i];
    const ref = (opts.assetRefs || []).find((a) => String(a.imageUrl || '').trim() === url);
    const kind =
      ref?.kind === 'character' ? '角色' : ref?.kind === 'scene' ? '场景' : ref?.kind === 'prop' ? '道具' : '参考';
    const name = String(ref?.name || '').trim() || `图片${n}`;
    let gender = '未知';
    if (ref?.kind === 'scene') gender = '场景';
    else if (ref?.kind === 'prop') gender = '道具';
    else if (/女主|性别\s*[:：]\s*女|女性/.test(`${ref?.name || ''}`)) gender = '女';
    else if (/男主|性别\s*[:：]\s*男|男性/.test(`${ref?.name || ''}`)) gender = '男';
    const use =
      ref?.kind === 'character'
        ? '角色身份锁'
        : ref?.kind === 'scene'
          ? '场景环境锁'
          : ref?.kind === 'prop'
            ? '道具外观锁'
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
    .replace(/@(?:图片|Image)\s*\d+/gi, '')
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
}): Record<string, unknown> {
  const lipsync = isDirectorLipsyncModel(input.model);
  const model = lipsync
    ? normalizeDirectorVideoLipsyncModel(input.model)
    : normalizeDirectorVideoBatchModel(input.model);
  const duration = normalizeDirectorVideoBatchDuration(model, input.duration);
  const aspectRatio = normalizeDirectorVideoBatchAspect(model, input.aspectRatio);
  const resolution = normalizeDirectorVideoBatchResolution(model, input.resolution);
  const maxImages = directorVideoBatchMaxImages(model);
  const inputImages = (input.inputImages || []).slice(0, maxImages);
  const inputAudioUrl = String(input.inputAudioUrl || '').trim();
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

  const base: Record<string, unknown> = {
    label: '导演视频',
    width: input.width,
    height: input.height,
    title: input.title,
    prompt: lipsync
      ? ensureDirectorLipsyncMouthVisiblePrompt(input.prompt)
      : input.prompt,
    model,
    aspectRatio,
    inputImages: inputImages.length > 0 ? inputImages : undefined,
    ...(input.directorShotNo ? { directorShotNo: String(input.directorShotNo) } : {}),
    ...(input.directorSourceId ? { directorSourceId: String(input.directorSourceId) } : {}),
  };

  if (lipsync) {
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
    return { model, resolutionLtx23Lipsync: resolution };
  }
  if (model === 'ltx-2.3-i2v') {
    return {
      model,
      durationLtx23I2v: duration as '5' | '10' | '15',
      resolutionLtx23I2v: resolution as '720' | '1280' | '1920',
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
  // 导演台生视频均为图生：无参考图则不发起
  if (images.length === 0) return null;

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
    const lipsyncPrompt = ensureDirectorLipsyncMouthVisiblePrompt(prompt);
    if (!lipsyncPrompt || images.length === 0 || !audio) return null;
    const resRaw = String(nodeData.resolutionLtx23Lipsync || '720');
    const resolutionLtx23Lipsync =
      resRaw === '1280' || resRaw === '1920' ? resRaw : '720';
    const clipDur = Number(nodeData.directorAudioClipDurationSec);
    const clipStart = Number(nodeData.directorAudioClipStartSec);
    const clipEnd = Number(nodeData.directorAudioClipEndSec);
    return {
      ...base,
      prompt: lipsyncPrompt,
      actionPrompt: lipsyncPrompt,
      images: images.slice(0, 1),
      inputAudioUrl: audio,
      resolutionLtx23Lipsync,
      ...(Number.isFinite(clipDur) && clipDur > 0 ? { directorAudioClipDurationSec: clipDur } : {}),
      ...(Number.isFinite(clipStart) ? { directorAudioClipStartSec: clipStart } : {}),
      ...(Number.isFinite(clipEnd) ? { directorAudioClipEndSec: clipEnd } : {}),
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
