/** NEXFLOW director pipeline — script 模式 + MV 音乐驱动模式。 */

import { getDirectorStylePreset, directorStylePresetImageUrl, normalizeDirectorStylePresetId } from './stylePresets.js';
import { ensureDirectorSceneBuiltinPrompt } from './assetImagePrompts.js';
import type {
  DirectorMvLyricSegment,
  DirectorMvLyricSegmentStatus,
  DirectorLyricShotPack,
  DirectorMvClipLengthMode,
  DirectorMvPackAudioRole,
} from './lyricTimeline.js';
import {
  parseLrcToLyricSegments,
  normalizeDirectorMvLyricSegments,
  coverSongWithLyricSegments,
  calibrateLyricSegmentsWithUserLyrics,
  splitUserLyricLines,
  packLyricSegmentsIntoShotPacks,
  pickNearestMvClipDurationTier,
  resolveMvClipDurationTiers,
  DIRECTOR_MV_CLIP_DURATION_TIERS,
  DIRECTOR_MV_CLIP_DURATION_TIERS_LONG,
  DIRECTOR_MV_CLIP_DURATION_TIERS_SHORT,
  shotMusicRangesFromLyricPacks,
  shotAudioRangeHasHumanVoice,
  classifyDirectorMvPackAudioRole,
  directorMvPackAudioRoleLabelZh,
  isDirectorLyricShotPackInstrumental,
  applyDirectorInstrumentalVisualGuards,
  stripDirectorSingingPerformanceFromText,
  DIRECTOR_INSTRUMENTAL_NO_SING_GUARD,
  isDirectorInstrumentalLyricText,
  sanitizeDirectorLyricDisplayText,
  isDirectorNonLyricMetaText,
  stripDirectorLyricsScriptMeta,
  breakDirectorLyricTextIntoLines,
  formatDirectorLyricsFromAsr,
} from './lyricTimeline.js';

export type {
  DirectorMvLyricSegment,
  DirectorMvLyricSegmentStatus,
  DirectorLyricShotPack,
  DirectorMvClipLengthMode,
  DirectorMvPackAudioRole,
} from './lyricTimeline.js';
export {
  parseLrcToLyricSegments,
  normalizeDirectorMvLyricSegments,
  coverSongWithLyricSegments,
  calibrateLyricSegmentsWithUserLyrics,
  splitUserLyricLines,
  packLyricSegmentsIntoShotPacks,
  pickNearestMvClipDurationTier,
  resolveMvClipDurationTiers,
  DIRECTOR_MV_CLIP_DURATION_TIERS,
  DIRECTOR_MV_CLIP_DURATION_TIERS_LONG,
  DIRECTOR_MV_CLIP_DURATION_TIERS_SHORT,
  shotMusicRangesFromLyricPacks,
  shotAudioRangeHasHumanVoice,
  classifyDirectorMvPackAudioRole,
  directorMvPackAudioRoleLabelZh,
  isDirectorLyricShotPackInstrumental,
  applyDirectorInstrumentalVisualGuards,
  stripDirectorSingingPerformanceFromText,
  DIRECTOR_INSTRUMENTAL_NO_SING_GUARD,
  isDirectorInstrumentalLyricText,
  sanitizeDirectorLyricDisplayText,
  isDirectorNonLyricMetaText,
  stripDirectorLyricsScriptMeta,
  breakDirectorLyricTextIntoLines,
  formatDirectorLyricsFromAsr,
};

export const SCHEMA_VERSION = 'director-pipeline.v1';
export const SCRIPT_NODE_TYPE = 'script';
export const DIRECTOR_NODE_TYPE = 'director';

/** script：剧本导演；mv：音乐 MV 导演 */
export type DirectorMode = 'script' | 'mv';

/**
 * script 常用：shots | assets | prompts | storyboards
 * mv 额外：music | style | cast | story | videos | preview
 * （旧工程 phase=ratio 会归一到 videos）
 */
export type DirectorPhase =
  | 'music'
  | 'style'
  | 'story'
  | 'cast'
  | 'videos'
  | 'shots'
  | 'assets'
  | 'prompts'
  | 'storyboards'
  | 'preview';

/** 准备资产子步骤：角色 → 场景 → 道具 */
export type DirectorAssetsStep = 'characters' | 'scenes' | 'props';

export type DirectorStoryboardStatus = 'pending' | 'generating' | 'ready' | 'error';

export interface DirectorShotStoryboard {
  imageUrl: string;
  status: DirectorStoryboardStatus;
  error?: string;
  /** 该镜分镜图生成比例（如 16:9），缺省时用全局画幅 */
  aspectRatio?: string;
  /**
   * 分镜图生视频时是否优先对口型。
   * undefined = 按景别/对白自动推荐；true/false = 用户手动指定。
   */
  preferLipsync?: boolean;
  /**
   * 本镜手动指定的角色资产 id（有图）。
   * undefined = 按提示词自动匹配；[] = 明确空镜不绑角色；非空 = 用户勾选。
   */
  castAssetIds?: string[];
  /**
   * 本镜手动指定的场景资产 id（有图，最多 1 个）。
   * undefined = 自动匹配；[] = 不绑场景；非空 = 用户选定。
   */
  sceneAssetIds?: string[];
  /** 本镜已裁剪的原曲片段 URL（local-resource / http） */
  songClipUrl?: string;
  /** 裁剪所用原曲 URL；与当前 mvMusic.url 不一致时视为失效 */
  songClipSourceUrl?: string;
  songClipStartSec?: number;
  songClipEndSec?: number;
  /** 本镜绑定的人声时间轴起止（优先于按时长累加） */
  audioStartSec?: number;
  audioEndSec?: number;
  /** 本镜已生成视频 URL（界面内展示，不依赖画布外视频模块） */
  videoUrl?: string;
  videoStatus?: DirectorStoryboardStatus;
  videoError?: string;
  /** 后台生成用的隐藏视频节点 id */
  videoNodeId?: string;
}

export const DIRECTOR_MV_ASPECT_OPTIONS = ['16:9', '9:16', '3:4', '4:3'] as const;
export type DirectorMvAspectRatio = (typeof DIRECTOR_MV_ASPECT_OPTIONS)[number];

export interface DirectorMvMusic {
  url: string;
  durationSec: number;
  title: string;
  /** 简易分析摘要（第一期可手填 / 自动写时长） */
  summary: string;
  moodHint: string;
  /** 歌词正文（可粘贴或上传 .txt/.lrc） */
  lyrics: string;
  sourceNodeId?: string;
  /**
   * 人声/半句时间轴（优先：整曲云端 fun-asr；不依赖 LRC）。
   * 切歌与镜头绑定以段边界为准，不在段中间切开。
   */
  lyricSegments?: DirectorMvLyricSegment[];
  lyricSegmentsStatus?: DirectorMvLyricSegmentStatus;
  lyricSegmentsError?: string;
  /** 生成 lyricSegments 所用原曲 URL，换歌后失效 */
  lyricSegmentsSourceUrl?: string;
  /**
   * 切镜时长档位：long=长镜 10/15s，short=短镜 4/5/6s。
   * 默认短镜。
   */
  clipLengthMode?: 'long' | 'short';
}

/** MV 剧本结构化分节（展示/编辑用，顺序：剧情→世界观→人物关系→…） */
export interface DirectorMvScriptSections {
  /** 剧情规划（先于世界观） */
  plot: string;
  /** 世界观 */
  worldView: string;
  /** 人物关系 */
  relationships: string;
  /** 人物库 */
  characters: string;
  /** 场景库 */
  scenes: string;
  /** 道具库 */
  props: string;
}

/** MV 剧本步：AI 音乐分析 + 剧本关键词 + 分节正文 */
export interface DirectorMvStoryAnalysis {
  /** 分析总结正文 */
  summary: string;
  /** 曲风标签，如 POP */
  genre: string;
  /** 主要情绪标签 */
  emotions: string[];
  /** 歌曲关键词 */
  keywords: string[];
  /** 剧本关键词（写剧本后提炼） */
  scriptKeywords: string[];
  /** 结构化剧本分节 */
  sections: DirectorMvScriptSections;
}

/** MV 主角性别（绑在选角槽位，不必给每张素材图单独标性别） */
export type DirectorMvLeadGender = 'male' | 'female';

/** MV：选角计划（剧本之前锁定） */
export interface DirectorMvCastPlan {
  /** 1=单主角，2=双主角 */
  leadCount: 1 | 2;
  lead1Gender: DirectorMvLeadGender;
  /** 双主角时生效 */
  lead2Gender: DirectorMvLeadGender;
}

export type DirectorAssetGender = DirectorMvLeadGender | '';

export const DIRECTOR_SHOT_COLUMNS = [
  '镜号',
  '时长',
  '画面描述',
  '镜头角度',
  '焦距',
  '景别',
  '光影氛围',
  '对白旁白',
  '音效',
  '运镜',
  '最终提示词',
] as const;

export type DirectorShotColumnKey = (typeof DIRECTOR_SHOT_COLUMNS)[number];
export type DirectorShot = Record<DirectorShotColumnKey, string>;

export type DirectorAssetKind = 'character' | 'scene' | 'prop';

export type DirectorAssetStatus = 'pending' | 'generating' | 'ready' | 'error';

export interface DirectorAsset {
  id: string;
  kind: DirectorAssetKind;
  name: string;
  /** Image-generation prompt / attribute string */
  prompt: string;
  imageUrl: string;
  status: DirectorAssetStatus;
  error?: string;
  /** 角色性别（选角槽位写入；场景/道具可空） */
  gender?: DirectorAssetGender;
}

export interface DirectorAssetsBag {
  characters: DirectorAsset[];
  scenes: DirectorAsset[];
  props: DirectorAsset[];
}

export interface DirectorPipelineState {
  version: number;
  mode: DirectorMode;
  phase: DirectorPhase;
  /** 准备资产子步骤（仅 phase=assets 时有意义） */
  assetsStep: DirectorAssetsStep;
  scriptText: string;
  title: string;
  /** 预设 id：street_crew / cyber_neon / … / custom */
  stylePresetId: string;
  /** 全篇风格正文（可选预设写入，也可自定义编辑） */
  globalStyle: string;
  /** 当前选中的风格参考图 URL（与预设图一致，或用户自定义上传） */
  styleReferenceImageUrl: string;
  shots: DirectorShot[];
  assets: DirectorAssetsBag;
  /** 每镜分镜图，key = 镜号 */
  storyboardsByShotNo: Record<string, DirectorShotStoryboard>;
  /** Asset ids selected for batch image generation */
  selectedAssetIds: string[];
  chatModel: string;
  imageModel: string;
  imageAspectRatio: string;
  imageResolution: string;
  /** 批量出视频：与视频模块选项对齐，统一写入每个新视频节点 */
  videoBatchModel: string;
  /** 对口型模型（与普通视频模型分开选） */
  videoBatchLipsyncModel: string;
  videoBatchDuration: string;
  videoBatchAspectRatio: string;
  videoBatchResolution: string;
  /** 对口型清晰度（与普通视频清晰度分开选） */
  videoBatchLipsyncResolution: string;
  /** 切到对口型前记住的模型，便于恢复 */
  videoBatchModelBeforeLipsync: string;
  /** MV：音乐 */
  mvMusic: DirectorMvMusic;
  /** MV：剧本步 AI 分析（总结 / 曲风情绪 / 关键词） */
  mvStoryAnalysis: DirectorMvStoryAnalysis;
  /**
   * MV 剧本步：是否开启「参考生成」。
   * true = 可填参考并由 AI 生成剧本；false = 纯手动填写剧本（隐藏参考区与生成按钮）。
   */
  mvScriptUseReferenceGen: boolean;
  /** MV 剧本步：参考内容（开启参考生成时传入 AI） */
  mvScriptReference: string;
  /**
   * MV：近景特写开关（剧本步 UI 设置；分镜/视频生成与对口型仍读此字段）。
   * true = 有人镜仅允许特写/大特写（禁止半身、全身）；空镜仍按场景公式。
   * false = 景别/运镜不限。默认 true。
   */
  mvCloseUpFraming: boolean;
  /** MV：选角计划（主角人数 + 性别，剧本之前锁定） */
  mvCastPlan: DirectorMvCastPlan;
  /** MV：画幅（分镜图与视频统一） */
  mvAspectRatio: DirectorMvAspectRatio;
  /** MV：关联的剪辑节点（图片预览轨） */
  linkedSpliceNodeId: string;
  isGenerating: boolean;
  error: string;
}

function newAssetId(kind: DirectorAssetKind, index: number): string {
  return `${kind}-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createEmptyDirectorShot(index = 0): DirectorShot {
  return {
    镜号: String(index + 1),
    时长: '',
    画面描述: '',
    镜头角度: '',
    焦距: '',
    景别: '',
    光影氛围: '',
    对白旁白: '',
    音效: '',
    运镜: '',
    最终提示词: '',
  };
}

/** 手动添加/插入的空行：除镜号外内容字段皆空（「—」也视为空） */
export function isBlankDirectorShot(shot: Partial<DirectorShot> | null | undefined): boolean {
  if (!shot) return true;
  const keys: DirectorShotColumnKey[] = [
    '时长',
    '画面描述',
    '镜头角度',
    '焦距',
    '景别',
    '光影氛围',
    '对白旁白',
    '音效',
    '运镜',
    '最终提示词',
  ];
  return keys.every((k) => {
    const v = String(shot[k] || '').trim();
    return !v || v === '—';
  });
}

export function createEmptyDirectorAsset(
  kind: DirectorAssetKind,
  name = '',
  prompt = '',
  index = 0,
  gender: DirectorAssetGender = '',
): DirectorAsset {
  return {
    id: newAssetId(kind, index),
    kind,
    name,
    prompt,
    imageUrl: '',
    status: 'pending',
    ...(gender ? { gender } : {}),
  };
}

export function createEmptyDirectorMvCastPlan(): DirectorMvCastPlan {
  return {
    leadCount: 1,
    lead1Gender: 'female',
    lead2Gender: 'male',
  };
}

export function normalizeDirectorMvLeadGender(raw: unknown): DirectorMvLeadGender {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (s === 'male' || s === 'm' || s === '男' || s === '男主') return 'male';
  return 'female';
}

export function normalizeDirectorMvCastPlan(raw: unknown): DirectorMvCastPlan {
  const empty = createEmptyDirectorMvCastPlan();
  if (!raw || typeof raw !== 'object') return empty;
  const o = raw as Record<string, unknown>;
  const leadCount: 1 | 2 = Number(o.leadCount) === 2 ? 2 : 1;
  return {
    leadCount,
    lead1Gender: normalizeDirectorMvLeadGender(o.lead1Gender ?? o.protagonistGender),
    lead2Gender: normalizeDirectorMvLeadGender(o.lead2Gender ?? 'male'),
  };
}

export function directorMvLeadGenderLabelZh(g: DirectorMvLeadGender): string {
  return g === 'male' ? '男' : '女';
}

export function directorMvLeadDefaultName(
  gender: DirectorMvLeadGender,
  index: number,
  leadCount: 1 | 2,
  otherGender?: DirectorMvLeadGender,
): string {
  const label = gender === 'male' ? '男主' : '女主';
  if (leadCount === 1) return label;
  if (otherGender && otherGender === gender) {
    return `${label}${index + 1}`;
  }
  return label;
}

export function directorMvLeadSeedPrompt(gender: DirectorMvLeadGender): string {
  const g = directorMvLeadGenderLabelZh(gender);
  return `性别：${g}，年龄感与五官发型待定，服装与气质贴合 MV 风格`;
}

/** 形象文案是否与锁定性别冲突（如男主槽里写着「女主：女…」） */
export function directorMvLeadPromptConflictsGender(
  prompt: string,
  gender: DirectorMvLeadGender,
): boolean {
  const p = String(prompt || '').trim();
  if (!p) return false;
  const head = p.slice(0, 48);
  if (gender === 'male') {
    if (/^女主\s*[:：]/.test(head)) return true;
    if (/性别\s*[:：]\s*女/.test(head) && !/性别\s*[:：]\s*男/.test(head)) return true;
    if (/^女\s*[,，、]/.test(head)) return true;
  } else {
    if (/^男主\s*[:：]/.test(head)) return true;
    if (/性别\s*[:：]\s*男/.test(head) && !/性别\s*[:：]\s*女/.test(head)) return true;
    if (/^男\s*[,，、]/.test(head)) return true;
  }
  return false;
}

/** 校正主角形象文案，避免男主槽保留女主描述 */
export function alignDirectorMvLeadPrompt(
  gender: DirectorMvLeadGender,
  name: string,
  prompt: string,
): string {
  const seed = directorMvLeadSeedPrompt(gender);
  const p = String(prompt || '').trim();
  if (!p) return seed;
  if (directorMvLeadPromptConflictsGender(p, gender)) return seed;
  const gZh = directorMvLeadGenderLabelZh(gender);
  // 去掉错误角色名前缀，补上性别
  let next = p
    .replace(/^女主\s*[:：]\s*/u, '')
    .replace(/^男主\s*[:：]\s*/u, '')
    .trim();
  if (!/性别\s*[:：]/.test(next.slice(0, 24))) {
    next = `性别：${gZh}，${next}`;
  }
  if (name && !next.includes(name) && /^(男主|女主)/.test(name)) {
    // 保持简洁，不强制改写全文
  }
  return next || seed;
}

/** 按选角计划确保主角槽位存在（按姓名/性别匹配，校正冲突文案，保留参考图） */
export function ensureDirectorMvLeadSlots(state: DirectorPipelineState): DirectorPipelineState {
  const plan = normalizeDirectorMvCastPlan(state.mvCastPlan);
  const pool = [...(state.assets?.characters || [])];
  const usedIds = new Set<string>();
  const nextLeads: DirectorAsset[] = [];

  const takeMatching = (name: string, gender: DirectorMvLeadGender): DirectorAsset | null => {
    const nameKey = normalizeCastNameKey(name);
    let idx = pool.findIndex(
      (a) => !usedIds.has(a.id) && normalizeCastNameKey(a.name) === nameKey,
    );
    if (idx < 0) {
      idx = pool.findIndex(
        (a) =>
          !usedIds.has(a.id) &&
          (a.gender === gender ||
            (gender === 'male' && /男主/.test(String(a.name || ''))) ||
            (gender === 'female' && /女主/.test(String(a.name || '')))),
      );
    }
    if (idx < 0) return null;
    usedIds.add(pool[idx].id);
    return pool[idx];
  };

  for (let i = 0; i < plan.leadCount; i++) {
    const gender = i === 0 ? plan.lead1Gender : plan.lead2Gender;
    const other = i === 0 ? plan.lead2Gender : plan.lead1Gender;
    const name = directorMvLeadDefaultName(gender, i, plan.leadCount, other);
    const seedPrompt = directorMvLeadSeedPrompt(gender);
    const prev = takeMatching(name, gender);
    if (prev) {
      const keepName = String(prev.name || '').trim();
      const looksLikeLead =
        !keepName ||
        /^(男主|女主)/.test(keepName) ||
        keepName === directorMvLeadDefaultName(prev.gender === 'male' ? 'male' : 'female', i, plan.leadCount);
      nextLeads.push({
        ...prev,
        kind: 'character',
        gender,
        name: looksLikeLead ? name : keepName,
        prompt: alignDirectorMvLeadPrompt(gender, name, String(prev.prompt || '').trim() || seedPrompt),
      });
    } else {
      nextLeads.push(createEmptyDirectorAsset('character', name, seedPrompt, i, gender));
    }
  }
  const rest = pool.filter((a) => !usedIds.has(a.id));
  return createDefaultDirectorPipelineState({
    ...state,
    mvCastPlan: plan,
    assets: {
      ...state.assets,
      characters: [...nextLeads, ...rest],
    },
  });
}

export function applyDirectorMvCastPlan(
  state: DirectorPipelineState,
  patch: Partial<DirectorMvCastPlan>,
): DirectorPipelineState {
  const prev = normalizeDirectorMvCastPlan(state.mvCastPlan);
  const next = normalizeDirectorMvCastPlan({ ...prev, ...patch });
  return ensureDirectorMvLeadSlots(
    createDefaultDirectorPipelineState({
      ...state,
      mvCastPlan: next,
    }),
  );
}

/** 供剧本 LLM：已锁定主角摘要 */
export function formatDirectorMvLockedCastForPrompt(state: DirectorPipelineState): string {
  const plan = normalizeDirectorMvCastPlan(state.mvCastPlan);
  const chars = state.assets?.characters || [];
  const lines: string[] = [];
  lines.push(`主角人数：${plan.leadCount === 2 ? '双主角' : '单主角'}`);
  for (let i = 0; i < plan.leadCount; i++) {
    const gender = i === 0 ? plan.lead1Gender : plan.lead2Gender;
    const a = chars[i];
    const name = String(a?.name || '').trim() || directorMvLeadDefaultName(gender, i, plan.leadCount);
    const gZh = directorMvLeadGenderLabelZh(gender);
    const hasImg = String(a?.imageUrl || '').trim() ? '已有参考形象图' : '暂无参考图';
    const look = String(a?.prompt || '').trim();
    lines.push(
      `${i + 1}. ${name}｜性别：${gZh}｜${hasImg}${look ? `｜形象参考：${look.slice(0, 120)}` : ''}`,
    );
  }
  return lines.join('\n');
}

export function createEmptyDirectorAssets(): DirectorAssetsBag {
  return { characters: [], scenes: [], props: [] };
}

export function createEmptyDirectorMvMusic(): DirectorMvMusic {
  return {
    url: '',
    durationSec: 0,
    title: '',
    summary: '',
    moodHint: '',
    lyrics: '',
    lyricSegments: [],
    lyricSegmentsStatus: 'idle',
    clipLengthMode: 'short',
  };
}

export function createEmptyDirectorMvScriptSections(): DirectorMvScriptSections {
  return {
    plot: '',
    worldView: '',
    relationships: '',
    characters: '',
    scenes: '',
    props: '',
  };
}

export function createEmptyDirectorMvStoryAnalysis(): DirectorMvStoryAnalysis {
  return {
    summary: '',
    genre: '',
    emotions: [],
    keywords: [],
    scriptKeywords: [],
    sections: createEmptyDirectorMvScriptSections(),
  };
}

function normalizeStringList(raw: unknown, max = 24): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const s = String(item || '').trim();
    if (!s) continue;
    if (!out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** 将模型返回的字符串 / 数组 / 键值对象压成可编辑纯文本 */
function sectionFieldText(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>;
          const name = String(o.name ?? o.姓名 ?? o.title ?? '').trim();
          const desc = String(o.desc ?? o.description ?? o.描述 ?? o.外观 ?? '').trim();
          if (name && desc) return `${name}：${desc}`;
          if (name) return name;
          return Object.entries(o)
            .map(([k, v]) => `${k}：${String(v ?? '').trim()}`)
            .filter((line) => !line.endsWith('：'))
            .join('；');
        }
        return String(item ?? '').trim();
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .map(([k, v]) => {
        const body = typeof v === 'string' ? v.trim() : sectionFieldText(v);
        return body ? `${k}：${body}` : '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return String(raw).trim();
}

export function normalizeDirectorMvScriptSections(raw: unknown): DirectorMvScriptSections {
  const empty = createEmptyDirectorMvScriptSections();
  if (!raw || typeof raw !== 'object') return empty;
  const v = raw as Record<string, unknown>;
  return {
    plot: sectionFieldText(v.plot ?? v.剧情规划 ?? v.story),
    worldView: sectionFieldText(v.worldView ?? v.世界观),
    relationships: sectionFieldText(v.relationships ?? v.人物关系),
    characters: sectionFieldText(v.characters ?? v.人物库),
    scenes: sectionFieldText(v.scenes ?? v.场景库),
    props: sectionFieldText(v.props ?? v.道具库),
  };
}

/** 从【分节】正文或旧版整块 JSON 解析分节（用于迁移 / 容错） */
export function parseDirectorMvScriptSectionsFromText(text: string): DirectorMvScriptSections {
  const empty = createEmptyDirectorMvScriptSections();
  const raw = String(text || '').trim();
  if (!raw) return empty;

  // 旧 UI 曾把整段 JSON 放进 textarea
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const fromObj = normalizeDirectorMvScriptSections(parsed);
        if (Object.values(fromObj).some((s) => s.trim())) return fromObj;
      }
    } catch {
      /* fall through */
    }
  }

  const map: Record<string, keyof DirectorMvScriptSections> = {
    剧情规划: 'plot',
    剧情: 'plot',
    故事: 'plot',
    世界观: 'worldView',
    人物关系: 'relationships',
    人物库: 'characters',
    场景库: 'scenes',
    道具库: 'props',
  };
  const re = /【\s*([^】]+?)\s*】\s*([\s\S]*?)(?=【\s*[^】]+?\s*】|$)/g;
  let m: RegExpExecArray | null;
  let hit = false;
  const out = { ...empty };
  while ((m = re.exec(raw))) {
    const title = String(m[1] || '').trim();
    const body = String(m[2] || '').trim();
    const key = map[title];
    if (key && body) {
      out[key] = body;
      hit = true;
    }
  }
  if (!hit) out.plot = raw;
  return out;
}

export function directorMvScriptSectionsHaveContent(sections: DirectorMvScriptSections | undefined | null): boolean {
  const s = normalizeDirectorMvScriptSections(sections || {});
  return Object.values(s).some((v) => v.trim());
}

/** 分节合成下游用的 scriptText（剧情在前，再世界观 / 人物关系…） */
export function composeDirectorMvScriptText(sections: DirectorMvScriptSections | undefined | null): string {
  const s = normalizeDirectorMvScriptSections(sections || {});
  const blocks: Array<[string, string]> = [
    ['剧情规划', s.plot],
    ['世界观', s.worldView],
    ['人物关系', s.relationships],
    ['人物库', s.characters],
    ['场景库', s.scenes],
    ['道具库', s.props],
  ];
  return blocks
    .filter(([, body]) => body.trim())
    .map(([title, body]) => `【${title}】\n${body.trim()}`)
    .join('\n\n');
}

export type DirectorMvCharacterEntry = { name: string; prompt: string };

function normalizeCastNameKey(name: string): string {
  return String(name || '')
    .trim()
    .replace(/^(男主|女主|主角|配角|角色|场景)\s*/u, '')
    .toLowerCase();
}

function pushNamedEntry(
  out: DirectorMvCharacterEntry[],
  seen: Set<string>,
  nameRaw: string,
  promptRaw: string,
  max = 12,
): void {
  const name = String(nameRaw || '').trim();
  const prompt = String(promptRaw || '').trim() || name;
  if (!name) return;
  const key = normalizeCastNameKey(name);
  if (!key || seen.has(key)) return;
  seen.add(key);
  out.push({ name, prompt });
}

/** 无冒号长句：取前若干字作短名，全文作 prompt（兼容旧场景库写法） */
function splitNamelessLine(line: string): { name: string; prompt: string } {
  const t = String(line || '').trim();
  if (!t) return { name: '', prompt: '' };
  // 优先截到第一个逗号/顿号前作短名
  const cut = t.search(/[，,、]/);
  if (cut >= 2 && cut <= 12) {
    return { name: t.slice(0, cut).trim(), prompt: t };
  }
  const name = t.length <= 12 ? t : t.slice(0, 8).replace(/[的之与和及]$/u, '') || t.slice(0, 8);
  return { name, prompt: t };
}

/**
 * 从剧本「人物库 / 场景库」正文解析「名称：描述」列表。
 * 兼容：分行、分号并联、无冒号整句描述。
 */
export function parseDirectorMvCharacterEntries(text: string): DirectorMvCharacterEntry[] {
  const raw = String(text || '').trim();
  if (!raw) return [];

  // 单行多条：李：…；莉莉：… 或 窗边：…；天台：…
  let expanded = raw.includes('\n')
    ? raw
    : raw.replace(/([；;])\s*(?=[^\s；;:：]{1,24}\s*[:：])/g, '$1\n');
  // 无冒号时也按中文分号 / 顿号枚举拆行
  if (!expanded.includes('\n') && /[；;]/.test(expanded)) {
    expanded = expanded.replace(/[；;]+/g, '\n');
  }

  const lines = expanded
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const entries: DirectorMvCharacterEntry[] = [];
  let cur: DirectorMvCharacterEntry | null = null;
  const startRe =
    /^(?:[-*•]\s*|\d+[.)、]\s*)?(?:【\s*)?(?:男主|女主|主角|配角|角色|场景)?\s*([^\s:：\-—–【】/|]{1,24})(?:\s*】)?\s*[:：\-—–|/]\s*(.*)$/u;

  for (const t of lines) {
    const m = t.match(startRe);
    if (m) {
      if (cur?.name) entries.push(cur);
      const name = String(m[1] || '').trim();
      const prompt = String(m[2] || '').trim();
      cur = { name, prompt: prompt || name };
      continue;
    }
    if (cur) {
      cur.prompt = cur.prompt ? `${cur.prompt}\n${t}` : t;
      continue;
    }
    // 无冒号：整行当作一条（场景库旧写法常见）
    const loose = splitNamelessLine(t);
    if (loose.name) {
      cur = { name: loose.name, prompt: loose.prompt };
      entries.push(cur);
      cur = null;
    }
  }
  if (cur?.name) entries.push(cur);

  const out: DirectorMvCharacterEntry[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    pushNamedEntry(out, seen, e.name, e.prompt);
    if (out.length >= 12) break;
  }
  // 整段只有一块且无换行无冒号时，仍给出 1 条，避免场景步空库
  if (!out.length && raw.length >= 4) {
    const one = splitNamelessLine(raw.replace(/\s+/g, ' '));
    pushNamedEntry(out, seen, one.name, one.prompt);
  }
  return out;
}

/** 读取当前导演状态中可用于选角的人物库正文 */
export function getDirectorMvCharactersSectionText(state: {
  mvStoryAnalysis?: DirectorMvStoryAnalysis | null;
  scriptText?: string;
}): string {
  const fromSections = normalizeDirectorMvScriptSections(state.mvStoryAnalysis?.sections).characters;
  if (fromSections.trim()) return fromSections;
  return parseDirectorMvScriptSectionsFromText(String(state.scriptText || '')).characters;
}

export type SyncDirectorMvCastMode = 'fill' | 'replace';

/**
 * 按剧本人物库同步选角列表。
 * - fill：按姓名合并，保留用户另加的角色
 * - replace：以剧本为准，仅保留剧本未列出但已有参考图的角色
 */
export function syncDirectorMvCastFromScript(
  state: DirectorPipelineState,
  mode: SyncDirectorMvCastMode = 'fill',
): DirectorPipelineState {
  const entries = parseDirectorMvCharacterEntries(getDirectorMvCharactersSectionText(state));
  if (!entries.length) return state;

  const existing = [...(state.assets?.characters || [])];
  const byName = new Map<string, DirectorAsset>();
  const unnamedKeep: DirectorAsset[] = [];
  for (const a of existing) {
    const key = normalizeCastNameKey(a.name);
    if (!key) {
      if (String(a.imageUrl || '').trim()) unnamedKeep.push(a);
      continue;
    }
    if (!byName.has(key)) byName.set(key, a);
  }

  const nextChars: DirectorAsset[] = entries.map((e, i) => {
    const key = normalizeCastNameKey(e.name);
    const prev = key ? byName.get(key) : undefined;
    if (prev && key) byName.delete(key);
    const name = e.name || prev?.name || `角色${i + 1}`;
    const genderFromName: DirectorAssetGender = /男主/.test(name)
      ? 'male'
      : /女主/.test(name)
        ? 'female'
        : prev?.gender || '';
    const rawPrompt = e.prompt || prev?.prompt || '';
    const prompt =
      genderFromName === 'male' || genderFromName === 'female'
        ? alignDirectorMvLeadPrompt(genderFromName, name, rawPrompt)
        : rawPrompt;
    if (prev) {
      return {
        ...prev,
        kind: 'character' as const,
        name,
        prompt,
        gender: genderFromName || prev.gender || undefined,
      };
    }
    return createEmptyDirectorAsset('character', name, prompt, i, genderFromName);
  });

  for (const left of byName.values()) {
    if (mode === 'fill') {
      nextChars.push(left);
      continue;
    }
    if (String(left.imageUrl || '').trim()) nextChars.push(left);
  }
  for (const left of unnamedKeep) nextChars.push(left);

  return ensureDirectorMvLeadSlots(
    createDefaultDirectorPipelineState({
      ...state,
      assets: {
        ...state.assets,
        characters: nextChars,
      },
    }),
  );
}

/** 读取剧本「场景库」正文 */
export function getDirectorMvScenesSectionText(state: {
  mvStoryAnalysis?: DirectorMvStoryAnalysis | null;
  scriptText?: string;
}): string {
  const fromSections = normalizeDirectorMvScriptSections(state.mvStoryAnalysis?.sections).scenes;
  if (fromSections.trim()) return fromSections;
  return parseDirectorMvScriptSectionsFromText(String(state.scriptText || '')).scenes;
}

export const parseDirectorMvSceneEntries = parseDirectorMvCharacterEntries;

/**
 * 按剧本场景库同步场景列表（九宫格空场景提示词）。
 * MV 不生成道具，仅场景。
 */
export function syncDirectorMvScenesFromScript(
  state: DirectorPipelineState,
  mode: SyncDirectorMvCastMode = 'fill',
): DirectorPipelineState {
  const entries = parseDirectorMvSceneEntries(getDirectorMvScenesSectionText(state));
  if (!entries.length) return state;

  const existing = [...(state.assets?.scenes || [])];
  const byName = new Map<string, DirectorAsset>();
  const unnamedKeep: DirectorAsset[] = [];
  for (const a of existing) {
    const key = normalizeCastNameKey(a.name);
    if (!key) {
      if (String(a.imageUrl || '').trim()) unnamedKeep.push(a);
      continue;
    }
    if (!byName.has(key)) byName.set(key, a);
  }

  const nextScenes: DirectorAsset[] = entries.map((e, i) => {
    const key = normalizeCastNameKey(e.name);
    const prev = key ? byName.get(key) : undefined;
    if (prev && key) byName.delete(key);
    const prompt = ensureDirectorSceneBuiltinPrompt(e.prompt || e.name);
    if (prev) {
      return {
        ...prev,
        kind: 'scene' as const,
        name: e.name || prev.name,
        prompt: ensureDirectorSceneBuiltinPrompt(e.prompt || prev.prompt || e.name),
      };
    }
    return createEmptyDirectorAsset('scene', e.name, prompt, i);
  });

  for (const left of byName.values()) {
    if (mode === 'fill') {
      nextScenes.push({
        ...left,
        kind: 'scene',
        prompt: ensureDirectorSceneBuiltinPrompt(left.prompt),
      });
      continue;
    }
    if (String(left.imageUrl || '').trim()) {
      nextScenes.push({
        ...left,
        kind: 'scene',
        prompt: ensureDirectorSceneBuiltinPrompt(left.prompt),
      });
    }
  }
  for (const left of unnamedKeep) {
    nextScenes.push({
      ...left,
      kind: 'scene',
      prompt: ensureDirectorSceneBuiltinPrompt(left.prompt),
    });
  }

  return createDefaultDirectorPipelineState({
    ...state,
    assetsStep: 'scenes',
    assets: {
      ...state.assets,
      scenes: nextScenes,
      // MV：不保留道具生成流程
      props: state.mode === 'mv' ? [] : state.assets.props,
    },
  });
}

export function normalizeDirectorMvStoryAnalysis(raw: unknown): DirectorMvStoryAnalysis {
  const empty = createEmptyDirectorMvStoryAnalysis();
  if (!raw || typeof raw !== 'object') return empty;
  const v = raw as Partial<DirectorMvStoryAnalysis> & Record<string, unknown>;
  return {
    summary: String(v.summary || '').trim(),
    genre: String(v.genre || '').trim(),
    emotions: normalizeStringList(v.emotions),
    keywords: normalizeStringList(v.keywords),
    scriptKeywords: normalizeStringList(v.scriptKeywords),
    sections: normalizeDirectorMvScriptSections(v.sections ?? v),
  };
}

export function flattenDirectorAssets(assets: DirectorAssetsBag): DirectorAsset[] {
  return [...(assets.characters || []), ...(assets.scenes || []), ...(assets.props || [])];
}

/** 按 id 找回资产，并以所在列表为准纠正 kind（避免旧数据缺 kind） */
export function findDirectorAssetById(
  assets: DirectorAssetsBag,
  assetId: string,
): { asset: DirectorAsset; kind: DirectorAssetKind } | null {
  const id = String(assetId || '').trim();
  if (!id) return null;
  const hit = (list: DirectorAsset[] | undefined, kind: DirectorAssetKind) => {
    const asset = (list || []).find((a) => a.id === id);
    return asset ? { asset: { ...asset, kind }, kind } : null;
  };
  return (
    hit(assets.characters, 'character') ||
    hit(assets.scenes, 'scene') ||
    hit(assets.props, 'prop') ||
    null
  );
}

export function countAssetsMissingImages(assets: DirectorAssetsBag): {
  characters: number;
  scenes: number;
  props: number;
  total: number;
} {
  const miss = (list: DirectorAsset[]) =>
    (list || []).filter((a) => !String(a.imageUrl || '').trim()).length;
  const characters = miss(assets.characters);
  const scenes = miss(assets.scenes);
  const props = miss(assets.props);
  return { characters, scenes, props, total: characters + scenes + props };
}

export function countAssetsWithImages(assets: DirectorAssetsBag): {
  ready: number;
  total: number;
} {
  const all = flattenDirectorAssets(assets);
  const ready = all.filter((a) => String(a.imageUrl || '').trim()).length;
  return { ready, total: all.length };
}

export function countShotsWithFinalPrompt(shots: DirectorShot[]): {
  ready: number;
  total: number;
} {
  const total = shots?.length || 0;
  const ready = (shots || []).filter((s) => String(s['最终提示词'] || '').trim()).length;
  return { ready, total };
}

export function createEmptyDirectorShotStoryboard(): DirectorShotStoryboard {
  return { imageUrl: '', status: 'pending', videoUrl: '', videoStatus: 'pending' };
}

export function normalizeDirectorStoryboardsByShotNo(
  raw: unknown,
): Record<string, DirectorShotStoryboard> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, DirectorShotStoryboard> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const shotNo = String(key || '').trim();
    if (!shotNo) continue;
    const v = (val && typeof val === 'object' ? val : {}) as Partial<DirectorShotStoryboard>;
    const statusRaw = String(v.status || '').trim();
    const status: DirectorStoryboardStatus =
      statusRaw === 'generating' || statusRaw === 'ready' || statusRaw === 'error'
        ? statusRaw
        : String(v.imageUrl || '').trim()
          ? 'ready'
          : 'pending';
    const aspectRaw = String(v.aspectRatio || '').trim();
    const aspectRatio = aspectRaw
      ? coerceDirectorMvAspectRatio(aspectRaw) || aspectRaw
      : undefined;
    const songClipUrl = String(v.songClipUrl || '').trim();
    const songClipSourceUrl = String(v.songClipSourceUrl || '').trim();
    const songClipStartSec = Number(v.songClipStartSec);
    const songClipEndSec = Number(v.songClipEndSec);
    const audioStartSec = Number(v.audioStartSec);
    const audioEndSec = Number(v.audioEndSec);
    const castAssetIds = Array.isArray(v.castAssetIds)
      ? [...new Set(v.castAssetIds.map((id) => String(id || '').trim()).filter(Boolean))]
      : undefined;
    const sceneAssetIds = Array.isArray(v.sceneAssetIds)
      ? [...new Set(v.sceneAssetIds.map((id) => String(id || '').trim()).filter(Boolean))].slice(
          0,
          1,
        )
      : undefined;
    const videoUrl = String(v.videoUrl || '').trim();
    const videoStatusRaw = String(v.videoStatus || '').trim();
    const videoStatus: DirectorStoryboardStatus =
      videoStatusRaw === 'generating' || videoStatusRaw === 'ready' || videoStatusRaw === 'error'
        ? videoStatusRaw
        : videoUrl
          ? 'ready'
          : 'pending';
    const videoNodeId = String(v.videoNodeId || '').trim();
    out[shotNo] = {
      imageUrl: String(v.imageUrl || '').trim(),
      status,
      ...(v.error ? { error: String(v.error) } : {}),
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(typeof v.preferLipsync === 'boolean' ? { preferLipsync: v.preferLipsync } : {}),
      ...(castAssetIds !== undefined ? { castAssetIds } : {}),
      ...(sceneAssetIds !== undefined ? { sceneAssetIds } : {}),
      ...(songClipUrl ? { songClipUrl } : {}),
      ...(songClipSourceUrl ? { songClipSourceUrl } : {}),
      ...(Number.isFinite(songClipStartSec) ? { songClipStartSec } : {}),
      ...(Number.isFinite(songClipEndSec) ? { songClipEndSec } : {}),
      ...(Number.isFinite(audioStartSec) ? { audioStartSec } : {}),
      ...(Number.isFinite(audioEndSec) ? { audioEndSec } : {}),
      ...(videoUrl ? { videoUrl } : {}),
      ...(videoUrl || videoStatus !== 'pending' ? { videoStatus } : {}),
      ...(v.videoError ? { videoError: String(v.videoError) } : {}),
      ...(videoNodeId ? { videoNodeId } : {}),
    };
  }
  return out;
}

/** 分镜上缓存的原曲裁剪片段是否仍有效 */
export function getValidDirectorShotSongClipUrl(
  storyboard: Pick<
    DirectorShotStoryboard,
    'songClipUrl' | 'songClipSourceUrl' | 'songClipStartSec' | 'songClipEndSec'
  > | null | undefined,
  musicUrl: string,
  startSec: number,
  endSec: number,
): string {
  const clip = String(storyboard?.songClipUrl || '').trim();
  const src = String(storyboard?.songClipSourceUrl || '').trim();
  const music = String(musicUrl || '').trim();
  if (!clip || !music || src !== music) return '';
  const s = Number(storyboard?.songClipStartSec);
  const e = Number(storyboard?.songClipEndSec);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s + 0.05) return '';
  if (Math.abs(s - startSec) > 0.12 || Math.abs(e - endSec) > 0.12) return '';
  return clip;
}

/** 对口型推荐优先级：none 不推荐 · normal 普通 · climax 高潮优先 */
export type DirectorLipsyncPriority = 'none' | 'normal' | 'climax';

export interface DirectorLipsyncRecommendation {
  recommend: boolean;
  priority: DirectorLipsyncPriority;
}

function shotTextBlob(shot: Record<string, unknown> | object): string {
  const s = shot as Record<string, unknown>;
  return [
    s['景别'],
    s['画面描述'],
    s['最终提示词'],
    s['运镜'],
    s['光影氛围'],
    s['对白旁白'],
  ]
    .map((x) => String(x || ''))
    .join(' ');
}

/**
 * 题词/景别是否暗示人物脸部可见。
 * 背对、背影、远景空镜等 → false。
 */
export function shotDescriptionSuggestsVisibleFace(
  shot: Pick<DirectorShot, '景别' | '画面描述' | '最终提示词' | '运镜'>,
): boolean {
  const blob = shotTextBlob(shot).toLowerCase();
  const backFacing =
    /背对|背影|背面|后脑勺|后脑|看不清脸|无脸|不露面|silhouette|back\s*(to|toward)\s*(camera|viewer|us)|from\s*behind|facing\s*away|rear\s*view/.test(
      blob,
    );
  const facePositive =
    /特写|近景|中近景|大特写|面部|脸部|正脸|侧脸|面容|眼神|嘴唇|口型|close[\s-]?up|ecu\b|\bcu\b|mcu|face|portrait|bust/.test(
      blob,
    );
  const turnToFace = /转过身|回眸|回头|侧过脸|面向镜头|看向镜头|面向观众/.test(blob);
  if (backFacing && !turnToFace && !facePositive) return false;

  if (facePositive || turnToFace) return true;

  // 中景通常能看到脸（除非明确背对）
  if (/中景|medium\s*shot|mid[\s-]?shot/.test(blob) && !backFacing) return true;

  // 大远景/空镜/建立镜头默认看不见可用人脸
  if (
    /大远景|远景|全景|空镜|建立镜头|establishing|wide\s*shot|extreme\s*wide|无人|只有风景|纯风景/.test(
      blob,
    )
  ) {
    return false;
  }

  return false;
}

/**
 * 该镜是否为「特写级」脸贴镜头（对口型收紧：半身/全身/中远景不算）。
 */
export function shotDescriptionSuggestsCloseUpFace(
  shot: Pick<DirectorShot, '景别' | '画面描述' | '最终提示词' | '运镜'>,
): boolean {
  const blob = shotTextBlob(shot).toLowerCase();
  const closePositive =
    /大特写|特写|贴脸|极近|面部特写|脸部特写|脸占|五官占|close[\s-]?up|extreme\s*close|\becu\b|\bcu\b/.test(
      blob,
    );
  if (!closePositive) return false;
  // 明确半身/全身且无特写强调 → 不算
  if (
    /半身|全身景|全身(?!→)|头脚入画|腰部以上|膝上入画|full[\s-]?body|cowboy|medium[\s-]?full/.test(blob) &&
    !/大特写|贴脸|extreme\s*close|\becu\b/.test(blob)
  ) {
    // 有「特写」字样时仍以特写为准（如「缓推至面部特写」）
    if (!/特写|close[\s-]?up|\bcu\b/.test(blob)) return false;
  }
  return shotDescriptionSuggestsVisibleFace(shot);
}

/** 该镜是否有可对口型的完整歌词（非间奏占位） */
export function shotHasCompleteLyricForLipsync(
  shot: Pick<DirectorShot, '对白旁白'>,
  opts?: { packText?: string; hasHumanVoice?: boolean | null },
): boolean {
  if (opts?.hasHumanVoice === false) return false;
  // 人声段本身即视为有台词；否则看对白/歌词包非空
  if (opts?.hasHumanVoice === true) return true;
  const raw = [shot['对白旁白'], opts?.packText].map((x) => String(x || '').trim()).find(Boolean) || '';
  const dialogue = sanitizeDirectorLyricDisplayText(raw);
  if (!dialogue) return false;
  if (isDirectorInstrumentalLyricText(dialogue) || isDirectorNonLyricMetaText(dialogue)) return false;
  if (dialogue.replace(/\s+/g, '').length < 2) return false;
  return true;
}

/** 是否高潮镜（文案关键词 + 可选曲中段启发式） */
export function shotSuggestsClimax(
  shot: Pick<DirectorShot, '画面描述' | '最终提示词' | '运镜' | '光影氛围' | '景别'>,
  opts?: { startSec?: number; songDurationSec?: number },
): boolean {
  const blob = shotTextBlob(shot).toLowerCase();
  if (
    /高潮|副歌|副歌高潮|chorus|climax|情绪顶点|爆发|燃向|最强|高潮段落|情绪爆发|激烈副歌/.test(blob)
  ) {
    return true;
  }
  const start = Number(opts?.startSec);
  const dur = Number(opts?.songDurationSec);
  if (Number.isFinite(start) && Number.isFinite(dur) && dur >= 45) {
    // 约 45%–85% 曲段常为副歌/高潮区，且运镜/情绪偏强
    if (start >= dur * 0.45 && start <= dur * 0.85) {
      if (/激动|激烈|升腾|大场面|快速|甩镜|环绕|推近|爆发|燃/.test(blob)) return true;
    }
  }
  return false;
}

export interface EvaluateDirectorShotLipsyncOpts {
  /** 片段是否有人声；null/undefined = 未知 */
  hasHumanVoice?: boolean | null;
  /** 第一步打包得到的歌词文本 */
  packText?: string;
  audioStartSec?: number;
  songDurationSec?: number;
  /**
   * 近景特写开关。开：有人镜按特写调度，可见人脸即视为脸足够近；
   * 关：须该镜本身为特写级才推荐。
   */
  closeUpFramingOn?: boolean;
}

/**
 * MV 对口型推荐（收紧）：
 * 仅当同时满足才推荐：
 * 1) 脸特别近：近景开关开（且人脸可见），或该镜为特写级
 * 2) 有台词：人声段或对白/歌词非空
 * 满足后若为高潮 → priority=climax
 */
export function evaluateDirectorShotLipsync(
  shot: Pick<DirectorShot, '景别' | '画面描述' | '最终提示词' | '运镜' | '光影氛围' | '对白旁白'>,
  opts?: EvaluateDirectorShotLipsyncOpts,
): DirectorLipsyncRecommendation {
  const faceVisible = shotDescriptionSuggestsVisibleFace(shot);
  const faceClose =
    opts?.closeUpFramingOn === true
      ? faceVisible
      : shotDescriptionSuggestsCloseUpFace(shot);
  const lyricOk = shotHasCompleteLyricForLipsync(shot, {
    packText: opts?.packText,
    hasHumanVoice: opts?.hasHumanVoice,
  });
  if (!faceClose || !lyricOk) {
    return { recommend: false, priority: 'none' };
  }
  const climax = shotSuggestsClimax(shot, {
    startSec: opts?.audioStartSec,
    songDurationSec: opts?.songDurationSec,
  });
  if (climax) return { recommend: true, priority: 'climax' };
  return { recommend: true, priority: 'normal' };
}

/**
 * 景别/对白是否适合分镜图生视频时做对口型。
 * MV 场景请优先用 evaluateDirectorShotLipsync（含人脸近距/人声/高潮）。
 */
export function recommendDirectorShotLipsync(
  shot: Pick<DirectorShot, '景别' | '对白旁白' | '画面描述' | '最终提示词' | '运镜' | '光影氛围'>,
  opts?: EvaluateDirectorShotLipsyncOpts,
): boolean {
  return evaluateDirectorShotLipsync(shot, opts).recommend;
}

/** 是否对口型：用户手动优先，否则自动推荐 */
export function resolveDirectorShotPreferLipsync(
  shot: Pick<DirectorShot, '景别' | '对白旁白' | '画面描述' | '最终提示词' | '运镜' | '光影氛围'>,
  storyboard?: Pick<DirectorShotStoryboard, 'preferLipsync'> | null,
  opts?: EvaluateDirectorShotLipsyncOpts,
): boolean {
  if (typeof storyboard?.preferLipsync === 'boolean') return storyboard.preferLipsync;
  return evaluateDirectorShotLipsync(shot, opts).recommend;
}

export interface DirectorShotMusicRange {
  startSec: number;
  endSec: number;
  durationSec: number;
}

/** 按镜号查找分镜（兼容「1」/「01」/「镜1」键不一致） */
function lookupDirectorShotStoryboardForRange(
  boards: Record<string, DirectorShotStoryboard> | undefined,
  shotNo: string,
): DirectorShotStoryboard | undefined {
  if (!boards) return undefined;
  const key = String(shotNo || '').trim();
  if (!key) return undefined;
  if (boards[key]) return boards[key];
  const norm = key.replace(/^镜\s*/i, '').replace(/^0+(\d)/, '$1');
  if (boards[norm]) return boards[norm];
  for (const [k, v] of Object.entries(boards)) {
    const kn = String(k || '').trim().replace(/^镜\s*/i, '').replace(/^0+(\d)/, '$1');
    if (kn && kn === norm) return v;
  }
  return undefined;
}

export function getDirectorShotStoryboard(
  state: Pick<DirectorPipelineState, 'storyboardsByShotNo'>,
  shotNo: string,
): DirectorShotStoryboard {
  const key = String(shotNo || '').trim();
  const hit =
    (key ? state.storyboardsByShotNo?.[key] : undefined) ||
    lookupDirectorShotStoryboardForRange(state.storyboardsByShotNo, key);
  return hit || createEmptyDirectorShotStoryboard();
}

export function countDirectorStoryboards(
  shots: DirectorShot[],
  storyboardsByShotNo: Record<string, DirectorShotStoryboard>,
): { ready: number; total: number; missing: number; generating: number } {
  const withPrompt = (shots || []).filter((s) => String(s['最终提示词'] || '').trim());
  const total = withPrompt.length;
  let ready = 0;
  let generating = 0;
  for (let i = 0; i < withPrompt.length; i++) {
    const no = String(withPrompt[i]['镜号'] || i + 1);
    const sb = storyboardsByShotNo?.[no];
    if (sb?.status === 'generating') generating += 1;
    if (String(sb?.imageUrl || '').trim()) ready += 1;
  }
  return { ready, total, missing: Math.max(0, total - ready), generating };
}

export function countDirectorShotsWithDialogue(shots: DirectorShot[]): number {
  return (shots || []).filter((s) => String(s['对白旁白'] || '').trim()).length;
}

export function coerceDirectorMvAspectRatio(raw: string | undefined | null): DirectorMvAspectRatio {
  const s = String(raw || '').trim();
  return (DIRECTOR_MV_ASPECT_OPTIONS as readonly string[]).includes(s)
    ? (s as DirectorMvAspectRatio)
    : '16:9';
}

export function normalizeDirectorMvMusic(raw: unknown): DirectorMvMusic {
  const empty = createEmptyDirectorMvMusic();
  if (!raw || typeof raw !== 'object') return empty;
  const v = raw as Partial<DirectorMvMusic>;
  const durationSec = Number(v.durationSec);
  const statusRaw = String(v.lyricSegmentsStatus || '').trim();
  const lyricSegmentsStatus: DirectorMvLyricSegmentStatus =
    statusRaw === 'transcribing' || statusRaw === 'ready' || statusRaw === 'error'
      ? statusRaw
      : Array.isArray(v.lyricSegments) && v.lyricSegments.length > 0
        ? 'ready'
        : 'idle';
  const lyricSegments = normalizeDirectorMvLyricSegments(v.lyricSegments);
  const clipModeRaw = String(v.clipLengthMode || '').trim();
  const clipLengthMode: 'long' | 'short' = clipModeRaw === 'long' ? 'long' : 'short';
  return {
    url: String(v.url || '').trim(),
    durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0,
    title: String(v.title || '').trim(),
    summary: String(v.summary || '').trim(),
    moodHint: String(v.moodHint || '').trim(),
    lyrics: String(v.lyrics || '').trim(),
    ...(v.sourceNodeId ? { sourceNodeId: String(v.sourceNodeId).trim() } : {}),
    lyricSegments,
    lyricSegmentsStatus,
    clipLengthMode,
    ...(v.lyricSegmentsError ? { lyricSegmentsError: String(v.lyricSegmentsError) } : {}),
    ...(v.lyricSegmentsSourceUrl
      ? { lyricSegmentsSourceUrl: String(v.lyricSegmentsSourceUrl).trim() }
      : {}),
  };
}

export function parseDirectorShotDurationSec(raw: string | undefined | null, fallback = 4): number {
  const m = String(raw || '').trim().match(/(\d+(?:\.\d+)?)/);
  if (!m) return fallback;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(60, Math.max(1, n));
}

/** 按镜头时长累计，切出对应歌曲时间轴片段（无乐句绑定时的回退） */
export function computeDirectorShotMusicRanges(shots: DirectorShot[]): DirectorShotMusicRange[] {
  let cursor = 0;
  return (shots || []).map((shot) => {
    const durationSec = parseDirectorShotDurationSec(shot['时长'], 5);
    const startSec = cursor;
    const endSec = startSec + durationSec;
    cursor = endSec;
    return { startSec, endSec, durationSec };
  });
}

function directorShotMusicRangeFromPack(p: {
  startSec: number;
  endSec: number;
  durationSec?: number;
}): DirectorShotMusicRange {
  const startSec = Math.max(0, Number(p.startSec) || 0);
  const endRaw = Number(p.endSec);
  const durRaw = Number(p.durationSec);
  // 始终用真实起止差；tier 宣称的 durationSec 可能与 end-start 不一致
  const endSec =
    Number.isFinite(endRaw) && endRaw > startSec + 0.05
      ? endRaw
      : startSec + (Number.isFinite(durRaw) && durRaw > 0.05 ? durRaw : 5);
  return {
    startSec,
    endSec,
    durationSec: Math.max(0.05, endSec - startSec),
  };
}

/**
 * 读取分镜上已冻结的歌曲区间（applyLyricPacks / 生视频时写入的 audioStart/End）。
 * 不用 songClip*：对口型旧裁切可能残留，与最新打包不一致。
 */
function readDirectorShotFrozenMusicRange(
  state: Pick<DirectorPipelineState, 'storyboardsByShotNo'>,
  shotNo: string,
): DirectorShotMusicRange | null {
  const sb = lookupDirectorShotStoryboardForRange(state.storyboardsByShotNo, shotNo);
  if (!sb) return null;
  const startSec = Number(sb.audioStartSec);
  const endSec = Number(sb.audioEndSec);
  if (Number.isFinite(startSec) && Number.isFinite(endSec) && endSec > startSec + 0.05) {
    const s = Math.max(0, startSec);
    return { startSec: s, endSec, durationSec: endSec - s };
  }
  return null;
}

/**
 * 优先用分镜上已冻结的人声起止（与生视频/对口型裁切一致）；
 * 缺绑定再回退乐句打包或按时长累加。
 * 注意：有 lyricSegments 时不可盲目重算 packs 覆盖冻结值，否则入轨与生成时错位。
 */
export function computeDirectorShotMusicRangesFromState(
  state: Pick<DirectorPipelineState, 'shots' | 'storyboardsByShotNo' | 'mvMusic'>,
): DirectorShotMusicRange[] {
  const shots = state.shots || [];
  const fallback = computeDirectorShotMusicRanges(shots);
  if (shots.length === 0) return fallback;

  const boundRanges = shots.map((shot, i) => {
    const shotNo = String(shot['镜号'] || i + 1).trim() || String(i + 1);
    return readDirectorShotFrozenMusicRange(state, shotNo);
  });
  const boundCount = boundRanges.filter(Boolean).length;
  // 全员已冻结：直接用分镜时间轴（与生视频/入轨应对齐的真源）
  if (boundCount === shots.length) {
    return boundRanges.map(
      (r, i) => r || fallback[i] || { startSec: 0, endSec: 5, durationSec: 5 },
    );
  }

  const segs = normalizeDirectorMvLyricSegments(state.mvMusic?.lyricSegments);
  const packs =
    segs.length > 0
      ? packLyricSegmentsIntoShotPacks(segs, {
          clipLengthMode: state.mvMusic?.clipLengthMode,
        })
      : [];
  if (packs.length > 0) {
    // 部分冻结 + packs：冻结镜用分镜值，其余按 pack 下标，避免整表重算打乱已生成镜
    let cursor = 0;
    return shots.map((shot, i) => {
      const bound = boundRanges[i];
      if (bound) {
        cursor = bound.endSec;
        return bound;
      }
      if (i < packs.length) {
        const r = directorShotMusicRangeFromPack(packs[i]);
        cursor = r.endSec;
        return r;
      }
      const dur = parseDirectorShotDurationSec(shot['时长'], 5);
      const startSec = cursor;
      const endSec = startSec + dur;
      cursor = endSec;
      return { startSec, endSec, durationSec: dur };
    });
  }

  // 有部分绑定：从上一镜 end 续接未绑定镜，避免跳回累计表起点
  if (boundCount > 0) {
    let cursor = 0;
    return shots.map((shot, i) => {
      const bound = boundRanges[i];
      if (bound) {
        cursor = bound.endSec;
        return bound;
      }
      const dur = parseDirectorShotDurationSec(shot['时长'], fallback[i]?.durationSec || 5);
      const startSec = cursor;
      const endSec = startSec + dur;
      cursor = endSec;
      return { startSec, endSec, durationSec: dur };
    });
  }

  return fallback;
}

/** 按镜号在镜头表中的行下标（优先匹配「镜号」，否则按 1-based 数字） */
export function findDirectorShotRowIndex(shots: DirectorShot[], shotNo: string): number {
  const key = String(shotNo || '').trim();
  if (!key) return -1;
  const list = shots || [];
  const byField = list.findIndex((s) => String(s['镜号'] || '').trim() === key);
  if (byField >= 0) return byField;
  const asNum = Number(key);
  if (Number.isFinite(asNum) && asNum >= 1 && Number.isInteger(asNum) && asNum <= list.length) {
    return asNum - 1;
  }
  return -1;
}

/** 取某镜在整曲时间轴上的歌曲片段起止 */
export function resolveDirectorShotMusicRange(
  shots: DirectorShot[],
  shotNo: string,
  state?: Pick<DirectorPipelineState, 'shots' | 'storyboardsByShotNo' | 'mvMusic'>,
): DirectorShotMusicRange {
  if (state) {
    const list = state.shots || shots || [];
    const ranges = computeDirectorShotMusicRangesFromState({ ...state, shots: list });
    const idx = findDirectorShotRowIndex(list, shotNo);
    if (idx >= 0 && ranges[idx]) return ranges[idx];
  }
  const list = shots || [];
  const ranges = computeDirectorShotMusicRanges(list);
  const idx = findDirectorShotRowIndex(list, shotNo);
  if (idx >= 0 && ranges[idx]) return ranges[idx];
  const fallbackDur = 5;
  return { startSec: 0, endSec: fallbackDur, durationSec: fallbackDur };
}

/**
 * 将镜头表对齐到人声打包结果：镜数跟 pack 走，时长与 audioStart/End 写回。
 */
export function syncDirectorShotsToLyricTimeline(
  state: DirectorPipelineState,
): DirectorPipelineState {
  const segs = state.mvMusic?.lyricSegments || [];
  const packs = packLyricSegmentsIntoShotPacks(segs, {
    clipLengthMode: state.mvMusic?.clipLengthMode,
  });
  if (packs.length === 0) return state;

  let shots = [...(state.shots || [])];
  if (shots.length === 0) {
    shots = packs.map((_, i) => createEmptyDirectorShot(i));
  } else if (shots.length < packs.length) {
    const base = shots[shots.length - 1] || createEmptyDirectorShot(shots.length);
    while (shots.length < packs.length) {
      const i = shots.length;
      shots.push({
        ...createEmptyDirectorShot(i),
        画面描述: String(base['画面描述'] || ''),
        景别: String(base['景别'] || ''),
        光影氛围: String(base['光影氛围'] || ''),
        运镜: String(base['运镜'] || ''),
      });
    }
  } else if (shots.length > packs.length) {
    shots = shots.slice(0, packs.length);
  }
  shots = shots.map((s, i) => ({
    ...s,
    镜号: String(s['镜号'] || i + 1),
  }));

  return applyLyricPacksToDirectorShots(
    createDefaultDirectorPipelineState({ ...state, shots }),
    packs,
  );
}

/**
 * 将乐句打包结果写回镜头时长 + 分镜 audioStart/End。
 * 时长严格跟第一步识别分段；歌词写入对白供对口型判定（有文案时覆盖空对白）。
 */
export function applyLyricPacksToDirectorShots(
  state: DirectorPipelineState,
  packs: DirectorLyricShotPack[],
): DirectorPipelineState {
  const list = packs || [];
  if (list.length === 0) return state;
  const shots = (state.shots || []).map((shot, i) => {
    const p = list[Math.min(i, list.length - 1)];
    const span = Math.max(0.05, Number(p.endSec) - Number(p.startSec));
    // 时长跟 pack.durationSec（档位）走，避免 Math.round(span) 与 audio 区间不一致
    const durRaw =
      Number(p.durationSec) > 0.05 ? Number(p.durationSec) : span;
    const dur = Math.max(1, Math.round(durRaw));
    const packLyric = sanitizeDirectorLyricDisplayText(p.text);
    const instrumental = isDirectorLyricShotPackInstrumental(p);
    return {
      ...shot,
      时长: `${dur}s`,
      ...(instrumental
        ? { 对白旁白: '' }
        : packLyric
          ? { 对白旁白: packLyric.slice(0, 120) }
          : {}),
    };
  });
  let boards = { ...(state.storyboardsByShotNo || {}) };
  for (let i = 0; i < shots.length; i++) {
    const shotNo = String(shots[i]['镜号'] || i + 1).trim() || String(i + 1);
    const p = list[Math.min(i, list.length - 1)];
    const prev = boards[shotNo] || createEmptyDirectorShotStoryboard();
    const startSec = Math.max(0, Number(p.startSec) || 0);
    const endSec =
      Number.isFinite(Number(p.endSec)) && Number(p.endSec) > startSec + 0.05
        ? Number(p.endSec)
        : startSec + Math.max(0.05, Number(p.durationSec) || 5);
    boards[shotNo] = {
      ...prev,
      audioStartSec: startSec,
      audioEndSec: endSec,
      songClipStartSec: startSec,
      songClipEndSec: endSec,
      // 无人声镜默认不对口型
      ...(isDirectorLyricShotPackInstrumental(p) && typeof prev.preferLipsync !== 'boolean'
        ? { preferLipsync: false }
        : {}),
    };
  }
  const guarded = applyDirectorInstrumentalVisualGuards(shots, list) as DirectorShot[];
  return createDefaultDirectorPipelineState({
    ...state,
    shots: guarded,
    storyboardsByShotNo: boards,
  });
}

const SCRIPT_PHASES: DirectorPhase[] = ['shots', 'assets', 'prompts', 'storyboards'];
/** MV：确认镜头合并分镜与参考图；跳过独立 prompts/storyboards 步 */
const MV_PHASES: DirectorPhase[] = [
  'music',
  'style',
  'cast',
  'story',
  'assets',
  'shots',
  'videos',
];

export function normalizeDirectorMode(raw: string | undefined | null): DirectorMode {
  // 默认 MV；显式 'script' 仍可保留（UI 可再强制切回 MV）
  return String(raw || '').trim() === 'script' ? 'script' : 'mv';
}

export function normalizeDirectorPhase(
  raw: string | undefined | null,
  mode: DirectorMode,
): DirectorPhase {
  let p = String(raw || '').trim() as DirectorPhase;
  // 旧 MV 工程停在合成提示词 / 生成分镜 → 并入确认镜头
  if (mode === 'mv' && (p === 'prompts' || p === 'storyboards')) {
    p = 'shots';
  }
  // 旧「画幅」步 → 视频生成（画幅已并入确认镜头工具栏）
  if (mode === 'mv' && (p as string) === 'ratio') {
    p = 'videos';
  }
  // 取消独立「导出&分享」页：旧工程停在 preview → 视频生成
  if (mode === 'mv' && p === 'preview') {
    p = 'videos';
  }
  const allowed = mode === 'mv' ? MV_PHASES : SCRIPT_PHASES;
  if ((allowed as string[]).includes(p)) return p;
  return mode === 'mv' ? 'music' : 'shots';
}

/** 导演生图清晰度：与 ImageInputPanel / ImageProvider 的 1k|2k|4k 对齐 */
export function normalizeDirectorImageResolution(raw: unknown): string {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/ｋ/g, 'k');
  if (s === '2k' || s === '2') return '2K';
  if (s === '4k' || s === '4') return '4K';
  return '1K';
}

export function createDefaultDirectorPipelineState(
  partial?: Partial<DirectorPipelineState>,
): DirectorPipelineState {
  const assets = partial?.assets
    ? {
        characters: [...(partial.assets.characters || [])],
        scenes: [...(partial.assets.scenes || [])],
        props: [...(partial.assets.props || [])],
      }
    : createEmptyDirectorAssets();

  const mode = normalizeDirectorMode(partial?.mode);
  const phase = normalizeDirectorPhase(partial?.phase, mode);

  const assetsStepRaw = String(partial?.assetsStep || '').trim();
  const assetsStep: DirectorAssetsStep =
    assetsStepRaw === 'scenes' || assetsStepRaw === 'props' || assetsStepRaw === 'characters'
      ? assetsStepRaw
      : 'characters';

  const stylePresetId = normalizeDirectorStylePresetId(partial?.stylePresetId ?? 'street_crew');
  let globalStyle = String(partial?.globalStyle ?? '').trim();
  if (!globalStyle) {
    globalStyle = getDirectorStylePreset(stylePresetId).prompt;
  }
  const presetImage = directorStylePresetImageUrl(getDirectorStylePreset(stylePresetId).imageFile);
  let styleReferenceImageUrl = String(partial?.styleReferenceImageUrl ?? '').trim();
  if (!styleReferenceImageUrl && stylePresetId !== 'custom') {
    styleReferenceImageUrl = presetImage;
  }

  const mvAspectRatio = coerceDirectorMvAspectRatio(
    partial?.mvAspectRatio || partial?.videoBatchAspectRatio,
  );

  return {
    version: 1,
    mode,
    phase,
    assetsStep,
    scriptText: String(partial?.scriptText ?? ''),
    title: String(partial?.title ?? (mode === 'mv' ? 'MV导演' : '导演')),
    stylePresetId,
    globalStyle,
    styleReferenceImageUrl,
    shots: Array.isArray(partial?.shots)
      ? partial!.shots.map((s, i) => ({ ...createEmptyDirectorShot(i), ...s }))
      : [],
    assets,
    storyboardsByShotNo: normalizeDirectorStoryboardsByShotNo(partial?.storyboardsByShotNo),
    selectedAssetIds: Array.isArray(partial?.selectedAssetIds) ? [...partial!.selectedAssetIds] : [],
    chatModel: String(partial?.chatModel ?? 'gpt-3.5-turbo'),
    imageModel: String(partial?.imageModel ?? 'banana-2.0'),
    imageAspectRatio: String(partial?.imageAspectRatio ?? '2:1'),
    imageResolution: normalizeDirectorImageResolution(partial?.imageResolution),
    videoBatchModel: String(partial?.videoBatchModel ?? 'ltx-2.3-i2v'),
    videoBatchLipsyncModel: String(partial?.videoBatchLipsyncModel ?? 'ltx-2.3-lipsync'),
    videoBatchDuration: String(partial?.videoBatchDuration ?? '10'),
    videoBatchAspectRatio: String(partial?.videoBatchAspectRatio ?? mvAspectRatio),
    videoBatchResolution: String(partial?.videoBatchResolution ?? '1280'),
    videoBatchLipsyncResolution: String(
      partial?.videoBatchLipsyncResolution ?? partial?.videoBatchResolution ?? '1280',
    ),
    videoBatchModelBeforeLipsync: String(partial?.videoBatchModelBeforeLipsync ?? ''),
    mvMusic: normalizeDirectorMvMusic(partial?.mvMusic),
    mvStoryAnalysis: normalizeDirectorMvStoryAnalysis(partial?.mvStoryAnalysis),
    mvScriptUseReferenceGen: partial?.mvScriptUseReferenceGen !== false,
    mvScriptReference: String(partial?.mvScriptReference ?? ''),
    mvCloseUpFraming: partial?.mvCloseUpFraming !== false,
    mvCastPlan: normalizeDirectorMvCastPlan(partial?.mvCastPlan),
    mvAspectRatio,
    linkedSpliceNodeId: String(partial?.linkedSpliceNodeId ?? '').trim(),
    isGenerating: !!partial?.isGenerating,
    error: String(partial?.error ?? ''),
  };
}
