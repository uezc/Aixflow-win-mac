import React, { useEffect, useState } from 'react';

type Props = {
  src: string;
  className?: string;
  imgClassName?: string;
  imgStyle?: React.CSSProperties;
  alt?: string;
  /** 列表小图边长；有值时优先走磁盘缩略图，避免原图解码撑爆堆 */
  maxEdge?: number;
  /** 同 URL 重新生成后用来拆缓存（如 asset_version） */
  cacheNonce?: string | number;
  placeholderClassName?: string;
};

const thumbMemo = new Map<string, string>();

function isLocalMediaUrl(raw: string): boolean {
  return (
    raw.startsWith('local-resource://') ||
    raw.startsWith('file://') ||
    /^[A-Za-z]:[\\/]/.test(raw) ||
    raw.startsWith('/')
  );
}

function memoKey(raw: string, edge: number, nonce = ''): string {
  return nonce ? `${raw}::${edge}::${nonce}` : `${raw}::${edge}`;
}

function peekCachedThumb(raw: string, edge: number, nonce = ''): string {
  const key = memoKey(raw, edge, nonce);
  const hit = thumbMemo.get(key);
  if (hit) return hit;
  const api = window.electronAPI;
  if (!api?.peekLibraryListThumb) return '';
  try {
    const r = api.peekLibraryListThumb(raw, edge);
    const thumb = String(r?.thumbUrl || '').trim();
    if (r?.success && thumb) {
      thumbMemo.set(key, thumb);
      return thumb;
    }
  } catch {
    /* 同步探缓存失败则走异步 */
  }
  return '';
}

/**
 * 列表预览：本地图用 ensureLibraryListThumb 出小 JPEG；远程/失败时回退原图。
 * 启动时禁止先解原图，否则定妆四宫格会把卡片撑成全黑好几秒。
 */
export const GatedOriginalImg: React.FC<{
  src: string;
  className?: string;
  alt?: string;
  style?: React.CSSProperties;
  maxEdge?: number;
}> = ({ src, className, alt = '', style, maxEdge }) => {
  return (
    <AssetLibLazyThumb
      src={src}
      className={className}
      imgClassName="h-full w-full object-cover"
      imgStyle={style}
      alt={alt}
      maxEdge={maxEdge}
    />
  );
};

const AssetLibLazyThumb: React.FC<Props> = ({
  src,
  className,
  imgClassName = 'h-full w-full object-cover',
  imgStyle,
  alt = '',
  maxEdge,
  cacheNonce,
  placeholderClassName = 'bg-black/20',
}) => {
  const raw = String(src || '').trim();
  const edge = Math.max(0, Math.round(Number(maxEdge) || 0));
  const nonce = String(cacheNonce ?? '').trim();
  const useThumb = !!raw && edge >= 32 && isLocalMediaUrl(raw);
  const [displaySrc, setDisplaySrc] = useState(() =>
    useThumb ? peekCachedThumb(raw, edge, nonce) : raw,
  );

  useEffect(() => {
    let cancelled = false;
    if (!raw) {
      setDisplaySrc('');
      return;
    }
    if (!useThumb) {
      setDisplaySrc(raw);
      return;
    }

    const cached = peekCachedThumb(raw, edge, nonce);
    if (cached) {
      setDisplaySrc(cached);
      return;
    }

    setDisplaySrc('');
    const api = window.electronAPI;
    if (!api?.ensureLibraryListThumb) {
      setDisplaySrc(raw);
      return;
    }

    void (async () => {
      try {
        const r = await api.ensureLibraryListThumb(raw, edge);
        const thumb = String(r?.thumbUrl || '').trim();
        if (cancelled) return;
        if (r?.success && thumb) {
          thumbMemo.set(memoKey(raw, edge, nonce), thumb);
          setDisplaySrc(thumb);
          return;
        }
      } catch {
        /* 回退原图 */
      }
      if (!cancelled) setDisplaySrc(raw);
    })();

    return () => {
      cancelled = true;
    };
  }, [raw, edge, useThumb, nonce]);

  if (!raw) {
    return (
      <div className={className} style={imgStyle}>
        <div className={`h-full w-full ${placeholderClassName}`} aria-hidden />
      </div>
    );
  }

  if (!displaySrc) {
    return (
      <div className={className} style={imgStyle}>
        <div
          className={`h-full w-full animate-pulse ${placeholderClassName}`}
          style={imgStyle}
          aria-hidden
        />
      </div>
    );
  }

  return (
    <div className={className}>
      <img
        src={displaySrc}
        alt={alt}
        className={imgClassName}
        style={imgStyle}
        draggable={false}
        decoding="async"
        loading="eager"
      />
    </div>
  );
};

export default AssetLibLazyThumb;
