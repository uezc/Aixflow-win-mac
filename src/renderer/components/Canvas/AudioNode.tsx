// @ts-nocheck
import React, { useState, useRef, useEffect, useCallback, memo, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeProps, useReactFlow, useUpdateNodeInternals, useStoreApi, useViewport } from 'reactflow';
import { Loader2, Mic, Play, Pause, Volume2, Upload, AudioLines, Scissors, Download } from 'lucide-react';
import { normalizeVideoUrl } from '../../utils/normalizeVideoUrl';
import { probeAudioMediaDurationSec } from '../../utils/timelineSourceMedia';
import { ModuleProgressBar } from './ModuleProgressBar';
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
import { isAudioSongModel, buildMusicDownloadSuggestedName } from '../../utils/audioSongModels';
import { setAudioNodePlaying } from '../../utils/audioNodePlaybackStore';
import { dispatchCanvasPickNode, isCanvasPickVoiceTarget } from '../../utils/canvasPickStore';

interface AudioNodeData {
  width?: number;
  height?: number;
  outputAudio?: string;
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

  const trackBg = isDarkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
  const selectedColor = isDarkMode ? '#22c55e' : '#16a34a';
  const playedColor = isDarkMode ? 'rgba(34,197,94,0.45)' : 'rgba(22,163,74,0.45)';

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

// 全屏背景虚化的音频裁剪专属弹窗
const AudioTrimModal: React.FC<{
  audioUrl: string;
  isDarkMode: boolean;
  initialTrimStart: number;
  initialTrimEnd: number;
  onConfirm: (trimStart: number, trimEnd: number) => void;
  onCancel: () => void;
  trimming: boolean;
  c: AudioNodeChromeStrings;
}> = ({ audioUrl, isDarkMode, initialTrimStart, initialTrimEnd, onConfirm, onCancel, trimming, c }) => {
  const modalAudioRef = useRef<HTMLAudioElement>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [trimStart, setTrimStart] = useState(initialTrimStart);
  const [trimEnd, setTrimEnd] = useState(initialTrimEnd);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);

  const playbackUrl = useMemo(() => normalizeAudioUrl(audioUrl), [audioUrl]);

  useEffect(() => {
    setTrimStart(initialTrimStart);
    setTrimEnd(initialTrimEnd);
  }, [initialTrimStart, initialTrimEnd]);

  useEffect(() => {
    if (duration > 0 && (trimEnd <= 0 || trimEnd > duration)) {
      setTrimEnd(duration);
    }
  }, [duration, trimEnd]);

  const togglePlay = useCallback(() => {
    const el = modalAudioRef.current;
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
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-xl"
      onClick={(e) => { if (e.target === e.currentTarget && !trimming) onCancel(); }}
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
          <div className="mb-5">
            <div className="flex items-center gap-2.5">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                  isDarkMode ? 'bg-emerald-500/15 text-emerald-400' : 'bg-emerald-100 text-emerald-600'
                }`}
              >
                <AudioLines className="h-5 w-5" strokeWidth={2.25} />
              </span>
              <h3 className="text-base font-semibold tracking-tight">{c.trimModalTitle}</h3>
            </div>
            <p className={`mt-2 pl-[46px] text-xs leading-relaxed ${isDarkMode ? 'text-white/45' : 'text-gray-500'}`}>
              {c.trimModalHint}
            </p>
          </div>
          <audio
            ref={modalAudioRef}
            src={playbackUrl}
            preload="metadata"
            className="hidden"
            onLoadedMetadata={(e) => {
              const el = e.currentTarget;
              const d = pickFiniteAudioDuration(el);
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
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={togglePlay}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/25 transition-colors hover:bg-emerald-400"
              title={isPlaying ? '暂停' : '播放'}
              aria-label={isPlaying ? '暂停' : '播放'}
            >
              {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
            </button>
            <div className="min-w-0 flex-1 pt-1">
              <TrimRangeBar
                duration={duration}
                currentTime={currentTime}
                trimStart={trimStart}
                trimEnd={trimEnd}
                isDarkMode={isDarkMode}
                audioRef={modalAudioRef}
                setCurrentTime={setCurrentTime}
                onTrimRangeChange={handleTrimChange}
              />
            </div>
          </div>
          <div className="mt-4 flex items-end justify-between gap-4">
            <div className={`text-sm font-mono leading-snug ${isDarkMode ? 'text-white/90' : 'text-gray-800'}`}>
              <span>{formatAudioClock(currentTime)}</span>
              {duration > 0 ? (
                <span className={isDarkMode ? 'text-white/35' : 'text-gray-400'}>
                  {` / ${formatAudioClock(duration)}`}
                </span>
              ) : null}
              <span className={`ml-2 ${isDarkMode ? 'text-white/50' : 'text-gray-500'}`}>
                {c.trimRangeLabel(formatAudioClock(trimStart), formatAudioClock(trimEnd))}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Volume2 className={`h-4 w-4 ${isDarkMode ? 'text-white/40' : 'text-gray-400'}`} />
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setVolume(v);
                  if (modalAudioRef.current) modalAudioRef.current.volume = v;
                }}
                className={`h-1.5 w-20 cursor-pointer appearance-none rounded-full ${
                  isDarkMode ? 'bg-white/15 accent-emerald-500' : 'bg-gray-200 accent-emerald-600'
                }`}
                title="音量"
                aria-label="音量"
              />
            </div>
          </div>
        </div>
        <div
          className={`flex justify-end gap-4 border-t px-6 py-4 ${
            isDarkMode ? 'border-white/[0.08]' : 'border-gray-200'
          }`}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={trimming}
            className={`px-1 py-2 text-sm font-medium transition-colors disabled:opacity-40 ${
              isDarkMode ? 'text-white/65 hover:text-white' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {c.cancel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={trimming || trimEnd <= trimStart}
            className="flex min-w-[88px] items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {trimming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {trimming ? c.trimming : c.confirm}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

// 与视频一致：统一使用 normalizeVideoUrl，得到 local-resource://C:/path 格式，避免二次编码和 404
const normalizeAudioUrl = (url: string): string => {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('data:')) return url;
  return normalizeVideoUrl(url);
};

// 音频播放器组件（用于 AudioNode，暗黑模式使用图二样式）
const AudioPlayerComponent: React.FC<{
  nodeId: string;
  audioRef: React.RefObject<HTMLAudioElement>;
  outputAudio: string;
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
}> = ({ nodeId, audioRef, outputAudio, data, isDarkMode, projectId, setOutputAudio, updateNodeData, showTrimRange, trimStart = 0, trimEnd = 0, onTrimRangeChange, onPlayingChange }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [sourceLoadFailed, setSourceLoadFailed] = useState(false);
  const [activeSrc, setActiveSrc] = useState('');
  const lastDurationPollRef = useRef(0);

  const syncMediaDurationSec = useCallback(
    (sec: number) => {
      if (!Number.isFinite(sec) || sec <= 0) return;
      const stored = Number(data?.mediaDurationSec);
      if (Number.isFinite(stored) && stored >= sec - 0.05) return;
      updateNodeData({ mediaDurationSec: sec });
    },
    [data?.mediaDurationSec, updateNodeData],
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
    const remote = data?.originalAudioUrl?.trim();
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
  }, [normalizedUrl, data?.originalAudioUrl]);
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
  }, [isPlaying, audioRef, activeSrc, checkAudioCompatibility, tryPlaybackFallback, showTrimRange, trimStart, trimEnd, duration, syncPlayingState, nodeId]);

  // 注意：所有事件处理都在 audio 元素的 onXxx 属性中处理，不需要额外的 useEffect

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

  return (
    <div className="w-full flex flex-col items-center gap-2">
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
      
      {/* 自定义播放器：卡片区域可拖节点；进度条/音量等子控件单独 nodrag */}
      <div
        className={`w-full rounded-xl p-3 select-none ${
          isDarkMode ? 'bg-white/5' : 'bg-gray-100/80'
        }`}
      >
        <div className="flex items-center gap-3">
          {/* 大号播放/暂停按钮 - 音源不可用时仅提示，不重复触发 play 报错 */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              togglePlay();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className={`nodrag flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center shadow-lg transition-all duration-150 active:scale-95 ${
              sourceLoadFailed ? (isDarkMode ? 'bg-white/10 text-white/50 cursor-not-allowed' : 'bg-gray-300 text-gray-500 cursor-not-allowed') : isPlaying
                ? isDarkMode ? 'bg-emerald-500/90 text-white hover:bg-emerald-500' : 'bg-emerald-500 text-white hover:bg-emerald-600'
                : isDarkMode ? 'bg-emerald-600/80 text-white hover:bg-emerald-500 border border-emerald-400/30' : 'bg-emerald-500 text-white hover:bg-emerald-600 border border-emerald-600/30'
            }`}
            title={sourceLoadFailed ? '音源不可用，请检查路径或重新选择文件' : (isPlaying ? '暂停' : '播放')}
            aria-label={sourceLoadFailed ? '音源不可用' : (isPlaying ? '暂停' : '播放')}
          >
            {isPlaying ? (
              <Pause className="w-6 h-6 flex-shrink-0" strokeWidth={2.5} />
            ) : (
              <Play className="w-6 h-6 ml-0.5 flex-shrink-0" strokeWidth={2.5} />
            )}
          </button>

          {/* 进度与时间：裁剪模式下显示双指针选择区间，否则为单进度条 */}
          <div className="flex-1 min-w-0 flex flex-col gap-1">
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
                className={`nodrag h-2 w-full ${displayDuration > 0 ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                style={{ accentColor: isDarkMode ? '#22c55e' : '#16a34a' }}
                aria-label="播放进度"
                title="点击或拖拽选择播放位置"
              />
            )}
            <div className="flex items-center justify-between">
              <span className={`text-xs font-mono tabular-nums ${isDarkMode ? 'text-white/80' : 'text-gray-700'}`}>
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
                <Volume2 className={`w-3.5 h-3.5 ${isDarkMode ? 'text-white/50' : 'text-gray-500'}`} />
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={handleVolumeChange}
                  className="w-14 h-1 cursor-pointer"
                  aria-label="音量"
                  title="音量"
                  style={{ accentColor: isDarkMode ? '#22c55e' : '#16a34a' }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
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
    // 确保不会透传任何其他 React Flow 内部属性
  } = props as any;
  console.log('[AudioNode Debug] Render with data:', data);
  const { setNodes } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const store = useStoreApi();
  
  // 最小尺寸约束（与 Text 模块相同）
  const MIN_WIDTH = 280;
  const MIN_HEIGHT = 160;
  
  const [size, setSize] = useState({
    w: Math.max(MIN_WIDTH, data?.width || MIN_WIDTH),
    h: Math.max(MIN_HEIGHT, data?.height || MIN_HEIGHT),
  });
  const [isResizing, setIsResizing] = useState(false);
  const [outputAudio, setOutputAudio] = useState(data?.outputAudio || '');
  const [title, setTitle] = useState(data?.title || 'audio');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
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
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const prevOutputAudioRef = useRef<string>(''); // 用于跟踪音频 URL 变化
  const viewport = useViewport();
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
    if (data?.width !== undefined && data.width > 0) {
      setSize((prev) => {
        if (prev.w !== data.width) {
          return { ...prev, w: data.width };
        }
        return prev;
      });
      // 强制应用尺寸到 DOM
      if (nodeRef.current) {
        nodeRef.current.style.width = `${data.width}px`;
      }
    }
    if (data?.height !== undefined && data.height > 0) {
      setSize((prev) => {
        if (prev.h !== data.height) {
          return { ...prev, h: data.height };
        }
        return prev;
      });
      // 强制应用尺寸到 DOM
      if (nodeRef.current) {
        nodeRef.current.style.height = `${data.height}px`;
      }
    }
    if (data?.outputAudio !== undefined) {
      // 格式化音频路径
      const formattedPath = normalizeAudioUrl(data.outputAudio);
      // 只有当 URL 真正变化时才更新，避免不必要的重新加载
      if (outputAudio !== formattedPath) {
        setOutputAudio(formattedPath);
      }
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
  }, [data?.width, data?.height, data?.outputAudio, data?.title, data?.errorMessage, data?.aiStatus, data?.text, outputAudio]);

  // 双击标题进入编辑模式
  const handleTitleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const songLabel =
      isAudioSongModel(data?.model) ? String(data?.songName ?? '').trim() : '';
    setTitle(songLabel || title || '未命名音频');
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  }, [data?.model, data?.songName, title]);

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

  const {
    isRecording: isRecordingRefMic,
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
  });

  const handleStopReferenceRecording = useCallback(() => {
    setRefMicSaving(true);
    stopReferenceRecording();
  }, [stopReferenceRecording]);

  const handleReferenceMicInput = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (refMicSaving) return;
      if (isRecordingRefMic) {
        handleStopReferenceRecording();
        return;
      }
      void startReferenceRecording();
    },
    [isRecordingRefMic, refMicSaving, startReferenceRecording, handleStopReferenceRecording],
  );

  useEffect(() => {
    const open = isRecordingRefMic || refMicSaving;
    (window as Window & { __nexflowVoiceModalOpen?: boolean }).__nexflowVoiceModalOpen = open;
    return () => {
      (window as Window & { __nexflowVoiceModalOpen?: boolean }).__nexflowVoiceModalOpen = false;
    };
  }, [isRecordingRefMic, refMicSaving]);

  const floatIconBtn = (extra = '') =>
    `p-1.5 rounded-lg transition-all disabled:opacity-30 ${
      isDarkMode
        ? 'apple-panel hover:bg-white/20 text-white/80'
        : 'apple-panel-light hover:bg-gray-200/30 text-gray-700'
    } ${extra}`;

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
      if (res?.audioUrl) {
        const newDur = Math.max(0.1, end - start);
        setOutputAudio(res.audioUrl);
        updateNodeData({
          outputAudio: res.audioUrl,
          originalAudioUrl: res.audioUrl,
          mediaDurationSec: newDur,
          errorMessage: undefined,
        });
        setTrimStartSec('0');
        setTrimEndSec(String(Math.round(newDur * 10) / 10));
        setShowTrimModal(false);
      } else {
        setTrimError('裁剪未返回结果');
      }
    } catch (err: any) {
      const msg = err?.message || '裁剪失败';
      console.error('[AudioNode] 裁剪失败:', err);
      setTrimError(msg);
      updateNodeData({ errorMessage: msg });
    } finally {
      setTrimming(false);
    }
  }, [trimStartSec, trimEndSec, data?.outputAudio, outputAudio, data?.referenceAudioUrl, projectId, updateNodeData]);

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

  // 处理尺寸变化
  const handleSizeChange = useCallback((newSize: { w: number; h: number }) => {
    setSize(newSize);
    updateNodeData({ width: newSize.w, height: newSize.h });
  }, [updateNodeData]);

  const zoom = viewport.zoom ?? 1;
  const vx = viewport.x ?? 0;
  const vy = viewport.y ?? 0;
  const lodLevel = useMemo<'far' | 'mid' | 'near'>(() => {
    if (zoom < ZOOM_THRESHOLD_FAR) return 'far';
    if (zoom < ZOOM_THRESHOLD_NEAR) return 'mid';
    return 'near';
  }, [zoom]);
  const showDetailedUi = lodLevel === 'near';
  const hasPlayableAudio = !!(data?.outputAudio || outputAudio || data?.referenceAudioUrl);
  const isHardFrozen = useMemo(() => {
    if (!performanceMode || selected || dragging || isResizing) return false;
    const viewportLeft = -vx / zoom;
    const viewportTop = -vy / zoom;
    const viewportWidth = (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom;
    const viewportHeight = (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom;
    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const nodeRight = xPos + size.w;
    const nodeBottom = yPos + size.h;
    const intersects = !(nodeRight < viewportLeft || xPos > viewportRight || nodeBottom < viewportTop || yPos > viewportBottom);
    if (intersects) return false;
    const distX = nodeRight < viewportLeft ? (viewportLeft - nodeRight) : (xPos > viewportRight ? xPos - viewportRight : 0);
    const distY = nodeBottom < viewportTop ? (viewportTop - nodeBottom) : (yPos > viewportBottom ? yPos - viewportBottom : 0);
    return distX > viewportWidth * 2 || distY > viewportHeight * 2;
  }, [performanceMode, selected, dragging, isResizing, vx, vy, zoom, xPos, yPos, size.w, size.h]);
  /** 选中或拖动中始终显示完整内容（避免远缩放/冻结 LOD 在移动画布时把节点变成空白，与图二一致） */
  const showSelectedChrome = selected || dragging;
  /** 有可播放音频时不切占位，避免平移/缩放画布时卸载 <audio> 打断播放 */
  const showPlaceholder =
    !hasPlayableAudio &&
    (isResizing || ((isHardFrozen || lodLevel === 'far') && !showSelectedChrome));
  const showMicChrome = (showSelectedChrome || isHovered) && !showPlaceholder;
  const hasDownloadableAudio = !!(outputAudio || data?.outputAudio || data?.originalAudioUrl);
  const hasTrimmableAudio = !!(data?.outputAudio || outputAudio || data?.referenceAudioUrl);
  const musicSongName =
    isAudioSongModel(data?.model) ? String(data?.songName ?? '').trim() : '';
  const nodeHeaderLabel = musicSongName || title || '未命名音频';

  return (
    <>
      <div
        ref={nodeRef}
        data-id={id}
        className={`custom-node-container group relative rounded-2xl overflow-visible flex flex-col ${
          isDarkMode
            ? 'nexflow-glass-panel'
            : 'apple-panel-light' /* 使用磨砂材质浅灰半透明背板 */
        } ${isMediaPlaying && !isResizing ? 'nexflow-media-playing-glow' : ''} ${showSelectedChrome && !isMediaPlaying && isDarkMode && !isResizing ? 'ring-2 ring-green-400/80' : ''} ${showSelectedChrome && !isMediaPlaying && !isDarkMode && !isResizing ? 'ring-2 ring-green-500' : ''} ${isResizing ? '!shadow-none !ring-0' : ''}`}
        style={{
          width: size.w,
          height: size.h,
          minWidth: `${MIN_WIDTH}px`,
          minHeight: `${MIN_HEIGHT}px`,
          userSelect: isResizing ? 'none' : 'auto',
          willChange: isResizing ? 'transform, width, height' : dragging ? 'transform' : 'auto',
          backfaceVisibility: isResizing ? 'hidden' : 'visible',
          transition: isResizing ? 'none' : 'all 0.2s ease',
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
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
        {/* 左上角标题区域（在模块外部、上方，与 ImageNode 一致） */}
        {showDetailedUi && <div className="title-area absolute -top-7 left-0 z-10">
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
                  setTitle(songLabel || data?.title || 'audio');
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
              className={`font-bold text-xs cursor-pointer select-none ${
                isDarkMode ? 'text-white/80' : 'text-gray-900'
              } hover:opacity-70 transition-opacity`}
            >
              {nodeHeaderLabel}
            </span>
          )}
        </div>}

        {/* 左上角：录音（参考音）+ 下载 */}
        {showMicChrome && (
          <button
            type="button"
            onClick={handleReferenceMicInput}
            disabled={refMicSaving}
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
            className={`nodrag absolute top-2 left-2 z-[100] flex h-7 w-7 shrink-0 items-center justify-center rounded border transition-colors ${
              refMicSaving
                ? isDarkMode
                  ? 'cursor-wait border-violet-400/50 bg-violet-500/20 text-violet-200'
                  : 'cursor-wait border-violet-400/60 bg-violet-100 text-violet-700'
                : isRecordingRefMic
                  ? 'border-orange-400/70 bg-orange-500/30 text-orange-100 hover:bg-orange-500/40'
                  : isDarkMode
                    ? 'border-white/25 bg-white/5 text-white/75 hover:bg-white/10 hover:text-white'
                    : 'border-gray-300 bg-white/90 text-gray-600 hover:bg-gray-100'
            }`}
            title={
              refMicSaving
                ? refMicAt.recordModalStop
                : isRecordingRefMic
                  ? refMicAt.stopRecordingButton
                  : refMicAt.recordReferenceTitle
            }
            aria-label={refMicAt.recordReferenceAria}
            style={{ pointerEvents: 'all' }}
          >
            {refMicSaving || isRecordingRefMic ? (
              <Loader2
                className={`relative h-3.5 w-3.5 animate-spin ${isRecordingRefMic && !refMicSaving ? 'text-orange-200' : ''}`}
                strokeWidth={2.25}
              />
            ) : (
              <Mic className="relative h-3.5 w-3.5" strokeWidth={2.25} />
            )}
          </button>
        )}
        {hasDownloadableAudio && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleDownloadAudio(); }}
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
            className={`nodrag absolute top-2 p-1.5 rounded-lg transition-all z-[100] ${
              showMicChrome ? 'left-11' : 'left-2'
            } ${
              isDarkMode ? 'apple-panel hover:bg-white/20' : 'apple-panel-light hover:bg-gray-200/30'
            }`}
            title="下载"
            aria-label="下载"
            style={{ pointerEvents: 'all' }}
          >
            <Download className={`w-3.5 h-3.5 ${isDarkMode ? 'text-white/80' : 'text-gray-700'}`} />
          </button>
        )}
        {/* 右上角上传参考音按钮（Index-TTS2 等） */}
        {showDetailedUi && showSelectedChrome && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleUploadReferenceAudio(); }}
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
            className={`nodrag absolute top-2 right-2 p-1.5 rounded-lg transition-all z-[100] ${
              isDarkMode ? 'apple-panel hover:bg-white/20' : 'apple-panel-light hover:bg-gray-200/30'
            }`}
            title="上传参考音（用于 Index-TTS2 配音）"
            aria-label="上传参考音"
            style={{ pointerEvents: 'all' }}
          >
            <Upload className={`w-3.5 h-3.5 ${isDarkMode ? 'text-white/80' : 'text-gray-700'}`} />
          </button>
        )}

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
        <div key={data?.updatedAt || 'initial'} className="w-full flex-1 flex flex-col items-stretch justify-center overflow-hidden p-2 pt-3" style={{ minHeight: '80px' }}>
          {/* 数据校验：优先 data.outputAudio（video->audio 注入），再 outputAudio/referenceAudioUrl */}
          {(data?.outputAudio || outputAudio || data?.referenceAudioUrl) && (
            <div className="flex-shrink-0 mb-1.5 flex flex-col gap-1">
              {/* 全能写歌：歌曲名已在节点顶部显示，卡片内不重复标题 */}
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium self-start ${
                  (data?.outputAudio || outputAudio)
                    ? isDarkMode
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-emerald-100 text-emerald-700'
                    : isDarkMode
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-blue-100 text-blue-700'
                }`}
                title={(data?.outputAudio || outputAudio) ? (data?.audioSourceType === 'vocals' ? '人声分离结果' : data?.audioSourceType === 'accompaniment' ? '背景音分离结果' : '当前为 TTS 生成的声音') : '当前为参考音（上传或从上一节点传入）'}
              >
                {(data?.outputAudio || outputAudio)
                  ? (data?.audioSourceType === 'vocals' ? '人声' : data?.audioSourceType === 'accompaniment' ? '背景音' : '生成的声音')
                  : '参考音'}
              </span>
            </div>
          )}
          {/* 有可播放音频时始终显示完整播放器（画布平移/缩放时也不替换为占位，与静止态一致） */}
          {(data?.outputAudio || outputAudio || data?.referenceAudioUrl) ? (
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
              {!messageContainsRefundHint(
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

        {/* 模块外下方：裁剪（拼图模块同款悬浮工具栏） */}
        {showSelectedChrome && hasTrimmableAudio && (
          <div
            className="node-floating-toolbar nodrag nopan absolute top-full left-1/2 z-20 mt-1.5 flex w-max max-w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 px-1 overflow-visible"
            style={{ pointerEvents: 'all' }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              disabled={trimming}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                if (trimming) return;
                setTrimError(null);
                setShowTrimModal(true);
              }}
              className={floatIconBtn(
                trimming
                  ? 'opacity-50 cursor-not-allowed'
                  : isDarkMode
                    ? 'hover:!bg-emerald-500/20 !text-emerald-300'
                    : 'hover:!bg-emerald-100 !text-emerald-700',
              )}
              title={anc.trimButtonTitle}
              aria-label={anc.trimButton}
            >
              {trimming ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Scissors className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        )}

        {/* 全屏背景虚化的音频裁剪弹窗 */}
        {showTrimModal && (
          <AudioTrimModal
            audioUrl={data?.outputAudio || outputAudio || data?.referenceAudioUrl || ''}
            isDarkMode={isDarkMode}
            initialTrimStart={parseFloat(trimStartSec) || 0}
            initialTrimEnd={parseFloat(trimEndSec) || 0}
            trimming={trimming}
            c={anc}
            onConfirm={(start, end) => handleTrimConfirm(start, end)}
            onCancel={() => !trimming && setShowTrimModal(false)}
          />
        )}

        {/* 右下角框外圆弧角缩放手柄 */}
        <div
          ref={resizeHandleRef}
          className="nodrag absolute -bottom-2 -right-2 w-6 h-6 cursor-nwse-resize flex items-center justify-center opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity z-[9999]"
          style={{ pointerEvents: 'all' }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
            
            setIsResizing(true);
            
            // 标记节点正在调整大小，阻止拖动
            updateNodeData({ _isResizing: true } as any);
            
            // 在 body 上设置 cursor 样式
            const originalCursor = document.body.style.cursor;
            document.body.style.setProperty('cursor', 'nwse-resize', 'important');
            
            const startX = e.clientX;
            const startY = e.clientY;
            const startW = size.w;
            const startH = size.h;
            
            // 使用 requestAnimationFrame 优化 updateNodeInternals 调用
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
              
              // 获取当前缩放比例
              const currentZoom = store.getState().transform[2] || 1;
              
              // 将鼠标移动距离除以缩放比例，转换为画布坐标
              const deltaX = (moveEvent.clientX - startX) / currentZoom;
              const deltaY = (moveEvent.clientY - startY) / currentZoom;
              
              // 计算新尺寸（最小尺寸约束）
              const newW = Math.max(MIN_WIDTH, startW + deltaX);
              const newH = Math.max(MIN_HEIGHT, startH + deltaY);
              
              // 直接操作 DOM，不触发 React 状态更新
              if (nodeRef.current) {
                nodeRef.current.style.transition = 'none';
                nodeRef.current.style.width = `${newW}px`;
                nodeRef.current.style.height = `${newH}px`;
              }
              
              scheduleUpdate();
            };
            
            const onMouseUp = (upEvent: MouseEvent) => {
              setIsResizing(false);
              
              // 恢复 body cursor
              document.body.style.cursor = originalCursor;
              
              // 恢复 transition
              if (nodeRef.current) {
                nodeRef.current.style.transition = '';
              }
              
              // 取消待处理的 requestAnimationFrame
              if (rafId !== null) {
                cancelAnimationFrame(rafId);
                rafId = null;
              }
              
              // 获取最终尺寸（从 DOM 读取）
              const finalSize = {
                w: nodeRef.current ? parseFloat(nodeRef.current.style.width) || size.w : size.w,
                h: nodeRef.current ? parseFloat(nodeRef.current.style.height) || size.h : size.h,
              };
              
              // 仅在 onMouseUp 时更新 React 状态（数据持久化）
              handleSizeChange(finalSize);
              
              // 清除调整大小标记
              updateNodeData({ _isResizing: false } as any);
              
              // 强制刷新节点连接线位置（最终更新）
              updateNodeInternals(id);
              
              document.removeEventListener('mousemove', onMouseMove);
              document.removeEventListener('mouseup', onMouseUp);
              upEvent.preventDefault();
              upEvent.stopPropagation();
            };
            
            document.addEventListener('mousemove', onMouseMove, { passive: false });
            document.addEventListener('mouseup', onMouseUp, { passive: false });
          }}
          onClick={(e) => {
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
          }}
          onDragStart={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <div className={`w-4 h-4 rounded-br-2xl border-r-2 border-b-2 ${
            isDarkMode ? 'border-white/40' : 'border-gray-400/60'
          }`} />
        </div>
        </>
        )}
      </div>

      {/* 裁剪错误提示：无弹窗时在节点内显示 */}
      {trimError && showSelectedChrome && (
        <div className="nodrag nopan absolute -bottom-20 left-0 right-0 flex justify-center z-10">
          <div className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-xs">
            {trimError}
          </div>
        </div>
      )}
    </>
  );
};

export const AudioNode = memo(AudioNodeComponent);
AudioNode.displayName = 'AudioNode';
