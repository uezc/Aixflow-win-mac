/**
 * 剪辑时间轴视频/图片素材条：胶片缩略图填充 + 白框选区（对齐 VideoTrimFilmstripBar 视觉）。
 * 可见区优先抽帧；先出首帧再补胶片；走 videoThumbnails 内存缓存与有限并发。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { normalizeVideoUrl } from '../../utils/normalizeVideoUrl';
import { mapProjectPath } from '../../utils/pathMapper';
import {
  buildFilmstripCacheKey,
  captureVideoFilmstrip,
  invalidateFilmstripCache,
  resetVideoExtractQueue,
} from '../../utils/videoThumbnails';

// 模块加载时清掉历史挂死队列（旧 captureVideoFrame 用 loadeddata 易永久卡住）
resetVideoExtractQueue();

export type TimelineFilmstripClip = {
  id: string;
  type: 'video' | 'image' | 'audio';
  src: string;
  duration: number;
  trimStart?: number;
  trimEnd?: number;
  lockTrim?: boolean;
};

type Props = {
  clip: TimelineFilmstripClip;
  width: number;
  projectId?: string;
  selected: boolean;
  durationSec: number;
  /** 选区左右把手开始拖 trim；不传则仅展示把手样式、不可拖 */
  onTrimEdgePointerDown?: (edge: 'start' | 'end', e: React.PointerEvent) => void;
  /** 边缘裁剪把手 title（i18n） */
  trimEdgeTitle?: string;
  /** 悬浮时左上角音量等控件 */
  overlayTopLeft?: React.ReactNode;
};

const THUMB_WIDTH = 56;

function formatSelDur(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0.00s';
  return `${sec.toFixed(2)}s`;
}

/** 按宽度估算胶片格数；上限 12，优先观感与速度平衡 */
function filmstripFrameCount(width: number): number {
  const cell = 36;
  return Math.max(3, Math.min(12, Math.ceil(Math.max(48, width) / cell)));
}

function filmstripCountBucket(width: number): number {
  return Math.round(filmstripFrameCount(width) / 3) * 3 || 3;
}

/** 与轨道时长算法对齐：尊重显式 trim；未设置则用成片 duration */
function resolveClipTrimRange(clip: TimelineFilmstripClip): { ts: number; te: number } {
  const ts = Math.max(0, clip.trimStart ?? 0);
  let te = clip.trimEnd != null && clip.trimEnd > ts ? clip.trimEnd : clip.duration;
  if (!(te > ts)) te = ts + Math.max(0.1, clip.duration || 0.1);
  return { ts, te };
}

/**
 * 全高连续胶片条（竖幅格），选中时白框 + 粗把手 + 中央时长。
 */
export const TimelineClipFilmstrip: React.FC<Props> = ({
  clip,
  width,
  projectId,
  selected,
  durationSec,
  onTrimEdgePointerDown,
  trimEdgeTitle,
  overlayTopLeft,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [frames, setFrames] = useState<string[]>([]);
  const [imageSrc, setImageSrc] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const loadGenRef = useRef(0);
  const framesAccRef = useRef<string[]>([]);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const countBucket = filmstripCountBucket(width);
  const frameCount = filmstripFrameCount(width);

  const reload = useCallback(() => {
    const { ts, te } = resolveClipTrimRange(clip);
    const rawUrl = normalizeVideoUrl(clip.src);
    invalidateFilmstripCache(
      buildFilmstripCacheKey(rawUrl, ts, te, frameCount, THUMB_WIDTH),
    );
    setFrames([]);
    framesAccRef.current = [];
    setRetryToken((n) => n + 1);
  }, [clip, frameCount]);

  // 可见区优先：进入视口（含左右预加载边距）再抽帧
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        setInView(!!entry?.isIntersecting);
      },
      { root: null, rootMargin: '80px 320px', threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const srcLooksLikeImage = /\.(png|jpe?g|gif|webp|bmp)(?:$|[?#])/i.test(String(clip.src || ''));
  const treatAsImage = clip.type === 'image' || (clip.type === 'video' && srcLooksLikeImage);

  useEffect(() => {
    if (treatAsImage) {
      let cancelled = false;
      setFrames([]);
      setLoading(true);
      setLoadError(null);
      setImageSrc('');
      const rawSrc = String(clip.src || '').trim();
      if (!rawSrc) {
        setLoading(false);
        setLoadError('未绑定素材');
        return;
      }
      const load = async () => {
        const rawUrl = normalizeVideoUrl(rawSrc);
        try {
          const url = projectId ? await mapProjectPath(rawUrl, projectId) : rawUrl;
          if (!cancelled) {
            setImageSrc(url);
            setLoading(false);
          }
        } catch {
          if (!cancelled) {
            setImageSrc(rawUrl);
            setLoading(false);
          }
        }
      };
      void load();
      return () => {
        cancelled = true;
      };
    }

    if (clip.type !== 'video' || !String(clip.src || '').trim()) {
      setFrames([]);
      setImageSrc('');
      setLoading(false);
      setLoadError(String(clip.src || '').trim() ? null : '未绑定素材');
      return;
    }

    // 滚出可视区：中止进行中的抽帧，把并发槽让给可见片段；已出的帧保留不空白
    if (!inView) {
      loadGenRef.current += 1;
      setLoading(false);
      return;
    }

    const ac = new AbortController();
    const gen = ++loadGenRef.current;
    setLoadError(null);
    if (framesAccRef.current.length === 0) {
      setLoading(true);
    }

    const load = async () => {
      try {
        const rawUrl = normalizeVideoUrl(clip.src);
        let url = rawUrl;
        try {
          url = projectId ? await mapProjectPath(rawUrl, projectId) : rawUrl;
        } catch {
          url = rawUrl;
        }
        if (ac.signal.aborted || gen !== loadGenRef.current) return;
        const { ts, te } = resolveClipTrimRange(clip);
        framesAccRef.current = [];
        const knownDur = Math.max(clip.duration || 0, te, 0);
        const { frames: list } = await captureVideoFilmstrip(url, ts, te, frameCount, THUMB_WIDTH, undefined, {
          signal: ac.signal,
          knownDuration: knownDur,
          skipDurationProbe: true,
          priority: selectedRef.current ? 2 : 1,
          onFrame: (frame, index, total) => {
            if (ac.signal.aborted || gen !== loadGenRef.current) return;
            const acc = framesAccRef.current;
            if (acc.length !== total) {
              framesAccRef.current = Array.from({ length: total }, (_, i) => acc[i] || '');
            }
            framesAccRef.current[index] = frame;
            // 有首帧立刻去掉转圈，避免整条胶片抽完才显示
            const partial = framesAccRef.current.filter(Boolean);
            if (partial.length > 0) {
              setFrames(framesAccRef.current.slice());
              setLoading(false);
            }
          },
        });
        if (ac.signal.aborted || gen !== loadGenRef.current) return;
        const ok = list.filter(Boolean);
        if (ok.length === 0) {
          setFrames([]);
          framesAccRef.current = [];
          setLoadError('胶片加载失败');
        } else {
          setFrames(ok);
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
        setFrames([]);
        setLoadError('胶片加载失败');
        setLoading(false);
      }
    };
    void load();
    return () => {
      ac.abort();
    };
  }, [
    clip.id,
    clip.src,
    clip.type,
    treatAsImage,
    clip.trimStart,
    clip.trimEnd,
    clip.duration,
    clip.lockTrim,
    projectId,
    countBucket,
    frameCount,
    retryToken,
    inView,
  ]);

  const cells =
    treatAsImage && imageSrc
      ? Array.from({ length: frameCount }, (_, i) => (
          <div key={i} className="h-full flex-1 overflow-hidden min-w-0">
            <img
              src={imageSrc}
              alt=""
              draggable={false}
              className="h-full w-full object-cover pointer-events-none select-none"
              onError={() => {
                setImageSrc('');
                setLoadError('图片加载失败');
                setLoading(false);
              }}
            />
          </div>
        ))
      : frames.length > 0
        ? (() => {
            const display =
              frames.filter(Boolean).length === 1 && frameCount > 1
                ? Array.from({ length: frameCount }, () => frames.find(Boolean)!)
                : frames.filter(Boolean);
            return display.map((src, i) => (
              <div key={i} className="h-full flex-1 overflow-hidden min-w-0">
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  className="h-full w-full object-cover pointer-events-none select-none"
                />
              </div>
            ));
          })()
        : null;

  return (
    <div ref={hostRef} className="relative h-full w-full overflow-hidden rounded-lg bg-zinc-900">
      <div className={`absolute inset-0 flex ${selected ? '' : 'brightness-[0.72]'}`}>
        {cells}
        {!cells && loading ? (
          <div className="flex h-full w-full items-center justify-center gap-1.5 bg-zinc-900 text-[10px] text-white/70">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            <span>加载胶片…</span>
          </div>
        ) : null}
        {!cells && !loading && loadError === '未绑定素材' ? (
          <div className="flex h-full w-full items-center justify-center bg-zinc-900/95 px-1 text-center text-[10px] text-amber-200/90">
            未绑定素材
          </div>
        ) : null}
        {!cells && !loading && loadError && loadError !== '未绑定素材' ? (
          <button
            type="button"
            className="flex h-full w-full items-center justify-center gap-1.5 bg-zinc-900/95 text-[10px] text-amber-200/90 hover:bg-zinc-800 nodrag nopan"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              reload();
            }}
            title="点击重试"
          >
            <RefreshCw className="h-3.5 w-3.5 shrink-0" />
            <span>{loadError} · 重试</span>
          </button>
        ) : null}
        {!cells && !loading && !loadError ? (
          <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-[10px] text-white/50">
            {inView ? '无预览' : ''}
          </div>
        ) : null}
      </div>

      {selected && cells ? <div className="pointer-events-none absolute inset-0 bg-black/15" /> : null}

      {selected ? (
        <div
          className="pointer-events-none absolute inset-0 z-10 rounded-lg border-2 border-white"
          style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.35)' }}
        >
          <div className="absolute inset-y-0 left-0 w-1.5 rounded-l-[6px] bg-white" />
          <div className="absolute inset-y-0 right-0 w-1.5 rounded-r-[6px] bg-white" />
          <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
            <span className="rounded-md bg-black/65 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white">
              {formatSelDur(durationSec)}
            </span>
          </div>
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-0 z-10 rounded-lg ring-1 ring-white/15">
          <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center opacity-80">
            <span className="rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white/90">
              {formatSelDur(durationSec)}
            </span>
          </div>
        </div>
      )}

      {onTrimEdgePointerDown ? (
        <>
          <div
            className="absolute inset-y-0 left-0 z-20 w-3.5 cursor-ew-resize nodrag nopan"
            title={trimEdgeTitle}
            aria-label={trimEdgeTitle}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onTrimEdgePointerDown('start', e);
            }}
          >
            <div
              className={`pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-l-[6px] bg-white shadow-sm transition-opacity ${
                selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
            />
          </div>
          <div
            className="absolute inset-y-0 right-0 z-20 w-3.5 cursor-ew-resize nodrag nopan"
            title={trimEdgeTitle}
            aria-label={trimEdgeTitle}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onTrimEdgePointerDown('end', e);
            }}
          >
            <div
              className={`pointer-events-none absolute inset-y-0 right-0 w-1.5 rounded-r-[6px] bg-white shadow-sm transition-opacity ${
                selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
            />
          </div>
        </>
      ) : null}

      {overlayTopLeft ? (
        <div
          className={`absolute left-1.5 top-1 z-30 flex items-center gap-1 rounded bg-black/45 px-1 py-0.5 transition-opacity ${
            selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {overlayTopLeft}
        </div>
      ) : null}
    </div>
  );
};

export default TimelineClipFilmstrip;
