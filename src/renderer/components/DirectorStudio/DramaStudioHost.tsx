/**
 * AI 短剧导演台 V2 — 用户 4 阶段工作台（挂在 directorDrama 节点壳内）。
 * 剧本(分集) → 画风色调 → 剧本分析(分场/时长) → 素材（匹配）→ 导演分镜 → 成片
 * Domain 仍保留内部 phase，由 userPhase 映射。
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronUp, Coins, Download, Loader2, Pause, Play, Plus, Trash2, X, ZoomIn } from 'lucide-react';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import VoiceMicGlyph from '../Canvas/VoiceMicGlyph';
import { AudioWaveformVisualizer } from '../Canvas/AudioWaveformVisualizer';
import { useCloudRealtimeDictation } from '../../hooks/useCloudRealtimeDictation';
import { useDictationPushToTalk } from '../../hooks/useDictationPushToTalk';
import { micLevelCssVars } from '../../utils/micInputLevel';
import { acquireVoiceModalLock, releaseVoiceModalLock } from '../../utils/voiceModalGate';
import { resolveDramaChatModel } from '../../utils/cloudModelPricing';
import {
  formatCloudLlmUserError,
  isCloudFcTimeoutError,
} from '../../../shared/cloudLlmUserError';
import type { DirectorPipelineState } from '../../../shared/directorPipeline';
import {
  directorMediaUrlKey,
  getDirectorShotStoryboard,
  isDirectorShotVideoSelection,
  listDirectorShotVideos,
  migrateBareDirectorStoryboardsToEpisode,
  remapDramaStoryboardsAfterShotListEdit,
  updateDirectorShotStoryboard,
} from '../../../shared/directorPipeline';
import {
  pickNearestDirectorVideoBatchDuration,
  listDirectorVideoDurationTiersSec,
  directorShotNeedsVideoGeneration,
  getDirectorVideoBatchResolutionOptions,
  normalizeDirectorVideoBatchResolution,
} from '../../utils/directorVideoBatch';
import {
  buildDramaDomainAnalyzeMessages,
  buildDramaDomainAnalyzeCompactMessages,
  buildDramaDomainShotPlanMessages,
  buildMergedNarrativeAndShotPlanMessages,
  buildDramaNarrativePlanning,
  normalizeDramaNarrativePlanningResult,
  buildDramaCharacterDossierMessages,
  parseDramaCharacterDossier,
  applyDramaCharacterDossiersToSession,
  formatDramaCharacterDossierForShotPlan,
  formatDramaCharacterNamesForShotPlan,
  stampDramaShotCastCodes,
  sessionHasDramaCharacterDossier,
  buildDramaShotPlanEnrichMessages,
  parseDramaShotPlanEnrichResult,
  mergeDramaShotPlanEnrich,
  collectUsedSignatureActions,
  DRAMA_SHOT_PLAN_ENRICH_BATCH,
  confirmDramaAnalyze,
  activateDramaEpisode,
  removeDramaEpisode,
  ensureDramaActiveEpisodeWorkingSet,
  confirmDramaAssets,
  unlockDramaAssets,
  invalidateDramaConfirmationsAfter,
  applyDramaLegacyUserFlowNotice,
  dramaStudioNodeTitle,
  stripDramaEpisodeTitleSuffix,
  clearDramaLegacyUserFlowNotice,
  restoreDramaBibleMediaFromPipeline,
  promoteDramaCharacterMasterImages,
  characterHasUsableReference,
  mergeDramaPipelineAssetsFromSession,
  createEmptyDramaCreature,
  createEmptyDramaCharacter,
  createEmptyDramaProjectVisualBible,
  createEmptyDramaProp,
  createEmptyDramaSceneAsset,
  createEmptyDramaSession,
  createEmptyDramaVoice,
  syncDramaSystemVoice,
  resolveDramaSystemVoice,
  stripDramaSystemSpeakerCharacters,
  dramaSessionNeedsSystemVoice,
  suppressDramaSystemVoice,
  ensureVoiceSampleTexts,
  isDramaSystemSpeakerCharacter,
  DRAMA_SYSTEM_SPEAKER_ID,
  applyDramaShotZhPlainOfficialSeal,
  applyDramaShotH3SkillOptimizeResult,
  buildDramaShotH3SkillOptimizeMessages,
  composeDramaShotLensTaggedPrompt,
  resolveDramaProductionH3Prompt,
  sealDramaProductionCloudPrompt,
  resolveDramaShotStoryboardImageUrl,
  resolveDramaShotStoryboardPictureIndex,
  resolveDramaShotVisualStylePrompt,
  isDramaShotH3SkillSealed,
  dramaShotSkillMatchesLocale,
  isDramaAssetMatchDone,
  isDramaDurationSplitDone,
  isDramaSceneSplitDone,
  isDramaVisualStyleLocked,
  dramaManualPipelineBlockReason,
  dedupeDramaPropsByKind,
  listUnusedDramaPropIds,
  listUnusedDramaSceneIds,
  pruneUnusedDramaBibleAssets,
  formatDramaDialogueLines,
  getActiveEpisodeBible,
  getDramaVideoAdapter,
  migrateDramaV1ToDomainV2,
  normalizeDramaDomainAnalyzeResult,
  applyLlmAnalyzeOntoProgramSession,
  resolveSkipLlmAnalyze,
  normalizeDramaShotPlanResult,
  attachDramaShotSuggestions,
  refineDramaShotBudgetFromAnalyze,
  shouldBatchDramaShotPlan,
  splitDramaShotPlanEventBatches,
  scaleDramaShotBudgetForBatch,
  validateDramaShotPlan,
  dramaShotPlanIsAcceptable,
  formatDramaShotPlanValidationError,
  normalizeDramaDomainPhase,
  refreshDramaContinuity,
  refreshDramaPackages,
  setDramaSessionPhase,
  splitNovelIntoEpisodes,
  createEmptyDramaEpisode,
  enrichDramaShotLocally,
  resolveCharacterIdsForShot,
  resolveVoicesForShot,
  listCharactersMissingDesign,
  resolveCharacterMasterReferenceUrl,
  resolveSceneMasterReferenceUrl,
  resolvePropMasterReferenceUrl,
  pickPipelineAssetImage,
  applyDramaSessionAssetImage,
  applyDramaSessionVoiceSample,
  listDramaSupportedVideoModels,
  normalizeDramaSupportedVideoModel,
  resolveDramaShotVideoModel,
  dramaVideoModelRequiresShotAudio,
  ensureAppearingCharactersInBible,
  sortDramaCharactersByAppearanceOrder,
  sortDramaScenesByAppearanceOrder,
  collectSeriesCharacterAppearanceOrder,
  collectOriginalSceneLocationsInOrder,
  isDramaManualCharacterCardName,
  suppressDramaCharacter,
  unsuppressDramaCharacterName,
  composeDramaVoiceSampleLine,
  ensureCharacterCostumes,
  createEmptyDramaCharacterCostume,
  groupDramaCostumesByTag,
  dramaCostumeImageUrl,
  setActiveDramaCharacterCostume,
  activeDramaCostume,
  addBlankDramaCharacterCostume,
  removeDramaCharacterCostume,
  deriveDramaAudioTimelineFromShotEvents,
  dramaShotHasSpokenDialogue,
  applyDramaDirectingBreakdownSession,
  dramaShotDirectingFingerprint,
  domainPhaseToUserPhase,
  preferredDomainPhaseForUserPhase,
  canEnterDramaUserPhase,
  isDramaAnalyzeConfirmed,
  isDramaBoardConfirmed,
  isDramaShotConfirmed,
  isDramaAssetsConfirmed,
  formatDramaShotCastGateError,
  syncDramaShotCharacterIds,
  DRAMA_SHOT_DURATION_TIERS,
  DRAMA_SHOT_VIDEO_DURATION_PARAM,
  snapDramaShotDurationSec,
  resolveDramaGenerateDurationSec,
  alignDramaShotTimelineToGenerateDuration,
  inferDramaDurationSecFromH3Prompt,
  ensureDramaShotTimelineEvents,
  type DramaDirectorSession,
  type DramaDomainPhase,
  type DramaEpisode,
  type DramaShot,
  type DramaShotSuggestion,
  type DramaTimelineEvent,
  type DramaCharacter,
  type DramaCharacterCostume,
  type DramaSceneAsset,
  type DramaVoice,
  removeDramaShotAt,
  insertDramaShotAt,
  planMergeDramaShots,
  convertShotSuggestionsToDramaShots,
  createEmptyDramaEpisodeBible,
  analyzeDramaEpisodeOriginal,
  shotSuggestionsFromDurationSplit,
  applyDramaScriptDesign,
  formatDramaOriginalAnalyzeAlert,
} from '../../../shared/directorDomain';
import {
  NEXFLOW_CANVAS_AUDIO_DRAG_MIME,
  NEXFLOW_CANVAS_IMAGE_DRAG_MIME,
  peekCanvasAudioDragUrl,
  peekCanvasImageDragUrl,
  endCanvasAudioDrag,
  endCanvasImageDrag,
} from '../characterListShared';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import { AnalyzeDirectorWorkspace } from './AnalyzeDirectorWorkspace';
import { DramaShotRefZones } from './DramaShotRefZones'; // 素材区含添加额度卡
import { DramaShotPromptCardSurface, runDramaMultiShotH3SkillMerge } from './DramaExecuteTablePanel';
import { VisualStyleLibrary } from './VisualDNAEditor';
import { ModuleProgressBar } from '../Canvas/ModuleProgressBar';
import { RefImageHoverThumb } from '../Canvas/RefImageHoverThumb';
import {
  yuanbaoHoverTipAboveCls,
  yuanbaoHoverTipBelowCls,
} from '../darkModalShell';
import { toElectronVideoElementSrc } from '../../utils/normalizeVideoUrl';
import { attachAudioPreviewGain, resumeAudioPreviewContext } from '../../utils/audioPreviewGain';
import { resolveMinimaxH3OptimizeStructure } from '../../../shared/minimaxH3OptimizePrompt';
import {
  DramaCharacterLibraryPickModal,
  fillEmptyDramaAssetsFromLibraryPicks,
  loadDramaCastLibraryPicks,
  loadDramaCharacterLibraryPicks,
  pickDramaLibraryImageUrl,
  toDisplayableDramaMediaUrl,
  type DramaLibraryPickItem,
  type DramaLibraryPickMode,
} from './DramaCharacterLibraryPick';

export type DramaAssetVisualKind = 'characters' | 'scenes' | 'props' | 'creatures';

export type DramaStudioHostProps = {
  projectId?: string | null;
  pipeline: DirectorPipelineState;
  session: DramaDirectorSession | null;
  isDark: boolean;
  busy: boolean;
  chatModel: string;
  onSessionChange: (next: DramaDirectorSession) => void;
  onPipelinePatch: (next: DirectorPipelineState) => void;
  runChat: (
    systemPrompt: string,
    userPrompt: string,
    opts?: {
      max_tokens?: number;
      temperature?: number;
      response_format?: unknown;
      model?: string;
      concurrent?: boolean;
      skillOptimize?: boolean;
      onQueueStatus?: (status: import('../../utils/directorConcurrentChatQueue').DirectorConcurrentChatQueueStatus) => void;
      signal?: AbortSignal | null;
    },
  ) => Promise<string>;
  onSpawnVideos?: (opts?: {
    shotNos?: string[];
    startLipsync?: boolean;
    lipsyncShotNos?: string[];
    /** 短剧：覆盖本批视频模型（须为支持的模型） */
    videoModel?: string;
    /** 短剧：按镜号覆盖模型 */
    shotModels?: Record<string, string>;
    /** 短剧：按镜号覆盖上云终稿（与「查看优化稿」一致，避免 setNodes 未刷新） */
    shotPromptOverrides?: Record<string, string>;
  }) => void;
  showAlert: (msg: string) => void;
  /** 按镜头规划时长估算元宝价文案（成片按钮展示） */
  getShotVideoPriceLabel?: (
    durationSec: number,
    opts?: { model?: string; preferLipsync?: boolean },
  ) => string | null;
  /** 「剧本拆分」旁的大语言模型选择器 */
  chatModelSelectSlot?: React.ReactNode;
  /** 资产生成：模型 / 清晰度选择（复用导演台现有生图模型） */
  imageGenToolbarSlot?: React.ReactNode;
  /** 分镜图生图：模型 / 清晰度（不含 4K） */
  storyboardImageGenSlot?: React.ReactNode;
  /** 单张 AI 生图价格文案（如「全能图片 V2 · 1K · 3元宝」） */
  unitImagePriceLabel?: string | null;
  /** 切段 AI 改写 / 合并镜头等 LLM 单次悬停价 */
  unitChatPriceLabel?: string | null;
  /** 一键生成总价文案（按缺失张数） */
  batchImagePriceLabel?: string | null;
  /** AI 生图（按 Domain 资产 id） */
  onGenerateAssetImage?: (kind: DramaAssetVisualKind, assetId: string) => void;
  /** 本镜分镜图（图生图）：force=true 时强制重跑 */
  onGenerateShotStoryboard?: (shotNo: string, opts?: { force?: boolean }) => void;
  /** 本地上传文件 → dataURL / local-resource */
  onUploadAssetImage?: (kind: DramaAssetVisualKind, assetId: string, file: File) => void;
  /** 从画布点选图片 */
  onPickAssetFromCanvas?: (kind: DramaAssetVisualKind, assetId: string) => void;
  canPickFromCanvas?: boolean;
  /** 清除参考图 */
  onClearAssetImage?: (kind: DramaAssetVisualKind, assetId: string) => void;
  /**
   * 资产生图 / 声音生成进行中的 id（来自导演台 imageGenProgressIds + voiceGenProgressIds）。
   * 用于即时绿条，不依赖 Domain status 是否已写回。
   */
  assetGeneratingIds?: Record<string, true>;
  /** 成片生成中的镜号（即时绿条 + 防连点） */
  videoGeneratingIds?: Record<string, true>;
  onMarkVideoGenerating?: (shotNo: string, on: boolean) => void;
  /** 放弃等待：仅解除本地生成中态，不撤回已扣费任务 */
  onAbandonVideoWait?: (shotNo: string) => void;
  /** 声音：豆包音频单价文案 */
  unitVoicePriceLabel?: string | null;
  /** 声音：一键生成剩余条数总价 */
  batchVoicePriceLabel?: string | null;
  canPickVoiceFromCanvas?: boolean;
  onGenerateVoice?: (voiceId: string) => void;
  /** 声音：一键生成（一次性标记进度并写回 Domain，避免逐条互踩） */
  onGenerateVoices?: (voiceIds: string[]) => void;
  onUploadVoice?: (voiceId: string, file: File) => void;
  onPickVoiceFromCanvas?: (voiceId: string) => void;
  /** 本镜声音：豆包 1.0（对白+环境音，挂角色参考音） */
  onGenerateShotAudio?: (shotId: string) => void;
  /** 本镜声音：放弃本地生成中等待（不撤回云端任务） */
  onAbandonShotAudio?: (shotId: string) => void;
  /** 成片：按镜头顺序写入画布剪辑模块 */
  onVideosToSplice?: () => void;
  /** 分镜卡切换历史成片后，同步替换已入轨片段 */
  onApplyShotVideoToSplice?: (shotNo: string, videoUrl: string) => void;
};

function shellCls(isDark: boolean) {
  return isDark ? 'text-white/90' : 'text-gray-900';
}

function mutedCls(isDark: boolean) {
  return isDark ? 'text-white/50' : 'text-gray-500';
}

function cardCls(isDark: boolean) {
  return isDark
    ? 'rounded-xl border border-white/10 bg-white/[0.04]'
    : 'rounded-xl border border-gray-200 bg-white';
}

function inputCls(isDark: boolean) {
  return isDark
    ? 'w-full rounded-lg border border-white/12 bg-black/35 px-3 py-2.5 text-[14px] leading-relaxed text-white/90 outline-none'
    : 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-[14px] leading-relaxed text-gray-900 outline-none';
}

/** 原生 select：暗色下拉（Electron/Win 需 color-scheme + option 底色） */
function darkSelectCls(extra = '') {
  return `nodrag rounded-md border border-white/15 bg-[#1c1c1e] py-0.5 font-medium text-white outline-none [color-scheme:dark] ${extra}`;
}

export const DramaStudioHost: React.FC<DramaStudioHostProps> = ({
  projectId,
  pipeline,
  session: sessionProp,
  isDark,
  busy,
  chatModel,
  onSessionChange,
  onPipelinePatch,
  runChat,
  onSpawnVideos,
  showAlert,
  getShotVideoPriceLabel,
  chatModelSelectSlot,
  imageGenToolbarSlot,
  storyboardImageGenSlot,
  unitImagePriceLabel,
  unitChatPriceLabel,
  batchImagePriceLabel,
  onGenerateAssetImage,
  onGenerateShotStoryboard,
  onUploadAssetImage,
  onPickAssetFromCanvas,
  canPickFromCanvas,
  onClearAssetImage,
  assetGeneratingIds,
  videoGeneratingIds,
  onMarkVideoGenerating,
  onAbandonVideoWait,
  unitVoicePriceLabel,
  batchVoicePriceLabel,
  canPickVoiceFromCanvas,
  onGenerateVoice,
  onGenerateVoices,
  onUploadVoice,
  onPickVoiceFromCanvas,
  onGenerateShotAudio,
  onAbandonShotAudio,
  onVideosToSplice,
  onApplyShotVideoToSplice,
}) => {
  const { showConfirm } = useDarkAlert();
  const session = useMemo(() => {
    const hasPersistedDomain = !!(
      sessionProp?.shots?.length ||
      sessionProp?.bible?.characters?.length ||
      sessionProp?.episodes?.length ||
      sessionProp?.meta?.source_novel ||
      sessionProp?.meta?.source_script ||
      sessionProp?.meta?.analyze_confirmed ||
      Number(sessionProp?.meta?.board_confirmed_at || 0) > 0
    );

    let base: DramaDirectorSession;
    if (hasPersistedDomain) {
      // sessionProp 已由写回链路规范化，直接引用避免每次深重建（否则视频生成进度对账会卡死/OOM）
      base = sessionProp as DramaDirectorSession;
    } else if ((pipeline.shots || []).length > 0) {
      // 仅当 V1 镜头表有真实数据时才迁移；空 pipeline 不得虚构分集
      base = migrateDramaV1ToDomainV2(pipeline);
    } else if (sessionProp) {
      // 新建空 Domain：原样保留，不要再从 pipeline 自动分集
      base = createEmptyDramaSession({
        ...sessionProp,
        episodes: sessionProp.episodes || [],
        active_episode_id: sessionProp.active_episode_id || '',
        meta: {
          ...(sessionProp.meta || {}),
          phase: sessionProp.meta?.phase || 'episodes',
          source_novel: String(sessionProp.meta?.source_novel || ''),
          source_script: String(sessionProp.meta?.source_script || ''),
          analyze_confirmed: false,
          board_confirmed_at: 0,
          assets_confirmed_at: 0,
        },
      });
    } else {
      base = createEmptyDramaSession({
        meta: {
          phase: 'episodes',
          analyze_confirmed: false,
          board_confirmed_at: 0,
          assets_confirmed_at: 0,
        },
      });
    }

    // 自动分集只走「画布连线 / 用户粘贴上传」；此处不再根据 pipeline 文本偷偷灌分集
    return applyDramaLegacyUserFlowNotice(base);
  }, [sessionProp, pipeline]);

  // 最新 session 引用：分析等异步任务写回时读取用户当前停留的 phase，避免完成后强制拽回
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const [draftNovel, setDraftNovel] = useState(
    () =>
      session.meta.source_novel ||
      session.meta.source_script ||
      pipeline.mvScriptReference ||
      pipeline.scriptText ||
      '',
  );
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzingHint, setAnalyzingHint] = useState('正在策划本集…');
  const [splitting, setSplitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  /** 本集正文：右侧条展开，避免占满主工作区 */
  const [scriptDrawerOpen, setScriptDrawerOpen] = useState(false);
  /** 选集页：点开卡片改正文 */
  const [episodeEditorId, setEpisodeEditorId] = useState<string | null>(null);
  const [episodeEditorDraft, setEpisodeEditorDraft] = useState('');
  const [episodeEditorTitle, setEpisodeEditorTitle] = useState('');
  const novelFileRef = useRef<HTMLInputElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seededEpisodesRef = useRef(false);

  const episodes = session.episodes || [];
  const activeEpisode = useMemo(() => {
    const id = String(session.active_episode_id || '').trim();
    if (id) return episodes.find((e) => e.episode_id === id) || null;
    return episodes[0] || null;
  }, [episodes, session.active_episode_id]);

  const [episodeDraft, setEpisodeDraft] = useState(() => activeEpisode?.text || '');
  /** 选集页「+」：就地录入新一集正文（第二级），不跳回整本分集（第一级） */
  const [draftNewEpisode, setDraftNewEpisode] = useState<{
    title: string;
    text: string;
  } | null>(null);
  useLayoutEffect(() => {
    setEpisodeDraft(activeEpisode?.text || '');
  }, [activeEpisode?.episode_id, activeEpisode?.text]);

  // 懒分集结果写回落盘（仅当本节点已产生分集，且不是被旁路误灌的空→满）
  useEffect(() => {
    if (!episodes.length) return;
    if (sessionProp?.episodes?.length) return;
    // 仅在用户本会话刚分出集时写回；避免空台被外部灌入后循环固化
    if (!seededEpisodesRef.current) {
      seededEpisodesRef.current = true;
      onSessionChange(session);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodes.length, session.meta.source_novel]);

  // 接入文本变化时同步编辑框
  useEffect(() => {
    const pipeScript = String(pipeline.scriptText || '').trim();
    if (!pipeScript) return;
    if (pipeScript === draftNovel.trim()) return;
    if (pipeScript === String(session.meta.source_novel || '').trim() || !episodes.length) {
      setDraftNovel(pipeScript);
    }
  }, [pipeline.scriptText, draftNovel, session.meta.source_novel, episodes.length]);

  const phase = normalizeDramaDomainPhase(session.meta.phase);
  const userPhase = domainPhaseToUserPhase(phase);

  const videoBoardSyncFpRef = useRef('');
  useEffect(() => {
    videoBoardSyncFpRef.current = '';
  }, [sessionProp]);

  // 画布出片写回 storyboardsByShotNo 后，同步到 Domain 每镜 video_url（分镜卡右侧成片槽）
  useEffect(() => {
    const map = pipeline.storyboardsByShotNo || {};
    if (!Object.keys(map).length || !(session.shots || []).length) return;

    let changed = false;
    const nextShots = session.shots.map((s) => {
      const sb = getDirectorShotStoryboard(pipeline, s.shot_no);
      const url = String(sb.videoUrl || '').trim();
      const status = String(sb.videoStatus || '').trim();
      const nodeId = String(sb.videoNodeId || '').trim();
      const ownUrl = String(s.video_url || '').trim();
      const ownStatus = String(s.video_status || '').trim();
      const ownNode = String(s.video_node_id || '').trim();

      if (!url && !status && !nodeId) return s;

      // 空槽：仅在本镜已点生成（generating）或画布已有成片时同步，避免误捡其他镜成片
      if (!ownUrl && !ownNode) {
        const boardReady = !!url && status !== 'generating' && status !== 'queued';
        const waiting = ownStatus === 'generating' || ownStatus === 'queued';
        if (!waiting && !boardReady) return s;
      }

      const writeUrl = url || ownUrl;
      const writeNode = nodeId || ownNode;
      const shotNoKey = String(s.shot_no || '').trim();
      const marked = !!(shotNoKey && videoGeneratingIds?.[shotNoKey]);
      const ownBusy = ownStatus === 'generating' || ownStatus === 'queued';
      // 画布表仍 generating/queued：本镜还在跑，保留进度。
      // 绿条仍在 / Domain 仍 generating：禁止被「旧成片 + ready」抢先收条。
      // 绿条已清且画布表 ready：收成 ready（SUCCESS 真出片）。
      const boardBusy = status === 'generating' || status === 'queued';
      const boardReadyDone =
        !!url && !boardBusy && (status === 'ready' || (!status && !!url));
      const writeStatus = boardBusy
        ? status === 'queued'
          ? 'queued'
          : 'generating'
        : marked
          ? 'generating'
          : ownBusy && !boardReadyDone
            ? ownStatus === 'queued'
              ? 'queued'
              : 'generating'
            : boardReadyDone
              ? 'ready'
              : status || (url ? 'ready' : ownStatus);

      if (writeUrl === ownUrl && writeStatus === ownStatus && writeNode === ownNode) {
        return s;
      }

      changed = true;
      return {
        ...s,
        video_url: writeUrl,
        video_status: writeStatus,
        video_node_id: writeNode,
      };
    });
    if (!changed) return;

    const fingerprint = nextShots
      .map(
        (s) =>
          `${String(s.shot_no || '').trim()}:${String(s.video_url || '').trim()}:${String(s.video_status || '').trim()}:${String(s.video_node_id || '').trim()}`,
      )
      .join('|');
    if (videoBoardSyncFpRef.current === fingerprint) return;
    videoBoardSyncFpRef.current = fingerprint;

    onSessionChange({ ...session, shots: nextShots });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeline.storyboardsByShotNo, videoGeneratingIds]);

  const patchSession = useCallback(
    (
      next: DramaDirectorSession,
      opts?: {
        storyboardsByShotNo?: DirectorPipelineState['storyboardsByShotNo'];
        /** 步骤切换等未改动 bible 资产时跳过 V2→V1 资产投影，避免卡顿 */
        skipAssetsProjection?: boolean;
      },
    ) => {
      const seriesName = stripDramaEpisodeTitleSuffix(next.bible?.project?.name || '');
      const cleaned =
        seriesName && seriesName !== String(next.bible?.project?.name || '').trim()
          ? {
              ...next,
              bible: {
                ...next.bible,
                project: { ...next.bible.project, name: seriesName },
              },
            }
          : next;
      const resolvedChat =
        String(pipeline.chatModel || '').trim() ||
        String(cleaned.meta.chatModel || '').trim() ||
        String(chatModel || '').trim();
      const withChat = {
        ...cleaned,
        meta: { ...cleaned.meta, chatModel: resolvedChat },
      };
      // 分析页单元格编辑很频繁：勿每次深拷贝整会话，否则输入会卡死
      if ((window as any).__patchTraceN == null) (window as any).__patchTraceN = 0;
      if ((window as any).__patchTraceN < 4) {
        (window as any).__patchTraceN += 1;
        console.log(
          `[perf] patchSession#${(window as any).__patchTraceN} 调用堆栈:`,
          new Error().stack,
        );
      }
      const __perfOnSessionChangeStart = performance.now();
      onSessionChange(withChat);
      console.log('[perf] onSessionChange耗时(ms)', (performance.now() - __perfOnSessionChangeStart).toFixed(1));
      // 同步 onPipelinePatch 让 React 18 自动批处理，避免步骤切换渲染两次
      {
        const __perfOnPipelinePatchStart = performance.now();
        const pipePhase =
          withChat.meta.phase === 'ingest'
            ? 'ingest'
            : withChat.meta.phase === 'episodes'
              ? 'episodes'
              : withChat.meta.phase === 'visual'
                ? 'visual'
                : withChat.meta.phase === 'analyze'
                  ? 'analyze'
                  : withChat.meta.phase === 'bible' || withChat.meta.phase === 'assets'
                    ? 'assets'
                    : withChat.meta.phase === 'board' || withChat.meta.phase === 'videos'
                      ? 'board'
                      : 'review';
        const boardsSrc =
          opts?.storyboardsByShotNo != null
            ? opts.storyboardsByShotNo
            : pipeline.storyboardsByShotNo;
        // Domain 已标 generating 时，禁止用旧 ready 画布表盖掉绿条（重生成闪一下就灭）
        let boardsNext = boardsSrc;
        {
          let boardState = { ...pipeline, storyboardsByShotNo: boardsSrc };
          for (const s of withChat.shots || []) {
            const no = String(s.shot_no || '').trim();
            const vst = String(s.video_status || '').trim();
            if (!no || (vst !== 'generating' && vst !== 'queued')) continue;
            const prevSb = getDirectorShotStoryboard(boardState, no);
            boardState = updateDirectorShotStoryboard(boardState, no, {
              videoStatus: vst === 'queued' ? 'queued' : 'generating',
              videoError: '',
              videoGeneratingStartedAt:
                Number(prevSb.videoGeneratingStartedAt) > 0
                  ? Number(prevSb.videoGeneratingStartedAt)
                  : Date.now(),
            });
          }
          boardsNext = boardState.storyboardsByShotNo;
        }
        onPipelinePatch({
          ...pipeline,
          phase: pipePhase as DirectorPipelineState['phase'],
          title: dramaStudioNodeTitle(withChat),
          mvScriptReference: withChat.meta.source_script || pipeline.mvScriptReference,
          chatModel: resolvedChat,
          globalStyle:
            next.meta.globalStyle ||
            next.bible?.project?.visual_style ||
            next.bible?.project?.style ||
            pipeline.globalStyle,
          stylePresetId: next.meta.stylePresetId || pipeline.stylePresetId,
          styleReferenceImageUrl:
            next.meta.styleReferenceImageUrl || pipeline.styleReferenceImageUrl,
          mvAspectRatio: (next.meta.aspect_ratio === '16:9' ||
          next.meta.aspect_ratio === '9:16' ||
          next.meta.aspect_ratio === '3:4' ||
          next.meta.aspect_ratio === '4:3'
            ? next.meta.aspect_ratio
            : pipeline.mvAspectRatio || '9:16') as DirectorPipelineState['mvAspectRatio'],
          videoBatchAspectRatio:
            next.meta.aspect_ratio || pipeline.videoBatchAspectRatio || pipeline.mvAspectRatio,
          videoBatchModel: (() => {
            const raw = String(next.meta.videoBatchModel || pipeline.videoBatchModel || '').trim();
            // Domain 可把「默认=对口型」记在 videoBatchModel；Pipeline 普通档需非口型 id
            if (raw === 'minimax-h3-audio' || raw.includes('lipsync')) return 'minimax-h3-multi';
            return raw || 'minimax-h3-multi';
          })(),
          videoBatchLipsyncModel:
            next.meta.videoBatchLipsyncModel ||
            pipeline.videoBatchLipsyncModel ||
            'minimax-h3-audio',
          videoBatchResolution: normalizeDirectorVideoBatchResolution(
            'minimax-h3-multi',
            next.meta.videoBatchResolution || pipeline.videoBatchResolution || '720p',
          ),
          videoBatchLipsyncResolution: normalizeDirectorVideoBatchResolution(
            'minimax-h3-audio',
            next.meta.videoBatchLipsyncResolution ||
              next.meta.videoBatchResolution ||
              pipeline.videoBatchLipsyncResolution ||
              '720p',
          ),
          isGenerating: next.meta.isGenerating,
          error: next.meta.error,
          activeDramaEpisodeId: withChat.active_episode_id || '',
          assets: opts?.skipAssetsProjection
            ? pipeline.assets
            : mergeDramaPipelineAssetsFromSession(withChat, pipeline.assets),
          storyboardsByShotNo: migrateBareDirectorStoryboardsToEpisode(
            boardsNext,
            String(
              withChat.active_episode_id || withChat.episodes?.[0]?.episode_id || '',
            ).trim(),
          ),
        });
        console.log('[perf] onPipelinePatch耗时(ms)', (performance.now() - __perfOnPipelinePatchStart).toFixed(1));
      }
    },
    [onSessionChange, onPipelinePatch, pipeline, chatModel],
  );

  useEffect(() => {
    const next = ensureDramaActiveEpisodeWorkingSet(session);
    if (next === session) return;
    patchSession(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.active_episode_id]);

  // 旧流程可能停在「导演分镜」且未确认素材：自动拉回素材准备
  const migratedAssetsFirstRef = useRef(false);
  useEffect(() => {
    if (migratedAssetsFirstRef.current) return;
    if (!isDramaAnalyzeConfirmed(session)) return;
    if (isDramaAssetsConfirmed(session)) return;
    if (phase !== 'board' && phase !== 'videos' && phase !== 'review') return;
    migratedAssetsFirstRef.current = true;
    patchSession(
      createEmptyDramaSession({
        ...session,
        meta: {
          ...session.meta,
          phase: 'assets',
          board_confirmed_at: 0,
          needs_stage_reconfirm: true,
        },
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, session.meta.analyze_confirmed, session.meta.assets_confirmed_at]);

  const migratedVideosIntoBoardRef = useRef(false);
  useEffect(() => {
    if (migratedVideosIntoBoardRef.current) return;
    if (phase !== 'videos') return;
    if (!isDramaAssetsConfirmed(session)) return;
    migratedVideosIntoBoardRef.current = true;
    patchSession(
      createEmptyDramaSession({
        ...session,
        meta: { ...session.meta, phase: 'board' },
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, session.meta.assets_confirmed_at]);

  // 落盘 debounce：空台不写旁路，避免新建节点把工程里已有短剧会话冲掉
  useEffect(() => {
    if (!projectId || !window.electronAPI?.directorV2SaveSession) return;
    const isEmptyShell =
      !(session.episodes || []).length &&
      !(session.shots || []).length &&
      !String(session.meta.source_novel || '').trim() &&
      !String(session.meta.source_script || '').trim() &&
      !(session.bible?.characters || []).length &&
      !session.meta.analyze_confirmed;
    if (isEmptyShell) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void window.electronAPI.directorV2SaveSession(projectId, session);
    }, 800);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [projectId, session]);

  // 仅「节点上还没有 directorDomain」的旧节点才从工程旁路恢复。
  // 新建空台已带空 Domain，禁止用同工程旧 session.json 覆盖（否则会看到别人的分集剧本）。
  useEffect(() => {
    if (!projectId || !window.electronAPI?.directorV2LoadSession) return;
    if (sessionProp != null) return;
    let cancelled = false;
    void (async () => {
      const res = await window.electronAPI.directorV2LoadSession(projectId);
      if (cancelled || !res?.ok || !res.session) return;
      onSessionChange(createEmptyDramaSession(res.session as DramaDirectorSession));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (phase !== 'ingest') return;
    if (draftNovel.trim()) return;
    const linked =
      session.meta.source_novel ||
      pipeline.mvScriptReference ||
      pipeline.scriptText ||
      '';
    if (linked.trim()) setDraftNovel(linked);
  }, [
    phase,
    draftNovel,
    session.meta.source_novel,
    pipeline.mvScriptReference,
    pipeline.scriptText,
  ]);

  useEffect(() => {
    if (phase !== 'analyze') setScriptDrawerOpen(false);
  }, [phase]);

  const goPhase = (p: DramaDomainPhase, opts?: { session?: DramaDirectorSession }) => {
    const __perfGoPhaseStart = performance.now();
    const live = opts?.session || session;
    let target = p === 'videos' ? 'board' : p;
    const targetUser = domainPhaseToUserPhase(target);

    // 用户阶段门禁（不挡剧本内部子步：ingest/visual/episodes/analyze）
    if (
      targetUser !== 'script' ||
      target === 'board' ||
      target === 'assets' ||
      target === 'review'
    ) {
      if (targetUser !== 'script') {
        const gate = canEnterDramaUserPhase(live, targetUser);
        if (!gate.ok) {
          showAlert(gate.reason);
          target = preferredDomainPhaseForUserPhase(gate.fallback, live);
        }
      }
    }

    // 剧本内部前置：分集 → 画风色调 → 剧本分析；素材/分镜前须锁风格
    if (
      (target === 'analyze' || target === 'assets' || target === 'board' || target === 'visual') &&
      !(live.episodes || []).length
    ) {
      showAlert('请先接入或粘贴剧本并完成分集');
      target = 'ingest';
    } else if (
      (target === 'analyze' || target === 'assets' || target === 'board' || target === 'visual') &&
      !(live.active_episode_id || '').trim()
    ) {
      showAlert('请先选择要制作的一集');
      target = 'episodes';
    } else if (
      (target === 'analyze' || target === 'assets' || target === 'board') &&
      !isDramaVisualStyleLocked(live)
    ) {
      showAlert('请先完成「画风 + 色调」锁定整片风格，再做剧本分析');
      target = 'visual';
    }

    // 进画风色调：须已分集并选集
    if (target === 'visual') {
      const gate = canEnterDramaUserPhase(live, 'visual');
      if (!gate.ok) {
        showAlert(gate.reason);
        target = preferredDomainPhaseForUserPhase(gate.fallback, live);
      }
    }

    // 进素材：须已时长拆镜（拆镜完成即视为确认，不再单独点确认）
    if (target === 'assets') {
      const block = dramaManualPipelineBlockReason(live, 'assets');
      if (block) {
        showAlert(block);
        target = 'analyze';
      } else if (!isDramaAnalyzeConfirmed(live) && isDramaDurationSplitDone(live)) {
        // 旧项目仅拆镜未点确认：进素材时自动确认
      } else if (!isDramaAnalyzeConfirmed(live)) {
        showAlert('请先完成「时长拆镜」，再进入素材准备');
        target = 'analyze';
      }
    }

    // 进分镜：须已素材匹配
    if (target === 'board') {
      const block = dramaManualPipelineBlockReason(live, 'board');
      if (block) {
        showAlert(block);
        target =
          isDramaAnalyzeConfirmed(live) || isDramaDurationSplitDone(live) ? 'assets' : 'analyze';
      }
    }

    // 进成片：有分镜即可（不再要求确认导演表）
    if (target === 'review') {
      const gate = canEnterDramaUserPhase(live, 'final');
      if (!gate.ok) {
        showAlert(gate.reason);
        target = preferredDomainPhaseForUserPhase(gate.fallback, live);
      }
    }

    let base = ensureDramaActiveEpisodeWorkingSet(live);
    if (target === 'assets' && !isDramaAnalyzeConfirmed(base) && isDramaDurationSplitDone(base)) {
      base = confirmDramaAnalyze(base);
    }
    // 返回剧本阶段修改：解除素材/导演表确认（分析确认保留，直到重新分析）
    if (
      (target === 'ingest' ||
        target === 'visual' ||
        target === 'episodes' ||
        target === 'analyze') &&
      (isDramaBoardConfirmed(live) || isDramaAssetsConfirmed(live))
    ) {
      base = invalidateDramaConfirmationsAfter(
        live,
        target === 'visual' ? 'visual' : 'assets',
      );
      showAlert('已返回剧本阶段：后续「素材」确认已解除，修改后请重新确认');
    }

    // 从分镜退回素材：清导演表确认标记（素材确认保留，可继续补图）
    if (
      target === 'assets' &&
      isDramaBoardConfirmed(base) &&
      domainPhaseToUserPhase(live.meta.phase) !== 'assets'
    ) {
      base = invalidateDramaConfirmationsAfter(base, 'board');
    }
    let next = setDramaSessionPhase(base, target);
    if (target === 'board' && !isDramaAssetsConfirmed(next)) {
      if (!isDramaAssetMatchDone(next)) {
        showAlert('请先在素材准备完成「素材匹配」');
        next = setDramaSessionPhase(base, 'assets');
        patchSession(next, { skipAssetsProjection: true });
        return;
      }
      next = confirmDramaAssets(next);
    }
    if (target === 'board' || target === 'review') next = refreshDramaContinuity(next);
    // packages 进入分镜页不被 UI 读取，出片时（spawnOneShot/spawnAllShots）会重新刷新；此处不再预热整批 package，避免步骤切换卡顿
    // 步骤切换不改 bible 资产，跳过 V2→V1 资产投影
    console.log('[perf] goPhase 处理耗时(ms)', (performance.now() - __perfGoPhaseStart).toFixed(1));
    patchSession(next, { skipAssetsProjection: true });
    console.log('[perf] goPhase 总耗时含patchSession(ms)', (performance.now() - __perfGoPhaseStart).toFixed(1));
    requestAnimationFrame(() => {
      console.log('[perf] goPhase→首帧渲染完成(ms)', (performance.now() - __perfGoPhaseStart).toFixed(1));
    });
  };

  const openEpisodeEditor = (ep: DramaEpisode) => {
    setEpisodeEditorId(ep.episode_id);
    setEpisodeEditorDraft(String(ep.text || ''));
    setEpisodeEditorTitle(String(ep.title || `第${ep.episode_no}集`));
  };

  const closeEpisodeEditor = (save: boolean) => {
    const id = episodeEditorId;
    if (save && id) {
      const text = episodeEditorDraft.trim();
      const title = episodeEditorTitle.trim() || undefined;
      const nextEps = episodes.map((e) =>
        e.episode_id === id
          ? {
              ...e,
              text,
              ...(title ? { title } : {}),
              updated_at: Date.now(),
              analyzed: text === String(e.text || '').trim() ? e.analyzed : false,
            }
          : e,
      );
      patchSession({
        ...session,
        episodes: nextEps,
        active_episode_id: id,
        meta: {
          ...session.meta,
          source_script: text,
        },
      });
      setEpisodeDraft(text);
    }
    setEpisodeEditorId(null);
  };

  /** 保存编辑器正文后立刻进入该集分析（同一份 session，避免竞态） */
  const saveEpisodeEditorAndAnalyze = () => {
    const id = episodeEditorId;
    if (!id) return;
    const text = episodeEditorDraft.trim();
    const title = episodeEditorTitle.trim();
    const nextEps = episodes.map((e) =>
      e.episode_id === id
        ? {
            ...e,
            text,
            ...(title ? { title } : {}),
            updated_at: Date.now(),
            analyzed: text === String(e.text || '').trim() ? e.analyzed : false,
          }
        : e,
    );
    const ep = nextEps.find((e) => e.episode_id === id);
    if (!ep) {
      setEpisodeEditorId(null);
      return;
    }
    let base = {
      ...session,
      episodes: nextEps,
      active_episode_id: id,
      meta: { ...session.meta, source_script: text, phase: 'analyze' as const },
    };
    if (activeEpisode && activeEpisode.episode_id !== id && episodeDraft !== activeEpisode.text) {
      base = {
        ...base,
        episodes: base.episodes.map((e) =>
          e.episode_id === activeEpisode.episode_id
            ? { ...e, text: episodeDraft.trim(), updated_at: Date.now() }
            : e,
        ),
      };
    }
    const next = setDramaSessionPhase(
      activateDramaEpisode(base, id),
      'analyze',
    );
    setEpisodeEditorId(null);
    setEpisodeDraft(text);
    patchSession(next);
  };

  const deleteEpisodeCard = async (ep: DramaEpisode) => {
    const ok = await showConfirm(
      `确定删除「${ep.title || `第${ep.episode_no}集`}」？该集正文与分析稿将一并清除，不可恢复。`,
    );
    if (!ok) return;
    if (episodeEditorId === ep.episode_id) {
      setEpisodeEditorId(null);
    }
    const next = removeDramaEpisode(session, ep.episode_id);
    patchSession(next);
    const nextActive = next.episodes.find((e) => e.episode_id === next.active_episode_id);
    setEpisodeDraft(nextActive?.text || '');
  };

  /** 选集后进入画风色调；剧本分析在风格锁定之后 */
  const openEpisodeNextToVisual = (ep: DramaEpisode) => {
    let base = session;
    if (activeEpisode && episodeDraft !== activeEpisode.text) {
      base = {
        ...session,
        episodes: session.episodes.map((e) =>
          e.episode_id === activeEpisode.episode_id
            ? { ...e, text: episodeDraft.trim(), updated_at: Date.now() }
            : e,
        ),
      };
    }
    const isCurrent = !!activeEpisode && activeEpisode.episode_id === ep.episode_id;
    const targetText = (isCurrent ? episodeDraft : String(ep.text || '')).trim();
    if (!targetText) {
      showAlert('这一集还没有正文');
      return;
    }
    const next = setDramaSessionPhase(
      activateDramaEpisode(
        {
          ...base,
          meta: { ...base.meta, source_script: targetText, phase: 'visual' },
        },
        ep.episode_id,
      ),
      'visual',
    );
    setEpisodeDraft(targetText);
    patchSession(next);
  };

  const formatEpisodeUpdated = (ts?: number) => {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}/${m}/${day}`;
    } catch {
      return '';
    }
  };

  const startInlineNewEpisode = () => {
    const nextNo =
      episodes.reduce((max, e) => Math.max(max, Number(e.episode_no) || 0), 0) + 1;
    setDraftNewEpisode({ title: `第${nextNo}集`, text: '' });
  };

  const cancelInlineNewEpisode = () => setDraftNewEpisode(null);

  const commitInlineNewEpisode = () => {
    if (!draftNewEpisode) return;
    const text = String(draftNewEpisode.text || '').trim();
    if (!text) {
      showAlert('请先粘贴或输入本集剧本正文');
      return;
    }
    const nextNo =
      episodes.reduce((max, e) => Math.max(max, Number(e.episode_no) || 0), 0) + 1;
    const title =
      String(draftNewEpisode.title || '').trim() || `第${nextNo}集`;
    const ep = createEmptyDramaEpisode({
      episode_no: nextNo,
      title,
      text,
      updated_at: Date.now(),
    });
    const prevNovel = String(session.meta.source_novel || '').trim();
    const novelBlock = `【${title}】\n${text}`;
    const nextNovel = prevNovel ? `${prevNovel}\n\n${novelBlock}` : novelBlock;
    patchSession({
      ...session,
      episodes: [...episodes, ep],
      active_episode_id: ep.episode_id,
      meta: {
        ...session.meta,
        source_novel: nextNovel,
        source_script: text,
        phase: 'episodes',
      },
    });
    setEpisodeDraft(text);
    setDraftNewEpisode(null);
  };

  const commitEpisodeText = useCallback(
    (text: string, episodeId?: string) => {
      const id = episodeId || activeEpisode?.episode_id;
      if (!id) return;
      const nextEps = episodes.map((e) =>
        e.episode_id === id
          ? { ...e, text: text.trim(), updated_at: Date.now() }
          : e,
      );
      patchSession({
        ...session,
        episodes: nextEps,
        active_episode_id: id,
        meta: {
          ...session.meta,
          source_script: text.trim(),
        },
      });
    },
    [activeEpisode?.episode_id, episodes, patchSession, session],
  );

  const ingestNovelAndSplit = useCallback(
    (raw: string) => {
      const novel = String(raw || '').trim();
      if (!novel) {
        showAlert('请先粘贴小说/剧本，或拖入 .txt 文件');
        return;
      }
      setSplitting(true);
      try {
        const eps = splitNovelIntoEpisodes(novel);
        if (!eps.length) {
          showAlert('未能分出有效集数，请检查文本');
          return;
        }
        setDraftNovel(novel);
        patchSession({
          ...session,
          episodes: eps,
          active_episode_id: eps[0].episode_id,
          meta: {
            ...session.meta,
            source_novel: novel,
            source_script: eps[0].text,
            analyze_confirmed: false,
            phase: 'episodes',
          },
        });
        setEpisodeDraft(eps[0].text);
        showAlert(`已分成 ${eps.length} 集，可去选集；点「下一步」先锁画风色调，再做剧本分析`);
        goPhase('episodes');
      } finally {
        setSplitting(false);
      }
    },
    [patchSession, session, showAlert, goPhase],
  );

  // 仅在「粘贴页」且确有新接入文本时自动分集；空台不捏造内容
  const lastAutoSplitScriptRef = useRef('');
  useEffect(() => {
    if (phase !== 'ingest') return;
    const linked = String(pipeline.scriptText || pipeline.mvScriptReference || '').trim();
    if (!linked) return;
    if (linked === lastAutoSplitScriptRef.current) return;
    const novel = String(session.meta.source_novel || '').trim();
    if (novel === linked && (session.episodes || []).length > 0) {
      lastAutoSplitScriptRef.current = linked;
      return;
    }
    if ((session.shots || []).length || (session.bible?.characters || []).length) {
      lastAutoSplitScriptRef.current = linked;
      return;
    }
    lastAutoSplitScriptRef.current = linked;
    ingestNovelAndSplit(linked);
  }, [
    phase,
    pipeline.scriptText,
    pipeline.mvScriptReference,
    session.meta.source_novel,
    session.episodes,
    session.shots,
    session.bible?.characters,
    ingestNovelAndSplit,
  ]);

  const readTxtFile = async (file: File | null) => {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!name.endsWith('.txt') && file.type && !file.type.startsWith('text/')) {
      showAlert('目前仅支持 .txt 文本文件');
      return;
    }
    try {
      const text = await file.text();
      setDraftNovel(text);
      ingestNovelAndSplit(text);
    } catch (e) {
      showAlert(e instanceof Error ? e.message : '读取文件失败');
    }
  };

  const selectEpisode = (ep: DramaEpisode) => {
    let base = session;
    if (activeEpisode && episodeDraft !== activeEpisode.text) {
      base = {
        ...session,
        episodes: session.episodes.map((e) =>
          e.episode_id === activeEpisode.episode_id
            ? { ...e, text: episodeDraft.trim(), updated_at: Date.now() }
            : e,
        ),
      };
    }
    const targetText = String(ep.text || '').trim();
    patchSession(
      activateDramaEpisode(
        {
          ...base,
          meta: { ...base.meta, source_script: targetText },
        },
        ep.episode_id,
      ),
    );
    setEpisodeDraft(targetText);
  };

  const runDramaJsonChat = async (
    sys: string,
    user: string,
    extra?: { max_tokens?: number },
  ) => {
    const baseChatOpts = {
      max_tokens: extra?.max_tokens || 16384,
      temperature: 0.35,
    };
    try {
      return await runChat(sys, user, {
        ...baseChatOpts,
        response_format: { type: 'json_object' as const },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/response_format|json_object|unsupported|不支持/i.test(msg)) {
        return await runChat(sys, user, baseChatOpts);
      }
      throw err;
    }
  };

  const planShotsFromSession = async (
    analyzedSession: DramaDirectorSession,
    source: string,
    analyzeTitle: string,
    styleHint: string,
    extraRetryHint?: string,
  ) => {
    const events = getActiveEpisodeBible(analyzedSession).visual_events || [];
    const beats = analyzedSession.scene_beats || [];
    if (!events.length) {
      throw new Error('还没有 Visual Events，请先点「剧本拆分」');
    }
    const shotBudget = refineDramaShotBudgetFromAnalyze(
      source,
      events,
      beats,
      analyzedSession.meta.shotPlanPaceGear,
    );
    const characterDossier = formatDramaCharacterDossierForShotPlan(
      getActiveEpisodeBible(analyzedSession).directing_notes,
    );
    const characterNamesLocal = formatDramaCharacterNamesForShotPlan(
      (analyzedSession.bible.characters || []).map((c) => c.name),
      getActiveEpisodeBible(analyzedSession).directing_notes,
    );
    const sceneNamesLocal = (analyzedSession.bible.scenes || []).map((s) => s.name || s.location);
    const propNamesLocal = (analyzedSession.bible.props || []).map((pp) => pp.name);
    const creatureNamesLocal = (analyzedSession.bible.creatures || []).map((cc) => cc.name);
    const epBibleLocal = getActiveEpisodeBible(analyzedSession);
    const wantBatch = shouldBatchDramaShotPlan({ events, sourceText: source });
    let shotIntents = epBibleLocal.shot_intents || [];
    let narrativeBeats = epBibleLocal.narrative_beats || [];
    let mergedPlanned: ReturnType<typeof normalizeDramaShotPlanResult> | null = null;
    let usedBatch = wantBatch;
    if (!wantBatch && events.length > 0 && shotIntents.length === 0) {
      try {
        const mergedMsgs = buildMergedNarrativeAndShotPlanMessages({
          title: analyzeTitle,
          styleHint,
          budget: shotBudget,
          sourceText: source,
          visualEvents: events,
          sceneBeats: beats,
          characterNames: characterNamesLocal,
          sceneNames: sceneNamesLocal,
          propNames: propNamesLocal,
          creatureNames: creatureNamesLocal,
          characterDossier,
          retryHint: extraRetryHint,
          paceGear: analyzedSession.meta.shotPlanPaceGear,
        });
        const mergedText = await runDramaJsonChat(mergedMsgs.systemPrompt, mergedMsgs.userPrompt);
        const nbResult = normalizeDramaNarrativePlanningResult(mergedText);
        const shotResult = normalizeDramaShotPlanResult(mergedText, beats);
        if (nbResult.shot_intents.length > 0 && shotResult.ok) {
          shotIntents = nbResult.shot_intents;
          narrativeBeats = nbResult.narrative_beats;
          epBibleLocal.shot_intents = shotIntents;
          epBibleLocal.narrative_beats = narrativeBeats;
          epBibleLocal.director_beats = nbResult.director_beats;
          mergedPlanned = shotResult;
        }
      } catch (err) {
        if (isCloudFcTimeoutError(err)) usedBatch = true;
      }
    }
    if (!usedBatch && events.length > 0 && shotIntents.length === 0) {
      try {
        const nbMsgs = buildDramaNarrativePlanning({
          sourceText: source,
          visualEvents: events,
          sceneBeats: beats,
        });
        const nbText = await runDramaJsonChat(nbMsgs.systemPrompt, nbMsgs.userPrompt);
        const nbResult = normalizeDramaNarrativePlanningResult(nbText);
        if (nbResult.shot_intents.length > 0) {
          shotIntents = nbResult.shot_intents;
          narrativeBeats = nbResult.narrative_beats;
          epBibleLocal.shot_intents = shotIntents;
          epBibleLocal.narrative_beats = narrativeBeats;
          epBibleLocal.director_beats = nbResult.director_beats;
        }
      } catch (err) {
        if (isCloudFcTimeoutError(err)) usedBatch = true;
      }
    }
    const runShotPlanOnce = async (opts: {
      visualEvents: typeof events;
      sceneBeats: typeof beats;
      sourceScript: string;
      budget: typeof shotBudget;
      retryHint?: string;
      maxTokens?: number;
    }) => {
      const msgs = buildDramaDomainShotPlanMessages({
        title: analyzeTitle,
        styleHint,
        budget: opts.budget,
        visualEvents: opts.visualEvents,
        sceneBeats: opts.sceneBeats,
        characterNames: characterNamesLocal,
        sceneNames: sceneNamesLocal,
        propNames: propNamesLocal,
        creatureNames: creatureNamesLocal,
        characterDossier,
        retryHint: opts.retryHint,
        paceGear: analyzedSession.meta.shotPlanPaceGear,
        shotIntents: shotIntents.length > 0 ? shotIntents : undefined,
        sourceScript: opts.sourceScript,
      });
      const shotText = await runDramaJsonChat(msgs.systemPrompt, msgs.userPrompt, {
        max_tokens: opts.maxTokens,
      });
      return normalizeDramaShotPlanResult(shotText, opts.sceneBeats);
    };
    const runShotPlan = async (retryHint?: string) =>
      runShotPlanOnce({
        visualEvents: events,
        sceneBeats: beats,
        sourceScript: source,
        budget: shotBudget,
        retryHint,
      });
    const runShotPlanBatched = async (retryHint?: string) => {
      const batches = splitDramaShotPlanEventBatches({
        events,
        beats,
        sourceText: source,
        characterNames: (analyzedSession.bible.characters || []).map((c) => c.name),
      });
      const all: DramaShotSuggestion[] = [];
      let lastError = '';
      for (const batch of batches) {
        setAnalyzingHint(
          `正在生成分镜脚本（${batch.index + 1}/${batch.total}）…`,
        );
        const budget = scaleDramaShotBudgetForBatch(
          shotBudget,
          batch.events.length,
          events.length,
        );
        const hint = [
          retryHint,
          `本批只覆盖这些 visual_events：${batch.events.map((e) => e.event_id).join('、')}。不要写其他场次。`,
        ]
          .filter(Boolean)
          .join('\n');
        try {
          let part = await runShotPlanOnce({
            visualEvents: batch.events,
            sceneBeats: batch.beats,
            sourceScript: batch.sourceText,
            budget,
            retryHint: hint,
            maxTokens: 8192,
          });
          if (!part.ok) {
            part = await runShotPlanOnce({
              visualEvents: batch.events,
              sceneBeats: batch.beats,
              sourceScript: batch.sourceText,
              budget,
              retryHint: `只输出含 shots 数组的完整 JSON，每镜必须带 event_ids。\n${hint}`,
              maxTokens: 8192,
            });
          }
          if (part.ok) all.push(...part.suggestions);
          else lastError = part.error;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err || '分批失败');
          if (!isCloudFcTimeoutError(err)) throw err;
        }
      }
      if (!all.length) {
        throw new Error(
          lastError || '脚本设计分批生成均失败（云端超时）。请再点「脚本设计」。',
        );
      }
      all.forEach((s, i) => {
        s.shot = String(i + 1);
      });
      return { ok: true as const, suggestions: all, rawJson: '' };
    };
    let planned: ReturnType<typeof normalizeDramaShotPlanResult>;
    if (usedBatch) {
      planned = await runShotPlanBatched(extraRetryHint);
    } else {
      try {
        planned = mergedPlanned ? mergedPlanned : await runShotPlan(extraRetryHint);
        if (!mergedPlanned && !planned.ok) {
          planned = await runShotPlan('只输出含 shots 数组的完整 JSON，每镜必须带 event_ids。');
        }
        if (!planned.ok) throw new Error(planned.error);
      } catch (err) {
        if (!isCloudFcTimeoutError(err)) throw err;
        usedBatch = true;
        setAnalyzingHint('整集分镜超时，改为按场次分批生成…');
        planned = await runShotPlanBatched(extraRetryHint);
      }
    }
    if (!planned.ok) throw new Error(planned.error);

    let validation = validateDramaShotPlan({
      suggestions: planned.suggestions,
      visualEvents: events,
      sceneBeats: beats,
      budget: shotBudget,
      paceGear: analyzedSession.meta.shotPlanPaceGear,
      sourceScript: source,
    });
    if (!usedBatch && !validation.ok) {
      planned = await runShotPlan(formatDramaShotPlanValidationError(validation));
      if (!planned.ok) throw new Error(planned.error);
      validation = validateDramaShotPlan({
        suggestions: planned.suggestions,
        visualEvents: events,
        sceneBeats: beats,
        budget: shotBudget,
        paceGear: analyzedSession.meta.shotPlanPaceGear,
        sourceScript: source,
      });
    }
    if (
      !usedBatch &&
      validation.dialogueCompleteness &&
      validation.dialogueCompleteness.missingLines.length > 0
    ) {
      planned = await runShotPlan(formatDramaShotPlanValidationError(validation));
      if (planned.ok) {
        validation = validateDramaShotPlan({
          suggestions: planned.suggestions,
          visualEvents: events,
          sceneBeats: beats,
          budget: shotBudget,
          paceGear: analyzedSession.meta.shotPlanPaceGear,
          sourceScript: source,
        });
      }
    }
    if (!validation.ok && !dramaShotPlanIsAcceptable(validation, shotBudget, analyzedSession.meta.shotPlanPaceGear)) {
      if (!(planned.suggestions || []).length) {
        throw new Error(formatDramaShotPlanValidationError(validation));
      }
      // 有草稿先收下，避免分析页「分镜脚本」空白
      const draftSuggestions = stampDramaShotCastCodes(
        planned.suggestions,
        getActiveEpisodeBible(analyzedSession).directing_notes,
      );
      return {
        planned: { ...planned, suggestions: draftSuggestions },
        validation,
        shotBudget,
        events,
        beats,
        incomplete: true as const,
      };
    }
    let suggestions = stampDramaShotCastCodes(
      planned.suggestions,
      getActiveEpisodeBible(analyzedSession).directing_notes,
    );
    if (characterDossier) {
      suggestions = await enrichShotSuggestionsWithDossier(
        suggestions,
        characterDossier,
        analyzeTitle,
        analyzedSession.meta.shotPlanPaceGear,
      );
      suggestions = stampDramaShotCastCodes(
        suggestions,
        getActiveEpisodeBible(analyzedSession).directing_notes,
      );
    }
    return {
      planned: { ...planned, suggestions },
      validation,
      shotBudget,
      events,
      beats,
      incomplete: false as const,
    };
  };

  const enrichShotSuggestionsWithDossier = async (
    skeleton: DramaShotSuggestion[],
    dossierJson: string,
    analyzeTitle: string,
    paceGear?: string,
  ): Promise<DramaShotSuggestion[]> => {
    const dossier = String(dossierJson || '').trim();
    if (!dossier || !skeleton?.length) return skeleton;
    let current = skeleton;
    const batch = DRAMA_SHOT_PLAN_ENRICH_BATCH;
    for (let i = 0; i < current.length; i += batch) {
      const slice = current.slice(i, i + batch);
      setAnalyzingHint(
        `正在按人设加厚分镜 ${i + 1}–${Math.min(i + batch, current.length)}…`,
      );
      const msgs = buildDramaShotPlanEnrichMessages({
        title: analyzeTitle,
        dossierJson: dossier,
        shots: slice,
        usedSignatureActions: collectUsedSignatureActions(current.slice(0, i)),
        paceGear,
      });
      try {
        const text = await runDramaJsonChat(msgs.systemPrompt, msgs.userPrompt);
        const patch = parseDramaShotPlanEnrichResult(text);
        if (patch.length) current = mergeDramaShotPlanEnrich(current, patch);
      } catch {
        /* 单批失败保留骨架 */
      }
    }
    return current;
  };

  const handleAnalyze = async () => {
    const epId = String(activeEpisode?.episode_id || session.active_episode_id || '').trim();
    const epFresh =
      (session.episodes || []).find((e) => e.episode_id === epId) || activeEpisode || null;
    if (!epId || !epFresh) {
      showAlert(episodes.length ? '请先选择一集' : '请先上传/粘贴剧本并分集');
      return;
    }
    // 草稿仅当不像「另一集的原文」时才收进本集；否则强制用本集已存正文（防切集后草稿残留）
    const draft = episodeDraft.trim();
    const stored = String(epFresh.text || '').trim();
    const draftIsOtherEpisode = (session.episodes || []).some(
      (e) =>
        e.episode_id !== epId &&
        draft &&
        draft === String(e.text || '').trim(),
    );
    const source = (draftIsOtherEpisode ? stored : draft || stored).trim();
    if (!source) {
      showAlert(episodes.length ? '当前集正文为空' : '请先上传/粘贴剧本并分集');
      return;
    }
    if (!episodes.length) {
      showAlert('请先点击「入库并分集」');
      return;
    }
    if (analyzing || busy) return;
    setAnalyzing(true);
    setAnalyzingHint('正在分析剧本结构…');
    try {
      // 不要在开头清空分镜：校验失败时否则会留下空白表
      const workingEpisodes = (session.episodes || []).map((e) =>
        e.episode_id === epId ? { ...e, text: source, updated_at: Date.now() } : e,
      );
      commitEpisodeText(source, epId);
      const epTitle = String(epFresh.title || '').trim() || '本集';
      const analyzeTitle = `${stripDramaEpisodeTitleSuffix(session.bible.project.name || '短剧') || '短剧'} · ${epTitle}`;
      const styleHint = pipeline.globalStyle || session.bible.project.visual_style;
      const sourceChars = source.replace(/\s+/g, '').length;

      // ===== 原文保真分析（本地切分 + 素材绑定，不调 LLM，不生成分镜） =====
      setAnalyzingHint('正在切分原文场景与片段…');
      let workingBible = session.bible;
      try {
        const castPicks = await loadDramaCastLibraryPicks(projectId);
        if (castPicks.length) {
          workingBible = fillEmptyDramaAssetsFromLibraryPicks(
            { ...session, bible: workingBible },
            castPicks,
          ).session.bible;
        }
      } catch {
        /* 本剧人物库回填失败不挡分析 */
      }
      setAnalyzingHint('正在绑定人物 / 声音 / 场景素材…');
      const originalAnalyzed = analyzeDramaEpisodeOriginal({
        source,
        episodeId: epId,
        characters: workingBible.characters || [],
        scenes: workingBible.scenes || [],
        voices: workingBible.voices || [],
        visualBible: workingBible.projectVisualBible,
      });
      const prevBible = session.episode_bibles?.[epId] || createEmptyDramaEpisodeBible({ episode_id: epId });
      let analyzedSession = {
        ...session,
        bible: workingBible,
        active_episode_id: epId,
        scene_beats: originalAnalyzed.scene_beats.length ? originalAnalyzed.scene_beats : session.scene_beats,
        episodes: workingEpisodes.map((e) =>
          e.episode_id === epId
            ? { ...e, visual_events: originalAnalyzed.visual_events, official_scene_beats: originalAnalyzed.scene_beats, text: source, updated_at: Date.now() }
            : e,
        ),
        episode_bibles: {
          ...(session.episode_bibles || {}),
          [epId]: createEmptyDramaEpisodeBible({
            ...prevBible,
            visual_events: originalAnalyzed.visual_events,
            official_scene_beats: originalAnalyzed.scene_beats,
            original_scenes: originalAnalyzed.original_scenes,
            original_segments: originalAnalyzed.original_segments,
            character_bindings: originalAnalyzed.character_bindings,
            voice_bindings: originalAnalyzed.voice_bindings,
            scene_bindings: originalAnalyzed.scene_bindings,
            visual_bible_binding: originalAnalyzed.visual_bible_binding,
            original_integrity: originalAnalyzed.integrity,
            analysis_summary: originalAnalyzed.summary,
            shot_suggestions: originalAnalyzed.shot_suggestions,
            style_preset_id:
              originalAnalyzed.visual_bible_binding.style_id || String(prevBible.style_preset_id || '').trim(),
            scene_split_at: Date.now(),
            duration_split_at: 0,
            asset_match_at: 0,
            updated_at: Date.now(),
          }),
        },
        meta: {
          ...session.meta,
          source_script: source,
          source_novel: session.meta.source_novel || draftNovel,
          chatModel: String(pipeline.chatModel || chatModel || '').trim(),
          globalStyle: pipeline.globalStyle,
          styleReferenceImageUrl: pipeline.styleReferenceImageUrl,
          stylePresetId: pipeline.stylePresetId,
          videoBatchModel: pipeline.videoBatchModel,
        },
      };
      // 原文分割 / 真实 LLM：开关保留。生产可设 VITE_SKIP_LLM_ANALYZE=true 恢复跳过。
      // P1-A1 灰度验收临时默认 false（见 skipLlmAnalyze.ts）。
      const SKIP_LLM_ANALYZE = resolveSkipLlmAnalyze(
        (import.meta as { env?: { VITE_SKIP_LLM_ANALYZE?: string } }).env?.VITE_SKIP_LLM_ANALYZE,
      );
      if (!SKIP_LLM_ANALYZE) {
      const originalSegments = getActiveEpisodeBible(analyzedSession).original_segments || [];
      const preferCompactFirst = sourceChars >= 1200;
      const fullMsgs = buildDramaDomainAnalyzeMessages({
        sourceText: source,
        title: analyzeTitle,
        styleHint,
        existingCharacterNames: (analyzedSession.bible.characters || []).map((c) => c.name),
        existingSceneNames: (analyzedSession.bible.scenes || []).map((s) => s.name || s.location),
        originalSegments,
      });
      const compactMsgs = buildDramaDomainAnalyzeCompactMessages({
        sourceText: source,
        title: analyzeTitle,
        styleHint,
        originalSegments,
      });
      const baseChatOpts = {
        max_tokens: preferCompactFirst ? 8192 : 16384,
        temperature: 0.35,
      };
      const runAnalyzeChat = async (sys: string, user: string, jsonMode: boolean) => {
        try {
          return await runChat(sys, user, {
            ...baseChatOpts,
            ...(jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (jsonMode && /response_format|json_object|unsupported|不支持/i.test(msg)) {
            return await runChat(sys, user, baseChatOpts);
          }
          throw err;
        }
      };
      const isAnalyzeTransient = (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        return (
          isCloudFcTimeoutError(msg) ||
          /status code 502|status code 503|status code 504|Bad Gateway|HTTP 502|HTTP 503|Function timed out|timed out after/i.test(
            msg,
          )
        );
      };
      let text: string;
      const first = preferCompactFirst ? compactMsgs : fullMsgs;
      const second = preferCompactFirst ? fullMsgs : compactMsgs;
      if (preferCompactFirst) setAnalyzingHint('正文较长，使用精简分析…');
      try {
        text = await runAnalyzeChat(first.systemPrompt, first.userPrompt, true);
      } catch (err) {
        if (!isAnalyzeTransient(err)) throw err;
        setAnalyzingHint(
          preferCompactFirst ? '精简分析超时，改用完整提示重试…' : '云端超时，改用精简分析重试…',
        );
        text = await runAnalyzeChat(second.systemPrompt, second.userPrompt, true);
      }
      const baseForNormalize = analyzedSession;
      let normalized = normalizeDramaDomainAnalyzeResult(text, baseForNormalize);
      if (!normalized.ok) {
        const compact = buildDramaDomainAnalyzeCompactMessages({
          sourceText: source,
          title: analyzeTitle,
          styleHint,
          originalSegments,
        });
        text = await runAnalyzeChat(compact.systemPrompt, compact.userPrompt, true);
        normalized = normalizeDramaDomainAnalyzeResult(text, baseForNormalize);
      }
      if (!normalized.ok) {
        const compact = buildDramaDomainAnalyzeCompactMessages({
          sourceText: source,
          title: analyzeTitle,
          styleHint,
          originalSegments,
        });
        text = await runAnalyzeChat(
          compact.systemPrompt,
          `${compact.userPrompt}\n\n必须输出完整 JSON，含 characters、scene_beats、visual_events，以 } 结束。`,
          false,
        );
        normalized = normalizeDramaDomainAnalyzeResult(text, baseForNormalize);
      }
      if (!normalized.ok) throw new Error(normalized.error);
      analyzedSession = applyLlmAnalyzeOntoProgramSession(analyzedSession, normalized.session);
      } // end if (!SKIP_LLM_ANALYZE)

      const nextEps = workingEpisodes.map((e) =>
        e.episode_id === epId
          ? { ...e, text: source, analyzed: true, updated_at: Date.now() }
          : e,
      );
      let nextSession = createEmptyDramaSession({
        ...analyzedSession,
        episodes: nextEps,
        active_episode_id: epId,
        meta: {
          ...analyzedSession.meta,
          source_script: source,
          source_novel: session.meta.source_novel || draftNovel,
          chatModel: String(pipeline.chatModel || chatModel || analyzedSession.meta.chatModel || '').trim(),
          phase: sessionRef.current.meta.phase,
          analyze_confirmed: false,
          board_confirmed_at: 0,
          assets_confirmed_at: 0,
        },
        bible: {
          ...analyzedSession.bible,
          confirmed_at: 0,
        },
      });
      const converted = convertShotSuggestionsToDramaShots(nextSession);
      nextSession = {
        ...nextSession,
        shots: converted.shots,
        scene_beats: converted.scene_beats.length ? converted.scene_beats : nextSession.scene_beats,
      };
      // 分场后立刻从原文说话人补建人物/声音卡（不依赖 LLM 是否返回 characters）
      nextSession = ensureAppearingCharactersInBible(nextSession);
      const castN = (nextSession.bible.characters || []).filter(
        (c) => !isDramaSystemSpeakerCharacter(c),
      ).length;
      patchSession(nextSession);
      showAlert(
        `${formatDramaOriginalAnalyzeAlert(
          epTitle,
          originalAnalyzed.summary,
          originalAnalyzed.integrity,
          originalAnalyzed.shot_suggestions.length,
        )}${castN ? `\n已识别人物 ${castN} 人（可在素材准备生成定妆图）。` : '\n未识别到可建卡人物，请检查正文是否有「姓名：/姓名道」等说话人格式。'}`,
      );
    } catch (e) {
      showAlert(formatCloudLlmUserError(e));
    } finally {
      setAnalyzing(false);
      setAnalyzingHint('正在策划本集…');
    }
  };

  const handleDurationSplit = async () => {
    const epId = String(activeEpisode?.episode_id || session.active_episode_id || '').trim();
    if (!epId) {
      showAlert(episodes.length ? '请先选择一集' : '请先上传/粘贴剧本并分集');
      return;
    }
    const bible = getActiveEpisodeBible(session);
    if (!(bible.original_scenes || []).length || !(bible.original_segments || []).length) {
      showAlert('请先点「剧本拆分」，再按时长拆成 15 秒镜');
      return;
    }
    if (analyzing || busy) return;
    const existing = bible.shot_suggestions?.length || 0;
    if (existing) {
      const ok = await showConfirm(
        '将按估时拆镜：6/10/15 档允许约 35% 误差；同场短镜自动凑档。完成后直接进入素材准备。确定？',
      );
      if (!ok) return;
    }
    setAnalyzing(true);
    setAnalyzingHint('正在按时长拆镜…');
    try {
      const epFresh =
        (session.episodes || []).find((e) => e.episode_id === epId) || activeEpisode || null;
      const source = String(epFresh?.text || '').trim();
      const suggestions = shotSuggestionsFromDurationSplit({
        original_scenes: bible.original_scenes || [],
        original_segments: bible.original_segments || [],
        visual_events: bible.visual_events || [],
        source,
      });
      let nextSession = {
        ...session,
        active_episode_id: epId,
        episode_bibles: {
          ...(session.episode_bibles || {}),
          [epId]: createEmptyDramaEpisodeBible({
            ...bible,
            shot_suggestions: suggestions,
            duration_split_at: Date.now(),
            asset_match_at: 0,
            updated_at: Date.now(),
          }),
        },
        meta: {
          ...session.meta,
          analyze_confirmed: false,
          board_confirmed_at: 0,
          assets_confirmed_at: 0,
        },
      };
      const converted = convertShotSuggestionsToDramaShots(nextSession);
      nextSession = {
        ...nextSession,
        shots: converted.shots,
        scene_beats: converted.scene_beats.length ? converted.scene_beats : nextSession.scene_beats,
      };
      const confirmed = confirmDramaAnalyze(nextSession);
      patchSession(confirmed);
      const tierCounts = [6, 10, 15, 20]
        .map((t) => `${t}秒 ${suggestions.filter((s) => Number(s.duration_sec) === t).length}`)
        .join(' / ');
      showAlert(`时长拆镜完成：${suggestions.length} 段原文（${tierCounts}）。已进入素材准备，可继续「素材匹配」。`);
      goPhase('assets', { session: confirmed });
    } catch (e) {
      showAlert(formatCloudLlmUserError(e));
    } finally {
      setAnalyzing(false);
      setAnalyzingHint('正在策划本集…');
    }
  };

  const handleRegenerateShotPlan = async () => {
    const epId = String(activeEpisode?.episode_id || session.active_episode_id || '').trim();
    if (!epId) {
      showAlert(episodes.length ? '请先选择一集' : '请先上传/粘贴剧本并分集');
      return;
    }
    const block = dramaManualPipelineBlockReason(session, 'asset_match');
    if (block && !isDramaDurationSplitDone(session)) {
      showAlert(block);
      return;
    }
    const bible = getActiveEpisodeBible(session);
    if (!(bible.shot_suggestions || []).length) {
      showAlert('请先完成「时长拆镜」，再做素材匹配');
      return;
    }
    if (analyzing || busy) return;
    const hasDesign = (bible.shot_suggestions || []).some(
      (s) => String(s.asset_match || '').trim() || String(s.visual_style || '').trim(),
    );
    if (hasDesign) {
      const ok = await showConfirm(
        '将按当前角色/场景/声音素材与已选视觉风格重挂脚本（小说原文不改）。确定？',
      );
      if (!ok) return;
    }
    setAnalyzing(true);
    setAnalyzingHint('正在素材匹配…');
    try {
      const designed = applyDramaScriptDesign(session, bible.shot_suggestions || []);
      let nextSession = attachDramaShotSuggestions(session, designed, epId);
      const converted = convertShotSuggestionsToDramaShots(nextSession);
      const epBible = getActiveEpisodeBible(nextSession);
      nextSession = {
        ...nextSession,
        shots: converted.shots,
        scene_beats: converted.scene_beats.length ? converted.scene_beats : nextSession.scene_beats,
        episode_bibles: {
          ...(nextSession.episode_bibles || {}),
          [epId]: createEmptyDramaEpisodeBible({
            ...epBible,
            shot_suggestions: designed,
            asset_match_at: Date.now(),
            updated_at: Date.now(),
          }),
        },
      };
      nextSession = ensureAppearingCharactersInBible(nextSession);
      nextSession = invalidateDramaConfirmationsAfter(nextSession, 'asset_match');
      patchSession(nextSession);
      const styleOk = designed.some((s) => String(s.visual_style || '').trim());
      showAlert(
        styleOk
          ? `素材匹配完成：${designed.length} 段已挂人物/场景/声音与视觉风格。可确认进入导演分镜。`
          : `素材匹配完成：${designed.length} 段已挂素材。可确认素材后进入导演分镜。`,
      );
    } catch (e) {
      showAlert(formatCloudLlmUserError(e));
    } finally {
      setAnalyzing(false);
      setAnalyzingHint('正在策划本集…');
    }
  };

  const handleRegenerateCharacterDossier = async () => {
    const epId = String(activeEpisode?.episode_id || session.active_episode_id || '').trim();
    const epFresh =
      (session.episodes || []).find((e) => e.episode_id === epId) || activeEpisode || null;
    if (!epId || !epFresh) {
      showAlert(episodes.length ? '请先选择一集' : '请先上传/粘贴剧本并分集');
      return;
    }
    const draft = episodeDraft.trim();
    const stored = String(epFresh.text || '').trim();
    const draftIsOtherEpisode = (session.episodes || []).some(
      (e) =>
        e.episode_id !== epId &&
        draft &&
        draft === String(e.text || '').trim(),
    );
    const source = (draftIsOtherEpisode ? stored : draft || stored).trim();
    if (!source) {
      showAlert(episodes.length ? '当前集正文为空' : '请先上传/粘贴剧本并分集');
      return;
    }
    if (!(session.bible.characters || []).length) {
      showAlert('还没有角色名单，请先点「剧本拆分」');
      return;
    }
    if (analyzing || busy) return;
    const ok = await showConfirm(
      '将按剧本重写所有出场角色的标准化人设（外貌定妆图不改）。确定？',
    );
    if (!ok) return;
    setAnalyzing(true);
    setAnalyzingHint('正在生成人设…');
    try {
      const analyzeTitle = `${stripDramaEpisodeTitleSuffix(session.bible.project.name || '短剧') || '短剧'} · ${
        epFresh.title || '本集'
      }`;
      const msgs = buildDramaCharacterDossierMessages({
        sourceText: source,
        title: analyzeTitle,
        existingCharacters: (session.bible.characters || []).map((c) => ({
          name: c.name,
          role: c.role,
          identity: c.identity,
          personality: c.personality,
          age: c.age,
        })),
        retryHint:
          '这是重新生成：不要复制上一版措辞；欲望/恐惧/标志性动作必须能被镜头执行。',
      });
      const text = await runDramaJsonChat(msgs.systemPrompt, msgs.userPrompt);
      const parsed = parseDramaCharacterDossier(text);
      if (!parsed.length) throw new Error('人设解析失败，请换模型后重试');
      let next = applyDramaCharacterDossiersToSession(
        {
          ...session,
          active_episode_id: epId,
          meta: { ...session.meta, source_script: source },
        },
        parsed,
        epId,
      );
      const bibleNow = getActiveEpisodeBible(next);
      const dossierJson = formatDramaCharacterDossierForShotPlan(bibleNow.directing_notes);
      if ((bibleNow.shot_suggestions || []).length && dossierJson) {
        setAnalyzingHint('正在按人设加厚分镜…');
        const enriched = stampDramaShotCastCodes(
          await enrichShotSuggestionsWithDossier(
            bibleNow.shot_suggestions,
            dossierJson,
            analyzeTitle,
            session.meta.shotPlanPaceGear,
          ),
          bibleNow.directing_notes,
        );
        next = attachDramaShotSuggestions(next, enriched, epId);
      }
      patchSession(next);
      showAlert(
        `已生成 ${parsed.length} 张标准化人设。已有分镜会按人设加厚；也可再点「按人设加厚分镜」。`,
      );
    } catch (e) {
      showAlert(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
      setAnalyzingHint('正在策划本集…');
    }
  };

  const handleEnrichShotsFromDossier = async () => {
    if (analyzing || busy) return;
    const bibleNow = getActiveEpisodeBible(session);
    const suggestions = bibleNow.shot_suggestions || [];
    if (!suggestions.length) {
      showAlert('还没有分镜脚本，请先点「剧本拆分」或「脚本设计」');
      return;
    }
    const dossierJson = formatDramaCharacterDossierForShotPlan(bibleNow.directing_notes);
    if (!dossierJson || !sessionHasDramaCharacterDossier(bibleNow.directing_notes)) {
      showAlert('还没有标准化人设，请先点「重新生成人设」');
      return;
    }
    setAnalyzing(true);
    setAnalyzingHint('正在按人设加厚分镜…');
    try {
      const epId = activeEpisode?.episode_id || session.active_episode_id;
      const analyzeTitle = `${stripDramaEpisodeTitleSuffix(session.bible.project.name || '短剧') || '短剧'} · ${
        activeEpisode?.title || '本集'
      }`;
      const enriched = stampDramaShotCastCodes(
        await enrichShotSuggestionsWithDossier(
          suggestions,
          dossierJson,
          analyzeTitle,
          session.meta.shotPlanPaceGear,
        ),
        bibleNow.directing_notes,
      );
      patchSession(attachDramaShotSuggestions(session, enriched, epId));
      showAlert('已按人设加厚分镜：运镜/动作/演员情绪/光线/声音已写入表内，可再点一次继续加厚。');
    } catch (e) {
      showAlert(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
      setAnalyzingHint('正在策划本集…');
    }
  };

  const activeEpisodeBible = useMemo(() => getActiveEpisodeBible(session), [session]);

  return (
    <div className={`flex flex-col flex-1 min-h-0 gap-3 ${shellCls(isDark)}`}>
      {session.meta.needs_stage_reconfirm ? (
        <div
          className={`shrink-0 flex items-start justify-between gap-3 rounded-xl border px-3 py-2.5 text-[13px] ${
            isDark
              ? 'border-amber-400/35 bg-amber-500/10 text-amber-100'
              : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
        >
          <div className="min-w-0 leading-relaxed">
            该项目来自旧版本流程（当前用户阶段：
            {userPhase === 'script'
              ? '剧本'
              : userPhase === 'visual'
                ? '画风色调'
                : userPhase === 'assets'
                  ? '素材准备'
                  : userPhase === 'board'
                    ? '导演分镜'
                    : '成片'}
            ）。部分阶段状态需要重新确认（分集 → 画风色调 → 剧本分析 → 素材 → 导演表）。人物/场景卡片数据已保留；请先在「素材准备」生成参考图，再进导演分镜。
          </div>
          <button
            type="button"
            className={`nodrag shrink-0 rounded-lg px-2.5 py-1 text-[12px] ${
              isDark ? 'bg-white/10' : 'bg-white border border-amber-200'
            }`}
            onClick={() => patchSession(clearDramaLegacyUserFlowNotice(session))}
          >
            知道了
          </button>
        </div>
      ) : null}
      <div
        className={`flex-1 min-h-0 custom-scrollbar-dark ${
          phase === 'ingest' ||
          phase === 'episodes' ||
          phase === 'visual' ||
          phase === 'analyze' ||
          phase === 'board' ||
          phase === 'videos' ||
          phase === 'review'
            ? 'overflow-hidden flex flex-col'
            : 'overflow-auto'
        }`}
      >
        {phase === 'ingest' && (
          <div className="flex flex-col flex-1 min-h-0 gap-3 h-full">
            <input
              ref={novelFileRef}
              type="file"
              accept=".txt,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                e.target.value = '';
                void readTxtFile(f);
              }}
            />
            <div className={`shrink-0 text-[14px] ${mutedCls(isDark)}`}>
              将源剧本（「第一集 / 1-1 场景」格式）粘贴、拖入 txt，或从画布文本模块连线导入；空态也按本页「正文 + 分集列表」存储。
            </div>
            <div className="flex flex-1 min-h-0 gap-3 overflow-hidden">
              <div
                className={`nodrag flex flex-[1.35] min-h-[14rem] flex-col rounded-xl border p-3 transition ${
                  dragOver
                    ? isDark
                      ? 'border-sky-400/70 bg-sky-500/10'
                      : 'border-sky-400 bg-sky-50'
                    : isDark
                      ? 'border-white/12 bg-black/30'
                      : 'border-gray-200 bg-white'
                }`}
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0] || null;
                  void readTxtFile(f);
                }}
              >
                <div className="mb-2 shrink-0 flex items-center justify-between gap-2">
                  <div className="text-[13px] font-medium">
                    {episodes.length
                      ? `${activeEpisode?.title || '本集'} · 正文`
                      : '源剧本 / 本集正文'}
                  </div>
                  <span className={`text-[11px] ${mutedCls(isDark)}`}>
                    {episodes.length
                      ? `${(episodeDraft || '').length} 字`
                      : draftNovel.trim()
                        ? `${draftNovel.length} 字 · 待分集`
                        : '可粘贴整本'}
                  </span>
                </div>
                <textarea
                  className={`nodrag nowheel flex-1 min-h-[10rem] resize-none border-0 bg-transparent px-1 py-1 text-[16px] leading-7 outline-none custom-scrollbar-dark ${
                    isDark ? 'text-white/90 [color-scheme:dark]' : 'text-gray-900'
                  }`}
                  value={episodes.length ? episodeDraft : draftNovel}
                  placeholder={
                    episodes.length
                      ? '本集剧本正文…'
                      : '粘贴源剧本（支持「第一集」「1-1 场景」格式），或拖入 .txt…'
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    if (episodes.length) setEpisodeDraft(v);
                    else setDraftNovel(v);
                  }}
                  onBlur={() => {
                    if (episodes.length && activeEpisode) {
                      if (episodeDraft !== activeEpisode.text) {
                        commitEpisodeText(episodeDraft, activeEpisode.episode_id);
                      }
                    }
                  }}
                />
              </div>

              <div className={`${cardCls(isDark)} w-56 shrink-0 flex flex-col overflow-hidden p-2`}>
                <div className="shrink-0 mb-2 px-1 flex items-center justify-between gap-1">
                  <span className="text-[13px] font-semibold">分集列表</span>
                  <span className={`text-[11px] ${mutedCls(isDark)}`}>{episodes.length} 集</span>
                </div>
                <div className="flex-1 min-h-0 overflow-auto custom-scrollbar-dark space-y-1">
                  {episodes.length === 0 ? (
                    <div className={`px-2 py-8 text-center text-[12px] leading-relaxed ${mutedCls(isDark)}`}>
                      尚无分集
                      <br />
                      粘贴源剧本后点「分集」
                      <br />
                      或从文本模块连线导入
                    </div>
                  ) : (
                    episodes.map((ep) => {
                      const active = ep.episode_id === activeEpisode?.episode_id;
                      return (
                        <button
                          key={ep.episode_id}
                          type="button"
                          className={`nodrag w-full rounded-lg px-2.5 py-2 text-left text-[13px] ${
                            active
                              ? isDark
                                ? 'bg-sky-500/25 ring-1 ring-sky-400/40'
                                : 'bg-sky-50 ring-1 ring-sky-200'
                              : isDark
                                ? 'hover:bg-white/5'
                                : 'hover:bg-gray-50'
                          }`}
                          onClick={() => selectEpisode(ep)}
                        >
                          <div className="font-medium truncate">{ep.title}</div>
                          <div className={`text-[11px] ${mutedCls(isDark)}`}>
                            {ep.text.length} 字
                            {formatEpisodeUpdated(ep.updated_at)
                              ? ` · ${formatEpisodeUpdated(ep.updated_at)}`
                              : ''}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <div className="shrink-0 flex items-center gap-2 flex-wrap">
              <button
                type="button"
                className={`nodrag rounded-lg px-3.5 py-2 text-[13px] ${
                  isDark ? 'bg-white/10' : 'bg-gray-100'
                }`}
                onClick={() => novelFileRef.current?.click()}
              >
                导入源剧本
              </button>
              <button
                type="button"
                className={`nodrag rounded-lg px-3.5 py-2 text-[13px] ${
                  isDark ? 'bg-white/10' : 'bg-gray-100'
                }`}
                disabled={!episodes.length || !activeEpisode}
                onClick={() => {
                  if (!activeEpisode) return;
                  commitEpisodeText(episodeDraft, activeEpisode.episode_id);
                  showAlert('本集正文已保存');
                }}
              >
                保存
              </button>
              <button
                type="button"
                className={`nodrag rounded-lg px-3.5 py-2 text-[13px] font-medium ${
                  isDark ? 'bg-sky-500/80 text-white' : 'bg-gray-900 text-white'
                }`}
                disabled={
                  splitting ||
                  busy ||
                  !(episodes.length ? episodeDraft.trim() || draftNovel.trim() : draftNovel.trim())
                }
                onClick={() => {
                  if (episodes.length && !draftNovel.trim() && episodeDraft.trim()) {
                    // 已有分集时：用当前总源稿优先，否则用当前正文重分
                    ingestNovelAndSplit(session.meta.source_novel || episodeDraft);
                    return;
                  }
                  ingestNovelAndSplit(draftNovel || episodeDraft);
                }}
              >
                {splitting ? '分集中…' : '① 分集'}
              </button>
              <button
                type="button"
                className={`nodrag rounded-lg px-3.5 py-2 text-[13px] font-medium ${
                  isDark ? 'bg-emerald-500/80 text-white' : 'bg-emerald-700 text-white'
                }`}
                disabled={!episodes.length}
                onClick={() => {
                  if (!episodes.length) {
                    showAlert('请先分集');
                    return;
                  }
                  if (activeEpisode && episodeDraft !== activeEpisode.text) {
                    commitEpisodeText(episodeDraft, activeEpisode.episode_id);
                  }
                  goPhase('episodes');
                }}
              >
                ② 进入选集
              </button>
              {activeEpisode ? (
                <span className={`text-[13px] ${mutedCls(isDark)}`}>
                  已选：{activeEpisode.title}
                </span>
              ) : null}
            </div>
          </div>
        )}

        {phase === 'episodes' && (
          <div className="flex flex-col flex-1 min-h-0 gap-3 h-full">
            <div className="shrink-0 flex items-center justify-between gap-2">
              <div>
                <div className="text-[15px] font-semibold">
                  {episodes.length ? '选择一集进行剧本分析' : '接入剧本后在此选择分集'}
                </div>
                <div className={`text-[12px] mt-0.5 ${mutedCls(isDark)}`}>
                  {episodes.length
                    ? '点卡片可改正文；点「下一步」先锁定画风色调，再做本集剧本分析（分场/时长拆）'
                    : '点「+」直接录入本集剧本；整本粘贴分集请用右上「粘贴/上传剧本」'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={`nodrag rounded-lg px-3 py-1.5 text-[12px] ${
                    isDark ? 'bg-white/10' : 'bg-gray-100'
                  }`}
                  onClick={() => goPhase('ingest')}
                >
                  {episodes.length ? '返回分集' : '粘贴/上传剧本'}
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto custom-scrollbar-dark pr-1">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 pb-2">
                {episodes.map((ep) => {
                  const dateStr = formatEpisodeUpdated(ep.updated_at);
                  const sameTextAsOther = (episodes || []).some(
                    (o) =>
                      o.episode_id !== ep.episode_id &&
                      String(o.text || '').trim() &&
                      String(o.text || '').trim() === String(ep.text || '').trim(),
                  );
                  const bible = session.episode_bibles?.[ep.episode_id];
                  const summaryRaw =
                    String(bible?.logline || '').trim() ||
                    String(ep.text || '')
                      .replace(/\s+/g, ' ')
                      .trim();
                  const summaryLine = !summaryRaw
                    ? '暂无正文摘要'
                    : summaryRaw.length > 96
                      ? `${summaryRaw.slice(0, 96)}…`
                      : summaryRaw;
                  return (
                    <div
                      key={ep.episode_id}
                      className={`nodrag group relative w-full min-h-[12rem] rounded-xl p-4 flex flex-col overflow-hidden text-left transition-all duration-200 hover:scale-[1.02] ${
                        isDark
                          ? 'bg-white/[0.06] ring-1 ring-white/10 hover:ring-sky-400/40 hover:bg-white/[0.09]'
                          : 'bg-white ring-1 ring-gray-200 shadow-sm hover:ring-sky-300 hover:shadow-md'
                      }`}
                    >
                      <div
                        className={`absolute inset-0 opacity-40 pointer-events-none ${
                          isDark
                            ? 'bg-[radial-gradient(ellipse_at_30%_20%,rgba(56,189,248,0.18),transparent_55%)]'
                            : 'bg-[radial-gradient(ellipse_at_30%_20%,rgba(14,165,233,0.12),transparent_55%)]'
                        }`}
                        aria-hidden
                      />
                      <button
                        type="button"
                        className={`nodrag absolute top-2 right-2 z-[3] flex h-6 w-6 items-center justify-center rounded-full text-[14px] leading-none ${
                          isDark
                            ? 'bg-black/50 text-white/75 hover:bg-rose-500/80 hover:text-white'
                            : 'bg-black/35 text-white hover:bg-rose-600'
                        }`}
                        title="删除这一集"
                        aria-label="删除这一集"
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteEpisodeCard(ep);
                        }}
                      >
                        ×
                      </button>
                      <button
                        type="button"
                        className="relative z-[1] flex min-h-0 flex-1 flex-col text-left"
                        onClick={() => openEpisodeEditor(ep)}
                      >
                        <div className="pr-7">
                          <div
                            className={`text-[26px] font-bold leading-tight line-clamp-2 ${
                              isDark ? 'text-white' : 'text-gray-900'
                            }`}
                          >
                            {ep.title || `第${ep.episode_no}集`}
                          </div>
                          <div className={`mt-1.5 text-[12px] ${mutedCls(isDark)}`}>
                            {ep.analyzed ? '已分析' : '未分析'} · {ep.text.length} 字
                          </div>
                          <div
                            className={`mt-2.5 text-[13px] leading-relaxed line-clamp-3 ${
                              isDark ? 'text-white/70' : 'text-gray-600'
                            }`}
                          >
                            {summaryLine}
                          </div>
                          {sameTextAsOther ? (
                            <div
                              className={`mt-1.5 text-[11px] ${
                                isDark ? 'text-amber-200/90' : 'text-amber-700'
                              }`}
                            >
                              与其他集正文相同，请检查分集
                            </div>
                          ) : null}
                        </div>
                      </button>
                      <div className="relative z-[2] mt-auto flex items-center justify-between gap-2 pt-3 flex-wrap">
                        <div className={`min-w-0 truncate text-[11px] ${mutedCls(isDark)}`}>
                          {dateStr ? `修改：${dateStr}` : '点击卡片改正文'}
                        </div>
                        <button
                          type="button"
                          title="先锁定画风色调，再做剧本分析"
                          disabled={!String(ep.text || '').trim()}
                          className={`nodrag rounded-md px-3 py-1.5 text-[12px] font-medium ${
                            isDark
                              ? 'bg-sky-500/80 text-white hover:bg-sky-500 disabled:opacity-50'
                              : 'bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50'
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            openEpisodeNextToVisual(ep);
                          }}
                        >
                          下一步
                        </button>
                      </div>
                    </div>
                  );
                })}
                {/* 追加一集：就地输入本集正文，不跳到整本分集页 */}
                {draftNewEpisode ? (
                  <div
                    className={`nodrag relative flex w-full min-h-[11rem] flex-col gap-1.5 rounded-2xl p-3 ${
                      isDark
                        ? 'bg-[#2a2a2c] ring-1 ring-sky-400/35'
                        : 'bg-white ring-1 ring-sky-300 shadow-sm'
                    }`}
                  >
                    <input
                      type="text"
                      className={`nodrag w-full shrink-0 rounded-md border-0 bg-transparent px-0.5 text-[15px] font-semibold outline-none ${
                        isDark ? 'text-white placeholder:text-white/35' : 'text-gray-900 placeholder:text-gray-400'
                      }`}
                      value={draftNewEpisode.title}
                      placeholder="集标题，如第2集"
                      onChange={(e) =>
                        setDraftNewEpisode((prev) =>
                          prev ? { ...prev, title: e.target.value } : prev,
                        )
                      }
                    />
                    <textarea
                      autoFocus
                      className={`nodrag nowheel min-h-[5.5rem] flex-1 resize-none rounded-md px-1.5 py-1 text-[12px] leading-snug outline-none custom-scrollbar-dark ${
                        isDark
                          ? 'bg-black/35 text-white/90 placeholder:text-white/35'
                          : 'bg-gray-50 text-gray-900 placeholder:text-gray-400'
                      }`}
                      value={draftNewEpisode.text}
                      placeholder="粘贴或输入本集剧本正文…"
                      onChange={(e) =>
                        setDraftNewEpisode((prev) =>
                          prev ? { ...prev, text: e.target.value } : prev,
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.stopPropagation();
                          cancelInlineNewEpisode();
                        }
                      }}
                    />
                    <div className="flex shrink-0 items-center justify-between gap-1">
                      <span className={`text-[10px] ${mutedCls(isDark)}`}>
                        {draftNewEpisode.text.trim().length} 字
                      </span>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className={`nodrag rounded-md px-2 py-0.5 text-[11px] ${
                            isDark ? 'bg-white/10 text-white/80 hover:bg-white/15' : 'bg-gray-100 text-gray-700'
                          }`}
                          onClick={cancelInlineNewEpisode}
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          className={`nodrag rounded-md px-2 py-0.5 text-[11px] font-medium ${
                            isDark
                              ? 'bg-emerald-500/85 text-white hover:bg-emerald-500'
                              : 'bg-emerald-600 text-white hover:bg-emerald-700'
                          }`}
                          onClick={commitInlineNewEpisode}
                        >
                          保存本集
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    title="新增一集并输入本集剧本"
                    className={`nodrag relative w-full aspect-video rounded-2xl flex items-center justify-center transition-all duration-200 hover:scale-[1.02] ${
                      isDark
                        ? 'bg-[#2a2a2c] ring-1 ring-white/8 hover:ring-white/20'
                        : 'bg-gray-200 ring-1 ring-gray-300 hover:ring-gray-400'
                    }`}
                    onClick={startInlineNewEpisode}
                  >
                    <span
                      className={`flex h-14 w-14 items-center justify-center rounded-full text-[28px] font-light leading-none ${
                        isDark ? 'bg-white/12 text-white/85' : 'bg-white text-gray-500 shadow-sm'
                      }`}
                    >
                      +
                    </span>
                  </button>
                )}
              </div>
            </div>
            {episodeEditorId && typeof document !== 'undefined'
              ? createPortal(
                  <div
                    className="fixed inset-0 z-[100070] flex items-center justify-center p-4"
                    onPointerDown={(e) => {
                      if (e.target === e.currentTarget) closeEpisodeEditor(true);
                    }}
                  >
                    <div className="absolute inset-0 bg-black/55" aria-hidden />
                    <div
                      className={`relative z-[1] flex h-[min(78vh,640px)] w-[min(44rem,94vw)] flex-col overflow-hidden rounded-2xl shadow-2xl ${
                        isDark
                          ? 'bg-[#1c1c1e] ring-1 ring-white/15 text-white'
                          : 'bg-white ring-1 ring-gray-200 text-gray-900'
                      }`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div
                        className={`flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2.5 ${
                          isDark ? 'border-white/10' : 'border-gray-200'
                        }`}
                      >
                        <input
                          type="text"
                          className={`nodrag min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none ${
                            isDark ? 'text-white placeholder:text-white/35' : 'text-gray-900'
                          }`}
                          value={episodeEditorTitle}
                          placeholder="集标题"
                          onChange={(e) => setEpisodeEditorTitle(e.target.value)}
                        />
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            className={`nodrag rounded-lg px-2.5 py-1.5 text-[12px] ${
                              isDark ? 'bg-white/10 hover:bg-white/15' : 'bg-gray-100 hover:bg-gray-200'
                            }`}
                            onClick={() => closeEpisodeEditor(true)}
                          >
                            保存并关闭
                          </button>
                          <button
                            type="button"
                            className={`nodrag rounded-lg px-2.5 py-1.5 text-[12px] font-medium ${
                              isDark
                                ? 'bg-sky-500/85 text-white hover:bg-sky-500'
                                : 'bg-sky-600 text-white hover:bg-sky-700'
                            }`}
                            onClick={() => saveEpisodeEditorAndAnalyze()}
                          >
                            保存并分析
                          </button>
                        </div>
                      </div>
                      <textarea
                        autoFocus
                        className={`nodrag nowheel flex-1 min-h-0 w-full resize-none border-0 outline-none px-4 py-3 text-[14px] leading-7 custom-scrollbar-dark ${
                          isDark
                            ? 'bg-transparent text-white/90 placeholder:text-white/35'
                            : 'bg-transparent text-gray-900 placeholder:text-gray-400'
                        }`}
                        value={episodeEditorDraft}
                        placeholder="本集剧本正文…"
                        onChange={(e) => setEpisodeEditorDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.stopPropagation();
                            closeEpisodeEditor(true);
                          }
                        }}
                      />
                      <div
                        className={`flex shrink-0 items-center justify-between gap-2 border-t px-4 py-2 text-[11px] ${
                          isDark ? 'border-white/10 text-white/45' : 'border-gray-200 text-gray-500'
                        }`}
                      >
                        <span>{episodeEditorDraft.length} 字 · 可直接修改</span>
                        <button
                          type="button"
                          className={`nodrag rounded-md px-2 py-1 ${
                            isDark
                              ? 'text-rose-300 hover:bg-rose-500/20'
                              : 'text-rose-600 hover:bg-rose-50'
                          }`}
                          onClick={() => {
                            const ep = episodes.find((e) => e.episode_id === episodeEditorId);
                            if (ep) void deleteEpisodeCard(ep);
                          }}
                        >
                          删除这一集
                        </button>
                      </div>
                    </div>
                  </div>,
                  document.body,
                )
              : null}
          </div>
        )}

        {phase === 'visual' && (
          <div className="flex h-full min-h-0 flex-1 flex-col gap-2 overflow-hidden">
              <div className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
                <div className="flex shrink-0 items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-semibold">
                      2 · 画风与色调（整片锁定）
                    </div>
                    <div className={`mt-0.5 truncate text-[11px] ${mutedCls(isDark)}`}>
                      锁定后全部分集共用；再进入剧本分析
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <button
                      type="button"
                      className={`nodrag rounded-lg px-3 py-1.5 text-[12px] ${
                        isDark ? 'bg-white/10' : 'bg-gray-100'
                      }`}
                      onClick={() => goPhase('episodes')}
                    >
                      ← 1 分集
                    </button>
                    <button
                      type="button"
                      className={`nodrag rounded-lg px-3.5 py-2 text-[13px] font-medium ${
                        isDark ? 'bg-emerald-500/80 text-white' : 'bg-emerald-700 text-white'
                      } disabled:opacity-50`}
                      disabled={!session.bible.projectVisualBible?.selected_at}
                      onClick={() => {
                        if (!session.bible.projectVisualBible?.selected_at) {
                          showAlert('请先选择画风与色调');
                          return;
                        }
                        if (isDramaBoardConfirmed(session) || isDramaAssetsConfirmed(session)) {
                          showAlert(
                            '修改视觉风格可能影响后续素材与导演分镜，后续确认将解除，请重新确认。',
                          );
                          patchSession(
                            invalidateDramaConfirmationsAfter(
                              setDramaSessionPhase(session, 'analyze'),
                              'visual',
                            ),
                          );
                          return;
                        }
                        showAlert('整片风格已锁定，进入剧本分析');
                        goPhase('analyze');
                      }}
                    >
                      锁定风格，去剧本分析
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-hidden">
                  <VisualStyleLibrary
                    value={createEmptyDramaProjectVisualBible(
                      session.bible.projectVisualBible || {
                        visualDNA: session.bible.visualDNA,
                        presetId: session.bible.visualDNA?.presetId,
                        stylePrompt: session.bible.visualDNA?.generatedPrompt,
                      },
                    )}
                    isDark={isDark}
                    scriptHint={[
                      session.meta.source_novel,
                      session.meta.source_script,
                      session.bible.plot,
                      activeEpisodeBible.logline,
                      activeEpisodeBible.theme,
                      activeEpisodeBible.genre,
                      activeEpisode?.text,
                    ]
                      .filter(Boolean)
                      .join('\n')}
                    keywords={session.bible.script_keywords}
                    onChange={(pvb) => {
                      const dna = pvb.visualDNA;
                      const styleLine = String(pvb.stylePrompt || dna.generatedPrompt || '').trim();
                      patchSession({
                        ...session,
                        meta: {
                          ...session.meta,
                          stylePresetId: pvb.presetId || 'custom',
                          globalStyle: styleLine || session.meta.globalStyle,
                        },
                        bible: {
                          ...session.bible,
                          projectVisualBible: pvb,
                          visualDNA: dna,
                          project: {
                            ...session.bible.project,
                            visual_style: styleLine || session.bible.project.visual_style,
                          },
                          visual: {
                            ...session.bible.visual,
                            style: styleLine || session.bible.visual.style,
                            color: pvb.tags.slice(0, 3).join(' · ') || session.bible.visual.color,
                            camera: `${dna.camera.lens}mm${dna.camera.anamorphic ? ' anamorphic' : ''}`,
                            lighting: `${dna.lighting.style} · ${dna.lighting.direction}`,
                          },
                        },
                      });
                    }}
                  />
                </div>
              </div>
          </div>
        )}

        {phase === 'analyze' && (
          <div className="flex flex-col flex-1 min-h-0 gap-3 h-full">
            {!episodes.length ? (
              <div
                className={`${cardCls(isDark)} flex flex-1 min-h-[12rem] flex-col items-center justify-center gap-3 p-6`}
              >
                <div className={`text-[14px] ${mutedCls(isDark)}`}>
                  还没有分集。请先回到「剧本分集」上传总剧本并分集。
                </div>
                <button
                  type="button"
                  className={`nodrag rounded-lg px-3.5 py-2 text-[13px] font-medium ${
                    isDark ? 'bg-sky-500/80 text-white' : 'bg-gray-900 text-white'
                  }`}
                  onClick={() => goPhase('ingest')}
                >
                  去剧本分集
                </button>
              </div>
            ) : !activeEpisode ? (
              <div
                className={`${cardCls(isDark)} flex flex-1 min-h-[12rem] flex-col items-center justify-center gap-3 p-6`}
              >
                <div className={`text-[14px] ${mutedCls(isDark)}`}>
                  请先在「选择集数」点选一集，再进行剧本分析。
                </div>
                <button
                  type="button"
                  className={`nodrag rounded-lg px-3.5 py-2 text-[13px] font-medium ${
                    isDark ? 'bg-sky-500/80 text-white' : 'bg-gray-900 text-white'
                  }`}
                  onClick={() => goPhase('episodes')}
                >
                  去选择集数
                </button>
              </div>
            ) : (
                <div className="relative flex flex-1 min-h-0 flex-col gap-3">
                <div className="shrink-0 flex items-center justify-between gap-3 pl-10">
                  <div className="min-w-0 flex items-center gap-3">
                    <button
                      type="button"
                      className={`nodrag inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[14px] font-semibold ${
                        isDark
                          ? 'border border-sky-400/80 bg-sky-500/30 text-sky-50 hover:bg-sky-500/45'
                          : 'border border-sky-500 bg-sky-50 text-sky-800 hover:bg-sky-100'
                      }`}
                      onClick={() => {
                        if (activeEpisode && episodeDraft !== activeEpisode.text) {
                          commitEpisodeText(episodeDraft);
                        }
                        goPhase('episodes');
                      }}
                    >
                      ← 返回集数
                    </button>
                    <div className="text-[16px] font-semibold truncate">
                      当前分析：{activeEpisode?.title || '未选集'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      className={`nodrag rounded-lg px-3 py-1.5 text-[12px] ${
                        isDark ? 'bg-white/10' : 'bg-gray-100'
                      }`}
                      onClick={() => goPhase('visual')}
                    >
                      画风色调
                    </button>
                  </div>
                </div>

                <div className="shrink-0 flex items-center gap-2 flex-wrap pl-10">
                  {chatModelSelectSlot ? (
                    <div className="nodrag flex items-center gap-1.5 shrink-0">
                      {chatModelSelectSlot}
                    </div>
                  ) : null}
                  <DramaYuanbaoHoverWrap priceLabel={unitChatPriceLabel} tipBelow>
                    <button
                      type="button"
                      className={`nodrag rounded-lg px-3.5 py-2 text-[13px] font-medium ${
                        isDark ? 'bg-sky-500/80 text-white' : 'bg-gray-900 text-white'
                      }`}
                      disabled={analyzing || busy || !episodeDraft.trim()}
                      onClick={() => void handleAnalyze()}
                    >
                      {analyzing ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          {analyzingHint.includes('时长') ? '时长拆镜中…' : '分场中…'}
                        </span>
                      ) : (
                        '② 分场'
                      )}
                    </button>
                  </DramaYuanbaoHoverWrap>
                  <DramaYuanbaoHoverWrap priceLabel={unitChatPriceLabel} tipBelow>
                    <button
                      type="button"
                      className={`nodrag rounded-lg px-3.5 py-2 text-[13px] font-medium ${
                        isDark
                          ? 'border border-emerald-400/40 bg-emerald-500/80 text-white hover:bg-emerald-500'
                          : 'border border-emerald-600 bg-emerald-700 text-white hover:bg-emerald-800'
                      }`}
                      disabled={analyzing || busy || !isDramaSceneSplitDone(session)}
                      onClick={() => void handleDurationSplit()}
                    >
                      {analyzing && analyzingHint.includes('时长') ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          时长拆镜中…
                        </span>
                      ) : (
                        '③ 时长拆镜，去素材准备'
                      )}
                    </button>
                  </DramaYuanbaoHoverWrap>
                  <span className={`text-[14px] ${mutedCls(isDark)}`}>
                    {activeEpisodeBible.shot_suggestions.length
                      ? `${activeEpisodeBible.shot_suggestions.length} 镜脚本`
                      : '尚未生成分镜'}
                  </span>
                </div>

                <div className="relative flex-1 min-h-0 overflow-hidden pl-10">
                  <AnalyzeDirectorWorkspace
                    session={session}
                    episodeBible={activeEpisodeBible}
                    isDark={isDark}
                    onChange={patchSession}
                  />
                  {analyzing ? (
                    <div
                      className={`absolute inset-x-0 top-0 z-40 flex items-center justify-center gap-2 rounded-lg px-3 py-2 ${
                        isDark ? 'bg-[#111113]/80 text-sky-200' : 'bg-white/85 text-sky-700'
                      }`}
                      style={{ pointerEvents: 'none' }}
                    >
                      <Loader2
                        className={`h-4 w-4 animate-spin ${isDark ? 'text-sky-300' : 'text-sky-600'}`}
                        strokeWidth={2.25}
                      />
                      <span className="text-[13px] font-medium">{analyzingHint} · 可继续操作其它步骤</span>
                    </div>
                  ) : null}
                </div>

                {/* 左侧竖条：展开/收起本集正文 */}
                <button
                  type="button"
                  title={scriptDrawerOpen ? '收起本集正文' : '展开本集正文'}
                  className={`nodrag absolute top-0 left-0 z-20 h-full w-9 flex flex-col items-center justify-center gap-2 rounded-r-xl border-y border-r transition-colors ${
                    isDark
                      ? 'border-white/12 bg-white/[0.06] hover:bg-white/[0.1] text-white/80'
                      : 'border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-700'
                  }`}
                  onClick={() => setScriptDrawerOpen((v) => !v)}
                >
                  <span className="text-[11px] writing-mode-vertical tracking-widest [writing-mode:vertical-rl]">
                    本集正文
                  </span>
                  <span className={`text-[10px] ${mutedCls(isDark)}`}>
                    {scriptDrawerOpen ? '收起' : '展开'}
                  </span>
                </button>

                {scriptDrawerOpen ? (
                  <div
                    className={`absolute top-0 left-9 bottom-0 z-30 w-[min(28rem,46%)] flex flex-col overflow-hidden rounded-r-xl border shadow-xl ${
                      isDark
                        ? 'border-white/12 bg-[#12141a] text-white/90'
                        : 'border-gray-200 bg-white text-gray-900'
                    }`}
                  >
                    <div
                      className={`shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b ${
                        isDark ? 'border-white/10' : 'border-gray-200'
                      }`}
                    >
                      <div className="text-[13px] font-medium truncate">
                        {activeEpisode?.title || '本集正文'}
                      </div>
                      <button
                        type="button"
                        className={`nodrag rounded-md px-2 py-1 text-[12px] ${
                          isDark ? 'bg-white/10 hover:bg-white/15' : 'bg-gray-100 hover:bg-gray-200'
                        }`}
                        onClick={() => {
                          if (activeEpisode && episodeDraft !== activeEpisode.text) {
                            commitEpisodeText(episodeDraft);
                          }
                          setScriptDrawerOpen(false);
                        }}
                      >
                        关闭
                      </button>
                    </div>
                    <textarea
                      className={`nodrag nowheel flex-1 min-h-0 w-full resize-none border-0 outline-none px-3.5 py-3 text-[14px] leading-7 custom-scrollbar-dark ${
                        isDark
                          ? 'bg-transparent text-emerald-300 placeholder-white/35'
                          : 'bg-transparent text-emerald-700 placeholder-gray-400'
                      }`}
                      value={episodeDraft}
                      placeholder="本集正文…"
                      onChange={(e) => setEpisodeDraft(e.target.value)}
                      onBlur={() => {
                        if (activeEpisode && episodeDraft !== activeEpisode.text) {
                          commitEpisodeText(episodeDraft);
                        }
                      }}
                    />
                    <div
                      className={`shrink-0 px-3 py-1.5 text-[11px] border-t ${
                        isDark ? 'border-white/10 text-white/45' : 'border-gray-200 text-gray-500'
                      }`}
                    >
                      {episodeDraft.length} 字 · 可滚动编辑
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}

        {(phase === 'board' || phase === 'videos') && (
          <DramaBoardPanel
            session={session}
            pipeline={pipeline}
            isDark={isDark}
            busy={busy}
            variant="board"
            onChange={patchSession}
            showConfirm={showConfirm}
            onSpawnVideos={onSpawnVideos}
            getShotVideoPriceLabel={getShotVideoPriceLabel}
            unitChatPriceLabel={unitChatPriceLabel}
            unitImagePriceLabel={unitImagePriceLabel}
            storyboardImageGenSlot={storyboardImageGenSlot}
            onGenerateShotStoryboard={onGenerateShotStoryboard}
            videoGeneratingIds={videoGeneratingIds}
            onMarkVideoGenerating={onMarkVideoGenerating}
            onAbandonVideoWait={onAbandonVideoWait}
            onNext={() => {
              if (!(session.shots || []).length) {
                showAlert('导演分镜还没有镜头，请先完成剧本分析');
                return;
              }
              goPhase('review');
            }}
            runChat={runChat}
            showAlert={showAlert}
            onGenerateShotAudio={onGenerateShotAudio}
            onAbandonShotAudio={onAbandonShotAudio}
            unitVoicePriceLabel={unitVoicePriceLabel}
            onApplyShotVideoToSplice={onApplyShotVideoToSplice}
          />
        )}

        {phase === 'assets' && (
          <DramaAssetLibraryPanel
            session={session}
            pipeline={pipeline}
            projectId={projectId}
            isDark={isDark}
            busy={busy || analyzing}
            onChange={patchSession}
            imageGenToolbarSlot={imageGenToolbarSlot}
            unitImagePriceLabel={unitImagePriceLabel}
            batchImagePriceLabel={batchImagePriceLabel}
            onGenerateAssetImage={onGenerateAssetImage}
            onUploadAssetImage={onUploadAssetImage}
            onPickAssetFromCanvas={onPickAssetFromCanvas}
            canPickFromCanvas={canPickFromCanvas}
            onClearAssetImage={onClearAssetImage}
            assetGeneratingIds={assetGeneratingIds}
            unitChatPriceLabel={unitChatPriceLabel}
            unitVoicePriceLabel={unitVoicePriceLabel}
            batchVoicePriceLabel={batchVoicePriceLabel}
            canPickVoiceFromCanvas={canPickVoiceFromCanvas}
            onGenerateVoice={onGenerateVoice}
            onGenerateVoices={onGenerateVoices}
            onUploadVoice={onUploadVoice}
            onPickVoiceFromCanvas={onPickVoiceFromCanvas}
            showAlert={showAlert}
            runChat={runChat}
            chatModel={chatModel}
            onEnterNext={() => {
              void (async () => {
                if (!(session.shots || []).length) {
                  showAlert('请先完成剧本分析生成分镜脚本');
                  return;
                }
                if (!isDramaAssetMatchDone(session)) {
                  await handleRegenerateShotPlan();
                }
                goPhase('board');
              })();
            }}
            onMatchAssets={() => void handleRegenerateShotPlan()}
            assetMatchDone={isDramaAssetMatchDone(session)}
          />
        )}

        {phase === 'review' && (
          <DramaFinalCutPanel
            session={session}
            pipeline={pipeline}
            isDark={isDark}
            onChange={patchSession}
            onVideosToSplice={onVideosToSplice}
          />
        )}
      </div>
    </div>
  );
};

/** 下载素材定妆图（远程 / data / local-resource / file） */
async function downloadDramaAssetImage(imageUrl: string, preferredName: string): Promise<void> {
  const url = String(imageUrl || '').trim();
  if (!url || !window.electronAPI) return;
  const finalName = (preferredName || 'image').replace(/[/\\?*:|"]/g, '_').trim() || 'image';
  const isRemote = url.startsWith('http://') || url.startsWith('https://');
  const isDataUrl = url.startsWith('data:');
  try {
    if (isRemote || isDataUrl) {
      const result = await window.electronAPI.downloadImage(url, finalName);
      if (!result.success && result.error && !result.error.includes('取消')) {
        console.warn('[DramaStudio] 下载失败:', result.error);
      }
      return;
    }
    if (url.startsWith('local-resource://') || url.startsWith('file://')) {
      const resolved = url.startsWith('file://')
        ? `local-resource://${url.replace(/^file:\/\/\/?/, '')}`
        : url;
      const result = await window.electronAPI.downloadLocalFileToFolder(resolved, finalName);
      if (!result.success && result.error && !result.error.includes('取消')) {
        console.warn('[DramaStudio] 下载失败:', result.error);
      }
      return;
    }
    console.warn('[DramaStudio] 不支持的图片地址格式');
  } catch (err) {
    console.warn('[DramaStudio] 下载失败:', err);
  }
}

/** 下载角色参考音（远程 / data / local-resource / file） */
async function downloadDramaAssetAudio(audioUrl: string, preferredName: string): Promise<void> {
  const url = String(audioUrl || '').trim();
  if (!url || !window.electronAPI) return;
  const finalName = (preferredName || 'voice').replace(/[/\\?*:|"]/g, '_').trim() || 'voice';
  try {
    if (url.startsWith('local-resource://') || url.startsWith('file://')) {
      const resolved = url.startsWith('file://')
        ? `local-resource://${url.replace(/^file:\/\/\/?/, '')}`
        : url;
      const result = await window.electronAPI.downloadLocalFileToFolder(resolved, finalName);
      if (!result.success && result.error && !result.error.includes('取消')) {
        console.warn('[DramaStudio] 音频下载失败:', result.error);
      }
      return;
    }
    if (!window.electronAPI.downloadAudio) {
      console.warn('[DramaStudio] downloadAudio 不可用');
      return;
    }
    const result = await window.electronAPI.downloadAudio(url, finalName);
    if (!result.success && result.error && !result.error.includes('取消')) {
      console.warn('[DramaStudio] 音频下载失败:', result.error);
    }
  } catch (err) {
    console.warn('[DramaStudio] 音频下载失败:', err);
  }
}

function setDomainAssetImage(
  session: DramaDirectorSession,
  kind: DramaAssetVisualKind,
  assetId: string,
  imageUrl: string,
  status: 'pending' | 'generating' | 'ready' | 'error' = 'ready',
): DramaDirectorSession {
  const url = String(imageUrl || '').trim();
  const nextStatus = status === 'generating' || status === 'error' ? status : url ? status : 'pending';
  const patched = applyDramaSessionAssetImage(session, assetId, {
    imageUrl: url,
    status: nextStatus,
  });
  if (patched) return patched;
  // 未命中 Domain 资产 id 时保留浅写兜底（极少见）
  if (kind === 'characters') {
    return {
      ...session,
      bible: {
        ...session.bible,
        characters: session.bible.characters.map((c) =>
          c.character_id === assetId
            ? { ...c, imageUrl: url, status: nextStatus, error: undefined }
            : c,
        ),
      },
    };
  }
  if (kind === 'scenes') {
    return {
      ...session,
      bible: {
        ...session.bible,
        scenes: session.bible.scenes.map((s) =>
          s.scene_id === assetId
            ? { ...s, imageUrl: url, status: nextStatus, error: undefined }
            : s,
        ),
      },
    };
  }
  if (kind === 'props') {
    return {
      ...session,
      bible: {
        ...session.bible,
        props: session.bible.props.map((p) =>
          p.prop_id === assetId
            ? { ...p, imageUrl: url, status: nextStatus, error: undefined }
            : p,
        ),
      },
    };
  }
  return {
    ...session,
    bible: {
      ...session.bible,
      creatures: session.bible.creatures.map((c) =>
        c.creature_id === assetId
          ? { ...c, imageUrl: url, status: nextStatus, error: undefined }
          : c,
      ),
    },
  };
}

function clearDomainVoiceSample(
  session: DramaDirectorSession,
  voiceId: string,
): DramaDirectorSession {
  const id = String(voiceId || '').trim();
  if (!id) return session;
  return {
    ...session,
    bible: {
      ...session.bible,
      voices: session.bible.voices.map((v) =>
        v.voice_id === id
          ? { ...v, sample_url: '', status: 'pending' as const, error: undefined }
          : v,
      ),
    },
  };
}

function setDomainVoiceSample(
  session: DramaDirectorSession,
  voiceId: string,
  sampleUrl: string,
): DramaDirectorSession {
  return (
    applyDramaSessionVoiceSample(session, voiceId, {
      sampleUrl,
      status: 'ready',
    }) || session
  );
}

function reorderDomainAssets(
  session: DramaDirectorSession,
  kind: DramaAssetVisualKind,
  fromId: string,
  toId: string,
): DramaDirectorSession {
  if (!fromId || !toId || fromId === toId) return session;
  const move = <T,>(arr: T[], getId: (x: T) => string): T[] => {
    const from = arr.findIndex((x) => getId(x) === fromId);
    const to = arr.findIndex((x) => getId(x) === toId);
    if (from < 0 || to < 0) return arr;
    const next = [...arr];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  };
  if (kind === 'characters') {
    return {
      ...session,
      bible: {
        ...session.bible,
        characters: move(session.bible.characters, (c) => c.character_id),
      },
    };
  }
  if (kind === 'scenes') {
    return {
      ...session,
      bible: {
        ...session.bible,
        scenes: move(session.bible.scenes, (s) => s.scene_id),
      },
    };
  }
  if (kind === 'props') {
    return {
      ...session,
      bible: {
        ...session.bible,
        props: move(session.bible.props, (p) => p.prop_id),
      },
    };
  }
  return {
    ...session,
    bible: {
      ...session.bible,
      creatures: move(session.bible.creatures, (c) => c.creature_id),
    },
  };
}

function removeDomainAsset(
  session: DramaDirectorSession,
  kind: DramaAssetVisualKind | 'voices',
  assetId: string,
): DramaDirectorSession {
  if (kind === 'characters') {
    return suppressDramaCharacter(session, assetId);
  }
  if (kind === 'scenes') {
    return {
      ...session,
      bible: {
        ...session.bible,
        scenes: session.bible.scenes.filter((s) => s.scene_id !== assetId),
      },
    };
  }
  if (kind === 'props') {
    return {
      ...session,
      bible: {
        ...session.bible,
        props: session.bible.props.filter((p) => p.prop_id !== assetId),
      },
    };
  }
  if (kind === 'creatures') {
    return {
      ...session,
      bible: {
        ...session.bible,
        creatures: session.bible.creatures.filter((c) => c.creature_id !== assetId),
      },
    };
  }
  return {
    ...session,
    bible: {
      ...session.bible,
      voices: session.bible.voices.filter((v) => v.voice_id !== assetId),
    },
  };
}

function addDomainAsset(
  session: DramaDirectorSession,
  kind: DramaAssetVisualKind | 'voices',
): DramaDirectorSession {
  if (kind === 'characters') {
    const n = session.bible.characters.length + 1;
    const name = `新角色${n}`;
    const ch = createEmptyDramaCharacter({
      name,
      status: 'pending',
      costumes: [
        createEmptyDramaCharacterCostume({
          name: '默认服装',
          prompt: '',
          images: [],
          active: true,
          tag: '常服',
        }),
      ],
    });
    const voice = createEmptyDramaVoice({
      character_id: ch.character_id,
      sample_text: composeDramaVoiceSampleLine({ name, role: '出场角色' }),
      language: 'zh',
    });
    ch.voice_id = voice.voice_id;
    return {
      ...session,
      bible: {
        ...session.bible,
        characters: [...session.bible.characters, ch],
        voices: [...(session.bible.voices || []), voice],
      },
    };
  }
  if (kind === 'scenes') {
    const n = session.bible.scenes.length + 1;
    return {
      ...session,
      bible: {
        ...session.bible,
        scenes: [
          ...session.bible.scenes,
          createEmptyDramaSceneAsset({ name: `新场景${n}`, status: 'pending' }),
        ],
      },
    };
  }
  if (kind === 'props') {
    const n = session.bible.props.length + 1;
    return {
      ...session,
      bible: {
        ...session.bible,
        props: [
          ...session.bible.props,
          createEmptyDramaProp({ name: `新道具${n}`, status: 'pending' }),
        ],
      },
    };
  }
  if (kind === 'creatures') {
    const n = session.bible.creatures.length + 1;
    return {
      ...session,
      bible: {
        ...session.bible,
        creatures: [
          ...session.bible.creatures,
          createEmptyDramaCreature({ name: `新生物${n}`, status: 'pending' }),
        ],
      },
    };
  }
  const n = session.bible.voices.length + 1;
  return {
    ...session,
    bible: {
      ...session.bible,
      voices: [
        ...session.bible.voices,
        createEmptyDramaVoice({
          timbre: `新声音${n}`,
          sample_text: composeDramaVoiceSampleLine({ name: `新声音${n}`, role: '出场角色' }),
        }),
      ],
    },
  };
}

function setDomainAssetPrompt(
  session: DramaDirectorSession,
  kind: DramaAssetVisualKind | 'voices',
  assetId: string,
  prompt: string,
): DramaDirectorSession {
  const text = String(prompt || '');
  if (kind === 'characters') {
    return {
      ...session,
      bible: {
        ...session.bible,
        characters: session.bible.characters.map((c) =>
          c.character_id === assetId ? { ...c, prompt: text } : c,
        ),
      },
    };
  }
  if (kind === 'scenes') {
    return {
      ...session,
      bible: {
        ...session.bible,
        scenes: session.bible.scenes.map((s) =>
          s.scene_id === assetId ? { ...s, prompt: text } : s,
        ),
      },
    };
  }
  if (kind === 'props') {
    return {
      ...session,
      bible: {
        ...session.bible,
        props: session.bible.props.map((p) =>
          p.prop_id === assetId ? { ...p, prompt: text, description: text || p.description } : p,
        ),
      },
    };
  }
  if (kind === 'creatures') {
    return {
      ...session,
      bible: {
        ...session.bible,
        creatures: session.bible.creatures.map((c) =>
          c.creature_id === assetId
            ? { ...c, prompt: text, appearance: text || c.appearance }
            : c,
        ),
      },
    };
  }
  return {
    ...session,
    bible: {
      ...session.bible,
      voices: session.bible.voices.map((v) =>
        v.voice_id === assetId ? { ...v, sample_text: text } : v,
      ),
    },
  };
}

function setDomainAssetName(
  session: DramaDirectorSession,
  kind: DramaAssetVisualKind | 'voices',
  assetId: string,
  name: string,
): DramaDirectorSession {
  const text = String(name || '');
  if (kind === 'characters') {
    const next = {
      ...session,
      bible: {
        ...session.bible,
        characters: session.bible.characters.map((c) =>
          c.character_id === assetId ? { ...c, name: text } : c,
        ),
      },
    };
    return text.trim() ? unsuppressDramaCharacterName(next, text) : next;
  }
  if (kind === 'scenes') {
    return {
      ...session,
      bible: {
        ...session.bible,
        scenes: session.bible.scenes.map((s) =>
          s.scene_id === assetId ? { ...s, name: text } : s,
        ),
      },
    };
  }
  if (kind === 'props') {
    return {
      ...session,
      bible: {
        ...session.bible,
        props: session.bible.props.map((p) =>
          p.prop_id === assetId ? { ...p, name: text } : p,
        ),
      },
    };
  }
  if (kind === 'creatures') {
    return {
      ...session,
      bible: {
        ...session.bible,
        creatures: session.bible.creatures.map((c) =>
          c.creature_id === assetId ? { ...c, name: text } : c,
        ),
      },
    };
  }
  return session;
}

function patchCharacterCostumes(
  session: DramaDirectorSession,
  characterId: string,
  mutate: (costumes: DramaCharacterCostume[], ch: DramaCharacter) => DramaCharacterCostume[],
  extra?: Partial<DramaCharacter>,
): DramaDirectorSession {
  return {
    ...session,
    bible: {
      ...session.bible,
      characters: session.bible.characters.map((c) => {
        if (c.character_id !== characterId) return c;
        return { ...c, costumes: mutate([...(c.costumes || [])], c), ...extra };
      }),
    },
  };
}

function setActiveCharacterCostume(
  session: DramaDirectorSession,
  characterId: string,
  costumeId: string,
): DramaDirectorSession {
  return setActiveDramaCharacterCostume(session, characterId, costumeId);
}

/** 素材卡名称：非受控 + 按键截断。嵌在 React Flow / CSS zoom 里时，受控输入每键都会卡。 */
const IsolatedAssetNameInput = React.memo(function IsolatedAssetNameInput({
  value,
  isDark,
  onCommit,
}: {
  value: string;
  isDark: boolean;
  onCommit: (v: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  const commitRef = useRef(onCommit);
  const focusedRef = useRef(false);
  valueRef.current = value;
  commitRef.current = onCommit;
  useEffect(() => {
    if (focusedRef.current) return;
    const el = ref.current;
    if (el && el.value !== value) el.value = value;
  }, [value]);
  const stop = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };
  return (
    <input
      ref={ref}
      type="text"
      defaultValue={value}
      className={`nodrag nowheel nopan min-w-0 w-[42%] shrink-0 bg-transparent text-[12px] font-medium outline-none truncate text-center ${
        isDark ? 'text-white/90' : 'text-gray-900'
      }`}
      placeholder="名称"
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        const next = ref.current?.value ?? '';
        if (next !== valueRef.current) commitRef.current(next);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      onKeyUp={stop}
      onKeyPress={stop}
      onInput={stop}
      onPointerDown={stop}
      onMouseDown={stop}
      onClick={stop}
    />
  );
}, (prev, next) => prev.value === next.value && prev.isDark === next.isDark);

function DramaAssetPromptFold({
  value,
  placeholder,
  isDark,
  disabled,
  label,
  onChange,
  inline,
  leading,
  trailing,
}: {
  value: string;
  placeholder: string;
  isDark: boolean;
  disabled?: boolean;
  label: string;
  onChange: (v: string) => void;
  /** 按钮跟在名称后面，展开后文本框仍占满一行 */
  inline?: boolean;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState(value);
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setLocal(value);
  }, [value]);
  const flush = () => {
    focusedRef.current = false;
    if (local !== value) onChange(local);
  };
  const btn = (
    <button
      type="button"
      className={`nodrag shrink-0 flex h-5 items-center justify-center gap-0.5 rounded-md px-1.5 text-[10px] leading-none ${
        isDark
          ? 'bg-white/12 text-white/80 hover:bg-white/20'
          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      }`}
      title={open ? '收起提示词' : `展开${label}`}
      onClick={(e) => {
        e.stopPropagation();
        if (open) flush();
        setOpen((v) => !v);
      }}
    >
      <span aria-hidden className="text-[9px] leading-none">
        {open ? '▴' : '▾'}
      </span>
      {open ? '收起' : label}
    </button>
  );
  const area = open ? (
    <textarea
      className={`nodrag nopan nowheel mt-1 max-h-[12rem] min-h-[6.5rem] w-full resize-none rounded-md border px-1.5 py-1 text-[11px] leading-relaxed outline-none overflow-y-auto overflow-x-hidden custom-scrollbar-dark ${
        isDark
          ? 'border-white/12 bg-black/40 text-white/90 placeholder:text-white/35'
          : 'border-gray-200 bg-white text-gray-800 placeholder:text-gray-400'
      }`}
      value={local}
      placeholder={placeholder}
      disabled={disabled}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={flush}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    />
  ) : null;
  if (inline) {
    return (
      <div className="min-w-0 w-full">
        <div className="relative z-[30] flex min-w-0 items-center justify-center gap-1.5 px-2 py-1.5">
          {leading}
          {btn}
          {trailing}
        </div>
        <div className="px-1.5 pb-1">{area}</div>
      </div>
    );
  }
  return (
    <div className="w-full px-1.5 pb-1">
      <div className="flex justify-center">{btn}</div>
      {area}
    </div>
  );
}

function _DramaPromptHoverButtonRemoved() { return null; }
function _DramaPromptHoverButtonRemoved_unused({
  isDark,
  items,
}: {
  isDark: boolean;
  items: { label: string; onPick: () => void }[];
}) {
  const closeTimer = useRef<number | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const btnCls = `nodrag shrink-0 flex h-5 items-center justify-center rounded-md px-1.5 text-[10px] leading-none ${
    isDark
      ? 'bg-white/12 text-white/80 hover:bg-white/20'
      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
  }`;

  const cancelClose = () => {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const placeMenu = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const menuW = 120;
    const left = Math.min(
      Math.max(8, r.left + r.width / 2 - menuW / 2),
      window.innerWidth - menuW - 8,
    );
    const top = Math.min(r.bottom + 4, window.innerHeight - 8);
    setMenuPos({ left, top });
  };

  const showMenu = () => {
    if (items.length <= 1) return;
    cancelClose();
    placeMenu();
    setOpen(true);
  };

  const hideMenuSoon = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 160);
  };

  useEffect(() => {
    return () => {
      if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onReposition = () => placeMenu();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  return (
    <div
      className="relative z-[80] shrink-0"
      onMouseEnter={showMenu}
      onMouseLeave={hideMenuSoon}
    >
      <button
        ref={btnRef}
        type="button"
        className={btnCls}
        title="编辑提示词"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (items.length <= 1) {
            items[0]?.onPick();
            return;
          }
          cancelClose();
          placeMenu();
          setOpen((v) => !v);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        提示词
      </button>
      {open && menuPos
        ? createPortal(
            <div
              data-drama-prompt-menu="1"
              className={`nodrag fixed z-[100080] w-max min-w-[7.5rem] overflow-hidden rounded-md border shadow-lg ${
                isDark ? 'border-white/15 bg-[#1c1c1e]' : 'border-gray-200 bg-white'
              }`}
              style={{ left: menuPos.left, top: menuPos.top }}
              onMouseEnter={cancelClose}
              onMouseLeave={hideMenuSoon}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {items.map((it) => (
                <button
                  key={it.label}
                  type="button"
                  className={`nodrag flex h-7 w-full items-center px-2.5 text-left text-[10px] leading-none transition-colors ${
                    isDark
                      ? 'text-white/90 hover:bg-sky-500 hover:text-white'
                      : 'text-gray-800 hover:bg-sky-500 hover:text-white'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    it.onPick();
                  }}
                >
                  {it.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function buildDramaAssetPromptReviseMessages(opts: {
  mode: 'image' | 'voice';
  original: string;
  opinion: string;
}): { systemPrompt: string; userPrompt: string } {
  if (opts.mode === 'voice') {
    return {
      systemPrompt: [
        '你是短剧配音提示词编辑。根据用户修改思路改写声音提示词。',
        '输出必须仍是纯文本，固定结构（每行一项，勿输出 Markdown/JSON/解释）：',
        '名字',
        '年龄：…',
        '性别：男/女/未注明',
        '音色描述：口语化、可念给人听的音色（勿堆英文标签）',
        '台词：',
        '（只能保留或改用小说/剧本中该角色的原句；禁止新编台词）',
        '只改用户点名的部分；未提及的字段尽量沿用原文。只输出改写后的全文。',
      ].join('\n'),
      userPrompt: [
        '【原文】',
        opts.original.trim() || '（空）',
        '',
        '【修改思路】',
        opts.opinion.trim(),
        '',
        '请输出改写后的声音提示词全文：',
      ].join('\n'),
    };
  }
  return {
    systemPrompt: [
      '你是短剧美术提示词编辑。根据用户修改思路改写图片提示词。',
      '输出须为可直接用于生图的纯中文描述，不要 Markdown/JSON/解释。',
      '必须符合小说设定：年龄外形、穿着、年代风格、发型发色、配饰细节与颜色都要写清楚；禁止擅自改龄或时代错配。',
      '只改用户点名的部分；未提及处尽量沿用原文。只输出改写后的全文。',
    ].join('\n'),
    userPrompt: [
      '【原文】',
      opts.original.trim() || '（空）',
      '',
      '【修改思路】',
      opts.opinion.trim(),
      '',
      '请输出改写后的图片提示词全文：',
    ].join('\n'),
  };
}

function stripDramaPromptAiOutput(raw: string): string {
  let t = String(raw || '').trim();
  if (!t) return '';
  const fence = t.match(/^```(?:\w+)?\s*([\s\S]*?)```$/);
  if (fence) t = fence[1].trim();
  return t.replace(/^\s*改写后的[^：:\n]*[：:]\s*/i, '').trim();
}

function DramaPromptEditDialog({
  isDark,
  title,
  value,
  placeholder,
  mode,
  runChat,
  showAlert,
  chatModel,
  unitChatPriceLabel,
  onSave,
  onClose,
}: {
  isDark: boolean;
  title: string;
  value: string;
  placeholder: string;
  mode: 'image' | 'voice';
  runChat?: (
    systemPrompt: string,
    userPrompt: string,
    opts?: { max_tokens?: number; temperature?: number; model?: string },
  ) => Promise<string>;
  showAlert?: (msg: string) => void;
  chatModel?: string;
  unitChatPriceLabel?: string | null;
  onSave: (next: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [opinion, setOpinion] = useState('');
  const opinionRef = useRef('');
  opinionRef.current = opinion;
  const [revising, setRevising] = useState(false);
  const [dictationTarget, setDictationTarget] = useState<'draft' | 'opinion'>('draft');
  const dictationTargetRef = useRef<'draft' | 'opinion'>('draft');
  dictationTargetRef.current = dictationTarget;

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const {
    status: dictationStatus,
    isActive: isDictationActive,
    inputLevel: dictationLevel,
    start: startDictation,
    stop: stopDictation,
    cancel: cancelDictation,
  } = useCloudRealtimeDictation({
    getBaseText: () => {
      const target = dictationTargetRef.current;
      const prev = String(
        (target === 'opinion' ? opinionRef.current : draftRef.current) || '',
      ).trimEnd();
      return prev ? `${prev}${target === 'opinion' ? ' ' : '\n'}` : '';
    },
    onLiveText: (full) => {
      if (dictationTargetRef.current === 'opinion') setOpinion(full);
      else setDraft(full);
    },
    onError: (message) => {
      showAlert?.(message);
    },
    onMicDenied: () => {
      showAlert?.('无法使用麦克风，请检查系统权限');
    },
  });

  const micBusy = dictationStatus === 'connecting' || dictationStatus === 'stopping';
  const micStopping = dictationStatus === 'stopping';
  const { pointerHandlers: draftMicPointerHandlers } = useDictationPushToTalk({
    start: async () => {
      setDictationTarget('draft');
      dictationTargetRef.current = 'draft';
      return startDictation();
    },
    stop: stopDictation,
    cancel: cancelDictation,
    status: dictationStatus,
    disabled: micStopping || revising || (isDictationActive && dictationTarget !== 'draft'),
  });
  const { pointerHandlers: opinionMicPointerHandlers } = useDictationPushToTalk({
    start: async () => {
      setDictationTarget('opinion');
      dictationTargetRef.current = 'opinion';
      return startDictation();
    },
    stop: stopDictation,
    cancel: cancelDictation,
    status: dictationStatus,
    disabled: micStopping || revising || (isDictationActive && dictationTarget !== 'opinion'),
  });

  useEffect(() => {
    if (!isDictationActive) return;
    acquireVoiceModalLock();
    return () => releaseVoiceModalGateSafe();
  }, [isDictationActive]);

  useEffect(() => {
    return () => {
      cancelDictation();
      releaseVoiceModalGateSafe();
    };
  }, [cancelDictation]);

  const fieldCls = isDark
    ? 'border-white/12 bg-black/40 text-white/90 placeholder:text-white/35'
    : 'border-gray-200 bg-gray-50 text-gray-800 placeholder:text-gray-400';

  const handleAiRevise = async () => {
    if (revising || !runChat) return;
    const hint = String(opinion || '').trim();
    if (!hint) {
      showAlert?.(
        mode === 'voice'
          ? '请先输入修改思路，例如：音色更低沉，台词换成更急促的两句'
          : '请先输入修改思路，例如：衣服改成红色工装，表情更冷',
      );
      return;
    }
    const original = String(draftRef.current || '').trim();
    if (!original) {
      showAlert?.('原文为空，请先手写或语音输入提示词');
      return;
    }
    setRevising(true);
    try {
      const { systemPrompt, userPrompt } = buildDramaAssetPromptReviseMessages({
        mode,
        original,
        opinion: hint,
      });
      const model = resolveDramaChatModel(chatModel);
      const raw = await runChat(systemPrompt, userPrompt, {
        max_tokens: mode === 'voice' ? 800 : 1200,
        temperature: 0.55,
        model,
      });
      const next = stripDramaPromptAiOutput(raw);
      if (!next) {
        showAlert?.('AI 未返回有效改写，请重试或换个说法');
        return;
      }
      setDraft(next);
      setOpinion('');
    } catch (e) {
      showAlert?.(e instanceof Error ? e.message : 'AI 改写失败');
    } finally {
      setRevising(false);
    }
  };

  const renderMicBtn = (
    handlers: ReturnType<typeof useDictationPushToTalk>['pointerHandlers'],
    activeForTarget: boolean,
  ) => (
    <button
      type="button"
      {...handlers}
      disabled={micStopping || revising}
      style={
        activeForTarget &&
        (dictationStatus === 'listening' || dictationStatus === 'connecting')
          ? micLevelCssVars(dictationLevel)
          : undefined
      }
      className={`nexflow-voice-mic-btn nodrag nopan relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md border select-none ${
        activeForTarget && dictationStatus === 'connecting'
          ? 'connecting'
          : activeForTarget && dictationStatus === 'listening'
            ? 'listening'
            : ''
      } ${
        micStopping
          ? isDark
            ? 'cursor-wait border-white/25 bg-white/5 text-white/75'
            : 'cursor-wait border-gray-300 bg-white/90 text-gray-600'
          : isDark
            ? 'border-white/25 bg-white/5 text-white/75 hover:bg-white/10 hover:text-white'
            : 'border-gray-300 bg-white/90 text-gray-600 hover:bg-gray-100'
      }`}
      title={
        micBusy
          ? '正在听写…'
          : isDictationActive && activeForTarget
            ? '松开结束'
            : '按住说话（语音输入）'
      }
      aria-label="语音输入"
    >
      <VoiceMicGlyph
        busy={micBusy && activeForTarget}
        active={activeForTarget && dictationStatus === 'listening'}
        level={dictationLevel}
      />
    </button>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[100090] flex items-center justify-center p-4"
      onClick={() => {
        cancelDictation();
        onClose();
      }}
    >
      <div
        className={`w-[min(40rem,94vw)] overflow-hidden rounded-2xl border shadow-2xl ${
          isDark ? 'border-white/12 bg-[#16161a] text-white' : 'border-gray-200 bg-white text-gray-900'
        }`}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <div className="text-[15px] font-semibold">{title}</div>
          <button
            type="button"
            className={`nodrag flex h-7 w-7 items-center justify-center rounded-full text-[16px] ${
              isDark ? 'hover:bg-white/10' : 'hover:bg-gray-100'
            }`}
            onClick={() => {
              cancelDictation();
              onClose();
            }}
          >
            ×
          </button>
        </div>
        <div className="px-4 pb-2">
          <div className="relative">
            <textarea
              className={`nodrag nowheel min-h-[14rem] w-full resize-y rounded-xl border px-3 py-2.5 pr-11 text-[13px] leading-relaxed outline-none custom-scrollbar-dark ${fieldCls}`}
              value={draft}
              placeholder={placeholder}
              autoFocus
              disabled={revising || (isDictationActive && dictationTarget === 'draft')}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="absolute right-2 top-2">
              {renderMicBtn(draftMicPointerHandlers, dictationTarget === 'draft')}
            </div>
          </div>
        </div>
        <div
          className={`mx-4 mb-3 flex flex-wrap items-center gap-1.5 rounded-xl border px-2 py-1.5 ${
            isDark ? 'border-white/10 bg-black/25' : 'border-gray-200 bg-gray-50'
          }`}
        >
          <input
            type="text"
            className={`nodrag nowheel min-w-0 flex-1 basis-[12rem] rounded-md border px-2 py-1.5 text-[12px] outline-none ${fieldCls}`}
            value={opinion}
            disabled={revising || (isDictationActive && dictationTarget === 'opinion')}
            placeholder={
              mode === 'voice'
                ? '修改思路，例如：音色更低沉，台词换成更急的两句'
                : '修改思路，例如：衣服改红，表情更冷'
            }
            onChange={(e) => setOpinion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleAiRevise();
              }
            }}
          />
          {renderMicBtn(opinionMicPointerHandlers, dictationTarget === 'opinion')}
          <DramaYuanbaoHoverWrap priceLabel={unitChatPriceLabel}>
            <button
              type="button"
              className="nodrag shrink-0 rounded-lg bg-violet-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-violet-400 disabled:opacity-50"
              disabled={revising || !runChat || !String(opinion || '').trim()}
              onClick={() => void handleAiRevise()}
            >
              {revising ? 'AI 改写中…' : 'AI 按原文改'}
            </button>
          </DramaYuanbaoHoverWrap>
        </div>
        <div className="flex justify-end gap-2 px-4 pb-4">
          <button
            type="button"
            className={`nodrag rounded-lg px-3 py-1.5 text-[13px] ${
              isDark ? 'bg-white/10 text-white/85 hover:bg-white/14' : 'bg-gray-100 text-gray-700'
            }`}
            onClick={() => {
              cancelDictation();
              onClose();
            }}
          >
            取消
          </button>
          <button
            type="button"
            className="nodrag rounded-lg bg-sky-500 px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-sky-400 disabled:opacity-50"
            disabled={revising}
            onClick={() => {
              cancelDictation();
              onSave(draft);
              onClose();
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function releaseVoiceModalGateSafe() {
  try {
    releaseVoiceModalLock();
  } catch {
    /* ignore */
  }
}

/** 生成按钮：表面不写价格，悬停金色元宝 tip */
function DramaYuanbaoHoverWrap({
  priceLabel,
  tipBelow,
  className,
  children,
}: {
  priceLabel?: string | null;
  tipBelow?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  const tip = String(priceLabel || '').trim();
  return (
    <span
      className={`relative inline-flex max-w-full overflow-visible ${className || ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {hover && tip ? (
        <span
          className={`${tipBelow ? yuanbaoHoverTipBelowCls : yuanbaoHoverTipAboveCls} translate-y-0 opacity-100`}
          title={tip}
        >
          <Coins className="h-3 w-3 shrink-0 text-amber-300" aria-hidden strokeWidth={2.25} />
          <span>{tip}</span>
        </span>
      ) : null}
      {children}
    </span>
  );
}

function isDramaDroppableImageUrl(url: string): boolean {
  const u = String(url || '').trim();
  if (!u) return false;
  if (u.startsWith('drama-asset:') || u.startsWith('drama-shot:') || u === 'thumb') return false;
  return /^(https?:|local-resource:|data:|file:|blob:)/i.test(u);
}

function isDramaDroppableAudioUrl(url: string): boolean {
  const u = String(url || '').trim();
  if (!u || !isDramaDroppableImageUrl(u)) return false;
  return /\.(mp3|wav|m4a|ogg|flac|aac)(\?|#|$)/i.test(u) || /audio/i.test(u);
}

function readDramaDropImageUrl(dt: DataTransfer): string {
  const typed = String(dt.getData(NEXFLOW_CANVAS_IMAGE_DRAG_MIME) || '').trim();
  if (isDramaDroppableImageUrl(typed)) return typed;
  const raw = String(dt.getData('text/uri-list') || dt.getData('text/plain') || '').trim();
  const maybe = raw.split('\n').map((s) => s.trim()).find((s) => s && !s.startsWith('#')) || '';
  return isDramaDroppableImageUrl(maybe) ? maybe : '';
}

function readDramaDropAudioUrl(dt: DataTransfer): string {
  const typed = String(dt.getData(NEXFLOW_CANVAS_AUDIO_DRAG_MIME) || '').trim();
  if (isDramaDroppableImageUrl(typed)) return typed;
  const raw = String(dt.getData('text/plain') || '').trim();
  return isDramaDroppableAudioUrl(raw) ? raw : '';
}

function DramaEmptyAssetImageSlot({
  isDark,
  generating,
  aspect,
  onUpload,
  placeholder,
}: {
  isDark: boolean;
  generating?: boolean;
  aspect: string;
  onUpload?: () => void;
  placeholder?: string;
}) {
  return (
    <div
      className="flex w-full flex-col items-center justify-center gap-2 px-2"
      style={{ aspectRatio: aspect }}
      data-no-card-drag
    >
      {generating ? null : placeholder ? (
        <span
          className={`max-w-[5.5rem] text-center text-[12px] font-medium leading-snug ${
            isDark ? 'text-white/45' : 'text-gray-400'
          }`}
        >
          {placeholder}
        </span>
      ) : (
        <button
          type="button"
          className={`nodrag flex h-11 w-11 items-center justify-center rounded-full transition-colors ${
            isDark
              ? 'bg-white/10 text-white/80 hover:bg-white/18 hover:text-white'
              : 'bg-white text-gray-600 shadow-sm hover:bg-gray-50 hover:text-gray-900'
          }`}
          title="点击上传，或从画布拖入图片"
          aria-label="上传图片"
          onClick={(e) => {
            e.stopPropagation();
            onUpload?.();
          }}
        >
          <Plus className="h-6 w-6" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

function DramaAssetSourceMenu({
  isDark,
  generating,
  generatingLabel,
  primaryLabel,
  priceLabel,
  showLibrary,
  canPickFromCanvas,
  onGenerate,
  onUpload,
  onPickCanvas,
  onPickLibrary,
  promptLabel,
  onEditPrompt,
}: {
  isDark: boolean;
  generating?: boolean;
  generatingLabel: string;
  primaryLabel: string;
  priceLabel?: string | null;
  showLibrary?: boolean;
  canPickFromCanvas?: boolean;
  onGenerate?: () => void;
  onUpload: () => void;
  onPickCanvas?: () => void;
  onPickLibrary?: () => void;
  promptLabel?: string;
  onEditPrompt?: () => void;
}) {
  const [priceHover, setPriceHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const tip = String(priceLabel || '').trim();
  const itemCls = `nodrag flex h-7 w-full items-center justify-between gap-1 px-2 text-left text-[10px] leading-none transition-colors ${
    isDark
      ? 'text-white/90 hover:bg-sky-500 hover:text-white'
      : 'text-gray-800 hover:bg-sky-500 hover:text-white'
  }`;
  const promptItemCls = `nodrag flex h-7 w-full items-center justify-between gap-1 px-2 text-left text-[10px] leading-none transition-colors ${
    isDark
      ? 'bg-orange-500/30 text-orange-100 hover:bg-orange-500/50 hover:text-white'
      : 'bg-orange-100 text-orange-800 hover:bg-orange-200 hover:text-orange-900'
  }`;
  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ left: r.left, top: r.bottom + 2, width: r.width });
    setMenuOpen(true);
  };
  const closeMenu = () => setMenuOpen(false);
  return (
    <div
      className="relative min-w-0 flex-1"
      onMouseEnter={openMenu}
      onMouseLeave={closeMenu}
    >
      {priceHover && tip && !generating ? (
        <span
          className={`${yuanbaoHoverTipAboveCls} translate-y-0 opacity-100`}
          title={tip}
        >
          <Coins className="h-3 w-3 shrink-0 text-amber-300" aria-hidden strokeWidth={2.25} />
          <span>{tip}</span>
        </span>
      ) : null}
      <button
        ref={btnRef}
        type="button"
        className={`nodrag box-border flex h-6 w-full items-center justify-center rounded-md px-1 text-[9px] leading-none ${
          isDark ? 'bg-sky-500/70 text-white' : 'bg-gray-900 text-white'
        } disabled:opacity-50`}
        disabled={generating}
        onMouseEnter={() => setPriceHover(true)}
        onMouseLeave={() => setPriceHover(false)}
        onClick={() => {
          if (!generating) onGenerate?.();
        }}
      >
        <span className="truncate">{generating ? generatingLabel : primaryLabel}</span>
      </button>
      {menuOpen && menuPos ? createPortal(
        <div
          className={`nodrag fixed z-[100090] origin-top overflow-hidden rounded-md border shadow-lg ${
            isDark ? 'border-white/15 bg-[#1c1c1e]' : 'border-gray-200 bg-white'
          }`}
          style={{ left: menuPos.left, top: menuPos.top, width: menuPos.width }}
          onMouseEnter={openMenu}
          onMouseLeave={closeMenu}
        >
          {promptLabel && onEditPrompt ? (
            <button type="button" className={promptItemCls} onClick={() => { onEditPrompt(); closeMenu(); }}>
              {promptLabel}
            </button>
          ) : null}
          <button type="button" className={itemCls} onClick={() => { onUpload(); closeMenu(); }}>
            本地上传
          </button>
          <button
            type="button"
            className={`${itemCls} disabled:opacity-40`}
            disabled={!canPickFromCanvas || !onPickCanvas}
            onClick={() => { onPickCanvas?.(); closeMenu(); }}
          >
            从画布上传
          </button>
          {showLibrary && onPickLibrary ? (
            <button type="button" className={itemCls} onClick={() => { onPickLibrary(); closeMenu(); }}>
              角色仓库
            </button>
          ) : null}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

function findVoiceForCharacter(
  session: DramaDirectorSession,
  characterId: string,
): DramaVoice | undefined {
  const id = String(characterId || '').trim();
  if (!id) return undefined;
  const ch = session.bible.characters.find((c) => c.character_id === id);
  if (ch?.voice_id) {
    const hit = session.bible.voices.find((v) => v.voice_id === ch.voice_id);
    if (hit) return hit;
  }
  return session.bible.voices.find((v) => v.character_id === id);
}

function DramaLiteVoiceBar({
  url,
  isDark,
  generating,
  downloadName,
  onClear,
  onDropFile,
  onDropUrl,
}: {
  url: string;
  isDark: boolean;
  generating: boolean;
  downloadName?: string;
  onClear: () => void;
  onDropFile?: (file: File) => void;
  onDropUrl?: (sampleUrl: string) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewCtxRef = useRef<AudioContext | null>(null);
  const [playing, setPlaying] = useState(false);
  const [dropOver, setDropOver] = useState(false);
  const hasMedia = !!String(url || '').trim();
  const isAudioFile = (file: File) =>
    String(file.type || '').startsWith('audio/') ||
    /\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(file.name);

  const acceptAudioDrag = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types || []);
    return (
      !!peekCanvasAudioDragUrl() ||
      types.includes(NEXFLOW_CANVAS_AUDIO_DRAG_MIME) ||
      types.includes('Files')
    );
  };

  useEffect(() => {
    setPlaying(false);
    const prev = audioRef.current;
    if (prev) {
      prev.pause();
      prev.removeAttribute('src');
      prev.load();
    }
  }, [url]);

  useEffect(() => {
    return () => {
      const a = audioRef.current;
      if (!a) return;
      a.pause();
      a.removeAttribute('src');
      a.load();
    };
  }, []);

  const toggle = () => {
    if (!hasMedia) return;
    let a = audioRef.current;
    if (!a) {
      a = new Audio();
      a.preload = 'none';
      a.addEventListener('ended', () => setPlaying(false));
      previewCtxRef.current = attachAudioPreviewGain(a) || previewCtxRef.current;
      audioRef.current = a;
    }
    if (!a.paused) {
      a.pause();
      setPlaying(false);
      return;
    }
    if (a.getAttribute('src') !== url) a.src = url;
    setPlaying(true);
    void (async () => {
      await resumeAudioPreviewContext(previewCtxRef.current);
      try {
        await a.play();
      } catch {
        setPlaying(false);
      }
    })();
  };

  return (
    <div
      className={`relative flex items-center gap-1 overflow-hidden rounded-md px-1 py-1 ${
        isDark ? 'bg-black/40' : 'bg-gray-100'
      } ${dropOver ? 'ring-2 ring-sky-400/80' : ''}`}
      data-no-card-drag
      data-drama-drop="audio"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDragOver={(e) => {
        if (!acceptAudioDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        if (!dropOver) setDropOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDropOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDropOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file && isAudioFile(file)) {
          endCanvasAudioDrag();
          onDropFile?.(file);
          return;
        }
        const audioUrl = peekCanvasAudioDragUrl() || readDramaDropAudioUrl(e.dataTransfer);
        if (audioUrl) {
          endCanvasAudioDrag();
          onDropUrl?.(audioUrl);
        }
      }}
    >
      {hasMedia ? (
        <button
          type="button"
          className={`nodrag shrink-0 bg-transparent p-0.5 ${
            isDark ? 'text-violet-300/90 hover:text-violet-200' : 'text-violet-600 hover:text-violet-700'
          }`}
          title="下载音频"
          aria-label="下载音频"
          onClick={(e) => {
            e.stopPropagation();
            void downloadDramaAssetAudio(url, downloadName || 'voice');
          }}
        >
          <Download className="h-3.5 w-3.5" strokeWidth={2.25} />
        </button>
      ) : null}
      <button
        type="button"
        className={`nodrag shrink-0 bg-transparent p-0.5 disabled:opacity-40 ${
          hasMedia
            ? isDark
              ? 'text-violet-300/90 hover:text-violet-200'
              : 'text-violet-600 hover:text-violet-700'
            : isDark
              ? 'text-zinc-500'
              : 'text-zinc-400'
        }`}
        disabled={!hasMedia}
        title={playing ? '暂停' : '播放'}
        aria-label={playing ? '暂停' : '播放'}
        onClick={toggle}
      >
        {playing ? (
          <Pause className="h-3.5 w-3.5" strokeWidth={2.25} />
        ) : (
          <Play className="ml-px h-3.5 w-3.5" strokeWidth={2.25} />
        )}
      </button>
      <div
        className={`relative h-10 min-w-0 flex-1 overflow-hidden rounded-sm ${
          hasMedia ? '' : 'opacity-80'
        }`}
        title={hasMedia ? (playing ? '点击暂停' : '点击播放') : '暂无音频'}
        onClick={toggle}
      >
        <AudioWaveformVisualizer
          isPlaying={playing}
          isDarkMode={isDark}
          variant="main"
          fillContainer
          muted={!hasMedia}
          playAnim="normal"
          seed={url || 'empty-voice-bar'}
          shellRoundedClass="rounded-sm"
          className="pointer-events-none nexflow-audio-waveform-fill"
        />
      </div>
      <button
        type="button"
        className={`nodrag flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[14px] leading-none ${
          isDark
            ? 'bg-black/55 text-white/80 hover:bg-black/75 hover:text-white'
            : 'bg-black/40 text-white/90 hover:bg-black/60'
        }`}
        title="清除音频"
        aria-label="清除音频"
        onClick={(e) => {
          e.stopPropagation();
          setPlaying(false);
          onClear();
        }}
      >
        ×
      </button>
      <ModuleProgressBar
        visible={generating}
        progress={generating ? 35 : 100}
        solidBackground={isDark ? '#1C1C1E' : '#e5e7eb'}
        progressMessage="正在生成声音..."
        borderRadius={8}
      />
    </div>
  );
}

function DramaCharacterVoiceSlot({
  session,
  characterId,
  isDark,
  generating,
  onChange,
  onDropFile,
}: {
  session: DramaDirectorSession;
  characterId: string;
  isDark: boolean;
  generating: boolean;
  onChange: (s: DramaDirectorSession) => void;
  onDropFile?: (voiceId: string, file: File) => void;
}) {
  const voice = findVoiceForCharacter(session, characterId);
  const voiceId = String(voice?.voice_id || '').trim();
  const sampleUrl = String(voice?.sample_url || '').trim();
  const chName =
    session.bible.characters.find((c) => c.character_id === characterId)?.name ||
    voice?.timbre ||
    voiceId;
  if (!voiceId) return null;
  return (
    <DramaLiteVoiceBar
      url={sampleUrl}
      isDark={isDark}
      generating={generating}
      downloadName={chName}
      onClear={() => onChange(clearDomainVoiceSample(session, voiceId))}
      onDropFile={(file) => onDropFile?.(voiceId, file)}
      onDropUrl={(sampleUrl) => onChange(setDomainVoiceSample(session, voiceId, sampleUrl))}
    />
  );
}

function DramaSystemVoiceCard({
  session,
  pipeline,
  isDark,
  voiceGenerating,
  imageGenerating,
  unitVoicePriceLabel,
  unitImagePriceLabel,
  canPickVoiceFromCanvas,
  canPickFromCanvas,
  onChange,
  onGenerateVoice,
  onUploadVoice,
  onPickVoiceFromCanvas,
  onGenerateImage,
  onUploadImage,
  onUploadImageFile,
  onPickImageFromCanvas,
  onClearImage,
  onEditVoicePrompt,
  onEditImagePrompt,
  onDropFile,
}: {
  session: DramaDirectorSession;
  pipeline?: DirectorPipelineState;
  isDark: boolean;
  voiceGenerating: boolean;
  imageGenerating: boolean;
  unitVoicePriceLabel?: string;
  unitImagePriceLabel?: string | null;
  canPickVoiceFromCanvas?: boolean;
  canPickFromCanvas?: boolean;
  onChange: (s: DramaDirectorSession) => void;
  onGenerateVoice?: (voiceId: string) => void;
  onUploadVoice?: (voiceId: string) => void;
  onPickVoiceFromCanvas?: (voiceId: string) => void;
  onGenerateImage?: () => void;
  onUploadImage?: () => void;
  onUploadImageFile?: (file: File) => void;
  onPickImageFromCanvas?: () => void;
  onClearImage?: () => void;
  onEditVoicePrompt: () => void;
  onEditImagePrompt: () => void;
  onDropFile?: (voiceId: string, file: File) => void;
}) {
  const voice = resolveDramaSystemVoice(session);
  const voiceId = String(voice?.voice_id || '').trim();
  const sampleUrl = String(voice?.sample_url || voice?.identity?.reference_audio || '').trim();
  const voiceImageUrl = String(voice?.imageUrl || '').trim();
  const pipeImageUrl = pickPipelineAssetImage(
    pipeline?.assets?.characters,
    DRAMA_SYSTEM_SPEAKER_ID,
    '系统提示音',
  );
  // 任务成功常先写 pipeline：Domain 空/生成中/与 pipeline 不一致时，以 pipeline 成图为准
  const imageUrl = toDisplayableDramaMediaUrl(
    pipeImageUrl &&
      (!voiceImageUrl ||
        voice?.image_status === 'generating' ||
        imageGenerating ||
        pipeImageUrl !== voiceImageUrl)
      ? pipeImageUrl
      : voiceImageUrl || pipeImageUrl,
  );
  const mediaAspect = '9 / 16';
  if (!dramaSessionNeedsSystemVoice(session)) return null;
  if (!voiceId) return null;
  return (
    <div className="relative z-[1] w-full min-w-0 flex flex-col gap-1.5 hover:z-30">
      <div className={`${cardCls(isDark)} relative z-[20] flex flex-col overflow-visible`}>
        <div
          className={`group/img relative w-full overflow-hidden rounded-t-xl ${
            isDark ? 'bg-black/40' : 'bg-gray-100'
          }`}
          data-drama-drop="image"
          onDragOver={(e) => {
            if (
              !peekCanvasImageDragUrl() &&
              !Array.from(e.dataTransfer.types || []).some(
                (t) =>
                  t === NEXFLOW_CANVAS_IMAGE_DRAG_MIME ||
                  t === 'text/uri-list' ||
                  t === 'Files',
              )
            ) {
              return;
            }
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={(e) => {
            const file = e.dataTransfer.files?.[0];
            if (file && String(file.type || '').startsWith('image/')) {
              e.preventDefault();
              e.stopPropagation();
              if (onUploadImageFile) {
                onUploadImageFile(file);
                return;
              }
              onUploadImage?.();
              return;
            }
            const canvasUrl = peekCanvasImageDragUrl() || readDramaDropImageUrl(e.dataTransfer);
            if (!canvasUrl) return;
            e.preventDefault();
            e.stopPropagation();
            endCanvasImageDrag();
            onChange(
              applyDramaSessionAssetImage(session, DRAMA_SYSTEM_SPEAKER_ID, {
                imageUrl: canvasUrl,
                status: 'ready',
              }) || session,
            );
          }}
        >
          {imageUrl ? (
            <RefImageHoverThumb
              key={`${imageUrl}:${Number(voice?.asset_version) || 1}`}
              url={imageUrl}
              alt=""
              title="悬停放大"
              objectFit="cover"
              previewBorderless
              boxAspect={mediaAspect}
              listThumbMaxEdge={288}
              cacheNonce={Number(voice?.asset_version) || 1}
              className="w-full"
            />
          ) : (
            <DramaEmptyAssetImageSlot
              isDark={isDark}
              generating={imageGenerating}
              aspect={mediaAspect}
              onUpload={onUploadImage}
            />
          )}
          <ModuleProgressBar
            visible={imageGenerating}
            progress={imageGenerating ? 35 : 100}
            solidBackground={isDark ? '#1C1C1E' : '#e5e7eb'}
            progressMessage="正在生成图片..."
            borderRadius={8}
          />
          {imageUrl ? (
            <button
              type="button"
              className={`nodrag absolute top-1 left-1 z-[60] flex h-5 w-5 items-center justify-center rounded-full ${
                isDark
                  ? 'bg-black/55 text-white/80 hover:bg-black/75 hover:text-white'
                  : 'bg-black/40 text-white/90 hover:bg-black/60'
              }`}
              title="下载图片"
              aria-label="下载图片"
              onClick={(e) => {
                e.stopPropagation();
                void downloadDramaAssetImage(imageUrl, '系统提示音');
              }}
            >
              <Download className="h-3 w-3" strokeWidth={2.5} />
            </button>
          ) : null}
          <button
            type="button"
            className={`nodrag absolute top-1 right-1 z-[60] flex h-5 w-5 items-center justify-center rounded-full text-[14px] leading-none ${
              isDark
                ? 'bg-black/55 text-white/80 hover:bg-black/75 hover:text-white'
                : 'bg-black/40 text-white/90 hover:bg-black/60'
            }`}
            title="删除系统提示音卡（本剧本没有系统播报时可关掉）"
            aria-label="删除系统提示音卡"
            onClick={(e) => {
              e.stopPropagation();
              onChange(suppressDramaSystemVoice(session));
            }}
          >
            ×
          </button>
        </div>
        <div className="relative z-[50] flex min-w-0 items-center justify-center gap-1.5 px-2 py-1.5">
          <span
            className={`min-w-0 truncate text-center text-[12px] font-medium ${
              isDark ? 'text-white/90' : 'text-gray-900'
            }`}
          >
            系统提示音
          </span>
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none ${
              isDark ? 'bg-violet-500/25 text-violet-100' : 'bg-violet-100 text-violet-800'
            }`}
          >
            系统形象
          </span>
          {!imageUrl ? (
            <span
              className={`shrink-0 rounded px-1 py-0.5 text-[10px] ${
                isDark ? 'bg-amber-500/25 text-amber-200' : 'bg-amber-100 text-amber-800'
              }`}
            >
              需设计
            </span>
          ) : null}
        </div>
      </div>
      <DramaLiteVoiceBar
        url={sampleUrl}
        isDark={isDark}
        generating={voiceGenerating}
        downloadName="系统提示音"
        onClear={() => onChange(clearDomainVoiceSample(session, voiceId))}
        onDropFile={(file) => onDropFile?.(voiceId, file)}
        onDropUrl={(url) => onChange(setDomainVoiceSample(session, voiceId, url))}
      />
      <div className="relative z-[40] flex w-full items-start gap-1">
        <DramaAssetSourceMenu
          isDark={isDark}
          generating={imageGenerating}
          generatingLabel="生成中"
          primaryLabel="图片生成"
          priceLabel={unitImagePriceLabel}
          showLibrary={false}
          canPickFromCanvas={!!canPickFromCanvas}
          onGenerate={() => onGenerateImage?.()}
          onUpload={() => onUploadImage?.()}
          onPickCanvas={() => onPickImageFromCanvas?.()}
          promptLabel="图片提示词"
          onEditPrompt={onEditImagePrompt}
        />
        <DramaAssetSourceMenu
          isDark={isDark}
          generating={voiceGenerating}
          generatingLabel="生成中"
          primaryLabel="声音生成"
          priceLabel={unitVoicePriceLabel}
          showLibrary={false}
          canPickFromCanvas={!!canPickVoiceFromCanvas}
          onGenerate={() => onGenerateVoice?.(voiceId)}
          onUpload={() => onUploadVoice?.(voiceId)}
          onPickCanvas={() => onPickVoiceFromCanvas?.(voiceId)}
          promptLabel="声音提示词"
          onEditPrompt={onEditVoicePrompt}
        />
      </div>
    </div>
  );
}

function resolveCostumePullUpThumbUrl(
  ch: DramaCharacter,
  costume: DramaCharacterCostume,
  pipeline?: DirectorPipelineState,
  localPicks?: DramaLibraryPickItem[],
): string {
  const own = dramaCostumeImageUrl(costume);
  if (own) return toDisplayableDramaMediaUrl(own);
  const fromPipe = pickPipelineAssetImage(
    pipeline?.assets?.characters,
    costume.costume_id,
    '',
  );
  if (fromPipe) return toDisplayableDramaMediaUrl(fromPipe);
  const list = ch.costumes || [];
  const idx = list.findIndex((x) => x.costume_id === costume.costume_id);
  const isDefault = idx === 0 || String(costume.name || '').trim() === '默认服装';
  if (!isDefault) return '';
  const otherOwnsImage = list.some(
    (x) => x.costume_id !== costume.costume_id && !!dramaCostumeImageUrl(x),
  );
  const fromCharacter = otherOwnsImage
    ? ''
    : resolveCharacterMasterReferenceUrl(ch) || String(ch.imageUrl || '').trim();
  return toDisplayableDramaMediaUrl(
    fromCharacter ||
      pickPipelineAssetImage(pipeline?.assets?.characters, ch.character_id, ch.name) ||
      pickDramaLibraryImageUrl(ch.name, localPicks || []),
  );
}

function DramaCharacterCostumePullUp({
  session,
  characterId,
  isDark,
  open,
  onClose,
  onChange,
  anchorRef,
  showConfirm,
  pipeline,
  localPicks,
  onUploadCostumeImage,
}: {
  session: DramaDirectorSession;
  characterId: string;
  isDark: boolean;
  open: boolean;
  onClose: () => void;
  onChange: (s: DramaDirectorSession) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  showConfirm: (message: string) => Promise<boolean>;
  pipeline?: DirectorPipelineState;
  localPicks?: DramaLibraryPickItem[];
  onUploadCostumeImage?: (costumeId: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const ch = session.bible.characters.find((c) => c.character_id === characterId);
  const costumes = ch?.costumes || [];
  const active = ch ? activeDramaCostume(ch) || costumes[0] : undefined;

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setPos(null);
      return;
    }
    const place = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(280, Math.max(220, Math.round(r.width * 2.2)));
      let left = r.left + r.width / 2 - width / 2;
      left = Math.min(Math.max(8, left), window.innerWidth - width - 8);
      const estimatedH = 260;
      let top = r.bottom + 6;
      if (top + estimatedH > window.innerHeight - 8) {
        top = Math.max(8, r.top - 6 - estimatedH);
      }
      setPos({ left, top, width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef, costumes.length]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (panelRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !pos || !ch) return null;

  const itemCls = `nodrag flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] ${
    isDark ? 'hover:bg-white/10 text-white/90' : 'hover:bg-gray-100 text-gray-800'
  }`;
  const actionCls = `nodrag flex w-full items-center justify-center rounded-lg px-2.5 py-2 text-[12px] font-medium ${
    isDark ? 'bg-sky-500/80 text-white hover:bg-sky-500' : 'bg-gray-900 text-white'
  }`;

  return createPortal(
    <div
      ref={panelRef}
      className={`fixed z-[100060] overflow-hidden rounded-xl shadow-2xl ${
        isDark ? 'bg-[#1c1c1e] ring-1 ring-white/15 text-white' : 'bg-white ring-1 ring-gray-200 text-gray-900'
      }`}
      style={{ left: pos.left, top: pos.top, width: pos.width }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={`border-b px-3 py-2 text-[11px] ${isDark ? 'border-white/10 text-white/55' : 'border-gray-200 text-gray-500'}`}>
        {ch.name || '人物'} · 造型
      </div>
      <div className="max-h-[12rem] overflow-auto p-1.5 custom-scrollbar-dark">
        {costumes.length ? (
          costumes.map((c) => {
            const on = c.costume_id === active?.costume_id;
            const thumb = resolveCostumePullUpThumbUrl(ch, c, pipeline, localPicks);
            return (
              <div key={c.costume_id} className="flex items-stretch gap-0.5">
                <button
                  type="button"
                  className={`nodrag relative mt-1.5 h-8 w-8 shrink-0 overflow-hidden rounded-md ${
                    isDark
                      ? 'bg-black/40 text-white/45 hover:ring-1 hover:ring-white/35'
                      : 'bg-gray-100 text-gray-400 hover:ring-1 hover:ring-gray-300'
                  }`}
                  title={thumb ? '点击更换造型图' : '点击上传造型图'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUploadCostumeImage?.(c.costume_id);
                  }}
                >
                  {thumb ? (
                    <img src={thumb} alt="" className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-[9px] leading-none">
                      上传
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className={`${itemCls} ${on ? (isDark ? 'bg-violet-500/25' : 'bg-violet-50') : ''}`}
                  onClick={() => {
                    onChange(setActiveCharacterCostume(session, characterId, c.costume_id));
                    onClose();
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{c.name || '未命名造型'}</span>
                  {on ? (
                    <span className={`shrink-0 text-[10px] ${isDark ? 'text-violet-200' : 'text-violet-700'}`}>
                      当前
                    </span>
                  ) : null}
                </button>
                {costumes.length > 1 ? (
                  <button
                    type="button"
                    className={`nodrag shrink-0 rounded-lg px-2 text-[11px] ${
                      isDark
                        ? 'text-rose-300/90 hover:bg-rose-500/20'
                        : 'text-rose-600 hover:bg-rose-50'
                    }`}
                    title="删除这套造型"
                    onClick={(e) => {
                      e.stopPropagation();
                      void (async () => {
                        const ok = await showConfirm(
                          `确定删除造型「${c.name || '未命名'}」？删除后不可恢复。`,
                        );
                        if (!ok) return;
                        onChange(removeDramaCharacterCostume(session, characterId, c.costume_id));
                      })();
                    }}
                  >
                    删除
                  </button>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className={`px-2 py-3 text-center text-[12px] ${mutedCls(isDark)}`}>暂无造型</div>
        )}
      </div>
      <div className={`flex flex-col gap-1 border-t p-2 ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        <button
          type="button"
          className={actionCls}
          onClick={() => {
            onChange(addBlankDramaCharacterCostume(session, characterId));
            onClose();
          }}
        >
          新建造型
        </button>
      </div>
    </div>,
    document.body,
  );
}

function DramaCharacterCostumePanel({
  session,
  characterId,
  isDark,
  assetGeneratingIds,
  unitImagePriceLabel,
  canPickFromCanvas,
  onChange,
  onClose,
  onGenerateAssetImage,
  onUploadAssetImage,
  onPickAssetFromCanvas,
}: {
  session: DramaDirectorSession;
  characterId: string;
  isDark: boolean;
  assetGeneratingIds?: Record<string, true>;
  unitImagePriceLabel?: string | null;
  canPickFromCanvas?: boolean;
  onChange: (s: DramaDirectorSession) => void;
  onClose: () => void;
  onGenerateAssetImage?: (kind: DramaAssetVisualKind, assetId: string) => void;
  onUploadAssetImage?: (kind: DramaAssetVisualKind, assetId: string, file: File) => void;
  onPickAssetFromCanvas?: (kind: DramaAssetVisualKind, assetId: string) => void;
}) {
  const character = session.bible.characters.find((c) => c.character_id === characterId);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const uploadCostumeIdRef = useRef<string | null>(null);
  if (!character) return null;
  const costumes = character.costumes || [];
  const groups = groupDramaCostumesByTag(costumes);

  const addCostume = () => {
    const n = costumes.length + 1;
    onChange(
      patchCharacterCostumes(session, characterId, (list) => [
        ...list,
        createEmptyDramaCharacterCostume({
          name: `造型${n}`,
          prompt: '',
          active: false,
          tag: '其他',
        }),
      ]),
    );
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[240] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/55" />
      <div
        className={`relative z-[1] flex max-h-[min(90vh,44rem)] w-[min(72rem,96vw)] flex-col overflow-hidden rounded-2xl border shadow-2xl ${
          isDark ? 'border-white/12 bg-[#12141a] text-white' : 'border-gray-200 bg-white text-gray-900'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0] || null;
            e.target.value = '';
            const costumeId = uploadCostumeIdRef.current;
            uploadCostumeIdRef.current = null;
            if (!file || !costumeId) return;
            if (onUploadAssetImage) {
              onUploadAssetImage('characters', costumeId, file);
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = String(reader.result || '');
              if (!dataUrl) return;
              onChange(
                patchCharacterCostumes(session, characterId, (list) =>
                  list.map((c) =>
                    c.costume_id === costumeId
                      ? { ...c, images: [dataUrl, ...c.images.filter((u) => u !== dataUrl)] }
                      : c,
                  ),
                ),
              );
            };
            reader.readAsDataURL(file);
          }}
        />
        <div
          className={`flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2.5 ${
            isDark ? 'border-white/10' : 'border-gray-200'
          }`}
        >
          <div className="min-w-0">
            <div className="truncate text-[15px] font-medium">
              {character.name || '人物'} · 造型管理
            </div>
            <div className={`text-[11px] ${mutedCls(isDark)}`}>
              同一人物可有多套造型；点「设为当前」会同步到人物主卡与分镜参考
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className={`nodrag rounded-md px-2.5 py-1 text-[12px] ${
                isDark ? 'bg-sky-500/80 text-white hover:bg-sky-500' : 'bg-gray-900 text-white'
              }`}
              onClick={addCostume}
            >
              + 新建造型
            </button>
            <button
              type="button"
              className={`nodrag rounded-md px-2.5 py-1 text-[12px] ${
                isDark ? 'bg-white/10 hover:bg-white/15' : 'bg-gray-100 hover:bg-gray-200'
              }`}
              onClick={onClose}
            >
              关闭
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 custom-scrollbar-dark">
          {groups.map((group) => (
            <div key={group.tag} className="mb-4 last:mb-0">
              <div className={`mb-2 text-[12px] font-medium ${mutedCls(isDark)}`}>
                {group.tag}
                <span className="ml-1.5 opacity-70">({group.items.length})</span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {group.items.map((cos) => {
                  const img = dramaCostumeImageUrl(cos);
                  const generating = !!assetGeneratingIds?.[cos.costume_id];
                  return (
                    <div key={cos.costume_id} className="flex min-w-0 flex-col gap-1">
                      <div className={`${cardCls(isDark)} overflow-hidden flex flex-col`}>
                        <div
                          className={`group/img relative w-full overflow-hidden ${
                            isDark ? 'bg-black/40' : 'bg-gray-100'
                          }`}
                        >
                          {img ? (
                            <RefImageHoverThumb
                              key={img}
                              url={img}
                              alt=""
                              title="悬停放大"
                              objectFit="cover"
                              previewBorderless
                              boxAspect="9 / 16"
                              cacheNonce={img}
                              className="w-full"
                            />
                          ) : (
                            <div
                              className={`flex w-full items-center justify-center text-[11px] px-2 text-center ${mutedCls(isDark)}`}
                              style={{ aspectRatio: '9 / 16' }}
                              aria-hidden={generating}
                            >
                              {generating ? '' : '待生成/上传'}
                            </div>
                          )}
                          <ModuleProgressBar
                            visible={generating}
                            progress={generating ? 35 : 100}
                            solidBackground={isDark ? '#1C1C1E' : '#e5e7eb'}
                            progressMessage="正在生成装扮..."
                            borderRadius={8}
                          />
                          {cos.active ? (
                            <span className="absolute left-1 top-7 z-[50] rounded bg-sky-500/90 px-1.5 py-0.5 text-[10px] text-white">
                              当前
                            </span>
                          ) : null}
                          {img ? (
                            <button
                              type="button"
                              className={`nodrag absolute top-1 left-1 z-[60] flex h-5 w-5 items-center justify-center rounded-full ${
                                isDark
                                  ? 'bg-black/55 text-white/80 hover:bg-black/75'
                                  : 'bg-black/40 text-white/90 hover:bg-black/60'
                              }`}
                              title="下载图片"
                              onClick={(e) => {
                                e.stopPropagation();
                                void downloadDramaAssetImage(img, cos.name || cos.costume_id || 'costume');
                              }}
                            >
                              <Download className="h-3 w-3" strokeWidth={2.5} />
                            </button>
                          ) : null}
                          {costumes.length > 1 ? (
                            <button
                              type="button"
                              className={`nodrag absolute top-1 right-1 z-[60] flex h-5 w-5 items-center justify-center rounded-full text-[14px] leading-none ${
                                isDark
                                  ? 'bg-black/55 text-white/80 hover:bg-black/75'
                                  : 'bg-black/40 text-white/90 hover:bg-black/60'
                              }`}
                              title="删除这套装扮"
                              onClick={(e) => {
                                e.stopPropagation();
                                const remain = costumes.filter((c) => c.costume_id !== cos.costume_id);
                                const next = remain.some((c) => c.active)
                                  ? remain
                                  : remain.map((c, i) => ({ ...c, active: i === 0 }));
                                onChange(
                                  patchCharacterCostumes(session, characterId, () => next),
                                );
                              }}
                            >
                              ×
                            </button>
                          ) : null}
                        </div>
                        <DramaAssetPromptFold
                          value={cos.prompt || ''}
                          placeholder="这一套衣服：款式、颜色、材质、配饰；脸发型与人物一致"
                          isDark={isDark}
                          label="装扮提示词"
                          onChange={(text) =>
                            onChange(
                              patchCharacterCostumes(session, characterId, (list) =>
                                list.map((c) =>
                                  c.costume_id === cos.costume_id ? { ...c, prompt: text } : c,
                                ),
                              ),
                            )
                          }
                        />
                        <div className="px-2 py-1.5">
                          <input
                            type="text"
                            className={`nodrag w-full bg-transparent text-center text-[12px] font-medium outline-none ${
                              isDark ? 'text-white/90' : 'text-gray-900'
                            }`}
                            value={cos.name}
                            placeholder="装扮名"
                            onChange={(e) =>
                              onChange(
                                patchCharacterCostumes(session, characterId, (list) =>
                                  list.map((c) =>
                                    c.costume_id === cos.costume_id
                                      ? { ...c, name: e.target.value }
                                      : c,
                                  ),
                                ),
                              )
                            }
                            onPointerDown={(e) => e.stopPropagation()}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-1 [grid-auto-rows:1.85rem]">
                        <DramaYuanbaoHoverWrap priceLabel={unitImagePriceLabel} className="min-w-0">
                          <button
                            type="button"
                            className={`nodrag h-full w-full rounded-md text-[10px] ${
                              isDark ? 'bg-sky-500/70 text-white' : 'bg-gray-900 text-white'
                            }`}
                            disabled={generating}
                            onClick={() => onGenerateAssetImage?.('characters', cos.costume_id)}
                          >
                            {generating ? '生成中' : 'AI 生成'}
                          </button>
                        </DramaYuanbaoHoverWrap>
                        <button
                          type="button"
                          className={`nodrag rounded-md text-[10px] ${
                            isDark ? 'bg-white/10' : 'bg-gray-100'
                          }`}
                          onClick={() => {
                            uploadCostumeIdRef.current = cos.costume_id;
                            fileRef.current?.click();
                          }}
                        >
                          上传
                        </button>
                        <button
                          type="button"
                          className={`nodrag rounded-md text-[10px] disabled:opacity-40 ${
                            isDark ? 'bg-white/10' : 'bg-gray-100'
                          }`}
                          disabled={!canPickFromCanvas || !onPickAssetFromCanvas}
                          onClick={() => onPickAssetFromCanvas?.('characters', cos.costume_id)}
                        >
                          画布
                        </button>
                      </div>
                      <button
                        type="button"
                        className={`nodrag h-7 rounded-md text-[11px] ${
                          cos.active
                            ? isDark
                              ? 'bg-sky-500/25 text-sky-100'
                              : 'bg-sky-100 text-sky-800'
                            : isDark
                              ? 'bg-white/10 text-white/80 hover:bg-white/12'
                              : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                        }`}
                        onClick={() =>
                          onChange(setActiveCharacterCostume(session, characterId, cos.costume_id))
                        }
                      >
                        {cos.active ? '当前使用中' : '设为当前'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function DramaAssetLibraryPanel({
  session,
  pipeline,
  projectId,
  isDark,
  busy,
  onChange,
  imageGenToolbarSlot,
  unitImagePriceLabel,
  batchImagePriceLabel,
  onGenerateAssetImage,
  onUploadAssetImage,
  onPickAssetFromCanvas,
  canPickFromCanvas,
  onClearAssetImage,
  assetGeneratingIds,
  unitChatPriceLabel,
  unitVoicePriceLabel,
  batchVoicePriceLabel,
  canPickVoiceFromCanvas,
  onGenerateVoice,
  onGenerateVoices,
  onUploadVoice,
  onPickVoiceFromCanvas,
  showAlert,
  runChat,
  chatModel,
  onEnterNext,
  onMatchAssets: _onMatchAssets,
  assetMatchDone: _assetMatchDone,
}: {
  session: DramaDirectorSession;
  pipeline?: DirectorPipelineState;
  projectId?: string | null;
  isDark: boolean;
  busy?: boolean;
  onChange: (s: DramaDirectorSession) => void;
  imageGenToolbarSlot?: React.ReactNode;
  unitImagePriceLabel?: string | null;
  batchImagePriceLabel?: string | null;
  onGenerateAssetImage?: (kind: DramaAssetVisualKind, assetId: string) => void;
  onUploadAssetImage?: (kind: DramaAssetVisualKind, assetId: string, file: File) => void;
  onPickAssetFromCanvas?: (kind: DramaAssetVisualKind, assetId: string) => void;
  canPickFromCanvas?: boolean;
  onClearAssetImage?: (kind: DramaAssetVisualKind, assetId: string) => void;
  assetGeneratingIds?: Record<string, true>;
  unitChatPriceLabel?: string | null;
  unitVoicePriceLabel?: string | null;
  batchVoicePriceLabel?: string | null;
  canPickVoiceFromCanvas?: boolean;
  onGenerateVoice?: (voiceId: string) => void;
  onGenerateVoices?: (voiceIds: string[]) => void;
  onUploadVoice?: (voiceId: string, file: File) => void;
  onPickVoiceFromCanvas?: (voiceId: string) => void;
  showAlert?: (msg: string) => void;
  runChat?: (
    systemPrompt: string,
    userPrompt: string,
    opts?: { max_tokens?: number; temperature?: number; model?: string },
  ) => Promise<string>;
  chatModel?: string;
  onEnterNext?: () => void;
  onMatchAssets?: () => void;
  assetMatchDone?: boolean;
}) {
  const { showConfirm } = useDarkAlert();
  const [tab, setTab] = useState<DramaAssetVisualKind>('characters');
  const [costumeViewerId, setCostumeViewerId] = useState<string | null>(null);
  const [costumeMenuId, setCostumeMenuId] = useState<string | null>(null);
  const costumeTagRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const costumeMenuAnchorRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    costumeMenuAnchorRef.current = costumeMenuId
      ? costumeTagRefs.current[costumeMenuId] || null
      : null;
  }, [costumeMenuId]);
  const [libraryPick, setLibraryPick] = useState<{
    characterId: string | null;
    prefer: DramaLibraryPickMode;
  } | null>(null);
  const [dragAssetId, setDragAssetId] = useState<string | null>(null);
  const [dragOverAssetId, setDragOverAssetId] = useState<string | null>(null);
  const [promptEdit, setPromptEdit] = useState<null | {
    mode: 'image' | 'voice';
    assetId: string;
  }>(null);
  const missingDesign = listCharactersMissingDesign(session);
  const [localPicks, setLocalPicks] = useState<DramaLibraryPickItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [cast, lib] = await Promise.all([
        loadDramaCastLibraryPicks(projectId),
        loadDramaCharacterLibraryPicks(),
      ]);
      if (!cancelled) setLocalPicks([...cast, ...lib]);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    let next = stripDramaSystemSpeakerCharacters(syncDramaSystemVoice(session));
    next = ensureVoiceSampleTexts(next);
    if (next !== session) onChange(next);
  }, [onChange, session]);

  // 系统形象：pipeline/任务已成图但 Voice.imageUrl 未对齐时收回（修「任务列表有图、卡片不更新」）
  useEffect(() => {
    const sys = resolveDramaSystemVoice(session);
    if (!sys) return;
    const pipeUrl = pickPipelineAssetImage(
      pipeline?.assets?.characters,
      DRAMA_SYSTEM_SPEAKER_ID,
      '系统提示音',
    );
    if (!pipeUrl) return;
    const own = String(sys.imageUrl || '').trim();
    if (own === pipeUrl && sys.image_status !== 'generating') return;
    const patched = applyDramaSessionAssetImage(session, DRAMA_SYSTEM_SPEAKER_ID, {
      imageUrl: pipeUrl,
      status: 'ready',
    });
    if (patched) onChange(patched);
  }, [onChange, session, pipeline?.assets?.characters]);

  // 人物主卡：生成中/对账漏写时，用 pipeline 人物 id 成图收回（含造型槽被旧图钉死）
  useEffect(() => {
    const pipeList = pipeline?.assets?.characters || [];
    if (!pipeList.length) return;
    let next = session;
    let changed = false;
    for (const ch of session.bible.characters || []) {
      if (isDramaSystemSpeakerCharacter(ch)) continue;
      const id = String(ch.character_id || '').trim();
      if (!id) continue;
      const pipeUrl = pickPipelineAssetImage(pipeList, id, ch.name);
      if (!pipeUrl) continue;
      const own = String(ch.imageUrl || '').trim();
      const st = String(ch.status || '').trim();
      const generating = st === 'generating' || !!assetGeneratingIds?.[id];
      const activeLook = activeDramaCostume(ch);
      const lookUrl = dramaCostumeImageUrl(activeLook);
      const lookStale = !!own && own === pipeUrl && !!lookUrl && lookUrl !== own;
      if (generating) {
        // 仍是旧定妆时不要提前收口；等 pipeline 换成新图再写回
        if (pipeUrl === own) continue;
      } else if (lookStale) {
        // 主卡已新、造型仍旧
      } else if (!own) {
        // 主卡空，补上
      } else {
        continue;
      }
      const patched = applyDramaSessionAssetImage(next, id, {
        imageUrl: pipeUrl,
        status: 'ready',
      });
      if (patched) {
        next = patched;
        changed = true;
      }
    }
    if (changed) onChange(next);
  }, [onChange, session, pipeline?.assets?.characters, assetGeneratingIds]);

  const hydrateEmptyLooks = useCallback(
    async (base: DramaDirectorSession) => {
      let next = promoteDramaCharacterMasterImages(base) || base;
      try {
        const castPicks = await loadDramaCastLibraryPicks(projectId);
        next = fillEmptyDramaAssetsFromLibraryPicks(next, castPicks).session;
      } catch {
        /* 本剧人物库读失败时继续从画布/全局库找回 */
      }
      const fromPipe = restoreDramaBibleMediaFromPipeline(next, pipeline?.assets);
      if (fromPipe) next = fromPipe;
      const pipePicks = (pipeline?.assets?.characters || [])
        .filter((a) => String(a.imageUrl || '').trim())
        .map((a) => ({
          name: String(a.name || '').trim(),
          imageUrl: String(a.imageUrl || '').trim(),
          voiceUrl: '',
        }));
      if (pipePicks.length) {
        next = fillEmptyDramaAssetsFromLibraryPicks(next, pipePicks).session;
      }
      try {
        const picks = await loadDramaCharacterLibraryPicks();
        next = fillEmptyDramaAssetsFromLibraryPicks(next, picks).session;
      } catch {
        /* 角色库读失败时仍保留前面找回结果 */
      }
      return next;
    },
    [pipeline?.assets, projectId],
  );

  useEffect(() => {
    // 素材仓库热路径：只补缺造型。禁止在点「+」时重扫剧本/整会话迁移，否则新建人物会卡死。
    const needsCostumeSeed = (session.bible.characters || []).some(
      (c) => !(c.costumes || []).length,
    );
    if (!needsCostumeSeed) return;
    const next = ensureCharacterCostumes(session);
    if (next !== session) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.bible.characters.length]);

  const autoHydrateKeyRef = useRef('');
  useEffect(() => {
    const generatingNow = (session.bible.characters || []).some(
      (c) => c.status === 'generating' || !!assetGeneratingIds?.[c.character_id],
    );
    if (generatingNow) return;
    const missing = listCharactersMissingDesign(session);
    const hydratableN = missing.filter((c) => {
      const name = String(c.name || '').trim();
      if (!name) return false;
      if (isDramaManualCharacterCardName(name)) return false;
      return true;
    }).length;
    const needsPromote = (session.bible.characters || []).some(
      (c) => !String(c.imageUrl || '').trim() && characterHasUsableReference(c),
    );
    const charIds = (session.bible.characters || []).map((c) => c.character_id).join(',');
    const pipeN = (pipeline?.assets?.characters || []).filter((a) => String(a.imageUrl || '').trim()).length;
    const key = `v5:${projectId || ''}:${charIds}:${hydratableN}:${needsPromote ? 1 : 0}:${pipeN}`;
    if (autoHydrateKeyRef.current === key) return;
    if (!needsPromote && hydratableN === 0) return;
    autoHydrateKeyRef.current = key;
    let cancelled = false;
    void (async () => {
      const next = await hydrateEmptyLooks(session);
      if (cancelled) return;
      const stillGenerating = (session.bible.characters || []).some(
        (c) => c.status === 'generating' || !!assetGeneratingIds?.[c.character_id],
      );
      if (stillGenerating) return;
      const before = (session.bible.characters || [])
        .map((c) => `${c.character_id}:${c.imageUrl || ''}`)
        .join('|');
      const after = (next.bible.characters || [])
        .map((c) => `${c.character_id}:${c.imageUrl || ''}`)
        .join('|');
      if (before !== after) onChange(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [assetGeneratingIds, hydrateEmptyLooks, onChange, projectId, session]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const voiceFileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetRef = useRef<{ kind: DramaAssetVisualKind; id: string } | null>(null);
  const voiceUploadTargetRef = useRef<string | null>(null);

  const tabs = [
    ['characters', '人物', session.bible.characters.length],
    ['scenes', '场景', session.bible.scenes.length],
    ['props', '道具', session.bible.props.length],
    ['creatures', '生物', session.bible.creatures.length],
  ] as const;

  const appearanceCharOrder = collectSeriesCharacterAppearanceOrder(session);
  const appearanceSceneOrder = collectOriginalSceneLocationsInOrder(
    session.episode_bibles?.[session.active_episode_id]?.original_scenes || [],
  );

  const list =
    tab === 'characters'
      ? sortDramaCharactersByAppearanceOrder(session.bible.characters, appearanceCharOrder)
          .filter((c) => !isDramaSystemSpeakerCharacter(c))
          .map((c) => {
          const activeLook = activeDramaCostume(c);
          const lookUrl = dramaCostumeImageUrl(activeLook);
          const masterUrl = String(c.imageUrl || '').trim();
          const costumes = c.costumes || [];
          const pipeLook = activeLook
            ? pickPipelineAssetImage(pipeline?.assets?.characters, activeLook.costume_id, '')
            : '';
          const pipeMaster = pickPipelineAssetImage(
            pipeline?.assets?.characters,
            c.character_id,
            c.name,
          );
          const isPrimaryLook =
            !activeLook ||
            costumes[0]?.costume_id === activeLook.costume_id ||
            String(activeLook.name || '').trim() === '默认服装';
          // 当前造型有图就用这一套；禁止用主卡旧 imageUrl 盖住刚生成的造型图。
          // 例外：主卡/pipeline 人物 id 已是新图，造型槽仍钉着旧图 → 用主卡（修「任务有图、卡片不更新」）。
          const masterIsFresh =
            !!masterUrl &&
            !!pipeMaster &&
            masterUrl === pipeMaster &&
            !!lookUrl &&
            lookUrl !== masterUrl;
          const currentLookEmpty = costumes.length > 0 && !lookUrl && !pipeLook && !isPrimaryLook;
          const cardUrl = currentLookEmpty
            ? ''
            : masterIsFresh
              ? masterUrl
              : lookUrl ||
                pipeLook ||
                masterUrl ||
                (isPrimaryLook
                  ? resolveCharacterMasterReferenceUrl(c) ||
                    pipeMaster ||
                    pickDramaLibraryImageUrl(c.name, localPicks)
                  : '');
          return {
            id: c.character_id,
            name: c.name,
            prompt: c.prompt,
            imageUrl: toDisplayableDramaMediaUrl(cardUrl),
            sampleUrl: '',
            status: c.status,
            extra: `${Math.max(c.costumes.length, 1)} 套造型`,
            rev: `${Number(c.asset_version) || 1}:${cardUrl}`,
          };
        })
      : tab === 'scenes'
        ? sortDramaScenesByAppearanceOrder(session.bible.scenes, appearanceSceneOrder).map((s) => ({
            id: s.scene_id,
            name: s.name,
            prompt: s.prompt,
            imageUrl: toDisplayableDramaMediaUrl(
              String(s.imageUrl || '').trim() ||
                resolveSceneMasterReferenceUrl(s) ||
                pickPipelineAssetImage(pipeline?.assets?.scenes, s.scene_id, s.name || s.location),
            ),
            sampleUrl: '',
            status: s.status,
            extra: s.variants.length ? `${s.variants.length} 变体` : s.time_default || '默认',
            rev: Number(s.asset_version) || 1,
          }))
        : tab === 'props'
          ? session.bible.props.map((p) => ({
              id: p.prop_id,
              name: p.name,
              prompt: p.prompt || p.description,
              imageUrl: toDisplayableDramaMediaUrl(
                String(p.imageUrl || '').trim() ||
                  resolvePropMasterReferenceUrl(p) ||
                  pickPipelineAssetImage(pipeline?.assets?.props, p.prop_id, p.name),
              ),
              sampleUrl: '',
              status: p.status,
              extra: p.states.length ? `${p.states.length} 状态` : '',
              rev: Number(p.asset_version) || 1,
            }))
          : session.bible.creatures.map((c) => ({
              id: c.creature_id,
              name: c.name,
              prompt: c.prompt || c.appearance,
              imageUrl: toDisplayableDramaMediaUrl(
                String(c.imageUrl || '').trim() ||
                  pickPipelineAssetImage(pipeline?.assets?.creatures, c.creature_id, c.name) ||
                  pickDramaLibraryImageUrl(c.name, localPicks),
              ),
              sampleUrl: '',
              status: c.status,
              extra: c.behavior,
              rev: Number(c.asset_version) || 1,
            }));

  const isVisualTab = true;
  const systemVoice = resolveDramaSystemVoice(session);
  const systemVoiceGenerating = !!(
    systemVoice &&
    (systemVoice.status === 'generating' || !!assetGeneratingIds?.[systemVoice.voice_id])
  );
  const systemImageGenerating = !!(
    systemVoice &&
    (systemVoice.image_status === 'generating' ||
      !!assetGeneratingIds?.[DRAMA_SYSTEM_SPEAKER_ID])
  );

  const openUpload = (kind: DramaAssetVisualKind, id: string) => {
    uploadTargetRef.current = { kind, id };
    fileInputRef.current?.click();
  };

  const openVoiceUpload = (id: string) => {
    voiceUploadTargetRef.current = id;
    voiceFileInputRef.current?.click();
  };

  const applyVoiceFile = (voiceId: string, file: File | null | undefined) => {
    if (!file || !voiceId) return;
    if (onUploadVoice) {
      onUploadVoice(voiceId, file);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (!dataUrl) return;
      onChange({
        ...session,
        bible: {
          ...session.bible,
          voices: session.bible.voices.map((v) =>
            v.voice_id === voiceId
              ? { ...v, sample_url: dataUrl, status: 'ready' as const, error: undefined }
              : v,
          ),
        },
      });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0] || null;
          e.target.value = '';
          const target = uploadTargetRef.current;
          uploadTargetRef.current = null;
          if (!file || !target) return;
          if (onUploadAssetImage) {
            onUploadAssetImage(target.kind, target.id, file);
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = String(reader.result || '');
            if (dataUrl) onChange(setDomainAssetImage(session, target.kind, target.id, dataUrl));
          };
          reader.readAsDataURL(file);
        }}
      />
      <input
        ref={voiceFileInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac,.aac"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0] || null;
          e.target.value = '';
          const voiceId = voiceUploadTargetRef.current;
          voiceUploadTargetRef.current = null;
          applyVoiceFile(String(voiceId || ''), file);
        }}
      />
      <div className="flex gap-1 flex-wrap items-center">
        <span className={`mr-1 text-[13px] font-medium ${isDark ? 'text-white/80' : 'text-gray-800'}`}>
          本剧素材仓库
          <span className={`ml-1.5 font-normal ${mutedCls(isDark)}`}>全集共用 · 不分集</span>
        </span>
        {tabs.map(([k, label, n]) => (
          <button
            key={k}
            type="button"
            className={`nodrag rounded-md px-2.5 py-1.5 text-[13px] ${
              tab === k
                ? isDark
                  ? 'bg-sky-500/30'
                  : 'bg-sky-100'
                : isDark
                  ? 'bg-white/5'
                  : 'bg-gray-100'
            }`}
            onClick={() => {
              setTab(k);
            }}
          >
            {label} ({n})
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
          {tab === 'characters' && missingDesign.length > 0 ? (
            <span
              className={`rounded-md px-2 py-1 text-[12px] ${
                isDark ? 'bg-amber-500/20 text-amber-200' : 'bg-amber-50 text-amber-800'
              }`}
              title={missingDesign.map((c) => c.name).filter(Boolean).join('、')}
            >
              需设计形象 {missingDesign.length}
            </span>
          ) : null}
          {isVisualTab ? imageGenToolbarSlot : null}
          {isVisualTab ? (
            <DramaYuanbaoHoverWrap
              priceLabel={batchImagePriceLabel || unitImagePriceLabel}
              tipBelow
            >
              <button
                type="button"
                className={`nodrag rounded-lg px-3.5 py-2 text-[13px] font-medium ${
                  isDark ? 'bg-sky-500/80 text-white' : 'bg-gray-900 text-white'
                } disabled:opacity-50`}
                disabled={!!busy}
                onClick={() => {
                  if (tab === 'characters') {
                    void (async () => {
                      const next = await hydrateEmptyLooks(session);
                      const before = (session.bible.characters || [])
                        .map((c) => `${c.character_id}:${c.imageUrl || ''}`)
                        .join('|');
                      const after = (next.bible.characters || [])
                        .map((c) => `${c.character_id}:${c.imageUrl || ''}`)
                        .join('|');
                      if (before !== after) onChange(next);
                      const sys = resolveDramaSystemVoice(next);
                      if (sys && !String(sys.imageUrl || '').trim()) {
                        onGenerateAssetImage?.('characters', DRAMA_SYSTEM_SPEAKER_ID);
                      }
                      for (const c of listCharactersMissingDesign(next)) {
                        onGenerateAssetImage?.('characters', c.character_id);
                      }
                    })();
                    return;
                  }
                  const items =
                    tab === 'scenes'
                      ? session.bible.scenes.map((s) => ({
                          id: s.scene_id,
                          imageUrl: s.imageUrl,
                        }))
                      : tab === 'props'
                        ? session.bible.props.map((p) => ({
                            id: p.prop_id,
                            imageUrl: p.imageUrl,
                          }))
                        : session.bible.creatures.map((c) => ({
                            id: c.creature_id,
                            imageUrl: c.imageUrl,
                          }));
                  for (const item of items) {
                    if (item.imageUrl) continue;
                    onGenerateAssetImage?.(tab, item.id);
                  }
                }}
              >
                {tab === 'characters'
                  ? '一键生成人物'
                  : tab === 'scenes'
                    ? '一键生成场景'
                    : tab === 'props'
                      ? '一键生成道具'
                      : '一键生成生物'}
              </button>
            </DramaYuanbaoHoverWrap>
          ) : null}
          {tab === 'props' && (session.bible.props || []).length > 0 ? (
            <button
              type="button"
              className={`nodrag rounded-lg px-3 py-2 text-[12px] font-medium ${
                isDark
                  ? 'bg-white/10 text-white/85 hover:bg-white/15'
                  : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
              } disabled:opacity-50`}
              disabled={!!busy}
              title="同类只留一条（如多个手机→智能手机），最多保留 5 个"
              onClick={() => {
                const before = (session.bible.props || []).length;
                const nextProps = dedupeDramaPropsByKind(session.bible.props || [], 5);
                if (nextProps.length === before) {
                  showAlert?.('没有可合并的同类道具');
                  return;
                }
                onChange(
                  createEmptyDramaSession({
                    ...session,
                    bible: { ...session.bible, props: nextProps },
                  }),
                );
                showAlert?.(`已合并同类道具：${before} → ${nextProps.length}`);
              }}
            >
              合并同类道具
            </button>
          ) : null}
          {tab === 'props' && listUnusedDramaPropIds(session).length > 0 ? (
            <button
              type="button"
              className={`nodrag rounded-lg px-3 py-2 text-[12px] font-medium ${
                isDark
                  ? 'bg-rose-500/20 text-rose-100 hover:bg-rose-500/30'
                  : 'bg-rose-50 text-rose-800 hover:bg-rose-100'
              } disabled:opacity-50`}
              disabled={!!busy}
              title="删除分镜未绑定、文案也未点名的道具"
              onClick={() => {
                const n = listUnusedDramaPropIds(session).length;
                void showConfirm(`将删除 ${n} 个分镜未使用的道具，可重新分析再补。继续？`, {
                  okLabel: '清理',
                  cancelLabel: '取消',
                }).then((ok) => {
                  if (!ok) return;
                  const { session: next, removedProps } = pruneUnusedDramaBibleAssets(session, {
                    props: true,
                    scenes: false,
                  });
                  onChange(next);
                  showAlert?.(`已清理 ${removedProps.length} 个未用道具`);
                });
              }}
            >
              清理未用 ({listUnusedDramaPropIds(session).length})
            </button>
          ) : null}
          {tab === 'scenes' && listUnusedDramaSceneIds(session).length > 0 ? (
            <button
              type="button"
              className={`nodrag rounded-lg px-3 py-2 text-[12px] font-medium ${
                isDark
                  ? 'bg-rose-500/20 text-rose-100 hover:bg-rose-500/30'
                  : 'bg-rose-50 text-rose-800 hover:bg-rose-100'
              } disabled:opacity-50`}
              disabled={!!busy}
              title="删除分镜与场次均未引用的场景"
              onClick={() => {
                const n = listUnusedDramaSceneIds(session).length;
                void showConfirm(`将删除 ${n} 个未引用场景。继续？`, {
                  okLabel: '清理',
                  cancelLabel: '取消',
                }).then((ok) => {
                  if (!ok) return;
                  const { session: next, removedScenes } = pruneUnusedDramaBibleAssets(session, {
                    props: false,
                    scenes: true,
                  });
                  onChange(next);
                  showAlert?.(`已清理 ${removedScenes.length} 个未用场景`);
                });
              }}
            >
              清理未用 ({listUnusedDramaSceneIds(session).length})
            </button>
          ) : null}
          {tab === 'characters' ? (
            <DramaYuanbaoHoverWrap
              priceLabel={batchVoicePriceLabel || unitVoicePriceLabel}
              tipBelow
            >
              <button
                type="button"
                className={`nodrag rounded-lg px-3.5 py-2 text-[13px] font-medium ${
                  isDark ? 'bg-sky-500/80 text-white' : 'bg-gray-900 text-white'
                } disabled:opacity-50`}
                disabled={!!busy || (!onGenerateVoices && !onGenerateVoice)}
                onClick={() => {
                  const ids = (session.bible.voices || [])
                    .filter((v) => !String(v.sample_url || '').trim())
                    .filter((v) => String(v.status || '') !== 'generating')
                    .filter((v) => !assetGeneratingIds?.[v.voice_id])
                    .map((v) => v.voice_id)
                    .filter(Boolean);
                  if (!ids.length) return;
                  if (onGenerateVoices) {
                    onGenerateVoices(ids);
                    return;
                  }
                  for (const voiceId of ids) onGenerateVoice?.(voiceId);
                }}
              >
                一键生成声音
              </button>
            </DramaYuanbaoHoverWrap>
          ) : null}
          {onEnterNext ? (
            <button
              type="button"
              className={`nodrag rounded-lg px-3.5 py-2 text-[13px] font-medium disabled:opacity-50 ${
                isDark ? 'bg-emerald-500/85 text-white hover:bg-emerald-500' : 'bg-emerald-700 text-white hover:bg-emerald-800'
              }`}
              disabled={!!busy || !(session.shots || []).length}
              title={
                (session.shots || []).length
                  ? '确认素材，进入导演分镜生成视频'
                  : '请先完成剧本分析生成分镜脚本'
              }
              onClick={() => onEnterNext()}
            >
              确认匹配，进入导演分镜
            </button>
          ) : null}
        </div>
      </div>
      <div
        className={`grid gap-x-2 gap-y-3 overflow-visible ${
          tab === 'scenes'
            ? 'grid-cols-[repeat(5,minmax(0,1fr))]'
            : 'grid-cols-[repeat(10,minmax(0,1fr))]'
        }`}
      >
        {tab === 'characters' && dramaSessionNeedsSystemVoice(session) ? (
          <DramaSystemVoiceCard
            session={session}
            pipeline={pipeline}
            isDark={isDark}
            voiceGenerating={systemVoiceGenerating}
            imageGenerating={systemImageGenerating}
            unitVoicePriceLabel={unitVoicePriceLabel}
            unitImagePriceLabel={unitImagePriceLabel}
            canPickVoiceFromCanvas={canPickVoiceFromCanvas}
            canPickFromCanvas={canPickFromCanvas}
            onChange={onChange}
            onGenerateVoice={onGenerateVoice}
            onUploadVoice={openVoiceUpload}
            onPickVoiceFromCanvas={onPickVoiceFromCanvas}
            onGenerateImage={() => onGenerateAssetImage?.('characters', DRAMA_SYSTEM_SPEAKER_ID)}
            onUploadImage={() => openUpload('characters', DRAMA_SYSTEM_SPEAKER_ID)}
            onUploadImageFile={(file) => onUploadAssetImage?.('characters', DRAMA_SYSTEM_SPEAKER_ID, file)}
            onPickImageFromCanvas={() => onPickAssetFromCanvas?.('characters', DRAMA_SYSTEM_SPEAKER_ID)}
            onClearImage={() => onClearAssetImage?.('characters', DRAMA_SYSTEM_SPEAKER_ID)}
            onEditVoicePrompt={() => setPromptEdit({ mode: 'voice', assetId: DRAMA_SYSTEM_SPEAKER_ID })}
            onEditImagePrompt={() => setPromptEdit({ mode: 'image', assetId: DRAMA_SYSTEM_SPEAKER_ID })}
            onDropFile={(voiceId, file) => applyVoiceFile(voiceId, file)}
          />
        ) : null}
        {list.map((item) => {
          // 进度 id 在：盖条（含重新生成）。仅 Domain 残留 generating 但已有图：不盖，避免任务完成仍「等待」
          const hasCardImage = !!String(item.imageUrl || '').trim();
          const generating =
            !!assetGeneratingIds?.[item.id] ||
            (item.status === 'generating' && !hasCardImage);
          const isSceneCard = tab === 'scenes';
          const isPropCard = tab === 'props';
          const linkedVoice =
            tab === 'characters' ? findVoiceForCharacter(session, item.id) : undefined;
          const voiceGenerating = !!(
            linkedVoice &&
            (linkedVoice.status === 'generating' ||
              !!assetGeneratingIds?.[linkedVoice.voice_id])
          );
          const mediaAspect = isSceneCard ? '16 / 9' : isPropCard ? '1 / 1' : '9 / 16';
          const isAudioFile = (file: File) =>
            String(file.type || '').startsWith('audio/') ||
            /\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(file.name);
          const isDragging = dragAssetId === item.id;
          const isDropTarget = dragOverAssetId === item.id && dragAssetId !== item.id;
          return (
            <div
              key={item.id}
              draggable
              style={{
                contentVisibility: 'auto',
                containIntrinsicSize: isSceneCard ? 'auto 220px' : 'auto 280px',
              }}
              className={`relative w-full min-w-0 flex flex-col gap-1.5 cursor-grab active:cursor-grabbing ${
                isDragging ? 'opacity-55' : ''
              } ${isDropTarget ? 'ring-2 ring-sky-400/80 rounded-xl' : ''} ${
                isDragging || isDropTarget ? 'z-20' : 'z-[1] hover:z-30'
              }`}
              onPointerDown={(e) => e.stopPropagation()}
              onDragStart={(e) => {
                const t = e.target as HTMLElement | null;
                if (t?.closest?.('button, input, textarea, a, [data-no-card-drag]')) {
                  e.preventDefault();
                  return;
                }
                e.dataTransfer.setData('application/x-nexflow-drama-asset', `${tab}:${item.id}`);
                e.dataTransfer.setData('text/plain', `drama-asset:${tab}:${item.id}`);
                e.dataTransfer.effectAllowed = 'move';
                setDragAssetId(item.id);
              }}
              onDragEnd={() => {
                setDragAssetId(null);
                setDragOverAssetId(null);
              }}
              onDragOver={(e) => {
                const types = Array.from(e.dataTransfer.types || []);
                const isReorder =
                  types.includes('application/x-nexflow-drama-asset') ||
                  types.some((t) => t === 'text/plain') && !!dragAssetId;
                if (isReorder) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOverAssetId !== item.id) setDragOverAssetId(item.id);
                  return;
                }
                const isMediaDrop =
                  !!peekCanvasImageDragUrl() ||
                  !!peekCanvasAudioDragUrl() ||
                  types.includes('Files') ||
                  types.includes(NEXFLOW_CANVAS_IMAGE_DRAG_MIME) ||
                  types.includes(NEXFLOW_CANVAS_AUDIO_DRAG_MIME) ||
                  types.includes('text/uri-list');
                if (isMediaDrop) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                  if (dragOverAssetId !== item.id) setDragOverAssetId(item.id);
                }
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                if (dragOverAssetId === item.id) setDragOverAssetId(null);
              }}
              onDrop={(e) => {
                const file = e.dataTransfer.files?.[0];
                if (file) {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragAssetId(null);
                  setDragOverAssetId(null);
                  if (tab === 'characters' && isAudioFile(file)) {
                    const voiceId = findVoiceForCharacter(session, item.id)?.voice_id;
                    if (voiceId) applyVoiceFile(voiceId, file);
                    return;
                  }
                  if (!String(file.type || '').startsWith('image/')) return;
                  if (onUploadAssetImage) {
                    onUploadAssetImage(tab, item.id, file);
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => {
                    const dataUrl = String(reader.result || '');
                    if (dataUrl) {
                      onChange(setDomainAssetImage(session, tab, item.id, dataUrl));
                    }
                  };
                  reader.readAsDataURL(file);
                  return;
                }
                const canvasAudio = peekCanvasAudioDragUrl() || readDramaDropAudioUrl(e.dataTransfer);
                if (canvasAudio && tab === 'characters') {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragAssetId(null);
                  setDragOverAssetId(null);
                  endCanvasAudioDrag();
                  const voiceId = findVoiceForCharacter(session, item.id)?.voice_id;
                  if (voiceId) onChange(setDomainVoiceSample(session, voiceId, canvasAudio));
                  return;
                }
                const canvasUrl = peekCanvasImageDragUrl() || readDramaDropImageUrl(e.dataTransfer);
                if (canvasUrl) {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragAssetId(null);
                  setDragOverAssetId(null);
                  endCanvasImageDrag();
                  onChange(setDomainAssetImage(session, tab, item.id, canvasUrl));
                  return;
                }
                const raw = String(e.dataTransfer.getData('text/plain') || '');
                const m = raw.match(/^drama-asset:([^:]+):(.+)$/);
                e.preventDefault();
                e.stopPropagation();
                setDragAssetId(null);
                setDragOverAssetId(null);
                if (!m || m[1] !== tab) return;
                onChange(reorderDomainAssets(session, tab, m[2], item.id));
              }}
            >
              <div className={`${cardCls(isDark)} relative z-[20] flex flex-col overflow-visible`}>
                <div
                  className={`group/img relative w-full overflow-hidden rounded-t-xl ${
                    isDark ? 'bg-black/40' : 'bg-gray-100'
                  }`}
                  data-drama-drop="image"
                  onDragOver={(e) => {
                    if (
                      !peekCanvasImageDragUrl() &&
                      !Array.from(e.dataTransfer.types || []).some((t) =>
                        t === NEXFLOW_CANVAS_IMAGE_DRAG_MIME || t === 'text/uri-list' || t === 'Files',
                      )
                    ) {
                      return;
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'copy';
                    if (dragOverAssetId !== item.id) setDragOverAssetId(item.id);
                  }}
                  onDrop={(e) => {
                    const file = e.dataTransfer.files?.[0];
                    if (file && String(file.type || '').startsWith('image/')) {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragOverAssetId(null);
                      if (onUploadAssetImage) {
                        onUploadAssetImage(tab, item.id, file);
                        return;
                      }
                      const reader = new FileReader();
                      reader.onload = () => {
                        const dataUrl = String(reader.result || '');
                        if (dataUrl) onChange(setDomainAssetImage(session, tab, item.id, dataUrl));
                      };
                      reader.readAsDataURL(file);
                      return;
                    }
                    const canvasUrl = peekCanvasImageDragUrl() || readDramaDropImageUrl(e.dataTransfer);
                    if (!canvasUrl) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOverAssetId(null);
                    endCanvasImageDrag();
                    onChange(setDomainAssetImage(session, tab, item.id, canvasUrl));
                  }}
                >
                  {item.imageUrl ? (
                    <RefImageHoverThumb
                      key={`${item.imageUrl}:${item.rev || 1}`}
                      url={item.imageUrl}
                      alt=""
                      title="悬停放大"
                      objectFit="cover"
                      previewBorderless
                      boxAspect={mediaAspect}
                      listThumbMaxEdge={288}
                      cacheNonce={item.rev || 1}
                      className="w-full"
                    />
                  ) : (
                    <DramaEmptyAssetImageSlot
                      isDark={isDark}
                      generating={generating}
                      aspect={mediaAspect}
                      onUpload={() => openUpload(tab, item.id)}
                    />
                  )}
                  <ModuleProgressBar
                    visible={generating}
                    progress={generating ? 35 : 100}
                    solidBackground={isDark ? '#1C1C1E' : '#e5e7eb'}
                    progressMessage="正在生成图片..."
                    borderRadius={8}
                  />
                  {item.imageUrl ? (
                    <button
                      type="button"
                      className={`nodrag absolute top-1 left-1 z-[60] flex h-5 w-5 items-center justify-center rounded-full ${
                        isDark
                          ? 'bg-black/55 text-white/80 hover:bg-black/75 hover:text-white'
                          : 'bg-black/40 text-white/90 hover:bg-black/60'
                      }`}
                      title="下载图片"
                      aria-label="下载图片"
                      onClick={(e) => {
                        e.stopPropagation();
                        void downloadDramaAssetImage(item.imageUrl!, item.name || item.id || 'asset');
                      }}
                    >
                      <Download className="h-3 w-3" strokeWidth={2.5} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={`nodrag absolute top-1 right-1 z-[60] flex h-5 w-5 items-center justify-center rounded-full text-[14px] leading-none ${
                      isDark
                        ? 'bg-black/55 text-white/80 hover:bg-black/75 hover:text-white'
                        : 'bg-black/40 text-white/90 hover:bg-black/60'
                    }`}
                    title={tab === 'characters' ? '删除角色卡' : '删除'}
                    aria-label={tab === 'characters' ? '删除角色卡' : '删除'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange(removeDomainAsset(session, tab, item.id));
                    }}
                  >
                    ×
                  </button>
                </div>
                <div className="relative z-[50] flex min-w-0 items-center justify-center gap-1.5 px-2 py-1.5">
                  <IsolatedAssetNameInput
                    value={item.name || ''}
                    isDark={isDark}
                    onCommit={(name) => onChange(setDomainAssetName(session, tab, item.id, name))}
                  />
                  {tab === 'characters' ? (
                    <button
                      type="button"
                      ref={(el) => {
                        costumeTagRefs.current[item.id] = el;
                      }}
                      className={`nodrag shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none ${
                        isDark
                          ? 'bg-violet-500/25 text-violet-100 hover:bg-violet-500/35'
                          : 'bg-violet-100 text-violet-800 hover:bg-violet-200'
                      }`}
                      title="切换 / 新建造型"
                      onClick={(e) => {
                        e.stopPropagation();
                        const el = e.currentTarget;
                        costumeTagRefs.current[item.id] = el;
                        costumeMenuAnchorRef.current = el;
                        setCostumeMenuId((prev) => (prev === item.id ? null : item.id));
                      }}
                    >
                      {item.extra || '1 套造型'}
                    </button>
                  ) : item.extra ? (
                    <span
                      className={`shrink-0 text-[11px] text-center ${mutedCls(isDark)}`}
                      title={item.extra}
                    >
                      {item.extra}
                    </span>
                  ) : null}
                  {tab === 'characters' && !String(item.imageUrl || '').trim() ? (
                    <span
                      className={`shrink-0 rounded px-1 py-0.5 text-[10px] ${
                        isDark ? 'bg-amber-500/25 text-amber-200' : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      需设计
                    </span>
                  ) : null}
                </div>
              </div>
              {tab === 'characters' ? (
                <DramaCharacterVoiceSlot
                  session={session}
                  characterId={item.id}
                  isDark={isDark}
                  generating={voiceGenerating}
                  onChange={onChange}
                  onDropFile={(voiceId, file) => applyVoiceFile(voiceId, file)}
                />
              ) : null}
              {isVisualTab ? (
                <div className="relative z-[40] flex w-full items-start gap-1">
                  <DramaAssetSourceMenu
                    isDark={isDark}
                    generating={generating}
                    generatingLabel="生成中"
                    primaryLabel="图片生成"
                    priceLabel={unitImagePriceLabel}
                    showLibrary={tab === 'characters'}
                    canPickFromCanvas={canPickFromCanvas}
                    onGenerate={() => onGenerateAssetImage?.(tab, item.id)}
                    onUpload={() => openUpload(tab, item.id)}
                    onPickCanvas={() => onPickAssetFromCanvas?.(tab, item.id)}
                    onPickLibrary={() =>
                      setLibraryPick({ characterId: item.id, prefer: 'image' })
                    }
                    promptLabel="图片提示词"
                    onEditPrompt={() => setPromptEdit({ mode: 'image', assetId: item.id })}
                  />
                  {tab === 'characters' && linkedVoice ? (
                    <DramaAssetSourceMenu
                      isDark={isDark}
                      generating={voiceGenerating}
                      generatingLabel="生成中"
                      primaryLabel="声音生成"
                      priceLabel={unitVoicePriceLabel}
                      showLibrary
                      canPickFromCanvas={canPickVoiceFromCanvas}
                      onGenerate={() => onGenerateVoice?.(linkedVoice.voice_id)}
                      onUpload={() => openVoiceUpload(linkedVoice.voice_id)}
                      onPickCanvas={() => onPickVoiceFromCanvas?.(linkedVoice.voice_id)}
                      onPickLibrary={() =>
                        setLibraryPick({ characterId: item.id, prefer: 'voice' })
                      }
                      promptLabel="声音提示词"
                      onEditPrompt={() => setPromptEdit({ mode: 'voice', assetId: item.id })}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        <button
          type="button"
          className={`nodrag w-full rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1.5 transition-colors order-last ${
            tab === 'scenes'
              ? 'aspect-[16/9]'
              : tab === 'props'
                ? 'aspect-square'
                : 'aspect-[9/16]'
          } ${
            isDark
              ? 'border-white/15 bg-white/[0.03] text-white/55 hover:border-sky-400/50 hover:bg-sky-500/10 hover:text-sky-100'
              : 'border-gray-300 bg-gray-50 text-gray-500 hover:border-sky-400 hover:bg-sky-50 hover:text-sky-800'
          }`}
          onClick={() => onChange(addDomainAsset(session, tab))}
        >
          <span className="text-[22px] leading-none font-light">+</span>
          <span className="text-[12px] font-medium px-2 text-center">
            {tab === 'characters'
              ? '新建角色'
              : tab === 'scenes'
                ? '新建场景'
                : tab === 'props'
                  ? '新建道具'
                  : '新建生物'}
          </span>
        </button>
      </div>
      {promptEdit ? (
        <DramaPromptEditDialog
          isDark={isDark}
          title={
            promptEdit.mode === 'voice'
              ? promptEdit.assetId === DRAMA_SYSTEM_SPEAKER_ID
                ? '系统音提示词'
                : '声音提示词'
              : promptEdit.assetId === DRAMA_SYSTEM_SPEAKER_ID
                ? '系统形象提示词'
                : '图片提示词'
          }
          mode={promptEdit.mode}
          runChat={runChat}
          showAlert={showAlert}
          chatModel={chatModel}
          unitChatPriceLabel={unitChatPriceLabel}
          value={
            promptEdit.mode === 'voice'
              ? String(
                  findVoiceForCharacter(session, promptEdit.assetId)?.sample_text ||
                    (promptEdit.assetId === DRAMA_SYSTEM_SPEAKER_ID
                      ? resolveDramaSystemVoice(session)?.sample_text || ''
                      : ''),
                )
              : promptEdit.assetId === DRAMA_SYSTEM_SPEAKER_ID
                ? String(resolveDramaSystemVoice(session)?.image_prompt || '')
                : String(
                  (tab === 'characters'
                    ? session.bible.characters.find((c) => c.character_id === promptEdit.assetId)?.prompt
                    : tab === 'scenes'
                      ? session.bible.scenes.find((s) => s.scene_id === promptEdit.assetId)?.prompt
                      : tab === 'props'
                        ? session.bible.props.find((p) => p.prop_id === promptEdit.assetId)?.prompt
                        : session.bible.creatures.find((c) => c.creature_id === promptEdit.assetId)
                            ?.prompt) || '',
                )
          }
          placeholder={
            promptEdit.mode === 'voice'
              ? promptEdit.assetId === DRAMA_SYSTEM_SPEAKER_ID
                ? '系统\n年龄：非人\n性别：中性\n音色描述：机械电子播报，冷静、清晰、非人声…\n台词：\n（系统播报 2～3 句，每句一行）'
                : '名字\n年龄：…\n性别：男/女\n音色描述：甜美细声细语 / 粗放狂野…\n台词：\n（剧本 2～3 句，每句一行）'
              : promptEdit.assetId === DRAMA_SYSTEM_SPEAKER_ID
                ? '半空浮现半透明3D全息系统面板，冷蓝光几何框与光粒子；科技感定妆图，禁止文字水印与真人面孔'
                : tab === 'characters'
                ? '年龄性别、高矮胖瘦、发型发色、服饰穿搭、表情、材质；须符合背景故事'
                : tab === 'scenes'
                  ? '空场景：空间结构、材质陈设、光影氛围；须符合剧情背景'
                  : tab === 'props'
                    ? '材质、尺寸、颜色、时代特征；须符合剧情'
                    : '生图提示词，可手动修改后再点 AI 生成'
          }
          onSave={(text) => {
            if (promptEdit.mode === 'voice') {
              const voiceId =
                findVoiceForCharacter(session, promptEdit.assetId)?.voice_id ||
                (promptEdit.assetId === DRAMA_SYSTEM_SPEAKER_ID
                  ? resolveDramaSystemVoice(session)?.voice_id
                  : undefined);
              if (voiceId) onChange(setDomainAssetPrompt(session, 'voices', voiceId, text));
              return;
            }
            if (promptEdit.assetId === DRAMA_SYSTEM_SPEAKER_ID) {
              const sys = resolveDramaSystemVoice(session);
              if (!sys) return;
              onChange(
                createEmptyDramaSession({
                  ...session,
                  bible: {
                    ...session.bible,
                    voices: session.bible.voices.map((v) =>
                      v.voice_id === sys.voice_id ? { ...v, image_prompt: text } : v,
                    ),
                  },
                }),
              );
              return;
            }
            onChange(setDomainAssetPrompt(session, tab, promptEdit.assetId, text));
          }}
          onClose={() => setPromptEdit(null)}
        />
      ) : null}
      {costumeMenuId ? (
        <DramaCharacterCostumePullUp
          session={session}
          characterId={costumeMenuId}
          isDark={isDark}
          open
          anchorRef={costumeMenuAnchorRef}
          onChange={onChange}
          showConfirm={showConfirm}
          pipeline={pipeline}
          localPicks={localPicks}
          onUploadCostumeImage={(costumeId) => openUpload('characters', costumeId)}
          onClose={() => setCostumeMenuId(null)}
        />
      ) : null}
      {costumeViewerId ? (
        <DramaCharacterCostumePanel
          session={session}
          characterId={costumeViewerId}
          isDark={isDark}
          assetGeneratingIds={assetGeneratingIds}
          unitImagePriceLabel={unitImagePriceLabel}
          canPickFromCanvas={canPickFromCanvas}
          onChange={onChange}
          onClose={() => setCostumeViewerId(null)}
          onGenerateAssetImage={onGenerateAssetImage}
          onUploadAssetImage={onUploadAssetImage}
          onPickAssetFromCanvas={onPickAssetFromCanvas}
        />
      ) : null}
      <DramaCharacterLibraryPickModal
        open={!!libraryPick}
        isDark={isDark}
        session={session}
        projectId={projectId}
        targetCharacterId={libraryPick?.characterId}
        prefer={libraryPick?.prefer || 'both'}
        onClose={() => setLibraryPick(null)}
        onApply={(next, summary) => {
          onChange(next);
          if (summary) showAlert?.(summary);
        }}
      />
    </div>
  );
}

function H3PromptHoverBadge({
  prompt,
  isDark,
  label = 'H3',
  title = '悬停查看本镜编译提示词',
  heading = '本镜编译提示词',
}: {
  prompt: string;
  isDark: boolean;
  label?: string;
  title?: string;
  heading?: string;
}) {
  const text = String(prompt || '').trim();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const panelW = Math.min(840, Math.max(560, window.innerWidth * 0.55));
    const gap = 8;
    let left = r.right + gap;
    if (left + panelW > window.innerWidth - 8) {
      left = Math.max(8, r.left - gap - panelW);
    }
    let top = r.top;
    const maxH = Math.min(720, window.innerHeight - 16);
    if (top + maxH > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - 8 - maxH);
    }
    setPos({ left, top });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    const onScroll = () => place();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, place]);

  if (!text) return null;

  return (
    <>
      <div
        ref={anchorRef}
        className="relative rounded-full bg-violet-500/20 px-2 py-0.5 text-[14px] font-medium text-violet-200 cursor-default"
        title={title}
        onMouseEnter={() => {
          setOpen(true);
          place();
        }}
        onMouseLeave={() => {
          setOpen(false);
          setPos(null);
        }}
      >
        {label}
      </div>
      {open && pos
        ? createPortal(
            <div
              className={`pointer-events-none fixed z-[100050] max-h-[min(720px,85vh)] w-[min(840px,55vw)] overflow-auto rounded-2xl px-5 py-4 text-[24px] leading-relaxed shadow-2xl custom-scrollbar-dark ${
                isDark
                  ? 'bg-zinc-950/95 text-white/90 ring-1 ring-violet-400/30'
                  : 'bg-white text-gray-800 ring-1 ring-violet-300/60'
              }`}
              style={{ left: pos.left, top: pos.top }}
            >
              <div
                className={`mb-2.5 text-[22px] font-semibold ${
                  isDark ? 'text-violet-300' : 'text-violet-700'
                }`}
              >
                {heading}
              </div>
              <pre className="whitespace-pre-wrap break-words font-sans text-[24px] leading-[1.55]">
                {text}
              </pre>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function resolveBoardShotScene(
  session: DramaDirectorSession,
  shot: DramaShot,
): DramaSceneAsset | null {
  const beat = session.scene_beats.find((b) => b.scene_beat_id === shot.scene_beat_id);
  const id = String(shot.scene_asset_id || beat?.scene_asset_id || '').trim();
  if (!id) return null;
  return session.bible.scenes.find((s) => s.scene_id === id) || null;
}

function resolveBoardShotCharacters(
  session: DramaDirectorSession,
  shot: DramaShot,
): DramaCharacter[] {
  const ids = resolveCharacterIdsForShot(session, shot);
  const byId = new Map(session.bible.characters.map((c) => [c.character_id, c]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as DramaCharacter[];
}

function formatBoardLensLabel(shot: DramaShot): string {
  const parts = [shot.size, shot.angle || shot.camera, shot.move, shot.focal]
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

function beatMetaLabel(session: DramaDirectorSession, shot: DramaShot): string {
  const beat = session.scene_beats.find((b) => b.scene_beat_id === shot.scene_beat_id);
  if (!beat) return '';
  return `场${beat.scene_no} · ${beat.location_name || '未命名'}`;
}

function formatDramaPlanDurationLabel(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  const rounded = Math.round(sec * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function resolveDramaShotDurationTiers(model: string): number[] {
  const listed = listDirectorVideoDurationTiersSec(model);
  return listed.length > 0 ? listed : [...DRAMA_SHOT_DURATION_TIERS];
}

function resolveDramaShotSelectedDurationSec(planSec: number, model: string): number {
  const tiers = resolveDramaShotDurationTiers(model);
  const rounded = Math.round(planSec);
  if (tiers.includes(rounded) && Math.abs(planSec - rounded) < 0.05) return rounded;
  const snapped = Number(pickNearestDirectorVideoBatchDuration(model, planSec));
  return Number.isFinite(snapped) && snapped > 0 ? snapped : tiers[0] || 10;
}

function resolveDramaShotGenerateDurationSec(
  planSec: number,
  model: string,
  modelParams?: Record<string, string> | null,
): number {
  return resolveDramaGenerateDurationSec(
    resolveDramaShotSelectedDurationSec(planSec, model),
    modelParams,
    resolveDramaShotDurationTiers(model),
  );
}

function DramaDurationTierPills({
  tiers,
  selectedSec,
  disabled,
  onPick,
  title,
}: {
  tiers: number[];
  selectedSec: number;
  disabled?: boolean;
  onPick: (sec: number) => void;
  title?: string;
}) {
  return (
    <div
      className="inline-flex items-center rounded-full bg-sky-500/20 p-0.5 text-[13px] font-medium tabular-nums text-sky-200"
      title={
        title ||
        '视频总时长。点选后彩条与提示词时段按占比换算（正文保留，只改时间点）'
      }
    >
      {tiers.map((sec) => {
        const selected = selectedSec === sec;
        return (
          <button
            key={sec}
            type="button"
            disabled={disabled}
            className={`nodrag rounded-full px-2 py-0.5 disabled:opacity-45 ${
              selected
                ? 'bg-sky-500/85 text-white'
                : 'text-sky-200/80 hover:bg-sky-500/25 hover:text-white'
            }`}
            aria-pressed={selected}
            onClick={(e) => {
              e.stopPropagation();
              onPick(sec);
            }}
          >
            {sec}s
          </button>
        );
      })}
    </div>
  );
}

function formatDramaVideoGenButtonLabel(opts: {
  generating?: boolean;
  hasVideo: boolean;
  durationSec: number;
  priceLabel?: string | null;
  compact?: boolean;
}): string {
  if (opts.generating) return '生成中…';
  const action = opts.compact
    ? opts.hasVideo
      ? '重新生成'
      : '生成本镜'
    : opts.hasVideo
      ? '重新生成视频'
      : '生成视频';
  const dur = Math.round(Number(opts.durationSec) || 0);
  const durBit = dur > 0 ? `${dur}s` : '';
  // 价格只在悬停 tip 显示，不写进按钮表面
  return [action, durBit].filter(Boolean).join(' · ');
}

function sumDramaYuanbaoHoverLabel(
  labels: Array<string | null | undefined>,
): string | null {
  let sum = 0;
  let unit = '元宝';
  let n = 0;
  for (const lab of labels) {
    const m = String(lab || '').match(/(\d+(?:\.\d+)?)\s*(元宝|credits)/i);
    if (!m) continue;
    sum += Number(m[1]);
    unit = /credit/i.test(m[2]) ? 'credits' : '元宝';
    n += 1;
  }
  if (!n) return null;
  const cost = Number.isInteger(sum) ? String(sum) : sum.toFixed(1);
  return `${n}镜合计 · ${cost}${unit}`;
}

function dramaShotPreviewChecks(shot: DramaShot): { key: string; ok: boolean }[] {
  const events = shot.timeline_events || [];
  const hasVideo = !!String(shot.video_url || '').trim();
  const hasVisual = hasVideo || events.some((e) => String(e.visual_action || '').trim());
  const dlgEvents = events.filter((e) => String(e.dialogue || '').trim());
  const hasDlg =
    dlgEvents.length === 0 ||
    dlgEvents.every((e) => String(e.dialogue_character_id || '').trim());
  const hasLip = dlgEvents.length === 0 || dlgEvents.some((e) => e.lip_sync);
  const hasAudio =
    !!String(shot.audio_url || '').trim() ||
    events.some((e) => (e.environment_audio || []).some((x) => String(x || '').trim()));
  return [
    { key: '画面', ok: hasVisual },
    { key: '动作', ok: hasVisual },
    { key: '对白', ok: hasDlg },
    { key: '口型', ok: hasLip },
    { key: '声音', ok: hasAudio || dlgEvents.length === 0 },
  ];
}

/** 本镜成片：画布表 ready 为真源。生成中仍保留已有 URL，避免全屏只剩进度条、切回窗口才看见片。 */
function resolveDramaShotBoardVideo(
  shot: { video_url?: string; video_status?: string; video_node_id?: string; shot_no?: string },
  pipeline: DirectorPipelineState,
): { videoUrl: string; videoStatus: string } {
  const ownUrl = String(shot.video_url || '').trim();
  const ownStatus = String(shot.video_status || '').trim();
  const sb = getDirectorShotStoryboard(pipeline, String(shot.shot_no || '').trim());
  const sbUrl = String(sb.videoUrl || '').trim();
  const sbStatus = String(sb.videoStatus || '').trim();

  const boardBusy = sbStatus === 'generating' || sbStatus === 'queued';
  const ownBusy = ownStatus === 'generating' || ownStatus === 'queued';

  // 重新生成：Domain/画布任一侧仍在跑时优先 generating（即使旧成片 URL 仍在）
  if (ownBusy || boardBusy) {
    return { videoUrl: sbUrl || ownUrl, videoStatus: boardBusy && sbStatus === 'queued' ? 'queued' : 'generating' };
  }

  // 画布表已 ready：侧栏任务已出片，分镜卡必须收条并展示，禁止再盖进度。
  if (sbUrl && (sbStatus === 'ready' || (!sbStatus && sbUrl))) {
    return { videoUrl: sbUrl, videoStatus: 'ready' };
  }

  if (ownUrl && (ownStatus === 'ready' || ownStatus === 'success')) {
    return { videoUrl: ownUrl, videoStatus: 'ready' };
  }

  const videoUrl = sbUrl || ownUrl;
  if (videoUrl) {
    return { videoUrl, videoStatus: sbStatus || ownStatus || 'ready' };
  }
  return {
    videoUrl: '',
    videoStatus: ownStatus || sbStatus || 'pending',
  };
}

/** H3 成片开头常是黑场；静帧取片中附近，避免预览停在 0 秒全黑 */
function dramaContentTimeSec(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0.2;
  if (duration < 0.5) return Math.max(0.02, duration * 0.45);
  return Math.min(0.55, Math.max(0.18, duration * 0.16));
}

function captureDramaVideoStill(v: HTMLVideoElement): string {
  const w = v.videoWidth;
  const h = v.videoHeight;
  if (!w || !h) return '';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(v, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.78);
  } catch {
    return '';
  }
}

/** 把解码帧画到 canvas。全屏里硬件 video overlay 经常整段黑，画面只能走这条软件路径。 */
function blitDramaVideoFrame(v: HTMLVideoElement, c: HTMLCanvasElement): boolean {
  const vw = v.videoWidth;
  const vh = v.videoHeight;
  if (!vw || !vh) return false;
  const rect = c.getBoundingClientRect();
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const outW = Math.max(1, Math.round((rect.width || vw) * dpr));
  const outH = Math.max(1, Math.round((rect.height || vh) * dpr));
  if (c.width !== outW || c.height !== outH) {
    c.width = outW;
    c.height = outH;
  }
  const ctx = c.getContext('2d');
  if (!ctx) return false;
  try {
    ctx.clearRect(0, 0, outW, outH);
    const scale = Math.min(outW / vw, outH / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    ctx.drawImage(v, (outW - dw) / 2, (outH - dh) / 2, dw, dh);
    return true;
  } catch {
    return false;
  }
}

/**
 * Chromium/Electron：从未 play 过的 <video> 在 CSS zoom 下会一直是黑块；
 * 且 H3 第 0 帧经常是黑场。静音播 → seek 到有画面处 → 抓一帧 JPEG 盖住。
 */
function dramaKickVideoStillFrame(
  v: HTMLVideoElement,
  isHovering: () => boolean,
  onPainted: (stillDataUrl?: string) => void,
): () => void {
  let cancelled = false;
  let rvfc: number | null = null;
  const cleanups: Array<() => void> = [];

  const finish = () => {
    if (cancelled) return;
    cancelled = true;
    let still = '';
    if (!isHovering()) {
      still = captureDramaVideoStill(v);
      try {
        v.pause();
      } catch {
        /* ignore */
      }
      v.muted = true;
    }
    onPainted(still);
  };

  const afterFrame = (fn: () => void) => {
    if (typeof v.requestVideoFrameCallback === 'function') {
      rvfc = v.requestVideoFrameCallback(() => {
        rvfc = null;
        fn();
      });
      return;
    }
    window.requestAnimationFrame(fn);
  };

  const seekToContent = () => {
    if (cancelled || isHovering()) {
      if (!cancelled) onPainted();
      return;
    }
    const t = dramaContentTimeSec(v.duration);
    const onSeeked = () => {
      v.removeEventListener('seeked', onSeeked);
      afterFrame(finish);
    };
    if (t <= 0.02 || Math.abs(v.currentTime - t) < 0.04) {
      afterFrame(finish);
      return;
    }
    v.addEventListener('seeked', onSeeked);
    cleanups.push(() => v.removeEventListener('seeked', onSeeked));
    try {
      v.currentTime = t;
    } catch {
      finish();
    }
  };

  const playMuted = () => {
    if (cancelled || isHovering()) return;
    v.muted = true;
    const p = v.play();
    if (p && typeof p.then === 'function') {
      void p
        .then(() => {
          if (cancelled) return;
          afterFrame(seekToContent);
        })
        .catch(() => {
          if (!cancelled) seekToContent();
        });
    } else {
      afterFrame(seekToContent);
    }
  };

  if (v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    playMuted();
  } else {
    const onReady = () => {
      v.removeEventListener('loadeddata', onReady);
      v.removeEventListener('canplay', onReady);
      playMuted();
    };
    v.addEventListener('loadeddata', onReady);
    v.addEventListener('canplay', onReady);
    cleanups.push(() => {
      v.removeEventListener('loadeddata', onReady);
      v.removeEventListener('canplay', onReady);
    });
  }

  const fallback = window.setTimeout(finish, 1600);
  cleanups.push(() => window.clearTimeout(fallback));

  return () => {
    cancelled = true;
    if (rvfc != null && typeof v.cancelVideoFrameCallback === 'function') {
      try {
        v.cancelVideoFrameCallback(rvfc);
      } catch {
        /* ignore */
      }
    }
    cleanups.forEach((fn) => fn());
  };
}

/**
 * 成片预览：挂载窗内常驻 video 拉首帧；悬停有声播放；移开暂停静音。
 * 窗外不挂 video，仅 poster / 占位，防多路解码 OOM。
 */
const DramaShotVideoPreview = React.memo(function DramaShotVideoPreview({
  playableUrl,
  posterHint,
  generating,
  mountVideo = false,
  forcePlay = false,
  onMediaAspect,
}: {
  playableUrl: string;
  posterHint?: string;
  isDark: boolean;
  generating: boolean;
  /** 视口内短暂挂 video 解首帧后卸载解码器；悬停/强制播放再挂载 */
  mountVideo?: boolean;
  /** 点选历史成片后立刻播放，不必先移回预览区 */
  forcePlay?: boolean;
  /** 读到成片真实宽高后回调，供外框跟随画面比例 */
  onMediaAspect?: (aspectCss: string | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hoveringRef = useRef(false);
  const paintedUrlRef = useRef('');
  const blitReadyRef = useRef(false);
  const onMediaAspectRef = useRef(onMediaAspect);
  onMediaAspectRef.current = onMediaAspect;
  const [hovering, setHovering] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [stillShot, setStillShot] = useState('');
  const [blitReady, setBlitReady] = useState(false);
  /** 解完静帧后卸掉 video，避免视口内多路常驻解码 */
  const [keepDecoder, setKeepDecoder] = useState(true);
  const poster = toDisplayableDramaMediaUrl(String(posterHint || '').trim());
  const shouldPlay = !!playableUrl && (hovering || forcePlay);
  // 播放时挂载；或 mountVideo 且尚未解完静帧时短暂挂载
  const shouldMountVideo = !!playableUrl && (shouldPlay || (mountVideo && keepDecoder));

  const reportMediaAspect = useCallback((el: { videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number } | null) => {
    if (!el) return;
    const w = Number(el.videoWidth || el.naturalWidth || 0);
    const h = Number(el.videoHeight || el.naturalHeight || 0);
    if (!(w > 0 && h > 0)) return;
    onMediaAspectRef.current?.(`${w} / ${h}`);
  }, []);

  useEffect(() => {
    hoveringRef.current = false;
    paintedUrlRef.current = '';
    blitReadyRef.current = false;
    setHovering(false);
    setFrameReady(false);
    setStillShot('');
    setBlitReady(false);
    setKeepDecoder(true);
    onMediaAspectRef.current?.(null);
  }, [playableUrl, posterHint, mountVideo]);

  useEffect(() => {
    return () => {
      const v = videoRef.current;
      if (!v) return;
      v.pause();
      v.muted = true;
      v.removeAttribute('src');
      try {
        v.load();
      } catch {
        /* ignore */
      }
    };
  }, [playableUrl]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !shouldMountVideo) return;
    if (shouldPlay) {
      v.muted = false;
      v.volume = 1;
      try {
        if (v.currentTime > 0.08) v.currentTime = 0;
      } catch {
        /* ignore */
      }
      const start = () => {
        void v.play().catch(() => {
          v.muted = true;
          void v.play().catch(() => undefined);
        });
      };
      if (v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        start();
      } else {
        const onReady = () => {
          v.removeEventListener('canplay', onReady);
          start();
        };
        v.addEventListener('canplay', onReady);
        return () => v.removeEventListener('canplay', onReady);
      }
      return;
    }
    v.muted = true;
    if (mountVideo && keepDecoder && !shouldPlay) {
      if (paintedUrlRef.current === playableUrl && stillShot) {
        v.pause();
        try {
          v.removeAttribute('src');
          v.load();
        } catch {
          /* ignore */
        }
        setKeepDecoder(false);
        return;
      }
      return dramaKickVideoStillFrame(
        v,
        () => hoveringRef.current,
        (still) => {
          reportMediaAspect(v);
          paintedUrlRef.current = playableUrl;
          if (still) setStillShot(still);
          setFrameReady(true);
          try {
            v.pause();
            v.removeAttribute('src');
            v.load();
          } catch {
            /* ignore */
          }
          setKeepDecoder(false);
        },
      );
    }
    v.pause();
    try {
      if (v.currentTime > 0.05) v.currentTime = 0;
    } catch {
      /* ignore */
    }
  }, [shouldMountVideo, shouldPlay, mountVideo, playableUrl, forcePlay, keepDecoder, stillShot, reportMediaAspect]);

  useEffect(() => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || !shouldMountVideo) return;
    let stopped = false;
    let rvfc: number | null = null;
    let raf = 0;

    const draw = () => {
      if (stopped) return;
      const ok = blitDramaVideoFrame(v, c);
      if (ok && !blitReadyRef.current) {
        blitReadyRef.current = true;
        setBlitReady(true);
      }
    };
    const loop = () => {
      if (stopped) return;
      draw();
      if (!shouldPlay) return;
      if (typeof v.requestVideoFrameCallback === 'function') {
        rvfc = v.requestVideoFrameCallback(loop);
      } else {
        raf = window.requestAnimationFrame(loop);
      }
    };

    if (shouldPlay) loop();
    else draw();

    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => draw()) : null;
    ro?.observe(c);

    return () => {
      stopped = true;
      ro?.disconnect();
      if (rvfc != null && typeof v.cancelVideoFrameCallback === 'function') {
        try {
          v.cancelVideoFrameCallback(rvfc);
        } catch {
          /* ignore */
        }
      }
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [shouldMountVideo, shouldPlay, playableUrl, stillShot]);

  if (!playableUrl) return null;

  const showStillOver = !shouldPlay && !!stillShot;
  // 未播放时都给提示；首帧就绪后仍显示，方便发现可悬停预览
  const showPlayHint = !shouldPlay;

  return (
    <div
      className="nodrag nowheel absolute inset-0"
      onMouseEnter={() => {
        hoveringRef.current = true;
        setHovering(true);
      }}
      onMouseLeave={() => {
        hoveringRef.current = false;
        setHovering(false);
      }}
    >
      {showStillOver ? (
        <img
          src={stillShot}
          alt=""
          className="pointer-events-none absolute inset-0 z-[1] h-full w-full object-contain"
          draggable={false}
          onLoad={(e) => reportMediaAspect(e.currentTarget)}
        />
      ) : null}
      {!frameReady && !poster && !mountVideo ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-[12px] text-white/70">
          悬停预览成片
        </div>
      ) : null}
      {shouldMountVideo ? (
        <>
          <video
            ref={videoRef}
            key={`${playableUrl}-${shouldPlay ? 'play' : 'still'}`}
            src={playableUrl}
            className="drama-shot-video-el"
            controls={false}
            muted={!hovering}
            playsInline
            loop
            preload={shouldPlay ? 'auto' : 'metadata'}
            draggable={false}
            onLoadedData={() => {
              const v = videoRef.current;
              const c = canvasRef.current;
              if (v && c) blitDramaVideoFrame(v, c);
              reportMediaAspect(v);
              if (hoveringRef.current) setFrameReady(true);
            }}
            onLoadedMetadata={() => {
              reportMediaAspect(videoRef.current);
            }}
            onCanPlay={() => {
              reportMediaAspect(videoRef.current);
              if (hoveringRef.current) {
                setFrameReady(true);
                const v = videoRef.current;
                if (v) {
                  v.muted = false;
                  v.volume = 1;
                  void v.play().catch(() => {
                    v.muted = true;
                    void v.play().catch(() => undefined);
                  });
                }
              }
            }}
            onError={() => setFrameReady(false)}
          />
          <canvas
            ref={canvasRef}
            className={`pointer-events-none absolute inset-0 z-[1] h-full w-full ${
              blitReady ? '' : 'opacity-0'
            }`}
            aria-hidden
          />
        </>
      ) : null}
      {showPlayHint ? (
        <div
          className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center"
          aria-hidden
        >
          {generating ? (
            <span className="mr-2 rounded bg-black/50 px-1.5 py-0.5 text-[12px] text-amber-200">
              生成中 · 可悬停预览
            </span>
          ) : null}
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white shadow-md">
            <Play className="h-5 w-5 translate-x-0.5" fill="currentColor" />
          </span>
        </div>
      ) : null}
    </div>
  );
});

/** 多版缩略图：不能只 metadata+seek，否则第二格经常停在黑场 */
function DramaShotVideoThumb({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [still, setStill] = useState('');
  const [keepVideo, setKeepVideo] = useState(true);

  useEffect(() => {
    setStill('');
    setKeepVideo(true);
  }, [src]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src || !keepVideo) return;
    return dramaKickVideoStillFrame(v, () => false, (shot) => {
      if (!shot) return;
      setStill(shot);
      try {
        v.pause();
        v.removeAttribute('src');
        v.load();
      } catch {
        /* ignore */
      }
      setKeepVideo(false);
    });
  }, [src, keepVideo]);

  return (
    <div className="relative aspect-video w-full bg-black/40">
      {keepVideo ? (
        <video
          ref={videoRef}
          key={src}
          src={src}
          className="absolute inset-0 h-full w-full object-cover pointer-events-none"
          muted
          playsInline
          preload="auto"
          draggable={false}
        />
      ) : null}
      {still ? (
        <img
          src={still}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      ) : null}
    </div>
  );
}

/** 多版成片切换：标题栏展开/收起（≥2 版显示；不靠悬停，避免预览播放误关） */
function DramaShotVideoVersionPicker({
  open,
  versions,
  currentUrl,
  isDark,
  disabled,
  onPick,
  defaultExpanded = true,
}: {
  open: boolean;
  versions: string[];
  currentUrl: string;
  isDark: boolean;
  disabled?: boolean;
  onPick: (url: string) => void;
  /** 首次出现时是否展开缩略图；之后由用户点标题栏切换 */
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(!!defaultExpanded);
  useEffect(() => {
    if (!open || versions.length < 2) setExpanded(!!defaultExpanded);
  }, [open, versions.length, defaultExpanded]);

  if (!open || versions.length < 2) return null;
  const currentKey = directorMediaUrlKey(currentUrl) || currentUrl;
  return (
    <div
      className={`relative z-20 mt-1 shrink-0 rounded-lg border p-1.5 shadow-xl ${
        isDark ? 'border-white/15 bg-zinc-950' : 'border-gray-200 bg-white'
      }`}
      data-drama-video-picker=""
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={`nodrag flex w-full items-center justify-between gap-1 rounded-md px-0.5 py-0.5 text-left text-[12px] font-medium ${
          isDark ? 'text-white/70 hover:bg-white/8 hover:text-white/90' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
        }`}
        title={expanded ? '收起历史纪录' : '展开历史纪录'}
        aria-expanded={expanded}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
      >
        <span>
          历史纪录
          <span className="ml-1 opacity-70">({versions.length})</span>
        </span>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0 opacity-70" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
        )}
      </button>
      {expanded ? (
        <div className="mt-1 grid max-h-56 grid-cols-2 gap-1.5 overflow-auto">
          {versions.map((u, i) => {
            const itemKey = directorMediaUrlKey(u) || u;
            const on =
              isDirectorShotVideoSelection(currentUrl, u) ||
              (!!currentKey && itemKey === currentKey);
            const src = toElectronVideoElementSrc(u) || toDisplayableDramaMediaUrl(u) || u;
            return (
              <button
                key={`drama-vid-${itemKey || i}`}
                type="button"
                disabled={disabled}
                className={`nodrag relative overflow-hidden rounded-md text-left ring-1 disabled:opacity-45 ${
                  on
                    ? 'ring-sky-400'
                    : isDark
                      ? 'ring-white/15 hover:ring-white/35'
                      : 'ring-gray-300 hover:ring-gray-400'
                }`}
                title={`切换成片 ${i + 1}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onPick(u);
                }}
              >
                <DramaShotVideoThumb src={src} />
                {on ? (
                  <span className="pointer-events-none absolute right-0.5 top-0.5 rounded-full bg-sky-500 p-0.5 text-white">
                    <Check className="h-2.5 w-2.5" />
                  </span>
                ) : null}
                <span
                  className={`pointer-events-none absolute left-0.5 top-0.5 rounded px-0.5 text-[9px] font-medium tabular-nums ${
                    isDark ? 'bg-black/65 text-white/90' : 'bg-white/90 text-gray-700'
                  }`}
                >
                  {i + 1}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** 分镜卡右侧：单镜视频生成槽（可选手动视频模型 + 按模型挡位向上取整） */
const DramaShotVideoSlot = React.memo(function DramaShotVideoSlot({
  shot,
  session,
  pipeline,
  isDark,
  busy,
  canGenerate,
  onSpawn,
  onModelChange,
  onDurationChange,
  onAbandonWait,
  onSelectVideo,
  priceLabel,
  forceGenerating,
  hideGenerate,
  progressMessage,
  mountVideo = false,
}: {
  shot: DramaShot;
  session: DramaDirectorSession;
  pipeline: DirectorPipelineState;
  isDark: boolean;
  busy: boolean;
  canGenerate: boolean;
  onSpawn: (shotNo: string, videoModel: string) => void;
  onModelChange?: (shotNo: string, videoModel: string) => void;
  onDurationChange?: (shotNo: string, durationSec: number) => void;
  onAbandonWait?: (shotNo: string) => void;
  onSelectVideo?: (shotNo: string, videoUrl: string) => void;
  priceLabel?: string | null;
  /** 即时绿条（不依赖 status 写回） */
  forceGenerating?: boolean;
  /** 生成按钮放到卡片底栏时隐藏 */
  hideGenerate?: boolean;
  progressMessage?: string;
  /** 挂载窗内镜：常驻 video 拉首帧（约 3 路） */
  mountVideo?: boolean;
}) {
  const modelOptions = listDramaSupportedVideoModels();
  const hasDlg = (shot.dialogue || []).some((d) => String(d.text || '').trim());
  const hasAudio = !!String(shot.audio_url || '').trim();
  const model = resolveDramaShotVideoModel(shot.model_params, session.meta.videoBatchModel, {
    hasDialogue: hasDlg,
    hasShotAudio: hasAudio,
  });
  const planSec = Number(shot.duration_sec) > 0 ? Number(shot.duration_sec) : 5;
  const durationTiers = resolveDramaShotDurationTiers(model);
  const shotNo = String(shot.shot_no || '').trim();
  const inferredFromPrompt = inferDramaDurationSecFromH3Prompt(
    String(shot.h3_skill_prompt || ''),
    durationTiers,
  );
  const genSec =
    inferredFromPrompt != null
      ? inferredFromPrompt
      : resolveDramaShotGenerateDurationSec(planSec, model, shot.model_params);
  const tierSec = String(genSec);

  // 有优化稿时：时长档自动跟提示词时码对齐（不改写提示词正文）
  useEffect(() => {
    if (!onDurationChange || !shotNo || inferredFromPrompt == null) return;
    const explicit = Number(
      String(shot.model_params?.[DRAMA_SHOT_VIDEO_DURATION_PARAM] || '').trim(),
    );
    const plan = Number(shot.duration_sec) || 0;
    if (
      Math.abs(explicit - inferredFromPrompt) < 0.05 &&
      Math.abs(plan - inferredFromPrompt) < 0.05
    ) {
      return;
    }
    onDurationChange(shotNo, inferredFromPrompt);
  }, [
    inferredFromPrompt,
    onDurationChange,
    shotNo,
    shot.duration_sec,
    shot.model_params?.[DRAMA_SHOT_VIDEO_DURATION_PARAM],
  ]);
  const boardVideo = resolveDramaShotBoardVideo(shot, pipeline);
  const videoUrl = toDisplayableDramaMediaUrl(boardVideo.videoUrl);
  const playableVideoUrl = videoUrl ? toElectronVideoElementSrc(videoUrl) || videoUrl : '';
  const status =
    boardVideo.videoStatus ||
    (videoUrl ? 'ready' : 'pending');
  const videoError = String(shot.video_error || '').trim();
  const ownStatus = String(shot.video_status || '').trim();
  // 绿条/Domain generating 优先：旧成片仍在时也不能靠 boardReady 把进度条盖掉
  const isGenerating =
    !!forceGenerating ||
    status === 'generating' ||
    status === 'queued' ||
    ownStatus === 'generating' ||
    ownStatus === 'queued';
  const generating = isGenerating;
  const planLabel = formatDramaPlanDurationLabel(planSec);
  const showSnap = Number(tierSec) !== planSec && Number(tierSec) !== Math.round(planSec);
  const modelMeta = modelOptions.find((m) => m.id === model);
  const checks = dramaShotPreviewChecks(shot);
  const sb = getDirectorShotStoryboard(pipeline, shotNo);
  const sbImage = String(sb.imageUrl || shot.storyboard_image_url || '').trim();
  // 与预览同源：Domain video_url 有片而 sb 空时，历史列表也要能看见当前成片
  const videoVersions = listDirectorShotVideos({
    videoUrl: boardVideo.videoUrl || sb.videoUrl,
    videoUrlHistory: sb.videoUrlHistory,
  });
  const currentVideoUrl = String(boardVideo.videoUrl || sb.videoUrl || '').trim();
  const [pickedUrl, setPickedUrl] = useState('');
  const [wantPlay, setWantPlay] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const canPickVersions = !generating && !!onSelectVideo && videoVersions.length >= 2;
  const activeVideoUrl = pickedUrl || currentVideoUrl;
  const previewPlayableUrl = activeVideoUrl
    ? toElectronVideoElementSrc(activeVideoUrl) ||
      toDisplayableDramaMediaUrl(activeVideoUrl) ||
      activeVideoUrl
    : playableVideoUrl;
  const aspectRatio =
    session.meta.aspect_ratio === '16:9' ||
    session.meta.aspect_ratio === '9:16' ||
    session.meta.aspect_ratio === '3:4' ||
    session.meta.aspect_ratio === '4:3'
      ? session.meta.aspect_ratio
      : '9:16';
  const [mediaAspectCss, setMediaAspectCss] = useState<string | null>(null);
  // 有成片：外框跟随画面真实比例；无片：跟顶部所选成片比例
  const aspectStyle = mediaAspectCss
    ? dramaAspectFitStyleFromCss(mediaAspectCss)
    : dramaAspectFitStyle(aspectRatio);
  const aspectLabel = mediaAspectCss
    ? dramaAspectLabelFromCss(mediaAspectCss, aspectRatio)
    : aspectRatio;

  useEffect(() => {
    setMediaAspectCss(null);
  }, [previewPlayableUrl]);

  useEffect(() => {
    setPickedUrl((prev) => {
      if (!prev) return prev;
      if (currentVideoUrl && isDirectorShotVideoSelection(currentVideoUrl, prev)) return prev;
      return '';
    });
  }, [currentVideoUrl]);

  return (
    <section className="flex h-full min-h-0 flex-col gap-1">
      <div className="flex items-center justify-between gap-1.5">
        <div className="text-[13px] font-semibold text-sky-300/90">视频预览</div>
        <div
          className={`text-[12px] tabular-nums ${mutedCls(isDark)}`}
          title={
            showSnap || Number(tierSec) !== Number(planLabel)
              ? `画幅 ${aspectLabel} · 规划 ${planLabel}s，将按 ${tierSec}s 档出片`
              : `画幅 ${aspectLabel} · 将按 ${tierSec}s 档出片`
          }
        >
          <span className="mr-1.5 opacity-80">{aspectLabel}</span>
          {showSnap || Number(tierSec) !== Number(planLabel)
            ? `${planLabel}s → ${tierSec}s档`
            : `${tierSec}s档`}
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          className={`drama-shot-video-preview-shell relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg ${
            isDark ? 'bg-black/25' : 'bg-gray-50'
          }`}
        >
          <div
            className={`drama-shot-video-stage relative overflow-hidden rounded-lg ${
              isDark ? 'bg-black/45 ring-1 ring-white/10' : 'bg-gray-100 ring-1 ring-gray-200'
            }`}
            style={aspectStyle}
            title={`成片画幅 ${aspectLabel}`}
            onMouseEnter={() => setWantPlay(true)}
            onMouseLeave={() => setWantPlay(false)}
          >
          <DramaShotVideoPreview
            key={previewPlayableUrl || 'empty'}
            playableUrl={previewPlayableUrl}
            posterHint={sbImage}
            isDark={isDark}
            generating={generating}
            mountVideo={mountVideo && !!previewPlayableUrl}
            forcePlay={wantPlay}
            onMediaAspect={setMediaAspectCss}
          />
          {previewPlayableUrl && !generating ? (
            <button
              type="button"
              className={`nodrag absolute right-1.5 top-1.5 z-[3] rounded-md p-1.5 shadow-md ${
                isDark
                  ? 'bg-black/65 text-white hover:bg-black/80'
                  : 'bg-white/90 text-gray-800 hover:bg-white'
              }`}
              title="放大观看"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setWantPlay(false);
                setLightboxOpen(true);
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {!videoUrl && !generating ? (
            <>
              {status === 'error' && videoError ? (
                <div
                  className={`absolute inset-0 z-[2] flex flex-col items-center justify-center gap-1 px-3 text-center text-[12px] leading-snug ${
                    isDark ? 'bg-rose-950/85 text-rose-100' : 'bg-rose-50 text-rose-800'
                  }`}
                >
                  <span className="font-medium">生成失败</span>
                  <span className="line-clamp-4 opacity-90">{videoError}</span>
                </div>
              ) : null}
              {sbImage ? (
                <img
                  src={toDisplayableDramaMediaUrl(sbImage) || sbImage}
                  alt=""
                  className="absolute inset-0 h-full w-full object-contain opacity-90"
                  draggable={false}
                />
              ) : null}
              <div
                className={`absolute inset-0 z-[1] flex flex-col items-center justify-center gap-0.5 px-2 text-center text-[13px] leading-snug ${
                  sbImage ? 'bg-black/35 text-white' : mutedCls(isDark)
                }`}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white shadow-md">
                  <Play className="h-5 w-5 translate-x-0.5" fill="currentColor" />
                </span>
                <span>{sbImage ? '请生成视频' : '待生成'}</span>
                <span className="text-[14px]">按 {tierSec}s 挡位出片</span>
              </div>
            </>
          ) : null}
          {canPickVersions ? (
            <span className="pointer-events-none absolute bottom-1.5 left-1.5 z-[2] rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white shadow-md">
              {videoVersions.length} 个成片
            </span>
          ) : null}
          </div>
          <ModuleProgressBar
            visible={generating}
            progress={generating ? 35 : 0}
            solidBackground={isDark ? '#1C1C1E' : '#e5e7eb'}
            progressMessage={progressMessage || '正在生成视频...'}
            borderRadius={8}
          />
        </div>
        <DramaShotVideoVersionPicker
          open={canPickVersions}
          versions={videoVersions}
          currentUrl={activeVideoUrl}
          isDark={isDark}
          disabled={busy}
          onPick={(url) => {
            setPickedUrl(url);
            setWantPlay(true);
            onSelectVideo?.(shotNo, url);
          }}
        />
      </div>
      {lightboxOpen && activeVideoUrl ? (
        <DramaVideoLightbox
          url={activeVideoUrl}
          name={`镜 ${shotNo || '?'}`}
          isDark={isDark}
          onClose={() => setLightboxOpen(false)}
        />
      ) : null}
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]">
        {checks.map((c) => (
          <span
            key={c.key}
            className={
              c.ok
                ? isDark
                  ? 'text-emerald-300'
                  : 'text-emerald-700'
                : mutedCls(isDark)
            }
          >
            {c.ok ? '√' : '○'} {c.key}
          </span>
        ))}
      </div>
      <div className="relative z-20 flex shrink-0 flex-col gap-1 pointer-events-auto">
        <label
          className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[14px] ${
            isDark ? 'bg-white/8' : 'bg-gray-50'
          }`}
          title={modelMeta?.title || '仅列出已接入的短剧视频模型'}
        >
          <span className={`shrink-0 ${mutedCls(isDark)}`}>模型</span>
            <select
            className={darkSelectCls('min-w-0 flex-1 text-[14px]')}
            value={model}
            disabled={busy || generating}
            onChange={(e) => {
              const next = normalizeDramaSupportedVideoModel(e.target.value);
              onModelChange?.(shotNo, next);
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {modelOptions.map((m) => (
              <option
                key={m.id}
                value={m.id}
                title={m.title}
                className="bg-[#1c1c1e] text-white"
              >
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label
          className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[14px] ${
            isDark ? 'bg-white/8' : 'bg-gray-50'
          }`}
          title="视频总时长。有优化稿时按提示词时码自动选档；也可手改（手改会按比例重映射时码）"
        >
          <span className={`shrink-0 ${mutedCls(isDark)}`}>时长</span>
          <DramaDurationTierPills
            tiers={durationTiers}
            selectedSec={genSec}
            disabled={busy || generating}
            onPick={(sec) => onDurationChange?.(shotNo, sec)}
          />
        </label>
        {hideGenerate ? null : (
        <DramaYuanbaoHoverWrap
          priceLabel={canGenerate && !generating ? priceLabel : null}
          className="w-full"
        >
        <button
          type="button"
          className={`nodrag w-full rounded-md px-2 py-1.5 text-[15px] font-medium disabled:opacity-45 ${
            isDark ? 'bg-sky-500/80 text-white' : 'bg-gray-900 text-white'
          }`}
          disabled={busy || generating || !canGenerate}
          title={
            generating
              ? '生成中，请等待任务结束'
              : !canGenerate
                ? '本镜暂不可生成'
                : `本镜将按 ${modelMeta?.label || model} · ${tierSec}s 挡位生成`
          }
          onClick={() => {
            if (generating || !canGenerate) return;
            onSpawn(shotNo, model);
          }}
        >
          {generating
            ? '生成中…'
            : formatDramaVideoGenButtonLabel({
                hasVideo: !!videoUrl,
                durationSec: Number(tierSec) || planSec,
                compact: true,
              })}
        </button>
        </DramaYuanbaoHoverWrap>
        )}
        {generating ? (
          <button
            type="button"
            className={`nodrag nopan relative z-30 w-full cursor-pointer rounded-md px-2 py-1.5 text-[14px] font-medium pointer-events-auto ${
              isDark
                ? 'bg-white/20 text-white ring-1 ring-white/35 hover:bg-white/30'
                : 'bg-gray-200 text-gray-900 hover:bg-gray-300'
            }`}
            title="仅取消本地等待与绿条；已发出的任务无法撤回，费用不退"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!shotNo) return;
              onAbandonWait?.(shotNo);
            }}
          >
            放弃等待
          </button>
        ) : null}
      </div>
    </section>
  );
});

/** 判断元素是否在滚动容器（或浏览器视口）可见区域内 */
function isElementInScrollViewport(
  el: HTMLElement,
  scrollRoot: HTMLElement | null,
  marginPx: number,
): boolean {
  const rect = el.getBoundingClientRect();
  if (scrollRoot) {
    const rootRect = scrollRoot.getBoundingClientRect();
    return (
      rect.bottom > rootRect.top - marginPx && rect.top < rootRect.bottom + marginPx
    );
  }
  return rect.bottom > -marginPx && rect.top < window.innerHeight + marginPx;
}

/** 画布内分镜列表：视口内挂载图片/文字/视频；滚出滚动区域即卸载 */
function DramaViewportMount({
  scrollRoot,
  force,
  minHeightPx = 380,
  viewportMarginPx = 48,
  shellId,
  shellIndex,
  shellClassName,
  placeholder,
  children,
}: {
  scrollRoot: HTMLElement | null;
  force?: boolean;
  minHeightPx?: number;
  viewportMarginPx?: number;
  shellId?: string;
  shellIndex?: number;
  shellClassName?: string;
  placeholder?: React.ReactNode;
  /** 惰性求值：视口外不创建 children 的 JSX，避免 16 镜同时 render 把主线程占满 */
  children: () => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const unmountTimerRef = useRef(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (force) {
      if (unmountTimerRef.current) {
        window.clearTimeout(unmountTimerRef.current);
        unmountTimerRef.current = 0;
      }
      setVisible(true);
      return;
    }
    const el = ref.current;
    if (!el) return;

    let raf = 0;
    const applyHit = (hit: boolean, fromIo: boolean) => {
      if (hit) {
        if (unmountTimerRef.current) {
          window.clearTimeout(unmountTimerRef.current);
          unmountTimerRef.current = 0;
        }
        setVisible(true);
        return;
      }
      // 初次 measure / 布局未稳不要拆卡，只信 IntersectionObserver 离开视口
      if (!fromIo) return;
      if (unmountTimerRef.current) window.clearTimeout(unmountTimerRef.current);
      unmountTimerRef.current = window.setTimeout(() => {
        unmountTimerRef.current = 0;
        setVisible(false);
      }, 240);
    };
    const measure = () => {
      raf = 0;
      if (!ref.current) return;
      if (isElementInScrollViewport(ref.current, scrollRoot, viewportMarginPx)) {
        applyHit(true, false);
      }
    };
    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(measure);
    };

    schedule();

    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (entries) => {
              const hit = entries.some((e) => e.isIntersecting);
              applyHit(hit, true);
            },
            {
              root: scrollRoot,
              rootMargin: `${viewportMarginPx}px 0px ${viewportMarginPx}px`,
              threshold: 0,
            },
          )
        : null;
    io?.observe(el);

    scrollRoot?.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      if (unmountTimerRef.current) window.clearTimeout(unmountTimerRef.current);
      io?.disconnect();
      scrollRoot?.removeEventListener('scroll', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [force, scrollRoot, viewportMarginPx]);

  const shellProps =
    shellId || Number.isFinite(shellIndex)
      ? {
          id: shellId ? `drama-shot-${shellId}` : undefined,
          'data-drama-shot-index': Number.isFinite(shellIndex) ? shellIndex : undefined,
        }
      : {};

  return (
    <div
      ref={ref}
      {...shellProps}
      className={shellClassName}
      style={{ minHeight: minHeightPx }}
    >
      {visible ? children() : placeholder}
    </div>
  );
}

function DramaBoardPanel({
  session,
  pipeline,
  isDark,
  busy,
  variant = 'board',
  onChange,
  showConfirm,
  onSpawnVideos,
  getShotVideoPriceLabel,
  unitChatPriceLabel,
  unitImagePriceLabel,
  storyboardImageGenSlot,
  onGenerateShotStoryboard,
  videoGeneratingIds,
  onMarkVideoGenerating,
  onAbandonVideoWait,
  onNext,
  runChat,
  showAlert,
  onGenerateShotAudio,
  onAbandonShotAudio,
  unitVoicePriceLabel,
  onApplyShotVideoToSplice,
}: {
  session: DramaDirectorSession;
  pipeline: DirectorPipelineState;
  isDark: boolean;
  busy: boolean;
  variant?: 'board' | 'videos';
  onChange: (
    s: DramaDirectorSession,
    opts?: {
      storyboardsByShotNo?: DirectorPipelineState['storyboardsByShotNo'];
      skipAssetsProjection?: boolean;
    },
  ) => void;
  showConfirm: (message: string) => Promise<boolean>;
  onSpawnVideos?: (opts?: {
    shotNos?: string[];
    startLipsync?: boolean;
    lipsyncShotNos?: string[];
    /** 短剧：覆盖本批视频模型（须为支持的模型） */
    videoModel?: string;
    /** 短剧：按镜号覆盖模型 */
    shotModels?: Record<string, string>;
    /** 短剧：按镜号覆盖上云终稿（与「查看优化稿」一致，避免 setNodes 未刷新） */
    shotPromptOverrides?: Record<string, string>;
  }) => void;
  getShotVideoPriceLabel?: (
    durationSec: number,
    opts?: { model?: string; preferLipsync?: boolean },
  ) => string | null;
  /** 切段 AI 改写 / 合并镜头等 LLM 单次悬停价 */
  unitChatPriceLabel?: string | null;
  unitImagePriceLabel?: string | null;
  storyboardImageGenSlot?: React.ReactNode;
  onGenerateShotStoryboard?: (shotNo: string, opts?: { force?: boolean }) => void;
  videoGeneratingIds?: Record<string, true>;
  onMarkVideoGenerating?: (shotNo: string, on: boolean) => void;
  onAbandonVideoWait?: (shotNo: string) => void;
  onNext: () => void;
  runChat: (
    systemPrompt: string,
    userPrompt: string,
    opts?: {
      max_tokens?: number;
      temperature?: number;
      response_format?: unknown;
      model?: string;
      concurrent?: boolean;
      skillOptimize?: boolean;
      onQueueStatus?: (status: import('../../utils/directorConcurrentChatQueue').DirectorConcurrentChatQueueStatus) => void;
      signal?: AbortSignal | null;
    },
  ) => Promise<string>;
  showAlert: (msg: string) => void;
  onGenerateShotAudio?: (shotId: string) => void;
  onAbandonShotAudio?: (shotId: string) => void;
  unitVoicePriceLabel?: string | null;
  onApplyShotVideoToSplice?: (shotNo: string, videoUrl: string) => void;
}) {
  const { locale } = useAppLocale();
  const [selectedShotIds, setSelectedShotIds] = useState<Record<string, true>>({});
  const [mergingShots, setMergingShots] = useState(false);
  const [mergeProgress, setMergeProgress] = useState('');
  const [focusShotId, setFocusShotId] = useState('');
  /** 正在跑官方 Skill 提示词优化的 shot_id */
  const [skillOptimizingShotId, setSkillOptimizingShotId] = useState('');
  /** 查看 Skill 优化稿全文 */
  const [skillPromptViewShotId, setSkillPromptViewShotId] = useState('');
  /** 视口内由 DramaViewportMount 懒挂载；不再用固定 3 镜滑动窗 */
  const shotListScrollRef = useRef<HTMLDivElement>(null);
  const [shotListScrollEl, setShotListScrollEl] = useState<HTMLDivElement | null>(null);
  const bindShotListScrollRef = useCallback((el: HTMLDivElement | null) => {
    shotListScrollRef.current = el;
    setShotListScrollEl(el);
  }, []);

  const scrollToDramaShot = useCallback((shotId: string, behavior: ScrollBehavior = 'smooth') => {
    const root = shotListScrollRef.current;
    const target = document.getElementById(`drama-shot-${shotId}`);
    if (!root || !target) return;
    const rootRect = root.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextTop = root.scrollTop + (targetRect.top - rootRect.top) - 6;
    root.scrollTo({ top: Math.max(0, nextTop), behavior });
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
  }, []);
  const didLocalEnrichRef = useRef(false);
  /** 多镜并行写回：避免闭包 session 把另一镜的 generating 盖掉 */
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const pipelineRef = useRef(pipeline);
  pipelineRef.current = pipeline;
  const applyShotVideo = useCallback(
    (shotNo: string, url: string) => {
      const key = String(shotNo || '').trim();
      const videoUrl = String(url || '').trim();
      if (!key || !videoUrl) return;
      const live = sessionRef.current;
      const nextPipe = updateDirectorShotStoryboard(pipelineRef.current, key, {
        videoUrl,
        videoStatus: 'ready',
        videoError: '',
      });
      const nextShots = (live.shots || []).map((s) =>
        String(s.shot_no || '').trim() === key
          ? { ...s, video_url: videoUrl, video_status: 'ready', video_error: '' }
          : s,
      );
      onChange(
        { ...live, shots: nextShots },
        { storyboardsByShotNo: nextPipe.storyboardsByShotNo, skipAssetsProjection: true },
      );
      onApplyShotVideoToSplice?.(key, videoUrl);
    },
    [onChange, onApplyShotVideoToSplice],
  );
  const pendingDurationRef = useRef<
    Record<string, { duration_sec: number; timeline_events: DramaTimelineEvent[] }>
  >({});
  const [pendingDurationByShotId, setPendingDurationByShotId] = useState<
    Record<string, { duration_sec: number; timeline_events: DramaTimelineEvent[] }>
  >({});
  const mergePendingDuration = (shot: DramaShot): DramaShot => {
    const pending = pendingDurationRef.current[shot.shot_id];
    return pending
      ? { ...shot, duration_sec: pending.duration_sec, timeline_events: pending.timeline_events }
      : shot;
  };
  /** 结构化视听事件时间轴 v6 */
  const didThinTimelineFixRef = useRef<string>('');
  const selectedShotCount = Object.keys(selectedShotIds).length;

  const toggleShotSelected = (shotId: string, on?: boolean) => {
    const id = String(shotId || '').trim();
    if (!id) return;
    setSelectedShotIds((prev) => {
      const next = { ...prev };
      const want = typeof on === 'boolean' ? on : !next[id];
      if (want) next[id] = true;
      else delete next[id];
      return next;
    });
  };

  const clearShotSelection = () => setSelectedShotIds({});

  const commitMergedShots = (
    plan: NonNullable<ReturnType<typeof planMergeDramaShots>>,
    merged?: { final: string; source: string; draft: string },
  ) => {
    let working: DramaDirectorSession = {
      ...session,
      shots: (session.shots || []).map((s, i) =>
        i === plan.targetIndex
          ? ensureDramaShotTimelineEvents({
              ...s,
              ...plan.patch,
              ...(merged
                ? {
                    last_compiled_prompt:
                      merged.source || String(plan.patch.last_compiled_prompt || ''),
                    confirmed_at: Date.now(),
                    needs_review: false,
                  }
                : {}),
            }, session)
          : s,
      ),
      meta: {
        ...session.meta,
        board_confirmed_at: 0,
        needs_stage_reconfirm: true,
      },
    };
    let boards = { ...(pipeline.storyboardsByShotNo || {}) };
    const removeDesc = [...plan.removeIndices].sort((a, b) => b - a);
    for (const idx of removeDesc) {
      const prevNos = (working.shots || []).map((s) => String(s.shot_no || '').trim());
      working = removeDramaShotAt(working, idx);
      const nextNos = (working.shots || []).map((s) => String(s.shot_no || '').trim());
      boards = remapDramaStoryboardsAfterShotListEdit(
        { ...pipeline, storyboardsByShotNo: boards },
        prevNos,
        nextNos,
        { type: 'remove', index: idx },
      );
    }
    onChange(working, { storyboardsByShotNo: boards });
    clearShotSelection();
    setFocusShotId(plan.targetShotId);
    setActiveEventId('');
    const idx = (working.shots || []).findIndex((s) => s.shot_id === plan.targetShotId);
    if (idx >= 0) {
      setFocusShotId(plan.targetShotId);
    }
    requestAnimationFrame(() => scrollToDramaShot(plan.targetShotId, 'auto'));
  };

  const handleMergeSelectedShots = async () => {
    if (busy || mergingShots) return;
    const ids = Object.keys(selectedShotIds).filter((id) => selectedShotIds[id]);
    if (ids.length < 2) {
      showAlert('请至少勾选 2 个镜头再合并');
      return;
    }
    const plan = planMergeDramaShots(session, ids);
    if (!plan) {
      showAlert('所选镜头无效，请重新勾选');
      return;
    }
    const nos = ids
      .map((id) => session.shots?.find((s) => s.shot_id === id)?.shot_no)
      .filter(Boolean)
      .map((n) => String(n).padStart(2, '0'))
      .join('、');
    const targetNo = String(
      session.shots?.[plan.targetIndex]?.shot_no || plan.targetIndex + 1,
    ).padStart(2, '0');
    const ok = await showConfirm(
      `将合并镜头 ${nos} 为一镜（保留镜头${targetNo}）。\n\n` +
        `· 参考图/人物/道具会去重保留不重复项\n` +
        `· 时间轴与提示词按顺序拼接\n` +
        `· 随后调用大模型整合时间轴与切段\n` +
        `· 其余镜头将删除，已有成片不保留\n\n确定继续？`,
    );
    if (!ok) return;
    setMergingShots(true);
    setMergeProgress('去重参考图并拼接时间轴…');
    try {
      const sourceShots = ids
        .map((id) => session.shots?.find((s) => s.shot_id === id))
        .filter((s): s is DramaShot => !!s)
        .sort(
          (a, b) =>
            (session.shots || []).findIndex((x) => x.shot_id === a.shot_id) -
            (session.shots || []).findIndex((x) => x.shot_id === b.shot_id),
        );
      setMergeProgress('大模型整合时间轴…');
      const merged = await runDramaMultiShotH3SkillMerge({
        session,
        sourceShots,
        mergedShot: plan.mergedShot,
        runChat,
        locale: locale === 'en' ? 'en' : 'zh-CN',
      });
      const reportPreview = String(merged.report || '').trim().slice(0, 900);
      const adopt = await showConfirm(
        `整合完成。${reportPreview ? `\n\n整合报告：\n${reportPreview}` : ''}\n\n确认写入镜头${targetNo}并删除其余所选镜头？`,
      );
      if (!adopt) return;
      commitMergedShots(plan, merged);
      showAlert(`已合并为镜头${targetNo}，请检查时间轴与提示词后再出片`);
    } catch (e) {
      showAlert(formatCloudLlmUserError(e) || '合并镜头失败');
    } finally {
      setMergingShots(false);
      setMergeProgress('');
    }
  };

  const issues = session.continuity_issues || [];
  const shots = session.shots || [];
  const focusShotIndex = Math.max(
    0,
    shots.findIndex((s) => s.shot_id === focusShotId),
  );

  const missingDesign = listCharactersMissingDesign(session);

  useEffect(() => {
    if (variant !== 'board') return;
    if (!shots.length) {
      if (focusShotId) setFocusShotId('');
      return;
    }
    if (!shots.some((s) => s.shot_id === focusShotId)) {
      setFocusShotId(shots[0].shot_id);
    }
  }, [variant, focusShotId, shots.map((s) => s.shot_id).join('|')]);

  // 进分镜禁止自动 enrich / continuity：整表克隆 + 写回会在等待后撑爆堆（OOM 闪退）
  useEffect(() => {
    didLocalEnrichRef.current = true;
    didThinTimelineFixRef.current = 'v6-events';
  }, []);

  const videoModel = normalizeDramaSupportedVideoModel(
    session.meta.videoBatchModel || 'minimax-h3-multi',
  );
  const aspectRatio =
    session.meta.aspect_ratio === '16:9' ||
    session.meta.aspect_ratio === '9:16' ||
    session.meta.aspect_ratio === '3:4' ||
    session.meta.aspect_ratio === '4:3'
      ? session.meta.aspect_ratio
      : '9:16';

  const setAspectRatio = (next: string) => {
    const a =
      next === '16:9' || next === '9:16' || next === '3:4' || next === '4:3' ? next : '9:16';
    onChange(
      createEmptyDramaSession({
        ...session,
        meta: { ...session.meta, aspect_ratio: a },
      }),
    );
  };

  const setDefaultVideoModel = (raw: string) => {
    const nextModel = normalizeDramaSupportedVideoModel(raw);
    onChange(
      createEmptyDramaSession({
        ...session,
        meta: {
          ...session.meta,
          // 允许默认选对口型；出片时非口型镜回落到 multi
          videoBatchModel:
            nextModel === 'minimax-h3-audio' ? 'minimax-h3-audio' : nextModel,
          videoBatchLipsyncModel: 'minimax-h3-audio',
        },
      }),
    );
  };

  const videoResolution = normalizeDirectorVideoBatchResolution(
    videoModel === 'minimax-h3-audio' ? 'minimax-h3-audio' : 'minimax-h3-multi',
    session.meta.videoBatchResolution ||
      session.meta.videoBatchLipsyncResolution ||
      pipeline.videoBatchResolution ||
      '720p',
  );
  const videoResolutionOptions =
    getDirectorVideoBatchResolutionOptions(
      videoModel === 'minimax-h3-audio' ? 'minimax-h3-audio' : 'minimax-h3-multi',
    ) || [];

  const setVideoResolution = (raw: string) => {
    const res = normalizeDirectorVideoBatchResolution('minimax-h3-multi', raw);
    const lipsyncRes = normalizeDirectorVideoBatchResolution('minimax-h3-audio', raw);
    onChange(
      createEmptyDramaSession({
        ...session,
        meta: {
          ...session.meta,
          videoBatchResolution: res,
          videoBatchLipsyncResolution: lipsyncRes,
        },
      }),
    );
  };

  const setShotVideoModel = useCallback((shotNo: string, raw: string) => {
    const no = String(shotNo || '').trim();
    if (!no) return;
    const nextModel = normalizeDramaSupportedVideoModel(raw);
    const base = sessionRef.current;
    onChange(
      createEmptyDramaSession({
        ...base,
        shots: base.shots.map((s) =>
          String(s.shot_no || '').trim() === no
            ? {
                ...s,
                model_params: { ...(s.model_params || {}), video_model: nextModel },
              }
            : s,
        ),
      }),
    );
  }, [onChange]);

  const patchShotById = useCallback((
    shotId: string,
    patch: Partial<DramaShot>,
    opts?: { skipBreakdown?: boolean; skipAssetsProjection?: boolean },
  ) => {
    const id = String(shotId || '').trim();
    if (!id) return;
    const base = sessionRef.current;
    const before = base.shots.find((s) => s.shot_id === id);
    const nextShots = base.shots.map((s) => (s.shot_id === id ? { ...s, ...patch } : s));
    // 热路径：禁止 createEmptyDramaSession 重扫全部分镜（输入/点选会卡）
    let next: DramaDirectorSession = { ...base, shots: nextShots };
    const after = nextShots.find((s) => s.shot_id === id);
    const durationOnly = Object.keys(patch).every(
      (k) =>
        k === 'duration_sec' ||
        k === 'timeline_events' ||
        k === 'timeline_beats' ||
        k === 'audio_timeline',
    );
    if (
      !opts?.skipBreakdown &&
      !durationOnly &&
      before &&
      after &&
      dramaShotDirectingFingerprint(before) !== dramaShotDirectingFingerprint(after) &&
      !String(patch.prompt_source_fingerprint || '').trim()
    ) {
      const idx = nextShots.findIndex((s) => s.shot_id === id);
      const shotIds = [id];
      if (idx >= 0 && idx + 1 < nextShots.length) shotIds.push(nextShots[idx + 1].shot_id);
      next = applyDramaDirectingBreakdownSession(next, { shotIds });
    }
    sessionRef.current = next;
    onChange(next, {
      skipAssetsProjection: opts?.skipAssetsProjection ?? durationOnly,
    });
  }, [onChange]);

  const commitShotListEdit = (
    nextSession: DramaDirectorSession,
    op: { type: 'remove' | 'insert'; index: number },
  ) => {
    const prevNos = (session.shots || []).map((s) => String(s.shot_no || '').trim());
    const nextNos = (nextSession.shots || []).map((s) => String(s.shot_no || '').trim());
    const boards = remapDramaStoryboardsAfterShotListEdit(pipeline, prevNos, nextNos, op);
    onChange(nextSession, { storyboardsByShotNo: boards });
    const focusId =
      op.type === 'insert'
        ? nextSession.shots[op.index]?.shot_id
        : nextSession.shots[Math.min(op.index, nextSession.shots.length - 1)]?.shot_id;
    if (focusId) {
      setFocusShotId(focusId);
      setActiveEventId('');
      const idx = nextSession.shots.findIndex((s) => s.shot_id === focusId);
      if (idx >= 0) {
        requestAnimationFrame(() => scrollToDramaShot(focusId, 'auto'));
      }
    }
  };

  const handleDeleteShotAt = async (index: number) => {
    if (busy) return;
    if ((session.shots || []).length <= 1) {
      showAlert('至少保留 1 个镜头');
      return;
    }
    const shot = session.shots[index];
    const no = String(shot?.shot_no || index + 1).padStart(2, '0');
    const ok = await showConfirm(`确定删除镜头${no}？成片与本镜提示词将一并移除，不可恢复。`);
    if (!ok) return;
    commitShotListEdit(removeDramaShotAt(session, index), { type: 'remove', index });
  };

  const handleInsertShotAt = (atIndex: number) => {
    if (busy) return;
    commitShotListEdit(insertDramaShotAt(session, atIndex), {
      type: 'insert',
      index: atIndex,
    });
  };

  useEffect(() => {
    const pending = pendingDurationRef.current;
    const ids = Object.keys(pending);
    if (!ids.length) return;
    let changed = false;
    const next = { ...pending };
    for (const id of ids) {
      const s = session.shots.find((x) => x.shot_id === id);
      if (!s || Math.abs(Number(s.duration_sec) - pending[id].duration_sec) < 1e-6) {
        delete next[id];
        changed = true;
      }
    }
    if (!changed) return;
    pendingDurationRef.current = next;
    setPendingDurationByShotId(next);
  }, [session.shots]);

  const handleShotVideoDurationChange = (shotNo: string, sec: number) => {
    const no = String(shotNo || '').trim();
    const latest = sessionRef.current.shots.find((x) => String(x.shot_no || '').trim() === no);
    if (!latest) return;
    const merged = mergePendingDuration(latest);
    const model = resolveDramaShotVideoModel(merged.model_params, sessionRef.current.meta.videoBatchModel, {
      hasDialogue: dramaShotHasSpokenDialogue(merged),
      hasShotAudio: !!String(merged.audio_url || '').trim(),
    });
    const tiers = resolveDramaShotDurationTiers(model);
    const n = Number(sec);
    const dur = tiers.includes(n) ? n : snapDramaShotDurationSec(n);
    const fromSec = Math.max(
      0.1,
      Number(merged.duration_sec) || 0,
      ...(merged.timeline_events || []).map((e) => Number(e.end_sec) || 0),
    );
    const already =
      Math.abs(fromSec - dur) < 0.15 &&
      String(merged.model_params?.[DRAMA_SHOT_VIDEO_DURATION_PARAM] || '') === String(dur);
    if (already) return;

    // 视频时长 = 总时长；彩条切段按占比缩放到新总时长
    // 若档位正是优化稿时码反推结果，不重映射提示词（保留分析稿时码）
    const inferred = inferDramaDurationSecFromH3Prompt(
      String(merged.h3_skill_prompt || ''),
      tiers,
    );
    const fromPrompt = inferred != null && Math.abs(inferred - dur) < 0.05;
    const aligned = alignDramaShotTimelineToGenerateDuration(merged, dur, {
      remapPrompts: !fromPrompt,
    });
    patchShotById(
      aligned.shot.shot_id,
      {
        duration_sec: aligned.shot.duration_sec,
        timeline_events: aligned.shot.timeline_events,
        model_params: aligned.shot.model_params,
        h3_skill_prompt: aligned.shot.h3_skill_prompt,
        h3_skill_prompt_from: aligned.shot.h3_skill_prompt_from,
      },
      { skipBreakdown: true, skipAssetsProjection: true },
    );
    const pending = { ...pendingDurationRef.current };
    if (pending[aligned.shot.shot_id]) {
      delete pending[aligned.shot.shot_id];
      pendingDurationRef.current = pending;
      setPendingDurationByShotId(pending);
    }
  };

  /** 提示词优化：与画布同一 Skill；先把彩条/时段对齐到出片生成时长 */
  const optimizeShotWithH3Skill = useCallback(
    async (
      shotId: string,
      opts?: { quiet?: boolean; force?: boolean },
    ): Promise<DramaShot | null> => {
      const base0 = {
        ...sessionRef.current,
        shots: sessionRef.current.shots.map(mergePendingDuration),
      };
      const rawShot = base0.shots.find((s) => s.shot_id === shotId);
      if (!rawShot) return null;
      const matchBlock = dramaManualPipelineBlockReason(base0, 'skill_seal');
      if (matchBlock) {
        if (!opts?.quiet) showAlert(matchBlock);
        return null;
      }

      const videoModel0 = resolveDramaShotVideoModel(
        rawShot.model_params,
        base0.meta.videoBatchModel,
        {
          hasDialogue: dramaShotHasSpokenDialogue(rawShot),
          hasShotAudio: !!String(rawShot.audio_url || '').trim(),
        },
      );
      const genSec = resolveDramaShotGenerateDurationSec(
        Number(rawShot.duration_sec) || 10,
        videoModel0,
        rawShot.model_params,
      );
      const alignedRes = alignDramaShotTimelineToGenerateDuration(rawShot, genSec);
      let shot = alignedRes.shot;
      if (alignedRes.changed) {
        patchShotById(
          shot.shot_id,
          {
            duration_sec: shot.duration_sec,
            timeline_events: shot.timeline_events,
            model_params: shot.model_params,
            h3_skill_prompt: shot.h3_skill_prompt,
            h3_skill_prompt_from: shot.h3_skill_prompt_from,
          },
          { skipBreakdown: true, skipAssetsProjection: true },
        );
        const pending = { ...pendingDurationRef.current };
        if (pending[shot.shot_id]) {
          delete pending[shot.shot_id];
          pendingDurationRef.current = pending;
          setPendingDurationByShotId(pending);
        }
      }

      const base = {
        ...sessionRef.current,
        shots: sessionRef.current.shots.map((s) =>
          s.shot_id === shot.shot_id ? shot : mergePendingDuration(s),
        ),
      };

      const sourcePrompt = composeDramaShotLensTaggedPrompt(base, shot);
      if (
        !opts?.force &&
        dramaShotSkillMatchesLocale(shot, locale) &&
        String(shot.h3_skill_prompt_from || '').trim() === sourcePrompt
      ) {
        if (!opts?.quiet) {
          showAlert(
            locale === 'en'
              ? `Shot ${shot.shot_no}: Skill prompt is already up to date`
              : `镜头${shot.shot_no} 已是最新 MiniMax H3 Skill 优化稿`,
          );
        }
        return shot;
      }
      if (!window.electronAPI?.getMinimaxH3PromptGuide) {
        if (!opts?.quiet) {
          showAlert(
            locale === 'en'
              ? 'MiniMax H3 Skill guide is unavailable in this build'
              : '本构建缺少 MiniMax H3 Skill 指南',
          );
        }
        return null;
      }
      setSkillOptimizingShotId(shot.shot_id);
      try {
        const videoModel = resolveDramaShotVideoModel(
          shot.model_params,
          base.meta.videoBatchModel,
          {
            hasDialogue: dramaShotHasSpokenDialogue(shot),
            hasShotAudio: !!String(shot.audio_url || '').trim(),
          },
        );
        const modelId =
          videoModel === 'minimax-h3-audio' ? 'minimax-h3-audio' : 'minimax-h3-multi';
        const structure = resolveMinimaxH3OptimizeStructure(modelId);
        const guideRes = await window.electronAPI.getMinimaxH3PromptGuide(structure);
        if (!guideRes?.ok) {
          throw new Error(
            (guideRes as { error?: string } | null)?.error ||
              (locale === 'en' ? 'Failed to load H3 Skill guide' : '加载 H3 Skill 指南失败'),
          );
        }
        const built = buildDramaShotH3SkillOptimizeMessages({
          session: base,
          shot,
          skillMd: guideRes.skillMd,
          guideText: guideRes.guide,
          sourcePrompt,
          videoModel: modelId,
        });
        const raw = await runChat(built.systemPrompt, built.userPrompt, {
          max_tokens: 8192,
          temperature: 0.2,
          concurrent: true,
          skillOptimize: true,
        });
        const optimized = applyDramaShotH3SkillOptimizeResult(
          base,
          shot,
          raw,
          built.sourcePrompt,
          built.structure,
        );
        const tiers = resolveDramaShotDurationTiers(
          resolveDramaShotVideoModel(shot.model_params, base.meta.videoBatchModel, {
            hasDialogue: dramaShotHasSpokenDialogue(shot),
            hasShotAudio: !!String(shot.audio_url || '').trim(),
          }),
        );
        const inferred = inferDramaDurationSecFromH3Prompt(
          optimized.h3_skill_prompt || '',
          tiers,
        );
        const synced =
          inferred != null
            ? alignDramaShotTimelineToGenerateDuration(optimized, inferred, {
                remapPrompts: false,
              }).shot
            : {
                ...optimized,
                duration_sec: shot.duration_sec,
                timeline_events: shot.timeline_events,
                model_params: shot.model_params,
              };
        patchShotById(synced.shot_id, {
          duration_sec: synced.duration_sec,
          timeline_events: synced.timeline_events,
          model_params: synced.model_params,
          last_compiled_prompt: synced.last_compiled_prompt,
          h3_skill_prompt: synced.h3_skill_prompt,
          h3_skill_prompt_from: synced.h3_skill_prompt_from,
        });
        if (!opts?.quiet) {
          showAlert(
            dramaShotSkillMatchesLocale(synced, locale)
              ? locale === 'en'
                ? `Shot ${synced.shot_no}: MiniMax H3 Skill optimize done (${synced.duration_sec}s)`
                : `镜头${synced.shot_no} 已用 MiniMax H3 Skill 优化（时长档已按提示词时码对齐 ${synced.duration_sec}s）`
              : locale === 'en'
                ? `Shot ${synced.shot_no}: optimize finished — please check prompt format`
                : `镜头${synced.shot_no} 优化完成（请再检查提示词格式）`,
          );
        }
        return synced;
      } catch (e) {
        if (!opts?.quiet) {
          showAlert(
            formatCloudLlmUserError(e) ||
              (locale === 'en' ? 'Prompt optimize failed' : '提示词优化失败'),
          );
        }
        throw e;
      } finally {
        setSkillOptimizingShotId((cur) => (cur === shot.shot_id ? '' : cur));
      }
    },
    [locale, mergePendingDuration, patchShotById, runChat, showAlert],
  );

  /** 出片前确保 Skill 终稿；先对齐生成时长，失败时回退本地英文密封 */
  const ensureShotH3SkillOptimized = useCallback(
    async (shot: DramaShot, opts?: { quiet?: boolean }): Promise<DramaShot> => {
      const base0 = {
        ...sessionRef.current,
        shots: sessionRef.current.shots.map(mergePendingDuration),
      };
      const live0 = base0.shots.find((s) => s.shot_id === shot.shot_id) || shot;
      const videoModel0 = resolveDramaShotVideoModel(
        live0.model_params,
        base0.meta.videoBatchModel,
        {
          hasDialogue: dramaShotHasSpokenDialogue(live0),
          hasShotAudio: !!String(live0.audio_url || '').trim(),
        },
      );
      const genSec = resolveDramaShotGenerateDurationSec(
        Number(live0.duration_sec) || 10,
        videoModel0,
        live0.model_params,
      );
      const alignedRes = alignDramaShotTimelineToGenerateDuration(live0, genSec);
      let live = alignedRes.shot;
      if (alignedRes.changed) {
        patchShotById(
          live.shot_id,
          {
            duration_sec: live.duration_sec,
            timeline_events: live.timeline_events,
            model_params: live.model_params,
            h3_skill_prompt: live.h3_skill_prompt,
            h3_skill_prompt_from: live.h3_skill_prompt_from,
          },
          { skipBreakdown: true, skipAssetsProjection: true },
        );
      }
      // 已有优化稿（含中文 Skill / 白话）：出片只保留，不重跑、不回退密封冲掉
      if (String(live.h3_skill_prompt || '').trim()) {
        return live;
      }
      try {
        const optimized = await optimizeShotWithH3Skill(live.shot_id, {
          quiet: opts?.quiet ?? true,
        });
        if (optimized && String(optimized.h3_skill_prompt || '').trim()) return optimized;
      } catch {
        /* fallback below */
      }
      const base = {
        ...sessionRef.current,
        shots: sessionRef.current.shots.map((s) =>
          s.shot_id === live.shot_id ? live : mergePendingDuration(s),
        ),
      };
      const current = base.shots.find((s) => s.shot_id === live.shot_id) || live;
      const sealed = applyDramaShotZhPlainOfficialSeal(base, current);
      patchShotById(sealed.shot_id, {
        duration_sec: current.duration_sec,
        timeline_events: current.timeline_events,
        model_params: current.model_params,
        last_compiled_prompt: sealed.last_compiled_prompt,
        h3_skill_prompt: sealed.h3_skill_prompt,
        h3_skill_prompt_from: sealed.h3_skill_prompt_from,
      });
      return {
        ...sealed,
        duration_sec: current.duration_sec,
        timeline_events: current.timeline_events,
        model_params: current.model_params,
      };
    },
    [locale, mergePendingDuration, optimizeShotWithH3Skill, patchShotById],
  );

  const spawnOneShot = useCallback(async (shotNo: string, pickedModel?: string) => {
    const base = {
      ...sessionRef.current,
      shots: sessionRef.current.shots.map(mergePendingDuration),
    };
    const no = String(shotNo || '').trim();
    if (!no) return;
    let shot = base.shots.find((s) => String(s.shot_no || '').trim() === no);
    if (videoGeneratingIds?.[no]) {
      showAlert('本镜正在生成中，请等待完成或点「放弃等待」');
      return;
    }
    const matchBlock = dramaManualPipelineBlockReason(base, 'generate');
    if (matchBlock) {
      showAlert(matchBlock);
      return;
    }
    if (shot) {
      shot = await ensureShotH3SkillOptimized(shot, { quiet: true });
      base.shots = base.shots.map((s) => (s.shot_id === shot!.shot_id ? shot! : s));
    }
    if (shot) {
      const synced = syncDramaShotCharacterIds(base, shot);
      if (
        (synced.character_ids || []).join(',') !== (shot.character_ids || []).join(',')
      ) {
        patchShotById(shot.shot_id, { character_ids: synced.character_ids });
      }
      const castErr = formatDramaShotCastGateError(base, synced);
      if (castErr) {
        showAlert(castErr);
        return;
      }
    }
    const hasDlg = shot ? dramaShotHasSpokenDialogue(shot) : false;
    const hasAudio = !!String(shot?.audio_url || '').trim();
    const videoModelForShot = normalizeDramaSupportedVideoModel(
      pickedModel ||
        resolveDramaShotVideoModel(shot?.model_params, base.meta.videoBatchModel, {
          hasDialogue: hasDlg,
          hasShotAudio: hasAudio,
        }),
    );
    if (dramaVideoModelRequiresShotAudio(videoModelForShot) && !hasAudio) {
      showAlert(
        hasDlg
          ? '口型同步模型需要本镜音轨：请先「生成本镜声音」'
          : '口型同步模型需要本镜音轨：请先生成本镜声音，或改选全能参考',
      );
      return;
    }
    // 仅显式勾选「用分镜图作出片参考」时，缺图才先触发生成；未勾选走场景+人/道具/生物
    if (shot) {
      const boardSb = getDirectorShotStoryboard(pipeline, no).imageUrl;
      const sbUrl = resolveDramaShotStoryboardImageUrl(shot, boardSb);
      if (sbUrl && !String(shot.storyboard_image_url || '').trim()) {
        shot = { ...shot, storyboard_image_url: sbUrl };
        patchShotById(shot.shot_id, { storyboard_image_url: sbUrl });
        base.shots = base.shots.map((s) => (s.shot_id === shot!.shot_id ? shot! : s));
      }
      if (shot.use_storyboard_as_video_ref === true && !sbUrl) {
        onGenerateShotStoryboard?.(no, { force: false });
        showAlert('本镜已勾选用分镜图作出片参考，但尚无分镜图，已开始生成。完成后请再点「生成视频」。');
        return;
      }
    }
    let next = refreshDramaPackages(base, videoModelForShot);
    next = {
      ...next,
      shots: next.shots.map((s) =>
        String(s.shot_no || '').trim() === no
          ? {
              ...s,
              video_status: 'generating',
              model_params: { ...(s.model_params || {}), video_model: videoModelForShot },
            }
          : s,
      ),
    };
    onMarkVideoGenerating?.(no, true);
    onChange(next);
    const useLipsync = videoModelForShot === 'minimax-h3-audio';
    const cloudPrompt = shot
      ? (() => {
          // 优先原样用已优化中文稿；仅做确定性封口，不再 Compiler 重写
          const raw = String(shot.h3_skill_prompt || '').trim();
          const source =
            raw ||
            resolveDramaProductionH3Prompt(next, shot, {
              locale,
              durationSec:
                Number(shot.duration_sec) > 0 ? Number(shot.duration_sec) : undefined,
            });
          const style = resolveDramaShotVisualStylePrompt(next, shot);
          return sealDramaProductionCloudPrompt(source, {
            hasDialogue: hasDlg,
            preserveChinese: /[\u4e00-\u9fff]/.test(source),
            storyboardPicIndex: resolveDramaShotStoryboardPictureIndex(next, shot),
            styleHint: [
              style.body,
              style.name,
              next.bible?.project?.visual_style,
              next.bible?.project?.color_style,
              source,
            ]
              .filter(Boolean)
              .join(' '),
            session: next,
            shot,
          });
        })()
      : '';
    onSpawnVideos?.(
      useLipsync
        ? {
            shotNos: [no],
            startLipsync: true,
            lipsyncShotNos: [no],
            videoModel: videoModelForShot,
            shotModels: { [no]: videoModelForShot },
            ...(cloudPrompt ? { shotPromptOverrides: { [no]: cloudPrompt } } : {}),
          }
        : {
            shotNos: [no],
            videoModel: videoModelForShot,
            shotModels: { [no]: videoModelForShot },
            ...(cloudPrompt ? { shotPromptOverrides: { [no]: cloudPrompt } } : {}),
          },
    );
  }, [ensureShotH3SkillOptimized, videoGeneratingIds, showAlert, patchShotById, onSpawnVideos, onMarkVideoGenerating, onChange, locale, pipeline, onGenerateShotStoryboard]);

  const shotNeedsBatchVideo = (s: DramaShot) => {
    const no = String(s.shot_no || '').trim();
    if (!no) return false;
    const boardVideo = resolveDramaShotBoardVideo(s, pipeline);
    return directorShotNeedsVideoGeneration({
      videoUrl: boardVideo.videoUrl,
      videoStatus: boardVideo.videoStatus || s.video_status,
    });
  };
  const pendingVideoShots = shots.filter((s) => {
    const no = String(s.shot_no || '').trim();
    return no && !videoGeneratingIds?.[no] && shotNeedsBatchVideo(s);
  });
  const allRerunVideoShots = shots.filter(
    (s) =>
      String(s.shot_no || '').trim() &&
      !videoGeneratingIds?.[String(s.shot_no || '').trim()],
  );
  const pendingBatchPriceLabel = sumDramaYuanbaoHoverLabel(
    pendingVideoShots.map((s) => {
      const model = resolveDramaShotVideoModel(s.model_params, session.meta.videoBatchModel, {
        hasDialogue: dramaShotHasSpokenDialogue(s),
        hasShotAudio: !!String(s.audio_url || '').trim(),
      });
      const dur = resolveDramaShotGenerateDurationSec(
        Number(s.duration_sec) || 10,
        model,
        s.model_params,
      );
      return getShotVideoPriceLabel?.(dur, {
        model,
        preferLipsync: dramaVideoModelRequiresShotAudio(model),
      });
    }),
  );
  const allRerunBatchPriceLabel = sumDramaYuanbaoHoverLabel(
    allRerunVideoShots.map((s) => {
      const model = resolveDramaShotVideoModel(s.model_params, session.meta.videoBatchModel, {
        hasDialogue: dramaShotHasSpokenDialogue(s),
        hasShotAudio: !!String(s.audio_url || '').trim(),
      });
      const dur = resolveDramaShotGenerateDurationSec(
        Number(s.duration_sec) || 10,
        model,
        s.model_params,
      );
      return getShotVideoPriceLabel?.(dur, {
        model,
        preferLipsync: dramaVideoModelRequiresShotAudio(model),
      });
    }),
  );
  const readyVideoCount = shots.filter((s) => {
    const no = String(s.shot_no || '').trim();
    return !!(no && !videoGeneratingIds?.[no] && !shotNeedsBatchVideo(s));
  }).length;
  const busyVideoCount = shots.filter((s) => {
    const no = String(s.shot_no || '').trim();
    if (!no) return false;
    if (videoGeneratingIds?.[no]) return true;
    const st = String(s.video_status || '').trim();
    if (st === 'generating' || st === 'queued') return true;
    const board = resolveDramaShotBoardVideo(s, pipeline);
    return board.videoStatus === 'generating' || board.videoStatus === 'queued';
  }).length;

  const abandonAllVideoWaits = () => {
    for (const s of shots) {
      const no = String(s.shot_no || '').trim();
      if (!no) continue;
      const st = String(s.video_status || '').trim();
      const board = resolveDramaShotBoardVideo(s, pipeline);
      if (
        videoGeneratingIds?.[no] ||
        st === 'generating' ||
        st === 'queued' ||
        board.videoStatus === 'generating' ||
        board.videoStatus === 'queued'
      ) {
        onAbandonVideoWait?.(no);
      }
    }
  };

  const spawnAllShots = async (mode: 'missing' | 'all' = 'missing') => {
    if (!shots.length) {
      showAlert('暂无镜头可生成');
      return;
    }
    const targetShots =
      mode === 'all'
        ? shots.filter(
            (s) =>
              String(s.shot_no || '').trim() &&
              !videoGeneratingIds?.[String(s.shot_no || '').trim()],
          )
        : pendingVideoShots;
    if (!targetShots.length) {
      if (busyVideoCount) {
        showAlert(
          `有 ${busyVideoCount} 镜仍在生成中。未出片镜头已全部在跑，请等待或先「放弃等待」`,
        );
        return;
      }
      showAlert('全部镜头已有成片。单镜可点「重新生成」，或点「全部重跑」');
      return;
    }
    const castBlocked = targetShots
      .map((s) => {
        const err = formatDramaShotCastGateError(session, s);
        return err ? `镜${String(s.shot_no || '').trim()}：${err}` : '';
      })
      .filter(Boolean);
    if (castBlocked.length) {
      const ok = await showConfirm(
        `以下镜头未标明空镜却缺出场人物/人物素材：\n${castBlocked.slice(0, 6).join('\n')}${
          castBlocked.length > 6 ? `\n…另有 ${castBlocked.length - 6} 镜` : ''
        }\n\n确认继续生成？`,
      );
      if (!ok) return;
    }
    for (const s of targetShots) {
      try {
        await ensureShotH3SkillOptimized(s, { quiet: true });
      } catch {
        /* ensure 内部已本地回退 */
      }
    }
    const shotModels: Record<string, string> = {};
    const lipsyncNos: string[] = [];
    const missingAudioForLipsync: string[] = [];
    const targetNos = new Set(
      targetShots.map((s) => String(s.shot_no || '').trim()).filter(Boolean),
    );
    for (const s of targetShots) {
      const no = String(s.shot_no || '').trim();
      if (!no) continue;
      const hasDlg = dramaShotHasSpokenDialogue(s);
      const hasAudio = !!String(s.audio_url || '').trim();
      const m = resolveDramaShotVideoModel(s.model_params, session.meta.videoBatchModel, {
        hasDialogue: hasDlg,
        hasShotAudio: hasAudio,
      });
      shotModels[no] = m;
      if (m === 'minimax-h3-audio') {
        if (!hasAudio) missingAudioForLipsync.push(no);
        else lipsyncNos.push(no);
      }
    }
    if (missingAudioForLipsync.length) {
      showAlert(
        `镜 ${missingAudioForLipsync.join('、')} 选用了口型同步但尚未生成本镜声音，请先生成声音或改选其它支持的模型`,
      );
      return;
    }
    const missingSbNos = targetShots
      .map((s) => {
        if (s.use_storyboard_as_video_ref !== true) return '';
        const no = String(s.shot_no || '').trim();
        if (!no) return '';
        const url = resolveDramaShotStoryboardImageUrl(
          s,
          getDirectorShotStoryboard(pipeline, no).imageUrl,
        );
        return url ? '' : no;
      })
      .filter(Boolean);
    if (missingSbNos.length) {
      for (const no of missingSbNos) onGenerateShotStoryboard?.(no, { force: false });
      showAlert(
        `镜 ${missingSbNos.slice(0, 8).join('、')}${
          missingSbNos.length > 8 ? ` 等 ${missingSbNos.length} 镜` : ''
        } 已勾选用分镜图作出片参考但尚无分镜图，已开始生成。完成后请再点生成视频。`,
      );
      return;
    }
    let next = refreshDramaPackages(
      {
        ...sessionRef.current,
        shots: sessionRef.current.shots.map(mergePendingDuration),
      },
      videoModel,
    );
    for (const pkg of Object.values(next.packages || {})) {
      const adapter = getDramaVideoAdapter(pkg.adapter_id);
      if (!adapter) continue;
      try {
        const shot = next.shots.find((s) => s.shot_id === pkg.shot_id);
        if (!shot) continue;
        const no = String(shot.shot_no || '').trim();
        if (!targetNos.has(no)) continue;
        const m = normalizeDramaSupportedVideoModel(shotModels[no] || videoModel);
        const tier = resolveDramaShotGenerateDurationSec(
          Number(shot.duration_sec) || 5,
          m,
          shot.model_params,
        );
        adapter.build({
          shot,
          package: { ...pkg, adapter_id: m },
          session: next,
          durationSec: Number.isFinite(tier) && tier > 0 ? tier : shot.duration_sec,
        });
      } catch (e) {
        showAlert(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    next = {
      ...next,
      shots: next.shots.map((s) => {
        const no = String(s.shot_no || '').trim();
        if (!targetNos.has(no)) return s;
        const m = shotModels[no];
        return {
          ...s,
          video_status: 'generating',
          ...(m
            ? { model_params: { ...(s.model_params || {}), video_model: m } }
            : {}),
        };
      }),
    };
    for (const no of targetNos) onMarkVideoGenerating?.(no, true);
    onChange(next);
    const shotNoList = [...targetNos];
    const shotPromptOverrides: Record<string, string> = {};
    for (const s of next.shots) {
      const no = String(s.shot_no || '').trim();
      if (!no || !targetNos.has(no)) continue;
      const raw = String(s.h3_skill_prompt || '').trim();
      const source =
        raw ||
        resolveDramaProductionH3Prompt(next, s, {
          locale,
          durationSec: Number(s.duration_sec) > 0 ? Number(s.duration_sec) : undefined,
        });
      const style = resolveDramaShotVisualStylePrompt(next, s);
      const text = sealDramaProductionCloudPrompt(source, {
        hasDialogue: dramaShotHasSpokenDialogue(s),
        preserveChinese: /[\u4e00-\u9fff]/.test(source),
        storyboardPicIndex: resolveDramaShotStoryboardPictureIndex(next, s),
        styleHint: [
          style.body,
          style.name,
          next.bible?.project?.visual_style,
          next.bible?.project?.color_style,
          source,
        ]
          .filter(Boolean)
          .join(' '),
        session: next,
        shot: s,
      });
      if (text) shotPromptOverrides[no] = text;
    }
    onSpawnVideos?.(
      lipsyncNos.length
        ? {
            shotNos: shotNoList,
            startLipsync: true,
            lipsyncShotNos: lipsyncNos,
            videoModel,
            shotModels,
            ...(Object.keys(shotPromptOverrides).length
              ? { shotPromptOverrides }
              : {}),
          }
        : {
            shotNos: shotNoList,
            videoModel,
            shotModels,
            ...(Object.keys(shotPromptOverrides).length
              ? { shotPromptOverrides }
              : {}),
          },
    );
  };

  const runGenerateShot = (raw: DramaShot) => {
    const no = String(raw.shot_no || '').trim();
    if (!no) return;
    spawnOneShot(no);
  };

  const thumbBox = (extra = '') =>
    `relative overflow-hidden rounded-lg ${
      isDark ? 'bg-black/45 ring-1 ring-white/10' : 'bg-gray-100 ring-1 ring-gray-200'
    } ${extra}`;

  const renderShotCard = (
    raw: DramaShot,
    opts?: {
      fill?: boolean;
      index?: number;
      mountVideo?: boolean;
      mediaActive?: boolean;
      /** 滑动挂载窗内的镜：跳过视口懒挂载，保证一页 3 镜立刻出完整内容 */
      inWindow?: boolean;
    },
  ) => {
    // 勿每帧 enrichDramaShotLocally：会 createEmptyDramaShot 整镜克隆，多卡重渲染即 OOM
    const pending = pendingDurationByShotId[raw.shot_id];
    const s = pending
      ? { ...raw, duration_sec: pending.duration_sec, timeline_events: pending.timeline_events }
      : raw;
    const warn = issues.some((i) => i.shot_id === s.shot_id && i.severity !== 'info');
    const characters = resolveBoardShotCharacters(session, s);
    const lens = formatBoardLensLabel(s);
    const place = beatMetaLabel(session, s);
    const timeline = s.timeline_events?.length ? s.timeline_events : [];
    const nameById = new Map(
      (session.bible.characters || []).map((c) => [c.character_id, c.name] as const),
    );
    for (const c of characters) {
      if (c.character_id) nameById.set(c.character_id, c.name);
    }
    const shotConfirmed = isDramaShotConfirmed(s);
    const fill = !!opts?.fill;
    const shotIndex = Number.isFinite(opts?.index) ? Number(opts?.index) : -1;
    const inWindow = opts?.inWindow === true;
    const mountVideo = opts?.mountVideo ?? inWindow;
    const mediaActive = opts?.mediaActive ?? inWindow;
    const boardVideoForCard = resolveDramaShotBoardVideo(s, pipeline);
    const shotNoForCard = String(s.shot_no || '').trim();
    const shotNoBare = shotNoForCard.replace(/^0+(?=\d)/, '') || shotNoForCard;
    const isVideoGenerating =
      !!videoGeneratingIds?.[shotNoForCard] ||
      !!videoGeneratingIds?.[shotNoBare] ||
      Object.keys(videoGeneratingIds || {}).some((k) => {
        const key = String(k || '').trim();
        if (!key) return false;
        if (key === shotNoForCard || key === shotNoBare) return true;
        const bare = key.replace(/^0+(?=\d)/, '') || key;
        return bare === shotNoBare || key.endsWith(`:${shotNoForCard}`) || key.endsWith(`:${shotNoBare}`);
      }) ||
      s.video_status === 'generating' ||
      s.video_status === 'queued' ||
      boardVideoForCard.videoStatus === 'generating' ||
      boardVideoForCard.videoStatus === 'queued';
    const generating = isVideoGenerating;
    const plan = Number(s.duration_sec) || 0;
    const shotModel = resolveDramaShotVideoModel(s.model_params, session.meta.videoBatchModel, {
      hasDialogue: dramaShotHasSpokenDialogue(s),
      hasShotAudio: !!String(s.audio_url || '').trim(),
    });
    const genDur = resolveDramaShotGenerateDurationSec(plan || 10, shotModel, s.model_params);
    const priceLabel = getShotVideoPriceLabel?.(genDur, {
      model: shotModel,
      preferLipsync: shotModel === 'minimax-h3-audio',
    });

    return (
      <DramaViewportMount
        scrollRoot={shotListScrollEl}
        force={!!fill || s.shot_id === focusShotId || generating}
        minHeightPx={380}
        viewportMarginPx={48}
        shellId={s.shot_id}
        shellIndex={shotIndex >= 0 ? shotIndex : undefined}
        shellClassName={
          warn ? (isDark ? 'ring-1 ring-amber-400/40 rounded-xl' : 'ring-1 ring-amber-300 rounded-xl') : undefined
        }
        placeholder={
          generating ? (
            <div
              className={`${cardCls(isDark)} relative flex h-[10rem] items-center justify-center overflow-hidden`}
            >
              <ModuleProgressBar
                visible
                progress={35}
                solidBackground={isDark ? '#1C1C1E' : '#e5e7eb'}
                progressMessage={`镜头${String(s.shot_no || '').padStart(2, '0')} · 正在生成视频…`}
                borderRadius={8}
              />
            </div>
          ) : (
            <div
              className={`${cardCls(isDark)} flex h-[16rem] flex-col items-center justify-center gap-1 px-3 text-center ${mutedCls(isDark)}`}
            >
              <div className="text-[15px] font-medium tabular-nums text-sky-300/90">
                镜头{String(s.shot_no || '').padStart(2, '0')}
              </div>
              <div className="max-w-md truncate text-[13px]">{place || lens || '滚入视口后加载'}</div>
              <div className="text-[12px] opacity-70">仅屏幕内加载图/文/视频 · 滚出即卸载</div>
            </div>
          )
        }
      >
        {() => (
          <article
            key={s.shot_id}
            className={`${cardCls(isDark)} overflow-hidden ${
              fill ? 'flex min-h-0 flex-1 flex-col' : ''
            }`}
          >
        <div
          className={`flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-b px-2.5 py-1 ${
            isDark ? 'border-white/10 bg-white/[0.03]' : 'border-gray-100 bg-gray-50/80'
          }`}
        >
          <label
            className="nodrag inline-flex items-center"
            title="勾选后可与其它镜头合并（去重参考图 + LLM 整合提示词）"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-white/30 bg-transparent accent-sky-500"
              checked={!!selectedShotIds[s.shot_id]}
              disabled={busy || mergingShots || generating}
              onChange={() => toggleShotSelected(s.shot_id)}
            />
          </label>
          <div className="text-[15px] font-semibold tabular-nums">
            镜头{String(s.shot_no || '').padStart(2, '0')}
          </div>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className={`nodrag inline-flex h-6 w-6 items-center justify-center rounded-md ${
                isDark
                  ? 'text-white/55 hover:bg-white/10 hover:text-white'
                  : 'text-gray-500 hover:bg-gray-200 hover:text-gray-900'
              }`}
              title="在上方插入空镜头"
              disabled={busy || generating}
              onClick={(e) => {
                e.stopPropagation();
                handleInsertShotAt(Math.max(0, shotIndex));
              }}
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={`nodrag inline-flex h-6 w-6 items-center justify-center rounded-md ${
                isDark
                  ? 'text-white/55 hover:bg-white/10 hover:text-white'
                  : 'text-gray-500 hover:bg-gray-200 hover:text-gray-900'
              }`}
              title="在下方插入空镜头"
              disabled={busy || generating}
              onClick={(e) => {
                e.stopPropagation();
                handleInsertShotAt(Math.max(0, shotIndex) + 1);
              }}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={`nodrag inline-flex h-6 w-6 items-center justify-center rounded-md ${
                isDark
                  ? 'text-white/55 hover:bg-rose-500/20 hover:text-rose-300'
                  : 'text-gray-500 hover:bg-rose-50 hover:text-rose-600'
              }`}
              title="删除此镜头"
              disabled={busy || generating || shots.length <= 1}
              onClick={(e) => {
                e.stopPropagation();
                void handleDeleteShotAt(Math.max(0, shotIndex));
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          {(() => {
            const sug = (getActiveEpisodeBible(session).shot_suggestions || []).find(
              (x) => String(x.shot || '').trim() === String(s.shot_no || '').trim(),
            );
            if (!sug) return null;
            const lo = Number(sug.duration_min);
            const hi = Number(sug.duration_max);
            const ai = Number(sug.duration_ai || sug.duration_sec);
            const hasBand = lo > 0 && hi > lo;
            if (!hasBand && !(ai > 0)) return null;
            return (
              <div
                className={`max-w-[11rem] truncate rounded-full px-2 py-0.5 text-[11px] tabular-nums ${
                  isDark ? 'bg-white/8 text-white/65' : 'bg-gray-100 text-gray-600'
                }`}
                title={sug.duration_why || '分镜脚本规划时长（小数秒；出片仍用右侧时长档）'}
              >
                规划{Number(sug.duration_sec) > 0 ? Number(sug.duration_sec).toFixed(1) : ai.toFixed(1)}s
                {hasBand ? ` · ${lo.toFixed(1)}–${hi.toFixed(1)}` : ''}
              </div>
            );
          })()}
          {shotConfirmed ? (
            <div className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[13px] text-emerald-200">
              已确认本镜
            </div>
          ) : null}
          {(() => {
            const skillPrompt = String(s.h3_skill_prompt || '').trim();
            const compiledPrompt = String(s.last_compiled_prompt || '').trim();
            const sealed = dramaShotSkillMatchesLocale(s, locale) && !!skillPrompt;
            const showPrompt = sealed ? skillPrompt : compiledPrompt;
            if (!showPrompt) return null;
            return (
              <H3PromptHoverBadge
                prompt={showPrompt}
                isDark={isDark}
                label={sealed ? (locale === 'en' ? 'Skill' : '优化稿') : 'H3'}
                title={
                  sealed
                    ? locale === 'en'
                      ? 'Hover to view MiniMax H3 Skill final prompt'
                      : '悬停查看 MiniMax H3 Skill 最终提示词'
                    : locale === 'en'
                      ? 'Hover to view compiled prompt'
                      : '悬停查看本镜编译提示词'
                }
                heading={
                  sealed
                    ? locale === 'en'
                      ? 'MiniMax H3 Skill final prompt'
                      : 'MiniMax H3 Skill 最终提示词'
                    : locale === 'en'
                      ? 'Compiled prompt'
                      : '本镜编译提示词'
                }
              />
            );
          })()}
          {place ? (
            <div className={`max-w-[12rem] truncate text-[13px] ${mutedCls(isDark)}`}>{place}</div>
          ) : null}
          <div
            className={`max-w-[14rem] truncate text-[13px] ${
              isDark ? 'text-white/75' : 'text-gray-700'
            }`}
          >
            {lens}
          </div>
        </div>

        <div
          className={`grid min-h-0 items-stretch gap-1.5 p-1.5 lg:grid-cols-[minmax(22rem,1fr)_minmax(0,1.45fr)_minmax(12rem,0.72fr)] ${
            fill ? 'flex-1 overflow-hidden' : ''
          }`}
        >
          <div className={fill ? 'min-h-0 overflow-hidden' : 'min-w-0'}>
            <DramaShotRefZones
              session={session}
              shot={s}
              isDark={isDark}
              busy={busy}
              thumbBox={thumbBox}
              mediaActive={mediaActive}
              onPatchShot={patchShotById}
              onSessionChange={onChange}
              onGenerateShotAudio={onGenerateShotAudio}
              onAbandonShotAudio={onAbandonShotAudio}
              unitVoicePriceLabel={unitVoicePriceLabel}
              showAlert={showAlert}
            />
          </div>

          <div className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden">
            <DramaShotPromptCardSurface
              session={session}
              shot={s}
              isDark={isDark}
              busy={busy}
              timeline={timeline}
              nameById={nameById}
              runChat={runChat}
              showAlert={showAlert}
              unitChatPriceLabel={unitChatPriceLabel}
              unitImagePriceLabel={unitImagePriceLabel}
              storyboardImageGenSlot={storyboardImageGenSlot}
              storyboardImageUrl={
                String(
                  getDirectorShotStoryboard(pipeline, shotNoForCard).imageUrl ||
                    s.storyboard_image_url ||
                    '',
                ).trim() || null
              }
              storyboardGenerating={
                getDirectorShotStoryboard(pipeline, shotNoForCard).status === 'generating'
              }
              onGenerateShotStoryboard={onGenerateShotStoryboard}
              onPatchShot={(patch) => patchShotById(s.shot_id, patch)}
              onPatchTimeline={(nextEvents) => {
                const nextShot = ensureDramaShotTimelineEvents({
                  ...s,
                  timeline_events: nextEvents,
                }, session, { preserveTiming: true });
                patchShotById(s.shot_id, {
                  timeline_events: nextShot.timeline_events,
                  timeline_beats: nextShot.timeline_beats,
                  audio_timeline: deriveDramaAudioTimelineFromShotEvents(
                    session,
                    nextShot.timeline_events,
                  ),
                  // 保留已优化中文稿（图二），改彩条不冲掉
                });
              }}
              skillPromptActionSlot={
                <DramaYuanbaoHoverWrap
                  tipBelow
                  className="shrink-0"
                  priceLabel={
                    !dramaShotSkillMatchesLocale(s, locale) &&
                    skillOptimizingShotId !== s.shot_id &&
                    !generating
                      ? unitChatPriceLabel
                      : null
                  }
                >
                  <button
                    type="button"
                    className={`nodrag rounded-md px-2.5 py-1.5 text-[13px] font-medium ${
                      isDark
                        ? dramaShotSkillMatchesLocale(s, locale)
                          ? 'bg-emerald-500/25 text-emerald-100 ring-1 ring-emerald-400/40'
                          : 'bg-violet-500/80 text-white hover:bg-violet-500'
                        : dramaShotSkillMatchesLocale(s, locale)
                          ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-300'
                          : 'bg-violet-600 text-white hover:bg-violet-700'
                    }`}
                    title={
                      dramaShotSkillMatchesLocale(s, locale)
                        ? locale === 'en'
                          ? 'View MiniMax H3 Skill final prompt (sent to API)'
                          : '查看 MiniMax H3 Skill 最终提示词（发往 API）'
                        : locale === 'en'
                          ? 'Optimize with MiniMax H3 Skill (same as canvas video node)'
                          : '用 MiniMax H3 Skill 优化（与画布视频节点同一套）'
                    }
                    disabled={generating || skillOptimizingShotId === s.shot_id || !!busy}
                    onClick={() => {
                      if (dramaShotSkillMatchesLocale(s, locale)) {
                        setSkillPromptViewShotId(s.shot_id);
                        return;
                      }
                      void optimizeShotWithH3Skill(s.shot_id, {
                        force: isDramaShotH3SkillSealed(s),
                      }).catch(() => undefined);
                    }}
                  >
                    {skillOptimizingShotId === s.shot_id
                      ? locale === 'en'
                        ? 'Optimizing…'
                        : '优化中…'
                      : dramaShotSkillMatchesLocale(s, locale)
                        ? locale === 'en'
                          ? 'View Skill prompt'
                          : '查看优化稿'
                        : locale === 'en'
                          ? 'Optimize prompt'
                          : '提示词优化'}
                  </button>
                </DramaYuanbaoHoverWrap>
              }
            />
          </div>

          <div className="flex h-full min-h-0 min-w-0 flex-col gap-1.5">
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <DramaShotVideoSlot
                shot={s}
                session={session}
                pipeline={pipeline}
                isDark={isDark}
                busy={busy}
                canGenerate
                onSpawn={spawnOneShot}
                onModelChange={setShotVideoModel}
                onDurationChange={handleShotVideoDurationChange}
                onAbandonWait={onAbandonVideoWait}
                onSelectVideo={applyShotVideo}
                priceLabel={priceLabel}
                forceGenerating={generating}
                progressMessage="正在生成视频..."
                hideGenerate={variant === 'board'}
                mountVideo={mountVideo}
              />
            </div>
            {variant === 'board' ? (
              <div className="relative z-30 flex shrink-0 flex-wrap items-stretch gap-1.5 pointer-events-auto">
                {generating ? (
                  <button
                    type="button"
                    className={`nodrag nopan relative z-30 min-w-0 flex-1 cursor-pointer rounded-lg px-2 py-1.5 text-[13px] font-medium pointer-events-auto ${
                      isDark
                        ? 'bg-white/20 text-white ring-1 ring-white/35 hover:bg-white/30'
                        : 'bg-gray-200 text-gray-900 hover:bg-gray-300'
                    }`}
                    title="仅取消本地等待与绿条；已发出的任务无法撤回，费用不退"
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const no = String(s.shot_no || '').trim();
                      if (!no) return;
                      onAbandonVideoWait?.(no);
                    }}
                  >
                    放弃等待
                  </button>
                ) : null}
                <DramaYuanbaoHoverWrap
                  tipBelow
                  className="min-w-0 flex-1"
                  priceLabel={!generating ? priceLabel : null}
                >
                  <button
                    type="button"
                    className={`nodrag w-full rounded-lg px-2 py-1.5 text-[13px] font-medium disabled:opacity-45 ${
                      isDark
                        ? 'bg-sky-500/85 text-white hover:bg-sky-500'
                        : 'bg-gray-900 text-white'
                    }`}
                    disabled={generating || skillOptimizingShotId === s.shot_id}
                    title={
                      generating
                        ? '处理中'
                        : isDramaShotH3SkillSealed(s)
                          ? `用本镜 Skill 优化稿按 ${genDur}s 出片`
                          : `将先自动 Skill 优化提示词，再按 ${genDur}s 出片`
                    }
                    onClick={() => runGenerateShot(raw)}
                  >
                    {generating
                      ? '生成中…'
                      : formatDramaVideoGenButtonLabel({
                          hasVideo: !!s.video_url,
                          durationSec: genDur,
                        })}
                  </button>
                </DramaYuanbaoHoverWrap>
              </div>
            ) : null}
          </div>
        </div>
      </article>
        )}
      </DramaViewportMount>
    );
  };

  const skillViewShot = skillPromptViewShotId
    ? shots.find((x) => x.shot_id === skillPromptViewShotId) || null
    : null;
  const skillViewSession = {
    ...sessionRef.current,
    shots: sessionRef.current.shots.map(mergePendingDuration),
  };
  const skillViewSource = skillViewShot
    ? String(skillViewShot.h3_skill_prompt || '').trim() ||
      resolveDramaProductionH3Prompt(skillViewSession, skillViewShot, {
        locale,
        durationSec:
          Number(skillViewShot.duration_sec) > 0
            ? Number(skillViewShot.duration_sec)
            : undefined,
      })
    : '';
  const skillViewText = skillViewShot
    ? (() => {
        const style = resolveDramaShotVisualStylePrompt(skillViewSession, skillViewShot);
        return sealDramaProductionCloudPrompt(skillViewSource, {
          hasDialogue: dramaShotHasSpokenDialogue(skillViewShot),
          preserveChinese: /[\u4e00-\u9fff]/.test(skillViewSource),
          storyboardPicIndex: resolveDramaShotStoryboardPictureIndex(
            skillViewSession,
            skillViewShot,
          ),
          styleHint: [
            style.body,
            style.name,
            skillViewSession.bible?.project?.visual_style,
            skillViewSession.bible?.project?.color_style,
            skillViewSource,
          ]
            .filter(Boolean)
            .join(' '),
          session: skillViewSession,
          shot: skillViewShot,
        });
      })()
    : '';
  const skillPromptViewPortal =
    skillViewShot && skillViewText && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="fixed inset-0 z-[100130] flex items-center justify-center p-3"
            onClick={() => setSkillPromptViewShotId('')}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div
              className={`flex h-[min(88vh,52rem)] w-[min(72rem,96vw)] flex-col overflow-hidden rounded-2xl border shadow-2xl ${
                isDark
                  ? 'border-white/12 bg-[#16161a] text-white'
                  : 'border-gray-200 bg-white text-gray-900'
              }`}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div
                className={`flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2.5 ${
                  isDark ? 'border-white/10' : 'border-gray-100'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold">
                    {locale === 'en'
                      ? `Shot ${String(skillViewShot.shot_no || '').padStart(2, '0')} · MiniMax H3 Skill final prompt`
                      : `镜头${String(skillViewShot.shot_no || '').padStart(2, '0')} · MiniMax H3 Skill 最终提示词`}
                  </div>
                  <div className={`truncate text-[12px] ${mutedCls(isDark)}`}>
                    {locale === 'en'
                      ? 'Same Skill as canvas video node — exact text sent to the API'
                      : '与画布视频节点同一 Skill，即发往视频 API 的最终提示词'}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <DramaYuanbaoHoverWrap
                    tipBelow
                    priceLabel={
                      skillOptimizingShotId !== skillViewShot.shot_id
                        ? unitChatPriceLabel
                        : null
                    }
                  >
                    <button
                      type="button"
                      className={`nodrag rounded-lg px-2.5 py-1 text-[12px] font-medium ${
                        isDark
                          ? 'bg-violet-500/80 text-white hover:bg-violet-500'
                          : 'bg-violet-600 text-white hover:bg-violet-700'
                      }`}
                      disabled={skillOptimizingShotId === skillViewShot.shot_id}
                      onClick={() => {
                        setSkillPromptViewShotId('');
                        void optimizeShotWithH3Skill(skillViewShot.shot_id, { force: true }).catch(
                          () => undefined,
                        );
                      }}
                    >
                      {locale === 'en' ? 'Re-optimize' : '重新优化'}
                    </button>
                  </DramaYuanbaoHoverWrap>
                  <button
                    type="button"
                    className={`nodrag rounded-lg px-2.5 py-1 text-[12px] font-medium ${
                      isDark
                        ? 'bg-white/10 text-white hover:bg-white/15'
                        : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                    }`}
                    onClick={() => {
                      void navigator.clipboard?.writeText(skillViewText).then(
                        () =>
                          showAlert?.(
                            locale === 'en' ? 'Final API prompt copied' : '已复制上云最终提示词',
                          ),
                        () => showAlert?.(locale === 'en' ? 'Copy failed' : '复制失败'),
                      );
                    }}
                  >
                    {locale === 'en' ? 'Copy all' : '复制全文'}
                  </button>
                  <button
                    type="button"
                    className={`nodrag flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[18px] ${
                      isDark ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                    }`}
                    onClick={() => setSkillPromptViewShotId('')}
                  >
                    ×
                  </button>
                </div>
              </div>
              <pre
                className={`min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-4 py-3 text-[13px] leading-relaxed custom-scrollbar-dark ${
                  isDark ? 'text-white/85' : 'text-gray-800'
                }`}
              >
                {skillViewText}
              </pre>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      {skillPromptViewPortal}
      {/* 操作栏（分镜页不展示整片风格长 Prompt） */}
      <div className={`${cardCls(isDark)} shrink-0 p-3 flex flex-wrap items-center gap-2`}>
          <label
            className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[15px] ${
              isDark ? 'bg-white/8' : 'bg-gray-50'
            }`}
            title="成片画幅比例（写入本集并用于批量出片）"
          >
            <span className={mutedCls(isDark)}>比例</span>
            <select
              className={darkSelectCls('text-[15px]')}
              value={aspectRatio}
              disabled={busy}
              onChange={(e) => setAspectRatio(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            >
              <option value="9:16" className="bg-[#1c1c1e] text-white">
                9:16 竖屏
              </option>
              <option value="16:9" className="bg-[#1c1c1e] text-white">
                16:9 横屏
              </option>
              <option value="3:4" className="bg-[#1c1c1e] text-white">
                3:4
              </option>
              <option value="4:3" className="bg-[#1c1c1e] text-white">
                4:3
              </option>
            </select>
          </label>
          <label
            className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[15px] ${
              isDark ? 'bg-white/8' : 'bg-gray-50'
            }`}
            title="默认视频模型（仅已接入短剧 Adapter 的模型；单镜可再覆盖）"
          >
            <span className={mutedCls(isDark)}>默认模型</span>
            <select
              className={darkSelectCls('text-[15px]')}
              value={videoModel}
              disabled={busy}
              onChange={(e) => setDefaultVideoModel(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            >
              {listDramaSupportedVideoModels().map((m) => (
                <option
                  key={m.id}
                  value={m.id}
                  title={m.title}
                  className="bg-[#1c1c1e] text-white"
                >
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[15px] ${
              isDark ? 'bg-white/8' : 'bg-gray-50'
            }`}
            title="出片清晰度（MiniMax-H3：480P / 720P；口型与全能共用）"
          >
            <span className={mutedCls(isDark)}>清晰度</span>
            <select
              className={darkSelectCls('text-[15px]')}
              value={videoResolution}
              disabled={busy}
              onChange={(e) => setVideoResolution(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            >
              {videoResolutionOptions.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-[#1c1c1e] text-white">
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          {variant === 'videos' ? null : (
            <>
          <DramaYuanbaoHoverWrap priceLabel={unitChatPriceLabel} tipBelow>
            <button
              type="button"
              disabled={
                mergingShots || busy || selectedShotCount < 2
              }
              className={`nodrag rounded-lg px-3 py-2 text-[16px] font-medium disabled:opacity-45 ${
                isDark ? 'bg-amber-500/85 text-white' : 'bg-amber-600 text-white'
              }`}
              title="勾选至少 2 镜：去重参考图、拼接时间轴，并由大模型整合切段"
              onClick={() => void handleMergeSelectedShots()}
            >
              {mergingShots
                ? mergeProgress || '合并镜头中…'
                : selectedShotCount >= 2
                  ? `合并所选 ${selectedShotCount} 镜`
                  : '合并所选镜头'}
            </button>
          </DramaYuanbaoHoverWrap>
          {selectedShotCount > 0 ? (
            <button
              type="button"
              className={`nodrag rounded-lg px-2.5 py-2 text-[14px] ${
                isDark ? 'bg-white/10' : 'bg-gray-100'
              }`}
              disabled={mergingShots || busy}
              onClick={clearShotSelection}
            >
              取消勾选 ({selectedShotCount})
            </button>
          ) : null}
          <DramaYuanbaoHoverWrap
            priceLabel={pendingVideoShots.length ? pendingBatchPriceLabel : null}
            tipBelow
          >
            <button
              type="button"
              disabled={busy || !pendingVideoShots.length}
              className={`nodrag rounded-lg px-3 py-2 text-[16px] font-medium disabled:opacity-45 ${
                isDark ? 'bg-sky-500/80 text-white' : 'bg-gray-900 text-white'
              }`}
              title={
                pendingVideoShots.length
                  ? '只生成尚未出片或失败的镜头，已有成片的不重跑'
                  : '没有待生成镜头'
              }
              onClick={() => spawnAllShots('missing')}
            >
              {pendingVideoShots.length
                ? `生成未出片 ${pendingVideoShots.length} 镜`
                : '未出片已齐'}
            </button>
          </DramaYuanbaoHoverWrap>
          {busyVideoCount > 0 ? (
            <button
              type="button"
              className={`nodrag nopan cursor-pointer rounded-lg px-3 py-2 text-[16px] font-medium ${
                isDark
                  ? 'bg-white/20 text-white ring-1 ring-white/30 hover:bg-white/28'
                  : 'bg-gray-200 text-gray-900 hover:bg-gray-300'
              }`}
              title="仅取消本地等待与绿条；已发出的任务无法撤回，费用不退"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                abandonAllVideoWaits();
              }}
            >
              全部放弃等待 {busyVideoCount} 镜
            </button>
          ) : null}
          <DramaYuanbaoHoverWrap
            priceLabel={allRerunVideoShots.length ? allRerunBatchPriceLabel : null}
            tipBelow
          >
            <button
              type="button"
              disabled={busy || !shots.length}
              className={`nodrag rounded-lg px-3 py-2 text-[16px] disabled:opacity-45 ${
                isDark ? 'bg-white/10' : 'bg-gray-100'
              }`}
              title="包括已有成片的镜头，会重新扣费生成"
              onClick={() => spawnAllShots('all')}
            >
              全部重跑
            </button>
          </DramaYuanbaoHoverWrap>
          <button
            type="button"
            disabled={!shots.length}
            className={`nodrag rounded-lg px-3 py-2 text-[16px] font-medium disabled:opacity-45 ${
              isDark ? 'bg-emerald-500/80 text-white' : 'bg-gray-900 text-white'
            }`}
            onClick={onNext}
          >
            进入成片
          </button>
          <div className={`text-[15px] ${mutedCls(isDark)}`}>
            {shots.length} 镜 · 已出片 {readyVideoCount}
            {busyVideoCount ? ` · 生成中 ${busyVideoCount}` : ''}
            {pendingVideoShots.length ? ` · 待生成 ${pendingVideoShots.length}` : ''}
          </div>
          {missingDesign.length > 0 ? (
            <div className={`text-[15px] ${mutedCls(isDark)}`}>
              {missingDesign.length} 人尚无参考图 → 请返回「素材准备」补齐
            </div>
          ) : null}
            </>
          )}
      </div>

      {variant === 'board' && shots.length > 1 ? (
        <div
          className={`nodrag nowheel z-10 flex shrink-0 gap-1 overflow-x-auto custom-scrollbar-dark pb-1 pt-0.5 ${
            isDark ? 'bg-[#111113]/95' : 'bg-white/95'
          }`}
        >
          {shots.map((raw) => {
            const no = String(raw.shot_no || '').padStart(2, '0');
            const on = raw.shot_id === focusShotId;
            const ok = isDramaShotConfirmed(raw);
            return (
              <button
                key={raw.shot_id}
                type="button"
                className={`nodrag nopan shrink-0 rounded-lg px-2.5 py-1 text-[13px] tabular-nums ${
                  on
                    ? isDark
                      ? 'bg-sky-500/80 text-white'
                      : 'bg-gray-900 text-white'
                    : isDark
                      ? 'bg-white/8 text-white/75 hover:bg-white/12'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setFocusShotId(raw.shot_id);
                  setActiveEventId('');
                  scrollToDramaShot(raw.shot_id);
                }}
              >
                镜头{no}
                {ok ? ' √' : ''}
              </button>
            );
          })}
        </div>
      ) : null}

      <div
        ref={bindShotListScrollRef}
        className="nodrag nowheel flex min-h-0 flex-1 flex-col gap-2 overflow-auto custom-scrollbar-dark pr-0.5"
      >
        {!shots.length ? (
          <div className={`${cardCls(isDark)} flex min-h-[12rem] flex-col items-center justify-center gap-3 text-[18px] ${mutedCls(isDark)}`}>
            <div>暂无镜头，请先在「剧本」确认分析并完成「素材准备」，再回到本步补全导演表</div>
            <button
              type="button"
              className={`nodrag inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[13px] font-medium ${
                isDark ? 'bg-sky-500/80 text-white' : 'bg-gray-900 text-white'
              }`}
              disabled={busy}
              onClick={() => handleInsertShotAt(0)}
            >
              <Plus className="h-4 w-4" />
              手动添加空镜头
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              {shots.map((raw, index) => (
                <React.Fragment key={raw.shot_id}>
                  {index > 0 ? (
                    <button
                      type="button"
                      className={`nodrag mx-auto my-0.5 flex h-7 w-full max-w-md items-center justify-center gap-1 rounded-lg border border-dashed text-[12px] ${
                        isDark
                          ? 'border-white/15 text-white/55 hover:border-sky-400/50 hover:bg-sky-500/10 hover:text-sky-200'
                          : 'border-gray-300 text-gray-500 hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700'
                      }`}
                      disabled={busy}
                      onClick={() => handleInsertShotAt(index)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      在镜头{String(raw.shot_no || '').padStart(2, '0')}上方插入
                    </button>
                  ) : null}
                  {renderShotCard(raw, {
                    index,
                    // 视口内短暂解首帧后卸 video；滚出由 DramaViewportMount 整卡卸载
                    mountVideo: true,
                    mediaActive: true,
                  })}
                  <button
                    type="button"
                    className={`nodrag mx-auto my-0.5 flex h-7 w-full max-w-md items-center justify-center gap-1 rounded-lg border border-dashed text-[12px] ${
                      isDark
                        ? 'border-white/15 text-white/55 hover:border-sky-400/50 hover:bg-sky-500/10 hover:text-sky-200'
                        : 'border-gray-300 text-gray-500 hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700'
                    }`}
                    disabled={busy}
                    onClick={() => handleInsertShotAt(index + 1)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    在镜头{String(raw.shot_no || '').padStart(2, '0')}下方插入
                  </button>
                </React.Fragment>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function dramaAspectRatioParts(ratio?: string): { w: number; h: number; css: string; label: string } {
  const r = String(ratio || '').trim();
  if (r === '16:9') return { w: 16, h: 9, css: '16 / 9', label: '16:9' };
  if (r === '4:3') return { w: 4, h: 3, css: '4 / 3', label: '4:3' };
  if (r === '3:4') return { w: 3, h: 4, css: '3 / 4', label: '3:4' };
  return { w: 9, h: 16, css: '9 / 16', label: '9:16' };
}

function dramaFinalCutAspectBoxClass(ratio?: string): string {
  const r = dramaAspectRatioParts(ratio).label;
  if (r === '16:9') return 'aspect-[16/9]';
  if (r === '4:3') return 'aspect-[4/3]';
  if (r === '3:4') return 'aspect-[3/4]';
  return 'aspect-[9/16]';
}

/** 内联 aspect-ratio，避免任意值 class 未进 CSS 包时失效 */
function dramaAspectRatioStyle(ratio?: string): React.CSSProperties {
  return { aspectRatio: dramaAspectRatioParts(ratio).css };
}

/**
 * 在父盒内按比例 letterbox：只钉住长边，另一边由 aspect-ratio 算出，避免双 min+cq 把框撑满后竖片两侧留黑。
 */
function dramaAspectFitStyle(ratio?: string): React.CSSProperties {
  const { w, h, css } = dramaAspectRatioParts(ratio);
  const portrait = h >= w;
  return {
    aspectRatio: css,
    maxWidth: '100%',
    maxHeight: '100%',
    ...(portrait
      ? { height: '100%', width: 'auto' }
      : { width: '100%', height: 'auto' }),
  };
}

/** 按媒体真实宽高比适配预览框（有成片时跟随画面，不再硬套会话 16:9） */
function dramaAspectFitStyleFromCss(aspectCss: string): React.CSSProperties {
  const parts = String(aspectCss || '')
    .split('/')
    .map((x) => Number(String(x).trim()));
  const w = parts[0];
  const h = parts[1];
  if (!(w > 0 && h > 0)) return dramaAspectFitStyle('9:16');
  const portrait = h >= w;
  return {
    aspectRatio: `${w} / ${h}`,
    maxWidth: '100%',
    maxHeight: '100%',
    ...(portrait
      ? { height: '100%', width: 'auto' }
      : { width: '100%', height: 'auto' }),
  };
}

function dramaAspectLabelFromCss(aspectCss: string | null | undefined, fallback: string): string {
  const parts = String(aspectCss || '')
    .split('/')
    .map((x) => Number(String(x).trim()));
  const w = parts[0];
  const h = parts[1];
  if (!(w > 0 && h > 0)) return fallback;
  const r = w / h;
  const candidates: Array<{ id: string; v: number }> = [
    { id: '16:9', v: 16 / 9 },
    { id: '4:3', v: 4 / 3 },
    { id: '3:4', v: 3 / 4 },
    { id: '9:16', v: 9 / 16 },
  ];
  let best = candidates[0];
  let bestD = Math.abs(r - best.v);
  for (const c of candidates) {
    const d = Math.abs(r - c.v);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best.id;
}

function dramaAspectIsPortrait(ratio?: string): boolean {
  const r = dramaAspectRatioParts(ratio).label;
  return r === '9:16' || r === '3:4';
}

function DramaVideoLightbox({
  url,
  name,
  isDark,
  onClose,
}: {
  url: string;
  name?: string;
  isDark: boolean;
  onClose: () => void;
}) {
  const playable = toElectronVideoElementSrc(url) || toDisplayableDramaMediaUrl(url) || url;
  if (!playable || typeof document === 'undefined') return null;
  return createPortal(
    <div
      className={`fixed inset-0 z-[100002] flex items-center justify-center p-6 ${
        isDark ? 'bg-black/80' : 'bg-black/50'
      }`}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className={`relative flex max-h-[min(90vh,900px)] w-full max-w-[min(92vw,1100px)] flex-col overflow-hidden rounded-2xl shadow-2xl ring-1 ${
          isDark ? 'bg-zinc-900 ring-white/15' : 'bg-gray-100 ring-gray-200'
        }`}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
          <div
            className={`truncate text-base font-semibold ${
              isDark ? 'text-white' : 'text-gray-900'
            }`}
          >
            {name || '视频预览'}
          </div>
          <button
            type="button"
            className={`nodrag shrink-0 rounded-lg p-1.5 ${
              isDark ? 'text-white/60 hover:bg-white/10' : 'text-gray-500 hover:bg-gray-100'
            }`}
            title="关闭"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-4 pb-4">
          <video
            key={playable}
            src={playable}
            className="nodrag max-h-[min(78vh,780px)] max-w-full rounded-lg bg-black"
            controls
            playsInline
            preload="auto"
            onLoadedData={(e) => {
              void e.currentTarget.play().catch(() => undefined);
            }}
            onPointerDown={(e) => e.stopPropagation()}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function reorderDramaFinalCutShots(
  session: DramaDirectorSession,
  fromId: string,
  toId: string,
): DramaDirectorSession {
  if (!fromId || !toId || fromId === toId) return session;
  const shots = [...(session.shots || [])];
  const from = shots.findIndex((s) => s.shot_id === fromId);
  const to = shots.findIndex((s) => s.shot_id === toId);
  if (from < 0 || to < 0 || from === to) return session;
  const [moved] = shots.splice(from, 1);
  shots.splice(to, 0, moved);
  return { ...session, shots };
}

function DramaFinalCutShotCard({
  shot,
  index,
  isDark,
  aspectBoxClass,
  aspectStyle,
  posterHint,
  videoVersions = [],
  selected,
  dragging,
  dropTarget,
  hoverDisabled,
  onSelectCard,
  onSelectVideo,
  onDragStartShot,
  onDragEndShot,
  onDragOverShot,
  onDropShot,
}: {
  shot: DramaShot;
  index: number;
  isDark: boolean;
  aspectBoxClass: string;
  aspectStyle: React.CSSProperties;
  /** 分镜图 / 其它静帧封面 */
  posterHint?: string;
  videoVersions?: string[];
  selected?: boolean;
  dragging: boolean;
  dropTarget: boolean;
  hoverDisabled: boolean;
  onSelectCard?: (shotId: string) => void;
  onSelectVideo?: (shotNo: string, videoUrl: string) => void;
  onDragStartShot: (shotId: string, e: React.DragEvent) => void;
  onDragEndShot: () => void;
  onDragOverShot: (shotId: string, e: React.DragEvent) => void;
  onDropShot: (shotId: string, e: React.DragEvent) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hoverActiveRef = useRef(false);
  const stillAttemptedRef = useRef(false);
  const [hoverActive, setHoverActive] = useState(false);
  const [inView, setInView] = useState(false);
  const [stillShot, setStillShot] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const url = String(shot.video_url || '').trim();
  const playable = url ? toElectronVideoElementSrc(url) || url : '';
  const poster = toDisplayableDramaMediaUrl(
    String(posterHint || shot.storyboard_image_url || '').trim(),
  );
  const cover = stillShot || poster;
  const no = String(shot.shot_no || '').trim() || '?';
  const needStill = !!playable && !poster && !stillShot;

  useEffect(() => {
    hoverActiveRef.current = false;
    stillAttemptedRef.current = false;
    setHoverActive(false);
    setStillShot('');
    setCapturing(false);
  }, [playable, poster]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((e) => e.isIntersecting);
        setInView(hit);
      },
      { root: null, rootMargin: '80px', threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const stopHoverPlay = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.muted = true;
    try {
      v.removeAttribute('src');
      v.load();
    } catch {
      /* ignore */
    }
  };

  // 仅悬停挂载并播放；离开卸载，网格不再常驻多路 <video>
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !playable || !hoverActive) return;
    v.muted = false;
    v.volume = 1;
    try {
      if (v.currentTime > 0.08) v.currentTime = 0;
    } catch {
      /* ignore */
    }
    void v.play().catch(() => {
      v.muted = true;
      void v.play().catch(() => undefined);
    });
  }, [hoverActive, playable]);

  // 有成片、无封面：进入视口后抓一帧静帧，未悬停也显示缩略图
  useEffect(() => {
    if (!needStill || !inView || hoverActive || stillAttemptedRef.current) return;
    stillAttemptedRef.current = true;
    setCapturing(true);
    let cancelled = false;
    let cleanupKick: (() => void) | undefined;
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = playable;
    const finish = (still?: string) => {
      if (cancelled) return;
      const urlStill = String(still || '').trim();
      if (urlStill) setStillShot(urlStill);
      setCapturing(false);
      try {
        v.pause();
        v.removeAttribute('src');
        v.load();
      } catch {
        /* ignore */
      }
    };
    cleanupKick = dramaKickVideoStillFrame(v, () => hoverActiveRef.current, finish);
    return () => {
      cancelled = true;
      cleanupKick?.();
      try {
        v.pause();
        v.removeAttribute('src');
        v.load();
      } catch {
        /* ignore */
      }
    };
  }, [needStill, inView, hoverActive, playable]);

  useEffect(() => {
    return () => {
      const v = videoRef.current;
      if (!v) return;
      v.pause();
      v.muted = true;
      try {
        v.removeAttribute('src');
        v.load();
      } catch {
        /* ignore */
      }
    };
  }, [playable]);

  return (
    <div
      ref={rootRef}
      draggable
      className={`nodrag nowheel relative min-w-0 overflow-hidden cursor-grab active:cursor-grabbing ${cardCls(isDark)} ${
        dragging ? 'opacity-50' : ''
      } ${dropTarget ? 'ring-2 ring-sky-400/80' : ''} ${
        selected ? 'ring-2 ring-emerald-400/80' : ''
      }`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        if ((e.target as HTMLElement | null)?.closest?.('a, button, [data-no-card-drag]')) return;
        onSelectCard?.(shot.shot_id);
      }}
      onDragStart={(e) => {
        stopHoverPlay();
        setHoverActive(false);
        onDragStartShot(shot.shot_id, e);
      }}
      onDragEnd={onDragEndShot}
      onDragOver={(e) => onDragOverShot(shot.shot_id, e)}
      onDrop={(e) => onDropShot(shot.shot_id, e)}
      onMouseEnter={() => {
        if (hoverDisabled || dragging || !playable) return;
        hoverActiveRef.current = true;
        setHoverActive(true);
      }}
      onMouseLeave={() => {
        hoverActiveRef.current = false;
        stopHoverPlay();
        setHoverActive(false);
      }}
    >
      {playable && hoverActive ? (
        <div className={`relative w-full overflow-hidden bg-black ${aspectBoxClass}`} style={aspectStyle}>
          <video
            ref={videoRef}
            key={playable}
            src={playable}
            poster={cover || undefined}
            className="drama-shot-video-el absolute inset-0 h-full w-full bg-black object-contain"
            muted={false}
            playsInline
            loop
            preload="auto"
            draggable={false}
          />
        </div>
      ) : cover ? (
        <div className={`relative w-full overflow-hidden bg-black ${aspectBoxClass}`} style={aspectStyle}>
          <img
            src={cover}
            alt=""
            className="absolute inset-0 h-full w-full object-contain"
            draggable={false}
          />
          {playable ? (
            <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white shadow-md">
                <Play className="h-5 w-5 translate-x-0.5" fill="currentColor" />
              </span>
            </div>
          ) : null}
        </div>
      ) : playable ? (
        <div
          className={`relative flex w-full items-center justify-center overflow-hidden text-[12px] ${aspectBoxClass} ${mutedCls(isDark)} ${
            isDark ? 'bg-white/[0.04]' : 'bg-gray-100'
          }`}
          style={aspectStyle}
        >
          {capturing || needStill ? '加载缩略图…' : '悬停预览'}
          <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white shadow-md">
              <Play className="h-5 w-5 translate-x-0.5" fill="currentColor" />
            </span>
          </div>
        </div>
      ) : (
        <div
          className={`flex w-full items-center justify-center overflow-hidden text-[12px] ${aspectBoxClass} ${mutedCls(isDark)} ${
            isDark ? 'bg-white/[0.04]' : 'bg-gray-100'
          }`}
          style={aspectStyle}
        >
          未出片
        </div>
      )}
      {playable ? (
        <button
          type="button"
          data-no-card-drag=""
          className={`nodrag absolute right-1.5 top-1.5 z-[3] rounded-md p-1.5 shadow-md ${
            isDark
              ? 'bg-black/65 text-white hover:bg-black/80'
              : 'bg-white/90 text-gray-800 hover:bg-white'
          }`}
          title="放大观看"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            stopHoverPlay();
            setHoverActive(false);
            setLightboxOpen(true);
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <div className="flex items-center justify-between gap-1 px-2 py-1.5 text-[12px]">
        <span className="font-medium tabular-nums">
          {index + 1}. 镜 {no}
        </span>
        {url ? (
          <a
            className="nodrag text-sky-400"
            href={url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            查看
          </a>
        ) : null}
      </div>
      {selected && videoVersions.length >= 2 && onSelectVideo ? (
        <div className="px-1.5 pb-1.5" data-no-card-drag="">
          <DramaShotVideoVersionPicker
            open
            versions={videoVersions}
            currentUrl={url}
            isDark={isDark}
            onPick={(nextUrl) => {
              const shotNo = String(shot.shot_no || '').trim();
              if (shotNo) onSelectVideo(shotNo, nextUrl);
            }}
          />
        </div>
      ) : videoVersions.length >= 2 ? (
        <div className={`px-2 pb-1.5 text-[11px] ${mutedCls(isDark)}`}>
          点击卡片可切换历史纪录（{videoVersions.length}）
        </div>
      ) : null}
      {lightboxOpen && url ? (
        <DramaVideoLightbox
          url={url}
          name={`镜 ${no}`}
          isDark={isDark}
          onClose={() => setLightboxOpen(false)}
        />
      ) : null}
    </div>
  );
}

function DramaFinalCutPanel({
  session,
  pipeline,
  isDark,
  onChange,
  onVideosToSplice,
}: {
  session: DramaDirectorSession;
  pipeline: DirectorPipelineState;
  isDark: boolean;
  onChange: (
    s: DramaDirectorSession,
    opts?: {
      storyboardsByShotNo?: DirectorPipelineState['storyboardsByShotNo'];
      skipAssetsProjection?: boolean;
    },
  ) => void;
  onVideosToSplice?: () => void;
}) {
  const shots = session.shots || [];
  const ready = shots.filter((s) => String(s.video_url || '').trim());
  const missing = shots.length - ready.length;
  const autoOnce = useRef(false);
  const dragShotId = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const aspectBoxClass = dramaFinalCutAspectBoxClass(session.meta.aspect_ratio);
  const aspectStyle = dramaAspectRatioStyle(session.meta.aspect_ratio);
  const portraitGrid = dramaAspectIsPortrait(session.meta.aspect_ratio);

  useEffect(() => {
    if (autoOnce.current) return;
    if (!ready.length || !onVideosToSplice) return;
    autoOnce.current = true;
    onVideosToSplice();
  }, [ready.length, onVideosToSplice]);

  const applyReorder = (fromId: string, toId: string) => {
    const next = reorderDramaFinalCutShots(session, fromId, toId);
    if (next === session) return;
    onChange(next);
    window.setTimeout(() => onVideosToSplice?.(), 80);
  };

  const selectShotVideo = (shotNo: string, videoUrl: string) => {
    const key = String(shotNo || '').trim();
    const nextUrl = String(videoUrl || '').trim();
    if (!key || !nextUrl) return;
    const nextPipe = updateDirectorShotStoryboard(pipeline, key, {
      videoUrl: nextUrl,
      videoStatus: 'ready',
      videoError: '',
    });
    onChange(
      {
        ...session,
        shots: (session.shots || []).map((s) =>
          String(s.shot_no || '').trim() === key
            ? { ...s, video_url: nextUrl, video_status: 'ready', video_error: '' }
            : s,
        ),
      },
      { storyboardsByShotNo: nextPipe.storyboardsByShotNo, skipAssetsProjection: true },
    );
    window.setTimeout(() => onVideosToSplice?.(), 80);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className={`${cardCls(isDark)} p-3 flex flex-wrap items-center justify-between gap-2`}>
        <div className={`text-[13px] leading-relaxed ${mutedCls(isDark)}`}>
          按成片比例预览，默认显示缩略图，悬停播放；点击已出片卡片可切换历史纪录；拖动可改写入剪辑顺序。
        </div>
        <button
          type="button"
          disabled={!ready.length || !onVideosToSplice}
          className={`nodrag rounded-lg px-3.5 py-2 text-[13px] font-medium disabled:opacity-45 ${
            isDark ? 'bg-emerald-500/80 text-white' : 'bg-emerald-700 text-white'
          }`}
          onClick={() => onVideosToSplice?.()}
        >
          按镜头顺序写入剪辑
        </button>
      </div>
      {!shots.length ? (
        <div className={`${cardCls(isDark)} flex min-h-[12rem] items-center justify-center text-[16px] ${mutedCls(isDark)}`}>
          暂无镜头。请先完成导演分镜并生成视频。
        </div>
      ) : (
        <>
          <div className={`text-[13px] ${mutedCls(isDark)}`}>
            {shots.length} 镜 · 已出片 {ready.length}
            {missing ? ` · 未出片 ${missing}` : ''}
            {' · '}
            {portraitGrid ? '一排 8 个' : '一排 6 个'}
            {'，可拖动改序'}
          </div>
          <div
            className={`grid min-h-0 flex-1 content-start gap-3 overflow-auto custom-scrollbar-dark pr-0.5 ${
              portraitGrid ? 'grid-cols-8' : 'grid-cols-6'
            }`}
          >
            {shots.map((shot, index) => {
              const sb = getDirectorShotStoryboard(pipeline, String(shot.shot_no || '').trim());
              const posterHint =
                String(shot.storyboard_image_url || '').trim() ||
                String(sb.imageUrl || '').trim();
              const videoVersions = listDirectorShotVideos({
                videoUrl: String(shot.video_url || sb.videoUrl || '').trim(),
                videoUrlHistory: sb.videoUrlHistory,
              });
              return (
                <DramaFinalCutShotCard
                  key={shot.shot_id}
                  shot={shot}
                  index={index}
                  isDark={isDark}
                  aspectBoxClass={aspectBoxClass}
                  aspectStyle={aspectStyle}
                  posterHint={posterHint}
                  videoVersions={videoVersions}
                  selected={selectedShotId === shot.shot_id}
                  dragging={draggingId === shot.shot_id}
                  dropTarget={dropTargetId === shot.shot_id && draggingId !== shot.shot_id}
                  hoverDisabled={!!draggingId}
                  onSelectCard={setSelectedShotId}
                  onSelectVideo={selectShotVideo}
                  onDragStartShot={(shotId, e) => {
                    const t = e.target as HTMLElement | null;
                    if (t?.closest?.('a, button, [data-no-card-drag]')) {
                      e.preventDefault();
                      return;
                    }
                    e.dataTransfer.setData('application/x-nexflow-drama-shot', shotId);
                    e.dataTransfer.setData('text/plain', `drama-shot:${shotId}`);
                    e.dataTransfer.effectAllowed = 'move';
                    dragShotId.current = shotId;
                    setDraggingId(shotId);
                  }}
                  onDragEndShot={() => {
                    dragShotId.current = null;
                    setDraggingId(null);
                    setDropTargetId(null);
                  }}
                  onDragOverShot={(shotId, e) => {
                    const types = Array.from(e.dataTransfer.types || []);
                    const isReorder =
                      types.includes('application/x-nexflow-drama-shot') || !!dragShotId.current;
                    if (!isReorder) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dropTargetId !== shotId) setDropTargetId(shotId);
                  }}
                  onDropShot={(shotId, e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const fromId =
                      e.dataTransfer.getData('application/x-nexflow-drama-shot') ||
                      dragShotId.current ||
                      '';
                    dragShotId.current = null;
                    setDraggingId(null);
                    setDropTargetId(null);
                    applyReorder(fromId, shotId);
                  }}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default DramaStudioHost;
