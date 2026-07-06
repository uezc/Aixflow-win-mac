import React, { useMemo } from 'react';

const WAVE_BAR_COUNT_MAIN = 72;
const WAVE_BAR_COUNT_COMPACT = 28;

export function audioWaveBarGradient(isDarkMode: boolean): string {
  return isDarkMode
    ? 'bg-gradient-to-t from-[#14081f] via-violet-800 to-violet-300'
    : 'bg-gradient-to-t from-violet-950 via-violet-600 to-violet-200';
}

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function buildBarHeightsPx(seed: string, barCount: number, trackMinH: number): number[] {
  let h = hashSeed(seed || 'default');
  const span = Math.max(12, trackMinH - 8);
  const lo = Math.round(0.16 * span);
  const hi = Math.round(0.98 * span);
  return Array.from({ length: barCount }, (_, i) => {
    h = (Math.imul(h, 1103515245) + 12345 + i) >>> 0;
    return lo + (h % (hi - lo + 1));
  });
}

export const AudioWaveformVisualizer: React.FC<{
  isPlaying: boolean;
  isDarkMode: boolean;
  variant?: 'main' | 'compact';
  /** 主模块波形：撑满父容器高度 */
  fillContainer?: boolean;
  seed?: string;
  className?: string;
}> = ({ isPlaying, isDarkMode, variant = 'main', fillContainer = false, seed = '', className = '' }) => {
  const isMain = variant === 'main';
  const barCount = isMain ? WAVE_BAR_COUNT_MAIN : WAVE_BAR_COUNT_COMPACT;
  const stripMinH = isMain ? (fillContainer ? 0 : 120) : 52;
  const trackMinH = isMain ? (fillContainer ? 0 : 104) : 40;

  const barHeightsPct = useMemo(() => {
    let h = hashSeed(seed || 'default');
    const lo = fillContainer ? 52 : 16;
    const hi = 98;
    return Array.from({ length: barCount }, (_, i) => {
      h = (Math.imul(h, 1103515245) + 12345 + i) >>> 0;
      return lo + (h % (hi - lo + 1));
    });
  }, [seed, barCount, fillContainer]);

  const barHeightsPx = useMemo(
    () => (fillContainer ? barHeightsPct : buildBarHeightsPx(seed, barCount, trackMinH)),
    [seed, barCount, trackMinH, fillContainer, barHeightsPct],
  );

  const barGrad = audioWaveBarGradient(isDarkMode);
  const trackBg = fillContainer
    ? isDarkMode
      ? 'bg-gradient-to-b from-violet-900/95 via-violet-950/85 to-violet-950'
      : 'bg-gradient-to-b from-violet-300 via-violet-400/95 to-violet-600'
    : isDarkMode
      ? 'bg-gradient-to-b from-violet-950/90 via-black/70 to-black/85'
      : 'bg-gradient-to-b from-violet-100 to-violet-200/70';
  const outerBorder = isDarkMode ? 'border border-violet-500/25' : '';
  const waveAnim = fillContainer ? 'nexflow-audio-wave-y-fill' : 'nexflow-audio-wave-y';
  const gridCols = { gridTemplateColumns: `repeat(${barCount}, minmax(0, 1fr))` } as const;
  const shellClass = isMain
    ? fillContainer
      ? `absolute inset-0 overflow-hidden rounded-2xl ${outerBorder} ${trackBg}`
      : `w-full overflow-hidden rounded-xl ${outerBorder} ${trackBg}`
    : `w-full overflow-hidden rounded-xl ${outerBorder} ${trackBg}`;

  return (
    <>
      <style>{`
        @keyframes nexflow-audio-wave-y {
          0% { transform: scaleY(0.45); }
          100% { transform: scaleY(1.08); }
        }
        @keyframes nexflow-audio-wave-y-fill {
          0% { transform: scaleY(0.88); }
          100% { transform: scaleY(1.08); }
        }
      `}</style>
      <div
        className={`${shellClass} ${className}`}
        style={fillContainer ? undefined : { minHeight: stripMinH }}
      >
        {fillContainer ? (
          <div className="absolute inset-0 flex items-end gap-px">
            {barHeightsPct.map((hPct, i) => (
              <span
                key={i}
                className={`min-w-0 flex-1 rounded-t-sm origin-bottom ${barGrad} max-w-[3px]`}
                style={{
                  height: `${hPct}%`,
                  opacity: isPlaying ? 0.98 : 0.88,
                  animation: isPlaying ? `${waveAnim} 0.38s ease-in-out infinite alternate` : undefined,
                  animationDelay: isPlaying ? `${(i % 12) * 35}ms` : undefined,
                }}
              />
            ))}
          </div>
        ) : (
        <div
          className="grid w-full min-w-0 items-end gap-px px-1 py-1"
          style={{ ...gridCols, minHeight: trackMinH }}
        >
          {barHeightsPx.map((hVal, i) => (
            <span
              key={i}
              className={`min-w-0 w-full justify-self-center rounded-t-full origin-bottom ${barGrad} ${
                isMain ? 'max-w-[3px]' : 'max-w-[2.5px]'
              }`}
              style={{
                height: `${hVal}px`,
                opacity: isPlaying ? 0.98 : 0.88,
                animation: isPlaying ? 'nexflow-audio-wave-y 0.38s ease-in-out infinite alternate' : undefined,
                animationDelay: isPlaying ? `${(i % 12) * 35}ms` : undefined,
              }}
            />
          ))}
        </div>
        )}
      </div>
    </>
  );
};

export default AudioWaveformVisualizer;
