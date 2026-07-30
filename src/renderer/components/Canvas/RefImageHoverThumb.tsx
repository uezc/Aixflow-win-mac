import React, { useCallback, useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

type Props = {
  url: string;
  alt?: string;
  title?: string;
  /** 角标序号，悬停时显示在右下 */
  indexLabel?: string | number;
  /** 点击删除；不传则不显示红叉 */
  onRemove?: (e: React.MouseEvent) => void;
  /** 缩略图 object-fit */
  objectFit?: 'cover' | 'contain';
  /** 拖拽中禁用预览，避免挡操作 */
  previewDisabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  /** 透传给外层容器（拖拽等） */
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
  /** 提示词内 @ 胶囊悬停联动：对应缩略图短暂放大 */
  emphasize?: boolean;
};

type PreviewPos = { left: number; top: number; width: number; height: number };

/** 在视口上限内按图片宽高比算出预览宽高（无 letterbox） */
function fitPreviewSize(naturalW: number, naturalH: number): { width: number; height: number } {
  const maxW = Math.min(320, Math.max(140, window.innerWidth * 0.32));
  const maxH = Math.min(360, Math.max(140, window.innerHeight * 0.4));
  const nw = Math.max(1, naturalW);
  const nh = Math.max(1, naturalH);
  const scale = Math.min(maxW / nw, maxH / nh);
  return {
    width: Math.max(1, Math.round(nw * scale)),
    height: Math.max(1, Math.round(nh * scale)),
  };
}

/** 加载前占位：近似竖图比例，避免先闪横框 */
function placeholderPreviewSize(): { width: number; height: number } {
  return fitPreviewSize(3, 4);
}

function clampPreviewPos(
  anchorCenterX: number,
  preferredBottom: number,
  size: { width: number; height: number },
): PreviewPos {
  const left = Math.min(
    Math.max(8, anchorCenterX - size.width / 2),
    window.innerWidth - size.width - 8,
  );
  // transform: translateY(-100%)，top 是预览底边；保证视觉顶边不低于 8
  const top = Math.max(8 + size.height, preferredBottom);
  return { left, top, width: size.width, height: size.height };
}

/**
 * 参考图缩略图：悬停显示右上角红叉删除 + 上方大图预览。
 */
export const RefImageHoverThumb: React.FC<Props> = ({
  url,
  alt = '',
  title,
  indexLabel,
  onRemove,
  objectFit = 'cover',
  previewDisabled = false,
  className = '',
  style,
  children,
  onMouseEnter,
  onMouseLeave,
  emphasize = false,
}) => {
  const reactId = useId();
  const [hovered, setHovered] = useState(false);
  const [previewPos, setPreviewPos] = useState<PreviewPos | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    setNaturalSize(null);
  }, [url]);

  const updatePreviewAnchor = useCallback(
    (el: HTMLElement | null) => {
      if (!el) {
        setPreviewPos(null);
        return;
      }
      const rect = el.getBoundingClientRect();
      const size = naturalSize
        ? fitPreviewSize(naturalSize.w, naturalSize.h)
        : placeholderPreviewSize();
      setPreviewPos(clampPreviewPos(rect.left + rect.width / 2, rect.top - 12, size));
    },
    [naturalSize],
  );

  const handlePreviewLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return;
    setNaturalSize({ w, h });
    const size = fitPreviewSize(w, h);
    setPreviewPos((prev) => {
      if (!prev) return prev;
      const centerX = prev.left + prev.width / 2;
      return clampPreviewPos(centerX, prev.top, size);
    });
  };

  const handleEnter = (e: React.MouseEvent) => {
    setHovered(true);
    if (!previewDisabled) updatePreviewAnchor(e.currentTarget as HTMLElement);
    onMouseEnter?.(e);
  };

  const handleLeave = (e: React.MouseEvent) => {
    setHovered(false);
    setPreviewPos(null);
    onMouseLeave?.(e);
  };

  const showPreview = hovered && !previewDisabled && !!previewPos && !!url;

  return (
    <>
      <div
        className={`relative overflow-visible transition-transform duration-150 ease-out ${
          emphasize ? 'z-10 scale-[1.12]' : 'scale-100'
        } ${className}`}
        style={style}
        title={title}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
          <img
            src={url}
            alt={alt}
            className={`h-full w-full bg-black/20 ${objectFit === 'contain' ? 'object-contain' : 'object-cover'}`}
            draggable={false}
          />
        </div>
        {indexLabel != null && indexLabel !== '' ? (
          <div
            className={`pointer-events-none absolute bottom-0.5 right-0.5 z-10 min-h-[14px] min-w-[14px] rounded bg-black/75 px-0.5 text-center text-[9px] font-semibold leading-[14px] text-white transition-opacity ${
              hovered ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {indexLabel}
          </div>
        ) : null}
        {onRemove ? (
          <div
            role="button"
            tabIndex={0}
            className={`absolute right-0.5 top-0.5 z-20 flex h-[15px] w-[15px] cursor-pointer items-center justify-center rounded-full bg-red-500 text-white shadow-[0_1px_4px_rgba(0,0,0,0.45)] transition-opacity hover:bg-red-400 ${
              hovered ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            }`}
            title="移除参考图"
            aria-label="移除参考图"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRemove(e as unknown as React.MouseEvent);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              e.stopPropagation();
              onRemove(e as unknown as React.MouseEvent);
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDragStart={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <X className="h-2.5 w-2.5" strokeWidth={3} />
          </div>
        ) : null}
        {children}
      </div>
      {showPreview
        ? createPortal(
            <div
              key={`ref-preview-${reactId}`}
              className="pointer-events-none fixed z-[100040] overflow-hidden rounded-xl border border-white/20 bg-zinc-950 shadow-2xl"
              style={{
                left: previewPos.left,
                top: previewPos.top,
                width: previewPos.width,
                height: previewPos.height,
                transform: 'translateY(-100%)',
              }}
            >
              <img
                src={url}
                alt={alt}
                className="block h-full w-full"
                draggable={false}
                onLoad={handlePreviewLoad}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
};

export default RefImageHoverThumb;
