import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, Loader2, X } from 'lucide-react';
import {
  clampCropRect,
  computeContainedImageRect,
  defaultCropRect,
  defaultCropRectForAspect,
  type NormalizedCropRect,
} from '../../utils/imageCropUtils';

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | null;

export type ImageCropOverlayHandle = {
  confirm: () => boolean;
  getCrop: () => NormalizedCropRect | null;
  ready: () => boolean;
};

export interface ImageCropOverlayProps {
  /** 用于测量 natural 尺寸；叠在已有 object-contain 主图之上，不再单独渲染预览图 */
  imageUrl: string;
  isDarkMode: boolean;
  hint: string;
  busy?: boolean;
  /** 锁定裁剪框像素宽高比（宽/高），例如 9/16 */
  lockAspectRatio?: number;
  /** 切换会话时保留选区 */
  initialCrop?: NormalizedCropRect | null;
  /** 大窗模式由外层标题区展示说明时可关闭内嵌提示 */
  showHint?: boolean;
  /**
   * 外框放大/尺寸变更时传入（如 `${w}x${h}`），强制按新容器重测选区坐标系，
   * 避免仍按小窗 clientWidth/Height 绘制虚线框。
   */
  layoutRevision?: string | number;
  onConfirm: (rect: NormalizedCropRect) => void;
  onCancel: () => void;
}

/**
 * 选框 + 四角手柄（确认/取消由外层渲染）。双击选区即确认裁剪。
 */
const ImageCropOverlay = forwardRef<ImageCropOverlayHandle, ImageCropOverlayProps>(
  function ImageCropOverlay(
    {
      imageUrl,
      isDarkMode,
      hint,
      busy = false,
      lockAspectRatio,
      initialCrop = null,
      showHint = false,
      layoutRevision,
      onConfirm,
      onCancel,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [natural, setNatural] = useState({ w: 0, h: 0 });
    const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
    const [crop, setCrop] = useState<NormalizedCropRect>(() => defaultCropRect());
    const cropRef = useRef(crop);
    cropRef.current = crop;
    const naturalRef = useRef(natural);
    naturalRef.current = natural;
    const dragRef = useRef<{
      mode: DragMode;
      startX: number;
      startY: number;
      startCrop: NormalizedCropRect;
      imageRect: { x: number; y: number; w: number; h: number };
    } | null>(null);
    const lockAspectRef = useRef(lockAspectRatio);
    lockAspectRef.current = lockAspectRatio;

    const confirm = useCallback(() => {
      if (busy || naturalRef.current.w <= 0) return false;
      onConfirm(clampCropRect(cropRef.current));
      return true;
    }, [busy, onConfirm]);

    useImperativeHandle(
      ref,
      () => ({
        confirm,
        getCrop: () => (naturalRef.current.w > 0 ? clampCropRect(cropRef.current) : null),
        ready: () => naturalRef.current.w > 0 && !busy,
      }),
      [busy, confirm],
    );

    const initialCropRef = useRef(initialCrop);
    initialCropRef.current = initialCrop;

    useEffect(() => {
      setNatural({ w: 0, h: 0 });
      const seed = initialCropRef.current;
      setCrop(seed ? clampCropRect(seed) : defaultCropRect());
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        setNatural({ w, h });
        const keep = initialCropRef.current;
        if (keep) {
          setCrop(clampCropRect(keep));
        } else if (w > 0 && h > 0 && lockAspectRatio && lockAspectRatio > 0) {
          setCrop(defaultCropRectForAspect(w / h, lockAspectRatio));
        } else {
          setCrop(defaultCropRect());
        }
      };
      img.onerror = () => setNatural({ w: 0, h: 0 });
      img.src = imageUrl;
    }, [imageUrl, lockAspectRatio]);

    const syncContainerSize = useCallback(() => {
      const el = containerRef.current;
      if (!el) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      setContainerSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    }, []);

    // 布局阶段同步测量，保证放大后首帧选区即对齐大窗（不等下一帧 RO）
    useLayoutEffect(() => {
      syncContainerSize();
    }, [syncContainerSize, layoutRevision, natural.w, natural.h]);

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const ro = new ResizeObserver(() => {
        syncContainerSize();
      });
      ro.observe(el);
      syncContainerSize();
      return () => ro.disconnect();
    }, [syncContainerSize, layoutRevision]);

    // 外框与图片比例接近时按铺满处理，消除 object-contain 亚像素黑边
    const frameAspect =
      containerSize.w > 0 && containerSize.h > 0 ? containerSize.w / containerSize.h : 0;
    const mediaAspect = natural.w > 0 && natural.h > 0 ? natural.w / natural.h : 0;
    const fillFrame =
      frameAspect > 0 &&
      mediaAspect > 0 &&
      Math.abs(frameAspect - mediaAspect) / mediaAspect < 0.02;
    const imageRect = fillFrame
      ? { x: 0, y: 0, w: containerSize.w, h: containerSize.h }
      : computeContainedImageRect(containerSize.w, containerSize.h, natural.w, natural.h);

    const normFromClient = useCallback(
      (clientX: number, clientY: number, ir: { x: number; y: number; w: number; h: number }) => {
        const el = containerRef.current;
        if (!el || ir.w <= 0 || ir.h <= 0) return { x: 0, y: 0 };
        const box = el.getBoundingClientRect();
        const px = clientX - box.left - ir.x;
        const py = clientY - box.top - ir.y;
        return {
          x: Math.max(0, Math.min(1, px / ir.w)),
          y: Math.max(0, Math.min(1, py / ir.h)),
        };
      },
      [],
    );

    const onPointerDown = useCallback(
      (mode: DragMode, e: React.PointerEvent) => {
        if (busy || natural.w <= 0) return;
        e.stopPropagation();
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        dragRef.current = {
          mode,
          startX: e.clientX,
          startY: e.clientY,
          startCrop: { ...crop },
          imageRect: { ...imageRect },
        };
      },
      [busy, crop, imageRect, natural.w],
    );

    useEffect(() => {
      const onMove = (e: PointerEvent) => {
        const d = dragRef.current;
        if (!d || !d.mode) return;
        const startNorm = normFromClient(d.startX, d.startY, d.imageRect);
        const curNorm = normFromClient(e.clientX, e.clientY, d.imageRect);
        const dx = curNorm.x - startNorm.x;
        const dy = curNorm.y - startNorm.y;
        const s = d.startCrop;

        if (d.mode === 'move') {
          setCrop(clampCropRect({ x: s.x + dx, y: s.y + dy, w: s.w, h: s.h }));
          return;
        }

        const lock = lockAspectRef.current;
        const imgAspect = natural.w > 0 && natural.h > 0 ? natural.w / natural.h : 0;

        if (lock && lock > 0 && imgAspect > 0) {
          const normRatio = lock / imgAspect;
          let x = s.x;
          let y = s.y;
          let x2 = s.x + s.w;
          let y2 = s.y + s.h;
          const useX = Math.abs(dx) >= Math.abs(dy);

          if (d.mode === 'se') {
            if (useX) {
              x2 = Math.max(x + 0.04, Math.min(1, s.x + s.w + dx));
              const nw = x2 - x;
              const nh = nw / normRatio;
              y2 = y + nh;
              if (y2 > 1) {
                y2 = 1;
                const nh2 = y2 - y;
                const nw2 = nh2 * normRatio;
                x2 = x + nw2;
              }
            } else {
              y2 = Math.max(y + 0.04, Math.min(1, s.y + s.h + dy));
              const nh = y2 - y;
              const nw = nh * normRatio;
              x2 = x + nw;
              if (x2 > 1) {
                x2 = 1;
                const nw2 = x2 - x;
                const nh2 = nw2 / normRatio;
                y2 = y + nh2;
              }
            }
          } else if (d.mode === 'nw') {
            if (useX) {
              x = Math.min(x2 - 0.04, Math.max(0, s.x + dx));
              const nw = x2 - x;
              const nh = nw / normRatio;
              y = y2 - nh;
              if (y < 0) {
                y = 0;
                const nh2 = y2 - y;
                const nw2 = nh2 * normRatio;
                x = x2 - nw2;
              }
            } else {
              y = Math.min(y2 - 0.04, Math.max(0, s.y + dy));
              const nh = y2 - y;
              const nw = nh * normRatio;
              x = x2 - nw;
              if (x < 0) {
                x = 0;
                const nw2 = x2 - x;
                const nh2 = nw2 / normRatio;
                y = y2 - nh2;
              }
            }
          } else if (d.mode === 'ne') {
            if (useX) {
              x2 = Math.max(x + 0.04, Math.min(1, s.x + s.w + dx));
              const nw = x2 - x;
              const nh = nw / normRatio;
              y = y2 - nh;
              if (y < 0) {
                y = 0;
                const nh2 = y2 - y;
                const nw2 = nh2 * normRatio;
                x2 = x + nw2;
              }
            } else {
              y = Math.min(y2 - 0.04, Math.max(0, s.y + dy));
              const nh = y2 - y;
              const nw = nh * normRatio;
              x2 = x + nw;
              if (x2 > 1) {
                x2 = 1;
                const nw2 = x2 - x;
                const nh2 = nw2 / normRatio;
                y = y2 - nh2;
              }
            }
          } else if (d.mode === 'sw') {
            if (useX) {
              x = Math.min(x2 - 0.04, Math.max(0, s.x + dx));
              const nw = x2 - x;
              const nh = nw / normRatio;
              y2 = y + nh;
              if (y2 > 1) {
                y2 = 1;
                const nh2 = y2 - y;
                const nw2 = nh2 * normRatio;
                x = x2 - nw2;
              }
            } else {
              y2 = Math.max(y + 0.04, Math.min(1, s.y + s.h + dy));
              const nh = y2 - y;
              const nw = nh * normRatio;
              x = x2 - nw;
              if (x < 0) {
                x = 0;
                const nw2 = x2 - x;
                const nh2 = nw2 / normRatio;
                y2 = y + nh2;
              }
            }
          }

          setCrop(clampCropRect({ x, y, w: x2 - x, h: y2 - y }));
          return;
        }

        let x = s.x;
        let y = s.y;
        let x2 = s.x + s.w;
        let y2 = s.y + s.h;

        if (d.mode.includes('n')) y = Math.min(y + dy, y2 - 0.04);
        if (d.mode.includes('s')) y2 = Math.max(y2 + dy, y + 0.04);
        if (d.mode.includes('w')) x = Math.min(x + dx, x2 - 0.04);
        if (d.mode.includes('e')) x2 = Math.max(x2 + dx, x + 0.04);

        setCrop(clampCropRect({ x, y, w: x2 - x, h: y2 - y }));
      };

      const onUp = () => {
        dragRef.current = null;
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      return () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
    }, [normFromClient, natural.w, natural.h]);

    useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        if (busy) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          confirm();
        }
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    }, [busy, onCancel, confirm]);

    const cropPx = {
      left: imageRect.x + crop.x * imageRect.w,
      top: imageRect.y + crop.y * imageRect.h,
      width: crop.w * imageRect.w,
      height: crop.h * imageRect.h,
    };

    const handleCorner = (mode: DragMode) => (e: React.PointerEvent) => onPointerDown(mode, e);

    const onDoubleConfirm = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        if (busy) return;
        confirm();
      },
      [busy, confirm],
    );

    return (
      <div
        ref={containerRef}
        className="nexflow-image-crop-overlay nodrag nopan absolute inset-0 z-[80] overflow-hidden"
        style={{ pointerEvents: 'all' }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={onDoubleConfirm}
        onWheel={(e) => e.stopPropagation()}
      >
        {showHint ? (
          <p
            className={`pointer-events-none absolute left-2 right-2 top-2 z-20 truncate rounded-md px-2 py-1 text-[10px] leading-tight ${
              isDarkMode ? 'bg-black/55 text-white/70' : 'bg-white/85 text-gray-600'
            }`}
            title={hint}
          >
            {hint}
          </p>
        ) : null}

        {natural.w > 0 && cropPx.width > 0 ? (
          <>
            {/* 四边遮罩代替 9999px box-shadow，避免超大合成层导致 Electron GPU 秒退 */}
            <div className="pointer-events-none absolute inset-0 z-[9]" aria-hidden>
              <div
                className="absolute left-0 right-0 top-0 bg-black/52"
                style={{ height: Math.max(0, cropPx.top) }}
              />
              <div
                className="absolute bottom-0 left-0 right-0 bg-black/52"
                style={{
                  top: Math.max(0, cropPx.top + cropPx.height),
                }}
              />
              <div
                className="absolute bg-black/52"
                style={{
                  left: 0,
                  top: Math.max(0, cropPx.top),
                  width: Math.max(0, cropPx.left),
                  height: Math.max(0, cropPx.height),
                }}
              />
              <div
                className="absolute right-0 bg-black/52"
                style={{
                  left: Math.max(0, cropPx.left + cropPx.width),
                  top: Math.max(0, cropPx.top),
                  height: Math.max(0, cropPx.height),
                }}
              />
            </div>
            <div
              className="absolute z-10 cursor-move touch-none border-2 border-dashed border-white/90"
              style={{
                left: cropPx.left,
                top: cropPx.top,
                width: cropPx.width,
                height: cropPx.height,
              }}
              onPointerDown={(e) => onPointerDown('move', e)}
              onDoubleClick={onDoubleConfirm}
            >
              {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => {
                const pos =
                  corner === 'nw'
                    ? 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize'
                    : corner === 'ne'
                      ? 'right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize'
                      : corner === 'sw'
                        ? 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize'
                        : 'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize';
                return (
                  <div
                    key={corner}
                    className={`absolute h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-500 shadow ${pos}`}
                    onPointerDown={handleCorner(corner)}
                  />
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    );
  },
);

export interface ImageCropLargeWindowProps {
  imageUrl: string;
  isDarkMode: boolean;
  title: string;
  hint: string;
  cancelLabel: string;
  confirmLabel: string;
  confirmingLabel: string;
  busy?: boolean;
  lockAspectRatio?: number;
  overlayRef?: React.Ref<ImageCropOverlayHandle>;
  onConfirm: (rect: NormalizedCropRect) => void;
  onCancel: () => void;
}

function fitCropStageSize(naturalW: number, naturalH: number, maxW: number, maxH: number) {
  if (naturalW <= 0 || naturalH <= 0) return { w: Math.min(maxW, 640), h: Math.min(maxH, 480) };
  // 允许放大到视口上限，按 intrinsic 比例铺满可用区域（不再限制 scale≤1 导致四周留白）
  const scale = Math.min(maxW / naturalW, maxH / naturalH);
  return {
    w: Math.max(160, Math.round(naturalW * scale)),
    h: Math.max(120, Math.round(naturalH * scale)),
  };
}

/** 超大窗口裁剪：全屏暗底 + 大图选区；确认栏紧贴图像下沿 */
export function ImageCropLargeWindow({
  imageUrl,
  isDarkMode,
  title,
  hint,
  cancelLabel,
  confirmLabel,
  confirmingLabel,
  busy = false,
  lockAspectRatio,
  overlayRef,
  onConfirm,
  onCancel,
}: ImageCropLargeWindowProps) {
  const localRef = useRef<ImageCropOverlayHandle>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1280,
    h: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));

  const setRefs = useCallback(
    (node: ImageCropOverlayHandle | null) => {
      localRef.current = node;
      if (typeof overlayRef === 'function') overlayRef(node);
      else if (overlayRef) (overlayRef as React.MutableRefObject<ImageCropOverlayHandle | null>).current = node;
    },
    [overlayRef],
  );

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    setNatural({ w: 0, h: 0 });
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => setNatural({ w: 0, h: 0 });
    img.src = imageUrl;
  }, [imageUrl]);

  // 舞台按图片 intrinsic 比例适配视口，避免固定比例框造成上下/左右大块黑边
  const maxW = Math.min(viewport.w * 0.96, 1600);
  const maxH = Math.min(viewport.h * 0.78, 920);
  const stage = fitCropStageSize(natural.w, natural.h, maxW, maxH);

  return createPortal(
    <div
      className="fixed inset-0 z-[940] flex flex-col bg-black/92"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-black/50 px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium text-white">{title}</h2>
          <p className="truncate text-xs text-white/50" title={hint}>
            {hint}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            if (busy) return;
            onCancel();
          }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-white/90 transition-colors hover:bg-white/15 disabled:opacity-50"
          title={cancelLabel}
          aria-label={cancelLabel}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-4 py-4">
        <div className="flex flex-col items-center">
          <div className="relative overflow-hidden rounded-lg bg-black shadow-2xl" style={{ width: stage.w, height: stage.h }}>
            <img
              src={imageUrl}
              alt=""
              draggable={false}
              className="absolute inset-0 h-full w-full select-none"
              style={{ objectFit: 'fill' }}
            />
            <ImageCropOverlay
              ref={setRefs}
              imageUrl={imageUrl}
              isDarkMode={isDarkMode}
              hint={hint}
              busy={busy}
              lockAspectRatio={lockAspectRatio}
              showHint={false}
              layoutRevision={`${stage.w}x${stage.h}`}
              onConfirm={onConfirm}
              onCancel={onCancel}
            />
          </div>

          <div
            className={`mt-2 inline-flex items-center gap-1.5 rounded-xl border px-2 py-1.5 shadow-lg backdrop-blur-md ${
              isDarkMode ? 'border-white/15 bg-black/75' : 'border-gray-200 bg-white/95'
            }`}
          >
            <button
              type="button"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                if (busy) return;
                onCancel();
              }}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                isDarkMode
                  ? 'border border-white/10 bg-white/10 text-white/90 hover:bg-white/15'
                  : 'border border-gray-200 bg-gray-100 text-gray-800 hover:bg-gray-200'
              }`}
            >
              <X className="h-3.5 w-3.5" />
              {cancelLabel}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                localRef.current?.confirm();
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {busy ? confirmingLabel : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default ImageCropOverlay;
