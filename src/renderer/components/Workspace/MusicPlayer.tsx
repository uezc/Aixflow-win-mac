import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Play, Pause, Volume2, Maximize2, Music2 } from 'lucide-react';
import { normalizeVideoUrl, toElectronVideoElementSrc } from '../../utils/normalizeVideoUrl';
import { AudioWaveformVisualizer } from '../Canvas/AudioWaveformVisualizer';

export interface MusicPlayerProps {
  audioUrl: string;
  isDarkMode: boolean;
  /** 歌曲名（显示在音符标签上） */
  title?: string;
  /** 展示完整波形卡（导演音乐步） */
  showWaveform?: boolean;
  /** 紧凑波形高度（把下方空间留给歌词/分段） */
  compactWaveform?: boolean;
  onPreview?: () => void;
}

function normalizePlayableAudioUrl(url: string): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (
    raw.startsWith('http://') ||
    raw.startsWith('https://') ||
    raw.startsWith('blob:') ||
    raw.startsWith('data:')
  ) {
    return raw;
  }
  const normalized = normalizeVideoUrl(raw);
  return toElectronVideoElementSrc(normalized) || normalized;
}

export const MusicPlayer: React.FC<MusicPlayerProps> = ({
  audioUrl,
  isDarkMode,
  title,
  showWaveform = false,
  compactWaveform = false,
  onPreview,
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  const normalizedUrl = useMemo(() => normalizePlayableAudioUrl(audioUrl), [audioUrl]);
  const displayTitle = String(title || '').trim();

  const formatTime = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !normalizedUrl) return;
    if (audio.paused) {
      if (!audio.getAttribute('src')) audio.src = normalizedUrl;
      void audio.play().catch((err) => console.warn('[MusicPlayer] play failed', err));
    } else {
      audio.pause();
    }
  }, [normalizedUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    audio.removeAttribute('src');
    if (normalizedUrl) {
      audio.src = normalizedUrl;
      audio.load();
    }
  }, [normalizedUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const updateTime = () => {
      if (!audio.seeking) setCurrentTime(audio.currentTime);
    };
    const updateDuration = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
    };
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('durationchange', updateDuration);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('play', () => setIsPlaying(true));
    audio.addEventListener('pause', () => setIsPlaying(false));
    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('durationchange', updateDuration);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [normalizedUrl]);

  const handleProgressChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!audioRef.current) return;
    const newTime = parseFloat(e.target.value);
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  }, []);

  const handleSeekRatio = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      const audio = audioRef.current;
      if (!audio || !normalizedUrl) return;
      // 播放中再点波形 → 暂停；暂停时点击 → 跳到该位置并播放
      if (!audio.paused) {
        audio.pause();
        return;
      }
      const dur =
        duration > 0
          ? duration
          : Number.isFinite(audio.duration) && audio.duration > 0
            ? audio.duration
            : 0;
      if (dur <= 0) {
        if (!audio.getAttribute('src')) audio.src = normalizedUrl;
        void audio.play().catch((err) => console.warn('[MusicPlayer] play failed', err));
        return;
      }
      if (!audio.getAttribute('src')) audio.src = normalizedUrl;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width)));
      const t = ratio * dur;
      try {
        audio.currentTime = t;
      } catch {
        /* ignore seek errors before ready */
      }
      setCurrentTime(t);
      void audio.play().catch((err) => console.warn('[MusicPlayer] play after seek failed', err));
    },
    [duration, normalizedUrl],
  );

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) audioRef.current.volume = newVolume;
  }, []);

  if (showWaveform) {
    return (
      <div
        className="nodrag nopan relative w-full flex flex-col gap-1.5"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <style>{`
          .nexflow-music-mini-range {
            -webkit-appearance: none;
            appearance: none;
            height: 3px;
            border-radius: 999px;
            background: ${isDarkMode ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'};
            outline: none;
          }
          .nexflow-music-mini-range::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 9px;
            height: 9px;
            border-radius: 50%;
            background: #a78bfa;
            border: none;
            box-shadow: 0 0 0 2px ${isDarkMode ? 'rgba(10,10,12,0.9)' : 'rgba(255,255,255,0.95)'};
            cursor: pointer;
          }
          .nexflow-music-mini-range::-moz-range-thumb {
            width: 9px;
            height: 9px;
            border-radius: 50%;
            background: #a78bfa;
            border: none;
            cursor: pointer;
          }
          .nexflow-music-mini-range:disabled {
            opacity: 0.45;
          }
        `}</style>
        <audio ref={audioRef} preload="metadata" draggable={false} />
        {displayTitle ? (
          <div
            className={`inline-flex max-w-full items-center gap-1.5 self-start rounded-full px-2.5 py-1 ${
              isDarkMode ? 'bg-white/10 text-white/90' : 'bg-gray-200/90 text-gray-800'
            }`}
          >
            <Music2 className="h-3.5 w-3.5 shrink-0 opacity-80" />
            <span className="truncate text-xs font-medium">{displayTitle}</span>
          </div>
        ) : null}
        {/* 波形区：仅展示与点击跳转播放，控件放到下方（与画布音频节点同款） */}
        <div
          className={`relative w-full overflow-hidden rounded-xl ${
            isDarkMode ? 'bg-[#121214] ring-1 ring-white/10' : 'bg-gray-100 ring-1 ring-gray-200'
          }`}
          style={{ minHeight: compactWaveform ? 64 : 120, maxHeight: compactWaveform ? 80 : undefined }}
        >
          <div
            role="button"
            tabIndex={0}
            className="absolute inset-0 cursor-pointer"
            onClick={handleSeekRatio}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                togglePlay();
              }
            }}
            title={isPlaying ? '点击暂停' : '点击波形任意位置即可播放'}
          >
            <AudioWaveformVisualizer
              isPlaying={isPlaying}
              isDarkMode={isDarkMode}
              variant="main"
              fillContainer
              barCount={128}
              seed={normalizedUrl || audioUrl}
              className="pointer-events-none"
            />
          </div>
        </div>
        {/* 下方控制条：播放 + 进度 / 时长 + 音量 */}
        <div className="nodrag nopan flex w-full flex-col gap-1 px-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                togglePlay();
              }}
              className={`nodrag shrink-0 bg-transparent p-0 transition-opacity ${
                isDarkMode
                  ? 'text-violet-300/90 hover:text-violet-200'
                  : 'text-violet-600 hover:text-violet-700'
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
              max={Math.max(duration, 0.01)}
              step={0.01}
              value={currentTime}
              disabled={duration <= 0}
              onChange={handleProgressChange}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className={`nexflow-music-mini-range nodrag min-w-0 flex-1 ${
                duration > 0 ? 'cursor-pointer' : 'cursor-not-allowed'
              }`}
              aria-label="播放进度"
              title="点击或拖拽选择播放位置"
            />
          </div>
          <div className="flex items-center justify-between gap-2 pl-5">
            <span
              className={`text-[10px] font-mono tabular-nums ${
                isDarkMode ? 'text-white/70' : 'text-gray-600'
              }`}
            >
              {formatTime(currentTime)}
              {duration > 0 ? ` / ${formatTime(duration)}` : ''}
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
                onChange={handleVolumeChange}
                className="nexflow-music-mini-range w-14 cursor-pointer"
                aria-label="音量"
                title="音量"
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`nodrag nopan relative w-full ${isDarkMode ? 'bg-[#1C1C1E]' : 'bg-gray-200'} rounded-lg p-3`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <audio ref={audioRef} preload="metadata" draggable={false} />
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={togglePlay}
            className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${isDarkMode ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-gray-300 hover:bg-gray-400 text-gray-700'}`}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(duration, 0.01)}
            step={0.01}
            value={currentTime}
            disabled={duration <= 0}
            onChange={handleProgressChange}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className={`nodrag nopan flex-1 h-1.5 rounded-full cursor-pointer ${duration > 0 ? '' : 'opacity-60 cursor-not-allowed'}`}
            style={{ accentColor: isDarkMode ? '#22c55e' : '#3b82f6' }}
            aria-label="播放进度"
            title="点击或拖拽选择播放位置"
          />
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Volume2 className={`w-3.5 h-3.5 ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`} />
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={volume}
              onChange={handleVolumeChange}
              className="w-16 h-1"
              title="音量"
              style={{ accentColor: isDarkMode ? '#22c55e' : '#3b82f6' }}
            />
          </div>
          {onPreview && (
            <button
              onClick={onPreview}
              className={`flex-shrink-0 w-6 h-6 rounded flex items-center justify-center transition-colors ${isDarkMode ? 'bg-white/10 hover:bg-white/20 text-white/70' : 'bg-gray-300/50 hover:bg-gray-400/50 text-gray-600'}`}
              title="放大播放"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="flex items-center justify-center gap-1">
          <span className={`text-xs font-mono ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>
            {formatTime(currentTime)}
          </span>
          <span className={`text-xs font-mono ${isDarkMode ? 'text-white/50' : 'text-gray-500'}`}>
            / {formatTime(duration)}
          </span>
        </div>
      </div>
    </div>
  );
};
