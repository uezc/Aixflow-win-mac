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
} from 'lucide-react';
import { useAI } from '../../hooks/useAI';
import { useCloudRealtimeDictation } from '../../hooks/useCloudRealtimeDictation';
import { useDictationPushToTalk } from '../../hooks/useDictationPushToTalk';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import { directorPipelineT, fillDirectorI18n } from '../../i18n/directorPipelineI18n';
import { workspaceChromeT } from '../../i18n/workspaceI18n';
import { micLevelCssVars } from '../../utils/micInputLevel';
import { ModuleProgressBar } from './ModuleProgressBar';
import VoiceMicGlyph from './VoiceMicGlyph';
import { useCanvasTheme } from '../../contexts/CanvasThemeContext';
import { useNxModelPricing } from '../../contexts/NxModelPricingContext';
import {
  LLM_CHAT_DISPLAY_MODEL_ID,
  LLM_CHAT_MODEL_GPT56_TERRA,
  LLM_CHAT_MODEL_IDS,
  LLM_CHAT_MODEL_LABELS,
} from '../../utils/cloudModelPricing';
import { getImageDisplayPrice, getLlmChatDisplayPrice, getFileTranscribeDisplayPrice, getVideoDisplayPrice } from '../../utils/cloudModelPricing';
import { isModelNotPricedError } from '../../utils/priceCalc';
import {
  ACTIVE_IMAGE_MODELS,
  DEFAULT_IMAGE_MODEL,
  filterImageModelsForMode,
  normalizeImageModelIfRetired,
} from '../../config/imageModelUiPolicy';
import { HIDE_DIRECTOR_SCRIPT_MODE_UI } from '../../config/directorUiPolicy';
import {
  assetLibBtnPrimary,
  assetLibBtnSecondary,
  nodeFloatToolBtn,
} from '../../utils/assetLibraryChrome';
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
  buildDirectorMvScriptMessages,
  buildDirectorPromptsMessages,
  buildDirectorShotsMessages,
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
  flattenDirectorAssets,
  findDirectorAssetById,
  getDirectorMvCharactersSectionText,
  getDirectorMvScenesSectionText,
  getOrderedAssetsWithImages,
  getDirectorShotStoryboard,
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
  coerceAssistantText,
  normalizeDirectorMvScriptSections,
  parseDirectorMvCharacterEntries,
  parseDirectorMvSceneEntries,
  parseDirectorMvScriptSectionsFromText,
  syncDirectorMvCastFromScript,
  syncDirectorMvScenesFromScript,
  ensureDirectorMvLeadSlots,
  normalizeDirectorMvCastPlan,
  setDirectorPhase,
  setDirectorMode,
  patchDirectorMvMusic,
  patchDirectorMvStoryAnalysis,
  patchDirectorMvScriptInput,
  setDirectorMvCloseUpFraming,
  patchDirectorMvCastPlan,
  setDirectorMvAspectRatio,
  setDirectorAssetsStep,
  setSelectedDirectorAssetIds,
  updateDirectorAsset,
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
  directorStyleLooksMonochrome,
  DIRECTOR_MONOCHROME_STYLE_LOCK_GUARD,
  shouldAutoSyncDirectorFinalPrompt,
  buildDirectorReviseFinalPromptMessages,
  parseDirectorRevisedFinalPrompt,
  buildDirectorSceneImagePrompt,
  buildDirectorCharacterImagePrompt,
  buildDirectorPropImagePrompt,
  directorAssetAspectRatio,
  ensureDirectorSceneBuiltinPrompt,
  rebindDirectorPipelineAssetRefs,
  applyDirectorShotAssetBindingIndices,
  matchDirectorAssetIndicesForShot,
  matchDirectorShotsAssetIndices,
  inferDirectorAssetGender,
  shotSuggestsNoCharacterRefs,
  parseDirectorMvPlotBeatTable,
  formatDirectorMvPlotBeatTable,
  countDirectorMvPlotBeatsWithCast,
  applyDirectorMvPlotBeatsToShots,
  getDirectorMvPlotBeatsFromState,
  alignDirectorMvPlotBeatsToCount,
  alignDirectorMvScriptSectionsToClipCount,
  resolveDirectorMvAudioClipCount,
  type DirectorAsset,
  type DirectorAssetKind,
  type DirectorAssetsStep,
  type DirectorMode,
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
  DIRECTOR_VIDEO_BATCH_MODELS,
  DIRECTOR_VIDEO_LIPSYNC_MODELS,
  DIRECTOR_VIDEO_LIPSYNC_MODEL,
  buildDirectorVideoPriceParams,
  directorVideoBatchModelLabel,
  getDirectorVideoBatchAspectOptions,
  getDirectorVideoBatchDurationOptions,
  getDirectorVideoBatchResolutionDisplay,
  getDirectorVideoBatchResolutionOptions,
  isDirectorLipsyncModel,
  normalizeDirectorVideoBatchAspect,
  normalizeDirectorVideoBatchDuration,
  normalizeDirectorVideoBatchModel,
  normalizeDirectorVideoBatchResolution,
  normalizeDirectorVideoLipsyncModel,
  pickNearestDirectorVideoBatchDuration,
} from '../../utils/directorVideoBatch';
import { audioDisplayTitleFromFileName } from '../../utils/audioSongModels';
import { toElectronVideoElementSrc } from '../../utils/normalizeVideoUrl';
import { ReferenceAudioWaveStrip } from './ReferenceAudioWaveStrip';
import { MusicPlayer } from '../Workspace/MusicPlayer';
import { scaleModulePx } from '../../utils/moduleDisplayScale';
import { PanelOptionDropdown } from './PanelOptionDropdown';
import {
  DirectorShotTableVirtual,
  DirectorTableVirtualPad,
  DIRECTOR_MV_SHOT_ROW_ESTIMATE_PX,
  DIRECTOR_MV_VIDEO_ROW_ESTIMATE_PX,
  type DirectorShotTableVirtualHandle,
} from './DirectorShotTableVirtual';

const SHOT_ROW_LONG_PRESS_MS = 480;
const SHOT_ROW_DRAG_THRESHOLD_PX = 8;

/** 导演对话下拉：与 LLM 聊天共用目录（含 GPT-5.6 Terra） */
const DIRECTOR_CHAT_MODELS = LLM_CHAT_MODEL_IDS;
const DIRECTOR_CHAT_MODEL_OPTIONS = DIRECTOR_CHAT_MODELS.map((m) => ({
  value: m,
  label: LLM_CHAT_MODEL_LABELS[m] || m,
}));
const DIRECTOR_CHAT_MODEL_DEFAULT =
  (DIRECTOR_CHAT_MODELS as readonly string[]).includes('gpt-4o')
    ? 'gpt-4o'
    : LLM_CHAT_DISPLAY_MODEL_ID;

export interface DirectorNodeData {
  director?: DirectorPipelineState;
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
  onUpdate?: (d: Partial<DirectorNodeData>) => void;
  onSpawnVideos?: (opts?: {
    shotNos?: string[];
    startLipsync?: boolean;
    /** 确认清单中材料齐全、须强制走对口型的镜号 */
    lipsyncShotNos?: string[];
  }) => void;
  onPreviewToSplice?: () => void;
  /** 剪辑预览：已生成视频 + 原曲入轨 */
  onVideosToSplice?: () => void;
  onConfirmGenVideos?: () => void;
  onExportMv?: () => void;
  /** 从画布点选图片 URL（参考图） */
  onPickImageFromCanvas?: () => Promise<string | null>;
  /** 从画布点选视频 URL（成片） */
  onPickVideoFromCanvas?: () => Promise<string | null>;
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
const DIRECTOR_FONT_MAX = 28;
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
  return `local-resource://${filePath}`;
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
  if (!Number.isFinite(x)) return DIRECTOR_FONT_MAX;
  return Math.min(DIRECTOR_FONT_MAX, Math.max(DIRECTOR_FONT_MIN, Math.round(x)));
}

const SHOT_COLS: { key: DirectorShotColumnKey; width: string }[] = [
  { key: '镜号', width: '52px' },
  { key: '时长', width: '64px' },
  { key: '画面描述', width: '220px' },
  { key: '镜头角度', width: '72px' },
  { key: '焦距', width: '64px' },
  { key: '景别', width: '72px' },
  { key: '光影氛围', width: '120px' },
  { key: '运镜', width: '100px' },
  { key: '最终提示词', width: '120px' },
];

/** 分镜图缩略图基准高度（原比例 contain，非强制 1:1） */
const STORYBOARD_THUMB_PX = 84;
/** 确认镜头表：缩略图铺满单元格 */
const SHOTS_CONFIRM_THUMB_SCALE = 1.35;
const SHOTS_CONFIRM_SB_THUMB_PX = Math.round(STORYBOARD_THUMB_PX * 1.45);
/** 确认镜头：场景/角色单元格高度 */
const SHOTS_CONFIRM_REF_CELL_H = 72;
/** 确认镜头表：歌曲波形默认宽度（窗口模式） */
const SHOTS_CONFIRM_AUDIO_WIDTH_CLS = 'w-full min-w-0';
/** 大表行：跳过视口外布局/绘制（Electron Chromium） */
const DIRECTOR_MV_TABLE_ROW_CV: React.CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 120px',
};
/** 确认镜头：风格/场景/角色参考图 */
const REF_THUMB_MAX_H_PX = 108;
const REF_THUMB_MAX_W_PX = 160;

/** 将图片比例吸附到常见画幅（场景固定 16:9；角色/分镜常用 16:9 / 1:1 / 9:16） */
function snapConfirmFrameRatio(
  naturalW: number,
  naturalH: number,
  mode: 'scene' | 'cast' | 'storyboard',
): number {
  if (mode === 'scene') return 16 / 9;
  const r = naturalW / Math.max(1, naturalH);
  const candidates = [16 / 9, 1, 9 / 16];
  let best = candidates[0];
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = Math.abs(Math.log(r / c));
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/**
 * 定高限宽 + object-contain。
 * frame：圆角比例框——scene 固定 16:9；cast/storyboard 按图片吸附 16:9 / 1:1 / 9:16。
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
  const [ratio, setRatio] = React.useState(() =>
    frame === 'scene' ? 16 / 9 : frame === 'cast' ? 9 / 16 : frame === 'storyboard' ? 16 / 9 : 1,
  );

  React.useEffect(() => {
    if (!frame || frame === 'scene' || !url) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      setRatio(snapConfirmFrameRatio(img.naturalWidth, img.naturalHeight, frame));
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [url, frame]);

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
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-contain pointer-events-none"
          draggable={false}
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
      <img
        src={url}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={
          fill
            ? 'max-h-full max-w-full w-auto h-auto object-contain pointer-events-none'
            : 'h-full w-auto max-w-full object-contain pointer-events-none'
        }
        draggable={false}
      />
    </button>
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

function countReadyInList(list: DirectorAsset[]): number {
  return (list || []).filter((a) => String(a.imageUrl || '').trim()).length;
}

const DirectorNode: React.FC<NodeProps<DirectorNodeData>> = ({ id, data, selected }) => {
  const { locale } = useAppLocale();
  const tt = useMemo(() => directorPipelineT(locale), [locale]);
  const wc = useMemo(() => workspaceChromeT(locale), [locale]);
  const { showConfirm, showAlert } = useDarkAlert();
  const { isDarkMode } = useCanvasTheme();
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
  const [fontSizePx, setFontSizePx] = useState(() => clampDirectorFontPx(data?.fontSizePx ?? DIRECTOR_FONT_MAX));
  const [isNodeFullscreen, setIsNodeFullscreen] = useState(false);
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

  const state = useMemo(
    () => createDefaultDirectorPipelineState(data?.director || {}),
    [data?.director],
  );
  const isMvMode = state.mode === 'mv';
  const directorStateRef = useRef(state);
  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(() => {
    directorStateRef.current = state;
  }, [state]);

  /** 「剧本」模式页未完成：隐藏入口并强制切到 MV */
  useEffect(() => {
    if (!HIDE_DIRECTOR_SCRIPT_MODE_UI) return;
    if (directorStateRef.current.mode === 'mv') return;
    const next = setDirectorMode(directorStateRef.current, 'mv');
    dataRef.current?.onUpdate?.({
      director: next,
      title: next.title || dataRef.current?.title,
    });
  }, [state.mode]);

  const [editing, setEditing] = useState<{ row: number; col: DirectorShotColumnKey } | null>(null);
  /** 分镜/视频步：最终提示词编辑态草稿与 AI 调整意见 */
  const [finalPromptDraft, setFinalPromptDraft] = useState('');
  const [finalPromptOpinion, setFinalPromptOpinion] = useState('');
  const finalPromptOpinionRef = useRef('');
  finalPromptOpinionRef.current = finalPromptOpinion;
  const finalPromptDraftRef = useRef('');
  finalPromptDraftRef.current = finalPromptDraft;
  const finalPromptEditRowRef = useRef<number | null>(null);
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
    (window as Window & { __nexflowVoiceModalOpen?: boolean }).__nexflowVoiceModalOpen = open;
    return () => {
      (window as Window & { __nexflowVoiceModalOpen?: boolean }).__nexflowVoiceModalOpen = false;
    };
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
  const sbUploadShotNoRef = useRef<string | null>(null);
  const sbUploadInputRef = useRef<HTMLInputElement | null>(null);
  const videoUploadShotNoRef = useRef<string | null>(null);
  const videoUploadInputRef = useRef<HTMLInputElement | null>(null);
  /** 成片预览：默认静音，按镜号记录取消静音 */
  const [shotVideoUnmuted, setShotVideoUnmuted] = useState<Record<string, boolean>>({});
  const [sourceMenuAssetId, setSourceMenuAssetId] = useState<string | null>(null);
  const sourceMenuRef = useRef<HTMLDivElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const musicAudioInputRef = useRef<HTMLInputElement | null>(null);
  /** 风格库 Tab：系统风格 / 我的风格 */
  const [styleLibraryTab, setStyleLibraryTab] = useState<'system' | 'mine'>('system');
  /**
   * 分镜/视频大表：仅当前阶段挂载重内容。
   * 旧「保活 hidden」会在切换后同时挂两张全表（缩略图+波形+video），镜头一多主线程卡死；
   * 卸载非活动表换来的 remount 成本远小于双表常驻。
   */
  const shotsPanelActive = isMvMode && state.phase === 'shots';
  const videosPanelActive = isMvMode && state.phase === 'videos';
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
  /** 场景批量时尽量同时开跑；单卡/角色等默认 6 路 */
  const imageGenMaxParallelRef = useRef(6);
  const IMAGE_GEN_MAX_PARALLEL_DEFAULT = 6;
  const IMAGE_GEN_MAX_PARALLEL_SCENE_BATCH = 12;
  const sbGenQueueRef = useRef<string[]>([]);
  /** 正在请求中的镜号（可多路并行） */
  const sbGenInFlightRef = useRef<Set<string>>(new Set());
  const runNextSbGenRef = useRef<(() => Promise<void>) | null>(null);
  const SB_GEN_MAX_PARALLEL = 6;
  /** 稳定 patch：勿依赖整个 data，否则连线灌入 mvMusic 后 patch 重建会触发 effect 用旧状态回写把音乐清掉 */
  const patch = useCallback((next: DirectorPipelineState) => {
    directorStateRef.current = next;
    dataRef.current?.onUpdate?.({
      director: next,
      title: next.title,
      isGenerating: next.isGenerating,
      error: next.error || undefined,
    });
  }, []);
  const patchRef = useRef(patch);
  patchRef.current = patch;

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
    const cur = directorStateRef.current;
    if (String(cur.shots[row]?.['最终提示词'] || '') === value) return;
    patch(updateDirectorShotCell(cur, row, '最终提示词', value));
  }, [clearFinalPromptPersistTimer, patch]);

  const scheduleFinalPromptPersist = useCallback(
    (rowIndex: number, value: string) => {
      finalPromptDraftRef.current = value;
      finalPromptEditRowRef.current = rowIndex;
      clearFinalPromptPersistTimer();
      finalPromptPersistTimerRef.current = setTimeout(() => {
        finalPromptPersistTimerRef.current = null;
        const cur = directorStateRef.current;
        if (String(cur.shots[rowIndex]?.['最终提示词'] || '') === value) return;
        patch(updateDirectorShotCell(cur, rowIndex, '最终提示词', value));
      }, 300);
    },
    [clearFinalPromptPersistTimer, patch],
  );

  const openFinalPromptEdit = useCallback(
    (rowIndex: number, prompt: string) => {
      clearFinalPromptPersistTimer();
      finalPromptDraftRef.current = prompt;
      finalPromptEditRowRef.current = rowIndex;
      setFinalPromptDraft(prompt);
      setFinalPromptOpinion('');
      setEditing({ row: rowIndex, col: '最终提示词' });
    },
    [clearFinalPromptPersistTimer],
  );

  const closeFinalPromptEdit = useCallback(() => {
    if (busyAction === 'revise-final-prompt') return;
    flushFinalPromptDraft();
    cancelFinalPromptOpinionDictation();
    finalPromptEditRowRef.current = null;
    setEditing(null);
    setFinalPromptOpinion('');
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
    if (!castPickerShotNo && !scenePickerShotNo && !sbSourceMenuShotNo) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('[data-director-picker-keep]')) return;
      setCastPickerShotNo(null);
      setScenePickerShotNo(null);
      setSbSourceMenuShotNo(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [castPickerShotNo, scenePickerShotNo, sbSourceMenuShotNo]);

  // 已有镜头表若最终提示词为空/占位，按画面描述+景别+光影+对白+音效+运镜回填
  useEffect(() => {
    const style = resolveDirectorStylePrompt(state.stylePresetId, state.globalStyle);
    const nextShots = withComposedDirectorFinalPrompts(state.shots, style, false);
    const changed = nextShots.some(
      (s, i) => String(s['最终提示词'] || '') !== String(state.shots[i]?.['最终提示词'] || ''),
    );
    if (!changed) return;
    patchRef.current({
      ...directorStateRef.current,
      shots: nextShots,
    });
  }, [state.shots, state.stylePresetId, state.globalStyle]);

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
      const raw = String(shot['最终提示词'] || '').trim();
      if (!shouldAutoSyncDirectorFinalPrompt(raw)) return raw;
      return composeDirectorShotFinalPrompt(shot, stylePrompt) || raw;
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
    return matchDirectorShotsAssetIndices(state.shots, refs, { hasHumanVoiceByShot });
  }, [
    isMvMode,
    state.shots,
    state.assets,
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
        const matched = matchDirectorAssetIndicesForShot(shot, refs);
        const val = resolveShotFinalPrompt(shot);
        const fromMentions = extractSeedanceImageMentionIndices(val)
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
      if (Array.isArray(castIds)) {
        const castNames = castIds
          .map((id) => {
            const a = refs.find((r) => String(r?.id || '') === id && r?.kind === 'character');
            return String(a?.name || '').trim();
          })
          .filter(Boolean);
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
      };
      const stylePrompt = resolveDirectorStylePrompt(latest.stylePresetId, latest.globalStyle);
      const prevPrompt = String(shot['最终提示词'] || '').trim();
      // 用户已改过最终提示词：只更新 @图片 绑定，不再用风格/机位等整段重拼
      const basePrompt = !shouldAutoSyncDirectorFinalPrompt(prevPrompt)
        ? prevPrompt
        : composeDirectorShotFinalPrompt(patchedShot, stylePrompt) ||
          resolveShotFinalPrompt(patchedShot);
      const nextPrompt = applyDirectorShotAssetBindingIndices(
        basePrompt,
        patchedShot,
        refs,
        indices,
      );

      let next = updateDirectorShotStoryboard(latest, shotNo, {
        ...(overrides.castAssetIds !== undefined ? { castAssetIds: castIds || [] } : {}),
        ...(overrides.sceneAssetIds !== undefined ? { sceneAssetIds: sceneIds || [] } : {}),
      });
      const prevDesc = String(shot['画面描述'] || '').trim();
      if (nextPrompt !== prevPrompt || nextDesc !== prevDesc) {
        next = {
          ...next,
          shots: next.shots.map((s, i) =>
            i === rowIndex
              ? {
                  ...s,
                  画面描述: nextDesc,
                  最终提示词: nextPrompt,
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
  useEffect(() => {
    if (!isMvMode || state.phase !== 'cast') return;
    const latest = directorStateRef.current;
    const next = ensureDirectorMvLeadSlots(latest);
    const before = latest.assets.characters || [];
    const after = next.assets.characters || [];
    const changed =
      before.length !== after.length ||
      before.some(
        (a, i) =>
          String(a?.name || '') !== String(after[i]?.name || '') ||
          String(a?.prompt || '') !== String(after[i]?.prompt || '') ||
          String(a?.gender || '') !== String(after[i]?.gender || ''),
      );
    if (changed) patch(next);
  }, [isMvMode, state.phase, state.mvCastPlan, state.assets.characters, patch]);

  // MV：确认镜头步若画面/景别/运镜为空，或与剧情表男女/空镜对不上，用步骤四回填
  // 手动添加的全空行不参与判定、不被灌描述（用户要手填）
  const plotBeatSyncKeyRef = useRef('');
  useEffect(() => {
    if (!isMvMode || state.phase !== 'shots') return;
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
    shots = withComposedDirectorFinalPrompts(shots, style, true);
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
    isMvMode,
    state.phase,
    state.shots,
    state.mvStoryAnalysis?.sections?.plot,
    state.scriptText,
    patch,
  ]);

  // MV：剧情表明细列错位时自动纠偏并写回（场景/角色/角度串列）；行数与音频片段不一致时强制对齐
  const plotHealKeyRef = useRef('');
  useEffect(() => {
    if (!isMvMode) return;
    if (state.phase !== 'story' && state.phase !== 'shots' && state.phase !== 'videos') return;
    const latest = directorStateRef.current;
    const plotBeats = getDirectorMvPlotBeatsFromState(latest);
    if (!plotBeats?.length) return;
    const clipCount = resolveDirectorMvAudioClipCount(latest);
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

  // MV：补齐未写入画面描述的场景名，并按「有人声？+提示词」匹配写入角色/场景绑定
  useEffect(() => {
    if (!isMvMode || state.phase !== 'shots') return;
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
    const indexLists = matchDirectorShotsAssetIndices(shots, refs, { hasHumanVoiceByShot });
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
      const next = applyDirectorShotAssetBindingIndices(prompt, shot, refs, indices);
      if (next === prompt) return shot;
      bindChanged = true;
      return { ...shot, 最终提示词: next };
    });
    if (!descChanged && !bindChanged) return;
    patch({ ...latest, shots });
  }, [isMvMode, state.phase, state.shots, state.assets, state.mvMusic, patch]);

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
      const lock169 = isMvMode && !isNodeFullscreen;

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

  // 同步 React Flow 节点宽高，避免蓝色选框尺寸/位置错位
  useLayoutEffect(() => {
    data?.onUpdate?.({ width: sizeW, height: sizeH });
    updateNodeInternals(id);
    // 仅在尺寸变化时同步；勿依赖 data（避免 onUpdate 循环）
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [id, sizeW, sizeH, updateNodeInternals]);

  useEffect(() => {
    if (!isNodeFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setIsNodeFullscreen(false);
    };
    // capture：先于 Workspace 的 Esc「确认退出应用」，避免全屏时被抢走
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isNodeFullscreen]);

  useEffect(() => {
    setDirectorFullscreenNodeId(isNodeFullscreen ? id : null);
    return () => setDirectorFullscreenNodeId(null);
  }, [isNodeFullscreen, id]);

  const pauseShotThumbVideos = useCallback(() => {
    const root = nodeRef.current;
    if (!root) return;
    root.querySelectorAll('video').forEach((el) => {
      if (!(el instanceof HTMLVideoElement)) return;
      if (el === videoPreviewElRef.current) return;
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
  const cellBorder = isDarkMode ? 'border-white/18' : 'border-black/12';
  const accentSpin = isDarkMode ? 'text-sky-300' : 'text-gray-700';
  const fsChrome = Math.max(11, Math.round(fontSizePx * 0.72));
  const fsBody = fontSizePx;
  const fsSmall = Math.max(11, Math.round(fontSizePx * 0.78));

  /** 炫彩模式：按钮仍用 Looks Scratch；明亮模块底色已改为浅灰（见 index.css） */
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
      try {
        return getImageDisplayPrice(
          {
            model: state.imageModel || DEFAULT_IMAGE_MODEL,
            resolution: normalizeDirectorImageResolution(state.imageResolution),
            quantity: Math.max(1, quantity),
          },
          cloudMap,
        );
      } catch (e) {
        if (isModelNotPricedError(e)) return null;
        return null;
      }
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
    }): {
      yuanbao: number;
      label: string;
      model: string;
      modelLabel: string;
      duration: string;
      clarity: string;
    } | null => {
      try {
        const model = opts.preferLipsync
          ? normalizeDirectorVideoLipsyncModel(state.videoBatchLipsyncModel)
          : normalizeDirectorVideoBatchModel(state.videoBatchModel);
        const clipSec =
          opts.durationSec && opts.durationSec > 0 ? opts.durationSec : 10;
        // 对口型成片时长跟歌曲片段；展示用真实片段秒数，不计费档位秒数
        const duration = opts.preferLipsync
          ? String(Math.max(1, Math.round(clipSec)))
          : pickNearestDirectorVideoBatchDuration(model, clipSec);
        const resolution = normalizeDirectorVideoBatchResolution(
          model,
          opts.preferLipsync
            ? state.videoBatchLipsyncResolution
            : state.videoBatchResolution,
        );
        const params = buildDirectorVideoPriceParams({
          model,
          duration: opts.preferLipsync
            ? pickNearestDirectorVideoBatchDuration(model, clipSec)
            : duration,
          resolution,
        });
        const y = getVideoDisplayPrice(params, cloudMap);
        if (!Number.isFinite(y) || y <= 0) return null;
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

  const chatRunYuanbao = useMemo(() => {
    try {
      const y = getLlmChatDisplayPrice(cloudMap, 1, chatModelForPrice);
      return Number.isFinite(y) && y > 0 ? y : 1;
    } catch {
      return 1;
    }
  }, [cloudMap, chatModelForPrice]);

  /** 云端 fun-asr 文件转写按次价（与 FC /asr/file-transcribe 扣费对齐） */
  const fileTranscribeYuanbao = useMemo(() => {
    try {
      const y = getFileTranscribeDisplayPrice(cloudMap, 1);
      return Number.isFinite(y) && y > 0 ? y : 5;
    } catch {
      return 5;
    }
  }, [cloudMap]);

  /** 歌曲分析：LLM 风格分析 + 云端转写（展示与实扣合计） */
  const musicAnalyzeYuanbao = useMemo(
    () => chatRunYuanbao + fileTranscribeYuanbao,
    [chatRunYuanbao, fileTranscribeYuanbao],
  );

  const formatChatYuanbaoLabel = useCallback(() => {
    return locale === 'en' ? `${chatRunYuanbao} ${tt.creditsSuffix}` : `${chatRunYuanbao}${tt.creditsSuffix}`;
  }, [chatRunYuanbao, locale, tt.creditsSuffix]);

  const formatMusicAnalyzeYuanbaoLabel = useCallback(() => {
    return locale === 'en'
      ? `${musicAnalyzeYuanbao} ${tt.creditsSuffix}`
      : `${musicAnalyzeYuanbao}${tt.creditsSuffix}`;
  }, [locale, musicAnalyzeYuanbao, tt.creditsSuffix]);

  const formatFileTranscribeYuanbaoLabel = useCallback(() => {
    return locale === 'en'
      ? `${fileTranscribeYuanbao} ${tt.creditsSuffix}`
      : `${fileTranscribeYuanbao}${tt.creditsSuffix}`;
  }, [fileTranscribeYuanbao, locale, tt.creditsSuffix]);

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
      const preferLipsync = resolveDirectorShotPreferLipsync(shot, sb, {
        hasHumanVoice: hasVoice,
        packText: packs[i]?.text || String(shot['对白旁白'] || ''),
        audioStartSec: range.startSec,
        songDurationSec: songDur,
        closeUpFramingOn: state.mvCloseUpFraming !== false,
      });
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
  ) => (
    <button
      type="button"
      className={`nodrag shrink-0 rounded-md px-1.5 py-0.5 ring-1 transition-colors whitespace-nowrap font-medium ${
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
      }`}
      style={{ fontSize: Math.max(10, fsChrome - 1) }}
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
        const latest = directorStateRef.current;
        const nextOn = !lipsyncOn;
        if (nextOn && faceFarWarning) {
          const ok = window.confirm(tt.lipsyncShotBadgeFarWarning);
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
          const videoPrompt = composeDirectorShotVideoPrompt(shot, { lipsync: nextOn });
          if (videoPrompt) {
            next = {
              ...next,
              shots: next.shots.map((s, i) =>
                i === rowIndex ? { ...s, 最终提示词: videoPrompt } : s,
              ),
            };
          }
        }
        patch(next);
      }}
    >
      {tt.lipsyncToggleLabel}
    </button>
  );

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
    const disabled =
      opts?.disabled ??
      !!(busyAction || state.isGenerating || data?.isGenerating || isDirectorHardBusy);
    const variant = opts?.variant ?? 'chip';
    const dropdown = (
      <div
        className={`nodrag nopan shrink-0 ${disabled ? 'pointer-events-none opacity-50' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <PanelOptionDropdown
          value={chatModelForPrice}
          options={DIRECTOR_CHAT_MODEL_OPTIONS}
          onChange={(v) =>
            patch({
              ...directorStateRef.current,
              chatModel: v,
            })
          }
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

  const renderImageResolutionSelect = (opts?: { compact?: boolean }) => {
    const res = normalizeDirectorImageResolution(state.imageResolution);
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
        {(['1K', '2K', '4K'] as const).map((r) => (
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
  }) => {
    const filter = directorAssetModelFilter(opts?.kind);
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
        {renderImageResolutionSelect({ compact: opts?.compact })}
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
  const videoBatchLipsyncModel = normalizeDirectorVideoLipsyncModel(state.videoBatchLipsyncModel);
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
          <span className={isDarkMode ? 'text-white/45' : 'text-gray-500'} style={{ fontSize: fsSmall }}>
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
        typeof sb?.preferLipsync === 'boolean' ? sb.preferLipsync : evalLs.recommend;
      return {
        hasVoice,
        lipsyncOn,
        priority: evalLs.priority as 'none' | 'normal' | 'climax',
        // 手动开启时：镜本身非特写级则警告（近景开关不能保证旧镜已是特写）
        faceFarWarning: !shotDescriptionSuggestsCloseUpFace(shot),
      };
    },
    [
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

  const renderPreviewToSpliceButton = (opts?: { fontSize?: number }) => {
    const canPreviewStills = storyboardsProg.ready > 0;
    const fs = opts?.fontSize ?? fsChrome;
    return (
      <button
        type="button"
        className="nodrag inline-flex items-center justify-center gap-1 rounded-full border-0 !px-2.5 !py-1 !h-auto font-medium text-white shadow-[0_6px_18px_rgba(249,115,22,0.45)] transition-[filter,opacity] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          fontSize: fs,
          background: 'linear-gradient(to right, #ea580c, #f97316)',
        }}
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
      <div
        className={`relative z-[50] overflow-visible shrink-0 rounded-lg border px-2.5 py-2 flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5 ${
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
  }) => {
    if (state.phase !== 'shots') return null;
    const includeGenerateBar = opts?.includeGenerateBar !== false;
    const wrapCls = opts?.className || 'flex flex-col flex-1 min-h-0 gap-1';
    const tableWrapCls =
      opts?.tableScrollClass ||
      'nowheel flex-1 min-h-0 overflow-auto custom-scrollbar-dark';
    const shotTableColSpan = isMvMode ? 9 : SHOT_COLS.length;
    return (
      <div className={wrapCls}>
            {isMvMode ? renderMvShotsConfirmSummary() : null}
        <DirectorShotTableVirtual
          ref={shotTableVirtualRef}
          count={state.shots.length}
          estimateSize={DIRECTOR_MV_SHOT_ROW_ESTIMATE_PX}
          getItemKey={(i) => String(state.shots[i]?.['镜号'] ?? i)}
          className={tableWrapCls}
        >
          {({ virtualItems, paddingTop, paddingBottom, measureElement }) => (
              <table className="w-full table-fixed border-collapse" style={{ fontSize: fsSmall }}>
                <thead className={`sticky top-0 z-10 backdrop-blur-sm ${tableHeadBg}`}>
                  <tr className={`border-b ${cellBorder} ${mutedCls}`}>
                    {(isMvMode
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
                      : SHOT_COLS
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
                      const isDesc = key === '画面描述';
                      const val = isFinal ? finalVal : shot[key] || '';
                      const isEdit = editing?.row === rowIndex && editing?.col === key;
                      return (
                        <td
                          key={key}
                          className={`px-1.5 py-1.5 border-t ${cellBorder} ${
                            isDesc ? 'align-middle text-left' : 'align-top'
                          }`}
                        >
                          {isFinal ? (
                            val ? (
                              <button
                                type="button"
                                className={`director-keep-visible nodrag ${linkCls}`}
                                onClick={() => setPromptPreview(val)}
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
                                isDesc ? 'text-left line-clamp-4' : 'line-clamp-6'
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
                    if (!isMvMode) {
                      return (
                        <tr
                          key={rowIndex}
                          ref={measureElement}
                          data-index={rowIndex}
                          className={rowHover}
                        >
                          {SHOT_COLS.map((c) => renderShotCell(c.key))}
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
                        className={`${rowHover} border-b ${cellBorder} ${
                          shotFocusRowIndex === rowIndex
                            ? isDarkMode
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
                        style={DIRECTOR_MV_TABLE_ROW_CV}
                        onPointerDown={(e) => onShotRowPointerDown(rowIndex, e)}
                        onPointerMove={(e) => onShotRowPointerMove(rowIndex, e)}
                        onPointerUp={(e) => onShotRowPointerUp(rowIndex, e)}
                        onPointerCancel={() => onShotRowPointerCancel(rowIndex)}
                        onClickCapture={(e) => {
                          if (!shotRowSuppressClickRef.current) return;
                          e.preventDefault();
                          e.stopPropagation();
                          shotRowSuppressClickRef.current = false;
                        }}
                      >
                        <td
                          className={`px-1 py-2 align-middle text-center border-t ${cellBorder}`}
                        >
                          <div className="flex items-center justify-center gap-0.5 min-w-0">
                            {shotRowArmedIndex === rowIndex || shotDragFromIndex === rowIndex ? (
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
                            ) : null}
                            <span
                              className={`inline-flex h-7 w-7 items-center justify-center rounded-full ring-1 tabular-nums text-[11px] font-medium shrink-0 ${
                                isDarkMode
                                  ? 'ring-white/25 text-white/85'
                                  : 'ring-gray-300 text-gray-800'
                              }`}
                            >
                              {String(shotNo).padStart(2, '0')}
                            </span>
                          </div>
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
                          <div
                            className={`nodrag cursor-text whitespace-pre-wrap break-words min-h-[18px] text-left line-clamp-4 ${bodyCls}`}
                            title={finalVal || undefined}
                            onDoubleClick={() => openFinalPromptEdit(rowIndex, finalVal)}
                            onClick={() => {
                              setEditingAudioRow(null);
                              openFinalPromptEdit(rowIndex, finalVal);
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                          >
                            {finalVal ? (
                              highlightDescription(finalVal, allAssets, isDarkMode)
                            ) : (
                              <span className={mutedCls}>{tt.pendingPrompt}</span>
                            )}
                          </div>
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
                              ? 'nodrag inline-flex w-full items-center justify-center gap-1 rounded-md px-1.5 py-0.5 ring-1 whitespace-nowrap font-medium bg-white/[0.06] text-white/75 ring-white/12 hover:bg-white/[0.1] hover:text-white/95 disabled:opacity-40'
                              : 'nodrag inline-flex w-full items-center justify-center gap-1 rounded-md px-1.5 py-0.5 ring-1 whitespace-nowrap font-medium bg-gray-100 text-gray-600 ring-gray-200 hover:bg-gray-200 hover:text-gray-800 disabled:opacity-40';
                            const rowIconCls = isDarkMode
                              ? 'nodrag inline-flex items-center justify-center rounded p-0.5 text-white/55 hover:bg-white/10 hover:text-white/90'
                              : 'nodrag inline-flex items-center justify-center rounded p-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-900';
                            const sbGenLabel = sbUrl
                              ? tt.regenerateStoryboard
                              : tt.generateThisStoryboard;
                            const sbGenDisabled = sbGenerating || !finalVal || isDirectorHardBusy;
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
                        <td className={`p-1 align-middle border-t ${cellBorder}`}>
                          <div
                            className="relative w-full flex items-center justify-center"
                            style={{ minHeight: SHOTS_CONFIRM_SB_THUMB_PX }}
                            data-director-picker-keep="sb"
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
                                    finalVal
                                      ? `${tt.viewPrompt}\n\n${finalVal}`
                                      : `${tt.viewImage}: ${tt.colStoryboard} ${shotNo}`
                                  }
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setImagePreview({ url: sbUrl, name: `镜${shotNo}` });
                                  }}
                                  onPointerDown={(e) => e.stopPropagation()}
                                />
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
            {isMvMode && state.shots.length > 0 ? (
              <div
                className={`shrink-0 flex items-center gap-2 flex-wrap px-1 py-1.5 border-t ${cellBorder}`}
                style={{ fontSize: fsSmall }}
              >
                {(() => {
                  const musicSec = Math.round(Number(state.mvMusic?.durationSec) || 0);
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
    const usingLipsync = isDirectorLipsyncModel(videoBatchModel);
    return (
      <div
        className={`flex items-center gap-2 flex-wrap justify-center w-full mb-1 px-2 py-1 rounded-md ${
          isDarkMode ? 'bg-amber-500/10 text-amber-100/90' : 'bg-amber-50 text-amber-900'
        }`}
        style={{ fontSize: fsSmall }}
      >
        <span>{fillDirectorI18n(tt.lipsyncRecommend, { n: dialogueShotCount })}</span>
        {usingLipsync ? (
          <button
            type="button"
            className={`nodrag ${btnSecondary('', 'sensing')}`}
            style={{ fontSize: fsSmall }}
            disabled={!!busyAction}
            onClick={() => {
              const prevRaw = String(directorStateRef.current.videoBatchModelBeforeLipsync || '').trim();
              const next =
                prevRaw && prevRaw !== DIRECTOR_VIDEO_LIPSYNC_MODEL
                  ? normalizeDirectorVideoBatchModel(prevRaw)
                  : 'ltx-2.3-i2v';
              patchVideoBatch({
                videoBatchModel: next,
                videoBatchModelBeforeLipsync: '',
                videoBatchDuration: normalizeDirectorVideoBatchDuration(
                  next,
                  directorStateRef.current.videoBatchDuration,
                ),
                videoBatchAspectRatio: normalizeDirectorVideoBatchAspect(
                  next,
                  directorStateRef.current.videoBatchAspectRatio,
                ),
                videoBatchResolution: normalizeDirectorVideoBatchResolution(
                  next,
                  directorStateRef.current.videoBatchResolution,
                ),
              });
            }}
          >
            {tt.lipsyncRevert}
          </button>
        ) : (
          <button
            type="button"
            className={`nodrag ${btnPrimary('', 'motion')}`}
            style={{ fontSize: fsSmall }}
            disabled={!!busyAction}
            onClick={() => {
              patchVideoBatch({
                videoBatchModelBeforeLipsync: videoBatchModel,
                videoBatchModel: DIRECTOR_VIDEO_LIPSYNC_MODEL,
                videoBatchLipsyncResolution: normalizeDirectorVideoBatchResolution(
                  DIRECTOR_VIDEO_LIPSYNC_MODEL,
                  directorStateRef.current.videoBatchLipsyncResolution || videoBatchLipsyncResolution,
                ),
              });
            }}
          >
            {tt.lipsyncUse}
          </button>
        )}
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
    [],
  );

  const applyDirectorImageSuccess = useCallback(
    (assetId: string, result: { imageUrl?: string; localPath?: string; url?: string }) => {
      const imageUrl = resolveDirectorImageUrl(result);
      if (!imageUrl) return; // 忽略无图 SUCCESS（避免抢跑把状态写成 error）
      const latest = directorStateRef.current;
      const hit = findDirectorAssetById(latest.assets, assetId);
      if (!hit) {
        finishDirectorImageSlot(assetId);
        return;
      }
      patch(
        updateDirectorAsset(latest, assetId, {
          imageUrl,
          status: 'ready',
          error: undefined,
        }),
      );
      finishDirectorImageSlot(assetId);
    },
    [finishDirectorImageSlot, patch, resolveDirectorImageUrl],
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
      finishDirectorImageSlot(assetId);
    },
    [finishDirectorImageSlot, patch, tt.generateFailed],
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
      const asset = live?.asset || nextAsset;
      const kind = live?.kind || nextAsset.kind;
      patch(updateDirectorAsset(latest, asset.id, { status: 'generating', error: undefined }));
      const imageNodeId = directorAssetImageNodeId(id, asset.id);
      try {
        const styleHint = resolveDirectorStylePrompt(latest.stylePresetId, latest.globalStyle);
        const prompt =
          kind === 'scene'
            ? buildDirectorSceneImagePrompt({
                name: asset.name,
                prompt: asset.prompt,
                styleHint,
              })
            : kind === 'character'
              ? buildDirectorCharacterImagePrompt({
                  name: asset.name,
                  prompt: asset.prompt,
                  styleHint,
                  gender:
                    asset.gender ||
                    (/男主/.test(String(asset.name || ''))
                      ? 'male'
                      : /女主/.test(String(asset.name || ''))
                        ? 'female'
                        : ''),
                })
              : buildDirectorPropImagePrompt({
                  name: asset.name,
                  prompt: asset.prompt,
                  styleHint,
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
        const styleRef = styleRefRaw ? await materializeStyleReferenceUrl(styleRefRaw) : '';
        const useStyleRefImage = kind === 'scene' && !!styleRef;
        const assetModel = pickDirectorImageModel(
          latest.imageModel,
          useStyleRefImage,
          useStyleRefImage ? 1 : 0,
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
            ...(useStyleRefImage ? { image: styleRef, inputImages: [styleRef] } : {}),
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
        next = updateDirectorAsset(next, a.id, {
          status: String(live.asset.imageUrl || '').trim() ? 'ready' : 'pending',
          error: undefined,
        });
      }
      if (changed) patchRef.current(next);
    }, 800);
    return () => window.clearTimeout(t);
  }, [id]);

  // 分镜图残留 generating 清理
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
    if (!window.electronAPI?.onAIStatusUpdate) return;
    const remove = window.electronAPI.onAIStatusUpdate((packet: {
      nodeId?: string;
      status?: string;
      payload?: {
        imageUrl?: string;
        localPath?: string;
        url?: string;
        error?: string;
        outputImages?: string[];
      };
    }) => {
      const nodeId = String(packet?.nodeId || '');
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
      if (!parsed) return;
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
          imageUrl: payload.imageUrl || fromList || undefined,
          localPath: payload.localPath,
          url: payload.url,
        });
        return;
      }
      if (packet.status === 'ERROR') {
        applyDirectorImageError(assetId, String(packet.payload?.error || tt.generateFailed));
      }
    });
    return () => {
      if (typeof remove === 'function') remove();
    };
  }, [
    applyDirectorImageError,
    applyDirectorImageSuccess,
    id,
    patch,
    resolveDirectorImageUrl,
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
      const shot =
        latest.shots.find((s, i) => String(s['镜号'] || i + 1) === shotNo) || null;
      const hasFinal = !!String(shot?.['最终提示词'] || '').trim();
      const hasDesc = !!String(shot?.['画面描述'] || '').trim();
      if (!shot || (!hasFinal && !hasDesc)) {
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
        const styleHint = resolveDirectorStylePrompt(latest.stylePresetId, latest.globalStyle);
        const orderedRefs = getOrderedAssetsWithImages(latest);
        const shotRowIndex = latest.shots.findIndex(
          (s, i) => String(s['镜号'] || i + 1) === shotNo,
        );
        const matchedIdx =
          latest.mode === 'mv' && shotRowIndex >= 0
            ? getShotBoundRefIndices(shot, orderedRefs, shotRowIndex)
            : matchDirectorAssetIndicesForShot(shot, orderedRefs);
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
        const emptyCast = Array.isArray(sbCast.castAssetIds)
          ? charUrls.length === 0
          : shotSuggestsNoCharacterRefs(shot) || charUrls.length === 0;
        // 分镜参考图固定槽位（图生，每镜都带风格图；空槽省略）：
        // 1) 风格 — 画风/色调锁（对齐画面本身，勿按风格名称）
        // 2) 场景 — 环境结构锁（只借构图空间，不得覆盖风格色调）
        // 3) 人物1 / 4) 人物2 — 身份/性别/外貌锁（最多 2 张）
        // 截断优先丢人物；永不丢风格图；空镜仅 风格→场景。
        const styleSlot = styleRef ? [styleRef] : [];
        const prioritizedRefs = emptyCast
          ? [...styleSlot, ...sceneUrls]
          : [...styleSlot, ...sceneUrls, ...charUrls];
        const maxSbRefs = 4;
        let refImages = prioritizedRefs.slice(0, maxSbRefs);
        if (styleRef && !refImages.includes(styleRef)) {
          // 极端情况下仍保证风格图在列（挤掉末位非风格图）
          refImages = [styleRef, ...refImages.filter((u) => u !== styleRef)].slice(0, maxSbRefs);
        }
        const monoStyle = directorStyleLooksMonochrome(styleHint);
        const storyboardBody = composeDirectorShotStoryboardPrompt(shot, styleHint, {
          hasStyleReferenceImage: !!styleRef,
          closeUpFraming: latest.mvCloseUpFraming !== false,
        });
        if (!storyboardBody) {
          failAndPump(tt.generateFailed);
          return;
        }
        const refOrderLines: string[] = [];
        let refNo = 1;
        if (styleRef) {
          refOrderLines.push(
            `参考图${refNo}：风格图（只锁画面画风/色调，勿按风格名称理解；禁止照抄其中人物身份与性别）`,
          );
          refNo += 1;
        }
        if (sceneUrls[0] && refImages.includes(sceneUrls[0])) {
          refOrderLines.push(
            emptyCast
              ? `参考图${refNo}：场景（环境结构锁，须为空场景；色调仍跟风格图画面）`
              : `参考图${refNo}：场景（环境结构锁；色调仍跟风格图画面，禁止用场景彩光覆盖画风）`,
          );
          refNo += 1;
        }
        if (!emptyCast) {
          charUrls.forEach((url, i) => {
            if (!refImages.includes(url)) return;
            refOrderLines.push(`参考图${refNo}：人物${i + 1}（身份锁·性别与外貌以本图为准）`);
            refNo += 1;
          });
        }
        const prompt = [
          storyboardBody,
          refOrderLines.length
            ? `参考图顺序（必须遵守）：\n${refOrderLines.join('\n')}`
            : '无参考图时仅按文字公式生成。',
          emptyCast
            ? '本镜空镜/无人物：画面中禁止出现任何人、人脸、背影、剪影人形；只画环境与光色。风格图锁定画风色调（对齐画面本身，勿按风格名称）；场景图只借空间结构；即使风格图里有人也绝不能画进本镜。'
            : '风格图锁定全片画风与色调（对齐风格参考图画面本身，勿按风格名称）；主体身份与性别必须跟人物参考图（禁止把风格图里的人物当成主角）；场景图只提供环境结构，不得用其彩色霓虹覆盖风格色调。',
          monoStyle ? DIRECTOR_MONOCHROME_STYLE_LOCK_GUARD : '',
          'Strictly no text in the image: no subtitles, lyrics, captions, watermarks, logos, or letters/numbers.',
        ]
          .filter(Boolean)
          .join('\n\n');
        const imageNodeId = directorStoryboardImageNodeId(id, shotNo);
        const sbAspect =
          coerceDirectorMvAspectRatio(latest.mvAspectRatio || latest.videoBatchAspectRatio) ||
          '16:9';
        const sbModel = pickDirectorImageModel(
          latest.imageModel,
          refImages.length > 0,
          refImages.length,
        );
        await window.electronAPI.invokeAI({
          modelId: 'image',
          nodeId: imageNodeId,
          input: {
            model: sbModel,
            prompt,
            response_format: 'url',
            aspect_ratio: sbAspect,
            resolution: normalizeDirectorImageResolution(latest.imageResolution).toLowerCase(),
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
    [data?.projectId, getShotBoundRefIndices, id, materializeStyleReferenceUrl, patch, tt.generateFailed],
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
      const onlyMissing = opts?.onlyMissing !== false;
      const latest = directorStateRef.current;
      const valid: string[] = [];
      for (const raw of shotNos) {
        const shotNo = String(raw || '').trim();
        if (!shotNo) continue;
        const shot = latest.shots.find((s, i) => String(s['镜号'] || i + 1) === shotNo);
        const canStoryboard =
          !!String(shot?.['最终提示词'] || '').trim() || !!String(shot?.['画面描述'] || '').trim();
        if (!shot || !canStoryboard) continue;
        if (onlyMissing && String(latest.storyboardsByShotNo?.[shotNo]?.imageUrl || '').trim()) {
          continue;
        }
        if (sbGenInFlightRef.current.has(shotNo)) continue;
        const sb = latest.storyboardsByShotNo?.[shotNo];
        if (sb?.status === 'generating') continue;
        valid.push(shotNo);
      }
      if (valid.length === 0) return;
      const existing = new Set(sbGenQueueRef.current);
      const toAdd = valid.filter((n) => !existing.has(n));
      if (toAdd.length === 0) {
        void runNextStoryboardGen();
        return;
      }
      sbGenQueueRef.current = [...sbGenQueueRef.current, ...toAdd];
      void runNextStoryboardGen();
    },
    [runNextStoryboardGen],
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
      const latest = directorStateRef.current;
      const only =
        Array.isArray(shotNos) && shotNos.length > 0
          ? new Set(shotNos.map((n) => String(n || '').trim()).filter(Boolean))
          : null;
      const shots = (latest.shots || []).filter((s, i) => {
        if (!only) return true;
        return only.has(String(s['镜号'] || i + 1));
      });
      const prog = countDirectorStoryboards(shots, latest.storyboardsByShotNo);
      if (prog.ready === 0) {
        patch({ ...latest, error: tt.needStoryboardsFirst });
        return;
      }
      if (!only && prog.missing > 0) {
        const ok = await showConfirm(
          fillDirectorI18n(tt.confirmSpawnWithoutAllStoryboards, { n: prog.missing }),
        );
        if (!ok) return;
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
        const preferLipsync = resolveDirectorShotPreferLipsync(shot, sb, {
          hasHumanVoice: hasVoice,
          packText: packs[i]?.text || String(shot['对白旁白'] || ''),
          audioStartSec: startSec,
          songDurationSec: songDur,
          closeUpFramingOn: directorStateRef.current.mvCloseUpFraming !== false,
        });
        if (!preferLipsync) continue;

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
          await showAlert(
            `${tt.confirmLipsyncMissingTitle}\n\n${lipsyncLines.slice(0, 12).join('\n')}${
              lipsyncLines.length > 12 ? '\n…' : ''
            }`,
          );
          return;
        }
        // 材料齐全则直接开跑，不再弹确认窗
        startLipsync = true;
        let next = directorStateRef.current;
        for (const no of lipsyncShotNos) {
          next = updateDirectorShotStoryboard(next, no, { preferLipsync: true });
        }
        if (lipsyncShotNos.length) patch(next);
      }

      data?.onSpawnVideos?.(
        only
          ? {
              shotNos: [...only],
              startLipsync,
              ...(startLipsync && lipsyncShotNos.length
                ? { lipsyncShotNos: [...lipsyncShotNos] }
                : {}),
            }
          : startLipsync
            ? {
                startLipsync: true,
                ...(lipsyncShotNos.length ? { lipsyncShotNos: [...lipsyncShotNos] } : {}),
              }
            : undefined,
      );
    },
    [data, patch, showAlert, showConfirm, tt],
  );

  const chatResolverRef = useRef<{
    resolve: (t: string) => void;
    reject: (e: Error) => void;
  } | null>(null);

  const { execute: executeChat2 } = useAI({
    nodeId: `${id}-director-phase-chat`,
    modelId: 'chat',
    onComplete: (payload) => {
      const text = coerceAssistantText(payload?.text ?? payload?.content ?? payload?.result ?? '');
      const resolver = chatResolverRef.current;
      chatResolverRef.current = null;
      if (!resolver) return;
      if (payload?.error && !text) {
        resolver.reject(new Error(String(payload.error)));
        return;
      }
      resolver.resolve(text);
    },
    onError: (msg) => {
      const resolver = chatResolverRef.current;
      chatResolverRef.current = null;
      if (resolver) resolver.reject(new Error(msg || tt.generateFailed));
    },
  });

  const runChat = useCallback(
    async (
      systemPrompt: string,
      userPrompt: string,
      opts?: { max_tokens?: number; response_format?: unknown; temperature?: number },
    ) => {
      const raw = String(state.chatModel || '').trim();
      const model = (DIRECTOR_CHAT_MODELS as readonly string[]).includes(raw)
        ? raw
        : DIRECTOR_CHAT_MODEL_DEFAULT;
      return new Promise<string>((resolve, reject) => {
        chatResolverRef.current = { resolve, reject };
        void executeChat2({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          stream: false,
          projectId: data?.projectId || undefined,
          nodeTitle: '导演',
          ...(opts?.max_tokens != null ? { max_tokens: opts.max_tokens } : {}),
          ...(opts?.response_format != null ? { response_format: opts.response_format } : {}),
          ...(opts?.temperature != null ? { temperature: opts.temperature } : {}),
        }).catch((e) => {
          chatResolverRef.current = null;
          reject(e instanceof Error ? e : new Error(String(e)));
        });
      });
    },
    [data?.projectId, executeChat2, state.chatModel],
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
        patch({
          ...updateDirectorShotCell(directorStateRef.current, rowIndex, '最终提示词', next),
          error: '',
        });
        setFinalPromptDraft(next);
        setFinalPromptOpinion('');
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
    const resolver = chatResolverRef.current;
    if (resolver) {
      chatResolverRef.current = null;
      const err = new Error('cancelled');
      err.name = 'AbortError';
      resolver.reject(err);
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
  }, [patch]);

  const isMusicJobAbortError = useCallback((e: unknown) => {
    if (!e) return false;
    if (e instanceof Error && (e.name === 'AbortError' || /cancell?ed/i.test(e.message))) return true;
    return false;
  }, []);

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

  const renderModeToggle = () => {
    const modes = (
      HIDE_DIRECTOR_SCRIPT_MODE_UI ? (['mv'] as DirectorMode[]) : (['script', 'mv'] as DirectorMode[])
    );
    return (
    <div
      className={`nodrag inline-flex items-center shrink-0 rounded-lg p-0.5 border ${
        isDarkMode ? 'border-white/10 bg-white/[0.04]' : 'border-gray-200 bg-gray-100'
      }`}
    >
      {modes.map((mode) => {
        const active = state.mode === mode;
        const label = mode === 'script' ? tt.modeScript : tt.modeMv;
        return (
          <button
            key={mode}
            type="button"
            className={`rounded-md px-2 py-0.5 transition-colors whitespace-nowrap ${
              active
                ? isDarkMode
                  ? 'bg-sky-500/30 text-sky-100'
                  : 'bg-gray-700 text-white'
                : isDarkMode
                  ? 'text-white/50 hover:text-white/85'
                  : 'text-gray-600 hover:text-gray-900'
            }`}
            style={{ fontSize: fsChrome }}
            onClick={() => {
              if (HIDE_DIRECTOR_SCRIPT_MODE_UI && mode === 'script') return;
              patch(setDirectorMode(directorStateRef.current, mode));
              if (mode === 'mv' && !isNodeFullscreen) {
                const locked = directorMvLockedSize(
                  Number(dataRef.current?.width) || sizeW,
                );
                dataRef.current?.onUpdate?.({
                  width: locked.width,
                  height: locked.height,
                });
                updateNodeInternals(id);
              }
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
    );
  };

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
          shots: withComposedDirectorFinalPrompts(nextState.shots, style, true),
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
        const composed = withComposedDirectorFinalPrompts(covered, style, true);
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
              ),
            };
          }
        }
      }
      patch({
        ...nextState,
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
      .join(',')}`;
    if (assetRebindKeyRef.current === key) return;
    const { shots, changed } = rebindDirectorPipelineAssetRefs(state);
    assetRebindKeyRef.current = key;
    if (!changed) return;
    const nextKey = `${shots.map((s) => `${s['镜号']}:${s['画面描述']}:${s['最终提示词']}`).join('|')}#${flattenDirectorAssets(state.assets)
      .map((a) => `${a.id}:${a.name}:${a.imageUrl ? 1 : 0}`)
      .join(',')}`;
    assetRebindKeyRef.current = nextKey;
    patchRef.current({ ...directorStateRef.current, shots, phase: 'prompts' });
  }, [state.phase, state.shots, state.assets, state.isGenerating, busyAction]);

  const enqueueAssetImages = useCallback(
    (targets: DirectorAsset[], opts?: { onlyMissing?: boolean; maxParallel?: number }) => {
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
    [runNextImageGen],
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
      const list =
        kind === 'character'
          ? state.assets.characters
          : kind === 'scene'
            ? state.assets.scenes
            : state.assets.props;
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
      enqueueAssetImages([asset], { onlyMissing: false });
    },
    [enqueueAssetImages],
  );

  useEffect(() => {
    if (!sourceMenuAssetId) return;
    const onDoc = (e: MouseEvent) => {
      const el = sourceMenuRef.current;
      if (el && !el.contains(e.target as Node)) setSourceMenuAssetId(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [sourceMenuAssetId]);

  /** 进入选角：按选角计划确保主角槽位 */
  useEffect(() => {
    if (!isMvMode || state.phase !== 'cast') return;
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
    if (!isMvMode || state.phase !== 'assets') return;
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
      patch(
        updateDirectorShotStoryboard(directorStateRef.current, key, {
          videoUrl,
          videoStatus: 'ready',
          videoError: '',
        }),
      );
    },
    [patch],
  );

  const onUploadShotVideoClick = (shotNo: string) => {
    videoUploadShotNoRef.current = String(shotNo || '').trim();
    videoUploadInputRef.current?.click();
  };

  const onUploadShotVideoFile = async (file: File | null) => {
    const shotNo = videoUploadShotNoRef.current;
    videoUploadShotNoRef.current = null;
    if (!file || !shotNo) return;
    const api = window.electronAPI;
    const projectId = data?.projectId || undefined;
    let videoUrl = '';
    try {
      if (api?.saveDroppedFileBufferToProjectAssets) {
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
          const list = (await window.electronAPI?.getCharacters?.()) || [];
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
    const listKey = kind === 'character' ? 'characters' : kind === 'scene' ? 'scenes' : 'props';
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
    const publicRef =
      id === 'custom' ? '' : directorStylePresetImageUrl(preset.imageFile);
    const base = {
      ...directorStateRef.current,
      stylePresetId: id,
      globalStyle: nextStyle,
      styleReferenceImageUrl: publicRef,
    };
    patch({
      ...base,
      shots: withComposedDirectorFinalPrompts(base.shots, nextStyle, true),
    });
    if (!publicRef) return;
    void materializeStyleReferenceUrl(publicRef).then((localUrl) => {
      if (!localUrl || localUrl === publicRef) return;
      if (directorStateRef.current.stylePresetId !== id) return;
      patch({
        ...directorStateRef.current,
        styleReferenceImageUrl: localUrl,
      });
    });
  };

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
      shots: withComposedDirectorFinalPrompts(base.shots, nextStyle, true),
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
      activeStylePresetId === 'custom' && !!String(state.globalStyle || '').trim();
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
        className={`nodrag select-none relative overflow-hidden rounded-xl aspect-[16/10] border transition-all flex flex-col items-center justify-center gap-1 ${
          activeStylePresetId === 'custom' || stylePromptEditId === 'custom'
            ? isDarkMode
              ? 'border-white ring-2 ring-white/80 bg-white/[0.08]'
              : 'border-gray-300 ring-2 ring-gray-400/40 bg-gray-200/80'
            : isDarkMode
              ? 'border-dashed border-white/25 bg-white/[0.04] text-white/70 hover:bg-white/[0.07]'
              : 'border-dashed border-gray-300 bg-gray-100 text-gray-800 hover:bg-gray-200/70'
        }`}
        style={{ fontSize: fsChrome }}
        title={tt.styleLongPressHint}
        onClick={(e) => {
          e.stopPropagation();
          setStyleLibraryTab('mine');
          openStylePromptEditor('custom');
          applyStylePreset('custom');
        }}
      >
        <Plus className="w-5 h-5 opacity-80" strokeWidth={2} />
        <span className="font-medium">{locale === 'en' ? 'Custom' : '自定义'}</span>
      </button>
    );

    return (
      <div
        ref={stylePickerRef}
        className="director-keep-visible relative flex flex-col flex-1 min-h-0 gap-2.5 w-full"
      >
        <div className="shrink-0 flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className={`font-semibold ${titleCls}`} style={{ fontSize: fsSmall + 1 }}>
              {tt.styleLibraryTitle}
            </h3>
            <span className={`truncate ${mutedCls}`} style={{ fontSize: fsChrome }}>
              {fillDirectorI18n(tt.styleLibrarySelected, { name: activeLabel })}
            </span>
          </div>
          <div
            className={`flex items-center gap-4 border-b ${
              isDarkMode ? 'border-white/10' : 'border-gray-300/80'
            }`}
          >
            {(
              [
                { id: 'system' as const, label: tt.styleLibraryTabSystem },
                { id: 'mine' as const, label: tt.styleLibraryTabMine },
              ] as const
            ).map((tab) => {
              const on = styleLibraryTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`nodrag relative pb-1.5 transition-colors ${
                    on
                      ? isDarkMode
                        ? 'text-white font-medium'
                        : 'text-gray-950 font-medium'
                      : mutedCls
                  }`}
                  style={{ fontSize: fsSmall }}
                  onClick={() => setStyleLibraryTab(tab.id)}
                >
                  {tab.label}
                  {on ? (
                    <span
                      className={`absolute left-0 right-0 -bottom-px h-0.5 rounded-full ${
                        isDarkMode ? 'bg-sky-400' : 'bg-gray-950'
                      }`}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* 六列紧凑风格卡（对齐图二艺术风格库） */}
        <div className={`flex-1 min-h-0 overflow-y-auto nowheel pr-0.5 ${scrollCls}`}>
          {styleLibraryTab === 'system' ? (
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
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
              {renderCustomCard()}
              {hasCustomStyle ? (
                <button
                  type="button"
                  className={`nodrag select-none relative overflow-hidden rounded-xl aspect-[16/10] border transition-all text-left ${cardBorder(
                    true,
                    stylePromptEditId === 'custom',
                  )}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    openStylePromptEditor('custom');
                    applyStylePreset('custom');
                  }}
                >
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
                      style={{ fontSize: fsChrome }}
                    >
                      <span className="line-clamp-3">{String(state.globalStyle || '').slice(0, 80)}</span>
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/70 via-black/25 to-transparent px-1.5 pb-1.5 pt-5">
                    <span className="text-white text-[11px] font-medium drop-shadow">
                      {locale === 'en' ? 'Custom' : '自定义'}
                    </span>
                  </div>
                </button>
              ) : (
                <div
                  className={`col-span-full rounded-xl border border-dashed px-4 py-8 text-center ${
                    isDarkMode ? 'border-white/15 text-white/45' : 'border-gray-300 text-gray-700'
                  }`}
                  style={{ fontSize: fsSmall }}
                >
                  {tt.styleLibraryMineEmpty}
                </div>
              )}
            </div>
          )}
        </div>

        {stylePromptEditId ? (
          <div
            className={`nodrag nowheel shrink-0 w-full rounded-xl px-3 py-2.5 shadow-xl ring-1 ${
              isDarkMode ? 'bg-zinc-900/95 ring-white/15 backdrop-blur-md' : 'bg-gray-100 ring-gray-200'
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
      let next = setDirectorPhase(directorStateRef.current, phase);
      if (isMvMode && phase === 'cast') {
        next = ensureDirectorMvLeadSlots(next);
      }
      if (isMvMode && phase === 'assets') {
        next = syncDirectorMvScenesFromScript(
          setDirectorAssetsStep(next, 'scenes'),
          'fill',
        );
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
            const lipsync = resolveDirectorShotPreferLipsync(shot, sb, {
              hasHumanVoice: hasVoice,
              packText: packs[rowIndex]?.text || String(shot['对白旁白'] || ''),
              audioStartSec: range.startSec,
              songDurationSec: songDur,
              closeUpFramingOn: next.mvCloseUpFraming !== false,
            });
            const videoPrompt = composeDirectorShotVideoPrompt(shot, { lipsync });
            if (!videoPrompt) return shot;
            return { ...shot, 最终提示词: videoPrompt };
          }),
        };
      }
      startTransition(() => {
        patch(next);
      });
    },
    [isMvMode, patch, videoBatchModel],
  );

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
    const next = ensureDirectorMvLeadSlots(setDirectorPhase(directorStateRef.current, 'cast'));
    patch(next);
  }, [patch]);

  const goMvStoryPhase = useCallback(() => {
    const cur = ensureDirectorMvLeadSlots(directorStateRef.current);
    const plan = normalizeDirectorMvCastPlan(cur.mvCastPlan);
    if ((cur.assets.characters || []).length < plan.leadCount) {
      showAlert(tt.castNeedLeads);
      return;
    }
    patch(setDirectorPhase(cur, 'story'));
  }, [patch, showAlert, tt.castNeedLeads]);

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
    return (
      <div className="director-keep-visible w-full min-w-0">
        <div
          className={`nowheel flex w-full items-stretch gap-0 overflow-x-auto rounded-2xl border px-1 py-1.5 ${
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
                onClick={() => goDirectorPhase(s.phase)}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-semibold tabular-nums ${
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
                  style={{ fontSize: fsChrome }}
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
                  style={{ fontSize: fsChrome }}
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

  const renderPhaseButtons = () =>
    isMvMode ? (
      renderMvPhaseStepper([
        {
          phase: 'music',
          label: tt.phaseMusic,
          sub: tt.phaseMusicSub,
          done: !!String(state.mvMusic?.url || '').trim() || !!String(state.mvMusic?.moodHint || '').trim(),
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
          phase: 'story',
          label: tt.phaseStory,
          sub: tt.phaseStorySub,
          done:
            !!String(state.scriptText || '').trim() ||
            directorMvScriptSectionsHaveContent(mvScriptSections) ||
            !!String(state.mvStoryAnalysis?.summary || '').trim(),
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
      ])
    ) : (
      <>
        {phaseBtn(
          'shots',
          `1. ${tt.phaseShots}`,
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

  const MV_AUDIO_MAX_BYTES = 30 * 1024 * 1024;
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
      patch(
        patchDirectorMvMusic(prev, {
          url,
          title: String(prev.mvMusic?.title || '').trim() || titleFromOpt || prev.mvMusic?.title || '',
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
                className={`relative rounded-lg border px-1.5 py-1 h-full min-h-[96px] flex flex-col ${
                  isDarkMode ? 'border-white/10 bg-white/[0.04]' : 'border-gray-200 bg-gray-100'
                }`}
                style={DIRECTOR_MV_TABLE_ROW_CV}
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
        <div
          className={analysisCardCls}
          style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
        >
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
        <div
          className={analysisCardCls}
          style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
        >
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
          disabled={!hasAudio || extractingLyrics || (!!busyAction && !analyzing)}
          title={analyzing ? tt.musicJobCancel : `${tt.lyricTimelineDetect} · ${musicAnalyzeCostLabel}`}
          onClick={(e) => {
            e.stopPropagation();
            if (analyzing) {
              cancelMusicJob();
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
                <div className="absolute top-2 right-2 z-[1] flex items-center gap-0.5">
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
                    onClick={(e) => {
                      e.stopPropagation();
                      patch(
                        patchDirectorMvMusic(directorStateRef.current, {
                          url: '',
                          durationSec: 0,
                          sourceNodeId: '',
                        }),
                      );
                    }}
                  >
                    <X className="w-3.5 h-3.5" strokeWidth={2.4} />
                  </button>
                </div>
                <MusicPlayer
                  audioUrl={musicUrl}
                  isDarkMode={isDarkMode}
                  title={
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
            <textarea
              className={`nodrag nowheel w-full flex-1 min-h-0 resize-none rounded-2xl border-0 px-3 py-2.5 outline-none focus:ring-1 ${
                isDarkMode
                  ? 'bg-white/[0.04] text-white/85 placeholder:text-white/25 focus:ring-sky-400/30'
                  : 'bg-gray-100 text-gray-800 placeholder:text-gray-400 focus:ring-sky-300/50'
              } ${scrollCls}`}
              style={{ fontSize: fsMusic }}
              placeholder=""
              value={state.mvMusic?.lyrics || ''}
              onChange={(e) =>
                patch(patchDirectorMvMusic(directorStateRef.current, { lyrics: e.target.value }))
              }
              onPointerDown={(e) => e.stopPropagation()}
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
                disabled: !hasAudio || !!busyAction || analyzing || extractingLyrics,
                /** 底栏旁：菜单上拉，避免被面板 overflow 挡住 */
                menuPlacement: 'up',
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
      const result = await window.electronAPI.transcribeSpeechSegmentsFromAudioUrl(
        data?.projectId || undefined,
        musicUrl,
        'zh',
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
      showAlert(msg || tt.musicLyricsExtractFailed);
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
        const result = await window.electronAPI.transcribeSpeechSegmentsFromAudioUrl(
          data?.projectId || undefined,
          musicUrl,
          'zh',
        );
        if (!isMusicJobAlive(gen)) return false;
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
        showAlert(msg);
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

  /** 一次完成：仅生成剧本（歌曲分析沿用音乐步结果，不在此重复分析） */
  const handleMvStoryOneShot = useCallback(async () => {
    let cur0 = ensureDirectorMvLeadSlots(directorStateRef.current);
    if (cur0.mvScriptUseReferenceGen === false) {
      showAlert(tt.storyManualHint);
      return;
    }
    const plan = normalizeDirectorMvCastPlan(cur0.mvCastPlan);
    if ((cur0.assets.characters || []).length < plan.leadCount) {
      showAlert(tt.castNeedLeads);
      return;
    }
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
    // 音乐步摘要若未写入 mvStoryAnalysis，先回填到上方卡片
    if (!String(cur0.mvStoryAnalysis?.summary || '').trim()) {
      const musicSummary = String(cur0.mvMusic?.summary || '').trim();
      const moodParts = String(cur0.mvMusic?.moodHint || '')
        .split(/[·•|,，/]/)
        .map((s) => s.trim())
        .filter(Boolean);
      cur0 = patchDirectorMvStoryAnalysis(cur0, {
        summary: musicSummary || cur0.mvStoryAnalysis?.summary,
        ...(moodParts.length && !(cur0.mvStoryAnalysis?.emotions || []).length
          ? { emotions: moodParts.slice(0, 4), keywords: moodParts.slice(4) }
          : {}),
      });
      patch(cur0);
    }
    if (busyAction || cur0.isGenerating || data?.isGenerating) return;
    setBusyAction('story-script');
    patch({ ...cur0, isGenerating: true, error: '', phase: 'story' });
    const notes = String(directorStateRef.current.mvScriptReference || '').trim();
    try {
      const cur = directorStateRef.current;
      const { systemPrompt, userPrompt } = buildDirectorMvScriptMessages(cur, notes);
      const chatModel = String(cur.chatModel || '').trim();
      const isTerra = chatModel === LLM_CHAT_MODEL_GPT56_TERRA;
      // Terra / 长剧本：提高上限，避免推理占额度后正文为空或截断；Terra 额外要求 JSON object
      const text = await runChat(systemPrompt, userPrompt, {
        max_tokens: isTerra ? 16384 : 8192,
        temperature: 0.7,
        ...(isTerra ? { response_format: { type: 'json_object' } } : {}),
      });
      if (!String(text || '').trim()) {
        throw new Error('模型返回为空（网络或上游未返回正文），请重试');
      }
      const normalized = normalizeDirectorMvScriptResult(text);
      if (!normalized.ok) {
        console.warn('[DirectorNode] MV 剧本解析失败', {
          model: chatModel,
          error: normalized.error,
          textLen: String(text || '').length,
          preview: String(text || '').slice(0, 240),
        });
        throw new Error(normalized.error || tt.storyScriptFailed);
      }
      // 强制剧情表行数 = 音频 lyric pack / 可算片段数（LLM 可能 ±N 漂移）
      const clipCount = resolveDirectorMvAudioClipCount(cur);
      const sections =
        clipCount > 0
          ? alignDirectorMvScriptSectionsToClipCount(normalized.sections, clipCount)
          : normalized.sections;
      const script = composeDirectorMvScriptText(sections) || normalized.script;
      let next = {
        ...directorStateRef.current,
        scriptText: script,
      };
      next = patchDirectorMvStoryAnalysis(next, {
        scriptKeywords: normalized.scriptKeywords,
        sections,
      });
      next = syncDirectorMvCastFromScript(next, 'fill');
      next = ensureDirectorMvLeadSlots(next);
      patch({ ...next, isGenerating: false, error: '' });
    } catch (e) {
      const rawMsg = e instanceof Error ? e.message : String(e || '');
      const isNetwork =
        /ETIMEDOUT|ECONNREFUSED|ENOTFOUND|timeout|网络|连接|DNS|fetch failed|Failed to fetch|NX_AUTH|登录/i.test(
          rawMsg,
        );
      const isParse = /无法解析|剧本正文为空|非合法 JSON|被截断/i.test(rawMsg);
      const msg = isNetwork
        ? `剧本生成失败（网络/上游）：${rawMsg || tt.storyScriptFailed}`
        : isParse
          ? rawMsg
          : rawMsg || tt.storyScriptFailed;
      patch({ ...directorStateRef.current, isGenerating: false, error: msg });
      showAlert(msg);
    } finally {
      setBusyAction(null);
    }
  }, [
    busyAction,
    data?.isGenerating,
    patch,
    runChat,
    showAlert,
    tt.castNeedLeads,
    tt.storyManualHint,
    tt.storyNeedLyricsOrTitle,
    tt.storyNeedMusicAnalysis,
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
    const writing = busyAction === 'story-script' || busyAction === 'story-oneshot';
    const oneShotBusy = writing || !!state.isGenerating;
    const oneShotLabel = writing ? tt.storyWriting : tt.storyGenerateScriptBtn;
    const useRefGen = state.mvScriptUseReferenceGen !== false;
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
      <div className="flex flex-col shrink-0 gap-3">
        <div className="shrink-0 relative z-[40] overflow-visible flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-4 flex-wrap shrink-0">
          <div
            className="nodrag nopan inline-flex items-center gap-2 select-none shrink-0"
            onPointerDown={(e) => e.stopPropagation()}
            title={useRefGen ? tt.storyRefGenOnHint : tt.storyManualHint}
          >
            <button
              type="button"
              role="switch"
              aria-checked={useRefGen}
              aria-label={tt.storyRefGenSwitchLabel}
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50 ${
                useRefGen
                  ? isDarkMode
                    ? 'bg-sky-500/85'
                    : 'bg-gray-700'
                  : isDarkMode
                    ? 'bg-white/20'
                    : 'bg-gray-300'
              }`}
              onClick={(e) => {
                e.stopPropagation();
                patch(
                  patchDirectorMvScriptInput(directorStateRef.current, {
                    mvScriptUseReferenceGen: !useRefGen,
                  }),
                );
              }}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  useRefGen ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
            <button
              type="button"
              className={`nodrag font-medium ${bodyCls} cursor-pointer bg-transparent border-0 p-0 text-left`}
              style={{ fontSize: fsChrome }}
              onClick={(e) => {
                e.stopPropagation();
                patch(
                  patchDirectorMvScriptInput(directorStateRef.current, {
                    mvScriptUseReferenceGen: !useRefGen,
                  }),
                );
              }}
            >
              {tt.storyRefGenSwitchLabel}
            </button>
          </div>
          {renderCloseUpFramingSwitch()}
          </div>
          <div className="relative z-[40] flex items-center gap-2 shrink-0 overflow-visible ml-auto">
            {renderChatModelSelect()}
            {useRefGen ? (
              <div className="relative z-[40] flex items-center gap-1.5 shrink-0 overflow-visible">
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
                    disabled={!!busyAction || !!state.isGenerating || !!data?.isGenerating}
                    title={tt.priceTooltip}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleMvStoryOneShot();
                    }}
                  >
                    {oneShotBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" /> : null}
                    {oneShotLabel}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {useRefGen ? (
          <div
            className={`flex flex-col shrink-0 gap-1.5 ${cardCls}`}
            style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
          >
            <p className={`leading-relaxed ${mutedCls}`} style={{ fontSize: fsChrome }}>
              {tt.storyRefGenOnHint}
            </p>
            <div className={`font-medium ${bodyCls}`} style={{ fontSize: fsChrome }}>
              {tt.storyReferenceLabel}
            </div>
            <textarea
              className={sectionInputCls}
              style={{ fontSize: fsChrome, minHeight: 72 }}
              rows={3}
              value={scriptReference}
              placeholder={tt.storyReferencePlaceholder}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                patch(
                  patchDirectorMvScriptInput(directorStateRef.current, {
                    mvScriptReference: e.target.value,
                  }),
                );
              }}
              ref={(el) => growStoryTextarea(el, 72)}
              onInput={(e) => growStoryTextarea(e.currentTarget, 72)}
            />
          </div>
        ) : (
          <p className={`leading-relaxed shrink-0 ${mutedCls}`} style={{ fontSize: fsChrome }}>
            {tt.storyManualHint}
          </p>
        )}

        <div className="flex flex-col shrink-0 gap-3">
        <div className="shrink-0 grid grid-cols-1 md:grid-cols-2 gap-2.5">
          <div
            className={cardCls}
            style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
          >
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

          <div
            className={cardCls}
            style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
          >
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

        <div
          className={`flex flex-col shrink-0 gap-2.5 ${cardCls}`}
          style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
        >
          <div className="shrink-0 flex items-center justify-between gap-2">
            <span className={`font-medium ${bodyCls}`} style={{ fontSize: fsSmall }}>
              {tt.phaseStory}
            </span>
          </div>
          {scriptKeywords.length ? (
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
            {sectionDefs.map((sec) => {
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
                  'mood',
                ];
                /** 大致均分；「动作与画面」略宽 */
                const colPct: Record<keyof DirectorMvPlotBeatRow, string> = {
                  no: '5%',
                  section: '8%',
                  vocal: '8%',
                  castType: '8%',
                  scene: '9%',
                  cast: '8%',
                  angle: '9%',
                  focal: '8%',
                  action: '22%',
                  mood: '7%',
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
            })}
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

      return (
        <div
          className={`flex flex-col flex-1 min-h-0 rounded-xl border px-2.5 py-2 gap-1.5 ${
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
              />
              <textarea
                className={`nodrag nowheel flex-1 min-h-0 w-full resize-none rounded-lg px-1.5 py-1 leading-snug outline-none ${mutedCls} ${scrollCls} ${
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
              />
              <div className="shrink-0 flex items-center gap-1 flex-nowrap">
                {interactive ? (
                  <div className="shrink-0">
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
                    className={`nodrag ${btnPrimary('!px-2 !py-0.5 !h-auto !min-h-0', sectionScratch('character'))}`}
                    style={{ fontSize: fsChrome }}
                    disabled={!interactive || asset?.status === 'generating' || isDirectorHardBusy}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!asset) return;
                      setCastArtworkPickAssetId(asset.id);
                      generateOneAsset(asset);
                    }}
                  >
                    {tt.generateThis}
                  </button>
                </div>
              </div>
            </div>

            {/* 已选形象（9:16，更大）+ 点击弹出上传 */}
            <div
              className="relative shrink-0 h-full min-h-0 aspect-[9/16] w-auto max-w-[26%] min-w-[132px]"
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
                  <img
                    src={asset.imageUrl}
                    alt={asset?.name || ''}
                    className="w-full h-full object-cover pointer-events-none"
                    draggable={false}
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
                {asset?.status === 'generating' ? (
                  <div
                    className={`absolute inset-0 z-[1] flex items-center justify-center ${
                      isDarkMode ? 'bg-black/55' : 'bg-gray-200/80'
                    }`}
                  >
                    <Loader2 className={`w-5 h-5 animate-spin ${accentSpin}`} />
                  </div>
                ) : null}
              </button>
              {uploadOpen && asset ? (
                <div
                  className={`nodrag absolute left-1/2 -translate-x-1/2 bottom-[calc(100%+6px)] z-40 min-w-[9.5rem] overflow-hidden rounded-lg border py-1 shadow-xl ${
                    isDarkMode
                      ? 'bg-zinc-900 border-white/15 text-white/90'
                      : 'bg-gray-100 border-gray-200 text-gray-800'
                  }`}
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
                </div>
              ) : null}
            </div>

            <div
              className={`nexflow-cast-look-rail flex-1 min-w-0 min-h-0 flex gap-2.5 overflow-x-auto overflow-y-hidden items-center px-1 py-2 nowheel ${scrollCls}`}
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

    return (
      <div className="flex flex-col flex-1 min-h-0 gap-2 overflow-hidden">
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
          <div className="flex flex-col flex-1 min-h-0 gap-2 overflow-hidden">
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

        <label
          className="nodrag inline-flex items-center gap-1.5"
          title={tt.videoBatchLipsyncModelLabel}
        >
          <span className={labelCls} style={{ fontSize: fsSmall }}>
            {tt.videoBatchLipsyncModelLabel}
          </span>
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
            {tt.batchSpawnVideos}
          </button>
        </span>
      </div>
    );
  };

  /** 第7步：视频生成表（列宽/音频/对口型/成片交互对齐分镜生成表） */
  const renderMvVideosPanel = (opts?: { maxHeightClass?: string; panelActive?: boolean }) => {
    const maxH = opts?.maxHeightClass || '';
    const panelActive = opts?.panelActive !== false;
    // 与分镜确认表一致：参考图用场景格高度，成片用分镜图尺寸
    const refThumbH = SHOTS_CONFIRM_REF_CELL_H;
    const refThumbW = Math.round(refThumbH * (16 / 9));
    const videoThumbH = SHOTS_CONFIRM_SB_THUMB_PX;
    const videoThumbW = Math.round(videoThumbH * (16 / 9));
    const videoEmptyH = Math.round(videoThumbH * 0.85);
    const actionFs = Math.max(10, fsChrome - 1);
    const actionSecondaryCls = isDarkMode
      ? 'nodrag inline-flex w-full items-center justify-center gap-1 rounded-md px-1.5 py-0.5 ring-1 whitespace-nowrap font-medium bg-white/[0.06] text-white/75 ring-white/12 hover:bg-white/[0.1] hover:text-white/95 disabled:opacity-40'
      : 'nodrag inline-flex w-full items-center justify-center gap-1 rounded-md px-1.5 py-0.5 ring-1 whitespace-nowrap font-medium bg-gray-100 text-gray-600 ring-gray-200 hover:bg-gray-200 hover:text-gray-800 disabled:opacity-40';
    const videoCols = [
      { key: '镜号', width: '48px', label: tt.colShotNo },
      { key: '时长', width: '44px', label: tt.colDuration },
      { key: '最终提示词', width: '168px', label: tt.colFinalPrompt },
      { key: '__ref_sb__', width: '108px', label: tt.colRefStoryboard },
      { key: '__lens__', width: '52px', label: tt.colAngleFocal },
      { key: '__audio__', width: '220px', label: tt.colShotAudio },
      { key: '__lipsync__', width: '88px', label: tt.colLipsync },
      { key: '__video__', width: '168px', label: tt.colShotVideo },
    ] as const;

    return (
      <div className="flex flex-col flex-1 min-h-0 gap-2">
        {renderMvVideoGenToolbar()}
        <DirectorShotTableVirtual
          count={state.shots.length}
          estimateSize={DIRECTOR_MV_VIDEO_ROW_ESTIMATE_PX}
          getItemKey={(i) => String(state.shots[i]?.['镜号'] ?? i)}
          className={`nowheel flex-1 min-h-0 overflow-auto ${maxH} ${scrollCls}`}
        >
          {({ virtualItems, paddingTop, paddingBottom, measureElement }) => (
          <table className="w-full table-fixed border-collapse" style={{ fontSize: fsSmall }}>
            <thead className={`sticky top-0 z-10 backdrop-blur-sm ${tableHeadBg}`}>
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
                const videoUrl = String(sb?.videoUrl || '').trim();
                const videoStatus = sb?.videoStatus || (videoUrl ? 'ready' : 'pending');
                const videoGenerating = videoStatus === 'generating';
                const finalVal = resolveShotFinalPrompt(shot);
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
                    className={`${rowHover} border-b ${cellBorder}`}
                    style={DIRECTOR_MV_TABLE_ROW_CV}
                  >
                    <td className={`px-1 py-2 align-middle text-center border-t ${cellBorder}`}>
                      <div className="flex items-center justify-center">
                        <span
                          className={`inline-flex h-7 w-7 items-center justify-center rounded-full ring-1 tabular-nums text-[11px] font-medium ${
                            isDarkMode ? 'ring-white/25 text-white/85' : 'ring-gray-300 text-gray-800'
                          }`}
                        >
                          {String(shotNo).padStart(2, '0')}
                        </span>
                      </div>
                    </td>
                    <td
                      className={`px-1 py-2 align-middle text-center tabular-nums border-t ${cellBorder} ${mutedCls}`}
                      style={{ fontSize: fsSmall }}
                    >
                      {durationCell}
                    </td>
                    <td className={`px-1.5 py-1.5 align-middle text-left border-t ${cellBorder}`}>
                      <div
                        className={`nodrag cursor-text whitespace-pre-wrap break-words min-h-[18px] text-left line-clamp-4 ${bodyCls}`}
                        title={finalVal || undefined}
                        onDoubleClick={() => openFinalPromptEdit(rowIndex, finalVal)}
                        onClick={() => openFinalPromptEdit(rowIndex, finalVal)}
                      >
                        {finalVal ? (
                          highlightDescription(finalVal, allAssets, isDarkMode)
                        ) : (
                          <span className={mutedCls}>{tt.pendingPrompt}</span>
                        )}
                      </div>
                    </td>
                    <td className={`p-1 align-middle border-t ${cellBorder}`}>
                      <div
                        className="relative w-full flex items-center justify-center"
                        style={{ height: refThumbH }}
                      >
                        {sbUrl ? (
                          <DirectorAspectThumbButton
                            frame="storyboard"
                            url={sbUrl}
                            alt={`镜${shotNo}`}
                            title={`${tt.viewImage}: ${tt.colRefStoryboard} ${shotNo}`}
                            maxH={refThumbH}
                            maxW={refThumbW}
                            onClick={(e) => {
                              e.stopPropagation();
                              setImagePreview({ url: sbUrl, name: `镜${shotNo}` });
                            }}
                          />
                        ) : (
                          <div
                            className={`rounded-lg flex items-center justify-center shrink-0 ${mutedCls} ${softPanel}`}
                            style={{
                              aspectRatio: '16 / 9',
                              height: refThumbH,
                              maxWidth: '100%',
                              fontSize: 10,
                            }}
                          >
                            —
                          </div>
                        )}
                      </div>
                    </td>
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
                        <span className="relative inline-flex w-full">
                          <button
                            type="button"
                            className={`nodrag ${btnPrimary('!px-1.5 !py-0.5 rounded-md w-full', 'events')} disabled:opacity-50`}
                            style={{ fontSize: actionFs }}
                            disabled={genDisabled}
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
                      <div
                        className="relative w-full flex items-center justify-center"
                        style={{ minHeight: videoThumbH }}
                      >
                        {videoUrl ? (
                          <div
                            className="relative inline-flex max-w-full group/vidf"
                            onMouseEnter={(e) => {
                              if (!panelActive || videoPreviewOpenRef.current || videoGenerating) return;
                              const v = e.currentTarget.querySelector('video');
                              if (!v) return;
                              v.loop = true;
                              void v.play().catch(() => undefined);
                            }}
                            onMouseLeave={(e) => {
                              const v = e.currentTarget.querySelector('video');
                              if (!v) return;
                              v.pause();
                              try {
                                v.currentTime = 0;
                              } catch {
                                /* ignore */
                              }
                            }}
                          >
                            <video
                              src={toElectronVideoElementSrc(videoUrl) || videoUrl}
                              className="nodrag max-h-full rounded-lg object-contain bg-black/40 ring-1 ring-transparent group-hover/vidf:ring-blue-500/70"
                              style={{ maxHeight: videoThumbH, maxWidth: videoThumbW }}
                              muted={!unmuted}
                              loop
                              playsInline
                              preload={panelActive ? 'metadata' : 'none'}
                              poster={sbUrl || undefined}
                              onPointerDown={(e) => e.stopPropagation()}
                            />
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
                              title={unmuted ? tt.videoMute : tt.videoUnmute}
                              onClick={(e) => {
                                e.stopPropagation();
                                setShotVideoUnmuted((prev) => ({
                                  ...prev,
                                  [shotNo]: !unmuted,
                                }));
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                            >
                              {unmuted ? (
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
                          </div>
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
                          <div
                            className={`rounded-lg flex flex-col items-center justify-center gap-1 px-2 text-center ring-1 ring-dashed ${
                              isDarkMode
                                ? 'ring-red-400/40 bg-red-500/10 text-red-200/90'
                                : 'ring-red-300 bg-red-50 text-red-700'
                            }`}
                            style={{
                              aspectRatio: '16 / 9',
                              height: videoEmptyH,
                              maxWidth: '100%',
                              fontSize: 10,
                            }}
                            title={String(sb?.videoError || tt.generateFailed)}
                          >
                            {tt.generateFailed}
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
                              height: videoEmptyH,
                              maxWidth: '100%',
                            }}
                          >
                            <Plus className="w-4 h-4" strokeWidth={2} />
                          </div>
                        )}
                      </div>
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

  const handleVideosToSpliceClick = () => {
    const wasFullscreen = isNodeFullscreen;
    if (wasFullscreen) setIsNodeFullscreen(false);
    // 退出全屏后再入轨，便于画布用一键归位动画对准剪辑模块
    window.setTimeout(() => {
      data?.onVideosToSplice?.();
    }, wasFullscreen ? 120 : 0);
  };

  const colLabel = (key: DirectorShotColumnKey) => {
    const map: Record<DirectorShotColumnKey, string> = {
      镜号: tt.colShotNo,
      时长: tt.colDuration,
      画面描述: tt.colDesc,
      镜头角度: tt.colAngle,
      焦距: tt.colFocal,
      景别: tt.colShotSize,
      光影氛围: tt.colLighting,
      对白旁白: tt.colDialogue,
      音效: tt.colSfx,
      运镜: tt.colCamera,
      最终提示词: tt.colFinalPrompt,
    };
    return map[key];
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
        className={`relative min-w-0 flex items-center justify-center ${
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
            <img
              src={asset.imageUrl}
              alt={asset.name}
              className="max-w-full max-h-full w-auto h-auto object-contain"
              draggable={false}
            />
          </button>
        ) : (
          <div className={`px-3 text-center leading-relaxed ${mutedCls}`} style={{ fontSize: fsChrome }}>
            {opts?.castPick ? tt.castGenerateOrCanvas : tt.generateOrUpload}
            {!opts?.castPick ? <div className="mt-1 opacity-80">{tt.sourceMenuTitle}</div> : null}
          </div>
        )}
        {asset.status === 'generating' && (
          <div
            className={`absolute inset-0 z-[1] flex flex-col items-center justify-center gap-1 ${
              isDarkMode ? 'bg-black/55' : 'bg-gray-200/80'
            }`}
          >
            <Loader2 className={`w-5 h-5 animate-spin ${accentSpin}`} />
            <span className={isDarkMode ? 'text-sky-200/90' : 'text-blue-700'} style={{ fontSize: fsChrome }}>
              {tt.generating}
            </span>
          </div>
        )}
        <div className="absolute bottom-1.5 right-1.5 z-[2] flex items-end gap-1 max-w-[96%] flex-wrap justify-end overflow-visible">
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
        // 分析入口在右侧中间；底部「下一步：风格选择」主按钮（图二蓝渐变胶囊）
        return (
          <button
            type="button"
            className={`nodrag ${btnPrimary('', 'sound')} disabled:opacity-50`}
            style={{ fontSize: fsChrome }}
            onClick={() => patch(setDirectorPhase(directorStateRef.current, 'style'))}
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
            onClick={() => goMvStoryPhase()}
          >
            {tt.nextStoryAfterCast}
          </button>
        );
      }
      if (state.phase === 'story') {
        return (
          <button
            type="button"
            className={`nodrag ${btnPrimary('', 'motion')} disabled:opacity-50`}
            style={{ fontSize: fsSmall }}
            onClick={() => goMvScenesPhase()}
          >
            {tt.nextMvScenes}
          </button>
        );
      }
      if (state.phase === 'videos') {
        return (
          <button
            type="button"
            className={`nodrag ${btnPrimary('', 'sensing')} disabled:opacity-50`}
            style={{ fontSize: fsSmall }}
            disabled={storyboardsProg.ready === 0}
            title={
              storyboardsProg.ready === 0 ? tt.needStoryboardsFirst : tt.previewVideosToSplice
            }
            onClick={handleVideosToSpliceClick}
          >
            {tt.previewVideosToSplice}
          </button>
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
          {tt.step2PrepareAssets}
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

  const hangPrimary = (
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
      {primaryFooter()}
    </div>
  );

  return (
    <div
      ref={nodeRef}
      className={`custom-node-container nexflow-director-node group relative overflow-visible rounded-2xl flex flex-col ${
        isDarkMode ? 'nexflow-glass-panel' : 'apple-panel-light'
      } ${
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
            {state.title || tt.directorTitle}
          </span>
          {renderModeToggle()}
          {!isMvMode ? renderScriptChip() : null}
          {(busyAction || state.isGenerating || data?.isGenerating) && (
            <Loader2 className={`w-4 h-4 animate-spin ${accentSpin}`} />
          )}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {!isMvMode ? (
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
                state.phase === 'videos'
              ? 'overflow-hidden'
              : 'overflow-y-auto nowheel custom-scrollbar-dark'
            : 'overflow-hidden'
        }`}
      >
        {!isMvMode ? (
          <div className="shrink-0 overflow-visible py-0.5">{renderStylePicker()}</div>
        ) : null}

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
        {isMvMode && state.phase === 'story' && renderMvStoryPanel()}
        {isMvMode && state.phase === 'cast' && (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">{renderMvCastPanel()}</div>
        )}
        {videosPanelActive ? (
          <div
            ref={setVideosPanelHost}
            className="flex-1 min-h-0 flex flex-col"
          >
            {renderMvVideosPanel({ panelActive: true })}
          </div>
        ) : null}

        {shotsPanelActive
          ? renderShotsConfirmPanel({
              className: 'flex flex-col flex-1 min-h-0 gap-1',
            })
          : null}


        {state.phase === 'assets' && (
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
                    if (!isMvMode) return true;
                    // MV：角色在选角完成；不生成道具，只做场景九宫格
                    return stepId === 'scenes';
                  })
                  .map(([stepId, label]) => {
                  const active =
                    (state.assetsStep || 'characters') === stepId ||
                    (!state.assetsStep && stepId === 'characters') ||
                    (isMvMode && stepId === 'scenes');
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
                      {isMvMode && stepId === 'scenes' ? tt.phaseMvScenes : label}
                    </button>
                  );
                })}
                {isMvMode ? (
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
                {isMvMode ? (
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
                    : isMvMode
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
        )}

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
                              const refs = getOrderedAssetsWithImages(state);
                              const indices = extractSeedanceImageMentionIndices(val);
                              if (indices.length === 0) return null;
                              return (
                                <div className="flex flex-wrap gap-1">
                                  {indices.map((n) => {
                                    const url = String(refs[n - 1]?.imageUrl || '').trim();
                                    if (!url) {
                                      return (
                                        <span
                                          key={`shot-ref-${rowIndex}-${n}`}
                                          className={`text-[10px] px-1 rounded ${mutedCls}`}
                                        >
                                          @{n}?
                                        </span>
                                      );
                                    }
                                    return (
                                      <button
                                        key={`shot-ref-${rowIndex}-${n}`}
                                        type="button"
                                        className="nodrag w-8 h-8 rounded overflow-hidden ring-1 ring-sky-400/40"
                                        title={`@图片${n} · 第${n}张${refs[n - 1]?.name ? ` · ${refs[n - 1].name}` : ''}${refs[n - 1] ? ` · ${inferDirectorAssetGender(refs[n - 1])}` : ''}`}
                                        onClick={() =>
                                          setImagePreview({
                                            url,
                                            name: refs[n - 1]?.name || `图片${n}`,
                                          })
                                        }
                                      >
                                        <img
                                          src={url}
                                          alt={`@图片${n}`}
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
                              onClick={() => setPromptPreview(val)}
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
                            onClick={() => setPromptPreview(val)}
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

      {!isNodeFullscreen && hangPrimary}

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
              aria-label={tt.colFinalPrompt}
            >
              <div className="flex justify-between items-center mb-3 shrink-0 gap-3">
                <div className={`text-lg font-semibold ${titleCls}`}>
                  {tt.colFinalPrompt}
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

      {promptPreview != null &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className={`fixed inset-0 z-[100002] flex items-center justify-center p-6 ${
              isDarkMode ? 'bg-black/75' : 'bg-black/45'
            }`}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (e.target === e.currentTarget) setPromptPreview(null);
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              className={`w-full max-w-4xl max-h-[min(85vh,820px)] flex flex-col rounded-2xl p-5 shadow-2xl ring-1 ${
                isDarkMode ? 'bg-zinc-900 ring-white/15' : 'bg-gray-100 ring-gray-200'
              }`}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-3 shrink-0 gap-3">
                <div className={`text-lg font-semibold ${titleCls}`}>{tt.colFinalPrompt}</div>
                <button
                  type="button"
                  className={`nodrag p-1.5 rounded-lg ${mutedCls} hover:opacity-100 ${
                    isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                  }`}
                  onClick={() => setPromptPreview(null)}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              {(() => {
                const refs = getOrderedAssetsWithImages(state);
                const indices = extractSeedanceImageMentionIndices(promptPreview || '');
                if (indices.length === 0) return null;
                return (
                  <div className="mb-3 flex flex-wrap gap-2 shrink-0">
                    {indices.map((n) => {
                      const asset = refs[n - 1];
                      const url = String(asset?.imageUrl || '').trim();
                      const kindLabel =
                        asset?.kind === 'character'
                          ? tt.characters
                          : asset?.kind === 'scene'
                            ? tt.scenes
                            : asset?.kind === 'prop'
                              ? tt.props
                              : '';
                      const label = `@图片${n} · 第${n}张${asset?.name ? ` · ${asset.name}` : ''}${asset ? ` · ${inferDirectorAssetGender(asset)}` : ''}`;
                      return (
                        <div
                          key={`preview-ref-${n}`}
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
                                setImagePreview({ url, name: asset?.name || `图片${n}` })
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
                );
              })()}
              <div
                className={`nowheel flex-1 min-h-0 overflow-auto whitespace-pre-wrap break-words leading-relaxed ${scrollCls} ${bodyCls}`}
                style={{ fontSize: Math.max(18, fsBody + 2) }}
              >
                {promptPreview}
              </div>
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
              isMvMode &&
              (state.phase === 'shots' ||
                state.phase === 'music' ||
                state.phase === 'style' ||
                state.phase === 'cast' ||
                state.phase === 'videos')
                ? 'flex flex-col overflow-hidden'
                : 'overflow-auto'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Clapperboard className={`w-5 h-5 shrink-0 ${accentSpin}`} />
                <span className={`font-semibold truncate ${titleCls}`}>{state.title || tt.directorTitle}</span>
                {renderModeToggle()}
                {!isMvMode ? renderScriptChip() : null}
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
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
            <div className="mb-3 overflow-visible py-0.5 shrink-0">
              {!isMvMode ? renderStylePicker() : null}
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
              <div className="mb-3">{renderMvStoryPanel()}</div>
            )}
            {isMvMode && state.phase === 'cast' && (
              <div className="flex flex-col flex-1 min-h-0 overflow-hidden">{renderMvCastPanel()}</div>
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
            {(!isMvMode && (state.phase === 'shots' || state.phase === 'prompts')) ? (
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
                                      disabled={sbGenerating || !val}
                                      onMouseEnter={() =>
                                        !sbGenerating &&
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
                                        onClick={() => setPromptPreview(val)}
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
                                  onClick={() => setPromptPreview(val)}
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
            ) : state.phase === 'assets' ? (
              <div className="flex flex-col gap-3 max-h-[calc(100vh-280px)]">
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
                      <div key={key} className={`flex flex-col min-h-0 gap-2 ${sectionShell(kind)}`}>
                        {/* 标题+一键生成放在滚动区外，避免 tip 被 overflow 裁切 */}
                        <div className="shrink-0 relative z-[50] overflow-visible flex items-center justify-between mb-0 gap-2">
                          <div className={`font-semibold ${sectionTitleCls(kind)}`} style={{ fontSize: fsBody }}>
                            {isMvMode && kind === 'scene'
                              ? tt.phaseMvScenes
                              : `${label} (${state.assets[key].length})`}
                          </div>
                          {isMvMode && kind === 'scene' ? (
                            <div className="shrink-0 relative z-[50] overflow-visible flex items-center justify-end">
                              {renderSceneOneClickGenerate()}
                            </div>
                          ) : null}
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
                                <img src={sbUrl} alt="" className="w-full h-full object-cover" draggable={false} />
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
            <div className="flex items-center justify-center gap-2">{primaryFooter()}</div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default memo(DirectorNode);
