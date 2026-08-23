/**
 * AI 短剧导演台 V2 — 用户 4 阶段工作台（挂在 directorDrama 节点壳内）。
 * 剧本（含分集/视觉/分析）→ 素材准备 → 导演分镜 → 成片
 * Domain 仍保留内部 8 phase，由 userPhase 映射。
 */

import React, {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, Download, Loader2, Pause, Play, Plus, Trash2 } from 'lucide-react';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import VoiceMicGlyph from '../Canvas/VoiceMicGlyph';
import { AudioWaveformVisualizer } from '../Canvas/AudioWaveformVisualizer';
import { useCloudRealtimeDictation } from '../../hooks/useCloudRealtimeDictation';
import { useDictationPushToTalk } from '../../hooks/useDictationPushToTalk';
import { micLevelCssVars } from '../../utils/micInputLevel';
import { acquireVoiceModalLock, releaseVoiceModalLock } from '../../utils/voiceModalGate';
import { LLM_CHAT_DISPLAY_MODEL_ID } from '../../utils/cloudModelPricing';
import {
  formatCloudLlmUserError,
  isCloudFcTimeoutError,
} from '../../../shared/cloudLlmUserError';
import type { DirectorPipelineState } from '../../../shared/directorPipeline';
import { getDirectorShotStoryboard, migrateBareDirectorStoryboardsToEpisode, remapDramaStoryboardsAfterShotListEdit } from '../../../shared/directorPipeline';
import {
  pickNearestDirectorVideoBatchDuration,
  listDirectorVideoDurationTiersSec,
  directorShotNeedsVideoGeneration,
} from '../../utils/directorVideoBatch';
import {
  buildDramaDomainAnalyzeMessages,
  buildDramaDomainAnalyzeCompactMessages,
  buildDramaDomainShotPlanMessages,
  normalizeDramaShotPlanPaceGear,
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
  confirmDramaBoard,
  confirmDramaAssets,
  unlockDramaBoard,
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
  dedupeDramaPropsByKind,
  listUnusedDramaPropIds,
  listUnusedDramaSceneIds,
  pruneUnusedDramaBibleAssets,
  formatDramaDialogueLines,
  getActiveEpisodeBible,
  getDramaVideoAdapter,
  migrateDramaV1ToDomainV2,
  normalizeDramaDomainAnalyzeResult,
  normalizeDramaShotPlanResult,
  attachDramaShotSuggestions,
  estimateDramaAnalyzeShotBudget,
  refineDramaShotBudgetFromAnalyze,
  validateDramaVisualEventCount,
  validateDramaShotPlan,
  dramaShotPlanIsAcceptable,
  formatDramaShotPlanValidationError,
  normalizeDramaDomainPhase,
  refreshDramaContinuity,
  refreshDramaPackages,
  setDramaSessionPhase,
  splitNovelIntoEpisodes,
  createEmptyDramaEpisode,
  enrichAllDramaShotsLocally,
  enrichDramaShotLocally,
  buildDramaBoardEnrichMessages,
  applyDramaBoardEnrichResult,
  DRAMA_BOARD_ENRICH_BATCH,
  resolveCharacterIdsForShot,
  resolveVoicesForShot,
  listCharactersMissingDesign,
  resolveCharacterMasterReferenceUrl,
  resolveSceneMasterReferenceUrl,
  resolvePropMasterReferenceUrl,
  pickPipelineAssetImage,
  applyDramaSessionAssetImage,
  listDramaSupportedVideoModels,
  normalizeDramaSupportedVideoModel,
  resolveDramaShotVideoModel,
  dramaVideoModelRequiresShotAudio,
  ensureAppearingCharactersInBible,
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
  buildDramaShotH3OptimizeMessages,
  applyDramaDirectingEnhancePatch,
  parseDramaDirectingEnhancePatch,
  revertDramaDirectingEnhance,
  compileDramaShotVideoRequest,
  deriveDramaAudioTimelineFromShotEvents,
  dramaShotHasSpokenDialogue,
  applyDramaDirectingBreakdownSession,
  listDirtyDirectingShotIds,
  dramaShotDirectingFingerprint,
  parseDramaDirectingBreakdownLlm,
  buildDramaDirectingBreakdownMessages,
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
  snapDramaShotDurationSec,
  ensureDramaShotTimelineEvents,
  rescaleDramaTimelineEventsToDuration,
  type DramaDirectorSession,
  type DramaDomainPhase,
  type DramaEpisode,
  type DramaShot,
  type DramaShotSuggestion,
  type DramaCharacter,
  type DramaCharacterCostume,
  type DramaSceneAsset,
  type DramaVoice,
  removeDramaShotAt,
  insertDramaShotAt,
  planMergeDramaShots,
} from '../../../shared/directorDomain';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import { AnalyzeDirectorWorkspace } from './AnalyzeDirectorWorkspace';
import { DramaShotRefZones } from './DramaShotRefZones'; // 素材区含添加额度卡
import { DramaExecuteTablePanel, DramaShotPromptCardSurface, runDramaMultiShotH3SkillMerge, runDramaShotH3SkillOptimize } from './DramaExecuteTablePanel';
import { VisualStyleLibrary } from './VisualDNAEditor';
import { ModuleProgressBar } from '../Canvas/ModuleProgressBar';
import { RefImageHoverThumb } from '../Canvas/RefImageHoverThumb';
import {
  yuanbaoHoverTipAboveCls,
  yuanbaoHoverTipBelowCls,
} from '../darkModalShell';
import { toElectronVideoElementSrc } from '../../utils/normalizeVideoUrl';
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
  }) => void;
  showAlert: (msg: string) => void;
  /** 按镜头规划时长估算元宝价文案（成片按钮展示） */
  getShotVideoPriceLabel?: (
    durationSec: number,
    opts?: { model?: string; preferLipsync?: boolean },
  ) => string | null;
  /** 「分析本集」旁的大语言模型选择器 */
  chatModelSelectSlot?: React.ReactNode;
  /** 资产生成：模型 / 清晰度选择（复用导演台现有生图模型） */
  imageGenToolbarSlot?: React.ReactNode;
  /** 单张 AI 生图价格文案（如「全能图片 V2 · 1K · 3元宝」） */
  unitImagePriceLabel?: string | null;
  /** 提示词优化（LLM 单次）悬停价 */
  unitChatPriceLabel?: string | null;
  /** 一键生成总价文案（按缺失张数） */
  batchImagePriceLabel?: string | null;
  /** AI 生图（按 Domain 资产 id） */
  onGenerateAssetImage?: (kind: DramaAssetVisualKind, assetId: string) => void;
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
  unitImagePriceLabel,
  unitChatPriceLabel,
  batchImagePriceLabel,
  onGenerateAssetImage,
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
      base = createEmptyDramaSession(sessionProp || undefined);
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
      const shotNo = String(s.shot_no || '').trim();

      if (!url && !status && !nodeId) return s;

      // 空槽：仅在本镜已点生成（generating）或画布已有成片时同步，避免误捡其他镜成片
      if (!ownUrl && !ownNode) {
        const boardReady = !!url && status !== 'generating' && status !== 'queued';
        const waiting = ownStatus === 'generating' || ownStatus === 'queued';
        if (!waiting && !boardReady) return s;
      }

      const writeUrl = url || ownUrl;
      const writeNode = nodeId || ownNode;
      const writeStatus =
        url && (status === 'ready' || (!status && !!url))
          ? 'ready'
          : (ownStatus === 'generating' || ownStatus === 'queued') &&
              (status === 'ready' || !status) &&
              videoGeneratingIds?.[shotNo]
            ? ownStatus
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
      opts?: { storyboardsByShotNo?: DirectorPipelineState['storyboardsByShotNo'] },
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
      onSessionChange(withChat);
      // pipeline 同步降到 transition，避免挡输入/点击首帧
      startTransition(() => {
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
          isGenerating: next.meta.isGenerating,
          error: next.meta.error,
          activeDramaEpisodeId: withChat.active_episode_id || '',
          assets: mergeDramaPipelineAssetsFromSession(withChat, pipeline.assets),
          storyboardsByShotNo: migrateBareDirectorStoryboardsToEpisode(
            boardsSrc,
            String(
              withChat.active_episode_id || withChat.episodes?.[0]?.episode_id || '',
            ).trim(),
          ),
        });
      });
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

  const goPhase = (p: DramaDomainPhase) => {
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
        const gate = canEnterDramaUserPhase(session, targetUser);
        if (!gate.ok) {
          showAlert(gate.reason);
          target = preferredDomainPhaseForUserPhase(gate.fallback, session);
        }
      }
    }

    // 剧本内部前置：分集 / 视觉 / 选集（不要求人物图）
    if (
      (target === 'visual' ||
        target === 'analyze' ||
        target === 'assets' ||
        target === 'board') &&
      !(session.episodes || []).length
    ) {
      showAlert('请先接入或粘贴剧本并完成分集');
      target = 'episodes';
    } else if (
      (target === 'analyze' || target === 'assets' || target === 'board') &&
      !(session.bible.projectVisualBible?.selected_at)
    ) {
      showAlert('请先在剧本阶段完成「视觉美术」锁定整片风格');
      target = 'visual';
    } else if (
      (target === 'analyze' || target === 'assets' || target === 'board') &&
      !(session.active_episode_id || '').trim()
    ) {
      showAlert('请先选择要制作的一集');
      target = 'episodes';
    }

    // 进素材：必须已确认分析（先出参考图，再进导演分镜）
    if (target === 'assets' && !isDramaAnalyzeConfirmed(session)) {
      showAlert('请先完成并确认剧本分析，再进入素材准备');
      target = 'analyze';
    }

    // 进导演分镜：必须已确认素材（人物/场景参考图）
    if (target === 'board' && !isDramaAssetsConfirmed(session)) {
      showAlert('请先在素材准备生成参考图并确认素材，再进入导演分镜');
      target = isDramaAnalyzeConfirmed(session) ? 'assets' : 'analyze';
    }

    // 进成片：须已确认导演表
    if (target === 'review') {
      const gate = canEnterDramaUserPhase(session, 'final');
      if (!gate.ok) {
        showAlert(gate.reason);
        target = preferredDomainPhaseForUserPhase(gate.fallback, session);
      }
    }

    let base = ensureDramaActiveEpisodeWorkingSet(session);
    // 返回剧本阶段修改：解除素材/导演表确认（分析确认保留，直到重新分析）
    if (
      (target === 'ingest' ||
        target === 'visual' ||
        target === 'episodes' ||
        target === 'analyze') &&
      (isDramaBoardConfirmed(session) || isDramaAssetsConfirmed(session))
    ) {
      base = invalidateDramaConfirmationsAfter(
        session,
        target === 'visual' ? 'visual' : 'assets',
      );
      showAlert('已返回剧本阶段：后续「素材 / 导演表」确认已解除，修改后请重新确认');
    }

    if (target === 'assets' || target === 'board') {
      base = ensureAppearingCharactersInBible(base);
    }
    // 从分镜退回素材：只解除导演表确认（素材确认保留，可继续补图）
    if (
      target === 'assets' &&
      isDramaBoardConfirmed(base) &&
      domainPhaseToUserPhase(session.meta.phase) !== 'assets'
    ) {
      base = invalidateDramaConfirmationsAfter(base, 'board');
      showAlert('已返回素材准备：导演表确认已解除；改完后请重新确认导演表');
    }
    let next = setDramaSessionPhase(base, target);
    if (target === 'board' || target === 'review') next = refreshDramaContinuity(next);
    if (target === 'board') next = refreshDramaPackages(next);
    patchSession(next);
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
    if (!session.bible.projectVisualBible?.selected_at) {
      closeEpisodeEditor(true);
      showAlert('请先完成「视觉美术」：整片风格锁定后，所有分集共用同一套美术效果');
      goPhase('visual');
      return;
    }
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

  /** 选集后进入本集剧本分析（视觉风格已在整片级锁定） */
  const openEpisodeAnalyze = (ep: DramaEpisode) => {
    if (!session.bible.projectVisualBible?.selected_at) {
      showAlert('请先完成「视觉美术」：整片风格锁定后，所有分集共用同一套美术效果');
      goPhase('visual');
      return;
    }
    // 一次写回：先收当前集草稿，再激活目标集（禁止两次 patchSession 竞态把 active 打回上一集）
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
    const next = setDramaSessionPhase(
      activateDramaEpisode(
        {
          ...base,
          meta: { ...base.meta, source_script: targetText, phase: 'analyze' },
        },
        ep.episode_id,
      ),
      'analyze',
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
            phase: 'visual',
          },
        });
        setEpisodeDraft(eps[0].text);
        showAlert(`已分成 ${eps.length} 集，请先在「视觉美术」锁定整片风格（全部分集共用）`);
      } finally {
        setSplitting(false);
      }
    },
    [patchSession, session, showAlert],
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

  const runDramaJsonChat = async (sys: string, user: string) => {
    const baseChatOpts = {
      max_tokens: 16384,
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
      throw new Error('还没有 Visual Events，请先点「分析本集」');
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
    const shotMsgs = (retryHint?: string) =>
      buildDramaDomainShotPlanMessages({
        title: analyzeTitle,
        styleHint,
        budget: shotBudget,
        visualEvents: events,
        sceneBeats: beats,
        characterNames: formatDramaCharacterNamesForShotPlan(
          (analyzedSession.bible.characters || []).map((c) => c.name),
          getActiveEpisodeBible(analyzedSession).directing_notes,
        ),
        sceneNames: (analyzedSession.bible.scenes || []).map((s) => s.name || s.location),
        characterDossier,
        retryHint,
        paceGear: analyzedSession.meta.shotPlanPaceGear,
      });
    const runShotPlan = async (retryHint?: string) => {
      const msgs = shotMsgs(retryHint);
      const shotText = await runDramaJsonChat(msgs.systemPrompt, msgs.userPrompt);
      return normalizeDramaShotPlanResult(shotText, beats);
    };
    let planned = await runShotPlan(extraRetryHint);
    if (!planned.ok) {
      planned = await runShotPlan('只输出含 shots 数组的完整 JSON，每镜必须带 event_ids。');
    }
    if (!planned.ok) throw new Error(planned.error);

    let validation = validateDramaShotPlan({
      suggestions: planned.suggestions,
      visualEvents: events,
      sceneBeats: beats,
      budget: shotBudget,
      paceGear: analyzedSession.meta.shotPlanPaceGear,
    });
    if (!validation.ok) {
      planned = await runShotPlan(formatDramaShotPlanValidationError(validation));
      if (!planned.ok) throw new Error(planned.error);
      validation = validateDramaShotPlan({
        suggestions: planned.suggestions,
        visualEvents: events,
        sceneBeats: beats,
        budget: shotBudget,
        paceGear: analyzedSession.meta.shotPlanPaceGear,
      });
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
      // 云端 FC 常见 120s 硬超时：中长剧本直接走精简分析，避免完整人设先撞 502
      const preferCompactFirst = sourceChars >= 1200;
      const fullMsgs = buildDramaDomainAnalyzeMessages({
        sourceText: source,
        title: analyzeTitle,
        styleHint,
        existingCharacterNames: (session.bible.characters || []).map((c) => c.name),
        existingSceneNames: (session.bible.scenes || []).map((s) => s.name || s.location),
      });
      const compactMsgs = buildDramaDomainAnalyzeCompactMessages({
        sourceText: source,
        title: analyzeTitle,
        styleHint,
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
      const baseForNormalize = {
        ...session,
        active_episode_id: epId,
        episodes: workingEpisodes,
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
      let normalized = normalizeDramaDomainAnalyzeResult(text, baseForNormalize);
      if (!normalized.ok) {
        const compact = buildDramaDomainAnalyzeCompactMessages({
          sourceText: source,
          title: analyzeTitle,
          styleHint,
        });
        text = await runAnalyzeChat(compact.systemPrompt, compact.userPrompt, true);
        normalized = normalizeDramaDomainAnalyzeResult(text, baseForNormalize);
      }
      if (!normalized.ok) {
        const compact = buildDramaDomainAnalyzeCompactMessages({
          sourceText: source,
          title: analyzeTitle,
          styleHint,
        });
        text = await runAnalyzeChat(
          compact.systemPrompt,
          `${compact.userPrompt}\n\n必须输出完整 JSON，含 characters、scene_beats、visual_events，以 } 结束。`,
          false,
        );
        normalized = normalizeDramaDomainAnalyzeResult(text, baseForNormalize);
      }
      if (!normalized.ok) throw new Error(normalized.error);

      const eventBudget = estimateDramaAnalyzeShotBudget(source);
      let analyzedSession = normalized.session;
      let events = getActiveEpisodeBible(analyzedSession).visual_events || [];
      let eventCheck = validateDramaVisualEventCount(events, eventBudget);
      if (!eventCheck.ok) {
        const compact = buildDramaDomainAnalyzeCompactMessages({
          sourceText: source,
          title: analyzeTitle,
          styleHint,
        });
        text = await runAnalyzeChat(
          compact.systemPrompt,
          `${compact.userPrompt}\n\n【事件不足】${eventCheck.error}`,
          true,
        );
        normalized = normalizeDramaDomainAnalyzeResult(text, baseForNormalize);
        if (!normalized.ok) throw new Error(normalized.error);
        analyzedSession = normalized.session;
        events = getActiveEpisodeBible(analyzedSession).visual_events || [];
        eventCheck = validateDramaVisualEventCount(events, eventBudget);
      }
      if (!eventCheck.ok) throw new Error(eventCheck.error);

      setAnalyzingHint('正在生成分镜脚本…');
      let planned: Awaited<ReturnType<typeof planShotsFromSession>>['planned'] | null = null;
      let validation: Awaited<ReturnType<typeof planShotsFromSession>>['validation'] | null =
        null;
      let incomplete = false;
      let shotPlanError = '';
      try {
        const shotResult = await planShotsFromSession(
          analyzedSession,
          source,
          analyzeTitle,
          styleHint,
        );
        planned = shotResult.planned;
        validation = shotResult.validation;
        incomplete = !!shotResult.incomplete;
      } catch (shotErr) {
        shotPlanError =
          shotErr instanceof Error ? shotErr.message : String(shotErr || '分镜脚本生成失败');
      }
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
          phase: 'analyze',
          analyze_confirmed: false,
          board_confirmed_at: 0,
          assets_confirmed_at: 0,
        },
        bible: {
          ...analyzedSession.bible,
          confirmed_at: 0,
        },
      });
      if (planned?.suggestions?.length) {
        nextSession = attachDramaShotSuggestions(nextSession, planned.suggestions, epId);
      }
      nextSession = ensureAppearingCharactersInBible(nextSession);
      try {
        const castPicks = await loadDramaCastLibraryPicks(projectId);
        if (castPicks.length) {
          nextSession = fillEmptyDramaAssetsFromLibraryPicks(nextSession, castPicks).session;
        }
      } catch {
        /* 本剧人物库回填失败不挡分析 */
      }
      patchSession(nextSession);
      if (shotPlanError) {
        showAlert(
          `「${epTitle}」人物/场景/事件已分析，但分镜脚本未生成成功：\n${shotPlanError}\n\n请点「重新生成分镜脚本」再试。`,
        );
      } else if (incomplete && validation) {
        showAlert(
          `「${epTitle}」已保存 ${validation.shotCount} 条分镜脚本草稿（未完全覆盖事件）。\n${formatDramaShotPlanValidationError(
            validation,
          )}\n\n请点「重新生成分镜脚本」补全后再进素材准备。`,
        );
      } else if (validation) {
        showAlert(
          `「${epTitle}」分析完成：${validation.shotCount} 条分镜脚本；硬事件 ${Math.round(
            validation.hardCoverage * 100,
          )}%（${validation.hardCoveredCount}/${validation.hardEventCount}），辅助事件 ${Math.round(
            validation.auxCoverage * 100,
          )}%。请确认后进入素材准备`,
        );
      }
    } catch (e) {
      showAlert(formatCloudLlmUserError(e));
    } finally {
      setAnalyzing(false);
      setAnalyzingHint('正在策划本集…');
    }
  };

  const handleRegenerateShotPlan = async () => {
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
    const events = getActiveEpisodeBible(session).visual_events || [];
    if (!events.length) {
      showAlert('还没有 Visual Events，请先点「分析本集」');
      return;
    }
    if (analyzing || busy) return;
    const existing = getActiveEpisodeBible(session).shot_suggestions?.length || 0;
    if (existing) {
      const ok = await showConfirm(
        '将覆盖当前分镜脚本（角色、场次、Visual Events 不变）。确定重新生成？',
      );
      if (!ok) return;
    }
    setAnalyzing(true);
    setAnalyzingHint('正在重新生成分镜脚本…');
    try {
      commitEpisodeText(source, epId);
      const analyzeTitle = `${stripDramaEpisodeTitleSuffix(session.bible.project.name || '短剧') || '短剧'} · ${
        epFresh.title || '本集'
      }`;
      const styleHint = pipeline.globalStyle || session.bible.project.visual_style;
      const baseSession = {
        ...session,
        active_episode_id: epId,
        episodes: (session.episodes || []).map((e) =>
          e.episode_id === epId ? { ...e, text: source, updated_at: Date.now() } : e,
        ),
        meta: { ...session.meta, source_script: source },
      };
      const { planned, validation, incomplete } = await planShotsFromSession(
        baseSession,
        source,
        analyzeTitle,
        styleHint,
        '用户不满意上一版。必须换一套景别/运镜/时长组合，覆盖同样 Visual Events。禁止只改措辞或微调秒数，不要复述上一版 action 原文。',
      );
      let nextSession = attachDramaShotSuggestions(baseSession, planned.suggestions, epId);
      nextSession = ensureAppearingCharactersInBible(nextSession);
      nextSession = invalidateDramaConfirmationsAfter(nextSession, 'analyze');
      patchSession(nextSession);
      if (incomplete) {
        showAlert(
          `已保存 ${validation.shotCount} 条分镜脚本草稿（未完全覆盖事件）。\n${formatDramaShotPlanValidationError(
            validation,
          )}\n\n可再点一次「重新生成分镜脚本」补全。`,
        );
      } else {
        showAlert(
          `已重新生成 ${validation.shotCount} 条分镜脚本；硬事件 ${Math.round(
            validation.hardCoverage * 100,
          )}%（${validation.hardCoveredCount}/${validation.hardEventCount}），辅助事件 ${Math.round(
            validation.auxCoverage * 100,
          )}%。可再改或再点一次重新生成。`,
        );
      }
    } catch (e) {
      showAlert(e instanceof Error ? e.message : String(e));
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
      showAlert('还没有角色名单，请先点「分析本集」');
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
      showAlert('还没有分镜脚本，请先点「分析本集」或「重新生成分镜脚本」');
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

  const handleConfirmAnalyze = () => {
    const shotCount = session.episode_bibles?.[session.active_episode_id]?.shot_suggestions?.length || 0;
    if (!shotCount) {
      showAlert('请先完成本集分析并生成分镜脚本（事件→镜头校验通过后才会写入）');
      return;
    }
    if (activeEpisode && episodeDraft !== activeEpisode.text) {
      commitEpisodeText(episodeDraft);
    }
    patchSession(confirmDramaAnalyze(session));
  };

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
              : userPhase === 'assets'
                ? '素材准备'
                : userPhase === 'board'
                  ? '导演分镜'
                  : '成片'}
            ）。部分阶段状态需要重新确认（剧本分析 → 素材 → 导演表）。人物/场景卡片数据已保留；请先在「素材准备」生成参考图，再进导演分镜。
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
                {splitting ? '分集中…' : '分集'}
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
                  goPhase('visual');
                }}
              >
                进入视觉美术
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
                    ? '整片视觉风格已锁定，所有分集共用同一套美术效果；点卡片改正文，点「分析」进入本集分析，点「+」录入下一集'
                    : '点「+」直接录入本集剧本；整本粘贴分集请用右上「粘贴/上传剧本」'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={`nodrag rounded-lg px-3 py-1.5 text-[12px] ${
                    isDark ? 'bg-white/10' : 'bg-gray-100'
                  }`}
                  onClick={() => goPhase('visual')}
                >
                  返回视觉美术
                </button>
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
            {episodes.length > 0 && !session.bible.projectVisualBible?.selected_at ? (
              <div
                className={`rounded-lg px-3 py-2 text-[13px] ${
                  isDark ? 'bg-amber-500/15 text-amber-200' : 'bg-amber-50 text-amber-800'
                }`}
              >
                尚未锁定整片视觉风格。请先完成「视觉美术」，再选集分析。
                <button
                  type="button"
                  className="nodrag ml-2 underline"
                  onClick={() => goPhase('visual')}
                >
                  去视觉美术
                </button>
              </div>
            ) : null}
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
                  return (
                    <div
                      key={ep.episode_id}
                      className={`nodrag group relative w-full min-h-[10.5rem] rounded-xl p-4 flex flex-col overflow-hidden text-left transition-all duration-200 hover:scale-[1.02] ${
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
                            className={`text-[18px] font-bold leading-tight line-clamp-2 ${
                              isDark ? 'text-white' : 'text-gray-900'
                            }`}
                          >
                            {ep.title || `第${ep.episode_no}集`}
                          </div>
                          <div className={`mt-2 text-[12px] ${mutedCls(isDark)}`}>
                            {ep.analyzed ? '已分析' : '未分析'} · {ep.text.length} 字
                          </div>
                          {sameTextAsOther ? (
                            <div
                              className={`mt-1 text-[11px] ${
                                isDark ? 'text-amber-200/90' : 'text-amber-700'
                              }`}
                            >
                              与其他集正文相同，请检查分集
                            </div>
                          ) : null}
                        </div>
                      </button>
                      <div className="relative z-[2] mt-auto flex items-center justify-between gap-2 pt-2">
                        <div className={`min-w-0 truncate text-[11px] ${mutedCls(isDark)}`}>
                          {dateStr ? `修改：${dateStr}` : '点击查看/改正文'}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            className={`nodrag rounded-md px-2 py-1 text-[11px] font-medium ${
                              isDark
                                ? 'bg-white/10 text-white/85 hover:bg-white/16'
                                : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              openEpisodeEditor(ep);
                            }}
                          >
                            改正文
                          </button>
                          <button
                            type="button"
                            className={`nodrag rounded-md px-2 py-1 text-[11px] font-medium ${
                              isDark
                                ? 'bg-sky-500/80 text-white hover:bg-sky-500'
                                : 'bg-sky-600 text-white hover:bg-sky-700'
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              openEpisodeAnalyze(ep);
                            }}
                          >
                            分析
                          </button>
                        </div>
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
            ) : (
              <div className="relative flex flex-1 min-h-0 flex-col gap-3">
                <div className="shrink-0 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <button
                      type="button"
                      className={`nodrag text-[12px] mb-1 ${mutedCls(isDark)} hover:underline`}
                      onClick={() => goPhase('ingest')}
                    >
                      ← 返回剧本分集
                    </button>
                    <div className="text-[15px] font-semibold truncate">
                      视觉美术 · 整片锁定
                    </div>
                    <div className={`text-[12px] mt-0.5 ${mutedCls(isDark)}`}>
                      选定后写入 Project Visual Bible，后续所有分集共用同一套美术效果，避免风格漂移
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <button
                      type="button"
                      className={`nodrag rounded-lg px-3.5 py-2 text-[13px] font-medium ${
                        isDark ? 'bg-emerald-500/80 text-white' : 'bg-emerald-700 text-white'
                      } disabled:opacity-50`}
                      disabled={!session.bible.projectVisualBible?.selected_at}
                      onClick={() => {
                        if (!session.bible.projectVisualBible?.selected_at) {
                          showAlert('请先选择一张视觉风格卡片');
                          return;
                        }
                        if (isDramaBoardConfirmed(session) || isDramaAssetsConfirmed(session)) {
                          showAlert(
                            '修改视觉风格可能影响后续素材与导演分镜，后续确认将解除，请重新确认。',
                          );
                          patchSession(
                            invalidateDramaConfirmationsAfter(
                              setDramaSessionPhase(session, 'episodes'),
                              'visual',
                            ),
                          );
                          return;
                        }
                        showAlert('整片视觉风格已锁定，所有分集将保持该美术效果');
                        goPhase('episodes');
                      }}
                    >
                      确认进入选择集数
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
            )}
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
                      返回美术
                    </button>
                  </div>
                </div>

                <div className="shrink-0 flex items-center gap-2 flex-wrap pl-10">
                  {chatModelSelectSlot ? (
                    <div className="nodrag flex items-center gap-1.5 shrink-0">
                      {chatModelSelectSlot}
                    </div>
                  ) : null}
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
                        {analyzingHint.includes('加厚')
                          ? '加厚中…'
                          : analyzingHint.includes('人设')
                            ? '人设中…'
                            : analyzingHint.includes('分镜')
                              ? '分镜中…'
                              : '策划中…'}
                      </span>
                    ) : (
                      '分析本集'
                    )}
                  </button>
                  <div
                    className={`nodrag inline-flex items-center rounded-lg p-0.5 text-[12px] ${
                      isDark ? 'bg-white/10' : 'bg-gray-100'
                    }`}
                    title="15秒高密度=合镜段落+镜内时间子窗（默认）/ 短剧快切=6秒细切 / 正剧细致感；改挡后点「重新生成分镜脚本」或「分析本集」生效"
                  >
                    {(
                      [
                        { id: 'dense_15s' as const, label: '15秒高密度' },
                        { id: 'short_drama' as const, label: '短剧快切' },
                        { id: 'cinematic' as const, label: '正剧细致感' },
                      ] as const
                    ).map((opt) => {
                      const active =
                        normalizeDramaShotPlanPaceGear(session.meta.shotPlanPaceGear) === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          disabled={analyzing || busy}
                          className={`rounded-md px-2.5 py-1.5 font-medium transition-colors ${
                            active
                              ? isDark
                                ? 'bg-sky-500/90 text-white'
                                : 'bg-gray-900 text-white'
                              : isDark
                                ? 'text-white/70 hover:text-white'
                                : 'text-gray-600 hover:text-gray-900'
                          }`}
                          onClick={() => {
                            if (active) return;
                            patchSession({
                              ...session,
                              meta: {
                                ...session.meta,
                                shotPlanPaceGear: opt.id,
                              },
                            });
                          }}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    className={`nodrag rounded-lg px-3.5 py-2 text-[13px] font-medium ${
                      isDark
                        ? 'border border-white/20 bg-white/10 text-white hover:bg-white/15'
                        : 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
                    }`}
                    disabled={analyzing || busy || !episodeDraft.trim()}
                    onClick={() => void handleRegenerateShotPlan()}
                  >
                    重新生成分镜脚本
                  </button>
                  <button
                    type="button"
                    className={`nodrag rounded-lg px-3.5 py-2 text-[13px] font-medium ${
                      isDark
                        ? 'border border-white/20 bg-white/10 text-white hover:bg-white/15'
                        : 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
                    }`}
                    disabled={analyzing || busy || !episodeDraft.trim()}
                    onClick={() => void handleRegenerateCharacterDossier()}
                  >
                    重新生成人设
                  </button>
                  <button
                    type="button"
                    className={`nodrag rounded-lg px-3.5 py-2 text-[13px] font-medium ${
                      isDark
                        ? 'border border-white/20 bg-white/10 text-white hover:bg-white/15'
                        : 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
                    }`}
                    disabled={analyzing || busy || !episodeDraft.trim()}
                    onClick={() => void handleEnrichShotsFromDossier()}
                  >
                    按人设加厚分镜
                  </button>
                  <button
                    type="button"
                    className={`nodrag rounded-lg px-3.5 py-2 text-[13px] font-medium ${
                      isDark ? 'bg-emerald-500/80 text-white' : 'bg-emerald-700 text-white'
                    }`}
                    onClick={handleConfirmAnalyze}
                  >
                    确认进入素材准备
                  </button>
                  <span className={`text-[14px] ${mutedCls(isDark)}`}>
                    {session.bible.characters.length} 人 · {session.bible.scenes.length} 景 ·{' '}
                    {activeEpisodeBible.shot_suggestions.length} 镜脚本
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
                      className={`absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 ${
                        isDark ? 'bg-[#111113]/70' : 'bg-white/75'
                      }`}
                    >
                      <Loader2
                        className={`h-12 w-12 animate-spin ${isDark ? 'text-sky-300' : 'text-sky-600'}`}
                        strokeWidth={2.25}
                      />
                      <div className={`text-[16px] font-medium ${isDark ? 'text-white/90' : 'text-gray-800'}`}>
                        {analyzingHint}
                      </div>
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
                          ? 'bg-transparent text-white/90 placeholder-white/35'
                          : 'bg-transparent text-gray-900 placeholder-gray-400'
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
            videoGeneratingIds={videoGeneratingIds}
            onMarkVideoGenerating={onMarkVideoGenerating}
            onAbandonVideoWait={onAbandonVideoWait}
            onConfirmBoard={() => {
              if (!(session.shots || []).length) {
                showAlert('导演表还没有镜头，请先确认剧本分析或补全导演脚本');
                return;
              }
              patchSession(confirmDramaBoard(session));
              showAlert('导演表已确认，可在本页生成视频，再进入成片');
            }}
            onUnlockBoard={() => {
              patchSession(unlockDramaBoard(session));
              showAlert('已解除导演表确认；修改后请重新确认再出片');
            }}
            onNext={() => {
              if (!isDramaBoardConfirmed(session)) {
                showAlert('请先确认导演表，再进入成片');
                return;
              }
              goPhase('review');
            }}
            runChat={runChat}
            showAlert={showAlert}
            onGenerateShotAudio={onGenerateShotAudio}
            onAbandonShotAudio={onAbandonShotAudio}
            unitVoicePriceLabel={unitVoicePriceLabel}
          />
        )}

        {phase === 'assets' && (
          <div className="flex flex-col gap-3">
            <div className={`${cardCls(isDark)} p-3 flex flex-wrap items-center justify-between gap-2`}>
              <div className={`text-[13px] ${mutedCls(isDark)}`}>
                本剧素材仓库（全集共用，不分集）：人物 / 场景 / 道具 / 生物。各集分析只会往这里追加名单，不会按集拆成多套仓库。之后由你增删改：右下「+」新建，点名字和「提示词」修改，图片/声音可生成或上传，卡片右上角 × 删除。删掉的人物不会再被分析自动加回来。确认后进入导演分镜。
                {isDramaAssetsConfirmed(session) ? ' · 素材已确认' : ' · 待确认素材'}
              </div>
              <div className="flex items-center gap-2">
                {isDramaAssetsConfirmed(session) ? (
                  <button
                    type="button"
                    className={`nodrag rounded-lg px-3 py-1.5 text-[12px] ${
                      isDark ? 'bg-white/10' : 'bg-gray-100'
                    }`}
                    onClick={() => {
                      patchSession(unlockDramaAssets(session));
                      showAlert('已解除素材确认；修改后请重新确认再进导演分镜');
                    }}
                  >
                    解除确认
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`nodrag rounded-lg px-3.5 py-2 text-[13px] font-medium ${
                    isDark ? 'bg-emerald-500/80 text-white' : 'bg-emerald-700 text-white'
                  }`}
                  onClick={() => {
                    if (isDramaAssetsConfirmed(session)) {
                      goPhase('board');
                      return;
                    }
                    // 用已确认的 session 进分镜，避免闭包仍是未确认状态又弹窗
                    let next = confirmDramaAssets(session);
                    next = ensureAppearingCharactersInBible(next);
                    next = setDramaSessionPhase(next, 'board');
                    next = refreshDramaContinuity(next);
                    next = refreshDramaPackages(next);
                    patchSession(next);
                  }}
                >
                  {isDramaAssetsConfirmed(session) ? '进入导演分镜' : '确认素材并进入分镜'}
                </button>
              </div>
            </div>
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
          />
          </div>
        )}

        {phase === 'review' && (
          <DramaFinalCutPanel
            session={session}
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

function DramaPromptHoverButton({
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
        '你是短剧配音提示词编辑。根据用户修改思路，在保留原文结构与可用信息的前提下改写声音提示词。',
        '输出必须仍是纯文本，固定结构（每行一项，勿输出 Markdown/JSON/解释）：',
        '名字',
        '年龄：…',
        '性别：男/女/未注明',
        '音色描述：口语化、可念给人听的音色（勿堆英文标签）',
        '台词：',
        '（2～3 句，每句一行，须像角色会说的话）',
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
      '你是短剧美术提示词编辑。根据用户修改思路，在保留原文可用视觉信息的前提下改写图片提示词。',
      '输出须为可直接用于生图的纯中文描述（可含必要英文材质词），不要 Markdown/JSON/解释。',
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
      const model =
        String(chatModel || '').trim() || LLM_CHAT_DISPLAY_MODEL_ID;
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
          <button
            type="button"
            className="nodrag shrink-0 rounded-lg bg-violet-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-violet-400 disabled:opacity-50"
            disabled={revising || !runChat || !String(opinion || '').trim()}
            onClick={() => void handleAiRevise()}
          >
            {revising ? 'AI 改写中…' : 'AI 按原文改'}
          </button>
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
          {tip}
        </span>
      ) : null}
      {children}
    </span>
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
}) {
  const [priceHover, setPriceHover] = useState(false);
  const tip = String(priceLabel || '').trim();
  const itemCls = `nodrag flex h-7 w-full items-center justify-between gap-1 px-2 text-left text-[10px] leading-none transition-colors ${
    isDark
      ? 'text-white/90 hover:bg-sky-500 hover:text-white'
      : 'text-gray-800 hover:bg-sky-500 hover:text-white'
  }`;
  return (
    <div className="relative min-w-0 flex-1 group/src">
      {priceHover && tip && !generating ? (
        <span
          className={`${yuanbaoHoverTipAboveCls} translate-y-0 opacity-100`}
          title={tip}
        >
          {tip}
        </span>
      ) : null}
      <button
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
      <div
        className={`nodrag absolute left-0 right-0 top-[calc(100%+2px)] z-[90] origin-top overflow-hidden rounded-md border shadow-lg transition duration-150 ease-out ${
          isDark ? 'border-white/15 bg-[#1c1c1e]' : 'border-gray-200 bg-white'
        } pointer-events-none scale-y-90 opacity-0 group-hover/src:pointer-events-auto group-hover/src:scale-y-100 group-hover/src:opacity-100`}
      >
        <button type="button" className={itemCls} onClick={onUpload}>
          本地上传
        </button>
        <button
          type="button"
          className={`${itemCls} disabled:opacity-40`}
          disabled={!canPickFromCanvas || !onPickCanvas}
          onClick={() => onPickCanvas?.()}
        >
          从画布上传
        </button>
        {showLibrary && onPickLibrary ? (
          <button type="button" className={itemCls} onClick={onPickLibrary}>
            角色仓库
          </button>
        ) : null}
      </div>
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
}: {
  url: string;
  isDark: boolean;
  generating: boolean;
  downloadName?: string;
  onClear: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const hasMedia = !!String(url || '').trim();

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
      audioRef.current = a;
    }
    if (!a.paused) {
      a.pause();
      setPlaying(false);
      return;
    }
    if (a.getAttribute('src') !== url) a.src = url;
    setPlaying(true);
    void a.play().catch(() => setPlaying(false));
  };

  return (
    <div
      className={`relative flex items-center gap-1 overflow-hidden rounded-md px-1 py-1 ${
        isDark ? 'bg-black/40' : 'bg-gray-100'
      }`}
      data-no-card-drag
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
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
}: {
  session: DramaDirectorSession;
  characterId: string;
  isDark: boolean;
  generating: boolean;
  onChange: (s: DramaDirectorSession) => void;
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
    />
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
}: {
  session: DramaDirectorSession;
  characterId: string;
  isDark: boolean;
  open: boolean;
  onClose: () => void;
  onChange: (s: DramaDirectorSession) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  showConfirm: (message: string) => Promise<boolean>;
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
            const thumb = dramaCostumeImageUrl(c);
            return (
              <div key={c.costume_id} className="flex items-stretch gap-0.5">
                <button
                  type="button"
                  className={`${itemCls} ${on ? (isDark ? 'bg-violet-500/25' : 'bg-violet-50') : ''}`}
                  onClick={() => {
                    onChange(setActiveCharacterCostume(session, characterId, c.costume_id));
                    onClose();
                  }}
                >
                  <span
                    className={`h-8 w-8 shrink-0 overflow-hidden rounded-md ${
                      isDark ? 'bg-black/40' : 'bg-gray-100'
                    }`}
                  >
                    {thumb ? (
                      <img src={thumb} alt="" className="h-full w-full object-cover" draggable={false} />
                    ) : null}
                  </span>
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
                              url={img}
                              alt=""
                              title="悬停放大"
                              objectFit="cover"
                              previewBorderless
                              boxAspect="9 / 16"
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

  const list =
    tab === 'characters'
      ? session.bible.characters.map((c) => {
          const activeLook = activeDramaCostume(c);
          const lookUrl = dramaCostumeImageUrl(activeLook);
          // 有造型列表：优先当前造型图；造型图空时回退主形象/pipeline（避免任务已完成卡片仍空）
          const cardUrl = (c.costumes || []).length
            ? lookUrl ||
              resolveCharacterMasterReferenceUrl(c) ||
              pickPipelineAssetImage(pipeline?.assets?.characters, c.character_id, c.name) ||
              pickDramaLibraryImageUrl(c.name, localPicks)
            : resolveCharacterMasterReferenceUrl(c) ||
              pickPipelineAssetImage(pipeline?.assets?.characters, c.character_id, c.name) ||
              pickDramaLibraryImageUrl(c.name, localPicks);
          return {
            id: c.character_id,
            name: c.name,
            prompt: c.prompt,
            imageUrl: toDisplayableDramaMediaUrl(cardUrl),
            sampleUrl: '',
            status: c.status,
            extra: `${Math.max(c.costumes.length, 1)} 套造型`,
          };
        })
      : tab === 'scenes'
        ? session.bible.scenes.map((s) => ({
            id: s.scene_id,
            name: s.name,
            prompt: s.prompt,
            imageUrl: toDisplayableDramaMediaUrl(
              resolveSceneMasterReferenceUrl(s) ||
                pickPipelineAssetImage(pipeline?.assets?.scenes, s.scene_id, s.name || s.location) ||
                s.imageUrl,
            ),
            sampleUrl: '',
            status: s.status,
            extra: s.variants.length ? `${s.variants.length} 变体` : s.time_default || '默认',
          }))
        : tab === 'props'
          ? session.bible.props.map((p) => ({
              id: p.prop_id,
              name: p.name,
              prompt: p.prompt || p.description,
              imageUrl: toDisplayableDramaMediaUrl(
                resolvePropMasterReferenceUrl(p) ||
                  pickPipelineAssetImage(pipeline?.assets?.props, p.prop_id, p.name) ||
                  p.imageUrl,
              ),
              sampleUrl: '',
              status: p.status,
              extra: p.states.length ? `${p.states.length} 状态` : '',
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
            }));

  const isVisualTab = true;

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
        {session.bible.project.style || session.bible.project.visual_style ? (
          <span
            className={`text-[12px] px-2 py-1 rounded-md ${
              isDark ? 'bg-amber-500/15 text-amber-200/90' : 'bg-amber-50 text-amber-800'
            }`}
            title="生图会强制锁定该题材服装/时代"
          >
            题材锁：{session.bible.project.style || session.bible.project.visual_style}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
          {missingDesign.length > 0 ? (
            <span
              className={`rounded-md px-2 py-1 text-[12px] ${
                isDark ? 'bg-amber-500/20 text-amber-200' : 'bg-amber-50 text-amber-800'
              }`}
              title={missingDesign.map((c) => c.name).filter(Boolean).join('、')}
            >
              需设计形象 {missingDesign.length}
            </span>
          ) : (
            <span
              className={`rounded-md px-2 py-1 text-[12px] ${
                isDark ? 'bg-emerald-500/15 text-emerald-200/90' : 'bg-emerald-50 text-emerald-800'
              }`}
            >
              出场人物形象已齐
            </span>
          )}
          {isVisualTab ? imageGenToolbarSlot : null}
          {missingDesign.length > 0 ? (
            <DramaYuanbaoHoverWrap priceLabel={unitImagePriceLabel} tipBelow>
              <button
                type="button"
                className={`nodrag rounded-lg px-3.5 py-2 text-[13px] font-medium ${
                  isDark ? 'bg-amber-500/80 text-white' : 'bg-amber-700 text-white'
                } disabled:opacity-50`}
                disabled={!!busy}
                onClick={() => {
                  setTab('characters');
                  void (async () => {
                    const next = await hydrateEmptyLooks(session);
                    const before = (session.bible.characters || [])
                      .map((c) => `${c.character_id}:${c.imageUrl || ''}`)
                      .join('|');
                    const after = (next.bible.characters || [])
                      .map((c) => `${c.character_id}:${c.imageUrl || ''}`)
                      .join('|');
                    if (before !== after) onChange(next);
                    const stillMissing = listCharactersMissingDesign(next);
                    for (const c of stillMissing) {
                      onGenerateAssetImage?.('characters', c.character_id);
                    }
                  })();
                }}
              >
                生成缺形象人物
              </button>
            </DramaYuanbaoHoverWrap>
          ) : null}
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
                  // 勿用点击瞬间的 stale session 整包回写 generating，否则会冲掉已 ready 的图
                  const kinds: DramaAssetVisualKind[] = ['characters', 'scenes', 'props', 'creatures'];
                  for (const kind of kinds) {
                    const items =
                      kind === 'characters'
                        ? session.bible.characters.map((c) => ({
                            id: c.character_id,
                            imageUrl: c.imageUrl,
                          }))
                        : kind === 'scenes'
                          ? session.bible.scenes.map((s) => ({
                              id: s.scene_id,
                              imageUrl: s.imageUrl,
                            }))
                          : kind === 'props'
                            ? session.bible.props.map((p) => ({
                                id: p.prop_id,
                                imageUrl: p.imageUrl,
                              }))
                            : session.bible.creatures.map((c) => ({
                                id: c.creature_id,
                                imageUrl: c.imageUrl,
                              }));
                    for (const item of items) {
                      if (kind === 'characters') {
                        const ch = session.bible.characters.find((c) => c.character_id === item.id);
                        if (characterHasUsableReference(ch)) continue;
                      } else if (item.imageUrl) {
                        continue;
                      }
                      onGenerateAssetImage?.(kind, item.id);
                    }
                  }
                }}
              >
                一键生成
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
          {tab === 'characters' ? (
            <button
              type="button"
              className={`nodrag rounded-lg px-3.5 py-2 text-[13px] font-medium ${
                isDark ? 'bg-white/12 text-white' : 'bg-gray-100 text-gray-800'
              }`}
              title="从素材库勾选已有人物与声音，写入本集卡片"
              onClick={() => setLibraryPick({ characterId: null, prefer: 'both' })}
            >
              勾选已有人物/声音
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
                if (types.includes('Files')) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
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
              <div className={`${cardCls(isDark)} relative z-[20] flex flex-col overflow-hidden`}>
                <div
                  className={`group/img relative w-full overflow-hidden rounded-t-xl ${
                    isDark ? 'bg-black/40' : 'bg-gray-100'
                  }`}
                >
                  {item.imageUrl ? (
                    <RefImageHoverThumb
                      url={item.imageUrl}
                      alt=""
                      title="悬停放大"
                      objectFit="cover"
                      previewBorderless
                      boxAspect={mediaAspect}
                      listThumbMaxEdge={288}
                      className="w-full"
                    />
                  ) : (
                    <div
                      className={`flex w-full items-center justify-center text-[12px] px-2 text-center ${mutedCls(isDark)}`}
                      style={{ aspectRatio: mediaAspect }}
                      aria-hidden={generating}
                    >
                      {generating ? '' : '待生成/上传'}
                    </div>
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
                  <DramaPromptHoverButton
                    isDark={isDark}
                    items={
                      tab === 'characters'
                        ? [
                            {
                              label: '图片提示词',
                              onPick: () => setPromptEdit({ mode: 'image', assetId: item.id }),
                            },
                            {
                              label: '声音提示词',
                              onPick: () => setPromptEdit({ mode: 'voice', assetId: item.id }),
                            },
                          ]
                        : [
                            {
                              label: '图片提示词',
                              onPick: () => setPromptEdit({ mode: 'image', assetId: item.id }),
                            },
                          ]
                    }
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
          title={promptEdit.mode === 'voice' ? '声音提示词' : '图片提示词'}
          mode={promptEdit.mode}
          runChat={runChat}
          showAlert={showAlert}
          chatModel={chatModel}
          value={
            promptEdit.mode === 'voice'
              ? String(
                  findVoiceForCharacter(session, promptEdit.assetId)?.sample_text || '',
                )
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
              ? '名字\n年龄：…\n性别：男/女\n音色描述：甜美细声细语 / 粗放狂野…\n台词：\n（剧本 2～3 句，每句一行）'
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
              const voiceId = findVoiceForCharacter(session, promptEdit.assetId)?.voice_id;
              if (voiceId) onChange(setDomainAssetPrompt(session, 'voices', voiceId, text));
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
}: {
  prompt: string;
  isDark: boolean;
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
        title="悬停查看 H3 优化提示词"
        onMouseEnter={() => {
          setOpen(true);
          place();
        }}
        onMouseLeave={() => {
          setOpen(false);
          setPos(null);
        }}
      >
        H3
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
                H3 优化提示词
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

/** 多项费用合并为一条悬停文案（提示词优化 + 出片） */
function combineDramaYuanbaoHoverLabel(
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
  return n > 1 ? `优化+出片 · ${cost}${unit}` : `${cost}${unit}`;
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

/** 本镜成片：画布表 ready 为真源；重新生成中不展示旧片（仅进度遮罩） */
function resolveDramaShotBoardVideo(
  shot: { video_url?: string; video_status?: string; video_node_id?: string; shot_no?: string },
  pipeline: DirectorPipelineState,
): { videoUrl: string; videoStatus: string } {
  const ownUrl = String(shot.video_url || '').trim();
  const ownStatus = String(shot.video_status || '').trim();
  const sb = getDirectorShotStoryboard(pipeline, String(shot.shot_no || '').trim());
  const sbUrl = String(sb.videoUrl || '').trim();
  const sbStatus = String(sb.videoStatus || '').trim();

  const isGenerating =
    ownStatus === 'generating' ||
    ownStatus === 'queued' ||
    sbStatus === 'generating' ||
    sbStatus === 'queued';

  if (isGenerating) {
    return { videoUrl: '', videoStatus: 'generating' };
  }

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
  const waiting =
    ownStatus === 'generating' ||
    ownStatus === 'queued' ||
    sbStatus === 'generating' ||
    sbStatus === 'queued';

  if (waiting) {
    return { videoUrl: '', videoStatus: 'generating' };
  }
  if (sbUrl) {
    return { videoUrl: sbUrl, videoStatus: sbStatus || 'ready' };
  }
  if (ownUrl) {
    return { videoUrl: ownUrl, videoStatus: ownStatus || 'ready' };
  }
  return {
    videoUrl: '',
    videoStatus: ownStatus || sbStatus || 'pending',
  };
}

/**
 * 成片预览：挂载窗内（最多 3 镜）常驻 video 拉首帧；悬停有声播放；移开暂停静音。
 * 窗外不挂 video，仅 poster / 占位，防多路解码 OOM。
 */
function DramaShotVideoPreview({
  playableUrl,
  posterHint,
  generating,
  mountVideo = false,
}: {
  playableUrl: string;
  posterHint?: string;
  isDark: boolean;
  generating: boolean;
  /** 挂载窗内的镜：常驻 video 出首帧（约 3 路） */
  mountVideo?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hoveringRef = useRef(false);
  const [hovering, setHovering] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const poster = toDisplayableDramaMediaUrl(String(posterHint || '').trim());
  const shouldMountVideo = !!playableUrl && (mountVideo || hovering);
  const shouldPlay = !!playableUrl && hovering;

  useEffect(() => {
    setHovering(false);
    setFrameReady(false);
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
    if (!shouldPlay) {
      v.muted = true;
      v.pause();
      if (!mountVideo) {
        try {
          if (v.currentTime > 0.05) v.currentTime = 0;
        } catch {
          /* ignore */
        }
      }
      return;
    }
    v.muted = false;
    v.volume = 1;
    const start = () => {
      void v.play().catch(() => {
        // 个别环境仍拦有声自动播：回退静音至少能出画
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
  }, [shouldMountVideo, shouldPlay, mountVideo, playableUrl]);

  if (!playableUrl) return null;

  const showPosterUnder = !frameReady && !!poster && !shouldPlay;
  const showPlayHint = !hovering && (!mountVideo || !frameReady);

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
      {showPosterUnder ? (
        <img
          src={poster}
          alt=""
          className="absolute inset-0 h-full w-full object-contain"
          draggable={false}
        />
      ) : null}
      {!frameReady && !poster && !mountVideo ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-[12px] text-white/70">
          悬停预览成片
        </div>
      ) : null}
      {shouldMountVideo ? (
        <video
          ref={videoRef}
          key={playableUrl}
          src={playableUrl}
          className="absolute inset-0 h-full w-full object-contain"
          controls={false}
          muted={!hovering}
          playsInline
          loop
          preload="auto"
          draggable={false}
          onLoadedData={() => setFrameReady(true)}
          onCanPlay={() => {
            setFrameReady(true);
            if (hoveringRef.current) {
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
      ) : null}
      {showPlayHint ? (
        <div
          className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center"
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
}

/** 分镜卡右侧：单镜视频生成槽（可选手动视频模型 + 按模型挡位向上取整） */
function DramaShotVideoSlot({
  shot,
  session,
  pipeline,
  isDark,
  busy,
  canGenerate,
  onSpawn,
  onModelChange,
  onAbandonWait,
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
  onAbandonWait?: (shotNo: string) => void;
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
  const tierSec = pickNearestDirectorVideoBatchDuration(model, planSec);
  const boardVideo = resolveDramaShotBoardVideo(shot, pipeline);
  const videoUrl = toDisplayableDramaMediaUrl(boardVideo.videoUrl);
  const playableVideoUrl = videoUrl ? toElectronVideoElementSrc(videoUrl) || videoUrl : '';
  const status =
    boardVideo.videoStatus ||
    (videoUrl ? 'ready' : 'pending');
  const videoError = String(shot.video_error || '').trim();
  const ownStatus = String(shot.video_status || '').trim();
  const isGenerating =
    !!forceGenerating ||
    status === 'generating' ||
    status === 'queued' ||
    ownStatus === 'generating' ||
    ownStatus === 'queued';
  const generating = isGenerating;
  const previewPlayableUrl = isGenerating ? '' : playableVideoUrl;
  const planLabel = formatDramaPlanDurationLabel(planSec);
  const showSnap = Number(tierSec) !== planSec && Number(tierSec) !== Math.round(planSec);
  const shotNo = String(shot.shot_no || '').trim();
  const modelMeta = modelOptions.find((m) => m.id === model);
  const checks = dramaShotPreviewChecks(shot);
  const sbImage = String(
    getDirectorShotStoryboard(pipeline, shotNo).imageUrl || shot.storyboard_image_url || '',
  ).trim();

  return (
    <section className="flex h-full min-h-0 flex-col gap-1">
      <div className="flex items-center justify-between gap-1.5">
        <div className="text-[13px] font-semibold text-sky-300/90">视频预览</div>
        <div
          className={`text-[12px] tabular-nums ${mutedCls(isDark)}`}
          title={`规划 ${planLabel}s，模型挡位向上取整为 ${tierSec}s`}
        >
          {showSnap || Number(tierSec) !== Number(planLabel)
            ? `${planLabel}s → ${tierSec}s档`
            : `${tierSec}s档`}
        </div>
      </div>
      <div
        className={`relative min-h-[16rem] w-full flex-1 overflow-hidden rounded-lg ${
          isDark ? 'bg-black/45 ring-1 ring-white/10' : 'bg-gray-100 ring-1 ring-gray-200'
        }`}
      >
        <DramaShotVideoPreview
          playableUrl={previewPlayableUrl}
          posterHint={isGenerating ? '' : sbImage}
          isDark={isDark}
          generating={generating}
          mountVideo={mountVideo && !isGenerating}
        />
        <ModuleProgressBar
          visible={generating}
          progress={generating ? 35 : 0}
          solidBackground={isDark ? '#1C1C1E' : '#e5e7eb'}
          progressMessage={progressMessage || '正在生成视频...'}
          borderRadius={8}
        />
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
      </div>
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
      <div className="relative flex flex-col gap-1">
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
                ? '请先完成本镜提示词优化，再生成视频'
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
            className={`nodrag w-full rounded-md px-2 py-1 text-[14px] ${
              isDark ? 'bg-white/10 text-white/80' : 'bg-gray-100 text-gray-700'
            }`}
            title="仅取消本地等待与绿条；已发出的任务无法撤回，费用不退"
            onClick={() => onAbandonWait?.(shotNo)}
          >
            放弃等待
          </button>
        ) : null}
      </div>
    </section>
  );
}

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
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const unmountTimerRef = useRef(0);
  const [visible, setVisible] = useState(!!force);

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
    const applyHit = (hit: boolean) => {
      if (hit) {
        if (unmountTimerRef.current) {
          window.clearTimeout(unmountTimerRef.current);
          unmountTimerRef.current = 0;
        }
        setVisible(true);
        return;
      }
      if (unmountTimerRef.current) window.clearTimeout(unmountTimerRef.current);
      unmountTimerRef.current = window.setTimeout(() => {
        unmountTimerRef.current = 0;
        setVisible(false);
      }, 160);
    };
    const measure = () => {
      raf = 0;
      if (!ref.current) return;
      applyHit(isElementInScrollViewport(ref.current, scrollRoot, viewportMarginPx));
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
              applyHit(hit);
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
      {visible ? children : placeholder}
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
  videoGeneratingIds,
  onMarkVideoGenerating,
  onAbandonVideoWait,
  onConfirmBoard,
  onUnlockBoard,
  onNext,
  runChat,
  showAlert,
  onGenerateShotAudio,
  onAbandonShotAudio,
  unitVoicePriceLabel,
}: {
  session: DramaDirectorSession;
  pipeline: DirectorPipelineState;
  isDark: boolean;
  busy: boolean;
  variant?: 'board' | 'videos';
  onChange: (
    s: DramaDirectorSession,
    opts?: { storyboardsByShotNo?: DirectorPipelineState['storyboardsByShotNo'] },
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
  }) => void;
  getShotVideoPriceLabel?: (
    durationSec: number,
    opts?: { model?: string; preferLipsync?: boolean },
  ) => string | null;
  /** 提示词优化 LLM 单次悬停价 */
  unitChatPriceLabel?: string | null;
  videoGeneratingIds?: Record<string, true>;
  onMarkVideoGenerating?: (shotNo: string, on: boolean) => void;
  onAbandonVideoWait?: (shotNo: string) => void;
  onConfirmBoard: () => void;
  onUnlockBoard: () => void;
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
}) {
  const { locale } = useAppLocale();
  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState('');
  const [h3Optimizing, setH3Optimizing] = useState(false);
  const [h3Progress, setH3Progress] = useState('');
  const [selectedShotIds, setSelectedShotIds] = useState<Record<string, true>>({});
  const [mergingShots, setMergingShots] = useState(false);
  const [mergeProgress, setMergeProgress] = useState('');
  const [focusShotId, setFocusShotId] = useState('');
  const [activeEventId, setActiveEventId] = useState('');
  const [promptEditorShotId, setPromptEditorShotId] = useState('');
  const [promptEditorTab, setPromptEditorTab] = useState<'cut' | 'compiled'>('cut');
  const [promptEditorAutoSkill, setPromptEditorAutoSkill] = useState(false);
  /** 合并按钮：优化成功后自动出片 */
  const [pendingGenAfterSkillId, setPendingGenAfterSkillId] = useState('');
  /** 卡面「优化并生成」直跑中的镜 id 集合（可多镜并行） */
  const [inlineOptimizeIds, setInlineOptimizeIds] = useState<Record<string, true>>({});
  const [inlineOptimizeQueue, setInlineOptimizeQueue] = useState<
    Record<string, import('../../utils/directorConcurrentChatQueue').DirectorConcurrentChatQueueStatus>
  >({});
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
    skill?: { final: string; source: string; draft: string },
  ) => {
    let working: DramaDirectorSession = {
      ...session,
      shots: (session.shots || []).map((s, i) =>
        i === plan.targetIndex
          ? ensureDramaShotTimelineEvents({
              ...s,
              ...plan.patch,
              ...(skill
                ? {
                    h3_skill_prompt: skill.final,
                    h3_skill_prompt_from: skill.source || skill.draft.slice(0, 200),
                    last_compiled_prompt: skill.source || String(plan.patch.last_compiled_prompt || ''),
                    confirmed_at: Date.now(),
                    needs_review: false,
                  }
                : {}),
            })
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
    if (busy || enriching || h3Optimizing || mergingShots) return;
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
        `· 随后调用大模型整合为单镜提示词\n` +
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
      setMergeProgress('大模型整合提示词…');
      const skill = await runDramaMultiShotH3SkillMerge({
        session,
        sourceShots,
        mergedShot: plan.mergedShot,
        runChat,
        locale: locale === 'en' ? 'en' : 'zh-CN',
      });
      const reportPreview = String(skill.report || '').trim().slice(0, 900);
      const adopt = await showConfirm(
        `整合完成。${reportPreview ? `\n\n整合报告：\n${reportPreview}` : ''}\n\n确认写入镜头${targetNo}并删除其余所选镜头？`,
      );
      if (!adopt) return;
      commitMergedShots(plan, skill);
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
  const h3ReadyCount = shots.filter(
    (s) =>
      !!s.directing_enhance_revision?.accepted ||
      (s.performance_plan || []).some((b) => b.source === 'llm_enhanced'),
  ).length;

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

  const handleEnrich = async (useLlm: boolean) => {
    if (enriching || h3Optimizing || busy) return;
    setEnriching(true);
    setEnrichProgress('');
    try {
      let next = enrichAllDramaShotsLocally(session);
      if (useLlm) {
        const targets = (next.shots || []).filter((s) => !(Number(s.confirmed_at) > 0));
        const batchSize = Math.max(1, DRAMA_BOARD_ENRICH_BATCH);
        let failBatches = 0;
        for (let i = 0; i < targets.length; i += batchSize) {
          const batch = targets.slice(i, i + batchSize);
          const done = Math.min(i + batch.length, targets.length);
          setEnrichProgress(`${done}/${targets.length}`);
          const { systemPrompt, userPrompt } = buildDramaBoardEnrichMessages(next, {
            shotIds: batch.map((s) => s.shot_id),
          });
          try {
            const text = await runChat(systemPrompt, userPrompt, {
              max_tokens: 16384,
              temperature: 0.5,
            });
            next = applyDramaBoardEnrichResult(next, text);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            // 截断时拆成更小批重试本批
            if (/截断|finish_reason=length|max_tokens/i.test(msg) && batch.length > 1) {
              for (const shot of batch) {
                setEnrichProgress(`${done}/${targets.length} · 重试镜${shot.shot_no || ''}`);
                try {
                  const retry = buildDramaBoardEnrichMessages(next, {
                    shotIds: [shot.shot_id],
                  });
                  const text = await runChat(retry.systemPrompt, retry.userPrompt, {
                    max_tokens: 8192,
                    temperature: 0.45,
                  });
                  next = applyDramaBoardEnrichResult(next, text);
                } catch {
                  failBatches += 1;
                }
              }
            } else {
              failBatches += 1;
              if (i === 0 && targets.length === batch.length) throw e;
            }
          }
        }
        if (failBatches && failBatches >= Math.ceil(targets.length / batchSize)) {
          throw new Error('导演脚本补全失败：多批输出被截断或模型异常，请稍后重试或换模型');
        }
      }
      const dirty = listDirtyDirectingShotIds(next);
      next = applyDramaDirectingBreakdownSession(next, dirty.length ? { shotIds: dirty } : undefined);
      if (useLlm) {
        const llmByShotId: Record<
          string,
          NonNullable<ReturnType<typeof parseDramaDirectingBreakdownLlm>>
        > = {};
        for (let i = 0; i < next.shots.length; i += 1) {
          const shot = next.shots[i];
          if (Number(shot.confirmed_at) > 0) continue;
          const fp = dramaShotDirectingFingerprint(shot);
          if (
            shot.directing_breakdown?.sourceFingerprint === fp &&
            shot.directing_breakdown.beats?.length &&
            shot.directing_breakdown.source === 'llm'
          ) {
            continue;
          }
          try {
            setEnrichProgress(`拆戏 ${i + 1}/${next.shots.length}`);
            const msgs = buildDramaDirectingBreakdownMessages(
              next,
              shot,
              i > 0 ? next.shots[i - 1] : null,
            );
            const raw = await runChat(msgs.systemPrompt, msgs.userPrompt, {
              max_tokens: 4096,
              temperature: 0.35,
            });
            const parsed = parseDramaDirectingBreakdownLlm(raw, shot.shot_id);
            if (parsed) llmByShotId[shot.shot_id] = parsed;
          } catch {
            /* 单镜拆戏失败不阻断 */
          }
        }
        const ids = Object.keys(llmByShotId);
        if (ids.length) {
          next = applyDramaDirectingBreakdownSession(next, {
            force: true,
            shotIds: ids,
            llmByShotId,
          });
        }
      }
      onChange(refreshDramaContinuity(next));
      showAlert(
        useLlm
          ? `已补全 ${next.shots.length} 镜导演拆戏与时间轴（未覆盖已确认镜头）`
          : `已按规则估算 ${next.shots.length} 镜时长、拆戏与时间轴`,
      );
    } catch (e) {
      onChange(enrichAllDramaShotsLocally(session));
      showAlert(e instanceof Error ? e.message : String(e));
    } finally {
      setEnriching(false);
      setEnrichProgress('');
    }
  };

  const handleH3Optimize = async (_thenGoAssets = false) => {
    if (enriching || h3Optimizing || busy || !shots.length) return;
    if (missingDesign.length) {
      showAlert(
        `还有 ${missingDesign.length} 个出场人物未设计形象，请先回「资产生成」完成后再做 H3 提示词优化。`,
      );
      return;
    }
    setH3Optimizing(true);
    setH3Progress(`0/${shots.length}`);
    try {
      let working = enrichAllDramaShotsLocally(session);
      let ok = 0;
      let fail = 0;
      let warnN = 0;
      const nextShots = [...working.shots];
      for (let i = 0; i < nextShots.length; i++) {
        const shot = enrichDramaShotLocally(working, nextShots[i]);
        setH3Progress(`${i + 1}/${nextShots.length}`);
        try {
          const { systemPrompt, userPrompt } = buildDramaShotH3OptimizeMessages(working, shot);
          const raw = await runChat(systemPrompt, userPrompt, {
            max_tokens: 4096,
            temperature: 0.4,
          });
          const { patch, blocked } = parseDramaDirectingEnhancePatch(raw, shot.shot_id);
          if (!(patch.performance_plan?.length || patch.directing_enhance)) {
            fail += 1;
            nextShots[i] = shot;
            continue;
          }
          const applied = applyDramaDirectingEnhancePatch(shot, patch, blocked);
          if (applied.revision.blocked.length) warnN += 1;
          const hasDlg = dramaShotHasSpokenDialogue(applied.shot);
          const model = resolveDramaShotVideoModel(
            applied.shot.model_params,
            working.meta.videoBatchModel,
            {
              hasDialogue: hasDlg,
              hasShotAudio: !!String(applied.shot.audio_url || '').trim(),
            },
          );
          const mode = dramaVideoModelRequiresShotAudio(model) ? 'h3-audio' : 'h3-multi';
          const compiled = compileDramaShotVideoRequest(working, applied.shot, {
            mode,
            model,
            locale,
          });
          nextShots[i] = {
            ...applied.shot,
            last_compiled_prompt: compiled.prompt,
          };
          ok += 1;
        } catch {
          fail += 1;
          nextShots[i] = shot;
        }
      }
      working = refreshDramaPackages({
        ...working,
        shots: nextShots,
      });
      onChange(refreshDramaContinuity(working));
      showAlert(
        fail
          ? `H3 导演增强完成：成功 ${ok} 镜，失败 ${fail} 镜${warnN ? `，${warnN} 镜有字段被丢弃` : ''}`
          : `H3 导演增强完成：${ok} 镜已写入表演层（未覆盖 final_prompt）${
              warnN ? `，${warnN} 镜有禁止字段被丢弃` : ''
            }`,
      );
    } catch (e) {
      showAlert(e instanceof Error ? e.message : String(e));
    } finally {
      setH3Optimizing(false);
      setH3Progress('');
    }
  };

  const handleRevertH3Enhance = () => {
    if (enriching || h3Optimizing || busy || !shots.length) return;
    const nextShots = shots.map((s) =>
      s.directing_enhance_revision?.accepted ? revertDramaDirectingEnhance(s) : s,
    );
    onChange(
      refreshDramaPackages({
        ...session,
        shots: nextShots,
      }),
    );
    showAlert('已撤销本集最近一次 H3 导演增强，表演层已恢复');
  };

  const handleGoAssets = () => {
    onConfirmBoard();
  };

  const videoModel = normalizeDramaSupportedVideoModel(
    session.meta.videoBatchModel || 'minimax-h3-multi',
  );
  const boardConfirmed = isDramaBoardConfirmed(session);
  const videoGenEnabled = variant === 'videos' || boardConfirmed;
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

  const setShotVideoModel = (shotNo: string, raw: string) => {
    const no = String(shotNo || '').trim();
    if (!no) return;
    const nextModel = normalizeDramaSupportedVideoModel(raw);
    onChange(
      createEmptyDramaSession({
        ...session,
        shots: session.shots.map((s) =>
          String(s.shot_no || '').trim() === no
            ? {
                ...s,
                model_params: { ...(s.model_params || {}), video_model: nextModel },
              }
            : s,
        ),
      }),
    );
  };

  const patchShotById = (shotId: string, patch: Partial<DramaShot>) => {
    const id = String(shotId || '').trim();
    if (!id) return;
    const base = sessionRef.current;
    const before = base.shots.find((s) => s.shot_id === id);
    const nextShots = base.shots.map((s) => (s.shot_id === id ? { ...s, ...patch } : s));
    // 热路径：禁止 createEmptyDramaSession 重扫全部分镜（输入/点选会卡）
    let next: DramaDirectorSession = { ...base, shots: nextShots };
    const after = nextShots.find((s) => s.shot_id === id);
    if (
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
    onChange(next);
  };

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
    if (busy || enriching || h3Optimizing) return;
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
    if (busy || enriching || h3Optimizing) return;
    commitShotListEdit(insertDramaShotAt(session, atIndex), {
      type: 'insert',
      index: atIndex,
    });
  };

  const applyShotDurationSec = (shot: DramaShot, nextSec: number) => {
    const dur = snapDramaShotDurationSec(nextSec);
    const stored = Number(shot.duration_sec);
    const lastEnd = Math.max(
      0,
      ...(Array.isArray(shot.timeline_events) ? shot.timeline_events : []).map(
        (e) => Number(e.end_sec) || 0,
      ),
    );
    const prev = lastEnd > 0.1 ? lastEnd : Number.isFinite(stored) && stored > 0 ? stored : dur;
    if (Math.abs(prev - dur) < 1e-6 && Math.abs((Number.isFinite(stored) ? stored : dur) - dur) < 1e-6) {
      return;
    }
    const scaled = rescaleDramaTimelineEventsToDuration(shot.timeline_events, prev, dur);
    const nextShot = ensureDramaShotTimelineEvents({
      ...shot,
      duration_sec: dur,
      timeline_events: scaled,
    });
    patchShotById(shot.shot_id, {
      duration_sec: nextShot.duration_sec,
      timeline_events: nextShot.timeline_events,
      timeline_beats: nextShot.timeline_beats,
      audio_timeline: deriveDramaAudioTimelineFromShotEvents(session, nextShot.timeline_events),
    });
  };

  const spawnOneShot = (shotNo: string, pickedModel?: string, opts?: { skipOptimizeGate?: boolean }) => {
    const no = String(shotNo || '').trim();
    if (!no) return;
    const shot = shots.find((s) => String(s.shot_no || '').trim() === no);
    const hasOptimized = !!String(shot?.h3_skill_prompt || '').trim();
    if (!hasOptimized && !opts?.skipOptimizeGate) {
      showAlert('请先完成本镜「提示词优化」，再生成视频');
      setPromptEditorShotId(String(shot?.shot_id || '').trim());
      setPromptEditorTab('compiled');
      setPromptEditorAutoSkill(true);
      return;
    }
    if (!videoGenEnabled && variant === 'videos') {
      showAlert('请先确认导演表，再生成视频');
      return;
    }
    if (videoGeneratingIds?.[no]) {
      showAlert('本镜正在生成中，请等待完成或点「放弃等待」');
      return;
    }
    if (shot) {
      const synced = syncDramaShotCharacterIds(session, shot);
      if (
        (synced.character_ids || []).join(',') !== (shot.character_ids || []).join(',')
      ) {
        patchShotById(shot.shot_id, { character_ids: synced.character_ids });
      }
      const castErr = formatDramaShotCastGateError(session, synced);
      if (castErr) {
        showAlert(castErr);
        return;
      }
    }
    const hasDlg = shot ? dramaShotHasSpokenDialogue(shot) : false;
    const hasAudio = !!String(shot?.audio_url || '').trim();
    const videoModelForShot = normalizeDramaSupportedVideoModel(
      pickedModel ||
        resolveDramaShotVideoModel(shot?.model_params, session.meta.videoBatchModel, {
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
    let next = refreshDramaPackages(sessionRef.current, videoModelForShot);
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
    onSpawnVideos?.(
      useLipsync
        ? {
            shotNos: [no],
            startLipsync: true,
            lipsyncShotNos: [no],
            videoModel: videoModelForShot,
            shotModels: { [no]: videoModelForShot },
          }
        : {
            shotNos: [no],
            videoModel: videoModelForShot,
            shotModels: { [no]: videoModelForShot },
          },
    );
  };

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
      const dur = snapDramaShotDurationSec(Number(s.duration_sec) || 10);
      const model = resolveDramaShotVideoModel(s.model_params, session.meta.videoBatchModel, {
        hasDialogue: dramaShotHasSpokenDialogue(s),
        hasShotAudio: !!String(s.audio_url || '').trim(),
      });
      return getShotVideoPriceLabel?.(dur, {
        model,
        preferLipsync: dramaVideoModelRequiresShotAudio(model),
      });
    }),
  );
  const allRerunBatchPriceLabel = sumDramaYuanbaoHoverLabel(
    allRerunVideoShots.map((s) => {
      const dur = snapDramaShotDurationSec(Number(s.duration_sec) || 10);
      const model = resolveDramaShotVideoModel(s.model_params, session.meta.videoBatchModel, {
        hasDialogue: dramaShotHasSpokenDialogue(s),
        hasShotAudio: !!String(s.audio_url || '').trim(),
      });
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
  const busyVideoCount = shots.filter((s) =>
    videoGeneratingIds?.[String(s.shot_no || '').trim()],
  ).length;

  const spawnAllShots = (mode: 'missing' | 'all' = 'missing') => {
    if (!videoGenEnabled) {
      showAlert('请先确认导演表，再生成视频');
      return;
    }
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
      showAlert(
        `以下镜头未标明空镜却缺出场人物/人物素材，请先补齐再生成：\n${castBlocked.slice(0, 6).join('\n')}${
          castBlocked.length > 6 ? `\n…另有 ${castBlocked.length - 6} 镜` : ''
        }`,
      );
      return;
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
    let next = refreshDramaPackages(session, videoModel);
    for (const pkg of Object.values(next.packages || {})) {
      const adapter = getDramaVideoAdapter(pkg.adapter_id);
      if (!adapter) continue;
      try {
        const shot = next.shots.find((s) => s.shot_id === pkg.shot_id);
        if (!shot) continue;
        const no = String(shot.shot_no || '').trim();
        if (!targetNos.has(no)) continue;
        const m = normalizeDramaSupportedVideoModel(shotModels[no] || videoModel);
        const tier = Number(
          pickNearestDirectorVideoBatchDuration(m, Number(shot.duration_sec) || 5),
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
    onSpawnVideos?.(
      lipsyncNos.length
        ? {
            shotNos: shotNoList,
            startLipsync: true,
            lipsyncShotNos: lipsyncNos,
            videoModel,
            shotModels,
          }
        : { shotNos: shotNoList, videoModel, shotModels },
    );
  };

  const runOptimizeAndGenerate = async (raw: DramaShot) => {
    const live = sessionRef.current;
    const enriched = enrichDramaShotLocally(live, raw);
    const no = String(enriched.shot_no || '').trim();
    const shotId = String(enriched.shot_id || '').trim();
    if (!no || !shotId) return;
    if (inlineOptimizeIds[shotId] || videoGeneratingIds?.[no]) return;
    const hasOptimized = !!String(enriched.h3_skill_prompt || '').trim();
    if (hasOptimized) {
      spawnOneShot(no);
      return;
    }
    // 一点即亮绿条：优化阶段也算「生成中」，避免预览区仍停在静帧
    onMarkVideoGenerating?.(no, true);
    const base = sessionRef.current;
    onChange({
      ...base,
      shots: (base.shots || []).map((s) =>
        s.shot_id === shotId
          ? { ...s, video_status: 'generating', video_error: '' }
          : s,
      ),
    });
    setInlineOptimizeIds((prev) => ({ ...prev, [shotId]: true }));
    setInlineOptimizeQueue((prev) => {
      if (!prev[shotId]) return prev;
      const next = { ...prev };
      delete next[shotId];
      return next;
    });
    try {
      const result = await runDramaShotH3SkillOptimize({
        session: sessionRef.current,
        shot: enrichDramaShotLocally(sessionRef.current, raw),
        runChat,
        locale: locale === 'en' ? 'en' : 'zh-CN',
        onQueueStatus: (st) => {
          setInlineOptimizeQueue((prev) => ({ ...prev, [shotId]: st }));
        },
      });
      patchShotById(shotId, {
        last_compiled_prompt: result.source || String(enriched.last_compiled_prompt || ''),
        h3_skill_prompt: result.final,
        h3_skill_prompt_from: result.source || result.draft.slice(0, 200),
        confirmed_at: Number(enriched.confirmed_at) > 0 ? enriched.confirmed_at : Date.now(),
        needs_review: false,
        video_status: 'generating',
      });
      window.setTimeout(() => {
        spawnOneShot(no, undefined, { skipOptimizeGate: true });
      }, 80);
    } catch (e) {
      const errMsg = formatCloudLlmUserError(e) || '提示词优化失败';
      onMarkVideoGenerating?.(no, false);
      patchShotById(shotId, {
        video_status: String(enriched.video_url || '').trim() ? 'ready' : 'error',
        video_error: errMsg,
      });
      showAlert(errMsg);
    } finally {
      setInlineOptimizeQueue((prev) => {
        if (!prev[shotId]) return prev;
        const next = { ...prev };
        delete next[shotId];
        return next;
      });
      setInlineOptimizeIds((prev) => {
        if (!prev[shotId]) return prev;
        const next = { ...prev };
        delete next[shotId];
        return next;
      });
    }
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
    const s = raw;
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
    const hasOptimized = !!String(s.h3_skill_prompt || '').trim();
    const canGenThis = hasOptimized;
    const fill = !!opts?.fill;
    const shotIndex = Number.isFinite(opts?.index) ? Number(opts?.index) : -1;
    const inWindow = opts?.inWindow === true;
    const mountVideo = opts?.mountVideo ?? inWindow;
    const mediaActive = opts?.mediaActive ?? inWindow;
    const boardVideoForCard = resolveDramaShotBoardVideo(s, pipeline);
    const shotNoForCard = String(s.shot_no || '').trim();
    const isVideoGenerating =
      !!videoGeneratingIds?.[shotNoForCard] ||
      !!inlineOptimizeIds[s.shot_id] ||
      s.video_status === 'generating' ||
      s.video_status === 'queued' ||
      boardVideoForCard.videoStatus === 'generating' ||
      boardVideoForCard.videoStatus === 'queued';
    const generating = isVideoGenerating;
    const optimizingOnly =
      !!inlineOptimizeIds[s.shot_id] && !videoGeneratingIds?.[shotNoForCard];
    const optimizeQueue = inlineOptimizeQueue[s.shot_id];
    const optimizeWaiting = optimizeQueue?.phase === 'waiting';
    const plan = Number(s.duration_sec) || 0;
    const shotModel = resolveDramaShotVideoModel(s.model_params, session.meta.videoBatchModel, {
      hasDialogue: dramaShotHasSpokenDialogue(s),
      hasShotAudio: !!String(s.audio_url || '').trim(),
    });
    const durationTiers = (() => {
      const listed = listDirectorVideoDurationTiersSec(shotModel);
      return listed.length > 0 ? listed : [...DRAMA_SHOT_DURATION_TIERS];
    })();
    const durShown = snapDramaShotDurationSec(plan || 10);
    const priceLabel = getShotVideoPriceLabel?.(durShown, {
      model: shotModel,
      preferLipsync: shotModel === 'minimax-h3-audio',
    });
    const mergedActionPrice = hasOptimized
      ? priceLabel
      : combineDramaYuanbaoHoverLabel([unitChatPriceLabel, priceLabel]) ||
        priceLabel ||
        unitChatPriceLabel ||
        null;
    const openPromptEditor = (opts?: { tab?: 'cut' | 'compiled'; autoSkill?: boolean }) => {
      setPromptEditorShotId(s.shot_id);
      setPromptEditorTab(opts?.tab || 'cut');
      setPromptEditorAutoSkill(!!opts?.autoSkill);
    };

    return (
      <DramaViewportMount
        scrollRoot={shotListScrollEl}
        force={!!fill || s.shot_id === focusShotId}
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
                progressMessage={
                  optimizeWaiting
                    ? `镜头${String(s.shot_no || '').padStart(2, '0')} · 等待中（${optimizeQueue!.position}/${optimizeQueue!.total}）`
                    : optimizingOnly
                      ? `镜头${String(s.shot_no || '').padStart(2, '0')} · 优化提示词中…`
                      : `镜头${String(s.shot_no || '').padStart(2, '0')} · 正在生成视频…`
                }
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
              disabled={busy || enriching || h3Optimizing || mergingShots || generating}
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
              disabled={busy || enriching || h3Optimizing || generating}
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
              disabled={busy || enriching || h3Optimizing || generating}
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
              disabled={busy || enriching || h3Optimizing || generating || shots.length <= 1}
              onClick={(e) => {
                e.stopPropagation();
                void handleDeleteShotAt(Math.max(0, shotIndex));
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <div
            className="inline-flex items-center rounded-full bg-sky-500/20 p-0.5 text-[13px] font-medium tabular-nums text-sky-200"
            title="本镜时长：按当前模型支持的档位出片（MiniMax H3 为 6 / 10 / 15 / 20 秒）"
          >
            {durationTiers.map((sec) => {
              const selected = durShown === sec;
              return (
                <button
                  key={sec}
                  type="button"
                  disabled={busy || enriching || h3Optimizing || generating}
                  className={`nodrag rounded-full px-2 py-0.5 disabled:opacity-45 ${
                    selected
                      ? 'bg-sky-500/85 text-white'
                      : 'text-sky-200/80 hover:bg-sky-500/25 hover:text-white'
                  }`}
                  aria-pressed={selected}
                  onClick={(e) => {
                    e.stopPropagation();
                    applyShotDurationSec(raw, sec);
                  }}
                >
                  {sec}s
                </button>
              );
            })}
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
                title={sug.duration_why || '分镜脚本规划时长（小数秒；出片仍用左侧档位）'}
              >
                规划{Number(sug.duration_sec) > 0 ? Number(sug.duration_sec).toFixed(1) : ai.toFixed(1)}s
                {hasBand ? ` · ${lo.toFixed(1)}–${hi.toFixed(1)}` : ''}
              </div>
            );
          })()}
          {hasOptimized ? (
            <div className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[13px] text-violet-200">
              提示词已优化
            </div>
          ) : shotConfirmed ? (
            <div className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[13px] text-emerald-200">
              已确认本镜
            </div>
          ) : null}
          {String(s.last_compiled_prompt || '').trim() ? (
            <H3PromptHoverBadge prompt={String(s.last_compiled_prompt || '')} isDark={isDark} />
          ) : null}
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
              busy={busy || enriching || h3Optimizing}
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
              busy={busy || enriching || h3Optimizing}
              timeline={timeline}
              nameById={nameById}
              onRequestOpenEditor={openPromptEditor}
              onPatchShot={(patch) => patchShotById(s.shot_id, patch)}
              onPatchTimeline={(nextEvents) => {
                const nextShot = ensureDramaShotTimelineEvents({
                  ...s,
                  timeline_events: nextEvents,
                });
                patchShotById(s.shot_id, {
                  timeline_events: nextShot.timeline_events,
                  timeline_beats: nextShot.timeline_beats,
                  audio_timeline: deriveDramaAudioTimelineFromShotEvents(
                    session,
                    nextShot.timeline_events,
                  ),
                  h3_skill_prompt: '',
                  h3_skill_prompt_from: '',
                });
              }}
            />
          </div>

          <div className="flex h-full min-h-0 min-w-0 flex-col gap-1.5">
            <div className="min-h-0 min-w-0 flex-1">
              <DramaShotVideoSlot
                shot={s}
                session={session}
                pipeline={pipeline}
                isDark={isDark}
                busy={busy || enriching || h3Optimizing}
                canGenerate={canGenThis}
                onSpawn={spawnOneShot}
                onModelChange={setShotVideoModel}
                onAbandonWait={onAbandonVideoWait}
                priceLabel={priceLabel}
                forceGenerating={generating}
                progressMessage={
                  optimizeWaiting
                    ? `等待中（${optimizeQueue.position}/${optimizeQueue.total}）…`
                    : optimizingOnly
                      ? '正在优化提示词...'
                      : '正在生成视频...'
                }
                hideGenerate={variant === 'board'}
                mountVideo={mountVideo}
              />
            </div>
            {variant === 'board' ? (
              <div className="flex shrink-0 flex-wrap items-stretch gap-1.5">
                <button
                  type="button"
                  className={`nodrag min-w-0 flex-1 rounded-lg px-2 py-1.5 text-[13px] font-medium ${
                    isDark
                      ? 'bg-amber-400/90 text-black hover:bg-amber-400'
                      : 'bg-amber-500 text-white hover:bg-amber-600'
                  }`}
                  title="在弹窗中修改切段与整镜编译稿"
                  disabled={enriching || h3Optimizing || generating}
                  onClick={() => openPromptEditor({ tab: 'cut' })}
                >
                  提示词修改
                </button>
                <DramaYuanbaoHoverWrap
                  tipBelow
                  className="min-w-0 flex-1"
                  priceLabel={
                    !generating && !inlineOptimizeIds[s.shot_id] ? mergedActionPrice : null
                  }
                >
                  <button
                    type="button"
                    className={`nodrag w-full rounded-lg px-2 py-1.5 text-[13px] font-medium disabled:opacity-45 ${
                      isDark
                        ? 'bg-sky-500/85 text-white hover:bg-sky-500'
                        : 'bg-gray-900 text-white'
                    }`}
                    disabled={
                      generating ||
                      enriching ||
                      h3Optimizing ||
                      !!inlineOptimizeIds[s.shot_id]
                    }
                    title={
                      generating || inlineOptimizeIds[s.shot_id]
                        ? '处理中'
                        : hasOptimized
                          ? '使用已优化提示词生成本镜视频'
                          : '一点即跑：提示词优化后自动出片（费用含优化+出片）'
                    }
                    onClick={() => void runOptimizeAndGenerate(raw)}
                  >
                    {generating
                      ? optimizeWaiting
                        ? `等待中（${optimizeQueue!.position}/${optimizeQueue!.total}）`
                        : optimizingOnly
                          ? '优化中…'
                          : '生成中…'
                      : hasOptimized
                          ? formatDramaVideoGenButtonLabel({
                              hasVideo: !!s.video_url,
                              durationSec: durShown,
                            })
                          : `优化并生成 · ${Math.round(durShown) || 6}s`}
                  </button>
                </DramaYuanbaoHoverWrap>
              </div>
            ) : null}
          </div>
        </div>
      </article>
      </DramaViewportMount>
    );
  };

  const editorShotRaw = promptEditorShotId
    ? shots.find((x) => x.shot_id === promptEditorShotId) || null
    : null;
  const editorShotEnriched = editorShotRaw
    ? enrichDramaShotLocally(session, editorShotRaw)
    : null;
  const editorTimeline = editorShotEnriched?.timeline_events?.length
    ? editorShotEnriched.timeline_events
    : [];
  const editorNameById = (() => {
    const map = new Map(
      (session.bible.characters || []).map((c) => [c.character_id, c.name] as const),
    );
    if (editorShotEnriched) {
      for (const c of resolveBoardShotCharacters(session, editorShotEnriched)) {
        if (c.character_id) map.set(c.character_id, c.name);
      }
    }
    return map;
  })();

  const promptEditorPortal =
    editorShotEnriched && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="fixed inset-0 z-[100120] flex items-center justify-center p-3"
            onClick={() => {
              setPromptEditorShotId('');
              setPromptEditorAutoSkill(false);
              setPendingGenAfterSkillId('');
            }}
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
                    镜头{String(editorShotEnriched.shot_no || '').padStart(2, '0')} · 提示词编辑
                  </div>
                  <div className={`truncate text-[12px] ${mutedCls(isDark)}`}>
                    {pendingGenAfterSkillId === editorShotEnriched.shot_id
                      ? '优化确认后将自动生成视频'
                      : '切段修改与整镜编译稿都在此窗口'}
                  </div>
                </div>
                <button
                  type="button"
                  className={`nodrag flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[18px] ${
                    isDark ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                  }`}
                  onClick={() => {
                    setPromptEditorShotId('');
                    setPromptEditorAutoSkill(false);
                    setPendingGenAfterSkillId('');
                  }}
                >
                  ×
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden p-3">
                <DramaExecuteTablePanel
                  key={editorShotEnriched.shot_id}
                  session={session}
                  shot={editorShotEnriched}
                  isDark={isDark}
                  timeline={editorTimeline}
                  nameById={editorNameById}
                  activeEventId={activeEventId}
                  onSelectEvent={setActiveEventId}
                  runChat={runChat}
                  showAlert={showAlert}
                  busy={busy || enriching || h3Optimizing}
                  initialTab={promptEditorTab}
                  autoRunSkillOptimize={promptEditorAutoSkill}
                  onAutoRunSkillConsumed={() => setPromptEditorAutoSkill(false)}
                  onPatchTimeline={(nextEvents) => {
                    const nextShot = ensureDramaShotTimelineEvents({
                      ...editorShotEnriched,
                      timeline_events: nextEvents,
                    });
                    patchShotById(editorShotEnriched.shot_id, {
                      timeline_events: nextShot.timeline_events,
                      timeline_beats: nextShot.timeline_beats,
                      audio_timeline: deriveDramaAudioTimelineFromShotEvents(
                        session,
                        nextShot.timeline_events,
                      ),
                      h3_skill_prompt: '',
                      h3_skill_prompt_from: '',
                    });
                  }}
                  onPatchShot={(patch) => {
                    patchShotById(editorShotEnriched.shot_id, patch);
                    const skill = String(patch.h3_skill_prompt || '').trim();
                    if (
                      skill &&
                      pendingGenAfterSkillId === editorShotEnriched.shot_id
                    ) {
                      const no = String(editorShotEnriched.shot_no || '').trim();
                      setPendingGenAfterSkillId('');
                      setPromptEditorShotId('');
                      setPromptEditorAutoSkill(false);
                      window.setTimeout(() => {
                        if (no) spawnOneShot(no);
                      }, 120);
                    }
                  }}
                />
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      {promptEditorPortal}
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
              disabled={busy || enriching || h3Optimizing}
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
              disabled={busy || enriching || h3Optimizing}
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
          {variant === 'videos' ? null : (
            <>
          <button
            type="button"
            disabled={
              mergingShots || enriching || h3Optimizing || busy || selectedShotCount < 2
            }
            className={`nodrag rounded-lg px-3 py-2 text-[16px] font-medium disabled:opacity-45 ${
              isDark ? 'bg-amber-500/85 text-white' : 'bg-amber-600 text-white'
            }`}
            title="勾选至少 2 镜：去重参考图、拼接时间轴，并由大模型整合为单镜提示词"
            onClick={() => void handleMergeSelectedShots()}
          >
            {mergingShots
              ? mergeProgress || '合并镜头中…'
              : selectedShotCount >= 2
                ? `合并所选 ${selectedShotCount} 镜`
                : '合并所选镜头'}
          </button>
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
          <button
            type="button"
            disabled={enriching || h3Optimizing || busy || !shots.length}
            className={`nodrag rounded-lg px-3 py-2 text-[16px] font-medium disabled:opacity-45 ${
              isDark ? 'bg-sky-500/80 text-white' : 'bg-gray-900 text-white'
            }`}
            onClick={() => void handleEnrich(true)}
          >
            {enriching
              ? enrichProgress
                ? `补全中… ${enrichProgress}`
                : '补全中…'
              : '一键补全导演脚本'}
          </button>
          <button
            type="button"
            disabled={enriching || h3Optimizing || busy || !shots.length}
            className={`nodrag rounded-lg px-3 py-2 text-[16px] disabled:opacity-45 ${
              isDark ? 'bg-white/10' : 'bg-gray-100'
            }`}
            onClick={() => void handleEnrich(false)}
          >
            仅规则估算时长
          </button>
          <button
            type="button"
            disabled={enriching || h3Optimizing || busy || !shots.length}
            className={`nodrag rounded-lg px-3 py-2 text-[16px] font-medium disabled:opacity-45 ${
              isDark ? 'bg-violet-500/80 text-white' : 'bg-violet-700 text-white'
            }`}
            title="导演增强：只加细表演/运镜，不覆盖 final_prompt；出片由 Compiler 实时生成"
            onClick={() => void handleH3Optimize(false)}
          >
            {h3Optimizing
              ? `H3优化中 ${h3Progress}`
              : h3ReadyCount === shots.length && shots.length
                ? 'H3提示词已就绪'
                : 'H3提示词优化'}
          </button>
          {shots.some((s) => s.directing_enhance_revision?.accepted) ? (
            <button
              type="button"
              disabled={enriching || h3Optimizing || busy}
              className={`nodrag rounded-lg px-3 py-2 text-[16px] disabled:opacity-45 ${
                isDark ? 'bg-white/10' : 'bg-gray-100'
              }`}
              title="恢复增强前的 PerformancePlan"
              onClick={handleRevertH3Enhance}
            >
              撤销增强
            </button>
          ) : null}
          <button
            type="button"
            disabled={enriching || h3Optimizing || busy || !shots.length}
            className={`nodrag rounded-lg px-3 py-2 text-[16px] font-medium disabled:opacity-45 ${
              isDark ? 'bg-emerald-500/80 text-white' : 'bg-emerald-700 text-white'
            }`}
            onClick={handleGoAssets}
          >
            确认导演表
          </button>
          {boardConfirmed ? (
            <>
              <button
                type="button"
                className={`nodrag rounded-lg px-3 py-2 text-[16px] ${
                  isDark ? 'bg-white/10' : 'bg-gray-100'
                }`}
                onClick={onUnlockBoard}
              >
                解除确认
              </button>
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
                className={`nodrag rounded-lg px-3 py-2 text-[16px] font-medium ${
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
            </>
          ) : null}
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
              disabled={busy || enriching || h3Optimizing}
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
                      disabled={busy || enriching || h3Optimizing}
                      onClick={() => handleInsertShotAt(index)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      在镜头{String(raw.shot_no || '').padStart(2, '0')}上方插入
                    </button>
                  ) : null}
                  {renderShotCard(raw, {
                    index,
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
                    disabled={busy || enriching || h3Optimizing}
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

function dramaFinalCutAspectBoxClass(ratio?: string): string {
  const r = String(ratio || '').trim();
  if (r === '16:9') return 'aspect-[16/9]';
  if (r === '4:3') return 'aspect-[4/3]';
  if (r === '3:4') return 'aspect-[3/4]';
  return 'aspect-[9/16]';
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
  dragging,
  dropTarget,
  hoverDisabled,
  onDragStartShot,
  onDragEndShot,
  onDragOverShot,
  onDropShot,
}: {
  shot: DramaShot;
  index: number;
  isDark: boolean;
  aspectBoxClass: string;
  dragging: boolean;
  dropTarget: boolean;
  hoverDisabled: boolean;
  onDragStartShot: (shotId: string, e: React.DragEvent) => void;
  onDragEndShot: () => void;
  onDragOverShot: (shotId: string, e: React.DragEvent) => void;
  onDropShot: (shotId: string, e: React.DragEvent) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hoverActive, setHoverActive] = useState(false);
  const url = String(shot.video_url || '').trim();
  const playable = url ? toElectronVideoElementSrc(url) || url : '';
  const poster = toDisplayableDramaMediaUrl(
    String(shot.storyboard_image_url || '').trim(),
  );
  const no = String(shot.shot_no || '').trim() || '?';

  const stopHoverPlay = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    try {
      v.currentTime = 0;
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      draggable
      className={`nodrag nowheel relative min-w-0 overflow-hidden cursor-grab active:cursor-grabbing ${cardCls(isDark)} ${
        dragging ? 'opacity-50' : ''
      } ${dropTarget ? 'ring-2 ring-sky-400/80' : ''}`}
      onPointerDown={(e) => e.stopPropagation()}
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
        setHoverActive(true);
        requestAnimationFrame(() => {
          const v = videoRef.current;
          if (!v) return;
          v.muted = false;
          void v.play().catch(() => {
            v.muted = true;
            void v.play().catch(() => undefined);
          });
        });
      }}
      onMouseLeave={() => {
        stopHoverPlay();
        setHoverActive(false);
      }}
    >
      {playable && hoverActive ? (
        <video
          ref={videoRef}
          src={playable}
          className={`w-full bg-black object-contain ${aspectBoxClass}`}
          muted
          playsInline
          loop
          preload="metadata"
          draggable={false}
        />
      ) : poster ? (
        <img
          src={poster}
          alt=""
          className={`w-full bg-black object-contain ${aspectBoxClass}`}
          draggable={false}
        />
      ) : playable ? (
        <div
          className={`relative flex w-full items-center justify-center bg-black ${aspectBoxClass}`}
        >
          <span className="text-[12px] text-white/70">悬停预览</span>
        </div>
      ) : (
        <div
          className={`flex w-full items-center justify-center text-[12px] ${aspectBoxClass} ${mutedCls(isDark)} ${
            isDark ? 'bg-white/[0.04]' : 'bg-gray-100'
          }`}
        >
          未出片
        </div>
      )}
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
    </div>
  );
}

function DramaFinalCutPanel({
  session,
  isDark,
  onChange,
  onVideosToSplice,
}: {
  session: DramaDirectorSession;
  isDark: boolean;
  onChange: (s: DramaDirectorSession) => void;
  onVideosToSplice?: () => void;
}) {
  const shots = session.shots || [];
  const ready = shots.filter((s) => String(s.video_url || '').trim());
  const missing = shots.length - ready.length;
  const autoOnce = useRef(false);
  const dragShotId = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const aspectBoxClass = dramaFinalCutAspectBoxClass(session.meta.aspect_ratio);

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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className={`${cardCls(isDark)} p-3 flex flex-wrap items-center justify-between gap-2`}>
        <div className={`text-[13px] leading-relaxed ${mutedCls(isDark)}`}>
          按成片比例预览，悬停播放；拖动卡片可改写入剪辑的顺序。未出片镜头会跳过。
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
            {' · 一排 6 个，可拖动改序'}
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-6 content-start gap-3 overflow-auto custom-scrollbar-dark pr-0.5">
            {shots.map((shot, index) => (
              <DramaFinalCutShotCard
                key={shot.shot_id}
                shot={shot}
                index={index}
                isDark={isDark}
                aspectBoxClass={aspectBoxClass}
                dragging={draggingId === shot.shot_id}
                dropTarget={dropTargetId === shot.shot_id && draggingId !== shot.shot_id}
                hoverDisabled={!!draggingId}
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
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default DramaStudioHost;
