/**
 * 剪辑时间轴视频/图片素材条：胶片缩略图填充 + 白框选区（对齐 VideoTrimFilmstripBar 视觉）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { normalizeVideoUrl } from '../../utils/normalizeVideoUrl';
import { mapProjectPath } from '../../utils/pathMapper';
import { captureVideoFilmstrip, resetVideoExtractQueue } from '../../utils/videoThumbnails';

// 模块加载时清掉历史挂死队列（旧 captureVideoFrame 用 loadeddata 易永久卡住）
resetVideoExtractQueue();

export type TimelineFilmstripClip = {
  id: string;
  type: 'video' | 'image' | 'audio';
  src: string;
  duration: number;
  trimStart?: number;
  trimEnd?: number;
};

type Props = {
  clip: TimelineFilmstripClip;
  width: number;
  projectId?: string;
  selected: boolean;
  durationSec: number;
  /** 选区左右把手开始拖 trim；不传则仅展示把手样式、不可拖 */
  onTrimEdgePointerDown?: (edge: 'start' | 'end', e: React.PointerEvent) => void;
  /** 悬浮时左上角音量等控件 */
  overlayTopLeft?: React.ReactNode;
};

function formatSelDur(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0.00s';
  return `${sec.toFixed(2)}s`;
}

/** 按宽度估算胶片格数；上限 24（与裁剪胶片一致），避免过重 */
function filmstripFrameCount(width: number): number {
  const cell = 28;
  return Math.max(4, Math.min(24, Math.ceil(Math.max(48, width) / cell)));
}

function filmstripCountBucket(width: number): number {
  return Math.round(filmstripFrameCount(width) / 4) * 4 || 4;
}

/** 与轨道时长算法对齐：trimEnd 占位短值时用 duration */
function resolveClipTrimRange(clip: TimelineFilmstripClip): { ts: number; te: number } {
  const ts = Math.max(0, clip.trimStart ?? 0);
  let te = clip.trimEnd ?? clip.duration;
  if (clip.duration > te + 0.5) te = clip.duration;
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
  overlayTopLeft,
}) => {
  const [frames, setFrames] = useState<string[]>([]);
  const [imageSrc, setImageSrc] = useState('');
  const [loading, setLoading] = useState(clip.type === 'video');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const loadGenRef = useRef(0);
  const countBucket = filmstripCountBucket(width);
  const frameCount = filmstripFrameCount(width);

  const reload = useCallback(() => {
    resetVideoExtractQueue();
    setRetryToken((n) => n + 1);
  }, []);

  useEffect(() => {
    if (clip.type === 'image') {
      let cancelled = false;
      setLoading(true);
      setLoadError(null);
      const load = async () => {
        const rawUrl = normalizeVideoUrl(clip.src);
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

    if (clip.type !== 'video' || !clip.src) {
      setFrames([]);
      setLoading(false);
      setLoadError(clip.src ? null : '无视频源');
      return;
    }

    const ac = new AbortController();
    const gen = ++loadGenRef.current;
    setLoading(true);
    setLoadError(null);

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
        const { frames: list } = await captureVideoFilmstrip(url, ts, te, frameCount, 72, undefined, ac.signal);
        if (ac.signal.aborted || gen !== loadGenRef.current) return;
        const ok = list.filter(Boolean);
        if (ok.length === 0) {
          setFrames([]);
          setLoadError('胶片加载失败');
        } else {
          setFrames(ok);
          setLoadError(null);
        }
        setLoading(false);
      } catch (err) {
        if (ac.signal.aborted || (err as { name?: string })?.name === 'AbortError' || gen !== loadGenRef.current) {
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
    clip.trimStart,
    clip.trimEnd,
    clip.duration,
    projectId,
    countBucket,
    frameCount,
    retryToken,
  ]);

  const cells =
    clip.type === 'image' && imageSrc
      ? Array.from({ length: frameCount }, (_, i) => (
          <div key={i} className="h-full flex-1 overflow-hidden min-w-0">
            <img
              src={imageSrc}
              alt=""
              draggable={false}
              className="h-full w-full object-cover pointer-events-none select-none"
            />
          </div>
        ))
      : frames.length > 0
        ? frames.map((src, i) => (
            <div key={i} className="h-full flex-1 overflow-hidden min-w-0">
              <img
                src={src}
                alt=""
                draggable={false}
                className="h-full w-full object-cover pointer-events-none select-none"
              />
            </div>
          ))
        : null;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg bg-zinc-900">
      <div className={`absolute inset-0 flex ${selected ? '' : 'brightness-[0.72]'}`}>
        {cells}
        {!cells && loading ? (
          <div className="flex h-full w-full items-center justify-center gap-1.5 bg-zinc-900 text-[10px] text-white/70">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            <span>加载胶片…</span>
          </div>
        ) : null}
        {!cells && !loading && loadError ? (
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
          <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-[10px] text-white/50">无预览</div>
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

      {selected && onTrimEdgePointerDown ? (
        <>
          <div
            className="absolute inset-y-0 left-0 z-20 w-3 cursor-ew-resize nodrag nopan"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onTrimEdgePointerDown('start', e);
            }}
          />
          <div
            className="absolute inset-y-0 right-0 z-20 w-3 cursor-ew-resize nodrag nopan"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onTrimEdgePointerDown('end', e);
            }}
          />
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
