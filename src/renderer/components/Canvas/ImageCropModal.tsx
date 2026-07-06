import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, Crop } from 'lucide-react';
import {
  clampCropRect,
  computeContainedImageRect,
  defaultCropRect,
  type NormalizedCropRect,
} from '../../utils/imageCropUtils';

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | null;

export interface ImageCropModalProps {
  imageUrl: string;
  isDarkMode: boolean;
  title: string;
  hint: string;
  cancelLabel: string;
  confirmLabel: string;
  confirmingLabel: string;
  busy?: boolean;
  onConfirm: (rect: NormalizedCropRect) => void;
  onCancel: () => void;
}

const ImageCropModal: React.FC<ImageCropModalProps> = ({
  imageUrl,
  isDarkMode,
  title,
  hint,
  cancelLabel,
  confirmLabel,
  confirmingLabel,
  busy = false,
  onConfirm,
  onCancel,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [crop, setCrop] = useState<NormalizedCropRect>(() => defaultCropRect());
  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    startY: number;
    startCrop: NormalizedCropRect;
    imageRect: { x: number; y: number; w: number; h: number };
  } | null>(null);

  useEffect(() => {
    setCrop(defaultCropRect());
  }, [imageUrl]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const imageRect = computeContainedImageRect(containerSize.w, containerSize.h, natural.w, natural.h);

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

  const cropPx = {
    left: imageRect.x + crop.x * imageRect.w,
    top: imageRect.y + crop.y * imageRect.h,
    width: crop.w * imageRect.w,
    height: crop.h * imageRect.h,
  };

  const handleCorner = (mode: DragMode) => (e: React.PointerEvent) => onPointerDown(mode, e);

  return createPortal(
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/55 backdrop-blur-md p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className={`mx-auto flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl shadow-2xl ${
          isDarkMode ? 'nexflow-glass-panel border border-white/10' : 'bg-white border border-gray-200'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`flex items-center justify-between border-b px-4 py-3 ${
            isDarkMode ? 'border-white/10' : 'border-gray-200'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Crop className={`w-4 h-4 shrink-0 ${isDarkMode ? 'text-emerald-300' : 'text-emerald-600'}`} />
            <h3 className={`text-sm font-semibold truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{title}</h3>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className={`rounded-lg p-1.5 transition-colors ${
              isDarkMode ? 'hover:bg-white/10 text-white/70' : 'hover:bg-gray-100 text-gray-500'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className={`px-4 pt-3 text-xs ${isDarkMode ? 'text-white/55' : 'text-gray-500'}`}>{hint}</p>

        <div className="p-4">
          <div
            ref={containerRef}
            className={`relative mx-auto w-full overflow-hidden rounded-xl ${
              isDarkMode ? 'bg-black/50' : 'bg-gray-100'
            }`}
            style={{ height: 'min(58vh, 520px)' }}
          >
            <img
              src={imageUrl}
              alt=""
              draggable={false}
              className="absolute inset-0 h-full w-full object-contain select-none pointer-events-none"
              onLoad={(e) => {
                const t = e.currentTarget;
                setNatural({ w: t.naturalWidth, h: t.naturalHeight });
              }}
            />
            {natural.w > 0 && cropPx.width > 0 ? (
              <>
                <div
                  className="absolute z-10 border-2 border-white/95 shadow-[0_0_0_1px_rgba(0,0,0,0.35)] cursor-move touch-none"
                  style={{
                    left: cropPx.left,
                    top: cropPx.top,
                    width: cropPx.width,
                    height: cropPx.height,
                    boxShadow: '0 0 0 9999px rgba(0,0,0,0.52)',
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
        </div>

        <div
          className={`flex justify-end gap-2 border-t px-4 py-3 ${
            isDarkMode ? 'border-white/10' : 'border-gray-200'
          }`}
        >
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className={`rounded-lg px-4 py-2 text-xs font-medium transition-colors ${
              isDarkMode
                ? 'bg-white/10 hover:bg-white/15 text-white/90'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-800'
            }`}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy || natural.w <= 0}
            onClick={() => onConfirm(clampCropRect(crop))}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition-colors ${
              isDarkMode
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50'
                : 'bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-50'
            }`}
          >
            <Check className="w-3.5 h-3.5" />
            {busy ? confirmingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ImageCropModal;
