// @ts-nocheck
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Handle, Position, NodeProps, useReactFlow, useUpdateNodeInternals, useStore } from 'reactflow';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { workspaceChromeT } from '../../i18n/workspaceI18n';

const MAX_OUTPUTS = 20;
const CIRCLE_NUMS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];

export interface TextSplitNodeData {
  inputText?: string;
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
}

function tryConvert(value: string, mode: 'string' | 'number' | 'boolean'): string | number | boolean {
  if (mode === 'string') return value;
  if (mode === 'number') {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
    return value;
  }
  if (mode === 'boolean') {
    const lower = value.toLowerCase();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0' || lower === '') return false;
    return value;
  }
  return value;
}

function unescapeSep(s: string): string {
  if (s === '\\n') return '\n';
  if (s === '\\t') return '\t';
  return s;
}

function computeSegments(
  inputText: string,
  separator: string,
  trimAndFilterEmpty: boolean,
  convertType: 'string' | 'number' | 'boolean'
): (string | number | boolean)[] {
  if (inputText == null || String(inputText).trim() === '') return [];
  const raw = String(inputText).replace(/\r?\n/g, ' ').trim();
  const sep = unescapeSep(separator === '' ? ',' : separator);
  let parts = raw.split(sep);
  if (trimAndFilterEmpty) {
    parts = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  } else {
    parts = parts.map((p) => p.trim());
  }
  return parts.map((p) => tryConvert(p, convertType));
}

const MIN_WIDTH = 200;
const MIN_HEIGHT = 100;

export const TextSplitNode: React.FC<TextSplitNodeProps> = (props) => {
  const { id, data, selected, isDarkMode = true, performanceMode = false, dragging, xPos = 0, yPos = 0 } = props as any;
  const { setNodes } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const nodeRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const { locale } = useAppLocale();
  const wc = workspaceChromeT(locale);

  const [inputText, setInputText] = useState(data?.inputText ?? '');
  const [separator, setSeparator] = useState(data?.separator ?? '&&&');
  const [trimAndFilterEmpty] = useState(data?.trimAndFilterEmpty ?? true);
  const [convertType] = useState<'string' | 'number' | 'boolean'>(data?.convertType ?? 'string');

  const edges = useStore((s) => s.edges);
  const transform = useStore((s) => s.transform);

  // 连线传入的 data.inputText 优先，避免等 state 同步导致「有输入却算成 0 段」的帧，从而消除尺寸来回跳
  const effectiveInputText =
    data?.inputText != null && String(data.inputText).trim() !== ''
      ? String(data.inputText)
      : inputText;

  const segments = useMemo(() => {
    return computeSegments(effectiveInputText, separator, trimAndFilterEmpty, convertType);
  }, [effectiveInputText, separator, trimAndFilterEmpty, convertType]);

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
    [id, setNodes]
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
  const baseH = 100;
  const perHandle = 28;
  const outputBaseTop = 72;
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
      separator,
      trimAndFilterEmpty,
      convertType,
    });
  }, [segmentsJson, effectiveInputText, separator, id, updateNodeData]);

  const handleSeparatorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setSeparator(v);
    updateNodeData({ separator: v });
  };

  const baseH = 100;
  const perHandle = 28;
  const outputBaseTop = 72;
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

      <div className="p-2 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <label className={`text-xs shrink-0 ${isDarkMode ? 'text-white' : 'text-gray-700'}`}>{wc.textSplitSeparatorLabel}</label>
          <input
            type="text"
            value={separator}
            onChange={handleSeparatorChange}
            placeholder="如 \\n 或 ,"
            className={`nodrag flex-1 min-w-0 min-w-[80px] text-sm rounded px-2 py-1.5 border cursor-text ${
              isDarkMode ? 'bg-white/10 border-white/20 text-white placeholder:text-white/50' : 'bg-white border-gray-300 text-gray-900'
            }`}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />
        </div>
      </div>

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
