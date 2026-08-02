import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { normalizeVideoUrl, toElectronVideoElementSrc } from '../../utils/normalizeVideoUrl';

const WAVE_BAR_COUNT = 72;
const WAVE_STRIP_MIN_H_PX = 120;
const WAVE_TRACK_MIN_H_PX = 104;

const waveBarGradient = (isDarkMode: boolean) =>
  isDarkMode
    ? 'bg-gradient-to-t from-[#14081f] via-violet-800 to-violet-300'
    : 'bg-gradient-to-t from-violet-950 via-violet-600 to-violet-200';

function normalizePlayableAudioUrl(url: string): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('blob:') || raw.startsWith('data:')) {
    return raw;
  }
  const normalized = normalizeVideoUrl(raw);
  // Electron 下 <audio> 对 local-resource:// 常无法解码，与视频一致转 file:///
  return toElectronVideoElementSrc(normalized) || normalized;
}

export type ReferenceAudioWaveStripProps = {
  src: string;
  isDarkMode: boolean;
  variant?: 'default' | 'compact';
  /** 紧凑模式下仅显示波形（无麦克风与文字标签） */
  waveOnly?: boolean;
  /** 加粗加高波形（确认镜头歌曲片段） */
  emphasized?: boolean;
  /** 覆盖最小高度（铺满确认表行高） */
  minHeightPx?: number;
  /** 确认表瘦条：波形顶满、无紫色空底光晕 */
  dense?: boolean;
  emptyLabel?: string;
  playLabel?: string;
  /** 片段起点（秒），与 clipEndSec 一起用于镜头歌曲片段 */
  clipStartSec?: number;
  /** 片段终点（秒） */
  clipEndSec?: number;
  /**
   * 为 true 时挂载即 load audio。
   * 默认 false：首次播放再挂 src，减轻分镜/视频表多行同时解码卡顿。
   */
  eagerMedia?: boolean;
};

const ReferenceAudioWaveStrip = memo(function ReferenceAudioWaveStripInner({
  src,
  isDarkMode,
  variant = 'default',
  waveOnly = false,
  emphasized = false,
  minHeightPx,
  dense = false,
  emptyLabel,
  playLabel,
  clipStartSec,
  clipEndSec,
  eagerMedia = false,
}: ReferenceAudioWaveStripProps) {
  const isCompact = variant === 'compact';
  const compactWaveOnly = isCompact && waveOnly;
  /** 歌词分段小卡：波形在模块内居中、条间距均匀 */
  const centeredPack = compactWaveOnly && !dense && !emphasized;
  const denseH = Number(minHeightPx) > 0 ? Number(minHeightPx) : 38;
  // 矮条：够辨识即可；表行多时 56–72 根 span 会显著拖垮布局/合成
  const barCount = dense
    ? denseH >= 44
      ? 36
      : 28
    : centeredPack
      ? 18
      : isCompact
        ? emphasized
          ? 36
          : 20
        : WAVE_BAR_COUNT;
  const stripMinH = dense
    ? Math.max(34, denseH)
    : Math.max(
        isCompact ? (emphasized ? 76 : centeredPack ? 44 : 58) : WAVE_STRIP_MIN_H_PX,
        Number(minHeightPx) > 0 ? Number(minHeightPx) : 0,
      );
  const trackMinH = dense
    ? stripMinH
    : Math.max(
        isCompact ? (emphasized ? 60 : centeredPack ? 36 : 40) : WAVE_TRACK_MIN_H_PX,
        Number(minHeightPx) > 0 ? Math.max(40, Number(minHeightPx) - 10) : 0,
      );
  const barMaxW = dense
    ? 'max-w-[3px]'
    : centeredPack
      ? 'w-[2.5px] shrink-0'
      : emphasized
        ? 'max-w-[4px]'
        : isCompact
          ? 'max-w-[2.5px]'
          : 'max-w-[3px]';
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const playbackUrl = useMemo(() => normalizePlayableAudioUrl(src), [src]);
  const clipStart = Math.max(0, Number(clipStartSec) || 0);
  const hasClip =
    Number.isFinite(Number(clipEndSec)) && Number(clipEndSec) > clipStart + 0.05;
  const clipEnd = hasClip ? Number(clipEndSec) : 0;

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    setPlaying(false);
    el.removeAttribute('src');
    // 分镜/视频表行多：默认延迟挂 src，避免一切换阶段就并行 load 几十路 audio
    if (!eagerMedia || !playbackUrl) return;
    el.src = playbackUrl;
    el.load();
  }, [playbackUrl, eagerMedia]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    const onTimeUpdate = () => {
      if (!hasClip) return;
      if (el.currentTime >= clipEnd - 0.02) {
        el.pause();
        try {
          el.currentTime = clipStart;
        } catch {
          /* ignore seek errors */
        }
        setPlaying(false);
      }
    };
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('timeupdate', onTimeUpdate);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('timeupdate', onTimeUpdate);
    };
  }, [playbackUrl, hasClip, clipStart, clipEnd]);

  const togglePlay = useCallback(
    (e?: React.MouseEvent | React.PointerEvent) => {
      e?.stopPropagation();
      e?.preventDefault();
      const a = audioRef.current;
      if (!a || !playbackUrl) return;
      if (a.paused) {
        if (!a.getAttribute('src') && playbackUrl) {
          a.src = playbackUrl;
        }
        if (hasClip) {
          const t = Number(a.currentTime) || 0;
          if (t < clipStart - 0.05 || t >= clipEnd - 0.05) {
            try {
              a.currentTime = clipStart;
            } catch {
              /* ignore */
            }
          }
        }
        void a.play().catch((err) => {
          console.warn('[ReferenceAudioWaveStrip] play failed', err);
        });
      } else {
        a.pause();
      }
    },
    [playbackUrl, hasClip, clipStart, clipEnd],
  );

  const barHeightsPx = useMemo(() => {
    const span = Math.max(isCompact || dense ? 8 : 12, trackMinH - (dense ? 0 : centeredPack ? 4 : 8));
    // dense：条几乎顶满；centeredPack：中等偏高，便于垂直居中且不留大块空底
    const lo = Math.round((dense ? 0.78 : centeredPack ? 0.42 : 0.16) * span);
    const hi = Math.round((dense ? 1 : centeredPack ? 0.92 : 0.98) * span);
    let h = 2166136261;
    const seed = `${playbackUrl || 'empty'}#${clipStart.toFixed(2)}-${hasClip ? clipEnd.toFixed(2) : 'full'}`;
    for (let i = 0; i < seed.length; i += 1) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Array.from({ length: barCount }, (_, i) => {
      h = (Math.imul(h, 1103515245) + 12345 + i) >>> 0;
      return lo + (h % Math.max(1, hi - lo + 1));
    });
  }, [playbackUrl, barCount, trackMinH, isCompact, dense, centeredPack, clipStart, clipEnd, hasClip]);

  const barGrad = dense
    ? isDarkMode
      ? 'bg-violet-300/90'
      : 'bg-violet-600/85'
    : centeredPack
      ? isDarkMode
        ? 'bg-violet-400/90'
        : 'bg-violet-600/80'
      : waveBarGradient(isDarkMode);
  const trackBg = dense
    ? isDarkMode
      ? 'bg-zinc-950'
      : 'bg-zinc-100'
    : centeredPack
      ? isDarkMode
        ? 'bg-black/55'
        : 'bg-violet-100/80'
      : isDarkMode
        ? 'bg-gradient-to-b from-violet-950/90 via-black/70 to-black/85'
        : 'bg-gradient-to-b from-violet-100 to-violet-200/70';
  const outerBorder = isDarkMode ? 'border-violet-500/25' : 'border-violet-400/35';
  const gridCols = centeredPack
    ? undefined
    : ({ gridTemplateColumns: `repeat(${barCount}, minmax(0, 1fr))` } as const);

  const emptyTitle = emptyLabel || '暂无参考音';
  const playTitle = playLabel || (playing ? '点击暂停' : '点击播放');

  if (!String(src || '').trim()) {
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
        const emptyDenseTrack = dense
          ? isDarkMode
            ? 'bg-zinc-950'
            : 'bg-zinc-100'
          : centeredPack
            ? isDarkMode
              ? 'bg-black/55'
              : 'bg-violet-100/80'
            : emptyTrackBg;
        return (
          <div
            className="nodrag w-full overflow-hidden rounded-md cursor-not-allowed opacity-55"
            style={{ minHeight: stripMinH, height: dense || centeredPack ? stripMinH : undefined }}
            title={emptyTitle}
            aria-label={emptyTitle}
          >
            <div
              className={`${
                centeredPack
                  ? 'flex w-full h-full items-center justify-center gap-[3px] rounded-lg px-2 py-1'
                  : `grid w-full min-w-0 items-end gap-px ${
                      dense ? 'h-full rounded-md px-0.5 py-0' : 'rounded-lg px-1.5 py-1'
                    }`
              } ${emptyDenseTrack}`}
              style={{
                ...(gridCols || {}),
                minHeight: trackMinH,
                height: dense || centeredPack ? '100%' : undefined,
              }}
            >
              {barHeightsPx.map((hPx, i) => (
                <span
                  key={i}
                  className={`${
                    centeredPack
                      ? `rounded-full ${emptyBarGrad} opacity-35 ${barMaxW}`
                      : `min-w-0 w-full justify-self-center rounded-t-full ${emptyBarGrad} opacity-35 ${barMaxW}`
                  }`}
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
                className={`min-w-0 w-full justify-self-center rounded-t-full ${emptyBarGrad} opacity-35 ${barMaxW}`}
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
      {/* audio 必须放在 button 外，否则部分环境无法解码/播放 */}
      <audio ref={audioRef} preload="metadata" className="hidden" />
      <div
        role="button"
        tabIndex={0}
        onClick={togglePlay}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            togglePlay(e as unknown as React.MouseEvent);
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
        title={playTitle}
        aria-label={playTitle}
        className={`nodrag nopan w-full overflow-hidden text-left transition-opacity ${
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
        style={{ minHeight: stripMinH, height: dense || centeredPack ? stripMinH : undefined }}
      >
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
          className={`min-w-0 ${
            dense
              ? 'grid w-full h-full items-end gap-px rounded-md px-0.5 py-0'
              : centeredPack
                ? 'flex w-full h-full items-center justify-center gap-[3px] rounded-lg px-2 py-1'
                : compactWaveOnly
                  ? 'grid w-full items-end gap-px rounded-lg px-1.5 py-1'
                  : isCompact
                    ? 'grid flex-1 items-end gap-px rounded-md px-1.5 py-1'
                    : 'grid w-full flex-1 items-end gap-px px-1 py-1'
          } ${trackBg}`}
          style={{
            ...(gridCols || {}),
            minHeight: trackMinH,
            height: dense || centeredPack ? '100%' : undefined,
          }}
        >
          {barHeightsPx.map((hPx, i) => (
            <span
              key={i}
              className={`${
                centeredPack
                  ? `rounded-full origin-center ${barGrad} ${barMaxW}`
                  : `min-w-0 w-full justify-self-center rounded-t-full origin-bottom ${barGrad} ${barMaxW}`
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
      </div>
    </>
  );
});

export { ReferenceAudioWaveStrip };
export default ReferenceAudioWaveStrip;
