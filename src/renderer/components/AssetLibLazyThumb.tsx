import React, { useEffect, useRef, useState } from 'react';

type Props = {
  src: string;
  className?: string;
  imgClassName?: string;
  alt?: string;
  /** 列表缩略边长，默认 256 */
  maxEdge?: number;
  placeholderClassName?: string;
};

/** 限制同时生成缩略图的数量，避免打开素材库时打满 CPU */
const MAX_PARALLEL = 3;
let running = 0;
const waitQueue: Array<() => void> = [];

async function withThumbSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) {
    await new Promise<void>((resolve) => waitQueue.push(resolve));
  }
  running += 1;
  try {
    return await fn();
  } finally {
    running = Math.max(0, running - 1);
    const next = waitQueue.shift();
    if (next) next();
  }
}

const thumbCache = new Map<string, string>();

/**
 * 资产库缩略图：先占位秒开列表，进入视口后再异步生成/读取 256px 缓存图。
 * 避免场景/角色原图 0.5–3MB 在列表里全量解码。
 */
const AssetLibLazyThumb: React.FC<Props> = ({
  src,
  className,
  imgClassName = 'h-full w-full object-cover',
  alt = '',
  maxEdge = 256,
  placeholderClassName = 'bg-black/20',
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [displaySrc, setDisplaySrc] = useState(() => thumbCache.get(`${src}|${maxEdge}`) || '');

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '120px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const key = `${src}|${maxEdge}`;
    const cached = thumbCache.get(key);
    if (cached) {
      setDisplaySrc(cached);
      return;
    }
    if (!visible || !src.trim()) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await withThumbSlot(async () => {
          if (!window.electronAPI?.ensureLibraryListThumb) return null;
          return window.electronAPI.ensureLibraryListThumb(src, maxEdge);
        });
        const url = result?.success && result.thumbUrl ? result.thumbUrl : src;
        thumbCache.set(key, url);
        if (!cancelled) setDisplaySrc(url);
      } catch {
        thumbCache.set(key, src);
        if (!cancelled) setDisplaySrc(src);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, src, maxEdge]);

  return (
    <div ref={hostRef} className={className}>
      {displaySrc ? (
        <img src={displaySrc} alt={alt} className={imgClassName} draggable={false} decoding="async" />
      ) : (
        <div className={`h-full w-full ${placeholderClassName}`} aria-hidden />
      )}
    </div>
  );
};

export default AssetLibLazyThumb;
