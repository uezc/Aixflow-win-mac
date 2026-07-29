import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutGrid } from 'lucide-react';

export interface ImagePreviewWithToolsProps {
  imageUrl: string;
  nodeId?: string;
  localPath?: string;
  isDarkMode?: boolean;
  onApply?: (nodeId: string, dataUrl: string) => void;
  onClose: () => void;
  /** 多图模块全屏预览：将当前图导入为原模块旁的新图片节点 */
  onImportToCanvas?: () => void;
  importToCanvasLabel?: string;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

export const ImagePreviewWithTools: React.FC<ImagePreviewWithToolsProps> = ({
  imageUrl,
  onClose,
  onImportToCanvas,
  importToCanvasLabel = '导入到画布',
}) => {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [imageUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== ' ') return;
      if (e.key === ' ' && e.repeat) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setZoom((z) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor));
      if (next <= MIN_ZOOM + 0.001) {
        setPan({ x: 0, y: 0 });
        return MIN_ZOOM;
      }
      return next;
    });
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (zoomRef.current <= 1.01) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      originX: pan.x,
      originY: pan.y,
    };
  }, [pan.x, pan.y]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d?.active) return;
    setPan({
      x: d.originX + (e.clientX - d.startX),
      y: d.originY + (e.clientY - d.startY),
    });
  }, []);

  const endDrag = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current?.active) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragRef.current = null;
  }, []);

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/90 flex flex-col items-center justify-center"
      onDoubleClick={onClose}
      role="presentation"
      title="滚轮缩放细节；放大后拖动平移；双击关闭"
    >
      <div
        className={`relative flex-1 flex items-center justify-center w-full max-w-[95vw] max-h-[85vh] p-4 overflow-hidden ${
          zoom > 1.01 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-out'
        }`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (zoom > 1.01) {
            setZoom(1);
            setPan({ x: 0, y: 0 });
            return;
          }
          onClose();
        }}
      >
        <img
          src={imageUrl}
          alt="预览"
          className="max-w-full max-h-full object-contain rounded-lg shadow-2xl select-none pointer-events-none"
          draggable={false}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
            transition: dragRef.current?.active ? 'none' : 'transform 80ms ease-out',
          }}
        />
        {zoom > 1.01 ? (
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-xs text-white/90">
            {Math.round(zoom * 100)}%
          </div>
        ) : null}
      </div>

      {onImportToCanvas ? (
        <div className="pb-6">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onImportToCanvas();
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white transition-colors"
          >
            <LayoutGrid className="w-4 h-4" />
            {importToCanvasLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
};
