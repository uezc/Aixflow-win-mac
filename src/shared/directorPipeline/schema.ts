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
  DIRECTOR_EMPTY_SHOT_FRONT_BANNER,
  DIRECTOR_EMPTY_SHOT_NEGATIVE_LINE,
  DIRECTOR_EMPTY_SHOT_NEGATIVE_PROMPT,
  DIRECTOR_MV_SCENE_NEGATIVE_PROMPT,
  DIRECTOR_EMPTY_SHOT_BEAT_LOCK,
  DIRECTOR_EMPTY_SHOT_NO_PEOPLE_GUARD,
  DIRECTOR_INSTRUMENTAL_EMPTY_SHOT_GUARD,
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
  DIRECTOR_EMPTY_SHOT_FRONT_BANNER,
  DIRECTOR_EMPTY_SHOT_NEGATIVE_LINE,
  DIRECTOR_EMPTY_SHOT_NEGATIVE_PROMPT,
  DIRECTOR_MV_SCENE_NEGATIVE_PROMPT,
  DIRECTOR_EMPTY_SHOT_BEAT_LOCK,
  DIRECTOR_EMPTY_SHOT_NO_PEOPLE_GUARD,
  DIRECTOR_INSTRUMENTAL_EMPTY_SHOT_GUARD,
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

/** drama：AI 短剧导演；mv：音乐 MV 导演（旧 script 读入时归一为 drama） */
export type DirectorMode = 'drama' | 'mv';

/**
 * drama：ingest | episodes | visual | analyze | assets | board | videos | review（V2 八步）
 * 旧 bible（准备资产）→ assets；story→analyze，shots/prompts/storyboards→board，preview→review
 * mv：music | story | style | cast | assets | shots | videos | karaoke
 * （旧工程 phase=ratio 会归一到 videos；preview 在 MV 会归一到 videos）
 */
export type DirectorPhase =
  | 'music'
  | 'style'
  | 'story'
  | 'cast'
  | 'videos'
  | 'karaoke'
  | 'shots'
  | 'assets'
  | 'prompts'
  | 'storyboards'
  | 'preview'
  | 'ingest'
  | 'episodes'
  | 'visual'
  | 'analyze'
  /** @deprecated 短剧旧「准备资产」；归一到 assets */
  | 'bible'
  | 'board'
  | 'review';

/** 准备资产子步骤：角色 → 场景 → 道具 → 生物 */
export type DirectorAssetsStep = 'characters' | 'scenes' | 'props' | 'creatures';

export type DirectorStoryboardStatus = 'pending' | 'generating' | 'ready' | 'error';

export interface DirectorShotStoryboard {
  imageUrl: string;
  /**
   * 本镜历史分镜图（不含当前 `imageUrl`）。重新生成后可切回旧图。
   */
  imageUrlHistory?: string[];
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
  /**
   * 本镜历史成片（不含当前 `videoUrl`）。重新生成后可切回旧片。
   */
  videoUrlHistory?: string[];
  /**
   * 有新分镜图未点查看：表格行标绿，点击该行任意处后清除。
   */
  storyboardUnseen?: boolean;
  /**
   * 有新成片未点查看：表格行标绿，点击该行任意处后清除。
   */
  videoUnseen?: boolean;
  /**
   * 批量/单镜优化提示词后未点查看：视频表整行标绿，点击该行任意处后清除。
   * 优化稿本身仍保留。
   */
  promptOptimizedUnseen?: boolean;
  videoStatus?: DirectorStoryboardStatus;
  videoError?: string;
  /** 后台生成用的隐藏视频节点 id */
  videoNodeId?: string;
  /** 本镜视频生成开始时间戳（ms）；用于进度展示与超时失败 */
  videoGeneratingStartedAt?: number;
  /**
   * 本镜提示词/素材匹配已对齐到的剧本内容版本（`scriptContentRevision`）。
   * 与全局 revision 不一致时视为过期，可点「更新」受控回填（不重跑图/视频）。
   */
  promptsSyncedToScriptRevision?: number;
  /** 用户手改过最终提示词：受控更新时不整段覆盖，仅重绑 @图片 */
  finalPromptManual?: boolean;
  /** 用户手改过画面描述 */
  descManual?: boolean;
  /** 用户手改过机位/焦距/景别/运镜/光影 */
  framingManual?: boolean;
  /** 用户手改过对口型动作 */
  lipsyncActionManual?: boolean;
  /** 优化前提示词原文（默认等于镜头「最终提示词」） */
  promptOriginal?: string;
  /** MiniMax Skill 优化后的提示词 */
  promptOptimized?: string;
  /**
   * 最近一次优化所依据的原文。原文再改后应允许重新优化。
   */
  promptOptimizedFrom?: string;
  /**
   * 生成视频用哪一版：true=优化稿，false=原版。
   * 有优化稿且未显式选原版时默认用优化稿。
   */
  useOptimizedPrompt?: boolean;
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
  /**
   * 镜头变化节奏（写进剧本/成片提示词）：
   * fast=快速变化·激烈(0.8s) · normal=普通切换·叙事(1.2s) · slow=慢速切换·抒情(2.0s)
   */
  shotChangePace?: 'fast' | 'normal' | 'slow';
  /** 卡拉OK开场曲名（可与 title 不同） */
  songTitle?: string;
  /** 作词署名 */
  lyricist?: string;
  /** 作曲署名 */
  composer?: string;
  /** 字级 ASR 词时间轴（卡拉OK对齐） */
  lyricAsrWords?: Array<{ text: string; startSec: number; endSec: number }>;
  /** 识别语言：auto | zh | yue */
  asrLanguage?: string;
  /**
   * 绑定/清除歌曲的代数。合并时若 incoming.bindRev 更大，允许 url 为空（用户点了删除）；
   * 过期 patch 的 bindRev 更小，不会把刚连上的音频冲掉。
   */
  bindRev?: number;
}

/** MV / 卡拉OK 开场作词作曲默认署名 */
export const DEFAULT_MV_CREDIT_NAME = '致音';

export function resolveDirectorMvCreditName(raw: string | undefined | null): string {
  const s = String(raw || '').trim();
  return s || DEFAULT_MV_CREDIT_NAME;
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

/** MV：选角计划（进选角步按故事/剧本自动打开；用户改过人数/性别后不再覆盖） */
export interface DirectorMvCastPlan {
  /** 1=单主角，2=双主角 */
  leadCount: 1 | 2;
  lead1Gender: DirectorMvLeadGender;
  /** 双主角时生效 */
  lead2Gender: DirectorMvLeadGender;
  /** 用户手动改过人数/性别后为 true，自动推断不再覆盖 */
  userLocked?: boolean;
}

/** 选角自动打开的组合（用于提示文案） */
export type DirectorMvCastPlanComboId =
  | 'solo-female'
  | 'solo-male'
  | 'duo-mf'
  | 'duo-ff'
  | 'duo-mm';

export type DirectorAssetGender = DirectorMvLeadGender | '';

/**
 * 镜头表列（含短剧专业导演本三层字段）。
 * - 场次层：场号 / 内外景 / 日夜 / 地点 / 出场人物
 * - 镜头层：镜号 / 景别 / 镜头角度(=机位) / 焦距 / 运镜 / 时长 / 画面描述(=画面动作) / 对白旁白 / 音效 / 光影氛围(=情绪)
 * - 制作层：制作备注 / 连贯性 / 参考图绑定
 * MV 与旧项目仍主要使用原有列；新增列默认可空。
 */
export const DIRECTOR_SHOT_COLUMNS = [
  '场号',
  '内外景',
  '日夜',
  '地点',
  '出场人物',
  '镜号',
  '时长',
  '画面描述',
  '镜头角度',
  '焦距',
  '景别',
  '光影氛围',
  '对白旁白',
  '对口型动作',
  '音效',
  '运镜',
  '制作备注',
  '连贯性',
  '参考图绑定',
  '最终提示词',
] as const;

export type DirectorShotColumnKey = (typeof DIRECTOR_SHOT_COLUMNS)[number];
export type DirectorShot = Record<DirectorShotColumnKey, string>;

export type DirectorAssetKind = 'character' | 'scene' | 'prop' | 'creature';

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
  /** 角色性别（选角槽位写入；场景/道具/生物可空） */
  gender?: DirectorAssetGender;
}

export interface DirectorAssetsBag {
  characters: DirectorAsset[];
  scenes: DirectorAsset[];
  props: DirectorAsset[];
  /** 宠物、怪物等非人类生物 */
  creatures: DirectorAsset[];
}

export function directorAssetBagKey(kind: DirectorAssetKind): keyof DirectorAssetsBag {
  if (kind === 'character') return 'characters';
  if (kind === 'scene') return 'scenes';
  if (kind === 'prop') return 'props';
  return 'creatures';
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
  /** 每镜分镜图，key = 镜号；短剧为 ep:{episodeId}:{镜号}，避免换集串成片 */
  storyboardsByShotNo: Record<string, DirectorShotStoryboard>;
  /** 短剧当前集：storyboardsByShotNo 按此隔离 */
  activeDramaEpisodeId: string;
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
   * MV 剧本步：已生成/编辑的故事大纲（确认后再生成分段剧本）。
   */
  mvStoryOutline: string;
  /** MV 剧本步：故事大纲是否已确认（未确认不可生成分段剧本） */
  mvStoryOutlineConfirmed: boolean;
  /**
   * MV 生成故事前偏好：故事类型（都市/言情/科幻…）；空=模型自选。
   */
  mvStoryGenreType: string;
  /** MV 生成故事前偏好：风格（轻松/虐恋/爽文…）；空=模型自选 */
  mvStoryToneStyle: string;
  /** MV 生成故事前偏好：结局倾向；空=模型自选 */
  mvStoryEndingType: string;
  /**
   * MV：近景特写开关（剧本步 UI 设置；分镜/视频生成与对口型仍读此字段）。
   * true = 有人镜仅允许特写/大特写（禁止半身、全身）；空镜仍按场景公式。
   * false = 景别/运镜不限。默认 true。
   */
  mvCloseUpFraming: boolean;
  /** MV：选角计划（剧本之后选角；可被人物库同步性别） */
  mvCastPlan: DirectorMvCastPlan;
  /** MV：画幅（分镜图与视频统一） */
  mvAspectRatio: DirectorMvAspectRatio;
  /** MV：关联的剪辑节点（图片预览轨） */
  linkedSpliceNodeId: string;
  /**
   * 剧本正文内容版本。每次「重新生成脚本」成功后 +1。
   * 下游镜头用 storyboard.promptsSyncedToScriptRevision 对齐；不一致则提示过期。
   */
  scriptContentRevision: number;
  isGenerating: boolean;
  error: string;
}

function newAssetId(kind: DirectorAssetKind, index: number): string {
  return `${kind}-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createEmptyDirectorShot(index = 0): DirectorShot {
  return {
    场号: '',
    内外景: '',
    日夜: '',
    地点: '',
    出场人物: '',
    镜号: String(index + 1),
    时长: '',
    画面描述: '',
    镜头角度: '',
    焦距: '',
    景别: '',
    光影氛围: '',
    对白旁白: '',
    对口型动作: '',
    音效: '',
    运镜: '',
    制作备注: '',
    连贯性: '',
    参考图绑定: '',
    最终提示词: '',
  };
}

/** 手动添加/插入的空行：除镜号外内容字段皆空（「—」也视为空） */
export function isBlankDirectorShot(shot: Partial<DirectorShot> | null | undefined): boolean {
  if (!shot) return true;
  const keys: DirectorShotColumnKey[] = [
    '场号',
    '内外景',
    '日夜',
    '地点',
    '出场人物',
    '时长',
    '画面描述',
    '镜头角度',
    '焦距',
    '景别',
    '光影氛围',
    '对白旁白',
    '对口型动作',
    '音效',
    '运镜',
    '制作备注',
    '连贯性',
    '参考图绑定',
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
    userLocked: false,
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
    userLocked: o.userLocked === true,
  };
}

export function directorMvCastPlanComboId(plan: DirectorMvCastPlan): DirectorMvCastPlanComboId {
  const p = normalizeDirectorMvCastPlan(plan);
  if (p.leadCount === 1) return p.lead1Gender === 'male' ? 'solo-male' : 'solo-female';
  if (p.lead1Gender === 'female' && p.lead2Gender === 'female') return 'duo-ff';
  if (p.lead1Gender === 'male' && p.lead2Gender === 'male') return 'duo-mm';
  return 'duo-mf';
}

function directorMvCastPlansEqual(a: DirectorMvCastPlan, b: DirectorMvCastPlan): boolean {
  return (
    a.leadCount === b.leadCount &&
    a.lead1Gender === b.lead1Gender &&
    a.lead2Gender === b.lead2Gender
  );
}

function isDirectorMvSupportingCastEntry(name: string, prompt: string): boolean {
  const blob = `${name} ${prompt}`;
  if (/男主|女主|主角/.test(String(name || ''))) return false;
  return /配角|路人|群众|人群|龙套|群演|路人甲|路人乙/.test(blob);
}

function pickDirectorMvLeadEntries(entries: DirectorMvCharacterEntry[]): DirectorMvCharacterEntry[] {
  const usable = entries.filter((e) => !isDirectorMvSupportingCastEntry(e.name, e.prompt));
  if (!usable.length) return [];
  const named = usable.filter((e) => /男主|女主|主角/.test(String(e.name || '')));
  return (named.length ? named : usable).slice(0, 2);
}

function extractDirectorMvOutlineRoleBlock(outline: string): string {
  const raw = String(outline || '');
  if (!raw.trim()) return '';
  const re = /【\s*([^】]+?)\s*】\s*([\s\S]*?)(?=【\s*[^】]+?\s*】|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const title = String(m[1] || '').trim();
    if (/角色|人物|主角/.test(title) && !/人物关系/.test(title)) {
      return String(m[2] || '').trim();
    }
  }
  return '';
}

type DirectorMvStoryRoleEntry = DirectorMvCharacterEntry & {
  gender: DirectorMvLeadGender | null;
};

function isDirectorMvDefaultLeadName(name: string): boolean {
  const n = String(name || '').trim();
  return !n || n === '男主' || n === '女主' || /^(男主|女主)[12]$/.test(n);
}

function isDirectorMvLeadSeedPrompt(prompt: string | undefined | null): boolean {
  const t = String(prompt || '').trim();
  if (!t) return false;
  return t === directorMvLeadSeedPrompt('male') || t === directorMvLeadSeedPrompt('female');
}

function composeDirectorMvStoryRolePrompt(role: DirectorMvStoryRoleEntry): string {
  const desc = String(role.prompt || '').trim();
  const name = String(role.name || '').trim();
  const parts: string[] = [];
  if (role.gender === 'male' && !/性别\s*[:：]\s*男/.test(desc.slice(0, 24))) {
    parts.push('性别：男');
  } else if (role.gender === 'female' && !/性别\s*[:：]\s*女/.test(desc.slice(0, 24))) {
    parts.push('性别：女');
  }
  if (name && !desc.includes(name) && !isDirectorMvDefaultLeadName(name)) {
    parts.push(name);
  }
  if (desc) parts.push(desc);
  return parts.join('，');
}

/** 从故事大纲【角色】解析男女主（姓名 + 形象文案） */
export function parseDirectorMvOutlineRoleEntries(outline: string): DirectorMvStoryRoleEntry[] {
  const block = extractDirectorMvOutlineRoleBlock(outline);
  if (!block) return [];
  const chunks = block
    .replace(/\s*[；;]\s*(?=女主|男主|主角)/g, '\n')
    .replace(/([。！？\n])\s*(?=女主|男主|主角)/g, '$1\n')
    .replace(/(女主[^\n]{4,}?)(?=男主)/g, '$1\n')
    .replace(/(男主[^\n]{4,}?)(?=女主)/g, '$1\n')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: DirectorMvStoryRoleEntry[] = [];
  const seen = new Set<string>();
  const roleHeadRe =
    /^(?:[-*•]\s*|\d+[.)、]\s*)?(?:【\s*)?(女主|男主|主角)(?:\s*】)?\s*([^\s:：，,；;【】]{0,12})?\s*[:：]\s*(.*)$/u;
  for (const line of chunks) {
    const m = line.match(roleHeadRe);
    let name = '';
    let prompt = '';
    let gender: DirectorMvLeadGender | null = null;
    if (m) {
      const tag = String(m[1] || '');
      name = String(m[2] || '').trim();
      prompt = String(m[3] || '').trim();
      if (tag === '女主') gender = 'female';
      else if (tag === '男主') gender = 'male';
    } else {
      const parsed = parseDirectorMvCharacterEntries(line)[0];
      if (!parsed) continue;
      name = parsed.name;
      prompt = parsed.prompt;
    }
    if (!prompt && !name) continue;
    if (!gender) gender = inferDirectorMvLeadGenderFromText(name, prompt);
    if (!name || isDirectorMvDefaultLeadName(name)) {
      const fromPrompt = String(prompt || '').match(/^([\u4e00-\u9fffA-Za-z]{1,8})[，,、：:]/);
      if (fromPrompt && !/^(性别|西域|魔界|约|二十|三十)/.test(fromPrompt[1])) {
        name = fromPrompt[1];
      }
    }
    if (!name) name = gender === 'male' ? '男主' : gender === 'female' ? '女主' : '主角';
    const key = `${gender || ''}\0${normalizeCastNameKey(name)}\0${prompt.slice(0, 24)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, prompt: prompt || name, gender });
    if (out.length >= 2) break;
  }
  return out;
}

/** 故事大纲【角色】优先，其次剧本人物库 */
export function getDirectorMvLeadRolesFromStory(state: DirectorPipelineState): DirectorMvStoryRoleEntry[] {
  const fromOutline = parseDirectorMvOutlineRoleEntries(String(state.mvStoryOutline || ''));
  if (fromOutline.length) return pickDirectorMvLeadEntries(fromOutline).map((e) => ({
    ...e,
    gender: (e as DirectorMvStoryRoleEntry).gender || inferDirectorMvLeadGenderFromText(e.name, e.prompt),
  }));
  const fromScript = pickDirectorMvLeadEntries(
    parseDirectorMvCharacterEntries(getDirectorMvCharactersSectionText(state)),
  );
  return fromScript.map((e) => ({
    ...e,
    gender: inferDirectorMvLeadGenderFromText(e.name, e.prompt),
  }));
}

const DIRECTOR_MV_REF_NAME_STOP = new Set([
  '男性',
  '女性',
  '男人',
  '女人',
  '中年',
  '白发',
  '爱情',
  '故事',
  '少年',
  '少女',
  '都市',
  '公路',
  '角色',
  '主角',
  '男主',
  '女主',
  '参考',
]);

/** 从用户参考里尽量抽出人名（如「男人林浪和小关的爱情故事」→ 林浪、小关） */
export function extractDirectorMvReferencePersonNames(text: string): string[] {
  const t = String(text || '').trim();
  if (!t) return [];
  const names: string[] = [];
  const push = (n: string) => {
    const s = String(n || '').trim();
    if (s.length < 2 || s.length > 4) return;
    if (DIRECTOR_MV_REF_NAME_STOP.has(s)) return;
    if (/岁|性别/.test(s)) return;
    names.push(s);
  };
  const afterRole = t.match(/(?:男人|女人|男主|女主)([\u4e00-\u9fff]{2,3})/);
  if (afterRole) push(afterRole[1]);
  for (const part of t.split(/[和与、,，]/)) {
    const cleaned = String(part || '')
      .replace(/的爱情故事.*$/u, '')
      .replace(/爱情故事.*$/u, '')
      .replace(/^(?:男性|女性|白发|中年)+/u, '');
    const m = cleaned.match(/[\u4e00-\u9fff]{2,4}/g) || [];
    for (const n of m) push(n);
  }
  return [...new Set(names)].slice(0, 4);
}

function inferDirectorMvCastComboFromText(text: string): DirectorMvCastPlan | null {
  const t = String(text || '');
  if (!t.trim()) return null;
  if (/双女主|两个女主|两位女主|女女主|两个女性|两位女性/.test(t)) {
    return { leadCount: 2, lead1Gender: 'female', lead2Gender: 'female', userLocked: false };
  }
  if (/双男主|两个男主|两位男主|男男主|两个男性|两位男性/.test(t)) {
    return { leadCount: 2, lead1Gender: 'male', lead2Gender: 'male', userLocked: false };
  }
  const hasMale = /男主|男性|男人|男士|大叔|中年男|老年男|少年男|性别\s*[:：]\s*男/.test(t);
  const hasFemale = /女主|女性|女人|女士|女孩|少女|中年女|性别\s*[:：]\s*女/.test(t);
  const duoHint = /一男一女|男女主|双人|两人|二人|男主[与和及、,／/]\s*女主|女主[与和及、,／/]\s*男主/.test(t);
  const loveDuo =
    /爱情|恋爱|情侣|爱人/.test(t) &&
    (/[和与、]/.test(t) || extractDirectorMvReferencePersonNames(t).length >= 2);
  const soloHint = /独自|单身|单人主角|一个主角|仅[有一]?[名个]?主角/.test(t);
  if (loveDuo && !soloHint) {
    const n0 = hasMale && !hasFemale ? 'male' : hasFemale && !hasMale ? 'female' : 'male';
    const n1 = n0 === 'male' ? 'female' : 'male';
    return { leadCount: 2, lead1Gender: n0, lead2Gender: n1, userLocked: false };
  }
  if ((hasMale && hasFemale) || duoHint) {
    return { leadCount: 2, lead1Gender: 'female', lead2Gender: 'male', userLocked: false };
  }
  if (hasFemale && !hasMale) {
    return { leadCount: soloHint || !duoHint ? 1 : 2, lead1Gender: 'female', lead2Gender: 'male', userLocked: false };
  }
  if (hasMale && !hasFemale) {
    return { leadCount: soloHint || !duoHint ? 1 : 2, lead1Gender: 'male', lead2Gender: 'female', userLocked: false };
  }
  return null;
}

function collectDirectorMvCastHintBlob(state: DirectorPipelineState): string {
  const sections = normalizeDirectorMvScriptSections(state.mvStoryAnalysis?.sections);
  const fromScript = parseDirectorMvScriptSectionsFromText(String(state.scriptText || ''));
  const outline = String(state.mvStoryOutline || '');
  return [
    String(state.mvScriptReference || ''),
    extractDirectorMvOutlineRoleBlock(outline),
    outline,
    sections.characters || fromScript.characters,
    sections.relationships || fromScript.relationships,
    sections.plot || fromScript.plot,
    sections.worldView || fromScript.worldView,
  ]
    .filter((s) => String(s || '').trim())
    .join('\n');
}

/** 已有参考图或用户手动改过人数/性别 → 不再自动改槽位 */
export function isDirectorMvCastPlanUserLocked(state: DirectorPipelineState): boolean {
  const plan = normalizeDirectorMvCastPlan(state.mvCastPlan);
  if (plan.userLocked) return true;
  return (state.assets?.characters || []).slice(0, 2).some((c) => String(c?.imageUrl || '').trim());
}

/**
 * 按故事大纲 / 剧本人物库推断应打开的主角人数与性别。
 * 无明确信息时默认一男一女（两个槽都打开，并填入预设形象文案）。
 */
export function inferDirectorMvCastPlanFromStory(state: DirectorPipelineState): DirectorMvCastPlan {
  const leads = getDirectorMvLeadRolesFromStory(state);
  if (leads.length >= 1) {
    const g0 = leads[0].gender || inferDirectorMvLeadGenderFromText(leads[0].name, leads[0].prompt) || 'female';
    if (leads.length === 1) {
      return {
        leadCount: 1,
        lead1Gender: g0,
        lead2Gender: g0 === 'female' ? 'male' : 'female',
        userLocked: false,
      };
    }
    const g1 =
      leads[1].gender ||
      inferDirectorMvLeadGenderFromText(leads[1].name, leads[1].prompt) ||
      (g0 === 'female' ? 'male' : 'female');
    return {
      leadCount: 2,
      lead1Gender: g0,
      lead2Gender: g1,
      userLocked: false,
    };
  }
  const fromText = inferDirectorMvCastComboFromText(collectDirectorMvCastHintBlob(state));
  if (fromText) return fromText;
  return {
    leadCount: 2,
    lead1Gender: 'female',
    lead2Gender: 'male',
    userLocked: false,
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
  if (gender === 'male') {
    return `性别：${g}，约二十七八岁，东亚面孔，轮廓分明，短发利落，服装：当代常服需写清上衣、下装、鞋履与一件配饰（色调贴合全片 MV 画风），体态挺拔，气质沉静克制，标志性：眉眼有故事感、唇形清晰`;
  }
  return `性别：${g}，约二十四五岁，东亚面孔，五官精致，长发自然，服装：当代常服需写清上衣、下装、鞋履与一件配饰（色调贴合全片 MV 画风），体态匀称，气质清冷克制，标志性：目光有情绪、唇形清晰`;
}

/** 选角形象文案是否过弱（待定/过短），可被剧本人物库覆盖 */
export function isDirectorMvLeadPromptWeak(prompt: string | undefined | null): boolean {
  const p = String(prompt || '').trim();
  if (!p) return true;
  if (/待定/.test(p)) return true;
  if (/服装与气质贴合\s*MV|气氛融合\s*MV/.test(p)) return true;
  if (p.length < 36) return true;
  const hasAge = /(岁|年龄|二十|三十|四十|十八|青年|少年|中年|少女)/.test(p);
  const hasClothes = /(衣|衫|裙|外套|裤|靴|鞋|袍|装|毛衣|夹克|西装|连衣裙|帽)/.test(p);
  const hasFace = /(发|眼|眉|脸|唇|五官|短发|长发|胡)/.test(p);
  return !(hasAge && (hasClothes || hasFace));
}

/** 从姓名+提示词推断主角性别 */
export function inferDirectorMvLeadGenderFromText(
  name: string,
  prompt?: string,
): DirectorMvLeadGender | null {
  const blob = `${String(name || '')} ${String(prompt || '')}`;
  const head = String(prompt || '').trim().slice(0, 48);
  if (/^女主/.test(String(name || '')) || /性别\s*[:：]\s*女/.test(head)) return 'female';
  if (/^男主/.test(String(name || '')) || /性别\s*[:：]\s*男/.test(head)) return 'male';
  if (/女主|女性|少女/.test(blob) && !/男主|男性|少年男/.test(blob.slice(0, 40))) return 'female';
  if (/男主|男性|少年男|青年男/.test(blob) && !/女主|女性|少女/.test(blob.slice(0, 40))) return 'male';
  if (/^女\s*[,，、]/.test(head) || /^女，/.test(head)) return 'female';
  if (/^男\s*[,，、]/.test(head) || /^男，/.test(head)) return 'male';
  return null;
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

/** 选角计划中的主角资产 id（characters 列表前 leadCount 项，即主角槽） */
export function listDirectorMvLeadAssetIds(
  state: {
    mvCastPlan?: DirectorPipelineState['mvCastPlan'] | null;
    assets?: { characters?: Array<{ id?: string } | null> | null } | null;
  } | null | undefined,
): string[] {
  if (!state) return [];
  const plan = normalizeDirectorMvCastPlan(state.mvCastPlan);
  return (state.assets?.characters || [])
    .slice(0, plan.leadCount)
    .map((c) => String(c?.id || '').trim())
    .filter(Boolean);
}

/** 按选角计划确保主角槽位存在（只认默认主角名，禁止按性别把素材库额外角色抢进主角位） */
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
      // 只回收空的「男主/女主」槽；绝不把「陆天仰」这类素材库角色按性别当成男主
      idx = pool.findIndex((a) => {
        if (usedIds.has(a.id)) return false;
        const n = String(a.name || '').trim();
        if (!isDirectorMvDefaultLeadName(n)) return false;
        return (
          a.gender === gender ||
          (gender === 'male' && /男主/.test(n)) ||
          (gender === 'female' && /女主/.test(n))
        );
      });
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
        isDirectorMvDefaultLeadName(keepName) ||
        keepName === directorMvLeadDefaultName(prev.gender === 'male' ? 'male' : 'female', i, plan.leadCount);
      const prevPrompt = String(prev.prompt ?? '');
      let prompt = prevPrompt;
      if (prevPrompt.trim() && directorMvLeadPromptConflictsGender(prevPrompt, gender)) {
        prompt = alignDirectorMvLeadPrompt(gender, name, prevPrompt);
      }
      nextLeads.push({
        ...prev,
        kind: 'character',
        gender,
        name: looksLikeLead ? name : keepName,
        prompt,
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
  const next = normalizeDirectorMvCastPlan({
    ...prev,
    ...patch,
    userLocked: patch.userLocked !== false,
  });
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

/**
 * 故事大纲步：未手动锁选角时，不要把默认「女主」写成已锁定，否则会盖住用户参考（如中年男人）。
 */
export function formatDirectorMvLockedCastForStoryPrompt(state: DirectorPipelineState): string {
  const ref = String(state.mvScriptReference || '').trim();
  const refNames = extractDirectorMvReferencePersonNames(ref);
  const nameLock = refNames.length
    ? `用户参考中的姓名必须原样用作主角：${refNames.join('、')}。禁止改用歌曲分析或上一版里的其它姓名。`
    : '';
  if (isDirectorMvCastPlanUserLocked(state)) {
    return [formatDirectorMvLockedCastForPrompt(state), nameLock].filter(Boolean).join('\n');
  }
  const fromRef = inferDirectorMvCastComboFromText(ref);
  if (fromRef) {
    const g0 = directorMvLeadGenderLabelZh(fromRef.lead1Gender);
    if (fromRef.leadCount === 1) {
      return [
        `用户参考已写明主角为${g0}性，必须作为主角；禁止改成相反性别，禁止套用默认二十五岁女主。`,
        nameLock,
      ]
        .filter(Boolean)
        .join('\n');
    }
    const g1 = directorMvLeadGenderLabelZh(fromRef.lead2Gender);
    return [
      `用户参考已写明双主角（${g0}/${g1}），必须遵守；禁止套用默认二十五岁女主。`,
      nameLock,
    ]
      .filter(Boolean)
      .join('\n');
  }
  return [
    '（未锁定主角。若用户参考写了性别/年龄/身份，必须作为主角设定；禁止在参考未要求时默认写成二十五岁东亚女主。）',
    nameLock,
  ]
    .filter(Boolean)
    .join('\n');
}

export function createEmptyDirectorAssets(): DirectorAssetsBag {
  return { characters: [], scenes: [], props: [], creatures: [] };
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
    shotChangePace: 'normal',
    songTitle: '',
    lyricist: '',
    composer: '',
    lyricAsrWords: [],
    asrLanguage: 'auto',
    bindRev: 0,
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
 * - fill：按姓名合并；弱提示词（待定等）用剧本覆盖；并据人物库自动校正性别
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
    const inferred =
      inferDirectorMvLeadGenderFromText(name, e.prompt) ||
      inferDirectorMvLeadGenderFromText(name, prev?.prompt) ||
      (prev?.gender === 'male' || prev?.gender === 'female' ? prev.gender : null);
    const genderFromName: DirectorAssetGender = inferred || '';
    const scriptPrompt = String(e.prompt || '').trim();
    const prevPrompt = String(prev?.prompt || '').trim();
    // 剧本有详写，或旧文案是「待定」弱提示 → 用剧本
    const rawPrompt =
      scriptPrompt && (!prevPrompt || isDirectorMvLeadPromptWeak(prevPrompt) || mode === 'replace')
        ? scriptPrompt
        : scriptPrompt || prevPrompt || '';
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

  // 未锁定时按人物库自动打开 1/2 人及性别；已锁定只校正已开槽的性别文案
  const plan = normalizeDirectorMvCastPlan(state.mvCastPlan);
  const locked = isDirectorMvCastPlanUserLocked(state);
  const inferred = inferDirectorMvCastPlanFromStory(state);
  const leadCount: 1 | 2 = locked ? plan.leadCount : inferred.leadCount;
  const lead1Gender = locked ? plan.lead1Gender : inferred.lead1Gender;
  const lead2Gender = locked ? plan.lead2Gender : inferred.lead2Gender;

  return ensureDirectorMvLeadSlots(
    createDefaultDirectorPipelineState({
      ...state,
      mvCastPlan: {
        ...plan,
        leadCount,
        lead1Gender,
        lead2Gender,
        userLocked: plan.userLocked,
      },
      assets: {
        ...state.assets,
        characters: nextChars,
      },
    }),
  );
}

/** 把故事【角色】的姓名/形象文案填进已打开的选角卡（空文案、预设文案可覆盖；用户手写或已出图不覆盖） */
export function fillDirectorMvCastFromStoryRoles(state: DirectorPipelineState): DirectorPipelineState {
  const roles = getDirectorMvLeadRolesFromStory(state);
  if (!roles.length) return state;
  const plan = normalizeDirectorMvCastPlan(state.mvCastPlan);
  const chars = [...(state.assets?.characters || [])];
  const used = new Set<number>();
  let changed = false;
  for (let i = 0; i < plan.leadCount; i++) {
    const gender = i === 0 ? plan.lead1Gender : plan.lead2Gender;
    const cur = chars[i];
    if (!cur) continue;
    let roleIdx = roles.findIndex((r, idx) => !used.has(idx) && r.gender === gender);
    if (roleIdx < 0) roleIdx = roles.findIndex((_r, idx) => !used.has(idx));
    if (roleIdx < 0) continue;
    used.add(roleIdx);
    const role = roles[roleIdx];
    const storyPrompt = composeDirectorMvStoryRolePrompt(role);
    const hasImage = !!String(cur.imageUrl || '').trim();
    const prevPrompt = String(cur.prompt || '');
    const canFillPrompt =
      !hasImage &&
      (!prevPrompt.trim() ||
        isDirectorMvLeadPromptWeak(prevPrompt) ||
        isDirectorMvLeadSeedPrompt(prevPrompt));
    const canFillName = !hasImage && isDirectorMvDefaultLeadName(cur.name);
    const nextName = canFillName && role.name ? role.name : cur.name;
    const nextPrompt = canFillPrompt && storyPrompt ? storyPrompt : cur.prompt;
    if (nextName === cur.name && nextPrompt === cur.prompt && cur.gender === gender) continue;
    chars[i] = {
      ...cur,
      kind: 'character',
      gender,
      name: nextName,
      prompt: nextPrompt,
    };
    changed = true;
  }
  if (!changed) return state;
  return createDefaultDirectorPipelineState({
    ...state,
    assets: {
      ...state.assets,
      characters: chars,
    },
  });
}

/** 进选角步：按故事打开男女主卡，并填入大纲【角色】文案 */
export function applyAutoDirectorMvCastPlan(state: DirectorPipelineState): DirectorPipelineState {
  const locked = isDirectorMvCastPlanUserLocked(state);
  let next = state;
  if (!locked) {
    const inferred = inferDirectorMvCastPlanFromStory(state);
    const prev = normalizeDirectorMvCastPlan(state.mvCastPlan);
    if (!directorMvCastPlansEqual(prev, inferred)) {
      next = createDefaultDirectorPipelineState({
        ...state,
        mvCastPlan: { ...inferred, userLocked: false },
      });
    }
  }
  const hasScriptChars = parseDirectorMvCharacterEntries(
    getDirectorMvCharactersSectionText(next),
  ).length;
  if (hasScriptChars) next = syncDirectorMvCastFromScript(next, 'fill');
  next = ensureDirectorMvLeadSlots(next);
  return fillDirectorMvCastFromStoryRoles(next);
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
 * 按剧本场景库同步场景列表（单张空场景提示词）。
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
  return [
    ...(assets.characters || []),
    ...(assets.scenes || []),
    ...(assets.props || []),
    ...(assets.creatures || []),
  ];
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
    hit(assets.creatures, 'creature') ||
    null
  );
}

export function countAssetsMissingImages(assets: DirectorAssetsBag): {
  characters: number;
  scenes: number;
  props: number;
  creatures: number;
  total: number;
} {
  const miss = (list: DirectorAsset[]) =>
    (list || []).filter((a) => !String(a.imageUrl || '').trim()).length;
  const characters = miss(assets.characters);
  const scenes = miss(assets.scenes);
  const props = miss(assets.props);
  const creatures = miss(assets.creatures);
  return {
    characters,
    scenes,
    props,
    creatures,
    total: characters + scenes + props + creatures,
  };
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

const MAX_DIRECTOR_STORYBOARD_IMAGE_HISTORY = 12;

export function listDirectorShotStoryboardImages(
  sb: Pick<DirectorShotStoryboard, 'imageUrl' | 'imageUrlHistory'> | null | undefined,
): string[] {
  const cur = String(sb?.imageUrl || '').trim();
  const out: string[] = [];
  if (cur) out.push(cur);
  for (const raw of sb?.imageUrlHistory || []) {
    const u = String(raw || '').trim();
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}

export function mergeDirectorShotStoryboardImageHistory(
  prev: Pick<DirectorShotStoryboard, 'imageUrl' | 'imageUrlHistory'>,
  nextUrl: string,
): string[] {
  const next = String(nextUrl || '').trim();
  const prevCur = String(prev.imageUrl || '').trim();
  const out: string[] = [];
  if (prevCur && prevCur !== next) out.push(prevCur);
  for (const raw of prev.imageUrlHistory || []) {
    const u = String(raw || '').trim();
    if (u && u !== next && !out.includes(u)) out.push(u);
  }
  return out.slice(0, MAX_DIRECTOR_STORYBOARD_IMAGE_HISTORY);
}

const MAX_DIRECTOR_SHOT_VIDEO_HISTORY = 12;

/**
 * 成片/媒体 URL 去重键：同一文件的 local-resource / file / 编码差异 / CDN query 视为同一条。
 * 避免「选择成片」出现多张看起来一样且勾选永远在第一格（当前片总被插到列表头）。
 */
export function directorMediaUrlKey(url: string): string {
  let s = String(url || '').trim();
  if (!s) return '';
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep raw */
  }
  s = s.replace(/\\/g, '/');
  const lower = s.toLowerCase();
  if (lower.startsWith('blob:')) return s;
  if (lower.startsWith('local-resource://')) {
    s = s.replace(/^local-resource:\/\//i, '');
  } else if (lower.startsWith('file://')) {
    s = s.replace(/^file:\/\//i, '');
    while (s.startsWith('/')) s = s.slice(1);
  } else if (lower.startsWith('http://') || lower.startsWith('https://')) {
    try {
      const u = new URL(s);
      // 路径相同、仅 query/token 不同 → 同一资源
      s = `${u.protocol}//${u.host}${u.pathname}`.toLowerCase();
      return s;
    } catch {
      const q = s.indexOf('?');
      const h = s.indexOf('#');
      const cut = Math.min(q >= 0 ? q : s.length, h >= 0 ? h : s.length);
      return s.slice(0, cut).toLowerCase();
    }
  }
  s = s.replace(/\/+/g, '/');
  if (/^[a-zA-Z]:\//.test(s)) s = s[0].toUpperCase() + s.slice(1);
  return s.toLowerCase();
}

function pushUniqueDirectorMediaUrl(out: string[], seen: Set<string>, raw: string): void {
  const u = String(raw || '').trim();
  if (!u) return;
  const key = directorMediaUrlKey(u) || u;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(u);
}

/** 文件名主干（用于 http 与本地副本的弱去重） */
function directorMediaUrlFileStem(url: string): string {
  const key = directorMediaUrlKey(url);
  if (!key) return '';
  const base = (key.split('/').pop() || key).split('?')[0] || '';
  return base.replace(/\.(mp4|webm|mov|m4v|mkv)(\.[^.]+)?$/i, '').toLowerCase();
}

function preferDirectorMediaUrl(a: string, b: string): string {
  const rank = (u: string) => {
    const l = String(u || '').toLowerCase();
    if (l.startsWith('local-resource://')) return 4;
    if (l.startsWith('file://')) return 3;
    if (l.startsWith('http://') || l.startsWith('https://')) return 2;
    if (l.startsWith('blob:')) return 1;
    return 0;
  };
  return rank(a) >= rank(b) ? a : b;
}

/** 可长期保留的本地成片路径（云端 URL 会过期，选择列表不展示） */
export function isDirectorLocalMediaUrl(url: string): boolean {
  const s = String(url || '').trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  if (lower.startsWith('blob:')) return false;
  if (lower.startsWith('http://') || lower.startsWith('https://')) return false;
  if (lower.startsWith('local-resource://')) return true;
  if (lower.startsWith('file://')) return true;
  if (/^[a-zA-Z]:[\\/]/.test(s)) return true;
  if (s.startsWith('\\\\')) return true;
  // Unix 绝对路径（排除协议相对 //）
  if (s.startsWith('/') && !s.startsWith('//')) return true;
  return false;
}

export function listDirectorShotVideos(
  sb: Pick<DirectorShotStoryboard, 'videoUrl' | 'videoUrlHistory'> | null | undefined,
): string[] {
  const cur = String(sb?.videoUrl || '').trim();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of sb?.videoUrlHistory || []) {
    pushUniqueDirectorMediaUrl(out, seen, String(raw || ''));
  }
  if (cur) {
    const key = directorMediaUrlKey(cur) || cur;
    const idx = out.findIndex((u) => (directorMediaUrlKey(u) || u) === key);
    if (idx >= 0) out[idx] = cur;
    else {
      seen.add(key);
      out.push(cur);
    }
  }
  // 按文件名主干弱去重（公网 + 本地副本只留一条；优先本地，其次当前选中）
  const curKey = directorMediaUrlKey(cur) || cur;
  const byStem = new Map<string, string>();
  const noStem: string[] = [];
  for (const u of out) {
    const stem = directorMediaUrlFileStem(u);
    if (!stem || stem.length < 6) {
      noStem.push(u);
      continue;
    }
    const prev = byStem.get(stem);
    if (!prev) {
      byStem.set(stem, u);
      continue;
    }
    const uKey = directorMediaUrlKey(u) || u;
    const pKey = directorMediaUrlKey(prev) || prev;
    const uLocal = isDirectorLocalMediaUrl(u);
    const pLocal = isDirectorLocalMediaUrl(prev);
    if (uLocal && !pLocal) byStem.set(stem, u);
    else if (pLocal && !uLocal) byStem.set(stem, prev);
    else if (curKey && uKey === curKey) byStem.set(stem, u);
    else if (curKey && pKey === curKey) byStem.set(stem, prev);
    else byStem.set(stem, preferDirectorMediaUrl(prev, u));
  }
  const collapsed = [...noStem, ...byStem.values()];
  // 有本地时优先展示本地；无同名本地的云端成片仍保留（刚生成尚未落盘时切走不会丢）
  const locals = collapsed.filter((u) => isDirectorLocalMediaUrl(u));
  let finalList: string[];
  if (locals.length > 0) {
    finalList = [...locals];
    for (const u of collapsed) {
      if (isDirectorLocalMediaUrl(u)) continue;
      const stem = directorMediaUrlFileStem(u);
      const hasLocalTwin =
        !!stem && locals.some((l) => directorMediaUrlFileStem(l) === stem);
      if (!hasLocalTwin) finalList.push(u);
    }
  } else {
    finalList = collapsed;
  }
  if (cur) {
    const hasCur = finalList.some((u) => isDirectorShotVideoSelection(cur, u));
    if (!hasCur) finalList = [...finalList, cur];
  }
  return finalList.sort((a, b) =>
    (directorMediaUrlKey(a) || a).localeCompare(directorMediaUrlKey(b) || b, 'en'),
  );
}

/** 当前成片是否对应候选（含云端 URL 对上本地同名文件） */
export function isDirectorShotVideoSelection(
  currentUrl: string,
  candidateUrl: string,
): boolean {
  const a = String(currentUrl || '').trim();
  const b = String(candidateUrl || '').trim();
  if (!a || !b) return false;
  if ((directorMediaUrlKey(a) || a) === (directorMediaUrlKey(b) || b)) return true;
  const sa = directorMediaUrlFileStem(a);
  const sb = directorMediaUrlFileStem(b);
  return !!(sa && sb && sa.length >= 6 && sa === sb);
}

export function mergeDirectorShotVideoHistory(
  prev: Pick<DirectorShotStoryboard, 'videoUrl' | 'videoUrlHistory'>,
  nextUrl: string,
): string[] {
  const next = String(nextUrl || '').trim();
  const nextKey = directorMediaUrlKey(next) || next;
  const nextLocal = isDirectorLocalMediaUrl(next);
  const nextStem = directorMediaUrlFileStem(next);
  const prevCur = String(prev.videoUrl || '').trim();
  const prevKey = directorMediaUrlKey(prevCur) || prevCur;
  const prevStem = directorMediaUrlFileStem(prevCur);
  const seen = new Set<string>();
  const out: string[] = [];
  // 切换成片时必须归档上一版（含尚未落盘的云端 URL），否则「刚生成又点了别的」会丢片
  if (prevCur && prevKey && nextKey && prevKey !== nextKey) {
    const sameStemHttpToLocal =
      nextLocal &&
      !isDirectorLocalMediaUrl(prevCur) &&
      !!prevStem &&
      !!nextStem &&
      prevStem === nextStem;
    if (!sameStemHttpToLocal) {
      pushUniqueDirectorMediaUrl(out, seen, prevCur);
    }
  }
  for (const raw of prev.videoUrlHistory || []) {
    const u = String(raw || '').trim();
    const k = directorMediaUrlKey(u) || u;
    if (!u || !k || k === nextKey) continue;
    const stem = directorMediaUrlFileStem(u);
    // 下一版已是同名本地时，丢掉历史里的同名云端中间态
    if (
      nextLocal &&
      nextStem &&
      stem &&
      stem === nextStem &&
      !isDirectorLocalMediaUrl(u)
    ) {
      continue;
    }
    if (nextLocal && nextStem && stem && stem === nextStem && isDirectorLocalMediaUrl(u)) {
      continue;
    }
    pushUniqueDirectorMediaUrl(out, seen, u);
  }
  return out.slice(0, MAX_DIRECTOR_SHOT_VIDEO_HISTORY);
}

/**
 * 同一次生成的 URL 精炼（http → 本地等）：不把中间态推进历史，并清掉历史里的中间 URL。
 */
export function replaceDirectorShotVideoUrlInPlace(
  prev: Pick<DirectorShotStoryboard, 'videoUrl' | 'videoUrlHistory'>,
  nextUrl: string,
): string[] {
  const next = String(nextUrl || '').trim();
  const nextKey = directorMediaUrlKey(next) || next;
  const prevKey = directorMediaUrlKey(String(prev.videoUrl || '').trim()) || '';
  const nextStem = directorMediaUrlFileStem(next);
  const prevStem = directorMediaUrlFileStem(String(prev.videoUrl || '').trim());
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of prev.videoUrlHistory || []) {
    const u = String(raw || '').trim();
    const k = directorMediaUrlKey(u) || u;
    const stem = directorMediaUrlFileStem(u);
    if (!u || !k || k === nextKey || (prevKey && k === prevKey)) continue;
    // 同一次生成精炼：清掉同名云端/旧中间态，其它历史成片（含其它云端版）保留
    if (nextStem && stem && stem === nextStem) continue;
    if (prevStem && stem && stem === prevStem) continue;
    pushUniqueDirectorMediaUrl(out, seen, u);
  }
  return out.slice(0, MAX_DIRECTOR_SHOT_VIDEO_HISTORY);
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
    const videoUrlRaw = String(v.videoUrl || '').trim();
    const videoStatusRaw = String(v.videoStatus || '').trim();
    const videoNodeId = String(v.videoNodeId || '').trim();
    const videoGeneratingStartedAt = Number(v.videoGeneratingStartedAt);
    const imageUrlHistory = Array.isArray(v.imageUrlHistory)
      ? [...new Set(v.imageUrlHistory.map((u) => String(u || '').trim()).filter(Boolean))].filter(
          (u) => u !== String(v.imageUrl || '').trim(),
        )
      : [];
    const videoHistSeen = new Set<string>();
    const videoUrlHistoryRaw = Array.isArray(v.videoUrlHistory)
      ? v.videoUrlHistory
          .map((u) => String(u || '').trim())
          .filter(Boolean)
          .filter((u) => {
            const k = directorMediaUrlKey(u) || u;
            if (!k || videoHistSeen.has(k)) return false;
            videoHistSeen.add(k);
            return true;
          })
      : [];
    // 同名云端+本地只留本地
    const histByStem = new Map<string, string>();
    const histNoStem: string[] = [];
    for (const u of videoUrlHistoryRaw) {
      const stem = directorMediaUrlFileStem(u);
      if (!stem || stem.length < 6) {
        histNoStem.push(u);
        continue;
      }
      const prevU = histByStem.get(stem);
      if (!prevU) {
        histByStem.set(stem, u);
        continue;
      }
      if (isDirectorLocalMediaUrl(u) && !isDirectorLocalMediaUrl(prevU)) histByStem.set(stem, u);
      else if (isDirectorLocalMediaUrl(prevU) && !isDirectorLocalMediaUrl(u)) histByStem.set(stem, prevU);
      else histByStem.set(stem, preferDirectorMediaUrl(prevU, u));
    }
    const videoUrlHistoryCollapsed = [...histNoStem, ...histByStem.values()];
    // 当前若是云端 URL，仅替换为「同文件名」本地副本（勿回退成历史里任意一条，否则重新生成会被旧成片顶掉）
    let videoUrl = videoUrlRaw;
    if (videoUrl && !isDirectorLocalMediaUrl(videoUrl)) {
      const stem = directorMediaUrlFileStem(videoUrl);
      if (stem) {
        const localHit = videoUrlHistoryCollapsed.find(
          (u) => isDirectorLocalMediaUrl(u) && directorMediaUrlFileStem(u) === stem,
        );
        if (localHit) videoUrl = localHit;
      }
    }
    const videoUrlKey = directorMediaUrlKey(videoUrl) || videoUrl;
    const videoUrlHistory = videoUrlHistoryCollapsed.filter((u) => {
      const k = directorMediaUrlKey(u) || u;
      if (!k) return false;
      // 重新生成中允许历史暂存当前成片；其它状态仍去重
      if (k === videoUrlKey && videoStatusRaw !== 'generating') return false;
      return true;
    });
    const videoStatus: DirectorStoryboardStatus =
      videoStatusRaw === 'generating' || videoStatusRaw === 'ready' || videoStatusRaw === 'error'
        ? videoStatusRaw
        : videoUrl
          ? 'ready'
          : 'pending';
    out[shotNo] = {
      imageUrl: String(v.imageUrl || '').trim(),
      ...(imageUrlHistory.length ? { imageUrlHistory } : {}),
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
      ...(videoUrlHistory.length ? { videoUrlHistory } : {}),
      ...(videoUrl || videoStatus !== 'pending' ? { videoStatus } : {}),
      ...(v.videoError ? { videoError: String(v.videoError) } : {}),
      ...(v.storyboardUnseen ? { storyboardUnseen: true } : {}),
      ...(v.videoUnseen ? { videoUnseen: true } : {}),
      ...(typeof v.promptOptimizedUnseen === 'boolean'
        ? { promptOptimizedUnseen: v.promptOptimizedUnseen }
        : String(v.promptOptimized || '').trim()
          ? { promptOptimizedUnseen: true }
          : {}),
      ...(videoNodeId ? { videoNodeId } : {}),
      ...(Number.isFinite(videoGeneratingStartedAt) && videoGeneratingStartedAt > 0
        ? { videoGeneratingStartedAt }
        : {}),
      ...(Number.isFinite(Number(v.promptsSyncedToScriptRevision))
        ? { promptsSyncedToScriptRevision: Math.max(0, Math.floor(Number(v.promptsSyncedToScriptRevision))) }
        : {}),
      ...(v.finalPromptManual === true ? { finalPromptManual: true } : {}),
      ...(v.descManual === true ? { descManual: true } : {}),
      ...(v.framingManual === true ? { framingManual: true } : {}),
      ...(v.lipsyncActionManual === true ? { lipsyncActionManual: true } : {}),
      ...(String(v.promptOriginal || '').trim()
        ? { promptOriginal: String(v.promptOriginal).trim() }
        : {}),
      ...(String(v.promptOptimized || '').trim()
        ? { promptOptimized: String(v.promptOptimized).trim() }
        : {}),
      ...(String(v.promptOptimizedFrom || '').trim()
        ? { promptOptimizedFrom: String(v.promptOptimizedFrom).trim() }
        : {}),
      ...(typeof v.useOptimizedPrompt === 'boolean'
        ? { useOptimizedPrompt: v.useOptimizedPrompt }
        : {}),
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
    if (String(k || '').startsWith('ep:')) continue;
    const kn = String(k || '').trim().replace(/^镜\s*/i, '').replace(/^0+(\d)/, '$1');
    if (kn && kn === norm) return v;
  }
  return undefined;
}

/** 本镜原版 / 优化稿提示词，以及当前生成视频用哪一版 */
export function getDirectorShotPromptVersions(
  shot: Pick<DirectorShot, '最终提示词' | '画面描述'> | null | undefined,
  sb?: Pick<DirectorShotStoryboard, 'promptOriginal' | 'promptOptimized' | 'useOptimizedPrompt'> | null,
): {
  original: string;
  optimized: string;
  useOptimized: boolean;
  active: string;
} {
  const finalText = String(shot?.['最终提示词'] || '').trim();
  const storedOriginal = String(sb?.promptOriginal || '').trim();
  const optimized = String(sb?.promptOptimized || '').trim();
  // 旧逻辑曾把「优化输入」写进 promptOriginal，导致左右两栏相同；若最终提示词仍是用户底稿则优先用它
  let original = storedOriginal;
  if (
    optimized &&
    storedOriginal &&
    storedOriginal === optimized &&
    finalText &&
    finalText !== optimized
  ) {
    original = finalText;
  }
  if (!original) {
    original = finalText || String(shot?.['画面描述'] || '').trim();
  }
  const useOptimized = !!optimized && sb?.useOptimizedPrompt !== false;
  return {
    original,
    optimized,
    useOptimized,
    active: useOptimized ? optimized : original,
  };
}

export function directorDramaStoryboardKey(episodeId: string, shotNo: string): string {
  const ep = String(episodeId || '').trim();
  const no = String(shotNo || '').trim();
  if (!no) return '';
  if (!ep) return no;
  return `ep:${ep}:${no}`;
}

export function resolveDirectorStoryboardStorageKey(
  state: Partial<Pick<DirectorPipelineState, 'mode' | 'activeDramaEpisodeId'>> | null | undefined,
  shotNo: string,
): string {
  const no = String(shotNo || '').trim();
  if (!no) return '';
  if (no.startsWith('ep:')) return no;
  if (state?.mode === 'drama') {
    const ep = String(state.activeDramaEpisodeId || '').trim();
    if (ep) return directorDramaStoryboardKey(ep, no);
  }
  return no;
}

/** 旧工程按镜号存的成片归到第一集，避免第2集读到第1集 */
export function migrateBareDirectorStoryboardsToEpisode(
  boards: Record<string, DirectorShotStoryboard> | undefined,
  episodeId: string,
): Record<string, DirectorShotStoryboard> {
  const ep = String(episodeId || '').trim();
  const src = boards || {};
  if (!ep) return { ...src };
  const next = { ...src };
  for (const [k, v] of Object.entries(src)) {
    const key = String(k || '').trim();
    if (!key || key.startsWith('ep:')) continue;
    const scoped = directorDramaStoryboardKey(ep, key);
    if (!scoped) continue;
    const bareHasVideo = !!String(v?.videoUrl || '').trim();
    const existing = next[scoped];
    if (existing) {
      const epHasVideo = !!String(existing.videoUrl || '').trim();
      // 裸键已有成片、集键仍空/生成中：把成片合并进集键（修复 SUCCESS 写错键）
      if (bareHasVideo && !epHasVideo) {
        const rawSt = String(v.videoStatus || '').trim();
        const videoStatus: DirectorStoryboardStatus =
          rawSt === 'generating' || rawSt === 'ready' || rawSt === 'error' || rawSt === 'pending'
            ? rawSt
            : 'ready';
        next[scoped] = {
          ...existing,
          ...v,
          videoUrl: String(v.videoUrl || '').trim(),
          videoStatus,
          videoError: '',
          videoGeneratingStartedAt: undefined,
        };
      }
      continue;
    }
    if (!v || !(String(v.videoUrl || '').trim() || String(v.imageUrl || '').trim())) continue;
    next[scoped] = v;
  }
  return next;
}

export function getDirectorShotStoryboard(
  state: Pick<DirectorPipelineState, 'storyboardsByShotNo'> &
    Partial<Pick<DirectorPipelineState, 'mode' | 'activeDramaEpisodeId'>>,
  shotNo: string,
): DirectorShotStoryboard {
  const key = resolveDirectorStoryboardStorageKey(state, shotNo);
  const map = state.storyboardsByShotNo || {};
  if (key && map[key]) return map[key];
  if (state.mode === 'drama' && String(state.activeDramaEpisodeId || '').trim()) {
    // 兼容历史误写到裸镜号的成片（SUCCESS 写回未带 episode 前缀时）
    const raw = String(shotNo || '').trim();
    if (raw && !raw.startsWith('ep:') && map[raw]) return map[raw];
    return createEmptyDirectorShotStoryboard();
  }
  const raw = String(shotNo || '').trim();
  const hit =
    (raw ? map[raw] : undefined) || lookupDirectorShotStoryboardForRange(map, raw);
  return hit || createEmptyDirectorShotStoryboard();
}

/** 剧本内容版本 +1（重新生成脚本成功后调用；不改镜头/图/视频） */
export function bumpDirectorScriptContentRevision(
  state: DirectorPipelineState,
): DirectorPipelineState {
  const next = (Number(state.scriptContentRevision) || 0) + 1;
  return createDefaultDirectorPipelineState({
    ...state,
    scriptContentRevision: next,
  });
}

/** 本镜提示词是否相对当前剧本过期 */
export function isDirectorShotPromptsStale(
  state: Pick<DirectorPipelineState, 'scriptContentRevision' | 'storyboardsByShotNo' | 'shots'>,
  shotNo: string,
): boolean {
  const rev = Math.max(0, Math.floor(Number(state.scriptContentRevision) || 0));
  if (rev <= 0) return false;
  const sb = getDirectorShotStoryboard(state, shotNo);
  const synced = sb.promptsSyncedToScriptRevision;
  if (synced == null || !Number.isFinite(Number(synced))) return true;
  return Math.floor(Number(synced)) !== rev;
}

export function countDirectorStalePromptShots(
  state: Pick<DirectorPipelineState, 'scriptContentRevision' | 'storyboardsByShotNo' | 'shots'>,
): number {
  const shots = state.shots || [];
  if (!shots.length) return 0;
  let n = 0;
  for (let i = 0; i < shots.length; i++) {
    const no = String(shots[i]?.['镜号'] || i + 1).trim() || String(i + 1);
    if (isDirectorShotPromptsStale(state, no)) n += 1;
  }
  return n;
}

/** 将全部已有镜头标记为已对齐当前剧本版本（生成镜头表后） */
export function markAllDirectorShotsPromptsSynced(
  state: DirectorPipelineState,
): DirectorPipelineState {
  const rev = Math.max(0, Math.floor(Number(state.scriptContentRevision) || 0));
  const boards = { ...(state.storyboardsByShotNo || {}) };
  (state.shots || []).forEach((shot, i) => {
    const no = String(shot['镜号'] || i + 1).trim() || String(i + 1);
    const prev = boards[no] || createEmptyDirectorShotStoryboard();
    boards[no] = {
      ...prev,
      promptsSyncedToScriptRevision: rev,
    };
    delete boards[no].finalPromptManual;
    delete boards[no].descManual;
    delete boards[no].framingManual;
    delete boards[no].lipsyncActionManual;
  });
  return createDefaultDirectorPipelineState({
    ...state,
    storyboardsByShotNo: boards,
  });
}

/** 单镜标记已对齐；可顺带清手工锁 */
export function markDirectorShotPromptsSynced(
  state: DirectorPipelineState,
  shotNo: string,
  clearManual?: {
    finalPromptManual?: boolean;
    descManual?: boolean;
    framingManual?: boolean;
    lipsyncActionManual?: boolean;
  },
): DirectorPipelineState {
  const key = String(shotNo || '').trim();
  if (!key) return state;
  const rev = Math.max(0, Math.floor(Number(state.scriptContentRevision) || 0));
  const prev = getDirectorShotStoryboard(state, key);
  const next: DirectorShotStoryboard = {
    ...prev,
    promptsSyncedToScriptRevision: rev,
  };
  if (clearManual?.finalPromptManual) delete next.finalPromptManual;
  if (clearManual?.descManual) delete next.descManual;
  if (clearManual?.framingManual) delete next.framingManual;
  if (clearManual?.lipsyncActionManual) delete next.lipsyncActionManual;
  return createDefaultDirectorPipelineState({
    ...state,
    storyboardsByShotNo: {
      ...(state.storyboardsByShotNo || {}),
      [key]: next,
    },
  });
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
  const paceRaw = String(v.shotChangePace || '').trim();
  const shotChangePace: 'fast' | 'normal' | 'slow' =
    paceRaw === 'fast' || paceRaw === 'slow' ? paceRaw : 'normal';
  return {
    url: String(v.url || '').trim(),
    durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0,
    title: String(v.title || '').trim(),
    summary: String(v.summary || '').trim(),
    moodHint: String(v.moodHint || '').trim(),
    // 歌词/署名：勿在 normalize 时 trim。受控输入每次 onChange 经 patch→normalize 会改写 value，
    // 导致光标跳到末尾，并打断中文 IME 组字。
    lyrics: String(v.lyrics || ''),
    ...(v.sourceNodeId ? { sourceNodeId: String(v.sourceNodeId).trim() } : {}),
    lyricSegments,
    lyricSegmentsStatus,
    clipLengthMode,
    shotChangePace,
    ...(v.lyricSegmentsError ? { lyricSegmentsError: String(v.lyricSegmentsError) } : {}),
    ...(v.lyricSegmentsSourceUrl
      ? { lyricSegmentsSourceUrl: String(v.lyricSegmentsSourceUrl).trim() }
      : {}),
    songTitle: String(v.songTitle || ''),
    lyricist: String(v.lyricist || ''),
    composer: String(v.composer || ''),
    lyricAsrWords: Array.isArray(v.lyricAsrWords)
      ? v.lyricAsrWords
          .filter((w) => w && typeof w === 'object')
          .map((w) => ({
            text: String((w as { text?: string }).text || ''),
            startSec: Number((w as { startSec?: number }).startSec) || 0,
            endSec: Number((w as { endSec?: number }).endSec) || 0,
          }))
          .filter((w) => w.text)
      : [],
    asrLanguage: String(v.asrLanguage || 'auto').trim() || 'auto',
    bindRev: Math.max(0, Math.floor(Number(v.bindRev) || 0)),
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

/** AI 短剧 V2：①分集 → ②选集 → ③视觉美术 → ④分析 → ⑤资产生成 → ⑥分镜 → ⑦视频 → ⑧审核 */
export const DRAMA_PHASES: DirectorPhase[] = [
  'ingest',
  'episodes',
  'visual',
  'analyze',
  'assets',
  'board',
  'videos',
  'review',
];
/** MV：确认镜头合并分镜与参考图；跳过独立 prompts/storyboards 步；karaoke 可独立进入（不必先完成视频生成） */
export const MV_PHASES: DirectorPhase[] = [
  'music',
  'story',
  'style',
  'cast',
  'assets',
  'shots',
  'videos',
  'karaoke',
];

export function normalizeDirectorMode(raw: string | undefined | null): DirectorMode {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  // 旧工程 mode=script → 短剧；默认仍为 MV（新建节点习惯）
  if (s === 'drama' || s === 'script') return 'drama';
  return 'mv';
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
  // 短剧 V2 九步映射
  if (mode === 'drama') {
    if (p === 'music' || p === 'karaoke' || p === 'cast') {
      p = 'ingest';
    }
    // MV 的 style 与短剧 visual 不同：旧短剧误标 style → ingest；显式 visual_tuning → visual
    if ((p as string) === 'visual_tuning' || (p as string) === 'visualTuning') p = 'visual';
    if (p === 'style') p = 'ingest';
    if (p === 'story') p = 'analyze';
    // 旧「准备资产」步并入分析确认后直达参考图
    if (p === 'bible') p = 'assets';
    if (p === 'shots' || p === 'prompts' || p === 'storyboards') p = 'board';
    if (p === 'preview') p = 'review';
    if ((p as string) === 'split') p = 'ingest';
    if ((p as string) === 'episode_pick' || (p as string) === 'select') p = 'episodes';
  }
  const allowed = mode === 'mv' ? MV_PHASES : DRAMA_PHASES;
  if ((allowed as string[]).includes(p)) return p;
  return mode === 'mv' ? 'music' : 'ingest';
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
        creatures: [...(partial.assets.creatures || [])],
      }
    : createEmptyDirectorAssets();

  const mode = normalizeDirectorMode(partial?.mode);
  const phase = normalizeDirectorPhase(partial?.phase, mode);

  const assetsStepRaw = String(partial?.assetsStep || '').trim();
  const assetsStep: DirectorAssetsStep =
    assetsStepRaw === 'scenes' ||
    assetsStepRaw === 'props' ||
    assetsStepRaw === 'characters' ||
    assetsStepRaw === 'creatures'
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
    title: String(
      partial?.title ?? (mode === 'mv' ? 'MV导演' : mode === 'drama' ? 'AI短剧导演' : '导演'),
    ),
    stylePresetId,
    globalStyle,
    styleReferenceImageUrl,
    shots: Array.isArray(partial?.shots)
      ? partial!.shots.map((s, i) => ({ ...createEmptyDirectorShot(i), ...s }))
      : [],
    assets,
    storyboardsByShotNo: normalizeDirectorStoryboardsByShotNo(partial?.storyboardsByShotNo),
    activeDramaEpisodeId: String(partial?.activeDramaEpisodeId ?? '').trim(),
    selectedAssetIds: Array.isArray(partial?.selectedAssetIds) ? [...partial!.selectedAssetIds] : [],
    chatModel: String(partial?.chatModel ?? 'gpt-4o'),
    imageModel: String(partial?.imageModel ?? 'rhart-image-g-2'),
    imageAspectRatio: String(partial?.imageAspectRatio ?? '2:1'),
    imageResolution: normalizeDirectorImageResolution(partial?.imageResolution),
    videoBatchModel: String(
      partial?.videoBatchModel ?? (mode === 'drama' ? 'minimax-h3-multi' : 'ltx-2.3-i2v'),
    ),
    videoBatchLipsyncModel: String(
      partial?.videoBatchLipsyncModel ?? 'minimax-h3-audio',
    ),
    videoBatchDuration: String(partial?.videoBatchDuration ?? '10'),
    videoBatchAspectRatio: String(partial?.videoBatchAspectRatio ?? mvAspectRatio),
    videoBatchResolution: String(
      partial?.videoBatchResolution ?? (mode === 'drama' ? '720p' : '1280'),
    ),
    videoBatchLipsyncResolution: String(
      partial?.videoBatchLipsyncResolution ?? partial?.videoBatchResolution ?? '720p',
    ),
    videoBatchModelBeforeLipsync: String(partial?.videoBatchModelBeforeLipsync ?? ''),
    mvMusic: normalizeDirectorMvMusic(partial?.mvMusic),
    mvStoryAnalysis: normalizeDirectorMvStoryAnalysis(partial?.mvStoryAnalysis),
    mvScriptUseReferenceGen: partial?.mvScriptUseReferenceGen !== false,
    mvScriptReference: String(partial?.mvScriptReference ?? ''),
    mvStoryOutline: String(partial?.mvStoryOutline ?? ''),
    mvStoryOutlineConfirmed: !!partial?.mvStoryOutlineConfirmed,
    mvStoryGenreType: String(partial?.mvStoryGenreType ?? '').trim(),
    mvStoryToneStyle: String(partial?.mvStoryToneStyle ?? '').trim(),
    mvStoryEndingType: String(partial?.mvStoryEndingType ?? '').trim(),
    mvCloseUpFraming: partial?.mvCloseUpFraming !== false,
    mvCastPlan: normalizeDirectorMvCastPlan(partial?.mvCastPlan),
    mvAspectRatio,
    linkedSpliceNodeId: String(partial?.linkedSpliceNodeId ?? '').trim(),
    scriptContentRevision: Math.max(
      0,
      Math.floor(Number(partial?.scriptContentRevision) || 0),
    ),
    isGenerating: !!partial?.isGenerating,
    error: String(partial?.error ?? ''),
  };
}
