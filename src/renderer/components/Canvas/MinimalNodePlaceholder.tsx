import React from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';

/** [极小缩放静态化] Zoom < 0.05 时渲染极简占位。阈值 5% 确保 10%+ 时仍显示完整画面 */
const TINY_ZOOM_THRESHOLD = 0.05;

export const TINY_ZOOM_THRESHOLD_VALUE = TINY_ZOOM_THRESHOLD;

export const MinimalNodePlaceholder: React.FC<NodeProps> = ({ data, id }) => {
  const w = Math.max(60, Number(data?.width) || 120);
  const h = Math.max(40, Number(data?.height) || 80);
  const bg =
    (data as any)?.imageAsset?.avgColorHex ||
    (data as any)?.videoAsset?.avgColorHex ||
    '#374151';

  return (
    <div
      data-id={id}
      className="custom-node-container custom-node-container--bare rounded-xl"
      style={{
        width: w,
        height: h,
        minWidth: 60,
        minHeight: 40,
        backgroundColor: bg,
      }}
    >
      <Handle type="target" position={Position.Left} id="input" style={{ top: '50%' }} className="nexflow-plus-handle nexflow-plus-handle-left" />
      <Handle type="source" position={Position.Right} id="output" className="nexflow-plus-handle nexflow-plus-handle-right" />
    </div>
  );
};
