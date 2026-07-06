import React, { useState, useRef, useEffect, useCallback, memo, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Handle, Position, NodeProps, Node, useStore, useReactFlow, useUpdateNodeInternals } from 'reactflow';
import { Loader2, Scissors, Upload, Video, Download, Play, Pause, Film, Eraser, X, Check, ChevronDown, LayoutGrid, Maximize2, Volume2 } from 'lucide-react';
import { videoInputPanelT } from '../../i18n/videoInputPanelI18n';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import { ModuleProgressBar } from './ModuleProgressBar';
import { VideoPreview, type VideoPreviewRef } from '../VideoPreview';
import { useViewportIntersection } from '../../hooks/useViewportIntersection';
import { normalizeVideoUrl } from '../../utils/normalizeVideoUrl';
import {
  aspectRatioLabelFromPixelSize,
  computeNodeSizeFromMedia,
  IMAGE_NODE_MIN_W,
  IMAGE_NODE_MIN_H,
  IMAGE_NODE_MAX_W,
  IMAGE_NODE_MAX_H,
  nodeStyleDimensions,
  NODE_SIZE_TRANSITION,
  snapToVideoPanelAspectRatio,
} from '../../utils/nodeSizeFromAspectRatio';
import {
  registerVideoNodePlaybackReader,
  unregisterVideoNodePlaybackReader,
} from '../../utils/videoPlaybackTimeRegistry';
import { enqueueImageLoad, calcViewportPriority, isImageLoadedInSession, markImageLoadedInSession } from '../../utils/imageLoadPriorityQueue';
import { useGlobalInteraction, useGlobalInteractionSelector, setHoveredVideoNodeId, setActiveVideoNodeId, scheduleClearActiveVideoNodeId } from '../../utils/globalInteractionStore';
import { FAR_PLACEHOLDER_HYSTERESIS, LOD_HYSTERESIS, MAX_DECODERS } from '../../config/renderPerfConstants';
import { VIEWPORT_UNMOUNT_DELAY_MS, VIEWPORT_REDUNDANT_PADDING, LOD_HYSTERESIS_LARGE } from '../../config/videoVisualConstants';
import { TAPNOW_INTERACTION_SUSPEND } from '../../config/perfPolicy';
import { recordAbortEvent } from '../../utils/abortStats';
import {
  isVideoPlaybackPerfDebugEnabled,
  recordPlaybackPersistCall,
  recordVideoNodeRender,
} from '../../utils/videoPlaybackPerfStats';
import { mapProjectPath } from '../../utils/pathMapper';
import {
  userFacingErrorMessage,
  refundHintForLocale,
  messageContainsRefundHint,
  isLocalOnlineVideoImportError,
} from '../../utils/userErrorMessageCn';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { workspaceChromeT } from '../../i18n/workspaceI18n';
import { dispatchCanvasPickNode, isCanvasPickDigitalHumanVideoTarget } from '../../utils/canvasPickStore';
import { useNxModelPricing } from '../../contexts/NxModelPricingContext';
import { getVideoWatermarkRemovalDisplayPrice } from '../../utils/cloudModelPricing';
import { assetLibBtnPrimary, assetLibBtnSecondary, nodeFloatToolBtn } from '../../utils/assetLibraryChrome';
import {
  VIDEO_FRAME_SPLIT_INTERVALS,
  VideoFrameSplitIntervalSec,
  buildVideoFrameTimestamps,
  dataUrlToArrayBuffer,
  extractVideoFramesAtTimes,
  probeVideoDuration,
  probeVideoPixelSize,
} from '../../utils/extractVideoFrame';

const ZOOM_THRESHOLD_ICON_ONLY = 0.08;
const ZOOM_THRESHOLD_FAR = 0.1;
const ZOOM_THRESHOLD_NEAR = 0.5;
/** 视口外扩边距（兼容旧逻辑），冗余区使用 VIEWPORT_REDUNDANT_PADDING */
const VIEWPORT_PADDING = VIEWPORT_REDUNDANT_PADDING;
const VIDEO_FADE_DURATION = 0.5;
const VIDEO_HOVER_FADE_DURATION = 0.18;
const DEFAULT_FAST_MOVE_SPEED_THRESHOLD = 3000;
const DEFAULT_ULTRA_NEAR_ZOOM_THRESHOLD = 0.8;
const DEFAULT_FPS_DROP_THRESHOLD = 38;
const DEFAULT_PREFETCH_SCREEN_FACTOR = 0.5;
const PREFETCH_DIRECTION_LOCK_MS = 150;
const PREFETCH_SECTOR_COS = 0.7071; // 90° 扇形（±45°）
const FOCUS_EASE: [number, number, number, number] = [0.4, 0, 0.2, 1];
const LOW_RES_TRANSITION = 'opacity 220ms cubic-bezier(0.22, 1, 0.36, 1), filter 220ms cubic-bezier(0.22, 1, 0.36, 1)';
/** 与主进程 `videoScraper.ts` 中 `YOUTUBE_SCRAPE_PROXY_GUIDE_MARKER` 保持一致 */
const YOUTUBE_SCRAPE_PROXY_GUIDE_MARKER = '[[NX:SHOW_PROXY_SETTING_UI]]';
const MAX_VIDEO_FRAME_SPLIT_COUNT = 100;

function resolveFrameSplitPixelSize(
  ...candidates: Array<{ width?: number; height?: number } | undefined>
): { width: number; height: number } | null {
  for (const c of candidates) {
    const w = Number(c?.width);
    const h = Number(c?.height);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return { width: w, height: h };
    }
  }
  return null;
}

function formatSplitFrameImagePath(path: string): string {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) return path;
  if (path.startsWith('local-resource://')) return path;
  const cleanPath = path.replace(/^(file:\/\/|local-resource:\/\/)/, '');
  let normalizedPath = cleanPath.replace(/\\/g, '/');
  if (normalizedPath.match(/^([a-zA-Z])\//)) {
    normalizedPath = normalizedPath[0].toUpperCase() + ':' + normalizedPath.substring(1);
  }
  return `local-resource://${normalizedPath}`;
}

function formatVideoClock(s: number) {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

const VideoPlaybackControlsBar: React.FC<{
  isDarkMode: boolean;
  isPlaying: boolean;
  currentTime: number;
  displayDuration: number;
  volume: number;
  videoPreviewRef: React.RefObject<VideoPreviewRef>;
  setCurrentTime: (t: number) => void;
  onTogglePlay: () => void;
  onVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
}> = ({
  isDarkMode,
  isPlaying,
  currentTime,
  displayDuration,
  volume,
  videoPreviewRef,
  setCurrentTime,
  onTogglePlay,
  onVolumeChange,
  className = '',
}) => (
  <>
    <style>{`
      .nexflow-video-mini-range {
        -webkit-appearance: none;
        appearance: none;
        height: 3px;
        border-radius: 999px;
        background: ${isDarkMode ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'};
        outline: none;
      }
      .nexflow-video-mini-range::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #a78bfa;
        border: none;
        box-shadow: 0 0 0 2px ${isDarkMode ? 'rgba(10,10,12,0.9)' : 'rgba(255,255,255,0.95)'};
        cursor: pointer;
      }
      .nexflow-video-mini-range::-moz-range-thumb {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #a78bfa;
        border: none;
        cursor: pointer;
      }
      .nexflow-video-mini-range:disabled {
        opacity: 0.45;
      }
    `}</style>
    <div
      className={`nodrag nopan flex w-full flex-col gap-1 ${className}`}
      style={{ pointerEvents: 'all' }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onTogglePlay();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={`nodrag shrink-0 bg-transparent p-0 transition-opacity ${
            isDarkMode ? 'text-violet-300/90 hover:text-violet-200' : 'text-violet-600 hover:text-violet-700'
          }`}
          title={isPlaying ? '暂停' : '播放'}
          aria-label={isPlaying ? '暂停' : '播放'}
        >
          {isPlaying ? (
            <Pause className="h-3.5 w-3.5" strokeWidth={2.25} />
          ) : (
            <Play className="ml-px h-3.5 w-3.5" strokeWidth={2.25} />
          )}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(displayDuration, 0.01)}
          step={0.01}
          value={currentTime}
          disabled={displayDuration <= 0}
          onChange={(e) => {
            e.stopPropagation();
            const newTime = parseFloat(e.target.value);
            videoPreviewRef.current?.seekTo(newTime);
            setCurrentTime(newTime);
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className={`nexflow-video-mini-range nodrag min-w-0 flex-1 ${displayDuration > 0 ? 'cursor-pointer' : 'cursor-not-allowed'}`}
          aria-label="播放进度"
          title="点击或拖拽选择播放位置"
        />
      </div>
      <div className="flex items-center justify-between gap-2 pl-5">
        <span className={`text-[10px] font-mono tabular-nums ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>
          {formatVideoClock(currentTime)}
          {displayDuration > 0 ? ` / ${formatVideoClock(displayDuration)}` : ''}
        </span>
        <div
          className="nodrag flex shrink-0 items-center gap-1"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Volume2 className={`h-3 w-3 ${isDarkMode ? 'text-white/40' : 'text-gray-500'}`} />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={onVolumeChange}
            className="nexflow-video-mini-range w-14 cursor-pointer"
            aria-label="音量"
            title="音量"
          />
        </div>
      </div>
    </div>
  </>
);

function VideoPlaceholder({ isDarkMode }: { isDarkMode: boolean }) {
  return (
    <div
      className={`w-full h-full flex items-center justify-center rounded-lg animate-pulse ${
        isDarkMode ? 'bg-slate-700/45 text-white/60' : 'bg-slate-300/55 text-gray-600'
      }`}
      title="缩放过小或不在视口内，不渲染视频以保护 GPU"
    >
      <Video className="w-10 h-10 opacity-60" />
    </div>
  );
}

// 标准化视频 URL：将 file:// 转换为 local-resource://
// 使用统一的 normalizeVideoUrl 函数
const normalizeVideoUrlForNode = (url: string): string => {
  if (!url) return url;
  return normalizeVideoUrl(url);
};

// 视频裁剪双指针进度条（与 AudioNode TrimRangeBar 一致）
const VideoTrimRangeBar: React.FC<{
  duration: number;
  currentTime: number;
  trimStart: number;
  trimEnd: number;
  isDarkMode: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  setCurrentTime: (t: number) => void;
  onTrimRangeChange: (start: number, end: number) => void;
}> = ({ duration, currentTime, trimStart, trimEnd, isDarkMode, videoRef, setCurrentTime, onTrimRangeChange }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<'start' | 'end' | null>(null);
  const trimRef = useRef({ start: trimStart, end: trimEnd });
  trimRef.current = { start: trimStart, end: trimEnd };

  const clamp = (v: number) => Math.max(0, Math.min(duration, v));
  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0);

  const getTimeFromClientX = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    return clamp(x * duration);
  }, [duration]);

  const handleTrackClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current) return;
    const t = getTimeFromClientX(e.clientX);
    videoRef.current.currentTime = t;
    setCurrentTime(t);
  }, [videoRef, getTimeFromClientX, setCurrentTime]);

  const handleThumbPointerDown = useCallback((which: 'start' | 'end') => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    draggingRef.current = which;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handleThumbPointerMove = useCallback((e: React.PointerEvent) => {
    const which = draggingRef.current;
    if (!which) return;
    const t = getTimeFromClientX(e.clientX);
    const { start, end } = trimRef.current;
    if (which === 'start') {
      onTrimRangeChange(clamp(t), Math.max(clamp(t), end));
    } else {
      onTrimRangeChange(Math.min(clamp(t), start), clamp(t));
    }
  }, [getTimeFromClientX, onTrimRangeChange]);

  const handleThumbPointerUp = useCallback(() => {
    draggingRef.current = null;
  }, []);

  const trackBg = isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
  const selectedColor = isDarkMode ? '#a78bfa' : '#7c3aed';
  const playedColor = isDarkMode ? 'rgba(167, 139, 250, 0.42)' : 'rgba(124, 58, 237, 0.32)';

  return (
    <div
      ref={trackRef}
      role="group"
      aria-label="裁剪范围与播放进度"
      title="拖拽前后指针选择裁剪区间，点击轨道跳转播放位置"
      className="nodrag nopan relative h-2.5 w-full rounded-full cursor-pointer select-none"
      style={{ background: trackBg }}
      onClick={(e) => { e.stopPropagation(); handleTrackClick(e); }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="absolute inset-y-0 left-0 rounded-l-full pointer-events-none" style={{ width: `${pct(Math.min(currentTime, trimStart))}%`, background: playedColor }} />
      <div className="absolute inset-y-0 pointer-events-none rounded-full" style={{ left: `${pct(trimStart)}%`, width: `${pct(trimEnd - trimStart)}%`, background: selectedColor, opacity: 0.85 }} />
      {currentTime > trimStart && currentTime < trimEnd && (
        <div className="absolute inset-y-0 pointer-events-none rounded-l-full" style={{ left: `${pct(trimStart)}%`, width: `${pct(currentTime - trimStart)}%`, background: playedColor }} />
      )}
      <div
        className="absolute top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 cursor-ew-resize rounded-full border-2 border-white/90 shadow-md nodrag nopan ring-2 ring-violet-400/30"
        style={{ left: `calc(${pct(trimStart)}% - 7px)`, background: selectedColor }}
        onPointerDown={handleThumbPointerDown('start')}
        onPointerMove={handleThumbPointerMove}
        onPointerUp={handleThumbPointerUp}
        onPointerLeave={handleThumbPointerUp}
      />
      <div
        className="absolute top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 cursor-ew-resize rounded-full border-2 border-white/90 shadow-md nodrag nopan ring-2 ring-violet-400/30"
        style={{ left: `calc(${pct(trimEnd)}% - 7px)`, background: selectedColor }}
        onPointerDown={handleThumbPointerDown('end')}
        onPointerMove={handleThumbPointerMove}
        onPointerUp={handleThumbPointerUp}
        onPointerLeave={handleThumbPointerUp}
      />
      {duration > 0 && (
        <div
          className="pointer-events-none absolute top-1/2 z-[5] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
          style={{ left: `${pct(currentTime)}%` }}
        />
      )}
    </div>
  );
};

// 全屏背景虚化的视频裁剪专属弹窗
const VideoTrimModal: React.FC<{
  videoUrl: string;
  isDarkMode: boolean;
  initialTrimStart: number;
  initialTrimEnd: number;
  onConfirm: (trimStart: number, trimEnd: number) => void;
  onCancel: () => void;
  trimming: boolean;
  trimError?: string | null;
}> = ({ videoUrl, isDarkMode, initialTrimStart, initialTrimEnd, onConfirm, onCancel, trimming, trimError }) => {
  const modalVideoRef = React.useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [trimStart, setTrimStart] = useState(initialTrimStart);
  const [trimEnd, setTrimEnd] = useState(initialTrimEnd);
  const [isPlaying, setIsPlaying] = useState(false);

  const playbackUrl = useMemo(() => normalizeVideoUrlForNode(videoUrl), [videoUrl]);

  useEffect(() => {
    setTrimStart(initialTrimStart);
    setTrimEnd(initialTrimEnd);
  }, [initialTrimStart, initialTrimEnd]);

  useEffect(() => {
    if (duration > 0 && (trimEnd <= 0 || trimEnd > duration)) {
      setTrimEnd(duration);
    }
  }, [duration, trimEnd]);

  const formatTime = (s: number) => {
    if (isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const togglePlay = useCallback(() => {
    const el = modalVideoRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
      return;
    }
    const inTrim = trimEnd > trimStart;
    if (inTrim && (el.currentTime < trimStart || el.currentTime >= trimEnd)) {
      el.currentTime = trimStart;
      setCurrentTime(trimStart);
    }
    el.play().then(() => setIsPlaying(true)).catch(() => {});
  }, [isPlaying, trimStart, trimEnd]);

  const handleTrimChange = useCallback((start: number, end: number) => {
    setTrimStart(start);
    setTrimEnd(end);
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm(trimStart, trimEnd);
  }, [trimStart, trimEnd, onConfirm]);

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-md"
      onClick={(e) => { if (e.target === e.currentTarget && !trimming) onCancel(); }}
    >
      <div
        className={`mx-4 w-full max-w-2xl overflow-hidden rounded-2xl shadow-2xl ${
          isDarkMode ? 'nexflow-glass-panel border border-white/10' : 'bg-white border border-gray-200'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`flex items-center justify-between gap-3 border-b px-4 py-3 ${
            isDarkMode ? 'border-white/10 text-white' : 'border-gray-200/80 text-gray-900'
          }`}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Film className={`h-4 w-4 shrink-0 ${isDarkMode ? 'text-violet-300' : 'text-violet-600'}`} />
              <h3 className="text-sm font-semibold">视频裁剪</h3>
            </div>
            <p className={`mt-1 text-[11px] ${isDarkMode ? 'text-white/45' : 'text-gray-500'}`}>
              拖拽前后指针选择裁剪区间，点击轨道可跳转播放位置
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={trimming}
            className={nodeFloatToolBtn(isDarkMode, false, 'shrink-0 disabled:opacity-40')}
            title="关闭"
            aria-label="关闭"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-4">
          <div className={`overflow-hidden rounded-xl p-1 ${isDarkMode ? 'apple-panel' : 'apple-panel-light'}`}>
            <video
              ref={modalVideoRef}
              src={playbackUrl}
              preload="metadata"
              playsInline
              muted={false}
              crossOrigin={playbackUrl.startsWith('http') ? 'anonymous' : undefined}
              className="aspect-video w-full rounded-lg bg-black"
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration;
                setDuration(d);
                if (trimEnd <= 0 || trimEnd > d) setTrimEnd(d);
              }}
              onTimeUpdate={(e) => {
                const t = e.currentTarget.currentTime;
                if (trimEnd > trimStart && t >= trimEnd) {
                  e.currentTarget.pause();
                  e.currentTarget.currentTime = trimEnd;
                  setCurrentTime(trimEnd);
                  setIsPlaying(false);
                } else {
                  setCurrentTime(t);
                }
              }}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => {
                setIsPlaying(false);
                setCurrentTime(trimEnd > trimStart ? trimEnd : 0);
              }}
            />
          </div>

          <div
            className={`flex items-center gap-2 rounded-lg px-2.5 py-2.5 ${
              isDarkMode ? 'apple-panel' : 'apple-panel-light'
            }`}
          >
            <button
              type="button"
              onClick={togglePlay}
              className={`${nodeFloatToolBtn(isDarkMode, isPlaying, 'h-10 w-10 !p-0 flex shrink-0 items-center justify-center')}`}
              title={isPlaying ? '暂停' : '播放'}
              aria-label={isPlaying ? '暂停' : '播放'}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
            </button>
            <div className="min-w-0 flex-1">
              <VideoTrimRangeBar
                duration={duration}
                currentTime={currentTime}
                trimStart={trimStart}
                trimEnd={trimEnd}
                isDarkMode={isDarkMode}
                videoRef={modalVideoRef}
                setCurrentTime={setCurrentTime}
                onTrimRangeChange={handleTrimChange}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`text-[11px] tabular-nums ${isDarkMode ? 'text-white/55' : 'text-gray-600'}`}>
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
            <span className={`text-[11px] tabular-nums ${isDarkMode ? 'text-violet-200/80' : 'text-violet-700'}`}>
              裁剪 {formatTime(trimStart)} – {formatTime(trimEnd)}
            </span>
          </div>

          {trimError ? <div className="text-xs text-red-400">{trimError}</div> : null}
        </div>

        <div
          className={`flex justify-end gap-1.5 border-t px-4 py-3 ${
            isDarkMode ? 'border-white/10' : 'border-gray-200/80'
          }`}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={trimming}
            className={assetLibBtnSecondary(isDarkMode, 'disabled:opacity-50')}
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={trimming || trimEnd <= trimStart}
            className={assetLibBtnPrimary(isDarkMode, 'disabled:opacity-50 disabled:cursor-not-allowed')}
          >
            {trimming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {trimming ? '裁剪中...' : '确认'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

/** B 站链接输入（与底部面板解耦，在节点上与裁剪并列） */
const VideoBilibiliGrabModal: React.FC<{
  isDarkMode: boolean;
  urlDraft: string;
  onUrlDraftChange: (v: string) => void;
  modalTitle: string;
  placeholder: string;
  confirmLabel: string;
  cancelLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({
  isDarkMode,
  urlDraft,
  onUrlDraftChange,
  modalTitle,
  placeholder,
  confirmLabel,
  cancelLabel,
  onCancel,
  onConfirm,
}) =>
  createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-xl"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className={`w-full max-w-lg mx-4 overflow-hidden shadow-2xl shadow-black/40 ${
          isDarkMode
            ? 'rounded-[20px] border border-white/[0.08] bg-[#141418]'
            : 'rounded-[20px] border border-gray-200 bg-white'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`px-6 pt-6 pb-5 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
          <div className="mb-5 flex items-center gap-2.5">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                isDarkMode ? 'bg-violet-500/15 text-violet-400' : 'bg-violet-100 text-violet-600'
              }`}
            >
              <Download className="h-5 w-5" strokeWidth={2.25} aria-hidden />
            </span>
            <h3 className="text-base font-semibold tracking-tight">{modalTitle}</h3>
          </div>
          <input
            type="url"
            autoFocus
            value={urlDraft}
            onChange={(e) => onUrlDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onConfirm();
              }
            }}
            placeholder={placeholder}
            className={`w-full rounded-xl border px-3.5 py-3 text-sm outline-none transition-colors focus:border-violet-500/50 ${
              isDarkMode
                ? 'border-white/[0.12] bg-black/35 text-white placeholder:text-white/35'
                : 'border-gray-300 bg-gray-50 text-gray-900 placeholder:text-gray-400 focus:border-violet-400'
            }`}
          />
        </div>
        <div
          className={`flex justify-end gap-3 border-t px-6 py-4 ${
            isDarkMode ? 'border-white/[0.08]' : 'border-gray-200'
          }`}
        >
          <button
            type="button"
            onClick={onCancel}
            className={`rounded-xl px-5 py-2.5 text-sm font-medium transition-colors ${
              isDarkMode
                ? 'bg-white/[0.08] text-white/80 hover:bg-white/[0.12] hover:text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-w-[88px] rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-900/30 transition-colors hover:bg-violet-500"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );

/** YouTube 网络不可达：仅一行提示，不展示长说明 */
const VideoGrabProxyGuideModal: React.FC<{
  isDarkMode: boolean;
  title: string;
  okLabel: string;
  onDismiss: () => void;
}> = ({ isDarkMode, title, okLabel, onDismiss }) =>
  createPortal(
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/70 backdrop-blur-xl"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        className={`w-full max-w-md mx-4 overflow-hidden shadow-2xl shadow-black/40 ${
          isDarkMode
            ? 'rounded-[20px] border border-white/[0.08] bg-[#141418]'
            : 'rounded-[20px] border border-gray-200 bg-white'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`px-6 py-8 text-center ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
          <h3 className="text-base font-semibold leading-relaxed tracking-tight">{title}</h3>
        </div>
        <div
          className={`flex justify-center border-t px-6 py-4 ${
            isDarkMode ? 'border-white/[0.08]' : 'border-gray-200'
          }`}
        >
          <button
            type="button"
            onClick={onDismiss}
            className="min-w-[88px] rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-400"
          >
            {okLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );

const prefetchedVideoMeta = new Map<string, true>();
const inflightVideoMeta = new Map<string, Promise<void>>();
const fallbackPosterCache = new Map<string, string>();

/** 纹理级缓存：视频播放过的最后一帧，快速缩放时优先显示 */
const videoLastFrameCache = new Map<string, string>();
export function getVideoLastFrame(url: string): string | undefined {
  return videoLastFrameCache.get(url);
}
export function setVideoLastFrame(url: string, dataUrl: string) {
  videoLastFrameCache.set(url, dataUrl);
}
function prefetchVideoMetadata(src: string, signal?: AbortSignal): Promise<void> {
  if (!src) return Promise.resolve();
  if (prefetchedVideoMeta.has(src)) return Promise.resolve();
  const inflight = inflightVideoMeta.get(src);
  if (inflight) return inflight;
  const task = new Promise<void>((resolve) => {
    try {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      let settled = false;
      const cleanup = () => {
        video.onloadedmetadata = null;
        video.onerror = null;
        video.removeAttribute('src');
        video.load();
      };
      const finalize = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const onDone = () => {
        prefetchedVideoMeta.set(src, true);
        finalize();
      };
      const onErr = () => {
        finalize();
      };
      const onAbort = () => {
        recordAbortEvent(1);
        finalize();
      };
      video.onloadedmetadata = onDone;
      video.onerror = onErr;
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
      video.src = src;
    } catch {
      resolve();
    }
  });
  inflightVideoMeta.set(src, task);
  return task.finally(() => {
    if (inflightVideoMeta.get(src) === task) inflightVideoMeta.delete(src);
  });
}

/** 按播放时间分桶缓存静帧，便于显示「当前进度」而非仅首帧 */
function frameCacheKey(src: string, timeSec?: number): string {
  if (!src) return '';
  if (timeSec == null || !Number.isFinite(timeSec) || timeSec <= 0.05) return src;
  const bucket = Math.round(timeSec * 2) / 2;
  return `${src}@t:${bucket.toFixed(1)}`;
}

async function capturePosterFromVideo(
  src: string,
  signal?: AbortSignal,
  timeSec?: number
): Promise<string> {
  if (!src) return '';
  const cacheKey = frameCacheKey(src, timeSec);
  const cached = fallbackPosterCache.get(cacheKey) ?? fallbackPosterCache.get(src);
  if (cached) return cached;
  return new Promise<string>((resolve) => {
    try {
      const video = document.createElement('video');
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      // local-resource:// / file:// 不能设 crossOrigin，否则会 CORS 失败导致黑屏
      if (!src.startsWith('local-resource://') && !src.startsWith('file://')) {
        video.crossOrigin = 'anonymous';
      }
      let settled = false;
      const finalize = (dataUrl: string) => {
        if (settled) return;
        settled = true;
        if (dataUrl) {
          fallbackPosterCache.set(cacheKey, dataUrl);
          if (cacheKey !== src) fallbackPosterCache.set(src, dataUrl);
        }
        try {
          video.pause();
          video.removeAttribute('src');
          video.load();
        } catch {}
        resolve(dataUrl);
      };
      const onAbort = () => finalize('');
      const onAbortWithStats = () => {
        recordAbortEvent(1);
        onAbort();
      };
      const draw = () => {
        try {
          const w = Math.max(1, video.videoWidth || 640);
          const h = Math.max(1, video.videoHeight || 360);
          const canvas = document.createElement('canvas');
          const ratio = w / h;
          const targetW = 640;
          const targetH = Math.max(1, Math.round(targetW / ratio));
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          if (!ctx) return finalize('');
          ctx.drawImage(video, 0, 0, targetW, targetH);
          finalize(canvas.toDataURL('image/jpeg', 0.72));
        } catch {
          finalize('');
        }
      };
      const drawAtPlaybackTime = () => {
        const want =
          timeSec != null && Number.isFinite(timeSec) && timeSec > 0.05 ? timeSec : 0;
        if (want > 0.05) {
          const d = video.duration;
          const target =
            Number.isFinite(d) && d > 0 ? Math.min(want, Math.max(0, d - 0.05)) : want;
          const onSeeked = () => {
            video.removeEventListener('seeked', onSeeked);
            draw();
          };
          video.addEventListener('seeked', onSeeked);
          try {
            video.currentTime = target;
          } catch {
            video.removeEventListener('seeked', onSeeked);
            draw();
          }
          return;
        }
        draw();
      };
      video.onloadeddata = () => drawAtPlaybackTime();
      video.onerror = () => finalize('');
      if (signal) {
        if (signal.aborted) {
          onAbortWithStats();
          return;
        }
        signal.addEventListener('abort', onAbortWithStats, { once: true });
      }
      video.src = src;
    } catch {
      resolve('');
    }
  });
}

interface VideoNodeData {
  _isResizing?: boolean;
  width?: number;
  height?: number;
  outputVideo?: string;
  originalVideoUrl?: string; // 原始远程 URL（备用）
  title?: string;
  prompt?: string;
  aspectRatio?: '16:9' | '9:16';
  model?: 'sora-2' | 'sora-2-pro' | 'kling-v2.6-pro' | 'wan-2.6' | 'wan-2.6-flash' | 'wan-animate' | 'gemini-omni' | 'seedance-2.0-fast' | 'seedance-2.0-mini' | 'ltx-2.3-lipsync' | 'ltx-2.3-i2v' | 'ltx-2.3-t2v' | 'ltx-2.3-hdr-multi' | 'rhart-v3.1-fast' | 'rhart-v3.1-fast-se' | 'rhart-v3.1-pro' | 'rhart-v3.1-pro-se' | 'grok-3' | 'grok-3-stable' | 'kling-video-o1' | 'kling-video-o1-i2v' | 'kling-video-o1-start-end' | 'kling-video-o1-ref' | 'rh-video-start-end';
  hd?: boolean;
  duration?: '5' | '10' | '15' | '25';
  shotType?: 'single' | 'multi';
  negativePrompt?: string;
  resolutionWan26?: '720p' | '1080p';
  resolutionWanAnimate?: '720p' | '1080p';
  wanAnimateClipSec?: '5' | '8' | '10' | '15';
  durationWan26Flash?: '2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'11'|'12'|'13'|'14'|'15';
  enableAudio?: boolean;
  resolutionRhartV31?: '720p' | '1080p' | '4k';
  inputImages?: string[]; // 图生视频参考图（高动态模型为分镜图）
  ltx23HdrBackgroundImage?: string;
  durationLtx23HdrMulti?: '5' | '10' | '15';
  resolutionLtx23HdrMulti?: '720' | '1280';
  progress?: number; // 视频生成进度 0-100
  progressMessage?: string; // 进度状态文案
  errorMessage?: string; // 错误信息
  videoAsset?: {
    poster?: string;
    ghost?: string;
    width?: number;
    height?: number;
  };
  /** 预览/播放器当前时间（秒），用于从视频节点导出「当前帧」 */
  playbackCurrentTimeSec?: number;
  /** 当前输出视频的真实时长（秒），供剪辑节点连线同步 */
  mediaDurationSec?: number;
  /** 从上游视频模块连线解析的参考视频 URL（与 Workspace videoInputPanelData 一致） */
  referenceVideoUrl?: string;
  /** 为 true 时 loadedmetadata 不自动改外框（如剪辑导出到画布） */
  preserveExportLayout?: boolean;
}

interface VideoNodeProps extends NodeProps<VideoNodeData> {
  projectId?: string;
  isDarkMode?: boolean;
  performanceMode?: boolean;
  onDataChange?: (nodeId: string, updates: Partial<VideoNodeData>) => void;
  /** 拆帧生成的图片节点须写入 Workspace 状态（勿仅用 useReactFlow().setNodes） */
  onAddFrameSplitNodes?: (nodes: Node[]) => void;
  interactionSettings?: {
    ultraNearZoomThreshold?: number;
    fpsDropThreshold?: number;
    interactionResumeDelayMs?: number;
    fastMoveSpeedThreshold?: number;
    prefetchScreenFactor?: number;
  };
}

const VideoNodeComponent: React.FC<VideoNodeProps> = (props) => {
  const {
    id,
    data,
    selected,
    projectId,
    isDarkMode = true,
    performanceMode = false,
    onDataChange,
    onAddFrameSplitNodes,
    interactionSettings,
    // 过滤 React Flow 内部属性，避免透传到 DOM
    xPos = 0,
    yPos = 0,
    dragging,
    zIndex: _zIndex,
    width: _width,
    height: _height,
    type: _type,
    targetPosition: _targetPosition,
    sourcePosition: _sourcePosition,
    position: _position,
    isConnectable: _isConnectable,
    dragHandle: _dragHandle,
    // 确保不会透传任何其他 React Flow 内部属性
  } = props as any;

  // 视频节点采用“最小尺寸下限 + 按素材比例自适应”的外框策略。
  // preserveExportLayout（库拖入/拆帧等）：与 Image 模块同尺度，允许小于 738px 的竖屏外框
  const useCompactLayout = !!data?.preserveExportLayout;
  /** 资产库拖入的参考成片：默认静帧 poster，仅悬停时挂载解码/播放 */
  const isLibraryReferenceVideo = useCompactLayout;
  const layoutMinW = useCompactLayout ? IMAGE_NODE_MIN_W : 738.91;
  const layoutMinH = useCompactLayout ? IMAGE_NODE_MIN_H : 422.22;
  const layoutMaxW = useCompactLayout ? IMAGE_NODE_MAX_W : 4096;
  const layoutMaxH = useCompactLayout ? IMAGE_NODE_MAX_H : 4096;
  const clampW = useCallback(
    (v: number) => Math.max(layoutMinW, Math.min(layoutMaxW, v)),
    [layoutMinW, layoutMaxW],
  );
  const clampH = useCallback(
    (v: number) => Math.max(layoutMinH, Math.min(layoutMaxH, v)),
    [layoutMinH, layoutMaxH],
  );
  const computeAdaptiveVideoSize = useCallback(
    (videoW?: number, videoH?: number) => {
      if (!videoW || !videoH || videoW <= 0 || videoH <= 0) {
        return { w: layoutMinW, h: layoutMinH };
      }
      if (useCompactLayout) {
        return computeNodeSizeFromMedia(videoW, videoH, layoutMinW, layoutMinH, layoutMaxW, layoutMaxH);
      }
      const scale = Math.max(layoutMinW / videoW, layoutMinH / videoH);
      return {
        w: clampW(Math.round(videoW * scale)),
        h: clampH(Math.round(videoH * scale)),
      };
    },
    [useCompactLayout, layoutMinW, layoutMinH, layoutMaxW, layoutMaxH, clampW, clampH],
  );

  const [size, setSize] = useState(() => ({
    w: Math.max(layoutMinW, Math.min(layoutMaxW, data?.width ?? layoutMinW)),
    h: Math.max(layoutMinH, Math.min(layoutMaxH, data?.height ?? layoutMinH)),
  }));
  // 验证视频 URL 是否是有效的视频文件，并将 file:// 格式转换为 local-resource://
  const isValidVideoUrl = (url: string): boolean => {
    if (!url) return false;
    const VIDEO_EXT_RE = /\.(mp4|webm|mov|avi|mkv)(?:$|[?#])/i;
    const AUDIO_EXT_RE = /\.(flac|mp3|wav|aac|m4a|ogg)(?:$|[?#])/i;
    // 远程 URL：避免把 flac/mp3 之类音频误判为视频
    if (/^https?:\/\//.test(url)) {
      if (AUDIO_EXT_RE.test(url)) return false;
      return VIDEO_EXT_RE.test(url) || !/\.[a-z0-9]+(?:$|[?#])/i.test(url);
    }
    // 本地文件需要检查扩展名
    const isVideoFile = VIDEO_EXT_RE.test(url);
    return isVideoFile;
  };


  const [outputVideo, setOutputVideo] = useState(() => {
    const url = data?.outputVideo || '';
    if (!url) return '';
    // 标准化 URL（将 file:// 转换为 local-resource://）
    const normalizedUrl = normalizeVideoUrlForNode(url);
    return isValidVideoUrl(normalizedUrl) ? normalizedUrl : '';
  });
  const [title, setTitle] = useState(data?.title || 'video');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isVideoAreaHovered, setIsVideoAreaHovered] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [isVideoVisible, setIsVideoVisible] = useState(false);
  const [videoStatus, setVideoStatus] = useState<'loading' | 'running' | 'finished'>('loading');
  const [fallbackPosterDataUrl, setFallbackPosterDataUrl] = useState('');
  const [localLastFrame, setLocalLastFrame] = useState<string | null>(null);
  /** false 时在 <video> 上层叠静帧，直到解码出真实画面，避免纯黑 */
  const [decodedFrameReady, setDecodedFrameReady] = useState(true);
  const [progress, setProgress] = useState(data?.progress || 0);
  const [errorMessage, setErrorMessage] = useState(data?.errorMessage || '');
  const [showTrimModal, setShowTrimModal] = useState(false);
  const [trimStartSec, setTrimStartSec] = useState('');
  const [trimEndSec, setTrimEndSec] = useState('');
  const [trimming, setTrimming] = useState(false);
  const [trimError, setTrimError] = useState<string | null>(null);
  const [showBilibiliModal, setShowBilibiliModal] = useState(false);
  const [bilibiliUrlDraft, setBilibiliUrlDraft] = useState('');
  const [bilibiliFetching, setBilibiliFetching] = useState(false);
  const [showGrabProxyGuide, setShowGrabProxyGuide] = useState(false);
  const { locale } = useAppLocale();
  const wc = workspaceChromeT(locale);
  const { showAlert } = useDarkAlert();
  const vt = useMemo(() => videoInputPanelT(locale), [locale]);
  const canUseBilibiliGrab = useMemo(
    () => typeof window !== 'undefined' && typeof window.electronAPI?.createVideoFromBilibiliPage === 'function',
    [],
  );
  const { getEdges, getNodes } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const { cloudMap } = useNxModelPricing();
  const videoWatermarkDisplayYuanbao = useMemo(() => getVideoWatermarkRemovalDisplayPrice(cloudMap, 1), [cloudMap]);
  const [isVideoWatermarkLoading, setIsVideoWatermarkLoading] = useState(false);
  const [videoWatermarkPriceHover, setVideoWatermarkPriceHover] = useState(false);
  const [splitFramesMenuHover, setSplitFramesMenuHover] = useState(false);
  const [splitFramesMenuOpen, setSplitFramesMenuOpen] = useState(false);
  const [isSplitFramesBusy, setIsSplitFramesBusy] = useState(false);
  const hasIncomingReferenceVideo = !!((data?.referenceVideoUrl || '') as string).trim();
  /** 订阅边变化：有来自 video / wanAnimate 的入边即显示去水印（不要求 data 已写入 referenceVideoUrl） */
  const hasIncomingVideoModuleEdge = useStore(
    useCallback(
      (s: { edges: { target: string; source: string }[]; nodeInternals: Map<string, { type?: unknown }> }) => {
        for (const ed of s.edges) {
          if (ed.target !== id) continue;
          const srcNode = s.nodeInternals?.get(ed.source);
          const t = srcNode?.type as string | undefined;
          if (t === 'video' || t === 'wanAnimate') return true;
        }
        return false;
      },
      [id],
    ),
  );

  const nodeRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  /** IntersectionObserver 视口裁剪：离开视口时强制销毁 video 并释放资源 */
  const isInViewportFromIO = useViewportIntersection(nodeRef, '1000px', 0);
  const videoPreviewRef = useRef<VideoPreviewRef>(null);
  const prevOutputVideoRef = useRef<string>(outputVideo);
  const posterLoadAbortRef = useRef<AbortController | null>(null);
  const posterCaptureAbortRef = useRef<AbortController | null>(null);
  const metadataPrefetchAbortRef = useRef<AbortController | null>(null);
  const velocitySampleRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const [isFastMoving, setIsFastMoving] = useState(false);
  const [isFpsDropped, setIsFpsDropped] = useState(false);
  const [lockedVelocity, setLockedVelocity] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const prefetchDebugAtRef = useRef(0);
  const readyVideoSrcSetRef = useRef<Set<string>>(new Set());
  /** 已对 url 做过首次帧捕获，避免重复 */
  const firstFrameCapturedForUrlRef = useRef<string | null>(null);
  const directionLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoDurationRef = useRef<number>(0);
  /** 与 <video>.currentTime 同步的进度（秒），不依赖 React state 落盘时机；再次挂载 VideoPreview 时优先用此值 seek */
  const lastPlaybackMediaTimeRef = useRef<number | undefined>(undefined);
  const prevResumeVideoUrlRef = useRef<string | undefined>(undefined);
  /** 与 ref 同步写入 React state，保证 VideoPreview 首帧能拿到「离开/拖动」后的进度（避免仅 ref 时子组件已跑 tryNudge） */
  const [resumePlaybackSec, setResumePlaybackSec] = useState<number | undefined>(undefined);
  const [externalPlaybackHeld, setExternalPlaybackHeld] = useState(false);
  const [uiCurrentTime, setUiCurrentTime] = useState(0);
  const [uiDuration, setUiDuration] = useState(0);
  const [uiVolume, setUiVolume] = useState(1);
  const [playerControlsHost, setPlayerControlsHost] = useState<HTMLElement | null>(null);
  const handlePreviewPlaybackTime = useCallback(
    (timeSec: number, durationSec?: number, immediate?: boolean) => {
      if (Number.isFinite(timeSec)) {
        lastPlaybackMediaTimeRef.current = timeSec;
        if (immediate) {
          setResumePlaybackSec(timeSec);
        }
      }
      if (durationSec != null && Number.isFinite(durationSec) && durationSec > 0) {
        videoDurationRef.current = durationSec;
      }
      // 播放过程中不写节点 data，避免 setNodes 触发整画布重渲染；仅在 pause/seek/ended/离开/全屏退出等 immediate 事件落盘
      if (!onDataChange || !immediate) return;
      recordPlaybackPersistCall('VideoNode.handlePreviewPlaybackTime');
      onDataChange(id, { playbackCurrentTimeSec: timeSec });
    },
    [id, onDataChange]
  );

  /** 供 Workspace 抽「当前帧」时读取实时 currentTime（避免仅读节点 data 被节流拖慢） */
  useEffect(() => {
    const read = (): number | undefined => {
      const live = videoPreviewRef.current?.getCurrentTimeSec?.();
      if (live != null && Number.isFinite(live)) return live;
      const r = lastPlaybackMediaTimeRef.current;
      if (typeof r === 'number' && Number.isFinite(r)) return r;
      return undefined;
    };
    registerVideoNodePlaybackReader(id, read);
    return () => unregisterVideoNodePlaybackReader(id);
  }, [id]);
  useEffect(() => {
    if (outputVideo !== prevOutputVideoRef.current) {
      videoDurationRef.current = 0;
    }
  }, [outputVideo]);
  const fastMoveSpeedThreshold = interactionSettings?.fastMoveSpeedThreshold ?? DEFAULT_FAST_MOVE_SPEED_THRESHOLD;
  const ultraNearZoomThreshold = interactionSettings?.ultraNearZoomThreshold ?? DEFAULT_ULTRA_NEAR_ZOOM_THRESHOLD;
  const fpsDropThreshold = interactionSettings?.fpsDropThreshold ?? DEFAULT_FPS_DROP_THRESHOLD;
  const prefetchScreenFactor = interactionSettings?.prefetchScreenFactor ?? DEFAULT_PREFETCH_SCREEN_FACTOR;

  // 使用视口快照，交互期间冻结，避免订阅 transform 导致缩放时重渲染
  const videoViewport = useGlobalInteractionSelector(
    (s) => s.videoViewportSnapshot,
    (a, b) => a.x === b.x && a.y === b.y && a.zoom === b.zoom
  );
  const zoom = videoViewport.zoom;
  const vx = videoViewport.x;
  const vy = videoViewport.y;
  const { isInteracting, isVisualInteractionLocked, velocityX, velocityY, perfLevel, emergencyVideoFreezeUntilMap, hoveredVideoNodeId, activeVideoNodeId } = useGlobalInteraction();
  const isViewportMoving = Math.hypot(velocityX, velocityY) > 1;
  const nodeInternals = useStore((s) => s.nodeInternals);
  const posterImage = data?.videoAsset?.poster || '';
  const ghostImage = data?.videoAsset?.ghost || '';
  const posterSrc = useMemo(() => (posterImage ? normalizeVideoUrlForNode(posterImage) : ''), [posterImage]);
  const effectivePosterSrc = posterSrc || fallbackPosterDataUrl;
  const hasPoster = !!effectivePosterSrc;
  const emergencyFreezeUntil = emergencyVideoFreezeUntilMap[id] || 0;
  const emergencyUnloadActive = emergencyFreezeUntil > Date.now();

  const isVisibleRef = useRef(true);
  const isVisible = useMemo(() => {
    if (isInteracting || (TAPNOW_INTERACTION_SUSPEND && isVisualInteractionLocked)) return isVisibleRef.current;
    const left = -vx / zoom - VIEWPORT_PADDING / zoom;
    const top = -vy / zoom - VIEWPORT_PADDING / zoom;
    const right = -vx / zoom + (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom + VIEWPORT_PADDING / zoom;
    const bottom = -vy / zoom + (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom + VIEWPORT_PADDING / zoom;
    const result = !(xPos + size.w < left || xPos > right || yPos + size.h < top || yPos > bottom);
    isVisibleRef.current = result;
    return result;
  }, [vx, vy, zoom, xPos, yPos, size.w, size.h, isInteracting, isVisualInteractionLocked]);
  const isInPrefetchAreaRef = useRef(true);
  const isInPrefetchArea = useMemo(() => {
    if (isInteracting || (TAPNOW_INTERACTION_SUSPEND && isVisualInteractionLocked)) return isInPrefetchAreaRef.current;
    const viewportWidth = (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom;
    const viewportHeight = (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom;
    const pad = VIEWPORT_REDUNDANT_PADDING / zoom;
    const left = -vx / zoom - pad;
    const top = -vy / zoom - pad;
    const right = left + viewportWidth + pad * 2;
    const bottom = top + viewportHeight + pad * 2;
    const intersectsViewport = !(xPos + size.w < left || xPos > right || yPos + size.h < top || yPos > bottom);
    if (intersectsViewport) {
      isInPrefetchAreaRef.current = true;
      return true;
    }

    const centerX = left + viewportWidth / 2;
    const centerY = top + viewportHeight / 2;
    const nodeCenterX = xPos + size.w / 2;
    const nodeCenterY = yPos + size.h / 2;
    const toNodeX = nodeCenterX - centerX;
    const toNodeY = nodeCenterY - centerY;
    const distance = Math.hypot(toNodeX, toNodeY);
    const radius = Math.hypot(viewportWidth, viewportHeight) * (0.5 + prefetchScreenFactor);

    const moveX = -lockedVelocity.x;
    const moveY = -lockedVelocity.y;
    const moveLen = Math.hypot(moveX, moveY);
    if (moveLen < 60) {
      const padX = viewportWidth * prefetchScreenFactor;
      const padY = viewportHeight * prefetchScreenFactor;
      return !(xPos + size.w < left - padX || xPos > right + padX || yPos + size.h < top - padY || yPos > bottom + padY);
    }
    const toNodeLen = Math.max(distance, 1);
    const cos = (toNodeX * moveX + toNodeY * moveY) / (toNodeLen * moveLen);
    const result = cos >= PREFETCH_SECTOR_COS && distance <= radius;
    isInPrefetchAreaRef.current = result;
    return result;
  }, [vx, vy, zoom, xPos, yPos, size.w, size.h, prefetchScreenFactor, lockedVelocity, isInteracting, isVisualInteractionLocked]);

  const [lodLevel, setLodLevel] = useState<'far' | 'mid' | 'near'>(() => {
    if (zoom < ZOOM_THRESHOLD_FAR) return 'far';
    if (zoom < ZOOM_THRESHOLD_NEAR) return 'mid';
    return 'near';
  });
  useEffect(() => {
    if (isInteracting || (TAPNOW_INTERACTION_SUSPEND && isVisualInteractionLocked)) return; /* 交互期间冻结 LOD */
    setLodLevel((prev) => {
      const h = LOD_HYSTERESIS_LARGE;
      if (prev === 'near') {
        return zoom < ZOOM_THRESHOLD_NEAR - h ? 'mid' : 'near';
      }
      if (prev === 'mid') {
        if (zoom >= ZOOM_THRESHOLD_NEAR + h) return 'near';
        if (zoom < ZOOM_THRESHOLD_FAR - h) return 'far';
        return 'mid';
      }
      return zoom >= ZOOM_THRESHOLD_FAR + h ? 'mid' : 'far';
    });
  }, [zoom, isInteracting, isVisualInteractionLocked]);
  const showDetailedUi = lodLevel === 'near';
  const showTextLabelInFar = zoom >= ZOOM_THRESHOLD_ICON_ONLY;
  /** 悬停时强制允许渲染 video，确保鼠标放上去就能播放；拖拽/缩放节点时保持画面层 */
  const shouldRenderVideo =
    (lodLevel !== 'far' && (isVisible || isInPrefetchArea)) ||
    (isVideoAreaHovered && activeVideoNodeId === id) ||
    dragging ||
    !!data?._isResizing ||
    (Boolean(selected) && !!videoDisplayUrl);
  const isUltraNear = zoom >= ultraNearZoomThreshold;
  const isHardFrozenRef = useRef(false);
  const isHardFrozen = useMemo(() => {
    if (!performanceMode || selected || dragging || data?._isResizing) return false;
    const viewportLeft = -vx / zoom;
    const viewportTop = -vy / zoom;
    const viewportWidth = (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom;
    const viewportHeight = (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom;
    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const nodeRight = xPos + size.w;
    const nodeBottom = yPos + size.h;
    const intersects = !(nodeRight < viewportLeft || xPos > viewportRight || nodeBottom < viewportTop || yPos > viewportBottom);
    // 视口内节点永不冻结，优先于 lock 缓存
    if (intersects) {
      isHardFrozenRef.current = false;
      return false;
    }
    if (isInteracting || (TAPNOW_INTERACTION_SUSPEND && isVisualInteractionLocked)) return isHardFrozenRef.current;
    const distX = nodeRight < viewportLeft ? (viewportLeft - nodeRight) : (xPos > viewportRight ? xPos - viewportRight : 0);
    const distY = nodeBottom < viewportTop ? (viewportTop - nodeBottom) : (yPos > viewportBottom ? yPos - viewportBottom : 0);
    const result = distX > viewportWidth * 2 || distY > viewportHeight * 2;
    isHardFrozenRef.current = result;
    return result;
  }, [performanceMode, selected, dragging, data?._isResizing, vx, vy, zoom, xPos, yPos, size.w, size.h, isInteracting, isVisualInteractionLocked]);
  const isInteractionVisualLock = isVisualInteractionLocked;
  const showSelectedChrome = selected || dragging;
  const showNodeChrome = showSelectedChrome || isPreviewPlaying;
  const playbackActive = isVideoAreaHovered || (externalPlaybackHeld && showNodeChrome);
  /** 仅由「指针是否在视频内容区」或外挂播放条控制暂停 */
  const isPaused = !playbackActive;

  // 稳定的视频展示 URL，避免因 data 引用变化导致 src 抖动、视频重载闪动
  const videoDisplayUrl = useMemo(() => {
    const remote = (data?.originalVideoUrl || '').trim();
    const out = (outputVideo || '').trim();
    const outIsLocal =
      out.startsWith('local-resource://') ||
      out.startsWith('file://') ||
      /^[a-zA-Z]:[\\/]/.test(out);
    // 已有本地落盘结果时，不要被远程链接覆盖（OSS 过期会导致黑屏/解码失败）
    if (out && outIsLocal) return out;
    if (remote && /^https?:\/\//i.test(remote)) return remote;
    return out || remote;
  }, [outputVideo, data?.originalVideoUrl]);

  useEffect(() => {
    if (videoDisplayUrl === prevResumeVideoUrlRef.current) return;
    prevResumeVideoUrlRef.current = videoDisplayUrl;
    const d = data?.playbackCurrentTimeSec;
    const seed = typeof d === 'number' && Number.isFinite(d) ? d : undefined;
    lastPlaybackMediaTimeRef.current = seed;
    setResumePlaybackSec(seed);
  }, [videoDisplayUrl]);

  const baseShouldMountVideoTag = useMemo(() => {
    if (!videoDisplayUrl) return false;
    const lodOk = lodLevel === 'near' || lodLevel === 'mid';
    /** 悬停或外挂播放时绕过 lodLevel，确保能播放 */
    const hoverGrantsMount =
      (isVideoAreaHovered || (externalPlaybackHeld && isPreviewPlaying)) && activeVideoNodeId === id;
    if (!lodOk && !hoverGrantsMount) return false;
    if (perfLevel >= 3) return false;
    if (!hoverGrantsMount && (!isInPrefetchArea || isHardFrozen)) return false;
    if (emergencyUnloadActive) return false;
    const allowDuringInteraction = isUltraNear && !isFpsDropped;
    if (isFastMoving && !allowDuringInteraction && !hoverGrantsMount) return false;
    if (isInteractionVisualLock && !allowDuringInteraction && !hoverGrantsMount) return false;
    return true;
  }, [videoDisplayUrl, lodLevel, perfLevel, isInPrefetchArea, isHardFrozen, emergencyUnloadActive, isFastMoving, isInteractionVisualLock, isUltraNear, isFpsDropped, isVideoAreaHovered, externalPlaybackHeld, isPreviewPlaying, activeVideoNodeId, id]);
  const [stickyVideoMount, setStickyVideoMount] = useState(false);
  useEffect(() => {
    if (baseShouldMountVideoTag) {
      if (!stickyVideoMount) setStickyVideoMount(true);
      return;
    }
    if (!isInteractionVisualLock && stickyVideoMount) {
      setStickyVideoMount(false);
    }
  }, [baseShouldMountVideoTag, isInteractionVisualLock, stickyVideoMount]);
  const hoverDuringLockGrantsMount =
    (isVideoAreaHovered || (externalPlaybackHeld && isPreviewPlaying)) &&
    isInteractionVisualLock &&
    !!videoDisplayUrl &&
    isInPrefetchArea &&
    !isHardFrozen &&
    !emergencyUnloadActive &&
    perfLevel < 3;
  const shouldMountVideoTagRaw =
    baseShouldMountVideoTag ||
    (isInteractionVisualLock && stickyVideoMount && !!videoDisplayUrl && isInPrefetchArea && !isHardFrozen && !emergencyUnloadActive && perfLevel < 3) ||
    hoverDuringLockGrantsMount;
  /** 视口裁剪滞后：离开视口后延迟 unmount，避免缩放时闪烁 */
  const [isInViewportDelayed, setIsInViewportDelayed] = useState(isInViewportFromIO);
  const viewportUnmountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isInViewportFromIO) {
      if (viewportUnmountTimerRef.current) {
        clearTimeout(viewportUnmountTimerRef.current);
        viewportUnmountTimerRef.current = null;
      }
      setIsInViewportDelayed(true);
    } else {
      viewportUnmountTimerRef.current = setTimeout(() => {
        viewportUnmountTimerRef.current = null;
        setIsInViewportDelayed(false);
      }, VIEWPORT_UNMOUNT_DELAY_MS);
    }
    return () => {
      if (viewportUnmountTimerRef.current) clearTimeout(viewportUnmountTimerRef.current);
    };
  }, [isInViewportFromIO]);
  /** 视口裁剪：使用滞后后的值，避免快速缩放时频繁挂载/卸载 */
  /** 全局单例：activeVideoNodeId 或「选中且已出片且非生成中」可挂载；库参考片仅悬停时挂载 */
  const isActiveVideoSingleton = isLibraryReferenceVideo
    ? isVideoAreaHovered && activeVideoNodeId === id
    : activeVideoNodeId === id ||
      (Boolean(selected) && !!videoDisplayUrl && Number(progress) <= 0 && !errorMessage);
  const hoverBypassesViewport = isVideoAreaHovered && isActiveVideoSingleton;
  const shouldMountVideoTag =
    isActiveVideoSingleton && (isInViewportDelayed || hoverBypassesViewport) && shouldMountVideoTagRaw;

  const decodeAllowedIdsRef = useRef<Set<string>>(new Set());
  const decodeAllowedIds = useMemo(() => {
    if (isInteracting || (TAPNOW_INTERACTION_SUSPEND && isVisualInteractionLocked)) return decodeAllowedIdsRef.current;
    const viewportCenterX = -vx / zoom + (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom / 2;
    const viewportCenterY = -vy / zoom + (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom / 2;
    const candidates: Array<{ id: string; priority: number }> = [];
    nodeInternals.forEach((node) => {
      if (node.type !== 'video') return;
      const nodeData = (node as any).data || {};
      const hasVideo = !!(nodeData.outputVideo || nodeData.originalVideoUrl);
      if (!hasVideo) return;
      const w = Number(nodeData.width || 738.91);
      const h = Number(nodeData.height || 422.22);
      const pos = (node as any).positionAbsolute || node.position;
      const centerX = pos.x + w / 2;
      const centerY = pos.y + h / 2;
      const left = -vx / zoom;
      const top = -vy / zoom;
      const right = left + (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom;
      const bottom = top + (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom;
      const inViewport = !(pos.x + w < left || pos.x > right || pos.y + h < top || pos.y > bottom);
      if (!inViewport) return;
      const distance = Math.hypot(centerX - viewportCenterX, centerY - viewportCenterY);
      candidates.push({ id: node.id, priority: calcViewportPriority(distance, true) });
    });
    candidates.sort((a, b) => b.priority - a.priority);
    const perfPenalty = perfLevel >= 3 ? 3 : perfLevel >= 2 ? 2 : perfLevel >= 1 ? 1 : 0;
    const decodeBudget = MAX_DECODERS === 1 ? 1 : Math.max(2, MAX_DECODERS - (isInteractionVisualLock ? 2 : 0) - perfPenalty);
    const ids = new Set<string>();
    if (hoveredVideoNodeId) ids.add(hoveredVideoNodeId);
    if (activeVideoNodeId) ids.add(activeVideoNodeId);
    // 已选中且已有成片、非生成中：优先解码，避免任务列表已能预览画布仍要等悬停才挂 video
    nodeInternals.forEach((node) => {
      if (node.type !== 'video' || !(node as any).selected) return;
      const nodeData = (node as any).data || {};
      if (nodeData.preserveExportLayout && node.id !== hoveredVideoNodeId) return;
      if (Number(nodeData.progress ?? 0) > 0) return;
      if (nodeData.outputVideo || nodeData.originalVideoUrl) ids.add(node.id);
    });
    for (const { id: cid } of candidates) {
      if (ids.size >= decodeBudget) break;
      ids.add(cid);
    }
    decodeAllowedIdsRef.current = ids;
    return ids;
  }, [nodeInternals, vx, vy, zoom, isInteracting, isInteractionVisualLock, perfLevel, hoveredVideoNodeId, activeVideoNodeId]);
  const decodePermission = decodeAllowedIds.has(id);
  /** 全局单例：仅激活节点获得解码权限 */
  const effectiveDecodePermission =
    isActiveVideoSingleton &&
    (decodePermission || (isVideoAreaHovered && shouldMountVideoTagRaw) || (isInteractionVisualLock && stickyVideoMount));

  const onFrameCaptured = useCallback((url: string, dataUrl: string) => {
    setVideoLastFrame(url, dataUrl);
    if (url === videoDisplayUrl) {
      setLocalLastFrame(dataUrl);
      setFallbackPosterDataUrl(dataUrl);
      const t = lastPlaybackMediaTimeRef.current;
      if (typeof t === 'number' && Number.isFinite(t)) {
        fallbackPosterCache.set(frameCacheKey(url, t), dataUrl);
      }
    }
  }, [videoDisplayUrl]);

  const thumbPlaybackSec = useMemo(() => {
    const fromData = data?.playbackCurrentTimeSec;
    if (typeof fromData === 'number' && Number.isFinite(fromData) && fromData >= 0) return fromData;
    const live = lastPlaybackMediaTimeRef.current;
    if (typeof live === 'number' && Number.isFinite(live) && live >= 0) return live;
    return 0;
  }, [data?.playbackCurrentTimeSec, videoDisplayUrl]);
  /** 0.5s 分桶，避免播放进度节流写入时频繁重截静帧 */
  const thumbPlaybackBucket = useMemo(
    () => (thumbPlaybackSec > 0.05 ? Math.round(thumbPlaybackSec * 2) / 2 : 0),
    [thumbPlaybackSec]
  );

  const applyStaticFramePreview = useCallback(
    (dataUrl: string, timeSec?: number) => {
      if (!dataUrl || !videoDisplayUrl) return;
      setFallbackPosterDataUrl(dataUrl);
      setLocalLastFrame(dataUrl);
      setVideoLastFrame(videoDisplayUrl, dataUrl);
      const t =
        timeSec ??
        (typeof lastPlaybackMediaTimeRef.current === 'number'
          ? lastPlaybackMediaTimeRef.current
          : thumbPlaybackSec);
      fallbackPosterCache.set(frameCacheKey(videoDisplayUrl, t), dataUrl);
    },
    [videoDisplayUrl, thumbPlaybackSec]
  );

  const requestStaticFrameAtPlayback = useCallback(
    (timeSec: number, signal?: AbortSignal) => {
      if (!videoDisplayUrl) return;
      capturePosterFromVideo(videoDisplayUrl, signal, timeSec)
        .then((dataUrl) => {
          if (dataUrl) applyStaticFramePreview(dataUrl, timeSec);
        })
        .catch(() => {});
    },
    [videoDisplayUrl, applyStaticFramePreview]
  );

  useEffect(() => {
    // 播放中不刷新 poster 静帧，避免每 0.5s 清层 + 重设 fallbackPosterDataUrl
    if (isVideoAreaHovered && !isPaused) return;
    setLocalLastFrame(null);
    setFallbackPosterDataUrl('');
    if (!videoDisplayUrl) return;
    const cached =
      fallbackPosterCache.get(frameCacheKey(videoDisplayUrl, thumbPlaybackSec)) ||
      fallbackPosterCache.get(videoDisplayUrl) ||
      getVideoLastFrame(videoDisplayUrl);
    if (cached) applyStaticFramePreview(cached, thumbPlaybackSec);
  }, [videoDisplayUrl, thumbPlaybackSec, applyStaticFramePreview, isVideoAreaHovered, isPaused]);

  // 失活时释放 video 资源；isInteracting 期间禁止 unmount/release
  const prevDecodePermissionRef = useRef(effectiveDecodePermission);
  useEffect(() => {
    if (isInteracting) return;
    if (prevDecodePermissionRef.current && !effectiveDecodePermission) {
      const t =
        lastPlaybackMediaTimeRef.current ??
        data?.playbackCurrentTimeSec ??
        thumbPlaybackSec;
      if (videoPreviewRef.current) {
        videoPreviewRef.current.captureCurrentFrame?.(videoDisplayUrl, onFrameCaptured);
        videoPreviewRef.current.releaseVideo?.();
      } else if (videoDisplayUrl) {
        requestStaticFrameAtPlayback(t);
      }
    }
    prevDecodePermissionRef.current = effectiveDecodePermission;
  }, [effectiveDecodePermission, videoDisplayUrl, onFrameCaptured, isInteracting]);

  // 视口裁剪：使用滞后后的值；isInteracting 期间禁止 unmount/release
  const prevInViewportDelayedRef = useRef(isInViewportDelayed);
  useEffect(() => {
    if (isInteracting) return;
    if (prevInViewportDelayedRef.current && !isInViewportDelayed && videoDisplayUrl) {
      const t =
        lastPlaybackMediaTimeRef.current ??
        data?.playbackCurrentTimeSec ??
        thumbPlaybackSec;
      if (videoPreviewRef.current) {
        videoPreviewRef.current.captureCurrentFrame?.(videoDisplayUrl, onFrameCaptured);
        videoPreviewRef.current.releaseVideo?.();
      } else {
        requestStaticFrameAtPlayback(t);
      }
    }
    prevInViewportDelayedRef.current = isInViewportDelayed;
  }, [isInViewportDelayed, videoDisplayUrl, onFrameCaptured, isInteracting]);

  useEffect(() => {
    if (!isInteractionVisualLock) return;
    // 交互期间若视频层仍挂载则保持可见，避免 poster/video 频繁切换造成刷新感。
    if (!shouldMountVideoTag) {
      setIsVideoVisible(false);
    }
  }, [isInteractionVisualLock, shouldMountVideoTag]);

  useEffect(() => {
    if (TAPNOW_INTERACTION_SUSPEND && isVisualInteractionLocked) return; /* [Tapnow] 交互期间冻结速度计算 */
    const now = Date.now();
    const prev = velocitySampleRef.current;
    velocitySampleRef.current = { x: vx, y: vy, t: now };
    if (!prev) return;
    const dt = Math.max(now - prev.t, 1);
    const speed = Math.hypot(vx - prev.x, vy - prev.y) / (dt / 1000);
    setIsFastMoving(speed > fastMoveSpeedThreshold);
  }, [vx, vy, fastMoveSpeedThreshold, isVisualInteractionLocked]);

  useEffect(() => {
    if (TAPNOW_INTERACTION_SUSPEND && isVisualInteractionLocked) return; /* [Tapnow] 交互期间冻结 velocity 订阅 */
    if (directionLockTimerRef.current) clearTimeout(directionLockTimerRef.current);
    directionLockTimerRef.current = setTimeout(() => {
      setLockedVelocity({ x: velocityX, y: velocityY });
    }, PREFETCH_DIRECTION_LOCK_MS);
    return () => {
      if (directionLockTimerRef.current) clearTimeout(directionLockTimerRef.current);
    };
  }, [velocityX, velocityY, isVisualInteractionLocked]);

  useEffect(() => {
    if (!isInteractionVisualLock) {
      setIsFpsDropped(false);
      return;
    }
    if (TAPNOW_INTERACTION_SUSPEND) return; /* [Tapnow] 交互期间禁用 FPS 检测 */
    let rafId = 0;
    let lastTs = 0;
    let fpsEma = 60;
    const tick = (ts: number) => {
      if (lastTs > 0) {
        const dt = Math.max(ts - lastTs, 1);
        const fps = 1000 / dt;
        fpsEma = fpsEma * 0.85 + fps * 0.15;
        setIsFpsDropped(fpsEma < fpsDropThreshold);
      }
      lastTs = ts;
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isInteractionVisualLock, fpsDropThreshold]);

  useEffect(() => {
    if (isInteractionVisualLock) return;
    if (perfLevel >= 1 && !isVisible) return;
    if (!posterSrc || !isInPrefetchArea) return;
    if (isImageLoadedInSession(posterSrc)) {
      return;
    }
    let cancelled = false;
    const viewportCenterX = -vx / zoom + (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom / 2;
    const viewportCenterY = -vy / zoom + (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom / 2;
    const nodeCenterX = xPos + size.w / 2;
    const nodeCenterY = yPos + size.h / 2;
    const distance = Math.hypot(nodeCenterX - viewportCenterX, nodeCenterY - viewportCenterY);
    const toNodeX = nodeCenterX - viewportCenterX;
    const toNodeY = nodeCenterY - viewportCenterY;
    const velocityLen = Math.hypot(lockedVelocity.x, lockedVelocity.y);
    const toNodeLen = Math.max(Math.hypot(toNodeX, toNodeY), 1);
    const aheadCos = velocityLen > 1 ? ((toNodeX * -lockedVelocity.x + toNodeY * -lockedVelocity.y) / (toNodeLen * velocityLen)) : 0;
    const directionalBias = Math.max(0, aheadCos) * 1500;
    const priority = calcViewportPriority(distance, isInPrefetchArea, directionalBias);
    posterLoadAbortRef.current?.abort();
    const controller = new AbortController();
    posterLoadAbortRef.current = controller;
    enqueueImageLoad(posterSrc, priority, { signal: controller.signal })
      .then((loadedSrc) => {
        if (cancelled) return;
        markImageLoadedInSession(loadedSrc);
      })
      .catch(() => {
        if (cancelled) return;
      });
    return () => {
      cancelled = true;
      controller.abort();
      if (posterLoadAbortRef.current === controller) posterLoadAbortRef.current = null;
    };
  }, [posterSrc, isInPrefetchArea, isVisible, vx, vy, zoom, xPos, yPos, size.w, size.h, isInteractionVisualLock, perfLevel, lockedVelocity]);

  useEffect(() => {
    if (isInteractionVisualLock || isVideoAreaHovered) return;
    if (posterSrc || !videoDisplayUrl) return;
    if (!isInPrefetchArea && !selected) return;
    let cancelled = false;
    posterCaptureAbortRef.current?.abort();
    const controller = new AbortController();
    posterCaptureAbortRef.current = controller;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const t =
        typeof lastPlaybackMediaTimeRef.current === 'number' &&
        Number.isFinite(lastPlaybackMediaTimeRef.current)
          ? lastPlaybackMediaTimeRef.current
          : thumbPlaybackSec;
      requestStaticFrameAtPlayback(t, controller.signal);
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
      if (posterCaptureAbortRef.current === controller) posterCaptureAbortRef.current = null;
    };
  }, [
    posterSrc,
    videoDisplayUrl,
    isInPrefetchArea,
    selected,
    isInteractionVisualLock,
    isVideoAreaHovered,
    thumbPlaybackBucket,
    requestStaticFrameAtPlayback,
  ]);

  useEffect(() => {
    if (isInteractionVisualLock) return;
    if (perfLevel >= 1 && !isVisible) return;
    if (!videoDisplayUrl || !isInPrefetchArea) return;
    metadataPrefetchAbortRef.current?.abort();
    const controller = new AbortController();
    metadataPrefetchAbortRef.current = controller;
    prefetchVideoMetadata(videoDisplayUrl, controller.signal).catch(() => {});
    return () => {
      controller.abort();
      if (metadataPrefetchAbortRef.current === controller) metadataPrefetchAbortRef.current = null;
    };
  }, [videoDisplayUrl, isInPrefetchArea, isVisible, isInteractionVisualLock, perfLevel]);

  useEffect(() => {
    return () => {
      posterLoadAbortRef.current?.abort();
      posterCaptureAbortRef.current?.abort();
      metadataPrefetchAbortRef.current?.abort();
      posterLoadAbortRef.current = null;
      posterCaptureAbortRef.current = null;
      metadataPrefetchAbortRef.current = null;
      if (videoDisplayUrl) {
        prefetchedVideoMeta.delete(videoDisplayUrl);
        inflightVideoMeta.delete(videoDisplayUrl);
        fallbackPosterCache.delete(videoDisplayUrl);
      }
      readyVideoSrcSetRef.current.clear();
    };
  }, [videoDisplayUrl]);

  useEffect(() => {
    if (!isInPrefetchArea || !videoDisplayUrl || !window.electronAPI?.checkFileExists) return;
    // 进入预取区时先做资源可用性探测，避免进入视口后才发现路径不可读导致黑屏。
    if (videoDisplayUrl.startsWith('local-resource://') || videoDisplayUrl.startsWith('file://')) {
      window.electronAPI.checkFileExists(videoDisplayUrl).catch(() => undefined);
    }
  }, [isInPrefetchArea, videoDisplayUrl]);

  useEffect(() => {
    if (!import.meta.env.DEV || !selected) return;
    const now = Date.now();
    if (now - prefetchDebugAtRef.current < 600) return;
    prefetchDebugAtRef.current = now;
    const viewportWidth = (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom;
    const viewportHeight = (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom;
    const viewportCenterX = -vx / zoom + viewportWidth / 2;
    const viewportCenterY = -vy / zoom + viewportHeight / 2;
    const nodeCenterX = xPos + size.w / 2;
    const nodeCenterY = yPos + size.h / 2;
    const screenDistance = Math.hypot(nodeCenterX - viewportCenterX, nodeCenterY - viewportCenterY) / Math.hypot(viewportWidth, viewportHeight);
    console.debug('[VideoNode][prefetch-debug]', {
      id,
      zoom: Number(zoom.toFixed(3)),
      prefetchScreenFactor: Number(prefetchScreenFactor.toFixed(2)),
      screenDistance: Number(screenDistance.toFixed(3)),
      inViewport: isVisible,
      inPrefetchArea: isInPrefetchArea,
      shouldMountVideoTag,
    });
  }, [selected, id, zoom, prefetchScreenFactor, isVisible, isInPrefetchArea, shouldMountVideoTag, vx, vy, xPos, yPos, size.w, size.h]);

  // 状态机：mount 时 loading->running，canplay 时 running->finished
  useEffect(() => {
    if (shouldMountVideoTag && effectiveDecodePermission && videoStatus === 'loading' && !!videoDisplayUrl) {
      setVideoStatus('running');
    }
  }, [shouldMountVideoTag, effectiveDecodePermission, videoDisplayUrl, videoStatus]);

  useEffect(() => {
    if (!shouldMountVideoTag || !effectiveDecodePermission) {
      setIsVideoVisible(false);
      return;
    }
    if (videoDisplayUrl && readyVideoSrcSetRef.current.has(videoDisplayUrl)) {
      // 已经可播放过的同一视频，二次悬停直接显示，避免“静态->播放”重复延迟
      setIsVideoVisible(true);
      setVideoStatus('finished');
      setDecodedFrameReady(true);
      return;
    }
    setIsVideoVisible(false);
  }, [shouldMountVideoTag, effectiveDecodePermission, videoDisplayUrl]);

  useEffect(() => {
    if (typeof data?.width === 'number' && data.width > 0 && typeof data?.height === 'number' && data.height > 0) {
      const nextW = clampW(data.width);
      const nextH = clampH(data.height);
      if (size.w !== nextW || size.h !== nextH) {
        setSize({ w: nextW, h: nextH });
        if (nodeRef.current) {
          nodeRef.current.style.width = `${nextW}px`;
          nodeRef.current.style.height = `${nextH}px`;
        }
      }
    }
    if (data?.outputVideo !== undefined) {
      const url = data.outputVideo || '';
      // 标准化 URL（将 file:// 转换为 local-resource://）
      const normalizedUrl = url ? normalizeVideoUrlForNode(url) : '';
      
      // 只有当 URL 真正变化时才更新，避免不必要的重新加载
      if (prevOutputVideoRef.current !== normalizedUrl) {
        prevOutputVideoRef.current = normalizedUrl;
        if (!url) {
          setOutputVideo((prev) => (prev ? '' : prev));
          setVideoStatus('loading');
        } else if (isValidVideoUrl(normalizedUrl)) {
          // 同步设置，确保生成完成后立即显示（避免 setTimeout + cleanup 导致状态丢失）
          setOutputVideo(normalizedUrl);
          setVideoStatus('loading');
        } else {
          console.warn('[VideoNode] 检测到非视频文件 URL，已忽略:', normalizedUrl);
          setOutputVideo((prev) => (prev ? '' : prev));
          setVideoStatus('loading');
        }
      }
    }
    if (data?.title !== undefined) {
      setTitle(data.title || 'video');
    }
    if (data?.progress !== undefined) {
      setProgress(data.progress);
    }
    if (data?.progressMessage !== undefined) {
      // progressMessage 已通过 data 传递，无需单独状态
    }
    if (data?.errorMessage !== undefined) {
      setErrorMessage(data.errorMessage || '');
    }
  }, [data?.width, data?.height, data?.outputVideo, data?.title, data?.progress, data?.progressMessage, data?.errorMessage, size.w, size.h]);

  const handleTitleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  }, []);

  // 视频加载完成：保持最小尺寸，同时按视频比例匹配模块外形；保存时长供裁剪使用
  const handleVideoLoadedMetadata = useCallback((videoWidth: number, videoHeight: number, duration?: number) => {
    if (videoWidth <= 0 || videoHeight <= 0) return;
    if (typeof duration === 'number' && isFinite(duration) && duration > 0) {
      videoDurationRef.current = duration;
      onDataChange?.(id, { mediaDurationSec: duration });
    }
    // 库拖入等 compact 外框：按成片像素 + Image 尺度重算，使外框贴合视频比例
    if (data?.preserveExportLayout) {
      const adapted = computeNodeSizeFromMedia(
        videoWidth,
        videoHeight,
        IMAGE_NODE_MIN_W,
        IMAGE_NODE_MIN_H,
        IMAGE_NODE_MAX_W,
        IMAGE_NODE_MAX_H,
      );
      const aspectLabel = aspectRatioLabelFromPixelSize(videoWidth, videoHeight);
      const aspectRatio = snapToVideoPanelAspectRatio(aspectLabel);
      const prevAsset =
        data?.videoAsset && typeof data.videoAsset === 'object'
          ? (data.videoAsset as Record<string, unknown>)
          : {};
      if (size.w !== adapted.w || size.h !== adapted.h || data?.aspectRatio !== aspectRatio) {
        setSize(adapted);
        onDataChange?.(id, {
          width: adapted.w,
          height: adapted.h,
          aspectRatio,
          videoAsset: {
            ...prevAsset,
            width: videoWidth,
            height: videoHeight,
          },
        });
      }
      return;
    }
    const adapted = computeAdaptiveVideoSize(videoWidth, videoHeight);
    const aspectLabel = aspectRatioLabelFromPixelSize(videoWidth, videoHeight);
    const aspectRatio = snapToVideoPanelAspectRatio(aspectLabel);
    const prevAsset =
      data?.videoAsset && typeof data.videoAsset === 'object'
        ? (data.videoAsset as Record<string, unknown>)
        : {};
    if (size.w !== adapted.w || size.h !== adapted.h || data?.aspectRatio !== aspectRatio) {
      setSize(adapted);
      onDataChange?.(id, {
        width: adapted.w,
        height: adapted.h,
        aspectRatio,
        videoAsset: {
          ...prevAsset,
          width: videoWidth,
          height: videoHeight,
        },
      });
    }
  }, [computeAdaptiveVideoSize, size.w, size.h, id, onDataChange, data?.preserveExportLayout, data?.width, data?.height, data?.aspectRatio, data?.videoAsset]);

  const handleTrimClick = useCallback(() => {
    setTrimError(null);
    const dur = videoDurationRef.current;
    const start = 0;
    const end = typeof dur === 'number' && isFinite(dur) && dur > 0 ? dur : 0;
    setTrimStartSec(String(start));
    setTrimEndSec(String(Math.round(end * 10) / 10));
    setShowTrimModal(true);
  }, []);

  const handleTrimConfirm = useCallback(async (overrideStart?: number, overrideEnd?: number) => {
    const start = overrideStart ?? parseFloat(trimStartSec);
    const end = overrideEnd ?? parseFloat(trimEndSec);
    if (isNaN(start) || isNaN(end) || start < 0 || end <= start) {
      setTrimError('请填写有效的起始和结束时间（结束时间须大于起始时间）');
      return;
    }
    const videoUrl = data?.outputVideo || outputVideo || data?.originalVideoUrl || '';
    if (!videoUrl) {
      setTrimError('无可用视频');
      return;
    }
    if (!window.electronAPI?.trimVideo) {
      setTrimError('当前环境不支持裁剪');
      return;
    }
    setTrimError(null);
    setTrimming(true);
    try {
      const res = await window.electronAPI.trimVideo(projectId || undefined, videoUrl, start, end);
      if (res?.videoUrl) {
        setOutputVideo(res.videoUrl);
        onDataChange?.(id, { outputVideo: res.videoUrl, originalVideoUrl: res.videoUrl, errorMessage: undefined });
        setTrimStartSec(String(Math.round(start * 10) / 10));
        setTrimEndSec(String(Math.round(end * 10) / 10));
        setShowTrimModal(false);
      } else {
        setTrimError('裁剪未返回结果');
      }
    } catch (err: any) {
      const msg = err?.message || '裁剪失败';
      console.error('[VideoNode] 裁剪失败:', err);
      setTrimError(msg);
      onDataChange?.(id, { errorMessage: msg });
    } finally {
      setTrimming(false);
    }
  }, [trimStartSec, trimEndSec, data?.outputVideo, outputVideo, data?.originalVideoUrl, projectId, id, onDataChange]);

  const handleSplitVideoFrames = useCallback(
    async (intervalSec: VideoFrameSplitIntervalSec, e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (isSplitFramesBusy || trimming || isVideoWatermarkLoading || bilibiliFetching) return;

      const displayUrl = (videoDisplayUrl || outputVideo || data?.outputVideo || data?.originalVideoUrl || '').trim();
      if (!displayUrl) {
        showAlert(vt.videoFrameSplitNeedVideo);
        return;
      }
      if (!window.electronAPI?.createImageLocalResourceFromBuffer) {
        showAlert(vt.videoFrameSplitNotSupported);
        return;
      }

      setSplitFramesMenuHover(false);
      setSplitFramesMenuOpen(false);
      setIsSplitFramesBusy(true);
      onDataChange?.(id, {
        progressMessage: vt.videoFrameSplitProgress(0, 0),
        errorMessage: undefined,
      });

      try {
        let captureUrl = normalizeVideoUrlForNode(displayUrl);
        if (/^https?:\/\//i.test(captureUrl) && window.electronAPI?.createVideoLocalResourceFromUrl) {
          onDataChange?.(id, { progressMessage: vt.videoFrameSplitPreparingLocal });
          const local = await window.electronAPI.createVideoLocalResourceFromUrl(
            projectId ?? undefined,
            captureUrl,
          );
          captureUrl = normalizeVideoUrlForNode(local.originalUrl || captureUrl);
        }

        let duration = videoDurationRef.current;
        if (!duration || duration <= 0) {
          duration = (await probeVideoDuration(captureUrl)) ?? 0;
        }
        if ((!duration || duration <= 0) && window.electronAPI?.getMediaDuration) {
          const mainDur = await window.electronAPI.getMediaDuration(captureUrl, projectId ?? undefined);
          if (Number.isFinite(mainDur) && mainDur > 0) {
            duration = mainDur;
          }
        }
        if (!duration || duration <= 0) {
          showAlert(vt.videoFrameSplitNoDuration);
          return;
        }

        let sourcePixelSize = resolveFrameSplitPixelSize(data?.videoAsset);
        if (!sourcePixelSize) {
          sourcePixelSize = (await probeVideoPixelSize(captureUrl)) ?? null;
        }

        const times = buildVideoFrameTimestamps(duration, intervalSec);
        if (times.length > MAX_VIDEO_FRAME_SPLIT_COUNT) {
          showAlert(vt.videoFrameSplitTooMany(MAX_VIDEO_FRAME_SPLIT_COUNT, times.length));
          return;
        }

        const { frames } = await extractVideoFramesAtTimes(captureUrl, times, (done, total) => {
          onDataChange?.(id, { progressMessage: vt.videoFrameSplitProgress(done, total) });
        });

        const okFrames = frames.filter((f) => f.success && f.imageUrl);
        if (okFrames.length === 0) {
          throw new Error(frames[0]?.error || vt.videoFrameSplitFailed);
        }

        const resolveTilePixelSize = (frame: (typeof okFrames)[number], tile?: { width?: number; height?: number }) =>
          resolveFrameSplitPixelSize(tile, frame, sourcePixelSize ?? undefined) ?? sourcePixelSize;

        const firstPixel = resolveTilePixelSize(okFrames[0]!) ?? { width: IMAGE_NODE_MIN_W, height: IMAGE_NODE_MIN_H };
        const firstSize = computeNodeSizeFromMedia(
          firstPixel.width,
          firstPixel.height,
          IMAGE_NODE_MIN_W,
          IMAGE_NODE_MIN_H,
          IMAGE_NODE_MAX_W,
          IMAGE_NODE_MAX_H,
        );
        const splitW = firstSize.w;
        const splitH = firstSize.h;
        const GAP = 40;
        const CELL_GAP = 28;
        const cols = okFrames.length <= 4 ? 2 : 3;

        const selfRf = getNodes().find((n) => n.id === id);
        const anchorX = selfRf?.positionAbsolute?.x ?? selfRf?.position?.x ?? xPos;
        const anchorY = selfRf?.positionAbsolute?.y ?? selfRf?.position?.y ?? yPos;

        const flowPositions = okFrames.map((_, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          return {
            x: anchorX + size.w + GAP + col * (splitW + CELL_GAP),
            y: anchorY + row * (splitH + CELL_GAP),
          };
        });

        const ts = Date.now();
        const tilePayloads: Array<{
          outputImage: string;
          originalImageUrl: string;
          tinyThumbUrl?: string;
          localPath?: string;
          imageAsset?: Record<string, unknown>;
          label: string;
          timeSec: number;
          width?: number;
          height?: number;
        }> = [];

        for (let i = 0; i < okFrames.length; i += 1) {
          const frame = okFrames[i]!;
          const buffer = dataUrlToArrayBuffer(frame.imageUrl!);
          const result = await window.electronAPI.createImageLocalResourceFromBuffer(
            projectId ?? undefined,
            `video-frame-${ts}-${i}.png`,
            buffer,
          );
          tilePayloads.push({
            outputImage: formatSplitFrameImagePath(result.previewUrl),
            originalImageUrl: formatSplitFrameImagePath(result.originalUrl),
            tinyThumbUrl: result.tinyUrl || '',
            localPath: result.originalPath,
            imageAsset: {
              preview: formatSplitFrameImagePath(result.previewUrl),
              original: formatSplitFrameImagePath(result.originalUrl),
              tiny: result.tinyUrl || '',
              avgColorHex: result.avgColorHex,
              width: result.width,
              height: result.height,
            },
            label: vt.videoFrameSplitNodeLabel(frame.timeSec),
            timeSec: frame.timeSec,
            width: result.width ?? frame.width,
            height: result.height ?? frame.height,
          });
        }

        const lastIdx = tilePayloads.length - 1;
        const newNodes: Node[] = tilePayloads.map((tile, i) => {
          const pixel = resolveTilePixelSize(okFrames[i]!, tile) ?? firstPixel;
          const adapted = computeNodeSizeFromMedia(
            pixel.width,
            pixel.height,
            IMAGE_NODE_MIN_W,
            IMAGE_NODE_MIN_H,
            IMAGE_NODE_MAX_W,
            IMAGE_NODE_MAX_H,
          );
          const aspectLabel = aspectRatioLabelFromPixelSize(pixel.width, pixel.height);
          return {
            id: `image-${ts}-${i}`,
            type: 'image',
            position: flowPositions[i]!,
            selected: i === lastIdx,
            data: {
              label: tile.label,
              width: adapted.w,
              height: adapted.h,
              isUserResized: false,
              preserveExportLayout: true,
              title: 'image',
              resolution: '1k',
              aspectRatio: aspectLabel,
              model: 'banana-2.0',
              seedreamWidth: pixel.width,
              seedreamHeight: pixel.height,
              outputImage: tile.outputImage,
              outputImages: [tile.outputImage],
              originalImageUrl: tile.originalImageUrl,
              tinyThumbUrl: tile.tinyThumbUrl ?? '',
              localPath: tile.localPath,
              imageAsset: {
                ...tile.imageAsset,
                width: pixel.width,
                height: pixel.height,
              },
              progress: 0,
              errorMessage: undefined,
            },
            style: {
              ...nodeStyleDimensions(adapted.w, adapted.h),
              minWidth: `${IMAGE_NODE_MIN_W}px`,
              minHeight: `${IMAGE_NODE_MIN_H}px`,
            },
          };
        });

        if (onAddFrameSplitNodes) {
          onAddFrameSplitNodes(newNodes);
        } else {
          console.warn('[VideoNode] onAddFrameSplitNodes 未注入，拆帧图片无法显示到画布');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : vt.videoFrameSplitFailed;
        console.error('[VideoNode] 视频拆帧失败:', err);
        showAlert(`${vt.videoFrameSplitFailed}\n\n${msg}`);
        onDataChange?.(id, { errorMessage: msg });
      } finally {
        setIsSplitFramesBusy(false);
        onDataChange?.(id, { progressMessage: '' });
      }
    },
    [
      isSplitFramesBusy,
      trimming,
      isVideoWatermarkLoading,
      bilibiliFetching,
      videoDisplayUrl,
      outputVideo,
      data?.outputVideo,
      data?.originalVideoUrl,
      showAlert,
      vt,
      onDataChange,
      id,
      projectId,
      getNodes,
      onAddFrameSplitNodes,
      xPos,
      yPos,
      size.w,
    ],
  );

  const isVideoGenerating = progress > 0 && progress < 100;

  /** B 站 / YouTube：IPC → 主进程本地 yt-dlp，不经阿里云；结果写 local-resource 并回填画布 */
  const handleBilibiliGrabConfirm = useCallback(async () => {
    const raw = bilibiliUrlDraft.trim();
    if (!raw) {
      showAlert(vt.bilibiliNeedUrl);
      return;
    }
    if (!window.electronAPI?.createVideoFromBilibiliPage) {
      showAlert(vt.bilibiliNotSupportedBuild);
      return;
    }
    if (bilibiliFetching || trimming || isVideoGenerating) return;
    const urlToFetch = raw;
    setShowBilibiliModal(false);
    setBilibiliUrlDraft('');
    setBilibiliFetching(true);
    onDataChange?.(id, { progress: 2, progressMessage: vt.bilibiliFetchingProgress, errorMessage: undefined });
    try {
      const res = await window.electronAPI.createVideoFromBilibiliPage(projectId, urlToFetch);
      if (!res?.originalUrl) throw new Error('未返回视频地址');
      const adapted = computeAdaptiveVideoSize(res.width, res.height);
      setSize(adapted);
      const aspectRatio =
        res.width && res.height
          ? snapToVideoPanelAspectRatio(aspectRatioLabelFromPixelSize(res.width, res.height))
          : undefined;
      const out = res.originalUrl;
      prevOutputVideoRef.current = out;
      setOutputVideo(out);
      setProgress(0);
      setErrorMessage('');
      onDataChange?.(id, {
        outputVideo: out,
        videoAsset: {
          poster: res.posterUrl,
          ghost: res.ghostBase64,
          width: res.width,
          height: res.height,
        },
        width: adapted.w,
        height: adapted.h,
        ...(aspectRatio ? { aspectRatio } : {}),
        progress: 0,
        progressMessage: '',
        errorMessage: undefined,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[VideoNode] page video grab (local yt-dlp):', e);
      if (msg.includes(YOUTUBE_SCRAPE_PROXY_GUIDE_MARKER)) {
        setShowGrabProxyGuide(true);
        onDataChange?.(id, { errorMessage: '', progress: 0, progressMessage: '' });
      } else {
        showAlert(`${vt.bilibiliGrabFailedTitle}\n\n${msg}`);
        onDataChange?.(id, { errorMessage: msg, progress: 0, progressMessage: '' });
      }
    } finally {
      setBilibiliFetching(false);
    }
  }, [
    bilibiliUrlDraft,
    bilibiliFetching,
    trimming,
    isVideoGenerating,
    projectId,
    id,
    onDataChange,
    showAlert,
    vt,
    computeAdaptiveVideoSize,
  ]);

  // 视频上传：与 AudioNode 一致的 IPC showOpenVideoDialog 方案（不依赖 file.path）
  const handleUploadVideo = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation?.();
    e?.preventDefault?.();
    if (typeof window.electronAPI?.showOpenVideoDialog !== 'function') {
      console.warn('[VideoNode] showOpenVideoDialog 不可用，请确保运行在 Electron 环境');
      return;
    }
    const res = await window.electronAPI.showOpenVideoDialog();
    if (!res.success || !res.filePath) {
      if (!res.success && !res.filePath) console.log('[VideoNode] 用户取消选择或未选择文件');
      return;
    }
    let localVideoUrl = '';
    let posterUrl = '';
    let ghost = '';
    let width: number | undefined;
    let height: number | undefined;
    if (window.electronAPI?.createVideoLocalResourceFromFile) {
      try {
        const resource = await window.electronAPI.createVideoLocalResourceFromFile(undefined, res.filePath);
        localVideoUrl = resource.originalUrl;
        posterUrl = resource.posterUrl || '';
        ghost = resource.ghostBase64 || '';
        width = resource.width;
        height = resource.height;
      } catch (error) {
        console.warn('[VideoNode] 创建视频本地资源失败，回退原路径:', error);
      }
    }
    if (!localVideoUrl) {
      const rawPath = res.filePath;
      let normalizedPath = rawPath.replace(/\\/g, '/');
      if (normalizedPath.match(/^[a-zA-Z]:\//)) {
        normalizedPath = normalizedPath[0].toUpperCase() + normalizedPath.slice(1);
      } else if (normalizedPath.match(/^[a-zA-Z]\//)) {
        normalizedPath = normalizedPath[0].toUpperCase() + ':' + normalizedPath.slice(1);
      }
      localVideoUrl = normalizeVideoUrlForNode(`local-resource://${normalizedPath}`);
    }
    const url = localVideoUrl;
    prevOutputVideoRef.current = url;
    setOutputVideo(url);
    setProgress(0);
    setErrorMessage('');
    const adapted = computeAdaptiveVideoSize(width, height);
    setSize(adapted);
    const aspectRatio =
      width && height && width > 0 && height > 0
        ? snapToVideoPanelAspectRatio(aspectRatioLabelFromPixelSize(width, height))
        : data?.aspectRatio;
    onDataChange?.(id, {
      outputVideo: url,
      progress: 0,
      errorMessage: undefined,
      width: adapted.w,
      height: adapted.h,
      ...(aspectRatio ? { aspectRatio } : {}),
      videoAsset: {
        poster: posterUrl,
        ghost,
        width,
        height,
      },
    });
  }, [id, onDataChange, computeAdaptiveVideoSize, data?.aspectRatio]);

  const handleDownloadVideo = useCallback(async () => {
    const localUrl = (videoDisplayUrl || outputVideo || '').trim();
    const remoteUrl = (data?.originalVideoUrl || '').trim();
    const sourceUrl = localUrl || remoteUrl;
    if (!sourceUrl || !window.electronAPI?.downloadVideo) return;

    const pickUrlBaseName = (u: string) => {
      if (!u) return '';
      try {
        const p = u.startsWith('http') ? new URL(u).pathname : u.replace(/^local-resource:\/\//, '').replace(/^file:\/\/\/?/, '');
        const b = decodeURIComponent(p.split('/').pop() || '');
        return b.includes('.') ? b.replace(/[/\\?*:|"<>]/g, '_') : '';
      } catch {
        return '';
      }
    };

    const nameHint = pickUrlBaseName(remoteUrl) || pickUrlBaseName(localUrl) || (title || 'video').replace(/[/\\?*:|"<>]/g, '_').trim() || 'video';

    try {
      let downloadUrl = sourceUrl;
      if (localUrl.startsWith('local-resource://') && projectId) {
        downloadUrl = await mapProjectPath(localUrl, projectId);
      } else if (localUrl.startsWith('file://')) {
        downloadUrl = localUrl;
      } else if (localUrl) {
        downloadUrl = localUrl;
      }

      const result = await window.electronAPI.downloadVideo(downloadUrl, nameHint);
      if (!result.success && result.error && !result.error.includes('取消')) {
        console.warn('[VideoNode] 下载失败:', result.error);
      }
    } catch (err) {
      console.error('[VideoNode] 下载失败:', err);
    }
  }, [videoDisplayUrl, outputVideo, data?.originalVideoUrl, title, projectId]);

  const [showFarPlaceholder, setShowFarPlaceholder] = useState<boolean>(zoom < ZOOM_THRESHOLD_ICON_ONLY);
  useEffect(() => {
    setShowFarPlaceholder((prev) => {
      if (prev) {
        return zoom < ZOOM_THRESHOLD_ICON_ONLY + FAR_PLACEHOLDER_HYSTERESIS;
      }
      return zoom < ZOOM_THRESHOLD_ICON_ONLY - FAR_PLACEHOLDER_HYSTERESIS;
    });
  }, [zoom]);
  const keepVideoWhenLoaded =
    !!videoDisplayUrl &&
    (hasPoster ||
      !!localLastFrame ||
      !!(videoDisplayUrl && getVideoLastFrame(videoDisplayUrl)) ||
      !!ghostImage);
  const keepVideoLayerDuringInteraction =
    (isInteractionVisualLock || dragging || !!data?._isResizing) && !!videoDisplayUrl;
  const showPlaceholder =
    (isHardFrozen || (showFarPlaceholder && !keepVideoWhenLoaded)) &&
    !keepVideoLayerDuringInteraction;
  const hasRenderableVideo = !!outputVideo && !showPlaceholder && !errorMessage;

  /** 开始拖拽节点时预先截取静帧，避免 video 卸载后 poster 层空白 */
  useEffect(() => {
    if (!dragging || !videoDisplayUrl) return;
    if (keepVideoWhenLoaded) return;
    try {
      videoPreviewRef.current?.captureCurrentFrame?.(videoDisplayUrl, onFrameCaptured);
    } catch {
      /* ignore */
    }
    requestStaticFrameAtPlayback(thumbPlaybackSec);
  }, [
    dragging,
    videoDisplayUrl,
    keepVideoWhenLoaded,
    onFrameCaptured,
    requestStaticFrameAtPlayback,
    thumbPlaybackSec,
  ]);

  /** 尺寸或占位/成片布局切换后，刷新 React Flow Handle 测量，修正入边锚点 */
  useEffect(() => {
    const raf = requestAnimationFrame(() => updateNodeInternals(id));
    return () => cancelAnimationFrame(raf);
  }, [id, size.w, size.h, hasRenderableVideo, updateNodeInternals]);

  const showVideoDecodeLayer =
    shouldRenderVideo && !isInteracting && shouldMountVideoTag && effectiveDecodePermission;

  useEffect(() => {
    if (!showVideoDecodeLayer) {
      setDecodedFrameReady(true);
    } else {
      setDecodedFrameReady(false);
    }
  }, [showVideoDecodeLayer, videoDisplayUrl]);

  const posterFillContent = useMemo(() => {
    const lastFrame = localLastFrame || (videoDisplayUrl ? getVideoLastFrame(videoDisplayUrl) : undefined);
    const imgSrc = lastFrame || effectivePosterSrc;
    if (hasPoster || lastFrame) {
      return (
        <img
          key={lastFrame ? 'lastframe' : 'poster'}
          src={imgSrc}
          alt=""
          className="w-full h-full object-contain select-none pointer-events-none"
          draggable={false}
          style={{
            opacity: 1,
            transition: isInteractionVisualLock ? 'none' : LOW_RES_TRANSITION,
          }}
        />
      );
    }
    if (ghostImage) {
      return (
        <div
          className="w-full h-full"
          style={{
            backgroundImage: `url(${ghostImage})`,
            backgroundSize: 'contain',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            filter: 'blur(5px)',
            opacity: 0.82,
          }}
        />
      );
    }
    return (
      <div
        className={`w-full h-full flex items-center justify-center ${isDarkMode ? 'bg-slate-700/40' : 'bg-slate-200/70'}`}
        aria-busy
        aria-label="加载视频画面"
      >
        <div
          className={`w-7 h-7 rounded-full border-2 border-t-transparent animate-spin ${
            isDarkMode ? 'border-white/35' : 'border-gray-500/40'
          }`}
        />
      </div>
    );
  }, [
    localLastFrame,
    videoDisplayUrl,
    effectivePosterSrc,
    hasPoster,
    ghostImage,
    isDarkMode,
    isInteractionVisualLock,
  ]);

  const handleDecodedFrame = useCallback(() => {
    setDecodedFrameReady(true);
  }, []);

  const handleUiPlaybackTick = useCallback((timeSec: number, durationSec: number, playing: boolean) => {
    if (Number.isFinite(timeSec)) setUiCurrentTime(timeSec);
    if (Number.isFinite(durationSec) && durationSec > 0) setUiDuration(durationSec);
    if (!playing && externalPlaybackHeld) setExternalPlaybackHeld(false);
  }, [externalPlaybackHeld]);

  const pendingKeyboardPlayRef = useRef(false);

  const handleExternalTogglePlay = useCallback(() => {
    if (isPreviewPlaying) {
      pendingKeyboardPlayRef.current = false;
      videoPreviewRef.current?.pause();
      setExternalPlaybackHeld(false);
      return;
    }
    setExternalPlaybackHeld(true);
    setIsVideoAreaHovered(true);
    setHoveredVideoNodeId(id);
    setActiveVideoNodeId(id);
    if (videoDisplayUrl && readyVideoSrcSetRef.current.has(videoDisplayUrl)) {
      setVideoStatus('finished');
      setIsVideoVisible(true);
      setDecodedFrameReady(true);
    }
    const pv = videoPreviewRef.current;
    if (!pv) {
      pendingKeyboardPlayRef.current = true;
      return;
    }
    pendingKeyboardPlayRef.current = false;
    pv.warmupDecode?.();
    pv.setVolume(uiVolume > 0 ? uiVolume : 1);
    pv.play();
  }, [id, isPreviewPlaying, uiVolume, videoDisplayUrl]);

  const handleExternalVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const next = parseFloat(e.target.value);
    if (!Number.isFinite(next)) return;
    setUiVolume(next);
    videoPreviewRef.current?.setVolume(next);
  }, []);

  const showExternalPlayerControls =
    showDetailedUi && showNodeChrome && !!outputVideo && !!videoDisplayUrl && shouldRenderVideo;
  const showFloatingTopActions = showDetailedUi && showNodeChrome && !progress;
  const showBottomActionRow =
    showNodeChrome &&
    (canUseBilibiliGrab || outputVideo || hasIncomingReferenceVideo || hasIncomingVideoModuleEdge);

  const spaceKeyboardActive =
    selected &&
    hasRenderableVideo &&
    !!videoDisplayUrl &&
    shouldRenderVideo &&
    !showTrimModal &&
    !showBilibiliModal &&
    !(progress > 0);

  useEffect(() => {
    if (!spaceKeyboardActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.code !== 'Space') return;
      if (e.repeat) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if ((window as Window & { __nexflowVoiceModalOpen?: boolean }).__nexflowVoiceModalOpen) return;
      e.preventDefault();
      e.stopPropagation();
      handleExternalTogglePlay();
      const active = document.activeElement as HTMLElement | null;
      if (active?.getAttribute?.('role') === 'button' && active.tabIndex === -1) {
        active.blur();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [spaceKeyboardActive, handleExternalTogglePlay]);

  useEffect(() => {
    if (!showExternalPlayerControls) setPlayerControlsHost(null);
  }, [showExternalPlayerControls]);

  useEffect(() => {
    if (!showNodeChrome) setExternalPlaybackHeld(false);
  }, [showNodeChrome]);

  /** 空格/播放条起播时 video 可能尚未挂载，挂载后补 play */
  useEffect(() => {
    if (!pendingKeyboardPlayRef.current || !externalPlaybackHeld || isPreviewPlaying) return;
    const pv = videoPreviewRef.current;
    if (!pv) return;
    pendingKeyboardPlayRef.current = false;
    if (videoDisplayUrl && readyVideoSrcSetRef.current.has(videoDisplayUrl)) {
      setVideoStatus('finished');
      setIsVideoVisible(true);
      setDecodedFrameReady(true);
    }
    pv.warmupDecode?.();
    pv.setVolume(uiVolume > 0 ? uiVolume : 1);
    pv.play();
  }, [
    externalPlaybackHeld,
    isPreviewPlaying,
    shouldMountVideoTag,
    effectiveDecodePermission,
    shouldRenderVideo,
    videoDisplayUrl,
    uiVolume,
  ]);

  useEffect(() => {
    if (!isPreviewPlaying || !videoDisplayUrl) return;
    if (readyVideoSrcSetRef.current.has(videoDisplayUrl)) {
      setVideoStatus('finished');
      setIsVideoVisible(true);
      setDecodedFrameReady(true);
    }
  }, [isPreviewPlaying, videoDisplayUrl]);

  const floatTopPillBtn = (extra = '') =>
    isDarkMode
      ? `nodrag flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15 hover:bg-white/25 text-white transition-colors ${extra}`
      : `nodrag flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/90 hover:bg-white text-gray-800 border border-gray-200/80 shadow-sm transition-colors ${extra}`;

  const videoPlaybackControlsBar = (
    <VideoPlaybackControlsBar
      isDarkMode={isDarkMode}
      isPlaying={isPreviewPlaying}
      currentTime={uiCurrentTime}
      displayDuration={uiDuration || videoDurationRef.current}
      volume={uiVolume}
      videoPreviewRef={videoPreviewRef}
      setCurrentTime={setUiCurrentTime}
      onTogglePlay={handleExternalTogglePlay}
      onVolumeChange={handleExternalVolumeChange}
      className="pointer-events-auto w-full max-w-[min(100%,320px)]"
    />
  );

  /** 仅当 video 层已就绪后再藏 poster，避免黑屏有声 */
  const videoLayerVisible =
    shouldMountVideoTag &&
    effectiveDecodePermission &&
    (videoStatus === 'finished' || isVideoVisible);
  const hidePosterDuringActivePlayback =
    isPreviewPlaying &&
    !isPaused &&
    videoLayerVisible &&
    decodedFrameReady;

  if (isVideoPlaybackPerfDebugEnabled()) {
    recordVideoNodeRender(id);
  }

  return (
    <div
      ref={nodeRef}
      data-id={id}
      style={{
        width: size.w,
        height: size.h,
        minWidth: layoutMinW,
        minHeight: layoutMinH,
        isolation: 'isolate',
        transform: 'translateZ(0)',
        willChange: data?._isResizing ? 'transform, width, height' : 'transform',
        transition: data?._isResizing || dragging
          ? 'none'
          : `${NODE_SIZE_TRANSITION}, box-shadow 0.2s, border-color 0.2s`,
      }}
      className={`custom-node-container nexflow-video-node group relative rounded-2xl overflow-visible ${
        hasRenderableVideo
          ? 'p-0 bg-transparent shadow-none custom-node-container--transparent'
          : `${isDarkMode ? 'p-4 nexflow-glass-panel' : 'p-4 apple-panel-light'}`
      } ${showSelectedChrome && !isPreviewPlaying && isDarkMode && !data?._isResizing ? 'ring-2 ring-green-400/80' : ''} ${showSelectedChrome && !isPreviewPlaying && !isDarkMode && !data?._isResizing ? 'ring-2 ring-green-500' : ''} ${data?._isResizing ? '!shadow-none !ring-0' : ''} transition-all duration-200`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClickCapture={() => {
        if (!isCanvasPickDigitalHumanVideoTarget()) return;
        const ref = (
          (data?.outputVideo as string | undefined) ||
          (data?.originalVideoUrl as string | undefined) ||
          (data?.referenceVideoUrl as string | undefined) ||
          outputVideo ||
          ''
        ).trim();
        if (!ref) return;
        dispatchCanvasPickNode(id);
      }}
    >
      {/* 统一输入点：自动识别 Image（图生视频）、Audio（口型同步）、Video（参考视频） */}
      <Handle type="target" position={Position.Left} id="input" style={{ top: '50%' }} className={`nexflow-plus-handle nexflow-plus-handle-left ${showPlaceholder ? 'opacity-0 pointer-events-none' : ''}`} title="输入图片/音频/参考视频" />
      <Handle type="source" position={Position.Right} id="output" className={`nexflow-plus-handle nexflow-plus-handle-right ${showPlaceholder ? 'opacity-0 pointer-events-none' : ''}`} />
      <div className="node-wrapper absolute inset-0 rounded-2xl" style={{ contain: 'layout' }}>
      <div
        className={`absolute inset-0 rounded-2xl ${
          isPreviewPlaying && !data?._isResizing ? 'nexflow-media-playing-glow' : ''
        }`}
      >
      {/* 始终渲染完整内容；poster-layer 永久挂载，严禁被 showPlaceholder 替换为 icon */}
      <>
      {/* 全模块覆盖进度条（生成中时纯色遮罩，不显示其他内容） */}
      <ModuleProgressBar
        visible={progress > 0}
        progress={progress}
        solidBackground={isDarkMode ? '#1C1C1E' : '#f5f5f5'}
        progressMessage={progress > 0 ? (data?.progressMessage || wc.progressVideo) : undefined}
        borderRadius={16}
        onFadeComplete={() => onDataChange?.(id, { progress: 0 })}
      />

      {/* 视频内容显示区域：运行中由进度条遮罩覆盖，再显示视频/错误/占位；悬停预览（静音），移开停止 */}
      <div
        className={`custom-scrollbar w-full h-full flex items-center justify-center overflow-auto relative ${
          hasRenderableVideo ? 'p-0' : 'p-2'
        }`}
        onMouseEnter={() => {
          setIsVideoAreaHovered(true);
          setHoveredVideoNodeId(id);
          setActiveVideoNodeId(id);
          // 悬停时主动预热解码，减少首帧等待
          videoPreviewRef.current?.warmupDecode?.();
          if (videoDisplayUrl && readyVideoSrcSetRef.current.has(videoDisplayUrl)) {
            setVideoStatus('finished');
            setIsVideoVisible(true);
            setDecodedFrameReady(true);
          }
        }}
        onMouseLeave={() => {
          if (dragging) return;
          const keepPlaying = externalPlaybackHeld && isPreviewPlaying;
          try {
            const pv = videoPreviewRef.current;
            if (pv) {
              if (!keepPlaying) {
                pv.pause();
              }
              const raw = pv.getCurrentTimeSec?.();
              if (raw != null && Number.isFinite(raw)) {
                lastPlaybackMediaTimeRef.current = raw;
                setResumePlaybackSec(raw);
                recordPlaybackPersistCall('VideoNode.onMouseLeave');
                onDataChange?.(id, { playbackCurrentTimeSec: raw });
              }
              if (!keepPlaying && videoDisplayUrl && !isLibraryReferenceVideo) {
                pv.captureCurrentFrame?.(videoDisplayUrl, onFrameCaptured);
              }
              if (!keepPlaying && isLibraryReferenceVideo) {
                pv.releaseVideo?.();
                setVideoStatus('loading');
                setDecodedFrameReady(true);
              }
            }
          } catch {
            /* ignore */
          }
          if (!keepPlaying) {
            setIsVideoAreaHovered(false);
            setHoveredVideoNodeId(null);
            scheduleClearActiveVideoNodeId();
          }
        }}
      >
        {outputVideo ? (
          <div className="relative w-full h-full" style={{ willChange: 'transform', contain: 'content', transform: 'translateZ(0)' }}>
            {/* Texture Layer：始终渲染 img，不受 shouldRenderVideo 限制，永久挂载 */}
            <div
              className="poster-layer z-0 absolute inset-0 rounded-2xl overflow-hidden"
              style={{
                transform: 'translateZ(0)',
                visibility: hidePosterDuringActivePlayback ? 'hidden' : 'visible',
              }}
              aria-hidden={hidePosterDuringActivePlayback ? true : undefined}
            >
              {posterFillContent}
            </div>
            {/* Video Layer：仅 shouldRenderVideo 且 !isInteracting 时挂载 video，缩放/拖拽中不渲染避免闪烁 */}
            <div className="video-layer z-10 absolute inset-0 rounded-2xl overflow-hidden" style={{ transform: 'translateZ(0)' }}>
              {shouldRenderVideo && !isInteracting && (() => {
                const showVideo = shouldMountVideoTag && effectiveDecodePermission;
                return showVideo ? (
                  <AnimatePresence mode="sync">
                    <motion.div
                      key={videoDisplayUrl}
                      initial={{ opacity: 0 }}
                      animate={{
                        opacity: videoLayerVisible ? 1 : 0,
                        filter:
                          isLibraryReferenceVideo || videoLayerVisible ? 'blur(0px)' : 'blur(8px)',
                      }}
                      exit={{ opacity: 0 }}
                      transition={{
                        duration:
                          isLibraryReferenceVideo || isInteractionVisualLock
                            ? 0
                            : !isInteractionVisualLock && !isFastMoving
                              ? isVideoAreaHovered
                                ? VIDEO_HOVER_FADE_DURATION
                                : VIDEO_FADE_DURATION
                              : 0.12,
                        ease: FOCUS_EASE,
                      }}
                      className="absolute inset-0 w-full h-full"
                    >
                      {/* 悬停时 unmute：避免 Chromium 静音态极简白条；选中时也显示原生 controls 条 */}
                      <VideoPreview
                        ref={videoPreviewRef}
                        src={videoDisplayUrl}
                        initialPlaybackTimeSec={resumePlaybackSec}
                        originalRemoteUrl={data?.originalVideoUrl}
                        poster={effectivePosterSrc || undefined}
                        className="w-full h-full bg-transparent rounded-2xl object-contain"
                        style={{ borderRadius: 16 }}
                        preload={playbackActive ? 'auto' : isLibraryReferenceVideo ? 'none' : 'metadata'}
                        playsInline
                        muted={!playbackActive}
                        loop
                        controls={false}
                        fixFullscreenForTransformedParent
                        portalFullscreenTitle={vt.previewVideoFullscreen}
                        portalFullscreenExitTitle={vt.previewVideoExitFullscreen}
                        onLoadedMetadata={(w, h, d) => {
                          handleVideoLoadedMetadata(w, h, d);
                          if (d != null && Number.isFinite(d) && d > 0) setUiDuration(d);
                        }}
                        onCanPlay={() => {
                          if (videoDisplayUrl) {
                            readyVideoSrcSetRef.current.add(videoDisplayUrl);
                            if (
                              !isLibraryReferenceVideo &&
                              !effectivePosterSrc &&
                              firstFrameCapturedForUrlRef.current !== videoDisplayUrl
                            ) {
                              firstFrameCapturedForUrlRef.current = videoDisplayUrl;
                              videoPreviewRef.current?.captureCurrentFrame?.(videoDisplayUrl, onFrameCaptured);
                            }
                          }
                          setVideoStatus('finished');
                          setIsVideoVisible(true);
                        }}
                        onDecodedFrame={handleDecodedFrame}
                        isPaused={isPaused}
                        onPlayingChange={setIsPreviewPlaying}
                        onUiPlaybackTick={handleUiPlaybackTick}
                        onLastFrameCapture={onFrameCaptured}
                        onPlaybackTime={handlePreviewPlaybackTime}
                      />
                    </motion.div>
                  </AnimatePresence>
                ) : null;
              })()}
            </div>
            {showVideoDecodeLayer ? (
              <div
                className={`pointer-events-none absolute inset-0 z-[25] rounded-2xl overflow-hidden transition-opacity duration-200 ease-out ${
                  decodedFrameReady ? 'opacity-0' : 'opacity-100'
                }`}
                style={{ transform: 'translateZ(0)' }}
                aria-hidden
              >
                {posterFillContent}
              </div>
            ) : null}
          </div>
        ) : errorMessage ? (
          <div className="flex flex-col items-center justify-center gap-3 p-4">
            <div className={`text-2xl ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
              ⚠️
            </div>
            <p className={`text-sm font-semibold text-center ${isDarkMode ? 'text-red-300' : 'text-red-700'}`}>
              {wc.genFailedTitle}
            </p>
            <p className={`text-xs text-center line-clamp-3 ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`}>
              {userFacingErrorMessage(errorMessage, locale)}
            </p>
            {!messageContainsRefundHint(userFacingErrorMessage(errorMessage, locale)) &&
            !isLocalOnlineVideoImportError(errorMessage) ? (
              <p className={`text-[11px] text-center ${isDarkMode ? 'text-amber-400/90' : 'text-amber-700'}`}>
                {refundHintForLocale(locale)}
              </p>
            ) : null}
          </div>
        ) : (
          <p className={isDarkMode ? 'text-white/60' : 'text-gray-500'}>
            {wc.waitingForVideo}
          </p>
        )}
      </div>
      </>
      </div>
      </div>

      {showDetailedUi && showNodeChrome ? (
        <div className="title-area pointer-events-auto absolute -top-7 left-0 z-10 max-w-full overflow-hidden">
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                setIsEditingTitle(false);
                if (onDataChange && data?.title !== title) {
                  onDataChange(id, { title });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  setIsEditingTitle(false);
                  if (onDataChange && data?.title !== title) {
                    onDataChange(id, { title });
                  }
                }
                if (e.key === 'Escape') {
                  setIsEditingTitle(false);
                  setTitle(data?.title || 'video');
                }
              }}
              className={`bg-transparent outline-none font-bold text-xs ${
                isDarkMode ? 'text-white/80' : 'text-gray-900'
              }`}
              style={{
                caretColor: isDarkMode ? '#0A84FF' : '#22c55e',
                minWidth: '40px',
                maxWidth: '120px',
              }}
              title="编辑标题"
              autoFocus
            />
          ) : (
            <span
              onClick={handleTitleDoubleClick}
              className={`block max-w-[280px] truncate font-bold text-xs cursor-pointer select-none ${
                isDarkMode ? 'text-white/80' : 'text-gray-900'
              } hover:opacity-70 transition-opacity`}
            >
              {title || 'video'}
            </span>
          )}
        </div>
      ) : null}

      {showFloatingTopActions ? (
        <div
          className="nodrag nopan pointer-events-auto absolute -top-14 left-0 right-0 z-10 flex justify-center gap-2"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          {hasRenderableVideo && videoDisplayUrl ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                handleDownloadVideo();
              }}
              className={floatTopPillBtn()}
              title="下载"
              aria-label="下载"
            >
              <Download className={`h-4 w-4 shrink-0 ${isDarkMode ? 'text-white/90' : 'text-gray-700'}`} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              handleUploadVideo();
            }}
            className={floatTopPillBtn()}
            title="上传视频"
            aria-label="上传视频"
          >
            <Upload className={`h-4 w-4 shrink-0 ${isDarkMode ? 'text-white/90' : 'text-gray-700'}`} />
          </button>
          {hasRenderableVideo && videoDisplayUrl ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                videoPreviewRef.current?.openPortalFullscreen?.();
              }}
              className={floatTopPillBtn()}
              title={vt.previewVideoFullscreen}
              aria-label={vt.previewVideoFullscreen}
            >
              <Maximize2 className={`h-4 w-4 shrink-0 ${isDarkMode ? 'text-white/90' : 'text-gray-700'}`} />
            </button>
          ) : null}
        </div>
      ) : null}

      {showExternalPlayerControls ? (
        <div
          ref={setPlayerControlsHost}
          className="nodrag nopan node-floating-toolbar pointer-events-none absolute top-full left-0 right-0 z-10 mt-[calc(0.25rem+3mm)] flex justify-center overflow-visible px-1"
        />
      ) : null}

      {showExternalPlayerControls && playerControlsHost
        ? createPortal(videoPlaybackControlsBar, playerControlsHost)
        : null}

      {/* 导入在线视频（B 站 / YouTube，本机 yt-dlp）+ 视频去水印 + 裁剪：选中或播放中显示在模块下方 */}
      {showBottomActionRow ? (
        <div
          className={`nodrag nopan absolute top-full left-0 right-0 flex justify-center items-center gap-2 z-10 px-1 ${
            showExternalPlayerControls ? 'mt-[calc(2.85rem+3mm)]' : 'mt-1.5'
          }`}
          style={{ pointerEvents: 'all' }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          {canUseBilibiliGrab ? (
            <button
              type="button"
              disabled={bilibiliFetching || trimming || isVideoGenerating || isVideoWatermarkLoading}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                if (bilibiliFetching || trimming || isVideoGenerating || isVideoWatermarkLoading) return;
                setBilibiliUrlDraft('');
                setShowBilibiliModal(true);
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all text-white ${
                bilibiliFetching || trimming || isVideoGenerating || isVideoWatermarkLoading
                  ? 'bg-violet-500/70 cursor-not-allowed opacity-80'
                  : 'bg-violet-600 hover:bg-violet-500'
              }`}
              title={vt.bilibiliGrabButton}
            >
              {bilibiliFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              {vt.bilibiliGrabButton}
            </button>
          ) : null}
          {hasIncomingReferenceVideo || hasIncomingVideoModuleEdge || outputVideo ? (
            <div
              className="relative inline-flex flex-col items-center"
              onMouseEnter={() => setVideoWatermarkPriceHover(true)}
              onMouseLeave={() => setVideoWatermarkPriceHover(false)}
            >
              <button
                type="button"
                disabled={bilibiliFetching || trimming || isVideoGenerating || isVideoWatermarkLoading}
                title={vt.videoWatermarkTitle}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (bilibiliFetching || trimming || isVideoGenerating || isVideoWatermarkLoading) return;
                  /** 上游传入的参考视频（Workspace 写入 data.referenceVideoUrl）；结果始终落在当前模块 outputVideo */
                  const ref = ((data?.referenceVideoUrl || '') as string).trim();
                  const selfRaw = (outputVideo || data?.originalVideoUrl || '').trim();
                  const edges = getEdges();
                  const nodes = getNodes();
                  let urlFromUpstreamEdge = '';
                  for (const ed of edges) {
                    if (ed.target !== id) continue;
                    const src = nodes.find((n) => n.id === ed.source);
                    if (!src || (src.type !== 'video' && src.type !== 'wanAnimate')) continue;
                    const sd = src.data as { outputVideo?: string; originalVideoUrl?: string } | undefined;
                    const u = ((sd?.originalVideoUrl || sd?.outputVideo) || '').trim();
                    if (u) {
                      urlFromUpstreamEdge = normalizeVideoUrlForNode(u);
                      break;
                    }
                  }
                  const urlToProcess =
                    (ref && normalizeVideoUrlForNode(ref)) ||
                    urlFromUpstreamEdge ||
                    (selfRaw ? normalizeVideoUrlForNode(selfRaw) : '');
                  if (!urlToProcess) {
                    showAlert(vt.videoWatermarkNeedVideo);
                    return;
                  }
                  if (!window.electronAPI?.videoWatermarkRemoval || !window.electronAPI?.createVideoLocalResourceFromUrl) {
                    showAlert(vt.videoWatermarkNotSupported);
                    return;
                  }
                  void (async () => {
                    const wmProgressText = locale === 'en' ? 'Removing watermark…' : '视频去水印中…';
                    const wmFinishingText = locale === 'en' ? 'Finalizing…' : '正在整理结果…';
                    setIsVideoWatermarkLoading(true);
                    setErrorMessage('');
                    onDataChange?.(id, {
                      errorMessage: undefined,
                      progress: 6,
                      progressMessage: wmProgressText,
                    });
                    try {
                      const result = await window.electronAPI.videoWatermarkRemoval(urlToProcess, 0.2);
                      if (!result?.success || !result.videoUrl) {
                        throw new Error(vt.videoWatermarkFailed);
                      }
                      onDataChange?.(id, {
                        progress: 72,
                        progressMessage: wmFinishingText,
                        errorMessage: undefined,
                      });
                      const local = await window.electronAPI.createVideoLocalResourceFromUrl(
                        projectId || undefined,
                        result.videoUrl,
                      );
                      onDataChange?.(id, {
                        outputVideo: local.originalUrl,
                        originalVideoUrl: result.videoUrl,
                        errorMessage: undefined,
                        videoAsset: {
                          poster: local.posterUrl,
                          ghost: local.ghostBase64,
                          width: local.width,
                          height: local.height,
                        },
                        progress: 100,
                        progressMessage: '',
                      });
                    } catch (err: unknown) {
                      const msg = err instanceof Error ? err.message : vt.videoWatermarkFailed;
                      setErrorMessage(msg);
                      onDataChange?.(id, { errorMessage: msg, progress: 0, progressMessage: '' });
                    } finally {
                      setIsVideoWatermarkLoading(false);
                    }
                  })();
                }}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all text-white ${
                  bilibiliFetching || trimming || isVideoGenerating || isVideoWatermarkLoading
                    ? 'bg-blue-500/70 cursor-not-allowed opacity-80'
                    : 'bg-blue-600 hover:bg-blue-500'
                }`}
              >
                {isVideoWatermarkLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Eraser className="w-3.5 h-3.5" />
                )}
                {vt.videoWatermarkButton}
              </button>
              <span
                className={`absolute left-1/2 top-full z-20 mt-1 w-max max-w-[220px] -translate-x-1/2 text-center text-xs font-medium px-2 py-1 rounded shadow-md transition-all duration-200 ease-out ${
                  isDarkMode ? 'text-yellow-200 bg-yellow-900/90 ring-1 ring-yellow-500/35' : 'text-yellow-800 bg-yellow-100 ring-1 ring-yellow-300/60'
                } ${
                  videoWatermarkPriceHover
                    ? 'pointer-events-none translate-y-0 opacity-100'
                    : 'pointer-events-none translate-y-2 opacity-0'
                }`}
                title={vt.videoWatermarkPriceTitle}
              >
                {locale === 'en'
                  ? `${videoWatermarkDisplayYuanbao} ${vt.creditsSuffix}`
                  : `${videoWatermarkDisplayYuanbao}${vt.creditsSuffix}`}
              </span>
            </div>
          ) : null}
          {outputVideo ? (
            <>
              <div
                className="relative inline-flex flex-col items-stretch"
                onMouseEnter={() => setSplitFramesMenuHover(true)}
                onMouseLeave={() => {
                  setSplitFramesMenuHover(false);
                  setSplitFramesMenuOpen(false);
                }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  className={`flex items-center gap-0.5 px-2 py-1 rounded-lg text-xs font-medium transition-all text-white select-none ${
                    trimming || isVideoWatermarkLoading || isSplitFramesBusy || isVideoGenerating || bilibiliFetching
                      ? 'bg-amber-500/70 cursor-not-allowed opacity-80'
                      : 'bg-amber-600/90 hover:bg-amber-600 cursor-pointer'
                  } ${(splitFramesMenuHover || splitFramesMenuOpen) && !isSplitFramesBusy ? 'ring-1 ring-white/30' : ''}`}
                  title={vt.videoFrameSplitHoverHint}
                  aria-label={vt.videoFrameSplitHoverHint}
                  aria-expanded={splitFramesMenuOpen || splitFramesMenuHover}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    ev.preventDefault();
                    if (trimming || isVideoWatermarkLoading || isSplitFramesBusy || isVideoGenerating || bilibiliFetching) {
                      return;
                    }
                    setSplitFramesMenuOpen((open) => !open);
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key !== 'Enter' && ev.key !== ' ') return;
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (trimming || isVideoWatermarkLoading || isSplitFramesBusy || isVideoGenerating || bilibiliFetching) {
                      return;
                    }
                    setSplitFramesMenuOpen((open) => !open);
                  }}
                >
                  {isSplitFramesBusy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <LayoutGrid className="w-3.5 h-3.5" />
                  )}
                  <span>{vt.videoFrameSplitButton}</span>
                  <ChevronDown className="w-3 h-3 shrink-0 opacity-90" aria-hidden />
                </div>
                {(splitFramesMenuHover || splitFramesMenuOpen) &&
                  !trimming &&
                  !isVideoWatermarkLoading &&
                  !isSplitFramesBusy &&
                  !isVideoGenerating &&
                  !bilibiliFetching && (
                    <div
                      className="absolute left-0 top-full z-[60] min-w-[8.5rem] pt-0.5"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      <div
                        className={`rounded-lg border py-1 shadow-xl ${
                          isDarkMode ? 'bg-zinc-900 border-white/15 text-white/95' : 'bg-white border-gray-200 text-gray-900'
                        }`}
                      >
                        {VIDEO_FRAME_SPLIT_INTERVALS.map((sec) => (
                          <button
                            key={sec}
                            type="button"
                            className={`w-full text-left px-3 py-2 text-xs font-medium transition-colors ${
                              isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                            }`}
                            onClick={(ev) => {
                              void handleSplitVideoFrames(sec, ev);
                            }}
                          >
                            {vt.videoFrameSplitInterval(sec)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
              <button
                type="button"
                disabled={trimming || isVideoWatermarkLoading || isSplitFramesBusy}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (trimming || isVideoWatermarkLoading || isSplitFramesBusy) return;
                  handleTrimClick();
                }}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all text-white ${
                  trimming || isVideoWatermarkLoading || isSplitFramesBusy
                    ? 'bg-green-500/70 cursor-not-allowed opacity-80'
                    : 'bg-green-500 hover:bg-green-600'
                }`}
                title="裁剪视频片段"
              >
                {trimming ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Scissors className="w-3.5 h-3.5" />
                )}
                裁剪
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {showBilibiliModal && canUseBilibiliGrab ? (
        <VideoBilibiliGrabModal
          isDarkMode={isDarkMode}
          urlDraft={bilibiliUrlDraft}
          onUrlDraftChange={setBilibiliUrlDraft}
          modalTitle={vt.bilibiliModalTitle}
          placeholder={vt.bilibiliUrlPlaceholder}
          confirmLabel={vt.bilibiliModalConfirm}
          cancelLabel={vt.bilibiliModalCancel}
          onCancel={() => {
            setShowBilibiliModal(false);
            setBilibiliUrlDraft('');
          }}
          onConfirm={() => void handleBilibiliGrabConfirm()}
        />
      ) : null}

      {showGrabProxyGuide ? (
        <VideoGrabProxyGuideModal
          isDarkMode={isDarkMode}
          title={vt.grabProxyGuideTitle}
          okLabel={vt.grabProxyGuideOk}
          onDismiss={() => setShowGrabProxyGuide(false)}
        />
      ) : null}

      {/* 全屏背景虚化的视频裁剪弹窗 */}
      {showTrimModal && (
        <VideoTrimModal
          videoUrl={videoDisplayUrl || outputVideo || data?.originalVideoUrl || ''}
          isDarkMode={isDarkMode}
          initialTrimStart={parseFloat(trimStartSec) || 0}
          initialTrimEnd={parseFloat(trimEndSec) || 0}
          trimming={trimming}
          trimError={trimError}
          onConfirm={(start, end) => handleTrimConfirm(start, end)}
          onCancel={() => !trimming && setShowTrimModal(false)}
        />
      )}
    </div>
  );
};

// 自定义比较函数：position 不参与比较，严禁坐标移动触发重渲染
export const VideoNode = memo(VideoNodeComponent, (prevProps, nextProps) => {
  return (
    prevProps.id === nextProps.id &&
    prevProps.selected === nextProps.selected &&
    prevProps.dragging === nextProps.dragging &&
    prevProps.isDarkMode === nextProps.isDarkMode &&
    prevProps.data?.outputVideo === nextProps.data?.outputVideo &&
    prevProps.data?.referenceVideoUrl === nextProps.data?.referenceVideoUrl &&
    prevProps.data?.width === nextProps.data?.width &&
    prevProps.data?.height === nextProps.data?.height &&
    prevProps.data?.title === nextProps.data?.title &&
    prevProps.data?.progress === nextProps.data?.progress &&
    prevProps.data?.progressMessage === nextProps.data?.progressMessage &&
    prevProps.data?.errorMessage === nextProps.data?.errorMessage &&
    prevProps.data?.videoAsset?.poster === nextProps.data?.videoAsset?.poster &&
    prevProps.data?.videoAsset?.ghost === nextProps.data?.videoAsset?.ghost &&
    prevProps.data?._isResizing === nextProps.data?._isResizing
  );
});
VideoNode.displayName = 'VideoNode';

