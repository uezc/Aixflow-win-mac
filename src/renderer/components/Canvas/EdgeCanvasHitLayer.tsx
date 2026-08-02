import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Edge, Node } from 'reactflow';
import { Minus } from 'lucide-react';
import type { CanvasEngine } from '../../utils/CanvasEngine';
import { buildBezierPathD, getBezierMidpoint, getNodeHandle } from './EdgeCanvasLayer';

interface EdgeCanvasHitLayerProps {
  enabled: boolean;
  edges: Edge[];
  nodes: Node[];
  /** 从 CanvasEngine 读取 transform，与 EdgeCanvasLayer 像素级一致 */
  canvasEngine: CanvasEngine;
  viewportWidth: number;
  viewportHeight: number;
  containerRef: React.RefObject<HTMLElement | null>;
  selectedEdgeId?: string | null;
  onEdgeClick?: (event: React.MouseEvent, edge: Edge) => void;
  onEdgeCenterClick?: (edge: Edge) => void;
  onEdgeDeleteRequest?: (edgeId: string) => void;
  onPaneClick?: () => void;
  edgeDeleteModeId?: string | null;
  /** 平移/缩放期间暂停 transform 订阅，避免 HitLayer 每帧 setState */
  pauseTransformSync?: boolean;
}

const EDGE_ATTACH_OVERLAP = 0;

/**
 * Canvas 模式下的连接线点击检测层：透明 SVG path 覆盖，支持点击选中与剪刀删除。
 */
export default function EdgeCanvasHitLayer({
  enabled,
  edges,
  nodes,
  canvasEngine,
  viewportWidth,
  viewportHeight,
  containerRef,
  selectedEdgeId = null,
  onEdgeClick,
  onEdgeCenterClick,
  onEdgeDeleteRequest,
  onPaneClick,
  edgeDeleteModeId = null,
  pauseTransformSync = false,
}: EdgeCanvasHitLayerProps) {
  const [state, setState] = useState<{ transform: [number, number, number]; draggingNode: { nodeId: string; x: number; y: number; width: number; height: number } | null }>(() => ({
    transform: canvasEngine.getTransform(),
    draggingNode: canvasEngine.getDraggingNode(),
  }));
  useEffect(() => {
    if (pauseTransformSync) return;
    return canvasEngine.subscribe((t, draggingNode) => setState({ transform: t, draggingNode }));
  }, [canvasEngine, pauseTransformSync]);
  const [tx, ty, zoom] = pauseTransformSync ? canvasEngine.getTransform() : state.transform;
  const draggingOverride = pauseTransformSync ? canvasEngine.getDraggingNode() : state.draggingNode;
  const nodesMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const edgePaths = useMemo(() => {
    if (!enabled || !containerRef.current) return [];
    const viewport = containerRef.current.querySelector('.react-flow__viewport') as HTMLElement | null;
    if (!viewport) return [];
    const viewportRect = viewport.getBoundingClientRect();

    return edges
      .map((edge) => {
        const src = getNodeHandle(viewport, edge.source, 'right', viewportRect, tx, ty, zoom, nodesMap, edge.sourceHandle ?? undefined, draggingOverride ?? undefined);
        const tgt = getNodeHandle(viewport, edge.target, 'left', viewportRect, tx, ty, zoom, nodesMap, edge.targetHandle ?? undefined, draggingOverride ?? undefined);
        if (!src || !tgt) return null;
        const sx = src.x - EDGE_ATTACH_OVERLAP;
        const sy = src.y;
        const tgtX = tgt.x + EDGE_ATTACH_OVERLAP;
        const tgtY = tgt.y;
        const d = buildBezierPathD(sx, sy, tgtX, tgtY);
        const midpoint = getBezierMidpoint(sx, sy, tgtX, tgtY);
        const { x: screenX, y: screenY } = canvasEngine.flowToScreenPosition(midpoint.x, midpoint.y);
        return { edge, d, screenX, screenY };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
  }, [enabled, edges, nodes, canvasEngine, tx, ty, zoom, draggingOverride, containerRef]);

  const handleSvgClick = useCallback(
    (e: React.MouseEvent<SVGGElement | HTMLDivElement>) => {
      const target = e.target as HTMLElement | SVGElement;
      const edgePath = target.closest?.('[data-edge-id]') as SVGElement | null;
      const edgeCenter = target.closest?.('[data-edge-center-id]') as SVGElement | null;
      const edgeId = edgePath?.getAttribute?.('data-edge-id') ?? edgeCenter?.getAttribute?.('data-edge-center-id');
      const centerId = edgeCenter?.getAttribute?.('data-edge-center-id');
      if (!edgeId) {
        onPaneClick?.();
        return;
      }
      e.stopPropagation();
      const edge = edges.find((x) => x.id === edgeId);
      if (!edge) return;
      if (centerId) {
        onEdgeCenterClick?.(edge);
      } else {
        onEdgeClick?.(e as unknown as React.MouseEvent, edge);
      }
    },
    [edges, onEdgeClick, onEdgeCenterClick, onPaneClick],
  );

  if (!enabled) return null;

  return (
    <div
      className="absolute inset-0"
      style={{
        zIndex: 9999,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        inset: 0,
      }}
      aria-hidden
      onClickCapture={handleSvgClick}
    >
      <svg
        width={viewportWidth}
        height={viewportHeight}
        className="absolute inset-0 overflow-visible"
        style={{ pointerEvents: 'none' }}
      >
        <g
          transform={`translate(${tx}px, ${ty}px) scale(${zoom})`}
          style={{ pointerEvents: 'none' }}
          onClick={handleSvgClick}
        >
          {edgePaths.length > 0 && edgePaths.map(({ edge, d, screenX, screenY }) => (
            <React.Fragment key={edge.id}>
              <path
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={20}
                style={{ pointerEvents: 'stroke' as const, cursor: 'pointer', vectorEffect: 'non-scaling-stroke' }}
                data-edge-id={edge.id}
              />
              {edge.id === selectedEdgeId &&
                edge.id !== edgeDeleteModeId &&
                onEdgeCenterClick && (
                <circle
                  cx={(screenX - tx) / zoom}
                  cy={(screenY - ty) / zoom}
                  r={14 / zoom}
                  fill="transparent"
                  stroke="none"
                  style={{ pointerEvents: 'all', cursor: 'pointer' }}
                  data-edge-center-id={edge.id}
                  aria-label="点击显示删除按钮"
                />
              )}
            </React.Fragment>
          ))}
        </g>
      </svg>
      {edgePaths
        .filter(({ edge }) => edge.id === edgeDeleteModeId && onEdgeDeleteRequest)
        .map(({ edge, screenX, screenY }) => (
          <button
            key={edge.id}
            type="button"
            className="nodrag nopan absolute nexflow-edge-delete-btn -translate-x-1/2 -translate-y-1/2"
            style={{
              left: screenX,
              top: screenY,
              pointerEvents: 'all',
            }}
            onClick={(e) => {
              e.stopPropagation();
              onEdgeDeleteRequest?.(edge.id);
            }}
            title="删除连接线"
            aria-label="删除连接线"
          >
            <Minus className="w-4 h-4" strokeWidth={2.5} />
          </button>
        ))}
    </div>
  );
}
