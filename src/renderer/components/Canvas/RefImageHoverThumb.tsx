import React, { useCallback, useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import AssetLibLazyThumb from '../AssetLibLazyThumb';

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
  /** 放大预览：无描边、圆角，显示在原图右侧 */
  previewBorderless?: boolean;
  /** 悬停大图下方一行描述（提示词等） */
  previewCaption?: string;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  /** 透传给外层容器（拖拽等） */
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
  /** 提示词内 @ 胶囊悬停联动：对应缩略图短暂放大 */
  emphasize?: boolean;
  /** 列表格用磁盘缩略图，悬停仍看原图 */
  preferListThumb?: boolean;
  listThumbMaxEdge?: number;
  /** 同 URL 重新生成后拆缩略图缓存 */
  cacheNonce?: string | number;
  /** 格子显示原图，但限制同时解码张数，避免卡顿 */
  gateOriginalLoad?: boolean;
  /**
   * 用图片自身撑开画幅（如 9 / 16）。导演台 CSS zoom 下不要用 absolute inset-0，
   * 否则定妆图会被裁成一条/全黑。
   */
  boxAspect?: string;
};

type PreviewPos = { left: number; top: number; width: number; height: number };

/** 在视口上限内按图片宽高比算出预览宽高（无 letterbox） */
function fitPreviewSize(
  naturalW: number,
  naturalH: number,
  opts?: { maxW?: number; maxH?: number },
): { width: number; height: number } {
  const maxW = opts?.maxW ?? Math.min(320, Math.max(140, window.innerWidth * 0.32));
  const maxH = opts?.maxH ?? Math.min(360, Math.max(140, window.innerHeight * 0.4));
  const nw = Math.max(1, naturalW);
  const nh = Math.max(1, naturalH);
  const scale = Math.min(maxW / nw, maxH / nh);
  return {
    width: Math.max(1, Math.round(nw * scale)),
    height: Math.max(1, Math.round(nh * scale)),
  };
}

function clampPreviewPosAbove(
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

/** 放大预览贴在缩略图右侧（竖向与缩略图对齐，必要时翻到左侧） */
function clampPreviewPosRight(
  anchor: DOMRect,
  size: { width: number; height: number },
): PreviewPos {
  const gap = 10;
  let left = anchor.right + gap;
  if (left + size.width > window.innerWidth - 8) {
    left = Math.max(8, anchor.left - gap - size.width);
  }
  let top = anchor.top + (anchor.height - size.height) / 2;
  top = Math.min(Math.max(8, top), window.innerHeight - size.height - 8);
  return { left, top, width: size.width, height: size.height };
}

/**
 * 参考图缩略图：悬停显示右上角红叉删除 + 大图预览。
 * previewBorderless：无描边、圆角大图，显示在原图右侧。
 */
export const RefImageHoverThumb: React.FC<Props> = ({
  url,
  alt = '',
  title,
  indexLabel,
  onRemove,
  objectFit = 'cover',
  previewDisabled = false,
  previewBorderless = false,
  previewCaption,
  className = '',
  style,
  children,
  onMouseEnter,
  onMouseLeave,
  emphasize = false,
  preferListThumb = false,
  listThumbMaxEdge = 256,
  gateOriginalLoad = false,
  boxAspect,
  cacheNonce,
}) => {
  const reactId = useId();
  const [hovered, setHovered] = useState(false);
  const [previewPos, setPreviewPos] = useState<PreviewPos | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const caption = String(previewCaption || '').trim();
  const captionBlockH = caption ? 112 : 0;

  const previewFitOpts = previewBorderless
    ? {
        maxW: Math.min(720, Math.max(280, window.innerWidth * 0.55)),
        maxH: Math.min(800, Math.max(280, window.innerHeight * 0.72)),
      }
    : undefined;

  useEffect(() => {
    setNaturalSize(null);
  }, [url]);

  const resolvePreviewPos = useCallback(
    (rect: DOMRect, size: { width: number; height: number }): PreviewPos => {
      if (previewBorderless) return clampPreviewPosRight(rect, size);
      return clampPreviewPosAbove(rect.left + rect.width / 2, rect.top - 12, size);
    },
    [previewBorderless],
  );

  const updatePreviewAnchor = useCallback(
    (el: HTMLElement | null) => {
      if (!el) {
        setPreviewPos(null);
        setAnchorRect(null);
        return;
      }
      const rect = el.getBoundingClientRect();
      setAnchorRect(rect);
      const imgSize = naturalSize
        ? fitPreviewSize(naturalSize.w, naturalSize.h, previewFitOpts)
        : fitPreviewSize(3, 4, previewFitOpts);
      const size = {
        width: imgSize.width,
        height: imgSize.height + captionBlockH,
      };
      setPreviewPos(resolvePreviewPos(rect, size));
    },
    [naturalSize, previewBorderless, resolvePreviewPos, captionBlockH],
  );

  const handlePreviewLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return;
    setNaturalSize({ w, h });
    const imgSize = fitPreviewSize(w, h, previewFitOpts);
    const size = {
      width: imgSize.width,
      height: imgSize.height + captionBlockH,
    };
    setPreviewPos((prev) => {
      if (!prev) return prev;
      if (previewBorderless && anchorRect) {
        return clampPreviewPosRight(anchorRect, size);
      }
      const centerX = prev.left + prev.width / 2;
      return clampPreviewPosAbove(centerX, prev.top, size);
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
    setAnchorRect(null);
    onMouseLeave?.(e);
  };

  const showPreview = hovered && !previewDisabled && !!previewPos && !!url;

  const fillFit = objectFit === 'contain' ? 'contain' : 'cover';
  const fillImgClass = `block w-full bg-black/20 ${objectFit === 'contain' ? 'object-contain' : 'object-cover'}`;
  const fillImgStyle: React.CSSProperties = boxAspect
    ? {
        width: '100%',
        height: 'auto',
        aspectRatio: boxAspect,
        objectFit: fillFit,
        display: 'block',
      }
    : {
        width: '100%',
        height: '100%',
        objectFit: fillFit,
        display: 'block',
      };

  return (
    <>
      <div
        className={`relative overflow-hidden transition-transform duration-150 ease-out ${
          emphasize ? 'z-10 scale-[1.12]' : 'scale-100'
        } ${className}`}
        style={style}
        title={title}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        {preferListThumb || boxAspect ? (
          <AssetLibLazyThumb
            src={url}
            className={boxAspect ? 'block w-full' : 'h-full w-full'}
            imgClassName={fillImgClass}
            imgStyle={fillImgStyle}
            maxEdge={boxAspect ? Math.max(listThumbMaxEdge, 288) : listThumbMaxEdge}
            cacheNonce={cacheNonce}
            alt={alt}
          />
        ) : (
          <img
            src={url}
            alt={alt}
            className={fillImgClass}
            style={fillImgStyle}
            draggable={false}
            decoding="async"
          />
        )}
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
              className={
                previewBorderless
                  ? 'pointer-events-none fixed z-[100040] overflow-hidden rounded-xl bg-transparent'
                  : 'pointer-events-none fixed z-[100040] overflow-hidden rounded-xl border border-white/20 bg-zinc-950 shadow-2xl'
              }
              style={{
                left: previewPos.left,
                top: previewPos.top,
                width: previewPos.width,
                height: previewPos.height,
                ...(previewBorderless ? {} : { transform: 'translateY(-100%)' }),
              }}
            >
              <img
                src={url}
                alt={alt}
                className="block w-full rounded-xl object-contain"
                style={{
                  height: Math.max(40, previewPos.height - captionBlockH),
                }}
                draggable={false}
                onLoad={handlePreviewLoad}
              />
              {caption ? (
                <div
                  className="overflow-y-auto px-3 py-2 text-[12px] leading-relaxed text-white/90"
                  style={{
                    height: captionBlockH,
                    background: 'rgba(0,0,0,0.78)',
                  }}
                >
                  {caption}
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
};

export default RefImageHoverThumb;
