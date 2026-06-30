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
}> = ({ src, isDarkMode }) => {
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
    const span = Math.max(12, WAVE_TRACK_MIN_H_PX - 8);
    const lo = Math.round(0.16 * span);
    const hi = Math.round(0.98 * span);
    return Array.from({ length: WAVE_BAR_COUNT }, () => lo + Math.floor(Math.random() * (hi - lo + 1)));
  }, [src]);

  const barGrad = waveBarGradient(isDarkMode);
  const trackBg = isDarkMode
    ? 'bg-gradient-to-b from-violet-950/90 via-black/70 to-black/85'
    : 'bg-gradient-to-b from-violet-100 to-violet-200/70';
  const outerBorder = isDarkMode ? 'border-violet-500/25' : 'border-violet-400/35';
  const gridCols = { gridTemplateColumns: `repeat(${WAVE_BAR_COUNT}, minmax(0, 1fr))` } as const;

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
        title={playing ? '点击暂停' : '点击播放'}
        className={`nodrag flex w-full flex-col rounded-lg border overflow-hidden text-left cursor-pointer transition-opacity hover:opacity-95 active:opacity-90 ${outerBorder} ${
          isDarkMode ? 'bg-violet-950/25' : 'bg-violet-50/95'
        }`}
        style={{ minHeight: WAVE_STRIP_MIN_H_PX }}
      >
        <audio ref={audioRef} src={src} preload="none" className="hidden" />
        <div
          className={`grid w-full min-w-0 flex-1 items-end gap-px px-1 py-1 ${trackBg}`}
          style={{ ...gridCols, minHeight: WAVE_TRACK_MIN_H_PX }}
        >
          {barHeightsPx.map((hPx, i) => (
            <span
              key={i}
              className={`min-w-0 w-full justify-self-center max-w-[3px] rounded-t-full origin-bottom ${barGrad}`}
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
