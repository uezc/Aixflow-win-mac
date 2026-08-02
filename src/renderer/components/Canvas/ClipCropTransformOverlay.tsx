import React, { useCallback, useRef } from 'react';
import {
  CLIP_CROP_MIN_SIZE,
  normalizeClipCrop,
  type ClipCrop,
} from '../../utils/clipCrop';
import {
  normalizeClipLayout,
  sourceRectFromLayoutAndCrop,
  type ClipLayout,
} from '../../utils/clipLayout';

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLE_CURSORS: Record<HandleId, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

export type ClipCropTransformOverlayProps = {
  /** 裁切后画面在画布上的占位（与蓝框一致） */
  layout: Partial<ClipLayout> | null | undefined;
  crop: Partial<ClipCrop> | null | undefined;
  onChange: (next: ClipCrop) => void;
  className?: string;
};

/**
 * 画面裁剪框：在「未裁源占位」内拖四边/四角调节源 crop；
 * 琥珀色保留框 = 当前 layout（裁切后可见区）。父级应在 onChange 时 syncLayoutAfterCropChange。
 */
const ClipCropTransformOverlay: React.FC<ClipCropTransformOverlayProps> = ({
  layout,
  crop,
  onChange,
  className = '',
}) => {
  const L = normalizeClipLayout(layout);
  const C = normalizeClipCrop(crop);
  const sourceRect = sourceRectFromLayoutAndCrop(L, C);
  const dragRef = useRef<{
    handle: HandleId;
    startX: number;
    startY: number;
    origin: ClipCrop;
    boxW: number;
    boxH: number;
  } | null>(null);

  const onPointerDown = useCallback(
    (handle: HandleId) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const parent = (e.currentTarget as HTMLElement).closest(
        '[data-splice-preview-frame]',
      ) as HTMLElement | null;
      const rect = parent?.getBoundingClientRect();
      if (!rect?.width || !rect?.height) return;
      // 拖拽增量相对未裁源占位（与 crop 归一化一致）
      const src = sourceRectFromLayoutAndCrop(layout, crop);
      const boxW = Math.max(1, src.w * rect.width);
      const boxH = Math.max(1, src.h * rect.height);
      dragRef.current = {
        handle,
        startX: e.clientX,
        startY: e.clientY,
        origin: normalizeClipCrop(crop),
        boxW,
        boxH,
      };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        const d = dragRef.current;
        if (!d) return;
        const dx = (ev.clientX - d.startX) / d.boxW;
        const dy = (ev.clientY - d.startY) / d.boxH;
        const o = d.origin;
        let left = o.left;
        let top = o.top;
        let right = o.right;
        let bottom = o.bottom;

        if (d.handle.includes('w')) {
          left = Math.max(0, Math.min(1 - CLIP_CROP_MIN_SIZE - o.right, o.left + dx));
        }
        if (d.handle.includes('e')) {
          right = Math.max(0, Math.min(1 - CLIP_CROP_MIN_SIZE - o.left, o.right - dx));
        }
        if (d.handle.includes('n')) {
          top = Math.max(0, Math.min(1 - CLIP_CROP_MIN_SIZE - o.bottom, o.top + dy));
        }
        if (d.handle.includes('s')) {
          bottom = Math.max(0, Math.min(1 - CLIP_CROP_MIN_SIZE - o.top, o.bottom - dy));
        }
        onChange(normalizeClipCrop({ left, top, right, bottom }));
      };

      const onUp = (ev: PointerEvent) => {
        dragRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture?.(ev.pointerId);
        } catch {
          /* ignore */
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [crop, onChange, layout],
  );

  const handleCls =
    'absolute z-[2] h-2.5 w-2.5 rounded-sm border border-amber-500 bg-white shadow nodrag nopan';

  return (
    <div
      className={`pointer-events-none absolute inset-0 z-[4] overflow-visible nodrag nopan ${className}`}
      aria-hidden
    >
      {/* 遮罩：未裁源占位内、保留区（= layout）外 */}
      <div
        className="pointer-events-none absolute"
        style={{
          left: `${sourceRect.x * 100}%`,
          top: `${sourceRect.y * 100}%`,
          width: `${sourceRect.w * 100}%`,
          height: `${sourceRect.h * 100}%`,
        }}
      >
        {C.top > 0.0005 ? (
          <div className="absolute left-0 right-0 top-0 bg-black/45" style={{ height: `${C.top * 100}%` }} />
        ) : null}
        {C.bottom > 0.0005 ? (
          <div className="absolute left-0 right-0 bottom-0 bg-black/45" style={{ height: `${C.bottom * 100}%` }} />
        ) : null}
        {C.left > 0.0005 ? (
          <div
            className="absolute left-0 bg-black/45"
            style={{
              top: `${C.top * 100}%`,
              bottom: `${C.bottom * 100}%`,
              width: `${C.left * 100}%`,
            }}
          />
        ) : null}
        {C.right > 0.0005 ? (
          <div
            className="absolute right-0 bg-black/45"
            style={{
              top: `${C.top * 100}%`,
              bottom: `${C.bottom * 100}%`,
              width: `${C.right * 100}%`,
            }}
          />
        ) : null}
      </div>
      <div
        className="pointer-events-auto absolute box-border border-2 border-amber-400/90 shadow-[0_0_0_1px_rgba(245,158,11,0.35)] nodrag nopan"
        style={{
          left: `${L.x * 100}%`,
          top: `${L.y * 100}%`,
          width: `${L.w * 100}%`,
          height: `${L.h * 100}%`,
        }}
      >
        {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((id) => {
          const pos =
            id === 'nw'
              ? 'left-0 top-0'
              : id === 'n'
                ? 'left-1/2 top-0 -translate-x-1/2'
                : id === 'ne'
                  ? 'right-0 top-0'
                  : id === 'e'
                    ? 'right-0 top-1/2 -translate-y-1/2'
                    : id === 'se'
                      ? 'right-0 bottom-0'
                      : id === 's'
                        ? 'left-1/2 bottom-0 -translate-x-1/2'
                        : id === 'sw'
                          ? 'left-0 bottom-0'
                          : 'left-0 top-1/2 -translate-y-1/2';
          return (
            <div
              key={id}
              className={`${handleCls} ${pos}`}
              style={{ cursor: HANDLE_CURSORS[id] }}
              onPointerDown={onPointerDown(id)}
            />
          );
        })}
      </div>
    </div>
  );
};

export default ClipCropTransformOverlay;
