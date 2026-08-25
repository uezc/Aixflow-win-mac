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
  /** 分镜卡等极窄行：仅播放键+进度条，无波形 */
  ultraCompact?: boolean;
  /** 素材卡：矮波形 + 播放/进度（无时长、无音量） */
  cardWaveform?: boolean;
  /**
   * false：不挂装饰波形、不 preload 音频（分镜邻镜减负）；
   * 点击播放时仍会临时加载。
   */
  mediaActive?: boolean;
  /** 紧凑控制条右侧附加按钮（如生成本镜声音） */
  endAction?: React.ReactNode;
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
  ultraCompact = false,
  cardWaveform = false,
  mediaActive = true,
  endAction,
  onPreview,
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  /** 用户点过播放后才绑定 src，避免分镜多卡同时 metadata 解码 */
  const [mediaArmed, setMediaArmed] = useState(false);

  const normalizedUrl = useMemo(() => normalizePlayableAudioUrl(audioUrl), [audioUrl]);
  const displayTitle = String(title || '').trim();
  // 分镜卡波形始终绘制（装饰柱，几乎无成本）；mediaActive 只控制是否预绑音频 src
  const showWaveUi = showWaveform || cardWaveform;

  const formatTime = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const ensureAudioSrc = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !normalizedUrl) return false;
    if (audio.getAttribute('src') !== normalizedUrl) {
      audio.src = normalizedUrl;
      audio.load();
    }
    setMediaArmed(true);
    return true;
  }, [normalizedUrl]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !normalizedUrl) return;
    if (audio.paused) {
      if (!ensureAudioSrc()) return;
      setIsPlaying(true);
      void audio.play().catch((err) => {
        setIsPlaying(false);
        console.warn('[MusicPlayer] play failed', err);
      });
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, [ensureAudioSrc, normalizedUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setMediaArmed(false);
    audio.removeAttribute('src');
    // 非激活卡：不预载；激活卡也不自动 load，等用户点播放
  }, [normalizedUrl]);

  useEffect(() => {
    if (mediaActive) return;
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setIsPlaying(false);
    audio.removeAttribute('src');
    setMediaArmed(false);
  }, [mediaActive]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const updateTime = () => {
      if (!audio.seeking) setCurrentTime(audio.currentTime);
      // timeupdate 期间若已在播但状态未同步，补上动画开关
      if (!audio.paused) setIsPlaying(true);
    };
    const updateDuration = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
    };
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('durationchange', updateDuration);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('playing', handlePlay);
    audio.addEventListener('pause', handlePause);
    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('durationchange', updateDuration);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('playing', handlePlay);
      audio.removeEventListener('pause', handlePause);
    };
  }, [normalizedUrl]);

  const handleProgressChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!audioRef.current) return;
    const newTime = parseFloat(e.target.value);
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  }, []);

  const handleWaveformClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.preventDefault();
      // 柱状图区域只切换播放/暂停，进度请用下方滑条调节
      togglePlay();
    },
    [togglePlay],
  );

  const progressPct =
    duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) audioRef.current.volume = newVolume;
  }, []);

  if (ultraCompact && !cardWaveform) {
    return (
      <div
        className="nodrag nopan flex w-full items-center gap-1"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <style>{`
          .nexflow-music-ultra-range {
            -webkit-appearance: none;
            appearance: none;
            height: 2px;
            border-radius: 999px;
            background: ${isDarkMode ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'};
            outline: none;
          }
          .nexflow-music-ultra-range::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #a78bfa;
            border: none;
            cursor: pointer;
          }
          .nexflow-music-ultra-range::-moz-range-thumb {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #a78bfa;
            border: none;
            cursor: pointer;
          }
        `}</style>
        <audio ref={audioRef} preload="none" draggable={false} />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            togglePlay();
          }}
          className={`nodrag shrink-0 bg-transparent p-0.5 ${
            isDarkMode
              ? 'text-violet-300/90 hover:text-violet-200'
              : 'text-violet-600 hover:text-violet-700'
          }`}
          title={isPlaying ? '暂停' : '播放'}
          aria-label={isPlaying ? '暂停' : '播放'}
        >
          {isPlaying ? (
            <Pause className="h-3 w-3" strokeWidth={2.25} />
          ) : (
            <Play className="ml-px h-3 w-3" strokeWidth={2.25} />
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
          className={`nexflow-music-ultra-range nodrag min-w-0 flex-1 ${
            duration > 0 ? 'cursor-pointer' : 'cursor-not-allowed'
          }`}
          aria-label="播放进度"
        />
        {endAction ? <div className="nodrag shrink-0">{endAction}</div> : null}
      </div>
    );
  }

  if (showWaveform || cardWaveform) {
    const emptyAudio = cardWaveform && !normalizedUrl;
    const progressFill = emptyAudio ? (isDarkMode ? '#71717a' : '#a1a1aa') : cardWaveform ? '#a78bfa' : '#22c55e';
    const thumbFill = emptyAudio ? (isDarkMode ? '#a1a1aa' : '#71717a') : '#a78bfa';
    return (
      <div
        className={
          cardWaveform
            ? `nodrag nopan relative box-border flex h-[78px] w-full min-h-[78px] flex-col gap-0.5 overflow-hidden rounded-md p-1.5 ${
                emptyAudio
                  ? isDarkMode
                    ? 'bg-black/50 ring-1 ring-white/10 opacity-80'
                    : 'bg-gray-200/80 ring-1 ring-gray-300 opacity-90'
                  : isDarkMode
                    ? 'bg-black ring-1 ring-white/12'
                    : 'bg-gray-900/10 ring-1 ring-gray-300'
              }`
            : 'nodrag nopan relative w-full flex flex-col gap-1.5'
        }
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <style>{`
          .nexflow-music-mini-range {
            -webkit-appearance: none;
            appearance: none;
            height: 9px;
            border-radius: 999px;
            background: transparent;
            outline: none;
          }
          .nexflow-music-mini-range::-webkit-slider-runnable-track {
            height: 3px;
            border-radius: 999px;
            background: ${isDarkMode ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'};
          }
          .nexflow-music-mini-progress::-webkit-slider-runnable-track {
            background: linear-gradient(
              to right,
              ${progressFill} 0%,
              ${progressFill} var(--nx-music-progress, 0%),
              ${isDarkMode ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'} var(--nx-music-progress, 0%)
            );
          }
          .nexflow-music-mini-range::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 9px;
            height: 9px;
            margin-top: -3px;
            border-radius: 50%;
            background: ${thumbFill};
            border: none;
            box-shadow: 0 0 0 2px ${isDarkMode ? 'rgba(10,10,12,0.9)' : 'rgba(255,255,255,0.95)'};
            cursor: pointer;
          }
          .nexflow-music-mini-range::-moz-range-track {
            height: 3px;
            border-radius: 999px;
            background: ${isDarkMode ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'};
          }
          .nexflow-music-mini-range::-moz-range-thumb {
            width: 9px;
            height: 9px;
            border: none;
            border-radius: 50%;
            background: ${thumbFill};
            cursor: pointer;
          }
          .nexflow-music-mini-range:disabled {
            opacity: 0.45;
          }
        `}</style>
        <audio ref={audioRef} preload="none" draggable={false} />
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
        {/* 波形区：仅 mediaActive 时绘制；邻镜只保留矮壳，降低 DOM/动画 */}
        <div
          className={`relative w-full min-h-0 flex-1 overflow-hidden ${
            cardWaveform ? 'rounded-md' : 'rounded-xl'
          } ${
            emptyAudio
              ? isDarkMode
                ? 'bg-zinc-800/90 ring-1 ring-white/10'
                : 'bg-zinc-200 ring-1 ring-zinc-300'
              : isDarkMode
                ? 'bg-[#1a1028] ring-1 ring-white/10'
                : 'bg-violet-100 ring-1 ring-violet-200'
          }`}
          style={
            cardWaveform
              ? { minHeight: 44 }
              : compactWaveform
                ? { height: 100, minHeight: 100 }
                : { minHeight: 120 }
          }
        >
          <div
            role="button"
            tabIndex={0}
            className={`absolute inset-0 ${emptyAudio ? 'cursor-default' : 'cursor-pointer'}`}
            onClick={emptyAudio ? undefined : handleWaveformClick}
            onKeyDown={
              emptyAudio
                ? undefined
                : (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      togglePlay();
                    }
                  }
            }
            title={emptyAudio ? '暂无音频' : isPlaying ? '点击暂停' : '点击播放'}
          >
            {showWaveUi ? (
              <AudioWaveformVisualizer
                isPlaying={isPlaying}
                isDarkMode={isDarkMode}
                variant="main"
                fillContainer
                muted={emptyAudio}
                playAnim={cardWaveform || compactWaveform ? 'normal' : 'subtle'}
                barCount={cardWaveform ? 40 : compactWaveform ? 56 : undefined}
                seed={normalizedUrl || audioUrl || (emptyAudio ? 'empty-audio' : '')}
                shellRoundedClass={cardWaveform ? 'rounded-md' : undefined}
                className="pointer-events-none nexflow-audio-waveform-fill"
              />
            ) : null}
          </div>
        </div>
        {cardWaveform ? (
          <div className="nodrag nopan flex h-6 w-full shrink-0 items-center gap-1 px-0.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                if (!emptyAudio) togglePlay();
              }}
              disabled={emptyAudio}
              className={`nodrag flex h-6 w-6 shrink-0 items-center justify-center bg-transparent p-0 transition-opacity disabled:opacity-50 ${
                emptyAudio
                  ? isDarkMode
                    ? 'text-zinc-500'
                    : 'text-zinc-400'
                  : isDarkMode
                    ? 'text-violet-300/90 hover:text-violet-200'
                    : 'text-violet-600 hover:text-violet-700'
              }`}
              title={emptyAudio ? '暂无音频' : isPlaying ? '暂停' : '播放'}
              aria-label={emptyAudio ? '暂无音频' : isPlaying ? '暂停' : '播放'}
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
              disabled={duration <= 0 || emptyAudio}
              onChange={handleProgressChange}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className={`nexflow-music-mini-range nexflow-music-mini-progress nodrag min-w-0 flex-1 ${
                duration > 0 && !emptyAudio ? 'cursor-pointer' : 'cursor-not-allowed'
              }`}
              style={{ ['--nx-music-progress' as string]: `${progressPct}%` }}
              aria-label="播放进度"
              title={emptyAudio ? '暂无音频' : '点击或拖拽选择播放位置'}
            />
            {endAction ? <div className="nodrag shrink-0">{endAction}</div> : null}
          </div>
        ) : (
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
                className={`nexflow-music-mini-range nexflow-music-mini-progress nodrag min-w-0 flex-1 ${
                  duration > 0 ? 'cursor-pointer' : 'cursor-not-allowed'
                }`}
                style={{ ['--nx-music-progress' as string]: `${progressPct}%` }}
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
                {endAction ? <div className="nodrag ml-0.5 shrink-0">{endAction}</div> : null}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`nodrag nopan relative w-full ${isDarkMode ? 'bg-[#1C1C1E]' : 'bg-gray-200'} rounded-lg p-3`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <audio ref={audioRef} preload="none" draggable={false} />
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
