import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, RefreshCw, X } from 'lucide-react';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { normalizeVideoUrl } from '../../utils/normalizeVideoUrl';
import { captureVideoFilmstrip } from '../../utils/videoThumbnails';

type FilmFrame = { t: number; dataUrl: string };

export type FilmstripSmartSegment = {
  startSec: number;
  endSec: number;
  score: number;
  posterUrl?: string;
};

/** 智能剪辑预览：与手动裁剪共用同一条胶片轨道 */
export type FilmstripSmartReview = {
  analyzing: boolean;
  analyzeProgress: number;
  exporting: boolean;
  exportProgress: number;
  segments: FilmstripSmartSegment[];
  selectedIndexes: Set<number>;
  activeIndex: number;
  onToggleSelect: (index: number) => void;
  onSelectActive: (index: number) => void;
  onRetry: () => void;
  onConfirm: () => void;
  onCancel: () => void;
};

type Props = {
  videoUrl: string;
  isDarkMode: boolean;
  initialTrimStart: number;
  initialTrimEnd: number;
  trimming: boolean;
  trimError?: string | null;
  /** 选区变化时回调（用于同步节点预览进度）；智能模式下点选镜头也会回调 */
  onRangeChange?: (start: number, end: number) => void;
  onConfirm: (trimStart: number, trimEnd: number) => void;
  onCancel: () => void;
  /** 非空时进入智能剪辑预览（与手动裁剪共用胶片条） */
  smartReview?: FilmstripSmartReview | null;
  /**
   * 已知媒体时长（秒）。有值时跳过 ffmpeg 探时长，并立刻可拖选区；
   * 与剪辑时间轴 TimelineClipFilmstrip 同一套加速策略。
   */
  knownDuration?: number;
};

/** 与时间轴胶片一致的低分辨率格宽；上限格数控制抽帧成本 */
const THUMB_WIDTH = 56;
const MAX_FRAME_COUNT = 12;
const MIN_TRIM_SEC = 0.1;
/** 打开胶片条时默认选区长度（秒）；视频更短则选满长 */
const DEFAULT_TRIM_SEC = 3;
/** ←→ / 滚轮微调步长（秒） */
const NUDGE_SEC = 0.05;
const NUDGE_SEC_FAST = 0.25;

function formatDur(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0.00s';
  return `${s.toFixed(2)}s`;
}

function formatSecShort(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0.0s';
  return `${s.toFixed(1)}s`;
}

function filmstripFrameCount(width: number): number {
  const cell = 40;
  return Math.max(4, Math.min(MAX_FRAME_COUNT, Math.ceil(Math.max(80, width) / cell)));
}

function filmstripCountBucket(width: number): number {
  return Math.round(filmstripFrameCount(width) / 3) * 3 || 3;
}

function buildInitialTrim(
  duration: number,
  initialTrimStart: number,
  initialTrimEnd: number,
): { start: number; end: number } {
  const s0 = Math.max(0, Math.min(initialTrimStart || 0, Math.max(duration - MIN_TRIM_SEC, 0)));
  const preferEnd =
    initialTrimEnd > s0 + MIN_TRIM_SEC && Number.isFinite(initialTrimEnd)
      ? initialTrimEnd
      : s0 + DEFAULT_TRIM_SEC;
  const e0 = Math.min(duration > 0 ? duration : preferEnd, Math.max(preferEnd, s0 + MIN_TRIM_SEC));
  return { start: s0, end: e0 };
}

function Keycap({
  children,
  isDarkMode,
  wide,
}: {
  children: React.ReactNode;
  isDarkMode: boolean;
  wide?: boolean;
}) {
  return (
    <span
      className={`inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-md border px-1.5 text-[10px] font-medium leading-none tabular-nums ${
        wide ? 'px-2' : ''
      } ${
        isDarkMode
          ? 'border-white/15 bg-white/10 text-white/90 shadow-[inset_0_-1px_0_rgba(0,0,0,0.35)]'
          : 'border-gray-300 bg-gray-100 text-gray-700 shadow-[inset_0_-1px_0_rgba(0,0,0,0.06)]'
      }`}
    >
      {children}
    </span>
  );
}

/**
 * 图一风格：底部胶片条。
 * - 手动：拖选单一区间裁剪
 * - 智能剪辑：同一条胶片上预览/多选镜头，确认后导出
 */
export const VideoTrimFilmstripBar: React.FC<Props> = ({
  videoUrl,
  isDarkMode,
  initialTrimStart,
  initialTrimEnd,
  trimming,
  trimError,
  onRangeChange,
  onConfirm,
  onCancel,
  smartReview = null,
  knownDuration = 0,
}) => {
  const { locale } = useAppLocale();
  const trackRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<'start' | 'end' | 'move' | null>(null);
  const moveOriginRef = useRef({ x: 0, start: 0, end: 0 });
  const rangeRef = useRef({ start: 0, end: 0 });
  const loadGenRef = useRef(0);
  const framesAccRef = useRef<string[]>([]);
  const trimInitedForUrlRef = useRef('');

  const smartActive = !!smartReview;
  const smartBusy = !!(smartReview?.analyzing || smartReview?.exporting);

  const [trackWidth, setTrackWidth] = useState(320);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [duration, setDuration] = useState(() => (Number(knownDuration) > 0.2 ? Number(knownDuration) : 0));
  const [frames, setFrames] = useState<FilmFrame[]>([]);
  const [trimStart, setTrimStart] = useState(initialTrimStart);
  const [trimEnd, setTrimEnd] = useState(initialTrimEnd);

  rangeRef.current = { start: trimStart, end: trimEnd };
  const countBucket = filmstripCountBucket(trackWidth);
  const frameCount = filmstripFrameCount(trackWidth);
  const knownDur = Number(knownDuration) > 0.2 ? Number(knownDuration) : 0;

  // 量轨宽 → 按宽度估格数（与时间轴胶片同一思路）
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 8) setTrackWidth(w);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const applyInitialTrimIfNeeded = useCallback(
    (d: number, url: string) => {
      if (!(d > 0.05) || trimInitedForUrlRef.current === url) return;
      trimInitedForUrlRef.current = url;
      const { start, end } = buildInitialTrim(d, initialTrimStart, initialTrimEnd);
      setTrimStart(start);
      setTrimEnd(end);
    },
    [initialTrimStart, initialTrimEnd],
  );

  // 换源时允许重新初始化选区，并清空旧胶片
  useEffect(() => {
    trimInitedForUrlRef.current = '';
    framesAccRef.current = [];
    setFrames([]);
  }, [videoUrl]);

  // 有 knownDuration 时立刻可拖选，不必等胶片抽完
  useEffect(() => {
    if (knownDur <= 0) return;
    setDuration(knownDur);
    applyInitialTrimIfNeeded(knownDur, videoUrl);
  }, [knownDur, videoUrl, applyInitialTrimIfNeeded]);

  useEffect(() => {
    if (!videoUrl) {
      setLoading(false);
      setLoadError(locale === 'en' ? 'Failed to load filmstrip' : '胶片预览加载失败');
      return;
    }

    const ac = new AbortController();
    const gen = ++loadGenRef.current;
    const url = normalizeVideoUrl(videoUrl);
    framesAccRef.current = [];
    setLoadError(null);
    if (knownDur > 0) {
      setDuration(knownDur);
      applyInitialTrimIfNeeded(knownDur, videoUrl);
    }
    setLoading(true);

    const load = async () => {
      try {
        const trimEndHint = knownDur > 0 ? knownDur : 1e6;
        const { frames: list, duration: d } = await captureVideoFilmstrip(
          url,
          0,
          trimEndHint,
          frameCount,
          THUMB_WIDTH,
          undefined,
          {
            signal: ac.signal,
            knownDuration: knownDur > 0 ? knownDur : undefined,
            skipDurationProbe: knownDur > 0,
            priority: 3,
            onFrame: (frame, index, total) => {
              if (ac.signal.aborted || gen !== loadGenRef.current) return;
              const acc = framesAccRef.current;
              if (acc.length !== total) {
                framesAccRef.current = Array.from({ length: total }, (_, i) => acc[i] || '');
              }
              framesAccRef.current[index] = frame;
              const partial = framesAccRef.current;
              const filled = partial.filter(Boolean);
              if (filled.length === 0) return;
              // 未出齐时用首帧填空位，避免胶片条空洞；t 仅作 key
              setFrames(
                partial.map((dataUrl, i) => ({
                  t: i,
                  dataUrl: dataUrl || filled[0],
                })),
              );
              // 有首帧立刻去掉全幅转圈
              setLoading(false);
            },
          },
        );
        if (ac.signal.aborted || gen !== loadGenRef.current) return;
        const dur = d > 0.2 ? d : knownDur;
        if (dur > 0) {
          setDuration(dur);
          applyInitialTrimIfNeeded(dur, videoUrl);
        }
        const ok = list.filter(Boolean);
        if (ok.length === 0) {
          setFrames([]);
          framesAccRef.current = [];
          setLoadError(locale === 'en' ? 'Failed to load filmstrip' : '胶片预览加载失败');
        } else {
          const n = ok.length;
          setFrames(
            ok.map((dataUrl, i) => ({
              t: n === 1 ? 0 : (Math.max(dur, 0.05) * i) / Math.max(n - 1, 1),
              dataUrl,
            })),
          );
          framesAccRef.current = ok;
          setLoadError(null);
        }
        setLoading(false);
      } catch (err) {
        if (ac.signal.aborted || (err as { name?: string })?.name === 'AbortError' || gen !== loadGenRef.current) {
          return;
        }
        if (framesAccRef.current.some(Boolean)) {
          setLoading(false);
          return;
        }
        setLoadError(locale === 'en' ? 'Failed to load filmstrip' : '胶片预览加载失败');
        setLoading(false);
      }
    };
    void load();
    return () => ac.abort();
    // initialTrim* 仅在 applyInitialTrimIfNeeded 内读取；随 videoUrl 重抽
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl, knownDur, countBucket, frameCount, locale]);

  useEffect(() => {
    if (smartActive) return;
    onRangeChange?.(trimStart, trimEnd);
  }, [trimStart, trimEnd, onRangeChange, smartActive]);

  /** 智能模式下：激活镜头时同步预览与内部选区 */
  useEffect(() => {
    if (!smartReview || smartReview.analyzing) return;
    const seg = smartReview.segments[smartReview.activeIndex];
    if (!seg) return;
    setTrimStart(seg.startSec);
    setTrimEnd(seg.endSec);
    onRangeChange?.(seg.startSec, seg.endSec);
    // 仅随激活镜头切换；勿依赖 onRangeChange 引用，避免父级重渲染循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smartReview?.activeIndex, smartReview?.analyzing, smartActive]);

  const pct = useCallback((t: number) => (duration > 0 ? (t / duration) * 100 : 0), [duration]);

  const clientXToTime = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || duration <= 0) return 0;
      const rect = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(rect.width, 1)));
      return x * duration;
    },
    [duration]
  );

  const setRange = useCallback((start: number, end: number) => {
    const s = Math.max(0, Math.min(start, end - MIN_TRIM_SEC));
    const e = Math.min(duration || end, Math.max(end, s + MIN_TRIM_SEC));
    setTrimStart(s);
    setTrimEnd(e);
  }, [duration]);

  const nudgeSelection = useCallback(
    (deltaSec: number) => {
      if (smartActive || duration <= 0 || trimming || (loadError && frames.length === 0)) return;
      const { start, end } = rangeRef.current;
      const len = Math.max(MIN_TRIM_SEC, end - start);
      let ns = start + deltaSec;
      let ne = ns + len;
      if (ns < 0) {
        ns = 0;
        ne = len;
      }
      if (ne > duration) {
        ne = duration;
        ns = Math.max(0, duration - len);
      }
      setRange(ns, ne);
    },
    [duration, trimming, loadError, frames.length, setRange, smartActive]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (smartActive || trimming || (loadError && frames.length === 0) || duration <= 0) return;
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement | null)?.isContentEditable) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation();
      const step = e.shiftKey ? NUDGE_SEC_FAST : NUDGE_SEC;
      nudgeSelection(e.key === 'ArrowLeft' ? -step : step);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [trimming, loadError, frames.length, duration, nudgeSelection, smartActive]);

  useEffect(() => {
    barRef.current?.focus({ preventScroll: true });
  }, [smartActive]);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (smartActive || trimming || (loadError && frames.length === 0) || duration <= 0) return;
      e.preventDefault();
      e.stopPropagation();
      const step = e.shiftKey ? NUDGE_SEC_FAST : NUDGE_SEC;
      nudgeSelection(e.deltaY > 0 ? step : -step);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [trimming, loadError, frames.length, duration, nudgeSelection, smartActive]);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (smartActive) return;
      const mode = dragRef.current;
      if (!mode || duration <= 0) return;
      const t = clientXToTime(e.clientX);
      const { start, end } = rangeRef.current;
      if (mode === 'start') {
        setRange(Math.min(t, end - MIN_TRIM_SEC), end);
      } else if (mode === 'end') {
        setRange(start, Math.max(t, start + MIN_TRIM_SEC));
      } else if (mode === 'move') {
        const dx = e.clientX - moveOriginRef.current.x;
        const el = trackRef.current;
        if (!el) return;
        const dt = (dx / Math.max(el.getBoundingClientRect().width, 1)) * duration;
        let ns = moveOriginRef.current.start + dt;
        let ne = moveOriginRef.current.end + dt;
        const len = moveOriginRef.current.end - moveOriginRef.current.start;
        if (ns < 0) {
          ns = 0;
          ne = len;
        }
        if (ne > duration) {
          ne = duration;
          ns = duration - len;
        }
        setRange(ns, ne);
      }
    },
    [clientXToTime, duration, setRange, smartActive]
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  const startDrag = useCallback(
    (mode: 'start' | 'end' | 'move') => (e: React.PointerEvent) => {
      if (smartActive) return;
      e.stopPropagation();
      e.preventDefault();
      dragRef.current = mode;
      moveOriginRef.current = {
        x: e.clientX,
        start: rangeRef.current.start,
        end: rangeRef.current.end,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [smartActive]
  );

  const selLeft = pct(trimStart);
  const selWidth = Math.max(pct(trimEnd) - pct(trimStart), 1.5);
  const selDur = Math.max(0, trimEnd - trimStart);
  const selectedCount = smartReview?.selectedIndexes.size ?? 0;

  const title = useMemo(() => {
    if (smartActive) return locale === 'en' ? 'Smart edit' : '智能剪辑';
    return null;
  }, [locale, smartActive]);

  const statusLine = useMemo(() => {
    if (smartReview?.exporting) {
      return locale === 'en'
        ? `Exporting (${Math.round(smartReview.exportProgress)}%)`
        : `导出中 (${Math.round(smartReview.exportProgress)}%)`;
    }
    if (smartReview?.analyzing) {
      return locale === 'en'
        ? `Analyzing (${Math.round(smartReview.analyzeProgress)}%)`
        : `分析中 (${Math.round(smartReview.analyzeProgress)}%)`;
    }
    if (smartActive) {
      return locale === 'en'
        ? `${selectedCount} shot(s) selected · Confirm to export`
        : `已选 ${selectedCount} 镜 · 确认后导出为画布模块`;
    }
    return null;
  }, [locale, smartActive, smartReview, selectedCount]);

  const handleCancel = () => {
    if (smartActive) {
      if (!smartBusy) smartReview?.onCancel();
      return;
    }
    if (!trimming) onCancel();
  };

  const handleConfirm = () => {
    if (smartActive) {
      if (!smartBusy && selectedCount > 0) smartReview?.onConfirm();
      return;
    }
    onConfirm(trimStart, trimEnd);
  };

  const keyMuted = isDarkMode ? 'text-white/45' : 'text-gray-500';

  return (
    <div
      ref={barRef}
      className={`nexflow-video-trim-bar nodrag nopan mt-1.5 box-border w-full min-w-full max-w-full shrink-0 rounded-2xl border px-2.5 py-2.5 outline-none ${
        isDarkMode ? 'border-white/12 bg-black/70 text-white backdrop-blur-md' : 'border-gray-200 bg-white/95 text-gray-900 shadow-lg'
      }`}
      style={{ width: '100%' }}
      tabIndex={0}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {smartActive || smartBusy ? (
        <div className={`mb-1.5 flex h-4 items-center justify-center gap-1.5 text-[11px] ${isDarkMode ? 'text-white/55' : 'text-gray-500'}`}>
          {smartBusy ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-sky-400" /> : null}
          {title ? <span className="shrink-0 font-medium">{title}</span> : null}
        </div>
      ) : null}

      <div className="flex w-full min-w-0 items-center gap-2">
        <button
          type="button"
          disabled={trimming || smartBusy}
          onClick={handleCancel}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors ${
            isDarkMode
              ? 'border-white/20 bg-white/8 hover:bg-white/14 disabled:opacity-40'
              : 'border-gray-200 bg-gray-50 hover:bg-gray-100 disabled:opacity-40'
          }`}
          title={locale === 'en' ? 'Cancel' : '取消'}
          aria-label={locale === 'en' ? 'Cancel' : '取消'}
        >
          <X className="h-4 w-4" />
        </button>

        <div
          ref={trackRef}
          className={`relative h-[64px] min-w-0 flex-1 basis-0 overflow-hidden rounded-xl ${
            isDarkMode ? 'bg-white/5 ring-1 ring-white/10' : 'bg-gray-100 ring-1 ring-gray-200'
          }`}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {loadError && frames.length === 0 && duration <= 0 ? (
            <div className="flex h-full items-center justify-center px-2 text-center text-[11px] text-red-400">{loadError}</div>
          ) : frames.length === 0 && loading && duration <= 0 ? (
            <div className="flex h-full items-center justify-center gap-2 text-[11px] opacity-70">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {locale === 'en' ? 'Loading filmstrip…' : '加载胶片…'}
            </div>
          ) : (
            <>
              <div className="absolute inset-0 flex">
                {frames.length > 0
                  ? frames.map((f, i) => (
                      <div key={`${f.t}-${i}`} className="h-full flex-1 overflow-hidden">
                        <img src={f.dataUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                      </div>
                    ))
                  : null}
              </div>
              {loading ? (
                <div className="pointer-events-none absolute right-1.5 top-1.5 z-30 flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white/85">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {frames.length === 0 ? (
                    <span>{locale === 'en' ? 'Film…' : '胶片…'}</span>
                  ) : null}
                </div>
              ) : null}

              {smartActive ? (
                <>
                  {/* 智能模式：整轨压暗，再高亮已选镜头区间 */}
                  <div className="pointer-events-none absolute inset-0 bg-black/50" />
                  {smartReview.analyzing && smartReview.segments.length === 0 ? (
                    <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-black/35 text-[11px] text-white">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {locale === 'en' ? 'Detecting shots…' : '正在检测镜头…'}
                    </div>
                  ) : (
                    smartReview.segments.map((seg, i) => {
                      const left = pct(seg.startSec);
                      const width = Math.max(pct(seg.endSec) - left, 1.2);
                      const selected = smartReview.selectedIndexes.has(i);
                      const active = smartReview.activeIndex === i;
                      return (
                        <button
                          key={`${seg.startSec}-${seg.endSec}-${i}`}
                          type="button"
                          disabled={smartBusy}
                          onClick={(e) => {
                            e.stopPropagation();
                            smartReview.onSelectActive(i);
                            if (active && selected) smartReview.onToggleSelect(i);
                            else if (!selected) smartReview.onToggleSelect(i);
                          }}
                          className={`absolute inset-y-1 z-10 overflow-hidden rounded-md border-2 transition-all ${
                            selected
                              ? 'border-sky-400 bg-transparent shadow-[0_0_0_1px_rgba(56,189,248,0.35)]'
                              : 'border-white/25 opacity-70 hover:opacity-90'
                          } ${active ? 'ring-1 ring-white/70' : ''}`}
                          style={{ left: `${left}%`, width: `${width}%` }}
                          title={`${formatSecShort(seg.startSec)} – ${formatSecShort(seg.endSec)}`}
                        >
                          <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/55 px-0.5 py-0.5 text-center text-[9px] text-white tabular-nums">
                            {formatSecShort(seg.endSec - seg.startSec)}
                          </span>
                        </button>
                      );
                    })
                  )}
                </>
              ) : (
                <>
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
                        {formatDur(selDur)}
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
                </>
              )}
            </>
          )}
        </div>

        {smartActive ? (
          <button
            type="button"
            disabled={smartBusy}
            onClick={() => smartReview?.onRetry()}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors ${
              isDarkMode
                ? 'border-white/20 bg-white/8 hover:bg-white/14 disabled:opacity-40'
                : 'border-gray-200 bg-gray-50 hover:bg-gray-100 disabled:opacity-40'
            }`}
            title={locale === 'en' ? 'Re-analyze' : '重新分析'}
            aria-label={locale === 'en' ? 'Re-analyze' : '重新分析'}
          >
            <RefreshCw className={`h-4 w-4 ${smartReview?.analyzing ? 'animate-spin' : ''}`} />
          </button>
        ) : null}

        <button
          type="button"
          disabled={
            smartActive
              ? smartBusy || selectedCount === 0
              : trimming ||
                duration <= 0 ||
                (!!loadError && frames.length === 0) ||
                trimEnd - trimStart < MIN_TRIM_SEC
          }
          onClick={handleConfirm}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
          title={
            smartActive
              ? locale === 'en'
                ? 'Export selected shots'
                : '导出选中镜头'
              : locale === 'en'
                ? 'Confirm trim'
                : '确认裁剪'
          }
          aria-label={
            smartActive
              ? locale === 'en'
                ? 'Export selected shots'
                : '导出选中镜头'
              : locale === 'en'
                ? 'Confirm trim'
                : '确认裁剪'
          }
        >
          {trimming || smartReview?.exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" strokeWidth={2.5} />
          )}
        </button>
      </div>

      {statusLine ? (
        <p className={`mt-1.5 text-center text-[10px] leading-relaxed ${keyMuted}`}>{statusLine}</p>
      ) : !smartActive ? (
        <div
          className={`mt-2 flex w-full min-w-0 flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-[10px] ${keyMuted}`}
          aria-label={
            locale === 'en'
              ? 'Shift + Left / Right: move trim region in larger steps'
              : 'Shift + ← / →：大步移动裁剪区'
          }
        >
          <Keycap isDarkMode={isDarkMode} wide>
            Shift
          </Keycap>
          <Keycap isDarkMode={isDarkMode}>+</Keycap>
          <Keycap isDarkMode={isDarkMode}>←</Keycap>
          <Keycap isDarkMode={isDarkMode}>/</Keycap>
          <Keycap isDarkMode={isDarkMode}>→</Keycap>
          <span className="ml-0.5">
            {locale === 'en' ? 'Large step move trim region' : '大步移动裁剪区'}
          </span>
        </div>
      ) : null}

      {trimError && !smartActive ? <p className="mt-1 text-center text-[11px] text-red-400">{trimError}</p> : null}
    </div>
  );
};

export default VideoTrimFilmstripBar;
