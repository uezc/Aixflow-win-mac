import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mic } from 'lucide-react';

const WAVE_BAR_COUNT = 72;
const WAVE_STRIP_MIN_H_PX = 120;
const WAVE_TRACK_MIN_H_PX = 104;

const waveBarGradient = (isDarkMode: boolean) =>
  isDarkMode
    ? 'bg-gradient-to-t from-[#14081f] via-violet-800 to-violet-300'
    : 'bg-gradient-to-t from-violet-950 via-violet-600 to-violet-200';

/** 参考音波形条：点击播放/暂停 */
export const ReferenceAudioWaveStrip: React.FC<{
  src: string;
  isDarkMode: boolean;
  variant?: 'default' | 'compact';
  /** 紧凑模式下仅显示波形（无麦克风与文字标签） */
  waveOnly?: boolean;
  emptyLabel?: string;
  playLabel?: string;
}> = ({ src, isDarkMode, variant = 'default', waveOnly = false, emptyLabel, playLabel }) => {
  const isCompact = variant === 'compact';
  const compactWaveOnly = isCompact && waveOnly;
  const barCount = isCompact ? 28 : WAVE_BAR_COUNT;
  const stripMinH = isCompact ? 58 : WAVE_STRIP_MIN_H_PX;
  const trackMinH = isCompact ? 40 : WAVE_TRACK_MIN_H_PX;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
    };
  }, [src]);

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a || !src.trim()) return;
    if (a.paused) void a.play().catch(() => undefined);
    else a.pause();
  }, [src]);

  const barHeightsPx = useMemo(() => {
    const span = Math.max(isCompact ? 8 : 12, trackMinH - 8);
    const lo = Math.round(0.16 * span);
    const hi = Math.round(0.98 * span);
    return Array.from({ length: barCount }, () => lo + Math.floor(Math.random() * (hi - lo + 1)));
  }, [src, barCount, trackMinH, isCompact]);

  const barGrad = waveBarGradient(isDarkMode);
  const trackBg = isDarkMode
    ? 'bg-gradient-to-b from-violet-950/90 via-black/70 to-black/85'
    : 'bg-gradient-to-b from-violet-100 to-violet-200/70';
  const outerBorder = isDarkMode ? 'border-violet-500/25' : 'border-violet-400/35';
  const gridCols = { gridTemplateColumns: `repeat(${barCount}, minmax(0, 1fr))` } as const;

  const emptyTitle = emptyLabel || '暂无参考音';
  const playTitle = playLabel || (playing ? '点击暂停' : '点击播放');

  if (!src.trim()) {
    const emptyOuterBorder = isDarkMode ? 'border-white/10' : 'border-gray-300/80';
    const emptyOuterBg = isDarkMode ? 'bg-white/[0.03]' : 'bg-gray-100/90';
    const emptyMic = isDarkMode ? 'text-white/28' : 'text-gray-400/70';
    const emptyTrackBg = isDarkMode
      ? 'bg-gradient-to-b from-zinc-800/35 via-zinc-900/55 to-black/65'
      : 'bg-gradient-to-b from-gray-200/90 to-gray-300/60';
    const emptyBarGrad = isDarkMode
      ? 'bg-gradient-to-t from-zinc-800 via-zinc-600/90 to-zinc-500/80'
      : 'bg-gradient-to-t from-gray-500/70 via-gray-400/60 to-gray-300/50';

    if (isCompact) {
      if (compactWaveOnly) {
        return (
          <div
            className="nodrag w-full overflow-hidden rounded-lg cursor-not-allowed opacity-55"
            style={{ minHeight: stripMinH }}
            title={emptyTitle}
            aria-label={emptyTitle}
          >
            <div
              className={`grid w-full min-w-0 items-end gap-px rounded-lg px-1.5 py-1 ${emptyTrackBg}`}
              style={{ ...gridCols, minHeight: trackMinH }}
            >
              {barHeightsPx.map((hPx, i) => (
                <span
                  key={i}
                  className={`min-w-0 w-full justify-self-center max-w-[2.5px] rounded-t-full ${emptyBarGrad} opacity-35`}
                  style={{ height: `${hPx}px` }}
                />
              ))}
            </div>
          </div>
        );
      }

      return (
        <div
          className={`nodrag flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 cursor-not-allowed ${emptyOuterBorder} ${emptyOuterBg}`}
          style={{ minHeight: stripMinH }}
          title={emptyTitle}
          aria-label={emptyTitle}
        >
          <Mic className={`w-4 h-4 shrink-0 ${emptyMic}`} aria-hidden />
          <span className={`text-[11px] font-medium truncate flex-1 ${isDarkMode ? 'text-white/35' : 'text-gray-400'}`}>
            {emptyTitle}
          </span>
          <div
            className={`grid min-w-0 flex-[2] items-end gap-px rounded-md px-1.5 py-1 ${emptyTrackBg}`}
            style={{ ...gridCols, minHeight: trackMinH }}
          >
            {barHeightsPx.map((hPx, i) => (
              <span
                key={i}
                className={`min-w-0 w-full justify-self-center max-w-[2px] rounded-t-full ${emptyBarGrad} opacity-35`}
                style={{ height: `${hPx}px` }}
              />
            ))}
          </div>
        </div>
      );
    }

    return (
      <div
        className={`rounded-lg border px-2 py-2 flex w-full items-stretch gap-2 nodrag ${emptyOuterBorder} ${emptyOuterBg}`}
        style={{ minHeight: WAVE_STRIP_MIN_H_PX }}
        title="暂无参考音"
        aria-label="暂无参考音"
      >
        <Mic className={`w-4 h-4 shrink-0 self-center ${emptyMic}`} aria-hidden />
        <div
          className={`grid w-full min-w-0 items-end gap-px rounded-md px-1 py-1 ${emptyTrackBg}`}
          style={{ ...gridCols, minHeight: WAVE_TRACK_MIN_H_PX }}
        >
          {barHeightsPx.map((hPx, i) => (
            <span
              key={i}
              className={`min-w-0 w-full justify-self-center max-w-[3px] rounded-t-full ${emptyBarGrad} opacity-35`}
              style={{ height: `${hPx}px` }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @keyframes nexflow-char-wave-y {
          0% { transform: scaleY(0.45); }
          100% { transform: scaleY(1.08); }
        }
      `}</style>
      <button
        type="button"
        onClick={togglePlay}
        title={playTitle}
        aria-label={playTitle}
        className={`nodrag w-full overflow-hidden text-left transition-opacity ${
          compactWaveOnly
            ? 'cursor-pointer hover:opacity-95 active:opacity-90'
            : `cursor-pointer hover:opacity-95 active:opacity-90 ${outerBorder}`
        } ${
          compactWaveOnly
            ? 'rounded-lg'
            : isCompact
              ? `flex items-center gap-2.5 rounded-lg px-2.5 py-2 border ${isDarkMode ? 'bg-violet-950/25 border-violet-500/25' : 'bg-violet-50/95 border-violet-400/35'}`
              : `flex flex-col rounded-lg border ${isDarkMode ? 'bg-violet-950/25 border-violet-500/25' : 'bg-violet-50/95 border-violet-400/35'}`
        }`}
        style={{ minHeight: stripMinH }}
      >
        <audio ref={audioRef} src={src} preload="none" className="hidden" />
        {isCompact && !compactWaveOnly ? (
          <>
            <Mic
              className={`w-4 h-4 shrink-0 ${isDarkMode ? 'text-violet-300' : 'text-violet-600'}`}
              aria-hidden
            />
            {playLabel ? (
              <span
                className={`text-[11px] font-medium truncate shrink-0 max-w-[5rem] ${
                  isDarkMode ? 'text-violet-200/90' : 'text-violet-800'
                }`}
              >
                {playLabel}
              </span>
            ) : null}
          </>
        ) : null}
        <div
          className={`grid min-w-0 items-end gap-px ${
            compactWaveOnly
              ? 'w-full rounded-lg px-1.5 py-1'
              : isCompact
                ? 'flex-1 rounded-md px-1.5 py-1'
                : 'w-full flex-1 px-1 py-1'
          } ${trackBg}`}
          style={{ ...gridCols, minHeight: trackMinH }}
        >
          {barHeightsPx.map((hPx, i) => (
            <span
              key={i}
              className={`min-w-0 w-full justify-self-center rounded-t-full origin-bottom ${barGrad} ${
                isCompact ? 'max-w-[2.5px]' : 'max-w-[3px]'
              }`}
              style={{
                height: `${hPx}px`,
                opacity: playing ? 0.98 : 0.88,
                animation: playing ? 'nexflow-char-wave-y 0.38s ease-in-out infinite alternate' : undefined,
                animationDelay: playing ? `${(i % 12) * 35}ms` : undefined,
              }}
            />
          ))}
        </div>
      </button>
    </>
  );
};

export default ReferenceAudioWaveStrip;
