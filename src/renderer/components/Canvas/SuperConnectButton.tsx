import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Node } from 'reactflow';

export type SuperConnectMode = 'forward' | 'reverse';

/** forward：选区右侧，多源→一落点；reverse：选区左侧，一落点（源）→多目标 */
export type SuperConnectPlacement = 'selection-right' | 'selection-left';

interface SuperConnectButtonProps {
  mode: SuperConnectMode;
  placement?: SuperConnectPlacement;
  selectedNodes: Node[];
  position: { x: number; y: number };
  isDarkMode: boolean;
  onSuperConnect: (sourceNodeIds: string[], targetNodeId: string) => void;
  onReverseSuperConnect: (sourceNodeId: string, targetNodeIds: string[]) => void;
  /** 获取容器边界，用于坐标转换 */
  containerRef: React.RefObject<HTMLElement | null>;
  /** 画布缩放比例，用于按钮随画布缩放 */
  zoom?: number;
}

/**
 * 超级连线：正向 = 多选模块输出全部接入目标；反向 = 拖到「源模块」，其输出接入全部选中目标（不含源）。
 */
const SuperConnectButton: React.FC<SuperConnectButtonProps> = ({
  mode,
  placement = mode === 'forward' ? 'selection-right' : 'selection-left',
  selectedNodes,
  position,
  isDarkMode: _isDarkMode,
  onSuperConnect,
  onReverseSuperConnect,
  containerRef,
  zoom = 1,
}) => {
  const markerId = useId().replace(/:/g, '');
  const [isDragging, setIsDragging] = useState(false);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const selectedIds = selectedNodes.map((n) => n.id).filter(Boolean);
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (selectedIds.length < 2) return;
      setIsDragging(true);
      startPosRef.current = { x: e.clientX, y: e.clientY };
      setDragPos({ x: e.clientX, y: e.clientY });
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [selectedIds.length]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: PointerEvent) => {
      setDragPos({ x: e.clientX, y: e.clientY });
    };

    const handleUp = (e: PointerEvent) => {
      setIsDragging(false);
      setDragPos(null);
      startPosRef.current = null;

      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (!target || !containerRef.current?.contains(target)) return;

      const nodeEl = target.closest('.react-flow__node') as HTMLElement | null;
      if (!nodeEl) return;

      const elWithId = nodeEl.querySelector('[data-id]') || nodeEl;
      const pickedId = elWithId.getAttribute('data-id');
      if (!pickedId) return;

      const ids = selectedIdsRef.current;
      const m = modeRef.current;
      if (m === 'forward') {
        if (ids.includes(pickedId)) return;
        onSuperConnect(ids, pickedId);
      } else {
        const sourceId = pickedId;
        const targetIds = ids.filter((id) => id !== sourceId);
        if (targetIds.length === 0) return;
        onReverseSuperConnect(sourceId, targetIds);
      }
    };

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    };
  }, [isDragging, onSuperConnect, onReverseSuperConnect, containerRef]);

  if (selectedIds.length < 2) return null;

  const placementStyle: React.CSSProperties =
    placement === 'selection-right'
      ? {
          left: `${position.x}px`,
          top: `${position.y}px`,
          transform: `translate(-100%, -50%) scale(${zoom})`,
          transformOrigin: 'right center',
        }
      : {
          left: `${position.x}px`,
          top: `${position.y}px`,
          transform: `translate(0, -50%) scale(${zoom})`,
          transformOrigin: 'left center',
        };

  const titleForward = `拖拽到目标模块，将 ${selectedIds.length} 个模块的输出全部接入`;
  const titleReverse = `拖到「源模块」上，将其输出批量接入这 ${selectedIds.length} 个选中模块（不含源）`;

  return (
    <>
      <div
        className="nodrag nopan flex items-center justify-center"
        style={{
          ...placementStyle,
          position: 'absolute',
          pointerEvents: 'auto',
          zIndex: 1001,
          isolation: 'isolate',
        }}
      >
        <button
          type="button"
          onPointerDown={handlePointerDown}
          className={`
            flex items-center justify-center w-8 h-8 rounded-full shadow-lg transition-all
            ${isDragging
              ? 'scale-110 ring-2 ring-white/50'
              : 'hover:scale-105 animate-super-connect-breathe'
            }
            bg-emerald-500/50 hover:bg-emerald-500/70 text-white border border-emerald-400/40
          `}
          title={mode === 'forward' ? titleForward : titleReverse}
        >
          <Plus className="w-4 h-4" strokeWidth={2.5} />
        </button>
      </div>

      {isDragging && startPosRef.current && dragPos && (
        <svg
          className="pointer-events-none z-[9998]"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
          }}
        >
          <defs>
            <marker
              id={`super-connect-arrow-${markerId}`}
              markerWidth="10"
              markerHeight="10"
              refX="9"
              refY="3"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L0,6 L9,3 z" fill="#10b981" />
            </marker>
          </defs>
          <line
            x1={startPosRef.current.x}
            y1={startPosRef.current.y}
            x2={dragPos.x}
            y2={dragPos.y}
            stroke="#10b981"
            strokeWidth={3}
            strokeDasharray="6 4"
            markerEnd={`url(#super-connect-arrow-${markerId})`}
          />
        </svg>
      )}
    </>
  );
};

export default SuperConnectButton;
