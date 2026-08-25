// @ts-nocheck
import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { useViewportIntersection } from '../../hooks/useViewportIntersection';
import { Handle, Position, NodeProps, useReactFlow, useStore } from 'reactflow';
import { createPortal } from 'react-dom';
import { Film, Plus, Play, Pause, Volume2, VolumeX, Video, Maximize2, Minimize2, Trash2, Download, RotateCcw, Scissors, ZoomIn, ZoomOut, Magnet, ChevronDown, Loader2 } from 'lucide-react';
import { normalizeVideoUrl } from '../../utils/normalizeVideoUrl';
import { mapProjectPath } from '../../utils/pathMapper';
import {
  buildVideoSpliceClipsFromEdges,
  mergeProbedTimelineClipDuration,
  resolveSourceMediaDurationSec,
  needsTimelineDurationProbe,
  needsDirectorLockedClipDurationProbe,
  effectiveTimelineClipDurationSec,
  probeTimelineMediaDuration,
  resolveTimelineMediaFromSource,
  sanitizeTimelineClipTrim,
  timelineClipsFingerprint,
} from '../../utils/timelineSourceMedia';
import { captureVideoThumbnails, captureVideoFirstFrame } from '../../utils/videoThumbnails';
import { decodeAudioWaveform } from '../../utils/audioWaveform';
import { TIMELINE_PREVIEW_ENABLED, TIMELINE_FIRST_FRAME_ENABLED } from '../../config/timelinePreviewConfig';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { videoSpliceT } from '../../i18n/videoSpliceI18n';
import { setVideoSpliceFullscreenNodeId } from '../../utils/globalInteractionStore';
import {
  measureWorkspaceHeaderBottom,
  WORKSPACE_CANVAS_OVERLAY_Z,
  WORKSPACE_HEADER_SELECTOR,
} from '../../utils/workspaceChromeLayout';
import { scratchTintClass, type ScratchColorId } from '../../theme/scratchColors';
import { scaleModulePx } from '../../utils/moduleDisplayScale';
import {
  DEFAULT_SPLICE_PREVIEW_ASPECT_ID,
  resolveSpliceExportDimensions,
  resolveSplicePreviewAspectGroup,
  VideoSpliceAspectRatioDropdown,
} from './VideoSpliceAspectRatioDropdown';
import { resolveCollage1080pDefaultSize } from './photoCollageAspectRatio';
import TimelineClipFilmstrip from './TimelineClipFilmstrip';
import ClipLayoutTransformOverlay from './ClipLayoutTransformOverlay';
import ClipCropTransformOverlay from './ClipCropTransformOverlay';
import ClipMediaShell from './ClipMediaShell';
import {
  DEFAULT_VIDEO_TRACK_COUNT,
  DEFAULT_IMAGE_CLIP_DURATION_SEC,
  applyBuiltClipsToSpliceData,
  collectSpliceIncomingSourceIds,
  encodeVideoTrackRef,
  clipEndSec,
  clipTimelineDurationSec,
  clipPlaybackEndSec,
  clipPlaybackSpanDurationSec,
  effectiveClipTrimEnd,
  findClipAtTimelineTime,
  isAudioTrackRef,
  isVideoTrackRef,
  normalizeVideoTracks,
  spliceBuiltHasNewConnectedSources,
  spliceRebuildWouldDropConnected,
  videoTrackIndexFromRef,
  clampSpliceAudioVolume,
  SPLICE_AUDIO_VOLUME_MAX,
  SPLICE_AUDIO_VOLUME_SLIDER_PCT_MAX,
  type TimelineTrackRef,
} from '../../utils/videoSpliceTracks';
import {
  DEFAULT_CLIP_LAYOUT,
  isDefaultClipLayout,
  layoutFromSourceRectAndCrop,
  normalizeClipLayout,
  sourceRectFromLayoutAndCrop,
  syncLayoutAfterCropChange,
  type ClipLayout,
  type NormRect,
} from '../../utils/clipLayout';
import {
  DEFAULT_CLIP_CROP,
  isDefaultClipCrop,
  normalizeClipCrop,
  type ClipCrop,
} from '../../utils/clipCrop';

/** 视频剪辑 UI：与登录/账户页一致的 accent / 主按钮色系 */
const SPLICE_UI_VOLUME_FILL = 'bg-gradient-to-r from-sky-600 to-blue-500';
const SPLICE_UI_FILM_ICON = 'text-amber-300/90';
const SPLICE_UI_BOX_SELECT = 'border-2 border-sky-400/70 bg-sky-500/15';
const SPLICE_UI_PLAYHEAD = 'bg-white/45 group-hover:bg-white/70';
const spliceThumbStripBg = (isDarkMode: boolean) =>
  isDarkMode ? 'bg-violet-950/40' : 'bg-[#6D28D9]/50';
/** 视频轨素材条已改为胶片填充，外层不再铺紫色底 */
const spliceVideoClipBg = (_isDarkMode: boolean) => 'bg-transparent border-0 shadow-none';
const spliceAudioClipBg = (isDarkMode: boolean) =>
  isDarkMode
    ? 'bg-amber-950/95 hover:bg-amber-900/95 border border-amber-500/60'
    : 'bg-[#CA8A04]/95 hover:bg-[#EAB308]/95 border border-white/25';

/** 轨道片段：视频、图片或音频 */
export interface TimelineClip {
  id: string;
  type: 'video' | 'image' | 'audio';
  src: string;
  duration: number; // 秒
  startTime: number; // 在时间轴上的起始位置（秒）
  trimStart?: number;
  trimEnd?: number;
  /** 导演规划裁切：探测不得拉长有效轨长 / 左吸附勿压绝对时间 */
  lockTrim?: boolean;
  name?: string;
  /** 来源节点 ID，用于从连接同步素材 */
  sourceNodeId?: string;
  /** 素材单独音量 0–1，默认 1 */
  volume?: number;
  /** 导演 MV：对应镜号，便于生视频后替换图片占位 */
  directorShotNo?: string;
  /** 带透明通道（如色度抠像 WebM）；上层透明时下层轨需叠放显示 */
  hasAlpha?: boolean;
  /**
   * 裁切后画面在合成画布上的占位（归一化 0–1）。缺省为铺满画布。
   * 与 crop 配合：先源裁切，再放入该占位；预览与多轨导出均会应用。
   */
  layout?: ClipLayout;
  /**
   * 源画面裁剪边距（归一化 0–1，相对源素材）。缺省为不裁。
   * 预览与多轨导出均会应用（上层 index 小覆盖下层；透明/局部 layout 露出下方轨）。
   */
  crop?: ClipCrop;
}

type SpliceClipClipboardItem = {
  clip: TimelineClip;
  track: TimelineTrackRef;
};

/** 跨组件实例共享：同一剪辑节点内复制粘贴 */
const spliceClipClipboard: { items: SpliceClipClipboardItem[] | null } = { items: null };

export type VideoSpliceExportPayload = {
  /** 多视频轨（上层 index 小，覆盖下层） */
  videoTracks: TimelineClip[][];
  clips: TimelineClip[];
  audioTracks: TimelineClip[][];
  options: {
    videoTrackVolume: number[];
    videoTrackMuted: boolean[];
    audioTrackVolume: number[];
    audioTrackMuted: boolean[];
    outputWidth?: number;
    outputHeight?: number;
  };
  previewAspectId?: string;
};

export interface VideoSpliceNodeData {
  width?: number;
  height?: number;
  /** @deprecated 迁移至 videoTracks[0] */
  videoClips?: TimelineClip[];
  /** 视频轨道（上层 index 小，预览/导出时覆盖下层） */
  videoTracks?: TimelineClip[][];
  /** 音频轨道（每条轨道是片段数组） */
  audioTracks?: TimelineClip[][];
  /** 当前播放时间（秒） */
  currentTime?: number;
  /** 是否正在播放 */
  isPlaying?: boolean;
  /** @deprecated 迁移至 videoTrackMuted[] */
  videoTrackMuted?: boolean;
  /** 各视频轨道是否静音（按轨道索引） */
  videoTrackMutedList?: boolean[];
  /** 各音频轨道是否静音（按轨道索引） */
  audioTrackMuted?: boolean[];
  /** @deprecated 迁移至 videoTrackVolumeList[] */
  videoTrackVolume?: number;
  /** 各视频轨道音量 0–1，默认 1 */
  videoTrackVolumeList?: number[];
  /** 各音频轨道音量 0–1，默认 1 */
  audioTrackVolume?: number[];
  /** 时间轴缩放：每秒占用的像素数，默认 60 */
  timelinePixelsPerSecond?: number;
  /** 主轨磁吸（旧字段，迁移至 videoTrackLeftSnap / audioTrackLeftSnap） */
  mainTrackMagnet?: boolean;
  /** 所有轨道向左紧凑（旧字段，迁移至 videoTrackLeftSnap / audioTrackLeftSnap） */
  trackLeftSnap?: boolean;
  /** @deprecated 迁移至 videoTrackLeftSnapList[] */
  videoTrackLeftSnap?: boolean;
  /** 各视频轨片段自动向左紧凑排列（按轨道索引），默认 true */
  videoTrackLeftSnapList?: boolean[];
  /** 各音频轨片段自动向左紧凑排列（按轨道索引），默认 true */
  audioTrackLeftSnap?: boolean[];
  /** 自动吸附：靠近其他素材边缘时吸附并显示对齐线，默认 true */
  autoSnap?: boolean;
  /** 预览与导出画面比例（COLLAGE_ASPECT_GROUPS id，默认 16-9） */
  previewAspectId?: string;
  /** 与 previewAspectId 对应的导出分辨率（1080p 档） */
  exportOutputWidth?: number;
  exportOutputHeight?: number;
  /**
   * 片段几何模型版本。
   * 2 = layout 表示裁切后画面占位（与 crop 配套）；缺省/其它 = 旧模型（layout 为未裁源占位）。
   */
  clipGeometryModel?: number;
  /**
   * 外部请求打开全屏剪辑层（时间戳）。可选；导演「剪辑预览」默认只 focus 画布模块，不写此字段。
   */
  requestOpenFullscreenAt?: number;
}

interface VideoSpliceNodeProps extends NodeProps<VideoSpliceNodeData> {
  projectId?: string;
  isDarkMode?: boolean;
  onDataChange?: (
    nodeId: string,
    updates:
      | Partial<VideoSpliceNodeData>
      | ((prev: VideoSpliceNodeData) => Partial<VideoSpliceNodeData>),
  ) => void;
  onExportToCanvas?: (nodeId: string, payload: VideoSpliceExportPayload) => Promise<{ createdAudioNode?: boolean } | void>;
}

const PIXELS_PER_SECOND_DEFAULT = 60;
const PIXELS_PER_SECOND_MIN = 20;
const PIXELS_PER_SECOND_MAX = 200;
const TRACK_HEIGHT = 64;
const RULER_HEIGHT = 28;
const RULER_HEIGHT_FULLSCREEN = 32;
/** 轨道左侧标签/控件的固定宽度，须与刻度尺占位一致（含 px-2 内边距与 gap-1） */
const TIMELINE_ASIDE_PAD_X_PX = 16;
const TIMELINE_ASIDE_INNER_GAP_PX = 4;
const TIMELINE_TRACK_LABEL_PX = 76;
/** 静音 28 + gap 4 + 滑块 32 + gap 4 + 磁吸 28 */
const TIMELINE_TRACK_CONTROLS_PX = 96;
const TIMELINE_TRACK_LABEL_PX_FS = 84;
/** 静音 32 + gap 4 + 滑块 40 + gap 4 + 磁吸 32 */
const TIMELINE_TRACK_CONTROLS_PX_FS = 112;

function resolveLegacyTrackLeftSnap(data: VideoSpliceNodeData | undefined): boolean {
  if (data?.trackLeftSnap != null) return data.trackLeftSnap;
  return data?.mainTrackMagnet !== false;
}

function spliceTimelineAsideWidthPx(labelPx: number, controlsPx: number): number {
  return TIMELINE_ASIDE_PAD_X_PX + labelPx + TIMELINE_ASIDE_INNER_GAP_PX + controlsPx;
}

const SNAP_THRESHOLD_PX = 12;
const DRAG_THRESHOLD_PX = 6; // 超过此像素才视为拖拽，否则为点击选中
/** 剪辑模块默认音频轨数量（视频轨之下，初始 1 条） */
const DEFAULT_AUDIO_TRACK_COUNT = 1;
/** 标题栏 + transport 的大致高度（px） */
const SPLICE_HEADER_PX = 41;
const SPLICE_TRANSPORT_PX = 44;
/** 时间轴底部滚动条滑块高度（与 index.css ::-webkit-scrollbar height 一致） */
const SPLICE_TIMELINE_SCROLLBAR_THUMB_PX = 36;
/** 滚动条下方留白，避免被节点圆角裁切 */
const SPLICE_TIMELINE_SCROLLBAR_PAD_PX = 10;
const SPLICE_TIMELINE_SCROLLBAR_LANE_PX = SPLICE_TIMELINE_SCROLLBAR_THUMB_PX + SPLICE_TIMELINE_SCROLLBAR_PAD_PX;
/** 预览视口固定 16:9，切换导出比例时主模块尺寸不变（空内容时同样保持该视口比例） */
const SPLICE_PREVIEW_VIEWPORT_AR = 16 / 9;
const splicePreviewCanvasBg = (isDarkMode: boolean) =>
  isDarkMode ? 'bg-zinc-500' : 'bg-gray-400';
const splicePreviewViewportBg = (isDarkMode: boolean) =>
  isDarkMode ? 'bg-zinc-950' : 'bg-zinc-800/80';

/** 有效画布：高度固定为视口高度，宽度 = 高度 × 比例（居中显示，超宽时由视口裁切） */
function computeSplicePreviewCanvasSize(
  viewportW: number,
  viewportH: number,
  rw: number,
  rh: number,
): { w: number; h: number } {
  if (viewportH <= 0 || rw <= 0 || rh <= 0) {
    return { w: Math.max(1, viewportW), h: Math.max(1, viewportH) };
  }
  const h = viewportH;
  const w = Math.round((h * rw) / rh);
  return { w: Math.max(1, w), h: Math.max(1, h) };
}
/** 播放头细线宽度 / 拖拽热区（中心对准时间坐标） */
const PLAYHEAD_LINE_PX = 4;
const PLAYHEAD_HIT_PX = 12;
/** 拖动播放头/scrub 时，指针靠近内容区左右缘则自动滚屏 */
const TIMELINE_EDGE_SCROLL_ZONE_PX = 48;
const TIMELINE_EDGE_SCROLL_MIN_PX = 6;
const TIMELINE_EDGE_SCROLL_MAX_PX = 22;
/** 时间轴内可拖选文本（刻度、轨名等） */
const SPLICE_SELECTABLE_TEXT = 'nexflow-splice-selectable';

/** 画布缩放后 getBoundingClientRect 为屏幕像素，offsetWidth 为布局像素 */
function contentScreenXToLayoutPx(clientX: number, contentEl: HTMLElement): number {
  const rect = contentEl.getBoundingClientRect();
  const layoutW = contentEl.offsetWidth;
  if (!rect.width || !layoutW) return clientX - rect.left;
  return ((clientX - rect.left) / rect.width) * layoutW;
}

function contentLayoutPxToViewportX(contentEl: HTMLElement, layoutPx: number): number {
  const rect = contentEl.getBoundingClientRect();
  const layoutW = contentEl.offsetWidth;
  if (!layoutW || !rect.width) return rect.left + layoutPx;
  return rect.left + (layoutPx / layoutW) * rect.width;
}

/** 将屏幕像素偏移转为元素本地 transform 像素（兼容 React Flow 节点缩放） */
function screenOffsetToLocalPx(screenOffset: number, el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  const layoutW = el.offsetWidth;
  if (!rect.width || !layoutW) return screenOffset;
  return (screenOffset / rect.width) * layoutW;
}

function normalizeAudioTracks(tracks: TimelineClip[][] | undefined): TimelineClip[][] {
  const base = (tracks?.length ? tracks.map((t) => [...t]) : [[]]) as TimelineClip[][];
  while (base.length < DEFAULT_AUDIO_TRACK_COUNT) base.push([]);
  return base;
}

const MIN_SPLIT_SEGMENT_SEC = 0.05;

/** 轨道片段拖拽时 left 过渡（其他片段让位，类似项目卡 layout 动画） */
const CLIP_DRAG_MOVE_TRANSITION = 'left 0.16s cubic-bezier(0.34, 1.12, 0.64, 1)';

function timelineClipDurationSec(c: TimelineClip, sourceHint = 0): number {
  const raw = clipTimelineDurationSec(c, sourceHint);
  if (raw > 0) return Math.max(0.1, raw);
  if (c.src && c.type !== 'image') return 0.1;
  return Math.max(0.1, raw);
}

/** 片段在时间轴上的可播放区间（与刻度/剪切判定一致） */
function clipTimelineSpan(clip: TimelineClip, sourceHint = 0): { start: number; end: number } {
  return { start: clip.startTime, end: clipPlaybackEndSec(clip, sourceHint) };
}

function clipContainsTimelineTime(clip: TimelineClip, timelineTime: number, sourceHint = 0): boolean {
  const { start, end } = clipTimelineSpan(clip, sourceHint);
  // 半开区间 [start, end)：必须包含起点，否则播放头停在 0 时预览灰屏
  return timelineTime >= start && (end === Number.POSITIVE_INFINITY || timelineTime < end);
}

function tracksEqual(a: TimelineTrackRef, b: TimelineTrackRef): boolean {
  if (isVideoTrackRef(a) && isVideoTrackRef(b)) {
    return videoTrackIndexFromRef(a) === videoTrackIndexFromRef(b);
  }
  if (isAudioTrackRef(a) && isAudioTrackRef(b)) return a === b;
  return false;
}

function timelineClipDragStyle(
  left: number,
  width: number,
  isDraggingThis: boolean,
  isAnyDragging: boolean,
  pointerLeftPx?: number,
): React.CSSProperties {
  const followPointer = isDraggingThis && pointerLeftPx != null;
  return {
    left: followPointer ? pointerLeftPx : left,
    width,
    minWidth: 24,
    transition: followPointer
      ? 'box-shadow 0.12s ease'
      : isAnyDragging
        ? `${CLIP_DRAG_MOVE_TRANSITION}, box-shadow 0.12s ease`
        : 'none',
    willChange: isAnyDragging ? 'left' : undefined,
    zIndex: isDraggingThis ? 35 : undefined,
    opacity: 1,
    transform: isDraggingThis ? 'scale(1.02)' : undefined,
    boxShadow: isDraggingThis ? '0 12px 32px rgba(0,0,0,0.42)' : undefined,
  };
}

/** 在 timeline 时刻将片段一分为二；返回 null 表示该时刻不在片段有效范围内 */
function splitClipAtTimelineTime(clip: TimelineClip, timelineTime: number): [TimelineClip, TimelineClip] | null {
  const min = MIN_SPLIT_SEGMENT_SEC;
  if (clip.type === 'image') {
    const end = clip.startTime + clip.duration;
    if (timelineTime <= clip.startTime + min || timelineTime >= end - min) return null;
    const d1 = timelineTime - clip.startTime;
    const d2 = end - timelineTime;
    const clip1: TimelineClip = { ...clip, duration: d1, sourceNodeId: undefined };
  const clip2: TimelineClip = {
    ...clip,
    id: `${clip.type}-${Date.now()}-split-${Math.random().toString(36).slice(2, 7)}`,
    startTime: clip.startTime + d1,
    duration: d2,
    sourceNodeId: undefined,
  };
    return [clip1, clip2];
  }
  const ts = clip.trimStart ?? 0;
  let te = clip.trimEnd != null && clip.trimEnd > ts ? clip.trimEnd : clip.duration;
  if (!(te > ts)) te = ts + Math.max(0.1, clip.duration || 0.1);
  const clipStart = clip.startTime;
  const clipEnd = clipStart + Math.max(0, te - ts);
  if (timelineTime <= clipStart + min || timelineTime >= clipEnd - min) return null;
  const splitPoint = ts + (timelineTime - clipStart);
  const sp = Math.max(ts + min, Math.min(te - min, splitPoint));
  if (sp <= ts + 0.001 || sp >= te - 0.001) return null;
  const effDur1 = sp - ts;
  const effDur2 = te - sp;
  const clip1: TimelineClip = {
    ...clip,
    trimStart: ts,
    trimEnd: sp,
    duration: effDur1,
    sourceNodeId: undefined,
  };
  const clip2: TimelineClip = {
    ...clip,
    id: `${clip.type}-${Date.now()}-split-${Math.random().toString(36).slice(2, 7)}`,
    startTime: clipStart + effDur1,
    trimStart: sp,
    trimEnd: te,
    duration: effDur2,
    sourceNodeId: undefined,
  };
  return [clip1, clip2];
}

/** 在轨道上插入片段：插入点及之后的素材整体后移 */
function insertClipsRippleOnTrack(existing: TimelineClip[], incoming: TimelineClip[]): TimelineClip[] {
  if (!incoming.length) return existing.map((c) => ({ ...c }));
  const spanStart = Math.min(...incoming.map((c) => c.startTime));
  const spanEnd = Math.max(...incoming.map((c) => clipEndSec(c)));
  const shiftAmount = Math.max(0, spanEnd - spanStart);
  const shifted = existing.map((c) => {
    const cEnd = clipEndSec(c);
    if (c.startTime >= spanStart - 1e-4 || cEnd > spanStart + 1e-4) {
      return { ...c, startTime: c.startTime + shiftAmount };
    }
    return { ...c };
  });
  return [...shifted, ...incoming].sort((a, b) => a.startTime - b.startTime);
}

/** 根据指针 Y 解析时间轴轨道：0..V-1=视频轨，V..=音频轨 */
function resolveTimelineTrackFromClientY(
  clientY: number,
  timelineEl: HTMLElement,
  rulerHeight: number,
  videoTrackCount: number,
  audioTrackCount: number,
): TimelineTrackRef | null {
  const rect = timelineEl.getBoundingClientRect();
  const y = clientY - rect.top - rulerHeight;
  if (y < 0) return null;
  const visualIdx = Math.floor(y / TRACK_HEIGHT);
  if (visualIdx < videoTrackCount) return encodeVideoTrackRef(visualIdx);
  const audioIdx = visualIdx - videoTrackCount;
  if (audioIdx >= 0 && audioIdx < audioTrackCount) return audioIdx;
  return null;
}

const formatTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const f = Math.floor((sec % 1) * 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${f}`;
};

/** 片段时长显示（如 00:00:17.03） */
const formatDuration = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const f = Math.floor((sec % 1) * 100);
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
};

/** 简易波形条：基于 clipId 生成确定性高度（音频解码失败时回退） */
const getFallbackWaveformBars = (clipId: string, count: number): number[] => {
  let h = 0;
  for (let i = 0; i < clipId.length; i++) h = (h * 31 + clipId.charCodeAt(i)) >>> 0;
  return Array.from({ length: count }, (_, i) => {
    const v = Math.sin((h + i) * 0.5) * 0.4 + Math.sin((h + i * 2) * 0.3) * 0.3 + 0.5;
    return Math.max(0.15, Math.min(0.95, v));
  });
};

const THUMB_SIZE = 28;

/** 调音台式垂直音量推子：0-100，上下拖拽调节 */
const VolumeFader: React.FC<{
  value: number;
  onChange: (v: number) => void;
  width?: number;
  className?: string;
}> = ({ value, onChange, width = 8, className = '' }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const yToValue = (clientY: number) => {
    const el = trackRef.current;
    if (!el) return value;
    const rect = el.getBoundingClientRect();
    const y = rect.bottom - clientY;
    return clamp((y / rect.height) * 100);
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: PointerEvent) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const y = rect.bottom - e.clientY;
      onChange(clamp((y / rect.height) * 100));
    };
    const onUp = () => setIsDragging(false);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, [isDragging, onChange]);

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-valuenow={Math.round(value)}
      aria-valuemin="0"
      aria-valuemax={100}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
        onChange(yToValue(e.clientY));
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 10 : 2;
        if (e.key === 'ArrowUp') { e.preventDefault(); onChange(clamp(value + step)); }
        if (e.key === 'ArrowDown') { e.preventDefault(); onChange(clamp(value - step)); }
      }}
      className={`nodrag nopan h-full flex flex-col justify-end cursor-ns-resize select-none ${className}`}
      style={{ width, minWidth: width }}
      title="Drag to adjust volume (0–100)"
    >
      <div className="flex-1 min-h-0 rounded-sm bg-black/60 border border-white/10 overflow-hidden flex flex-col justify-end shadow-inner">
        <div
          className={`w-full rounded-b-sm ${SPLICE_UI_VOLUME_FILL} transition-colors`}
          style={{ height: `${value}%`, minHeight: value > 0 ? 2 : 0 }}
        />
      </div>
    </div>
  );
};

/** 横向音量推子：0–maxValue（默认 100），左右拖拽调节 */
const VolumeFaderHorizontal: React.FC<{
  value: number;
  onChange: (v: number) => void;
  height?: number;
  width?: number;
  className?: string;
  sliderTitle: string;
  maxValue?: number;
}> = ({ value, onChange, height = 6, width = 48, className = '', sliderTitle, maxValue = 100 }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const clamp = (v: number) => Math.max(0, Math.min(maxValue, v));
  const fillPct = maxValue > 0 ? (clamp(value) / maxValue) * 100 : 0;
  const xToValue = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return value;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    return clamp((x / rect.width) * maxValue);
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: PointerEvent) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      onChange(clamp((x / rect.width) * maxValue));
    };
    const onUp = () => setIsDragging(false);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, [isDragging, onChange, maxValue]);

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-valuenow={Math.round(value)}
      aria-valuemin="0"
      aria-valuemax={maxValue}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
        onChange(xToValue(e.clientX));
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 10 : 2;
        if (e.key === 'ArrowRight') { e.preventDefault(); onChange(clamp(value + step)); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); onChange(clamp(value - step)); }
      }}
      className={`nodrag nopan flex items-center justify-start cursor-ew-resize select-none ${className}`}
      style={{ width, minWidth: width, height }}
      title={sliderTitle}
    >
      <div className="w-full h-full rounded-full bg-black/60 border border-white/10 overflow-hidden flex justify-start shadow-inner">
        <div
          className={`h-full rounded-full ${SPLICE_UI_VOLUME_FILL} transition-colors`}
          style={{ width: `${fillPct}%`, minWidth: value > 0 ? 2 : 0 }}
        />
      </div>
    </div>
  );
};

/** 轨道侧栏：静音 + 横向音量滑块（节省空间） */
const TrackHeaderVolumeSlider: React.FC<{
  md: boolean;
  muted: boolean;
  volume01: number;
  muteTitle: string;
  unmuteTitle: string;
  sliderTitle: string;
  muteBtnClass: string;
  onToggleMute: () => void;
  onVolumeChange: (volume01: number) => void;
  /** 音量倍数上限，默认 1（100%） */
  volumeMax?: number;
  /** 滑条显示上限百分比，默认 100 */
  sliderMaxPct?: number;
}> = ({
  md,
  muted,
  volume01,
  muteTitle,
  unmuteTitle,
  sliderTitle,
  muteBtnClass,
  onToggleMute,
  onVolumeChange,
  volumeMax = 1,
  sliderMaxPct = 100,
}) => (
  <>
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggleMute();
      }}
      className={muteBtnClass}
      title={muted ? unmuteTitle : muteTitle}
    >
      {muted ? (
        <VolumeX className={md ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
      ) : (
        <Volume2 className={md ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
      )}
    </button>
    <VolumeFaderHorizontal
      value={Math.round((volume01 / volumeMax) * sliderMaxPct)}
      onChange={(v) => onVolumeChange((v / sliderMaxPct) * volumeMax)}
      width={md ? 40 : 32}
      height={md ? 7 : 5}
      sliderTitle={sliderTitle}
      maxValue={sliderMaxPct}
    />
  </>
);

/** 图片缩略图：小正方形头像式，显示在开头位置 */
const ImageThumbnail: React.FC<{ clip: TimelineClip; projectId?: string; isDarkMode: boolean }> = ({ clip, projectId, isDarkMode }) => {
  const [src, setSrc] = useState<string>('');
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const rawUrl = normalizeVideoUrl(clip.src);
      try {
        const url = projectId ? await mapProjectPath(rawUrl, projectId) : rawUrl;
        if (!cancelled) setSrc(url);
      } catch {
        if (!cancelled) setSrc(rawUrl);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [clip.src, projectId]);
  return (
    <div className={`flex-1 min-h-0 flex items-center gap-1.5 overflow-hidden pointer-events-none select-none ${spliceThumbStripBg(isDarkMode)}`}>
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
          className="shrink-0 rounded object-cover pointer-events-none select-none"
          style={{ width: THUMB_SIZE, height: THUMB_SIZE, minWidth: THUMB_SIZE, minHeight: THUMB_SIZE }}
        />
      ) : null}
    </div>
  );
};

/** 预览区：映射 local-resource 路径后显示图片片段 */
const PreviewImagePane: React.FC<{
  src: string;
  projectId?: string;
  layout?: ClipLayout | NormRect | null;
  crop?: ClipCrop | null;
  uncroppedFit?: 'contain' | 'fill';
}> = ({
  src,
  projectId,
  layout,
  crop,
  uncroppedFit,
}) => {
  const [resolved, setResolved] = useState('');
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const rawUrl = normalizeVideoUrl(src);
      try {
        const url = projectId ? await mapProjectPath(rawUrl, projectId) : rawUrl;
        if (!cancelled) setResolved(url);
      } catch {
        if (!cancelled) setResolved(rawUrl);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [src, projectId]);
  if (!resolved) return null;
  return (
    <ClipMediaShell layout={layout} crop={crop} uncroppedFit={uncroppedFit}>
      <img src={resolved} alt="" />
    </ClipMediaShell>
  );
};

/** 视频缩略图条：首帧或胶片条，每个视频/图片素材在进度条上显示首帧缩略图 */
const VideoThumbnailStrip: React.FC<{
  clip: TimelineClip;
  width: number;
  projectId?: string;
  isDarkMode: boolean;
}> = ({ clip, width, projectId, isDarkMode }) => {
  const [firstFrame, setFirstFrame] = useState<string>('');
  const [thumbs, setThumbs] = useState<string[]>([]);
  const loadingRef = useRef(false);
  const showFirstFrame = TIMELINE_FIRST_FRAME_ENABLED && !TIMELINE_PREVIEW_ENABLED;
  const showFilmstrip = TIMELINE_PREVIEW_ENABLED;
  useEffect(() => {
    if (clip.type !== 'video' || !clip.src) return;
    let cancelled = false;
    const load = async () => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      try {
        const rawUrl = normalizeVideoUrl(clip.src);
        let url = rawUrl;
        try {
          url = projectId ? await mapProjectPath(rawUrl, projectId) : rawUrl;
        } catch {
          url = rawUrl;
        }
        if (cancelled) return;
        const ts = clip.trimStart ?? 0;
        const te = clip.trimEnd ?? clip.duration;
        if (showFirstFrame) {
          const dataUrl = await captureVideoFirstFrame(url, ts, 48);
          if (!cancelled) setFirstFrame(dataUrl);
        } else if (showFilmstrip) {
          const count = Math.min(20, Math.max(1, Math.floor(te - ts)));
          const list = await captureVideoThumbnails(url, ts, te, count, 16);
          if (!cancelled) setThumbs(list.filter(Boolean));
        }
      } catch {
        if (!cancelled) { setFirstFrame(''); setThumbs([]); }
      } finally {
        loadingRef.current = false;
      }
    };
    load();
    return () => { cancelled = true; };
  }, [clip.id, clip.src, clip.trimStart, clip.trimEnd, clip.duration, projectId, showFirstFrame, showFilmstrip]);
  if (showFirstFrame && firstFrame) {
    return (
      <div className={`flex-1 min-h-0 flex items-center gap-1.5 overflow-hidden pointer-events-none select-none ${spliceThumbStripBg(isDarkMode)}`}>
        <img
          src={firstFrame}
          alt=""
          draggable={false}
          onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
          className="shrink-0 rounded object-cover pointer-events-none select-none"
          style={{ width: THUMB_SIZE, height: THUMB_SIZE, minWidth: THUMB_SIZE, minHeight: THUMB_SIZE }}
        />
      </div>
    );
  }
  if (showFilmstrip && thumbs.length > 0) {
    return (
      <div className={`flex-1 min-h-0 flex items-stretch gap-px px-1 overflow-hidden pointer-events-none select-none ${spliceThumbStripBg(isDarkMode)}`}>
        {thumbs.map((src, i) => (
          <img
            key={i}
            src={src}
            alt=""
            draggable={false}
            onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
            className="flex-1 min-w-0 object-cover rounded-sm pointer-events-none select-none"
            style={{ maxHeight: 20 }}
          />
        ))}
      </div>
    );
  }
  return (
    <div className={`flex-1 min-h-0 ${spliceThumbStripBg(isDarkMode)}`} />
  );
};

/** 音频波形条：从音频解码生成（可配置禁用以降低显存压力） */
const AudioWaveformBars: React.FC<{
  clip: TimelineClip;
  width: number;
  projectId?: string;
  isDarkMode: boolean;
}> = ({ clip, width, projectId, isDarkMode }) => {
  const [bars, setBars] = useState<number[] | null>(null);
  const loadingRef = useRef(false);
  useEffect(() => {
    if (!TIMELINE_PREVIEW_ENABLED || clip.type !== 'audio' || !clip.src) return;
    const count = Math.min(32, Math.max(8, Math.floor(width / 4)));
    let cancelled = false;
    const load = async () => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      try {
        const rawUrl = normalizeVideoUrl(clip.src);
        const url = projectId ? await mapProjectPath(rawUrl, projectId) : rawUrl;
        if (cancelled) return;
        const ts = clip.trimStart ?? 0;
        const te = clip.trimEnd ?? clip.duration;
        const data = await decodeAudioWaveform(url, ts, te, count);
        if (!cancelled) setBars(data);
      } catch {
        if (!cancelled) setBars(null);
      } finally {
        loadingRef.current = false;
      }
    };
    load();
    return () => { cancelled = true; };
  }, [clip.id, clip.src, clip.trimStart, clip.trimEnd, clip.duration, width, projectId]);
  if (!TIMELINE_PREVIEW_ENABLED || bars === null) {
    return <div className={`flex-1 min-h-0 ${isDarkMode ? 'bg-amber-900/50' : 'bg-yellow-700/30'}`} />;
  }
  return (
    <div className="flex-1 flex items-end justify-center gap-0.5 px-2 py-1 min-h-0">
      <div className="absolute left-0 right-0 top-1/2 h-px bg-white/30 -translate-y-1/2 pointer-events-none" />
      {bars.map((h, i) => (
        <div
          key={i}
          className={`flex-1 min-w-[2px] rounded-sm ${isDarkMode ? 'bg-amber-400' : 'bg-yellow-300'}`}
          style={{ height: `${Math.max(4, h * 24)}px` }}
        />
      ))}
    </div>
  );
};

/** 裁剪区间双指针进度条（全屏模式下选中片段时使用） */
const TrimRangeBar: React.FC<{
  duration: number;
  currentTime: number;
  trimStart: number;
  trimEnd: number;
  isDarkMode: boolean;
  onTrimRangeChange: (start: number, end: number) => void;
  onTrackClick: (t: number) => void;
  trimAriaLabel: string;
  trimTrackTitle: string;
}> = ({ duration, currentTime, trimStart, trimEnd, isDarkMode, onTrimRangeChange, onTrackClick, trimAriaLabel, trimTrackTitle }) => {
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

  const handleTrackClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const t = getTimeFromClientX(e.clientX);
      onTrackClick(t);
    },
    [getTimeFromClientX, onTrackClick]
  );

  const handleThumbPointerDown = useCallback((which: 'start' | 'end') => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    draggingRef.current = which;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handleThumbPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const which = draggingRef.current;
      if (!which) return;
      const t = getTimeFromClientX(e.clientX);
      const { start, end } = trimRef.current;
      if (which === 'start') {
        const newStart = clamp(t);
        onTrimRangeChange(newStart, Math.max(newStart, end));
      } else {
        const newEnd = clamp(t);
        onTrimRangeChange(Math.min(newEnd, start), newEnd);
      }
    },
    [getTimeFromClientX, onTrimRangeChange]
  );

  const handleThumbPointerUp = useCallback(() => {
    draggingRef.current = null;
  }, []);

  const trackBg = isDarkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)';
  const selectedColor = isDarkMode ? '#22c55e' : '#16a34a';
  const playedColor = isDarkMode ? 'rgba(34,197,94,0.5)' : 'rgba(22,163,74,0.5)';

  return (
    <div
      ref={trackRef}
      role="group"
      aria-label={trimAriaLabel}
      title={trimTrackTitle}
      className="nodrag nopan relative h-2 w-full rounded-full cursor-pointer select-none"
      style={{ background: trackBg }}
      onClick={(e) => {
        e.stopPropagation();
        handleTrackClick(e);
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-l-full pointer-events-none"
        style={{ width: `${pct(Math.min(currentTime, trimStart))}%`, background: playedColor }}
      />
      <div
        className="absolute inset-y-0 pointer-events-none"
        style={{ left: `${pct(trimStart)}%`, width: `${pct(trimEnd - trimStart)}%`, background: selectedColor }}
      />
      {currentTime > trimStart && currentTime < trimEnd && (
        <div
          className="absolute inset-y-0 pointer-events-none"
          style={{ left: `${pct(trimStart)}%`, width: `${pct(currentTime - trimStart)}%`, background: playedColor }}
        />
      )}
      <div
        className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white shadow cursor-ew-resize z-10 nodrag nopan"
        style={{ left: `calc(${pct(trimStart)}% - 6px)`, background: selectedColor }}
        onPointerDown={handleThumbPointerDown('start')}
        onPointerMove={handleThumbPointerMove}
        onPointerUp={handleThumbPointerUp}
        onPointerLeave={handleThumbPointerUp}
      />
      <div
        className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white shadow cursor-ew-resize z-10 nodrag nopan"
        style={{ left: `calc(${pct(trimEnd)}% - 6px)`, background: selectedColor }}
        onPointerDown={handleThumbPointerDown('end')}
        onPointerMove={handleThumbPointerMove}
        onPointerUp={handleThumbPointerUp}
        onPointerLeave={handleThumbPointerUp}
      />
    </div>
  );
};

/** @deprecated 使用 probeTimelineMediaDuration */
const loadAudioDuration = (url: string, projectId?: string) =>
  probeTimelineMediaDuration(url, 'audio', projectId);

/** @deprecated 使用 probeTimelineMediaDuration */
const loadVideoDuration = (url: string, projectId?: string) =>
  probeTimelineMediaDuration(url, 'video', projectId);

type TimelineMediaKind = 'video' | 'audio' | 'image';

function detectTimelineMediaKind(file: File): TimelineMediaKind | null {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const mime = (file.type || '').toLowerCase();
  if (mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'wmv'].includes(ext)) return 'video';
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'wma'].includes(ext)) return 'audio';
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) return 'image';
  return null;
}

/** 将本地/拖入文件登记到项目 assets，与画布 onDrop 一致，避免 local-resource 403 或路径失效 */
async function ingestFileForTimeline(
  file: File & { path?: string },
  projectId?: string,
): Promise<{ url: string; kind: TimelineMediaKind } | null> {
  const kind = detectTimelineMediaKind(file);
  if (!kind) return null;
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  let url = '';
  try {
    if (file.path && api) {
      if (kind === 'video' && api.createVideoLocalResourceFromFile) {
        const r = await api.createVideoLocalResourceFromFile(projectId, file.path);
        url = r.originalUrl;
      } else if (kind === 'image' && api.createImageLocalResourceFromFile) {
        const r = await api.createImageLocalResourceFromFile(projectId, file.path);
        url = r.previewUrl || r.originalUrl;
      } else if (api.copyFileToProjectAssets) {
        const { savedPath } = await api.copyFileToProjectAssets(projectId, file.path);
        url = `local-resource://${savedPath}`;
      }
    }
    if (!url && file.path) {
      url = `local-resource://${file.path.replace(/\\/g, '/')}`;
    }
    if (!url) {
      if (kind === 'video' && api?.createVideoLocalResourceFromBuffer) {
        const r = await api.createVideoLocalResourceFromBuffer(projectId, file.name || 'clip.mp4', await file.arrayBuffer());
        url = r.originalUrl;
      } else if (kind === 'image' && api?.createImageLocalResourceFromBuffer) {
        const r = await api.createImageLocalResourceFromBuffer(projectId, file.name || 'clip.png', await file.arrayBuffer());
        url = r.previewUrl || r.originalUrl;
      } else if (api?.saveDroppedFileBufferToProjectAssets) {
        const { savedPath } = await api.saveDroppedFileBufferToProjectAssets(
          projectId,
          file.name || (kind === 'audio' ? 'clip.mp3' : 'clip.bin'),
          await file.arrayBuffer(),
        );
        url = `local-resource://${savedPath}`;
      } else {
        url = URL.createObjectURL(file);
      }
    }
    url = normalizeVideoUrl(url);
    if (projectId) url = await mapProjectPath(url, projectId);
    return { url, kind };
  } catch (e) {
    console.warn('[VideoSplice] 导入素材失败:', file.name, e);
    return null;
  }
}

function clipVideoSyncKey(clip: TimelineClip): string {
  return `${clip.id}|${normalizeVideoUrl(clip.src)}`;
}

function setVideoElSrc(el: HTMLVideoElement, url: string) {
  if (!url) return;
  const attr = el.getAttribute('src') || '';
  if (attr === url) return;
  el.setAttribute('src', url);
  try {
    el.load();
  } catch {
    /* ignore */
  }
}

/** seek 后等 seeked，避免未对齐就 play 造成片间卡一帧 */
function seekVideoElement(el: HTMLVideoElement, localTime: number): Promise<void> {
  const t = Math.max(0, localTime);
  try {
    if (el.readyState >= HTMLMediaElement.HAVE_METADATA && Math.abs(el.currentTime - t) <= 0.04) {
      return Promise.resolve();
    }
  } catch {
    /* ignore */
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      el.removeEventListener('seeked', finish);
      window.clearTimeout(timeoutId);
      resolve();
    };
    const timeoutId = window.setTimeout(finish, 350);
    el.addEventListener('seeked', finish, { once: true });
    try {
      el.currentTime = t;
    } catch {
      finish();
    }
  });
}

function setStackedVideoLayerVisible(el: HTMLVideoElement, visible: boolean) {
  el.style.opacity = visible ? '1' : '0';
  el.style.visibility = visible ? 'visible' : 'hidden';
  el.style.pointerEvents = 'none';
}

/** 显式 image，或误标为 video 但 src 实为静态图 */
function clipIsImageMedia(clip: TimelineClip | null | undefined): boolean {
  if (!clip) return false;
  if (clip.type === 'image') return true;
  if (clip.type !== 'video') return false;
  return /\.(png|jpe?g|gif|webp|bmp)(?:$|[?#])/i.test(String(clip.src || ''));
}

function findImageClipAtTimeOnTrack(track: TimelineClip[] | undefined, t: number): TimelineClip | undefined {
  return (track ?? []).find((c) => {
    if (!clipIsImageMedia(c)) return false;
    const dur = clipTimelineDurationSec(c);
    return t >= c.startTime && t < c.startTime + dur;
  });
}

function findVideoClipAtTimeOnTrackSimple(track: TimelineClip[] | undefined, t: number): TimelineClip | undefined {
  return (track ?? []).find((c) => {
    if (c.type !== 'video' || clipIsImageMedia(c)) return false;
    const start = c.startTime;
    const dur = clipPlaybackSpanDurationSec(c);
    if (!Number.isFinite(dur)) return t >= start;
    return t >= start && t < start + dur;
  });
}

/** WebM（色度抠像/人像抠像等）常带 alpha；上层透明时下层必须继续解码叠放 */
function clipLikelyHasAlpha(clip: TimelineClip): boolean {
  if ((clip as { hasAlpha?: boolean }).hasAlpha === true) return true;
  const src = String(clip.src || '');
  return (
    /\.webm(?:$|[?#])/i.test(src) ||
    /video-chromakey-/i.test(src) ||
    /video-smart-matting-/i.test(src)
  );
}

function clipHasPlayableSrc(clip: TimelineClip): boolean {
  return !!String(clip.src || '').trim();
}

/**
 * 仅当上层不透明且铺满画布时才完全遮挡下层。
 * 缺 src / 透明 WebM / PiP·分屏（非全幅 layout）时下层仍需解码（下方叠加可见）。
 */
function clipFullyOccludesBelow(clip: TimelineClip): boolean {
  if (!clipHasPlayableSrc(clip)) return false;
  if (clip.type === 'video' && clipLikelyHasAlpha(clip)) return false;
  if (clip.type === 'image' && /\.png(?:$|[?#])/i.test(String(clip.src || ''))) return false;
  if (clip.type !== 'video' && clip.type !== 'image') return false;
  return isDefaultClipLayout(clip.layout);
}

/**
 * 上层轨（index 小）有「不透明全幅」画面时下层可跳过解码；
 * 上层透明 / 局部 layout / 无源时下层仍解码，才能叠出下方轨。
 */
function computeStackedTrackShouldDecode(videoTracks: TimelineClip[][], t: number): boolean[] {
  const trackHasVideo = videoTracks.map((track) => {
    const c = findVideoClipAtTimeOnTrackSimple(track, t);
    return !!(c && clipHasPlayableSrc(c));
  });
  return videoTracks.map((_, trackIdx) => {
    if (!trackHasVideo[trackIdx]) return false;
    for (let upper = 0; upper < trackIdx; upper++) {
      const upperVideo = findVideoClipAtTimeOnTrackSimple(videoTracks[upper]!, t);
      const upperImage = findImageClipAtTimeOnTrack(videoTracks[upper]!, t);
      if (upperImage && clipFullyOccludesBelow(upperImage)) return false;
      if (upperVideo && clipFullyOccludesBelow(upperVideo)) return false;
    }
    return true;
  });
}

function restStackedVideoLayer(el: HTMLVideoElement) {
  if (!el.paused) el.pause();
  setStackedVideoLayerVisible(el, false);
  el.preload = 'none';
}

const STACKED_PLAYING_SYNC_MS = 200;
const STACKED_PLAYING_DRIFT_SEC = 0.55;

/** 双 video 缓冲：visibleSlot 由 React 渲染，避免播放时 setState 重绘把 opacity 重置导致有声无画 */
const TimelineDualVideoPreview: React.FC<{
  slot0Ref: React.RefObject<HTMLVideoElement | null>;
  slot1Ref: React.RefObject<HTMLVideoElement | null>;
  visibleSlot: 0 | 1;
  videoTrackMuted: boolean;
  layout?: ClipLayout | NormRect | null;
  crop?: ClipCrop | null;
  uncroppedFit?: 'contain' | 'fill';
  onTimeUpdate: () => void;
  onEnded: () => void;
}> = ({
  slot0Ref,
  slot1Ref,
  visibleSlot,
  videoTrackMuted,
  layout,
  crop,
  uncroppedFit,
  onTimeUpdate,
  onEnded,
}) => (
  <div className="relative w-full h-full">
    <ClipMediaShell
      layout={layout}
      crop={crop}
      uncroppedFit={uncroppedFit}
      style={{
        opacity: visibleSlot === 0 ? 1 : 0,
        zIndex: visibleSlot === 0 ? 2 : 1,
        pointerEvents: visibleSlot === 0 ? 'auto' : 'none',
      }}
    >
      <video
        ref={slot0Ref}
        playsInline
        loop={false}
        muted={videoTrackMuted}
        controls={false}
        preload="auto"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onTimeUpdate={onTimeUpdate}
        onEnded={onEnded}
      />
    </ClipMediaShell>
    <ClipMediaShell
      layout={layout}
      crop={crop}
      uncroppedFit={uncroppedFit}
      style={{
        opacity: visibleSlot === 1 ? 1 : 0,
        zIndex: visibleSlot === 1 ? 2 : 1,
        pointerEvents: visibleSlot === 1 ? 'auto' : 'none',
      }}
    >
      <video
        ref={slot1Ref}
        playsInline
        loop={false}
        muted={videoTrackMuted}
        controls={false}
        preload="auto"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onTimeUpdate={onTimeUpdate}
        onEnded={onEnded}
      />
    </ClipMediaShell>
  </div>
);

/** 多视频轨预览：每轨常驻 video 层，上层轨（index 小）z-index 更高；无画面时隐藏以露出下层 */
const TimelineStackedVideoPreview: React.FC<{
  trackCount: number;
  layerRefs: React.MutableRefObject<(HTMLVideoElement | null)[]>;
  imageSrcs: (string | null)[];
  /** 每轨当前片段布局（与 imageSrcs / 视频层对齐；裁剪编辑时可为未裁源占位） */
  layouts: (ClipLayout | NormRect | null)[];
  /** 每轨当前片段源画面裁剪 */
  crops: (ClipCrop | null)[];
  /** 裁剪编辑轨：源占位需 fill 才能与琥珀遮罩对齐 */
  uncroppedFitByTrack?: (('contain' | 'fill') | null)[];
  hasVideoLayer: boolean[];
  trackMuted: boolean[];
  projectId?: string;
}> = ({
  trackCount,
  layerRefs,
  imageSrcs,
  layouts,
  crops,
  uncroppedFitByTrack,
  hasVideoLayer,
  trackMuted,
  projectId,
}) => {
  const [mappedImageSrcs, setMappedImageSrcs] = React.useState<(string | null)[]>(() =>
    imageSrcs.map((s) => (s ? normalizeVideoUrl(s) : null)),
  );
  const imageKey = imageSrcs.map((s) => s || '').join('\0');

  React.useEffect(() => {
    let cancelled = false;
    const rawList = imageSrcs.map((s) => (s ? normalizeVideoUrl(s) : null));
    setMappedImageSrcs(rawList);
    void (async () => {
      if (!projectId) return;
      const next = await Promise.all(
        rawList.map(async (raw) => {
          if (!raw) return null;
          try {
            return await mapProjectPath(raw, projectId);
          } catch {
            return raw;
          }
        }),
      );
      if (!cancelled) setMappedImageSrcs(next);
    })();
    return () => {
      cancelled = true;
    };
    // imageKey 已覆盖 imageSrcs 内容变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageKey, projectId]);

  return (
    <div className="relative h-full w-full bg-transparent">
      {[...Array(trackCount).keys()].reverse().map((trackIdx) => {
        const zIndex = trackCount - trackIdx;
        const imgSrc = mappedImageSrcs[trackIdx] || imageSrcs[trackIdx];
        const showVideo = hasVideoLayer[trackIdx] && !imgSrc;
        const layout = layouts[trackIdx];
        const crop = crops[trackIdx];
        const uncroppedFit = uncroppedFitByTrack?.[trackIdx] ?? undefined;
        return (
          <React.Fragment key={`stack-${trackIdx}`}>
            {imgSrc ? (
              <ClipMediaShell
                layout={layout}
                crop={crop}
                uncroppedFit={uncroppedFit}
                style={{ zIndex }}
                mediaClassName="pointer-events-none"
              >
                <img src={imgSrc} alt="" />
              </ClipMediaShell>
            ) : null}
            <ClipMediaShell
              layout={layout}
              crop={crop}
              uncroppedFit={uncroppedFit}
              style={{ zIndex: imgSrc ? zIndex + 1 : zIndex }}
              mediaClassName="pointer-events-none"
            >
              <video
                ref={(el) => {
                  layerRefs.current[trackIdx] = el;
                  if (el) setStackedVideoLayerVisible(el, showVideo);
                }}
                playsInline
                loop={false}
                muted={trackMuted[trackIdx] ?? true}
                controls={false}
                preload="metadata"
              />
            </ClipMediaShell>
          </React.Fragment>
        );
      })}
    </div>
  );
};

/** 轨道标签菜单需高于全屏时间轴 (z-10000) */
const TRACK_LABEL_MENU_Z = 10050;

/** 轨道名称区：可删除轨时点击弹出「删除轨道」 */
const TrackLabelMenuButton: React.FC<{
  md: boolean;
  icon: React.ReactNode;
  label: string;
  deletable: boolean;
  removeLabel: string;
  removeTitle: string;
  onRemove: () => void;
  isDarkMode: boolean;
  textMutedClass: string;
  labelWidth: number;
}> = ({
  md,
  icon,
  label,
  deletable,
  removeLabel,
  removeTitle,
  onRemove,
  isDarkMode,
  textMutedClass,
  labelWidth,
}) => {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const iconCls = md ? 'w-4 h-4' : 'w-3.5 h-3.5';
  const textCls = md ? 'text-sm' : 'text-xs';

  const syncMenuPosition = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuPos({ left: rect.left, top: rect.bottom + 4 });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    syncMenuPosition();
    const closeOnViewportChange = () => setOpen(false);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('scroll', closeOnViewportChange, true);
    return () => {
      window.removeEventListener('resize', closeOnViewportChange);
      window.removeEventListener('scroll', closeOnViewportChange, true);
    };
  }, [open, syncMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      const t = ev.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc, true);
    return () => document.removeEventListener('mousedown', onDoc, true);
  }, [open]);

  const labelBody = (
    <>
      <span className={`shrink-0 flex items-center ${textMutedClass}`}>{icon}</span>
      <span className="truncate">{label}</span>
      {deletable && (
        <ChevronDown
          className={`shrink-0 opacity-60 transition-transform ${md ? 'w-3 h-3' : 'w-2.5 h-2.5'} ${open ? 'rotate-180' : ''}`}
        />
      )}
    </>
  );

  const menuPanel = open && menuPos ? (
    <div
      ref={menuRef}
      role="menu"
      className={`fixed min-w-[132px] rounded-lg border py-1 shadow-xl ${
        isDarkMode
          ? 'border-white/15 bg-gray-900'
          : 'border-white/30 bg-[#2A6B82]'
      }`}
      style={{ left: menuPos.left, top: menuPos.top, zIndex: TRACK_LABEL_MENU_Z }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(false);
          onRemove();
        }}
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs whitespace-nowrap transition-colors ${
          isDarkMode ? 'text-red-400 hover:bg-red-500/15' : 'text-red-100 hover:bg-red-500/25'
        }`}
      >
        <Trash2 className={iconCls} />
        {removeLabel}
      </button>
    </div>
  ) : null;

  if (!deletable) {
    return (
      <div
        className={`flex shrink-0 items-center gap-1 min-w-0 ${textMutedClass} ${textCls} ${SPLICE_SELECTABLE_TEXT}`}
        style={{ width: labelWidth }}
      >
        {labelBody}
      </div>
    );
  }

  return (
    <>
      <div ref={rootRef} className="relative shrink-0 min-w-0" style={{ width: labelWidth }}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className={`flex w-full items-center gap-1 min-w-0 rounded-md px-0.5 -mx-0.5 nodrag nopan cursor-pointer ${textMutedClass} ${textCls} ${SPLICE_SELECTABLE_TEXT} ${
            isDarkMode ? 'hover:bg-white/10 hover:text-white/90' : 'hover:bg-white/15 hover:text-white'
          } ${open ? (isDarkMode ? 'bg-white/10 text-white/90' : 'bg-white/15 text-white') : ''}`}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={label}
        >
          {labelBody}
        </button>
      </div>
      {menuPanel && createPortal(menuPanel, document.body)}
    </>
  );
};

/** 轨道磁吸按钮 */
const TrackLeftSnapMenuButton: React.FC<{
  md: boolean;
  active: boolean;
  onTitle: string;
  offTitle: string;
  onToggleSnap: () => void;
  isDarkMode: boolean;
}> = ({
  md,
  active,
  onTitle,
  offTitle,
  onToggleSnap,
  isDarkMode,
}) => {
  const sz = md ? '!h-8 !w-8' : '!h-7 !w-7';
  const iconCls = md ? 'w-4 h-4' : 'w-3.5 h-3.5';

  const snapSkin = isDarkMode
    ? active
      ? 'bg-sky-500/35 text-sky-200 ring-1 ring-sky-400/45'
      : 'bg-white/8 text-white/45 hover:bg-white/12 hover:text-white/65'
    : `${scratchTintClass('motion')} ${active ? 'ring-2 ring-offset-1 ring-white/40' : 'opacity-55 hover:opacity-90'}`;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggleSnap();
      }}
      className={`rounded flex items-center justify-center nodrag nopan shrink-0 ${sz} ${snapSkin}`}
      title={active ? onTitle : offTitle}
      aria-pressed={active}
      aria-label={active ? onTitle : offTitle}
    >
      <Magnet className={iconCls} />
    </button>
  );
};

const VideoSpliceNode: React.FC<VideoSpliceNodeProps> = ({
  id,
  data,
  selected,
  projectId,
  isDarkMode = true,
  onDataChange,
  onExportToCanvas,
}) => {
  const { setNodes, setEdges, getNodes, getEdges } = useReactFlow();
  /**
   * 不要订阅整份 nodes/edges：剪辑模块 DOM 很重，任一节点更新都会拖死画布。
   * 只在「入边拓扑 / 源素材 URL·时长」变化时用签名触发更新。
   */
  const incomingGraphSig = useStore(
    useCallback((s: { edges?: Array<{ source: string; target: string; sourceHandle?: string | null }>; nodes?: Array<{ id: string; type?: string; data?: Record<string, unknown> }>; nodeInternals?: Map<string, { id: string; type?: string; data?: Record<string, unknown> }> }) => {
      const parts: string[] = [];
      // RF v11 store 以 nodeInternals(Map) 为准，不一定有 nodes 数组；入边源缺失时也不能对 undefined 调 .find
      const storeEdges = Array.isArray(s.edges) ? s.edges : [];
      const storeNodes = Array.isArray(s.nodes) ? s.nodes : [];
      for (const e of storeEdges) {
        if (e.target !== id) continue;
        const n =
          s.nodeInternals?.get?.(e.source) ??
          storeNodes.find((x) => x.id === e.source);
        if (!n) {
          parts.push(`${e.source}:missing`);
          continue;
        }
        const d = (n.data || {}) as Record<string, unknown>;
        const multiA = Array.isArray(d.outputAudios) ? String(d.outputAudios[0] || '') : '';
        const multiO = Array.isArray(d.originalOutputAudios)
          ? String(d.originalOutputAudios[0] || '')
          : '';
        const multiImg = Array.isArray(d.outputImages) ? String(d.outputImages[0] || '') : '';
        parts.push(
          [
            e.source,
            n.type || '',
            e.sourceHandle || '',
            String(d.outputAudio || multiA || multiO || d.originalAudioUrl || d.referenceAudioUrl || ''),
            String(d.outputVideo || d.originalVideoUrl || ''),
            String(d.outputImage || multiImg || ''),
            String(d.mediaDurationSec ?? ''),
          ].join('\u0001'),
        );
      }
      return parts.sort().join('|');
    }, [id]),
  );
  const edges = useMemo(() => {
    void incomingGraphSig;
    return (getEdges() ?? []).filter((e) => e.target === id);
  }, [incomingGraphSig, getEdges, id]);
  const nodes = useMemo(() => {
    void incomingGraphSig;
    const all = getNodes() ?? [];
    const need = new Set(edges.map((e) => e.source));
    for (const c of [
      ...((data?.videoTracks as TimelineClip[][] | undefined)?.flat() ||
        (data?.videoClips as TimelineClip[] | undefined) ||
        []),
      ...((data?.audioTracks as TimelineClip[][] | undefined)?.flat() || []),
    ]) {
      if (c?.sourceNodeId) need.add(c.sourceNodeId);
    }
    return all.filter((n) => need.has(n.id));
  }, [incomingGraphSig, getNodes, edges, data?.videoTracks, data?.videoClips, data?.audioTracks]);
  const videoTracks = useMemo(() => normalizeVideoTracks(data), [data?.videoTracks, data?.videoClips]);
  const videoClips = videoTracks[0] ?? [];
  const audioTracks = useMemo(() => normalizeAudioTracks(data?.audioTracks), [data?.audioTracks]);
  const resolveClipSourceHint = useCallback((clip: TimelineClip): number => {
    if (!clip.sourceNodeId) return 0;
    const sourceNode = nodes.find((n) => n.id === clip.sourceNodeId);
    return sourceNode ? resolveSourceMediaDurationSec(sourceNode) : 0;
  }, [nodes]);
  const firstContentStart = (() => {
    const all = [...videoTracks.flat().map((c) => c.startTime), ...audioTracks.flat().map((c) => c.startTime)];
    return all.length > 0 ? Math.min(...all) : 0;
  })();
  const [currentTime, setCurrentTime] = useState((data?.currentTime === 0 || data?.currentTime == null) ? 0.01 : data.currentTime);
  const [isPlaying, setIsPlaying] = useState(data?.isPlaying ?? false);
  const [pausedFrameDataUrl, setPausedFrameDataUrl] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedClip, setSelectedClip] = useState<{ clipId: string; track: TimelineTrackRef } | null>(null);
  /** 选框多选：选中的片段 ID 集合 */
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set());
  /** 选框拖拽：起点与当前点（client 坐标） */
  const [boxSelectStart, setBoxSelectStart] = useState<{ x: number; y: number } | null>(null);
  const [boxSelectEnd, setBoxSelectEnd] = useState<{ x: number; y: number } | null>(null);
  const [playheadDragging, setPlayheadDragging] = useState(false);
  /** 在时间轴空白处按住拖动 scrub */
  const [timelineScrubbing, setTimelineScrubbing] = useState(false);
  const [cutMode, setCutMode] = useState(false);
  /** 主预览变换：位置尺寸 vs 源画面裁剪（互斥，避免拖拽冲突） */
  const [previewTransformMode, setPreviewTransformMode] = useState<'layout' | 'crop'>('layout');
  const [exportBusy, setExportBusy] = useState<'save' | 'canvas' | null>(null);
  /** 导出中动画进度（主进程暂无真实进度，用缓动假进度提示用户） */
  const [exportProgress, setExportProgress] = useState(0);
  const exportProgressRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (exportProgressRafRef.current != null) {
      cancelAnimationFrame(exportProgressRafRef.current);
      exportProgressRafRef.current = null;
    }
    if (!exportBusy) {
      setExportProgress(0);
      return;
    }
    setExportProgress(6);
    const started = performance.now();
    const tick = (now: number) => {
      const elapsed = now - started;
      // 约 45s 内缓到 92%，完成后由 finally 拉满
      const t = Math.min(1, elapsed / 45000);
      const eased = 1 - Math.pow(1 - t, 2.2);
      setExportProgress(6 + eased * 86);
      exportProgressRafRef.current = requestAnimationFrame(tick);
    };
    exportProgressRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (exportProgressRafRef.current != null) {
        cancelAnimationFrame(exportProgressRafRef.current);
        exportProgressRafRef.current = null;
      }
    };
  }, [exportBusy]);

  const finishExportProgress = useCallback(async () => {
    setExportProgress(100);
    await new Promise((r) => setTimeout(r, 280));
  }, []);

  const pixelsPerSecond = Math.max(PIXELS_PER_SECOND_MIN, Math.min(PIXELS_PER_SECOND_MAX, data?.timelinePixelsPerSecond ?? PIXELS_PER_SECOND_DEFAULT));
  const legacyTrackLeftSnap = resolveLegacyTrackLeftSnap(data);
  const videoTrackLeftSnap = useMemo(() => {
    const stored = data?.videoTrackLeftSnapList;
    if (stored?.length) {
      const arr = [...stored];
      while (arr.length < videoTracks.length) arr.push(data?.videoTrackLeftSnap ?? legacyTrackLeftSnap);
      return arr.slice(0, videoTracks.length);
    }
    const legacy = data?.videoTrackLeftSnap ?? legacyTrackLeftSnap;
    return videoTracks.map(() => legacy);
  }, [data?.videoTrackLeftSnapList, data?.videoTrackLeftSnap, videoTracks.length, legacyTrackLeftSnap]);
  const audioTrackLeftSnap = useMemo(() => {
    const stored = data?.audioTrackLeftSnap;
    const arr = stored ? [...stored] : [];
    while (arr.length < audioTracks.length) arr.push(legacyTrackLeftSnap);
    return arr.slice(0, audioTracks.length);
  }, [data?.audioTrackLeftSnap, audioTracks.length, legacyTrackLeftSnap]);
  const autoSnap = data?.autoSnap !== false;
  const [draggingClip, setDraggingClip] = useState<{ clip: TimelineClip; track: TimelineTrackRef; offsetX: number; offsetY: number } | null>(null);
  /** 拖拽过程中仅更新预览布局，pointerup 后再持久化，避免卡顿并启用 CSS 过渡 */
  const [dragLayoutPreview, setDragLayoutPreview] = useState<{
    videoTracks: TimelineClip[][];
    audioTracks: TimelineClip[][];
    /** 溢出新建轨时同步磁吸/静音/音量（新轨默认关闭磁吸） */
    videoTrackLeftSnapList?: boolean[];
    videoTrackMutedList?: boolean[];
    videoTrackVolumeList?: number[];
  } | null>(null);
  const dragLayoutPreviewRef = useRef(dragLayoutPreview);
  dragLayoutPreviewRef.current = dragLayoutPreview;
  const draggingClipRef = useRef(draggingClip);
  draggingClipRef.current = draggingClip;
  const dragGhostElRef = useRef<HTMLDivElement>(null);
  const dragGhostRafRef = useRef(0);
  const dragGhostClientRef = useRef({ x: 0, y: 0 });
  const [dragOutsideTimeline, setDragOutsideTimeline] = useState(false);
  const dragOutsideTimelineRef = useRef(false);
  /** 拖拽中被拖片段的指针位置（秒），用于实时跟随光标；其他片段仍走 preview 布局动画 */
  const [clipDragVisual, setClipDragVisual] = useState<{ startTime: number; track: TimelineTrackRef } | null>(null);
  const clipDragVisualRef = useRef(clipDragVisual);
  clipDragVisualRef.current = clipDragVisual;
  /** 按下未移动时暂存，超过阈值才转为 draggingClip，否则视为点击选中 */
  const [pendingClipDrag, setPendingClipDrag] = useState<{ clip: TimelineClip; track: TimelineTrackRef; offsetX: number; offsetY: number; startX: number; startY: number } | null>(null);
  const pendingClipDragRef = useRef<typeof pendingClipDrag>(null);
  /** 边缘裁剪进行中（供靠前的 compact effect 读取） */
  const clipEdgeTrimmingLiveRef = useRef(false);
  const [clipEdgeTrimming, setClipEdgeTrimming] = useState(false);
  /** 吸附对齐线时间（秒），用于自动吸附时显示蓝线 */
  const [snapLineTime, setSnapLineTime] = useState<number | null>(null);
  const { showAlert, showConfirm } = useDarkAlert();
  const { locale } = useAppLocale();
  const vs = useMemo(() => videoSpliceT(locale), [locale]);

  const videoTrackMutedList = useMemo(() => {
    const stored = data?.videoTrackMutedList;
    if (stored?.length) {
      const arr = [...stored];
      while (arr.length < videoTracks.length) arr.push(!!data?.videoTrackMuted);
      return arr.slice(0, videoTracks.length);
    }
    const legacy = data?.videoTrackMuted ?? false;
    return videoTracks.map(() => legacy);
  }, [data?.videoTrackMutedList, data?.videoTrackMuted, videoTracks.length]);
  const audioTrackMuted = data?.audioTrackMuted ?? [];
  const videoTrackVolumeList = useMemo(() => {
    const stored = data?.videoTrackVolumeList;
    if (stored?.length) {
      const arr = stored.map((v) => Math.max(0, Math.min(1, v ?? 1)));
      while (arr.length < videoTracks.length) arr.push(Math.max(0, Math.min(1, data?.videoTrackVolume ?? 1)));
      return arr.slice(0, videoTracks.length);
    }
    const legacy = Math.max(0, Math.min(1, data?.videoTrackVolume ?? 1));
    return videoTracks.map(() => legacy);
  }, [data?.videoTrackVolumeList, data?.videoTrackVolume, videoTracks.length]);
  const audioTrackVolume = (data?.audioTrackVolume ?? []).map((v) => clampSpliceAudioVolume(v));

  const videoTrackMuted = videoTrackMutedList[0] ?? false;
  const videoTrackVolume = videoTrackVolumeList[0] ?? 1;

  const videoLayerRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const lastVideoLayerClipIdsRef = useRef<Record<number, string>>({});
  const stackedVideoSrcCacheRef = useRef<Map<string, string>>(new Map());
  const stackedDecodeMaskRef = useRef('');
  const stackedVideoSyncWallRef = useRef(0);
  const stackedClipSigRef = useRef('');
  const dualPlayGenRef = useRef(0);
  const videoTrackContentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const fullscreenVideoTrackContentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const videoSlot0Ref = useRef<HTMLVideoElement>(null);
  const videoSlot1Ref = useRef<HTMLVideoElement>(null);
  const activeVideoSlotRef = useRef<0 | 1>(0);
  const [visibleVideoSlot, setVisibleVideoSlot] = useState<0 | 1>(0);
  const slotClipKeyRef = useRef<[string, string]>(['', '']);
  /** 空闲槽已 seek 到目标时刻并至少有一帧，可供热切换 */
  const slotPrimedRef = useRef<[boolean, boolean]>([false, false]);
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  /** 片段或素材 URL 变化时，等 loadeddata 再 seek，避免解码未完成时硬 seek 造成衔接顿挫 */
  const videoSyncKeyRef = useRef<string>('');
  const getActiveVideo = useCallback(
    () => (activeVideoSlotRef.current === 0 ? videoSlot0Ref : videoSlot1Ref).current,
    [],
  );
  const getInactiveVideoSlot = useCallback(
    (): 0 | 1 => (activeVideoSlotRef.current === 0 ? 1 : 0),
    [],
  );
  const applySlotVisibility = useCallback((slot: 0 | 1) => {
    activeVideoSlotRef.current = slot;
    setVisibleVideoSlot(slot);
  }, []);
  const getAdjacentNextVideoClip = useCallback(
    (clip: TimelineClip) => {
      const videoOnly = videoClips
        .filter((c) => c.type === 'video' && !clipIsImageMedia(c))
        .sort((a, b) => a.startTime - b.startTime);
      const idx = videoOnly.findIndex((c) => c.id === clip.id);
      return idx >= 0 && idx < videoOnly.length - 1 ? videoOnly[idx + 1] : null;
    },
    [videoClips],
  );
  const prepareVideoSlot = useCallback(
    (slot: 0 | 1, clip: TimelineClip, localTime: number) => {
      if (clip.type !== 'video') return;
      const el = (slot === 0 ? videoSlot0Ref : videoSlot1Ref).current;
      if (!el) return;
      const key = clipVideoSyncKey(clip);
      const isActive = () => slot === activeVideoSlotRef.current;
      const applySeek = () => {
        void seekVideoElement(el, localTime).then(() => {
          slotPrimedRef.current[slot] = true;
          if (isActive()) applySlotVisibility(slot);
          if (!isPlayingRef.current) {
            el.pause();
          } else if (isActive()) {
            void el.play().catch(() => {});
          } else {
            // 预加载槽：对齐后保持 pause，等边界热切换再 play
            el.pause();
          }
        });
      };
      if (slotClipKeyRef.current[slot] === key && el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        applySeek();
        return;
      }
      slotClipKeyRef.current[slot] = key;
      slotPrimedRef.current[slot] = false;
      const raw = normalizeVideoUrl(clip.src);
      const bindSrc = (url: string) => {
        const onReady = () => {
          el.removeEventListener('loadeddata', onReady);
          applySeek();
        };
        if ((el.getAttribute('src') || '') !== url) {
          setVideoElSrc(el, url);
          el.addEventListener('loadeddata', onReady, { once: true });
        } else if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          applySeek();
        } else {
          el.addEventListener('loadeddata', onReady, { once: true });
        }
      };
      if (projectId) {
        mapProjectPath(raw, projectId).then(bindSrc).catch(() => bindSrc(raw));
      } else {
        bindSrc(raw);
      }
    },
    [projectId, applySlotVisibility],
  );
  const audioRefsRef = useRef<(HTMLAudioElement | null)[]>([]);
  const previewHostRef = useRef<HTMLDivElement>(null);
  const spliceOuterRef = useRef<HTMLDivElement>(null);
  const isSpliceInViewport = useViewportIntersection(spliceOuterRef, '120px', 0.02);
  const fullscreenPreviewViewportRef = useRef<HTMLDivElement>(null);
  const [fullscreenPreviewViewport, setFullscreenPreviewViewport] = useState({ w: 800, h: 450 });
  const timelineRef = useRef<HTMLDivElement>(null);
  const timelineScrollbarRef = useRef<HTMLDivElement>(null);
  const fullscreenTimelineRef = useRef<HTMLDivElement>(null);
  const fullscreenTimelineScrollbarRef = useRef<HTMLDivElement>(null);
  const timelineScrollSyncLock = useRef(false);
  const trackContentRef = useRef<HTMLDivElement>(null);
  const rulerContentRef = useRef<HTMLDivElement>(null);
  const fullscreenTrackContentRef = useRef<HTMLDivElement>(null);
  const fullscreenRulerContentRef = useRef<HTMLDivElement>(null);
  const audioTrackContentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const fullscreenAudioTrackContentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const playheadRef = useRef<number>(0);
  const rafActiveRef = useRef(true);
  const rafWallStartRef = useRef(0);
  const rafTimelineStartRef = useRef(0);
  const playheadElRef = useRef<HTMLDivElement | null>(null);
  const playheadLayerRef = useRef<HTMLDivElement | null>(null);
  const fullscreenPlayheadElRef = useRef<HTMLDivElement | null>(null);
  const fullscreenPlayheadLayerRef = useRef<HTMLDivElement | null>(null);
  const playheadDraggingRef = useRef(false);
  const timelineScrubActiveRef = useRef(false);
  const timelineScrollbarDraggingRef = useRef(false);
  const scrubPointerClientXRef = useRef<number | null>(null);
  const scrubRafRef = useRef<number | null>(null);
  const pendingScrubTimeRef = useRef<number | null>(null);
  const handleClipDragMoveRef = useRef<React.PointerEventHandler<HTMLDivElement> | null>(null);
  const handleClipDragEndRef = useRef<React.PointerEventHandler<HTMLDivElement>>(() => {});
  /** 窗口模式下点击时间轴/工具栏后立即可用快捷键（不必等 React Flow selected 刷新） */
  const spliceEditingRef = useRef(false);
  /** 时间轴上最近一次指针位置（用于粘贴落点） */
  const lastTimelinePointerRef = useRef<{ clientX: number; clientY: number; valid: boolean }>({
    clientX: 0,
    clientY: 0,
    valid: false,
  });

  // 刻度线从第 0 秒开始，不再自动跳到第一个素材起始点

  const updateData = useCallback(
    (
      updates:
        | Partial<VideoSpliceNodeData>
        | ((prev: VideoSpliceNodeData) => Partial<VideoSpliceNodeData>),
    ) => {
      // 必须基于最新 node.data 合并，避免 effect 闭包里的空轨道把刚连上的素材盖掉
      if (onDataChange) {
        onDataChange(id, updates as Partial<VideoSpliceNodeData>);
        return;
      }
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== id) return n;
          const prev = (n.data || {}) as VideoSpliceNodeData;
          const patch = typeof updates === 'function' ? updates(prev) : updates;
          return { ...n, data: { ...prev, ...patch } };
        }),
      );
    },
    [id, onDataChange, setNodes],
  );

  const activateSpliceEditing = useCallback(() => {
    spliceEditingRef.current = true;
    setNodes((nds) => {
      if (nds.find((n) => n.id === id)?.selected) return nds;
      return nds.map((n) => ({ ...n, selected: n.id === id }));
    });
  }, [id, setNodes]);

  useEffect(() => {
    if (!selected) spliceEditingRef.current = false;
  }, [selected]);

  // 从全部入边重建轨道（避免逐条追加 + 异步竞态导致「闪一下又没了」）
  const clipLabels = useMemo(
    () => ({ video: vs.clipNameVideo, image: vs.clipNameImage, audio: vs.clipNameAudio }),
    [vs],
  );
  const incomingSourceIdsKey = useMemo(() => {
    const safeEdges = Array.isArray(edges) ? edges : [];
    return safeEdges
      .filter((e) => e.target === id)
      .map((e) => e.source)
      .sort()
      .join(',');
  }, [edges, id]);

  const incomingSourceMediaKey = useMemo(() => {
    const safeEdges = Array.isArray(edges) ? edges : [];
    const safeNodes = Array.isArray(nodes) ? nodes : [];
    const parts: string[] = [];
    for (const e of safeEdges) {
      if (e.target !== id) continue;
      const src = safeNodes.find((n) => n.id === e.source);
      if (!src) continue;
      const m = resolveTimelineMediaFromSource(src, e);
      const edgeVideo = String((e.data as { videoSrc?: string } | undefined)?.videoSrc || '').trim();
      const durHint = resolveSourceMediaDurationSec(src);
      parts.push(`${e.source}:${m?.clipType || ''}:${m?.url || edgeVideo}:${durHint}`);
    }
    return parts.sort().join('|');
  }, [edges, nodes, id]);

  useEffect(() => {
    // 用 RF 当前全量边/节点重建，避免仅用过滤快照时漏掉刚接入的音频源
    const allEdges = getEdges() ?? [];
    const allNodes = getNodes() ?? [];
    if (!allEdges.some((e) => e.target === id)) return;

    setNodes((nds) => {
      const node = nds.find((n) => n.id === id);
      if (!node) return nds;
      const existingVideoTracks = normalizeVideoTracks(node.data as VideoSpliceNodeData);
      const existingAudio = (node.data?.audioTracks || [[]]) as TimelineClip[][];
      const built = buildVideoSpliceClipsFromEdges(
        id,
        allEdges,
        allNodes,
        node.data as VideoSpliceNodeData,
        clipLabels,
      );
      const connectedIds = collectSpliceIncomingSourceIds(id, allEdges);
      const blockDropOnly =
        spliceRebuildWouldDropConnected(node.data as VideoSpliceNodeData, built, connectedIds) &&
        !spliceBuiltHasNewConnectedSources(node.data as VideoSpliceNodeData, built);
      if (blockDropOnly) {
        return nds;
      }

      const prevFp = timelineClipsFingerprint(existingVideoTracks, existingAudio);
      const nextFp = timelineClipsFingerprint(built.videoTracks, built.audioTracks);
      if (prevFp === nextFp) return nds;
      const merged = applyBuiltClipsToSpliceData(node.data as VideoSpliceNodeData, built, connectedIds);
      return nds.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, ...merged } }
          : n,
      );
    });
  }, [incomingSourceIdsKey, incomingSourceMediaKey, id, clipLabels, setNodes, getEdges, getNodes]);

  /** 清除 duration 已正确但 trimEnd 仍为占位短值的历史残留；同步源节点 mediaDurationSec */
  useEffect(() => {
    updateData((prev) => {
      const safeNodes = Array.isArray(nodes) ? nodes : [];
      const curVideo = normalizeVideoTracks(prev);
      const curAudio = normalizeAudioTracks(prev.audioTracks);
      const mergeClipFromSource = (c: TimelineClip): TimelineClip => {
        if (c.type === 'image') {
          const dur =
            Number.isFinite(c.duration) && c.duration > 0 ? c.duration : DEFAULT_IMAGE_CLIP_DURATION_SEC;
          return sanitizeTimelineClipTrim(
            dur === c.duration ? c : { ...c, duration: dur },
            0,
          );
        }
        const sourceNode = c.sourceNodeId ? safeNodes.find((n) => n.id === c.sourceNodeId) : undefined;
        const sourceHint = sourceNode ? resolveSourceMediaDurationSec(sourceNode) : 0;
        let next = c;
        if (sourceHint > c.duration + 0.01) {
          next = { ...next, duration: sourceHint };
        }
        return sanitizeTimelineClipTrim(next, sourceHint);
      };
      const newVideo = curVideo.map((t) => t.map(mergeClipFromSource));
      const newAudio = curAudio.map((t) => t.map(mergeClipFromSource));
      const changed =
        newVideo.some((t, ti) =>
          t.some((c, ci) => {
            const orig = curVideo[ti]?.[ci];
            return (
              c.duration !== orig?.duration ||
              c.trimStart !== orig?.trimStart ||
              c.trimEnd !== orig?.trimEnd
            );
          }),
        ) ||
        newAudio.some((t, ti) =>
          t.some((c, ci) => {
            const orig = curAudio[ti]?.[ci];
            return (
              c.duration !== orig?.duration ||
              c.trimStart !== orig?.trimStart ||
              c.trimEnd !== orig?.trimEnd
            );
          }),
        );
      if (!changed) return {};
      return { videoTracks: newVideo, videoClips: newVideo[0], audioTracks: newAudio };
    });
  }, [videoTracks, audioTracks, nodes, updateData]);

  // 片段自动向左吸附：消除间隙、禁止重叠
  const compactTrack = useCallback((clips: TimelineClip[]): TimelineClip[] => {
    if (clips.length === 0) return clips;
    // 导演绝对时间轴（audioStartSec）：禁止压缝，否则与原曲错位
    if (clips.some((c) => c.lockTrim)) return clips;
    const sorted = [...clips].sort((a, b) => a.startTime - b.startTime);
    const getEnd = (c: TimelineClip) => c.startTime + clipTimelineDurationSec(c, resolveClipSourceHint(c));
    const hasGapOrOverlap = sorted.some((c, i) => {
      if (i === 0) return c.startTime > 0.001;
      const prevEnd = getEnd(sorted[i - 1]);
      return Math.abs(prevEnd - c.startTime) > 0.001;
    });
    if (!hasGapOrOverlap) return clips;
    let t = 0;
    return sorted.map((c) => {
      const dur = clipTimelineDurationSec(c, resolveClipSourceHint(c));
      const out = { ...c, startTime: t };
      t += dur;
      return out;
    });
  }, [resolveClipSourceHint]);
  /** 视频轨：开磁吸时按指针位置插入重排并紧凑；关磁吸重叠则溢出新轨 */
  const insertVideoClipOnTrack = useCallback(
    (others: TimelineClip[], dragged: TimelineClip, pointerStartTime: number): TimelineClip[] => {
      const getDur = (c: TimelineClip) => (c.trimEnd ?? c.duration) - (c.trimStart ?? 0);
      const dragDur = getDur(dragged);
      const dragCenter = pointerStartTime + dragDur / 2;
      const sorted = [...others].sort((a, b) => a.startTime - b.startTime);
      let insertIdx = sorted.length;
      for (let i = 0; i < sorted.length; i++) {
        const clipCenter = sorted[i].startTime + getDur(sorted[i]) / 2;
        if (dragCenter < clipCenter) {
          insertIdx = i;
          break;
        }
      }
      const reordered = [...sorted.slice(0, insertIdx), dragged, ...sorted.slice(insertIdx)];
      let t = 0;
      return reordered.map((c) => {
        const d = getDur(c);
        const out = { ...c, startTime: t };
        t += d;
        return out;
      });
    },
    [],
  );
  const prevTimelineClipCountRef = useRef<number | null>(null);
  const skipNextCompactRef = useRef(false);
  useEffect(() => {
    if (draggingClip || clipEdgeTrimmingLiveRef.current) return;
    if (skipNextCompactRef.current) {
      skipNextCompactRef.current = false;
      return;
    }
    updateData((prev) => {
      const curVideo = normalizeVideoTracks(prev);
      const curAudio = normalizeAudioTracks(prev.audioTracks);
      const clipCount = curVideo.flat().length + curAudio.flat().length;
      prevTimelineClipCountRef.current = clipCount;
      const newVideo = curVideo.map((t, i) => (videoTrackLeftSnap[i] !== false ? compactTrack(t) : t));
      const newAudio = curAudio.map((t, i) => (audioTrackLeftSnap[i] !== false ? compactTrack(t) : t));
      const videoChanged = newVideo.some((t, ti) => t.length !== (curVideo[ti]?.length ?? 0) || t.some((c) => {
        const orig = (curVideo[ti] ?? []).find((o) => o.id === c.id);
        return !orig || orig.startTime !== c.startTime;
      }));
      const audioChanged = newAudio.some((t, ti) => t.length !== (curAudio[ti]?.length ?? 0) || t.some((c) => {
        const orig = (curAudio[ti] ?? []).find((o) => o.id === c.id);
        return !orig || orig.startTime !== c.startTime;
      }));
      if (!videoChanged && !audioChanged) return {};
      return { videoTracks: newVideo, videoClips: newVideo[0], audioTracks: newAudio };
    });
  }, [videoTracks, audioTracks, compactTrack, updateData, draggingClip, clipEdgeTrimming, videoTrackLeftSnap, audioTrackLeftSnap]);

  // 音频片段接入后加载实际时长，补齐完整信息（含 local-resource 路径映射）
  const probedAudioDurationRef = useRef<Map<string, number>>(new Map());
  const clipProbeSrcRef = useRef<Map<string, string>>(new Map());
  const clipSourceHintRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    probedAudioDurationRef.current.forEach((val, key) => {
      if (needsTimelineDurationProbe(val)) probedAudioDurationRef.current.delete(key);
    });
    const clipsToLoad = audioTracks.flat().filter((c) => {
      if (c.type !== 'audio' || !c.src) return false;
      const sourceNode = c.sourceNodeId ? nodes.find((n) => n.id === c.sourceNodeId) : undefined;
      const sourceHint = sourceNode ? resolveSourceMediaDurationSec(sourceNode) : 0;
      const probeKey = `${c.id}::${c.src}`;
      const prevHint = clipSourceHintRef.current.get(c.id) ?? 0;
      if (sourceHint > prevHint + 0.01) {
        clipSourceHintRef.current.set(c.id, sourceHint);
        probedAudioDurationRef.current.delete(probeKey);
      } else if (!clipSourceHintRef.current.has(c.id)) {
        clipSourceHintRef.current.set(c.id, sourceHint);
      }
      if (sourceHint > c.duration + 0.01) return true;
      const eff = effectiveTimelineClipDurationSec(c);
      if (needsTimelineDurationProbe(eff, sourceHint)) return true;
      if (clipProbeSrcRef.current.get(c.id) !== c.src) {
        clipProbeSrcRef.current.set(c.id, c.src);
        probedAudioDurationRef.current.delete(probeKey);
      }
      const lastProbed = probedAudioDurationRef.current.get(probeKey);
      const targetDur = Math.max(c.duration, sourceHint);
      if (lastProbed != null && lastProbed >= targetDur - 0.01 && !needsTimelineDurationProbe(targetDur, sourceHint)) {
        return false;
      }
      return needsTimelineDurationProbe(c.duration, sourceHint) || lastProbed == null || lastProbed < targetDur - 0.01;
    });
    if (clipsToLoad.length === 0) return;
    let cancelled = false;
    const run = async () => {
      for (const clip of clipsToLoad) {
        if (cancelled) return;
        const sourceNode = clip.sourceNodeId ? nodes.find((n) => n.id === clip.sourceNodeId) : undefined;
        const sourceHint = sourceNode ? resolveSourceMediaDurationSec(sourceNode) : 0;
        let dur = await probeTimelineMediaDuration(clip.src, 'audio', projectId);
        if (dur <= 0 && sourceHint > 0) dur = sourceHint;
        if (cancelled || dur <= 0) continue;
        dur = Math.max(dur, sourceHint);
        const probeKey = `${clip.id}::${clip.src}`;
        probedAudioDurationRef.current.set(probeKey, dur);
        setNodes((nds) =>
          nds.map((n) => {
            if (n.id !== id) return n;
            const tracks = ((n.data?.audioTracks || [[]]) as TimelineClip[][]).map((t) =>
              t.map((c) =>
                c.id !== clip.id ? c : mergeProbedTimelineClipDuration(c, dur, sourceHint),
              ),
            );
            return { ...n, data: { ...n.data, audioTracks: tracks } };
          }),
        );
      }
    };
    run();
    return () => { cancelled = true; };
  }, [audioTracks, id, projectId, setNodes, incomingGraphSig, nodes]);

  // 视频片段接入后加载实际时长，补齐完整信息（含 local-resource 路径映射）
  const probedVideoDurationRef = useRef<Map<string, number>>(new Map());
  const videoClipProbeSrcRef = useRef<Map<string, string>>(new Map());
  const videoClipSourceHintRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    probedVideoDurationRef.current.forEach((val, key) => {
      if (needsTimelineDurationProbe(val)) probedVideoDurationRef.current.delete(key);
    });
    const clipsToLoad = videoClips.filter((c) => {
      if (c.type !== 'video' || !c.src) return false;
      const sourceNode = c.sourceNodeId ? nodes.find((n) => n.id === c.sourceNodeId) : undefined;
      const sourceHint = sourceNode ? resolveSourceMediaDurationSec(sourceNode) : 0;
      const probeKey = `${c.id}::${c.src}`;
      const prevHint = videoClipSourceHintRef.current.get(c.id) ?? 0;
      if (sourceHint > prevHint + 0.01) {
        videoClipSourceHintRef.current.set(c.id, sourceHint);
        probedVideoDurationRef.current.delete(probeKey);
      } else if (!videoClipSourceHintRef.current.has(c.id)) {
        videoClipSourceHintRef.current.set(c.id, sourceHint);
      }
      if (sourceHint > c.duration + 0.01) return true;
      const eff = effectiveTimelineClipDurationSec(c);
      if (c.lockTrim) {
        if (needsDirectorLockedClipDurationProbe(c, sourceHint)) return true;
      } else if (needsTimelineDurationProbe(eff, sourceHint)) {
        return true;
      }
      if (videoClipProbeSrcRef.current.get(c.id) !== c.src) {
        videoClipProbeSrcRef.current.set(c.id, c.src);
        probedVideoDurationRef.current.delete(probeKey);
      }
      const lastProbed = probedVideoDurationRef.current.get(probeKey);
      const targetDur = Math.max(c.duration, sourceHint);
      if (lastProbed != null && lastProbed >= targetDur - 0.01 && !needsDirectorLockedClipDurationProbe(c, sourceHint) && !needsTimelineDurationProbe(targetDur, sourceHint)) {
        return false;
      }
      if (c.lockTrim) {
        return needsDirectorLockedClipDurationProbe(c, sourceHint) || lastProbed == null;
      }
      return needsTimelineDurationProbe(c.duration, sourceHint) || lastProbed == null || lastProbed < targetDur - 0.01;
    });
    if (clipsToLoad.length === 0) return;
    let cancelled = false;
    const run = async () => {
      for (const clip of clipsToLoad) {
        if (cancelled) return;
        const sourceNode = clip.sourceNodeId ? nodes.find((n) => n.id === clip.sourceNodeId) : undefined;
        const sourceHint = sourceNode ? resolveSourceMediaDurationSec(sourceNode) : 0;
        let dur = await probeTimelineMediaDuration(clip.src, 'video', projectId);
        if (dur <= 0 && sourceHint > 0) dur = sourceHint;
        if (cancelled || dur <= 0) continue;
        dur = Math.max(dur, sourceHint);
        const probeKey = `${clip.id}::${clip.src}`;
        probedVideoDurationRef.current.set(probeKey, dur);
        setNodes((nds) =>
          nds.map((n) => {
            if (n.id !== id) return n;
            const tracks = normalizeVideoTracks(n.data as VideoSpliceNodeData).map((t) =>
              t.map((c) =>
                c.id !== clip.id ? c : mergeProbedTimelineClipDuration(c, dur, sourceHint),
              ),
            );
            return { ...n, data: { ...n.data, videoTracks: tracks, videoClips: tracks[0] } };
          }),
        );
      }
    };
    run();
    return () => { cancelled = true; };
  }, [videoClips, id, projectId, setNodes, incomingGraphSig, nodes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (cutMode) {
        e.preventDefault();
        e.stopPropagation();
        setCutMode(false);
        return;
      }
      if (isFullscreen) {
        e.preventDefault();
        e.stopPropagation();
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [cutMode, isFullscreen]);

  useEffect(() => {
    setVideoSpliceFullscreenNodeId(isFullscreen ? id : null);
    return () => setVideoSpliceFullscreenNodeId(null);
  }, [isFullscreen, id]);

  /** 外部写入 requestOpenFullscreenAt 后弹出全屏时间线（导演剪辑预览默认不走此路径） */
  const lastOpenFullscreenAtRef = useRef(0);
  useEffect(() => {
    const at = Number(data?.requestOpenFullscreenAt || 0);
    if (!Number.isFinite(at) || at <= 0) return;
    if (at === lastOpenFullscreenAtRef.current) return;
    lastOpenFullscreenAtRef.current = at;
    setIsFullscreen(true);
  }, [data?.requestOpenFullscreenAt]);

  const idsToDelete = selectedClipIds.size > 0 ? selectedClipIds : (selectedClip ? new Set([selectedClip.clipId]) : new Set<string>());

  /** 删除来自画布连线的素材时，断开对应入边，避免 sync 效果把片段重新加回轨道 */
  const disconnectEdgesForRemovedClips = useCallback(
    (removedClips: TimelineClip[]) => {
      const sourceIds = new Set(
        removedClips.map((c) => c.sourceNodeId).filter((sid): sid is string => !!sid),
      );
      if (sourceIds.size === 0) return;
      setEdges((eds) => eds.filter((e) => !(e.target === id && sourceIds.has(e.source))));
    },
    [id, setEdges],
  );

  const removeClipsByIds = useCallback(
    (idsToRemove: Set<string>) => {
      if (idsToRemove.size === 0) return;
      const removed: TimelineClip[] = [];
      for (const track of videoTracks) {
        for (const c of track) {
          if (idsToRemove.has(c.id)) removed.push(c);
        }
      }
      for (const track of audioTracks) {
        for (const c of track) {
          if (idsToRemove.has(c.id)) removed.push(c);
        }
      }
      // 先断边再改轨，避免重建 effect / 父级防护把片段又加回来
      disconnectEdgesForRemovedClips(removed);
      updateData((prev) => {
        const curVideo = normalizeVideoTracks(prev);
        const curAudio = normalizeAudioTracks(prev.audioTracks);
        const newVideoTracks = curVideo.map((track, i) => {
          const filtered = track.filter((c) => !idsToRemove.has(c.id));
          return videoTrackLeftSnap[i] !== false ? compactTrack(filtered) : filtered;
        });
        const newAudioTracks = curAudio.map((track, i) => {
          const filtered = track.filter((c) => !idsToRemove.has(c.id));
          return audioTrackLeftSnap[i] !== false ? compactTrack(filtered) : filtered;
        });
        return {
          videoTracks: newVideoTracks,
          videoClips: newVideoTracks[0],
          audioTracks: newAudioTracks,
        };
      });
      setSelectedClip(null);
      setSelectedClipIds(new Set());
    },
    [videoTracks, audioTracks, updateData, disconnectEdgesForRemovedClips, compactTrack, videoTrackLeftSnap, audioTrackLeftSnap],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (idsToDelete.size === 0) return;
      e.preventDefault();
      removeClipsByIds(idsToDelete);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [idsToDelete, removeClipsByIds]);

  const handleDeleteSelected = useCallback(() => {
    removeClipsByIds(idsToDelete);
  }, [idsToDelete, removeClipsByIds]);

  const selectedClipIdSet = useMemo(
    () => (selectedClipIds.size > 0 ? selectedClipIds : (selectedClip ? new Set([selectedClip.clipId]) : new Set<string>())),
    [selectedClipIds, selectedClip],
  );

  const copySelectedClips = useCallback((): boolean => {
    if (selectedClipIdSet.size === 0) return false;
    const items: SpliceClipClipboardItem[] = [];
    for (const clipId of selectedClipIdSet) {
      let found = false;
      for (let vi = 0; vi < videoTracks.length; vi++) {
        const c = videoTracks[vi]?.find((x) => x.id === clipId);
        if (c) {
          items.push({ clip: { ...c, sourceNodeId: undefined }, track: encodeVideoTrackRef(vi) });
          found = true;
          break;
        }
      }
      if (found) continue;
      for (let ai = 0; ai < audioTracks.length; ai++) {
        const c = audioTracks[ai]?.find((x) => x.id === clipId);
        if (c) {
          items.push({ clip: { ...c, sourceNodeId: undefined }, track: ai });
          break;
        }
      }
    }
    if (items.length === 0) return false;
    spliceClipClipboard.items = items;
    return true;
  }, [selectedClipIdSet, videoTracks, audioTracks]);

  // 计算总时长（时间轴显示用，至少 30 秒；无上限，随片段实际结束时间扩展）
  const totalDuration = (() => {
    let max = 0;
    videoTracks.flat().forEach((c) => {
      max = Math.max(max, c.startTime + timelineClipDurationSec(c, resolveClipSourceHint(c)));
    });
    audioTracks.flat().forEach((c) => {
      max = Math.max(max, c.startTime + timelineClipDurationSec(c, resolveClipSourceHint(c)));
    });
    return Math.max(max, 30);
  })();
  const timelineContentPx = totalDuration * pixelsPerSecond;
  const timelineAsideWidthPx = spliceTimelineAsideWidthPx(TIMELINE_TRACK_LABEL_PX, TIMELINE_TRACK_CONTROLS_PX);
  const timelineAudioAsideWidthPx = spliceTimelineAsideWidthPx(TIMELINE_TRACK_LABEL_PX, TIMELINE_TRACK_CONTROLS_PX);
  const timelineRowWidthPx = Math.max(timelineAsideWidthPx, timelineAudioAsideWidthPx) + timelineContentPx;
  const timelineAsideWidthPxFs = spliceTimelineAsideWidthPx(TIMELINE_TRACK_LABEL_PX_FS, TIMELINE_TRACK_CONTROLS_PX_FS);
  const timelineAudioAsideWidthPxFs = spliceTimelineAsideWidthPx(TIMELINE_TRACK_LABEL_PX_FS, TIMELINE_TRACK_CONTROLS_PX_FS);
  const timelineRowWidthPxFs = Math.max(timelineAsideWidthPxFs, timelineAudioAsideWidthPxFs) + timelineContentPx;

  // 素材实际结束时间（播放头应在此停止）
  const contentEnd = (() => {
    let max = 0;
    videoTracks.flat().forEach((c) => {
      max = Math.max(max, clipEndSec(c, resolveClipSourceHint(c)));
    });
    audioTracks.flat().forEach((c) => {
      max = Math.max(max, clipEndSec(c, resolveClipSourceHint(c)));
    });
    return max;
  })();

  // 根据当前时间找到应播放的视频/图片（播放中读 playheadRef，与 RAF 时钟一致）
  const getClipEnd = (c: TimelineClip) => clipEndSec(c, resolveClipSourceHint(c));
  /** 时间轴时刻 → 素材内 localTime（Remotion / OpenCut 等：暂停位置即续播位置） */
  const getClipLocalMediaTime = (clip: TimelineClip, timelineTime: number) => {
    const hint = resolveClipSourceHint(clip);
    const ts = clip.trimStart ?? 0;
    const te = effectiveClipTrimEnd(clip, hint);
    const span = Number.isFinite(te) ? te - ts : Number.POSITIVE_INFINITY;
    return ts + Math.min(Math.max(0, timelineTime - clip.startTime), span);
  };
  const clipLookupTime =
    isPlaying || playheadDragging || timelineScrubbing ? playheadRef.current : currentTime;
  /** 仅匹配真实视频，避免图片（含误标为 video 的静态图）占用「当前视频」导致播放器挂错源 */
  const findVideoClipAtTimeOnTrack = (track: TimelineClip[] | undefined, t: number): TimelineClip | undefined => {
    const hit = (track ?? []).find((c) => {
      if (c.type !== 'video' || clipIsImageMedia(c)) return false;
      return clipContainsTimelineTime(c, t, resolveClipSourceHint(c));
    });
    return hit;
  };
  const findVideoClipAtTime = (t: number): TimelineClip | undefined => findVideoClipAtTimeOnTrack(videoClips, t);
  const activeVideoTrackClips = videoTracks.map((track) => findClipAtTimelineTime(track, clipLookupTime, resolveClipSourceHint) ?? null);
  const activeVideoClip = activeVideoTrackClips.find(
    (c) => c?.type === 'video' && !clipIsImageMedia(c),
  ) as TimelineClip | undefined
    ?? findVideoClipAtTime(clipLookupTime);
  const hasTimelineVideo = videoTracks.some((t) => t.some((c) => c.type === 'video' && !clipIsImageMedia(c)));
  const hasTimelineVisual = videoTracks.some((t) => t.some((c) => c.type === 'video' || c.type === 'image' || clipIsImageMedia(c)));
  const stackedPreviewImageSrcs = videoTracks.map((track) => {
    const clip = findClipAtTimelineTime(track, clipLookupTime, resolveClipSourceHint);
    return clip && clipIsImageMedia(clip) ? clip.src : null;
  });
  const stackedPreviewLayouts = videoTracks.map((track) => {
    const clip = findClipAtTimelineTime(track, clipLookupTime, resolveClipSourceHint);
    if (!clip || (clip.type !== 'video' && clip.type !== 'image')) return null;
    return normalizeClipLayout(clip.layout);
  });
  const stackedPreviewCrops = videoTracks.map((track) => {
    const clip = findClipAtTimelineTime(track, clipLookupTime, resolveClipSourceHint);
    if (!clip || (clip.type !== 'video' && clip.type !== 'image')) return null;
    return normalizeClipCrop(clip.crop);
  });
  /** 与 sync 解码掩码一致：透明上层轨下方仍显示下层画面 */
  const stackedPreviewHasVideo = useMemo(
    () => computeStackedTrackShouldDecode(videoTracks, clipLookupTime),
    [videoTracks, clipLookupTime],
  );
  const useStackedVideoPreview = videoTracks.length > 1;

  const activeVideoSrc = activeVideoClip
    ? normalizeVideoUrl(activeVideoClip.src)
    : '';
  const activeVideoOffsetFixed = activeVideoClip
    ? getClipLocalMediaTime(activeVideoClip, clipLookupTime)
    : 0;

  const imperativePlayClip = useCallback(
    (clip: TimelineClip, timelineT: number) => {
      if (clip.type !== 'video') return;
      const key = clipVideoSyncKey(clip);
      const localT = getClipLocalMediaTime(clip, timelineT);
      const inactiveSlot = getInactiveVideoSlot();
      const inactiveEl = (inactiveSlot === 0 ? videoSlot0Ref : videoSlot1Ref).current;
      const activeEl = getActiveVideo();
      const clipVol = clip.volume ?? 1;
      const vol = videoTrackMuted ? 0 : videoTrackVolume * clipVol;
      const gen = ++dualPlayGenRef.current;

      const startOnSlot = (el: HTMLVideoElement, slot: 0 | 1) => {
        if (gen !== dualPlayGenRef.current) return;
        void (async () => {
          el.muted = videoTrackMuted;
          el.volume = vol;
          await seekVideoElement(el, localT);
          if (gen !== dualPlayGenRef.current) return;
          slotPrimedRef.current[slot] = true;
          activeVideoSlotRef.current = slot;
          slotClipKeyRef.current[slot] = key;
          videoSyncKeyRef.current = key;
          applySlotVisibility(slot);
          if (activeEl && activeEl !== el) activeEl.pause();
          void el.play().catch(() => {});
          const nextNext = getAdjacentNextVideoClip(clip);
          if (nextNext) {
            const prepareSlot = (slot === 0 ? 1 : 0) as 0 | 1;
            prepareVideoSlot(prepareSlot, nextNext, nextNext.trimStart ?? 0);
          }
        })();
      };

      const inactiveReady =
        !!inactiveEl &&
        slotClipKeyRef.current[inactiveSlot] === key &&
        inactiveEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        (slotPrimedRef.current[inactiveSlot] ||
          inactiveEl.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA);

      if (inactiveReady && inactiveEl) {
        startOnSlot(inactiveEl, inactiveSlot);
        return;
      }

      // 冷路径：优先在空闲槽换源，避免当前可见画面被换成 loading
      const loadSlot = inactiveEl ? inactiveSlot : activeVideoSlotRef.current;
      const el = inactiveEl || activeEl;
      if (!el) return;
      const src = normalizeVideoUrl(clip.src);
      const apply = () => startOnSlot(el, loadSlot);
      slotClipKeyRef.current[loadSlot] = key;
      slotPrimedRef.current[loadSlot] = false;
      videoSyncKeyRef.current = key;
      const bindAndPlay = (url: string) => {
        if ((el.getAttribute('src') || '') !== url) {
          setVideoElSrc(el, url);
          el.addEventListener('loadeddata', apply, { once: true });
        } else if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          apply();
        } else {
          el.addEventListener('loadeddata', apply, { once: true });
        }
      };
      if (projectId) {
        mapProjectPath(src, projectId)
          .then(bindAndPlay)
          .catch(() => bindAndPlay(src));
      } else {
        bindAndPlay(src);
      }
    },
    [
      applySlotVisibility,
      getActiveVideo,
      getAdjacentNextVideoClip,
      getInactiveVideoSlot,
      prepareVideoSlot,
      videoTrackMuted,
      videoTrackVolume,
      projectId,
    ],
  );

  // 各音频轨道在当前时间应播放的片段（用于混音）
  const activeAudioClips = audioTracks.map((track, trackIdx) => {
    if (audioTrackMuted[trackIdx]) return null;
    return (track ?? []).find((c) => {
      const hint = resolveClipSourceHint(c);
      const start = c.startTime;
      const dur = clipPlaybackSpanDurationSec(c, hint);
      if (!Number.isFinite(dur)) return clipLookupTime >= start;
      return clipLookupTime >= start && clipLookupTime < start + dur;
    }) ?? null;
  });

  // 图片：显示时长内的图片（多轨时取最上层可见图片）
  let activeImageClip: TimelineClip | undefined;
  for (let ti = 0; ti < videoTracks.length; ti++) {
    const track = videoTracks[ti] ?? [];
    const hit = track.find((c) => {
      if (!clipIsImageMedia(c)) return false;
      const start = c.startTime;
      const dur = clipTimelineDurationSec(c);
      return clipLookupTime >= start && clipLookupTime < start + dur;
    });
    if (hit) {
      activeImageClip = hit;
      break;
    }
  }
  if (!activeImageClip) {
    for (let ti = 0; ti < videoTracks.length; ti++) {
      const track = videoTracks[ti] ?? [];
      const lastImage = [...track]
        .filter((c) => clipIsImageMedia(c))
        .sort((a, b) => a.startTime + a.duration - (b.startTime + b.duration))
        .pop();
      if (lastImage && clipLookupTime >= lastImage.startTime) {
        activeImageClip = lastImage;
        break;
      }
    }
  }

  const clipFromTrackRef = useCallback(
    (trackRef: TimelineTrackRef, clipId: string): TimelineClip | null => {
      if (isVideoTrackRef(trackRef)) {
        const idx = videoTrackIndexFromRef(trackRef);
        return videoTracks[idx]?.find((c) => c.id === clipId) ?? null;
      }
      return audioTracks[trackRef as number]?.find((c) => c.id === clipId) ?? null;
    },
    [videoTracks, audioTracks],
  );

  // 选中片段的完整数据（用于 TrimRangeBar、图片时长、画面布局等）
  const selectedClipData: TimelineClip | null = selectedClip
    ? clipFromTrackRef(selectedClip.track, selectedClip.clipId)
    : null;

  /** 选中且当前播放头落在该视频/图片片段上时，可在主预览调节 layout */
  const layoutEditTarget = useMemo(() => {
    if (!selectedClip || !isVideoTrackRef(selectedClip.track)) return null;
    if (selectedClipIds.size > 1) return null;
    const clip = selectedClipData;
    if (!clip || (clip.type !== 'video' && clip.type !== 'image')) return null;
    if (!clipContainsTimelineTime(clip, clipLookupTime, resolveClipSourceHint(clip))) return null;
    return { clip, track: selectedClip.track, clipId: selectedClip.clipId };
  }, [
    selectedClip,
    selectedClipIds.size,
    selectedClipData,
    clipLookupTime,
    resolveClipSourceHint,
  ]);

  const updateSelectedClipLayout = useCallback(
    (nextLayout: ClipLayout) => {
      if (!selectedClip || !isVideoTrackRef(selectedClip.track)) return;
      const trackIdx = videoTrackIndexFromRef(selectedClip.track);
      const clipId = selectedClip.clipId;
      const layout = normalizeClipLayout(nextLayout);
      updateData((prev) => {
        const tracks = normalizeVideoTracks(prev as VideoSpliceNodeData);
        const nextTracks = tracks.map((t, i) =>
          i === trackIdx ? t.map((c) => (c.id === clipId ? { ...c, layout } : c)) : t,
        );
        return { videoTracks: nextTracks, videoClips: nextTracks[0] ?? [] };
      });
    },
    [selectedClip, updateData],
  );

  const resetSelectedClipLayout = useCallback(() => {
    updateSelectedClipLayout({ ...DEFAULT_CLIP_LAYOUT });
  }, [updateSelectedClipLayout]);

  const updateSelectedClipCrop = useCallback(
    (nextCrop: ClipCrop) => {
      if (!selectedClip || !isVideoTrackRef(selectedClip.track)) return;
      const trackIdx = videoTrackIndexFromRef(selectedClip.track);
      const clipId = selectedClip.clipId;
      const crop = normalizeClipCrop(nextCrop);
      updateData((prev) => {
        const tracks = normalizeVideoTracks(prev as VideoSpliceNodeData);
        const nextTracks = tracks.map((t, i) => {
          if (i !== trackIdx) return t;
          return t.map((c) => {
            if (c.id !== clipId) return c;
            const layout = syncLayoutAfterCropChange(c.layout, c.crop, crop);
            return { ...c, crop, layout };
          });
        });
        return {
          clipGeometryModel: 2,
          videoTracks: nextTracks,
          videoClips: nextTracks[0] ?? [],
        };
      });
    },
    [selectedClip, updateData],
  );

  const resetSelectedClipCrop = useCallback(() => {
    if (!selectedClip || !isVideoTrackRef(selectedClip.track)) return;
    const trackIdx = videoTrackIndexFromRef(selectedClip.track);
    const clipId = selectedClip.clipId;
    updateData((prev) => {
      const tracks = normalizeVideoTracks(prev as VideoSpliceNodeData);
      const nextTracks = tracks.map((t, i) => {
        if (i !== trackIdx) return t;
        return t.map((c) => {
          if (c.id !== clipId) return c;
          // 清除 crop 时把 layout 扩回未裁源占位，避免可见区突然按旧 crop 比例缩放
          const layout = normalizeClipLayout(sourceRectFromLayoutAndCrop(c.layout, c.crop));
          return { ...c, crop: { ...DEFAULT_CLIP_CROP }, layout };
        });
      });
      return {
        clipGeometryModel: 2,
        videoTracks: nextTracks,
        videoClips: nextTracks[0] ?? [],
      };
    });
  }, [selectedClip, updateData]);

  /** 播放/拖动时自动滚动时间轴，使播放头保持在可视区内 */
  const setTimelineScrollLeft = useCallback((left: number) => {
    timelineScrollSyncLock.current = true;
    const pairs: Array<[HTMLDivElement | null, HTMLDivElement | null]> = [
      [timelineRef.current, timelineScrollbarRef.current],
      [fullscreenTimelineRef.current, fullscreenTimelineScrollbarRef.current],
    ];
    for (const [content, bar] of pairs) {
      if (content) content.scrollLeft = left;
      if (bar) bar.scrollLeft = left;
    }
    timelineScrollSyncLock.current = false;
  }, []);

  const handleTimelineContentScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (timelineScrollSyncLock.current) return;
    const left = e.currentTarget.scrollLeft;
    timelineScrollSyncLock.current = true;
    if (timelineRef.current === e.currentTarget && timelineScrollbarRef.current) {
      timelineScrollbarRef.current.scrollLeft = left;
    }
    if (fullscreenTimelineRef.current === e.currentTarget && fullscreenTimelineScrollbarRef.current) {
      fullscreenTimelineScrollbarRef.current.scrollLeft = left;
    }
    timelineScrollSyncLock.current = false;
  }, []);

  const handleTimelineScrollbarScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (timelineScrollSyncLock.current) return;
    const left = e.currentTarget.scrollLeft;
    timelineScrollSyncLock.current = true;
    if (timelineScrollbarRef.current === e.currentTarget && timelineRef.current) {
      timelineRef.current.scrollLeft = left;
    }
    if (fullscreenTimelineScrollbarRef.current === e.currentTarget && fullscreenTimelineRef.current) {
      fullscreenTimelineRef.current.scrollLeft = left;
    }
    timelineScrollSyncLock.current = false;
  }, []);

  const timeToPlayheadPx = useCallback((time: number) => time * pixelsPerSecond, [pixelsPerSecond]);

  const scrollTimelineToPlayhead = useCallback(
    (time: number, opts?: { forceFollow?: boolean }) => {
      const fs = isFullscreen;
      const timelineEl = fs ? fullscreenTimelineRef.current : timelineRef.current;
      const contentEl = fs
        ? (fullscreenRulerContentRef.current ?? fullscreenTrackContentRef.current)
        : (rulerContentRef.current ?? trackContentRef.current);
      if (!timelineEl || !contentEl) return;
      const sidebarW = Math.max(0, contentEl.getBoundingClientRect().left - timelineEl.getBoundingClientRect().left);
      const playheadPx = timeToPlayheadPx(time);
      const pad = opts?.forceFollow ? 24 : 0;
      const visibleW = Math.max(1, timelineEl.clientWidth - sidebarW);
      const left = timelineEl.scrollLeft;
      const right = left + visibleW;
      if (playheadPx < left + pad) {
        setTimelineScrollLeft(Math.max(0, playheadPx - pad));
      } else if (playheadPx > right - pad) {
        setTimelineScrollLeft(Math.max(0, playheadPx - visibleW + pad));
      }
    },
    [timeToPlayheadPx, setTimelineScrollLeft, isFullscreen],
  );

  const isPlayheadOutsideView = useCallback(
    (time: number) => {
      const fs = isFullscreen;
      const timelineEl = fs ? fullscreenTimelineRef.current : timelineRef.current;
      const contentEl = fs
        ? (fullscreenRulerContentRef.current ?? fullscreenTrackContentRef.current)
        : (rulerContentRef.current ?? trackContentRef.current);
      if (!timelineEl || !contentEl) return false;
      const sidebarW = Math.max(0, contentEl.getBoundingClientRect().left - timelineEl.getBoundingClientRect().left);
      const playheadPx = timeToPlayheadPx(time);
      const visibleW = Math.max(1, timelineEl.clientWidth - sidebarW);
      const left = timelineEl.scrollLeft;
      const right = left + visibleW;
      return playheadPx < left || playheadPx > right;
    },
    [timeToPlayheadPx, isFullscreen],
  );

  /** 时间轴内容区锚点（刻度尺/轨道内容列，实测左缘） */
  const getTimelineScrollMetrics = useCallback(() => {
    const fs = isFullscreen;
    const timelineEl = fs ? fullscreenTimelineRef.current : timelineRef.current;
    const contentEl = fs
      ? (fullscreenRulerContentRef.current ?? fullscreenTrackContentRef.current)
      : (rulerContentRef.current ?? trackContentRef.current);
    if (!timelineEl || !contentEl) return null;
    const timelineRect = timelineEl.getBoundingClientRect();
    const contentRect = contentEl.getBoundingClientRect();
    return {
      timelineEl,
      contentEl,
      timelineRect,
      contentRect,
      contentOriginX: contentRect.left,
      scrollLeft: timelineEl.scrollLeft,
    };
  }, [isFullscreen]);

  /** 可见内容区左右缘（屏幕坐标）；左缘为 sticky 侧栏右缘，不随 scrollLeft 漂移 */
  const getTimelineVisibleContentScreenEdges = useCallback(
    (m: { timelineEl: HTMLDivElement; timelineRect: DOMRect }) => {
      const asideLayoutPx = isFullscreen ? timelineAsideWidthPxFs : timelineAsideWidthPx;
      const portLayoutW = m.timelineEl.clientWidth || 1;
      const asideScreenPx = asideLayoutPx * (m.timelineRect.width / portLayoutW);
      return {
        left: m.timelineRect.left + asideScreenPx,
        right: m.timelineRect.right,
      };
    },
    [isFullscreen, timelineAsideWidthPx, timelineAsideWidthPxFs],
  );

  /** 将 viewport clientX 映射为时间轴内容区横向像素（0 = 第 0 秒左缘）；兼容 React Flow 节点缩放 */
  const getTimelineContentPxFromClientX = useCallback((clientX: number, opts?: { unclamped?: boolean }) => {
    const m = getTimelineScrollMetrics();
    if (!m) return null;
    let x = clientX;
    if (!opts?.unclamped) {
      const visibleRight = m.timelineRect.right;
      x = Math.max(m.contentOriginX, Math.min(visibleRight, clientX));
    }
    return contentScreenXToLayoutPx(x, m.contentEl);
  }, [getTimelineScrollMetrics]);

  /** 拖动到内容区左右缘时自动滚动时间轴（返回是否发生了滚动） */
  const maybeAutoScrollTimelineAtClientX = useCallback((clientX: number) => {
    const m = getTimelineScrollMetrics();
    if (!m) return false;
    const { timelineEl } = m;
    const { left: visibleLeft, right: visibleRight } = getTimelineVisibleContentScreenEdges(m);
    const maxScroll = Math.max(0, timelineEl.scrollWidth - timelineEl.clientWidth);
    const prev = timelineEl.scrollLeft;
    let next = prev;

    if (clientX < visibleLeft + TIMELINE_EDGE_SCROLL_ZONE_PX) {
      const dist = visibleLeft + TIMELINE_EDGE_SCROLL_ZONE_PX - clientX;
      const t = Math.min(1, dist / TIMELINE_EDGE_SCROLL_ZONE_PX);
      const speed =
        TIMELINE_EDGE_SCROLL_MIN_PX + t * (TIMELINE_EDGE_SCROLL_MAX_PX - TIMELINE_EDGE_SCROLL_MIN_PX);
      next = Math.max(0, prev - speed);
    } else if (clientX > visibleRight - TIMELINE_EDGE_SCROLL_ZONE_PX) {
      const dist = clientX - (visibleRight - TIMELINE_EDGE_SCROLL_ZONE_PX);
      const t = Math.min(1, dist / TIMELINE_EDGE_SCROLL_ZONE_PX);
      const speed =
        TIMELINE_EDGE_SCROLL_MIN_PX + t * (TIMELINE_EDGE_SCROLL_MAX_PX - TIMELINE_EDGE_SCROLL_MIN_PX);
      next = Math.min(maxScroll, prev + speed);
    }

    if (next === prev) return false;
    setTimelineScrollLeft(next);
    return true;
  }, [getTimelineScrollMetrics, getTimelineVisibleContentScreenEdges, setTimelineScrollLeft]);

  const syncPlayheadPosition = useCallback((
    time: number,
    opts?: { forceFollow?: boolean; autoScroll?: boolean | 'if-outside' },
  ) => {
    const playheadPx = timeToPlayheadPx(time);
    const syncOne = (
      playheadEl: HTMLDivElement | null,
      layerEl: HTMLDivElement | null,
      contentEl: HTMLDivElement | null,
      timelineEl: HTMLDivElement | null,
    ) => {
      if (!playheadEl || !layerEl || !contentEl || !timelineEl) return;
      const layerRect = layerEl.getBoundingClientRect();
      const contentRect = contentEl.getBoundingClientRect();
      const timelineRect = timelineEl.getBoundingClientRect();
      const playheadViewportX = contentLayoutPxToViewportX(contentEl, playheadPx);
      const localX = screenOffsetToLocalPx(playheadViewportX - layerRect.left, layerEl);
      const inView =
        playheadViewportX >= contentRect.left - 0.5 && playheadViewportX <= timelineRect.right + 0.5;
      const showWhileScrubbing = playheadDraggingRef.current || timelineScrubActiveRef.current;
      playheadEl.style.visibility = inView || showWhileScrubbing ? 'visible' : 'hidden';
      playheadEl.style.transform = `translate3d(${localX}px, 0, 0)`;
    };
    syncOne(
      isFullscreen ? null : playheadElRef.current,
      isFullscreen ? null : playheadLayerRef.current,
      isFullscreen ? null : (rulerContentRef.current ?? trackContentRef.current),
      isFullscreen ? null : timelineRef.current,
    );
    syncOne(
      isFullscreen ? fullscreenPlayheadElRef.current : null,
      isFullscreen ? fullscreenPlayheadLayerRef.current : null,
      isFullscreen ? (fullscreenRulerContentRef.current ?? fullscreenTrackContentRef.current) : null,
      isFullscreen ? fullscreenTimelineRef.current : null,
    );
    const autoScroll = opts?.autoScroll;
    if (autoScroll === true || opts?.forceFollow) {
      scrollTimelineToPlayhead(time, opts);
    } else if (autoScroll === 'if-outside' && isPlayheadOutsideView(time)) {
      scrollTimelineToPlayhead(time);
    }
  }, [timeToPlayheadPx, scrollTimelineToPlayhead, isPlayheadOutsideView, isFullscreen]);

  const handleTimelineContentScrollWithPlayhead = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    handleTimelineContentScroll(e);
    if (timelineScrollbarDraggingRef.current) return;
    requestAnimationFrame(() => {
      syncPlayheadPosition(playheadRef.current, { autoScroll: false });
    });
  }, [handleTimelineContentScroll, syncPlayheadPosition]);

  const handleTimelineScrollbarScrollWithPlayhead = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    handleTimelineScrollbarScroll(e);
    requestAnimationFrame(() => {
      syncPlayheadPosition(playheadRef.current, { autoScroll: false });
    });
  }, [handleTimelineScrollbarScroll, syncPlayheadPosition]);

  const handleTimelineScrollbarPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    timelineScrollbarDraggingRef.current = true;
    timelineSeekPointerRef.current = null;
    timelineScrubActiveRef.current = false;
    setTimelineScrubbing(false);
  }, []);

  const handleTimelineScrollbarPointerUp = useCallback(() => {
    timelineScrollbarDraggingRef.current = false;
  }, []);

  const getTimelineTimeFromClientX = useCallback(
    (clientX: number, opts?: { unclamped?: boolean }) => {
      const contentX = getTimelineContentPxFromClientX(clientX, opts);
      if (contentX == null) return null;
      return Math.max(0, Math.min(totalDuration, contentX / pixelsPerSecond));
    },
    [getTimelineContentPxFromClientX, pixelsPerSecond, totalDuration],
  );

  const resolvePasteAnchor = useCallback((): { time: number; mouseTrack: TimelineTrackRef | null } => {
    const ptr = lastTimelinePointerRef.current;
    const timelineEl = fullscreenTimelineRef.current || timelineRef.current;
    if (ptr.valid && timelineEl) {
      const t = getTimelineTimeFromClientX(ptr.clientX, { unclamped: true });
      const rulerH = isFullscreen ? RULER_HEIGHT_FULLSCREEN : RULER_HEIGHT;
      const track = resolveTimelineTrackFromClientY(
        ptr.clientY,
        timelineEl,
        rulerH,
        videoTracks.length,
        audioTracks.length,
      );
      if (t != null) return { time: Math.max(0, t), mouseTrack: track };
    }
    return { time: playheadRef.current, mouseTrack: null };
  }, [getTimelineTimeFromClientX, isFullscreen, videoTracks.length, audioTracks.length]);

  const pasteClipsAtPointer = useCallback(() => {
    const items = spliceClipClipboard.items;
    if (!items?.length) {
      showAlert(vs.pasteClipsNothingAlert);
      return;
    }
    const { time: pasteAt, mouseTrack } = resolvePasteAnchor();
    const anchorTime = Math.min(...items.map((i) => i.clip.startTime));
    const nextVideo = videoTracks.map((t) => t.map((c) => ({ ...c })));
    const nextAudio = audioTracks.map((t) => t.map((c) => ({ ...c })));
    const nextVideoMuted = [...videoTrackMutedList];
    const nextVideoVol = [...videoTrackVolumeList];
    const nextVideoSnap = [...videoTrackLeftSnap];
    const nextAudioMuted = [...audioTrackMuted];
    const nextAudioVol = [...audioTrackVolume];
    const nextAudioSnap = [...audioTrackLeftSnap];
    const incomingByVideo = new Map<number, TimelineClip[]>();
    const incomingByAudio = new Map<number, TimelineClip[]>();
    const pasted: { id: string; track: TimelineTrackRef }[] = [];

    const ensureVideoTrack = (idx: number) => {
      while (nextVideo.length <= idx) {
        nextVideo.push([]);
        nextVideoMuted.push(false);
        nextVideoVol.push(1);
        nextVideoSnap.push(true);
      }
    };
    const ensureAudioTrack = (idx: number) => {
      while (nextAudio.length <= idx) {
        nextAudio.push([]);
        nextAudioMuted.push(false);
        nextAudioVol.push(1);
        nextAudioSnap.push(true);
      }
    };

    for (const item of items) {
      let targetTrack = item.track;
      if (items.length === 1 && mouseTrack != null) {
        const videoKind = item.clip.type !== 'audio';
        const audioKind = item.clip.type === 'audio';
        if ((videoKind && isVideoTrackRef(mouseTrack)) || (audioKind && isAudioTrackRef(mouseTrack))) {
          targetTrack = mouseTrack;
        }
      }
      const offset = item.clip.startTime - anchorTime;
      const newId = `${item.clip.type}-${Date.now()}-paste-${Math.random().toString(36).slice(2, 7)}`;
      const newClip: TimelineClip = {
        ...item.clip,
        id: newId,
        startTime: Math.max(0, pasteAt + offset),
        sourceNodeId: undefined,
      };
      pasted.push({ id: newId, track: targetTrack });
      if (isVideoTrackRef(targetTrack)) {
        const idx = videoTrackIndexFromRef(targetTrack);
        const list = incomingByVideo.get(idx) ?? [];
        list.push(newClip);
        incomingByVideo.set(idx, list);
      } else {
        const idx = targetTrack as number;
        const list = incomingByAudio.get(idx) ?? [];
        list.push(newClip);
        incomingByAudio.set(idx, list);
      }
    }

    for (const [idx, incoming] of incomingByVideo) {
      ensureVideoTrack(idx);
      nextVideo[idx] = insertClipsRippleOnTrack(nextVideo[idx], incoming);
    }
    for (const [idx, incoming] of incomingByAudio) {
      ensureAudioTrack(idx);
      nextAudio[idx] = insertClipsRippleOnTrack(nextAudio[idx], incoming);
    }

    skipNextCompactRef.current = true;
    updateData({
      videoTracks: nextVideo,
      videoClips: nextVideo[0] ?? [],
      audioTracks: nextAudio,
      videoTrackMutedList: nextVideoMuted,
      videoTrackVolumeList: nextVideoVol,
      videoTrackLeftSnapList: nextVideoSnap,
      audioTrackMuted: nextAudioMuted,
      audioTrackVolume: nextAudioVol,
      audioTrackLeftSnap: nextAudioSnap,
    });

    if (pasted.length === 1) {
      setSelectedClip({ clipId: pasted[0].id, track: pasted[0].track });
      setSelectedClipIds(new Set([pasted[0].id]));
    } else {
      setSelectedClip(null);
      setSelectedClipIds(new Set(pasted.map((p) => p.id)));
    }
  }, [
    resolvePasteAnchor,
    videoTracks,
    audioTracks,
    videoTrackMutedList,
    videoTrackVolumeList,
    videoTrackLeftSnap,
    audioTrackMuted,
    audioTrackVolume,
    audioTrackLeftSnap,
    updateData,
    showAlert,
    vs.pasteClipsNothingAlert,
  ]);

  const syncVideoLayersToTime = useCallback(
    (t: number) => {
      if (!useStackedVideoPreview) return;
      const shouldDecode = computeStackedTrackShouldDecode(videoTracks, t);
      stackedDecodeMaskRef.current = shouldDecode.map((v) => (v ? '1' : '0')).join('');
      const driftThreshold = isPlayingRef.current ? STACKED_PLAYING_DRIFT_SEC : 0.35;

      videoTracks.forEach((track, trackIdx) => {
        const el = videoLayerRefs.current[trackIdx];
        if (!el) return;
        const clip = findVideoClipAtTimeOnTrack(track, t);

        if (!shouldDecode[trackIdx]) {
          restStackedVideoLayer(el);
          if (!clip) lastVideoLayerClipIdsRef.current[trackIdx] = '';
          return;
        }

        if (!clip || !clipHasPlayableSrc(clip)) {
          restStackedVideoLayer(el);
          lastVideoLayerClipIdsRef.current[trackIdx] = '';
          return;
        }

        el.preload = 'auto';
        setStackedVideoLayerVisible(el, true);
        const clipVol = clip.volume ?? 1;
        const muted = videoTrackMutedList[trackIdx] ?? false;
        const vol = muted ? 0 : (videoTrackVolumeList[trackIdx] ?? 1) * clipVol;
        el.volume = vol;
        el.muted = muted;
        const rawSrc = normalizeVideoUrl(clip.src);
        const localTime = getClipLocalMediaTime(clip, t);
        const te = clip.trimEnd ?? clip.duration;
        const applyLoaded = () => {
          void seekVideoElement(el, localTime).then(() => {
            if (localTime >= te - 0.04) {
              restStackedVideoLayer(el);
              return;
            }
            if (isPlayingRef.current && el.paused) void el.play().catch(() => {});
          });
        };
        const bindSrc = (url: string) => {
          if (lastVideoLayerClipIdsRef.current[trackIdx] !== clip.id) {
            lastVideoLayerClipIdsRef.current[trackIdx] = clip.id;
            const onReady = () => {
              el.removeEventListener('loadeddata', onReady);
              applyLoaded();
            };
            if ((el.getAttribute('src') || '') !== url) {
              setVideoElSrc(el, url);
              el.addEventListener('loadeddata', onReady, { once: true });
            } else if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
              applyLoaded();
            } else {
              el.addEventListener('loadeddata', onReady, { once: true });
            }
            return;
          }
          if (Math.abs(el.currentTime - localTime) > driftThreshold) {
            try {
              el.currentTime = localTime;
            } catch (_) {}
          }
          if (localTime >= te - 0.04) {
            restStackedVideoLayer(el);
            return;
          }
          if (isPlayingRef.current && el.paused) void el.play().catch(() => {});
        };
        const cachedUrl = stackedVideoSrcCacheRef.current.get(rawSrc);
        if (cachedUrl) {
          bindSrc(cachedUrl);
        } else if (projectId) {
          mapProjectPath(rawSrc, projectId)
            .then((url) => {
              stackedVideoSrcCacheRef.current.set(rawSrc, url);
              bindSrc(url);
            })
            .catch(() => {
              stackedVideoSrcCacheRef.current.set(rawSrc, rawSrc);
              bindSrc(rawSrc);
            });
        } else {
          stackedVideoSrcCacheRef.current.set(rawSrc, rawSrc);
          bindSrc(rawSrc);
        }
      });
    },
    [useStackedVideoPreview, videoTracks, videoTrackMutedList, videoTrackVolumeList, projectId],
  );
  const syncVideoLayersToTimeRef = useRef(syncVideoLayersToTime);
  syncVideoLayersToTimeRef.current = syncVideoLayersToTime;

  const lastAudioClipIdsRef = useRef<Record<number, string>>({});
  const syncAudioToTime = useCallback((t: number) => {
    const refs = audioRefsRef.current;
    audioTracks.forEach((track, trackIdx) => {
      const el = refs[trackIdx];
      if (!el) return;
      const clip = track.find((c) => {
        const hint = resolveClipSourceHint(c);
        const start = c.startTime;
        const dur = clipPlaybackSpanDurationSec(c, hint);
        if (!Number.isFinite(dur)) return t >= start;
        return t >= start && t < start + dur;
      }) ?? null;
      const clipVol = clip?.volume ?? 1;
      const vol = audioTrackMuted[trackIdx] ? 0 : (audioTrackVolume[trackIdx] ?? 1) * clipVol;
      el.volume = Math.min(1, vol);
      if (!clip || !isPlaying) {
        if (!el.paused) el.pause();
        if (lastAudioClipIdsRef.current[trackIdx]) lastAudioClipIdsRef.current[trackIdx] = '';
        return;
      }
      const src = normalizeVideoUrl(clip.src);
      const localTime = (t - clip.startTime) + (clip.trimStart ?? 0);
      const te = effectiveClipTrimEnd(clip, resolveClipSourceHint(clip));
      if (lastAudioClipIdsRef.current[trackIdx] !== clip.id) {
        lastAudioClipIdsRef.current[trackIdx] = clip.id;
        if (el.src !== src) el.src = src;
        try {
          el.currentTime = localTime;
        } catch (_) {}
      } else if (Math.abs(el.currentTime - localTime) > 0.35) {
        try {
          el.currentTime = localTime;
        } catch (_) {}
      }
      if (Number.isFinite(te) && localTime >= te - 0.04) {
        if (!el.paused) el.pause();
        return;
      }
      if (el.paused) el.play().catch(() => {});
    });
  }, [audioTracks, audioTrackMuted, audioTrackVolume, isPlaying, resolveClipSourceHint]);
  const syncAudioToTimeRef = useRef(syncAudioToTime);
  syncAudioToTimeRef.current = syncAudioToTime;

  // 播放逻辑：播放中仅用 RAF + playheadRef 驱动，避免频繁 setState 导致 seek 卡顿与片段回跳
  const lastUiTimeUpdateRef = useRef(0);
  const getClipForTime = useCallback((t: number) => findVideoClipAtTime(t), [videoClips]);

  const seekPreviewAtTime = useCallback(
    (t: number, retry = 0) => {
      const clip = getClipForTime(t);
      if (!clip || clip.type !== 'video') return;
      const localT = getClipLocalMediaTime(clip, t);
      const slot = activeVideoSlotRef.current;
      prepareVideoSlot(slot, clip, localT);
      applySlotVisibility(slot);
      const v = getActiveVideo();
      if (!v) {
        if (retry < 8) requestAnimationFrame(() => seekPreviewAtTime(t, retry + 1));
        return;
      }
      videoSyncKeyRef.current = clipVideoSyncKey(clip);
      const applySeek = () => {
        try {
          if (Math.abs(v.currentTime - localT) > 0.03) v.currentTime = localT;
        } catch (_) {}
        v.pause();
      };
      if (v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) applySeek();
      else v.addEventListener('loadeddata', applySeek, { once: true });
      const next = getAdjacentNextVideoClip(clip);
      if (next) prepareVideoSlot(getInactiveVideoSlot(), next, next.trimStart ?? 0);
    },
    [getClipForTime, prepareVideoSlot, applySlotVisibility, getActiveVideo, getInactiveVideoSlot, getAdjacentNextVideoClip],
  );

  const applyScrubTime = useCallback(
    (time: number, opts?: { immediate?: boolean; autoScroll?: boolean | 'if-outside' }) => {
      playheadRef.current = time;
      const isDragging = playheadDraggingRef.current || timelineScrubActiveRef.current;
      const autoScroll = opts?.autoScroll ?? (isDragging ? false : 'if-outside');
      syncPlayheadPosition(time, { autoScroll });
      if (!useStackedVideoPreview) seekPreviewAtTime(time);
      syncAudioToTimeRef.current(time);
      syncVideoLayersToTimeRef.current(time);
      pendingScrubTimeRef.current = time;
      if (opts?.immediate) {
        if (scrubRafRef.current != null) {
          cancelAnimationFrame(scrubRafRef.current);
          scrubRafRef.current = null;
        }
        setCurrentTime(time);
        return;
      }
      if (scrubRafRef.current != null) return;
      scrubRafRef.current = requestAnimationFrame(() => {
        scrubRafRef.current = null;
        const t = pendingScrubTimeRef.current;
        if (t == null) return;
        setCurrentTime(t);
      });
    },
    [syncPlayheadPosition, seekPreviewAtTime, useStackedVideoPreview],
  );

  /** 拖动播放头 / 横向 scrub：边缘自动滚屏并更新时刻 */
  const scrubTimelineAtClientX = useCallback(
    (clientX: number, opts?: { immediate?: boolean }) => {
      scrubPointerClientXRef.current = clientX;
      maybeAutoScrollTimelineAtClientX(clientX);
      const time = getTimelineTimeFromClientX(clientX, { unclamped: true });
      if (time == null) return;
      applyScrubTime(time, { immediate: opts?.immediate, autoScroll: false });
    },
    [maybeAutoScrollTimelineAtClientX, getTimelineTimeFromClientX, applyScrubTime],
  );

  const flushScrubTime = useCallback(() => {
    if (scrubRafRef.current != null) {
      cancelAnimationFrame(scrubRafRef.current);
      scrubRafRef.current = null;
    }
    const t = pendingScrubTimeRef.current ?? playheadRef.current;
    pendingScrubTimeRef.current = null;
    setCurrentTime(t);
    playheadRef.current = t;
    syncPlayheadPosition(t, { autoScroll: 'if-outside' });
  }, [syncPlayheadPosition]);

  useEffect(() => {
    if (!isPlaying) {
      rafActiveRef.current = false;
      return;
    }
    rafActiveRef.current = true;
    rafWallStartRef.current = performance.now();
    rafTimelineStartRef.current = playheadRef.current;
    const stopAt = contentEnd > 0 ? contentEnd : totalDuration;
    const UI_TIME_UPDATE_MS = 100;
    const raf = (now: number) => {
      if (!rafActiveRef.current) return;
      const wallElapsed = (now - rafWallStartRef.current) / 1000;
      const currentClip = getClipForTime(playheadRef.current);
      const v = getActiveVideo();
      let next: number;
      if (useStackedVideoPreview) {
        next = rafTimelineStartRef.current + wallElapsed;
      } else if (currentClip?.type === 'video' && v && v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        // 首段冷启动常见：play() 未挂上 → 画面停在首帧，播放头却被墙钟推进。播放中若仍 paused 则重试 play。
        if (v.paused && !v.ended && isPlayingRef.current) {
          void v.play().catch(() => {});
        }
        const hint = resolveClipSourceHint(currentClip);
        const ts = currentClip.trimStart ?? 0;
        const te = effectiveClipTrimEnd(currentClip, hint);
        const clipEnd = clipPlaybackEndSec(currentClip, hint);
        const atTrimEnd = Number.isFinite(te) && v.currentTime >= te - 0.04;
        const withinClipEnd = clipEnd === Number.POSITIVE_INFINITY || playheadRef.current < clipEnd - 0.05;
        if (!v.paused && !v.ended && !atTrimEnd && withinClipEnd) {
          next = Math.min(
            clipEnd === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : clipEnd,
            currentClip.startTime + Math.max(0, v.currentTime - ts),
          );
        } else {
          next = rafTimelineStartRef.current + wallElapsed;
        }
      } else {
        next = rafTimelineStartRef.current + wallElapsed;
      }
      if (next >= stopAt - 1e-4) {
        playheadRef.current = stopAt;
        syncPlayheadPosition(stopAt, { autoScroll: true, forceFollow: true });
        setCurrentTime(stopAt);
        setIsPlaying(false);
        rafActiveRef.current = false;
        return;
      }
      const prevClipId = currentClip?.id ?? null;
      playheadRef.current = next;
      syncPlayheadPosition(next, { autoScroll: true, forceFollow: true });
      syncAudioToTimeRef.current(next);
      if (useStackedVideoPreview) {
        const nextMask = computeStackedTrackShouldDecode(videoTracks, next)
          .map((v) => (v ? '1' : '0'))
          .join('');
        const nextClipSig = videoTracks
          .map((track) => findVideoClipAtTimeOnTrack(track, next)?.id ?? '')
          .join('|');
        const maskChanged = nextMask !== stackedDecodeMaskRef.current;
        const clipSigChanged = nextClipSig !== stackedClipSigRef.current;
        if (clipSigChanged) stackedClipSigRef.current = nextClipSig;
        // 换片立即 sync，避免 200ms 节流拖到下一段才换源造成卡顿
        if (
          maskChanged ||
          clipSigChanged ||
          now - stackedVideoSyncWallRef.current >= STACKED_PLAYING_SYNC_MS
        ) {
          syncVideoLayersToTimeRef.current(next);
          stackedVideoSyncWallRef.current = now;
        }
      } else {
        syncVideoLayersToTimeRef.current(next);
      }
      const nextClip = getClipForTime(next);
      const crossedBoundary = (nextClip?.id ?? null) !== prevClipId;
      if (crossedBoundary) {
        rafWallStartRef.current = now;
        rafTimelineStartRef.current = next;
        if (!useStackedVideoPreview) {
          if (nextClip?.type === 'video') {
            imperativePlayClip(nextClip, next);
          } else {
            videoSlot0Ref.current?.pause();
            videoSlot1Ref.current?.pause();
          }
        }
        setCurrentTime(next);
        lastUiTimeUpdateRef.current = now;
      } else if (now - lastUiTimeUpdateRef.current >= UI_TIME_UPDATE_MS) {
        lastUiTimeUpdateRef.current = now;
        setCurrentTime(next);
      }
      requestAnimationFrame(raf);
    };
    const id = requestAnimationFrame(raf);
    return () => {
      rafActiveRef.current = false;
      cancelAnimationFrame(id);
    };
  }, [isPlaying, totalDuration, contentEnd, syncPlayheadPosition, getClipForTime, getActiveVideo, imperativePlayClip, useStackedVideoPreview, videoTracks]);

  useEffect(() => {
    if (isPlaying || playheadDraggingRef.current) return;
    playheadRef.current = currentTime;
  }, [currentTime, isPlaying]);

  useLayoutEffect(() => {
    if (!playheadDraggingRef.current && !isPlaying) {
      syncPlayheadPosition(currentTime, { autoScroll: false });
    }
  }, [currentTime, isPlaying, syncPlayheadPosition]);

  useLayoutEffect(() => {
    syncPlayheadPosition(playheadRef.current, { autoScroll: false });
  }, []);

  useLayoutEffect(() => {
    syncPlayheadPosition(playheadRef.current, { autoScroll: false });
  }, [pixelsPerSecond, syncPlayheadPosition]);

  // 播放头不在任何视频片段上（间隙 / 视频已结束）：黑屏并停掉解码
  useLayoutEffect(() => {
    if (activeVideoClip) return;
    videoSlot0Ref.current?.pause();
    videoSlot1Ref.current?.pause();
    setPausedFrameDataUrl(null);
  }, [activeVideoClip, clipLookupTime]);

  // 同步当前视频槽；播放中由 RAF + imperativePlayClip 换片，勿用 currentTime 反复 prepare（会与 seek 打架导致片间卡顿）
  useLayoutEffect(() => {
    if (useStackedVideoPreview) return;
    if (playheadDraggingRef.current || timelineScrubActiveRef.current || timelineScrubbing) return;
    if (!activeVideoClip) return;
    if (isPlaying) {
      const v = getActiveVideo();
      if (v) {
        v.muted = videoTrackMuted;
        const clipVol = activeVideoClip.volume ?? 1;
        v.volume = videoTrackMuted ? 0 : videoTrackVolume * clipVol;
      }
      return;
    }
    const timelineT = currentTime;
    const targetTime = getClipLocalMediaTime(activeVideoClip, timelineT);
    const activeSlot = activeVideoSlotRef.current;
    prepareVideoSlot(activeSlot, activeVideoClip, targetTime);
    applySlotVisibility(activeSlot);
    videoSyncKeyRef.current = clipVideoSyncKey(activeVideoClip);
    const next = getAdjacentNextVideoClip(activeVideoClip);
    if (next) prepareVideoSlot(getInactiveVideoSlot(), next, next.trimStart ?? 0);
  }, [
    activeVideoClip?.id,
    activeVideoClip,
    currentTime,
    isPlaying,
    videoTrackMuted,
    videoTrackVolume,
    timelineScrubbing,
    isFullscreen,
    prepareVideoSlot,
    applySlotVisibility,
    getActiveVideo,
    getInactiveVideoSlot,
    getAdjacentNextVideoClip,
    useStackedVideoPreview,
  ]);

  /** 全屏切换时 preview <video> 会 remount，需重置槽位并 seek 到当前时刻 */
  useLayoutEffect(() => {
    if (!hasTimelineVisual) return;
    slotClipKeyRef.current = ['', ''];
    slotPrimedRef.current = [false, false];
    setPausedFrameDataUrl(null);
    const t = playheadRef.current;
    if (useStackedVideoPreview) {
      lastVideoLayerClipIdsRef.current = {};
      syncVideoLayersToTimeRef.current(t);
    } else {
      seekPreviewAtTime(t);
    }
    syncPlayheadPosition(t, { autoScroll: 'if-outside' });
  }, [isFullscreen, hasTimelineVisual, useStackedVideoPreview, seekPreviewAtTime, syncPlayheadPosition]);

  useLayoutEffect(() => {
    if (!isPlaying) syncAudioToTime(currentTime);
  }, [isPlaying, currentTime, syncAudioToTime]);

  // 暂停时截取当前帧；scrub 期间不截帧；离屏或窗口隐藏时不截帧（减轻 canvas 压力）
  useEffect(() => {
    if (isPlaying || !activeVideoClip || activeVideoClip.type !== 'video') return;
    if (playheadDragging || timelineScrubbing) return;
    if (!isSpliceInViewport || document.visibilityState === 'hidden') return;

    const capture = () => {
      const v = getActiveVideo();
      if (v && v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(v, 0, 0);
            setPausedFrameDataUrl(canvas.toDataURL('image/jpeg', 0.82));
          }
        } catch (_) {}
      }
    };

    const timer = window.setTimeout(capture, 180);
    return () => window.clearTimeout(timer);
  }, [
    isPlaying,
    activeVideoClip,
    currentTime,
    playheadDragging,
    timelineScrubbing,
    getActiveVideo,
    isSpliceInViewport,
  ]);

  const seekTimelineAtClientX = useCallback(
    (clientX: number) => {
      if (timelineScrollbarDraggingRef.current) return;
      const time = getTimelineTimeFromClientX(clientX);
      if (time == null) return;
      rafActiveRef.current = false;
      setIsPlaying(false);
      setPausedFrameDataUrl(null);
      applyScrubTime(time, { immediate: true, autoScroll: false });
    },
    [getTimelineTimeFromClientX, applyScrubTime],
  );

  /** 点击刻度尺：跳转播放头（含刻度文字区域，以鼠标 X 为准） */
  const handleRulerSeekPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
      timelineSeekPointerRef.current = null;
      setSelectedClip(null);
      setSelectedClipIds(new Set());
      seekTimelineAtClientX(e.clientX);
    },
    [seekTimelineAtClientX],
  );

  const timelineSeekPointerRef = useRef<{ x: number; y: number; scrollLeft: number } | null>(null);

  const handleTimelineSeekPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    lastTimelinePointerRef.current = { clientX: e.clientX, clientY: e.clientY, valid: true };
    if (timelineScrollbarDraggingRef.current) return;
    const t = e.target as HTMLElement;
    if (t.closest('[data-clip]') || t.closest('[data-playhead]') || t.closest('[data-cut-action]')) return;
    if (t.closest(`.${SPLICE_SELECTABLE_TEXT}`)) return;
    const timelineEl = fullscreenTimelineRef.current || timelineRef.current;
    timelineSeekPointerRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: timelineEl?.scrollLeft ?? 0,
    };
  }, []);

  const handleTimelineSeekPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const down = timelineSeekPointerRef.current;
      const wasScrubbing = timelineScrubActiveRef.current;
      timelineSeekPointerRef.current = null;
      timelineScrubActiveRef.current = false;
      if (!down || e.button !== 0) return;
      const sel = typeof window !== 'undefined' ? window.getSelection() : null;
      if (sel && sel.toString().length > 0) return;
      if (wasScrubbing) {
        setTimelineScrubbing(false);
        flushScrubTime();
        syncAudioToTimeRef.current(playheadRef.current);
        return;
      }
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_THRESHOLD_PX) return;
      const timelineEl = fullscreenTimelineRef.current || timelineRef.current;
      if (timelineEl && Math.abs(timelineEl.scrollLeft - down.scrollLeft) > 2) return;
      setSelectedClip(null);
      setSelectedClipIds(new Set());
      seekTimelineAtClientX(e.clientX);
    },
    [seekTimelineAtClientX, flushScrubTime],
  );

  const handleBoxSelectStart = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    if (!e.shiftKey) return; // 仅按住 Shift 时启用选框，避免普通滑动拖黑区域
    setBoxSelectStart({ x: e.clientX, y: e.clientY });
    setBoxSelectEnd({ x: e.clientX, y: e.clientY });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const resolveDragTargetTrack = useCallback(
    (dragTrack: TimelineTrackRef, clientY: number): TimelineTrackRef => {
      const timelineEl = fullscreenTimelineRef.current || timelineRef.current;
      if (!timelineEl) return dragTrack;
      const rulerH = fullscreenTimelineRef.current ? RULER_HEIGHT_FULLSCREEN : RULER_HEIGHT;
      const videoCount = dragLayoutPreviewRef.current?.videoTracks.length ?? videoTracks.length;
      const audioCount = dragLayoutPreviewRef.current?.audioTracks.length ?? audioTracks.length;
      const resolved = resolveTimelineTrackFromClientY(
        clientY,
        timelineEl,
        rulerH,
        videoCount,
        audioCount,
      );
      if (resolved == null) return dragTrack;
      if (isVideoTrackRef(dragTrack) && isVideoTrackRef(resolved)) return resolved;
      if (isAudioTrackRef(dragTrack) && isAudioTrackRef(resolved)) return resolved;
      return dragTrack;
    },
    [videoTracks.length, audioTracks.length],
  );

  useEffect(() => {
    const len = data?.audioTracks?.length ?? 0;
    if (len >= DEFAULT_AUDIO_TRACK_COUNT) return;
    updateData({ audioTracks: normalizeAudioTracks(data?.audioTracks) });
  }, [data?.audioTracks, updateData]);

  useEffect(() => {
    const len = data?.videoTracks?.length ?? (data?.videoClips?.length ? 1 : 0);
    if (len >= DEFAULT_VIDEO_TRACK_COUNT) return;
    updateData({ videoTracks: normalizeVideoTracks(data), videoClips: normalizeVideoTracks(data)[0] });
  }, [data?.videoTracks, data?.videoClips, updateData]);

  const getTrackClipAreaEl = useCallback(
    (track: TimelineTrackRef) => {
      if (isVideoTrackRef(track)) {
        const idx = videoTrackIndexFromRef(track);
        return isFullscreen
          ? fullscreenVideoTrackContentRefs.current[idx] ?? fullscreenTrackContentRef.current
          : videoTrackContentRefs.current[idx] ?? trackContentRef.current;
      }
      const idx = track as number;
      return isFullscreen
        ? fullscreenAudioTrackContentRefs.current[idx]
        : audioTrackContentRefs.current[idx];
    },
    [isFullscreen],
  );

  /** 从所有轨移除该片段后，仅写入目标轨（避免跨轨拖动时复制） */
  const buildPlacementUpdate = useCallback(
    (placedOnTarget: TimelineClip[], targetTrack: TimelineTrackRef, clipId: string) => {
      const baseVideo = dragLayoutPreviewRef.current?.videoTracks ?? videoTracks;
      const baseAudio = dragLayoutPreviewRef.current?.audioTracks ?? audioTracks;
      const strippedVideo = baseVideo.map((t) => t.filter((c) => c.id !== clipId));
      const strippedAudio = baseAudio.map((t) => t.filter((c) => c.id !== clipId));
      if (isVideoTrackRef(targetTrack)) {
        const idx = videoTrackIndexFromRef(targetTrack);
        const nextVideo = strippedVideo.map((t, i) => (i === idx ? placedOnTarget : t));
        while (nextVideo.length <= idx) nextVideo.push([]);
        nextVideo[idx] = placedOnTarget;
        return { videoTracks: nextVideo, videoClips: nextVideo[0], audioTracks: strippedAudio };
      }
      const idx = targetTrack as number;
      const nextAudio = strippedAudio.map((t, i) => (i === idx ? placedOnTarget : t));
      while (nextAudio.length <= idx) nextAudio.push([]);
      nextAudio[idx] = placedOnTarget;
      return { videoTracks: strippedVideo, videoClips: strippedVideo[0], audioTracks: nextAudio };
    },
    [videoTracks, audioTracks],
  );

  const handleAddVideoTrack = useCallback(() => {
    const tracks = [...videoTracks, []];
    const muted = [...videoTrackMutedList];
    const vol = [...videoTrackVolumeList];
    const leftSnap = [...videoTrackLeftSnap];
    while (muted.length < tracks.length) muted.push(false);
    while (vol.length < tracks.length) vol.push(1);
    while (leftSnap.length < tracks.length) leftSnap.push(true);
    updateData({
      videoTracks: tracks,
      videoClips: tracks[0],
      videoTrackMutedList: muted,
      videoTrackVolumeList: vol,
      videoTrackLeftSnapList: leftSnap,
    });
  }, [videoTracks, videoTrackMutedList, videoTrackVolumeList, videoTrackLeftSnap, updateData]);

  const handleRemoveVideoTrack = useCallback(
    async (trackIdx: number) => {
      if (videoTracks.length <= DEFAULT_VIDEO_TRACK_COUNT) return;
      const track = videoTracks[trackIdx] ?? [];
      const label = vs.videoTrackLabel(trackIdx);
      if (track.length > 0) {
        const ok = await showConfirm(vs.removeVideoTrackConfirm(label));
        if (!ok) return;
      }
      disconnectEdgesForRemovedClips(track);
      const nextTracks = videoTracks.filter((_, i) => i !== trackIdx);
      const nextMuted = videoTrackMutedList.filter((_, i) => i !== trackIdx);
      const nextVol = videoTrackVolumeList.filter((_, i) => i !== trackIdx);
      const nextLeftSnap = videoTrackLeftSnap.filter((_, i) => i !== trackIdx);
      updateData({
        videoTracks: nextTracks,
        videoClips: nextTracks[0],
        videoTrackMutedList: nextMuted,
        videoTrackVolumeList: nextVol,
        videoTrackLeftSnapList: nextLeftSnap,
      });
      const removedIds = new Set(track.map((c) => c.id));
      setSelectedClip((prev) => {
        if (!prev) return null;
        if (isVideoTrackRef(prev.track) && videoTrackIndexFromRef(prev.track) === trackIdx) return null;
        if (isVideoTrackRef(prev.track)) {
          const pi = videoTrackIndexFromRef(prev.track);
          if (pi > trackIdx) return { clipId: prev.clipId, track: encodeVideoTrackRef(pi - 1) };
        }
        return prev;
      });
      setSelectedClipIds((prev) => {
        const next = new Set<string>();
        prev.forEach((cid) => {
          if (!removedIds.has(cid)) next.add(cid);
        });
        return next;
      });
      videoTrackContentRefs.current = videoTrackContentRefs.current.filter((_, i) => i !== trackIdx);
      fullscreenVideoTrackContentRefs.current = fullscreenVideoTrackContentRefs.current.filter((_, i) => i !== trackIdx);
    },
    [videoTracks, videoTrackMutedList, videoTrackVolumeList, videoTrackLeftSnap, updateData, showConfirm, vs, disconnectEdgesForRemovedClips],
  );

  const handleAddAudioTrack = useCallback(() => {
    const tracks = [...audioTracks, []];
    const muted = [...audioTrackMuted];
    const vol = [...audioTrackVolume];
    const leftSnap = [...audioTrackLeftSnap];
    while (muted.length < tracks.length) muted.push(false);
    while (vol.length < tracks.length) vol.push(1);
    while (leftSnap.length < tracks.length) leftSnap.push(true);
    updateData({ audioTracks: tracks, audioTrackMuted: muted, audioTrackVolume: vol, audioTrackLeftSnap: leftSnap });
  }, [audioTracks, audioTrackMuted, audioTrackVolume, audioTrackLeftSnap, updateData]);

  const handleRemoveAudioTrack = useCallback(
    async (trackIdx: number) => {
      if (audioTracks.length <= DEFAULT_AUDIO_TRACK_COUNT) return;
      const track = audioTracks[trackIdx] ?? [];
      const label = vs.audioTrackLabel(trackIdx);
      if (track.length > 0) {
        const ok = await showConfirm(vs.removeAudioTrackConfirm(label));
        if (!ok) return;
      }
      disconnectEdgesForRemovedClips(track);
      const nextTracks = audioTracks.filter((_, i) => i !== trackIdx);
      const nextMuted = audioTrackMuted.filter((_, i) => i !== trackIdx);
      const nextVol = audioTrackVolume.filter((_, i) => i !== trackIdx);
      const nextLeftSnap = audioTrackLeftSnap.filter((_, i) => i !== trackIdx);
      updateData({ audioTracks: nextTracks, audioTrackMuted: nextMuted, audioTrackVolume: nextVol, audioTrackLeftSnap: nextLeftSnap });
      const removedIds = new Set(track.map((c) => c.id));
      setSelectedClip((prev) => {
        if (!prev) return null;
        if (prev.track === trackIdx) return null;
        if (typeof prev.track === 'number' && prev.track > trackIdx) {
          return { clipId: prev.clipId, track: prev.track - 1 };
        }
        return prev;
      });
      setSelectedClipIds((prev) => {
        const next = new Set<string>();
        prev.forEach((id) => {
          if (!removedIds.has(id)) next.add(id);
        });
        return next;
      });
      audioRefsRef.current = audioRefsRef.current.filter((_, i) => i !== trackIdx);
      audioTrackContentRefs.current = audioTrackContentRefs.current.filter((_, i) => i !== trackIdx);
      fullscreenAudioTrackContentRefs.current = fullscreenAudioTrackContentRefs.current.filter(
        (_, i) => i !== trackIdx,
      );
    },
    [audioTracks, audioTrackMuted, audioTrackVolume, audioTrackLeftSnap, updateData, showConfirm, vs, disconnectEdgesForRemovedClips],
  );

  const handleClipDragStart = useCallback(
    (clip: TimelineClip, track: TimelineTrackRef, e: React.PointerEvent) => {
      e.stopPropagation();
      setBoxSelectStart(null);
      setBoxSelectEnd(null);
      const clipAreaEl = getTrackClipAreaEl(track);
      const contentX = clipAreaEl ? contentScreenXToLayoutPx(e.clientX, clipAreaEl) : 0;
      const pending = {
        clip,
        track,
        offsetX: contentX - clip.startTime * pixelsPerSecond,
        offsetY: e.clientY - (e.target as HTMLElement).getBoundingClientRect().top,
        startX: e.clientX,
        startY: e.clientY,
      };
      pendingClipDragRef.current = pending;
      setPendingClipDrag(pending);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [getTrackClipAreaEl, pixelsPerSecond],
  );

  const scheduleDragGhostUpdate = useCallback((clientX: number, clientY: number) => {
    dragGhostClientRef.current = { x: clientX, y: clientY };
    if (dragGhostRafRef.current) return;
    dragGhostRafRef.current = requestAnimationFrame(() => {
      dragGhostRafRef.current = 0;
      const el = dragGhostElRef.current;
      const drag = draggingClipRef.current;
      if (!el || !drag) return;
      const x = dragGhostClientRef.current.x - drag.offsetX;
      const y = dragGhostClientRef.current.y - drag.offsetY;
      el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) scale(1.02)`;
    });
  }, []);

  const handlePlayheadPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      rafActiveRef.current = false;
      setIsPlaying(false);
      setPausedFrameDataUrl(null);
      playheadDraggingRef.current = true;
      setPlayheadDragging(true);
      timelineSeekPointerRef.current = null;
      scrubTimelineAtClientX(e.clientX, { immediate: true });
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [scrubTimelineAtClientX],
  );

  const handleClipDragMove = useCallback(
    (e: React.PointerEvent) => {
      lastTimelinePointerRef.current = { clientX: e.clientX, clientY: e.clientY, valid: true };
      const primaryDown = (e.buttons & 1) === 1;

      if (boxSelectStart) {
        if (!primaryDown) return;
        setBoxSelectEnd({ x: e.clientX, y: e.clientY });
        return;
      }
      const seekDown = timelineSeekPointerRef.current;
      if (
        seekDown &&
        !timelineScrollbarDraggingRef.current &&
        !playheadDragging &&
        !draggingClip &&
        !boxSelectStart
      ) {
        if (!primaryDown) return;
        if (Math.hypot(e.clientX - seekDown.x, e.clientY - seekDown.y) > DRAG_THRESHOLD_PX) {
          timelineScrubActiveRef.current = true;
          setTimelineScrubbing(true);
          rafActiveRef.current = false;
          setIsPlaying(false);
          setPausedFrameDataUrl(null);
          scrubTimelineAtClientX(e.clientX);
        }
        return;
      }
      if (playheadDragging) {
        if (!primaryDown) return;
        scrubTimelineAtClientX(e.clientX);
        return;
      }
      if (!draggingClipRef.current) return;
      if (!primaryDown) return;
      scheduleDragGhostUpdate(e.clientX, e.clientY);

      const activeDrag = draggingClipRef.current;
      const targetTrack: TimelineTrackRef = resolveDragTargetTrack(activeDrag.track, e.clientY);
      const clipAreaEl = getTrackClipAreaEl(targetTrack);
      if (!clipAreaEl) return;

      const timelineEl = isFullscreen ? fullscreenTimelineRef.current : timelineRef.current;
      const timelineRect = timelineEl?.getBoundingClientRect();
      // 指针在轨道外时：将 X 钳制到轨道边缘，避免长素材拖拽时因指针移出可见区域而无法换位
      let effectiveClientX = e.clientX;
      if (timelineRect) {
        const outsideX = e.clientX < timelineRect.left || e.clientX > timelineRect.right;
        const outsideY = e.clientY < timelineRect.top || e.clientY > timelineRect.bottom;
        const outsideTimeline = outsideX || outsideY;
        if (outsideTimeline !== dragOutsideTimelineRef.current) {
          dragOutsideTimelineRef.current = outsideTimeline;
          setDragOutsideTimeline(outsideTimeline);
        }
        if (outsideX) effectiveClientX = Math.max(timelineRect.left, Math.min(timelineRect.right, e.clientX));
        // 单视频轨时垂直移出时间轴则停止；多视频轨/音频可在轨间垂直拖动
        {
          const vLen = dragLayoutPreviewRef.current?.videoTracks.length ?? videoTracks.length;
          if (outsideY && isVideoTrackRef(activeDrag.track) && vLen <= 1) return;
        }
      }
      const contentXAdjusted = contentScreenXToLayoutPx(effectiveClientX, clipAreaEl);

      const x = contentXAdjusted - activeDrag.offsetX;
      let newStartTime = Math.max(0, x / pixelsPerSecond);
      const dur = (activeDrag.clip.trimEnd ?? activeDrag.clip.duration) - (activeDrag.clip.trimStart ?? 0);

      const getEnd = (c: TimelineClip) => c.startTime + ((c.trimEnd ?? c.duration) - (c.trimStart ?? 0));
      const previewLayout = dragLayoutPreviewRef.current;
      const baseVideoTracks = previewLayout?.videoTracks ?? videoTracks;
      const baseAudioTracks = previewLayout?.audioTracks ?? audioTracks;
      const targetTrackClips = isVideoTrackRef(targetTrack)
        ? (baseVideoTracks[videoTrackIndexFromRef(targetTrack)] ?? [])
        : (baseAudioTracks[targetTrack as number] ?? []);
      const others = targetTrackClips.filter((c) => c.id !== activeDrag.clip.id);

      const snapCandidates: number[] = [];
      if (e.ctrlKey || e.metaKey) {
        for (let t = 0; t <= totalDuration; t += 1) snapCandidates.push(t);
      }
      others.forEach((c) => {
        snapCandidates.push(c.startTime);
        snapCandidates.push(getEnd(c));
      });
      const videoSnapList =
        dragLayoutPreviewRef.current?.videoTrackLeftSnapList ?? videoTrackLeftSnap;
      const targetLeftSnap = isVideoTrackRef(targetTrack)
        ? videoSnapList[videoTrackIndexFromRef(targetTrack)] !== false
        : audioTrackLeftSnap[targetTrack as number] !== false;
      if (targetLeftSnap) {
        const prevEnds = others.filter((c) => getEnd(c) <= newStartTime).map((c) => getEnd(c));
        if (prevEnds.length > 0) snapCandidates.push(Math.max(...prevEnds));
      }

      let snappedTime: number | null = null;
      if (autoSnap || e.ctrlKey || e.metaKey) {
        const thresholdPx = e.ctrlKey || e.metaKey ? 999 : SNAP_THRESHOLD_PX;
        const thresholdSec = thresholdPx / pixelsPerSecond;
        for (const t of snapCandidates) {
          if (Math.abs(newStartTime - t) < thresholdSec) {
            if (snappedTime == null || Math.abs(newStartTime - t) < Math.abs(newStartTime - snappedTime)) {
              snappedTime = t;
            }
          }
        }
      }
      if (snappedTime != null) {
        newStartTime = snappedTime;
        setSnapLineTime(snappedTime);
      } else {
        setSnapLineTime(null);
      }

      setClipDragVisual({ startTime: newStartTime, track: targetTrack });
      if (activeDrag.track !== targetTrack) {
        const trackOnlyDrag = { ...activeDrag, track: targetTrack };
        draggingClipRef.current = trackOnlyDrag;
        setDraggingClip(trackOnlyDrag);
      }

      let placed: TimelineClip[];
      /** 关磁吸且目标时间与同轨素材重叠：无法放入 → 新建关闭磁吸的视频轨，同时间轴放置 */
      let spillNewVideoTrack: {
        clip: TimelineClip;
        leftSnapList: boolean[];
        mutedList: boolean[];
        volumeList: number[];
      } | null = null;
      if (isVideoTrackRef(targetTrack)) {
        const vtSnap = videoSnapList[videoTrackIndexFromRef(targetTrack)] !== false;
        const dragEnd = newStartTime + dur;
        const overlappingClip = others.find((c) => {
          const cEnd = getEnd(c);
          return newStartTime < cEnd && dragEnd > c.startTime;
        });
        if (overlappingClip && !vtSnap) {
          // 关磁吸：同轨无法重叠放置 → 新建关闭磁吸的轨道，保持目标时间
          const spillClip = { ...activeDrag.clip, startTime: newStartTime };
          const leftSnapList = [...videoTrackLeftSnap];
          const mutedList = [...videoTrackMutedList];
          const volumeList = [...videoTrackVolumeList];
          while (leftSnapList.length < videoTracks.length) leftSnapList.push(true);
          while (mutedList.length < videoTracks.length) mutedList.push(false);
          while (volumeList.length < videoTracks.length) volumeList.push(1);
          leftSnapList.push(false);
          mutedList.push(false);
          volumeList.push(1);
          spillNewVideoTrack = { clip: spillClip, leftSnapList, mutedList, volumeList };
          placed = others.map((c) => ({ ...c }));
          setSnapLineTime(newStartTime);
        } else if (vtSnap) {
          // 开磁吸：重排紧凑，同轨不保留时间重叠
          placed = insertVideoClipOnTrack(others, activeDrag.clip, newStartTime);
          const placedDrag = placed.find((p) => p.id === activeDrag.clip.id);
          if (placedDrag) setSnapLineTime(placedDrag.startTime);
        } else {
          placed = others.map((c) => ({ ...c })).concat([{ ...activeDrag.clip, startTime: newStartTime }]);
          const placedDrag = placed.find((p) => p.id === activeDrag.clip.id);
          if (placedDrag) setSnapLineTime(placedDrag.startTime);
        }
      } else {
        const draggedOriginalStart = activeDrag.clip.startTime;
        const dragEnd = newStartTime + dur;
        // 音频轨：两素材交换；未过中点则不移动
        const overlappingClip = others.find((c) => {
          const cEnd = getEnd(c);
          return newStartTime < cEnd && dragEnd > c.startTime;
        });

        if (overlappingClip) {
          const midpoint = (draggedOriginalStart + overlappingClip.startTime) / 2;
          const pastHalf = overlappingClip.startTime > draggedOriginalStart
            ? newStartTime >= midpoint
            : newStartTime <= midpoint;
          if (pastHalf) {
            placed = others.map((c) =>
              c.id === overlappingClip.id ? { ...c, startTime: draggedOriginalStart } : { ...c }
            ).concat([{ ...activeDrag.clip, startTime: overlappingClip.startTime }]);
            placed.sort((a, b) => a.startTime - b.startTime);
            if (audioTrackLeftSnap[targetTrack as number] !== false) placed = compactTrack(placed);
            const placedDrag = placed.find((p) => p.id === activeDrag.clip.id);
            if (placedDrag) setSnapLineTime(placedDrag.startTime);
          } else {
            return;
          }
        } else {
          placed = others.map((c) => ({ ...c })).concat([{ ...activeDrag.clip, startTime: newStartTime }]);
          placed.sort((a, b) => a.startTime - b.startTime);
          if (audioTrackLeftSnap[targetTrack as number] !== false) placed = compactTrack(placed);
        }
      }

      if (spillNewVideoTrack) {
        // 始终基于已提交轨道重建，避免预览帧反复追加新轨
        const strippedVideo = videoTracks.map((t) => t.filter((c) => c.id !== activeDrag.clip.id));
        const strippedAudio = audioTracks.map((t) => t.filter((c) => c.id !== activeDrag.clip.id));
        const nextVideo = [...strippedVideo, [spillNewVideoTrack.clip]];
        const spillTrack = encodeVideoTrackRef(nextVideo.length - 1);
        setClipDragVisual({ startTime: spillNewVideoTrack.clip.startTime, track: spillTrack });
        setDragLayoutPreview({
          videoTracks: nextVideo,
          audioTracks: strippedAudio,
          videoTrackLeftSnapList: spillNewVideoTrack.leftSnapList,
          videoTrackMutedList: spillNewVideoTrack.mutedList,
          videoTrackVolumeList: spillNewVideoTrack.volumeList,
        });
        const nextDrag = {
          ...activeDrag,
          track: spillTrack,
          clip: spillNewVideoTrack.clip,
        };
        draggingClipRef.current = nextDrag;
        setDraggingClip(nextDrag);
        return;
      }

      const placedClip = placed.find((p) => p.id === activeDrag.clip.id)!;
      const preview = buildPlacementUpdate(placed, targetTrack, activeDrag.clip.id);
      const prevMeta = dragLayoutPreviewRef.current;
      // 若预览已溢出建轨，后续普通放置需保留磁吸/静音/音量元数据，并去掉已空的尾部溢出轨
      let nextVideo = preview.videoTracks;
      let nextSnap = prevMeta?.videoTrackLeftSnapList;
      let nextMuted = prevMeta?.videoTrackMutedList;
      let nextVol = prevMeta?.videoTrackVolumeList;
      if (nextSnap && nextSnap.length > videoTracks.length) {
        while (
          nextVideo.length > videoTracks.length &&
          (nextVideo[nextVideo.length - 1]?.length ?? 0) === 0
        ) {
          nextVideo = nextVideo.slice(0, -1);
          nextSnap = nextSnap.slice(0, -1);
          nextMuted = nextMuted?.slice(0, -1);
          nextVol = nextVol?.slice(0, -1);
        }
      }
      setDragLayoutPreview({
        videoTracks: nextVideo,
        audioTracks: preview.audioTracks,
        videoTrackLeftSnapList: nextSnap,
        videoTrackMutedList: nextMuted,
        videoTrackVolumeList: nextVol,
      });
      const nextDrag = {
        ...activeDrag,
        track: targetTrack,
        clip: placedClip,
      };
      draggingClipRef.current = nextDrag;
      setDraggingClip(nextDrag);
    },
    [boxSelectStart, playheadDragging, draggingClip, getTimelineTimeFromClientX, scrubTimelineAtClientX, videoTracks, audioTracks, buildPlacementUpdate, videoTrackLeftSnap, videoTrackMutedList, videoTrackVolumeList, audioTrackLeftSnap, autoSnap, compactTrack, insertVideoClipOnTrack, resolveDragTargetTrack, getTrackClipAreaEl, isFullscreen, scheduleDragGhostUpdate]
  );

  const handleClipDragEnd = useCallback((e?: React.PointerEvent<HTMLDivElement> | PointerEvent) => {
    if (boxSelectStart && boxSelectEnd) {
      const timelineEl = fullscreenTimelineRef.current || timelineRef.current;
      const contentEl = fullscreenTrackContentRef.current || trackContentRef.current;
      if (timelineEl && contentEl) {
        const rect = timelineEl.getBoundingClientRect();
        const contentRect = contentEl.getBoundingClientRect();
        const rulerH = fullscreenTimelineRef.current ? RULER_HEIGHT_FULLSCREEN : RULER_HEIGHT;
        const x1 = Math.min(boxSelectStart.x, boxSelectEnd.x);
        const x2 = Math.max(boxSelectStart.x, boxSelectEnd.x);
        const y1 = Math.min(boxSelectStart.y, boxSelectEnd.y);
        const y2 = Math.max(boxSelectStart.y, boxSelectEnd.y);
        const timeMin = Math.max(0, contentScreenXToLayoutPx(x1, contentEl) / pixelsPerSecond);
        const timeMax = Math.min(totalDuration, contentScreenXToLayoutPx(x2, contentEl) / pixelsPerSecond);
        const trackMin = Math.max(0, Math.floor((y1 - rect.top - rulerH) / TRACK_HEIGHT));
        const trackMax = Math.max(0, Math.floor((y2 - rect.top - rulerH) / TRACK_HEIGHT));
        const ids = new Set<string>();
        for (let tr = trackMin; tr <= trackMax; tr++) {
          if (tr < videoTracks.length) {
            (videoTracks[tr] ?? []).forEach((c) => {
              const dur = (c.trimEnd ?? c.duration) - (c.trimStart ?? 0);
              const cEnd = c.startTime + dur;
              if (c.startTime < timeMax && cEnd > timeMin) ids.add(c.id);
            });
          } else {
            const track = audioTracks[tr - videoTracks.length];
            if (track) {
              track.forEach((c) => {
                const dur = (c.trimEnd ?? c.duration) - (c.trimStart ?? 0);
                const cEnd = c.startTime + dur;
                if (c.startTime < timeMax && cEnd > timeMin) ids.add(c.id);
              });
            }
          }
        }
        setSelectedClipIds(ids);
        if (ids.size > 0) {
          const firstId = [...ids][0];
          let foundTrack: TimelineTrackRef = 'video';
          let found = false;
          for (let vi = 0; vi < videoTracks.length; vi++) {
            if (videoTracks[vi]?.some((c) => c.id === firstId)) {
              foundTrack = encodeVideoTrackRef(vi);
              found = true;
              break;
            }
          }
          if (!found) {
            const audioIdx = audioTracks.findIndex((t) => t.some((c) => c.id === firstId));
            foundTrack = audioIdx >= 0 ? audioIdx : 0;
          }
          setSelectedClip({ clipId: firstId, track: foundTrack });
        } else {
          setSelectedClip(null);
        }
      }
      setBoxSelectStart(null);
      setBoxSelectEnd(null);
    }
    // 拖拽释放：轨道外移除素材；轨道内按释放位置应用放置（含交换）
    if (draggingClip && e) {
      const timelineEl = fullscreenTimelineRef.current || timelineRef.current;
      const rect = timelineEl?.getBoundingClientRect();
      if (rect) {
        const isOutside = e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
        if (isOutside) {
          removeClipsByIds(new Set([draggingClip.clip.id]));
        } else {
          const preview = dragLayoutPreviewRef.current;
          if (preview) {
            const snapList = preview.videoTrackLeftSnapList ?? videoTrackLeftSnap;
            const mutedList = preview.videoTrackMutedList ?? videoTrackMutedList;
            const volumeList = preview.videoTrackVolumeList ?? videoTrackVolumeList;
            const nextVideo = preview.videoTracks.map((t, i) =>
              snapList[i] !== false ? compactTrack(t) : t,
            );
            const payload: Record<string, unknown> = {
              videoTracks: nextVideo,
              videoClips: nextVideo[0],
              audioTracks: preview.audioTracks.map((t, i) =>
                audioTrackLeftSnap[i] !== false ? compactTrack(t) : t,
              ),
            };
            if (preview.videoTrackLeftSnapList) {
              const alignedSnap = [...snapList];
              while (alignedSnap.length < nextVideo.length) alignedSnap.push(false);
              payload.videoTrackLeftSnapList = alignedSnap.slice(0, nextVideo.length);
              payload.videoTrackLeftSnap = alignedSnap[0];
            }
            if (preview.videoTrackMutedList) {
              const alignedMuted = [...mutedList];
              while (alignedMuted.length < nextVideo.length) alignedMuted.push(false);
              payload.videoTrackMutedList = alignedMuted.slice(0, nextVideo.length);
            }
            if (preview.videoTrackVolumeList) {
              const alignedVol = [...volumeList];
              while (alignedVol.length < nextVideo.length) alignedVol.push(1);
              payload.videoTrackVolumeList = alignedVol.slice(0, nextVideo.length);
            }
            updateData(payload as any);
          }
        }
        // 轨道内释放：位置在 pointermove 预览中已计算，此处一次性持久化
      }
    }
    if (pendingClipDragRef.current && !draggingClip) {
      const { clip, track } = pendingClipDragRef.current;
      setSelectedClip({ clipId: clip.id, track });
      setSelectedClipIds(new Set([clip.id]));
    }
    pendingClipDragRef.current = null;
    setPendingClipDrag(null);
    setDraggingClip(null);
    draggingClipRef.current = null;
    dragOutsideTimelineRef.current = false;
    setDragOutsideTimeline(false);
    setDragLayoutPreview(null);
    setClipDragVisual(null);
    if (dragGhostRafRef.current) {
      cancelAnimationFrame(dragGhostRafRef.current);
      dragGhostRafRef.current = 0;
    }
    setSnapLineTime(null);
    if (playheadDraggingRef.current || timelineScrubActiveRef.current) {
      flushScrubTime();
      syncPlayheadPosition(playheadRef.current, { autoScroll: 'if-outside' });
      syncAudioToTimeRef.current(playheadRef.current);
    }
    playheadDraggingRef.current = false;
    timelineScrubActiveRef.current = false;
    timelineSeekPointerRef.current = null;
    timelineScrollbarDraggingRef.current = false;
    scrubPointerClientXRef.current = null;
    setTimelineScrubbing(false);
    setPlayheadDragging(false);
  }, [boxSelectStart, boxSelectEnd, pixelsPerSecond, totalDuration, videoTracks, audioTracks, draggingClip, removeClipsByIds, compactTrack, updateData, videoTrackLeftSnap, videoTrackMutedList, videoTrackVolumeList, audioTrackLeftSnap, autoSnap, resolveDragTargetTrack, flushScrubTime, syncPlayheadPosition]);

  handleClipDragMoveRef.current = handleClipDragMove;
  handleClipDragEndRef.current = handleClipDragEnd;

  useEffect(() => {
    const onUp = () => {
      timelineScrollbarDraggingRef.current = false;
    };
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  /** 指针停在边缘时持续滚屏并推进播放头 */
  const scrubTimelineAtClientXRef = useRef(scrubTimelineAtClientX);
  scrubTimelineAtClientXRef.current = scrubTimelineAtClientX;
  const maybeAutoScrollTimelineAtClientXRef = useRef(maybeAutoScrollTimelineAtClientX);
  maybeAutoScrollTimelineAtClientXRef.current = maybeAutoScrollTimelineAtClientX;

  useEffect(() => {
    if (!playheadDragging && !timelineScrubbing) return;
    let rafId = 0;
    const tick = () => {
      const x = scrubPointerClientXRef.current;
      if (x != null && (playheadDraggingRef.current || timelineScrubActiveRef.current)) {
        const m = getTimelineScrollMetrics();
        if (m) {
          const { left: visibleLeft, right: visibleRight } = getTimelineVisibleContentScreenEdges(m);
          const inEdge =
            x < visibleLeft + TIMELINE_EDGE_SCROLL_ZONE_PX ||
            x > visibleRight - TIMELINE_EDGE_SCROLL_ZONE_PX;
          if (inEdge) {
            maybeAutoScrollTimelineAtClientXRef.current(x);
            scrubTimelineAtClientXRef.current(x);
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playheadDragging, timelineScrubbing, getTimelineScrollMetrics, getTimelineVisibleContentScreenEdges]);

  useEffect(() => {
    const needsGlobalPointer =
      draggingClip || pendingClipDrag || playheadDragging || boxSelectStart || timelineScrubbing;
    if (!needsGlobalPointer) return;
    const onMove = (e: PointerEvent) => {
      if (pendingClipDrag && !draggingClip) {
        const dx = e.clientX - pendingClipDrag.startX;
        const dy = e.clientY - pendingClipDrag.startY;
        if (Math.sqrt(dx * dx + dy * dy) >= DRAG_THRESHOLD_PX) {
          const nextDrag = {
            clip: pendingClipDrag.clip,
            track: pendingClipDrag.track,
            offsetX: pendingClipDrag.offsetX,
            offsetY: pendingClipDrag.offsetY,
          };
          draggingClipRef.current = nextDrag;
          setDraggingClip(nextDrag);
          setClipDragVisual({ startTime: pendingClipDrag.clip.startTime, track: pendingClipDrag.track });
          dragGhostClientRef.current = { x: e.clientX, y: e.clientY };
          pendingClipDragRef.current = null;
          setPendingClipDrag(null);
        }
      }
      handleClipDragMoveRef.current?.(e as unknown as React.PointerEvent);
    };
    const onUp = (ev: PointerEvent) => handleClipDragEndRef.current(ev);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, [draggingClip, pendingClipDrag, playheadDragging, boxSelectStart, timelineScrubbing]);

  // 视频播放到裁剪区间末尾时停止，避免播放被裁掉的部分；将 v.currentTime 设为 te 使 v.ended=true，RAF 才能用 elapsed 继续推进
  // 若 RAF 已推进到下一片段，不再回写 currentTime，避免刻度线在片段边界回弹
  const handleVideoTimeUpdate = useCallback(() => {
    const v = getActiveVideo();
    if (!v || !isPlaying) return;
    const clip = getClipForTime(playheadRef.current);
    if (!clip || clip.type !== 'video') return;
    const hint = resolveClipSourceHint(clip);
    const te = effectiveClipTrimEnd(clip, hint);
    const clipEnd = clipPlaybackEndSec(clip, hint);
    if (clipEnd !== Number.POSITIVE_INFINITY && playheadRef.current > clipEnd + 0.02) return;
    if (Number.isFinite(te) && v.currentTime >= te - 0.04) {
      v.pause();
    }
  }, [isPlaying, getClipForTime, getActiveVideo, resolveClipSourceHint]);

  const handlePreviewVideoEnded = useCallback(() => {
    if (isPlaying) return;
    const clip = activeVideoClip;
    if (!clip) return;
    const hint = resolveClipSourceHint(clip);
    const endTime = clipPlaybackEndSec(clip, hint);
    const stopAt = contentEnd > 0 ? contentEnd : totalDuration;
    if (endTime !== Number.POSITIVE_INFINITY && endTime >= stopAt) {
      setCurrentTime(stopAt);
      setIsPlaying(false);
    } else if (endTime !== Number.POSITIVE_INFINITY) {
      setCurrentTime(endTime);
    }
  }, [isPlaying, activeVideoClip, contentEnd, totalDuration, resolveClipSourceHint]);

  const handleClipTrimChange = useCallback(
    (trimStart: number, trimEnd: number) => {
      if (!selectedClip) return;
      if (isVideoTrackRef(selectedClip.track)) {
        const trackIdx = videoTrackIndexFromRef(selectedClip.track);
        const updated = videoTracks.map((t, i) =>
          i === trackIdx ? t.map((c) => (c.id === selectedClip.clipId ? { ...c, trimStart, trimEnd } : c)) : t,
        );
        updateData({ videoTracks: updated, videoClips: updated[0] });
      } else {
        const trackIdx = selectedClip.track as number;
        const track = audioTracks[trackIdx] ?? [];
        const updated = [...audioTracks];
        updated[trackIdx] = track.map((c) =>
          c.id === selectedClip.clipId ? { ...c, trimStart, trimEnd } : c,
        );
        updateData({ audioTracks: updated });
      }
    },
    [selectedClip, videoTracks, audioTracks, updateData],
  );

  /** 胶片白框左右把手：就地微调 trim（视频/图片）；拖动过程按按下时快照计算，避免累计漂移 */
  const clipEdgeTrimRef = useRef<{
    track: TimelineTrackRef;
    edge: 'start' | 'end';
    startX: number;
    snapshot: TimelineClip;
    sourceHint: number;
  } | null>(null);
  const videoTracksLiveRef = useRef(videoTracks);
  videoTracksLiveRef.current = videoTracks;
  const audioTracksLiveRef = useRef(audioTracks);
  audioTracksLiveRef.current = audioTracks;

  const applyClipPatchOnTrack = useCallback(
    (track: TimelineTrackRef, clipId: string, patch: Partial<TimelineClip>) => {
      if (isVideoTrackRef(track)) {
        const trackIdx = videoTrackIndexFromRef(track);
        const current = videoTracksLiveRef.current;
        const updated = current.map((t, i) =>
          i === trackIdx ? t.map((c) => (c.id === clipId ? { ...c, ...patch } : c)) : t,
        );
        updateData({ videoTracks: updated, videoClips: updated[0] });
      } else {
        const trackIdx = track as number;
        const current = audioTracksLiveRef.current;
        const next = current.map((t, i) =>
          i === trackIdx ? t.map((c) => (c.id === clipId ? { ...c, ...patch } : c)) : t,
        );
        updateData({ audioTracks: next });
      }
    },
    [updateData],
  );

  const handleClipTrimEdgePointerDown = useCallback(
    (clip: TimelineClip, track: TimelineTrackRef, edge: 'start' | 'end', e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      pendingClipDragRef.current = null;
      setPendingClipDrag(null);
      setSelectedClip({ clipId: clip.id, track });
      setSelectedClipIds(new Set([clip.id]));
      clipEdgeTrimRef.current = {
        track,
        edge,
        startX: e.clientX,
        snapshot: { ...clip },
        sourceHint: resolveClipSourceHint(clip),
      };
      clipEdgeTrimmingLiveRef.current = true;
      setClipEdgeTrimming(true);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [resolveClipSourceHint],
  );

  useEffect(() => {
    if (!clipEdgeTrimming) return;
    const MIN = 0.1;
    const onMove = (e: PointerEvent) => {
      const st = clipEdgeTrimRef.current;
      if (!st) return;
      const deltaSec = (e.clientX - st.startX) / pixelsPerSecond;
      const snap = st.snapshot;
      const imageUsesDuration =
        snap.type === 'image' &&
        !(snap.trimEnd != null && snap.trimEnd > (snap.trimStart ?? 0));
      if (imageUsesDuration) {
        if (st.edge === 'start') {
          const newDur = Math.max(MIN, snap.duration - deltaSec);
          const used = snap.duration - newDur;
          applyClipPatchOnTrack(st.track, snap.id, {
            startTime: Math.max(0, snap.startTime + used),
            duration: newDur,
          });
        } else {
          applyClipPatchOnTrack(st.track, snap.id, {
            duration: Math.max(MIN, snap.duration + deltaSec),
          });
        }
        return;
      }
      const ts0 = snap.trimStart ?? 0;
      const te0 = effectiveClipTrimEnd(snap, st.sourceHint);
      const mediaDur = Math.max(
        Number.isFinite(snap.duration) ? snap.duration : 0,
        st.sourceHint || 0,
        te0 > 0 && Number.isFinite(te0) ? te0 : 0,
      );
      const maxTe = mediaDur > 0 ? mediaDur : Number.POSITIVE_INFINITY;
      if (st.edge === 'start') {
        const newTs = Math.max(0, Math.min(te0 - MIN, ts0 + deltaSec));
        const dTs = newTs - ts0;
        applyClipPatchOnTrack(st.track, snap.id, {
          trimStart: newTs,
          trimEnd: te0,
          startTime: Math.max(0, snap.startTime + dTs),
        });
      } else {
        const newTe = Math.max(ts0 + MIN, Math.min(maxTe, te0 + deltaSec));
        applyClipPatchOnTrack(st.track, snap.id, {
          trimStart: ts0,
          trimEnd: newTe,
        });
      }
    };
    const onUp = () => {
      clipEdgeTrimRef.current = null;
      clipEdgeTrimmingLiveRef.current = false;
      setClipEdgeTrimming(false);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      clipEdgeTrimmingLiveRef.current = false;
    };
  }, [clipEdgeTrimming, pixelsPerSecond, applyClipPatchOnTrack]);

  const capturePausedFrame = useCallback(() => {
    const v = getActiveVideo();
    if (!v || v.readyState < 2 || v.videoWidth <= 0 || v.videoHeight <= 0) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(v, 0, 0);
        setPausedFrameDataUrl(canvas.toDataURL('image/jpeg', 0.9));
      }
    } catch (_) {}
  }, [getActiveVideo]);

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      const t = playheadRef.current;
      rafActiveRef.current = false;
      playheadRef.current = t;
      syncPlayheadPosition(t, { autoScroll: false });
      setCurrentTime(t);
      getActiveVideo()?.pause();
      videoSlot0Ref.current?.pause();
      videoSlot1Ref.current?.pause();
      videoLayerRefs.current.forEach((el) => el?.pause());
      applySlotVisibility(activeVideoSlotRef.current);
      capturePausedFrame();
      setIsPlaying(false);
      return;
    }
    const t = playheadRef.current;
    setPausedFrameDataUrl(null);
    playheadRef.current = t;
    syncPlayheadPosition(t, { autoScroll: 'if-outside' });
    setCurrentTime(t);
    rafActiveRef.current = true;
    syncAudioToTimeRef.current(t);
    stackedVideoSyncWallRef.current = 0;
    stackedDecodeMaskRef.current = '';
    syncVideoLayersToTimeRef.current(t);
    setIsPlaying(true);
    requestAnimationFrame(() => {
      if (useStackedVideoPreview) {
        syncVideoLayersToTimeRef.current(playheadRef.current);
      } else {
        const clip = getClipForTime(playheadRef.current);
        if (clip?.type === 'video' && !clipIsImageMedia(clip)) {
          imperativePlayClip(clip, playheadRef.current);
          applySlotVisibility(activeVideoSlotRef.current);
          // 再补一帧：避免首段 seek 未完成时 play 被吞掉，整段看起来静止
          requestAnimationFrame(() => {
            if (!isPlayingRef.current) return;
            const el = getActiveVideo();
            const still = getClipForTime(playheadRef.current);
            if (still?.type === 'video' && el?.paused) {
              imperativePlayClip(still, playheadRef.current);
            }
          });
        } else {
          getActiveVideo()?.pause();
        }
      }
    });
  }, [isPlaying, capturePausedFrame, syncPlayheadPosition, getClipForTime, getActiveVideo, imperativePlayClip, applySlotVisibility, useStackedVideoPreview]);

  // 窗口/全屏：空格键播放/暂停（需先点击节点内区域激活）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selected && !isFullscreen && !spliceEditingRef.current) return;
      if (e.key !== ' ') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      e.stopPropagation();
      handlePlayPause();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selected, isFullscreen, handlePlayPause]);

  const handleToggleVideoTrackMute = useCallback(
    (trackIdx: number) => {
      const next = [...videoTrackMutedList];
      while (next.length <= trackIdx) next.push(false);
      next[trackIdx] = !next[trackIdx];
      updateData({ videoTrackMutedList: next, videoTrackMuted: next[0] });
    },
    [videoTrackMutedList, updateData],
  );

  const handleToggleVideoTrackLeftSnap = useCallback(
    (trackIdx: number) => {
      const next = [...videoTrackLeftSnap];
      while (next.length <= trackIdx) next.push(true);
      const enabling = !next[trackIdx];
      next[trackIdx] = enabling;
      if (enabling) {
        const tracks = videoTracks.map((t, i) => (i === trackIdx ? compactTrack(t) : t));
        updateData({
          videoTrackLeftSnapList: next,
          videoTrackLeftSnap: next[0],
          videoTracks: tracks,
          videoClips: tracks[0],
        });
      } else {
        updateData({ videoTrackLeftSnapList: next, videoTrackLeftSnap: next[0] });
      }
    },
    [videoTrackLeftSnap, videoTracks, compactTrack, updateData],
  );

  const handleToggleAudioTrackLeftSnap = useCallback(
    (trackIdx: number) => {
      const next = [...audioTrackLeftSnap];
      while (next.length <= trackIdx) next.push(true);
      const enabling = !next[trackIdx];
      next[trackIdx] = enabling;
      if (enabling) {
        const tracks = audioTracks.map((t, i) => (i === trackIdx ? compactTrack(t) : t));
        updateData({ audioTrackLeftSnap: next, audioTracks: tracks });
      } else {
        updateData({ audioTrackLeftSnap: next });
      }
    },
    [audioTrackLeftSnap, audioTracks, compactTrack, updateData],
  );

  const handleToggleAudioTrackMute = useCallback((trackIdx: number) => {
    const next = [...audioTrackMuted];
    next[trackIdx] = !next[trackIdx];
    updateData({ audioTrackMuted: next });
  }, [audioTrackMuted, updateData]);

  const handleVideoTrackVolumeChange = useCallback(
    (trackIdx: number, v: number) => {
      const next = [...videoTrackVolumeList];
      while (next.length <= trackIdx) next.push(1);
      next[trackIdx] = Math.max(0, Math.min(1, v));
      updateData({ videoTrackVolumeList: next, videoTrackVolume: next[0] });
    },
    [videoTrackVolumeList, updateData],
  );

  const handleAudioTrackVolumeChange = useCallback((trackIdx: number, v: number) => {
    const next = [...audioTrackVolume];
    while (next.length <= trackIdx) next.push(1);
    next[trackIdx] = clampSpliceAudioVolume(v);
    updateData({ audioTrackVolume: next });
  }, [audioTrackVolume, updateData]);

  const handleClipVolumeChange = useCallback((clipId: string, track: TimelineTrackRef, v: number) => {
    const isAudioClip = !isVideoTrackRef(track);
    const vol = isAudioClip ? clampSpliceAudioVolume(v) : Math.max(0, Math.min(1, v));
    if (isVideoTrackRef(track)) {
      const trackIdx = videoTrackIndexFromRef(track);
      const updated = videoTracks.map((t, i) =>
        i === trackIdx ? t.map((c) => (c.id === clipId ? { ...c, volume: vol } : c)) : t,
      );
      updateData({ videoTracks: updated, videoClips: updated[0] });
    } else {
      const trackIdx = track as number;
      const updated = [...audioTracks];
      const t = updated[trackIdx] ?? [];
      updated[trackIdx] = t.map((c) => (c.id === clipId ? { ...c, volume: vol } : c));
      updateData({ audioTracks: updated });
    }
  }, [videoTracks, audioTracks, updateData]);

  const splitClipsAtTimeOnTrack = useCallback(
    (t: number, track: TimelineTrackRef, opts?: { clipId?: string }): boolean => {
      const applySplit = (
        trackRef: TimelineTrackRef,
        clipId: string,
        pair: [TimelineClip, TimelineClip],
        sourceNodeId?: string,
      ) => {
        if (isVideoTrackRef(trackRef)) {
          const trackIdx = videoTrackIndexFromRef(trackRef);
          const newTrack = (videoTracks[trackIdx] ?? []).flatMap((c) => (c.id === clipId ? pair : [c]));
          const nextVideo = videoTracks.map((tr, i) => (i === trackIdx ? newTrack : tr));
          updateData({ videoTracks: nextVideo, videoClips: nextVideo[0] });
        } else {
          const trackIdx = trackRef as number;
          const newTrack = (audioTracks[trackIdx] ?? []).flatMap((c) => (c.id === clipId ? pair : [c]));
          const newAudio = audioTracks.map((tr, ti) => (ti === trackIdx ? newTrack : tr));
          updateData({ audioTracks: newAudio });
        }
        if (sourceNodeId) {
          setEdges((eds) => eds.filter((e) => !(e.target === id && e.source === sourceNodeId)));
        }
      };

      const trySplitClip = (trackRef: TimelineTrackRef, clip: TimelineClip): boolean => {
        const pair = splitClipAtTimelineTime(clip, t);
        if (!pair) return false;
        applySplit(trackRef, clip.id, pair, clip.sourceNodeId);
        return true;
      };

      if (opts?.clipId) {
        const clip = clipFromTrackRef(track, opts.clipId);
        if (clip && trySplitClip(track, clip)) return true;
        showAlert(vs.cutSplitNothingAlert);
        return false;
      }

      const sourceTrack = isVideoTrackRef(track)
        ? (videoTracks[videoTrackIndexFromRef(track)] ?? [])
        : (audioTracks[track as number] ?? []);
      const hit = findClipAtTimelineTime(sourceTrack, t, resolveClipSourceHint);
      if (hit && trySplitClip(track, hit)) return true;

      showAlert(vs.cutSplitNothingAlert);
      return false;
    },
    [videoTracks, audioTracks, updateData, showAlert, vs, clipFromTrackRef, setEdges, id, resolveClipSourceHint],
  );

  const resolveSplitTargetTrack = useCallback((): TimelineTrackRef | null => {
    const t = playheadRef.current;
    if (selectedClip) {
      const clip = clipFromTrackRef(selectedClip.track, selectedClip.clipId);
      if (clip && clipContainsTimelineTime(clip, t, resolveClipSourceHint(clip))) return selectedClip.track;
      if (isVideoTrackRef(selectedClip.track)) return selectedClip.track;
      if (isAudioTrackRef(selectedClip.track)) return selectedClip.track;
    }
    for (let i = 0; i < videoTracks.length; i++) {
      if (findClipAtTimelineTime(videoTracks[i], t, resolveClipSourceHint)) return encodeVideoTrackRef(i);
    }
    for (let i = 0; i < audioTracks.length; i++) {
      if (findClipAtTimelineTime(audioTracks[i], t, resolveClipSourceHint)) return i;
    }
    return selectedClip?.track ?? null;
  }, [selectedClip, videoTracks, audioTracks, clipFromTrackRef, resolveClipSourceHint]);

  const performSplitAtPlayhead = useCallback(() => {
    if (scrubRafRef.current != null) {
      cancelAnimationFrame(scrubRafRef.current);
      scrubRafRef.current = null;
    }
    const t = pendingScrubTimeRef.current ?? playheadRef.current;
    pendingScrubTimeRef.current = null;
    playheadRef.current = t;
    setCurrentTime(t);

    const track = resolveSplitTargetTrack();
    if (track == null) {
      showAlert(vs.cutSplitNothingAlert);
      return;
    }
    splitClipsAtTimeOnTrack(t, track, {
      clipId: selectedClip && tracksEqual(selectedClip.track, track) ? selectedClip.clipId : undefined,
    });
  }, [resolveSplitTargetTrack, splitClipsAtTimeOnTrack, showAlert, vs.cutSplitNothingAlert, selectedClip]);

  const handleCutModeToggle = useCallback(() => {
    setCutMode((prev) => !prev);
  }, []);

  const handleCutAtPlayhead = useCallback(
    (e: React.MouseEvent | React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!cutMode) return;
      performSplitAtPlayhead();
    },
    [cutMode, performSplitAtPlayhead],
  );

  // Ctrl+X / ⌘+X：第一次进入剪刀模式，再次按下在播放头处剪断
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selected && !isFullscreen && !spliceEditingRef.current) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'x') return;
      e.preventDefault();
      e.stopPropagation();
      if (!cutMode) {
        setCutMode(true);
        return;
      }
      performSplitAtPlayhead();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selected, isFullscreen, cutMode, performSplitAtPlayhead]);

  // Ctrl+C / Ctrl+V：复制粘贴选中素材
  useEffect(() => {
    const canUseSpliceShortcuts = () => selected || isFullscreen || spliceEditingRef.current;
    const isTypingTarget = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (!canUseSpliceShortcuts()) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (isTypingTarget(e)) return;
      const key = e.key.toLowerCase();
      if (key === 'c') {
        if (selectedClipIdSet.size === 0) return;
        e.preventDefault();
        e.stopPropagation();
        copySelectedClips();
        return;
      }
      if (key === 'v') {
        e.preventDefault();
        e.stopPropagation();
        pasteClipsAtPointer();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selected, isFullscreen, selectedClipIdSet, copySelectedClips, pasteClipsAtPointer]);


  const showPausedStillFrame =
    !isPlaying &&
    !!pausedFrameDataUrl &&
    !!activeVideoClip &&
    !!activeVideoSrc &&
    !playheadDragging &&
    !timelineScrubbing;

  /**
   * 裁剪编辑：展示未裁源占位（由 layout+crop 反推），暂不套 crop，便于对照调节保留区；
   * 播放/位置模式仍用 layout=裁切后占位 + crop。
   */
  const cropEditPreviewActive =
    previewTransformMode === 'crop' && !!layoutEditTarget && !isPlaying;

  const isCropEditTrack = useCallback(
    (trackIdx: number) =>
      !!(
        cropEditPreviewActive &&
        layoutEditTarget &&
        isVideoTrackRef(layoutEditTarget.track) &&
        videoTrackIndexFromRef(layoutEditTarget.track) === trackIdx
      ),
    [cropEditPreviewActive, layoutEditTarget],
  );

  const effectiveStackedPreviewLayouts = stackedPreviewLayouts.map((layout, trackIdx) => {
    if (!layout || !isCropEditTrack(trackIdx)) return layout;
    return sourceRectFromLayoutAndCrop(layout, stackedPreviewCrops[trackIdx]);
  });
  const effectiveStackedPreviewCrops = stackedPreviewCrops.map((crop, trackIdx) =>
    isCropEditTrack(trackIdx) ? null : crop,
  );

  const cropEditSourceLayout =
    cropEditPreviewActive && layoutEditTarget
      ? sourceRectFromLayoutAndCrop(layoutEditTarget.clip.layout, layoutEditTarget.clip.crop)
      : null;
  /**
   * 已有源裁切时，裁剪编辑用 fill 铺满反推的源占位，才能与琥珀保留框/遮罩共用坐标系；
   * 尚未裁切时保持 contain，与位置模式一致、避免切换跳变。
   */
  const cropEditNeedsFill =
    cropEditPreviewActive &&
    !!layoutEditTarget &&
    !isDefaultClipCrop(layoutEditTarget.clip.crop);
  const cropEditUncroppedFit = cropEditNeedsFill ? ('fill' as const) : undefined;
  const stackedUncroppedFitByTrack = videoTracks.map((_, trackIdx) => {
    if (!isCropEditTrack(trackIdx)) return null;
    return isDefaultClipCrop(stackedPreviewCrops[trackIdx]) ? null : ('fill' as const);
  });

  const timelinePreviewInner = useStackedVideoPreview ? (
    hasTimelineVisual ? (
      <TimelineStackedVideoPreview
        trackCount={videoTracks.length}
        layerRefs={videoLayerRefs}
        imageSrcs={stackedPreviewImageSrcs}
        layouts={effectiveStackedPreviewLayouts}
        crops={effectiveStackedPreviewCrops}
        uncroppedFitByTrack={stackedUncroppedFitByTrack}
        hasVideoLayer={stackedPreviewHasVideo}
        trackMuted={videoTrackMutedList}
        projectId={projectId}
      />
    ) : null
  ) : activeVideoClip && activeVideoSrc ? (
    showPausedStillFrame ? (
      <ClipMediaShell
        layout={cropEditSourceLayout ?? activeVideoClip.layout}
        crop={cropEditPreviewActive ? null : activeVideoClip.crop}
        uncroppedFit={cropEditUncroppedFit}
      >
        <img src={pausedFrameDataUrl!} alt="" />
      </ClipMediaShell>
    ) : (
      <TimelineDualVideoPreview
        slot0Ref={videoSlot0Ref}
        slot1Ref={videoSlot1Ref}
        visibleSlot={visibleVideoSlot}
        videoTrackMuted={videoTrackMuted}
        layout={cropEditSourceLayout ?? activeVideoClip.layout}
        crop={cropEditPreviewActive ? null : activeVideoClip.crop}
        uncroppedFit={cropEditUncroppedFit}
        onTimeUpdate={handleVideoTimeUpdate}
        onEnded={handlePreviewVideoEnded}
      />
    )
  ) : activeImageClip?.src ? (
    <PreviewImagePane
      src={activeImageClip.src}
      projectId={projectId}
      layout={cropEditSourceLayout ?? activeImageClip.layout}
      crop={cropEditPreviewActive ? null : activeImageClip.crop}
      uncroppedFit={cropEditUncroppedFit}
    />
  ) : null;

  const timelinePreviewPane = hasTimelineVisual ? (
    <div className="absolute inset-0 z-[1] overflow-hidden bg-transparent nexflow-splice-video-preview nodrag nopan">
      {timelinePreviewInner}
    </div>
  ) : null;

  const renderPreviewCanvasContent = (emptyIconSize: 'sm' | 'lg') => {
    const iconCls = emptyIconSize === 'lg' ? 'w-16 h-16' : 'w-12 h-12';
    const textCls = emptyIconSize === 'lg' ? 'text-base' : 'text-sm';
    if (timelinePreviewPane) return timelinePreviewPane;
    if (activeImageClip) {
      return (
        <ClipMediaShell
          layout={cropEditSourceLayout ?? activeImageClip.layout}
          crop={cropEditPreviewActive ? null : activeImageClip.crop}
          uncroppedFit={cropEditUncroppedFit}
        >
          <img src={activeImageClip.src} alt="" />
        </ClipMediaShell>
      );
    }
    if (isFullscreen) {
      return (
        <div className={`flex h-full min-h-[120px] flex-col items-center justify-center gap-2 ${textMuted}`}>
          <Film className={`${iconCls} opacity-50`} />
          <span className={textCls}>{vs.fullscreenEditing}</span>
        </div>
      );
    }
    return (
      <div className={`flex h-full min-h-[80px] flex-col items-center justify-center gap-2 ${textMuted}`}>
        <Film className={`${iconCls} opacity-50`} />
        <span className={textCls}>{vs.emptyAddClips}</span>
      </div>
    );
  };

  const renderAspectPreviewFrame = (
    variant: 'node' | 'fullscreen',
    canvasSize: { w: number; h: number },
  ) => {
    const badgeText = variant === 'fullscreen' ? 'text-xs' : 'text-[10px]';
    const badgePad = variant === 'fullscreen' ? 'px-2 py-0.5' : 'px-1.5 py-0.5';
    const showTransformOverlay = !!layoutEditTarget && !isPlaying;
    const cropEditActive = showTransformOverlay && previewTransformMode === 'crop';
    // 裁剪模式：预览显示未裁源画面 + 保留框；其它时候应用 crop
    return (
      <div
        data-splice-preview-frame
        className={`relative shrink-0 overflow-hidden shadow-[inset_0_0_0_1px_rgba(0,0,0,0.25)] ${splicePreviewCanvasBg(!!isDarkMode)}`}
        style={{
          width: canvasSize.w,
          height: canvasSize.h,
          transition: 'width 0.32s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {renderPreviewCanvasContent(variant === 'fullscreen' ? 'lg' : 'sm')}
        {showTransformOverlay && previewTransformMode === 'layout' ? (
          <ClipLayoutTransformOverlay
            layout={layoutEditTarget.clip.layout}
            onChange={updateSelectedClipLayout}
          />
        ) : null}
        {cropEditActive ? (
          <ClipCropTransformOverlay
            layout={layoutEditTarget.clip.layout}
            crop={layoutEditTarget.clip.crop}
            onChange={updateSelectedClipCrop}
          />
        ) : null}
        {showTransformOverlay ? (
          <div className={`nodrag nopan absolute bottom-1.5 left-1.5 z-[5] flex items-center gap-1`}>
            <div className={`flex overflow-hidden rounded-md border border-black/25 bg-black/60 ${badgeText}`}>
              <button
                type="button"
                className={`nodrag nopan ${badgePad} font-medium ${
                  previewTransformMode === 'layout' ? 'bg-sky-500/80 text-white' : 'text-white/75 hover:bg-white/10'
                }`}
                title={vs.transformModeLayoutTitle}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setPreviewTransformMode('layout');
                }}
              >
                {vs.transformModeLayout}
              </button>
              <button
                type="button"
                className={`nodrag nopan ${badgePad} font-medium ${
                  previewTransformMode === 'crop' ? 'bg-amber-500/80 text-white' : 'text-white/75 hover:bg-white/10'
                }`}
                title={vs.transformModeCropTitle}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setPreviewTransformMode('crop');
                }}
              >
                {vs.transformModeCrop}
              </button>
            </div>
            {previewTransformMode === 'layout' && !isDefaultClipLayout(layoutEditTarget.clip.layout) ? (
              <button
                type="button"
                className={`nodrag nopan rounded-md border border-black/20 bg-black/60 ${badgePad} font-medium text-white/90 ${badgeText} hover:bg-black/75`}
                title={vs.resetClipLayoutTitle}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  resetSelectedClipLayout();
                }}
              >
                {vs.resetClipLayout}
              </button>
            ) : null}
            {previewTransformMode === 'crop' && !isDefaultClipCrop(layoutEditTarget.clip.crop) ? (
              <button
                type="button"
                className={`nodrag nopan rounded-md border border-black/20 bg-black/60 ${badgePad} font-medium text-white/90 ${badgeText} hover:bg-black/75`}
                title={vs.resetClipCropTitle}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  resetSelectedClipCrop();
                }}
              >
                {vs.resetClipCrop}
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="pointer-events-none absolute inset-0 border border-black/20" aria-hidden />
        <div
          className={`pointer-events-none absolute top-1.5 right-1.5 z-[3] rounded-md border border-black/15 bg-black/55 ${badgePad} font-medium tracking-wide text-white/90 ${badgeText}`}
        >
          {previewAspectGroup.label}
          <span className="ml-1 text-white/45">
            {previewExportResolution[0]}×{previewExportResolution[1]}
          </span>
        </div>
      </div>
    );
  };

  const [workspaceHeaderBottom, setWorkspaceHeaderBottom] = useState(0);
  useLayoutEffect(() => {
    if (!isFullscreen) return;
    const measure = () => setWorkspaceHeaderBottom(measureWorkspaceHeaderBottom());
    measure();
    window.addEventListener('resize', measure);
    const headerEl = document.querySelector(WORKSPACE_HEADER_SELECTOR);
    const ro = headerEl ? new ResizeObserver(measure) : null;
    if (headerEl && ro) ro.observe(headerEl);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, [isFullscreen]);

  useLayoutEffect(() => {
    if (!useStackedVideoPreview) return;
    if (playheadDraggingRef.current || timelineScrubActiveRef.current || timelineScrubbing) return;
    syncVideoLayersToTimeRef.current(isPlaying ? playheadRef.current : currentTime);
  }, [useStackedVideoPreview, isPlaying, currentTime, clipLookupTime, stackedPreviewHasVideo.join(','), timelineScrubbing]);

  useEffect(() => {
    if (!isPlaying || useStackedVideoPreview) return;
    if (!activeVideoClip) return;
    const v = getActiveVideo();
    if (!v || !v.paused) return;
    // 片尾故意 pause，等 RAF 墙钟切下一段 — 勿立刻再 play（会与换片打架导致卡一下）
    const hint = resolveClipSourceHint(activeVideoClip);
    const te = effectiveClipTrimEnd(activeVideoClip, hint);
    if (Number.isFinite(te) && v.currentTime >= te - 0.08) return;
    const clipEnd = clipPlaybackEndSec(activeVideoClip, hint);
    if (clipEnd !== Number.POSITIVE_INFINITY && playheadRef.current >= clipEnd - 0.05) return;
    imperativePlayClip(activeVideoClip, playheadRef.current);
    applySlotVisibility(activeVideoSlotRef.current);
  }, [
    isPlaying,
    activeVideoClip?.id,
    activeVideoClip,
    imperativePlayClip,
    applySlotVisibility,
    getActiveVideo,
    resolveClipSourceHint,
    useStackedVideoPreview,
  ]);

  const buildExportPayload = useCallback((): VideoSpliceExportPayload => {
    // 多轨：上层 index 小覆盖下层；layout/crop/hasAlpha 随各轨 clips 传入主进程叠放合成。
    // 无 src 的未绑定片段保留轨位但导出侧会跳过；校验用「任意轨有可解析源」。
    // 导出前归一化 layout/crop，并纠正「type=video 实为静图」——避免非主轨图片 layout 在 IPC/ffmpeg 侧丢失或按错类型编码。
    /** 导出前写明 trim in/out，与轨道块显示时长一致，避免主进程用源文件全长回退 */
    const withExportTrim = (c: TimelineClip): TimelineClip => {
      const hint = resolveClipSourceHint(c);
      const ts = Math.max(0, c.trimStart ?? 0);
      const span = timelineClipDurationSec(c, hint);
      const te =
        c.trimEnd != null && c.trimEnd > ts + 0.01
          ? c.trimEnd
          : ts + Math.max(0.1, Number.isFinite(span) ? span : 0.1);
      return {
        ...c,
        trimStart: ts,
        trimEnd: te,
        // duration 保留为素材参考长；主进程切片只看 trim
        duration: Math.max(Number.isFinite(c.duration) ? c.duration : 0, te, hint || 0),
      };
    };
    const tracks = videoTracks.map((t) =>
      t
        .filter(
          (c) =>
            (c.type === 'video' || c.type === 'image' || clipIsImageMedia(c)) &&
            clipHasPlayableSrc(c),
        )
        .map((c) => {
          const asImage = clipIsImageMedia(c);
          const normalized = withExportTrim({
            ...c,
            type: asImage ? ('image' as const) : c.type,
            layout: normalizeClipLayout(c.layout),
            crop: normalizeClipCrop(c.crop),
          });
          return normalized;
        }),
    );
    const clips = tracks.flat();
    const exportAudioTracks = audioTracks.map((t) => t.filter((c) => clipHasPlayableSrc(c)).map(withExportTrim));
    const exportDims = resolveSpliceExportDimensions(data);
    return {
      videoTracks: tracks,
      clips,
      audioTracks: exportAudioTracks,
      previewAspectId: exportDims.aspectId,
      options: {
        videoTrackVolume: videoTrackVolumeList.map((v) => Math.min(2, (v ?? 1) * 2)),
        videoTrackMuted: videoTrackMutedList,
        audioTrackVolume: audioTrackVolume.map((v) => clampSpliceAudioVolume(v)),
        audioTrackMuted,
        outputWidth: exportDims.width,
        outputHeight: exportDims.height,
      },
    };
  }, [
    videoTracks,
    audioTracks,
    videoTrackVolumeList,
    videoTrackMutedList,
    audioTrackVolume,
    audioTrackMuted,
    data,
    resolveClipSourceHint,
  ]);

  const handlePreviewAspectSelect = useCallback(
    (aspectId: string) => {
      const aspectGroup = resolveSplicePreviewAspectGroup(aspectId);
      const [exportWidth, exportHeight] = resolveCollage1080pDefaultSize(aspectGroup);
      updateData({
        previewAspectId: aspectId,
        exportOutputWidth: exportWidth,
        exportOutputHeight: exportHeight,
      });
    },
    [updateData],
  );

  const handleSaveToComputer = useCallback(async () => {
    const payload = buildExportPayload();
    const { videoTracks: exportVideoTracks, clips: exportClips } = payload;
    const hasClips =
      exportVideoTracks.some((t) => t.some((c) => clipHasPlayableSrc(c))) ||
      exportClips.some((c) => clipHasPlayableSrc(c));
    const hasVideoWithAudio = exportVideoTracks.flat().some((c) => c.type === 'video');
    const hasAudioTracks = payload.audioTracks.some((t) => t.length > 0);
    if (!hasClips) {
      showAlert(vs.exportNoClips);
      return;
    }
    if (!window.electronAPI?.exportTimelineVideo) {
      showAlert(vs.exportUnavailable);
      return;
    }
    if (hasVideoWithAudio && videoTrackMutedList.every(Boolean) && !hasAudioTracks) {
      const ok = await showConfirm(vs.exportSilentConfirm);
      if (!ok) return;
    }
    setExportBusy('save');
    try {
      const res = await window.electronAPI.exportTimelineVideo(
        projectId,
        payload.videoTracks,
        payload.audioTracks,
        {
          videoTrackVolume: payload.options.videoTrackVolume,
          videoTrackMuted: payload.options.videoTrackMuted,
          audioTrackVolume: payload.options.audioTrackVolume,
          audioTrackMuted: payload.options.audioTrackMuted,
          outputWidth: payload.options.outputWidth,
          outputHeight: payload.options.outputHeight,
        },
      );
      if (res.success && res.videoPath) {
        await finishExportProgress();
        if (res.hasAudio === false) {
          showAlert(vs.exportOkSilent(res.videoPath));
        } else {
          showAlert(vs.exportOk(res.videoPath));
        }
      } else if (res.error !== '用户取消保存') {
        showAlert(vs.exportFailedMsg(res.error || ''));
      }
    } catch (e: any) {
      showAlert(vs.exportFailedMsg(e?.message || ''));
    } finally {
      setExportBusy(null);
    }
  }, [buildExportPayload, finishExportProgress, projectId, showAlert, showConfirm, vs]);

  const handleExportToCanvas = useCallback(async () => {
    const payload = buildExportPayload();
    const { videoTracks: exportVideoTracks, clips: exportClips } = payload;
    const hasClips =
      exportVideoTracks.some((t) => t.some((c) => clipHasPlayableSrc(c))) ||
      exportClips.some((c) => clipHasPlayableSrc(c));
    const hasVideoWithAudio = exportVideoTracks.flat().some((c) => c.type === 'video');
    const hasAudioTracks = payload.audioTracks.some((t) => t.length > 0);
    if (!hasClips) {
      showAlert(vs.exportNoClips);
      return;
    }
    if (!onExportToCanvas) {
      showAlert(vs.exportUnavailable);
      return;
    }
    if (hasVideoWithAudio && videoTrackMutedList.every(Boolean) && !hasAudioTracks) {
      const ok = await showConfirm(vs.exportSilentConfirm);
      if (!ok) return;
    }
    setExportBusy('canvas');
    try {
      const result = await onExportToCanvas(id, payload);
      await finishExportProgress();
      showAlert(result?.createdAudioNode ? vs.exportToCanvasDoneWithAudio : vs.exportToCanvasDone);
    } catch (e: any) {
      showAlert(vs.exportToCanvasFailed(e?.message || ''));
    } finally {
      setExportBusy(null);
    }
  }, [buildExportPayload, finishExportProgress, onExportToCanvas, id, showAlert, showConfirm, vs]);

  const handleAddMedia = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*,audio/*,image/*';
    input.multiple = true;
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files?.length) return;
      const nextVideoTracks = videoTracks.map((t) => t.map((c) => ({ ...c })));
      const nextAudioTracks = audioTracks.map((t) => t.map((c) => ({ ...c })));
      const nextVideoMuted = [...videoTrackMutedList];
      const nextVideoVol = [...videoTrackVolumeList];
      const nextVideoSnap = [...videoTrackLeftSnap];
      const nextAudioMuted = [...audioTrackMuted];
      const nextAudioVol = [...audioTrackVolume];
      const nextAudioSnap = [...audioTrackLeftSnap];
      const skipped: string[] = [];
      let added = false;
      for (let i = 0; i < files.length; i++) {
        const f = files[i] as File & { path?: string };
        const ingested = await ingestFileForTimeline(f, projectId);
        if (!ingested) {
          skipped.push(f.name || `#${i + 1}`);
          continue;
        }
        const { url: mappedUrl, kind } = ingested;
        const stamp = `${Date.now()}-${i}`;

        if (kind === 'video') {
          const dur = await loadVideoDuration(mappedUrl, projectId);
          const eff = Math.max(0.1, dur);
          nextVideoTracks.push([
            {
              id: `v-${stamp}`,
              type: 'video',
              src: mappedUrl,
              duration: eff,
              startTime: 0,
              name: f.name,
            },
          ]);
          nextVideoMuted.push(false);
          nextVideoVol.push(1);
          nextVideoSnap.push(true);
          added = true;
        } else if (kind === 'audio') {
          const dur = await loadAudioDuration(mappedUrl, projectId);
          const eff = Math.max(0.1, dur);
          nextAudioTracks.push([
            {
              id: `a-${stamp}`,
              type: 'audio',
              src: mappedUrl,
              duration: eff,
              startTime: 0,
              name: f.name,
            },
          ]);
          nextAudioMuted.push(false);
          nextAudioVol.push(1);
          nextAudioSnap.push(true);
          added = true;
        } else if (kind === 'image') {
          nextVideoTracks.push([
            {
              id: `img-${stamp}`,
              type: 'image',
              src: mappedUrl,
              duration: 3,
              startTime: 0,
              name: f.name,
            },
          ]);
          nextVideoMuted.push(false);
          nextVideoVol.push(1);
          nextVideoSnap.push(true);
          added = true;
        }
      }
      if (skipped.length > 0) {
        showAlert(vs.importMediaSkipped(skipped.join('、')));
      }
      if (added) {
        updateData({
          videoTracks: nextVideoTracks,
          videoClips: nextVideoTracks[0] ?? [],
          audioTracks: nextAudioTracks,
          videoTrackMutedList: nextVideoMuted,
          videoTrackVolumeList: nextVideoVol,
          videoTrackLeftSnapList: nextVideoSnap,
          audioTrackMuted: nextAudioMuted,
          audioTrackVolume: nextAudioVol,
          audioTrackLeftSnap: nextAudioSnap,
        });
      }
    };
    input.click();
  }, [
    videoTracks,
    audioTracks,
    videoTrackMutedList,
    videoTrackVolumeList,
    videoTrackLeftSnap,
    audioTrackMuted,
    audioTrackVolume,
    audioTrackLeftSnap,
    projectId,
    updateData,
    showAlert,
    vs,
  ]);

  /**
   * 暗色：不用 nexflow-glass-panel（backdrop-filter）。
   * 毛玻璃父级 + 预览多路 video(translateZ) 会在合成时拉出横向半透明伪影条。
   */
  const bg = isDarkMode
    ? 'bg-[rgba(14,14,18,0.97)] border border-[rgba(180,184,192,0.35)] shadow-[0_20px_50px_rgba(0,0,0,0.4)]'
    : 'bg-[#5CB1D6]';
  const text = 'text-white';
  const textMuted = isDarkMode ? 'text-white/60' : 'text-white/80';
  const spliceHeaderBar = isDarkMode ? 'border-white/10 bg-black/30' : 'bg-[#4A9BB8] border-white/25';
  const spliceTransportBar = isDarkMode ? 'border-white/10 bg-black/40' : 'border-white/25 bg-[#4A9BB8]';
  const spliceTimelineBg = isDarkMode ? 'bg-gray-950/80' : 'bg-[#3A8EAD]';
  const timelineRenderVideoTracks = dragLayoutPreview?.videoTracks ?? videoTracks;
  const timelineRenderAudioTracks = dragLayoutPreview?.audioTracks ?? audioTracks;

  const renderClipDragPlaceholder = (track: TimelineTrackRef, clips: TimelineClip[]) => {
    if (!draggingClip || draggingClip.track !== track || clipDragVisual == null) return null;
    const slot = clips.find((c) => c.id === draggingClip.clip.id);
    if (!slot) return null;
    const slotLeft = slot.startTime * pixelsPerSecond;
    const visualLeft = clipDragVisual.startTime * pixelsPerSecond;
    if (Math.abs(slotLeft - visualLeft) < 3) return null;
    const w = Math.max(24, timelineClipDurationSec(slot, resolveClipSourceHint(slot)) * pixelsPerSecond);
    return (
      <div
        key={`drag-slot-${draggingClip.clip.id}`}
        className="absolute top-1 bottom-1 rounded-lg border-2 border-dashed border-white/45 bg-white/10 pointer-events-none z-[14]"
        style={{
          left: slotLeft,
          width: w,
          minWidth: 24,
          transition: CLIP_DRAG_MOVE_TRANSITION,
          willChange: 'left',
        }}
        aria-hidden
      />
    );
  };

  const clipPointerLeftPx = (clipId: string, layoutLeft: number) => {
    if (!draggingClip || draggingClip.clip.id !== clipId || clipDragVisual == null) return undefined;
    return clipDragVisual.startTime * pixelsPerSecond;
  };
  const spliceTimelineScroller = `${spliceTimelineBg} splice-timeline-scrollbar-${isDarkMode ? 'dark' : 'light'}`;
  const spliceTimelineDivider = isDarkMode ? 'border-white/10' : 'border-white/25';
  /** 时间轴左侧轨道名/音量区：横向滚动时 sticky 固定（不含滚动条样式，避免每行出现多余滑块） */
  const spliceTimelineStickyAside = `${spliceTimelineBg} sticky left-0 z-30 box-border flex-shrink-0 flex items-center gap-1 px-2 border-r ${spliceTimelineDivider}`;
  /** 与登录/账户页一致的控件样式（暗黑模式） */
  const uiPrimaryBtn = 'nexflow-btn-primary nexflow-btn-primary-sm nodrag nopan inline-flex items-center gap-1.5';
  const uiSecondaryBtn = 'nexflow-btn-secondary nexflow-btn-secondary-sm nodrag nopan inline-flex items-center gap-1.5';
  const uiIconBtn = 'nexflow-btn-secondary nodrag nopan inline-flex items-center justify-center !p-0 !min-w-0 !h-8 !w-8';
  const uiIconBtnMd = 'nexflow-btn-secondary nodrag nopan inline-flex items-center justify-center !p-0 !min-w-0 !h-10 !w-10';
  const splicePillBtn = (scratch: ScratchColorId, extra = '') =>
    isDarkMode
      ? uiPrimaryBtn
      : `nexflow-btn-primary nexflow-btn-primary-sm nodrag nopan inline-flex items-center gap-1.5 ${scratchTintClass(scratch)} ${extra}`.trim();
  const spliceSecondaryPill = (scratch: ScratchColorId, extra = '') =>
    isDarkMode
      ? `${uiSecondaryBtn} ${extra}`.trim()
      : `nexflow-btn-secondary nexflow-btn-secondary-sm nodrag nopan inline-flex items-center gap-1.5 ${scratchTintClass(scratch)} ${extra}`.trim();
  const spliceIconBtn = (scratch: ScratchColorId, md = false, extra = '') => {
    if (isDarkMode) return `${md ? uiIconBtnMd : uiIconBtn} ${extra}`.trim();
    const size = md ? '!h-10 !w-10' : '!h-8 !w-8';
    return `nexflow-btn-secondary nodrag nopan inline-flex items-center justify-center !p-0 !min-w-0 ${size} ${scratchTintClass(scratch)} ${extra}`.trim();
  };
  const spliceMuteToggleBtn = (muted: boolean, md = false) => {
    const sz = md ? '!h-8 !w-8' : '!h-7 !w-7';
    if (isDarkMode) {
      return `rounded flex items-center justify-center nodrag nopan ${sz} ${
        muted ? 'bg-amber-500/30 text-amber-400' : 'hover:bg-white/10'
      }`;
    }
    return muted
      ? `rounded flex items-center justify-center nodrag nopan ${sz} scratch-float-btn ${scratchTintClass('events')} ring-2 ring-offset-1 ring-white/30`
      : `rounded flex items-center justify-center nodrag nopan ${sz} scratch-float-btn ${scratchTintClass('sound')}`;
  };
  const videoTrackDeletable = videoTracks.length > DEFAULT_VIDEO_TRACK_COUNT;
  const audioTrackDeletable = audioTracks.length > DEFAULT_AUDIO_TRACK_COUNT;
  const timelineRenderVideoSnap =
    dragLayoutPreview?.videoTrackLeftSnapList ?? videoTrackLeftSnap;
  const renderTrackLeftSnapButton = (md: boolean, track: TimelineTrackRef) => {
    const isVideo = isVideoTrackRef(track);
    const vIdx = isVideo ? videoTrackIndexFromRef(track) : -1;
    const active = isVideo
      ? timelineRenderVideoSnap[vIdx] !== false
      : audioTrackLeftSnap[track as number] !== false;
    const label = isVideo ? vs.videoTrackLabel(vIdx) : vs.audioTrackLabel(track as number);
    const onTitle = isVideo ? vs.videoTrackLeftSnapOnTitle : vs.audioTrackLeftSnapOnTitle(label);
    const offTitle = isVideo ? vs.videoTrackLeftSnapOffTitle : vs.audioTrackLeftSnapOffTitle(label);
    return (
      <TrackLeftSnapMenuButton
        md={md}
        active={active}
        onTitle={onTitle}
        offTitle={offTitle}
        onToggleSnap={() => {
          if (isVideo) handleToggleVideoTrackLeftSnap(vIdx);
          else handleToggleAudioTrackLeftSnap(track as number);
        }}
        isDarkMode={!!isDarkMode}
      />
    );
  };
  const renderTrackLabelMenu = (
    md: boolean,
    track: TimelineTrackRef,
    trackIdx: number,
    deletable: boolean,
    onRemove: () => void,
    icon: React.ReactNode,
  ) => {
    const isVideo = isVideoTrackRef(track);
    const label = isVideo ? vs.videoTrackLabel(trackIdx) : vs.audioTrackLabel(trackIdx);
    const removeTitle = isVideo ? vs.removeVideoTrackTitle(label) : vs.removeAudioTrackTitle(label);
    const removeLabel = isVideo ? vs.removeVideoTrack : vs.removeAudioTrack;
    return (
      <TrackLabelMenuButton
        md={md}
        icon={icon}
        label={label}
        deletable={deletable}
        removeLabel={removeLabel}
        removeTitle={removeTitle}
        onRemove={onRemove}
        isDarkMode={!!isDarkMode}
        textMutedClass={textMuted}
        labelWidth={md ? TIMELINE_TRACK_LABEL_PX_FS : TIMELINE_TRACK_LABEL_PX}
      />
    );
  };
  const spliceDeletePill = isDarkMode
    ? 'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium nodrag nopan bg-red-500/80 hover:bg-red-500 text-white'
    : `nodrag nopan inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium scratch-float-btn ${scratchTintClass('myBlocks')}`;
  const spliceTransportAddTrackBtn = (md: boolean, scratch: ScratchColorId) =>
    md
      ? `${uiSecondaryBtn} !text-xs !px-2 !py-1 gap-1 shrink-0`
      : spliceSecondaryPill(scratch, '!text-[10px] !px-1.5 !py-0.5 gap-1 shrink-0');
  const renderTransportAddTrackButtons = (md: boolean) => (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          handleAddVideoTrack();
        }}
        className={spliceTransportAddTrackBtn(md, 'operators')}
        title={vs.addVideoTrackTitle}
      >
        <Video className={md ? 'w-4 h-4 shrink-0' : 'w-3.5 h-3.5 shrink-0'} />
        <span className="whitespace-nowrap">{vs.addVideoTrack}</span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          handleAddAudioTrack();
        }}
        className={spliceTransportAddTrackBtn(md, 'sound')}
        title={vs.addAudioTrackTitle}
      >
        <Volume2 className={md ? 'w-4 h-4 shrink-0' : 'w-3.5 h-3.5 shrink-0'} />
        <span className="whitespace-nowrap">{vs.addAudioTrack}</span>
      </button>
    </>
  );
  const spliceCutIconBtn = (md: boolean) => {
    const base = spliceIconBtn('events', md);
    if (!cutMode) return base;
    return isDarkMode
      ? `${md ? uiIconBtnMd : uiIconBtn} !bg-amber-500/50 !text-amber-300 !border-amber-400/40`
      : `${spliceIconBtn('events', md)} ring-2 ring-offset-1 ring-white/40`;
  };
  const uiFilmIcon = isDarkMode ? SPLICE_UI_FILM_ICON : 'text-amber-200';
  const uiBoxSelect = SPLICE_UI_BOX_SELECT;
  const uiPlayhead = SPLICE_UI_PLAYHEAD;
  const playheadCutBtnClass = (md: boolean) =>
    isDarkMode
      ? `absolute nodrag nopan pointer-events-auto z-10 flex items-center justify-center rounded-full bg-amber-500 hover:bg-amber-400 text-gray-900 shadow-lg ring-2 ring-amber-300/50 ${md ? 'top-2 left-full ml-1.5 w-8 h-8' : 'top-0.5 left-full ml-1 w-7 h-7'}`
      : `absolute nodrag nopan pointer-events-auto z-10 flex items-center justify-center rounded-full bg-orange-500 hover:bg-orange-400 text-white shadow-lg ring-2 ring-white/50 ${md ? 'top-2 left-full ml-1.5 w-8 h-8' : 'top-0.5 left-full ml-1 w-7 h-7'}`;
  const uiVideoClipBg = spliceVideoClipBg(!!isDarkMode);
  const uiAudioClipBg = spliceAudioClipBg(!!isDarkMode);

  const handleTimelineWheel: React.WheelEventHandler = (e) => {
    const timelineEl = fullscreenTimelineRef.current || timelineRef.current;
    if (e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -15 : 15;
      const next = Math.max(PIXELS_PER_SECOND_MIN, Math.min(PIXELS_PER_SECOND_MAX, (data?.timelinePixelsPerSecond ?? PIXELS_PER_SECOND_DEFAULT) + delta));
      updateData({ timelinePixelsPerSecond: next });
      return;
    }
    if (timelineEl && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) {
      e.preventDefault();
      e.stopPropagation();
      setTimelineScrollLeft(timelineEl.scrollLeft + (e.shiftKey ? e.deltaY : e.deltaX));
    }
  };

  const nodeWidth = data?.width ?? scaleModulePx(800);
  const previewAspectId = data?.previewAspectId ?? DEFAULT_SPLICE_PREVIEW_ASPECT_ID;
  const spliceExportDims = useMemo(() => resolveSpliceExportDimensions(data), [data]);
  const previewAspectGroup = useMemo(
    () => resolveSplicePreviewAspectGroup(previewAspectId),
    [previewAspectId],
  );
  const previewExportResolution = useMemo(
    () => [spliceExportDims.width, spliceExportDims.height] as const,
    [spliceExportDims.width, spliceExportDims.height],
  );
  const previewHeightPx = Math.round(nodeWidth / SPLICE_PREVIEW_VIEWPORT_AR);
  const nodePreviewCanvasSize = useMemo(
    () =>
      computeSplicePreviewCanvasSize(
        nodeWidth,
        previewHeightPx,
        previewAspectGroup.rw,
        previewAspectGroup.rh,
      ),
    [nodeWidth, previewHeightPx, previewAspectGroup.rw, previewAspectGroup.rh],
  );
  const fullscreenPreviewCanvasSize = useMemo(
    () =>
      computeSplicePreviewCanvasSize(
        fullscreenPreviewViewport.w,
        fullscreenPreviewViewport.h,
        previewAspectGroup.rw,
        previewAspectGroup.rh,
      ),
    [
      fullscreenPreviewViewport.w,
      fullscreenPreviewViewport.h,
      previewAspectGroup.rw,
      previewAspectGroup.rh,
    ],
  );
  const timelineContentHeight =
    RULER_HEIGHT + videoTracks.length * TRACK_HEIGHT + audioTracks.length * TRACK_HEIGHT;
  const timelineContentHeightFs =
    RULER_HEIGHT_FULLSCREEN + videoTracks.length * TRACK_HEIGHT + audioTracks.length * TRACK_HEIGHT;
  const timelineBlockHeight = timelineContentHeight + SPLICE_TIMELINE_SCROLLBAR_LANE_PX;
  const compactNodeHeight =
    SPLICE_HEADER_PX + previewHeightPx + SPLICE_TRANSPORT_PX + timelineBlockHeight;

  // 旧版 minHeight / 过高的 data.height 会在时间轴下方留下空白
  useEffect(() => {
    if (data?.height == null || Math.abs(data.height - compactNodeHeight) > 12) {
      updateData({ height: compactNodeHeight });
    }
  }, [compactNodeHeight, data?.height, updateData]);

  useEffect(() => {
    if (!data?.previewAspectId || (data.exportOutputWidth && data.exportOutputHeight)) return;
    const g = resolveSplicePreviewAspectGroup(data.previewAspectId);
    const [w, h] = resolveCollage1080pDefaultSize(g);
    updateData({ exportOutputWidth: w, exportOutputHeight: h });
  }, [data?.previewAspectId, data?.exportOutputWidth, data?.exportOutputHeight, updateData]);

  /** 旧模型：layout=未裁源占位 + crop inset → 新模型：layout=裁切后占位 */
  useEffect(() => {
    if ((data?.clipGeometryModel ?? 0) >= 2) return;
    updateData((prev) => {
      if ((prev.clipGeometryModel ?? 0) >= 2) return {};
      const tracks = normalizeVideoTracks(prev as VideoSpliceNodeData);
      let changed = false;
      const nextTracks = tracks.map((track) =>
        track.map((c) => {
          if (c.type !== 'video' && c.type !== 'image') return c;
          if (isDefaultClipCrop(c.crop)) return c;
          // 旧数据把 layout 当源占位：套 crop 得到裁切后占位
          const layout = layoutFromSourceRectAndCrop(c.layout, c.crop);
          changed = true;
          return { ...c, layout };
        }),
      );
      return {
        clipGeometryModel: 2,
        ...(changed ? { videoTracks: nextTracks, videoClips: nextTracks[0] ?? [] } : {}),
      };
    });
  }, [data?.clipGeometryModel, updateData]);

  useLayoutEffect(() => {
    if (!isFullscreen) return;
    const el = fullscreenPreviewViewportRef.current;
    if (!el) return;
    const measure = () => {
      setFullscreenPreviewViewport({ w: el.clientWidth, h: el.clientHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isFullscreen]);

  const exportBusyLabel =
    exportBusy === 'save'
      ? vs.exportingToComputer
      : exportBusy === 'canvas'
        ? vs.exportingToCanvas
        : '';

  const renderExportProgressOverlay = (opts?: { fullscreen?: boolean }) => {
    if (!exportBusy) return null;
    const pct = Math.max(0, Math.min(100, exportProgress));
    return (
      <div
        className={`nodrag nopan absolute inset-0 z-[80] flex flex-col items-center justify-center gap-3 px-6 ${
          opts?.fullscreen ? 'bg-black/70' : 'bg-black/80'
        }`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <Loader2 className="w-7 h-7 animate-spin text-sky-300" />
        <div className="text-sm font-medium text-white/95 text-center">{exportBusyLabel}</div>
        <div className="w-full max-w-[280px]">
          <div className="h-2 rounded-full overflow-hidden bg-white/15 ring-1 ring-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400 transition-[width] duration-150 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1.5 text-center text-[11px] tabular-nums text-white/70">
            {vs.exportingProgress(pct)}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      ref={spliceOuterRef}
      data-id={id}
      className="custom-node-container nexflow-splice-node group relative rounded-xl overflow-visible"
      style={{
        width: nodeWidth,
        height: compactNodeHeight,
      }}
      onWheel={handleTimelineWheel}
    >
      {/* 磁吸「+」在节点外侧渲染，外层必须 overflow-visible（与 Image/Video 节点一致） */}
      <Handle type="target" position={Position.Left} id="input" style={{ top: '50%' }} className="nexflow-plus-handle nexflow-plus-handle-left" title={vs.inputHandleTitle} />
      <Handle type="source" position={Position.Right} id="output" style={{ top: '50%' }} className="nexflow-plus-handle nexflow-plus-handle-right" title={vs.outputHandleTitle} />
      <div
        className={`node-body absolute inset-0 rounded-xl overflow-hidden flex flex-col ${bg} ${!isDarkMode ? 'light-mode' : ''}`}
        onPointerDownCapture={activateSpliceEditing}
      >
      <div className={`flex items-center gap-2 px-3 py-2 border-b flex-shrink-0 drag-handle-area ${spliceHeaderBar}`}>
        <Film className={`w-4 h-4 ${uiFilmIcon}`} />
        <span className={`text-sm font-medium ${text}`}>{vs.title}</span>
        <div className="ml-auto flex items-center gap-2 nodrag nopan">
          <VideoSpliceAspectRatioDropdown
            selectedAspectId={previewAspectId}
            isDarkMode={isDarkMode}
            placement="down"
            onSelect={handlePreviewAspectSelect}
          />
          <button
            type="button"
            onClick={handleSaveToComputer}
            disabled={exportBusy != null}
            className={isDarkMode ? uiPrimaryBtn : splicePillBtn('operators')}
            title={vs.saveToComputerTitle}
          >
            {exportBusy === 'save' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            {exportBusy === 'save' ? vs.exportingProgress(exportProgress) : vs.saveToComputer}
          </button>
          <button
            type="button"
            onClick={() => void handleExportToCanvas()}
            disabled={exportBusy != null || !onExportToCanvas}
            className={isDarkMode ? uiSecondaryBtn : spliceSecondaryPill('motion')}
            title={vs.exportToCanvasTitle}
          >
            {exportBusy === 'canvas' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Video className="w-3.5 h-3.5" />
            )}
            {exportBusy === 'canvas' ? vs.exportingProgress(exportProgress) : vs.exportToCanvas}
          </button>
          <button
            type="button"
            onClick={() => setIsFullscreen(true)}
            className={spliceIconBtn('looks')}
            title={vs.fullscreenTitle}
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleAddMedia}
            className={isDarkMode ? uiSecondaryBtn : spliceSecondaryPill('control')}
          >
            <Plus className="w-3.5 h-3.5" />
            {vs.addMedia}
          </button>
        </div>
      </div>

      {/* 播放区：视口固定 16:9，内部灰色画布随导出比例变化 */}
      <div className="flex flex-col flex-shrink-0 w-full">
        <div
          ref={previewHostRef}
          className={`relative flex w-full shrink-0 items-center justify-center nopan overflow-hidden ${splicePreviewViewportBg(!!isDarkMode)}`}
          style={{
            height: previewHeightPx,
            width: '100%',
          }}
        >
          {renderExportProgressOverlay()}
          {!isFullscreen ? (
            <div className="relative flex h-full w-full items-center justify-center">
              {renderAspectPreviewFrame('node', nodePreviewCanvasSize)}
            </div>
          ) : (
            <div className={`flex flex-col items-center gap-2 ${textMuted}`}>
              <Film className="w-12 h-12 opacity-50" />
              <span className="text-sm">{vs.fullscreenEditing}</span>
            </div>
          )}
          {/* 隐藏的音频轨道元素，用于混音播放 */}
          {audioTracks.map((_, trackIdx) => (
            <audio
              key={trackIdx}
              ref={(el) => {
                audioRefsRef.current[trackIdx] = el;
              }}
              className="hidden"
              preload="metadata"
              onTimeUpdate={() => {
                if (!isPlaying) return;
                const el = audioRefsRef.current[trackIdx];
                if (!el) return;
                const te = (() => {
                  const clip = activeAudioClips[trackIdx];
                  if (!clip) return 0;
                  return effectiveClipTrimEnd(clip, resolveClipSourceHint(clip));
                })();
                if (Number.isFinite(te) && te > 0 && el.currentTime >= te - 0.04) el.pause();
              }}
            />
          ))}
        </div>
        {!isFullscreen && (
        <div
          className={`nodrag nopan flex items-center gap-2 px-2 py-1.5 flex-shrink-0 border-t ${spliceTransportBar} ${text} text-xs font-mono`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); handlePlayPause(); }}
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); handlePlayPause(); }}
            className={spliceIconBtn('operators')}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
          <button
            type="button"
            onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); setCurrentTime(firstContentStart === 0 ? 0.01 : firstContentStart); setIsPlaying(false); setPausedFrameDataUrl(null); }}
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); setCurrentTime(firstContentStart === 0 ? 0.01 : firstContentStart); setIsPlaying(false); setPausedFrameDataUrl(null); }}
            className={spliceIconBtn('motion')}
            title={vs.resetPlayheadTitle}
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              const next = Math.min(PIXELS_PER_SECOND_MAX, (data?.timelinePixelsPerSecond ?? PIXELS_PER_SECOND_DEFAULT) + 15);
              updateData({ timelinePixelsPerSecond: next });
            }}
            className={spliceIconBtn('sensing')}
            title={vs.zoomInTimelineTitle}
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              const next = Math.max(PIXELS_PER_SECOND_MIN, (data?.timelinePixelsPerSecond ?? PIXELS_PER_SECOND_DEFAULT) - 15);
              updateData({ timelinePixelsPerSecond: next });
            }}
            className={spliceIconBtn('variables')}
            title={vs.zoomOutTimelineTitle}
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          {renderTransportAddTrackButtons(false)}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              handleCutModeToggle();
            }}
            className={spliceCutIconBtn(false)}
            title={cutMode ? vs.cutModeOnTitle : vs.cutModeOffTitle}
          >
            <Scissors className="w-4 h-4" />
          </button>
          {(selectedClip || selectedClipIds.size > 0) && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleDeleteSelected(); }}
              className={spliceDeletePill}
              title={vs.deleteSelectedTitle}
            >
              <Trash2 className="w-3.5 h-3.5" />
              {vs.delete}
            </button>
          )}
          <span className={SPLICE_SELECTABLE_TEXT}>{formatTime(currentTime)}</span>
          <span className={textMuted}>/</span>
          <span className={SPLICE_SELECTABLE_TEXT}>{formatTime(totalDuration)}</span>
        </div>
        )}
      </div>

      {/* 时间轴：轨道区与底部滚动条分离，避免圆角裁切与交互时显示不全 */}
      <div className="flex flex-col flex-shrink-0 nodrag nopan" style={{ height: timelineBlockHeight }}>
      <div className="relative flex-shrink-0 nodrag nopan" style={{ height: timelineContentHeight }}>
      <div
        ref={isFullscreen ? undefined : timelineRef}
        className={`flex flex-col flex-shrink-0 overflow-x-auto overflow-y-hidden splice-timeline-content-scroll ${spliceTimelineBg}`}
        style={{ height: timelineContentHeight }}
        onScroll={handleTimelineContentScrollWithPlayhead}
        onPointerDown={handleTimelineSeekPointerDown}
        onPointerMove={handleClipDragMove}
        onPointerUp={handleTimelineSeekPointerUp}
        onPointerUpCapture={handleClipDragEnd}
        onPointerLeave={(e) => {
          if (playheadDragging || timelineScrubbing) return;
          if (draggingClip || boxSelectStart || pendingClipDrag) {
            handleClipDragEnd(e);
          }
        }}
      >
        {boxSelectStart && boxSelectEnd && !draggingClip && (
          <div
            className={`fixed pointer-events-none ${uiBoxSelect}`}
            style={{
              zIndex: WORKSPACE_CANVAS_OVERLAY_Z,
              left: Math.min(boxSelectStart.x, boxSelectEnd.x),
              top: Math.min(boxSelectStart.y, boxSelectEnd.y),
              width: Math.max(1, Math.abs(boxSelectEnd.x - boxSelectStart.x)),
              height: Math.max(1, Math.abs(boxSelectEnd.y - boxSelectStart.y)),
            }}
            aria-hidden
          />
        )}
        {/* 时间刻度尺：与轨道行左对齐，0 秒与片段起始位置无间隙；点击跳转刻度线 */}
        <div
          data-timeline-ruler
          className={`flex-shrink-0 h-7 flex items-end border-b cursor-pointer nodrag nopan ${spliceTimelineDivider}`}
          style={{ width: timelineRowWidthPx, minWidth: '100%' }}
          onPointerDown={handleRulerSeekPointerDown}
        >
          <div className={`${spliceTimelineStickyAside} self-stretch h-7`} style={{ width: timelineAsideWidthPx }} aria-hidden="true" />
          <div ref={rulerContentRef} className="relative shrink-0" style={{ width: timelineContentPx, height: RULER_HEIGHT }}>
            {Array.from({ length: Math.ceil(totalDuration / 5) + 1 }, (_, i) => i * 5).map((t) => (
              <div
                key={t}
                className={`absolute text-[10px] font-mono ${textMuted} ${SPLICE_SELECTABLE_TEXT}`}
                style={{ left: t * pixelsPerSecond, bottom: 2 }}
              >
                {formatTime(t)}
              </div>
            ))}
          </div>
        </div>

        {/* 视频轨道（上层 index 小，预览时覆盖下层） */}
        {timelineRenderVideoTracks.map((track, trackIdx) => {
          const trackRef = encodeVideoTrackRef(trackIdx);
          const asideW = spliceTimelineAsideWidthPx(TIMELINE_TRACK_LABEL_PX, TIMELINE_TRACK_CONTROLS_PX);
          const canDeleteVideoTrack = videoTrackDeletable && trackIdx >= DEFAULT_VIDEO_TRACK_COUNT;
          return (
            <div
              key={`video-track-${trackIdx}`}
              data-video-track={trackIdx}
              className={`flex-shrink-0 flex items-center border-b overflow-visible ${spliceTimelineDivider}`}
              style={{ height: TRACK_HEIGHT, width: timelineRowWidthPx, minWidth: '100%' }}
            >
              <div className={spliceTimelineStickyAside} style={{ height: TRACK_HEIGHT, width: asideW }}>
                {renderTrackLabelMenu(
                  false,
                  trackRef,
                  trackIdx,
                  canDeleteVideoTrack,
                  () => void handleRemoveVideoTrack(trackIdx),
                  <Video className="w-3.5 h-3.5 shrink-0" />,
                )}
                <div className="flex shrink-0 items-center gap-1">
                  <TrackHeaderVolumeSlider
                    md={false}
                    muted={!!videoTrackMutedList[trackIdx]}
                    volume01={videoTrackVolumeList[trackIdx] ?? 1}
                    muteTitle={vs.mute}
                    unmuteTitle={vs.unmute}
                    sliderTitle={vs.volumeSliderTitle}
                    muteBtnClass={spliceMuteToggleBtn(!!videoTrackMutedList[trackIdx])}
                    onToggleMute={() => handleToggleVideoTrackMute(trackIdx)}
                    onVolumeChange={(v) => handleVideoTrackVolumeChange(trackIdx, v)}
                  />
                  {renderTrackLeftSnapButton(false, trackRef)}
                </div>
              </div>
              <div
                ref={(el) => {
                  videoTrackContentRefs.current[trackIdx] = el;
                  if (trackIdx === 0) trackContentRef.current = el;
                }}
                className="relative shrink-0 h-full overflow-visible select-none"
                style={{ width: timelineContentPx }}
              >
                <div
                  className="absolute inset-0 z-0"
                  onPointerDown={handleBoxSelectStart}
                  style={{ pointerEvents: boxSelectStart ? 'none' : 'auto' }}
                  aria-hidden
                />
                {renderClipDragPlaceholder(trackRef, track)}
                {track.map((clip) => {
                  const dur = timelineClipDurationSec(clip, resolveClipSourceHint(clip));
                  const w = Math.max(24, dur * pixelsPerSecond);
                  const left = clip.startTime * pixelsPerSecond;
                  const isDraggingThis = draggingClip?.clip.id === clip.id;
                  const isSelected = !isDraggingThis && ((selectedClip?.clipId === clip.id && selectedClip?.track === trackRef) || selectedClipIds.has(clip.id));
                  return (
                    <div
                      key={clip.id}
                      draggable={false}
                      onPointerDown={(e) => handleClipDragStart(clip, trackRef, e)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedClip({ clipId: clip.id, track: trackRef });
                        setSelectedClipIds(new Set([clip.id]));
                      }}
                      data-clip
                      className={`absolute top-1 bottom-1 rounded-lg nodrag nopan select-none overflow-hidden cursor-grab active:cursor-grabbing group ${uiVideoClipBg} ${
                        isDraggingThis ? 'opacity-40' : ''
                      }`}
                      style={timelineClipDragStyle(left, w, isDraggingThis, !!draggingClip, clipPointerLeftPx(clip.id, left))}
                    >
                      <TimelineClipFilmstrip
                        clip={clip}
                        width={Math.max(24, w)}
                        projectId={projectId}
                        selected={isSelected || isDraggingThis}
                        durationSec={dur}
                        onTrimEdgePointerDown={(edge, e) => handleClipTrimEdgePointerDown(clip, trackRef, edge, e)}
                        trimEdgeTitle={vs.trimClipEdgeTitle}
                        overlayTopLeft={
                          <VolumeFaderHorizontal
                            value={(clip.volume ?? 1) * 100}
                            onChange={(v) => handleClipVolumeChange(clip.id, trackRef, v / 100)}
                            width={48}
                            height={10}
                            sliderTitle={vs.volumeSliderTitle}
                          />
                        }
                      />
                    </div>
                  );
                })}
                {trackIdx === 0 && snapLineTime != null && (
                  <div
                    className="absolute top-0 left-0 z-[19] pointer-events-none"
                    style={{
                      transform: `translateX(${snapLineTime * pixelsPerSecond - 2}px)`,
                      height: (videoTracks.length + audioTracks.length) * TRACK_HEIGHT,
                    }}
                  >
                    <div className="absolute left-0 -translate-x-px top-0 bottom-0 w-0.5 bg-blue-500 shadow-sm shadow-blue-500/50" />
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* 音频轨道 */}
        {timelineRenderAudioTracks.map((track, trackIdx) => (
          <div
            key={trackIdx}
            data-audio-track={trackIdx}
            className={`flex-shrink-0 flex items-center border-b ${spliceTimelineDivider}`}
            style={{ height: TRACK_HEIGHT, width: timelineRowWidthPx, minWidth: '100%' }}
          >
            <div className={spliceTimelineStickyAside} style={{ height: TRACK_HEIGHT, width: timelineAsideWidthPx }}>
              {renderTrackLabelMenu(
                false,
                trackIdx,
                trackIdx,
                audioTrackDeletable && trackIdx >= DEFAULT_AUDIO_TRACK_COUNT,
                () => void handleRemoveAudioTrack(trackIdx),
                <Volume2 className="w-3.5 h-3.5 shrink-0" />,
              )}
              <div className="flex shrink-0 items-center gap-1">
                <TrackHeaderVolumeSlider
                  md={false}
                  muted={!!audioTrackMuted[trackIdx]}
                  volume01={audioTrackVolume[trackIdx] ?? 1}
                  muteTitle={vs.mute}
                  unmuteTitle={vs.unmute}
                  sliderTitle={vs.audioVolumeSliderTitle}
                  muteBtnClass={spliceMuteToggleBtn(!!audioTrackMuted[trackIdx])}
                  onToggleMute={() => handleToggleAudioTrackMute(trackIdx)}
                  onVolumeChange={(v) => handleAudioTrackVolumeChange(trackIdx, v)}
                  volumeMax={SPLICE_AUDIO_VOLUME_MAX}
                  sliderMaxPct={SPLICE_AUDIO_VOLUME_SLIDER_PCT_MAX}
                />
                {renderTrackLeftSnapButton(false, trackIdx)}
              </div>
            </div>
            <div
              ref={(el) => {
                audioTrackContentRefs.current[trackIdx] = el;
              }}
              className="relative shrink-0 h-full overflow-visible select-none"
              style={{ width: timelineContentPx }}
            >
              <div
                className="absolute inset-0 z-0"
                onPointerDown={handleBoxSelectStart}
                style={{ pointerEvents: boxSelectStart ? 'none' : 'auto' }}
                aria-hidden
              />
              {renderClipDragPlaceholder(trackIdx, track)}
              {track.map((clip) => {
                const dur = timelineClipDurationSec(clip, resolveClipSourceHint(clip));
                const w = Math.max(24, dur * pixelsPerSecond);
                const left = clip.startTime * pixelsPerSecond;
                const isDraggingThis = draggingClip?.clip.id === clip.id;
                const isSelected = !isDraggingThis && ((selectedClip?.clipId === clip.id && selectedClip?.track === trackIdx) || selectedClipIds.has(clip.id));
                return (
                  <div
                    key={clip.id}
                    draggable={false}
                    onPointerDown={(e) => handleClipDragStart(clip, trackIdx, e)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedClip({ clipId: clip.id, track: trackIdx });
                      setSelectedClipIds(new Set([clip.id]));
                    }}
                    data-clip
                    className={`absolute top-1 bottom-1 rounded-lg nodrag nopan select-none flex flex-col overflow-hidden cursor-grab active:cursor-grabbing group ${uiAudioClipBg} ${
                      isSelected || isDraggingThis ? 'ring-2 ring-amber-400' : ''
                    }`}
                    style={timelineClipDragStyle(left, w, isDraggingThis, !!draggingClip, clipPointerLeftPx(clip.id, left))}
                  >
                    <div className="flex items-center justify-start gap-1 px-1.5 py-0.5 shrink-0 border-b border-white/10">
                      <span className={`text-[9px] truncate text-white/90 ${isSelected || isDraggingThis ? 'bg-amber-500/50' : 'bg-black/40'} px-1 rounded shrink-0 ${SPLICE_SELECTABLE_TEXT}`}>
                        {clip.name || vs.clipNameAudio}
                      </span>
                      <div className="shrink-0 flex items-center" onClick={(e) => e.stopPropagation()}>
                        <VolumeFaderHorizontal
                          value={((clip.volume ?? 1) / SPLICE_AUDIO_VOLUME_MAX) * SPLICE_AUDIO_VOLUME_SLIDER_PCT_MAX}
                          onChange={(v) =>
                            handleClipVolumeChange(clip.id, trackIdx, (v / SPLICE_AUDIO_VOLUME_SLIDER_PCT_MAX) * SPLICE_AUDIO_VOLUME_MAX)
                          }
                          width={48}
                          height={10}
                          sliderTitle={vs.audioVolumeSliderTitle}
                          maxValue={SPLICE_AUDIO_VOLUME_SLIDER_PCT_MAX}
                        />
                      </div>
                    </div>
                    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                      <AudioWaveformBars clip={clip} width={Math.max(24, w - 12)} projectId={projectId} isDarkMode={!!isDarkMode} />
                    </div>
                    <div
                      className="absolute inset-y-0 left-0 z-20 w-3.5 cursor-ew-resize nodrag nopan"
                      title={vs.trimClipEdgeTitle}
                      aria-label={vs.trimClipEdgeTitle}
                      onPointerDown={(e) => handleClipTrimEdgePointerDown(clip, trackIdx, 'start', e)}
                    >
                      <div
                        className={`pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-l bg-white/90 transition-opacity ${
                          isSelected || isDraggingThis ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`}
                      />
                    </div>
                    <div
                      className="absolute inset-y-0 right-0 z-20 w-3.5 cursor-ew-resize nodrag nopan"
                      title={vs.trimClipEdgeTitle}
                      aria-label={vs.trimClipEdgeTitle}
                      onPointerDown={(e) => handleClipTrimEdgePointerDown(clip, trackIdx, 'end', e)}
                    >
                      <div
                        className={`pointer-events-none absolute inset-y-0 right-0 w-1.5 rounded-r bg-white/90 transition-opacity ${
                          isSelected || isDraggingThis ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

      </div>
        {/* 播放头 overlay：在 overflow 滚动区外，避免横向滚动后刻度线被裁切 */}
        <div
          ref={playheadLayerRef}
          className="absolute inset-0 z-[22] overflow-visible pointer-events-none"
        >
          <div
            ref={playheadElRef}
            className="absolute top-0 left-0 h-full will-change-transform"
            style={{ width: 0 }}
            aria-hidden
          >
            <div
              className="absolute top-0 cursor-ew-resize nodrag nopan pointer-events-auto group"
              style={{ width: PLAYHEAD_HIT_PX, height: '100%', marginLeft: -PLAYHEAD_HIT_PX / 2 }}
              data-playhead
              onPointerDown={handlePlayheadPointerDown}
            >
              <div
                className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 ${uiPlayhead}`}
                style={{ width: PLAYHEAD_LINE_PX }}
              />
              {cutMode && (
                <button
                  type="button"
                  data-cut-action
                  className={playheadCutBtnClass(false)}
                  title={vs.cutAtPlayheadTitle}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                  onClick={handleCutAtPlayhead}
                >
                  <Scissors className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {!isFullscreen && (
        <div
          className="flex-shrink-0 box-border nodrag nopan"
          style={{
            height: SPLICE_TIMELINE_SCROLLBAR_LANE_PX,
            paddingBottom: SPLICE_TIMELINE_SCROLLBAR_PAD_PX,
          }}
        >
          <div
            ref={timelineScrollbarRef}
            className={`h-full overflow-x-scroll overflow-y-hidden ${spliceTimelineScroller}`}
            style={{ height: SPLICE_TIMELINE_SCROLLBAR_THUMB_PX, width: '100%' }}
            onScroll={handleTimelineScrollbarScrollWithPlayhead}
            onPointerDown={handleTimelineScrollbarPointerDown}
            onPointerUp={handleTimelineScrollbarPointerUp}
            onPointerCancel={handleTimelineScrollbarPointerUp}
          >
            <div className="shrink-0" style={{ width: timelineRowWidthPx, height: 1 }} aria-hidden />
          </div>
        </div>
      )}
      </div>
      </div>

      {/* 全屏模式 */}
      {isFullscreen &&
        createPortal(
          <div
            className={`fixed left-0 right-0 bottom-0 z-[10000] flex flex-col ${isDarkMode ? 'bg-gray-950' : 'light-mode bg-[#5CB1D6]'}`}
            style={{ top: workspaceHeaderBottom }}
            onClick={(e) => e.target === e.currentTarget && setIsFullscreen(false)}
          >
            <div className="flex-1 flex flex-col min-h-0 relative" onClick={(e) => e.stopPropagation()}>
              {renderExportProgressOverlay({ fullscreen: true })}
              <div className={`flex items-center justify-between px-4 py-3 border-b shrink-0 ${isDarkMode ? 'border-white/10' : 'bg-[#4A9BB8] border-white/25'}`}>
                <div className="flex items-center gap-2">
                  <Film className={`w-5 h-5 ${uiFilmIcon}`} />
                  <span className={`text-base font-medium ${text}`}>{vs.title}</span>
                </div>
                <div className="flex items-center gap-2">
                  <VideoSpliceAspectRatioDropdown
                    selectedAspectId={previewAspectId}
                    isDarkMode={isDarkMode}
                    md
                    placement="down"
                    onSelect={handlePreviewAspectSelect}
                  />
                  <button
                    type="button"
                    onClick={handleSaveToComputer}
                    disabled={exportBusy != null}
                    className={isDarkMode ? `${uiPrimaryBtn} !text-sm !px-3 !py-1.5` : `${splicePillBtn('operators')} !text-sm !px-3 !py-1.5`}
                    title={vs.saveToComputerTitle}
                  >
                    {exportBusy === 'save' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    {exportBusy === 'save' ? vs.exportingProgress(exportProgress) : vs.saveToComputer}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleExportToCanvas()}
                    disabled={exportBusy != null || !onExportToCanvas}
                    className={isDarkMode ? `${uiSecondaryBtn} !text-sm !px-3 !py-1.5` : `${spliceSecondaryPill('motion')} !text-sm !px-3 !py-1.5`}
                    title={vs.exportToCanvasTitle}
                  >
                    {exportBusy === 'canvas' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Video className="w-4 h-4" />
                    )}
                    {exportBusy === 'canvas' ? vs.exportingProgress(exportProgress) : vs.exportToCanvas}
                  </button>
                  <button
                    type="button"
                    onClick={handleAddMedia}
                    className={isDarkMode ? `${uiSecondaryBtn} !text-sm !px-3 !py-1.5` : `${spliceSecondaryPill('control')} !text-sm !px-3 !py-1.5`}
                  >
                    <Plus className="w-4 h-4" />
                    {vs.addMedia}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsFullscreen(false)}
                    className={spliceIconBtn('looks', true)}
                    title={vs.exitFullscreenTitle}
                  >
                    <Minimize2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                {/* 全屏播放区：视口居中，内部灰色画布随导出比例变化 */}
                <div
                  ref={fullscreenPreviewViewportRef}
                  className={`relative flex flex-1 min-h-0 items-center justify-center p-3 ${splicePreviewViewportBg(!!isDarkMode)}`}
                >
                  <div className="flex h-full w-full items-center justify-center">
                    {renderAspectPreviewFrame('fullscreen', fullscreenPreviewCanvasSize)}
                  </div>
                  <div
                    className="absolute bottom-4 left-4 right-4 flex items-center gap-3 z-[100] text-white text-sm font-mono"
                    style={{ pointerEvents: 'auto' }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); handlePlayPause(); }}
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); handlePlayPause(); }}
                      className={spliceIconBtn('operators', true)}
                    >
                      {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
                    </button>
                    <button
                      type="button"
                      onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); setCurrentTime(firstContentStart === 0 ? 0.01 : firstContentStart); setIsPlaying(false); setPausedFrameDataUrl(null); }}
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); setCurrentTime(firstContentStart === 0 ? 0.01 : firstContentStart); setIsPlaying(false); setPausedFrameDataUrl(null); }}
                      className={spliceIconBtn('motion', true)}
                      title={vs.resetPlayheadTitle}
                    >
                      <RotateCcw className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const next = Math.min(PIXELS_PER_SECOND_MAX, (data?.timelinePixelsPerSecond ?? PIXELS_PER_SECOND_DEFAULT) + 15);
                        updateData({ timelinePixelsPerSecond: next });
                      }}
                      className={spliceIconBtn('sensing', true)}
                      title={vs.zoomInTimelineTitle}
                    >
                      <ZoomIn className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const next = Math.max(PIXELS_PER_SECOND_MIN, (data?.timelinePixelsPerSecond ?? PIXELS_PER_SECOND_DEFAULT) - 15);
                        updateData({ timelinePixelsPerSecond: next });
                      }}
                      className={spliceIconBtn('variables', true)}
                      title={vs.zoomOutTimelineTitle}
                    >
                      <ZoomOut className="w-5 h-5" />
                    </button>
                    {renderTransportAddTrackButtons(true)}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        handleCutModeToggle();
                      }}
                      className={spliceCutIconBtn(true)}
                      title={cutMode ? vs.cutModeOnTitle : vs.cutModeOffTitle}
                    >
                      <Scissors className="w-5 h-5" />
                    </button>
                    {(selectedClip || selectedClipIds.size > 0) && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleDeleteSelected(); }}
                        className={isDarkMode ? 'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-500/80 hover:bg-red-500 text-white' : `nodrag nopan inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium scratch-float-btn ${scratchTintClass('myBlocks')}`}
                        title={vs.deleteSelectedTitle}
                      >
                        <Trash2 className="w-4 h-4" />
                        {vs.delete}
                      </button>
                    )}
                    <span className={SPLICE_SELECTABLE_TEXT}>{formatTime(currentTime)}</span>
                    <span className="text-white/60">/</span>
                    <span className={SPLICE_SELECTABLE_TEXT}>{formatTime(totalDuration)}</span>
                  </div>
                </div>
                {/* 全屏时间轴 */}
                <div
                  className="flex flex-col shrink-0 nodrag nopan"
                  style={{
                    maxHeight: '40vh',
                    minHeight: timelineContentHeightFs + SPLICE_TIMELINE_SCROLLBAR_LANE_PX,
                  }}
                >
                <div className="relative flex-shrink-0 nodrag nopan" style={{ height: timelineContentHeightFs }}>
                <div
                  ref={fullscreenTimelineRef}
                  className={`flex flex-col flex-shrink-0 overflow-x-auto overflow-y-hidden splice-timeline-content-scroll ${spliceTimelineBg}`}
                  style={{ height: timelineContentHeightFs }}
                  onScroll={handleTimelineContentScrollWithPlayhead}
                  onPointerDown={handleTimelineSeekPointerDown}
                  onPointerMove={handleClipDragMove}
                  onPointerUp={handleTimelineSeekPointerUp}
                  onPointerUpCapture={handleClipDragEnd}
                  onPointerLeave={(e) => {
                    if (playheadDragging || timelineScrubbing) return;
                    if (draggingClip || boxSelectStart || pendingClipDrag) {
                      handleClipDragEnd(e);
                    }
                  }}
                  onWheel={handleTimelineWheel}
                >
                  {boxSelectStart && boxSelectEnd && !draggingClip && (
                    <div
                      className={`fixed z-[10001] pointer-events-none ${uiBoxSelect}`}
                      style={{
                        left: Math.min(boxSelectStart.x, boxSelectEnd.x),
                        top: Math.min(boxSelectStart.y, boxSelectEnd.y),
                        width: Math.max(1, Math.abs(boxSelectEnd.x - boxSelectStart.x)),
                        height: Math.max(1, Math.abs(boxSelectEnd.y - boxSelectStart.y)),
                      }}
                      aria-hidden
                    />
                  )}
                  <div
                    data-timeline-ruler
                    className={`flex-shrink-0 h-8 flex items-end border-b cursor-pointer nodrag nopan ${spliceTimelineDivider}`}
                    style={{ width: timelineRowWidthPxFs, minWidth: '100%' }}
                    onPointerDown={handleRulerSeekPointerDown}
                  >
                    <div className={`${spliceTimelineStickyAside} self-stretch h-8`} style={{ width: timelineAsideWidthPxFs }} aria-hidden="true" />
                    <div ref={fullscreenRulerContentRef} className="relative shrink-0" style={{ width: timelineContentPx, height: RULER_HEIGHT_FULLSCREEN }}>
                      {Array.from({ length: Math.ceil(totalDuration / 5) + 1 }, (_, i) => i * 5).map((t) => (
                        <div
                          key={t}
                          className={`absolute text-xs font-mono ${textMuted} ${SPLICE_SELECTABLE_TEXT}`}
                          style={{ left: t * pixelsPerSecond, bottom: 2 }}
                        >
                          {formatTime(t)}
                        </div>
                      ))}
                    </div>
                  </div>
                  {timelineRenderVideoTracks.map((track, trackIdx) => {
                    const trackRef = encodeVideoTrackRef(trackIdx);
                    const asideFs = spliceTimelineAsideWidthPx(TIMELINE_TRACK_LABEL_PX_FS, TIMELINE_TRACK_CONTROLS_PX_FS);
                    const canDeleteVideoTrack = videoTrackDeletable && trackIdx >= DEFAULT_VIDEO_TRACK_COUNT;
                    return (
                      <div
                        key={`fs-video-track-${trackIdx}`}
                        data-video-track={trackIdx}
                        className={`flex-shrink-0 flex items-center border-b overflow-visible ${spliceTimelineDivider}`}
                        style={{ height: TRACK_HEIGHT, width: timelineRowWidthPxFs, minWidth: '100%' }}
                      >
                        <div className={spliceTimelineStickyAside} style={{ height: TRACK_HEIGHT, width: asideFs }}>
                          {renderTrackLabelMenu(
                            true,
                            trackRef,
                            trackIdx,
                            canDeleteVideoTrack,
                            () => void handleRemoveVideoTrack(trackIdx),
                            <Video className="w-4 h-4 shrink-0" />,
                          )}
                          <div className="flex shrink-0 items-center gap-1">
                            <TrackHeaderVolumeSlider
                              md
                              muted={!!videoTrackMutedList[trackIdx]}
                              volume01={videoTrackVolumeList[trackIdx] ?? 1}
                              muteTitle={vs.mute}
                              unmuteTitle={vs.unmute}
                              sliderTitle={vs.volumeSliderTitle}
                              muteBtnClass={spliceMuteToggleBtn(!!videoTrackMutedList[trackIdx], true)}
                              onToggleMute={() => handleToggleVideoTrackMute(trackIdx)}
                              onVolumeChange={(v) => handleVideoTrackVolumeChange(trackIdx, v)}
                            />
                            {renderTrackLeftSnapButton(true, trackRef)}
                          </div>
                        </div>
                        <div
                          ref={(el) => {
                            fullscreenVideoTrackContentRefs.current[trackIdx] = el;
                            if (trackIdx === 0) fullscreenTrackContentRef.current = el;
                          }}
                          className="relative shrink-0 h-full overflow-visible select-none"
                          style={{ width: timelineContentPx }}
                        >
                          <div
                            className="absolute inset-0 z-0"
                            onPointerDown={handleBoxSelectStart}
                            style={{ pointerEvents: boxSelectStart ? 'none' : 'auto' }}
                            aria-hidden
                          />
                          {renderClipDragPlaceholder(trackRef, track)}
                          {track.map((clip) => {
                            const dur = timelineClipDurationSec(clip, resolveClipSourceHint(clip));
                            const w = Math.max(24, dur * pixelsPerSecond);
                            const left = clip.startTime * pixelsPerSecond;
                            const isDraggingThis = draggingClip?.clip.id === clip.id;
                            const isSelected = !isDraggingThis && ((selectedClip?.clipId === clip.id && selectedClip?.track === trackRef) || selectedClipIds.has(clip.id));
                            return (
                              <div
                                key={clip.id}
                                draggable={false}
                                onPointerDown={(e) => handleClipDragStart(clip, trackRef, e)}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedClip({ clipId: clip.id, track: trackRef });
                                  setSelectedClipIds(new Set([clip.id]));
                                }}
                                data-clip
                                className={`absolute top-1 bottom-1 rounded-lg nodrag nopan select-none overflow-hidden cursor-grab active:cursor-grabbing group ${uiVideoClipBg} ${
                                  isDraggingThis ? 'opacity-40' : ''
                                }`}
                                style={timelineClipDragStyle(left, w, isDraggingThis, !!draggingClip, clipPointerLeftPx(clip.id, left))}
                              >
                                <TimelineClipFilmstrip
                                  clip={clip}
                                  width={Math.max(24, w)}
                                  projectId={projectId}
                                  selected={isSelected || isDraggingThis}
                                  durationSec={dur}
                                  onTrimEdgePointerDown={(edge, e) => handleClipTrimEdgePointerDown(clip, trackRef, edge, e)}
                                  trimEdgeTitle={vs.trimClipEdgeTitle}
                                  overlayTopLeft={
                                    <VolumeFaderHorizontal
                                      value={(clip.volume ?? 1) * 100}
                                      onChange={(v) => handleClipVolumeChange(clip.id, trackRef, v / 100)}
                                      width={48}
                                      height={10}
                                      sliderTitle={vs.volumeSliderTitle}
                                    />
                                  }
                                />
                              </div>
                            );
                          })}
                          {trackIdx === 0 && snapLineTime != null && (
                            <div
                              className="absolute top-0 left-0 z-[19] pointer-events-none"
                              style={{
                                transform: `translateX(${snapLineTime * pixelsPerSecond - 2}px)`,
                                height: (videoTracks.length + audioTracks.length) * TRACK_HEIGHT,
                              }}
                            >
                              <div className="absolute left-0 -translate-x-px top-0 bottom-0 w-0.5 bg-blue-500 shadow-sm shadow-blue-500/50" />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {timelineRenderAudioTracks.map((track, trackIdx) => (
                    <div
                      key={trackIdx}
                      data-audio-track={trackIdx}
                      className={`flex-shrink-0 flex items-center border-b ${spliceTimelineDivider}`}
                      style={{ height: TRACK_HEIGHT, width: timelineRowWidthPxFs, minWidth: '100%' }}
                    >
                      <div className={spliceTimelineStickyAside} style={{ height: TRACK_HEIGHT, width: timelineAsideWidthPxFs }}>
                        {renderTrackLabelMenu(
                          true,
                          trackIdx,
                          trackIdx,
                          audioTrackDeletable && trackIdx >= DEFAULT_AUDIO_TRACK_COUNT,
                          () => void handleRemoveAudioTrack(trackIdx),
                          <Volume2 className="w-4 h-4 shrink-0" />,
                        )}
                        <div className="flex shrink-0 items-center gap-1">
                          <TrackHeaderVolumeSlider
                            md
                            muted={!!audioTrackMuted[trackIdx]}
                            volume01={audioTrackVolume[trackIdx] ?? 1}
                            muteTitle={vs.mute}
                            unmuteTitle={vs.unmute}
                            sliderTitle={vs.audioVolumeSliderTitle}
                            muteBtnClass={spliceMuteToggleBtn(!!audioTrackMuted[trackIdx], true)}
                            onToggleMute={() => handleToggleAudioTrackMute(trackIdx)}
                            onVolumeChange={(v) => handleAudioTrackVolumeChange(trackIdx, v)}
                            volumeMax={SPLICE_AUDIO_VOLUME_MAX}
                            sliderMaxPct={SPLICE_AUDIO_VOLUME_SLIDER_PCT_MAX}
                          />
                          {renderTrackLeftSnapButton(true, trackIdx)}
                        </div>
                      </div>
                      <div
                        ref={(el) => {
                          fullscreenAudioTrackContentRefs.current[trackIdx] = el;
                        }}
                        className="relative shrink-0 h-full overflow-visible select-none"
                        style={{ width: timelineContentPx }}
                      >
                        <div
                          className="absolute inset-0 z-0"
                          onPointerDown={handleBoxSelectStart}
                          style={{ pointerEvents: boxSelectStart ? 'none' : 'auto' }}
                          aria-hidden
                        />
                        {renderClipDragPlaceholder(trackIdx, track)}
                        {track.map((clip) => {
                          const dur = timelineClipDurationSec(clip, resolveClipSourceHint(clip));
                          const w = Math.max(24, dur * pixelsPerSecond);
                          const left = clip.startTime * pixelsPerSecond;
                          const isDraggingThis = draggingClip?.clip.id === clip.id;
                          const isSelected = !isDraggingThis && ((selectedClip?.clipId === clip.id && selectedClip?.track === trackIdx) || selectedClipIds.has(clip.id));
                          return (
                            <div
                              key={clip.id}
                              draggable={false}
                              onPointerDown={(e) => handleClipDragStart(clip, trackIdx, e)}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedClip({ clipId: clip.id, track: trackIdx });
                                setSelectedClipIds(new Set([clip.id]));
                              }}
                              data-clip
                                className={`absolute top-1 bottom-1 rounded-lg nodrag nopan select-none flex flex-col overflow-hidden cursor-grab active:cursor-grabbing group ${uiAudioClipBg} ${isSelected || isDraggingThis ? 'ring-2 ring-amber-400' : ''}`}
                              style={timelineClipDragStyle(left, w, isDraggingThis, !!draggingClip, clipPointerLeftPx(clip.id, left))}
                            >
                              <div className="flex items-center justify-start gap-1 px-1.5 py-0.5 shrink-0 border-b border-white/10">
                                <span className={`text-[9px] truncate text-white/90 ${isSelected || isDraggingThis ? 'bg-amber-500/50' : 'bg-black/40'} px-1 rounded shrink-0 ${SPLICE_SELECTABLE_TEXT}`}>
                                  {clip.name || vs.clipNameAudio}
                                </span>
                                <div className="shrink-0 flex items-center" onClick={(e) => e.stopPropagation()}>
                                  <VolumeFaderHorizontal
                                    value={((clip.volume ?? 1) / SPLICE_AUDIO_VOLUME_MAX) * SPLICE_AUDIO_VOLUME_SLIDER_PCT_MAX}
                                    onChange={(v) =>
                                      handleClipVolumeChange(
                                        clip.id,
                                        trackIdx,
                                        (v / SPLICE_AUDIO_VOLUME_SLIDER_PCT_MAX) * SPLICE_AUDIO_VOLUME_MAX,
                                      )
                                    }
                                    width={48}
                                    height={10}
                                    sliderTitle={vs.audioVolumeSliderTitle}
                                    maxValue={SPLICE_AUDIO_VOLUME_SLIDER_PCT_MAX}
                                  />
                                </div>
                              </div>
                              <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                                <AudioWaveformBars clip={clip} width={Math.max(24, w - 12)} projectId={projectId} isDarkMode />
                              </div>
                              <div
                                className="absolute inset-y-0 left-0 z-20 w-3.5 cursor-ew-resize nodrag nopan"
                                title={vs.trimClipEdgeTitle}
                                aria-label={vs.trimClipEdgeTitle}
                                onPointerDown={(e) => handleClipTrimEdgePointerDown(clip, trackIdx, 'start', e)}
                              >
                                <div
                                  className={`pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-l bg-white/90 transition-opacity ${
                                    isSelected || isDraggingThis ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                  }`}
                                />
                              </div>
                              <div
                                className="absolute inset-y-0 right-0 z-20 w-3.5 cursor-ew-resize nodrag nopan"
                                title={vs.trimClipEdgeTitle}
                                aria-label={vs.trimClipEdgeTitle}
                                onPointerDown={(e) => handleClipTrimEdgePointerDown(clip, trackIdx, 'end', e)}
                              >
                                <div
                                  className={`pointer-events-none absolute inset-y-0 right-0 w-1.5 rounded-r bg-white/90 transition-opacity ${
                                    isSelected || isDraggingThis ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                  }`}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                </div>
                  <div
                    ref={fullscreenPlayheadLayerRef}
                    className="absolute inset-0 z-[22] overflow-visible pointer-events-none"
                  >
                    <div
                      ref={fullscreenPlayheadElRef}
                      className="absolute top-0 left-0 h-full will-change-transform"
                      style={{ width: 0 }}
                      aria-hidden
                    >
                      <div
                        className="absolute top-0 cursor-ew-resize nodrag nopan pointer-events-auto group"
                        style={{ width: PLAYHEAD_HIT_PX, height: '100%', marginLeft: -PLAYHEAD_HIT_PX / 2 }}
                        data-playhead
                        onPointerDown={handlePlayheadPointerDown}
                      >
                        <div
                          className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 ${uiPlayhead}`}
                          style={{ width: PLAYHEAD_LINE_PX }}
                        />
                        {cutMode && (
                          <button
                            type="button"
                            data-cut-action
                            className={playheadCutBtnClass(true)}
                            title={vs.cutAtPlayheadTitle}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                            }}
                            onClick={handleCutAtPlayhead}
                          >
                            <Scissors className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div
                  className="flex-shrink-0 box-border nodrag nopan"
                  style={{
                    height: SPLICE_TIMELINE_SCROLLBAR_LANE_PX,
                    paddingBottom: SPLICE_TIMELINE_SCROLLBAR_PAD_PX,
                  }}
                >
                  <div
                    ref={fullscreenTimelineScrollbarRef}
                    className={`h-full overflow-x-scroll overflow-y-hidden ${spliceTimelineScroller}`}
                    style={{ height: SPLICE_TIMELINE_SCROLLBAR_THUMB_PX, width: '100%' }}
                    onScroll={handleTimelineScrollbarScrollWithPlayhead}
                    onPointerDown={handleTimelineScrollbarPointerDown}
                    onPointerUp={handleTimelineScrollbarPointerUp}
                    onPointerCancel={handleTimelineScrollbarPointerUp}
                  >
                    <div className="shrink-0" style={{ width: timelineRowWidthPxFs, height: 1 }} aria-hidden />
                  </div>
                </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
      {/* 剪映式拖拽幽灵：拖出轨道区域时跟随光标 */}
      {draggingClip && createPortal(
        <div
          ref={dragGhostElRef}
          className="fixed left-0 top-0 pointer-events-none flex overflow-hidden rounded-lg border border-white/40 shadow-2xl will-change-transform"
          style={{
            zIndex: WORKSPACE_CANVAS_OVERLAY_Z,
            width: Math.max(24, ((draggingClip.clip.trimEnd ?? draggingClip.clip.duration) - (draggingClip.clip.trimStart ?? 0)) * pixelsPerSecond),
            minWidth: 24,
            height: TRACK_HEIGHT - 8,
            backgroundColor: isVideoTrackRef(draggingClip.track) ? 'rgb(15 15 20)' : 'rgb(113 63 18)',
            opacity: dragOutsideTimeline ? 0.92 : 0,
          }}
        >
          <span className="flex-1 truncate px-2 py-1 text-[10px] text-white/95">
            {draggingClip.clip.name || (draggingClip.clip.type === 'image' ? vs.clipNameImage : isVideoTrackRef(draggingClip.track) ? vs.clipNameVideo : vs.clipNameAudio)}
          </span>
        </div>,
        document.body
      )}
    </div>
  );
};

export default VideoSpliceNode;
