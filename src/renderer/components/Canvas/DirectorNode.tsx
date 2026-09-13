import React, {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Handle, Position, NodeProps, useStoreApi, useUpdateNodeInternals } from 'reactflow';
import {
  setDirectorFullscreenNodeId,
  useGlobalInteractionSelector,
} from '../../utils/globalInteractionStore';
import {
  Clapperboard,
  Loader2,
  Plus,
  Upload,
  X,
  Check,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  MousePointerClick,
  Library,
  ChevronUp,
  ChevronDown,
  User,
  Music2,
  AudioLines,
  UploadCloud,
  Scissors,
  Trash2,
  RefreshCw,
  Download,
  Volume2,
  VolumeX,
  MoreHorizontal,
} from 'lucide-react';
import { useAI } from '../../hooks/useAI';
import { useCloudRealtimeDictation } from '../../hooks/useCloudRealtimeDictation';
import { useDictationPushToTalk } from '../../hooks/useDictationPushToTalk';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import { directorPipelineT, fillDirectorI18n } from '../../i18n/directorPipelineI18n';
import {
  formatCloudLlmUserError,
  isCloudRateLimitError,
} from '../../../shared/cloudLlmUserError';
import { workspaceChromeT } from '../../i18n/workspaceI18n';
import { micLevelCssVars } from '../../utils/micInputLevel';
import {
  enqueueDirectorConcurrentChat,
  enqueueDirectorSkillOptimizeChat,
  type DirectorConcurrentChatQueueStatus,
} from '../../utils/directorConcurrentChatQueue';
import { NEXFLOW_MAX_TASK_CONCURRENCY } from '../../../shared/nexflowTaskConcurrency';
import { acquireVoiceModalLock, forceClearVoiceModalLock, isVoiceModalLocked, releaseVoiceModalLock } from '../../utils/voiceModalGate';
import { ModuleProgressBar } from './ModuleProgressBar';
import VoiceMicGlyph from './VoiceMicGlyph';
import DirectorStoryReferenceVoiceField from './DirectorStoryReferenceVoiceField';
import KaraokeSubtitleEditor, {
  type KaraokeSubtitleEditorBusy,
  type KaraokeSubtitleEditorHandle,
} from './KaraokeSubtitleEditor';
import { karaokeT } from '../../i18n/karaokeI18n';
import {
  DEFAULT_KARAOKE_STYLE,
  KARAOKE_ASR_LANGUAGE_OPTIONS,
  karaokeAsrLanguageToApiParam,
  karaokeProjectFromDirectorState,
  lyricsTextFromKaraokeLines,
  normalizeKaraokeAsrLanguage,
  normalizeKaraokeRoleMarkersInText,
  remapKaraokeLineText,
  resolveKaraokeAudioSource,
  type KaraokeAsrLanguage,
  type KaraokeProject,
} from '../../../shared/karaoke';
import { useCanvasTheme } from '../../contexts/CanvasThemeContext';
import { useNxModelPricing } from '../../contexts/NxModelPricingContext';
import {
  DRAMA_PROMPT_OPTIMIZE_MODEL_ID,
  getDramaPromptOptimizeYuanbao,
  LLM_CHAT_DISPLAY_MODEL_ID,
  LLM_CHAT_MODEL_GPT56_TERRA,
  LLM_CHAT_MODEL_IDS,
  LLM_CHAT_MODEL_LABELS,
} from '../../utils/cloudModelPricing';
import { getImageDisplayPrice, getLlmChatDisplayPrice, getFileTranscribeDisplayPrice, getVideoDisplayPrice } from '../../utils/cloudModelPricing';
import { isModelNotPricedError } from '../../utils/priceCalc';
import {
  CLOUD_BALANCE_INSUFFICIENT_ALERT,
  resolveCloudAuthErrorWithBalance,
} from '../../utils/cloudAiGateMessage';
import { useNavigate } from 'react-router-dom';
import {
  ACTIVE_IMAGE_MODELS,
  DEFAULT_IMAGE_MODEL,
  filterImageModelsForMode,
  normalizeImageModelIfRetired,
} from '../../config/imageModelUiPolicy';
import { directorModeForNodeType } from '../../utils/directorNodeType';
import {
  assetLibBtnPrimary,
  assetLibBtnSecondary,
  nodeFloatToolBtn,
} from '../../utils/assetLibraryChrome';
import {
  nexflowOrangePillBtnBg,
  nexflowOrangePillBtnClass,
} from '../darkModalShell';
import type { ScratchColorId } from '../../theme/scratchColors';
import {
  addDirectorShot,
  removeDirectorShot,
  insertDirectorShot,
  reorderDirectorShot,
  applyDirectorAssetsPatch,
  applyDirectorPromptsPatch,
  applyDirectorShotsPatch,
  buildDirectorAssetsMessages,
  buildDirectorMvShotsMessages,
  buildDirectorMvStoryAnalyzeMessages,
  buildDirectorMvStoryOutlineMessages,
  buildDirectorMvScriptMessages,
  buildDirectorMvScriptPlotContinueMessages,
  DIRECTOR_MV_STORY_GENRE_TYPES,
  DIRECTOR_MV_STORY_TONE_STYLES,
  DIRECTOR_MV_STORY_ENDING_TYPES,
  applyDirectorMvStoryPrefsToOutline,
  buildDirectorDramaScriptMessages,
  buildDirectorPromptsMessages,
  buildDirectorShotsMessages,
  applyDirectorDramaScriptResult,
  ensureDirectorDramaShotsFromScript,
  completeDirectorDramaShotLayers,
  distributeShotDurations,
  sumDirectorShotsDurationSec,
  ensureMvShotsMatchMusicDuration,
  ensureMvShotsCoverSceneNames,
  parseDirectorShotDurationSec,
  DIRECTOR_MV_ASPECT_OPTIONS,
  coerceDirectorMvAspectRatio,
  normalizeDirectorImageResolution,
  countAssetsMissingImages,
  countAssetsWithImages,
  countShotsWithFinalPrompt,
  countDirectorStoryboards,
  countDirectorShotsWithDialogue,
  createDefaultDirectorPipelineState,
  createEmptyDirectorAsset,
  isBlankDirectorShot,
  composeDirectorMvScriptText,
  directorMvScriptSectionsHaveContent,
  directorAssetBagKey,
  flattenDirectorAssets,
  findDirectorAssetById,
  getDirectorMvCharactersSectionText,
  getDirectorMvScenesSectionText,
  getOrderedAssetsWithImages,
  getDirectorShotStoryboard,
  migrateBareDirectorStoryboardsToEpisode,
  listDirectorShotStoryboardImages,
  listDirectorShotVideos,
  directorMediaUrlKey,
  isDirectorShotVideoSelection,
  getDirectorShotPromptVersions,
  getValidDirectorShotSongClipUrl,
  resolveDirectorShotPreferLipsync,
  recommendDirectorShotLipsync,
  evaluateDirectorShotLipsync,
  shotDescriptionSuggestsCloseUpFace,
  computeDirectorShotMusicRanges,
  computeDirectorShotMusicRangesFromState,
  coverSongWithLyricSegments,
  calibrateLyricSegmentsWithUserLyrics,
  packLyricSegmentsIntoShotPacks,
  shotAudioRangeHasHumanVoice,
  classifyDirectorMvPackAudioRole,
  directorMvPackAudioRoleLabelZh,
  isDirectorInstrumentalLyricText,
  isDirectorLyricShotPackInstrumental,
  sanitizeDirectorLyricDisplayText,
  stripDirectorLyricsScriptMeta,
  formatDirectorLyricsFromAsr,
  syncDirectorShotsToLyricTimeline,
  normalizeDirectorAssetsResult,
  normalizeDirectorPromptsResult,
  normalizeDirectorShotsResult,
  normalizeDirectorMvStoryAnalyzeResult,
  normalizeDirectorMvScriptResult,
  normalizeDirectorMvStoryOutlineResult,
  coerceAssistantText,
  normalizeDirectorMvScriptSections,
  parseDirectorMvCharacterEntries,
  parseDirectorMvSceneEntries,
  parseDirectorMvScriptSectionsFromText,
  syncDirectorMvCastFromScript,
  syncDirectorMvScenesFromScript,
  ensureDirectorMvLeadSlots,
  applyAutoDirectorMvCastPlan,
  directorMvCastPlanComboId,
  normalizeDirectorMvCastPlan,
  listDirectorMvLeadAssetIds,
  setDirectorPhase,
  patchDirectorMvMusic,
  patchDirectorMvStoryAnalysis,
  patchDirectorMvScriptInput,
  setDirectorMvCloseUpFraming,
  patchDirectorMvCastPlan,
  setDirectorMvAspectRatio,
  setDirectorAssetsStep,
  setSelectedDirectorAssetIds,
  updateDirectorAsset,
  upsertDirectorAsset,
  removeDirectorAsset,
  updateDirectorShotCell,
  updateDirectorShotStoryboard,
  DIRECTOR_STYLE_PRESETS,
  getDirectorStylePreset,
  resolveDirectorStylePrompt,
  resolveDirectorStyleReferenceImageUrl,
  directorStylePresetImageUrl,
  normalizeDirectorStylePresetId,
  DIRECTOR_CAST_ARTWORK_PRESETS,
  directorCastArtworkImageUrl,
  type DirectorCastArtworkPreset,
  withComposedDirectorFinalPrompts,
  composeDirectorShotFinalPrompt,
  composeDirectorShotStoryboardPrompt,
  composeDirectorShotVideoPrompt,
  resolveDirectorShotVideoPromptForGen,
  replaceDirectorStyleTextWithImageRef,
  directorStyleLooksMonochrome,
  DIRECTOR_MONOCHROME_STYLE_LOCK_GUARD,
  shouldAutoSyncDirectorFinalPrompt,
  applyDirectorLipsyncToggleToFinalPrompt,
  buildDirectorReviseFinalPromptMessages,
  parseDirectorRevisedFinalPrompt,
  buildDirectorSceneImagePrompt,
  buildDirectorCharacterImagePrompt,
  buildDirectorPropImagePrompt,
  buildDirectorSystemVisualImagePrompt,
  directorAssetAspectRatio,
  ensureDirectorSceneBuiltinPrompt,
  rebindDirectorPipelineAssetRefs,
  applyDirectorShotAssetBindingIndices,
  matchDirectorAssetIndicesForShot,
  matchDirectorShotsAssetIndices,
  inferDirectorAssetGender,
  resolveDirectorShotRefItems,
  clarifyDirectorPromptRefPictureNumbers,
  repairDirectorMvPromptImageMap,
  buildDirectorShotRefItems,
  buildDirectorShotSceneStoryHint,
  directorMvPromptNeedsLookRelock,
  stripDirectorPromptInventedLook,
  parseDirectorShotRefBindings,
  shotSuggestsNoCharacterRefs,
  parseDirectorMvPlotBeatTable,
  formatDirectorMvPlotBeatTable,
  coerceDirectorMvPlotToBeatTable,
  countDirectorMvPlotBeatsWithCast,
  applyDirectorMvPlotBeatsToShots,
  getDirectorMvPlotBeatsFromState,
  alignDirectorMvPlotBeatsToCount,
  alignDirectorMvScriptSectionsToClipCount,
  resolveDirectorMvAudioClipCount,
  bumpDirectorScriptContentRevision,
  isDirectorShotPromptsStale,
  countDirectorStalePromptShots,
  markAllDirectorShotsPromptsSynced,
  applyDirectorMvStaleScriptUpdateToShot,
  applyDirectorMvStaleScriptUpdateToAllStaleShots,
  rebuildDirectorShotPromptFromScript,
  rebuildDirectorAllShotPromptsFromScript,
  type DirectorAsset,
  type DirectorAssetKind,
  type DirectorAssetsStep,
  type DirectorMvCastPlan,
  type DirectorMvLeadGender,
  type DirectorMvPlotBeatRow,
  type DirectorMvScriptSections,
  type DirectorPhase,
  type DirectorPipelineState,
  type DirectorShotColumnKey,
  type DirectorStylePresetId,
} from '../../../shared/directorPipeline';
import {
  mapDirectorMvShotIndexToPlotBeat,
  resolveDirectorMvBeatCastLabel,
} from '../../../shared/directorPipeline/plotBeatSheet';
import { createPortal } from 'react-dom';
import { extractSeedanceImageMentionIndices } from '../../utils/seedanceImageMentions';
import {
  buildMinimaxH3OptimizeMessages,
  isAcceptableMinimaxH3OptimizedPrompt,
  parseMinimaxH3OptimizedPrompt,
  recoverMinimaxH3OptimizedPrompt,
  resolveMinimaxH3BaseSubMode,
  resolveMinimaxH3OptimizeStructure,
} from '../../../shared/minimaxH3OptimizePrompt';
import {
  DIRECTOR_MV_FORCE_H3_LIPSYNC,
  DIRECTOR_MV_PROMPT_OPTIMIZE_PARALLEL,
  DIRECTOR_MV_PROMPT_OPTIMIZE_WAVE_GAP_MS,
  DIRECTOR_VIDEO_BATCH_MODELS,
  DIRECTOR_VIDEO_LIPSYNC_MODELS,
  DIRECTOR_VIDEO_MINIMAX_LIPSYNC_MODEL,
  buildDirectorVideoPriceParams,
  directorShotNeedsVideoGeneration,
  directorVideoBatchModelLabel,
  getDirectorVideoBatchAspectOptions,
  getDirectorVideoBatchDurationOptions,
  getDirectorVideoBatchResolutionDisplay,
  getDirectorVideoBatchResolutionOptions,
  isDirectorLipsyncModel,
  isDirectorLtxSingleImageModel,
  normalizeDirectorVideoBatchAspect,
  normalizeDirectorVideoBatchDuration,
  normalizeDirectorVideoBatchModel,
  normalizeDirectorVideoBatchResolution,
  normalizeDirectorVideoLipsyncModel,
  pickNearestDirectorVideoBatchDuration,
  resolveDirectorMvForceLipsyncOn,
  resolveDirectorMvLipsyncModel,
  resolveDirectorMvShotVideoModel,
} from '../../utils/directorVideoBatch';
import { audioDisplayTitleFromFileName } from '../../utils/audioSongModels';
import { toElectronVideoElementSrc } from '../../utils/normalizeVideoUrl';
import { getCharactersCoalesced } from '../../utils/characterLibraryCache';
import { ReferenceAudioWaveStrip } from './ReferenceAudioWaveStrip';
import AssetLibLazyThumb from '../AssetLibLazyThumb';
import { MusicPlayer } from '../Workspace/MusicPlayer';
import { scaleModulePx } from '../../utils/moduleDisplayScale';
import { PanelOptionDropdown, forceRemoveOrphanPanelDropdownPortals } from './PanelOptionDropdown';
import {
  DirectorShotTableVirtual,
  DirectorTableVirtualPad,
  DIRECTOR_MV_SHOT_ROW_ESTIMATE_PX,
  DIRECTOR_MV_VIDEO_ROW_ESTIMATE_PX,
  type DirectorShotTableVirtualHandle,
} from './DirectorShotTableVirtual';
import { DramaStudioHost, type DramaAssetVisualKind } from '../DirectorStudio/DramaStudioHost';
import type { DramaDirectorSession } from '../../../shared/directorDomain';
import {
  createEmptyDramaSession,
  dramaStudioNodeTitle,
  projectDramaSessionToPipeline,
  refreshDramaContinuity,
  setDramaSessionPhase,
  composeDramaImageStyleHint,
  ensureDramaCharacterPromptGenreLock,
  resolveDramaGenreLock,
  applyDramaSessionAssetImage,
  applyDramaSessionVoiceSample,
  composeDramaCharacterCostumePrompt,
  resolveCharacterMasterReferenceUrl,
  healDramaSessionStuckAssetGenerating,
  restoreDramaBibleMediaFromPipeline,
  composeDramaVoiceSampleLine,
  ensureVoiceSampleTexts,
  buildDramaShotDoubaoAudioPrompt,
  collectDramaShotVoiceRefUrls,
  dramaShotHasOnlySystemDialogue,
  dramaShotHasSpokenDialogue,
  dramaShotNeedsAudioContent,
  domainPhaseToUserPhase,
  preferredDomainPhaseForUserPhase,
  canEnterDramaUserPhase,
  confirmDramaAssets,
  isDramaAssetsConfirmed,
  isDramaUserPhaseDone,
  isDramaVisualStyleLocked,
  isDramaSystemVisualAssetId,
  resolveDramaSystemVoice,
  composeDramaSystemVisualPrompt,
  DRAMA_SYSTEM_SPEAKER_ID,
  DRAMA_SYSTEM_VISUAL_ASSET_NAME,
  DRAMA_USER_PHASES,
  DRAMA_USER_PHASE_LABELS,
  DRAMA_USER_PHASE_SUB,
  inferDramaSceneSettingPeriod,
  dramaStyleHintLooksAncient,
  listDramaShotStoryboardSourceRefs,
  composeDramaShotStoryboardImagePrompt,
  type DramaUserPhase,
} from '../../../shared/directorDomain';
import { DOUBAO_SEED_AUDIO_MODEL_ID } from '../../utils/doubaoSeedAudioModel';
import { getAudioDisplayPrice } from '../../utils/cloudModelPricing';

const SHOT_ROW_LONG_PRESS_MS = 480;
const SHOT_ROW_DRAG_THRESHOLD_PX = 8;

/** 导演对话下拉：与 LLM 聊天共用目录（含 GPT-5.6 Terra） */
const DIRECTOR_CHAT_MODELS = LLM_CHAT_MODEL_IDS;
const DIRECTOR_CHAT_MODEL_DEFAULT =
  (DIRECTOR_CHAT_MODELS as readonly string[]).includes('gpt-4o')
    ? 'gpt-4o'
    : LLM_CHAT_DISPLAY_MODEL_ID;

function directorChatModelOptions(includeDramaPrice: boolean) {
  return DIRECTOR_CHAT_MODELS.map((m) => ({
    value: m,
    label: includeDramaPrice
      ? `${LLM_CHAT_MODEL_LABELS[m] || m} · ${getDramaPromptOptimizeYuanbao(m)}元宝`
      : LLM_CHAT_MODEL_LABELS[m] || m,
  }));
}

export interface DirectorNodeData {
  director?: DirectorPipelineState;
  /** 短剧 V2 Domain 会话（可与 director-v2/ 旁路文件同步） */
  directorDomain?: import('../../../shared/directorDomain').DramaDirectorSession | null;
  userPrompt?: string;
  isGenerating?: boolean;
  error?: string;
  title?: string;
  width?: number;
  height?: number;
  isUserResized?: boolean;
  /** 与文本模块一致：10–28，默认 28 */
  fontSizePx?: number;
  projectId?: string | null;
  /** 卡拉OK工程（第 8 步持久化） */
  karaokeProject?: KaraokeProject;
  /**
   * 第 7 步「剪辑预览」导出的成片 URL（缓存，避免第 8 步重复导出）。
   * 用户上传本地成片时仍保留，清除本地后可回退。
   */
  karaokeComposedVideoUrl?: string;
  /**
   * 当前 karaokeProject.videoUrl 来源：
   * - composed：合成成片（默认）
   * - user：用户上传的本地成片（优先）
   */
  karaokeVideoSource?: 'composed' | 'user';
  /** 烧录成片 URL（挂回第 8 步） */
  karaokeBurnedVideoUrl?: string;
  /** 清除 MV 歌曲时断开入边音频，避免 Workspace 再灌回 */
  unlinkIncomingAudio?: boolean;
  onUpdate?: (d: Partial<DirectorNodeData>) => void;
  onSpawnVideos?: (opts?: {
    shotNos?: string[];
    startLipsync?: boolean;
    /** 确认清单中材料齐全、须强制走对口型的镜号 */
    lipsyncShotNos?: string[];
    /** Skill 改写后的最终提示词（避免 setNodes 未刷新就开跑） */
    shotPromptOverrides?: Record<string, string>;
    /** 短剧：覆盖本批视频模型 */
    videoModel?: string;
    /** 短剧：按镜号覆盖模型 */
    shotModels?: Record<string, string>;
  }) => void;
  onPreviewToSplice?: () => void;
  /** 第 7 步剪辑预览：各镜成片 + 原曲入轨，聚焦右侧 VideoSplice（与分镜步同套 UX） */
  onVideosToSplice?: () => void;
  onConfirmGenVideos?: () => void;
  onExportMv?: () => void;
  /** 卡拉OK：解析成片视频 URL（通常导出关联剪辑轨） */
  onResolveKaraokeMvVideo?: () => Promise<string | null>;
  /** 卡拉OK烧录结果落到画布 */
  onAddVideoClipNodes?: (payload: {
    nodes: import('reactflow').Node[];
    edges: import('reactflow').Edge[];
  }) => void;
  /** 从画布点选图片 URL（参考图） */
  onPickImageFromCanvas?: () => Promise<string | null>;
  /** 从画布点选视频 URL（成片） */
  onPickVideoFromCanvas?: () => Promise<string | null>;
  /** 从画布点选参考音（声音样本） */
  onPickAudioFromCanvas?: () => Promise<{ url: string; label: string } | null>;
  /** 切换历史成片后，写回关联剪辑预览轨 */
  onApplyShotVideoToSplice?: (shotNo: string, videoUrl: string) => void;
  [key: string]: unknown;
}

function directorLibraryPreviewUrl(localPath?: string, remoteUrl?: string): string {
  const local = String(localPath || '').trim();
  if (local) {
    const normalized = local.replace(/\\/g, '/');
    const bare = normalized.replace(/^\/([a-zA-Z]:)/, '$1');
    return `local-resource://${bare}`;
  }
  return String(remoteUrl || '').trim();
}

/** 默认展开尺寸：窗口模式固定 16:9 */
export const DIRECTOR_DEFAULT_W = scaleModulePx(1280);
export const DIRECTOR_DEFAULT_H = scaleModulePx(720);
const DIRECTOR_MIN_W = scaleModulePx(800);
const DIRECTOR_MIN_H = scaleModulePx(450);
const DIRECTOR_ASPECT_W_OVER_H = 16 / 9;

/** 按宽度锁定 16:9（MV 窗口模式） */
function directorMvLockedSize(width: number): { width: number; height: number } {
  const w = Math.max(DIRECTOR_MIN_W, Math.round(width));
  const h = Math.max(DIRECTOR_MIN_H, Math.round(w / DIRECTOR_ASPECT_W_OVER_H));
  return { width: w, height: h };
}
const DIRECTOR_FONT_MIN = 10;
const DIRECTOR_FONT_DEFAULT = 28;
/** 放大镜上限：原 28px 再 ×3，便于看清分镜色块文字 */
const DIRECTOR_FONT_MAX = 84;
/** 导演生图：与 ImageInputPanel 同源活跃模型目录（标签查找） */
const DIRECTOR_IMAGE_MODELS = ACTIVE_IMAGE_MODELS;

/** 按文生/图生从同源目录挑选可用模型（下架/未知归一后） */
function pickDirectorImageModel(
  preferred: string | undefined | null,
  hasRefs: boolean,
  refCount = 0,
): string {
  const normalized = normalizeImageModelIfRetired(preferred);
  const opts = filterImageModelsForMode({
    hasRefs,
    refCount: hasRefs ? Math.max(1, refCount) : 0,
  });
  if (opts.some((m) => m.value === normalized)) return normalized;
  return opts[0]?.value || DEFAULT_IMAGE_MODEL;
}

/** 每个资产独立 nodeId，避免共用 id 时 SUCCESS 对不上队列/组件重挂丢失回写 */
function directorAssetImageNodeId(directorNodeId: string, assetId: string): string {
  return `${directorNodeId}-director-img-${assetId}`;
}

function directorVoiceSampleNodeId(directorNodeId: string, voiceId: string): string {
  return `${directorNodeId}-director-voice-${voiceId}`;
}

function parseDirectorVoicePacketNodeId(
  packetNodeId: string,
  directorNodeId: string,
): { voiceId: string } | null {
  const pid = String(packetNodeId || '').trim();
  const prefix = `${directorNodeId}-director-voice-`;
  if (!pid.startsWith(prefix)) return null;
  const voiceId = pid.slice(prefix.length).trim();
  return voiceId ? { voiceId } : null;
}

/** 短剧本镜声音（对白+环境音） */
function directorShotAudioNodeId(directorNodeId: string, shotId: string): string {
  return `${directorNodeId}-director-shot-audio-${encodeURIComponent(String(shotId || '').trim())}`;
}

function parseDirectorShotAudioPacketNodeId(
  packetNodeId: string,
  directorNodeId: string,
): { shotId: string } | null {
  const pid = String(packetNodeId || '').trim();
  const prefix = `${directorNodeId}-director-shot-audio-`;
  if (!pid.startsWith(prefix)) return null;
  try {
    const shotId = decodeURIComponent(pid.slice(prefix.length).trim());
    return shotId ? { shotId } : null;
  } catch {
    const shotId = pid.slice(prefix.length).trim();
    return shotId ? { shotId } : null;
  }
}

/** 本镜声音：模块级暂存/等待，避免 React effect 随 patch 重建漏接 SUCCESS */
type DirectorShotAudioResult =
  | { ok: true; audioUrl: string }
  | { ok: false; error: string };
type DirectorShotAudioWaiter = { resolve: (r: DirectorShotAudioResult) => void };
const directorShotAudioWaiters = new Map<string, DirectorShotAudioWaiter>();
const directorShotAudioStashByNodeId = new Map<string, { audioUrl: string; at: number }>();
const DIRECTOR_SHOT_AUDIO_STASH_TTL_MS = 3 * 60 * 1000 + 30_000;
const DIRECTOR_SHOT_AUDIO_WAIT_MS = 3 * 60 * 1000;

function extractAudioUrlFromAiPayload(payload?: {
  audioUrl?: string;
  url?: string;
  localPath?: string;
}): string {
  let audioUrl = String(payload?.audioUrl || payload?.url || '').trim();
  const localPath = String(payload?.localPath || '').trim();
  if (localPath) {
    let filePath = localPath.replace(/\\/g, '/');
    if (filePath.match(/^\/[a-zA-Z]:/)) filePath = filePath.substring(1);
    if (filePath.startsWith('local-resource://')) audioUrl = filePath;
    else audioUrl = `local-resource://${filePath}`;
  }
  return audioUrl;
}

let directorShotAudioListenerBound = false;
function ensureDirectorShotAudioStatusListener(): void {
  if (directorShotAudioListenerBound) return;
  if (typeof window === 'undefined' || !window.electronAPI?.onAIStatusUpdate) return;
  directorShotAudioListenerBound = true;
  window.electronAPI.onAIStatusUpdate((packet: {
    nodeId?: string;
    status?: string;
    payload?: { audioUrl?: string; url?: string; localPath?: string; error?: string };
  }) => {
    const nodeId = String(packet?.nodeId || '');
    if (!nodeId.includes('-director-shot-audio-')) return;
    if (packet.status === 'SUCCESS') {
      const audioUrl = extractAudioUrlFromAiPayload(packet.payload);
      if (audioUrl) {
        directorShotAudioStashByNodeId.set(nodeId, { audioUrl, at: Date.now() });
      }
      const waiter = directorShotAudioWaiters.get(nodeId);
      if (!waiter) return;
      directorShotAudioWaiters.delete(nodeId);
      if (audioUrl) {
        directorShotAudioStashByNodeId.delete(nodeId);
        waiter.resolve({ ok: true, audioUrl });
      } else {
        waiter.resolve({ ok: false, error: 'empty-shot-audio' });
      }
      return;
    }
    if (packet.status === 'ERROR') {
      const waiter = directorShotAudioWaiters.get(nodeId);
      if (!waiter) return;
      directorShotAudioWaiters.delete(nodeId);
      waiter.resolve({
        ok: false,
        error: String(packet.payload?.error || 'shot-audio-failed'),
      });
    }
  });
}

function takeDirectorShotAudioStash(nodeId: string): string | null {
  const hit = directorShotAudioStashByNodeId.get(nodeId);
  if (!hit) return null;
  directorShotAudioStashByNodeId.delete(nodeId);
  if (Date.now() - hit.at > DIRECTOR_SHOT_AUDIO_STASH_TTL_MS) return null;
  return hit.audioUrl || null;
}

/** 放弃本地等待：解除 waiter，不取消云端已发出任务 */
function cancelDirectorShotAudioWaiter(nodeId: string): void {
  const nid = String(nodeId || '').trim();
  if (!nid) return;
  const waiter = directorShotAudioWaiters.get(nid);
  if (!waiter) return;
  directorShotAudioWaiters.delete(nid);
  waiter.resolve({ ok: false, error: 'abandoned' });
}

function waitDirectorShotAudioResult(
  nodeId: string,
  timeoutMs = DIRECTOR_SHOT_AUDIO_WAIT_MS,
): Promise<DirectorShotAudioResult> {
  ensureDirectorShotAudioStatusListener();
  const stashed = takeDirectorShotAudioStash(nodeId);
  if (stashed) return Promise.resolve({ ok: true, audioUrl: stashed });
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      directorShotAudioWaiters.delete(nodeId);
      const late = takeDirectorShotAudioStash(nodeId);
      if (late) {
        resolve({ ok: true, audioUrl: late });
        return;
      }
      resolve({
        ok: false,
        error: '本镜音频生成超时（3分钟未完成），请重试',
      });
    }, timeoutMs);
    directorShotAudioWaiters.set(nodeId, {
      resolve: (r) => {
        window.clearTimeout(timer);
        resolve(r);
      },
    });
  });
}

function directorStoryboardImageNodeId(directorNodeId: string, shotNo: string): string {
  return `${directorNodeId}-director-sb-${encodeURIComponent(String(shotNo || '').trim())}`;
}

function parseDirectorImagePacketNodeId(
  packetNodeId: string,
  directorNodeId: string,
): { assetId: string } | { legacy: true } | null {
  const pid = String(packetNodeId || '').trim();
  const prefix = `${directorNodeId}-director-img-`;
  if (pid.startsWith(prefix)) {
    const assetId = pid.slice(prefix.length).trim();
    return assetId ? { assetId } : null;
  }
  if (pid === `${directorNodeId}-director-image`) return { legacy: true };
  return null;
}

function parseDirectorStoryboardPacketNodeId(
  packetNodeId: string,
  directorNodeId: string,
): { shotNo: string } | null {
  const pid = String(packetNodeId || '').trim();
  const prefix = `${directorNodeId}-director-sb-`;
  if (!pid.startsWith(prefix)) return null;
  const raw = pid.slice(prefix.length).trim();
  if (!raw) return null;
  try {
    return { shotNo: decodeURIComponent(raw) };
  } catch {
    return { shotNo: raw };
  }
}

function formatDirectorLocalImageUrl(localPath: string): string {
  let filePath = String(localPath || '').replace(/\\/g, '/');
  if (filePath.match(/^\/[a-zA-Z]:/)) filePath = filePath.substring(1);
  if (filePath.match(/^([a-zA-Z])\//)) {
    filePath = `${filePath[0].toUpperCase()}:${filePath.substring(1)}`;
  }
  // 与 Workspace.formatImagePathSync 一致：中文/空格分段 encode，避免 img 黑块
  const parts = filePath.split('/');
  const encoded = parts.map((part, index) => {
    if (index === 0 && /^[a-zA-Z]:$/.test(part)) return part;
    if (/[\u4e00-\u9fa5\s]/.test(part)) return encodeURIComponent(part);
    return part;
  });
  return `local-resource://${encoded.join('/')}`;
}

function syncMvShotDescForCastScene(
  desc: string,
  opts: { sceneName?: string | null; castNames?: string[] | null },
): string {
  let d = String(desc || '').trim();
  if (opts.castNames != null) {
    if (opts.castNames.length === 0) {
      d = d
        .replace(/出场\s*[:：][^。；;\n]*/g, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/^[。．\s]+|[。．\s]+$/g, '')
        .trim();
      if (!/空镜|无人物/.test(d)) {
        d = d ? `空镜/无人物。${d}` : '空镜/无人物';
      }
    } else {
      d = d
        .replace(/空镜\s*\/\s*无人物/g, '')
        .replace(/空镜/g, '')
        .replace(/无人物/g, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/^[。．\s]+|[。．\s]+$/g, '')
        .trim();
      const castClause = `出场: ${opts.castNames.join('、')}`;
      if (/出场\s*[:：]/.test(d)) {
        d = d.replace(/出场\s*[:：][^。；;\n]*/g, castClause);
      } else {
        d = d ? `${d}${/[。.!？?]$/.test(d) ? '' : '。'}${castClause}` : castClause;
      }
    }
  }
  if (opts.sceneName != null && String(opts.sceneName).trim()) {
    const sceneClause = `场景: ${String(opts.sceneName).trim()}`;
    if (/场景\s*[:：]/.test(d)) {
      d = d.replace(/场景\s*[:：][^。；;\n]*/g, sceneClause);
    } else {
      d = d ? `${sceneClause}。${d}` : sceneClause;
    }
  }
  return d
    .replace(/[。．]{2,}/g, '。')
    .replace(/\s*。\s*/g, '。')
    .replace(/^[。．]+|[。．]+$/g, '')
    .trim();
}

function clampDirectorFontPx(n: unknown): number {
  const x = typeof n === 'number' ? n : typeof n === 'string' ? parseFloat(n) : NaN;
  if (!Number.isFinite(x)) return DIRECTOR_FONT_DEFAULT;
  return Math.min(DIRECTOR_FONT_MAX, Math.max(DIRECTOR_FONT_MIN, Math.round(x)));
}

const SHOT_COLS: { key: DirectorShotColumnKey; width: string }[] = [
  { key: '镜号', width: '52px' },
  { key: '时长', width: '56px' },
  { key: '画面描述', width: '200px' },
  { key: '景别', width: '72px' },
  { key: '光影氛围', width: '110px' },
  { key: '对白旁白', width: '120px' },
  { key: '音效', width: '100px' },
  { key: '运镜', width: '100px' },
  { key: '最终提示词', width: '120px' },
];

/** 短剧剧本解析：场次层 + 镜头层 + 制作层 */
const DRAMA_SHOT_COLS: { key: DirectorShotColumnKey; width: string; layer: 'scene' | 'shot' | 'prod' }[] =
  [
    { key: '场号', width: '44px', layer: 'scene' },
    { key: '内外景', width: '48px', layer: 'scene' },
    { key: '日夜', width: '40px', layer: 'scene' },
    { key: '地点', width: '100px', layer: 'scene' },
    { key: '出场人物', width: '96px', layer: 'scene' },
    { key: '镜号', width: '44px', layer: 'shot' },
    { key: '景别', width: '64px', layer: 'shot' },
    { key: '镜头角度', width: '80px', layer: 'shot' },
    { key: '焦距', width: '72px', layer: 'shot' },
    { key: '运镜', width: '72px', layer: 'shot' },
    { key: '时长', width: '48px', layer: 'shot' },
    { key: '画面描述', width: '180px', layer: 'shot' },
    { key: '对白旁白', width: '160px', layer: 'shot' },
    { key: '音效', width: '88px', layer: 'shot' },
    { key: '光影氛围', width: '100px', layer: 'shot' },
    { key: '制作备注', width: '120px', layer: 'prod' },
    { key: '连贯性', width: '110px', layer: 'prod' },
    { key: '参考图绑定', width: '130px', layer: 'prod' },
    { key: '最终提示词', width: '100px', layer: 'prod' },
  ];

const DRAMA_LAYER_COLSPAN = {
  scene: DRAMA_SHOT_COLS.filter((c) => c.layer === 'scene').length,
  shot: DRAMA_SHOT_COLS.filter((c) => c.layer === 'shot').length,
  prod: DRAMA_SHOT_COLS.filter((c) => c.layer === 'prod').length,
};

/** 分镜图缩略图基准高度（原比例 contain，非强制 1:1） */
const STORYBOARD_THUMB_PX = 84;
/** 确认镜头表：缩略图铺满单元格 */
const SHOTS_CONFIRM_THUMB_SCALE = 1.35;
const SHOTS_CONFIRM_SB_THUMB_PX = Math.round(STORYBOARD_THUMB_PX * 1.45);
/** 确认镜头：场景/角色单元格高度 */
const SHOTS_CONFIRM_REF_CELL_H = 72;
/** 确认镜头表：歌曲波形默认宽度（窗口模式） */
const SHOTS_CONFIRM_AUDIO_WIDTH_CLS = 'w-full min-w-0';
/** 第 7 步成片格：本地拖入/电脑上传可接受的视频后缀 */
const DIRECTOR_SHOT_VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|mkv|avi)$/i;
const isDirectorShotVideoFile = (file: File | null | undefined): boolean => {
  if (!file) return false;
  const mime = String(file.type || '').toLowerCase();
  if (mime.startsWith('video/')) return true;
  const name = String(file.name || '').trim();
  if (DIRECTOR_SHOT_VIDEO_EXT_RE.test(name)) return true;
  const path = String((file as File & { path?: string }).path || '').trim();
  return !!path && DIRECTOR_SHOT_VIDEO_EXT_RE.test(path);
};
/** 全屏大表行：跳过视口外布局/绘制。画布节点在 React Flow transform 里，content-visibility 会把行背景裁成错位色条，窗口模式禁用。 */
const DIRECTOR_MV_TABLE_ROW_CV: React.CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 120px',
};
/** 确认镜头：风格/场景/角色参考图 */
const REF_THUMB_MAX_H_PX = 108;
const REF_THUMB_MAX_W_PX = 160;

/**
 * 定高限宽 + object-contain。
 * frame：圆角比例框——scene 固定 16:9；cast/storyboard 固定常用比例（不再挂载时 new Image 测原图，避免急切解码）。
 * 列表预览走 AssetLibLazyThumb 磁盘小图。
 */
const DirectorAspectThumbButton = memo(function DirectorAspectThumbButton({
  url,
  alt,
  title,
  onClick,
  onPointerDown,
  onMouseEnter,
  onMouseLeave,
  maxH = REF_THUMB_MAX_H_PX,
  maxW = REF_THUMB_MAX_W_PX,
  fill = false,
  frame,
  className = '',
}: {
  url: string;
  alt: string;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
  maxH?: number;
  maxW?: number;
  fill?: boolean;
  frame?: 'scene' | 'cast' | 'storyboard';
  className?: string;
}) {
  const ratio =
    frame === 'scene' || frame === 'storyboard' ? 16 / 9 : frame === 'cast' ? 9 / 16 : 1;
  const listEdge = Math.max(96, Math.min(320, Math.round(Math.max(maxH, maxW) * 1.25)));

  if (frame) {
    const landscape = ratio >= 0.95;
    const boxStyle: React.CSSProperties = landscape
      ? {
          aspectRatio: String(ratio),
          width: '100%',
          maxWidth: maxW,
          maxHeight: maxH,
          height: 'auto',
        }
      : {
          aspectRatio: String(ratio),
          height: maxH,
          maxWidth: maxW,
          width: 'auto',
        };
    return (
      <button
        type="button"
        className={`nodrag rounded-lg overflow-hidden ring-1 ring-sky-400/40 cursor-zoom-in inline-flex items-center justify-center bg-black/30 shrink-0 ${className}`}
        style={boxStyle}
        title={title}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <AssetLibLazyThumb
          src={url}
          alt={alt}
          maxEdge={listEdge}
          className="h-full w-full"
          imgClassName="h-full w-full object-contain pointer-events-none"
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`nodrag rounded overflow-hidden ring-1 ring-sky-400/40 cursor-zoom-in inline-flex items-center justify-center bg-black/25 ${
        fill ? 'w-full h-full shrink' : 'shrink-0'
      } ${className}`}
      style={fill ? undefined : { height: maxH, maxWidth: maxW }}
      title={title}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <AssetLibLazyThumb
        src={url}
        alt={alt}
        maxEdge={listEdge}
        className={fill ? 'max-h-full max-w-full' : 'h-full w-auto max-w-full'}
        imgClassName={
          fill
            ? 'max-h-full max-w-full w-auto h-auto object-contain pointer-events-none'
            : 'h-full w-auto max-w-full object-contain pointer-events-none'
        }
      />
    </button>
  );
});

/** 视频表成片：默认只显示 poster/分镜小图；悬停再挂载 <video> 解码，离开卸载释放解码器。 */
const DirectorMvShotVideoThumb = memo(function DirectorMvShotVideoThumb({
  videoUrl,
  posterUrl,
  shotNo,
  maxH,
  maxW,
  playWithSound,
  panelActive,
  videoGenerating,
  isPreviewBlocked,
  pauseOtherThumbs,
  onClick,
  children,
}: {
  videoUrl: string;
  posterUrl?: string;
  shotNo: string;
  maxH: number;
  maxW: number;
  playWithSound: boolean;
  panelActive: boolean;
  videoGenerating: boolean;
  isPreviewBlocked: () => boolean;
  pauseOtherThumbs: (except?: HTMLVideoElement | null) => void;
  onClick: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
}) {
  const [armed, setArmed] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const src = toElectronVideoElementSrc(videoUrl) || videoUrl;
  const posterEdge = Math.max(128, Math.min(360, Math.round(Math.max(maxH, maxW) * 1.2)));

  React.useEffect(() => {
    if (!armed || !panelActive) return;
    const v = videoRef.current;
    if (!v) return;
    if (isPreviewBlocked() || videoGenerating) return;
    pauseOtherThumbs(v);
    v.loop = true;
    v.muted = !playWithSound;
    void v.play().catch(() => undefined);
  }, [armed, panelActive, playWithSound, videoGenerating, isPreviewBlocked, pauseOtherThumbs, src]);

  React.useEffect(() => {
    if (panelActive) return;
    setArmed(false);
  }, [panelActive]);

  React.useEffect(() => {
    if (armed && panelActive) return;
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    try {
      v.removeAttribute('src');
      v.load();
    } catch {
      /* ignore */
    }
  }, [armed, panelActive]);

  return (
    <div
      className="relative inline-flex max-w-full group/vidf"
      onMouseEnter={() => {
        if (!panelActive || isPreviewBlocked() || videoGenerating) return;
        setArmed(true);
      }}
      onMouseLeave={() => {
        const v = videoRef.current;
        if (v) {
          v.pause();
          try {
            v.currentTime = 0;
            v.removeAttribute('src');
            v.load();
          } catch {
            /* ignore */
          }
        }
        setArmed(false);
      }}
    >
      {armed && panelActive ? (
        <video
          ref={videoRef}
          src={src}
          data-director-shot-video=""
          data-director-shot-no={shotNo}
          className="nodrag max-h-full rounded-lg object-contain bg-black/40 ring-1 ring-transparent group-hover/vidf:ring-blue-500/70"
          style={{ maxHeight: maxH, maxWidth: maxW }}
          muted={!playWithSound}
          loop
          playsInline
          preload="metadata"
          poster={posterUrl || undefined}
          onClick={onClick}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : posterUrl ? (
        <button
          type="button"
          className="nodrag max-h-full rounded-lg overflow-hidden bg-black/40 ring-1 ring-transparent group-hover/vidf:ring-blue-500/70 cursor-pointer"
          style={{ maxHeight: maxH, maxWidth: maxW }}
          title="悬停预览成片"
          onClick={onClick}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <AssetLibLazyThumb
            src={posterUrl}
            alt=""
            maxEdge={posterEdge}
            className="max-h-full max-w-full"
            imgClassName="max-h-full max-w-full object-contain pointer-events-none"
            imgStyle={{ maxHeight: maxH, maxWidth: maxW }}
          />
        </button>
      ) : (
        <button
          type="button"
          className="nodrag flex items-center justify-center rounded-lg bg-black/40 text-[10px] text-white/45 ring-1 ring-transparent group-hover/vidf:ring-blue-500/70"
          style={{ height: Math.min(72, maxH), width: Math.min(128, maxW) }}
          title="悬停预览成片"
          onClick={onClick}
          onPointerDown={(e) => e.stopPropagation()}
        >
          视频
        </button>
      )}
      {children}
    </div>
  );
});

function DirectorAspectThumbPlaceholder({
  label,
  softPanel,
  mutedCls,
  isDarkMode,
  maxH = REF_THUMB_MAX_H_PX,
}: {
  label: string;
  softPanel: string;
  mutedCls: string;
  isDarkMode: boolean;
  maxH?: number;
}) {
  return (
    <div
      className={`rounded overflow-hidden shrink-0 flex items-center justify-center ${softPanel} ring-1 ring-dashed ${
        isDarkMode ? 'ring-white/20' : 'ring-gray-300'
      }`}
      style={{ height: maxH, width: Math.round(maxH * 0.85) }}
      title={label}
    >
      <span className={`text-[10px] leading-tight px-1 text-center ${mutedCls}`}>{label}</span>
    </div>
  );
}

function formatShotAudioClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** 解析 m:ss / 秒数；失败返回 null */
function parseShotAudioClock(raw: string): number | null {
  const t = String(raw || '').trim();
  if (!t) return null;
  const colon = t.match(/^(\d+)\s*:\s*(\d{1,2})(?:\.\d+)?$/);
  if (colon) {
    const m = Number(colon[1]);
    const s = Number(colon[2]);
    if (!Number.isFinite(m) || !Number.isFinite(s) || s >= 60) return null;
    return Math.max(0, m * 60 + s);
  }
  const n = Number(t.replace(/s$/i, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function highlightDescription(
  text: string,
  assets: DirectorAsset[],
  isDarkMode: boolean,
): React.ReactNode {
  if (!text) return text;
  const names = assets
    .map((a) => String(a.name || '').trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (names.length === 0) return text;

  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'g');
  const parts = text.split(re);
  const kindByName = new Map(assets.map((a) => [a.name, a.kind]));

  return parts.map((part, i) => {
    const kind = kindByName.get(part);
    if (!kind) return <span key={i}>{part}</span>;
    const cls =
      kind === 'character'
        ? isDarkMode
          ? 'text-rose-400 font-medium'
          : 'text-rose-600 font-medium'
        : isDarkMode
          ? 'text-sky-400 font-medium'
          : 'text-sky-600 font-medium';
    return (
      <span key={i} className={cls}>
        {part}
      </span>
    );
  });
}

/**
 * 视频「最终提示词」：具体动作描写用蓝色，画风/风格锁/机位/焦距等通用段保持默认色。
 * 匹配：主体运动 / 对口型动作 / 动作时轴 / 动作 / 秒级时轴行 / 手眼脸手法句。
 */
const VIDEO_PROMPT_ACTION_SPAN_RE =
  /(?:主体运动|对口型动作|动作时轴|动作)\s*[：:][^。；;\n]*|人物正在面对镜头唱歌[^。；;\n]*|(?:手部|眼部|脸部)\s*[：:][^。；;\n]+|\d+(?:\.\d+)?\s*[–\-〜~到至]\s*\d+(?:\.\d+)?\s*s?\s*｜[^；;\n]+/gi;

const DIRECTOR_PROMPT_SECTION_LABELS =
  '主体定义|概述|内容保留分析|详细描述|整体声景|非剧情配乐|subject_definitions|summary|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music|画风|场景|人物|出场|动作时轴|动作|主体运动|对口型动作|机位|镜头角度|焦距|运镜|景别|光影氛围|光影|镜头语言';

type DirectorPromptSectionTone = 'action' | 'guard' | 'style' | 'lens' | 'cast' | 'scene' | 'ref' | 'default';

type DirectorPromptSection = {
  label: string;
  body: string;
  tone: DirectorPromptSectionTone;
};

function toneForDirectorPromptLabel(label: string): DirectorPromptSectionTone {
  const l = String(label || '');
  if (/主体运动|对口型动作|动作时轴|^动作$|对口型|表情|场景动态|详细描述|detailed_description/.test(l))
    return 'action';
  if (/画风|风格|约束|禁止|硬性|概述|summary/.test(l)) return 'style';
  if (/机位|镜头角度|焦距|运镜|景别|镜头语言|光影/.test(l)) return 'lens';
  if (/人物|出场|角色|主体定义|subject_definitions/.test(l)) return 'cast';
  if (/场景|内容保留|retention/.test(l)) return 'scene';
  if (/参考图|@图片|整体声景|非剧情|overall_soundscape|non_diegetic/.test(l)) return 'ref';
  if (/约束|禁止|硬性|风格锁/.test(l)) return 'guard';
  return 'default';
}

/** 将最终提示词拆成带标签的段落，便于大框结构化阅读 */
function parseDirectorFinalPromptSections(text: string): DirectorPromptSection[] {
  const raw = String(text || '').trim();
  if (!raw) return [];

  // H3 中文六段式：按六段标题切，避免把每个 [镜头N]/每句守卫拆成十几张「画面」卡
  const h3SectionRe =
    /^(主体定义|概述|内容保留分析|详细描述|整体声景|非剧情配乐)\s*[：:]\s*/m;
  if (
    h3SectionRe.test(raw) &&
    /主体定义\s*[：:]/.test(raw) &&
    /详细描述\s*[：:]/.test(raw)
  ) {
    const names =
      '主体定义|概述|内容保留分析|详细描述|整体声景|非剧情配乐';
    const splitRe = new RegExp(`(?:^|\\n)\\s*(${names})\\s*[：:]\\s*`, 'g');
    const parts: { label: string; body: string }[] = [];
    let lastLabel = '';
    let lastIdx = -1;
    let m: RegExpExecArray | null;
    const src = raw.replace(/\r\n/g, '\n');
    while ((m = splitRe.exec(src))) {
      if (lastIdx >= 0 && lastLabel) {
        parts.push({
          label: lastLabel,
          body: src.slice(lastIdx, m.index).trim(),
        });
      }
      lastLabel = m[1];
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx >= 0 && lastLabel) {
      parts.push({ label: lastLabel, body: src.slice(lastIdx).trim() });
    }
    if (parts.length >= 3) {
      return parts
        .filter((p) => p.body)
        .map((p) => ({
          label: p.label,
          body: p.body,
          tone: toneForDirectorPromptLabel(p.label),
        }));
    }
  }

  const refs: string[] = [];
  let main = raw.replace(/(?:^|[。；;\n])\s*(@(?:图片|Image)\s*\d+[^。；;\n]*)/gi, (_m, p: string) => {
    const t = String(p || '').trim();
    if (t) refs.push(t);
    return '。';
  });
  main = main.replace(/[。]{2,}/g, '。').replace(/^[。；;\s]+|[。；;\s]+$/g, '').trim();

  const labelRe = new RegExp(
    `^(${DIRECTOR_PROMPT_SECTION_LABELS})\\s*[：:]\\s*([\\s\\S]+)$`,
  );
  const clauses = main
    .split(/(?<=[。；;])|(?:\n+)/)
    .map((s) => s.replace(/^[。；;\s]+|[。；;\s]+$/g, '').trim())
    .filter(Boolean);

  const sections: DirectorPromptSection[] = [];
  const push = (label: string, body: string, tone?: DirectorPromptSectionTone) => {
    const b = String(body || '').trim();
    if (!b) return;
    sections.push({
      label,
      body: b,
      tone: tone || toneForDirectorPromptLabel(label),
    });
  };

  for (const clause of clauses) {
    const m = clause.match(labelRe);
    if (m) {
      push(m[1], m[2].replace(/[。；;]+$/g, '').trim());
      continue;
    }
    if (/^人物正在面对镜头唱歌/.test(clause)) {
      push('对口型', clause, 'action');
      continue;
    }
    if (/^全片风格锁/.test(clause) || /^【/.test(clause) || /^画面内禁止/.test(clause)) {
      const guardLabel = /^全片风格锁/.test(clause)
        ? '风格锁'
        : /^【对口型/.test(clause)
          ? '对口型约束'
          : /^【非对口型/.test(clause)
            ? '非对口型约束'
            : /^【风格/.test(clause) || /^【单色/.test(clause)
              ? '风格约束'
              : /^画面内禁止/.test(clause)
                ? '无文字'
                : '约束';
      push(guardLabel, clause, 'guard');
      continue;
    }
    // 无标签的画面描写：并入上一段「画面」或新建
    const last = sections[sections.length - 1];
    if (last && last.label === '画面' && last.tone === 'default') {
      last.body = `${last.body}${/[。；;]$/.test(last.body) ? '' : '。'}${clause}`;
    } else {
      push('画面', clause, 'default');
    }
  }

  for (const r of refs) {
    push('参考图', r, 'ref');
  }

  return sections.length ? sections : [{ label: '提示词', body: raw, tone: 'default' }];
}

function directorPromptSectionToneClass(tone: DirectorPromptSectionTone, isDarkMode: boolean): string {
  switch (tone) {
    case 'action':
      return isDarkMode
        ? 'text-sky-200 border-sky-400/40 bg-sky-950'
        : 'text-sky-800 border-sky-200 bg-sky-50';
    case 'style':
    case 'guard':
      return isDarkMode
        ? 'text-amber-100 border-amber-400/35 bg-amber-950'
        : 'text-amber-900 border-amber-200 bg-amber-50';
    case 'lens':
      return isDarkMode
        ? 'text-violet-100 border-violet-400/35 bg-violet-950'
        : 'text-violet-900 border-violet-200 bg-violet-50';
    case 'cast':
      return isDarkMode
        ? 'text-rose-100 border-rose-400/35 bg-rose-950'
        : 'text-rose-900 border-rose-200 bg-rose-50';
    case 'scene':
      return isDarkMode
        ? 'text-emerald-100 border-emerald-400/35 bg-emerald-950'
        : 'text-emerald-900 border-emerald-200 bg-emerald-50';
    case 'ref':
      return isDarkMode
        ? 'text-cyan-100 border-cyan-400/35 bg-cyan-950'
        : 'text-cyan-900 border-cyan-200 bg-cyan-50';
    default:
      return isDarkMode
        ? 'text-white/90 border-white/15 bg-zinc-900'
        : 'text-gray-800 border-gray-200 bg-gray-50';
  }
}

function renderDirectorFinalPromptStructured(
  text: string,
  isDarkMode: boolean,
  assets?: DirectorAsset[],
  stylePictureIndex?: number,
  styleUrl?: string,
): React.ReactNode {
  const sections = parseDirectorFinalPromptSections(
    clarifyDirectorPromptRefPictureNumbers(
      replaceDirectorStyleTextWithImageRef(text, stylePictureIndex ?? 1),
      { styleUrl, libraryAssets: assets },
    ),
  );
  return (
    <div className="flex flex-col gap-2">
      {sections.map((sec, i) => (
        <div
          key={`ps-${i}-${sec.label}`}
          className={`rounded-xl border px-3 py-2 ${directorPromptSectionToneClass(sec.tone, isDarkMode)}`}
        >
          <div
            className={`mb-0.5 text-[11px] font-semibold tracking-wide opacity-80 ${
              isDarkMode ? 'text-white/70' : 'text-gray-600'
            }`}
          >
            {sec.label}
          </div>
          <div className="whitespace-pre-wrap break-words leading-snug">
            {sec.tone === 'action'
              ? highlightVideoPromptActions(sec.body, isDarkMode, assets)
              : assets?.length
                ? highlightDescription(sec.body, assets, isDarkMode)
                : sec.body}
          </div>
        </div>
      ))}
    </div>
  );
}

/** MV 故事大纲：按【小标题】分段着色 */
type MvStoryOutlineTone =
  | 'genre'
  | 'style'
  | 'ending'
  | 'cast'
  | 'world'
  | 'plot'
  | 'subplot'
  | 'foreshadow'
  | 'scenes'
  | 'default';

function toneForMvStoryOutlineLabel(label: string): MvStoryOutlineTone {
  const t = String(label || '').trim();
  if (/故事类型|题材|类型/.test(t)) return 'genre';
  if (/风格|气质|调性/.test(t)) return 'style';
  if (/结局/.test(t)) return 'ending';
  if (/角色|人物|主角|配角/.test(t)) return 'cast';
  if (/背景|世界观|设定/.test(t)) return 'world';
  if (/主线|起因|发展|转折|高潮/.test(t)) return 'plot';
  if (/支线/.test(t)) return 'subplot';
  if (/伏笔|隐藏/.test(t)) return 'foreshadow';
  if (/可拍|场景节点|场景/.test(t)) return 'scenes';
  return 'default';
}

function mvStoryOutlineToneClass(tone: MvStoryOutlineTone, isDarkMode: boolean): string {
  if (isDarkMode) {
    switch (tone) {
      case 'genre':
        return 'border-cyan-400/35 bg-cyan-500/10 text-cyan-100';
      case 'style':
        return 'border-violet-400/35 bg-violet-500/10 text-violet-100';
      case 'ending':
        return 'border-amber-400/35 bg-amber-500/10 text-amber-100';
      case 'cast':
        return 'border-emerald-400/35 bg-emerald-500/10 text-emerald-50';
      case 'world':
        return 'border-orange-400/35 bg-orange-500/10 text-orange-50';
      case 'plot':
        return 'border-sky-400/35 bg-sky-500/10 text-sky-50';
      case 'subplot':
        return 'border-fuchsia-400/35 bg-fuchsia-500/10 text-fuchsia-50';
      case 'foreshadow':
        return 'border-rose-400/35 bg-rose-500/10 text-rose-50';
      case 'scenes':
        return 'border-teal-400/35 bg-teal-500/10 text-teal-50';
      default:
        return 'border-white/12 bg-white/[0.04] text-white/85';
    }
  }
  switch (tone) {
    case 'genre':
      return 'border-cyan-200 bg-cyan-50 text-cyan-950';
    case 'style':
      return 'border-violet-200 bg-violet-50 text-violet-950';
    case 'ending':
      return 'border-amber-200 bg-amber-50 text-amber-950';
    case 'cast':
      return 'border-emerald-200 bg-emerald-50 text-emerald-950';
    case 'world':
      return 'border-orange-200 bg-orange-50 text-orange-950';
    case 'plot':
      return 'border-sky-200 bg-sky-50 text-sky-950';
    case 'subplot':
      return 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-950';
    case 'foreshadow':
      return 'border-rose-200 bg-rose-50 text-rose-950';
    case 'scenes':
      return 'border-teal-200 bg-teal-50 text-teal-950';
    default:
      return 'border-gray-200 bg-gray-50 text-gray-900';
  }
}

function parseMvStoryOutlineSections(
  text: string,
): Array<{ label: string; body: string; tone: MvStoryOutlineTone }> {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return [];
  const re = /【([^】]+)】/g;
  const hits: Array<{ label: string; index: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) != null) {
    hits.push({ label: m[1].trim(), index: m.index, end: m.index + m[0].length });
  }
  if (!hits.length) {
    return [{ label: '故事', body: raw, tone: 'default' }];
  }
  const sections: Array<{ label: string; body: string; tone: MvStoryOutlineTone }> = [];
  const preface = raw.slice(0, hits[0].index).trim();
  if (preface) {
    sections.push({ label: '前言', body: preface, tone: 'default' });
  }
  for (let i = 0; i < hits.length; i++) {
    const cur = hits[i];
    const nextStart = i + 1 < hits.length ? hits[i + 1].index : raw.length;
    const body = raw.slice(cur.end, nextStart).replace(/^\s+/, '').replace(/\s+$/, '');
    sections.push({
      label: cur.label,
      body: body || '—',
      tone: toneForMvStoryOutlineLabel(cur.label),
    });
  }
  return sections;
}

function renderMvStoryOutlineColored(text: string, isDarkMode: boolean): React.ReactNode {
  const sections = parseMvStoryOutlineSections(text);
  return (
    <div className="flex flex-col gap-2">
      {sections.map((sec, i) => (
        <div
          key={`story-sec-${i}-${sec.label}`}
          className={`rounded-xl border px-3 py-2 ${mvStoryOutlineToneClass(sec.tone, isDarkMode)}`}
        >
          <div
            className={`mb-0.5 text-[11px] font-semibold tracking-wide ${
              isDarkMode ? 'text-white/75' : 'opacity-80'
            }`}
          >
            【{sec.label}】
          </div>
          <div className="whitespace-pre-wrap break-words leading-relaxed opacity-95">{sec.body}</div>
        </div>
      ))}
    </div>
  );
}

/** 大纲着色预览：text 未变时跳过正则分段，减轻 busyAction 切换时的主线程压力 */
const MvStoryOutlineColoredView = memo(function MvStoryOutlineColoredView({
  text,
  isDarkMode,
}: {
  text: string;
  isDarkMode: boolean;
}) {
  return <>{renderMvStoryOutlineColored(text, isDarkMode)}</>;
});

function highlightVideoPromptActions(
  text: string,
  isDarkMode: boolean,
  assets?: DirectorAsset[],
): React.ReactNode {
  const raw = String(text || '');
  if (!raw) return raw;
  const blueCls = isDarkMode ? 'text-sky-400 font-medium' : 'text-sky-600 font-medium';
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(VIDEO_PROMPT_ACTION_SPAN_RE.source, 'gi');
  while ((match = re.exec(raw)) != null) {
    const start = match.index;
    const end = start + match[0].length;
    if (start > last) {
      const before = raw.slice(last, start);
      nodes.push(
        <span key={`g-${last}`}>
          {assets?.length ? highlightDescription(before, assets, isDarkMode) : before}
        </span>,
      );
    }
    nodes.push(
      <span key={`a-${start}`} className={blueCls}>
        {match[0]}
      </span>,
    );
    last = end;
  }
  if (last < raw.length) {
    const rest = raw.slice(last);
    nodes.push(
      <span key={`g-${last}`}>
        {assets?.length ? highlightDescription(rest, assets, isDarkMode) : rest}
      </span>,
    );
  }
  return nodes.length > 0 ? nodes : raw;
}

function countReadyInList(list: DirectorAsset[]): number {
  return (list || []).filter((a) => String(a.imageUrl || '').trim()).length;
}

/** 导演 LLM 等待者放模块级：HMR / React Flow 重挂时实例 ref 会丢，SUCCESS 仍能交给原 Promise */
type DirectorChatWaiter = {
  resolve: (t: string) => void;
  reject: (e: Error) => void;
  gen: number;
  requestId: string;
};
const directorChatWaiters = new Map<string, DirectorChatWaiter>();
const directorChatTextByNodeId = new Map<string, { requestId: string; text: string; at: number }>();

/** 批量 Skill 优化：按 nodeId 等待，支持多路并发 */
type DirectorSkillOptWaiter = {
  resolve: (t: string) => void;
  reject: (e: Error) => void;
  directorId: string;
};
const directorSkillOptWaiters = new Map<string, DirectorSkillOptWaiter>();
/** SUCCESS 可能早于 waiter 注册，或 invoke 返回后事件迟到：先暂存再消费 */
const directorSkillOptTextByNodeId = new Map<string, { text: string; at: number }>();
const DIRECTOR_SKILL_OPT_STASH_TTL_MS = 120_000;

function directorSkillOptNodeId(directorNodeId: string, requestId: string): string {
  return `${String(directorNodeId || '').trim()}__skillOpt__${String(requestId || '').trim()}`;
}

function parseDirectorSkillOptNodeId(
  packetNodeId: string,
  directorNodeId: string,
): string | null {
  const prefix = `${String(directorNodeId || '').trim()}__skillOpt__`;
  const raw = String(packetNodeId || '');
  if (!raw.startsWith(prefix)) return null;
  const requestId = raw.slice(prefix.length).trim();
  return requestId || null;
}

function rejectDirectorSkillOptWaiters(directorNodeId: string, reason: string) {
  const prefix = `${String(directorNodeId || '').trim()}__skillOpt__`;
  for (const [nodeId, waiter] of [...directorSkillOptWaiters.entries()]) {
    if (!nodeId.startsWith(prefix) && waiter.directorId !== directorNodeId) continue;
    directorSkillOptWaiters.delete(nodeId);
    directorSkillOptTextByNodeId.delete(nodeId);
    try {
      const err = new Error(reason);
      err.name = 'AbortError';
      waiter.reject(err);
    } catch {
      /* ignore */
    }
  }
}

function takeDirectorSkillOptStash(nodeId: string): string | null {
  const hit = directorSkillOptTextByNodeId.get(nodeId);
  if (!hit) return null;
  directorSkillOptTextByNodeId.delete(nodeId);
  if (Date.now() - hit.at > DIRECTOR_SKILL_OPT_STASH_TTL_MS) return null;
  return hit.text || null;
}

/** 模块级监听：不依赖 React effect，避免 patch 重建时漏接 SUCCESS 导致「优化无结果」 */
let directorSkillOptListenerBound = false;
function ensureDirectorSkillOptStatusListener(): void {
  if (directorSkillOptListenerBound) return;
  if (typeof window === 'undefined' || !window.electronAPI?.onAIStatusUpdate) return;
  directorSkillOptListenerBound = true;
  window.electronAPI.onAIStatusUpdate((packet: {
    nodeId?: string;
    status?: string;
    payload?: { text?: string; content?: string; result?: string; error?: string };
  }) => {
    const nodeId = String(packet?.nodeId || '');
    if (!nodeId.includes('__skillOpt__')) return;
    if (packet.status === 'SUCCESS') {
      const text = coerceAssistantText(
        packet.payload?.text ?? packet.payload?.content ?? packet.payload?.result ?? '',
      );
      if (text) {
        directorSkillOptTextByNodeId.set(nodeId, { text, at: Date.now() });
      }
      const waiter = directorSkillOptWaiters.get(nodeId);
      if (!waiter) return;
      directorSkillOptWaiters.delete(nodeId);
      if (text) {
        directorSkillOptTextByNodeId.delete(nodeId);
        waiter.resolve(text);
      } else {
        waiter.reject(new Error('empty-skill-prompt'));
      }
      return;
    }
    if (packet.status === 'ERROR') {
      directorSkillOptTextByNodeId.delete(nodeId);
      const waiter = directorSkillOptWaiters.get(nodeId);
      if (!waiter) return;
      directorSkillOptWaiters.delete(nodeId);
      waiter.reject(new Error(String(packet.payload?.error || 'optimize-failed')));
    }
  });
}

function directorPhaseChatKey(directorNodeId: string): string {
  return `${String(directorNodeId || '').trim()}-director-phase-chat`;
}

function looksLikeMvStoryOutlineText(text: string): boolean {
  const s = String(text || '').trim();
  if (s.length < 40) return false;
  if (/"plot"\s*:/.test(s) || /段号\s*\|/.test(s)) return false;
  return /【\s*(故事类型|主线|角色)\s*】/.test(s);
}

function stashDirectorChatText(chatNodeId: string, requestId: string, text: string) {
  const t = String(text || '').trim();
  if (!t) return;
  directorChatTextByNodeId.set(chatNodeId, { requestId, text: t, at: Date.now() });
}

function clearDirectorChatTextStash(chatNodeId: string) {
  directorChatTextByNodeId.delete(chatNodeId);
}

/** 镜号在进度表 / 画布表里可能是 6、06、ep:id:06，放弃等待必须一起清 */
function directorShotNoKeyAliases(
  shotNo: string,
  state?: { mode?: string; activeDramaEpisodeId?: string } | null,
): string[] {
  const no = String(shotNo || '').trim();
  if (!no) return [];
  const keys = new Set<string>([no]);
  if (/^\d+$/.test(no)) {
    keys.add(no.padStart(2, '0'));
    keys.add(String(Number.parseInt(no, 10)));
  }
  const ep = String(state?.activeDramaEpisodeId || '').trim();
  if (state?.mode === 'drama' && ep) {
    for (const n of [...keys]) {
      if (!n.startsWith('ep:')) keys.add(`ep:${ep}:${n}`);
    }
  }
  return [...keys];
}

/** 只取「这一次请求」迟到的正文；不会把上一轮成功结果当成新故事。 */
function consumeStashedDirectorChatText(
  chatNodeId: string,
  requestId?: string,
  maxAgeMs = 180_000,
): string {
  const hit = directorChatTextByNodeId.get(chatNodeId);
  if (!hit) return '';
  if (Date.now() - hit.at > maxAgeMs) {
    directorChatTextByNodeId.delete(chatNodeId);
    return '';
  }
  if (requestId && hit.requestId && hit.requestId !== requestId) return '';
  directorChatTextByNodeId.delete(chatNodeId);
  return hit.text;
}

const DirectorNode: React.FC<NodeProps<DirectorNodeData>> = ({ id, data, selected, type: rfNodeType }) => {
  const { locale } = useAppLocale();
  const navigate = useNavigate();
  const tt = useMemo(() => directorPipelineT(locale), [locale]);
  const ktt = useMemo(() => karaokeT(locale), [locale]);
  const wc = useMemo(() => workspaceChromeT(locale), [locale]);
  const { showConfirm, showAlert } = useDarkAlert();
  /** 画布主题明暗；MV 向导在命令模式（明亮）下另见下方 `isDarkMode` 覆写 */
  const { isDarkMode: themeIsDark } = useCanvasTheme();
  const { cloudMap } = useNxModelPricing();
  // 勿订阅 transform zoom：缩放时整棵 Director 树重渲染是平移/缩放掉帧主因之一；工具栏用 CSS --rf-zoom-inv
  const isCanvasInteracting = useGlobalInteractionSelector(
    (s) => s.isGlobalInteracting || s.isVisualInteractionLocked,
  );
  const store = useStoreApi();
  const updateNodeInternals = useUpdateNodeInternals();
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const resizeHandleRef = useRef<HTMLDivElement | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [fontSizePx, setFontSizePx] = useState(() => clampDirectorFontPx(data?.fontSizePx ?? DIRECTOR_FONT_DEFAULT));
  const [isNodeFullscreen, setIsNodeFullscreen] = useState(false);
  const [karaokeOpen, setKaraokeOpen] = useState(false);
  const [karaokeSeed, setKaraokeSeed] = useState<KaraokeProject | null>(null);
  const karaokeEditorActionsRef = useRef<KaraokeSubtitleEditorHandle | null>(null);
  const [karaokeEditorBusy, setKaraokeEditorBusy] =
    useState<KaraokeSubtitleEditorBusy>('idle');
  /** 第1步歌词：本地草稿编辑，失焦再写回（避免受控 patch 重渲染打掉光标 / 打断 IME） */
  const [mvLyricsDraft, setMvLyricsDraft] = useState('');
  const mvLyricsFocusedRef = useRef(false);
  const mvLyricsComposingRef = useRef(false);
  /** 同步真相源：onUpdate 回写 data 前，effect 也能读到最新成片来源，避免上传被合成 URL 打回 */
  const karaokeVideoSourceRef = useRef<'composed' | 'user' | undefined>(
    (data as DirectorNodeData | undefined)?.karaokeVideoSource,
  );
  const karaokeSeedRef = useRef<KaraokeProject | null>(karaokeSeed);
  karaokeSeedRef.current = karaokeSeed;
  /** 分镜表：长按后显示删除 / 拖拽排序 */
  const [shotRowArmedIndex, setShotRowArmedIndex] = useState<number | null>(null);
  const [shotDragFromIndex, setShotDragFromIndex] = useState<number | null>(null);
  const [shotDragOverIndex, setShotDragOverIndex] = useState<number | null>(null);
  const [shotFocusRowIndex, setShotFocusRowIndex] = useState<number | null>(null);
  const shotTableVirtualRef = useRef<DirectorShotTableVirtualHandle | null>(null);
  const shotRowLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shotDragOverIndexRef = useRef<number | null>(null);
  const shotRowGestureRef = useRef<{
    rowIndex: number;
    pointerId: number;
    startX: number;
    startY: number;
    longPressed: boolean;
    dragging: boolean;
  } | null>(null);
  const shotRowSuppressClickRef = useRef(false);

  const sizeW = Math.max(DIRECTOR_MIN_W, Number(data?.width) || DIRECTOR_DEFAULT_W);
  const sizeH = Math.max(DIRECTOR_MIN_H, Number(data?.height) || DIRECTOR_DEFAULT_H);

  /** 由画布节点 type 锁定：director=MV，directorDrama=短剧（不再同模块切换） */
  const moduleMode = directorModeForNodeType(rfNodeType);
  /** 勿把整份 directorDomain 放进 pipeline useMemo：Domain 每次 onUpdate 都会新建 storyboards 引用，触发分镜视频同步死循环 */
  const dramaActiveEpisodeId = useMemo(() => {
    if (moduleMode !== 'drama') return '';
    const domain = (data?.directorDomain as DramaDirectorSession | null) || null;
    const rawEp = String(
      (data?.director as DirectorPipelineState | undefined)?.activeDramaEpisodeId || '',
    ).trim();
    return String(domain?.active_episode_id || rawEp || '').trim();
  }, [
    moduleMode,
    (data?.directorDomain as DramaDirectorSession | null | undefined)?.active_episode_id,
    (data?.director as DirectorPipelineState | undefined)?.activeDramaEpisodeId,
  ]);
  const dramaFirstEpisodeId = useMemo(() => {
    if (moduleMode !== 'drama') return '';
    const domain = (data?.directorDomain as DramaDirectorSession | null) || null;
    return String(domain?.episodes?.[0]?.episode_id || '').trim();
  }, [
    moduleMode,
    (data?.directorDomain as DramaDirectorSession | null | undefined)?.episodes?.[0]?.episode_id,
  ]);
  const state = useMemo(() => {
    const raw = createDefaultDirectorPipelineState(data?.director || {});
    const epForBoards = dramaActiveEpisodeId || dramaFirstEpisodeId;
    const boards = epForBoards
      ? migrateBareDirectorStoryboardsToEpisode(raw.storyboardsByShotNo, epForBoards)
      : raw.storyboardsByShotNo;
    return createDefaultDirectorPipelineState({
      ...raw,
      mode: moduleMode,
      title:
        moduleMode === 'drama'
          ? raw.title === 'MV导演' || !String(raw.title || '').trim()
            ? 'AI短剧导演'
            : raw.title
          : raw.title === 'AI短剧导演' || !String(raw.title || '').trim()
            ? 'MV导演'
            : raw.title,
      // 与 epForBoards / Workspace.hydrate 一致：空 active 时回退首集，避免 migrate 到 ep:首集 后 lookup 打空 sb
      activeDramaEpisodeId: dramaActiveEpisodeId || dramaFirstEpisodeId,
      storyboardsByShotNo: boards,
    });
  }, [data?.director, moduleMode, dramaActiveEpisodeId, dramaFirstEpisodeId]);
  const isMvMode = moduleMode === 'mv';
  const isDramaMode = moduleMode === 'drama';
  const dramaHeaderTitle = useMemo(() => {
    if (!isDramaMode) return '';
    const domain = (data?.directorDomain as DramaDirectorSession | null) || null;
    return domain ? dramaStudioNodeTitle(domain) : '';
  }, [isDramaMode, data?.directorDomain]);
  /** 仅 MV 用向导壳；短剧走经典三步台（确认镜头→准备资产→合成提示词） */
  const isWizardMode = isMvMode;
  /**
   * 命令模式 = 画布明亮/炫彩（`!themeIsDark`），相对暗黑主题。
   * MV/短剧向导在命令模式下强制深色壳（顶栏步骤条 / 圆角面板 / 底栏）；
   * 避免步骤间皮肤不一致。
   * Scratch 主按钮配色仍由祖先 `.light-mode` CSS 生效。
   */
  const isDarkMode = themeIsDark || isMvMode || isDramaMode;
  const directorStateRef = useRef(state);
  const dataRef = useRef(data);
  dataRef.current = data;
  // 父级 props 回写时对齐；本地 persist 会先写 ref，避免被旧 props 短暂盖回
  const dataKaraokeVideoSource = (data as DirectorNodeData | undefined)?.karaokeVideoSource;
  useEffect(() => {
    karaokeVideoSourceRef.current = dataKaraokeVideoSource;
  }, [dataKaraokeVideoSource]);
  useEffect(() => {
    directorStateRef.current = state;
  }, [state]);

  /** 第1步歌词：非编辑时跟随 props；编辑中用本地草稿，避免父级回写重置光标 */
  const mvLyricsProp = String(state.mvMusic?.lyrics || '');
  useEffect(() => {
    if (mvLyricsFocusedRef.current || mvLyricsComposingRef.current) return;
    setMvLyricsDraft(mvLyricsProp);
  }, [mvLyricsProp]);

  const [editing, setEditing] = useState<{ row: number; col: DirectorShotColumnKey } | null>(null);
  /** 分镜/视频步：最终提示词编辑态草稿与 AI 调整意见 */
  const [finalPromptDraft, setFinalPromptDraft] = useState('');
  const [finalPromptOpinion, setFinalPromptOpinion] = useState('');
  const finalPromptOpinionRef = useRef('');
  finalPromptOpinionRef.current = finalPromptOpinion;
  const finalPromptDraftRef = useRef('');
  finalPromptDraftRef.current = finalPromptDraft;
  const finalPromptEditRowRef = useRef<number | null>(null);
  /** 仅用户改过原版才回写；点开预览/点行内按钮不得清掉优化稿绿标 */
  const finalPromptDraftDirtyRef = useRef(false);
  const finalPromptPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    status: finalPromptOpinionDictationStatus,
    isActive: isFinalPromptOpinionDictationActive,
    inputLevel: finalPromptOpinionDictationLevel,
    start: startFinalPromptOpinionDictation,
    stop: stopFinalPromptOpinionDictation,
    cancel: cancelFinalPromptOpinionDictation,
  } = useCloudRealtimeDictation({
    getBaseText: () => {
      const prev = String(finalPromptOpinionRef.current || '').trimEnd();
      return prev ? `${prev} ` : '';
    },
    onLiveText: (full) => {
      setFinalPromptOpinion(full);
    },
    onError: (message) => {
      showAlert(message);
    },
    onMicDenied: () => {
      showAlert(tt.aiReviseFinalPromptMicDenied);
    },
  });

  const finalPromptOpinionMicBusy =
    finalPromptOpinionDictationStatus === 'connecting' ||
    finalPromptOpinionDictationStatus === 'stopping';
  const finalPromptOpinionMicStopping = finalPromptOpinionDictationStatus === 'stopping';

  const { pointerHandlers: finalPromptOpinionMicPointerHandlers } = useDictationPushToTalk({
    start: startFinalPromptOpinionDictation,
    stop: stopFinalPromptOpinionDictation,
    cancel: cancelFinalPromptOpinionDictation,
    status: finalPromptOpinionDictationStatus,
    disabled: finalPromptOpinionMicStopping,
  });

  useEffect(() => {
    const open = isFinalPromptOpinionDictationActive;
    if (!open) return;
    acquireVoiceModalLock();
    return () => releaseVoiceModalLock();
  }, [isFinalPromptOpinionDictationActive]);

  useEffect(() => {
    if (editing?.col !== '最终提示词') {
      cancelFinalPromptOpinionDictation();
    }
  }, [editing, cancelFinalPromptOpinionDictation]);

  /** 确认镜头表：编辑本镜音频起止（行下标） */
  const [editingAudioRow, setEditingAudioRow] = useState<number | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [promptPreview, setPromptPreview] = useState<string | null>(null);
  const [promptPreviewShotNo, setPromptPreviewShotNo] = useState<string | null>(null);
  const [promptPreviewTab, setPromptPreviewTab] = useState<'original' | 'optimized'>('original');
  /** 故事大纲：有内容时默认彩色预览，点击后进入编辑 */
  const [storyOutlineEditing, setStoryOutlineEditing] = useState(false);
  /** 生成刚完成时先显示本地稿，避免父级 props 晚一拍时故事框空白 */
  const [storyOutlineLocal, setStoryOutlineLocal] = useState<string | null>(null);
  const storyOutlineTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (storyOutlineLocal == null) return;
    if (String(state.mvStoryOutline || '') === storyOutlineLocal) {
      setStoryOutlineLocal(null);
    }
  }, [state.mvStoryOutline, storyOutlineLocal]);
  /** 最终提示词悬停结构化大框 */
  const [promptHover, setPromptHover] = useState<{
    text: string;
    title?: string;
    x: number;
    y: number;
    width: number;
    shotNo?: string;
  } | null>(null);
  const promptHoverLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptHoverPanelRef = useRef<HTMLDivElement | null>(null);
  const clearPromptHoverLeaveTimer = useCallback(() => {
    if (promptHoverLeaveTimerRef.current == null) return;
    clearTimeout(promptHoverLeaveTimerRef.current);
    promptHoverLeaveTimerRef.current = null;
  }, []);
  const openPromptHover = useCallback(
    (text: string, e: React.MouseEvent, title?: string, shotNo?: string) => {
      const t = String(text || '').trim();
      if (!t) return;
      clearPromptHoverLeaveTimer();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const pad = 16;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // 尽量铺开阅读，避免小框+滚动条
      const boxW = Math.min(960, Math.max(640, vw - pad * 2));
      let x = rect.right + 10;
      if (x + boxW > vw - pad) x = Math.max(pad, rect.left - boxW - 10);
      if (x + boxW > vw - pad) x = pad;
      // 先贴触发格顶部，渲染后再按实高贴边校正
      let y = Math.max(pad, Math.min(rect.top, vh - pad - 120));
      setPromptHover({ text: t, title, x, y, width: boxW, shotNo });
    },
    [clearPromptHoverLeaveTimer],
  );
  const scheduleClosePromptHover = useCallback(() => {
    clearPromptHoverLeaveTimer();
    promptHoverLeaveTimerRef.current = setTimeout(() => setPromptHover(null), 160);
  }, [clearPromptHoverLeaveTimer]);
  useEffect(() => () => clearPromptHoverLeaveTimer(), [clearPromptHoverLeaveTimer]);
  /** 悬浮框按内容增高后，保证完整落在视口内（无需滚动条） */
  useLayoutEffect(() => {
    if (!promptHover) return;
    const el = promptHoverPanelRef.current;
    if (!el) return;
    const pad = 16;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    let nextX = promptHover.x;
    let nextY = promptHover.y;
    if (nextY + h > vh - pad) nextY = Math.max(pad, vh - pad - h);
    if (nextY < pad) nextY = pad;
    if (nextX + w > vw - pad) nextX = Math.max(pad, vw - pad - w);
    if (nextX < pad) nextX = pad;
    if (nextX !== promptHover.x || nextY !== promptHover.y) {
      setPromptHover((prev) => (prev ? { ...prev, x: nextX, y: nextY } : prev));
    }
  }, [promptHover?.text, promptHover?.width, promptHover?.x, promptHover?.y]);

  // 点悬停框外立刻关掉，避免高层 portal 残留挡住全屏点击
  useEffect(() => {
    if (!promptHover) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('[data-director-prompt-hover="1"]')) return;
      clearPromptHoverLeaveTimer();
      setPromptHover(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [promptHover, clearPromptHoverLeaveTimer]);
  const [imagePreview, setImagePreview] = useState<{ url: string; name: string } | null>(null);
  const [videoPreview, setVideoPreview] = useState<{ url: string; name: string } | null>(null);
  const videoPreviewElRef = useRef<HTMLVideoElement | null>(null);
  const videoPreviewOpenRef = useRef(false);
  const [stylePromptEditId, setStylePromptEditId] = useState<DirectorStylePresetId | null>(null);
  const [stylePromptDraft, setStylePromptDraft] = useState('');
  const stylePickerRef = useRef<HTMLDivElement | null>(null);
  const styleLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const styleLongPressFiredRef = useRef(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [videoSkillRewriteHint, setVideoSkillRewriteHint] = useState<string | null>(null);
  const [optimizingShotNos, setOptimizingShotNos] = useState<string[]>([]);
  const optimizingShotNosRef = useRef<string[]>([]);
  const rewriteMvVideoPromptsToSkillRef = useRef<
    (
      shotNos: string[],
    ) => Promise<{ ok: boolean; overrides: Record<string, string>; failedShotNos: string[] }>
  >(async () => ({ ok: true, overrides: {}, failedShotNos: [] }));
  /** 资产生图进行中的 id（即时 UI，不依赖 assets.status 是否已写回） */
  const [imageGenProgressIds, setImageGenProgressIds] = useState<Record<string, true>>({});
  const markImageGenProgress = useCallback((assetId: string, on: boolean) => {
    const id = String(assetId || '').trim();
    if (!id) return;
    setImageGenProgressIds((prev) => {
      const has = !!prev[id];
      if (on && has) return prev;
      if (!on && !has) return prev;
      if (on) return { ...prev, [id]: true };
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);
  /** 角色试听音生成中的 id（即时绿条，不依赖 voice.status 是否已写回） */
  const [voiceGenProgressIds, setVoiceGenProgressIds] = useState<Record<string, true>>({});
  const voiceGenProgressIdsRef = useRef<Record<string, true>>({});
  /** 试听音开始时间：超过 3 分钟强制失败并撤绿条 */
  const voiceGenStartedAtRef = useRef<Record<string, number>>({});
  /** 本镜音频生成开始时间：满 3 分钟强制失败 */
  const shotAudioStartedAtRef = useRef<Record<string, number>>({});
  const markVoiceGenProgress = useCallback((voiceId: string, on: boolean) => {
    const id = String(voiceId || '').trim();
    if (!id) return;
    const prev = voiceGenProgressIdsRef.current;
    const has = !!prev[id];
    if (on && has) return;
    if (!on && !has) return;
    const next = { ...prev };
    if (on) {
      next[id] = true;
      voiceGenStartedAtRef.current[id] = Date.now();
    } else {
      delete next[id];
      delete voiceGenStartedAtRef.current[id];
    }
    voiceGenProgressIdsRef.current = next;
    setVoiceGenProgressIds(next);
  }, []);
  /** 短剧成片：生成中镜号（即时绿条 + 防连点；与 storyboard.videoStatus 互补） */
  const [videoGenProgressIds, setVideoGenProgressIds] = useState<Record<string, true>>({});
  const videoGenProgressIdsRef = useRef<Record<string, true>>({});
  /** 本轮是否已看到画布表进入 generating（避免旧 ready 成片把绿条清掉） */
  const videoGenSeenGeneratingRef = useRef<Record<string, true>>({});
  /** 点生成时的旧成片 URL：只有 URL 变化才视为本轮完成 */
  const videoGenPrevUrlRef = useRef<Record<string, string>>({});
  /** 点生成时刻：storyboard 尚未写入 startedAt 时，对账用此宽限，避免重生成绿条闪一下就灭 */
  const videoGenMarkedAtRef = useRef<Record<string, number>>({});
  /** 用户点过「放弃等待」的镜号：禁止从 Domain generating 把绿条钉回来 */
  const videoWaitAbandonedRef = useRef<Set<string>>(new Set());
  const markVideoGenProgress = useCallback((shotNo: string, on: boolean) => {
    const id = String(shotNo || '').trim();
    if (!id) return;
    const aliases = directorShotNoKeyAliases(id, directorStateRef.current);
    if (on) {
      for (const a of aliases) videoWaitAbandonedRef.current.delete(a);
    } else {
      for (const a of aliases) videoWaitAbandonedRef.current.add(a);
    }
    setVideoGenProgressIds((prev) => {
      const aliasSet = new Set(aliases);
      if (on) {
        const has = aliases.some((a) => prev[a]);
        if (has && prev[id]) return prev;
        const sb = getDirectorShotStoryboard(directorStateRef.current, id);
        const markedAt = Date.now();
        videoGenSeenGeneratingRef.current[id] = true;
        videoGenPrevUrlRef.current[id] = String(sb.videoUrl || '').trim();
        videoGenMarkedAtRef.current[id] = markedAt;
        for (const a of aliases) {
          videoGenSeenGeneratingRef.current[a] = true;
          if (!(a in videoGenPrevUrlRef.current)) {
            videoGenPrevUrlRef.current[a] = String(sb.videoUrl || '').trim();
          }
          videoGenMarkedAtRef.current[a] = markedAt;
        }
        const next: Record<string, true> = { ...prev, [id]: true };
        videoGenProgressIdsRef.current = next;
        return next;
      }
      let changed = false;
      const next: Record<string, true> = { ...prev };
      for (const k of Object.keys(next)) {
        const kAliases = directorShotNoKeyAliases(k, directorStateRef.current);
        if (aliasSet.has(k) || kAliases.some((a) => aliasSet.has(a))) {
          delete next[k];
          delete videoGenSeenGeneratingRef.current[k];
          delete videoGenPrevUrlRef.current[k];
          delete videoGenMarkedAtRef.current[k];
          changed = true;
        }
      }
      if (!changed) return prev;
      videoGenProgressIdsRef.current = next;
      return next;
    });
    // 重生成：旧成片仍 ready 时立刻把画布表钉成 generating，否则对账会在 startedAt 空窗把绿条清掉
    if (on) {
      const board = directorStateRef.current;
      const sb = getDirectorShotStoryboard(board, id);
      const startedAt =
        Number(sb.videoGeneratingStartedAt) > 0
          ? Number(sb.videoGeneratingStartedAt)
          : Date.now();
      if (
        String(sb.videoStatus || '').trim() !== 'generating' &&
        String(sb.videoStatus || '').trim() !== 'queued'
      ) {
        patchRef.current(
          updateDirectorShotStoryboard(board, id, {
            videoStatus: 'generating',
            videoError: '',
            videoGeneratingStartedAt: startedAt,
          }),
        );
      } else if (!(Number(sb.videoGeneratingStartedAt) > 0)) {
        patchRef.current(
          updateDirectorShotStoryboard(board, id, {
            videoGeneratingStartedAt: startedAt,
          }),
        );
      }
    }
  }, []);
  /**
   * 成片绿条对账（P0）：不依赖 SUCCESS 是否被早退。
   * - 有 URL 且 status=ready/error → 立刻清绿条
   * - 有 URL 且仍标 generating：重新生成宽限内保留；宽限外视为矛盾，收成 ready 并清条
   * - startedAt 缺失时不得永久卡绿条（旧逻辑要求 startedAt>0 导致永不收条）
   */
  const VIDEO_GEN_PROGRESS_GRACE_MS = 12 * 60 * 1000;
  const reconcileVideoGenProgress = useCallback(() => {
    const board = directorStateRef.current;
    const progressIds = Object.keys(videoGenProgressIdsRef.current);
    const shotNos = new Set<string>([
      ...progressIds,
      ...Object.keys(board.storyboardsByShotNo || {}).filter((no) => {
        const st = String(getDirectorShotStoryboard(board, no).videoStatus || '').trim();
        return st === 'generating' || st === 'queued';
      }),
    ]);
    if (shotNos.size === 0) return;

    let nextBoard = board;
    let boardChanged = false;
    const clearProgress: string[] = [];
    const now = Date.now();

    for (const id of shotNos) {
      const sb = getDirectorShotStoryboard(nextBoard, id);
      const st = String(sb.videoStatus || '').trim();
      const hasUrl = !!String(sb.videoUrl || '').trim();
      const startedAt = Number(sb.videoGeneratingStartedAt || 0);
      const markedAt = Number(videoGenMarkedAtRef.current[id] || 0);
      // 无 startedAt：退回用点生成时刻；二者皆无才视为已过宽限
      const inGrace =
        (startedAt > 0 && now - startedAt < VIDEO_GEN_PROGRESS_GRACE_MS) ||
        (markedAt > 0 && now - markedAt < VIDEO_GEN_PROGRESS_GRACE_MS);
      const marked = !!videoGenProgressIdsRef.current[id];
      const prevUrl = String(videoGenPrevUrlRef.current[id] || '');
      const curUrl = String(sb.videoUrl || '').trim();
      const isNewResult = !!curUrl && curUrl !== prevUrl;

      if (st === 'error') {
        clearProgress.push(id);
        continue;
      }

      if (marked) {
        if (st === 'generating' || st === 'queued') {
          videoGenSeenGeneratingRef.current[id] = true;
          // 宽限外仍是旧片 URL / 或无 startedAt：视为卡死，收条
          if (hasUrl && !inGrace && !isNewResult) {
            nextBoard = updateDirectorShotStoryboard(nextBoard, id, {
              videoStatus: 'ready',
              videoError: '',
              videoGeneratingStartedAt: undefined,
            });
            boardChanged = true;
            clearProgress.push(id);
          }
          continue;
        }
        // 旧成片仍是 ready：本轮还没写出新片，不能清绿条（仅宽限内）
        if (st === 'ready' && !isNewResult) {
          if (!inGrace) clearProgress.push(id);
          continue;
        }
        if (st === 'ready' && isNewResult) {
          clearProgress.push(id);
          continue;
        }
        // spawn 失败回滚成 pending：绿条必须立刻收，否则 12 镜会假「生成中」而 API 无请求
        if (!st || st === 'pending') {
          clearProgress.push(id);
        }
        continue;
      }

      if (st === 'ready') {
        clearProgress.push(id);
        continue;
      }
      // 假卡死：成片 URL 已在，却仍标 generating（SUCCESS 早退 / Domain 不同步）
      if (hasUrl && (st === 'generating' || st === 'queued')) {
        if (inGrace && !isNewResult) continue; // 重新生成：旧片仍在，宽限内保留绿条
        nextBoard = updateDirectorShotStoryboard(nextBoard, id, {
          videoStatus: 'ready',
          videoError: '',
          videoGeneratingStartedAt: undefined,
        });
        boardChanged = true;
        clearProgress.push(id);
        continue;
      }
      if (hasUrl && st !== 'generating' && st !== 'queued') {
        clearProgress.push(id);
      }
    }

    if (boardChanged) {
      directorStateRef.current = nextBoard;
      dataRef.current?.onUpdate?.({
        director: nextBoard,
        title: nextBoard.title,
        isGenerating: nextBoard.isGenerating,
        error: nextBoard.error || undefined,
      });
    }
    // Domain 必须与清条同步：storyboard 已 ready 时 boardChanged 可能仍为 false
    if (clearProgress.length) {
      const domain = (dataRef.current?.directorDomain as DramaDirectorSession | null) || null;
      if (domain?.shots?.length) {
        const clearSet = new Set<string>();
        for (const id of clearProgress) {
          for (const a of directorShotNoKeyAliases(id, nextBoard)) clearSet.add(a);
        }
        let domainChanged = false;
        const nextShots = domain.shots.map((s) => {
          const no = String(s.shot_no || '').trim();
          if (!clearSet.has(no) && !directorShotNoKeyAliases(no, nextBoard).some((a) => clearSet.has(a))) {
            return s;
          }
          const boardUrl = String(getDirectorShotStoryboard(nextBoard, no).videoUrl || '').trim();
          const url = String(s.video_url || '').trim() || boardUrl;
          if (!url) {
            if (String(s.video_status || '').trim() === 'generating' || String(s.video_status || '').trim() === 'queued') {
              domainChanged = true;
              return { ...s, video_status: 'pending', video_error: '' };
            }
            return s;
          }
          if (String(s.video_status || '').trim() === 'ready' && String(s.video_url || '').trim() === url) {
            return s;
          }
          domainChanged = true;
          return {
            ...s,
            video_url: url,
            video_status: 'ready',
            video_error: '',
          };
        });
        if (domainChanged) {
          dataRef.current?.onUpdate?.({
            directorDomain: {
              ...domain,
              shots: nextShots,
            },
          });
        }
      }
    }

    if (clearProgress.length) {
      setVideoGenProgressIds((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const id of clearProgress) {
          const aliases = new Set(directorShotNoKeyAliases(id, nextBoard));
          for (const k of Object.keys(next)) {
            if (aliases.has(k) || directorShotNoKeyAliases(k, nextBoard).some((a) => aliases.has(a))) {
              delete next[k];
              delete videoGenSeenGeneratingRef.current[k];
              delete videoGenPrevUrlRef.current[k];
              delete videoGenMarkedAtRef.current[k];
              changed = true;
            }
          }
        }
        if (!changed) return prev;
        videoGenProgressIdsRef.current = next;
        return next;
      });
    }
  }, []);
  useEffect(() => {
    reconcileVideoGenProgress();
  }, [state.storyboardsByShotNo, reconcileVideoGenProgress]);
  useEffect(() => {
    const hasWork =
      Object.keys(videoGenProgressIds).length > 0 ||
      Object.values(state.storyboardsByShotNo || {}).some((sb) => {
        const st = String(sb?.videoStatus || '').trim();
        return st === 'generating' || st === 'queued';
      });
    if (!hasWork) return;
    const timer = window.setInterval(() => {
      reconcileVideoGenProgress();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [videoGenProgressIds, state.storyboardsByShotNo, reconcileVideoGenProgress]);
  /** 节点重挂载或 Domain 被 PROCESSING 重新钉住时，把绿条 id 从 video_status 补回来 */
  useEffect(() => {
    const domain = (dataRef.current?.directorDomain as DramaDirectorSession | null) || null;
    const shots = domain?.shots || [];
    if (!shots.length) return;
    const board = directorStateRef.current;
    const healReady: Array<{ no: string; url: string }> = [];
    setVideoGenProgressIds((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const s of shots) {
        const no = String(s.shot_no || '').trim();
        if (!no) continue;
        const aliases = directorShotNoKeyAliases(no, board);
        if (aliases.some((a) => videoWaitAbandonedRef.current.has(a))) continue;
        const st = String(s.video_status || '').trim();
        if (st !== 'generating' && st !== 'queued') continue;
        const sb = getDirectorShotStoryboard(board, no);
        const sbSt = String(sb.videoStatus || '').trim();
        const sbUrl = String(sb.videoUrl || '').trim();
        const domainUrl = String(s.video_url || '').trim();
        const url = sbUrl || domainUrl;
        const startedAt = Number(sb.videoGeneratingStartedAt || 0);
        const markedAt = Math.max(
          0,
          ...aliases.map((a) => Number(videoGenMarkedAtRef.current[a] || 0)),
        );
        const inGrace =
          (startedAt > 0 && Date.now() - startedAt < VIDEO_GEN_PROGRESS_GRACE_MS) ||
          (markedAt > 0 && Date.now() - markedAt < VIDEO_GEN_PROGRESS_GRACE_MS);
        const progressMarked = aliases.some((a) => next[a] || videoGenProgressIdsRef.current[a]);
        const prevUrl =
          aliases.map((a) => String(videoGenPrevUrlRef.current[a] || '').trim()).find(Boolean) ||
          '';
        const isNewResult = !!url && !!prevUrl && url !== prevUrl;

        // 重新生成：旧成片 URL / 画布仍 ready 不得立刻治愈。
        // 旧逻辑 `!inGrace || sbSt === 'ready'` 会在宽限内因 ready 清绿条；
        // 且 `domainUrl` 恒真导致点生成瞬间 startedAt 空窗也治愈。
        if (url && (sbSt === 'ready' || (!sbSt && sbUrl) || domainUrl)) {
          if (isNewResult) {
            healReady.push({ no, url });
            for (const a of aliases) {
              if (next[a]) {
                delete next[a];
                changed = true;
              }
            }
            continue;
          }
          if (inGrace || progressMarked) {
            // 宽限内或已钉绿条：保留 generating，必要时补 id
            if (!aliases.some((a) => next[a])) {
              next[no] = true;
              changed = true;
            }
            continue;
          }
          // 宽限外且未钉条：才把卡死的 Domain generating 收成 ready
          healReady.push({ no, url });
          for (const a of aliases) {
            if (next[a]) {
              delete next[a];
              changed = true;
            }
          }
          continue;
        }
        if (!aliases.some((a) => next[a])) {
          next[no] = true;
          changed = true;
        }
      }
      if (!changed) return prev;
      videoGenProgressIdsRef.current = next;
      return next;
    });
    if (healReady.length && domain?.shots?.length) {
      const map = new Map(healReady.map((h) => [h.no, h.url] as const));
      dataRef.current?.onUpdate?.({
        directorDomain: {
          ...domain,
          shots: domain.shots.map((s) => {
            const no = String(s.shot_no || '').trim();
            const url =
              map.get(no) ||
              [...map.entries()].find(([k]) =>
                directorShotNoKeyAliases(k, board).includes(no),
              )?.[1];
            if (!url) return s;
            return {
              ...s,
              video_url: url,
              video_status: 'ready',
              video_error: '',
            };
          }),
        },
      });
    }
  }, [data?.directorDomain]);
  /** 点生成后立刻把画布表标成 generating，避免对账看到旧 ready 把绿条清掉 */
  useEffect(() => {
    const ids = Object.keys(videoGenProgressIds);
    if (!ids.length) return;
    let next = directorStateRef.current;
    let changed = false;
    const clearIds: string[] = [];
    for (const id of ids) {
      const aliases = directorShotNoKeyAliases(id, next);
      if (aliases.some((a) => videoWaitAbandonedRef.current.has(a))) continue;
      const sb = getDirectorShotStoryboard(next, id);
      const st = String(sb.videoStatus || '').trim();
      const curUrl = String(sb.videoUrl || '').trim();
      const prevUrl =
        aliases.map((a) => String(videoGenPrevUrlRef.current[a] || '').trim()).find(Boolean) ||
        String(videoGenPrevUrlRef.current[id] || '');
      const isNewResult = !!curUrl && !!prevUrl && curUrl !== prevUrl;
      const startedAt = Number(sb.videoGeneratingStartedAt || 0);
      const markedAt = Math.max(
        0,
        ...aliases.map((a) => Number(videoGenMarkedAtRef.current[a] || 0)),
      );
      const inGrace =
        (startedAt > 0 && Date.now() - startedAt < VIDEO_GEN_PROGRESS_GRACE_MS) ||
        (markedAt > 0 && Date.now() - markedAt < VIDEO_GEN_PROGRESS_GRACE_MS);
      // 已成片：仅「新 URL」或「宽限外」才清条；宽限内旧 ready 必须钉回 generating
      if (st === 'ready') {
        if (isNewResult || !inGrace) {
          clearIds.push(id);
          continue;
        }
        next = updateDirectorShotStoryboard(next, id, {
          videoStatus: 'generating',
          videoError: '',
          videoGeneratingStartedAt: startedAt || markedAt || Date.now(),
        });
        changed = true;
        continue;
      }
      // 有成片 URL 却仍 pending：当作已完成，清条，勿钉 generating
      if (curUrl && (!st || st === 'pending') && (!inGrace || isNewResult)) {
        clearIds.push(id);
        continue;
      }
      if (st === 'generating' || st === 'queued') continue;
      next = updateDirectorShotStoryboard(next, id, {
        videoStatus: 'generating',
        videoError: '',
        videoGeneratingStartedAt: Number(sb.videoGeneratingStartedAt) || Date.now(),
      });
      changed = true;
    }
    if (changed) patchRef.current(next);
    if (clearIds.length) {
      for (const id of clearIds) markVideoGenProgress(id, false);
    }
  }, [videoGenProgressIds, markVideoGenProgress]);
  /** 音乐步 AI识别 / 歌曲分析：取消令牌（递增 gen 使进行中的 await 失效） */
  const musicJobGenRef = useRef(0);
  const musicJobCancelledRef = useRef(false);
  const [lyricTimelineProgress, setLyricTimelineProgress] = useState('');
  const [libraryPick, setLibraryPick] = useState<{
    assetId: string;
    kind: 'character' | 'scene';
  } | null>(null);
  const [libraryItems, setLibraryItems] = useState<Array<{ id: string; label: string; url: string }>>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  /** MV 选角：内置作品参考图选择 */
  const [castArtworkPickAssetId, setCastArtworkPickAssetId] = useState<string | null>(null);
  const [plotRawEditOpen, setPlotRawEditOpen] = useState(false);
  const [priceHoverKey, setPriceHoverKey] = useState<string | null>(null);
  /** 确认镜头：本镜角色选择弹出 */
  const [castPickerShotNo, setCastPickerShotNo] = useState<string | null>(null);
  /** 确认镜头：本镜场景选择弹出 */
  const [scenePickerShotNo, setScenePickerShotNo] = useState<string | null>(null);
  /** 确认镜头：分镜图上传来源菜单 */
  const [sbSourceMenuShotNo, setSbSourceMenuShotNo] = useState<string | null>(null);
  /** 视频/分镜步：选择本镜历史分镜图 */
  const [sbPickerShotNo, setSbPickerShotNo] = useState<string | null>(null);
  const sbPickerLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 视频步：选择本镜历史成片 */
  const [videoPickerShotNo, setVideoPickerShotNo] = useState<string | null>(null);
  const videoPickerLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sbUploadShotNoRef = useRef<string | null>(null);
  const sbUploadInputRef = useRef<HTMLInputElement | null>(null);
  const videoUploadShotNoRef = useRef<string | null>(null);
  const videoUploadInputRef = useRef<HTMLInputElement | null>(null);
  const karaokeVideoUploadInputRef = useRef<HTMLInputElement | null>(null);
  /** 第 7 步成片格：当前拖入高亮的镜号 */
  const [shotVideoDropShotNo, setShotVideoDropShotNo] = useState<string | null>(null);
  /** 成片预览：默认静音；总开关打开后悬停任意成片出声 */
  const [shotVideoUnmuted, setShotVideoUnmuted] = useState<Record<string, boolean>>({});
  const [videoHoverSoundOn, setVideoHoverSoundOn] = useState(false);
  const [sourceMenuAssetId, setSourceMenuAssetId] = useState<string | null>(null);
  const sourceMenuRef = useRef<HTMLDivElement | null>(null);
  /** 选角形象菜单：portal 到 body，避免被面板 overflow 裁切 */
  const sourceMenuPortalRef = useRef<HTMLDivElement | null>(null);
  const [sourceMenuFixedStyle, setSourceMenuFixedStyle] = useState<{
    left: number;
    bottom: number;
    minWidth: number;
  } | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const styleRefUploadInputRef = useRef<HTMLInputElement | null>(null);
  const musicAudioInputRef = useRef<HTMLInputElement | null>(null);
  /** 风格库 Tab：影视风格 / 我的风格 */
  /**
   * 分镜/视频大表：仅当前阶段挂载重内容。
   * 旧「保活 hidden」会在切换后同时挂两张全表（缩略图+波形+video），镜头一多主线程卡死；
   * 卸载非活动表换来的 remount 成本远小于双表常驻。
   */
  const shotsPanelActive = state.phase === 'shots';
  const videosPanelActive =
    (isMvMode && state.phase === 'videos');
  // 短剧 V2 视频步由 DramaStudioHost 承接，不再走旧 videos 面板
  const karaokePanelActive = isMvMode && state.phase === 'karaoke';
  const videosPanelHostRef = useRef<HTMLDivElement | null>(null);
  /** 卸载视频表时释放 decoder，避免隐藏/切换后仍占解码槽 */
  const setVideosPanelHost = useCallback((el: HTMLDivElement | null) => {
    if (!el && videosPanelHostRef.current) {
      videosPanelHostRef.current.querySelectorAll('video').forEach((node) => {
        const v = node as HTMLVideoElement;
        try {
          v.pause();
          v.removeAttribute('src');
          v.load();
        } catch {
          /* ignore */
        }
      });
    }
    videosPanelHostRef.current = el;
  }, []);
  const [musicDropActive, setMusicDropActive] = useState(false);
  const uploadAssetIdRef = useRef<string | null>(null);
  const imageGenQueueRef = useRef<DirectorAsset[]>([]);
  const imageGenActiveRef = useRef(false);
  /** 正在请求中的资产图（可多路并行） */
  const imageGenInFlightRef = useRef<Set<string>>(new Set());
  const imageGenMaxParallelRef = useRef(NEXFLOW_MAX_TASK_CONCURRENCY);
  const IMAGE_GEN_MAX_PARALLEL_DEFAULT = NEXFLOW_MAX_TASK_CONCURRENCY;
  const IMAGE_GEN_MAX_PARALLEL_SCENE_BATCH = NEXFLOW_MAX_TASK_CONCURRENCY;
  const sbGenQueueRef = useRef<string[]>([]);
  /** 正在请求中的镜号（可多路并行） */
  const sbGenInFlightRef = useRef<Set<string>>(new Set());
  const runNextSbGenRef = useRef<(() => Promise<void>) | null>(null);
  const SB_GEN_MAX_PARALLEL = NEXFLOW_MAX_TASK_CONCURRENCY;
  /** 稳定 patch：勿依赖整个 data，否则连线灌入 mvMusic 后 patch 重建会触发 effect 用旧状态回写把音乐清掉 */
  const patch = useCallback(
    (next: DirectorPipelineState) => {
      const locked =
        next.mode === moduleMode
          ? next
          : createDefaultDirectorPipelineState({ ...next, mode: moduleMode });
      directorStateRef.current = locked;
      dataRef.current?.onUpdate?.({
        director: locked,
        title: locked.title,
        isGenerating: locked.isGenerating,
        error: locked.error || undefined,
      });
    },
    [moduleMode],
  );
  const patchRef = useRef(patch);
  patchRef.current = patch;

  const abandonVideoWait = useCallback(
    (shotNo: string) => {
      const no = String(shotNo || '').trim();
      if (!no) return;
      markVideoGenProgress(no, false);
      const board = directorStateRef.current;
      const sb = getDirectorShotStoryboard(board, no);
      const hasUrl = !!String(sb.videoUrl || '').trim();
      patch(
        updateDirectorShotStoryboard(board, no, {
          videoStatus: hasUrl ? 'ready' : 'pending',
          videoError: '',
          videoGeneratingStartedAt: undefined,
        }),
      );
      const cur = dataRef.current;
      const domain = (cur?.directorDomain as DramaDirectorSession | null) || null;
      if (domain?.shots?.length) {
        const aliasSet = new Set(directorShotNoKeyAliases(no, board));
        const nextDomain: DramaDirectorSession = {
          ...domain,
          shots: domain.shots.map((s) => {
            const sn = String(s.shot_no || '').trim();
            if (!sn) return s;
            const hit =
              aliasSet.has(sn) ||
              directorShotNoKeyAliases(sn, board).some((a) => aliasSet.has(a));
            if (!hit) return s;
            const url = String(s.video_url || '').trim() || String(sb.videoUrl || '').trim();
            return {
              ...s,
              video_status: url ? 'ready' : 'pending',
            };
          }),
        };
        dataRef.current = cur ? { ...cur, directorDomain: nextDomain } : cur;
        cur?.onUpdate?.({ directorDomain: nextDomain });
      }
    },
    [markVideoGenProgress, patch],
  );

  /** 本镜音频：放弃本地「生成中」等待（云端任务不撤回） */
  const abandonShotAudioWait = useCallback(
    (shotId: string) => {
      const sid = String(shotId || '').trim();
      if (!sid) return;
      delete shotAudioStartedAtRef.current[sid];
      cancelDirectorShotAudioWaiter(directorShotAudioNodeId(id, sid));
      const domain = (dataRef.current?.directorDomain as DramaDirectorSession | null) || null;
      if (!domain?.shots?.length) return;
      const shot = domain.shots.find((s) => s.shot_id === sid);
      if (!shot || String(shot.audio_status || '') !== 'generating') return;
      const hasUrl = !!String(shot.audio_url || '').trim();
      const next = createEmptyDramaSession({
        ...domain,
        shots: domain.shots.map((s) =>
          s.shot_id === sid
            ? {
                ...s,
                audio_status: hasUrl ? 'ready' : '',
                audio_error: '',
              }
            : s,
        ),
      });
      const cur = dataRef.current;
      if (cur) dataRef.current = { ...cur, directorDomain: next };
      dataRef.current?.onUpdate?.({ directorDomain: next });
    },
    [id],
  );

  const handleApplyStaleScriptUpdateToShot = useCallback(
    (rowIndex: number) => {
      const next = applyDirectorMvStaleScriptUpdateToShot(directorStateRef.current, rowIndex);
      patch(next);
    },
    [patch],
  );

  const handleApplyStaleScriptUpdateToAll = useCallback(() => {
    const next = applyDirectorMvStaleScriptUpdateToAllStaleShots(directorStateRef.current);
    patch(next);
  }, [patch]);

  const handleRebuildShotPromptFromScript = useCallback(
    (rowIndex: number) => {
      const next = rebuildDirectorShotPromptFromScript(directorStateRef.current, rowIndex);
      patch(next);
      setPromptPreviewTab('original');
      void showAlert(tt.videoRebuildPromptDone);
    },
    [patch, showAlert, tt.videoRebuildPromptDone],
  );

  const handleRebuildAllShotPromptsFromScript = useCallback(async () => {
    const ok = await showConfirm(tt.confirmRebuildPromptFromScriptBatch);
    if (!ok) return;
    const next = rebuildDirectorAllShotPromptsFromScript(directorStateRef.current);
    patch(next);
    setPromptPreviewTab('original');
    void showAlert(tt.videoRebuildPromptDone);
  }, [patch, showAlert, showConfirm, tt.confirmRebuildPromptFromScriptBatch, tt.videoRebuildPromptDone]);

  const stalePromptShotCount = useMemo(
    () => (isMvMode ? countDirectorStalePromptShots(state) : 0),
    [isMvMode, state.scriptContentRevision, state.shots, state.storyboardsByShotNo],
  );

  const renderScriptStaleBanner = () => {
    if (!isMvMode || stalePromptShotCount <= 0) return null;
    return (
      <div
        className={`shrink-0 rounded-lg border px-2.5 py-1.5 flex flex-wrap items-center gap-2 ${
          isDarkMode
            ? 'border-amber-400/35 bg-amber-500/10 text-amber-100'
            : 'border-amber-300 bg-amber-50 text-amber-900'
        }`}
        style={{ fontSize: fsChrome }}
      >
        <span className="flex-1 min-w-[12rem]">
          {fillDirectorI18n(tt.scriptPromptsStaleBanner, { n: stalePromptShotCount })}
        </span>
        <button
          type="button"
          className={`nodrag rounded-md px-2 py-1 font-medium ring-1 ${
            isDarkMode
              ? 'bg-amber-500/25 text-amber-50 ring-amber-400/50 hover:bg-amber-500/35'
              : 'bg-amber-100 text-amber-900 ring-amber-300 hover:bg-amber-200'
          }`}
          title={tt.scriptPromptsStaleHint}
          onClick={(e) => {
            e.stopPropagation();
            handleApplyStaleScriptUpdateToAll();
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {tt.scriptPromptsUpdateAllStale}
        </button>
      </div>
    );
  };

  const renderShotNoCellContent = (shotNo: string, rowIndex: number, leading?: React.ReactNode) => {
    const stale = isMvMode && isDirectorShotPromptsStale(state, shotNo);
    return (
      <div className="flex flex-col items-center justify-center gap-0.5 min-w-0">
        <div className="flex items-center justify-center gap-0.5 min-w-0">
          {leading}
          <span
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full ring-1 tabular-nums text-[11px] font-medium shrink-0 ${
              stale
                ? isDarkMode
                  ? 'ring-amber-400/55 text-amber-100'
                  : 'ring-amber-400 text-amber-800'
                : isDarkMode
                  ? 'ring-white/25 text-white/85'
                  : 'ring-gray-300 text-gray-800'
            }`}
          >
            {String(shotNo).padStart(2, '0')}
          </span>
        </div>
        {stale ? (
          <button
            type="button"
            className={`nodrag rounded px-1 py-0.5 text-[10px] font-semibold leading-none ring-1 ${
              isDarkMode
                ? 'bg-sky-500/25 text-sky-100 ring-sky-400/45 hover:bg-sky-500/40'
                : 'bg-sky-50 text-sky-700 ring-sky-300 hover:bg-sky-100'
            }`}
            title={tt.scriptPromptsStaleHint}
            onClick={(e) => {
              e.stopPropagation();
              handleApplyStaleScriptUpdateToShot(rowIndex);
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {tt.scriptPromptsStaleUpdate}
          </button>
        ) : null}
      </div>
    );
  };

  /** 表格内最终提示词：截断展示 + 悬停结构化大框；单击/双击进入「原版」编辑 */
  const renderFinalPromptHoverCell = (opts: {
    text: string;
    /** 编辑弹窗用的原版文案；缺省则用 text */
    editText?: string;
    shotNo?: string;
    rowIndex: number;
    className?: string;
  }) => {
    const finalVal = String(opts.text || '').trim();
      const editVal = String(opts.editText ?? opts.text ?? '').trim();
    const hoverTitle = opts.shotNo
      ? `${tt.colFinalPrompt} · ${tt.colShotNo} ${String(opts.shotNo).padStart(2, '0')}`
      : tt.colFinalPrompt;
    return (
      <div
        className={`nodrag relative cursor-text whitespace-pre-wrap break-words min-h-[18px] text-left line-clamp-4 ${bodyCls} ${
          opts.className || ''
        }`}
        onMouseEnter={(e) => {
          if (finalVal) openPromptHover(finalVal, e, hoverTitle, opts.shotNo);
        }}
        onMouseLeave={scheduleClosePromptHover}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setPromptHover(null);
          openFinalPromptEdit(opts.rowIndex, editVal || finalVal);
        }}
        onClick={(e) => {
          e.stopPropagation();
          setEditingAudioRow(null);
          setPromptHover(null);
          openFinalPromptEdit(opts.rowIndex, editVal || finalVal);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {finalVal ? (
          highlightVideoPromptActions(finalVal, isDarkMode, allAssets)
        ) : (
          <span className={mutedCls}>{tt.pendingPrompt}</span>
        )}
      </div>
    );
  };

  const clearFinalPromptPersistTimer = useCallback(() => {
    if (finalPromptPersistTimerRef.current == null) return;
    clearTimeout(finalPromptPersistTimerRef.current);
    finalPromptPersistTimerRef.current = null;
  }, []);

  const flushFinalPromptDraft = useCallback(() => {
    clearFinalPromptPersistTimer();
    const row = finalPromptEditRowRef.current;
    if (row == null) return;
    const value = finalPromptDraftRef.current;
    if (!finalPromptDraftDirtyRef.current) return;
    const cur = directorStateRef.current;
    const shotNo = String(cur.shots[row]?.['镜号'] || row + 1).trim() || String(row + 1);
    const sb = getDirectorShotStoryboard(cur, shotNo);
    const prevOriginal = String(sb.promptOriginal || cur.shots[row]?.['最终提示词'] || '').trim();
    if (prevOriginal === value) {
      finalPromptDraftDirtyRef.current = false;
      return;
    }
    let nextState = updateDirectorShotCell(cur, row, '最终提示词', value);
    nextState = updateDirectorShotStoryboard(nextState, shotNo, {
      promptOriginal: value,
      promptOptimized: '',
      useOptimizedPrompt: false,
    });
    finalPromptDraftDirtyRef.current = false;
    patch(nextState);
  }, [clearFinalPromptPersistTimer, patch]);

  const scheduleFinalPromptPersist = useCallback(
    (rowIndex: number, value: string) => {
      finalPromptDraftRef.current = value;
      finalPromptEditRowRef.current = rowIndex;
      finalPromptDraftDirtyRef.current = true;
      clearFinalPromptPersistTimer();
      finalPromptPersistTimerRef.current = setTimeout(() => {
        finalPromptPersistTimerRef.current = null;
        const cur = directorStateRef.current;
        const shotNo =
          String(cur.shots[rowIndex]?.['镜号'] || rowIndex + 1).trim() || String(rowIndex + 1);
        const sb = getDirectorShotStoryboard(cur, shotNo);
        const prevOriginal = String(sb.promptOriginal || cur.shots[rowIndex]?.['最终提示词'] || '').trim();
        if (prevOriginal === value) {
          finalPromptDraftDirtyRef.current = false;
          return;
        }
        let nextState = updateDirectorShotCell(cur, rowIndex, '最终提示词', value);
        nextState = updateDirectorShotStoryboard(nextState, shotNo, {
          promptOriginal: value,
          promptOptimized: '',
          useOptimizedPrompt: false,
        });
        finalPromptDraftDirtyRef.current = false;
        patch(nextState);
      }, 300);
    },
    [clearFinalPromptPersistTimer, patch],
  );

  const openFinalPromptEdit = useCallback(
    (rowIndex: number, prompt: string) => {
      clearFinalPromptPersistTimer();
      finalPromptDraftDirtyRef.current = false;
      finalPromptDraftRef.current = prompt;
      finalPromptEditRowRef.current = rowIndex;
      setFinalPromptDraft(prompt);
      setFinalPromptOpinion('');
      if (isMvMode) {
        const shotNo =
          String(directorStateRef.current.shots[rowIndex]?.['镜号'] || rowIndex + 1).trim() ||
          String(rowIndex + 1);
        setEditing(null);
        setPromptHover(null);
        setPromptPreview(prompt);
        setPromptPreviewShotNo(shotNo);
        setPromptPreviewTab('original');
        return;
      }
      setEditing({ row: rowIndex, col: '最终提示词' });
    },
    [clearFinalPromptPersistTimer, isMvMode],
  );

  const closeFinalPromptEdit = useCallback(() => {
    if (busyAction === 'revise-final-prompt') return;
    flushFinalPromptDraft();
    cancelFinalPromptOpinionDictation();
    finalPromptEditRowRef.current = null;
    setEditing(null);
    setFinalPromptOpinion('');
  }, [busyAction, cancelFinalPromptOpinionDictation, flushFinalPromptDraft]);

  const closePromptPreviewModal = useCallback(() => {
    if (busyAction === 'revise-final-prompt') return;
    flushFinalPromptDraft();
    cancelFinalPromptOpinionDictation();
    finalPromptEditRowRef.current = null;
    setFinalPromptOpinion('');
    setPromptPreview(null);
    setPromptPreviewShotNo(null);
  }, [busyAction, cancelFinalPromptOpinionDictation, flushFinalPromptDraft]);

  useEffect(() => {
    if (editing?.col !== '最终提示词') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closeFinalPromptEdit();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editing, closeFinalPromptEdit]);

  useEffect(
    () => () => {
      clearFinalPromptPersistTimer();
    },
    [clearFinalPromptPersistTimer],
  );

  useEffect(() => {
    if (
      !castPickerShotNo &&
      !scenePickerShotNo &&
      !sbSourceMenuShotNo &&
      !sbPickerShotNo &&
      !videoPickerShotNo
    ) {
      return;
    }
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('[data-director-picker-keep]')) return;
      if (sbPickerLeaveTimerRef.current) {
        clearTimeout(sbPickerLeaveTimerRef.current);
        sbPickerLeaveTimerRef.current = null;
      }
      if (videoPickerLeaveTimerRef.current) {
        clearTimeout(videoPickerLeaveTimerRef.current);
        videoPickerLeaveTimerRef.current = null;
      }
      setCastPickerShotNo(null);
      setScenePickerShotNo(null);
      setSbSourceMenuShotNo(null);
      setSbPickerShotNo(null);
      setVideoPickerShotNo(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [castPickerShotNo, scenePickerShotNo, sbSourceMenuShotNo, sbPickerShotNo, videoPickerShotNo]);

  useEffect(
    () => () => {
      if (sbPickerLeaveTimerRef.current) clearTimeout(sbPickerLeaveTimerRef.current);
      if (videoPickerLeaveTimerRef.current) clearTimeout(videoPickerLeaveTimerRef.current);
    },
    [],
  );

  // 已有镜头表若最终提示词为空/占位，按画面描述+景别+光影+对白+音效+运镜回填
  // 短剧：分析后保持「待生成提示词」，由「一键生成全部提示词」显式合成
  useEffect(() => {
    if (isDramaMode) return;
    const style = resolveDirectorStylePrompt(state.stylePresetId, state.globalStyle);
    const nextShots = withComposedDirectorFinalPrompts(state.shots, style, false, {
      shotChangePace: state.mvMusic?.shotChangePace,
      stylePresetId: state.stylePresetId,
    });
    const changed = nextShots.some(
      (s, i) => String(s['最终提示词'] || '') !== String(state.shots[i]?.['最终提示词'] || ''),
    );
    if (!changed) return;
    patchRef.current({
      ...directorStateRef.current,
      shots: nextShots,
    });
  }, [isDramaMode, state.shots, state.stylePresetId, state.globalStyle, state.mvMusic?.shotChangePace]);

  // 短剧：已有镜头表若场次/制作层大量为空，本地自动补齐（兼容旧分析结果 / 模型漏字段）
  useEffect(() => {
    if (!isDramaMode) return;
    const shots = state.shots || [];
    if (shots.length < 1) return;
    const emptyScene = shots.filter((s) => {
      const v = String(s['场号'] || s['地点'] || s['内外景'] || '').trim();
      return !v || v === '—';
    }).length;
    const emptyProd = shots.filter((s) => {
      const v = String(s['制作备注'] || s['连贯性'] || s['参考图绑定'] || '').trim();
      return !v || v === '—';
    }).length;
    // 超过一半镜头缺场次或制作信息才回填，避免用户刻意清空后被反复写回
    if (emptyScene < shots.length / 2 && emptyProd < shots.length / 2) return;
    const sections = state.mvStoryAnalysis?.sections;
    const nextShots = completeDirectorDramaShotLayers(shots, {
      charactersText: String(sections?.characters || ''),
      beats: getDirectorMvPlotBeatsFromState(state),
    });
    const changed = nextShots.some((s, i) => {
      const prev = shots[i];
      if (!prev) return true;
      return (
        String(s['场号'] || '') !== String(prev['场号'] || '') ||
        String(s['内外景'] || '') !== String(prev['内外景'] || '') ||
        String(s['日夜'] || '') !== String(prev['日夜'] || '') ||
        String(s['地点'] || '') !== String(prev['地点'] || '') ||
        String(s['出场人物'] || '') !== String(prev['出场人物'] || '') ||
        String(s['制作备注'] || '') !== String(prev['制作备注'] || '') ||
        String(s['连贯性'] || '') !== String(prev['连贯性'] || '') ||
        String(s['参考图绑定'] || '') !== String(prev['参考图绑定'] || '') ||
        String(s['对白旁白'] || '') !== String(prev['对白旁白'] || '') ||
        String(s['画面描述'] || '') !== String(prev['画面描述'] || '')
      );
    });
    if (!changed) return;
    patchRef.current({
      ...directorStateRef.current,
      shots: nextShots,
    });
  }, [isDramaMode, state.shots, state.mvStoryAnalysis?.sections]);

  const stylePrompt = useMemo(
    () => resolveDirectorStylePrompt(state.stylePresetId, state.globalStyle),
    [state.stylePresetId, state.globalStyle],
  );

  /** 资产生图多为文生；场景带风格参考图时按图生过滤 */
  const directorStyleRefForFilter = useMemo(
    () =>
      resolveDirectorStyleReferenceImageUrl(state.stylePresetId, state.styleReferenceImageUrl),
    [state.stylePresetId, state.styleReferenceImageUrl],
  );
  const directorAssetModelFilter = useCallback(
    (kind?: DirectorAssetKind) => {
      const hasRefs = kind === 'scene' && !!directorStyleRefForFilter;
      return {
        hasRefs,
        refCount: hasRefs ? 1 : 0,
        models: filterImageModelsForMode({
          hasRefs,
          refCount: hasRefs ? 1 : 0,
        }),
      };
    },
    [directorStyleRefForFilter],
  );
  const directorAssetImageModels = useMemo(
    () => directorAssetModelFilter().models,
    [directorAssetModelFilter],
  );
  const directorOrderedImageRefs = useMemo(() => getOrderedAssetsWithImages(state), [state]);
  const directorStoryboardImageModels = useMemo(() => {
    const n = directorOrderedImageRefs.length + (directorStyleRefForFilter ? 1 : 0);
    const hasRefs = n > 0;
    return filterImageModelsForMode({
      hasRefs,
      refCount: hasRefs ? Math.min(4, Math.max(1, n)) : 0,
    });
  }, [directorOrderedImageRefs.length, directorStyleRefForFilter]);

  useEffect(() => {
    const next = normalizeImageModelIfRetired(state.imageModel);
    if (next === (state.imageModel || '')) return;
    patchRef.current({
      ...directorStateRef.current,
      imageModel: next,
    });
  }, [state.imageModel]);

  const resolveShotFinalPrompt = useCallback(
    (shot: { 最终提示词?: string; 画面描述?: string; 景别?: string; 光影氛围?: string; 对白旁白?: string; 音效?: string; 运镜?: string }) => {
      const latest = directorStateRef.current;
      const styleUrl = resolveDirectorStyleReferenceImageUrl(
        latest.stylePresetId,
        latest.styleReferenceImageUrl,
      );
      const library = getOrderedAssetsWithImages(latest);
      const raw = String(shot['最终提示词'] || '').trim();
      const cleanedRaw = directorMvPromptNeedsLookRelock(raw)
        ? stripDirectorPromptInventedLook(raw)
        : raw;
      const base = !shouldAutoSyncDirectorFinalPrompt(cleanedRaw)
        ? replaceDirectorStyleTextWithImageRef(cleanedRaw, 1)
        : replaceDirectorStyleTextWithImageRef(
            composeDirectorShotFinalPrompt(shot, stylePrompt, {
              stylePresetId: latest.stylePresetId,
              stylePictureIndex: 1,
            }) || cleanedRaw,
            1,
          );
      return clarifyDirectorPromptRefPictureNumbers(base, {
        styleUrl,
        libraryAssets: library,
      });
    },
    [stylePrompt],
  );

  const mvShotRefIndicesByRow = useMemo(() => {
    if (!isMvMode) return [] as number[][];
    const refs = getOrderedAssetsWithImages(state);
    const ranges = computeDirectorShotMusicRangesFromState(state);
    const segs = state.mvMusic?.lyricSegments;
    const packs =
      (segs || []).length > 0
        ? packLyricSegmentsIntoShotPacks(segs || [], {
            clipLengthMode: state.mvMusic?.clipLengthMode,
          })
        : [];
    const hasHumanVoiceByShot = state.shots.map((shot, i) => {
      const range = ranges[i];
      if (range) {
        const v = shotAudioRangeHasHumanVoice(segs, range.startSec, range.endSec);
        if (v != null) return v;
      }
      const pack = packs[i];
      if (pack) return !isDirectorLyricShotPackInstrumental(pack);
      if (isDirectorInstrumentalLyricText(shot['对白旁白'])) return false;
      return null as boolean | null;
    });
    return matchDirectorShotsAssetIndices(state.shots, refs, {
      hasHumanVoiceByShot,
      leadAssetIds: listDirectorMvLeadAssetIds(state),
    });
  }, [
    isMvMode,
    state.shots,
    state.assets,
    state.mvCastPlan,
    state.mvMusic?.lyricSegments,
    state.mvMusic?.clipLengthMode,
    state.mvMusic?.durationSec,
    state.storyboardsByShotNo,
  ]);

  const getShotBoundRefIndices = useCallback(
    (
      shot: {
        镜号?: string;
        最终提示词?: string;
        画面描述?: string;
        景别?: string;
        光影氛围?: string;
        对白旁白?: string;
        音效?: string;
        运镜?: string;
      },
      refs: ReturnType<typeof getOrderedAssetsWithImages>,
      rowIndex?: number,
    ) => {
      // MV：用批量匹配（含场景库全覆盖），保证场景图步的每个场景都会出现在镜头表
      let base: number[] = [];
      if (isMvMode && rowIndex != null) {
        base = mvShotRefIndicesByRow[rowIndex] || [];
      } else {
        const matched = matchDirectorAssetIndicesForShot(shot, refs, {
          leadAssetIds: listDirectorMvLeadAssetIds(state),
        });
        const val = resolveShotFinalPrompt(shot);
        const fromBindings = parseDirectorShotRefBindings(val)
          .filter((b) => !/风格/.test(b.kind))
          .map((b) =>
            refs.findIndex((r) => {
              const name = String(r?.name || '').trim();
              return !!name && (name === b.name || name.includes(b.name) || b.name.includes(name));
            }),
          )
          .filter((i) => i >= 0);
        const fromMentions =
          fromBindings.length > 0
            ? fromBindings
            : extractSeedanceImageMentionIndices(val)
                .map((n) => n - 1)
                .filter((i) => i >= 0 && i < refs.length);
        if (fromMentions.length === 0) {
          base = matched;
        } else {
          const mentionHasChar = fromMentions.some((i) => refs[i]?.kind === 'character');
          const mentionHasScene = fromMentions.some((i) => refs[i]?.kind === 'scene');
          if (mentionHasChar && mentionHasScene) {
            base = fromMentions;
          } else {
            const out = [...fromMentions];
            for (const i of matched) {
              const kind = refs[i]?.kind;
              if (kind === 'character' && !mentionHasChar) out.push(i);
              if (kind === 'scene' && !mentionHasScene) out.push(i);
            }
            base = [...new Set(out)].sort((a, b) => a - b);
          }
        }
      }
      if (rowIndex == null) return base;
      const shotNo = String(shot['镜号'] || rowIndex + 1).trim() || String(rowIndex + 1);
      const sb = getDirectorShotStoryboard(state, shotNo);
      let next = base;
      if (Array.isArray(sb.sceneAssetIds)) {
        next = next.filter((i) => refs[i]?.kind !== 'scene');
        for (const id of sb.sceneAssetIds.slice(0, 1)) {
          const i = refs.findIndex((r) => String(r?.id || '') === id && r?.kind === 'scene');
          if (i >= 0 && !next.includes(i)) next.push(i);
        }
      }
      if (Array.isArray(sb.castAssetIds)) {
        next = next.filter((i) => refs[i]?.kind !== 'character');
        for (const id of sb.castAssetIds) {
          const i = refs.findIndex(
            (r) => String(r?.id || '') === id && r?.kind === 'character',
          );
          if (i >= 0 && !next.includes(i)) next.push(i);
        }
      }
      return next;
    },
    [isMvMode, mvShotRefIndicesByRow, resolveShotFinalPrompt, state],
  );

  const getRepairedShotPromptVersions = useCallback(
    (
      shot: {
        镜号?: string;
        最终提示词?: string;
        画面描述?: string;
        地点?: string;
      },
      rowIndex: number,
      sb?: ReturnType<typeof getDirectorShotStoryboard>,
    ) => {
      // 仅读已存版本，禁止在渲染路径调用 repair（曾导致锚点叠层 + 渲染进程卡死）
      const latest = directorStateRef.current;
      const shotNo = String(shot['镜号'] || rowIndex + 1).trim() || String(rowIndex + 1);
      const storyboard = sb || getDirectorShotStoryboard(latest, shotNo);
      const versions = getDirectorShotPromptVersions(shot, storyboard);
      const original = String(versions.original || '').trim();
      const optimized = String(versions.optimized || '').trim();
      const useOptimized = !!optimized && versions.useOptimized;
      return {
        original,
        optimized,
        useOptimized,
        active: useOptimized ? optimized : original,
      };
    },
    [],
  );

  useEffect(() => {
    if (!isMvMode) return;
    const latest = directorStateRef.current;
    let next = latest;
    let changed = false;
    (latest.shots || []).forEach((shot, i) => {
      const shotNo = String(shot['镜号'] || i + 1).trim() || String(i + 1);
      const sb = getDirectorShotStoryboard(next, shotNo);
      const orderedRefs = getOrderedAssetsWithImages(next);
      const boundIdx = getShotBoundRefIndices(shot, orderedRefs, i);
      const boundChars = boundIdx
        .map((idx) => orderedRefs[idx])
        .filter(
          (a): a is (typeof orderedRefs)[number] =>
            !!a && a.kind === 'character' && !!String(a.imageUrl || '').trim(),
        );
      const items = buildDirectorShotRefItems({
        storyboardUrl: String(sb.imageUrl || '').trim() || undefined,
        boundAssets: boundChars,
      });
      const hint = buildDirectorShotSceneStoryHint(shot);
      const rawOpt = String(sb.promptOptimized || '').trim();
      if (rawOpt && directorMvPromptNeedsLookRelock(rawOpt)) {
        const cleaned = repairDirectorMvPromptImageMap(rawOpt, items, hint);
        // 必须真正变短或结构修复；禁止越修越长导致死循环卡死渲染进程
        if (
          cleaned &&
          cleaned !== rawOpt &&
          cleaned.length <= rawOpt.length + 2500 &&
          !directorMvPromptNeedsLookRelock(cleaned)
        ) {
          next = updateDirectorShotStoryboard(next, shotNo, { promptOptimized: cleaned });
          changed = true;
        } else if (cleaned && cleaned !== rawOpt && cleaned.length < rawOpt.length) {
          // 脏稿叠层：允许只做压缩去重写回
          next = updateDirectorShotStoryboard(next, shotNo, { promptOptimized: cleaned });
          changed = true;
        }
      }
      const rawFinal = String(shot['最终提示词'] || '').trim();
      if (rawFinal && directorMvPromptNeedsLookRelock(rawFinal)) {
        const cleanedFinal = repairDirectorMvPromptImageMap(rawFinal, items, hint);
        if (
          cleanedFinal &&
          cleanedFinal !== rawFinal &&
          cleanedFinal.length <= rawFinal.length + 2500 &&
          !directorMvPromptNeedsLookRelock(cleanedFinal)
        ) {
          next = updateDirectorShotCell(next, i, '最终提示词', cleanedFinal);
          changed = true;
        } else if (
          cleanedFinal &&
          cleanedFinal !== rawFinal &&
          cleanedFinal.length < rawFinal.length
        ) {
          next = updateDirectorShotCell(next, i, '最终提示词', cleanedFinal);
          changed = true;
        }
      }
    });
    if (changed) patch(next);
  }, [getShotBoundRefIndices, isMvMode, patch, state.shots, state.storyboardsByShotNo]);

  const rebuildShotBindingWithOverrides = useCallback(
    (
      latest: DirectorPipelineState,
      shotNo: string,
      rowIndex: number,
      overrides: { castAssetIds?: string[]; sceneAssetIds?: string[] },
    ) => {
      const refs = getOrderedAssetsWithImages(latest);
      const shot = latest.shots[rowIndex];
      if (!shot) return latest;
      const sb = getDirectorShotStoryboard(latest, shotNo);
      const castIds =
        overrides.castAssetIds !== undefined
          ? [...new Set(overrides.castAssetIds.map((id) => String(id || '').trim()).filter(Boolean))].slice(
              0,
              2,
            )
          : Array.isArray(sb.castAssetIds)
            ? sb.castAssetIds
            : undefined;
      const sceneIds =
        overrides.sceneAssetIds !== undefined
          ? [...new Set(overrides.sceneAssetIds.map((id) => String(id || '').trim()).filter(Boolean))].slice(
              0,
              1,
            )
          : Array.isArray(sb.sceneAssetIds)
            ? sb.sceneAssetIds
            : undefined;
      let indices = [...(mvShotRefIndicesByRow[rowIndex] || [])];
      if (Array.isArray(sceneIds)) {
        indices = indices.filter((i) => refs[i]?.kind !== 'scene');
        for (const id of sceneIds) {
          const i = refs.findIndex((r) => String(r?.id || '') === id && r?.kind === 'scene');
          if (i >= 0 && !indices.includes(i)) indices.push(i);
        }
      }
      if (Array.isArray(castIds)) {
        indices = indices.filter((i) => refs[i]?.kind !== 'character');
        for (const id of castIds) {
          const i = refs.findIndex((r) => String(r?.id || '') === id && r?.kind === 'character');
          if (i >= 0 && !indices.includes(i)) indices.push(i);
        }
      }

      let nextDesc = String(shot['画面描述'] || '');
      let nextCastOn: string | undefined;
      if (Array.isArray(castIds)) {
        const castNames = castIds
          .map((id) => {
            const a = refs.find((r) => String(r?.id || '') === id && r?.kind === 'character');
            return String(a?.name || '').trim();
          })
          .filter(Boolean);
        nextCastOn = castNames.join('、');
        nextDesc = syncMvShotDescForCastScene(nextDesc, { castNames });
      }
      if (Array.isArray(sceneIds) && sceneIds[0]) {
        const sceneName = String(
          refs.find((r) => String(r?.id || '') === sceneIds[0] && r?.kind === 'scene')?.name || '',
        ).trim();
        if (sceneName) {
          nextDesc = syncMvShotDescForCastScene(nextDesc, { sceneName });
        }
      }

      const patchedShot = {
        ...shot,
        画面描述: nextDesc,
        ...(nextCastOn !== undefined ? { 出场人物: nextCastOn } : {}),
      };
      const stylePrompt = resolveDirectorStylePrompt(latest.stylePresetId, latest.globalStyle);
      const prevPrompt = String(shot['最终提示词'] || '').trim();
      // 用户已改过最终提示词：只更新 @图片 绑定，不再用风格/机位等整段重拼
      const basePrompt = !shouldAutoSyncDirectorFinalPrompt(prevPrompt)
        ? prevPrompt
        : composeDirectorShotFinalPrompt(patchedShot, stylePrompt, {
            stylePresetId: latest.stylePresetId,
          }) ||
          resolveShotFinalPrompt(patchedShot);
      const nextPrompt = applyDirectorShotAssetBindingIndices(
        basePrompt,
        patchedShot,
        refs,
        indices,
        {
          styleUrl: resolveDirectorStyleReferenceImageUrl(
            latest.stylePresetId,
            latest.styleReferenceImageUrl,
          ),
        },
      );

      let next = updateDirectorShotStoryboard(latest, shotNo, {
        ...(overrides.castAssetIds !== undefined ? { castAssetIds: castIds || [] } : {}),
        ...(overrides.sceneAssetIds !== undefined ? { sceneAssetIds: sceneIds || [] } : {}),
      });
      const prevDesc = String(shot['画面描述'] || '').trim();
      const prevCastOn = String((shot as { 出场人物?: string })['出场人物'] || '').trim();
      if (
        nextPrompt !== prevPrompt ||
        nextDesc !== prevDesc ||
        (nextCastOn !== undefined && nextCastOn !== prevCastOn)
      ) {
        next = {
          ...next,
          shots: next.shots.map((s, i) =>
            i === rowIndex
              ? {
                  ...s,
                  画面描述: nextDesc,
                  最终提示词: nextPrompt,
                  ...(nextCastOn !== undefined ? { 出场人物: nextCastOn } : {}),
                }
              : s,
          ),
        };
      }
      return next;
    },
    [mvShotRefIndicesByRow, resolveShotFinalPrompt],
  );

  const applyShotCastAssetIds = useCallback(
    (shotNo: string, rowIndex: number, castIds: string[]) => {
      const uniqIds = [...new Set(castIds.map((id) => String(id || '').trim()).filter(Boolean))].slice(
        0,
        2,
      );
      patch(
        rebuildShotBindingWithOverrides(directorStateRef.current, shotNo, rowIndex, {
          castAssetIds: uniqIds,
        }),
      );
    },
    [patch, rebuildShotBindingWithOverrides],
  );

  const applyShotSceneAssetIds = useCallback(
    (shotNo: string, rowIndex: number, sceneIds: string[]) => {
      const uniqIds = [...new Set(sceneIds.map((id) => String(id || '').trim()).filter(Boolean))].slice(
        0,
        1,
      );
      patch(
        rebuildShotBindingWithOverrides(directorStateRef.current, shotNo, rowIndex, {
          sceneAssetIds: uniqIds,
        }),
      );
    },
    [patch, rebuildShotBindingWithOverrides],
  );

  // MV：按约 5s 一镜补齐镜数，并分配 5/6/10（±1）使总时长匹配歌曲
  // 已有人声时间轴时跳过：时长由乐句边界决定，禁止平均切改写
  useEffect(() => {
    if (!isMvMode || state.phase !== 'shots') return;
    if (!state.shots.length) return;
    if ((state.mvMusic?.lyricSegments || []).length > 0) return;
    const musicSec = Math.round(Number(state.mvMusic?.durationSec) || 0);
    if (musicSec <= 0) return;
    const sumSec = sumDirectorShotsDurationSec(state.shots);
    const durs = state.shots.map((s) => parseDirectorShotDurationSec(s['时长'], 0));
    const maxD = Math.max(0, ...durs);
    const needExpand =
      state.shots.length < Math.max(4, Math.round(musicSec / 5) - 2) || maxD > 10;
    const needAlign = Math.abs(sumSec - musicSec) > 1 || needExpand;
    if (!needAlign) return;
    const aligned = ensureMvShotsMatchMusicDuration(state.shots, musicSec);
    const same =
      aligned.length === state.shots.length &&
      aligned.every(
        (s, i) =>
          String(s['时长'] || '') === String(state.shots[i]?.['时长'] || '') &&
          String(s['镜号'] || '') === String(state.shots[i]?.['镜号'] || ''),
      );
    if (same) return;
    patch({ ...directorStateRef.current, shots: aligned });
  }, [
    isMvMode,
    state.phase,
    state.shots,
    state.mvMusic?.durationSec,
    state.mvMusic?.lyricSegments,
    patch,
  ]);

  /** 确认镜头内容区：实测高度，让节点外框包住全部镜头行（底部栏不再压在中间行上） */
  const shotsLayoutRef = useRef<HTMLDivElement | null>(null);
  const lastAutoShotLayoutRef = useRef({ rows: 0, h: 0, w: 0 });
  /** 音乐步识别分段：内容展开后外框跟着长高 */
  const musicLayoutRef = useRef<HTMLDivElement | null>(null);
  const lastAutoMusicLayoutRef = useRef({ packs: 0, h: 0, w: 0 });
  /** 剧本步：内容撑满显示，外框按内容高度收放（去掉大片空白） */
  const storyLayoutRef = useRef<HTMLDivElement | null>(null);
  const lastAutoStoryLayoutRef = useRef({ key: '', h: 0 });
  // MV 窗口模式：尺寸固定为当前框（仅切到 MV 时校正一次 16:9），内容区内铺满滚动
  useLayoutEffect(() => {
    lastAutoShotLayoutRef.current = { rows: 0, h: 0, w: 0 };
    lastAutoMusicLayoutRef.current = { packs: 0, h: 0, w: 0 };
    lastAutoStoryLayoutRef.current = { key: '', h: 0 };
    if (!isMvMode || isNodeFullscreen) return;
    const curH = Number(dataRef.current?.height) || sizeH;
    const curW = Number(dataRef.current?.width) || sizeW;
    if (curW < 8 || curH < 8) return;
    const aspect = curW / curH;
    if (Math.abs(aspect - DIRECTOR_ASPECT_W_OVER_H) <= 0.03) return;
    const locked = directorMvLockedSize(curW);
    if (Math.abs(curW - locked.width) <= 2 && Math.abs(curH - locked.height) <= 2) return;
    dataRef.current?.onUpdate?.({ width: locked.width, height: locked.height });
    updateNodeInternals(id);
    // 仅随模式/全屏切换校正，避免随内容反复改尺寸
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [isMvMode, isNodeFullscreen, id, updateNodeInternals]);

  const mvStoryLayoutKey = useMemo(() => {
    if (!isMvMode || state.phase !== 'story') return '';
    const a = state.mvStoryAnalysis;
    const sec = normalizeDirectorMvScriptSections(a?.sections);
    return [
      String(a?.summary || ''),
      String(a?.genre || ''),
      (a?.emotions || []).join(','),
      (a?.keywords || []).join(','),
      (a?.scriptKeywords || []).join(','),
      sec.plot,
      sec.worldView,
      sec.relationships,
      sec.characters,
      sec.scenes,
      sec.props,
      String(state.scriptText || ''),
    ].join('\u0001');
  }, [isMvMode, state.phase, state.mvStoryAnalysis, state.scriptText]);

  /** 剧本文本框按内容撑开（节点高度仍锁 16:9，面板内滚动） */
  const syncStoryAutogrowTextareas = useCallback(() => {
    const root = storyLayoutRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLTextAreaElement>('textarea[data-director-autogrow]').forEach((el) => {
      const minRaw = Number(el.dataset.minHeightPx || 0);
      const minPx = Number.isFinite(minRaw) && minRaw > 0 ? minRaw : 72;
      el.style.height = 'auto';
      el.style.height = `${Math.max(minPx, el.scrollHeight)}px`;
    });
  }, []);

  useLayoutEffect(() => {
    if (!isMvMode || state.phase !== 'story') return;
    syncStoryAutogrowTextareas();
  }, [isMvMode, state.phase, mvStoryLayoutKey, syncStoryAutogrowTextareas, fontSizePx]);

  // MV：进入剧本步时，把音乐步已有的分析摘要回填到上方卡片（不重复调用分析）
  useEffect(() => {
    if (!isMvMode || state.phase !== 'story') return;
    const cur = directorStateRef.current;
    const hasSummary = !!String(cur.mvStoryAnalysis?.summary || '').trim();
    if (hasSummary) return;
    const musicSummary = String(cur.mvMusic?.summary || '').trim();
    const moodHint = String(cur.mvMusic?.moodHint || '').trim();
    if (!musicSummary && !moodHint) return;
    const moodParts = moodHint
      .split(/[·•|,，/]/)
      .map((s) => s.trim())
      .filter(Boolean);
    patch(
      patchDirectorMvStoryAnalysis(cur, {
        summary: musicSummary || cur.mvStoryAnalysis?.summary,
        ...(moodParts.length && !(cur.mvStoryAnalysis?.emotions || []).length
          ? { emotions: moodParts.slice(0, 4), keywords: moodParts.slice(4) }
          : {}),
      }),
    );
  }, [isMvMode, state.phase, state.mvMusic?.summary, state.mvMusic?.moodHint, patch]);

  // MV：进入选角步时校正男主/女主槽位文案（避免男主卡片里写着女主描述）
  // 勿依赖整份 characters（含 status/imageUrl），否则一点「生成」写 status 就会重跑
  const castStoryKey = useMemo(() => {
    const sec = normalizeDirectorMvScriptSections(state.mvStoryAnalysis?.sections);
    return [
      String(state.mvStoryOutline || ''),
      sec.characters,
      sec.relationships,
      sec.plot,
    ].join('\0');
  }, [state.mvStoryOutline, state.mvStoryAnalysis, state.scriptText]);
  useEffect(() => {
    if (!isWizardMode || state.phase !== 'cast') return;
    const latest = directorStateRef.current;
    const next = applyAutoDirectorMvCastPlan(latest);
    const before = latest.assets.characters || [];
    const after = next.assets.characters || [];
    const planChanged =
      normalizeDirectorMvCastPlan(latest.mvCastPlan).leadCount !==
        normalizeDirectorMvCastPlan(next.mvCastPlan).leadCount ||
      normalizeDirectorMvCastPlan(latest.mvCastPlan).lead1Gender !==
        normalizeDirectorMvCastPlan(next.mvCastPlan).lead1Gender ||
      normalizeDirectorMvCastPlan(latest.mvCastPlan).lead2Gender !==
        normalizeDirectorMvCastPlan(next.mvCastPlan).lead2Gender;
    const charsChanged =
      before.length !== after.length ||
      before.some(
        (a, i) =>
          String(a?.name || '') !== String(after[i]?.name || '') ||
          String(a?.prompt || '') !== String(after[i]?.prompt || '') ||
          String(a?.gender || '') !== String(after[i]?.gender || ''),
      );
    if (planChanged || charsChanged) patch(next);
  }, [isWizardMode, state.phase, castStoryKey, patch]);

  // 剧情规划若被写成 ```json / 整段 JSON，自动规范成 | 表格（修复「应该是表格却显示代码」）
  const plotJsonRepairKeyRef = useRef('');
  useEffect(() => {
    if (!isMvMode || state.phase !== 'story') return;
    const plot = String(state.mvStoryAnalysis?.sections?.plot || '').trim();
    if (!plot) return;
    // 已是标准表
    if (plot.includes('|') && /段号/.test(plot) && !/"schemaVersion"\s*:/.test(plot)) return;
    if (!/```|schemaVersion|"plot"\s*:/.test(plot)) return;
    const table = coerceDirectorMvPlotToBeatTable(plot);
    if (!table || table === plot) return;
    if (plotJsonRepairKeyRef.current === plot) return;
    plotJsonRepairKeyRef.current = plot;
    const cur = directorStateRef.current;
    const baseSections = normalizeDirectorMvScriptSections(cur.mvStoryAnalysis?.sections);
    const nextSections = { ...baseSections, plot: table };
    let next = {
      ...cur,
      scriptText: composeDirectorMvScriptText(nextSections),
    };
    next = patchDirectorMvStoryAnalysis(next, { sections: nextSections });
    patch(next);
  }, [isMvMode, state.phase, state.mvStoryAnalysis?.sections?.plot, patch]);

  // MV/短剧：确认镜头步若画面/景别/运镜为空，或与剧情表男女/空镜对不上，用剧情表回填
  // 手动添加的全空行不参与判定、不被灌描述（用户要手填）
  const plotBeatSyncKeyRef = useRef('');
  useEffect(() => {
    if (!isWizardMode || state.phase !== 'shots') return;
    if (!state.shots.length) return;
    const plotBeats = getDirectorMvPlotBeatsFromState(directorStateRef.current);
    if (!plotBeats?.length) return;

    const healTargets = state.shots.filter((s) => !isBlankDirectorShot(s));
    if (!healTargets.length) return;

    const emptyDesc = healTargets.filter((s) => !String(s['画面描述'] || '').trim()).length;
    const emptyFrame = healTargets.filter(
      (s) =>
        !String(s['景别'] || '').trim() ||
        !String(s['运镜'] || '').trim() ||
        !String(s['光影氛围'] || '').trim() ||
        !String(s['镜头角度'] || '').trim() ||
        !String(s['焦距'] || '').trim() ||
        String(s['景别'] || '').trim() === '—' ||
        String(s['运镜'] || '').trim() === '—' ||
        String(s['镜头角度'] || '').trim() === '—' ||
        String(s['焦距'] || '').trim() === '—',
    ).length;
    const castMismatch = state.shots.some((s, i) => {
      if (isBlankDirectorShot(s)) return false;
      const beat = mapDirectorMvShotIndexToPlotBeat(i, state.shots.length, plotBeats);
      if (!beat) return false;
      const desc = String(s['画面描述'] || '');
      // 空描述 = 待手填，不当作剧情表错位（否则添加镜头会被 forceDesc 灌满）
      if (!desc.trim() || desc.trim() === '—') return false;
      if (beat.castType === '空镜') return !/空镜|无人物/.test(desc);
      if (/空镜|无人物/.test(desc)) return true;
      const label = resolveDirectorMvBeatCastLabel(beat);
      if (label === '—' || !label) return false;
      if (label.includes('男主') && !desc.includes('男主')) return true;
      if (label.includes('女主') && !desc.includes('女主')) return true;
      return false;
    });
    const beatWithCast = plotBeats.filter((b) => b.castType === '有人').length;
    const shotMarkedEmpty = healTargets.filter((s) =>
      /空镜|无人物/.test(String(s['画面描述'] || '')),
    ).length;
    // 剧情表有大量「有人」但镜头几乎全是空镜 → 强制回填
    const castRatioMismatch =
      beatWithCast >= 3 && shotMarkedEmpty * 2 >= healTargets.length;
    // 画面描述仍嵌套旧版「镜头角度/焦距」文案 → 清掉重复
    const descHasLensDup = healTargets.some((s) =>
      /镜头角度\s*[：:]|焦距\s*[：:]/.test(String(s['画面描述'] || '')),
    );
    const needFill =
      castMismatch ||
      castRatioMismatch ||
      descHasLensDup ||
      emptyDesc * 2 >= healTargets.length ||
      emptyFrame * 2 >= healTargets.length;
    if (!needFill) return;

    const key = `${state.shots.length}|${plotBeats.length}|${emptyDesc}|${emptyFrame}|${castMismatch}|${castRatioMismatch}|${descHasLensDup}|v6|${String(
      plotBeats.map((b) => `${b.castType}:${b.cast}:${b.scene}:${b.angle}:${b.focal}`).join(','),
    )}`;
    if (plotBeatSyncKeyRef.current === key) return;
    plotBeatSyncKeyRef.current = key;

    const latest = directorStateRef.current;
    let shots = applyDirectorMvPlotBeatsToShots(latest.shots, plotBeats, {
      forceDesc: true,
      forceFraming: true,
      closeUpFraming: latest.mvCloseUpFraming !== false,
      preserveBlankShots: true,
    });
    const style = resolveDirectorStylePrompt(latest.stylePresetId, latest.globalStyle);
    shots = withComposedDirectorFinalPrompts(shots, style, true, {
      stylePresetId: latest.stylePresetId,
    });
    // 强制重拼后仍还原手动空行（避免只写出「画风：…」最终提示词）
    shots = shots.map((s, i) =>
      isBlankDirectorShot(latest.shots[i]) ? latest.shots[i] : s,
    );
    let sceneNames = (latest.assets.scenes || [])
      .map((s) => String(s.name || '').trim())
      .filter(Boolean);
    if (!sceneNames.length) {
      sceneNames = parseDirectorMvSceneEntries(getDirectorMvScenesSectionText(latest))
        .map((e) => String(e.name || '').trim())
        .filter(Boolean);
    }
    shots = ensureMvShotsCoverSceneNames(shots, sceneNames);
    const ranges = computeDirectorShotMusicRangesFromState({ ...latest, shots });
    const segs = latest.mvMusic?.lyricSegments;
    const hasHumanVoiceByShot = shots.map((s, i) => {
      const range = ranges[i];
      if (range) {
        const v = shotAudioRangeHasHumanVoice(segs, range.startSec, range.endSec);
        if (v != null) return v;
      }
      if (isDirectorInstrumentalLyricText(s['对白旁白'])) return false;
      return null as boolean | null;
    });
    const rebound = rebindDirectorPipelineAssetRefs(
      { ...latest, shots },
      { hasHumanVoiceByShot },
    );
    patch({ ...latest, shots: rebound.shots });
  }, [
    isWizardMode,
    state.phase,
    state.shots,
    state.mvStoryAnalysis?.sections?.plot,
    state.scriptText,
    patch,
  ]);

  // MV/短剧：剧情表明细列错位时自动纠偏并写回；MV 另按音频片段数强制对齐行数
  const plotHealKeyRef = useRef('');
  useEffect(() => {
    if (!isWizardMode) return;
    if (state.phase !== 'story' && state.phase !== 'shots' && state.phase !== 'videos') return;
    const latest = directorStateRef.current;
    const plotBeats = getDirectorMvPlotBeatsFromState(latest);
    if (!plotBeats?.length) return;
    const clipCount = isMvMode ? resolveDirectorMvAudioClipCount(latest) : 0;
    const rows =
      clipCount > 0 && plotBeats.length !== clipCount
        ? alignDirectorMvPlotBeatsToCount(plotBeats, clipCount) || plotBeats
        : plotBeats;
    const healed = formatDirectorMvPlotBeatTable(rows);
    const sections = normalizeDirectorMvScriptSections(latest.mvStoryAnalysis?.sections);
    const curPlot = String(sections.plot || '').trim();
    if (!curPlot || healed === curPlot) return;
    // 仅当解析后的规范化表与原文不同时写回（纠偏错列 / 补角度焦距 / 对齐段数）
    const key = `${rows.length}|${clipCount}|${healed.length}|${rows.filter((b) => b.castType === '有人').length}`;
    if (plotHealKeyRef.current === key) return;
    plotHealKeyRef.current = key;
    const nextSections = { ...sections, plot: healed };
    let next = { ...latest, scriptText: composeDirectorMvScriptText(nextSections) };
    next = patchDirectorMvStoryAnalysis(next, { sections: nextSections });
    patch(next);
  }, [
    isWizardMode,
    isMvMode,
    state.phase,
    state.mvStoryAnalysis?.sections?.plot,
    state.scriptText,
    state.mvMusic?.lyricSegments,
    state.mvMusic?.clipLengthMode,
    state.mvMusic?.durationSec,
    state.shots?.length,
    patch,
  ]);

  // MV/短剧：补齐未写入画面描述的场景名，并按提示词匹配写入角色/场景绑定
  useEffect(() => {
    if (!isWizardMode || state.phase !== 'shots') return;
    if (!state.shots.length) return;
    const latest = directorStateRef.current;
    const sceneNames = (latest.assets.scenes || [])
      .map((s) => String(s.name || '').trim())
      .filter(Boolean);
    let shots = ensureMvShotsCoverSceneNames(latest.shots, sceneNames);
    const descChanged = shots.some(
      (s, i) => String(s['画面描述'] || '') !== String(latest.shots[i]?.['画面描述'] || ''),
    );
    const refs = getOrderedAssetsWithImages({ ...latest, shots });
    if (refs.length === 0) {
      if (descChanged) patch({ ...latest, shots });
      return;
    }
    const ranges = computeDirectorShotMusicRangesFromState({ ...latest, shots });
    const segs = latest.mvMusic?.lyricSegments;
    const packs =
      (segs || []).length > 0
        ? packLyricSegmentsIntoShotPacks(segs || [], {
            clipLengthMode: latest.mvMusic?.clipLengthMode,
          })
        : [];
    const hasHumanVoiceByShot = shots.map((shot, i) => {
      const range = ranges[i];
      if (range) {
        const v = shotAudioRangeHasHumanVoice(segs, range.startSec, range.endSec);
        if (v != null) return v;
      }
      const pack = packs[i];
      if (pack) return !isDirectorLyricShotPackInstrumental(pack);
      if (isDirectorInstrumentalLyricText(shot['对白旁白'])) return false;
      return null as boolean | null;
    });
    const indexLists = matchDirectorShotsAssetIndices(shots, refs, {
      hasHumanVoiceByShot,
      leadAssetIds: listDirectorMvLeadAssetIds(latest),
    });
    let bindChanged = false;
    shots = shots.map((shot, i) => {
      const prompt = String(shot['最终提示词'] || '').trim();
      if (!prompt) return shot;
      let indices = indexLists[i] || [];
      const shotNo = String(shot['镜号'] || i + 1).trim() || String(i + 1);
      const sb = getDirectorShotStoryboard(latest, shotNo);
      if (Array.isArray(sb.sceneAssetIds)) {
        indices = indices.filter((idx) => refs[idx]?.kind !== 'scene');
        for (const id of sb.sceneAssetIds.slice(0, 1)) {
          const idx = refs.findIndex(
            (r) => String(r?.id || '') === id && r?.kind === 'scene',
          );
          if (idx >= 0 && !indices.includes(idx)) indices.push(idx);
        }
      }
      if (Array.isArray(sb.castAssetIds)) {
        indices = indices.filter((idx) => refs[idx]?.kind !== 'character');
        for (const id of sb.castAssetIds) {
          const idx = refs.findIndex(
            (r) => String(r?.id || '') === id && r?.kind === 'character',
          );
          if (idx >= 0 && !indices.includes(idx)) indices.push(idx);
        }
      }
      const next = applyDirectorShotAssetBindingIndices(prompt, shot, refs, indices, {
        styleUrl: resolveDirectorStyleReferenceImageUrl(
          latest.stylePresetId,
          latest.styleReferenceImageUrl,
        ),
      });
      if (next === prompt) return shot;
      bindChanged = true;
      return { ...shot, 最终提示词: next };
    });
    if (!descChanged && !bindChanged) return;
    patch({ ...latest, shots });
  }, [
    isWizardMode,
    state.phase,
    state.shots,
    state.assets,
    state.mvMusic,
    state.stylePresetId,
    state.styleReferenceImageUrl,
    patch,
  ]);

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();

      setIsResizing(true);
      data?.onUpdate?.({ _isResizing: true } as Partial<DirectorNodeData>);

      const originalCursor = document.body.style.cursor;
      document.body.style.setProperty('cursor', 'nwse-resize', 'important');

      const startX = e.clientX;
      const startY = e.clientY;
      const startW = sizeW;
      const startH = sizeH;
      const lock169 = isWizardMode && !isNodeFullscreen;

      let rafId: number | null = null;
      const scheduleUpdate = () => {
        if (rafId === null) {
          rafId = requestAnimationFrame(() => {
            updateNodeInternals(id);
            rafId = null;
          });
        }
      };

      const onMouseMove = (moveEvent: MouseEvent) => {
        moveEvent.preventDefault();
        moveEvent.stopPropagation();
        const currentZoom = store.getState().transform[2] || 1;
        const deltaX = (moveEvent.clientX - startX) / currentZoom;
        const deltaY = (moveEvent.clientY - startY) / currentZoom;
        let newW = Math.max(DIRECTOR_MIN_W, startW + deltaX);
        let newH = Math.max(DIRECTOR_MIN_H, startH + deltaY);
        if (lock169) {
          // 以水平拖拽为主锁定 16:9
          const byW = directorMvLockedSize(newW);
          const byH = directorMvLockedSize(Math.round(newH * DIRECTOR_ASPECT_W_OVER_H));
          const pick = Math.abs(deltaX) >= Math.abs(deltaY) ? byW : byH;
          newW = pick.width;
          newH = pick.height;
        }
        if (nodeRef.current) {
          nodeRef.current.style.transition = 'none';
          nodeRef.current.style.width = `${newW}px`;
          nodeRef.current.style.height = `${newH}px`;
        }
        scheduleUpdate();
      };

      const onMouseUp = (upEvent: MouseEvent) => {
        const currentZoom = store.getState().transform[2] || 1;
        const deltaX = (upEvent.clientX - startX) / currentZoom;
        const deltaY = (upEvent.clientY - startY) / currentZoom;
        let finalW = Math.max(DIRECTOR_MIN_W, startW + deltaX);
        let finalH = Math.max(DIRECTOR_MIN_H, startH + deltaY);
        if (lock169) {
          const byW = directorMvLockedSize(finalW);
          const byH = directorMvLockedSize(Math.round(finalH * DIRECTOR_ASPECT_W_OVER_H));
          const pick = Math.abs(deltaX) >= Math.abs(deltaY) ? byW : byH;
          finalW = pick.width;
          finalH = pick.height;
        }
        data?.onUpdate?.({
          width: finalW,
          height: finalH,
          isUserResized: true,
          _isResizing: false,
        } as Partial<DirectorNodeData>);
        setIsResizing(false);
        document.body.style.cursor = originalCursor;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        updateNodeInternals(id);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [data, id, isMvMode, isNodeFullscreen, sizeH, sizeW, store, updateNodeInternals],
  );

  useEffect(() => {
    if (data?.fontSizePx !== undefined) setFontSizePx(clampDirectorFontPx(data.fontSizePx));
  }, [data?.fontSizePx]);

  const adjustFontSize = useCallback(
    (delta: number) => {
      setFontSizePx((prev) => {
        const next = clampDirectorFontPx(prev + delta);
        if (next !== prev) data?.onUpdate?.({ fontSizePx: next });
        return next;
      });
    },
    [data],
  );

  const toggleNodeFullscreen = useCallback(() => {
    setIsNodeFullscreen((v) => !v);
  }, []);

  // 短剧：不自动全屏（避免一进节点就拉满整棵导演台 → OOM）；画布内直接嵌工作室，需要时再点工具栏全屏
  useEffect(() => {
    if (!isDramaMode) return;
    setIsNodeFullscreen(false);
  }, [isDramaMode, id]);

  // 短剧提示词优化默认 GPT-4o（旧工程 3.5 一并迁过来）
  useEffect(() => {
    if (!isDramaMode) return;
    const raw = String(directorStateRef.current.chatModel || state.chatModel || '').trim();
    if (raw === DRAMA_PROMPT_OPTIMIZE_MODEL_ID) return;
    if (raw && raw !== 'gpt-3.5-turbo' && raw !== LLM_CHAT_DISPLAY_MODEL_ID) return;
    patch({
      ...directorStateRef.current,
      chatModel: DRAMA_PROMPT_OPTIMIZE_MODEL_ID,
    });
    const domain = (dataRef.current?.directorDomain as DramaDirectorSession | null) || null;
    if (domain) {
      dataRef.current?.onUpdate?.({
        directorDomain: createEmptyDramaSession({
          ...domain,
          meta: { ...domain.meta, chatModel: DRAMA_PROMPT_OPTIMIZE_MODEL_ID },
        }),
      });
    }
  }, [isDramaMode, id, patch]);

  // 同步 React Flow 节点宽高，避免蓝色选框尺寸/位置错位
  useLayoutEffect(() => {
    data?.onUpdate?.({ width: sizeW, height: sizeH });
    updateNodeInternals(id);
    // 仅在尺寸变化时同步；勿依赖 data（避免 onUpdate 循环）
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [id, sizeW, sizeH, updateNodeInternals]);

  useEffect(() => {
    const dismissDirectorOverlays = (): boolean => {
      let closed = false;
      try {
        const hadDropdown = !!document.querySelector('.panel-option-dropdown-backdrop');
        const voiceLocked = isVoiceModalLocked();
        window.dispatchEvent(new CustomEvent('nexflow-force-end-dictation'));
        cancelFinalPromptOpinionDictation();
        forceClearVoiceModalLock();
        forceRemoveOrphanPanelDropdownPortals();
        if (hadDropdown || voiceLocked) closed = true;
      } catch {
        /* ignore */
      }
      if (promptHover != null) {
        setPromptHover(null);
        closed = true;
      }
      if (imagePreview != null) {
        setImagePreview(null);
        closed = true;
      }
      if (promptPreview != null) {
        if (busyAction !== 'revise-final-prompt') {
          closePromptPreviewModal();
          closed = true;
        }
      }
      if (libraryPick != null) {
        setLibraryPick(null);
        closed = true;
      }
      if (batchOpen) {
        setBatchOpen(false);
        closed = true;
      }
      if (videoPreview != null) {
        videoPreviewOpenRef.current = false;
        setVideoPreview(null);
        closed = true;
      }
      if (stylePromptEditId != null) {
        setStylePromptEditId(null);
        closed = true;
      }
      if (storyOutlineEditing) {
        setStoryOutlineEditing(false);
        closed = true;
      }
      if (
        castPickerShotNo != null ||
        scenePickerShotNo != null ||
        sbSourceMenuShotNo != null ||
        sbPickerShotNo != null ||
        videoPickerShotNo != null
      ) {
        setCastPickerShotNo(null);
        setScenePickerShotNo(null);
        setSbSourceMenuShotNo(null);
        setSbPickerShotNo(null);
        setVideoPickerShotNo(null);
        closed = true;
      }
      if (editing?.col === '最终提示词') {
        if (busyAction !== 'revise-final-prompt') {
          closeFinalPromptEdit();
          closed = true;
        }
      } else if (editing != null) {
        setEditing(null);
        closed = true;
      }
      return closed;
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 卡拉OK CSS 全屏预览：交给 KaraokeSubtitleEditor 自己处理
      if (document.querySelector('[data-nexflow-karaoke-preview-fs="1"]')) return;

      const closedOverlay = dismissDirectorOverlays();
      if (closedOverlay) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }

      if (!isNodeFullscreen) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setIsNodeFullscreen(false);
    };

    // capture：先于 Workspace「确认退出应用」，并优先关掉导演遮罩
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [
    isNodeFullscreen,
    promptHover,
    imagePreview,
    promptPreview,
    libraryPick,
    batchOpen,
    videoPreview,
    stylePromptEditId,
    storyOutlineEditing,
    castPickerShotNo,
    scenePickerShotNo,
    sbSourceMenuShotNo,
    sbPickerShotNo,
    videoPickerShotNo,
    editing,
    busyAction,
    closeFinalPromptEdit,
    closePromptPreviewModal,
    cancelFinalPromptOpinionDictation,
  ]);

  // 切后台：仅 visibility hidden 时停听写；勿在 window.blur 取消（麦克风授权框会 blur）
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'hidden') return;
      try {
        window.dispatchEvent(new CustomEvent('nexflow-force-end-dictation'));
        cancelFinalPromptOpinionDictation();
        forceClearVoiceModalLock();
        forceRemoveOrphanPanelDropdownPortals();
      } catch {
        /* ignore */
      }
    };
    const onBlurUnlockChrome = () => {
      try {
        forceClearVoiceModalLock();
        forceRemoveOrphanPanelDropdownPortals();
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('blur', onBlurUnlockChrome);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('blur', onBlurUnlockChrome);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [cancelFinalPromptOpinionDictation]);

  useEffect(() => {
    setDirectorFullscreenNodeId(isNodeFullscreen ? id : null);
    return () => setDirectorFullscreenNodeId(null);
  }, [isNodeFullscreen, id]);

  // 切步骤时清掉悬停提示词大框，避免透明/高层 portal 残留挡住全屏点击
  useEffect(() => {
    setPromptHover(null);
    setPromptPreview(null);
    setImagePreview(null);
    setLibraryPick(null);
    setBatchOpen(false);
    setCastPickerShotNo(null);
    setScenePickerShotNo(null);
    setSbSourceMenuShotNo(null);
    setSbPickerShotNo(null);
    try {
      window.dispatchEvent(new CustomEvent('nexflow-force-end-dictation'));
      cancelFinalPromptOpinionDictation();
      forceClearVoiceModalLock();
      forceRemoveOrphanPanelDropdownPortals();
    } catch {
      /* ignore */
    }
  }, [state.phase, cancelFinalPromptOpinionDictation]);

  const pauseShotThumbVideos = useCallback((keep?: HTMLVideoElement | null) => {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('video[data-director-shot-video]').forEach((el) => {
      if (!(el instanceof HTMLVideoElement)) return;
      if (el === keep || el === videoPreviewElRef.current) return;
      try {
        el.pause();
      } catch {
        /* ignore */
      }
    });
  }, []);

  useEffect(() => {
    if (!isCanvasInteracting) return;
    pauseShotThumbVideos();
  }, [isCanvasInteracting, pauseShotThumbVideos]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('video[data-director-shot-video]').forEach((el) => {
      if (!(el instanceof HTMLVideoElement)) return;
      const shotNo = String(el.getAttribute('data-director-shot-no') || '');
      const unmuted = !!shotVideoUnmuted[shotNo];
      el.muted = !(videoHoverSoundOn || unmuted);
    });
  }, [videoHoverSoundOn, shotVideoUnmuted]);

  const closeVideoPreview = useCallback(() => {
    const v = videoPreviewElRef.current;
    if (v) {
      try {
        v.pause();
        v.removeAttribute('src');
        v.load();
      } catch {
        /* ignore */
      }
    }
    videoPreviewElRef.current = null;
    videoPreviewOpenRef.current = false;
    setVideoPreview(null);
  }, []);

  const openVideoPreview = useCallback(
    (url: string, name: string) => {
      pauseShotThumbVideos();
      videoPreviewOpenRef.current = true;
      setVideoPreview({ url, name });
    },
    [pauseShotThumbVideos],
  );

  // 成片放大：禁止缩略图与弹层双路解码；关闭时彻底释放 decoder，避免二次打开卡死
  useEffect(() => {
    if (!videoPreview) {
      videoPreviewOpenRef.current = false;
      return;
    }
    videoPreviewOpenRef.current = true;
    pauseShotThumbVideos();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      closeVideoPreview();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      const v = videoPreviewElRef.current;
      if (v) {
        try {
          v.pause();
          v.removeAttribute('src');
          v.load();
        } catch {
          /* ignore */
        }
      }
      videoPreviewElRef.current = null;
    };
  }, [videoPreview, pauseShotThumbVideos, closeVideoPreview]);

  const allAssets = useMemo(() => flattenDirectorAssets(state.assets), [state.assets]);
  const missing = useMemo(() => countAssetsMissingImages(state.assets), [state.assets]);
  const assetsProg = useMemo(() => countAssetsWithImages(state.assets), [state.assets]);

  const assetsPhaseSubcopy = useMemo(() => {
    if (isMvMode) {
      const list = state.assets.scenes || [];
      return fillDirectorI18n(tt.assetsStepProgress, {
        step: tt.phaseMvScenes,
        ready: countReadyInList(list),
        total: list.length,
      });
    }
    const step: DirectorAssetsStep =
      state.assetsStep === 'scenes' || state.assetsStep === 'props'
        ? state.assetsStep
        : 'characters';
    const stepKey =
      step === 'characters' ? 'characters' : step === 'scenes' ? 'scenes' : 'props';
    const stepLabel =
      step === 'characters'
        ? tt.assetsStepCharacters
        : step === 'scenes'
          ? tt.assetsStepScenes
          : tt.assetsStepProps;
    const list = state.assets[stepKey] || [];
    if (state.phase === 'assets') {
      return fillDirectorI18n(tt.assetsStepProgress, {
        step: stepLabel,
        ready: countReadyInList(list),
        total: list.length,
      });
    }
    return fillDirectorI18n(tt.assetsProgress, {
      ready: assetsProg.ready,
      total: assetsProg.total || 0,
      left: Math.max(0, (assetsProg.total || 0) - assetsProg.ready),
    });
  }, [isMvMode, state.assetsStep, state.phase, state.assets, assetsProg, tt]);

  const goMvScenesPhase = useCallback(() => {
    let next = setDirectorAssetsStep(setDirectorPhase(directorStateRef.current, 'assets'), 'scenes');
    next = syncDirectorMvScenesFromScript(next, 'fill');
    patch(next);
  }, [patch]);

  const syncMvScenesFromScript = useCallback(
    (mode: 'fill' | 'replace' = 'replace') => {
      const next = syncDirectorMvScenesFromScript(directorStateRef.current, mode);
      const n = parseDirectorMvSceneEntries(getDirectorMvScenesSectionText(next)).length;
      if (!n) {
        showAlert(tt.scenesNeedScript);
        return;
      }
      patch(next);
    },
    [patch, showAlert, tt.scenesNeedScript],
  );

  const scrollCls = isDarkMode ? 'custom-scrollbar-dark' : 'custom-scrollbar';
  /** 生图/分镜队列忙时仍允许单卡入队；仅 LLM/分析等硬忙才锁全局操作 */
  const isDirectorHardBusy =
    !!busyAction && busyAction !== 'images' && busyAction !== 'storyboards';
  /**
   * 故事工具栏禁用只看 busyAction，不看 isGenerating。
   * isGenerating 曾因取消/超时/顶栏字段不同步而卡在 true，导致模型与「生成故事」永久灰掉。
   */
  const isStoryToolbarBusy = !!busyAction;
  /** 无 busyAction 却仍 isGenerating：视为卡死，自动解开 */
  const clearStuckDirectorGenerating = useCallback(() => {
    const cur = directorStateRef.current;
    const topStuck = !!(dataRef.current as DirectorNodeData | undefined)?.isGenerating;
    if (!cur.isGenerating && !topStuck) return;
    patch({ ...cur, isGenerating: false, error: cur.error || '' });
  }, [patch]);

  useEffect(() => {
    if (busyAction) return;
    const stuck =
      !!state.isGenerating || !!(data as DirectorNodeData | undefined)?.isGenerating;
    if (!stuck) return;
    const t = window.setTimeout(() => {
      clearStuckDirectorGenerating();
    }, 1500);
    return () => window.clearTimeout(t);
  }, [busyAction, clearStuckDirectorGenerating, data, state.isGenerating]);

  const titleCls = isDarkMode ? 'text-white/90' : 'text-gray-950';
  const mutedCls = isDarkMode ? 'text-white/45' : 'text-gray-800/70';
  const bodyCls = isDarkMode ? 'text-white/80' : 'text-gray-950';
  const softPanel = isDarkMode
    ? 'bg-white/[0.035]'
    : 'bg-gray-100 border border-gray-200/80';
  const cardCls = isDarkMode
    ? 'rounded-xl bg-white/[0.04] ring-1 ring-white/[0.06] overflow-hidden'
    : 'rounded-xl bg-gray-100 ring-1 ring-gray-200/90 shadow-sm overflow-hidden';
  const linkCls = isDarkMode ? 'text-sky-300 hover:underline' : 'text-gray-800 hover:underline font-medium';
  const tableHeadBg = isDarkMode ? 'bg-zinc-950/95' : 'bg-gray-200/95';
  const rowHover = isDarkMode ? 'hover:bg-white/[0.03]' : 'hover:bg-gray-200/70';
  const shotRowUnseenHighlightCls = isDarkMode
    ? 'bg-sky-500/[0.07] hover:bg-sky-500/[0.11] shadow-[inset_3px_0_0_0_rgb(56,189,248)]'
    : 'bg-sky-50 hover:bg-sky-100/80 shadow-[inset_3px_0_0_0_rgb(14,165,233)]';
  const cellBorder = isDarkMode ? 'border-white/18' : 'border-black/12';
  const accentSpin = isDarkMode ? 'text-sky-300' : 'text-gray-700';
  const fsChrome = Math.max(11, Math.round(fontSizePx * 0.72));
  const fsBody = fontSizePx;
  const fsSmall = Math.max(11, Math.round(fontSizePx * 0.78));

  /** 命令模式按钮 Scratch 色；MV 壳已强制深色（见 isDarkMode 覆写 / index.css） */
  const DIRECTOR_MODULE_SCRATCH: ScratchColorId = 'looks';
  const btnPrimary = (extra = '', _scratch?: ScratchColorId) =>
    assetLibBtnPrimary(isDarkMode, extra, DIRECTOR_MODULE_SCRATCH);
  const btnSecondary = (extra = '', _scratch?: ScratchColorId) =>
    assetLibBtnSecondary(isDarkMode, extra, DIRECTOR_MODULE_SCRATCH);
  const floatToolBtn = (_scratch?: ScratchColorId, active = false, extra = '') =>
    nodeFloatToolBtn(isDarkMode, active, extra, DIRECTOR_MODULE_SCRATCH);

  const sectionShell = (_kind: DirectorAssetKind) => {
    if (isDarkMode) return 'rounded-xl px-2.5 py-2.5 bg-white/[0.02] ring-1 ring-white/[0.04]';
    return 'rounded-xl px-2.5 py-2.5 bg-gray-100 border border-gray-200/70';
  };

  const sectionTitleCls = (_kind: DirectorAssetKind) => {
    if (isDarkMode) return bodyCls;
    return 'text-gray-950';
  };

  const imageGenYuanbao = useCallback(
    (quantity = 1): number | null => {
      return getImageDisplayPrice(
        {
          model: state.imageModel || DEFAULT_IMAGE_MODEL,
          resolution: normalizeDirectorImageResolution(state.imageResolution),
          quantity: Math.max(1, quantity),
        },
        cloudMap,
      );
    },
    [cloudMap, state.imageModel, state.imageResolution],
  );

  const formatYuanbaoLabel = useCallback(
    (quantity = 1) => {
      const y = imageGenYuanbao(quantity);
      if (y == null) return null;
      const modelId = state.imageModel || DEFAULT_IMAGE_MODEL;
      const modelLabel =
        DIRECTOR_IMAGE_MODELS.find((m) => m.value === modelId)?.label || modelId;
      const res = normalizeDirectorImageResolution(state.imageResolution);
      const cost = locale === 'en' ? `${y} ${tt.creditsSuffix}` : `${y}${tt.creditsSuffix}`;
      return `${modelLabel} · ${res} · ${cost}`;
    },
    [imageGenYuanbao, locale, state.imageModel, state.imageResolution, tt.creditsSuffix],
  );

  const videoGenYuanbaoForShot = useCallback(
    (opts: {
      preferLipsync?: boolean;
      durationSec?: number;
      model?: string;
    }): {
      yuanbao: number;
      label: string;
      model: string;
      modelLabel: string;
      duration: string;
      clarity: string;
    } | null => {
      try {
        const modelOverride = String(opts.model || '').trim();
        const model = modelOverride
          ? isDirectorLipsyncModel(modelOverride)
            ? normalizeDirectorVideoLipsyncModel(modelOverride)
            : normalizeDirectorVideoBatchModel(modelOverride)
          : DIRECTOR_MV_FORCE_H3_LIPSYNC && isMvMode
            ? resolveDirectorMvLipsyncModel(state.videoBatchLipsyncModel)
            : opts.preferLipsync
              ? isMvMode
                ? resolveDirectorMvLipsyncModel(state.videoBatchLipsyncModel)
                : normalizeDirectorVideoLipsyncModel(state.videoBatchLipsyncModel)
              : normalizeDirectorVideoBatchModel(state.videoBatchModel);
        const clipSec =
          opts.durationSec && opts.durationSec > 0 ? opts.durationSec : 10;
        // 对口型成片时长跟歌曲片段；展示用真实片段秒数，不计费档位秒数
        const duration = isDirectorLipsyncModel(model)
          ? String(Math.max(1, Math.round(clipSec)))
          : pickNearestDirectorVideoBatchDuration(model, clipSec);
        const resolution = normalizeDirectorVideoBatchResolution(
          model,
          isDirectorLipsyncModel(model)
            ? state.videoBatchLipsyncResolution
            : state.videoBatchResolution,
        );
        const params = buildDirectorVideoPriceParams({
          model,
          duration: isDirectorLipsyncModel(model)
            ? pickNearestDirectorVideoBatchDuration(model, clipSec)
            : duration,
          resolution,
        });
        const y = getVideoDisplayPrice(params, cloudMap);
        if (y == null || !Number.isFinite(y) || y <= 0) return null;
        const modelLabel = directorVideoBatchModelLabel(model);
        const clarity = getDirectorVideoBatchResolutionDisplay(model, resolution);
        const cost = locale === 'en' ? `${y} ${tt.creditsSuffix}` : `${y}${tt.creditsSuffix}`;
        const tier = isDirectorLipsyncModel(model)
          ? `${clarity} · ${duration}s片段`
          : `${duration}s · ${clarity}`;
        return {
          yuanbao: y,
          label: `${modelLabel} · ${tier} · ${cost}`,
          model,
          modelLabel,
          duration,
          clarity,
        };
      } catch (e) {
        if (isModelNotPricedError(e)) return null;
        return null;
      }
    },
    [cloudMap, locale, state.videoBatchModel, state.videoBatchLipsyncModel, state.videoBatchResolution, state.videoBatchLipsyncResolution, tt.creditsSuffix],
  );

  const chatModelForPrice = useMemo(() => {
    const raw = String(state.chatModel || '').trim();
    if ((DIRECTOR_CHAT_MODELS as readonly string[]).includes(raw)) return raw;
    return DIRECTOR_CHAT_MODEL_DEFAULT;
  }, [state.chatModel]);

  const chatRunYuanbao = useMemo((): number | null => {
    if (isDramaMode) {
      return getDramaPromptOptimizeYuanbao(chatModelForPrice);
    }
    try {
      const y = getLlmChatDisplayPrice(cloudMap, 1, chatModelForPrice);
      return Number.isFinite(y) && y > 0 ? y : null;
    } catch {
      return null;
    }
  }, [cloudMap, chatModelForPrice, isDramaMode]);

  /** 云端 fun-asr 文件转写按次价（与 FC /asr/file-transcribe 扣费对齐） */
  const fileTranscribeYuanbao = useMemo((): number | null => {
    try {
      const y = getFileTranscribeDisplayPrice(cloudMap, 1);
      return Number.isFinite(y) && y > 0 ? y : null;
    } catch {
      return null;
    }
  }, [cloudMap]);

  /** 歌曲分析：LLM 风格分析 + 云端转写（展示与实扣合计）；任一侧无 OTS 价则为 null */
  const musicAnalyzeYuanbao = useMemo(() => {
    if (chatRunYuanbao == null || fileTranscribeYuanbao == null) return null;
    return chatRunYuanbao + fileTranscribeYuanbao;
  }, [chatRunYuanbao, fileTranscribeYuanbao]);

  const formatChatYuanbaoLabel = useCallback(() => {
    if (chatRunYuanbao == null) return null;
    return locale === 'en' ? `${chatRunYuanbao} ${tt.creditsSuffix}` : `${chatRunYuanbao}${tt.creditsSuffix}`;
  }, [chatRunYuanbao, locale, tt.creditsSuffix]);

  const formatMusicAnalyzeYuanbaoLabel = useCallback(() => {
    if (musicAnalyzeYuanbao == null) return null;
    return locale === 'en'
      ? `${musicAnalyzeYuanbao} ${tt.creditsSuffix}`
      : `${musicAnalyzeYuanbao}${tt.creditsSuffix}`;
  }, [locale, musicAnalyzeYuanbao, tt.creditsSuffix]);

  const formatFileTranscribeYuanbaoLabel = useCallback(() => {
    if (fileTranscribeYuanbao == null) return null;
    return locale === 'en'
      ? `${fileTranscribeYuanbao} ${tt.creditsSuffix}`
      : `${fileTranscribeYuanbao}${tt.creditsSuffix}`;
  }, [fileTranscribeYuanbao, locale, tt.creditsSuffix]);

  /** 云端转写「请先登录」：查余额 → 够则确认跳登录，不足则充值提示 */
  const promptAsrAuthOrBalance = useCallback(
    async (err: unknown) => {
      const gate = await resolveCloudAuthErrorWithBalance(err, {
        requiredYuanbao: fileTranscribeYuanbao ?? undefined,
      });
      if (gate.action === 'need-login') {
        const msg = gate.balanceEnough ? tt.asrNeedLoginBalanceOk : tt.asrNeedLogin;
        const ok = await showConfirm(msg, { okLabel: tt.goLogin });
        if (ok) {
          void window.electronAPI?.setFullscreen?.(false);
          navigate('/settings', { replace: true });
        }
        return true;
      }
      if (gate.action === 'insufficient') {
        showAlert(tt.asrBalanceInsufficient || CLOUD_BALANCE_INSUFFICIENT_ALERT);
        return true;
      }
      return false;
    },
    [
      fileTranscribeYuanbao,
      navigate,
      showAlert,
      showConfirm,
      tt.asrBalanceInsufficient,
      tt.asrNeedLogin,
      tt.asrNeedLoginBalanceOk,
      tt.goLogin,
    ],
  );

  const yuanbaoHoverTipCls =
    'pointer-events-none absolute left-1/2 z-[80] -translate-x-1/2 bottom-[calc(100%+6px)] whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium tabular-nums shadow-md bg-[#2a2218]/95 text-amber-200/95 border-amber-500/45';
  /** 顶栏按钮用：向下弹出，避免被全屏/面板 overflow 裁切上半 */
  const yuanbaoHoverTipBelowCls =
    'pointer-events-none absolute left-1/2 z-[80] -translate-x-1/2 top-[calc(100%+6px)] bottom-auto whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium tabular-nums shadow-md bg-[#2a2218]/95 text-amber-200/95 border-amber-500/45';

  const renderYuanbaoHoverTip = (key: string, quantity: number) => {
    const label = formatYuanbaoLabel(quantity);
    if (!label || priceHoverKey !== key) return null;
    return (
      <span className={`${yuanbaoHoverTipCls} translate-y-0 opacity-100`} title={tt.priceTooltip}>
        {label}
      </span>
    );
  };

  const renderShotVideoGenMeta = (opts: {
    preferLipsync?: boolean;
    durationSec?: number;
    clipStartSec?: number;
    clipEndSec?: number;
  }) => {
    const priced = videoGenYuanbaoForShot(opts);
    if (!priced) return null;
    const cost =
      locale === 'en' ? `${priced.yuanbao} ${tt.creditsSuffix}` : `${priced.yuanbao}${tt.creditsSuffix}`;
    const clipStart = Number(opts.clipStartSec);
    const clipEnd = Number(opts.clipEndSec);
    const hasClipRange =
      opts.preferLipsync &&
      Number.isFinite(clipStart) &&
      Number.isFinite(clipEnd) &&
      clipEnd > clipStart;
    const clipRange = hasClipRange
      ? `${formatShotAudioClock(clipStart)}–${formatShotAudioClock(clipEnd)}`
      : '';
    // 对口型展示真实片段秒数（起止差），不用计费档位秒数
    const lipsyncDurSec = hasClipRange
      ? Math.max(0.1, clipEnd - clipStart)
      : Number(opts.durationSec) > 0
        ? Number(opts.durationSec)
        : Number(priced.duration) || 0;
    const lipsyncDurLabel =
      lipsyncDurSec >= 10
        ? `${Math.round(lipsyncDurSec)}s片段`
        : `${(Math.round(lipsyncDurSec * 10) / 10).toString().replace(/\.0$/, '')}s片段`;
    return (
      <div
        className={`mt-1 max-w-[220px] leading-snug tabular-nums ${mutedCls}`}
        style={{ fontSize: Math.max(10, fsChrome - 1) }}
        title={priced.label}
      >
        <div className="truncate">{priced.modelLabel}</div>
        <div className="truncate">
          {priced.clarity}
          {' · '}
          {opts.preferLipsync ? lipsyncDurLabel : `${priced.duration}s`}
          {' · '}
          <span className={isDarkMode ? 'text-amber-200/90' : 'text-amber-700'}>{cost}</span>
        </div>
        {clipRange ? (
          <div className="truncate opacity-80">
            {tt.colShotAudio} {clipRange}
          </div>
        ) : null}
      </div>
    );
  };

  const formatBatchVideoYuanbaoLabel = useCallback(() => {
    let total = 0;
    let count = 0;
    const ranges = computeDirectorShotMusicRangesFromState(state);
    const packs =
      (state.mvMusic?.lyricSegments || []).length > 0
        ? packLyricSegmentsIntoShotPacks(state.mvMusic?.lyricSegments || [], {
            clipLengthMode: state.mvMusic?.clipLengthMode,
          })
        : [];
    const songDur = Number(state.mvMusic?.durationSec) || 0;
    for (let i = 0; i < state.shots.length; i++) {
      const shot = state.shots[i];
      const shotNo = String(shot['镜号'] || i + 1);
      const sb = getDirectorShotStoryboard(state, shotNo);
      if (!String(sb?.imageUrl || '').trim()) continue;
      if (!String(shot['最终提示词'] || shot['画面描述'] || '').trim()) continue;
      const range = ranges[i] || {
        startSec: 0,
        endSec: parseDirectorShotDurationSec(shot['时长'], 5),
        durationSec: parseDirectorShotDurationSec(shot['时长'], 5),
      };
      const hasVoice = shotAudioRangeHasHumanVoice(
        state.mvMusic?.lyricSegments,
        range.startSec,
        range.endSec,
      );
      const preferLipsync = resolveDirectorMvForceLipsyncOn(
        isMvMode,
        resolveDirectorShotPreferLipsync(shot, sb, {
          hasHumanVoice: hasVoice,
          packText: packs[i]?.text || String(shot['对白旁白'] || ''),
          audioStartSec: range.startSec,
          songDurationSec: songDur,
          closeUpFramingOn: state.mvCloseUpFraming !== false,
        }),
      );
      const priced = videoGenYuanbaoForShot({
        preferLipsync,
        durationSec: Number(range.durationSec) || parseDirectorShotDurationSec(shot['时长'], 5),
      });
      if (!priced) continue;
      total += priced.yuanbao;
      count += 1;
    }
    if (count <= 0 || total <= 0) return null;
    const cost = locale === 'en' ? `${total} ${tt.creditsSuffix}` : `${total}${tt.creditsSuffix}`;
    return fillDirectorI18n(tt.batchVideoYuanbaoHover, { n: count, cost });
  }, [
    locale,
    state,
    tt.batchVideoYuanbaoHover,
    tt.creditsSuffix,
    videoGenYuanbaoForShot,
  ]);

  const renderBatchVideoYuanbaoHoverTip = (
    key: string,
    opts?: { below?: boolean },
  ) => {
    if (priceHoverKey !== key) return null;
    const label = formatBatchVideoYuanbaoLabel();
    if (!label) return null;
    const tipCls = opts?.below ? yuanbaoHoverTipBelowCls : yuanbaoHoverTipCls;
    return (
      <span className={`${tipCls} translate-y-0 opacity-100`} title={tt.priceTooltip}>
        {label}
      </span>
    );
  };

  const renderChatYuanbaoHoverTip = (key: string) => {
    if (priceHoverKey !== key) return null;
    const label = formatChatYuanbaoLabel();
    if (!label) {
      return (
        <span className={`${yuanbaoHoverTipCls} translate-y-0 opacity-100`} title={tt.otsPriceRequired}>
          {tt.otsPriceRequired}
        </span>
      );
    }
    return (
      <span className={`${yuanbaoHoverTipCls} translate-y-0 opacity-100`} title={tt.priceTooltip}>
        {label}
      </span>
    );
  };

  const renderShotLipsyncToggle = (
    shotNo: string,
    lipsyncOn: boolean,
    priority: 'none' | 'normal' | 'climax' = 'normal',
    faceFarWarning = false,
  ) => {
    const badgeCls = `nodrag shrink-0 rounded-md px-1.5 py-0.5 ring-1 whitespace-nowrap font-medium ${
      lipsyncOn
        ? priority === 'climax'
          ? isDarkMode
            ? 'bg-orange-500/30 text-orange-100 ring-orange-400/60'
            : 'bg-orange-100 text-orange-800 ring-orange-400'
          : isDarkMode
            ? 'bg-emerald-500/25 text-emerald-100 ring-emerald-400/50'
            : 'bg-emerald-100 text-emerald-800 ring-emerald-400'
        : isDarkMode
          ? 'bg-white/[0.04] text-white/35 ring-white/10 hover:text-white/60'
          : 'bg-gray-100 text-gray-400 ring-gray-200 hover:text-gray-600'
    }`;
    const badgeStyle = { fontSize: Math.max(10, fsChrome - 1) };
    return (
    <button
      type="button"
      className={`${badgeCls} transition-colors`}
      style={badgeStyle}
      title={
        lipsyncOn
          ? priority === 'climax'
            ? tt.lipsyncShotBadgeClimax
            : tt.lipsyncShotBadge
          : faceFarWarning
            ? tt.lipsyncShotBadgeFarWarning
            : tt.lipsyncShotBadgeOff
      }
      onClick={(e) => {
        e.stopPropagation();
        void (async () => {
        const latest = directorStateRef.current;
        const nextOn = !lipsyncOn;
        if (nextOn && faceFarWarning) {
          const ok = await showConfirm(tt.lipsyncShotBadgeFarWarning, {
            variant: 'primary',
          });
          if (!ok) return;
        }
        let next = updateDirectorShotStoryboard(latest, shotNo, {
          preferLipsync: nextOn,
        });
        const rowIndex = (next.shots || []).findIndex(
          (s, i) => String(s['镜号'] || i + 1) === String(shotNo),
        );
        if (rowIndex >= 0) {
          const shot = next.shots[rowIndex];
          const lipAction = String(shot['对口型动作'] || '').trim();
          const applyLip = (text: string | undefined | null) => {
            const raw = String(text || '').trim();
            if (!raw) return '';
            if (shouldAutoSyncDirectorFinalPrompt(raw)) {
              return resolveDirectorShotVideoPromptForGen(
                { ...shot, 最终提示词: raw },
                { lipsync: nextOn },
              );
            }
            return applyDirectorLipsyncToggleToFinalPrompt(raw, {
              lipsync: nextOn,
              lipsyncAction: lipAction,
            });
          };
          const nextPrompt = applyLip(shot['最终提示词']);
          const sbNow = getDirectorShotStoryboard(next, shotNo);
          const nextOriginal = applyLip(sbNow.promptOriginal || shot['最终提示词']);
          const nextOptimized = String(sbNow.promptOptimized || '').trim()
            ? applyLip(sbNow.promptOptimized)
            : '';
          next = updateDirectorShotStoryboard(
            {
              ...next,
              shots: next.shots.map((s, i) =>
                i === rowIndex
                  ? { ...s, 最终提示词: nextPrompt || s['最终提示词'] }
                  : s,
              ),
            },
            shotNo,
            {
              ...(nextOriginal ? { promptOriginal: nextOriginal } : {}),
              ...(nextOptimized
                ? { promptOptimized: nextOptimized, promptOptimizedFrom: nextOriginal }
                : {}),
            },
          );
        }
        patch(next);
        })();
      }}
    >
      {tt.lipsyncToggleLabel}
    </button>
    );
  };

  const sectionScratch = (_kind: DirectorAssetKind): ScratchColorId => DIRECTOR_MODULE_SCRATCH;

  const modelSelectCls = isDarkMode
    ? 'nodrag rounded-md px-2 py-1 bg-zinc-950 text-zinc-200 ring-1 ring-white/10'
    : 'nodrag rounded-md px-2 py-1 bg-gray-100 text-gray-800 border border-gray-300 shadow-sm';

  /**
   * MV/剧本：大语言模型下拉。
   * 必须用 portal 菜单（PanelOptionDropdown），勿用原生 select：
   * React Flow transform + 音乐面板 overflow-hidden 会裁切/幽灵化 option，看起来像只剩 GPT-3.5。
   */
  const renderChatModelSelect = (opts?: {
    disabled?: boolean;
    variant?: 'chip' | 'plain';
    menuPlacement?: 'auto' | 'up' | 'down';
  }) => {
    const disabled = opts?.disabled ?? isDirectorHardBusy;
    const variant = opts?.variant ?? 'chip';
    const dropdown = (
      <div
        className={`nodrag nopan shrink-0 ${disabled ? 'pointer-events-none opacity-50' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <PanelOptionDropdown
          value={chatModelForPrice}
          options={directorChatModelOptions(isDramaMode)}
          onChange={(v) => {
            patch({
              ...directorStateRef.current,
              chatModel: v,
            });
            const domain = (dataRef.current?.directorDomain as DramaDirectorSession | null) || null;
            if (domain) {
              dataRef.current?.onUpdate?.({
                directorDomain: createEmptyDramaSession({
                  ...domain,
                  meta: { ...domain.meta, chatModel: v },
                }),
              });
            }
          }}
          isDarkMode={isDarkMode}
          title={tt.chatModelLabel}
          minWidthPx={128}
          menuPlacement={opts?.menuPlacement ?? 'auto'}
          className={
            variant === 'chip'
              ? isDarkMode
                ? '!bg-zinc-950 !text-zinc-100 !border-emerald-400/30'
                : '!bg-gray-100 !text-gray-900 !border-emerald-300'
              : undefined
          }
        />
      </div>
    );
    if (variant === 'plain') {
      return (
        <div
          className={`nodrag flex items-center gap-1 shrink-0 ${mutedCls}`}
          style={{ fontSize: fsChrome }}
          title={tt.chatModelLabel}
        >
          <span className="whitespace-nowrap">{tt.chatModelLabel}</span>
          {dropdown}
        </div>
      );
    }
    return (
      <div
        className={`nodrag nopan inline-flex items-center gap-1.5 shrink-0 rounded-md px-2 py-1 ring-1 ${
          isDarkMode
            ? 'bg-emerald-500/15 text-emerald-100 ring-emerald-400/40'
            : 'bg-emerald-50 text-emerald-900 ring-emerald-300'
        }`}
        style={{ fontSize: fsChrome }}
        title={tt.chatModelLabel}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="font-semibold whitespace-nowrap">{tt.chatModelLabel}</span>
        {dropdown}
      </div>
    );
  };

  const renderImageModelSelect = (opts?: {
    hasRefs?: boolean;
    refCount?: number;
    models?: ReturnType<typeof filterImageModelsForMode>;
    /** 紧凑：与「生成」横排；宽度按最长模型名可读（勿 truncate） */
    compact?: boolean;
  }) => {
    const hasRefs = !!opts?.hasRefs;
    const refCount = hasRefs ? Math.max(1, Number(opts?.refCount) || 1) : 0;
    const modelOptions = opts?.models ?? filterImageModelsForMode({ hasRefs, refCount });
    const selected = pickDirectorImageModel(state.imageModel, hasRefs, refCount);
    return (
      <select
        className={`${modelSelectCls} ${
          opts?.compact
            ? // 覆盖「全能图片 G-2.0」「悠船文生图 v8.1」等完整文案 + 原生箭头
              'shrink-0 w-auto min-w-[12rem]'
            : 'min-w-0'
        }`}
        style={{ fontSize: fsChrome }}
        value={selected}
        disabled={isDirectorHardBusy}
        title={tt.modelLabel}
        onChange={(e) =>
          patch({
            ...directorStateRef.current,
            imageModel: e.target.value,
          })
        }
        onClick={(e) => e.stopPropagation()}
      >
        {modelOptions.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
    );
  };

  const renderImageResolutionSelect = (opts?: {
    compact?: boolean;
    /** 分镜图：不提供 4K */
    exclude4K?: boolean;
  }) => {
    const resRaw = normalizeDirectorImageResolution(state.imageResolution);
    const tiers = (opts?.exclude4K ? (['1K', '2K'] as const) : (['1K', '2K', '4K'] as const));
    const res = opts?.exclude4K && resRaw === '4K' ? '2K' : resRaw;
    return (
      <select
        className={`${modelSelectCls} shrink-0 ${
          opts?.compact ? 'w-[4.5rem] min-w-[4.5rem]' : ''
        }`}
        style={{ fontSize: fsChrome }}
        value={res}
        disabled={isDirectorHardBusy}
        title={tt.videoBatchResolutionLabel}
        onChange={(e) =>
          patch({
            ...directorStateRef.current,
            imageResolution: normalizeDirectorImageResolution(e.target.value),
          })
        }
        onClick={(e) => e.stopPropagation()}
      >
        {tiers.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    );
  };

  const renderImageGenControls = (opts?: {
    compact?: boolean;
    kind?: DirectorAssetKind;
    /** 分镜图生图：用分镜可用模型，且分辨率不含 4K */
    forStoryboard?: boolean;
  }) => {
    const filter = opts?.forStoryboard
      ? {
          hasRefs: directorOrderedImageRefs.length > 0 || !!directorStyleRefForFilter,
          refCount: Math.min(
            4,
            Math.max(
              1,
              directorOrderedImageRefs.length + (directorStyleRefForFilter ? 1 : 0),
            ),
          ),
          models: directorStoryboardImageModels,
        }
      : directorAssetModelFilter(opts?.kind);
    return (
      <div
        className={`flex items-center gap-1 ${
          opts?.compact ? 'flex-nowrap justify-end shrink-0' : 'flex-wrap min-w-0'
        }`}
      >
        {renderImageModelSelect({
          hasRefs: filter.hasRefs,
          refCount: filter.refCount,
          models: filter.models,
          compact: opts?.compact,
        })}
        {renderImageResolutionSelect({
          compact: opts?.compact,
          exclude4K: !!opts?.forStoryboard,
        })}
      </div>
    );
  };

  /** 批量类按钮旁总价条（含模型信息，非场景一键专用） */
  const renderImageBatchPriceBar = (quantity: number) => {
    const label = formatYuanbaoLabel(Math.max(1, quantity));
    if (!label) return null;
    return (
      <div
        className={`w-full leading-snug tabular-nums ${
          isDarkMode ? 'text-amber-200/90' : 'text-amber-700'
        }`}
        style={{ fontSize: Math.max(10, fsChrome - 1) }}
        title={tt.priceTooltip}
      >
        {label}
        {quantity > 1 ? (
          <span className={mutedCls}>
            {locale === 'en' ? ` · ×${quantity}` : ` · ×${quantity}张`}
          </span>
        ) : null}
      </div>
    );
  };

  /** 一键生成场景图悬停价签（「N个场景图共M元宝」，与批量视频 tip 同款样式） */
  const formatBatchSceneYuanbaoLabel = useCallback(
    (quantity: number) => {
      const qty = Math.max(1, quantity);
      const y = imageGenYuanbao(qty);
      if (y == null) return null;
      const cost = locale === 'en' ? `${y} ${tt.creditsSuffix}` : `${y}${tt.creditsSuffix}`;
      return fillDirectorI18n(tt.batchSceneYuanbaoHover, { n: qty, cost });
    },
    [imageGenYuanbao, locale, tt.batchSceneYuanbaoHover, tt.creditsSuffix],
  );

  const renderBatchSceneYuanbaoHoverTip = (key: string, quantity: number) => {
    if (priceHoverKey !== key) return null;
    const label = formatBatchSceneYuanbaoLabel(quantity);
    if (!label) return null;
    return (
      <span className={`${yuanbaoHoverTipBelowCls} translate-y-0 opacity-100`} title={tt.priceTooltip}>
        {label}
      </span>
    );
  };

  /** 全部生成分镜图悬停价签（「N个分镜图共M元宝」；计费=分镜生图单价×数量） */
  const formatBatchStoryboardYuanbaoLabel = useCallback(
    (quantity: number) => {
      const qty = Math.max(1, quantity);
      const y = imageGenYuanbao(qty);
      if (y == null) return null;
      const cost = locale === 'en' ? `${y} ${tt.creditsSuffix}` : `${y}${tt.creditsSuffix}`;
      return fillDirectorI18n(tt.batchStoryboardYuanbaoHover, { n: qty, cost });
    },
    [imageGenYuanbao, locale, tt.batchStoryboardYuanbaoHover, tt.creditsSuffix],
  );

  const renderBatchStoryboardYuanbaoHoverTip = (
    key: string,
    quantity: number,
    opts?: { below?: boolean },
  ) => {
    if (priceHoverKey !== key) return null;
    const label = formatBatchStoryboardYuanbaoLabel(quantity);
    if (!label) return null;
    const tipCls = opts?.below ? yuanbaoHoverTipBelowCls : yuanbaoHoverTipCls;
    return (
      <span className={`${tipCls} translate-y-0 opacity-100`} title={tt.priceTooltip}>
        {label}
      </span>
    );
  };

  /** 场景配置顶栏右对齐：选模 + 分辨率 + 一键生成（含悬停元宝 tip，向下弹出避免顶栏裁切） */
  const renderSceneOneClickGenerate = () => {
    const scenes = state.assets.scenes || [];
    const missingN = scenes.filter((a) => !String(a.imageUrl || '').trim()).length;
    const tipQty = Math.max(1, missingN > 0 ? missingN : scenes.length);
    const tipKey = 'batch-scene-images';
    return (
      <div className="relative z-[50] overflow-visible flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5 shrink-0">
        {renderImageGenControls({ kind: 'scene', compact: true })}
        <span
          className="relative inline-flex shrink-0 overflow-visible"
          onMouseEnter={() => setPriceHoverKey(tipKey)}
          onMouseLeave={() => setPriceHoverKey((k) => (k === tipKey ? null : k))}
        >
          {renderBatchSceneYuanbaoHoverTip(tipKey, tipQty)}
          <button
            type="button"
            className={`nodrag ${btnPrimary('!px-2.5 !py-1 !h-auto', sectionScratch('scene'))} disabled:opacity-40`}
            style={{ fontSize: fsChrome }}
            disabled={isDirectorHardBusy || scenes.length === 0}
            title={tt.batchGenerateSceneImages}
            onClick={() => generateCategory('scene')}
          >
            {tt.batchGenerateSceneImages}
          </button>
        </span>
      </div>
    );
  };

  const videoBatchModel = normalizeDirectorVideoBatchModel(state.videoBatchModel);
  const videoBatchLipsyncModel = isMvMode
    ? resolveDirectorMvLipsyncModel(state.videoBatchLipsyncModel)
    : normalizeDirectorVideoLipsyncModel(state.videoBatchLipsyncModel);
  const videoBatchDuration = normalizeDirectorVideoBatchDuration(videoBatchModel, state.videoBatchDuration);
  const videoBatchAspectRatio = normalizeDirectorVideoBatchAspect(
    videoBatchModel,
    state.videoBatchAspectRatio,
  );
  const videoBatchResolution = normalizeDirectorVideoBatchResolution(
    videoBatchModel,
    state.videoBatchResolution,
  );
  const videoBatchLipsyncResolution = normalizeDirectorVideoBatchResolution(
    videoBatchLipsyncModel,
    state.videoBatchLipsyncResolution,
  );
  const videoBatchDurationOptions = getDirectorVideoBatchDurationOptions(videoBatchModel);
  const videoBatchAspectOptions = getDirectorVideoBatchAspectOptions(videoBatchModel);
  const videoBatchResOptions = getDirectorVideoBatchResolutionOptions(videoBatchModel);
  const videoBatchLipsyncResOptions = getDirectorVideoBatchResolutionOptions(videoBatchLipsyncModel);

  const patchVideoBatch = (partial: Partial<DirectorPipelineState>) => {
    patch({
      ...directorStateRef.current,
      ...partial,
    });
  };

  const renderVideoBatchOptions = () => (
    <div className="flex items-center gap-2 flex-wrap justify-center w-full mb-1.5">
      <label className="flex items-center gap-1.5" title={tt.videoBatchModelLabel}>
        <span className={isDarkMode ? 'text-white/50' : 'text-gray-500'} style={{ fontSize: fsSmall }}>
          {tt.videoBatchModelLabel}
        </span>
        <select
          className={modelSelectCls}
          style={{ fontSize: fsChrome }}
          value={videoBatchModel}
          disabled={!!busyAction}
          onChange={(e) => {
            const nextModel = normalizeDirectorVideoBatchModel(e.target.value);
            patchVideoBatch({
              videoBatchModel: nextModel,
              videoBatchDuration: normalizeDirectorVideoBatchDuration(nextModel, videoBatchDuration),
              videoBatchAspectRatio: normalizeDirectorVideoBatchAspect(nextModel, videoBatchAspectRatio),
              videoBatchResolution: normalizeDirectorVideoBatchResolution(
                nextModel,
                videoBatchResolution,
              ),
            });
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {DIRECTOR_VIDEO_BATCH_MODELS.map((m) => (
            <option key={m.value} value={m.value} title={m.title}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5" title={tt.videoBatchDurationLabel}>
        <span className={isDarkMode ? 'text-white/50' : 'text-gray-500'} style={{ fontSize: fsSmall }}>
          {tt.videoBatchDurationLabel}
        </span>
        {videoBatchDurationOptions ? (
          <select
            className={modelSelectCls}
            style={{ fontSize: fsChrome }}
            value={videoBatchDuration}
            disabled={!!busyAction}
            onChange={(e) =>
              patchVideoBatch({
                videoBatchDuration: normalizeDirectorVideoBatchDuration(videoBatchModel, e.target.value),
              })
            }
            onClick={(e) => e.stopPropagation()}
          >
            {videoBatchDurationOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : (
          <span
            className={isDarkMode ? 'text-white/45' : 'text-gray-500'}
            style={{ fontSize: fsSmall }}
          >
            —
          </span>
        )}
      </label>
      {videoBatchAspectOptions ? (
        <label className="flex items-center gap-1.5" title={tt.videoBatchRatioLabel}>
          <span className={isDarkMode ? 'text-white/50' : 'text-gray-500'} style={{ fontSize: fsSmall }}>
            {tt.videoBatchRatioLabel}
          </span>
          <select
            className={modelSelectCls}
            style={{ fontSize: fsChrome }}
            value={videoBatchAspectRatio}
            disabled={!!busyAction}
            onChange={(e) =>
              patchVideoBatch({
                videoBatchAspectRatio: normalizeDirectorVideoBatchAspect(
                  videoBatchModel,
                  e.target.value,
                ),
              })
            }
            onClick={(e) => e.stopPropagation()}
          >
            {videoBatchAspectOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {videoBatchResOptions ? (
        <label className="flex items-center gap-1.5" title={tt.videoBatchResolutionLabel}>
          <span className={isDarkMode ? 'text-white/50' : 'text-gray-500'} style={{ fontSize: fsSmall }}>
            {tt.videoBatchResolutionLabel}
          </span>
          <select
            className={modelSelectCls}
            style={{ fontSize: fsChrome }}
            value={videoBatchResolution}
            disabled={!!busyAction}
            onChange={(e) =>
              patchVideoBatch({
                videoBatchResolution: normalizeDirectorVideoBatchResolution(
                  videoBatchModel,
                  e.target.value,
                ),
              })
            }
            onClick={(e) => e.stopPropagation()}
          >
            {videoBatchResOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span
          className={isDarkMode ? 'text-white/45' : 'text-gray-500'}
          style={{ fontSize: fsSmall }}
          title="固定 720p"
        >
          720p
        </span>
      )}
    </div>
  );

  const dialogueShotCount = useMemo(
    () => countDirectorShotsWithDialogue(state.shots),
    [state.shots],
  );

  const shotMusicRanges = useMemo(
    () => computeDirectorShotMusicRangesFromState(state),
    [
      state.shots,
      state.storyboardsByShotNo,
      state.mvMusic?.lyricSegments,
      state.mvMusic?.durationSec,
      state.mvMusic?.clipLengthMode,
    ],
  );

  const lyricPacksForShots = useMemo(() => {
    const segs = state.mvMusic?.lyricSegments || [];
    if (segs.length === 0) return [];
    return packLyricSegmentsIntoShotPacks(segs, {
      clipLengthMode: state.mvMusic?.clipLengthMode,
    });
  }, [state.mvMusic?.lyricSegments, state.mvMusic?.clipLengthMode]);

  /** 分镜/视频表共用：避免每行重复 flatten+filter */
  const orderedAssetsWithImages = useMemo(
    () => (isMvMode ? getOrderedAssetsWithImages(state) : []),
    [isMvMode, state.assets.characters, state.assets.scenes, state.assets.props, state.shots],
  );

  /** 每镜歌段是否有人声：无人声 → 空镜不绑角色；有人声 → 按提示词匹配角色+场景 */
  const mvShotHasHumanVoiceByRow = useMemo(() => {
    if (!isMvMode) return [] as Array<boolean | null>;
    const segs = state.mvMusic?.lyricSegments;
    return state.shots.map((shot, i) => {
      const range = shotMusicRanges[i];
      if (range) {
        const v = shotAudioRangeHasHumanVoice(segs, range.startSec, range.endSec);
        if (v != null) return v;
      }
      const pack = lyricPacksForShots[i];
      if (pack) return !isDirectorLyricShotPackInstrumental(pack);
      if (isDirectorInstrumentalLyricText(shot['对白旁白'])) return false;
      return null;
    });
  }, [
    isMvMode,
    state.shots,
    state.mvMusic?.lyricSegments,
    shotMusicRanges,
    lyricPacksForShots,
  ]);

  const resolveMvShotLipsync = useCallback(
    (
      shot: (typeof state.shots)[number],
      rowIndex: number,
      sb: ReturnType<typeof getDirectorShotStoryboard> | null | undefined,
      range: { startSec: number; endSec: number },
    ) => {
      const hasVoice = shotAudioRangeHasHumanVoice(
        state.mvMusic?.lyricSegments,
        range.startSec,
        range.endSec,
      );
      const closeUpOn = state.mvCloseUpFraming !== false;
      const evalLs = evaluateDirectorShotLipsync(shot, {
        hasHumanVoice: hasVoice,
        packText: lyricPacksForShots[rowIndex]?.text || String(shot['对白旁白'] || ''),
        audioStartSec: range.startSec,
        songDurationSec: Number(state.mvMusic?.durationSec) || 0,
        closeUpFramingOn: closeUpOn,
      });
      const lipsyncOn =
        resolveDirectorMvForceLipsyncOn(
          isMvMode,
          typeof sb?.preferLipsync === 'boolean' ? sb.preferLipsync : evalLs.recommend,
        );
      return {
        hasVoice,
        lipsyncOn,
        priority: evalLs.priority as 'none' | 'normal' | 'climax',
        // 手动开启时：镜本身非特写级则警告（近景开关不能保证旧镜已是特写）
        faceFarWarning: !shotDescriptionSuggestsCloseUpFace(shot),
      };
    },
    [
      isMvMode,
      lyricPacksForShots,
      state.mvCloseUpFraming,
      state.mvMusic?.durationSec,
      state.mvMusic?.lyricSegments,
    ],
  );

  /** 近景特写开关 UI（仅剧本步展示；分镜/视频仍读同一字段 mvCloseUpFraming） */
  const renderCloseUpFramingSwitch = () => {
    const closeUpOn = state.mvCloseUpFraming !== false;
    return (
      <div
        className="nodrag nopan inline-flex items-center gap-2 select-none shrink-0"
        onPointerDown={(e) => e.stopPropagation()}
        title={closeUpOn ? tt.closeUpFramingOnHint : tt.closeUpFramingOffHint}
      >
        <button
          type="button"
          role="switch"
          aria-checked={closeUpOn}
          aria-label={tt.closeUpFramingSwitchLabel}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50 ${
            closeUpOn
              ? isDarkMode
                ? 'bg-sky-500/85'
                : 'bg-gray-700'
              : isDarkMode
                ? 'bg-white/20'
                : 'bg-gray-300'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            patch(setDirectorMvCloseUpFraming(directorStateRef.current, !closeUpOn));
          }}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
              closeUpOn ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
        <button
          type="button"
          className={`nodrag font-medium ${bodyCls} cursor-pointer bg-transparent border-0 p-0 text-left`}
          style={{ fontSize: fsChrome }}
          onClick={(e) => {
            e.stopPropagation();
            patch(setDirectorMvCloseUpFraming(directorStateRef.current, !closeUpOn));
          }}
        >
          {tt.closeUpFramingSwitchLabel}
        </button>
      </div>
    );
  };

  /** 镜头变化三档（剧本/成片提示词动作时轴密度） */
  const renderShotChangePaceSelect = (opts?: { compact?: boolean }) => {
    const compact = !!opts?.compact;
    const activePace = (state.mvMusic?.shotChangePace || 'normal') as 'fast' | 'normal' | 'slow';
    return (
      <div
        className="nodrag nopan inline-flex items-center gap-1.5 flex-wrap select-none shrink-0"
        onPointerDown={(e) => e.stopPropagation()}
        title={tt.shotChangePaceHint}
      >
        <span className={`shrink-0 ${mutedCls}`} style={{ fontSize: fsChrome }}>
          {tt.shotChangePaceLabel}
        </span>
        {(
          [
            { id: 'fast' as const, label: tt.shotChangePaceFast },
            { id: 'normal' as const, label: tt.shotChangePaceNormal },
            { id: 'slow' as const, label: tt.shotChangePaceSlow },
          ] as const
        ).map((opt) => {
          const on = activePace === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              className={`nodrag rounded-full font-medium transition-colors ${
                compact ? 'px-2.5 py-0.5' : 'px-3 py-1'
              } ${
                on
                  ? 'bg-sky-500 text-white'
                  : isDarkMode
                    ? 'bg-white/8 text-white/65 hover:bg-white/12'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200/80'
              }`}
              style={{ fontSize: fsChrome }}
              disabled={!!busyAction}
              onClick={(e) => {
                e.stopPropagation();
                const next = patchDirectorMvMusic(directorStateRef.current, {
                  shotChangePace: opt.id,
                });
                patch({ ...next, error: '' });
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  };

  const mvMusicUrl = String(state.mvMusic?.url || '').trim();
  const musicDurSec = Math.max(0, Number(state.mvMusic?.durationSec) || 0);
  const shotMusicTrimKey = useMemo(
    () =>
      (state.shots || [])
        .map((s, i) => `${String(s['镜号'] || i + 1).trim()}:${String(s['时长'] || '').trim()}`)
        .join('|'),
    [state.shots],
  );
  const songClipTrimInFlightRef = useRef(new Set<string>());

  /** 按镜头时间轴把原曲裁成独立片段，供试听与对口型共用 */
  useEffect(() => {
    if (!isMvMode || !mvMusicUrl) return;
    if (state.phase !== 'shots' && state.phase !== 'videos') return;
    if (!window.electronAPI?.trimAudio) return;

    let cancelled = false;
    const projectIdForTrim = String(data?.projectId || '').trim() || undefined;
    const shots = directorStateRef.current.shots || [];
    const ranges = computeDirectorShotMusicRangesFromState(directorStateRef.current);
    const queue: Array<{
      key: string;
      shotNo: string;
      startSec: number;
      endSec: number;
    }> = [];

    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const shotNo = String(shot['镜号'] || i + 1).trim() || String(i + 1);
      const sb = getDirectorShotStoryboard(directorStateRef.current, shotNo);
      const hasDuration = !!String(shot['时长'] || '').trim();
      const frozenStart = Number(sb?.audioStartSec);
      const frozenEnd = Number(sb?.audioEndSec);
      const hasFrozen =
        Number.isFinite(frozenStart) &&
        Number.isFinite(frozenEnd) &&
        frozenEnd > frozenStart + 0.05;
      // 空行（无时长且无冻结音频）不预裁切，避免预填音频区间
      if (!hasDuration && !hasFrozen) continue;
      let startSec = Math.max(0, Number(ranges[i]?.startSec) || 0);
      let endSec = Number(ranges[i]?.endSec);
      if (!Number.isFinite(endSec) || endSec <= startSec + 0.05) {
        const dur = parseDirectorShotDurationSec(shot['时长'], hasFrozen ? frozenEnd - frozenStart : 0);
        if (dur <= 0) continue;
        endSec = startSec + dur;
      }
      if (musicDurSec > 0.5) {
        if (startSec >= musicDurSec - 0.05) continue;
        endSec = Math.min(endSec, musicDurSec);
      }
      if (endSec <= startSec + 0.05) continue;
      if (getValidDirectorShotSongClipUrl(sb, mvMusicUrl, startSec, endSec)) continue;
      const key = `${shotNo}|${mvMusicUrl}|${startSec.toFixed(2)}|${endSec.toFixed(2)}`;
      if (songClipTrimInFlightRef.current.has(key)) continue;
      queue.push({ key, shotNo, startSec, endSec });
    }

    if (queue.length === 0) return;

    const CONCURRENCY = 2;
    let cursor = 0;

    const worker = async () => {
      while (!cancelled) {
        const idx = cursor++;
        if (idx >= queue.length) return;
        const item = queue[idx];
        songClipTrimInFlightRef.current.add(item.key);
        try {
          const trimmed = await window.electronAPI!.trimAudio(
            projectIdForTrim,
            mvMusicUrl,
            item.startSec,
            item.endSec,
          );
          const clipUrl = String(trimmed?.audioUrl || '').trim();
          if (!clipUrl || cancelled) continue;
          const latest = directorStateRef.current;
          const sbNow = getDirectorShotStoryboard(latest, item.shotNo);
          if (getValidDirectorShotSongClipUrl(sbNow, mvMusicUrl, item.startSec, item.endSec)) {
            continue;
          }
          patch(
            updateDirectorShotStoryboard(latest, item.shotNo, {
              songClipUrl: clipUrl,
              songClipSourceUrl: mvMusicUrl,
              songClipStartSec: item.startSec,
              songClipEndSec: item.endSec,
            }),
          );
        } catch (err) {
          console.warn(
            `[Director] 镜${item.shotNo} 原曲片段裁剪失败 ${item.startSec.toFixed(2)}–${item.endSec.toFixed(2)}:`,
            err,
          );
        } finally {
          songClipTrimInFlightRef.current.delete(item.key);
        }
      }
    };

    void Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()),
    );

    return () => {
      cancelled = true;
    };
  }, [
    isMvMode,
    mvMusicUrl,
    musicDurSec,
    shotMusicTrimKey,
    state.phase,
    data?.projectId,
    patch,
  ]);

  const renderShotSongClipCell = (
    audioRange: { startSec: number; endSec: number; durationSec?: number },
    shotNo: string,
    widthClass = 'min-w-[340px] w-[340px] max-w-[380px]',
    layout: 'inline' | 'confirmPill' | 'videoTrack' = 'inline',
    opts?: { rowIndex?: number; editableTime?: boolean },
  ) => {
    let startSec = Math.max(0, Number(audioRange.startSec) || 0);
    let endSec = Number(audioRange.endSec);
    if (!Number.isFinite(endSec) || endSec <= startSec + 0.05) {
      endSec = startSec + Math.max(0.5, Number(audioRange.durationSec) || 5);
    }
    if (musicDurSec > 0.5) {
      endSec = Math.min(endSec, musicDurSec);
    }
    const sb = getDirectorShotStoryboard(state, shotNo);
    const clippedUrl = getValidDirectorShotSongClipUrl(sb, mvMusicUrl, startSec, endSec);
    const src = clippedUrl || mvMusicUrl;
    const useSeekBounds = !clippedUrl;
    const hasVoice = shotAudioRangeHasHumanVoice(
      state.mvMusic?.lyricSegments,
      startSec,
      endSec,
    );
    const packs = lyricPacksForShots;
    const packIdx = packs.findIndex(
      (p) => Math.abs(p.startSec - startSec) < 0.35 && Math.abs(p.endSec - endSec) < 0.45,
    );
    const role =
      packIdx >= 0
        ? classifyDirectorMvPackAudioRole(packs, packIdx)
        : hasVoice === true
          ? 'vocal'
          : hasVoice === false
            ? startSec <= 1
              ? 'intro'
              : 'bridge'
            : null;
    const voiceBadge =
      role != null
        ? directorMvPackAudioRoleLabelZh(role)
        : tt.shotAudioVocalUnknown;
    const voiceCls =
      role === 'vocal'
        ? isDarkMode
          ? 'text-emerald-300/90'
          : 'text-emerald-700'
        : role != null
          ? mutedCls
          : isDarkMode
            ? 'text-amber-200/80'
            : 'text-amber-700';
    const timeLabel = `${formatShotAudioClock(startSec)}–${formatShotAudioClock(endSec)}`;
    const rowIndex = opts?.rowIndex;
    const canEditTime = !!opts?.editableTime && typeof rowIndex === 'number' && rowIndex >= 0;
    const isEditingTime = canEditTime && editingAudioRow === rowIndex;

    const commitAudioRangeEdit = (startRaw: string, endRaw: string) => {
      if (typeof rowIndex !== 'number' || rowIndex < 0) return;
      const nextStart = parseShotAudioClock(startRaw);
      const nextEnd = parseShotAudioClock(endRaw);
      setEditingAudioRow(null);
      if (nextStart == null || nextEnd == null || nextEnd <= nextStart + 0.05) return;
      let s = Math.max(0, nextStart);
      let e = nextEnd;
      if (musicDurSec > 0.5) {
        s = Math.min(s, Math.max(0, musicDurSec - 0.1));
        e = Math.min(e, musicDurSec);
      }
      if (e <= s + 0.05) return;
      const durSec = Math.max(1, Math.round(e - s));
      const latest = directorStateRef.current;
      let next = updateDirectorShotCell(latest, rowIndex, '时长', `${durSec}s`);
      next = updateDirectorShotStoryboard(next, shotNo, {
        audioStartSec: s,
        audioEndSec: e,
        songClipUrl: '',
        songClipSourceUrl: '',
        songClipStartSec: s,
        songClipEndSec: e,
      });
      patch(next);
    };

    const renderEditableTimeLabel = (className: string, style?: React.CSSProperties) => {
      if (isEditingTime) {
        return (
          <div
            className={`nodrag flex items-center gap-0.5 tabular-nums ${className}`}
            style={style}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              className={`nodrag w-[2.75rem] bg-transparent ring-1 rounded px-0.5 py-0.5 outline-none text-center ${
                isDarkMode
                  ? 'ring-blue-500/40 text-white/90'
                  : 'ring-blue-400/50 text-gray-900'
              }`}
              defaultValue={formatShotAudioClock(startSec)}
              autoFocus
              data-director-audio-start="1"
              onBlur={(e) => {
                const root = e.currentTarget.parentElement;
                if (root?.contains(e.relatedTarget as Node)) return;
                const endEl = root?.querySelector(
                  '[data-director-audio-end]',
                ) as HTMLInputElement | null;
                commitAudioRangeEdit(e.currentTarget.value, endEl?.value || '');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditingAudioRow(null);
                }
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const root = (e.currentTarget as HTMLElement).parentElement;
                  const endEl = root?.querySelector(
                    '[data-director-audio-end]',
                  ) as HTMLInputElement | null;
                  commitAudioRangeEdit(e.currentTarget.value, endEl?.value || '');
                }
              }}
            />
            <span className={mutedCls}>–</span>
            <input
              className={`nodrag w-[2.75rem] bg-transparent ring-1 rounded px-0.5 py-0.5 outline-none text-center ${
                isDarkMode
                  ? 'ring-blue-500/40 text-white/90'
                  : 'ring-blue-400/50 text-gray-900'
              }`}
              defaultValue={formatShotAudioClock(endSec)}
              data-director-audio-end="1"
              onBlur={(e) => {
                const root = e.currentTarget.parentElement;
                const startEl = root?.querySelector(
                  '[data-director-audio-start]',
                ) as HTMLInputElement | null;
                // 切到另一个输入框时不提交
                if (root?.contains(e.relatedTarget as Node)) return;
                commitAudioRangeEdit(startEl?.value || '', e.currentTarget.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditingAudioRow(null);
                }
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const root = (e.currentTarget as HTMLElement).parentElement;
                  const startEl = root?.querySelector(
                    '[data-director-audio-start]',
                  ) as HTMLInputElement | null;
                  commitAudioRangeEdit(startEl?.value || '', e.currentTarget.value);
                }
              }}
            />
          </div>
        );
      }
      if (canEditTime) {
        return (
          <button
            type="button"
            className={`nodrag cursor-text tabular-nums ${className}`}
            style={style}
            title={tt.editShotAudioRange}
            onClick={(e) => {
              e.stopPropagation();
              setEditing(null);
              setEditingAudioRow(rowIndex!);
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {timeLabel}
          </button>
        );
      }
      return (
        <div className={className} style={style}>
          {timeLabel}
        </div>
      );
    };

    const wave = (
      <ReferenceAudioWaveStrip
        src={src}
        isDarkMode={isDarkMode}
        variant="compact"
        waveOnly
        emphasized={layout !== 'confirmPill'}
        emptyLabel={tt.shotAudioNeedMusic}
        playLabel={`${tt.playShotAudio} ${timeLabel}${clippedUrl ? '' : '…'}`}
        {...(useSeekBounds ? { clipStartSec: startSec, clipEndSec: endSec } : {})}
      />
    );
    if (layout === 'confirmPill' || layout === 'videoTrack') {
      const audioH = layout === 'videoTrack' ? (isNodeFullscreen ? 52 : 44) : 36;
      const roleIcon =
        role === 'vocal' ? (
          <User
            className={`w-3.5 h-3.5 ${
              isDarkMode ? 'text-emerald-300' : 'text-emerald-600'
            }`}
            strokeWidth={2.4}
            aria-label={voiceBadge}
          />
        ) : role != null ? (
          <Music2 className={`w-3.5 h-3.5 ${mutedCls}`} strokeWidth={2.2} aria-label={voiceBadge} />
        ) : (
          <span className={`w-3.5 h-3.5 inline-block ${mutedCls}`} />
        );
      const waveBox = (
        <div
          className={`min-w-0 w-full rounded-md overflow-hidden border ${
            isDarkMode ? 'bg-zinc-950 border-white/10' : 'bg-zinc-100 border-gray-300'
          }`}
          style={{ height: audioH }}
        >
          <ReferenceAudioWaveStrip
            src={src}
            isDarkMode={isDarkMode}
            variant="compact"
            waveOnly
            dense
            minHeightPx={audioH}
            emptyLabel={tt.shotAudioNeedMusic}
            playLabel={`${tt.playShotAudio} ${timeLabel}${clippedUrl ? '' : '…'}`}
            {...(useSeekBounds ? { clipStartSec: startSec, clipEndSec: endSec } : {})}
          />
        </div>
      );
      // 视频生成表：波形铺满宽度，时间在下方，短片段也清晰
      if (layout === 'videoTrack') {
        return (
          <div className={`mx-auto flex w-full flex-col gap-1 ${widthClass}`}>
            {waveBox}
            <div className="flex items-center justify-between gap-1 px-0.5">
              <div className="shrink-0 flex items-center justify-center" title={voiceBadge}>
                {roleIcon}
              </div>
              {renderEditableTimeLabel(
                `min-w-0 truncate text-right leading-none font-medium ${bodyCls}`,
                { fontSize: Math.max(10, fsChrome - 1) },
              )}
            </div>
          </div>
        );
      }
      return (
        <div className={`mx-auto flex items-center justify-center gap-2 ${widthClass}`}>
          <div className="shrink-0 flex items-center justify-center" title={voiceBadge}>
            {roleIcon}
          </div>
          <div className="min-w-0 flex-1">{waveBox}</div>
          {renderEditableTimeLabel(
            `shrink-0 text-center leading-none font-medium ${bodyCls}`,
            { fontSize: Math.max(10, fsChrome - 1), minWidth: '3.25rem' },
          )}
        </div>
      );
    }
    return (
      <div className={`flex items-center gap-1.5 ${widthClass}`}>
        {renderEditableTimeLabel(
          `shrink-0 font-semibold leading-tight ${bodyCls}`,
          { fontSize: Math.max(10, fsChrome - 1) },
        )}
        <div className="min-w-0 flex-1">{wave}</div>
        <div className="shrink-0 flex items-center justify-center" title={voiceBadge}>
          {role === 'vocal' ? (
            <User
              className={`w-5 h-5 ${
                isDarkMode ? 'text-emerald-300' : 'text-emerald-600'
              }`}
              strokeWidth={2.4}
              aria-label={voiceBadge}
            />
          ) : role != null ? (
            <Music2 className={`w-5 h-5 ${mutedCls}`} strokeWidth={2.2} aria-label={voiceBadge} />
          ) : (
            <span className={`text-[10px] max-w-[2.5rem] leading-tight text-center ${voiceCls}`}>
              {voiceBadge}
            </span>
          )}
        </div>
      </div>
    );
  };

  const handlePreviewToSplice = () => {
    const wasFullscreen = isNodeFullscreen;
    if (wasFullscreen) setIsNodeFullscreen(false);
    // 退出全屏后稍等布局再入轨，便于画布归位到剪辑模块
    window.setTimeout(() => {
      data?.onPreviewToSplice?.();
    }, wasFullscreen ? 80 : 0);
  };

  const handleVideosToSpliceClick = () => {
    if (isDramaMode) {
      const domain = (dataRef.current?.directorDomain as DramaDirectorSession | null) || null;
      if (domain?.shots?.length) {
        patch(projectDramaSessionToPipeline(domain, directorStateRef.current));
      }
    }
    const wasFullscreen = isNodeFullscreen;
    if (wasFullscreen) setIsNodeFullscreen(false);
    // 退出全屏后再入轨，便于画布用一键归位动画对准右侧剪辑模块（与分镜步同套 UX）
    window.setTimeout(() => {
      data?.onVideosToSplice?.();
    }, wasFullscreen ? 120 : 0);
  };

  /** 分镜步 / 第 7 步「剪辑预览」共用橙色 pill（见 darkModalShell） */
  const previewToSpliceBtnClass = nexflowOrangePillBtnClass;
  const previewToSpliceBtnBg = nexflowOrangePillBtnBg;

  const renderPreviewToSpliceButton = (opts?: {
    fontSize?: number;
    /** stills=分镜图入轨；videos=第 7 步成片入轨 */
    mode?: 'stills' | 'videos';
    hasReadyVideos?: boolean;
  }) => {
    const mode = opts?.mode ?? 'stills';
    const fs = opts?.fontSize ?? fsChrome;
    if (mode === 'videos') {
      const ready = !!opts?.hasReadyVideos;
      return (
        <button
          type="button"
          className={previewToSpliceBtnClass}
          style={{ fontSize: fs, background: previewToSpliceBtnBg }}
          disabled={!ready || isDirectorHardBusy}
          title={ready ? tt.previewVideosHint : tt.previewVideosToSplice}
          onClick={handleVideosToSpliceClick}
        >
          {tt.previewVideosToSplice}
        </button>
      );
    }
    const canPreviewStills = storyboardsProg.ready > 0;
    return (
      <button
        type="button"
        className={previewToSpliceBtnClass}
        style={{ fontSize: fs, background: previewToSpliceBtnBg }}
        disabled={!canPreviewStills || isDirectorHardBusy}
        title={canPreviewStills ? tt.previewToSplice : tt.previewHint}
        onClick={handlePreviewToSplice}
      >
        {tt.previewToSplice}
      </button>
    );
  };

  const renderMvShotsConfirmSummary = () => {
    if (!isMvMode || state.phase !== 'shots') return null;
    return (
      <div className="relative z-[50] overflow-visible shrink-0 flex flex-col gap-1.5">
        {renderScriptStaleBanner()}
      <div
        className={`overflow-visible rounded-lg border px-2.5 py-2 flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5 ${
          isDarkMode ? 'border-white/10 bg-white/[0.04]' : 'border-gray-200 bg-gray-100'
        }`}
        style={{ fontSize: fsChrome }}
      >
        <label
          className={`nodrag inline-flex items-center gap-1.5 rounded-md px-2 py-1 ring-1 ${
            isDarkMode
              ? 'bg-violet-500/15 text-violet-100 ring-violet-400/40'
              : 'bg-gray-200 text-gray-900 ring-gray-300'
          }`}
          style={{ fontSize: fsChrome }}
          title={tt.modelLabel}
        >
          <span className="font-semibold whitespace-nowrap">{tt.modelLabel}</span>
          <select
            className={`nodrag rounded px-1.5 py-0.5 outline-none max-w-[10.5rem] ${
              isDarkMode
                ? 'bg-zinc-950 text-zinc-100 ring-1 ring-violet-400/30'
                : 'bg-gray-100 text-gray-900 ring-1 ring-gray-300'
            }`}
            style={{ fontSize: fsChrome }}
            value={
              directorStoryboardImageModels.some((m) => m.value === (state.imageModel || ''))
                ? state.imageModel || DEFAULT_IMAGE_MODEL
                : DEFAULT_IMAGE_MODEL
            }
            disabled={isDirectorHardBusy}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              patch({
                ...directorStateRef.current,
                imageModel: e.target.value,
              })
            }
          >
            {directorStoryboardImageModels.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label
          className={`nodrag inline-flex items-center gap-1.5 rounded-md px-2 py-1 ring-1 ${
            isDarkMode
              ? 'bg-sky-500/15 text-sky-100 ring-sky-400/40'
              : 'bg-sky-50 text-sky-900 ring-sky-300'
          }`}
          style={{ fontSize: fsChrome }}
          title={tt.ratioHint}
        >
          <span className="font-semibold whitespace-nowrap">{tt.videoBatchRatioLabel}</span>
          <select
            className={`nodrag rounded px-1.5 py-0.5 outline-none ${
              isDarkMode
                ? 'bg-zinc-950 text-zinc-100 ring-1 ring-sky-400/30'
                : 'bg-gray-100 text-gray-900 ring-1 ring-sky-300'
            }`}
            style={{ fontSize: fsChrome }}
            value={
              coerceDirectorMvAspectRatio(state.mvAspectRatio || state.videoBatchAspectRatio) ||
              '16:9'
            }
            disabled={isDirectorHardBusy}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const ratio = coerceDirectorMvAspectRatio(e.target.value) || '16:9';
              const base = setDirectorMvAspectRatio(directorStateRef.current, ratio);
              patch({
                ...base,
                videoBatchAspectRatio: ratio,
              });
            }}
          >
            {DIRECTOR_MV_ASPECT_OPTIONS.map((ratio) => (
              <option key={ratio} value={ratio}>
                {ratio}
              </option>
            ))}
          </select>
        </label>
        <span
          className="relative inline-flex shrink-0 overflow-visible"
          onMouseEnter={() => setPriceHoverKey('batch-storyboards')}
          onMouseLeave={() =>
            setPriceHoverKey((k) => (k === 'batch-storyboards' ? null : k))
          }
        >
          {renderBatchStoryboardYuanbaoHoverTip(
            'batch-storyboards',
            Math.max(
              1,
              storyboardsProg.missing > 0
                ? storyboardsProg.missing
                : storyboardsProg.total || state.shots.length,
            ),
            { below: true },
          )}
          <button
            type="button"
            className={`nodrag inline-flex items-center justify-center gap-1 ${btnPrimary('!px-2.5 !py-1 !h-auto')} disabled:opacity-40`}
            style={{ fontSize: fsChrome }}
            disabled={isDirectorHardBusy || state.shots.length === 0}
            title={tt.oneClickGenerateStoryboards}
            onClick={() => startBatchStoryboards()}
          >
            {busyAction === 'storyboards' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin inline" />
            ) : null}
            {tt.oneClickGenerateStoryboards}
          </button>
        </span>
      </div>
      </div>
    );
  };

  /** 分镜图 / 成片缩略格：与画布模块同款绿色进度条 */
  const renderDirectorThumbProgress = (opts: {
    visible: boolean;
    message?: string;
    borderRadius?: number;
  }) => (
    <ModuleProgressBar
      visible={opts.visible}
      progress={opts.visible ? 35 : 100}
      solidBackground={isDarkMode ? '#1C1C1E' : '#e5e7eb'}
      progressMessage={opts.message}
      borderRadius={opts.borderRadius ?? 8}
    />
  );

  const clearShotRowLongPressTimer = useCallback(() => {
    if (shotRowLongPressTimerRef.current) {
      clearTimeout(shotRowLongPressTimerRef.current);
      shotRowLongPressTimerRef.current = null;
    }
  }, []);

  const endShotRowGesture = useCallback(() => {
    clearShotRowLongPressTimer();
    const g = shotRowGestureRef.current;
    if (g?.dragging && typeof g.rowIndex === 'number') {
      const from = g.rowIndex;
      const to = shotDragOverIndexRef.current != null ? shotDragOverIndexRef.current : from;
      if (to !== from) {
        patch(reorderDirectorShot(directorStateRef.current, from, to));
        setShotRowArmedIndex(to);
      }
    }
    shotRowGestureRef.current = null;
    shotDragOverIndexRef.current = null;
    setShotDragFromIndex(null);
    setShotDragOverIndex(null);
  }, [clearShotRowLongPressTimer, patch]);

  const focusShotTableRow = useCallback((rowIndex: number) => {
    const idx = Math.max(0, Math.floor(rowIndex));
    setShotFocusRowIndex(idx);
    setShotRowArmedIndex(null);
    const scroll = () => {
      shotTableVirtualRef.current?.scrollToIndex(idx, {
        align: 'center',
        behavior: 'smooth',
      });
    };
    // 等虚拟表计入新行后再滚；再补一次避免首帧 count 未更新
    requestAnimationFrame(() => {
      scroll();
      window.setTimeout(scroll, 80);
    });
  }, []);

  useEffect(() => {
    if (shotFocusRowIndex == null) return;
    const t = window.setTimeout(() => setShotFocusRowIndex(null), 1400);
    return () => window.clearTimeout(t);
  }, [shotFocusRowIndex]);

  useEffect(() => {
    if (shotRowArmedIndex == null && shotDragFromIndex == null) return;
    const onDoc = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('[data-director-shot-row]')) return;
      setShotRowArmedIndex(null);
      endShotRowGesture();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShotRowArmedIndex(null);
        endShotRowGesture();
      }
    };
    document.addEventListener('pointerdown', onDoc, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [shotRowArmedIndex, shotDragFromIndex, endShotRowGesture]);

  const isShotRowInteractiveTarget = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    if (!el?.closest) return false;
    return !!el.closest(
      'button, input, textarea, select, a, [contenteditable="true"], [data-director-picker-keep]',
    );
  };

  const onShotRowPointerDown = (rowIndex: number, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (isShotRowInteractiveTarget(e.target)) return;
    clearShotRowLongPressTimer();
    shotRowSuppressClickRef.current = false;
    shotRowGestureRef.current = {
      rowIndex,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      longPressed: false,
      dragging: false,
    };
    shotRowLongPressTimerRef.current = setTimeout(() => {
      shotRowLongPressTimerRef.current = null;
      const g = shotRowGestureRef.current;
      if (!g || g.rowIndex !== rowIndex) return;
      g.longPressed = true;
      shotRowSuppressClickRef.current = true;
      setShotRowArmedIndex(rowIndex);
      setEditing(null);
      setEditingAudioRow(null);
    }, SHOT_ROW_LONG_PRESS_MS);
  };

  const onShotRowPointerMove = (rowIndex: number, e: React.PointerEvent) => {
    const g = shotRowGestureRef.current;
    if (!g || g.rowIndex !== rowIndex || g.pointerId !== e.pointerId) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    const dist = Math.hypot(dx, dy);
    if (!g.longPressed) {
      if (dist > SHOT_ROW_DRAG_THRESHOLD_PX) {
        // 未达长按前移动 → 视为滚动/点选，取消长按
        clearShotRowLongPressTimer();
        shotRowGestureRef.current = null;
      }
      return;
    }
    if (!g.dragging && dist > SHOT_ROW_DRAG_THRESHOLD_PX) {
      g.dragging = true;
      setShotDragFromIndex(rowIndex);
      shotDragOverIndexRef.current = rowIndex;
      setShotDragOverIndex(rowIndex);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    if (!g.dragging) return;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const rowEl = el?.closest?.('[data-director-shot-row]') as HTMLElement | null;
    const over = rowEl ? Number(rowEl.dataset.shotRowIndex) : rowIndex;
    if (Number.isFinite(over) && over >= 0) {
      shotDragOverIndexRef.current = over;
      setShotDragOverIndex(over);
    }
  };

  const onShotRowPointerUp = (rowIndex: number, e: React.PointerEvent) => {
    const g = shotRowGestureRef.current;
    if (!g || g.rowIndex !== rowIndex || g.pointerId !== e.pointerId) {
      clearShotRowLongPressTimer();
      return;
    }
    if (g.dragging) {
      endShotRowGesture();
      return;
    }
    clearShotRowLongPressTimer();
    // 长按后松手：保留删除按钮；短按：清掉武装态
    if (!g.longPressed) {
      shotRowGestureRef.current = null;
    } else {
      shotRowGestureRef.current = null;
    }
  };

  const onShotRowPointerCancel = (rowIndex: number) => {
    const g = shotRowGestureRef.current;
    if (!g || g.rowIndex !== rowIndex) return;
    clearShotRowLongPressTimer();
    shotRowGestureRef.current = null;
    setShotDragFromIndex(null);
    setShotDragOverIndex(null);
  };

  const shotHasExplicitAudioRange = (
    shot: (typeof state.shots)[number],
    shotNo: string,
  ) => {
    if (String(shot['时长'] || '').trim()) return true;
    const sb = getDirectorShotStoryboard(state, shotNo);
    const startSec = Number(sb?.audioStartSec);
    const endSec = Number(sb?.audioEndSec);
    return Number.isFinite(startSec) && Number.isFinite(endSec) && endSec > startSec + 0.05;
  };

  const renderShotsConfirmPanel = (opts?: {
    includeGenerateBar?: boolean;
    className?: string;
    tableScrollClass?: string;
    /** 短剧「剧本解析」步也可预览分析结果表 */
    forceShow?: boolean;
  }) => {
    if (!opts?.forceShow && state.phase !== 'shots') return null;
    const includeGenerateBar = opts?.includeGenerateBar !== false;
    const wrapCls = opts?.className || 'flex flex-col flex-1 min-h-0 gap-1';
    const tableWrapCls =
      opts?.tableScrollClass ||
      'nowheel flex-1 min-h-0 overflow-auto custom-scrollbar-dark';
    const activeShotCols = isWizardMode ? null : isDramaMode ? DRAMA_SHOT_COLS : SHOT_COLS;
    const shotTableColSpan = isWizardMode ? 9 : activeShotCols!.length;
    return (
      <div className={wrapCls}>
            {isWizardMode ? renderMvShotsConfirmSummary() : null}
        <DirectorShotTableVirtual
          ref={shotTableVirtualRef}
          count={state.shots.length}
          estimateSize={DIRECTOR_MV_SHOT_ROW_ESTIMATE_PX}
          getItemKey={(i) => String(state.shots[i]?.['镜号'] ?? i)}
          className={tableWrapCls}
        >
          {({ virtualItems, paddingTop, paddingBottom, measureElement }) => (
              <table className="w-full table-fixed border-collapse" style={{ fontSize: fsSmall }}>
                <thead className={`sticky top-0 z-10 ${tableHeadBg}`}>
                  {isDramaMode && !isWizardMode ? (
                    <tr className={`border-b ${cellBorder} ${mutedCls}`}>
                      <th
                        colSpan={DRAMA_LAYER_COLSPAN.scene}
                        className="px-1.5 py-1 text-center font-semibold tracking-wide"
                      >
                        {tt.layerScene}
                      </th>
                      <th
                        colSpan={DRAMA_LAYER_COLSPAN.shot}
                        className="px-1.5 py-1 text-center font-semibold tracking-wide"
                      >
                        {tt.layerShot}
                      </th>
                      <th
                        colSpan={DRAMA_LAYER_COLSPAN.prod}
                        className="px-1.5 py-1 text-center font-semibold tracking-wide"
                      >
                        {tt.layerProd}
                      </th>
                    </tr>
                  ) : null}
                  <tr className={`border-b ${cellBorder} ${mutedCls}`}>
                    {(isWizardMode
                      ? ([
                          { key: '镜号', width: '72px' },
                          { key: '时长', width: '44px' },
                          { key: '最终提示词', width: '168px' },
                          { key: '__scene__', width: '108px' },
                          { key: '__cast__', width: '100px' },
                          { key: '__lens__', width: '52px' },
                          { key: '__audio__', width: '220px' },
                          { key: '__actions__', width: '96px' },
                          { key: '__sb__', width: '168px' },
                        ] as const)
                      : activeShotCols!
                    ).map((c) => (
                      <th
                        key={c.key}
                        className="px-1.5 py-1.5 text-center font-medium whitespace-nowrap"
                        style={{ width: c.width }}
                      >
                        {c.key === '__scene__'
                          ? tt.scenes
                          : c.key === '__cast__'
                            ? tt.characters
                            : c.key === '__lens__'
                              ? tt.colAngleFocal
                              : c.key === '__audio__'
                                ? tt.colShotAudio
                                : c.key === '__actions__'
                                  ? tt.colActions
                                  : c.key === '__sb__'
                                    ? tt.colStoryboard
                                    : colLabel(c.key as DirectorShotColumnKey)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <DirectorTableVirtualPad height={paddingTop} colSpan={shotTableColSpan} />
                  {virtualItems.map((virtualRow) => {
                    const rowIndex = virtualRow.index;
                    const shot = state.shots[rowIndex];
                    if (!shot) return null;
                    const shotNo = String(shot['镜号'] || rowIndex + 1);
                    const orderedRefs = orderedAssetsWithImages;
                    const boundIdx = isWizardMode
                      ? getShotBoundRefIndices(shot, orderedRefs, rowIndex)
                      : [];
                    const sceneAsset = orderedRefs.find(
                      (a, i) => boundIdx.includes(i) && a?.kind === 'scene',
                    );
                    const castAssets = boundIdx
                      .map((i) => orderedRefs[i])
                      .filter((a) => a?.kind === 'character');
                    const sceneNames = String(sceneAsset?.name || '').trim();
                    const sceneUrl = String(sceneAsset?.imageUrl || '').trim();
                    const sb = (isWizardMode || isDramaMode)
                      ? getDirectorShotStoryboard(state, shotNo)
                      : null;
                    const sbUrl = String(sb?.imageUrl || '').trim();
                    const sbVersions = listDirectorShotStoryboardImages(sb);
                    const sbGenerating =
                      (sb?.status === 'generating' || sbGenInFlightRef.current.has(shotNo)) &&
                      !!(isWizardMode || isDramaMode);
                    const rowUnseen = isShotRowUnseen(sb);
                    const finalVal = resolveShotFinalPrompt(shot);
                    const audioRange = shotMusicRanges[rowIndex] || {
                      startSec: 0,
                      endSec: parseDirectorShotDurationSec(shot['时长'], 5),
                      durationSec: parseDirectorShotDurationSec(shot['时长'], 5),
                    };
                    const renderMvNamedRefCell = (
                      kind: 'scene' | 'character' | 'style',
                      url: string,
                      name: string,
                    ) => {
                      if (kind === 'scene') {
                        const availableScenes = (state.assets.scenes || []).filter((a) =>
                          String(a?.imageUrl || '').trim(),
                        );
                        const selectedSceneId = String(sceneAsset?.id || '').trim();
                        const pickerOpen = scenePickerShotNo === shotNo;
                        return (
                          <td
                            className={`p-1 align-middle border-t overflow-visible ${cellBorder}`}
                          >
                            <div
                              className="relative w-full flex items-center justify-center overflow-visible"
                              style={{ height: SHOTS_CONFIRM_REF_CELL_H }}
                            >
                              {url ? (
                                <div className="relative w-full h-full flex items-center justify-center">
                                  <DirectorAspectThumbButton
                                    frame="scene"
                                    maxH={SHOTS_CONFIRM_REF_CELL_H}
                                    maxW={Math.round(SHOTS_CONFIRM_REF_CELL_H * (16 / 9))}
                                    url={url}
                                    alt={name || tt.scenes}
                                    title={
                                      pickerOpen
                                        ? `${tt.viewImage}: ${name || tt.scenes}`
                                        : tt.sceneReplaceShot
                                    }
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (pickerOpen) {
                                        setImagePreview({ url, name: name || tt.scenes });
                                        return;
                                      }
                                      setCastPickerShotNo(null);
                                      setSbSourceMenuShotNo(null);
                                      setSbPickerShotNo(null);
                                      setScenePickerShotNo(shotNo);
                                    }}
                                    onPointerDown={(e) => e.stopPropagation()}
                                  />
                                  {pickerOpen ? (
                                    <button
                                      type="button"
                                      className={`nodrag absolute top-0.5 right-0.5 z-20 rounded-md p-1 ring-1 ${
                                        isDarkMode
                                          ? 'bg-sky-500/30 text-sky-100 ring-sky-400/50'
                                          : 'bg-sky-50 text-sky-700 ring-sky-300'
                                      }`}
                                      title={tt.sceneReplaceShot}
                                      data-director-picker-keep="scene"
                                      onClick={(e) => e.stopPropagation()}
                                      onPointerDown={(e) => e.stopPropagation()}
                                    >
                                      <RefreshCw className="w-3 h-3" />
                                    </button>
                                  ) : null}
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className={`nodrag flex items-center justify-center rounded-lg ring-1 ring-dashed ${
                                    isDarkMode
                                      ? 'ring-white/25 bg-black/25 text-white/40 hover:bg-white/[0.06]'
                                      : 'ring-gray-300 bg-gray-100 text-gray-400 hover:bg-gray-200/70'
                                  }`}
                                  style={{
                                    aspectRatio: '16 / 9',
                                    height: SHOTS_CONFIRM_REF_CELL_H,
                                    maxWidth: '100%',
                                  }}
                                  disabled={availableScenes.length === 0}
                                  title={tt.sceneReplaceShot}
                                  data-director-picker-keep="scene"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!availableScenes.length) return;
                                    setCastPickerShotNo(null);
                                    setSbSourceMenuShotNo(null);
                                    setSbPickerShotNo(null);
                                    setScenePickerShotNo(pickerOpen ? null : shotNo);
                                  }}
                                  onPointerDown={(e) => e.stopPropagation()}
                                >
                                  <Plus className="w-4 h-4 opacity-70" />
                                </button>
                              )}
                              {pickerOpen && availableScenes.length > 0 ? (
                                <div
                                  data-director-picker-keep="scene"
                                  className={`absolute left-0 top-full z-40 mt-1 min-w-[160px] rounded-lg border p-1.5 shadow-lg ${
                                    isDarkMode
                                      ? 'border-white/15 bg-zinc-950'
                                      : 'border-gray-200 bg-gray-100'
                                  }`}
                                  onPointerDown={(e) => e.stopPropagation()}
                                >
                                  <div
                                    className={`px-1 pb-1 ${mutedCls}`}
                                    style={{ fontSize: Math.max(10, fsChrome - 1) }}
                                  >
                                    {tt.sceneReplaceShot}
                                  </div>
                                  {availableScenes.map((a) => {
                                    const id = String(a.id || '').trim();
                                    const aUrl = String(a.imageUrl || '').trim();
                                    const aName = String(a.name || '').trim() || tt.scenes;
                                    const on = id === selectedSceneId;
                                    return (
                                      <button
                                        key={id}
                                        type="button"
                                        className={`nodrag w-full flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left ${
                                          on
                                            ? isDarkMode
                                              ? 'bg-sky-500/25 text-sky-100'
                                              : 'bg-sky-100 text-sky-900'
                                            : isDarkMode
                                              ? 'hover:bg-white/8 text-white/85'
                                              : 'hover:bg-gray-200/70 text-gray-800'
                                        }`}
                                        style={{ fontSize: fsChrome }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          applyShotSceneAssetIds(shotNo, rowIndex, [id]);
                                          setScenePickerShotNo(null);
                                        }}
                                      >
                                        {aUrl ? (
                                          <img
                                            src={aUrl}
                                            alt=""
                                            className="w-9 h-9 object-cover rounded shrink-0"
                                            draggable={false}
                                          />
                                        ) : (
                                          <span className={`w-9 h-9 rounded shrink-0 ${softPanel}`} />
                                        )}
                                        <span className="min-w-0 flex-1 truncate">{aName}</span>
                                        {on ? <Check className="w-3.5 h-3.5 shrink-0" /> : null}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          </td>
                        );
                      }
                      const kindLabel =
                        kind === 'style'
                          ? tt.colStyleRef
                          : kind === 'character'
                            ? tt.characters
                            : tt.scenes;
                      const thumbH = Math.round(REF_THUMB_MAX_H_PX * 0.55);
                      const thumbW = Math.round(REF_THUMB_MAX_W_PX * 0.48);
                      return (
                        <td className={`px-1 py-1.5 align-top border-t ${cellBorder}`}>
                          <div className="flex flex-col items-start gap-0.5 min-w-0">
                            {url ? (
                              <DirectorAspectThumbButton
                                url={url}
                                alt={name || kindLabel}
                                title={`${tt.viewImage}: ${name || kindLabel}`}
                                maxH={thumbH}
                                maxW={thumbW}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setImagePreview({ url, name: name || kindLabel });
                                }}
                              />
                            ) : (
                              <DirectorAspectThumbPlaceholder
                                label={kindLabel}
                                softPanel={softPanel}
                                mutedCls={mutedCls}
                                isDarkMode={isDarkMode}
                              />
                            )}
                          </div>
                        </td>
                      );
                    };
                    const renderMvCastRefCell = () => {
                      const availableCast = (state.assets.characters || []).filter((a) =>
                        String(a?.imageUrl || '').trim(),
                      );
                      const selectedIds = castAssets
                        .map((a) => String(a?.id || '').trim())
                        .filter(Boolean);
                      const thumbs = castAssets
                        .map((a) => ({
                          id: String(a?.id || '').trim(),
                          url: String(a?.imageUrl || '').trim(),
                          name: String(a?.name || '').trim(),
                        }))
                        .filter((x) => x.url);
                      const pickerOpen = castPickerShotNo === shotNo;
                      const toggleCastId = (assetId: string) => {
                        const id = String(assetId || '').trim();
                        if (!id) return;
                        const next = selectedIds.includes(id)
                          ? selectedIds.filter((x) => x !== id)
                          : [...selectedIds, id].slice(0, 2);
                        applyShotCastAssetIds(shotNo, rowIndex, next);
                      };
                      const removeCastId = (assetId: string) => {
                        const id = String(assetId || '').trim();
                        if (!id) return;
                        applyShotCastAssetIds(
                          shotNo,
                          rowIndex,
                          selectedIds.filter((x) => x !== id),
                        );
                      };
                      return (
                        <td className={`p-1 align-middle border-t overflow-visible ${cellBorder}`}>
                          <div
                            className="relative w-full flex items-center justify-center overflow-visible"
                            style={{ height: SHOTS_CONFIRM_REF_CELL_H }}
                          >
                            {thumbs.length > 0 ? (
                              <div className="flex items-center justify-center gap-1 h-full max-w-full">
                                {thumbs.map((t) => (
                                  <div
                                    key={`${t.id}-${t.url}`}
                                    className="relative h-full shrink-0"
                                    data-director-picker-keep="cast"
                                  >
                                    <DirectorAspectThumbButton
                                      frame="cast"
                                      maxH={SHOTS_CONFIRM_REF_CELL_H}
                                      maxW={Math.round(SHOTS_CONFIRM_REF_CELL_H * (16 / 9))}
                                      url={t.url}
                                      alt={t.name || tt.characters}
                                      title={
                                        pickerOpen
                                          ? `${tt.viewImage}: ${t.name || tt.characters}`
                                          : tt.castReplaceShot
                                      }
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (pickerOpen) {
                                          setImagePreview({
                                            url: t.url,
                                            name: t.name || tt.characters,
                                          });
                                          return;
                                        }
                                        setScenePickerShotNo(null);
                                        setSbSourceMenuShotNo(null);
                                        setSbPickerShotNo(null);
                                        setCastPickerShotNo(shotNo);
                                      }}
                                      onPointerDown={(e) => e.stopPropagation()}
                                    />
                                    {pickerOpen ? (
                                      <button
                                        type="button"
                                        className="nodrag absolute -top-1.5 -right-1.5 z-30 rounded-full p-0.5 bg-rose-600 text-white shadow-md ring-2 ring-white/80 hover:bg-rose-500"
                                        title={tt.castRemoveShot}
                                        aria-label={tt.castRemoveShot}
                                        data-director-picker-keep="cast"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          removeCastId(t.id);
                                        }}
                                        onPointerDown={(e) => e.stopPropagation()}
                                      >
                                        <X className="w-3.5 h-3.5" strokeWidth={3} />
                                      </button>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <button
                                type="button"
                                className={`nodrag flex items-center justify-center rounded-lg ring-1 ring-dashed ${
                                  isDarkMode
                                    ? 'ring-white/25 bg-black/25 text-white/40 hover:bg-white/[0.06]'
                                    : 'ring-gray-300 bg-gray-100 text-gray-400 hover:bg-gray-200/70'
                                }`}
                                style={{
                                  aspectRatio: '9 / 16',
                                  height: SHOTS_CONFIRM_REF_CELL_H,
                                }}
                                title={
                                  availableCast.length
                                    ? tt.castPickForShot
                                    : tt.castEmptyShotHint
                                }
                                disabled={availableCast.length === 0}
                                data-director-picker-keep="cast"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!availableCast.length) return;
                                  setScenePickerShotNo(null);
                                  setSbSourceMenuShotNo(null);
                                  setSbPickerShotNo(null);
                                  setCastPickerShotNo(pickerOpen ? null : shotNo);
                                }}
                                onPointerDown={(e) => e.stopPropagation()}
                              >
                                <Plus className="w-4 h-4 opacity-70" />
                              </button>
                            )}
                            {pickerOpen ? (
                              <div
                                data-director-picker-keep="cast"
                                className={`absolute left-0 top-full z-40 mt-1 min-w-[168px] rounded-lg border p-1.5 shadow-lg ${
                                  isDarkMode
                                    ? 'border-white/15 bg-zinc-950'
                                    : 'border-gray-200 bg-gray-100'
                                }`}
                                onPointerDown={(e) => e.stopPropagation()}
                              >
                                <div
                                  className={`px-1 pb-1 ${mutedCls}`}
                                  style={{ fontSize: Math.max(10, fsChrome - 1) }}
                                >
                                  {tt.castPickForShot}
                                  {availableCast.length >= 2 ? ' · ≤2' : ''}
                                </div>
                                <button
                                  type="button"
                                  className={`nodrag w-full flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left mb-0.5 ${
                                    selectedIds.length === 0
                                      ? isDarkMode
                                        ? 'bg-emerald-500/25 text-emerald-100'
                                        : 'bg-emerald-100 text-emerald-900'
                                      : isDarkMode
                                        ? 'hover:bg-white/8 text-white/85'
                                        : 'hover:bg-gray-200/70 text-gray-800'
                                  }`}
                                  style={{ fontSize: fsChrome }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    applyShotCastAssetIds(shotNo, rowIndex, []);
                                    setCastPickerShotNo(null);
                                  }}
                                >
                                  <span className="min-w-0 flex-1 truncate">
                                    {tt.castEmptyShotOption}
                                  </span>
                                  {selectedIds.length === 0 ? (
                                    <Check className="w-3.5 h-3.5 shrink-0" />
                                  ) : null}
                                </button>
                                {availableCast.map((a) => {
                                  const id = String(a.id || '').trim();
                                  const aUrl = String(a.imageUrl || '').trim();
                                  const aName = String(a.name || '').trim() || tt.characters;
                                  const on = selectedIds.includes(id);
                                  return (
                                    <button
                                      key={id}
                                      type="button"
                                      className={`nodrag w-full flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left ${
                                        on
                                          ? isDarkMode
                                            ? 'bg-sky-500/25 text-sky-100'
                                            : 'bg-sky-100 text-sky-900'
                                          : isDarkMode
                                            ? 'hover:bg-white/8 text-white/85'
                                            : 'hover:bg-gray-200/70 text-gray-800'
                                      }`}
                                      style={{ fontSize: fsChrome }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleCastId(id);
                                      }}
                                    >
                                      {aUrl ? (
                                        <img
                                          src={aUrl}
                                          alt=""
                                          className="w-8 h-10 object-cover rounded shrink-0"
                                          draggable={false}
                                        />
                                      ) : (
                                        <span
                                          className={`w-8 h-10 rounded shrink-0 ${softPanel}`}
                                        />
                                      )}
                                      <span className="min-w-0 flex-1 truncate">{aName}</span>
                                      {on ? <Check className="w-3.5 h-3.5 shrink-0" /> : null}
                                    </button>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        </td>
                      );
                    };
                    const renderLensCell = () => {
                      const angle = String(shot['镜头角度'] || '').trim();
                      const focal = String(shot['焦距'] || '').trim();
                      const editingAngle =
                        editing?.row === rowIndex && editing?.col === '镜头角度';
                      const editingFocal =
                        editing?.row === rowIndex && editing?.col === '焦距';
                      const inputCls = `nodrag nowheel w-full bg-transparent ring-1 rounded px-1 py-0.5 outline-none ${
                        isDarkMode
                          ? 'ring-blue-500/40 text-white/90'
                          : 'ring-blue-400/50 text-gray-900'
                      }`;
                      return (
                        <td className={`px-1 py-1.5 align-middle border-t ${cellBorder}`}>
                          <div className="flex flex-col items-center justify-center text-center gap-0.5 min-w-0">
                            {editingAngle ? (
                              <input
                                className={inputCls}
                                style={{ fontSize: fsSmall }}
                                autoFocus
                                defaultValue={angle}
                                onBlur={(e) => {
                                  patch(
                                    updateDirectorShotCell(
                                      state,
                                      rowIndex,
                                      '镜头角度',
                                      e.target.value,
                                    ),
                                  );
                                  setEditing(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') setEditing(null);
                                }}
                                onPointerDown={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <div
                                className={`nodrag cursor-text truncate ${bodyCls}`}
                                title={angle || undefined}
                                onClick={() => {
                                  setEditingAudioRow(null);
                                  setEditing({ row: rowIndex, col: '镜头角度' });
                                }}
                                onDoubleClick={() => {
                                  setEditingAudioRow(null);
                                  setEditing({ row: rowIndex, col: '镜头角度' });
                                }}
                              >
                                {angle || '—'}
                              </div>
                            )}
                            {editingFocal ? (
                              <input
                                className={inputCls}
                                style={{ fontSize: fsSmall }}
                                autoFocus
                                defaultValue={focal}
                                onBlur={(e) => {
                                  patch(
                                    updateDirectorShotCell(state, rowIndex, '焦距', e.target.value),
                                  );
                                  setEditing(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') setEditing(null);
                                }}
                                onPointerDown={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <div
                                className={`nodrag cursor-text truncate ${mutedCls}`}
                                style={{ fontSize: Math.max(10, fsChrome - 1) }}
                                title={focal || undefined}
                                onClick={() => {
                                  setEditingAudioRow(null);
                                  setEditing({ row: rowIndex, col: '焦距' });
                                }}
                                onDoubleClick={() => {
                                  setEditingAudioRow(null);
                                  setEditing({ row: rowIndex, col: '焦距' });
                                }}
                              >
                                {focal || '—'}
                              </div>
                            )}
                          </div>
                        </td>
                      );
                    };
                    const renderShotCell = (key: DirectorShotColumnKey) => {
                      const isFinal = key === '最终提示词';
                      const isWideText =
                        key === '画面描述' ||
                        key === '对白旁白' ||
                        key === '地点' ||
                        key === '出场人物' ||
                        key === '制作备注' ||
                        key === '连贯性' ||
                        key === '参考图绑定' ||
                        key === '光影氛围';
                      const val = isFinal ? finalVal : shot[key] || '';
                      const isEdit = editing?.row === rowIndex && editing?.col === key;
                      return (
                        <td
                          key={key}
                          className={`px-1.5 py-1.5 border-t ${cellBorder} ${
                            isWideText ? 'align-middle text-left' : 'align-top'
                          }`}
                        >
                          {isFinal ? (
                            val ? (
                              <button
                                type="button"
                                className={`director-keep-visible nodrag ${linkCls}`}
                                onClick={() => {
                                  setPromptPreviewShotNo(null);
                                  setPromptPreview(val);
                                }}
                              >
                                {tt.viewPrompt}
                              </button>
                            ) : (
                              <span className={mutedCls}>{tt.pendingPrompt}</span>
                            )
                          ) : isEdit ? (
                            <textarea
                              className={`nodrag nowheel w-full min-h-[40px] bg-transparent ring-1 rounded px-1 py-0.5 outline-none ${
                                isDarkMode
                                  ? 'ring-blue-500/40 text-white/90'
                                  : 'ring-blue-400/50 text-gray-900'
                              }`}
                              style={{ fontSize: fsSmall }}
                              autoFocus
                              defaultValue={val}
                              onBlur={(e) => {
                                patch(updateDirectorShotCell(state, rowIndex, key, e.target.value));
                                setEditing(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') setEditing(null);
                              }}
                            />
                          ) : (
                            <div
                              className={`nodrag cursor-text whitespace-pre-wrap break-words min-h-[18px] ${bodyCls} ${
                                isWideText ? 'text-left line-clamp-4' : 'line-clamp-6'
                              }`}
                              onClick={() => {
                                setEditingAudioRow(null);
                                setEditing({ row: rowIndex, col: key });
                              }}
                              onDoubleClick={() => {
                                setEditingAudioRow(null);
                                setEditing({ row: rowIndex, col: key });
                              }}
                            >
                              {key === '画面描述'
                                ? val
                                  ? highlightDescription(val, allAssets, isDarkMode)
                                  : (
                                      <span className={mutedCls}>—</span>
                                    )
                                : val || '—'}
                            </div>
                          )}
                        </td>
                      );
                    };
                    if (!isWizardMode) {
                      return (
                        <tr
                          key={rowIndex}
                          ref={measureElement}
                          data-index={rowIndex}
                          className={rowHover}
                        >
                          {(isDramaMode ? DRAMA_SHOT_COLS : SHOT_COLS).map((c) =>
                            renderShotCell(c.key),
                          )}
                        </tr>
                      );
                    }
                    return (
                      <tr
                        key={rowIndex}
                        ref={measureElement}
                        data-index={rowIndex}
                        data-director-shot-row="1"
                        data-shot-row-index={rowIndex}
                        className={`${rowUnseen ? shotRowUnseenHighlightCls : rowHover} border-b ${cellBorder} ${
                          shotFocusRowIndex === rowIndex
                            ? rowUnseen
                              ? isDarkMode
                                ? 'ring-sky-400/60'
                                : 'ring-sky-500/50'
                              : isDarkMode
                                ? 'ring-1 ring-inset ring-sky-400/50 bg-sky-500/10'
                                : 'ring-1 ring-inset ring-sky-400/40 bg-sky-50'
                            : ''
                        } ${
                          shotDragFromIndex === rowIndex
                            ? 'opacity-55'
                            : shotDragOverIndex === rowIndex && shotDragFromIndex != null
                              ? isDarkMode
                                ? 'bg-sky-500/15'
                                : 'bg-sky-50'
                              : ''
                        } ${
                          shotRowArmedIndex === rowIndex || shotDragFromIndex === rowIndex
                            ? 'cursor-grabbing'
                            : ''
                        }`}
                        style={isNodeFullscreen ? DIRECTOR_MV_TABLE_ROW_CV : undefined}
                        onPointerDown={(e) => onShotRowPointerDown(rowIndex, e)}
                        onPointerMove={(e) => onShotRowPointerMove(rowIndex, e)}
                        onPointerUp={(e) => onShotRowPointerUp(rowIndex, e)}
                        onPointerCancel={() => onShotRowPointerCancel(rowIndex)}
                        {...bindShotRowUnseenAck(shotNo, rowUnseen)}
                        onClickCapture={(e) => {
                          if (rowUnseen) acknowledgeShotRowUnseen(shotNo);
                          if (!shotRowSuppressClickRef.current) return;
                          e.preventDefault();
                          e.stopPropagation();
                          shotRowSuppressClickRef.current = false;
                        }}
                      >
                        <td
                          className={`px-1 py-2 align-middle text-center border-t ${cellBorder}`}
                        >
                          {renderShotNoCellContent(
                            shotNo,
                            rowIndex,
                            shotRowArmedIndex === rowIndex || shotDragFromIndex === rowIndex ? (
                              <button
                                type="button"
                                className={`nodrag inline-flex items-center justify-center rounded p-0.5 shrink-0 ${
                                  isDarkMode
                                    ? 'text-white/55 hover:bg-white/10 hover:text-rose-300'
                                    : 'text-gray-500 hover:bg-gray-200 hover:text-rose-600'
                                }`}
                                title={tt.deleteShot}
                                aria-label={tt.deleteShot}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  patch(
                                    removeDirectorShot(directorStateRef.current, rowIndex),
                                  );
                                  setShotRowArmedIndex(null);
                                }}
                                onPointerDown={(e) => e.stopPropagation()}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            ) : null,
                          )}
                        </td>
                        <td
                          className={`px-1 py-2 align-middle text-center tabular-nums border-t ${cellBorder} ${mutedCls}`}
                          style={{ fontSize: fsSmall }}
                        >
                          {editing?.row === rowIndex && editing?.col === '时长' ? (
                            <input
                              className={`nodrag nowheel w-full max-w-[3.25rem] mx-auto bg-transparent ring-1 rounded px-1 py-0.5 outline-none text-center ${
                                isDarkMode
                                  ? 'ring-blue-500/40 text-white/90'
                                  : 'ring-blue-400/50 text-gray-900'
                              }`}
                              style={{ fontSize: fsSmall }}
                              autoFocus
                              defaultValue={String(shot['时长'] || '').trim()}
                              placeholder="5s"
                              onBlur={(e) => {
                                const raw = e.target.value.trim();
                                const sec = parseDirectorShotDurationSec(raw, 0);
                                const nextDur =
                                  sec > 0 ? `${Math.round(sec)}s` : raw ? raw : '';
                                const latest = directorStateRef.current;
                                let next = updateDirectorShotCell(
                                  latest,
                                  rowIndex,
                                  '时长',
                                  nextDur,
                                );
                                if (sec > 0) {
                                  const range = shotMusicRanges[rowIndex] || {
                                    startSec: 0,
                                    endSec: sec,
                                    durationSec: sec,
                                  };
                                  const startSec = Math.max(0, Number(range.startSec) || 0);
                                  const endSec = startSec + sec;
                                  next = updateDirectorShotStoryboard(next, shotNo, {
                                    audioStartSec: startSec,
                                    audioEndSec: endSec,
                                    songClipUrl: '',
                                    songClipSourceUrl: '',
                                    songClipStartSec: startSec,
                                    songClipEndSec: endSec,
                                  });
                                }
                                patch(next);
                                setEditing(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') setEditing(null);
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  (e.currentTarget as HTMLInputElement).blur();
                                }
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <div
                              className="nodrag cursor-text min-h-[18px]"
                              title={tt.colDuration}
                              onClick={() => {
                                setEditingAudioRow(null);
                                setEditing({ row: rowIndex, col: '时长' });
                              }}
                            >
                              {String(shot['时长'] || '').trim() || '—'}
                            </div>
                          )}
                        </td>
                        <td
                          className={`px-1.5 py-1.5 align-middle text-left border-t ${cellBorder}`}
                        >
                          {renderFinalPromptHoverCell({
                            text: finalVal,
                            editText: resolveShotFinalPrompt(shot),
                            shotNo,
                            rowIndex,
                          })}
                        </td>
                        {renderMvNamedRefCell('scene', sceneUrl, sceneNames)}
                        {renderMvCastRefCell()}
                        {renderLensCell()}
                        <td
                          className={`px-1.5 py-2 align-middle text-center border-t ${cellBorder}`}
                        >
                          {shotHasExplicitAudioRange(shot, shotNo) ? (
                            renderShotSongClipCell(
                              audioRange,
                              shotNo,
                              SHOTS_CONFIRM_AUDIO_WIDTH_CLS,
                              'confirmPill',
                              { rowIndex, editableTime: true },
                            )
                          ) : (
                            <button
                              type="button"
                              className={`nodrag mx-auto min-h-[36px] min-w-[4rem] rounded-md px-2 ${mutedCls} hover:opacity-90`}
                              title={tt.colDuration}
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingAudioRow(null);
                                setEditing({ row: rowIndex, col: '时长' });
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                            >
                              —
                            </button>
                          )}
                        </td>
                        <td className={`px-1 py-2 align-middle border-t ${cellBorder}`}>
                          {(() => {
                            const actionFs = Math.max(10, fsChrome - 1);
                            const actionSecondaryCls = isDarkMode
                              ? 'nodrag inline-flex w-full items-center justify-center gap-1 rounded-md px-1.5 py-0.5 ring-1 whitespace-nowrap font-medium bg-white/[0.1] text-white/90 ring-white/20 hover:bg-white/[0.16] hover:text-white disabled:opacity-40'
                              : 'nodrag inline-flex w-full items-center justify-center gap-1 rounded-md px-1.5 py-0.5 ring-1 whitespace-nowrap font-medium bg-white text-gray-800 ring-gray-300 hover:bg-sky-50 hover:text-sky-800 hover:ring-sky-300 disabled:opacity-40';
                            const rowIconCls = isDarkMode
                              ? 'nodrag inline-flex items-center justify-center rounded p-0.5 text-white/55 hover:bg-white/10 hover:text-white/90'
                              : 'nodrag inline-flex items-center justify-center rounded p-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-900';
                            const sbGenLabel = sbUrl
                              ? tt.regenerateStoryboard
                              : tt.generateThisStoryboard;
                            const sbGenDisabled = !finalVal || isDirectorHardBusy;
                            return (
                              <div className="flex flex-col items-stretch gap-1 min-w-0">
                                <div className="flex items-center justify-center gap-0.5">
                                  <button
                                    type="button"
                                    className={rowIconCls}
                                    title={tt.insertShotBefore}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const next = insertDirectorShot(
                                        directorStateRef.current,
                                        rowIndex,
                                      );
                                      patch(next);
                                      focusShotTableRow(rowIndex);
                                    }}
                                    onPointerDown={(e) => e.stopPropagation()}
                                  >
                                    <ChevronUp className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    className={rowIconCls}
                                    title={tt.insertShotAfter}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const next = insertDirectorShot(
                                        directorStateRef.current,
                                        rowIndex + 1,
                                      );
                                      patch(next);
                                      focusShotTableRow(rowIndex + 1);
                                    }}
                                    onPointerDown={(e) => e.stopPropagation()}
                                  >
                                    <ChevronDown className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                                <span className="relative inline-flex w-full">
                                  <button
                                    type="button"
                                    className={`nodrag ${btnPrimary('!px-1.5 !py-0.5 rounded-md w-full', 'events')} disabled:opacity-50`}
                                    style={{ fontSize: actionFs }}
                                    disabled={sbGenDisabled}
                                    title={
                                      !finalVal ? tt.pendingPrompt : sbGenLabel
                                    }
                                    onMouseEnter={() => {
                                      if (finalVal) setPriceHoverKey(`sb-gen-${shotNo}`);
                                    }}
                                    onMouseLeave={() =>
                                      setPriceHoverKey((k) =>
                                        k === `sb-gen-${shotNo}` ? null : k,
                                      )
                                    }
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      enqueueStoryboardShots([shotNo], { onlyMissing: false });
                                    }}
                                  >
                                    {sbGenerating ? (
                                      <Loader2 className="w-3 h-3 animate-spin inline" />
                                    ) : (
                                      sbGenLabel
                                    )}
                                  </button>
                                  {renderYuanbaoHoverTip(`sb-gen-${shotNo}`, 1)}
                                </span>
                                {data?.onPickImageFromCanvas ? (
                                  <button
                                    type="button"
                                    className={actionSecondaryCls}
                                    style={{ fontSize: actionFs }}
                                    title={tt.pickFromCanvas}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void pickStoryboardFromCanvas(shotNo);
                                    }}
                                  >
                                    <MousePointerClick className="w-3 h-3 shrink-0 opacity-80" />
                                    {tt.pickFromCanvas}
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className={actionSecondaryCls}
                                  style={{ fontSize: actionFs }}
                                  title={tt.uploadLocal}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onUploadStoryboardClick(shotNo);
                                  }}
                                >
                                  <Upload className="w-3 h-3 shrink-0 opacity-80" />
                                  {tt.uploadLocal}
                                </button>
                              </div>
                            );
                          })()}
                        </td>
                        <td className={`p-1 align-middle border-t overflow-visible ${cellBorder}`}>
                          <div
                            className="relative w-full flex items-center justify-center overflow-visible"
                            style={{ minHeight: SHOTS_CONFIRM_SB_THUMB_PX }}
                            data-director-picker-keep="sb"
                            onMouseEnter={() => openSbVersionPicker(shotNo, sbVersions.length)}
                            onMouseLeave={() => scheduleCloseSbVersionPicker(shotNo)}
                          >
                            {sbUrl ? (
                              <div
                                className="relative inline-flex max-w-full group/sbf overflow-hidden rounded-lg"
                                data-director-picker-keep="sb"
                              >
                                <DirectorAspectThumbButton
                                  frame="storyboard"
                                  maxH={SHOTS_CONFIRM_SB_THUMB_PX}
                                  maxW={Math.round(SHOTS_CONFIRM_SB_THUMB_PX * (16 / 9))}
                                  url={sbUrl}
                                  alt={`镜${shotNo}`}
                                  title={
                                    sbVersions.length > 1
                                      ? tt.storyboardPickVersion
                                      : finalVal
                                        ? `${tt.viewPrompt}\n\n${finalVal}`
                                        : `${tt.viewImage}: ${tt.colStoryboard} ${shotNo}`
                                  }
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (sbVersions.length > 1) {
                                      openSbVersionPicker(shotNo, sbVersions.length);
                                    } else {
                                      setImagePreview({ url: sbUrl, name: `镜${shotNo}` });
                                    }
                                  }}
                                  onPointerDown={(e) => e.stopPropagation()}
                                />
                                {sbVersions.length > 1 ? (
                                  <span
                                    className={`pointer-events-none absolute left-1 top-1 z-20 rounded px-1 font-medium tabular-nums ${
                                      isDarkMode
                                        ? 'bg-black/70 text-white/90'
                                        : 'bg-gray-100/95 text-gray-700 shadow'
                                    }`}
                                    style={{ fontSize: 10 }}
                                  >
                                    {sbVersions.length}
                                  </span>
                                ) : null}
                                <button
                                  type="button"
                                  className={`nodrag absolute top-1 right-1 z-30 rounded p-0.5 ${
                                    isDarkMode
                                      ? 'bg-black/70 text-white/90 ring-1 ring-white/20'
                                      : 'bg-gray-100/95 text-gray-700 ring-1 ring-gray-300 shadow'
                                  }`}
                                  title={tt.viewImage}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setImagePreview({ url: sbUrl, name: `镜${shotNo}` });
                                  }}
                                  onPointerDown={(e) => e.stopPropagation()}
                                >
                                  <ZoomIn className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  className={`nodrag absolute bottom-1 right-1 z-20 rounded p-0.5 opacity-0 group-hover/sbf:opacity-100 transition-opacity ${
                                    isDarkMode
                                      ? 'bg-black/70 text-white/90 ring-1 ring-white/20'
                                      : 'bg-gray-100/95 text-gray-700 ring-1 ring-gray-300 shadow'
                                  }`}
                                  title={tt.downloadStoryboard}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const a = document.createElement('a');
                                    a.href = sbUrl;
                                    a.download = `shot-${shotNo}-storyboard`;
                                    a.rel = 'noopener';
                                    a.click();
                                  }}
                                  onPointerDown={(e) => e.stopPropagation()}
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </button>
                                {renderDirectorThumbProgress({
                                  visible: sbGenerating,
                                  message: tt.generatingStoryboard,
                                })}
                              </div>
                            ) : sbGenerating ? (
                              <div
                                className={`relative rounded-lg overflow-hidden ring-1 ring-dashed ${
                                  isDarkMode
                                    ? 'ring-white/20 bg-white/[0.04]'
                                    : 'ring-gray-300 bg-gray-100'
                                }`}
                                style={{
                                  aspectRatio: '16 / 9',
                                  height: Math.round(SHOTS_CONFIRM_SB_THUMB_PX * 0.85),
                                  maxWidth: '100%',
                                }}
                              >
                                {renderDirectorThumbProgress({
                                  visible: true,
                                  message: tt.generatingStoryboard,
                                })}
                              </div>
                            ) : (
                              <div
                                className={`flex items-center justify-center rounded-lg ring-1 ring-dashed ${
                                  isDarkMode
                                    ? 'ring-white/25 bg-black/30 text-white/45'
                                    : 'ring-gray-300 bg-gray-100 text-gray-400'
                                }`}
                                style={{
                                  aspectRatio: '16 / 9',
                                  height: Math.round(SHOTS_CONFIRM_SB_THUMB_PX * 0.85),
                                  maxWidth: '100%',
                                }}
                              >
                                <Plus className="w-4 h-4" strokeWidth={2} />
                              </div>
                            )}
                            {sbUrl
                              ? renderSbVersionPopover(shotNo, sbVersions, sbUrl)
                              : null}
                          </div>
                          {sb?.status === 'error' && sb.error ? (
                            <div className="text-[10px] text-rose-400 mt-0.5 line-clamp-2">
                              {sb.error}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  <DirectorTableVirtualPad height={paddingBottom} colSpan={shotTableColSpan} />
                </tbody>
              </table>
          )}
        </DirectorShotTableVirtual>
            {isWizardMode && state.shots.length > 0 ? (
              <div
                className={`shrink-0 flex items-center gap-2 flex-wrap px-1 py-1.5 border-t ${cellBorder}`}
                style={{ fontSize: fsSmall }}
              >
                {(() => {
                  const musicSec = isMvMode ? Math.round(Number(state.mvMusic?.durationSec) || 0) : 0;
                  const sumSec = sumDirectorShotsDurationSec(state.shots);
                  const matched = musicSec > 0 && Math.abs(sumSec - musicSec) <= 1;
                  return (
                    <>
                      <div className={`tabular-nums ${matched ? bodyCls : 'text-amber-400'}`}>
                        {fillDirectorI18n(tt.shotsDurationSummary, {
                          sum: String(sumSec),
                          music: String(musicSec || '—'),
                        })}
                        <span className={`ml-2 ${matched ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {matched ? tt.shotsDurationMatched : tt.shotsDurationMismatch}
                        </span>
                      </div>
                      {!matched && musicSec > 0 ? (
                        <button
                          type="button"
                          className={`nodrag ${btnPrimary('!px-2.5 !py-1', 'control')} disabled:opacity-50`}
                          style={{ fontSize: fsChrome }}
                          disabled={!!busyAction}
                          onClick={() =>
                            patch({
                              ...directorStateRef.current,
                              shots: ensureMvShotsMatchMusicDuration(
                                directorStateRef.current.shots,
                                musicSec,
                              ),
                            })
                          }
                        >
                          {tt.shotsDurationAlign}
                        </button>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            ) : null}
        {includeGenerateBar ? <div className="shrink-0">{renderShotsGenerateBar()}</div> : null}
          </div>
    );
  };

  // 视频生成：比例跟分镜画幅（进入 videos 时在 goDirectorPhase 同步，避免每进一次再 patch 触发重渲）

  const renderLipsyncHint = () => {
    if (dialogueShotCount <= 0) return null;
    return (
      <div
        className={`flex items-center gap-2 flex-wrap justify-center w-full mb-1 px-2 py-1 rounded-md ${
          isDarkMode ? 'bg-amber-500/10 text-amber-100/90' : 'bg-amber-50 text-amber-900'
        }`}
        style={{ fontSize: fsSmall }}
      >
        <span>{fillDirectorI18n(tt.lipsyncRecommend, { n: dialogueShotCount })}</span>
        <span className={isDarkMode ? 'text-amber-100/70' : 'text-amber-800/80'}>
          {tt.videoBatchLipsyncModelLabel}
        </span>
      </div>
    );
  };

  const promptsProg = useMemo(() => countShotsWithFinalPrompt(state.shots), [state.shots]);
  const storyboardsProg = useMemo(
    () => countDirectorStoryboards(state.shots, state.storyboardsByShotNo),
    [state.shots, state.storyboardsByShotNo],
  );

  const resolveDirectorImageUrl = useCallback((result: {
    imageUrl?: string;
    localPath?: string;
    url?: string;
  }) => {
    let imageUrl = String(result?.imageUrl || result?.url || '').trim();
    const localPath = String(result?.localPath || '').trim();
    if (localPath) {
      imageUrl = formatDirectorLocalImageUrl(localPath);
    }
    return imageUrl;
  }, []);

  const runNextImageGenRef = useRef<(() => Promise<void>) | null>(null);

  const finishDirectorImageSlot = useCallback(
    (assetId: string, opts?: { advance?: boolean }) => {
      const wasInFlight = imageGenInFlightRef.current.has(assetId);
      const wasQueued = imageGenQueueRef.current.some((a) => a.id === assetId);
      imageGenQueueRef.current = imageGenQueueRef.current.filter((a) => a.id !== assetId);
      if (wasInFlight) {
        imageGenInFlightRef.current.delete(assetId);
      }
      markImageGenProgress(assetId, false);
      if (opts?.advance !== false && (wasInFlight || wasQueued)) {
        void runNextImageGenRef.current?.();
        return;
      }
      if (imageGenInFlightRef.current.size === 0 && imageGenQueueRef.current.length === 0) {
        imageGenActiveRef.current = false;
        imageGenMaxParallelRef.current = IMAGE_GEN_MAX_PARALLEL_DEFAULT;
        setBusyAction(null);
      }
    },
    [markImageGenProgress],
  );

  /** 资产生图/上传结果回写短剧 Domain（人物/场景/道具/生物） */
  const syncDomainAssetImage = useCallback(
    (
      assetId: string,
      opts: {
        imageUrl?: string;
        status?: 'pending' | 'generating' | 'ready' | 'error';
        error?: string;
      },
    ) => {
      if (!isDramaMode) return;
      const cur = dataRef.current;
      const domain = (cur?.directorDomain as DramaDirectorSession | null) || null;
      const next = applyDramaSessionAssetImage(domain, assetId, opts);
      if (!next) return;
      if (cur) dataRef.current = { ...cur, directorDomain: next };
      dataRef.current?.onUpdate?.({ directorDomain: next });
    },
    [isDramaMode],
  );

  const syncDomainVoiceSample = useCallback(
    (
      voiceId: string,
      opts: {
        sampleUrl?: string;
        model?: string;
        status?: 'pending' | 'generating' | 'ready' | 'error';
        error?: string;
      },
    ) => {
      if (!isDramaMode) return;
      const cur = dataRef.current;
      const domain = (cur?.directorDomain as DramaDirectorSession | null) || null;
      const next = applyDramaSessionVoiceSample(domain, voiceId, opts);
      if (!next) return;
      if (opts.status === 'ready' || opts.status === 'error' || opts.status === 'pending') {
        markVoiceGenProgress(voiceId, false);
      }
      if (cur) dataRef.current = { ...cur, directorDomain: next };
      dataRef.current?.onUpdate?.({ directorDomain: next });
    },
    [isDramaMode, markVoiceGenProgress],
  );

  /** 单条 / 一键：先立刻亮绿条，再一次性写回 Domain generating，避免并行整包互踩把进度冲掉 */
  const startVoiceSampleGens = useCallback(
    (voiceIds: string[]) => {
      const wanted = [
        ...new Set(voiceIds.map((x) => String(x || '').trim()).filter(Boolean)),
      ].filter((id) => !voiceGenProgressIdsRef.current[id]);
      if (!wanted.length) return;
      for (const voiceId of wanted) markVoiceGenProgress(voiceId, true);
      void (async () => {
        let domain = (dataRef.current?.directorDomain as DramaDirectorSession | null) || null;
        if (!domain?.bible) {
          for (const voiceId of wanted) markVoiceGenProgress(voiceId, false);
          void showAlert(tt.generateFailed);
          return;
        }
        domain = ensureVoiceSampleTexts(domain);
        const voices = (domain.bible.voices || []).map((v) => {
          if (!wanted.includes(v.voice_id)) return v;
          let prompt = String(v.sample_text || '').trim();
          const ch = domain!.bible.characters.find((c) => c.character_id === v.character_id);
          if (!prompt) {
            prompt = composeDramaVoiceSampleLine({
              name: ch?.name,
              age: ch?.age,
              role: ch?.role,
              identity: ch?.identity,
              personality: ch?.personality,
              gender: ch?.gender,
              timbre: v.timbre,
              voiceStyle: v.voiceStyle,
              language_style: v.language_style,
              emotion_range: v.emotion_range,
            });
          }
          return { ...v, sample_text: prompt || v.sample_text };
        });
        domain = createEmptyDramaSession({
          ...domain,
          bible: { ...domain.bible, voices },
        });
        const toInvoke: Array<{ voiceId: string; text: string }> = [];
        const generatingVoices = (domain.bible.voices || []).map((v) => {
          if (!wanted.includes(v.voice_id)) return v;
          const text = String(v.sample_text || '').trim();
          if (!text) return v;
          toInvoke.push({ voiceId: v.voice_id, text });
          return {
            ...v,
            model: DOUBAO_SEED_AUDIO_MODEL_ID,
            status: 'generating' as const,
            error: undefined,
          };
        });
        domain = createEmptyDramaSession({
          ...domain,
          bible: { ...domain.bible, voices: generatingVoices },
        });
        const skipped = wanted.filter((id) => !toInvoke.some((x) => x.voiceId === id));
        for (const voiceId of skipped) markVoiceGenProgress(voiceId, false);
        if (skipped.length && !toInvoke.length) {
          void showAlert(
            locale === 'en'
              ? 'Add a sample dialogue line first'
              : '请先填写试听台词（一段可念的短句）',
          );
          return;
        }
        if (!window.electronAPI?.invokeAI) {
          for (const { voiceId } of toInvoke) markVoiceGenProgress(voiceId, false);
          void showAlert(tt.generateFailed);
          return;
        }
        const cur = dataRef.current;
        if (cur) dataRef.current = { ...cur, directorDomain: domain };
        dataRef.current?.onUpdate?.({ directorDomain: domain });
        await Promise.all(
          toInvoke.map(async ({ voiceId, text }) => {
            const voice = domain!.bible.voices.find((v) => v.voice_id === voiceId);
            const ch = domain!.bible.characters.find((c) => c.character_id === voice?.character_id);
            const refAudio = String(voice?.sample_url || voice?.identity?.reference_audio || '').trim();
            const charImageUrl = String(ch?.imageUrl || '').trim();
            // 人物卡片声音生成：优先参考音频复刻；其次照片猜声音；都没有则用预设音色直接生成
            const hasRefAudio = !!refAudio;
            const hasImage = !hasRefAudio && !!charImageUrl;
            const fallbackSpeaker = !hasRefAudio && !hasImage ? 'zh_female_vv_uranus_bigtts' : '';
            try {
              await window.electronAPI!.invokeAI({
                modelId: 'audio',
                nodeId: directorVoiceSampleNodeId(id, voiceId),
                input: {
                  model: DOUBAO_SEED_AUDIO_MODEL_ID,
                  text,
                  enable_base64_output: false,
                  english_normalization: false,
                  speechRate: 0,
                  loudnessRate: 0,
                  pitch: 0,
                  doubaoFormat: 'mp3',
                  doubaoSampleRate: '24000',
                  projectId: data?.projectId || undefined,
                  nodeTitle: `导演声音-${voice?.voice_id || voiceId}`,
                  ...(hasRefAudio
                    ? { doubaoAudioUrls: [refAudio], referenceAudioUrl: refAudio }
                    : hasImage
                      ? { doubaoImageUrl: charImageUrl }
                      : { doubaoSpeaker: fallbackSpeaker }),
                },
              });
            } catch (e) {
              const msg = e instanceof Error ? e.message : tt.generateFailed;
              syncDomainVoiceSample(voiceId, {
                status: 'error',
                error: msg,
              });
              void showAlert(
                /超时|退回元宝/.test(msg)
                  ? msg
                  : locale === 'en'
                    ? `Voice generation failed: ${msg}`
                    : `声音生成失败：${msg}`,
              );
            }
          }),
        );
      })();
    },
    [id, data?.projectId, locale, markVoiceGenProgress, showAlert, syncDomainVoiceSample, tt.generateFailed],
  );

  /** 试听音本地看门狗：略长于主进程 3 分钟，避免抢在退费 ERROR 前清掉 */
  useEffect(() => {
    if (!isDramaMode) return;
    const VOICE_GEN_TIMEOUT_MS = 3 * 60 * 1000 + 15_000;
    const tick = () => {
      const started = voiceGenStartedAtRef.current;
      const now = Date.now();
      const overdue = Object.keys(started).filter((vid) => now - (started[vid] || 0) >= VOICE_GEN_TIMEOUT_MS);
      if (!overdue.length) return;
      const failMsg =
        locale === 'en'
          ? 'Voice generation timed out (3 min). Credits refunded if charged.'
          : '声音生成超时（3分钟未完成），已退回元宝';
      for (const voiceId of overdue) {
        syncDomainVoiceSample(voiceId, { status: 'error', error: failMsg });
      }
      void showAlert(failMsg);
    };
    const timer = window.setInterval(tick, 5000);
    return () => window.clearInterval(timer);
  }, [isDramaMode, locale, showAlert, syncDomainVoiceSample]);

  /** 本镜音频本地看门狗：等待上限 3 分钟 */
  useEffect(() => {
    if (!isDramaMode) return;
    const SHOT_AUDIO_TIMEOUT_MS = 3 * 60 * 1000;
    const tick = () => {
      const started = shotAudioStartedAtRef.current;
      const now = Date.now();
      const overdue = Object.keys(started).filter(
        (sid) => now - (started[sid] || 0) >= SHOT_AUDIO_TIMEOUT_MS,
      );
      if (!overdue.length) return;
      const domain = (dataRef.current?.directorDomain as DramaDirectorSession | null) || null;
      if (!domain?.shots?.length) return;
      const failMsg =
        locale === 'en'
          ? 'Shot audio timed out (3 min). Please retry.'
          : '本镜音频生成超时（3分钟未完成），请重试';
      let changed = false;
      const shots = domain.shots.map((s) => {
        if (!overdue.includes(s.shot_id) || String(s.audio_status || '') !== 'generating') {
          return s;
        }
        changed = true;
        delete shotAudioStartedAtRef.current[s.shot_id];
        return { ...s, audio_status: 'error', audio_error: failMsg };
      });
      if (!changed) return;
      dataRef.current?.onUpdate?.({
        directorDomain: createEmptyDramaSession({ ...domain, shots }),
      });
      void showAlert(failMsg);
    };
    const timer = window.setInterval(tick, 5000);
    return () => window.clearInterval(timer);
  }, [isDramaMode, locale, showAlert]);

  /** 重启/重进后仍卡在 generating 的试听音：清掉转圈（昨日未完成） */
  useEffect(() => {
    if (!isDramaMode) return;
    const domain = (dataRef.current?.directorDomain as DramaDirectorSession | null) || null;
    if (!domain?.bible?.voices?.length) return;
    const active = voiceGenProgressIdsRef.current;
    const stuck = (domain.bible.voices || []).filter(
      (v) => v.status === 'generating' && !active[v.voice_id] && !String(v.sample_url || '').trim(),
    );
    if (!stuck.length) return;
    let next = domain;
    for (const v of stuck) {
      const patched = applyDramaSessionVoiceSample(next, v.voice_id, {
        status: 'error',
        error:
          locale === 'en'
            ? 'Previous voice generation did not finish. Please retry.'
            : '上次声音生成未完成（已超时或中断），请重新生成；失败任务通常会退回元宝',
      });
      if (patched) next = patched;
    }
    if (next === domain) return;
    const cur = dataRef.current;
    if (cur) dataRef.current = { ...cur, directorDomain: next };
    dataRef.current?.onUpdate?.({ directorDomain: next });
  }, [isDramaMode, locale]);

  /** 重启/重进后仍卡在 generating 的本镜音频（只清一次，避免与 Domain 写回互撞） */
  const shotAudioStuckClearedRef = useRef(false);
  useEffect(() => {
    if (!isDramaMode) return;
    if (shotAudioStuckClearedRef.current) return;
    const domain = (dataRef.current?.directorDomain as DramaDirectorSession | null) || null;
    if (!domain?.shots?.length) return;
    const active = shotAudioStartedAtRef.current;
    const stuck = domain.shots.filter(
      (s) =>
        String(s.audio_status || '') === 'generating' &&
        !active[s.shot_id] &&
        !String(s.audio_url || '').trim(),
    );
    if (!stuck.length) {
      shotAudioStuckClearedRef.current = true;
      return;
    }
    shotAudioStuckClearedRef.current = true;
    const failMsg =
      locale === 'en'
        ? 'Previous shot audio did not finish. Please retry.'
        : '上次本镜音频未完成（已超时或中断），请重新生成';
    dataRef.current?.onUpdate?.({
      directorDomain: createEmptyDramaSession({
        ...domain,
        shots: domain.shots.map((s) =>
          stuck.some((x) => x.shot_id === s.shot_id)
            ? { ...s, audio_status: 'error', audio_error: failMsg }
            : s,
        ),
      }),
    });
  }, [isDramaMode, locale]);

  // 补偿：pipeline 有图且 Domain 非生成中 → 回写；队列空时清孤儿 generating
  useEffect(() => {
    if (!isDramaMode) return;
    const domain = (dataRef.current?.directorDomain as DramaDirectorSession | null) || null;
    if (!domain?.bible) return;
    const assets = flattenDirectorAssets(directorStateRef.current.assets);
    const urlByAssetId: Record<string, string> = {};
    for (const a of assets) {
      const url = String(a.imageUrl || '').trim();
      if (url) urlByAssetId[a.id] = url;
    }
    const queueBusy =
      imageGenInFlightRef.current.size > 0 || imageGenQueueRef.current.length > 0;

    if (queueBusy) {
      // 生图进行中：pipeline 已有成图的 id 必须立刻回写 Domain（否则任务列表完成、卡片一直「等待」）
      // 但跳过正在生成中的 id（避免重新生成已有图的角色时进度条被立即清除）
      let next = domain;
      let changed = false;
      for (const [assetId, url] of Object.entries(urlByAssetId)) {
        const id = String(assetId || '').trim();
        if (!id || !url) continue;
        // 跳过正在生成中的 id（imageGenProgressIds 或 inflight 标记）
        if (imageGenProgressIds[id] || imageGenInFlightRef.current.has(id)) continue;
        const ch = next.bible.characters.find((c) => c.character_id === id);
        const sc = next.bible.scenes.find((s) => s.scene_id === id);
        const pr = next.bible.props.find((p) => p.prop_id === id);
        const cr = next.bible.creatures.find((c) => c.creature_id === id);
        const sysVoice =
          isDramaSystemVisualAssetId(id, next) ? resolveDramaSystemVoice(next) : null;
        const target = ch || sc || pr || cr || sysVoice;
        if (!target) continue;
        const own = String(
          sysVoice
            ? sysVoice.imageUrl || ''
            : (target as { imageUrl?: string }).imageUrl || '',
        ).trim();
        const st = String(
          sysVoice
            ? sysVoice.image_status || ''
            : (target as { status?: string }).status || '',
        ).trim();
        if (own === url && (sysVoice ? st === 'ready' || !st : st === 'ready')) continue;
        // 只收口 generating / 填空。禁止用 pipeline 里的旧定妆盖掉 Domain 刚写上的新图。
        if (st !== 'generating' && own) continue;
        const patched = applyDramaSessionAssetImage(next, id, {
          imageUrl: url,
          status: 'ready',
        });
        if (patched) {
          next = patched;
          changed = true;
          markImageGenProgress(id, false);
        }
      }
      if (changed) dataRef.current?.onUpdate?.({ directorDomain: next });
      return;
    }

    // 声音生成不走 image queue：正在 generating 的 voice 必须列入 preserve，
    // 否则对账会立刻把进度条清成 ready/pending。
    // imageGenProgressIds：入队前的即时绿条窗口，也必须 preserve。
    const preserveGenerating = new Set<string>([
      ...imageGenInFlightRef.current,
      ...Object.keys(imageGenProgressIds),
      ...Object.keys(voiceGenProgressIds),
      ...domain.bible.voices
        .filter((v) => v.status === 'generating')
        .map((v) => v.voice_id)
        .filter(Boolean),
    ]);
    const healed = healDramaSessionStuckAssetGenerating(
      domain,
      urlByAssetId,
      preserveGenerating,
    );
    const restored = restoreDramaBibleMediaFromPipeline(
      healed || domain,
      directorStateRef.current.assets,
    );
    if (restored) dataRef.current?.onUpdate?.({ directorDomain: restored });
    else if (healed) dataRef.current?.onUpdate?.({ directorDomain: healed });
  }, [isDramaMode, state.assets, imageGenProgressIds, voiceGenProgressIds, markImageGenProgress]);

  const applyDirectorImageSuccess = useCallback(
    (assetId: string, result: { imageUrl?: string; localPath?: string; url?: string }) => {
      let imageUrl = resolveDirectorImageUrl(result);
      if (!imageUrl) {
        // 不要回退到 pipeline 旧图：Workspace 可能已写入新图，再用旧定妆回写会把主体框盖回去。
        finishDirectorImageSlot(assetId);
        return;
      }
      const latest = directorStateRef.current;
      const hit = findDirectorAssetById(latest.assets, assetId);
      if (hit) {
        patch(
          updateDirectorAsset(latest, assetId, {
            imageUrl,
            status: 'ready',
            error: undefined,
          }),
        );
      }
      // 即使 pipeline 暂无该资产，也必须回写 Domain，否则任务列表有图、卡片仍「生成中」
      syncDomainAssetImage(assetId, { imageUrl, status: 'ready' });
      finishDirectorImageSlot(assetId);
    },
    [finishDirectorImageSlot, patch, resolveDirectorImageUrl, syncDomainAssetImage],
  );

  const applyDirectorImageError = useCallback(
    (assetId: string, msg: string) => {
      const latest = directorStateRef.current;
      if (findDirectorAssetById(latest.assets, assetId)) {
        patch(
          updateDirectorAsset(latest, assetId, {
            status: 'error',
            error: msg || tt.generateFailed,
          }),
        );
      }
      syncDomainAssetImage(assetId, {
        status: 'error',
        error: msg || tt.generateFailed,
      });
      finishDirectorImageSlot(assetId);
    },
    [finishDirectorImageSlot, patch, syncDomainAssetImage, tt.generateFailed],
  );

  const materializeStyleReferenceUrl = useCallback(
    async (publicOrLocalUrl: string): Promise<string> => {
      const url = String(publicOrLocalUrl || '').trim();
      if (!url) return '';
      if (
        url.startsWith('local-resource://') ||
        url.startsWith('file://') ||
        /^https?:\/\//i.test(url)
      ) {
        return url;
      }
      try {
        const resp = await fetch(url);
        if (!resp.ok) return url;
        const buf = await resp.arrayBuffer();
        const api = window.electronAPI;
        if (!api?.createImageLocalResourceFromBuffer) return url;
        const result = await api.createImageLocalResourceFromBuffer(
          data?.projectId,
          `director-style-ref-${Date.now()}.png`,
          buf,
        );
        return String(result?.previewUrl || result?.originalUrl || url).trim() || url;
      } catch {
        return url;
      }
    },
    [data?.projectId],
  );

  const startOneAssetImageGen = useCallback(
    async (nextAsset: DirectorAsset) => {
      if (!window.electronAPI?.invokeAI) {
        applyDirectorImageError(nextAsset.id, tt.generateFailed);
        return;
      }
      const latest = directorStateRef.current;
      const live = findDirectorAssetById(latest.assets, nextAsset.id);
      let asset = live?.asset || nextAsset;
      const kind = live?.kind || nextAsset.kind;
      markImageGenProgress(asset.id, true);
      patch(updateDirectorAsset(latest, asset.id, { status: 'generating', error: undefined }));
      const imageNodeId = directorAssetImageNodeId(id, asset.id);
      try {
        const domain = (dataRef.current?.directorDomain as DramaDirectorSession | null) || null;
        const isSystemVisual =
          !!domain &&
          (String(asset.id || '').trim() === DRAMA_SYSTEM_SPEAKER_ID ||
            isDramaSystemVisualAssetId(asset.id, domain));
        // 系统形象提示词以 Domain voice.image_prompt 为准，生成前强制同步，避免 pipeline 旧稿盖住用户修改
        if (isSystemVisual && domain) {
          const sysVoice = resolveDramaSystemVoice(domain);
          const freshPrompt = composeDramaSystemVisualPrompt(sysVoice?.image_prompt);
          if (freshPrompt && freshPrompt !== String(asset.prompt || '').trim()) {
            patch(
              updateDirectorAsset(directorStateRef.current, asset.id, {
                prompt: freshPrompt,
              }),
            );
            asset = { ...asset, prompt: freshPrompt };
          }
        }
        const genreLock = resolveDramaGenreLock({
          style: domain?.bible?.project?.style || latest.mvStoryAnalysis?.genre,
          type: domain?.bible?.project?.type,
          era: domain?.bible?.project?.era,
          visual_style: domain?.bible?.project?.visual_style || latest.globalStyle,
          worldview: domain?.bible?.project?.worldview,
          plot: domain?.bible?.plot,
          script: domain?.meta?.source_script || domain?.meta?.source_novel || latest.scriptText,
          keywords: domain?.bible?.script_keywords,
        });
        const baseStyle = resolveDirectorStylePrompt(latest.stylePresetId, latest.globalStyle);
        const styleHint = composeDramaImageStyleHint(
          genreLock,
          baseStyle,
          domain?.bible?.project?.visual_style,
          domain?.bible?.project?.style,
        );
        const assetPromptForGen =
          kind === 'character' && !isSystemVisual
            ? ensureDramaCharacterPromptGenreLock(asset.prompt, genreLock)
            : asset.prompt;
        if (
          kind === 'character' &&
          !isSystemVisual &&
          assetPromptForGen !== String(asset.prompt || '').trim()
        ) {
          patch(
            updateDirectorAsset(directorStateRef.current, asset.id, {
              prompt: assetPromptForGen,
            }),
          );
          if (domain) {
            const nextChars = (domain.bible.characters || []).map((c) =>
              c.character_id === asset.id
                ? {
                    ...c,
                    prompt: assetPromptForGen,
                    status: 'generating' as const,
                  }
                : c,
            );
            dataRef.current?.onUpdate?.({
              directorDomain: createEmptyDramaSession({
                ...domain,
                bible: { ...domain.bible, characters: nextChars },
              }),
            });
          }
        }
        const prompt = isSystemVisual
          ? buildDirectorSystemVisualImagePrompt({
              name: asset.name,
              prompt: String(asset.prompt || '').trim(),
              styleHint,
            })
          : kind === 'scene'
            ? buildDirectorSceneImagePrompt({
                name: asset.name,
                prompt: asset.prompt,
                styleHint,
                location: asset.location || asset.name,
                kind: asset.kind,
                spatial_structure: asset.spatial_structure,
                architecture: asset.architecture,
                materials: asset.materials,
                lighting: asset.lighting,
                time_default: asset.time_default,
                fixed_elements: asset.fixed_elements,
              })
            : kind === 'character' || kind === 'creature'
              ? buildDirectorCharacterImagePrompt({
                  name: asset.name,
                  prompt: assetPromptForGen,
                  styleHint,
                  subject: kind === 'creature' ? 'creature' : 'character',
                  gender:
                    kind === 'creature'
                      ? ''
                      : asset.gender ||
                        (/男主/.test(String(asset.name || ''))
                          ? 'male'
                          : /女主/.test(String(asset.name || ''))
                            ? 'female'
                            : ''),
                })
              : buildDirectorPropImagePrompt({
                  name: asset.name,
                  prompt: asset.prompt,
                  // 道具强制白底：不传题材 styleHint，避免复古西部等环境渗入背景
                });
        if (kind === 'scene') {
          const ensured = ensureDirectorSceneBuiltinPrompt(asset.prompt || asset.name || '');
          if (ensured !== String(asset.prompt || '').trim()) {
            patch(
              updateDirectorAsset(directorStateRef.current, asset.id, {
                prompt: ensured,
              }),
            );
          }
        }
        const styleRefRaw = resolveDirectorStyleReferenceImageUrl(
          latest.stylePresetId,
          latest.styleReferenceImageUrl,
        );
        // 现代场景禁用风格参考图：全片古风板/山水参考极易经 img2img 污染电竞房等当代空间
        const scenePeriod =
          kind === 'scene'
            ? inferDramaSceneSettingPeriod(
                asset.location || asset.name,
                asset.kind,
                (asset.fixed_elements || []).join('、'),
                asset.prompt,
                asset.spatial_structure,
                asset.architecture,
              )
            : 'neutral';
        const styleLooksAncient =
          dramaStyleHintLooksAncient(styleHint) ||
          dramaStyleHintLooksAncient(String(latest.stylePresetId || '')) ||
          dramaStyleHintLooksAncient(String(latest.globalStyle || ''));
        const skipSceneStyleRef =
          kind === 'scene' &&
          (scenePeriod === 'modern' || (scenePeriod === 'neutral' && styleLooksAncient));
        const styleRef =
          styleRefRaw && !skipSceneStyleRef
            ? await materializeStyleReferenceUrl(styleRefRaw)
            : '';
        // 人物换装图生图：新建造型时用该人物现有定妆图作为参考图，保持相貌
        let charRef = '';
        if (kind === 'character') {
          const owner = (domain?.bible.characters || []).find(
            (c) =>
              (c.costumes || []).some((cos) => cos.costume_id === asset.id) ||
              c.character_id === asset.id,
          );
          const masterUrl = owner ? resolveCharacterMasterReferenceUrl(owner) : '';
          if (masterUrl) charRef = await materializeStyleReferenceUrl(masterUrl);
        }
        const refImage = kind === 'scene' ? styleRef : charRef;
        const useRefImage = !!refImage;
        const assetModel = pickDirectorImageModel(
          latest.imageModel,
          useRefImage,
          useRefImage ? 1 : 0,
        );
        await window.electronAPI.invokeAI({
          modelId: 'image',
          nodeId: imageNodeId,
          input: {
            model: assetModel,
            prompt,
            response_format: 'url',
            aspect_ratio: directorAssetAspectRatio(kind),
            resolution: normalizeDirectorImageResolution(latest.imageResolution).toLowerCase(),
            projectId: data?.projectId || undefined,
            nodeTitle: `导演资产-${asset.name || asset.id}`,
            directorAssetId: asset.id,
            ...(useRefImage ? { image: refImage, inputImages: [refImage] } : {}),
          },
        });
      } catch (e) {
        applyDirectorImageError(
          nextAsset.id,
          e instanceof Error ? e.message : tt.generateFailed,
        );
      }
    },
    [
      applyDirectorImageError,
      data?.projectId,
      id,
      markImageGenProgress,
      materializeStyleReferenceUrl,
      patch,
      tt.generateFailed,
    ],
  );

  /** 并行泵：场景批量可同时多路；完成一路再补队列 */
  const runNextImageGen = useCallback(() => {
    while (
      imageGenInFlightRef.current.size < imageGenMaxParallelRef.current &&
      imageGenQueueRef.current.length > 0
    ) {
      const nextAsset = imageGenQueueRef.current[0];
      if (!nextAsset) break;
      imageGenQueueRef.current = imageGenQueueRef.current.slice(1);
      if (imageGenInFlightRef.current.has(nextAsset.id)) continue;
      imageGenInFlightRef.current.add(nextAsset.id);
      imageGenActiveRef.current = true;
      setBusyAction('images');
      void startOneAssetImageGen(nextAsset);
    }
    if (imageGenInFlightRef.current.size === 0 && imageGenQueueRef.current.length === 0) {
      imageGenActiveRef.current = false;
      imageGenMaxParallelRef.current = IMAGE_GEN_MAX_PARALLEL_DEFAULT;
      setBusyAction(null);
    }
  }, [startOneAssetImageGen]);

  useEffect(() => {
    runNextImageGenRef.current = runNextImageGen;
  }, [runNextImageGen]);

  // 重挂后若本地队列已空，清掉残留 generating，避免一直转圈
  useEffect(() => {
    const stuck = flattenDirectorAssets(directorStateRef.current.assets).filter(
      (a) => a.status === 'generating',
    );
    if (stuck.length === 0) return;
    // 下一帧再清：给进行中的 invoke 一点时间写入 currentId
    const t = window.setTimeout(() => {
      if (imageGenInFlightRef.current.size > 0 || imageGenQueueRef.current.length > 0) return;
      let next = directorStateRef.current;
      let changed = false;
      for (const a of stuck) {
        const live = findDirectorAssetById(next.assets, a.id);
        if (!live || live.asset.status !== 'generating') continue;
        changed = true;
        const ready = String(live.asset.imageUrl || '').trim();
        next = updateDirectorAsset(next, a.id, {
          status: ready ? 'ready' : 'pending',
          error: undefined,
        });
        syncDomainAssetImage(a.id, {
          ...(ready ? { imageUrl: ready } : {}),
          status: ready ? 'ready' : 'pending',
        });
        markImageGenProgress(a.id, false);
      }
      if (changed) patchRef.current(next);
    }, 800);
    return () => window.clearTimeout(t);
  }, [id, markImageGenProgress, syncDomainAssetImage]);

  // 分镜图残留 generating 清理（仅清「无队列、无 inFlight」的孤儿态；进行中绝不动，否则绿进度条会中途消失）
  useEffect(() => {
    const map = directorStateRef.current.storyboardsByShotNo || {};
    const stuckNos = Object.entries(map)
      .filter(([, v]) => v?.status === 'generating')
      .map(([k]) => k);
    if (stuckNos.length === 0) return;
    const t = window.setTimeout(() => {
      if (sbGenInFlightRef.current.size > 0 || sbGenQueueRef.current.length > 0) return;
      let next = directorStateRef.current;
      let changed = false;
      for (const shotNo of stuckNos) {
        const cur = next.storyboardsByShotNo?.[shotNo];
        if (!cur || cur.status !== 'generating') continue;
        // 双重确认：仍不在飞行中（避免误清）
        if (sbGenInFlightRef.current.has(shotNo)) continue;
        changed = true;
        next = updateDirectorShotStoryboard(next, shotNo, {
          status: String(cur.imageUrl || '').trim() ? 'ready' : 'pending',
          error: undefined,
        });
      }
      if (changed) patchRef.current(next);
    }, 800);
    return () => window.clearTimeout(t);
  }, [id]);

  // 按资产 / 分镜 nodeId 监听 SUCCESS/ERROR，组件重挂后仍能按后缀回写
  useEffect(() => {
    ensureDirectorSkillOptStatusListener();
    ensureDirectorShotAudioStatusListener();
    if (!window.electronAPI?.onAIStatusUpdate) return;
    const remove = window.electronAPI.onAIStatusUpdate((packet: {
      nodeId?: string;
      status?: string;
      payload?: {
        imageUrl?: string;
        originalImageUrl?: string;
        localPath?: string;
        url?: string;
        audioUrl?: string;
        error?: string;
        outputImages?: string[];
        text?: string;
        content?: string;
        result?: string;
      };
    }) => {
      const nodeId = String(packet?.nodeId || '');
      // Skill 优化由模块级 ensureDirectorSkillOptStatusListener 统一收 SUCCESS，避免本 effect 随 patch 重建漏事件
      if (parseDirectorSkillOptNodeId(nodeId, id)) return;
      const sbParsed = parseDirectorStoryboardPacketNodeId(nodeId, id);
      if (sbParsed) {
        const shotNo = sbParsed.shotNo;
        if (packet.status === 'SUCCESS') {
          const payload = packet.payload || {};
          const fromList =
            Array.isArray(payload.outputImages) && payload.outputImages.length > 0
              ? String(payload.outputImages[0] || '').trim()
              : '';
          const imageUrl = resolveDirectorImageUrl({
            imageUrl: payload.imageUrl || fromList || undefined,
            localPath: payload.localPath,
            url: payload.url,
          });
          if (imageUrl) {
            patch(
              updateDirectorShotStoryboard(directorStateRef.current, shotNo, {
                imageUrl,
                status: 'ready',
                error: undefined,
              }),
            );
            // 短剧 Domain 同步本镜分镜图，供出片参考槽使用
            const domain = (dataRef.current?.directorDomain as DramaDirectorSession | null) || null;
            if (domain?.shots?.length) {
              const nextDomain = createEmptyDramaSession({
                ...domain,
                shots: domain.shots.map((s) =>
                  String(s.shot_no || '').trim() === shotNo
                    ? {
                        ...s,
                        storyboard_image_url: imageUrl,
                        // 生成成功后默认勾上：出片参考用分镜图
                        use_storyboard_as_video_ref:
                          s.use_storyboard_as_video_ref === false ? false : true,
                      }
                    : s,
                ),
              });
              const cur = dataRef.current;
              if (cur) dataRef.current = { ...cur, directorDomain: nextDomain };
              dataRef.current?.onUpdate?.({ directorDomain: nextDomain });
            }
          } else {
            // 无图 SUCCESS 也要释放 inFlight，避免「重新生成」永久静默
            const cur = directorStateRef.current.storyboardsByShotNo?.[shotNo];
            patch(
              updateDirectorShotStoryboard(directorStateRef.current, shotNo, {
                status: String(cur?.imageUrl || '').trim() ? 'ready' : 'error',
                error: String(cur?.imageUrl || '').trim() ? undefined : tt.generateFailed,
              }),
            );
          }
          sbGenQueueRef.current = sbGenQueueRef.current.filter((n) => n !== shotNo);
          sbGenInFlightRef.current.delete(shotNo);
          void runNextSbGenRef.current?.();
          return;
        }
        if (packet.status === 'ERROR') {
          patch(
            updateDirectorShotStoryboard(directorStateRef.current, shotNo, {
              status: 'error',
              error: String(packet.payload?.error || tt.generateFailed),
            }),
          );
          sbGenQueueRef.current = sbGenQueueRef.current.filter((n) => n !== shotNo);
          sbGenInFlightRef.current.delete(shotNo);
          void runNextSbGenRef.current?.();
        }
        return;
      }

      const parsed = parseDirectorImagePacketNodeId(nodeId, id);
      if (parsed) {
        const assetId =
          'assetId' in parsed
            ? parsed.assetId
            : imageGenInFlightRef.current.values().next().value ||
              flattenDirectorAssets(directorStateRef.current.assets).find((a) => a.status === 'generating')
                ?.id ||
              null;
        if (!assetId) return;

        if (packet.status === 'SUCCESS') {
          const payload = packet.payload || {};
          const fromList =
            Array.isArray(payload.outputImages) && payload.outputImages.length > 0
              ? String(payload.outputImages[0] || '').trim()
              : '';
          applyDirectorImageSuccess(assetId, {
            imageUrl: payload.imageUrl || fromList || payload.originalImageUrl || undefined,
            localPath: payload.localPath,
            url: payload.url,
          });
          return;
        }
        if (packet.status === 'ERROR') {
          applyDirectorImageError(assetId, String(packet.payload?.error || tt.generateFailed));
        }
        return;
      }

      const voiceParsed = parseDirectorVoicePacketNodeId(nodeId, id);
      if (voiceParsed) {
        if (packet.status === 'SUCCESS') {
          const payload = packet.payload || {};
          let audioUrl = String(
            (payload as { audioUrl?: string }).audioUrl || payload.url || '',
          ).trim();
          const localPath = String(payload.localPath || '').trim();
          if (localPath) {
            let filePath = localPath.replace(/\\/g, '/');
            if (filePath.match(/^\/[a-zA-Z]:/)) filePath = filePath.substring(1);
            audioUrl = `local-resource://${filePath}`;
          }
          if (audioUrl) {
            syncDomainVoiceSample(voiceParsed.voiceId, {
              sampleUrl: audioUrl,
              model: DOUBAO_SEED_AUDIO_MODEL_ID,
              status: 'ready',
            });
          } else {
            syncDomainVoiceSample(voiceParsed.voiceId, {
              status: 'error',
              error: tt.generateFailed,
            });
          }
          return;
        }
        if (packet.status === 'ERROR') {
          const errMsg = String(packet.payload?.error || tt.generateFailed);
          syncDomainVoiceSample(voiceParsed.voiceId, {
            status: 'error',
            error: errMsg,
          });
          void showAlert(
            /超时|退回元宝/.test(errMsg)
              ? errMsg
              : locale === 'en'
                ? `Voice generation failed: ${errMsg}`
                : `声音生成失败：${errMsg}`,
          );
        }
        return;
      }

      const shotAudioParsed = parseDirectorShotAudioPacketNodeId(nodeId, id);
      if (shotAudioParsed) {
        // 模块级 listener 已 resolve waiter / 写入 stash；此处做兜底回写（漏 waiter 时仍能落盘）
        const domain = (dataRef.current?.directorDomain as DramaDirectorSession | null) || null;
        if (!domain?.shots?.length) return;
        if (packet.status === 'SUCCESS') {
          const audioUrl = extractAudioUrlFromAiPayload(packet.payload);
          if (audioUrl) {
            delete shotAudioStartedAtRef.current[shotAudioParsed.shotId];
            const next = createEmptyDramaSession({
              ...domain,
              shots: domain.shots.map((s) =>
                s.shot_id === shotAudioParsed.shotId
                  ? {
                      ...s,
                      audio_url: audioUrl,
                      audio_status: 'ready',
                      audio_error: '',
                    }
                  : s,
              ),
            });
            const cur = dataRef.current;
            if (cur) dataRef.current = { ...cur, directorDomain: next };
            dataRef.current?.onUpdate?.({ directorDomain: next });
          } else if (String(domain.shots.find((s) => s.shot_id === shotAudioParsed.shotId)?.audio_status || '') === 'generating') {
            delete shotAudioStartedAtRef.current[shotAudioParsed.shotId];
            const next = createEmptyDramaSession({
              ...domain,
              shots: domain.shots.map((s) =>
                s.shot_id === shotAudioParsed.shotId
                  ? {
                      ...s,
                      audio_status: 'error',
                      audio_error: tt.generateFailed,
                    }
                  : s,
              ),
            });
            const cur = dataRef.current;
            if (cur) dataRef.current = { ...cur, directorDomain: next };
            dataRef.current?.onUpdate?.({ directorDomain: next });
          }
          return;
        }
        if (packet.status === 'ERROR') {
          delete shotAudioStartedAtRef.current[shotAudioParsed.shotId];
          const next = createEmptyDramaSession({
            ...domain,
            shots: domain.shots.map((s) =>
              s.shot_id === shotAudioParsed.shotId
                ? {
                    ...s,
                    audio_status: 'error',
                    audio_error: String(packet.payload?.error || tt.generateFailed),
                  }
                : s,
            ),
          });
          const cur = dataRef.current;
          if (cur) dataRef.current = { ...cur, directorDomain: next };
          dataRef.current?.onUpdate?.({ directorDomain: next });
        }
      }
    });
    return () => {
      if (typeof remove === 'function') remove();
    };
  }, [
    applyDirectorImageError,
    applyDirectorImageSuccess,
    id,
    locale,
    patch,
    resolveDirectorImageUrl,
    showAlert,
    syncDomainVoiceSample,
    tt.generateFailed,
  ]);

  const startOneStoryboardGen = useCallback(
    async (shotNo: string) => {
      const failAndPump = (error: string) => {
        patch(
          updateDirectorShotStoryboard(directorStateRef.current, shotNo, {
            status: String(
              directorStateRef.current.storyboardsByShotNo?.[shotNo]?.imageUrl || '',
            ).trim()
              ? 'ready'
              : 'error',
            error,
          }),
        );
        sbGenInFlightRef.current.delete(shotNo);
        sbGenQueueRef.current = sbGenQueueRef.current.filter((n) => n !== shotNo);
        void runNextSbGenRef.current?.();
      };

      if (!window.electronAPI?.invokeAI) {
        failAndPump(tt.generateFailed);
        return;
      }

      const latest = directorStateRef.current;
      const domain = (dataRef.current?.directorDomain as DramaDirectorSession | null) || null;
      const dramaShot =
        isDramaMode && domain
          ? domain.shots.find((s) => String(s.shot_no || '').trim() === shotNo) || null
          : null;
      const shot =
        latest.shots.find((s, i) => String(s['镜号'] || i + 1) === shotNo) || null;
      const hasFinal = !!String(shot?.['最终提示词'] || '').trim();
      const hasDesc = !!String(shot?.['画面描述'] || '').trim();
      const hasDramaPrompt =
        !!String(dramaShot?.h3_skill_prompt || '').trim() ||
        !!String(dramaShot?.action || dramaShot?.purpose || '').trim();
      if (isDramaMode) {
        if (!dramaShot || !hasDramaPrompt) {
          sbGenInFlightRef.current.delete(shotNo);
          void runNextSbGenRef.current?.();
          return;
        }
      } else if (!shot || (!hasFinal && !hasDesc)) {
        sbGenInFlightRef.current.delete(shotNo);
        void runNextSbGenRef.current?.();
        return;
      }

      patch(
        updateDirectorShotStoryboard(latest, shotNo, {
          status: 'generating',
          error: undefined,
        }),
      );

      try {
        let prompt = '';
        let refImages: string[] = [];
        let sbAspect =
          coerceDirectorMvAspectRatio(latest.mvAspectRatio || latest.videoBatchAspectRatio) ||
          '16:9';

        if (isDramaMode && domain && dramaShot) {
          const sources = listDramaShotStoryboardSourceRefs(domain, dramaShot, 8);
          refImages = sources.map((s) => s.url).filter(Boolean);
          prompt = composeDramaShotStoryboardImagePrompt(domain, dramaShot, {
            locale,
          });
          const ar = String(domain.meta.aspect_ratio || '').trim();
          if (ar === '16:9' || ar === '9:16' || ar === '3:4' || ar === '4:3') {
            sbAspect = ar;
          }
          if (!prompt.trim()) {
            failAndPump(tt.generateFailed);
            return;
          }
        } else {
        const styleHint = resolveDirectorStylePrompt(latest.stylePresetId, latest.globalStyle);
        const orderedRefs = getOrderedAssetsWithImages(latest);
        const shotRowIndex = latest.shots.findIndex(
          (s, i) => String(s['镜号'] || i + 1) === shotNo,
        );
        const matchedIdx =
          latest.mode === 'mv' && shotRowIndex >= 0
            ? getShotBoundRefIndices(shot!, orderedRefs, shotRowIndex)
            : matchDirectorAssetIndicesForShot(shot!, orderedRefs, {
                leadAssetIds: listDirectorMvLeadAssetIds(latest),
              });
        const styleRefRaw = resolveDirectorStyleReferenceImageUrl(
          latest.stylePresetId,
          latest.styleReferenceImageUrl,
        );
        const styleRef = styleRefRaw ? await materializeStyleReferenceUrl(styleRefRaw) : '';
        const charUrls = matchedIdx
          .filter((i) => orderedRefs[i]?.kind === 'character')
          .map((i) => String(orderedRefs[i]?.imageUrl || '').trim())
          .filter(Boolean)
          .slice(0, 2);
        const sceneUrls = matchedIdx
          .filter((i) => orderedRefs[i]?.kind === 'scene')
          .map((i) => String(orderedRefs[i]?.imageUrl || '').trim())
          .filter(Boolean)
          .slice(0, 1);
        const sbCast = getDirectorShotStoryboard(latest, shotNo);
        const userLockedCast = Array.isArray(sbCast.castAssetIds);
        // 本镜角色只来自匹配/勾选；禁止再按「男主/主角」从全库抓第一个有图的人
        const forcedCharUrls = [...charUrls];
        const emptyCast = userLockedCast
          ? sbCast.castAssetIds!.length === 0
          : shotSuggestsNoCharacterRefs(shot!) || forcedCharUrls.length === 0;
        // 分镜参考图固定槽位（图生，每镜都带风格图；空槽省略）：
        // 1) 风格 — 只锁光色（画风固定真人写实）
        // 2) 场景 — 环境结构锁（只借构图空间，不得覆盖风格光色）
        // 3) 人物1 / 4) 人物2 — 身份/性别/外貌锁（最多 2 张）
        // 截断优先丢人物；永不丢风格图；空镜仅 风格→场景。
        const styleSlot = styleRef ? [styleRef] : [];
        const prioritizedRefs = emptyCast
          ? [...styleSlot, ...sceneUrls]
          : [...styleSlot, ...sceneUrls, ...forcedCharUrls];
        const maxSbRefs = 4;
        refImages = prioritizedRefs.slice(0, maxSbRefs);
        if (styleRef && !refImages.includes(styleRef)) {
          // 极端情况下仍保证风格图在列（挤掉末位非风格图）
          refImages = [styleRef, ...refImages.filter((u) => u !== styleRef)].slice(0, maxSbRefs);
        }
        const monoStyle = directorStyleLooksMonochrome(styleHint);
        const storyboardBody = composeDirectorShotStoryboardPrompt(shot!, styleHint, {
          hasStyleReferenceImage: !!styleRef,
          closeUpFraming: latest.mvCloseUpFraming !== false,
          stylePresetId: latest.stylePresetId,
          stylePictureIndex: styleRef ? 1 : undefined,
        });
        if (!storyboardBody) {
          failAndPump(tt.generateFailed);
          return;
        }
        const refOrderLines: string[] = [];
        let refNo = 1;
        if (styleRef) {
          refOrderLines.push(
            `参考图${refNo}：风格图（只锁光色/色调；画风固定真人写实摄影；禁止照抄其中人物身份与性别）`,
          );
          refNo += 1;
        }
        if (sceneUrls[0] && refImages.includes(sceneUrls[0])) {
          refOrderLines.push(
            emptyCast
              ? `参考图${refNo}：场景（环境结构锁，须为空场景；光色仍跟风格图）`
              : `参考图${refNo}：场景（环境结构锁；光色仍跟风格图，禁止用场景彩光覆盖风格光色）`,
          );
          refNo += 1;
        }
        if (!emptyCast) {
          forcedCharUrls.forEach((url, i) => {
            if (!refImages.includes(url)) return;
            const ref = orderedRefs.find((r) => String(r?.imageUrl || '').trim() === url);
            const name = String(ref?.name || '').trim() || `人物${i + 1}`;
            refOrderLines.push(
              `参考图${refNo}：人物${i + 1}「${name}」（身份锁·性别与外貌以本图为准；对应主体身份）`,
            );
            refNo += 1;
          });
        }
        prompt = [
          storyboardBody,
          refOrderLines.length
            ? `参考图顺序（必须遵守）：\n${refOrderLines.join('\n')}`
            : '无参考图时仅按文字公式生成。',
          emptyCast
            ? `本镜空镜/无人物：画面中禁止出现任何人、人脸、背影、剪影人形；只画环境。第1张风格图只锁光色；画风固定真人写实摄影；场景图只借空间结构；即使风格图里有人也绝不能画进本镜。`
            : `第1张风格图只锁光色；画风固定真人写实摄影。主体身份与性别必须跟人物参考图（禁止把风格图里的人物当成主角）；场景图只提供环境结构，不得覆盖风格图光色。`,
          monoStyle ? DIRECTOR_MONOCHROME_STYLE_LOCK_GUARD : '',
          'Strictly no text in the image: no subtitles, lyrics, captions, watermarks, logos, or letters/numbers.',
        ]
          .filter(Boolean)
          .join('\n\n');
        }

        const imageNodeId = directorStoryboardImageNodeId(id, shotNo);
        const sbModel = pickDirectorImageModel(
          latest.imageModel,
          refImages.length > 0,
          refImages.length,
        );
        const sbResRaw = normalizeDirectorImageResolution(latest.imageResolution);
        // 分镜图不走 4K
        const sbRes = sbResRaw === '4K' ? '2K' : sbResRaw;
        await window.electronAPI.invokeAI({
          modelId: 'image',
          nodeId: imageNodeId,
          input: {
            model: sbModel,
            prompt,
            response_format: 'url',
            aspect_ratio: sbAspect,
            resolution: sbRes.toLowerCase(),
            projectId: data?.projectId || undefined,
            nodeTitle: `导演分镜-镜${shotNo}`,
            directorShotNo: shotNo,
            ...(refImages.length ? { image: refImages, inputImages: refImages } : {}),
          },
        });
        // 成功提交后保持 inFlight，等待 SUCCESS/ERROR 回写后再泵下一镜
      } catch (e) {
        failAndPump(e instanceof Error ? e.message : tt.generateFailed);
      }
    },
    [
      data?.projectId,
      getShotBoundRefIndices,
      id,
      isDramaMode,
      locale,
      materializeStyleReferenceUrl,
      patch,
      tt.generateFailed,
    ],
  );

  /** 并行泵：可同时跑多镜，点一行后仍可继续点其它行入队 */
  const runNextStoryboardGen = useCallback(() => {
    while (
      sbGenInFlightRef.current.size < SB_GEN_MAX_PARALLEL &&
      sbGenQueueRef.current.length > 0
    ) {
      const nextShotNo = sbGenQueueRef.current[0];
      if (!nextShotNo) break;
      sbGenQueueRef.current = sbGenQueueRef.current.slice(1);
      if (sbGenInFlightRef.current.has(nextShotNo)) continue;
      sbGenInFlightRef.current.add(nextShotNo);
      setBusyAction('storyboards');
      void startOneStoryboardGen(nextShotNo);
    }
    if (sbGenInFlightRef.current.size === 0 && sbGenQueueRef.current.length === 0) {
      if (imageGenInFlightRef.current.size === 0) {
        setBusyAction((prev) => (prev === 'storyboards' ? null : prev));
      }
    }
  }, [startOneStoryboardGen]);

  useEffect(() => {
    runNextSbGenRef.current = runNextStoryboardGen;
  }, [runNextStoryboardGen]);

  const enqueueStoryboardShots = useCallback(
    (shotNos: string[], opts?: { onlyMissing?: boolean }) => {
      if (imageGenYuanbao(1) == null) {
        void showAlert(tt.otsPriceRequired);
        return;
      }
      const onlyMissing = opts?.onlyMissing !== false;
      const latest = directorStateRef.current;
      const valid: string[] = [];
      let blockedGenerating = 0;
      for (const raw of shotNos) {
        const shotNo = String(raw || '').trim();
        if (!shotNo) continue;
        const shot = latest.shots.find(
          (s, i) => String(s['镜号'] || i + 1).trim() === shotNo,
        );
        const canStoryboard = isDramaMode
          ? (() => {
              const domain =
                (dataRef.current?.directorDomain as DramaDirectorSession | null) || null;
              const ds = domain?.shots?.find((s) => String(s.shot_no || '').trim() === shotNo);
              return (
                !!String(ds?.h3_skill_prompt || '').trim() ||
                !!String(ds?.action || ds?.purpose || '').trim()
              );
            })()
          : !!String(shot?.['最终提示词'] || '').trim() ||
            !!String(shot?.['画面描述'] || '').trim();
        if (!shot && !isDramaMode) continue;
        if (!canStoryboard) continue;
        if (onlyMissing) {
          const pipeUrl = String(latest.storyboardsByShotNo?.[shotNo]?.imageUrl || '').trim();
          const domainUrl = isDramaMode
            ? String(
                (
                  (dataRef.current?.directorDomain as DramaDirectorSession | null)?.shots || []
                ).find((s) => String(s.shot_no || '').trim() === shotNo)?.storyboard_image_url ||
                  '',
              ).trim()
            : '';
          if (pipeUrl || domainUrl) continue;
        }
        // 用户点「重新生成」：强制清掉卡死的 generating / inFlight，允许立刻重跑
        if (!onlyMissing) {
          sbGenInFlightRef.current.delete(shotNo);
          sbGenQueueRef.current = sbGenQueueRef.current.filter((n) => n !== shotNo);
          valid.push(shotNo);
          continue;
        }
        if (
          sbGenInFlightRef.current.has(shotNo) ||
          latest.storyboardsByShotNo?.[shotNo]?.status === 'generating'
        ) {
          blockedGenerating += 1;
          continue;
        }
        valid.push(shotNo);
      }
      if (valid.length === 0) {
        if (!onlyMissing && shotNos.length > 0) {
          void showAlert(tt.pendingPrompt);
        }
        if (blockedGenerating > 0) void runNextStoryboardGen();
        return;
      }
      if (!onlyMissing) {
        // 强制重跑：释放本镜占用；若并行位已被僵尸占满则整表清空，否则永远泵不动
        if (sbGenInFlightRef.current.size >= SB_GEN_MAX_PARALLEL) {
          sbGenInFlightRef.current.clear();
        }
        let next = directorStateRef.current;
        let changed = false;
        const resetNos =
          sbGenInFlightRef.current.size === 0
            ? Object.entries(next.storyboardsByShotNo || {})
                .filter(([, v]) => v?.status === 'generating')
                .map(([k]) => k)
            : valid.filter((no) => next.storyboardsByShotNo?.[no]?.status === 'generating');
        for (const shotNo of new Set([...valid, ...resetNos])) {
          const sb = next.storyboardsByShotNo?.[shotNo];
          if (sb?.status === 'generating') {
            changed = true;
            next = updateDirectorShotStoryboard(next, shotNo, {
              status: String(sb.imageUrl || '').trim() ? 'ready' : 'pending',
              error: undefined,
            });
          }
        }
        if (changed) patch(next);
      }
      const existing = new Set(sbGenQueueRef.current);
      const toAdd = valid.filter((n) => !existing.has(n));
      if (toAdd.length === 0) {
        void runNextStoryboardGen();
        return;
      }
      sbGenQueueRef.current = [...sbGenQueueRef.current, ...toAdd];
      void runNextStoryboardGen();
    },
    [imageGenYuanbao, patch, runNextStoryboardGen, showAlert, tt.otsPriceRequired, tt.pendingPrompt],
  );

  const startBatchStoryboards = useCallback(() => {
    const latest = directorStateRef.current;
    const nos = (latest.shots || [])
      .map((s, i) => ({
        no: String(s['镜号'] || i + 1),
        ok:
          !!String(s['最终提示词'] || '').trim() || !!String(s['画面描述'] || '').trim(),
      }))
      .filter((x) => x.ok)
      .map((x) => x.no);
    enqueueStoryboardShots(nos, { onlyMissing: true });
  }, [enqueueStoryboardShots]);

  const handleSpawnVideosClick = useCallback(
    async (shotNos?: string[]) => {
      if (busyAction === 'videos') return;
      flushFinalPromptDraft();
      const latestGate = directorStateRef.current;
      // 批量：默认只补失败/缺失/生成中；单镜传入 shotNos 则强制重跑该镜
      let only: Set<string> | null =
        Array.isArray(shotNos) && shotNos.length > 0
          ? new Set(shotNos.map((n) => String(n || '').trim()).filter(Boolean))
          : null;
      if (!only) {
        const needs: string[] = [];
        let readyWithVideo = 0;
        const assetReady =
          flattenDirectorAssets(latestGate.assets).some((a) => String(a.imageUrl || '').trim()) ||
          !!String(latestGate.styleReferenceImageUrl || '').trim();
        for (let i = 0; i < (latestGate.shots || []).length; i++) {
          const shot = latestGate.shots[i];
          const shotNo = String(shot['镜号'] || i + 1).trim() || String(i + 1);
          const sb = getDirectorShotStoryboard(latestGate, shotNo);
          const hasSb = !!String(sb?.imageUrl || '').trim();
          // 短剧：无分镜也可用风格/资产图推 H3
          if (!hasSb && !(isDramaMode && assetReady)) continue;
          if (!String(shot['最终提示词'] || shot['画面描述'] || '').trim()) continue;
          if (directorShotNeedsVideoGeneration(sb)) needs.push(shotNo);
          else readyWithVideo += 1;
        }
        if (needs.length === 0) {
          if (readyWithVideo > 0) {
            await showAlert(tt.batchSpawnVideosAllReady);
          } else {
            patch({
              ...latestGate,
              error: isDramaMode
                ? '请先准备资产参考图（风格/角色/场景/道具/生物）或分镜图'
                : tt.needStoryboardsFirst,
            });
          }
          return;
        }
        only = new Set(needs);
      }
      // 无 OTS 价禁止生成（禁止本地价）
      {
        for (let i = 0; i < (latestGate.shots || []).length; i++) {
          const shot = latestGate.shots[i];
          const shotNo = String(shot['镜号'] || i + 1).trim() || String(i + 1);
          if (only && !only.has(shotNo)) continue;
          const sb = getDirectorShotStoryboard(latestGate, shotNo);
          if (!String(sb?.imageUrl || '').trim()) continue;
          const range = computeDirectorShotMusicRangesFromState(latestGate)[i] || {
            durationSec: parseDirectorShotDurationSec(shot['时长'], 5),
          };
          const lipsyncOn = resolveMvShotLipsync(
            shot,
            i,
            sb,
            range as { startSec: number; endSec: number; durationSec: number },
          ).lipsyncOn;
          const priced = videoGenYuanbaoForShot({
            preferLipsync: lipsyncOn,
            durationSec: Number(range.durationSec) || 5,
          });
          if (!priced) {
            await showAlert(tt.otsPriceRequired);
            return;
          }
        }
      }
      setBusyAction('videos');
      const spawnTargetNos = [...only];
      const genStartedAt = Date.now();
      {
        let nextGen = directorStateRef.current;
        for (const no of spawnTargetNos) {
          markVideoGenProgress(no, true);
          nextGen = updateDirectorShotStoryboard(nextGen, no, {
            videoStatus: 'generating',
            videoError: '',
            videoGeneratingStartedAt: genStartedAt,
          });
        }
        patch(nextGen);
      }
      const revertSpawnGenerating = () => {
        let nextRev = directorStateRef.current;
        for (const no of spawnTargetNos) {
          markVideoGenProgress(no, false);
          const sbNow = getDirectorShotStoryboard(nextRev, no);
          if (sbNow.videoStatus !== 'generating') continue;
          nextRev = updateDirectorShotStoryboard(nextRev, no, {
            videoStatus: String(sbNow.videoUrl || '').trim() ? 'ready' : 'pending',
            videoError: String(sbNow.videoError || ''),
            videoGeneratingStartedAt: undefined,
          });
        }
        patch(nextRev);
      };
      try {
      const latest = directorStateRef.current;
      const shots = (latest.shots || []).filter((s, i) => {
        if (!only) return true;
        return only.has(String(s['镜号'] || i + 1));
      });
      const prog = countDirectorStoryboards(shots, latest.storyboardsByShotNo);
      const dramaAssetReady =
        isDramaMode &&
        (flattenDirectorAssets(latest.assets).some((a) => String(a.imageUrl || '').trim()) ||
          !!String(latest.styleReferenceImageUrl || '').trim());
      if (prog.ready === 0 && !dramaAssetReady) {
        revertSpawnGenerating();
        patch({ ...directorStateRef.current, error: tt.needStoryboardsFirst });
        return;
      }
      // 对口型：生成前先确认「分镜图 + 歌曲片段 + 提示词」，确认后才创建并开跑
      const mvMusicUrl = String(latest.mvMusic?.url || '').trim();
      const segs = latest.mvMusic?.lyricSegments || [];
      const packs =
        segs.length > 0
          ? packLyricSegmentsIntoShotPacks(segs, {
              clipLengthMode: latest.mvMusic?.clipLengthMode,
            })
          : [];
      const songDur = Number(latest.mvMusic?.durationSec) || 0;
      const ranges = computeDirectorShotMusicRangesFromState(latest);
      const projectIdForTrim = String(data?.projectId || '').trim() || undefined;
      const lipsyncLines: string[] = [];
      const lipsyncShotNos: string[] = [];
      let lipsyncBlocked = 0;

      for (let i = 0; i < (latest.shots || []).length; i++) {
        const shot = latest.shots[i];
        const shotNo = String(shot['镜号'] || i + 1).trim() || String(i + 1);
        if (only && !only.has(shotNo)) continue;
        const sb = getDirectorShotStoryboard(latest, shotNo);
        const sbUrl = String(sb?.imageUrl || '').trim();
        if (!sbUrl) continue;
        const promptOk = !!String(shot['最终提示词'] || shot['画面描述'] || '').trim();
        if (!promptOk) continue;
        const range = ranges[i] || {
          startSec: 0,
          endSec: parseDirectorShotDurationSec(shot['时长'], 5),
          durationSec: parseDirectorShotDurationSec(shot['时长'], 5),
        };
        const startSec = Math.max(0, Number(range.startSec) || 0);
        let endSec = Number(range.endSec);
        if (!Number.isFinite(endSec) || endSec <= startSec + 0.05) {
          endSec = startSec + Math.max(0.5, Number(range.durationSec) || 5);
        }
        if (songDur > 0.5) {
          if (startSec >= songDur - 0.05) continue;
          endSec = Math.min(endSec, songDur);
        }
        const hasVoice = shotAudioRangeHasHumanVoice(segs, startSec, endSec);
        const preferLipsync = resolveDirectorMvForceLipsyncOn(
          isMvMode,
          resolveDirectorShotPreferLipsync(shot, sb, {
            hasHumanVoice: hasVoice,
            packText: packs[i]?.text || String(shot['对白旁白'] || ''),
            audioStartSec: startSec,
            songDurationSec: songDur,
            closeUpFramingOn: directorStateRef.current.mvCloseUpFraming !== false,
          }),
        );
        if (!(DIRECTOR_MV_FORCE_H3_LIPSYNC && isMvMode) && !preferLipsync) continue;

        let clipUrl = getValidDirectorShotSongClipUrl(sb, mvMusicUrl, startSec, endSec);
        if (!clipUrl && mvMusicUrl && window.electronAPI?.trimAudio) {
          try {
            const trimmed = await window.electronAPI.trimAudio(
              projectIdForTrim,
              mvMusicUrl,
              startSec,
              endSec,
            );
            clipUrl = String(trimmed?.audioUrl || '').trim();
            if (clipUrl) {
              patch(
                updateDirectorShotStoryboard(directorStateRef.current, shotNo, {
                  songClipUrl: clipUrl,
                  songClipSourceUrl: mvMusicUrl,
                  songClipStartSec: startSec,
                  songClipEndSec: endSec,
                }),
              );
            }
          } catch (err) {
            console.warn(`[Director] 镜${shotNo} 确认前裁剪歌曲片段失败:`, err);
          }
        }

        const clipOk = !!clipUrl;
        const rangeLabel = `${formatShotAudioClock(startSec)}–${formatShotAudioClock(endSec)}`;
        const line = fillDirectorI18n(tt.confirmLipsyncShotLine, {
          no: shotNo,
          sb: sbUrl ? '✓' : '✗',
          clip: clipOk ? `✓ ${rangeLabel}` : '✗',
          prompt: promptOk ? '✓' : '✗',
        });
        lipsyncLines.push(line);
        if (!sbUrl || !clipOk || !promptOk) {
          lipsyncBlocked += 1;
        } else {
          lipsyncShotNos.push(shotNo);
        }
      }

      let startLipsync = false;
      if (lipsyncLines.length > 0) {
        if (lipsyncBlocked > 0 && lipsyncShotNos.length === 0) {
          revertSpawnGenerating();
          await showAlert(
            `${tt.confirmLipsyncMissingTitle}\n\n${lipsyncLines.slice(0, 12).join('\n')}${
              lipsyncLines.length > 12 ? '\n…' : ''
            }`,
          );
          return;
        }
        // 材料齐全则直接开跑，不再弹确认窗；勿把 preferLipsync 写死为 true（逐镜开关管提示词）
        startLipsync = true;
      }

      const spawnNos = only ? [...only] : [];
      let shotPromptOverrides: Record<string, string> | undefined;
      if (isMvMode && spawnNos.length > 0) {
        const latestForPrompt = directorStateRef.current;
        const overrides: Record<string, string> = {};
        for (let i = 0; i < (latestForPrompt.shots || []).length; i++) {
          const shot = latestForPrompt.shots[i];
          const shotNo = String(shot['镜号'] || i + 1).trim() || String(i + 1);
          if (!spawnNos.includes(shotNo)) continue;
          const versions = getDirectorShotPromptVersions(
            shot,
            getDirectorShotStoryboard(latestForPrompt, shotNo),
          );
          if (versions.useOptimized && versions.optimized) {
            const orderedRefs = getOrderedAssetsWithImages(latestForPrompt);
            const boundIdx = getShotBoundRefIndices(shot, orderedRefs, i);
            const boundChars = boundIdx
              .map((idx) => orderedRefs[idx])
              .filter(
                (a): a is (typeof orderedRefs)[number] =>
                  !!a && a.kind === 'character' && !!String(a.imageUrl || '').trim(),
              );
            const sbUrl = String(
              getDirectorShotStoryboard(latestForPrompt, shotNo)?.imageUrl || '',
            ).trim();
            const sourceHint = [shot['地点'], shot['画面描述']]
              .map((v) => String(v || '').trim())
              .filter((v) => v && v !== '—')
              .join('\n');
            overrides[shotNo] = repairDirectorMvPromptImageMap(
              versions.optimized,
              buildDirectorShotRefItems({
                storyboardUrl: sbUrl || undefined,
                boundAssets: boundChars,
              }),
              sourceHint,
            );
          }
        }
        if (Object.keys(overrides).length > 0) shotPromptOverrides = overrides;
      }

      data?.onSpawnVideos?.(
        spawnNos.length
          ? {
              shotNos: spawnNos,
              startLipsync,
              ...(startLipsync && lipsyncShotNos.length
                ? { lipsyncShotNos: [...lipsyncShotNos] }
                : {}),
              ...(shotPromptOverrides ? { shotPromptOverrides } : {}),
            }
          : startLipsync
            ? {
                startLipsync: true,
                ...(lipsyncShotNos.length ? { lipsyncShotNos: [...lipsyncShotNos] } : {}),
                ...(shotPromptOverrides ? { shotPromptOverrides } : {}),
              }
            : undefined,
      );
      } finally {
        setVideoSkillRewriteHint(null);
        setBusyAction((prev) => (prev === 'videos' ? null : prev));
      }
    },
    [busyAction, data, flushFinalPromptDraft, isDramaMode, isMvMode, markVideoGenProgress, patch, resolveMvShotLipsync, showAlert, tt, videoGenYuanbaoForShot],
  );

  const chatResolverRef = useRef<DirectorChatWaiter | null>(null);
  const chatGenRef = useRef(0);
  const chatTailRef = useRef(Promise.resolve());
  const mountedRef = useRef(true);
  const directorChatClientTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (directorChatClientTimerRef.current) {
        clearTimeout(directorChatClientTimerRef.current);
        directorChatClientTimerRef.current = null;
      }
    };
  }, []);
  const applyMvStoryOutlineFromChat = useCallback(
    (raw: string): boolean => {
      const normalized = normalizeDirectorMvStoryOutlineResult(raw);
      if (!normalized.ok) return false;
      const storyFixed = applyDirectorMvStoryPrefsToOutline(normalized.story, {
        genreType: String(directorStateRef.current.mvStoryGenreType || ''),
        toneStyle: String(directorStateRef.current.mvStoryToneStyle || ''),
        endingType: String(directorStateRef.current.mvStoryEndingType || ''),
      });
      if (!String(storyFixed || '').trim()) return false;
      setStoryOutlineLocal(storyFixed);
      setStoryOutlineEditing(false);
      const next = patchDirectorMvScriptInput(directorStateRef.current, {
        mvStoryOutline: storyFixed,
        mvStoryOutlineConfirmed: true,
      });
      patch({ ...next, isGenerating: false, error: '' });
      return true;
    },
    [patch],
  );
  const applyMvStoryOutlineFromChatRef = useRef(applyMvStoryOutlineFromChat);
  applyMvStoryOutlineFromChatRef.current = applyMvStoryOutlineFromChat;

  const { execute: executeChat2 } = useAI({
    nodeId: `${id}-director-phase-chat`,
    modelId: 'chat',
    onComplete: (payload) => {
      const text = coerceAssistantText(payload?.text ?? payload?.content ?? payload?.result ?? '');
      const reqId = String((payload as { directorChatRequestId?: string } | null)?.directorChatRequestId || '');
      const finishReason = String(
        (payload as { finishReason?: string } | null)?.finishReason || '',
      ).toLowerCase();
      const chatNodeId = directorPhaseChatKey(id);
      if (text) stashDirectorChatText(chatNodeId, reqId, text);
      const waiter = directorChatWaiters.get(chatNodeId) || chatResolverRef.current;
      if (waiter) {
        if (reqId && reqId !== waiter.requestId) return;
        if (!reqId && waiter.gen !== chatGenRef.current) return;
        directorChatWaiters.delete(chatNodeId);
        chatResolverRef.current = null;
        if (payload?.error && !text) {
          waiter.reject(new Error(String(payload.error)));
          return;
        }
        // 截断但仍有正文：交给下游解析/补全；空正文则明确报错
        if (finishReason === 'length' && !text) {
          waiter.reject(new Error('模型输出被截断且内容为空，请换模型或缩短本集后重试'));
          return;
        }
        waiter.resolve(text);
        return;
      }
      // 迟到的旧请求：禁止把上一版故事盖到当前框
      const latestReqId = `director-chat-${id}-${chatGenRef.current}`;
      if (reqId && reqId !== latestReqId) return;
      if (!reqId) return;
      // 实例已重挂、没人在 await：仅当前请求的故事大纲才写回
      if (text && looksLikeMvStoryOutlineText(text)) {
        applyMvStoryOutlineFromChatRef.current(text);
      }
    },
    onError: (msg) => {
      const chatNodeId = directorPhaseChatKey(id);
      const waiter = directorChatWaiters.get(chatNodeId) || chatResolverRef.current;
      if (!waiter) return;
      directorChatWaiters.delete(chatNodeId);
      chatResolverRef.current = null;
      waiter.reject(new Error(msg || tt.generateFailed));
    },
  });

  const runChat = useCallback(
    async (
      systemPrompt: string,
      userPrompt: string,
      opts?: {
        max_tokens?: number;
        response_format?: unknown;
        temperature?: number;
        model?: string;
        /** 多路并行（提示词优化等）；默认串行且会取消上一路 */
        concurrent?: boolean;
        /** 走提示词优化专用队列（同时最多 2 路，其余等待中） */
        skillOptimize?: boolean;
        /** 客户端限流：排队/开跑时回调 */
        onQueueStatus?: (status: DirectorConcurrentChatQueueStatus) => void;
        /** 取消排队（等待中移除；已发出的请求不撤回） */
        signal?: AbortSignal | null;
      },
    ) => {
      const raw = String(
        opts?.model || directorStateRef.current.chatModel || state.chatModel || '',
      ).trim();
      const model = (DIRECTOR_CHAT_MODELS as readonly string[]).includes(raw)
        ? raw
        : DIRECTOR_CHAT_MODEL_DEFAULT;
      const concurrent = !!opts?.concurrent;
      const useSkillQueue = !!opts?.skillOptimize;

      // 并行通道：独立 nodeId + 客户端限流
      if (concurrent) {
        const enqueue = useSkillQueue ? enqueueDirectorSkillOptimizeChat : enqueueDirectorConcurrentChat;
        const { promise } = enqueue({
          onStatus: opts?.onQueueStatus,
          signal: opts?.signal,
          run: () => {
            ensureDirectorSkillOptStatusListener();
            const requestId = `director-chat-conc-${id}-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 9)}`;
            const optNodeId = directorSkillOptNodeId(id, requestId);
            const timeoutMs = 120_000;
            return new Promise<string>((resolve, reject) => {
              let settled = false;
              const settleResolve = (text: string) => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timer);
                resolve(text);
              };
              const settleReject = (err: Error) => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timer);
                reject(err);
              };
              const timer = window.setTimeout(() => {
                directorSkillOptWaiters.delete(optNodeId);
                const err = new Error('timeout');
                err.name = 'TimeoutError';
                settleReject(err);
              }, timeoutMs);
              const early = takeDirectorSkillOptStash(optNodeId);
              if (early) {
                settleResolve(early);
                return;
              }
              directorSkillOptWaiters.set(optNodeId, {
                directorId: id,
                resolve: settleResolve,
                reject: settleReject,
              });
              const raced = takeDirectorSkillOptStash(optNodeId);
              if (raced) {
                directorSkillOptWaiters.delete(optNodeId);
                settleResolve(raced);
                return;
              }
              if (!window.electronAPI?.invokeAI) {
                directorSkillOptWaiters.delete(optNodeId);
                settleReject(new Error(tt.generateFailed));
                return;
              }
              void window.electronAPI
                .invokeAI({
                  modelId: 'chat',
                  nodeId: optNodeId,
                  input: {
                    model,
                    messages: [
                      { role: 'system', content: systemPrompt },
                      { role: 'user', content: userPrompt },
                    ],
                    stream: false,
                    projectId: data?.projectId || undefined,
                    nodeTitle: isDramaMode ? 'AI短剧·提示词优化' : 'MV导演·对话',
                    directorChatRequestId: requestId,
                    ...(opts?.max_tokens != null ? { max_tokens: opts.max_tokens } : {}),
                    ...(opts?.response_format != null
                      ? { response_format: opts.response_format }
                      : {}),
                    ...(opts?.temperature != null ? { temperature: opts.temperature } : {}),
                  },
                })
                .then(() => {
                  const late = takeDirectorSkillOptStash(optNodeId);
                  if (late) {
                    directorSkillOptWaiters.delete(optNodeId);
                    settleResolve(late);
                  }
                })
                .catch((e: unknown) => {
                  if (!directorSkillOptWaiters.has(optNodeId)) return;
                  directorSkillOptWaiters.delete(optNodeId);
                  settleReject(e instanceof Error ? e : new Error(String(e || tt.generateFailed)));
                });
            });
          },
        });
        return promise;
      }

      const gen = ++chatGenRef.current;
      const requestId = `director-chat-${id}-${gen}`;
      const chatNodeId = directorPhaseChatKey(id);
      const prev = directorChatWaiters.get(chatNodeId) || chatResolverRef.current;
      if (prev) {
        directorChatWaiters.delete(chatNodeId);
        chatResolverRef.current = null;
        const err = new Error('cancelled');
        err.name = 'AbortError';
        try {
          prev.reject(err);
        } catch {
          /* ignore */
        }
      }

      const result = new Promise<string>((resolve, reject) => {
        const waiter: DirectorChatWaiter = { resolve, reject, gen, requestId };
        chatResolverRef.current = waiter;
        directorChatWaiters.set(chatNodeId, waiter);
      });

      const job = (async () => {
        await chatTailRef.current.catch(() => undefined);
        if (chatGenRef.current !== gen) return;
        await executeChat2({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          stream: false,
          projectId: data?.projectId || undefined,
          nodeTitle: isDramaMode ? 'AI短剧导演·分析本集' : 'MV导演',
          directorChatRequestId: requestId,
          ...(opts?.max_tokens != null ? { max_tokens: opts.max_tokens } : {}),
          ...(opts?.response_format != null ? { response_format: opts.response_format } : {}),
          ...(opts?.temperature != null ? { temperature: opts.temperature } : {}),
        });
      })();

      chatTailRef.current = job.then(
        () => undefined,
        () => undefined,
      );

      return result;
    },
    [data?.projectId, executeChat2, id, isDramaMode, state.chatModel, tt.generateFailed],
  );

  const handleAiReviseFinalPrompt = useCallback(
    async (rowIndex: number) => {
      if (busyAction || state.isGenerating || data?.isGenerating) return;
      const cur = directorStateRef.current;
      const shot = cur.shots[rowIndex];
      if (!shot) return;
      const currentPrompt = String(finalPromptDraft || resolveShotFinalPrompt(shot) || '').trim();
      const opinion = String(finalPromptOpinion || '').trim();
      if (!opinion) {
        showAlert(tt.aiReviseFinalPromptNeedOpinion);
        return;
      }
      if (!currentPrompt) {
        showAlert(tt.aiReviseFinalPromptNeedPrompt);
        return;
      }

      const shotNo = String(shot['镜号'] || rowIndex + 1);
      const sb = getDirectorShotStoryboard(cur, shotNo);
      const ranges = computeDirectorShotMusicRangesFromState(cur);
      const audioRange = ranges[rowIndex] || {
        startSec: 0,
        endSec: parseDirectorShotDurationSec(shot['时长'], 5),
        durationSec: parseDirectorShotDurationSec(shot['时长'], 5),
      };
      const lipsyncEval = resolveMvShotLipsync(shot, rowIndex, sb, audioRange);
      const styleSummary = resolveDirectorStylePrompt(cur.stylePresetId, cur.globalStyle);
      const angleParts = [String(shot['镜头角度'] || '').trim(), String(shot['焦距'] || '').trim()]
        .filter(Boolean)
        .join(' / ');
      const durationLabel =
        Number(audioRange.durationSec) > 0
          ? `${Math.round(Number(audioRange.durationSec))}s`
          : String(shot['时长'] || '').trim();

      const { systemPrompt, userPrompt } = buildDirectorReviseFinalPromptMessages({
        currentPrompt,
        opinion,
        shotNo,
        duration: durationLabel,
        angle: angleParts || String(shot['景别'] || '').trim(),
        cameraMove: String(shot['运镜'] || '').trim(),
        dialogue: String(shot['对白旁白'] || '').trim(),
        lipsyncOn: !!lipsyncEval.lipsyncOn,
        styleSummary,
      });

      const chatModel = String(cur.chatModel || '').trim();
      const isTerra = chatModel === LLM_CHAT_MODEL_GPT56_TERRA;
      clearFinalPromptPersistTimer();
      setBusyAction('revise-final-prompt');
      try {
        const text = await runChat(systemPrompt, userPrompt, {
          max_tokens: isTerra ? 16384 : 8192,
          temperature: 0.5,
        });
        const next = parseDirectorRevisedFinalPrompt(text);
        if (!next) {
          throw new Error(tt.aiReviseFinalPromptEmpty);
        }
        clearFinalPromptPersistTimer();
        finalPromptDraftRef.current = next;
        const shotNoKey = String(shot['镜号'] || rowIndex + 1).trim() || String(rowIndex + 1);
        let nextState = updateDirectorShotCell(directorStateRef.current, rowIndex, '最终提示词', next);
        // AI 改的是最终提示词：同步为新原版，并清空旧优化稿，避免继续用过期优化结果
        nextState = updateDirectorShotStoryboard(nextState, shotNoKey, {
          promptOriginal: next,
          promptOptimized: '',
          useOptimizedPrompt: false,
        });
        patch({ ...nextState, error: '' });
        setFinalPromptDraft(next);
        setFinalPromptOpinion('');
        setPromptPreviewTab('original');
      } catch (e) {
        const rawMsg = e instanceof Error ? e.message : String(e || '');
        const msg = rawMsg || tt.aiReviseFinalPromptFailed;
        patch({ ...directorStateRef.current, error: msg });
        showAlert(msg);
      } finally {
        setBusyAction(null);
      }
    },
    [
      busyAction,
      clearFinalPromptPersistTimer,
      data?.isGenerating,
      finalPromptDraft,
      finalPromptOpinion,
      patch,
      resolveMvShotLipsync,
      resolveShotFinalPrompt,
      runChat,
      showAlert,
      state.isGenerating,
      tt.aiReviseFinalPromptEmpty,
      tt.aiReviseFinalPromptFailed,
      tt.aiReviseFinalPromptNeedOpinion,
      tt.aiReviseFinalPromptNeedPrompt,
    ],
  );

  const beginMusicJob = useCallback(() => {
    musicJobCancelledRef.current = false;
    musicJobGenRef.current += 1;
    return musicJobGenRef.current;
  }, []);

  const isMusicJobAlive = useCallback((gen: number) => {
    return !musicJobCancelledRef.current && musicJobGenRef.current === gen;
  }, []);

  const cancelMusicJob = useCallback(() => {
    musicJobCancelledRef.current = true;
    musicJobGenRef.current += 1;
    const chatNodeId = directorPhaseChatKey(id);
    const waiter = directorChatWaiters.get(chatNodeId) || chatResolverRef.current;
    directorChatWaiters.delete(chatNodeId);
    chatResolverRef.current = null;
    if (waiter) {
      const err = new Error('cancelled');
      err.name = 'AbortError';
      waiter.reject(err);
    }
    void window.electronAPI?.cancelAudioTranscribeJobs?.();
    setBusyAction(null);
    setLyricTimelineProgress('');
    const cur = directorStateRef.current;
    if (cur.mvMusic?.lyricSegmentsStatus === 'transcribing') {
      const hasSegs = (cur.mvMusic?.lyricSegments || []).length > 0;
      patch(
        patchDirectorMvMusic(cur, {
          lyricSegmentsStatus: hasSegs ? 'ready' : 'idle',
          lyricSegmentsError: '',
        }),
      );
    }
  }, [id, patch]);

  const isMusicJobAbortError = useCallback((e: unknown) => {
    if (!e) return false;
    if (e instanceof Error && (e.name === 'AbortError' || /cancell?ed/i.test(e.message))) return true;
    return false;
  }, []);

  /** 取消进行中的导演 LLM（故事/剧本/分析等）：先解放 UI；云端若已扣费，上游失败会退，成功则可能已扣 */
  const cancelDirectorChat = useCallback(
    (reason: 'user' | 'timeout' = 'user') => {
      if (!mountedRef.current) {
        chatResolverRef.current = null;
        return;
      }
      chatGenRef.current += 1;
      const chatNodeId = directorPhaseChatKey(id);
      const waiter = directorChatWaiters.get(chatNodeId) || chatResolverRef.current;
      directorChatWaiters.delete(chatNodeId);
      chatResolverRef.current = null;
      if (waiter) {
        const err = new Error(reason === 'timeout' ? 'timeout' : 'cancelled');
        err.name = reason === 'timeout' ? 'TimeoutError' : 'AbortError';
        waiter.reject(err);
      }
      // 避免听写卡在 connecting 时全局锁死话筒/画布点击
      try {
        cancelFinalPromptOpinionDictation();
      } catch {
        /* ignore */
      }
      forceClearVoiceModalLock();
      if (mountedRef.current) {
        try {
          void window.electronAPI?.abortFcLlm?.();
        } catch {
          /* ignore */
        }
      }
      setBusyAction(null);
      setOptimizingShotNos([]);
      optimizingShotNosRef.current = [];
      rejectDirectorSkillOptWaiters(id, reason === 'timeout' ? 'timeout' : 'cancelled');
      if (!mountedRef.current) return;
      const cur = directorStateRef.current;
      // 顶栏 data.isGenerating 也可能单独卡住，一律清掉
      patch({ ...cur, isGenerating: false, error: '' });
    },
    [cancelFinalPromptOpinionDictation, id, patch],
  );

  const isDirectorChatAbortError = useCallback((e: unknown) => {
    if (!e) return false;
    if (e instanceof Error && (e.name === 'AbortError' || /cancell?ed/i.test(e.message))) return true;
    return false;
  }, []);

  const isDirectorChatTimeoutError = useCallback((e: unknown) => {
    if (!e) return false;
    if (e instanceof Error && (e.name === 'TimeoutError' || /timeout/i.test(e.message))) return true;
    return false;
  }, []);

  /** 故事/剧本：带客户端超时（略长于 FC LLM 180s），超时自动取消等待 */
  const DIRECTOR_CHAT_CLIENT_TIMEOUT_MS = 240_000;
  const runDirectorChatWithTimeout = useCallback(
    async (
      systemPrompt: string,
      userPrompt: string,
      opts?: {
        max_tokens?: number;
        response_format?: unknown;
        temperature?: number;
        timeoutMs?: number;
      },
    ) => {
      const timeoutMs =
        opts?.timeoutMs != null && Number.isFinite(Number(opts.timeoutMs))
          ? Math.max(5_000, Number(opts.timeoutMs))
          : DIRECTOR_CHAT_CLIENT_TIMEOUT_MS;
      const { timeoutMs: _ignored, ...chatOpts } = opts || {};
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        if (!mountedRef.current) return;
        cancelDirectorChat('timeout');
      }, timeoutMs);
      directorChatClientTimerRef.current = timer;
      try {
        return await runChat(systemPrompt, userPrompt, chatOpts);
      } catch (e) {
        if (timedOut && !isDirectorChatTimeoutError(e)) {
          const err = new Error('timeout');
          err.name = 'TimeoutError';
          throw err;
        }
        throw e;
      } finally {
        if (directorChatClientTimerRef.current === timer) {
          directorChatClientTimerRef.current = null;
        }
        clearTimeout(timer);
      }
    },
    [cancelDirectorChat, isDirectorChatTimeoutError, runChat],
  );

  /** 502/空包/瞬时断网：立刻再打 1 次。429 另走长等待，避免在限流窗口内连打。 */
  const isDirectorChatFastRetryError = useCallback(
    (e: unknown) => {
      const msg = String((e as Error)?.message || e || '');
      if (/NX_AUTH|请先登录/i.test(msg)) return false;
      if (isCloudRateLimitError(e)) return false;
      if (isDirectorChatAbortError(e) && !isDirectorChatTimeoutError(e)) return false;
      return /502|503|504|Bad Gateway|空内容|返回为空|ECONNRESET|ECONNREFUSED|socket hang up|fetch failed|Failed to fetch|连接超时|ENOTFOUND/i.test(
        msg,
      );
    },
    [isDirectorChatAbortError, isDirectorChatTimeoutError],
  );

  const runDirectorChatWithRetry = useCallback(
    async (
      systemPrompt: string,
      userPrompt: string,
      opts?: {
        max_tokens?: number;
        response_format?: unknown;
        temperature?: number;
        timeoutMs?: number;
        retries?: number;
      },
    ) => {
      const retries = Math.max(0, Math.min(2, Math.round(Number(opts?.retries) || 1)));
      const { retries: _r, ...chatOpts } = opts || {};
      let lastErr: unknown;
      for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) {
          const waitMs = isCloudRateLimitError(lastErr) ? 16_000 : 900;
          await new Promise((r) => setTimeout(r, waitMs));
          if (!mountedRef.current) break;
        }
        try {
          const text = await runDirectorChatWithTimeout(systemPrompt, userPrompt, chatOpts);
          if (String(text || '').trim()) return text;
          lastErr = new Error('模型返回为空（网络或上游未返回正文），请重试');
          if (attempt >= retries) throw lastErr;
        } catch (e) {
          lastErr = e;
          if (isDirectorChatAbortError(e) && !isDirectorChatTimeoutError(e)) throw e;
          const retryable = isDirectorChatFastRetryError(e) || isCloudRateLimitError(e);
          if (!retryable || attempt >= retries) throw e;
        }
      }
      throw lastErr;
    },
    [
      isDirectorChatAbortError,
      isDirectorChatFastRetryError,
      isDirectorChatTimeoutError,
      runDirectorChatWithTimeout,
    ],
  );

  const DIRECTOR_MV_SKILL_REWRITE_TIMEOUT_MS = 90_000;
  const rewriteMvVideoPromptsToSkill = useCallback(
    async (
      shotNos: string[],
    ): Promise<{ ok: boolean; overrides: Record<string, string>; failedShotNos: string[] }> => {
      const overrides: Record<string, string> = {};
      const failedShotNos: string[] = [];
      if (!isMvMode || shotNos.length === 0) return { ok: true, overrides, failedShotNos };
      if (!window.electronAPI?.getMinimaxH3PromptGuide) {
        await showAlert(tt.videoSkillRewriteGuideMissing);
        return { ok: false, overrides, failedShotNos: [...shotNos] };
      }

      const latest = directorStateRef.current;
      const batchModel = normalizeDirectorVideoBatchModel(latest.videoBatchModel);
      const batchLipsyncModel = resolveDirectorMvLipsyncModel(latest.videoBatchLipsyncModel);
      const mvMusicUrl = String(latest.mvMusic?.url || '').trim();
      const segs = latest.mvMusic?.lyricSegments || [];
      const packs =
        segs.length > 0
          ? packLyricSegmentsIntoShotPacks(segs, {
              clipLengthMode: latest.mvMusic?.clipLengthMode,
            })
          : [];
      const songDur = Number(latest.mvMusic?.durationSec) || 0;
      const ranges = computeDirectorShotMusicRangesFromState(latest);
      const wanted = new Set(shotNos.map((n) => String(n || '').trim()).filter(Boolean));

      type SkillJob = {
        shotNo: string;
        rowIndex: number;
        structure: 'base' | 'ref';
        sourcePrompt: string;
        seedOriginal: string;
        durationSec: number;
        imageCount: number;
        hasRefAudio: boolean;
        modelId: string;
        refMapHint: string;
        sceneStoryHint: string;
        refItems: ReturnType<typeof buildDirectorShotRefItems>;
      };
      const jobs: SkillJob[] = [];

      for (let i = 0; i < (latest.shots || []).length; i++) {
        const shot = latest.shots[i];
        const shotNo = String(shot['镜号'] || i + 1).trim() || String(i + 1);
        if (!wanted.has(shotNo)) continue;
        const sb = getDirectorShotStoryboard(latest, shotNo);
        const sbUrl = String(sb?.imageUrl || '').trim();
        const range = ranges[i] || {
          startSec: 0,
          endSec: parseDirectorShotDurationSec(shot['时长'], 5),
          durationSec: parseDirectorShotDurationSec(shot['时长'], 5),
        };
        const startSec = Math.max(0, Number(range.startSec) || 0);
        let endSec = Number(range.endSec);
        if (!Number.isFinite(endSec) || endSec <= startSec + 0.05) {
          endSec = startSec + Math.max(0.5, Number(range.durationSec) || 5);
        }
        const hasVoice = shotAudioRangeHasHumanVoice(segs, startSec, endSec);
        const preferLipsync = resolveDirectorMvForceLipsyncOn(
          isMvMode,
          resolveDirectorShotPreferLipsync(shot, sb, {
            hasHumanVoice: hasVoice,
            packText: packs[i]?.text || String(shot['对白旁白'] || ''),
            audioStartSec: startSec,
            songDurationSec: songDur,
            closeUpFramingOn: directorStateRef.current.mvCloseUpFraming !== false,
          }),
        );
        const shotModel = resolveDirectorMvShotVideoModel({
          isMv: isMvMode,
          preferLipsync,
          batchLipsyncModel,
          batchModel,
        });
        const structure = resolveMinimaxH3OptimizeStructure(shotModel);
        const existingOpt = String(sb.promptOptimized || '').trim();
        const baseOriginal = getDirectorShotPromptVersions(shot, sb).original;
        const currentOriginal = String(baseOriginal || shot['最终提示词'] || '').trim();
        const lastFrom = String(sb.promptOptimizedFrom || '').trim();
        // 原文没变且已有优化稿才跳过；原文改过必须重新优化
        if (existingOpt && lastFrom && lastFrom === currentOriginal) {
          overrides[shotNo] = existingOpt;
          continue;
        }
        const sourcePrompt = resolveDirectorShotVideoPromptForGen(
          { ...shot, 最终提示词: baseOriginal || shot['最终提示词'] },
          { lipsync: preferLipsync },
        ).trim();
        if (!sourcePrompt) {
          failedShotNos.push(shotNo);
          continue;
        }
        const orderedRefs = getOrderedAssetsWithImages(latest);
        const boundIdx = getShotBoundRefIndices(shot, orderedRefs, i);
        const boundChars = boundIdx
          .map((idx) => orderedRefs[idx])
          .filter(
            (a): a is (typeof orderedRefs)[number] =>
              !!a && a.kind === 'character' && !!String(a.imageUrl || '').trim(),
          )
          .slice(0, 2);
        const ltxSingle = isDirectorLtxSingleImageModel(shotModel);
        const refItems = buildDirectorShotRefItems({
          storyboardUrl: sbUrl || undefined,
          boundAssets: ltxSingle ? [] : boundChars,
        });
        const refMapHint = ltxSingle
          ? (sbUrl
              ? '<Picture 1> / @图片1 = this shot\'s storyboard only (first frame). Do not mention Picture 2 or a character sheet.'
              : '')
          : refItems
              .map((it) =>
                it.role === 'storyboard'
                  ? `<Picture ${it.n}> / @图片${it.n} = this shot's storyboard (composition, scene, colors and rendering from this image — do not name colors; do not regrade; do not restyle into 3D CGI)`
                  : `<Picture ${it.n}> / @图片${it.n} = character "${it.name}" identity sheet (face/hair/costume only)`,
              )
              .join('\n');
        const imageCount = refItems.length;
        const sceneStoryHint = buildDirectorShotSceneStoryHint(shot);
        const repairedSource = repairDirectorMvPromptImageMap(
          sourcePrompt,
          refItems,
          sceneStoryHint,
        );
        jobs.push({
          shotNo,
          rowIndex: i,
          structure,
          sourcePrompt: repairedSource || sourcePrompt,
          seedOriginal: currentOriginal || repairedSource || sourcePrompt,
          durationSec: Math.max(1, Number(range.durationSec) || endSec - startSec || 5),
          imageCount,
          hasRefAudio: preferLipsync && !!mvMusicUrl,
          modelId: shotModel,
          refMapHint,
          sceneStoryHint,
          refItems,
        });
      }

      if (jobs.length === 0) return { ok: true, overrides, failedShotNos };

      const guideCache: Partial<
        Record<'base' | 'ref', { skillMd: string; guide: string }>
      > = {};
      for (const kind of new Set(jobs.map((j) => j.structure))) {
        const guideRes = await window.electronAPI.getMinimaxH3PromptGuide(kind);
        if (!guideRes?.ok) {
          await showAlert(
            (guideRes as { error?: string } | null)?.error || tt.videoSkillRewriteGuideMissing,
          );
          return { ok: false, overrides, failedShotNos: jobs.map((j) => j.shotNo) };
        }
        guideCache[kind] = { skillMd: guideRes.skillMd, guide: guideRes.guide };
      }

      const chatModelRaw = String(directorStateRef.current.chatModel || '').trim();
      const chatModel = (DIRECTOR_CHAT_MODELS as readonly string[]).includes(chatModelRaw)
        ? chatModelRaw
        : DIRECTOR_CHAT_MODEL_DEFAULT;
      let doneCount = 0;
      const totalJobs = jobs.length;
      const bumpProgress = () => {
        setVideoSkillRewriteHint(
          fillDirectorI18n(tt.videoSkillRewriteProgress, {
            cur: Math.min(doneCount + 1, totalJobs),
            total: totalJobs,
          }),
        );
      };
      const runOneSkillJob = async (job: (typeof jobs)[number]) => {
        const guide = guideCache[job.structure];
        if (!guide) return;
        bumpProgress();
        const { systemPrompt, userPrompt } = buildMinimaxH3OptimizeMessages({
          structure: job.structure,
          skillMd: guide.skillMd,
          guideText: guide.guide,
          prompt: job.sourcePrompt,
          imageCount: job.imageCount,
          hasRefAudio: job.hasRefAudio,
          durationSec: job.durationSec,
          baseSubMode: resolveMinimaxH3BaseSubMode(job.modelId, job.imageCount),
          modelId: job.modelId,
          refMapHint: job.refMapHint,
          sceneStoryHint: job.sceneStoryHint,
        });
        ensureDirectorSkillOptStatusListener();
        const requestId = `skill-${job.shotNo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const optNodeId = directorSkillOptNodeId(id, requestId);
        const raw = await new Promise<string>((resolve, reject) => {
          let settled = false;
          const settleResolve = (text: string) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            resolve(text);
          };
          const settleReject = (err: Error) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            reject(err);
          };
          const timer = window.setTimeout(() => {
            directorSkillOptWaiters.delete(optNodeId);
            const err = new Error('timeout');
            err.name = 'TimeoutError';
            settleReject(err);
          }, DIRECTOR_MV_SKILL_REWRITE_TIMEOUT_MS);
          const early = takeDirectorSkillOptStash(optNodeId);
          if (early) {
            settleResolve(early);
            return;
          }
          directorSkillOptWaiters.set(optNodeId, {
            directorId: id,
            resolve: settleResolve,
            reject: settleReject,
          });
          // 再读一次 stash：SUCCESS 可能夹在 check 与 set 之间
          const raced = takeDirectorSkillOptStash(optNodeId);
          if (raced) {
            directorSkillOptWaiters.delete(optNodeId);
            settleResolve(raced);
            return;
          }
          if (!window.electronAPI?.invokeAI) {
            directorSkillOptWaiters.delete(optNodeId);
            settleReject(new Error(tt.generateFailed));
            return;
          }
          void window.electronAPI
            .invokeAI({
              modelId: 'chat',
              nodeId: optNodeId,
              input: {
                model: chatModel,
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: userPrompt },
                ],
                stream: false,
                projectId: data?.projectId || undefined,
                nodeTitle: 'MV导演·优化提示词',
                directorChatRequestId: requestId,
                max_tokens: 8192,
              },
            })
            .then(() => {
              // invoke 已返回：若 SUCCESS 已暂存则立刻结算；否则继续等状态通道 / 总超时
              const late = takeDirectorSkillOptStash(optNodeId);
              if (late) {
                directorSkillOptWaiters.delete(optNodeId);
                settleResolve(late);
              }
            })
            .catch((e: unknown) => {
              if (!directorSkillOptWaiters.has(optNodeId)) return;
              directorSkillOptWaiters.delete(optNodeId);
              settleReject(e instanceof Error ? e : new Error(String(e || tt.generateFailed)));
            });
        });
        let next = recoverMinimaxH3OptimizedPrompt(
          repairDirectorMvPromptImageMap(
            parseMinimaxH3OptimizedPrompt(raw, job.structure, job.sourcePrompt),
            job.refItems,
            job.sceneStoryHint,
          ),
        );
        // multi/口型期望 ref 六段，但模型常回 base 三段或中文六段；都认
        if (!isAcceptableMinimaxH3OptimizedPrompt(next)) {
          const altStructure = job.structure === 'ref' ? 'base' : 'ref';
          next = recoverMinimaxH3OptimizedPrompt(
            repairDirectorMvPromptImageMap(
              parseMinimaxH3OptimizedPrompt(raw, altStructure, job.sourcePrompt),
              job.refItems,
              job.sceneStoryHint,
            ),
          );
        }
        if (!isAcceptableMinimaxH3OptimizedPrompt(next)) {
          console.warn('[Director] skill optimize invalid format', {
            shotNo: job.shotNo,
            structure: job.structure,
            rawHead: String(raw || '').slice(0, 280),
            parsedHead: String(next || '').slice(0, 280),
          });
          throw new Error('invalid-skill-prompt');
        }
        overrides[job.shotNo] = next;
        const live = directorStateRef.current;
        const prevSb = getDirectorShotStoryboard(live, job.shotNo);
        const liveOrig = String(prevSb.promptOriginal || '').trim();
        const liveOpt = String(prevSb.promptOptimized || '').trim();
        const seed = String(job.seedOriginal || '').trim() || job.sourcePrompt;
        const corrupted = !!(liveOrig && liveOpt && liveOrig === liveOpt);
        const nextOriginal = corrupted
          ? seed && seed !== liveOpt
            ? seed
            : liveOrig
          : liveOrig || seed;
        // 只更新优化稿；原版仅在空/曾被误写成优化稿时校正，不被本次优化结果覆盖
        patch(
          updateDirectorShotStoryboard(live, job.shotNo, {
            ...(nextOriginal ? { promptOriginal: nextOriginal } : {}),
            promptOptimized: next,
            promptOptimizedFrom: seed,
            useOptimizedPrompt: true,
          }),
        );
      };
      const waveSize = Math.min(DIRECTOR_MV_PROMPT_OPTIMIZE_PARALLEL, totalJobs);
      const runJobWithRetry = async (job: (typeof jobs)[number]) => {
        try {
          await runOneSkillJob(job);
          return false;
        } catch (err) {
          const retryable =
            isCloudRateLimitError(err) ||
            isDirectorChatFastRetryError(err) ||
            (err instanceof Error &&
              (err.name === 'TimeoutError' ||
                err.message === 'invalid-skill-prompt' ||
                err.message === 'empty-skill-prompt'));
          let lastErr: unknown = err;
          if (retryable && mountedRef.current) {
            await new Promise((r) =>
              setTimeout(r, isCloudRateLimitError(err) ? 16_000 : 1500),
            );
            try {
              await runOneSkillJob(job);
              lastErr = null;
            } catch (err2) {
              lastErr = err2;
            }
          }
          if (lastErr) {
            failedShotNos.push(job.shotNo);
            console.warn(
              `[Director] ${fillDirectorI18n(tt.videoSkillRewriteFailed, { no: job.shotNo })}`,
              lastErr,
            );
            if (totalJobs === 1) {
              const msg = lastErr instanceof Error ? lastErr.message : String(lastErr || '');
              const aborted =
                lastErr instanceof Error &&
                (lastErr.name === 'AbortError' ||
                  lastErr.name === 'CanceledError' ||
                  lastErr.name === 'TimeoutError' ||
                  /cancell?ed|已取消|timeout/i.test(msg));
              if (!aborted) {
                if (isCloudRateLimitError(lastErr)) {
                  await showAlert(formatCloudLlmUserError(lastErr));
                } else {
                  const hint =
                    msg === 'invalid-skill-prompt'
                      ? '\n模型返回格式不符合 H3（需英文三段/六段，或中文：主体定义/详细描述/声景）'
                      : msg === 'empty-skill-prompt'
                        ? '\n模型未返回有效文本'
                        : msg
                          ? `\n${formatCloudLlmUserError(msg)}`
                          : '';
                  await showAlert(
                    `${fillDirectorI18n(tt.videoSkillRewriteFailed, { no: job.shotNo })}${hint}`,
                  );
                }
              }
            }
          }
          return isCloudRateLimitError(lastErr);
        } finally {
          doneCount += 1;
          setVideoSkillRewriteHint(
            fillDirectorI18n(tt.videoSkillRewriteProgress, {
              cur: Math.min(doneCount, totalJobs),
              total: totalJobs,
            }),
          );
        }
      };

      for (let start = 0; start < totalJobs; start += waveSize) {
        if (!mountedRef.current) break;
        const wave = jobs.slice(start, start + waveSize);
        const waveFlags = await Promise.all(wave.map((job) => runJobWithRetry(job)));
        const more = start + waveSize < totalJobs;
        if (!more || !mountedRef.current) break;
        const gapMs = waveFlags.some(Boolean)
          ? 16_000
          : DIRECTOR_MV_PROMPT_OPTIMIZE_WAVE_GAP_MS;
        setVideoSkillRewriteHint(
          fillDirectorI18n(tt.videoSkillRewriteWaveWait, {
            cur: String(Math.min(doneCount, totalJobs)),
            total: String(totalJobs),
            sec: String(Math.round(gapMs / 1000)),
          }),
        );
        await new Promise((r) => setTimeout(r, gapMs));
      }
      setVideoSkillRewriteHint(null);
      return { ok: true, overrides, failedShotNos };
    },
    [data?.projectId, id, isCloudRateLimitError, isDirectorChatFastRetryError, isMvMode, patch, showAlert, tt],
  );
  rewriteMvVideoPromptsToSkillRef.current = rewriteMvVideoPromptsToSkill;

  const handleOptimizeVideoPrompts = useCallback(
    async (shotNos?: string[]) => {
      if (!isMvMode) return;
      if (busyAction === 'videos') return;
      const isSingle = Array.isArray(shotNos) && shotNos.length === 1;
      // 批量优化进行中：不再开新的批量；单镜仍可并行
      if (!isSingle && (busyAction === 'optimize-prompts' || optimizingShotNosRef.current.length > 0)) {
        return;
      }
      flushFinalPromptDraft();
      const latest = directorStateRef.current;
      const nos =
        Array.isArray(shotNos) && shotNos.length > 0
          ? shotNos.map((n) => String(n || '').trim()).filter(Boolean)
          : (latest.shots || [])
              .map((s, i) => ({
                no: String(s['镜号'] || i + 1).trim() || String(i + 1),
                ok: !!String(s['最终提示词'] || s['画面描述'] || '').trim(),
              }))
              .filter((x) => x.ok)
              .map((x) => x.no);
      if (nos.length === 0) {
        await showAlert(tt.videoPromptOptimizeNeedText);
        return;
      }
      if (isSingle) {
        const no = nos[0];
        if (!no || optimizingShotNosRef.current.includes(no)) return;
        optimizingShotNosRef.current = [...optimizingShotNosRef.current, no];
        setOptimizingShotNos([...optimizingShotNosRef.current]);
      } else {
        optimizingShotNosRef.current = nos;
        setOptimizingShotNos(nos);
        setBusyAction('optimize-prompts');
      }
      try {
        const rewritten = await rewriteMvVideoPromptsToSkillRef.current(nos);
        if (!rewritten.ok) return;
        const failed = (rewritten.failedShotNos || []).filter(Boolean);
        const wroteAny = nos.some((no) => !!String(rewritten.overrides?.[no] || '').trim());
        if (!isSingle && failed.length > 0) {
          const okCount = Math.max(0, nos.length - failed.length);
          if (okCount > 0) setPromptPreviewTab('optimized');
          await showAlert(
            fillDirectorI18n(tt.videoSkillRewriteBatchSummary, {
              ok: String(okCount),
              fail: String(failed.length),
              nos: `${failed.slice(0, 16).join('、')}${failed.length > 16 ? '…' : ''}`,
            }),
          );
        } else if (wroteAny) {
          setPromptPreviewTab('optimized');
        } else if (isSingle) {
          const sb = getDirectorShotStoryboard(directorStateRef.current, nos[0]);
          if (!String(sb.promptOptimized || '').trim()) {
            await showAlert(fillDirectorI18n(tt.videoSkillRewriteFailed, { no: nos[0] }));
          } else {
            setPromptPreviewTab('optimized');
          }
        } else {
          setPromptPreviewTab('optimized');
        }
      } finally {
        if (isSingle) {
          const no = nos[0];
          optimizingShotNosRef.current = optimizingShotNosRef.current.filter((n) => n !== no);
          setOptimizingShotNos([...optimizingShotNosRef.current]);
          if (optimizingShotNosRef.current.length === 0) {
            setVideoSkillRewriteHint(null);
          }
        } else {
          optimizingShotNosRef.current = [];
          setOptimizingShotNos([]);
          setVideoSkillRewriteHint(null);
          setBusyAction((prev) => (prev === 'optimize-prompts' ? null : prev));
        }
      }
    },
    [busyAction, flushFinalPromptDraft, isMvMode, showAlert, tt],
  );

  const setShotPromptUseOptimized = useCallback(
    (shotNo: string, useOptimized: boolean) => {
      const latest = directorStateRef.current;
      const sb = getDirectorShotStoryboard(latest, shotNo);
      if (useOptimized && !String(sb.promptOptimized || '').trim()) return;
      patch(updateDirectorShotStoryboard(latest, shotNo, { useOptimizedPrompt: useOptimized }));
    },
    [patch],
  );

  // Esc：故事/剧本撰写中优先取消等待（不退全屏）
  useEffect(() => {
    const storyBusy =
      busyAction === 'story-outline' ||
      busyAction === 'story-script' ||
      busyAction === 'story-oneshot' ||
      busyAction === 'story-analyze';
    if (!storyBusy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      cancelDirectorChat('user');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busyAction, cancelDirectorChat]);

  const absorbedScript = useMemo(() => String(state.scriptText || '').trim(), [state.scriptText]);
  const scriptChipTitle = useMemo(() => {
    if (!absorbedScript) return tt.absorbedScriptEmpty;
    const first = absorbedScript
      .split(/\n/)
      .map((s) => s.trim())
      .find(Boolean);
    return first?.replace(/^#+\s*/, '') || absorbedScript.slice(0, 80);
  }, [absorbedScript, tt.absorbedScriptEmpty]);

  const renderScriptChip = () => (
    <span
      className={`nodrag inline-flex items-center max-w-[min(200px,40%)] shrink-0 truncate px-1.5 py-0.5 rounded-md text-[12px] font-semibold tracking-tight ${
        absorbedScript
          ? isDarkMode
            ? 'bg-sky-500/25 text-sky-300'
            : 'bg-sky-100 text-sky-700'
          : isDarkMode
            ? 'bg-white/8 text-white/40'
            : 'bg-gray-100 text-gray-400'
      }`}
      title={scriptChipTitle}
    >
      @{tt.scriptChipLabel}
    </span>
  );

  /** MV / 短剧已拆成独立节点，不再显示模式切换 */
  const renderModeToggle = () => null;

  const userPromptText = String(data?.userPrompt || '');

  const handleGenerateShots = useCallback(async () => {
    const baseScript = absorbedScript;
    const extra = userPromptText.trim();
    const combined = [baseScript, extra].filter(Boolean).join('\n\n');
    const mvMusic = directorStateRef.current.mvMusic;
    const hasMvInput =
      !!String(mvMusic?.url || '').trim() ||
      !!String(mvMusic?.moodHint || '').trim() ||
      !!extra ||
      !!baseScript;

    if (directorStateRef.current.mode === 'mv') {
      if (!hasMvInput) {
        patch({ ...directorStateRef.current, error: tt.generateNeedMusic, isGenerating: false });
        return;
      }
    } else if (!combined) {
      patch({ ...directorStateRef.current, error: tt.generateNeedScript, isGenerating: false });
      return;
    }
    if (busyAction === 'shots' || state.isGenerating || data?.isGenerating) return;
    setBusyAction('shots');
    patch({ ...directorStateRef.current, isGenerating: true, error: '', phase: 'shots' });
    try {
      let text: string;
      if (directorStateRef.current.mode === 'mv') {
        const mergedState: DirectorPipelineState = {
          ...directorStateRef.current,
          scriptText: [directorStateRef.current.scriptText, extra].filter(Boolean).join('\n\n'),
        };
        const { systemPrompt, userPrompt } = buildDirectorMvShotsMessages(mergedState);
        text = await runChat(systemPrompt, userPrompt);
      } else {
        const styleHint = resolveDirectorStylePrompt(
          directorStateRef.current.stylePresetId,
          directorStateRef.current.globalStyle,
        );
        const { systemPrompt, userPrompt } = buildDirectorShotsMessages(combined, styleHint);
        text = await runChat(systemPrompt, userPrompt);
      }
      const normalized = normalizeDirectorShotsResult(text);
      if (!normalized.ok) {
        patch({
          ...directorStateRef.current,
          isGenerating: false,
          error: tt.generateFailed + (normalized.error ? `: ${normalized.error}` : ''),
        });
        return;
      }
      let nextState = applyDirectorShotsPatch(directorStateRef.current, normalized);
      const isMv = directorStateRef.current.mode === 'mv';
      const durSec = Number(directorStateRef.current.mvMusic?.durationSec) || 0;
      const hasLyricTimeline =
        (directorStateRef.current.mvMusic?.lyricSegments || []).length > 0;
      if (isMv && hasLyricTimeline && nextState.shots.length > 0) {
        // 人声边界优先：对齐镜头时长与音频起止（不在半句中间切开）
        // 同时清洗无人声镜拿麦/对口型画面，并清空间奏对白
        nextState = syncDirectorShotsToLyricTimeline(nextState);
        const style = resolveDirectorStylePrompt(nextState.stylePresetId, nextState.globalStyle);
        nextState = {
          ...nextState,
          shots: withComposedDirectorFinalPrompts(nextState.shots, style, true, {
            stylePresetId: nextState.stylePresetId,
          }),
        };
      } else if (isMv && durSec > 0 && nextState.shots.length > 0) {
        nextState = {
          ...nextState,
          shots: ensureMvShotsMatchMusicDuration(nextState.shots, durSec),
        };
      }
      if (isMv && nextState.shots.length > 0) {
        // 剧情表段数先对齐到音频片段/镜数，再回填画面（避免 8 段剧本对 12 镜）
        const clipCount = resolveDirectorMvAudioClipCount(nextState);
        if (clipCount > 0) {
          const sections0 = normalizeDirectorMvScriptSections(nextState.mvStoryAnalysis?.sections);
          const alignedSections = alignDirectorMvScriptSectionsToClipCount(sections0, clipCount);
          if (alignedSections.plot !== sections0.plot) {
            nextState = {
              ...nextState,
              scriptText: composeDirectorMvScriptText(alignedSections) || nextState.scriptText,
            };
            nextState = patchDirectorMvStoryAnalysis(nextState, { sections: alignedSections });
          }
        }
        // 最后再按步骤四剧情表回填画面/景别/运镜/光影（避免被 sync 扩镜成空行）
        const plotBeats = getDirectorMvPlotBeatsFromState(nextState);
        if (plotBeats?.length) {
          nextState = {
            ...nextState,
            shots: applyDirectorMvPlotBeatsToShots(nextState.shots, plotBeats, {
              forceDesc: true,
              forceFraming: true,
              closeUpFraming: nextState.mvCloseUpFraming !== false,
            }),
          };
        }
        let sceneNames = (nextState.assets.scenes || [])
          .map((s) => String(s.name || '').trim())
          .filter(Boolean);
        if (!sceneNames.length) {
          sceneNames = parseDirectorMvSceneEntries(getDirectorMvScenesSectionText(nextState))
            .map((e) => String(e.name || '').trim())
            .filter(Boolean);
        }
        const covered = ensureMvShotsCoverSceneNames(nextState.shots, sceneNames);
        const style = resolveDirectorStylePrompt(nextState.stylePresetId, nextState.globalStyle);
        const composed = withComposedDirectorFinalPrompts(covered, style, true, {
          stylePresetId: nextState.stylePresetId,
        });
        const ranges = computeDirectorShotMusicRangesFromState({ ...nextState, shots: composed });
        const segs = nextState.mvMusic?.lyricSegments;
        const hasHumanVoiceByShot = composed.map((s, i) => {
          const range = ranges[i];
          if (range) {
            const v = shotAudioRangeHasHumanVoice(segs, range.startSec, range.endSec);
            if (v != null) return v;
          }
          if (isDirectorInstrumentalLyricText(s['对白旁白'])) return false;
          return null as boolean | null;
        });
        const rebound = rebindDirectorPipelineAssetRefs(
          { ...nextState, shots: composed },
          { hasHumanVoiceByShot },
        );
        nextState = { ...nextState, shots: rebound.shots };
        if (hasLyricTimeline) {
          // 只对齐时长/音频区间，保留已回填的画面字段
          nextState = syncDirectorShotsToLyricTimeline(nextState);
          // sync 可能扩出空镜行：再回填一次
          if (plotBeats?.length) {
            nextState = {
              ...nextState,
              shots: applyDirectorMvPlotBeatsToShots(nextState.shots, plotBeats, {
                forceDesc: true,
                forceFraming: true,
                closeUpFraming: nextState.mvCloseUpFraming !== false,
              }),
            };
            nextState = {
              ...nextState,
              shots: withComposedDirectorFinalPrompts(
                nextState.shots,
                resolveDirectorStylePrompt(nextState.stylePresetId, nextState.globalStyle),
                true,
                { stylePresetId: nextState.stylePresetId },
              ),
            };
          }
        }
      }
      patch({
        ...markAllDirectorShotsPromptsSynced(nextState),
        isGenerating: false,
        error: '',
      });
    } catch (e) {
      patch({
        ...directorStateRef.current,
        isGenerating: false,
        error: e instanceof Error ? e.message : tt.generateFailed,
      });
    } finally {
      setBusyAction(null);
    }
  }, [
    absorbedScript,
    userPromptText,
    busyAction,
    state.isGenerating,
    data?.isGenerating,
    patch,
    runChat,
    tt.generateFailed,
    tt.generateNeedScript,
    tt.generateNeedMusic,
  ]);

  const handleExtractAssets = useCallback(async () => {
    if (state.shots.length === 0) {
      patch({ ...state, error: tt.needShotsFirst });
      return;
    }
    const ok = await showConfirm(tt.confirmGoAssets);
    if (!ok) return;
    setBusyAction('assets');
    patch({ ...state, isGenerating: true, error: '' });
    try {
      const { systemPrompt, userPrompt } = buildDirectorAssetsMessages({
        shots: state.shots,
        styleHint:
          resolveDirectorStylePrompt(state.stylePresetId, state.globalStyle) ||
          String(data?.userPrompt || ''),
      });
      const text = await runChat(systemPrompt, userPrompt);
      const normalized = normalizeDirectorAssetsResult(text);
      patch(applyDirectorAssetsPatch(state, normalized));
    } catch (e) {
      patch({
        ...state,
        isGenerating: false,
        error: e instanceof Error ? e.message : tt.generateFailed,
      });
    } finally {
      setBusyAction(null);
    }
  }, [data?.userPrompt, patch, runChat, showConfirm, state, tt]);

  const handleComposePrompts = useCallback(async () => {
    if (allAssets.length === 0) {
      patch({ ...state, error: tt.needAssetsFirst });
      return;
    }
    if (missing.total > 0) {
      const ok = await showConfirm(tt.confirmGoPrompts);
      if (!ok) return;
    }
    setBusyAction('prompts');
    patch({ ...state, isGenerating: true, error: '', phase: 'prompts' });
    try {
      const refs = getOrderedAssetsWithImages(state);
      const refList = refs.length > 0 ? refs : allAssets;
      const { systemPrompt, userPrompt } = buildDirectorPromptsMessages({
        shots: state.shots,
        globalStyle: resolveDirectorStylePrompt(state.stylePresetId, state.globalStyle),
        assetRefs: refList,
        closeUpFraming: state.mvCloseUpFraming !== false,
        shotChangePace: state.mvMusic?.shotChangePace,
        styleUrl: resolveDirectorStyleReferenceImageUrl(
          state.stylePresetId,
          state.styleReferenceImageUrl,
        ),
        leadAssetIds: listDirectorMvLeadAssetIds(state),
      });
      const text = await runChat(systemPrompt, userPrompt);
      const normalized = normalizeDirectorPromptsResult(text);
      patch(applyDirectorPromptsPatch({ ...state, phase: 'prompts' }, normalized));
    } catch (e) {
      // LLM 失败时仍按画面描述本地绑定已有提示词，尽量补上角色/场景参考图
      const local = rebindDirectorPipelineAssetRefs(directorStateRef.current);
      if (local.changed) {
        patch({
          ...directorStateRef.current,
          shots: local.shots,
          phase: 'prompts',
          isGenerating: false,
          error: e instanceof Error ? e.message : tt.generateFailed,
        });
      } else {
        patch({
          ...state,
          phase: 'prompts',
          isGenerating: false,
          error: e instanceof Error ? e.message : tt.generateFailed,
        });
      }
    } finally {
      setBusyAction(null);
    }
  }, [allAssets, missing.total, patch, runChat, showConfirm, state, tt]);

  /** 进入提示词阶段后，对已合成但漏绑 @图片N 的镜头做一次本地补绑（不耗 LLM） */
  const assetRebindKeyRef = useRef('');
  useEffect(() => {
    if (state.phase !== 'prompts') return;
    if (busyAction === 'prompts' || state.isGenerating) return;
    const key = `${state.shots.map((s) => `${s['镜号']}:${s['画面描述']}:${s['最终提示词']}`).join('|')}#${flattenDirectorAssets(state.assets)
      .map((a) => `${a.id}:${a.name}:${a.imageUrl ? 1 : 0}`)
      .join(',')}#${state.stylePresetId || ''}:${state.styleReferenceImageUrl || ''}`;
    if (assetRebindKeyRef.current === key) return;
    const { shots, changed } = rebindDirectorPipelineAssetRefs(state);
    assetRebindKeyRef.current = key;
    if (!changed) return;
    const nextKey = `${shots.map((s) => `${s['镜号']}:${s['画面描述']}:${s['最终提示词']}`).join('|')}#${flattenDirectorAssets(state.assets)
      .map((a) => `${a.id}:${a.name}:${a.imageUrl ? 1 : 0}`)
      .join(',')}#${state.stylePresetId || ''}:${state.styleReferenceImageUrl || ''}`;
    assetRebindKeyRef.current = nextKey;
    patchRef.current({ ...directorStateRef.current, shots, phase: 'prompts' });
  }, [
    state.phase,
    state.shots,
    state.assets,
    state.isGenerating,
    busyAction,
    state.stylePresetId,
    state.styleReferenceImageUrl,
  ]);

  const enqueueAssetImages = useCallback(
    (targets: DirectorAsset[], opts?: { onlyMissing?: boolean; maxParallel?: number }) => {
      if (imageGenYuanbao(1) == null) {
        void showAlert(tt.otsPriceRequired);
        return;
      }
      const onlyMissing = opts?.onlyMissing === true;
      let valid = targets.filter((a) => String(a.prompt || a.name).trim());
      if (onlyMissing) {
        valid = valid.filter((a) => !String(a.imageUrl || '').trim());
      } else {
        valid = [...valid].sort((a, b) => {
          const am = String(a.imageUrl || '').trim() ? 1 : 0;
          const bm = String(b.imageUrl || '').trim() ? 1 : 0;
          return am - bm;
        });
      }
      if (valid.length === 0) return;
      const existingIds = new Set([
        ...imageGenQueueRef.current.map((a) => a.id),
        ...imageGenInFlightRef.current,
      ]);
      const toAdd = valid.filter((a) => !existingIds.has(a.id));
      if (toAdd.length === 0) {
        void runNextImageGen();
        return;
      }
      const missingAdd = toAdd.filter((a) => !String(a.imageUrl || '').trim());
      const readyAdd = toAdd.filter((a) => String(a.imageUrl || '').trim());
      imageGenQueueRef.current = [...missingAdd, ...imageGenQueueRef.current, ...readyAdd];
      if (opts?.maxParallel != null && Number.isFinite(opts.maxParallel) && opts.maxParallel > 0) {
        imageGenMaxParallelRef.current = Math.max(
          imageGenMaxParallelRef.current,
          Math.round(opts.maxParallel),
        );
      }
      void runNextImageGen();
    },
    [imageGenYuanbao, runNextImageGen, showAlert, tt.otsPriceRequired],
  );

  const startBatchImages = useCallback(() => {
    const selected = new Set(state.selectedAssetIds);
    const targets = allAssets.filter(
      (a) => (selected.size === 0 || selected.has(a.id)) && String(a.prompt || a.name).trim(),
    );
    setBatchOpen(false);
    enqueueAssetImages(targets, { onlyMissing: true });
  }, [allAssets, enqueueAssetImages, state.selectedAssetIds]);

  const generateCategory = useCallback(
    (kind: DirectorAssetKind) => {
      const list = state.assets[directorAssetBagKey(kind)] || [];
      const pending = list.filter(
        (a) =>
          String(a.prompt || a.name).trim() && !String(a.imageUrl || '').trim(),
      );
      const maxParallel =
        kind === 'scene'
          ? Math.min(
              IMAGE_GEN_MAX_PARALLEL_SCENE_BATCH,
              Math.max(1, pending.length || list.length),
            )
          : IMAGE_GEN_MAX_PARALLEL_DEFAULT;
      enqueueAssetImages(list, { onlyMissing: true, maxParallel });
    },
    [enqueueAssetImages, state.assets],
  );

  const generateOneAsset = useCallback(
    (asset: DirectorAsset) => {
      if (!String(asset.prompt || asset.name || '').trim()) {
        void showAlert(tt.castGenerateOrCanvas);
        return;
      }
      if (imageGenYuanbao(1) == null) {
        void showAlert(tt.otsPriceRequired);
        return;
      }
      // 先打进度态，避免等队列/invoke 时界面无反馈
      markImageGenProgress(asset.id, true);
      patch(
        updateDirectorAsset(directorStateRef.current, asset.id, {
          status: 'generating',
          error: undefined,
        }),
      );
      enqueueAssetImages([asset], { onlyMissing: false });
    },
    [
      enqueueAssetImages,
      imageGenYuanbao,
      markImageGenProgress,
      patch,
      showAlert,
      tt.castGenerateOrCanvas,
      tt.otsPriceRequired,
    ],
  );

  useEffect(() => {
    if (!sourceMenuAssetId) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      const anchor = sourceMenuRef.current;
      const portal = sourceMenuPortalRef.current;
      if (anchor?.contains(t) || portal?.contains(t)) return;
      setSourceMenuAssetId(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [sourceMenuAssetId]);

  /** 选角缩略图来源菜单：相对锚点 fixed 定位（配合 portal，躲开 overflow 裁切） */
  useLayoutEffect(() => {
    if (!sourceMenuAssetId) {
      setSourceMenuFixedStyle(null);
      return;
    }
    const update = () => {
      const el = sourceMenuRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const minWidth = Math.max(152, Math.min(220, rect.width));
      let left = rect.left + rect.width / 2 - minWidth / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - minWidth - 8));
      setSourceMenuFixedStyle({
        left,
        bottom: Math.max(8, window.innerHeight - rect.top + 6),
        minWidth,
      });
    };
    update();
    const raf = requestAnimationFrame(update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [sourceMenuAssetId]);

  /** 进入选角：按选角计划确保主角槽位 */
  useEffect(() => {
    if (!isWizardMode || state.phase !== 'cast') return;
    const plan = normalizeDirectorMvCastPlan(state.mvCastPlan);
    const chars = state.assets.characters || [];
    const needEnsure =
      chars.length < plan.leadCount ||
      chars.slice(0, plan.leadCount).some((c, i) => {
        const g = i === 0 ? plan.lead1Gender : plan.lead2Gender;
        return c.gender !== g;
      });
    if (!needEnsure && chars.length > 0) return;
    patch(ensureDirectorMvLeadSlots(directorStateRef.current));
  }, [isMvMode, state.phase, state.mvCastPlan, state.assets.characters, patch]);

  /** 进入场景步且列表为空时，按剧本场景库自动铺场景卡 */
  useEffect(() => {
    if (!isWizardMode || state.phase !== 'assets') return;
    if ((state.assets.scenes || []).length > 0) return;
    const entries = parseDirectorMvSceneEntries(getDirectorMvScenesSectionText(state));
    if (!entries.length) return;
    patch(syncDirectorMvScenesFromScript(directorStateRef.current, 'fill'));
  }, [isMvMode, state.phase, state.assets.scenes, state.mvStoryAnalysis, state.scriptText, patch]);

  const applyAssetImage = useCallback(
    (assetId: string, imageUrl: string, extra?: { name?: string; prompt?: string }) => {
      const url = String(imageUrl || '').trim();
      if (!assetId || !url) return;
      const updates: Partial<DirectorAsset> = {
        imageUrl: url,
        status: 'ready',
        error: undefined,
      };
      if (extra?.name?.trim()) updates.name = extra.name.trim();
      if (extra?.prompt?.trim()) updates.prompt = extra.prompt.trim();
      patch(updateDirectorAsset(directorStateRef.current, assetId, updates));
      syncDomainAssetImage(assetId, { imageUrl: url, status: 'ready' });
    },
    [patch, syncDomainAssetImage],
  );

  const clearAssetImage = useCallback(
    (assetId: string) => {
      const id = String(assetId || '').trim();
      if (!id) return;
      if (findDirectorAssetById(directorStateRef.current.assets, id)) {
        patch(
          updateDirectorAsset(directorStateRef.current, id, {
            imageUrl: '',
            status: 'pending',
            error: undefined,
          }),
        );
      }
      syncDomainAssetImage(id, { imageUrl: '', status: 'pending' });
    },
    [patch, syncDomainAssetImage],
  );

  /** 短剧 V2：Domain 资产 id → 确保 pipeline.assets 可生图 */
  const ensureDramaPipelineAsset = useCallback(
    (kind: DramaAssetVisualKind, assetId: string): DirectorAsset | null => {
      const id = String(assetId || '').trim();
      if (!id) return null;
      const domain = (dataRef.current?.directorDomain as DramaDirectorSession | null) || null;
      let hit = findDirectorAssetById(directorStateRef.current.assets, id);
      if (!hit && domain) {
        const projected = projectDramaSessionToPipeline(domain, directorStateRef.current);
        patch(projected);
        hit = findDirectorAssetById(directorStateRef.current.assets, id);
      }
      if (!hit && domain && kind === 'characters') {
        if (isDramaSystemVisualAssetId(id, domain)) {
          const sysVoice = resolveDramaSystemVoice(domain);
          const prompt = composeDramaSystemVisualPrompt(sysVoice?.image_prompt);
          const asset = {
            ...createEmptyDirectorAsset(
              'character',
              DRAMA_SYSTEM_VISUAL_ASSET_NAME,
              prompt,
              0,
              '',
            ),
            id: DRAMA_SYSTEM_SPEAKER_ID,
            imageUrl: String(sysVoice?.imageUrl || '').trim(),
            status: 'pending' as const,
          };
          patch(upsertDirectorAsset(directorStateRef.current, asset));
          hit = findDirectorAssetById(directorStateRef.current.assets, DRAMA_SYSTEM_SPEAKER_ID);
        } else {
          for (const ch of domain.bible.characters || []) {
            const cos = (ch.costumes || []).find((x) => x.costume_id === id);
            if (!cos) continue;
            const prompt = composeDramaCharacterCostumePrompt(ch, cos);
            const gender =
              ch.gender === 'male' || ch.gender === 'female' ? ch.gender : '';
            const asset = {
              ...createEmptyDirectorAsset(
                'character',
                `${ch.name}·${cos.name}`,
                prompt,
                0,
                gender,
              ),
              id,
              imageUrl: String(cos.images?.[0] || '').trim(),
              status: 'pending' as const,
            };
            patch(upsertDirectorAsset(directorStateRef.current, asset));
            hit = findDirectorAssetById(directorStateRef.current.assets, id);
            break;
          }
        }
      }
      if (hit && domain) {
        if (kind === 'characters' && isDramaSystemVisualAssetId(id, domain)) {
          const sysVoice = resolveDramaSystemVoice(domain);
          const name = DRAMA_SYSTEM_VISUAL_ASSET_NAME;
          const prompt = composeDramaSystemVisualPrompt(sysVoice?.image_prompt);
          if (
            name !== hit.asset.name ||
            prompt !== String(hit.asset.prompt || '').trim()
          ) {
            patch(
              updateDirectorAsset(directorStateRef.current, hit.asset.id, {
                name,
                prompt,
              }),
            );
            hit = findDirectorAssetById(directorStateRef.current.assets, hit.asset.id);
          }
        } else {
        const bibleItem =
          kind === 'characters'
            ? domain.bible.characters.find((c) => c.character_id === id)
            : kind === 'scenes'
              ? domain.bible.scenes.find((s) => s.scene_id === id)
              : kind === 'props'
                ? domain.bible.props.find((p) => p.prop_id === id)
                : domain.bible.creatures.find((c) => c.creature_id === id);
        if (bibleItem) {
          const name = String(bibleItem.name || '').trim();
          const prompt = String(
            ('prompt' in bibleItem && bibleItem.prompt) ||
              ('description' in bibleItem && bibleItem.description) ||
              ('appearance' in bibleItem && bibleItem.appearance) ||
              '',
          ).trim();
          if (
            (name && name !== hit.asset.name) ||
            (prompt && prompt !== String(hit.asset.prompt || '').trim())
          ) {
            patch(
              updateDirectorAsset(directorStateRef.current, id, {
                ...(name ? { name } : {}),
                ...(prompt ? { prompt } : {}),
              }),
            );
            hit = findDirectorAssetById(directorStateRef.current.assets, id);
          }
        } else if (kind === 'characters') {
          for (const ch of domain.bible.characters || []) {
            const cos = (ch.costumes || []).find((x) => x.costume_id === id);
            if (!cos) continue;
            const prompt = composeDramaCharacterCostumePrompt(ch, cos);
            const name = `${ch.name}·${cos.name}`;
            if (
              name !== hit.asset.name ||
              prompt !== String(hit.asset.prompt || '').trim()
            ) {
              patch(updateDirectorAsset(directorStateRef.current, id, { name, prompt }));
              hit = findDirectorAssetById(directorStateRef.current.assets, id);
            }
            break;
          }
        }
        }
      }
      return hit?.asset || null;
    },
    [patch],
  );

  const applyCastArtworkPreset = useCallback(
    async (assetId: string, preset: DirectorCastArtworkPreset) => {
      const publicUrl = directorCastArtworkImageUrl(preset.imageFile);
      if (!assetId || !publicUrl) return;
      const localUrl = await materializeStyleReferenceUrl(publicUrl);
      const hit = findDirectorAssetById(directorStateRef.current.assets, assetId);
      const keepName = String(hit?.asset.name || '').trim();
      const keepPrompt = String(hit?.asset.prompt || '').trim();
      applyAssetImage(assetId, localUrl || publicUrl, {
        name: keepName || preset.name,
        prompt: keepPrompt || preset.promptZh,
      });
      // 自动切到下一个还没参考图的角色
      const chars = directorStateRef.current.assets.characters || [];
      const nextMissing = chars.find(
        (c) => c.id !== assetId && !String(c.imageUrl || '').trim(),
      );
      setCastArtworkPickAssetId(nextMissing?.id || assetId);
    },
    [applyAssetImage, materializeStyleReferenceUrl],
  );

  const clearSbPickerLeaveTimer = useCallback(() => {
    if (sbPickerLeaveTimerRef.current) {
      clearTimeout(sbPickerLeaveTimerRef.current);
      sbPickerLeaveTimerRef.current = null;
    }
  }, []);

  const openSbVersionPicker = useCallback(
    (shotNo: string, versionCount: number) => {
      if (versionCount < 2) return;
      clearSbPickerLeaveTimer();
      setCastPickerShotNo(null);
      setScenePickerShotNo(null);
      setSbSourceMenuShotNo(null);
      setVideoPickerShotNo(null);
      setSbPickerShotNo(shotNo);
    },
    [clearSbPickerLeaveTimer],
  );

  const scheduleCloseSbVersionPicker = useCallback(
    (shotNo: string) => {
      clearSbPickerLeaveTimer();
      sbPickerLeaveTimerRef.current = setTimeout(() => {
        setSbPickerShotNo((cur) => (cur === shotNo ? null : cur));
        sbPickerLeaveTimerRef.current = null;
      }, 180);
    },
    [clearSbPickerLeaveTimer],
  );

  const clearVideoPickerLeaveTimer = useCallback(() => {
    if (videoPickerLeaveTimerRef.current) {
      clearTimeout(videoPickerLeaveTimerRef.current);
      videoPickerLeaveTimerRef.current = null;
    }
  }, []);

  const openVideoVersionPicker = useCallback(
    (shotNo: string, versionCount: number) => {
      if (versionCount < 2) return;
      clearVideoPickerLeaveTimer();
      setCastPickerShotNo(null);
      setScenePickerShotNo(null);
      setSbSourceMenuShotNo(null);
      setSbPickerShotNo(null);
      setVideoPickerShotNo(shotNo);
    },
    [clearVideoPickerLeaveTimer],
  );

  const scheduleCloseVideoVersionPicker = useCallback(
    (shotNo: string) => {
      clearVideoPickerLeaveTimer();
      videoPickerLeaveTimerRef.current = setTimeout(() => {
        setVideoPickerShotNo((cur) => (cur === shotNo ? null : cur));
        videoPickerLeaveTimerRef.current = null;
      }, 180);
    },
    [clearVideoPickerLeaveTimer],
  );

  const applyStoryboardImage = useCallback(
    (shotNo: string, imageUrl: string) => {
      const no = String(shotNo || '').trim();
      const url = String(imageUrl || '').trim();
      if (!no || !url) return;
      patch(
        updateDirectorShotStoryboard(directorStateRef.current, no, {
          imageUrl: url,
          status: 'ready',
          error: undefined,
        }),
      );
    },
    [patch],
  );

  /** 点击表格行后取消「新分镜/新成片/新优化提示词」绿色标记 */
  const acknowledgeShotRowUnseen = useCallback(
    (shotNo: string) => {
      const no = String(shotNo || '').trim();
      if (!no) return;
      const sb = getDirectorShotStoryboard(directorStateRef.current, no);
      if (!sb.storyboardUnseen && !sb.videoUnseen && !sb.promptOptimizedUnseen) return;
      patch(
        updateDirectorShotStoryboard(directorStateRef.current, no, {
          storyboardUnseen: false,
          videoUnseen: false,
          promptOptimizedUnseen: false,
        }),
      );
    },
    [patch],
  );

  const bindShotRowUnseenAck = (shotNo: string, rowUnseen: boolean) =>
    rowUnseen
      ? {
          onPointerDownCapture: () => acknowledgeShotRowUnseen(shotNo),
          onClickCapture: () => acknowledgeShotRowUnseen(shotNo),
        }
      : {};

  const isShotRowUnseen = (sb: {
    storyboardUnseen?: boolean;
    videoUnseen?: boolean;
    promptOptimizedUnseen?: boolean;
  } | null | undefined) =>
    !!(sb?.storyboardUnseen || sb?.videoUnseen || sb?.promptOptimizedUnseen);

  const renderSbVersionPopover = (shotNo: string, versions: string[], currentUrl: string) => {
    if (sbPickerShotNo !== shotNo || versions.length < 2) return null;
    return (
      <div
        data-director-picker-keep="sb"
        className={`absolute left-1/2 top-full z-50 mt-1 w-[240px] -translate-x-1/2 rounded-lg border p-1.5 shadow-xl ${
          isDarkMode ? 'border-white/15 bg-zinc-950' : 'border-gray-200 bg-white'
        }`}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseEnter={() => {
          clearSbPickerLeaveTimer();
          openSbVersionPicker(shotNo, versions.length);
        }}
        onMouseLeave={() => scheduleCloseSbVersionPicker(shotNo)}
      >
        <div className="flex items-center justify-between gap-1 px-1 pb-1">
          <span className={mutedCls} style={{ fontSize: Math.max(10, fsChrome - 1) }}>
            {tt.storyboardPickVersion}
            <span className="ml-1 opacity-70">({versions.length})</span>
          </span>
          <button
            type="button"
            className={`nodrag rounded p-0.5 ${
              isDarkMode ? 'text-white/70 hover:bg-white/10' : 'text-gray-600 hover:bg-gray-200'
            }`}
            title={tt.viewImage}
            onClick={(e) => {
              e.stopPropagation();
              setImagePreview({ url: currentUrl, name: `镜${shotNo}` });
              setSbPickerShotNo(null);
            }}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1 max-h-48 overflow-auto">
          {versions.map((u, i) => {
            const on = u === currentUrl;
            return (
              <button
                key={`${shotNo}-sb-${i}`}
                type="button"
                className={`nodrag relative overflow-hidden rounded-md ring-1 ${
                  on
                    ? 'ring-sky-400'
                    : isDarkMode
                      ? 'ring-white/15 hover:ring-white/35'
                      : 'ring-gray-300 hover:ring-gray-400'
                }`}
                title={on ? tt.viewImage : tt.storyboardPickVersion}
                onClick={(e) => {
                  e.stopPropagation();
                  if (on) {
                    setImagePreview({ url: u, name: `镜${shotNo}` });
                  } else {
                    applyStoryboardImage(shotNo, u);
                  }
                  setSbPickerShotNo(null);
                }}
              >
                <AssetLibLazyThumb
                  src={u}
                  alt=""
                  maxEdge={160}
                  className="aspect-video w-full"
                  imgClassName="aspect-video w-full object-cover pointer-events-none"
                />
                {on ? (
                  <span className="absolute right-0.5 top-0.5 rounded-full bg-sky-500 p-0.5 text-white">
                    <Check className="w-2.5 h-2.5" />
                  </span>
                ) : (
                  <span
                    className={`absolute left-0.5 top-0.5 rounded px-0.5 font-medium tabular-nums ${
                      isDarkMode ? 'bg-black/65 text-white/90' : 'bg-white/90 text-gray-700'
                    }`}
                    style={{ fontSize: 9 }}
                  >
                    {i + 1}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderVideoVersionPopover = (
    shotNo: string,
    versions: string[],
    currentUrl: string,
  ) => {
    if (videoPickerShotNo !== shotNo || versions.length < 2) return null;
    const currentKey = directorMediaUrlKey(currentUrl) || currentUrl;
    return (
      <div
        data-director-picker-keep="video"
        className={`absolute left-1/2 top-full z-[60] mt-1 w-[260px] -translate-x-1/2 rounded-lg border p-1.5 shadow-xl ${
          isDarkMode ? 'border-white/15 bg-zinc-950' : 'border-gray-200 bg-white'
        }`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={() => {
          clearVideoPickerLeaveTimer();
          openVideoVersionPicker(shotNo, versions.length);
        }}
        onMouseLeave={() => scheduleCloseVideoVersionPicker(shotNo)}
      >
        <div className="flex items-center justify-between gap-1 px-1 pb-1">
          <span className={mutedCls} style={{ fontSize: Math.max(10, fsChrome - 1) }}>
            {tt.videoPickVersion}
            <span className="ml-1 opacity-70">({versions.length})</span>
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 max-h-56 overflow-auto">
          {versions.map((u, i) => {
            const itemKey = directorMediaUrlKey(u) || u;
            const on = isDirectorShotVideoSelection(currentUrl, u) || (!!currentKey && itemKey === currentKey);
            const src = toElectronVideoElementSrc(u) || u;
            return (
              <button
                key={`${shotNo}-vid-${itemKey || i}`}
                type="button"
                className={`nodrag nopan relative overflow-hidden rounded-md ring-1 text-left ${
                  on
                    ? 'ring-sky-400'
                    : isDarkMode
                      ? 'ring-white/15 hover:ring-white/35'
                      : 'ring-gray-300 hover:ring-gray-400'
                }`}
                title={`${tt.videoPickVersion} ${i + 1}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  clearVideoPickerLeaveTimer();
                  if (!on) applyShotVideo(shotNo, u);
                }}
              >
                <video
                  key={src}
                  src={src}
                  className="aspect-video w-full object-cover bg-black/40 pointer-events-none"
                  muted
                  playsInline
                  preload="metadata"
                  draggable={false}
                  onLoadedMetadata={(e) => {
                    const v = e.currentTarget;
                    try {
                      const t =
                        Number.isFinite(v.duration) && v.duration > 0.6
                          ? Math.min(0.5, v.duration * 0.2)
                          : 0.1;
                      if (t > 0) v.currentTime = t;
                    } catch {
                      /* ignore */
                    }
                  }}
                />
                {on ? (
                  <span className="absolute right-0.5 top-0.5 rounded-full bg-sky-500 p-0.5 text-white pointer-events-none">
                    <Check className="w-2.5 h-2.5" />
                  </span>
                ) : null}
                <span
                  className={`absolute left-0.5 top-0.5 rounded px-0.5 font-medium tabular-nums pointer-events-none ${
                    isDarkMode ? 'bg-black/65 text-white/90' : 'bg-white/90 text-gray-700'
                  }`}
                  style={{ fontSize: 9 }}
                >
                  {i + 1}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const onUploadStoryboardClick = (shotNo: string) => {
    sbUploadShotNoRef.current = String(shotNo || '').trim();
    sbUploadInputRef.current?.click();
  };

  const onUploadStoryboardFile = async (file: File | null) => {
    const shotNo = sbUploadShotNoRef.current;
    sbUploadShotNoRef.current = null;
    if (!file || !shotNo) return;
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      });
      applyStoryboardImage(shotNo, dataUrl);
    } catch (e) {
      patch(
        updateDirectorShotStoryboard(directorStateRef.current, shotNo, {
          status: 'error',
          error: e instanceof Error ? e.message : 'upload failed',
        }),
      );
    }
  };

  const pickStoryboardFromCanvas = useCallback(
    async (shotNo: string) => {
      if (!data?.onPickImageFromCanvas) return;
      if (isNodeFullscreen) setIsNodeFullscreen(false);
      try {
        const url = await data.onPickImageFromCanvas();
        if (url) applyStoryboardImage(shotNo, url);
      } catch (e) {
        patch(
          updateDirectorShotStoryboard(directorStateRef.current, shotNo, {
            status: 'error',
            error: e instanceof Error ? e.message : tt.generateFailed,
          }),
        );
      }
    },
    [applyStoryboardImage, data, isNodeFullscreen, patch, tt.generateFailed],
  );

  const applyShotVideo = useCallback(
    (shotNo: string, url: string) => {
      const key = String(shotNo || '').trim();
      const videoUrl = String(url || '').trim();
      if (!key || !videoUrl) return;
      const prev = getDirectorShotStoryboard(directorStateRef.current, key);
      const prevUrl = String(prev?.videoUrl || '').trim();
      const prevKey = directorMediaUrlKey(prevUrl) || prevUrl;
      const nextKey = directorMediaUrlKey(videoUrl) || videoUrl;
      // 同一成片（仅 URL 形态不同）不重复写入，避免历史膨胀、列表假多份
      if (prevKey && nextKey && prevKey === nextKey) {
        if (String(prev?.videoStatus || '').trim() !== 'ready') {
          patch(
            updateDirectorShotStoryboard(directorStateRef.current, key, {
              videoUrl,
              videoStatus: 'ready',
              videoError: '',
            }),
          );
        }
        markVideoGenProgress(key, false);
        data?.onApplyShotVideoToSplice?.(key, videoUrl);
        return;
      }
      patch(
        updateDirectorShotStoryboard(directorStateRef.current, key, {
          videoUrl,
          videoStatus: 'ready',
          videoError: '',
        }),
      );
      markVideoGenProgress(key, false);
      data?.onApplyShotVideoToSplice?.(key, videoUrl);
    },
    [patch, data, markVideoGenProgress],
  );

  const onUploadShotVideoClick = (shotNo: string) => {
    videoUploadShotNoRef.current = String(shotNo || '').trim();
    videoUploadInputRef.current?.click();
  };

  const onUploadShotVideoFile = async (file: File | null, shotNoOverride?: string) => {
    const shotNo = String(shotNoOverride || videoUploadShotNoRef.current || '').trim();
    videoUploadShotNoRef.current = null;
    if (!file || !shotNo) return;
    if (!isDirectorShotVideoFile(file)) {
      showAlert(tt.shotVideoDropUnsupported);
      return;
    }
    const api = window.electronAPI;
    const projectId = data?.projectId || undefined;
    const filePath = String((file as File & { path?: string }).path || '').trim();
    const prevUrl = String(
      getDirectorShotStoryboard(directorStateRef.current, shotNo)?.videoUrl || '',
    ).trim();
    let videoUrl = '';
    try {
      // 拖入本地文件时优先按路径复制，避免整包 arrayBuffer 卡死
      if (filePath && api?.createVideoLocalResourceFromFile) {
        try {
          const r = await api.createVideoLocalResourceFromFile(projectId, filePath);
          videoUrl = String(r?.originalUrl || '').trim();
        } catch (e) {
          console.warn('[DirectorNode] createVideoLocalResourceFromFile 失败', e);
        }
      }
      if (!videoUrl && filePath && api?.copyFileToProjectAssets) {
        try {
          const { savedPath } = await api.copyFileToProjectAssets(projectId, filePath);
          videoUrl = `local-resource://${savedPath}`;
        } catch (e) {
          console.warn('[DirectorNode] copyFileToProjectAssets 失败', e);
        }
      }
      if (!videoUrl && api?.saveDroppedFileBufferToProjectAssets) {
        const buffer = await file.arrayBuffer();
        const { savedPath } = await api.saveDroppedFileBufferToProjectAssets(
          projectId,
          file.name || `shot-${shotNo}-video.mp4`,
          buffer,
        );
        videoUrl = `local-resource://${savedPath}`;
      }
    } catch (e) {
      console.warn('[DirectorNode] 上传成片失败', e);
    }
    if (!videoUrl) {
      try {
        videoUrl = URL.createObjectURL(file);
      } catch {
        patch(
          updateDirectorShotStoryboard(directorStateRef.current, shotNo, {
            videoStatus: 'error',
            videoError: tt.generateFailed,
          }),
        );
        return;
      }
    }
    if (prevUrl.startsWith('blob:') && prevUrl !== videoUrl) {
      try {
        URL.revokeObjectURL(prevUrl);
      } catch {
        /* ignore */
      }
    }
    applyShotVideo(shotNo, videoUrl);
  };

  const pickShotVideoFromCanvas = useCallback(
    async (shotNo: string) => {
      if (!data?.onPickVideoFromCanvas) return;
      if (isNodeFullscreen) setIsNodeFullscreen(false);
      try {
        const url = await data.onPickVideoFromCanvas();
        if (url) applyShotVideo(shotNo, url);
      } catch (e) {
        patch(
          updateDirectorShotStoryboard(directorStateRef.current, shotNo, {
            videoStatus: 'error',
            videoError: e instanceof Error ? e.message : tt.generateFailed,
          }),
        );
      }
    },
    [applyShotVideo, data, isNodeFullscreen, patch, tt.generateFailed],
  );

  const onUploadClick = (assetId: string) => {
    uploadAssetIdRef.current = String(assetId || '').trim() || null;
    uploadInputRef.current?.click();
  };

  const onUploadFile = async (file: File | null) => {
    const assetId = uploadAssetIdRef.current;
    uploadAssetIdRef.current = null;
    if (!file || !assetId) return;
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      });
      applyAssetImage(assetId, dataUrl);
    } catch (e) {
      patch(
        updateDirectorAsset(directorStateRef.current, assetId, {
          status: 'error',
          error: e instanceof Error ? e.message : 'upload failed',
        }),
      );
    }
  };

  const pickAssetFromCanvas = useCallback(
    async (assetId: string) => {
      if (!data?.onPickImageFromCanvas) return;
      if (isNodeFullscreen) setIsNodeFullscreen(false);
      try {
        const url = await data.onPickImageFromCanvas();
        if (url) applyAssetImage(assetId, url);
      } catch (e) {
        patch(
          updateDirectorAsset(directorStateRef.current, assetId, {
            status: 'error',
            error: e instanceof Error ? e.message : tt.generateFailed,
          }),
        );
      }
    },
    [applyAssetImage, data, isNodeFullscreen, patch, tt.generateFailed],
  );

  const openLibraryPick = useCallback(
    async (assetId: string, kind: 'character' | 'scene') => {
      setLibraryPick({ assetId, kind });
      setLibraryItems([]);
      setLibraryLoading(true);
      try {
        if (kind === 'character') {
          const list = await getCharactersCoalesced();
          setLibraryItems(
            list
              .map((c) => {
                const url = directorLibraryPreviewUrl(c.localAvatarPath, c.avatar);
                return {
                  id: c.id,
                  label: String(c.nickname || c.name || c.id).trim() || c.id,
                  url,
                };
              })
              .filter((x) => !!x.url),
          );
        } else {
          const list = (await window.electronAPI?.getScenes?.()) || [];
          setLibraryItems(
            list
              .map((s) => {
                const url = directorLibraryPreviewUrl(
                  s.localNormalImagePath || s.localAvatarPath,
                  s.normalImageUrl || s.avatar,
                );
                return {
                  id: s.id,
                  label: String(s.nickname || s.name || s.id).trim() || s.id,
                  url,
                };
              })
              .filter((x) => !!x.url),
          );
        }
      } catch {
        setLibraryItems([]);
      } finally {
        setLibraryLoading(false);
      }
    },
    [],
  );

  const addAsset = (kind: DirectorAssetKind) => {
    const listKey = directorAssetBagKey(kind);
    const empty = createEmptyDirectorAsset(kind, '', '', state.assets[listKey].length);
    if (kind === 'scene') {
      empty.prompt = ensureDirectorSceneBuiltinPrompt(empty.prompt);
    }
    const list = [...state.assets[listKey], empty];
    patch({
      ...state,
      assets: { ...state.assets, [listKey]: list },
    });
  };

  const applyStylePreset = (id: DirectorStylePresetId) => {
    const preset = getDirectorStylePreset(id);
    const nextStyle = id === 'custom' ? directorStateRef.current.globalStyle : preset.prompt;
    // 自定义：保留已上传参考图；从系统风格切到自定义时清空系统预设图
    const publicRef =
      id === 'custom'
        ? directorStateRef.current.stylePresetId === 'custom'
          ? String(directorStateRef.current.styleReferenceImageUrl || '').trim()
          : ''
        : directorStylePresetImageUrl(preset.imageFile);
    const base = {
      ...directorStateRef.current,
      stylePresetId: id,
      globalStyle: nextStyle,
      styleReferenceImageUrl: publicRef,
    };
    patch({
      ...base,
      shots: withComposedDirectorFinalPrompts(base.shots, nextStyle, true, {
        stylePresetId: id,
      }),
    });
    if (!publicRef || id === 'custom') return;
    void materializeStyleReferenceUrl(publicRef).then((localUrl) => {
      if (!localUrl || localUrl === publicRef) return;
      if (directorStateRef.current.stylePresetId !== id) return;
      patch({
        ...directorStateRef.current,
        styleReferenceImageUrl: localUrl,
      });
    });
  };

  const applyStyleReferenceImage = useCallback(
    (url: string) => {
      const nextUrl = String(url || '').trim();
      if (!nextUrl) return;
      const cur = directorStateRef.current;
      const nextStyle =
        String(cur.globalStyle || '').trim() ||
        (stylePromptEditId === 'custom' ? stylePromptDraft.trim() : '') ||
        cur.globalStyle;
      const base = {
        ...cur,
        stylePresetId: 'custom' as const,
        globalStyle: nextStyle,
        styleReferenceImageUrl: nextUrl,
      };
      patch({
        ...base,
        shots: withComposedDirectorFinalPrompts(base.shots, nextStyle, true, {
          stylePresetId: 'custom',
        }),
      });
    },
    [patch, stylePromptDraft, stylePromptEditId],
  );

  const clearStyleReferenceImage = useCallback(() => {
    const cur = directorStateRef.current;
    if (cur.stylePresetId !== 'custom') return;
    patch({
      ...cur,
      styleReferenceImageUrl: '',
    });
  }, [patch]);

  const onUploadStyleRefClick = useCallback(() => {
    styleRefUploadInputRef.current?.click();
  }, []);

  const onUploadStyleRefFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      try {
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('read failed'));
          reader.readAsDataURL(file);
        });
        if (dataUrl) applyStyleReferenceImage(dataUrl);
      } catch (e) {
        console.warn('[DirectorNode] 风格参考图上传失败', e);
        showAlert(e instanceof Error ? e.message : tt.generateFailed);
      }
    },
    [applyStyleReferenceImage, showAlert, tt.generateFailed],
  );

  const pickStyleRefFromCanvas = useCallback(async () => {
    if (!data?.onPickImageFromCanvas) return;
    if (isNodeFullscreen) setIsNodeFullscreen(false);
    try {
      const url = await data.onPickImageFromCanvas();
      if (url) applyStyleReferenceImage(url);
    } catch (e) {
      showAlert(e instanceof Error ? e.message : tt.generateFailed);
    }
  }, [applyStyleReferenceImage, data, isNodeFullscreen, showAlert, tt.generateFailed]);

  const clearStyleLongPressTimer = useCallback(() => {
    if (styleLongPressTimerRef.current != null) {
      clearTimeout(styleLongPressTimerRef.current);
      styleLongPressTimerRef.current = null;
    }
  }, []);

  const openStylePromptEditor = useCallback(
    (id: DirectorStylePresetId) => {
      const preset = getDirectorStylePreset(id);
      const current = directorStateRef.current;
      const draft =
        current.stylePresetId === id && String(current.globalStyle || '').trim()
          ? String(current.globalStyle)
          : String(preset.prompt || '');
      setStylePromptEditId(id);
      setStylePromptDraft(draft);
    },
    [],
  );

  const saveStylePromptEdit = useCallback(() => {
    if (!stylePromptEditId) return;
    const nextStyle = stylePromptDraft.trim();
    const preset = getDirectorStylePreset(stylePromptEditId);
    const styleReferenceImageUrl =
      stylePromptEditId === 'custom'
        ? String(directorStateRef.current.styleReferenceImageUrl || '').trim()
        : directorStylePresetImageUrl(preset.imageFile) ||
          String(directorStateRef.current.styleReferenceImageUrl || '').trim();
    const base = {
      ...directorStateRef.current,
      stylePresetId: stylePromptEditId,
      globalStyle: nextStyle,
      styleReferenceImageUrl,
    };
    patch({
      ...base,
      shots: withComposedDirectorFinalPrompts(base.shots, nextStyle, true, {
        stylePresetId: stylePromptEditId,
      }),
    });
    setStylePromptEditId(null);
  }, [stylePromptDraft, stylePromptEditId, patch]);

  useEffect(() => {
    if (!stylePromptEditId) return;
    const onDoc = (e: MouseEvent) => {
      const el = stylePickerRef.current;
      if (el && !el.contains(e.target as Node)) setStylePromptEditId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStylePromptEditId(null);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [stylePromptEditId]);

  useEffect(() => () => clearStyleLongPressTimer(), [clearStyleLongPressTimer]);

  const activeStylePresetId = normalizeDirectorStylePresetId(state.stylePresetId);
  const activeStyleRefUrl = resolveDirectorStyleReferenceImageUrl(
    state.stylePresetId,
    state.styleReferenceImageUrl,
  );

  const renderStylePicker = () => {
    const activeLabel =
      locale === 'en'
        ? getDirectorStylePreset(activeStylePresetId).labelEn
        : getDirectorStylePreset(activeStylePresetId).labelZh;
    const systemPresets = DIRECTOR_STYLE_PRESETS.filter((p) => p.id !== 'custom');
    const hasCustomStyle =
      activeStylePresetId === 'custom' &&
      (!!String(state.globalStyle || '').trim() || !!activeStyleRefUrl);
    const cardBorder = (active: boolean, editing: boolean) =>
      active || editing
        ? isDarkMode
          ? 'border-white ring-2 ring-white/80'
          : 'border-gray-400 ring-2 ring-gray-400/50'
        : isDarkMode
          ? 'border-transparent hover:border-white/35'
          : 'border-transparent hover:border-gray-400/50';

    const renderCustomCard = () => (
      <button
        type="button"
        className={`nodrag select-none relative overflow-hidden rounded-xl aspect-[16/10] border transition-all text-left ${
          hasCustomStyle
            ? cardBorder(true, stylePromptEditId === 'custom')
            : activeStylePresetId === 'custom' || stylePromptEditId === 'custom'
              ? isDarkMode
                ? 'border-white ring-2 ring-white/80 bg-white/[0.08] flex flex-col items-center justify-center gap-1'
                : 'border-gray-300 ring-2 ring-gray-400/40 bg-gray-200/80 flex flex-col items-center justify-center gap-1'
              : isDarkMode
                ? 'border-dashed border-white/25 bg-white/[0.04] text-white/70 hover:bg-white/[0.07] flex flex-col items-center justify-center gap-1'
                : 'border-dashed border-gray-300 bg-gray-100 text-gray-800 hover:bg-gray-200/70 flex flex-col items-center justify-center gap-1'
        }`}
        style={{ fontSize: fsChrome }}
        title={locale === 'en' ? 'Custom style' : '自定义风格'}
        onClick={(e) => {
          e.stopPropagation();
          openStylePromptEditor('custom');
          applyStylePreset('custom');
        }}
      >
        {hasCustomStyle ? (
          <>
            {activeStyleRefUrl ? (
              <img
                src={activeStyleRefUrl}
                alt={activeLabel}
                className="absolute inset-0 h-full w-full object-cover pointer-events-none"
                draggable={false}
              />
            ) : (
              <div
                className={`absolute inset-0 flex items-center justify-center px-2 text-center ${
                  isDarkMode ? 'bg-white/[0.06] text-white/70' : 'bg-gray-200/80 text-gray-800'
                }`}
              >
                <span className="line-clamp-3">{String(state.globalStyle || '').slice(0, 80)}</span>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/70 via-black/25 to-transparent px-1.5 pb-1.5 pt-5">
              <span className="text-white text-[11px] font-medium drop-shadow">
                {locale === 'en' ? 'Custom' : '自定义'}
              </span>
            </div>
          </>
        ) : (
          <>
            <Plus className="w-5 h-5 opacity-80" strokeWidth={2} />
            <span className="font-medium">{locale === 'en' ? 'Custom' : '自定义'}</span>
          </>
        )}
      </button>
    );

    return (
      <div
        ref={stylePickerRef}
        className="director-keep-visible relative flex flex-col flex-1 min-h-0 gap-2.5 w-full"
      >
        <div className="shrink-0 flex items-baseline justify-between gap-2">
          <h3 className={`font-semibold ${titleCls}`} style={{ fontSize: fsSmall + 1 }}>
            {tt.styleLibraryTitle}
          </h3>
          <span className={`truncate ${mutedCls}`} style={{ fontSize: fsChrome }}>
            {fillDirectorI18n(tt.styleLibrarySelected, { name: activeLabel })}
          </span>
        </div>

        <div className={`flex-1 min-h-0 overflow-y-auto nowheel pr-0.5 ${scrollCls}`}>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
            {renderCustomCard()}
            {systemPresets.map((preset) => {
              const active = activeStylePresetId === preset.id;
              const label = locale === 'en' ? preset.labelEn : preset.labelZh;
              const editing = stylePromptEditId === preset.id;
              const thumb = directorStylePresetImageUrl(preset.imageFile);
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`nodrag select-none relative overflow-hidden rounded-xl aspect-[16/10] border transition-all text-left ${cardBorder(active, editing)}`}
                  title={`${label} · ${tt.styleLongPressHint}`}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    styleLongPressFiredRef.current = false;
                    clearStyleLongPressTimer();
                    styleLongPressTimerRef.current = setTimeout(() => {
                      styleLongPressFiredRef.current = true;
                      styleLongPressTimerRef.current = null;
                      openStylePromptEditor(preset.id);
                    }, 480);
                  }}
                  onPointerUp={clearStyleLongPressTimer}
                  onPointerLeave={clearStyleLongPressTimer}
                  onPointerCancel={clearStyleLongPressTimer}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    clearStyleLongPressTimer();
                    styleLongPressFiredRef.current = true;
                    openStylePromptEditor(preset.id);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (styleLongPressFiredRef.current) {
                      styleLongPressFiredRef.current = false;
                      return;
                    }
                    applyStylePreset(preset.id);
                  }}
                >
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={label}
                      className="absolute inset-0 h-full w-full object-cover pointer-events-none"
                      draggable={false}
                    />
                  ) : (
                    <div className={`absolute inset-0 ${isDarkMode ? 'bg-white/5' : 'bg-gray-100'}`} />
                  )}
                  <div className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/70 via-black/25 to-transparent px-1.5 pb-1.5 pt-5">
                    <span className="text-white text-[11px] font-medium drop-shadow text-center line-clamp-1">
                      {label}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {stylePromptEditId ? (
          <div
            className={`nodrag nowheel shrink-0 w-full rounded-xl px-3 py-2.5 shadow-xl ring-1 ${
              isDarkMode ? 'bg-zinc-900 ring-white/15' : 'bg-gray-100 ring-gray-200'
            }`}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className={`mb-1.5 flex items-center justify-between gap-2 ${mutedCls}`} style={{ fontSize: fsChrome }}>
              <span>
                {tt.stylePromptEditTitle}
                <span className={`ml-1.5 ${bodyCls}`}>
                  ·{' '}
                  {locale === 'en'
                    ? getDirectorStylePreset(stylePromptEditId).labelEn
                    : getDirectorStylePreset(stylePromptEditId).labelZh}
                </span>
              </span>
              <button
                type="button"
                className={`nodrag rounded-md px-1.5 py-0.5 transition-colors ${
                  isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                }`}
                onClick={() => setStylePromptEditId(null)}
                aria-label={tt.stylePromptCancel}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {stylePromptEditId === 'custom' ? (
              <div className="mb-2 flex items-start gap-2.5">
                <div
                  className={`relative h-[72px] w-[112px] shrink-0 overflow-hidden rounded-md border ${
                    isDarkMode ? 'border-white/15 bg-black/35' : 'border-gray-200 bg-gray-100'
                  }`}
                >
                  {activeStyleRefUrl ? (
                    <img
                      src={activeStyleRefUrl}
                      alt={tt.styleRefImageLabel}
                      className="h-full w-full object-cover pointer-events-none"
                      draggable={false}
                    />
                  ) : (
                    <div
                      className={`flex h-full w-full items-center justify-center px-1 text-center ${mutedCls}`}
                      style={{ fontSize: fsChrome }}
                    >
                      {tt.styleRefImageLabel}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    className={`nodrag inline-flex items-center gap-1 rounded-md px-2 py-1 transition-colors ${
                      isDarkMode
                        ? 'bg-white/10 text-white/85 hover:bg-white/15'
                        : 'bg-gray-200/80 text-gray-800 hover:bg-gray-300/80'
                    }`}
                    style={{ fontSize: fsChrome }}
                    title={tt.uploadLocal}
                    onClick={(e) => {
                      e.stopPropagation();
                      onUploadStyleRefClick();
                    }}
                  >
                    <Upload className="w-3.5 h-3.5 shrink-0" strokeWidth={2.25} />
                    {tt.uploadLocal}
                  </button>
                  {data?.onPickImageFromCanvas ? (
                    <button
                      type="button"
                      className={`nodrag inline-flex items-center gap-1 rounded-md px-2 py-1 transition-colors ${
                        isDarkMode
                          ? 'bg-white/10 text-white/85 hover:bg-white/15'
                          : 'bg-gray-200/80 text-gray-800 hover:bg-gray-300/80'
                      }`}
                      style={{ fontSize: fsChrome }}
                      title={tt.pickFromCanvas}
                      onClick={(e) => {
                        e.stopPropagation();
                        void pickStyleRefFromCanvas();
                      }}
                    >
                      <MousePointerClick className="w-3.5 h-3.5 shrink-0" strokeWidth={2.25} />
                      {tt.pickFromCanvas}
                    </button>
                  ) : null}
                  {activeStyleRefUrl ? (
                    <button
                      type="button"
                      className={`nodrag rounded-md px-2 py-1 transition-colors ${
                        isDarkMode ? 'text-white/55 hover:bg-white/10' : 'text-gray-600 hover:bg-gray-200/70'
                      }`}
                      style={{ fontSize: fsChrome }}
                      onClick={(e) => {
                        e.stopPropagation();
                        clearStyleReferenceImage();
                      }}
                    >
                      {tt.styleRefImageClear}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <textarea
              className={`nodrag nowheel w-full min-h-[72px] max-h-[140px] resize-y rounded-md px-2.5 py-2 leading-relaxed outline-none focus:ring-1 ${
                isDarkMode
                  ? 'bg-black/35 text-white/85 focus:ring-blue-500/30'
                  : 'bg-gray-100 text-gray-800 border border-gray-200 focus:ring-gray-400/40'
              } ${scrollCls}`}
              style={{ fontSize: fsSmall }}
              value={stylePromptDraft}
              placeholder={tt.styleCustomHint}
              autoFocus
              onChange={(e) => setStylePromptDraft(e.target.value)}
            />
            <div className="mt-2 flex justify-end gap-1.5">
              <button
                type="button"
                className={`nodrag rounded-md px-2.5 py-1 transition-colors ${
                  isDarkMode ? 'text-white/60 hover:bg-white/10' : 'text-gray-600 hover:bg-gray-100'
                }`}
                style={{ fontSize: fsChrome }}
                onClick={() => setStylePromptEditId(null)}
              >
                {tt.stylePromptCancel}
              </button>
              <button
                type="button"
                className={`nodrag rounded-md px-2.5 py-1 font-medium transition-colors ${
                  isDarkMode
                    ? 'bg-sky-500/30 text-sky-100 hover:bg-sky-500/40'
                    : 'bg-gray-700 text-white hover:bg-gray-800'
                }`}
                style={{ fontSize: fsChrome }}
                onClick={saveStylePromptEdit}
              >
                {tt.stylePromptSave}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  const goDirectorPhase = useCallback(
    (phase: DirectorPhase) => {
      const __perfPhaseSync0 = performance.now();
      let next = setDirectorPhase(directorStateRef.current, phase);
      if (isMvMode && phase === 'cast') {
        next = applyAutoDirectorMvCastPlan(next);
      }
      if (isMvMode && phase === 'assets') {
        next = syncDirectorMvScenesFromScript(
          setDirectorAssetsStep(next, 'scenes'),
          'fill',
        );
      }
      if (isDramaMode && phase === 'assets') {
        next = syncDirectorMvCastFromScript(next, 'fill');
        next = syncDirectorMvScenesFromScript(
          setDirectorAssetsStep(next, 'characters'),
          'fill',
        );
      }
      if (isDramaMode && (phase === 'shots' || phase === 'board')) {
        const __tEnsure0 = performance.now();
        next = ensureDirectorDramaShotsFromScript(next, { keepPhase: true });
        next = setDirectorPhase(next, 'board');
        console.log(
          `[perf] goDirectorPhase(${phase}) ensureShots(ms) ${(performance.now() - __tEnsure0).toFixed(1)}`,
        );
      }
      if (isDramaMode && (phase === 'storyboards' || phase === 'videos')) {
        const locked =
          coerceDirectorMvAspectRatio(next.mvAspectRatio || next.videoBatchAspectRatio) || '9:16';
        const model = normalizeDirectorVideoBatchModel(
          next.videoBatchModel || videoBatchModel || 'minimax-h3-multi',
        );
        const nextAspect = normalizeDirectorVideoBatchAspect(model, locked);
        next = {
          ...next,
          phase: 'videos',
          mvAspectRatio: locked,
          videoBatchAspectRatio: nextAspect,
          videoBatchModel: model.includes('minimax') ? model : 'minimax-h3-multi',
          shots: (next.shots || []).map((shot) => {
            if (!shouldAutoSyncDirectorFinalPrompt(shot['最终提示词'])) return shot;
            const videoPrompt = resolveDirectorShotVideoPromptForGen(shot, { lipsync: false });
            if (!videoPrompt) return shot;
            return { ...shot, 最终提示词: videoPrompt };
          }),
        };
      }
      if (isDramaMode && phase === 'story') {
        next = setDirectorPhase(next, 'analyze');
      }
      if (
        isMvMode &&
        phase === 'shots' &&
        (next.mvMusic?.lyricSegments || []).length > 0
      ) {
        next = syncDirectorShotsToLyricTimeline(next);
      }
      if (isMvMode && phase === 'videos') {
        const locked =
          coerceDirectorMvAspectRatio(next.mvAspectRatio || next.videoBatchAspectRatio) || '16:9';
        const model = normalizeDirectorVideoBatchModel(next.videoBatchModel || videoBatchModel);
        const nextAspect = normalizeDirectorVideoBatchAspect(model, locked);
        const ranges = computeDirectorShotMusicRangesFromState(next);
        const packs =
          (next.mvMusic?.lyricSegments || []).length > 0
            ? packLyricSegmentsIntoShotPacks(next.mvMusic!.lyricSegments!, {
                clipLengthMode: next.mvMusic?.clipLengthMode,
              })
            : [];
        const songDur = Number(next.mvMusic?.durationSec) || 0;
        next = {
          ...next,
          mvAspectRatio: locked,
          videoBatchAspectRatio: nextAspect,
          videoBatchLipsyncModel: resolveDirectorMvLipsyncModel(next.videoBatchLipsyncModel),
          shots: (next.shots || []).map((shot, rowIndex) => {
            const shotNo = String(shot['镜号'] || rowIndex + 1);
            const sb = getDirectorShotStoryboard(next, shotNo);
            const range = ranges[rowIndex] || {
              startSec: 0,
              endSec: parseDirectorShotDurationSec(shot['时长'], 5),
              durationSec: parseDirectorShotDurationSec(shot['时长'], 5),
            };
            const hasVoice = shotAudioRangeHasHumanVoice(
              next.mvMusic?.lyricSegments,
              range.startSec,
              range.endSec,
            );
            const lipsync = resolveDirectorMvForceLipsyncOn(
              true,
              resolveDirectorShotPreferLipsync(shot, sb, {
                hasHumanVoice: hasVoice,
                packText: packs[rowIndex]?.text || String(shot['对白旁白'] || ''),
                audioStartSec: range.startSec,
                songDurationSec: songDur,
                closeUpFramingOn: next.mvCloseUpFraming !== false,
              }),
            );
            // 进入视频步：只填空/占位；保留分镜步已写好的最终提示词（用户可继续改）
            if (!shouldAutoSyncDirectorFinalPrompt(shot['最终提示词'])) return shot;
            const videoPrompt = resolveDirectorShotVideoPromptForGen(shot, { lipsync });
            if (!videoPrompt) return shot;
            return { ...shot, 最终提示词: videoPrompt };
          }),
        };
      }
      // 用户点步骤/下一步：同步 patch，避免 startTransition 在负载下像「点了没反应」
      const __tPatch0 = performance.now();
      patch(next);
      console.log(
        `[perf] goDirectorPhase(${phase}) patch(ms) ${(performance.now() - __tPatch0).toFixed(1)}`,
      );
      console.log(
        `[perf] goDirectorPhase(${phase}) sync+patch同步耗时(ms) ${(performance.now() - __perfPhaseSync0).toFixed(1)}`,
      );
      // 短剧 V2：顶栏切步时同步 Domain phase（内容面板读 session.meta.phase）
      if (isDramaMode) {
        const domain = (dataRef.current?.directorDomain as DramaDirectorSession | null) || null;
        if (domain) {
          const raw = String(next.phase || 'analyze');
          let domainPhase =
            raw === 'ingest' || raw === 'split'
              ? 'ingest'
              : raw === 'episodes' || raw === 'episode_pick' || raw === 'select'
                ? 'episodes'
                : raw === 'visual' || raw === 'visual_tuning' || raw === 'visualTuning'
                  ? 'visual'
                  : raw === 'story' || raw === 'analyze'
                    ? 'analyze'
                    : raw === 'bible' || raw === 'assets'
                      ? 'assets'
                      : raw === 'board' ||
                          raw === 'shots' ||
                          raw === 'prompts' ||
                          raw === 'storyboards' ||
                          raw === 'videos'
                        ? 'board'
                        : raw === 'review' || raw === 'preview'
                          ? 'review'
                          : 'ingest';
          let nextDomain = setDramaSessionPhase(domain, domainPhase);
          // 用户阶段门禁：未确认则回退
          const targetUser = domainPhaseToUserPhase(domainPhase);
          const gate = canEnterDramaUserPhase(domain, targetUser);
          if (!gate.ok) {
            void showAlert(gate.reason);
            domainPhase = preferredDomainPhaseForUserPhase(gate.fallback, domain);
            nextDomain = setDramaSessionPhase(domain, domainPhase);
            next = setDirectorPhase(next, domainPhase as DirectorPhase);
            patch(next);
          }
          if (domainPhase === 'board' && !isDramaAssetsConfirmed(nextDomain)) {
            nextDomain = confirmDramaAssets(nextDomain);
          }
          if (domainPhase === 'board' || domainPhase === 'review') {
            const __tCont0 = performance.now();
            nextDomain = refreshDramaContinuity(nextDomain);
            console.log(
              `[perf] goDirectorPhase(${domainPhase}) refreshContinuity(ms) ${(performance.now() - __tCont0).toFixed(1)}`,
            );
          }
          // packages/reviews 出片/审核时才重建；不再深重建 session，避免顶栏切步卡顿
          const __tUpdate0 = performance.now();
          dataRef.current?.onUpdate?.({
            directorDomain: nextDomain,
          });
          console.log(
            `[perf] goDirectorPhase(${domainPhase}) onUpdate(ms) ${(performance.now() - __tUpdate0).toFixed(1)}`,
          );
          // [perf] 测量「点下去→画面真正刷新完」耗时（渲染阶段异步、无日志，用双 RAF 量）
          const __perfPhaseRenderT0 = performance.now();
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              console.log(
                `[perf] goDirectorPhase(${domainPhase})→首帧渲染完成(ms) ${(performance.now() - __perfPhaseRenderT0).toFixed(1)}`,
              );
            });
          });
        }
      }
    },
    [isDramaMode, isMvMode, patch, videoBatchModel, showAlert],
  );

  /** 是否已有可作卡拉OK底片的成片（镜内 / 合成缓存 / 用户上传） */
  const hasDirectorKaraokeVideoSource = useCallback((st: DirectorPipelineState) => {
    const d = dataRef.current as DirectorNodeData | undefined;
    if (String(d?.karaokeComposedVideoUrl || '').trim()) return true;
    if (String(d?.karaokeProject?.videoUrl || '').trim()) return true;
    return (st.shots || []).some((s, i) => {
      const no = String(s['镜号'] || i + 1);
      const sb = getDirectorShotStoryboard(st, no);
      return !!String(sb.videoUrl || '').trim() || sb.videoStatus === 'ready';
    });
  }, []);

  /**
   * 进入第 8 步：无成片时明确确认（勿静默）；仍允许进入调歌词。
   * 有歌词+音频才放行，否则 alert。
   */
  const goMvKaraokePhase = useCallback(async () => {
    const cur = directorStateRef.current;
    const lyrics = String(cur.mvMusic?.lyrics || '').trim();
    const audio = String(cur.mvMusic?.url || '').trim();
    if (!lyrics || !audio) {
      showAlert(tt.karaokeNeedMusicLyrics);
      return;
    }
    if (!hasDirectorKaraokeVideoSource(cur)) {
      const ok = await showConfirm(tt.confirmEnterKaraokeWithoutVideos);
      if (!ok) return;
    }
    goDirectorPhase('karaoke');
  }, [
    goDirectorPhase,
    hasDirectorKaraokeVideoSource,
    showAlert,
    showConfirm,
    tt.confirmEnterKaraokeWithoutVideos,
    tt.karaokeNeedMusicLyrics,
  ]);

  const phaseBtn = (
    phase: DirectorPhase,
    label: string,
    sub: string,
    active: boolean,
    done: boolean,
    scratch: ScratchColorId,
  ) => (
    <button
      type="button"
      className={`director-keep-visible nodrag flex-1 min-w-0 rounded-md px-2 py-1.5 text-left transition-colors ${
        active
          ? isDarkMode
            ? 'bg-blue-500/15 text-sky-100'
            : `${floatToolBtn(scratch, true, '!w-full !justify-start !rounded-md !px-2 !py-1.5')}`
          : isDarkMode
            ? 'text-white/50 hover:bg-white/[0.04] hover:text-white/80'
            : 'text-gray-700 bg-gray-100 border border-gray-200 hover:bg-gray-200/70'
      }`}
      style={{ fontSize: fsChrome }}
      onClick={() => goDirectorPhase(phase)}
    >
      <div className="font-medium truncate flex items-center gap-1" style={{ fontSize: fsSmall }}>
        {done && !active ? (
          <Check className={`w-3.5 h-3.5 ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`} />
        ) : null}
        {label}
      </div>
      <div className="opacity-70 truncate" style={{ fontSize: fsChrome }}>
        {sub}
      </div>
    </button>
  );

  const mvCastCount = state.assets.characters.length;
  const mvCastReady = state.assets.characters.filter((a) => String(a.imageUrl || '').trim()).length;
  const mvScriptSections = normalizeDirectorMvScriptSections(state.mvStoryAnalysis?.sections);
  const mvStoryChipSub = (() => {
    const plot = String(mvScriptSections.plot || '').trim();
    if (plot) return `${plot.slice(0, 12)}${plot.length > 12 ? '…' : ''}`;
    const chars = String(mvScriptSections.characters || '').trim();
    if (chars) return tt.storySectionCharacters;
    const plain = String(state.scriptText || '').trim();
    if (plain && !plain.startsWith('{')) {
      return `${plain.slice(0, 12)}${plain.length > 12 ? '…' : ''}`;
    }
    if (String(state.mvStoryAnalysis?.summary || '').trim()) return tt.storyAnalyzeTitle;
    return tt.storyHint.slice(0, 16);
  })();

  const goMvCastPhase = useCallback(() => {
    let next = setDirectorPhase(directorStateRef.current, 'cast');
    next = applyAutoDirectorMvCastPlan(next);
    patch(next);
  }, [patch]);

  const goMvStoryPhase = useCallback(() => {
    patch(setDirectorPhase(directorStateRef.current, 'story'));
  }, [patch]);

  const goMvStylePhase = useCallback(() => {
    patch(setDirectorPhase(directorStateRef.current, 'style'));
  }, [patch]);
  const syncMvCastFromScript = useCallback(
    (mode: 'fill' | 'replace' = 'replace') => {
      let next = syncDirectorMvCastFromScript(directorStateRef.current, mode);
      next = ensureDirectorMvLeadSlots(next);
      const n = parseDirectorMvCharacterEntries(getDirectorMvCharactersSectionText(next)).length;
      if (!n && (next.assets.characters || []).length === 0) {
        showAlert(tt.castNeedScriptCharacters);
        return;
      }
      patch(next);
    },
    [patch, showAlert, tt.castNeedScriptCharacters],
  );

  type PhaseStepItem = {
    phase: DirectorPhase;
    label: string;
    sub: string;
    done: boolean;
  };

  const renderMvPhaseStepper = (steps: PhaseStepItem[]) => {
    const activeIdx = Math.max(
      0,
      steps.findIndex((s) => s.phase === state.phase),
    );
    const stepFs = isNodeFullscreen ? Math.max(13, fsSmall) : fsChrome;
    const badgeFs = isNodeFullscreen ? Math.max(12, fsChrome) : fsChrome;
    return (
      <div className="director-keep-visible w-full min-w-0">
        <div
          className={`nowheel flex w-full items-center gap-0 overflow-x-auto rounded-2xl border px-1 py-1.5 ${
            isDarkMode ? 'border-white/10 bg-white/[0.04]' : 'border-gray-200 bg-gray-100'
          }`}
        >
          {steps.map((s, i) => {
            const activeStep = s.phase === state.phase;
            const past = i < activeIdx || (s.done && !activeStep);
            return (
              <button
                key={s.phase}
                type="button"
                title={`${s.label}${s.sub ? ` · ${s.sub}` : ''}`}
                aria-current={activeStep ? 'step' : undefined}
                className={`nodrag min-w-0 flex-1 flex items-center justify-center gap-1.5 px-1 py-1.5 rounded-xl text-center transition-colors ${
                  activeStep
                    ? isDarkMode
                      ? 'bg-sky-500/20'
                      : 'bg-sky-100/90'
                    : isDarkMode
                      ? 'hover:bg-white/[0.04]'
                      : 'hover:bg-gray-200/70'
                }`}
                onClick={() => {
                  if (s.phase === 'karaoke') {
                    void goMvKaraokePhase();
                    return;
                  }
                  goDirectorPhase(s.phase);
                }}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-semibold tabular-nums leading-none ${
                    activeStep
                      ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/30'
                      : past
                        ? isDarkMode
                          ? 'bg-emerald-500/85 text-white'
                          : 'bg-emerald-500 text-white'
                        : isDarkMode
                          ? 'bg-white/10 text-white/50'
                          : 'bg-gray-200/90 text-gray-500'
                  }`}
                  style={{ fontSize: badgeFs }}
                >
                  {past && !activeStep ? <Check className="w-3 h-3" strokeWidth={2.5} /> : i + 1}
                </span>
                <span
                  className={`min-w-0 font-medium leading-tight truncate ${
                    activeStep
                      ? isDarkMode
                        ? 'text-sky-200'
                        : 'text-sky-600'
                      : isDarkMode
                        ? 'text-white/85'
                        : 'text-gray-900'
                  }`}
                  style={{ fontSize: stepFs }}
                >
                  {s.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderDramaStudioV2 = () => {
    const domainSession =
      (data?.directorDomain as DramaDirectorSession | null | undefined) || null;
    const missingAssetImages = (() => {
      if (!domainSession?.bible) return 0;
      const b = domainSession.bible;
      return (
        b.characters.filter((c) => !String(c.imageUrl || '').trim()).length +
        b.scenes.filter((s) => !String(s.imageUrl || '').trim()).length +
        b.props.filter((p) => !String(p.imageUrl || '').trim()).length +
        b.creatures.filter((c) => !String(c.imageUrl || '').trim()).length
      );
    })();
    const unitPrice = formatYuanbaoLabel(1);
    const batchPrice =
      missingAssetImages > 0 ? formatYuanbaoLabel(missingAssetImages) : unitPrice;
    const missingVoices = (domainSession?.bible?.voices || []).filter(
      (v) => !String(v.sample_url || '').trim(),
    ).length;
    const unitVoiceYuan = getAudioDisplayPrice(DOUBAO_SEED_AUDIO_MODEL_ID, cloudMap);
    const batchVoiceYuan = getAudioDisplayPrice(
      DOUBAO_SEED_AUDIO_MODEL_ID,
      cloudMap,
      Math.max(1, missingVoices),
    );
    const voiceCredits = (y: number) =>
      locale === 'en' ? `${y} ${tt.creditsSuffix}` : `${y}${tt.creditsSuffix}`;
    const unitVoicePriceLabel =
      unitVoiceYuan == null
        ? null
        : locale === 'en'
          ? `Doubao Audio 1.0 · ${voiceCredits(unitVoiceYuan)}`
          : `豆包音频 1.0 · ${voiceCredits(unitVoiceYuan)}`;
    const batchVoicePriceLabel =
      unitVoiceYuan == null
        ? null
        : missingVoices > 1 && batchVoiceYuan != null
          ? locale === 'en'
            ? `Doubao Audio 1.0 · ${missingVoices} clips · ${voiceCredits(batchVoiceYuan)}`
            : `豆包音频 1.0 · ${missingVoices}条 · ${voiceCredits(batchVoiceYuan)}`
          : unitVoicePriceLabel;

    return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      style={
        /* 全屏门户里 CSS zoom 会让 Chromium 把 <video> 合成成黑块；字号已由门户 fontSize 接管 */
        isNodeFullscreen
          ? undefined
          : { zoom: fontSizePx / DIRECTOR_FONT_DEFAULT }
      }
    >
    <DramaStudioHost
      projectId={data?.projectId}
      pipeline={state}
      session={domainSession}
      isDark={isDarkMode}
      busy={
        (!!busyAction && busyAction !== 'images' && busyAction !== 'storyboards') ||
        !!state.isGenerating ||
        !!data?.isGenerating
      }
      chatModel={String(state.chatModel || '')}
      chatModelSelectSlot={renderChatModelSelect({
        variant: 'plain',
        menuPlacement: 'up',
        disabled: isDirectorHardBusy,
      })}
      imageGenToolbarSlot={renderImageGenControls({ compact: true })}
      storyboardImageGenSlot={renderImageGenControls({ compact: true, forStoryboard: true })}
      unitImagePriceLabel={unitPrice}
      unitChatPriceLabel={
        chatRunYuanbao != null
          ? locale === 'en'
            ? `${chatRunYuanbao} ${tt.creditsSuffix}`
            : `${chatRunYuanbao}${tt.creditsSuffix}`
          : null
      }
      batchImagePriceLabel={batchPrice}
      onSessionChange={(next) => {
        const cur = dataRef.current;
        if (cur) dataRef.current = { ...cur, directorDomain: next };
        dataRef.current?.onUpdate?.({ directorDomain: next });
      }}
      onPipelinePatch={(next) => patch(next)}
      runChat={runChat}
      onSpawnVideos={(opts) => {
        const domain = (dataRef.current?.directorDomain as DramaDirectorSession | null) || null;
        const requestedNos = (opts?.shotNos || []).map((n) => String(n || '').trim()).filter(Boolean);
        const genStartedAt = Date.now();
        // 短剧重生成：投影前先钉画布表 generating，避免旧 ready + 空 startedAt 把绿条对账清掉
        {
          let nextBoard = directorStateRef.current;
          const nos =
            requestedNos.length > 0
              ? requestedNos
              : (domain?.shots || [])
                  .map((s) => String(s.shot_no || '').trim())
                  .filter(Boolean);
          for (const no of nos) {
            markVideoGenProgress(no, true);
            const sb = getDirectorShotStoryboard(nextBoard, no);
            nextBoard = updateDirectorShotStoryboard(nextBoard, no, {
              videoStatus: 'generating',
              videoError: '',
              videoGeneratingStartedAt:
                Number(sb.videoGeneratingStartedAt) > 0
                  ? Number(sb.videoGeneratingStartedAt)
                  : genStartedAt,
            });
          }
          if (nos.length) patch(nextBoard);
        }
        if (domain?.shots?.length) {
          const projected = projectDramaSessionToPipeline(domain, directorStateRef.current);
          const cur = dataRef.current;
          if (cur) {
            dataRef.current = { ...cur, directorDomain: domain, director: projected };
          }
          patch(projected);
        }
        void Promise.resolve(data?.onSpawnVideos?.(opts)).then((result) => {
          const r = result as { spawned?: number; reason?: string } | void;
          const spawned = Number(r?.spawned || 0);
          if (spawned > 0) return;
          const nos = requestedNos.length > 0 ? requestedNos : [];
          if (!nos.length) return;
          // 未真正建出视频任务：立刻清绿条，避免 UI「生成中」但平台无请求
          for (const no of nos) abandonVideoWait(no);
          if (!r?.reason) {
            console.warn('[Director] onSpawnVideos returned spawned=0 without reason', {
              nos,
              result: r,
            });
          }
        });
      }}
      getShotVideoPriceLabel={(durationSec, opts) => {
        const model = String(opts?.model || '').trim();
        const priced = videoGenYuanbaoForShot({
          preferLipsync: opts?.preferLipsync ?? model.includes('audio'),
          durationSec,
          model: model || undefined,
        });
        return priced?.label || null;
      }}
      videoGeneratingIds={videoGenProgressIds}
      onMarkVideoGenerating={markVideoGenProgress}
      onAbandonVideoWait={abandonVideoWait}
      showAlert={(msg) => {
        void showAlert(msg);
      }}
      canPickFromCanvas={!!data?.onPickImageFromCanvas}
      onGenerateAssetImage={(kind, assetId) => {
        const asset = ensureDramaPipelineAsset(kind, assetId);
        if (!asset) {
          void showAlert(tt.generateFailed);
          return;
        }
        // 无云端价：只提示登录，不进入 generating、不入队
        if (imageGenYuanbao(1) == null) {
          void showAlert(tt.otsPriceRequired);
          return;
        }
        // 先标 Domain generating + 即时绿条，再入队（避免对账空窗把进度抹掉）
        markImageGenProgress(asset.id, true);
        syncDomainAssetImage(assetId, { status: 'generating' });
        generateOneAsset(asset);
      }}
      onGenerateShotStoryboard={(shotNo, opts) => {
        enqueueStoryboardShots([String(shotNo || '').trim()], {
          onlyMissing: opts?.force ? false : true,
        });
      }}
      onUploadAssetImage={(kind, assetId, file) => {
        void (async () => {
          ensureDramaPipelineAsset(kind, assetId);
          // 上传前标记 generating：绿条 + Domain generating，与 AI 生成一致
          markImageGenProgress(assetId, true);
          syncDomainAssetImage(assetId, { status: 'generating' });
          try {
            // 存文件拿 local-resource:// 路径，避免把 base64 塞进 session 导致卡顿/OOM
            const buf = await file.arrayBuffer();
            const pid = String(data?.projectId || dataRef.current?.projectId || '').trim();
            if (!pid) throw new Error('项目未打开，无法保存图片');
            const res = await window.electronAPI.directorV2SaveAssetFile(pid, {
              kind: 'image',
              filename: file.name,
              mime: file.type,
              data: buf,
            });
            if (!res?.ok || !res.url) throw new Error(res?.error || '保存图片失败');
            applyAssetImage(assetId, res.url);
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'upload failed';
            if (findDirectorAssetById(directorStateRef.current.assets, assetId)) {
              patch(
                updateDirectorAsset(directorStateRef.current, assetId, {
                  status: 'error',
                  error: msg,
                }),
              );
            }
            syncDomainAssetImage(assetId, { status: 'error', error: msg });
          } finally {
            markImageGenProgress(assetId, false);
          }
        })();
      }}
      onPickAssetFromCanvas={(kind, assetId) => {
        ensureDramaPipelineAsset(kind, assetId);
        void pickAssetFromCanvas(assetId);
      }}
      onClearAssetImage={(_kind, assetId) => {
        clearAssetImage(assetId);
      }}
      assetGeneratingIds={{ ...imageGenProgressIds, ...voiceGenProgressIds }}
      unitVoicePriceLabel={unitVoicePriceLabel}
      batchVoicePriceLabel={batchVoicePriceLabel}
      canPickVoiceFromCanvas={!!data?.onPickAudioFromCanvas}
      onGenerateVoice={(voiceId) => startVoiceSampleGens([voiceId])}
      onGenerateVoices={(voiceIds) => startVoiceSampleGens(voiceIds)}
      onUploadVoice={(voiceId, file) => {
        void (async () => {
          try {
            const buf = await file.arrayBuffer();
            const res = await window.electronAPI.directorV2SaveAssetFile(String(data?.projectId || ''), {
              kind: 'audio',
              filename: file.name,
              mime: file.type,
              data: buf,
            });
            if (!res?.ok || !res.url) throw new Error(res?.error || '保存声音失败');
            syncDomainVoiceSample(voiceId, {
              sampleUrl: res.url,
              status: 'ready',
            });
          } catch (e) {
            syncDomainVoiceSample(voiceId, {
              status: 'error',
              error: e instanceof Error ? e.message : 'upload failed',
            });
          }
        })();
      }}
      onPickVoiceFromCanvas={(voiceId) => {
        void (async () => {
          if (!data?.onPickAudioFromCanvas) return;
          if (isNodeFullscreen) setIsNodeFullscreen(false);
          try {
            const picked = await data.onPickAudioFromCanvas();
            const url = String(picked?.url || '').trim();
            if (!url) return;
            syncDomainVoiceSample(voiceId, {
              sampleUrl: url,
              status: 'ready',
            });
          } catch (e) {
            syncDomainVoiceSample(voiceId, {
              status: 'error',
              error: e instanceof Error ? e.message : tt.generateFailed,
            });
          }
        })();
      }}
      onVideosToSplice={handleVideosToSpliceClick}
      onApplyShotVideoToSplice={data?.onApplyShotVideoToSplice}
      onGenerateShotAudio={(shotId) => {
        void (async () => {
          const domain = (dataRef.current?.directorDomain as DramaDirectorSession | null) || null;
          if (!domain) {
            void showAlert(tt.generateFailed);
            return;
          }
          const shot = domain.shots.find((s) => s.shot_id === shotId);
          if (!shot) {
            void showAlert(tt.generateFailed);
            return;
          }
          if (!dramaShotNeedsAudioContent(shot)) {
            void showAlert(
              locale === 'en'
                ? 'Add dialogue or SFX for this shot first'
                : '这一镜还没写内容哦～先填上对白、旁白或者环境音效，才能生成声音。',
            );
            return;
          }
          if (String(shot.audio_status || '') === 'generating') {
            void showAlert(locale === 'en' ? 'Shot audio is generating' : '正在拼命生成中啦，稍等一下～');
            return;
          }
          if (!window.electronAPI?.invokeAI) {
            void showAlert(tt.generateFailed);
            return;
          }
          const refs = collectDramaShotVoiceRefUrls(domain, shot, 3);
          const hasDlg = dramaShotHasSpokenDialogue(shot);
          const onlySystemDlg = dramaShotHasOnlySystemDialogue(domain, shot);
          if (hasDlg && refs.length === 0 && !onlySystemDlg) {
            void showAlert(
              locale === 'en'
                ? 'Dialogue needs character reference voices — generate voice samples in Assets first'
                : '这一镜有真实人物说话，但角色还没有声音样本哦～先去「素材准备」，给每个说话的角色生成或上传一段试听音，再回来生成配音。（纯系统旁白/系统提示音镜头可直接生成）',
            );
            return;
          }
          const text = buildDramaShotDoubaoAudioPrompt(domain, shot);
          const audioNodeId = directorShotAudioNodeId(id, shotId);
          ensureDirectorShotAudioStatusListener();
          shotAudioStartedAtRef.current[shotId] = Date.now();
          const generatingDomain = createEmptyDramaSession({
            ...domain,
            shots: domain.shots.map((s) =>
              s.shot_id === shotId
                ? { ...s, audio_status: 'generating', audio_error: '' }
                : s,
            ),
          });
          {
            const cur = dataRef.current;
            if (cur) dataRef.current = { ...cur, directorDomain: generatingDomain };
            dataRef.current?.onUpdate?.({ directorDomain: generatingDomain });
          }
          const applyShotAudio = (nextStatus: {
            audio_url?: string;
            audio_status: string;
            audio_error?: string;
          }) => {
            delete shotAudioStartedAtRef.current[shotId];
            const latest =
              (dataRef.current?.directorDomain as DramaDirectorSession | null) || domain;
            const next = createEmptyDramaSession({
              ...latest,
              shots: latest.shots.map((s) =>
                s.shot_id === shotId
                  ? {
                      ...s,
                      ...(nextStatus.audio_url !== undefined
                        ? { audio_url: nextStatus.audio_url }
                        : {}),
                      audio_status: nextStatus.audio_status,
                      audio_error: nextStatus.audio_error || '',
                    }
                  : s,
              ),
            });
            const cur = dataRef.current;
            if (cur) dataRef.current = { ...cur, directorDomain: next };
            dataRef.current?.onUpdate?.({ directorDomain: next });
          };
          // 先挂 waiter，再 invoke：避免 SUCCESS 经 IPC 迟到或 effect 重建时漏接
          const resultP = waitDirectorShotAudioResult(audioNodeId, DIRECTOR_SHOT_AUDIO_WAIT_MS);
          try {
            await window.electronAPI.invokeAI({
              modelId: 'audio',
              nodeId: audioNodeId,
              input: {
                model: DOUBAO_SEED_AUDIO_MODEL_ID,
                text,
                enable_base64_output: false,
                english_normalization: false,
                speechRate: 0,
                loudnessRate: 100,
                pitch: 0,
                doubaoFormat: 'mp3',
                doubaoSampleRate: '24000',
                ...(refs.length
                  ? {
                      doubaoAudioUrls: refs.map((r) => r.sample_url),
                      referenceAudioUrl: refs[0].sample_url,
                    }
                  : {}),
                projectId: data?.projectId || undefined,
                nodeTitle: `导演本镜声音-镜${shot.shot_no || ''}`,
              },
            });
          } catch (e) {
            // ERROR 通常已走 status 通道；若 waiter 仍在等，用异常兜底
            const pending = directorShotAudioWaiters.get(audioNodeId);
            if (pending) {
              directorShotAudioWaiters.delete(audioNodeId);
              pending.resolve({
                ok: false,
                error: e instanceof Error ? e.message : tt.generateFailed,
              });
            }
          }
          const result = await resultP;
          if (result.ok) {
            applyShotAudio({
              audio_url: result.audioUrl,
              audio_status: 'ready',
              audio_error: '',
            });
          } else if (result.error === 'abandoned') {
            // 用户已点「放弃生成」，本地态由 abandonShotAudioWait 清掉
          } else {
            applyShotAudio({
              audio_status: 'error',
              audio_error:
                result.error === 'empty-shot-audio' ? tt.generateFailed : result.error,
            });
            if (result.error && result.error !== 'empty-shot-audio') {
              void showAlert(result.error);
            }
          }
        })();
      }}
      onAbandonShotAudio={abandonShotAudioWait}
    />
    </div>
    );
  };

  const renderPhaseButtons = () =>
    isDramaMode ? (
      <div className="flex items-center gap-3 w-full min-w-0">
        <div className="flex-1 min-w-0">
          {(() => {
            const domain =
              (data?.directorDomain as DramaDirectorSession | null | undefined) || null;
            const activeUser: DramaUserPhase = domain
              ? domainPhaseToUserPhase(domain.meta.phase)
              : 'script';
            const steps = DRAMA_USER_PHASES.map((up) => ({
              userPhase: up,
              label: DRAMA_USER_PHASE_LABELS[up],
              sub: DRAMA_USER_PHASE_SUB[up],
              done: domain ? isDramaUserPhaseDone(domain, up) : false,
            }));
            const activeIdx = Math.max(
              0,
              steps.findIndex((s) => s.userPhase === activeUser),
            );
            const stepFs = isNodeFullscreen ? Math.max(13, fsSmall) : fsChrome;
            const badgeFs = isNodeFullscreen ? Math.max(12, fsChrome) : fsChrome;
            const statusText = (() => {
              if (!domain) return '待确认剧本分析';
              const up = activeUser;
              if (up === 'final') return '';
              if (up === 'board')
                return (domain.shots || []).length > 0
                  ? `${domain.shots.length} 镜 · 可出片`
                  : '待准备分镜';
              if (up === 'assets')
                return Number(domain.meta.assets_confirmed_at || 0) > 0
                  ? '素材已确认'
                  : '待确认素材';
              if (up === 'visual')
                return isDramaVisualStyleLocked(domain) ? '画风色调已锁定' : '待锁定画风色调';
              return domain.meta.analyze_confirmed || domain.bible.confirmed_at
                ? '分析已确认'
                : '待确认剧本分析';
            })();
            return (
              <div className="director-keep-visible flex w-full min-w-0 items-center gap-3">
                <div
                  className={`nowheel flex min-w-0 flex-1 items-center gap-0 overflow-x-auto rounded-2xl border px-1 py-1.5 ${
                    isDarkMode ? 'border-white/10 bg-white/[0.04]' : 'border-gray-200 bg-gray-100'
                  }`}
                >
                  {steps.map((s, i) => {
                    const activeStep = s.userPhase === activeUser;
                    const past = i < activeIdx || (s.done && !activeStep);
                    return (
                      <button
                        key={s.userPhase}
                        type="button"
                        title={`${s.label}${s.sub ? ` · ${s.sub}` : ''}`}
                        aria-current={activeStep ? 'step' : undefined}
                        className={`nodrag min-w-0 flex-1 flex items-center justify-center gap-1.5 px-1 py-1.5 rounded-xl text-center transition-colors ${
                          activeStep
                            ? isDarkMode
                              ? 'bg-sky-500/20'
                              : 'bg-sky-100/90'
                            : isDarkMode
                              ? 'hover:bg-white/[0.04]'
                              : 'hover:bg-gray-200/70'
                        }`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          const sess =
                            (dataRef.current?.directorDomain as DramaDirectorSession | null) ||
                            null;
                          if (!sess) {
                            goDirectorPhase(
                              s.userPhase === 'board'
                                ? 'board'
                                : s.userPhase === 'assets'
                                  ? 'assets'
                                  : s.userPhase === 'visual'
                                    ? 'visual'
                                    : s.userPhase === 'final'
                                      ? 'review'
                                      : 'analyze',
                            );
                            return;
                          }
                          const gate = canEnterDramaUserPhase(sess, s.userPhase);
                          if (!gate.ok) {
                            void showAlert(gate.reason);
                            const fb = preferredDomainPhaseForUserPhase(gate.fallback, sess);
                            goDirectorPhase(fb as DirectorPhase);
                            return;
                          }
                          const domainPhase = preferredDomainPhaseForUserPhase(
                            s.userPhase,
                            sess,
                          );
                          goDirectorPhase(domainPhase as DirectorPhase);
                        }}
                      >
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-semibold tabular-nums leading-none ${
                            activeStep
                              ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/30'
                              : past
                                ? isDarkMode
                                  ? 'bg-emerald-500/85 text-white'
                                  : 'bg-emerald-500 text-white'
                                : isDarkMode
                                  ? 'bg-white/10 text-white/50'
                                  : 'bg-gray-200/90 text-gray-500'
                          }`}
                          style={{ fontSize: badgeFs }}
                          title={`第 ${i + 1} 步`}
                        >
                          {i + 1}
                        </span>
                        <span
                          className={`min-w-0 font-medium leading-tight truncate ${
                            activeStep
                              ? isDarkMode
                                ? 'text-sky-200'
                                : 'text-sky-600'
                              : isDarkMode
                                ? 'text-white/85'
                                : 'text-gray-900'
                          }`}
                          style={{ fontSize: stepFs }}
                        >
                          {s.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {statusText ? (
                  <div
                    className={`shrink-0 max-w-[12rem] text-right leading-snug ${
                      isDarkMode ? 'text-white/55' : 'text-gray-500'
                    }`}
                    style={{ fontSize: isNodeFullscreen ? Math.max(12, fsSmall) : fsChrome }}
                  >
                    {statusText}
                  </div>
                ) : null}
              </div>
            );
          })()}
        </div>
      </div>
    ) : isMvMode ? (
      renderMvPhaseStepper([
        {
          phase: 'music',
          label: tt.phaseMusic,
          sub: tt.phaseMusicSub,
          done: !!String(state.mvMusic?.url || '').trim() || !!String(state.mvMusic?.moodHint || '').trim(),
        },
        {
          phase: 'story',
          label: tt.phaseStory,
          sub: tt.phaseStorySub,
          done:
            !!String(state.scriptText || '').trim() ||
            directorMvScriptSectionsHaveContent(mvScriptSections) ||
            !!String(state.mvStoryOutline || '').trim(),
        },
        {
          phase: 'style',
          label: tt.phaseStyle,
          sub: tt.phaseStyleSub,
          done: !!String(state.globalStyle || '').trim() || !!String(state.styleReferenceImageUrl || '').trim(),
        },
        {
          phase: 'cast',
          label: tt.phaseCast,
          sub: tt.phaseCastSub,
          done: mvCastReady > 0,
        },
        {
          phase: 'assets',
          label: tt.phaseMvScenes,
          sub: tt.phaseMvScenesSub,
          done: countReadyInList(state.assets.scenes) > 0,
        },
        {
          phase: 'shots',
          label: tt.phaseShots,
          sub: tt.phaseShotsSub,
          done: state.shots.length > 0,
        },
        {
          phase: 'videos',
          label: tt.phaseVideos,
          sub: tt.phaseVideosSub,
          done:
            storyboardsProg.ready > 0 &&
            (state.shots || []).some((s, i) => {
              const no = String(s['镜号'] || i + 1);
              const sb = getDirectorShotStoryboard(state, no);
              return !!String(sb.videoUrl || '').trim() || sb.videoStatus === 'ready';
            }),
        },
        {
          phase: 'karaoke',
          label: tt.phaseKaraoke,
          sub: tt.phaseKaraokeSub,
          // 仅烧录完成算「完成」；有成片 URL 只表示可编辑，不应显示勾却像已做完
          done: !!String(
            (data as DirectorNodeData | undefined)?.karaokeBurnedVideoUrl || '',
          ).trim(),
        },
      ])
    ) : (
      <>
        {phaseBtn(
          'shots',
          `1. ${tt.dramaConfirmShots}`,
          fillDirectorI18n(tt.shotsReady, { n: state.shots.length }),
          state.phase === 'shots',
          state.shots.length > 0,
          'motion',
        )}
        {phaseBtn(
          'assets',
          `2. ${tt.phaseAssets}`,
          assetsPhaseSubcopy,
          state.phase === 'assets',
          assetsProg.ready > 0,
          'events',
        )}
        {phaseBtn(
          'prompts',
          `3. ${tt.phasePrompts}`,
          fillDirectorI18n(tt.promptsProgress, {
            ready: promptsProg.ready,
            total: promptsProg.total || 0,
          }),
          state.phase === 'prompts',
          promptsProg.ready > 0,
          'operators',
        )}
        {phaseBtn(
          'storyboards',
          `4. ${tt.phaseStoryboards}`,
          fillDirectorI18n(tt.storyboardsProgress, {
            ready: storyboardsProg.ready,
            total: storyboardsProg.total || 0,
            left: storyboardsProg.missing,
          }),
          state.phase === 'storyboards',
          storyboardsProg.ready > 0,
          'control',
        )}
        {phaseBtn(
          'preview',
          `5. ${tt.phasePreview}`,
          String(state.linkedSpliceNodeId || '').trim() ? '✓' : tt.previewHint.slice(0, 16),
          state.phase === 'preview',
          !!String(state.linkedSpliceNodeId || '').trim(),
          'sensing',
        )}
      </>
    );

  const mvFieldCls = `nodrag w-full rounded-md px-2.5 py-1.5 outline-none focus:ring-1 ${
    isDarkMode
      ? 'bg-black/35 text-white/85 focus:ring-blue-500/30 border border-white/10'
      : 'bg-gray-100 text-gray-800 border border-gray-200 focus:ring-gray-400/40'
  }`;

  const MV_AUDIO_MAX_BYTES = 80 * 1024 * 1024;
  const MV_AUDIO_MAX_SEC = 6 * 60;
  const isAllowedMvAudioFile = (file: File) => {
    const name = String(file.name || '').toLowerCase();
    const mime = String(file.type || '').toLowerCase();
    if (/\.(mp3|wav|m4a)$/i.test(name)) return true;
    if (mime.includes('mpeg') || mime.includes('mp3') || mime.includes('wav') || mime.includes('mp4') || mime.includes('m4a') || mime.includes('x-m4a')) {
      return true;
    }
    return false;
  };

  const probeAudioDurationSec = useCallback((url: string): Promise<number> => {
    return new Promise((resolve) => {
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      const playable = toElectronVideoElementSrc(url) || url;
      const done = (sec: number) => {
        audio.removeAttribute('src');
        audio.load();
        resolve(sec);
      };
      audio.onloadedmetadata = () => {
        const d = Number(audio.duration);
        done(Number.isFinite(d) && d > 0 ? d : 0);
      };
      audio.onerror = () => done(0);
      audio.src = playable;
    });
  }, []);

  const applyMvMusicFromUrl = useCallback(
    async (audioUrl: string, opts?: { title?: string; sourceNodeId?: string }) => {
      const url = String(audioUrl || '').trim();
      if (!url) return;
      const durationSec = await probeAudioDurationSec(url);
      if (durationSec > MV_AUDIO_MAX_SEC) {
        showAlert(tt.musicAudioTooLong);
        return;
      }
      const prev = directorStateRef.current;
      const titleFromOpt = String(opts?.title || '').trim();
      // 歌曲名：仅空时用文件名自动填；已有手填内容不覆盖（勿 trim 写入，避免干扰 IME）
      const prevSongTitle = String(prev.mvMusic?.songTitle || '');
      const fillSongTitle = !prevSongTitle.trim() && !!titleFromOpt;
      patch(
        patchDirectorMvMusic(prev, {
          url,
          title: String(prev.mvMusic?.title || '').trim() || titleFromOpt || prev.mvMusic?.title || '',
          ...(fillSongTitle ? { songTitle: titleFromOpt } : {}),
          durationSec: durationSec > 0 ? durationSec : prev.mvMusic?.durationSec || 0,
          summary:
            String(prev.mvMusic?.summary || '').trim() ||
            (durationSec > 0 ? `时长约 ${Math.round(durationSec)} 秒` : ''),
          sourceNodeId: opts?.sourceNodeId || '',
          // 换歌后清空旧时间轴
          lyricSegments: [],
          lyricSegmentsStatus: 'idle',
          lyricSegmentsError: '',
          lyricSegmentsSourceUrl: '',
          lyricAsrWords: [],
        }),
      );
    },
    [patch, probeAudioDurationSec, showAlert, tt.musicAudioTooLong],
  );

  const onUploadMvAudioFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      if (!isAllowedMvAudioFile(file)) {
        showAlert(tt.musicAudioBadFormat);
        return;
      }
      if (file.size > MV_AUDIO_MAX_BYTES) {
        showAlert(tt.musicAudioTooLarge);
        return;
      }
      const api = window.electronAPI;
      const projectId = data?.projectId || undefined;
      let audioUrl = '';
      try {
        if (api?.saveDroppedFileBufferToProjectAssets) {
          const buffer = await file.arrayBuffer();
          const { savedPath } = await api.saveDroppedFileBufferToProjectAssets(
            projectId,
            file.name || 'mv-music.mp3',
            buffer,
          );
          audioUrl = `local-resource://${savedPath}`;
        }
      } catch (e) {
        console.warn('[DirectorNode] 上传歌曲音频失败', e);
      }
      if (!audioUrl) {
        try {
          audioUrl = URL.createObjectURL(file);
        } catch {
          showAlert(locale === 'en' ? 'Failed to load audio' : '音频加载失败');
          return;
        }
      }
      const titleFromFile = audioDisplayTitleFromFileName(file.name) || '';
      const durationSec = await probeAudioDurationSec(audioUrl);
      if (durationSec > MV_AUDIO_MAX_SEC) {
        showAlert(tt.musicAudioTooLong);
        if (audioUrl.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(audioUrl);
          } catch {
            /* ignore */
          }
        }
        return;
      }
      await applyMvMusicFromUrl(audioUrl, { title: titleFromFile });
    },
    [
      applyMvMusicFromUrl,
      data?.projectId,
      locale,
      probeAudioDurationSec,
      showAlert,
      tt.musicAudioBadFormat,
      tt.musicAudioTooLarge,
      tt.musicAudioTooLong,
    ],
  );

  /** 音乐步小白引导：按完成度决定当前该点哪一步 */
  const mvMusicGuide = useMemo(() => {
    const hasAudio = !!String(state.mvMusic?.url || '').trim();
    const hasSegs = (state.mvMusic?.lyricSegments || []).length > 0;
    const detecting =
      busyAction === 'lyric-timeline' ||
      busyAction === 'story-analyze' ||
      state.mvMusic?.lyricSegmentsStatus === 'transcribing';
    type Micro = 'upload' | 'detect' | 'next';
    const current: Micro = !hasAudio ? 'upload' : !hasSegs ? 'detect' : 'next';
    return { hasAudio, hasSegs, detecting, current };
  }, [
    busyAction,
    state.mvMusic?.url,
    state.mvMusic?.lyricSegments,
    state.mvMusic?.lyricSegmentsStatus,
  ]);

  const renderMvMusicPanel = () => {
    const hasAudio = mvMusicGuide.hasAudio;
    const segs = state.mvMusic?.lyricSegments || [];
    const packs =
      segs.length > 0
        ? packLyricSegmentsIntoShotPacks(segs, {
            clipLengthMode: state.mvMusic?.clipLengthMode,
          })
        : [];
    const musicUrl = String(state.mvMusic?.url || '').trim();
    const analyzing =
      busyAction === 'lyric-timeline' ||
      busyAction === 'story-analyze' ||
      state.mvMusic?.lyricSegmentsStatus === 'transcribing';
    const extractingLyrics = busyAction === 'extract-lyrics';
    /** 模块 chrome 最小字号 */
    const fsMusic = fsChrome;
    /** 图三：云上传线标（矩形底板加大） */
    const renderUploadBadge = () => (
      <div
        className={`flex h-20 w-28 items-center justify-center rounded-xl ${
          isDarkMode ? 'bg-sky-500/15' : 'bg-sky-50'
        }`}
      >
        <UploadCloud
          className={`h-12 w-12 ${isDarkMode ? 'text-sky-400' : 'text-sky-500'}`}
          strokeWidth={1.6}
        />
      </div>
    );

    const renderPacksGrid = () => {
      if (packs.length === 0) return null;
      return (
        <div
          className="grid gap-1.5 flex-1 min-h-0 overflow-y-auto nowheel custom-scrollbar-dark pr-0.5"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
            gridAutoRows: '96px',
          }}
        >
          {packs.map((pack, pi) => {
            const startSec = Math.max(0, Number(pack.startSec) || 0);
            let endSec = Number(pack.endSec);
            if (!Number.isFinite(endSec) || endSec <= startSec + 0.05) {
              endSec = startSec + Math.max(0.5, Number(pack.durationSec) || 5);
            }
            const text = sanitizeDirectorLyricDisplayText(pack.text);
            const role = classifyDirectorMvPackAudioRole(packs, pi);
            const hasLyric = role === 'vocal';
            const voiceBadge = directorMvPackAudioRoleLabelZh(role);
            return (
              <div
                key={`lyric-pack-${pi}-${startSec.toFixed(2)}-${endSec.toFixed(2)}`}
                className={`relative min-w-0 overflow-hidden rounded-lg border px-1.5 py-1 h-full min-h-[96px] flex flex-col ${
                  isDarkMode ? 'border-white/10 bg-white/[0.04]' : 'border-gray-200 bg-gray-100'
                }`}
              >
                <button
                  type="button"
                  className={`nodrag absolute top-0.5 right-0.5 z-[1] p-0.5 rounded ${
                    isDarkMode
                      ? 'text-white/35 hover:text-rose-300 hover:bg-white/10'
                      : 'text-gray-400 hover:text-rose-600 hover:bg-black/5'
                  }`}
                  title={tt.lyricTimelineDeletePack}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteLyricPack(pack.segmentIds || [], startSec, endSec);
                  }}
                >
                  <X className="w-3.5 h-3.5" strokeWidth={2.4} />
                </button>
                <ReferenceAudioWaveStrip
                  src={musicUrl}
                  isDarkMode={isDarkMode}
                  variant="compact"
                  waveOnly
                  emptyLabel={tt.shotAudioNeedMusic}
                  playLabel={`${tt.lyricTimelineSectionPlay} ${formatShotAudioClock(startSec)}–${formatShotAudioClock(endSec)}`}
                  clipStartSec={startSec}
                  clipEndSec={endSec}
                />
                <div className="mt-0.5 flex items-center justify-center gap-1.5">
                  <span className={`tabular-nums ${mutedCls}`} style={{ fontSize: Math.max(10, fsChrome - 1) }}>
                    {formatShotAudioClock(startSec)}–{formatShotAudioClock(endSec)}
                  </span>
                  <span title={voiceBadge} className="inline-flex">
                    {hasLyric ? (
                      <User
                        className={`w-5 h-5 ${isDarkMode ? 'text-emerald-300' : 'text-emerald-600'}`}
                        strokeWidth={2.5}
                        aria-label={voiceBadge}
                      />
                    ) : (
                      <Music2 className={`w-5 h-5 ${mutedCls}`} strokeWidth={2.3} aria-label={voiceBadge} />
                    )}
                  </span>
                </div>
                {hasLyric && text ? (
                  <div
                    className={`mt-0.5 flex-1 text-center line-clamp-2 break-words ${bodyCls}`}
                    style={{ fontSize: Math.max(10, fsChrome - 1) }}
                    title={text}
                  >
                    {text}
                  </div>
                ) : (
                  <div className="flex-1" />
                )}
              </div>
            );
          })}
        </div>
      );
    };

    const softPanel = isDarkMode ? 'bg-white/[0.04]' : 'bg-gray-100';
    const softBorder = isDarkMode ? 'border-white/12' : 'border-gray-200/80';
    const titleClsLocal = isDarkMode ? 'text-white' : 'text-gray-900';
    const bodyGray = isDarkMode ? 'text-white/55' : 'text-gray-500';
    const analysisCardCls = `rounded-2xl border px-3 py-2.5 ${
      isDarkMode ? 'border-white/15 bg-white/[0.06]' : 'border-gray-200 bg-gray-100'
    }`;
    const storySummary = String(state.mvStoryAnalysis?.summary || '').trim();
    const storyGenre = String(state.mvStoryAnalysis?.genre || '').trim();
    const storyEmotions = state.mvStoryAnalysis?.emotions || [];
    const storyKeywords = state.mvStoryAnalysis?.keywords || [];
    const musicAnalyzeCostLabel = formatMusicAnalyzeYuanbaoLabel();
    const renderMusicTag = (label: string, key: string) => (
      <span
        key={key}
        className={`inline-flex items-center rounded-md px-2 py-0.5 ${
          isDarkMode ? 'bg-white/10 text-white/80' : 'bg-gray-100 text-gray-700'
        }`}
        style={{ fontSize: fsMusic }}
      >
        {label}
      </span>
    );
    const renderMusicAnalysisCards = () => (
      <div className="shrink-0 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div className={analysisCardCls}>
          <div className={`mb-1.5 font-medium ${titleClsLocal}`} style={{ fontSize: fsMusic }}>
            {tt.storyAnalyzeTitle}
          </div>
          <p
            className={`leading-relaxed whitespace-pre-wrap break-words ${
              storySummary ? (isDarkMode ? 'text-white/80' : 'text-gray-800') : bodyGray
            }`}
            style={{ fontSize: fsMusic }}
          >
            {storySummary || tt.musicAnalyzeSummaryEmpty}
          </p>
          {storyGenre ? (
            <div className="mt-2 flex flex-wrap gap-1.5">{renderMusicTag(storyGenre, `g-${storyGenre}`)}</div>
          ) : null}
        </div>
        <div className={analysisCardCls}>
          <div className={`mb-1.5 font-medium ${titleClsLocal}`} style={{ fontSize: fsMusic }}>
            {tt.storyStyleTitle}
          </div>
          <div className={`mb-1 ${bodyGray}`} style={{ fontSize: fsMusic }}>
            {tt.storyEmotionsLabel}
          </div>
          <div className="mb-2.5 flex flex-wrap gap-1.5 min-h-[1.5rem]">
            {storyEmotions.length
              ? storyEmotions.map((t, i) => renderMusicTag(t, `e-${i}-${t}`))
              : (
                <span className={bodyGray} style={{ fontSize: fsMusic }}>
                  —
                </span>
              )}
          </div>
          <div className={`mb-1 ${bodyGray}`} style={{ fontSize: fsMusic }}>
            {tt.storyKeywordsLabel}
          </div>
          <div className="flex flex-wrap gap-1.5 min-h-[1.5rem]">
            {storyKeywords.length
              ? storyKeywords.map((t, i) => renderMusicTag(t, `k-${i}-${t}`))
              : (
                <span className={bodyGray} style={{ fontSize: fsMusic }}>
                  —
                </span>
              )}
          </div>
        </div>
      </div>
    );
    const renderMusicAnalyzeButton = () => (
      <div
        className="relative z-[40] overflow-visible"
        onMouseEnter={() => !analyzing && setPriceHoverKey('music-analyze')}
        onMouseLeave={() => setPriceHoverKey((k) => (k === 'music-analyze' ? null : k))}
      >
        {!analyzing && priceHoverKey === 'music-analyze' ? (
          <span className={`${yuanbaoHoverTipCls} translate-y-0 opacity-100`} title={tt.priceTooltip}>
            {musicAnalyzeCostLabel}
          </span>
        ) : null}
        <button
          type="button"
          className={`nodrag nopan inline-flex items-center gap-1.5 ${
            analyzing
              ? isDarkMode
                ? 'rounded-full px-4 py-2 bg-white/10 text-white/80 hover:bg-white/14'
                : 'rounded-full px-4 py-2 bg-[#e5e7eb] text-gray-600 hover:bg-[#d1d5db]'
              : btnPrimary('!px-4 !py-2', 'sound')
          } disabled:opacity-50`}
          style={{ fontSize: fsMusic }}
          disabled={
            !hasAudio ||
            extractingLyrics ||
            (!!busyAction && !analyzing) ||
            (!analyzing && musicAnalyzeCostLabel == null)
          }
          title={
            analyzing
              ? tt.musicJobCancel
              : musicAnalyzeCostLabel == null
                ? tt.otsPriceRequired
                : `${tt.lyricTimelineDetect} · ${musicAnalyzeCostLabel}`
          }
          onClick={(e) => {
            e.stopPropagation();
            if (analyzing) {
              cancelMusicJob();
              return;
            }
            if (musicAnalyzeCostLabel == null) {
              void showAlert(tt.otsPriceRequired);
              return;
            }
            void handleMvMusicAnalyze();
          }}
        >
          {analyzing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <AudioLines className="w-4 h-4" strokeWidth={2.25} />
          )}
          {analyzing ? tt.musicJobCancel : tt.lyricTimelineDetect}
        </button>
      </div>
    );

    return (
      <div className="flex flex-1 min-h-0 h-full gap-3 overflow-hidden">
        {/* 左：上传 + 提取歌词（参考款式） */}
        <div className="w-[34%] min-w-[220px] max-w-[380px] flex flex-col gap-4 min-h-0 h-full">
          <div className="shrink-0 flex flex-col gap-2">
            <div className={`font-medium ${titleClsLocal}`} style={{ fontSize: fsMusic }}>
              {tt.musicStep1Title}
            </div>
            {hasAudio ? (
              <div className={`nodrag nopan relative rounded-2xl ${softPanel} px-2 py-2`}>
                <div className="absolute top-2 right-2 z-20 flex items-center gap-0.5">
                  <button
                    type="button"
                    className={`nodrag p-1 rounded-full ${
                      isDarkMode
                        ? 'text-white/50 hover:text-white/90 hover:bg-black/40'
                        : 'text-gray-400 hover:text-gray-700 hover:bg-gray-200/70'
                    }`}
                    title={tt.musicReplaceAudio}
                    onClick={(e) => {
                      e.stopPropagation();
                      musicAudioInputRef.current?.click();
                    }}
                  >
                    <Upload className="w-3.5 h-3.5" strokeWidth={2.25} />
                  </button>
                  <button
                    type="button"
                    className={`nodrag p-1 rounded-full ${
                      isDarkMode
                        ? 'text-white/40 hover:text-rose-300 hover:bg-black/40'
                        : 'text-gray-400 hover:text-rose-600 hover:bg-gray-200/70'
                    }`}
                    title={tt.musicClearAudio}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const next = patchDirectorMvMusic(directorStateRef.current, {
                        url: '',
                        durationSec: 0,
                        sourceNodeId: '',
                      });
                      directorStateRef.current = next;
                      dataRef.current?.onUpdate?.({
                        director: next,
                        title: next.title,
                        isGenerating: next.isGenerating,
                        error: next.error || undefined,
                        unlinkIncomingAudio: true,
                      });
                    }}
                  >
                    <X className="w-3.5 h-3.5" strokeWidth={2.4} />
                  </button>
                </div>
                <MusicPlayer
                  audioUrl={musicUrl}
                  isDarkMode={isDarkMode}
                  title={
                    String(state.mvMusic?.songTitle || '').trim() ||
                    String(state.mvMusic?.title || '').trim() ||
                    (locale === 'en' ? 'Audio' : '音频')
                  }
                  showWaveform
                  compactWaveform
                />
              </div>
            ) : (
              <div
                className={`nodrag nopan flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-4 py-10 cursor-pointer transition-colors ${
                  musicDropActive
                    ? isDarkMode
                      ? 'border-sky-400 bg-sky-500/10'
                      : 'border-sky-400 bg-sky-50'
                    : isDarkMode
                      ? 'border-sky-400/35 bg-white/[0.03] hover:bg-white/[0.06]'
                      : 'border-sky-300/70 bg-gray-100 hover:bg-gray-200/70'
                }`}
                title={tt.musicUploadAudio}
                onClick={(e) => {
                  e.stopPropagation();
                  musicAudioInputRef.current?.click();
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMusicDropActive(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMusicDropActive(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMusicDropActive(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMusicDropActive(false);
                  const file = e.dataTransfer?.files?.[0] || null;
                  void onUploadMvAudioFile(file);
                }}
              >
                {renderUploadBadge()}
                <div
                  className={`text-center font-medium ${isDarkMode ? 'text-white/90' : 'text-gray-800'}`}
                  style={{ fontSize: fsMusic }}
                >
                  {tt.musicDropHint}
                </div>
              </div>
            )}
          </div>

          {/* 曲名 / 作词 / 作曲：位于「第二步：填入歌词」上方 */}
          <div className="shrink-0 flex flex-col gap-1.5">
            <label className="flex flex-col gap-0.5">
              <span className={`${bodyGray}`} style={{ fontSize: Math.max(10, fsMusic - 1) }}>
                {tt.musicSongTitle}
              </span>
              <input
                type="text"
                className={`nodrag nopan nowheel w-full rounded-xl border-0 px-3 py-1.5 outline-none focus:ring-1 ${
                  isDarkMode
                    ? 'bg-white/[0.04] text-white/85 placeholder:text-white/25 focus:ring-sky-400/30'
                    : 'bg-gray-100 text-gray-800 placeholder:text-gray-400 focus:ring-sky-300/50'
                }`}
                style={{ fontSize: fsMusic }}
                placeholder={tt.musicSongTitlePlaceholder}
                value={state.mvMusic?.songTitle || ''}
                onChange={(e) =>
                  patch(
                    patchDirectorMvMusic(directorStateRef.current, {
                      songTitle: e.target.value,
                    }),
                  )
                }
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                onKeyUp={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className={`${bodyGray}`} style={{ fontSize: Math.max(10, fsMusic - 1) }}>
                {tt.musicLyricist}
              </span>
              <input
                type="text"
                className={`nodrag nopan nowheel w-full rounded-xl border-0 px-3 py-1.5 outline-none focus:ring-1 ${
                  isDarkMode
                    ? 'bg-white/[0.04] text-white/85 placeholder:text-white/25 focus:ring-sky-400/30'
                    : 'bg-gray-100 text-gray-800 placeholder:text-gray-400 focus:ring-sky-300/50'
                }`}
                style={{ fontSize: fsMusic }}
                placeholder={tt.musicCreditDefault}
                value={state.mvMusic?.lyricist || ''}
                onChange={(e) =>
                  patch(
                    patchDirectorMvMusic(directorStateRef.current, {
                      lyricist: e.target.value,
                    }),
                  )
                }
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                onKeyUp={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className={`${bodyGray}`} style={{ fontSize: Math.max(10, fsMusic - 1) }}>
                {tt.musicComposer}
              </span>
              <input
                type="text"
                className={`nodrag nopan nowheel w-full rounded-xl border-0 px-3 py-1.5 outline-none focus:ring-1 ${
                  isDarkMode
                    ? 'bg-white/[0.04] text-white/85 placeholder:text-white/25 focus:ring-sky-400/30'
                    : 'bg-gray-100 text-gray-800 placeholder:text-gray-400 focus:ring-sky-300/50'
                }`}
                style={{ fontSize: fsMusic }}
                placeholder={tt.musicCreditDefault}
                value={state.mvMusic?.composer || ''}
                onChange={(e) =>
                  patch(
                    patchDirectorMvMusic(directorStateRef.current, {
                      composer: e.target.value,
                    }),
                  )
                }
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                onKeyUp={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
              />
            </label>
          </div>

          <div className="flex-1 min-h-0 flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2 shrink-0">
              <div className={`font-medium min-w-0 ${titleClsLocal}`} style={{ fontSize: fsMusic }}>
                {tt.musicStep2Title}
              </div>
              <button
                type="button"
                className={`nodrag nopan shrink-0 inline-flex items-center rounded-full px-4 py-1.5 font-medium disabled:opacity-40 transition-colors ${
                  isDarkMode
                    ? 'bg-white/10 text-white/70 hover:bg-white/14'
                    : 'bg-[#e5e7eb] text-gray-500 hover:bg-[#d1d5db] hover:text-gray-700'
                }`}
                style={{ fontSize: fsMusic }}
                disabled={!hasAudio || analyzing || (!!busyAction && !extractingLyrics)}
                title={
                  extractingLyrics
                    ? tt.musicJobCancel
                    : `${tt.musicLyricsStripMeta} · ${formatFileTranscribeYuanbaoLabel()}`
                }
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (extractingLyrics) {
                    cancelMusicJob();
                    return;
                  }
                  void handleExtractLyrics();
                }}
              >
                {extractingLyrics ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                {extractingLyrics ? tt.musicJobCancel : tt.musicLyricsStripMeta}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              <span className={`mr-0.5 ${bodyGray}`} style={{ fontSize: fsMusic }}>
                {tt.musicAsrLanguage}
              </span>
              {KARAOKE_ASR_LANGUAGE_OPTIONS.map((key) => {
                const label =
                  key === 'zh'
                    ? tt.musicAsrLanguageZh
                    : key === 'yue'
                      ? tt.musicAsrLanguageYue
                      : tt.musicAsrLanguageAuto;
                const current = normalizeKaraokeAsrLanguage(state.mvMusic?.asrLanguage);
                return (
                  <button
                    key={key}
                    type="button"
                    className={`nodrag nopan rounded-full px-2.5 py-0.5 font-medium transition-colors ${
                      current === key
                        ? isDarkMode
                          ? 'bg-violet-500/30 text-violet-100 ring-1 ring-violet-400/40'
                          : 'bg-violet-100 text-violet-800 ring-1 ring-violet-300'
                        : isDarkMode
                          ? 'bg-white/[0.06] text-white/65 hover:bg-white/[0.1]'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    style={{ fontSize: fsMusic }}
                    disabled={!!busyAction}
                    title={label}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      patch(
                        patchDirectorMvMusic(directorStateRef.current, {
                          asrLanguage: key as KaraokeAsrLanguage,
                        }),
                      );
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className={`${bodyGray} leading-relaxed shrink-0`} style={{ fontSize: Math.max(10, fsMusic - 1) }}>
              {tt.musicAsrLanguageHint}
            </p>
            {normalizeKaraokeAsrLanguage(state.mvMusic?.asrLanguage) === 'yue' ? (
              <p
                className={`leading-relaxed shrink-0 ${
                  isDarkMode ? 'text-amber-200/80' : 'text-amber-800/90'
                }`}
                style={{ fontSize: Math.max(10, fsMusic - 1) }}
              >
                {tt.musicAsrLanguageYueTip}
              </p>
            ) : null}
            <textarea
              className={`nodrag nopan nowheel w-full flex-1 min-h-0 resize-none rounded-2xl border-0 px-3 py-2.5 outline-none focus:ring-1 ${
                isDarkMode
                  ? 'bg-white/[0.04] text-white/85 placeholder:text-white/25 focus:ring-sky-400/30'
                  : 'bg-gray-100 text-gray-800 placeholder:text-gray-400 focus:ring-sky-300/50'
              } ${scrollCls}`}
              style={{ fontSize: fsMusic }}
              placeholder=""
              value={mvLyricsDraft}
              onFocus={() => {
                mvLyricsFocusedRef.current = true;
              }}
              onCompositionStart={() => {
                mvLyricsComposingRef.current = true;
              }}
              onCompositionEnd={(e) => {
                mvLyricsComposingRef.current = false;
                setMvLyricsDraft(e.currentTarget.value);
              }}
              onChange={(e) => {
                setMvLyricsDraft(e.target.value);
              }}
              onBlur={(e) => {
                mvLyricsFocusedRef.current = false;
                mvLyricsComposingRef.current = false;
                // 冒号形角色标记 / 普通歌词：半角 `:` → 全角 `：`（括号形仍半角括号；LRC 时间戳除外）
                const v = normalizeKaraokeRoleMarkersInText(e.currentTarget.value);
                setMvLyricsDraft(v);
                syncKaraokeFromStep1Lyrics(v);
                commitStep1LyricsToKaraokeLines();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              // 仅 stopPropagation 防 React Flow 吞键；勿 preventDefault，否则 IME 切不了/组不了字
              onKeyDown={(e) => e.stopPropagation()}
              onKeyUp={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            />
          </div>
        </div>

        {/* 右：标题在白线框外上方；框内为分析总结 / 曲风 + 歌曲分析 + 分段 */}
        <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0 h-full overflow-hidden">
          <div className={`font-medium shrink-0 ${titleClsLocal}`} style={{ fontSize: fsMusic }}>
            {tt.musicStep3Title}
          </div>
          <div
            className={`flex-1 min-w-0 flex flex-col min-h-0 rounded-2xl border ${softBorder} ${softPanel} px-4 py-3 gap-3 overflow-hidden`}
          >
          {renderMusicAnalysisCards()}

          <div className="shrink-0 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`mr-1 ${bodyGray}`} style={{ fontSize: fsMusic }}>
                {tt.musicRecommendDuration}
              </span>
              {(
                [
                  { id: 'short' as const, label: '4-6s' },
                  { id: 'long' as const, label: '10-15s' },
                ] as const
              ).map((opt) => {
                const active = (state.mvMusic?.clipLengthMode || 'short') === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    className={`nodrag rounded-full px-3 py-1 tabular-nums font-medium transition-colors ${
                      active
                        ? 'bg-sky-500 text-white'
                        : isDarkMode
                          ? 'bg-white/8 text-white/65'
                          : 'bg-gray-100 text-gray-500'
                    }`}
                    style={{ fontSize: fsMusic }}
                    disabled={!!busyAction}
                    onClick={() => {
                      const cur = directorStateRef.current;
                      let next = patchDirectorMvMusic(cur, { clipLengthMode: opt.id });
                      if ((next.mvMusic?.lyricSegments || []).length > 0 && (next.shots || []).length > 0) {
                        next = syncDirectorShotsToLyricTimeline(next);
                      }
                      patch({ ...next, error: '' });
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-1.5">
              {renderChatModelSelect({
                // 模型选择不依赖第一步曲名/作词/作曲或是否已上传；仅任务进行中禁用
                disabled: !!busyAction || analyzing || extractingLyrics,
                /** portal 菜单：自动上下展开，避免强制上拉被视口裁成只剩一项 */
                menuPlacement: 'auto',
              })}
              {renderMusicAnalyzeButton()}
              {packs.length > 0 ? (
                <>
                  <button
                    type="button"
                    className={`nodrag inline-flex h-8 w-8 items-center justify-center rounded-full disabled:opacity-50 ${
                      isDarkMode ? 'bg-white/10 text-white/75' : 'bg-gray-100 text-gray-600'
                    }`}
                    disabled={!hasAudio || !!busyAction}
                    title={tt.lyricTimelineRecalibrate}
                    onClick={() => handleRecalibrateLyricPacks()}
                  >
                    <Scissors className="w-4 h-4" strokeWidth={2.25} />
                  </button>
                  <button
                    type="button"
                    className={`nodrag inline-flex h-8 w-8 items-center justify-center rounded-full ${
                      isDarkMode
                        ? 'bg-white/10 text-white/50 hover:text-rose-300'
                        : 'bg-gray-100 text-gray-400 hover:text-rose-600'
                    }`}
                    title={tt.lyricTimelineClear}
                    onClick={() => handleClearLyricTimeline()}
                  >
                    <Trash2 className="w-3.5 h-3.5" strokeWidth={2.25} />
                  </button>
                </>
              ) : null}
            </div>
          </div>

          {(analyzing || busyAction === 'story-analyze') && lyricTimelineProgress ? (
            <p className={`shrink-0 ${bodyGray}`} style={{ fontSize: fsMusic }}>
              {lyricTimelineProgress}
            </p>
          ) : null}
          {state.mvMusic?.lyricSegmentsError ? (
            <p className="shrink-0 text-amber-500" style={{ fontSize: fsMusic }}>
              {state.mvMusic.lyricSegmentsError}
            </p>
          ) : null}

          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {packs.length > 0 ? (
              renderPacksGrid()
            ) : (
              <div
                className={`flex-1 min-h-0 rounded-2xl ${
                  isDarkMode ? 'bg-zinc-950/40' : 'bg-gray-100'
                }`}
              />
            )}
          </div>
          </div>
        </div>
      </div>
    );
  };

  /** 仅提取歌词正文（可手填；不跑完整歌曲时间轴分析） */
  const handleExtractLyrics = useCallback(async () => {
    const cur = directorStateRef.current;
    const existing = String(cur.mvMusic?.lyrics || '').trim();
    if (existing) {
      const cleaned = stripDirectorLyricsScriptMeta(existing);
      patch(patchDirectorMvMusic(cur, { lyrics: cleaned }));
      showAlert(tt.musicLyricsStripMetaDone);
      return;
    }
    const fromSegs = (cur.mvMusic?.lyricSegments || [])
      .map((s) => String(s.text || '').trim())
      .filter(Boolean)
      .join('\n');
    if (fromSegs) {
      const cleaned = stripDirectorLyricsScriptMeta(fromSegs);
      patch(patchDirectorMvMusic(cur, { lyrics: cleaned || fromSegs }));
      showAlert(tt.musicLyricsStripMetaDone);
      return;
    }
    const musicUrl = String(cur.mvMusic?.url || '').trim();
    if (!musicUrl) {
      showAlert(tt.musicNeedFirst);
      return;
    }
    if (busyAction || cur.isGenerating || data?.isGenerating) return;
    if (!window.electronAPI?.transcribeSpeechSegmentsFromAudioUrl) {
      showAlert(tt.lyricTimelineNeedEngine);
      return;
    }
    const gen = beginMusicJob();
    setBusyAction('extract-lyrics');
    try {
      // fun-asr 支持带 BGM：整曲直送云端（不再下 Whisper / 不强依赖 Demucs）
      const asrLang = karaokeAsrLanguageToApiParam(cur.mvMusic?.asrLanguage);
      const result = await window.electronAPI.transcribeSpeechSegmentsFromAudioUrl(
        data?.projectId || undefined,
        musicUrl,
        asrLang,
      );
      if (!isMusicJobAlive(gen)) return;
      const cleaned = formatDirectorLyricsFromAsr(result?.text, result?.segments);
      if (!cleaned) {
        showAlert(tt.musicLyricsExtractFailed);
        return;
      }
      patch(patchDirectorMvMusic(directorStateRef.current, { lyrics: cleaned }));
      showAlert(tt.musicLyricsStripMetaDone);
    } catch (e) {
      if (!isMusicJobAlive(gen) || isMusicJobAbortError(e)) return;
      const msg = e instanceof Error ? e.message : String(e || '');
      if (!(await promptAsrAuthOrBalance(e))) {
        showAlert(msg || tt.musicLyricsExtractFailed);
      }
    } finally {
      if (isMusicJobAlive(gen)) setBusyAction(null);
    }
  }, [
    beginMusicJob,
    busyAction,
    data?.isGenerating,
    data?.projectId,
    isMusicJobAbortError,
    isMusicJobAlive,
    patch,
    promptAsrAuthOrBalance,
    showAlert,
    tt.lyricTimelineNeedEngine,
    tt.musicLyricsExtractFailed,
    tt.musicLyricsStripMetaDone,
    tt.musicNeedFirst,
  ]);

  /** 声音切断：优先整曲云端 fun-asr；Demucs 可选增强，失败则整曲直送（返回是否成功） */
  const handleDetectLyricTimeline = useCallback(
    async (jobGen?: number): Promise<boolean> => {
      const cur = directorStateRef.current;
      const musicUrl = String(cur.mvMusic?.url || '').trim();
      if (!musicUrl) {
        showAlert(tt.musicNeedFirst);
        return false;
      }
      if (jobGen == null && (busyAction || cur.isGenerating || data?.isGenerating)) return false;
      if (!window.electronAPI?.transcribeSpeechSegmentsFromAudioUrl) {
        showAlert(tt.lyricTimelineNeedEngine);
        return false;
      }
      const gen = jobGen ?? beginMusicJob();
      setBusyAction('lyric-timeline');
      setLyricTimelineProgress(tt.lyricTimelineRunning);
      patch(
        patchDirectorMvMusic(cur, {
          lyricSegmentsStatus: 'transcribing',
          lyricSegmentsError: '',
        }),
      );
      try {
        const songDur = Number(cur.mvMusic?.durationSec) || 0;

        // fun-asr 支持带 BGM 整曲歌唱识别：优先整曲直送云端（Demucs 仍可供其它入口使用）
        setLyricTimelineProgress(tt.lyricTimelineRunningTranscribe);
        const asrLang = karaokeAsrLanguageToApiParam(
          directorStateRef.current.mvMusic?.asrLanguage,
        );
        const result = await window.electronAPI.transcribeSpeechSegmentsFromAudioUrl(
          data?.projectId || undefined,
          musicUrl,
          asrLang,
        );
        if (!isMusicJobAlive(gen)) return false;
        {
          const costN = Math.round(Number(result?.cost));
          if (result?.charged === false || !Number.isFinite(costN) || costN < 1) {
            showAlert(
              '未扣费：云端未返回 charged/cost。请上传含计费的 FC 包（demo/aliyun-fc-init-user/nexflow-fc.zip）后重试。',
            );
            return false;
          }
        }
        const lyricAsrWords = (result?.segments || []).flatMap((s) => {
          const words = Array.isArray(s?.words) ? s.words : [];
          return words
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
            .filter((w): w is { text: string; startSec: number; endSec: number } => !!w);
        });
        const rawSegs = (result?.segments || []).map((s, i) => ({
          id: `w-${i}`,
          text: String(s.text || '').trim(),
          startSec: Number(s.startSec) || 0,
          endSec: Number(s.endSec) || 0,
        }));
        let segments = coverSongWithLyricSegments(rawSegs, songDur);
        if (segments.length === 0 && String(result?.text || '').trim()) {
          segments = coverSongWithLyricSegments(
            [
              {
                id: 'w-full',
                text: String(result.text || '').trim().slice(0, 200),
                startSec: 0,
                endSec: Math.max(1, songDur || 5),
              },
            ],
            songDur || 5,
          );
        }
        if (segments.length === 0) {
          throw new Error(tt.lyricTimelineEmpty);
        }
        // 用用户已填歌词校准（先去掉歌名/词曲署名）；未填则回写清洗后的转写文本
        const userLyrics = stripDirectorLyricsScriptMeta(
          String(directorStateRef.current.mvMusic?.lyrics || ''),
        );
        if (userLyrics) {
          segments = calibrateLyricSegmentsWithUserLyrics(segments, userLyrics, songDur);
          patch(
            patchDirectorMvMusic(directorStateRef.current, {
              lyrics: userLyrics,
            }),
          );
        } else if (
          String(result?.text || '').trim() ||
          (result?.segments || []).some((s) => String(s?.text || '').trim())
        ) {
          const asrScript = formatDirectorLyricsFromAsr(result?.text, result?.segments);
          if (asrScript) {
            patch(
              patchDirectorMvMusic(directorStateRef.current, {
                lyrics: asrScript,
              }),
            );
          }
        }
        // 按长镜 10/15 或短镜 5/6 严丝合缝切段
        const packs = packLyricSegmentsIntoShotPacks(segments, {
          clipLengthMode: directorStateRef.current.mvMusic?.clipLengthMode,
        });
        let next = patchDirectorMvMusic(directorStateRef.current, {
          lyricSegments: segments,
          lyricSegmentsStatus: 'ready',
          lyricSegmentsError: '',
          lyricSegmentsSourceUrl: musicUrl,
          // 字级锚点供卡拉OK；切镜仍只用句级 lyricSegments
          lyricAsrWords,
        });
        if ((next.shots || []).length > 0 && packs.length > 0) {
          next = syncDirectorShotsToLyricTimeline(next);
        }
        if (!isMusicJobAlive(gen)) return false;
        patch({ ...next, error: '' });
        return true;
      } catch (e) {
        if (!isMusicJobAlive(gen) || isMusicJobAbortError(e)) return false;
        const raw = e instanceof Error ? e.message : String(e || '');
        const msg = /No handler registered|transcribe-speech-segments/i.test(raw)
          ? tt.lyricTimelineNeedEngine
          : raw || tt.lyricTimelineFailed;
        patch(
          patchDirectorMvMusic(directorStateRef.current, {
            lyricSegmentsStatus: 'error',
            lyricSegmentsError: msg,
          }),
        );
        if (!(await promptAsrAuthOrBalance(e))) {
          showAlert(msg);
        }
        return false;
      } finally {
        if (isMusicJobAlive(gen)) {
          setBusyAction(null);
          setLyricTimelineProgress('');
        }
      }
    },
    [
      beginMusicJob,
      busyAction,
      data?.isGenerating,
      data?.projectId,
      isMusicJobAbortError,
      isMusicJobAlive,
      patch,
      promptAsrAuthOrBalance,
      showAlert,
      tt.lyricTimelineEmpty,
      tt.lyricTimelineFailed,
      tt.lyricTimelineNeedEngine,
      tt.lyricTimelineRunning,
      tt.lyricTimelineRunningTranscribe,
      tt.musicNeedFirst,
    ],
  );

  /** 第一步分析：先分析总结/曲风与风格，再音频切断（不要求手填歌词） */
  const handleMvMusicAnalyze = useCallback(async () => {
    const cur0 = directorStateRef.current;
    if (!String(cur0.mvMusic?.url || '').trim()) {
      showAlert(tt.musicNeedFirst);
      return;
    }
    if (busyAction || cur0.isGenerating || data?.isGenerating) return;

    const gen = beginMusicJob();
    const hasStyleAnalysis = !!String(cur0.mvStoryAnalysis?.summary || '').trim();
    // 1) 分析总结 + 曲风与风格
    if (!hasStyleAnalysis) {
      setBusyAction('story-analyze');
      setLyricTimelineProgress(tt.lyricTimelineRunningStyle);
      try {
        const notes = String(data?.userPrompt || '').trim();
        const { systemPrompt, userPrompt } = buildDirectorMvStoryAnalyzeMessages(
          directorStateRef.current,
          notes,
        );
        const text = await runChat(systemPrompt, userPrompt);
        if (!isMusicJobAlive(gen)) return;
        const normalized = normalizeDirectorMvStoryAnalyzeResult(text);
        if (!normalized.ok) {
          throw new Error(normalized.error || tt.storyAnalyzeFailed);
        }
        const moodHint = [...normalized.emotions, ...normalized.keywords].filter(Boolean).join(' · ');
        let next = patchDirectorMvStoryAnalysis(directorStateRef.current, {
          summary: normalized.summary,
          genre: normalized.genre,
          emotions: normalized.emotions,
          keywords: normalized.keywords,
        });
        next = patchDirectorMvMusic(next, {
          summary: normalized.summary || next.mvMusic.summary,
          moodHint: moodHint || next.mvMusic.moodHint,
        });
        patch({ ...next, error: '' });
      } catch (e) {
        if (!isMusicJobAlive(gen) || isMusicJobAbortError(e)) return;
        const msg = e instanceof Error ? e.message : tt.storyAnalyzeFailed;
        console.warn('[Director] 风格分析失败，中止音频切断:', msg);
        patch({ ...directorStateRef.current, error: '' });
        showAlert(msg);
        return;
      } finally {
        if (isMusicJobAlive(gen)) {
          setBusyAction(null);
          setLyricTimelineProgress('');
        }
      }
    }

    if (!isMusicJobAlive(gen)) return;
    // 2) 音频切断（人声分离 + 分段）
    await handleDetectLyricTimeline(gen);
  }, [
    beginMusicJob,
    busyAction,
    data?.isGenerating,
    data?.userPrompt,
    handleDetectLyricTimeline,
    isMusicJobAbortError,
    isMusicJobAlive,
    patch,
    runChat,
    showAlert,
    tt.lyricTimelineRunningStyle,
    tt.musicNeedFirst,
    tt.storyAnalyzeFailed,
  ]);

  /** 不重跑 Whisper：有歌词则先清元信息再校准；始终按当前长短镜档位重新切段（歌词不重复） */
  const handleRecalibrateLyricPacks = useCallback(() => {
    const cur = directorStateRef.current;
    const prevSegs = cur.mvMusic?.lyricSegments || [];
    if (prevSegs.length === 0) {
      showAlert(tt.lyricTimelineRecalibrateNeed);
      return;
    }
    const lyricsClean = stripDirectorLyricsScriptMeta(String(cur.mvMusic?.lyrics || ''));
    const songDur =
      Number(cur.mvMusic?.durationSec) ||
      (prevSegs.length ? Number(prevSegs[prevSegs.length - 1]?.endSec) || 0 : 0);
    let segments = coverSongWithLyricSegments(prevSegs, songDur);
    if (lyricsClean) {
      segments = calibrateLyricSegmentsWithUserLyrics(segments, lyricsClean, songDur);
    }
    const packs = packLyricSegmentsIntoShotPacks(segments, {
      clipLengthMode: cur.mvMusic?.clipLengthMode || 'short',
    });
    let next = patchDirectorMvMusic(cur, {
      lyrics: lyricsClean || String(cur.mvMusic?.lyrics || ''),
      lyricSegments: segments,
      lyricSegmentsStatus: 'ready',
      lyricSegmentsError: '',
      ...(songDur > 0 && !(Number(cur.mvMusic?.durationSec) > 0)
        ? { durationSec: songDur }
        : {}),
    });
    if ((next.shots || []).length > 0 && packs.length > 0) {
      next = syncDirectorShotsToLyricTimeline(next);
    }
    patch({ ...next, error: '' });
    showAlert(
      fillDirectorI18n(tt.lyricTimelineRecalibrateDone, {
        packs: String(Math.max(1, packs.length)),
      }),
    );
  }, [
    patch,
    showAlert,
    tt.lyricTimelineRecalibrateDone,
    tt.lyricTimelineRecalibrateNeed,
  ]);

  const handleClearLyricTimeline = useCallback(() => {
    const cur = directorStateRef.current;
    patch(
      patchDirectorMvMusic(cur, {
        lyricSegments: [],
        lyricSegmentsStatus: 'idle',
        lyricSegmentsError: '',
        lyricSegmentsSourceUrl: '',
        lyricAsrWords: [],
      }),
    );
  }, [patch]);

  const handleDeleteLyricPack = useCallback(
    (segmentIds: string[], startSec: number, endSec: number) => {
      const cur = directorStateRef.current;
      const prev = cur.mvMusic?.lyricSegments || [];
      if (prev.length === 0) return;
      const idSet = new Set(segmentIds.map((id) => String(id || '').trim()).filter(Boolean));
      const nextSegs = prev.filter((seg) => {
        const id = String(seg.id || '').trim();
        if (id && idSet.has(id)) return false;
        if (idSet.size > 0) return true;
        // 无 id 时按时间重叠删除
        const overlap =
          Math.min(Number(seg.endSec) || 0, endSec) - Math.max(Number(seg.startSec) || 0, startSec);
        return overlap < 0.08;
      });
      let next = patchDirectorMvMusic(cur, {
        lyricSegments: nextSegs,
        lyricSegmentsStatus: nextSegs.length > 0 ? 'ready' : 'idle',
        lyricSegmentsError: '',
      });
      if ((next.shots || []).length > 0 && nextSegs.length > 0) {
        next = syncDirectorShotsToLyricTimeline(next);
      }
      patch({ ...next, error: '' });
    },
    [patch],
  );

  /** 生成可确认的故事大纲 */
  const handleMvStoryOutline = useCallback(async () => {
    let cur0 = directorStateRef.current;
    const lyrics = String(cur0.mvMusic?.lyrics || '').trim();
    const title = String(cur0.mvMusic?.title || '').trim();
    if (!lyrics && !title) {
      showAlert(tt.storyNeedLyricsOrTitle);
      return;
    }
    const hasMusicAnalysis =
      !!String(cur0.mvStoryAnalysis?.summary || '').trim() ||
      !!String(cur0.mvMusic?.summary || '').trim() ||
      !!String(cur0.mvMusic?.moodHint || '').trim();
    if (!hasMusicAnalysis) {
      showAlert(tt.storyNeedMusicAnalysis);
      return;
    }
    if (busyAction || cur0.isGenerating || data?.isGenerating) return;
    // 故事聊天只用本地 busyAction，勿抬 isGenerating（会打穿 Workspace/autosave 导致整节点卡顿）
    let prep = cur0;
    let needPrepPatch = false;
    if (!String(prep.mvStoryAnalysis?.summary || '').trim()) {
      const musicSummary = String(prep.mvMusic?.summary || '').trim();
      const moodParts = String(prep.mvMusic?.moodHint || '')
        .split(/[·•|,，/]/)
        .map((s) => s.trim())
        .filter(Boolean);
      prep = patchDirectorMvStoryAnalysis(prep, {
        summary: musicSummary || prep.mvStoryAnalysis?.summary,
        ...(moodParts.length && !(prep.mvStoryAnalysis?.emotions || []).length
          ? { emotions: moodParts.slice(0, 4), keywords: moodParts.slice(4) }
          : {}),
      });
      needPrepPatch = true;
    }
    if (prep.error || prep.phase !== 'story') {
      prep = { ...prep, error: '', phase: 'story' };
      needPrepPatch = true;
    }
    setBusyAction('story-outline');
    if (needPrepPatch) patch(prep);
    clearDirectorChatTextStash(directorPhaseChatKey(id));
    const useRefNotes = directorStateRef.current.mvScriptUseReferenceGen !== false;
    const notes = useRefNotes
      ? String(directorStateRef.current.mvScriptReference || '').trim()
      : '';
    try {
      const cur = directorStateRef.current;
      const { systemPrompt, userPrompt } = buildDirectorMvStoryOutlineMessages(cur, notes);
      const chatModel = String(cur.chatModel || '').trim();
      const isTerra = chatModel === LLM_CHAT_MODEL_GPT56_TERRA;
      const isRegen = !!String(cur.mvStoryOutline || '').trim();
      const text = await runDirectorChatWithRetry(systemPrompt, userPrompt, {
        // 目标约 280–480 字；压低 max_tokens 缩短尾延迟，降低触顶 FC 180s
        max_tokens: isTerra ? 1200 : 900,
        temperature: isRegen ? 0.92 : 0.65,
        retries: 1,
      });
      const raw = String(text || '').trim();
      if (!raw) {
        throw new Error('模型返回为空（网络或上游未返回正文），请重试');
      }
      if (!applyMvStoryOutlineFromChat(raw)) {
        throw new Error(tt.storyOutlineFailed);
      }
      requestAnimationFrame(() => {
        document
          .querySelector('[data-director-story-toolbar="1"]')
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    } catch (e) {
      const currentGen = chatGenRef.current;
      const currentReqId = `director-chat-${id}-${currentGen}`;
      const stashed = consumeStashedDirectorChatText(directorPhaseChatKey(id), currentReqId);
      if (stashed && applyMvStoryOutlineFromChat(stashed)) {
        return;
      }
      if (!mountedRef.current) return;
      if (isDirectorChatAbortError(e)) {
        patch({ ...directorStateRef.current, isGenerating: false, error: '' });
        return;
      }
      const msg = isDirectorChatTimeoutError(e)
        ? tt.storyLlmTimeout
        : formatCloudLlmUserError(
            e instanceof Error && e.message ? e.message : tt.storyOutlineFailed,
          );
      patch({ ...directorStateRef.current, isGenerating: false, error: msg });
      // 关掉可能盖住弹窗的超高 z 悬停层，避免「确定」点不到
      setPromptHover(null);
      setPromptPreview(null);
      setImagePreview(null);
      setVideoPreview(null);
      window.setTimeout(() => {
        void showAlert(msg);
      }, 0);
    } finally {
      setBusyAction(null);
    }
  }, [
    applyMvStoryOutlineFromChat,
    busyAction,
    data?.isGenerating,
    id,
    isDirectorChatAbortError,
    isDirectorChatTimeoutError,
    patch,
    runDirectorChatWithRetry,
    showAlert,
    tt.storyLlmTimeout,
    tt.storyNeedLyricsOrTitle,
    tt.storyNeedMusicAnalysis,
    tt.storyOutlineFailed,
  ]);

  /** 生成剧本：有故事即可，无需单独点「确认故事」 */
  const handleMvStoryOneShot = useCallback(async () => {
    let cur0 = directorStateRef.current;
    const lyrics = String(cur0.mvMusic?.lyrics || '').trim();
    const title = String(cur0.mvMusic?.title || '').trim();
    if (!lyrics && !title) {
      showAlert(tt.storyNeedLyricsOrTitle);
      return;
    }
    const hasMusicAnalysis =
      !!String(cur0.mvStoryAnalysis?.summary || '').trim() ||
      !!String(cur0.mvMusic?.summary || '').trim() ||
      !!String(cur0.mvMusic?.moodHint || '').trim();
    if (!hasMusicAnalysis) {
      showAlert(tt.storyNeedMusicAnalysis);
      return;
    }
    const outline = String(cur0.mvStoryOutline || '').trim();
    if (!outline) {
      showAlert(tt.storyNeedOutline);
      return;
    }
    if (busyAction || cur0.isGenerating || data?.isGenerating) return;
    // 剧本聊天只用 busyAction；开场合并为最多一次 patch，避免连点触发多次画布更新
    let prep = cur0;
    let needPrepPatch = false;
    if (!prep.mvStoryOutlineConfirmed) {
      prep = patchDirectorMvScriptInput(prep, {
        mvStoryOutline: outline,
        mvStoryOutlineConfirmed: true,
      });
      needPrepPatch = true;
    }
    if (!String(prep.mvStoryAnalysis?.summary || '').trim()) {
      const musicSummary = String(prep.mvMusic?.summary || '').trim();
      const moodParts = String(prep.mvMusic?.moodHint || '')
        .split(/[·•|,，/]/)
        .map((s) => s.trim())
        .filter(Boolean);
      prep = patchDirectorMvStoryAnalysis(prep, {
        summary: musicSummary || prep.mvStoryAnalysis?.summary,
        ...(moodParts.length && !(prep.mvStoryAnalysis?.emotions || []).length
          ? { emotions: moodParts.slice(0, 4), keywords: moodParts.slice(4) }
          : {}),
      });
      needPrepPatch = true;
    }
    if (prep.error || prep.phase !== 'story') {
      prep = { ...prep, error: '', phase: 'story' };
      needPrepPatch = true;
    }
    setBusyAction('story-script');
    if (needPrepPatch) patch(prep);
    clearDirectorChatTextStash(directorPhaseChatKey(id));
    // 大段数分批：批次更小更快；中途超时保留已生成部分
    try {
      const cur = directorStateRef.current;
      const chatModel = String(cur.chatModel || '').trim();
      const isTerra = chatModel === LLM_CHAT_MODEL_GPT56_TERRA;
      const clipCount = resolveDirectorMvAudioClipCount(cur);
      const totalSeg = Math.max(6, clipCount || 10);
      // 4o 等非 terra：小批次更容易在 FC 180s 内跑完，减少首包截断/502
      const CHUNK = isTerra
        ? totalSeg >= 28
          ? 8
          : totalSeg >= 18
            ? 10
            : 12
        : totalSeg >= 28
          ? 6
          : 8;
      const tokensForBatch = (batchLen: number) => {
        const n = Math.max(4, batchLen);
        if (isTerra) {
          if (n <= 8) return 2560;
          if (n <= 12) return 3584;
          return 4608;
        }
        if (n <= 6) return 2048;
        if (n <= 8) return 2560;
        return 3584;
      };

      const emptyScriptSections = () => ({
        plot: '',
        worldView: '',
        relationships: '',
        characters: '',
        scenes: '',
        props: '',
      });

      const parseScriptBatchText = (raw: string) => {
        const normalized = normalizeDirectorMvScriptResult(raw);
        let rows =
          (normalized.ok ? parseDirectorMvPlotBeatTable(normalized.sections.plot || '') : null) ||
          parseDirectorMvPlotBeatTable(String(raw || '')) ||
          [];
        rows = rows.map((r, i) => ({ ...r, no: String(i + 1) }));
        return { normalized, rows };
      };

      const commitPartial = (
        baseSections: {
          plot: string;
          worldView: string;
          relationships: string;
          characters: string;
          scenes: string;
          props: string;
        },
        rows: NonNullable<ReturnType<typeof parseDirectorMvPlotBeatTable>>,
        keywords: string[],
        opts?: { syncCast?: boolean },
      ) => {
        let sections = {
          ...baseSections,
          plot: formatDirectorMvPlotBeatTable(rows.map((r, i) => ({ ...r, no: String(i + 1) }))),
        };
        sections =
          totalSeg > 0 ? alignDirectorMvScriptSectionsToClipCount(sections, totalSeg) : sections;
        const script = composeDirectorMvScriptText(sections);
        let next = {
          ...directorStateRef.current,
          scriptText: script,
          isGenerating: false,
          error: '',
        };
        next = patchDirectorMvStoryAnalysis(next, {
          scriptKeywords: keywords,
          sections,
        });
        if (opts?.syncCast !== false) {
          next = applyAutoDirectorMvCastPlan(next);
        }
        if ((next.shots || []).length > 0) {
          next = bumpDirectorScriptContentRevision(next);
        }
        // 大剧本写回延后，避免阻塞「取消」按钮与工具栏
        startTransition(() => {
          patch(next);
        });
      };

      const firstTo = Math.min(CHUNK, totalSeg);
      const isRegenScript = !!String(
        cur.scriptText || cur.mvStoryAnalysis?.sections?.plot || '',
      ).trim();

      const runFirstScriptBatch = async (batchTo: number, useJson: boolean) => {
        const { systemPrompt, userPrompt } = buildDirectorMvScriptMessages(
          directorStateRef.current,
          undefined,
          {
            batchFrom: 1,
            batchTo,
            totalSegments: totalSeg,
          },
        );
        const text = await runDirectorChatWithRetry(systemPrompt, userPrompt, {
          max_tokens: tokensForBatch(batchTo),
          temperature: isRegenScript ? 0.88 : 0.65,
          ...(useJson ? { response_format: { type: 'json_object' } } : {}),
          retries: 1,
        });
        return parseScriptBatchText(String(text || ''));
      };

      let normalized: ReturnType<typeof normalizeDirectorMvScriptResult> | null = null;
      let plotRows: NonNullable<ReturnType<typeof parseDirectorMvPlotBeatTable>> = [];
      let firstErr: unknown = null;
      try {
        const r = await runFirstScriptBatch(firstTo, true);
        normalized = r.normalized.ok ? r.normalized : r.normalized;
        plotRows = r.rows;
      } catch (e) {
        firstErr = e;
        if (isDirectorChatAbortError(e) && !isDirectorChatTimeoutError(e)) throw e;
        const currentReqId = `director-chat-${id}-${chatGenRef.current}`;
        const stashed = consumeStashedDirectorChatText(directorPhaseChatKey(id), currentReqId);
        if (stashed) {
          const r = parseScriptBatchText(stashed);
          plotRows = r.rows;
          if (r.normalized.ok) normalized = r.normalized;
        }
      }
      if (plotRows.length < 2) {
        if (isCloudRateLimitError(firstErr)) {
          await new Promise((r) => setTimeout(r, 16_000));
          if (!mountedRef.current) throw firstErr;
        }
        const retryTo = Math.min(6, totalSeg);
        try {
          const r = await runFirstScriptBatch(retryTo, false);
          if (r.rows.length > plotRows.length || (r.normalized.ok && r.rows.length >= 2)) {
            plotRows = r.rows;
            if (r.normalized.ok) normalized = r.normalized;
          }
        } catch (e2) {
          if (isDirectorChatAbortError(e2) && !isDirectorChatTimeoutError(e2)) throw e2;
          const currentReqId = `director-chat-${id}-${chatGenRef.current}`;
          const stashed = consumeStashedDirectorChatText(directorPhaseChatKey(id), currentReqId);
          if (stashed) {
            const r = parseScriptBatchText(stashed);
            if (r.rows.length > plotRows.length) {
              plotRows = r.rows;
              if (r.normalized.ok) normalized = r.normalized;
            }
          }
          if (plotRows.length < 2) {
            if (firstErr) throw firstErr;
            throw e2;
          }
        }
      }
      if (!normalized?.ok) {
        if (plotRows.length >= 2) {
          const sections = {
            ...emptyScriptSections(),
            plot: formatDirectorMvPlotBeatTable(plotRows),
          };
          normalized = {
            ok: true,
            script: composeDirectorMvScriptText(sections),
            scriptKeywords: [],
            sections,
            rawJson: '',
          };
        } else {
          console.warn('[DirectorNode] MV 剧本解析失败', {
            model: chatModel,
            error: normalized?.error,
            textLen: plotRows.length,
          });
          throw new Error(normalized?.error || tt.storyScriptFailed);
        }
      }
      if (!normalized || !normalized.ok) {
        throw new Error(tt.storyScriptFailed);
      }

      plotRows = plotRows.map((r, i) => ({ ...r, no: String(i + 1) }));

      let guard = 0;
      while (plotRows.length < totalSeg && guard < 10) {
        guard += 1;
        const batchFrom = plotRows.length + 1;
        const batchTo = Math.min(totalSeg, plotRows.length + CHUNK);
        const priorTail = formatDirectorMvPlotBeatTable(plotRows.slice(-3));
        const sceneNames = String(normalized.sections.scenes || '')
          .split(/\n+/)
          .map((line) => String(line || '').split(/[:：]/)[0]?.trim())
          .filter(Boolean)
          .slice(0, 8)
          .join('、');
        const cont = buildDirectorMvScriptPlotContinueMessages(directorStateRef.current, {
          batchFrom,
          batchTo,
          totalSegments: totalSeg,
          priorPlotTail: priorTail,
          sceneNames,
        });
        let contText = '';
        try {
          contText = await runDirectorChatWithRetry(cont.systemPrompt, cont.userPrompt, {
            max_tokens: tokensForBatch(batchTo - batchFrom + 1),
            temperature: 0.6,
            response_format: { type: 'json_object' },
            retries: 1,
          });
        } catch (contErr) {
          if (
            (isDirectorChatTimeoutError(contErr) || isDirectorChatAbortError(contErr)) &&
            plotRows.length >= 2
          ) {
            commitPartial(normalized.sections, plotRows, normalized.scriptKeywords || []);
            forceClearVoiceModalLock();
            setPromptHover(null);
            setPromptPreview(null);
            const soft = `已生成 ${plotRows.length}/${totalSeg} 段后中断，已写入现有剧情表。可再点「生成剧本」或切「长镜」减段。`;
            window.setTimeout(() => {
              void showAlert(soft, { stackZClass: 'z-[2147483646]' });
            }, 0);
            return;
          }
          throw contErr;
        }
        const contNorm = normalizeDirectorMvScriptResult(contText);
        const more =
          (contNorm.ok ? parseDirectorMvPlotBeatTable(contNorm.sections.plot || '') : null) ||
          (() => {
            try {
              const raw = String(contText || '').trim();
              const j = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
              const plot = j?.plot;
              if (Array.isArray(plot)) {
                return parseDirectorMvPlotBeatTable(JSON.stringify(plot));
              }
              if (typeof plot === 'string') return parseDirectorMvPlotBeatTable(plot);
            } catch {
              /* ignore */
            }
            return null;
          })();
        if (!more?.length) {
          if (plotRows.length >= 2) {
            commitPartial(normalized.sections, plotRows, normalized.scriptKeywords || []);
            forceClearVoiceModalLock();
            setPromptHover(null);
            const soft = `续写未返回新行（已有 ${plotRows.length}/${totalSeg}），已保存现有剧情表。请重试或切「长镜」。`;
            window.setTimeout(() => {
              void showAlert(soft, { stackZClass: 'z-[2147483646]' });
            }, 0);
            return;
          }
          throw new Error(
            `剧情表续写失败（已有 ${plotRows.length}/${totalSeg} 段）。请重试；或先切「长镜」减少片段数`,
          );
        }
        const before = plotRows.length;
        for (const row of more) {
          if (plotRows.length >= totalSeg) break;
          plotRows.push({ ...row, no: String(plotRows.length + 1) });
        }
        if (plotRows.length <= before) {
          throw new Error(
            `剧情表续写无新增行（已有 ${plotRows.length}/${totalSeg}）。请重试或切「长镜」减段`,
          );
        }
      }

      if (plotRows.length < Math.max(3, Math.ceil(totalSeg * 0.55))) {
        if (plotRows.length >= 2) {
          commitPartial(normalized.sections, plotRows, normalized.scriptKeywords || []);
          forceClearVoiceModalLock();
          const soft = `已写入 ${plotRows.length}/${totalSeg} 段（未写满）。可再点「生成剧本」续写，或切「长镜」减段。`;
          window.setTimeout(() => {
            void showAlert(soft, { stackZClass: 'z-[2147483646]' });
          }, 0);
          return;
        }
        throw new Error(
          `剧情表仅 ${plotRows.length} 行，目标 ${totalSeg} 段。请重试；段数很多时可先切「长镜」减少片段数`,
        );
      }

      commitPartial(normalized.sections, plotRows, normalized.scriptKeywords || []);
    } catch (e) {
      if (isDirectorChatAbortError(e)) {
        forceClearVoiceModalLock();
        patch({ ...directorStateRef.current, isGenerating: false, error: '' });
        return;
      }
      if (isDirectorChatTimeoutError(e)) {
        const msg = tt.storyLlmTimeout;
        forceClearVoiceModalLock();
        patch({ ...directorStateRef.current, isGenerating: false, error: msg });
        setPromptHover(null);
        setPromptPreview(null);
        setImagePreview(null);
        setVideoPreview(null);
        window.setTimeout(() => {
          void showAlert(msg, { stackZClass: 'z-[2147483646]' });
        }, 0);
        return;
      }
      const rawMsg = e instanceof Error ? e.message : String(e || '');
      const msg = isCloudRateLimitError(e)
        ? formatCloudLlmUserError(e)
        : /ETIMEDOUT|ECONNREFUSED|ENOTFOUND|timeout|网络|连接|DNS|fetch failed|Failed to fetch|NX_AUTH|登录/i.test(
              rawMsg,
            )
          ? `剧本生成失败（网络/上游）：${rawMsg || tt.storyScriptFailed}`
          : /无法解析|剧本正文为空|非合法 JSON|被截断/i.test(rawMsg)
            ? rawMsg
            : formatCloudLlmUserError(rawMsg || tt.storyScriptFailed);
      forceClearVoiceModalLock();
      patch({ ...directorStateRef.current, isGenerating: false, error: msg });
      setPromptHover(null);
      setPromptPreview(null);
      window.setTimeout(() => {
        void showAlert(msg, { stackZClass: 'z-[2147483646]' });
      }, 0);
    } finally {
      setBusyAction(null);
    }
  }, [
    busyAction,
    data?.isGenerating,
    id,
    isDirectorChatAbortError,
    isDirectorChatTimeoutError,
    patch,
    runDirectorChatWithRetry,
    showAlert,
    tt.storyLlmTimeout,
    tt.storyNeedLyricsOrTitle,
    tt.storyNeedMusicAnalysis,
    tt.storyNeedOutline,
    tt.storyScriptFailed,
  ]);

  const renderMvStoryTag = (label: string, key: string) => (
    <span
      key={key}
      className={`inline-flex items-center rounded-md px-2 py-0.5 ${
        isDarkMode ? 'bg-white/10 text-white/80' : 'bg-gray-100 text-gray-700'
      }`}
      style={{ fontSize: fsChrome }}
    >
      {label}
    </span>
  );

  const handleDramaStoryOneShot = useCallback(async () => {
    let cur0 = ensureDirectorMvLeadSlots(directorStateRef.current);
    const source = String(cur0.mvScriptReference || cur0.scriptText || '').trim();
    if (!source) {
      showAlert(tt.dramaStoryNeedSource);
      return;
    }
    if (busyAction || cur0.isGenerating || data?.isGenerating) return;
    setBusyAction('story-script');
    // 保留原始剧本草稿；勿抬 isGenerating，避免整画布重渲卡顿
    const prep = {
      ...cur0,
      mvScriptReference: String(cur0.mvScriptReference || '').trim() || source,
      error: '',
      phase: 'story' as const,
    };
    if (
      prep.mvScriptReference !== cur0.mvScriptReference ||
      prep.error !== cur0.error ||
      prep.phase !== cur0.phase
    ) {
      patch(prep);
    }
    try {
      const cur = directorStateRef.current;
      const { systemPrompt, userPrompt } = buildDirectorDramaScriptMessages(cur, source, 12);
      const chatModel = String(cur.chatModel || '').trim();
      const isTerra = chatModel === LLM_CHAT_MODEL_GPT56_TERRA;
      const text = await runDirectorChatWithRetry(systemPrompt, userPrompt, {
        max_tokens: isTerra ? 16384 : 12288,
        temperature: 0.7,
        ...(isTerra ? { response_format: { type: 'json_object' } } : {}),
        retries: 1,
      });
      if (!String(text || '').trim()) {
        throw new Error('模型返回为空（网络或上游未返回正文），请重试');
      }
      const normalized = normalizeDirectorMvScriptResult(text);
      if (!normalized.ok) {
        throw new Error(normalized.error || tt.storyScriptFailed);
      }
      let next = applyDirectorDramaScriptResult(directorStateRef.current, normalized);
      next = ensureDirectorDramaShotsFromScript(next, {
        keepPhase: true,
        preferExistingShots: !!(normalized.shots && normalized.shots.length > 0),
      });
      next = syncDirectorMvScenesFromScript(next, 'fill');
      next = {
        ...next,
        mvScriptReference: String(next.mvScriptReference || '').trim() || source,
        isGenerating: false,
        error: '',
        // 留在「剧本解析」步，直接展示分析结果分镜表
        phase: 'story',
      };
      patch(next);
    } catch (e) {
      if (isDirectorChatAbortError(e)) {
        patch({ ...directorStateRef.current, isGenerating: false, error: '' });
        return;
      }
      const msg = isDirectorChatTimeoutError(e)
        ? tt.storyLlmTimeout
        : formatCloudLlmUserError(
            e instanceof Error && e.message ? e.message : tt.storyScriptFailed,
          );
      patch({ ...directorStateRef.current, isGenerating: false, error: msg });
      showAlert(msg);
    } finally {
      setBusyAction(null);
    }
  }, [
    busyAction,
    data?.isGenerating,
    isDirectorChatAbortError,
    isDirectorChatTimeoutError,
    patch,
    runDirectorChatWithRetry,
    showAlert,
    tt.dramaStoryNeedSource,
    tt.storyLlmTimeout,
    tt.storyScriptFailed,
  ]);

  const renderDramaStoryPanel = () => {
    const linked = absorbedScript;
    const draft = String(state.mvScriptReference || '').trim();
    const source = draft || linked;
    const shotN = (state.shots || []).length;
    const hasShotTable = shotN > 0;
    // 已有分析结果：只展示分镜表（脚本编辑与分析入口在顶栏）
    if (hasShotTable) {
      return (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden px-0.5">
          {renderShotsConfirmPanel({
            includeGenerateBar: true,
            forceShow: true,
            className: 'flex flex-col flex-1 min-h-0 gap-1',
            tableScrollClass: 'nowheel flex-1 min-h-0 overflow-auto custom-scrollbar-dark',
          })}
        </div>
      );
    }
    return (
      <div className="flex flex-col flex-1 min-h-0 gap-2 overflow-hidden px-0.5">
        <DirectorStoryReferenceVoiceField
          value={source}
          onChange={(v) => {
            patch({
              ...directorStateRef.current,
              mvScriptReference: v,
              scriptText: directorMvScriptSectionsHaveContent(
                directorStateRef.current.mvStoryAnalysis?.sections,
              )
                ? directorStateRef.current.scriptText
                : v || linked,
            });
          }}
          isDarkMode={isDarkMode}
          placeholder={tt.dramaStorySourcePlaceholder}
          textareaClassName={`nodrag nowheel w-full flex-1 min-h-[10rem] resize-none rounded-lg border px-2.5 py-2 text-[12px] outline-none ${
            isDarkMode
              ? 'border-white/12 bg-black/35 text-white/90 placeholder:text-white/35'
              : 'border-gray-300 bg-white text-gray-900 placeholder:text-gray-400'
          }`}
          minHeightPx={160}
          rows={8}
          labels={{
            voiceStart: tt.aiReviseFinalPromptVoiceStart,
            voiceStop: tt.aiReviseFinalPromptVoiceStop,
            voiceBusy: tt.aiReviseFinalPromptVoiceBusy,
            micDenied: tt.aiReviseFinalPromptMicDenied,
          }}
          onError={showAlert}
        />
      </div>
    );
  };

  const renderMvStoryPanel = () => {
    const analysis = state.mvStoryAnalysis;
    const musicSummary = String(state.mvMusic?.summary || '').trim();
    const moodHint = String(state.mvMusic?.moodHint || '').trim();
    const summary = String(analysis?.summary || '').trim() || musicSummary;
    const genre = String(analysis?.genre || '').trim();
    const emotions =
      (analysis?.emotions || []).length > 0
        ? analysis!.emotions
        : moodHint
          ? moodHint
              .split(/[·•|,，/]/)
              .map((s) => s.trim())
              .filter(Boolean)
              .slice(0, 6)
          : [];
    const keywords = analysis?.keywords || [];
    const scriptKeywords = analysis?.scriptKeywords || [];
    const writingOutline = busyAction === 'story-outline';
    const writingScript = busyAction === 'story-script' || busyAction === 'story-oneshot';
    const storyOutline = String(
      storyOutlineLocal != null ? storyOutlineLocal : state.mvStoryOutline || '',
    );
    const storyOutlineConfirmed = !!state.mvStoryOutlineConfirmed;
    const hasStoryOutline = !!storyOutline.trim();
    const useRefGen = state.mvScriptUseReferenceGen !== false;
    const toggleStoryRefGen = () => {
      const cur = directorStateRef.current;
      const nextOn = !(cur.mvScriptUseReferenceGen !== false);
      // 同步 patch：勿用 startTransition（剧本步重渲染时会被推迟，看起来像「点不动」）
      // 顺带清掉卡住的 isGenerating，避免开关能动但故事按钮仍灰
      patch(
        patchDirectorMvScriptInput(
          { ...cur, isGenerating: false },
          { mvScriptUseReferenceGen: nextOn },
        ),
      );
    };
    const scriptReference = String(state.mvScriptReference || '');
    const storedSections = normalizeDirectorMvScriptSections(analysis?.sections);
    const scriptSections: DirectorMvScriptSections = directorMvScriptSectionsHaveContent(storedSections)
      ? storedSections
      : parseDirectorMvScriptSectionsFromText(String(state.scriptText || ''));
    const sectionDefs: Array<{
      key: keyof DirectorMvScriptSections;
      label: string;
      placeholder: string;
      minH: string;
      minHeightPx: number;
    }> = [
      { key: 'plot', label: tt.storySectionPlot, placeholder: tt.storySectionPlotPh, minH: '7rem', minHeightPx: 112 },
      {
        key: 'worldView',
        label: tt.storySectionWorldView,
        placeholder: tt.storySectionWorldViewPh,
        minH: '4.5rem',
        minHeightPx: 72,
      },
      {
        key: 'relationships',
        label: tt.storySectionRelationships,
        placeholder: tt.storySectionRelationshipsPh,
        minH: '4.5rem',
        minHeightPx: 72,
      },
      {
        key: 'characters',
        label: tt.storySectionCharacters,
        placeholder: tt.storySectionCharactersPh,
        minH: '4.5rem',
        minHeightPx: 72,
      },
      {
        key: 'scenes',
        label: tt.storySectionScenes,
        placeholder: tt.storySectionScenesPh,
        minH: '4rem',
        minHeightPx: 64,
      },
      {
        key: 'props',
        label: tt.storySectionProps,
        placeholder: tt.storySectionPropsPh,
        minH: '3.5rem',
        minHeightPx: 56,
      },
    ];
    const patchScriptSection = (key: keyof DirectorMvScriptSections, value: string) => {
      const nextSections = { ...scriptSections, [key]: value };
      const cur = directorStateRef.current;
      let next = { ...cur, scriptText: composeDirectorMvScriptText(nextSections) };
      next = patchDirectorMvStoryAnalysis(next, { sections: nextSections });
      patch(next);
    };
    const cardCls = `rounded-2xl border px-3 py-2.5 ${
      isDarkMode ? 'border-white/15 bg-white/[0.06]' : 'border-gray-200 bg-gray-100'
    }`;
    const sectionInputCls = `nodrag nowheel w-full rounded-xl border px-2.5 py-2 outline-none focus:ring-1 overflow-hidden resize-none ${
      isDarkMode
        ? 'border-white/10 bg-black/20 text-white/85 placeholder:text-white/30 focus:ring-sky-400/40'
        : 'border-gray-200 bg-gray-100 text-gray-800 placeholder:text-gray-400 focus:ring-sky-400/50'
    }`;
    const growStoryTextarea = (el: HTMLTextAreaElement | null, minHeightPx: number) => {
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${Math.max(minHeightPx, el.scrollHeight)}px`;
    };
    return (
      <div className="flex flex-col flex-1 min-h-0 gap-3">
        <div
          data-director-story-toolbar="1"
          className={`shrink-0 sticky top-0 z-20 relative overflow-visible flex items-center justify-between gap-2 flex-wrap rounded-xl px-1 py-1.5 -mx-0.5 ${
            writingOutline || writingScript
              ? isDarkMode
                ? 'bg-zinc-950'
                : 'bg-gray-100'
              : isDarkMode
                ? 'bg-zinc-950/95 backdrop-blur-sm'
                : 'bg-gray-100/95 backdrop-blur-sm'
          }`}
        >
          <div className="relative z-30 pointer-events-auto flex items-center gap-4 flex-wrap shrink-0">
          <div
            className="nodrag nopan pointer-events-auto inline-flex items-center gap-2 select-none shrink-0"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            title={useRefGen ? tt.storyRefGenOnHint : tt.storyManualHint}
          >
            <button
              type="button"
              role="switch"
              aria-checked={useRefGen}
              aria-label={tt.storyRefGenSwitchLabel}
              className={`nodrag nopan relative z-30 pointer-events-auto h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50 ${
                useRefGen
                  ? isDarkMode
                    ? 'bg-sky-500/85'
                    : 'bg-gray-700'
                  : isDarkMode
                    ? 'bg-white/20'
                    : 'bg-gray-300'
              }`}
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
              onMouseDown={(e) => {
                // 用 mousedown 切换，避免 RF / 重渲染下 click 丢失
                e.preventDefault();
                e.stopPropagation();
                toggleStoryRefGen();
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <span
                className={`pointer-events-none absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  useRefGen ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
            <button
              type="button"
              className={`nodrag nopan pointer-events-auto font-medium ${bodyCls} cursor-pointer bg-transparent border-0 p-0 text-left`}
              style={{ fontSize: fsChrome }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleStoryRefGen();
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              {tt.storyRefGenSwitchLabel}
            </button>
          </div>
          {renderCloseUpFramingSwitch()}
          {renderShotChangePaceSelect({ compact: true })}
          </div>
          <div className="relative z-[40] flex items-center gap-2 shrink-0 overflow-visible ml-auto">
            {renderChatModelSelect()}
            <div className="relative z-[40] flex items-center gap-1.5 shrink-0 overflow-visible">
              <div
                className="relative overflow-visible"
                onMouseEnter={() => {
                  setPriceHoverKey('story-outline');
                }}
                onMouseLeave={() => setPriceHoverKey((k) => (k === 'story-outline' ? null : k))}
              >
                {priceHoverKey === 'story-outline' ? (
                  <span
                    className={`${yuanbaoHoverTipCls} translate-y-0 opacity-100`}
                    title={tt.priceTooltip}
                  >
                    {formatChatYuanbaoLabel()}
                  </span>
                ) : null}
                <button
                  type="button"
                  className={`nodrag nopan inline-flex items-center ${btnPrimary('!px-2.5 !py-1', 'operators')} disabled:opacity-50`}
                  style={{ fontSize: fsChrome }}
                  disabled={writingOutline ? false : isStoryToolbarBusy}
                  title={writingOutline ? tt.storyCancelChatHint : tt.priceTooltip}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (writingOutline) {
                      cancelDirectorChat('user');
                      return;
                    }
                    void handleMvStoryOutline();
                  }}
                >
                  {writingOutline ? <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" /> : null}
                  {writingOutline ? tt.musicJobCancel : tt.storyGenerateOutlineBtn}
                </button>
              </div>
              <div
                className="relative overflow-visible"
                onMouseEnter={() => {
                  setPriceHoverKey('story-oneshot');
                }}
                onMouseLeave={() => setPriceHoverKey((k) => (k === 'story-oneshot' ? null : k))}
              >
                {priceHoverKey === 'story-oneshot' ? (
                  <span
                    className={`${yuanbaoHoverTipCls} translate-y-0 opacity-100`}
                    title={tt.priceTooltip}
                  >
                    {formatChatYuanbaoLabel()}
                  </span>
                ) : null}
                <button
                  type="button"
                  className={`nodrag nopan inline-flex items-center ${btnPrimary('!px-2.5 !py-1', 'operators')} disabled:opacity-50`}
                  style={{ fontSize: fsChrome }}
                  disabled={
                    writingScript
                      ? false
                      : isStoryToolbarBusy || !hasStoryOutline
                  }
                  title={
                    writingScript
                      ? tt.storyCancelChatHint
                      : !hasStoryOutline
                        ? tt.storyNeedOutline
                        : tt.priceTooltip
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    if (writingScript) {
                      cancelDirectorChat('user');
                      return;
                    }
                    void handleMvStoryOneShot();
                  }}
                >
                  {writingScript ? <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" /> : null}
                  {writingScript ? tt.musicJobCancel : tt.storyGenerateScriptBtn}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className={`flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pr-0.5 ${scrollCls}`}>
        <div className="shrink-0 grid grid-cols-1 md:grid-cols-2 gap-2.5">
          <div className={cardCls}>
            <div className={`mb-1.5 font-medium ${bodyCls}`} style={{ fontSize: fsSmall }}>
              {tt.storyAnalyzeTitle}
            </div>
            <p
              className={`leading-relaxed whitespace-pre-wrap break-words ${
                summary ? bodyCls : mutedCls
              }`}
              style={{ fontSize: fsChrome }}
            >
              {summary || tt.storyAnalysisEmpty}
            </p>
            {genre ? (
              <div className="mt-2 flex flex-wrap gap-1.5">{renderMvStoryTag(genre, `genre-${genre}`)}</div>
            ) : null}
          </div>

          <div className={cardCls}>
            <div className={`mb-1.5 font-medium ${bodyCls}`} style={{ fontSize: fsSmall }}>
              {tt.storyStyleTitle}
            </div>
            <div className={`mb-1 opacity-70 ${mutedCls}`} style={{ fontSize: fsChrome }}>
              {tt.storyEmotionsLabel}
            </div>
            <div className="mb-2.5 flex flex-wrap gap-1.5 min-h-[1.5rem]">
              {emotions.length
                ? emotions.map((t, i) => renderMvStoryTag(t, `emo-${i}-${t}`))
                : (
                  <span className={mutedCls} style={{ fontSize: fsChrome }}>
                    —
                  </span>
                )}
            </div>
            <div className={`mb-1 opacity-70 ${mutedCls}`} style={{ fontSize: fsChrome }}>
              {tt.storyKeywordsLabel}
            </div>
            <div className="flex flex-wrap gap-1.5 min-h-[1.5rem]">
              {keywords.length
                ? keywords.map((t, i) => renderMvStoryTag(t, `kw-${i}-${t}`))
                : (
                  <span className={mutedCls} style={{ fontSize: fsChrome }}>
                    —
                  </span>
                )}
            </div>
          </div>
        </div>

        {useRefGen ? (
          <div className={`flex flex-col shrink-0 gap-1.5 ${cardCls}`}>
            <DirectorStoryReferenceVoiceField
              value={scriptReference}
              onChange={(v) => {
                patch(
                  patchDirectorMvScriptInput(directorStateRef.current, {
                    mvScriptReference: v,
                  }),
                );
              }}
              isDarkMode={isDarkMode}
              placeholder={tt.storyReferencePlaceholder}
              textareaClassName={sectionInputCls}
              textareaStyle={{ fontSize: fsChrome }}
              minHeightPx={72}
              rows={3}
              label={
                <div className={`font-medium ${bodyCls}`} style={{ fontSize: fsChrome }}>
                  {tt.storyReferenceLabel}
                </div>
              }
              labels={{
                voiceStart: tt.aiReviseFinalPromptVoiceStart,
                voiceStop: tt.aiReviseFinalPromptVoiceStop,
                voiceBusy: tt.aiReviseFinalPromptVoiceBusy,
                micDenied: tt.aiReviseFinalPromptMicDenied,
              }}
              onError={showAlert}
              enabled={useRefGen}
            />
          </div>
        ) : null}

        <div className={`relative flex flex-col shrink-0 gap-1.5 ${cardCls}`}>
          {writingOutline ? (
            <div
              className={`absolute inset-0 z-20 flex items-center justify-center rounded-2xl ${
                isDarkMode ? 'bg-zinc-950/70' : 'bg-white/75'
              }`}
            >
              <div className={`inline-flex items-center gap-2 font-medium ${bodyCls}`} style={{ fontSize: fsSmall }}>
                <Loader2 className={`w-4 h-4 animate-spin ${accentSpin}`} />
                {tt.storyOutlineWriting}
              </div>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <div className={`font-medium ${bodyCls}`} style={{ fontSize: fsChrome }}>
                {tt.storyOutlineTitle}
              </div>
              <span
                className={`inline-flex items-center rounded-md px-2 py-0.5 ${
                  hasStoryOutline
                    ? isDarkMode
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-emerald-50 text-emerald-700'
                    : isDarkMode
                      ? 'bg-white/10 text-white/55'
                      : 'bg-gray-100 text-gray-500'
                }`}
                style={{ fontSize: fsChrome }}
              >
                {hasStoryOutline ? tt.storyOutlineReadyBadge : tt.storyOutlineEmptyBadge}
              </span>
            </div>
            {hasStoryOutline ? (
              <button
                type="button"
                className={`nodrag nopan shrink-0 rounded-md px-2 py-0.5 ${
                  isDarkMode
                    ? 'bg-white/10 text-white/85 hover:bg-white/16'
                    : 'bg-gray-200/80 text-gray-800 hover:bg-gray-300'
                }`}
                style={{ fontSize: fsChrome }}
                onMouseDown={(e) => {
                  // 用 mousedown 切换，避免 textarea blur 与 click 打架导致反复挂载卡死
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (storyOutlineEditing) {
                    setStoryOutlineEditing(false);
                    return;
                  }
                  setStoryOutlineEditing(true);
                  requestAnimationFrame(() => {
                    const el = storyOutlineTextareaRef.current;
                    if (!el) return;
                    el.focus();
                    const len = el.value.length;
                    try {
                      el.setSelectionRange(len, len);
                    } catch {
                      /* ignore */
                    }
                  });
                }}
              >
                {storyOutlineEditing
                  ? locale === 'en'
                    ? 'Done'
                    : '完成'
                  : locale === 'en'
                    ? 'Edit'
                    : '编辑'}
              </button>
            ) : null}
          </div>
          <div
            className="nodrag nopan relative z-[50] flex flex-wrap items-center gap-2 overflow-visible"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {(
              [
                {
                  key: 'genre' as const,
                  label: tt.storyPrefsGenreLabel,
                  value: String(state.mvStoryGenreType || ''),
                  options: DIRECTOR_MV_STORY_GENRE_TYPES,
                  patchKey: 'mvStoryGenreType' as const,
                },
                {
                  key: 'tone' as const,
                  label: tt.storyPrefsToneLabel,
                  value: String(state.mvStoryToneStyle || ''),
                  options: DIRECTOR_MV_STORY_TONE_STYLES,
                  patchKey: 'mvStoryToneStyle' as const,
                },
                {
                  key: 'ending' as const,
                  label: tt.storyPrefsEndingLabel,
                  value: String(state.mvStoryEndingType || ''),
                  options: DIRECTOR_MV_STORY_ENDING_TYPES,
                  patchKey: 'mvStoryEndingType' as const,
                },
              ] as const
            ).map((sel) => (
              <div
                key={sel.key}
                className={`nodrag nopan inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 ${
                  isDarkMode ? 'bg-black/20' : 'bg-white/70'
                }`}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <span className={`shrink-0 ${mutedCls}`} style={{ fontSize: Math.max(10, fsChrome - 1) }}>
                  {sel.label}
                </span>
                <PanelOptionDropdown
                  value={sel.value}
                  options={[
                    { value: '', label: tt.storyPrefsAutoOption },
                    ...sel.options.map((opt) => ({ value: opt, label: opt })),
                  ]}
                  onChange={(v) => {
                    patch(
                      patchDirectorMvScriptInput(directorStateRef.current, {
                        [sel.patchKey]: v,
                      }),
                    );
                  }}
                  isDarkMode={isDarkMode}
                  title={sel.label}
                  minWidthPx={96}
                  menuPlacement="down"
                  className={
                    isDarkMode
                      ? '!bg-zinc-900 !text-white/90 !border-white/15'
                      : '!bg-white !text-gray-800 !border-gray-200'
                  }
                />
              </div>
            ))}
          </div>
          {hasStoryOutline && !storyOutlineEditing ? (
            <div
              className={`nodrag rounded-xl border px-1 py-1 max-h-[min(42vh,480px)] overflow-y-auto ${scrollCls} ${
                isDarkMode ? 'border-white/10 bg-black/20' : 'border-gray-200 bg-gray-100'
              }`}
              style={{ fontSize: fsChrome }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <MvStoryOutlineColoredView text={storyOutline} isDarkMode={isDarkMode} />
            </div>
          ) : (
            <textarea
              ref={(el) => {
                storyOutlineTextareaRef.current = el;
              }}
              className={`${sectionInputCls} max-h-[min(42vh,480px)] !overflow-y-auto`}
              style={{ fontSize: fsChrome, minHeight: 120, height: 220, resize: 'vertical' }}
              rows={8}
              value={storyOutline}
              placeholder={tt.storyOutlinePlaceholder}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                const v = e.target.value;
                setStoryOutlineLocal(v);
                patch(
                  patchDirectorMvScriptInput(directorStateRef.current, {
                    mvStoryOutline: v,
                  }),
                );
              }}
            />
          )}
        </div>

        <div className="flex flex-col shrink-0 gap-3">
        <div className={`relative flex flex-col shrink-0 gap-2.5 ${cardCls}`}>
          <div className="shrink-0 flex items-center justify-between gap-2">
            <span className={`font-medium ${bodyCls}`} style={{ fontSize: fsSmall }}>
              {tt.phaseStory}
            </span>
            {writingScript ? (
              <span className={`inline-flex items-center gap-1.5 ${mutedCls}`} style={{ fontSize: fsChrome }}>
                <Loader2 className={`w-3.5 h-3.5 animate-spin ${accentSpin}`} />
                {tt.storyScriptWriting}
              </span>
            ) : null}
          </div>
          {scriptKeywords.length && !writingScript ? (
            <div className="shrink-0 flex flex-col gap-1">
              <div className={`opacity-70 ${mutedCls}`} style={{ fontSize: fsChrome }}>
                {tt.storyScriptKeywordsLabel}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {scriptKeywords.map((t, i) => renderMvStoryTag(t, `sk-${i}-${t}`))}
              </div>
            </div>
          ) : null}
          <div className="flex flex-col gap-3 shrink-0">
            {writingScript ? (
              <div
                className={`rounded-xl border px-3 py-10 text-center ${mutedCls} ${
                  isDarkMode ? 'border-white/10 bg-black/20' : 'border-gray-200 bg-gray-50'
                }`}
                style={{ fontSize: fsChrome }}
              >
                {tt.storyScriptWriting}
              </div>
            ) : (
            sectionDefs.map((sec) => {
              if (sec.key === 'plot') {
                const plotRows = parseDirectorMvPlotBeatTable(scriptSections.plot || '');
                const beatStats = plotRows ? countDirectorMvPlotBeatsWithCast(plotRows) : null;
                const patchPlotRows = (rows: DirectorMvPlotBeatRow[]) => {
                  patchScriptSection('plot', formatDirectorMvPlotBeatTable(rows));
                };
                /** 估算展示宽度（中文≈1ch，ASCII≈0.55ch）——仅用于动作列自动行高 */
                const plotTextCh = (s: string) => {
                  let n = 0;
                  for (const c of Array.from(String(s || ''))) {
                    n += (c.codePointAt(0) || 0) > 0xff ? 1 : 0.55;
                  }
                  return Math.max(1, Math.ceil(n));
                };
                const plotCellCls = `nodrag nowheel box-border w-full min-w-0 rounded-md border px-1.5 py-1 outline-none focus:ring-1 ${
                  isDarkMode
                    ? 'border-white/10 bg-black/25 text-white/85 focus:ring-sky-400/40'
                    : 'border-gray-200 bg-gray-100 text-gray-800 focus:ring-sky-400/50'
                }`;
                const headers = [
                  tt.storyPlotBeatColNo,
                  tt.storyPlotBeatColSection,
                  tt.storyPlotBeatColVocal,
                  tt.storyPlotBeatColCastType,
                  tt.storyPlotBeatColScene,
                  tt.storyPlotBeatColCast,
                  tt.storyPlotBeatColAngle,
                  tt.storyPlotBeatColFocal,
                  tt.storyPlotBeatColAction,
                  tt.storyPlotBeatColLipsyncAction,
                  tt.storyPlotBeatColMood,
                ] as const;
                const keys: Array<keyof DirectorMvPlotBeatRow> = [
                  'no',
                  'section',
                  'vocal',
                  'castType',
                  'scene',
                  'cast',
                  'angle',
                  'focal',
                  'action',
                  'lipsyncAction',
                  'mood',
                ];
                /** 大致均分；动作与对口型动作略宽 */
                const colPct: Record<keyof DirectorMvPlotBeatRow, string> = {
                  no: '4%',
                  section: '7%',
                  vocal: '7%',
                  castType: '7%',
                  scene: '8%',
                  cast: '7%',
                  angle: '8%',
                  focal: '7%',
                  action: '16%',
                  lipsyncAction: '16%',
                  mood: '6%',
                };
                const colStyle = (k: keyof DirectorMvPlotBeatRow): React.CSSProperties => ({
                  width: colPct[k],
                  minWidth: 0,
                });
                return (
                  <div key={sec.key} className="flex flex-col gap-1.5 shrink-0 w-full min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className={`font-medium ${bodyCls}`} style={{ fontSize: fsChrome }}>
                        {sec.label}
                      </div>
                      {beatStats ? (
                        <span className={mutedCls} style={{ fontSize: fsChrome }}>
                          {fillDirectorI18n(tt.storyPlotBeatSummary, {
                            n: String(beatStats.total),
                            empty: String(beatStats.empty),
                            cast: String(beatStats.withCast),
                          })}
                        </span>
                      ) : null}
                    </div>
                    {plotRows && !plotRawEditOpen ? (
                      <div
                        className={`nodrag nowheel w-full min-w-0 overflow-x-auto rounded-xl border ${
                          isDarkMode ? 'border-white/10' : 'border-gray-200/80'
                        }`}
                      >
                        <table
                          className="w-full border-collapse"
                          style={{
                            fontSize: fsChrome,
                            tableLayout: 'fixed',
                            width: '100%',
                          }}
                        >
                          <thead>
                            <tr
                              className={
                                isDarkMode ? 'bg-white/[0.06] text-white/70' : 'bg-gray-100 text-gray-600'
                              }
                            >
                              {headers.map((h, hi) => (
                                <th
                                  key={h}
                                  className={`px-1.5 py-1.5 text-left font-medium whitespace-nowrap border-b overflow-hidden text-ellipsis ${
                                    isDarkMode ? 'border-white/10' : 'border-gray-200'
                                  }`}
                                  style={colStyle(keys[hi])}
                                  title={h}
                                >
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {plotRows.map((row, ri) => {
                              const emptyShot = row.castType === '空镜';
                              return (
                                <tr
                                  key={`plot-beat-${ri}-${row.no}`}
                                  className={
                                    emptyShot
                                      ? isDarkMode
                                        ? 'bg-amber-500/[0.06]'
                                        : 'bg-amber-50/70'
                                      : isDarkMode
                                        ? 'bg-sky-500/[0.05]'
                                        : 'bg-sky-50/50'
                                  }
                                >
                                  {keys.map((k) => {
                                    const cellText = String(row[k] || '');
                                    return (
                                    <td
                                      key={k}
                                      className={`px-1 py-1 align-top border-b ${
                                        isDarkMode ? 'border-white/5' : 'border-gray-100'
                                      }`}
                                      style={colStyle(k)}
                                    >
                                      {k === 'castType' ? (
                                        <select
                                          className={plotCellCls}
                                          value={row.castType === '空镜' ? '空镜' : '有人'}
                                          onChange={(e) => {
                                            const next = plotRows.map((r, i) =>
                                              i === ri
                                                ? {
                                                    ...r,
                                                    castType: e.target.value,
                                                    cast:
                                                      e.target.value === '空镜'
                                                        ? '—'
                                                        : r.cast === '—'
                                                          ? ''
                                                          : r.cast,
                                                  }
                                                : r,
                                            );
                                            patchPlotRows(next);
                                          }}
                                          onPointerDown={(e) => e.stopPropagation()}
                                        >
                                          <option value="空镜">空镜</option>
                                          <option value="有人">有人</option>
                                        </select>
                                      ) : k === 'vocal' ? (
                                        <select
                                          className={plotCellCls}
                                          value={
                                            row.vocal === '无人声' || row.vocal === '有人声'
                                              ? row.vocal
                                              : '有人声'
                                          }
                                          onChange={(e) => {
                                            const next = plotRows.map((r, i) =>
                                              i === ri ? { ...r, vocal: e.target.value } : r,
                                            );
                                            patchPlotRows(next);
                                          }}
                                          onPointerDown={(e) => e.stopPropagation()}
                                        >
                                          <option value="无人声">无人声</option>
                                          <option value="有人声">有人声</option>
                                        </select>
                                      ) : k === 'action' ? (
                                        <textarea
                                          className={`${plotCellCls} resize-none overflow-hidden leading-snug whitespace-pre-wrap break-words`}
                                          value={cellText}
                                          rows={Math.max(
                                            1,
                                            Math.ceil(plotTextCh(cellText) / 18),
                                          )}
                                          onChange={(e) => {
                                            const next = plotRows.map((r, i) =>
                                              i === ri ? { ...r, action: e.target.value } : r,
                                            );
                                            patchPlotRows(next);
                                          }}
                                          ref={(el) => {
                                            if (!el) return;
                                            el.style.height = 'auto';
                                            el.style.height = `${Math.max(28, el.scrollHeight)}px`;
                                          }}
                                          onInput={(e) => {
                                            const el = e.currentTarget;
                                            el.style.height = 'auto';
                                            el.style.height = `${Math.max(28, el.scrollHeight)}px`;
                                          }}
                                          onPointerDown={(e) => e.stopPropagation()}
                                        />
                                      ) : (
                                        <input
                                          type="text"
                                          className={plotCellCls}
                                          value={cellText}
                                          title={cellText}
                                          disabled={k === 'cast' && emptyShot}
                                          onChange={(e) => {
                                            const v = e.target.value;
                                            const next = plotRows.map((r, i) =>
                                              i === ri ? { ...r, [k]: v } : r,
                                            );
                                            patchPlotRows(next);
                                          }}
                                          onPointerDown={(e) => e.stopPropagation()}
                                        />
                                      )}
                                    </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <textarea
                        data-director-autogrow=""
                        data-min-height-px={String(sec.minHeightPx)}
                        className={sectionInputCls}
                        style={{ fontSize: fsSmall, minHeight: sec.minH, overflow: 'hidden', resize: 'none' }}
                        placeholder={sec.placeholder}
                        value={scriptSections.plot || ''}
                        rows={6}
                        onChange={(e) => {
                          patchScriptSection('plot', e.target.value);
                          growStoryTextarea(e.currentTarget, sec.minHeightPx);
                        }}
                        onInput={(e) => growStoryTextarea(e.currentTarget, sec.minHeightPx)}
                        onPointerDown={(e) => e.stopPropagation()}
                      />
                    )}
                    {plotRows ? (
                      <button
                        type="button"
                        className={`nodrag self-start ${mutedCls} underline-offset-2 hover:underline`}
                        style={{ fontSize: fsChrome }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPlotRawEditOpen((v) => !v);
                        }}
                      >
                        {tt.storyPlotBeatRawEdit}
                        {plotRawEditOpen ? ' ▲' : ' ▼'}
                      </button>
                    ) : null}
                  </div>
                );
              }
              return (
                <div key={sec.key} className="flex flex-col gap-1 shrink-0">
                  <div className={`font-medium ${bodyCls}`} style={{ fontSize: fsChrome }}>
                    {sec.label}
                  </div>
                  <textarea
                    data-director-autogrow=""
                    data-min-height-px={String(sec.minHeightPx)}
                    className={sectionInputCls}
                    style={{ fontSize: fsSmall, minHeight: sec.minH, overflow: 'hidden', resize: 'none' }}
                    placeholder={sec.placeholder}
                    value={scriptSections[sec.key] || ''}
                    rows={3}
                    onChange={(e) => {
                      patchScriptSection(sec.key, e.target.value);
                      growStoryTextarea(e.currentTarget, sec.minHeightPx);
                    }}
                    onInput={(e) => growStoryTextarea(e.currentTarget, sec.minHeightPx)}
                    onPointerDown={(e) => e.stopPropagation()}
                  />
                </div>
              );
            })
            )}
          </div>
        </div>
        </div>
        </div>
      </div>
    );
  };

  const renderMvStylePanel = () => null;

  const renderMvCastPanel = () => {
    const plan = normalizeDirectorMvCastPlan(state.mvCastPlan);
    const scriptCharCount = parseDirectorMvCharacterEntries(
      getDirectorMvCharactersSectionText(state),
    ).length;
    const characters = state.assets.characters || [];
    const presetMatchesLead = (promptZh: string, g: DirectorMvLeadGender | null) => {
      if (!g) return true;
      const female = /女性|女舞者|少女|亚裔女性|女/.test(promptZh);
      const male = /青年|男|少年/.test(promptZh) && !/女性|女舞者|少女|亚裔女性/.test(promptZh);
      if (g === 'female') return female || (!male && !female);
      return male || (!male && !female);
    };
    const genderChipCls = (on: boolean, enabled: boolean) =>
      `nodrag rounded-md px-2 py-0.5 transition-colors ${
        !enabled
          ? isDarkMode
            ? 'bg-white/[0.04] text-white/25'
            : 'bg-gray-100 text-gray-300'
          : on
            ? isDarkMode
              ? 'bg-sky-500/25 text-sky-100 ring-1 ring-sky-400/40'
              : 'bg-gray-200 text-gray-800 ring-1 ring-gray-400'
            : isDarkMode
              ? 'bg-white/[0.06] text-white/65 hover:bg-white/[0.1]'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`;
    const setLeadEnabled = (slot: 1 | 2, on: boolean) => {
      if (slot === 1) {
        // 角色1始终启用
        if (!on) return;
        patch(patchDirectorMvCastPlan(directorStateRef.current, { leadCount: plan.leadCount }));
        return;
      }
      patch(patchDirectorMvCastPlan(directorStateRef.current, { leadCount: on ? 2 : 1 }));
    };
    const setLeadGender = (slot: 1 | 2, gender: DirectorMvLeadGender) => {
      const patchPlan: Partial<DirectorMvCastPlan> =
        slot === 1 ? { lead1Gender: gender } : { lead2Gender: gender };
      patch(patchDirectorMvCastPlan(directorStateRef.current, patchPlan));
    };
    const isPresetAppliedTo = (
      asset: DirectorAsset | undefined,
      preset: (typeof DIRECTOR_CAST_ARTWORK_PRESETS)[number],
    ) => {
      const url = String(asset?.imageUrl || '');
      if (!url) return false;
      return (
        url.includes(preset.imageFile) ||
        url.includes(`/director-cast-presets/${preset.imageFile}`) ||
        String(asset?.prompt || '').trim() === preset.promptZh
      );
    };

    const renderLeadCastSection = (slot: 1 | 2) => {
      const enabled = slot === 1 || plan.leadCount === 2;
      const asset = characters[slot - 1] as DirectorAsset | undefined;
      const gender: DirectorMvLeadGender = slot === 1 ? plan.lead1Gender : plan.lead2Gender;
      const title = slot === 1 ? tt.castSelectRoleTitle : tt.castMoreLooksTitle;
      const presets = DIRECTOR_CAST_ARTWORK_PRESETS.filter((p) =>
        presetMatchesLead(p.promptZh, gender),
      );
      const uploadOpen = !!(asset && sourceMenuAssetId === asset.id);
      const interactive = enabled && !!asset;
      const priceKey = asset ? `cast-gen-${asset.id}` : `cast-gen-slot-${slot}`;
      const isCastGenBusy =
        !!asset &&
        (asset.status === 'generating' || !!imageGenProgressIds[asset.id]);

      return (
        <div
          className={`relative z-[1] flex flex-col flex-1 min-h-0 rounded-xl border px-2.5 py-2 gap-1.5 ${
            uploadOpen && !isCastGenBusy ? 'overflow-visible' : 'overflow-hidden'
          } ${
            enabled
              ? isDarkMode
                ? 'border-white/15 bg-white/[0.04]'
                : 'border-gray-200 bg-gray-100'
              : isDarkMode
                ? 'border-white/10 bg-white/[0.02]'
                : 'border-gray-200/60 bg-gray-100'
          }`}
        >
          <div className="shrink-0 flex items-center gap-2 flex-wrap">
            <label
              className={`nodrag inline-flex items-center gap-1.5 select-none ${
                slot === 1 ? 'pointer-events-none' : 'cursor-pointer'
              }`}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                className="nodrag rounded border-white/30"
                checked={enabled}
                disabled={slot === 1}
                onChange={(e) => setLeadEnabled(slot, e.target.checked)}
              />
              <span className={`font-medium ${bodyCls}`} style={{ fontSize: fsSmall }}>
                {title}
              </span>
            </label>
            <div className="flex items-center gap-1 ml-1">
              <span className={mutedCls} style={{ fontSize: fsChrome }}>
                {tt.castLeadGenderLabel}
              </span>
              <button
                type="button"
                disabled={!enabled}
                className={genderChipCls(gender === 'female', enabled)}
                style={{ fontSize: fsChrome }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!enabled) return;
                  setLeadGender(slot, 'female');
                }}
              >
                {tt.castLeadGenderFemale}
              </button>
              <button
                type="button"
                disabled={!enabled}
                className={genderChipCls(gender === 'male', enabled)}
                style={{ fontSize: fsChrome }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!enabled) return;
                  setLeadGender(slot, 'male');
                }}
              >
                {tt.castLeadGenderMale}
              </button>
            </div>
            {!enabled ? (
              <span className={`ml-auto ${mutedCls}`} style={{ fontSize: Math.max(10, fsChrome - 1) }}>
                {tt.castRole2DisabledHint}
              </span>
            ) : null}
          </div>

          <div
            className={`flex flex-1 min-h-0 gap-2.5 items-stretch ${
              interactive ? '' : 'opacity-45 pointer-events-none select-none grayscale'
            }`}
          >
            {/* 提示词 + 模型 + 生成（加宽左侧列，避免模型/分辨率被裁切） */}
            <div
              className={`w-[340px] min-w-[300px] max-w-[44%] shrink-0 rounded-xl border px-2 py-1.5 flex flex-col gap-1.5 min-h-0 ${
                enabled
                  ? isDarkMode
                    ? 'border-white/12 bg-white/[0.04]'
                    : 'border-gray-200 bg-gray-100'
                  : isDarkMode
                    ? 'border-white/10 bg-zinc-950/30'
                    : 'border-gray-200 bg-gray-100'
              }`}
              onPointerDown={() => {
                if (asset) setCastArtworkPickAssetId(asset.id);
              }}
            >
              <input
                className={`nodrag w-full min-w-0 bg-transparent font-semibold outline-none ${titleCls}`}
                style={{ fontSize: fsSmall }}
                value={asset?.name || (slot === 2 ? tt.castLead2Label : tt.castLead1Label)}
                disabled={!interactive}
                onChange={(e) => {
                  if (!asset) return;
                  patch(
                    updateDirectorAsset(directorStateRef.current, asset.id, {
                      name: e.target.value,
                    }),
                  );
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                onKeyUp={(e) => e.stopPropagation()}
              />
              <div className="relative flex-1 min-h-0 flex flex-col">
              <textarea
                className={`nodrag nowheel flex-1 min-h-0 w-full resize-none rounded-lg px-1.5 py-1 pr-6 leading-snug outline-none ${mutedCls} ${scrollCls} ${
                  isDarkMode ? 'bg-black/25' : 'bg-gray-100'
                }`}
                style={{ fontSize: fsChrome }}
                value={asset?.prompt || ''}
                disabled={!interactive}
                placeholder={tt.castGenerateOrCanvas}
                onChange={(e) => {
                  if (!asset) return;
                  patch(
                    updateDirectorAsset(directorStateRef.current, asset.id, {
                      prompt: e.target.value,
                    }),
                  );
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                onKeyUp={(e) => e.stopPropagation()}
              />
              {interactive && String(asset?.prompt || '').length > 0 ? (
                <button
                  type="button"
                  className={`nodrag absolute top-1 right-1 z-[2] rounded p-0.5 ${
                    isDarkMode
                      ? 'text-white/40 hover:text-rose-300 hover:bg-white/10'
                      : 'text-gray-400 hover:text-rose-600 hover:bg-black/5'
                  }`}
                  title={tt.castClearPrompt}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!asset) return;
                    patch(
                      updateDirectorAsset(directorStateRef.current, asset.id, {
                        prompt: '',
                      }),
                    );
                  }}
                >
                  <X className="w-3.5 h-3.5" strokeWidth={2.4} />
                </button>
              ) : null}
              </div>
              <div className="shrink-0 flex items-center gap-1 flex-nowrap min-w-0">
                {interactive ? (
                  <div className="shrink-0 min-w-0">
                    {renderImageGenControls({ compact: true, kind: 'character' })}
                  </div>
                ) : null}
                <div
                  className="relative overflow-visible shrink-0"
                  onMouseEnter={() => interactive && setPriceHoverKey(priceKey)}
                  onMouseLeave={() => setPriceHoverKey((k) => (k === priceKey ? null : k))}
                >
                  {interactive ? renderYuanbaoHoverTip(priceKey, 1) : null}
                  <button
                    type="button"
                    className={`nodrag inline-flex items-center gap-1 ${btnPrimary('!px-2 !py-0.5 !h-auto !min-h-0', sectionScratch('character'))}`}
                    style={{ fontSize: fsChrome }}
                    disabled={!interactive || isCastGenBusy || isDirectorHardBusy}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!asset || isCastGenBusy) return;
                      setCastArtworkPickAssetId(asset.id);
                      generateOneAsset(asset);
                    }}
                  >
                    {isCastGenBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin inline shrink-0" />
                    ) : null}
                    {isCastGenBusy ? tt.generating : tt.generateThis}
                  </button>
                </div>
              </div>
            </div>

            {/* 已选形象（9:16，更大）+ 点击弹出上传；菜单 portal 到 body 避免 overflow 裁切 */}
            <div
              className={`relative shrink-0 h-full min-h-0 aspect-[9/16] w-auto max-w-[26%] min-w-[132px] overflow-visible ${
                uploadOpen ? 'z-[60]' : 'z-[1]'
              }`}
              ref={uploadOpen ? sourceMenuRef : undefined}
            >
              <button
                type="button"
                disabled={!interactive}
                title={interactive ? tt.castUploadRole : undefined}
                aria-expanded={uploadOpen}
                className={`nodrag nexflow-cast-look-thumb relative w-full h-full rounded-xl border overflow-hidden flex items-center justify-center disabled:opacity-50 ${
                  enabled
                    ? isDarkMode
                      ? 'border-sky-400/60 bg-zinc-950 hover:border-sky-300/80'
                      : 'border-blue-400 bg-gray-100 hover:border-blue-500'
                    : isDarkMode
                      ? 'border-white/10 bg-zinc-950/40'
                      : 'border-gray-200 bg-gray-100'
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!asset) return;
                  setCastArtworkPickAssetId(asset.id);
                  if (asset.imageUrl && e.detail === 2) {
                    setImagePreview({ url: asset.imageUrl, name: asset.name || '' });
                    return;
                  }
                  setSourceMenuAssetId((cur) => (cur === asset.id ? null : asset.id));
                }}
              >
                {asset?.imageUrl ? (
                  <AssetLibLazyThumb
                    src={asset.imageUrl}
                    alt={asset?.name || ''}
                    maxEdge={200}
                    className="w-full h-full"
                    imgClassName="w-full h-full object-cover pointer-events-none"
                  />
                ) : (
                  <Plus
                    className={`w-9 h-9 ${isDarkMode ? 'text-white/55' : 'text-gray-400'}`}
                    strokeWidth={2}
                  />
                )}
                {asset?.imageUrl ? (
                  <span
                    className={`absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full ${
                      isDarkMode ? 'bg-black/65 text-white' : 'bg-gray-100 text-gray-700 shadow'
                    }`}
                  >
                    <Plus className="w-4 h-4" strokeWidth={2.5} />
                  </span>
                ) : null}
                {renderDirectorThumbProgress({
                  visible: isCastGenBusy,
                  message: tt.generatingCharacter,
                  borderRadius: 12,
                })}
              </button>
              {uploadOpen && asset && sourceMenuFixedStyle
                ? createPortal(
                    <div
                      ref={sourceMenuPortalRef}
                      className={`nodrag nopan fixed z-[100050] min-w-[9.5rem] overflow-visible rounded-lg border py-1 shadow-xl ${
                        isDarkMode
                          ? 'bg-zinc-900 border-white/15 text-white/90'
                          : 'bg-gray-100 border-gray-200 text-gray-800'
                      }`}
                      style={{
                        left: sourceMenuFixedStyle.left,
                        bottom: sourceMenuFixedStyle.bottom,
                        minWidth: sourceMenuFixedStyle.minWidth,
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {data?.onPickImageFromCanvas ? (
                        <button
                          type="button"
                          className={`nodrag flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                            isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                          }`}
                          onClick={() => {
                            setSourceMenuAssetId(null);
                            void pickAssetFromCanvas(asset.id);
                          }}
                        >
                          <MousePointerClick className="w-3.5 h-3.5 shrink-0 opacity-80" />
                          {tt.pickFromCanvas}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={`nodrag flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                          isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                        }`}
                        onClick={() => {
                          setSourceMenuAssetId(null);
                          onUploadClick(asset.id);
                        }}
                      >
                        <Upload className="w-3.5 h-3.5 shrink-0 opacity-80" />
                        {tt.uploadLocal}
                      </button>
                      {asset.imageUrl ? (
                        <button
                          type="button"
                          className={`nodrag flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                            isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                          }`}
                          onClick={() => {
                            setSourceMenuAssetId(null);
                            setImagePreview({ url: asset.imageUrl!, name: asset.name || '' });
                          }}
                        >
                          <ZoomIn className="w-3.5 h-3.5 shrink-0 opacity-80" />
                          {tt.viewImage}
                        </button>
                      ) : null}
                    </div>,
                    document.body,
                  )
                : null}
            </div>

            <div
              className={`nexflow-cast-look-rail flex-1 min-w-0 min-h-0 flex gap-2.5 overflow-x-auto overflow-y-visible items-center px-1 py-2 nowheel ${scrollCls}`}
            >
              {presets.map((preset) => {
                const url = directorCastArtworkImageUrl(preset.imageFile);
                const label = locale === 'en' ? preset.labelEn : preset.labelZh;
                const selected = isPresetAppliedTo(asset, preset);
                return (
                  <button
                    key={`lead${slot}-${preset.id}`}
                    type="button"
                    title={label}
                    disabled={!interactive}
                    className={`nodrag nexflow-cast-look-thumb relative h-[78%] aspect-[9/16] shrink-0 overflow-hidden rounded-xl border disabled:opacity-50 ${
                      selected
                        ? isDarkMode
                          ? 'border-sky-400 ring-2 ring-sky-400/60'
                          : 'border-blue-500 ring-2 ring-blue-400/50'
                        : isDarkMode
                          ? 'border-white/10 hover:border-sky-400/50'
                          : 'border-gray-200 hover:border-blue-400'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!asset) return;
                      setCastArtworkPickAssetId(asset.id);
                      void applyCastArtworkPreset(asset.id, preset);
                    }}
                  >
                    <img
                      src={url}
                      alt={label}
                      className="w-full h-full object-cover"
                      draggable={false}
                    />
                    {selected ? (
                      <span
                        className={`absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full ${
                          isDarkMode ? 'bg-sky-500 text-white' : 'bg-blue-500 text-white'
                        }`}
                      >
                        <Check className="w-3 h-3" strokeWidth={3} />
                      </span>
                    ) : null}
                  </button>
                );
              })}
              <div
                className={`h-[78%] aspect-[9/16] shrink-0 rounded-xl border border-dashed flex flex-col items-center justify-center gap-1 pointer-events-none ${
                  isDarkMode ? 'border-white/20 text-white/45' : 'border-gray-300 text-gray-500'
                }`}
                title={tt.castMoreRoles}
              >
                <Plus className="w-5 h-5" />
                <span
                  className="px-1 text-center leading-tight"
                  style={{ fontSize: Math.max(10, fsChrome - 1) }}
                >
                  {tt.castMoreRoles}
                </span>
              </div>
            </div>
          </div>
        </div>
      );
    };

    const comboId = directorMvCastPlanComboId(plan);
    const comboLabel =
      comboId === 'solo-female'
        ? tt.castComboSoloFemale
        : comboId === 'solo-male'
          ? tt.castComboSoloMale
          : comboId === 'duo-ff'
            ? tt.castComboDuoFf
            : comboId === 'duo-mm'
              ? tt.castComboDuoMm
              : tt.castComboDuoMf;

    return (
      <div className="flex flex-col flex-1 min-h-0 gap-2 overflow-visible">
        <div className={`shrink-0 ${mutedCls}`} style={{ fontSize: fsChrome }}>
          {fillDirectorI18n(tt.castAutoOpenedHint, { combo: comboLabel })}
        </div>
        {scriptCharCount > 0 ? (
          <div className="shrink-0 flex items-center justify-between gap-2 flex-wrap">
            <span className={`min-w-0 ${bodyCls}`} style={{ fontSize: fsChrome }}>
              {fillDirectorI18n(tt.castFromScriptCount, { n: String(scriptCharCount) })}
            </span>
            <button
              type="button"
              className={`nodrag shrink-0 ${btnSecondary('!px-2 !py-0.5', 'events')}`}
              style={{ fontSize: fsChrome }}
              title={tt.castSyncFromScript}
              onClick={(e) => {
                e.stopPropagation();
                syncMvCastFromScript('fill');
              }}
            >
              {tt.castSyncFromScript}
            </button>
          </div>
        ) : null}

        {characters.length === 0 ? (
          <div
            className={`rounded-lg border border-dashed px-3 py-3 text-center ${
              isDarkMode ? 'border-white/15 text-white/45' : 'border-gray-200 text-gray-500'
            }`}
            style={{ fontSize: fsChrome }}
          >
            {tt.castEmptyHint}
          </div>
        ) : (
          <div className="flex flex-col flex-1 min-h-0 gap-2 overflow-visible">
            {renderLeadCastSection(1)}
            {renderLeadCastSection(2)}
          </div>
        )}
      </div>
    );
  };

  const renderMvVideoGenToolbar = () => {
    const videoClarityLabel = getDirectorVideoBatchResolutionDisplay(
      videoBatchModel,
      videoBatchResolution,
    );
    const labelCls = isDarkMode ? 'text-white/50' : 'text-gray-500';
    return (
      <div className="shrink-0 relative z-[50] overflow-visible flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5 w-full">
        <div className="nodrag inline-flex items-center" title={tt.videoSkillModelHint}>
          {renderChatModelSelect({ variant: 'plain', menuPlacement: 'down' })}
        </div>
        <button
          type="button"
          className={`nodrag inline-flex items-center justify-center gap-1 ${btnPrimary('!px-2.5 !py-1 !h-auto')} disabled:opacity-50`}
          style={{ fontSize: fsChrome }}
          disabled={!!busyAction || state.shots.length === 0}
          title={tt.videoRebuildPromptFromScriptHint}
          onClick={(e) => {
            e.stopPropagation();
            void handleRebuildAllShotPromptsFromScript();
          }}
        >
          {tt.videoRebuildPromptFromScriptBatch}
        </button>
        <button
          type="button"
          className={`nodrag inline-flex items-center justify-center gap-1 ${btnPrimary('!px-2.5 !py-1 !h-auto')} disabled:opacity-50`}
          style={{ fontSize: fsChrome }}
          disabled={!!busyAction || optimizingShotNos.length > 0 || state.shots.length === 0}
          title={tt.videoOptimizePromptBatch}
          onClick={(e) => {
            e.stopPropagation();
            void handleOptimizeVideoPrompts();
          }}
        >
          {busyAction === 'optimize-prompts' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          ) : null}
          {busyAction === 'optimize-prompts' && videoSkillRewriteHint
            ? videoSkillRewriteHint
            : tt.videoOptimizePromptBatch}
        </button>
        {!DIRECTOR_MV_FORCE_H3_LIPSYNC ? (
          <>
        <label className="nodrag inline-flex items-center gap-1.5" title={tt.videoBatchModelLabel}>
          <span className={labelCls} style={{ fontSize: fsSmall }}>
            {tt.videoBatchModelLabel}
          </span>
          <select
            className={modelSelectCls}
            style={{ fontSize: fsChrome }}
            value={videoBatchModel}
            disabled={!!busyAction}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const nextModel = normalizeDirectorVideoBatchModel(e.target.value);
              const locked =
                coerceDirectorMvAspectRatio(
                  directorStateRef.current.mvAspectRatio ||
                    directorStateRef.current.videoBatchAspectRatio,
                ) || '16:9';
              patchVideoBatch({
                videoBatchModel: nextModel,
                videoBatchAspectRatio: normalizeDirectorVideoBatchAspect(nextModel, locked),
                videoBatchResolution: normalizeDirectorVideoBatchResolution(
                  nextModel,
                  videoBatchResolution,
                ),
                videoBatchDuration: normalizeDirectorVideoBatchDuration(
                  nextModel,
                  videoBatchDuration,
                ),
              });
            }}
          >
            {DIRECTOR_VIDEO_BATCH_MODELS.map((m) => (
              <option key={m.value} value={m.value} title={m.title}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label
          className="nodrag inline-flex items-center gap-1.5"
          title={tt.videoBatchResolutionLabel}
        >
          <span className={labelCls} style={{ fontSize: fsSmall }}>
            {tt.videoBatchResolutionLabel}
          </span>
          {videoBatchResOptions ? (
            <select
              className={modelSelectCls}
              style={{ fontSize: fsChrome }}
              value={videoBatchResolution}
              disabled={!!busyAction}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) =>
                patchVideoBatch({
                  videoBatchResolution: normalizeDirectorVideoBatchResolution(
                    videoBatchModel,
                    e.target.value,
                  ),
                })
              }
            >
              {videoBatchResOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : (
            <span
              className={`nodrag rounded-md px-2 py-1 tabular-nums ${
                isDarkMode
                  ? 'bg-zinc-950 text-zinc-200 ring-1 ring-white/10'
                  : 'bg-gray-100 text-gray-800 border border-gray-300'
              }`}
              style={{ fontSize: fsChrome }}
            >
              {videoClarityLabel}
            </span>
          )}
        </label>
          </>
        ) : null}

        <label
          className="nodrag inline-flex items-center gap-1.5"
          title={tt.videoBatchLipsyncModelLabel}
        >
          <span className={labelCls} style={{ fontSize: fsSmall }}>
            {tt.videoBatchLipsyncModelLabel}
          </span>
          {DIRECTOR_MV_FORCE_H3_LIPSYNC ? (
            <span
              className={modelSelectCls}
              style={{ fontSize: fsChrome }}
              title={
                DIRECTOR_VIDEO_LIPSYNC_MODELS.find(
                  (m) => m.value === DIRECTOR_VIDEO_MINIMAX_LIPSYNC_MODEL,
                )?.title
              }
            >
              {directorVideoBatchModelLabel(DIRECTOR_VIDEO_MINIMAX_LIPSYNC_MODEL)}
            </span>
          ) : (
          <select
            className={modelSelectCls}
            style={{ fontSize: fsChrome }}
            value={videoBatchLipsyncModel}
            disabled={!!busyAction}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              patchVideoBatch({
                videoBatchLipsyncModel: normalizeDirectorVideoLipsyncModel(e.target.value),
                videoBatchLipsyncResolution: normalizeDirectorVideoBatchResolution(
                  normalizeDirectorVideoLipsyncModel(e.target.value),
                  videoBatchLipsyncResolution,
                ),
              })
            }
          >
            {DIRECTOR_VIDEO_LIPSYNC_MODELS.map((m) => (
              <option key={m.value} value={m.value} title={m.title}>
                {m.label}
              </option>
            ))}
          </select>
          )}
        </label>

        <label
          className="nodrag inline-flex items-center gap-1.5"
          title={tt.videoBatchLipsyncResolutionLabel}
        >
          <span className={labelCls} style={{ fontSize: fsSmall }}>
            {tt.videoBatchLipsyncResolutionLabel}
          </span>
          {videoBatchLipsyncResOptions ? (
            <select
              className={modelSelectCls}
              style={{ fontSize: fsChrome }}
              value={videoBatchLipsyncResolution}
              disabled={!!busyAction}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) =>
                patchVideoBatch({
                  videoBatchLipsyncResolution: normalizeDirectorVideoBatchResolution(
                    videoBatchLipsyncModel,
                    e.target.value,
                  ),
                  // 强制 H3 口型时与普通清晰度同步，避免价签/出片读到旧档
                  ...(DIRECTOR_MV_FORCE_H3_LIPSYNC
                    ? {
                        videoBatchResolution: normalizeDirectorVideoBatchResolution(
                          DIRECTOR_VIDEO_MINIMAX_LIPSYNC_MODEL,
                          e.target.value,
                        ),
                      }
                    : {}),
                })
              }
            >
              {videoBatchLipsyncResOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : (
            <span
              className={`nodrag rounded-md px-2 py-1 tabular-nums ${
                isDarkMode
                  ? 'bg-zinc-950 text-zinc-200 ring-1 ring-white/10'
                  : 'bg-gray-100 text-gray-800 border border-gray-300'
              }`}
              style={{ fontSize: fsChrome }}
            >
              {getDirectorVideoBatchResolutionDisplay(
                videoBatchLipsyncModel,
                videoBatchLipsyncResolution,
              )}
            </span>
          )}
        </label>

        <div
          className="nodrag nopan inline-flex items-center gap-1.5 select-none shrink-0"
          onPointerDown={(e) => e.stopPropagation()}
          title={tt.videoHoverSoundHint}
        >
          <button
            type="button"
            role="switch"
            aria-checked={videoHoverSoundOn}
            aria-label={tt.videoHoverSoundLabel}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50 ${
              videoHoverSoundOn
                ? isDarkMode
                  ? 'bg-emerald-500/90'
                  : 'bg-emerald-600'
                : isDarkMode
                  ? 'bg-white/20'
                  : 'bg-gray-300'
            }`}
            onClick={(e) => {
              e.stopPropagation();
              setVideoHoverSoundOn((on) => {
                const next = !on;
                if (!next) pauseShotThumbVideos();
                return next;
              });
            }}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                videoHoverSoundOn ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
          {videoHoverSoundOn ? (
            <Volume2 className={`w-3.5 h-3.5 shrink-0 ${bodyCls}`} />
          ) : (
            <VolumeX className={`w-3.5 h-3.5 shrink-0 ${mutedCls}`} />
          )}
          <button
            type="button"
            className={`nodrag font-medium cursor-pointer bg-transparent border-0 p-0 text-left ${
              videoHoverSoundOn ? bodyCls : mutedCls
            }`}
            style={{ fontSize: fsChrome }}
            onClick={(e) => {
              e.stopPropagation();
              setVideoHoverSoundOn((on) => {
                const next = !on;
                if (!next) pauseShotThumbVideos();
                return next;
              });
            }}
          >
            {tt.videoHoverSoundLabel}
          </button>
        </div>

        <span
          className="relative inline-flex shrink-0 overflow-visible"
          onMouseEnter={() => setPriceHoverKey('batch-videos-toolbar')}
          onMouseLeave={() =>
            setPriceHoverKey((k) => (k === 'batch-videos-toolbar' ? null : k))
          }
        >
          {renderBatchVideoYuanbaoHoverTip('batch-videos-toolbar', { below: true })}
          <button
            type="button"
            className={`nodrag inline-flex items-center justify-center gap-1 ${btnPrimary('!px-2.5 !py-1 !h-auto')} disabled:opacity-50`}
            style={{ fontSize: fsChrome }}
            disabled={!!busyAction || state.shots.length === 0}
            title={tt.batchSpawnVideos}
            onClick={(e) => {
              e.stopPropagation();
              void handleSpawnVideosClick();
            }}
          >
            {busyAction === 'videos' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            ) : null}
            {tt.batchSpawnVideos}
          </button>
        </span>
      </div>
    );
  };

  /** 组装 / 打开卡拉OK编辑器种子（复用歌曲音频+歌词，可带成片 URL） */
  const buildKaraokeSeed = useCallback(
    (videoUrlOverride?: string): KaraokeProject | null => {
      const music = directorStateRef.current.mvMusic;
      const lyrics = String(music?.lyrics || '').trim();
      const audio = String(music?.url || '').trim();
      if (!lyrics || !audio) return null;
      const base = karaokeProjectFromDirectorState(directorStateRef.current);
      const prev = (dataRef.current as DirectorNodeData | undefined)?.karaokeProject;
      const audioUrl =
        String(base.audioUrl || prev?.audioUrl || music?.url || '').trim() || undefined;
      const videoUrl =
        String(
          videoUrlOverride || prev?.videoUrl || base.videoUrl || '',
        ).trim() || undefined;
      if (prev && Array.isArray(prev.lines) && prev.lines.length > 0) {
        const prevChars = prev.lines.reduce(
          (n, l) => n + (l.instrumental ? 0 : (l.chars?.length || 0)),
          0,
        );
        // 仅当上次已有可用字级时复用；空 lines/无 chars 时用导演台最新歌词重建
        if (prevChars > 0) {
          const lyrics =
            String(music?.lyrics || prev.lyrics || base.lyrics || '').trim() || base.lyrics;
          // 第1步歌词若已改：打开编辑器时按行 remap，保持字级时间与正文一致
          const lyricLines = lyrics
            .replace(/\r\n/g, '\n')
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
          let li = 0;
          const lines = prev.lines.map((line) => {
            if (line.instrumental) return line;
            const nextText = lyricLines[li++];
            if (nextText == null) return line;
            const prevText =
              String(line.text || '').trim() ||
              (line.chars || []).map((c) => c.text).join('');
            if (prevText === nextText) return line;
            return remapKaraokeLineText(line, nextText);
          });
          return {
            ...base,
            audioUrl,
            videoUrl,
            audioSource: resolveKaraokeAudioSource({
              audioSource: prev.audioSource || base.audioSource,
              audioUrl,
              videoUrl,
            }),
            lyrics,
            songTitle: String(music?.songTitle || '').trim(),
            lyricist: String(music?.lyricist || '').trim(),
            composer: String(music?.composer || '').trim(),
            previewOpeningCredits: prev.previewOpeningCredits !== false,
            globalOffsetSec: Number(prev.globalOffsetSec) || 0,
            lines,
            timingSource: prev.timingSource || base.timingSource,
            style: {
              ...(prev.style || base.style || {}),
              indicator: {
                ...((prev.style || base.style)?.indicator || {}),
                enabled: false,
              },
              countdown: {
                ...DEFAULT_KARAOKE_STYLE.countdown,
                ...((prev.style || base.style)?.countdown || {}),
                enabled: false,
              },
            },
            asrWords: prev.asrWords || base.asrWords,
            asrLanguage: normalizeKaraokeAsrLanguage(
              prev.asrLanguage || music?.asrLanguage || base.asrLanguage,
            ),
          };
        }
      }
      return {
        ...base,
        audioUrl,
        videoUrl,
        audioSource: resolveKaraokeAudioSource({
          audioSource: prev?.audioSource || base.audioSource,
          audioUrl,
          videoUrl,
        }),
        songTitle: String(music?.songTitle || '').trim(),
        lyricist: String(music?.lyricist || '').trim(),
        composer: String(music?.composer || '').trim(),
        previewOpeningCredits: prev?.previewOpeningCredits !== false,
        style: {
          ...(prev?.style || base.style || {}),
          indicator: {
            ...((prev?.style || base.style)?.indicator || {}),
            enabled: false,
          },
          countdown: {
            ...DEFAULT_KARAOKE_STYLE.countdown,
            ...((prev?.style || base.style)?.countdown || {}),
            enabled: false,
          },
        },
        globalOffsetSec: Number(prev?.globalOffsetSec) || base.globalOffsetSec || 0,
        asrLanguage: normalizeKaraokeAsrLanguage(
          prev?.asrLanguage || music?.asrLanguage || base.asrLanguage,
        ),
      };
    },
    [],
  );

  const persistKaraokeProject = useCallback(
    (next: KaraokeProject, extra?: Partial<DirectorNodeData>) => {
      if (extra && Object.prototype.hasOwnProperty.call(extra, 'karaokeVideoSource')) {
        karaokeVideoSourceRef.current = extra.karaokeVideoSource;
      }
      setKaraokeSeed(next);
      karaokeSeedRef.current = next;
      const curMusic = directorStateRef.current.mvMusic;
      const nextLang = normalizeKaraokeAsrLanguage(next.asrLanguage);
      const curLang = normalizeKaraokeAsrLanguage(curMusic?.asrLanguage);
      const lyricsFromLines = lyricsTextFromKaraokeLines(next.lines);
      const nextLyrics = String(next.lyrics || lyricsFromLines || '').trim();
      const curLyrics = String(curMusic?.lyrics || '').trim();
      const musicPatch: {
        asrLanguage?: KaraokeAsrLanguage;
        lyrics?: string;
        lyricSegments?: NonNullable<typeof curMusic>['lyricSegments'];
      } = {};
      if (nextLang !== curLang) musicPatch.asrLanguage = nextLang;
      if (nextLyrics && nextLyrics !== curLyrics) musicPatch.lyrics = nextLyrics;
      // 同步人声段文案（按可唱行顺序对齐非间奏段），保持第1步/切镜同源
      const segs = Array.isArray(curMusic?.lyricSegments) ? curMusic.lyricSegments : [];
      if (segs.length > 0 && Array.isArray(next.lines) && next.lines.length > 0) {
        const singable = next.lines.filter((l) => !l.instrumental);
        let si = 0;
        let changed = false;
        const synced = segs.map((seg) => {
          if (seg.instrumental) return seg;
          const line = singable[si++];
          if (!line) return seg;
          const text =
            String(line.text || '').trim() ||
            (line.chars || []).map((c) => c.text).join('');
          if (!text || text === String(seg.text || '').trim()) return seg;
          changed = true;
          return { ...seg, text };
        });
        if (changed) musicPatch.lyricSegments = synced;
      }
      if (Object.keys(musicPatch).length > 0) {
        patch(patchDirectorMvMusic(directorStateRef.current, musicPatch));
      }
      dataRef.current?.onUpdate?.({ karaokeProject: next, ...extra } as Partial<DirectorNodeData>);
    },
    [patch],
  );

  /** 第1步歌词改写 → 同步 karaokeProject.lyrics（编辑中用本地草稿，失焦再调用；不 remap 字级） */
  const syncKaraokeFromStep1Lyrics = useCallback(
    (lyricsRaw: string) => {
      const lyrics = normalizeKaraokeRoleMarkersInText(String(lyricsRaw || ''));
      patch(patchDirectorMvMusic(directorStateRef.current, { lyrics }));
      const prev =
        karaokeSeed ||
        (dataRef.current as DirectorNodeData | undefined)?.karaokeProject;
      if (!prev) return;
      if (String(prev.lyrics || '') === lyrics) return;
      const next = { ...prev, lyrics, updatedAt: Date.now() };
      setKaraokeSeed(next);
      dataRef.current?.onUpdate?.({ karaokeProject: next } as Partial<DirectorNodeData>);
    },
    [karaokeSeed, patch],
  );

  /** 第1步失焦：按行 remap karaoke 字级，与歌词正文对齐 */
  const commitStep1LyricsToKaraokeLines = useCallback(() => {
    const lyrics = normalizeKaraokeRoleMarkersInText(
      String(directorStateRef.current.mvMusic?.lyrics || ''),
    );
    const prev =
      karaokeSeed ||
      (dataRef.current as DirectorNodeData | undefined)?.karaokeProject;
    if (!prev || !Array.isArray(prev.lines) || prev.lines.length === 0) return;
    const lyricLines = lyrics
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((s) => s.trim());
    // 保留空行与可唱行下标对齐（与 lyricsTextFromKaraokeLines 一致）；勿 filter(Boolean)
    let li = 0;
    let changed = false;
    const lines = prev.lines.map((line) => {
      if (line.instrumental) return line;
      const nextText = lyricLines[li++];
      if (nextText == null) return line;
      const prevText =
        String(line.text || '').trim() ||
        (line.chars || []).map((c) => c.text).join('');
      if (prevText === nextText) return line;
      changed = true;
      return remapKaraokeLineText(line, nextText);
    });
    if (!changed && String(prev.lyrics || '') === lyrics) return;
    const next: KaraokeProject = {
      ...prev,
      lyrics,
      lines,
      updatedAt: Date.now(),
    };
    setKaraokeSeed(next);
    dataRef.current?.onUpdate?.({ karaokeProject: next } as Partial<DirectorNodeData>);
  }, [karaokeSeed]);

  /** 解析可用合成成片：优先缓存，必要时才导出剪辑轨 */
  const resolveKaraokeComposedVideoUrl = useCallback(
    async (opts?: { forceExport?: boolean }): Promise<string | null> => {
      const d = dataRef.current as DirectorNodeData | undefined;
      const cached = String(d?.karaokeComposedVideoUrl || '').trim();
      if (cached && !opts?.forceExport) return cached;
      if (!d?.onResolveKaraokeMvVideo) return cached || null;
      try {
        const url = String((await d.onResolveKaraokeMvVideo()) || '').trim();
        if (url && url !== cached) {
          // 仅缓存合成 URL，不覆盖用户本地成片
          d.onUpdate?.({ karaokeComposedVideoUrl: url } as Partial<DirectorNodeData>);
        }
        return url || cached || null;
      } catch {
        return cached || null;
      }
    },
    [],
  );

  /** 将合成成片写入 karaoke 状态（不覆盖用户已上传的本地成片，除非 force） */
  const applyComposedKaraokeVideo = useCallback(
    async (opts?: { forceExport?: boolean; forceOverwriteUser?: boolean; silent?: boolean }) => {
      const d = dataRef.current as DirectorNodeData | undefined;
      const source = karaokeVideoSourceRef.current ?? d?.karaokeVideoSource;
      const curUrl = String(
        karaokeSeedRef.current?.videoUrl ||
          karaokeSeed?.videoUrl ||
          d?.karaokeProject?.videoUrl ||
          '',
      ).trim();
      if (source === 'user' && curUrl && !opts?.forceOverwriteUser) {
        return curUrl;
      }
      const url = String((await resolveKaraokeComposedVideoUrl(opts)) || '').trim();
      if (!url) {
        if (!opts?.silent) showAlert(tt.karaokeImportComposeFailed);
        return null;
      }
      // 导出期间用户可能已上传本地成片
      const sourceAfter = karaokeVideoSourceRef.current ?? d?.karaokeVideoSource;
      const curAfter = String(
        karaokeSeedRef.current?.videoUrl || d?.karaokeProject?.videoUrl || '',
      ).trim();
      if (sourceAfter === 'user' && curAfter && !opts?.forceOverwriteUser) {
        // 仅缓存合成 URL，不覆盖预览
        if (url !== String(d?.karaokeComposedVideoUrl || '').trim()) {
          d?.onUpdate?.({ karaokeComposedVideoUrl: url } as Partial<DirectorNodeData>);
        }
        return curAfter;
      }
      const seed =
        buildKaraokeSeed(url) ||
        karaokeProjectFromDirectorState(directorStateRef.current, url);
      persistKaraokeProject(
        { ...seed, videoUrl: url, updatedAt: Date.now() },
        {
          karaokeComposedVideoUrl: url,
          karaokeVideoSource: 'composed',
        },
      );
      return url;
    },
    [
      buildKaraokeSeed,
      karaokeSeed?.videoUrl,
      persistKaraokeProject,
      resolveKaraokeComposedVideoUrl,
      showAlert,
      tt.karaokeImportComposeFailed,
    ],
  );

  const importKaraokeFromCompose = useCallback(async () => {
    if (!data?.onResolveKaraokeMvVideo && !String(data?.karaokeComposedVideoUrl || '').trim()) {
      showAlert(tt.karaokeImportComposeFailed);
      return;
    }
    setBusyAction('karaoke-import');
    try {
      // 用户显式「导入合成成片」：强制从剪辑轨再导出一次
      const url = await applyComposedKaraokeVideo({
        forceExport: !!data?.onResolveKaraokeMvVideo,
        forceOverwriteUser: true,
        silent: false,
      });
      if (!url) return;
    } catch (e) {
      console.warn('[DirectorNode] 导入合成成片失败', e);
      showAlert(tt.karaokeImportComposeFailed);
    } finally {
      setBusyAction(null);
    }
  }, [
    applyComposedKaraokeVideo,
    data?.karaokeComposedVideoUrl,
    data?.onResolveKaraokeMvVideo,
    showAlert,
    tt.karaokeImportComposeFailed,
  ]);

  const KARAOKE_VIDEO_MAX_BYTES = 800 * 1024 * 1024;
  /** 无本地 path 时才走 buffer IPC；大文件走整包 buffer 会卡死/OOM，故设更低阈值 */
  const KARAOKE_VIDEO_BUFFER_FALLBACK_MAX_BYTES = 80 * 1024 * 1024;

  /** 每次打开选文件前清空 value，保证同文件 / 再次选择也能触发 change */
  const onPickKaraokeVideoClick = useCallback(() => {
    const input = karaokeVideoUploadInputRef.current;
    if (!input) return;
    input.value = '';
    input.click();
  }, []);

  const clearKaraokeVideo = useCallback(() => {
    const d = dataRef.current as DirectorNodeData | undefined;
    const prevProj =
      karaokeSeedRef.current ||
      karaokeSeed ||
      d?.karaokeProject ||
      null;
    const prevUrl = String(prevProj?.videoUrl || '').trim();
    const prevSource = karaokeVideoSourceRef.current ?? d?.karaokeVideoSource;
    if (prevUrl.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(prevUrl);
      } catch {
        /* ignore */
      }
    }
    const base =
      prevProj ||
      karaokeProjectFromDirectorState(directorStateRef.current);
    const composed = String(d?.karaokeComposedVideoUrl || '').trim();
    // 清除本地上传后回退到合成成片；若当前已是合成成片则清空预览
    if (composed && prevSource === 'user') {
      persistKaraokeProject(
        { ...base, videoUrl: composed, updatedAt: Date.now() },
        {
          karaokeBurnedVideoUrl: undefined,
          karaokeVideoSource: 'composed',
          karaokeComposedVideoUrl: composed,
        },
      );
      return;
    }
    persistKaraokeProject(
      { ...base, videoUrl: undefined, updatedAt: Date.now() },
      {
        karaokeBurnedVideoUrl: undefined,
        karaokeVideoSource: undefined,
      },
    );
  }, [karaokeSeed, persistKaraokeProject]);

  const onUploadKaraokeVideoFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      if (file.size > KARAOKE_VIDEO_MAX_BYTES) {
        showAlert(tt.karaokeUploadVideoTooLarge);
        return;
      }
      const api = window.electronAPI;
      const projectId = data?.projectId || undefined;
      const filePath = String((file as File & { path?: string }).path || '').trim();
      const prevUrl = String(
        karaokeSeedRef.current?.videoUrl ||
          karaokeSeed?.videoUrl ||
          (dataRef.current as DirectorNodeData | undefined)?.karaokeProject?.videoUrl ||
          '',
      ).trim();
      setBusyAction('karaoke-upload');
      let videoUrl = '';
      // 大成片优先按路径复制进项目 assets，避免 arrayBuffer + IPC 整包传输卡死
      if (filePath && api?.createVideoLocalResourceFromFile) {
        try {
          const r = await api.createVideoLocalResourceFromFile(projectId, filePath);
          videoUrl = String(r?.originalUrl || '').trim();
        } catch (e) {
          console.warn('[DirectorNode] createVideoLocalResourceFromFile 失败', e);
        }
      }
      if (!videoUrl && filePath && api?.copyFileToProjectAssets) {
        try {
          const { savedPath } = await api.copyFileToProjectAssets(projectId, filePath);
          videoUrl = `local-resource://${savedPath}`;
        } catch (e) {
          console.warn('[DirectorNode] copyFileToProjectAssets 失败', e);
        }
      }
      if (
        !videoUrl &&
        !filePath &&
        file.size <= KARAOKE_VIDEO_BUFFER_FALLBACK_MAX_BYTES &&
        api?.saveDroppedFileBufferToProjectAssets
      ) {
        try {
          const buffer = await file.arrayBuffer();
          const { savedPath } = await api.saveDroppedFileBufferToProjectAssets(
            projectId,
            file.name || 'karaoke-mv.mp4',
            buffer,
          );
          videoUrl = `local-resource://${savedPath}`;
        } catch (e) {
          console.warn('[DirectorNode] 上传卡拉OK成片 buffer 失败', e);
        }
      }
      if (!videoUrl) {
        try {
          videoUrl = URL.createObjectURL(file);
        } catch {
          setBusyAction(null);
          showAlert(tt.karaokeUploadVideoFailed);
          return;
        }
      }
      try {
        if (prevUrl.startsWith('blob:') && prevUrl !== videoUrl) {
          try {
            URL.revokeObjectURL(prevUrl);
          } catch {
            /* ignore */
          }
        }
        // 优先复用当前编辑器工程（保留字级/样式），仅替换成片 URL
        const prevProj =
          karaokeSeedRef.current ||
          karaokeSeed ||
          (dataRef.current as DirectorNodeData | undefined)?.karaokeProject;
        const seed = prevProj
          ? {
              ...prevProj,
              videoUrl,
              audioSource: resolveKaraokeAudioSource({
                ...prevProj,
                videoUrl,
              }),
              updatedAt: Date.now(),
            }
          : buildKaraokeSeed(videoUrl) ||
            karaokeProjectFromDirectorState(directorStateRef.current, videoUrl);
        // 显式替换成片；旧烧录结果作废；保留合成成片缓存以便清除后回退
        // 先写 source ref，避免同帧 composed effect 用旧 dataRef 打回合成片
        karaokeVideoSourceRef.current = 'user';
        persistKaraokeProject(
          { ...seed, videoUrl, updatedAt: Date.now() },
          { karaokeBurnedVideoUrl: undefined, karaokeVideoSource: 'user' },
        );
      } finally {
        setBusyAction(null);
      }
    },
    [
      buildKaraokeSeed,
      data?.projectId,
      karaokeSeed,
      persistKaraokeProject,
      showAlert,
      tt.karaokeUploadVideoFailed,
      tt.karaokeUploadVideoTooLarge,
    ],
  );

  /** 进入第 8 步：优先用户成片，否则自动带入合成成片 */
  useEffect(() => {
    if (!karaokePanelActive) return;
    const d = dataRef.current as DirectorNodeData | undefined;
    const source = karaokeVideoSourceRef.current ?? d?.karaokeVideoSource;
    const composed = String(d?.karaokeComposedVideoUrl || '').trim();
    const cur = String(d?.karaokeProject?.videoUrl || '').trim();
    let videoUrl = '';
    if (source === 'user' && cur) videoUrl = cur;
    else if (composed) videoUrl = composed;
    else if (cur) videoUrl = cur;

    const seed = buildKaraokeSeed(videoUrl || undefined);
    if (seed) {
      setKaraokeSeed(seed);
      karaokeSeedRef.current = seed;
      setKaraokeOpen(false);
      // 已有合成成片缓存时写入工程，避免空白要用户再点「导入」
      if (videoUrl && composed && source !== 'user') {
        const needBind =
          String(d?.karaokeProject?.videoUrl || '').trim() !== videoUrl ||
          d?.karaokeVideoSource !== 'composed' ||
          String(d?.karaokeComposedVideoUrl || '').trim() !== composed;
        if (needBind) {
          persistKaraokeProject(
            { ...seed, videoUrl, updatedAt: Date.now() },
            {
              karaokeComposedVideoUrl: composed,
              karaokeVideoSource: 'composed',
            },
          );
        }
      }
    }

    // 尚无成片：仅当已有合成缓存或已关联剪辑轨时才后台导出。
    // 全失败/无成片时勿静默 resolve→previewToSplice（会抢焦点，像「下一步没反应」）
    const linkedSplice = String(directorStateRef.current.linkedSpliceNodeId || '').trim();
    if (
      !videoUrl &&
      seed &&
      d?.onResolveKaraokeMvVideo &&
      (composed || linkedSplice)
    ) {
      let cancelled = false;
      setBusyAction((prev) => prev || 'karaoke-import');
      void (async () => {
        try {
          await applyComposedKaraokeVideo({ silent: true });
        } finally {
          if (!cancelled) {
            setBusyAction((prev) => (prev === 'karaoke-import' ? null : prev));
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    return undefined;
    // 仅在切入第 8 步时灌入；异步合成完成由 composedVideoUrlProp effect 承接
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 避免 seed 回写反复重建编辑器
  }, [karaokePanelActive]);

  /**
   * 第 7 步剪辑轨导出完成后（异步写入 karaokeComposedVideoUrl）：
   * 若第 8 步已打开且未指定本地成片，自动采用新合成成片。
   * 注意：切勿把 karaokeSeed.videoUrl 放进 deps —— 用户上传会改 seed，
   * 而 data.karaokeVideoSource 尚未回写时会被误判为「非 user」从而打回合成片。
   */
  const composedVideoUrlProp = String(
    (data as DirectorNodeData | undefined)?.karaokeComposedVideoUrl || '',
  ).trim();
  useEffect(() => {
    if (!karaokePanelActive || !composedVideoUrlProp) return;
    if (karaokeVideoSourceRef.current === 'user') return;
    const d = dataRef.current as DirectorNodeData | undefined;
    if (d?.karaokeVideoSource === 'user') return;
    // 以本地 seed 为准：Workspace 异步写入后须灌入编辑器
    const seedUrl = String(karaokeSeedRef.current?.videoUrl || '').trim();
    if (seedUrl === composedVideoUrlProp) return;
    const seed =
      buildKaraokeSeed(composedVideoUrlProp) ||
      karaokeProjectFromDirectorState(directorStateRef.current, composedVideoUrlProp);
    persistKaraokeProject(
      { ...seed, videoUrl: composedVideoUrlProp, updatedAt: Date.now() },
      {
        karaokeComposedVideoUrl: composedVideoUrlProp,
        karaokeVideoSource: 'composed',
      },
    );
  }, [
    karaokePanelActive,
    composedVideoUrlProp,
    buildKaraokeSeed,
    persistKaraokeProject,
  ]);

  useEffect(() => {
    if (!karaokePanelActive) setKaraokeEditorBusy('idle');
  }, [karaokePanelActive]);

  /** 第8步：直接嵌入卡拉OK编辑器（不再显示成片来源中间页） */
  const renderMvKaraokePanel = () => {
    const lyrics = String(state.mvMusic?.lyrics || '').trim();
    const audio = String(state.mvMusic?.url || '').trim();
    if (!lyrics || !audio) {
      return (
        <div
          className={`flex flex-1 min-h-0 items-center justify-center px-4 text-center ${
            isDarkMode ? 'text-white/55' : 'text-gray-500'
          }`}
          style={{ fontSize: fsSmall }}
        >
          {tt.karaokeNeedMusicLyrics}
        </div>
      );
    }
    if (!karaokeSeed) {
      return (
        <div
          className={`flex flex-1 min-h-0 items-center justify-center gap-2 ${
            isDarkMode ? 'text-white/55' : 'text-gray-500'
          }`}
          style={{ fontSize: fsSmall }}
        >
          <Loader2 className="w-4 h-4 animate-spin" />
          {tt.karaokeSubtitles}
        </div>
      );
    }
    const videoBusy: 'upload' | 'import' | null =
      busyAction === 'karaoke-upload'
        ? 'upload'
        : busyAction === 'karaoke-import'
          ? 'import'
          : null;
    return (
      <KaraokeSubtitleEditor
        open
        variant="embedded"
        hideClose
        hideFooterActions
        actionsRef={karaokeEditorActionsRef}
        onBusyChange={setKaraokeEditorBusy}
        onClose={() => {
          goDirectorPhase('videos');
        }}
        projectId={data?.projectId}
        initialProject={karaokeSeed}
        entryLabel={tt.karaokeSubtitles}
        onProjectChange={(p) => {
          const d = dataRef.current as DirectorNodeData | undefined;
          const nextUrl = String(p.videoUrl || '').trim();
          const prevUrl = String(d?.karaokeProject?.videoUrl || karaokeSeed?.videoUrl || '').trim();
          const extra: Partial<DirectorNodeData> = {};
          const source = karaokeVideoSourceRef.current ?? d?.karaokeVideoSource;
          // 编辑器自动 resolve 写入的成片 → 记为合成来源并缓存
          if (
            nextUrl &&
            nextUrl !== prevUrl &&
            source !== 'user' &&
            (nextUrl === String(d?.karaokeComposedVideoUrl || '').trim() || !prevUrl)
          ) {
            extra.karaokeComposedVideoUrl = nextUrl;
            extra.karaokeVideoSource = 'composed';
          }
          persistKaraokeProject(p, extra);
        }}
        resolveVideoUrl={
          data?.onResolveKaraokeMvVideo || composedVideoUrlProp
            ? async () => resolveKaraokeComposedVideoUrl()
            : undefined
        }
        onPickLocalVideo={onPickKaraokeVideoClick}
        onImportComposeVideo={
          data?.onResolveKaraokeMvVideo || composedVideoUrlProp
            ? () => {
                void importKaraokeFromCompose();
              }
            : undefined
        }
        onClearVideo={clearKaraokeVideo}
        videoSourceBusy={videoBusy}
        onBurned={(result) => {
          const burnedUrl = String(result.originalUrl || '').trim();
          const add = data?.onAddVideoClipNodes;
          data?.onUpdate?.({
            karaokeProject: result.karaokeProject,
            karaokeBurnedVideoUrl: burnedUrl || undefined,
          } as Partial<DirectorNodeData>);
          if (!add) {
            showAlert(result.originalUrl);
            return;
          }
          const newId = `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const w = 420;
          const h = 236;
          const storeState = store.getState();
          const self = storeState.nodeInternals.get(id);
          const originX =
            (self?.positionAbsolute?.x ?? self?.position?.x ?? 0) + (self?.width ?? sizeW) + 48;
          const originY = self?.positionAbsolute?.y ?? self?.position?.y ?? 0;
          add({
            nodes: [
              {
                id: newId,
                type: 'video',
                position: { x: originX, y: originY },
                data: {
                  width: w,
                  height: h,
                  label: tt.karaokeSubtitles,
                  title: tt.karaokeSubtitles,
                  outputVideo: result.originalUrl,
                  localPath: result.originalPath,
                  preserveExportLayout: true,
                  exportedMediaClip: true,
                  karaokeProject: result.karaokeProject,
                  videoAsset: {
                    poster: result.posterUrl,
                    width: result.width,
                    height: result.height,
                  },
                },
                style: { width: w, height: h },
                selected: true,
              },
            ],
            edges: [
              {
                id: `e-${id}-${newId}-karaoke`,
                source: id,
                sourceHandle: 'output',
                target: newId,
                targetHandle: 'input',
              },
            ],
          });
        }}
      />
    );
  };

  /** 第7步：视频生成表（列宽/音频/对口型/成片交互对齐分镜生成表） */
  const renderMvVideosPanel = (opts?: { maxHeightClass?: string; panelActive?: boolean }) => {
    const maxH = opts?.maxHeightClass || '';
    const panelActive = opts?.panelActive !== false;
    // 视频步参考分镜图拉满原「图+下方按钮」区域；画布选择/电脑上传改为悬停浮层
    const videoThumbH = SHOTS_CONFIRM_SB_THUMB_PX;
    const videoThumbW = Math.round(videoThumbH * (16 / 9));
    const videoEmptyH = Math.round(videoThumbH * 0.85);
    const refThumbH = videoThumbH;
    const refThumbW = Math.round(refThumbH * (16 / 9));
    const actionFs = Math.max(10, fsChrome - 1);
    const actionSecondaryCls = isDarkMode
      ? 'nodrag inline-flex w-full items-center justify-center gap-1 rounded-md px-1.5 py-0.5 ring-1 whitespace-nowrap font-medium bg-white/[0.1] text-white/90 ring-white/20 hover:bg-white/[0.16] hover:text-white disabled:opacity-40'
      : 'nodrag inline-flex w-full items-center justify-center gap-1 rounded-md px-1.5 py-0.5 ring-1 whitespace-nowrap font-medium bg-white text-gray-800 ring-gray-300 hover:bg-sky-50 hover:text-sky-800 hover:ring-sky-300 disabled:opacity-40';
    const videoCols = [
      { key: '镜号', width: '56px', label: tt.colShotNo },
      { key: '时长', width: '44px', label: tt.colDuration },
      { key: '最终提示词', width: '168px', label: tt.colFinalPrompt },
      { key: '__ref_sb__', width: `${refThumbW + 8}px`, label: tt.colRefStoryboard },
      { key: '__cast__', width: '112px', label: tt.colShotCast },
      { key: '__lens__', width: '52px', label: tt.colAngleFocal },
      { key: '__audio__', width: '220px', label: tt.colShotAudio },
      { key: '__lipsync__', width: '88px', label: tt.colLipsync },
      { key: '__video__', width: '168px', label: tt.colShotVideo },
    ] as const;

    return (
      <div className="flex flex-col flex-1 min-h-0 gap-2">
        {renderScriptStaleBanner()}
        {renderMvVideoGenToolbar()}
        <DirectorShotTableVirtual
          count={state.shots.length}
          estimateSize={DIRECTOR_MV_VIDEO_ROW_ESTIMATE_PX}
          getItemKey={(i) => String(state.shots[i]?.['镜号'] ?? i)}
          className={`nowheel flex-1 min-h-0 overflow-auto ${maxH} ${scrollCls}`}
        >
          {({ virtualItems, paddingTop, paddingBottom, measureElement }) => (
          <table className="w-full table-fixed border-collapse" style={{ fontSize: fsSmall }}>
            <thead className={`sticky top-0 z-10 ${tableHeadBg}`}>
              <tr className={`border-b ${cellBorder} ${mutedCls}`}>
                {videoCols.map((c) => (
                  <th
                    key={c.key}
                    className="px-1.5 py-1.5 text-center font-medium whitespace-nowrap"
                    style={{ width: c.width }}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <DirectorTableVirtualPad height={paddingTop} colSpan={videoCols.length} />
              {virtualItems.map((virtualRow) => {
                const rowIndex = virtualRow.index;
                const shot = state.shots[rowIndex];
                if (!shot) return null;
                const shotNo = String(shot['镜号'] || rowIndex + 1);
                const sb = getDirectorShotStoryboard(state, shotNo);
                const sbUrl = String(sb?.imageUrl || '').trim();
                const sbVersions = listDirectorShotStoryboardImages(sb);
                const videoUrl = String(sb?.videoUrl || '').trim();
                const videoVersions = listDirectorShotVideos(sb);
                const videoStatus = sb?.videoStatus || (videoUrl ? 'ready' : 'pending');
                const videoGenerating =
                  videoStatus === 'generating' || !!videoGenProgressIds[String(shotNo).trim()];
                const promptVersions = getRepairedShotPromptVersions(shot, rowIndex, sb);
                const rowUnseen = !!(sb?.promptOptimizedUnseen || sb?.videoUnseen);
                const finalVal = promptVersions.active || resolveShotFinalPrompt(shot);
                const movePrompt = String(shot['运镜'] || '').trim();
                const audioRange = shotMusicRanges[rowIndex] || {
                  startSec: 0,
                  endSec: parseDirectorShotDurationSec(shot['时长'], 5),
                  durationSec: parseDirectorShotDurationSec(shot['时长'], 5),
                };
                const canGen = !!finalVal && !!sbUrl;
                const lipsyncEval = resolveMvShotLipsync(shot, rowIndex, sb, audioRange);
                const lipsyncOn = lipsyncEval.lipsyncOn;
                const lipsyncPriority = lipsyncEval.priority;
                const lipsyncFaceFar = !!lipsyncEval.faceFarWarning;
                const priceModel = lipsyncOn ? videoBatchLipsyncModel : videoBatchModel;
                const analyzedDurSec =
                  Number(audioRange.durationSec) > 0
                    ? Number(audioRange.durationSec)
                    : parseDirectorShotDurationSec(shot['时长'], 5);
                const modelDurSec = Number(
                  pickNearestDirectorVideoBatchDuration(priceModel, analyzedDurSec),
                );
                const durationCell = lipsyncOn
                  ? `${Math.round(analyzedDurSec)}s`
                  : Number.isFinite(modelDurSec) &&
                      modelDurSec > 0 &&
                      Math.round(analyzedDurSec) !== modelDurSec
                    ? fillDirectorI18n(tt.videoDurationSnapped, {
                        shot: `${Math.round(analyzedDurSec)}s`,
                        model: `${modelDurSec}s`,
                      })
                    : shot['时长'] || `${Math.round(analyzedDurSec)}s`;
                // 允许「生成中」时强制重新生成（卡死退出后否则按钮一直灰掉）
                const genDisabled = !canGen || isDirectorHardBusy;
                const genLabel = videoGenerating
                  ? tt.generatingVideo
                  : videoUrl
                    ? tt.regenerateStoryboard
                    : tt.generateThisStoryboard;
                const unmuted = !!shotVideoUnmuted[shotNo];
                const playWithSound = videoHoverSoundOn || unmuted;
                const angle = String(shot['镜头角度'] || '').trim();
                const focal = String(shot['焦距'] || '').trim();
                const priced = videoGenYuanbaoForShot({
                  preferLipsync: lipsyncOn,
                  durationSec: analyzedDurSec,
                });
                const yuanbaoTip =
                  priceHoverKey === `video-gen-${shotNo}` && priced
                    ? locale === 'en'
                      ? `${priced.yuanbao} ${tt.creditsSuffix}`
                      : `${priced.yuanbao}${tt.creditsSuffix}`
                    : null;

                return (
                  <tr
                    key={`video-row-${shotNo}`}
                    ref={measureElement}
                    data-index={rowIndex}
                    className={`${
                      rowUnseen ? shotRowUnseenHighlightCls : rowHover
                    } border-b ${cellBorder}`}
                    style={
                      rowUnseen || !isNodeFullscreen
                        ? undefined
                        : DIRECTOR_MV_TABLE_ROW_CV
                    }
                    {...bindShotRowUnseenAck(shotNo, rowUnseen)}
                  >
                    <td className={`px-1 py-2 align-middle text-center border-t ${cellBorder}`}>
                      {renderShotNoCellContent(shotNo, rowIndex)}
                    </td>
                    <td
                      className={`px-1 py-2 align-middle text-center tabular-nums border-t ${cellBorder} ${mutedCls}`}
                      style={{ fontSize: fsSmall }}
                    >
                      {editing?.row === rowIndex && editing?.col === '时长' ? (
                        <input
                          className={`nodrag nowheel w-full max-w-[3.25rem] mx-auto bg-transparent ring-1 rounded px-1 py-0.5 outline-none text-center ${
                            isDarkMode
                              ? 'ring-blue-500/40 text-white/90'
                              : 'ring-blue-400/50 text-gray-900'
                          }`}
                          style={{ fontSize: fsSmall }}
                          autoFocus
                          defaultValue={
                            String(shot['时长'] || '').trim() ||
                            `${Math.round(analyzedDurSec)}s`
                          }
                          placeholder="5s"
                          onBlur={(e) => {
                            const raw = e.target.value.trim();
                            const sec = parseDirectorShotDurationSec(raw, 0);
                            const nextDur =
                              sec > 0 ? `${Math.round(sec)}s` : raw ? raw : '';
                            const latest = directorStateRef.current;
                            let next = updateDirectorShotCell(
                              latest,
                              rowIndex,
                              '时长',
                              nextDur,
                            );
                            if (sec > 0) {
                              const range = shotMusicRanges[rowIndex] || {
                                startSec: 0,
                                endSec: sec,
                                durationSec: sec,
                              };
                              const startSec = Math.max(0, Number(range.startSec) || 0);
                              const endSec = startSec + sec;
                              next = updateDirectorShotStoryboard(next, shotNo, {
                                audioStartSec: startSec,
                                audioEndSec: endSec,
                                songClipUrl: '',
                                songClipSourceUrl: '',
                                songClipStartSec: startSec,
                                songClipEndSec: endSec,
                              });
                            }
                            patch(next);
                            setEditing(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') setEditing(null);
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              (e.currentTarget as HTMLInputElement).blur();
                            }
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <div
                          className="nodrag cursor-text min-h-[18px]"
                          title={`${tt.colDuration} · 双击修改`}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setEditingAudioRow(null);
                            setEditing({ row: rowIndex, col: '时长' });
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          {durationCell}
                        </div>
                      )}
                    </td>
                    <td className={`px-1.5 py-1.5 align-middle text-left border-t ${cellBorder}`}>
                      <div className="flex flex-col items-stretch gap-1 min-w-0">
                        {renderFinalPromptHoverCell({
                          text: finalVal,
                          editText: promptVersions.original || resolveShotFinalPrompt(shot),
                          shotNo,
                          rowIndex,
                        })}
                      </div>
                    </td>
                    <td className={`p-1 align-middle border-t relative overflow-visible ${cellBorder}`}>
                      {(() => {
                        const actionFsLocal = Math.max(9, fsChrome - 2);
                        const refSbHoverBtnCls = isDarkMode
                          ? 'nodrag inline-flex flex-1 min-w-0 items-center justify-center gap-0.5 rounded-none first:rounded-tl-md last:rounded-tr-md px-1 py-0.5 ring-1 ring-inset whitespace-nowrap font-medium bg-black/70 text-white/95 ring-white/25 hover:bg-black/85 hover:text-white backdrop-blur-[2px]'
                          : 'nodrag inline-flex flex-1 min-w-0 items-center justify-center gap-0.5 rounded-none first:rounded-tl-md last:rounded-tr-md px-1 py-0.5 ring-1 ring-inset whitespace-nowrap font-medium bg-white/92 text-gray-800 ring-gray-300 hover:bg-sky-50 hover:text-sky-800 hover:ring-sky-300 shadow-sm';
                        const renderRefSbHoverActions = () => (
                          <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex w-full opacity-0 transition-opacity group-hover/sbf:pointer-events-auto group-hover/sbf:opacity-100">
                            {data?.onPickImageFromCanvas ? (
                              <button
                                type="button"
                                className={refSbHoverBtnCls}
                                style={{ fontSize: actionFsLocal }}
                                title={tt.pickFromCanvas}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void pickStoryboardFromCanvas(shotNo);
                                }}
                                onPointerDown={(e) => e.stopPropagation()}
                              >
                                <MousePointerClick className="w-2.5 h-2.5 shrink-0 opacity-90" />
                                {tt.pickFromCanvas}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className={refSbHoverBtnCls}
                              style={{ fontSize: actionFsLocal }}
                              title={tt.uploadLocal}
                              onClick={(e) => {
                                e.stopPropagation();
                                onUploadStoryboardClick(shotNo);
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                            >
                              <Upload className="w-2.5 h-2.5 shrink-0 opacity-90" />
                              {tt.uploadLocal}
                            </button>
                          </div>
                        );
                        return (
                      <div
                        className="relative w-full flex items-center justify-center overflow-visible"
                        style={{ height: refThumbH }}
                        data-director-picker-keep="sb"
                        onMouseEnter={() => openSbVersionPicker(shotNo, sbVersions.length)}
                        onMouseLeave={() => scheduleCloseSbVersionPicker(shotNo)}
                      >
                        {sbUrl ? (
                          <>
                            <div className="relative inline-flex max-w-full group/sbf overflow-hidden rounded-lg">
                              <DirectorAspectThumbButton
                                frame="storyboard"
                                url={sbUrl}
                                alt={`镜${shotNo}`}
                                title={
                                  sbVersions.length > 1
                                    ? tt.storyboardPickVersion
                                    : `${tt.viewImage}: ${tt.colRefStoryboard} ${shotNo}`
                                }
                                maxH={refThumbH}
                                maxW={refThumbW}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (sbVersions.length > 1) {
                                    openSbVersionPicker(shotNo, sbVersions.length);
                                  } else {
                                    setImagePreview({ url: sbUrl, name: `镜${shotNo}` });
                                  }
                                }}
                                onPointerDown={(e) => e.stopPropagation()}
                              />
                              {sbVersions.length > 1 ? (
                                <span
                                  className={`pointer-events-none absolute left-1 bottom-1 z-20 rounded px-1 font-medium tabular-nums ${
                                    isDarkMode
                                      ? 'bg-black/70 text-white/90'
                                      : 'bg-gray-100/95 text-gray-700 shadow'
                                  }`}
                                  style={{ fontSize: 10 }}
                                >
                                  {sbVersions.length}
                                </span>
                              ) : null}
                              {renderRefSbHoverActions()}
                            </div>
                            {renderSbVersionPopover(shotNo, sbVersions, sbUrl)}
                          </>
                        ) : (
                          <div
                            className={`relative group/sbf w-full rounded-lg overflow-hidden ring-1 ring-dashed ${
                              isDarkMode
                                ? 'ring-white/25 bg-black/25 text-white/45'
                                : 'ring-gray-300 bg-gray-100 text-gray-400'
                            }`}
                            style={{
                              aspectRatio: '16 / 9',
                              height: refThumbH,
                              maxWidth: '100%',
                            }}
                          >
                            <button
                              type="button"
                              className="nodrag absolute inset-0 flex flex-col items-center justify-center gap-0.5"
                              style={{ fontSize: 10 }}
                              title={tt.uploadLocal}
                              onClick={(e) => {
                                e.stopPropagation();
                                onUploadStoryboardClick(shotNo);
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                            >
                              <Plus className="w-4 h-4" strokeWidth={2} />
                              <span className="px-1 text-center leading-tight">{tt.colRefStoryboard}</span>
                            </button>
                            {renderRefSbHoverActions()}
                          </div>
                        )}
                      </div>
                        );
                      })()}
                    </td>
                    {(() => {
                      const orderedRefs = orderedAssetsWithImages;
                      const boundIdx = getShotBoundRefIndices(shot, orderedRefs, rowIndex);
                      const castAssets = boundIdx
                        .map((i) => orderedRefs[i])
                        .filter((a) => a?.kind === 'character');
                      const availableCast = (state.assets.characters || []).filter((a) =>
                        String(a?.imageUrl || '').trim(),
                      );
                      const selectedIds = castAssets
                        .map((a) => String(a?.id || '').trim())
                        .filter(Boolean);
                      const thumbs = castAssets
                        .map((a) => ({
                          id: String(a?.id || '').trim(),
                          url: String(a?.imageUrl || '').trim(),
                          name: String(a?.name || '').trim(),
                        }))
                        .filter((x) => x.url);
                      const castNamesFromAssets = thumbs
                        .map((t) => t.name)
                        .filter(Boolean)
                        .join('、');
                      const castLabelFallback = String(shot['出场人物'] || '')
                        .trim()
                        .replace(/^—+$/, '');
                      const castNames = castNamesFromAssets || castLabelFallback;
                      const pickerOpen = castPickerShotNo === shotNo;
                      const castThumbH = Math.round(refThumbH * 0.92);
                      const toggleCastId = (assetId: string) => {
                        const id = String(assetId || '').trim();
                        if (!id) return;
                        const next = selectedIds.includes(id)
                          ? selectedIds.filter((x) => x !== id)
                          : [...selectedIds, id].slice(0, 2);
                        applyShotCastAssetIds(shotNo, rowIndex, next);
                      };
                      return (
                        <td className={`p-1 align-middle border-t overflow-visible ${cellBorder}`}>
                          <div
                            className="relative w-full flex flex-col items-center justify-center gap-0.5 overflow-visible"
                            style={{ minHeight: refThumbH }}
                          >
                            {thumbs.length > 0 ? (
                              <div className="flex items-center justify-center gap-1 max-w-full">
                                {thumbs.map((t) => (
                                  <div
                                    key={`${t.id}-${t.url}`}
                                    className="relative shrink-0"
                                    data-director-picker-keep="cast"
                                  >
                                    <DirectorAspectThumbButton
                                      frame="cast"
                                      maxH={castThumbH}
                                      maxW={Math.round(castThumbH * (9 / 16))}
                                      url={t.url}
                                      alt={t.name || tt.characters}
                                      title={
                                        pickerOpen
                                          ? `${tt.viewImage}: ${t.name || tt.characters}`
                                          : tt.castReplaceShot
                                      }
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (pickerOpen) {
                                          setImagePreview({
                                            url: t.url,
                                            name: t.name || tt.characters,
                                          });
                                          return;
                                        }
                                        setScenePickerShotNo(null);
                                        setSbSourceMenuShotNo(null);
                                        setSbPickerShotNo(null);
                                        setCastPickerShotNo(shotNo);
                                      }}
                                      onPointerDown={(e) => e.stopPropagation()}
                                    />
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <button
                                type="button"
                                className={`nodrag flex flex-col items-center justify-center gap-0.5 rounded-lg ring-1 ring-dashed px-0.5 ${
                                  isDarkMode
                                    ? 'ring-white/25 bg-black/25 text-white/40 hover:bg-white/[0.06]'
                                    : 'ring-gray-300 bg-gray-100 text-gray-400 hover:bg-gray-200/70'
                                }`}
                                style={{
                                  height: castThumbH,
                                  width: Math.round(castThumbH * (9 / 16)),
                                }}
                                title={
                                  availableCast.length
                                    ? tt.castPickForShot
                                    : tt.castEmptyShotHint
                                }
                                disabled={availableCast.length === 0}
                                data-director-picker-keep="cast"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!availableCast.length) return;
                                  setScenePickerShotNo(null);
                                  setSbSourceMenuShotNo(null);
                                  setSbPickerShotNo(null);
                                  setCastPickerShotNo(pickerOpen ? null : shotNo);
                                }}
                                onPointerDown={(e) => e.stopPropagation()}
                              >
                                <Plus className="w-4 h-4 opacity-70" />
                                {castLabelFallback ? (
                                  <User className="w-3 h-3 opacity-60" />
                                ) : null}
                              </button>
                            )}
                            <div
                              className={`w-full truncate text-center ${
                                castNames ? bodyCls : mutedCls
                              }`}
                              style={{ fontSize: Math.max(10, fsChrome - 1) }}
                              title={castNames || tt.castEmptyShotHint}
                            >
                              {castNames || '—'}
                            </div>
                            {pickerOpen ? (
                              <div
                                data-director-picker-keep="cast"
                                className={`absolute left-0 top-full z-40 mt-1 min-w-[168px] rounded-lg border p-1.5 shadow-lg ${
                                  isDarkMode
                                    ? 'border-white/15 bg-zinc-950'
                                    : 'border-gray-200 bg-gray-100'
                                }`}
                                onPointerDown={(e) => e.stopPropagation()}
                              >
                                <div
                                  className={`px-1 pb-1 ${mutedCls}`}
                                  style={{ fontSize: Math.max(10, fsChrome - 1) }}
                                >
                                  {tt.castPickForShot}
                                  {availableCast.length >= 2 ? ' · ≤2' : ''}
                                </div>
                                <button
                                  type="button"
                                  className={`nodrag w-full flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left mb-0.5 ${
                                    selectedIds.length === 0
                                      ? isDarkMode
                                        ? 'bg-emerald-500/25 text-emerald-100'
                                        : 'bg-emerald-100 text-emerald-900'
                                      : isDarkMode
                                        ? 'hover:bg-white/8 text-white/85'
                                        : 'hover:bg-gray-200/70 text-gray-800'
                                  }`}
                                  style={{ fontSize: fsChrome }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    applyShotCastAssetIds(shotNo, rowIndex, []);
                                    setCastPickerShotNo(null);
                                  }}
                                >
                                  <span className="min-w-0 flex-1 truncate">
                                    {tt.castEmptyShotOption}
                                  </span>
                                  {selectedIds.length === 0 ? (
                                    <Check className="w-3.5 h-3.5 shrink-0" />
                                  ) : null}
                                </button>
                                {availableCast.map((a) => {
                                  const id = String(a.id || '').trim();
                                  const aUrl = String(a.imageUrl || '').trim();
                                  const aName = String(a.name || '').trim() || tt.characters;
                                  const on = selectedIds.includes(id);
                                  return (
                                    <button
                                      key={id}
                                      type="button"
                                      className={`nodrag w-full flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left ${
                                        on
                                          ? isDarkMode
                                            ? 'bg-sky-500/25 text-sky-100'
                                            : 'bg-sky-100 text-sky-900'
                                          : isDarkMode
                                            ? 'hover:bg-white/8 text-white/85'
                                            : 'hover:bg-gray-200/70 text-gray-800'
                                      }`}
                                      style={{ fontSize: fsChrome }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleCastId(id);
                                      }}
                                    >
                                      {aUrl ? (
                                        <img
                                          src={aUrl}
                                          alt=""
                                          className="w-6 h-6 rounded object-cover shrink-0"
                                        />
                                      ) : (
                                        <span className="w-6 h-6 rounded bg-black/20 shrink-0" />
                                      )}
                                      <span className="min-w-0 flex-1 truncate">{aName}</span>
                                      {on ? <Check className="w-3.5 h-3.5 shrink-0" /> : null}
                                    </button>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        </td>
                      );
                    })()}
                    <td className={`px-1 py-1.5 align-middle border-t ${cellBorder}`}>
                      <div className="flex flex-col items-center justify-center text-center gap-0.5 min-w-0">
                        <div className={`truncate w-full ${bodyCls}`} title={angle || undefined}>
                          {angle || '—'}
                        </div>
                        <div
                          className={`truncate w-full ${mutedCls}`}
                          style={{ fontSize: Math.max(10, fsChrome - 1) }}
                          title={focal || movePrompt || undefined}
                        >
                          {focal || movePrompt || '—'}
                        </div>
                      </div>
                    </td>
                    <td className={`px-1.5 py-2 align-middle text-center border-t ${cellBorder}`}>
                      {renderShotSongClipCell(
                        audioRange,
                        shotNo,
                        SHOTS_CONFIRM_AUDIO_WIDTH_CLS,
                        'confirmPill',
                      )}
                    </td>
                    <td className={`px-1 py-2 align-middle border-t ${cellBorder}`}>
                      <div className="flex flex-col items-stretch gap-1 min-w-0">
                        <div className="w-full flex justify-center [&>button]:w-full">
                          {renderShotLipsyncToggle(shotNo, lipsyncOn, lipsyncPriority, lipsyncFaceFar)}
                        </div>
                        {(() => {
                          if (!lipsyncOn) return null;
                          const orderedRefs = orderedAssetsWithImages;
                          const boundIdx = getShotBoundRefIndices(shot, orderedRefs, rowIndex);
                          const names = boundIdx
                            .map((i) => orderedRefs[i])
                            .filter((a) => a?.kind === 'character')
                            .map((a) => String(a?.name || '').trim())
                            .filter(Boolean);
                          const label = names[0] || String(shot['出场人物'] || '').trim();
                          if (!label || label === '—') return null;
                          return (
                            <div
                              className={`w-full truncate text-center ${mutedCls}`}
                              style={{ fontSize: Math.max(10, fsChrome - 1) }}
                              title={fillDirectorI18n(tt.lipsyncCastSubject, { name: label })}
                            >
                              {fillDirectorI18n(tt.lipsyncCastSubject, { name: label })}
                            </div>
                          );
                        })()}
                        <button
                          type="button"
                          className={`${actionSecondaryCls} disabled:opacity-50`}
                          style={{ fontSize: actionFs }}
                          disabled={!!busyAction}
                          title={tt.videoRebuildPromptFromScriptHint}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRebuildShotPromptFromScript(rowIndex);
                          }}
                        >
                          {tt.videoRebuildPromptFromScript}
                        </button>
                        <button
                          type="button"
                          className={`${actionSecondaryCls} disabled:opacity-50`}
                          style={{ fontSize: actionFs }}
                          disabled={
                            busyAction === 'videos' ||
                            busyAction === 'optimize-prompts' ||
                            optimizingShotNos.includes(shotNo) ||
                            !String(shot['最终提示词'] || shot['画面描述'] || '').trim()
                          }
                          title={tt.videoOptimizePrompt}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleOptimizeVideoPrompts([shotNo]);
                          }}
                        >
                          {optimizingShotNos.includes(shotNo) ? (
                            <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                          ) : null}
                          {tt.videoOptimizePrompt}
                        </button>
                        <span className="relative inline-flex w-full">
                          <button
                            type="button"
                            className={`nodrag ${btnPrimary('!px-1.5 !py-0.5 rounded-md w-full', 'events')} disabled:opacity-50`}
                            style={{ fontSize: actionFs }}
                            disabled={genDisabled || optimizingShotNos.includes(shotNo)}
                            title={
                              !sbUrl
                                ? tt.needStoryboardsFirst
                                : !finalVal
                                  ? tt.pendingPrompt
                                  : genLabel
                            }
                            onMouseEnter={() => {
                              if (canGen) setPriceHoverKey(`video-gen-${shotNo}`);
                            }}
                            onMouseLeave={() =>
                              setPriceHoverKey((k) => (k === `video-gen-${shotNo}` ? null : k))
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleSpawnVideosClick([shotNo]);
                            }}
                          >
                            {genLabel}
                          </button>
                          {yuanbaoTip ? (
                            <span
                              className={`${yuanbaoHoverTipCls} translate-y-0 opacity-100`}
                              title={tt.priceTooltip}
                            >
                              {yuanbaoTip}
                            </span>
                          ) : null}
                        </span>
                        {data?.onPickVideoFromCanvas ? (
                          <button
                            type="button"
                            className={actionSecondaryCls}
                            style={{ fontSize: actionFs }}
                            title={tt.pickFromCanvas}
                            onClick={(e) => {
                              e.stopPropagation();
                              void pickShotVideoFromCanvas(shotNo);
                            }}
                          >
                            <MousePointerClick className="w-3 h-3 shrink-0 opacity-80" />
                            {tt.pickFromCanvas}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={actionSecondaryCls}
                          style={{ fontSize: actionFs }}
                          title={tt.uploadLocal}
                          onClick={(e) => {
                            e.stopPropagation();
                            onUploadShotVideoClick(shotNo);
                          }}
                        >
                          <Upload className="w-3 h-3 shrink-0 opacity-80" />
                          {tt.uploadLocal}
                        </button>
                      </div>
                    </td>
                    <td className={`p-1 align-middle border-t ${cellBorder}`}>
                      {(() => {
                        const dropActive = shotVideoDropShotNo === shotNo;
                        const dropRing = dropActive
                          ? isDarkMode
                            ? 'ring-2 ring-sky-400 bg-sky-500/15'
                            : 'ring-2 ring-sky-400 bg-sky-50'
                          : '';
                        const bindShotVideoDrop = {
                          onDragEnter: (e: React.DragEvent) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setShotVideoDropShotNo(shotNo);
                          },
                          onDragOver: (e: React.DragEvent) => {
                            e.preventDefault();
                            e.stopPropagation();
                            try {
                              e.dataTransfer.dropEffect = 'copy';
                            } catch {
                              /* ignore */
                            }
                            setShotVideoDropShotNo(shotNo);
                          },
                          onDragLeave: (e: React.DragEvent) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const related = e.relatedTarget as Node | null;
                            if (related && e.currentTarget.contains(related)) return;
                            setShotVideoDropShotNo((cur) => (cur === shotNo ? null : cur));
                          },
                          onDrop: (e: React.DragEvent) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setShotVideoDropShotNo(null);
                            const file = e.dataTransfer?.files?.[0] || null;
                            void onUploadShotVideoFile(file, shotNo);
                          },
                        };
                        const openShotVideoPicker = (e: React.MouseEvent) => {
                          e.stopPropagation();
                          onUploadShotVideoClick(shotNo);
                        };
                        return (
                      <div
                        className={`relative w-full flex items-center justify-center rounded-lg transition-colors overflow-visible ${dropRing}`}
                        style={{ minHeight: videoThumbH }}
                        title={tt.shotVideoDropHint}
                        data-director-picker-keep="video"
                        onMouseEnter={() => openVideoVersionPicker(shotNo, videoVersions.length)}
                        onMouseLeave={() => scheduleCloseVideoVersionPicker(shotNo)}
                        {...bindShotVideoDrop}
                      >
                        {videoUrl ? (
                          <DirectorMvShotVideoThumb
                            videoUrl={videoUrl}
                            posterUrl={sbUrl || undefined}
                            shotNo={shotNo}
                            maxH={videoThumbH}
                            maxW={videoThumbW}
                            playWithSound={playWithSound}
                            panelActive={panelActive}
                            videoGenerating={videoGenerating}
                            isPreviewBlocked={() => videoPreviewOpenRef.current}
                            pauseOtherThumbs={pauseShotThumbVideos}
                            onClick={(e) => {
                              e.stopPropagation();
                              // 多版本：点主成片打开选择；放大镜单独负责预览
                              if (videoVersions.length > 1) {
                                openVideoVersionPicker(shotNo, videoVersions.length);
                              }
                            }}
                          >
                            {videoVersions.length > 1 ? (
                              <button
                                type="button"
                                className={`nodrag absolute left-1 bottom-1 z-20 rounded px-1 font-medium tabular-nums ${
                                  isDarkMode
                                    ? 'bg-black/70 text-white/90 ring-1 ring-white/20 hover:bg-black/85'
                                    : 'bg-gray-100/95 text-gray-700 shadow ring-1 ring-gray-300 hover:bg-white'
                                }`}
                                style={{ fontSize: 10 }}
                                title={tt.videoPickVersion}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openVideoVersionPicker(shotNo, videoVersions.length);
                                }}
                                onPointerDown={(e) => e.stopPropagation()}
                              >
                                {videoVersions.length}
                              </button>
                            ) : null}
                            {renderDirectorThumbProgress({
                              visible: videoGenerating,
                              message: tt.generatingVideo,
                            })}
                            {!videoGenerating ? (
                            <button
                              type="button"
                              className={`nodrag absolute top-1 left-1 z-30 rounded p-0.5 ${
                                isDarkMode
                                  ? 'bg-black/70 text-white/90 ring-1 ring-white/20'
                                  : 'bg-gray-100/95 text-gray-700 ring-1 ring-gray-300 shadow'
                              }`}
                              title={playWithSound ? tt.videoMute : tt.videoUnmute}
                              onClick={(e) => {
                                e.stopPropagation();
                                setShotVideoUnmuted((prev) => ({
                                  ...prev,
                                  [shotNo]: !unmuted,
                                }));
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                            >
                              {playWithSound ? (
                                <Volume2 className="w-3.5 h-3.5" />
                              ) : (
                                <VolumeX className="w-3.5 h-3.5" />
                              )}
                            </button>
                            ) : null}
                            {!videoGenerating ? (
                            <button
                              type="button"
                              className={`nodrag absolute top-1 right-1 z-30 rounded p-0.5 ${
                                isDarkMode
                                  ? 'bg-black/70 text-white/90 ring-1 ring-white/20'
                                  : 'bg-gray-100/95 text-gray-700 ring-1 ring-gray-300 shadow'
                              }`}
                              title={tt.viewImage}
                              onClick={(e) => {
                                e.stopPropagation();
                                const wrap = e.currentTarget.closest('.group\\/vidf') as HTMLElement | null;
                                const thumb = wrap?.querySelector('video');
                                if (thumb instanceof HTMLVideoElement) {
                                  try {
                                    thumb.pause();
                                  } catch {
                                    /* ignore */
                                  }
                                }
                                pauseShotThumbVideos();
                                // 始终放大当前主成片，不打开版本选择
                                openVideoPreview(videoUrl, `${tt.colShotVideo} ${shotNo}`);
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                            >
                              <ZoomIn className="w-3.5 h-3.5" />
                            </button>
                            ) : null}
                            {!videoGenerating ? (
                            <button
                              type="button"
                              className={`nodrag absolute bottom-1 right-1 z-20 rounded p-0.5 opacity-0 group-hover/vidf:opacity-100 transition-opacity ${
                                isDarkMode
                                  ? 'bg-black/70 text-white/90 ring-1 ring-white/20'
                                  : 'bg-gray-100/95 text-gray-700 ring-1 ring-gray-300 shadow'
                              }`}
                              title={tt.downloadShotVideo}
                              onClick={(e) => {
                                e.stopPropagation();
                                const a = document.createElement('a');
                                a.href = videoUrl;
                                a.download = `shot-${shotNo}-video`;
                                a.rel = 'noopener';
                                a.click();
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            ) : null}
                            {renderVideoVersionPopover(shotNo, videoVersions, videoUrl)}
                          </DirectorMvShotVideoThumb>
                        ) : videoGenerating ? (
                          <div
                            className={`relative rounded-lg overflow-hidden ring-1 ring-dashed ${
                              isDarkMode
                                ? 'ring-white/20 bg-white/[0.04]'
                                : 'ring-gray-300 bg-gray-100'
                            }`}
                            style={{
                              aspectRatio: '16 / 9',
                              height: videoEmptyH,
                              maxWidth: '100%',
                            }}
                          >
                            {renderDirectorThumbProgress({
                              visible: true,
                              message: tt.generatingVideo,
                            })}
                          </div>
                        ) : videoStatus === 'error' ? (
                          <button
                            type="button"
                            className={`nodrag rounded-lg flex flex-col items-center justify-center gap-1 px-2 text-center ring-1 ring-dashed cursor-pointer ${
                              isDarkMode
                                ? 'ring-red-400/40 bg-red-500/10 text-red-200/90 hover:bg-red-500/15'
                                : 'ring-red-300 bg-red-50 text-red-700 hover:bg-red-100'
                            }`}
                            style={{
                              aspectRatio: '16 / 9',
                              height: videoEmptyH,
                              maxWidth: '100%',
                              fontSize: 10,
                            }}
                            title={
                              String(sb?.videoError || tt.generateFailed) +
                              '\n' +
                              tt.shotVideoDropHint
                            }
                            onClick={openShotVideoPicker}
                            onPointerDown={(e) => e.stopPropagation()}
                          >
                            {tt.generateFailed}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={`nodrag flex items-center justify-center rounded-lg ring-1 ring-dashed cursor-pointer ${
                              isDarkMode
                                ? 'ring-white/25 bg-black/30 text-white/45 hover:bg-black/40 hover:text-white/70'
                                : 'ring-gray-300 bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600'
                            }`}
                            style={{
                              aspectRatio: '16 / 9',
                              height: videoEmptyH,
                              maxWidth: '100%',
                            }}
                            title={tt.shotVideoDropHint}
                            onClick={openShotVideoPicker}
                            onPointerDown={(e) => e.stopPropagation()}
                          >
                            <Plus className="w-4 h-4" strokeWidth={2} />
                          </button>
                        )}
                      </div>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
              <DirectorTableVirtualPad height={paddingBottom} colSpan={videoCols.length} />
            </tbody>
          </table>
          )}
        </DirectorShotTableVirtual>
        {storyboardsProg.ready === 0 ? (
          <p className={`shrink-0 text-amber-400/90`} style={{ fontSize: fsChrome }}>
            {tt.needStoryboardsFirst}
          </p>
        ) : null}
      </div>
    );
  };

  const colLabel = (key: DirectorShotColumnKey) => {
    const map: Record<DirectorShotColumnKey, string> = {
      场号: tt.colSceneNo,
      内外景: tt.colIntExt,
      日夜: tt.colDayNight,
      地点: tt.colLocation,
      出场人物: tt.colCastOn,
      镜号: tt.colShotNo,
      时长: tt.colDuration,
      画面描述: isDramaMode ? tt.colAction : tt.colDesc,
      镜头角度: isDramaMode ? tt.colAngleCamera : tt.colAngle,
      焦距: tt.colFocal,
      景别: tt.colShotSize,
      光影氛围: isDramaMode ? tt.colMood : tt.colLighting,
      对白旁白: isDramaMode ? tt.colDialogueSpeaker : tt.colDialogue,
      音效: tt.colSfx,
      运镜: tt.colCamera,
      制作备注: tt.colProdNotes,
      连贯性: tt.colContinuity,
      参考图绑定: tt.colRefBind,
      最终提示词: tt.colFinalPrompt,
    };
    return map[key];
  };

  const renderDramaAssetCard = (asset: DirectorAsset, kind: DirectorAssetKind) => {
    const emptyLabel =
      kind === 'character'
        ? tt.dramaGenerateOrUploadCharacter
        : kind === 'scene'
          ? tt.dramaGenerateOrUploadScene
          : kind === 'prop'
            ? tt.dramaGenerateOrUploadProp
            : tt.dramaGenerateOrUploadCreature;
    const menuOpen = sourceMenuAssetId === asset.id;
    const cardW = kind === 'character' || kind === 'creature' ? 'w-[14rem]' : 'w-[16rem]';
    const imageAspect = kind === 'character' || kind === 'creature' ? 'aspect-[3/4]' : 'aspect-[16/10]';
    return (
      <div
        key={asset.id}
        className={`nodrag shrink-0 ${cardW} flex flex-col rounded-xl overflow-hidden ring-1 ${
          isDarkMode ? 'bg-white/[0.04] ring-white/10' : 'bg-white ring-gray-200'
        }`}
      >
        <div
          className={`relative w-full ${imageAspect} flex items-center justify-center ${
            isDarkMode ? 'bg-zinc-950/70' : 'bg-gray-100'
          }`}
        >
          {asset.imageUrl ? (
            <button
              type="button"
              className="nodrag absolute inset-0 flex items-center justify-center p-1.5 cursor-zoom-in"
              title={tt.viewImage}
              onClick={() => setImagePreview({ url: asset.imageUrl!, name: asset.name || '' })}
            >
              <AssetLibLazyThumb
                src={asset.imageUrl}
                alt={asset.name}
                maxEdge={200}
                className="max-w-full max-h-full"
                imgClassName="max-w-full max-h-full object-contain pointer-events-none"
              />
            </button>
          ) : (
            <button
              type="button"
              className={`nodrag absolute inset-0 flex flex-col items-center justify-center gap-1 px-2 text-center ${mutedCls}`}
              style={{ fontSize: fsChrome }}
              disabled={asset.status === 'generating' || isDirectorHardBusy}
              onClick={() => generateOneAsset(asset)}
            >
              {emptyLabel}
            </button>
          )}
          {renderDirectorThumbProgress({
            visible: asset.status === 'generating' || !!imageGenProgressIds[asset.id],
            message: kind === 'scene' ? tt.generatingScene : tt.generating,
            borderRadius: 12,
          })}
          <div className="absolute top-1 right-1 z-[60]" ref={menuOpen ? sourceMenuRef : undefined}>
            <button
              type="button"
              className={`nodrag rounded-md p-1 ${
                isDarkMode ? 'bg-black/45 text-white/80 hover:bg-black/65' : 'bg-white/90 text-gray-700 hover:bg-white'
              }`}
              title={tt.sourceMenuTitle}
              onClick={(e) => {
                e.stopPropagation();
                setSourceMenuAssetId((cur) => (cur === asset.id ? null : asset.id));
              }}
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
            {menuOpen ? (
              <div
                className={`nodrag absolute top-[calc(100%+4px)] right-0 z-40 min-w-[8.5rem] overflow-hidden rounded-lg border py-1 shadow-xl ${
                  isDarkMode
                    ? 'bg-zinc-900 border-white/15 text-white/90'
                    : 'bg-white border-gray-200 text-gray-800'
                }`}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className={`nodrag flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                    isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                  }`}
                  disabled={asset.status === 'generating' || isDirectorHardBusy}
                  onClick={() => {
                    setSourceMenuAssetId(null);
                    generateOneAsset(asset);
                  }}
                >
                  {tt.generateThis}
                </button>
                <button
                  type="button"
                  className={`nodrag flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                    isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                  }`}
                  onClick={() => {
                    setSourceMenuAssetId(null);
                    onUploadClick(asset.id);
                  }}
                >
                  <Upload className="w-3.5 h-3.5 shrink-0 opacity-80" />
                  {tt.uploadLocal}
                </button>
                {data?.onPickImageFromCanvas ? (
                  <button
                    type="button"
                    className={`nodrag flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                      isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                    }`}
                    onClick={() => {
                      setSourceMenuAssetId(null);
                      void pickAssetFromCanvas(asset.id);
                    }}
                  >
                    <MousePointerClick className="w-3.5 h-3.5 shrink-0 opacity-80" />
                    {tt.pickFromCanvas}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`nodrag flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-rose-400 ${
                    isDarkMode ? 'hover:bg-white/10' : 'hover:bg-rose-50'
                  }`}
                  onClick={() => {
                    setSourceMenuAssetId(null);
                    imageGenQueueRef.current = imageGenQueueRef.current.filter((a) => a.id !== asset.id);
                    imageGenInFlightRef.current.delete(asset.id);
                    patch(removeDirectorAsset(directorStateRef.current, asset.id));
                  }}
                >
                  {tt.deleteAsset}
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="px-2.5 py-2 flex flex-col gap-1 min-h-[4rem]">
          <input
            className={`nodrag w-full bg-transparent font-semibold outline-none truncate ${titleCls}`}
            style={{ fontSize: fsSmall }}
            value={asset.name}
            onChange={(e) =>
              patch(updateDirectorAsset(directorStateRef.current, asset.id, { name: e.target.value }))
            }
          />
          <textarea
            className={`nodrag nowheel w-full min-h-[3rem] max-h-[5rem] resize-none bg-transparent leading-snug outline-none ${mutedCls} ${scrollCls}`}
            style={{ fontSize: Math.max(10, fsChrome - 1) }}
            value={asset.prompt}
            rows={3}
            title={tt.viewPrompt}
            onMouseEnter={(e) => {
              const p = String(asset.prompt || '').trim();
              if (p) openPromptHover(p, e, `${asset.name || tt.scenes} · ${tt.colFinalPrompt}`);
            }}
            onMouseLeave={scheduleClosePromptHover}
            onChange={(e) =>
              patch(updateDirectorAsset(directorStateRef.current, asset.id, { prompt: e.target.value }))
            }
          />
        </div>
      </div>
    );
  };

  /** 短剧准备资产：参考经典布局——全局风格 + 角色/场景/道具/生物同时展示（窗口/全屏共用） */
  const renderDramaAssetsPanel = () => {
    const sections = [
      ['characters', tt.characters, 'character', tt.generateAllCharacters] as const,
      ['scenes', tt.scenes, 'scene', tt.generateAllScenes] as const,
      ['props', tt.props, 'prop', tt.generateAllProps] as const,
      ['creatures', tt.creatures, 'creature', tt.generateAllCreatures] as const,
    ] as const;
    const missingAll = allAssets.filter((a) => !String(a.imageUrl || '').trim()).length;
    const tipQtyAll = Math.max(1, missingAll > 0 ? missingAll : allAssets.length || 1);
    return (
      <div className="flex flex-col flex-1 min-h-0 gap-3 overflow-hidden px-0.5">
        <div className="shrink-0 flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className={`text-[11px] font-medium ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>
              {tt.globalStyleLabel}
            </div>
            <div className="relative z-[50] flex items-center gap-2 flex-wrap justify-end overflow-visible">
              {renderImageGenControls({ compact: true, kind: 'character' })}
              <div
                className="relative overflow-visible"
                onMouseEnter={() => setPriceHoverKey('drama-all-gen')}
                onMouseLeave={() => setPriceHoverKey((k) => (k === 'drama-all-gen' ? null : k))}
              >
                {renderYuanbaoHoverTip('drama-all-gen', tipQtyAll)}
                <button
                  type="button"
                  className={`nodrag ${btnPrimary('!px-2.5 !py-1', 'motion')} disabled:opacity-50`}
                  style={{ fontSize: fsChrome }}
                  disabled={isDirectorHardBusy || allAssets.length === 0}
                  title={tt.oneClickGenerateAssets}
                  onClick={() =>
                    enqueueAssetImages(allAssets, {
                      onlyMissing: true,
                      maxParallel: IMAGE_GEN_MAX_PARALLEL_DEFAULT,
                    })
                  }
                >
                  {busyAction === 'images' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" />
                  ) : null}
                  {tt.oneClickGenerateAssets}
                </button>
              </div>
            </div>
          </div>
          <textarea
            className={`nodrag nowheel w-full min-h-[4.5rem] max-h-[7rem] resize-y rounded-lg border px-2.5 py-2 text-[12px] outline-none ${
              isDarkMode
                ? 'border-white/12 bg-black/35 text-white/90'
                : 'border-gray-300 bg-white text-gray-900'
            }`}
            value={String(state.globalStyle || '')}
            placeholder={tt.globalStylePlaceholder}
            onChange={(e) =>
              patch({
                ...directorStateRef.current,
                globalStyle: e.target.value,
                stylePresetId: 'custom',
              })
            }
          />
        </div>
        <div className={`nowheel flex-1 min-h-0 overflow-y-auto space-y-4 pr-0.5 ${scrollCls}`}>
          {sections.map(([key, label, kind, genLabel]) => {
            const list = state.assets[key] || [];
            const missingN = list.filter((a) => !String(a.imageUrl || '').trim()).length;
            const tipQty = Math.max(1, missingN > 0 ? missingN : list.length || 1);
            const tipKey = `drama-sec-${kind}`;
            return (
              <div key={key} className={sectionShell(kind)}>
                <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                  <div className={`font-semibold ${sectionTitleCls(kind)}`} style={{ fontSize: fsBody }}>
                    {label} ({list.length})
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                    <div
                      className="relative overflow-visible"
                      onMouseEnter={() => setPriceHoverKey(tipKey)}
                      onMouseLeave={() => setPriceHoverKey((k) => (k === tipKey ? null : k))}
                    >
                      {renderYuanbaoHoverTip(tipKey, tipQty)}
                      <button
                        type="button"
                        className={`nodrag ${btnPrimary('!px-2 !py-1 !h-auto', sectionScratch(kind))} disabled:opacity-40`}
                        style={{ fontSize: fsChrome }}
                        disabled={isDirectorHardBusy || list.length === 0}
                        title={genLabel}
                        onClick={() => generateCategory(kind)}
                      >
                        {genLabel}
                      </button>
                    </div>
                  </div>
                </div>
                <div className={`flex items-stretch gap-3 overflow-x-auto pb-1.5 ${scrollCls}`}>
                  {list.map((asset) => renderDramaAssetCard(asset, kind))}
                  <button
                    type="button"
                    className={`nodrag shrink-0 ${
                      kind === 'character' || kind === 'creature'
                        ? 'w-[14rem] min-h-[16rem]'
                        : 'w-[16rem] min-h-[12rem]'
                    } rounded-xl border border-dashed flex flex-col items-center justify-center gap-1.5 transition-colors ${
                      isDarkMode
                        ? 'border-white/20 text-white/45 hover:border-white/40 hover:text-white/70 hover:bg-white/[0.04]'
                        : 'border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700 hover:bg-gray-50'
                    }`}
                    style={{ fontSize: fsChrome }}
                    onClick={() => addAsset(kind)}
                  >
                    <Plus className="w-5 h-5" />
                    {tt.dramaAddNew}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderAssetCard = (
    asset: DirectorAsset,
    kind: DirectorAssetKind,
    opts?: { castPick?: boolean },
  ) => {
    const compact = !!opts?.castPick;
    const cardMinH = compact ? 108 : 168;
    return (
    <div
      key={asset.id}
      className={`min-w-0 grid ${
        compact
          ? 'grid-cols-[minmax(0,1fr)_88px]'
          : 'grid-cols-[minmax(0,1.15fr)_minmax(140px,0.85fr)]'
      } ${cardCls}`}
      style={{ minHeight: cardMinH }}
    >
      {/* 左：提示词 */}
      <div
        className={`min-w-0 ${compact ? 'px-2 py-1.5 gap-1' : 'px-2.5 py-2.5 gap-1.5'} flex flex-col border-r ${
          isDarkMode ? 'border-white/[0.06]' : 'border-gray-200/80'
        }`}
      >
        <div className="flex items-start gap-1 shrink-0">
          <input
            className={`nodrag w-full min-w-0 bg-transparent font-semibold outline-none ${titleCls}`}
            style={{ fontSize: compact ? fsSmall : fsBody }}
            value={asset.name}
            onChange={(e) =>
              patch(updateDirectorAsset(directorStateRef.current, asset.id, { name: e.target.value }))
            }
          />
          <button
            type="button"
            className={`nodrag shrink-0 p-0.5 rounded transition-colors ${
              isDarkMode
                ? 'text-white/35 hover:text-rose-300 hover:bg-white/10'
                : 'text-gray-400 hover:text-rose-600 hover:bg-rose-50'
            }`}
            title={tt.deleteAsset}
            aria-label={tt.deleteAsset}
            onClick={(e) => {
              e.stopPropagation();
              setSourceMenuAssetId((cur) => (cur === asset.id ? null : cur));
              imageGenQueueRef.current = imageGenQueueRef.current.filter((a) => a.id !== asset.id);
              imageGenInFlightRef.current.delete(asset.id);
              patch(removeDirectorAsset(directorStateRef.current, asset.id));
            }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <textarea
          className={`nodrag nowheel w-full flex-1 ${
            compact ? 'min-h-[52px]' : 'min-h-[120px]'
          } resize-none bg-transparent leading-relaxed outline-none ${mutedCls} ${scrollCls}`}
          style={{ fontSize: compact ? fsChrome : fsSmall }}
          value={asset.prompt}
          title={tt.viewPrompt}
          onMouseEnter={(e) => {
            const p = String(asset.prompt || '').trim();
            if (p) {
              openPromptHover(
                p,
                e,
                `${asset.name || (kind === 'scene' ? tt.scenes : tt.characters)} · ${tt.colFinalPrompt}`,
              );
            }
          }}
          onMouseLeave={scheduleClosePromptHover}
          onChange={(e) =>
            patch(updateDirectorAsset(directorStateRef.current, asset.id, { prompt: e.target.value }))
          }
        />
        {kind === 'character' && !compact ? (
          <div
            className={`shrink-0 leading-snug ${isDarkMode ? 'text-white/35' : 'text-gray-400'}`}
            style={{ fontSize: Math.max(10, fsChrome - 1) }}
            title={tt.characterLinkedHint}
          >
            {tt.characterLinkedHint}
          </div>
        ) : null}
        {kind === 'scene' ? (
          <div
            className={`shrink-0 leading-snug ${isDarkMode ? 'text-white/35' : 'text-gray-400'}`}
            style={{ fontSize: Math.max(10, fsChrome - 1) }}
            title={tt.sceneLinkedHint}
          >
            {tt.sceneLinkedHint}
          </div>
        ) : null}
      </div>
      {/* 右：照片 */}
      <div
        className={`relative min-w-0 overflow-hidden flex items-center justify-center ${
          isDarkMode ? 'bg-zinc-950/50' : 'bg-gradient-to-b from-gray-100 to-gray-200'
        }`}
        style={{ minHeight: cardMinH }}
      >
        {asset.imageUrl ? (
          <button
            type="button"
            className="nodrag relative z-0 w-full h-full flex items-center justify-center cursor-zoom-in p-2"
            title={tt.viewImage}
            onClick={() => setImagePreview({ url: asset.imageUrl!, name: asset.name || '' })}
          >
            <AssetLibLazyThumb
              src={asset.imageUrl}
              alt={asset.name}
              maxEdge={compact ? 160 : 280}
              className="max-w-full max-h-full"
              imgClassName="max-w-full max-h-full w-auto h-auto object-contain pointer-events-none"
            />
          </button>
        ) : (
          <div className={`px-3 text-center leading-relaxed ${mutedCls}`} style={{ fontSize: fsChrome }}>
            {opts?.castPick ? tt.castGenerateOrCanvas : tt.generateOrUpload}
            {!opts?.castPick ? <div className="mt-1 opacity-80">{tt.sourceMenuTitle}</div> : null}
          </div>
        )}
        {renderDirectorThumbProgress({
          visible: asset.status === 'generating' || !!imageGenProgressIds[asset.id],
          message: kind === 'scene' ? tt.generatingScene : tt.generating,
          borderRadius: 8,
        })}
        <div className="absolute bottom-1.5 right-1.5 z-[60] flex items-end gap-1 max-w-[96%] flex-wrap justify-end overflow-visible">
          {renderImageGenControls({ compact: true, kind })}
          <div
            className="relative overflow-visible"
            onMouseEnter={() => setPriceHoverKey(`card-${asset.id}`)}
            onMouseLeave={() => setPriceHoverKey((k) => (k === `card-${asset.id}` ? null : k))}
          >
            {renderYuanbaoHoverTip(`card-${asset.id}`, 1)}
            <button
              type="button"
              className={`nodrag ${btnPrimary('!px-2.5 !py-0.5 !h-auto !min-h-0', sectionScratch(kind))} disabled:opacity-50`}
              style={{ fontSize: fsChrome }}
              title={tt.generateThis}
              disabled={asset.status === 'generating' || isDirectorHardBusy}
              onClick={(e) => {
                e.stopPropagation();
                setSourceMenuAssetId(null);
                if (opts?.castPick) setCastArtworkPickAssetId(asset.id);
                generateOneAsset(asset);
              }}
            >
              {tt.generateThis}
            </button>
          </div>

          <div className="relative" ref={sourceMenuAssetId === asset.id ? sourceMenuRef : undefined}>
            <button
              type="button"
              className={`nodrag ${btnSecondary('!p-1.5 !min-w-0 !h-auto', 'looks')} ${
                sourceMenuAssetId === asset.id
                  ? isDarkMode
                    ? '!bg-white/15'
                    : '!bg-gray-200'
                  : ''
              }`}
              title={tt.sourceMenuTitle}
              aria-expanded={sourceMenuAssetId === asset.id}
              onClick={(e) => {
                e.stopPropagation();
                setSourceMenuAssetId((cur) => (cur === asset.id ? null : asset.id));
              }}
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            {sourceMenuAssetId === asset.id ? (
              <div
                className={`nodrag absolute bottom-[calc(100%+4px)] right-0 z-40 min-w-[9.5rem] overflow-hidden rounded-lg border py-1 shadow-xl ${
                  isDarkMode ? 'bg-zinc-900 border-white/15 text-white/90' : 'bg-gray-100 border-gray-200 text-gray-800'
                }`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className={`nodrag flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                    isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                  }`}
                  onClick={() => {
                    setSourceMenuAssetId(null);
                    onUploadClick(asset.id);
                  }}
                >
                  <Upload className="w-3.5 h-3.5 shrink-0 opacity-80" />
                  {tt.uploadLocal}
                </button>
                {data?.onPickImageFromCanvas ? (
                  <button
                    type="button"
                    className={`nodrag flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                      isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                    }`}
                    onClick={() => {
                      setSourceMenuAssetId(null);
                      void pickAssetFromCanvas(asset.id);
                    }}
                  >
                    <MousePointerClick className="w-3.5 h-3.5 shrink-0 opacity-80" />
                    {tt.pickFromCanvas}
                  </button>
                ) : null}
                {kind === 'character' ? (
                  <button
                    type="button"
                    className={`nodrag flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                      isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                    }`}
                    onClick={() => {
                      setSourceMenuAssetId(null);
                      void openLibraryPick(asset.id, 'character');
                    }}
                  >
                    <Library className="w-3.5 h-3.5 shrink-0 opacity-80" />
                    {tt.pickFromCharacterLibrary}
                  </button>
                ) : null}
                {kind === 'scene' ? (
                  <button
                    type="button"
                    className={`nodrag flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                      isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                    }`}
                    onClick={() => {
                      setSourceMenuAssetId(null);
                      void openLibraryPick(asset.id, 'scene');
                    }}
                  >
                    <Library className="w-3.5 h-3.5 shrink-0 opacity-80" />
                    {tt.pickFromSceneLibrary}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
    );
  };

  const primaryFooter = () => {
    // 底部只保留「下一步」主操作；回退请用顶部步骤条切换
    // 短剧：剧本解析 → 分镜导演 → 生成视频
    if (isDramaMode) {
      if (state.phase === 'story') {
        return null;
      }
      const dramaUserPhase = domainPhaseToUserPhase(
        (data?.directorDomain as DramaDirectorSession | null)?.meta.phase || state.phase,
      );
      const dramaShotCount =
        ((data?.directorDomain as DramaDirectorSession | null)?.shots || []).length ||
        state.shots.length;
      if (dramaUserPhase === 'assets' || state.phase === 'assets') {
        return (
          <div className="flex flex-col items-stretch gap-2 w-full max-w-[52rem]">
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <button
                type="button"
                className={`nodrag ${btnPrimary('', 'motion')} disabled:opacity-50`}
                style={{ fontSize: fsChrome }}
                disabled={!!busyAction || dramaShotCount === 0}
                onClick={() => goDirectorPhase('videos')}
              >
                {tt.dramaNextVideos}
              </button>
            </div>
          </div>
        );
      }
      if (state.phase === 'videos') {
        return (
          <div className="flex flex-col items-center gap-1.5 w-full">
            {renderVideoBatchOptions()}
            <div className="flex items-center gap-2 flex-wrap justify-center">
              <button
                type="button"
                className={`nodrag ${btnPrimary('', 'motion')} disabled:opacity-50`}
                style={{ fontSize: fsSmall }}
                disabled={state.shots.length === 0 || !!busyAction}
                onClick={() => void handleSpawnVideosClick()}
              >
                {tt.batchGenerateVideosToolbar}
              </button>
            </div>
          </div>
        );
      }
      return null;
    }
    if (isMvMode) {
      if (state.phase === 'music') {
        const { current } = mvMusicGuide;
        if (current === 'upload') {
          return (
            <button
              type="button"
              className={`nodrag ${btnPrimary('', 'sound')} disabled:opacity-50`}
              style={{ fontSize: fsChrome }}
              onClick={() => musicAudioInputRef.current?.click()}
            >
              {tt.guideMusicCtaUpload}
            </button>
          );
        }
        // 分析入口在右侧中间；底部「下一步：写剧本」
        return (
          <button
            type="button"
            className={`nodrag ${btnPrimary('', 'sound')} disabled:opacity-50`}
            style={{ fontSize: fsChrome }}
            onClick={() => goMvStoryPhase()}
          >
            {tt.nextStory}
          </button>
        );
      }
      if (state.phase === 'story') {
        return (
          <button
            type="button"
            className={`nodrag ${btnPrimary('', 'motion')} disabled:opacity-50`}
            style={{ fontSize: fsSmall }}
            onClick={() => goMvStylePhase()}
          >
            {tt.nextStyle}
          </button>
        );
      }
      if (state.phase === 'style') {
        return (
          <button
            type="button"
            className={`nodrag ${btnPrimary('', 'motion')} disabled:opacity-50`}
            style={{ fontSize: fsSmall }}
            onClick={() => goMvCastPhase()}
          >
            {tt.nextCast}
          </button>
        );
      }
      if (state.phase === 'cast') {
        return (
          <button
            type="button"
            className={`nodrag ${btnPrimary('', 'operators')} disabled:opacity-50`}
            style={{ fontSize: fsSmall }}
            onClick={() => goMvScenesPhase()}
          >
            {tt.nextMvScenes}
          </button>
        );
      }
      if (state.phase === 'videos') {
        const hasReadyVideos = (state.shots || []).some((s, i) => {
          const no = String(s['镜号'] || i + 1);
          const sb = getDirectorShotStoryboard(state, no);
          return !!String(sb.videoUrl || '').trim() || sb.videoStatus === 'ready';
        });
        return (
          <div className="flex items-center gap-2 flex-wrap justify-center">
            {renderPreviewToSpliceButton({ fontSize: fsSmall, mode: 'videos', hasReadyVideos })}
            <button
              type="button"
              className={`nodrag ${btnPrimary('', 'sound')} disabled:opacity-50`}
              style={{ fontSize: fsSmall }}
              onClick={() => {
                void goMvKaraokePhase();
              }}
            >
              {tt.nextKaraoke}
            </button>
          </div>
        );
      }
      if (state.phase === 'karaoke') {
        const busyAny = karaokeEditorBusy !== 'idle';
        const asrLabel = formatFileTranscribeYuanbaoLabel();
        return (
          <div className="flex items-center gap-2 flex-wrap justify-center">
            {karaokeEditorBusy === 'burn' ? (
              <button
                type="button"
                className={`nodrag ${btnSecondary('', 'sound')} disabled:opacity-50`}
                style={{ fontSize: fsSmall }}
                onClick={() => karaokeEditorActionsRef.current?.cancel()}
                title={ktt.closeCancelsBurn}
              >
                {ktt.cancel}
              </button>
            ) : null}
            <div
              className="relative z-[40] overflow-visible"
              onMouseEnter={() => !busyAny && setPriceHoverKey('footer-karaoke-timing')}
              onMouseLeave={() =>
                setPriceHoverKey((k) => (k === 'footer-karaoke-timing' ? null : k))
              }
            >
              {!busyAny && priceHoverKey === 'footer-karaoke-timing' ? (
                <span
                  className={`${yuanbaoHoverTipCls} translate-y-0 opacity-100`}
                  title={ktt.generateTimingPriceTitle}
                >
                  {asrLabel}
                </span>
              ) : null}
              <button
                type="button"
                className={nexflowOrangePillBtnClass}
                style={{ fontSize: fsSmall, background: nexflowOrangePillBtnBg }}
                disabled={busyAny || !karaokeSeed}
                onClick={() => karaokeEditorActionsRef.current?.generateTiming()}
                title={
                  karaokeEditorBusy === 'timing' || karaokeEditorBusy === 'asr'
                    ? undefined
                    : ktt.generateTiming
                }
              >
                {karaokeEditorBusy === 'timing' || karaokeEditorBusy === 'asr' ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {ktt.generating}
                  </span>
                ) : (
                  ktt.generateTiming
                )}
              </button>
            </div>
            <button
              type="button"
              className={`nodrag ${btnPrimary('', 'sound')} disabled:opacity-50`}
              style={{ fontSize: fsSmall }}
              disabled={busyAny || !karaokeSeed}
              onClick={() => karaokeEditorActionsRef.current?.burn()}
            >
              {karaokeEditorBusy === 'burn' ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {ktt.burning}
                </span>
              ) : (
                ktt.burnToNode
              )}
            </button>
          </div>
        );
      }
    }
    if (state.phase === 'shots') {
      if (isMvMode) {
        return (
          <div className="flex items-center gap-2 flex-wrap justify-center">
            {renderPreviewToSpliceButton({ fontSize: fsSmall })}
            <button
              type="button"
              className={`nodrag ${btnPrimary('', 'motion')} disabled:opacity-50`}
              style={{ fontSize: fsSmall }}
              disabled={state.shots.length === 0 || !!busyAction}
              title={state.shots.length === 0 ? tt.needShotsFirst : undefined}
              onClick={() => patch(setDirectorPhase(state, 'videos'))}
            >
              {tt.nextVideos}
            </button>
          </div>
        );
      }
      return (
        <button
          type="button"
          className={`nodrag ${btnPrimary('', 'motion')} disabled:opacity-50`}
          style={{ fontSize: fsSmall }}
          disabled={state.shots.length === 0 || !!busyAction}
          title={state.shots.length === 0 ? tt.needShotsFirst : undefined}
          onClick={() => void handleExtractAssets()}
        >
          {busyAction === 'assets' ? <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" /> : null}
          {isDramaMode ? tt.nextPrepareAssets : tt.step2PrepareAssets}
        </button>
      );
    }
    if (state.phase === 'assets') {
      const step: DirectorAssetsStep =
        state.assetsStep === 'scenes' || state.assetsStep === 'props'
          ? state.assetsStep
          : isMvMode
            ? 'scenes'
            : 'characters';
      const stepKey = step === 'characters' ? 'characters' : step === 'scenes' ? 'scenes' : 'props';
      const stepKind: DirectorAssetKind =
        step === 'characters' ? 'character' : step === 'scenes' ? 'scene' : 'prop';
      const stepList = state.assets[stepKey] || [];
      const stepMissing = stepList.filter((a) => !String(a.imageUrl || '').trim()).length;
      const stepReady = stepList.length === 0 || stepMissing === 0;
      const genLabel =
        step === 'characters'
          ? tt.generateCharactersBatch
          : step === 'scenes'
            ? tt.generateScenesBatch
            : tt.generatePropsBatch;

      // MV 场景配置：底部主按钮始终是「下一步：分镜生成」，一键生图只在顶栏
      const mvScenesAdvance = isMvMode && step === 'scenes';

      let primaryAction: React.ReactNode = null;
      if (step === 'props' && stepReady) {
        primaryAction = (
          <button
            type="button"
            className={`nodrag ${btnPrimary('', 'operators')} disabled:opacity-50`}
            style={{ fontSize: fsSmall }}
            disabled={!!busyAction || missing.total > 0 || allAssets.length === 0}
            title={
              missing.total > 0
                ? fillDirectorI18n(tt.missingAssetsHint, {
                    c: missing.characters,
                    s: missing.scenes,
                    p: missing.props,
                  })
                : tt.step3ComposePrompts
            }
            onClick={() => void handleComposePrompts()}
          >
            {busyAction === 'prompts' ? <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" /> : null}
            {tt.step3ComposePrompts}
          </button>
        );
      } else if (stepReady || mvScenesAdvance) {
        primaryAction = (
          <button
            type="button"
            className={`nodrag ${btnPrimary('', 'motion')} disabled:opacity-50`}
            style={{ fontSize: fsSmall }}
            disabled={!!busyAction}
            onClick={() => {
              if (isMvMode && step === 'scenes') {
                let next = setDirectorPhase(state, 'shots');
                if ((next.mvMusic?.lyricSegments || []).length > 0) {
                  next = syncDirectorShotsToLyricTimeline(next);
                }
                patch(next);
                return;
              }
              patch(
                setDirectorAssetsStep(
                  state,
                  step === 'characters' ? 'scenes' : 'props',
                ),
              );
            }}
          >
            {isMvMode && step === 'scenes'
              ? tt.nextShots
              : step === 'characters'
                ? tt.nextGenerateScenes
                : tt.nextGenerateProps}
          </button>
        );
      } else {
        primaryAction = (
          <div
            className="relative"
            onMouseEnter={() => stepMissing > 0 && setPriceHoverKey('footer-step')}
            onMouseLeave={() => setPriceHoverKey((k) => (k === 'footer-step' ? null : k))}
          >
            {stepMissing > 0 ? renderYuanbaoHoverTip('footer-step', stepMissing) : null}
            <button
              type="button"
              className={`nodrag inline-flex items-center gap-1.5 ${btnPrimary('', 'events')} disabled:opacity-50`}
              style={{ fontSize: fsSmall }}
              disabled={isDirectorHardBusy || stepList.length === 0}
              title={genLabel}
              onClick={() => generateCategory(stepKind)}
            >
              {busyAction === 'images' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {genLabel}
              {stepMissing > 0 && formatYuanbaoLabel(stepMissing)
                ? ` · ${formatYuanbaoLabel(stepMissing)}`
                : ''}
            </button>
          </div>
        );
      }

      return primaryAction;
    }
    if (state.phase === 'prompts') {
      if (isMvMode) return null;
      return (
        <div className="flex items-center gap-2 flex-wrap justify-center">
          <button
            type="button"
            className={`nodrag ${btnSecondary('', 'sound')} disabled:opacity-50`}
            style={{ fontSize: fsSmall }}
            disabled={!!busyAction}
            onClick={() => void handleComposePrompts()}
          >
            {tt.oneClickComposePrompts}
          </button>
          <button
            type="button"
            className={`nodrag ${btnPrimary('', 'motion')} disabled:opacity-50`}
            style={{ fontSize: fsSmall }}
            disabled={promptsProg.ready === 0}
            onClick={() => {
              const local = rebindDirectorPipelineAssetRefs(directorStateRef.current);
              const base = local.changed
                ? { ...directorStateRef.current, shots: local.shots }
                : directorStateRef.current;
              patch(setDirectorPhase(base, 'storyboards'));
            }}
          >
            {tt.nextGenerateStoryboards}
          </button>
        </div>
      );
    }
    // storyboards（Script）；MV 已并入 shots
    if (isMvMode) return null;
    return (
      <div className="flex flex-col items-center gap-1.5 w-full">
        {renderVideoBatchOptions()}
        {renderLipsyncHint()}
        <div className="flex items-center gap-2 flex-wrap justify-center">
          <span
            className="relative inline-flex overflow-visible"
            onMouseEnter={() => setPriceHoverKey('script-batch-sb')}
            onMouseLeave={() =>
              setPriceHoverKey((k) => (k === 'script-batch-sb' ? null : k))
            }
          >
            {renderBatchStoryboardYuanbaoHoverTip(
              'script-batch-sb',
              Math.max(
                1,
                storyboardsProg.missing > 0
                  ? storyboardsProg.missing
                  : storyboardsProg.total || state.shots.length,
              ),
            )}
            <button
              type="button"
              className={`nodrag ${btnSecondary('', 'events')} disabled:opacity-50`}
              style={{ fontSize: fsSmall }}
              disabled={isDirectorHardBusy || promptsProg.ready === 0}
              title={tt.oneClickGenerateStoryboards}
              onClick={() => startBatchStoryboards()}
            >
              {busyAction === 'storyboards' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" />
              ) : null}
              {tt.oneClickGenerateStoryboards}
            </button>
          </span>
          <span className="relative inline-flex">
            <button
              type="button"
              className={`nodrag ${btnPrimary('', 'motion')} disabled:opacity-50`}
              style={{ fontSize: fsSmall }}
              disabled={storyboardsProg.ready === 0 || !!busyAction}
              onMouseEnter={() => setPriceHoverKey('script-batch-videos')}
              onMouseLeave={() =>
                setPriceHoverKey((k) => (k === 'script-batch-videos' ? null : k))
              }
              onClick={() => void handleSpawnVideosClick()}
            >
              {tt.step5SpawnVideos}
            </button>
            {renderBatchVideoYuanbaoHoverTip('script-batch-videos')}
          </span>
        </div>
      </div>
    );
  };

  const hangToolbarButtons = (
    <>
      <button
        type="button"
        onClick={() => adjustFontSize(-2)}
        disabled={fontSizePx <= DIRECTOR_FONT_MIN}
        className={floatToolBtn('control', false, fontSizePx <= DIRECTOR_FONT_MIN ? '!opacity-40' : '')}
        title={wc.fontZoomOutTitle}
      >
        <ZoomOut className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => adjustFontSize(2)}
        disabled={fontSizePx >= DIRECTOR_FONT_MAX}
        className={floatToolBtn('operators', false, fontSizePx >= DIRECTOR_FONT_MAX ? '!opacity-40' : '')}
        title={wc.fontZoomInTitle}
      >
        <ZoomIn className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={toggleNodeFullscreen}
        className={floatToolBtn('motion', isNodeFullscreen)}
        title={wc.fullscreenTitle}
      >
        {isNodeFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
      </button>
    </>
  );

  const hangFontToolbar = (
    <div
      className="director-node-chrome director-floating-toolbar nodrag nopan absolute z-[55] pointer-events-auto flex items-center gap-1.5"
      style={{
        bottom: 'calc(100% + 8px)',
        left: '50%',
        transform: 'translateX(-50%) scale(var(--rf-zoom-inv, 1))',
        transformOrigin: 'bottom center',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {hangToolbarButtons}
    </div>
  );

  const renderShotsGenerateBar = () => (
    <div className="flex items-center gap-2 pt-2 shrink-0 flex-wrap">
      <button
        type="button"
        className={`nodrag flex items-center gap-1 shrink-0 ${
          isDarkMode ? 'text-white/55 hover:text-white' : 'text-gray-700 hover:text-gray-900'
        }`}
        style={{ fontSize: fsSmall }}
        onClick={() => {
          const next = addDirectorShot(directorStateRef.current);
          patch(next);
          focusShotTableRow(next.shots.length - 1);
        }}
      >
        {tt.addShot}
      </button>
    </div>
  );

  const primaryFooterNode = primaryFooter();
  const hangPrimary = primaryFooterNode ? (
    <div
      className="director-node-chrome director-primary-footer nodrag nopan absolute z-[55] pointer-events-auto flex items-center justify-center gap-2"
      style={{
        top: 'calc(100% + 10px)',
        left: '50%',
        // 跟随画布缩放：勿用 zoomInv 反缩放（否则缩小时字反而变大）
        transform: 'translateX(-50%)',
        transformOrigin: 'top center',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {primaryFooterNode}
    </div>
  ) : null;

  return (
    <div
      ref={nodeRef}
      className={`custom-node-container nexflow-director-node group relative overflow-visible rounded-2xl flex flex-col ${
        isDarkMode ? 'nexflow-glass-panel' : 'apple-panel-light'
      } ${karaokePanelActive ? 'nexflow-director--karaoke-solid' : ''} ${
        selected
          ? isDarkMode
            ? 'ring-2 ring-green-400/80'
            : 'ring-2 ring-green-500'
          : ''
      }`}
      style={{
        width: sizeW,
        height: sizeH,
        transition: isResizing ? 'none' : undefined,
        fontSize: fsBody,
        // 全屏时背后节点壳仍占大合成层：隐藏以减轻 GPU
        visibility: isNodeFullscreen ? 'hidden' : undefined,
        pointerEvents: isNodeFullscreen ? 'none' : undefined,
      }}
    >
      {!isNodeFullscreen && hangFontToolbar}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        style={{ top: '50%', left: 0 }}
        className="nexflow-plus-handle nexflow-plus-handle-left"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        style={{ top: '50%', right: 0 }}
        className="nexflow-plus-handle nexflow-plus-handle-right"
      />

      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] || null;
          e.target.value = '';
          void onUploadFile(f);
        }}
      />
      <input
        ref={styleRefUploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] || null;
          e.target.value = '';
          void onUploadStyleRefFile(f);
        }}
      />
      <input
        ref={sbUploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] || null;
          e.target.value = '';
          void onUploadStoryboardFile(f);
        }}
      />
      <input
        ref={videoUploadInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] || null;
          e.target.value = '';
          void onUploadShotVideoFile(f);
        }}
      />
      <input
        ref={musicAudioInputRef}
        type="file"
        accept="audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] || null;
          e.target.value = '';
          void onUploadMvAudioFile(f);
        }}
      />

      {!isNodeFullscreen && (
      <>
      <div className="flex items-center justify-between gap-2 px-3 py-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Clapperboard className={`w-5 h-5 shrink-0 ${accentSpin}`} />
          <span className={`font-semibold truncate ${titleCls}`} style={{ fontSize: fsBody }}>
            {dramaHeaderTitle || state.title || tt.directorTitle}
          </span>
          {renderModeToggle()}
          {!isWizardMode ? renderScriptChip() : null}
          {(busyAction || state.isGenerating || data?.isGenerating) && (
            <Loader2 className={`w-4 h-4 animate-spin ${accentSpin}`} />
          )}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {isDramaMode ? (
            state.phase === 'story' ? (
                <>
                  {renderChatModelSelect({ variant: 'plain', menuPlacement: 'down' })}
                  <button
                    type="button"
                    className={`nodrag ${btnSecondary('!px-2 !py-1', 'operators')} disabled:opacity-50`}
                    style={{ fontSize: fsChrome }}
                    disabled={
                      busyAction === 'story-script'
                        ? false
                        : !!busyAction ||
                          !String(state.mvScriptReference || state.scriptText || '').trim()
                    }
                    title={
                      busyAction === 'story-script' ? tt.storyCancelChatHint : tt.dramaAnalyzeBtn
                    }
                    onClick={() => {
                      if (busyAction === 'story-script') {
                        cancelDirectorChat('user');
                        return;
                      }
                      void handleDramaStoryOneShot();
                    }}
                  >
                    {busyAction === 'story-script' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5 inline mr-1 opacity-80" />
                    )}
                    {busyAction === 'story-script' ? tt.musicJobCancel : tt.dramaAnalyzeBtn}
                  </button>
                  {state.shots.length > 0 ? (
                    <button
                      type="button"
                      className={`nodrag ${btnSecondary('!px-2 !py-1', 'motion')} disabled:opacity-50`}
                      style={{ fontSize: fsChrome }}
                      onClick={() => goDirectorPhase('assets')}
                    >
                      {tt.dramaNextAssets}
                    </button>
                  ) : null}
                </>
            ) : null
          ) : !isMvMode ? (
            <span className={mutedCls} style={{ fontSize: fsChrome }}>
              {tt.afterPartialHint}
            </span>
          ) : null}
        </div>
      </div>

      <div
        ref={
          isMvMode && (state.phase === 'shots' || state.phase === 'videos')
            ? shotsLayoutRef
            : isMvMode && state.phase === 'music'
              ? musicLayoutRef
              : isMvMode && state.phase === 'story'
                ? storyLayoutRef
                : undefined
        }
        className={`px-3 pb-2 flex flex-col gap-2 flex-1 min-h-0 ${
          isMvMode
            ? state.phase === 'music' ||
                state.phase === 'style' ||
                state.phase === 'cast' ||
                state.phase === 'shots' ||
                state.phase === 'videos' ||
                state.phase === 'karaoke'
              ? 'overflow-hidden'
              : 'overflow-y-auto nowheel custom-scrollbar-dark'
            : 'overflow-hidden'
        }`}
      >
        <div className="director-keep-visible shrink-0">
          {renderPhaseButtons()}
        </div>

        {(data?.error || state.error) && (
          <div className="text-[11px] text-rose-400 px-1 shrink-0">{data?.error || state.error}</div>
        )}

        {isMvMode && state.phase === 'music' ? (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">{renderMvMusicPanel()}</div>
        ) : null}
        {isMvMode && state.phase === 'style' && (
          <div className="flex flex-col flex-1 min-h-0 gap-2 overflow-hidden">
            {renderStylePicker()}
          </div>
        )}
        {isMvMode && state.phase === 'story' && (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">{renderMvStoryPanel()}</div>
        )}
        {isDramaMode && !isNodeFullscreen ? (
          <div className="director-keep-visible mb-1 flex flex-1 min-h-0 flex-col overflow-hidden">
            {renderDramaStudioV2()}
          </div>
        ) : null}
        {isMvMode && state.phase === 'cast' && (
          <div className="flex flex-col flex-1 min-h-0 overflow-visible">{renderMvCastPanel()}</div>
        )}
        {videosPanelActive ? (
          <div
            ref={setVideosPanelHost}
            className="flex-1 min-h-0 flex flex-col"
          >
            {renderMvVideosPanel({ panelActive: true })}
          </div>
        ) : null}

        {karaokePanelActive && !isNodeFullscreen ? (
          <div className="flex flex-col flex-1 min-h-0 h-full overflow-hidden">
            {renderMvKaraokePanel()}
          </div>
        ) : null}

        {shotsPanelActive
          ? renderShotsConfirmPanel({
              className: 'flex flex-col flex-1 min-h-0 gap-1',
            })
          : null}


        {state.phase === 'assets' && !isDramaMode ? (
          <div className="flex flex-col flex-1 min-h-0 gap-3">
            <div className="flex items-center justify-between gap-2 shrink-0 w-full min-w-0">
              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                {(
                  [
                    ['characters', tt.assetsStepCharacters] as const,
                    ['scenes', tt.assetsStepScenes] as const,
                    ['props', tt.assetsStepProps] as const,
                  ] as const
                )
                  .filter(([stepId]) => {
                    if (!isWizardMode) return true;
                    // MV：角色在选角完成；不生成道具，只做场景图
                    return stepId === 'scenes';
                  })
                  .map(([stepId, label]) => {
                  const active =
                    (state.assetsStep || 'characters') === stepId ||
                    (!state.assetsStep && stepId === 'characters') ||
                    (isWizardMode && stepId === 'scenes');
                  return (
                    <button
                      key={stepId}
                      type="button"
                      className={`nodrag rounded-full px-2.5 py-1 font-medium transition-colors ${
                        active
                          ? isDarkMode
                            ? 'bg-sky-500/25 text-sky-100 ring-1 ring-sky-400/40'
                            : 'bg-gray-200 text-gray-800 ring-1 ring-gray-400/70'
                          : isDarkMode
                            ? 'text-white/45 hover:bg-white/[0.06]'
                            : 'text-gray-500 hover:bg-gray-100'
                      }`}
                      style={{ fontSize: fsChrome }}
                      onClick={() => patch(setDirectorAssetsStep(state, stepId))}
                    >
                      {isWizardMode && stepId === 'scenes' ? tt.phaseMvScenes : label}
                    </button>
                  );
                })}
                {isWizardMode ? (
                  <button
                    type="button"
                    className={`nodrag ${btnSecondary('!px-2.5 !py-1', 'motion')}`}
                    style={{ fontSize: fsChrome }}
                    title={tt.scenesSyncFromScript}
                    onClick={(e) => {
                      e.stopPropagation();
                      syncMvScenesFromScript('replace');
                    }}
                  >
                    {tt.scenesSyncFromScript}
                  </button>
                ) : null}
              </div>
                {isWizardMode ? (
                <div className="shrink-0 relative z-[50] overflow-visible flex items-center justify-end">
                  {renderSceneOneClickGenerate()}
                </div>
              ) : null}
            </div>
            <div className={`nowheel flex-1 min-h-0 overflow-y-auto space-y-4 pr-0.5 ${scrollCls}`}>
              {(() => {
                const step: DirectorAssetsStep =
                  state.assetsStep === 'scenes' || state.assetsStep === 'props'
                    ? state.assetsStep
                    : isWizardMode
                      ? 'scenes'
                      : 'characters';
                const sections = (
                  [
                    ['characters', tt.characters, 'character'] as const,
                    ['scenes', tt.scenes, 'scene'] as const,
                    ['props', tt.props, 'prop'] as const,
                  ] as const
                ).filter(([key]) => key === step);
                return sections.map(([key, label, kind]) => (
                <div key={key} className={sectionShell(kind)}>
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <div className={`font-semibold ${sectionTitleCls(kind)}`} style={{ fontSize: fsBody }}>
                        {label} ({state.assets[key].length})
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                      {kind === 'character' ? renderImageGenControls({ kind: 'character' }) : null}
                      {!(isMvMode && kind === 'scene')
                        ? (() => {
                            const missingN = state.assets[key].filter(
                              (a) => !String(a.imageUrl || '').trim(),
                            ).length;
                            const tipQty = Math.max(1, missingN > 0 ? missingN : state.assets[key].length);
                            const tipKey = `cat-${kind}`;
                            return (
                              <div className="flex flex-col items-end gap-1">
                                <div
                                  className="relative overflow-visible"
                                  onMouseEnter={() => setPriceHoverKey(tipKey)}
                                  onMouseLeave={() =>
                                    setPriceHoverKey((k) => (k === tipKey ? null : k))
                                  }
                                >
                                  {renderYuanbaoHoverTip(tipKey, tipQty)}
                                  <button
                                    type="button"
                                    className={`nodrag ${btnPrimary('!px-2 !py-1 !h-auto', sectionScratch(kind))} disabled:opacity-40`}
                                    style={{ fontSize: fsChrome }}
                                    disabled={isDirectorHardBusy || state.assets[key].length === 0}
                                    title={tt.generateCategory}
                                    onClick={() => generateCategory(kind)}
                                  >
                                    {tt.generateCategory}
                                  </button>
                                </div>
                                {renderImageBatchPriceBar(tipQty)}
                              </div>
                            );
                          })()
                        : null}
                      <button
                        type="button"
                        className={`nodrag flex items-center gap-0.5 ${
                          isDarkMode ? 'text-white/45 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                        }`}
                        style={{ fontSize: fsChrome }}
                        onClick={() => addAsset(kind)}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {tt.addAsset}
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {state.assets[key].map((asset) => renderAssetCard(asset, kind))}
                  </div>
                </div>
                ));
              })()}
            </div>
          </div>
        ) : null}

        {!isMvMode && state.phase === 'prompts' && (
          <div className={`nowheel flex-1 min-h-0 overflow-auto ${scrollCls}`}>
            <table className="w-full border-collapse" style={{ fontSize: fsSmall }}>
              <thead className={`sticky top-0 z-10 ${tableHeadBg}`}>
                <tr className={mutedCls}>
                  <th className="px-2 py-1.5 text-left w-[52px]">{tt.colShotNo}</th>
                  <th className="px-2 py-1.5 text-left">{tt.colDesc}</th>
                  <th className="px-2 py-1.5 text-left w-[120px]">{tt.colFinalPrompt}</th>
                </tr>
              </thead>
              <tbody>
                {state.shots.map((shot, rowIndex) => {
                  const val = resolveShotFinalPrompt(shot);
                  return (
                    <tr key={rowIndex} className={rowHover}>
                      <td className={`px-2 py-1.5 ${mutedCls} border-t ${cellBorder}`}>{shot['镜号']}</td>
                      <td className={`px-2 py-1.5 ${bodyCls} border-t ${cellBorder} line-clamp-2`}>
                        {highlightDescription(shot['画面描述'] || '', allAssets, isDarkMode)}
                      </td>
                      <td className={`px-2 py-1.5 border-t ${cellBorder}`}>
                        {val ? (
                          <div className="flex flex-col gap-1.5 items-start">
                            {(() => {
                              const items = resolveDirectorShotRefItems({
                                prompt: val,
                                styleUrl: directorStyleRefForFilter,
                                libraryAssets: getOrderedAssetsWithImages(state),
                              }).filter((it) => it.url && !it.url.startsWith('ref://'));
                              if (items.length === 0) return null;
                              return (
                                <div className="flex flex-wrap gap-1">
                                  {items.map((it) => {
                                    const url = String(it.url || '').trim();
                                    if (!url) {
                                      return (
                                        <span
                                          key={`shot-ref-${rowIndex}-${it.n}`}
                                          className={`text-[10px] px-1 rounded ${mutedCls}`}
                                        >
                                          @{it.n}?
                                        </span>
                                      );
                                    }
                                    return (
                                      <button
                                        key={`shot-ref-${rowIndex}-${it.n}`}
                                        type="button"
                                        className="nodrag w-8 h-8 rounded overflow-hidden ring-1 ring-sky-400/40"
                                        title={`@图片${it.n} · 第${it.n}张 · ${it.name}${it.gender ? ` · ${it.gender}` : ''}`}
                                        onClick={() =>
                                          setImagePreview({
                                            url,
                                            name: it.name || `图片${it.n}`,
                                          })
                                        }
                                      >
                                        <img
                                          src={url}
                                          alt={`@图片${it.n}`}
                                          className="w-full h-full object-cover"
                                          draggable={false}
                                        />
                                      </button>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                            <button
                              type="button"
                              className={`director-keep-visible nodrag ${linkCls}`}
                              onClick={() => {
                                  setPromptPreviewShotNo(null);
                                  setPromptPreview(val);
                                }}
                            >
                              {tt.viewPrompt}
                            </button>
                          </div>
                        ) : (
                          <span className={mutedCls}>{tt.pendingPrompt}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!isMvMode && state.phase === 'storyboards' && (
          <div className={`nowheel flex-1 min-h-0 overflow-auto ${scrollCls}`}>
            <table className="w-full border-collapse" style={{ fontSize: fsSmall }}>
              <thead className={`sticky top-0 z-10 ${tableHeadBg}`}>
                <tr className={mutedCls}>
                  <th className="px-2 py-1.5 text-left w-[52px]">{tt.colShotNo}</th>
                  <th className="px-2 py-1.5 text-left">{tt.colDesc}</th>
                  <th className="px-2 py-1.5 text-left w-[100px]">{tt.colFinalPrompt}</th>
                  <th className="px-2 py-1.5 text-left w-[140px]">{tt.colStoryboard}</th>
                </tr>
              </thead>
              <tbody>
                {state.shots.map((shot, rowIndex) => {
                  const shotNo = String(shot['镜号'] || rowIndex + 1);
                  const val = resolveShotFinalPrompt(shot);
                  const sb = getDirectorShotStoryboard(state, shotNo);
                  const sbUrl = String(sb.imageUrl || '').trim();
                  const generating =
                    sb.status === 'generating' || sbGenInFlightRef.current.has(shotNo);
                  return (
                    <tr key={rowIndex} className={rowHover}>
                      <td className={`px-2 py-1.5 ${mutedCls} border-t ${cellBorder}`}>{shotNo}</td>
                      <td className={`px-2 py-1.5 ${bodyCls} border-t ${cellBorder} line-clamp-2`}>
                        {highlightDescription(shot['画面描述'] || '', allAssets, isDarkMode)}
                      </td>
                      <td className={`px-2 py-1.5 border-t ${cellBorder}`}>
                        {val ? (
                          <button
                            type="button"
                            className={`director-keep-visible nodrag ${linkCls}`}
                            onClick={() => {
                                  setPromptPreviewShotNo(null);
                                  setPromptPreview(val);
                                }}
                          >
                            {tt.viewPrompt}
                          </button>
                        ) : (
                          <span className={mutedCls}>{tt.pendingPrompt}</span>
                        )}
                      </td>
                      <td className={`px-2 py-1.5 border-t ${cellBorder}`}>
                        <div className="flex items-center gap-1.5">
                          {sbUrl ? (
                            <button
                              type="button"
                              className="nodrag w-12 h-12 rounded overflow-hidden ring-1 ring-sky-400/40 shrink-0"
                              title={tt.viewImage}
                              onClick={() => setImagePreview({ url: sbUrl, name: `镜${shotNo}` })}
                            >
                              <img
                                src={sbUrl}
                                alt={`镜${shotNo}`}
                                className="w-full h-full object-cover"
                                draggable={false}
                              />
                            </button>
                          ) : generating ? (
                            <div
                              className={`w-12 h-12 rounded flex items-center justify-center ${softPanel}`}
                            >
                              <Loader2 className={`w-4 h-4 animate-spin ${accentSpin}`} />
                            </div>
                          ) : (
                            <div
                              className={`w-12 h-12 rounded flex items-center justify-center ${mutedCls} ${softPanel}`}
                              style={{ fontSize: 10 }}
                            >
                              —
                            </div>
                          )}
                          <span className="relative inline-flex shrink-0">
                            <button
                              type="button"
                              className={`nodrag ${btnSecondary('', 'events')} disabled:opacity-50 shrink-0`}
                              style={{ fontSize: fsChrome }}
                              disabled={generating || !val}
                              onMouseEnter={() =>
                                !generating && !!val && setPriceHoverKey(`sb-script-${shotNo}`)
                              }
                              onMouseLeave={() =>
                                setPriceHoverKey((k) =>
                                  k === `sb-script-${shotNo}` ? null : k,
                                )
                              }
                              onClick={() =>
                                enqueueStoryboardShots([shotNo], { onlyMissing: false })
                              }
                            >
                              {generating ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                tt.generateThisStoryboard
                              )}
                            </button>
                            {renderYuanbaoHoverTip(`sb-script-${shotNo}`, 1)}
                          </span>
                        </div>
                        {sb.status === 'error' && sb.error ? (
                          <div className="text-[10px] text-rose-400 mt-0.5 line-clamp-2">{sb.error}</div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </>
      )}

      {/* 右下角框外缩放手柄：MV 窗口模式固定当前尺寸，不提供缩放 */}
      {!isNodeFullscreen && !(isMvMode) && (
      <div
        ref={resizeHandleRef}
        className="nodrag absolute -bottom-2 -right-2 w-6 h-6 cursor-nwse-resize flex items-center justify-center opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity z-[9999]"
        style={{ pointerEvents: 'all' }}
        onMouseDown={handleResizeMouseDown}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" className={mutedCls}>
          <path d="M10 2v8H2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      )}

      {!isNodeFullscreen ? hangPrimary : null}

      {libraryPick &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className={`fixed inset-0 z-[100002] flex items-center justify-center p-4 ${
              isDarkMode ? 'bg-black/70' : 'bg-black/45'
            }`}
            onClick={() => setLibraryPick(null)}
          >
            <div
              className={`w-full max-w-lg max-h-[80vh] overflow-hidden rounded-xl shadow-2xl ring-1 flex flex-col ${
                isDarkMode ? 'bg-zinc-900 ring-white/10 text-white' : 'bg-gray-100 ring-gray-200 text-gray-900'
              }`}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-3 py-2.5 shrink-0 border-b border-white/10">
                <div className="text-sm font-medium">
                  {libraryPick.kind === 'character' ? tt.libraryPickTitleCharacter : tt.libraryPickTitleScene}
                </div>
                <button
                  type="button"
                  className={`nodrag ${mutedCls} hover:opacity-100`}
                  onClick={() => setLibraryPick(null)}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className={`flex-1 min-h-0 overflow-y-auto p-3 ${scrollCls}`}>
                {libraryLoading ? (
                  <div className={`flex items-center justify-center gap-2 py-10 ${mutedCls}`}>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {tt.libraryPickLoading}
                  </div>
                ) : libraryItems.length === 0 ? (
                  <div className={`text-center py-10 ${mutedCls}`} style={{ fontSize: fsSmall }}>
                    {tt.libraryPickEmpty}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {libraryItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`nodrag text-left rounded-lg overflow-hidden border transition-colors ${
                          isDarkMode
                            ? 'border-white/10 hover:border-sky-400/50 hover:bg-white/[0.04]'
                            : 'border-gray-200 hover:border-gray-400 hover:bg-gray-200'
                        }`}
                        onClick={() => {
                          applyAssetImage(libraryPick.assetId, item.url, { name: item.label });
                          setLibraryPick(null);
                        }}
                      >
                        <div
                          className={`aspect-square flex items-center justify-center ${
                            isDarkMode ? 'bg-zinc-950' : 'bg-gray-100'
                          }`}
                        >
                          <img
                            src={item.url}
                            alt={item.label}
                            className="max-w-full max-h-full object-contain"
                            draggable={false}
                          />
                        </div>
                        <div className={`px-2 py-1.5 truncate ${bodyCls}`} style={{ fontSize: fsChrome }}>
                          {item.label}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {batchOpen && (
        <div
          className={`absolute inset-0 z-20 flex items-end justify-center p-3 rounded-2xl ${
            isDarkMode ? 'bg-black/70' : 'bg-black/40'
          }`}
        >
          <div
            className={`w-full max-w-[720px] max-h-[80%] overflow-auto rounded-xl shadow-2xl ring-1 ${
              isDarkMode ? 'bg-zinc-900 ring-white/10' : 'bg-gray-100 ring-gray-200'
            }`}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 py-2">
              <div className={`text-sm font-medium ${titleCls}`}>{tt.batchModalTitle}</div>
              <button
                type="button"
                className={`nodrag ${mutedCls} hover:opacity-100`}
                onClick={() => setBatchOpen(false)}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 space-y-2">
              {allAssets.map((asset) => {
                const checked = state.selectedAssetIds.includes(asset.id);
                const kindLabel =
                  asset.kind === 'character'
                    ? tt.characters
                    : asset.kind === 'scene'
                      ? tt.scenes
                      : tt.props;
                return (
                  <label
                    key={asset.id}
                    className={`flex gap-2 items-start rounded-lg p-2 cursor-pointer ${softPanel}`}
                  >
                    <input
                      type="checkbox"
                      className="nodrag mt-1"
                      checked={checked}
                      onChange={() => {
                        const set = new Set(state.selectedAssetIds);
                        if (set.has(asset.id)) set.delete(asset.id);
                        else set.add(asset.id);
                        patch(setSelectedDirectorAssetIds(state, [...set]));
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className={`text-[12px] ${titleCls}`}>
                        {asset.name || '—'}{' '}
                        <span
                          className={`text-[10px] px-1 py-0.5 rounded ${
                            isDarkMode ? 'text-white/45 bg-zinc-800' : 'text-gray-500 bg-gray-100'
                          }`}
                        >
                          {kindLabel}
                        </span>
                      </div>
                      <textarea
                        className={`nodrag nowheel mt-1 w-full min-h-[56px] rounded px-2 py-1 text-[11px] outline-none focus:ring-1 ${
                          isDarkMode
                            ? 'bg-zinc-950/80 text-zinc-300 focus:ring-blue-500/30'
                            : 'bg-gray-100 text-gray-700 focus:ring-blue-400/40'
                        }`}
                        value={asset.prompt}
                        onChange={(e) =>
                          patch(updateDirectorAsset(state, asset.id, { prompt: e.target.value }))
                        }
                        onClick={(e) => e.preventDefault()}
                      />
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <div className={`text-[11px] ${mutedCls}`}>
                {fillDirectorI18n(tt.selectedCount, {
                  n: state.selectedAssetIds.length,
                  total: allAssets.length,
                })}
              </div>
              <div className="flex items-center gap-2">
                <select
                  className={`nodrag text-[11px] rounded px-2 py-1 ring-1 ${
                    isDarkMode
                      ? 'bg-zinc-950 text-zinc-200 ring-white/10'
                      : 'bg-gray-100 text-gray-800 ring-gray-200'
                  }`}
                  value={
                    directorAssetImageModels.some((m) => m.value === (state.imageModel || ''))
                      ? state.imageModel || DEFAULT_IMAGE_MODEL
                      : DEFAULT_IMAGE_MODEL
                  }
                  onChange={(e) => patch({ ...state, imageModel: e.target.value })}
                >
                  {directorAssetImageModels.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <select
                  className={`nodrag text-[11px] rounded px-2 py-1 ring-1 ${
                    isDarkMode
                      ? 'bg-zinc-950 text-zinc-200 ring-white/10'
                      : 'bg-gray-100 text-gray-800 ring-gray-200'
                  }`}
                  value={normalizeDirectorImageResolution(state.imageResolution)}
                  title={tt.videoBatchResolutionLabel}
                  onChange={(e) =>
                    patch({
                      ...state,
                      imageResolution: normalizeDirectorImageResolution(e.target.value),
                    })
                  }
                >
                  {(['1K', '2K', '4K'] as const).map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={`nodrag ${btnPrimary('', 'events')}`}
                  onClick={startBatchImages}
                >
                  {fillDirectorI18n(tt.generateN, { n: state.selectedAssetIds.length || allAssets.length })}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editing?.col === '最终提示词' &&
        !isMvMode &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className={`nodrag nopan fixed inset-0 z-[100002] flex items-center justify-center p-6 ${
              isDarkMode ? 'bg-black/75' : 'bg-black/45'
            }`}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (e.target === e.currentTarget) closeFinalPromptEdit();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                closeFinalPromptEdit();
              }
            }}
          >
            <div
              className={`nodrag nowheel w-full max-w-3xl max-h-[min(88vh,860px)] flex flex-col rounded-2xl p-5 shadow-2xl ring-1 ${
                isDarkMode ? 'bg-zinc-900 ring-white/15' : 'bg-gray-100 ring-gray-200'
              }`}
              onPointerDown={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={isMvMode ? tt.videoPromptOriginal : tt.colFinalPrompt}
            >
              <div className="flex justify-between items-center mb-3 shrink-0 gap-3">
                <div className={`text-lg font-semibold ${titleCls}`}>
                  {isMvMode ? tt.videoPromptOriginal : tt.colFinalPrompt}
                  <span className={`ml-2 font-normal tabular-nums ${mutedCls}`} style={{ fontSize: fsChrome }}>
                    {String(
                      state.shots[editing.row]?.['镜号'] || editing.row + 1,
                    ).padStart(2, '0')}
                  </span>
                </div>
                <button
                  type="button"
                  className={`nodrag p-1.5 rounded-lg ${mutedCls} hover:opacity-100 ${
                    isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                  }`}
                  disabled={busyAction === 'revise-final-prompt'}
                  onClick={() => closeFinalPromptEdit()}
                  aria-label={tt.stylePromptCancel}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <textarea
                className={`nodrag nowheel w-full flex-1 min-h-[220px] max-h-[min(52vh,480px)] resize-y rounded-xl px-3 py-2.5 leading-relaxed outline-none focus:ring-1 ${
                  isDarkMode
                    ? 'bg-black/35 text-white/90 ring-1 ring-white/10 focus:ring-blue-500/35 placeholder:text-white/35'
                    : 'bg-white text-gray-900 ring-1 ring-gray-200 focus:ring-blue-400/50 placeholder:text-gray-400'
                } ${scrollCls}`}
                style={{ fontSize: Math.max(14, fsBody) }}
                autoFocus
                value={finalPromptDraft}
                disabled={busyAction === 'revise-final-prompt'}
                placeholder={tt.pendingPrompt}
                onChange={(e) => {
                  const value = e.target.value;
                  setFinalPromptDraft(value);
                  scheduleFinalPromptPersist(editing.row, value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    closeFinalPromptEdit();
                  }
                }}
              />

              <div
                className={`mt-3 shrink-0 flex flex-wrap items-center gap-2 border-t pt-3 ${
                  isDarkMode ? 'border-white/10' : 'border-gray-200'
                }`}
              >
                {renderChatModelSelect({
                  variant: 'plain',
                  menuPlacement: 'up',
                  disabled:
                    !!busyAction ||
                    !!state.isGenerating ||
                    !!data?.isGenerating ||
                    isDirectorHardBusy,
                })}
                <div className="flex min-w-0 flex-1 items-center gap-1.5 basis-[220px]">
                  <input
                    type="text"
                    className={`nodrag nowheel min-w-0 flex-1 rounded-lg px-2.5 py-1.5 outline-none ring-1 ${
                      isDarkMode
                        ? 'bg-white/[0.04] ring-white/12 text-white/85 placeholder:text-white/35'
                        : 'bg-white ring-gray-200 text-gray-800 placeholder:text-gray-400'
                    }`}
                    style={{ fontSize: Math.max(12, fsSmall) }}
                    value={finalPromptOpinion}
                    placeholder={tt.aiReviseFinalPromptOpinionPlaceholder}
                    disabled={
                      busyAction === 'revise-final-prompt' ||
                      isFinalPromptOpinionDictationActive ||
                      finalPromptOpinionMicBusy
                    }
                    onChange={(e) => setFinalPromptOpinion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleAiReviseFinalPrompt(editing.row);
                      }
                    }}
                  />
                  <button
                    type="button"
                    {...finalPromptOpinionMicPointerHandlers}
                    disabled={
                      finalPromptOpinionMicStopping || busyAction === 'revise-final-prompt'
                    }
                    style={
                      finalPromptOpinionDictationStatus === 'listening' ||
                      finalPromptOpinionDictationStatus === 'connecting'
                        ? micLevelCssVars(finalPromptOpinionDictationLevel)
                        : undefined
                    }
                    className={`nexflow-voice-mic-btn nodrag nopan relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border select-none ${
                      finalPromptOpinionDictationStatus === 'connecting'
                        ? 'connecting'
                        : finalPromptOpinionDictationStatus === 'listening'
                          ? 'listening'
                          : ''
                    } ${
                      finalPromptOpinionMicStopping
                        ? isDarkMode
                          ? 'cursor-wait border-white/25 bg-white/5 text-white/75'
                          : 'cursor-wait border-gray-300 bg-white/90 text-gray-600'
                        : isDarkMode
                          ? 'border-white/25 bg-white/5 text-white/75 hover:bg-white/10 hover:text-white'
                          : 'border-gray-300 bg-white/90 text-gray-600 hover:bg-gray-100'
                    }`}
                    title={
                      finalPromptOpinionMicBusy
                        ? tt.aiReviseFinalPromptVoiceBusy
                        : isFinalPromptOpinionDictationActive
                          ? tt.aiReviseFinalPromptVoiceStop
                          : tt.aiReviseFinalPromptVoiceStart
                    }
                    aria-label={
                      finalPromptOpinionMicBusy
                        ? tt.aiReviseFinalPromptVoiceBusy
                        : isFinalPromptOpinionDictationActive
                          ? tt.aiReviseFinalPromptVoiceStop
                          : tt.aiReviseFinalPromptVoiceStart
                    }
                    onClick={(e) => e.stopPropagation()}
                  >
                    <VoiceMicGlyph
                      busy={finalPromptOpinionMicBusy}
                      active={finalPromptOpinionDictationStatus === 'listening'}
                      level={finalPromptOpinionDictationLevel}
                    />
                  </button>
                </div>
                <div
                  className="relative overflow-visible"
                  onMouseEnter={() => setPriceHoverKey(`revise-final-modal-${editing.row}`)}
                  onMouseLeave={() =>
                    setPriceHoverKey((k) =>
                      k === `revise-final-modal-${editing.row}` ? null : k,
                    )
                  }
                >
                  {renderChatYuanbaoHoverTip(`revise-final-modal-${editing.row}`)}
                  <button
                    type="button"
                    className={`nodrag inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 ring-1 whitespace-nowrap font-medium disabled:opacity-40 ${
                      isDarkMode
                        ? 'bg-sky-500/25 text-sky-100 ring-sky-400/40 hover:bg-sky-500/35'
                        : 'bg-gray-800 text-white ring-gray-700 hover:bg-gray-900'
                    }`}
                    style={{ fontSize: fsChrome }}
                    disabled={
                      !!busyAction ||
                      !!state.isGenerating ||
                      !!data?.isGenerating ||
                      !String(finalPromptOpinion || '').trim() ||
                      isFinalPromptOpinionDictationActive ||
                      finalPromptOpinionMicBusy
                    }
                    title={tt.priceTooltip}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleAiReviseFinalPrompt(editing.row);
                    }}
                  >
                    {busyAction === 'revise-final-prompt' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : null}
                    {busyAction === 'revise-final-prompt'
                      ? tt.aiReviseFinalPromptBusy
                      : tt.aiReviseFinalPrompt}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {promptHover != null &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={promptHoverPanelRef}
            className="fixed pointer-events-auto"
            style={{
              left: promptHover.x,
              top: promptHover.y,
              width: promptHover.width,
              maxHeight: typeof window !== 'undefined' ? window.innerHeight - 32 : undefined,
              overflow: 'visible',
              zIndex: 100055,
              isolation: 'isolate',
            }}
            onMouseEnter={clearPromptHoverLeaveTimer}
            onMouseLeave={scheduleClosePromptHover}
            onPointerDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            data-director-prompt-hover="1"
          >
            <div
              className={`flex w-full flex-col rounded-2xl border ${
                isDarkMode ? 'border-white/20 text-white' : 'border-gray-200 text-gray-900'
              }`}
              style={{
                backgroundColor: isDarkMode ? '#09090b' : '#ffffff',
                boxShadow: isDarkMode
                  ? '0 24px 64px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.08)'
                  : '0 24px 64px rgba(0,0,0,0.18)',
              }}
            >
              <div
                className={`shrink-0 flex items-center justify-between gap-2 border-b px-4 py-2.5 ${
                  isDarkMode ? 'border-white/10' : 'border-gray-100'
                }`}
                style={{ backgroundColor: isDarkMode ? '#09090b' : '#ffffff' }}
              >
                <div className="text-sm font-semibold truncate">
                  {promptHover.title || tt.colFinalPrompt}
                </div>
                <button
                  type="button"
                  className={`nodrag shrink-0 rounded-md px-1.5 py-0.5 text-[11px] ${
                    isDarkMode
                      ? 'text-white/55 hover:bg-white/10 hover:text-white/90'
                      : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
                  }`}
                  title={tt.viewPrompt}
                  onClick={(e) => {
                    e.stopPropagation();
                    const shotNo = promptHover.shotNo;
                    if (shotNo && isMvMode) {
                      const rowIndex = directorStateRef.current.shots.findIndex(
                        (s, i) => String(s['镜号'] || i + 1) === String(shotNo),
                      );
                      if (rowIndex >= 0) {
                        const hoverShot = directorStateRef.current.shots[rowIndex];
                        const versions = getDirectorShotPromptVersions(
                          hoverShot,
                          getDirectorShotStoryboard(directorStateRef.current, shotNo),
                        );
                        setPromptHover(null);
                        openFinalPromptEdit(
                          rowIndex,
                          versions.original || resolveShotFinalPrompt(hoverShot) || promptHover.text,
                        );
                        return;
                      }
                    }
                    setPromptPreview(promptHover.text);
                    setPromptPreviewShotNo(promptHover.shotNo || null);
                    setPromptHover(null);
                  }}
                >
                  {tt.viewPrompt}
                </button>
              </div>
              <div
                className="p-4"
                style={{
                  backgroundColor: isDarkMode ? '#09090b' : '#ffffff',
                }}
              >
                <div
                  style={{
                    fontSize:
                      typeof window !== 'undefined' && promptHover.text.length > 1100
                        ? 12.5
                        : typeof window !== 'undefined' && promptHover.text.length > 700
                          ? 13
                          : 14,
                  }}
                >
                  {renderDirectorFinalPromptStructured(
                    promptHover.text,
                    isDarkMode,
                    allAssets,
                    1,
                    directorStyleRefForFilter,
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {promptPreview != null &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className={`fixed inset-0 z-[100002] flex items-center justify-center p-6 ${
              isDarkMode ? 'bg-black/75' : 'bg-black/45'
            }`}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (e.target === e.currentTarget) closePromptPreviewModal();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                closePromptPreviewModal();
              }
            }}
          >
            <div
              className={`w-full ${promptPreviewShotNo ? 'max-w-6xl' : 'max-w-4xl'} max-h-[min(85vh,820px)] flex flex-col rounded-2xl p-5 shadow-2xl ring-1 ${
                isDarkMode ? 'bg-zinc-900 ring-white/15' : 'bg-gray-100 ring-gray-200'
              }`}
              onPointerDown={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <div className="flex justify-between items-center mb-3 shrink-0 gap-3">
                <div className={`text-lg font-semibold ${titleCls}`}>
                  {promptPreviewShotNo
                    ? `${tt.colFinalPrompt} · ${tt.colShotNo} ${String(promptPreviewShotNo).padStart(2, '0')}`
                    : tt.colFinalPrompt}
                </div>
                <button
                  type="button"
                  className={`nodrag p-1.5 rounded-lg ${mutedCls} hover:opacity-100 ${
                    isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                  }`}
                  disabled={busyAction === 'revise-final-prompt'}
                  onClick={() => closePromptPreviewModal()}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              {(() => {
                const previewShot = promptPreviewShotNo
                  ? state.shots.find(
                      (s, i) => String(s['镜号'] || i + 1) === String(promptPreviewShotNo),
                    )
                  : undefined;
                const previewRowIndex = promptPreviewShotNo
                  ? state.shots.findIndex(
                      (s, i) => String(s['镜号'] || i + 1) === String(promptPreviewShotNo),
                    )
                  : -1;
                const previewVersions = promptPreviewShotNo
                  ? getRepairedShotPromptVersions(
                      previewShot || {},
                      Math.max(0, previewRowIndex),
                      getDirectorShotStoryboard(state, promptPreviewShotNo),
                    )
                  : null;
                const originalText = String(
                  (previewRowIndex >= 0 && finalPromptEditRowRef.current === previewRowIndex
                    ? finalPromptDraft
                    : null) ||
                    previewVersions?.original ||
                    promptPreview ||
                    '',
                ).trim();
                const optimizedText = String(previewVersions?.optimized || '').trim();
                const showDual = !!promptPreviewShotNo;
                const canEditOriginal = showDual && previewRowIndex >= 0;
                const activeText = showDual
                  ? promptPreviewTab === 'optimized' && optimizedText
                    ? optimizedText
                    : canEditOriginal
                      ? String(finalPromptDraft || originalText).trim()
                      : originalText
                  : String(promptPreview || '').trim();
                const items = resolveDirectorShotRefItems({
                  prompt: activeText,
                  styleUrl: directorStyleRefForFilter,
                  libraryAssets: getOrderedAssetsWithImages(state),
                }).filter((it) => {
                  if (!it.url || it.url.startsWith('ref://')) return false;
                  if (isDirectorLtxSingleImageModel(state.videoBatchModel)) {
                    return it.role === 'storyboard';
                  }
                  return true;
                });
                const paneCls = (active: boolean) =>
                  `relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl transition-shadow ${
                    active
                      ? isDarkMode
                        ? 'ring-2 ring-emerald-400/90 bg-emerald-500/[0.07] shadow-[0_0_0_1px_rgba(52,211,153,0.35)]'
                        : 'ring-2 ring-emerald-500/80 bg-emerald-50/70 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]'
                      : isDarkMode
                        ? 'ring-1 ring-white/10 bg-black/20'
                        : 'ring-1 ring-gray-200 bg-white'
                  }`;
                const renderOriginalAiBar =
                  canEditOriginal ? (
                    <div
                      className={`shrink-0 flex flex-wrap items-center gap-2 border-t px-2.5 py-2 ${
                        isDarkMode ? 'border-white/10' : 'border-gray-200'
                      }`}
                    >
                      {renderChatModelSelect({
                        variant: 'plain',
                        menuPlacement: 'up',
                        disabled:
                          !!busyAction ||
                          !!state.isGenerating ||
                          !!data?.isGenerating ||
                          isDirectorHardBusy,
                      })}
                      <div className="flex min-w-0 flex-1 items-center gap-1.5 basis-[180px]">
                        <input
                          type="text"
                          className={`nodrag nowheel min-w-0 flex-1 rounded-lg px-2.5 py-1.5 outline-none ring-1 ${
                            isDarkMode
                              ? 'bg-white/[0.04] ring-white/12 text-white/85 placeholder:text-white/35'
                              : 'bg-white ring-gray-200 text-gray-800 placeholder:text-gray-400'
                          }`}
                          style={{ fontSize: Math.max(12, fsSmall) }}
                          value={finalPromptOpinion}
                          placeholder={tt.aiReviseFinalPromptOpinionPlaceholder}
                          disabled={
                            busyAction === 'revise-final-prompt' ||
                            isFinalPromptOpinionDictationActive ||
                            finalPromptOpinionMicBusy
                          }
                          onChange={(e) => setFinalPromptOpinion(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleAiReviseFinalPrompt(previewRowIndex);
                            }
                          }}
                        />
                        <button
                          type="button"
                          {...finalPromptOpinionMicPointerHandlers}
                          disabled={
                            finalPromptOpinionMicStopping || busyAction === 'revise-final-prompt'
                          }
                          style={
                            finalPromptOpinionDictationStatus === 'listening' ||
                            finalPromptOpinionDictationStatus === 'connecting'
                              ? micLevelCssVars(finalPromptOpinionDictationLevel)
                              : undefined
                          }
                          className={`nexflow-voice-mic-btn nodrag nopan relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border select-none ${
                            finalPromptOpinionDictationStatus === 'connecting'
                              ? 'connecting'
                              : finalPromptOpinionDictationStatus === 'listening'
                                ? 'listening'
                                : ''
                          } ${
                            finalPromptOpinionMicStopping
                              ? isDarkMode
                                ? 'cursor-wait border-white/25 bg-white/5 text-white/75'
                                : 'cursor-wait border-gray-300 bg-white/90 text-gray-600'
                              : isDarkMode
                                ? 'border-white/25 bg-white/5 text-white/75 hover:bg-white/10 hover:text-white'
                                : 'border-gray-300 bg-white/90 text-gray-600 hover:bg-gray-100'
                          }`}
                          title={
                            finalPromptOpinionMicBusy
                              ? tt.aiReviseFinalPromptVoiceBusy
                              : isFinalPromptOpinionDictationActive
                                ? tt.aiReviseFinalPromptVoiceStop
                                : tt.aiReviseFinalPromptVoiceStart
                          }
                          aria-label={
                            finalPromptOpinionMicBusy
                              ? tt.aiReviseFinalPromptVoiceBusy
                              : isFinalPromptOpinionDictationActive
                                ? tt.aiReviseFinalPromptVoiceStop
                                : tt.aiReviseFinalPromptVoiceStart
                          }
                          onClick={(e) => e.stopPropagation()}
                        >
                          <VoiceMicGlyph
                            busy={finalPromptOpinionMicBusy}
                            active={finalPromptOpinionDictationStatus === 'listening'}
                            level={finalPromptOpinionDictationLevel}
                          />
                        </button>
                      </div>
                      <div
                        className="relative overflow-visible"
                        onMouseEnter={() => setPriceHoverKey(`revise-final-preview-${previewRowIndex}`)}
                        onMouseLeave={() =>
                          setPriceHoverKey((k) =>
                            k === `revise-final-preview-${previewRowIndex}` ? null : k,
                          )
                        }
                      >
                        {renderChatYuanbaoHoverTip(`revise-final-preview-${previewRowIndex}`)}
                        <button
                          type="button"
                          className={`nodrag inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 ring-1 whitespace-nowrap font-medium disabled:opacity-40 ${
                            isDarkMode
                              ? 'bg-sky-500/25 text-sky-100 ring-sky-400/40 hover:bg-sky-500/35'
                              : 'bg-gray-800 text-white ring-gray-700 hover:bg-gray-900'
                          }`}
                          style={{ fontSize: fsChrome }}
                          disabled={
                            !!busyAction ||
                            !!state.isGenerating ||
                            !!data?.isGenerating ||
                            !String(finalPromptOpinion || '').trim() ||
                            isFinalPromptOpinionDictationActive ||
                            finalPromptOpinionMicBusy
                          }
                          title={tt.priceTooltip}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleAiReviseFinalPrompt(previewRowIndex);
                          }}
                        >
                          {busyAction === 'revise-final-prompt' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : null}
                          {busyAction === 'revise-final-prompt'
                            ? tt.aiReviseFinalPromptBusy
                            : tt.aiReviseFinalPrompt}
                        </button>
                      </div>
                    </div>
                  ) : null;
                const renderPane = (opts: {
                  kind: 'original' | 'optimized';
                  title: string;
                  text: string;
                  empty?: string;
                  active: boolean;
                }) => (
                  <div className={paneCls(opts.active)}>
                    {opts.active ? (
                      <span
                        className={`pointer-events-none absolute right-2 top-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full shadow-sm ${
                          isDarkMode
                            ? 'bg-emerald-500 text-white ring-1 ring-emerald-300/50'
                            : 'bg-emerald-500 text-white ring-1 ring-emerald-600/30'
                        }`}
                        title={
                          opts.kind === 'optimized'
                            ? tt.videoPromptUsingOptimized
                            : tt.videoPromptUsingOriginal
                        }
                        aria-label={
                          opts.kind === 'optimized'
                            ? tt.videoPromptUsingOptimized
                            : tt.videoPromptUsingOriginal
                        }
                      >
                        <Check className="w-3.5 h-3.5" strokeWidth={3} />
                      </span>
                    ) : null}
                    <div
                      className={`flex items-center justify-between gap-2 border-b px-3 py-2 ${
                        opts.active
                          ? isDarkMode
                            ? 'border-emerald-400/25'
                            : 'border-emerald-200'
                          : isDarkMode
                            ? 'border-white/10'
                            : 'border-gray-100'
                      }`}
                    >
                      <div className={`text-sm font-semibold ${titleCls}`}>{opts.title}</div>
                      <div className="flex items-center gap-1.5 pr-7">
                        {opts.kind === 'optimized' && promptPreviewShotNo ? (
                          <button
                            type="button"
                            className={`nodrag rounded-md px-2 py-0.5 text-[11px] ${btnSecondary('!px-2 !py-0.5', 'events')} disabled:opacity-50`}
                            disabled={
                              busyAction === 'videos' ||
                              busyAction === 'optimize-prompts' ||
                              optimizingShotNos.includes(promptPreviewShotNo)
                            }
                            onClick={() => void handleOptimizeVideoPrompts([promptPreviewShotNo])}
                          >
                            {optimizingShotNos.includes(promptPreviewShotNo)
                              ? tt.videoOptimizePromptBusy
                              : tt.videoOptimizePrompt}
                          </button>
                        ) : null}
                        {!opts.active && (opts.text || opts.kind === 'original') ? (
                          <button
                            type="button"
                            className={`nodrag inline-flex h-6 w-6 items-center justify-center rounded-full ring-1 ${
                              isDarkMode
                                ? 'text-white/45 ring-white/20 hover:bg-white/10 hover:text-emerald-300 hover:ring-emerald-400/40'
                                : 'text-gray-400 ring-gray-300 hover:bg-emerald-50 hover:text-emerald-600 hover:ring-emerald-300'
                            }`}
                            disabled={opts.kind === 'optimized' && !opts.text}
                            title={
                              opts.kind === 'optimized'
                                ? tt.videoPromptUseOptimized
                                : tt.videoPromptUseOriginal
                            }
                            aria-label={
                              opts.kind === 'optimized'
                                ? tt.videoPromptUseOptimized
                                : tt.videoPromptUseOriginal
                            }
                            onClick={() => {
                              if (!promptPreviewShotNo) return;
                              setShotPromptUseOptimized(
                                promptPreviewShotNo,
                                opts.kind === 'optimized',
                              );
                              setPromptPreviewTab(opts.kind);
                            }}
                          >
                            <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {opts.kind === 'original' && canEditOriginal ? (
                      <>
                        <textarea
                          className={`nodrag nowheel flex-1 min-h-[200px] w-full resize-none px-3 py-2.5 leading-relaxed outline-none ${
                            isDarkMode
                              ? 'bg-transparent text-white/90 placeholder:text-white/35'
                              : 'bg-transparent text-gray-900 placeholder:text-gray-400'
                          } ${scrollCls}`}
                          style={{ fontSize: Math.max(14, fsBody - 1) }}
                          value={finalPromptDraft}
                          disabled={busyAction === 'revise-final-prompt'}
                          placeholder={tt.pendingPrompt}
                          onChange={(e) => {
                            const value = e.target.value;
                            setFinalPromptDraft(value);
                            setPromptPreview(value);
                            scheduleFinalPromptPersist(previewRowIndex, value);
                          }}
                        />
                        {renderOriginalAiBar}
                      </>
                    ) : (
                      <div className={`nowheel flex-1 min-h-0 overflow-auto p-3 ${scrollCls}`}>
                        {opts.text ? (
                          renderDirectorFinalPromptStructured(
                            opts.text,
                            isDarkMode,
                            allAssets,
                            1,
                            directorStyleRefForFilter,
                          )
                        ) : (
                          <div className={mutedCls}>{opts.empty || tt.videoPromptNoOptimized}</div>
                        )}
                      </div>
                    )}
                  </div>
                );
                return (
                  <>
                    {items.length > 0 ? (
                      <div className="mb-3 flex flex-wrap gap-2 shrink-0">
                        {items.map((it) => {
                          const url = String(it.url || '').trim();
                          const kindLabel =
                            it.role === 'style'
                              ? '风格'
                              : it.role === 'storyboard'
                                ? '分镜'
                                : it.role === 'character'
                                  ? tt.characters
                                  : it.role === 'scene'
                                    ? tt.scenes
                                    : it.role === 'prop'
                                      ? tt.props
                                      : it.role === 'creature'
                                        ? tt.creatures
                                        : '';
                          const label = `@图片${it.n} · 第${it.n}张 · ${it.name}${it.gender ? ` · ${it.gender}` : ''}`;
                          return (
                            <div
                              key={`preview-ref-${it.n}`}
                              className={`inline-flex items-center gap-1.5 rounded-lg border pr-2 py-0.5 pl-0.5 text-xs font-medium ${
                                isDarkMode
                                  ? 'bg-sky-500/15 border-sky-400/35 text-sky-100'
                                  : 'bg-sky-50 border-sky-200 text-sky-800'
                              }`}
                              title={kindLabel ? `${kindLabel} · ${label}` : label}
                            >
                              {url ? (
                                <button
                                  type="button"
                                  className="nodrag w-10 h-10 rounded-md overflow-hidden shrink-0"
                                  onClick={() =>
                                    setImagePreview({ url, name: it.name || `图片${it.n}` })
                                  }
                                >
                                  <img
                                    src={url}
                                    alt={label}
                                    className="w-full h-full object-cover"
                                    draggable={false}
                                  />
                                </button>
                              ) : (
                                <span
                                  className={`w-10 h-10 rounded-md shrink-0 flex items-center justify-center ${
                                    isDarkMode ? 'bg-white/10' : 'bg-gray-100'
                                  }`}
                                >
                                  ?
                                </span>
                              )}
                              <span className="max-w-[140px] truncate">{label}</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    {showDual ? (
                      <div
                        className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1 min-h-0"
                        style={{ fontSize: Math.max(14, fsBody - 1) }}
                      >
                        {renderPane({
                          kind: 'original',
                          title: tt.videoPromptOriginal,
                          text: String(finalPromptDraft || originalText).trim(),
                          active: !previewVersions?.useOptimized,
                        })}
                        {renderPane({
                          kind: 'optimized',
                          title: tt.videoPromptOptimized,
                          text: optimizedText,
                          empty: tt.videoPromptNoOptimized,
                          active: !!previewVersions?.useOptimized,
                        })}
                      </div>
                    ) : (
                      <div
                        className={`nowheel flex-1 min-h-0 overflow-auto ${scrollCls}`}
                        style={{ fontSize: Math.max(15, fsBody) }}
                      >
                        {renderDirectorFinalPromptStructured(
                          promptPreview,
                          isDarkMode,
                          allAssets,
                          1,
                          directorStyleRefForFilter,
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>,
          document.body,
        )}

      {imagePreview != null &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className={`fixed inset-0 z-[100002] flex items-center justify-center p-6 ${
              isDarkMode ? 'bg-black/80' : 'bg-black/50'
            }`}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (e.target === e.currentTarget) setImagePreview(null);
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              className={`relative max-w-[min(92vw,960px)] max-h-[min(90vh,900px)] flex flex-col rounded-2xl overflow-hidden shadow-2xl ring-1 ${
                isDarkMode ? 'bg-zinc-900 ring-white/15' : 'bg-gray-100 ring-gray-200'
              }`}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center px-4 py-3 shrink-0 gap-3">
                <div className={`text-base font-semibold truncate ${titleCls}`}>
                  {imagePreview.name || tt.viewImage}
                </div>
                <button
                  type="button"
                  className={`nodrag p-1.5 rounded-lg shrink-0 ${mutedCls} ${
                    isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                  }`}
                  onClick={() => setImagePreview(null)}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="px-4 pb-4 flex-1 min-h-0 flex items-center justify-center overflow-auto">
                <img
                  src={imagePreview.url}
                  alt={imagePreview.name}
                  className="max-w-full max-h-[min(78vh,780px)] object-contain rounded-lg"
                />
              </div>
            </div>
          </div>,
          document.body,
        )}

      {videoPreview != null &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className={`fixed inset-0 z-[100002] flex items-center justify-center p-6 ${
              isDarkMode ? 'bg-black/80' : 'bg-black/50'
            }`}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (e.target === e.currentTarget) closeVideoPreview();
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              className={`relative max-w-[min(92vw,1100px)] max-h-[min(90vh,900px)] w-full flex flex-col rounded-2xl overflow-hidden shadow-2xl ring-1 ${
                isDarkMode ? 'bg-zinc-900 ring-white/15' : 'bg-gray-100 ring-gray-200'
              }`}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center px-4 py-3 shrink-0 gap-3">
                <div className={`text-base font-semibold truncate ${titleCls}`}>
                  {videoPreview.name || tt.viewImage}
                </div>
                <button
                  type="button"
                  className={`nodrag p-1.5 rounded-lg shrink-0 ${mutedCls} ${
                    isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                  }`}
                  onClick={() => closeVideoPreview()}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="px-4 pb-4 flex-1 min-h-0 flex items-center justify-center overflow-auto">
                <video
                  key={videoPreview.url}
                  ref={videoPreviewElRef}
                  src={toElectronVideoElementSrc(videoPreview.url) || videoPreview.url}
                  className="nodrag max-w-full max-h-[min(78vh,780px)] rounded-lg bg-black"
                  controls
                  playsInline
                  preload="auto"
                  onLoadedData={(e) => {
                    const v = e.currentTarget;
                    void v.play().catch(() => undefined);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                />
              </div>
            </div>
          </div>,
          document.body,
        )}

      {isNodeFullscreen &&
        typeof document !== 'undefined' &&
        createPortal(
        <div
          className={`fixed inset-0 z-[100001] flex flex-col ${
            isDarkMode ? 'bg-zinc-950 text-white' : 'bg-gray-100 text-gray-900'
          }`}
          style={{ fontSize: fsBody }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          <div
            className={`flex-1 min-h-0 px-4 py-3 custom-scrollbar-dark ${
              (isMvMode &&
                (state.phase === 'shots' ||
                  state.phase === 'music' ||
                  state.phase === 'style' ||
                  state.phase === 'story' ||
                  state.phase === 'cast' ||
                  state.phase === 'videos' ||
                  state.phase === 'karaoke')) ||
              isDramaMode
                ? 'flex flex-col overflow-hidden'
                : 'overflow-auto'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Clapperboard className={`w-5 h-5 shrink-0 ${accentSpin}`} />
                <span className={`font-semibold truncate ${titleCls}`}>{dramaHeaderTitle || state.title || tt.directorTitle}</span>
                {renderModeToggle()}
                {!isWizardMode ? renderScriptChip() : null}
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setPromptHover(null);
                  if (promptPreview != null && busyAction !== 'revise-final-prompt') {
                    closePromptPreviewModal();
                  } else {
                    setPromptPreview(null);
                  }
                  setImagePreview(null);
                  setLibraryPick(null);
                  setBatchOpen(false);
                  setStylePromptEditId(null);
                  setCastPickerShotNo(null);
                  setScenePickerShotNo(null);
                  setSbSourceMenuShotNo(null);
                  setSbPickerShotNo(null);
                  if (editing != null && busyAction !== 'revise-final-prompt') {
                    if (editing.col === '最终提示词') closeFinalPromptEdit();
                    else setEditing(null);
                  }
                  videoPreviewOpenRef.current = false;
                  setVideoPreview(null);
                  setIsNodeFullscreen(false);
                }}
                className={`nodrag nopan shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  isDarkMode
                    ? 'bg-white/10 text-white/90 hover:bg-white/16'
                    : 'bg-gray-200/80 text-gray-800 hover:bg-gray-300'
                }`}
                title={locale === 'en' ? 'Exit fullscreen (Esc)' : '退出全屏（Esc）'}
                aria-label={locale === 'en' ? 'Exit fullscreen' : '退出全屏'}
              >
                {locale === 'en' ? 'Exit fullscreen' : '退出全屏'}
                <span className={`ml-1.5 opacity-55 ${mutedCls}`} style={{ fontSize: fsChrome }}>
                  Esc
                </span>
              </button>
            </div>
            <div className="director-keep-visible flex items-start justify-between gap-2 mb-3 shrink-0">
              <div className="flex-1 min-w-0">{renderPhaseButtons()}</div>
            </div>
            {shotsPanelActive
              ? renderShotsConfirmPanel({
                  includeGenerateBar: false,
                  className: 'flex flex-col flex-1 min-h-0 gap-2',
                  tableScrollClass:
                    'nowheel flex-1 min-h-0 overflow-auto max-h-[calc(100vh-260px)] custom-scrollbar-dark',
                })
              : null}
            {isMvMode && state.phase === 'music' ? (
              <div className="flex flex-col flex-1 min-h-0 overflow-hidden">{renderMvMusicPanel()}</div>
            ) : null}
            {isMvMode && state.phase === 'style' && (
              <div className="mb-3 flex flex-col flex-1 min-h-0 gap-2">
                {renderStylePicker()}
              </div>
            )}
            {isMvMode && state.phase === 'story' && (
              <div className="mb-3 flex flex-col flex-1 min-h-0 overflow-hidden">
                {renderMvStoryPanel()}
              </div>
            )}
            {isDramaMode ? (
              <div className="director-keep-visible mb-3 flex flex-col flex-1 min-h-0 overflow-hidden">
                {renderDramaStudioV2()}
              </div>
            ) : null}
            {isMvMode && state.phase === 'cast' && (
              <div className="flex flex-col flex-1 min-h-0 overflow-visible">{renderMvCastPanel()}</div>
            )}
            {videosPanelActive ? (
              <div
                ref={setVideosPanelHost}
                className="mb-3 flex-1 min-h-0"
              >
                {renderMvVideosPanel({
                  maxHeightClass: 'max-h-[calc(100vh-280px)]',
                  panelActive: true,
                })}
              </div>
            ) : null}
            {karaokePanelActive ? (
              <div className="mb-3 flex flex-col flex-1 min-h-0 h-full overflow-hidden">
                {renderMvKaraokePanel()}
              </div>
            ) : null}
            {/* 旧剧本模式分镜表已下线；短剧/MV 使用上方 shotsPanelActive 确认面板 */}
            {false && (!isMvMode && (state.phase === 'shots' || state.phase === 'prompts')) ? (
              <div className={`overflow-auto max-h-[calc(100vh-280px)] ${scrollCls}`}>                <table className="w-full border-collapse" style={{ fontSize: fsSmall }}>
                  <thead className={`sticky top-0 z-10 ${tableHeadBg}`}>
                    <tr className={mutedCls}>
                      <th className="px-2 py-1.5 text-left">{tt.colShotNo}</th>
                      <th className="px-2 py-1.5 text-left" style={{ width: '132px' }}>
                        {tt.colDesc}
                      </th>
                      {isMvMode ? (
                        <>
                          <th className="px-2 py-1.5 text-left">{tt.scenes}</th>
                          <th className="px-2 py-1.5 text-left">{tt.characters}</th>
                        </>
                      ) : null}
                      {isMvMode ? (
                        <>
                          <th className="px-2 py-1.5 text-left">{tt.colShotAudio}</th>
                          <th className="px-2 py-1.5 text-left">{tt.colStoryboard}</th>
                        </>
                      ) : (
                        <th className="px-2 py-1.5 text-left min-w-[220px]">{tt.colFinalPrompt}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {state.shots.map((shot, rowIndex) => {
                      const shotNo = String(shot['镜号'] || rowIndex + 1);
                      const orderedRefs = orderedAssetsWithImages;
                      const boundIdx = isMvMode
                        ? getShotBoundRefIndices(shot, orderedRefs, rowIndex)
                        : [];
                      const sceneAsset = orderedRefs.find(
                        (a, i) => boundIdx.includes(i) && a?.kind === 'scene',
                      );
                      const castAssets = boundIdx
                        .map((i) => orderedRefs[i])
                        .filter((a) => a?.kind === 'character');
                      const sceneNames = String(sceneAsset?.name || '').trim();
                      const sceneUrl = String(sceneAsset?.imageUrl || '').trim();
                      const sb = isMvMode ? getDirectorShotStoryboard(state, shotNo) : null;
                      const sbUrl = String(sb?.imageUrl || '').trim();
                      const sbGenerating =
                        !!sb &&
                      (sb.status === 'generating' || sbGenInFlightRef.current.has(shotNo));
                      const val = resolveShotFinalPrompt(shot);
                      const audioRangeFs = shotMusicRanges[rowIndex] || {
                        startSec: 0,
                        endSec: parseDirectorShotDurationSec(shot['时长'], 5),
                        durationSec: parseDirectorShotDurationSec(shot['时长'], 5),
                      };
                      const lipsyncFs = isMvMode
                        ? resolveMvShotLipsync(shot, rowIndex, sb, audioRangeFs)
                        : {
                            lipsyncOn: resolveDirectorShotPreferLipsync(shot, sb, {
                              closeUpFramingOn: state.mvCloseUpFraming !== false,
                            }),
                            priority: 'normal' as const,
                            faceFarWarning: !shotDescriptionSuggestsCloseUpFace(shot),
                          };
                      const lipsyncOnFs = lipsyncFs.lipsyncOn;
                      const lipsyncPriorityFs = lipsyncFs.priority;
                      const lipsyncFaceFarFs = !!(lipsyncFs as { faceFarWarning?: boolean })
                        .faceFarWarning;
                      const namedRefCell = (
                        kind: 'scene' | 'character' | 'style',
                        url: string,
                        name: string,
                      ) => {
                        const kindLabel =
                          kind === 'style'
                            ? tt.colStyleRef
                            : kind === 'scene'
                              ? tt.scenes
                              : tt.characters;
                        return (
                          <td className={`px-2 py-1.5 border-t ${cellBorder}`}>
                            <div className="flex items-center gap-1.5 min-w-0">
                              {url ? (
                                <DirectorAspectThumbButton
                                  url={url}
                                  alt={name || kindLabel}
                                  title={`${tt.viewImage}: ${name || kindLabel}`}
                                  onClick={() =>
                                    setImagePreview({ url, name: name || kindLabel })
                                  }
                                />
                              ) : (
                                <DirectorAspectThumbPlaceholder
                                  label={kindLabel}
                                  softPanel={softPanel}
                                  mutedCls={mutedCls}
                                  isDarkMode={isDarkMode}
                                />
                              )}
                            </div>
                          </td>
                        );
                      };
                      const castRefCell = () => {
                        const availableCast = (state.assets.characters || []).filter((a) =>
                          String(a?.imageUrl || '').trim(),
                        );
                        const selectedIds = castAssets
                          .map((a) => String(a?.id || '').trim())
                          .filter(Boolean);
                        const thumbs = castAssets
                          .map((a) => ({
                            id: String(a?.id || '').trim(),
                            url: String(a?.imageUrl || '').trim(),
                            name: String(a?.name || '').trim(),
                          }))
                          .filter((x) => x.url);
                        const pickerOpen = castPickerShotNo === shotNo;
                        return (
                          <td className={`px-2 py-1.5 border-t ${cellBorder}`}>
                            <div className="relative flex items-start gap-1.5 min-w-0">
                              {thumbs.length > 0 ? (
                                <div className="flex items-center gap-1 shrink-0 flex-wrap max-w-[220px]">
                                  {thumbs.map((t) => (
                                    <DirectorAspectThumbButton
                                      key={`${t.url}-${t.name}`}
                                      url={t.url}
                                      alt={t.name || tt.characters}
                                      title={`${tt.viewImage}: ${t.name || tt.characters}`}
                                      maxH={Math.round(REF_THUMB_MAX_H_PX * 0.78)}
                                      maxW={Math.round(REF_THUMB_MAX_W_PX * 0.62)}
                                      onClick={() =>
                                        setImagePreview({
                                          url: t.url,
                                          name: t.name || tt.characters,
                                        })
                                      }
                                    />
                                  ))}
                                  <button
                                    type="button"
                                    className={`nodrag rounded-md px-1.5 py-1 ring-1 ${
                                      isDarkMode
                                        ? 'text-sky-200/90 ring-white/15'
                                        : 'text-sky-700 ring-sky-200'
                                    }`}
                                    onClick={() =>
                                      setCastPickerShotNo(pickerOpen ? null : shotNo)
                                    }
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className={`nodrag inline-flex items-center gap-1 rounded-md px-2 py-1.5 ring-1 ${
                                    isDarkMode
                                      ? 'bg-sky-500/15 text-sky-100 ring-sky-400/40'
                                      : 'bg-sky-50 text-sky-800 ring-sky-300'
                                  }`}
                                  disabled={availableCast.length === 0}
                                  onClick={() =>
                                    availableCast.length &&
                                    setCastPickerShotNo(pickerOpen ? null : shotNo)
                                  }
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  {tt.castAddToShot}
                                </button>
                              )}
                              {pickerOpen && availableCast.length > 0 ? (
                                <div
                                  className={`absolute left-0 top-full z-40 mt-1 min-w-[160px] rounded-lg border p-1.5 shadow-lg ${
                                    isDarkMode
                                      ? 'border-white/15 bg-zinc-950'
                                      : 'border-gray-200 bg-gray-100'
                                  }`}
                                >
                                  {availableCast.map((a) => {
                                    const id = String(a.id || '').trim();
                                    const on = selectedIds.includes(id);
                                    return (
                                      <button
                                        key={id}
                                        type="button"
                                        className={`nodrag w-full flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left ${
                                          on
                                            ? isDarkMode
                                              ? 'bg-sky-500/25'
                                              : 'bg-sky-100'
                                            : ''
                                        }`}
                                        onClick={() => {
                                          const next = on
                                            ? selectedIds.filter((x) => x !== id)
                                            : [...selectedIds, id].slice(0, 2);
                                          applyShotCastAssetIds(shotNo, rowIndex, next);
                                        }}
                                      >
                                        <img
                                          src={String(a.imageUrl || '')}
                                          alt=""
                                          className="w-8 h-10 object-cover rounded"
                                          draggable={false}
                                        />
                                        <span className="truncate flex-1">
                                          {String(a.name || '').trim() || tt.characters}
                                        </span>
                                        {on ? <Check className="w-3.5 h-3.5" /> : null}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          </td>
                        );
                      };
                      return (
                        <tr key={rowIndex} className={rowHover}>
                          <td className={`px-2 py-1.5 border-t ${cellBorder} ${mutedCls}`}>{shot['镜号']}</td>
                          <td
                            className={`px-2 py-1.5 border-t ${cellBorder} ${bodyCls} max-w-[132px]`}
                          >
                            <div className="line-clamp-3 whitespace-pre-wrap break-words">
                              {shot['画面描述'] || '—'}
                            </div>
                          </td>
                          {isMvMode ? (
                            <>
                              {namedRefCell('scene', sceneUrl, sceneNames)}
                              {castRefCell()}
                            </>
                          ) : null}
                          {isMvMode ? (
                            <>
                              <td className={`px-2 py-1.5 border-t ${cellBorder}`}>
                                {renderShotSongClipCell(
                                  audioRangeFs,
                                  shotNo,
                                  'min-w-[340px] w-[340px] max-w-[380px]',
                                )}
                              </td>
                              <td className={`px-2 py-1.5 border-t ${cellBorder}`}>
                                <div className="flex items-center gap-1.5">
                                  <select
                                    className={`nodrag shrink-0 rounded px-1 py-0.5 outline-none max-w-[7.5rem] ${
                                      isDarkMode
                                        ? 'bg-zinc-950 text-zinc-200 ring-1 ring-white/10'
                                        : 'bg-gray-100 text-gray-800 ring-1 ring-gray-200'
                                    }`}
                                    style={{ fontSize: Math.max(10, fsChrome - 1) }}
                                    value={
                                      directorStoryboardImageModels.some(
                                        (m) => m.value === (state.imageModel || ''),
                                      )
                                        ? state.imageModel || DEFAULT_IMAGE_MODEL
                                        : DEFAULT_IMAGE_MODEL
                                    }
                                    disabled={isDirectorHardBusy || sbGenerating}
                                    title={tt.modelLabel}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) =>
                                      patch({
                                        ...directorStateRef.current,
                                        imageModel: e.target.value,
                                      })
                                    }
                                  >
                                    {directorStoryboardImageModels.map((m) => (
                                      <option key={m.value} value={m.value}>
                                        {m.label}
                                      </option>
                                    ))}
                                  </select>
                                  <span className="relative inline-flex shrink-0">
                                    <button
                                      type="button"
                                      className={`nodrag ${btnPrimary('', 'events')} disabled:opacity-50 shrink-0`}
                                      style={{ fontSize: fsChrome }}
                                      disabled={!val || isDirectorHardBusy}
                                      onMouseEnter={() =>
                                        !!val &&
                                        setPriceHoverKey(`sb-fs-${shotNo}`)
                                      }
                                      onMouseLeave={() =>
                                        setPriceHoverKey((k) =>
                                          k === `sb-fs-${shotNo}` ? null : k,
                                        )
                                      }
                                      onClick={() =>
                                        enqueueStoryboardShots([shotNo], { onlyMissing: false })
                                      }
                                    >
                                      {sbGenerating ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                      ) : (
                                        tt.generateThisStoryboard
                                      )}
                                    </button>
                                    {renderYuanbaoHoverTip(`sb-fs-${shotNo}`, 1)}
                                  </span>
                                  <div className="relative shrink-0">
                                    {sbUrl ? (
                                      <DirectorAspectThumbButton
                                        url={sbUrl}
                                        alt={`镜${shotNo}`}
                                        title={
                                          val
                                            ? `${tt.viewPrompt}\n\n${val}`
                                            : `${tt.viewImage}: ${tt.colStoryboard} ${shotNo}`
                                        }
                                        maxH={STORYBOARD_THUMB_PX}
                                        maxW={Math.round(STORYBOARD_THUMB_PX * 1.8)}
                                        onClick={() =>
                                          setImagePreview({ url: sbUrl, name: `镜${shotNo}` })
                                        }
                                        onMouseEnter={() =>
                                          val && setPriceHoverKey(`sb-prompt-fs-${shotNo}`)
                                        }
                                        onMouseLeave={() =>
                                          setPriceHoverKey((k) =>
                                            k === `sb-prompt-fs-${shotNo}` ? null : k,
                                          )
                                        }
                                      />
                                    ) : (
                                      <span
                                        className={mutedCls}
                                        title={val || undefined}
                                        onMouseEnter={() =>
                                          val && setPriceHoverKey(`sb-prompt-fs-${shotNo}`)
                                        }
                                        onMouseLeave={() =>
                                          setPriceHoverKey((k) =>
                                            k === `sb-prompt-fs-${shotNo}` ? null : k,
                                          )
                                        }
                                      >
                                        —
                                      </span>
                                    )}
                                    {priceHoverKey === `sb-prompt-fs-${shotNo}` && val ? (
                                      <div
                                        className={`absolute left-1/2 bottom-full z-40 mb-1 w-64 -translate-x-1/2 rounded-lg border p-2 shadow-xl ${
                                          isDarkMode
                                            ? 'border-white/15 bg-zinc-950 text-white/90'
                                            : 'border-gray-200 bg-gray-100 text-gray-800'
                                        }`}
                                        style={{ fontSize: Math.max(10, fsChrome - 1) }}
                                        onClick={() => {
                                  setPromptPreviewShotNo(null);
                                  setPromptPreview(val);
                                }}
                                      >
                                        <div className={`mb-1 font-medium ${mutedCls}`}>
                                          {tt.colFinalPrompt}
                                        </div>
                                        <div className="whitespace-pre-wrap break-words line-clamp-8 max-h-40 overflow-hidden">
                                          {val}
                                        </div>
                                        <div className={`mt-1 ${linkCls}`}>{tt.viewPrompt}</div>
                                      </div>
                                    ) : null}
                                  </div>
                                  {renderShotLipsyncToggle(
                                    shotNo,
                                    lipsyncOnFs,
                                    lipsyncPriorityFs,
                                    lipsyncFaceFarFs,
                                  )}
                                </div>
                              </td>
                            </>
                          ) : (
                            <td className={`px-2 py-1.5 border-t ${cellBorder}`}>
                              {val ? (
                                <button
                                  type="button"
                                  className={`director-keep-visible nodrag ${linkCls} text-left whitespace-pre-wrap line-clamp-3`}
                                  onClick={() => {
                                  setPromptPreviewShotNo(null);
                                  setPromptPreview(val);
                                }}
                                >
                                  {tt.viewPrompt}
                                </button>
                              ) : (
                                <span className={mutedCls}>{tt.pendingPrompt}</span>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : state.phase === 'assets' && !isDramaMode ? (
              <div className="flex flex-col gap-3 max-h-[calc(100vh-220px)] min-h-0">
                {!isWizardMode ? (
                  <div className="shrink-0 flex items-center gap-1.5 flex-wrap">
                    {(
                      [
                        ['characters', tt.assetsStepCharacters] as const,
                        ['scenes', tt.assetsStepScenes] as const,
                        ['props', tt.assetsStepProps] as const,
                      ] as const
                    ).map(([stepId, label]) => {
                      const active =
                        (state.assetsStep || 'characters') === stepId ||
                        (!state.assetsStep && stepId === 'characters');
                      return (
                        <button
                          key={stepId}
                          type="button"
                          className={`nodrag rounded-full px-2.5 py-1 font-medium transition-colors ${
                            active
                              ? isDarkMode
                                ? 'bg-sky-500/25 text-sky-100 ring-1 ring-sky-400/40'
                                : 'bg-gray-200 text-gray-800 ring-1 ring-gray-400/70'
                              : isDarkMode
                                ? 'text-white/45 hover:bg-white/[0.06]'
                                : 'text-gray-500 hover:bg-gray-100'
                          }`}
                          style={{ fontSize: fsChrome }}
                          onClick={() => patch(setDirectorAssetsStep(state, stepId))}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {(() => {
                  const step: DirectorAssetsStep =
                    state.assetsStep === 'scenes' || state.assetsStep === 'props'
                      ? state.assetsStep
                      : isMvMode
                        ? 'scenes'
                        : 'characters';
                  return (
                    [
                      ['characters', tt.characters, 'character'] as const,
                      ['scenes', tt.scenes, 'scene'] as const,
                      ['props', tt.props, 'prop'] as const,
                    ] as const
                  )
                    .filter(([key]) => key === step)
                    .map(([key, label, kind]) => (
                      <div key={key} className={`flex flex-col min-h-0 flex-1 gap-2 ${sectionShell(kind)}`}>
                        {/* 标题+一键生成放在滚动区外，避免 tip 被 overflow 裁切 */}
                        <div className="shrink-0 relative z-[50] overflow-visible flex items-center justify-between mb-0 gap-2">
                          <div className={`font-semibold ${sectionTitleCls(kind)}`} style={{ fontSize: fsBody }}>
                            {isMvMode && kind === 'scene'
                              ? tt.phaseMvScenes
                              : `${label} (${state.assets[key].length})`}
                          </div>
                          <div className="shrink-0 relative z-[50] overflow-visible flex items-center justify-end gap-2 flex-wrap">
                            {isMvMode && kind === 'scene' ? renderSceneOneClickGenerate() : null}
                            {!isMvMode ? (
                              <>
                                {renderImageGenControls({ compact: true, kind })}
                                <button
                                  type="button"
                                  className={`nodrag flex items-center gap-0.5 ${
                                    isDarkMode ? 'text-white/45 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                                  }`}
                                  style={{ fontSize: fsChrome }}
                                  onClick={() => addAsset(kind)}
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  {tt.addAsset}
                                </button>
                                <button
                                  type="button"
                                  className={`nodrag ${btnPrimary('!px-2 !py-1', sectionScratch(kind))} disabled:opacity-40`}
                                  style={{ fontSize: fsChrome }}
                                  disabled={isDirectorHardBusy || state.assets[key].length === 0}
                                  onClick={() => generateCategory(kind)}
                                >
                                  {tt.generateCategory}
                                </button>
                              </>
                            ) : null}
                          </div>
                        </div>
                        <div className={`nowheel flex-1 min-h-0 overflow-y-auto space-y-2 ${scrollCls}`}>
                          {isMvMode && kind === 'scene' ? (
                            <div className="flex items-center justify-between mb-2 gap-2">
                              <div className={`font-semibold ${sectionTitleCls(kind)}`} style={{ fontSize: fsBody }}>
                                {label} ({state.assets[key].length})
                              </div>
                              <button
                                type="button"
                                className={`nodrag flex items-center gap-0.5 ${
                                  isDarkMode ? 'text-white/45 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                                }`}
                                style={{ fontSize: fsChrome }}
                                onClick={() => addAsset(kind)}
                              >
                                <Plus className="w-3.5 h-3.5" />
                                {tt.addAsset}
                              </button>
                            </div>
                          ) : null}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                            {state.assets[key].map((asset) => renderAssetCard(asset, kind))}
                          </div>
                        </div>
                      </div>
                    ));
                })()}
              </div>
            ) : !isMvMode && state.phase === 'storyboards' ? (
              <div className={`overflow-auto max-h-[calc(100vh-280px)] ${scrollCls}`}>
                <table className="w-full border-collapse" style={{ fontSize: fsSmall }}>
                  <thead className={`sticky top-0 z-10 ${tableHeadBg}`}>
                    <tr className={mutedCls}>
                      <th className="px-2 py-1.5 text-left">{tt.colShotNo}</th>
                      <th className="px-2 py-1.5 text-left">{tt.colDesc}</th>
                      <th className="px-2 py-1.5 text-left">{tt.colStoryboard}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.shots.map((shot, rowIndex) => {
                      const shotNo = String(shot['镜号'] || rowIndex + 1);
                      const sb = getDirectorShotStoryboard(state, shotNo);
                      const sbUrl = String(sb.imageUrl || '').trim();
                      return (
                        <tr key={rowIndex} className={rowHover}>
                          <td className={`px-2 py-1.5 border-t ${cellBorder} ${mutedCls}`}>{shotNo}</td>
                          <td className={`px-2 py-1.5 border-t ${cellBorder} ${bodyCls}`}>
                            {shot['画面描述']}
                          </td>
                          <td className={`px-2 py-1.5 border-t ${cellBorder}`}>
                            {sbUrl ? (
                              <button
                                type="button"
                                className="nodrag w-16 h-16 rounded overflow-hidden ring-1 ring-sky-400/40"
                                onClick={() => setImagePreview({ url: sbUrl, name: `镜${shotNo}` })}
                              >
                                <AssetLibLazyThumb
                                  src={sbUrl}
                                  alt=""
                                  maxEdge={128}
                                  className="w-full h-full"
                                  imgClassName="w-full h-full object-cover pointer-events-none"
                                />
                              </button>
                            ) : sb.status === 'generating' ? (
                              <Loader2 className={`w-4 h-4 animate-spin ${accentSpin}`} />
                            ) : (
                              <span className={mutedCls}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              null
            )}
          </div>
          <div
            className={`shrink-0 flex flex-col gap-2 px-4 py-3 border-t ${
              isDarkMode ? 'border-white/10 bg-black/40' : 'border-gray-200 bg-gray-100'
            }`}
          >
            {state.phase === 'shots' ? renderShotsGenerateBar() : null}
            {primaryFooterNode ? (
              <div className="flex items-center justify-center gap-2">{primaryFooterNode}</div>
            ) : null}
          </div>
        </div>,
        document.body,
      )}
      {karaokeOpen && karaokeSeed && !karaokePanelActive ? (
        <KaraokeSubtitleEditor
          open={karaokeOpen}
          onClose={() => {
            setKaraokeOpen(false);
            setKaraokeSeed(null);
          }}
          projectId={data?.projectId}
          initialProject={karaokeSeed}
          entryLabel={tt.karaokeSubtitles}
          onProjectChange={(p) => {
            const d = dataRef.current as DirectorNodeData | undefined;
            const nextUrl = String(p.videoUrl || '').trim();
            const prevUrl = String(d?.karaokeProject?.videoUrl || karaokeSeed?.videoUrl || '').trim();
            const extra: Partial<DirectorNodeData> = {};
            const source = karaokeVideoSourceRef.current ?? d?.karaokeVideoSource;
            if (
              nextUrl &&
              nextUrl !== prevUrl &&
              source !== 'user' &&
              (nextUrl === String(d?.karaokeComposedVideoUrl || '').trim() || !prevUrl)
            ) {
              extra.karaokeComposedVideoUrl = nextUrl;
              extra.karaokeVideoSource = 'composed';
            }
            persistKaraokeProject(p, extra);
          }}
          resolveVideoUrl={
            data?.onResolveKaraokeMvVideo || composedVideoUrlProp
              ? async () => resolveKaraokeComposedVideoUrl()
              : undefined
          }
          onPickLocalVideo={onPickKaraokeVideoClick}
          onImportComposeVideo={
            data?.onResolveKaraokeMvVideo || composedVideoUrlProp
              ? () => {
                  void importKaraokeFromCompose();
                }
              : undefined
          }
          onClearVideo={clearKaraokeVideo}
          videoSourceBusy={
            busyAction === 'karaoke-upload'
              ? 'upload'
              : busyAction === 'karaoke-import'
                ? 'import'
                : null
          }
          onBurned={(result) => {
            const burnedUrl = String(result.originalUrl || '').trim();
            const add = data?.onAddVideoClipNodes;
            data?.onUpdate?.({
              karaokeProject: result.karaokeProject,
              karaokeBurnedVideoUrl: burnedUrl || undefined,
            } as Partial<DirectorNodeData>);
            if (!add) {
              showAlert(result.originalUrl);
              return;
            }
            const newId = `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const w = 420;
            const h = 236;
            const storeState = store.getState();
            const self = storeState.nodeInternals.get(id);
            const originX = (self?.positionAbsolute?.x ?? self?.position?.x ?? 0) + (self?.width ?? sizeW) + 48;
            const originY = self?.positionAbsolute?.y ?? self?.position?.y ?? 0;
            add({
              nodes: [
                {
                  id: newId,
                  type: 'video',
                  position: { x: originX, y: originY },
                  data: {
                    width: w,
                    height: h,
                    label: tt.karaokeSubtitles,
                    title: tt.karaokeSubtitles,
                    outputVideo: result.originalUrl,
                    localPath: result.originalPath,
                    preserveExportLayout: true,
                    exportedMediaClip: true,
                    karaokeProject: result.karaokeProject,
                    videoAsset: {
                      poster: result.posterUrl,
                      width: result.width,
                      height: result.height,
                    },
                  },
                  style: { width: w, height: h },
                  selected: true,
                },
              ],
              edges: [
                {
                  id: `e-${id}-${newId}-karaoke`,
                  source: id,
                  sourceHandle: 'output',
                  target: newId,
                  targetHandle: 'input',
                },
              ],
            });
          }}
        />
      ) : null}
      {typeof document !== 'undefined'
        ? createPortal(
            <input
              ref={karaokeVideoUploadInputRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                e.target.value = '';
                void onUploadKaraokeVideoFile(f);
              }}
            />,
            document.body,
          )
        : null}
    </div>
  );
};

export default memo(DirectorNode);
