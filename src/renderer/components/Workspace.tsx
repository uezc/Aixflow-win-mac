// @ts-nocheck
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { flushSync, createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import html2canvas from 'html2canvas';
import ReactFlow, {
  Node,
  Edge,
  addEdge,
  applyEdgeChanges,
  Connection,
  useNodesState,
  useEdgesState,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  NodeTypes,
  ReactFlowProvider,
  Handle,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useFrozenFlowZoom } from '../hooks/useFrozenFlowViewport';
import { User, Image, Film, ChevronLeft, ChevronRight, Copy, Download, Maximize2, Minimize2, Trash2, FolderOpen, Power, X } from 'lucide-react';
import { TextNode } from './Canvas/TextNode';
import { MinimalistTextNode } from './Canvas/MinimalistTextNode';
import { LLMNode } from './Canvas/LLMNode';
import { ImageNode } from './Canvas/ImageNode';
import { VideoNode, getVideoLastFrame } from './Canvas/VideoNode';
import { AudioNode, AUDIO_NODE_HEIGHT, AUDIO_NODE_WIDTH, type AudioSeparateAllPayload } from './Canvas/AudioNode';
import { AudioTranscribeNode } from './Canvas/AudioTranscribeNode';
import VideoSpliceNode, { type TimelineClip, type VideoSpliceExportPayload } from './Canvas/VideoSpliceNode';
import { resolveSpliceExportDimensions } from './Canvas/VideoSpliceAspectRatioDropdown';
import PhotoCollageNode, { type CollageLayer } from './Canvas/PhotoCollageNode';
import GridMapNode, { GRID_MAP_HMR_REV, nodeOuterSizeForCanvas } from './Canvas/GridMapNode';
import ImageComparerNode, {
  IMAGE_COMPARER_DEFAULT_H,
  IMAGE_COMPARER_DEFAULT_W,
} from './Canvas/ImageComparerNode';
import ImageTo3dNode from './Canvas/ImageTo3dNode';
import StoryboardScriptNode from './Canvas/StoryboardScriptNode';
import ScriptNode from './Canvas/ScriptNode';
import DirectorNode, { DIRECTOR_DEFAULT_H, DIRECTOR_DEFAULT_W } from './Canvas/DirectorNode';
import { collageLayerSourceNodeId } from '../utils/collageLayerTransform';
import {
  buildPhotoCollageLayersFromEdges,
  MAX_PHOTO_COLLAGE_LAYERS,
  photoCollageRemainingImportSlots,
  resolveImageUrlFromNodeForPhotoCollage,
} from '../utils/photoCollageFromEdges';
import { photoCollageT } from '../i18n/photoCollageI18n';
import {
  buildImageComparerUrlsFromEdges,
  pickImageComparerTargetHandle,
} from '../utils/imageComparerFromEdges';
import {
  buildGridMapCellsFromEdges,
  emptyGridMapCells,
  formatGridMapImagePath,
  DEFAULT_GRID_MAP_CANVAS_H,
  DEFAULT_GRID_MAP_CANVAS_W,
  DEFAULT_GRID_MAP_COLS,
  DEFAULT_GRID_MAP_ROWS,
  type GridMapCell,
} from '../utils/gridMapCompose';
import { isLikelyVideoMediaUrl } from '../utils/mediaPreviewUrl';
import WanAnimateNode from './Canvas/WanAnimateNode';
import HeyGemNode, { HEYGEM_SHELL_W, HEYGEM_SHELL_H } from './Canvas/HeyGemNode';
import FlowContent from './Canvas/FlowContent';
import LLMInputPanel from './Canvas/LLMInputPanel';
import StoryboardScriptInputPanel from './Canvas/StoryboardScriptInputPanel';
import DirectorInputPanel from './Canvas/DirectorInputPanel';
import ImageInputPanel from './Canvas/ImageInputPanel';
import ImageTo3dInputPanel from './Canvas/ImageTo3dInputPanel';
import RvcTrainNode from './Canvas/RvcTrainNode';
import RvcTrainInputPanel from './Canvas/RvcTrainInputPanel';
import VideoInputPanel from './Canvas/VideoInputPanel';
import AudioInputPanel from './Canvas/AudioInputPanel';
import { VideoPreview } from './VideoPreview';
import { ImagePreviewWithTools } from './ImagePreviewWithTools';
import { normalizeVideoUrl } from '../utils/normalizeVideoUrl';
import {
  applyAspectRatioToNodeData,
  aspectRatioLabelFromPixelSize,
  computeNodeSizeFromMedia,
  DEFAULT_IMAGE_ASPECT_RATIO,
  DEFAULT_VIDEO_ASPECT_RATIO,
  hasVideoOutputMedia,
  hasImageOutputMedia,
  imageNodeSizeForAspectRatio,
  IMAGE_NODE_MAX_H,
  IMAGE_NODE_MAX_W,
  IMAGE_NODE_DEFAULT_H,
  IMAGE_NODE_DEFAULT_W,
  IMAGE_NODE_MIN_H,
  IMAGE_NODE_MIN_W,
  nodeStyleDimensions,
  resolveAspectRatioFromNodeData,
  resolveNodeSizeFromMediaData,
  resolveVideoPanelAspectRatioFromNodeData,
  snapToVideoPanelAspectRatio,
  probeImagePixelSize,
  videoNodeSizeForAspectRatio,
  VIDEO_NODE_MAX_H,
  VIDEO_NODE_MAX_W,
  VIDEO_NODE_DEFAULT_H,
  VIDEO_NODE_DEFAULT_W,
  VIDEO_NODE_MIN_H,
  VIDEO_NODE_MIN_W,
} from '../utils/nodeSizeFromAspectRatio';
import {
  applyBuiltClipsToSpliceData,
  collapseDirectorAbsoluteVideoTracks,
  collectSpliceIncomingSourceIds,
  normalizeVideoTracks,
  spliceBuiltHasNewConnectedSources,
  spliceRebuildWouldDropConnected,
} from '../utils/videoSpliceTracks';
import {
  buildVideoSpliceClipsFromEdges,
  isTimelineMediaSourceNodeType,
  mergeProbedTimelineClipDuration,
  probeTimelineMediaDuration,
  resolveSourceMediaDurationSec,
  resolveTimelineMediaFromSource,
  sortNodesByReadingOrder,
  timelineClipsFingerprint,
} from '../utils/timelineSourceMedia';
import { readVideoNodePlaybackTimeSec } from '../utils/videoPlaybackTimeRegistry';
import { probeVideoPixelSize } from '../utils/extractVideoFrame';
import { readVideoInputPanelProgressFromNode } from '../utils/videoInputPanelProgress';
import { recordSetNodesPlaybackCall } from '../utils/videoPlaybackPerfStats';
import { CharacterNode } from './Canvas/CharacterNode';
import { DigitalHumanNode } from './Canvas/DigitalHumanNode';
import { TextSplitNode } from './Canvas/TextSplitNode';
import CameraControlNode from './Canvas/CameraControlNode';
import { MinimalNodePlaceholder, TINY_ZOOM_THRESHOLD_VALUE } from './Canvas/MinimalNodePlaceholder';
import CharacterInputPanel from './Canvas/CharacterInputPanel';
import CanvasToolPanel from './Canvas/CanvasToolPanel';
import {
  type Character,
  type SceneLibraryItem,
  type DigitalHumanLibraryItem,
  sceneDisplay3dImageUrl,
  sceneNormalImageUrl,
  NEXFLOW_CHARACTER_DRAG_MIME,
  NEXFLOW_SCENE_DRAG_MIME,
  NEXFLOW_DIGITAL_HUMAN_DRAG_MIME,
  NEXFLOW_RVC_VOICE_DRAG_MIME,
  deriveRvcPackageDisplayName,
  type RvcVoiceLibraryItem,
  digitalHumanVideoUrl,
  digitalHumanPosterUrl,
  isImageTo3dLibraryCharacter,
  resolveCharacterVoiceUrlForDrag,
  rvcVoiceAvatarUrl,
  rvcVoiceDisplayName,
  rvcVoiceModelPackageUrl,
  rvcVoiceTrainAudioUrl,
} from './characterListShared';
import { scenePanoramaUrlForCanvas } from './SceneLibraryList';
import { buildImageTo3dNodeFromCharacter } from '../utils/imageTo3dCanvasPlacement';
import { buildEmptyRvcTrainNode, buildRvcTrainNodeFromLibraryItem, resolveRvcTrainNickname } from '../utils/rvcTrainCanvasPlacement';
import { resolveRvcTrainAudioFromEdges } from '../utils/rvcTrainNodeEdgeInputs';
import { ensureOssAudioUrlForRhTrain, pickBestAudioUrlForRhTrainFromNodeData } from '../utils/rvcTrainAudioUrl';
import { promptNxSaasLoginIfNeeded } from '../utils/cloudAiGateMessage';
import { RVC_TRAIN_HEIGHT, RVC_TRAIN_WIDTH } from '../constants/rvcTrainLayout';
import { IMAGE_TO_3D_HEIGHT, IMAGE_TO_3D_WIDTH } from '../constants/imageTo3dLayout';
import {
  MODULE_DISPLAY_SCALE,
  MODULE_SIZE_SCALE_VERSION,
  needsModuleSizeScaleUpgrade,
  scaleModulePx,
} from '../utils/moduleDisplayScale';
import { DEFAULT_IMAGE_TO_3D_MODEL } from '../../shared/imageTo3dModels';
import {
  createDefaultStoryboardScriptState,
  type StoryboardScriptState,
} from '../../shared/storyboardScript';
import {
  buildDirectorMvImagePreviewClips,
  buildDirectorMvVideoPreviewClips,
  composeDirectorShotVideoPrompt,
  ensureDirectorLipsyncMouthVisiblePrompt,
  createDefaultDirectorPipelineState,
  getDirectorShotStoryboard,
  getOrderedAssetsWithImages,
  getValidDirectorShotSongClipUrl,
  packLyricSegmentsIntoShotPacks,
  parseDirectorShotDurationSec,
  replaceDirectorMvPlaceholdersWithVideos,
  resolveDirectorShotMusicRange,
  resolveDirectorShotPreferLipsync,
  shotAudioRangeHasHumanVoice,
  updateDirectorAsset,
  updateDirectorShotStoryboard,
  type DirectorPipelineState,
} from '../../shared/directorPipeline';
import { importImageTo3dAssetsToCharacters } from '../utils/importImageTo3dAsset';
import { userFacingErrorMessage } from '../utils/userErrorMessageCn';
import WorkspaceHeader from './Workspace/WorkspaceHeader';
import { OptionalEngineDownloadBar } from './Canvas/OptionalEngineDownloadBar';
import WorkspaceSidebar from './Workspace/WorkspaceSidebar';
import { mapProjectPath } from '../utils/pathMapper';
import { useDarkAlert } from '../contexts/DarkAlertContext';
import { useAppLocale } from '../contexts/AppLocaleContext';
import { CanvasThemeProvider, useCanvasTheme } from '../contexts/CanvasThemeContext';
import { LlmInputPanelProvider } from '../contexts/LlmInputPanelContext';
import { StoryboardScriptInputPanelProvider } from '../contexts/StoryboardScriptInputPanelContext';
import { DirectorInputPanelProvider } from '../contexts/DirectorInputPanelContext';
import { ImageInputPanelProvider } from '../contexts/ImageInputPanelContext';
import { VideoInputPanelProvider } from '../contexts/VideoInputPanelContext';
import {
  HeyGemInlinePanelProvider,
  type HeyGemInlinePanelApi,
} from '../contexts/HeyGemInlinePanelContext';
import { AudioInputPanelProvider } from '../contexts/AudioInputPanelContext';
import { ImageTo3dInputPanelProvider } from '../contexts/ImageTo3dInputPanelContext';
import { workspaceChromeT } from '../i18n/workspaceI18n';
import { assetLibraryT } from '../i18n/assetLibraryI18n';
import { imageNodeChromeT } from '../i18n/imageNodeI18n';
import { PERF_POLICY } from '../config/perfPolicy';
import { HIDE_SORA2_AND_SORA_CHARACTER_UI, DEFAULT_VIDEO_MODEL_REPLACING_SORA2 } from '../config/sora2UiPolicy';
import { HIDE_DIRECTOR_STAGE_UI } from '../config/directorUiPolicy';
import { isRetiredVideoModel, normalizeVideoModelIfRetired } from '../config/videoModelUiPolicy';
import { isRetiredImageModel, normalizeImageModelIfRetired } from '../config/imageModelUiPolicy';
import { zImageDimensionsForAspect } from '../../common/zImageDimensions';
import {
  splitLtx23HdrMultiImagesFromCollected,
  buildLtx23HdrMultiPayload,
  isLtx23HdrMultiRunnable,
  validateLtx23HdrMultiInputs,
  mergeLtx23HdrMultiPreserveOrder,
} from '../../common/ltx23HdrMulti';
import { isRetiredAudioModel, normalizeAudioModelIfRetired } from '../config/audioModelUiPolicy';
import {
  normalizeGrok3DurationStr,
  normalizeRhartVideoXDurationStr,
  normalizeGrok3StableDurationStr,
  normalizeLtx23DurationChoice,
  normalizeSeedanceDurationChoice,
  normalizeGeminiOmniDurationChoice,
  normalizeGeminiOmniFlashDurationChoice,
  coerceSeedanceResolution,
  coerceSeedanceRatio,
} from '../utils/videoBillingSku';
import {
  buildDirectorSpawnedVideoInvokeInput,
  buildDirectorSpawnedVideoNodeData,
  directorVideoBatchLayoutAspect,
  isDirectorLipsyncModel,
  normalizeDirectorVideoBatchAspect,
  normalizeDirectorVideoBatchDuration,
  normalizeDirectorVideoBatchModel,
  normalizeDirectorVideoBatchResolution,
  normalizeDirectorVideoLipsyncModel,
  pickNearestDirectorVideoBatchDuration,
  prepareDirectorShotVideoPayload,
} from '../utils/directorVideoBatch';
import {
  bindContainerRef,
  setNodePositions,
  flushPositions,
  startSyncLoop,
  stopSyncLoop,
  hasPendingPositions,
} from '../utils/nativeNodePositionSync';
import { getGlobalInteractionSnapshot, useGlobalInteractionSelector, setIsExiting, setActiveVideoNodeId, triggerEmergencyVideoUnload } from '../utils/globalInteractionStore';
import { readIsDarkMode, writeIsDarkMode } from '../utils/appTheme';
import {
  isConnectionAllowed,
  CHARACTER_OUTPUT_AUDIO_HANDLE,
  DEFAULT_REFERENCE_TRANSMIT_SLOTS,
  getCharacterTransmitImageUrls,
  resolveReferenceTransmitSlots,
} from '../utils/connectionRules';
import {
  collectUpstreamTextPartsForTarget,
  collectLinkedTextTitlesForTarget,
  normalizeTextSplitSourceHandle,
  pickTextSplitSegmentText,
  resolveLlmInputTextFromEdges,
  resolveTextSplitSegments,
} from '../utils/textSplitSegmentUtils';
import {
  isDigitalHumanAudioOutputHandle,
  isDigitalHumanVideoOutputHandle,
  pickDigitalHumanAudioUrl,
  pickDigitalHumanVideoUrl,
} from '../utils/digitalHumanNodeMedia';
import { useNxModelPricing } from '../contexts/NxModelPricingContext';
import type { NxModelConfigRow } from '../utils/nxModelConfigPricingCache';
import {
  getNodeDisplayPrice,
  getMattingDisplayPrice,
  getWatermarkRemovalDisplayPrice,
  getImageUpscaleV3DisplayPrice,
  getCharacterMultiAngleDisplayPrice,
  getLlmChatDisplayPrice,
  IMAGE_REVERSE_DEFAULT_MODEL,
  normalizeImageReverseCaptionModel,
  type ImageReverseCaptionModel,
} from '../utils/cloudModelPricing';
import { isAudioSongModel, buildMusicDownloadSuggestedName, audioDisplayTitleFromFileName, resolveAudioNodeDisplayTitle } from '../utils/audioSongModels';
import { buildAudioIncomingPatchFromEdges, buildCoverTargetPatchesAfterSourceDurationChange } from '../utils/audioNodeEdgeInputs';
import {
  DOUBAO_SEED_AUDIO_MODEL_ID,
  isDoubaoSeedAudioModel,
  clampDoubaoSpeechRate,
  clampDoubaoLoudnessRate,
} from '../utils/doubaoSeedAudioModel';
import { isAudioCoverModel, AI_VOICE_COVER_MODEL_ID, resolveRvcCoverModelPath, deriveRvcCoverModelPath, normalizeRvcCoverOutputMode, clampCoverPitch, clampCoverIndexRate, clampCoverVocalMixPct, clampCoverAccompanimentMixPct, resolveCoverAccompanimentMixPct, type RvcCoverOutputMode } from '../utils/audioCoverModel';
import { isRvcTrainModel, RVC_VOICE_TRAIN_MODEL_ID } from '../utils/audioRvcTrainModel';
import { isRvcModelPackageUrl } from '../../shared/rvcVoiceTrainUtils';
import { CANVAS_PICK_NODE_EVENT, syncCanvasPickState } from '../utils/canvasPickStore';
import { OPEN_ASSET_LIBRARY_EVENT } from '../utils/assetLibraryOpenStore';
import { syncQuickConnectState, showQuickConnectToast } from '../utils/quickConnectStore';

/** 旧存盘分辨率与面板挡位 720P/1080P 对齐 */
function coerceVideoWanAnimateResolution(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === '1080p' || s === '1080' || s === '1920x1080' || s === '1080x1920') return '1080p';
  // 旧 480P 档统一归到 720P
  if (s === '480p' || s === '480') return '720p';
  return '720p';
}

function coerceWanAnimateClipSec(v) {
  const s = String(v ?? '8').trim();
  if (s === '5' || s === '10' || s === '15') return s;
  return '8';
}

function coerceVideoSeedanceResolution(v, model = 'seedance-2.0-fast') {
  return coerceSeedanceResolution(v, model);
}

function coerceVideoGeminiOmniResolution(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === '1080p' || s === '1080') return '1080p';
  if (s === '4k') return '4k';
  return '720p';
}

const CARD_BG_STORAGE_KEY = 'nexflow-project-card-bg';
const getCardBgKey = (projectId: string) => `${CARD_BG_STORAGE_KEY}-${projectId}`;
type VideoInteractionSettings = {
  profile: 'smooth' | 'performance';
  ultraNearZoomThreshold: number;
  fpsDropThreshold: number;
  interactionResumeDelayMs: number;
  fastMoveSpeedThreshold: number;
  prefetchScreenFactor: number;
};
const DEFAULT_VIDEO_INTERACTION_SETTINGS: VideoInteractionSettings = {
  profile: 'smooth',
  ultraNearZoomThreshold: 0.95,
  fpsDropThreshold: PERF_POLICY.fpsP1Threshold,
  interactionResumeDelayMs: 80,
  fastMoveSpeedThreshold: 6000,
  prefetchScreenFactor: PERF_POLICY.prefetchScreenFactor,
};

/** 视频帧 canvas 最大纹理边长，超过会按比例缩小，避免 GPU 崩溃 */
const MAX_TEXTURE_SIZE = 2048;

/** 仅远程 http(s) 视频需 crossOrigin；本地 local-resource / file / data URL 设 anonymous 易导致无法解码或 canvas 污染、toDataURL 失败。 */
function configureVideoElementCrossOriginForCapture(video: HTMLVideoElement, videoUrl: string) {
  const u = (videoUrl || '').trim();
  if (/^https?:\/\//i.test(u)) {
    video.crossOrigin = 'anonymous';
  } else {
    video.removeAttribute('crossOrigin');
  }
}

/** 同一视频 URL + 同一时刻的多次「视频→图」连边合并为一次抽帧，避免并发多个 <video> 解码同一源导致全部失败 */
type VideoStillCoalesceEntry = { targetIds: Set<string>; promise: Promise<{ success: boolean; imageUrl?: string; error?: string }> };
const videoStillCoalesceByKey = new Map<string, VideoStillCoalesceEntry>();

function videoStillCoalesceKey(normalizedUrl: string, t: number | undefined) {
  const tKey =
    typeof t === 'number' && Number.isFinite(t) ? String(Math.round(t * 10000) / 10000) : 'na';
  return `${normalizedUrl}@@${tKey}`;
}

/**
 * 从音频节点 data 取可传给下游的音频地址（与 AudioNode 可播放字段顺序一致）。
 * 本地上传参考音等可能仅在 referenceAudioUrl，旧逻辑若只读 outputAudio 会导致视频侧「未接入音频」。
 */
function pickAudioOutputUrlFromAudioNodeData(data: Record<string, unknown> | undefined): string | undefined {
  if (!data) return undefined;
  const multi = Array.isArray(data.outputAudios)
    ? (data.outputAudios as unknown[]).map((u) => String(u || '').trim()).filter(Boolean)
    : [];
  const raw = (data.originalAudioUrl ?? data.outputAudio ?? multi[0] ?? data.referenceAudioUrl) as string | undefined;
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s || undefined;
}

/** 浏览器探测音频时长（秒），失败返回 0 */
function probeHtmlAudioDurationSec(url: string): Promise<number> {
  const src = String(url || '').trim();
  if (!src) return Promise.resolve(0);
  return new Promise((resolve) => {
    try {
      const audio = new Audio();
      audio.preload = 'metadata';
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
      audio.src = src;
    } catch {
      resolve(0);
    }
  });
}

// 截取视频第一帧的工具函数
async function extractVideoFirstFrame(videoUrl: string): Promise<{ success: boolean; imageUrl?: string; error?: string }> {
  return new Promise((resolve) => {
    try {
      const video = document.createElement('video');
      configureVideoElementCrossOriginForCapture(video, videoUrl);
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      
      // 设置视频源
      video.src = videoUrl;
      
      // 当视频可以播放时，截取第一帧
      video.addEventListener('loadeddata', () => {
        try {
          video.currentTime = 0.1; // 设置到 0.1 秒，确保能获取到帧
        } catch (error) {
          console.error('[截取视频帧] 设置 currentTime 失败:', error);
        }
      });
      
      // 当视频帧可以渲染时，截取（限制 canvas 最大尺寸，避免超大纹理导致 GPU 崩溃）
      video.addEventListener('seeked', () => {
        try {
          let w = video.videoWidth;
          let h = video.videoHeight;
          if (!w || !h) {
            resolve({ success: false, error: '视频尚未解码出画面' });
            return;
          }
          if (w > MAX_TEXTURE_SIZE || h > MAX_TEXTURE_SIZE) {
            const r = Math.min(MAX_TEXTURE_SIZE / w, MAX_TEXTURE_SIZE / h);
            w = Math.round(w * r);
            h = Math.round(h * r);
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve({ success: false, error: '无法获取 canvas 上下文' });
            return;
          }

          ctx.drawImage(video, 0, 0, w, h);
          let imageUrl: string;
          try {
            imageUrl = canvas.toDataURL('image/png');
          } catch (e: any) {
            console.error('[截取视频帧] toDataURL 失败:', e);
            resolve({ success: false, error: e?.message || '导出帧失败' });
            return;
          }
          if (!imageUrl || imageUrl.length < 32) {
            resolve({ success: false, error: '导出帧为空' });
            return;
          }

          video.src = '';
          video.load();

          resolve({ success: true, imageUrl });
        } catch (error: any) {
          console.error('[截取视频帧] 截取失败:', error);
          resolve({ success: false, error: error.message || '截取视频帧失败' });
        }
      });
      
      // 错误处理
      video.addEventListener('error', (e) => {
        console.error('[截取视频帧] 视频加载失败:', e);
        resolve({ success: false, error: '视频加载失败' });
      });
      
      // 超时处理（10秒）
      setTimeout(() => {
        if (video.readyState < 2) {
          video.src = '';
          video.load();
          resolve({ success: false, error: '视频加载超时' });
        }
      }, 10000);
      
      // 开始加载视频
      video.load();
    } catch (error: any) {
      console.error('[截取视频帧] 创建视频元素失败:', error);
      resolve({ success: false, error: error.message || '创建视频元素失败' });
    }
  });
}

// 截取视频最后一帧的工具函数
async function extractVideoLastFrame(videoUrl: string): Promise<{ success: boolean; imageUrl?: string; error?: string }> {
  return new Promise((resolve) => {
    try {
      const video = document.createElement('video');
      configureVideoElementCrossOriginForCapture(video, videoUrl);
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      video.src = videoUrl;

      video.addEventListener('loadedmetadata', () => {
        try {
          video.currentTime = Math.max(0, (video.duration || 0) - 0.1);
        } catch (error) {
          console.error('[截取视频最后一帧] 设置 currentTime 失败:', error);
        }
      });

      video.addEventListener('seeked', () => {
        try {
          let w = video.videoWidth;
          let h = video.videoHeight;
          if (!w || !h) {
            resolve({ success: false, error: '视频尚未解码出画面' });
            return;
          }
          if (w > MAX_TEXTURE_SIZE || h > MAX_TEXTURE_SIZE) {
            const r = Math.min(MAX_TEXTURE_SIZE / w, MAX_TEXTURE_SIZE / h);
            w = Math.round(w * r);
            h = Math.round(h * r);
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve({ success: false, error: '无法获取 canvas 上下文' });
            return;
          }
          ctx.drawImage(video, 0, 0, w, h);
          let imageUrl: string;
          try {
            imageUrl = canvas.toDataURL('image/png');
          } catch (e: any) {
            console.error('[截取视频最后一帧] toDataURL 失败:', e);
            resolve({ success: false, error: e?.message || '导出帧失败' });
            return;
          }
          if (!imageUrl || imageUrl.length < 32) {
            resolve({ success: false, error: '导出帧为空' });
            return;
          }
          video.src = '';
          video.load();
          resolve({ success: true, imageUrl });
        } catch (error: any) {
          console.error('[截取视频最后一帧] 截取失败:', error);
          resolve({ success: false, error: error.message || '截取视频最后一帧失败' });
        }
      });

      video.addEventListener('error', (e) => {
        console.error('[截取视频最后一帧] 视频加载失败:', e);
        resolve({ success: false, error: '视频加载失败' });
      });

      setTimeout(() => {
        if (video.readyState < 2) {
          video.src = '';
          video.load();
          resolve({ success: false, error: '视频加载超时' });
        }
      }, 10000);

      video.load();
    } catch (error: any) {
      console.error('[截取视频最后一帧] 创建视频元素失败:', error);
      resolve({ success: false, error: error.message || '创建视频元素失败' });
    }
  });
}

/** 截取视频中指定时刻的一帧（秒），时间会在 [0, duration] 内夹紧 */
async function extractVideoFrameAtTime(
  videoUrl: string,
  timeSec: number | undefined
): Promise<{ success: boolean; imageUrl?: string; error?: string }> {
  return new Promise((resolve) => {
    try {
      const video = document.createElement('video');
      configureVideoElementCrossOriginForCapture(video, videoUrl);
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      video.src = videoUrl;

      let settled = false;
      const finish = (ok: boolean, imageUrl?: string, error?: string) => {
        if (settled) return;
        settled = true;
        try {
          video.src = '';
          video.load();
        } catch (_) {
          /* ignore */
        }
        resolve(ok ? { success: true, imageUrl } : { success: false, error });
      };

      video.addEventListener('loadedmetadata', () => {
        try {
          const dur = video.duration;
          let t = typeof timeSec === 'number' && Number.isFinite(timeSec) ? timeSec : 0.1;
          if (Number.isFinite(dur) && dur > 0) {
            const eps = 0.05;
            const hi = Math.max(eps, dur - eps);
            const lo = Math.min(eps, hi);
            t = Math.min(Math.max(lo, t), hi);
          } else {
            t = Math.max(0.1, t);
          }
          video.currentTime = t;
        } catch (error) {
          console.error('[截取视频当前帧] 设置 currentTime 失败:', error);
        }
      });

      video.addEventListener('seeked', () => {
        try {
          let w = video.videoWidth;
          let h = video.videoHeight;
          if (!w || !h) {
            finish(false, undefined, '视频尚未解码出画面，请稍后再试或重连');
            return;
          }
          if (w > MAX_TEXTURE_SIZE || h > MAX_TEXTURE_SIZE) {
            const r = Math.min(MAX_TEXTURE_SIZE / w, MAX_TEXTURE_SIZE / h);
            w = Math.round(w * r);
            h = Math.round(h * r);
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            finish(false, undefined, '无法获取 canvas 上下文');
            return;
          }
          ctx.drawImage(video, 0, 0, w, h);
          let imageUrl: string;
          try {
            imageUrl = canvas.toDataURL('image/png');
          } catch (e: any) {
            console.error('[截取视频当前帧] toDataURL 失败（可能被跨域污染）:', e);
            finish(false, undefined, e?.message || '导出帧失败');
            return;
          }
          if (!imageUrl || imageUrl.length < 32) {
            finish(false, undefined, '导出帧为空');
            return;
          }
          finish(true, imageUrl);
        } catch (error: any) {
          console.error('[截取视频当前帧] 截取失败:', error);
          finish(false, undefined, error.message || '截取视频当前帧失败');
        }
      });

      video.addEventListener('error', (e) => {
        console.error('[截取视频当前帧] 视频加载失败:', e);
        finish(false, undefined, '视频加载失败');
      });

      setTimeout(() => {
        if (!settled && video.readyState < 2) {
          finish(false, undefined, '视频加载超时');
        }
      }, 10000);

      video.load();
    } catch (error: any) {
      console.error('[截取视频当前帧] 创建视频元素失败:', error);
      resolve({ success: false, error: error.message || '创建视频元素失败' });
    }
  });
}

/** 优先读画布上 <video> 的实时 currentTime，避免节点 data 上 playbackCurrentTimeSec 被 200ms 节流拖慢 */
function resolveVideoStillCaptureTimeSec(sourceNode: { id: string; data?: unknown }): number | undefined {
  const live = readVideoNodePlaybackTimeSec(sourceNode.id);
  if (live != null && Number.isFinite(live)) return live;
  const d = (sourceNode.data as { playbackCurrentTimeSec?: number } | undefined)?.playbackCurrentTimeSec;
  return typeof d === 'number' && Number.isFinite(d) ? d : undefined;
}

interface WorkspaceProps {
  projectId?: string;
}

// 自定义节点组件
const CustomNode: React.FC<{ data: { label: string; preview?: string } }> = ({ data }) => {
  return (
    <div className="apple-panel rounded-lg p-4 min-w-[200px]">
      {data.preview && (
        <div className="w-full h-32 bg-white/5 rounded mb-2 mb-3 flex items-center justify-center">
          <Image className="w-8 h-8 text-white/60" />
        </div>
      )}
      <div className="text-white font-medium text-sm">{data.label}</div>
    </div>
  );
};


// API 状态类型
// 任务类型
interface Task {
  id: string;
  nodeId: string;
  nodeTitle: string;
  imageUrl?: string;
  outputImages?: string[];
  videoUrl?: string; // 视频 URL
  audioUrl?: string; // 音频 URL
  prompt: string;
  createdAt: number; // 时间戳
  /** 完成时固化的耗时（秒），用于「已完成」后仍显示运行时长 */
  durationSec?: number;
  /** 预估消耗元宝（与画布定价表一致） */
  yuanbaoConsumed?: number;
  status?: 'success' | 'error' | 'processing' | 'running' | 'failed' | 'timeout'; // 任务状态
  errorMessage?: string; // 错误信息
  taskType?: 'image' | 'video' | 'text' | 'audio'; // 任务类型
  localFilePath?: string; // 本地文件路径
  /** 远程结果 URL（与 imageUrl 可能不同：后者会先 http 后 local-resource），用于任务列表去重 */
  originalImageUrl?: string;
  /** 远程结果 URL（与 videoUrl 可能不同：同一次生成先 http 后 local-resource），用于任务列表去重 */
  originalVideoUrl?: string;
  /** RunningHub /query 的 taskId，用于崩溃/强退后恢复轮询 */
  runningHubTaskId?: string;
}

type DualImageAsset = {
  preview: string;
  original: string;
  width?: number;
  height?: number;
};

/** 画布导入邻接间距：96dpi 下 1cm ≈ 37.8px */
const IMPORT_CANVAS_GAP_PX = 37.8;

const buildDualImageAssetFromNodeData = (data: any): DualImageAsset | null => {
  const asset = data?.imageAsset as { preview?: string; original?: string } | undefined;
  const preview =
    (data?.outputImage as string) ||
    (asset?.preview as string) ||
    (typeof data?.avatar === 'string' ? data.avatar.trim() : '') ||
    '';
  const original = (data?.originalImageUrl as string) || asset?.original || preview;
  if (!preview && !original) return null;
  return {
    preview: preview || original,
    original: original || preview,
    width: typeof data?.width === 'number' ? data.width : undefined,
    height: typeof data?.height === 'number' ? data.height : undefined,
  };
};

const pickPreviewUrl = (asset: DualImageAsset | null): string => (asset?.preview || '');

function pickImageUrlFromImageSourceNode(sourceNode: Node | undefined): string {
  if (!sourceNode || sourceNode.type !== 'image') return '';
  return (
    pickPreviewUrl(buildDualImageAssetFromNodeData(sourceNode.data)) ||
    (sourceNode.data?.outputImage as string) ||
    (sourceNode.data?.originalImageUrl as string) ||
    (Array.isArray(sourceNode.data?.outputImages) && sourceNode.data.outputImages[0]) ||
    ''
  );
}

function collectStoryboardScriptMediaFromEdges(
  nodeId: string,
  nodes: Node[],
  edges: Edge[],
): { imageUrls: string[]; videoUrls: string[]; textParts: string[] } {
  const imageUrls: string[] = [];
  const videoUrls: string[] = [];
  const textParts: string[] = [];
  for (const edge of edges.filter((e) => e.target === nodeId)) {
    const src = nodes.find((n) => n.id === edge.source);
    if (!src) continue;
    if (src.type === 'image') {
      const url = pickImageUrlFromImageSourceNode(src);
      if (url) imageUrls.push(url);
    } else if (isVideoTrackSourceNodeType(src.type)) {
      const url =
        pickReferenceVideoFromSourceNode(src, edge.sourceHandle) ||
        String(
          src.data?.outputVideo ||
            src.data?.originalVideoUrl ||
            src.data?.outputVideoUrl ||
            src.data?.videoUrl ||
            src.data?.localUrl ||
            '',
        ).trim();
      if (url) videoUrls.push(url);
    } else if (src.type === 'minimalistText' || src.type === 'text') {
      if (src.data?.text) textParts.push(String(src.data.text).trim());
    } else if (src.type === 'llm' && src.data?.outputText) {
      textParts.push(String(src.data.outputText).trim());
    } else if (src.type === 'textSplit') {
      const segText = pickTextSplitSegmentText(src.data, edge.sourceHandle);
      if (segText) textParts.push(segText);
    }
  }
  return { imageUrls, videoUrls, textParts };
}

/** 分镜脚本 → 下游：取勾选行（无勾选则全部）的图片/视频提示词 */
function pickStoryboardScriptPromptsForDownstream(
  sourceNode: Node | undefined | null,
  kind: 'image' | 'video',
): string {
  if (!sourceNode || sourceNode.type !== 'storyboardScript') return '';
  const script = createDefaultStoryboardScriptState(
    (sourceNode.data as { storyboardScript?: StoryboardScriptState })?.storyboardScript || {},
  );
  const indexes =
    script.selectedRowIndexes?.length > 0
      ? script.selectedRowIndexes
      : script.rows.map((_, i) => i);
  const key = kind === 'video' ? '视频提示词' : '图片提示词';
  const parts: string[] = [];
  for (const i of indexes) {
    const row = script.rows[i];
    if (!row) continue;
    const text = String(row[key] || '').trim();
    if (text) parts.push(text);
  }
  return parts.join('\n\n');
}

/** 图片转 3D：参考图（仅 input 入边；连线图片不作为贴图） */
const resolveImageTo3dInputUrl = (node: Node, edges: Edge[], nodes: Node[]): string => {
  for (const edge of edges.filter((e) => e.target === node.id)) {
    const url = pickImageUrlFromImageSourceNode(nodes.find((n) => n.id === edge.source));
    if (url) return url;
  }
  return (node.data?.inputImageUrl as string) || '';
};

/**
 * 参考图：务必以**源 Image 节点当前 data** 为准，其次才用建连时缓存在边上的 imageAsset。
 * 若优先边缓存，源节点出图/换图后边数据若未及时与节点一致，下游会一直用错参考图（图生图内容跑偏）。
 */
const pickPreviewFromEdgeOrNode = (edge: any, sourceNodeData: any): string => {
  const fromNode = pickPreviewUrl(buildDualImageAssetFromNodeData(sourceNodeData));
  if (fromNode) return fromNode;
  return ((edge?.data as any)?.imageAsset?.preview as string | undefined) || '';
};

/** 从指向 Image 的入边收集参考图 URL（含角色多槽勾选） */
function collectImageTargetInputImagesFromEdges(imageId: string, nds: Node[], eds: Edge[]): string[] {
  const imageSourceEdges = eds.filter((e) => {
    if (e.target !== imageId) return false;
    const src = nds.find((n) => n.id === e.source);
    if (src?.type === 'image') return true;
    if (src?.type === 'character') {
      const sh = e.sourceHandle || '';
      return sh !== CHARACTER_OUTPUT_AUDIO_HANDLE && sh !== 'output-audio';
    }
    return false;
  });
  const collected: string[] = [];
  for (const edge of imageSourceEdges) {
    const src = nds.find((n) => n.id === edge.source);
    if (!src) continue;
    if (src.type === 'character') {
      for (const u of getCharacterTransmitImageUrls(src.data as Record<string, unknown>)) {
        if (u && !collected.includes(u)) collected.push(u);
      }
    } else if (src.type === 'image') {
      const u =
        pickPreviewFromEdgeOrNode(edge, src.data) ||
        (src.data?.outputImage as string) ||
        (typeof src.data?.avatar === 'string' ? src.data.avatar.trim() : '') ||
        (src.data?.originalImageUrl as string) ||
        (src.data?.inputImages as string[])?.[0];
      if (u && !collected.includes(u)) collected.push(u);
    }
  }
  return collected.slice(0, 10);
}

function urlsRoughlyEqual(a: string, b: string): boolean {
  const x = String(a || '').trim();
  const y = String(b || '').trim();
  if (!x || !y) return false;
  if (x === y) return true;
  try {
    return decodeURIComponent(x) === decodeURIComponent(y);
  } catch {
    return false;
  }
}

/**
 * 面板删除某张参考图时：断开提供该 URL 的入边（图片源整边删除；角色源取消对应槽勾选）。
 * 返回是否改动了边或角色槽位（调用方仍应同步更新 target.inputImages）。
 */
function disconnectIncomingRefImageEdges(
  targetId: string,
  wantUrl: string,
  nds: Node[],
  eds: Edge[],
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>,
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>,
): void {
  const want = String(wantUrl || '').trim();
  if (!targetId || !want) return;

  // 角色节点：取消对应视图传出勾选
  for (const edge of eds) {
    if (edge.target !== targetId) continue;
    const th = edge.targetHandle || 'input';
    if (th !== 'input' && th !== 'video-input' && th !== 'image-input') continue;
    const src = nds.find((n) => n.id === edge.source);
    if (!src || src.type !== 'character') continue;
    const sh = edge.sourceHandle || '';
    if (sh === CHARACTER_OUTPUT_AUDIO_HANDLE || sh === 'output-audio') continue;
    const vi = Array.isArray(src.data?.viewImages) ? (src.data.viewImages as string[]) : [];
    const mask = resolveReferenceTransmitSlots(src.data?.referenceTransmitSlots);
    let hit = -1;
    for (let i = 0; i < 4; i++) {
      const u = typeof vi[i] === 'string' ? vi[i].trim() : '';
      if (u && mask[i] && urlsRoughlyEqual(u, want)) {
        hit = i;
        break;
      }
    }
    if (hit < 0) continue;
    const nextMask = [...mask];
    nextMask[hit] = false;
    if (nextMask.every((x) => !x)) {
      setEdges((prev) => prev.filter((e) => e.id !== edge.id));
    } else {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === src.id ? { ...n, data: { ...n.data, referenceTransmitSlots: nextMask } } : n,
        ),
      );
    }
    return;
  }

  // 图片 / 其它可出图源：删除提供该 URL 的入边
  setEdges((prev) =>
    prev.filter((edge) => {
      if (edge.target !== targetId) return true;
      const th = edge.targetHandle || 'input';
      if (th !== 'input' && th !== 'video-input' && th !== 'image-input') return true;
      const src = nds.find((n) => n.id === edge.source);
      if (!src) return true;
      if (src.type === 'character') return true;
      const u =
        pickPreviewFromEdgeOrNode(edge, src.data) ||
        (src.data?.outputImage as string) ||
        (typeof src.data?.avatar === 'string' ? src.data.avatar.trim() : '') ||
        (src.data?.originalImageUrl as string) ||
        (src.data?.inputImages as string[])?.[0] ||
        '';
      if (!u) return true;
      return !urlsRoughlyEqual(String(u), want);
    }),
  );
}

/**
 * 合并参考图列表：保留用户拖拽后的相对顺序，只增删/替换缺失项。
 * 避免连线同步按边顺序把面板排序冲掉。
 */
function mergeInputImagesPreserveOrder(current: string[] | undefined, incoming: string[]): string[] {
  const next = (incoming || []).filter((u) => typeof u === 'string' && u.trim()).slice(0, 10);
  const prev = (current || []).filter((u) => typeof u === 'string' && u.trim());
  if (next.length === 0) return [];
  if (prev.length === 0) return next;
  const nextSet = new Set(next);
  const kept = prev.filter((u) => nextSet.has(u));
  if (kept.length === next.length) return kept.slice(0, 10);
  const keptSet = new Set(kept);
  const appended = next.filter((u) => !keptSet.has(u));
  if (kept.length === 0 && prev.length === next.length) return next;
  return [...kept, ...appended].slice(0, 10);
}

/** 从指向 Video / 视频换人 的 input 入边收集参考图（含角色卡多槽勾选） */
function collectVideoTargetInputImagesFromEdges(videoId: string, nds: Node[], eds: Edge[]): string[] {
  const collected: string[] = [];
  for (const edge of eds) {
    if (edge.target !== videoId) continue;
    const targetHandle = edge.targetHandle || 'input';
    if (targetHandle !== 'input' && targetHandle !== 'video-input') continue;
    const src = nds.find((n) => n.id === edge.source);
    if (!src) continue;
    if (src.type === 'character') {
      const sh = edge.sourceHandle || '';
      if (sh === CHARACTER_OUTPUT_AUDIO_HANDLE || sh === 'output-audio') continue;
      for (const u of getCharacterTransmitImageUrls(src.data as Record<string, unknown>)) {
        if (u && !collected.includes(u)) collected.push(u);
      }
    } else if (src.type === 'image') {
      const u =
        pickPreviewFromEdgeOrNode(edge, src.data) ||
        (src.data?.outputImage as string) ||
        (typeof src.data?.avatar === 'string' ? src.data.avatar.trim() : '') ||
        (src.data?.originalImageUrl as string) ||
        (src.data?.inputImages as string[])?.[0];
      if (u && !collected.includes(u)) collected.push(u);
    }
  }
  return collected.slice(0, 10);
}

/** 从画布节点提取角色库「参考图」URL（图片模块或角色模块头像） */
function pickCharacterLibraryAvatarUrlFromNode(node: Node): string | null {
  const t = node?.type;
  if (t !== 'image' && t !== 'character') return null;
  const asset = buildDualImageAssetFromNodeData(node.data || {});
  if (!asset) return null;
  const url = (pickPreviewUrl(asset) || asset.original || '').trim();
  return url || null;
}

/** 与 handleMenuSelect 中 isAudioType 对齐；旧工程可能仍存此类 type 字符串 */
const CHARACTER_LIBRARY_VOICE_AUDIO_TYPES = new Set([
  'audio',
  'audio-extract-from-video',
  'audio-extract-vocals',
  'audio-extract-background',
]);

/** 从画布节点提取角色库「参考音」URL（音频模块、语音转写、含音轨的文本模块等） */
function pickCharacterLibraryVoiceUrlFromNode(node: Node): { url: string; label: string } | null {
  const t = node?.type;
  const d = (node.data || {}) as Record<string, unknown>;
  const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string).trim() : '');
  const title = str('title') || '';

  if (t && CHARACTER_LIBRARY_VOICE_AUDIO_TYPES.has(t)) {
    const url = str('outputAudio') || str('originalAudioUrl') || str('referenceAudioUrl');
    if (!url) return null;
    return { url, label: title || '音频模块' };
  }
  if (t === 'audioTranscribe') {
    const url = str('audioUrl');
    if (!url) return null;
    return { url, label: title || '语音转写' };
  }
  if (t === 'minimalistText' || t === 'text') {
    const url = str('outputAudio') || str('originalAudioUrl') || str('referenceAudioUrl');
    if (!url) return null;
    return { url, label: title || '文本模块' };
  }
  if (t === 'character') {
    const url = str('voiceClip') || str('referenceAudioUrl') || str('outputAudio') || str('originalAudioUrl');
    if (!url) return null;
    return { url, label: title || '角色' };
  }
  if (t === 'digitalHuman') {
    const url = pickDigitalHumanAudioUrl(d);
    if (!url) return null;
    return { url, label: title || '数字人' };
  }
  return null;
}

/** 从画布节点提取数字人库「参考视频」URL（视频 / HeyGem / 视频换人 / 数字人源模块） */
function pickDigitalHumanVideoUrlFromNode(node: Node): string | null {
  if (node?.type === 'digitalHuman') {
    const url = pickDigitalHumanVideoUrl(node.data as Record<string, unknown>);
    return url || null;
  }
  if (!isVideoTrackSourceNodeType(node?.type)) return null;
  const d = (node.data || {}) as Record<string, unknown>;
  const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string).trim() : '');
  const url =
    str('outputVideo') ||
    str('originalVideoUrl') ||
    str('referenceVideoUrl');
  return url || null;
}

// 格式化图片路径：统一转换为 local-resource:// 协议（同步版本）
// 注意：不要对整个路径编码，只对中文和空格部分编码，盘符的冒号必须保持原样
const formatImagePathSync = (path: string): string => {
  if (!path) return '';
  // 如果是 HTTP/HTTPS URL，直接返回
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  // 如果是 data: URL，直接返回
  if (path.startsWith('data:')) {
    return path;
  }
  // 如果已经是 local-resource:// 格式，直接返回（协议处理器会自己处理解码）
  if (path.startsWith('local-resource://')) {
    return path;
  }
  // 移除可能存在的协议头，统一转换
  const cleanPath = path.replace(/^(file:\/\/|local-resource:\/\/)/, '');
  // 转换为 local-resource:// 协议，并将反斜杠替换为正斜杠
  // 注意：不要对整个路径编码，只对中文和空格部分编码，盘符的冒号必须保持原样
  let normalizedPath = cleanPath.replace(/\\/g, '/');
  
  // 修复盘符格式：如果路径是 "c/Users" 格式（缺少冒号），修正为 "C:/Users"
  // 这是关键修复：确保盘符格式正确
  if (normalizedPath.match(/^([a-zA-Z])\//)) {
    normalizedPath = normalizedPath[0].toUpperCase() + ':' + normalizedPath.substring(1);
  }
  
  // 确保 Windows 路径格式正确（C:/Users 而不是 /C:/Users）
  if (normalizedPath.match(/^\/[a-zA-Z]:/)) {
    normalizedPath = normalizedPath.substring(1); // 移除开头的 /
  }
  
  // 只对路径中的中文和空格部分进行编码，保留盘符的冒号
  // 分段处理，但不对盘符部分（如 C:）编码
  const pathParts = normalizedPath.split('/');
  const encodedParts = pathParts.map((part, index) => {
    // 如果是第一段且是 Windows 盘符（如 C:），不编码
    if (index === 0 && /^[a-zA-Z]:$/.test(part)) {
      return part;
    }
    // 其他部分：只对包含中文或空格的部分进行编码
    if (/[\u4e00-\u9fa5\s]/.test(part)) {
      // 包含中文或空格，需要编码
      return encodeURIComponent(part);
    }
    // 不包含中文或空格，保持原样
    return part;
  });
  const encodedPath = encodedParts.join('/');
  
  return `local-resource://${encodedPath}`;
};

// 格式化图片路径：统一转换为 local-resource:// 协议（异步版本，支持路径映射）
// 增强版：自动检测中文路径并转换为映射路径
const formatImagePath = async (path: string, projectId?: string): Promise<string> => {
  // 先使用同步版本格式化路径
  const formattedPath = formatImagePathSync(path);
  
  // 如果需要路径映射且路径是 local-resource://，尝试映射
  if (projectId && formattedPath.startsWith('local-resource://')) {
    try {
      const mappedPath = await mapProjectPath(formattedPath, projectId);
      return mappedPath;
    } catch (error) {
      console.warn('[formatImagePath] 路径映射失败，使用原始路径:', error);
      return formattedPath;
    }
  }
  
  return formattedPath;
};

/** 任务列表去重：忽略 query、统一路径大小写与编码，避免同一结果因 URL 形态不同出现多条 */
function normalizeMediaUrlForTaskDedup(url: string | undefined): string {
  const s = String(url || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const path = u.pathname
        .split('/')
        .map((seg) => {
          try {
            return decodeURIComponent(seg);
          } catch {
            return seg;
          }
        })
        .join('/');
      return `${u.hostname}${path}`.toLowerCase();
    } catch {
      return s.split('?')[0].toLowerCase();
    }
  }
  let p = s.replace(/^local-resource:\/\//i, '').replace(/^file:\/\/?/i, '');
  p = p.replace(/\\/g, '/');
  if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
  try {
    return decodeURIComponent(p).toLowerCase();
  } catch {
    return p.toLowerCase();
  }
}

function lastUrlPathSegment(url: string): string {
  const s = String(url || '').trim();
  if (!s) return '';
  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      const seg = u.pathname.split('/').filter(Boolean).pop() || '';
      try {
        return decodeURIComponent(seg).toLowerCase();
      } catch {
        return seg.toLowerCase();
      }
    }
  } catch {
    /* ignore */
  }
  const p = s.replace(/^local-resource:\/\//i, '').replace(/\\/g, '/');
  const seg = p.split('/').filter(Boolean).pop() || '';
  try {
    return decodeURIComponent(seg).toLowerCase();
  } catch {
    return seg.toLowerCase();
  }
}

/** http 与 local-resource 指向同一文件时（云端轮询 + IPC 双写）视为同一任务 */
function mediaUrlsLikelySameArtifact(a: string | undefined, b: string | undefined): boolean {
  const na = normalizeMediaUrlForTaskDedup(a);
  const nb = normalizeMediaUrlForTaskDedup(b);
  if (na && nb && na === nb) return true;
  const sa = String(a || '');
  const sb = String(b || '');
  const aHttp = /^https?:\/\//i.test(sa);
  const bHttp = /^https?:\/\//i.test(sb);
  if (aHttp === bHttp) {
    // 两条均为本地：映射路径与原始路径编码不同但指向同一文件
    if (!aHttp && na && nb && na.length > 8 && nb.length > 8) {
      const tailA = lastUrlPathSegment(sa);
      const tailB = lastUrlPathSegment(sb);
      if (tailA && tailB && tailA === tailB) return true;
    }
    return false;
  }
  const httpSide = aHttp ? sa : sb;
  const localSide = aHttp ? sb : sa;
  if (!/^https?:\/\//i.test(httpSide) || !localSide.toLowerCase().includes('local-resource')) return false;
  const tail = lastUrlPathSegment(httpSide);
  if (!tail || tail.length < 2) return false;
  const loc = localSide.toLowerCase();
  return loc.includes(tail) || loc.includes(encodeURIComponent(tail));
}

/** 展示层合并：优先保留正式 task-*，其次较新 */
function pickBetterTaskForDedup(a: Task, b: Task): Task {
  const aRun = String(a.id).startsWith('runtime-');
  const bRun = String(b.id).startsWith('runtime-');
  if (aRun !== bRun) return aRun ? b : a;
  return a.createdAt >= b.createdAt ? a : b;
}

function taskMediaUrl(task: Task): string {
  return String(task.imageUrl || task.videoUrl || task.audioUrl || '');
}

/** 图片任务列表去重：优先用稳定远程 URL，避免「同一次生成」先 http 后 local 且本地文件名与 COS 不一致时拆成两条 */
function taskImageDedupNorm(task: Task): string {
  const o = String(task.originalImageUrl || '').trim();
  if (o && /^https?:\/\//i.test(o)) return normalizeMediaUrlForTaskDedup(o);
  return normalizeMediaUrlForTaskDedup(task.imageUrl);
}

function taskVideoDedupNorm(task: Task): string {
  const o = String(task.originalVideoUrl || '').trim();
  if (o && /^https?:\/\//i.test(o)) return normalizeMediaUrlForTaskDedup(o);
  return normalizeMediaUrlForTaskDedup(task.videoUrl);
}

/** 画布上与「视频生成」共用连线 / 底部面板逻辑的节点类型 */
function isVideoModuleNodeType(t: string | undefined): boolean {
  return t === 'video' || t === 'wanAnimate' || t === 'heyGem';
}

/** 任务 URL / 扩展名像音频时，避免误当成视频历史或视频节点 */
function looksLikeAudioMediaUrl(url: string | undefined | null): boolean {
  const u = String(url || '').trim();
  if (!u) return false;
  return /\.(flac|mp3|wav|aac|m4a|ogg|opus)(?:$|[?#])/i.test(u);
}

/** 可作为参考视频源：普通视频模块、视频换人、HeyGem 均输出视频 */
function isVideoTrackSourceNodeType(t: string | undefined): boolean {
  return t === 'video' || t === 'wanAnimate' || t === 'heyGem';
}

function isVideoReferenceOutputSource(node: Node | undefined, sourceHandle?: string | null): boolean {
  if (!node?.type) return false;
  if (node.type === 'digitalHuman') return isDigitalHumanVideoOutputHandle(sourceHandle);
  return isVideoTrackSourceNodeType(node.type);
}

function pickReferenceVideoFromSourceNode(node: Node | undefined, sourceHandle?: string | null): string {
  if (!node) return '';
  if (node.type === 'digitalHuman') {
    if (!isDigitalHumanVideoOutputHandle(sourceHandle)) return '';
    return pickDigitalHumanVideoUrl(node.data as Record<string, unknown>);
  }
  if (isVideoTrackSourceNodeType(node.type)) {
    const output = String(node.data?.outputVideo || '').trim();
    const original = String(node.data?.originalVideoUrl || '').trim();
    const ref = String((node.data as { referenceVideoUrl?: string })?.referenceVideoUrl || '').trim();
    const isLocal = (u: string) =>
      u.startsWith('local-resource://') ||
      u.startsWith('file://') ||
      /^[a-zA-Z]:[/\\]/.test(u) ||
      u.startsWith('/');
    // 提取音频优先用本地文件，避免远程 URL 下载超时/断连导致「提取失效」
    if (isLocal(output)) return output;
    if (isLocal(original)) return original;
    if (isLocal(ref)) return ref;
    return output || original || ref;
  }
  return '';
}

/** 任务列表展示用：与画布定价表一致的预估元宝（抠图/去水印按任务 prompt 区分） */
function estimateYuanbaoForTaskNodeStatic(
  node: Node | undefined,
  cloudMap: Record<string, NxModelConfigRow> | null | undefined,
  taskPrompt?: string,
): number | undefined {
  if (!node) return undefined;
  if (taskPrompt === '抠图') return getMattingDisplayPrice(cloudMap, 1);
  if (taskPrompt === '去水印') return getWatermarkRemovalDisplayPrice(cloudMap, 1);
  if (taskPrompt === '超分放大' || taskPrompt === '图像超分放大V3') return getImageUpscaleV3DisplayPrice(cloudMap, 1);
  if (taskPrompt === '人物多角度') return getCharacterMultiAngleDisplayPrice(cloudMap, 1);
  const t = String(node.type || '');
  if (t === 'minimalistText') return getLlmChatDisplayPrice(cloudMap, 1);
  const y = getNodeDisplayPrice(t, node.data as Record<string, unknown>, cloudMap);
  return y != null ? y : undefined;
}

function patchNodeWithAspectRatioLayout(node: Node, aspectRatio: string, kind: 'image' | 'video'): Node {
  const nextData = applyAspectRatioToNodeData(node.data as Record<string, unknown>, aspectRatio, kind);
  const w = Number(nextData.width);
  const h = Number(nextData.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { ...node, data: nextData };
  }
  return {
    ...node,
    data: nextData,
    style: { ...(node.style as object), ...nodeStyleDimensions(w, h) },
  };
}

/** 图片：空容器才按比例改外形；已有成片时只改 aspectRatio（供下次生成），外形跟图片 */
function patchImageNodeAspectRatio(node: Node, aspectRatio: string): Node {
  const data = (node.data || {}) as Record<string, unknown>;
  if (hasImageOutputMedia(data)) {
    return { ...node, data: { ...data, aspectRatio } };
  }
  return patchNodeWithAspectRatioLayout(node, aspectRatio, 'image');
}

function patchNodeWithMediaLayout(
  node: Node,
  mediaW: number | undefined,
  mediaH: number | undefined,
  kind: 'image' | 'video',
): Node {
  const minW = kind === 'image' ? IMAGE_NODE_MIN_W : VIDEO_NODE_MIN_W;
  const minH = kind === 'image' ? IMAGE_NODE_MIN_H : VIDEO_NODE_MIN_H;
  const maxW = kind === 'image' ? 2048 : VIDEO_NODE_MAX_W;
  const maxH = kind === 'image' ? 2048 : VIDEO_NODE_MAX_H;
  const aspectFallback =
    kind === 'image'
      ? imageNodeSizeForAspectRatio(String(node.data?.aspectRatio || DEFAULT_IMAGE_ASPECT_RATIO))
      : videoNodeSizeForAspectRatio(String(node.data?.aspectRatio || DEFAULT_VIDEO_ASPECT_RATIO));
  const size = computeNodeSizeFromMedia(
    mediaW,
    mediaH,
    minW,
    minH,
    maxW,
    maxH,
    aspectFallback?.w ?? minW,
    aspectFallback?.h ?? minH,
  );
  const aspectRatio =
    kind === 'video'
      ? // 视频成片只更新节点外形尺寸，不覆盖用户为「下次生成」选择的比例
        snapToVideoPanelAspectRatio(String(node.data?.aspectRatio || DEFAULT_VIDEO_ASPECT_RATIO))
      : // 图片成片同理：外框跟素材，比例下拉仍保留用户生成设置
        String(node.data?.aspectRatio || DEFAULT_IMAGE_ASPECT_RATIO);
  return {
    ...node,
    data: {
      ...node.data,
      width: size.w,
      height: size.h,
      aspectRatio,
      isUserResized: false,
      ...(kind === 'image' && mediaW && mediaH
        ? {
            imageAsset: {
              ...((node.data?.imageAsset as object) || {}),
              width: mediaW,
              height: mediaH,
            },
          }
        : {}),
    },
    style: { ...(node.style as object), ...nodeStyleDimensions(size.w, size.h) },
  };
}

async function patchImageNodeWithProbedLayout(node: Node, probeUrl: string): Promise<Node> {
  if (node.data?.isUserResized || node.data?.preserveExportLayout) return node;
  const url = String(probeUrl || '').trim();
  if (!url) return node;
  try {
    const px = await probeImagePixelSize(url);
    if (px.width > 0 && px.height > 0) {
      return patchNodeWithMediaLayout(node, px.width, px.height, 'image');
    }
  } catch {
    /* 探测失败时保留当前外框 */
  }
  return node;
}

/** VideoNode 外框变更时同步 React Flow 选框尺寸（style） */
function patchVideoNodeData(node: Node, nodeId: string, updates: Record<string, unknown>): Node {
  if (node.id !== nodeId) return node;
  const next: Node = {
    ...node,
    data: {
      ...node.data,
      ...updates,
    },
  };
  const w = updates.width;
  const h = updates.height;
  if (typeof w === 'number' && w > 0 && typeof h === 'number' && h > 0) {
    next.style = {
      ...(node.style as object),
      ...nodeStyleDimensions(w, h),
    };
  }
  return next;
}

const Workspace: React.FC<WorkspaceProps> = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { syncCloudPricing, cloudMap } = useNxModelPricing();
  const cloudMapRef = useRef<Record<string, NxModelConfigRow> | null>(null);
  useEffect(() => {
    cloudMapRef.current = cloudMap;
  }, [cloudMap]);

  /** 进入画布：探测北京 FC，可用则切北京；不可达则香港（生成任务进行中则延迟切换） */
  useEffect(() => {
    void window.electronAPI?.nxCloudEnsureFcRouteForCanvas?.();
  }, []);

  const { showAlert, showConfirm } = useDarkAlert();
  const { locale } = useAppLocale();
  const imgc = useMemo(() => imageNodeChromeT(locale), [locale]);
  /** 「添加角色」弹窗：从画布点选（参考图 / 参考音） */
  const characterAvatarPickPendingRef = useRef(false);
  const characterCanvasPickTargetRef = useRef<
    'avatar' | 'voice' | 'view' | 'sceneNormal' | 'sceneDisplay3d' | 'digitalHumanVideo'
  >('avatar');
  const sceneImagePickResolveRef = useRef<((url: string | null) => void) | null>(null);
  const digitalHumanVideoPickResolveRef = useRef<((url: string | null) => void) | null>(null);
  const characterAvatarPickResolveRef = useRef<((url: string | null) => void) | null>(null);
  const characterVoicePickResolveRef = useRef<((payload: { url: string; label: string } | null) => void) | null>(null);
  const [characterAvatarPickOverlay, setCharacterAvatarPickOverlay] = useState(false);
  const [characterCanvasPickTarget, setCharacterCanvasPickTarget] = useState<
    'avatar' | 'voice' | 'view' | 'sceneNormal' | 'sceneDisplay3d' | 'digitalHumanVideo'
  >('avatar');
  const cancelCharacterCanvasPick = useCallback(() => {
    if (!characterAvatarPickPendingRef.current) return;
    characterAvatarPickPendingRef.current = false;
    const kind = characterCanvasPickTargetRef.current;
    setCharacterAvatarPickOverlay(false);
    setCharacterCanvasPickTarget('avatar');
    if (kind === 'sceneNormal' || kind === 'sceneDisplay3d') {
      const r = sceneImagePickResolveRef.current;
      sceneImagePickResolveRef.current = null;
      r?.(null);
    } else if (kind === 'digitalHumanVideo') {
      const r = digitalHumanVideoPickResolveRef.current;
      digitalHumanVideoPickResolveRef.current = null;
      r?.(null);
    } else if (kind === 'avatar' || kind === 'view') {
      const r = characterAvatarPickResolveRef.current;
      characterAvatarPickResolveRef.current = null;
      r?.(null);
    } else {
      const r = characterVoicePickResolveRef.current;
      characterVoicePickResolveRef.current = null;
      r?.(null);
    }
    characterCanvasPickTargetRef.current = 'avatar';
  }, []);

  useEffect(() => {
    if (characterAvatarPickOverlay) {
      syncCanvasPickState(true, characterCanvasPickTarget);
    } else {
      syncCanvasPickState(false);
    }
  }, [characterAvatarPickOverlay, characterCanvasPickTarget]);

  const finishCharacterAvatarPick = useCallback((url: string | null) => {
    const t = characterCanvasPickTargetRef.current;
    if (!characterAvatarPickPendingRef.current || (t !== 'avatar' && t !== 'view')) return;
    characterAvatarPickPendingRef.current = false;
    const r = characterAvatarPickResolveRef.current;
    characterAvatarPickResolveRef.current = null;
    characterVoicePickResolveRef.current = null;
    characterCanvasPickTargetRef.current = 'avatar';
    setCharacterAvatarPickOverlay(false);
    setCharacterCanvasPickTarget('avatar');
    r?.(url);
  }, []);
  const finishCharacterVoicePick = useCallback((payload: { url: string; label: string } | null) => {
    if (!characterAvatarPickPendingRef.current || characterCanvasPickTargetRef.current !== 'voice') return;
    characterAvatarPickPendingRef.current = false;
    const r = characterVoicePickResolveRef.current;
    characterVoicePickResolveRef.current = null;
    characterAvatarPickResolveRef.current = null;
    characterCanvasPickTargetRef.current = 'avatar';
    setCharacterAvatarPickOverlay(false);
    setCharacterCanvasPickTarget('avatar');
    r?.(payload);
  }, []);
  const finishSceneImagePick = useCallback((url: string | null) => {
    const kind = characterCanvasPickTargetRef.current;
    if (!characterAvatarPickPendingRef.current || (kind !== 'sceneNormal' && kind !== 'sceneDisplay3d')) return;
    characterAvatarPickPendingRef.current = false;
    const r = sceneImagePickResolveRef.current;
    sceneImagePickResolveRef.current = null;
    characterAvatarPickResolveRef.current = null;
    characterVoicePickResolveRef.current = null;
    characterCanvasPickTargetRef.current = 'avatar';
    setCharacterAvatarPickOverlay(false);
    setCharacterCanvasPickTarget('avatar');
    r?.(url);
  }, []);
  const finishDigitalHumanVideoPick = useCallback((url: string | null) => {
    if (!characterAvatarPickPendingRef.current || characterCanvasPickTargetRef.current !== 'digitalHumanVideo') return;
    characterAvatarPickPendingRef.current = false;
    const r = digitalHumanVideoPickResolveRef.current;
    digitalHumanVideoPickResolveRef.current = null;
    characterAvatarPickResolveRef.current = null;
    characterVoicePickResolveRef.current = null;
    characterCanvasPickTargetRef.current = 'avatar';
    setCharacterAvatarPickOverlay(false);
    setCharacterCanvasPickTarget('avatar');
    r?.(url);
  }, []);
  const wcCanvas = useMemo(() => workspaceChromeT(locale), [locale]);
  // panorama placement UI removed — module-inline 360 only
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const flowContentApiRef = useRef<{
    screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number };
    getLastMousePosition: () => { x: number; y: number };
    fitView: (opts?: { duration?: number; padding?: number }) => void;
  } | null>(null);
  const [nodes, setNodes, onNodesChangeBase] = useNodesState([]);
  const [edges, setEdges] = useEdgesState([]);
  const latestNodesRef = useRef<Node[]>([]);
  const latestEdgesRef = useRef<Edge[]>([]);
  const persistedNodeHashRef = useRef<Map<string, string>>(new Map());
  const isNodeDraggingRef = useRef(false);
  const isGroupDraggingRef = useRef(false);
  const dragNodeHashRef = useRef<Map<string, string>>(new Map());
  const isExitingRef = useRef(false);
  /** 当前 projectId 已完成 load-project-data 并应用到 state 后才允许落盘，避免切换工程时错写或空覆盖 */
  const hydratedProjectIdRef = useRef<string | null>(null);
  /** 用户从「有节点」删到空画布后为 true，用于主进程放行合法的空保存 */
  const userExplicitlyEmptiedRef = useRef(false);
  const prevNodeCountForEmptyDetectRef = useRef(0);

  type HistorySnapshotReason = 'position' | 'general';
  type HistorySnapshot = { nodes: Node[]; edges: Edge[]; reason: HistorySnapshotReason };

  // 撤销/重做历史记录
  const historyRef = useRef<HistorySnapshot[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const isUndoRedoRef = useRef<boolean>(false);
  const [undoRedoState, setUndoRedoState] = useState({ canUndo: false, canRedo: false });
  const refreshUndoRedoState = useCallback(() => {
    setUndoRedoState({
      canUndo: historyIndexRef.current > 0,
      canRedo: historyIndexRef.current < historyRef.current.length - 1,
    });
  }, []);
  const saveHistoryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
  const [projectReloadNonce, setProjectReloadNonce] = useState(0);
  const [edgeDeleteModeId, setEdgeDeleteModeId] = useState<string | null>(null);
  /** Ctrl+点击快速连线：已选源模块 */
  const [quickConnectSourceId, setQuickConnectSourceId] = useState<string | null>(null);
  const quickConnectSourceIdRef = useRef<string | null>(null);
  quickConnectSourceIdRef.current = quickConnectSourceId;
  const cancelQuickConnect = useCallback(() => {
    if (!quickConnectSourceIdRef.current) return;
    setQuickConnectSourceId(null);
    syncQuickConnectState(false, null);
  }, []);
  const beginQuickConnect = useCallback(
    (nodeId: string) => {
      setQuickConnectSourceId(nodeId);
      syncQuickConnectState(true, nodeId);
      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          selected: n.id === nodeId,
        })),
      );
      setSelectedEdge(null);
      setEdgeDeleteModeId(null);
    },
    [setNodes],
  );
  useEffect(() => () => syncQuickConnectState(false, null), []);
  const positionChangeRafRef = useRef<number | null>(null);
  const pendingPositionChangesRef = useRef<any[]>([]);
  const selectionChangeRafRef = useRef<number | null>(null);
  const pendingSelectionRef = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const lastNodeClickRef = useRef<{ id: string; at: number } | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const tasksListHydratedRef = useRef(false);
  /** 已触发过「恢复 RunningHub 视频轮询」的 projectId+node+task，避免重复 IPC */
  const runningHubVideoResumeStartedRef = useRef<Set<string>>(new Set());
  const timeoutPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutPollInFlightRef = useRef(false);
  const timeoutPollFailureCountRef = useRef(0);
  const timeoutPollDelayMsRef = useRef(60_000);
  const getNodeTaskType = useCallback((nodeType?: string): Task['taskType'] => {
    if (nodeType === 'video' || nodeType === 'wanAnimate' || nodeType === 'heyGem') return 'video';
    if (nodeType === 'audio' || nodeType === 'rvcTrain') return 'audio';
    if (nodeType === 'llm' || nodeType === 'minimalistText' || nodeType === 'text') return 'text';
    return 'image';
  }, []);
  const nodeInputPromptForTask = useCallback((node?: Node): string => {
    if (!node?.data) return '';
    const d = node.data as Record<string, unknown>;
    return String(d.prompt || d.text || d.inputText || d.userInput || '').trim();
  }, []);
  const upsertRuntimeTask = useCallback((nodeId: string, patch: Partial<Task>) => {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === `runtime-${nodeId}`);
      if (idx >= 0) {
        const next = prev.slice();
        const prevTask = next[idx];
        const nextStatus = String(patch.status || '').toLowerCase();
        const prevStatus = String(prevTask.status || '').toLowerCase();
        const shouldResetStart =
          nextStatus === 'running' &&
          prevStatus !== 'running' &&
          prevStatus !== 'processing';
        let merged: Task = {
          ...prevTask,
          ...patch,
          ...(shouldResetStart ? { createdAt: Date.now() } : {}),
        };
        if (
          nextStatus === 'success' &&
          (prevStatus === 'running' || prevStatus === 'processing') &&
          merged.durationSec === undefined
        ) {
          const startAt = shouldResetStart ? merged.createdAt : prevTask.createdAt;
          merged = {
            ...merged,
            durationSec: Math.max(0, Math.floor((Date.now() - startAt) / 1000)),
          };
        }
        next[idx] = merged;
        return next;
      }
      // 已无 runtime 行时（通常已被 handleAdd*Task 换成正式 task-*），二次 SUCCESS（如先 http 后 local）不应再插入 runtime-*，否则任务列表会出现两条同款结果
      const patchStatus = String(patch.status || '').toLowerCase();
      if (
        patchStatus === 'success' &&
        (patch.videoUrl ||
          patch.imageUrl ||
          patch.audioUrl ||
          (patch.prompt !== undefined && !patch.videoUrl && !patch.imageUrl && !patch.audioUrl))
      ) {
        const textPrompt = typeof patch.prompt === 'string' ? patch.prompt.trim() : '';
        if (textPrompt && !patch.videoUrl && !patch.imageUrl && !patch.audioUrl) {
          const formalIdx = prev.findIndex(
            (t) =>
              t.nodeId === nodeId &&
              t.taskType === 'text' &&
              String(t.status || '').toLowerCase() === 'success' &&
              !String(t.id).startsWith('runtime-'),
          );
          if (formalIdx >= 0) {
            const next = prev.slice();
            next[formalIdx] = {
              ...next[formalIdx],
              ...patch,
              taskType: 'text',
              prompt: textPrompt,
            };
            return next;
          }
        }
        // 已无 runtime 行：合并到已有正式媒体任务，或补一条 success runtime（供 handleAdd*Task 升格）
        const mediaType: Task['taskType'] | undefined = patch.videoUrl
          ? 'video'
          : patch.imageUrl
            ? 'image'
            : patch.audioUrl
              ? 'audio'
              : undefined;
        if (mediaType) {
          const formalIdx = prev.findIndex(
            (t) =>
              t.nodeId === nodeId &&
              t.taskType === mediaType &&
              String(t.status || '').toLowerCase() === 'success' &&
              !String(t.id).startsWith('runtime-'),
          );
          if (formalIdx >= 0) {
            const next = prev.slice();
            next[formalIdx] = { ...next[formalIdx], ...patch, taskType: mediaType };
            return next;
          }
          const node = latestNodesRef.current.find((n) => n.id === nodeId);
          const inputPrompt = nodeInputPromptForTask(node);
          const createdAt = Date.now();
          const nextTask: Task = {
            id: `runtime-${nodeId}`,
            nodeId,
            nodeTitle: String(node?.data?.title || node?.type || 'task'),
            prompt: typeof patch.prompt === 'string' && patch.prompt.trim() ? patch.prompt.trim() : inputPrompt,
            createdAt,
            status: 'success',
            taskType: mediaType,
            ...patch,
          };
          return [nextTask, ...prev];
        }
        return prev;
      }
      const node = latestNodesRef.current.find((n) => n.id === nodeId);
      const createdAt = Date.now();
      const inputPrompt = nodeInputPromptForTask(node);
      const nextTask: Task = {
        id: `runtime-${nodeId}`,
        nodeId,
        nodeTitle: String(node?.data?.title || node?.type || 'task'),
        prompt: inputPrompt,
        createdAt,
        status: 'running',
        taskType: getNodeTaskType(node?.type),
        ...patch,
        ...(patch.prompt === undefined && inputPrompt ? { prompt: inputPrompt } : {}),
      };
      return [nextTask, ...prev];
    });
  }, [getNodeTaskType, nodeInputPromptForTask]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewAudio, setPreviewAudio] = useState<string | null>(null); // 音频预览
  const [batchRunInProgress, setBatchRunInProgress] = useState(false); // 批量运行中，用于禁用按钮并显示绿色
  const [isPerformanceMode, setIsPerformanceMode] = useState(false);
  const videoInteractionSettings: VideoInteractionSettings = DEFAULT_VIDEO_INTERACTION_SETTINGS;
  const cardThumbnailCacheRef = useRef<string | null>(null);
  const cardThumbnailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [thumbnailPhase, setThumbnailPhase] = useState<'wait10s' | 'wait5s' | 'idle60s'>('wait10s');
  useEffect(() => {
    latestNodesRef.current = nodes as Node[];
  }, [nodes]);

  useEffect(() => {
    if (!projectId) return;
    if (hydratedProjectIdRef.current !== projectId) return;
    if (isExitingRef.current) {
      prevNodeCountForEmptyDetectRef.current = nodes.length;
      return;
    }
    const prev = prevNodeCountForEmptyDetectRef.current;
    if (prev > 0 && nodes.length === 0) {
      userExplicitlyEmptiedRef.current = true;
    }
    prevNodeCountForEmptyDetectRef.current = nodes.length;
  }, [nodes.length, projectId]);

  useEffect(() => {
    bindContainerRef(reactFlowWrapper);
    return () => {
      stopSyncLoop();
      bindContainerRef(null);
    };
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.syncScreenshotProject) return;
    void window.electronAPI.syncScreenshotProject(projectId);
  }, [projectId]);

  // 卸载时：检测内存压力，必要时请求主进程重载，预防 exitCode 134（主动返回项目列表时不重载，避免 reload 后回到开场动画）
  useEffect(() => {
    return () => {
      if (isExitingRef.current) return;
      const mem = (performance as any).memory as { usedJSHeapSize?: number } | undefined;
      const usedMB = mem?.usedJSHeapSize ? mem.usedJSHeapSize / (1024 * 1024) : 0;
      if (usedMB > 550 && window.electronAPI?.requestRendererReload) {
        console.warn('[Workspace] 卸载时检测到高内存占用:', usedMB.toFixed(1), 'MB，请求重载以释放 GPU 资源');
        window.electronAPI.requestRendererReload().catch(() => {});
      }
    };
  }, []);

  // 进入项目时重置 isExiting，避免上次退出残留导致一直显示“正在返回”遮罩
  useEffect(() => {
    setIsExiting(false);
  }, [projectId]);

  // 进入画布：强制拉取 /model-config，避免后台改 OTS 后仍被 5 分钟节流挡住
  useEffect(() => {
    if (!projectId) return;
    void syncCloudPricing({ force: true });
  }, [projectId, syncCloudPricing]);

  useEffect(() => {
    latestEdgesRef.current = edges as Edge[];
  }, [edges]);

  const selectedNodeRef = useRef<Node | null>(null);
  useEffect(() => {
    selectedNodeRef.current = selectedNode;
  }, [selectedNode]);

  useEffect(() => {
    return () => {
      if (selectionChangeRafRef.current !== null) {
        cancelAnimationFrame(selectionChangeRafRef.current);
        selectionChangeRafRef.current = null;
      }
      pendingSelectionRef.current = null;
    };
  }, []);

  // 产品化固定策略：不向用户暴露可调参数，不读取/保存外部设置。

  const sanitizeNodeDataForPersist = useCallback((data: Record<string, any> | undefined) => {
    if (!data) return data;
    const sanitized = { ...data };
    delete sanitized.progress;
    delete sanitized.progressMessage;
    delete sanitized.tempUIState;
    delete sanitized._isResizing;
    return sanitized;
  }, []);

  const normalizeNodesForSave = useCallback((inputNodes: Node[]) => {
    return inputNodes.map((node) => ({
      ...node,
      data: {
        ...sanitizeNodeDataForPersist(node.data as Record<string, any> | undefined),
        width: node.data?.width || node.style?.width || (node.type === 'minimalistText' ? IMAGE_NODE_DEFAULT_W : node.type === 'llm' ? AUDIO_NODE_WIDTH : undefined),
        height: node.data?.height || node.style?.height || (node.type === 'minimalistText' ? IMAGE_NODE_DEFAULT_H : node.type === 'llm' ? AUDIO_NODE_HEIGHT : undefined),
      },
      position: node.position,
    }));
  }, [sanitizeNodeDataForPersist]);

  const buildNodePersistHash = useCallback((node: Node): string => {
    const p = node.position || { x: 0, y: 0 };
    const d = (node.data || {}) as Record<string, any>;
    const content = {
      x: Number(p.x || 0).toFixed(2),
      y: Number(p.y || 0).toFixed(2),
      width: d.width ?? node.style?.width ?? '',
      height: d.height ?? node.style?.height ?? '',
      outputImage: d.outputImage ?? '',
      originalImageUrl: d.originalImageUrl ?? '',
      outputVideo: d.outputVideo ?? '',
      outputAudio: d.outputAudio ?? '',
      prompt: d.prompt ?? d.text ?? '',
      inputImagesCount: Array.isArray(d.inputImages) ? d.inputImages.length : 0,
    };
    return JSON.stringify(content);
  }, []);

  const normalizeEdgesForSave = useCallback((inputEdges: Edge[]) => {
    return inputEdges.map((edge) => ({
      ...edge,
      sourceHandle: edge.sourceHandle || 'output',
      targetHandle: edge.targetHandle || 'input',
      data: sanitizeNodeDataForPersist(edge.data as Record<string, any> | undefined),
    }));
  }, [sanitizeNodeDataForPersist]);

  const refreshPersistedNodeHashes = useCallback((inputNodes: Node[]) => {
    const nextHashes = new Map<string, string>();
    for (const node of inputNodes) {
      nextHashes.set(node.id, buildNodePersistHash(node));
    }
    persistedNodeHashRef.current = nextHashes;
  }, [buildNodePersistHash]);

  useEffect(() => {
    if ((nodes as Node[]).length === 0) {
      persistedNodeHashRef.current = new Map();
      return;
    }
    if (persistedNodeHashRef.current.size === 0) {
      refreshPersistedNodeHashes(nodes as Node[]);
    }
  }, [nodes, refreshPersistedNodeHashes]);

  const saveProjectNow = useCallback(
    async (
      snapshot?: { nodes: Node[]; edges: Edge[] },
      opts?: { allowEmptyOverwrite?: boolean },
    ) => {
      if (!projectId || !window.electronAPI) return;
      if (hydratedProjectIdRef.current !== projectId) {
        return;
      }
      const rawNodes = snapshot?.nodes ?? (latestNodesRef.current as Node[]);
      const rawEdges = snapshot?.edges ?? (latestEdgesRef.current as Edge[]);
      /** 退出流程中清空 React 状态后 ref 会先变成 []，防抖/异步保存若晚到会误覆盖磁盘；禁止在 isExiting 下写入空图 */
      if (isExitingRef.current && rawNodes.length === 0 && rawEdges.length === 0) {
        return;
      }
      const nodesToSave = normalizeNodesForSave(rawNodes);
      const edgesToSave = normalizeEdgesForSave(rawEdges);
      const incomingEmpty = rawNodes.length === 0 && rawEdges.length === 0;
      const allowEmpty =
        opts?.allowEmptyOverwrite === true || (incomingEmpty && userExplicitlyEmptiedRef.current);
      const result = await window.electronAPI.saveProjectData(projectId, nodesToSave, edgesToSave, {
        allowEmptyOverwrite: allowEmpty,
      });
      if (result && result.success === false && result.code === 'EMPTY_OVERWRITE_BLOCKED') {
        console.warn('[Workspace] 已阻止用空画布覆盖非空 data.json（若需清空工程请先删光节点再保存）');
        showAlert(wcCanvas.emptyOverwriteBlockedMessage);
        return;
      }
      if (incomingEmpty && result && 'success' in result && result.success) {
        userExplicitlyEmptiedRef.current = false;
      }
      refreshPersistedNodeHashes(rawNodes);
    },
    [projectId, normalizeNodesForSave, normalizeEdgesForSave, refreshPersistedNodeHashes, showAlert, wcCanvas],
  );

  const handleBackupProject = useCallback(async () => {
    if (!projectId || !window.electronAPI?.backupProjectData) return;
    try {
      const r = await window.electronAPI.backupProjectData(projectId);
      if (r.success) {
        showAlert(wcCanvas.backupProjectSuccess(r.files.join(', ')));
      } else if (r.error === 'NO_DATA_FILES') {
        showAlert(wcCanvas.backupProjectNoDataToBackup);
      } else if (r.error === 'NO_PROJECT') {
        showAlert(wcCanvas.backupProjectNoProject);
      } else if (r.error === 'IO_ERROR') {
        showAlert(wcCanvas.backupProjectIoError);
      } else {
        showAlert(wcCanvas.backupProjectFailed);
      }
    } catch (e) {
      console.error('[Workspace] backup project:', e);
      showAlert(wcCanvas.backupProjectFailed);
    }
  }, [projectId, showAlert, wcCanvas]);

  const handleRestoreFromBackup = useCallback(async () => {
    if (!projectId || !window.electronAPI?.restoreProjectDataFromBackup) return;
    try {
      const r = await window.electronAPI.restoreProjectDataFromBackup(projectId);
      if (r.success) {
        showAlert(wcCanvas.restoreFromBackupSuccess(r.nodeCount, r.previousCount));
        setProjectReloadNonce((n) => n + 1);
        return;
      }
      if (r.error === 'NO_BACKUP') {
        showAlert(wcCanvas.restoreFromBackupNoBackup);
      } else if (r.error === 'BACKUP_NOT_NEWER') {
        showAlert(wcCanvas.restoreFromBackupNotNewer(r.currentCount ?? 0, r.backupCount ?? 0));
      } else if (r.error === 'NO_PROJECT') {
        showAlert(wcCanvas.restoreFromBackupNoProject);
      } else if (r.error === 'IO_ERROR') {
        showAlert(wcCanvas.restoreFromBackupIoError);
      } else {
        showAlert(wcCanvas.restoreFromBackupFailed);
      }
    } catch (e) {
      console.error('[Workspace] restore from backup:', e);
      showAlert(wcCanvas.restoreFromBackupFailed);
    }
  }, [projectId, showAlert, wcCanvas]);

  // 草稿自动保存：节点/边变化后 300ms 防抖落盘，文本模块等实现实时写入保存
  const saveToDiskTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!projectId || !window.electronAPI || isExitingRef.current) return;
    if (nodes.length === 0 && edges.length === 0) return;
    if (saveToDiskTimeoutRef.current) clearTimeout(saveToDiskTimeoutRef.current);
    saveToDiskTimeoutRef.current = setTimeout(() => {
      if (isExitingRef.current) {
        saveToDiskTimeoutRef.current = null;
        return;
      }
      saveProjectNow().catch((e) => console.error('草稿自动保存失败:', e));
      saveToDiskTimeoutRef.current = null;
    }, 300);
    return () => {
      if (saveToDiskTimeoutRef.current) {
        clearTimeout(saveToDiskTimeoutRef.current);
        saveToDiskTimeoutRef.current = null;
      }
    };
  }, [nodes, edges, projectId, saveProjectNow]);

  /** 应用内更新退出前：供 App 层 onPrepareForUpdate 调用，落盘当前画布 */
  useEffect(() => {
    const w = window as Window & { __nexflowFlushBeforeUpdate?: () => Promise<void> };
    w.__nexflowFlushBeforeUpdate = async () => {
      if (projectId) await saveProjectNow();
    };
    return () => {
      delete w.__nexflowFlushBeforeUpdate;
    };
  }, [projectId, saveProjectNow]);

  // 保存历史记录
  const saveHistory = useCallback((reason: HistorySnapshotReason = 'general') => {
    if (isUndoRedoRef.current) return;

    const currentNodes = latestNodesRef.current;
    const currentEdges = latestEdgesRef.current;
    const snapshot: HistorySnapshot = {
      nodes: JSON.parse(JSON.stringify(currentNodes)),
      edges: JSON.parse(JSON.stringify(currentEdges)),
      reason,
    };

    // 移除当前位置之后的历史记录（如果有新的操作）
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    }

    const lastSnapshot = historyRef.current[historyRef.current.length - 1];
    // 仅 position 连续变化时覆盖上一条，避免历史栈膨胀
    if (reason === 'position' && lastSnapshot?.reason === 'position') {
      historyRef.current[historyRef.current.length - 1] = snapshot;
      historyIndexRef.current = historyRef.current.length - 1;
      refreshUndoRedoState();
      return;
    }

    historyRef.current.push(snapshot);

    // 限制历史记录数量（最多保存50条）
    if (historyRef.current.length > 50) {
      historyRef.current.shift();
    }
    historyIndexRef.current = historyRef.current.length - 1;
    refreshUndoRedoState();
  }, [refreshUndoRedoState]);

  // 撤销操作
  const handleUndo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      isUndoRedoRef.current = true;
      historyIndexRef.current -= 1;
      const snapshot = historyRef.current[historyIndexRef.current];
      
      if (snapshot) {
        setNodes(snapshot.nodes);
        setEdges(snapshot.edges);
      }
      
      setTimeout(() => {
        isUndoRedoRef.current = false;
        refreshUndoRedoState();
      }, 100);
    }
  }, [setNodes, setEdges, refreshUndoRedoState]);

  // 重做操作
  const handleRedo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      isUndoRedoRef.current = true;
      historyIndexRef.current += 1;
      const snapshot = historyRef.current[historyIndexRef.current];
      
      if (snapshot) {
        setNodes(snapshot.nodes);
        setEdges(snapshot.edges);
      }
      
      setTimeout(() => {
        isUndoRedoRef.current = false;
        refreshUndoRedoState();
      }, 100);
    }
  }, [setNodes, setEdges, refreshUndoRedoState]);

  const handleQuitApp = useCallback(async () => {
    if (!window.electronAPI?.quitApp) return;
    try {
      await window.electronAPI.quitApp();
    } catch (error) {
      console.error('退出软件失败:', error);
    }
  }, []);

  // 监听键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 如果焦点在输入框或文本区域，不处理撤销
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      
      // Ctrl+Z 或 Cmd+Z (Mac) - 撤销
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      // Ctrl+Shift+Z 或 Cmd+Shift+Z (Mac) - 重做
      else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        handleRedo();
      }
      // Ctrl+Y (Windows/Linux) - 重做
      else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      }
      // Delete 或 Backspace：删除选中的连接线（绿色高亮或剪刀模式时）
      else if ((e.key === 'Delete' || e.key === 'Backspace') && (selectedEdge || edgeDeleteModeId)) {
        e.preventDefault();
        const edgeId = selectedEdge?.id ?? edgeDeleteModeId;
        if (edgeId) {
          setEdges((prev) => prev.filter((e) => e.id !== edgeId));
          setSelectedEdge(null);
          setEdgeDeleteModeId(null);
        }
      }
      // ESC：画布点选模式优先取消；否则关闭预览，再否则弹出退出确认
      else if (e.key === 'Escape') {
        e.preventDefault();
        if (characterAvatarPickPendingRef.current) {
          cancelCharacterCanvasPick();
          return;
        }
        if (quickConnectSourceIdRef.current) {
          cancelQuickConnect();
          return;
        }
        if (previewImage) {
          setPreviewImage(null);
          setPreviewImageNodeId(null);
          return;
        }
        if (previewAudio) {
          setPreviewAudio(null);
          return;
        }
        void (async () => {
          const ok = await showConfirm('确认退出 Aixflow-Bate 吗？', { variant: 'danger', okLabel: '退出' });
          if (ok) void handleQuitApp();
        })();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleUndo, handleRedo, selectedEdge, edgeDeleteModeId, setEdges, showConfirm, handleQuitApp, previewImage, previewAudio, cancelCharacterCanvasPick, cancelQuickConnect]);

  // 画布上删除节点时，仅从任务列表中移除该节点下的任务；不删除项目文件夹内的图片/视频文件
  const removeTasksForNodeIds = useCallback((nodeIds: string[]) => {
    if (nodeIds.length === 0) return;
    setTasks((prevTasks) => prevTasks.filter((task) => !nodeIds.includes(task.nodeId)));
  }, []);

  // 画布删除节点时仅同步任务列表，不删除项目文件夹内的图片/视频文件
  const onNodesDelete = useCallback(
    (deletedNodes: Node[]) => {
      const ids = (deletedNodes || []).map((n) => n.id);
      removeTasksForNodeIds(ids);
    },
    [removeTasksForNodeIds]
  );

  useEffect(() => {
    return () => {
      if (positionChangeRafRef.current !== null) {
        cancelAnimationFrame(positionChangeRafRef.current);
        positionChangeRafRef.current = null;
      }
      pendingPositionChangesRef.current = [];
    };
  }, []);

  // 包装 onNodesChange，捕获 dimensions 和 position 变化，并在删除节点时同步删除任务列表中该节点的任务
  const onNodesChange = useCallback((changes: any[]) => {
    const nodeMap = new Map((latestNodesRef.current || []).map((n) => [n.id, n]));
    const effectiveChanges = changes.filter((change: any) => {
      // React Flow 受控同步可能发出内部 reset，会覆盖完整节点树
      if (change?.type === 'reset') return false;
      if (!change?.id) return true;
      const currentNode = nodeMap.get(change.id) as any;
      if (!currentNode) return true;

      if (change.type === 'select') {
        const prevSelected = !!currentNode.selected;
        const nextSelected = !!change.selected;
        return prevSelected !== nextSelected;
      }

      if (change.type === 'position') {
        const nextPos = change.position;
        const prevPos = currentNode.position;
        const hasPositionPayload =
          !!nextPos && typeof nextPos.x === 'number' && typeof nextPos.y === 'number';
        if (!hasPositionPayload) return true;
        const positionChanged = !prevPos || prevPos.x !== nextPos.x || prevPos.y !== nextPos.y;
        const draggingChanged =
          typeof change.dragging === 'boolean' && !!currentNode.dragging !== !!change.dragging;
        return positionChanged || draggingChanged;
      }

      return true;
    });

    if (effectiveChanges.length === 0) {
      return;
    }

    const fullscreenVideoSpliceId = getGlobalInteractionSnapshot().videoSpliceFullscreenNodeId;
    const removedNodeIds = effectiveChanges
      .filter((c: any) => c.type === 'remove' && c.id && c.id !== fullscreenVideoSpliceId)
      .map((c: any) => c.id);
    removeTasksForNodeIds(removedNodeIds);

    const positionChanges = effectiveChanges.filter((c: any) => c.type === 'position');
    const immediateChanges = effectiveChanges
      .filter((c: any) => c.type !== 'position')
      .filter((c: any) => !(c.type === 'remove' && c.id === fullscreenVideoSpliceId));
    const hasDraggingPositionChange = positionChanges.some((c: any) => c?.dragging === true);
    const draggingPositionCount = positionChanges.reduce((count: number, c: any) => {
      if (c?.dragging === true) return count + 1;
      return count;
    }, 0);
    const isLikelyGroupDragging = draggingPositionCount >= 2;
    if (isLikelyGroupDragging && !isGroupDraggingRef.current) {
      isGroupDraggingRef.current = true;
    }

    // 立即应用非位置变化（例如选中、尺寸、删除等）
    if (immediateChanges.length > 0) {
      const selectChanges = immediateChanges.filter((c: any) => c.type === 'select' && c.id);
      const nonSelectChanges = immediateChanges.filter((c: any) => c.type !== 'select');

      if (nonSelectChanges.length > 0) {
        const normalizedNonSelectChanges = nonSelectChanges.map((change: any) => {
          if (change?.type !== 'dimensions' || !change.id) return change;
          const node = nodeMap.get(change.id);
          if (node?.type === 'audio') {
            return {
              ...change,
              dimensions: { width: AUDIO_NODE_WIDTH, height: AUDIO_NODE_HEIGHT },
            };
          }
          // 图像/视频：选框一律以 data.width/height 为准。
          // 底栏/工具条挂在节点内且 overflow:visible 时，RO 易误测成底栏宽度（如 840）或把下方面板算进高度。
          if (node?.type === 'image' || node?.type === 'video' || node?.type === 'wanAnimate') {
            const dataW = Number((node.data as { width?: unknown })?.width ?? node.width);
            const dataH = Number((node.data as { height?: unknown })?.height ?? node.height);
            if (Number.isFinite(dataW) && dataW > 0 && Number.isFinite(dataH) && dataH > 0) {
              return {
                ...change,
                dimensions: { width: dataW, height: dataH },
              };
            }
          }
          return change;
        });
        onNodesChangeBase(normalizedNonSelectChanges);
      }

      // 选中变化走最小化更新，避免 applyNodeChanges 在大画布下引发额外重绘
      if (selectChanges.length > 0) {
        const selectedById = new Map<string, boolean>();
        for (const change of selectChanges) {
          if (!change?.id) continue;
          selectedById.set(change.id, !!change.selected);
        }

        if (selectedById.size > 0) {
          setNodes((prev) => {
            let changed = false;
            const next = prev.map((node) => {
              if (!selectedById.has(node.id)) return node;
              const nextSelected = !!selectedById.get(node.id);
              if (!!node.selected === nextSelected) return node;
              changed = true;
              return { ...node, selected: nextSelected };
            });
            return changed ? next : prev;
          });
        }
      }
    }

    // 始终通过 React 更新位置，确保 Canvas 边层能读取到最新节点位置实现连线实时跟随
    if (positionChanges.length > 0) {
      onNodesChangeBase(positionChanges);
    }

    const hasOnlyPositionChanges = effectiveChanges.length > 0 && effectiveChanges.every((change) => change.type === 'position');

    // 任务拆分：position 类历史保存走 requestIdleCallback，优先保证位移同步
    if (!isUndoRedoRef.current) {
      if (saveHistoryTimeoutRef.current) {
        clearTimeout(saveHistoryTimeoutRef.current);
      }
      const historyReason: HistorySnapshotReason = hasOnlyPositionChanges ? 'position' : 'general';
      if (hasOnlyPositionChanges && typeof requestIdleCallback !== 'undefined') {
        saveHistoryTimeoutRef.current = window.setTimeout(() => {
          requestIdleCallback(() => saveHistory(historyReason), { timeout: 500 });
        }, 300);
      } else {
        saveHistoryTimeoutRef.current = setTimeout(() => saveHistory(historyReason), 300);
      }
    }
    
  }, [onNodesChangeBase, saveHistory, removeTasksForNodeIds, setNodes]);

  // 包装 onEdgesChange：仅重算受影响子图（目标节点 + 其直接入边来源）
  const onEdgesChange = useCallback((changes: any[]) => {
    const effectiveChanges = (changes || []).filter((c: any) => c?.type !== 'select');
    if (effectiveChanges.length === 0) return;
    if (!isUndoRedoRef.current) {
      if (saveHistoryTimeoutRef.current) {
        clearTimeout(saveHistoryTimeoutRef.current);
      }
      saveHistoryTimeoutRef.current = setTimeout(() => {
        saveHistory('general');
      }, 300);
    }

    setEdges((prevEdges) => {
      let nextEdges = applyEdgeChanges(effectiveChanges, prevEdges as Edge[]);
      // Video 统一 input：迁移旧 targetHandle reference-video / video-audio
      const nodeMap = new Map((latestNodesRef.current || []).map((n) => [n.id, n]));
      nextEdges = nextEdges.map((e) => {
        const targetNode = nodeMap.get(e.target);
        if (isVideoModuleNodeType(targetNode?.type) && (e.targetHandle === 'reference-video' || e.targetHandle === 'video-audio')) {
          return { ...e, targetHandle: 'input' };
        }
        return e;
      });
      const prevById = new Map((prevEdges as Edge[]).map((e) => [e.id, e]));
      const nextById = new Map((nextEdges as Edge[]).map((e) => [e.id, e]));
      const affectedTargetIds = new Set<string>();

      for (const change of effectiveChanges) {
        const prevEdge = change?.id ? prevById.get(change.id) : undefined;
        const nextEdge = change?.id ? nextById.get(change.id) : undefined;
        if (prevEdge?.target) affectedTargetIds.add(prevEdge.target);
        if (nextEdge?.target) affectedTargetIds.add(nextEdge.target);
      }

      if (affectedTargetIds.size > 0) {
        setNodes((nds) => {
          const indexById = new Map<string, number>();
          const nodeById = new Map<string, Node>();
          for (let i = 0; i < nds.length; i += 1) {
            indexById.set(nds[i].id, i);
            nodeById.set(nds[i].id, nds[i] as Node);
          }

          const incomingByTarget = new Map<string, Edge[]>();
          for (const edge of nextEdges as Edge[]) {
            if (!affectedTargetIds.has(edge.target)) continue;
            const incoming = incomingByTarget.get(edge.target) || [];
            incoming.push(edge as Edge);
            incomingByTarget.set(edge.target, incoming);
          }

          let mutated = false;
          const nextNodes = nds.slice();

          affectedTargetIds.forEach((targetId) => {
            const nodeIndex = indexById.get(targetId);
            if (nodeIndex === undefined) return;
            const node = nextNodes[nodeIndex] as Node;
            const incomingEdges = incomingByTarget.get(targetId) || [];

            if (node.type === 'image') {
              const collectedImages: string[] = [];
              const parts: string[] = [];
              for (const edge of incomingEdges) {
                const sourceNode = nodeById.get(edge.source);
                if (!sourceNode) continue;

                if (sourceNode.type === 'image') {
                  const imgUrl = pickPreviewFromEdgeOrNode(edge, sourceNode.data) || (sourceNode.data?.inputImages as string[])?.[0];
                  if (imgUrl && !collectedImages.includes(imgUrl)) collectedImages.push(imgUrl);
                  const pp = sourceNode.data?.prompt_payload as { qwen_instruction?: string; prompt_metadata?: { formatted_output?: string }; full_camera_prompt?: string; camera_tags?: string } | undefined;
                  const cameraPrompt = pp?.qwen_instruction || pp?.prompt_metadata?.formatted_output || pp?.full_camera_prompt || pp?.camera_tags || '';
                  if (cameraPrompt) parts.push(String(cameraPrompt).trim());
                  continue;
                }

                if (sourceNode.type === 'minimalistText' || sourceNode.type === 'text') {
                  if (sourceNode.data?.text) parts.push(String(sourceNode.data.text).trim());
                  continue;
                }
                if (sourceNode.type === 'llm' && sourceNode.data?.outputText) {
                  parts.push(String(sourceNode.data.outputText).trim());
                  continue;
                }
                if (sourceNode.type === 'textSplit') {
                  const segText = pickTextSplitSegmentText(sourceNode.data, 
                    edge.sourceHandle,
                  );
                  if (segText) parts.push(segText);
                }
              }
              // 当前节点自身的 3D prompt_payload
              const selfPp = node.data?.prompt_payload as { qwen_instruction?: string; formatted_output?: string; full_camera_prompt?: string; camera_tags?: string } | undefined;
              const selfCamera = selfPp?.qwen_instruction || selfPp?.formatted_output || selfPp?.full_camera_prompt || selfPp?.camera_tags || '';
              if (selfCamera) parts.push(String(selfCamera).trim());

              // 连线有输入则优先用连线，否则保留节点已有数据（含复制出的信息）
              const newInputImages = collectedImages.length > 0
                ? collectedImages.slice(0, 10)
                : ((node.data?.inputImages as string[] | undefined) || []);
              const promptText = parts.length > 0 ? parts.join(',') : (node.data?.prompt || '');
              const currentInputImages = (node.data?.inputImages as string[] | undefined) || [];
              const currentPrompt = node.data?.prompt || '';
              const inputImagesChanged =
                JSON.stringify([...currentInputImages].sort()) !== JSON.stringify([...newInputImages].sort());
              const promptChanged = currentPrompt !== promptText;

              if (inputImagesChanged || promptChanged) {
                mutated = true;
                const firstRef = newInputImages[0] || '';
                const outImg = String(node.data?.outputImage || '').trim();
                const outList = Array.isArray(node.data?.outputImages) ? node.data.outputImages : [];
                const clearRefOnlyOutput =
                  collectedImages.length > 0 &&
                  !!firstRef &&
                  !!outImg &&
                  formatImagePathSync(outImg) === formatImagePathSync(firstRef) &&
                  outList.length === 0;
                if (selectedNode?.id === node.id) {
                  const skipPanelPromptUpdate = Date.now() - lastImagePromptUserEditRef.current < 2500;
                  setImageInputPanelData((prev) => {
                    if (!prev || prev.nodeId !== node.id) return prev;
                    return {
                      ...prev,
                      inputImages: newInputImages,
                      prompt: skipPanelPromptUpdate ? prev.prompt : promptText,
                    };
                  });
                }
                nextNodes[nodeIndex] = {
                  ...node,
                  data: {
                    ...node.data,
                    inputImages: newInputImages,
                    prompt: promptText,
                    ...(clearRefOnlyOutput
                      ? { outputImage: '', originalImageUrl: undefined }
                      : {}),
                  },
                };
              }
              return;
            }

            if (isVideoModuleNodeType(node.type)) {
              const collectedImages = collectVideoTargetInputImagesFromEdges(targetId, Array.from(nodeById.values()), nextEdges as Edge[]);
              let edgeInputAudioUrl = '';
              let hasAudioInputEdge = false;
              for (const edge of incomingEdges) {
                const sourceNode = nodeById.get(edge.source);
                if (sourceNode?.type === 'audio') {
                  hasAudioInputEdge = true;
                  const url = pickAudioOutputUrlFromAudioNodeData(sourceNode.data as Record<string, unknown>);
                  if (url) edgeInputAudioUrl = url;
                } else if (
                  sourceNode?.type === 'digitalHuman' &&
                  isDigitalHumanAudioOutputHandle(edge.sourceHandle)
                ) {
                  hasAudioInputEdge = true;
                  const url = pickDigitalHumanAudioUrl(sourceNode.data as Record<string, unknown>);
                  if (url) edgeInputAudioUrl = url;
                }
              }
              // 连线有输入则优先用连线，否则保留节点已有数据（含导演对口型裁剪的歌曲片段）
              const hasImageInputEdges = incomingEdges.some((edge) => {
                const sourceNode = nodeById.get(edge.source);
                const targetHandle = edge.targetHandle || 'input';
                if (targetHandle !== 'input' && targetHandle !== 'video-input') return false;
                if (sourceNode?.type === 'image') return true;
                if (sourceNode?.type === 'character') {
                  const sh = edge.sourceHandle || '';
                  return sh !== CHARACTER_OUTPUT_AUDIO_HANDLE && sh !== 'output-audio';
                }
                return false;
              });
              let newInputImages: string[];
              let newLtx23HdrBackgroundImage = String(node.data?.ltx23HdrBackgroundImage || '').trim();
              if (node.data?.model === 'ltx-2.3-hdr-multi' || node.data?.model === 'ltx-2.3-msr-av') {
                const merged = mergeLtx23HdrMultiPreserveOrder(
                  newLtx23HdrBackgroundImage,
                  node.data?.inputImages as string[] | undefined,
                  collectedImages,
                );
                newInputImages = merged.storyboard;
                newLtx23HdrBackgroundImage = merged.background;
              } else {
                newInputImages = hasImageInputEdges
                  ? mergeInputImagesPreserveOrder(
                      node.data?.inputImages as string[] | undefined,
                      collectedImages.slice(0, 10),
                    )
                  : ((node.data?.inputImages as string[] | undefined) || []);
              }
              // 裁剪/智能剪辑导出的成片：不要把上游源视频写入 referenceVideoUrl，
              // 否则播放器可能回退到源片，表现为「开头对一下，闪一下又变回原片」
              const isExportedMediaClip = !!(node.data as { exportedMediaClip?: boolean } | undefined)?.exportedMediaClip;
              let newReferenceVideoUrl = '';
              if (!isExportedMediaClip) {
                const refEdge = incomingEdges.find((e) => {
                  const src = nodeById.get(e.source);
                  if (src?.type === 'digitalHuman') return isDigitalHumanVideoOutputHandle(e.sourceHandle);
                  return isVideoTrackSourceNodeType(src?.type);
                });
                const refSource = refEdge ? nodeById.get(refEdge.source) : null;
                if (refSource?.type === 'digitalHuman') {
                  newReferenceVideoUrl = pickDigitalHumanVideoUrl(refSource.data as Record<string, unknown>);
                } else if (isVideoTrackSourceNodeType(refSource?.type)) {
                  const url = (refSource.data?.originalVideoUrl || refSource.data?.outputVideo) as string | undefined;
                  const t = (url || '').trim();
                  if (
                    t &&
                    (t.startsWith('http://') ||
                      t.startsWith('https://') ||
                      t.startsWith('local-resource://') ||
                      t.startsWith('file://'))
                  ) {
                    newReferenceVideoUrl = t;
                  }
                }
              }
              const currentInputImages = (node.data?.inputImages as string[] | undefined) || [];
              const textParts = collectUpstreamTextPartsForTarget(
                targetId,
                Array.from(nodeById.values()),
                nextEdges as Edge[],
              );
              const newPrompt = textParts.length > 0 ? textParts.join(',') : (node.data?.prompt || '');
              const currentLtx23HdrBackgroundImage = String(node.data?.ltx23HdrBackgroundImage || '').trim();
              const currentInputAudioUrl = (node.data?.inputAudioUrl as string | undefined) || '';
              const keepDirectorSongClip =
                !hasAudioInputEdge &&
                !!currentInputAudioUrl &&
                (Number.isFinite(Number(node.data?.directorAudioClipStartSec)) ||
                  Number.isFinite(Number(node.data?.directorAudioClipEndSec)) ||
                  Number.isFinite(Number(node.data?.directorAudioClipDurationSec)));
              const newInputAudioUrl = hasAudioInputEdge
                ? edgeInputAudioUrl
                : keepDirectorSongClip
                  ? currentInputAudioUrl
                  : '';
              const currentReferenceVideoUrl = ((node.data?.referenceVideoUrl as string | undefined) || '').trim();
              const currentPrompt = (node.data?.prompt as string | undefined) || '';
              const inputImagesChanged = JSON.stringify(currentInputImages) !== JSON.stringify(newInputImages);
              const hdrBackgroundChanged = currentLtx23HdrBackgroundImage !== newLtx23HdrBackgroundImage;
              const inputAudioChanged = currentInputAudioUrl !== newInputAudioUrl;
              const referenceChanged = currentReferenceVideoUrl !== newReferenceVideoUrl;
              const promptChanged = currentPrompt !== newPrompt;
              const hasImg = newInputImages.length > 0 || !!newLtx23HdrBackgroundImage;
              const hasRef = !!newReferenceVideoUrl.trim();
              const hasAud = !!newInputAudioUrl.trim();
              const shouldAutoWanAnimate =
                node.type === 'video' && hasImg && hasRef && !hasAud && newInputImages.length === 1;
              const shouldClearWanAnimate =
                node.type === 'video' && node.data?.model === 'wan-animate' && !hasRef;
              const modelNeedsUpdate = shouldAutoWanAnimate || shouldClearWanAnimate;
              if (inputImagesChanged || hdrBackgroundChanged || inputAudioChanged || referenceChanged || promptChanged || modelNeedsUpdate) {
                mutated = true;
                const modelDataPatch = shouldAutoWanAnimate
                  ? {
                      model: 'wan-animate' as const,
                      resolutionWanAnimate:
                        (node.data?.resolutionWanAnimate as '720p' | '1080p' | undefined) || '720p',
                      wanAnimateClipSec:
                        (node.data?.wanAnimateClipSec as '5' | '8' | '10' | '15' | undefined) || '8',
                    }
                  : shouldClearWanAnimate
                    ? {
                        model: DEFAULT_VIDEO_MODEL_REPLACING_SORA2,
                        durationGrok3: (node.data?.durationGrok3 as string) || '10',
                        resolutionGrok3: '720p' as const,
                      }
                    : {};
                if (selectedNode?.id === node.id) {
                  setVideoInputPanelData((prev) =>
                    prev && prev.nodeId === node.id
                      ? {
                          ...prev,
                          inputImages: newInputImages,
                          ltx23HdrBackgroundImage: newLtx23HdrBackgroundImage || undefined,
                          inputAudioUrl: newInputAudioUrl || undefined,
                          referenceVideoUrl: newReferenceVideoUrl || undefined,
                          ...(promptChanged ? { prompt: newPrompt } : {}),
                          ...(shouldAutoWanAnimate
                            ? {
                                model: 'wan-animate' as const,
                                resolutionWanAnimate:
                                  prev.resolutionWanAnimate || '720p',
                                wanAnimateClipSec: prev.wanAnimateClipSec || '8',
                              }
                            : shouldClearWanAnimate
                              ? {
                                  model: DEFAULT_VIDEO_MODEL_REPLACING_SORA2,
                                  durationGrok3: prev.durationGrok3 || '10',
                                  resolutionGrok3: '720p' as const,
                                }
                              : {}),
                        }
                      : prev
                  );
                }
                nextNodes[nodeIndex] = {
                  ...node,
                  data: {
                    ...node.data,
                    inputImages: newInputImages,
                    ...(promptChanged ? { prompt: newPrompt } : {}),
                    ...(newLtx23HdrBackgroundImage ? { ltx23HdrBackgroundImage: newLtx23HdrBackgroundImage } : {}),
                    ...(inputAudioChanged
                      ? { inputAudioUrl: newInputAudioUrl || undefined }
                      : newInputAudioUrl
                        ? { inputAudioUrl: newInputAudioUrl }
                        : {}),
                    ...(referenceChanged ? { referenceVideoUrl: newReferenceVideoUrl || undefined } : {}),
                    ...modelDataPatch,
                  },
                };
              }
              return;
            }

            if (node.type === 'audio') {
              const patch = buildAudioIncomingPatchFromEdges(
                targetId,
                Array.from(nodeById.values()),
                nextEdges as Edge[],
                node.data as Record<string, unknown>,
              );
              let textConnected = false;
              for (const edge of incomingEdges) {
                const src = nodeById.get(edge.source);
                if (
                  src &&
                  (src.type === 'minimalistText' ||
                    src.type === 'text' ||
                    src.type === 'llm' ||
                    src.type === 'textSplit' ||
                    src.type === 'audioTranscribe')
                ) {
                  textConnected = true;
                  break;
                }
              }
              if (selectedNode?.id === node.id) {
                setAudioInputPanelData((prev) => {
                  if (!prev || prev.nodeId !== node.id) return prev;
                  const nextAudioConnected = !!(patch?.referenceAudioUrl || '').trim();
                  const nextSourceConnected = !!(patch?.sourceSongAudioUrl || '').trim();
                  if (
                    prev.isTextConnected === textConnected &&
                    prev.isAudioConnected === nextAudioConnected &&
                    prev.isSourceSongConnected === nextSourceConnected &&
                    !patch
                  ) {
                    return prev;
                  }
                  return {
                    ...prev,
                    ...(patch || {}),
                    isTextConnected: textConnected,
                    isAudioConnected: nextAudioConnected,
                    isSourceSongConnected: nextSourceConnected,
                  };
                });
              }
              if (patch) {
                const cur = node.data as Record<string, unknown>;
                const changed =
                  String(cur.sourceSongAudioUrl ?? '') !== String(patch.sourceSongAudioUrl ?? '') ||
                  String(cur.referenceAudioUrl ?? '') !== String(patch.referenceAudioUrl ?? '') ||
                  String(cur.model ?? '') !== String(patch.model ?? '');
                if (changed) {
                  mutated = true;
                  nextNodes[nodeIndex] = { ...node, data: { ...node.data, ...patch } };
                }
              }
              return;
            }

            // 导演：从入边音频同步 mvMusic（防 onConnect 写入被旧 patch 冲掉后可再灌回）
            if (node.type === 'director') {
              let audioSource: Node | undefined;
              for (const edge of incomingEdges) {
                const src = nodeById.get(edge.source);
                if (src?.type === 'audio') {
                  audioSource = src;
                  break;
                }
              }
              if (audioSource) {
                const url = pickAudioOutputUrlFromAudioNodeData(
                  audioSource.data as Record<string, unknown>,
                );
                if (url) {
                  const prev = createDefaultDirectorPipelineState(
                    (node.data as { director?: DirectorPipelineState })?.director || {},
                  );
                  const prevUrl = String(prev.mvMusic?.url || '').trim();
                  const mediaDur = Number(audioSource.data?.mediaDurationSec);
                  const durationSec =
                    Number.isFinite(mediaDur) && mediaDur > 0
                      ? mediaDur
                      : prev.mvMusic.durationSec || 0;
                  const title = resolveAudioNodeDisplayTitle(
                    audioSource.data as Record<string, unknown>,
                    prev.mvMusic.title || 'MV音乐',
                  );
                  if (
                    prevUrl !== url ||
                    prev.mode !== 'mv' ||
                    String(prev.mvMusic.sourceNodeId || '') !== audioSource.id
                  ) {
                    mutated = true;
                    const next = createDefaultDirectorPipelineState({
                      ...prev,
                      mode: 'mv',
                      phase: prev.mode === 'mv' ? prev.phase : 'music',
                      mvMusic: {
                        ...prev.mvMusic,
                        url,
                        title,
                        durationSec,
                        sourceNodeId: audioSource.id,
                        summary:
                          prev.mvMusic.summary ||
                          (durationSec > 0 ? `时长约 ${Math.round(durationSec)} 秒` : ''),
                      },
                    });
                    nextNodes[nodeIndex] = {
                      ...node,
                      data: { ...node.data, director: next, title: next.title || node.data?.title },
                    };
                  }
                }
              }
              return;
            }

            if (node.type === 'videoSplice') {
              const built = buildVideoSpliceClipsFromEdges(
                targetId,
                nextEdges as Edge[],
                Array.from(nodeById.values()),
                node.data as { videoClips?: TimelineClip[]; audioTracks?: TimelineClip[][] },
              );
              const connectedIds = collectSpliceIncomingSourceIds(targetId, nextEdges as Edge[]);
              const blockDropOnly =
                spliceRebuildWouldDropConnected(node.data, built, connectedIds) &&
                !spliceBuiltHasNewConnectedSources(node.data, built);
              if (blockDropOnly) {
                return;
              }
              const prevFp = timelineClipsFingerprint(
                normalizeVideoTracks(node.data as { videoTracks?: TimelineClip[][]; videoClips?: TimelineClip[] }),
                (node.data?.audioTracks || [[]]) as TimelineClip[][],
              );
              const nextFp = timelineClipsFingerprint(built.videoTracks, built.audioTracks);
              if (prevFp !== nextFp) {
                mutated = true;
                nextNodes[nodeIndex] = {
                  ...node,
                  data: {
                    ...node.data,
                    ...applyBuiltClipsToSpliceData(node.data, built, connectedIds),
                  },
                };
              }
              return;
            }

            if (node.type === 'photoCollage') {
              const prevLayers = ((node.data?.layers || []) as CollageLayer[]).slice();
              const nextLayers = buildPhotoCollageLayersFromEdges(
                targetId,
                nextEdges as Edge[],
                Array.from(nodeById.values()),
                prevLayers,
              );
              if (JSON.stringify(prevLayers) !== JSON.stringify(nextLayers)) {
                mutated = true;
                nextNodes[nodeIndex] = {
                  ...node,
                  data: { ...node.data, layers: nextLayers },
                };
              }
              return;
            }

            if (node.type === 'gridMap') {
              const cols = Number(node.data?.gridCols) || DEFAULT_GRID_MAP_COLS;
              const rows = Number(node.data?.gridRows) || DEFAULT_GRID_MAP_ROWS;
              const prevCells = ((node.data?.cells || []) as GridMapCell[]).slice();
              const nextCells = buildGridMapCellsFromEdges(
                targetId,
                nextEdges as Edge[],
                Array.from(nodeById.values()),
                prevCells,
                cols,
                rows,
              );
              if (JSON.stringify(prevCells) !== JSON.stringify(nextCells)) {
                mutated = true;
                nextNodes[nodeIndex] = {
                  ...node,
                  data: { ...node.data, cells: nextCells },
                };
              }
              return;
            }

            if (node.type === 'imageComparer') {
              const urls = buildImageComparerUrlsFromEdges(
                targetId,
                nextEdges as Edge[],
                Array.from(nodeById.values()),
              );
              const curA = String(node.data?.imageAUrl || '');
              const curB = String(node.data?.imageBUrl || '');
              if (
                curA !== urls.imageAUrl ||
                curB !== urls.imageBUrl ||
                node.data?.imageASourceNodeId !== urls.imageASourceNodeId ||
                node.data?.imageBSourceNodeId !== urls.imageBSourceNodeId
              ) {
                mutated = true;
                nextNodes[nodeIndex] = {
                  ...node,
                  data: {
                    ...node.data,
                    imageAUrl: urls.imageAUrl,
                    imageBUrl: urls.imageBUrl,
                    imageASourceNodeId: urls.imageASourceNodeId,
                    imageBSourceNodeId: urls.imageBSourceNodeId,
                  },
                };
              }
              return;
            }

            if (node.type === 'llm') {
              const resolvedInputText = resolveLlmInputTextFromEdges(
                targetId,
                Array.from(nodeById.values()),
                nextEdges as Edge[],
              );
              if ((node.data?.inputText || '') !== resolvedInputText) {
                mutated = true;
                nextNodes[nodeIndex] = {
                  ...node,
                  data: { ...node.data, inputText: resolvedInputText },
                };
                if (selectedNode?.id === node.id) {
                  const incoming = (nextEdges as Edge[]).filter((e) => e.target === targetId);
                  const hasTextConnection = incoming.some((e) => {
                    const src = nodeById.get(e.source);
                    return src && (src.type === 'minimalistText' || src.type === 'text');
                  });
                  const hasLLMConnection = incoming.some((e) => {
                    const src = nodeById.get(e.source);
                    return src?.type === 'llm' && !!src.data?.outputText;
                  });
                  const hasSplitConnection = incoming.some((e) => {
                    const src = nodeById.get(e.source);
                    return src?.type === 'textSplit';
                  });
                  setLlmInputPanelData((prev) =>
                    prev && prev.nodeId === node.id
                      ? {
                          ...prev,
                          inputText: resolvedInputText,
                          isInputLocked: false,
                          hasLinkedText:
                            (hasTextConnection || hasLLMConnection || hasSplitConnection) && !!resolvedInputText,
                          linkedInputText: resolvedInputText,
                          linkedTextTitle: collectLinkedTextTitlesForTarget(
                            node.id,
                            Array.from(nodeById.values()),
                            nextEdges as Edge[],
                          ),
                        }
                      : prev,
                  );
                }
              }
              return;
            }

            if (node.type === 'minimalistText' || node.type === 'text') {
              const parts = collectUpstreamTextPartsForTarget(
                targetId,
                Array.from(nodeById.values()),
                nextEdges as Edge[],
              );
              const textVal = parts.join('\n');
              if ((node.data?.text || '') !== textVal) {
                mutated = true;
                nextNodes[nodeIndex] = { ...node, data: { ...node.data, text: textVal } };
              }
              return;
            }

            if (node.type === 'cameraControl') {
              let inputImageUrl = '';
              for (const edge of incomingEdges) {
                const sourceNode = nodeById.get(edge.source);
                if (sourceNode?.type === 'image') {
                  const imgUrl = pickPreviewFromEdgeOrNode(edge, sourceNode.data) || (sourceNode.data?.outputImage as string) || (sourceNode.data?.inputImages as string[])?.[0];
                  if (imgUrl) {
                    inputImageUrl = imgUrl;
                    break;
                  }
                }
              }
              // 连线有输入则优先用连线，否则保留节点已有数据（含复制出的信息）
              const finalInputImage = inputImageUrl || (node.data?.inputImage as string) || '';
              const currentInputImage = (node.data?.inputImage as string) || '';
              if (currentInputImage !== finalInputImage) {
                mutated = true;
                nextNodes[nodeIndex] = {
                  ...node,
                  data: {
                    ...node.data,
                    inputImage: finalInputImage || undefined,
                  },
                };
              }
            }
          });

          return mutated ? nextNodes : nds;
        });
      }

      return nextEdges;
    });

    if (projectId && window.electronAPI) {
      void (async () => {
        if (isExitingRef.current) return;
        try {
          await saveProjectNow();
        } catch (error) {
          console.error('保存连线变化失败:', error);
        }
      })();
    }
  }, [projectId, setEdges, setNodes, selectedNode, saveHistory, saveProjectNow]);

  // 全局 Alt+1 区域截图完成后：在视口中心插入图片节点
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onScreenshotImportToCanvas) return () => {};
    const off = api.onScreenshotImportToCanvas((result) => {
      if (!result?.previewUrl) return;
      const host = reactFlowWrapper.current;
      const flowApi = flowContentApiRef.current;
      if (!host || !flowApi) return;
      const r = host.getBoundingClientRect();
      const centerFlow = flowApi.screenToFlowPosition({
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
      });
      const MIN_W = IMAGE_NODE_MIN_W;
      const MIN_H = IMAGE_NODE_MIN_H;
      const mw = typeof result.width === 'number' && result.width > 0 ? result.width : MIN_W;
      const mh = typeof result.height === 'number' && result.height > 0 ? result.height : MIN_H;
      const scale = Math.max(MIN_W / mw, MIN_H / mh);
      const nodeW = Math.min(2048, Math.max(MIN_W, Math.round(mw * scale)));
      const nodeH = Math.min(2048, Math.max(MIN_H, Math.round(mh * scale)));
      const id = `image-${Date.now()}`;
      const newNode: Node = {
        id,
        type: 'image',
        position: { x: centerFlow.x - nodeW / 2, y: centerFlow.y - nodeH / 2 },
        data: {
          label: '图片节点',
          width: nodeW,
          height: nodeH,
          isUserResized: false,
          prompt: '',
          title: 'image',
          resolution: '1k',
          aspectRatio: DEFAULT_IMAGE_ASPECT_RATIO,
          seedreamWidth: 2048,
          seedreamHeight: 2048,
          model: 'banana-2.0',
          outputImage: result.previewUrl,
          originalImageUrl: result.originalUrl,
          localPath: result.originalPath,
          tinyThumbUrl: result.tinyUrl,
          avgColorHex: result.avgColorHex,
          imageAsset: {
            preview: result.previewUrl,
            tiny: result.tinyUrl,
            original: result.originalUrl,
            ghost: result.ghostBase64,
            avgColorHex: result.avgColorHex,
            width: result.width,
            height: result.height,
          },
        },
      };
      // 与右键新建一致：取消其它选中，新截图节点为选中态（React Flow 描边 + onSelectionChange 补开底部面板）
      const inserted = { ...newNode, selected: true, selectable: true };
      setNodes((nds) => nds.map((n) => ({ ...n, selected: false })).concat(inserted));
      setSelectedNode(inserted);
    });
    return off;
  }, [setNodes, setSelectedNode]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onScreenshotSnipError) return () => {};
    return api.onScreenshotSnipError((p) => showAlert(p.message || '截图失败'));
  }, [showAlert]);
  
  /** 任务列表最大显示数量，超出部分不渲染以减轻内存与性能压力 */
  const MAX_DISPLAY_TASKS = 500;

  const dedupedSortedTasks = useMemo(() => {
    const uniqueTasksMap = new Map<string, Task>();
    for (const task of tasks) {
      const ty = task.taskType || 'image';
      const mediaUrl = taskMediaUrl(task);
      const norm =
        ty === 'image'
          ? taskImageDedupNorm(task)
          : ty === 'video'
            ? taskVideoDedupNorm(task)
            : normalizeMediaUrlForTaskDedup(mediaUrl);
      const isMedia = ty === 'image' || ty === 'video' || ty === 'audio';
      // 同一结果曾用 runtime-xxx 与 task-xxx 两条 id，不能用 task.id 当展示主键
      const useLogicalKey =
        isMedia &&
        norm &&
        (task.status === 'success' || task.status === 'error' || task.status === 'failed' || task.status === 'timeout');
      const key = useLogicalKey ? `media:${task.nodeId}:${ty}:${norm}` : `id:${task.id}`;

      const existing = uniqueTasksMap.get(key);
      if (!existing) uniqueTasksMap.set(key, task);
      else uniqueTasksMap.set(key, pickBetterTaskForDedup(existing, task));
    }

    let values = Array.from(uniqueTasksMap.values());
    // 规范化键仍不同的双写（如 http 与 local）；多轮合并传递性重复
    for (let pass = 0; pass < 8; pass++) {
      const removed = new Set<string>();
      for (let i = 0; i < values.length; i++) {
        for (let j = i + 1; j < values.length; j++) {
          const a = values[i];
          const b = values[j];
          if (removed.has(a.id) || removed.has(b.id)) continue;
          if (a.nodeId !== b.nodeId || a.taskType !== b.taskType) continue;
          const imageDedupSame =
            a.taskType === 'image' &&
            b.taskType === 'image' &&
            (() => {
              const da = taskImageDedupNorm(a);
              const db = taskImageDedupNorm(b);
              return Boolean(da && db && da === db);
            })();
          const videoDedupSame =
            a.taskType === 'video' &&
            b.taskType === 'video' &&
            (() => {
              const da = taskVideoDedupNorm(a);
              const db = taskVideoDedupNorm(b);
              return Boolean(da && db && da === db);
            })();
          const runtimeVsFormalDup =
            (a.taskType === 'video' || a.taskType === 'image' || a.taskType === 'audio') &&
            a.taskType === b.taskType &&
            a.status === 'success' &&
            b.status === 'success' &&
            String(a.id).startsWith('runtime-') !== String(b.id).startsWith('runtime-');
          if (
            !imageDedupSame &&
            !videoDedupSame &&
            !runtimeVsFormalDup &&
            !mediaUrlsLikelySameArtifact(taskMediaUrl(a), taskMediaUrl(b))
          ) continue;
          const better = pickBetterTaskForDedup(a, b);
          removed.add(better.id === a.id ? b.id : a.id);
        }
      }
      if (removed.size === 0) break;
      values = values.filter((t) => !removed.has(t.id));
    }

    const sorted = values.sort((a, b) => b.createdAt - a.createdAt);
    return sorted.slice(0, MAX_DISPLAY_TASKS);
  }, [tasks]);

  const hasTimeoutTask = useMemo(() => tasks.some((t) => t.status === 'timeout'), [tasks]);

  useEffect(() => {
    if (!hasTimeoutTask || !window.electronAPI?.nxCloudGetTasks) {
      if (timeoutPollTimerRef.current) {
        clearTimeout(timeoutPollTimerRef.current);
        timeoutPollTimerRef.current = null;
      }
      return;
    }
    if (timeoutPollTimerRef.current) return;
    timeoutPollInFlightRef.current = false;
    timeoutPollFailureCountRef.current = 0;
    timeoutPollDelayMsRef.current = 60_000;
    const scheduleNextTimeoutPoll = (delayMs: number) => {
      if (timeoutPollTimerRef.current) clearTimeout(timeoutPollTimerRef.current);
      timeoutPollTimerRef.current = setTimeout(runTimeoutPollTick, delayMs);
    };
    const runTimeoutPollTick = async () => {
      if (timeoutPollInFlightRef.current) {
        scheduleNextTimeoutPoll(60_000);
        return;
      }
      timeoutPollInFlightRef.current = true;
      try {
        const res = await window.electronAPI.nxCloudGetTasks(50);
        const items = Array.isArray(res?.items) ? res.items : [];
        const successRows = items.filter((i) => String(i.status || '').toLowerCase() === 'success' && String(i.result_oss_url || '').trim());
        if (successRows.length === 0) return;
        setTasks((prev) =>
          prev.map((t) => {
            if (t.status !== 'timeout') return t;
            const hit = successRows.find((row) => {
              const p = String(row.prompt_json || '');
              const key = (t.prompt || '').trim().slice(0, 18);
              return key ? p.includes(key) : true;
            });
            if (!hit) return t;
            const url = String(hit.result_oss_url || '').trim();
            if (!url) return t;
            return {
              ...t,
              status: 'success',
              imageUrl: t.taskType === 'image' ? url : t.imageUrl,
              videoUrl: t.taskType === 'video' ? url : t.videoUrl,
              audioUrl: t.taskType === 'audio' ? url : t.audioUrl,
              errorMessage: undefined,
            };
          }),
        );
        timeoutPollFailureCountRef.current = 0;
        timeoutPollDelayMsRef.current = 60_000;
      } catch {
        timeoutPollFailureCountRef.current += 1;
        if (timeoutPollFailureCountRef.current > 3) {
          console.error('[Workspace] 超时任务同步失败次数超过上限，已停止自动轮询，等待手动触发。');
          if (timeoutPollTimerRef.current) {
            clearTimeout(timeoutPollTimerRef.current);
            timeoutPollTimerRef.current = null;
          }
          return;
        }
        timeoutPollDelayMsRef.current = Math.max(60_000, Math.min(timeoutPollDelayMsRef.current * 2, 480_000));
      } finally {
        timeoutPollInFlightRef.current = false;
        if (timeoutPollTimerRef.current !== null) {
          scheduleNextTimeoutPoll(timeoutPollDelayMsRef.current);
        }
      }
    };
    scheduleNextTimeoutPoll(60_000);
    return () => {
      if (timeoutPollTimerRef.current) {
        clearTimeout(timeoutPollTimerRef.current);
        timeoutPollTimerRef.current = null;
      }
    };
  }, [hasTimeoutTask]);

  // LLM 输入面板状态（用于底部弹窗）
  const [llmInputPanelData, setLlmInputPanelData] = useState<{
    nodeId: string;
    inputText: string;
    userInput: string;
    prompt: string;
    savedPrompts: Array<{ id: string; name: string; content: string }>;
    isInputLocked?: boolean;
    /** 上游文本已连入（显示标题标签；正文不进入底栏） */
    hasLinkedText?: boolean;
    linkedInputText?: string;
    /** 上游文本节点标题（角标与输入区内标签） */
    linkedTextTitle?: string;
    isImageReverseMode?: boolean;
    imageUrlForReverse?: string;
    imageAssetForReverse?: DualImageAsset;
    isVideoAnalysisMode?: boolean;
    videoUrlForAnalysis?: string;
    /** 图像反推使用的模型：gpt-4o | joy-caption-two */
    /** 图像反推：openai/gpt-5.6-terra | joy-caption-two（旧 gpt-4o 规范为 Terra） */
    reverseCaptionModel?: ImageReverseCaptionModel;
    /** 普通对话聊天模型 */
    chatModel?: string;
  } | null>(null);
  const llmInputPanelDataRef = useRef<typeof llmInputPanelData>(null);
  useEffect(() => {
    llmInputPanelDataRef.current = llmInputPanelData;
  }, [llmInputPanelData]);

  const [storyboardScriptInputPanelData, setStoryboardScriptInputPanelData] = useState<{
    nodeId: string;
    userPrompt: string;
    chatModel?: string;
    storyboardScript?: StoryboardScriptState;
    imageUrls: string[];
    videoUrls: string[];
  } | null>(null);
  const storyboardScriptInputPanelDataRef = useRef<typeof storyboardScriptInputPanelData>(null);
  useEffect(() => {
    storyboardScriptInputPanelDataRef.current = storyboardScriptInputPanelData;
  }, [storyboardScriptInputPanelData]);

  const [directorInputPanelData, setDirectorInputPanelData] = useState<{
    nodeId: string;
    userPrompt: string;
    chatModel?: string;
    scriptText: string;
    director?: DirectorPipelineState;
  } | null>(null);
  const directorInputPanelDataRef = useRef<typeof directorInputPanelData>(null);
  useEffect(() => {
    directorInputPanelDataRef.current = directorInputPanelData;
  }, [directorInputPanelData]);

  // Image 输入面板状态（用于底部弹窗）
  const [imageInputPanelData, setImageInputPanelData] = useState<{
    nodeId: string;
    prompt: string;
    resolution: string;
    aspectRatio: string;
    model: string;
    /** 全能图片 G-2 文生图：low | medium | high */
    quality?: string;
    seedreamWidth?: number; // seedream-v4.5 宽 1024-4096
    seedreamHeight?: number; // seedream-v4.5 高 1024-4096
    inputImages?: string[]; // 输入的参考图数组（最多10张）
  } | null>(null);
  const imageInputPanelDataRef = useRef<typeof imageInputPanelData>(null);
  useEffect(() => {
    imageInputPanelDataRef.current = imageInputPanelData;
  }, [imageInputPanelData]);

  const [imageTo3dInputPanelData, setImageTo3dInputPanelData] = useState<{
    nodeId: string;
    inputImageUrl: string;
    resultTextureUrl?: string;
    model?: string;
  } | null>(null);
  const imageTo3dInputPanelDataRef = useRef<typeof imageTo3dInputPanelData>(null);
  useEffect(() => {
    imageTo3dInputPanelDataRef.current = imageTo3dInputPanelData;
  }, [imageTo3dInputPanelData]);

  const [rvcTrainInputPanelData, setRvcTrainInputPanelData] = useState<{
    nodeId: string;
    rvcTrainModelName?: string;
    referenceAudioUrl?: string;
    libraryAvatarUrl?: string;
  } | null>(null);
  const rvcTrainInputPanelDataRef = useRef<typeof rvcTrainInputPanelData>(null);
  useEffect(() => {
    rvcTrainInputPanelDataRef.current = rvcTrainInputPanelData;
  }, [rvcTrainInputPanelData]);

  // Video 输入面板状态（用于底部弹窗）
  const [videoInputPanelData, setVideoInputPanelData] = useState<{
    nodeId: string;
    prompt: string;
    aspectRatio: '16:9' | '9:16' | '1:1' | '2:3' | '3:2' | 'adaptive' | '4:3' | '3:4' | '21:9';
    model: 'sora-2' | 'sora-2-pro' | 'kling-v2.6-pro' | 'kling-video-o1' | 'kling-video-o1-i2v' | 'kling-video-o1-start-end' | 'kling-video-o1-ref' | 'wan-2.6' | 'wan-2.6-flash' | 'wan-animate' | 'hey-gem' | 'gemini-omni' | 'gemini-omni-flash' | 'seedance-2.0-fast' | 'seedance-2.0-mini' | 'ltx-2.3-lipsync' | 'ltx-2.3-i2v' | 'ltx-2.3-t2v' | 'ltx-2.3-hdr-multi' | 'ltx-2.3-msr-av' | 'rhart-v3.1-fast' | 'rhart-v3.1-fast-se' | 'rhart-v3.1-pro' | 'rhart-v3.1-pro-se' | 'grok-3' | 'rhart-video-x' | 'grok-3-stable' | 'rhart-v3.1-pro-official-i2v' | 'hailuo-02-t2v-standard' | 'hailuo-2.3-t2v-standard' | 'hailuo-02-i2v-standard' | 'hailuo-2.3-i2v-standard' | 'rh-video-start-end';
    hd: boolean;
    duration: '5' | '10' | '15' | '25';
    inputImages?: string[];
    ltx23HdrBackgroundImage?: string;
    resolutionRhartV31?: '720p' | '1080p' | '4k';
    durationGrok3?: string;
    resolutionGrok3?: '720p';
    durationHailuo02?: '6' | '10';
    /** 海螺 FC 计费 SKU；默认 na 表示单档 */
    resolutionHailuo?: 'na' | '720p' | '1080p' | '4k';
    durationKlingO1?: '5' | '10';
    modeKlingO1?: 'std' | 'pro';
    referenceVideoUrl?: string;
    keepOriginalSound?: boolean;
    isConnected?: boolean;
    guidanceScale?: number;
    sound?: 'true' | 'false';
    shotType?: 'single' | 'multi';
    negativePrompt?: string;
    resolutionWan26?: '720p' | '1080p';
    resolutionWanAnimate?: '720p' | '1080p';
    wanAnimateClipSec?: '5' | '8' | '10' | '15';
    resolutionSeedance?: '480p' | '720p' | '1080p' | '2k' | '4k';
    durationSeedance?: '5' | '10' | '15';
    resolutionGeminiOmni?: '720p' | '1080p' | '4k';
    durationGeminiOmni?: '6' | '8' | '10';
    durationWan26Flash?: '2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'11'|'12'|'13'|'14'|'15';
    enableAudio?: boolean;
    durationVeo31ProOfficial?: '4' | '6' | '8';
    generateAudioVeo31ProOfficial?: boolean;
    inputAudioUrl?: string;
    resolutionLtx23Lipsync?: '720' | '1280' | '1920';
    durationLtx23I2v?: '5' | '10' | '15';
    resolutionLtx23I2v?: '720' | '1280' | '1920';
    durationLtx23T2v?: '5' | '10' | '15';
    resolutionLtx23T2v?: '720' | '1280' | '1920';
    durationLtx23HdrMulti?: '5' | '10' | '15';
    resolutionLtx23HdrMulti?: '720' | '1280';
    sora2Channel?: 'plugin' | 'core';
    /** 视频生成进度 0–100，用于面板内立即显示进度条 */
    progress?: number;
    progressMessage?: string;
    /** HeyGem 一体化：台词 / TTS / 克隆参考音 */
    heyGemScript?: string;
    heyGemTtsModel?: string;
    heyGemCloneAudioUrl?: string;
  } | null>(null);
  const videoInputPanelDataRef = useRef<typeof videoInputPanelData>(null);
  useEffect(() => {
    videoInputPanelDataRef.current = videoInputPanelData;
  }, [videoInputPanelData]);

  /** 选中节点 data.progress 变化时同步到底部面板（生成中重选、批量运行等） */
  useEffect(() => {
    if (!selectedNode || !videoInputPanelData || videoInputPanelData.nodeId !== selectedNode.id) return;
    if (!isVideoModuleNodeType(selectedNode.type)) return;
    const next = readVideoInputPanelProgressFromNode(selectedNode);
    if (
      (videoInputPanelData.progress ?? 0) === next.progress &&
      (videoInputPanelData.progressMessage ?? '') === (next.progressMessage ?? '')
    ) {
      return;
    }
    setVideoInputPanelData((prev) =>
      prev && prev.nodeId === selectedNode.id
        ? { ...prev, progress: next.progress, progressMessage: next.progressMessage }
        : prev
    );
  }, [
    selectedNode,
    selectedNode?.data?.progress,
    selectedNode?.data?.progressMessage,
    videoInputPanelData?.nodeId,
    videoInputPanelData?.progress,
    videoInputPanelData?.progressMessage,
  ]);

  const [characterInputPanelData, setCharacterInputPanelData] = useState<{
    nodeId: string;
    videoUrl: string;
    nickname: string;
    timestamp: string;
    characterChannel?: 'plugin' | 'core'; // 核心算力 / 插件算力
    isConnected?: boolean;
    isUploading?: boolean;
    needsUpload?: boolean; // 是否需要上传（检测到本地视频但未上传）
    localVideoPath?: string; // 本地视频路径（用于上传）
    uploadPromise?: Promise<{ success: boolean; url?: string; error?: string }>; // 视频上传到 OSS 的 Promise
  } | null>(null);

  // Audio 输入面板状态（挂到节点下方，对齐 Image/Video）
  const [audioInputPanelData, setAudioInputPanelData] = useState<{
    nodeId: string;
    text: string;
    model?: string;
    voiceId: string;
    speed: number;
    volume: number;
    pitch: number;
    emotion?: 'happy' | 'sad' | 'angry' | 'fearful' | 'disgusted' | 'surprised' | 'neutral';
    /** 上游文本/LLM 等已连入 */
    isTextConnected?: boolean;
    /** 上游音频已连入（参考音） */
    isAudioConnected?: boolean;
    /** 上游原曲已连入 */
    isSourceSongConnected?: boolean;
    referenceAudioUrl?: string;
    sourceSongAudioUrl?: string;
    coverPitch?: number;
    coverIndexRate?: number;
    coverVocalMixPct?: number;
    coverAccompanimentMixPct?: number;
    coverRhVolume?: number;
    coverOutputMode?: RvcCoverOutputMode;
    rvcTrainModelName?: string;
    rvcCoverModelName?: string;
    outputModelUrl?: string;
    outputModelRemoteUrl?: string;
    coverReferenceAudioUrl?: string;
    libraryRvcVoiceId?: string;
    songName?: string;
    styleDesc?: string;
    lyrics?: string;
    speechRate?: number;
    loudnessRate?: number;
  } | null>(null);

  const createNodeFromTask = useCallback(
    (task: Task, position: { x: number; y: number }) => {
      let taskType =
        task.taskType ||
        (task.imageUrl ? 'image' : task.videoUrl ? 'video' : task.audioUrl ? 'audio' : task.prompt?.trim() ? 'text' : 'image');
      const imageUrl = task.imageUrl || (task.localFilePath ? `local-resource://${task.localFilePath.replace(/\\/g, '/')}` : '');
      let videoUrl = task.videoUrl || (task.localFilePath && taskType === 'video' ? `local-resource://${task.localFilePath.replace(/\\/g, '/')}` : '');
      let audioUrl = task.audioUrl || (task.localFilePath && taskType === 'audio' ? `local-resource://${task.localFilePath.replace(/\\/g, '/')}` : '');
      // 历史误标：音频被写成 taskType=video + videoUrl=mp3 → 放入画布会变成空视频节点
      if (
        (taskType === 'video' || !!videoUrl) &&
        (looksLikeAudioMediaUrl(videoUrl) || looksLikeAudioMediaUrl(audioUrl) || looksLikeAudioMediaUrl(task.localFilePath))
      ) {
        taskType = 'audio';
        if (!audioUrl) audioUrl = videoUrl || (task.localFilePath ? `local-resource://${task.localFilePath.replace(/\\/g, '/')}` : '');
        videoUrl = '';
      }
      const nodeTitle = (task.nodeTitle || taskType).replace(/[/\\?*:|"]/g, '_');
      const textContent = (task.prompt || '').trim();

      if (taskType === 'image' && imageUrl) {
        const nodeId = `image-${Date.now()}`;
        const newNode: Node = {
          id: nodeId,
          type: 'image',
          position,
          data: {
            label: 'image',
            outputImage: imageUrl,
            originalImageUrl: imageUrl,
            title: nodeTitle,
            prompt: task.prompt || '',
            width: IMAGE_NODE_DEFAULT_W,
            height: IMAGE_NODE_DEFAULT_H,
            moduleSizeScaleVersion: MODULE_SIZE_SCALE_VERSION,
          },
          selected: true,
          selectable: true,
        };
        setNodes((nds) => nds.map((n) => ({ ...n, selected: false })).concat(newNode));
        setSelectedNode(newNode);
        setImageInputPanelData((prev) => (prev ? null : null));
      } else if (taskType === 'video' && videoUrl) {
        const nodeId = `video-${Date.now()}`;
        const newNode: Node = {
          id: nodeId,
          type: 'video',
          position,
          data: {
            label: 'video',
            outputVideo: videoUrl,
            originalVideoUrl: videoUrl,
            title: nodeTitle,
            prompt: task.prompt || '',
            width: VIDEO_NODE_DEFAULT_W,
            height: VIDEO_NODE_DEFAULT_H,
            moduleSizeScaleVersion: MODULE_SIZE_SCALE_VERSION,
          },
          selected: true,
          selectable: true,
        };
        setNodes((nds) => nds.map((n) => ({ ...n, selected: false })).concat(newNode));
        setSelectedNode(newNode);
        setVideoInputPanelData({
          nodeId,
          prompt: task.prompt || '',
          aspectRatio: '16:9',
          model: HIDE_SORA2_AND_SORA_CHARACTER_UI ? DEFAULT_VIDEO_MODEL_REPLACING_SORA2 : 'sora-2',
          hd: false,
          duration: '10',
          inputImages: [],
          resolutionRhartV31: '1080p',
          durationGrok3: '10',
          resolutionGrok3: '720p',
          durationHailuo02: '6',
          resolutionHailuo: 'na',
          durationKlingO1: '5',
          modeKlingO1: 'std',
          guidanceScale: 0.5,
          sound: 'false',
          shotType: 'single',
          negativePrompt: '',
          resolutionWan26: '1080p',
          resolutionWanAnimate: '720p',
          wanAnimateClipSec: '8',
          resolutionSeedance: '720p',
          durationSeedance: '10',
          resolutionGeminiOmni: '720p',
          durationGeminiOmni: '6',
          durationWan26Flash: '5',
          enableAudio: true,
          durationVeo31ProOfficial: '4',
          generateAudioVeo31ProOfficial: false,
          referenceVideoUrl: undefined,
          keepOriginalSound: false,
          inputAudioUrl: undefined,
          resolutionLtx23Lipsync: '720',
          durationLtx23I2v: '10',
          resolutionLtx23I2v: '720',
          durationLtx23T2v: '10',
          resolutionLtx23T2v: '720',
          sora2Channel: 'plugin',
          isConnected: false,
        });
        setLlmInputPanelData(null);
        setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
        setCharacterInputPanelData(null);
        setAudioInputPanelData(null);
      } else if (taskType === 'audio' && audioUrl) {
        const nodeId = `audio-${Date.now()}`;
        const newNode: Node = {
          id: nodeId,
          type: 'audio',
          position,
          data: {
            label: 'audio',
            outputAudio: audioUrl,
            originalAudioUrl: audioUrl,
            title: nodeTitle,
            text: '',
            voiceId: 'Wise_Woman',
            speed: 1,
            volume: 1,
            pitch: 0,
            referenceAudioUrl: '',
            aiStatus: 'idle' as const,
          },
          selected: true,
          selectable: true,
        };
        setNodes((nds) => nds.map((n) => ({ ...n, selected: false })).concat(newNode));
        setSelectedNode(newNode);
        setAudioInputPanelData({
          nodeId,
          text: '',
          model: 'speech-2.8-hd',
          voiceId: 'Wise_Woman',
          speed: 1,
          volume: 1,
          pitch: 0,
          emotion: undefined,
          referenceAudioUrl: '',
          songName: '',
          styleDesc: '',
          lyrics: '',
        });
        setVideoInputPanelData(null);
        setLlmInputPanelData(null);
        setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
        setCharacterInputPanelData(null);
      } else if (taskType === 'text' && textContent) {
        const nodeId = `llm-${Date.now()}`;
        const newNode: Node = {
          id: nodeId,
          type: 'llm',
          position,
          data: {
            label: 'llm',
            title: task.nodeTitle || 'llm',
            outputText: textContent,
            width: scaleModulePx(300),
            height: AUDIO_NODE_HEIGHT,
            moduleSizeScaleVersion: MODULE_SIZE_SCALE_VERSION,
            isUserResized: false,
          },
          selected: true,
          selectable: true,
        };
        setNodes((nds) => nds.map((n) => ({ ...n, selected: false })).concat(newNode));
        setSelectedNode(newNode);
        setVideoInputPanelData(null);
        setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
        setCharacterInputPanelData(null);
        setAudioInputPanelData(null);
      }
    },
    [setNodes, setSelectedNode, setVideoInputPanelData, setLlmInputPanelData, setImageInputPanelData, setCharacterInputPanelData, setAudioInputPanelData]
  );

  const handleTaskPlaceToCanvas = useCallback(
    (task: Task) => {
      const api = flowContentApiRef.current;
      const wrapper = reactFlowWrapper.current;
      if (!api?.screenToFlowPosition || !wrapper) {
        createNodeFromTask(task, { x: 100, y: 100 });
        return;
      }
      const rect = wrapper.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const flowPos = api.screenToFlowPosition({ x: centerX, y: centerY });
      createNodeFromTask(task, flowPos);
    },
    [createNodeFromTask]
  );

  // 侧边栏展开/收起状态
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false); // 默认收起任务列表
  const [characterListCollapsed, setCharacterListCollapsed] = useState(true); // 默认收起角色列表
  const [characterListRefreshTrigger, setCharacterListRefreshTrigger] = useState(0);
  const [sceneListRefreshTrigger, setSceneListRefreshTrigger] = useState(0);
  const [digitalHumanListRefreshTrigger, setDigitalHumanListRefreshTrigger] = useState(0);
  const [rvcVoiceListRefreshTrigger, setRvcVoiceListRefreshTrigger] = useState(0);
  
  // Laf 云端元宝
  const [lafStatus, setLafStatus] = useState<'idle' | 'connecting' | 'success' | 'error'>('idle');
  const [lafBalance, setLafBalance] = useState<number | null>(null);

  // 右键菜单状态（含拖线到空白处时的 connectFrom，用于创建节点后自动连边）
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    flowX?: number;
    flowY?: number;
    connectFrom?: { sourceNodeId: string; sourceHandleId: string | null; handleType: string | null };
  } | null>(null);

  // 画板工具：打开后挂起，完成时创建 Image 节点
  const [canvasToolPending, setCanvasToolPending] = useState<{
    position: { x: number; y: number };
    connectFrom?: { sourceNodeId: string; sourceHandleId: string | null; handleType: string | null };
  } | null>(null);

  // 画板编辑：从 Image 节点画板按钮打开，在画布上加载当前图片供绘图标记
  const [drawingBoardForImage, setDrawingBoardForImage] = useState<{ imageUrl: string; nodeId: string; localPath?: string } | null>(null);
  
  // 明暗模式状态（与项目列表页共用 localStorage）
  const [isDarkMode, setIsDarkMode] = useState(() => readIsDarkMode());

  // 光明模式亮度（0.5–1，即 50%–100%，默认 1），仅作用于 light-mode
  const [lightBrightness, setLightBrightness] = useState(() => {
    if (typeof localStorage === 'undefined') return 1;
    const v = localStorage.getItem('nexflow_light_brightness');
    const n = v ? parseFloat(v) : 1;
    return Number.isFinite(n) && n >= 0.5 && n <= 1 ? n : 1;
  });
  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('nexflow_light_brightness', String(lightBrightness));
    }
  }, [lightBrightness]);

  // 光明模式画布背景色、波点色、波点粗细（默认浅灰底 / 纯黑波点 / 200%）
  const LIGHT_CANVAS_BG_DEFAULT = '#E5E7EB';
  const LIGHT_DOTS_COLOR_DEFAULT = '#000000';
  const LIGHT_DOT_SIZE_DEFAULT = 2;
  const DARK_DOT_SIZE_DEFAULT = 1.2;
  const [lightCanvasBgColor, setLightCanvasBgColor] = useState(() => {
    if (typeof localStorage === 'undefined') return LIGHT_CANVAS_BG_DEFAULT;
    const v = localStorage.getItem('nexflow_light_canvas_bg');
    if (v == null || v === '#ffffff') return LIGHT_CANVAS_BG_DEFAULT;
    return v;
  });
  const [lightDotsColor, setLightDotsColor] = useState(() => {
    if (typeof localStorage === 'undefined') return LIGHT_DOTS_COLOR_DEFAULT;
    const v = localStorage.getItem('nexflow_light_dots');
    if (v == null || v === '#333333') return LIGHT_DOTS_COLOR_DEFAULT;
    return v;
  });
  const [lightDotSize, setLightDotSize] = useState(() => {
    if (typeof localStorage === 'undefined') return LIGHT_DOT_SIZE_DEFAULT;
    const v = localStorage.getItem('nexflow_light_dot_size');
    if (v == null || v === '1') return LIGHT_DOT_SIZE_DEFAULT;
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= 0.5 && n <= 4 ? n : LIGHT_DOT_SIZE_DEFAULT;
  });
  const [darkDotSize, setDarkDotSize] = useState(() => {
    if (typeof localStorage === 'undefined') return DARK_DOT_SIZE_DEFAULT;
    const v = localStorage.getItem('nexflow_dark_dot_size');
    if (v == null) return DARK_DOT_SIZE_DEFAULT;
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= 0.5 && n <= 4 ? n : DARK_DOT_SIZE_DEFAULT;
  });
  const CANVAS_DOT_GAP_DEFAULT = 60;
  const [canvasDotGap, setCanvasDotGap] = useState(() => {
    if (typeof localStorage === 'undefined') return CANVAS_DOT_GAP_DEFAULT;
    const v = localStorage.getItem('nexflow_canvas_dot_gap');
    if (v == null) return CANVAS_DOT_GAP_DEFAULT;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 20 && n <= 180 ? n : CANVAS_DOT_GAP_DEFAULT;
  });
  const [moduleComponentColor, setModuleComponentColor] = useState<string | undefined>(() => {
    if (typeof localStorage === 'undefined') return undefined;
    return localStorage.getItem('nexflow_module_component_color') || undefined;
  });
  const LIGHT_EDGE_COLOR_DEFAULT = '#9CA3AF';
  // 连接线颜色（光明/暗黑模式通用，明亮模式默认深灰 #9CA3AF）
  const [edgeColor, setEdgeColor] = useState<string | undefined>(() => {
    if (typeof localStorage === 'undefined') return LIGHT_EDGE_COLOR_DEFAULT;
    const v = localStorage.getItem('nexflow_edge_color');
    return v || LIGHT_EDGE_COLOR_DEFAULT;
  });
  useEffect(() => {
    if (typeof localStorage !== 'undefined' && edgeColor != null) {
      localStorage.setItem('nexflow_edge_color', edgeColor);
    }
  }, [edgeColor]);
  // 连接线样式：curve=曲线，smoothStep=直角圆角
  const [edgePathStyle, setEdgePathStyle] = useState<'curve' | 'smoothStep'>(() => {
    if (typeof localStorage === 'undefined') return 'curve';
    const v = localStorage.getItem('nexflow_edge_path_style');
    return v === 'smoothStep' ? 'smoothStep' : 'curve';
  });
  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('nexflow_edge_path_style', edgePathStyle);
    }
  }, [edgePathStyle]);
  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('nexflow_light_canvas_bg', lightCanvasBgColor);
    }
  }, [lightCanvasBgColor]);
  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('nexflow_light_dots', lightDotsColor);
    }
  }, [lightDotsColor]);
  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('nexflow_light_dot_size', String(lightDotSize));
    }
  }, [lightDotSize]);
  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('nexflow_dark_dot_size', String(darkDotSize));
    }
  }, [darkDotSize]);
  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('nexflow_canvas_dot_gap', String(canvasDotGap));
    }
  }, [canvasDotGap]);

  const canvasDotSize = isDarkMode ? darkDotSize : lightDotSize;

  /** 切换明暗时应用各模式默认波点：明亮 200% / 暗黑 120% */
  const handleSetIsDarkMode = useCallback((next: boolean) => {
    setIsDarkMode(next);
    writeIsDarkMode(next);
    if (next) {
      setDarkDotSize(DARK_DOT_SIZE_DEFAULT);
    } else {
      setLightDotSize(LIGHT_DOT_SIZE_DEFAULT);
    }
  }, []);

  useEffect(() => {
    if (typeof localStorage !== 'undefined' && moduleComponentColor != null) {
      localStorage.setItem('nexflow_module_component_color', moduleComponentColor);
    }
  }, [moduleComponentColor]);

  // 云端元宝：启动时拉取 /me（含 JWT），并监听 run-task 扣费后的更新；定时轮询同步云端余额
  useEffect(() => {
    if (!window.electronAPI) return;

    const load = async () => {
      try {
        let loggedIn = false;
        if (window.electronAPI.getNxSaasState) {
          try {
            const pre = await window.electronAPI.getNxSaasState();
            loggedIn = pre.loggedIn === true;
          } catch {
            /* ignore */
          }
        }
        setLafStatus('connecting');
        const state = window.electronAPI.nxCloudGetProfile
          ? await window.electronAPI.nxCloudGetProfile()
          : await window.electronAPI.initLafUser();
        setLafStatus(state.status as 'idle' | 'connecting' | 'success' | 'error');
        if (loggedIn && typeof state.balance === 'number') {
          setLafBalance(state.balance);
        } else {
          setLafBalance(state.status === 'success' ? state.balance : null);
        }
      } catch {
        setLafStatus('error');
        setLafBalance(null);
      }
    };
    load();

    const unsub = window.electronAPI.onLafBalanceUpdated((state) => {
      void (async () => {
        try {
          if (window.electronAPI.getNxSaasState) {
            const pre = await window.electronAPI.getNxSaasState();
            if (!pre.loggedIn) {
              setLafStatus('idle');
              setLafBalance(null);
              return;
            }
            setLafStatus(state.status as 'idle' | 'connecting' | 'success' | 'error');
            setLafBalance(typeof state.balance === 'number' ? state.balance : null);
            return;
          }
          setLafStatus(state.status as 'idle' | 'connecting' | 'success' | 'error');
          setLafBalance(state.status === 'success' ? state.balance : null);
        } catch {
          setLafStatus(state.status as 'idle' | 'connecting' | 'success' | 'error');
          setLafBalance(state.status === 'success' ? state.balance : null);
        }
      })();
    });

    // 轮询由 App 全局负责（hash 切换 + 45s），避免项目列表与画布顶栏余额不一致

    return () => {
      unsub();
    };
  }, []);

  // 全局人设列表状态
  const [globalPersonas, setGlobalPersonas] = useState<Array<{ id: string; name: string; content: string }>>([]);

  // 加载全局人设列表
  useEffect(() => {
    if (!window.electronAPI) return;

    const loadGlobalPersonas = async () => {
      try {
        const personas = await window.electronAPI.getGlobalLLMPersonas();
        setGlobalPersonas(personas || []);
      } catch (error) {
        console.error('加载全局人设失败:', error);
      }
    };

    loadGlobalPersonas();
  }, []);

  // 加载任务列表
  useEffect(() => {
    if (!window.electronAPI) return;

    const loadTasks = async () => {
      try {
        const result = await window.electronAPI.loadTasks();
        if (result.success && result.tasks) {
          setTasks((prev) => {
            if (prev.length === 0) return result.tasks!;
            const loadedIds = new Set(result.tasks!.map((t) => t.id));
            const onlyInMemory = prev.filter((t) => !loadedIds.has(t.id));
            if (onlyInMemory.length === 0) return result.tasks!;
            return [...onlyInMemory, ...result.tasks!].sort((a, b) => b.createdAt - a.createdAt);
          });
          console.log('[任务列表] 已加载', result.tasks.length, '个任务');
        }
      } catch (error) {
        console.error('加载任务列表失败:', error);
      } finally {
        tasksListHydratedRef.current = true;
      }
    };

    loadTasks();
  }, []);

  // 自动保存任务列表（使用防抖，避免频繁保存）
  const saveTasksTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialLoadRef = useRef(true); // 标记是否是初始加载
  useEffect(() => {
    if (!window.electronAPI) return;

    // 跳过初始加载时的保存（因为初始加载时 tasks 会从空数组变为加载的数据）
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      return;
    }

    // 清除之前的定时器
    if (saveTasksTimeoutRef.current) {
      clearTimeout(saveTasksTimeoutRef.current);
    }

    // 设置新的定时器，延迟 1 秒保存（防抖）
    saveTasksTimeoutRef.current = setTimeout(async () => {
      try {
        const result = await window.electronAPI.saveTasks(tasks);
        if (result.success && result.tasks && result.tasks.length !== tasks.length) {
          const keptIds = new Set(result.tasks.map((t) => t.id));
          const wronglyRemovedText = tasks.filter(
            (t) =>
              t.taskType === 'text' &&
              (t.prompt || '').trim() &&
              t.status === 'success' &&
              !keptIds.has(t.id),
          );
          if (wronglyRemovedText.length > 0) {
            const merged = [...wronglyRemovedText, ...result.tasks].sort((a, b) => b.createdAt - a.createdAt);
            setTasks(merged);
            void window.electronAPI.saveTasks(merged);
            console.warn('[任务列表] 已恢复被误删的文本任务', wronglyRemovedText.length, '条');
          } else {
            setTasks(result.tasks);
            console.log('[任务列表] 已保存并清理无效任务:', result.tasks.length, '个');
          }
        } else {
          console.log('[任务列表] 已保存', tasks.length, '个任务');
        }
      } catch (error) {
        console.error('保存任务列表失败:', error);
      }
    }, 1000);

    // 清理函数
    return () => {
      if (saveTasksTimeoutRef.current) {
        clearTimeout(saveTasksTimeoutRef.current);
      }
    };
  }, [tasks]);

  // 加载项目数据
  useEffect(() => {
    if (!projectId || !window.electronAPI) return;

    hydratedProjectIdRef.current = null;
    userExplicitlyEmptiedRef.current = false;
    prevNodeCountForEmptyDetectRef.current = 0;
    setNodes([]);
    setEdges([]);
    historyRef.current = [];
    historyIndexRef.current = -1;

    let cancelled = false;

    const loadProjectData = async () => {
      try {
        const projectData = await window.electronAPI.loadProjectData(projectId);
        if (cancelled) return;
        if (projectData.nodes && projectData.nodes.length > 0) {
          // 确保节点数据包含 width、height 和 position，正确恢复所有状态
          const nodesWithSize = projectData.nodes.map((rawNode: Node) => {
            const node: Node =
              rawNode.type === 'panorama360'
                ? (() => {
                    const d = rawNode.data || {};
                    const panoUrl = String((d as any).panoramaUrl || '').trim();
                    const { panoramaUrl: _omit, ...rest } = d as any;
                    return {
                      ...rawNode,
                      type: 'image',
                      data: {
                        ...rest,
                        title: (d as any).title || 'image',
                        outputImage: panoUrl || (d as any).outputImage || '',
                        label: '图片节点',
                        progress: typeof (d as any).progress === 'number' ? (d as any).progress : 0,
                      },
                    };
                  })()
                : rawNode;
            // 根据节点类型设置不同的最小尺寸
            let MIN_WIDTH = IMAGE_NODE_MIN_W;
            let MIN_HEIGHT = IMAGE_NODE_MIN_H;
            
            if (node.type === 'text' || node.type === 'minimalistText' || node.type === 'llm' || node.type === 'audio') {
              MIN_WIDTH = AUDIO_NODE_WIDTH;
              MIN_HEIGHT = AUDIO_NODE_HEIGHT;
            }
            
            // 从 data 或 style 中恢复尺寸
            let width = node.data?.width;
            let height = node.data?.height;
            
            // 如果 data 中没有，尝试从 style 中解析
            if (!width && (node as any).style?.width) {
              width = parseFloat((node as any).style.width.replace('px', ''));
            }
            if (!height && (node as any).style?.height) {
              height = parseFloat((node as any).style.height.replace('px', ''));
            }
            
            // 如果仍然没有尺寸，使用节点类型的默认值
            if (!width) {
              width = node.type === 'text' || node.type === 'minimalistText' || node.type === 'llm' || node.type === 'audio'
                ? AUDIO_NODE_WIDTH
                : MIN_WIDTH;
            }
            if (!height) {
              height = node.type === 'text' || node.type === 'minimalistText' || node.type === 'llm' || node.type === 'audio'
                ? AUDIO_NODE_HEIGHT
                : MIN_HEIGHT;
            }

            // 一次性将旧工程模块放大到 MODULE_DISPLAY_SCALE，避免重复放大
            if (needsModuleSizeScaleUpgrade(node.data as { moduleSizeScaleVersion?: unknown })) {
              width = Number(width) * MODULE_DISPLAY_SCALE;
              height = Number(height) * MODULE_DISPLAY_SCALE;
            }
            
            // 确保不小于最小尺寸
            width = Math.max(MIN_WIDTH, width);
            height = Math.max(MIN_HEIGHT, height);

            let nodeData = { ...(node.data || {}) };
            if (node.type === 'image' && nodeData.model === 'rhart-image-g-1.5') {
              nodeData = { ...nodeData, model: 'banana-2.0' };
            }
            if (node.type === 'image' && isRetiredImageModel(String(nodeData.model || ''))) {
              nodeData = { ...nodeData, model: normalizeImageModelIfRetired(nodeData.model as string) };
            }
            if (node.type === 'audio' && isRetiredAudioModel(String(nodeData.model || ''))) {
              nodeData = { ...nodeData, model: normalizeAudioModelIfRetired(nodeData.model as string) };
            }
            if (isVideoModuleNodeType(node.type) && nodeData.model === 'rhart-video-g') {
              nodeData = {
                ...nodeData,
                model: 'rhart-video-x',
                durationGrok3:
                  (nodeData.durationGrok3 as string) ||
                  (nodeData.durationRhartVideoG === '10s' ? '10' : '6'),
                resolutionGrok3: '720p',
              };
            }
            if (isVideoModuleNodeType(node.type) && (nodeData.model === 'grok-3' || nodeData.model === 'rhart-video-x')) {
              const g3Res = String(nodeData.resolutionGrok3 || '').toLowerCase();
              const patches: Record<string, unknown> = {};
              if (g3Res !== '720p') patches.resolutionGrok3 = '720p';
              const g3Dur =
                nodeData.model === 'rhart-video-x'
                  ? normalizeRhartVideoXDurationStr(nodeData.durationGrok3, '10')
                  : normalizeGrok3DurationStr(nodeData.durationGrok3, '10');
              if (String(nodeData.durationGrok3 || '') !== g3Dur) patches.durationGrok3 = g3Dur;
              if (Object.keys(patches).length > 0) nodeData = { ...nodeData, ...patches };
            }
            if (isVideoModuleNodeType(node.type) && nodeData.model === 'grok-3-stable') {
              const patches: Record<string, unknown> = {};
              if (String(nodeData.resolutionGrok3 || '').toLowerCase() !== '720p') {
                patches.resolutionGrok3 = '720p';
              }
              const g3sDur = normalizeGrok3StableDurationStr(nodeData.durationGrok3, '10');
              if (String(nodeData.durationGrok3 || '') !== g3sDur) patches.durationGrok3 = g3sDur;
              if (Object.keys(patches).length > 0) nodeData = { ...nodeData, ...patches };
            }
            if (
              node.type === 'video' &&
              isRetiredVideoModel(String(nodeData.model || ''))
            ) {
              nodeData = {
                ...nodeData,
                model: normalizeVideoModelIfRetired(nodeData.model as string),
                durationGrok3: (nodeData.durationGrok3 as string) || '10',
                resolutionGrok3: '720p',
              };
            }

            return {
              ...node,
              position: node.position || { x: 0, y: 0 },
              data: {
                ...nodeData,
                width,
                height,
                moduleSizeScaleVersion: MODULE_SIZE_SCALE_VERSION,
              },
              style: {
                ...(node.style || {}),
                width: `${width}px`,
                height: `${height}px`,
                minWidth: `${MIN_WIDTH}px`,
                minHeight: `${MIN_HEIGHT}px`,
              },
            };
          });
          setNodes(nodesWithSize);
          // 尺寸迁移后尽快落盘，避免下次加载重复放大
          const shouldPersistScale = projectData.nodes.some((n: Node) =>
            needsModuleSizeScaleUpgrade(n.data as { moduleSizeScaleVersion?: unknown }),
          );
          if (shouldPersistScale) {
            setTimeout(() => {
              if (cancelled) return;
              hydratedProjectIdRef.current = projectId;
              void saveProjectNow({ nodes: nodesWithSize, edges: projectData.edges || [] });
            }, 500);
          }
          
          // 进入画布时自动归位：节点常在 y 数千坐标，若 fitView 未就绪会看起来像「节点全丢」
          if (nodesWithSize.length > 0) {
            const tryFitView = (attempt = 0) => {
              const api = flowContentApiRef.current;
              if (api?.fitView) {
                api.fitView({ duration: 800, padding: 0.2 });
                return;
              }
              if (attempt < 20) setTimeout(() => tryFitView(attempt + 1), 250);
            };
            setTimeout(() => tryFitView(), 300);
            setTimeout(() => tryFitView(), 1200);
          }
          
          // 延迟恢复连线，确保节点 Handle 已完全渲染
          if (projectData.edges && projectData.edges.length > 0) {
            setTimeout(() => {
              // 确保 edges 中的 sourceHandle 和 targetHandle 与节点 Handle id 一致
              const edgesWithHandles = projectData.edges.map((edge: Edge) => {
                const targetNode = projectData.nodes.find((n: Node) => n.id === edge.target);
                const sourceNode = projectData.nodes.find((n: Node) => n.id === edge.source);
                let targetHandle = edge.targetHandle || 'input';
                if (targetNode && targetNode.type === 'image') {
                  targetHandle = edge.targetHandle ?? (sourceNode?.type === 'image' ? 'image-input' : 'input');
                } else if (targetNode && isVideoModuleNodeType(targetNode.type)) {
                  // Video 统一 input：迁移旧 targetHandle reference-video / video-audio
                  if (targetHandle === 'reference-video' || targetHandle === 'video-audio') {
                    targetHandle = 'input';
                  }
                }
                return {
                  ...edge,
                  sourceHandle: edge.sourceHandle || 'output',
                  targetHandle,
                };
              });
              setEdges(edgesWithHandles);
              setTimeout(() => {
                setNodes((currentNodes) =>
                  currentNodes.map((n) => {
                    if (n.type === 'videoSplice') {
                      const built = buildVideoSpliceClipsFromEdges(
                        n.id,
                        edgesWithHandles,
                        currentNodes,
                        n.data as {
                          videoTracks?: TimelineClip[][];
                          videoClips?: TimelineClip[];
                          audioTracks?: TimelineClip[][];
                        },
                      );
                      const connectedIds = collectSpliceIncomingSourceIds(n.id, edgesWithHandles);
                      const blockDropOnly =
                        spliceRebuildWouldDropConnected(n.data, built, connectedIds) &&
                        !spliceBuiltHasNewConnectedSources(n.data, built);
                      if (blockDropOnly) {
                        return n;
                      }
                      return {
                        ...n,
                        data: {
                          ...n.data,
                          ...applyBuiltClipsToSpliceData(n.data, built, connectedIds),
                        },
                      };
                    }
                    if (n.type === 'photoCollage') {
                      const prevLayers = ((n.data?.layers || []) as CollageLayer[]).slice();
                      const nextLayers = buildPhotoCollageLayersFromEdges(
                        n.id,
                        edgesWithHandles,
                        currentNodes,
                        prevLayers,
                      );
                      return { ...n, data: { ...n.data, layers: nextLayers } };
                    }
                    if (n.type === 'gridMap') {
                      const cols = Number(n.data?.gridCols) || DEFAULT_GRID_MAP_COLS;
                      const rows = Number(n.data?.gridRows) || DEFAULT_GRID_MAP_ROWS;
                      const prevCells = ((n.data?.cells || []) as GridMapCell[]).slice();
                      const nextCells = buildGridMapCellsFromEdges(
                        n.id,
                        edgesWithHandles,
                        currentNodes,
                        prevCells,
                        cols,
                        rows,
                      );
                      return { ...n, data: { ...n.data, cells: nextCells } };
                    }
                    return n;
                  }),
                );
              }, 150);
            }, 100);
          }
        } else if (projectData.edges && projectData.edges.length > 0) {
          // 如果没有节点但有连线，也延迟加载
          setTimeout(() => {
            const edgesWithHandles = projectData.edges.map((edge: Edge) => {
              const targetNode = projectData.nodes?.find((n: Node) => n.id === edge.target);
              const sourceNode = projectData.nodes?.find((n: Node) => n.id === edge.source);
              let targetHandle = edge.targetHandle || 'input';
              if (targetNode && targetNode.type === 'image') {
                targetHandle = edge.targetHandle ?? (sourceNode?.type === 'image' ? 'image-input' : 'input');
              } else if (targetNode && isVideoModuleNodeType(targetNode.type)) {
                if (targetHandle === 'reference-video' || targetHandle === 'video-audio') {
                  targetHandle = 'input';
                }
              }
              return {
                ...edge,
                sourceHandle: edge.sourceHandle || 'output',
                targetHandle,
              };
            });
            setEdges(edgesWithHandles);
            
            // 初始化历史记录（项目加载完成后）
            setTimeout(() => {
              setNodes((currentNodes) => {
                setEdges((currentEdges) => {
                  const initialSnapshot = {
                    nodes: JSON.parse(JSON.stringify(currentNodes)),
                    edges: JSON.parse(JSON.stringify(currentEdges)),
                    reason: 'general' as const,
                  };
                  historyRef.current = [initialSnapshot];
                  historyIndexRef.current = 0;
                  return currentEdges;
                });
                return currentNodes;
              });
              setTimeout(() => refreshUndoRedoState(), 0);
            }, 200);
          }, 100);
        } else {
          // 如果项目为空，也初始化历史记录
          setTimeout(() => {
            setNodes((currentNodes) => {
              setEdges((currentEdges) => {
                const initialSnapshot = {
                  nodes: JSON.parse(JSON.stringify(currentNodes)),
                  edges: JSON.parse(JSON.stringify(currentEdges)),
                  reason: 'general' as const,
                };
                historyRef.current = [initialSnapshot];
                historyIndexRef.current = 0;
                return currentEdges;
              });
              return currentNodes;
            });
            setTimeout(() => refreshUndoRedoState(), 0);
          }, 200);
        }
      } catch (error) {
        console.error('加载项目数据失败:', error);
      } finally {
        setTimeout(() => {
          if (!cancelled) {
            hydratedProjectIdRef.current = projectId;
          }
        }, 450);
      }
    };

    loadProjectData();
    
    // 加载项目时，确保路径映射已创建
    const ensureMapping = async () => {
      if (!projectId || !window.electronAPI) return;
      
      try {
        const mappedPath = await window.electronAPI.ensureProjectMapping(projectId);
        if (mappedPath) {
          console.log(`[Workspace] 项目路径映射已确保: ${projectId} -> ${mappedPath}`);
        } else {
          console.warn(`[Workspace] 项目路径映射创建失败: ${projectId}`);
        }
      } catch (error) {
        console.error(`[Workspace] 确保项目路径映射失败: ${projectId}`, error);
      }
    };
    
    ensureMapping();

    return () => {
      cancelled = true;
    };
  }, [projectId, setNodes, setEdges, refreshUndoRedoState, projectReloadNonce, saveProjectNow]);

  // 离开画布前强制落盘一次；但若已通过 handleNavigateBack 保存，则跳过（避免 setNodes([]) 后 ref 已空，用空数据覆盖）
  useEffect(() => {
    return () => {
      if (isExitingRef.current) return;
      saveProjectNow().catch((error) => {
        console.error('离开画布时保存项目失败:', error);
      });
    };
  }, [saveProjectNow]);

  // Text / minimalistText 节点数据落盘（Workspace 受控 nodes；并同步下游 LLM / Image）
  const handleTextNodeDataChange = useCallback((nodeId: string, updates: Record<string, unknown>) => {
    setNodes((nds) => {
      const updatedNodes = nds.map((node) => {
        if (node.id !== nodeId) return node;
        const next: Node = {
          ...node,
          data: {
            ...node.data,
            ...updates,
          },
        };
        if (updates.width !== undefined || updates.height !== undefined) {
          const w =
            updates.width !== undefined
              ? Number(updates.width)
              : Number(node.data?.width) || 280;
          const h =
            updates.height !== undefined
              ? Number(updates.height)
              : Number(node.data?.height) || 160;
          next.style = {
            ...(node.style || {}),
            width: `${w}px`,
            height: `${h}px`,
            minWidth: '280px',
            minHeight: '160px',
          };
        }
        return next;
      });

      if (updates.text !== undefined) {
        const textVal = String(updates.text ?? '');
        const currentEdges = latestEdgesRef.current;
        const currentSelected = selectedNodeRef.current;
        const connectedEdges = currentEdges.filter((e: Edge) => e.source === nodeId && e.target);
        connectedEdges.forEach((edge: Edge) => {
          const targetNode = updatedNodes.find((n) => n.id === edge.target);
          if (targetNode?.type === 'llm') {
            const targetIndex = updatedNodes.findIndex((n) => n.id === edge.target);
            if (targetIndex !== -1) {
              updatedNodes[targetIndex] = {
                ...updatedNodes[targetIndex],
                data: {
                  ...updatedNodes[targetIndex].data,
                  inputText: textVal,
                },
              };
              if (currentSelected?.id === edge.target) {
                setLlmInputPanelData((prev) =>
                  prev && prev.nodeId === edge.target ? { ...prev, inputText: textVal } : prev,
                );
              }
            }
          } else if (targetNode?.type === 'image') {
            const targetIndex = updatedNodes.findIndex((n) => n.id === edge.target);
            if (targetIndex !== -1) {
              updatedNodes[targetIndex] = {
                ...updatedNodes[targetIndex],
                data: {
                  ...updatedNodes[targetIndex].data,
                  prompt: textVal,
                },
              };
              if (currentSelected?.id === edge.target) {
                setImageInputPanelData((prev) => {
                  if (prev && prev.nodeId === edge.target) {
                    return { ...prev, prompt: textVal };
                  }
                  return prev;
                });
              }
            }
          }
        });
      }

      return updatedNodes;
    });
  }, [setNodes, setImageInputPanelData, setLlmInputPanelData]);

  const handleLlmNodeDataChange = useCallback((nodeId: string, updates: Record<string, unknown>) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id !== nodeId) return node;
        const next: Node = {
          ...node,
          data: {
            ...node.data,
            ...updates,
          },
        };
        if (updates.width !== undefined || updates.height !== undefined) {
          const w =
            updates.width !== undefined
              ? Number(updates.width)
              : Number(node.data?.width) || 280;
          const h =
            updates.height !== undefined
              ? Number(updates.height)
              : Number(node.data?.height) || 160;
          next.style = {
            ...(node.style || {}),
            width: `${w}px`,
            height: `${h}px`,
            minWidth: '280px',
            minHeight: '160px',
          };
        }
        return next;
      }),
    );
  }, [setNodes]);

  const handleTextSplitNodeDataChange = useCallback((nodeId: string, updates: Record<string, unknown>) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id !== nodeId) return node;
        const next: Node = {
          ...node,
          data: {
            ...node.data,
            ...updates,
          },
        };
        if (updates.width !== undefined || updates.height !== undefined) {
          const w =
            updates.width !== undefined
              ? Number(updates.width)
              : Number(node.data?.width) || 240;
          const h =
            updates.height !== undefined
              ? Number(updates.height)
              : Number(node.data?.height) || 200;
          next.style = {
            ...(node.style || {}),
            width: `${w}px`,
            height: `${h}px`,
            minWidth: '200px',
            minHeight: '100px',
          };
        }
        return next;
      }),
    );
  }, [setNodes]);

  const tryReplaceDirectorMvClipFromVideoNodeRef = useRef<
    ((videoNodeId: string, videoUrl: string) => void) | null
  >(null);

  // 用于 VideoNode 更新数据的回调（处理视频输出变化，同步到连接的 Character 节点）
  const handleVideoNodeDataChange = useCallback((nodeId: string, updates: { outputVideo?: string; originalVideoUrl?: string; mediaDurationSec?: number; width?: number; height?: number; title?: string; progress?: number; progressMessage?: string; errorMessage?: string; videoAsset?: { poster?: string; ghost?: string; width?: number; height?: number }; playbackCurrentTimeSec?: number }) => {
    if (updates.playbackCurrentTimeSec !== undefined) {
      recordSetNodesPlaybackCall(nodeId);
    }
    const applyUpdate = () => {
      // 通过对象解构生成新引用，保证 React 能正确检测 state 变更
      setNodes((nds) => {
        let updatedNodes = nds.map((node) => patchVideoNodeData(node, nodeId, updates));

        // 导演隐藏视频节点失败时，把错误写回表内「成片」列
        if (updates.errorMessage) {
          const videoNode = updatedNodes.find((n) => n.id === nodeId);
          const shotNo = String(
            (videoNode?.data as { directorShotNo?: string } | undefined)?.directorShotNo || '',
          ).trim();
          const directorId = String(
            (videoNode?.data as { directorSourceId?: string } | undefined)?.directorSourceId || '',
          ).trim();
          if (shotNo && directorId) {
            updatedNodes = updatedNodes.map((n) => {
              if (n.id !== directorId || n.type !== 'director') return n;
              let nextDir = createDefaultDirectorPipelineState(
                (n.data as { director?: DirectorPipelineState })?.director || {},
              );
              nextDir = updateDirectorShotStoryboard(nextDir, shotNo, {
                videoStatus: 'error',
                videoError: String(updates.errorMessage || ''),
                videoNodeId: nodeId,
              });
              return { ...n, data: { ...n.data, director: nextDir } };
            });
          }
        }

      // 如果 video 节点的 outputVideo 或 originalVideoUrl 更新了，自动更新连接到它的 character 节点
      // 优先使用网络 URL（originalVideoUrl），如果没有则使用 outputVideo（如果是网络 URL）
      // 如果是本地路径，自动上传到 OSS
      if (updates.outputVideo || updates.originalVideoUrl) {
        // 优先使用 originalVideoUrl（网络 URL）
        let videoUrlToPass = '';
        let needsUpload = false;
        let localVideoPath = '';
        
        if (updates.originalVideoUrl) {
          videoUrlToPass = updates.originalVideoUrl;
        } else if (updates.outputVideo) {
          const outputVideo = updates.outputVideo;
          // 如果是网络 URL（http/https），直接使用
          if (outputVideo.startsWith('http://') || outputVideo.startsWith('https://')) {
            videoUrlToPass = outputVideo;
          } else if (outputVideo.startsWith('local-resource://') || outputVideo.startsWith('file://')) {
            // 如果是本地路径，需要上传到 OSS
            needsUpload = true;
            localVideoPath = outputVideo;
            console.log('[Workspace] 检测到本地视频路径更新，准备上传到 OSS:', localVideoPath);
          } else {
            // 如果是本地路径，尝试从节点数据中获取 originalVideoUrl
            const currentNode = updatedNodes.find((n) => n.id === nodeId);
            if (currentNode && currentNode.data?.originalVideoUrl) {
              videoUrlToPass = currentNode.data.originalVideoUrl as string;
            } else {
              // 如果没有网络 URL，使用本地路径（但应该优先使用网络 URL）
              console.warn('[Workspace] Video 节点没有保存网络 URL，使用本地路径:', outputVideo);
              videoUrlToPass = outputVideo;
            }
          }
        }
        const mvReplaceUrl = String(videoUrlToPass || updates.originalVideoUrl || updates.outputVideo || '').trim();
        if (mvReplaceUrl) {
          queueMicrotask(() => {
            tryReplaceDirectorMvClipFromVideoNodeRef.current?.(nodeId, mvReplaceUrl);
          });
        }
        
        // 查找所有从本 video 连到 character 的边（角色仅 input 把手，兼容旧数据 video-input）
        const connectedCharacterNodes = edges
          .filter((edge) => {
            if (edge.source !== nodeId) return false;
            if (edge.targetHandle === 'video-input') return true;
            if (edge.targetHandle === 'input') {
              const targetNode = nodes.find((n) => n.id === edge.target);
              return targetNode?.type === 'character';
            }
            return false;
          })
          .map((edge) => edge.target);
        
        // 如果需要上传，显示"确认上传视频"按钮（不自动上传）
        if (needsUpload && localVideoPath && window.electronAPI && connectedCharacterNodes.length > 0) {
          // 如果当前选中的 character 节点连接到这个 video 节点，显示"确认上传视频"状态
          if (selectedNode && selectedNode.type === 'character' && connectedCharacterNodes.includes(selectedNode.id)) {
            setCharacterInputPanelData((prev) => {
              if (prev && prev.nodeId === selectedNode.id) {
                return {
                  ...prev,
                  videoUrl: localVideoPath, // 显示本地路径（用于提示）
                  needsUpload: true, // 标记需要上传
                  localVideoPath: localVideoPath, // 保存本地路径
                  isUploading: false, // 未开始上传
                };
              }
              return prev;
            });
          }
          
          // 不自动上传，等待用户点击"确认上传视频"按钮
          return updatedNodes;
        }
        
        // 如果需要上传，异步执行上传操作（已废弃，改为手动确认上传）
        if (false && needsUpload && localVideoPath && window.electronAPI && connectedCharacterNodes.length > 0) {
          // 创建上传 Promise（使用 upload-video-to-oss IPC）
          const uploadPromise = window.electronAPI.uploadVideoToOSS(localVideoPath);
          const selNode = selectedNode;
          // 如果当前选中的 character 节点连接到这个 video 节点，显示上传状态（不填入本地路径），并保存 uploadPromise
          if (selNode && selNode.type === 'character' && connectedCharacterNodes.includes(selNode.id)) {
            setCharacterInputPanelData((prev) => {
              if (prev && prev.nodeId === selNode.id) {
                return {
                  ...prev,
                  videoUrl: '', // 不填入本地路径，留空
                  isUploading: true, // 显示上传状态
                  uploadPromise: uploadPromise, // 保存上传 Promise
                };
              }
              return prev;
            });
          }
          
          // 异步上传到 OSS
          uploadPromise
            .then((result) => {
              if (result.success && result.url) {
                console.log('[Workspace] 视频上传到 OSS 成功，OSS URL:', result.url);
                // 更新所有连接的 character 节点
                setNodes((nds) => {
                  return nds.map((node) => {
                    if (connectedCharacterNodes.includes(node.id) && node.type === 'character') {
                      return {
                        ...node,
                        data: {
                          ...node.data,
                          videoUrl: result.url!, // 使用 OSS URL
                        },
                      };
                    }
                    return node;
                  });
                });
                
                // 更新输入面板数据
                if (selectedNode && selectedNode.type === 'character' && connectedCharacterNodes.includes(selectedNode.id)) {
                  setCharacterInputPanelData((prev) => {
                    if (prev && prev.nodeId === selectedNode.id) {
                      return {
                        ...prev,
                        videoUrl: result.url!, // 使用 OSS URL
                        isUploading: false, // 清除上传状态
                        uploadPromise: undefined, // 清除 uploadPromise
                      };
                    }
                    return prev;
                  });
                }
              } else {
                console.error('[Workspace] 视频上传到 OSS 失败:', result.error);
                // 上传失败，清除上传状态
                if (selectedNode && selectedNode.type === 'character' && connectedCharacterNodes.includes(selectedNode.id)) {
                  setCharacterInputPanelData((prev) => {
                    if (prev && prev.nodeId === selectedNode.id) {
                      return {
                        ...prev,
                        videoUrl: '', // 上传失败，清空URL
                        isUploading: false,
                        uploadPromise: undefined, // 清除 uploadPromise
                      };
                    }
                    return prev;
                  });
                }
              }
            })
            .catch((error) => {
              console.error('[Workspace] 视频上传到 OSS 时出错:', error);
              // 上传失败，清除上传状态
              if (selectedNode && selectedNode.type === 'character' && connectedCharacterNodes.includes(selectedNode.id)) {
                setCharacterInputPanelData((prev) => {
                  if (prev && prev.nodeId === selectedNode.id) {
                    return {
                      ...prev,
                      videoUrl: '', // 上传失败，清空URL
                      isUploading: false,
                      uploadPromise: undefined, // 清除 uploadPromise
                    };
                  }
                  return prev;
                });
              }
            });
          
          // 不更新节点数据，等待上传完成后再更新
          return updatedNodes;
        }
        
        if (videoUrlToPass) {
          // 更新所有连接的 character 节点
          return updatedNodes.map((node) => {
            if (connectedCharacterNodes.includes(node.id) && node.type === 'character') {
              return {
                ...node,
                data: {
                  ...node.data,
                  videoUrl: videoUrlToPass, // 传递网络 URL
                  timestamp: node.data?.timestamp || '1,3', // 如果时间戳为空，设置默认值 "1,3"
                },
              };
            }
            return node;
          });
        }
      }

      return updatedNodes;
    });
    };
    if (updates.outputVideo !== undefined) {
      flushSync(applyUpdate);
    } else {
      applyUpdate();
    }
    // 如果当前选中的是 character 节点，且它连接到这个 video 节点，更新输入面板数据
    // 优先使用网络 URL（originalVideoUrl），如果是本地路径则自动上传
    if ((updates.outputVideo || updates.originalVideoUrl) && selectedNode && selectedNode.type === 'character') {
      const isConnectedToThisVideo = edges.some(
        (edge) =>
          edge.source === nodeId &&
          edge.target === selectedNode.id &&
          (edge.targetHandle === 'video-input' || edge.targetHandle === 'input')
      );
      if (isConnectedToThisVideo) {
        // 优先使用 originalVideoUrl（网络 URL）
        let videoUrlToPass = '';
        let needsUpload = false;
        let localVideoPath = '';
        
        if (updates.originalVideoUrl) {
          videoUrlToPass = updates.originalVideoUrl;
        } else if (updates.outputVideo) {
          const outputVideo = updates.outputVideo;
          // 如果是网络 URL（http/https），直接使用
          if (outputVideo.startsWith('http://') || outputVideo.startsWith('https://')) {
            videoUrlToPass = outputVideo;
          } else if (outputVideo.startsWith('local-resource://') || outputVideo.startsWith('file://')) {
            // 如果是本地路径，需要上传到 OSS
            needsUpload = true;
            localVideoPath = outputVideo;
            console.log('[Workspace] 检测到本地视频路径更新，准备上传到 OSS:', localVideoPath);
          } else {
            // 如果是本地路径，尝试从节点数据中获取 originalVideoUrl
            const currentNode = nodes.find((n) => n.id === nodeId);
            if (currentNode && currentNode.data?.originalVideoUrl) {
              videoUrlToPass = currentNode.data.originalVideoUrl as string;
            } else {
              videoUrlToPass = outputVideo;
            }
          }
        }
        
        // 如果需要上传，显示"确认上传视频"按钮（不自动上传）
        if (needsUpload && localVideoPath && window.electronAPI) {
          // 显示"确认上传视频"状态
          setCharacterInputPanelData((prev) => {
            if (prev && prev.nodeId === selectedNode.id) {
              return {
                ...prev,
                videoUrl: localVideoPath, // 显示本地路径（用于提示）
                isConnected: true,
                needsUpload: true, // 标记需要上传
                localVideoPath: localVideoPath, // 保存本地路径
                isUploading: false, // 未开始上传
                timestamp: prev.timestamp || '1,3',
              };
            }
            return prev;
          });
          
          // 不自动上传，等待用户点击"确认上传视频"按钮
          return;
        }
        
        // 如果需要上传，异步执行上传操作（已废弃，改为手动确认上传）
        if (false && needsUpload && localVideoPath && window.electronAPI) {
          // 创建上传 Promise（使用 upload-video-to-oss IPC）
          const uploadPromise = window.electronAPI.uploadVideoToOSS(localVideoPath);
          
          // 显示上传状态（不填入本地路径），并保存 uploadPromise
          setCharacterInputPanelData((prev) => {
            if (prev && prev.nodeId === selectedNode.id) {
              return {
                ...prev,
                videoUrl: '', // 不填入本地路径，留空
                isConnected: true,
                isUploading: true, // 显示上传状态
                timestamp: prev.timestamp || '1,3',
                uploadPromise: uploadPromise, // 保存上传 Promise
              };
            }
            return prev;
          });
          
          // 异步上传到 OSS
          uploadPromise
            .then((result) => {
              if (result.success && result.url) {
                console.log('[Workspace] 视频上传到 OSS 成功，OSS URL:', result.url);
                // 更新输入面板数据
                setCharacterInputPanelData((prev) => {
                  if (prev && prev.nodeId === selectedNode.id) {
                    return {
                      ...prev,
                      videoUrl: result.url!, // 使用 OSS URL
                      isUploading: false, // 清除上传状态
                      uploadPromise: undefined, // 清除 uploadPromise
                    };
                  }
                  return prev;
                });
              } else {
                console.error('[Workspace] 视频上传到 OSS 失败:', result.error);
                // 上传失败，清除上传状态，不填入任何URL
                setCharacterInputPanelData((prev) => {
                  if (prev && prev.nodeId === selectedNode.id) {
                    return {
                      ...prev,
                      videoUrl: '', // 上传失败，清空URL
                      isUploading: false,
                      uploadPromise: undefined, // 清除 uploadPromise
                    };
                  }
                  return prev;
                });
              }
            })
            .catch((error) => {
              console.error('[Workspace] 视频上传到 OSS 时出错:', error);
              // 上传失败，清除上传状态，不填入任何URL
              setCharacterInputPanelData((prev) => {
                if (prev && prev.nodeId === selectedNode.id) {
                  return {
                    ...prev,
                    videoUrl: '', // 上传失败，清空URL
                    isUploading: false,
                    uploadPromise: undefined, // 清除 uploadPromise
                  };
                }
                return prev;
              });
            });
        } else if (videoUrlToPass) {
          // 如果有网络 URL，直接使用
          setCharacterInputPanelData((prev) => {
            if (prev && prev.nodeId === selectedNode.id) {
              return {
                ...prev,
                videoUrl: videoUrlToPass,
                isConnected: true,
                isUploading: false, // 确保不是上传状态
                timestamp: prev.timestamp || '1,3', // 如果时间戳为空，设置默认值 "1,3"
              };
            }
            return prev;
          });
        }
      }
    }
    if ((updates.outputVideo || updates.originalVideoUrl) && updates.mediaDurationSec === undefined) {
      const videoUrl = updates.outputVideo || updates.originalVideoUrl;
      setTimeout(() => {
        void (async () => {
          const api = window.electronAPI;
          if (!api?.getMediaDuration || !videoUrl) return;
          try {
            const dur = await api.getMediaDuration(videoUrl, projectId || undefined);
            if (dur > 0) {
              handleVideoNodeDataChangeRef.current?.(nodeId, { mediaDurationSec: dur });
            }
          } catch {
            /* ignore */
          }
        })();
      }, 0);
    }
  }, [setNodes, edges, selectedNode, projectId]);

  // 监听任务列表变化，同步失败状态到 VideoNode（需要在 handleVideoNodeDataChange 定义之后）
  useEffect(() => {
    // 查找所有失败的视频任务
    const failedVideoTasks = tasks.filter(
      (task) => task.taskType === 'video' && task.status === 'error' && task.nodeId
    );

    failedVideoTasks.forEach((task) => {
      const target = latestNodesRef.current.find((n) => n.id === task.nodeId);
      // HeyGem：失败改 DarkAlert 弹窗，勿把 errorMessage 写回节点（避免透明双栏透出内联「生成失败」）
      if (target?.type === 'heyGem') {
        setNodes((nds) =>
          nds.map((node) =>
            node.id === task.nodeId
              ? { ...node, data: { ...node.data, progress: 0, errorMessage: undefined } }
              : node,
          ),
        );
        handleVideoNodeDataChange(task.nodeId, { progress: 0, errorMessage: undefined });
        return;
      }
      // 更新对应的 VideoNode：停止进度条并显示错误信息
      setNodes((nds) =>
        nds.map((node) =>
          node.id === task.nodeId
            ? { ...node, data: { ...node.data, progress: 0, errorMessage: task.errorMessage || '视频生成失败' } }
            : node
        )
      );
      handleVideoNodeDataChange(task.nodeId, { progress: 0, errorMessage: task.errorMessage || '视频生成失败' });
    });
  }, [tasks, setNodes, handleVideoNodeDataChange]);

  // 任务列表已成功但画布节点尚无 outputVideo 时回填（HeyGem / WanAnimate 等曾未走全局 SUCCESS 更新）
  useEffect(() => {
    const successVideoTasks = tasks.filter(
      (task) => task.taskType === 'video' && task.status === 'success' && task.videoUrl && task.nodeId,
    );
    if (successVideoTasks.length === 0) return;

    const toSync: Array<{ nodeId: string; url: string; networkUrl?: string }> = [];
    const heyGemToSpawn: Array<{ nodeId: string; url: string; networkUrl?: string }> = [];

    setNodes((nds) => {
      let changed = false;
      const next = nds.map((node) => {
        if (!isVideoModuleNodeType(node.type)) return node;
        const task = successVideoTasks.find((t) => t.nodeId === node.id);
        if (!task?.videoUrl) return node;
        const url = String(task.videoUrl);
        const networkUrl =
          (typeof task.originalVideoUrl === 'string' &&
          (task.originalVideoUrl.startsWith('http://') || task.originalVideoUrl.startsWith('https://'))
            ? task.originalVideoUrl
            : undefined) ||
          (url.startsWith('http://') || url.startsWith('https://') ? url : undefined);

        // HeyGem：成片应 spawn 到右侧视频节点；任务已成功但漏 spawn / loading 未清时在此补救
        if (node.type === 'heyGem') {
          const urlsToMatch = [url, networkUrl].filter(Boolean) as string[];
          const hasSpawnedChild = latestEdgesRef.current
            .filter((e) => e.source === node.id)
            .some((e) => {
              const child =
                nds.find((n) => n.id === e.target) ??
                latestNodesRef.current.find((n) => n.id === e.target);
              if (child?.type !== 'video') return false;
              const childUrls = [
                String(child.data?.outputVideo || '').trim(),
                String(child.data?.originalVideoUrl || '').trim(),
              ].filter(Boolean);
              return childUrls.some((u) => urlsToMatch.includes(u));
            });
          if (!hasSpawnedChild) {
            heyGemToSpawn.push({ nodeId: node.id, url, networkUrl });
          }
          const progressBusy = typeof node.data?.progress === 'number' && node.data.progress > 0;
          const hasErr = !!(node.data?.errorMessage || '').trim();
          if (!progressBusy && !hasErr) return node;
          changed = true;
          return {
            ...node,
            data: {
              ...node.data,
              progress: 0,
              progressMessage: undefined,
              errorMessage: undefined,
            },
          };
        }

        if (node.data?.outputVideo || node.data?.originalVideoUrl) return node;
        changed = true;
        toSync.push({ nodeId: node.id, url, networkUrl });
        return {
          ...node,
          data: {
            ...node.data,
            outputVideo: url,
            ...(networkUrl ? { originalVideoUrl: networkUrl } : {}),
            progress: 0,
            progressMessage: undefined,
            errorMessage: undefined,
          },
        };
      });
      return changed ? next : nds;
    });

    heyGemToSpawn.forEach(({ nodeId, url, networkUrl }) => {
      spawnHeyGemResultVideoNodeRef.current?.({
        sourceNodeId: nodeId,
        outputVideo: url,
        originalVideoUrl: networkUrl,
      });
      handleVideoNodeDataChange(nodeId, {
        progress: 0,
        progressMessage: undefined,
        errorMessage: undefined,
      });
    });

    toSync.forEach(({ nodeId, url, networkUrl }) => {
      handleVideoNodeDataChange(nodeId, {
        outputVideo: url,
        ...(networkUrl ? { originalVideoUrl: networkUrl } : {}),
        progress: 0,
        progressMessage: undefined,
        errorMessage: undefined,
      });
    });
  }, [tasks, setNodes, handleVideoNodeDataChange]);

  // 当 text/LLM 节点内容变化时，同步到下游 Image / TextSplit / LLM（按入边顺序拼接）
  const textSourceContentKey = nodes
    .filter((n) => n.type === 'minimalistText' || n.type === 'text' || n.type === 'llm' || n.type === 'image' || n.type === 'textSplit' || n.type === 'audioTranscribe')
    .map((n) =>
      n.type === 'image'
        ? `${n.id}:${(n.data?.prompt_payload as any)?.qwen_instruction ?? (n.data?.prompt_payload as any)?.prompt_metadata?.formatted_output ?? (n.data?.prompt_payload as any)?.full_camera_prompt ?? (n.data?.prompt_payload as any)?.camera_tags ?? ''}`
        : n.type === 'textSplit'
          ? `${n.id}:${n.data?.inputText ?? ''}:${JSON.stringify(resolveTextSplitSegments(n.data))}`
          : `${n.id}:${(n.data?.text ?? n.data?.outputText ?? '')}`
    )
    .join('|');
  useEffect(() => {
    // 1) 同步到 Image 节点
    const imageIdsWithTextInput = new Set<string>();
    const textSplitIdsWithTextInput = new Set<string>();
    const llmIdsWithTextInput = new Set<string>();
    edges.forEach((e) => {
      const src = nodes.find((n) => n.id === e.source);
      const target = nodes.find((n) => n.id === e.target);
      if (target?.type === 'image' && src && (src.type === 'minimalistText' || src.type === 'text' || src.type === 'llm' || src.type === 'textSplit' || src.type === 'image')) {
        imageIdsWithTextInput.add(e.target);
      }
      if (target?.type === 'textSplit' && src && (src.type === 'minimalistText' || src.type === 'text' || src.type === 'llm' || src.type === 'textSplit')) {
        textSplitIdsWithTextInput.add(e.target);
      }
      if (
        target?.type === 'llm' &&
        src &&
        (src.type === 'minimalistText' ||
          src.type === 'text' ||
          src.type === 'llm' ||
          src.type === 'textSplit' ||
          src.type === 'audioTranscribe')
      ) {
        llmIdsWithTextInput.add(e.target);
      }
    });
    imageIdsWithTextInput.forEach((imageId) => {
      const incoming = edges.filter((e) => {
        if (e.target !== imageId) return false;
        const src = nodes.find((n) => n.id === e.source);
        return src && (src.type === 'minimalistText' || src.type === 'text' || src.type === 'llm' || src.type === 'textSplit' || src.type === 'image');
      });
      const textSourceEdges = incoming.filter((e) => {
        const src = nodes.find((n) => n.id === e.source);
        return src && (src.type === 'minimalistText' || src.type === 'text' || src.type === 'llm' || src.type === 'textSplit' || src.type === 'image');
      });
      const parts: string[] = [];
      for (const e of textSourceEdges) {
        const src = nodes.find((n) => n.id === e.source);
        if (!src) continue;
        if (src.type === 'minimalistText' || src.type === 'text') {
          if (src.data?.text) parts.push(String(src.data.text).trim());
        } else if (src.type === 'llm' && src.data?.outputText) {
          parts.push(String(src.data.outputText).trim());
        } else if (src.type === 'textSplit') {
          const segText = pickTextSplitSegmentText(src.data, 
            e.sourceHandle,
          );
          if (segText) parts.push(segText);
        } else if (src.type === 'image') {
          const pp = src.data?.prompt_payload as { qwen_instruction?: string; prompt_metadata?: { formatted_output?: string }; full_camera_prompt?: string; camera_tags?: string } | undefined;
          const cameraPrompt = pp?.qwen_instruction || pp?.prompt_metadata?.formatted_output || pp?.full_camera_prompt || pp?.camera_tags || '';
          if (cameraPrompt) parts.push(String(cameraPrompt).trim());
        }
      }
      // 连线有输入则优先用连线，否则保留节点已有数据（含复制出的信息）
      const imageNode = nodes.find((n) => n.id === imageId);
      const resolvedPrompt = parts.length > 0 ? parts.join(',') : (imageNode?.data?.prompt || '');
      const fromEdges = collectImageTargetInputImagesFromEdges(imageId, nodes, edges);
      const newInputImages = mergeInputImagesPreserveOrder(
        imageNode?.data?.inputImages as string[] | undefined,
        fromEdges,
      );
      const promptOk = imageNode?.data?.prompt === resolvedPrompt;
      const imgsOk = JSON.stringify(imageNode?.data?.inputImages || []) === JSON.stringify(newInputImages);
      if (promptOk && imgsOk) return;
      setNodes((nds) =>
        nds.map((node) => (node.id === imageId ? { ...node, data: { ...node.data, prompt: resolvedPrompt, inputImages: newInputImages } } : node))
      );
      if (selectedNode?.id === imageId) {
        const skipPanelPromptUpdate = Date.now() - lastImagePromptUserEditRef.current < 2500;
        setImageInputPanelData((prev) => {
          if (!prev || prev.nodeId !== imageId) return prev;
          return {
            ...prev,
            inputImages: newInputImages,
            ...(skipPanelPromptUpdate ? {} : { prompt: resolvedPrompt }),
          };
        });
      }
    });

    // 2) 同步到 TextSplit 节点：上游 text/LLM/TextSplit 更新时刷新 inputText
    const collectTextForTarget = (targetId: string): string[] => {
      const incoming = edges.filter((e) => {
        if (e.target !== targetId) return false;
        const s = nodes.find((n) => n.id === e.source);
        return s && (s.type === 'minimalistText' || s.type === 'text' || s.type === 'llm' || s.type === 'textSplit' || s.type === 'audioTranscribe');
      });
      const parts: string[] = [];
      for (const e of incoming) {
        const src = nodes.find((n) => n.id === e.source);
        if (!src) continue;
        if (src.type === 'minimalistText' || src.type === 'text') {
          if (src.data?.text) parts.push(String(src.data.text).trim());
        } else if (src.type === 'llm' && src.data?.outputText) {
          parts.push(String(src.data.outputText).trim());
        } else if (src.type === 'audioTranscribe' && src.data?.text) {
          parts.push(String(src.data.text).trim());
        } else if (src.type === 'textSplit') {
          const segText = pickTextSplitSegmentText(src.data, 
            e.sourceHandle,
          );
          if (segText) parts.push(segText);
        }
      }
      return parts;
    };
    textSplitIdsWithTextInput.forEach((splitId) => {
      const parts = collectTextForTarget(splitId);
      const resolvedInputText = parts.join('\n');
      const splitNode = nodes.find((n) => n.id === splitId);
      if (splitNode?.data?.inputText === resolvedInputText) return;
      setNodes((nds) =>
        nds.map((node) =>
          node.id === splitId ? { ...node, data: { ...node.data, inputText: resolvedInputText } } : node
        )
      );
    });

    // 3) 同步到 LLM 节点：上游 Text/LLM/拆分 内容变化时刷新 inputText
    llmIdsWithTextInput.forEach((llmId) => {
      const parts = collectTextForTarget(llmId);
      const resolvedInputText = parts.join(',');
      const llmNode = nodes.find((n) => n.id === llmId);
      if (llmNode?.data?.inputText === resolvedInputText) return;
      setNodes((nds) =>
        nds.map((node) =>
          node.id === llmId ? { ...node, data: { ...node.data, inputText: resolvedInputText } } : node
        )
      );
      if (selectedNode?.id === llmId) {
        const incoming = edges.filter((e) => e.target === llmId);
        const hasTextConnection = incoming.some((e) => {
          const src = nodes.find((n) => n.id === e.source);
          return src && (src.type === 'minimalistText' || src.type === 'text');
        });
        const hasLLMConnection = incoming.some((e) => {
          const src = nodes.find((n) => n.id === e.source);
          return src && src.type === 'llm' && src.data?.outputText;
        });
        const hasSplitConnection = incoming.some((e) => {
          const src = nodes.find((n) => n.id === e.source);
          return src && src.type === 'textSplit';
        });
        setLlmInputPanelData((prev) =>
          prev && prev.nodeId === llmId
            ? {
                ...prev,
                inputText: resolvedInputText,
                isInputLocked: false,
                hasLinkedText: (hasTextConnection || hasLLMConnection || hasSplitConnection) && !!resolvedInputText,
                linkedInputText: resolvedInputText,
                linkedTextTitle: collectLinkedTextTitlesForTarget(llmId, nodes, edges),
              }
            : prev
        );
      }
    });
  }, [textSourceContentKey, edges, selectedNode?.id, setNodes]);

  // 文本拆分节点 segments 变化时，同步到下游（文本、LLM、图片、视频、音频等）
  const textSplitSegmentsKey = nodes
    .filter((n) => n.type === 'textSplit')
    .map((n) => `${n.id}:${JSON.stringify(resolveTextSplitSegments(n.data))}`)
    .join('|');
  useEffect(() => {
    const splitNodes = nodes.filter((n) => n.type === 'textSplit' && resolveTextSplitSegments(n.data).length > 0);
    splitNodes.forEach((sourceNode) => {
      const seg = resolveTextSplitSegments(sourceNode.data);
      const outEdges = edges.filter((e) => e.source === sourceNode.id && e.target);
      outEdges.forEach((edge) => {
        const textVal = pickTextSplitSegmentText(seg, edge.sourceHandle);
        if (!textVal) return;
        const targetNode = nodes.find((n) => n.id === edge.target);
        if (!targetNode) return;
        if (targetNode.type === 'minimalistText' || targetNode.type === 'text') {
          setNodes((nds) =>
            nds.map((node) =>
              node.id === edge.target ? { ...node, data: { ...node.data, text: textVal } } : node
            )
          );
        } else if (targetNode.type === 'llm') {
          // 按该 LLM 所有入边顺序拼接文本，与 onConnect/onNodeClick 一致
          const incoming = edges.filter((e) => e.target === edge.target);
          const textSourceEdges = incoming.filter((e) => {
            const src = nodes.find((n) => n.id === e.source);
            return src && (src.type === 'minimalistText' || src.type === 'text' || src.type === 'llm' || src.type === 'textSplit');
          });
          const parts: string[] = [];
          for (const e of textSourceEdges) {
            const src = nodes.find((n) => n.id === e.source);
            if (!src) continue;
            if (src.type === 'minimalistText' || src.type === 'text') {
              if (src.data?.text) parts.push(String(src.data.text).trim());
            } else if (src.type === 'llm' && src.data?.outputText) {
              parts.push(String(src.data.outputText).trim());
            } else if (src.type === 'textSplit') {
              const segText = pickTextSplitSegmentText(src.data, 
                e.sourceHandle,
              );
              if (segText) parts.push(segText);
            }
          }
          const resolvedInputText = parts.join(',');
          setNodes((nds) =>
            nds.map((node) =>
              node.id === edge.target ? { ...node, data: { ...node.data, inputText: resolvedInputText } } : node
            )
          );
          if (selectedNode?.id === edge.target) {
            const incoming = edges.filter((e) => e.target === edge.target);
            const hasTextConnection = incoming.some((e) => {
              const src = nodes.find((n) => n.id === e.source);
              return src && (src.type === 'minimalistText' || src.type === 'text');
            });
            const hasLLMConnection = incoming.some((e) => {
              const src = nodes.find((n) => n.id === e.source);
              return src?.type === 'llm' && !!src.data?.outputText;
            });
            const hasSplitConnection = incoming.some((e) => {
              const src = nodes.find((n) => n.id === e.source);
              return src?.type === 'textSplit';
            });
            setLlmInputPanelData((prev) =>
              prev && prev.nodeId === edge.target
                ? {
                    ...prev,
                    inputText: resolvedInputText,
                    isInputLocked: false,
                    hasLinkedText:
                      (hasTextConnection || hasLLMConnection || hasSplitConnection) && !!resolvedInputText,
                    linkedInputText: resolvedInputText,
                    linkedTextTitle: collectLinkedTextTitlesForTarget(edge.target, nodes, edges),
                  }
                : prev
            );
          }
        } else if (targetNode.type === 'image') {
          const incoming = edges.filter((e) => {
            if (e.target !== edge.target) return false;
            const src = nodes.find((n) => n.id === e.source);
            return src && (src.type === 'minimalistText' || src.type === 'text' || src.type === 'llm' || src.type === 'textSplit');
          });
          const textSourceEdges = incoming.filter((e) => {
            const src = nodes.find((n) => n.id === e.source);
            return src && (src.type === 'minimalistText' || src.type === 'text' || src.type === 'llm' || src.type === 'textSplit');
          });
          const parts: string[] = [];
          for (const e of textSourceEdges) {
            const src = nodes.find((n) => n.id === e.source);
            if (!src) continue;
            if (src.type === 'minimalistText' || src.type === 'text') {
              if (src.data?.text) parts.push(String(src.data.text).trim());
            } else if (src.type === 'llm' && src.data?.outputText) {
              parts.push(String(src.data.outputText).trim());
            } else if (src.type === 'textSplit') {
              const segText = pickTextSplitSegmentText(src.data, 
                e.sourceHandle,
              );
              if (segText) parts.push(segText);
            }
          }
          // 连线有输入则优先用连线，否则保留节点已有数据（含复制出的信息）
          const targetImageNode = nodes.find((n) => n.id === edge.target);
          const resolvedPrompt = parts.length > 0 ? parts.join(',') : (targetImageNode?.data?.prompt || '');
          setNodes((nds) =>
            nds.map((node) =>
              node.id === edge.target ? { ...node, data: { ...node.data, prompt: resolvedPrompt } } : node
            )
          );
          if (selectedNode?.id === edge.target) {
            const skipPanelPromptUpdate = Date.now() - lastImagePromptUserEditRef.current < 2500;
            setImageInputPanelData((prev) => {
              if (!prev || prev.nodeId !== edge.target) return prev;
              return skipPanelPromptUpdate ? prev : { ...prev, prompt: resolvedPrompt };
            });
          }
        } else if (isVideoModuleNodeType(targetNode.type)) {
          setNodes((nds) =>
            nds.map((node) =>
              node.id === edge.target ? { ...node, data: { ...node.data, prompt: textVal } } : node
            )
          );
          if (selectedNode?.id === edge.target) {
            setVideoInputPanelData((prev) => (prev && prev.nodeId === edge.target ? { ...prev, prompt: textVal } : prev));
          }
        } else if (targetNode.type === 'audio') {
          const isRhartSong = isAudioSongModel(targetNode.data?.model);
          const currentLyrics = (targetNode.data?.lyrics ?? '').trim();
          // 仅当歌词为空时从连线同步，否则保留用户在歌词处的编辑
          const shouldSyncLyrics = isRhartSong && !currentLyrics;
          if (isRhartSong && !shouldSyncLyrics) return; // 已有歌词，不覆盖
          setNodes((nds) =>
            nds.map((node) =>
              node.id === edge.target
                ? { ...node, data: { ...node.data, ...(isRhartSong ? { lyrics: textVal } : { text: textVal }) } }
                : node
            )
          );
          if (selectedNode?.id === edge.target) {
            setAudioInputPanelData((prev) => {
              if (prev && prev.nodeId === edge.target) {
                return isRhartSong
                  ? { ...prev, lyrics: textVal, isTextConnected: true }
                  : { ...prev, text: textVal, isTextConnected: true };
              }
              return prev;
            });
          }
        } else if (targetNode.type === 'textSplit') {
          // TextSplit→TextSplit：收集该 target 所有入边的文本/段落后更新 inputText
          const incoming = edges.filter((e) => {
            if (e.target !== edge.target) return false;
            const s = nodes.find((n) => n.id === e.source);
            return s && (s.type === 'minimalistText' || s.type === 'text' || s.type === 'llm' || s.type === 'textSplit');
          });
          const parts: string[] = [];
          for (const e of incoming) {
            const src = nodes.find((n) => n.id === e.source);
            if (!src) continue;
            if (src.type === 'minimalistText' || src.type === 'text') {
              if (src.data?.text) parts.push(String(src.data.text).trim());
            } else if (src.type === 'llm' && src.data?.outputText) {
              parts.push(String(src.data.outputText).trim());
            } else if (src.type === 'textSplit') {
              const segText = pickTextSplitSegmentText(src.data, 
                e.sourceHandle,
              );
              if (segText) parts.push(segText);
            }
          }
          const resolvedInputText = parts.join('\n');
          const splitNode = nodes.find((n) => n.id === edge.target);
          if (splitNode?.data?.inputText === resolvedInputText) return;
          setNodes((nds) =>
            nds.map((node) =>
              node.id === edge.target ? { ...node, data: { ...node.data, inputText: resolvedInputText } } : node
            )
          );
        }
      });
    });
  }, [textSplitSegmentsKey, edges, selectedNode?.id, setNodes, nodes]);

  // 用于 CharacterNode 更新数据的回调
  const handleCharacterNodeDataChange = useCallback((nodeId: string, updates: Record<string, unknown>) => {
    setNodes((nds) => {
      return nds.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                ...updates,
              },
            }
          : node
      );
    });
  }, [setNodes]);

  // 用于 AudioNode 更新数据的回调
  const handleAudioNodeDataChange = useCallback((nodeId: string, updates: { outputAudio?: string; outputAudios?: string[]; originalOutputAudios?: string[]; originalAudioUrl?: string; referenceAudioUrl?: string; sourceSongAudioUrl?: string; coverPitch?: number; coverIndexRate?: number; coverVocalMixPct?: number; coverAccompanimentMixPct?: number; coverRhVolume?: number; coverOutputMode?: RvcCoverOutputMode; outputModelUrl?: string; outputModelRemoteUrl?: string; rvcTrainModelName?: string; rvcCoverModelName?: string; libraryRvcVoiceId?: string; mediaDurationSec?: number; model?: string; width?: number; height?: number; title?: string; errorMessage?: string; aiStatus?: 'idle' | 'START' | 'PROCESSING' | 'SUCCESS' | 'ERROR'; progress?: number }) => {
    const applyUpdate = () => {
      setNodes((nds) => {
        let nextNodes = nds.map((node) => {
          if (node.id !== nodeId) return node;
          const next = { ...node.data, ...updates } as Record<string, unknown>;
          const ref = String(next.referenceAudioUrl ?? '').trim();
          const hasCoverSource = String(next.sourceSongAudioUrl ?? '').trim();
          if (
            updates.referenceAudioUrl !== undefined &&
            ref &&
            !isAudioSongModel(next.model as string | undefined) &&
            !isAudioCoverModel(next.model as string | undefined) &&
            !hasCoverSource
          ) {
            next.model = 'index-tts2';
          }
          // 上传/写入音源后：若标题仍是占位「audio」，用文件名作为曲名
          if (
            updates.title === undefined &&
            (updates.outputAudio !== undefined ||
              updates.originalAudioUrl !== undefined ||
              updates.sourceSongAudioUrl !== undefined)
          ) {
            const resolved = resolveAudioNodeDisplayTitle(next, '');
            if (resolved) next.title = resolved;
          }
          return { ...node, data: next };
        });
        if (updates.mediaDurationSec !== undefined) {
          const patches = buildCoverTargetPatchesAfterSourceDurationChange(
            nodeId,
            nextNodes,
            latestEdgesRef.current as Edge[],
          );
          if (patches.length > 0) {
            const patchByTarget = new Map(patches.map((p) => [p.targetId, p.patch]));
            nextNodes = nextNodes.map((node) => {
              const patch = patchByTarget.get(node.id);
              if (!patch) return node;
              return { ...node, data: { ...node.data, ...patch } };
            });
            queueMicrotask(() => {
              setAudioInputPanelData((prev) => {
                if (!prev) return prev;
                const hit = patches.find((p) => p.targetId === prev.nodeId);
                return hit ? { ...prev, ...hit.patch } : prev;
              });
            });
          }
        }
        return nextNodes;
      });
    };
    if (updates.referenceAudioUrl !== undefined || updates.outputAudio !== undefined) {
      flushSync(applyUpdate);
    } else {
      applyUpdate();
    }
  }, [setNodes]);

  const handleVideoSpliceNodeDataChange = useCallback((nodeId: string, updates: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id !== nodeId) return node;
        const prev = (node.data || {}) as Record<string, unknown>;
        const patch = typeof updates === 'function' ? updates(prev) : updates;
        if (!patch || Object.keys(patch).length === 0) return node;
        return { ...node, data: { ...prev, ...patch } };
      }),
    );
  }, [setNodes]);

  const handlePhotoCollageNodeDataChange = useCallback((nodeId: string, updates: Record<string, unknown>) => {
    setNodes((nds) =>
      nds.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, ...updates } } : node
      )
    );
  }, [setNodes]);

  const handleGridMapNodeDataChange = useCallback((nodeId: string, updates: Record<string, unknown>) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id !== nodeId) return node;
        const nextData = { ...node.data, ...updates };
        const w = Number(updates.width ?? nextData.width);
        const h = Number(updates.height ?? nextData.height);
        if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
          return {
            ...node,
            data: nextData,
            style: { ...(node.style as object), ...nodeStyleDimensions(w, h) },
            width: w,
            height: h,
          };
        }
        return { ...node, data: nextData };
      }),
    );
  }, [setNodes]);

  const handleImageComparerNodeDataChange = useCallback((nodeId: string, updates: Record<string, unknown>) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id !== nodeId) return node;
        const nextData = { ...node.data, ...updates };
        const w = Number(updates.width ?? nextData.width);
        const h = Number(updates.height ?? nextData.height);
        if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
          return {
            ...node,
            data: nextData,
            style: { ...(node.style as object), ...nodeStyleDimensions(w, h) },
            width: w,
            height: h,
          };
        }
        return { ...node, data: nextData };
      }),
    );
  }, [setNodes]);

  /** 拆帧 / 一键拆分等：将图片节点写入 Workspace 画布状态 */
  const handleAddCanvasImageNodes = useCallback(
    (newNodes: Node[]) => {
      if (!newNodes.length) return;
      setNodes((nds) => nds.map((n) => ({ ...n, selected: false })).concat(newNodes));
      setTimeout(() => saveHistory('general'), 0);
    },
    [setNodes, saveHistory],
  );

  /** 视频智能剪辑 / 裁剪导出 / 深度转换：新节点 + 连线（同 id 则覆盖，便于占位→结果回填） */
  const handleAddVideoClipNodes = useCallback(
    (payload: { nodes: Node[]; edges: Edge[] }) => {
      if (!payload.nodes?.length) return;
      const incomingIds = new Set(payload.nodes.map((n) => n.id));
      setNodes((nds) =>
        nds
          .filter((n) => !incomingIds.has(n.id))
          .map((n) => ({ ...n, selected: false }))
          .concat(payload.nodes),
      );
      setEdges((eds) => {
        let next = eds;
        for (const edge of payload.edges || []) {
          next = addEdge(edge, next);
        }
        return next;
      });
      setTimeout(() => saveHistory('general'), 0);
    },
    [setNodes, setEdges, saveHistory],
  );

  /** 多选视频：按从上到下、从左到右拼接为新视频模块，并与各源模块连线 */
  const [videoJoinBusy, setVideoJoinBusy] = useState(false);
  const handleJoinSelectedVideos = useCallback(
    async (nodeIds: string[]) => {
      if (videoJoinBusy) return;
      const ids = [...new Set(nodeIds.filter(Boolean))];
      if (ids.length < 2) return;
      if (!window.electronAPI?.exportTimelineVideoToProject) {
        showAlert(locale === 'en' ? 'Join video is not available' : '视频拼接功能不可用');
        return;
      }

      const allNodes = latestNodesRef.current;
      const selected = sortNodesByReadingOrder(
        allNodes.filter((n) => ids.includes(n.id) && isVideoModuleNodeType(n.type)),
      );
      if (selected.length < 2) {
        showAlert(locale === 'en' ? 'Select at least 2 video modules' : '请至少框选 2 个视频模块');
        return;
      }

      type ClipBuild = {
        node: Node;
        url: string;
        duration: number;
      };
      const builds: ClipBuild[] = [];
      for (const node of selected) {
        const media = resolveTimelineMediaFromSource(node);
        if (!media?.url || media.clipType !== 'video') {
          showAlert(
            locale === 'en'
              ? `Video module "${String(node.data?.title || node.id)}" has no playable file`
              : `视频模块「${String(node.data?.title || node.id)}」没有可播放文件`,
          );
          return;
        }
        let duration = resolveSourceMediaDurationSec(node);
        if (!(duration > 0.05) && window.electronAPI.getMediaDuration) {
          try {
            duration = Number(await window.electronAPI.getMediaDuration(media.url, projectId)) || 0;
          } catch {
            duration = 0;
          }
        }
        if (!(duration > 0.05)) {
          showAlert(
            locale === 'en'
              ? `Cannot read duration for "${String(node.data?.title || node.id)}"`
              : `无法读取「${String(node.data?.title || node.id)}」的时长`,
          );
          return;
        }
        builds.push({ node, url: media.url, duration });
      }

      const GAP = 48;
      let maxRight = -Infinity;
      let minY = Infinity;
      let maxBottom = -Infinity;
      for (const { node } of builds) {
        const w = Number(node.data?.width) || Number((node.style as { width?: number })?.width) || VIDEO_NODE_DEFAULT_W;
        const h = Number(node.data?.height) || Number((node.style as { height?: number })?.height) || VIDEO_NODE_DEFAULT_H;
        maxRight = Math.max(maxRight, node.position.x + w);
        minY = Math.min(minY, node.position.y);
        maxBottom = Math.max(maxBottom, node.position.y + h);
      }
      const placeholderW = VIDEO_NODE_DEFAULT_W;
      const placeholderH = VIDEO_NODE_DEFAULT_H;
      const newNodeId = `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newPosition = {
        x: maxRight + GAP,
        y: minY + Math.max(0, (maxBottom - minY - placeholderH) / 2),
      };

      const placeholderNode: Node = {
        id: newNodeId,
        type: 'video',
        position: newPosition,
        selected: true,
        data: {
          label: locale === 'en' ? 'Joined clip' : '拼接视频',
          title: locale === 'en' ? 'Joined clip' : '拼接视频',
          width: placeholderW,
          height: placeholderH,
          exportedMediaClip: true,
          isUserResized: true,
          preserveExportLayout: true,
          progress: 8,
          progressMessage: locale === 'en' ? 'Joining videos…' : '正在拼接视频…',
          errorMessage: undefined,
        },
        style: nodeStyleDimensions(placeholderW, placeholderH),
      };
      const joinEdges: Edge[] = builds.map(({ node }, i) => ({
        id: `e-join-${node.id}-${newNodeId}-${i}`,
        source: node.id,
        target: newNodeId,
        sourceHandle: 'output',
        targetHandle: 'input',
      }));

      setVideoJoinBusy(true);
      handleAddVideoClipNodes({ nodes: [placeholderNode], edges: joinEdges });

      try {
        let cursor = 0;
        const clips = builds.map((b) => {
          const startTime = cursor;
          cursor += b.duration;
          return {
            type: 'video',
            src: b.url,
            duration: b.duration,
            startTime,
            trimStart: 0,
            trimEnd: b.duration,
            name: String(b.node.data?.title || b.node.id),
          };
        });

        const firstAsset = (builds[0]!.node.data?.videoAsset || {}) as { width?: number; height?: number };
        const outW = Math.max(2, Math.round(Number(firstAsset.width) || 1280));
        const outH = Math.max(2, Math.round(Number(firstAsset.height) || 720));

        const res = await window.electronAPI.exportTimelineVideoToProject(projectId, clips, [[]], {
          videoTrackVolume: 1,
          videoTrackMuted: false,
          outputWidth: outW,
          outputHeight: outH,
        });
        if (!res?.success || !res.originalUrl) {
          throw new Error(res?.error || (locale === 'en' ? 'Join failed' : '拼接失败'));
        }

        const pixelW = Number(res.width) || outW;
        const pixelH = Number(res.height) || outH;
        const adapted =
          computeNodeSizeFromMedia(
            pixelW,
            pixelH,
            VIDEO_NODE_MIN_W,
            VIDEO_NODE_MIN_H,
            VIDEO_NODE_MAX_W,
            VIDEO_NODE_MAX_H,
          ) || { w: placeholderW, h: placeholderH };
        const aspectRatio = snapToVideoPanelAspectRatio(aspectRatioLabelFromPixelSize(pixelW, pixelH));

        handleVideoNodeDataChange(newNodeId, {
          outputVideo: res.originalUrl,
          originalVideoUrl: undefined,
          localPath: res.originalPath,
          width: adapted.w,
          height: adapted.h,
          aspectRatio,
          mediaDurationSec: cursor,
          videoAsset: {
            width: pixelW,
            height: pixelH,
            ...(res.posterUrl ? { poster: res.posterUrl } : {}),
            ...(res.ghostBase64 ? { ghost: res.ghostBase64 } : {}),
          },
          progress: 100,
          progressMessage: '',
          errorMessage: undefined,
        });
        window.setTimeout(() => {
          handleVideoNodeDataChange(newNodeId, { progress: 0, progressMessage: '' });
        }, 420);
        setTimeout(() => saveHistory('general'), 0);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : locale === 'en' ? 'Join failed' : '拼接失败';
        console.error('[Workspace] join selected videos failed:', err);
        showAlert(msg);
        handleVideoNodeDataChange(newNodeId, {
          progress: 0,
          progressMessage: '',
          errorMessage: msg,
        });
      } finally {
        setVideoJoinBusy(false);
      }
    },
    [
      videoJoinBusy,
      projectId,
      locale,
      showAlert,
      handleAddVideoClipNodes,
      handleVideoNodeDataChange,
      saveHistory,
    ],
  );

  /** 多段音频一键分离：新节点 + 连线写入 Workspace（与拆帧/拼图导出同一持久化路径） */
  const handleSeparateAllAudios = useCallback(
    (payload: AudioSeparateAllPayload) => {
      setNodes((nds) => {
        const updated = nds.map((n) => {
          if (n.id !== payload.sourceNodeId) return { ...n, selected: false };
          return {
            ...n,
            data: { ...n.data, ...payload.clearSourceData },
            selected: false,
          };
        });
        return [...updated, ...payload.newNodes];
      });
      setEdges((eds) => {
        let next = eds;
        for (const edge of payload.newEdges) {
          next = addEdge(edge, next);
        }
        return next;
      });
      setTimeout(() => saveHistory('general'), 0);
    },
    [setNodes, setEdges, saveHistory],
  );

  /** 拼图导出为图片节点：放在拼图节点右侧（画布坐标） */
  const handlePhotoCollageExportToCanvas = useCallback(
    async (collageNodeId: string, dataUrl: string, logicalW: number, logicalH: number) => {
      let outputImage = dataUrl;
      let originalImageUrl = dataUrl;
      let localPath = '';
      let tinyThumbUrl = '';
      let avgColorHex = '';
      let ghostBase64 = '';
      let assetWidth: number | undefined = logicalW;
      let assetHeight: number | undefined = logicalH;

      if (window.electronAPI?.createImageLocalResourceFromBuffer && projectId) {
        try {
          const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const resource = await window.electronAPI.createImageLocalResourceFromBuffer(
            projectId,
            `collage-export-${Date.now()}.png`,
            bytes.buffer
          );
          outputImage = resource.previewUrl;
          originalImageUrl = resource.originalUrl;
          localPath = resource.originalPath;
          tinyThumbUrl = resource.tinyUrl || '';
          avgColorHex = resource.avgColorHex || '';
          ghostBase64 = resource.ghostBase64 || '';
          assetWidth = resource.width ?? logicalW;
          assetHeight = resource.height ?? logicalH;
        } catch (err) {
          console.error('[Workspace] 拼图导出到画布保存失败:', err);
        }
      }

      const GAP = 48;
      const baseW = IMAGE_NODE_DEFAULT_W;
      const aspect = logicalW / Math.max(logicalH, 1);
      let nodeW = baseW;
      let nodeH = baseW / aspect;
      const maxH = baseW * 1.6;
      if (nodeH > maxH) {
        nodeH = maxH;
        nodeW = nodeH * aspect;
      }
      if (nodeW < 200) nodeW = 200;
      if (nodeH < 120) nodeH = 120;

      let committedNewNode: Node | null = null;
      const imageUrlForTask = outputImage;

      setNodes((nds) => {
        const collage = nds.find((n) => n.id === collageNodeId);
        if (!collage) return nds;
        const collageOuterW = Number(collage.data?.width) || 560;
        const collageOuterH = Number(collage.data?.height) || 580;
        const newX = collage.position.x + collageOuterW + GAP;
        const newY = collage.position.y + Math.max(0, (collageOuterH - nodeH) / 2);

        const newNode: Node = {
          id: `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: 'image',
          position: { x: newX, y: newY },
          data: {
            label: '拼图导出',
            width: nodeW,
            height: nodeH,
            isUserResized: false,
            title: '拼图导出',
            resolution: '1k',
            aspectRatio: DEFAULT_IMAGE_ASPECT_RATIO,
            model: 'banana-2.0',
            seedreamWidth: 2048,
            seedreamHeight: 2048,
            prompt: '',
            outputImage,
            originalImageUrl,
            localPath,
            tinyThumbUrl,
            avgColorHex,
            imageAsset: {
              preview: outputImage,
              original: originalImageUrl,
              tiny: tinyThumbUrl,
              ghost: ghostBase64,
              avgColorHex,
              width: assetWidth,
              height: assetHeight,
            },
          },
        };
        committedNewNode = newNode;
        return nds.concat(newNode);
      });

      window.setTimeout(() => {
        if (!committedNewNode) return;
        handleAddTaskRef.current?.(
          committedNewNode.id,
          imageUrlForTask,
          '拼图导出',
          undefined,
          undefined,
          committedNewNode,
        );
      }, 0);
    },
    [projectId, setNodes]
  );

  /** 宫格图导出为图片节点：放在宫格节点右侧 */
  const handleGridMapExportToCanvas = useCallback(
    async (
      gridNodeId: string,
      dataUrl: string,
      logicalW: number,
      logicalH: number,
      exportLabel?: string,
    ) => {
      const label = exportLabel || (locale === 'en' ? 'Grid compose' : '宫格合成');
      let outputImage = dataUrl;
      let originalImageUrl = dataUrl;
      let localPath = '';
      let tinyThumbUrl = '';
      let avgColorHex = '';
      let ghostBase64 = '';
      let assetWidth: number | undefined = logicalW;
      let assetHeight: number | undefined = logicalH;

      if (window.electronAPI?.createImageLocalResourceFromBuffer && projectId) {
        try {
          const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const resource = await window.electronAPI.createImageLocalResourceFromBuffer(
            projectId,
            `grid-map-export-${Date.now()}.png`,
            bytes.buffer,
          );
          outputImage = resource.previewUrl;
          originalImageUrl = resource.originalUrl;
          localPath = resource.originalPath;
          tinyThumbUrl = resource.tinyUrl || '';
          avgColorHex = resource.avgColorHex || '';
          ghostBase64 = resource.ghostBase64 || '';
          assetWidth = resource.width ?? logicalW;
          assetHeight = resource.height ?? logicalH;
        } catch (err) {
          console.error('[Workspace] 宫格图导出到画布保存失败:', err);
        }
      }

      const GAP = 48;
      const baseW = IMAGE_NODE_DEFAULT_W;
      const aspect = logicalW / Math.max(logicalH, 1);
      let nodeW = baseW;
      let nodeH = baseW / aspect;
      const maxH = baseW * 1.6;
      if (nodeH > maxH) {
        nodeH = maxH;
        nodeW = nodeH * aspect;
      }
      if (nodeW < 200) nodeW = 200;
      if (nodeH < 120) nodeH = 120;

      let committedNewNode: Node | null = null;
      const imageUrlForTask = outputImage;

      setNodes((nds) => {
        const grid = nds.find((n) => n.id === gridNodeId);
        if (!grid) return nds;
        const outerW = Number(grid.data?.width) || 520;
        const outerH = Number(grid.data?.height) || 520;
        const newX = grid.position.x + outerW + GAP;
        const newY = grid.position.y + Math.max(0, (outerH - nodeH) / 2);

        const newNode: Node = {
          id: `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: 'image',
          position: { x: newX, y: newY },
          selected: true,
          data: {
            label,
            width: nodeW,
            height: nodeH,
            isUserResized: false,
            title: label,
            resolution: '1k',
            aspectRatio: DEFAULT_IMAGE_ASPECT_RATIO,
            model: 'banana-2.0',
            seedreamWidth: 2048,
            seedreamHeight: 2048,
            prompt: '',
            outputImage,
            originalImageUrl,
            localPath,
            tinyThumbUrl,
            avgColorHex,
            imageAsset: {
              preview: outputImage,
              original: originalImageUrl,
              tiny: tinyThumbUrl,
              ghost: ghostBase64,
              avgColorHex,
              width: assetWidth,
              height: assetHeight,
            },
          },
        };
        committedNewNode = newNode;
        return nds.map((n) => ({ ...n, selected: false })).concat(newNode);
      });

      setEdges((eds) =>
        addEdge(
          {
            id: `e-${gridNodeId}-${committedNewNode?.id || Date.now()}`,
            source: gridNodeId,
            target: committedNewNode!.id,
            sourceHandle: 'output',
            targetHandle: 'image-input',
          },
          eds,
        ),
      );

      window.setTimeout(() => {
        if (!committedNewNode) return;
        handleAddTaskRef.current?.(
          committedNewNode.id,
          imageUrlForTask,
          label,
          undefined,
          undefined,
          committedNewNode,
        );
      }, 0);
    },
    [projectId, setNodes, setEdges, locale],
  );

  /** 剪辑导出为视频节点：放在剪辑节点右侧并连线 */
  const handleVideoSpliceExportToCanvas = useCallback(
    async (spliceNodeId: string, payload: VideoSpliceExportPayload) => {
      const spliceNode = latestNodesRef.current.find((n) => n.id === spliceNodeId && n.type === 'videoSplice');
      if (!spliceNode) {
        throw new Error('剪辑节点不存在');
      }
      if (!payload.videoTracks.some((t) => t.length > 0)) {
        throw new Error('没有可导出的视频或图片素材');
      }
      if (!window.electronAPI?.exportTimelineVideoToProject) {
        throw new Error('导出功能不可用');
      }
      const spliceData = (spliceNode.data || {}) as {
        previewAspectId?: string;
        exportOutputWidth?: number;
        exportOutputHeight?: number;
      };
      const exportDims = resolveSpliceExportDimensions({
        previewAspectId: spliceData.previewAspectId ?? payload.previewAspectId,
        exportOutputWidth: spliceData.exportOutputWidth ?? payload.options.outputWidth,
        exportOutputHeight: spliceData.exportOutputHeight ?? payload.options.outputHeight,
      });
      const res = await window.electronAPI.exportTimelineVideoToProject(
        projectId,
        payload.clips,
        payload.audioTracks,
        {
          videoTrackVolume: payload.options.videoTrackVolume[0] ?? 1,
          videoTrackMuted: payload.options.videoTrackMuted[0] ?? false,
          audioTrackVolume: payload.options.audioTrackVolume,
          audioTrackMuted: payload.options.audioTrackMuted,
          outputWidth: exportDims.width,
          outputHeight: exportDims.height,
        },
      );
      if (!res.success || !res.originalUrl) {
        throw new Error(res.error || '导出失败');
      }

      const hasTimelineAudio = payload.audioTracks.some((t) => t.length > 0);
      let exportedAudioUrl: string | undefined;
      if ((res.hasAudio || hasTimelineAudio) && window.electronAPI?.extractAudioFromVideo) {
        try {
          const audioRes = await window.electronAPI.extractAudioFromVideo(projectId, res.originalUrl);
          exportedAudioUrl = audioRes?.audioUrl?.trim() || undefined;
        } catch (err) {
          console.warn('[VideoSpliceExport] 导出后提取音频失败:', err);
        }
      }

      const GAP = 48;
      const aspectRatioStr = exportDims.aspectRatio;
      const exportPixelW = exportDims.width;
      const exportPixelH = exportDims.height;
      const exportNodeSize =
        computeNodeSizeFromMedia(
          exportPixelW,
          exportPixelH,
          IMAGE_NODE_MIN_W,
          IMAGE_NODE_MIN_H,
          IMAGE_NODE_MAX_W,
          IMAGE_NODE_MAX_H,
        ) ??
        imageNodeSizeForAspectRatio(aspectRatioStr) ?? {
          w: IMAGE_NODE_MIN_W,
          h: IMAGE_NODE_MIN_H,
        };
      const nodeW = exportNodeSize.w;
      const nodeH = exportNodeSize.h;
      const videoUrl = res.originalUrl;
      const newNodeId = `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const audioNodeId = exportedAudioUrl
        ? `audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        : '';
      const spliceOuterW = Number(spliceNode.data?.width) || 800;
      const spliceOuterH = Number(spliceNode.data?.height) || 600;
      const newPosition = {
        x: spliceNode.position.x + spliceOuterW + GAP,
        y: spliceNode.position.y + Math.max(0, (spliceOuterH - nodeH) / 2),
      };
      const audioNodeW = 280;
      const audioNodeH = 160;
      const audioPosition = exportedAudioUrl
        ? {
            x: newPosition.x,
            y: newPosition.y + nodeH + GAP,
          }
        : null;

      setNodes((nds) => {
        const newNode: Node = {
          id: newNodeId,
          type: 'video',
          position: newPosition,
          data: {
            label: 'video',
            outputVideo: videoUrl,
            originalVideoUrl: videoUrl,
            localPath: res.originalPath,
            title: '剪辑导出',
            prompt: '',
            width: nodeW,
            height: nodeH,
            aspectRatio: aspectRatioStr,
            preserveExportLayout: true,
            videoAsset: {
              width: exportPixelW,
              height: exportPixelH,
              ...(res.posterUrl ? { poster: res.posterUrl } : {}),
              ...(res.ghostBase64 ? { ghost: res.ghostBase64 } : {}),
            },
            ...(res.posterUrl ? { posterUrl: res.posterUrl } : {}),
            ...(res.ghostBase64 ? { ghostBase64: res.ghostBase64 } : {}),
          },
          style: nodeStyleDimensions(nodeW, nodeH),
          selected: !exportedAudioUrl,
          selectable: true,
        };
        const nodesToAdd: Node[] = [newNode];
        if (exportedAudioUrl && audioNodeId && audioPosition) {
          nodesToAdd.push({
            id: audioNodeId,
            type: 'audio',
            position: audioPosition,
            data: {
              label: 'audio',
              outputAudio: exportedAudioUrl,
              originalAudioUrl: exportedAudioUrl,
              title: '剪辑导出音频',
              width: audioNodeW,
              height: audioNodeH,
              text: '',
              voiceId: 'Wise_Woman',
              speed: 1,
              volume: 1,
              pitch: 0,
              referenceAudioUrl: '',
              aiStatus: 'SUCCESS' as const,
            },
            style: nodeStyleDimensions(audioNodeW, audioNodeH),
            selected: true,
            selectable: true,
          });
        }
        return nds.map((n) => ({ ...n, selected: false })).concat(nodesToAdd);
      });

      setEdges((eds) => {
        let next = addEdge(
          {
            id: `edge-${spliceNodeId}-${newNodeId}`,
            source: spliceNodeId,
            target: newNodeId,
            sourceHandle: 'output',
            targetHandle: 'input',
            animated: false,
            data: { videoSrc: videoUrl },
          },
          eds,
        );
        if (exportedAudioUrl && audioNodeId) {
          next = addEdge(
            {
              id: `edge-${spliceNodeId}-${audioNodeId}`,
              source: spliceNodeId,
              target: audioNodeId,
              sourceHandle: 'output',
              targetHandle: 'input',
              animated: false,
            },
            next,
          );
        }
        return next;
      });

      setTimeout(() => saveHistory('general'), 0);
      return { createdAudioNode: !!exportedAudioUrl };
    },
    [projectId, setNodes, setEdges, saveHistory],
  );

  // 使用 ref 存储回调函数，避免闭包问题
  const handleTextNodeDataChangeRef = useRef<typeof handleTextNodeDataChange | null>(null);
  handleTextNodeDataChangeRef.current = handleTextNodeDataChange;

  const handleLlmNodeDataChangeRef = useRef<typeof handleLlmNodeDataChange | null>(null);
  handleLlmNodeDataChangeRef.current = handleLlmNodeDataChange;

  const handleTextSplitNodeDataChangeRef = useRef<typeof handleTextSplitNodeDataChange | null>(null);
  handleTextSplitNodeDataChangeRef.current = handleTextSplitNodeDataChange;

  const handleImageNodeDataChangeRef = useRef<typeof handleImageNodeDataChange | null>(null);
  const handleVideoNodeDataChangeRef = useRef<typeof handleVideoNodeDataChange | null>(null);
  const handleAudioNodeDataChangeRef = useRef<typeof handleAudioNodeDataChange | null>(null);
  const persistRvcVoiceToLibraryRef = useRef<
    ((params: {
      modelPackageUrl: string;
      modelPackageRemoteUrl?: string;
      outputModelLocalPath?: string;
      rvcTrainModelName?: string;
      trainAudioUrl?: string;
      avatarUrl?: string;
      nodeId?: string;
    }) => Promise<RvcVoiceLibraryItem | null>) | null
  >(null);
  /** 防止同一节点 SUCCESS 被面板回调与全局监听重复入库 */
  const rvcLibraryPersistedRef = useRef(new Set<string>());
  const handleVideoSpliceNodeDataChangeRef = useRef<typeof handleVideoSpliceNodeDataChange | null>(null);
  const handleVideoSpliceExportToCanvasRef = useRef<typeof handleVideoSpliceExportToCanvas | null>(null);
  const handlePhotoCollageNodeDataChangeRef = useRef<typeof handlePhotoCollageNodeDataChange | null>(null);
  const handleGridMapNodeDataChangeRef = useRef<typeof handleGridMapNodeDataChange | null>(null);
  const handleImageComparerNodeDataChangeRef = useRef<typeof handleImageComparerNodeDataChange | null>(null);
  const handleAddTaskRef = useRef<typeof handleAddTask | null>(null);
  const handleAddTextTaskRef = useRef<((nodeId: string, outputText: string, inputPrompt?: string) => void) | null>(null);
  const handleCleanupSplitEdgesRef = useRef<((nodeId: string, keepSourceHandles: string[]) => void) | null>(null);
  const handleAuxImageTaskCompleteRef = useRef<((params: { nodeId: string; type: 'matting' | 'watermark' | 'multi-angle' | 'upscale-v3'; imageUrl: string; imageUrls?: string[] }) => void) | null>(null);
  const handleAIStatusUpdateRef = useRef<(packet: { nodeId: string; status: string; payload?: any }) => void>(() => {});
  /** 用户最近在 Image 提示词输入框编辑的时间戳，用于避免 sync 覆盖导致闪烁 */
  const lastImagePromptUserEditRef = useRef<number>(0);

  const handleImageNodeDataChange = useCallback((nodeId: string, updates: { outputImage?: string; outputImages?: string[]; inputImages?: string[]; localPath?: string; originalImageUrl?: string; tinyThumbUrl?: string; avgColorHex?: string; imageAsset?: { preview?: string; original?: string; tiny?: string; ghost?: string; avgColorHex?: string }; width?: number; height?: number; progress?: number; progressMessage?: string; errorMessage?: string }) => {
    if (
      updates.outputImage !== undefined ||
      updates.originalImageUrl !== undefined ||
      updates.width !== undefined ||
      updates.height !== undefined
    ) {
      setEdges((eds) =>
        eds.map((edge) => {
          if (edge.source !== nodeId) return edge;
          const prev = (edge.data as any)?.imageAsset as DualImageAsset | undefined;
          const nextAsset: DualImageAsset = {
            preview: updates.outputImage ?? prev?.preview ?? '',
            original: updates.originalImageUrl ?? prev?.original ?? (updates.outputImage ?? prev?.preview ?? ''),
            width: updates.width ?? prev?.width,
            height: updates.height ?? prev?.height,
          };
          return { ...edge, data: { ...(edge.data || {}), imageAsset: nextAsset } };
        })
      );
    }
    setNodes((nds) => {
      const updatedNodes = nds.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                ...updates,
              },
            }
          : node
      );

      // 图片节点 outputImage/outputImages 或 inputImages 变化时，同步到下游 Image / 视频剪辑
      if (updates.outputImage !== undefined || updates.outputImages !== undefined || updates.inputImages !== undefined || updates.imageAsset !== undefined) {
        const connectedEdges = edges.filter((e) => e.source === nodeId && e.target);
        connectedEdges.forEach((edge) => {
          const targetNode = updatedNodes.find((n) => n.id === edge.target);
          if (targetNode?.type === 'videoSplice') {
            const targetIndex = updatedNodes.findIndex((n) => n.id === edge.target);
            if (targetIndex !== -1) {
              const built = buildVideoSpliceClipsFromEdges(
                edge.target,
                edges,
                updatedNodes,
                updatedNodes[targetIndex].data as { videoClips?: TimelineClip[]; audioTracks?: TimelineClip[][] },
              );
              const connectedIds = collectSpliceIncomingSourceIds(edge.target, edges);
              const blockDropOnly =
                spliceRebuildWouldDropConnected(updatedNodes[targetIndex].data, built, connectedIds) &&
                !spliceBuiltHasNewConnectedSources(updatedNodes[targetIndex].data, built);
              if (!blockDropOnly) {
                updatedNodes[targetIndex] = {
                  ...updatedNodes[targetIndex],
                  data: {
                    ...updatedNodes[targetIndex].data,
                    ...applyBuiltClipsToSpliceData(updatedNodes[targetIndex].data, built, connectedIds),
                  },
                };
              }
            }
            return;
          }
          if (targetNode?.type === 'photoCollage') {
            const targetIndex = updatedNodes.findIndex((n) => n.id === edge.target);
            if (targetIndex !== -1) {
              const prevLayers = ((updatedNodes[targetIndex].data?.layers || []) as CollageLayer[]).slice();
              const nextLayers = buildPhotoCollageLayersFromEdges(
                edge.target,
                edges,
                updatedNodes,
                prevLayers,
              );
              updatedNodes[targetIndex] = {
                ...updatedNodes[targetIndex],
                data: { ...updatedNodes[targetIndex].data, layers: nextLayers },
              };
            }
            return;
          }
          if (targetNode?.type === 'gridMap') {
            const targetIndex = updatedNodes.findIndex((n) => n.id === edge.target);
            if (targetIndex !== -1) {
              const cols = Number(updatedNodes[targetIndex].data?.gridCols) || DEFAULT_GRID_MAP_COLS;
              const rows = Number(updatedNodes[targetIndex].data?.gridRows) || DEFAULT_GRID_MAP_ROWS;
              const prevCells = ((updatedNodes[targetIndex].data?.cells || []) as GridMapCell[]).slice();
              const nextCells = buildGridMapCellsFromEdges(
                edge.target,
                edges,
                updatedNodes,
                prevCells,
                cols,
                rows,
              );
              updatedNodes[targetIndex] = {
                ...updatedNodes[targetIndex],
                data: { ...updatedNodes[targetIndex].data, cells: nextCells },
              };
            }
            return;
          }
          if (targetNode?.type === 'imageComparer') {
            const targetIndex = updatedNodes.findIndex((n) => n.id === edge.target);
            if (targetIndex !== -1) {
              const urls = buildImageComparerUrlsFromEdges(edge.target, edges, updatedNodes);
              updatedNodes[targetIndex] = {
                ...updatedNodes[targetIndex],
                data: {
                  ...updatedNodes[targetIndex].data,
                  imageAUrl: urls.imageAUrl,
                  imageBUrl: urls.imageBUrl,
                  imageASourceNodeId: urls.imageASourceNodeId,
                  imageBSourceNodeId: urls.imageBSourceNodeId,
                },
              };
            }
            return;
          }
          if (targetNode?.type === 'image') {
            // 更新目标 Image 节点的输入图片列表
            const targetIndex = updatedNodes.findIndex((n) => n.id === edge.target);
            if (targetIndex !== -1) {
              // 从连接的源节点收集所有输入图片
              // 使用 'image-input' 作为 targetHandle ID
              const fromEdges = collectImageTargetInputImagesFromEdges(edge.target, updatedNodes, edges);
              const newInputImages = mergeInputImagesPreserveOrder(
                updatedNodes[targetIndex].data?.inputImages as string[] | undefined,
                fromEdges,
              );

              updatedNodes[targetIndex] = {
                ...updatedNodes[targetIndex],
                data: {
                  ...updatedNodes[targetIndex].data,
                  inputImages: newInputImages,
                },
              };
              
              // 如果当前选中的是这个目标节点，更新输入面板数据
              if (selectedNode && selectedNode.id === edge.target) {
                setImageInputPanelData((prev) => {
                  if (prev && prev.nodeId === edge.target) {
                    return {
                      ...prev,
                      inputImages: newInputImages,
                    };
                  }
                  return prev;
                });
              }
            }
          }
        });
      }

      return updatedNodes;
    });
  }, [setEdges, setNodes, edges, selectedNode]);

  // 任务列表已成功但画布图片节点尚无 outputImage 时回填（批量运行 / SUCCESS 双链路漏更新）
  useEffect(() => {
    const successImageTasks = tasks.filter(
      (task) =>
        task.taskType === 'image' &&
        task.status === 'success' &&
        task.nodeId &&
        (task.imageUrl || task.localFilePath),
    );
    if (successImageTasks.length === 0) return;

    const toSync: Array<{
      nodeId: string;
      url: string;
      networkUrl?: string;
      outputImages?: string[];
    }> = [];

    setNodes((nds) => {
      let changed = false;
      const next = nds.map((node) => {
        if (node.type !== 'image') return node;
        const task = successImageTasks.find((t) => t.nodeId === node.id);
        if (!task) return node;

        const runtime = tasks.find((t) => t.id === `runtime-${node.id}`);
        const runtimeBusy =
          !!runtime && ['running', 'processing'].includes(String(runtime.status || '').toLowerCase());
        const progressBusy = typeof node.data?.progress === 'number' && node.data.progress > 0;
        // 重新生成中：勿用旧 success 任务覆盖节点，避免进度遮罩与旧图交替闪烁
        if (runtimeBusy || progressBusy) return node;

        const rawTaskUrl =
          task.imageUrl ||
          (task.localFilePath
            ? formatImagePathSync(task.localFilePath.replace(/\\/g, '/'))
            : '');
        if (!rawTaskUrl) return node;

        const hasOutput = !!String(node.data?.outputImage || '').trim();
        if (hasOutput) return node;

        changed = true;
        const formattedUrl = formatImagePathSync(rawTaskUrl);
        const outputImages =
          Array.isArray(task.outputImages) && task.outputImages.length > 0
            ? task.outputImages.map((u) => formatImagePathSync(String(u || ''))).filter(Boolean)
            : undefined;
        const networkUrl =
          typeof task.originalImageUrl === 'string' && /^https?:\/\//i.test(task.originalImageUrl.trim())
            ? task.originalImageUrl.trim()
            : formattedUrl.startsWith('http://') || formattedUrl.startsWith('https://')
              ? formattedUrl
              : undefined;
        toSync.push({ nodeId: node.id, url: formattedUrl, networkUrl, outputImages });
        return {
          ...node,
          data: {
            ...node.data,
            outputImage: formattedUrl,
            ...(outputImages && outputImages.length > 0 ? { outputImages } : {}),
            ...(networkUrl ? { originalImageUrl: networkUrl } : {}),
            progress: 0,
            progressMessage: undefined,
            errorMessage: undefined,
          },
        };
      });
      return changed ? next : nds;
    });

    toSync.forEach(({ nodeId, url, networkUrl, outputImages }) => {
      handleImageNodeDataChange(nodeId, {
        outputImage: url,
        ...(outputImages && outputImages.length > 0 ? { outputImages } : {}),
        ...(networkUrl ? { originalImageUrl: networkUrl } : {}),
        progress: 0,
        progressMessage: undefined,
        errorMessage: undefined,
      });
    });
  }, [tasks, setNodes, handleImageNodeDataChange]);

  const characterTransmitKey = useMemo(
    () =>
      nodes
        .filter((n) => n.type === 'character')
        .map((n) => {
          const d = n.data as Record<string, unknown>;
          return `${n.id}:${JSON.stringify(d.referenceTransmitSlots ?? null)}:${JSON.stringify(d.viewImages ?? [])}`;
        })
        .join('|'),
    [nodes]
  );

  /** 角色卡 + 场景图（image 节点）入边变化时，同步下游 Image 的 inputImages */
  const imageReferenceInputsKey = useMemo(() => {
    const parts: string[] = [];
    for (const e of edges) {
      const tgt = nodes.find((n) => n.id === e.target);
      if (tgt?.type !== 'image') continue;
      const src = nodes.find((n) => n.id === e.source);
      if (!src) continue;
      if (src.type === 'character') {
        const sh = e.sourceHandle || '';
        if (sh === CHARACTER_OUTPUT_AUDIO_HANDLE || sh === 'output-audio') continue;
        const d = src.data as Record<string, unknown>;
        parts.push(
          `c:${e.target}<-${e.source}:${JSON.stringify(d.referenceTransmitSlots ?? null)}:${JSON.stringify(d.viewImages ?? [])}`,
        );
      } else if (src.type === 'image') {
        const d = src.data as Record<string, unknown>;
        const url =
          pickPreviewUrl(buildDualImageAssetFromNodeData(d)) ||
          (d.outputImage as string) ||
          (d.originalImageUrl as string) ||
          '';
        parts.push(`i:${e.target}<-${e.source}:${url}`);
      }
    }
    return parts.sort().join('|');
  }, [nodes, edges]);

  useEffect(() => {
    const imageIds = new Set<string>();
    const videoIds = new Set<string>();
    edges.forEach((e) => {
      const tgt = nodes.find((n) => n.id === e.target);
      const src = nodes.find((n) => n.id === e.source);
      if (tgt?.type === 'image') {
        if (src?.type === 'image') {
          imageIds.add(e.target);
          return;
        }
        if (src?.type === 'character') {
          const sh = e.sourceHandle || '';
          if (sh !== CHARACTER_OUTPUT_AUDIO_HANDLE && sh !== 'output-audio') imageIds.add(e.target);
        }
      } else if (tgt && isVideoModuleNodeType(tgt.type)) {
        const th = e.targetHandle || 'input';
        if (th !== 'input' && th !== 'video-input') return;
        if (src?.type === 'image') {
          videoIds.add(e.target);
          return;
        }
        if (src?.type === 'character') {
          const sh = e.sourceHandle || '';
          if (sh !== CHARACTER_OUTPUT_AUDIO_HANDLE && sh !== 'output-audio') videoIds.add(e.target);
        }
      }
    });
    if (imageIds.size === 0 && videoIds.size === 0) return;
    const pendingPanelImages =
      selectedNode?.type === 'image' && imageIds.has(selectedNode.id)
        ? mergeInputImagesPreserveOrder(
            nodes.find((n) => n.id === selectedNode.id)?.data?.inputImages as string[] | undefined,
            collectImageTargetInputImagesFromEdges(selectedNode.id, nodes, edges),
          )
        : null;
    const pendingPanelVideoImages =
      selectedNode && isVideoModuleNodeType(selectedNode.type) && videoIds.has(selectedNode.id)
        ? mergeInputImagesPreserveOrder(
            nodes.find((n) => n.id === selectedNode.id)?.data?.inputImages as string[] | undefined,
            collectVideoTargetInputImagesFromEdges(selectedNode.id, nodes, edges),
          )
        : null;
    setNodes((nds) => {
      let any = false;
      const next = nds.map((node) => {
        if (node.type === 'image' && imageIds.has(node.id)) {
          const fromEdges = collectImageTargetInputImagesFromEdges(node.id, nds, edges);
          const cur = ((node.data?.inputImages as string[]) || []).slice();
          const newImgs = mergeInputImagesPreserveOrder(cur, fromEdges);
          if (JSON.stringify(cur) === JSON.stringify(newImgs)) return node;
          any = true;
          return { ...node, data: { ...node.data, inputImages: newImgs } };
        }
        if (isVideoModuleNodeType(node.type) && videoIds.has(node.id)) {
          const fromEdges = collectVideoTargetInputImagesFromEdges(node.id, nds, edges);
          const cur = ((node.data?.inputImages as string[]) || []).slice();
          const newImgs = mergeInputImagesPreserveOrder(cur, fromEdges);
          if (JSON.stringify(cur) === JSON.stringify(newImgs)) return node;
          any = true;
          return { ...node, data: { ...node.data, inputImages: newImgs } };
        }
        return node;
      });
      return any ? next : nds;
    });
    if (pendingPanelImages) {
      setImageInputPanelData((prev) =>
        prev?.nodeId === selectedNode!.id ? { ...prev, inputImages: pendingPanelImages } : prev,
      );
    }
    if (pendingPanelVideoImages) {
      setVideoInputPanelData((prev) =>
        prev?.nodeId === selectedNode!.id ? { ...prev, inputImages: pendingPanelVideoImages } : prev,
      );
    }
  }, [imageReferenceInputsKey, characterTransmitKey, edges, nodes, setNodes, selectedNode?.id, selectedNode?.type]);


  // TextNode 包装器（用于 React Flow）- 移到组件内部以访问 setNodes
  const TextNodeWrapper = useCallback<React.FC<{
    id: string;
    data: any;
    selected: boolean;
    position: { x: number; y: number };
  }>>(({ id, data, selected, position }) => {
    const { isDarkMode, performanceMode } = useCanvasTheme();
    const handleLinkStart = useCallback((nodeId: string, startPos: { x: number; y: number }) => {
      // 这里可以触发连接开始逻辑
      console.log('Link start from node:', nodeId, 'at position:', startPos);
    }, []);

    const handleTextChange = useCallback((nodeId: string, text: string) => {
      handleTextNodeDataChange(nodeId, { text });
    }, [handleTextNodeDataChange]);

    const handleSizeChange = useCallback((nodeId: string, size: { w: number; h: number }) => {
      handleTextNodeDataChange(nodeId, { width: size.w, height: size.h });
    }, [handleTextNodeDataChange]);

    return (
      <>
        <TextNode
          id={id}
          initialPos={position}
          onLinkStart={handleLinkStart}
          isSelected={selected}
          isDarkMode={isDarkMode}
          performanceMode={isPerformanceMode}
          data={data}
          onTextChange={handleTextChange}
          onSizeChange={handleSizeChange}
        />
        {/* React Flow Handle for connections */}
        <Handle type="source" position={Position.Right} id="output" className="!w-2 !h-2 !bg-green-500 !border-0" />
      </>
    );
  }, [handleTextNodeDataChange]);

  const handleCleanupSplitEdges = useCallback((nodeId: string, keepSourceHandles: string[]) => {
    setEdges((eds) =>
      eds.filter(
        (e) => e.source !== nodeId || (e.sourceHandle != null && keepSourceHandles.includes(e.sourceHandle))
      )
    );
  }, [setEdges]);

  // 图片生成完成时，创建任务记录并自动保存到本地（需在 nodeTypes 之前定义，供 handleAuxImageTaskComplete 使用）
  const handleAddTask = useCallback(
    (
      nodeId: string,
      imageUrl: string,
      prompt: string,
      payloadOriginalImageUrl?: string,
      outputImages?: string[],
      /** 新节点已写入画布但 React 尚未提交时，用此快照参与任务元数据（如拼图导出新建图片节点） */
      taskSourceNode?: Node,
    ) => {
    setTasks((prevTasks) => {
      const node = taskSourceNode ?? nodes.find((n) => n.id === nodeId);
      if (!node) return prevTasks;

      const remoteForDedup =
        (payloadOriginalImageUrl && /^https?:\/\//i.test(payloadOriginalImageUrl.trim())
          ? payloadOriginalImageUrl.trim()
          : undefined) || (/^https?:\/\//i.test(imageUrl) ? imageUrl : undefined);

      const withoutDupes = prevTasks.filter((t) => {
        if (t.id === `runtime-${nodeId}`) return false;
        if (t.nodeId !== nodeId || t.taskType !== 'image' || t.status !== 'success') return true;
        if (mediaUrlsLikelySameArtifact(t.imageUrl, imageUrl)) return false;
        const tNorm = taskImageDedupNorm(t);
        const inNorm = normalizeMediaUrlForTaskDedup(remoteForDedup || imageUrl);
        if (tNorm && inNorm && tNorm === inNorm) return false;
        return true;
      });

      const nodeTitle = node.data?.title || 'image';
      
      const isLocalPath = imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://');
      let localFilePath: string | undefined;
      if (isLocalPath) {
        localFilePath = imageUrl.replace(/^(local-resource:\/\/|file:\/\/\/?)/, '').replace(/\//g, '\\');
        if (localFilePath.match(/^\/[a-zA-Z]:/)) {
          localFilePath = localFilePath.substring(1);
        }
      }
      
      const runtimeTask = prevTasks.find((t) => t.id === `runtime-${nodeId}`);
      const durationSec =
        runtimeTask != null
          ? typeof runtimeTask.durationSec === 'number'
            ? runtimeTask.durationSec
            : Math.max(0, Math.floor((Date.now() - runtimeTask.createdAt) / 1000))
          : undefined;
      const yuanbaoConsumed =
        runtimeTask != null && typeof runtimeTask.yuanbaoConsumed === 'number'
          ? runtimeTask.yuanbaoConsumed
          : estimateYuanbaoForTaskNodeStatic(node, cloudMapRef.current, prompt);
      const newTask: Task = {
        id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        nodeId,
        nodeTitle,
        imageUrl: isLocalPath ? imageUrl : imageUrl,
        ...(Array.isArray(outputImages) && outputImages.length > 0 ? { outputImages } : {}),
        ...(remoteForDedup ? { originalImageUrl: remoteForDedup } : {}),
        localFilePath,
        prompt: prompt || '无提示词',
        createdAt: Date.now(),
        status: 'success',
        taskType: 'image',
        ...(durationSec !== undefined ? { durationSec } : {}),
        ...(yuanbaoConsumed !== undefined ? { yuanbaoConsumed } : {}),
      };

      const isMultiOutput =
        Array.isArray(outputImages) && outputImages.length > 1;

      if (window.electronAPI && imageUrl && !isLocalPath) {
        window.electronAPI.autoSaveImage(imageUrl, nodeTitle, projectId || undefined)
          .then((result) => {
            if (result.success && result.filePath) {
              const localResourceUrl = formatImagePathSync(result.filePath);
              if (isMultiOutput) {
                // 人物多角度等多图：勿用首张本地路径覆盖 outputImages，否则宫格会只剩 1 张
                setTasks((prev) =>
                  prev.map((t) =>
                    t.id === newTask.id
                      ? { ...t, localFilePath: result.filePath }
                      : t
                  )
                );
                return;
              }
              const nextImageAsset = {
                preview: localResourceUrl,
                original: localResourceUrl,
              };
              setNodes((nds) =>
                nds.map((n) =>
                  n.id === nodeId
                    ? {
                        ...n,
                        data: {
                          ...n.data,
                          outputImage: localResourceUrl,
                          outputImages: [localResourceUrl],
                          originalImageUrl: localResourceUrl,
                          imageAsset: {
                            ...((n.data as any).imageAsset || {}),
                            ...nextImageAsset,
                          },
                        },
                      }
                    : n
                )
              );
              handleImageNodeDataChange(nodeId, {
                outputImage: localResourceUrl,
                outputImages: [localResourceUrl],
                originalImageUrl: localResourceUrl,
                imageAsset: nextImageAsset,
              });
              setTasks((prev) =>
                prev.map((t) =>
                  t.id === newTask.id
                    ? {
                        ...t,
                        localFilePath: result.filePath,
                        imageUrl: localResourceUrl,
                        outputImages: [localResourceUrl],
                      }
                    : t
                )
              );
            }
          })
          .catch((error) => {
            console.error('自动保存图片失败:', error);
          });
      }

      return [newTask, ...withoutDupes];
    });
  }, [nodes, projectId, handleImageNodeDataChange, selectedNode, imageInputPanelData]);

  // 抠图/去水印/超分完成时，将结果加入任务列表（需在 nodeTypes 之前定义，供 ImageNodeWrapper 使用）
  const handleAuxImageTaskComplete = useCallback((params: { nodeId: string; type: 'matting' | 'watermark' | 'multi-angle' | 'upscale-v3'; imageUrl: string; imageUrls?: string[] }) => {
    const promptLabel =
      params.type === 'matting'
        ? '抠图'
        : params.type === 'watermark'
          ? '去水印'
          : params.type === 'upscale-v3'
            ? '超分放大'
            : '人物多角度';
    handleAddTask(params.nodeId, params.imageUrl, promptLabel, undefined, params.imageUrls);
  }, [handleAddTask]);

  // 稳定 invoker：通过 ref 调用最新回调，避免 nodeTypes 因回调引用变化而重建，从而消除各模块闪动
  const invokeTextNodeDataChange = useCallback((nodeId: string, updates: Record<string, unknown>) => {
    handleTextNodeDataChangeRef.current?.(nodeId, updates);
  }, []);

  const invokeLlmNodeDataChange = useCallback((nodeId: string, updates: Record<string, unknown>) => {
    handleLlmNodeDataChangeRef.current?.(nodeId, updates);
  }, []);

  const invokeTextSplitNodeDataChange = useCallback((nodeId: string, updates: Record<string, unknown>) => {
    handleTextSplitNodeDataChangeRef.current?.(nodeId, updates);
  }, []);

  const invokeImageNodeDataChange = useCallback((nodeId: string, updates: any) => {
    handleImageNodeDataChangeRef.current?.(nodeId, updates);
  }, []);
  const invokeVideoNodeDataChange = useCallback((nodeId: string, updates: any) => {
    handleVideoNodeDataChangeRef.current?.(nodeId, updates);
  }, []);
  const invokeAudioNodeDataChange = useCallback((nodeId: string, updates: any) => {
    handleAudioNodeDataChangeRef.current?.(nodeId, updates);
  }, []);
  const invokeSeparateAllAudios = useCallback((payload: AudioSeparateAllPayload) => {
    handleSeparateAllAudios(payload);
  }, [handleSeparateAllAudios]);
  const invokeCharacterNodeDataChange = useCallback((nodeId: string, updates: Record<string, unknown>) => {
    handleCharacterNodeDataChange(nodeId, updates);
  }, [handleCharacterNodeDataChange]);
  const invokeVideoSpliceNodeDataChange = useCallback((nodeId: string, updates: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => {
    handleVideoSpliceNodeDataChangeRef.current?.(nodeId, updates);
  }, []);
  const invokeVideoSpliceExportToCanvas = useCallback(
    (nodeId: string, payload: VideoSpliceExportPayload) => {
      const fn = handleVideoSpliceExportToCanvasRef.current;
      if (!fn) return Promise.reject(new Error('导出功能不可用'));
      return fn(nodeId, payload);
    },
    [],
  );

  const invokeImageTo3dNodeDataChange = useCallback((nodeId: string, updates: Record<string, unknown>) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...updates } } : n)),
    );
  }, []);

  const invokeStoryboardScriptNodeDataChange = useCallback((nodeId: string, updates: Record<string, unknown>) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...updates } } : n)),
    );
    setStoryboardScriptInputPanelData((prev) => {
      if (!prev || prev.nodeId !== nodeId) return prev;
      const next = { ...prev };
      if ('userPrompt' in updates) next.userPrompt = String(updates.userPrompt ?? '');
      if ('chatModel' in updates) next.chatModel = updates.chatModel as string | undefined;
      if ('storyboardScript' in updates) {
        next.storyboardScript = updates.storyboardScript as StoryboardScriptState;
      }
      return next;
    });
  }, []);

  const invokeScriptNodeDataChange = useCallback((nodeId: string, updates: Record<string, unknown>) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...updates } } : n)),
    );
  }, []);

  /** 将音频节点输出灌入导演 mvMusic（函数式合并，可重复调用） */
  const applyDirectorMvMusicFromAudio = useCallback(
    (
      directorNodeId: string,
      music: { url: string; title: string; durationSec: number; sourceNodeId: string },
    ) => {
      const url = String(music.url || '').trim();
      if (!url || !directorNodeId) return;
      setNodes((curr) =>
        curr.map((node) => {
          if (node.id !== directorNodeId || node.type !== 'director') return node;
          const prev = createDefaultDirectorPipelineState(
            (node.data as { director?: DirectorPipelineState })?.director || {},
          );
          const durationSec =
            music.durationSec > 0
              ? music.durationSec
              : prev.mvMusic.durationSec > 0
                ? prev.mvMusic.durationSec
                : 0;
          const next = createDefaultDirectorPipelineState({
            ...prev,
            mode: 'mv',
            phase: prev.mode === 'mv' ? prev.phase : 'music',
            mvMusic: {
              ...prev.mvMusic,
              url,
              title: music.title || prev.mvMusic.title || 'MV音乐',
              durationSec,
              sourceNodeId: music.sourceNodeId,
              summary:
                prev.mvMusic.summary ||
                (durationSec > 0 ? `时长约 ${Math.round(durationSec)} 秒` : ''),
            },
          });
          const prevUrl = String(prev.mvMusic?.url || '').trim();
          const same =
            prev.mode === 'mv' &&
            prevUrl === url &&
            prev.mvMusic.durationSec === durationSec &&
            String(prev.mvMusic.sourceNodeId || '') === music.sourceNodeId;
          if (same) return node;
          return {
            ...node,
            data: { ...node.data, director: next, title: next.title || node.data?.title },
          };
        }),
      );
    },
    [setNodes],
  );

  const invokeDirectorNodeDataChange = useCallback((nodeId: string, updates: Record<string, unknown>) => {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== nodeId) return n;
        let nextData: Record<string, unknown> = { ...(n.data as Record<string, unknown>), ...updates };
        // 合并 director，避免连线刚写入的 mvMusic 被节点内旧 patch 整包覆盖清掉
        if ('director' in updates && updates.director && typeof updates.director === 'object') {
          const prevDir = createDefaultDirectorPipelineState(
            (n.data as { director?: DirectorPipelineState })?.director || {},
          );
          const incoming = createDefaultDirectorPipelineState(
            updates.director as DirectorPipelineState,
          );
          const prevUrl = String(prevDir.mvMusic?.url || '').trim();
          const nextUrl = String(incoming.mvMusic?.url || '').trim();
          const mergedMusic =
            nextUrl
              ? incoming.mvMusic
              : prevUrl
                ? prevDir.mvMusic
                : incoming.mvMusic;
          nextData = {
            ...nextData,
            director: createDefaultDirectorPipelineState({
              ...prevDir,
              ...incoming,
              mvMusic: mergedMusic,
              linkedSpliceNodeId:
                String(incoming.linkedSpliceNodeId || '').trim() ||
                String(prevDir.linkedSpliceNodeId || '').trim(),
            }),
          };
        }
        const next: Node = {
          ...n,
          data: nextData,
        };
        if (updates.width !== undefined || updates.height !== undefined) {
          const w =
            updates.width !== undefined
              ? Number(updates.width)
              : Number((n.data as { width?: number })?.width) || 1100;
          const h =
            updates.height !== undefined
              ? Number(updates.height)
              : Number((n.data as { height?: number })?.height) || 640;
          next.style = { ...(n.style as object), ...nodeStyleDimensions(w, h) };
          next.width = w;
          next.height = h;
        }
        return next;
      }),
    );
    setDirectorInputPanelData((prev) => {
      if (!prev || prev.nodeId !== nodeId) return prev;
      const next = { ...prev };
      if ('userPrompt' in updates) next.userPrompt = String(updates.userPrompt ?? '');
      if ('director' in updates) {
        const d = updates.director as DirectorPipelineState;
        next.director = d;
        next.scriptText = String(d?.scriptText ?? next.scriptText ?? '');
        next.chatModel = d?.chatModel ?? next.chatModel;
      }
      return next;
    });
  }, []);

  const invokeSpawnDirectorVideos = useCallback(
    async (nodeId: string, opts?: { shotNos?: string[]; startLipsync?: boolean; lipsyncShotNos?: string[] }) => {
      const allNodes = latestNodesRef.current as Node[];
      const dirNode = allNodes.find((n) => n.id === nodeId);
      if (!dirNode || dirNode.type !== 'director') return;

      const director = createDefaultDirectorPipelineState(
        (dirNode.data as { director?: DirectorPipelineState })?.director || {},
      );
      const onlyShotNos =
        Array.isArray(opts?.shotNos) && opts!.shotNos!.length > 0
          ? new Set(opts!.shotNos!.map((n) => String(n || '').trim()).filter(Boolean))
          : null;
      const shots = (director.shots || []).filter((s, i) => {
        if (!String(s['最终提示词'] || '').trim()) return false;
        if (!onlyShotNos) return true;
        return onlyShotNos.has(String(s['镜号'] || i + 1));
      });
      if (shots.length === 0) return;

      const shotsWithStoryboard = shots.filter((shot) => {
        const rowIdx = (director.shots || []).indexOf(shot);
        const shotNo =
          String(shot['镜号'] || '').trim() || (rowIdx >= 0 ? String(rowIdx + 1) : '');
        if (!shotNo) return false;
        return !!String(director.storyboardsByShotNo?.[shotNo]?.imageUrl || '').trim();
      });
      if (shotsWithStoryboard.length === 0) return;

      const assetRefs = getOrderedAssetsWithImages(director);
      const batchModel = normalizeDirectorVideoBatchModel(director.videoBatchModel);
      const batchLipsyncModel = normalizeDirectorVideoLipsyncModel(director.videoBatchLipsyncModel);
      const batchDuration = normalizeDirectorVideoBatchDuration(batchModel, director.videoBatchDuration);
      const batchAspectRatio = normalizeDirectorVideoBatchAspect(
        batchModel,
        director.videoBatchAspectRatio,
      );
      const layoutAspect = directorVideoBatchLayoutAspect(
        batchModel,
        director.mode === 'mv'
          ? director.mvAspectRatio || batchAspectRatio
          : batchAspectRatio,
      );
      const mvMusicUrl = String(director.mvMusic?.url || '').trim();
      const lyricSegs = director.mvMusic?.lyricSegments || [];
      const lyricPacks =
        lyricSegs.length > 0
          ? packLyricSegmentsIntoShotPacks(lyricSegs, {
              clipLengthMode: director.mvMusic?.clipLengthMode,
            })
          : [];
      const songDurSec = Number(director.mvMusic?.durationSec) || 0;
      /** 仅在导演侧确认后才自动发起对口型；普通模型始终自动生成（结果写回表内） */
      const startLipsync = opts?.startLipsync === true;
      const forceLipsyncNos = new Set(
        (Array.isArray(opts?.lipsyncShotNos) ? opts!.lipsyncShotNos! : [])
          .map((n) => String(n || '').trim())
          .filter(Boolean),
      );

      const GAP = 48;
      const videoSize = videoNodeSizeForAspectRatio(layoutAspect);
      const nodeW = videoSize?.w ?? 420;
      const nodeH = videoSize?.h ?? 236;
      /** 隐藏后台节点：成片在导演表内展示，不再依赖画布外接视频模块 */
      const offscreenBaseX = -12000;
      const offscreenBaseY = -12000;
      const projectIdForTrim =
        String((dirNode.data as { projectId?: string | null })?.projectId || projectId || '').trim() ||
        undefined;

      const newNodes: Node[] = [];
      const autoRunIds: string[] = [];
      const storyboardGeneratingWrites: Array<{
        shotNo: string;
        videoNodeId: string;
        audioStartSec: number;
        audioEndSec: number;
      }> = [];
      const lipsyncTrimErrors: string[] = [];
      const songClipCacheWrites: Array<{
        shotNo: string;
        songClipUrl: string;
        startSec: number;
        endSec: number;
      }> = [];
      const ts = Date.now();

      for (let spawnIndex = 0; spawnIndex < shotsWithStoryboard.length; spawnIndex++) {
        const shot = shotsWithStoryboard[spawnIndex];
        const rowIdx = (director.shots || []).indexOf(shot);
        const shotNo =
          String(shot['镜号'] || '').trim() ||
          (rowIdx >= 0 ? String(rowIdx + 1) : String(spawnIndex + 1));
        const sb = getDirectorShotStoryboard(director, shotNo);
        const musicRange = resolveDirectorShotMusicRange(director.shots || [], shotNo, director);
        const shotDurSec =
          Number(musicRange?.durationSec) > 0
            ? Number(musicRange.durationSec)
            : parseDirectorShotDurationSec(shot['时长'], 0);
        const rangeStartSec = Math.max(0, Number(musicRange?.startSec) || 0);
        const rangeEndRaw = Number(musicRange?.endSec);
        const rangeEndSec =
          Number.isFinite(rangeEndRaw) && rangeEndRaw > rangeStartSec + 0.05
            ? rangeEndRaw
            : rangeStartSec + Math.max(0.5, shotDurSec || 5);
        const hasVoice = shotAudioRangeHasHumanVoice(lyricSegs, rangeStartSec, rangeEndSec);
        const preferLipsync =
          forceLipsyncNos.has(shotNo) ||
          resolveDirectorShotPreferLipsync(shot, sb, {
            hasHumanVoice: hasVoice,
            packText: lyricPacks[rowIdx >= 0 ? rowIdx : spawnIndex]?.text || String(shot['对白旁白'] || ''),
            audioStartSec: rangeStartSec,
            songDurationSec: songDurSec,
            closeUpFramingOn: director.mvCloseUpFraming !== false,
          });
        const shotModel = preferLipsync ? batchLipsyncModel : batchModel;
        const shotResolution = normalizeDirectorVideoBatchResolution(
          shotModel,
          preferLipsync
            ? director.videoBatchLipsyncResolution
            : director.videoBatchResolution,
        );
        const storyboardImageUrl = String(sb?.imageUrl || '').trim();
        // 视频提示词：图生已有分镜，只保留机位/焦距/运镜/主体运动；对口型前置「人物正在面对镜头唱歌」
        const videoMotionPrompt = composeDirectorShotVideoPrompt(shot, {
          lipsync: preferLipsync,
        });
        const durationForShot =
          shotDurSec > 0
            ? pickNearestDirectorVideoBatchDuration(shotModel, shotDurSec)
            : normalizeDirectorVideoBatchDuration(shotModel, batchDuration);
        const aspectForShot =
          director.mode === 'mv'
            ? normalizeDirectorVideoBatchAspect(
                shotModel,
                director.mvAspectRatio || batchAspectRatio,
              )
            : normalizeDirectorVideoBatchAspect(shotModel, batchAspectRatio);

        let prompt = '';
        let inputImages: string[] = [];
        let lipsyncAudioUrl = '';
        let clipStartSec = 0;
        let clipEndSec = 0;
        let clipDurationSec = 0;

        if (isDirectorLipsyncModel(shotModel)) {
          // 对口型：精简动作提示词 + 分镜图 + 本镜歌曲片段
          prompt = ensureDirectorLipsyncMouthVisiblePrompt(videoMotionPrompt);
          if (!prompt.trim()) {
            lipsyncTrimErrors.push(`镜${shotNo}：缺少视频提示词（机位/运镜等）`);
            console.warn(`[Director] 镜${shotNo} 对口型缺少视频提示词，跳过`);
            continue;
          }
          if (!storyboardImageUrl) {
            lipsyncTrimErrors.push(`镜${shotNo}：缺少分镜图`);
            console.warn(`[Director] 镜${shotNo} 对口型缺少分镜图，跳过`);
            continue;
          }
          if (!mvMusicUrl) {
            lipsyncTrimErrors.push(`镜${shotNo}：缺少歌曲，请先接入或上传音乐`);
            console.warn(`[Director] 镜${shotNo} 对口型缺少歌曲，跳过`);
            continue;
          }
          inputImages = [storyboardImageUrl];
          clipStartSec = Math.max(0, Number(musicRange?.startSec) || 0);
          const endSecRaw = Number(musicRange?.endSec);
          clipEndSec =
            Number.isFinite(endSecRaw) && endSecRaw > clipStartSec + 0.05
              ? endSecRaw
              : clipStartSec + Math.max(0.5, shotDurSec || 5);
          const musicDurCap = Math.max(0, Number(director.mvMusic?.durationSec) || 0);
          if (musicDurCap > 0.5) {
            if (clipStartSec >= musicDurCap - 0.05) {
              lipsyncTrimErrors.push(`镜${shotNo}：歌曲片段超出原曲时长`);
              continue;
            }
            clipEndSec = Math.min(clipEndSec, musicDurCap);
          }
          clipDurationSec = Math.max(0.05, clipEndSec - clipStartSec);
          // 优先用确认镜头步已裁好的原曲片段
          lipsyncAudioUrl = getValidDirectorShotSongClipUrl(
            sb,
            mvMusicUrl,
            clipStartSec,
            clipEndSec,
          );
          if (!lipsyncAudioUrl) {
            if (!window.electronAPI?.trimAudio) {
              lipsyncTrimErrors.push(`镜${shotNo}：当前环境不支持裁剪歌曲片段`);
              console.warn(`[Director] 镜${shotNo} 当前环境不支持 trimAudio，跳过`);
              continue;
            }
            try {
              console.log(
                `[Director] 镜${shotNo} 裁剪歌曲片段 ${clipStartSec.toFixed(2)}s–${clipEndSec.toFixed(2)}s (${clipDurationSec.toFixed(2)}s)`,
              );
              const trimmed = await window.electronAPI.trimAudio(
                projectIdForTrim,
                mvMusicUrl,
                clipStartSec,
                clipEndSec,
              );
              lipsyncAudioUrl = String(trimmed?.audioUrl || '').trim();
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err || '裁剪失败');
              lipsyncTrimErrors.push(`镜${shotNo}：${msg}`);
              console.warn(`[Director] 镜${shotNo} lipsync trimAudio failed:`, err);
            }
            if (lipsyncAudioUrl) {
              songClipCacheWrites.push({
                shotNo,
                songClipUrl: lipsyncAudioUrl,
                startSec: clipStartSec,
                endSec: clipEndSec,
              });
            }
          }
          if (!lipsyncAudioUrl) {
            if (!lipsyncTrimErrors.some((e) => e.startsWith(`镜${shotNo}：`))) {
              lipsyncTrimErrors.push(`镜${shotNo}：歌曲片段裁剪失败`);
            }
            console.warn(`[Director] 镜${shotNo} 歌曲片段裁剪失败，跳过对口型生成`);
            continue;
          }
        } else {
          const prepared = prepareDirectorShotVideoPayload({
            rawPrompt: videoMotionPrompt,
            assetRefs,
            model: shotModel,
            storyboardImageUrl,
            fallbackText: videoMotionPrompt,
          });
          prompt = prepared.prompt;
          inputImages = prepared.inputImages;
        }

        const newId = `video-${ts}-${spawnIndex}-${Math.random().toString(36).slice(2, 6)}`;
        const nodeData = buildDirectorSpawnedVideoNodeData({
          model: shotModel,
          duration: durationForShot,
          aspectRatio: aspectForShot,
          resolution: shotResolution,
          prompt,
          inputImages,
          title: `镜${shotNo}`,
          width: nodeW,
          height: nodeH,
          directorShotNo: shotNo,
          directorSourceId: nodeId,
          ...(lipsyncAudioUrl
            ? {
                inputAudioUrl: lipsyncAudioUrl,
                directorAudioClipStartSec: clipStartSec,
                directorAudioClipEndSec: clipEndSec,
                directorAudioClipDurationSec: clipDurationSec,
              }
            : {}),
        });
        if (isDirectorLipsyncModel(shotModel)) {
          (nodeData as Record<string, unknown>).actionPrompt = prompt;
          const writtenAudio = String((nodeData as Record<string, unknown>).inputAudioUrl || '').trim();
          // 硬性：对口型节点必须带上歌曲片段
          if (!writtenAudio) {
            lipsyncTrimErrors.push(`镜${shotNo}：节点未写入歌曲片段，已跳过`);
            console.warn(`[Director] 镜${shotNo} lipsync node missing inputAudioUrl`);
            continue;
          }
          console.log(`[Director] 镜${shotNo} 对口型节点已写入音频`, {
            audio: writtenAudio.length > 80 ? `${writtenAudio.slice(0, 80)}…` : writtenAudio,
            clip: `${clipStartSec.toFixed(2)}–${clipEndSec.toFixed(2)}s`,
            startLipsync,
          });
          if (!(startLipsync || forceLipsyncNos.has(shotNo))) {
            // 对口型需确认后才开跑；未确认则跳过本镜
            continue;
          }
        }
        newNodes.push({
          id: newId,
          type: 'video',
          hidden: true,
          position: { x: offscreenBaseX, y: offscreenBaseY + spawnIndex * (nodeH + GAP) },
          data: nodeData,
          style: { opacity: 0, pointerEvents: 'none', width: 1, height: 1 },
        });
        storyboardGeneratingWrites.push({
          shotNo,
          videoNodeId: newId,
          // 生视频瞬间冻结本镜歌曲区间，入轨时优先读分镜绑定而非重算 packs
          audioStartSec: rangeStartSec,
          audioEndSec: rangeEndSec,
        });
        autoRunIds.push(newId);
      }

      if (lipsyncTrimErrors.length > 0 || songClipCacheWrites.length > 0 || storyboardGeneratingWrites.length > 0) {
        const summary =
          lipsyncTrimErrors.length === 0
            ? ''
            : lipsyncTrimErrors.length === 1
              ? lipsyncTrimErrors[0]
              : `对口型歌曲片段处理失败 ${lipsyncTrimErrors.length} 镜：\n${lipsyncTrimErrors.slice(0, 5).join('\n')}${
                  lipsyncTrimErrors.length > 5 ? '\n…' : ''
                }`;
        if (summary) showAlert(summary);
        setNodes((nds) =>
          nds.map((n) => {
            if (n.id !== nodeId) return n;
            let nextDir = createDefaultDirectorPipelineState(
              (n.data as { director?: DirectorPipelineState })?.director || {},
            );
            for (const w of songClipCacheWrites) {
              nextDir = updateDirectorShotStoryboard(nextDir, w.shotNo, {
                songClipUrl: w.songClipUrl,
                songClipSourceUrl: mvMusicUrl,
                songClipStartSec: w.startSec,
                songClipEndSec: w.endSec,
              });
            }
            for (const w of storyboardGeneratingWrites) {
              nextDir = updateDirectorShotStoryboard(nextDir, w.shotNo, {
                videoStatus: 'generating',
                videoNodeId: w.videoNodeId,
                videoError: '',
                videoUrl: '',
                audioStartSec: w.audioStartSec,
                audioEndSec: w.audioEndSec,
              });
            }
            if (summary) {
              nextDir = createDefaultDirectorPipelineState({ ...nextDir, error: summary });
            }
            return {
              ...n,
              data: {
                ...n.data,
                director: nextDir,
              },
            };
          }),
        );
      }

      if (newNodes.length === 0) return;

      // 同镜号旧隐藏节点清理，避免画布堆积
      const replaceShotNos = new Set(storyboardGeneratingWrites.map((w) => w.shotNo));
      setNodes((nds) => [
        ...nds.filter((n) => {
          if (n.type !== 'video') return true;
          const d = n.data as { directorSourceId?: string; directorShotNo?: string };
          if (String(d?.directorSourceId || '').trim() !== nodeId) return true;
          const sn = String(d?.directorShotNo || '').trim();
          return !sn || !replaceShotNos.has(sn);
        }),
        ...newNodes,
      ]);

      // 表内自动生成：普通模型始终开跑；对口型仅确认后开跑
      if (autoRunIds.length > 0 && window.electronAPI?.invokeAI) {
        for (let i = 0; i < autoRunIds.length; i++) {
          const vid = autoRunIds[i];
          const n = newNodes.find((x) => x.id === vid);
          if (!n) continue;
          const d = n.data as Record<string, unknown>;
          const input = buildDirectorSpawnedVideoInvokeInput(d, { projectId: projectIdForTrim });
          if (!input) {
            console.warn(`[Director] 节点 ${vid} 缺少生成参数，跳过自动生成`);
            continue;
          }
          setNodes((nds) =>
            nds.map((node) =>
              node.id === vid
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      progress: 1,
                      progressMessage: isDirectorLipsyncModel(String(d.model || ''))
                        ? '正在初始化对口型…'
                        : '正在初始化…',
                      errorMessage: undefined,
                    },
                  }
                : node,
            ),
          );
          const delay = 50 * i;
          window.setTimeout(() => {
            void window.electronAPI
              ?.invokeAI({
                modelId: 'video',
                nodeId: vid,
                input,
              })
              .catch((err: unknown) => {
                console.error(`[Director] 自动生成失败 ${vid}:`, err);
                const msg = err instanceof Error ? err.message : '视频生成失败';
                setNodes((nds) =>
                  nds.map((node) => {
                    if (node.id === vid) {
                      return {
                        ...node,
                        data: {
                          ...node.data,
                          progress: 0,
                          errorMessage: msg,
                        },
                      };
                    }
                    if (node.id !== nodeId || node.type !== 'director') return node;
                    const shotNo = String(d.directorShotNo || '').trim();
                    if (!shotNo) return node;
                    let nextDir = createDefaultDirectorPipelineState(
                      (node.data as { director?: DirectorPipelineState })?.director || {},
                    );
                    nextDir = updateDirectorShotStoryboard(nextDir, shotNo, {
                      videoStatus: 'error',
                      videoError: msg,
                      videoNodeId: vid,
                    });
                    return { ...node, data: { ...node.data, director: nextDir } };
                  }),
                );
              });
          }, delay);
        }
      }
    },
    [projectId, setNodes, showAlert],
  );

  /** MV：分镜图 + 音乐一键写入 VideoSplice 图片轨/音轨 */
  const invokeDirectorPreviewToSplice = useCallback(
    (nodeId: string) => {
      const allNodes = latestNodesRef.current as Node[];
      const dirNode = allNodes.find((n) => n.id === nodeId);
      if (!dirNode || dirNode.type !== 'director') return;

      const director = createDefaultDirectorPipelineState(
        (dirNode.data as { director?: DirectorPipelineState })?.director || {},
      );
      const built = buildDirectorMvImagePreviewClips(director);
      if (built.videoClips.length === 0) return;

      const videoClips = built.videoClips as TimelineClip[];
      const audioClips = built.audioClips as TimelineClip[];
      const linkedId = String(director.linkedSpliceNodeId || '').trim();
      const existing = linkedId
        ? allNodes.find((n) => n.id === linkedId && n.type === 'videoSplice')
        : undefined;

      const dirW = Number(dirNode.data?.width) || 1100;
      const GAP = 48;
      const spliceW = 800;
      const spliceH = 500;
      // 剪辑模块 previewAspectId 用 16-9 形式，导演 mvAspectRatio 用 16:9
      const previewAspectId = String(director.mvAspectRatio || '16:9').replace(':', '-');

      const focusSpliceModule = (spliceId: string) => {
        const fire = () => {
          window.dispatchEvent(
            new CustomEvent('nexflow-canvas-focus-nodes', {
              detail: {
                nodes: [{ id: spliceId, width: spliceW, height: spliceH }],
              },
            }),
          );
        };
        requestAnimationFrame(() => {
          requestAnimationFrame(fire);
        });
        window.setTimeout(fire, 160);
      };

      // 整轨替换（勿 merge 旧轨）：merge 曾把每镜踢到独立轨，造成同时间多轨叠播
      const nextSpliceTracks = {
        ...applyBuiltClipsToSpliceData(undefined, {
          videoTracks: [videoClips],
          videoClips,
          audioTracks: [audioClips],
        }),
        videoTrackLeftSnap: false,
        videoTrackLeftSnapList: [false],
        audioTrackLeftSnap: [false],
        mainTrackMagnet: false,
        trackLeftSnap: false,
        videoTrackMuted: [true],
      };

      if (existing) {
        setNodes((nds) =>
          nds.map((n) => {
            if (n.id === existing.id) {
              return {
                ...n,
                selected: true,
                data: {
                  ...n.data,
                  previewAspectId,
                  ...nextSpliceTracks,
                },
              };
            }
            if (n.id !== nodeId) return { ...n, selected: false };
            const prev = createDefaultDirectorPipelineState(
              (n.data as { director?: DirectorPipelineState })?.director || {},
            );
            // 图+歌预览留在当前步（确认分镜），不跳到剪辑预览
            const next = createDefaultDirectorPipelineState({
              ...prev,
              linkedSpliceNodeId: existing.id,
            });
            return { ...n, selected: false, data: { ...n.data, director: next } };
          }),
        );
        focusSpliceModule(existing.id);
        return;
      }

      const spliceId = `videoSplice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const spliceNode: Node = {
        id: spliceId,
        type: 'videoSplice',
        position: {
          x: dirNode.position.x + dirW + GAP,
          y: dirNode.position.y,
        },
        data: {
          width: spliceW,
          height: spliceH,
          title: 'MV剪辑',
          previewAspectId,
          ...nextSpliceTracks,
        },
      };

      setNodes((nds) =>
        nds
          .map((n) => {
            if (n.id !== nodeId) return { ...n, selected: false };
            const prev = createDefaultDirectorPipelineState(
              (n.data as { director?: DirectorPipelineState })?.director || {},
            );
            const next = createDefaultDirectorPipelineState({
              ...prev,
              linkedSpliceNodeId: spliceId,
            });
            return { ...n, selected: false, data: { ...n.data, director: next } };
          })
          .concat({ ...spliceNode, selected: true }),
      );
      setEdges((eds) => [
        ...eds,
        {
          id: `e-${nodeId}-${spliceId}-mv`,
          source: nodeId,
          target: spliceId,
          sourceHandle: 'output',
          targetHandle: 'input',
        },
      ]);
      focusSpliceModule(spliceId);
    },
    [setNodes, setEdges],
  );

  /** 剪辑预览：把已生成视频 + 原曲一键铺进剪辑轨 */
  const invokeDirectorVideosToSplice = useCallback(
    (nodeId: string) => {
      const allNodes = latestNodesRef.current as Node[];
      const dirNode = allNodes.find((n) => n.id === nodeId);
      if (!dirNode || dirNode.type !== 'director') return;

      const director = createDefaultDirectorPipelineState(
        (dirNode.data as { director?: DirectorPipelineState })?.director || {},
      );
      const shotVideos = allNodes
        .filter(
          (n) =>
            n.type === 'video' &&
            String((n.data as { directorSourceId?: string })?.directorSourceId || '').trim() ===
              nodeId,
        )
        .map((n) => {
          const d = (n.data || {}) as Record<string, unknown>;
          // VideoNode 字段为 outputVideo / originalVideoUrl（不是 outputVideoUrl）
          const media = resolveTimelineMediaFromSource(n);
          const videoUrl = String(
            media?.url ||
              d.outputVideo ||
              d.originalVideoUrl ||
              d.outputVideoUrl ||
              d.videoUrl ||
              '',
          ).trim();
          return {
            shotNo: String(d.directorShotNo || '').trim(),
            videoUrl,
            sourceNodeId: n.id,
          };
        })
        .filter((v) => v.shotNo && v.videoUrl);

      const built = buildDirectorMvVideoPreviewClips(director, shotVideos);
      if (built.videoClips.length === 0) {
        console.warn('[Director] 一键入剪辑轨（视频+歌）失败：未找到已生成视频', {
          directorId: nodeId,
          matchedNodes: shotVideos.length,
          shots: (director.shots || []).length,
        });
        return;
      }

      const videoClips = built.videoClips as TimelineClip[];
      const audioClips = built.audioClips as TimelineClip[];
      const linkedId = String(director.linkedSpliceNodeId || '').trim();
      const existing = linkedId
        ? allNodes.find((n) => n.id === linkedId && n.type === 'videoSplice')
        : undefined;

      const dirW = Number(dirNode.data?.width) || 1100;
      const GAP = 48;
      const spliceW = 800;
      const spliceH = 500;
      const previewAspectId = String(director.mvAspectRatio || '16:9').replace(':', '-');
      // 一键铺轨：整轨替换（勿 merge 旧分镜图占位），避免「点了没反应」
      // 关闭视频轨左吸附：导演用 audioStartSec 绝对时间，压缝会与原曲错位
      // 静音视频轨：成片/对口型可能自带音轨，与原曲叠播会听感错位
      const nextSpliceTracks = {
        ...applyBuiltClipsToSpliceData(undefined, {
          videoTracks: [videoClips],
          videoClips,
          audioTracks: [audioClips],
        }),
        videoTrackLeftSnap: false,
        videoTrackLeftSnapList: [false],
        audioTrackLeftSnap: [false],
        mainTrackMagnet: false,
        trackLeftSnap: false,
        videoTrackMuted: [true],
      };

      const focusSpliceModule = (spliceId: string) => {
        const fire = () => {
          window.dispatchEvent(
            new CustomEvent('nexflow-canvas-focus-nodes', {
              detail: {
                nodes: [{ id: spliceId, width: spliceW, height: spliceH }],
              },
            }),
          );
        };
        requestAnimationFrame(() => {
          requestAnimationFrame(fire);
        });
        window.setTimeout(fire, 160);
      };

      if (existing) {
        setNodes((nds) =>
          nds.map((n) => {
            if (n.id === existing.id) {
              return {
                ...n,
                selected: true,
                data: {
                  ...n.data,
                  previewAspectId,
                  ...nextSpliceTracks,
                },
              };
            }
            if (n.id !== nodeId) return { ...n, selected: false };
            const prev = createDefaultDirectorPipelineState(
              (n.data as { director?: DirectorPipelineState })?.director || {},
            );
            const next = createDefaultDirectorPipelineState({
              ...prev,
              linkedSpliceNodeId: existing.id,
              phase: 'videos',
            });
            return { ...n, selected: false, data: { ...n.data, director: next } };
          }),
        );
        focusSpliceModule(existing.id);
        return;
      }

      const spliceId = `videoSplice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const spliceNode: Node = {
        id: spliceId,
        type: 'videoSplice',
        position: {
          x: dirNode.position.x + dirW + GAP,
          y: dirNode.position.y,
        },
        data: {
          width: spliceW,
          height: spliceH,
          title: 'MV剪辑',
          previewAspectId,
          ...nextSpliceTracks,
        },
      };

      setNodes((nds) =>
        nds
          .map((n) => {
            if (n.id !== nodeId) return { ...n, selected: false };
            const prev = createDefaultDirectorPipelineState(
              (n.data as { director?: DirectorPipelineState })?.director || {},
            );
            const next = createDefaultDirectorPipelineState({
              ...prev,
              linkedSpliceNodeId: spliceId,
              phase: 'videos',
            });
            return { ...n, selected: false, data: { ...n.data, director: next } };
          })
          .concat({ ...spliceNode, selected: true }),
      );
      setEdges((eds) => [
        ...eds,
        {
          id: `e-${nodeId}-${spliceId}-mv-vid`,
          source: nodeId,
          target: spliceId,
          sourceHandle: 'output',
          targetHandle: 'input',
        },
      ]);
      focusSpliceModule(spliceId);
    },
    [setNodes, setEdges],
  );

  const invokeDirectorConfirmGenVideos = useCallback(
    (nodeId: string) => {
      invokeSpawnDirectorVideos(nodeId);
    },
    [invokeSpawnDirectorVideos],
  );

  const invokeDirectorExportMv = useCallback(
    async (nodeId: string) => {
      const allNodes = latestNodesRef.current as Node[];
      const dirNode = allNodes.find((n) => n.id === nodeId);
      if (!dirNode || dirNode.type !== 'director') return;
      const director = createDefaultDirectorPipelineState(
        (dirNode.data as { director?: DirectorPipelineState })?.director || {},
      );
      const spliceId = String(director.linkedSpliceNodeId || '').trim();
      if (!spliceId) {
        invokeDirectorPreviewToSplice(nodeId);
      }
      const latest = latestNodesRef.current as Node[];
      const dir2 = createDefaultDirectorPipelineState(
        (
          latest.find((n) => n.id === nodeId)?.data as { director?: DirectorPipelineState } | undefined
        )?.director || director,
      );
      const sid = String(dir2.linkedSpliceNodeId || spliceId || '').trim();
      const spliceNode = latest.find((n) => n.id === sid && n.type === 'videoSplice');
      if (!spliceNode) return;

      const d = (spliceNode.data || {}) as {
        videoTracks?: TimelineClip[][];
        videoClips?: TimelineClip[];
        audioTracks?: TimelineClip[][];
        previewAspectId?: string;
        exportOutputWidth?: number;
        exportOutputHeight?: number;
        videoTrackVolume?: number[];
        videoTrackMuted?: boolean[];
        audioTrackVolume?: number[];
        audioTrackMuted?: boolean[];
      };
      const videoTracks =
        d.videoTracks && d.videoTracks.length > 0
          ? d.videoTracks
          : [Array.isArray(d.videoClips) ? d.videoClips : []];
      const audioTracks = d.audioTracks && d.audioTracks.length > 0 ? d.audioTracks : [[]];
      const clips = videoTracks[0] || [];
      if (!videoTracks.some((t) => t.length > 0)) return;

      const exportDims = resolveSpliceExportDimensions({
        previewAspectId:
          d.previewAspectId || String(director.mvAspectRatio || '16:9').replace(':', '-'),
        exportOutputWidth: d.exportOutputWidth,
        exportOutputHeight: d.exportOutputHeight,
      });
      const payload: VideoSpliceExportPayload = {
        videoTracks,
        clips,
        audioTracks,
        previewAspectId: exportDims.aspectId,
        options: {
          videoTrackVolume: (d.videoTrackVolume || [1]).map((v) => Math.min(2, (v ?? 1) * 2)),
          videoTrackMuted: d.videoTrackMuted || [false],
          audioTrackVolume: d.audioTrackVolume || [1],
          audioTrackMuted: d.audioTrackMuted || [false],
          outputWidth: exportDims.width,
          outputHeight: exportDims.height,
        },
      };
      await handleVideoSpliceExportToCanvas(sid, payload);
    },
    [handleVideoSpliceExportToCanvas, invokeDirectorPreviewToSplice],
  );

  /** 导演批量视频 SUCCESS 后：写回表内成片，并按镜号替换关联剪辑轨上的图片占位 */
  const tryReplaceDirectorMvClipFromVideoNode = useCallback(
    (videoNodeId: string, videoUrl: string) => {
      const url = String(videoUrl || '').trim();
      if (!url) return;
      const allNodes = latestNodesRef.current as Node[];
      const videoNode = allNodes.find((n) => n.id === videoNodeId);
      if (!videoNode || videoNode.type !== 'video') return;
      const shotNo = String((videoNode.data as { directorShotNo?: string })?.directorShotNo || '').trim();
      const directorId = String(
        (videoNode.data as { directorSourceId?: string })?.directorSourceId || '',
      ).trim();
      if (!shotNo || !directorId) return;

      const dirNode = allNodes.find((n) => n.id === directorId && n.type === 'director');
      if (!dirNode) return;
      const director = createDefaultDirectorPipelineState(
        (dirNode.data as { director?: DirectorPipelineState })?.director || {},
      );
      const spliceId = String(director.linkedSpliceNodeId || '').trim();

      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === directorId && n.type === 'director') {
            let nextDir = createDefaultDirectorPipelineState(
              (n.data as { director?: DirectorPipelineState })?.director || {},
            );
            nextDir = updateDirectorShotStoryboard(nextDir, shotNo, {
              videoUrl: url,
              videoStatus: 'ready',
              videoNodeId,
              videoError: '',
            });
            return { ...n, data: { ...n.data, director: nextDir } };
          }
          if (!spliceId || n.id !== spliceId || n.type !== 'videoSplice') return n;
          const d = n.data as {
            videoTracks?: TimelineClip[][];
            videoClips?: TimelineClip[];
            audioTracks?: TimelineClip[][];
          };
          const tracks = collapseDirectorAbsoluteVideoTracks(
            (d.videoTracks && d.videoTracks.length > 0
              ? d.videoTracks.map((t) => [...t])
              : [Array.isArray(d.videoClips) ? [...d.videoClips] : []]) as TimelineClip[][],
          );
          const nextTrack0 = replaceDirectorMvPlaceholdersWithVideos(tracks[0] || [], [
            { shotNo, videoUrl: url, sourceNodeId: videoNodeId },
          ]) as TimelineClip[];
          tracks[0] = nextTrack0;
          // 直接写回单轨，避免 merge 因 sourceNodeId 从占位换成成片节点而开新轨
          return {
            ...n,
            data: {
              ...n.data,
              videoTracks: tracks,
              videoClips: nextTrack0,
            },
          };
        }),
      );
    },
    [setNodes],
  );

  tryReplaceDirectorMvClipFromVideoNodeRef.current = tryReplaceDirectorMvClipFromVideoNode;

  /**
   * 卡死/强退后：表内 videoStatus=generating 会永久转圈。
   * 从隐藏视频节点 / 任务列表收回已完成成片；无结果且无进行中任务则标为中断，允许重新生成。
   */
  const reconcileDirectorGeneratingVideos = useCallback(() => {
    const allNodes = latestNodesRef.current as Node[];
    const directors = allNodes.filter((n) => n.type === 'director');
    if (directors.length === 0) return;

    type Patch =
      | { kind: 'ready'; directorId: string; shotNo: string; videoNodeId: string; url: string }
      | { kind: 'interrupt'; directorId: string; shotNo: string };

    const patches: Patch[] = [];
    const interruptMsg =
      '生成中断（应用退出），若平台已出片请点重新生成或从任务列表取回';

    const pickNodeVideoUrl = (n: Node | undefined): string => {
      if (!n || n.type !== 'video') return '';
      const d = (n.data || {}) as Record<string, unknown>;
      const a = String(d.originalVideoUrl || '').trim();
      const b = String(d.outputVideo || '').trim();
      const c = String(d.outputVideoUrl || '').trim();
      const durl = String(d.videoUrl || '').trim();
      for (const u of [a, b, c, durl]) {
        if (u && !looksLikeAudioMediaUrl(u)) return u;
      }
      return '';
    };

    for (const dirNode of directors) {
      const director = createDefaultDirectorPipelineState(
        (dirNode.data as { director?: DirectorPipelineState })?.director || {},
      );
      for (let i = 0; i < (director.shots || []).length; i++) {
        const shot = director.shots[i];
        const shotNo = String(shot?.['镜号'] || i + 1).trim();
        if (!shotNo) continue;
        const sb = getDirectorShotStoryboard(director, shotNo);
        if (sb.videoStatus !== 'generating') continue;

        const sbUrl = String(sb.videoUrl || '').trim();
        if (sbUrl) {
          patches.push({
            kind: 'ready',
            directorId: dirNode.id,
            shotNo,
            videoNodeId: String(sb.videoNodeId || '').trim() || `virtual-${shotNo}`,
            url: sbUrl,
          });
          continue;
        }

        const linkedId = String(sb.videoNodeId || '').trim();
        let videoNode = linkedId
          ? allNodes.find((n) => n.id === linkedId && n.type === 'video')
          : undefined;
        if (!videoNode) {
          videoNode = allNodes.find((n) => {
            if (n.type !== 'video') return false;
            const d = n.data as { directorSourceId?: string; directorShotNo?: string };
            return (
              String(d?.directorSourceId || '').trim() === dirNode.id &&
              String(d?.directorShotNo || '').trim() === shotNo
            );
          });
        }

        const fromNode = pickNodeVideoUrl(videoNode);
        if (fromNode && videoNode) {
          patches.push({
            kind: 'ready',
            directorId: dirNode.id,
            shotNo,
            videoNodeId: videoNode.id,
            url: fromNode,
          });
          continue;
        }

        const nodeIdForTask = videoNode?.id || linkedId;
        const isBusyStatus = (status: unknown) =>
          ['running', 'processing'].includes(String(status || '').toLowerCase());
        const isFailedStatus = (status: unknown) =>
          ['failed', 'error', 'cancelled'].includes(String(status || '').toLowerCase());

        // 重新生成：隐藏视频节点已在跑/刚 spawn，禁止用「同镜旧 success」抢写 ready（否则进度条闪一下就没）
        if (videoNode && !fromNode) {
          const d = (videoNode.data || {}) as Record<string, unknown>;
          const err = String(d.errorMessage || '').trim();
          const progress = typeof d.progress === 'number' ? Number(d.progress) : 0;
          const runtime = tasks.find((t) => t.id === `runtime-${videoNode.id}`);
          const runtimeBusy = !!runtime && isBusyStatus(runtime.status);
          const exactTasks = tasks.filter(
            (t) => t.taskType === 'video' && t.nodeId === videoNode.id,
          );
          const exactSuccess = exactTasks
            .filter((t) => t.status === 'success' && String(t.videoUrl || '').trim())
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
          if (exactSuccess?.videoUrl) {
            patches.push({
              kind: 'ready',
              directorId: dirNode.id,
              shotNo,
              videoNodeId: videoNode.id,
              url: String(exactSuccess.videoUrl).trim(),
            });
            continue;
          }
          const exactRunning = exactTasks.some((t) => isBusyStatus(t.status));
          if (!err && (runtimeBusy || exactRunning || (progress > 0 && progress < 100))) {
            continue;
          }
          // 刚 spawn、任务尚未登记：有初始化进度则继续等；否则等任务列表水合后走下方中断
          if (!err && exactTasks.length === 0) {
            if (!tasksListHydratedRef.current) continue;
            // progress 未写入且无任务：可能是崩溃残留空节点 → 落到下方 interrupt
          } else if (exactTasks.some((t) => isFailedStatus(t.status))) {
            patches.push({ kind: 'interrupt', directorId: dirNode.id, shotNo });
            continue;
          } else if (!err) {
            // 其它未决状态：继续等，勿中断
            continue;
          }
        }

        // 无活节点时才用镜号标题收回（崩溃恢复）；有绑定节点时已在上方处理
        const relatedTasks = tasks.filter((t) => {
          if (t.taskType !== 'video') return false;
          if (nodeIdForTask && t.nodeId === nodeIdForTask) return true;
          if (
            !videoNode &&
            t.nodeTitle &&
            String(t.nodeTitle).includes(`镜${shotNo}`)
          ) {
            return true;
          }
          return false;
        });
        const successTask = relatedTasks
          .filter((t) => t.status === 'success' && String(t.videoUrl || '').trim())
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
        if (successTask?.videoUrl) {
          const url = String(successTask.videoUrl).trim();
          const vid =
            videoNode?.id ||
            (successTask.nodeId && allNodes.some((n) => n.id === successTask.nodeId)
              ? successTask.nodeId
              : linkedId) ||
            `task-${successTask.id}`;
          patches.push({
            kind: 'ready',
            directorId: dirNode.id,
            shotNo,
            videoNodeId: vid,
            url,
          });
          continue;
        }

        const stillRunning = relatedTasks.some(
          (t) => isBusyStatus(t.status) && !!String(t.runningHubTaskId || '').trim(),
        );
        if (stillRunning) continue;
        // 任务列表未加载完时不误判中断
        if (!tasksListHydratedRef.current) continue;

        patches.push({ kind: 'interrupt', directorId: dirNode.id, shotNo });
      }
    }

    if (patches.length === 0) return;

    const ready = patches.filter((p): p is Extract<Patch, { kind: 'ready' }> => p.kind === 'ready');
    const interrupts = patches.filter(
      (p): p is Extract<Patch, { kind: 'interrupt' }> => p.kind === 'interrupt',
    );

    console.log('[Director] 收回卡住的成片状态', {
      ready: ready.length,
      interrupt: interrupts.length,
    });

    setNodes((nds) => {
      let next = nds.map((n) => {
        if (n.type === 'video') {
          const hit = ready.find((r) => r.videoNodeId === n.id);
          if (!hit) return n;
          const d = (n.data || {}) as Record<string, unknown>;
          if (pickNodeVideoUrl(n)) return n;
          return {
            ...n,
            data: {
              ...d,
              outputVideo: hit.url,
              originalVideoUrl: hit.url,
              progress: 100,
              progressMessage: '',
              errorMessage: undefined,
            },
          };
        }
        if (n.type !== 'director') return n;
        const mineReady = ready.filter((r) => r.directorId === n.id);
        const mineInt = interrupts.filter((r) => r.directorId === n.id);
        if (mineReady.length === 0 && mineInt.length === 0) return n;
        let nextDir = createDefaultDirectorPipelineState(
          (n.data as { director?: DirectorPipelineState })?.director || {},
        );
        for (const r of mineReady) {
          nextDir = updateDirectorShotStoryboard(nextDir, r.shotNo, {
            videoUrl: r.url,
            videoStatus: 'ready',
            videoNodeId: r.videoNodeId.startsWith('task-') || r.videoNodeId.startsWith('virtual-')
              ? String(getDirectorShotStoryboard(nextDir, r.shotNo).videoNodeId || '')
              : r.videoNodeId,
            videoError: '',
          });
        }
        for (const r of mineInt) {
          nextDir = updateDirectorShotStoryboard(nextDir, r.shotNo, {
            videoStatus: 'error',
            videoError: interruptMsg,
            videoUrl: '',
          });
        }
        return { ...n, data: { ...n.data, director: nextDir } };
      });

      // 写回关联剪辑轨占位
      for (const r of ready) {
        const dirNode = next.find((n) => n.id === r.directorId && n.type === 'director');
        if (!dirNode) continue;
        const director = createDefaultDirectorPipelineState(
          (dirNode.data as { director?: DirectorPipelineState })?.director || {},
        );
        const spliceId = String(director.linkedSpliceNodeId || '').trim();
        if (!spliceId) continue;
        next = next.map((n) => {
          if (n.id !== spliceId || n.type !== 'videoSplice') return n;
          const d = n.data as {
            videoTracks?: TimelineClip[][];
            videoClips?: TimelineClip[];
            audioTracks?: TimelineClip[][];
          };
          const tracks = collapseDirectorAbsoluteVideoTracks(
            (d.videoTracks && d.videoTracks.length > 0
              ? d.videoTracks.map((t) => [...t])
              : [Array.isArray(d.videoClips) ? [...d.videoClips] : []]) as TimelineClip[][],
          );
          const nextTrack0 = replaceDirectorMvPlaceholdersWithVideos(tracks[0] || [], [
            { shotNo: r.shotNo, videoUrl: r.url, sourceNodeId: r.videoNodeId },
          ]) as TimelineClip[];
          tracks[0] = nextTrack0;
          return {
            ...n,
            data: {
              ...n.data,
              videoTracks: tracks,
              videoClips: nextTrack0,
            },
          };
        });
      }
      return next;
    });
  }, [setNodes, tasks]);

  const directorVideoReconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!projectId) return;
    if (hydratedProjectIdRef.current !== projectId) return;
    const hasGenerating = (latestNodesRef.current as Node[]).some((n) => {
      if (n.type !== 'director') return false;
      const director = createDefaultDirectorPipelineState(
        (n.data as { director?: DirectorPipelineState })?.director || {},
      );
      return (director.shots || []).some((shot, i) => {
        const shotNo = String(shot?.['镜号'] || i + 1).trim();
        return getDirectorShotStoryboard(director, shotNo).videoStatus === 'generating';
      });
    });
    if (!hasGenerating) return;
    if (directorVideoReconcileTimerRef.current) clearTimeout(directorVideoReconcileTimerRef.current);
    directorVideoReconcileTimerRef.current = setTimeout(() => {
      reconcileDirectorGeneratingVideos();
    }, 600);
    return () => {
      if (directorVideoReconcileTimerRef.current) clearTimeout(directorVideoReconcileTimerRef.current);
    };
  }, [projectId, nodes, tasks, reconcileDirectorGeneratingVideos]);

  const invokeSpawnStoryboardSelectedImages = useCallback(
    (nodeId: string) => {
      const allNodes = latestNodesRef.current as Node[];
      const sbNode = allNodes.find((n) => n.id === nodeId);
      if (!sbNode || sbNode.type !== 'storyboardScript') return;

      const script = createDefaultStoryboardScriptState((sbNode.data as { storyboardScript?: StoryboardScriptState })?.storyboardScript || {});
      const selectedIndexes = script.selectedRowIndexes || [];
      if (selectedIndexes.length === 0) return;

      const sbW = Number(sbNode.data?.width) || 1024;
      const sbH = Number(sbNode.data?.height) || 576;
      const GAP = 48;
      const imageSize = imageNodeSizeForAspectRatio(DEFAULT_IMAGE_ASPECT_RATIO);
      const nodeW = imageSize?.w ?? IMAGE_NODE_DEFAULT_W;
      const nodeH = imageSize?.h ?? IMAGE_NODE_DEFAULT_H;
      const baseX = sbNode.position.x + sbW + GAP;
      const baseY = sbNode.position.y + Math.max(0, (sbH - nodeH) / 2);

      const newNodes: Node[] = [];
      const newEdges: Edge[] = [];
      const ts = Date.now();
      let spawnIndex = 0;

      for (const rowIdx of selectedIndexes) {
        const row = script.rows[rowIdx];
        if (!row) continue;
        const prompt = String(row['图片提示词'] || '').trim();
        if (!prompt) continue;

        const newId = `image-${ts}-${spawnIndex}-${Math.random().toString(36).slice(2, 6)}`;
        const shotNo = row['镜号'] || String(rowIdx + 1);
        newNodes.push({
          id: newId,
          type: 'image',
          position: { x: baseX, y: baseY + spawnIndex * (nodeH + GAP) },
          data: {
            label: '分镜图片',
            width: nodeW,
            height: nodeH,
            title: `镜${shotNo}`,
            resolution: '1k',
            aspectRatio: DEFAULT_IMAGE_ASPECT_RATIO,
            model: 'banana-2.0',
            seedreamWidth: 2048,
            seedreamHeight: 2048,
            prompt,
          },
        });
        newEdges.push({
          id: `e-${nodeId}-${newId}-${ts}-${spawnIndex}`,
          source: nodeId,
          sourceHandle: 'output',
          target: newId,
          targetHandle: 'input',
        });
        spawnIndex += 1;
      }

      if (newNodes.length === 0) return;
      setNodes((nds) => nds.map((n) => ({ ...n, selected: false })).concat(newNodes));
      setEdges((eds) => eds.concat(newEdges));
      setTimeout(() => saveHistory('general'), 0);
    },
    [setNodes, setEdges, saveHistory],
  );

  const invokeRvcTrainNodeDataChange = useCallback((nodeId: string, updates: Record<string, unknown>) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...updates } } : n)),
    );
    setRvcTrainInputPanelData((prev) => (prev?.nodeId === nodeId ? { ...prev, ...updates } : prev));
  }, []);

  const handleRvcTrainNodeDataChangeRef = useRef<typeof invokeRvcTrainNodeDataChange | null>(null);
  handleRvcTrainNodeDataChangeRef.current = invokeRvcTrainNodeDataChange;

  const invokePhotoCollageNodeDataChange = useCallback((nodeId: string, updates: Record<string, unknown>) => {
    handlePhotoCollageNodeDataChangeRef.current?.(nodeId, updates);
  }, []);
  const invokeGridMapNodeDataChange = useCallback((nodeId: string, updates: Record<string, unknown>) => {
    handleGridMapNodeDataChangeRef.current?.(nodeId, updates);
  }, []);
  const invokeImageComparerNodeDataChange = useCallback((nodeId: string, updates: Record<string, unknown>) => {
    handleImageComparerNodeDataChangeRef.current?.(nodeId, updates);
  }, []);
  const pickImageFromCanvasForGridMapRef = useRef<(() => Promise<string | null>) | null>(null);
  const invokePickImageFromCanvasForGridMap = useCallback(() => {
    return pickImageFromCanvasForGridMapRef.current?.() ?? Promise.resolve(null);
  }, []);
  const pickVideoFromCanvasRef = useRef<(() => Promise<string | null>) | null>(null);
  const invokePickVideoFromCanvas = useCallback(() => {
    return pickVideoFromCanvasRef.current?.() ?? Promise.resolve(null);
  }, []);
  const invokeCleanupSplitEdges = useCallback((nodeId: string, keepSourceHandles: string[]) => {
    handleCleanupSplitEdgesRef.current?.(nodeId, keepSourceHandles);
  }, []);
  const invokeAuxImageTaskComplete = useCallback((params: { nodeId: string; type: 'matting' | 'watermark' | 'multi-angle' | 'upscale-v3'; imageUrl: string; imageUrls?: string[] }) => {
    handleAuxImageTaskCompleteRef.current?.(params);
  }, []);
  const [previewImageNodeId, setPreviewImageNodeId] = useState<string | null>(null);
  const handlePreviewImageFromNode = useCallback((url: string, nodeId?: string) => {
    // 同一节点再次触发预览 → 关闭（再点一下关闭）
    if (previewImage && (nodeId ? previewImageNodeId === nodeId : previewImage === url)) {
      setPreviewImage(null);
      setPreviewImageNodeId(null);
      return;
    }
    setSelectedNode(null);
    setLlmInputPanelData(null);
    setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
    setVideoInputPanelData(null);
    setCharacterInputPanelData(null);
    setAudioInputPanelData(null);
    setPreviewImage(url);
    setPreviewImageNodeId(nodeId ?? null);
  }, [previewImage, previewImageNodeId]);

  const previewCanImportToCanvas = useMemo(() => {
    if (!previewImageNodeId) return false;
    const src = nodes.find((n) => n.id === previewImageNodeId);
    if (!src || src.type !== 'image') return false;
    const list = (src.data as { outputImages?: unknown[] })?.outputImages;
    return Array.isArray(list) && list.length > 1;
  }, [nodes, previewImageNodeId]);

  /** 拆帧等 image 节点路径常含 "video" 字样，不能靠 includes('video') 误判为视频预览 */
  const previewShowVideoPlayer = useMemo(() => {
    if (!previewImage) return false;
    const src = previewImageNodeId ? nodes.find((n) => n.id === previewImageNodeId) : undefined;
    if (src?.type === 'image') return false;
    if (src?.type === 'video' || isVideoModuleNodeType(src?.type)) return true;
    return isLikelyVideoMediaUrl(previewImage);
  }, [previewImage, previewImageNodeId, nodes]);

  const handleImportPreviewImageToCanvas = useCallback(async () => {
    if (!previewImageNodeId || !previewImage) return;
    const sourceNodeId = previewImageNodeId;
    const rawUrl = previewImage;
    const sourceNode = nodes.find((n) => n.id === sourceNodeId);
    if (!sourceNode || sourceNode.type !== 'image') {
      showAlert(imgc.importToCanvasFailed);
      return;
    }

    let outputImage = rawUrl;
    let originalImageUrl = rawUrl;
    let localPath = '';
    let tinyThumbUrl = '';
    let avgColorHex = '';
    let ghostBase64 = '';
    let assetWidth: number | undefined;
    let assetHeight: number | undefined;

    // 本地化失败不阻断导入，仍用原始 URL 建节点
    try {
      const api = window.electronAPI;
      if (api?.createImageLocalResourceFromBuffer && projectId) {
        if (rawUrl.startsWith('local-resource://') || rawUrl.startsWith('file://')) {
          let fsPath = rawUrl.replace(/^(local-resource:\/\/|file:\/\/\/?)/, '');
          if (fsPath.match(/^\/[a-zA-Z]:/)) fsPath = fsPath.substring(1);
          fsPath = fsPath.replace(/\//g, '\\');
          if (api.createImageLocalResourceFromFile && fsPath) {
            const resource = await api.createImageLocalResourceFromFile(projectId, fsPath);
            outputImage = resource.previewUrl;
            originalImageUrl = resource.originalUrl;
            localPath = resource.originalPath;
            tinyThumbUrl = resource.tinyUrl || '';
            avgColorHex = resource.avgColorHex || '';
            ghostBase64 = resource.ghostBase64 || '';
            assetWidth = resource.width;
            assetHeight = resource.height;
          }
        } else {
          let buffer: ArrayBuffer | null = null;
          if (rawUrl.startsWith('data:')) {
            const base64 = rawUrl.replace(/^data:image\/\w+;base64,/, '');
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            buffer = bytes.buffer;
          } else if (api.readImageAsDataUrl) {
            const formatted = formatImagePathSync(rawUrl);
            const srcData = sourceNode.data as {
              originalImageUrl?: string;
              localPath?: string;
            };
            const { dataUrl } = await api.readImageAsDataUrl(
              formatted,
              srcData?.originalImageUrl,
              srcData?.localPath,
              /^https?:\/\//i.test(rawUrl) ? rawUrl : undefined,
            );
            if (dataUrl?.startsWith('data:')) {
              const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
              const binary = atob(base64);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
              buffer = bytes.buffer;
            }
          } else if (/^https?:\/\//i.test(rawUrl)) {
            const res = await fetch(rawUrl);
            if (!res.ok) throw new Error(`fetch ${res.status}`);
            buffer = await res.arrayBuffer();
          }
          if (buffer) {
            const resource = await api.createImageLocalResourceFromBuffer(
              projectId,
              `import-canvas-${Date.now()}.png`,
              buffer,
            );
            outputImage = resource.previewUrl;
            originalImageUrl = resource.originalUrl;
            localPath = resource.originalPath;
            tinyThumbUrl = resource.tinyUrl || '';
            avgColorHex = resource.avgColorHex || '';
            ghostBase64 = resource.ghostBase64 || '';
            assetWidth = resource.width;
            assetHeight = resource.height;
          }
        }
      }
    } catch (err) {
      console.warn('[Workspace] 导入图本地化失败，使用原始 URL', err);
    }

    const logicalW = assetWidth && assetWidth > 0 ? assetWidth : 720;
    const logicalH = assetHeight && assetHeight > 0 ? assetHeight : 1024;
    const baseW = IMAGE_NODE_DEFAULT_W;
    const aspect = logicalW / Math.max(logicalH, 1);
    let nodeW = baseW;
    let nodeH = baseW / aspect;
    const maxH = baseW * 1.6;
    if (nodeH > maxH) {
      nodeH = maxH;
      nodeW = nodeH * aspect;
    }
    if (nodeW < 200) nodeW = 200;
    if (nodeH < 120) nodeH = 120;

    const GAP = IMPORT_CANVAS_GAP_PX;
    const CELL_GAP = IMPORT_CANVAS_GAP_PX;
    const imageUrlForTask = outputImage;
    const edgeImageAsset: DualImageAsset = {
      preview: outputImage,
      original: originalImageUrl,
      width: assetWidth,
      height: assetHeight,
    };
    const srcTitle = String(sourceNode.data?.title || 'image');
    const nodeDataPayload = {
      label: '导入图片',
      width: nodeW,
      height: nodeH,
      isUserResized: false,
      title: srcTitle,
      resolution: '1k',
      aspectRatio: DEFAULT_IMAGE_ASPECT_RATIO,
      model: 'banana-2.0',
      prompt: '',
      outputImage,
      originalImageUrl,
      localPath,
      tinyThumbUrl,
      avgColorHex,
      imageAsset: {
        preview: outputImage,
        original: originalImageUrl,
        tiny: tinyThumbUrl,
        ghost: ghostBase64,
        avgColorHex,
        width: assetWidth,
        height: assetHeight,
      },
    };

    const newNodeId = `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let committedNewNode: Node | null = null;
    flushSync(() => {
      setNodes((nds) => {
        const source = nds.find((n) => n.id === sourceNodeId);
        if (!source) return nds;
        const srcW = Number(source.data?.width) || baseW;
        const srcH = Number(source.data?.height) || nodeH;
        const srcX = source.position.x;
        const srcY = source.position.y;
        const anchorX = srcX + srcW + GAP;

        // 仅紧贴源模块右侧；多次导入时只接在「已从该模块连出」的图片节点之后，避免误扫画布上其它远距离节点
        let newX = anchorX;
        const priorImportTargets = edges
          .filter((e) => e.source === sourceNodeId && e.target && e.target !== sourceNodeId)
          .map((e) => nds.find((n) => n.id === e.target))
          .filter((n): n is Node => !!n && n.type === 'image');
        if (priorImportTargets.length > 0) {
          let maxRight = anchorX;
          for (const n of priorImportTargets) {
            const nx = n.position.x;
            if (nx < anchorX - 4) continue;
            const nw = Number(n.data?.width) || baseW;
            maxRight = Math.max(maxRight, nx + nw + CELL_GAP);
          }
          newX = maxRight;
        }
        const newY = srcY + Math.max(0, (srcH - nodeH) / 2);

        const newNode: Node = {
          id: newNodeId,
          type: 'image',
          position: { x: newX, y: newY },
          data: nodeDataPayload,
        };
        committedNewNode = newNode;
        return nds.concat(newNode);
      });
      setEdges((eds) => {
        if (!committedNewNode) return eds;
        const exists = eds.some((e) => e.source === sourceNodeId && e.target === newNodeId);
        if (exists) return eds;
        return addEdge(
          {
            id: `edge-import-${sourceNodeId}-${newNodeId}`,
            source: sourceNodeId,
            target: newNodeId,
            sourceHandle: 'output',
            targetHandle: 'image-input',
            data: { imageAsset: edgeImageAsset },
          },
          eds,
        );
      });
    });

    if (!committedNewNode) {
      showAlert(imgc.importToCanvasFailed);
      return;
    }

    showAlert(imgc.importToCanvasSuccess);

    window.setTimeout(() => {
      handleAddTaskRef.current?.(
        committedNewNode!.id,
        imageUrlForTask,
        '导入到画布',
        /^https?:\/\//i.test(rawUrl) ? rawUrl : undefined,
        undefined,
        committedNewNode!,
      );
    }, 0);
  }, [
    previewImageNodeId,
    previewImage,
    projectId,
    nodes,
    edges,
    setNodes,
    setEdges,
    showAlert,
    imgc.importToCanvasFailed,
    imgc.importToCanvasSuccess,
  ]);

  const handleOpenDrawingBoard = useCallback((url: string, nodeId: string, localPath?: string) => {
    setSelectedNode(null);
    setLlmInputPanelData(null);
    setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
    setVideoInputPanelData(null);
    setCharacterInputPanelData(null);
    setAudioInputPanelData(null);
    setDrawingBoardForImage({ imageUrl: url, nodeId, localPath });
  }, []);

  /** [极小缩放静态化] Zoom < 5% 时渲染极简占位，减少小比例下重绘。skipPlaceholder=true 时始终渲染真实组件，避免 image/text 节点缩放时重挂载导致图像刷新 */
  const withTinyZoomStatic = useCallback(
    (NodeComp: React.ComponentType<any>, areEqual?: (prev: any, next: any) => boolean, skipPlaceholder = false) => {
      const Wrapped = React.memo((props: any) => {
        if (skipPlaceholder) return <NodeComp {...props} />;
        const zoom = useFrozenFlowZoom(1);
        if (zoom < TINY_ZOOM_THRESHOLD_VALUE) return <MinimalNodePlaceholder {...props} />;
        return <NodeComp {...props} />;
      }, areEqual);
      return Wrapped;
    },
    []
  );

  /** 通用节点 props 比较：仅当 id/selected/position/data 等影响渲染的字段变化时才重渲染，避免增删节点时未变节点全屏闪绿 */
  const nodeArePropsEqual = useCallback((prev: any, next: any) => {
    if (prev.id !== next.id || prev.selected !== next.selected || prev.dragging !== next.dragging || prev.className !== next.className) return false;
    const px = prev.position?.x ?? (prev as any).xPos;
    const py = prev.position?.y ?? (prev as any).yPos;
    const nx = next.position?.x ?? (next as any).xPos;
    const ny = next.position?.y ?? (next as any).yPos;
    if (px !== nx || py !== ny) return false;
    return prev.data === next.data;
  }, []);

  const handleImageTo3dLibrarySaved = useCallback(() => {
    setCharacterListCollapsed(false);
    setCharacterListRefreshTrigger((p) => p + 1);
  }, []);

  // 节点类型定义（主题经 CanvasThemeContext 注入，避免 isDarkMode 变化重建 nodeTypes 导致节点重挂载）
  const nodeTypes: NodeTypes = useMemo(() => {
    const MinimalistTextNodeWrapper = withTinyZoomStatic(
      React.memo(
        (props: any) => {
          const { isDarkMode, performanceMode } = useCanvasTheme();
          return (
            <MinimalistTextNode
              {...props}
              projectId={projectId}
              isDarkMode={isDarkMode}
              performanceMode={isPerformanceMode}
              onDataChange={(updates) => invokeTextNodeDataChange(props.id, updates)}
            />
          );
        },
        nodeArePropsEqual
      ),
      nodeArePropsEqual,
      true // 始终渲染真实 text 节点，避免缩放时重挂载导致内容闪烁
    );
    (MinimalistTextNodeWrapper as any).displayName = 'MinimalistTextNodeWrapper';

    const LLMNodeWrapper = withTinyZoomStatic(
      React.memo((props: any) => {
        const { isDarkMode, performanceMode } = useCanvasTheme();
        return (
          <LLMNode
            {...props}
            isDarkMode={isDarkMode}
            performanceMode={isPerformanceMode}
            onDataChange={(updates) => invokeLlmNodeDataChange(props.id, updates)}
          />
        );
      }, nodeArePropsEqual),
      nodeArePropsEqual
    );
    (LLMNodeWrapper as any).displayName = 'LLMNodeWrapper';

    const imageNodeAreEqual = (prev: any, next: any) => {
      if (prev.id !== next.id || prev.selected !== next.selected || prev.className !== next.className) return false;
      const pa = prev.data || {};
      const na = next.data || {};
      if (pa.outputImage !== na.outputImage || pa.originalImageUrl !== na.originalImageUrl) return false;
      if (JSON.stringify(pa.outputImages || []) !== JSON.stringify(na.outputImages || [])) return false;
      if (pa.width !== na.width || pa.height !== na.height || pa.prompt !== na.prompt) return false;
      if (pa.progress !== na.progress || pa.progressMessage !== na.progressMessage || pa.errorMessage !== na.errorMessage) return false;
      const pImgs = JSON.stringify((pa.inputImages as string[]) || []);
      const nImgs = JSON.stringify((na.inputImages as string[]) || []);
      if (pImgs !== nImgs) return false;
      if (pa.imageAsset?.preview !== na.imageAsset?.preview) return false;
      if (pa.imageAsset?.original !== na.imageAsset?.original) return false;
      if (pa.imageAsset?.tiny !== na.imageAsset?.tiny) return false;
      if (pa.imageAsset?.ghost !== na.imageAsset?.ghost) return false;
      if (pa.imageAsset?.avgColorHex !== na.imageAsset?.avgColorHex) return false;
      if (pa.imageAsset?.width !== na.imageAsset?.width) return false;
      if (pa.imageAsset?.height !== na.imageAsset?.height) return false;
      if (pa.tinyThumbUrl !== na.tinyThumbUrl) return false;
      if (pa.avgColorHex !== na.avgColorHex) return false;
      if (pa.open3DPopover !== na.open3DPopover) return false;
      if (pa.isCameraViewModule !== na.isCameraViewModule) return false;
      if (pa.viewMode !== na.viewMode) return false;
      if (pa.sceneDisplay3dUrl !== na.sceneDisplay3dUrl) return false;
      // 位置必须参与比较，否则移动节点后不重渲染，子组件内仍用旧的 xPos/yPos（如一键拆分落点）
      if ((prev as any).xPos !== (next as any).xPos || (prev as any).yPos !== (next as any).yPos) return false;
      return true;
    };
    const ImageNodeWrapper = withTinyZoomStatic(
      React.memo(
        (props: any) => {
          const { isDarkMode, performanceMode } = useCanvasTheme();
          return (
          <ImageNode
            {...props}
            isDarkMode={isDarkMode}
            performanceMode={isPerformanceMode}
            prefetchScreenFactor={videoInteractionSettings.prefetchScreenFactor}
            onDataChange={invokeImageNodeDataChange}
            projectId={projectId}
            onAddCanvasImageNodes={handleAddCanvasImageNodes}
            onAuxImageTaskComplete={invokeAuxImageTaskComplete}
            onPreviewImage={handlePreviewImageFromNode}
            onOpenDrawingBoard={handleOpenDrawingBoard}
          />
          );
        },
        imageNodeAreEqual
      ),
      imageNodeAreEqual,
      true // 始终渲染真实 image 节点，避免缩放时重挂载导致图像刷新
    );
    (ImageNodeWrapper as any).displayName = 'ImageNodeWrapper';

    const videoNodeAreEqual = (prev: any, next: any) => {
      if (prev.id !== next.id || prev.selected !== next.selected || prev.className !== next.className) return false;
      const pa = prev.data || {};
      const na = next.data || {};
      if (pa.outputVideo !== na.outputVideo || pa.originalVideoUrl !== na.originalVideoUrl) return false;
      if (pa.referenceVideoUrl !== na.referenceVideoUrl) return false;
      if (pa.width !== na.width || pa.height !== na.height) return false;
      if (pa.progress !== na.progress || pa.progressMessage !== na.progressMessage || pa.errorMessage !== na.errorMessage) return false;
      // HeyGem 内嵌面板从 node.data 读取，需参与 memo 比较
      if (prev.type === 'heyGem' || next.type === 'heyGem') {
        if (pa.inputAudioUrl !== na.inputAudioUrl) return false;
        if (pa.heyGemScript !== na.heyGemScript) return false;
        if (pa.heyGemTtsModel !== na.heyGemTtsModel) return false;
        if (pa.heyGemCloneAudioUrl !== na.heyGemCloneAudioUrl) return false;
      }
      const pImgs = JSON.stringify((pa.inputImages as string[]) || []);
      const nImgs = JSON.stringify((na.inputImages as string[]) || []);
      return pImgs === nImgs;
    };
    const VideoNodeWrapper = withTinyZoomStatic(
      React.memo(
        (props: any) => {
          const { isDarkMode, performanceMode } = useCanvasTheme();
          return (
          <VideoNode
            {...props}
            projectId={projectId}
            isDarkMode={isDarkMode}
            performanceMode={isPerformanceMode}
            onDataChange={invokeVideoNodeDataChange}
            onAddFrameSplitNodes={handleAddCanvasImageNodes}
            onAddVideoClipNodes={handleAddVideoClipNodes}
            interactionSettings={videoInteractionSettings}
          />
          );
        },
        videoNodeAreEqual
      ),
      videoNodeAreEqual,
      true // 始终渲染真实 video 节点，避免缩放时重挂载导致 poster/视频刷新
    );
    (VideoNodeWrapper as any).displayName = 'VideoNodeWrapper';

    const WanAnimateNodeWrapper = withTinyZoomStatic(
      React.memo(
        (props: any) => {
          const { isDarkMode, performanceMode } = useCanvasTheme();
          return (
          <WanAnimateNode
            {...props}
            projectId={projectId}
            isDarkMode={isDarkMode}
            performanceMode={isPerformanceMode}
            onDataChange={invokeVideoNodeDataChange}
            interactionSettings={videoInteractionSettings}
          />
          );
        },
        videoNodeAreEqual
      ),
      videoNodeAreEqual,
      true
    );
    (WanAnimateNodeWrapper as any).displayName = 'WanAnimateNodeWrapper';

    const HeyGemNodeWrapper = withTinyZoomStatic(
      React.memo(
        (props: any) => {
          const { isDarkMode, performanceMode } = useCanvasTheme();
          return (
          <HeyGemNode
            {...props}
            projectId={projectId}
            isDarkMode={isDarkMode}
            performanceMode={isPerformanceMode}
            onDataChange={invokeVideoNodeDataChange}
            interactionSettings={videoInteractionSettings}
          />
          );
        },
        videoNodeAreEqual
      ),
      videoNodeAreEqual,
      true
    );
    (HeyGemNodeWrapper as any).displayName = 'HeyGemNodeWrapper';

    const CharacterNodeWrapper = withTinyZoomStatic(
      React.memo((props: any) => {
        const { isDarkMode, performanceMode } = useCanvasTheme();
        return (
          <CharacterNode
            {...props}
            isDarkMode={isDarkMode}
            performanceMode={isPerformanceMode}
            onDataChange={(updates) => invokeCharacterNodeDataChange(props.id, updates)}
          />
        );
      }, nodeArePropsEqual),
      nodeArePropsEqual,
      true
    );
    (CharacterNodeWrapper as any).displayName = 'CharacterNodeWrapper';

    const DigitalHumanNodeWrapper = withTinyZoomStatic(
      React.memo((props: any) => {
        const { isDarkMode, performanceMode } = useCanvasTheme();
        return (
          <DigitalHumanNode
            {...props}
            isDarkMode={isDarkMode}
            performanceMode={isPerformanceMode}
            onDataChange={(updates) => invokeCharacterNodeDataChange(props.id, updates)}
          />
        );
      }, nodeArePropsEqual),
      nodeArePropsEqual,
      true,
    );
    (DigitalHumanNodeWrapper as any).displayName = 'DigitalHumanNodeWrapper';

    const AudioNodeWrapper = withTinyZoomStatic(
      React.memo((props: any) => {
        const { isDarkMode, performanceMode } = useCanvasTheme();
        return (
        <AudioNode
          {...props}
          projectId={projectId}
          isDarkMode={isDarkMode}
          performanceMode={isPerformanceMode}
          onDataChange={invokeAudioNodeDataChange}
          onSeparateAllAudios={invokeSeparateAllAudios}
          onAddAudioClipNodes={handleAddVideoClipNodes}
          syncAudioPanelReferenceUrl={(url) => {
            setAudioInputPanelData((prev) =>
              prev && prev.nodeId === props.id ? { ...prev, referenceAudioUrl: url } : prev,
            );
          }}
        />
        );
      }, nodeArePropsEqual),
      nodeArePropsEqual
    );
    (AudioNodeWrapper as any).displayName = 'AudioNodeWrapper';

    const AudioTranscribeNodeWrapper = withTinyZoomStatic(
      React.memo((props: any) => {
        const { isDarkMode, performanceMode } = useCanvasTheme();
        return (
        <AudioTranscribeNode
          {...props}
          projectId={projectId}
          isDarkMode={isDarkMode}
          performanceMode={isPerformanceMode}
        />
        );
      }, nodeArePropsEqual),
      nodeArePropsEqual
    );
    (AudioTranscribeNodeWrapper as any).displayName = 'AudioTranscribeNodeWrapper';

    const TextSplitNodeWrapper = withTinyZoomStatic(
      React.memo((props: any) => {
        const { isDarkMode, performanceMode } = useCanvasTheme();
        return (
        <TextSplitNode {...props} isDarkMode={isDarkMode} performanceMode={isPerformanceMode} onCleanupEdgesForHandles={invokeCleanupSplitEdges} onDataChange={(updates) => invokeTextSplitNodeDataChange(props.id, updates)} />
        );
      }, nodeArePropsEqual),
      nodeArePropsEqual
    );
    (TextSplitNodeWrapper as any).displayName = 'TextSplitNodeWrapper';

    const TextNodeWithTinyZoom = withTinyZoomStatic(TextNodeWrapper as React.ComponentType<any>, nodeArePropsEqual);
    const CustomNodeWithTinyZoom = withTinyZoomStatic(CustomNode as React.ComponentType<any>, nodeArePropsEqual);
    const CameraControlNodeWrapper = withTinyZoomStatic(
      React.memo((props: any) => {
        const { isDarkMode, performanceMode } = useCanvasTheme();
        return <CameraControlNode {...props} isDarkMode={isDarkMode} performanceMode={isPerformanceMode} />;
      }, nodeArePropsEqual),
      nodeArePropsEqual
    );
    (CameraControlNodeWrapper as any).displayName = 'CameraControlNodeWrapper';

    const VideoSpliceNodeWrapper = withTinyZoomStatic(
      React.memo(
        (props: any) => {
          const { isDarkMode } = useCanvasTheme();
          return (
          <VideoSpliceNode
            {...props}
            projectId={projectId}
            isDarkMode={isDarkMode}
            onDataChange={invokeVideoSpliceNodeDataChange}
            onExportToCanvas={invokeVideoSpliceExportToCanvas}
          />
          );
        },
        nodeArePropsEqual
      ),
      nodeArePropsEqual
    );
    (VideoSpliceNodeWrapper as any).displayName = 'VideoSpliceNodeWrapper';

    const photoCollageAreEqual = (prev: any, next: any) => {
      if (prev.id !== next.id || prev.selected !== next.selected || prev.className !== next.className) return false;
      const pa = prev.data || {};
      const na = next.data || {};
      if (pa.width !== na.width || pa.height !== na.height) return false;
      if (pa.collageCanvasW !== na.collageCanvasW || pa.collageCanvasH !== na.collageCanvasH) return false;
      if (JSON.stringify(pa.layers || []) !== JSON.stringify(na.layers || [])) return false;
      return true;
    };
    const PhotoCollageNodeWrapper = withTinyZoomStatic(
      React.memo(
        (props: any) => {
          const { isDarkMode } = useCanvasTheme();
          return (
          <PhotoCollageNode
            {...props}
            projectId={projectId}
            isDarkMode={isDarkMode}
            onDataChange={invokePhotoCollageNodeDataChange}
            onExportToCanvas={handlePhotoCollageExportToCanvas}
          />
          );
        },
        photoCollageAreEqual
      ),
      photoCollageAreEqual,
      true
    );
    (PhotoCollageNodeWrapper as any).displayName = 'PhotoCollageNodeWrapper';

    const gridMapAreEqual = (prev: any, next: any) => {
      if (prev.id !== next.id || prev.selected !== next.selected || prev.className !== next.className) return false;
      const pa = prev.data || {};
      const na = next.data || {};
      if (pa.width !== na.width || pa.height !== na.height) return false;
      if (pa.gridCols !== na.gridCols || pa.gridRows !== na.gridRows) return false;
      if (pa.canvasW !== na.canvasW || pa.canvasH !== na.canvasH) return false;
      if (pa.gapPx !== na.gapPx) return false;
      if (JSON.stringify(pa.cells || []) !== JSON.stringify(na.cells || [])) return false;
      return true;
    };
    const GridMapNodeWrapper = withTinyZoomStatic(
      React.memo(
        (props: any) => {
          const { isDarkMode } = useCanvasTheme();
          return (
            <GridMapNode
              {...props}
              projectId={projectId}
              isDarkMode={isDarkMode}
              onDataChange={invokeGridMapNodeDataChange}
              onExportToCanvas={handleGridMapExportToCanvas}
              onPickImageFromCanvas={invokePickImageFromCanvasForGridMap}
            />
          );
        },
        gridMapAreEqual,
      ),
      gridMapAreEqual,
      true,
    );
    (GridMapNodeWrapper as any).displayName = 'GridMapNodeWrapper';

    const imageComparerAreEqual = (prev: any, next: any) => {
      if (prev.id !== next.id || prev.selected !== next.selected || prev.className !== next.className) return false;
      const pa = prev.data || {};
      const na = next.data || {};
      if (pa.width !== na.width || pa.height !== na.height) return false;
      if (pa.imageAUrl !== na.imageAUrl || pa.imageBUrl !== na.imageBUrl) return false;
      if (pa.imageASourceNodeId !== na.imageASourceNodeId || pa.imageBSourceNodeId !== na.imageBSourceNodeId) return false;
      if (pa.splitRatio !== na.splitRatio) return false;
      if (pa.aspectRatio !== na.aspectRatio) return false;
      if (pa.mediaWidth !== na.mediaWidth || pa.mediaHeight !== na.mediaHeight) return false;
      if (pa.isUserResized !== na.isUserResized) return false;
      return true;
    };
    const ImageComparerNodeWrapper = withTinyZoomStatic(
      React.memo(
        (props: any) => {
          const { isDarkMode } = useCanvasTheme();
          return (
            <ImageComparerNode
              {...props}
              projectId={projectId}
              isDarkMode={isDarkMode}
              onDataChange={invokeImageComparerNodeDataChange}
            />
          );
        },
        imageComparerAreEqual,
      ),
      imageComparerAreEqual,
      true,
    );
    (ImageComparerNodeWrapper as any).displayName = 'ImageComparerNodeWrapper';

    const imageTo3dAreEqual = (prev: any, next: any) => {
      if (prev.id !== next.id || prev.selected !== next.selected || prev.className !== next.className) return false;
      const pa = prev.data || {};
      const na = next.data || {};
      if (pa.inputImageUrl !== na.inputImageUrl) return false;
      if (pa.model !== na.model) return false;
      if (pa.resultTextureUrl !== na.resultTextureUrl) return false;
      if (pa.localTexturePath !== na.localTexturePath) return false;
      if (pa.resultTextureRemoteUrl !== na.resultTextureRemoteUrl) return false;
      if (pa.outputGlbUrl !== na.outputGlbUrl || pa.localGlbUrl !== na.localGlbUrl) return false;
      if (pa.progress !== na.progress || pa.progressMessage !== na.progressMessage || pa.errorMessage !== na.errorMessage) return false;
      if (pa.previewSnapshotUrl !== na.previewSnapshotUrl) return false;
      if (pa.libraryCharacterId !== na.libraryCharacterId) return false;
      if (pa.width !== na.width || pa.height !== na.height) return false;
      return true;
    };
    const ImageTo3dNodeWrapper = withTinyZoomStatic(
      React.memo(
        (props: any) => {
          const { isDarkMode } = useCanvasTheme();
          return (
          <ImageTo3dNode
            {...props}
            projectId={projectId}
            isDarkMode={isDarkMode}
            onDataChange={invokeImageTo3dNodeDataChange}
            onLibrarySaved={handleImageTo3dLibrarySaved}
          />
          );
        },
        imageTo3dAreEqual,
      ),
      imageTo3dAreEqual,
      true, // 缩放画布时不卸载 WebGL，避免贴图重载与卡顿
    );
    (ImageTo3dNodeWrapper as any).displayName = 'ImageTo3dNodeWrapper';

    const storyboardScriptAreEqual = (prev: any, next: any) => {
      if (prev.id !== next.id || prev.selected !== next.selected || prev.className !== next.className) return false;
      const pa = prev.data || {};
      const na = next.data || {};
      if (pa.width !== na.width || pa.height !== na.height) return false;
      if (pa.isGenerating !== na.isGenerating || pa.error !== na.error) return false;
      if (pa.userPrompt !== na.userPrompt || pa.chatModel !== na.chatModel || pa.title !== na.title) return false;
      if (JSON.stringify(pa.storyboardScript) !== JSON.stringify(na.storyboardScript)) return false;
      return true;
    };
    const StoryboardScriptNodeWrapper = withTinyZoomStatic(
      React.memo(
        (props: any) => (
          <StoryboardScriptNode
            {...props}
            data={{
              ...props.data,
              onUpdate: (updates) => invokeStoryboardScriptNodeDataChange(props.id, updates),
              onSpawnSelectedImages: () => invokeSpawnStoryboardSelectedImages(props.id),
            }}
          />
        ),
        storyboardScriptAreEqual,
      ),
      storyboardScriptAreEqual,
      true,
    );
    (StoryboardScriptNodeWrapper as any).displayName = 'StoryboardScriptNodeWrapper';

    const scriptAreEqual = (prev: any, next: any) => {
      if (prev.id !== next.id || prev.selected !== next.selected) return false;
      const pa = prev.data || {};
      const na = next.data || {};
      if (pa.text !== na.text || pa.title !== na.title) return false;
      if (pa.width !== na.width || pa.height !== na.height) return false;
      return true;
    };
    const ScriptNodeWrapper = withTinyZoomStatic(
      React.memo(
        (props: any) => (
          <ScriptNode
            {...props}
            data={{
              ...props.data,
              onUpdate: (updates: Record<string, unknown>) => invokeScriptNodeDataChange(props.id, updates),
            }}
          />
        ),
        scriptAreEqual,
      ),
      scriptAreEqual,
      true,
    );
    (ScriptNodeWrapper as any).displayName = 'ScriptNodeWrapper';

    const directorAreEqual = (prev: any, next: any) => {
      if (prev.id !== next.id || prev.selected !== next.selected || prev.className !== next.className) return false;
      const pa = prev.data || {};
      const na = next.data || {};
      if (pa.width !== na.width || pa.height !== na.height) return false;
      if (pa.isGenerating !== na.isGenerating || pa.error !== na.error) return false;
      if (pa.userPrompt !== na.userPrompt || pa.title !== na.title) return false;
      if (pa.director !== na.director) return false;
      return true;
    };
    const DirectorNodeWrapper = withTinyZoomStatic(
      React.memo(
        (props: any) => (
          <DirectorNode
            {...props}
            data={{
              ...props.data,
              projectId,
              onUpdate: (updates: Record<string, unknown>) => invokeDirectorNodeDataChange(props.id, updates),
              onSpawnVideos: (opts?: {
                shotNos?: string[];
                startLipsync?: boolean;
                lipsyncShotNos?: string[];
              }) => invokeSpawnDirectorVideos(props.id, opts),
              onPreviewToSplice: () => invokeDirectorPreviewToSplice(props.id),
              onVideosToSplice: () => invokeDirectorVideosToSplice(props.id),
              onConfirmGenVideos: () => invokeDirectorConfirmGenVideos(props.id),
              onExportMv: () => {
                void invokeDirectorExportMv(props.id);
              },
              onPickImageFromCanvas: () => invokePickImageFromCanvasForGridMap(),
              onPickVideoFromCanvas: () => invokePickVideoFromCanvas(),
            }}
          />
        ),
        directorAreEqual,
      ),
      directorAreEqual,
      true,
    );
    (DirectorNodeWrapper as any).displayName = 'DirectorNodeWrapper';

    const rvcTrainAreEqual = (prev: any, next: any) => {
      if (prev.id !== next.id || prev.selected !== next.selected) return false;
      const pa = prev.data || {};
      const na = next.data || {};
      if (pa.referenceAudioUrl !== na.referenceAudioUrl) return false;
      if (pa.rvcTrainModelName !== na.rvcTrainModelName) return false;
      if (pa.rvcTrainNameFontPx !== na.rvcTrainNameFontPx) return false;
      if (pa.outputModelUrl !== na.outputModelUrl) return false;
      if (pa.libraryRvcVoiceId !== na.libraryRvcVoiceId) return false;
      if (pa.libraryAvatarUrl !== na.libraryAvatarUrl) return false;
      if (pa.aiStatus !== na.aiStatus) return false;
      if (pa.progress !== na.progress || pa.errorMessage !== na.errorMessage) return false;
      if (pa.width !== na.width || pa.height !== na.height) return false;
      return true;
    };
    const RvcTrainNodeWrapper = withTinyZoomStatic(
      React.memo(
        (props: any) => {
          const { isDarkMode } = useCanvasTheme();
          return <RvcTrainNode {...props} isDarkMode={isDarkMode} onDataChange={invokeRvcTrainNodeDataChange} />;
        },
        rvcTrainAreEqual,
      ),
      rvcTrainAreEqual,
    );
    (RvcTrainNodeWrapper as any).displayName = 'RvcTrainNodeWrapper';

    return {
      custom: CustomNodeWithTinyZoom,
      textNode: TextNodeWithTinyZoom,
      minimalistText: MinimalistTextNodeWrapper,
      llm: LLMNodeWrapper,
      image: ImageNodeWrapper,
      video: VideoNodeWrapper,
      wanAnimate: WanAnimateNodeWrapper,
      heyGem: HeyGemNodeWrapper,
      videoSplice: VideoSpliceNodeWrapper,
      photoCollage: PhotoCollageNodeWrapper,
      gridMap: GridMapNodeWrapper,
      imageComparer: ImageComparerNodeWrapper,
      imageTo3d: ImageTo3dNodeWrapper,
      storyboardScript: StoryboardScriptNodeWrapper,
      script: ScriptNodeWrapper,
      director: DirectorNodeWrapper,
      rvcTrain: RvcTrainNodeWrapper,
      character: CharacterNodeWrapper,
      digitalHuman: DigitalHumanNodeWrapper,
      audio: AudioNodeWrapper,
      audioTranscribe: AudioTranscribeNodeWrapper,
      textSplit: TextSplitNodeWrapper,
      cameraControl: CameraControlNodeWrapper,
    };
  }, [projectId, invokeTextNodeDataChange, invokeLlmNodeDataChange, invokeTextSplitNodeDataChange, invokeImageNodeDataChange, invokeVideoNodeDataChange, invokeAudioNodeDataChange, invokeSeparateAllAudios, invokeCharacterNodeDataChange, invokeVideoSpliceNodeDataChange, invokeVideoSpliceExportToCanvas, invokePhotoCollageNodeDataChange, invokeGridMapNodeDataChange, invokeImageComparerNodeDataChange, invokePickImageFromCanvasForGridMap, invokePickVideoFromCanvas, invokeImageTo3dNodeDataChange, invokeStoryboardScriptNodeDataChange, invokeSpawnStoryboardSelectedImages, invokeScriptNodeDataChange, invokeDirectorNodeDataChange, invokeSpawnDirectorVideos, invokeDirectorPreviewToSplice, invokeDirectorVideosToSplice, invokeDirectorConfirmGenVideos, invokeDirectorExportMv, invokeRvcTrainNodeDataChange, handlePhotoCollageExportToCanvas, handleGridMapExportToCanvas, handleAddCanvasImageNodes, handleAddVideoClipNodes, handleImageTo3dLibrarySaved, invokeCleanupSplitEdges, invokeAuxImageTaskComplete, handlePreviewImageFromNode, handleOpenDrawingBoard, videoInteractionSettings, withTinyZoomStatic, TextNodeWrapper, nodeArePropsEqual, GRID_MAP_HMR_REV]);

  // 连接节点（拖拽中的临时线为虚线，连接完成后的线为实线）
  const onConnect = useCallback(
    (params: Connection) => {
      // 确定 targetHandle：
      // - Image 节点：image -> image 使用 'image-input'（图生图），其他使用 'input'（文生图）
      // - Video 节点：统一使用 'input'（可以接收文本、LLM输出或图像）
      // - Character 节点：仅支持 video 输入，使用 'input' 把手
      // - 其他情况使用 'input'
      let targetHandle = params.targetHandle;
      if (!targetHandle && params.target && params.source) {
        const targetNode = nodes.find((n) => n.id === params.target);
        const sourceNode = nodes.find((n) => n.id === params.source);
        if (targetNode && targetNode.type === 'image') {
          if (sourceNode && sourceNode.type === 'image') {
            targetHandle = 'image-input';
          } else if (sourceNode && isVideoTrackSourceNodeType(sourceNode.type)) {
            targetHandle = 'image-input';
          } else {
            targetHandle = 'input';
          }
        } else if (targetNode && isVideoModuleNodeType(targetNode.type)) {
          // Video / 视频换人：统一使用 input，按源类型自动识别（Image→图生视频、Audio→口型同步、Video→参考视频）
          targetHandle = 'input';
        } else if (targetNode && targetNode.type === 'character') {
          // Character 节点：仅支持 video 输入，使用统一 'input' 把手
          targetHandle = 'input';
        } else if (targetNode && targetNode.type === 'videoSplice') {
          // 视频剪辑节点：接收 video/image/audio，使用 'input' 把手
          targetHandle = 'input';
        } else if (targetNode && targetNode.type === 'photoCollage') {
          targetHandle = 'input';
        } else if (targetNode && targetNode.type === 'gridMap') {
          targetHandle = 'input';
        } else if (targetNode && targetNode.type === 'imageComparer') {
          targetHandle = pickImageComparerTargetHandle(
            latestEdgesRef.current as Edge[],
            params.target,
            params.targetHandle,
          );
        } else if (targetNode && targetNode.type === 'imageTo3d') {
          targetHandle = 'input';
        } else if (targetNode && targetNode.type === 'rvcTrain') {
          targetHandle = 'input';
        } else if (targetNode && targetNode.type === 'audio') {
          // Audio 节点：text/llm -> audio 使用 'audio-input'
          targetHandle = 'audio-input';
        } else if (targetNode && targetNode.type === 'audioTranscribe') {
          // 语音转文字节点：统一音频输入把手
          targetHandle = 'audio-transcribe-input';
        } else {
          targetHandle = 'input';
        }
      }
      
      const sourceNodeForEdge = params.source
        ? (latestNodesRef.current.find((n) => n.id === params.source) ??
            nodes.find((n) => n.id === params.source) ??
            null)
        : null;
      const targetNodeForEdge = params.target
        ? (latestNodesRef.current.find((n) => n.id === params.target) ??
            nodes.find((n) => n.id === params.target) ??
            null)
        : null;
      const characterEdgeCarriesStill =
        sourceNodeForEdge?.type === 'character' &&
        targetNodeForEdge &&
        (targetNodeForEdge.type === 'image' || isVideoModuleNodeType(targetNodeForEdge.type));
      const shouldAttachImageAsset =
        sourceNodeForEdge &&
        (sourceNodeForEdge.type === 'image' || !!characterEdgeCarriesStill);
      let imageAsset: DualImageAsset | null = null;
      if (shouldAttachImageAsset && sourceNodeForEdge) {
        if (sourceNodeForEdge.type === 'image') {
          imageAsset = buildDualImageAssetFromNodeData(sourceNodeForEdge.data);
        } else if (sourceNodeForEdge.type === 'character') {
          const urls = getCharacterTransmitImageUrls(sourceNodeForEdge.data as Record<string, unknown>);
          const preview = urls[0] || '';
          if (preview) imageAsset = { preview, original: preview };
        }
      }
      let sourceHandle = params.sourceHandle;
      if (sourceNodeForEdge?.type === 'textSplit') {
        sourceHandle = normalizeTextSplitSourceHandle(sourceHandle);
      } else if (!sourceHandle && sourceNodeForEdge?.type === 'character') {
        sourceHandle = 'output';
      } else if (!sourceHandle) {
        sourceHandle = 'output';
      }
      let videoSrc: string | undefined;
      let audioSrc: string | undefined;
      if (
        sourceNodeForEdge &&
        targetNodeForEdge?.type === 'videoSplice'
      ) {
        if (sourceNodeForEdge.type === 'digitalHuman' && isDigitalHumanVideoOutputHandle(sourceHandle)) {
          const raw = pickDigitalHumanVideoUrl(sourceNodeForEdge.data as Record<string, unknown>);
          if (raw) videoSrc = normalizeVideoUrl(raw);
        } else if (sourceNodeForEdge.type === 'digitalHuman' && isDigitalHumanAudioOutputHandle(sourceHandle)) {
          const raw = pickDigitalHumanAudioUrl(sourceNodeForEdge.data as Record<string, unknown>);
          if (raw) audioSrc = normalizeVideoUrl(raw);
        } else if (isVideoTrackSourceNodeType(sourceNodeForEdge.type)) {
          const raw = String(
            sourceNodeForEdge.data?.outputVideo || sourceNodeForEdge.data?.originalVideoUrl || '',
          ).trim();
          if (raw) videoSrc = normalizeVideoUrl(raw);
        } else if (sourceNodeForEdge.type === 'audio') {
          const raw = pickAudioOutputUrlFromAudioNodeData(
            sourceNodeForEdge.data as Record<string, unknown>,
          );
          if (raw) audioSrc = normalizeVideoUrl(raw);
        }
      }
      const newEdge = {
        ...params,
        sourceHandle,
        targetHandle: targetHandle || 'input',
        data: {
          ...((params as any).data || {}),
          ...(imageAsset ? { imageAsset } : {}),
          ...(videoSrc ? { videoSrc } : {}),
          ...(audioSrc ? { audioSrc } : {}),
        },
        // 不设置 strokeDasharray，使用全局样式：
        //  - 拖拽中的临时连线：虚线（通过 CSS .react-flow__edge-connecting 控制）
        //  - 连接完成后的连线：实线
        animated: false,
      };
      
      // 添加新边
      setEdges((eds) => {
          let baseEds = eds;
          // 图片对比：同一槽位仅保留一条入边
          if (
            params.target &&
            targetNodeForEdge?.type === 'imageComparer' &&
            (targetHandle === 'image_a' || targetHandle === 'image_b')
          ) {
            baseEds = eds.filter(
              (e) => !(e.target === params.target && e.targetHandle === targetHandle),
            );
          }
          const updatedEdges = addEdge(newEdge, baseEds);
        
          // 如果连接的是 Image / Video 节点，根据源节点类型处理
          if (params.target) {
            setNodes((nds) => {
              const targetNode = nds.find((n) => n.id === params.target);
              const sourceNode = nds.find((n) => n.id === params.source);
            
            if (targetNode && targetNode.type === 'textSplit' && sourceNode) {
              let textToSplit = '';
              if (sourceNode.type === 'minimalistText' || sourceNode.type === 'text') {
                textToSplit = sourceNode.data?.text || '';
              } else if (sourceNode.type === 'llm') {
                textToSplit = sourceNode.data?.outputText || '';
              } else if (sourceNode.type === 'audioTranscribe') {
                textToSplit = sourceNode.data?.text || '';
              }
              return nds.map((node) =>
                node.id === params.target
                  ? { ...node, data: { ...node.data, inputText: textToSplit } }
                  : node
              );
            }

            // 视频剪辑：按全部入边重建轨道，避免逐条追加与异步同步互相覆盖
            if (targetNode && targetNode.type === 'videoSplice') {
              const built = buildVideoSpliceClipsFromEdges(
                params.target!,
                updatedEdges,
                nds,
                targetNode.data as { videoClips?: TimelineClip[]; audioTracks?: TimelineClip[][] },
              );
              const connectedIds = collectSpliceIncomingSourceIds(params.target!, updatedEdges);
              // 有新接入片段（如音频）时必须写入；wouldDrop 时仍靠 connectedIds 保留旧轨
              const blockDropOnly =
                spliceRebuildWouldDropConnected(targetNode.data, built, connectedIds) &&
                !spliceBuiltHasNewConnectedSources(targetNode.data, built);
              if (blockDropOnly) {
                return nds;
              }
              return nds.map((node) =>
                node.id === params.target
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        ...applyBuiltClipsToSpliceData(node.data, built, connectedIds),
                      },
                    }
                  : node,
              );
            }

            if (targetNode && targetNode.type === 'imageTo3d' && sourceNode?.type === 'image') {
              const url = pickImageUrlFromImageSourceNode(sourceNode);
              if (url) {
                if (imageTo3dInputPanelDataRef.current?.nodeId === params.target) {
                  setImageTo3dInputPanelData((prev) =>
                    prev && prev.nodeId === params.target ? { ...prev, inputImageUrl: url } : prev,
                  );
                }
                return nds.map((node) =>
                  node.id === params.target
                    ? { ...node, data: { ...node.data, inputImageUrl: url } }
                    : node,
                );
              }
            }

            if (targetNode && targetNode.type === 'rvcTrain' && sourceNode?.type === 'audio') {
              const trainUrl = pickBestAudioUrlForRhTrainFromNodeData(sourceNode.data as Record<string, unknown>);
              if (trainUrl) {
                const isLocalTrain =
                  trainUrl.startsWith('local-resource://') || trainUrl.startsWith('file://');
                if (isLocalTrain && window.electronAPI?.uploadLocalAudioToOSS) {
                  void ensureOssAudioUrlForRhTrain(trainUrl)
                    .then((ossUrl) => {
                      setNodes((n) =>
                        n.map((node) =>
                          node.id === params.target
                            ? { ...node, data: { ...node.data, referenceAudioUrl: ossUrl } }
                            : node,
                        ),
                      );
                      if (rvcTrainInputPanelDataRef.current?.nodeId === params.target) {
                        setRvcTrainInputPanelData((prev) =>
                          prev && prev.nodeId === params.target ? { ...prev, referenceAudioUrl: ossUrl } : prev,
                        );
                      }
                    })
                    .catch((e) => console.warn('[Workspace] RVC 训练音频上传 OSS 失败', e));
                }
                if (rvcTrainInputPanelDataRef.current?.nodeId === params.target) {
                  setRvcTrainInputPanelData((prev) =>
                    prev && prev.nodeId === params.target ? { ...prev, referenceAudioUrl: trainUrl } : prev,
                  );
                }
                return nds.map((node) =>
                  node.id === params.target
                    ? { ...node, data: { ...node.data, referenceAudioUrl: trainUrl } }
                    : node,
                );
              }
            }

            if (sourceNode?.type === 'rvcTrain' && targetNode?.type === 'audio') {
              const patch = buildAudioIncomingPatchFromEdges(
                params.target!,
                nds,
                updatedEdges,
                targetNode.data as Record<string, unknown>,
              );
              if (patch) {
                const updatedNodes = nds.map((node) =>
                  node.id === params.target ? { ...node, data: { ...node.data, ...patch } } : node,
                );
                if (selectedNode && selectedNode.id === params.target) {
                  setAudioInputPanelData((prev) =>
                    prev && prev.nodeId === params.target ? { ...prev, ...patch } : prev,
                  );
                }
                return updatedNodes;
              }
            }

            if (targetNode && targetNode.type === 'photoCollage') {
              const prevLayers = ((targetNode.data?.layers || []) as CollageLayer[]).slice();
              const nextLayers = buildPhotoCollageLayersFromEdges(
                params.target!,
                updatedEdges,
                nds,
                prevLayers,
              );
              return nds.map((node) =>
                node.id === params.target
                  ? { ...node, data: { ...node.data, layers: nextLayers } }
                  : node,
              );
            }

            if (targetNode && targetNode.type === 'gridMap') {
              const cols = Number(targetNode.data?.gridCols) || DEFAULT_GRID_MAP_COLS;
              const rows = Number(targetNode.data?.gridRows) || DEFAULT_GRID_MAP_ROWS;
              const prevCells = ((targetNode.data?.cells || []) as GridMapCell[]).slice();
              const nextCells = buildGridMapCellsFromEdges(
                params.target!,
                updatedEdges,
                nds,
                prevCells,
                cols,
                rows,
              );
              return nds.map((node) =>
                node.id === params.target
                  ? { ...node, data: { ...node.data, cells: nextCells } }
                  : node,
              );
            }

            if (targetNode && targetNode.type === 'imageComparer') {
              const urls = buildImageComparerUrlsFromEdges(params.target!, updatedEdges, nds);
              return nds.map((node) =>
                node.id === params.target
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        imageAUrl: urls.imageAUrl,
                        imageBUrl: urls.imageBUrl,
                        imageASourceNodeId: urls.imageASourceNodeId,
                        imageBSourceNodeId: urls.imageBSourceNodeId,
                      },
                    }
                  : node,
              );
            }

            if (targetNode && targetNode.type === 'image') {
              // Text/LLM/文本拆分/Image/角色/分镜脚本 连接到 Image：收集 prompt + inputImages
              if (
                sourceNode &&
                (sourceNode.type === 'minimalistText' ||
                  sourceNode.type === 'text' ||
                  sourceNode.type === 'llm' ||
                  sourceNode.type === 'textSplit' ||
                  sourceNode.type === 'image' ||
                  sourceNode.type === 'character' ||
                  sourceNode.type === 'storyboardScript')
              ) {
                const textSourceEdges = updatedEdges.filter((e) => {
                  if (e.target !== params.target) return false;
                  const src = nds.find((n) => n.id === e.source);
                  return (
                    src &&
                    (src.type === 'minimalistText' ||
                      src.type === 'text' ||
                      src.type === 'llm' ||
                      src.type === 'textSplit' ||
                      src.type === 'image' ||
                      src.type === 'storyboardScript')
                  );
                });
                const imageSourceEdges = updatedEdges.filter((e) => {
                  if (e.target !== params.target) return false;
                  const src = nds.find((n) => n.id === e.source);
                  if (src?.type === 'image') return true;
                  if (src?.type === 'character') {
                    const sh = e.sourceHandle || '';
                    return sh !== CHARACTER_OUTPUT_AUDIO_HANDLE && sh !== 'output-audio';
                  }
                  return false;
                });
                const parts: string[] = [];
                for (const edge of textSourceEdges) {
                  const src = nds.find((n) => n.id === edge.source);
                  if (!src) continue;
                  if (src.type === 'minimalistText' || src.type === 'text') {
                    if (src.data?.text) parts.push(String(src.data.text).trim());
                  } else if (src.type === 'llm' && src.data?.outputText) {
                    parts.push(String(src.data.outputText).trim());
                  } else if (src.type === 'textSplit') {
                    const segText = pickTextSplitSegmentText(src.data, 
                      edge.sourceHandle,
                    );
                    if (segText) parts.push(segText);
                  } else if (src.type === 'storyboardScript') {
                    const sbPrompt = pickStoryboardScriptPromptsForDownstream(src, 'image');
                    if (sbPrompt) parts.push(sbPrompt);
                  } else if (src.type === 'image') {
                    const pp = src.data?.prompt_payload as { qwen_instruction?: string; prompt_metadata?: { formatted_output?: string }; full_camera_prompt?: string; camera_tags?: string } | undefined;
                    const cameraPrompt = pp?.qwen_instruction || pp?.prompt_metadata?.formatted_output || pp?.full_camera_prompt || pp?.camera_tags || '';
                    if (cameraPrompt) parts.push(String(cameraPrompt).trim());
                  }
                }
                // 连线有输入则优先用连线，否则保留节点已有数据（含复制出的信息）
                const targetNodeData = nds.find((n) => n.id === params.target)?.data;
                const promptText = parts.length > 0 ? parts.join(',') : (targetNodeData?.prompt as string || '');
                const collectedImages: string[] = [];
                imageSourceEdges.forEach((edge) => {
                  const src = nds.find((n) => n.id === edge.source);
                  if (src?.type === 'character') {
                    for (const u of getCharacterTransmitImageUrls(src.data as Record<string, unknown>)) {
                      if (u && !collectedImages.includes(u)) collectedImages.push(u);
                    }
                    return;
                  }
                  if (src?.type === 'image') {
                    const u =
                      pickPreviewFromEdgeOrNode(edge, src.data) ||
                      (src.data?.outputImage as string) ||
                      (typeof src.data?.avatar === 'string' ? src.data.avatar.trim() : '') ||
                      (src.data?.originalImageUrl as string) ||
                      (src.data?.inputImages as string[])?.[0];
                    if (u && !collectedImages.includes(u)) collectedImages.push(u);
                  }
                });
                const newInputImages = collectedImages.length > 0
                  ? collectedImages.slice(0, 10)
                  : ((targetNodeData?.inputImages as string[] | undefined) || []);
                const updatedNodes = nds.map((node) => {
                  if (node.id === params.target) {
                    return {
                      ...node,
                      data: {
                        ...node.data,
                        prompt: promptText,
                        inputImages: newInputImages,
                      },
                    };
                  }
                  return node;
                });
                if (selectedNode && selectedNode.id === params.target) {
                  setTimeout(() => {
                    setImageInputPanelData((prev) => {
                      if (prev && prev.nodeId === params.target) {
                        return { ...prev, prompt: promptText, inputImages: newInputImages };
                      }
                      return prev;
                    });
                  }, 0);
                }
                return updatedNodes;
              } else if (sourceNode && sourceNode.type === 'image') {
                // Image 连接到 Image：收集输入图片，切换到图生图模式（含来自角色节点的 avatar 入边）
                const incomingEdges = updatedEdges.filter((e) => {
                  if (e.target !== params.target) return false;
                  const src = nds.find((n) => n.id === e.source);
                  if (src?.type === 'image') return true;
                  if (src?.type === 'character') {
                    const sh = e.sourceHandle || '';
                    return sh !== CHARACTER_OUTPUT_AUDIO_HANDLE && sh !== 'output-audio';
                  }
                  return false;
                });
                const collectedImages: string[] = [];
                incomingEdges.forEach((edge) => {
                  const edgeSourceNode = nds.find((n) => n.id === edge.source);
                  if (edgeSourceNode?.type === 'character') {
                    for (const u of getCharacterTransmitImageUrls(edgeSourceNode.data as Record<string, unknown>)) {
                      if (u && !collectedImages.includes(u)) collectedImages.push(u);
                    }
                    return;
                  }
                  if (edgeSourceNode && edgeSourceNode.type === 'image') {
                    const imgUrl =
                      pickPreviewFromEdgeOrNode(edge, edgeSourceNode.data) ||
                      pickPreviewUrl(buildDualImageAssetFromNodeData(edgeSourceNode.data));
                    if (imgUrl && !collectedImages.includes(imgUrl)) {
                      collectedImages.push(imgUrl);
                    }
                  }
                });
                // 连线有输入则优先用连线，否则保留节点已有数据（含复制出的信息）
                const targetNodeData = nds.find((n) => n.id === params.target)?.data;
                const newInputImages = collectedImages.length > 0
                  ? collectedImages.slice(0, 10)
                  : ((targetNodeData?.inputImages as string[] | undefined) || []);

                // 更新目标节点的输入图片列表（参考图仅进 inputImages，不写 outputImage）
                const updatedNodes = nds.map((node) => {
                  if (node.id === params.target) {
                    return {
                      ...node,
                      data: {
                        ...node.data,
                        inputImages: newInputImages,
                      },
                    };
                  }
                  return node;
                });
                
                // 如果目标节点当前被选中，更新输入面板数据
                setTimeout(() => {
                  if (selectedNode && selectedNode.id === params.target) {
                    setImageInputPanelData((prev) => {
                      if (prev && prev.nodeId === params.target) {
                        return {
                          ...prev,
                          inputImages: newInputImages,
                        };
                      }
                      return prev;
                    });
                  }
                }, 0);
                
                return updatedNodes;
              } else if (sourceNode && isVideoReferenceOutputSource(sourceNode, params.sourceHandle)) {
                const videoUrl = pickReferenceVideoFromSourceNode(sourceNode, params.sourceHandle);
                if (!videoUrl) return nds;
                const normalizedUrl = normalizeVideoUrl(videoUrl);
                const targetId = params.target;
                const t = resolveVideoStillCaptureTimeSec(sourceNode);
                const cachedLast = getVideoLastFrame(normalizedUrl) || getVideoLastFrame(videoUrl);
                const cKey = videoStillCoalesceKey(normalizedUrl, t);

                let entry = videoStillCoalesceByKey.get(cKey);
                if (!entry) {
                  const targetIds = new Set<string>();
                  entry = {
                    targetIds,
                    promise: extractVideoFrameAtTime(videoUrl, t).finally(() => {
                      videoStillCoalesceByKey.delete(cKey);
                    }),
                  };
                  videoStillCoalesceByKey.set(cKey, entry);
                }
                entry.targetIds.add(targetId);

                void entry.promise.then((res) => {
                  const ids = Array.from(entry!.targetIds);
                  const applyStill = (dataUrl: string) => {
                    setNodes((n) =>
                      n.map((node) =>
                        ids.includes(node.id)
                          ? {
                              ...node,
                              data: {
                                ...node.data,
                                outputImage: dataUrl,
                                originalImageUrl: dataUrl,
                                inputImages: [dataUrl],
                                errorMessage: undefined,
                                progressMessage: undefined,
                              },
                            }
                          : node
                      )
                    );
                    if (selectedNode && ids.includes(selectedNode.id)) {
                      setImageInputPanelData((prev) =>
                        prev && ids.includes(prev.nodeId) ? { ...prev, inputImages: [dataUrl] } : prev
                      );
                    }
                  };
                  if (res.success && res.imageUrl) {
                    applyStill(res.imageUrl);
                    return;
                  }
                  if (cachedLast) {
                    applyStill(cachedLast);
                    return;
                  }
                  const msg = res.error || '从视频截取画面失败';
                  setNodes((n) =>
                    n.map((node) =>
                      ids.includes(node.id)
                        ? { ...node, data: { ...node.data, errorMessage: msg, progressMessage: undefined } }
                        : node
                    )
                  );
                });

                return nds.map((node) =>
                  node.id === targetId
                    ? {
                        ...node,
                        data: {
                          ...node.data,
                          progressMessage: '正在从视频提取画面…',
                          errorMessage: undefined,
                        },
                      }
                    : node
                );
              }
            }

            // Video / 视频换人：image -> 参考图，text/LLM -> 提示词
            if (targetNode && isVideoModuleNodeType(targetNode.type)) {
              if (sourceNode && sourceNode.type === 'image' && buildDualImageAssetFromNodeData(sourceNode.data)) {
                const imageUrl = pickPreviewUrl(buildDualImageAssetFromNodeData(sourceNode.data));
                
                // 检查图片 URL 是否需要上传到 runninghub
                // 如果是本地文件（local-resource:// 或 file://），需要上传获取 view URL
                // 如果已经是 runninghub view URL，直接使用
                const isLocalFile = imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://');
                const isRunningHubViewUrl = imageUrl.includes('www.runninghub.cn/view');
                
                // 异步处理图片上传（如果是本地文件）
                if (isLocalFile && !isRunningHubViewUrl && window.electronAPI) {
                  // 显示上传状态（可选）
                  console.log('[Workspace] 检测到本地图片，开始上传到 runninghub...');
                  
                  // 异步上传图片
                  window.electronAPI.uploadImageToRunningHub(imageUrl)
                    .then((result) => {
                      if (result.success && result.url) {
                        const viewUrl = result.url;
                        console.log('[Workspace] 图片上传成功，view URL:', viewUrl);
                        
                        // 更新节点数据，使用上传后的 view URL
                        setNodes((nds) => {
                          return nds.map((node) => {
                            if (node.id === params.target) {
                              const existingImages = (node.data?.inputImages || []) as string[];
                              // 替换原来的本地 URL 为 view URL
                              const updatedImages = existingImages.map((img) => 
                                img === imageUrl ? viewUrl : img
                              );
                              // 如果 view URL 不在列表中，添加它
                              const nextImages = updatedImages.includes(viewUrl)
                                ? updatedImages
                                : [...updatedImages, viewUrl].slice(0, 10);
                              
                              return {
                                ...node,
                                data: {
                                  ...node.data,
                                  inputImages: nextImages,
                                },
                              };
                            }
                            return node;
                          });
                        });
                        
                        // 如果目标节点当前被选中，更新输入面板数据
                        if (selectedNode && selectedNode.id === params.target) {
                          setVideoInputPanelData((prev) => {
                            if (prev && prev.nodeId === params.target) {
                              const existingImages = prev.inputImages || [];
                              const updatedImages = existingImages.map((img) => 
                                img === imageUrl ? viewUrl : img
                              );
                              const nextImages = updatedImages.includes(viewUrl)
                                ? updatedImages
                                : [...updatedImages, viewUrl].slice(0, 10);
                              return {
                                ...prev,
                                inputImages: nextImages,
                              };
                            }
                            return prev;
                          });
                        }
                      }
                    })
                    .catch((error) => {
                      console.error('[Workspace] 图片上传失败:', error);
                      // 即使上传失败，也使用原始 URL（让 VideoProvider 处理）
                    });
                }
                
                // 立即更新节点数据（使用原始 URL，上传成功后会替换）
                const updatedNodes = nds.map((node) => {
                  if (node.id === params.target) {
                    const existingImages = (node.data?.inputImages || []) as string[];
                    const nextImages = existingImages.includes(imageUrl)
                      ? existingImages
                      : [...existingImages, imageUrl].slice(0, 10);
                    
                    return {
                      ...node,
                      data: {
                        ...node.data,
                        inputImages: nextImages,
                      },
                    };
                  }
                  return node;
                });
                
                // 如果目标节点当前被选中，更新输入面板数据
                setTimeout(() => {
                  if (selectedNode && selectedNode.id === params.target) {
                    setVideoInputPanelData((prev) => {
                      if (prev && prev.nodeId === params.target) {
                        const existingImages = prev.inputImages || [];
                        const nextImages = existingImages.includes(imageUrl)
                          ? existingImages
                          : [...existingImages, imageUrl].slice(0, 10);
                        return {
                          ...prev,
                          inputImages: nextImages,
                        };
                      }
                      return prev;
                    });
                  }
                }, 0);
                
                return updatedNodes;
              }

              if (sourceNode && sourceNode.type === 'character') {
                const fromEdges = collectVideoTargetInputImagesFromEdges(
                  params.target!,
                  nds,
                  updatedEdges,
                );
                const cur =
                  (nds.find((n) => n.id === params.target)?.data?.inputImages as string[] | undefined) || [];
                const newInputImages = mergeInputImagesPreserveOrder(cur, fromEdges);
                if (newInputImages.length === 0) return nds;
                for (const imageUrl of newInputImages) {
                  const isLocalFile =
                    imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://');
                  const isRunningHubViewUrl = imageUrl.includes('www.runninghub.cn/view');
                  if (isLocalFile && !isRunningHubViewUrl && window.electronAPI) {
                    window.electronAPI
                      .uploadImageToRunningHub(imageUrl)
                      .then((result) => {
                        if (result.success && result.url) {
                          const viewUrl = result.url;
                          setNodes((nds2) =>
                            nds2.map((node) => {
                              if (node.id === params.target) {
                                const existingImages = (node.data?.inputImages || []) as string[];
                                const updatedImages = existingImages.map((img) =>
                                  img === imageUrl ? viewUrl : img,
                                );
                                return { ...node, data: { ...node.data, inputImages: updatedImages } };
                              }
                              return node;
                            }),
                          );
                          if (selectedNode && selectedNode.id === params.target) {
                            setVideoInputPanelData((prev) => {
                              if (prev && prev.nodeId === params.target) {
                                const existingImages = prev.inputImages || [];
                                const updatedImages = existingImages.map((img) =>
                                  img === imageUrl ? viewUrl : img,
                                );
                                return { ...prev, inputImages: updatedImages };
                              }
                              return prev;
                            });
                          }
                        }
                      })
                      .catch((error) => {
                        console.error('[Workspace] 角色参考图上传失败:', error);
                      });
                  }
                }
                const updatedNodes = nds.map((node) => {
                  if (node.id === params.target) {
                    return { ...node, data: { ...node.data, inputImages: newInputImages } };
                  }
                  return node;
                });
                setTimeout(() => {
                  if (selectedNode && selectedNode.id === params.target) {
                    setVideoInputPanelData((prev) => {
                      if (prev && prev.nodeId === params.target) {
                        return { ...prev, inputImages: newInputImages };
                      }
                      return prev;
                    });
                  }
                }, 0);
                return updatedNodes;
              }

              if (
                sourceNode &&
                (sourceNode.type === 'minimalistText' ||
                  sourceNode.type === 'text' ||
                  sourceNode.type === 'llm' ||
                  sourceNode.type === 'textSplit' ||
                  sourceNode.type === 'storyboardScript')
              ) {
                let textToPass = '';
                if (sourceNode.type === 'minimalistText' || sourceNode.type === 'text') {
                  textToPass = sourceNode.data?.text || '';
                } else if (sourceNode.type === 'llm') {
                  textToPass = sourceNode.data?.outputText || '';
                } else if (sourceNode.type === 'textSplit') {
                  textToPass = pickTextSplitSegmentText(sourceNode.data, 
                    params.sourceHandle,
                  );
                } else if (sourceNode.type === 'storyboardScript') {
                  textToPass = pickStoryboardScriptPromptsForDownstream(sourceNode, 'video');
                }

                const updatedNodes = nds.map((node) => {
                  if (node.id === params.target) {
                    return {
                      ...node,
                      data: {
                        ...node.data,
                        prompt: textToPass,
                      },
                    };
                  }
                  return node;
                });
                return updatedNodes;
              }

              if (sourceNode?.type === 'digitalHuman') {
                const patch: Record<string, unknown> = {};
                if (isDigitalHumanVideoOutputHandle(params.sourceHandle)) {
                  const ref = pickDigitalHumanVideoUrl(sourceNode.data as Record<string, unknown>);
                  if (ref) patch.referenceVideoUrl = ref;
                }
                if (isDigitalHumanAudioOutputHandle(params.sourceHandle)) {
                  const aud = pickDigitalHumanAudioUrl(sourceNode.data as Record<string, unknown>);
                  if (aud) patch.inputAudioUrl = aud;
                }
                if (Object.keys(patch).length === 0) return nds;
                const updatedNodes = nds.map((node) =>
                  node.id === params.target ? { ...node, data: { ...node.data, ...patch } } : node,
                );
                if (selectedNode && selectedNode.id === params.target) {
                  setVideoInputPanelData((prev) =>
                    prev && prev.nodeId === params.target ? { ...prev, ...patch } : prev,
                  );
                }
                return updatedNodes;
              }
            }

            // 文本节点：接入音/视频时，准备本地转写所需音源 URL（按钮和语言选项会在 Text 节点顶部出现）
            if (targetNode && targetNode.type === 'minimalistText' && sourceNode && (sourceNode.type === 'audio' || isVideoReferenceOutputSource(sourceNode, params.sourceHandle))) {
              if (sourceNode.type === 'audio') {
                const d = sourceNode.data as Record<string, unknown>;
                const url = typeof (d.outputAudio ?? d.originalAudioUrl ?? d.referenceAudioUrl) === 'string'
                  ? String(d.outputAudio ?? d.originalAudioUrl ?? d.referenceAudioUrl).trim()
                  : '';
                if (url) {
                  return nds.map((node) =>
                    node.id === params.target
                      ? {
                          ...node,
                          data: {
                            ...node.data,
                            transcribeAudioUrl: url,
                            transcribeStatus: 'idle',
                            transcribeErrorMessage: undefined,
                          },
                        }
                      : node
                  );
                }
              } else {
                const videoUrl = pickReferenceVideoFromSourceNode(sourceNode, params.sourceHandle);
                if (videoUrl && window.electronAPI?.extractAudioFromVideo) {
                  const targetId = params.target;
                  window.electronAPI
                    .extractAudioFromVideo(projectId || undefined, videoUrl)
                    .then((res) => {
                      if (!res?.audioUrl) return;
                      setNodes((n) =>
                        n.map((node) =>
                          node.id === targetId
                            ? {
                                ...node,
                                data: {
                                  ...node.data,
                                  transcribeAudioUrl: res.audioUrl,
                                  transcribeStatus: 'idle',
                                  transcribeErrorMessage: undefined,
                                  updatedAt: Date.now(),
                                },
                              }
                            : node
                        )
                      );
                    })
                    .catch((err) => {
                      setNodes((n) =>
                        n.map((node) =>
                          node.id === targetId
                            ? {
                                ...node,
                                data: {
                                  ...node.data,
                                  transcribeStatus: 'ERROR',
                                  transcribeErrorMessage: err?.message || '提取失败',
                                },
                              }
                            : node
                        )
                      );
                    });
                }
              }
            }

            // 文本节点：接受文本拆分模块的输出，写入 data.text
            if (
              targetNode &&
              (targetNode.type === 'minimalistText' || targetNode.type === 'text') &&
              sourceNode &&
              sourceNode.type === 'textSplit'
            ) {
              const textToPass = pickTextSplitSegmentText(sourceNode.data, params.sourceHandle);
              return nds.map((node) =>
                node.id === params.target ? { ...node, data: { ...node.data, text: textToPass } } : node
              );
            }

            // 剧本节点：上游文本灌入 text
            if (
              targetNode &&
              targetNode.type === 'script' &&
              (sourceNode?.type === 'minimalistText' ||
                sourceNode?.type === 'text' ||
                sourceNode?.type === 'llm' ||
                sourceNode?.type === 'textSplit')
            ) {
              let textToPass = '';
              if (sourceNode.type === 'minimalistText' || sourceNode.type === 'text') {
                textToPass = String(sourceNode.data?.text || '').trim();
              } else if (sourceNode.type === 'llm') {
                textToPass = String(sourceNode.data?.outputText || sourceNode.data?.text || '').trim();
              } else if (sourceNode.type === 'textSplit') {
                textToPass = pickTextSplitSegmentText(sourceNode.data, params.sourceHandle);
              }
              if (textToPass) {
                return nds.map((node) =>
                  node.id === params.target ? { ...node, data: { ...node.data, text: textToPass } } : node,
                );
              }
            }

            // 导演节点：剧本 / 文本上游灌入 director.scriptText
            if (
              targetNode &&
              targetNode.type === 'director' &&
              (sourceNode?.type === 'script' ||
                sourceNode?.type === 'minimalistText' ||
                sourceNode?.type === 'text' ||
                sourceNode?.type === 'llm' ||
                sourceNode?.type === 'textSplit')
            ) {
              let textToPass = '';
              if (sourceNode.type === 'script' || sourceNode.type === 'minimalistText' || sourceNode.type === 'text') {
                textToPass = String(sourceNode.data?.text || '').trim();
              } else if (sourceNode.type === 'llm') {
                textToPass = String(sourceNode.data?.outputText || sourceNode.data?.text || '').trim();
              } else if (sourceNode.type === 'textSplit') {
                textToPass = pickTextSplitSegmentText(sourceNode.data, params.sourceHandle);
              }
              if (textToPass) {
                if (selectedNode && selectedNode.id === params.target) {
                  setDirectorInputPanelData((prev) =>
                    prev && prev.nodeId === params.target
                      ? { ...prev, scriptText: textToPass }
                      : prev,
                  );
                }
                return nds.map((node) => {
                  if (node.id !== params.target) return node;
                  const prev = createDefaultDirectorPipelineState(
                    (node.data as { director?: DirectorPipelineState })?.director || {},
                  );
                  const next = createDefaultDirectorPipelineState({ ...prev, scriptText: textToPass });
                  return {
                    ...node,
                    data: { ...node.data, director: next, title: next.title || node.data?.title },
                  };
                });
              }
            }

            // 导演节点：音频上游灌入 mvMusic（接入后切到 MV）
            // 注意：不在 setEdges 的 setNodes 嵌套里直接写死，改用 microtask 函数式合并，
            // 避免与导演节点 onUpdate 旧包互相覆盖导致「闪一下又没了」
            if (targetNode && targetNode.type === 'director' && sourceNode?.type === 'audio') {
              const url = pickAudioOutputUrlFromAudioNodeData(
                sourceNode.data as Record<string, unknown>,
              );
              if (url) {
                const title = resolveAudioNodeDisplayTitle(
                  sourceNode.data as Record<string, unknown>,
                  'MV音乐',
                );
                const mediaDur = Number(sourceNode.data?.mediaDurationSec);
                const durationSec =
                  Number.isFinite(mediaDur) && mediaDur > 0 ? mediaDur : 0;
                const targetId = params.target!;
                const sourceId = sourceNode.id;
                queueMicrotask(() => {
                  applyDirectorMvMusicFromAudio(targetId, {
                    url,
                    title,
                    durationSec,
                    sourceNodeId: sourceId,
                  });
                  if (!(durationSec > 0)) {
                    void probeHtmlAudioDurationSec(url).then((dur) => {
                      if (!(dur > 0)) return;
                      applyDirectorMvMusicFromAudio(targetId, {
                        url,
                        title,
                        durationSec: dur,
                        sourceNodeId: sourceId,
                      });
                    });
                  }
                });
              }
            }

            // 导演 → 视频：灌入已合成的最终提示词（多镜拼接）与资产参考图
            if (
              targetNode &&
              isVideoModuleNodeType(targetNode.type) &&
              sourceNode?.type === 'director'
            ) {
              const director = createDefaultDirectorPipelineState(
                (sourceNode.data as { director?: DirectorPipelineState })?.director || {},
              );
              const prompts = (director.shots || [])
                .map((s) => String(s['最终提示词'] || '').trim())
                .filter(Boolean);
              const textToPass = prompts.join('\n\n');
              const inputImages = getOrderedAssetsWithImages(director).map((a) => a.imageUrl).filter(Boolean);
              return nds.map((node) => {
                if (node.id !== params.target) return node;
                return {
                  ...node,
                  data: {
                    ...node.data,
                    ...(textToPass ? { prompt: textToPass } : {}),
                    ...(inputImages.length > 0 ? { inputImages } : {}),
                    model: node.data?.model || 'seedance-2.0-fast',
                  },
                };
              });
            }

            // LLM 节点：按连线顺序收集所有文本来源（Text/LLM/文本拆分），用逗号拼接后写入 inputText
            if (targetNode && targetNode.type === 'llm' && (sourceNode?.type === 'minimalistText' || sourceNode?.type === 'text' || sourceNode?.type === 'llm' || sourceNode?.type === 'textSplit' || sourceNode?.type === 'audioTranscribe')) {
              const incoming = updatedEdges.filter((e) => e.target === params.target);
              const textSourceEdges = incoming.filter((e) => {
                const src = nds.find((n) => n.id === e.source);
                return src && (src.type === 'minimalistText' || src.type === 'text' || src.type === 'llm' || src.type === 'textSplit' || src.type === 'audioTranscribe');
              });
              const parts: string[] = [];
              for (const edge of textSourceEdges) {
                const src = nds.find((n) => n.id === edge.source);
                if (!src) continue;
                if (src.type === 'minimalistText' || src.type === 'text') {
                  if (src.data?.text) parts.push(String(src.data.text).trim());
                } else if (src.type === 'llm' && src.data?.outputText) {
                  parts.push(String(src.data.outputText).trim());
                } else if (src.type === 'audioTranscribe' && src.data?.text) {
                  parts.push(String(src.data.text).trim());
                } else if (src.type === 'textSplit') {
                  const segText = pickTextSplitSegmentText(src.data, edge.sourceHandle);
                  if (segText) parts.push(segText);
                }
              }
              const resolvedInputText = parts.join(',');
              const updatedNodes = nds.map((node) =>
                node.id === params.target ? { ...node, data: { ...node.data, inputText: resolvedInputText } } : node
              );
              if (selectedNode && selectedNode.id === params.target) {
                const hasSplitConnection = textSourceEdges.some((e) => {
                  const src = nds.find((n) => n.id === e.source);
                  return src?.type === 'textSplit';
                });
                const hasTextConnection = textSourceEdges.some((e) => {
                  const src = nds.find((n) => n.id === e.source);
                  return src && (src.type === 'minimalistText' || src.type === 'text');
                });
                const hasLLMConnection = textSourceEdges.some((e) => {
                  const src = nds.find((n) => n.id === e.source);
                  return src?.type === 'llm' && !!src.data?.outputText;
                });
                setLlmInputPanelData((prev) =>
                  prev && prev.nodeId === params.target
                    ? {
                        ...prev,
                        inputText: resolvedInputText,
                        isInputLocked: false,
                        hasLinkedText:
                          (hasTextConnection || hasLLMConnection || hasSplitConnection) && !!resolvedInputText,
                        linkedInputText: resolvedInputText,
                        linkedTextTitle: collectLinkedTextTitlesForTarget(
                          params.target,
                          updatedNodes,
                          updatedEdges,
                        ),
                      }
                    : prev
                );
              }
              return updatedNodes;
            }

            // Audio 节点：处理 text/llm/文本拆分 -> audio 传递文本，或 audio -> audio 传递参考音
            if (targetNode && targetNode.type === 'audio') {
              if (
                sourceNode &&
                (sourceNode.type === 'minimalistText' ||
                  sourceNode.type === 'text' ||
                  sourceNode.type === 'llm' ||
                  sourceNode.type === 'textSplit' ||
                  sourceNode.type === 'audioTranscribe')
              ) {
                let textToPass = '';
                if (sourceNode.type === 'minimalistText' || sourceNode.type === 'text') {
                  textToPass = sourceNode.data?.text || '';
                } else if (sourceNode.type === 'llm') {
                  textToPass = sourceNode.data?.outputText || '';
                } else if (sourceNode.type === 'audioTranscribe') {
                  textToPass = sourceNode.data?.text || '';
                } else if (sourceNode.type === 'textSplit') {
                  textToPass = pickTextSplitSegmentText(sourceNode.data, 
                    params.sourceHandle,
                  );
                }
                const isRhartSong = isAudioSongModel(targetNode.data?.model);
                const updatedNodes = nds.map((node) => {
                  if (node.id === params.target) {
                    return {
                      ...node,
                      data: {
                        ...node.data,
                        ...(isRhartSong ? { lyrics: textToPass } : { text: textToPass }),
                      },
                    };
                  }
                  return node;
                });
                if (selectedNode && selectedNode.id === params.target) {
                  setAudioInputPanelData((prev) => {
                    if (prev && prev.nodeId === params.target) {
                      return isRhartSong
                        ? { ...prev, lyrics: textToPass, isTextConnected: true }
                        : { ...prev, text: textToPass, isTextConnected: true };
                    }
                    return prev;
                  });
                }
                return updatedNodes;
              }
              // video / 视频换人 -> audio：用 ffmpeg 提取音频，写入 outputAudio 供播放
              // 注意：不可在 setNodes updater 内再嵌套 setNodes，否则 PROCESSING/SUCCESS 可能被覆盖
              if (sourceNode && isVideoReferenceOutputSource(sourceNode, params.sourceHandle)) {
                const videoUrl = pickReferenceVideoFromSourceNode(sourceNode, params.sourceHandle);
                const targetId = params.target!;
                if (!videoUrl) {
                  return nds.map((node) =>
                    node.id === targetId
                      ? {
                          ...node,
                          data: {
                            ...node.data,
                            aiStatus: 'ERROR',
                            errorMessage: '视频节点没有可提取的视频文件（请等待生成完成或重新导入）',
                          },
                        }
                      : node,
                  );
                }
                if (window.electronAPI?.extractAudioFromVideo) {
                  console.log('[AudioExtract] 识别到视频源，开始提取音频:', videoUrl);
                  const pid = projectId || undefined;
                  queueMicrotask(() => {
                    window.electronAPI!
                      .extractAudioFromVideo(pid, videoUrl)
                      .then((res) => {
                        if (!res?.audioUrl) {
                          setNodes((n) =>
                            n.map((node) =>
                              node.id === targetId
                                ? {
                                    ...node,
                                    data: {
                                      ...node.data,
                                      errorMessage: '提取音频未返回结果',
                                      aiStatus: 'ERROR',
                                    },
                                  }
                                : node,
                            ),
                          );
                          return;
                        }
                        setNodes((n) =>
                          n.map((node) =>
                            node.id === targetId
                              ? {
                                  ...node,
                                  data: {
                                    ...node.data,
                                    outputAudio: res.audioUrl,
                                    originalAudioUrl: res.audioUrl,
                                    aiStatus: 'SUCCESS',
                                    errorMessage: undefined,
                                    updatedAt: Date.now(),
                                  },
                                }
                              : node,
                          ),
                        );
                      })
                      .catch((err) => {
                        console.error('[AudioExtract] 提取失败:', err);
                        setNodes((n) =>
                          n.map((node) =>
                            node.id === targetId
                              ? {
                                  ...node,
                                  data: {
                                    ...node.data,
                                    errorMessage: err?.message || '提取失败',
                                    aiStatus: 'ERROR',
                                  },
                                }
                              : node,
                          ),
                        );
                      });
                  });
                  return nds.map((node) =>
                    node.id === targetId
                      ? {
                          ...node,
                          data: {
                            ...node.data,
                            aiStatus: 'PROCESSING',
                            errorMessage: undefined,
                          },
                        }
                      : node,
                  );
                }
                return nds.map((node) =>
                  node.id === targetId
                    ? {
                        ...node,
                        data: {
                          ...node.data,
                          aiStatus: 'ERROR',
                          errorMessage: '当前环境不支持提取音频',
                        },
                      }
                    : node,
                );
              }
              // audio -> audio：按全部 audio 入边重建参考音 / 翻唱双路输入
              if (sourceNode && sourceNode.type === 'audio') {
                const patch = buildAudioIncomingPatchFromEdges(
                  params.target!,
                  nds,
                  updatedEdges,
                  targetNode.data as Record<string, unknown>,
                );
                if (patch) {
                  const updatedNodes = nds.map((node) =>
                    node.id === params.target ? { ...node, data: { ...node.data, ...patch } } : node,
                  );
                  if (selectedNode && selectedNode.id === params.target) {
                    setAudioInputPanelData((prev) =>
                      prev && prev.nodeId === params.target
                        ? {
                            ...prev,
                            ...patch,
                            isAudioConnected: !!(patch.referenceAudioUrl || '').trim(),
                            isSourceSongConnected: !!(patch.sourceSongAudioUrl || '').trim(),
                          }
                        : prev,
                    );
                  }
                  const urlsToUpload = [patch.sourceSongAudioUrl, patch.referenceAudioUrl].filter(
                    (u): u is string => !!u && (u.startsWith('local-resource://') || u.startsWith('file://')),
                  );
                  if (urlsToUpload.length > 0 && window.electronAPI?.uploadLocalAudioToOSS) {
                    Promise.all(urlsToUpload.map((u) => window.electronAPI!.uploadLocalAudioToOSS!(u))).then((results) => {
                      const urlMap = new Map<string, string>();
                      urlsToUpload.forEach((local, i) => {
                        const res = results[i];
                        if (res?.success && res.url) urlMap.set(local, res.url);
                      });
                      if (urlMap.size === 0) return;
                      setNodes((n) =>
                        n.map((node) => {
                          if (node.id !== params.target) return node;
                          const d = { ...node.data } as Record<string, unknown>;
                          if (typeof d.sourceSongAudioUrl === 'string' && urlMap.has(d.sourceSongAudioUrl)) {
                            d.sourceSongAudioUrl = urlMap.get(d.sourceSongAudioUrl);
                          }
                          if (typeof d.referenceAudioUrl === 'string' && urlMap.has(d.referenceAudioUrl)) {
                            d.referenceAudioUrl = urlMap.get(d.referenceAudioUrl);
                          }
                          return { ...node, data: d };
                        }),
                      );
                      setAudioInputPanelData((prev) => {
                        if (!prev || prev.nodeId !== params.target) return prev;
                        const next = { ...prev };
                        if (next.sourceSongAudioUrl && urlMap.has(next.sourceSongAudioUrl)) {
                          next.sourceSongAudioUrl = urlMap.get(next.sourceSongAudioUrl)!;
                        }
                        if (next.referenceAudioUrl && urlMap.has(next.referenceAudioUrl)) {
                          next.referenceAudioUrl = urlMap.get(next.referenceAudioUrl)!;
                        }
                        return next;
                      });
                    });
                  }
                  return updatedNodes;
                }
              }
              // 数字人源模块 -> Audio：参考音
              if (sourceNode && sourceNode.type === 'digitalHuman' && targetNode?.type === 'audio') {
                const refUrl = pickDigitalHumanAudioUrl(sourceNode.data as Record<string, unknown>);
                if (refUrl) {
                  const isLocalRef = refUrl.startsWith('local-resource://') || refUrl.startsWith('file://');
                  const updatedNodes = nds.map((node) => {
                    if (node.id !== params.target) return node;
                    const d = { ...node.data, referenceAudioUrl: refUrl } as Record<string, unknown>;
                    if (!isAudioSongModel(d.model as string | undefined)) d.model = 'index-tts2';
                    return { ...node, data: d };
                  });
                  if (selectedNode && selectedNode.id === params.target) {
                    setAudioInputPanelData((prev) =>
                      prev && prev.nodeId === params.target
                        ? isAudioSongModel(prev.model)
                          ? { ...prev, referenceAudioUrl: refUrl }
                          : { ...prev, referenceAudioUrl: refUrl, model: 'index-tts2' }
                        : prev
                    );
                  }
                  if (isLocalRef && window.electronAPI?.uploadLocalAudioToOSS) {
                    window.electronAPI.uploadLocalAudioToOSS(refUrl).then((res) => {
                      if (res.success && res.url) {
                        setNodes((n) =>
                          n.map((node) => {
                            if (node.id !== params.target) return node;
                            const d = { ...node.data, referenceAudioUrl: res.url } as Record<string, unknown>;
                            if (!isAudioSongModel(d.model as string | undefined)) d.model = 'index-tts2';
                            return { ...node, data: d };
                          })
                        );
                        setAudioInputPanelData((prev) =>
                          prev && prev.nodeId === params.target
                            ? isAudioSongModel(prev.model)
                              ? { ...prev, referenceAudioUrl: res.url }
                              : { ...prev, referenceAudioUrl: res.url, model: 'index-tts2' }
                            : prev
                        );
                      }
                    });
                  }
                  return updatedNodes;
                }
              }
              // 角色模块 -> Audio：仅参考音
              if (sourceNode && sourceNode.type === 'character' && targetNode?.type === 'audio') {
                const refUrl = ((sourceNode.data?.voiceClip || sourceNode.data?.referenceAudioUrl) as string) || '';
                if (refUrl) {
                  const isLocalRef = refUrl.startsWith('local-resource://') || refUrl.startsWith('file://');
                  const updatedNodes = nds.map((node) => {
                    if (node.id !== params.target) return node;
                    const d = { ...node.data, referenceAudioUrl: refUrl } as Record<string, unknown>;
                    if (!isAudioSongModel(d.model as string | undefined)) d.model = 'index-tts2';
                    return { ...node, data: d };
                  });
                  if (selectedNode && selectedNode.id === params.target) {
                    setAudioInputPanelData((prev) =>
                      prev && prev.nodeId === params.target
                        ? isAudioSongModel(prev.model)
                          ? { ...prev, referenceAudioUrl: refUrl }
                          : { ...prev, referenceAudioUrl: refUrl, model: 'index-tts2' }
                        : prev
                    );
                  }
                  if (isLocalRef && window.electronAPI?.uploadLocalAudioToOSS) {
                    window.electronAPI.uploadLocalAudioToOSS(refUrl).then((res) => {
                      if (res.success && res.url) {
                        setNodes((n) =>
                          n.map((node) => {
                            if (node.id !== params.target) return node;
                            const d = { ...node.data, referenceAudioUrl: res.url } as Record<string, unknown>;
                            if (!isAudioSongModel(d.model as string | undefined)) d.model = 'index-tts2';
                            return { ...node, data: d };
                          })
                        );
                        setAudioInputPanelData((prev) =>
                          prev && prev.nodeId === params.target
                            ? isAudioSongModel(prev.model)
                              ? { ...prev, referenceAudioUrl: res.url }
                              : { ...prev, referenceAudioUrl: res.url, model: 'index-tts2' }
                            : prev
                        );
                      }
                    });
                  }
                  return updatedNodes;
                }
              }
            }
            if (targetNode && targetNode.type === 'audioTranscribe') {
              if (
                sourceNode?.type === 'digitalHuman' &&
                isDigitalHumanAudioOutputHandle(params.sourceHandle)
              ) {
                const url = pickDigitalHumanAudioUrl(sourceNode.data as Record<string, unknown>);
                if (url) {
                  return nds.map((node) =>
                    node.id === params.target
                      ? { ...node, data: { ...node.data, audioUrl: url, errorMessage: undefined, aiStatus: 'idle' } }
                      : node,
                  );
                }
              }
              if (isVideoReferenceOutputSource(sourceNode, params.sourceHandle)) {
                const videoUrl = pickReferenceVideoFromSourceNode(sourceNode, params.sourceHandle);
                const targetId = params.target!;
                if (!videoUrl) {
                  return nds.map((node) =>
                    node.id === targetId
                      ? {
                          ...node,
                          data: {
                            ...node.data,
                            aiStatus: 'ERROR',
                            errorMessage: '视频节点没有可提取的视频文件',
                          },
                        }
                      : node,
                  );
                }
                if (window.electronAPI?.extractAudioFromVideo) {
                  const pid = projectId || undefined;
                  queueMicrotask(() => {
                    window.electronAPI!
                      .extractAudioFromVideo(pid, videoUrl)
                      .then((res) => {
                        if (!res?.audioUrl) return;
                        setNodes((n) =>
                          n.map((node) =>
                            node.id === targetId
                              ? {
                                  ...node,
                                  data: {
                                    ...node.data,
                                    audioUrl: res.audioUrl,
                                    aiStatus: 'SUCCESS',
                                    errorMessage: undefined,
                                    updatedAt: Date.now(),
                                  },
                                }
                              : node,
                          ),
                        );
                      })
                      .catch((err) => {
                        setNodes((n) =>
                          n.map((node) =>
                            node.id === targetId
                              ? {
                                  ...node,
                                  data: {
                                    ...node.data,
                                    aiStatus: 'ERROR',
                                    errorMessage: err?.message || '提取失败',
                                  },
                                }
                              : node,
                          ),
                        );
                      });
                  });
                  return nds.map((node) =>
                    node.id === targetId
                      ? {
                          ...node,
                          data: {
                            ...node.data,
                            aiStatus: 'PROCESSING',
                            errorMessage: undefined,
                          },
                        }
                      : node,
                  );
                }
                return nds;
              }
              if (sourceNode?.type === 'audio') {
                const d = sourceNode.data as Record<string, unknown>;
                const url = pickAudioOutputUrlFromAudioNodeData(d) || '';
                if (url) {
                  const updated = nds.map((node) =>
                    node.id === params.target ? { ...node, data: { ...node.data, audioUrl: url, errorMessage: undefined } } : node
                  );
                  return updated;
                }
              }
            }

            // Character 节点：处理 Video -> Character 连接，将源 Video 的网络 URL 传递到目标 Character 的 videoUrl
            if (targetNode && targetNode.type === 'character') {
              if (sourceNode && isVideoTrackSourceNodeType(sourceNode.type)) {
                // 优先使用 originalVideoUrl（网络 URL），如果没有则使用 outputVideo
                // 如果 outputVideo 是本地路径，自动上传到 OSS
                let videoUrlToPass = '';
                let needsUpload = false;
                let localVideoPath = '';
                
                if (sourceNode.data?.originalVideoUrl) {
                  // 优先使用原始网络 URL
                  videoUrlToPass = sourceNode.data.originalVideoUrl as string;
                } else if (sourceNode.data?.outputVideo) {
                  const outputVideo = sourceNode.data.outputVideo as string;
                  // 如果是网络 URL（http/https），直接使用
                  if (outputVideo.startsWith('http://') || outputVideo.startsWith('https://')) {
                    videoUrlToPass = outputVideo;
                  } else if (outputVideo.startsWith('local-resource://') || outputVideo.startsWith('file://')) {
                    // 如果是本地路径，需要上传到 OSS
                    needsUpload = true;
                    localVideoPath = outputVideo;
                    console.log('[Workspace] 检测到本地视频路径，准备上传到 OSS:', localVideoPath);
                  } else {
                    // 其他格式，直接使用
                    videoUrlToPass = outputVideo;
                  }
                }
                
                // 如果已经有网络 URL（OSS 公网 URL），直接使用
                if (videoUrlToPass && (videoUrlToPass.startsWith('http://') || videoUrlToPass.startsWith('https://'))) {
                  // 更新节点数据，使用网络 URL
                  const updatedNodes = nds.map((node) => {
                    if (node.id === params.target) {
                      return {
                        ...node,
                        data: {
                          ...node.data,
                          videoUrl: videoUrlToPass, // 使用 OSS 公网 URL
                          needsUpload: false, // 不需要上传
                          localVideoPath: undefined, // 清除本地路径
                          timestamp: node.data?.timestamp || '1,3',
                        },
                      };
                    }
                    return node;
                  });
                  
                  // 如果目标节点当前被选中，更新输入面板数据
                  if (selectedNode && selectedNode.id === params.target) {
                    setCharacterInputPanelData((prev) => {
                      if (prev && prev.nodeId === params.target) {
                        return {
                          ...prev,
                          videoUrl: videoUrlToPass, // 使用 OSS 公网 URL
                          isConnected: true,
                          needsUpload: false, // 不需要上传
                          localVideoPath: undefined, // 清除本地路径
                          isUploading: false,
                          timestamp: prev.timestamp || '1,3',
                        };
                      }
                      return prev;
                    });
                  }
                  
                  return updatedNodes;
                }
                
                // 如果需要上传，显示"确认上传视频"按钮（不自动上传）
                if (needsUpload && localVideoPath && window.electronAPI) {
                  // 更新节点数据，保存本地路径和需要上传标志
                  const updatedNodes = nds.map((node) => {
                    if (node.id === params.target) {
                      return {
                        ...node,
                        data: {
                          ...node.data,
                          videoUrl: localVideoPath, // 显示本地路径（用于提示）
                          needsUpload: true, // 标记需要上传
                          localVideoPath: localVideoPath, // 保存本地路径
                          timestamp: node.data?.timestamp || '1,3',
                        },
                      };
                    }
                    return node;
                  });
                  
                  // 如果目标节点当前被选中，更新输入面板数据
                  if (selectedNode && selectedNode.id === params.target) {
                    setCharacterInputPanelData((prev) => {
                      if (prev && prev.nodeId === params.target) {
                        return {
                          ...prev,
                          videoUrl: localVideoPath, // 显示本地路径（用于提示）
                          isConnected: true,
                          needsUpload: true, // 标记需要上传
                          localVideoPath: localVideoPath, // 保存本地路径
                          isUploading: false, // 未开始上传
                          timestamp: prev.timestamp || '1,3',
                        };
                      }
                      return prev;
                    });
                  }
                  
                  // 不自动上传，等待用户点击"确认上传视频"按钮
                  return updatedNodes;
                }
                
                // 如果已经有其他格式的 URL，直接使用
                if (videoUrlToPass) {
                  const updatedNodes = nds.map((node) => {
                    if (node.id === params.target) {
                      return {
                        ...node,
                        data: {
                          ...node.data,
                          videoUrl: videoUrlToPass, // 传递网络 URL
                          timestamp: node.data?.timestamp || '1,3', // 如果时间戳为空，设置默认值 "1,3"
                        },
                      };
                    }
                    return node;
                  });
                  
                  // 如果目标节点当前被选中，立即更新输入面板数据
                  if (selectedNode && selectedNode.id === params.target) {
                    setCharacterInputPanelData((prev) => {
                      if (prev && prev.nodeId === params.target) {
                        return {
                          ...prev,
                          videoUrl: videoUrlToPass,
                          isConnected: true,
                          isUploading: false, // 确保不是上传状态
                          timestamp: prev.timestamp || '1,3', // 如果时间戳为空，设置默认值 "1,3"
                        };
                      }
                      return prev;
                    });
                  }
                  
                  return updatedNodes;
                }
              }
            }
            return nds;
          });
        }
        
        latestEdgesRef.current = updatedEdges;
        return updatedEdges;
      });
    },
    [projectId, setEdges, setNodes, selectedNode, nodes]
  );

  /** 超级连线/改线后：按全部入边重建剪辑轨道（视频轨 + 音频轨） */
  const finalizeVideoSpliceTimeline = useCallback(
    (targetNodeId: string, edgesOverride?: Edge[]) => {
      flushSync(() => {
        setNodes((nds) => {
          const target = nds.find((n) => n.id === targetNodeId);
          if (!target || target.type !== 'videoSplice') return nds;
          const edgesNow = edgesOverride ?? (latestEdgesRef.current as Edge[]);
          // 超级连线刚 flushSync 完 onConnect 时，ref 可能仍滞后；用传入 edges 或合并 ref
          const built = buildVideoSpliceClipsFromEdges(
            targetNodeId,
            edgesNow,
            nds,
            target.data as { videoClips?: TimelineClip[]; audioTracks?: TimelineClip[][] },
          );
          const connectedIds = collectSpliceIncomingSourceIds(targetNodeId, edgesNow);
          const blockDropOnly =
            spliceRebuildWouldDropConnected(target.data, built, connectedIds) &&
            !spliceBuiltHasNewConnectedSources(target.data, built);
          if (blockDropOnly) {
            return nds;
          }
          return nds.map((n) =>
            n.id === targetNodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    ...applyBuiltClipsToSpliceData(n.data, built, connectedIds),
                  },
                }
              : n,
          );
        });
      });
    },
    [setNodes],
  );

  /** 超级连线后：按全部入边一次性重建拼图图层（避免逐条连线时 layers 被覆盖） */
  const finalizePhotoCollageLayers = useCallback(
    (targetNodeId: string, edgesOverride?: Edge[]) => {
      flushSync(() => {
        setNodes((nds) => {
          const target = nds.find((n) => n.id === targetNodeId);
          if (!target || target.type !== 'photoCollage') return nds;
          const edgesNow = edgesOverride ?? (latestEdgesRef.current as Edge[]);
          const prevLayers = ((target.data?.layers || []) as CollageLayer[]).slice();
          const nextLayers = buildPhotoCollageLayersFromEdges(
            targetNodeId,
            edgesNow,
            nds,
            prevLayers,
          );
          return nds.map((n) =>
            n.id === targetNodeId ? { ...n, data: { ...n.data, layers: nextLayers } } : n,
          );
        });
      });
    },
    [setNodes],
  );

  /** 超级连线后：按入边一次性填充宫格空位 */
  const finalizeGridMapCells = useCallback(
    (targetNodeId: string, edgesOverride?: Edge[]) => {
      flushSync(() => {
        setNodes((nds) => {
          const target = nds.find((n) => n.id === targetNodeId);
          if (!target || target.type !== 'gridMap') return nds;
          const edgesNow = edgesOverride ?? (latestEdgesRef.current as Edge[]);
          const cols = Number(target.data?.gridCols) || DEFAULT_GRID_MAP_COLS;
          const rows = Number(target.data?.gridRows) || DEFAULT_GRID_MAP_ROWS;
          const prevCells = ((target.data?.cells || []) as GridMapCell[]).slice();
          const nextCells = buildGridMapCellsFromEdges(
            targetNodeId,
            edgesNow,
            nds,
            prevCells,
            cols,
            rows,
          );
          return nds.map((n) =>
            n.id === targetNodeId ? { ...n, data: { ...n.data, cells: nextCells } } : n,
          );
        });
      });
    },
    [setNodes],
  );

  /** 框选多图：按所选比例/宫格在右侧生成宫格图（直接填格，不建连线） */
  const handleCreateGridMapFromSelection = useCallback(
    (opts: {
      nodeIds: string[];
      cols: number;
      rows: number;
      canvasW: number;
      canvasH: number;
    }) => {
      const ids = [...new Set((opts.nodeIds || []).filter(Boolean))];
      if (ids.length < 2) return;
      const cols = Math.max(1, Math.floor(Number(opts.cols) || DEFAULT_GRID_MAP_COLS));
      const rows = Math.max(1, Math.floor(Number(opts.rows) || DEFAULT_GRID_MAP_ROWS));
      const canvasW = Math.max(64, Math.floor(Number(opts.canvasW) || DEFAULT_GRID_MAP_CANVAS_W));
      const canvasH = Math.max(64, Math.floor(Number(opts.canvasH) || DEFAULT_GRID_MAP_CANVAS_H));
      const slotCount = cols * rows;

      const allNodes = latestNodesRef.current;
      const selected = sortNodesByReadingOrder(
        allNodes.filter(
          (n) =>
            ids.includes(n.id) &&
            n.type === 'image' &&
            !!resolveImageUrlFromNodeForPhotoCollage(n.data as Record<string, unknown>),
        ),
      );
      if (selected.length < 2) {
        showAlert(locale === 'en' ? 'Select at least 2 image modules' : '请至少框选 2 个图片模块');
        return;
      }
      if (selected.length > slotCount) {
        showAlert(
          locale === 'en'
            ? `Grid ${cols}×${rows} holds ${slotCount} images; extra selected images were skipped.`
            : `宫格 ${cols}×${rows} 仅 ${slotCount} 格，多余选中图片已跳过。`,
        );
      }
      const sources = selected.slice(0, slotCount);

      const GAP = 48;
      let maxRight = -Infinity;
      let minY = Infinity;
      let maxBottom = -Infinity;
      for (const node of sources) {
        const w = Number(node.data?.width) || Number((node.style as { width?: number })?.width) || 280;
        const h = Number(node.data?.height) || Number((node.style as { height?: number })?.height) || 280;
        maxRight = Math.max(maxRight, node.position.x + w);
        minY = Math.min(minY, node.position.y);
        maxBottom = Math.max(maxBottom, node.position.y + h);
      }
      const outer = nodeOuterSizeForCanvas(canvasW, canvasH);
      const newNodeId = `gridMap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newPosition = {
        x: maxRight + GAP,
        y: minY + Math.max(0, (maxBottom - minY - outer.h) / 2),
      };
      const label = locale === 'en' ? 'Grid map' : '宫格图';
      const initialCells = emptyGridMapCells(cols, rows);
      sources.forEach((node, i) => {
        const url = resolveImageUrlFromNodeForPhotoCollage(node.data as Record<string, unknown>);
        if (!url || i >= initialCells.length) return;
        // 仅写 src，不写 sourceNodeId：框选导入不建边，避免 buildGridMapCellsFromEdges 清空格子
        initialCells[i] = {
          ...initialCells[i],
          src: formatGridMapImagePath(url),
        };
      });
      const newNode: Node = {
        id: newNodeId,
        type: 'gridMap',
        position: newPosition,
        selected: true,
        data: {
          label,
          title: 'gridMap',
          width: outer.w,
          height: outer.h,
          isUserResized: true,
          gridCols: cols,
          gridRows: rows,
          canvasW,
          canvasH,
          cells: initialCells,
        },
        style: nodeStyleDimensions(outer.w, outer.h),
      };

      flushSync(() => {
        setNodes((nds) => [
          ...nds.map((n) => ({ ...n, selected: false })),
          newNode,
        ]);
      });
      setTimeout(() => saveHistory('general'), 0);
    },
    [locale, showAlert, setNodes, saveHistory],
  );

  /** 超级连线后：按入边一次性写入对比节点 A/B（最多两路） */
  const finalizeImageComparerUrls = useCallback(
    (targetNodeId: string) => {
      flushSync(() => {
        setEdges((eds) => {
          setNodes((nds) => {
            const target = nds.find((n) => n.id === targetNodeId);
            if (!target || target.type !== 'imageComparer') return nds;
            const urls = buildImageComparerUrlsFromEdges(targetNodeId, eds as Edge[], nds);
            return nds.map((n) =>
              n.id === targetNodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      imageAUrl: urls.imageAUrl,
                      imageBUrl: urls.imageBUrl,
                      imageASourceNodeId: urls.imageASourceNodeId,
                      imageBSourceNodeId: urls.imageBSourceNodeId,
                    },
                  }
                : n,
            );
          });
          return eds;
        });
      });
    },
    [setNodes, setEdges],
  );

  // 超级连线：将选中模块的输出全部接入目标模块（依次调用 onConnect，保证状态正确）
  const handleSuperConnect = useCallback(
    (sourceNodeIds: string[], targetNodeId: string) => {
      const targetNode = nodes.find((n) => n.id === targetNodeId);
      if (!targetNode?.type) return;
      let allowed = sourceNodeIds
        .filter((id) => id !== targetNodeId)
        .filter((id) => {
          const src = nodes.find((n) => n.id === id);
          if (!src?.type || !isConnectionAllowed(src.type, targetNode.type)) return false;
          if (targetNode.type === 'videoSplice' && !isTimelineMediaSourceNodeType(src.type)) return false;
          return true;
        });
      // 图片对比仅两槽：超级连线最多接入前两张图
      if (targetNode.type === 'imageComparer') {
        allowed = allowed.slice(0, 2);
      }
      // 拼图：仅图片源、按阅读顺序、遵守图层上限
      if (targetNode.type === 'photoCollage') {
        const imageSources = allowed
          .map((id) => nodes.find((n) => n.id === id))
          .filter((n): n is Node => !!n && n.type === 'image')
          .filter((n) => !!resolveImageUrlFromNodeForPhotoCollage(n.data as Record<string, unknown>));
        const ordered = sortNodesByReadingOrder(imageSources);
        const prevLayers = ((targetNode.data?.layers || []) as CollageLayer[]).slice();
        const remaining = photoCollageRemainingImportSlots(
          prevLayers,
          ordered.map((n) => n.id),
        );
        const reconnectIds = new Set(
          prevLayers
            .map((L) => collageLayerSourceNodeId(L))
            .filter((id): id is string => !!id),
        );
        const reconnecting = ordered.filter((n) => reconnectIds.has(n.id));
        const fresh = ordered.filter((n) => !reconnectIds.has(n.id));
        const skipped = Math.max(0, fresh.length - remaining);
        const acceptedFresh = fresh.slice(0, remaining);
        allowed = [...reconnecting, ...acceptedFresh].map((n) => n.id);
        if (skipped > 0) {
          const msg = photoCollageT(locale)
            .superConnectOverflow.replace('{max}', String(MAX_PHOTO_COLLAGE_LAYERS))
            .replace('{n}', String(skipped));
          showAlert(msg);
        }
      }
      if (allowed.length === 0) return;
      // 每条连线的 onConnect 会在 setEdges 回调里再调 setNodes；flushSync 保证逐条落盘。
      allowed.forEach((sourceId) => {
        flushSync(() => {
          onConnect({ source: sourceId, target: targetNodeId, sourceHandle: null, targetHandle: null });
        });
      });
      if (targetNode.type === 'videoSplice') {
        // 用最新 edges；若 ref 仍缺刚连上的源，补上，避免 finalize 把音频轨冲掉
        let edgesNow = [...(latestEdgesRef.current as Edge[])];
        for (const sourceId of allowed) {
          if (!edgesNow.some((e) => e.source === sourceId && e.target === targetNodeId)) {
            edgesNow.push({
              id: `e-${sourceId}-${targetNodeId}-finalize`,
              source: sourceId,
              target: targetNodeId,
              sourceHandle: null,
              targetHandle: 'input',
            } as Edge);
          }
        }
        finalizeVideoSpliceTimeline(targetNodeId, edgesNow);
      } else if (targetNode.type === 'photoCollage') {
        let edgesNow = [...(latestEdgesRef.current as Edge[])];
        for (const sourceId of allowed) {
          if (!edgesNow.some((e) => e.source === sourceId && e.target === targetNodeId)) {
            edgesNow.push({
              id: `e-${sourceId}-${targetNodeId}-finalize`,
              source: sourceId,
              target: targetNodeId,
              sourceHandle: null,
              targetHandle: 'input',
            } as Edge);
          }
        }
        finalizePhotoCollageLayers(targetNodeId, edgesNow);
      } else if (targetNode.type === 'gridMap') {
        let edgesNow = [...(latestEdgesRef.current as Edge[])];
        for (const sourceId of allowed) {
          if (!edgesNow.some((e) => e.source === sourceId && e.target === targetNodeId)) {
            edgesNow.push({
              id: `e-${sourceId}-${targetNodeId}-finalize`,
              source: sourceId,
              target: targetNodeId,
              sourceHandle: null,
              targetHandle: 'input',
            } as Edge);
          }
        }
        finalizeGridMapCells(targetNodeId, edgesNow);
      } else if (targetNode.type === 'imageComparer') {
        finalizeImageComparerUrls(targetNodeId);
      }
    },
    [
      nodes,
      onConnect,
      finalizeVideoSpliceTimeline,
      finalizePhotoCollageLayers,
      finalizeGridMapCells,
      finalizeImageComparerUrls,
      locale,
      showAlert,
    ],
  );

  /** 反向超级连线：单一源模块输出 → 批量接入各选中目标（不含源） */
  const handleReverseSuperConnect = useCallback(
    (sourceNodeId: string, targetNodeIds: string[]) => {
      const sourceNode = nodes.find((n) => n.id === sourceNodeId);
      if (!sourceNode || !sourceNode.type) return;
      const allowed = targetNodeIds.filter((id) => {
        const tgt = nodes.find((n) => n.id === id);
        return tgt && tgt.type && isConnectionAllowed(sourceNode.type, tgt.type);
      });
      if (allowed.length === 0) return;
      allowed.forEach((targetId) => {
        flushSync(() => {
          onConnect({ source: sourceNodeId, target: targetId, sourceHandle: null, targetHandle: null });
        });
      });
      allowed
        .filter((targetId) => nodes.find((n) => n.id === targetId)?.type === 'photoCollage')
        .forEach((targetId) => finalizePhotoCollageLayers(targetId));
      allowed
        .filter((targetId) => nodes.find((n) => n.id === targetId)?.type === 'gridMap')
        .forEach((targetId) => finalizeGridMapCells(targetId));
      allowed
        .filter((targetId) => nodes.find((n) => n.id === targetId)?.type === 'imageComparer')
        .forEach((targetId) => finalizeImageComparerUrls(targetId));
    },
    [nodes, onConnect, finalizePhotoCollageLayers, finalizeGridMapCells, finalizeImageComparerUrls],
  );

  // 选择节点：点击任意模块时取消连接线选中状态（绿线、剪刀一并清除）
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (!node || !node.id) return;

      if (characterAvatarPickPendingRef.current) {
        const pickTarget = characterCanvasPickTargetRef.current;
        if (pickTarget === 'sceneNormal' || pickTarget === 'sceneDisplay3d') {
          const picked = pickCharacterLibraryAvatarUrlFromNode(node);
          if (picked) finishSceneImagePick(picked);
          else cancelCharacterCanvasPick();
          return;
        }
        if (pickTarget === 'digitalHumanVideo') {
          const picked = pickDigitalHumanVideoUrlFromNode(node);
          if (picked) finishDigitalHumanVideoPick(picked);
          else cancelCharacterCanvasPick();
          return;
        }
        const vR = characterVoicePickResolveRef.current;
        const aR = characterAvatarPickResolveRef.current;
        const runVoicePick = () => {
          const picked = pickCharacterLibraryVoiceUrlFromNode(node);
          if (picked) finishCharacterVoicePick(picked);
        };
        const runAvatarPick = () => {
          const picked = pickCharacterLibraryAvatarUrlFromNode(node);
          if (picked) finishCharacterAvatarPick(picked);
        };
        if (vR && !aR) {
          runVoicePick();
        } else if (aR && !vR) {
          runAvatarPick();
        } else if (vR && aR) {
          if (characterCanvasPickTargetRef.current === 'voice') {
            characterAvatarPickResolveRef.current = null;
            runVoicePick();
          } else {
            characterVoicePickResolveRef.current = null;
            runAvatarPick();
          }
        } else {
          cancelCharacterCanvasPick();
        }
        return;
      }

      const ctrlHeld = !!(
        _event &&
        typeof _event === 'object' &&
        (('ctrlKey' in _event && _event.ctrlKey) || ('metaKey' in _event && _event.metaKey))
      );
      const qcSource = quickConnectSourceIdRef.current;

      // 快速连线第二步：点击目标模块
      if (qcSource) {
        if (node.id === qcSource) {
          cancelQuickConnect();
          return;
        }
        const sourceNode =
          latestNodesRef.current.find((n) => n.id === qcSource) ?? nodes.find((n) => n.id === qcSource);
        const sourceType = sourceNode?.type ?? '';
        const targetType = node.type ?? '';
        const allowed =
          !!sourceType &&
          !!targetType &&
          isConnectionAllowed(sourceType, targetType) &&
          !(targetType === 'videoSplice' && !isTimelineMediaSourceNodeType(sourceType));
        if (!allowed) {
          showAlert(
            locale === 'en'
              ? 'These modules cannot be connected.'
              : '这两个模块无法连线',
          );
          return;
        }
        onConnect({
          source: qcSource,
          target: node.id,
          sourceHandle: null,
          targetHandle: null,
        });
        if (targetType === 'videoSplice') {
          finalizeVideoSpliceTimeline(node.id);
        } else if (targetType === 'photoCollage') {
          finalizePhotoCollageLayers(node.id);
        } else if (targetType === 'gridMap') {
          finalizeGridMapCells(node.id);
        } else if (targetType === 'imageComparer') {
          finalizeImageComparerUrls(node.id);
        }
        showQuickConnectToast(locale === 'en' ? 'Connected' : '已连线', isDarkMode);
        cancelQuickConnect();
        setSelectedNode(node);
        return;
      }

      // 快速连线第一步：Ctrl/Cmd + 点击源模块
      if (ctrlHeld) {
        beginQuickConnect(node.id);
        setSelectedNode(node);
        return;
      }

      setSelectedEdge(null);
      setEdgeDeleteModeId(null);
      setSelectedNode((prev) => {
        if (prev?.id === node.id && prev?.type === node.type) {
          return prev;
        }
        return node;
      });
      const nodeType = node.type ?? (node.data as any)?.nodeType;

      try {
      // 如果选中的是 LLM 节点，显示输入面板弹窗
      if (nodeType === 'llm') {
        // 查找所有指向该 LLM 节点的连线
        const incomingEdges = edges.filter((e) => e.target === node.id);

        // 区分来自文本节点、LLM节点和来自图片节点的连接
        const textEdges = incomingEdges.filter((e) => {
          const sourceNode = nodes.find((n) => n.id === e.source);
          return sourceNode && (sourceNode.type === 'minimalistText' || sourceNode.type === 'text');
        });
        const llmEdges = incomingEdges.filter((e) => {
          const sourceNode = nodes.find((n) => n.id === e.source);
          return sourceNode && sourceNode.type === 'llm' && sourceNode.data?.outputText;
        });
        const splitEdges = incomingEdges.filter((e) => {
          const sourceNode = nodes.find((n) => n.id === e.source);
          return sourceNode && sourceNode.type === 'textSplit';
        });
        const imageEdges = incomingEdges.filter((e) => {
          const sourceNode = nodes.find((n) => n.id === e.source);
          return sourceNode && sourceNode.type === 'image' && !!buildDualImageAssetFromNodeData(sourceNode.data);
        });
        const videoEdges = incomingEdges.filter((e) => {
          const sourceNode = nodes.find((n) => n.id === e.source);
          return sourceNode && isVideoTrackSourceNodeType(sourceNode.type);
        });

        const hasTextConnection = textEdges.length > 0;
        const hasLLMConnection = llmEdges.length > 0;
        const hasSplitConnection = splitEdges.length > 0;
        const hasImageConnection = imageEdges.length > 0;
        const hasVideoConnection = videoEdges.length > 0;

        // 按连线顺序收集所有文本来源（Text / LLM / 文本拆分），用逗号拼接
        const textSourceEdges = incomingEdges.filter((e) => {
          const src = nodes.find((n) => n.id === e.source);
          return src && (src.type === 'minimalistText' || src.type === 'text' || src.type === 'llm' || src.type === 'textSplit');
        });
        const parts: string[] = [];
        for (const edge of textSourceEdges) {
          const src = nodes.find((n) => n.id === edge.source);
          if (!src) continue;
          if (src.type === 'minimalistText' || src.type === 'text') {
            if (src.data?.text) parts.push(String(src.data.text).trim());
          } else if (src.type === 'llm' && src.data?.outputText) {
            parts.push(String(src.data.outputText).trim());
          } else if (src.type === 'textSplit') {
            const segText = pickTextSplitSegmentText(src.data, 
              edge.sourceHandle,
            );
            if (segText) parts.push(segText);
          }
        }
        const resolvedInputText = parts.length > 0 ? parts.join(',') : (node.data?.inputText || '');

        if (parts.length > 0) {
          setNodes((nds) =>
            nds.map((n) =>
              n.id === node.id ? { ...n, data: { ...n.data, inputText: resolvedInputText } } : n
            )
          );
        }

        // 如果存在来自 Image 节点的连线，取第一张图片作为反推对象
        let imageUrlForReverse: string | undefined;
        let imageAssetForReverse: DualImageAsset | undefined;
        if (hasImageConnection) {
          const firstImageEdge = imageEdges[0];
          const sourceNode = nodes.find((n) => n.id === firstImageEdge.source);
          imageAssetForReverse = ((firstImageEdge.data as any)?.imageAsset as DualImageAsset | undefined) ||
            (sourceNode?.data ? buildDualImageAssetFromNodeData(sourceNode.data) || undefined : undefined);
          if (sourceNode?.data) {
            imageUrlForReverse = imageAssetForReverse?.preview || pickPreviewUrl(buildDualImageAssetFromNodeData(sourceNode.data));
          }
        }

        // 如果存在来自 Video 节点的连线，取第一个视频作为分析对象
        let videoUrlForAnalysis: string | undefined;
        if (hasVideoConnection) {
          const firstVideoEdge = videoEdges[0];
          const sourceNode = nodes.find((n) => n.id === firstVideoEdge.source);
          if (isVideoTrackSourceNodeType(sourceNode?.type)) {
            videoUrlForAnalysis = (sourceNode.data?.outputVideo || sourceNode.data?.originalVideoUrl) as string | undefined;
          }
        }

        const hasLinkedForPanel =
          (hasTextConnection || hasLLMConnection || hasSplitConnection) && !!resolvedInputText;
        const rawUserInput =
          node.data?.userInput !== undefined
            ? node.data.userInput
            : (hasImageConnection ? '这张图片有什么？' : hasVideoConnection ? '这个视频有什么内容？' : '');
        // 旧逻辑曾把上游正文锁进底栏；现底栏仅系统文，若与连线正文相同则清空
        const cleanedUserInput =
          hasLinkedForPanel && String(rawUserInput).trim() === String(resolvedInputText).trim()
            ? ''
            : rawUserInput;

        setLlmInputPanelData({
          nodeId: node.id,
          inputText: resolvedInputText,
          // 默认提示词仅在首次打开时填充；用户删除或修改后，以 node.data.userInput 为准（含空字符串）
          userInput: cleanedUserInput,
          prompt: node.data?.prompt || node.data?.systemPrompt || '',
          savedPrompts: globalPersonas,
          isInputLocked: false,
          hasLinkedText: hasLinkedForPanel,
          linkedInputText: resolvedInputText,
          linkedTextTitle: collectLinkedTextTitlesForTarget(node.id, nodes, edges),
          isImageReverseMode: hasImageConnection && !!imageUrlForReverse,
          imageUrlForReverse,
          imageAssetForReverse,
          isVideoAnalysisMode: hasVideoConnection && !!videoUrlForAnalysis,
          videoUrlForAnalysis,
          reverseCaptionModel: normalizeImageReverseCaptionModel(
            node.data?.reverseCaptionModel as string | undefined,
          ),
          chatModel: (node.data?.chatModel as string) || 'gpt-3.5-turbo',
        });
        if (cleanedUserInput !== rawUserInput) {
          setNodes((nds) =>
            nds.map((n) =>
              n.id === node.id ? { ...n, data: { ...n.data, userInput: cleanedUserInput } } : n,
            ),
          );
        }
        setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
        setStoryboardScriptInputPanelData(null);
        setDirectorInputPanelData(null);
      } else if (nodeType === 'storyboardScript') {
        const { imageUrls, videoUrls, textParts } = collectStoryboardScriptMediaFromEdges(
          node.id,
          nodes,
          edges,
        );
        const existingPrompt = String(node.data?.userPrompt || '').trim();
        const linkedPrompt = textParts.length > 0 ? textParts.join(',') : '';
        const userPrompt = existingPrompt || linkedPrompt;

        if (linkedPrompt && !existingPrompt) {
          setNodes((nds) =>
            nds.map((n) =>
              n.id === node.id ? { ...n, data: { ...n.data, userPrompt: linkedPrompt } } : n,
            ),
          );
        }

        setStoryboardScriptInputPanelData({
          nodeId: node.id,
          userPrompt,
          chatModel: (node.data?.chatModel as string) || 'gpt-3.5-turbo',
          storyboardScript: createDefaultStoryboardScriptState(node.data?.storyboardScript || {}),
          imageUrls,
          videoUrls,
        });
        setLlmInputPanelData(null);
        setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
        setVideoInputPanelData(null);
        setCharacterInputPanelData(null);
        setAudioInputPanelData(null);
        setRvcTrainInputPanelData(null);
        setDirectorInputPanelData(null);
      } else if (nodeType === 'director') {
        const director = createDefaultDirectorPipelineState(
          (node.data as { director?: DirectorPipelineState })?.director || {},
        );
        // 从入边剧本/文本收集 scriptText
        const incoming = edges.filter((e) => e.target === node.id);
        const textParts: string[] = [];
        for (const edge of incoming) {
          const src = nodes.find((n) => n.id === edge.source);
          if (!src) continue;
          if (src.type === 'script' || src.type === 'minimalistText' || src.type === 'text') {
            const t = String(src.data?.text || '').trim();
            if (t) textParts.push(t);
          } else if (src.type === 'llm') {
            const t = String(src.data?.outputText || src.data?.text || '').trim();
            if (t) textParts.push(t);
          } else if (src.type === 'textSplit') {
            const t = pickTextSplitSegmentText(src.data, edge.sourceHandle);
            if (t) textParts.push(t);
          }
        }
        const linkedScript = textParts.join('\n\n');
        const scriptText = director.scriptText?.trim() || linkedScript;
        const nextDirector =
          linkedScript && !director.scriptText?.trim()
            ? createDefaultDirectorPipelineState({ ...director, scriptText: linkedScript })
            : director;
        if (linkedScript && !director.scriptText?.trim()) {
          setNodes((nds) =>
            nds.map((n) =>
              n.id === node.id ? { ...n, data: { ...n.data, director: nextDirector } } : n,
            ),
          );
        }
        // 镜头生成入口已收进导演主模块，不再挂底部输入面板
        setDirectorInputPanelData(null);
        setLlmInputPanelData(null);
        setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
        setVideoInputPanelData(null);
        setCharacterInputPanelData(null);
        setAudioInputPanelData(null);
        setRvcTrainInputPanelData(null);
        setStoryboardScriptInputPanelData(null);
      } else if (nodeType === 'imageTo3d') {
        const inputUrl = resolveImageTo3dInputUrl(node, edges, nodes);
        const resultTextureUrl = (node.data?.resultTextureUrl as string) || '';
        if (inputUrl && inputUrl !== (node.data?.inputImageUrl as string)) {
          setNodes((nds) =>
            nds.map((n) =>
              n.id === node.id ? { ...n, data: { ...n.data, inputImageUrl: inputUrl } } : n,
            ),
          );
        }
        setImageTo3dInputPanelData({
          nodeId: node.id,
          inputImageUrl: inputUrl,
          resultTextureUrl,
          model: (node.data?.model as string) || DEFAULT_IMAGE_TO_3D_MODEL,
        });
        setLlmInputPanelData(null);
        setImageInputPanelData(null);
        setVideoInputPanelData(null);
        setCharacterInputPanelData(null);
        setAudioInputPanelData(null);
      } else if (nodeType === 'rvcTrain') {
        const trainUrl = resolveRvcTrainAudioFromEdges(node.id, edges, nodes) || (node.data?.referenceAudioUrl as string) || '';
        if (trainUrl && trainUrl !== (node.data?.referenceAudioUrl as string)) {
          setNodes((nds) =>
            nds.map((n) =>
              n.id === node.id ? { ...n, data: { ...n.data, referenceAudioUrl: trainUrl } } : n,
            ),
          );
        }
        setRvcTrainInputPanelData({
          nodeId: node.id,
          rvcTrainModelName: resolveRvcTrainNickname(node.data as { rvcTrainModelName?: string; title?: string }),
          referenceAudioUrl: trainUrl,
          libraryAvatarUrl: (node.data?.libraryAvatarUrl as string) ?? '',
        });
        setLlmInputPanelData(null);
        setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
        setVideoInputPanelData(null);
        setCharacterInputPanelData(null);
        setAudioInputPanelData(null);
      } else if (nodeType === 'image') {
        // 如果选中的是 Image 节点，显示输入面板弹窗
        // 检查是否有输入连接（区分图生图和文生图模式）
        // Image 只有一个 target Handle，按源节点类型区分：image→图生图，text/LLM→文生图
        // 收集输入参考图：角色卡（多槽勾选）+ 场景/图片节点，合并写入
        let inputImages = mergeInputImagesPreserveOrder(
          node.data?.inputImages as string[] | undefined,
          collectImageTargetInputImagesFromEdges(node.id, nodes, edges),
        );
        if (inputImages.length === 0 && node.data?.inputImages) {
          inputImages = (node.data.inputImages as string[]).slice(0, 10);
        } else {
          inputImages = inputImages.slice(0, 10);
        }
        
        // 按入边顺序收集 text/LLM/文本拆分/Image（含 3D prompt） 的 prompt
        const incomingTextEdges = edges.filter((e) => {
          if (e.target !== node.id) return false;
          const src = nodes.find((n) => n.id === e.source);
          return src && (src.type === 'minimalistText' || src.type === 'text' || src.type === 'llm' || src.type === 'textSplit' || src.type === 'image');
        });
        const promptParts: string[] = [];
        for (const edge of incomingTextEdges) {
          const src = nodes.find((n) => n.id === edge.source);
          if (!src) continue;
          if (src.type === 'minimalistText' || src.type === 'text') {
            if (src.data?.text) promptParts.push(String(src.data.text).trim());
          } else if (src.type === 'llm' && src.data?.outputText) {
            promptParts.push(String(src.data.outputText).trim());
          } else if (src.type === 'textSplit') {
            const segText = pickTextSplitSegmentText(src.data, 
              edge.sourceHandle,
            );
            if (segText) promptParts.push(segText);
          } else if (src.type === 'image') {
            const pp = src.data?.prompt_payload as { qwen_instruction?: string; formatted_output?: string; full_camera_prompt?: string; camera_tags?: string } | undefined;
            const t = pp?.qwen_instruction || pp?.formatted_output || pp?.full_camera_prompt || pp?.camera_tags || '';
            if (t) promptParts.push(String(t).trim());
          }
        }
        // 当前节点自身的 3D 视角 prompt_payload 也加入（拖拽立方体产生的提示词）
        const selfPp = node.data?.prompt_payload as { qwen_instruction?: string; formatted_output?: string; full_camera_prompt?: string; camera_tags?: string } | undefined;
        const selfCamera = selfPp?.qwen_instruction || selfPp?.formatted_output || selfPp?.full_camera_prompt || selfPp?.camera_tags || '';
        if (selfCamera) promptParts.push(String(selfCamera).trim());
        const promptText = promptParts.length > 0 ? promptParts.join(',') : (node.data?.prompt || '');
        if (promptParts.length > 0 || inputImages.length > 0) {
          setNodes((nds) =>
            nds.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, prompt: promptText, inputImages } } : n))
          );
        }
        
        let imageModel = node.data?.model || 'banana-2.0';
        if (isRetiredImageModel(imageModel)) {
          imageModel = normalizeImageModelIfRetired(imageModel);
          setNodes((nds) =>
            nds.map((n) =>
              n.id === node.id && isRetiredImageModel(String(n.data?.model || ''))
                ? { ...n, data: { ...n.data, model: imageModel } }
                : n,
            ),
          );
        }
        // 面板比例优先用节点上用户选择的 aspectRatio，勿用成片像素比覆盖（否则生成后下拉被改掉）
        const storedAspect = String(node.data?.aspectRatio || '').trim();
        const aspectRatioForImage = storedAspect
          ? storedAspect
          : resolveAspectRatioFromNodeData(node.data as Record<string, unknown>, 'image');
        const imageResolution = String(node.data?.resolution || '1k');
        const imageQuality = String(node.data?.quality || 'low');
        const seedreamV45RatioToSize: Record<string, { width: number; height: number }> = {
          '1:1': { width: 2048, height: 2048 },
          '2:3': { width: 1664, height: 2496 },
          '3:2': { width: 2496, height: 1664 },
          '3:4': { width: 1728, height: 2304 },
          '4:3': { width: 2304, height: 1728 },
          '9:16': { width: 1440, height: 2560 },
          '16:9': { width: 2560, height: 1440 },
          '21:9': { width: 3024, height: 1296 },
        };
        const seedreamV5RatioToSize: Record<string, { width: number; height: number }> = {
          '1:1': { width: 2048, height: 2048 },
          '2:3': { width: 1664, height: 2496 },
          '3:2': { width: 2496, height: 1664 },
          '3:4': { width: 1728, height: 2304 },
          '4:3': { width: 2304, height: 1728 },
          '9:16': { width: 1600, height: 2845 },
          '16:9': { width: 2560, height: 1440 },
          '21:9': { width: 3136, height: 1344 },
        };
        let seedreamW = node.data?.seedreamWidth ?? 2048;
        let seedreamH = node.data?.seedreamHeight ?? 2048;
        const ratioMap = seedreamV5RatioToSize;
        if (imageModel === 'seedream-v5' && ratioMap[aspectRatioForImage]) {
          seedreamW = ratioMap[aspectRatioForImage].width;
          seedreamH = ratioMap[aspectRatioForImage].height;
        }
        if (!node.data?.isUserResized && !node.data?.preserveExportLayout) {
          const mediaSize = resolveNodeSizeFromMediaData(node.data as Record<string, unknown>, 'image');
          const layoutSize =
            mediaSize ?? imageNodeSizeForAspectRatio(aspectRatioForImage);
          if (layoutSize) {
            setNodes((nds) =>
              nds.map((n) =>
                n.id === node.id
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        width: layoutSize.w,
                        height: layoutSize.h,
                        aspectRatio: aspectRatioForImage,
                      },
                      style: { ...(n.style as object), ...nodeStyleDimensions(layoutSize.w, layoutSize.h) },
                    }
                  : n,
              ),
            );
          }
        }
        setImageInputPanelData({
          nodeId: node.id,
          prompt: promptText,
          resolution: imageResolution,
          aspectRatio: aspectRatioForImage,
          model: imageModel,
          quality: imageQuality,
          seedreamWidth: seedreamW,
          seedreamHeight: seedreamH,
          inputImages, // 角色卡 + 场景图等全部入边参考图
        });
        setLlmInputPanelData(null);
        setStoryboardScriptInputPanelData(null);
        setDirectorInputPanelData(null);
        setImageTo3dInputPanelData(null);
      } else if (isVideoModuleNodeType(nodeType)) {
        // 视频 / 视频换人：构建输入面板数据（换人模块固定 model = wan-animate）
        const incomingEdges = edges.filter((e) => e.target === node.id);
        const isWanAnimateOnlyNode = nodeType === 'wanAnimate';
        const isHeyGemOnlyNode = nodeType === 'heyGem';

        let inputImages: string[] = mergeInputImagesPreserveOrder(
          node.data?.inputImages as string[] | undefined,
          collectVideoTargetInputImagesFromEdges(node.id, nodes, edges),
        );
        let resolvedPrompt = node.data?.prompt || '';

        incomingEdges.forEach((edge) => {
          const sourceNode = nodes.find((n) => n.id === edge.source);
          if (!sourceNode) return;

          if (edge.targetHandle === 'input' || edge.targetHandle === 'video-input') {
            if (
              (sourceNode.type === 'minimalistText' || sourceNode.type === 'text') &&
              sourceNode.data?.text
            ) {
              resolvedPrompt = sourceNode.data.text as string;
            } else if (sourceNode.type === 'llm' && sourceNode.data?.outputText) {
              resolvedPrompt = sourceNode.data.outputText as string;
            } else if (sourceNode.type === 'textSplit') {
              resolvedPrompt = pickTextSplitSegmentText(sourceNode.data, 
                edge.sourceHandle,
              );
            }
          }
        });

        // 若从连线未解析到图片，但节点已有 inputImages（如从 Image 拖线创建时预填），则保留
        if (inputImages.length === 0 && (node.data?.inputImages as string[] | undefined)?.length) {
          inputImages = (node.data.inputImages as string[]).slice(0, 10);
        } else {
          inputImages = inputImages.slice(0, 10);
        }
        let ltx23HdrBackgroundImage = String(node.data?.ltx23HdrBackgroundImage || '').trim();
        if (node.data?.model === 'ltx-2.3-hdr-multi' || node.data?.model === 'ltx-2.3-msr-av') {
          const merged = mergeLtx23HdrMultiPreserveOrder(
            ltx23HdrBackgroundImage,
            (node.data?.inputImages as string[] | undefined) || inputImages,
            inputImages,
          );
          inputImages = merged.storyboard;
          ltx23HdrBackgroundImage = merged.background;
        }

        // 可灵参考生视频o1：从连线解析参考视频 URL（统一 input 把手，按源类型识别）
        // 裁剪导出成片不写入 reference，避免播放回退到上游源片
        // HeyGem 一体化：优先使用节点内已设置的 referenceVideoUrl（上传/画布选/数字人库），连线仅作回退
        let referenceVideoUrl = '';
        const isExportedMediaClip = !!(node.data as { exportedMediaClip?: boolean } | undefined)?.exportedMediaClip;
        if (isHeyGemOnlyNode) {
          referenceVideoUrl = String(node.data?.referenceVideoUrl || '').trim();
        }
        if (!isExportedMediaClip && !referenceVideoUrl) {
          const refEdge = incomingEdges.find((e) => {
            const src = nodes.find((n) => n.id === e.source);
            if (src?.type === 'digitalHuman') return isDigitalHumanVideoOutputHandle(e.sourceHandle);
            return isVideoTrackSourceNodeType(src?.type);
          });
          const refSource = refEdge ? nodes.find((n) => n.id === refEdge.source) : null;
          if (refSource?.type === 'digitalHuman') {
            referenceVideoUrl = pickDigitalHumanVideoUrl(refSource.data as Record<string, unknown>);
          } else if (isVideoTrackSourceNodeType(refSource?.type)) {
            const url = (refSource.data?.originalVideoUrl || refSource.data?.outputVideo) as string | undefined;
            const t = (url || '').trim();
            if (
              t &&
              (t.startsWith('http://') ||
                t.startsWith('https://') ||
                t.startsWith('local-resource://') ||
                t.startsWith('file://'))
            ) {
              referenceVideoUrl = t;
            }
          }
        }
        if (!referenceVideoUrl) {
          referenceVideoUrl = String(node.data?.referenceVideoUrl || '').trim();
        }

        // 从连线解析输入音频；导演对口型写入的 data.inputAudioUrl（无音频连线）也必须保留
        let inputAudioUrl = '';
        const audioEdge = incomingEdges.find((e) => {
          const src = nodes.find((n) => n.id === e.source);
          if (src?.type === 'digitalHuman') return isDigitalHumanAudioOutputHandle(e.sourceHandle);
          return src?.type === 'audio';
        });
        const audioSource = audioEdge ? nodes.find((n) => n.id === audioEdge.source) : null;
        if (audioSource?.type === 'digitalHuman') {
          inputAudioUrl = pickDigitalHumanAudioUrl(audioSource.data as Record<string, unknown>);
        } else if (audioSource?.type === 'audio') {
          const url = pickAudioOutputUrlFromAudioNodeData(audioSource.data as Record<string, unknown>);
          if (url) inputAudioUrl = url;
        }
        if (!String(inputAudioUrl || '').trim()) {
          inputAudioUrl = String(node.data?.inputAudioUrl || '').trim();
        }

        let videoPanelModel = isWanAnimateOnlyNode
          ? 'wan-animate'
          : isHeyGemOnlyNode
            ? 'hey-gem'
          : (((node.data?.model as
              | 'sora-2'
              | 'sora-2-pro'
              | 'kling-v2.6-pro'
              | 'kling-video-o1'
              | 'kling-video-o1-i2v'
              | 'kling-video-o1-start-end'
              | 'kling-video-o1-ref'
              | 'wan-2.6'
              | 'wan-2.6-flash'
              | 'wan-animate'
              | 'hey-gem'
              | 'gemini-omni'
              | 'gemini-omni-flash'
              | 'seedance-2.0-fast'
              | 'seedance-2.0-mini'
              | 'ltx-2.3-lipsync'
              | 'ltx-2.3-i2v'
              | 'ltx-2.3-t2v'
              | 'ltx-2.3-hdr-multi'
              | 'ltx-2.3-msr-av'
              | 'rhart-v3.1-fast'
              | 'rhart-v3.1-fast-se'
              | 'rhart-v3.1-pro'
              | 'rhart-v3.1-pro-se'
              | 'grok-3'
              | 'rhart-video-x'
              | 'grok-3-stable'
              | 'rhart-v3.1-pro-official-i2v'
              | 'hailuo-02-t2v-standard'
              | 'hailuo-2.3-t2v-standard'
              | 'hailuo-02-i2v-standard'
              | 'hailuo-2.3-i2v-standard'
              | 'rh-video-start-end') || DEFAULT_VIDEO_MODEL_REPLACING_SORA2) as string);
        if (
          !isWanAnimateOnlyNode &&
          HIDE_SORA2_AND_SORA_CHARACTER_UI &&
          (videoPanelModel === 'sora-2' || videoPanelModel === 'sora-2-pro')
        ) {
          videoPanelModel = DEFAULT_VIDEO_MODEL_REPLACING_SORA2;
          setNodes((nds) =>
            nds.map((n) =>
              n.id === node.id && (n.data?.model === 'sora-2' || n.data?.model === 'sora-2-pro')
                ? { ...n, data: { ...n.data, model: DEFAULT_VIDEO_MODEL_REPLACING_SORA2 } }
                : n
            )
          );
        }
        if (!isWanAnimateOnlyNode && !isHeyGemOnlyNode && isRetiredVideoModel(videoPanelModel)) {
          const nextModel = normalizeVideoModelIfRetired(videoPanelModel);
          videoPanelModel = nextModel;
          setNodes((nds) =>
            nds.map((n) =>
              n.id === node.id && isRetiredVideoModel(String(n.data?.model || ''))
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      model: nextModel,
                      durationGrok3: (n.data?.durationGrok3 as string) || '10',
                      resolutionGrok3: (n.data?.resolutionGrok3 as '720p') || '720p',
                    },
                  }
                : n,
            ),
          );
        }
        if (!isWanAnimateOnlyNode && !isHeyGemOnlyNode && videoPanelModel === 'rhart-video-g') {
          videoPanelModel = 'rhart-video-x';
          setNodes((nds) =>
            nds.map((n) =>
              n.id === node.id && n.data?.model === 'rhart-video-g'
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      model: 'rhart-video-x',
                      durationGrok3:
                        (n.data?.durationGrok3 as string) ||
                        (n.data?.durationRhartVideoG === '10s' ? '10' : '6'),
                      resolutionGrok3: (n.data?.resolutionGrok3 as '720p') || '720p',
                    },
                  }
                : n
            )
          );
        }

        const hasVideoMedia = hasVideoOutputMedia(node.data as Record<string, unknown>);
        /** 面板比例：用户为下次生成设置的值，不能用成片外形强制改回 */
        const rawAspect = String(node.data?.aspectRatio || DEFAULT_VIDEO_ASPECT_RATIO);
        const videoModelForAspect = String(node.data?.model || '');
        const isSeedanceAspectModel =
          videoModelForAspect === 'seedance-2.0-fast' || videoModelForAspect === 'seedance-2.0-mini';
        const generationAspect = isSeedanceAspectModel
          ? coerceSeedanceRatio(rawAspect)
          : snapToVideoPanelAspectRatio(rawAspect);
        const layoutAspect = hasVideoMedia
          ? resolveVideoPanelAspectRatioFromNodeData(node.data as Record<string, unknown>)
          : generationAspect === 'adaptive'
            ? '16:9'
            : generationAspect;
        if (!node.data?.isUserResized && !node.data?.preserveExportLayout) {
          const layoutSize = hasVideoMedia
            ? resolveNodeSizeFromMediaData(node.data as Record<string, unknown>, 'video') ??
              videoNodeSizeForAspectRatio(layoutAspect)
            : videoNodeSizeForAspectRatio(layoutAspect);
          if (layoutSize) {
            const curW = Number(node.data?.width);
            const curH = Number(node.data?.height);
            if (curW !== layoutSize.w || curH !== layoutSize.h) {
              setNodes((nds) =>
                nds.map((n) =>
                  n.id === node.id
                    ? {
                        ...n,
                        data: {
                          ...n.data,
                          width: layoutSize.w,
                          height: layoutSize.h,
                          // 保留 generationAspect，不写 layoutAspect
                        },
                        style: { ...(n.style as object), ...nodeStyleDimensions(layoutSize.w, layoutSize.h) },
                      }
                    : n,
                ),
              );
            }
          }
        }

        setVideoInputPanelData({
          nodeId: node.id,
          prompt: resolvedPrompt,
          aspectRatio: generationAspect,
          model: videoPanelModel,
          hd: !!node.data?.hd,
          duration: (node.data?.duration as '5' | '10' | '15' | '25') || '10',
          inputImages,
          ltx23HdrBackgroundImage: ltx23HdrBackgroundImage || undefined,
          resolutionRhartV31: (node.data?.resolutionRhartV31 as '720p' | '1080p' | '4k') || '1080p',
          durationGrok3: (node.data?.durationGrok3 as string) || '10',
          resolutionGrok3: (node.data?.resolutionGrok3 as '720p') || '720p',
          durationHailuo02: (node.data?.durationHailuo02 as '6' | '10') || '6',
          resolutionHailuo: (node.data?.resolutionHailuo as 'na' | '720p' | '1080p' | '4k') || 'na',
          durationKlingO1: (node.data?.durationKlingO1 as '5' | '10') || '5',
          modeKlingO1: (node.data?.modeKlingO1 as 'std' | 'pro') || 'std',
          guidanceScale: node.data?.guidanceScale ?? 0.5,
          sound: (node.data?.sound as 'true' | 'false') || 'false',
          shotType: (node.data?.shotType as 'single' | 'multi') || 'single',
          negativePrompt: (node.data?.negativePrompt as string) || '',
          resolutionWan26: (node.data?.resolutionWan26 as '720p' | '1080p') || '1080p',
          resolutionWanAnimate: coerceVideoWanAnimateResolution(node.data?.resolutionWanAnimate),
          wanAnimateClipSec: coerceWanAnimateClipSec(node.data?.wanAnimateClipSec),
          resolutionSeedance: coerceVideoSeedanceResolution(node.data?.resolutionSeedance, String(node.data?.model || 'seedance-2.0-fast')),
          durationSeedance: normalizeSeedanceDurationChoice(node.data?.durationSeedance, 10),
          resolutionGeminiOmni: coerceVideoGeminiOmniResolution(node.data?.resolutionGeminiOmni),
          durationGeminiOmni: normalizeGeminiOmniDurationChoice(node.data?.durationGeminiOmni, 6),
          durationWan26Flash: (node.data?.durationWan26Flash as '2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'11'|'12'|'13'|'14'|'15') || '5',
          enableAudio: node.data?.enableAudio !== false,
          durationVeo31ProOfficial: (node.data?.durationVeo31ProOfficial as '4' | '6' | '8') || '4',
          generateAudioVeo31ProOfficial: !!node.data?.generateAudioVeo31ProOfficial,
          referenceVideoUrl: referenceVideoUrl || undefined,
          keepOriginalSound: !!node.data?.keepOriginalSound,
          inputAudioUrl: inputAudioUrl || undefined,
          heyGemScript: String((node.data as { heyGemScript?: string } | undefined)?.heyGemScript || ''),
          heyGemTtsModel: String((node.data as { heyGemTtsModel?: string } | undefined)?.heyGemTtsModel || DOUBAO_SEED_AUDIO_MODEL_ID),
          heyGemCloneAudioUrl: String((node.data as { heyGemCloneAudioUrl?: string } | undefined)?.heyGemCloneAudioUrl || ''),
          resolutionLtx23Lipsync: (() => {
            const r = (node.data?.resolutionLtx23Lipsync ?? node.data?.resolutionWan22Lipsync) as string | undefined;
            if (r === '720' || r === '1280' || r === '1920') return r;
            return '720'; // 兼容旧值 480/1080 等，映射为标准 720
          })(),
          durationLtx23I2v: normalizeLtx23DurationChoice(node.data?.durationLtx23I2v, 10),
          resolutionLtx23I2v: (node.data?.resolutionLtx23I2v as '720' | '1280' | '1920') || '720',
          durationLtx23T2v: normalizeLtx23DurationChoice(node.data?.durationLtx23T2v, 10),
          resolutionLtx23T2v: (node.data?.resolutionLtx23T2v as '720' | '1280' | '1920') || '720',
          durationLtx23HdrMulti: normalizeLtx23DurationChoice(node.data?.durationLtx23HdrMulti, 15),
          resolutionLtx23HdrMulti: (() => {
            const r = String(node.data?.resolutionLtx23HdrMulti ?? '720');
            if (r === '1920' || r === '1080') return '1280' as const;
            if (r === '1280') return '1280' as const;
            return '720' as const;
          })(),
          sora2Channel: (node.data?.sora2Channel as 'plugin' | 'core') || 'plugin',
          isConnected:
            inputImages.length > 0 ||
            incomingEdges.some((e) => {
              const src = nodes.find((n) => n.id === e.source);
              return (
                src &&
                (src.type === 'minimalistText' || src.type === 'text' || src.type === 'llm' || src.type === 'textSplit') &&
                e.targetHandle === 'input'
              );
            }),
          ...readVideoInputPanelProgressFromNode(node),
        });
        setLlmInputPanelData(null);
        setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
      } else if (nodeType === 'character') {
        // Character 节点：构建输入面板数据
        const incomingEdges = edges.filter((e) => e.target === node.id);
        
        let resolvedVideoUrl = node.data?.videoUrl || '';
        let isConnected = false;

        // 检查是否有来自 video 节点的连接
        incomingEdges.forEach((edge) => {
          const sourceNode = nodes.find((n) => n.id === edge.source);
          if (sourceNode && isVideoTrackSourceNodeType(sourceNode.type)) {
            // 优先使用 originalVideoUrl（网络 URL）
            if (sourceNode.data?.originalVideoUrl) {
              resolvedVideoUrl = sourceNode.data.originalVideoUrl as string;
              isConnected = true;
            } else if (sourceNode.data?.outputVideo) {
              const outputVideo = sourceNode.data.outputVideo as string;
              // 如果是网络 URL，直接使用
              if (outputVideo.startsWith('http://') || outputVideo.startsWith('https://')) {
                resolvedVideoUrl = outputVideo;
                isConnected = true;
              } else if (outputVideo.startsWith('local-resource://') || outputVideo.startsWith('file://')) {
                // 如果是本地路径，使用节点数据中的值（可能已经设置了 needsUpload）
                resolvedVideoUrl = node.data?.videoUrl || outputVideo;
                isConnected = true;
              }
            }
          }
        });

        // 检查是否需要上传（从节点数据读取，或根据 videoUrl 判断）
        // 如果 resolvedVideoUrl 是网络 URL，不需要上传
        const needsUpload = node.data?.needsUpload || 
          (resolvedVideoUrl && 
           !(resolvedVideoUrl.startsWith('http://') || resolvedVideoUrl.startsWith('https://')) &&
           (resolvedVideoUrl.startsWith('local-resource://') || resolvedVideoUrl.startsWith('file://')));
        const localVideoPath = node.data?.localVideoPath || (needsUpload ? resolvedVideoUrl : undefined);
        
        // 如果 resolvedVideoUrl 是网络 URL，确保不需要上传
        const finalNeedsUpload = resolvedVideoUrl && (resolvedVideoUrl.startsWith('http://') || resolvedVideoUrl.startsWith('https://')) 
          ? false 
          : needsUpload;

        setCharacterInputPanelData({
          nodeId: node.id,
          videoUrl: resolvedVideoUrl,
          nickname: node.data?.nickname || '',
          timestamp: node.data?.timestamp || '1,3', // 默认时间戳为 "1,3"
          characterChannel: (node.data?.characterChannel as 'plugin' | 'core') || 'core',
          isConnected,
          needsUpload: finalNeedsUpload || false, // 从节点数据中读取或根据 URL 判断
          localVideoPath: finalNeedsUpload ? localVideoPath : undefined, // 只有需要上传时才保存本地路径
          isUploading: false, // 默认未开始上传
        });
        setLlmInputPanelData(null);
        setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
        setVideoInputPanelData(null);
      } else if (nodeType === 'audio') {
        // Audio 节点：构建输入面板数据
        const incomingEdges = edges.filter((e) => e.target === node.id);
        
        let resolvedText = node.data?.text || '';
        let isTextConnected = false;

        let resolvedReferenceAudioUrl = node.data?.referenceAudioUrl || '';
        let resolvedSourceSongAudioUrl = (node.data?.sourceSongAudioUrl as string | undefined) ?? '';
        const edgePatch = buildAudioIncomingPatchFromEdges(
          node.id,
          nodes,
          edges,
          node.data as Record<string, unknown>,
        );
        if (edgePatch?.referenceAudioUrl) resolvedReferenceAudioUrl = edgePatch.referenceAudioUrl;
        if (edgePatch?.sourceSongAudioUrl) resolvedSourceSongAudioUrl = edgePatch.sourceSongAudioUrl;
        const isAudioConnected = !!(edgePatch?.referenceAudioUrl || '').trim();
        const isSourceSongConnected = !!(edgePatch?.sourceSongAudioUrl || '').trim();

        if (edgePatch?.model && edgePatch.model !== node.data?.model) {
          setNodes((nds) =>
            nds.map((n) =>
              n.id === node.id ? { ...n, data: { ...n.data, ...edgePatch } } : n,
            ),
          );
        }
        let audioModel = edgePatch?.model || node.data?.model || 'speech-2.8-hd';
        incomingEdges.forEach((edge) => {
          const sourceNode = nodes.find((n) => n.id === edge.source);
          if (sourceNode) {
            if (
              sourceNode.type === 'minimalistText' ||
              sourceNode.type === 'text' ||
              sourceNode.type === 'textSplit' ||
              sourceNode.type === 'audioTranscribe'
            ) {
              const t =
                sourceNode.type === 'textSplit'
                  ? pickTextSplitSegmentText(sourceNode.data, edge.sourceHandle)
                  : sourceNode.data?.text || resolvedText;
              if (t) resolvedText = t;
              isTextConnected = true;
            } else if (sourceNode.type === 'llm') {
              resolvedText = sourceNode.data?.outputText || resolvedText;
              isTextConnected = true;
            }
          }
        });

        if (isRetiredAudioModel(audioModel)) {
          audioModel = normalizeAudioModelIfRetired(audioModel);
          setNodes((nds) =>
            nds.map((n) =>
              n.id === node.id && isRetiredAudioModel(String(n.data?.model || ''))
                ? { ...n, data: { ...n.data, model: audioModel } }
                : n,
            ),
          );
        }
        const isRhartSong = isAudioSongModel(audioModel);
        const resolvedLyrics = (node.data?.lyrics ?? '').trim() || (isRhartSong ? resolvedText : '');
        if (isRhartSong && resolvedLyrics && !(node.data?.lyrics ?? '').trim()) {
          setNodes((nds) =>
            nds.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, lyrics: resolvedLyrics } } : n))
          );
        }
        setAudioInputPanelData({
          nodeId: node.id,
          text: resolvedText,
          model: audioModel,
          voiceId: node.data?.voiceId || 'Wise_Woman',
          speed: node.data?.speed ?? 1,
          volume: node.data?.volume ?? 1,
          pitch: node.data?.pitch ?? 0,
          emotion: node.data?.emotion,
          isTextConnected,
          isAudioConnected,
          isSourceSongConnected,
          referenceAudioUrl: edgePatch?.referenceAudioUrl ?? resolvedReferenceAudioUrl,
          sourceSongAudioUrl: edgePatch?.sourceSongAudioUrl ?? resolvedSourceSongAudioUrl,
          coverPitch: clampCoverPitch(node.data?.coverPitch ?? 0),
          coverIndexRate: clampCoverIndexRate(node.data?.coverIndexRate),
          coverVocalMixPct: clampCoverVocalMixPct(node.data?.coverVocalMixPct),
          coverAccompanimentMixPct: resolveCoverAccompanimentMixPct(
            node.data?.coverAccompanimentMixPct,
            node.data?.coverOutputMode,
          ),
          coverRhVolume: (node.data?.coverRhVolume as number | undefined) ?? 5,
          rvcTrainModelName:
            edgePatch?.rvcTrainModelName ??
            (node.data?.rvcTrainModelName as string) ??
            (node.data?.title as string) ??
            '',
          rvcCoverModelName:
            edgePatch?.rvcCoverModelName ??
            (node.data?.rvcCoverModelName as string) ??
            resolveRvcCoverModelPath(node.data as Record<string, unknown>),
          outputModelUrl: (edgePatch?.outputModelUrl ?? node.data?.outputModelUrl) as string | undefined,
          outputModelRemoteUrl: (edgePatch?.outputModelRemoteUrl ??
            node.data?.outputModelRemoteUrl) as string | undefined,
          coverReferenceAudioUrl: (edgePatch?.coverReferenceAudioUrl ??
            node.data?.coverReferenceAudioUrl) as string | undefined,
          libraryRvcVoiceId: (edgePatch?.libraryRvcVoiceId ??
            node.data?.libraryRvcVoiceId) as string | undefined,
          songName: node.data?.songName ?? '',
          styleDesc: node.data?.styleDesc ?? '',
          lyrics: resolvedLyrics,
          speechRate: clampDoubaoSpeechRate(node.data?.speechRate ?? 0),
          loudnessRate: clampDoubaoLoudnessRate(node.data?.loudnessRate ?? 0),
        });
        setLlmInputPanelData(null);
        setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
        setVideoInputPanelData(null);
        setCharacterInputPanelData(null);
      } else {
        // 文本、拆分等无底部操作框的节点：仅选中，关闭所有面板
        setLlmInputPanelData(null);
        setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
        setVideoInputPanelData(null);
        setCharacterInputPanelData(null);
        setAudioInputPanelData(null);
        setStoryboardScriptInputPanelData(null);
        setDirectorInputPanelData(null);
      }
      } catch (err) {
        console.error('[Workspace] onNodeClick 设置面板时出错:', err);
      }
    },
    [
      edges,
      nodes,
      setNodes,
      globalPersonas,
      finishCharacterAvatarPick,
      finishCharacterVoicePick,
      finishSceneImagePick,
      finishDigitalHumanVideoPick,
      cancelCharacterCanvasPick,
      cancelQuickConnect,
      beginQuickConnect,
      onConnect,
      finalizeVideoSpliceTimeline,
      finalizePhotoCollageLayers,
      finalizeGridMapCells,
      finalizeImageComparerUrls,
      showAlert,
      locale,
      isDarkMode,
    ]
  );

  // 用 ref 包装 onNodeClick，保证传给 React Flow 的始终是“调用最新逻辑”的稳定引用，避免子组件拿到旧闭包导致点击无反应
  const onNodeClickRef = useRef(onNodeClick);
  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
  }, [onNodeClick]);

  useEffect(() => {
    const onPickNode = (ev: Event) => {
      const nodeId = (ev as CustomEvent<{ nodeId: string }>).detail?.nodeId;
      if (!nodeId || !characterAvatarPickPendingRef.current) return;
      const node = latestNodesRef.current.find((n) => n.id === nodeId);
      if (node) onNodeClickRef.current?.({} as React.MouseEvent, node);
    };
    window.addEventListener(CANVAS_PICK_NODE_EVENT, onPickNode);
    return () => window.removeEventListener(CANVAS_PICK_NODE_EVENT, onPickNode);
  }, []);

  /** HeyGem「数字人库」等：打开左侧素材库时展开侧栏 */
  useEffect(() => {
    const onOpenAssetLibrary = () => {
      setCharacterListCollapsed(false);
    };
    window.addEventListener(OPEN_ASSET_LIBRARY_EVENT, onOpenAssetLibrary);
    return () => window.removeEventListener(OPEN_ASSET_LIBRARY_EVENT, onOpenAssetLibrary);
  }, []);

  const onNodeClickStable = useCallback((e: React.MouseEvent, node: Node) => {
    if (node?.id) {
      lastNodeClickRef.current = { id: node.id, at: Date.now() };
    }
    const fn = onNodeClickRef.current;
    if (typeof fn === 'function') {
      try {
        fn(e, node);
      } catch (err) {
        console.error('[Workspace] onNodeClick 执行出错:', err);
      }
    }
  }, []);

  // 选择变化：清空时关闭面板；单选任意有操作框的节点时补开面板（兜底：框选、键盘等未触发 onNodeClick）
  const onSelectionChange = useCallback(
    (current: { nodes: Node[]; edges: Edge[] }) => {
      if (!current) return;
      if ((window as Window & { __nexflowVoiceModalOpen?: boolean }).__nexflowVoiceModalOpen) {
        return;
      }
      if (current.nodes.length === 0 && current.edges.length === 0) {
        setSelectedNode(null);
        setLlmInputPanelData(null);
        setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
        setVideoInputPanelData(null);
        setCharacterInputPanelData(null);
        setAudioInputPanelData(null);
        setStoryboardScriptInputPanelData(null);
        setDirectorInputPanelData(null);
        return;
      }
      // 多选（框选等）：不显示底部单节点操作栏
      if (current.nodes.length > 1) {
        setSelectedNode(null);
        setLlmInputPanelData(null);
        setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
        setVideoInputPanelData(null);
        setCharacterInputPanelData(null);
        setAudioInputPanelData(null);
        setStoryboardScriptInputPanelData(null);
        setDirectorInputPanelData(null);
        return;
      }
      // 单选任意有操作框的节点：补开对应面板（兜底：框选、键盘切换、双击编辑等未触发 onNodeClick 的情况）
      const HAS_PANEL_TYPES = ['video', 'character', 'image', 'imageTo3d', 'llm', 'audio', 'storyboardScript', 'director'];
      const sel = current.nodes[0];
      const nds = latestNodesRef.current as Node[];
      const node = (nds?.find((n) => n.id === sel?.id) ?? sel) as Node;
      const nodeType = node?.type ?? (node?.data as { nodeType?: string })?.nodeType ?? '';
      if (current.nodes.length === 1 && node?.id && HAS_PANEL_TYPES.includes(nodeType)) {
        // 角色库「画布点选」期间：禁止用 selection 回调再走 onNodeClick，否则会误当成用户点击节点而直接完成选取
        if (characterAvatarPickPendingRef.current) {
          return;
        }
        // Ctrl 快速连线期间：勿用 selection 回调补开面板 / 误触发连线
        if (quickConnectSourceIdRef.current) {
          return;
        }
        // 避免 React Flow 在节点数据（进度等）更新时重复触发 selection，导致 onNodeClick 再次
        // setImageInputPanelData 重置 prompt，底部提示词框与 localPrompt 反复同步而闪烁
        if (nodeType === 'image' && imageInputPanelDataRef.current?.nodeId === node.id) {
          return;
        }
        if (nodeType === 'imageTo3d' && imageTo3dInputPanelDataRef.current?.nodeId === node.id) {
          return;
        }
        // 与 Image 一致：避免节点 data 每次更新触发 selection 回调时用旧快照 setLlmInputPanelData，导致底部 LLM 输入框受控值被覆盖、光标跳到末尾
        if (nodeType === 'llm' && llmInputPanelDataRef.current?.nodeId === node.id) {
          return;
        }
        if (nodeType === 'storyboardScript' && storyboardScriptInputPanelDataRef.current?.nodeId === node.id) {
          return;
        }
        if (nodeType === 'director' && directorInputPanelDataRef.current?.nodeId === node.id) {
          return;
        }
        // 与 Image/LLM 一致：避免改比例等 data 更新触发 selection 回调后重复 onNodeClick，外框反复重算抖动
        if (isVideoModuleNodeType(nodeType) && videoInputPanelDataRef.current?.nodeId === node.id) {
          return;
        }
        try {
          onNodeClickRef.current(null as unknown as React.MouseEvent, node);
        } catch (err) {
          console.error('[Workspace] onSelectionChange 补开面板时出错:', err);
        }
      }
    },
    []
  );

  // 阻止在调整大小时拖动节点
  const onNodeDragStart = useCallback((_event: React.MouseEvent, node: Node) => {
    // 检查是否正在调整大小（通过检查节点数据中的标记）
    if (node.data?._isResizing) {
      return false;
    }
    isNodeDraggingRef.current = true;
    setSelectedEdge(null);
    const selectedCount = (latestNodesRef.current as Node[]).reduce((count, n) => {
      if (n.id === node.id || n.selected) return count + 1;
      return count;
    }, 0);
    isGroupDraggingRef.current = selectedCount > 1;
    pendingPositionChangesRef.current = [];
    if (positionChangeRafRef.current !== null) {
      cancelAnimationFrame(positionChangeRafRef.current);
      positionChangeRafRef.current = null;
    }
    dragNodeHashRef.current.set(node.id, buildNodePersistHash(node));
  }, [buildNodePersistHash]);

  const onNodeDrag = useCallback((_event: React.MouseEvent, node: Node) => {
    if (!isNodeDraggingRef.current) return;
    dragNodeHashRef.current.set(node.id, buildNodePersistHash(node));
  }, [buildNodePersistHash]);

  // 节点拖拽停止事件：仅在动作结束时执行一次脏检查并落盘
  const onNodeDragStop = useCallback(async (_event: React.MouseEvent, node: Node) => {
    if (isExitingRef.current) return;
    isNodeDraggingRef.current = false;
    const wasGroupDragging = isGroupDraggingRef.current;
    isGroupDraggingRef.current = false;
    pendingPositionChangesRef.current = [];
    if (positionChangeRafRef.current !== null) {
      cancelAnimationFrame(positionChangeRafRef.current);
      positionChangeRafRef.current = null;
    }
    if (!Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y)) {
      dragNodeHashRef.current.delete(node.id);
      return;
    }

    if (wasGroupDragging) {
      dragNodeHashRef.current.delete(node.id);
      if (!projectId || !window.electronAPI) return;
      try {
        const currentNodes = latestNodesRef.current as Node[];
        const currentEdges = latestEdgesRef.current as Edge[];
        await saveProjectNow({ nodes: currentNodes, edges: currentEdges });
      } catch (error) {
        console.error('保存多选拖拽位置失败:', error);
      }
      return;
    }

    // Transform-only 拖拽结束：一次性提交最终坐标到状态树
    // 同时构造“用于落盘”的稳定快照，避免 latestNodesRef 异步更新时仍保存旧坐标。
    const currentNodes = latestNodesRef.current as Node[];
    let hasNodeChange = false;
    const nodesAfterDrag = currentNodes.map((n) => {
      if (n.id !== node.id) return n;
      const samePosition = n.position?.x === node.position.x && n.position?.y === node.position.y;
      const sameDragging = !n.dragging;
      if (samePosition && sameDragging) return n;
      hasNodeChange = true;
      return {
        ...n,
        position: { x: node.position.x, y: node.position.y },
        dragging: false,
      };
    });
    if (hasNodeChange) {
      latestNodesRef.current = nodesAfterDrag as Node[];
      setNodes(nodesAfterDrag as Node[]);
    }
    if (!projectId || !window.electronAPI) return;
    const latestNode = (hasNodeChange ? nodesAfterDrag : currentNodes).find((n) => n.id === node.id) || node;
    const latestHash = buildNodePersistHash(latestNode);
    const previousHash = persistedNodeHashRef.current.get(node.id);
    dragNodeHashRef.current.delete(node.id);
    if (previousHash === latestHash) return;
    try {
      const currentEdges = latestEdgesRef.current as Edge[];
      const snapNodes = hasNodeChange ? (nodesAfterDrag as Node[]) : currentNodes;
      await saveProjectNow({ nodes: snapNodes, edges: currentEdges });
    } catch (error) {
      console.error('保存节点位置失败:', error);
    }
  }, [projectId, buildNodePersistHash, saveProjectNow]);


  // 点击连接线：选中并高亮绿；再次点击连接线（任意位置）显示剪刀，点击剪刀删除
  const onEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    setSelectedNode(null);
    if (selectedEdge?.id === edge.id) {
      // 已选中状态下再次点击 → 显示/隐藏剪刀
      setEdgeDeleteModeId((mid) => (mid === edge.id ? null : edge.id));
      return;
    }
    setEdgeDeleteModeId(null);
    setSelectedEdge(edge);
  }, [selectedEdge?.id]);

  const onEdgeCenterClick = useCallback((edge: Edge) => {
    setEdgeDeleteModeId((mid) => (mid === edge.id ? null : edge.id));
  }, []);

  const onEdgeDeleteRequest = useCallback((edgeId: string) => {
    setEdges((prev) => prev.filter((e) => e.id !== edgeId));
    setSelectedEdge(null);
    setEdgeDeleteModeId(null);
  }, []);

  // 下载图片
  const handleDownloadImage = useCallback(async (taskId: string, imageUrl: string, nodeTitle: string) => {
    if (!window.electronAPI) {
      console.error('electronAPI 不可用');
      return;
    }

    try {
      if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
        const localPath = imageUrl.startsWith('local-resource://')
          ? imageUrl
          : `local-resource://${imageUrl.replace(/^file:\/\/\/?/, '')}`;
        const result = await window.electronAPI.downloadLocalFileToFolder(localPath, nodeTitle);
        if (!result.success && result.error && !result.error.includes('取消')) {
          console.error('图片另存为失败:', result.error);
        }
        return;
      }

      const result = await window.electronAPI.downloadImage(imageUrl, nodeTitle);
      if (result.success && result.filePath) {
        console.log('图片下载成功:', result.filePath);
        // 更新任务的本地文件路径
        setTasks((prevTasks) =>
          prevTasks.map((task) =>
            task.id === taskId
              ? { ...task, localFilePath: result.filePath }
              : task
          )
        );
      } else {
        console.error('图片下载失败:', result.error);
      }
    } catch (error) {
      console.error('下载图片时出错:', error);
    }
  }, []);

  // 下载本地文件：复制到用户选择的下载目录
  const handleDownloadLocalTaskFile = useCallback(async (filePath: string, preferredFileName?: string) => {
    if (!window.electronAPI) {
      console.error('electronAPI 不可用');
      return;
    }

    try {
      const result = await window.electronAPI.downloadLocalFileToFolder(filePath, preferredFileName);
      if (!result.success) {
        console.error('复制文件到下载目录失败:', result.error);
      }
    } catch (error) {
      console.error('下载本地任务文件时出错:', error);
    }
  }, []);


  // 处理粘贴图片：在画布中自动创建 Image 节点并展示图片，节点出现在鼠标位置
  useEffect(() => {
    const handlePaste = async (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items || !reactFlowWrapper.current) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (!file) continue;

          let outputPreviewUrl = '';
          let originalImageUrl = '';
          let localPath = '';
          let tinyThumbUrl = '';
          let avgColorHex = '';
          let ghostBase64 = '';
          let assetWidth: number | undefined;
          let assetHeight: number | undefined;
          try {
            if (window.electronAPI?.createImageLocalResourceFromBuffer) {
              const ab = await file.arrayBuffer();
              const resource = await window.electronAPI.createImageLocalResourceFromBuffer(projectId || undefined, file.name || 'pasted-image.png', ab);
              outputPreviewUrl = resource.previewUrl;
              originalImageUrl = resource.originalUrl;
              localPath = resource.originalPath;
              tinyThumbUrl = resource.tinyUrl || '';
              avgColorHex = resource.avgColorHex || '';
              ghostBase64 = resource.ghostBase64 || '';
              assetWidth = resource.width;
              assetHeight = resource.height;
            }
          } catch (error) {
            console.error('[Workspace] 粘贴图片创建本地资源失败:', error);
          }

          const api = flowContentApiRef.current;
          let position = { x: 100, y: 100 };
          if (api) {
            const last = api.getLastMousePosition();
            if (last && (last.x !== 0 || last.y !== 0)) {
              position = api.screenToFlowPosition(last);
            } else {
              const pane = reactFlowWrapper.current?.querySelector('.react-flow') as HTMLElement;
              const rect = pane?.getBoundingClientRect();
              if (rect) {
                position = api.screenToFlowPosition({
                  x: rect.left + rect.width / 2,
                  y: rect.top + rect.height / 2,
                });
              }
            }
          }

          const newNode: Node = {
            id: `image-${Date.now()}`,
            type: 'image',
            position,
            data: {
              label: '图片节点',
              width: IMAGE_NODE_DEFAULT_W,
              height: IMAGE_NODE_DEFAULT_H,
              moduleSizeScaleVersion: MODULE_SIZE_SCALE_VERSION,
              title: 'image',
              resolution: '1k',
              aspectRatio: DEFAULT_IMAGE_ASPECT_RATIO,
              model: 'banana-2.0',
              outputImage: outputPreviewUrl,
              originalImageUrl,
              localPath,
              tinyThumbUrl,
              avgColorHex,
              imageAsset: {
                preview: outputPreviewUrl,
                original: originalImageUrl,
                tiny: tinyThumbUrl,
                ghost: ghostBase64,
                avgColorHex,
                width: assetWidth,
                height: assetHeight,
              },
            },
          };

          setNodes((nds) => nds.concat(newNode));

          break;
        }
      }
    };

    window.addEventListener('paste', handlePaste as any);
    return () => {
      window.removeEventListener('paste', handlePaste as any);
    };
  }, [projectId, setNodes]);

  // 删除任务
  const handleDeleteTask = useCallback((taskId: string) => {
    setTasks((prevTasks) => prevTasks.filter((task) => task.id !== taskId));
  }, []);

  // 清空全部任务（任务过多时减轻内存与渲染压力）
  const handleClearAllTasks = useCallback(async () => {
    if (tasks.length === 0) return;
    const ok = await showConfirm(`确定清空全部 ${tasks.length} 个任务吗？此操作不可恢复。`);
    if (ok) setTasks([]);
  }, [tasks.length, showConfirm]);

  // 任务列表预览回调（用于 WorkspaceSidebar，避免重复渲染；传入 nodeId 时启用打标签工具）
  const onPreviewImageFromTask = useCallback((url: string, nodeId?: string) => {
    setPreviewImage(url);
    setPreviewImageNodeId(nodeId ?? null);
    setSelectedNode(null);
    setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
    setLlmInputPanelData(null);
    setVideoInputPanelData(null);
  }, []);
  const onPreviewAudioFromTask = useCallback((url: string) => {
    setPreviewAudio(url);
    setSelectedNode(null);
    setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
    setLlmInputPanelData(null);
    setVideoInputPanelData(null);
    setAudioInputPanelData(null);
  }, []);

  // 角色选择：填充 roleId 到视频节点 prompt
  const handleSelectCharacter = useCallback(
    (character: Character) => {
      if (!selectedNode || !isVideoModuleNodeType(selectedNode.type) || !character.roleId) return;
      const roleIdText = `@${character.roleId}`;
      const currentPrompt = (selectedNode.data?.prompt as string) || '';
      if (currentPrompt.includes(roleIdText)) return;
      const newPrompt = currentPrompt.trim() ? `${currentPrompt} ${roleIdText}` : roleIdText;
      setNodes((nds) =>
        nds.map((node) =>
          node.id === selectedNode.id ? { ...node, data: { ...node.data, prompt: newPrompt } } : node
        )
      );
      if (videoInputPanelData && videoInputPanelData.nodeId === selectedNode.id) {
        setVideoInputPanelData((prev) => (prev ? { ...prev, prompt: newPrompt } : prev));
      }
    },
    [selectedNode, videoInputPanelData, setNodes, setVideoInputPanelData]
  );

  /** 从画布点选角色参考时：关闭底部单节点操作栏，避免与遮罩层叠 */
  const clearBottomModulePanelsForCanvasPick = useCallback(() => {
    setSelectedNode(null);
    setLlmInputPanelData(null);
    setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
    setVideoInputPanelData(null);
    setCharacterInputPanelData(null);
    setAudioInputPanelData(null);
  }, []);

  /**
   * 从侧栏按钮进入「画布点选」时，会先关闭弹窗；若立即 set pending + overlay，
   * 同一记 click 可能落到下方节点上误触发选取。延后一帧再武装点选。
   */
  const scheduleCharacterCanvasPickArm = useCallback((arm: () => void) => {
    if (typeof window === 'undefined') {
      arm();
      return;
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.setTimeout(arm, 60);
      });
    });
  }, []);

  /** 添加角色：从画布点选参考图（紫色遮罩 + 取消；Esc / 点空白同取消） */
  const requestAvatarPickFromCanvas = useCallback(() => {
    return new Promise<string | null>((resolve) => {
      scheduleCharacterCanvasPickArm(() => {
        if (characterAvatarPickPendingRef.current) {
          cancelCharacterCanvasPick();
        }
        characterVoicePickResolveRef.current = null;
        setCharacterListCollapsed(false);
        characterCanvasPickTargetRef.current = 'avatar';
        setCharacterCanvasPickTarget('avatar');
        characterAvatarPickPendingRef.current = true;
        clearBottomModulePanelsForCanvasPick();
        setCharacterAvatarPickOverlay(true);
        characterAvatarPickResolveRef.current = resolve;
      });
    });
  }, [cancelCharacterCanvasPick, clearBottomModulePanelsForCanvasPick, scheduleCharacterCanvasPickArm]);

  /** 添加角色：从画布点选参考音（同一套遮罩与取消逻辑） */
  const requestVoicePickFromCanvas = useCallback(() => {
    return new Promise<{ url: string; label: string } | null>((resolve) => {
      scheduleCharacterCanvasPickArm(() => {
        if (characterAvatarPickPendingRef.current) {
          cancelCharacterCanvasPick();
        }
        characterAvatarPickResolveRef.current = null;
        sceneImagePickResolveRef.current = null;
        digitalHumanVideoPickResolveRef.current = null;
        setCharacterListCollapsed(false);
        characterCanvasPickTargetRef.current = 'voice';
        setCharacterCanvasPickTarget('voice');
        characterAvatarPickPendingRef.current = true;
        clearBottomModulePanelsForCanvasPick();
        setCharacterAvatarPickOverlay(true);
        characterVoicePickResolveRef.current = resolve;
      });
    });
  }, [cancelCharacterCanvasPick, clearBottomModulePanelsForCanvasPick, scheduleCharacterCanvasPickArm]);

  /** 添加角色：从画布点选写入四视图某一槽（与参考图相同的可点选范围） */
  const requestViewSlotPickFromCanvas = useCallback(
    (_slotIndex: number) => {
      return new Promise<string | null>((resolve) => {
        scheduleCharacterCanvasPickArm(() => {
          if (characterAvatarPickPendingRef.current) {
            cancelCharacterCanvasPick();
          }
          characterVoicePickResolveRef.current = null;
          setCharacterListCollapsed(false);
          characterCanvasPickTargetRef.current = 'view';
          setCharacterCanvasPickTarget('view');
          characterAvatarPickPendingRef.current = true;
          clearBottomModulePanelsForCanvasPick();
          setCharacterAvatarPickOverlay(true);
          characterAvatarPickResolveRef.current = resolve;
        });
      });
    },
    [cancelCharacterCanvasPick, clearBottomModulePanelsForCanvasPick, scheduleCharacterCanvasPickArm],
  );

  pickImageFromCanvasForGridMapRef.current = () => requestViewSlotPickFromCanvas(0);
  pickVideoFromCanvasRef.current = () => requestDigitalHumanVideoPickFromCanvas();

  const requestSceneImagePickFromCanvas = useCallback(
    (role: 'normal' | 'display3d') => {
      return new Promise<string | null>((resolve) => {
        scheduleCharacterCanvasPickArm(() => {
          if (characterAvatarPickPendingRef.current) {
            cancelCharacterCanvasPick();
          }
          characterAvatarPickResolveRef.current = null;
          characterVoicePickResolveRef.current = null;
          setCharacterListCollapsed(false);
          characterCanvasPickTargetRef.current = role === 'normal' ? 'sceneNormal' : 'sceneDisplay3d';
          setCharacterCanvasPickTarget(role === 'normal' ? 'sceneNormal' : 'sceneDisplay3d');
          characterAvatarPickPendingRef.current = true;
          clearBottomModulePanelsForCanvasPick();
          setCharacterAvatarPickOverlay(true);
          sceneImagePickResolveRef.current = resolve;
        });
      });
    },
    [cancelCharacterCanvasPick, clearBottomModulePanelsForCanvasPick, scheduleCharacterCanvasPickArm],
  );

  const requestDigitalHumanVideoPickFromCanvas = useCallback(() => {
    return new Promise<string | null>((resolve) => {
      scheduleCharacterCanvasPickArm(() => {
        if (characterAvatarPickPendingRef.current) {
          cancelCharacterCanvasPick();
        }
        characterAvatarPickResolveRef.current = null;
        characterVoicePickResolveRef.current = null;
        sceneImagePickResolveRef.current = null;
        setCharacterListCollapsed(false);
        characterCanvasPickTargetRef.current = 'digitalHumanVideo';
        setCharacterCanvasPickTarget('digitalHumanVideo');
        characterAvatarPickPendingRef.current = true;
        clearBottomModulePanelsForCanvasPick();
        setCharacterAvatarPickOverlay(true);
        digitalHumanVideoPickResolveRef.current = resolve;
      });
    });
  }, [cancelCharacterCanvasPick, clearBottomModulePanelsForCanvasPick, scheduleCharacterCanvasPickArm]);

  useEffect(() => {
    if (!characterAvatarPickOverlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!characterAvatarPickPendingRef.current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      cancelCharacterCanvasPick();
    };
    /** 点选模式：任意右键退出（不打开画布菜单） */
    const onContextMenu = (e: MouseEvent) => {
      if (!characterAvatarPickPendingRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      cancelCharacterCanvasPick();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, [characterAvatarPickOverlay, cancelCharacterCanvasPick]);

  // 下载视频（本地/远程均弹出另存为，可改文件名与类型）
  const handleDownloadVideo = useCallback(async (task: Task) => {
    if (!task.videoUrl || !window.electronAPI) return;
    try {
      const result = await window.electronAPI.downloadVideo(task.videoUrl, task.nodeTitle);
      if (result.success && result.filePath) {
        setTasks((prevTasks) => prevTasks.map((t) => (t.id === task.id ? { ...t, localFilePath: result.filePath } : t)));
        const localResourceUrl = `local-resource://${result.filePath.replace(/\\/g, '/')}`;
        setNodes((nds) =>
          nds.map((node) =>
            node.id === task.nodeId
              ? { ...node, data: { ...node.data, outputVideo: localResourceUrl, originalVideoUrl: task.videoUrl, progress: 0, errorMessage: undefined } }
              : node
          )
        );
        handleVideoNodeDataChange(task.nodeId, { outputVideo: localResourceUrl, originalVideoUrl: task.videoUrl, progress: 0, errorMessage: undefined });
      }
    } catch (error) {
      console.error('下载视频失败:', error);
    }
  }, [setTasks, setNodes, handleVideoNodeDataChange]);

  // 下载音频（本地/远程均弹出另存为；音乐模块自动填入歌曲名与扩展名）
  const handleDownloadAudio = useCallback(async (task: Task) => {
    const audioUrl =
      task.audioUrl ||
      (task.localFilePath
        ? task.localFilePath.startsWith('local-resource://') || task.localFilePath.startsWith('file://')
          ? task.localFilePath
          : `local-resource://${task.localFilePath.replace(/\\/g, '/')}`
        : '');
    if (!audioUrl || !window.electronAPI) return;

    const node = nodes.find((n) => n.id === task.nodeId);
    const suggestedName =
      task.downloadFileName ||
      buildMusicDownloadSuggestedName({
        model: node?.data?.model as string | undefined,
        songName: node?.data?.songName as string | undefined,
        fallbackTitle: task.nodeTitle,
        audioUrl,
      });

    try {
      const result = await window.electronAPI.downloadAudio(audioUrl, suggestedName);
      if (result.success && result.filePath) {
        setTasks((prevTasks) =>
          prevTasks.map((t) => (t.id === task.id ? { ...t, localFilePath: result.filePath } : t)),
        );
      }
    } catch (error) {
      console.error('下载音频失败:', error);
    }
  }, [setTasks, nodes]);

  // 批量运行节点
  const handleBatchRun = useCallback(async (nodeIds: string[]) => {
    if (!window.electronAPI || nodeIds.length === 0) {
      return;
    }
    if (batchRunInProgress) {
      return; // 避免重复点击
    }
    setBatchRunInProgress(true);
    const runPromises: Promise<void>[] = [];

    console.log('[Workspace] 开始批量运行节点:', nodeIds);

    // 遍历所有节点，构建 payload 并执行
    for (let i = 0; i < nodeIds.length; i++) {
      const nodeId = nodeIds[i];
      const node = nodes.find((n) => n.id === nodeId);
      
      if (!node) {
        console.warn(`[Workspace] 节点 ${nodeId} 不存在，跳过`);
        continue;
      }

      // 根据节点类型构建不同的 payload
      let modelId: string;
      let payload: any;

      if (isVideoModuleNodeType(node.type)) {
        modelId = 'video';
        const nodeData = node.data || {};
        let videoModel = node.type === 'wanAnimate' ? 'wan-animate' : node.type === 'heyGem' ? 'hey-gem' : nodeData.model || DEFAULT_VIDEO_MODEL_REPLACING_SORA2;
        if (HIDE_SORA2_AND_SORA_CHARACTER_UI && (videoModel === 'sora-2' || videoModel === 'sora-2-pro')) {
          videoModel = DEFAULT_VIDEO_MODEL_REPLACING_SORA2;
        }

        // 检查是否有必要的参数（WanAnimate 可不填提示词）
        if (!nodeData.prompt?.trim() && videoModel !== 'wan-animate' && videoModel !== 'hey-gem') {
          console.warn(`[Workspace] 视频节点 ${nodeId} 缺少提示词，跳过`);
          continue;
        }

        // 图生视频需要至少一张参考图
        const inputImages = nodeData.inputImages || [];
        const isImageToVideoMode = inputImages.length > 0;

        if (videoModel === 'ltx-2.3-hdr-multi' || videoModel === 'ltx-2.3-msr-av') {
          const bg = String(nodeData.ltx23HdrBackgroundImage || '').trim();
          const sb = (nodeData.inputImages as string[] | undefined) || [];
          const hdrCheck = validateLtx23HdrMultiInputs(bg, sb);
          if (!hdrCheck.ok) {
            console.warn(`[Workspace] 视频节点 ${nodeId} ${hdrCheck.error}，跳过`);
            continue;
          }
        } else if (
          videoModel !== 'hey-gem' &&
          (videoModel === 'ltx-2.3-lipsync' || videoModel === 'ltx-2.3-i2v' || isImageToVideoMode) &&
          inputImages.length === 0
        ) {
          console.warn(`[Workspace] 视频节点 ${nodeId} 图生视频/对口型模式但缺少参考图，跳过`);
          continue;
        }
        if (videoModel === 'hey-gem') {
          const refEdge = edges.find((e) => {
            if (e.target !== nodeId) return false;
            const src = nodes.find((n) => n.id === e.source);
            return isVideoTrackSourceNodeType(src?.type);
          });
          const refSource = refEdge ? nodes.find((n) => n.id === refEdge.source) : null;
          const hasRefVideo = isVideoTrackSourceNodeType(refSource?.type) && !!(refSource?.data?.outputVideo || refSource?.data?.originalVideoUrl);
          const audioEdge = edges.find((e) => {
            if (e.target !== nodeId) return false;
            const src = nodes.find((n) => n.id === e.source);
            return src?.type === 'audio';
          });
          const audioSource = audioEdge ? nodes.find((n) => n.id === audioEdge.source) : null;
          const hasAudio = !!(audioSource?.type === 'audio' && pickAudioOutputUrlFromAudioNodeData(audioSource.data as Record<string, unknown>));
          if (!hasRefVideo && !nodeData.referenceVideoUrl) {
            console.warn(`[Workspace] HeyGem 节点 ${nodeId} 缺少参考视频，跳过`);
            continue;
          }
          if (!hasAudio && !nodeData.inputAudioUrl) {
            console.warn(`[Workspace] HeyGem 节点 ${nodeId} 缺少驱动音频，跳过`);
            continue;
          }
        }

        if (videoModel === 'ltx-2.3-lipsync' || videoModel === 'ltx-2.3-msr-av') {
          const audioEdge = edges.find((e) => {
            if (e.target !== nodeId) return false;
            const src = nodes.find((n) => n.id === e.source);
            return src?.type === 'audio';
          });
          const audioSource = audioEdge ? nodes.find((n) => n.id === audioEdge.source) : null;
          const hasAudio = !!(audioSource?.type === 'audio' && pickAudioOutputUrlFromAudioNodeData(audioSource.data as Record<string, unknown>));
          if (!hasAudio && !nodeData.inputAudioUrl) {
            console.warn(
              `[Workspace] 视频节点 ${nodeId} ${
                videoModel === 'ltx-2.3-msr-av' ? 'LTX2.3-MSR 图像+声音' : 'LTX2.3 对口型'
              }需连接音频节点，跳过`,
            );
            continue;
          }
        }

        payload = {
          prompt:
            videoModel === 'hey-gem' || videoModel === 'wan-animate' ? '' : nodeData.prompt,
          model: videoModel,
        };
        if (videoModel !== 'hey-gem' && videoModel !== 'wan-animate') {
          payload.aspect_ratio = nodeData.aspectRatio || '16:9';
        }

        // sora-2 系列参数
        if (payload.model === 'sora-2' || payload.model === 'sora-2-pro') {
          payload.hd = nodeData.hd ?? false;
          payload.duration = nodeData.duration || '5';
          payload.sora2Channel = nodeData.sora2Channel || 'plugin';
        }

        // kling-v2.6-pro 系列参数
        const isKlingModel = payload.model === 'kling-v2.6-pro';
        if (isKlingModel) {
          payload.duration = nodeData.duration || '5';
          if (nodeData.guidanceScale !== undefined) {
            payload.guidanceScale = nodeData.guidanceScale;
          }
          if (nodeData.sound) {
            payload.sound = nodeData.sound;
          }
        }

        // 万相2.6 / 全能V3.1 / 全能视频G 等参数（主进程从 input 读取）
        if (nodeData.resolutionRhartV31) payload.resolutionRhartV31 = nodeData.resolutionRhartV31;
        if (nodeData.durationWan26Flash) payload.durationWan26Flash = nodeData.durationWan26Flash;
        if (nodeData.shotType) payload.shotType = nodeData.shotType;
        if (nodeData.negativePrompt !== undefined) payload.negativePrompt = nodeData.negativePrompt;
        if (nodeData.enableAudio !== undefined) payload.enableAudio = nodeData.enableAudio;
        if (nodeData.durationVeo31ProOfficial) payload.durationVeo31ProOfficial = nodeData.durationVeo31ProOfficial;
        if (nodeData.generateAudioVeo31ProOfficial !== undefined) payload.generateAudioVeo31ProOfficial = nodeData.generateAudioVeo31ProOfficial;
        if (nodeData.resolutionWan26) payload.resolutionWan26 = nodeData.resolutionWan26;
        if (nodeData.durationGrok3 != null && String(nodeData.durationGrok3).trim() !== '') {
          payload.durationGrok3 = String(nodeData.durationGrok3).trim();
        }
        if (nodeData.resolutionGrok3) payload.resolutionGrok3 = nodeData.resolutionGrok3;
        if (nodeData.durationHailuo02) payload.durationHailuo02 = nodeData.durationHailuo02;
        if (nodeData.resolutionHailuo) payload.resolutionHailuo = nodeData.resolutionHailuo;
        if (nodeData.durationKlingO1) payload.durationKlingO1 = nodeData.durationKlingO1;
        if (nodeData.modeKlingO1) payload.modeKlingO1 = nodeData.modeKlingO1;

        // 可灵参考生视频o1：从连线解析参考视频 URL（统一 input 把手，按源类型识别）
        if (payload.model === 'kling-video-o1-ref') {
          const refEdge = edges.find((e) => {
            if (e.target !== nodeId) return false;
            const src = nodes.find((n) => n.id === e.source);
            return isVideoTrackSourceNodeType(src?.type);
          });
          const refSource = refEdge ? nodes.find((n) => n.id === refEdge.source) : null;
          const refUrl = isVideoTrackSourceNodeType(refSource?.type)
            ? (refSource.data?.originalVideoUrl || refSource.data?.outputVideo) as string | undefined
            : undefined;
          if (refUrl && (refUrl.startsWith('http://') || refUrl.startsWith('https://'))) {
            payload.referenceVideoUrl = refUrl;
          } else if (!refUrl || refUrl.trim() === '') {
            console.warn(`[Workspace] 视频节点 ${nodeId} 可灵参考生视频o1 未连接参考视频或参考视频非公网链接，跳过`);
            continue;
          } else {
            console.warn(`[Workspace] 视频节点 ${nodeId} 可灵参考生视频o1 的参考视频须为 http(s) 链接，跳过`);
            continue;
          }
          if (nodeData.keepOriginalSound === true) payload.keepOriginalSound = true;
        }

        if (payload.model === 'wan-animate') {
          const refEdgeWa = edges.find((e) => {
            if (e.target !== nodeId) return false;
            const src = nodes.find((n) => n.id === e.source);
            return isVideoTrackSourceNodeType(src?.type);
          });
          const refSourceWa = refEdgeWa ? nodes.find((n) => n.id === refEdgeWa.source) : null;
          const refUrlWa = isVideoTrackSourceNodeType(refSourceWa?.type)
            ? ((refSourceWa.data?.originalVideoUrl || refSourceWa.data?.outputVideo) as string | undefined)
            : undefined;
          const tWa = (refUrlWa || '').trim();
          if (
            !tWa ||
            !(
              tWa.startsWith('http://') ||
              tWa.startsWith('https://') ||
              tWa.startsWith('local-resource://') ||
              tWa.startsWith('file://')
            )
          ) {
            console.warn(`[Workspace] 视频节点 ${nodeId} WanAnimate 需连接参考视频（http(s)/本地），跳过`);
            continue;
          }
          payload.referenceVideoUrl = tWa;
          payload.resolutionWanAnimate = coerceVideoWanAnimateResolution(nodeData.resolutionWanAnimate);
          payload.wanAnimateClipSec = coerceWanAnimateClipSec(nodeData.wanAnimateClipSec);
        }

        if (payload.model === 'hey-gem') {
          // 一体化模块：优先节点内 referenceVideoUrl / inputAudioUrl，连线仅作回退
          let refUrlHg = String(nodeData.referenceVideoUrl || '').trim();
          if (!refUrlHg) {
            const refEdgeHg = edges.find((e) => {
              if (e.target !== nodeId) return false;
              const src = nodes.find((n) => n.id === e.source);
              return isVideoTrackSourceNodeType(src?.type);
            });
            const refSourceHg = refEdgeHg ? nodes.find((n) => n.id === refEdgeHg.source) : null;
            if (isVideoTrackSourceNodeType(refSourceHg?.type)) {
              refUrlHg = String(
                (refSourceHg.data?.originalVideoUrl || refSourceHg.data?.outputVideo) as string | undefined || '',
              ).trim();
            }
          }
          const tHg = (refUrlHg || '').trim();
          if (
            !tHg ||
            !(
              tHg.startsWith('http://') ||
              tHg.startsWith('https://') ||
              tHg.startsWith('local-resource://') ||
              tHg.startsWith('file://')
            )
          ) {
            console.warn(`[Workspace] HeyGem 节点 ${nodeId} 缺少参考视频，跳过`);
            continue;
          }
          payload.referenceVideoUrl = tHg;
          let inputAudioUrl = String(nodeData.inputAudioUrl || '').trim() || undefined;
          if (!inputAudioUrl) {
            const audioEdge = edges.find((e) => {
              if (e.target !== nodeId) return false;
              const src = nodes.find((n) => n.id === e.source);
              return src?.type === 'audio';
            });
            const audioSource = audioEdge ? nodes.find((n) => n.id === audioEdge.source) : null;
            if (audioSource?.type === 'audio') {
              inputAudioUrl = pickAudioOutputUrlFromAudioNodeData(audioSource.data as Record<string, unknown>);
            }
          }
          if (!inputAudioUrl) {
            console.warn(`[Workspace] HeyGem 节点 ${nodeId} 缺少驱动音频，跳过`);
            continue;
          }
          payload.inputAudioUrl = inputAudioUrl;
        }

        if (payload.model === 'seedance-2.0-fast' || payload.model === 'seedance-2.0-mini') {
          payload.resolutionSeedance = coerceVideoSeedanceResolution(nodeData.resolutionSeedance, payload.model);
          payload.durationSeedance = normalizeSeedanceDurationChoice(nodeData.durationSeedance, 10);
          payload.aspect_ratio = coerceSeedanceRatio(nodeData.aspectRatio);
        }

        if (payload.model === 'seedance-2.0-mini') {
          const refEdgeSd = edges.find((e) => {
            if (e.target !== nodeId) return false;
            const src = nodes.find((n) => n.id === e.source);
            return isVideoTrackSourceNodeType(src?.type);
          });
          const refSourceSd = refEdgeSd ? nodes.find((n) => n.id === refEdgeSd.source) : null;
          const refUrlSd = isVideoTrackSourceNodeType(refSourceSd?.type)
            ? ((refSourceSd.data?.originalVideoUrl || refSourceSd.data?.outputVideo) as string | undefined)
            : (nodeData.referenceVideoUrl as string | undefined);
          const tSd = (refUrlSd || '').trim();
          if (tSd) payload.referenceVideoUrl = tSd;

          let inputAudioUrlSd = nodeData.inputAudioUrl as string | undefined;
          if (!inputAudioUrlSd) {
            const audioEdgeSd = edges.find((e) => {
              if (e.target !== nodeId) return false;
              const src = nodes.find((n) => n.id === e.source);
              return src?.type === 'audio';
            });
            const audioSourceSd = audioEdgeSd ? nodes.find((n) => n.id === audioEdgeSd.source) : null;
            if (audioSourceSd?.type === 'audio') {
              inputAudioUrlSd = pickAudioOutputUrlFromAudioNodeData(audioSourceSd.data as Record<string, unknown>);
            }
          }
          if (inputAudioUrlSd) payload.inputAudioUrl = inputAudioUrlSd;
        }

        if (payload.model === 'gemini-omni' || payload.model === 'gemini-omni-flash') {
          payload.resolutionGeminiOmni = coerceVideoGeminiOmniResolution(nodeData.resolutionGeminiOmni);
          payload.durationGeminiOmni =
            payload.model === 'gemini-omni-flash'
              ? normalizeGeminiOmniFlashDurationChoice(nodeData.durationGeminiOmni, 6)
              : normalizeGeminiOmniDurationChoice(nodeData.durationGeminiOmni, 6);
          payload.aspect_ratio =
            nodeData.aspectRatio === '9:16' ? '9:16' : '16:9';
        }

        // 图生视频模式：添加图片（HeyGem 仅参考视频+音频，不传参考图）
        if (
          payload.model !== 'hey-gem' &&
          payload.model !== 'ltx-2.3-hdr-multi' &&
          payload.model !== 'ltx-2.3-msr-av' &&
          isImageToVideoMode &&
          inputImages.length > 0
        ) {
          payload.images =
            payload.model === 'ltx-2.3-lipsync' || payload.model === 'ltx-2.3-i2v' || payload.model === 'wan-animate'
              ? inputImages.slice(0, 1)
              : payload.model === 'gemini-omni' || payload.model === 'gemini-omni-flash'
                ? inputImages.filter((u) => String(u || '').trim()).slice(0, 3)
              : payload.model === 'seedance-2.0-fast' || payload.model === 'seedance-2.0-mini'
                ? inputImages.slice(0, 9)
                : inputImages.slice(0, 10);
        }

        // ltx-2.3-i2v 图生视频：时长、分辨率（工作流默认保持参考图比例）
        if (payload.model === 'ltx-2.3-i2v') {
          payload.durationLtx23I2v = normalizeLtx23DurationChoice(nodeData.durationLtx23I2v, 10);
          payload.resolutionLtx23I2v = (nodeData.resolutionLtx23I2v as '720' | '1280' | '1920') || '720';
        }
        // ltx-2.3-t2v 文生视频：时长、分辨率、比例
        if (payload.model === 'ltx-2.3-t2v') {
          payload.durationLtx23T2v = normalizeLtx23DurationChoice(nodeData.durationLtx23T2v, 10);
          payload.resolutionLtx23T2v = (nodeData.resolutionLtx23T2v as '720' | '1280' | '1920') || '720';
          payload.aspect_ratio = (nodeData.aspectRatio as '16:9' | '9:16') || '16:9';
        }
        if (payload.model === 'ltx-2.3-hdr-multi' || payload.model === 'ltx-2.3-msr-av') {
          const bg = String(nodeData.ltx23HdrBackgroundImage || '').trim();
          const storyboard = (nodeData.inputImages as string[] | undefined) || inputImages;
          const built = buildLtx23HdrMultiPayload(bg, storyboard);
          payload.ltx23HdrBackgroundImage = built.background;
          payload.images = built.storyboardSlots;
          payload.durationLtx23HdrMulti = normalizeLtx23DurationChoice(
            nodeData.durationLtx23HdrMulti,
            payload.model === 'ltx-2.3-msr-av' ? 10 : 15,
          );
          payload.resolutionLtx23HdrMulti = (() => {
            const r = String(nodeData.resolutionLtx23HdrMulti ?? '720');
            if (r === '1920' || r === '1080') return '1280' as const;
            if (r === '1280') return '1280' as const;
            return '720' as const;
          })();
          payload.aspect_ratio = (nodeData.aspectRatio as '16:9' | '9:16') || '16:9';
        }

        // ltx-2.3-lipsync：从连线或节点数据解析输入音频，并添加分辨率、动作提示词
        if (payload.model === 'ltx-2.3-lipsync') {
          let inputAudioUrl = nodeData.inputAudioUrl as string | undefined;
          if (!inputAudioUrl) {
            const audioEdge = edges.find((e) => {
              if (e.target !== nodeId) return false;
              const src = nodes.find((n) => n.id === e.source);
              return src?.type === 'audio';
            });
            const audioSource = audioEdge ? nodes.find((n) => n.id === audioEdge.source) : null;
            if (audioSource?.type === 'audio') {
              inputAudioUrl = pickAudioOutputUrlFromAudioNodeData(audioSource.data as Record<string, unknown>);
            }
          }
          payload.inputAudioUrl = inputAudioUrl || '';
          const res = (nodeData.resolutionLtx23Lipsync ?? nodeData.resolutionWan22Lipsync) as string | undefined;
          payload.resolutionLtx23Lipsync = (res === '720' || res === '1280' || res === '1920' ? res : '720') as '720' | '1280' | '1920';
          payload.actionPrompt = (nodeData.prompt as string) || '';
        }

        // ltx-2.3-msr-av：背景+分镜已在上方组装；补音频
        if (payload.model === 'ltx-2.3-msr-av') {
          let inputAudioUrlMsr = nodeData.inputAudioUrl as string | undefined;
          if (!inputAudioUrlMsr) {
            const audioEdge = edges.find((e) => {
              if (e.target !== nodeId) return false;
              const src = nodes.find((n) => n.id === e.source);
              return src?.type === 'audio';
            });
            const audioSource = audioEdge ? nodes.find((n) => n.id === audioEdge.source) : null;
            if (audioSource?.type === 'audio') {
              inputAudioUrlMsr = pickAudioOutputUrlFromAudioNodeData(audioSource.data as Record<string, unknown>);
            }
          }
          payload.inputAudioUrl = inputAudioUrlMsr || '';
        }

        // 添加项目ID
        if (projectId) {
          payload.projectId = projectId;
        }
      } else if (node.type === 'image') {
        modelId = 'image';
        const nodeData = node.data || {};
        
        // 检查是否有必要的参数
        if (!nodeData.prompt?.trim()) {
          console.warn(`[Workspace] 图片节点 ${nodeId} 缺少提示词，跳过`);
          continue;
        }

        const inputImages = nodeData.inputImages || [];
        const isImageToImageMode = inputImages.length > 0;

        // 判断是否支持 image_size（Nano banana 支持 1K/2K/4K）
        let model = nodeData.model || 'banana-2.0';
        if (model === 'rhart-image-g-1.5') model = 'banana-2.0';
        const supportsImageSize = model === 'nano-banana';
        
        // 从 resolution 解析 image_size（如果支持）
        let imageSize: '1K' | '2K' | '4K' | undefined;
        const resolution = nodeData.resolution || '1k';
        if (supportsImageSize) {
          if (resolution.includes('1k') || resolution.includes('512') || resolution.includes('768')) {
            imageSize = '1K';
          } else if (resolution.includes('2k') || resolution.includes('1024')) {
            imageSize = '2K';
          } else if (resolution.includes('4k') || resolution.includes('1792')) {
            imageSize = '4K';
          }
        }

        const payloadAspectRatio = nodeData.aspectRatio || DEFAULT_IMAGE_ASPECT_RATIO;
        payload = {
          model,
          prompt: nodeData.prompt,
          response_format: 'url',
          aspect_ratio: payloadAspectRatio,
          image_size: imageSize,
          resolution: nodeData.resolution || '1k',
        };
        if (model === 'seedream-v4.5') {
          const minS = 1024;
          const maxS = 4096;
          payload.seedreamWidth = Math.max(minS, Math.min(maxS, Number(nodeData.seedreamWidth) || 2048));
          payload.seedreamHeight = Math.max(minS, Math.min(maxS, Number(nodeData.seedreamHeight) || 2048));
        }
        if (model === 'seedream-v5') {
          payload.seedreamWidth = Math.max(1600, Math.min(4704, Number(nodeData.seedreamWidth) || 2048));
          payload.seedreamHeight = Math.max(1344, Math.min(4096, Number(nodeData.seedreamHeight) || 2048));
        }
        if (model === 'z-image' || model === 'lens' || model === 'flux2-klein') {
          const zRes = nodeData.resolution || '1080p';
          const auto = zImageDimensionsForAspect(payloadAspectRatio, zRes);
          payload.seedreamWidth = auto.width;
          payload.seedreamHeight = auto.height;
        }

        // 文悠船文生图-v7 可选 negativePrompt
        if (model === 'youchuan-text-to-image-v7' && nodeData.negativePrompt !== undefined) {
          payload.negativePrompt = nodeData.negativePrompt;
        }

        // 图生图模式：如果有输入图片，添加 image 参数
        if (isImageToImageMode && inputImages.length > 0) {
          const maxRefImages =
            model === 'flux2-klein' ? 3 : model === 'gpt-image-2' ? 2 : 10;
          payload.image = inputImages.slice(0, maxRefImages);
        }

        // 添加项目ID
        if (projectId) {
          payload.projectId = projectId;
        }
      } else if (node.type === 'llm') {
        modelId = 'chat';
        const nodeData = node.data || {};
        
        // 批量运行时从连线解析「图片反推」：存在来自 Image 节点的连线则取源节点 outputImage
        const incomingToLlm = edges.filter((e) => e.target === nodeId);
        const imageEdge = incomingToLlm.find((e) => {
          const src = nodes.find((n) => n.id === e.source);
          return src?.type === 'image' && src?.data?.outputImage;
        });
        const resolvedImageUrlForReverse = imageEdge
          ? (nodes.find((n) => n.id === imageEdge.source)?.data?.outputImage as string | undefined)
          : undefined;
        const isImageReverseMode = !!resolvedImageUrlForReverse;

        const userInput = nodeData.userInput?.trim() || '';
        const inputText = nodeData.inputText?.trim() || '';
        
        if (!isImageReverseMode && !userInput && !inputText) {
          console.warn(`[Workspace] LLM 节点 ${nodeId} 缺少输入内容，跳过`);
          continue;
        }

        // 图像反推模式
        if (isImageReverseMode && resolvedImageUrlForReverse) {
          const question = inputText.trim() || '这张图片有什么？';
          const reverseModel = normalizeImageReverseCaptionModel(
            nodeData.reverseCaptionModel as string | undefined,
          );
          payload = {
            model: reverseModel,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: question },
                  {
                    type: 'image_url',
                    image_url: {
                      url: resolvedImageUrlForReverse,
                    },
                  },
                ],
              },
            ],
            max_tokens: 400,
            stream: false,
          };
        } else {
          // 普通文本对话模式
          const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
          
          if (userInput) {
            messages.push({
              role: 'system',
              content: userInput,
            });
          }
          
          if (inputText) {
            messages.push({
              role: 'user',
              content: inputText,
            });
          }
          
          if (messages.length === 0) {
            console.warn(`[Workspace] LLM 节点 ${nodeId} 消息为空，跳过`);
            continue;
          }
          
          payload = {
            model: (node.data?.chatModel as string) || 'gpt-3.5-turbo',
            messages,
            temperature: 0.7,
            max_tokens: 2000,
            stream: false,
          };
        }

        // 添加项目ID和节点标题
        if (projectId) {
          payload.projectId = projectId;
        }
        const nodeTitle = node.data?.title || 'llm';
        payload.nodeTitle = nodeTitle;
      } else if (node.type === 'rvcTrain') {
        modelId = 'audio';
        const nodeData = node.data || {};
        let referenceAudioUrl =
          resolveRvcTrainAudioFromEdges(nodeId, nodes, edges) || String(nodeData.referenceAudioUrl ?? '').trim();
        const modelName = String(nodeData.rvcTrainModelName ?? nodeData.title ?? '').trim();
        if (!referenceAudioUrl || !modelName) {
          console.warn(`[Workspace] RVC 训练节点 ${nodeId} 缺少训练音频或模型名，跳过`);
          continue;
        }
        const normalizeLocalAudioUrl = (u: string) =>
          u.startsWith('local-resource://') || u.startsWith('file://')
            ? u.replace(/%5C/gi, '/').replace(/^local-resource:\/\/+/, 'local-resource://').replace(/^file:\/\/+/, 'file://')
            : u;
        referenceAudioUrl = normalizeLocalAudioUrl(referenceAudioUrl);
        payload = {
          model: RVC_VOICE_TRAIN_MODEL_ID,
          text: '',
          referenceAudioUrl,
          rvcTrainModelName: modelName,
          enable_base64_output: false,
          english_normalization: false,
        };
        if (projectId) payload.projectId = projectId;
        payload.nodeTitle = nodeData.title || 'rvcTrain';
      } else if (node.type === 'audio') {
        modelId = 'audio';
        const nodeData = node.data || {};
        const edgePatch = buildAudioIncomingPatchFromEdges(
          nodeId,
          nodes,
          edges,
          nodeData as Record<string, unknown>,
        );
        const audioModel = nodeData.model || 'speech-2.8-hd';
        const isIndexTts2 = audioModel === 'index-tts2';
        const isDoubaoSeedAudio = isDoubaoSeedAudioModel(audioModel);
        const isAudioCover = isAudioCoverModel(audioModel);
        const isRvcTrain = isRvcTrainModel(audioModel);
        const isRhartSong = isAudioSongModel(audioModel);

        if (isRhartSong) {
          if (!(nodeData.songName ?? '').trim() || !(nodeData.styleDesc ?? '').trim() || !(nodeData.lyrics ?? '').trim()) {
            console.warn(`[Workspace] 音频节点 ${nodeId} 全能写歌 缺少歌曲名/风格描述/歌词，跳过`);
            continue;
          }
        } else if (isAudioCover) {
          const pathHint = resolveRvcCoverModelPath({
            ...(nodeData as Record<string, unknown>),
            rvcCoverModelName: edgePatch?.rvcCoverModelName ?? nodeData.rvcCoverModelName,
            rvcTrainModelName: edgePatch?.rvcTrainModelName ?? nodeData.rvcTrainModelName,
          });
          const coverSource = (nodeData.sourceSongAudioUrl ?? edgePatch?.sourceSongAudioUrl ?? '').trim();
          if (!coverSource) {
            console.warn(`[Workspace] 音频节点 ${nodeId} RVC 翻唱 缺少原曲，跳过`);
            continue;
          }
          if (!pathHint && !(nodeData.outputModelUrl || nodeData.outputModelRemoteUrl || edgePatch?.outputModelUrl)) {
            console.warn(`[Workspace] 音频节点 ${nodeId} RVC 翻唱 缺少 RVC 模型（请连接已训练 rvcTrain），跳过`);
            continue;
          }
        } else if (isRvcTrain) {
          if (!(nodeData.referenceAudioUrl ?? '').trim() || !(nodeData.rvcTrainModelName ?? nodeData.title ?? '').trim()) {
            console.warn(`[Workspace] 音频节点 ${nodeId} RVC 训练 缺少训练音频或模型名，跳过`);
            continue;
          }
        } else {
          if (!nodeData.text?.trim()) {
            console.warn(`[Workspace] 音频节点 ${nodeId} 缺少文本，跳过`);
            continue;
          }
          if (!isIndexTts2 && !isDoubaoSeedAudio && !nodeData.voiceId) {
            console.warn(`[Workspace] 音频节点 ${nodeId} 缺少音色，跳过`);
            continue;
          }
        }
        // 参考音 / 翻唱：优先从入边解析
        let referenceAudioUrl = (nodeData.referenceAudioUrl || '').trim();
        let sourceSongAudioUrl = (nodeData.sourceSongAudioUrl || '').trim();
        const audioIncomingEdges = edges.filter((e) => e.target === nodeId);
        if (edgePatch?.referenceAudioUrl) referenceAudioUrl = edgePatch.referenceAudioUrl;
        if (edgePatch?.sourceSongAudioUrl) sourceSongAudioUrl = edgePatch.sourceSongAudioUrl;
        if (!isAudioCover) {
          for (const e of audioIncomingEdges) {
            const srcNode = nodes.find((n) => n.id === e.source);
            if (srcNode?.type === 'audio') {
              const d = srcNode.data as Record<string, unknown>;
              const httpOrig =
                typeof d.originalAudioUrl === 'string' && d.originalAudioUrl.startsWith('http') ? d.originalAudioUrl : '';
              const ref = httpOrig || pickAudioOutputUrlFromAudioNodeData(d) || '';
              if (ref) {
                referenceAudioUrl = ref;
                break;
              }
            }
          }
        }
        if (isIndexTts2 && !referenceAudioUrl) {
          console.warn(`[Workspace] 音频节点 ${nodeId} Index-TTS2.0 缺少参考音，跳过`);
          continue;
        }
        if (isAudioCover && (!sourceSongAudioUrl || (!resolveRvcCoverModelPath({
          ...(nodeData as Record<string, unknown>),
          rvcCoverModelName: edgePatch?.rvcCoverModelName ?? nodeData.rvcCoverModelName,
          rvcTrainModelName: edgePatch?.rvcTrainModelName ?? nodeData.rvcTrainModelName,
        }) && !(nodeData.outputModelUrl || nodeData.outputModelRemoteUrl || edgePatch?.outputModelUrl)))) {
          console.warn(`[Workspace] 音频节点 ${nodeId} RVC 翻唱 缺少原曲或 RVC 模型，跳过`);
          continue;
        }
        if (isRvcTrain && !referenceAudioUrl) {
          console.warn(`[Workspace] 音频节点 ${nodeId} RVC 训练 缺少训练音频，跳过`);
          continue;
        }
        const normalizeLocalAudioUrl = (u: string) =>
          u.startsWith('local-resource://') || u.startsWith('file://')
            ? u.replace(/%5C/gi, '/').replace(/^local-resource:\/\/+/, 'local-resource://').replace(/^file:\/\/+/, 'file://')
            : u;
        if (referenceAudioUrl) referenceAudioUrl = normalizeLocalAudioUrl(referenceAudioUrl);
        if (sourceSongAudioUrl) sourceSongAudioUrl = normalizeLocalAudioUrl(sourceSongAudioUrl);

        payload = {
          model: audioModel,
          text: (nodeData.text || '').trim(),
          enable_base64_output: false,
          english_normalization: false,
        };
        if (isRhartSong) {
          payload.songName = (nodeData.songName ?? '').trim();
          payload.styleDesc = (nodeData.styleDesc ?? '').trim();
          payload.lyrics = (nodeData.lyrics ?? '').trim();
        } else if (isAudioCover) {
          payload.sourceSongAudioUrl = sourceSongAudioUrl;
          payload.rvcCoverModelName = resolveRvcCoverModelPath({
            ...(nodeData as Record<string, unknown>),
            rvcCoverModelName: edgePatch?.rvcCoverModelName ?? nodeData.rvcCoverModelName,
            rvcTrainModelName: edgePatch?.rvcTrainModelName ?? nodeData.rvcTrainModelName,
          });
          payload.rvcTrainModelName = String(
            edgePatch?.rvcTrainModelName ?? nodeData.rvcTrainModelName ?? '',
          ).trim() || undefined;
          payload.libraryRvcVoiceId = (edgePatch?.libraryRvcVoiceId ?? nodeData.libraryRvcVoiceId) as
            | string
            | undefined;
          payload.outputModelUrl = (edgePatch?.outputModelUrl ?? nodeData.outputModelUrl) as string | undefined;
          payload.outputModelRemoteUrl = (edgePatch?.outputModelRemoteUrl ??
            nodeData.outputModelRemoteUrl) as string | undefined;
          payload.coverReferenceAudioUrl = (edgePatch?.coverReferenceAudioUrl ??
            nodeData.coverReferenceAudioUrl) as string | undefined;
          payload.coverPitch = clampCoverPitch(nodeData.coverPitch);
          payload.coverIndexRate = clampCoverIndexRate(nodeData.coverIndexRate);
          payload.coverVocalMixPct = clampCoverVocalMixPct(nodeData.coverVocalMixPct);
          payload.coverAccompanimentMixPct = resolveCoverAccompanimentMixPct(
            nodeData.coverAccompanimentMixPct,
            nodeData.coverOutputMode,
          );
        } else if (isRvcTrain) {
          payload.referenceAudioUrl = referenceAudioUrl;
          payload.rvcTrainModelName = String(nodeData.rvcTrainModelName ?? nodeData.title ?? '').trim();
        } else if (isDoubaoSeedAudio) {
          payload.model = DOUBAO_SEED_AUDIO_MODEL_ID;
          if (referenceAudioUrl) payload.referenceAudioUrl = referenceAudioUrl;
          payload.speechRate = clampDoubaoSpeechRate(nodeData.speechRate ?? 0);
          payload.loudnessRate = clampDoubaoLoudnessRate(nodeData.loudnessRate ?? 0);
          payload.pitch = nodeData.pitch ?? 0;
          payload.doubaoFormat = 'mp3';
          payload.doubaoSampleRate = '24000';
        } else if (isIndexTts2) {
          payload.referenceAudioUrl = referenceAudioUrl;
        } else {
          payload.voice_id = nodeData.voiceId || 'Wise_Woman';
          payload.speed = nodeData.speed ?? 1;
          payload.volume = nodeData.volume ?? 1;
          payload.pitch = nodeData.pitch ?? 0;
          if (nodeData.emotion) payload.emotion = nodeData.emotion;
        }
        if (projectId) payload.projectId = projectId;
      } else {
        console.warn(`[Workspace] 不支持的节点类型: ${node.type}，跳过`);
        continue;
      }

      // 批量运行时，立即初始化进度条（确保所有节点都能显示进度）
      if (isVideoModuleNodeType(node.type)) {
        // 设置初始进度（1%），确保显示进度条
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    progress: 1, // 设置为 1% 以显示进度条
                    progressMessage: '正在初始化...',
                    errorMessage: undefined, // 清除之前的错误信息
                  },
                }
              : n
          )
        );
        // 同步更新到 handleVideoNodeDataChange
        handleVideoNodeDataChange(nodeId, {
          progress: 1,
          progressMessage: '正在初始化...',
          errorMessage: undefined,
        });
      } else if (node.type === 'image') {
        // 图片节点也初始化进度条
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    progress: 1,
                    progressMessage: '正在初始化...',
                    errorMessage: undefined,
                  },
                }
              : n
          )
        );
        handleImageNodeDataChange(nodeId, {
          progress: 1,
          progressMessage: '正在初始化...',
          errorMessage: undefined,
        });
      } else if (node.type === 'llm') {
        // LLM 节点也初始化进度条
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    progress: 1, // 设置为 1% 以显示进度条
                    progressMessage: '正在初始化模型...',
                    errorMessage: undefined, // 清除之前的错误信息
                  },
                }
              : n
          )
        );
      } else if (node.type === 'audio') {
        // Audio 节点也初始化状态
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    aiStatus: 'START', // 设置为 START 状态以显示加载动画
                    errorMessage: undefined, // 清除之前的错误信息
                  },
                }
              : n
          )
        );
        // 同步更新到 handleAudioNodeDataChange
        handleAudioNodeDataChange(nodeId, {
          errorMessage: undefined,
        });
      }

      // 异步执行，使用 50ms 间隔错开请求，并收集 Promise 以便全部完成后解除“运行中”状态
      runPromises.push(
        new Promise<void>((resolve) => {
          setTimeout(async () => {
            try {
              console.log(`[Workspace] 执行节点 ${nodeId} (${node.type}):`, payload);
              await window.electronAPI.invokeAI({
                modelId,
                nodeId,
                input: payload,
              });
            } catch (error) {
              console.error(`[Workspace] 节点 ${nodeId} 执行失败:`, error);
              // 执行失败时，清除进度条并显示错误
              if (isVideoModuleNodeType(node.type)) {
                handleVideoNodeDataChange(nodeId, {
                  progress: 0,
                  errorMessage: error instanceof Error ? error.message : '执行失败',
                });
              } else if (node.type === 'image') {
                handleImageNodeDataChange(nodeId, {
                  progress: 0,
                  errorMessage: error instanceof Error ? error.message : '执行失败',
                });
              } else if (node.type === 'llm') {
                // LLM 节点执行失败时，清除进度条并显示错误
                setNodes((nds) =>
                  nds.map((n) =>
                    n.id === nodeId
                      ? {
                          ...n,
                          data: {
                            ...n.data,
                            progress: 0,
                            errorMessage: error instanceof Error ? error.message : '执行失败',
                          },
                        }
                      : n
                  )
                );
              } else if (node.type === 'audio') {
                // Audio 节点执行失败时，清除状态并显示错误
                setNodes((nds) =>
                  nds.map((n) =>
                    n.id === nodeId
                      ? {
                          ...n,
                          data: {
                            ...n.data,
                            aiStatus: 'ERROR', // 设置为 ERROR 状态
                            errorMessage: error instanceof Error ? error.message : '执行失败',
                          },
                        }
                      : n
                  )
                );
                handleAudioNodeDataChange(nodeId, {
                  errorMessage: error instanceof Error ? error.message : '执行失败',
                });
              }
            } finally {
              resolve();
            }
          }, i * 50); // 每个请求间隔 50ms
        })
      );
    }

    try {
      await Promise.all(runPromises);
    } finally {
      setBatchRunInProgress(false);
    }
  }, [nodes, projectId, setNodes, handleVideoNodeDataChange, handleImageNodeDataChange, handleAudioNodeDataChange, batchRunInProgress]);

  // 视频生成完成时，创建任务记录并自动保存到本地
  const handleAddVideoTask = useCallback((nodeId: string, videoUrl: string, prompt: string, originalVideoUrl?: string) => {
    const trimmedUrl = String(videoUrl || '').trim();
    if (!trimmedUrl) return;

    setTasks((prevTasks) => {
      const remoteForDedup =
        (originalVideoUrl && /^https?:\/\//i.test(originalVideoUrl.trim())
          ? originalVideoUrl.trim()
          : undefined) || (/^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : undefined);
      const incomingNorm = normalizeMediaUrlForTaskDedup(remoteForDedup || trimmedUrl);

      const existingTask = prevTasks.find(
        (task) =>
          task.nodeId === nodeId &&
          task.taskType === 'video' &&
          task.status === 'success' &&
          (mediaUrlsLikelySameArtifact(task.videoUrl, trimmedUrl) ||
            (() => {
              const tNorm = taskVideoDedupNorm(task);
              return Boolean(tNorm && incomingNorm && tNorm === incomingNorm);
            })()),
      );
      if (existingTask && !String(existingTask.id).startsWith('runtime-')) {
        console.log('[Workspace] 视频任务已存在，跳过添加');
        return prevTasks;
      }

      // 刚 spawn 的下游视频节点可能尚未写入 React state，优先 latestNodesRef；节点缺失时仍入库
      const node =
        latestNodesRef.current.find((n) => n.id === nodeId) ?? nodes.find((n) => n.id === nodeId);

      const nodeTitle = node?.data?.title || 'video';
      const runtimeTask = prevTasks.find((t) => t.id === `runtime-${nodeId}`);
      const durationSec =
        runtimeTask != null
          ? typeof runtimeTask.durationSec === 'number'
            ? runtimeTask.durationSec
            : Math.max(0, Math.floor((Date.now() - runtimeTask.createdAt) / 1000))
          : undefined;
      const yuanbaoConsumed =
        runtimeTask != null && typeof runtimeTask.yuanbaoConsumed === 'number'
          ? runtimeTask.yuanbaoConsumed
          : estimateYuanbaoForTaskNodeStatic(node, cloudMapRef.current);
      const newTask: Task = {
        id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        nodeId,
        nodeTitle,
        videoUrl: trimmedUrl,
        ...(remoteForDedup ? { originalVideoUrl: remoteForDedup } : {}),
        prompt: prompt || '无提示词',
        createdAt: Date.now(),
        status: 'success',
        taskType: 'video',
        ...(durationSec !== undefined ? { durationSec } : {}),
        ...(yuanbaoConsumed !== undefined ? { yuanbaoConsumed } : {}),
      };

      // 自动保存视频到本地
      if (window.electronAPI && projectId) {
        window.electronAPI
          .autoSaveVideo(trimmedUrl, nodeTitle, projectId)
          .then((result: any) => {
            if (result.success && result.filePath) {
              // 更新任务的本地文件路径
              setTasks((prev) =>
                prev.map((task) =>
                  task.id === newTask.id ? { ...task, localFilePath: result.filePath } : task
                )
              );
              
              // autoSaveVideo resolve 时主进程已落盘，无需再延迟 500ms；与任务列表写入同一步收紧画布与节点数据
              const targetNodeId = nodeId;
              console.log('[Workspace] 自动保存视频完成，更新节点:', targetNodeId, 'filePath:', result.filePath);
              let filePath = result.filePath.replace(/\\/g, '/');
              if (!filePath.startsWith('/') && filePath.match(/^[a-zA-Z]:/)) {
                filePath = '/' + filePath;
              }
              const localResourceUrl = `local-resource://${filePath}`;
              setNodes((nds) =>
                nds.map((n) =>
                  n.id === targetNodeId
                    ? { ...n, data: { ...n.data, outputVideo: localResourceUrl, progress: 0, errorMessage: undefined } }
                    : n
                )
              );
              handleVideoNodeDataChange(targetNodeId, { outputVideo: localResourceUrl, progress: 0, errorMessage: undefined });
            }
          })
          .catch((error) => {
            console.error('自动保存视频失败:', error);
          });
      }

      return [newTask, ...prevTasks.filter((t) => t.id !== `runtime-${nodeId}`)];
    });
  }, [nodes, projectId, handleVideoNodeDataChange]);

  const heyGemSpawnedUrlRef = useRef<Map<string, Set<string>>>(new Map());
  const spawnHeyGemResultVideoNodeRef = useRef<
    (opts: {
      sourceNodeId: string;
      outputVideo: string;
      originalVideoUrl?: string;
      videoAsset?: { poster?: string; ghost?: string; width?: number; height?: number };
      localPath?: string;
      prompt?: string;
    }) => string | null
  >(() => null);

  /** HeyGem 生成成功：在源模块右侧新建视频节点并连线；多次生成横向排列 */
  const spawnHeyGemResultVideoNode = useCallback(
    (opts: {
      sourceNodeId: string;
      outputVideo: string;
      originalVideoUrl?: string;
      videoAsset?: { poster?: string; ghost?: string; width?: number; height?: number };
      localPath?: string;
      prompt?: string;
    }) => {
      const { sourceNodeId, outputVideo, originalVideoUrl, videoAsset, localPath, prompt } = opts;
      const urlsToCheck = [String(outputVideo || '').trim(), String(originalVideoUrl || '').trim()].filter(
        Boolean,
      );
      if (urlsToCheck.length === 0) return null;

      const rememberUrls = () => {
        let set = heyGemSpawnedUrlRef.current.get(sourceNodeId);
        if (!set) {
          set = new Set<string>();
          heyGemSpawnedUrlRef.current.set(sourceNodeId, set);
        }
        for (const u of urlsToCheck) set.add(u);
      };

      const clearSourceProgress = () => {
        setNodes((nds) =>
          nds.map((n) =>
            n.id === sourceNodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    progress: 0,
                    progressMessage: undefined,
                    errorMessage: undefined,
                  },
                }
              : n,
          ),
        );
      };

      const GAP = 48;
      const allNodes = latestNodesRef.current;
      const allEdges = latestEdgesRef.current;
      const source = allNodes.find((n) => n.id === sourceNodeId && n.type === 'heyGem');
      if (!source) return null;

      // Dedup: if a connected video already has any of these URLs, skip（可升级为本地 URL）
      const existingChild = allEdges
        .filter((e) => e.source === sourceNodeId)
        .map((e) => allNodes.find((n) => n.id === e.target))
        .find((n) => {
          if (n?.type !== 'video') return false;
          const childUrls = [
            String(n.data?.outputVideo || '').trim(),
            String(n.data?.originalVideoUrl || '').trim(),
          ].filter(Boolean);
          return childUrls.some((u) => urlsToCheck.includes(u));
        });
      if (existingChild) {
        rememberUrls();
        const localOut = String(outputVideo || '').trim();
        const childOut = String(existingChild.data?.outputVideo || '').trim();
        const preferLocal =
          localOut.startsWith('local-resource://') &&
          !!childOut &&
          !childOut.startsWith('local-resource://') &&
          urlsToCheck.includes(childOut);
        if (preferLocal) {
          setNodes((nds) =>
            nds.map((n) => {
              if (n.id === existingChild.id) {
                return {
                  ...n,
                  data: {
                    ...n.data,
                    outputVideo: localOut,
                    originalVideoUrl: originalVideoUrl || n.data?.originalVideoUrl,
                    ...(videoAsset ? { videoAsset } : {}),
                    ...(localPath ? { localPath } : {}),
                    progress: 0,
                    errorMessage: undefined,
                  },
                };
              }
              if (n.id === sourceNodeId) {
                return {
                  ...n,
                  data: {
                    ...n.data,
                    progress: 0,
                    progressMessage: undefined,
                    errorMessage: undefined,
                  },
                };
              }
              return n;
            }),
          );
        } else {
          const srcProgress = Number(source.data?.progress || 0);
          const srcErr = !!(source.data?.errorMessage || '').trim();
          if (srcProgress > 0 || srcErr) clearSourceProgress();
        }
        return existingChild.id;
      }

      // 内存去重曾标记已 spawn，但画布上并无对应子节点（双链路 SUCCESS 误伤）→ 清标记后继续创建
      const seen = heyGemSpawnedUrlRef.current.get(sourceNodeId);
      if (seen && urlsToCheck.some((u) => seen.has(u))) {
        for (const u of urlsToCheck) seen.delete(u);
      }

      const srcW =
        Number(source.width) ||
        Number((source.style as { width?: number } | undefined)?.width) ||
        Number(source.data?.width) ||
        VIDEO_NODE_DEFAULT_W;
      const srcH =
        Number(source.height) ||
        Number((source.style as { height?: number } | undefined)?.height) ||
        Number(source.data?.height) ||
        VIDEO_NODE_DEFAULT_H;

      const pixelW = Number(videoAsset?.width) || 1280;
      const pixelH = Number(videoAsset?.height) || 720;
      const adapted =
        computeNodeSizeFromMedia(
          pixelW,
          pixelH,
          VIDEO_NODE_MIN_W,
          VIDEO_NODE_MIN_H,
          VIDEO_NODE_MAX_W,
          VIDEO_NODE_MAX_H,
        ) || { w: VIDEO_NODE_DEFAULT_W, h: VIDEO_NODE_DEFAULT_H };
      const nodeW = adapted.w;
      const nodeH = adapted.h;
      const aspectRatio = snapToVideoPanelAspectRatio(aspectRatioLabelFromPixelSize(pixelW, pixelH));

      const anchorX = source.position.x + srcW + GAP;
      let newX = anchorX;
      let newY = source.position.y + Math.max(0, (srcH - nodeH) / 2);

      const priorTargets = allEdges
        .filter((e) => e.source === sourceNodeId && e.target && e.target !== sourceNodeId)
        .map((e) => allNodes.find((n) => n.id === e.target))
        .filter((n): n is Node => !!n && n.type === 'video' && n.position.x >= anchorX - 8);
      for (const n of priorTargets) {
        const w =
          Number(n.width) ||
          Number((n.style as { width?: number } | undefined)?.width) ||
          Number(n.data?.width) ||
          VIDEO_NODE_DEFAULT_W;
        newX = Math.max(newX, n.position.x + w + GAP);
      }

      const newNodeId = `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const title = locale === 'en' ? 'HeyGem result' : 'HeyGem 成片';
      const newNode: Node = {
        id: newNodeId,
        type: 'video',
        position: { x: newX, y: newY },
        selected: true,
        data: {
          label: 'video',
          title,
          outputVideo,
          originalVideoUrl: originalVideoUrl || undefined,
          ...(localPath ? { localPath } : {}),
          ...(videoAsset ? { videoAsset } : {}),
          width: nodeW,
          height: nodeH,
          aspectRatio,
          preserveExportLayout: true,
          isUserResized: true,
          prompt: prompt || '',
          model: DEFAULT_VIDEO_MODEL_REPLACING_SORA2,
          progress: 0,
          errorMessage: undefined,
        },
        style: nodeStyleDimensions(nodeW, nodeH),
      };
      const newEdge: Edge = {
        id: `edge-${sourceNodeId}-${newNodeId}`,
        source: sourceNodeId,
        target: newNodeId,
        sourceHandle: 'output',
        targetHandle: 'input',
        animated: false,
        data: { videoSrc: outputVideo },
      };

      // 先写入 ref，供紧随其后的 handleAddVideoTask 能解析到新节点标题
      latestNodesRef.current = [
        ...allNodes.map((n) =>
          n.id === sourceNodeId
            ? {
                ...n,
                selected: false,
                data: {
                  ...n.data,
                  outputVideo: undefined,
                  originalVideoUrl: undefined,
                  progress: 0,
                  progressMessage: undefined,
                  errorMessage: undefined,
                },
              }
            : { ...n, selected: false },
        ),
        newNode,
      ];
      latestEdgesRef.current = addEdge(newEdge, allEdges);

      setNodes((nds) =>
        nds
          .map((n) => {
            if (n.id !== sourceNodeId) return { ...n, selected: false };
            return {
              ...n,
              selected: false,
              data: {
                ...n.data,
                // 结果展示在下游视频节点，源模块只保留进度清理
                outputVideo: undefined,
                originalVideoUrl: undefined,
                progress: 0,
                progressMessage: undefined,
                errorMessage: undefined,
              },
            };
          })
          .concat(newNode),
      );
      setEdges((eds) => addEdge(newEdge, eds));
      rememberUrls();
      setTimeout(() => saveHistory('general'), 0);

      const taskUrl =
        originalVideoUrl ||
        (outputVideo.startsWith('local-resource://') ? undefined : outputVideo) ||
        outputVideo;
      handleAddVideoTask(newNodeId, taskUrl || outputVideo, prompt || '', originalVideoUrl);
      return newNodeId;
    },
    [setNodes, setEdges, saveHistory, locale, handleAddVideoTask],
  );
  spawnHeyGemResultVideoNodeRef.current = spawnHeyGemResultVideoNode;

  // 音频生成完成时，创建任务记录并自动保存到本地
  const handleAddAudioTask = useCallback((nodeId: string, audioUrl: string, prompt: string, originalAudioUrl?: string) => {
    setTasks((prevTasks) => {
      // 检查是否已存在相同的任务（避免重复添加）
      const existingTask = prevTasks.find(
        (task) =>
          task.nodeId === nodeId &&
          task.taskType === 'audio' &&
          task.status === 'success' &&
          mediaUrlsLikelySameArtifact(task.audioUrl, audioUrl),
      );
      if (existingTask) {
        console.log('[Workspace] 音频任务已存在，跳过添加');
        // 仍清理误标成 video 的 runtime 孤儿卡，避免侧栏出现同名「audio」视频预览
        return prevTasks.filter((t) => t.id !== `runtime-${nodeId}`);
      }

      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return prevTasks;

      const nodeTitle = node.data?.title || 'audio';
      // 生成的歌曲保存时文件名使用歌曲名字（全能写歌）
      const isSong = isAudioSongModel(node.data?.model);
      const songName = (node.data?.songName as string)?.trim();
      const saveFileName = isSong && songName ? songName : nodeTitle;
      const downloadFileName =
        isSong && songName ? buildMusicDownloadSuggestedName({
          model: node.data?.model as string,
          songName,
          audioUrl,
        }) : undefined;
      const runtimeTask = prevTasks.find((t) => t.id === `runtime-${nodeId}`);
      const durationSec =
        runtimeTask != null
          ? typeof runtimeTask.durationSec === 'number'
            ? runtimeTask.durationSec
            : Math.max(0, Math.floor((Date.now() - runtimeTask.createdAt) / 1000))
          : undefined;
      const yuanbaoConsumed =
        runtimeTask != null && typeof runtimeTask.yuanbaoConsumed === 'number'
          ? runtimeTask.yuanbaoConsumed
          : estimateYuanbaoForTaskNodeStatic(node, cloudMapRef.current);
      const newTask: Task = {
        id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        nodeId,
        nodeTitle,
        audioUrl,
        prompt: prompt || '无提示词',
        createdAt: Date.now(),
        status: 'success',
        taskType: 'audio',
        ...(downloadFileName ? { downloadFileName } : {}),
        ...(durationSec !== undefined ? { durationSec } : {}),
        ...(yuanbaoConsumed !== undefined ? { yuanbaoConsumed } : {}),
      };

      // 自动保存音频到本地（歌曲使用歌曲名作为文件名）
      if (window.electronAPI && projectId) {
        window.electronAPI
          .autoSaveAudio(audioUrl, saveFileName, projectId)
          .then((result: any) => {
            if (result.success && result.filePath) {
              // 更新任务的本地文件路径
              setTasks((prev) =>
                prev.map((task) =>
                  task.id === newTask.id ? { ...task, localFilePath: result.filePath } : task
                )
              );
              
              // 延迟更新 AudioNode，确保文件完全写入并可用
              const targetNodeId = nodeId;
              setTimeout(() => {
                console.log('[Workspace] 自动保存音频完成，更新节点:', targetNodeId, 'filePath:', result.filePath);
                // 构建 local-resource URL，确保 Windows 路径格式正确
                let filePath = result.filePath.replace(/\\/g, '/');
                // 确保路径以 / 开头（Windows 路径 C:/Users -> /C:/Users）
                if (!filePath.startsWith('/') && filePath.match(/^[a-zA-Z]:/)) {
                  filePath = '/' + filePath;
                }
                const localResourceUrl = `local-resource://${filePath}`;
                
                // 更新 AudioNode：显示下载的音频并停止进度条
                setNodes((nds) => {
                  const updatedNodes = nds.map((n) =>
                    n.id === targetNodeId
                      ? { ...n, data: { ...n.data, outputAudio: localResourceUrl, errorMessage: undefined } }
                      : n
                  );
                  console.log('[Workspace] 音频节点更新完成，目标节点ID:', targetNodeId, '找到节点:', updatedNodes.find(n => n.id === targetNodeId) !== undefined);
                  return updatedNodes;
                });
                if (handleAudioNodeDataChangeRef.current) {
                  handleAudioNodeDataChangeRef.current(targetNodeId, { outputAudio: localResourceUrl, errorMessage: undefined });
                }
              }, 500); // 延迟 500ms，确保文件完全写入
            }
          })
          .catch((error) => {
            console.error('自动保存音频失败:', error);
          });
      }

      return [newTask, ...prevTasks.filter((t) => t.id !== `runtime-${nodeId}`)];
    });
  }, [nodes, projectId, handleAudioNodeDataChangeRef]);

  const handleAddTextTask = useCallback((nodeId: string, outputText: string, _inputPrompt?: string) => {
    const trimmedOutput = (outputText || '').trim();
    if (!trimmedOutput) return;

    setTasks((prevTasks) => {
      const existingTask = prevTasks.find(
        (task) =>
          task.nodeId === nodeId &&
          task.taskType === 'text' &&
          task.status === 'success' &&
          (task.prompt || '').trim() === trimmedOutput,
      );
      if (existingTask) {
        console.log('[Workspace] 文本任务已存在，跳过添加');
        return prevTasks;
      }

      const node = latestNodesRef.current.find((n) => n.id === nodeId) ?? nodes.find((n) => n.id === nodeId);
      if (!node) return prevTasks;

      const nodeTitle = node.data?.title || (node.type === 'llm' ? 'llm' : 'text');
      const runtimeTask = prevTasks.find((t) => t.id === `runtime-${nodeId}`);
      const durationSec =
        runtimeTask != null
          ? typeof runtimeTask.durationSec === 'number'
            ? runtimeTask.durationSec
            : Math.max(0, Math.floor((Date.now() - runtimeTask.createdAt) / 1000))
          : undefined;
      const yuanbaoConsumed =
        runtimeTask != null && typeof runtimeTask.yuanbaoConsumed === 'number'
          ? runtimeTask.yuanbaoConsumed
          : estimateYuanbaoForTaskNodeStatic(node, cloudMapRef.current);
      const newTask: Task = {
        id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        nodeId,
        nodeTitle,
        prompt: trimmedOutput,
        createdAt: Date.now(),
        status: 'success',
        taskType: 'text',
        ...(durationSec !== undefined ? { durationSec } : {}),
        ...(yuanbaoConsumed !== undefined ? { yuanbaoConsumed } : {}),
      };

      return [newTask, ...prevTasks.filter((t) => t.id !== `runtime-${nodeId}`)];
    });
  }, [nodes]);

  useEffect(() => {
    handleAddTextTaskRef.current = handleAddTextTask;
  }, [handleAddTextTask]);

  /**
   * 云端异步任务（与主进程 Image/Video/AudioProvider 的 POST /tasks/create 对齐）：
   * - 主进程建单后发 nx-cloud-track-task（含 balance），此处立即同步元宝并按 >=60s 轮询 /tasks/status；
   * - 失败使用指数退避，最多 3 次后停止自动轮询，等待用户手动触发；
   * - 挂载时 POST /tasks（tasks/list）恢复 pending / running。
   */
  const cloudTaskPollByTaskIdRef = useRef<
    Map<
      string,
      {
        timer: ReturnType<typeof setTimeout> | null;
        isSyncing: boolean;
        failureCount: number;
        nextDelayMs: number;
      }
    >
  >(new Map());
  const cloudTaskPollBootstrapRef = useRef<Set<string>>(new Set());

  const stopCloudTaskPollById = useCallback((taskId: string) => {
    const t = cloudTaskPollByTaskIdRef.current.get(taskId);
    if (t?.timer != null) clearTimeout(t.timer);
    cloudTaskPollByTaskIdRef.current.delete(taskId);
  }, []);

  const startCloudTaskPollById = useCallback(
    (taskId: string, nodeId: string, taskKind: 'image' | 'video' | 'audio' = 'image') => {
      if (!window.electronAPI?.nxCloudTaskStatus || !taskId?.trim() || !nodeId?.trim()) return;
      if (cloudTaskPollByTaskIdRef.current.has(taskId) || cloudTaskPollBootstrapRef.current.has(taskId)) return;

      const pickNxRowResultUrl = (row: {
        result_oss_url?: string;
        result_url?: string;
        resultUrl?: string;
        output_url?: string;
        outputUrl?: string;
      }): string => {
        const t = (v?: string) => {
          const s = String(v || '').trim();
          return s && /^https?:\/\//i.test(s) ? s : '';
        };
        return (
          t(row.result_oss_url) ||
          t(row.result_url) ||
          t(row.resultUrl) ||
          t(row.output_url) ||
          t(row.outputUrl)
        );
      };

      const runTick = async (): Promise<'stop' | 'continue'> => {
        const state = cloudTaskPollByTaskIdRef.current.get(taskId);
        if (!state || state.isSyncing) return 'continue';
        state.isSyncing = true;
        try {
          const row = await window.electronAPI.nxCloudTaskStatus(taskId);
          state.failureCount = 0;
          state.nextDelayMs = 60_000;
          if (typeof row.balance === 'number' && Number.isFinite(row.balance)) {
            setLafBalance(row.balance);
          }
          const st = String(row.status || '').toLowerCase();
          const terminalFail = st === 'failed' || st === 'error' || st === 'timeout' || st === 'time_out';
          const terminalOk = st === 'success';
          if (terminalOk) {
            const url = pickNxRowResultUrl(row);
            let promptText = '';
            try {
              const pj = row.prompt_json ? (JSON.parse(row.prompt_json) as { prompt?: string }) : {};
              promptText = String(pj.prompt || '');
            } catch {
              /* ignore */
            }
            if (!url) {
              const waitMsg = '正在获取结果链接…';
              if (taskKind === 'image') {
                handleImageNodeDataChange(nodeId, {
                  progress: 1,
                  progressMessage: waitMsg,
                  errorMessage: undefined,
                });
              } else if (taskKind === 'video') {
                handleVideoNodeDataChange(nodeId, {
                  progress: 1,
                  progressMessage: waitMsg,
                  errorMessage: undefined,
                });
              } else {
                handleAudioNodeDataChange(nodeId, {
                  aiStatus: 'PROCESSING',
                  progress: 1,
                  progressMessage: waitMsg,
                  errorMessage: undefined,
                });
              }
              return 'continue';
            }
            stopCloudTaskPollById(taskId);
            if (taskKind === 'image') {
              const formatted = formatImagePathSync(url);
              handleImageNodeDataChange(nodeId, {
                outputImage: formatted,
                progress: 100,
                progressMessage: '',
                errorMessage: undefined,
              });
              handleAddTask(nodeId, formatted, promptText, /^https?:\/\//i.test(url) ? url : undefined);
            } else if (taskKind === 'video') {
              handleVideoNodeDataChange(nodeId, {
                outputVideo: url,
                progress: 100,
                progressMessage: '',
                errorMessage: undefined,
              });
              handleAddVideoTask(nodeId, url, promptText, url);
            } else if (taskKind === 'audio') {
              handleAudioNodeDataChange(nodeId, { outputAudio: url, errorMessage: undefined });
              handleAddAudioTask(nodeId, url, promptText, url);
            }
            return 'stop';
          }
          if (terminalFail) {
            stopCloudTaskPollById(taskId);
            const err = String(row.error_msg || '任务失败');
            if (taskKind === 'image') {
              handleImageNodeDataChange(nodeId, { progress: 0, progressMessage: '', errorMessage: err });
            } else if (taskKind === 'video') {
              handleVideoNodeDataChange(nodeId, { progress: 0, progressMessage: '', errorMessage: err });
            } else if (taskKind === 'audio') {
              handleAudioNodeDataChange(nodeId, { errorMessage: err });
            }
            return 'stop';
          }
          if (st === 'pending' || st === 'running') {
            const cloudMsg = st === 'pending' ? '云端任务排队中…' : '云端任务处理中…';
            if (taskKind === 'image') {
              handleImageNodeDataChange(nodeId, {
                progress: 1,
                progressMessage: cloudMsg,
                errorMessage: undefined,
              });
            } else if (taskKind === 'video') {
              handleVideoNodeDataChange(nodeId, {
                progress: 1,
                progressMessage: cloudMsg,
                errorMessage: undefined,
              });
            } else {
              handleAudioNodeDataChange(nodeId, {
                aiStatus: 'PROCESSING',
                progress: 1,
                progressMessage: cloudMsg,
                errorMessage: undefined,
              });
            }
          }
        } catch {
          if (state) {
            state.failureCount += 1;
            if (state.failureCount > 3) {
              console.error('[Workspace] 云端任务状态轮询失败次数超过上限，已停止自动轮询，等待手动触发。', taskId);
              stopCloudTaskPollById(taskId);
              return 'stop';
            }
            state.nextDelayMs = Math.max(60_000, Math.min(state.nextDelayMs * 2, 480_000));
          }
          /* 下一周期再试 */
        } finally {
          const latest = cloudTaskPollByTaskIdRef.current.get(taskId);
          if (latest) latest.isSyncing = false;
        }
        return 'continue';
      };

      cloudTaskPollBootstrapRef.current.add(taskId);
      void (async () => {
        try {
          const scheduleNext = (delayMs: number) => {
            const current = cloudTaskPollByTaskIdRef.current.get(taskId);
            if (!current) return;
            current.timer = setTimeout(async () => {
              const r = await runTick();
              if (r === 'stop') {
                stopCloudTaskPollById(taskId);
                return;
              }
              const after = cloudTaskPollByTaskIdRef.current.get(taskId);
              if (!after) return;
              scheduleNext(after.nextDelayMs);
            }, Math.max(60_000, delayMs));
          };
          cloudTaskPollByTaskIdRef.current.set(taskId, {
            timer: null,
            isSyncing: false,
            failureCount: 0,
            nextDelayMs: 60_000,
          });
          const first = await runTick();
          if (first === 'stop') return;
          if (!cloudTaskPollByTaskIdRef.current.has(taskId)) return;
          scheduleNext(60_000);
        } finally {
          cloudTaskPollBootstrapRef.current.delete(taskId);
        }
      })();
    },
    [
      stopCloudTaskPollById,
      handleImageNodeDataChange,
      handleAddTask,
      handleVideoNodeDataChange,
      handleAddVideoTask,
      handleAudioNodeDataChange,
      handleAddAudioTask,
    ],
  );

  useEffect(() => {
    if (!window.electronAPI?.onNxCloudTrackTask) return () => {};
    const unsub = window.electronAPI.onNxCloudTrackTask((p) => {
      if (typeof p.balance === 'number' && Number.isFinite(p.balance)) {
        setLafBalance(p.balance);
      }
      const kind = p.taskType === 'video' || p.taskType === 'audio' ? p.taskType : 'image';
      startCloudTaskPollById(p.taskId, p.nodeId, kind);
    });
    return () => unsub();
  }, [startCloudTaskPollById]);

  useEffect(() => {
    if (!window.electronAPI?.nxCloudGetTasks || !window.electronAPI?.nxCloudTaskStatus) return () => {};
    let cancelled = false;
    void (async () => {
      try {
        const pre = window.electronAPI.getNxSaasState
          ? await window.electronAPI.getNxSaasState()
          : { loggedIn: false };
        if (!pre.loggedIn || cancelled) return;
        const res = await window.electronAPI.nxCloudGetTasks(50);
        const items = Array.isArray(res?.items) ? res.items : [];
        for (const row of items) {
          if (cancelled) break;
          const st = String(row.status || '').toLowerCase();
          if (st !== 'pending' && st !== 'running') continue;
          const tid = String(row.task_id || '').trim();
          if (!tid) continue;
          let nodeId = '';
          let taskKind: 'image' | 'video' | 'audio' = 'image';
          try {
            const pj = row.prompt_json
              ? (JSON.parse(row.prompt_json) as { nodeId?: string; taskKind?: string })
              : {};
            nodeId = String(pj.nodeId || '').trim();
            const k = String(pj.taskKind || '').toLowerCase();
            if (k === 'video' || k === 'audio') taskKind = k;
          } catch {
            continue;
          }
          if (!nodeId) continue;
          startCloudTaskPollById(tid, nodeId, taskKind);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [startCloudTaskPollById, projectId]);

  useEffect(() => {
    return () => {
      for (const state of cloudTaskPollByTaskIdRef.current.values()) {
        clearTimeout(state.timer);
      }
      cloudTaskPollByTaskIdRef.current.clear();
    };
  }, []);

  // 点击画布空白区域取消选择
  const onPaneClick = useCallback(() => {
    if ((window as Window & { __nexflowVoiceModalOpen?: boolean }).__nexflowVoiceModalOpen) {
      return;
    }
    if (characterAvatarPickPendingRef.current) {
      cancelCharacterCanvasPick();
      return;
    }
    if (quickConnectSourceIdRef.current) {
      cancelQuickConnect();
      return;
    }
    setSelectedNode(null);
    setSelectedEdge(null);
    setEdgeDeleteModeId(null);
    setContextMenu(null);
    setLlmInputPanelData(null); // 点击画布时关闭 LLM 输入面板
    setStoryboardScriptInputPanelData(null);
    setDirectorInputPanelData(null);
    setImageInputPanelData(null);
        setImageTo3dInputPanelData(null); // 点击画布时关闭 Image 输入面板
    setVideoInputPanelData(null); // 点击画布时关闭 Video 输入面板
    setCharacterInputPanelData(null); // 点击画布时关闭 Character 输入面板
    setAudioInputPanelData(null); // 点击画布时关闭 Audio 输入面板
    setRvcTrainInputPanelData(null);
    window.dispatchEvent(new CustomEvent('nexflow-close-3d-popover')); // 点击画布时关闭 3D 视角弹窗
    window.dispatchEvent(new CustomEvent('nexflow-exit-video-trim-sessions')); // 退出视频裁剪/智能剪辑
  }, [cancelCharacterCanvasPick, cancelQuickConnect]);

  // 3D 视角模块生成的提示词自动填入该 Image 节点下方的提示词输入框
  useEffect(() => {
    const onPromptFrom3D = (e: CustomEvent<{ nodeId: string; prompt: string }>) => {
      const { nodeId, prompt } = e.detail || {};
      if (!nodeId || prompt == null) return;
      setImageInputPanelData((prev) =>
        prev && prev.nodeId === nodeId ? { ...prev, prompt } : prev
      );
    };
    const onScene360Preset = (
      e: CustomEvent<{
        nodeId: string;
        prompt: string;
        model: string;
        aspectRatio: string;
        resolution: string;
      }>,
    ) => {
      const { nodeId, prompt, model, aspectRatio, resolution } = e.detail || {};
      if (!nodeId) return;
      setNodes((nds) =>
        nds.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  prompt,
                  model: model || 'banana-2.0',
                  aspectRatio: aspectRatio || '21:9',
                  resolution: resolution || '4k',
                },
              }
            : node,
        ),
      );
      setImageInputPanelData((prev) =>
        prev && prev.nodeId === nodeId
          ? {
              ...prev,
              prompt,
              model: model || 'banana-2.0',
              aspectRatio: aspectRatio || '21:9',
              resolution: resolution || '4k',
            }
          : prev,
      );
    };
    window.addEventListener('nexflow-image-prompt-from-3d', onPromptFrom3D as EventListener);
    window.addEventListener('nexflow-image-scene360-preset', onScene360Preset as EventListener);
    return () => {
      window.removeEventListener('nexflow-image-prompt-from-3d', onPromptFrom3D as EventListener);
      window.removeEventListener('nexflow-image-scene360-preset', onScene360Preset as EventListener);
    };
  }, [setNodes]);

  // 处理菜单项选择（connectFrom 存在时表示从连线拖到空白处弹出，创建节点后自动连边）
  const handleMenuSelect = useCallback((type: string, position: { x: number; y: number }, connectFrom?: { sourceNodeId: string; sourceHandleId: string | null; handleType: string | null }) => {
    console.log('[Workspace] handleMenuSelect 收到位置:', { type, position, connectFrom });

    // 分镜脚本 / 剧本节点已下线（禁止新建）；导演台由 HIDE_DIRECTOR_STAGE_UI 控制
    if (type === 'storyboardScript' || type === 'script') {
      setContextMenu(null);
      return;
    }
    if (HIDE_DIRECTOR_STAGE_UI && type === 'director') {
      setContextMenu(null);
      return;
    }

    // 画板工具：打开画板面板，完成时再创建 Image 节点
    if (type === 'canvas-tool') {
      setContextMenu(null);
      setCanvasToolPending({ position, connectFrom });
      return;
    }
    
    // 根据节点类型确定默认尺寸（LLM 与 Text 模块相同）
    const isImageType =
      type === 'image' || type === 'image-first-frame' || type === 'image-current-frame' || type === 'image-last-frame';
    const isAudioType =
      type === 'audio' ||
      type === 'audio-voice-cover' ||
      type === 'audio-extract-from-video' ||
      type === 'audio-extract-vocals' ||
      type === 'audio-extract-background';
    const isVideoSpliceType = type === 'videoSplice';
    const isPhotoCollageType = type === 'photoCollage';
    const isGridMapType = type === 'gridMap';
    const isImageComparerType = type === 'imageComparer';
    const isStoryboardScriptType = type === 'storyboardScript';
    const isScriptType = type === 'script';
    const isDirectorType = type === 'director';
    const isImageTo3dType = type === 'imageTo3d';
    const isRvcTrainType = type === 'rvcTrain';
    const isWanAnimateType = type === 'wanAnimate';
    const isHeyGemType = type === 'heyGem';
    const isVideoLikeType = type === 'video' || isWanAnimateType || isHeyGemType;
    let defaultWidth =
      type === 'text'
        ? IMAGE_NODE_DEFAULT_W
        : type === 'llm'
          ? AUDIO_NODE_WIDTH
          : type === 'textSplit'
            ? scaleModulePx(240)
            : isImageType
              ? IMAGE_NODE_DEFAULT_W
              : isHeyGemType
                ? HEYGEM_SHELL_W
              : isVideoLikeType
                ? VIDEO_NODE_DEFAULT_W
                : type === 'character'
                  ? scaleModulePx(624)
                  : isAudioType
                      ? AUDIO_NODE_WIDTH
                    : isVideoSpliceType
                      ? scaleModulePx(800)
                      : isPhotoCollageType
                        ? scaleModulePx(560)
                        : isGridMapType
                          ? nodeOuterSizeForCanvas(DEFAULT_GRID_MAP_CANVAS_W, DEFAULT_GRID_MAP_CANVAS_H).w
                        : isImageComparerType
                          ? IMAGE_COMPARER_DEFAULT_W
                        : isStoryboardScriptType
                          ? scaleModulePx(1024)
                        : isScriptType
                          ? scaleModulePx(360)
                        : isDirectorType
                          ? DIRECTOR_DEFAULT_W
                        : isImageTo3dType
                          ? IMAGE_TO_3D_WIDTH
                          : isRvcTrainType
                            ? RVC_TRAIN_WIDTH
                          : scaleModulePx(200);
    let defaultHeight =
      type === 'text'
        ? IMAGE_NODE_DEFAULT_H
        : type === 'llm'
          ? AUDIO_NODE_HEIGHT
          : type === 'textSplit'
            ? scaleModulePx(200)
            : isImageType
              ? IMAGE_NODE_DEFAULT_H
              : isHeyGemType
                ? HEYGEM_SHELL_H
              : isVideoLikeType
                ? VIDEO_NODE_DEFAULT_H
                : type === 'character'
                  ? scaleModulePx(468)
                  : isAudioType
                      ? AUDIO_NODE_HEIGHT
                    : isVideoSpliceType
                      ? scaleModulePx(500)
                      : isPhotoCollageType
                        ? scaleModulePx(480)
                        : isGridMapType
                          ? nodeOuterSizeForCanvas(DEFAULT_GRID_MAP_CANVAS_W, DEFAULT_GRID_MAP_CANVAS_H).h
                        : isImageComparerType
                          ? IMAGE_COMPARER_DEFAULT_H
                        : isStoryboardScriptType
                          ? scaleModulePx(576)
                        : isScriptType
                          ? scaleModulePx(320)
                        : isDirectorType
                          ? DIRECTOR_DEFAULT_H
                        : isImageTo3dType
                          ? IMAGE_TO_3D_HEIGHT
                          : isRvcTrainType
                            ? RVC_TRAIN_HEIGHT
                          : scaleModulePx(200);

    if (isImageType) {
      const arSize = imageNodeSizeForAspectRatio(DEFAULT_IMAGE_ASPECT_RATIO);
      if (arSize) {
        defaultWidth = arSize.w;
        defaultHeight = arSize.h;
      }
    } else if (type === 'video') {
      const arSize = videoNodeSizeForAspectRatio(DEFAULT_VIDEO_ASPECT_RATIO);
      if (arSize) {
        defaultWidth = arSize.w;
        defaultHeight = arSize.h;
      }
    }
    
    // 调整节点位置，使节点中心在鼠标点击处
    const adjustedPosition = {
      x: position.x - defaultWidth / 2,
      y: position.y - defaultHeight / 2,
    };
    
    console.log('[Workspace] 计算后的节点位置:', { 
      original: position, 
      adjusted: adjustedPosition, 
      size: { width: defaultWidth, height: defaultHeight } 
    });

    const newNode: Node = {
      id: `${type}-${Date.now()}`,
      type:
        type === 'text'
          ? 'minimalistText'
          : type === 'llm'
            ? 'llm'
            : type === 'textSplit'
              ? 'textSplit'
              : isImageType
                ? 'image'
                : type === 'video'
                  ? 'video'
                  : isWanAnimateType
                    ? 'wanAnimate'
                    : isHeyGemType
                      ? 'heyGem'
                  : type === 'character'
                    ? 'character'
                    : isAudioType
                        ? 'audio'
                        : isVideoSpliceType
                          ? 'videoSplice'
                          : isPhotoCollageType
                            ? 'photoCollage'
                            : isGridMapType
                              ? 'gridMap'
                            : isImageComparerType
                              ? 'imageComparer'
                            : isStoryboardScriptType
                              ? 'storyboardScript'
                            : isScriptType
                              ? 'script'
                            : isDirectorType
                              ? 'director'
                            : isImageTo3dType
                              ? 'imageTo3d'
                              : isRvcTrainType
                                ? 'rvcTrain'
                              : 'custom',
      position: adjustedPosition,
      ...(isGridMapType || isStoryboardScriptType || isDirectorType || isImageComparerType
        ? {
            style: nodeStyleDimensions(defaultWidth, defaultHeight),
            width: defaultWidth,
            height: defaultHeight,
          }
        : {}),
      data: {
        label:
          type === 'text'
            ? '文本节点'
            : type === 'llm'
              ? '大语言模型'
              : type === 'textSplit'
                ? '文本拆分'
                : isImageType
                  ? '图片节点'
                  : type === 'video'
                    ? '视频节点'
                    : isWanAnimateType
                      ? '视频换人'
                      : isHeyGemType
                        ? 'HeyGem 数字人'
                      : type === 'character'
                        ? '角色节点'
                        : isAudioType
                          ? '声音节点'
                          : isVideoSpliceType
                            ? '视频剪辑'
                            : isPhotoCollageType
                              ? '拼图'
                              : isGridMapType
                                ? '宫格图'
                              : isImageComparerType
                                ? '图片对比'
                              : isStoryboardScriptType
                                ? '分镜脚本'
                              : isScriptType
                                ? '剧本'
                              : isDirectorType
                                ? '导演'
                              : isImageTo3dType
                                ? '图片转 3D'
                                : isRvcTrainType
                                  ? '音色训练'
                                : '节点',
        text: type === 'text' || isScriptType ? '' : isAudioType ? '' : undefined,
        width: defaultWidth,
        height: defaultHeight,
        moduleSizeScaleVersion: MODULE_SIZE_SCALE_VERSION,
        isUserResized: false, // 新创建的节点，用户尚未手动调整尺寸
        prompt: type === 'llm' || isImageType || isVideoLikeType ? '' : undefined,
        ...(isStoryboardScriptType
          ? {
              storyboardScript: createDefaultStoryboardScriptState(),
              userPrompt: '',
              chatModel: 'gpt-3.5-turbo',
              title: '分镜脚本',
            }
          : {}),
        ...(isScriptType ? { title: '剧本', text: '' } : {}),
        ...(isDirectorType
          ? {
              director: createDefaultDirectorPipelineState(),
              userPrompt: '',
              title: '导演',
              width: DIRECTOR_DEFAULT_W,
              height: DIRECTOR_DEFAULT_H,
              isUserResized: true,
            }
          : {}),
        ...(isImageTo3dType ? { inputImageUrl: '', progress: 0 } : {}),
        ...(isRvcTrainType
          ? {
              model: RVC_VOICE_TRAIN_MODEL_ID,
              rvcTrainModelName: '',
              referenceAudioUrl: '',
              aiStatus: 'idle',
              progress: 0,
            }
          : {}),
        title:
          type === 'llm'
            ? 'llm'
            : isImageType
              ? 'image'
              : type === 'video'
                ? 'video'
                : isWanAnimateType
                  ? 'wanAnimate'
                  : isHeyGemType
                    ? 'heyGem'
                  : type === 'character'
                    ? 'character'
                    : type === 'audio-voice-cover'
                      ? '翻唱'
                      : isAudioType
                        ? 'audio'
                      : type === 'textSplit'
                        ? 'textSplit'
                        : isVideoSpliceType
                          ? 'videoSplice'
                          : isPhotoCollageType
                            ? 'photoCollage'
                            : isGridMapType
                              ? 'gridMap'
                            : isImageComparerType
                              ? 'imageComparer'
                            : isStoryboardScriptType
                              ? '分镜脚本'
                            : isRvcTrainType
                              ? ''
                            : undefined,
        inputText: type === 'textSplit' ? '' : undefined,
        separator: type === 'textSplit' ? '\n' : undefined,
        trimAndFilterEmpty: type === 'textSplit' ? true : undefined,
        convertType: type === 'textSplit' ? 'string' : undefined,
        resolution: isImageType ? '1k' : undefined,
        aspectRatio: isImageType ? DEFAULT_IMAGE_ASPECT_RATIO : isVideoLikeType ? DEFAULT_VIDEO_ASPECT_RATIO : undefined,
        seedreamWidth: isImageType ? 2048 : undefined,
        seedreamHeight: isImageType ? 2048 : undefined,
        model: isImageType
          ? 'banana-2.0'
          : type === 'video'
            ? (HIDE_SORA2_AND_SORA_CHARACTER_UI ? DEFAULT_VIDEO_MODEL_REPLACING_SORA2 : 'sora-2')
            : isWanAnimateType
              ? 'wan-animate'
              : isHeyGemType
                ? 'hey-gem'
                : type === 'audio-voice-cover'
                  ? AI_VOICE_COVER_MODEL_ID
                  : isAudioType
                    ? 'speech-2.8-hd'
                    : isImageTo3dType
                      ? DEFAULT_IMAGE_TO_3D_MODEL
                    : undefined,
        heyGemScript: isHeyGemType ? '' : undefined,
        heyGemTtsModel: isHeyGemType ? DOUBAO_SEED_AUDIO_MODEL_ID : undefined,
        hd: isVideoLikeType ? false : undefined,
        duration: isVideoLikeType ? '10' : undefined,
        resolutionSeedance: isVideoLikeType ? '720p' : undefined,
        durationSeedance: isVideoLikeType ? '10' : undefined,
        resolutionGeminiOmni: isVideoLikeType ? '720p' : undefined,
        durationGeminiOmni: isVideoLikeType ? '6' : undefined,
        videoUrl: type === 'character' ? '' : undefined,
        nickname: type === 'character' ? '' : undefined,
        timestamp: type === 'character' ? '1,3' : undefined, // 默认时间戳为 "1,3"
        viewImages: type === 'character' ? ['', '', '', ''] : undefined,
        referenceTransmitSlots: type === 'character' ? [...DEFAULT_REFERENCE_TRANSMIT_SLOTS] : undefined,
        voiceClip: type === 'character' ? '' : undefined,
        voiceId: isAudioType ? 'Wise_Woman' : undefined,
        speed: isAudioType ? 1 : undefined,
        volume: isAudioType ? 1 : undefined,
        pitch: isAudioType ? 0 : undefined,
        referenceAudioUrl: type === 'character' || isAudioType ? '' : undefined,
        sourceSongAudioUrl: type === 'audio-voice-cover' ? '' : undefined,
        coverPitch: type === 'audio-voice-cover' ? 0 : undefined,
        coverIndexRate: type === 'audio-voice-cover' ? 0.75 : undefined,
        coverVocalMixPct: type === 'audio-voice-cover' ? 100 : undefined,
        coverAccompanimentMixPct: type === 'audio-voice-cover' ? 100 : undefined,
        coverRhVolume: type === 'audio-voice-cover' ? 5 : undefined,
        coverOutputMode: type === 'audio-voice-cover' ? 'with_accompaniment' : undefined,
        aiStatus: isAudioType ? 'idle' : undefined,
        videoClips: isVideoSpliceType ? [] : undefined,
        audioTracks: isVideoSpliceType ? [[]] : undefined,
        collageCanvasW: isPhotoCollageType ? 800 : undefined,
        collageCanvasH: isPhotoCollageType ? 600 : undefined,
        layers: isPhotoCollageType ? [] : undefined,
        gridCols: isGridMapType ? DEFAULT_GRID_MAP_COLS : undefined,
        gridRows: isGridMapType ? DEFAULT_GRID_MAP_ROWS : undefined,
        canvasW: isGridMapType ? DEFAULT_GRID_MAP_CANVAS_W : undefined,
        canvasH: isGridMapType ? DEFAULT_GRID_MAP_CANVAS_H : undefined,
        cells: isGridMapType ? emptyGridMapCells(DEFAULT_GRID_MAP_COLS, DEFAULT_GRID_MAP_ROWS) : undefined,
        imageAUrl: isImageComparerType ? '' : undefined,
        imageBUrl: isImageComparerType ? '' : undefined,
        splitRatio: isImageComparerType ? 0.5 : undefined,
      },
    };

    const newNodeId = newNode.id;

    // 从 Image 拖线创建 Video 时，预填 inputImages 进入图生视频模式
    // 从 Video 拖线创建 Image 时，根据选择获取第一帧或最后一帧作为 outputImage
    // 从 Video 拖线创建 Audio 时，提取视频中的音频作为 outputAudio
    // 从 Text/LLM/TextSplit 拖线创建 TextSplit 时，预填 inputText
    let nodeToAdd: Node = newNode;
    if (isImageType && connectFrom?.sourceNodeId) {
      const sourceNode = nodes.find((n) => n.id === connectFrom.sourceNodeId);
      if (isVideoTrackSourceNodeType(sourceNode?.type)) {
        const videoUrl = (sourceNode.data?.outputVideo || sourceNode.data?.originalVideoUrl) as string | undefined;
        if (videoUrl) {
          const normalizedUrl = normalizeVideoUrl(videoUrl);
          const useFirstFrame = type === 'image-first-frame';
          const useCurrentFrame = type === 'image-current-frame';
          const useLastFrame = type === 'image-last-frame' || type === 'image';
          const stillFromVideo = (url: string) => ({
            outputImage: url,
            originalImageUrl: url,
            inputImages: [url],
          });
          if (useFirstFrame) {
            extractVideoFirstFrame(videoUrl).then((res) => {
              if (res.success && res.imageUrl) {
                setNodes((nds) =>
                  nds.map((n) =>
                    n.id === newNodeId ? { ...n, data: { ...n.data, ...stillFromVideo(res.imageUrl) } } : n
                  )
                );
              }
            });
          } else if (useCurrentFrame) {
            const t = resolveVideoStillCaptureTimeSec(sourceNode);
            extractVideoFrameAtTime(videoUrl, t).then((res) => {
              if (res.success && res.imageUrl) {
                setNodes((nds) =>
                  nds.map((n) =>
                    n.id === newNodeId ? { ...n, data: { ...n.data, ...stillFromVideo(res.imageUrl) } } : n
                  )
                );
              }
            });
          } else if (useLastFrame) {
            const lastFrameDataUrl = getVideoLastFrame(normalizedUrl) || getVideoLastFrame(videoUrl);
            if (lastFrameDataUrl) {
              nodeToAdd = { ...newNode, data: { ...newNode.data, ...stillFromVideo(lastFrameDataUrl) } };
            } else {
              extractVideoLastFrame(videoUrl).then((res) => {
                if (res.success && res.imageUrl) {
                  setNodes((nds) =>
                    nds.map((n) =>
                      n.id === newNodeId ? { ...n, data: { ...n.data, ...stillFromVideo(res.imageUrl) } } : n
                    )
                  );
                }
              });
            }
          }
        }
      } else if (sourceNode?.type === 'character') {
        const urls = getCharacterTransmitImageUrls(sourceNode.data as Record<string, unknown>);
        if (urls.length > 0) {
          nodeToAdd = {
            ...newNode,
            data: {
              ...newNode.data,
              inputImages: urls.slice(0, 10),
            },
          };
        }
      }
    } else if (isPhotoCollageType && connectFrom?.sourceNodeId) {
      const sourceNode = nodes.find((n) => n.id === connectFrom.sourceNodeId);
      if (sourceNode && sourceNode.type === 'image') {
        const url =
          pickPreviewUrl(buildDualImageAssetFromNodeData(sourceNode.data)) ||
          (sourceNode.data?.outputImage as string) ||
          (typeof sourceNode.data?.avatar === 'string' ? String(sourceNode.data.avatar).trim() : '') ||
          (sourceNode.data?.originalImageUrl as string) ||
          (sourceNode.data?.inputImages as string[])?.[0] ||
          '';
        if (url) {
          const cw0 = Number(newNode.data?.collageCanvasW) || 800;
          const ch0 = Number(newNode.data?.collageCanvasH) || 600;
          const newLayer: CollageLayer = {
            id: `layer-${Date.now()}-${connectFrom.sourceNodeId}`,
            src: url,
            sourceNodeId: connectFrom.sourceNodeId,
            x: Math.min(40, Math.max(0, cw0 - 200)),
            y: Math.min(40, Math.max(0, ch0 - 160)),
            w: Math.min(280, Math.floor(cw0 * 0.45)),
            h: Math.min(210, Math.floor(ch0 * 0.45)),
            z: 0,
          };
          nodeToAdd = {
            ...newNode,
            data: {
              ...newNode.data,
              layers: [newLayer],
            },
          };
        }
      }
    } else if (isGridMapType && connectFrom?.sourceNodeId) {
      const sourceNode = nodes.find((n) => n.id === connectFrom.sourceNodeId);
      if (sourceNode && sourceNode.type === 'image') {
        const url =
          pickPreviewUrl(buildDualImageAssetFromNodeData(sourceNode.data)) ||
          (sourceNode.data?.outputImage as string) ||
          (sourceNode.data?.originalImageUrl as string) ||
          (sourceNode.data?.inputImages as string[])?.[0] ||
          '';
        if (url) {
          const cells = emptyGridMapCells(DEFAULT_GRID_MAP_COLS, DEFAULT_GRID_MAP_ROWS);
          cells[0] = { src: url, sourceNodeId: connectFrom.sourceNodeId };
          nodeToAdd = {
            ...newNode,
            data: {
              ...newNode.data,
              cells,
            },
          };
        }
      }
    } else if (type === 'audio-extract-from-video' && connectFrom?.sourceNodeId) {
      const sourceNode = nodes.find((n) => n.id === connectFrom.sourceNodeId);
      if (isVideoTrackSourceNodeType(sourceNode?.type)) {
        const videoUrl = pickReferenceVideoFromSourceNode(sourceNode, connectFrom.sourceHandle);
        if (!videoUrl) {
          nodeToAdd = {
            ...nodeToAdd,
            data: {
              ...nodeToAdd.data,
              aiStatus: 'ERROR',
              errorMessage: '视频节点没有可提取的视频文件（请等待生成完成或重新导入）',
            },
          };
        } else if (window.electronAPI?.extractAudioFromVideo) {
          nodeToAdd = {
            ...nodeToAdd,
            data: {
              ...nodeToAdd.data,
              aiStatus: 'PROCESSING',
              errorMessage: undefined,
            },
          };
          const pid = projectId || undefined;
          queueMicrotask(() => {
            window.electronAPI!
              .extractAudioFromVideo(pid, videoUrl)
              .then((res) => {
                if (res?.audioUrl) {
                  setNodes((nds) =>
                    nds.map((n) =>
                      n.id === newNodeId
                        ? {
                            ...n,
                            data: {
                              ...n.data,
                              outputAudio: res.audioUrl,
                              originalAudioUrl: res.audioUrl,
                              aiStatus: 'SUCCESS',
                              errorMessage: undefined,
                              updatedAt: Date.now(),
                            },
                          }
                        : n,
                    ),
                  );
                } else {
                  setNodes((nds) =>
                    nds.map((n) =>
                      n.id === newNodeId
                        ? {
                            ...n,
                            data: {
                              ...n.data,
                              aiStatus: 'ERROR',
                              errorMessage: '提取音频未返回结果',
                            },
                          }
                        : n,
                    ),
                  );
                }
              })
              .catch((err) => {
                console.error('[Workspace] 从视频提取音频失败:', err);
                setNodes((nds) =>
                  nds.map((n) =>
                    n.id === newNodeId
                      ? {
                          ...n,
                          data: {
                            ...n.data,
                            errorMessage: err?.message || '提取音频失败',
                            aiStatus: 'ERROR',
                          },
                        }
                      : n,
                  ),
                );
              });
          });
        }
      }
    } else if ((type === 'audio' || type === 'audio-voice-cover') && connectFrom?.sourceNodeId) {
      const sourceNode = nodes.find((n) => n.id === connectFrom.sourceNodeId);
      if (sourceNode?.type === 'rvcTrain' && (type === 'audio-voice-cover' || type === 'audio')) {
        const src = sourceNode.data as Record<string, unknown>;
        const voiceName = resolveRvcTrainNickname(src as { rvcTrainModelName?: string; title?: string });
        const hasModel = !!(src.outputModelUrl || src.libraryRvcVoiceId);
        if (hasModel || type === 'audio-voice-cover') {
          nodeToAdd = {
            ...nodeToAdd,
            data: {
              ...nodeToAdd.data,
              model: AI_VOICE_COVER_MODEL_ID,
              rvcTrainModelName: voiceName,
              rvcCoverModelName: deriveRvcCoverModelPath(voiceName),
              libraryRvcVoiceId: src.libraryRvcVoiceId,
              outputModelUrl: src.outputModelUrl,
              outputModelRemoteUrl: src.outputModelRemoteUrl,
            },
          };
        }
      } else if (sourceNode?.type === 'audio') {
        const audioUrl = (sourceNode.data?.outputAudio || sourceNode.data?.originalAudioUrl) as string | undefined;
        if (audioUrl) {
          if (type === 'audio-voice-cover') {
            nodeToAdd = {
              ...nodeToAdd,
              data: {
                ...nodeToAdd.data,
                model: AI_VOICE_COVER_MODEL_ID,
                sourceSongAudioUrl: audioUrl,
                rvcCoverModelName: '',
              },
            };
          } else {
            nodeToAdd = {
              ...nodeToAdd,
              data: {
                ...nodeToAdd.data,
                model: 'index-tts2',
                outputAudio: audioUrl,
                originalAudioUrl: audioUrl,
                referenceAudioUrl: audioUrl,
              },
            };
          }
        }
      } else if (sourceNode?.type === 'character') {
        const refUrl = String(sourceNode.data?.voiceClip || sourceNode.data?.referenceAudioUrl || '').trim();
        if (refUrl) {
          nodeToAdd = {
            ...nodeToAdd,
            data: {
              ...nodeToAdd.data,
              model: 'index-tts2',
              referenceAudioUrl: refUrl,
            },
          };
        }
      }
    } else if ((type === 'audio-extract-vocals' || type === 'audio-extract-background') && connectFrom?.sourceNodeId) {
      const sourceNode = nodes.find((n) => n.id === connectFrom.sourceNodeId);
      if (sourceNode?.type === 'audio') {
        const audioUrl = (sourceNode.data?.outputAudio || sourceNode.data?.originalAudioUrl) as string | undefined;
        if (audioUrl && window.electronAPI?.separateVocalsFromAudio) {
          const audioSourceType = type === 'audio-extract-vocals' ? 'vocals' : 'accompaniment';
          nodeToAdd = { ...nodeToAdd, data: { ...nodeToAdd.data, aiStatus: 'PROCESSING' as const, progressMessage: '人声分离中，约需 1–3 分钟…', audioSourceType } };
        }
      }
    } else if ((type === 'video' || isWanAnimateType) && connectFrom?.sourceNodeId) {
      const sourceNode = nodes.find((n) => n.id === connectFrom.sourceNodeId);
      let imageUrl: string | null = null;
      if (sourceNode?.type === 'image') {
        imageUrl =
          pickPreviewUrl(buildDualImageAssetFromNodeData(sourceNode.data)) ||
          (sourceNode.data?.inputImages as string[])?.[0] ||
          null;
      } else if (sourceNode?.type === 'character') {
        const urls = getCharacterTransmitImageUrls(sourceNode.data as Record<string, unknown>);
        imageUrl = urls[0] || null;
      }
      if (imageUrl) {
        nodeToAdd = { ...newNode, data: { ...newNode.data, inputImages: [imageUrl] } };
      }
    } else if (type === 'textSplit' && connectFrom?.sourceNodeId) {
      const sourceNode = nodes.find((n) => n.id === connectFrom.sourceNodeId);
      let textToSplit = '';
      if (sourceNode) {
        if (sourceNode.type === 'minimalistText' || sourceNode.type === 'text') {
          textToSplit = (sourceNode.data?.text as string) || '';
        } else if (sourceNode.type === 'llm') {
          textToSplit = (sourceNode.data?.outputText as string) || '';
        } else if (sourceNode.type === 'textSplit') {
          textToSplit = pickTextSplitSegmentText(sourceNode.data, connectFrom.sourceHandleId);
        }
      }
      if (textToSplit) {
        nodeToAdd = { ...newNode, data: { ...newNode.data, inputText: textToSplit } };
      }
    } else if (
      connectFrom?.sourceNodeId &&
      (type === 'llm' || isImageType || isVideoLikeType || type === 'text')
    ) {
      const sourceNode = nodes.find((n) => n.id === connectFrom.sourceNodeId);
      if (sourceNode?.type === 'textSplit') {
        const segText = pickTextSplitSegmentText(sourceNode.data, connectFrom.sourceHandleId);
        if (segText) {
          if (type === 'llm') {
            nodeToAdd = { ...nodeToAdd, data: { ...nodeToAdd.data, inputText: segText } };
          } else if (type === 'text') {
            nodeToAdd = { ...nodeToAdd, data: { ...nodeToAdd.data, text: segText } };
          } else {
            nodeToAdd = { ...nodeToAdd, data: { ...nodeToAdd.data, prompt: segText } };
          }
        }
      }
    } else if (isRvcTrainType && connectFrom?.sourceNodeId) {
      const sourceNode = nodes.find((n) => n.id === connectFrom.sourceNodeId);
      if (sourceNode?.type === 'audio') {
        const trainUrl = pickBestAudioUrlForRhTrainFromNodeData(sourceNode.data as Record<string, unknown>);
        if (trainUrl) {
          nodeToAdd = {
            ...nodeToAdd,
            data: {
              ...nodeToAdd.data,
              referenceAudioUrl: trainUrl,
            },
          };
        }
      }
    } else if (isImageComparerType && connectFrom?.sourceNodeId) {
      const sourceNode = nodes.find((n) => n.id === connectFrom.sourceNodeId);
      if (sourceNode?.type === 'image') {
        const url = pickImageUrlFromImageSourceNode(sourceNode);
        if (url) {
          nodeToAdd = {
            ...nodeToAdd,
            data: {
              ...nodeToAdd.data,
              imageAUrl: url,
              imageASourceNodeId: connectFrom.sourceNodeId,
            },
          };
        }
      }
    } else if (isImageTo3dType && connectFrom?.sourceNodeId) {
      const sourceNode = nodes.find((n) => n.id === connectFrom.sourceNodeId);
      if (sourceNode?.type === 'image') {
        const url = pickImageUrlFromImageSourceNode(sourceNode);
        if (url) {
          nodeToAdd = { ...nodeToAdd, data: { ...nodeToAdd.data, inputImageUrl: url } };
        }
      }
    } else if (isVideoSpliceType && connectFrom?.sourceNodeId) {
      // 从 video/image/audio 拖拽创建视频剪辑时，直接将素材导入轨道
      const sourceNode = nodes.find((n) => n.id === connectFrom.sourceNodeId);
      if (sourceNode && (isVideoTrackSourceNodeType(sourceNode.type) || sourceNode.type === 'image' || sourceNode.type === 'audio')) {
        const resolved = resolveTimelineMediaFromSource(sourceNode);
        if (resolved) {
          const { clipType, url } = resolved;
          const sourceDur = resolveSourceMediaDurationSec(sourceNode);
          const duration = clipType === 'image' ? 3 : sourceDur > 0 ? sourceDur : 0;
          const newClip: TimelineClip = {
            id: `${clipType}-${Date.now()}-${connectFrom.sourceNodeId}`,
            type: clipType,
            src: url,
            duration,
            startTime: 0,
            name: clipType === 'video' ? '视频' : clipType === 'image' ? '图片' : '音频',
            sourceNodeId: connectFrom.sourceNodeId,
          };
          if (clipType === 'audio') {
            nodeToAdd = {
              ...newNode,
              data: {
                ...newNode.data,
                ...applyBuiltClipsToSpliceData(undefined, {
                  videoTracks: [[]],
                  videoClips: [],
                  audioTracks: [[newClip]],
                }),
              },
            };
          } else {
            nodeToAdd = {
              ...newNode,
              data: {
                ...newNode.data,
                ...applyBuiltClipsToSpliceData(undefined, {
                  videoTracks: [[newClip]],
                  videoClips: [newClip],
                  audioTracks: [[]],
                }),
              },
            };
          }
        }
      }
    }
    // 右键创建时自动选中新节点，取消其他节点选中，确保点击/框选后控件可见
    setNodes((nds) =>
      nds.map((n) => ({ ...n, selected: false })).concat({ ...nodeToAdd, selected: true, selectable: true })
    );
    setSelectedNode(nodeToAdd);

    // 视频/音频：异步获取真实时长并更新节点
    if (isVideoSpliceType && connectFrom?.sourceNodeId && nodeToAdd.id) {
      const sourceNode = nodes.find((n) => n.id === connectFrom.sourceNodeId);
      if (sourceNode && (isVideoTrackSourceNodeType(sourceNode.type) || sourceNode.type === 'audio')) {
        const url =
          isVideoTrackSourceNodeType(sourceNode.type)
            ? ((sourceNode.data?.outputVideo || sourceNode.data?.originalVideoUrl || '') as string)
            : normalizeVideoUrl((sourceNode.data?.outputAudio || sourceNode.data?.originalAudioUrl || sourceNode.data?.referenceAudioUrl || '') as string);
        if (url) {
          const isVideo = isVideoTrackSourceNodeType(sourceNode.type);
          const kind = isVideo ? 'video' as const : 'audio' as const;
          probeTimelineMediaDuration(url, kind, projectId || undefined).then((dur) => {
            if (dur <= 0) return;
            setNodes((nds) =>
              nds.map((n) => {
                if (n.id !== newNodeId || n.type !== 'videoSplice') return n;
                const sourceNode = nds.find((sn) => sn.id === connectFrom.sourceNodeId);
                const sourceHint = sourceNode ? resolveSourceMediaDurationSec(sourceNode) : 0;
                const videoTracks = normalizeVideoTracks(
                  n.data as { videoTracks?: TimelineClip[][]; videoClips?: TimelineClip[] },
                ) as TimelineClip[][];
                const audioTracks = (n.data?.audioTracks as TimelineClip[][] | undefined) ?? [[]];
                if (isVideo) {
                  let touched = false;
                  const nextVideoTracks = videoTracks.map((track) =>
                    track.map((c) => {
                      if (c.sourceNodeId !== connectFrom.sourceNodeId) return c;
                      touched = true;
                      return mergeProbedTimelineClipDuration(c, dur, sourceHint);
                    }),
                  );
                  if (touched) {
                    return {
                      ...n,
                      data: {
                        ...n.data,
                        ...applyBuiltClipsToSpliceData(n.data, {
                          videoTracks: nextVideoTracks,
                          videoClips: nextVideoTracks[0] ?? [],
                          audioTracks,
                        }),
                      },
                    };
                  }
                } else {
                  let touched = false;
                  const nextAudioTracks = audioTracks.map((track) =>
                    track.map((c) => {
                      if (c.sourceNodeId !== connectFrom.sourceNodeId) return c;
                      touched = true;
                      return mergeProbedTimelineClipDuration(c, dur, sourceHint);
                    }),
                  );
                  if (touched) {
                    return {
                      ...n,
                      data: {
                        ...n.data,
                        ...applyBuiltClipsToSpliceData(n.data, {
                          videoTracks,
                          videoClips: videoTracks[0] ?? [],
                          audioTracks: nextAudioTracks,
                        }),
                      },
                    };
                  }
                }
                return n;
              })
            );
          });
        }
      }
    }

    // 人声分离：节点已添加后再调用 API，并在完成时更新节点
    if ((type === 'audio-extract-vocals' || type === 'audio-extract-background') && connectFrom?.sourceNodeId) {
      const sourceNode = nodes.find((n) => n.id === connectFrom.sourceNodeId);
      if (sourceNode?.type === 'audio') {
        const audioUrl = (sourceNode.data?.outputAudio || sourceNode.data?.originalAudioUrl) as string | undefined;
        if (audioUrl && window.electronAPI?.separateVocalsFromAudio) {
          const mode = type === 'audio-extract-vocals' ? 'vocals' : 'accompaniment';
          window.electronAPI
            .separateVocalsFromAudio(projectId || undefined, audioUrl, mode)
            .then((res) => {
              if (res?.audioUrl) {
                setNodes((nds) =>
                  nds.map((n) =>
                    n.id === newNodeId
                      ? { ...n, data: { ...n.data, outputAudio: res.audioUrl, aiStatus: 'SUCCESS' as const } }
                      : n
                  )
                );
              }
            })
            .catch((err) => {
              console.error('[Workspace] 人声分离失败:', err);
              setNodes((nds) =>
                nds.map((n) =>
                  n.id === newNodeId
                    ? { ...n, data: { ...n.data, errorMessage: err?.message || '人声分离失败', aiStatus: 'ERROR' as const } }
                    : n
                )
              );
            });
        }
      }
    }

    // 新建视频 / 视频换人 / HeyGem 时自动选中并打开操作面板（HeyGem 双栏嵌在主框内）
    if (type === 'video' || isWanAnimateType || isHeyGemType) {
      setSelectedNode(nodeToAdd);
      const inputImages = (nodeToAdd.data?.inputImages as string[] | undefined) || [];
      setVideoInputPanelData({
        nodeId: nodeToAdd.id,
        prompt: (nodeToAdd.data?.prompt as string) || '',
        aspectRatio: (nodeToAdd.data?.aspectRatio as '16:9' | '9:16' | '1:1' | '2:3' | '3:2') || '16:9',
        model: (isHeyGemType
          ? 'hey-gem'
          : isWanAnimateType
            ? 'wan-animate'
            : ((nodeToAdd.data?.model as string) || (HIDE_SORA2_AND_SORA_CHARACTER_UI ? DEFAULT_VIDEO_MODEL_REPLACING_SORA2 : 'sora-2'))) as 'sora-2' | 'sora-2-pro' | 'kling-v2.6-pro' | 'kling-video-o1' | 'kling-video-o1-i2v' | 'kling-video-o1-start-end' | 'kling-video-o1-ref' | 'wan-2.6' | 'wan-2.6-flash' | 'wan-animate' | 'hey-gem' | 'gemini-omni' | 'gemini-omni-flash' | 'seedance-2.0-fast' | 'seedance-2.0-mini' | 'ltx-2.3-lipsync' | 'rhart-v3.1-fast' | 'rhart-v3.1-pro' | 'grok-3' | 'rhart-video-x' | 'grok-3-stable' | 'hailuo-02-t2v-standard' | 'hailuo-2.3-t2v-standard' | 'hailuo-02-i2v-standard' | 'hailuo-2.3-i2v-standard' | 'rh-video-start-end',
        hd: !!(nodeToAdd.data?.hd),
        duration: ((nodeToAdd.data?.duration as string) || '10') as '5' | '10' | '15' | '25',
        inputImages,
        resolutionRhartV31: ((nodeToAdd.data?.resolutionRhartV31 as string) || '1080p') as '720p' | '1080p' | '4k',
        durationGrok3: ((nodeToAdd.data?.durationGrok3 as string) || '10') as string,
        resolutionGrok3: ((nodeToAdd.data?.resolutionGrok3 as string) || '720p') as '720p',
        durationHailuo02: ((nodeToAdd.data?.durationHailuo02 as string) || '6') as '6' | '10',
        resolutionHailuo: ((nodeToAdd.data?.resolutionHailuo as string) || 'na') as 'na' | '720p' | '1080p' | '4k',
        durationKlingO1: ((nodeToAdd.data?.durationKlingO1 as string) || '5') as '5' | '10',
        modeKlingO1: ((nodeToAdd.data?.modeKlingO1 as string) || 'std') as 'std' | 'pro',
        guidanceScale: (nodeToAdd.data?.guidanceScale as number) ?? 0.5,
        sound: ((nodeToAdd.data?.sound as string) || 'false') as 'true' | 'false',
        shotType: ((nodeToAdd.data?.shotType as string) || 'single') as 'single' | 'multi',
        negativePrompt: (nodeToAdd.data?.negativePrompt as string) || '',
        resolutionWan26: ((nodeToAdd.data?.resolutionWan26 as string) || '1080p') as '720p' | '1080p',
        resolutionWanAnimate: coerceVideoWanAnimateResolution(nodeToAdd.data?.resolutionWanAnimate),
        wanAnimateClipSec: coerceWanAnimateClipSec(nodeToAdd.data?.wanAnimateClipSec),
        resolutionSeedance: coerceVideoSeedanceResolution(nodeToAdd.data?.resolutionSeedance, String(nodeToAdd.data?.model || 'seedance-2.0-fast')),
        durationSeedance: normalizeSeedanceDurationChoice(nodeToAdd.data?.durationSeedance, 10),
        resolutionGeminiOmni: coerceVideoGeminiOmniResolution(nodeToAdd.data?.resolutionGeminiOmni),
        durationGeminiOmni: normalizeGeminiOmniDurationChoice(nodeToAdd.data?.durationGeminiOmni, 6),
        durationWan26Flash: ((nodeToAdd.data?.durationWan26Flash as string) || '5') as '2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'11'|'12'|'13'|'14'|'15',
        enableAudio: nodeToAdd.data?.enableAudio !== false,
        durationVeo31ProOfficial: ((nodeToAdd.data?.durationVeo31ProOfficial as string) || '4') as '4' | '6' | '8',
        generateAudioVeo31ProOfficial: !!nodeToAdd.data?.generateAudioVeo31ProOfficial,
        referenceVideoUrl: isHeyGemType
          ? String((nodeToAdd.data as { referenceVideoUrl?: string } | undefined)?.referenceVideoUrl || '') || undefined
          : undefined,
        keepOriginalSound: !!nodeToAdd.data?.keepOriginalSound,
        inputAudioUrl: isHeyGemType
          ? String((nodeToAdd.data as { inputAudioUrl?: string } | undefined)?.inputAudioUrl || '') || undefined
          : undefined,
        heyGemScript: isHeyGemType
          ? String((nodeToAdd.data as { heyGemScript?: string } | undefined)?.heyGemScript || '')
          : undefined,
        heyGemTtsModel: isHeyGemType
          ? String((nodeToAdd.data as { heyGemTtsModel?: string } | undefined)?.heyGemTtsModel || DOUBAO_SEED_AUDIO_MODEL_ID)
          : undefined,
        heyGemCloneAudioUrl: isHeyGemType
          ? String((nodeToAdd.data as { heyGemCloneAudioUrl?: string } | undefined)?.heyGemCloneAudioUrl || '') || undefined
          : undefined,
        resolutionLtx23Lipsync: '720',
        durationLtx23I2v: normalizeLtx23DurationChoice(nodeToAdd.data?.durationLtx23I2v, 10),
        resolutionLtx23I2v: ((nodeToAdd.data?.resolutionLtx23I2v as string) || '720') as '720' | '1280' | '1920',
        durationLtx23T2v: normalizeLtx23DurationChoice(nodeToAdd.data?.durationLtx23T2v, 10),
        resolutionLtx23T2v: ((nodeToAdd.data?.resolutionLtx23T2v as string) || '720') as '720' | '1280' | '1920',
        sora2Channel: ((nodeToAdd.data?.sora2Channel as string) || 'plugin') as 'plugin' | 'core',
        isConnected: inputImages.length > 0,
      });
      setLlmInputPanelData(null);
      setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
      setCharacterInputPanelData(null);
      setAudioInputPanelData(null);
    }

    if (connectFrom?.sourceNodeId) {
      const srcNodeForEdge = nodes.find((n) => n.id === connectFrom.sourceNodeId);
      const resolvedSourceHandle =
        srcNodeForEdge?.type === 'textSplit'
          ? normalizeTextSplitSourceHandle(connectFrom.sourceHandleId)
          : (connectFrom.sourceHandleId ?? undefined);
      const targetHandle =
        isImageType ? 'image-input'
        : (type === 'video' || isWanAnimateType) ? 'input'  // Video 节点 Handle id 为 'input'
        : isRvcTrainType ? 'input'
        : isImageComparerType ? 'image_a'
        : isAudioType ? 'audio-input'
        : 'input';
      setEdges((eds) =>
        eds.concat({
          id: `e-${connectFrom.sourceNodeId}-${newNodeId}-${Date.now()}`,
          source: connectFrom.sourceNodeId,
          sourceHandle: resolvedSourceHandle,
          target: newNodeId,
          targetHandle,
        })
      );

      // 拖线创建「文本」且源为音/视频：不走 onConnect，需在此同步转写音源（与 onConnect 逻辑一致）
      if (type === 'text') {
        const srcNode = nodes.find((n) => n.id === connectFrom.sourceNodeId);
        if (srcNode?.type === 'audio') {
          const d = srcNode.data as Record<string, unknown>;
          const url =
            typeof (d.outputAudio ?? d.originalAudioUrl ?? d.referenceAudioUrl) === 'string'
              ? String(d.outputAudio ?? d.originalAudioUrl ?? d.referenceAudioUrl).trim()
              : '';
          if (url) {
            queueMicrotask(() => {
              setNodes((nds) =>
                nds.map((n) =>
                  n.id === newNodeId && n.type === 'minimalistText'
                    ? {
                        ...n,
                        data: {
                          ...n.data,
                          transcribeAudioUrl: url,
                          transcribeStatus: 'idle',
                          transcribeErrorMessage: undefined,
                        },
                      }
                    : n
                )
              );
            });
          }
        } else if (isVideoTrackSourceNodeType(srcNode?.type)) {
          const videoUrl = (srcNode.data?.outputVideo || srcNode.data?.originalVideoUrl) as string | undefined;
          if (videoUrl && window.electronAPI?.extractAudioFromVideo) {
            window.electronAPI
              .extractAudioFromVideo(projectId || undefined, videoUrl)
              .then((res) => {
                if (!res?.audioUrl) return;
                setNodes((nds) =>
                  nds.map((n) =>
                    n.id === newNodeId && n.type === 'minimalistText'
                      ? {
                          ...n,
                          data: {
                            ...n.data,
                            transcribeAudioUrl: res.audioUrl,
                            transcribeStatus: 'idle',
                            transcribeErrorMessage: undefined,
                            updatedAt: Date.now(),
                          },
                        }
                      : n
                  )
                );
              })
              .catch((err) => {
                setNodes((nds) =>
                  nds.map((n) =>
                    n.id === newNodeId && n.type === 'minimalistText'
                      ? {
                          ...n,
                          data: {
                            ...n.data,
                            transcribeStatus: 'ERROR',
                            transcribeErrorMessage: err?.message || '提取失败',
                          },
                        }
                      : n
                  )
                );
              });
          }
        }
      }
    }
    // 菜单项 onClose 会延迟关闭，此处不再重复关闭，避免过早卸载导致后续 click 落到画布触发 onPaneClick
  }, [projectId, contextMenu, setNodes, setEdges, nodes, setSelectedNode, setVideoInputPanelData, setLlmInputPanelData, setImageInputPanelData, setCharacterInputPanelData, setAudioInputPanelData]);

  // 画板工具完成：将绘制的图片创建为 Image 节点
  const handleCanvasToolConfirm = useCallback(
    async (dataUrl: string) => {
      const pending = canvasToolPending;
      setCanvasToolPending(null);
      if (!pending) return;

      const defaultWidth = IMAGE_NODE_DEFAULT_W;
      const defaultHeight = IMAGE_NODE_DEFAULT_H;
      const adjustedPosition = {
        x: pending.position.x - defaultWidth / 2,
        y: pending.position.y - defaultHeight / 2,
      };

      let outputImage = dataUrl;
      let originalImageUrl = dataUrl;
      let localPath = '';
      let tinyThumbUrl = '';
      let avgColorHex = '';
      let ghostBase64 = '';
      let assetWidth: number | undefined;
      let assetHeight: number | undefined;

      if (window.electronAPI?.createImageLocalResourceFromBuffer && projectId) {
        try {
          const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const resource = await window.electronAPI.createImageLocalResourceFromBuffer(
            projectId,
            `canvas-${Date.now()}.png`,
            bytes.buffer
          );
          outputImage = resource.previewUrl;
          originalImageUrl = resource.originalUrl;
          localPath = resource.originalPath;
          tinyThumbUrl = resource.tinyUrl || '';
          avgColorHex = resource.avgColorHex || '';
          ghostBase64 = resource.ghostBase64 || '';
          assetWidth = resource.width;
          assetHeight = resource.height;
        } catch (err) {
          console.error('[Workspace] 画板图片保存到项目失败:', err);
        }
      }

      const newNode: Node = {
        id: `image-${Date.now()}`,
        type: 'image',
        position: adjustedPosition,
        data: {
          label: '画板图片',
          width: defaultWidth,
          height: defaultHeight,
          title: 'image',
          resolution: '1k',
          aspectRatio: DEFAULT_IMAGE_ASPECT_RATIO,
          model: 'banana-2.0',
          outputImage,
          originalImageUrl,
          localPath,
          tinyThumbUrl,
          avgColorHex,
          imageAsset: {
            preview: outputImage,
            original: originalImageUrl,
            tiny: tinyThumbUrl,
            ghost: ghostBase64,
            avgColorHex,
            width: assetWidth,
            height: assetHeight,
          },
        },
      };

      setNodes((nds) => nds.concat(newNode));

      if (pending.connectFrom?.sourceNodeId) {
        setEdges((eds) =>
          eds.concat({
            id: `e-${pending.connectFrom!.sourceNodeId}-${newNode.id}-${Date.now()}`,
            source: pending.connectFrom!.sourceNodeId,
            sourceHandle: pending.connectFrom!.sourceHandleId ?? undefined,
            target: newNode.id,
            targetHandle: 'image-input',
          })
        );
      }
    },
    [canvasToolPending, projectId, setNodes, setEdges]
  );

  // 从左侧边栏拖拽节点到画布
  const onDragStart = (event: React.DragEvent, nodeType: string, label: string) => {
    event.dataTransfer.setData('application/reactflow', JSON.stringify({ type: nodeType, label }));
    event.dataTransfer.effectAllowed = 'move';
  };

  // 根据文件推断节点类型与初始 data
  const getFileNodeTypeAndData = useCallback((file: File & { path?: string }): { type: string; nodeType: string; extraData: Record<string, unknown> } | null => {
    const path = (file as File & { path?: string }).path;
    const name = (file.name || '').toLowerCase();
    const mime = (file.type || '').toLowerCase();
    const isImage = /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(name) || mime.startsWith('image/');
    const isVideo = /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(name) || mime.startsWith('video/');
    const isAudio = /\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(name) || mime.startsWith('audio/');
    const isText = /\.(txt|md|json|xml|html|css|js|ts|log)$/i.test(name) || mime.startsWith('text/');
    const normalizedPath = path ? `local-resource://${path.replace(/\\/g, '/')}` : '';

    if (isImage) {
      const imageSize = imageNodeSizeForAspectRatio(DEFAULT_IMAGE_ASPECT_RATIO);
      return {
        type: 'image',
        nodeType: 'image',
        extraData: {
          outputImage: normalizedPath,
          title: 'image',
          width: imageSize?.w ?? IMAGE_NODE_DEFAULT_W,
          height: imageSize?.h ?? IMAGE_NODE_DEFAULT_H,
          resolution: '1k',
          aspectRatio: DEFAULT_IMAGE_ASPECT_RATIO,
          model: 'banana-2.0',
          seedreamWidth: 2048,
          seedreamHeight: 2048,
        },
      };
    }
    if (isVideo) {
      const videoSize = videoNodeSizeForAspectRatio(DEFAULT_VIDEO_ASPECT_RATIO);
      return {
        type: 'video',
        nodeType: 'video',
        extraData: {
          outputVideo: normalizedPath,
          title: 'video',
          width: videoSize?.w ?? VIDEO_NODE_DEFAULT_W,
          height: videoSize?.h ?? VIDEO_NODE_DEFAULT_H,
          prompt: '',
          aspectRatio: DEFAULT_VIDEO_ASPECT_RATIO,
          model: HIDE_SORA2_AND_SORA_CHARACTER_UI ? DEFAULT_VIDEO_MODEL_REPLACING_SORA2 : 'sora-2',
          hd: false,
          duration: '10',
        },
      };
    }
    if (isAudio) {
      const fileTitle = audioDisplayTitleFromFileName(file.name || path || '') || 'audio';
      return {
        type: 'audio',
        nodeType: 'audio',
        extraData: {
          outputAudio: normalizedPath,
          title: fileTitle,
          width: AUDIO_NODE_WIDTH,
          height: AUDIO_NODE_HEIGHT,
          text: '',
          voiceId: 'Wise_Woman',
          speed: 1,
          volume: 1,
          pitch: 0,
          referenceAudioUrl: '',
          aiStatus: 'idle' as const,
        },
      };
    }
    if (isText) {
      return {
        type: 'text',
        nodeType: 'minimalistText',
        extraData: {
          title: 'text',
          text: '', // 稍后异步填充
          width: IMAGE_NODE_DEFAULT_W,
          height: IMAGE_NODE_DEFAULT_H,
          moduleSizeScaleVersion: MODULE_SIZE_SCALE_VERSION,
        },
      };
    }
    return null;
  }, []);

  const placeImageTo3dCharacterOnCanvas = useCallback(
    (character: Character, flowPosition: { x: number; y: number }, gridIndex = 0) => {
      const BATCH_COLS = 3;
      const BATCH_GAP = 50;
      const BATCH_CELL_W = 520;
      const BATCH_CELL_H = 320;
      const col = gridIndex % BATCH_COLS;
      const row = Math.floor(gridIndex / BATCH_COLS);
      const pos =
        gridIndex > 0
          ? {
              x: flowPosition.x + col * (BATCH_CELL_W + BATCH_GAP),
              y: flowPosition.y + row * (BATCH_CELL_H + BATCH_GAP),
            }
          : flowPosition;
      const newNode = buildImageTo3dNodeFromCharacter(
        character,
        pos,
        gridIndex > 0 ? `imageTo3d-${Date.now()}-${gridIndex}` : undefined,
      );
      const inputUrl = String(newNode.data?.inputImageUrl || '').trim();
      const tex = String(newNode.data?.resultTextureUrl || '').trim();
      setNodes((nds) => nds.map((n) => ({ ...n, selected: false })).concat(newNode));
      setSelectedNode(newNode);
      setImageTo3dInputPanelData({
        nodeId: newNode.id,
        inputImageUrl: inputUrl,
        resultTextureUrl: tex,
      });
      setLlmInputPanelData(null);
      setImageInputPanelData(null);
      setVideoInputPanelData(null);
      setCharacterInputPanelData(null);
      setAudioInputPanelData(null);
    },
    [
      setNodes,
      setSelectedNode,
      setImageTo3dInputPanelData,
      setLlmInputPanelData,
      setImageInputPanelData,
      setVideoInputPanelData,
      setCharacterInputPanelData,
      setAudioInputPanelData,
    ],
  );

  const placeSceneLibraryOnCanvas = useCallback(
    (scene: SceneLibraryItem, anchorFlowPosition: { x: number; y: number }) => {
      const normalUrl = sceneNormalImageUrl(scene);
      const display3dUrl = sceneDisplay3dImageUrl(scene);
      if (!normalUrl) return;

      const displayName = (scene.nickname || scene.name || '场景').trim();
      const ts = Date.now();
      const iw = IMAGE_NODE_DEFAULT_W;
      const ih = IMAGE_NODE_DEFAULT_H;
      const gap = 24;
      const has3d = !!display3dUrl;
      const pairWidth = has3d ? iw * 2 + gap : iw;
      const baseX = anchorFlowPosition.x - pairWidth / 2;
      const baseY = anchorFlowPosition.y - ih / 2;
      const normalNodeId = `image-${ts}-scene-normal`;

      const normalNode: Node = {
        id: normalNodeId,
        type: 'image',
        position: { x: baseX, y: baseY },
        data: {
          label: '图片节点',
          title: has3d ? `${displayName}·原图` : displayName,
          width: iw,
          height: ih,
          isUserResized: false,
          outputImage: normalUrl,
          originalImageUrl: normalUrl,
          sceneDisplay3dUrl: display3dUrl || undefined,
          resolution: '1k',
          aspectRatio: '16:9',
          model: 'banana-2.0',
          seedreamWidth: 2048,
          seedreamHeight: 2048,
          librarySceneId: scene.id,
        },
        selected: true,
        selectable: true,
      };

      const newNodes: Node[] = [normalNode];

      if (has3d) {
        newNodes.push({
          id: `image-${ts}-scene-3d`,
          type: 'image',
          position: { x: baseX + iw + gap, y: baseY },
          data: {
            label: '图片节点',
            title: `${displayName}·3D`,
            width: iw,
            height: ih,
            isUserResized: false,
            outputImage: display3dUrl,
            originalImageUrl: display3dUrl,
            resolution: '1k',
            aspectRatio: '16:9',
            model: 'banana-2.0',
            seedreamWidth: 2048,
            seedreamHeight: 2048,
            librarySceneId: scene.id,
          },
          selected: false,
          selectable: true,
        });
      }

      setNodes((nds) => nds.map((n) => ({ ...n, selected: false })).concat(newNodes));
      setSelectedNode(normalNode);
      setImageInputPanelData({
        nodeId: normalNodeId,
        prompt: '',
        resolution: '1k',
        aspectRatio: '16:9',
        model: 'banana-2.0',
        seedreamWidth: 2048,
        seedreamHeight: 2048,
        inputImages: [],
      });
      setLlmInputPanelData(null);
      setVideoInputPanelData(null);
      setCharacterInputPanelData(null);
      setAudioInputPanelData(null);
      setImageTo3dInputPanelData(null);
    },
    [
      setNodes,
      setSelectedNode,
      setImageInputPanelData,
      setLlmInputPanelData,
      setVideoInputPanelData,
      setCharacterInputPanelData,
      setAudioInputPanelData,
      setImageTo3dInputPanelData,
    ],
  );

  const handleScenePlaceToCanvas = useCallback(
    (scene: SceneLibraryItem, anchorScreen: { x: number; y: number }) => {
      const api = flowContentApiRef.current;
      if (!api?.screenToFlowPosition) {
        placeSceneLibraryOnCanvas(scene, { x: 400, y: 300 });
        return;
      }
      const flowPos = api.screenToFlowPosition(anchorScreen);
      placeSceneLibraryOnCanvas(scene, flowPos);
    },
    [placeSceneLibraryOnCanvas],
  );

  const placeDigitalHumanLibraryOnCanvas = useCallback(
    (item: DigitalHumanLibraryItem, anchorFlowPosition: { x: number; y: number }) => {
      void (async () => {
        const videoUrl = digitalHumanVideoUrl(item);
        if (!videoUrl) return;

        const displayName = (item.nickname || item.name || '数字人').trim();
        const poster = digitalHumanPosterUrl(item);
        const pixel = await probeVideoPixelSize(videoUrl).catch(() => undefined);

        const aspectRatio =
          pixel?.width && pixel?.height
            ? snapToVideoPanelAspectRatio(aspectRatioLabelFromPixelSize(pixel.width, pixel.height))
            : '9:16';
        const fallbackSize = videoNodeSizeForAspectRatio(aspectRatio);
        const nodeW = fallbackSize?.w ?? VIDEO_NODE_DEFAULT_W;
        const nodeH = fallbackSize?.h ?? VIDEO_NODE_DEFAULT_H;
        const nodeId = `video-${Date.now()}`;

        let newNode: Node = {
          id: nodeId,
          type: 'video',
          position: { x: anchorFlowPosition.x - nodeW / 2, y: anchorFlowPosition.y - nodeH / 2 },
          data: {
            label: 'video',
            title: displayName,
            outputVideo: videoUrl,
            originalVideoUrl: item.originalVideoUrl || (videoUrl.startsWith('http') ? videoUrl : undefined),
            prompt: '',
            isUserResized: false,
            videoAsset: {
              ...(poster ? { poster } : {}),
              ...(pixel?.width && pixel?.height ? { width: pixel.width, height: pixel.height } : {}),
            },
          },
          selected: true,
          selectable: true,
        };
        if (pixel?.width && pixel?.height) {
          newNode = patchNodeWithMediaLayout(newNode, pixel.width, pixel.height, 'video');
        } else {
          newNode = patchNodeWithAspectRatioLayout(newNode, aspectRatio, 'video');
        }

        setNodes((nds) => nds.map((n) => ({ ...n, selected: false })).concat(newNode));
        setSelectedNode(newNode);
        setAudioInputPanelData(null);
        setCharacterInputPanelData(null);
        setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
        setLlmInputPanelData(null);
        setVideoInputPanelData(null);
      })();
    },
    [
      setNodes,
      setSelectedNode,
      setAudioInputPanelData,
      setCharacterInputPanelData,
      setImageInputPanelData,
      setImageTo3dInputPanelData,
      setLlmInputPanelData,
      setVideoInputPanelData,
    ],
  );

  const handleDigitalHumanPlaceToCanvas = useCallback(
    (item: DigitalHumanLibraryItem, anchorScreen: { x: number; y: number }) => {
      const api = flowContentApiRef.current;
      if (!api?.screenToFlowPosition) {
        placeDigitalHumanLibraryOnCanvas(item, { x: 400, y: 300 });
        return;
      }
      const flowPos = api.screenToFlowPosition(anchorScreen);
      placeDigitalHumanLibraryOnCanvas(item, flowPos);
    },
    [placeDigitalHumanLibraryOnCanvas],
  );

  const placeRvcVoiceLibraryOnCanvas = useCallback(
    (item: RvcVoiceLibraryItem, anchorFlowPosition: { x: number; y: number }) => {
      const newNode = buildRvcTrainNodeFromLibraryItem(item, anchorFlowPosition);
      setNodes((nds) => nds.map((n) => ({ ...n, selected: false })).concat(newNode));
      setSelectedNode(newNode);
      setRvcTrainInputPanelData({
        nodeId: newNode.id,
        rvcTrainModelName: (newNode.data?.rvcTrainModelName as string) ?? '',
        referenceAudioUrl: (newNode.data?.referenceAudioUrl as string) ?? '',
        libraryAvatarUrl: (newNode.data?.libraryAvatarUrl as string) ?? '',
      });
      setAudioInputPanelData(null);
      setCharacterInputPanelData(null);
      setImageInputPanelData(null);
      setImageTo3dInputPanelData(null);
      setLlmInputPanelData(null);
      setVideoInputPanelData(null);
    },
    [
      setNodes,
      setSelectedNode,
      setAudioInputPanelData,
      setCharacterInputPanelData,
      setImageInputPanelData,
      setImageTo3dInputPanelData,
      setLlmInputPanelData,
      setVideoInputPanelData,
    ],
  );

  const handleRvcVoicePlaceToCanvas = useCallback(
    (item: RvcVoiceLibraryItem, anchorScreen: { x: number; y: number }) => {
      const api = flowContentApiRef.current;
      if (!api?.screenToFlowPosition) {
        placeRvcVoiceLibraryOnCanvas(item, { x: 400, y: 300 });
        return;
      }
      const flowPos = api.screenToFlowPosition(anchorScreen);
      placeRvcVoiceLibraryOnCanvas(item, flowPos);
    },
    [placeRvcVoiceLibraryOnCanvas],
  );

  const persistRvcVoiceToLibrary = useCallback(
    async (params: {
      modelPackageUrl: string;
      modelPackageRemoteUrl?: string;
      outputModelLocalPath?: string;
      rvcTrainModelName?: string;
      trainAudioUrl?: string;
      avatarUrl?: string;
      nodeId?: string;
    }) => {
      if (!window.electronAPI?.registerRvcVoice) return null;
      const dedupeKey = params.nodeId || params.modelPackageUrl;
      if (rvcLibraryPersistedRef.current.has(dedupeKey)) return null;
      rvcLibraryPersistedRef.current.add(dedupeKey);
      try {
        const sourceNode = params.nodeId
          ? latestNodesRef.current.find((n) => n.id === params.nodeId)
          : undefined;
        const trainAudioUrl = (
          params.trainAudioUrl || String(sourceNode?.data?.referenceAudioUrl ?? '')
        ).trim();
        const avatarUrl = (params.avatarUrl || String(sourceNode?.data?.libraryAvatarUrl ?? '')).trim();
        const defaultName = deriveRvcPackageDisplayName(params.modelPackageUrl, params.outputModelLocalPath);
        const item = (await window.electronAPI.registerRvcVoice({
          modelPackageUrl: params.modelPackageUrl,
          modelPackageRemoteUrl: params.modelPackageRemoteUrl,
          rvcTrainModelName: params.rvcTrainModelName,
          nickname: params.rvcTrainModelName,
          trainAudioUrl: trainAudioUrl || undefined,
          trainAudioRemoteUrl: trainAudioUrl.startsWith('http') ? trainAudioUrl : undefined,
          avatarUrl: avatarUrl || undefined,
        })) as RvcVoiceLibraryItem;
        const savedTrainUrl = rvcVoiceTrainAudioUrl(item);
        const savedAvatar = rvcVoiceAvatarUrl(item);
        setRvcVoiceListRefreshTrigger((n) => n + 1);
        if (params.nodeId && item?.id) {
          setNodes((nds) =>
            nds.map((node) =>
              node.id === params.nodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      libraryRvcVoiceId: item.id,
                      rvcTrainModelName: params.rvcTrainModelName,
                      referenceAudioUrl: savedTrainUrl || node.data?.referenceAudioUrl,
                      libraryAvatarUrl: savedAvatar || node.data?.libraryAvatarUrl,
                      aiStatus: 'SUCCESS',
                      progress: 0,
                      errorMessage: undefined,
                    },
                  }
                : node,
            ),
          );
          const target = latestNodesRef.current.find((n) => n.id === params.nodeId);
          const nodePatch = {
            libraryRvcVoiceId: item.id,
            rvcTrainModelName: params.rvcTrainModelName,
            referenceAudioUrl: savedTrainUrl || undefined,
            libraryAvatarUrl: savedAvatar || undefined,
            aiStatus: 'SUCCESS' as const,
            errorMessage: undefined,
          };
          if (target?.type === 'rvcTrain') {
            handleRvcTrainNodeDataChangeRef.current?.(params.nodeId, {
              ...nodePatch,
              outputModelUrl: params.modelPackageUrl,
              outputModelRemoteUrl: params.modelPackageRemoteUrl,
            });
          } else if (target?.type === 'audio') {
            handleAudioNodeDataChange(params.nodeId, nodePatch);
          }
        }
        showAlert(`${assetLibraryT(locale).rvcVoiceSavedFromTrain}\n${defaultName || item.nickname || ''}`);
        return item;
      } catch (e) {
        rvcLibraryPersistedRef.current.delete(dedupeKey);
        console.error('[Workspace] RVC 音色入库失败', e);
        return null;
      }
    },
    [handleAudioNodeDataChange, setNodes, showAlert, locale],
  );

  const handleRvcVoiceLibraryUpdated = useCallback(
    (item: RvcVoiceLibraryItem) => {
      const displayName = rvcVoiceDisplayName(item, '');
      const trainUrl = rvcVoiceTrainAudioUrl(item);
      const avatar = rvcVoiceAvatarUrl(item);
      const pkgUrl = rvcVoiceModelPackageUrl(item);
      setNodes((nds) =>
        nds.map((node) => {
          if (node.data?.libraryRvcVoiceId !== item.id) return node;
          if (node.type === 'rvcTrain') {
            return {
              ...node,
              data: {
                ...node.data,
                rvcTrainModelName: displayName,
                title: displayName,
                label: displayName,
                referenceAudioUrl: trainUrl,
                libraryAvatarUrl: avatar || undefined,
                outputModelUrl: pkgUrl || node.data?.outputModelUrl,
                outputModelRemoteUrl: item.originalModelUrl || node.data?.outputModelRemoteUrl,
              },
            };
          }
          if (node.type === 'audio') {
            return {
              ...node,
              data: {
                ...node.data,
                rvcTrainModelName: displayName,
                title: displayName,
                libraryRvcVoiceId: item.id,
                outputModelUrl: pkgUrl || node.data?.outputModelUrl,
                outputModelRemoteUrl: item.originalModelUrl || node.data?.outputModelRemoteUrl,
              },
            };
          }
          return node;
        }),
      );
      setRvcTrainInputPanelData((prev) => {
        if (!prev?.nodeId) return prev;
        const linked = latestNodesRef.current.find((n) => n.id === prev.nodeId);
        if (linked?.data?.libraryRvcVoiceId !== item.id) return prev;
        return {
          ...prev,
          rvcTrainModelName: displayName,
          title: displayName,
          referenceAudioUrl: trainUrl,
          libraryAvatarUrl: avatar || undefined,
          outputModelUrl: pkgUrl || prev.outputModelUrl,
        };
      });
    },
    [setNodes],
  );

  // 在画布上放置节点（支持从左侧拖拽节点 或 从系统拖入文件，flowPosition 由 FlowContent 传入）
  // 本地拖入的图片/视频/音频会先复制到项目 assets，画布从项目路径读取，避免 OSS 次日删除或原路径失效导致“图片加载失败”
  const onDrop = useCallback(
    async (event: React.DragEvent, flowPosition: { x: number; y: number }) => {
      event.preventDefault();

      const reactFlowBounds = reactFlowWrapper.current?.getBoundingClientRect();
      const position = flowPosition ?? (reactFlowBounds
        ? { x: event.clientX - reactFlowBounds.left, y: event.clientY - reactFlowBounds.top }
        : { x: 0, y: 0 });

      // 从场景库拖入：创建图片节点（全景/场景图）
      const sceneLibraryPayload = event.dataTransfer.getData(NEXFLOW_SCENE_DRAG_MIME);
      if (sceneLibraryPayload?.trim()) {
        let scene: SceneLibraryItem;
        try {
          scene = JSON.parse(sceneLibraryPayload) as SceneLibraryItem;
        } catch {
          return;
        }
        const normalUrl = sceneNormalImageUrl(scene);
        if (!normalUrl) return;
        placeSceneLibraryOnCanvas(scene, position);
        return;
      }

      const digitalHumanPayload = event.dataTransfer.getData(NEXFLOW_DIGITAL_HUMAN_DRAG_MIME);
      if (digitalHumanPayload?.trim()) {
        let item: DigitalHumanLibraryItem;
        try {
          item = JSON.parse(digitalHumanPayload) as DigitalHumanLibraryItem;
        } catch {
          return;
        }
        placeDigitalHumanLibraryOnCanvas(item, position);
        return;
      }

      const rvcVoicePayload = event.dataTransfer.getData(NEXFLOW_RVC_VOICE_DRAG_MIME);
      if (rvcVoicePayload?.trim()) {
        let item: RvcVoiceLibraryItem;
        try {
          item = JSON.parse(rvcVoicePayload) as RvcVoiceLibraryItem;
        } catch {
          return;
        }
        placeRvcVoiceLibraryOnCanvas(item, position);
        return;
      }

      // 从角色库 / 3D 模型库卡片拖入
      const characterLibraryPayload = event.dataTransfer.getData(NEXFLOW_CHARACTER_DRAG_MIME);
      if (characterLibraryPayload?.trim()) {
        let character: Character;
        try {
          character = JSON.parse(characterLibraryPayload) as Character;
        } catch {
          return;
        }
        if (isImageTo3dLibraryCharacter(character)) {
          placeImageTo3dCharacterOnCanvas(character, position);
          return;
        }
        const padViewImagesFour = (vi: string[] | undefined): string[] => {
          const a = [...(vi || [])];
          while (a.length < 4) a.push('');
          return a.slice(0, 4);
        };
        const refUrl = resolveCharacterVoiceUrlForDrag(character) || '';
        const displayName = (character.nickname || character.name || '角色').trim();
        const cw = 624;
        const ch = 468;
        const nodePosition = {
          x: position.x - cw / 2,
          y: position.y - ch / 2,
        };
        const nodeId = `character-${Date.now()}`;
        const newNode: Node = {
          id: nodeId,
          type: 'character',
          position: nodePosition,
          data: {
            label: '角色节点',
            title: 'character',
            width: cw,
            height: ch,
            isUserResized: false,
            nickname: character.nickname || '',
            name: character.name || '',
            username: character.username,
            roleId: character.roleId,
            avatar: character.avatar || '',
            viewImages: padViewImagesFour(character.viewImages),
            referenceTransmitSlots: [...DEFAULT_REFERENCE_TRANSMIT_SLOTS],
            voiceClip: refUrl,
            referenceAudioUrl: refUrl,
            libraryCharacterId: character.id,
            videoUrl: '',
            timestamp: '1,3',
          },
          selected: true,
          selectable: true,
        };
        setNodes((nds) => nds.map((n) => ({ ...n, selected: false })).concat(newNode));
        setSelectedNode(newNode);
        setAudioInputPanelData(null);
        setVideoInputPanelData(null);
        setLlmInputPanelData(null);
        setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
        setCharacterInputPanelData({
          nodeId,
          videoUrl: '',
          nickname: character.nickname || '',
          timestamp: '1,3',
          characterChannel: 'core',
          isConnected: false,
          needsUpload: false,
          localVideoPath: undefined,
          isUploading: false,
        });
        return;
      }

      // 优先处理：从系统拖入的文件（支持批量：txt/image/video，网格布局排列）
      const files = event.dataTransfer?.files;
      if (files?.length > 0) {
        const transferData = event.dataTransfer.getData('application/reactflow');
        if (transferData?.trim()) return; // 若是从侧栏拖出的节点，走下方逻辑

        const assetPaths: string[] = [];
        for (let i = 0; i < files.length; i++) {
          const f = files[i] as File & { path?: string };
          const name = (f.name || '').toLowerCase();
          if ((name.endsWith('.aixflow') || name.endsWith('.glb')) && f.path) {
            assetPaths.push(f.path);
          }
        }
        if (assetPaths.length > 0) {
          try {
            let placed = 0;
            for (let i = 0; i < assetPaths.length; i++) {
              const { canceled, characters } = await importImageTo3dAssetsToCharacters({
                filePath: assetPaths[i],
              });
              if (canceled) continue;
              for (let j = 0; j < characters.length; j++) {
                placeImageTo3dCharacterOnCanvas(characters[j], position, placed);
                placed += 1;
              }
            }
            if (placed > 0) {
              setCharacterListCollapsed(false);
              setCharacterListRefreshTrigger((p) => p + 1);
              setSceneListRefreshTrigger((p) => p + 1);
            }
          } catch (err) {
            showAlert(
              userFacingErrorMessage(err instanceof Error ? err.message : '导入 3D 模型失败', locale),
            );
          }
          return;
        }

        const api = window.electronAPI;
        const pid = projectId ?? undefined;
        const BATCH_COLS = 3;
        const BATCH_GAP = 50;
        const BATCH_CELL_W = 400;
        const BATCH_CELL_H = 450;

        // 筛选支持的批量类型：txt, image, video, audio
        const supportedFiles: { file: File & { path?: string }; fileInfo: NonNullable<ReturnType<typeof getFileNodeTypeAndData>> }[] = [];
        for (let i = 0; i < files.length; i++) {
          const file = files[i] as File & { path?: string };
          const fileInfo = getFileNodeTypeAndData(file);
          if (fileInfo && ['text', 'image', 'video', 'audio'].includes(fileInfo.type)) {
            supportedFiles.push({ file, fileInfo });
          }
        }
        if (supportedFiles.length === 0) return;

        const newNodes: Node[] = [];
        const textNodeUpdates: { nodeId: string; setText: (text: string) => void }[] = [];

        for (let idx = 0; idx < supportedFiles.length; idx++) {
          const { file, fileInfo } = supportedFiles[idx];
          const col = idx % BATCH_COLS;
          const row = Math.floor(idx / BATCH_COLS);
          const nodePosition = {
            x: position.x + col * (BATCH_CELL_W + BATCH_GAP),
            y: position.y + row * (BATCH_CELL_H + BATCH_GAP),
          };

          let extraData = { ...fileInfo.extraData };

          // 图片：走本地资源管理
          if (fileInfo.type === 'image') {
            let imageResource: {
              originalPath: string;
              previewPath: string;
              tinyPath: string;
              originalUrl: string;
              previewUrl: string;
              tinyUrl: string;
              avgColorHex?: string;
              ghostBase64?: string;
              width?: number;
              height?: number;
            } | null = null;
            if (file.path && api?.createImageLocalResourceFromFile) {
              try {
                imageResource = await api.createImageLocalResourceFromFile(pid, file.path);
              } catch (e) {
                console.warn('[onDrop] 图片按路径创建本地资源失败，回退 buffer 路径', e);
              }
            }
            if (!imageResource && api?.createImageLocalResourceFromBuffer) {
              try {
                const buffer = await file.arrayBuffer();
                imageResource = await api.createImageLocalResourceFromBuffer(pid, file.name || 'dropped-image.png', buffer);
              } catch (e) {
                console.warn('[onDrop] 图片按 buffer 创建本地资源失败', e);
              }
            }
            if (imageResource) {
              extraData = {
                ...extraData,
                outputImage: imageResource.previewUrl,
                originalImageUrl: imageResource.originalUrl,
                localPath: imageResource.originalPath,
                tinyThumbUrl: imageResource.tinyUrl,
                avgColorHex: imageResource.avgColorHex,
                imageAsset: {
                  preview: imageResource.previewUrl,
                  original: imageResource.originalUrl,
                  tiny: imageResource.tinyUrl,
                  ghost: imageResource.ghostBase64,
                  avgColorHex: imageResource.avgColorHex,
                  width: imageResource.width,
                  height: imageResource.height,
                },
              };
            } else {
              extraData = { ...extraData, outputImage: '' };
            }
          }

          // 视频：优先直接挂源路径（避免主进程整文件复制卡死）；失败再回退
          if (fileInfo.type === 'video') {
            let videoUrl = '';
            if (file.path) {
              let p = String(file.path).replace(/\\/g, '/');
              if (p.match(/^[a-zA-Z]:\//)) p = p[0].toUpperCase() + p.slice(1);
              else if (p.match(/^[a-zA-Z]\//)) p = p[0].toUpperCase() + ':' + p.slice(1);
              videoUrl = `local-resource://${p}`;
            }
            if (videoUrl) {
              extraData = {
                ...extraData,
                outputVideo: videoUrl,
                originalVideoUrl: '',
              };
            } else {
              extraData = { ...extraData, outputVideo: '' };
            }
          }

          // 音频：复制到项目 assets，使用 local-resource:// 路径
          if (fileInfo.type === 'audio') {
            let audioUrl = '';
            if (file.path && api?.copyFileToProjectAssets) {
              try {
                const { savedPath } = await api.copyFileToProjectAssets(pid, file.path);
                audioUrl = `local-resource://${savedPath}`;
              } catch (e) {
                console.warn('[onDrop] 音频按路径复制到项目失败，回退 buffer 路径', e);
              }
            }
            if (!audioUrl && api?.saveDroppedFileBufferToProjectAssets) {
              try {
                const buffer = await file.arrayBuffer();
                const { savedPath } = await api.saveDroppedFileBufferToProjectAssets(pid, file.name || 'dropped-audio.mp3', buffer);
                audioUrl = `local-resource://${savedPath}`;
              } catch (e) {
                console.warn('[onDrop] 音频按 buffer 保存到项目失败', e);
              }
            }
            if (!audioUrl) {
              audioUrl = (file.path ? `local-resource://${file.path.replace(/\\/g, '/')}` : '') || '';
            }
            const fileTitle = audioDisplayTitleFromFileName(file.name || file.path || '') || 'audio';
            extraData = {
              ...extraData,
              outputAudio: audioUrl,
              originalAudioUrl: audioUrl || undefined,
              title: fileTitle,
              text: '',
              voiceId: 'Wise_Woman',
              speed: 1,
              volume: 1,
              pitch: 0,
              referenceAudioUrl: '',
              aiStatus: 'idle' as const,
            };
          }

          const nodeId = `${fileInfo.type}-${Date.now()}-${idx}`;
          let newNode: Node = {
            id: nodeId,
            type: fileInfo.nodeType as any,
            position: nodePosition,
            data: { label: fileInfo.type, ...extraData, isUserResized: false },
            selected: supportedFiles.length === 1,
            selectable: true,
          };
          if (fileInfo.type === 'image') {
            const asset = extraData.imageAsset as { width?: number; height?: number } | undefined;
            if (asset?.width && asset?.height) {
              newNode = patchNodeWithMediaLayout(newNode, asset.width, asset.height, 'image');
            } else {
              newNode = patchNodeWithAspectRatioLayout(newNode, String(extraData.aspectRatio || DEFAULT_IMAGE_ASPECT_RATIO), 'image');
            }
          } else if (fileInfo.type === 'video') {
            const asset = extraData.videoAsset as { width?: number; height?: number } | undefined;
            if (asset?.width && asset?.height) {
              newNode = patchNodeWithMediaLayout(newNode, asset.width, asset.height, 'video');
            } else {
              newNode = patchNodeWithAspectRatioLayout(newNode, String(extraData.aspectRatio || DEFAULT_VIDEO_ASPECT_RATIO), 'video');
            }
          }
          newNodes.push(newNode);

          // 文本文件：异步读取内容，稍后更新节点
          if (fileInfo.type === 'text') {
            textNodeUpdates.push({
              nodeId,
              setText: (text: string) => {
                setNodes((nds) =>
                  nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, text } } : n))
                );
              },
            });
          }
        }

        setNodes((nds) =>
          nds.map((n) => ({ ...n, selected: false })).concat(newNodes)
        );
        if (newNodes.length === 1) {
          setSelectedNode(newNodes[0]);
        } else {
          setSelectedNode(null);
        }

        // 批量导入时选中节点并弹出操作框（仅当仅有一个时）
        const videoNodes = newNodes.filter((n) => isVideoModuleNodeType(n.type));
        const audioNodes = newNodes.filter((n) => n.type === 'audio');
        if (videoNodes.length === 1 && newNodes.length === 1) {
          setVideoInputPanelData({
            nodeId: videoNodes[0].id,
            prompt: '',
            aspectRatio: '16:9',
            model: HIDE_SORA2_AND_SORA_CHARACTER_UI ? DEFAULT_VIDEO_MODEL_REPLACING_SORA2 : 'sora-2',
            hd: false,
            duration: '10',
            inputImages: [],
            resolutionRhartV31: '1080p',
            durationGrok3: '10',
            resolutionGrok3: '720p',
            durationHailuo02: '6',
            resolutionHailuo: 'na',
            durationKlingO1: '5',
            modeKlingO1: 'std',
            guidanceScale: 0.5,
            sound: 'false',
            shotType: 'single',
            negativePrompt: '',
            resolutionWan26: '1080p',
            resolutionWanAnimate: '720p',
            wanAnimateClipSec: '8',
            resolutionSeedance: '720p',
            durationSeedance: '10',
            resolutionGeminiOmni: '720p',
            durationGeminiOmni: '6',
            durationWan26Flash: '5',
            enableAudio: true,
            durationVeo31ProOfficial: '4',
            generateAudioVeo31ProOfficial: false,
            referenceVideoUrl: undefined,
            keepOriginalSound: false,
            inputAudioUrl: undefined,
            resolutionLtx23Lipsync: '720',
            durationLtx23I2v: '10',
            resolutionLtx23I2v: '720',
            durationLtx23T2v: '10',
            resolutionLtx23T2v: '720',
            sora2Channel: 'plugin',
            isConnected: false,
          });
          setLlmInputPanelData(null);
          setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
          setCharacterInputPanelData(null);
          setAudioInputPanelData(null);
        } else if (audioNodes.length === 1 && newNodes.length === 1) {
          setAudioInputPanelData({
            nodeId: audioNodes[0].id,
            text: (audioNodes[0].data?.text as string) ?? '',
            model: (audioNodes[0].data?.model as string) ?? 'speech-2.8-hd',
            voiceId: (audioNodes[0].data?.voiceId as string) ?? 'Wise_Woman',
            speed: (audioNodes[0].data?.speed as number) ?? 1,
            volume: (audioNodes[0].data?.volume as number) ?? 1,
            pitch: (audioNodes[0].data?.pitch as number) ?? 0,
            emotion: audioNodes[0].data?.emotion,
            referenceAudioUrl: (audioNodes[0].data?.referenceAudioUrl as string) ?? '',
            sourceSongAudioUrl: (audioNodes[0].data?.sourceSongAudioUrl as string) ?? '',
            coverPitch: clampCoverPitch(audioNodes[0].data?.coverPitch ?? 0),
            coverIndexRate: clampCoverIndexRate(audioNodes[0].data?.coverIndexRate),
            coverVocalMixPct: clampCoverVocalMixPct(audioNodes[0].data?.coverVocalMixPct),
            coverAccompanimentMixPct: resolveCoverAccompanimentMixPct(
              audioNodes[0].data?.coverAccompanimentMixPct,
              audioNodes[0].data?.coverOutputMode,
            ),
            coverRhVolume: (audioNodes[0].data?.coverRhVolume as number | undefined) ?? 5,
            rvcTrainModelName: (audioNodes[0].data?.rvcTrainModelName as string) ?? '',
            songName: (audioNodes[0].data?.songName as string) ?? '',
            styleDesc: (audioNodes[0].data?.styleDesc as string) ?? '',
            lyrics: (audioNodes[0].data?.lyrics as string) ?? '',
          });
          setVideoInputPanelData(null);
          setLlmInputPanelData(null);
          setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
          setCharacterInputPanelData(null);
        } else {
          setVideoInputPanelData(null);
        }

        // 异步加载文本文件内容
        const textFiles = supportedFiles.filter((s) => s.fileInfo.type === 'text');
        for (let i = 0; i < textNodeUpdates.length; i++) {
          const { setText } = textNodeUpdates[i];
          const f = textFiles[i]?.file;
          if (!f) continue;
          const setTextToNode = setText;
          if (f.path && api?.copyFileToProjectAssets) {
            try {
              const { savedPath } = await api.copyFileToProjectAssets(pid, f.path);
              const url = `local-resource://${savedPath}`;
              const res = await fetch(url);
              if (res.ok) {
                const text = await res.text();
                setTextToNode(text);
              } else {
                f.text().then(setTextToNode).catch(() => {});
              }
            } catch {
              f.text().then(setTextToNode).catch(() => {});
            }
          } else {
            f.text()
              .then(async (text) => {
                if (api?.saveDroppedFileBufferToProjectAssets) {
                  try {
                    await api.saveDroppedFileBufferToProjectAssets(pid, f.name || 'dropped.txt', new TextEncoder().encode(text).buffer);
                  } catch (_) {}
                }
                setTextToNode(text);
              })
              .catch(() => {});
          }
        }

        // 拖入素材后保持当前视口，不自动一键归位
        return;
      }

      // 从任务列表拖入的生成结果（图片/视频/音频）
      const taskDataStr = event.dataTransfer.getData('application/nexflow-task');
      if (taskDataStr?.trim()) {
        try {
          const taskPayload = JSON.parse(taskDataStr) as {
            taskType?: 'image' | 'video' | 'audio' | 'text';
            imageUrl?: string;
            videoUrl?: string;
            audioUrl?: string;
            localFilePath?: string;
            nodeTitle?: string;
            prompt?: string;
          };
          const taskType =
            taskPayload.taskType ||
            (taskPayload.imageUrl ? 'image' : taskPayload.videoUrl ? 'video' : taskPayload.audioUrl ? 'audio' : taskPayload.prompt?.trim() ? 'text' : 'audio');
          const imageUrl = taskPayload.imageUrl || (taskPayload.localFilePath ? `local-resource://${taskPayload.localFilePath.replace(/\\/g, '/')}` : '');
          const videoUrl = taskPayload.videoUrl || (taskPayload.localFilePath && taskType === 'video' ? `local-resource://${taskPayload.localFilePath.replace(/\\/g, '/')}` : '');
          const audioUrl = taskPayload.audioUrl || (taskPayload.localFilePath && taskType === 'audio' ? `local-resource://${taskPayload.localFilePath.replace(/\\/g, '/')}` : '');
          const nodeTitle = (taskPayload.nodeTitle || taskType).replace(/[/\\?*:|"]/g, '_');
          const textContent = (taskPayload.prompt || '').trim();

          if (taskType === 'image' && imageUrl) {
            const nodeId = `image-${Date.now()}`;
            const newNode: Node = {
              id: nodeId,
              type: 'image',
              position,
              data: {
                label: 'image',
                outputImage: imageUrl,
                originalImageUrl: imageUrl,
                title: nodeTitle,
                prompt: taskPayload.prompt || '',
                width: IMAGE_NODE_DEFAULT_W,
                height: IMAGE_NODE_DEFAULT_H,
                moduleSizeScaleVersion: MODULE_SIZE_SCALE_VERSION,
              },
              selected: true,
              selectable: true,
            };
            setNodes((nds) => nds.map((n) => ({ ...n, selected: false })).concat(newNode));
            setSelectedNode(newNode);
            setImageInputPanelData((prev) => (prev ? null : null));
          } else if (taskType === 'video' && videoUrl) {
            const nodeId = `video-${Date.now()}`;
            const newNode: Node = {
              id: nodeId,
              type: 'video',
              position,
              data: {
                label: 'video',
                outputVideo: videoUrl,
                originalVideoUrl: videoUrl,
                title: nodeTitle,
                prompt: taskPayload.prompt || '',
                width: VIDEO_NODE_DEFAULT_W,
                height: VIDEO_NODE_DEFAULT_H,
                moduleSizeScaleVersion: MODULE_SIZE_SCALE_VERSION,
              },
              selected: true,
              selectable: true,
            };
            setNodes((nds) => nds.map((n) => ({ ...n, selected: false })).concat(newNode));
            setSelectedNode(newNode);
            setVideoInputPanelData({
              nodeId,
              prompt: taskPayload.prompt || '',
              aspectRatio: '16:9',
              model: HIDE_SORA2_AND_SORA_CHARACTER_UI ? DEFAULT_VIDEO_MODEL_REPLACING_SORA2 : 'sora-2',
              hd: false,
              duration: '10',
              inputImages: [],
              resolutionRhartV31: '1080p',
              durationGrok3: '10',
              resolutionGrok3: '720p',
              durationHailuo02: '6',
              resolutionHailuo: 'na',
              durationKlingO1: '5',
              modeKlingO1: 'std',
              guidanceScale: 0.5,
              sound: 'false',
              shotType: 'single',
              negativePrompt: '',
              resolutionWan26: '1080p',
              resolutionWanAnimate: '720p',
              wanAnimateClipSec: '8',
              resolutionSeedance: '720p',
              durationSeedance: '10',
              resolutionGeminiOmni: '720p',
              durationGeminiOmni: '6',
              durationWan26Flash: '5',
              enableAudio: true,
              durationVeo31ProOfficial: '4',
              generateAudioVeo31ProOfficial: false,
              referenceVideoUrl: undefined,
              keepOriginalSound: false,
              inputAudioUrl: undefined,
              resolutionLtx23Lipsync: '720',
              durationLtx23I2v: '10',
              resolutionLtx23I2v: '720',
              durationLtx23T2v: '10',
              resolutionLtx23T2v: '720',
              sora2Channel: 'plugin',
              isConnected: false,
            });
            setLlmInputPanelData(null);
            setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
            setCharacterInputPanelData(null);
            setAudioInputPanelData(null);
          } else if (taskType === 'audio' && audioUrl) {
            const nodeId = `audio-${Date.now()}`;
            const newNode: Node = {
              id: nodeId,
              type: 'audio',
              position,
              data: {
                label: 'audio',
                outputAudio: audioUrl,
                originalAudioUrl: audioUrl,
                title: nodeTitle,
                text: '',
                voiceId: 'Wise_Woman',
                speed: 1,
                volume: 1,
                pitch: 0,
                referenceAudioUrl: '',
                aiStatus: 'idle' as const,
              },
              selected: true,
              selectable: true,
            };
            setNodes((nds) => nds.map((n) => ({ ...n, selected: false })).concat(newNode));
            setSelectedNode(newNode);
            setAudioInputPanelData({
              nodeId,
              text: '',
              model: 'speech-2.8-hd',
              voiceId: 'Wise_Woman',
              speed: 1,
              volume: 1,
              pitch: 0,
              emotion: undefined,
              referenceAudioUrl: '',
              songName: '',
              styleDesc: '',
              lyrics: '',
            });
            setVideoInputPanelData(null);
            setLlmInputPanelData(null);
            setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
            setCharacterInputPanelData(null);
          } else if (taskType === 'text' && textContent) {
            const nodeId = `llm-${Date.now()}`;
            const newNode: Node = {
              id: nodeId,
              type: 'llm',
              position,
              data: {
                label: 'llm',
                title: taskPayload.nodeTitle || 'llm',
                outputText: textContent,
                width: scaleModulePx(300),
                height: AUDIO_NODE_HEIGHT,
                moduleSizeScaleVersion: MODULE_SIZE_SCALE_VERSION,
                isUserResized: false,
              },
              selected: true,
              selectable: true,
            };
            setNodes((nds) => nds.map((n) => ({ ...n, selected: false })).concat(newNode));
            setSelectedNode(newNode);
            setVideoInputPanelData(null);
            setLlmInputPanelData(null);
            setImageInputPanelData(null);
            setImageTo3dInputPanelData(null);
            setCharacterInputPanelData(null);
            setAudioInputPanelData(null);
          }

          if (
            (taskType === 'image' && imageUrl) ||
            (taskType === 'video' && videoUrl) ||
            (taskType === 'audio' && audioUrl) ||
            (taskType === 'text' && textContent)
          ) {
            // 拖入后保持当前视口，不自动一键归位
            return;
          }
        } catch (err) {
          console.warn('[onDrop] 解析任务拖放数据失败:', err);
        }
      }

      // 从左侧边栏拖拽的节点数据
      const transferData = event.dataTransfer.getData('application/reactflow');
      if (!transferData || transferData.trim() === '') return;

      let data: { type?: string; label?: string };
      try {
        data = JSON.parse(transferData);
      } catch (error) {
        console.error('解析拖放数据失败:', error);
        return;
      }
      if (!data?.type) return;

      const nodeType: string =
        data.type === 'text' ? 'minimalistText'
          : data.type === 'llm' ? 'llm'
          : data.type === 'textSplit' ? 'textSplit'
          : data.type === 'image' ? 'image'
          : data.type === 'video' ? 'video'
          : data.type === 'wanAnimate' ? 'wanAnimate'
          : data.type === 'heyGem' ? 'heyGem'
          : data.type === 'character' ? 'character'
          : data.type === 'audio' ? 'audio'
          : 'custom';

      const newNode: Node = {
        id: `${data.type}-${Date.now()}`,
        type: nodeType,
        position,
        style:
          data.type === 'audio'
            ? nodeStyleDimensions(AUDIO_NODE_WIDTH, AUDIO_NODE_HEIGHT)
            : undefined,
        width: data.type === 'audio' ? AUDIO_NODE_WIDTH : undefined,
        height: data.type === 'audio' ? AUDIO_NODE_HEIGHT : undefined,
        data: {
          label: data.label,
          width: data.type === 'text' ? IMAGE_NODE_DEFAULT_W : data.type === 'llm' ? AUDIO_NODE_WIDTH : data.type === 'textSplit' ? scaleModulePx(240) : data.type === 'image' ? IMAGE_NODE_DEFAULT_W : data.type === 'heyGem' ? HEYGEM_SHELL_W : (data.type === 'video' || data.type === 'wanAnimate') ? VIDEO_NODE_DEFAULT_W : data.type === 'character' ? scaleModulePx(624) : data.type === 'audio' ? AUDIO_NODE_WIDTH : undefined,
          height: data.type === 'text' ? IMAGE_NODE_DEFAULT_H : data.type === 'llm' ? AUDIO_NODE_HEIGHT : data.type === 'textSplit' ? scaleModulePx(200) : data.type === 'image' ? IMAGE_NODE_DEFAULT_H : data.type === 'heyGem' ? HEYGEM_SHELL_H : (data.type === 'video' || data.type === 'wanAnimate') ? VIDEO_NODE_DEFAULT_H : data.type === 'character' ? scaleModulePx(468) : data.type === 'audio' ? AUDIO_NODE_HEIGHT : undefined,
          moduleSizeScaleVersion: MODULE_SIZE_SCALE_VERSION,
          prompt: data.type === 'llm' || data.type === 'image' || data.type === 'video' || data.type === 'wanAnimate' || data.type === 'heyGem' ? '' : undefined,
          title: data.type === 'llm' ? 'llm' : data.type === 'image' ? 'image' : data.type === 'video' ? 'video' : data.type === 'wanAnimate' ? 'wanAnimate' : data.type === 'heyGem' ? 'heyGem' : data.type === 'character' ? 'character' : data.type === 'audio' ? 'audio' : data.type === 'textSplit' ? 'textSplit' : undefined,
          isUserResized: false,
          inputText: data.type === 'textSplit' ? '' : undefined,
          separator: data.type === 'textSplit' ? '\n' : undefined,
          trimAndFilterEmpty: data.type === 'textSplit' ? true : undefined,
          convertType: data.type === 'textSplit' ? 'string' : undefined,
          resolution: data.type === 'image' ? '1k' : undefined,
          aspectRatio: data.type === 'image' ? DEFAULT_IMAGE_ASPECT_RATIO : (data.type === 'video' || data.type === 'wanAnimate' || data.type === 'heyGem') ? DEFAULT_VIDEO_ASPECT_RATIO : undefined,
          seedreamWidth: data.type === 'image' ? 2048 : undefined,
          seedreamHeight: data.type === 'image' ? 2048 : undefined,
          model: data.type === 'image' ? 'banana-2.0' : data.type === 'video' ? (HIDE_SORA2_AND_SORA_CHARACTER_UI ? DEFAULT_VIDEO_MODEL_REPLACING_SORA2 : 'sora-2') : data.type === 'wanAnimate' ? 'wan-animate' : data.type === 'heyGem' ? 'hey-gem' : data.type === 'audio' ? 'speech-2.8-hd' : undefined,
          hd: (data.type === 'video' || data.type === 'wanAnimate' || data.type === 'heyGem') ? false : undefined,
          duration: (data.type === 'video' || data.type === 'wanAnimate' || data.type === 'heyGem') ? '10' : undefined,
          heyGemScript: data.type === 'heyGem' ? '' : undefined,
          heyGemTtsModel: data.type === 'heyGem' ? DOUBAO_SEED_AUDIO_MODEL_ID : undefined,
          videoUrl: data.type === 'character' ? '' : undefined,
          nickname: data.type === 'character' ? '' : undefined,
          timestamp: data.type === 'character' ? '1,3' : undefined,
          viewImages: data.type === 'character' ? ['', '', '', ''] : undefined,
          referenceTransmitSlots: data.type === 'character' ? [...DEFAULT_REFERENCE_TRANSMIT_SLOTS] : undefined,
          voiceClip: data.type === 'character' ? '' : undefined,
          referenceAudioUrl: data.type === 'character' ? '' : data.type === 'audio' ? '' : undefined,
          text: data.type === 'audio' ? '' : undefined,
          voiceId: data.type === 'audio' ? 'Wise_Woman' : undefined,
          speed: data.type === 'audio' ? 1 : undefined,
          volume: data.type === 'audio' ? 1 : undefined,
          pitch: data.type === 'audio' ? 0 : undefined,
          aiStatus: data.type === 'audio' ? 'idle' : undefined,
        },
      };

      setNodes((nds) => nds.concat(newNode));

      // 侧栏拖入后保持当前视口，不自动一键归位

      // 侧栏拖入视频 / 视频换人 / HeyGem 时自动选中并弹出下方操作框
      if (data.type === 'video' || data.type === 'wanAnimate' || data.type === 'heyGem') {
        setSelectedNode(newNode);
        setVideoInputPanelData({
          nodeId: newNode.id,
          prompt: '',
          aspectRatio: '16:9',
          model: data.type === 'heyGem' ? 'hey-gem' : data.type === 'wanAnimate' ? 'wan-animate' : (HIDE_SORA2_AND_SORA_CHARACTER_UI ? DEFAULT_VIDEO_MODEL_REPLACING_SORA2 : 'sora-2'),
          hd: false,
          duration: '10',
          inputImages: [],
          resolutionRhartV31: '1080p',
          durationGrok3: '10',
          resolutionGrok3: '720p',
          durationHailuo02: '6',
          resolutionHailuo: 'na',
          durationKlingO1: '5',
          modeKlingO1: 'std',
          guidanceScale: 0.5,
          sound: 'false',
          shotType: 'single',
          negativePrompt: '',
          resolutionWan26: '1080p',
          resolutionWanAnimate: '720p',
          wanAnimateClipSec: '8',
          resolutionSeedance: '720p',
          durationSeedance: '10',
          resolutionGeminiOmni: '720p',
          durationGeminiOmni: '6',
          durationWan26Flash: '5',
          enableAudio: true,
          durationVeo31ProOfficial: '4',
          generateAudioVeo31ProOfficial: false,
          referenceVideoUrl: undefined,
          keepOriginalSound: false,
          inputAudioUrl: undefined,
          heyGemScript: data.type === 'heyGem' ? '' : undefined,
          heyGemTtsModel: data.type === 'heyGem' ? DOUBAO_SEED_AUDIO_MODEL_ID : undefined,
          heyGemCloneAudioUrl: undefined,
          resolutionLtx23Lipsync: '720',
          durationLtx23I2v: '10',
          resolutionLtx23I2v: '720',
          durationLtx23T2v: '10',
          resolutionLtx23T2v: '720',
          sora2Channel: 'plugin',
          isConnected: false,
        });
        setLlmInputPanelData(null);
        setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
        setCharacterInputPanelData(null);
        setAudioInputPanelData(null);
      }
    },
    [
      setNodes,
      getFileNodeTypeAndData,
      projectId,
      setSelectedNode,
      setVideoInputPanelData,
      setLlmInputPanelData,
      setImageInputPanelData,
      setCharacterInputPanelData,
      setAudioInputPanelData,
      setImageTo3dInputPanelData,
      placeImageTo3dCharacterOnCanvas,
      placeSceneLibraryOnCanvas,
      placeDigitalHumanLibraryOnCanvas,
      setCharacterListCollapsed,
      setCharacterListRefreshTrigger,
      showAlert,
      locale,
    ]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    // 从系统拖入文件、从任务列表拖入生成结果、从角色库拖参考音时使用 copy，从侧栏拖节点时使用 move
    const types = event.dataTransfer.types || [];
    const useCopy =
      types.includes('Files') ||
      types.includes('application/nexflow-task') ||
      types.includes(NEXFLOW_CHARACTER_DRAG_MIME) ||
      types.includes(NEXFLOW_SCENE_DRAG_MIME) ||
      types.includes(NEXFLOW_DIGITAL_HUMAN_DRAG_MIME) ||
      types.includes(NEXFLOW_RVC_VOICE_DRAG_MIME);
    event.dataTransfer.dropEffect = useCopy ? 'copy' : 'move';
  }, []);

  const handleLafClick = useCallback(async () => {
    if (!window.electronAPI) return;
    try {
      setLafStatus('connecting');
      const state = window.electronAPI.nxCloudGetProfile
        ? await window.electronAPI.nxCloudGetProfile()
        : await window.electronAPI.initLafUser();
      setLafStatus(state.status as 'idle' | 'connecting' | 'success' | 'error');
      setLafBalance(state.status === 'success' ? state.balance : null);
    } catch {
      setLafStatus('error');
      setLafBalance(null);
    }
  }, []);

  // 监听 AI 状态更新（通过 ref 只注册一次监听，避免依赖变化导致多监听器泄漏）
  useEffect(() => {
    handleAIStatusUpdateRef.current = (packet: { nodeId: string; status: string; payload?: any }) => {
      if (!packet || !packet.nodeId) return;

      if (packet.status === 'ERROR' && packet.payload?.nxAuthRequired === true) {
        promptNxSaasLoginIfNeeded(packet.payload?.error, true);
      }

      // 当 AI 调用开始时（START 状态），触发余额查询
      // 注意：实际的余额刷新在主进程的 AICore 中完成，这里只是作为备用
      if (packet.status === 'START') {
        const startNode = latestNodesRef.current.find((x) => x.id === packet.nodeId);
        const startData = startNode?.data as Record<string, unknown> | undefined;
        const startInputPrompt = String(
          startData?.prompt || startData?.text || startData?.inputText || startData?.userInput || '',
        ).trim();
        upsertRuntimeTask(packet.nodeId, {
          status: 'running',
          errorMessage: undefined,
          taskType: getNodeTaskType(startNode?.type),
          ...(startInputPrompt ? { prompt: startInputPrompt } : {}),
        });
        console.log('[AI调用触发] 检测到 AI 调用，余额刷新由主进程处理');
        // 主进程的 AICore 已经处理了余额刷新，这里不需要重复操作
        
        // 初始化 Text 节点的进度条（如果存在）
        setNodes((nds) => {
          const targetNode = nds.find((n) => n.id === packet.nodeId);
          if (targetNode && targetNode.type === 'minimalistText') {
            return nds.map((node) =>
              node.id === packet.nodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      progress: 1,
                      progressMessage: packet.payload?.text || '正在初始化模型...',
                      errorMessage: undefined,
                    },
                  }
                : node
            );
          }
          // 初始化 Audio 节点的状态
          if (targetNode && (targetNode.type === 'audio' || targetNode.type === 'rvcTrain')) {
            return nds.map((node) =>
              node.id === packet.nodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      aiStatus: 'START',
                      errorMessage: undefined,
                    },
                  }
                : node
            );
          }
          // 初始化 LLM 节点的状态（反推图像等场景：同步到 node.data 避免重渲染导致动画丢失）
          if (targetNode && targetNode.type === 'llm') {
            return nds.map((node) =>
              node.id === packet.nodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      aiStatus: 'START',
                      progress: 1,
                      errorMessage: undefined,
                    },
                  }
                : node
            );
          }
          // 图片节点重新生成：立即挂上进度遮罩（保留已有 outputImage，仅显示生成动画）
          if (targetNode && targetNode.type === 'image') {
            return nds.map((node) =>
              node.id === packet.nodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      progress: 1,
                      progressMessage: packet.payload?.text || '正在生成...',
                      errorMessage: undefined,
                    },
                  }
                : node
            );
          }
          return nds;
        });
      }
      
      // 处理 Text 节点的 PROCESSING 状态（更新进度）
      if (packet.status === 'PROCESSING') {
        const tid = packet.payload?.taskId;
        const n = latestNodesRef.current.find((x) => x.id === packet.nodeId);
        const model = String(n?.data?.model || '');
        const soraCh = (n?.data?.sora2Channel as string) || 'plugin';
        const isSora2Family = model === 'sora-2' || model === 'sora-2-pro';
        const persistRhId =
          !!tid &&
          !!n &&
          (n.type === 'image' ||
            n.type === 'audio' ||
            (isVideoModuleNodeType(n.type) && (!isSora2Family || soraCh === 'plugin')));
        upsertRuntimeTask(packet.nodeId, {
          status: 'running',
          ...(persistRhId ? { runningHubTaskId: String(tid) } : {}),
        });
        setNodes((nds) => {
          const targetNode = nds.find((n) => n.id === packet.nodeId);
          if (targetNode && targetNode.type === 'minimalistText') {
            return nds.map((node) =>
              node.id === packet.nodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      progress: Math.max(1, packet.payload?.progress || 1),
                      progressMessage: packet.payload?.text || node.data?.progressMessage,
                    },
                  }
                : node
            );
          }
          if (targetNode && targetNode.type === 'image') {
            return nds.map((node) =>
              node.id === packet.nodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      progress: Math.max(1, packet.payload?.progress ?? 1),
                      progressMessage: packet.payload?.text || node.data?.progressMessage,
                      errorMessage: undefined,
                    },
                  }
                : node
            );
          }
          if (targetNode && isVideoModuleNodeType(targetNode.type)) {
            return nds.map((node) =>
              node.id === packet.nodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      progress: Math.max(1, packet.payload?.progress ?? 1),
                      progressMessage: packet.payload?.text || node.data?.progressMessage,
                      errorMessage: undefined,
                    },
                  }
                : node
            );
          }
          // 更新 Audio / RVC 训练节点的状态为 PROCESSING
          if (targetNode && (targetNode.type === 'audio' || targetNode.type === 'rvcTrain')) {
            return nds.map((node) =>
              node.id === packet.nodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      aiStatus: 'PROCESSING',
                      progress: Math.max(1, packet.payload?.progress ?? node.data?.progress ?? 1),
                      progressMessage: packet.payload?.text || node.data?.progressMessage,
                      errorMessage: undefined,
                    },
                  }
                : node
            );
          }
          // 更新 LLM 节点的状态为 PROCESSING（反推图像等场景）
          if (targetNode && targetNode.type === 'llm') {
            return nds.map((node) =>
              node.id === packet.nodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      aiStatus: 'PROCESSING',
                      progress: Math.max(1, packet.payload?.progress ?? 1),
                    },
                  }
                : node
            );
          }
          return nds;
        });
      }
      
      // 处理视频节点的 ERROR 状态（API 返回失败时，立即停止进度条并显示错误信息）
      if (packet.status === 'ERROR' && packet.payload?.error) {
        const nodeId = packet.nodeId;
        const errorMessage = packet.payload.error;
        const isTimeout = /timeout|超时/i.test(String(errorMessage || ''));
        upsertRuntimeTask(nodeId, {
          status: isTimeout ? 'timeout' : 'failed',
          errorMessage: String(errorMessage || '任务失败'),
        });
        
        // 若当前打开的是该节点的输入面板，立即同步清除面板进度，避免进度条继续显示
        setVideoInputPanelData((prev) => {
          if (prev && prev.nodeId === nodeId) {
            return { ...prev, progress: 0, progressMessage: undefined };
          }
          return prev;
        });
        
        // 使用函数式更新，确保基于最新状态
        setNodes((nds) => {
          const targetNode = nds.find((n) => n.id === nodeId);
          if (!targetNode || !isVideoModuleNodeType(targetNode.type)) {
            return nds; // 不是视频模块节点，不处理
          }
          
          console.log(`[Workspace] 视频模块节点 ${nodeId} 生成失败，停止进度条并显示错误:`, errorMessage);
          
          // 更新节点数据：停止进度条并设置错误信息
          const updatedNodes = nds.map((node) =>
            node.id === nodeId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    progress: 0, // 停止进度条
                    progressMessage: undefined,
                    errorMessage: errorMessage, // 显示错误信息
                  },
                }
              : node
          );
          
          // 触发 handleVideoNodeDataChange 以同步状态（使用 ref 避免闭包问题）
          setTimeout(() => {
            if (handleVideoNodeDataChangeRef.current) {
              handleVideoNodeDataChangeRef.current(nodeId, { 
                progress: 0, 
                progressMessage: undefined,
                errorMessage: errorMessage 
              });
            }
          }, 0);
          
          return updatedNodes;
        });
      }
      
      // 处理音频 / RVC 训练节点的 ERROR 状态（API 返回失败时，停止进度条并显示错误信息）
      if (packet.status === 'ERROR' && packet.payload?.error) {
        const nodeId = packet.nodeId;
        const errorMessage = packet.payload.error;
        const isTimeout = /timeout|超时/i.test(String(errorMessage || ''));
        const errNode = latestNodesRef.current.find((n) => n.id === nodeId);
        if (errNode && (errNode.type === 'audio' || errNode.type === 'rvcTrain')) {
          upsertRuntimeTask(nodeId, {
            status: isTimeout ? 'timeout' : 'failed',
            errorMessage: String(errorMessage || '任务失败'),
            taskType: 'audio',
          });
        }

        setRvcTrainInputPanelData((prev) => {
          if (prev && prev.nodeId === nodeId) {
            return { ...prev, progress: 0, progressMessage: undefined };
          }
          return prev;
        });

        setNodes((nds) => {
          const targetNode = nds.find((n) => n.id === nodeId);
          if (!targetNode || (targetNode.type !== 'audio' && targetNode.type !== 'rvcTrain')) {
            return nds;
          }

          console.log(
            `[Workspace] ${targetNode.type === 'rvcTrain' ? 'RVC 训练' : '音频'}节点 ${nodeId} 生成失败，停止进度条并显示错误:`,
            errorMessage,
          );

          return nds.map((node) =>
            node.id === nodeId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    aiStatus: 'ERROR',
                    progress: 0,
                    progressMessage: undefined,
                    errorMessage: errorMessage,
                  },
                }
              : node,
          );
        });

        setTimeout(() => {
          const target = latestNodesRef.current.find((n) => n.id === nodeId);
          if (target?.type === 'rvcTrain') {
            handleRvcTrainNodeDataChangeRef.current?.(nodeId, {
              aiStatus: 'ERROR',
              progress: 0,
              progressMessage: undefined,
              errorMessage: errorMessage,
            });
          } else if (target?.type === 'audio' && handleAudioNodeDataChangeRef.current) {
            handleAudioNodeDataChangeRef.current(nodeId, {
              aiStatus: 'ERROR',
              progress: 0,
              progressMessage: undefined,
              errorMessage: errorMessage,
            });
          }
        }, 0);
      }
      
      // 处理图片节点的 ERROR 状态（API 返回失败时，停止进度条并显示错误信息）
      if (packet.status === 'ERROR' && packet.payload?.error) {
        const nodeId = packet.nodeId;
        const errorMessage = packet.payload.error;
        
        // 使用函数式更新，确保基于最新状态
        setNodes((nds) => {
          const targetNode = nds.find((n) => n.id === nodeId);
          if (!targetNode || targetNode.type !== 'image') {
            return nds; // 不是图片节点，不处理
          }
          
          console.log(`[Workspace] 图片节点 ${nodeId} 生成失败，停止进度条并显示错误:`, errorMessage);
          
          // 更新节点数据：停止进度条并设置错误信息
          const updatedNodes = nds.map((node) =>
            node.id === nodeId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    progress: 0, // 停止进度条，中断加载动画
                    progressMessage: undefined,
                    errorMessage: errorMessage, // 显示错误信息
                  },
                }
              : node
          );
          
          // 触发 handleImageNodeDataChange 以同步状态（使用 ref 避免闭包问题）
          setTimeout(() => {
            if (handleImageNodeDataChangeRef.current) {
              handleImageNodeDataChangeRef.current(nodeId, { 
                progress: 0, 
                progressMessage: undefined,
                errorMessage: errorMessage 
              });
            }
          }, 0);
          
          return updatedNodes;
        });
      }
      
      // 处理 LLM 节点的 ERROR 状态（API 返回失败时，停止处理状态并显示错误信息）
      if (packet.status === 'ERROR' && packet.payload?.error) {
        const nodeId = packet.nodeId;
        const errorMessage = packet.payload.error;
        const isTimeout = /timeout|超时/i.test(String(errorMessage || ''));
        const llmNode = latestNodesRef.current.find((n) => n.id === nodeId && n.type === 'llm');
        if (llmNode) {
          upsertRuntimeTask(nodeId, {
            status: isTimeout ? 'timeout' : 'failed',
            errorMessage: String(errorMessage || '任务失败'),
            taskType: 'text',
          });
          console.log(`[Workspace] LLM 节点 ${nodeId} 生成失败，停止处理状态并显示错误:`, errorMessage);
          setNodes((nds) =>
            nds.map((node) =>
              node.id === nodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      errorMessage: errorMessage,
                    },
                  }
                : node
            )
          );
        }
      }
      
      // 处理视频节点的 SUCCESS 状态（批量运行时，未选中的节点没有 VideoInputPanel，需要在这里更新）
      // 注意：音频 SUCCESS 也会带通用字段 url，必须先验节点类型，且排除「仅有 audioUrl」的包，否则会把音频历史误标成 video
      {
        const nodeId = packet.nodeId;
        const nVid = latestNodesRef.current.find((x) => x.id === nodeId);
        const hasExplicitVideoUrl = !!(packet.payload?.videoUrl);
        const hasAudioOnlyPayload =
          !!(packet.payload?.audioUrl || (Array.isArray(packet.payload?.outputAudios) && packet.payload.outputAudios.length > 0)) &&
          !hasExplicitVideoUrl;
        const rawVideoCandidate =
          packet.payload?.videoUrl ||
          packet.payload?.url ||
          packet.payload?.data?.output ||
          packet.payload?.data?.results?.[0]?.url;
        const videoUrlCandidate = String(rawVideoCandidate || '');
        const shouldTreatAsVideoSuccess =
          packet.status === 'SUCCESS' &&
          isVideoModuleNodeType(nVid?.type) &&
          !hasAudioOnlyPayload &&
          !!videoUrlCandidate &&
          !looksLikeAudioMediaUrl(videoUrlCandidate) &&
          (hasExplicitVideoUrl ||
            !!packet.payload?.url ||
            !!packet.payload?.data?.output ||
            !!packet.payload?.data?.results?.[0]?.url);

      if (shouldTreatAsVideoSuccess) {
        const videoUrl = videoUrlCandidate;
        const localPath = packet.payload.localPath;
        const originalVideoUrl = packet.payload.originalVideoUrl;
        const ybVid = estimateYuanbaoForTaskNodeStatic(nVid, cloudMapRef.current);
        upsertRuntimeTask(nodeId, {
          status: 'success',
          taskType: 'video',
          videoUrl: String(videoUrl || ''),
          ...(ybVid !== undefined ? { yuanbaoConsumed: ybVid } : {}),
        });
        
        // 若当前打开的是该节点的输入面板，立即同步清除面板进度并更新，避免继续显示「正在制作」
        setVideoInputPanelData((prev) => {
          if (prev && prev.nodeId === nodeId) {
            return { ...prev, progress: 0, progressMessage: undefined };
          }
          return prev;
        });
        
        // 格式化视频路径（HeyGem 与普通视频共用）
        let formattedVideoUrl = videoUrl;
        if (localPath) {
          let filePath = localPath.replace(/\\/g, '/');
          if (filePath.match(/^\/[a-zA-Z]:/)) {
            filePath = filePath.substring(1);
          }
          formattedVideoUrl = `local-resource://${filePath}`;
        } else {
          if (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) {
            formattedVideoUrl = videoUrl;
          } else if (videoUrl.startsWith('data:')) {
            formattedVideoUrl = videoUrl;
          } else {
            const cleanPath = videoUrl.replace(/^(file:\/\/|local-resource:\/\/)/, '');
            let filePath = cleanPath.replace(/\\/g, '/');
            if (filePath.match(/^\/[a-zA-Z]:/)) {
              filePath = filePath.substring(1);
            }
            formattedVideoUrl = `local-resource://${filePath}`;
          }
        }

        let networkUrl = originalVideoUrl;
        if (!networkUrl && (formattedVideoUrl.startsWith('http://') || formattedVideoUrl.startsWith('https://'))) {
          networkUrl = formattedVideoUrl;
        }

        // HeyGem SUCCESS: spawn child video node instead of writing output onto heyGem
        const targetForSpawn = latestNodesRef.current.find((n) => n.id === nodeId);
        if (targetForSpawn?.type === 'heyGem') {
          setTimeout(() => {
            spawnHeyGemResultVideoNodeRef.current({
              sourceNodeId: nodeId,
              outputVideo: formattedVideoUrl,
              originalVideoUrl: networkUrl,
              localPath: localPath || undefined,
              prompt: String(targetForSpawn.data?.prompt || videoInputPanelData?.prompt || ''),
            });
            if (handleVideoNodeDataChangeRef.current) {
              handleVideoNodeDataChangeRef.current(nodeId, {
                progress: 0,
                progressMessage: undefined,
                errorMessage: undefined,
              });
            }
          }, 0);
          setNodes((nds) =>
            nds.map((node) =>
              node.id === nodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      progress: 0,
                      progressMessage: undefined,
                      errorMessage: undefined,
                    },
                  }
                : node,
            ),
          );
        } else {
        // 使用函数式更新，确保基于最新状态
        setNodes((nds) => {
          const targetNode = nds.find((n) => n.id === nodeId);
          if (!targetNode || !isVideoModuleNodeType(targetNode.type)) {
            return nds; // 不是视频模块节点，不处理
          }
          
          // 打通双链路：始终执行全局更新，即使子组件也在处理，确保 props 强制更新
          console.log(`[Workspace] 批量运行：视频模块节点 ${nodeId} 生成成功，执行全局更新（双链路保障）`);
          
          // 更新节点数据
          const updatedNodes = nds.map((node) =>
            node.id === nodeId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    outputVideo: formattedVideoUrl, // 本地路径（local-resource://）用于显示
                    originalVideoUrl: networkUrl, // 网络 URL 用于传递给 character 节点
                    progress: 0, // 清除进度条
                    progressMessage: undefined,
                    errorMessage: undefined, // 清除错误信息
                  },
                }
              : node
          );
          
          // 触发 handleVideoNodeDataChange 以同步到连接的节点（使用 ref 避免闭包问题）
          // 注意：这里需要在 setNodes 外部调用，避免在 setNodes 回调中调用 setState
          setTimeout(() => {
            if (handleVideoNodeDataChangeRef.current) {
              handleVideoNodeDataChangeRef.current(nodeId, { 
                outputVideo: formattedVideoUrl,
                originalVideoUrl: networkUrl,
                progress: 0,
                progressMessage: undefined,
                errorMessage: undefined
              });
            }
            
            // 添加任务到任务列表：与图片节点一致，仅当底部 VideoInputPanel 未对该节点展示时由全局写入，
            // 否则由 VideoInputPanel 的 onOutputVideoChange 写入，避免双链路各加一条（URL 形态不同还会绕过去重）。
            const currentNode = updatedNodes.find((n) => n.id === nodeId);
            if (currentNode && formattedVideoUrl) {
              const taskUrl =
                networkUrl ||
                (formattedVideoUrl.startsWith('local-resource://') ? undefined : formattedVideoUrl) ||
                formattedVideoUrl;
              handleAddVideoTask(
                nodeId,
                taskUrl,
                currentNode.data?.prompt || '',
                networkUrl || (formattedVideoUrl.startsWith('local-resource://') ? undefined : formattedVideoUrl),
              );
            }
          }, 0);
          
          return updatedNodes;
        });
        }
      }
      }
      
      // 处理 LLM 和 Text 节点的 SUCCESS 状态（批量运行时，未选中的节点没有 InputPanel，需要在这里更新）
      if (packet.status === 'SUCCESS' && packet.payload?.text && !packet.payload?.imageUrl && !packet.payload?.videoUrl) {
        const nodeId = packet.nodeId;
        const outputText = packet.payload.text;
        const nDone = latestNodesRef.current.find((x) => x.id === nodeId);
        const ybDone = estimateYuanbaoForTaskNodeStatic(nDone, cloudMapRef.current);
        upsertRuntimeTask(nodeId, {
          status: 'success',
          prompt: String(outputText || ''),
          taskType: 'text',
          ...(ybDone !== undefined ? { yuanbaoConsumed: ybDone } : {}),
        });

        setTimeout(() => {
          handleAddTextTaskRef.current?.(nodeId, outputText);
        }, 0);
        
        // 使用函数式更新，确保基于最新状态
        setNodes((nds) => {
          const targetNode = nds.find((n) => n.id === nodeId);
          
          // 处理 LLM 节点
          // 打通双链路：始终执行全局更新，即使子组件也在处理，确保 props 强制更新
          if (targetNode && targetNode.type === 'llm') {
            console.log(`[Workspace] 批量运行：LLM 节点 ${nodeId} 生成成功，执行全局更新（双链路保障）`);
            
            // 更新节点数据（清除进度条、aiStatus 并更新文本）
            const updatedNodes = nds.map((node) =>
              node.id === nodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      outputText: outputText,
                      progress: 0, // 清除进度条
                      aiStatus: undefined, // 清除执行状态（反推图像等场景）
                      progressMessage: undefined,
                      errorMessage: undefined, // 清除错误信息
                    },
                  }
                : node
            );
            
            return updatedNodes;
          }
          
          // 处理 Text 节点（minimalistText）
          // 双重保障：优先使用 text，而不是等待 localPath 读取
          if (targetNode && targetNode.type === 'minimalistText') {
            try {
              console.log(`[Workspace] 批量运行：Text 节点 ${nodeId} 生成成功，更新节点数据，text 长度: ${outputText.length}`);
              
              // 更新节点数据（清除进度条并更新文本）
              // 优先使用 text 字段，避免因为 localPath 读取失败（如乱码路径）而导致内容无法显示
              const updatedNodes = nds.map((node) =>
                node.id === nodeId
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        text: outputText, // 优先使用 text
                        progress: 0, // 清除进度条
                        progressMessage: undefined,
                        errorMessage: undefined, // 清除错误信息
                      },
                    }
                  : node
              );

              return updatedNodes;
            } catch (error) {
              // 解决乱码中断：即使处理失败，也不阻塞界面
              console.warn(`[Workspace] 更新 Text 节点 ${nodeId} 时出错（可能是乱码路径导致）:`, error);
              // 返回原节点，不更新
              return nds;
            }
          }
          
          return nds; // 不是 LLM 或 Text 节点，不处理
        });
      }
      
      // 处理图片节点的 SUCCESS 状态（批量运行时，未选中的节点没有 ImageInputPanel，需要在这里更新）
      if (
        packet.status === 'SUCCESS' &&
        (packet.payload?.imageUrl ||
          packet.payload?.localPath ||
          (Array.isArray(packet.payload?.outputImages) && packet.payload.outputImages.length > 0))
      ) {
        const nodeId = packet.nodeId;
        const outputImagesRaw = Array.isArray(packet.payload?.outputImages)
          ? packet.payload.outputImages.filter((u: unknown) => typeof u === 'string' && String(u).trim() !== '')
          : [];
        const localPath =
          typeof packet.payload.localPath === 'string' ? packet.payload.localPath.trim() : undefined;
        let imageUrl = String(packet.payload.imageUrl || outputImagesRaw[0] || '').trim();
        if (!imageUrl && localPath) {
          imageUrl = formatImagePathSync(localPath);
        }
        if (!imageUrl) return;
        const payloadOriginalForTask =
          typeof packet.payload.originalImageUrl === 'string'
            ? packet.payload.originalImageUrl.trim()
            : undefined;
        const nImg = latestNodesRef.current.find((x) => x.id === nodeId);
        const ybImg = estimateYuanbaoForTaskNodeStatic(nImg, cloudMapRef.current);
        upsertRuntimeTask(nodeId, {
          status: 'success',
          imageUrl: String(imageUrl || ''),
          ...(outputImagesRaw.length > 0 ? { outputImages: outputImagesRaw } : {}),
          ...(ybImg !== undefined ? { yuanbaoConsumed: ybImg } : {}),
        });

        // 导演资产图：nodeId = `{directorId}-director-img-{assetId}`，任务列表有图但画布无 image 节点
        const directorImgMatch = String(nodeId || '').match(/^(.+)-director-img-(.+)$/);
        if (directorImgMatch) {
          const directorNodeId = directorImgMatch[1];
          const assetId = directorImgMatch[2];
          const directorNode = latestNodesRef.current.find(
            (n) => n.id === directorNodeId && n.type === 'director',
          );
          if (directorNode) {
            let formattedImageUrl = imageUrl;
            if (localPath) {
              formattedImageUrl = formatImagePathSync(localPath);
            } else if (
              !formattedImageUrl.startsWith('http://') &&
              !formattedImageUrl.startsWith('https://') &&
              !formattedImageUrl.startsWith('data:') &&
              !formattedImageUrl.startsWith('local-resource://')
            ) {
              formattedImageUrl = formatImagePathSync(formattedImageUrl);
            }
            const prev = createDefaultDirectorPipelineState(
              (directorNode.data as { director?: DirectorPipelineState })?.director || {},
            );
            const nextDirector = updateDirectorAsset(prev, assetId, {
              imageUrl: formattedImageUrl,
              status: 'ready',
              error: undefined,
            });
            invokeDirectorNodeDataChange(directorNodeId, {
              director: nextDirector,
              title: nextDirector.title,
              isGenerating: nextDirector.isGenerating,
              error: nextDirector.error || undefined,
            });
          }
          return;
        }

        // 导演分镜图：nodeId = `{directorId}-director-sb-{shotNo}`
        const directorSbMatch = String(nodeId || '').match(/^(.+)-director-sb-(.+)$/);
        if (directorSbMatch) {
          const directorNodeId = directorSbMatch[1];
          const shotNo = decodeURIComponent(directorSbMatch[2]);
          const directorNode = latestNodesRef.current.find(
            (n) => n.id === directorNodeId && n.type === 'director',
          );
          if (directorNode) {
            let formattedImageUrl = imageUrl;
            if (localPath) {
              formattedImageUrl = formatImagePathSync(localPath);
            } else if (
              !formattedImageUrl.startsWith('http://') &&
              !formattedImageUrl.startsWith('https://') &&
              !formattedImageUrl.startsWith('data:') &&
              !formattedImageUrl.startsWith('local-resource://')
            ) {
              formattedImageUrl = formatImagePathSync(formattedImageUrl);
            }
            const prev = createDefaultDirectorPipelineState(
              (directorNode.data as { director?: DirectorPipelineState })?.director || {},
            );
            const nextDirector = updateDirectorShotStoryboard(prev, shotNo, {
              imageUrl: formattedImageUrl,
              status: 'ready',
              error: undefined,
            });
            invokeDirectorNodeDataChange(directorNodeId, {
              director: nextDirector,
              title: nextDirector.title,
              isGenerating: nextDirector.isGenerating,
              error: nextDirector.error || undefined,
            });
          }
          return;
        }
        
        // 使用函数式更新，确保基于最新状态
        let layoutProbeUrl = '';
        setNodes((nds) => {
          const targetNode = nds.find((n) => n.id === nodeId);
          if (!targetNode || targetNode.type !== 'image') {
            return nds; // 不是图片节点，不处理
          }
          
          // 打通双链路：始终执行全局更新，即使子组件也在处理，确保 props 强制更新
          console.log(`[Workspace] 批量运行：图片节点 ${nodeId} 生成成功，执行全局更新（双链路保障）`);
          
          // 格式化图片路径
          let formattedImageUrl = imageUrl;
          if (localPath) {
            // 如果有本地路径，使用本地路径
            let filePath = localPath.replace(/\\/g, '/');
            
            // 修复盘符格式：如果路径是 "c/Users" 格式（缺少冒号），修正为 "C:/Users"
            // 这是关键修复：确保盘符格式正确
            if (filePath.match(/^([a-zA-Z])\//)) {
              filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
            }
            
            // 确保 Windows 路径格式正确（C:/Users 而不是 /C:/Users）
            if (filePath.match(/^\/[a-zA-Z]:/)) {
              filePath = filePath.substring(1); // 移除开头的 /
            }
            
            // 只对路径中的中文和空格部分进行编码，保留盘符的冒号
            // 分段处理，但不对盘符部分（如 C:）编码
            const pathParts = filePath.split('/');
            const encodedParts = pathParts.map((part, index) => {
              // 如果是第一段且是 Windows 盘符（如 C:），不编码
              if (index === 0 && /^[a-zA-Z]:$/.test(part)) {
                return part;
              }
              // 其他部分：只对包含中文或空格的部分进行编码
              if (/[\u4e00-\u9fa5\s]/.test(part)) {
                // 包含中文或空格，需要编码
                return encodeURIComponent(part);
              }
              // 不包含中文或空格，保持原样
              return part;
            });
            const encodedPath = encodedParts.join('/');
            
            formattedImageUrl = `local-resource://${encodedPath}`;
            console.log('[Workspace] 批量运行：格式化图片路径:', localPath, '->', formattedImageUrl);
          } else {
            // 格式化远程 URL（与 ImageNode 中的 formatImagePath 逻辑一致）
            if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
              formattedImageUrl = imageUrl;
            } else if (imageUrl.startsWith('data:')) {
              formattedImageUrl = imageUrl;
            } else {
              const cleanPath = imageUrl.replace(/^(file:\/\/|local-resource:\/\/)/, '');
              let filePath = cleanPath.replace(/\\/g, '/');
              // 确保 Windows 路径格式正确
              if (filePath.match(/^\/[a-zA-Z]:/)) {
                filePath = filePath.substring(1); // 移除开头的 /
              }
              formattedImageUrl = `local-resource://${filePath}`;
            }
          }
          
          const formattedOutputImages = outputImagesRaw.map((u: string) => {
            if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('data:') || u.startsWith('local-resource://')) return u;
            const cleanPath = u.replace(/^(file:\/\/|local-resource:\/\/)/, '').replace(/\\/g, '/');
            return `local-resource://${cleanPath}`;
          });
          layoutProbeUrl = formattedOutputImages[0] || formattedImageUrl;

          // 确定原始远程 URL：主进程在自动下载到本地时会把 payload.imageUrl 变成 local-resource，公网在 originalImageUrl
          const originalImageUrlResolved =
            (payloadOriginalForTask && /^https?:\/\//i.test(payloadOriginalForTask) ? payloadOriginalForTask : undefined) ||
            (imageUrl && (String(imageUrl).startsWith('http://') || String(imageUrl).startsWith('https://')) ? String(imageUrl) : undefined);
          
          // 将中文路径转换为映射路径（如果项目ID存在且路径是 local-resource://）
          // 注意：这里在 setNodes 回调中异步处理映射，避免阻塞更新
          if (projectId && formattedImageUrl.startsWith('local-resource://')) {
            mapProjectPath(formattedImageUrl, projectId).then((mappedUrl) => {
              if (mappedUrl !== formattedImageUrl) {
                console.log('[Workspace] 图片路径已映射:', formattedImageUrl, '->', mappedUrl);
                // 更新节点数据为映射路径
                setNodes((currentNodes) => {
                  return currentNodes.map((node) => {
                    if (node.id === nodeId) {
                      return {
                        ...node,
                        data: {
                          ...node.data,
                          outputImage: mappedUrl,
                        },
                      };
                    }
                    return node;
                  });
                });
              }
            }).catch((error) => {
              console.error('[Workspace] 路径映射失败:', error);
            });
          }
          
          // 更新节点数据（清除进度条并更新图片）
          const updatedNodes = nds.map((node) =>
            node.id === nodeId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    outputImage: formattedImageUrl, // 先使用原始路径，映射后会更新
                    outputImages: formattedOutputImages.length > 0 ? formattedOutputImages : (node.data as { outputImages?: string[] })?.outputImages,
                    localPath: localPath || node.data?.localPath, // 保存本地路径
                    originalImageUrl: originalImageUrlResolved || (node.data as { originalImageUrl?: string })?.originalImageUrl, // 公网原图
                    progress: 0, // 清除进度条
                    progressMessage: undefined,
                    errorMessage: undefined, // 清除错误信息
                  },
                }
              : node
          );
          
          // 触发 handleImageNodeDataChange 以同步到连接的节点（使用 ref 避免闭包问题）
          // 注意：这里需要在 setNodes 外部调用，避免在 setNodes 回调中调用 setState
          setTimeout(() => {
            handleImageNodeDataChangeRef.current(nodeId, { 
              outputImage: formattedImageUrl,
              outputImages: formattedOutputImages.length > 0 ? formattedOutputImages : undefined,
              localPath: localPath,
              originalImageUrl: originalImageUrlResolved,
              progress: 0,
              progressMessage: undefined,
              errorMessage: undefined
            });
            
            // 与视频一致：仅当底部图片输入面板正在展示该节点且选中该图片节点时由 onOutputImageChange 写入，否则由全局 SUCCESS 写入，避免双链路各加一条
            const imagePanelVisibleForNode =
              !previewImage &&
              !previewAudio &&
              imageInputPanelData?.nodeId === nodeId &&
              selectedNode?.id === nodeId &&
              selectedNode?.type === 'image';
            const currentNode = updatedNodes.find((n) => n.id === nodeId);
            if (currentNode && formattedImageUrl && !imagePanelVisibleForNode) {
              const origForTask =
                originalImageUrlResolved ||
                (typeof currentNode.data?.originalImageUrl === 'string'
                  ? String(currentNode.data.originalImageUrl).trim()
                  : undefined);
              handleAddTaskRef.current(
                nodeId,
                formattedImageUrl,
                currentNode.data?.prompt || '',
                origForTask,
                formattedOutputImages,
              );
            }
          }, 0);
          
          return updatedNodes;
        });

        void (async () => {
          if (!layoutProbeUrl) return;
          try {
            const px = await probeImagePixelSize(layoutProbeUrl);
            if (px.width <= 0 || px.height <= 0) return;
            setNodes((nds) =>
              nds.map((node) => {
                if (node.id !== nodeId || node.type !== 'image') return node;
                if (node.data?.isUserResized || node.data?.preserveExportLayout) return node;
                return patchNodeWithMediaLayout(node, px.width, px.height, 'image');
              }),
            );
          } catch {
            /* 探测失败时保留当前外框 */
          }
        })();
      }
      
      // RVC 训练完成（模型 zip，非可播放音频）
      const rvcPackageUrl =
        packet.payload?.outputModelUrl ||
        (isRvcModelPackageUrl(String(packet.payload?.audioUrl ?? '')) ? packet.payload?.audioUrl : undefined) ||
        (isRvcModelPackageUrl(String(packet.payload?.url ?? '')) ? packet.payload?.url : undefined);
      if (
        packet.status === 'SUCCESS' &&
        rvcPackageUrl &&
        !packet.payload?.imageUrl &&
        !packet.payload?.videoUrl
      ) {
        const nodeId = packet.nodeId;
        const outputModelUrl = String(rvcPackageUrl);
        const outputModelRemoteUrl = (packet.payload.outputModelRemoteUrl as string | undefined) || outputModelUrl;
        const outputModelLocalPath = packet.payload.outputModelLocalPath as string | undefined;
        const trainedName = packet.payload.rvcTrainModelName as string | undefined;
        upsertRuntimeTask(nodeId, { status: 'success' });
        void persistRvcVoiceToLibraryRef.current?.({
          modelPackageUrl: outputModelUrl,
          modelPackageRemoteUrl: outputModelRemoteUrl,
          outputModelLocalPath,
          rvcTrainModelName: trainedName,
          nodeId,
        });
      }

      // 处理音频节点的 SUCCESS 状态（批量运行时，未选中的节点没有 AudioInputPanel，需要在这里更新）
      if (
        packet.status === 'SUCCESS' &&
        (packet.payload?.audioUrl || packet.payload?.url || (Array.isArray(packet.payload?.outputAudios) && packet.payload.outputAudios.length > 0)) &&
        !packet.payload?.imageUrl &&
        !packet.payload?.videoUrl &&
        !packet.payload?.outputModelUrl &&
        !isRvcModelPackageUrl(String(packet.payload?.audioUrl ?? '')) &&
        !isRvcModelPackageUrl(String(packet.payload?.url ?? ''))
      ) {
        const nodeId = packet.nodeId;
        const audioUrl = packet.payload.audioUrl || packet.payload.url;
        const localPath = packet.payload.localPath;
        const originalAudioUrl = packet.payload.originalAudioUrl;
        const outputAudiosRaw = Array.isArray(packet.payload?.outputAudios)
          ? packet.payload.outputAudios.filter((u: unknown) => typeof u === 'string' && String(u).trim() !== '')
          : [];
        const originalOutputAudiosRaw = Array.isArray(packet.payload?.originalOutputAudios)
          ? packet.payload.originalOutputAudios.filter((u: unknown) => typeof u === 'string' && String(u).trim() !== '')
          : [];
        const formatAudioUrlForNode = (url: string, itemLocalPath?: string): string => {
          if (itemLocalPath) {
            let filePath = itemLocalPath.replace(/\\/g, '/');
            if (filePath.match(/^\/[a-zA-Z]:/)) filePath = filePath.substring(1);
            return `local-resource://${filePath}`;
          }
          if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
          const cleanPath = url.replace(/^(file:\/\/|local-resource:\/\/)/, '');
          let filePath = cleanPath.replace(/\\/g, '/');
          if (filePath.match(/^\/[a-zA-Z]:/)) filePath = filePath.substring(1);
          return `local-resource://${filePath}`;
        };
        const nAud = latestNodesRef.current.find((x) => x.id === nodeId);
        const ybAud = estimateYuanbaoForTaskNodeStatic(nAud, cloudMapRef.current);
        upsertRuntimeTask(nodeId, {
          status: 'success',
          taskType: 'audio',
          audioUrl: String(audioUrl || ''),
          videoUrl: undefined,
          ...(ybAud !== undefined ? { yuanbaoConsumed: ybAud } : {}),
        });
        console.log('[Workspace] 音频 SUCCESS:', { nodeId, hasOriginalAudioUrl: !!originalAudioUrl, audioUrlPrefix: (audioUrl || '').slice(0, 50) });
        
        setNodes((nds) => {
          const targetNode = nds.find((n) => n.id === nodeId);
          if (!targetNode || targetNode.type !== 'audio') {
            return nds;
          }
          
          // 格式化音频路径
          let formattedAudioUrl = formatAudioUrlForNode(String(audioUrl || ''), localPath);
          const formattedOutputAudios =
            outputAudiosRaw.length > 0
              ? outputAudiosRaw.map((u: string, i: number) => {
                  const orig = originalOutputAudiosRaw[i];
                  const network = orig && (orig.startsWith('http://') || orig.startsWith('https://')) ? orig : undefined;
                  const formatted = formatAudioUrlForNode(u, i === 0 ? localPath : undefined);
                  return network || formatted;
                })
              : [];
          
          // 确定网络 URL：优先使用 originalAudioUrl，如果没有则检查 formattedAudioUrl 是否是网络 URL
          let networkUrl = originalAudioUrl;
          if (!networkUrl && (formattedAudioUrl.startsWith('http://') || formattedAudioUrl.startsWith('https://'))) {
            networkUrl = formattedAudioUrl; // formattedAudioUrl 本身就是网络 URL
          }
          // 有远程 URL 时，节点播放与任务列表一致：直接使用远程 URL 作为 outputAudio，避免 local-resource 在中文路径下无法播放
          const outputAudioForNode = networkUrl || formattedAudioUrl;
          const outputAudiosForNode =
            formattedOutputAudios.length > 1 ? formattedOutputAudios : undefined;
          
          // 更新节点数据
          const updatedNodes = nds.map((node) =>
            node.id === nodeId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    outputAudio: outputAudioForNode,
                    ...(outputAudiosForNode ? { outputAudios: outputAudiosForNode } : {}),
                    ...(originalOutputAudiosRaw.length > 0 ? { originalOutputAudios: originalOutputAudiosRaw } : {}),
                    originalAudioUrl: networkUrl || undefined,
                    aiStatus: 'SUCCESS', // 更新状态为成功
                    progress: 0, // 清除进度条
                    progressMessage: undefined,
                    errorMessage: undefined, // 清除错误信息
                  },
                }
              : node
          );
          
          // 触发 handleAudioNodeDataChange 以同步到连接的节点（使用 ref 避免闭包问题）
          // 注意：这里需要在 setNodes 外部调用，避免在 setNodes 回调中调用 setState
          setTimeout(() => {
            if (handleAudioNodeDataChangeRef.current) {
              handleAudioNodeDataChangeRef.current(nodeId, { 
                outputAudio: outputAudioForNode,
                ...(outputAudiosForNode ? { outputAudios: outputAudiosForNode } : {}),
                ...(originalOutputAudiosRaw.length > 0 ? { originalOutputAudios: originalOutputAudiosRaw } : {}),
                originalAudioUrl: networkUrl || undefined,
                aiStatus: 'SUCCESS',
                errorMessage: undefined
              });
            }

            void (async () => {
              const api = window.electronAPI;
              if (!api?.getMediaDuration || !outputAudioForNode) return;
              try {
                const dur = await api.getMediaDuration(outputAudioForNode, projectId || undefined);
                if (dur > 0) {
                  handleAudioNodeDataChangeRef.current?.(nodeId, { mediaDurationSec: dur });
                }
              } catch {
                /* ignore */
              }
            })();
            
            // 添加任务到任务列表
            const currentNode = updatedNodes.find((n) => n.id === nodeId);
            if (currentNode && outputAudioForNode) {
              const taskUrl = networkUrl || outputAudioForNode;
              handleAddAudioTask(
                nodeId,
                taskUrl,
                currentNode.data?.text || '',
                networkUrl || undefined
              );
            }
          }, 0);
          
          return updatedNodes;
        });
      }
    };
  }, [setNodes, selectedNode, previewImage, previewAudio, imageInputPanelData, videoInputPanelData, llmInputPanelData, handleVideoNodeDataChangeRef, handleAudioNodeDataChangeRef, handleAddVideoTask, handleAddAudioTask, upsertRuntimeTask, getNodeTaskType, invokeDirectorNodeDataChange]);

  // 强退/重启后：任务列表里仍有 runtime 视频任务且已带上 RunningHub taskId 时，主进程继续 /query 直至出片
  useEffect(() => {
    runningHubVideoResumeStartedRef.current.clear();
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    if (hydratedProjectIdRef.current !== projectId) return;
    const api = window.electronAPI;
    if (!api?.resumeRunningHubVideoPoll && !api?.resumeRunningHubImagePoll && !api?.resumeRunningHubAudioPoll) return;

    for (const t of tasks) {
      if (t.taskType !== 'video' && t.taskType !== 'image' && t.taskType !== 'audio') continue;
      if (t.status !== 'running' && t.status !== 'processing') continue;
      const rhId = t.runningHubTaskId?.trim();
      if (!rhId) continue;
      if (!String(t.id).startsWith('runtime-')) continue;
      const node = latestNodesRef.current.find((n) => n.id === t.nodeId);
      if (!node || node.type !== t.taskType) continue;
      if (t.taskType === 'audio' && (isRvcTrainModel(String(node.data?.model ?? '')) || node.type === 'rvcTrain')) continue;

      const key = `${projectId}:${t.taskType}:${t.nodeId}:${rhId}`;
      if (runningHubVideoResumeStartedRef.current.has(key)) continue;
      runningHubVideoResumeStartedRef.current.add(key);

      const args = {
        nodeId: t.nodeId,
        rhTaskId: rhId,
        projectId,
        prompt: t.prompt,
        nodeTitle: t.nodeTitle,
      };
      if (t.taskType === 'video' && api.resumeRunningHubVideoPoll) {
        void api.resumeRunningHubVideoPoll(args);
      } else if (t.taskType === 'image' && api.resumeRunningHubImagePoll) {
        void api.resumeRunningHubImagePoll(args);
      } else if (t.taskType === 'audio' && api.resumeRunningHubAudioPoll) {
        void api.resumeRunningHubAudioPoll(args);
      } else {
        runningHubVideoResumeStartedRef.current.delete(key);
      }
    }
  }, [projectId, tasks, nodes]);

  // 单例注册 AI 状态监听器，卸载时必定移除，防止监听器数量累积导致内存泄漏
  useEffect(() => {
    if (!window.electronAPI) return () => {};
    const removeAIListener = window.electronAPI.onAIStatusUpdate((packet) => handleAIStatusUpdateRef.current?.(packet));
    return () => {
      if (removeAIListener && typeof removeAIListener === 'function') removeAIListener();
    };
  }, []);

  // 同步 ref，确保回调函数的最新版本被使用
  useEffect(() => {
    handleImageNodeDataChangeRef.current = handleImageNodeDataChange;
    handleVideoNodeDataChangeRef.current = handleVideoNodeDataChange;
    handleAudioNodeDataChangeRef.current = handleAudioNodeDataChange;
    persistRvcVoiceToLibraryRef.current = persistRvcVoiceToLibrary;
    handleVideoSpliceNodeDataChangeRef.current = handleVideoSpliceNodeDataChange;
    handleVideoSpliceExportToCanvasRef.current = handleVideoSpliceExportToCanvas;
    handlePhotoCollageNodeDataChangeRef.current = handlePhotoCollageNodeDataChange;
    handleGridMapNodeDataChangeRef.current = handleGridMapNodeDataChange;
    handleImageComparerNodeDataChangeRef.current = handleImageComparerNodeDataChange;
    handleAddTaskRef.current = handleAddTask;
    handleCleanupSplitEdgesRef.current = handleCleanupSplitEdges;
    handleAuxImageTaskCompleteRef.current = handleAuxImageTaskComplete;
  }, [handleImageNodeDataChange, handleVideoNodeDataChange, handleAudioNodeDataChange, persistRvcVoiceToLibrary, handleVideoSpliceNodeDataChange, handleVideoSpliceExportToCanvas, handlePhotoCollageNodeDataChange, handleGridMapNodeDataChange, handleImageComparerNodeDataChange, handleAddTask, handleCleanupSplitEdges, handleAuxImageTaskComplete]);

  // 采集当前画布缩略图（仅负责生成，不负责落盘）
  const captureProjectCardThumbnail = useCallback(async () => {
    if (!projectId || !reactFlowWrapper.current) return;
    if (typeof localStorage === 'undefined') return;
    // 交互期间或正在退出时跳过，避免 html2canvas 阻塞主线程、拖慢返回项目列表
    const snap = getGlobalInteractionSnapshot();
    if (snap.isGlobalInteracting || snap.isExiting) return;
    const target = reactFlowWrapper.current.querySelector('.react-flow') as HTMLElement | null;
    if (!target) return;
    try {
      const captured = await html2canvas(target, {
        backgroundColor: isDarkMode ? '#121212' : '#ffffff',
        useCORS: true,
        allowTaint: true,
        // 降低截图分辨率，减轻主线程压力
        scale: Math.min(window.devicePixelRatio || 1, 1),
        logging: false,
      });
      const outW = 640;
      const outH = 360;
      const out = document.createElement('canvas');
      out.width = outW;
      out.height = outH;
      const ctx = out.getContext('2d');
      if (!ctx) return;
      const srcW = captured.width;
      const srcH = captured.height;
      const srcRatio = srcW / srcH;
      const outRatio = outW / outH;
      let sx = 0;
      let sy = 0;
      let sw = srcW;
      let sh = srcH;
      if (srcRatio > outRatio) {
        sw = Math.round(srcH * outRatio);
        sx = Math.round((srcW - sw) / 2);
      } else if (srcRatio < outRatio) {
        sh = Math.round(srcW / outRatio);
        sy = Math.round((srcH - sh) / 2);
      }
      ctx.drawImage(captured, sx, sy, sw, sh, 0, 0, outW, outH);
      const dataUrl = out.toDataURL('image/jpeg', 0.78);
      cardThumbnailCacheRef.current = dataUrl;
      return dataUrl;
    } catch (error) {
      console.error('保存项目卡缩略图失败:', error);
      return null;
    }
  }, [projectId, reactFlowWrapper, isDarkMode]);

  // 将缩略图写入项目卡（优先写缓存，必要时异步补拍）
  const persistProjectCardThumbnail = useCallback(async (forceCapture = false) => {
    if (!projectId || typeof localStorage === 'undefined') return;
    const key = getCardBgKey(projectId);
    if (!forceCapture && cardThumbnailCacheRef.current) {
      localStorage.setItem(key, cardThumbnailCacheRef.current);
      return;
    }
    const captured = await captureProjectCardThumbnail();
    if (captured) {
      localStorage.setItem(key, captured);
    }
  }, [projectId, captureProjectCardThumbnail]);

  // 首次进入后 10s，再等画布 5s 不动时截图；闲时画布静止 1 分钟截图一次；退出时不截图
  useEffect(() => {
    if (!projectId) return;
    setThumbnailPhase('wait10s');
    const t = setTimeout(() => setThumbnailPhase('wait5s'), 10000);
    return () => clearTimeout(t);
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !captureProjectCardThumbnail) return;
    if (isExitingRef.current || getGlobalInteractionSnapshot().isExiting) return;

    if (cardThumbnailTimerRef.current) {
      clearTimeout(cardThumbnailTimerRef.current);
      cardThumbnailTimerRef.current = null;
    }

    if (thumbnailPhase === 'wait10s') return;

    const delay = thumbnailPhase === 'wait5s' ? 5000 : 60000;
    cardThumbnailTimerRef.current = setTimeout(() => {
      if (isExitingRef.current || getGlobalInteractionSnapshot().isExiting) return;
      captureProjectCardThumbnail().catch((error) => {
        console.error('后台预生成项目卡缩略图失败:', error);
      });
      if (thumbnailPhase === 'wait5s') setThumbnailPhase('idle60s');
    }, delay);

    return () => {
      if (cardThumbnailTimerRef.current) {
        clearTimeout(cardThumbnailTimerRef.current);
        cardThumbnailTimerRef.current = null;
      }
      // 卸载时仅写入已有缓存，不触发新截图
      if (projectId && typeof localStorage !== 'undefined' && cardThumbnailCacheRef.current) {
        localStorage.setItem(getCardBgKey(projectId), cardThumbnailCacheRef.current);
      }
    };
  }, [nodes, edges, isDarkMode, projectId, captureProjectCardThumbnail, thumbnailPhase]);

  const isExiting = useGlobalInteractionSelector((s) => s.isExiting, Object.is);
  const saveAsync = useCallback(() => {
    void persistProjectCardThumbnail(false);
    void saveProjectNow().catch((e) => console.error('返回时后台保存失败:', e));
  }, [persistProjectCardThumbnail, saveProjectNow]);

  const handleNavigateBack = useCallback(async () => {
    isExitingRef.current = true;
    if (saveToDiskTimeoutRef.current) {
      clearTimeout(saveToDiskTimeoutRef.current);
      saveToDiskTimeoutRef.current = null;
    }
    setActiveVideoNodeId(null);
    const videoNodeIds = nodes.filter((n) => isVideoModuleNodeType(n.type)).map((n) => n.id);
    if (videoNodeIds.length > 0) triggerEmergencyVideoUnload(videoNodeIds, 1500);
    stopSyncLoop();
    setIsExiting(true);
    try {
      window.electronAPI?.removeAIStatusUpdateListener?.();
      window.electronAPI?.removeBalanceUpdatedListener?.();
    } catch {}
    window.dispatchEvent(new CustomEvent('force-stop-canvas'));

    // 0. 用当前闭包快照落盘，避免 setNodes([]) 后 latestNodesRef 被同步成空导致误写空 JSON
    try {
      const snapNodes = JSON.parse(JSON.stringify(nodes)) as Node[];
      const snapEdges = JSON.parse(JSON.stringify(edges)) as Edge[];
      await saveProjectNow({ nodes: snapNodes, edges: snapEdges });
    } catch (e) {
      console.error('返回时保存失败:', e);
    }

    // 1. 瞬间清空画布状态，释放显存的第一步
    setNodes([]);
    setEdges([]);

    // 2. 遍历 video/image 节点，清理 blob URL 等临时资源，切断 GPU 纹理引用
    const urlsToRevoke: string[] = [];
    nodes.forEach((n) => {
      const d = n.data as Record<string, unknown> | undefined;
      if (!d) return;
      if (isVideoModuleNodeType(n.type)) {
        const v = d.outputVideo ?? d.originalVideoUrl;
        if (typeof v === 'string' && v.startsWith('blob:')) urlsToRevoke.push(v);
      } else if (n.type === 'image') {
        const img = d.outputImage ?? (d.inputImages as string[])?.[0];
        if (typeof img === 'string' && img.startsWith('blob:')) urlsToRevoke.push(img);
      }
    });
    urlsToRevoke.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {}
    });
    if (typeof (window as any).gc === 'function') (window as any).gc();

    // 3. 双层 rAF 确保 UI 线程完成节点卸载后再跳转
    try {
      sessionStorage.setItem(NEXFLOW_POST_RELOAD_ROUTE_KEY, '/projects');
    } catch {
      /* ignore */
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        navigate('/projects', { replace: true });
      });
    });
  }, [nodes, edges, navigate, saveProjectNow, setNodes, setEdges]);

  const llmInputPanelAnchor =
    !previewImage &&
    !previewAudio &&
    !characterAvatarPickOverlay &&
    llmInputPanelData &&
    selectedNode &&
    selectedNode.type === 'llm'
      ? {
          nodeId: llmInputPanelData.nodeId,
          width: llmInputPanelData.isImageReverseMode
            ? 840
            : llmInputPanelData.isVideoAnalysisMode
              ? 360
              : 780,
          height: 'auto' as const,
          panel: (
            <LLMInputPanel
              nodeId={llmInputPanelData.nodeId}
              isDarkMode={isDarkMode}
              inputText={llmInputPanelData.inputText}
              userInput={llmInputPanelData.userInput}
              isInputLocked={false}
              hasLinkedText={!!llmInputPanelData.hasLinkedText}
              linkedInputText={llmInputPanelData.linkedInputText || llmInputPanelData.inputText || ''}
              linkedTextTitle={llmInputPanelData.linkedTextTitle || ''}
              isImageReverseMode={llmInputPanelData.isImageReverseMode}
              imageUrlForReverse={llmInputPanelData.imageUrlForReverse}
              isVideoAnalysisMode={llmInputPanelData.isVideoAnalysisMode}
              videoUrlForAnalysis={llmInputPanelData.videoUrlForAnalysis}
              reverseCaptionModel={
                llmInputPanelData.reverseCaptionModel ?? IMAGE_REVERSE_DEFAULT_MODEL
              }
              onReverseCaptionModelChange={(value) => {
                const nid = llmInputPanelData.nodeId;
                const next = normalizeImageReverseCaptionModel(value);
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === nid ? { ...node, data: { ...node.data, reverseCaptionModel: next } } : node
                  )
                );
                setLlmInputPanelData((prev) =>
                  prev && prev.nodeId === nid ? { ...prev, reverseCaptionModel: next } : prev,
                );
              }}
              chatModel={llmInputPanelData.chatModel ?? 'gpt-3.5-turbo'}
              onChatModelChange={(value) => {
                const nid = llmInputPanelData.nodeId;
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === nid ? { ...node, data: { ...node.data, chatModel: value } } : node
                  )
                );
                setLlmInputPanelData((prev) => (prev && prev.nodeId === nid ? { ...prev, chatModel: value } : prev));
              }}
              savedPrompts={llmInputPanelData.savedPrompts}
              projectId={projectId}
              nodeTitle={selectedNode.data?.title || 'llm'}
              onUserInputChange={(value) => {
                const nid = llmInputPanelData.nodeId;
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === nid ? { ...node, data: { ...node.data, userInput: value } } : node
                  )
                );
                setLlmInputPanelData((prev) => (prev && prev.nodeId === nid ? { ...prev, userInput: value } : prev));
              }}
              onInputTextChange={(value) => {
                const nid = llmInputPanelData.nodeId;
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === nid ? { ...node, data: { ...node.data, inputText: value } } : node
                  )
                );
                setLlmInputPanelData((prev) => (prev && prev.nodeId === nid ? { ...prev, inputText: value } : prev));
              }}
              onSavedPromptsChange={async (prompts) => {
                if (window.electronAPI) {
                  try {
                    await window.electronAPI.updateGlobalLLMPersonas(prompts);
                    setGlobalPersonas(prompts);
                  } catch (error) {
                    console.error('保存全局人设失败:', error);
                  }
                }
                const nid = llmInputPanelData.nodeId;
                setLlmInputPanelData((prev) => (prev && prev.nodeId === nid ? { ...prev, savedPrompts: prompts } : prev));
              }}
              onPersonaChange={(personaName) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === llmInputPanelData.nodeId
                      ? {
                          ...node,
                          data: {
                            ...node.data,
                            title: personaName || 'llm',
                          },
                        }
                      : node
                  )
                );
              }}
              onRunStart={() => {
                const nid = llmInputPanelData.nodeId;
                const inputPrompt = (llmInputPanelData.inputText || llmInputPanelData.userInput || '').trim();
                upsertRuntimeTask(nid, {
                  status: 'running',
                  taskType: 'text',
                  errorMessage: undefined,
                  ...(inputPrompt ? { prompt: inputPrompt } : {}),
                });
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === nid
                      ? { ...node, data: { ...node.data, progress: 1, aiStatus: 'START' as const, errorMessage: undefined } }
                      : node
                  )
                );
              }}
              onOutputTextChange={(text) => {
                const nid = llmInputPanelData.nodeId;
                const inputPrompt = llmInputPanelData.userInput || llmInputPanelData.inputText;
                const trimmed = (text || '').trim();
                if (!trimmed) return;

                const nDone = latestNodesRef.current.find((x) => x.id === nid);
                const ybDone = estimateYuanbaoForTaskNodeStatic(nDone, cloudMapRef.current);
                upsertRuntimeTask(nid, {
                  status: 'success',
                  prompt: trimmed,
                  taskType: 'text',
                  ...(ybDone !== undefined ? { yuanbaoConsumed: ybDone } : {}),
                });
                handleAddTextTaskRef.current?.(nid, trimmed, inputPrompt);
                setNodes((nds) => {
                  const updatedNodes = nds.map((node) =>
                    node.id === nid
                      ? { ...node, data: { ...node.data, outputText: text } }
                      : node
                  );

                  const connectedEdges = edges.filter((e) => e.source === nid && e.target);
                  connectedEdges.forEach((edge) => {
                    const targetNode = updatedNodes.find((n) => n.id === edge.target);
                    if (targetNode?.type === 'image') {
                      const targetIndex = updatedNodes.findIndex((n) => n.id === edge.target);
                      if (targetIndex !== -1) {
                        updatedNodes[targetIndex] = {
                          ...updatedNodes[targetIndex],
                          data: {
                            ...updatedNodes[targetIndex].data,
                            prompt: text,
                          },
                        };

                        if (selectedNode && selectedNode.id === edge.target) {
                          setImageInputPanelData((prev) => {
                            if (prev && prev.nodeId === edge.target) {
                              return {
                                ...prev,
                                prompt: text,
                                inputImages: [],
                              };
                            }
                            return prev;
                          });
                        }
                      }
                    }
                  });

                  return updatedNodes;
                });
              }}
            />
          ),
        }
      : null;


  const storyboardScriptInputPanelAnchor =
    !previewImage &&
    !previewAudio &&
    !characterAvatarPickOverlay &&
    storyboardScriptInputPanelData &&
    selectedNode &&
    selectedNode.type === 'storyboardScript'
      ? {
          nodeId: storyboardScriptInputPanelData.nodeId,
          width: Math.min(Number(selectedNode.data?.width) || 1024, 720),
          height: 'auto' as const,
          panel: (
            <StoryboardScriptInputPanel
              nodeId={storyboardScriptInputPanelData.nodeId}
              projectId={projectId}
              isDarkMode={isDarkMode}
              userPrompt={storyboardScriptInputPanelData.userPrompt}
              chatModel={storyboardScriptInputPanelData.chatModel ?? 'gpt-3.5-turbo'}
              storyboardScript={storyboardScriptInputPanelData.storyboardScript}
              imageUrls={storyboardScriptInputPanelData.imageUrls}
              videoUrls={storyboardScriptInputPanelData.videoUrls}
              onUserPromptChange={(value) => {
                const nid = storyboardScriptInputPanelData.nodeId;
                invokeStoryboardScriptNodeDataChange(nid, { userPrompt: value });
              }}
              onChatModelChange={(value) => {
                const nid = storyboardScriptInputPanelData.nodeId;
                invokeStoryboardScriptNodeDataChange(nid, { chatModel: value });
              }}
              onScriptChange={(script) => {
                const nid = storyboardScriptInputPanelData.nodeId;
                invokeStoryboardScriptNodeDataChange(nid, { storyboardScript: script, title: script.title });
              }}
              onGeneratingChange={(v) => {
                const nid = storyboardScriptInputPanelData.nodeId;
                invokeStoryboardScriptNodeDataChange(nid, { isGenerating: v });
              }}
              onErrorChange={(err) => {
                const nid = storyboardScriptInputPanelData.nodeId;
                invokeStoryboardScriptNodeDataChange(nid, { error: err || undefined });
              }}
              onRunStart={() => {
                const nid = storyboardScriptInputPanelData.nodeId;
                invokeStoryboardScriptNodeDataChange(nid, { isGenerating: true, error: undefined });
              }}
            />
          ),
        }
      : null;

  const directorInputPanelAnchor =
    !previewImage &&
    !previewAudio &&
    !characterAvatarPickOverlay &&
    directorInputPanelData &&
    selectedNode &&
    selectedNode.type === 'director'
      ? {
          nodeId: directorInputPanelData.nodeId,
          width: 720,
          height: 'auto' as const,
          panel: (
            <DirectorInputPanel
              nodeId={directorInputPanelData.nodeId}
              projectId={projectId}
              isDarkMode={isDarkMode}
              userPrompt={directorInputPanelData.userPrompt}
              scriptText={directorInputPanelData.scriptText}
              chatModel={directorInputPanelData.chatModel ?? 'gpt-3.5-turbo'}
              director={directorInputPanelData.director}
              onUserPromptChange={(value) => {
                const nid = directorInputPanelData.nodeId;
                invokeDirectorNodeDataChange(nid, { userPrompt: value });
              }}
              onChatModelChange={(value) => {
                const nid = directorInputPanelData.nodeId;
                const prev = createDefaultDirectorPipelineState(directorInputPanelData.director || {});
                invokeDirectorNodeDataChange(nid, {
                  director: createDefaultDirectorPipelineState({ ...prev, chatModel: value }),
                });
              }}
              onDirectorChange={(director) => {
                const nid = directorInputPanelData.nodeId;
                invokeDirectorNodeDataChange(nid, { director, title: director.title });
              }}
              onGeneratingChange={(v) => {
                const nid = directorInputPanelData.nodeId;
                invokeDirectorNodeDataChange(nid, { isGenerating: v });
              }}
              onErrorChange={(err) => {
                const nid = directorInputPanelData.nodeId;
                invokeDirectorNodeDataChange(nid, { error: err || undefined });
              }}
              onRunStart={() => {
                const nid = directorInputPanelData.nodeId;
                invokeDirectorNodeDataChange(nid, { isGenerating: true, error: undefined });
              }}
            />
          ),
        }
      : null;


  /** HeyGem：面板常驻节点内，经 context 注入生成/点选回调（不依赖 selected） */
  const heyGemInlinePanelApi = useMemo<HeyGemInlinePanelApi>(
    () => ({
      projectId,
      onPickReferenceVideoFromCanvas: () => invokePickVideoFromCanvas(),
      onOutputVideoReady: (nodeId, url, originalUrl, localAsset, prompt) => {
        if (!url) return;
        void (async () => {
          let outputVideoFinal = url;
          let networkUrl =
            originalUrl ||
            (url.startsWith('http://') || url.startsWith('https://') ? url : undefined);
          let videoAsset:
            | { poster?: string; ghost?: string; width?: number; height?: number }
            | undefined;

          if (localAsset && (localAsset.poster || localAsset.ghost)) {
            videoAsset = {
              poster: localAsset.poster,
              ghost: localAsset.ghost,
              width: localAsset.width,
              height: localAsset.height,
            };
          }

          if (
            networkUrl &&
            (networkUrl.startsWith('http://') || networkUrl.startsWith('https://')) &&
            window.electronAPI?.createVideoLocalResourceFromUrl
          ) {
            try {
              const resource = await window.electronAPI.createVideoLocalResourceFromUrl(
                projectId || undefined,
                networkUrl,
              );
              outputVideoFinal = resource.originalUrl || outputVideoFinal;
              videoAsset = {
                poster: resource.posterUrl,
                ghost: resource.ghostBase64,
                width: resource.width,
                height: resource.height,
              };
            } catch (error) {
              console.warn('[Workspace] HeyGem 成片本地资源化失败，回退原 URL:', error);
            }
          }

          spawnHeyGemResultVideoNodeRef.current({
            sourceNodeId: nodeId,
            outputVideo: outputVideoFinal,
            originalVideoUrl: networkUrl,
            videoAsset,
            prompt: prompt || '',
          });
          handleVideoNodeDataChange(nodeId, { progress: 0, errorMessage: undefined });
        })();
      },
      onErrorTask: (nodeId, message) => {
        const node = latestNodesRef.current.find((n) => n.id === nodeId);
        const nodeTitle = node?.data?.title || 'HeyGem';
        const errMsg = message || '视频生成失败，请检查提示词或稍后重试';
        const errorTask: Task = {
          id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          nodeId,
          nodeTitle,
          videoUrl: undefined,
          prompt: String(node?.data?.prompt || ''),
          createdAt: Date.now(),
          status: 'error',
          taskType: 'video',
          errorMessage: errMsg,
        };
        setTasks((prev) => [errorTask, ...prev]);
        // 写入 errorMessage 供 VideoNode 弹 DarkAlert，随后由节点侧清除内联态
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, progress: 0, errorMessage: errMsg } }
              : n,
          ),
        );
        handleVideoNodeDataChange(nodeId, {
          progress: 0,
          errorMessage: errMsg,
        });
      },
    }),
    [projectId, invokePickVideoFromCanvas, handleVideoNodeDataChange, setNodes],
  );

  const videoInputPanelAnchor =
    !previewImage &&
    !previewAudio &&
    !characterAvatarPickOverlay &&
    videoInputPanelData &&
    selectedNode &&
    isVideoModuleNodeType(selectedNode.type) &&
    selectedNode.type !== 'heyGem'
      ? {
          nodeId: videoInputPanelData.nodeId,
          width: 840,
          height: 'auto' as number | 'auto',
          panel: (
            <VideoInputPanel
              nodeId={videoInputPanelData.nodeId}
              isDarkMode={isDarkMode}
              prompt={videoInputPanelData.prompt}
              aspectRatio={videoInputPanelData.aspectRatio}
              model={videoInputPanelData.model}
              hd={videoInputPanelData.hd}
              duration={videoInputPanelData.duration}
              inputImages={videoInputPanelData.inputImages || []}
              inputAudioUrl={videoInputPanelData.inputAudioUrl}
              resolutionLtx23Lipsync={videoInputPanelData.resolutionLtx23Lipsync ?? '720'}
              durationLtx23I2v={normalizeLtx23DurationChoice(videoInputPanelData.durationLtx23I2v, 10)}
              resolutionLtx23I2v={videoInputPanelData.resolutionLtx23I2v ?? '720'}
              ltx23HdrBackgroundImage={videoInputPanelData.ltx23HdrBackgroundImage}
              durationLtx23HdrMulti={normalizeLtx23DurationChoice(videoInputPanelData.durationLtx23HdrMulti, 15)}
              resolutionLtx23HdrMulti={videoInputPanelData.resolutionLtx23HdrMulti ?? '720'}
              durationLtx23T2v={normalizeLtx23DurationChoice(videoInputPanelData.durationLtx23T2v, 10)}
              resolutionLtx23T2v={videoInputPanelData.resolutionLtx23T2v ?? '720'}
              sora2Channel={videoInputPanelData.sora2Channel ?? 'plugin'}
              isConnected={videoInputPanelData.isConnected}
              projectId={projectId}
              guidanceScale={videoInputPanelData.guidanceScale}
              sound={videoInputPanelData.sound}
              shotType={videoInputPanelData.shotType ?? 'single'}
              negativePrompt={videoInputPanelData.negativePrompt ?? ''}
              resolutionWan26={videoInputPanelData.resolutionWan26 ?? '1080p'}
              resolutionWanAnimate={videoInputPanelData.resolutionWanAnimate ?? '720p'}
              wanAnimateClipSec={videoInputPanelData.wanAnimateClipSec ?? '8'}
              resolutionSeedance={videoInputPanelData.resolutionSeedance ?? '720p'}
              durationSeedance={videoInputPanelData.durationSeedance ?? '10'}
              resolutionGeminiOmni={videoInputPanelData.resolutionGeminiOmni ?? '720p'}
              durationGeminiOmni={videoInputPanelData.durationGeminiOmni ?? '6'}
              durationWan26Flash={videoInputPanelData.durationWan26Flash ?? '5'}
              enableAudio={videoInputPanelData.enableAudio !== false}
              durationVeo31ProOfficial={videoInputPanelData.durationVeo31ProOfficial ?? '4'}
              generateAudioVeo31ProOfficial={videoInputPanelData.generateAudioVeo31ProOfficial === true}
              resolutionRhartV31={videoInputPanelData.resolutionRhartV31 ?? '1080p'}
              durationGrok3={videoInputPanelData.durationGrok3 ?? '10'}
              resolutionGrok3={videoInputPanelData.resolutionGrok3 ?? '720p'}
              durationHailuo02={videoInputPanelData.durationHailuo02 ?? '6'}
              resolutionHailuo={videoInputPanelData.resolutionHailuo ?? 'na'}
              durationKlingO1={videoInputPanelData.durationKlingO1 ?? '5'}
              modeKlingO1={videoInputPanelData.modeKlingO1 ?? 'std'}
              referenceVideoUrl={videoInputPanelData.referenceVideoUrl}
              keepOriginalSound={videoInputPanelData.keepOriginalSound === true}
              progress={videoInputPanelData.progress ?? 0}
              progressMessage={videoInputPanelData.progressMessage}
              wanAnimateStandalone={selectedNode?.type === 'wanAnimate'}
              heyGemStandalone={false}
              embedInNode={false}
              onKeepOriginalSoundChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, keepOriginalSound: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, keepOriginalSound: value });
              }}
              onDurationGrok3Change={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, durationGrok3: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, durationGrok3: value });
              }}
              onResolutionGrok3Change={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, resolutionGrok3: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, resolutionGrok3: value });
              }}
              onDurationHailuo02Change={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, durationHailuo02: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, durationHailuo02: value });
              }}
              onResolutionHailuoChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, resolutionHailuo: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, resolutionHailuo: value });
              }}
              onDurationKlingO1Change={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, durationKlingO1: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, durationKlingO1: value });
              }}
              onModeKlingO1Change={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, modeKlingO1: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, modeKlingO1: value });
              }}
              onResolutionRhartV31Change={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, resolutionRhartV31: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, resolutionRhartV31: value });
              }}
              onResolutionLtx23LipsyncChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, resolutionLtx23Lipsync: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, resolutionLtx23Lipsync: value });
              }}
              onDurationLtx23I2vChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, durationLtx23I2v: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, durationLtx23I2v: value });
              }}
              onResolutionLtx23I2vChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, resolutionLtx23I2v: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, resolutionLtx23I2v: value });
              }}
              onDurationLtx23T2vChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, durationLtx23T2v: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, durationLtx23T2v: value });
              }}
              onResolutionLtx23T2vChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, resolutionLtx23T2v: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, resolutionLtx23T2v: value });
              }}
              onLtx23HdrBackgroundImageChange={(value) => {
                const panelNodeId = videoInputPanelData.nodeId;
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === panelNodeId
                      ? { ...node, data: { ...node.data, ltx23HdrBackgroundImage: value || undefined } }
                      : node
                  )
                );
                setVideoInputPanelData((prev) =>
                  prev && prev.nodeId === panelNodeId
                    ? { ...prev, ltx23HdrBackgroundImage: value || undefined }
                    : prev,
                );
              }}
              onInputImagesOrderChange={(images) => {
                const panelNodeId = videoInputPanelData.nodeId;
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === panelNodeId
                      ? { ...node, data: { ...node.data, inputImages: images } }
                      : node
                  )
                );
                setVideoInputPanelData((prev) =>
                  prev && prev.nodeId === panelNodeId ? { ...prev, inputImages: images } : prev,
                );
              }}
              onDisconnectHdrSlotImage={(imageUrl) => {
                const videoId = videoInputPanelData.nodeId;
                if (!videoId) return;
                disconnectIncomingRefImageEdges(
                  videoId,
                  imageUrl,
                  latestNodesRef.current || nodes,
                  latestEdgesRef.current || edges,
                  setNodes,
                  setEdges,
                );
              }}
              onDurationLtx23HdrMultiChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, durationLtx23HdrMulti: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, durationLtx23HdrMulti: value });
              }}
              onResolutionLtx23HdrMultiChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, resolutionLtx23HdrMulti: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, resolutionLtx23HdrMulti: value });
              }}
              onSora2ChannelChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, sora2Channel: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, sora2Channel: value });
              }}
              onGuidanceScaleChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, guidanceScale: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, guidanceScale: value });
              }}
              onSoundChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, sound: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, sound: value });
              }}
              onShotTypeChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, shotType: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, shotType: value });
              }}
              onNegativePromptChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, negativePrompt: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, negativePrompt: value });
              }}
              onResolutionWan26Change={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, resolutionWan26: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, resolutionWan26: value });
              }}
              onResolutionWanAnimateChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, resolutionWanAnimate: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, resolutionWanAnimate: value });
              }}
              onWanAnimateClipSecChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, wanAnimateClipSec: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, wanAnimateClipSec: value });
              }}
              onResolutionSeedanceChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, resolutionSeedance: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, resolutionSeedance: value });
              }}
              onDurationSeedanceChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, durationSeedance: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, durationSeedance: value });
              }}
              onResolutionGeminiOmniChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, resolutionGeminiOmni: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, resolutionGeminiOmni: value });
              }}
              onDurationGeminiOmniChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, durationGeminiOmni: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, durationGeminiOmni: value });
              }}
              onDurationWan26FlashChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, durationWan26Flash: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, durationWan26Flash: value });
              }}
              onEnableAudioChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, enableAudio: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, enableAudio: value });
              }}
              onDurationVeo31ProOfficialChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, durationVeo31ProOfficial: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, durationVeo31ProOfficial: value });
              }}
              onGenerateAudioVeo31ProOfficialChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, generateAudioVeo31ProOfficial: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, generateAudioVeo31ProOfficial: value });
              }}
              onPromptChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, prompt: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, prompt: value });
              }}
              onAspectRatioChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) => {
                    if (node.id !== videoInputPanelData.nodeId) return node;
                    // 已有成片：只改下次生成比例，不强制改节点壳尺寸
                    if (hasVideoOutputMedia(node.data as Record<string, unknown>)) {
                      return { ...node, data: { ...node.data, aspectRatio: value } };
                    }
                    // Seedance「自适应」无固定宽高比，外壳按 16:9 占位，但 data 仍存 adaptive
                    if (value === 'adaptive') {
                      const patched = patchNodeWithAspectRatioLayout(node, '16:9', 'video');
                      return { ...patched, data: { ...patched.data, aspectRatio: 'adaptive' } };
                    }
                    return patchNodeWithAspectRatioLayout(node, value, 'video');
                  }),
                );
                setVideoInputPanelData({ ...videoInputPanelData, aspectRatio: value });
              }}
              onModelChange={(value) => {
                console.log('[Workspace] 模型变更:', value, 'nodeId:', videoInputPanelData.nodeId);
                // 立即同步更新节点数据和面板数据，确保 UI 立即反映变化
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, model: value } }
                      : node
                  )
                );
                // 使用函数式更新，确保基于最新状态更新
                setVideoInputPanelData((prev) => {
                  if (!prev) return prev;
                  return {
                    ...prev,
                    model: value,
                  };
                });
              }}
              onHdChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, hd: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, hd: value });
              }}
              onDurationChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, duration: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, duration: value });
              }}
              onProgressChange={(progress) => {
                // 立即更新面板内的进度，确保点击生成后立刻看到进度条
                setVideoInputPanelData((prev) => (prev ? { ...prev, progress, ...(progress === 0 ? { progressMessage: undefined } : {}) } : prev));
                // 更新节点的进度数据
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { 
                          ...node, 
                          data: { 
                            ...node.data, 
                            progress,
                            ...(progress > 0 ? { errorMessage: undefined } : {})
                          } 
                        }
                      : node
                  )
                );
                if (progress > 0) {
                  handleVideoNodeDataChange(videoInputPanelData.nodeId, { progress, errorMessage: undefined });
                } else {
                  handleVideoNodeDataChange(videoInputPanelData.nodeId, { progress });
                }
              }}
              onProgressMessageChange={(message) => {
                setVideoInputPanelData((prev) => (prev ? { ...prev, progressMessage: message } : prev));
                handleVideoNodeDataChange(videoInputPanelData.nodeId, { progressMessage: message });
              }}
              onOutputVideoChange={(url, originalUrl, localAsset) => {
                if (!url) return;
                const targetNodeId = videoInputPanelData.nodeId;
                (async () => {
                  let outputVideoFinal = url;
                  let networkUrl = originalUrl || (url.startsWith('http://') || url.startsWith('https://') ? url : undefined);
                  let videoAsset: { poster?: string; ghost?: string; width?: number; height?: number } | undefined;

                  if (localAsset && (localAsset.poster || localAsset.ghost)) {
                    videoAsset = {
                      poster: localAsset.poster,
                      ghost: localAsset.ghost,
                      width: localAsset.width,
                      height: localAsset.height,
                    };
                  }

                  // AI 返回远程 URL 时，立即本地资源化，补齐 poster/ghost，避免大面积黑框占位
                  if (
                    networkUrl &&
                    (networkUrl.startsWith('http://') || networkUrl.startsWith('https://')) &&
                    window.electronAPI?.createVideoLocalResourceFromUrl
                  ) {
                    try {
                      const resource = await window.electronAPI.createVideoLocalResourceFromUrl(projectId || undefined, networkUrl);
                      outputVideoFinal = resource.originalUrl || outputVideoFinal;
                      videoAsset = {
                        poster: resource.posterUrl,
                        ghost: resource.ghostBase64,
                        width: resource.width,
                        height: resource.height,
                      };
                    } catch (error) {
                      console.warn('[Workspace] AI 视频本地资源化失败，回退原 URL 显示:', error);
                    }
                  }

                  const srcType = latestNodesRef.current.find((n) => n.id === targetNodeId)?.type;
                  if (srcType === 'heyGem') {
                    spawnHeyGemResultVideoNodeRef.current({
                      sourceNodeId: targetNodeId,
                      outputVideo: outputVideoFinal,
                      originalVideoUrl: networkUrl,
                      videoAsset,
                      prompt: videoInputPanelData.prompt || '',
                    });
                    handleVideoNodeDataChange(targetNodeId, { progress: 0, errorMessage: undefined });
                    return;
                  }

                  setNodes((nds) =>
                    nds.map((node) => {
                      if (node.id !== targetNodeId) return node;
                      const withMedia = {
                        ...node,
                        data: {
                          ...node.data,
                          outputVideo: outputVideoFinal,
                          originalVideoUrl: networkUrl,
                          ...(videoAsset ? { videoAsset } : {}),
                          progress: 0,
                          errorMessage: undefined,
                        },
                      };
                      if (node.data?.isUserResized) return withMedia;
                      return patchNodeWithMediaLayout(
                        withMedia,
                        videoAsset?.width,
                        videoAsset?.height,
                        'video',
                      );
                    }),
                  );

                  handleVideoNodeDataChange(targetNodeId, {
                    outputVideo: outputVideoFinal,
                    originalVideoUrl: networkUrl,
                    ...(videoAsset ? { videoAsset } : {}),
                    progress: 0,
                    errorMessage: undefined,
                  });

                  setNodes((nds) => {
                    const currentNode = nds.find((n) => n.id === targetNodeId);
                    if (currentNode && outputVideoFinal) {
                      const taskUrl = networkUrl || (outputVideoFinal.startsWith('local-resource://') ? undefined : outputVideoFinal) || outputVideoFinal;
                      handleAddVideoTask(
                        targetNodeId,
                        taskUrl,
                        videoInputPanelData.prompt || currentNode.data?.prompt || '',
                        networkUrl || (outputVideoFinal.startsWith('local-resource://') ? undefined : outputVideoFinal)
                      );
                    }
                    return nds;
                  });
                })();
              }}
              onErrorTask={(message) => {
                // 创建失败任务记录并更新 VideoNode
                const node = nodes.find((n) => n.id === videoInputPanelData.nodeId);
                const nodeTitle = node?.data?.title || 'video';
                const errorTask: Task = {
                  id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  nodeId: videoInputPanelData.nodeId,
                  nodeTitle,
                  videoUrl: undefined,
                  prompt: videoInputPanelData.prompt || '',
                  createdAt: Date.now(),
                  status: 'error',
                  taskType: 'video',
                  errorMessage: message || '视频生成失败，请检查提示词或稍后重试',
                };
                setTasks((prev) => [errorTask, ...prev]);
                
                // 更新 VideoNode：停止进度条并显示错误信息
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, progress: 0, errorMessage: message || '视频生成失败' } }
                      : node
                  )
                );
                handleVideoNodeDataChange(videoInputPanelData.nodeId, { progress: 0, errorMessage: message || '视频生成失败' });
              }}
            />
          ),
        }
      : null;

  const imageInputPanelAnchor =
    !previewImage &&
    !previewAudio &&
    !characterAvatarPickOverlay &&
    imageInputPanelData &&
    selectedNode &&
    selectedNode.type === 'image'
      ? {
          nodeId: imageInputPanelData.nodeId,
          // 固定比例（与视频底栏一致），不与主模块同宽；选框尺寸由 data.width/height 校正，不受底栏影响
          width: 840,
          height: 'auto' as const,
          panel: (
            <ImageInputPanel
              nodeId={imageInputPanelData.nodeId}
              isDarkMode={isDarkMode}
              prompt={imageInputPanelData.prompt}
              resolution={imageInputPanelData.resolution}
              aspectRatio={imageInputPanelData.aspectRatio}
              model={imageInputPanelData.model}
              quality={imageInputPanelData.quality || 'low'}
              seedreamWidth={imageInputPanelData.model === 'seedream-v5'
                ? Math.max(1600, Math.min(4704, imageInputPanelData.seedreamWidth ?? 2048))
                : Math.max(1024, Math.min(4096, imageInputPanelData.seedreamWidth ?? 2048))}
              seedreamHeight={imageInputPanelData.model === 'seedream-v5'
                ? Math.max(1344, Math.min(4096, imageInputPanelData.seedreamHeight ?? 2048))
                : Math.max(1024, Math.min(4096, imageInputPanelData.seedreamHeight ?? 2048))}
              isConnected={edges.some((e) => e.target === imageInputPanelData.nodeId && nodes.find((n) => n.id === e.source)?.type === 'image')}
              inputImages={imageInputPanelData.inputImages || []}
              onInputImagesChange={(images) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === imageInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, inputImages: images } }
                      : node
                  )
                );
                setImageInputPanelData((prev) => (prev ? { ...prev, inputImages: images } : prev));
              }}
              onDisconnectRefImage={(imageUrl) => {
                const targetId = imageInputPanelData.nodeId;
                if (!targetId) return;
                disconnectIncomingRefImageEdges(
                  targetId,
                  imageUrl,
                  latestNodesRef.current || nodes,
                  latestEdgesRef.current || edges,
                  setNodes,
                  setEdges,
                );
              }}
              projectId={projectId}
              onSeedreamWidthChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === imageInputPanelData.nodeId ? { ...node, data: { ...node.data, seedreamWidth: value } } : node
                  )
                );
                setImageInputPanelData((prev) => (prev ? { ...prev, seedreamWidth: value } : prev));
              }}
              onSeedreamHeightChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === imageInputPanelData.nodeId ? { ...node, data: { ...node.data, seedreamHeight: value } } : node
                  )
                );
                setImageInputPanelData((prev) => (prev ? { ...prev, seedreamHeight: value } : prev));
              }}
              onPromptChange={(value) => {
                const targetNodeId = imageInputPanelData.nodeId;
                lastImagePromptUserEditRef.current = Date.now();
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === targetNodeId
                      ? { ...node, data: { ...node.data, prompt: value } }
                      : node
                  )
                );
                setImageInputPanelData((prev) => (prev && prev.nodeId === targetNodeId ? { ...prev, prompt: value } : prev));
              }}
              onPromptFocus={() => {
                lastImagePromptUserEditRef.current = Date.now();
              }}
              onResolutionChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === imageInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, resolution: value } }
                      : node
                  )
                );
                setImageInputPanelData((prev) => (prev ? { ...prev, resolution: value } : prev));
              }}
              onAspectRatioChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === imageInputPanelData.nodeId
                      ? patchImageNodeAspectRatio(node, value)
                      : node,
                  ),
                );
                setImageInputPanelData((prev) => (prev ? { ...prev, aspectRatio: value } : prev));
              }}
              onQualityChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === imageInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, quality: value } }
                      : node
                  )
                );
                setImageInputPanelData((prev) => (prev ? { ...prev, quality: value } : prev));
              }}
              onModelChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === imageInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, model: value } }
                      : node
                  )
                );
                setImageInputPanelData((prev) => (prev ? { ...prev, model: value } : prev));
              }}
              onOutputImageChange={(imageUrl, originalImageUrlFromPayload, outputImagesFromPayload) => {
                void (async () => {
                  const targetNodeId = imageInputPanelData.nodeId;
                  const promptToKeep = imageInputPanelData.prompt ?? '';
                  const publicOrig =
                    typeof originalImageUrlFromPayload === 'string' && /^https?:\/\//i.test(originalImageUrlFromPayload.trim())
                      ? originalImageUrlFromPayload.trim()
                      : undefined;
                  const formattedImageUrl = formatImagePathSync(imageUrl);
                  const formattedOutputImages =
                    Array.isArray(outputImagesFromPayload) && outputImagesFromPayload.length > 0
                      ? outputImagesFromPayload.map((u) => formatImagePathSync(String(u || ''))).filter(Boolean)
                      : undefined;
                  console.log('[Workspace] onOutputImageChange 被调用:', {
                    targetNodeId,
                    imageUrl: formattedImageUrl,
                    publicOrig: publicOrig || '—',
                    outputCount: formattedOutputImages?.length ?? 1,
                  });

                  const probeUrl = formattedOutputImages?.[0] || formattedImageUrl;
                  const currentNodeSnapshot = latestNodesRef.current.find((n) => n.id === targetNodeId);
                  let layoutPatchedNode: Node | undefined;
                  if (currentNodeSnapshot && probeUrl && !currentNodeSnapshot.data?.isUserResized) {
                    const baseNode: Node = {
                      ...currentNodeSnapshot,
                      data: {
                        ...currentNodeSnapshot.data,
                        outputImage: formattedImageUrl,
                        ...(formattedOutputImages && formattedOutputImages.length > 0
                          ? { outputImages: formattedOutputImages }
                          : {}),
                        ...(publicOrig ? { originalImageUrl: publicOrig } : {}),
                        prompt: (currentNodeSnapshot.data?.prompt as string | undefined) ?? promptToKeep,
                      },
                    };
                    layoutPatchedNode = await patchImageNodeWithProbedLayout(baseNode, probeUrl);
                  }

                  setNodes((nds) => {
                    const updatedNodes = nds.map((node) => {
                      if (node.id !== targetNodeId) return node;
                      if (layoutPatchedNode) {
                        return {
                          ...node,
                          data: {
                            ...node.data,
                            ...layoutPatchedNode.data,
                            progress: 0,
                            progressMessage: undefined,
                            errorMessage: undefined,
                          },
                          style: layoutPatchedNode.style ?? node.style,
                        };
                      }
                      return {
                        ...node,
                        data: {
                          ...node.data,
                          outputImage: formattedImageUrl,
                          ...(formattedOutputImages && formattedOutputImages.length > 0
                            ? { outputImages: formattedOutputImages }
                            : {}),
                          ...(publicOrig ? { originalImageUrl: publicOrig } : {}),
                          prompt: (node.data?.prompt as string | undefined) ?? promptToKeep,
                          progress: 0,
                          progressMessage: undefined,
                          errorMessage: undefined,
                        },
                      };
                    });

                    handleImageNodeDataChange(targetNodeId, {
                      outputImage: formattedImageUrl,
                      ...(formattedOutputImages && formattedOutputImages.length > 0
                        ? { outputImages: formattedOutputImages }
                        : {}),
                      originalImageUrl: publicOrig,
                      progress: 0,
                      progressMessage: undefined,
                      errorMessage: undefined,
                      ...(layoutPatchedNode
                        ? {
                            width: layoutPatchedNode.data?.width as number | undefined,
                            height: layoutPatchedNode.data?.height as number | undefined,
                          }
                        : {}),
                    });

                    const currentNode = updatedNodes.find((n) => n.id === targetNodeId);
                    if (currentNode && formattedImageUrl) {
                      const panelOrig =
                        publicOrig ||
                        (typeof currentNode.data?.originalImageUrl === 'string'
                          ? String(currentNode.data.originalImageUrl).trim()
                          : undefined);
                      handleAddTask(
                        targetNodeId,
                        formattedImageUrl,
                        imageInputPanelData.prompt || currentNode.data?.prompt || '',
                        panelOrig,
                        formattedOutputImages,
                      );
                    }

                    return updatedNodes;
                  });
                  setImageInputPanelData((prev) =>
                    prev && prev.nodeId === targetNodeId
                      ? {
                          ...prev,
                          prompt: prev.prompt ?? promptToKeep,
                          // 成片后明确保留生成参数，避免后续刷新/重开面板时丢模型、比例、分辨率
                          model: prev.model,
                          aspectRatio: prev.aspectRatio,
                          resolution: prev.resolution,
                          quality: prev.quality,
                        }
                      : prev,
                  );
                })();
              }}
              onProgressChange={(progress) => {
                const targetNodeId = imageInputPanelData.nodeId;
                handleImageNodeDataChange(targetNodeId, { progress });
              }}
              onProgressMessageChange={(message) => {
                const targetNodeId = imageInputPanelData.nodeId;
                handleImageNodeDataChange(targetNodeId, { progressMessage: message });
              }}
              onErrorTask={(message) => {
                // 创建失败任务记录（不更新图片，只记录错误信息）
                const node = nodes.find((n) => n.id === imageInputPanelData.nodeId);
                const nodeTitle = node?.data?.title || 'image';
                const errorTask: Task = {
                  id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  nodeId: imageInputPanelData.nodeId,
                  nodeTitle,
                  imageUrl: undefined,
                  prompt: imageInputPanelData.prompt || '',
                  createdAt: Date.now(),
                  status: 'error',
                  errorMessage: message || '生成失败，请检查提示词或稍后重试',
                };
                setTasks((prev) => [errorTask, ...prev]);
              }}
            />
          ),
        }
      : null;


  // 与视频底栏对齐：相对 preview 节点同比例（视频 840÷VIDEO_NODE_DEFAULT_W）
  const audioInputPanelWidth = Math.round(
    (AUDIO_NODE_WIDTH / Math.max(VIDEO_NODE_DEFAULT_W, 1)) * 840,
  );

  const audioInputPanelAnchor =
    !previewImage &&
    !previewAudio &&
    !characterAvatarPickOverlay &&
    audioInputPanelData &&
    selectedNode &&
    selectedNode.type === 'audio'
      ? {
          nodeId: audioInputPanelData.nodeId,
          width: audioInputPanelWidth,
          height: 'auto' as const,
          panel: (
            <AudioInputPanel
              nodeId={audioInputPanelData.nodeId}
              isDarkMode={isDarkMode}
              onStart={() => handleAudioNodeDataChange(audioInputPanelData.nodeId, { aiStatus: 'START', progress: 1, errorMessage: undefined })}
              text={audioInputPanelData.text}
              model={audioInputPanelData.model || 'speech-2.8-hd'}
              voiceId={audioInputPanelData.voiceId}
              speed={audioInputPanelData.speed}
              volume={audioInputPanelData.volume}
              pitch={audioInputPanelData.pitch}
              emotion={audioInputPanelData.emotion}
              isTextConnected={!!audioInputPanelData.isTextConnected}
              isAudioConnected={!!audioInputPanelData.isAudioConnected}
              isSourceSongConnected={!!audioInputPanelData.isSourceSongConnected}
              referenceAudioUrl={audioInputPanelData.referenceAudioUrl || ''}
              sourceSongAudioUrl={audioInputPanelData.sourceSongAudioUrl || ''}
              coverRhVolume={audioInputPanelData.coverRhVolume ?? 5}
              coverPitch={clampCoverPitch(audioInputPanelData.coverPitch ?? 0)}
              coverIndexRate={clampCoverIndexRate(audioInputPanelData.coverIndexRate)}
              coverVocalMixPct={clampCoverVocalMixPct(audioInputPanelData.coverVocalMixPct)}
              coverAccompanimentMixPct={resolveCoverAccompanimentMixPct(
                audioInputPanelData.coverAccompanimentMixPct,
                audioInputPanelData.coverOutputMode,
              )}
              rvcTrainModelName={audioInputPanelData.rvcTrainModelName ?? ''}
              rvcCoverModelName={audioInputPanelData.rvcCoverModelName ?? ''}
              outputModelUrl={(audioInputPanelData as { outputModelUrl?: string }).outputModelUrl ?? ''}
              outputModelRemoteUrl={(audioInputPanelData as { outputModelRemoteUrl?: string }).outputModelRemoteUrl ?? ''}
              coverReferenceAudioUrl={(audioInputPanelData as { coverReferenceAudioUrl?: string }).coverReferenceAudioUrl ?? ''}
              libraryRvcVoiceId={(audioInputPanelData as { libraryRvcVoiceId?: string }).libraryRvcVoiceId ?? ''}
              songName={audioInputPanelData.songName ?? ''}
              styleDesc={audioInputPanelData.styleDesc ?? ''}
              lyrics={audioInputPanelData.lyrics ?? ''}
              speechRate={audioInputPanelData.speechRate ?? 0}
              loudnessRate={audioInputPanelData.loudnessRate ?? 0}
              projectId={projectId}
              onSongNameChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId ? { ...node, data: { ...node.data, songName: value } } : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, songName: value });
              }}
              onStyleDescChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId ? { ...node, data: { ...node.data, styleDesc: value } } : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, styleDesc: value });
              }}
              onLyricsChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId ? { ...node, data: { ...node.data, lyrics: value } } : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, lyrics: value });
              }}
              onSpeechRateChange={(value) => {
                const v = clampDoubaoSpeechRate(value);
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, speechRate: v } }
                      : node,
                  ),
                );
                setAudioInputPanelData({ ...audioInputPanelData, speechRate: v });
              }}
              onLoudnessRateChange={(value) => {
                const v = clampDoubaoLoudnessRate(value);
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, loudnessRate: v } }
                      : node,
                  ),
                );
                setAudioInputPanelData({ ...audioInputPanelData, loudnessRate: v });
              }}
              onModelChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId ? { ...node, data: { ...node.data, model: value } } : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, model: value });
              }}
              onReferenceAudioUrlChange={(value) => {
                const targetId = audioInputPanelData.nodeId;
                const ref = (value || '').trim();
                let outputAudioForNode: string | undefined;
                let networkUrl: string | undefined;
                if (ref) {
                  if (ref.startsWith('http://') || ref.startsWith('https://')) {
                    outputAudioForNode = ref;
                    networkUrl = ref;
                  } else if (!ref.startsWith('data:')) {
                    const cleanPath = ref.replace(/^(file:\/\/|local-resource:\/\/)+/i, '');
                    let filePath = cleanPath.replace(/\\/g, '/');
                    if (filePath.match(/^\/[a-zA-Z]:/)) filePath = filePath.substring(1);
                    if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
                    else if (filePath.match(/^[a-zA-Z]:\//)) filePath = filePath[0].toUpperCase() + filePath.substring(1);
                    outputAudioForNode = `local-resource://${filePath}`;
                  }
                }
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === targetId
                      ? {
                          ...node,
                          data: {
                            ...node.data,
                            referenceAudioUrl: ref,
                            ...(outputAudioForNode
                              ? {
                                  outputAudio: outputAudioForNode,
                                  originalAudioUrl: networkUrl,
                                  errorMessage: undefined,
                                }
                              : {}),
                          },
                        }
                      : node,
                  ),
                );
                setAudioInputPanelData({ ...audioInputPanelData, referenceAudioUrl: ref });
                if (outputAudioForNode) {
                  handleAudioNodeDataChange(targetId, {
                    outputAudio: outputAudioForNode,
                    originalAudioUrl: networkUrl,
                    errorMessage: undefined,
                  });
                }
              }}
              onCoverRhVolumeChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId ? { ...node, data: { ...node.data, coverRhVolume: value } } : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, coverRhVolume: value });
              }}
              onCoverPitchChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId ? { ...node, data: { ...node.data, coverPitch: value } } : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, coverPitch: value });
              }}
              onCoverIndexRateChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId ? { ...node, data: { ...node.data, coverIndexRate: value } } : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, coverIndexRate: value });
              }}
              onCoverVocalMixPctChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId ? { ...node, data: { ...node.data, coverVocalMixPct: value } } : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, coverVocalMixPct: value });
              }}
              onCoverAccompanimentMixPctChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, coverAccompanimentMixPct: value } }
                      : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, coverAccompanimentMixPct: value });
              }}
              onRvcTrainModelNameChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId ? { ...node, data: { ...node.data, rvcTrainModelName: value } } : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, rvcTrainModelName: value });
              }}
              onRvcCoverModelNameChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId ? { ...node, data: { ...node.data, rvcCoverModelName: value } } : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, rvcCoverModelName: value });
              }}
              onTextChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, text: value } }
                      : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, text: value });
              }}
              onVoiceIdChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, voiceId: value } }
                      : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, voiceId: value });
              }}
              onSpeedChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, speed: value } }
                      : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, speed: value });
              }}
              onVolumeChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, volume: value } }
                      : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, volume: value });
              }}
              onPitchChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, pitch: value } }
                      : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, pitch: value });
              }}
              onEmotionChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, emotion: value } }
                      : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, emotion: value });
              }}
              onOutputAudioChange={(audioUrl, originalUrl, outputAudiosFromPayload, originalOutputAudiosFromPayload) => {
                if (!audioUrl) return;
                
                const targetNodeId = audioInputPanelData.nodeId;
                const formatOne = (u: string): string => {
                  if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('data:')) return u;
                  const cleanPath = u.replace(/^(file:\/\/|local-resource:\/\/)/, '');
                  let filePath = cleanPath.replace(/\\/g, '/');
                  if (filePath.match(/^\/[a-zA-Z]:/)) filePath = filePath.substring(1);
                  return `local-resource://${filePath}`;
                };
                let formattedAudioUrl = formatOne(audioUrl);
                const networkUrl = (originalUrl && (originalUrl.startsWith('http://') || originalUrl.startsWith('https://'))) ? originalUrl : (formattedAudioUrl.startsWith('http') ? formattedAudioUrl : undefined);
                const outputAudioForNode = networkUrl || formattedAudioUrl;
                const formattedOutputAudios =
                  Array.isArray(outputAudiosFromPayload) && outputAudiosFromPayload.length > 1
                    ? outputAudiosFromPayload.map((u, i) => {
                        const orig = originalOutputAudiosFromPayload?.[i];
                        const net = orig && (orig.startsWith('http://') || orig.startsWith('https://')) ? orig : undefined;
                        return net || formatOne(String(u || ''));
                      })
                    : undefined;
                
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === targetNodeId
                      ? {
                          ...node,
                          data: {
                            ...node.data,
                            outputAudio: outputAudioForNode,
                            ...(formattedOutputAudios ? { outputAudios: formattedOutputAudios } : {}),
                            ...(Array.isArray(originalOutputAudiosFromPayload) && originalOutputAudiosFromPayload.length > 0
                              ? { originalOutputAudios: originalOutputAudiosFromPayload }
                              : {}),
                            originalAudioUrl: networkUrl,
                            errorMessage: undefined,
                          },
                        }
                      : node
                  )
                );
                handleAudioNodeDataChange(targetNodeId, {
                  outputAudio: outputAudioForNode,
                  ...(formattedOutputAudios ? { outputAudios: formattedOutputAudios } : {}),
                  ...(Array.isArray(originalOutputAudiosFromPayload) && originalOutputAudiosFromPayload.length > 0
                    ? { originalOutputAudios: originalOutputAudiosFromPayload }
                    : {}),
                  originalAudioUrl: networkUrl,
                  errorMessage: undefined,
                });
              }}
              onErrorTask={(message) => {
                // 创建失败任务记录并更新 AudioNode
                const node = nodes.find((n) => n.id === audioInputPanelData.nodeId);
                const nodeTitle = node?.data?.title || 'audio';
                const errorTask: Task = {
                  id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  nodeId: audioInputPanelData.nodeId,
                  nodeTitle,
                  imageUrl: undefined,
                  prompt: audioInputPanelData.text || '',
                  createdAt: Date.now(),
                  status: 'error',
                  errorMessage: message || '音频生成失败，请检查提示词或稍后重试',
                };
                setTasks((prev) => [errorTask, ...prev]);
                
                // 更新 AudioNode：显示错误信息
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, errorMessage: message || '音频生成失败' } }
                      : node
                  )
                );
                handleAudioNodeDataChange(audioInputPanelData.nodeId, { errorMessage: message || '音频生成失败' });
              }}
            />
          ),
        }
      : null;

  const imageTo3dInputPanelAnchor =
    !previewImage &&
    !previewAudio &&
    !characterAvatarPickOverlay &&
    imageTo3dInputPanelData &&
    selectedNode &&
    selectedNode.type === 'imageTo3d'
      ? {
          nodeId: imageTo3dInputPanelData.nodeId,
          width: 720,
          height: 'auto' as const,
          panel: (
            <ImageTo3dInputPanel
              nodeId={imageTo3dInputPanelData.nodeId}
              isDarkMode={isDarkMode}
              inputImageUrl={imageTo3dInputPanelData.inputImageUrl}
              model={imageTo3dInputPanelData.model || DEFAULT_IMAGE_TO_3D_MODEL}
              resultTextureUrl={imageTo3dInputPanelData.resultTextureUrl || ''}
              projectId={projectId}
              errorMessage={selectedNode.data?.errorMessage as string | undefined}
              hasOutput={
                !!(
                  selectedNode.data?.outputGlbUrl ||
                  selectedNode.data?.localGlbUrl ||
                  selectedNode.data?.remoteGlbUrl
                )
              }
              progress={(selectedNode.data?.progress as number) ?? 0}
              progressMessage={selectedNode.data?.progressMessage as string | undefined}
              onStart={() => {
                const nid = imageTo3dInputPanelData.nodeId;
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === nid
                      ? {
                          ...node,
                          data: {
                            ...node.data,
                            progress: 5,
                            progressMessage: '生成中…',
                            errorMessage: undefined,
                            resultTextureUrl: undefined,
                            libraryCharacterId: undefined,
                          },
                        }
                      : node,
                  ),
                );
              }}
              onProgressChange={(progress, message) => {
                const nid = imageTo3dInputPanelData.nodeId;
                invokeImageTo3dNodeDataChange(nid, {
                  progress,
                  progressMessage: message ?? '',
                });
              }}
              onInputImageChange={(url) => {
                const nid = imageTo3dInputPanelData.nodeId;
                invokeImageTo3dNodeDataChange(nid, {
                  inputImageUrl: url,
                  errorMessage: undefined,
                });
                setImageTo3dInputPanelData((prev) =>
                  prev && prev.nodeId === nid ? { ...prev, inputImageUrl: url } : prev,
                );
              }}
              onModelChange={(model) => {
                const nid = imageTo3dInputPanelData.nodeId;
                invokeImageTo3dNodeDataChange(nid, { model });
                setImageTo3dInputPanelData((prev) =>
                  prev && prev.nodeId === nid ? { ...prev, model } : prev,
                );
              }}
              onComplete={(payload) => {
                const nid = imageTo3dInputPanelData.nodeId;
                const tex = payload.resultTextureUrl || '';
                invokeImageTo3dNodeDataChange(nid, {
                  inputImageUrl: payload.inputImageUrl,
                  outputGlbUrl: payload.outputGlbUrl,
                  remoteGlbUrl: payload.remoteGlbUrl,
                  localGlbPath: payload.localGlbPath,
                  localGlbUrl: payload.localGlbUrl,
                  localTexturePath: payload.localTexturePath,
                  resultTextureUrl: tex || undefined,
                  resultTextureRemoteUrl: payload.resultTextureRemoteUrl,
                  previewSnapshotUrl: undefined,
                  progress: 0,
                  progressMessage: '',
                  errorMessage: undefined,
                  libraryCharacterId: payload.libraryCharacterId,
                });
                setImageTo3dInputPanelData((prev) =>
                  prev && prev.nodeId === nid ? { ...prev, resultTextureUrl: tex } : prev,
                );
                if (payload.libraryCharacterId) {
                  handleImageTo3dLibrarySaved();
                }
              }}
              onError={(message) => {
                invokeImageTo3dNodeDataChange(imageTo3dInputPanelData.nodeId, {
                  progress: 0,
                  progressMessage: '',
                  errorMessage: message,
                });
              }}
            />
          ),
        }
      : null;

  return (
    <div
      data-nexflow-workspace-root
      className={`fixed inset-0 w-full h-full ${isDarkMode ? 'bg-[#121212] dark-mode' : 'light-mode'} flex flex-col overflow-hidden`}
      style={{
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: !isDarkMode ? lightCanvasBgColor : '#121212',
        filter: !isDarkMode ? `brightness(${lightBrightness})` : undefined,
      }}
    >
      {/* 退出中：显示加载动画，停止渲染重型节点 */}
      {isExiting && (
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          style={{ pointerEvents: 'none' }}
        >
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
            <span className="text-white/90 text-sm">正在返回项目列表...</span>
          </div>
        </div>
      )}

      {/* 画板工具：白板画画，完成后创建 Image 节点作为参考图 */}
      {canvasToolPending && (
        <CanvasToolPanel
          isDarkMode={isDarkMode}
          onConfirm={handleCanvasToolConfirm}
          onCancel={() => setCanvasToolPending(null)}
        />
      )}

      {/* 画板编辑：从 Image 节点画板按钮打开，画布显示当前图片供绘图标记 */}
      {drawingBoardForImage && (
        <CanvasToolPanel
          key={`drawing-${drawingBoardForImage.nodeId}`}
          isDarkMode={isDarkMode}
          initialImageUrl={drawingBoardForImage.imageUrl}
          localPath={drawingBoardForImage.localPath}
          nodeId={drawingBoardForImage.nodeId}
          onApplyToNode={async (nodeId, dataUrl) => {
            setDrawingBoardForImage(null);
            if (!dataUrl?.startsWith('data:image/')) {
              handleImageNodeDataChangeRef.current?.(nodeId, { outputImage: dataUrl });
              return;
            }
            if (projectId && window.electronAPI?.createImageLocalResourceFromBuffer) {
              try {
                const base64 = dataUrl.replace(/^data:image\/[^;]+;base64,/, '');
                const buffer = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer;
                const result = await window.electronAPI.createImageLocalResourceFromBuffer(projectId, 'drawing-marked.png', buffer);
                if (result?.originalUrl) {
                  handleImageNodeDataChangeRef.current?.(nodeId, {
                    outputImage: result.originalUrl,
                    imageAsset: {
                      preview: result.previewUrl,
                      original: result.originalUrl,
                      tiny: result.tinyUrl,
                      avgColorHex: result.avgColorHex,
                    },
                  });
                  return;
                }
              } catch (e) {
                console.warn('[画板] 保存到项目资源失败，回退 data URL:', e);
              }
            }
            handleImageNodeDataChangeRef.current?.(nodeId, { outputImage: dataUrl });
          }}
          onConfirm={() => setDrawingBoardForImage(null)}
          onCancel={() => setDrawingBoardForImage(null)}
        />
      )}

      {/* 顶部工具栏：直接放在布局内（非 Portal），确保画布不会重叠、点击始终有效 */}
      <div
        className="flex-shrink-0 relative z-[1000]"
        data-nexflow-workspace-header
        style={{ pointerEvents: 'auto' }}
      >
        <WorkspaceHeader
          isDarkMode={isDarkMode}
          setIsDarkMode={handleSetIsDarkMode}
          lightBrightness={lightBrightness}
          setLightBrightness={setLightBrightness}
          lightCanvasBgColor={lightCanvasBgColor}
          setLightCanvasBgColor={setLightCanvasBgColor}
          lightDotsColor={lightDotsColor}
          setLightDotsColor={setLightDotsColor}
          lightDotSize={lightDotSize}
          setLightDotSize={setLightDotSize}
          darkDotSize={darkDotSize}
          setDarkDotSize={setDarkDotSize}
          canvasDotGap={canvasDotGap}
          setCanvasDotGap={setCanvasDotGap}
          edgeColor={edgeColor ?? undefined}
          setEdgeColor={setEdgeColor}
          onNavigateBack={handleNavigateBack}
          onUndo={handleUndo}
          onRedo={handleRedo}
          canUndo={undoRedoState.canUndo}
          canRedo={undoRedoState.canRedo}
          onOpenFolder={async () => {
            if (!window.electronAPI || !projectId) return;
            try {
              const projectDir = await window.electronAPI.getProjectMappedPath(projectId);
              if (projectDir) {
                const sep = projectDir.includes('\\') ? '\\' : '/';
                const assetsDir = `${projectDir.replace(/[/\\]+$/, '')}${sep}assets`;
                await window.electronAPI.openPath(assetsDir);
              } else {
                console.warn('项目未找到，无法打开文件夹:', projectId);
              }
            } catch (error) {
              console.error('打开项目文件夹失败:', error);
            }
          }}
          onBackupProject={handleBackupProject}
          onRestoreFromBackup={handleRestoreFromBackup}
          edgePathStyle={edgePathStyle}
          setEdgePathStyle={setEdgePathStyle}
          projectId={projectId}
          lafStatus={lafStatus}
          lafBalance={lafBalance}
          onLafClick={handleLafClick}
        />
      </div>

      {/* 主内容区域（画布） */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* 左侧角色列表 + 右侧任务列表（性能隔离：React.memo） */}
        <WorkspaceSidebar
          characterListCollapsed={characterListCollapsed}
          onToggleCharacterList={() => setCharacterListCollapsed(!characterListCollapsed)}
          characterListRefreshTrigger={characterListRefreshTrigger}
          sceneListRefreshTrigger={sceneListRefreshTrigger}
          digitalHumanListRefreshTrigger={digitalHumanListRefreshTrigger}
          rvcVoiceListRefreshTrigger={rvcVoiceListRefreshTrigger}
          onSelectCharacter={handleSelectCharacter}
          requestVoicePickFromCanvas={requestVoicePickFromCanvas}
          requestViewSlotPickFromCanvas={requestViewSlotPickFromCanvas}
          requestSceneImagePickFromCanvas={requestSceneImagePickFromCanvas}
          requestDigitalHumanVideoPickFromCanvas={requestDigitalHumanVideoPickFromCanvas}
          rightSidebarOpen={rightSidebarOpen}
          onToggleRightSidebar={() => setRightSidebarOpen(!rightSidebarOpen)}
          tasks={dedupedSortedTasks}
          projectId={projectId}
          isDarkMode={isDarkMode}
          formatImagePath={formatImagePathSync}
          mapProjectPath={mapProjectPath}
          onPreviewImage={onPreviewImageFromTask}
          onPreviewAudio={onPreviewAudioFromTask}
          onDownloadLocalFile={handleDownloadLocalTaskFile}
          onDeleteTask={handleDeleteTask}
          onDownloadImage={handleDownloadImage}
          onDownloadVideo={handleDownloadVideo}
          onDownloadAudio={handleDownloadAudio}
          onClearAllTasks={handleClearAllTasks}
          onTaskPlaceToCanvas={handleTaskPlaceToCanvas}
          onPlaceSceneToCanvas={handleScenePlaceToCanvas}
          onPlaceDigitalHumanToCanvas={handleDigitalHumanPlaceToCanvas}
          onPlaceRvcVoiceToCanvas={handleRvcVoicePlaceToCanvas}
          onRvcVoiceUpdated={handleRvcVoiceLibraryUpdated}
        />
        
        {/* 中间画布区域 - 覆盖整个区域，左侧边栏覆盖在上面 */}
        <div 
          className="flex-1 relative transition-all duration-300 ease-in-out"
          style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <OptionalEngineDownloadBar isDarkMode={isDarkMode} />
          {characterAvatarPickOverlay && (
            <>
              <div
                className="absolute inset-0 z-[50] pointer-events-none bg-violet-400/20"
                aria-hidden
              />
              <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[55] pointer-events-auto flex flex-col items-center gap-3">
                <p className="rounded-lg bg-black/55 px-4 py-2 text-sm text-white/90 shadow-lg backdrop-blur-sm">
                  {characterCanvasPickTarget === 'voice'
                    ? '点击画布上的音频模块以选取驱动音频（Esc / 右键取消）'
                    : characterCanvasPickTarget === 'digitalHumanVideo'
                      ? '点击画布上的视频模块以选取参考视频（Esc / 右键取消）'
                      : characterCanvasPickTarget === 'sceneNormal' || characterCanvasPickTarget === 'sceneDisplay3d'
                        ? '点击画布上的图片模块以选取场景图（Esc / 右键取消）'
                        : '点击画布上的图片模块以选取参考图（Esc / 右键取消）'}
                </p>
                <button
                  type="button"
                  onClick={() => cancelCharacterCanvasPick()}
                  className="rounded-xl border border-violet-400/50 bg-violet-600 px-8 py-3.5 text-base font-semibold text-white shadow-xl shadow-violet-900/40 backdrop-blur-sm transition-colors hover:bg-violet-500 hover:border-violet-300/60 active:scale-[0.98]"
                >
                  取消
                </button>
              </div>
            </>
          )}
          {quickConnectSourceId && !characterAvatarPickOverlay ? (
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[55] pointer-events-auto flex flex-col items-center gap-3">
              <p className="rounded-lg bg-black/55 px-4 py-2 text-sm text-white/90 shadow-lg backdrop-blur-sm">
                {locale === 'en'
                  ? 'Output module selected → click a module to connect (Esc / empty cancel)'
                  : '已选输出模块 → 请点击要接入的模块（Esc / 点空白取消）'}
              </p>
              <button
                type="button"
                onClick={() => cancelQuickConnect()}
                className="rounded-xl border border-white/30 bg-white/15 px-8 py-3.5 text-base font-semibold text-white shadow-xl backdrop-blur-sm transition-colors hover:bg-white/25 hover:border-white/50 active:scale-[0.98]"
              >
                {locale === 'en' ? 'Cancel connect' : '取消连线'}
              </button>
            </div>
          ) : null}
          <LlmInputPanelProvider value={llmInputPanelAnchor}>
          <StoryboardScriptInputPanelProvider value={storyboardScriptInputPanelAnchor}>
          <DirectorInputPanelProvider value={directorInputPanelAnchor}>
          <ImageInputPanelProvider value={imageInputPanelAnchor}>
          <VideoInputPanelProvider value={videoInputPanelAnchor}>
          <HeyGemInlinePanelProvider value={heyGemInlinePanelApi}>
          <AudioInputPanelProvider value={audioInputPanelAnchor}>
          <ImageTo3dInputPanelProvider value={imageTo3dInputPanelAnchor}>
          <CanvasThemeProvider isDarkMode={isDarkMode} performanceMode={isPerformanceMode}>
          <ReactFlowProvider>
            <FlowContent
              characterAvatarPickActive={characterAvatarPickOverlay}
              characterCanvasPickTarget={characterCanvasPickTarget}
              quickConnectSourceId={quickConnectSourceId}
              nodes={nodes}
              edges={edges}
              selectedEdgeId={selectedEdge?.id ?? null}
              edgeDeleteModeId={edgeDeleteModeId}
              onEdgeDeleteRequest={onEdgeDeleteRequest}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodesDelete={onNodesDelete}
              onConnect={onConnect}
              onNodeClick={onNodeClickStable}
              onSelectionChange={onSelectionChange}
              onNodeDragStart={onNodeDragStart}
              onNodeDrag={onNodeDrag}
              onNodeDragStop={onNodeDragStop}
              onPaneClick={onPaneClick}
              onEdgeClick={onEdgeClick}
              onEdgeCenterClick={onEdgeCenterClick}
              onDrop={onDrop}
              onDragOver={onDragOver}
              nodeTypes={nodeTypes}
              contextMenu={contextMenu}
              setContextMenu={setContextMenu}
              handleMenuSelect={handleMenuSelect}
              reactFlowWrapper={reactFlowWrapper}
              isDarkMode={isDarkMode}
              lightCanvasBgColor={lightCanvasBgColor}
              lightDotsColor={lightDotsColor}
              lightDotSize={canvasDotSize}
              canvasDotGap={canvasDotGap}
              moduleComponentColor={isDarkMode ? moduleComponentColor : undefined}
              edgeColor={edgeColor ?? undefined}
              characterListCollapsed={characterListCollapsed}
              onBatchRun={handleBatchRun}
              batchRunInProgress={batchRunInProgress}
              onSuperConnect={handleSuperConnect}
              onReverseSuperConnect={handleReverseSuperConnect}
              onJoinSelectedVideos={handleJoinSelectedVideos}
              videoJoinBusy={videoJoinBusy}
              onCreateGridMapFromSelection={handleCreateGridMapFromSelection}
              setNodes={setNodes}
              setEdges={setEdges}
              flowContentApiRef={flowContentApiRef}
              onPerformanceModeChange={setIsPerformanceMode}
              onOpenProjects={() => void handleNavigateBack()}
              edgePathStyle={edgePathStyle}
              onFitViewComplete={() => persistProjectCardThumbnail(true)}
              projectId={projectId}
            />
          </ReactFlowProvider>
          </CanvasThemeProvider>
          </ImageTo3dInputPanelProvider>
          </AudioInputPanelProvider>
          </HeyGemInlinePanelProvider>
          </VideoInputPanelProvider>
          </ImageInputPanelProvider>
          </DirectorInputPanelProvider>
          </StoryboardScriptInputPanelProvider>
          </LlmInputPanelProvider>
        </div>

        {/* 任务预览全屏查看（支持图片和视频；图片支持打标签工具） */}
        {previewImage && (
          previewShowVideoPlayer ? (
            <div
              className="fixed inset-0 z-[200] cursor-zoom-out bg-black/90 flex items-center justify-center"
              onClick={() => {
                setPreviewImage(null);
                setPreviewImageNodeId(null);
                setSelectedNode(null);
                setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
                setLlmInputPanelData(null);
                setVideoInputPanelData(null);
              }}
              role="presentation"
              title="点击任意处关闭"
            >
              <div
                className="flex flex-col items-center gap-4 px-4"
                onClick={(e) => e.stopPropagation()}
              >
                <VideoPreview
                  src={previewImage}
                  className="max-w-[90vw] max-h-[84vh] object-contain rounded-lg shadow-2xl"
                  preload="auto"
                  playsInline
                />
                <button
                  onClick={() => {
                    setPreviewImage(null);
                    setPreviewImageNodeId(null);
                    setSelectedNode(null);
                    setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
                    setLlmInputPanelData(null);
                    setVideoInputPanelData(null);
                  }}
                  className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-white hover:bg-white/90 text-black transition-colors z-[210]"
                >
                  <ChevronLeft className="w-4 h-4" />
                  返回
                </button>
              </div>
            </div>
          ) : (
            <ImagePreviewWithTools
              imageUrl={previewImage}
              nodeId={previewImageNodeId ?? undefined}
              localPath={previewImageNodeId ? (nodes.find((n) => n.id === previewImageNodeId)?.data?.localPath as string | undefined) : undefined}
              isDarkMode={isDarkMode}
              onApply={(nodeId, dataUrl) => {
                handleImageNodeDataChange(nodeId, { outputImage: dataUrl });
              }}
              onClose={() => {
                setPreviewImage(null);
                setPreviewImageNodeId(null);
                setSelectedNode(null);
                setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
                setLlmInputPanelData(null);
                setVideoInputPanelData(null);
              }}
              onImportToCanvas={
                previewCanImportToCanvas ? () => void handleImportPreviewImageToCanvas() : undefined
              }
              importToCanvasLabel={imgc.importToCanvasButton}
            />
          )
        )}

        {/* 音频预览弹窗 */}
        {previewAudio && (
          <div className={`fixed inset-0 z-50 ${isDarkMode ? 'bg-black/90' : 'bg-gray-900/90'} flex items-center justify-center`}>
            <button
              onClick={() => {
                setPreviewAudio(null);
                setSelectedNode(null);
                setImageInputPanelData(null);
        setImageTo3dInputPanelData(null);
                setLlmInputPanelData(null);
                setVideoInputPanelData(null);
                setAudioInputPanelData(null);
              }}
              className="absolute top-6 right-8 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
            >
              <ChevronLeft className="w-3 h-3" />
              返回
            </button>
            <div className="w-full max-w-2xl px-8">
              <audio
                key={previewAudio}
                src={previewAudio}
                controls
                className={`w-full ${isDarkMode ? 'audio-dark' : ''}`}
                preload="none"
                onCanPlay={(e) => {
                  const audio = e.currentTarget;
                  if (audio.currentTime > 0) {
                    audio.currentTime = 0;
                  }
                }}
                onLoadedMetadata={(e) => {
                  const audio = e.currentTarget;
                  audio.currentTime = 0;
                }}
                onPlay={(e) => {
                  const audio = e.currentTarget;
                  if (audio.currentTime > 0.1) {
                    audio.currentTime = 0;
                  }
                }}
                onError={(e) => {
                  const audio = e.currentTarget;
                  console.error('[音频预览] 加载失败:', {
                    src: audio.currentSrc || previewAudio,
                    error: audio.error?.code,
                    message: audio.error?.message,
                  });
                }}
              />
            </div>
          </div>
        )}



        {/* Character 输入面板弹窗（底部显示，向上滑出动画） */}
        {!previewImage && !previewAudio && !characterAvatarPickOverlay && characterInputPanelData && selectedNode && selectedNode.type === 'character' && !HIDE_SORA2_AND_SORA_CHARACTER_UI && (
          <div className="absolute z-50 animate-slide-up" style={{ width: '840px', height: '242px', left: 'calc(50% - 420px)', bottom: '21.25px', pointerEvents: 'auto' }}>
            <CharacterInputPanel
              nodeId={characterInputPanelData.nodeId}
              isDarkMode={isDarkMode}
              videoUrl={characterInputPanelData.videoUrl}
              nickname={characterInputPanelData.nickname}
              timestamp={characterInputPanelData.timestamp}
              characterChannel={characterInputPanelData.characterChannel || 'core'}
              isConnected={characterInputPanelData.isConnected}
              projectId={projectId}
              isUploading={characterInputPanelData.isUploading}
              needsUpload={characterInputPanelData.needsUpload}
              localVideoPath={characterInputPanelData.localVideoPath}
              onConfirmUpload={() => {
                // 确认上传视频
                if (characterInputPanelData.localVideoPath && window.electronAPI) {
                  // 设置上传状态
                  setCharacterInputPanelData((prev) => {
                    if (prev) {
                      return {
                        ...prev,
                        isUploading: true,
                        needsUpload: false, // 清除需要上传标志
                      };
                    }
                    return prev;
                  });
                  
                  // 创建上传 Promise
                  const uploadPromise = window.electronAPI.uploadVideoToOSS(characterInputPanelData.localVideoPath!);
                  
                  // 保存 uploadPromise
                  setCharacterInputPanelData((prev) => {
                    if (prev) {
                      return {
                        ...prev,
                        uploadPromise: uploadPromise,
                      };
                    }
                    return prev;
                  });
                  
                  // 异步上传到 OSS
                  uploadPromise
                    .then((result) => {
                      if (result.success && result.url) {
                        console.log('[Workspace] 视频上传到 OSS 成功，OSS URL:', result.url);
                        // 更新节点数据（使用 OSS URL）
                        setNodes((nds) => {
                          return nds.map((node) => {
                            if (node.id === characterInputPanelData.nodeId) {
                              return {
                                ...node,
                                data: {
                                  ...node.data,
                                  videoUrl: result.url!, // 使用 OSS URL
                                },
                              };
                            }
                            return node;
                          });
                        });
                        
                        // 更新输入面板数据（使用 OSS URL）
                        setCharacterInputPanelData((prev) => {
                          if (prev && prev.nodeId === characterInputPanelData.nodeId) {
                            return {
                              ...prev,
                              videoUrl: result.url!, // 使用 OSS URL
                              isUploading: false, // 清除上传状态
                              uploadPromise: undefined, // 清除 uploadPromise
                              localVideoPath: undefined, // 清除本地路径
                            };
                          }
                          return prev;
                        });
                      } else {
                        console.error('[Workspace] 视频上传到 OSS 失败:', result.error);
                        // 上传失败，清除上传状态
                        setCharacterInputPanelData((prev) => {
                          if (prev && prev.nodeId === characterInputPanelData.nodeId) {
                            return {
                              ...prev,
                              isUploading: false,
                              needsUpload: true, // 恢复需要上传标志
                              uploadPromise: undefined,
                            };
                          }
                          return prev;
                        });
                      }
                    })
                    .catch((error) => {
                      console.error('[Workspace] 视频上传到 OSS 时出错:', error);
                      // 上传失败，清除上传状态
                      setCharacterInputPanelData((prev) => {
                        if (prev && prev.nodeId === characterInputPanelData.nodeId) {
                          return {
                            ...prev,
                            isUploading: false,
                            needsUpload: true, // 恢复需要上传标志
                            uploadPromise: undefined,
                          };
                        }
                        return prev;
                      });
                    });
                }
              }}
              onVideoUrlChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === characterInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, videoUrl: value } }
                      : node
                  )
                );
                setCharacterInputPanelData({ ...characterInputPanelData, videoUrl: value });
              }}
              onNicknameChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === characterInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, nickname: value } }
                      : node
                  )
                );
                setCharacterInputPanelData({ ...characterInputPanelData, nickname: value });
              }}
              onTimestampChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === characterInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, timestamp: value } }
                      : node
                  )
                );
                setCharacterInputPanelData({ ...characterInputPanelData, timestamp: value });
              }}
              onCharacterChannelChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === characterInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, characterChannel: value } }
                      : node
                  )
                );
                setCharacterInputPanelData({ ...characterInputPanelData, characterChannel: value });
              }}
              onCreateCharacter={async () => {
                let finalVideoUrl = characterInputPanelData.videoUrl;
                
                // 如果正在上传视频到 OSS，等待上传完成
                if (characterInputPanelData.isUploading && characterInputPanelData.uploadPromise) {
                  console.log('[Workspace] 等待视频上传到 OSS 完成...');
                  try {
                    const uploadResult = await characterInputPanelData.uploadPromise;
                    // 严格验证 uploadResult 是否存在且格式正确
                    if (uploadResult && typeof uploadResult === 'object' && uploadResult.success === true && uploadResult.url && typeof uploadResult.url === 'string') {
                      // 上传完成，使用返回的 OSS URL
                      finalVideoUrl = uploadResult.url;
                      // 更新状态
                      setCharacterInputPanelData((prev) => {
                        if (prev) {
                          return {
                            ...prev,
                            videoUrl: uploadResult.url!,
                            isUploading: false,
                            uploadPromise: undefined,
                          };
                        }
                        return prev;
                      });
                    } else {
                      const errorMessage = (uploadResult && typeof uploadResult === 'object' && uploadResult.error) ? uploadResult.error : '视频上传失败';
                      throw new Error(errorMessage);
                    }
                  } catch (error: any) {
                    console.error('[Workspace] 等待视频上传失败:', error);
                    showAlert(error.message || '视频上传失败，请稍后重试');
                    setCharacterInputPanelData((prev) => prev ? { ...prev, isUploading: false, uploadPromise: undefined } : null);
                    return;
                  }
                }

                // 检查 videoUrl 是否有效
                if (!finalVideoUrl.trim()) {
                  showAlert('视频 URL 为空，请等待视频上传完成或手动输入视频 URL');
                  return;
                }

                // 本地视频必须先上传到 OSS 获取链接后再生成，禁止使用本地路径
                if (finalVideoUrl.startsWith('local-resource://') || finalVideoUrl.startsWith('file://')) {
                  showAlert('检测到本地视频，请先点击「确认上传视频」上传到云端获取链接后再创建角色。');
                  return;
                }

                // 设置上传状态（用于 uploadCharacterVideo）
                setCharacterInputPanelData((prev) => prev ? { ...prev, isUploading: true } : null);

                // 更新进度函数
                const updateProgress = (progress: number, message: string) => {
                  setNodes((nds) =>
                    nds.map((node) =>
                      node.id === characterInputPanelData.nodeId
                        ? { ...node, data: { ...node.data, progress, progressMessage: message } }
                        : node
                    )
                  );
                };
                
                // 启动进度更新循环（模拟进度）
                const startTime = Date.now();
                // 文字轮播消息列表
                const progressMessages = [
                  '正在生成...',
                  '处理中...',
                  '思考中...',
                  '解析中...',
                  '正在创作...',
                  '生成内容中...',
                  '正在组织语言...',
                ];
                
                // 获取轮播消息的函数（每 1.5 秒切换一次）
                const getRotatingMessage = () => {
                  const elapsed = Date.now() - startTime;
                  const interval = 1500; // 每 1.5 秒切换一次
                  const index = Math.floor(elapsed / interval) % progressMessages.length;
                  return progressMessages[index];
                };
                
                const progressInterval = setInterval(() => {
                  const elapsed = Date.now() - startTime;
                  let progress = 0;
                  
                  // 第一阶段：快速冲到 70%（5秒内）
                  if (elapsed < 5000) {
                    progress = Math.min(70, (elapsed / 5000) * 70);
                  }
                  // 第二阶段：缓慢增长到 99%（10秒内）
                  else if (elapsed < 15000) {
                    const phase2Elapsed = elapsed - 5000;
                    progress = 70 + (phase2Elapsed / 10000) * 29;
                  }
                  // 到达 99%
                  else {
                    progress = 99;
                  }
                  
                  updateProgress(Math.floor(progress), getRotatingMessage());
                }, 200);

                try {
                  if (!window.electronAPI) {
                    throw new Error('electronAPI 未就绪');
                  }

                  // 更新进度：开始上传角色视频
                  updateProgress(20, '正在上传角色视频...');
                  
                  // 上传角色视频（使用等待后的 OSS URL）
                  const channel = characterInputPanelData.characterChannel || 'core';
                  console.log('[Workspace] 开始上传角色视频，URL:', finalVideoUrl, 'channel:', channel);
                  const timestamp = characterInputPanelData.timestamp || '1,3';
                  const uploadResult = await window.electronAPI.uploadCharacterVideo(finalVideoUrl, timestamp, channel);
                  
                  // 严格验证 uploadResult 是否存在且格式正确
                  if (!uploadResult || typeof uploadResult !== 'object') {
                    throw new Error('上传角色视频失败：返回结果无效');
                  }
                  
                  // 从上传结果中提取 roleId
                  const roleId = uploadResult.roleId;
                  
                  // 更新进度：开始截取视频第一帧
                  updateProgress(50, '正在截取视频第一帧...');
                  
                  // 截取视频第一帧作为头像
                  let characterAvatar = '';
                  try {
                    console.log('[Workspace] 开始截取视频第一帧，URL:', finalVideoUrl);
                    const frameResult = await extractVideoFirstFrame(finalVideoUrl);
                    if (frameResult && frameResult.success && frameResult.imageUrl) {
                      // 更新进度：开始上传头像
                      updateProgress(70, '正在上传头像...');
                      
                      // 上传截取的帧到 OSS
                      const avatarUploadResult = await window.electronAPI.uploadImageToOSS(frameResult.imageUrl);
                      // 严格验证 avatarUploadResult 是否存在且格式正确
                      if (avatarUploadResult && typeof avatarUploadResult === 'object' && avatarUploadResult.success && avatarUploadResult.url) {
                        characterAvatar = avatarUploadResult.url;
                        console.log('[Workspace] 视频第一帧上传到 OSS 成功，头像 URL:', characterAvatar);
                      } else {
                        console.warn('[Workspace] 视频第一帧上传到 OSS 失败，使用默认头像。返回结果:', avatarUploadResult);
                      }
                    } else {
                      console.warn('[Workspace] 截取视频第一帧失败，使用默认头像。返回结果:', frameResult);
                    }
                  } catch (error) {
                    console.error('[Workspace] 截取视频第一帧时出错:', error);
                  }
                  
                  // 如果没有截取到头像，使用返回的 URL 作为头像
                  if (!characterAvatar) {
                    characterAvatar = uploadResult.url || '';
                  }
                  
                  // 核心算力返回的 username 作为角色名称，否则用用户输入的 nickname
                  const characterName = uploadResult.username || characterInputPanelData.nickname || '未命名角色';

                  // 更新进度：开始创建角色
                  updateProgress(90, '正在创建角色...');

                  // 创建角色（包含 roleId、permalink、username，核心算力角色可点击卡片跳转主页）
                  const permalink = uploadResult.permalink;
                  const newCharacter = await window.electronAPI.createCharacter(
                    characterName,
                    characterName,
                    characterAvatar,
                    roleId,
                    permalink
                  );

                  // 更新进度：完成
                  clearInterval(progressInterval);
                  updateProgress(100, '角色创建完成！');
                  
                  // 更新节点数据（包含 roleId）
                  handleCharacterNodeDataChange(characterInputPanelData.nodeId, {
                    nickname: newCharacter.nickname,
                    name: newCharacter.name,
                    username: (newCharacter as { username?: string }).username ?? newCharacter.nickname,
                    avatar: newCharacter.avatar,
                    roleId: newCharacter.roleId,
                    progress: 0, // 清除进度
                    progressMessage: undefined,
                  });
                  
                  // 触发角色列表刷新
                  setCharacterListRefreshTrigger((prev) => prev + 1);
                  
                  // 延迟清除进度显示
                  setTimeout(() => {
                    setNodes((nds) =>
                      nds.map((node) =>
                        node.id === characterInputPanelData.nodeId
                          ? { ...node, data: { ...node.data, progress: 0, progressMessage: undefined } }
                          : node
                      )
                    );
                  }, 500);
                } catch (err: any) {
                  console.error('创建角色失败:', err);
                  clearInterval(progressInterval);
                  // 显示错误信息
                  setNodes((nds) =>
                    nds.map((node) =>
                      node.id === characterInputPanelData.nodeId
                        ? { 
                            ...node, 
                            data: { 
                              ...node.data, 
                              progress: 0, 
                              progressMessage: undefined,
                              errorMessage: err.message || '创建角色失败，请稍后重试'
                            } 
                          }
                        : node
                    )
                  );
                  showAlert(err.message || '创建角色失败，请稍后重试');
                } finally {
                  // 清除上传状态
                  setCharacterInputPanelData((prev) => prev ? { ...prev, isUploading: false } : null);
                }
              }}
            />
          </div>
        )}



        {!previewImage && !previewAudio && !characterAvatarPickOverlay && rvcTrainInputPanelData && selectedNode && selectedNode.type === 'rvcTrain' && (
          <div className="nodrag nopan absolute z-50 animate-slide-up" style={{ width: '840px', height: '242px', left: 'calc(50% - 420px)', bottom: '21.25px', pointerEvents: 'auto' }}>
            <RvcTrainInputPanel
              nodeId={rvcTrainInputPanelData.nodeId}
              isDarkMode={isDarkMode}
              projectId={projectId}
              rvcTrainModelName={rvcTrainInputPanelData.rvcTrainModelName ?? ''}
              referenceAudioUrl={rvcTrainInputPanelData.referenceAudioUrl ?? ''}
              libraryAvatarUrl={rvcTrainInputPanelData.libraryAvatarUrl ?? ''}
              onStart={() =>
                invokeRvcTrainNodeDataChange(rvcTrainInputPanelData.nodeId, {
                  aiStatus: 'START',
                  progress: 1,
                  errorMessage: undefined,
                })
              }
              onRvcTrainModelNameChange={(value) => {
                invokeRvcTrainNodeDataChange(rvcTrainInputPanelData.nodeId, { rvcTrainModelName: value });
              }}
              onReferenceAudioUrlChange={(url) => {
                invokeRvcTrainNodeDataChange(rvcTrainInputPanelData.nodeId, { referenceAudioUrl: url });
              }}
              onLibraryAvatarUrlChange={(url) => {
                invokeRvcTrainNodeDataChange(rvcTrainInputPanelData.nodeId, { libraryAvatarUrl: url || undefined });
              }}
              requestAvatarPickFromCanvas={
                requestViewSlotPickFromCanvas ? () => requestViewSlotPickFromCanvas(0) : undefined
              }
              onError={(message) => {
                invokeRvcTrainNodeDataChange(rvcTrainInputPanelData.nodeId, {
                  aiStatus: 'ERROR',
                  errorMessage: message,
                  progress: 0,
                  progressMessage: undefined,
                });
              }}
            />
          </div>
        )}


      </div>
    </div>
  );
};

export default Workspace;
