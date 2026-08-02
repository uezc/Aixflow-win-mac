import React, { useMemo } from 'react';
import { BaseEdge, EdgeLabelRenderer, EdgeProps, getBezierPath } from 'reactflow';
import { Minus } from 'lucide-react';

const EDGE_ATTACH_OVERLAP = 0;
const CURVATURE = 0.38;

/** 视觉一致优先：实时重算路径，拖拽时连线跟随模块移动。支持点击选中、剪刀删除。 */
export default function FrozenBezierEdge(props: EdgeProps) {
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

  const { path, labelX, labelY } = useMemo(() => {
    const [p, lx, ly] = getBezierPath({
      sourceX: sourceXAdjusted,
      sourceY,
      sourcePosition,
      targetX: targetXAdjusted,
      targetY,
      targetPosition,
      curvature: CURVATURE,
    });
    return { path: p, labelX: lx, labelY: ly };
  }, [sourceXAdjusted, sourceY, sourcePosition, targetXAdjusted, targetY, targetPosition]);

  const showScissors = !!(data as any)?.showScissors;
  const onDelete = (data as any)?.onDelete;
  const isSelected = !!(data as any)?.isSelected;
  const onCenterClick = (data as any)?.onCenterClick;

  return (
    <>
      {/* 透明命中区：12px 宽，便于点击 */}
      <path className="nexflow-edge-hitarea" d={path} />
      {/* 选中时居中位置透明可点区域，点击显示剪刀 */}
      {isSelected && !showScissors && onCenterClick && (
        <circle
          cx={labelX}
          cy={labelY}
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
      {isSelected && (
        <path
          d={path}
          className="nexflow-edge-aa-soft"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ ...style, strokeDasharray: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }} />
      {showScissors && onDelete && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="nodrag nopan nexflow-edge-delete-btn"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="删除连接线"
            aria-label="删除连接线"
          >
            <Minus className="w-4 h-4" strokeWidth={2.5} />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
