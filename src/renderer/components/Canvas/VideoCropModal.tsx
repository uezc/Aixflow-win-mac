import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  clampCropRect,
  computeContainedImageRect,
  defaultVideoCropRect,
  type NormalizedCropRect,
} from '../../utils/imageCropUtils';
import { normalizeVideoUrl } from '../../utils/normalizeVideoUrl';

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | null;

export type VideoCropOverlayHandle = {
  confirm: () => boolean;
  getCrop: () => NormalizedCropRect | null;
  ready: () => boolean;
};

export interface VideoCropOverlayProps {
  /** 仅用于读取 videoWidth/Height；选框叠在模块已有画面上 */
  videoUrl: string;
  isDarkMode: boolean;
  hint: string;
  busy?: boolean;
  /** 外框尺寸变更时传入，强制按新容器重测选区 */
  layoutRevision?: string | number;
  onConfirm: (rect: NormalizedCropRect, sourceWidth: number, sourceHeight: number) => void;
  onCancel: () => void;
}

/**
 * 主模块内联画面裁剪：选框 + 四角手柄（确认/取消在模块外下方驱动位渲染）。
 */
const VideoCropOverlay = forwardRef<VideoCropOverlayHandle, VideoCropOverlayProps>(
  function VideoCropOverlay(
    { videoUrl, isDarkMode, hint, busy = false, layoutRevision, onConfirm, onCancel },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [natural, setNatural] = useState({ w: 0, h: 0 });
    const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
    const [crop, setCrop] = useState<NormalizedCropRect>(() => defaultVideoCropRect());
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

    const confirm = useCallback(() => {
      if (busy || naturalRef.current.w <= 0) return false;
      onConfirm(clampCropRect(cropRef.current), naturalRef.current.w, naturalRef.current.h);
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

    useEffect(() => {
      setCrop(defaultVideoCropRect());
      setNatural({ w: 0, h: 0 });
      const url = normalizeVideoUrl(videoUrl);
      if (!url) return;

      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      if (url.startsWith('http')) video.crossOrigin = 'anonymous';

      let cancelled = false;
      const apply = () => {
        if (cancelled) return;
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w > 0 && h > 0) setNatural({ w, h });
      };
      video.addEventListener('loadedmetadata', apply);
      video.addEventListener('loadeddata', apply);
      video.src = url;

      return () => {
        cancelled = true;
        video.removeEventListener('loadedmetadata', apply);
        video.removeEventListener('loadeddata', apply);
        video.removeAttribute('src');
        video.load();
      };
    }, [videoUrl]);

    const syncContainerSize = useCallback(() => {
      const el = containerRef.current;
      if (!el) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      setContainerSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    }, []);

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
    }, [normFromClient]);

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

    return (
      <div
        ref={containerRef}
        className="nexflow-video-crop-overlay nodrag nopan absolute inset-0 z-40 overflow-hidden rounded-2xl"
        style={{ pointerEvents: 'all' }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <p
          className={`pointer-events-none absolute left-2 right-2 top-2 z-20 truncate rounded-md px-2 py-1 text-[10px] leading-tight ${
            isDarkMode ? 'bg-black/55 text-white/70' : 'bg-white/85 text-gray-600'
          }`}
          title={hint}
        >
          {hint}
        </p>

        {natural.w > 0 && cropPx.width > 0 ? (
          <>
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

export default VideoCropOverlay;
