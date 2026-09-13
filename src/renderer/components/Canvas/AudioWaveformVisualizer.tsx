import React, { useMemo } from 'react';

const WAVE_BAR_COUNT_MAIN = 72;
const WAVE_BAR_COUNT_COMPACT = 28;

export function audioWaveBarGradient(isDarkMode: boolean, muted = false): string {
  if (muted) {
    return isDarkMode
      ? 'bg-gradient-to-t from-zinc-900 via-zinc-600 to-zinc-400'
      : 'bg-gradient-to-t from-zinc-500 via-zinc-400 to-zinc-300';
  }
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

let waveCssInjected = false;
function ensureWaveCss() {
  if (waveCssInjected || typeof document === 'undefined') return;
  waveCssInjected = true;
  const el = document.createElement('style');
  el.setAttribute('data-nexflow-audio-wave', '1');
  el.textContent = `
    @keyframes nexflow-audio-wave-y {
      0% { transform: scaleY(0.75); }
      100% { transform: scaleY(1.1); }
    }
    @keyframes nexflow-audio-wave-y-fill {
      0% { transform: scaleY(0.88); }
      100% { transform: scaleY(1.08); }
    }
  `;
  document.head.appendChild(el);
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
  /**
   * 播放动画强度。fill 默认偏弱（画布大波形）；
   * 侧栏紧凑区请传 'normal'，否则几乎看不出跳动。
   * 节奏均为 0.38s alternate（与画布音频节点一致，不要加快）。
   */
  playAnim?: 'subtle' | 'normal';
  /** 覆盖默认条数（宽轨道可传更大值，条仍保持 3px 细，只是分布更密） */
  barCount?: number;
  seed?: string;
  className?: string;
  /** 外壳圆角，默认 fill 为 rounded-2xl */
  shellRoundedClass?: string;
  /** 柱状条圆角，默认 fill 为 rounded-t-sm / 非 fill 为 rounded-t-full */
  barRoundedClass?: string;
  /** 单柱最大宽度，默认 fill 为 3px */
  barMaxWidthClass?: string;
  /** 柱间距，默认 gap-px */
  barGapClass?: string;
  /** 无音频时用灰色波形（本镜声音空态等） */
  muted?: boolean;
}> = ({
  isPlaying,
  isDarkMode,
  variant = 'main',
  fillContainer = false,
  playAnim,
  barCount: barCountProp,
  seed = '',
  className = '',
  shellRoundedClass,
  barRoundedClass,
  barMaxWidthClass,
  barGapClass,
  muted = false,
}) => {
  const isMain = variant === 'main';
  ensureWaveCss();
  const barCount =
    typeof barCountProp === 'number' && barCountProp > 0
      ? Math.min(240, Math.max(16, Math.round(barCountProp)))
      : isMain
        ? WAVE_BAR_COUNT_MAIN
        : WAVE_BAR_COUNT_COMPACT;
  const stripMinH = isMain ? (fillContainer ? 0 : 120) : 52;
  const trackMinH = isMain ? (fillContainer ? 0 : 104) : 40;
  const animMode = playAnim || (fillContainer ? 'subtle' : 'normal');
  const waveAnim = animMode === 'subtle' ? 'nexflow-audio-wave-y-fill' : 'nexflow-audio-wave-y';

  const barHeightsPct = useMemo(() => {
    let h = hashSeed(seed || 'default');
    const lo = fillContainer ? 28 : 16;
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

  const barGrad = audioWaveBarGradient(isDarkMode, muted);
  const trackBg = muted
    ? fillContainer
      ? isDarkMode
        ? 'bg-gradient-to-b from-zinc-700/90 via-zinc-800/85 to-zinc-900'
        : 'bg-gradient-to-b from-zinc-300 via-zinc-400/90 to-zinc-500'
      : isDarkMode
        ? 'bg-gradient-to-b from-zinc-800/90 via-black/70 to-black/85'
        : 'bg-gradient-to-b from-zinc-100 to-zinc-200/80'
    : fillContainer
      ? isDarkMode
        ? 'bg-gradient-to-b from-violet-900/95 via-violet-950/85 to-violet-950'
        : 'bg-gradient-to-b from-violet-300 via-violet-400/95 to-violet-600'
      : isDarkMode
        ? 'bg-gradient-to-b from-violet-950/90 via-black/70 to-black/85'
        : 'bg-gradient-to-b from-violet-100 to-violet-200/70';
  const outerBorder = muted
    ? isDarkMode
      ? 'border border-white/10'
      : 'border border-zinc-300/80'
    : isDarkMode
      ? 'border border-violet-500/25'
      : '';
  const gridCols = { gridTemplateColumns: `repeat(${barCount}, minmax(0, 1fr))` } as const;
  const shellRound =
    shellRoundedClass || (isMain && fillContainer ? 'rounded-2xl' : 'rounded-xl');
  const barRound =
    barRoundedClass || (fillContainer ? 'rounded-t-sm' : 'rounded-t-full');
  const barMaxW =
    barMaxWidthClass || (fillContainer ? 'max-w-[3px]' : isMain ? 'max-w-[3px]' : 'max-w-[2.5px]');
  const barGap = barGapClass || 'gap-px';
  const shellClass = isMain
    ? fillContainer
      ? `absolute inset-0 overflow-hidden ${shellRound} ${outerBorder} ${trackBg}`
      : `w-full overflow-hidden ${shellRound} ${outerBorder} ${trackBg}`
    : `w-full overflow-hidden ${shellRound} ${outerBorder} ${trackBg}`;

  const playingAnim = (i: number): React.CSSProperties =>
    isPlaying
      ? {
          animation: `${waveAnim} 0.38s ease-in-out infinite alternate`,
          animationDelay: `${(i % 12) * 35}ms`,
        }
      : { animation: 'none' };

  return (
    <>
      <div
        className={`${shellClass} ${className}`}
        style={fillContainer ? undefined : { minHeight: stripMinH }}
        data-playing={isPlaying ? '1' : '0'}
      >
        {fillContainer ? (
          <div
            className={`absolute inset-0 grid h-full w-full items-end ${barGap} px-1 py-1`}
            style={gridCols}
          >
            {barHeightsPct.map((hPct, i) => (
              <span
                key={i}
                className={`block min-w-0 w-full justify-self-center ${barMaxW} ${barRound} origin-bottom ${barGrad}`}
                style={{
                  height: `${hPct}%`,
                  opacity: isPlaying ? 0.98 : 0.88,
                  transformOrigin: 'bottom center',
                  ...playingAnim(i),
                }}
              />
            ))}
          </div>
        ) : (
          <div
            className={`grid w-full min-w-0 items-end ${barGap} px-1 py-1`}
            style={{ ...gridCols, minHeight: trackMinH }}
          >
            {barHeightsPx.map((hVal, i) => (
              <span
                key={i}
                className={`block min-w-0 w-full justify-self-center ${barMaxW} ${barRound} origin-bottom ${barGrad}`}
                style={{
                  height: `${hVal}px`,
                  opacity: isPlaying ? 0.98 : 0.88,
                  transformOrigin: 'bottom center',
                  ...playingAnim(i),
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
