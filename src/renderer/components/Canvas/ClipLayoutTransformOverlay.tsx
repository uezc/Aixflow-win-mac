import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CLIP_LAYOUT_MIN,
  normalizeClipLayout,
  type ClipLayout,
} from '../../utils/clipLayout';

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';

const HANDLE_CURSORS: Record<Exclude<HandleId, 'move'>, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

export type ClipLayoutTransformOverlayProps = {
  layout: Partial<ClipLayout> | null | undefined;
  onChange: (next: ClipLayout) => void;
  className?: string;
};

function layoutFromDrag(
  handle: HandleId,
  origin: ClipLayout,
  dx: number,
  dy: number,
): ClipLayout {
  let x = origin.x;
  let y = origin.y;
  let w = origin.w;
  let h = origin.h;

  if (handle === 'move') {
    x = origin.x + dx;
    y = origin.y + dy;
    x = Math.max(0, Math.min(1 - w, x));
    y = Math.max(0, Math.min(1 - h, y));
  } else {
    const right = origin.x + origin.w;
    const bottom = origin.y + origin.h;
    if (handle.includes('w')) {
      const nx = Math.max(0, Math.min(right - CLIP_LAYOUT_MIN, origin.x + dx));
      w = right - nx;
      x = nx;
    }
    if (handle.includes('e')) {
      w = Math.max(CLIP_LAYOUT_MIN, Math.min(1 - origin.x, origin.w + dx));
    }
    if (handle.includes('n')) {
      const ny = Math.max(0, Math.min(bottom - CLIP_LAYOUT_MIN, origin.y + dy));
      h = bottom - ny;
      y = ny;
    }
    if (handle.includes('s')) {
      h = Math.max(CLIP_LAYOUT_MIN, Math.min(1 - origin.y, origin.h + dy));
    }
  }
  return normalizeClipLayout({ x, y, w, h });
}

/**
 * 预览区「位置」变换框：拖拽平移；边/角手柄缩放尺寸。
 * 框对应裁切后画面在画布上的占位（layout）；缩放不改 crop。
 * 拖拽期间用本地 draft 保证蓝框跟手；pointerup 再强制提交最终 layout，避免父级重渲染丢最后一帧。
 */
const ClipLayoutTransformOverlay: React.FC<ClipLayoutTransformOverlayProps> = ({
  layout,
  onChange,
  className = '',
}) => {
  const propLayout = normalizeClipLayout(layout);
  const [draft, setDraft] = useState<ClipLayout | null>(null);
  const L = draft ?? propLayout;
  const dragRef = useRef<{
    handle: HandleId;
    startX: number;
    startY: number;
    origin: ClipLayout;
    boxW: number;
    boxH: number;
    last: ClipLayout;
  } | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (dragRef.current) return;
    setDraft(null);
  }, [propLayout.x, propLayout.y, propLayout.w, propLayout.h]);

  const onPointerDown = useCallback(
    (handle: HandleId) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const parent = (e.currentTarget as HTMLElement).closest(
        '[data-splice-preview-frame]',
      ) as HTMLElement | null;
      const rect = parent?.getBoundingClientRect();
      if (!rect?.width || !rect?.height) return;
      const origin = normalizeClipLayout(layout);
      dragRef.current = {
        handle,
        startX: e.clientX,
        startY: e.clientY,
        origin,
        boxW: rect.width,
        boxH: rect.height,
        last: origin,
      };
      setDraft(origin);
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        const d = dragRef.current;
        if (!d) return;
        const dx = (ev.clientX - d.startX) / d.boxW;
        const dy = (ev.clientY - d.startY) / d.boxH;
        const next = layoutFromDrag(d.handle, d.origin, dx, dy);
        d.last = next;
        setDraft(next);
        // 实时写入，预览媒体壳与蓝框同步；松手时再强制提交一次
        onChangeRef.current(next);
      };

      const onUp = (ev: PointerEvent) => {
        const d = dragRef.current;
        const finalLayout = d?.last ?? normalizeClipLayout(layout);
        dragRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture?.(ev.pointerId);
        } catch {
          /* ignore */
        }
        onChangeRef.current(finalLayout);
        setDraft(null);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [layout],
  );

  const handleCls =
    'absolute z-[2] h-2.5 w-2.5 rounded-sm border border-sky-500 bg-white shadow nodrag nopan';

  return (
    <div
      className={`pointer-events-none absolute inset-0 z-[4] overflow-visible nodrag nopan ${className}`}
      aria-hidden
    >
      <div
        className="pointer-events-auto absolute box-border cursor-move border-2 border-sky-400/90 shadow-[0_0_0_1px_rgba(14,165,233,0.35)] nodrag nopan"
        style={{
          left: `${L.x * 100}%`,
          top: `${L.y * 100}%`,
          width: `${L.w * 100}%`,
          height: `${L.h * 100}%`,
        }}
        onPointerDown={onPointerDown('move')}
      >
        {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((id) => {
          // 手柄贴边内侧，避免被预览框 overflow:hidden 裁切
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

export default ClipLayoutTransformOverlay;
