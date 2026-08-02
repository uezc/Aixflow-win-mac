// @ts-nocheck
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Handle, Position, NodeProps, useReactFlow, useUpdateNodeInternals, useStore } from 'reactflow';
import { useFrozenFlowViewport } from '../../hooks/useFrozenFlowViewport';
import { computeTextSplitSegments, TEXT_SPLIT_DEFAULT_SEPARATOR } from '../../utils/textSplitSegmentUtils';
import { scaleModulePx } from '../../utils/moduleDisplayScale';

const MAX_OUTPUTS = 20;
const CIRCLE_NUMS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];

function computeSegments(
  inputText: string,
  trimAndFilterEmpty: boolean,
  convertType: 'string' | 'number' | 'boolean',
): (string | number | boolean)[] {
  return computeTextSplitSegments(inputText, TEXT_SPLIT_DEFAULT_SEPARATOR, trimAndFilterEmpty, convertType);
}

export interface TextSplitNodeData {
  inputText?: string;
  /** @deprecated 固定按换行拆分 */
  separator?: string;
  trimAndFilterEmpty?: boolean;
  convertType?: 'string' | 'number' | 'boolean';
  segments?: (string | number | boolean)[];
  segmentCount?: number;
  width?: number;
  height?: number;
  title?: string;
  isUserResized?: boolean;
}

interface TextSplitNodeProps extends NodeProps<TextSplitNodeData> {
  isDarkMode?: boolean;
  performanceMode?: boolean;
  onCleanupEdgesForHandles?: (nodeId: string, keepSourceHandles: string[]) => void;
  onDataChange?: (updates: Partial<TextSplitNodeData>) => void;
}

const MIN_WIDTH = scaleModulePx(200);
const MIN_HEIGHT = scaleModulePx(100);

export const TextSplitNode: React.FC<TextSplitNodeProps> = (props) => {
  const { id, data, selected, isDarkMode = true, performanceMode = false, dragging, xPos = 0, yPos = 0, onDataChange } = props as any;
  const { setNodes } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const nodeRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  const [inputText, setInputText] = useState(data?.inputText ?? '');
  const [trimAndFilterEmpty] = useState(data?.trimAndFilterEmpty ?? true);
  const [convertType] = useState<'string' | 'number' | 'boolean'>(data?.convertType ?? 'string');

  const edges = useStore((s) => s.edges);
  const transformTuple = useFrozenFlowViewport();
  const transform = [transformTuple.x, transformTuple.y, transformTuple.zoom] as const;

  // 连线传入的 data.inputText 优先，避免等 state 同步导致「有输入却算成 0 段」的帧，从而消除尺寸来回跳
  const effectiveInputText =
    data?.inputText != null && String(data.inputText).trim() !== ''
      ? String(data.inputText)
      : inputText;

  const segments = useMemo(() => {
    return computeSegments(effectiveInputText, trimAndFilterEmpty, convertType);
  }, [effectiveInputText, trimAndFilterEmpty, convertType]);

  const capped = segments.slice(0, MAX_OUTPUTS);
  const hasMore = segments.length > MAX_OUTPUTS;
  const segmentCount = capped.length;
  const isErrorOrEmpty = capped.length === 0;

  const dispatchedHandles = useMemo(() => {
    const set = new Set<string>();
    edges.forEach((e) => {
      if (e.source !== id) return;
      const sh = e.sourceHandle;
      if (sh === 'output-null' || (sh && sh.startsWith('output-'))) {
        set.add(sh!);
      } else if (sh === 'output') {
        set.add(isErrorOrEmpty ? 'output-null' : 'output-0');
      }
    });
    return set;
  }, [edges, id, isErrorOrEmpty]);

  const updateNodeData = useCallback(
    (updates: Partial<TextSplitNodeData>) => {
      if (onDataChange) {
        onDataChange(updates);
        return;
      }
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== id) return n;
          const next = { ...n, data: { ...n.data, ...updates } };
          if (updates.width !== undefined || updates.height !== undefined) {
            next.style = {
              ...(n.style || {}),
              width: `${updates.width ?? n.data?.width ?? MIN_WIDTH}px`,
              height: `${updates.height ?? n.data?.height ?? MIN_HEIGHT}px`,
              minWidth: `${MIN_WIDTH}px`,
              minHeight: `${MIN_HEIGHT}px`,
            };
          }
          return next;
        })
      );
    },
    [id, setNodes, onDataChange]
  );

  // 仅当 data 有值时把 data 同步到 state（便于断开连线后保留上次内容）；不把 data 空值写回 state
  useEffect(() => {
    const fromData = data?.inputText;
    if (fromData == null || String(fromData).trim() === '' || fromData === inputText) return;
    setInputText(String(fromData));
  }, [data?.inputText]);

  const prevCountRef = useRef<number>(segmentCount);
  const prevErrorRef = useRef<boolean>(isErrorOrEmpty);

  // 仅当输出数量或空状态变化时：更新 internals、边清理、写回 height，避免频繁 setNodes 导致节点跳动
  useEffect(() => {
    const countChanged = prevCountRef.current !== segmentCount;
    const errorChanged = prevErrorRef.current !== isErrorOrEmpty;
    prevCountRef.current = segmentCount;
    prevErrorRef.current = isErrorOrEmpty;

    if (countChanged || errorChanged) {
      const keepHandles = isErrorOrEmpty
        ? ['output-null']
        : capped.map((_, i) => `output-${i}`);
  const baseH = 72;
  const perHandle = 28;
  const outputBaseTop = 36;
  const bottomPad = 12;
  const newHeight = Math.max(baseH, outputBaseTop + segmentCount * perHandle + bottomPad);
  const prevHeight = data?.height ?? newHeight;
  const isUserResized = data?.isUserResized === true;
  const heightToSet = isUserResized ? Math.max(prevHeight, newHeight) : newHeight;
      updateNodeData({
        segments: capped,
        segmentCount: isErrorOrEmpty ? 0 : segmentCount,
        height: heightToSet,
      });
      updateNodeInternals(id);
      props.onCleanupEdgesForHandles?.(id, keepHandles);
    }
  }, [segmentCount, isErrorOrEmpty, id, updateNodeInternals, props.onCleanupEdgesForHandles]);

  const segmentsJson = JSON.stringify(capped);
  // 写回 segments/配置，用 effectiveInputText 作为持久化的 inputText，与计算一致，避免来回切换
  useEffect(() => {
    updateNodeData({
      segments: capped,
      inputText: effectiveInputText,
      separator: TEXT_SPLIT_DEFAULT_SEPARATOR,
      trimAndFilterEmpty,
      convertType,
    });
  }, [segmentsJson, effectiveInputText, id, updateNodeData]);

  const baseH = 72;
  const perHandle = 28;
  const outputBaseTop = 36;
  const bottomPad = 12;
  const computedHeight = Math.max(baseH, outputBaseTop + segmentCount * perHandle + bottomPad);
  const width = data?.width ?? MIN_WIDTH;
  const isUserResized = data?.isUserResized === true;
  const height = isUserResized ? Math.max(computedHeight, data?.height ?? computedHeight) : computedHeight;

  const zoom = transform?.[2] ?? 1;
  const vx = transform?.[0] ?? 0;
  const vy = transform?.[1] ?? 0;
  const isHardFrozen = useMemo(() => {
    if (!performanceMode || selected || dragging) return false;
    const viewportLeft = -vx / zoom;
    const viewportTop = -vy / zoom;
    const viewportWidth = (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom;
    const viewportHeight = (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom;
    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const nodeRight = xPos + width;
    const nodeBottom = yPos + height;
    const intersects = !(nodeRight < viewportLeft || xPos > viewportRight || nodeBottom < viewportTop || yPos > viewportBottom);
    if (intersects) return false;
    const distX = nodeRight < viewportLeft ? (viewportLeft - nodeRight) : (xPos > viewportRight ? xPos - viewportRight : 0);
    const distY = nodeBottom < viewportTop ? (viewportTop - nodeBottom) : (yPos > viewportBottom ? yPos - viewportBottom : 0);
    return distX > viewportWidth * 2 || distY > viewportHeight * 2;
  }, [performanceMode, selected, dragging, vx, vy, zoom, xPos, yPos, width, height]);
  const showPlaceholder = isHardFrozen;

  return (
    <div
      ref={nodeRef}
      data-id={id}
      className={`custom-node-container rounded-lg overflow-visible relative group ${
        isDarkMode ? 'apple-panel' : 'apple-panel-light'
      } ${selected && isDarkMode ? 'ring-2 ring-green-400/80' : selected ? 'ring-2 ring-green-500' : ''}`}
      style={{
        width,
        height,
        minWidth: MIN_WIDTH,
        minHeight: MIN_HEIGHT,
        userSelect: dragging ? 'none' : 'auto',
        willChange: dragging ? 'transform' : 'auto',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Handle 必须始终渲染 */}
      <Handle type="target" position={Position.Left} id="input" className={`nexflow-plus-handle nexflow-plus-handle-left !left-0 ${showPlaceholder ? 'opacity-0 pointer-events-none' : ''}`} />
      {isErrorOrEmpty || showPlaceholder ? (
        <div className="absolute z-20 flex items-center justify-end" style={{ right: -8, top: '50%', transform: 'translateY(-50%)' }}>
          <Handle type="source" position={Position.Right} id="output-null" isConnectable={20} className={`nexflow-plus-handle nexflow-plus-handle-right nexflow-split-handle nexflow-split-handle-outside !right-0 !top-1/2 ${showPlaceholder ? 'opacity-0 pointer-events-none' : ''} ${dispatchedHandles.has('output-null') ? 'nexflow-split-handle-connected' : ''}`} />
        </div>
      ) : (
        capped.map((_, i) => (
          <div key={i} className="absolute z-20 flex items-center justify-end" style={{ right: -8, top: outputBaseTop + i * perHandle + perHandle / 2, transform: 'translateY(-50%)' }}>
            <Handle type="source" position={Position.Right} id={`output-${i}`} isConnectable={20} className={`nexflow-plus-handle nexflow-plus-handle-right nexflow-split-handle nexflow-split-handle-outside !right-0 ${showPlaceholder ? 'opacity-0 pointer-events-none' : ''} ${dispatchedHandles.has(`output-${i}`) ? 'nexflow-split-handle-connected' : ''}`} />
          </div>
        ))
      )}
      {showPlaceholder ? (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className={`text-xs font-medium ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>
            {isHardFrozen ? 'text split（冻结）' : 'text split'}
          </span>
        </div>
      ) : (
      <>
      {/* 框体外左上角小标题 */}
      <div className="title-area absolute -top-7 left-0 z-10">
        <span className={`font-bold text-xs select-none ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
          text split
        </span>
      </div>

      {/* 固定按换行拆分，不再提供分隔符输入 */}

      {/* 框内列表：无滚动条，高度随行数自动撑开；pr-4 使序号文字与右侧绿点间距约 2–4px，与替换角色等模块一致 */}
      {!isErrorOrEmpty && (
        <div
          className="absolute left-0 right-0 overflow-hidden pl-2 pr-4 pointer-events-none"
          style={{ top: outputBaseTop, height: segmentCount * perHandle }}
        >
          {capped.map((seg, i) => (
            <div
              key={i}
              className={`min-h-[28px] flex items-center gap-1.5 text-[11px] leading-tight ${isDarkMode ? 'text-white' : 'text-gray-800'}`}
              style={{ minHeight: perHandle }}
            >
              <span className="font-medium shrink-0">{CIRCLE_NUMS[i]}</span>
              <span className="flex-1 min-w-0 truncate" title={String(seg)}>{String(seg).trim() || '—'}</span>
            </div>
          ))}
        </div>
      )}

      {hasMore && (
        <div className={`absolute text-xs right-2 bottom-1 ${isDarkMode ? 'text-white' : 'text-gray-600'}`}>
          +{segments.length - MAX_OUTPUTS} More...
        </div>
      )}
      </>
      )}
    </div>
  );
};
