import React, { useMemo } from 'react';
import { BaseEdge, EdgeLabelRenderer, EdgeProps, getBezierPath } from 'reactflow';
import { Scissors } from 'lucide-react';

const EDGE_ATTACH_OVERLAP = 0;
const CURVATURE = 0.38;

/**
 * SVG 渐变流光连线：
 * - 主线：细线 + 流动高亮
 * - 光晕：粗线低透明度，提升“发光”质感
 */
export default function AnimatedGradientEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    style,
    selected,
    data,
  } = props;
  const sourceXAdjusted =
    sourcePosition === 'right'
      ? sourceX - EDGE_ATTACH_OVERLAP
      : sourcePosition === 'left'
        ? sourceX + EDGE_ATTACH_OVERLAP
        : sourceX;
  const targetXAdjusted =
    targetPosition === 'right'
      ? targetX - EDGE_ATTACH_OVERLAP
      : targetPosition === 'left'
        ? targetX + EDGE_ATTACH_OVERLAP
        : targetX;

  const geom = useMemo(() => {
    const [path, labelX, labelY] = getBezierPath({
      sourceX: sourceXAdjusted,
      sourceY,
      sourcePosition,
      targetX: targetXAdjusted,
      targetY,
      targetPosition,
      curvature: CURVATURE,
    });
    return { path, labelX, labelY, sx: sourceXAdjusted, sy: sourceY, tx: targetXAdjusted, ty: targetY };
  }, [sourceXAdjusted, sourceY, sourcePosition, targetXAdjusted, targetY, targetPosition]);
  const edgePath = geom.path;

  const showScissors = !!(data as any)?.showScissors;
  const onDelete = (data as any)?.onDelete;
  const isSelected = !!(data as any)?.isSelected;
  const onCenterClick = (data as any)?.onCenterClick;

  const gradientId = useMemo(() => `edge-grad-${id}`, [id]);
  const glowGradientId = useMemo(() => `edge-glow-${id}`, [id]);

  const baseWidth = Number(style?.strokeWidth ?? 4);

  return (
    <>
      <path className="nexflow-edge-hitarea" d={edgePath} />
      {/* 选中时居中位置透明可点区域，点击显示剪刀 */}
      {isSelected && !showScissors && onCenterClick && (
        <circle
          cx={geom.labelX}
          cy={geom.labelY}
          r={14}
          fill="transparent"
          stroke="none"
          style={{ pointerEvents: 'all', cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation();
            onCenterClick();
          }}
          aria-label="点击显示删除按钮"
        />
      )}
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={geom.sx} y1={geom.sy} x2={geom.tx} y2={geom.ty}>
          <stop offset="0%" stopColor="rgba(160,160,160,0.35)" />
          <stop offset="35%" stopColor="rgba(255,255,255,0.95)">
            <animate attributeName="offset" values="-0.35;1.25" dur="2.2s" repeatCount="indefinite" />
          </stop>
          <stop offset="55%" stopColor="rgba(255,255,255,0.12)">
            <animate attributeName="offset" values="-0.15;1.45" dur="2.2s" repeatCount="indefinite" />
          </stop>
          <stop offset="100%" stopColor="rgba(160,160,160,0.3)" />
        </linearGradient>
        <linearGradient id={glowGradientId} gradientUnits="userSpaceOnUse" x1={geom.sx} y1={geom.sy} x2={geom.tx} y2={geom.ty}>
          <stop offset="0%" stopColor="rgba(255,255,255,0)" />
          <stop offset="42%" stopColor={selected ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.3)'}>
            <animate attributeName="offset" values="-0.25;1.35" dur="2.2s" repeatCount="indefinite" />
          </stop>
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>

      <BaseEdge
        id={`${id}-glow`}
        path={edgePath}
        style={{
          ...style,
          stroke: `url(#${glowGradientId})`,
          strokeWidth: selected ? baseWidth + 4 : baseWidth + 3,
          opacity: selected ? 0.9 : 0.7,
          filter: 'blur(2px)',
          strokeDasharray: 'none',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: `url(#${gradientId})`,
          strokeWidth: selected ? baseWidth + 0.6 : baseWidth,
          opacity: 0.98,
          strokeDasharray: 'none',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }}
      />
      {showScissors && onDelete && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="nodrag nopan flex items-center justify-center w-8 h-8 rounded-full bg-red-500/90 hover:bg-red-500 text-white shadow-lg border border-red-400/50 transition-colors"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${geom.labelX}px, ${geom.labelY}px)`,
              pointerEvents: 'all',
            }}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="删除连接线"
            aria-label="删除连接线"
          >
            <Scissors className="w-4 h-4" strokeWidth={2} />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
