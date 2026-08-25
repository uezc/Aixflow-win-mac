// @ts-nocheck
import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, memo, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeProps, addEdge, useReactFlow, useUpdateNodeInternals, type Edge, type Node } from 'reactflow';
import { useFrozenFlowViewport } from '../../hooks/useFrozenFlowViewport';
import { Loader2, Mic, Play, Pause, Volume2, Upload, AudioLines, Scissors, Download, Check, X } from 'lucide-react';
import { normalizeVideoUrl } from '../../utils/normalizeVideoUrl';
import { probeAudioMediaDurationSec } from '../../utils/timelineSourceMedia';
import { ModuleProgressBar } from './ModuleProgressBar';
import { AiGeneratedBadge } from '../legal/AiGeneratedBadge';
import { useGlobalInteractionSelector } from '../../utils/globalInteractionStore';
import { mapProjectPath } from '../../utils/pathMapper';
import {
  userFacingErrorMessage,
  refundHintForLocale,
  messageContainsRefundHint,
} from '../../utils/userErrorMessageCn';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { workspaceChromeT } from '../../i18n/workspaceI18n';
import { audioNodeChromeT, type AudioNodeChromeStrings } from '../../i18n/audioNodeChromeI18n';
import { audioInputPanelT } from '../../i18n/audioInputPanelI18n';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import {
  useReferenceMicRecording,
} from '../../hooks/useReferenceMicRecording';
import { bindPushToTalkPointerHandlers } from '../../utils/pushToTalkPointer';
import { micLevelCssVars } from '../../utils/micInputLevel';
import { acquireVoiceModalLock, releaseVoiceModalLock } from '../../utils/voiceModalGate';
import { isAudioSongModel, buildMusicDownloadSuggestedName } from '../../utils/audioSongModels';
import { isAudioCoverModel } from '../../utils/audioCoverModel';
import { setAudioNodePlaying } from '../../utils/audioNodePlaybackStore';
import { dispatchCanvasPickNode, isCanvasPickVoiceTarget } from '../../utils/canvasPickStore';
import { AudioWaveformVisualizer } from './AudioWaveformVisualizer';
import { nodeStyleDimensions } from '../../utils/nodeSizeFromAspectRatio';
import { scaleModulePx } from '../../utils/moduleDisplayScale';
import { useAudioInputPanelAnchor } from '../../contexts/AudioInputPanelContext';
import VoiceMicGlyph from './VoiceMicGlyph';

/** 声音模块固定尺寸（不可拖拽缩放） */
export const AUDIO_NODE_WIDTH = scaleModulePx(280);
export const AUDIO_NODE_HEIGHT = scaleModulePx(160);

export type AudioSeparateAllPayload = {
  sourceNodeId: string;
  newNodes: Node[];
  newEdges: Edge[];
  clearSourceData: Partial<AudioNodeData>;
};

interface AudioNodeData {
  width?: number;
  height?: number;
  outputAudio?: string;
  outputAudios?: string[];
  originalOutputAudios?: string[];
  originalAudioUrl?: string; // 原始远程 URL（备用）
  title?: string;
  errorMessage?: string;
  text?: string;
  aiStatus?: 'idle' | 'START' | 'PROCESSING' | 'SUCCESS' | 'ERROR';
  progress?: number; // 生成进度 0-100
  progressMessage?: string; // 进度文案（如人声分离时显示「人声分离中…」）
  audioSourceType?: 'vocals' | 'accompaniment'; // 人声分离结果：人声 | 背景音
  referenceAudioUrl?: string; // Index-TTS2 参考音：URL 或 local-resource://
  /** 当前输出音频的真实时长（秒），供剪辑节点连线同步 */
  mediaDurationSec?: number;
  model?: string; // 如 'rhart-song' / 'rhart-song-v5.5' 全能写歌
  songName?: string; // 全能写歌：歌曲名仅显示在节点顶部 title-area
  updatedAt?: number; // 强制重渲染时间戳（video->audio 注入时）
}

interface AudioNodeProps extends NodeProps<AudioNodeData> {
  projectId?: string;
  isDarkMode?: boolean;
  performanceMode?: boolean;
  onDataChange?: (nodeId: string, updates: Partial<AudioNodeData>) => void;
  /** 多段音频一键分离：须写入 Workspace 画布状态（勿仅用 useReactFlow().setNodes） */
  onSeparateAllAudios?: (payload: AudioSeparateAllPayload) => void;
  /** 裁剪导出：新音频节点 + 连线写入 Workspace（原模块不动） */
  onAddAudioClipNodes?: (payload: { nodes: Node[]; edges: Edge[] }) => void;
  /** 底部 Audio 面板打开时，同步参考音输入框 */
  syncAudioPanelReferenceUrl?: (url: string) => void;
}

function formatAudioClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function pickFiniteAudioDuration(audio: HTMLAudioElement): number {
  const d = audio.duration;
  if (Number.isFinite(d) && d > 0) return d;
  return 0;
}

/** UI 进度条可回退到 buffered 末端；写入节点 mediaDurationSec 必须用完整文件时长 */
function pickBufferedAudioHint(audio: HTMLAudioElement): number {
  const d = pickFiniteAudioDuration(audio);
  if (d > 0) return d;
  try {
    const buf = audio.buffered;
    if (buf.length > 0) {
      const end = buf.end(buf.length - 1);
      if (Number.isFinite(end) && end > 0) return end;
    }
  } catch {
    /* ignore */
  }
  return 0;
}

/** 播放器 UI 时长：截取/换源后文件 metadata 短于 mediaDurationSec 时以文件为准 */
function resolveUiAudioDuration(fileDur: number, storedSec?: number): number {
  const file = Number(fileDur);
  const stored = Number(storedSec);
  if (!Number.isFinite(file) || file <= 0) {
    return Number.isFinite(stored) && stored > 0 ? stored : 0;
  }
  if (!Number.isFinite(stored) || stored <= 0) return file;
  if (stored > file + 1) return file;
  return Math.max(file, stored);
}

const ZOOM_THRESHOLD_FAR = 0.1;
const ZOOM_THRESHOLD_NEAR = 0.5;

// 裁剪区间双指针进度条：前后两个指针选择裁剪范围，中间高亮
const TrimRangeBar: React.FC<{
  duration: number;
  currentTime: number;
  trimStart: number;
  trimEnd: number;
  isDarkMode: boolean;
  audioRef: React.RefObject<HTMLAudioElement>;
  setCurrentTime: (t: number) => void;
  onTrimRangeChange: (start: number, end: number) => void;
}> = ({ duration, currentTime, trimStart, trimEnd, isDarkMode, audioRef, setCurrentTime, onTrimRangeChange }) => {
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
    if (!audioRef.current) return;
    const t = getTimeFromClientX(e.clientX);
    audioRef.current.currentTime = t;
    setCurrentTime(t);
  }, [audioRef, getTimeFromClientX, setCurrentTime]);

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
      const newStart = clamp(t);
      onTrimRangeChange(newStart, Math.max(newStart, end));
    } else {
      const newEnd = clamp(t);
      onTrimRangeChange(Math.min(newEnd, start), newEnd);
    }
  }, [getTimeFromClientX, onTrimRangeChange]);

  const handleThumbPointerUp = useCallback(() => {
    draggingRef.current = null;
  }, []);

  const trackBg = isDarkMode ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)';
  const selectedColor = isDarkMode ? '#a78bfa' : '#7c3aed';
  const playedColor = isDarkMode ? 'rgba(167,139,250,0.42)' : 'rgba(124,58,237,0.38)';

  const trimThumbClass =
    'absolute top-1/2 -translate-y-1/2 z-10 nodrag nopan flex h-4 w-4 cursor-ew-resize items-center justify-center rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.25)]';

  return (
    <div
      ref={trackRef}
      role="group"
      aria-label="裁剪范围与播放进度"
      title="拖拽前后指针选择裁剪区间，点击轨道跳转播放位置"
      className="nodrag nopan relative h-3 w-full rounded-full cursor-pointer select-none"
      style={{ background: trackBg }}
      onClick={(e) => { e.stopPropagation(); handleTrackClick(e); }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* 已播放部分 (0 ~ currentTime) */}
      <div
        className="absolute inset-y-0 left-0 rounded-l-full pointer-events-none"
        style={{
          width: `${pct(Math.min(currentTime, trimStart))}%`,
          background: playedColor,
        }}
      />
      {/* 裁剪选中区间 (trimStart ~ trimEnd) */}
      <div
        className="absolute inset-y-0 pointer-events-none"
        style={{
          left: `${pct(trimStart)}%`,
          width: `${pct(trimEnd - trimStart)}%`,
          background: selectedColor,
        }}
      />
      {/* 选中区间内的已播放部分 */}
      {currentTime > trimStart && currentTime < trimEnd && (
        <div
          className="absolute inset-y-0 pointer-events-none"
          style={{
            left: `${pct(trimStart)}%`,
            width: `${pct(currentTime - trimStart)}%`,
            background: playedColor,
          }}
        />
      )}
      {/* 起始指针 */}
      <div
        className={trimThumbClass}
        style={{ left: `calc(${pct(trimStart)}% - 8px)`, background: selectedColor }}
        onPointerDown={handleThumbPointerDown('start')}
        onPointerMove={handleThumbPointerMove}
        onPointerUp={handleThumbPointerUp}
        onPointerLeave={handleThumbPointerUp}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-white" />
      </div>
      {/* 结束指针 */}
      <div
        className={trimThumbClass}
        style={{ left: `calc(${pct(trimEnd)}% - 8px)`, background: selectedColor }}
        onPointerDown={handleThumbPointerDown('end')}
        onPointerMove={handleThumbPointerMove}
        onPointerUp={handleThumbPointerUp}
        onPointerLeave={handleThumbPointerUp}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-white" />
      </div>
    </div>
  );
};

// 与视频裁剪胶片条同款：挂在节点下方的内联裁剪条（无全屏弹窗）
const AudioTrimInlineBar: React.FC<{
  audioUrl: string;
  isDarkMode: boolean;
  initialTrimStart: number;
  initialTrimEnd: number;
  onConfirm: (trimStart: number, trimEnd: number) => void;
  onCancel: () => void;
  trimming: boolean;
  trimError?: string | null;
  c: AudioNodeChromeStrings;
}> = ({
  audioUrl,
  isDarkMode,
  initialTrimStart,
  initialTrimEnd,
  onConfirm,
  onCancel,
  trimming,
  trimError,
  c,
}) => {
  const { locale } = useAppLocale();
  const modalAudioRef = useRef<HTMLAudioElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [trimStart, setTrimStart] = useState(initialTrimStart);
  const [trimEnd, setTrimEnd] = useState(initialTrimEnd);
  const [isPlaying, setIsPlaying] = useState(false);
  const dragRef = useRef<{ mode: 'start' | 'end' | 'move'; originX: number; start0: number; end0: number } | null>(
    null,
  );

  const playbackUrl = useMemo(() => normalizeAudioUrl(audioUrl), [audioUrl]);
  const MIN_TRIM = 0.1;

  useEffect(() => {
    setTrimStart(initialTrimStart);
    setTrimEnd(initialTrimEnd);
  }, [initialTrimStart, initialTrimEnd]);

  useEffect(() => {
    if (duration > 0 && (trimEnd <= 0 || trimEnd > duration)) {
      setTrimEnd(duration);
    }
  }, [duration, trimEnd]);

  const clamp = useCallback((v: number) => Math.max(0, Math.min(duration || 0, v)), [duration]);
  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0);
  const selLeft = pct(trimStart);
  const selWidth = Math.max(pct(trimEnd) - selLeft, 0.8);
  const selDur = Math.max(0, trimEnd - trimStart);

  const timeFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || duration <= 0) return 0;
      const rect = track.getBoundingClientRect();
      return clamp(((clientX - rect.left) / Math.max(rect.width, 1)) * duration);
    },
    [clamp, duration],
  );

  const startDrag = useCallback(
    (mode: 'start' | 'end' | 'move') => (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { mode, originX: e.clientX, start0: trimStart, end0: trimEnd };
    },
    [trimStart, trimEnd],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || duration <= 0) return;
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const dxSec = ((e.clientX - drag.originX) / Math.max(rect.width, 1)) * duration;
      if (drag.mode === 'start') {
        const ns = clamp(Math.min(drag.start0 + dxSec, drag.end0 - MIN_TRIM));
        setTrimStart(ns);
      } else if (drag.mode === 'end') {
        const ne = clamp(Math.max(drag.end0 + dxSec, drag.start0 + MIN_TRIM));
        setTrimEnd(ne);
      } else {
        const span = drag.end0 - drag.start0;
        let ns = drag.start0 + dxSec;
        let ne = drag.end0 + dxSec;
        if (ns < 0) {
          ne -= ns;
          ns = 0;
        }
        if (ne > duration) {
          ns -= ne - duration;
          ne = duration;
        }
        setTrimStart(clamp(ns));
        setTrimEnd(clamp(Math.max(ns + Math.min(span, duration), ns + MIN_TRIM)));
      }
    },
    [clamp, duration],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  const togglePlay = useCallback(() => {
    const el = modalAudioRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
      return;
    }
    if (trimEnd > trimStart && (el.currentTime < trimStart || el.currentTime >= trimEnd)) {
      el.currentTime = trimStart;
      setCurrentTime(trimStart);
    }
    el.play().then(() => setIsPlaying(true)).catch(() => {});
  }, [isPlaying, trimStart, trimEnd]);

  return (
    <div
      className={`nexflow-video-trim-bar nexflow-audio-trim-bar nodrag nopan mt-1.5 w-full rounded-2xl border px-2.5 py-2.5 outline-none ${
        isDarkMode
          ? 'border-white/12 bg-black/70 text-white backdrop-blur-md'
          : 'border-gray-200 bg-white/95 text-gray-900 shadow-lg'
      }`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <audio
        ref={modalAudioRef}
        src={playbackUrl}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(e) => {
          const d = pickFiniteAudioDuration(e.currentTarget);
          setDuration(d);
          if (d > 0 && (trimEnd <= 0 || trimEnd > d)) setTrimEnd(d);
        }}
        onDurationChange={(e) => {
          const d = pickFiniteAudioDuration(e.currentTarget);
          if (d > 0) {
            setDuration(d);
            setTrimEnd((te) => (te <= 0 || te > d ? d : te));
          }
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

      <div className={`mb-1.5 flex items-center justify-between gap-2 text-[11px] ${isDarkMode ? 'text-white/55' : 'text-gray-500'}`}>
        <span className="flex items-center gap-1.5 shrink-0">
          {trimming ? <Loader2 className="h-3 w-3 animate-spin text-sky-400" /> : null}
          {c.trimModalTitle}
        </span>
        <span className="truncate">
          {locale === 'en' ? 'Drag to trim · Confirm exports a new module' : '拖选区间裁剪 · 确认后导出为新模块'}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={trimming}
          onClick={() => !trimming && onCancel()}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors ${
            isDarkMode
              ? 'border-white/20 bg-white/8 hover:bg-white/14 disabled:opacity-40'
              : 'border-gray-200 bg-gray-50 hover:bg-gray-100 disabled:opacity-40'
          }`}
          title={c.cancel}
          aria-label={c.cancel}
        >
          <X className="h-4 w-4" />
        </button>

        <div
          ref={trackRef}
          className={`relative h-[64px] min-w-0 flex-1 overflow-hidden rounded-xl ${
            isDarkMode ? 'bg-white/5 ring-1 ring-white/10' : 'bg-gray-100 ring-1 ring-gray-200'
          }`}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClick={(e) => {
            if (dragRef.current) return;
            const t = timeFromClientX(e.clientX);
            if (modalAudioRef.current) {
              modalAudioRef.current.currentTime = t;
              setCurrentTime(t);
            }
          }}
        >
          {duration <= 0 ? (
            <div className="flex h-full items-center justify-center gap-2 text-[11px] opacity-70">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {locale === 'en' ? 'Loading…' : '加载中…'}
            </div>
          ) : (
            <>
              <div
                className={`pointer-events-none absolute inset-0 opacity-40 ${
                  isDarkMode
                    ? 'bg-[repeating-linear-gradient(90deg,transparent,transparent_6px,rgba(255,255,255,0.08)_6px,rgba(255,255,255,0.08)_7px)]'
                    : 'bg-[repeating-linear-gradient(90deg,transparent,transparent_6px,rgba(0,0,0,0.06)_6px,rgba(0,0,0,0.06)_7px)]'
                }`}
              />
              <div className="pointer-events-none absolute inset-y-0 left-0 bg-black/55" style={{ width: `${selLeft}%` }} />
              <div
                className="pointer-events-none absolute inset-y-0 right-0 bg-black/55"
                style={{ width: `${Math.max(0, 100 - selLeft - selWidth)}%` }}
              />
              <div
                className="absolute inset-y-1 z-10 cursor-grab rounded-lg border-2 border-white active:cursor-grabbing"
                style={{ left: `${selLeft}%`, width: `${selWidth}%`, boxShadow: '0 0 0 1px rgba(0,0,0,0.35)' }}
                onPointerDown={startDrag('move')}
              >
                <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
                  <span className="rounded-md bg-black/65 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white">
                    {selDur.toFixed(2)}s
                  </span>
                </div>
                <div
                  className="absolute inset-y-0 left-0 z-20 w-3 -translate-x-1/2 cursor-ew-resize"
                  onPointerDown={startDrag('start')}
                >
                  <span className="absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
                </div>
                <div
                  className="absolute inset-y-0 right-0 z-20 w-3 translate-x-1/2 cursor-ew-resize"
                  onPointerDown={startDrag('end')}
                >
                  <span className="absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
                </div>
              </div>
              <div
                className="pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-sky-400"
                style={{ left: `${pct(currentTime)}%` }}
              />
              <button
                type="button"
                className="absolute bottom-1.5 left-1.5 z-40 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/70"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlay();
                }}
                title={isPlaying ? '暂停' : '播放'}
              >
                {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}
              </button>
            </>
          )}
        </div>

        <button
          type="button"
          disabled={trimming || duration <= 0 || trimEnd - trimStart < MIN_TRIM}
          onClick={() => onConfirm(trimStart, trimEnd)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
          title={locale === 'en' ? 'Confirm trim' : '确认裁剪'}
          aria-label={locale === 'en' ? 'Confirm trim' : '确认裁剪'}
        >
          {trimming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" strokeWidth={2.5} />}
        </button>
      </div>

      <p className={`mt-1.5 text-center text-[10px] leading-relaxed ${isDarkMode ? 'text-white/45' : 'text-gray-500'}`}>
        {c.trimRangeLabel(formatAudioClock(trimStart), formatAudioClock(trimEnd))}
        {' · '}
        {locale === 'en' ? 'Click track to seek' : '点击轨道跳转试听'}
      </p>
      {trimError ? <p className="mt-1 text-[11px] text-red-400">{trimError}</p> : null}
    </div>
  );
};

// 与视频一致：统一使用 normalizeVideoUrl，得到 local-resource://C:/path 格式，避免二次编码和 404
const normalizeAudioUrl = (url: string): string => {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('data:')) return url;
  return normalizeVideoUrl(url);
};

/** 波形播放器极简控制条（主模块下方独立区块，无边框） */
const AudioWaveformControlsBar: React.FC<{
  isDarkMode: boolean;
  isPlaying: boolean;
  sourceLoadFailed: boolean;
  currentTime: number;
  displayDuration: number;
  volume: number;
  audioRef: React.RefObject<HTMLAudioElement>;
  setCurrentTime: (t: number) => void;
  onTogglePlay: () => void;
  onVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
}> = ({
  isDarkMode,
  isPlaying,
  sourceLoadFailed,
  currentTime,
  displayDuration,
  volume,
  audioRef,
  setCurrentTime,
  onTogglePlay,
  onVolumeChange,
  className = '',
}) => (
  <>
    <style>{`
      .nexflow-audio-mini-range {
        -webkit-appearance: none;
        appearance: none;
        height: 3px;
        border-radius: 999px;
        background: ${isDarkMode ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'};
        outline: none;
      }
      .nexflow-audio-mini-range::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #a78bfa;
        border: none;
        box-shadow: 0 0 0 2px ${isDarkMode ? 'rgba(10,10,12,0.9)' : 'rgba(255,255,255,0.95)'};
        cursor: pointer;
      }
      .nexflow-audio-mini-range::-moz-range-thumb {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #a78bfa;
        border: none;
        cursor: pointer;
      }
      .nexflow-audio-mini-range:disabled {
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
          disabled={sourceLoadFailed}
          className={`nodrag shrink-0 bg-transparent p-0 transition-opacity ${
            sourceLoadFailed
              ? 'cursor-not-allowed opacity-35'
              : isDarkMode
                ? 'text-violet-300/90 hover:text-violet-200'
                : 'text-violet-600 hover:text-violet-700'
          }`}
          title={sourceLoadFailed ? '音源不可用' : isPlaying ? '暂停' : '播放'}
          aria-label={sourceLoadFailed ? '音源不可用' : isPlaying ? '暂停' : '播放'}
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
            if (audioRef.current) {
              audioRef.current.currentTime = newTime;
              setCurrentTime(newTime);
            }
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className={`nexflow-audio-mini-range nodrag min-w-0 flex-1 ${displayDuration > 0 ? 'cursor-pointer' : 'cursor-not-allowed'}`}
          aria-label="播放进度"
          title="点击或拖拽选择播放位置"
        />
      </div>
      <div className="flex items-center justify-between gap-2 pl-5">
        <span className={`text-[10px] font-mono tabular-nums ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>
          {formatAudioClock(currentTime)}
          {displayDuration > 0 ? ` / ${formatAudioClock(displayDuration)}` : ''}
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
            className="nexflow-audio-mini-range w-14 cursor-pointer"
            aria-label="音量"
            title="音量"
          />
        </div>
      </div>
    </div>
  </>
);

/** 多段翻唱结果：每段独立完整播放器（进度条 / 时长 / 音量 / 播放） */
const AudioMultiOutputMainPlayer: React.FC<{
  urls: string[];
  originalUrls?: string[];
  isDarkMode: boolean;
  nodeId: string;
  data?: AudioNodeData;
  projectId?: string;
  chrome: AudioNodeChromeStrings;
  setOutputAudio: (url: string) => void;
  updateNodeData: (updates: Partial<AudioNodeData>) => void;
  onPlayingChange?: (playing: boolean) => void;
  controlsPortalEl?: HTMLElement | null;
  spaceKeyboardActive?: boolean;
}> = ({
  urls,
  originalUrls,
  isDarkMode,
  nodeId,
  data,
  projectId,
  chrome,
  setOutputAudio,
  updateNodeData,
  onPlayingChange,
  controlsPortalEl,
  spaceKeyboardActive = false,
}) => {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (selectedIdx >= urls.length) {
      setSelectedIdx(0);
    }
  }, [urls.length, selectedIdx]);

  const selectTrack = useCallback((idx: number) => {
    audioRef.current?.pause();
    setSelectedIdx(idx);
  }, []);

  const selectedUrl = urls[selectedIdx] ?? urls[0] ?? '';
  const selectedOriginal = originalUrls?.[selectedIdx];

  return (
    <div className="flex w-full flex-1 min-h-0 flex-col gap-1.5">
      {urls.length > 1 ? (
        <div className="shrink-0 space-y-1">
          <p className={`text-[10px] px-0.5 ${isDarkMode ? 'text-white/45' : 'text-gray-500'}`}>
            {chrome.selectTrackHint}
          </p>
          <div className="flex gap-1.5">
            {urls.map((url, idx) => {
              const selected = idx === selectedIdx;
              return (
                <button
                  key={`${url}-${idx}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    selectTrack(idx);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={`nodrag flex-1 min-w-0 rounded-lg transition-all ${
                    selected
                      ? isDarkMode
                        ? 'ring-2 ring-violet-400/80 ring-offset-1 ring-offset-transparent'
                        : ''
                      : 'opacity-65 hover:opacity-90'
                  }`}
                  title={chrome.trackLabel(idx + 1)}
                  aria-label={chrome.trackLabel(idx + 1)}
                  aria-pressed={selected}
                >
                  <AudioWaveformVisualizer
                    isPlaying={false}
                    isDarkMode={isDarkMode}
                    variant="compact"
                    seed={url}
                  />
                  <span
                    className={`block text-center text-[10px] font-semibold tabular-nums py-0.5 ${
                      isDarkMode ? 'text-violet-200/80' : 'text-violet-800'
                    }`}
                  >
                    {chrome.trackLabel(idx + 1)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <AudioPlayerComponent
        key={`track-${selectedIdx}-${selectedUrl}`}
        nodeId={nodeId}
        audioRef={audioRef}
        outputAudio={selectedUrl}
        originalAudioUrl={selectedOriginal}
        data={data}
        isDarkMode={isDarkMode}
        projectId={projectId}
        setOutputAudio={setOutputAudio}
        updateNodeData={updateNodeData}
        onPlayingChange={onPlayingChange}
        layoutVariant="waveform"
        controlsPortalEl={controlsPortalEl}
        syncDurationToNode={selectedIdx === 0}
        spaceKeyboardActive={spaceKeyboardActive}
      />
    </div>
  );
};

// 音频播放器组件（用于 AudioNode，暗黑模式使用图二样式）
const AudioPlayerComponent: React.FC<{
  nodeId: string;
  audioRef: React.RefObject<HTMLAudioElement>;
  outputAudio: string;
  originalAudioUrl?: string;
  data?: AudioNodeData;
  isDarkMode: boolean;
  projectId?: string;
  setOutputAudio: (url: string) => void;
  updateNodeData: (updates: Partial<AudioNodeData>) => void;
  /** 是否显示裁剪范围选择（双指针） */
  showTrimRange?: boolean;
  trimStart?: number;
  trimEnd?: number;
  onTrimRangeChange?: (start: number, end: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  /** 多段结果：开始播放前先暂停其它段 */
  onBeforePlay?: () => void;
  /** 宫格内紧凑布局（裁剪弹窗等） */
  compact?: boolean;
  /** 主模块波形 + 控件外置 */
  layoutVariant?: 'waveform' | 'classic';
  /** 波形控件 Portal 挂载点（主模块下方悬浮区） */
  controlsPortalEl?: HTMLElement | null;
  controlsFooter?: React.ReactNode;
  slotLabel?: string;
  syncDurationToNode?: boolean;
  /** 节点选中时响应空格键播放/暂停 */
  spaceKeyboardActive?: boolean;
}> = ({
  nodeId,
  audioRef,
  outputAudio,
  originalAudioUrl,
  data,
  isDarkMode,
  projectId,
  setOutputAudio,
  updateNodeData,
  showTrimRange,
  trimStart = 0,
  trimEnd = 0,
  onTrimRangeChange,
  onPlayingChange,
  onBeforePlay,
  compact = false,
  layoutVariant,
  controlsPortalEl,
  controlsFooter,
  slotLabel,
  syncDurationToNode = true,
  spaceKeyboardActive = false,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [sourceLoadFailed, setSourceLoadFailed] = useState(false);
  const resolvedLayout = layoutVariant ?? (compact ? 'classic' : 'waveform');
  const useWaveformMain = resolvedLayout === 'waveform' && !showTrimRange;
  const [activeSrc, setActiveSrc] = useState('');
  const lastDurationPollRef = useRef(0);

  const syncMediaDurationSec = useCallback(
    (sec: number) => {
      if (!syncDurationToNode) return;
      if (!Number.isFinite(sec) || sec <= 0) return;
      const stored = Number(data?.mediaDurationSec);
      if (Number.isFinite(stored) && stored >= sec - 0.05) return;
      updateNodeData({ mediaDurationSec: sec });
    },
    [data?.mediaDurationSec, updateNodeData, syncDurationToNode],
  );

  const syncPlayingState = useCallback(
    (playing: boolean) => {
      setIsPlaying(playing);
      setAudioNodePlaying(nodeId, playing);
      onPlayingChange?.(playing);
    },
    [nodeId, onPlayingChange],
  );

  useEffect(() => {
    return () => {
      setAudioNodePlaying(nodeId, false);
      onPlayingChange?.(false);
    };
  }, [nodeId, onPlayingChange]);

  // 与视频一致：normalizeAudioUrl 内部用 normalizeVideoUrl，得到 local-resource://C:/path
  const normalizedUrl = useMemo(() => normalizeAudioUrl(outputAudio), [outputAudio]);
  const preferredLocalUrl = useMemo(() => {
    if (
      normalizedUrl.startsWith('local-resource://') ||
      normalizedUrl.startsWith('file://')
    ) {
      return normalizedUrl;
    }
    return '';
  }, [normalizedUrl]);
  const preferredRemoteUrl = useMemo(() => {
    const remote = (originalAudioUrl || data?.originalAudioUrl)?.trim();
    if (remote && (remote.startsWith('http://') || remote.startsWith('https://'))) {
      return remote;
    }
    if (
      normalizedUrl.startsWith('http://') ||
      normalizedUrl.startsWith('https://')
    ) {
      return normalizedUrl;
    }
    return '';
  }, [normalizedUrl, originalAudioUrl, data?.originalAudioUrl]);
  // 播放首选：本地 local-resource/file://，远程 originalAudioUrl 仅作回退
  const playbackUrl = useMemo(() => {
    if (preferredLocalUrl) return preferredLocalUrl;
    if (preferredRemoteUrl) return preferredRemoteUrl;
    return normalizedUrl;
  }, [preferredLocalUrl, preferredRemoteUrl, normalizedUrl]);

  useEffect(() => {
    setActiveSrc(playbackUrl);
  }, [playbackUrl]);

  // 调试：首次有 playbackUrl 时打印，便于确认节点是否拿到有效 URL
  useEffect(() => {
    if (!playbackUrl) return;
    console.log('[AudioNode] 播放 URL:', {
      preferred: playbackUrl.startsWith('local-resource://') ? 'local' : playbackUrl.startsWith('http') ? 'remote' : 'other',
      hasLocal: !!preferredLocalUrl,
      hasRemote: !!preferredRemoteUrl,
      prefix: playbackUrl.slice(0, 60),
    });
  }, [playbackUrl, preferredLocalUrl, preferredRemoteUrl]);

  // 换源时优先用节点已写入的 mediaDurationSec，避免录音/生成后先显示 0:00、播完才出现总时长
  useEffect(() => {
    const stored = Number(data?.mediaDurationSec);
    if (Number.isFinite(stored) && stored > 0) {
      setDuration((prev) => resolveUiAudioDuration(prev, stored));
      setCurrentTime(0);
    } else if (playbackUrl) {
      setDuration(0);
      setCurrentTime(0);
    }
  }, [playbackUrl, data?.mediaDurationSec]);

  // ffmpeg 探测写入的 mediaDurationSec 优先于 metadata/buffered 短时长（但截取后文件更短则以文件为准）
  useEffect(() => {
    const d = Number(data?.mediaDurationSec);
    if (Number.isFinite(d) && d > 0) {
      setDuration((prev) => resolveUiAudioDuration(prev, d));
    }
  }, [data?.mediaDurationSec]);

  // ffmpeg / metadata 探测完整时长（UI 专用 probe，不受 timeline 占位规则影响）
  useEffect(() => {
    if (!playbackUrl) return;
    let cancelled = false;
    (async () => {
      const dur = await probeAudioMediaDurationSec(playbackUrl, projectId);
      if (cancelled || dur <= 0) return;
      const stored = Number(data?.mediaDurationSec);
      setDuration((prev) => resolveUiAudioDuration(dur, Number.isFinite(stored) && stored > 0 ? stored : prev));
    })();
    return () => {
      cancelled = true;
    };
  }, [playbackUrl, projectId, data?.mediaDurationSec]);

  // 当 duration 加载完成且启用裁剪范围时，初始化裁剪区间
  useEffect(() => {
    if (showTrimRange && duration > 0 && onTrimRangeChange && (trimEnd <= 0 || trimEnd > duration)) {
      onTrimRangeChange(0, duration);
    }
  }, [showTrimRange, duration, onTrimRangeChange, trimEnd]);

  // 检查音频格式兼容性
  const checkAudioCompatibility = useCallback((url: string): boolean => {
    if (!url) return false;
    const audio = document.createElement('audio');
    const ext = url.split('.').pop()?.toLowerCase();
    let mimeType = '';
    switch (ext) {
      case 'mp3':
        mimeType = 'audio/mpeg';
        break;
      case 'wav':
        mimeType = 'audio/wav';
        break;
      case 'ogg':
        mimeType = 'audio/ogg';
        break;
      case 'm4a':
        mimeType = 'audio/mp4';
        break;
      default:
        return true;
    }
    const canPlay = audio.canPlayType(mimeType);
    return canPlay === 'probably' || canPlay === 'maybe';
  }, []);

  const displayDuration = resolveUiAudioDuration(duration, data?.mediaDurationSec);

  const tryPlaybackFallback = useCallback((): boolean => {
    if (
      activeSrc.startsWith('http') &&
      preferredLocalUrl &&
      activeSrc !== preferredLocalUrl
    ) {
      console.warn('[AudioPlayerComponent] 远程播放失败，尝试本地 URL');
      setActiveSrc(preferredLocalUrl);
      return true;
    }
    if (
      (activeSrc.startsWith('local-resource://') || activeSrc.startsWith('file://')) &&
      preferredRemoteUrl &&
      activeSrc !== preferredRemoteUrl
    ) {
      console.warn('[AudioPlayerComponent] 本地播放失败，尝试远程 URL');
      setActiveSrc(preferredRemoteUrl);
      return true;
    }
    return false;
  }, [activeSrc, preferredLocalUrl, preferredRemoteUrl]);

  // 播放/暂停 - 裁剪模式下仅播放 trimStart~trimEnd 区间
  const togglePlay = useCallback(async () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      syncPlayingState(false);
      return;
    }
    if (!activeSrc || !activeSrc.trim()) {
      console.warn('[AudioPlayerComponent] 播放跳过：音源地址为空');
      return;
    }
    onBeforePlay?.();
    const el = audioRef.current;
    if (el.readyState === 0) {
      if (!el.currentSrc && !el.src && activeSrc) {
        el.src = activeSrc;
      }
      el.load();
    }
    // 裁剪模式：确保从 trimStart 开始，若已在区间外则重置
    const inTrimMode = showTrimRange && trimEnd > trimStart && duration > 0;
    if (inTrimMode) {
      const t = el.currentTime;
      if (t < trimStart || t >= trimEnd) {
        el.currentTime = trimStart;
        setCurrentTime(trimStart);
      }
    }
    try {
      if (!checkAudioCompatibility(activeSrc)) {
        console.warn('[AudioPlayerComponent] 音频格式可能不兼容，尝试播放:', activeSrc.slice(0, 60));
      }
      setAudioNodePlaying(nodeId, true);
      const playPromise = el.play();
      if (playPromise !== undefined) {
        await playPromise;
      }
      syncPlayingState(true);
      setSourceLoadFailed(false);
    } catch (error: any) {
      setAudioNodePlaying(nodeId, false);
      setIsPlaying(false);
      if (tryPlaybackFallback()) return;
      const isNotSupported = error?.name === 'NotSupportedError' || String(error?.message || '').includes('supported sources');
      setSourceLoadFailed(true);
      if (isNotSupported) {
        console.warn('[AudioPlayerComponent] 音源无法播放（NotSupportedError），请检查文件路径或重新选择文件');
      } else {
        console.error('[AudioPlayerComponent] 播放失败:', error?.name, error?.message);
      }
    }
  }, [isPlaying, audioRef, activeSrc, checkAudioCompatibility, tryPlaybackFallback, showTrimRange, trimStart, trimEnd, duration, syncPlayingState, nodeId, onBeforePlay]);

  useEffect(() => {
    if (!spaceKeyboardActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.code !== 'Space') return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if ((window as Window & { __nexflowVoiceModalOpen?: boolean }).__nexflowVoiceModalOpen) return;
      e.preventDefault();
      e.stopPropagation();
      if (!sourceLoadFailed) void togglePlay();
      const active = document.activeElement as HTMLElement | null;
      if (active?.getAttribute?.('role') === 'button' && active.tabIndex === -1) {
        active.blur();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [spaceKeyboardActive, togglePlay, sourceLoadFailed]);

  // 音量控制
  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
  }, [audioRef]);

  // URL 变化时重新加载并清除“加载失败”状态
  useEffect(() => {
    setSourceLoadFailed(false);
    setDuration(0);
    setCurrentTime(0);
    lastDurationPollRef.current = 0;
    if (audioRef.current && activeSrc) {
      const currentSrc = audioRef.current.currentSrc || audioRef.current.src;
      if (currentSrc !== activeSrc) {
        audioRef.current.load();
      }
    }
  }, [activeSrc]);

  // 预加载检查：仅日志，不在检查失败时抢先切远程（实际播放失败时再回退）
  useEffect(() => {
    if (!preferredLocalUrl || !window.electronAPI) return;
    window.electronAPI.checkFileExists(preferredLocalUrl).then((result) => {
      if (!result.exists || !result.readable) {
        console.warn(
          `[AudioNode] 预加载检查：本地文件不存在或不可读 (exists: ${result.exists}, readable: ${result.readable})，仍优先尝试 local-resource，播放失败时再回退远程`
        );
        return;
      }
      console.log(`[AudioNode] 预加载检查：文件存在且可读 (size: ${result.size} bytes)`);
    }).catch((error) => {
      console.warn('[AudioNode] 预加载检查：检查文件失败（不影响播放尝试）:', error);
    });
  }, [preferredLocalUrl]);

  const waveformControlsBar = useWaveformMain ? (
    <AudioWaveformControlsBar
      isDarkMode={isDarkMode}
      isPlaying={isPlaying}
      sourceLoadFailed={sourceLoadFailed}
      currentTime={currentTime}
      displayDuration={displayDuration}
      volume={volume}
      audioRef={audioRef}
      setCurrentTime={setCurrentTime}
      onTogglePlay={togglePlay}
      onVolumeChange={handleVolumeChange}
    />
  ) : null;

  return (
    <div className={`w-full flex flex-col ${useWaveformMain ? 'relative h-full min-h-0 flex-1' : `items-center ${compact ? 'gap-1' : 'gap-2'}`}`}>
      {/* 隐藏的 audio 元素，用于所有模式 */}
      <audio
        key={activeSrc}
        ref={audioRef}
        src={activeSrc}
        preload="metadata"
        controls={false}
        className="hidden"
        onError={(e) => {
          console.error('[AudioNode] 播放器加载失败:', e);
          const audio = e.currentTarget;
          const error = audio.error;
          const errName = error?.name || '';
          const errMsg = error?.message || '';
          console.error('[AudioNode] 音频加载失败:', {
            src: audio.currentSrc || outputAudio,
            activeSrc,
            error: error?.code,
            message: errMsg,
            name: errName,
          });
          if (tryPlaybackFallback()) return;
          if (errName === 'NotSupportedError' || errMsg.includes('NotSupportedError')) {
            if (!activeSrc || !activeSrc.trim()) console.warn('[AudioNode] NotSupportedError: src 为空');
            else if (!activeSrc.startsWith('http') && !activeSrc.startsWith('local-resource://')) {
              console.warn('[AudioNode] NotSupportedError: 可能被系统拦截，URL 格式:', activeSrc.slice(0, 80));
            }
          }
          setSourceLoadFailed(true);
        }}
        onLoadedMetadata={(e) => {
          const audio = e.currentTarget;
          audio.currentTime = 0;
          setSourceLoadFailed(false);
          const d = pickFiniteAudioDuration(audio);
          const uiDur = resolveUiAudioDuration(d, data?.mediaDurationSec);
          setDuration(uiDur);
          syncMediaDurationSec(uiDur);
          setCurrentTime(0);
        }}
        onDurationChange={(e) => {
          const d = pickFiniteAudioDuration(e.currentTarget);
          const uiDur = resolveUiAudioDuration(d, data?.mediaDurationSec);
          setDuration(uiDur);
          syncMediaDurationSec(uiDur);
        }}
        onPlay={() => syncPlayingState(true)}
        onPause={() => syncPlayingState(false)}
        onTimeUpdate={(e) => {
          const audio = e.currentTarget;
          if (!audio.seeking) {
            const t = audio.currentTime;
            const now = Date.now();
            if (
              (duration <= 0 || !Number.isFinite(audio.duration) || audio.duration === Infinity) &&
              now - lastDurationPollRef.current > 200
            ) {
              lastDurationPollRef.current = now;
              const d = pickBufferedAudioHint(audio);
              if (d > 0) {
                setDuration(d);
                syncMediaDurationSec(d);
              }
            }
            // 裁剪模式：到达 trimEnd 时暂停，仅播放截取范围
            if (showTrimRange && trimEnd > trimStart && t >= trimEnd) {
              audio.pause();
              audio.currentTime = trimEnd;
              setCurrentTime(trimEnd);
              syncPlayingState(false);
            } else {
              setCurrentTime(t);
            }
          }
        }}
        onEnded={() => {
          syncPlayingState(false);
          // 裁剪模式下到达 trimEnd 会由 timeupdate 处理，此处处理自然结束（如 trimEnd≈duration）
          if (showTrimRange && trimEnd > trimStart) {
            setCurrentTime(trimEnd);
          } else {
            setCurrentTime(0);
          }
        }}
      />
      
      {useWaveformMain ? (
        <div className="relative min-h-0 w-full flex-1 overflow-hidden">
          <div
            role="button"
            tabIndex={-1}
            aria-disabled={sourceLoadFailed}
            onClick={(e) => {
              e.stopPropagation();
              if (!sourceLoadFailed) void togglePlay();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className={`nodrag nopan absolute inset-0 z-[1] outline-none ${
              sourceLoadFailed ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            }`}
            title={
              sourceLoadFailed
                ? '音源不可用'
                : isPlaying
                  ? '点击暂停'
                  : '点击播放'
            }
            aria-label={
              sourceLoadFailed
                ? '音源不可用'
                : isPlaying
                  ? '点击暂停'
                  : '点击播放'
            }
          >
            <AudioWaveformVisualizer
              isPlaying={isPlaying}
              isDarkMode={isDarkMode}
              variant="main"
              fillContainer
              seed={playbackUrl || outputAudio}
              className="pointer-events-none nexflow-audio-waveform-fill"
            />
          </div>
          {controlsPortalEl && waveformControlsBar
            ? createPortal(
                <div
                  className="nodrag nopan w-full min-w-0"
                  style={{ pointerEvents: 'all' }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onWheel={(e) => e.stopPropagation()}
                >
                  {waveformControlsBar}
                  {controlsFooter}
                </div>,
                controlsPortalEl,
              )
            : controlsPortalEl === undefined && waveformControlsBar
              ? (
                <>
                  {waveformControlsBar}
                  {controlsFooter}
                </>
              )
              : null}
        </div>
      ) : (
      /* 自定义播放器：卡片区域可拖节点；进度条/音量等子控件单独 nodrag */
      <div
        className={`relative w-full rounded-xl select-none ${
          compact ? 'p-2' : 'p-3'
        } ${isDarkMode ? 'bg-white/5' : 'bg-gray-100/80'}`}
      >
        {slotLabel ? (
          <span
            className={`absolute top-1.5 left-1.5 z-[1] rounded px-1 py-0.5 text-[10px] font-semibold tabular-nums ${
              isDarkMode ? 'bg-black/40 text-white/70' : 'bg-white/80 text-gray-600'
            }`}
          >
            {slotLabel}
          </span>
        ) : null}
        <div className={`flex items-center gap-2 ${slotLabel ? 'pt-3' : ''}`}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              togglePlay();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className={`nodrag flex-shrink-0 flex items-center justify-center shadow-lg transition-all duration-150 active:scale-95 ${
              compact ? 'w-9 h-9 rounded-lg' : 'w-12 h-12 rounded-xl'
            } ${
              sourceLoadFailed ? (isDarkMode ? 'bg-white/10 text-white/50 cursor-not-allowed' : 'bg-gray-300 text-gray-500 cursor-not-allowed') : isPlaying
                ? isDarkMode ? 'bg-emerald-500/90 text-white hover:bg-emerald-500' : 'bg-emerald-500 text-white hover:bg-emerald-600'
                : isDarkMode ? 'bg-emerald-600/80 text-white hover:bg-emerald-500 border border-emerald-400/30' : 'bg-emerald-500 text-white hover:bg-emerald-600 border border-emerald-600/30'
            }`}
            title={sourceLoadFailed ? '音源不可用，请检查路径或重新选择文件' : (isPlaying ? '暂停' : '播放')}
            aria-label={sourceLoadFailed ? '音源不可用' : (isPlaying ? '暂停' : '播放')}
          >
            {isPlaying ? (
              <Pause className={`${compact ? 'w-4 h-4' : 'w-6 h-6'} flex-shrink-0`} strokeWidth={2.5} />
            ) : (
              <Play className={`${compact ? 'w-4 h-4 ml-0.5' : 'w-6 h-6 ml-0.5'} flex-shrink-0`} strokeWidth={2.5} />
            )}
          </button>

          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            {showTrimRange && displayDuration > 0 ? (
              <TrimRangeBar
                duration={displayDuration}
                currentTime={currentTime}
                trimStart={trimStart}
                trimEnd={trimEnd}
                isDarkMode={isDarkMode}
                audioRef={audioRef}
                setCurrentTime={setCurrentTime}
                onTrimRangeChange={onTrimRangeChange!}
              />
            ) : (
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
                  if (audioRef.current) {
                    audioRef.current.currentTime = newTime;
                    setCurrentTime(newTime);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className={`nodrag ${compact ? 'h-1.5' : 'h-2'} w-full ${displayDuration > 0 ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                style={{ accentColor: isDarkMode ? '#22c55e' : '#16a34a' }}
                aria-label="播放进度"
                title="点击或拖拽选择播放位置"
              />
            )}
            <div className="flex items-center justify-between">
              <span className={`${compact ? 'text-[10px]' : 'text-xs'} font-mono tabular-nums ${isDarkMode ? 'text-white/80' : 'text-gray-700'}`}>
                {formatAudioClock(currentTime)}
                {displayDuration > 0 ? ` / ${formatAudioClock(displayDuration)}` : ''}
                {showTrimRange && displayDuration > 0 && (
                  <span className={`ml-2 ${isDarkMode ? 'text-white/50' : 'text-gray-500'}`}>
                    裁剪: {formatAudioClock(trimStart)} - {formatAudioClock(trimEnd)}
                  </span>
                )}
              </span>
              <div
                className="nodrag flex items-center gap-1.5"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Volume2 className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} ${isDarkMode ? 'text-white/50' : 'text-gray-500'}`} />
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={handleVolumeChange}
                  className={`${compact ? 'w-10' : 'w-14'} h-1 cursor-pointer`}
                  aria-label="音量"
                  title="音量"
                  style={{ accentColor: isDarkMode ? '#22c55e' : '#16a34a' }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
};

const AudioNodeComponent: React.FC<AudioNodeProps> = (props) => {
  // 解构出 React Flow 专有属性，避免透传给 DOM
  const {
    id,
    data,
    selected,
    projectId,
    isDarkMode = true,
    performanceMode = false,
    onDataChange,
    syncAudioPanelReferenceUrl,
    onSeparateAllAudios,
    onAddAudioClipNodes,
    // React Flow 专有属性，不应传递给 DOM（显式解构以过滤）
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
    style: nodeStyleProp,
    // 确保不会透传任何其他 React Flow 内部属性
  } = props as any;
  console.log('[AudioNode Debug] Render with data:', data);
  const updateNodeInternals = useUpdateNodeInternals();
  const { setNodes, getNode, setEdges } = useReactFlow();
  
  const [outputAudio, setOutputAudio] = useState(data?.outputAudio || '');
  const [outputAudios, setOutputAudios] = useState<string[]>(
    Array.isArray(data?.outputAudios) && data.outputAudios.length > 0
      ? data.outputAudios.map((u) => normalizeAudioUrl(String(u || ''))).filter(Boolean)
      : [],
  );
  const [title, setTitle] = useState(data?.title || 'audio');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [errorMessage, setErrorMessage] = useState(data?.errorMessage || '');
  // 初始化状态：优先使用 data.aiStatus，否则根据 outputAudio 和 errorMessage 判断
  const getInitialStatus = (): 'idle' | 'START' | 'PROCESSING' | 'SUCCESS' | 'ERROR' => {
    if (data?.aiStatus) return data.aiStatus;
    if (data?.outputAudio) return 'SUCCESS';
    if (data?.errorMessage) return 'ERROR';
    return 'idle';
  };
  
  const [aiStatus, setAiStatus] = useState<'idle' | 'START' | 'PROCESSING' | 'SUCCESS' | 'ERROR'>(getInitialStatus());
  const [inputText, setInputText] = useState(data?.text || '');
  const [trimStartSec, setTrimStartSec] = useState('0');
  const [trimEndSec, setTrimEndSec] = useState('0');
  const [trimming, setTrimming] = useState(false);
  const [trimError, setTrimError] = useState<string | null>(null);
  const [showTrimModal, setShowTrimModal] = useState(false);
  const [isMediaPlaying, setIsMediaPlaying] = useState(false);
  
  // 调试日志
  useEffect(() => {
    console.log('[AudioNode] 状态更新:', {
      nodeId: id,
      aiStatus,
      outputAudio: !!outputAudio,
      errorMessage: !!errorMessage,
      inputText: !!inputText,
      dataAiStatus: data?.aiStatus,
    });
  }, [id, aiStatus, outputAudio, errorMessage, inputText, data?.aiStatus]);
  
  const nodeRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const prevOutputAudioRef = useRef<string>(''); // 用于跟踪音频 URL 变化
  const viewport = useFrozenFlowViewport();
  const isVisualInteractionLocked = useGlobalInteractionSelector((state) => state.isVisualInteractionLocked);
  const { locale } = useAppLocale();
  const wc = workspaceChromeT(locale);
  const anc = useMemo(() => audioNodeChromeT(locale), [locale]);
  const refMicAt = useMemo(() => audioInputPanelT(locale), [locale]);
  const showAlert = useDarkAlert().showAlert;

  // 当音频 URL 变化时，重置播放位置
  useEffect(() => {
    if (outputAudio && outputAudio !== prevOutputAudioRef.current && audioRef.current) {
      prevOutputAudioRef.current = outputAudio;
      // 重置音频播放位置
      const audio = audioRef.current;
      if (audio.readyState >= 2) {
        // 如果音频已经加载了元数据，立即重置
        audio.currentTime = 0;
      } else {
        // 如果还没有加载，等待加载完成后再重置
        const handleLoadedMetadata = () => {
          audio.currentTime = 0;
          audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
        };
        audio.addEventListener('loadedmetadata', handleLoadedMetadata);
      }
    }
  }, [outputAudio]);

  // 同步外部数据变化
  useEffect(() => {
    if (data?.outputAudio !== undefined) {
      // 格式化音频路径
      const formattedPath = normalizeAudioUrl(data.outputAudio);
      // 只有当 URL 真正变化时才更新，避免不必要的重新加载
      if (outputAudio !== formattedPath) {
        setOutputAudio(formattedPath);
      }
    }
    if (data?.outputAudios !== undefined) {
      const list = Array.isArray(data.outputAudios)
        ? data.outputAudios.map((u) => normalizeAudioUrl(String(u || ''))).filter(Boolean)
        : [];
      setOutputAudios((prev) => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list));
    }
    if (data?.title !== undefined) {
      setTitle(data.title);
    }
    if (data?.errorMessage !== undefined) {
      setErrorMessage(data.errorMessage);
    }
    if (data?.aiStatus !== undefined) {
      setAiStatus(data.aiStatus);
    } else if (data?.outputAudio) {
      // 如果有输出音频但没有状态，默认为 SUCCESS
      setAiStatus('SUCCESS');
    } else if (data?.errorMessage) {
      setAiStatus('ERROR');
    } else {
      setAiStatus('idle');
    }
    if (data?.text !== undefined) {
      setInputText(data.text);
    }
  }, [data?.outputAudio, data?.outputAudios, data?.title, data?.errorMessage, data?.aiStatus, data?.text, outputAudio]);

  // 双击标题进入编辑模式
  const handleTitleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const songLabel =
      isAudioSongModel(data?.model) ? String(data?.songName ?? '').trim() : '';
    setTitle(songLabel || title || anc.unnamedAudio);
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  }, [data?.model, data?.songName, title, anc.unnamedAudio]);

  // 更新节点数据
  const updateNodeData = useCallback((updates: Partial<AudioNodeData>) => {
    setNodes((nds) =>
      nds.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, ...updates } } : node
      )
    );
    if (onDataChange && (
      updates.outputAudio !== undefined ||
      updates.referenceAudioUrl !== undefined ||
      updates.mediaDurationSec !== undefined
    )) {
      onDataChange(id, updates as any);
    }
  }, [id, setNodes, onDataChange]);

  useEffect(() => {
    const styleW = parseFloat(String(nodeStyleProp?.width || '').replace('px', ''));
    const styleH = parseFloat(String(nodeStyleProp?.height || '').replace('px', ''));
    const rfW = typeof _width === 'number' && _width > 0 ? _width : styleW;
    const rfH = typeof _height === 'number' && _height > 0 ? _height : styleH;
    const needFix =
      data?.width !== AUDIO_NODE_WIDTH ||
      data?.height !== AUDIO_NODE_HEIGHT ||
      rfW !== AUDIO_NODE_WIDTH ||
      rfH !== AUDIO_NODE_HEIGHT;
    if (!needFix) return;
    setNodes((nds) =>
      nds.map((node) =>
        node.id === id
          ? {
              ...node,
              width: AUDIO_NODE_WIDTH,
              height: AUDIO_NODE_HEIGHT,
              style: {
                ...(node.style as object),
                ...nodeStyleDimensions(AUDIO_NODE_WIDTH, AUDIO_NODE_HEIGHT),
              },
              data: {
                ...node.data,
                width: AUDIO_NODE_WIDTH,
                height: AUDIO_NODE_HEIGHT,
              },
            }
          : node,
      ),
    );
    updateNodeInternals(id);
  }, [data?.width, data?.height, _width, _height, nodeStyleProp?.width, nodeStyleProp?.height, id, setNodes, updateNodeInternals]);

  const handleSeparateAllOutputAudios = useCallback(() => {
    const fromState = outputAudios.filter(Boolean);
    const fromData = Array.isArray(data?.outputAudios)
      ? data.outputAudios.map((u) => normalizeAudioUrl(String(u || ''))).filter(Boolean)
      : [];
    const urls = fromState.length > 1 ? fromState : fromData;
    if (urls.length <= 1) return;

    const originals = Array.isArray(data?.originalOutputAudios)
      ? [...data.originalOutputAudios]
      : undefined;
    const sourceNode = getNode(id);
    if (!sourceNode) return;

    const nodeW = AUDIO_NODE_WIDTH;
    const nodeH = AUDIO_NODE_HEIGHT;
    const GAP = 48;
    /** 右侧独立模块纵向排列：完整节点高度 + 间距，避免重叠 */
    const rowStep = nodeH + 24;
    const batchTs = Date.now();

    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    for (let i = 0; i < urls.length; i += 1) {
      const url = urls[i];
      if (!url?.trim()) continue;
      const origUrl = originals?.[i];
      const newNodeId = `audio-${batchTs}-${i}-${Math.random().toString(36).slice(2, 8)}`;
      newNodes.push({
        id: newNodeId,
        type: 'audio',
        position: {
          x: sourceNode.position.x + nodeW + GAP,
          y: sourceNode.position.y + i * rowStep,
        },
        selected: i === 0,
        width: nodeW,
        height: nodeH,
        data: {
          label: 'audio',
          outputAudio: url,
          originalAudioUrl: origUrl || url,
          title: `${title || anc.unnamedAudio} · ${anc.trackLabel(i + 1)}`,
          width: nodeW,
          height: nodeH,
          aiStatus: 'SUCCESS',
          audioSourceType: data?.audioSourceType,
          model: data?.model,
        },
        style: nodeStyleDimensions(nodeW, nodeH),
      });
      newEdges.push({
        id: `edge-${id}-${newNodeId}`,
        source: id,
        target: newNodeId,
        sourceHandle: 'output',
        targetHandle: 'audio-input',
        animated: false,
      });
    }

    if (newNodes.length === 0) return;

    const clearSourceData: Partial<AudioNodeData> = {
      outputAudio: '',
      originalAudioUrl: undefined,
      outputAudios: undefined,
      originalOutputAudios: undefined,
      aiStatus: 'idle',
      mediaDurationSec: undefined,
    };

    setOutputAudios([]);
    setOutputAudio('');

    const payload: AudioSeparateAllPayload = {
      sourceNodeId: id,
      newNodes,
      newEdges,
      clearSourceData,
    };

    if (onSeparateAllAudios) {
      onSeparateAllAudios(payload);
      return;
    }

    setNodes((nds) => {
      const updated = nds.map((n) => {
        if (n.id !== id) return { ...n, selected: false };
        return { ...n, data: { ...n.data, ...clearSourceData }, selected: false };
      });
      return [...updated, ...newNodes];
    });

    setEdges((eds) => {
      let next = eds;
      for (const edge of newEdges) {
        next = addEdge(edge, next);
      }
      return next;
    });

    if (onDataChange) {
      onDataChange(id, clearSourceData);
    }
  }, [outputAudios, data, id, getNode, setNodes, setEdges, onDataChange, onSeparateAllAudios, title, anc]);

  /** 主进程 ffmpeg 探测完整时长，写入 mediaDurationSec 供剪辑轨道同步 */
  useEffect(() => {
    const raw = String(data?.outputAudio || outputAudio || data?.referenceAudioUrl || '').trim();
    if (!raw) return;
    let cancelled = false;
    (async () => {
      const url = normalizeAudioUrl(raw);
      const dur = await probeAudioMediaDurationSec(url, projectId);
      if (cancelled || dur <= 0) return;
      const existing = Number(data?.mediaDurationSec);
      if (Number.isFinite(existing) && Math.abs(existing - dur) < 0.05) return;
      updateNodeData({ mediaDurationSec: dur });
    })();
    return () => {
      cancelled = true;
    };
  }, [data?.outputAudio, outputAudio, data?.referenceAudioUrl, projectId, updateNodeData]);

  const onReferenceRecorded = useCallback(
    (url: string, durationSec?: number) => {
      const u = (url || '').trim();
      if (!u) return;
      setOutputAudio(u);
      updateNodeData({
        referenceAudioUrl: u,
        outputAudio: u,
        originalAudioUrl: undefined,
        errorMessage: undefined,
        ...(durationSec != null && durationSec > 0 ? { mediaDurationSec: durationSec } : {}),
      });
      setAiStatus('SUCCESS');
      syncAudioPanelReferenceUrl?.(u);
      if (durationSec != null && durationSec > 0) {
        setTrimStartSec('0');
        setTrimEndSec(String(Math.round(durationSec * 10) / 10));
      }
    },
    [updateNodeData, syncAudioPanelReferenceUrl],
  );

  const refMicStrings = useMemo(
    () => ({
      micPermissionDenied: refMicAt.micPermissionDenied,
      micSaveFailed: refMicAt.micSaveFailed,
      recordTooShort: refMicAt.recordTooShort,
      recordModalTitle: wc.textVoiceModalTitle,
      recordModalSubtitle: wc.textVoiceModalSubtitle,
      recordModalStop: refMicAt.recordModalStop,
    }),
    [refMicAt, wc],
  );

  const [refMicSaving, setRefMicSaving] = useState(false);
  const refMicHoldingRef = useRef(false);
  const refMicSavingRef = useRef(false);
  refMicSavingRef.current = refMicSaving;

  const {
    isRecording: isRecordingRefMic,
    isRecordingRef: isRecordingActiveRef,
    inputLevel: refMicInputLevel,
    startReferenceRecording,
    stopReferenceRecording,
  } = useReferenceMicRecording({
    projectId,
    onSaved: (url, durationSec) => {
      setRefMicSaving(false);
      onReferenceRecorded(url, durationSec);
    },
    onRecordingFailed: () => {
      setRefMicSaving(false);
    },
    showAlert,
    strings: refMicStrings,
    isDarkMode,
    shouldAbortAfterMic: () => !refMicHoldingRef.current,
  });

  const startReferenceRecordingRef = useRef(startReferenceRecording);
  startReferenceRecordingRef.current = startReferenceRecording;
  const stopReferenceRecordingRef = useRef(stopReferenceRecording);
  stopReferenceRecordingRef.current = stopReferenceRecording;

  const refMicPttHandlers = useMemo(
    () =>
      bindPushToTalkPointerHandlers({
        onPressStart: () => {
          if (refMicSavingRef.current) return;
          refMicHoldingRef.current = true;
          void startReferenceRecordingRef.current();
        },
        onPressEnd: () => {
          const wasHolding = refMicHoldingRef.current;
          refMicHoldingRef.current = false;
          if (!wasHolding) return;
          if (isRecordingActiveRef.current) {
            setRefMicSaving(true);
            stopReferenceRecordingRef.current();
          }
        },
        disabled: () => refMicSavingRef.current,
      }),
    [isRecordingActiveRef],
  );

  useEffect(() => {
    if (!isRecordingRefMic && !refMicSaving) return;
    acquireVoiceModalLock();
    return () => releaseVoiceModalLock();
  }, [isRecordingRefMic, refMicSaving]);

  const handleTrimConfirm = useCallback(async (overrideStart?: number, overrideEnd?: number) => {
    const start = overrideStart ?? parseFloat(trimStartSec);
    const end = overrideEnd ?? parseFloat(trimEndSec);
    if (isNaN(start) || isNaN(end) || start < 0 || end <= start) {
      setTrimError('请填写有效的起始和结束时间（结束时间须大于起始时间）');
      return;
    }
    const audioUrl = data?.outputAudio || outputAudio || data?.referenceAudioUrl || '';
    if (!audioUrl) {
      setTrimError('无可用音频');
      return;
    }
    if (!window.electronAPI?.trimAudio) {
      setTrimError('当前环境不支持裁剪');
      return;
    }
    setTrimError(null);
    setTrimming(true);
    try {
      const res = await window.electronAPI.trimAudio(projectId || undefined, audioUrl, start, end);
      if (!res?.audioUrl) {
        setTrimError('裁剪未返回结果');
        return;
      }
      const newDur = Math.max(0.1, end - start);
      const sourceNode = getNode(id);
      const GAP = 48;
      const nodeW = AUDIO_NODE_WIDTH;
      const nodeH = AUDIO_NODE_HEIGHT;
      const baseX = (sourceNode?.position.x ?? xPos) + nodeW + GAP;
      const baseY = sourceNode?.position.y ?? yPos;
      const newNodeId = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const clipTitle = locale === 'en' ? 'Trimmed clip' : '裁剪片段';
      const newNode: Node = {
        id: newNodeId,
        type: 'audio',
        position: { x: baseX, y: baseY },
        selected: true,
        width: nodeW,
        height: nodeH,
        data: {
          label: 'audio',
          title: clipTitle,
          outputAudio: res.audioUrl,
          originalAudioUrl: res.audioUrl,
          mediaDurationSec: newDur,
          width: nodeW,
          height: nodeH,
          aiStatus: 'SUCCESS',
          audioSourceType: data?.audioSourceType,
          model: data?.model,
          errorMessage: undefined,
        },
        style: nodeStyleDimensions(nodeW, nodeH),
      };
      const edge: Edge = {
        id: `e-${id}-${newNodeId}`,
        source: id,
        target: newNodeId,
        sourceHandle: 'output',
        targetHandle: 'audio-input',
        animated: false,
      };
      if (onAddAudioClipNodes) {
        onAddAudioClipNodes({ nodes: [newNode], edges: [edge] });
      } else {
        // 兜底：写入 React Flow（受控画布下可能被 Workspace 覆盖，优先走 onAddAudioClipNodes）
        setNodes((nds) => nds.map((n) => ({ ...n, selected: false })).concat(newNode));
        setEdges((eds) => addEdge(edge, eds));
        console.warn('[AudioNode] onAddAudioClipNodes 未注入，已用本地 setNodes 兜底');
      }
      setShowTrimModal(false);
    } catch (err: any) {
      const msg = err?.message || '裁剪失败';
      console.error('[AudioNode] 裁剪失败:', err);
      setTrimError(msg);
    } finally {
      setTrimming(false);
    }
  }, [
    trimStartSec,
    trimEndSec,
    data?.outputAudio,
    outputAudio,
    data?.referenceAudioUrl,
    data?.audioSourceType,
    data?.model,
    projectId,
    id,
    xPos,
    yPos,
    getNode,
    setNodes,
    setEdges,
    onAddAudioClipNodes,
    locale,
  ]);

  const handleUploadReferenceAudio = useCallback(async () => {
    if (typeof window.electronAPI?.showOpenAudioDialog !== 'function') return;
    const res = await window.electronAPI.showOpenAudioDialog();
    if (res.success && res.filePath) {
      let path = res.filePath.replace(/\\/g, '/');
      if (path.match(/^[a-zA-Z]\//)) path = path[0].toUpperCase() + ':' + path.substring(1);
      else if (path.match(/^[a-zA-Z]:\//)) path = path[0].toUpperCase() + path.substring(1);
      const url = normalizeAudioUrl(`local-resource://${path}`);
      updateNodeData({ referenceAudioUrl: url });
    }
  }, [updateNodeData]);

  const handleDownloadAudio = useCallback(async () => {
    const localUrl = (outputAudio || data?.outputAudio || '').trim();
    const remoteUrl = (data?.originalAudioUrl || '').trim();
    const sourceUrl = localUrl || remoteUrl;
    if (!sourceUrl || !window.electronAPI?.downloadAudio) return;

    const suggestedName = buildMusicDownloadSuggestedName({
      model: data?.model,
      songName: data?.songName,
      fallbackTitle: title,
      audioUrl: remoteUrl || localUrl,
    });

    try {
      let downloadUrl = sourceUrl;
      if (localUrl.startsWith('local-resource://') && projectId) {
        downloadUrl = await mapProjectPath(localUrl, projectId);
      } else if (localUrl) {
        downloadUrl = localUrl;
      }

      const result = await window.electronAPI.downloadAudio(downloadUrl, suggestedName);
      if (!result.success && result.error && !result.error.includes('取消')) {
        console.warn('[AudioNode] 下载失败:', result.error);
      }
    } catch (err) {
      console.error('[AudioNode] 下载失败:', err);
    }
  }, [outputAudio, data?.outputAudio, data?.originalAudioUrl, data?.songName, title, projectId]);

  const zoom = viewport.zoom ?? 1;
  const vx = viewport.x ?? 0;
  const vy = viewport.y ?? 0;
  const lodLevel = useMemo<'far' | 'mid' | 'near'>(() => {
    if (zoom < ZOOM_THRESHOLD_FAR) return 'far';
    if (zoom < ZOOM_THRESHOLD_NEAR) return 'mid';
    return 'near';
  }, [zoom]);
  const showDetailedUi = lodLevel === 'near';
  const hasMultiOutputAudios = outputAudios.length > 1;
  const hasPlayableAudio = !!(data?.outputAudio || outputAudio || data?.referenceAudioUrl || hasMultiOutputAudios);
  const isHardFrozen = useMemo(() => {
    if (!performanceMode || selected || dragging) return false;
    const viewportLeft = -vx / zoom;
    const viewportTop = -vy / zoom;
    const viewportWidth = (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom;
    const viewportHeight = (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom;
    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const nodeRight = xPos + AUDIO_NODE_WIDTH;
    const nodeBottom = yPos + AUDIO_NODE_HEIGHT;
    const intersects = !(nodeRight < viewportLeft || xPos > viewportRight || nodeBottom < viewportTop || yPos > viewportBottom);
    if (intersects) return false;
    const distX = nodeRight < viewportLeft ? (viewportLeft - nodeRight) : (xPos > viewportRight ? xPos - viewportRight : 0);
    const distY = nodeBottom < viewportTop ? (viewportTop - nodeBottom) : (yPos > viewportBottom ? yPos - viewportBottom : 0);
    return distX > viewportWidth * 2 || distY > viewportHeight * 2;
  }, [performanceMode, selected, dragging, vx, vy, zoom, xPos, yPos]);
  /** 选中或拖动中始终显示完整内容（避免远缩放/冻结 LOD 在移动画布时把节点变成空白，与图二一致） */
  const showSelectedChrome = selected || dragging;
  /** 有可播放音频时不切占位，避免平移/缩放画布时卸载 <audio> 打断播放 */
  const showPlaceholder =
    !hasPlayableAudio &&
    ((isHardFrozen || lodLevel === 'far') && !showSelectedChrome);
  const hasDownloadableAudio = !!(outputAudio || data?.outputAudio || data?.originalAudioUrl);
  const hasTrimmableAudio = !hasMultiOutputAudios && !!(data?.outputAudio || outputAudio || data?.referenceAudioUrl);
  const musicSongName =
    isAudioSongModel(data?.model) ? String(data?.songName ?? '').trim() : '';
  const isCoverModule = isAudioCoverModel(data?.model);
  const genericAudioTitle =
    !title || title === 'audio' || title === '声音节点' || title === '翻唱' || title === 'AI Cover';
  const nodeHeaderLabel =
    musicSongName ||
    (isCoverModule && genericAudioTitle ? anc.coverModuleLabel : title) ||
    anc.unnamedAudio;

  const [playerControlsHost, setPlayerControlsHost] = useState<HTMLElement | null>(null);
  /** 选中、拖动或播放中：显示上下外挂控件 */
  const showNodeChrome = showSelectedChrome || isMediaPlaying;
  const showExternalPlayerControls = hasPlayableAudio && !showPlaceholder && showNodeChrome;
  const spaceKeyboardActive =
    selected &&
    hasPlayableAudio &&
    !showPlaceholder &&
    !showTrimModal &&
    !isRecordingRefMic &&
    !refMicSaving;
  const showFloatingTopActions = !showPlaceholder && showNodeChrome;
  // 镜头拉远：随画布缩小；拉近：反缩放，避免操作栏撑满屏幕
  const zoomInv = Math.min(1, 1 / Math.max(zoom || 1, 0.01));
  const audioPromptAnchor = useAudioInputPanelAnchor();
  const showAudioPromptPanel =
    !!audioPromptAnchor && audioPromptAnchor.nodeId === id && !!selected;

  /** 与视频/图片模块同款：顶部玻璃胶囊内图标按钮；录制中走绿色话筒态 */
  const topToolbarIconBtn = (active = false, extra = '', opts?: { micRecording?: boolean }) => {
    const base =
      'nodrag inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-35';
    if (opts?.micRecording) {
      return `${base} nexflow-voice-mic-btn listening border border-transparent ${extra}`.trim();
    }
    if (isDarkMode) {
      return `${base} ${
        active ? 'bg-white/15 text-white' : 'bg-transparent text-white/80 hover:bg-white/10 hover:text-white'
      } ${extra}`.trim();
    }
    return `${base} ${
      active ? 'bg-black/10 text-gray-900' : 'bg-transparent text-gray-700 hover:bg-black/[0.06] hover:text-gray-900'
    } ${extra}`.trim();
  };

  useEffect(() => {
    if (!showExternalPlayerControls) {
      setPlayerControlsHost(null);
    }
  }, [showExternalPlayerControls]);

  useLayoutEffect(() => {
    const rfNode = shellRef.current?.closest('.react-flow__node') as HTMLElement | null;
    if (!rfNode) return;
    rfNode.style.width = `${AUDIO_NODE_WIDTH}px`;
    rfNode.style.height = `${AUDIO_NODE_HEIGHT}px`;
    rfNode.style.maxWidth = `${AUDIO_NODE_WIDTH}px`;
    rfNode.style.maxHeight = `${AUDIO_NODE_HEIGHT}px`;
    updateNodeInternals(id);
  }, [id, updateNodeInternals, showNodeChrome, showExternalPlayerControls, showPlaceholder, isMediaPlaying]);

  return (
    <>
      <div
        ref={shellRef}
        className="nexflow-audio-node-shell relative"
        style={{
          width: AUDIO_NODE_WIDTH,
          height: AUDIO_NODE_HEIGHT,
          maxWidth: AUDIO_NODE_WIDTH,
          maxHeight: AUDIO_NODE_HEIGHT,
        }}
      >
      <div
        ref={nodeRef}
        data-id={id}
        className={`custom-node-container group absolute inset-0 flex h-full w-full min-h-0 flex-col overflow-visible rounded-2xl ${
          isDarkMode
            ? 'nexflow-glass-panel'
            : 'apple-panel-light' /* 使用磨砂材质浅灰半透明背板 */
        } ${showSelectedChrome && !isMediaPlaying && isDarkMode ? 'ring-2 ring-green-400/80' : ''} ${showSelectedChrome && !isMediaPlaying && !isDarkMode ? 'ring-2 ring-green-500' : ''}`}
        style={{
          width: AUDIO_NODE_WIDTH,
          height: AUDIO_NODE_HEIGHT,
          userSelect: 'auto',
          willChange: dragging ? 'transform' : 'auto',
          transition: 'all 0.2s ease',
        }}
        onClickCapture={() => {
          if (!isCanvasPickVoiceTarget()) return;
          const pickable =
            !!(outputAudio || data?.outputAudio || data?.originalAudioUrl || data?.referenceAudioUrl);
          if (!pickable) return;
          dispatchCanvasPickNode(id);
        }}
      >
        <Handle type="target" position={Position.Left} id="audio-input" className={`nexflow-plus-handle nexflow-plus-handle-left ${showPlaceholder ? 'opacity-0 pointer-events-none' : ''}`} />
        <Handle type="source" position={Position.Right} id="output" className={`nexflow-plus-handle nexflow-plus-handle-right ${showPlaceholder ? 'opacity-0 pointer-events-none' : ''}`} />

        {showPlaceholder ? (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center justify-center gap-1">
              <AudioLines className={`w-4 h-4 ${isDarkMode ? 'text-white/65' : 'text-gray-500'}`} />
              <span className={`text-[10px] font-medium ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>
                {isHardFrozen ? `${nodeHeaderLabel}（冻结）` : nodeHeaderLabel}
              </span>
            </div>
          </div>
        ) : (
        <>
        <div className="absolute inset-0 overflow-hidden rounded-2xl">
        {isMediaPlaying ? (
          <div
            className="nexflow-media-playing-glow pointer-events-none absolute inset-0 z-0 rounded-2xl"
            aria-hidden
          />
        ) : null}
        {/* 全模块覆盖进度条（音频合成/生成中时纯色遮罩，不显示其他内容） */}
        <ModuleProgressBar
          visible={aiStatus === 'START' || aiStatus === 'PROCESSING' || (typeof data?.progress === 'number' && data.progress > 0)}
          progress={data?.progress ?? 0}
          solidBackground={isDarkMode ? '#1C1C1E' : '#f5f5f5'}
          progressMessage={data?.progressMessage || wc.progressAudio}
          borderRadius={16}
          onFadeComplete={() => updateNodeData({ progress: 0 })}
        />

        {/* 音频内容显示区域 - 有生成结果或上传的参考音时显示播放器，支持试听 */}
        <div
          key={data?.updatedAt || 'initial'}
          className="nexflow-audio-node-body absolute inset-0 z-[1] flex min-h-0 w-full flex-col items-stretch overflow-hidden p-0"
        >
          {(hasMultiOutputAudios || data?.outputAudio || outputAudio) ? (
            <AiGeneratedBadge isDarkMode={isDarkMode} />
          ) : null}
          {hasMultiOutputAudios ? (
            <AudioMultiOutputMainPlayer
              urls={outputAudios}
              originalUrls={Array.isArray(data?.originalOutputAudios) ? data.originalOutputAudios : undefined}
              isDarkMode={isDarkMode}
              nodeId={id}
              data={data}
              projectId={projectId}
              chrome={anc}
              setOutputAudio={setOutputAudio}
              updateNodeData={updateNodeData}
              onPlayingChange={setIsMediaPlaying}
              controlsPortalEl={playerControlsHost}
              spaceKeyboardActive={spaceKeyboardActive}
            />
          ) : (data?.outputAudio || outputAudio || data?.referenceAudioUrl) ? (
            <AudioPlayerComponent
              nodeId={id}
              audioRef={audioRef}
              outputAudio={data?.outputAudio || outputAudio || data?.referenceAudioUrl || ''}
              data={data}
              isDarkMode={isDarkMode}
              projectId={projectId}
              setOutputAudio={setOutputAudio}
              updateNodeData={updateNodeData}
              onPlayingChange={setIsMediaPlaying}
              layoutVariant="waveform"
              controlsPortalEl={playerControlsHost}
              spaceKeyboardActive={spaceKeyboardActive}
              showTrimRange={false}
              trimStart={parseFloat(trimStartSec) || 0}
              trimEnd={parseFloat(trimEndSec) || 0}
              onTrimRangeChange={(start, end) => {
                setTrimStartSec(String(Math.round(start * 10) / 10));
                setTrimEndSec(String(Math.round(end * 10) / 10));
              }}
            />
          ) : aiStatus === 'ERROR' || errorMessage ? (
            // 错误状态：显示错误信息
            <div className="flex flex-col items-center justify-center gap-3 p-4">
              <div className={`text-2xl ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
                ⚠️
              </div>
              <p className={`text-sm font-semibold text-center ${isDarkMode ? 'text-red-300' : 'text-red-700'}`}>
                {wc.genFailedTitle}
              </p>
              <p className={`text-xs text-center line-clamp-3 ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`}>
                {userFacingErrorMessage(errorMessage, locale) ||
                  (locale === 'en' ? 'Audio generation failed. Try again.' : '音频生成失败，请稍后重试')}
              </p>
              {!isCoverModule &&
              !messageContainsRefundHint(
                userFacingErrorMessage(errorMessage, locale) ||
                  (locale === 'en' ? 'Audio generation failed. Try again.' : '音频生成失败，请稍后重试'),
              ) ? (
                <p className={`text-[11px] text-center ${isDarkMode ? 'text-amber-400/90' : 'text-amber-700'}`}>
                  {refundHintForLocale(locale)}
                </p>
              ) : null}
            </div>
          ) : aiStatus === 'START' || aiStatus === 'PROCESSING' ? (
            // 生成中状态：显示 Loading 动画
            <div className="flex flex-col items-center justify-center gap-3 p-4">
              <Loader2 className={`w-6 h-6 ${isVisualInteractionLocked ? '' : 'animate-spin'} ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`} />
              <p className={`text-xs text-center ${isDarkMode ? 'text-white/50' : 'text-gray-500'}`}>
                {wc.pleaseWait}
              </p>
            </div>
          ) : (
            // 初始状态（Idle）：显示提示信息（不显示连线内容）
            <div className="flex flex-col items-center justify-center gap-3 p-4">
              <Mic className={`w-8 h-8 ${isDarkMode ? 'text-white/40' : 'text-gray-400'}`} />
              <p className={`text-sm font-medium text-center ${isDarkMode ? 'text-white/80' : 'text-gray-700'}`}>
                {inputText ? anc.connectedLine1 : anc.connectLine1}
              </p>
              <p className={`text-xs text-center ${isDarkMode ? 'text-white/50' : 'text-gray-500'}`}>
                {inputText ? anc.connectedLine2 : anc.connectLine2}
              </p>
            </div>
          )}
        </div>

        </div>

        </>
        )}

        {/* 对齐 Image/Video：操作台贴主模块下方，随节点平移/缩放 */}
        {showAudioPromptPanel && audioPromptAnchor ? (
          <div
            className="audio-text-prompt-panel nodrag nopan absolute z-[60]"
            style={{
              top: showExternalPlayerControls ? 'calc(100% + 48px)' : 'calc(100% + 8px)',
              left: '50%',
              width: audioPromptAnchor.width,
              height: audioPromptAnchor.height === 'auto' ? 'auto' : audioPromptAnchor.height,
              transform: `translateX(-50%) scale(${zoomInv})`,
              transformOrigin: 'top center',
              pointerEvents: 'auto',
              transition: 'none',
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          >
            {audioPromptAnchor.panel}
          </div>
        ) : null}
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
                  const trimmed = title.trim();
                  if (isAudioSongModel(data?.model)) {
                    if ((data?.songName ?? '') !== trimmed || (data?.title ?? '') !== trimmed) {
                      updateNodeData({ songName: trimmed, title: trimmed });
                    }
                  } else if (data?.title !== trimmed) {
                    updateNodeData({ title: trimmed });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setIsEditingTitle(false);
                    const trimmed = title.trim();
                    if (isAudioSongModel(data?.model)) {
                      if ((data?.songName ?? '') !== trimmed || (data?.title ?? '') !== trimmed) {
                        updateNodeData({ songName: trimmed, title: trimmed });
                      }
                    } else if (data?.title !== trimmed) {
                      updateNodeData({ title: trimmed });
                    }
                  }
                  if (e.key === 'Escape') {
                    setIsEditingTitle(false);
                    const songLabel =
                      isAudioSongModel(data?.model) ? String(data?.songName ?? '').trim() : '';
                    setTitle(songLabel || data?.title || anc.unnamedAudio);
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
                title={nodeHeaderLabel}
              >
                {nodeHeaderLabel}
              </span>
            )}
          </div>
        ) : null}

        {showFloatingTopActions ? (
          <div
            className={[
              'node-floating-toolbar nodrag nopan absolute bottom-[calc(100%+36px)] left-1/2 z-20',
              'flex w-max max-w-[min(560px,calc(100vw-2rem))] flex-wrap items-center justify-center gap-1',
              'overflow-visible rounded-full px-2 py-1.5',
              isDarkMode
                ? 'nexflow-glass-panel border border-white/[0.14] shadow-[0_8px_28px_rgba(0,0,0,0.28)]'
                : 'apple-panel-light border border-black/[0.08] shadow-[0_8px_28px_rgba(0,0,0,0.06)]',
            ].join(' ')}
            style={{
              pointerEvents: 'all',
              transform: `translateX(-50%) scale(${zoomInv})`,
              transformOrigin: 'bottom center',
              transition: 'none',
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          >
            {showNodeChrome ? (
              <button
                type="button"
                {...refMicPttHandlers}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                disabled={refMicSaving}
                style={{
                  touchAction: 'none',
                  ...(isRecordingRefMic ? micLevelCssVars(refMicInputLevel) : {}),
                }}
                className={topToolbarIconBtn(
                  isRecordingRefMic,
                  refMicSaving ? 'cursor-wait opacity-70' : '',
                  { micRecording: isRecordingRefMic },
                )}
                title={
                  refMicSaving
                    ? refMicAt.recordModalStop
                    : isRecordingRefMic
                      ? refMicAt.stopRecordingButton
                      : refMicAt.recordReferenceTitle
                }
                aria-label={refMicAt.recordReferenceAria}
              >
                <VoiceMicGlyph
                  size="md"
                  busy={refMicSaving}
                  active={isRecordingRefMic}
                  level={refMicInputLevel}
                />
              </button>
            ) : null}
            {hasDownloadableAudio ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  handleDownloadAudio();
                }}
                className={topToolbarIconBtn()}
                title="下载"
                aria-label="下载"
              >
                <Download className="h-4 w-4 shrink-0" />
              </button>
            ) : null}
            {hasTrimmableAudio ? (
              <button
                type="button"
                disabled={trimming}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (trimming) return;
                  setTrimError(null);
                  setShowTrimModal((v) => !v);
                }}
                className={topToolbarIconBtn(showTrimModal, trimming ? '!opacity-50' : '')}
                title={anc.trimButtonTitle}
                aria-label={anc.trimButton}
                aria-pressed={showTrimModal}
              >
                {trimming ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <Scissors className="h-4 w-4 shrink-0" strokeWidth={2.25} />
                )}
              </button>
            ) : null}
            {showDetailedUi && showNodeChrome ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  handleUploadReferenceAudio();
                }}
                className={topToolbarIconBtn()}
                title="上传参考音（用于 Index-TTS2 配音）"
                aria-label="上传参考音"
              >
                <Upload className="h-4 w-4 shrink-0" />
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

        {showTrimModal ? (
          <div
            className={`nodrag nopan pointer-events-auto absolute left-1/2 z-30 -translate-x-1/2 ${
              showExternalPlayerControls ? 'top-full mt-[calc(2.85rem+3mm)]' : 'top-full mt-1.5'
            }`}
            style={{ width: Math.round(Math.max(AUDIO_NODE_WIDTH, 320) * 1.5) }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <AudioTrimInlineBar
              audioUrl={data?.outputAudio || outputAudio || data?.referenceAudioUrl || ''}
              isDarkMode={isDarkMode}
              initialTrimStart={parseFloat(trimStartSec) || 0}
              initialTrimEnd={parseFloat(trimEndSec) || 0}
              trimming={trimming}
              trimError={trimError}
              c={anc}
              onConfirm={(start, end) => {
                setTrimStartSec(String(start));
                setTrimEndSec(String(end));
                void handleTrimConfirm(start, end);
              }}
              onCancel={() => !trimming && setShowTrimModal(false)}
            />
          </div>
        ) : null}

        {showNodeChrome && hasMultiOutputAudios ? (
          <div
            className={`nodrag nopan pointer-events-auto absolute top-full left-0 right-0 z-20 flex justify-center px-1 ${
              showExternalPlayerControls
                ? 'mt-[calc(2.85rem+3mm)]'
                : 'mt-1.5'
            }`}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                handleSeparateAllOutputAudios();
              }}
              className={`nodrag bg-transparent py-0.5 text-center text-[10px] font-medium transition-opacity hover:opacity-90 ${
                isDarkMode ? 'text-violet-300/85 hover:text-violet-200' : 'text-violet-700 hover:text-violet-900'
              }`}
              title={anc.separateAllToNodes}
            >
              {anc.separateAllToNodes}
            </button>
          </div>
        ) : null}

        {trimError && showSelectedChrome && !showTrimModal ? (
          <div className="nodrag nopan pointer-events-auto absolute -bottom-20 left-0 right-0 z-10 flex justify-center">
            <div className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-xs">
              {trimError}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
};

export const AudioNode = memo(AudioNodeComponent);
AudioNode.displayName = 'AudioNode';
