import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useFrozenFlowViewport } from '../../hooks/useFrozenFlowViewport';
import { FileText } from 'lucide-react';
import { useGlobalInteractionSelector } from '../../utils/globalInteractionStore';

const ZOOM_THRESHOLD_FAR = 0.1;
const ZOOM_THRESHOLD_NEAR = 0.5;

interface TextNodeProps {
  id: string;
  initialPos: { x: number; y: number };
  onLinkStart: (nodeId: string, startPos: { x: number; y: number }) => void;
  isSelected?: boolean;
  isDarkMode?: boolean;
  performanceMode?: boolean;
  data?: {
    text?: string;
    width?: number;
    height?: number;
  };
  onTextChange?: (id: string, text: string) => void;
  onSizeChange?: (id: string, size: { w: number; h: number }) => void;
}

export const TextNode: React.FC<TextNodeProps> = ({
  id,
  initialPos,
  onLinkStart,
  isSelected = false,
  isDarkMode = true,
  performanceMode = false,
  data = {},
  onTextChange,
  onSizeChange,
}) => {
  const [size, setSize] = useState({
    w: data.width || 280,
    h: data.height || 160,
  });
  const [text, setText] = useState(data.text || '');
  const nodeRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const viewport = useFrozenFlowViewport();
  const isVisualInteractionLocked = useGlobalInteractionSelector((state) => state.isVisualInteractionLocked);

  // 同步外部数据变化
  useEffect(() => {
    if (data.width !== undefined) setSize((prev) => ({ ...prev, w: data.width! }));
    if (data.height !== undefined) setSize((prev) => ({ ...prev, h: data.height! }));
    if (data.text !== undefined) setText(data.text);
  }, [data.width, data.height, data.text]);

  // 处理文本变化
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);
    if (onTextChange) {
      onTextChange(id, newText);
    }
  };

  // 处理尺寸变化
  const handleSizeChange = (newSize: { w: number; h: number }) => {
    setSize(newSize);
    if (onSizeChange) {
      onSizeChange(id, newSize);
    }
  };

  // 处理链接锚点点击
  const handleAnchorMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation(); // 防止触发画布拖拽或框选
    if (nodeRef.current) {
      const rect = nodeRef.current.getBoundingClientRect();
      // 计算锚点在画布中心的位置 (右侧边缘中间)
      // React Flow 会管理位置，所以这里使用相对位置
      const startX = size.w;
      const startY = size.h / 2;
      onLinkStart(id, { x: startX, y: startY });
    }
  };

  const zoom = viewport.zoom ?? 1;
  const vx = viewport.x ?? 0;
  const vy = viewport.y ?? 0;
  const lodLevel = useMemo<'far' | 'mid' | 'near'>(() => {
    if (zoom < ZOOM_THRESHOLD_FAR) return 'far';
    if (zoom < ZOOM_THRESHOLD_NEAR) return 'mid';
    return 'near';
  }, [zoom]);
  const isHardFrozen = useMemo(() => {
    if (!performanceMode || isSelected) return false;
    const xPos = initialPos?.x ?? 0;
    const yPos = initialPos?.y ?? 0;
    const viewportLeft = -vx / zoom;
    const viewportTop = -vy / zoom;
    const viewportWidth = (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom;
    const viewportHeight = (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom;
    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const nodeRight = xPos + size.w;
    const nodeBottom = yPos + size.h;
    const intersects = !(nodeRight < viewportLeft || xPos > viewportRight || nodeBottom < viewportTop || yPos > viewportBottom);
    if (intersects) return false;
    const distX = nodeRight < viewportLeft ? (viewportLeft - nodeRight) : (xPos > viewportRight ? xPos - viewportRight : 0);
    const distY = nodeBottom < viewportTop ? (viewportTop - nodeBottom) : (yPos > viewportBottom ? yPos - viewportBottom : 0);
    return distX > viewportWidth * 2 || distY > viewportHeight * 2;
  }, [performanceMode, isSelected, initialPos?.x, initialPos?.y, vx, vy, zoom, size.w, size.h]);
  const showPlaceholder = lodLevel === 'far' || isHardFrozen;
  const useLowEnergyTextView = lodLevel === 'near' && isVisualInteractionLocked;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent) => {
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      const line = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      const dy = e.deltaY * line;
      const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
      if (maxTop > 0) el.scrollTop = Math.max(0, Math.min(maxTop, el.scrollTop + dy));
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => el.removeEventListener('wheel', onWheel, { capture: true });
  }, [lodLevel, isVisualInteractionLocked]);

  return (
    <div
      ref={nodeRef}
      data-id={id}
      style={{
        width: size.w,
        height: size.h,
      }}
      className={`group flex flex-col shadow-2xl transition-all duration-300 select-none rounded-lg ${
        isDarkMode 
          ? 'apple-panel' 
          : 'apple-panel-light' /* 使用磨砂材质浅灰半透明背板 */
      }       ${
        isSelected
          ? isDarkMode
            ? 'ring-2 ring-green-400/80'
            : 'ring-2 ring-green-500'
          : ''
      }`}
    >
      {showPlaceholder ? (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center justify-center gap-1">
            <FileText className={`w-4 h-4 ${isDarkMode ? 'text-white/65' : 'text-gray-500'}`} />
            <span className={`text-[10px] font-medium ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>
              {isHardFrozen ? 'text（冻结）' : 'text'}
            </span>
          </div>
        </div>
      ) : (
      <>
      {/* 顶部标题栏 - 科技感装饰 */}
      {lodLevel === 'near' && <div className="h-6 bg-white/5 flex items-center px-2 justify-between border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 bg-apple-blue rounded-full" />
          <span className="text-[10px] font-mono text-white/80 uppercase tracking-tighter">
            Text_Payload_{id.split('-')[1] || id.slice(-4)}
          </span>
        </div>
        <div className="flex gap-1">
          <div className="w-1 h-1 bg-white/40 rounded-full" />
          <div className="w-1 h-1 bg-white/40 rounded-full" />
        </div>
      </div>}

      {/* 文本输入区 */}
      {lodLevel === 'near' && !isVisualInteractionLocked ? (
        <textarea
          ref={textareaRef}
          className="nodrag nowheel flex-grow bg-transparent text-white text-xs p-3 outline-none resize-none font-mono placeholder:text-white/40 overflow-auto"
          placeholder="ENTER MISSION PROMPT..."
          value={text}
          onChange={handleTextChange}
          onFocus={(e) => e.stopPropagation()}
          onWheel={(e) => {
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
          }}
        />
      ) : useLowEnergyTextView ? (
        <div className={`flex-grow p-3 text-xs font-mono overflow-hidden ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
          <div className="line-clamp-6 whitespace-pre-wrap break-words">{text || 'text'}</div>
        </div>
      ) : (
        <div className={`flex-grow p-3 text-[11px] leading-5 overflow-hidden ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>
          <div className="line-clamp-6 whitespace-pre-wrap break-words">{text || 'text'}</div>
        </div>
      )}

      {/* 右侧输出节点 (绿色圆点) */}
      <div
        onMouseDown={handleAnchorMouseDown}
        className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center cursor-pointer group/anchor z-10"
      >
        <div className="w-2 h-2 bg-green-500 rounded-full border border-black group-hover/anchor:scale-150 group-hover/anchor:shadow-[0_0_10px_#22c55e] transition-all" />
      </div>

      {/* 右下角缩放手柄 */}
      {lodLevel === 'near' && <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize flex items-end justify-end p-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10"
        onMouseDown={(e) => {
          e.stopPropagation();
          const startX = e.clientX;
          const startY = e.clientY;
          const startW = size.w;
          const startH = size.h;

          const onMouseMove = (moveEvent: MouseEvent) => {
            const newSize = {
              w: Math.max(200, startW + (moveEvent.clientX - startX)),
              h: Math.max(120, startH + (moveEvent.clientY - startY)),
            };
            handleSizeChange(newSize);
          };
          const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
          };
          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        }}
      >
        <div className="w-2 h-2 border-r-2 border-b-2 border-white/40" />
      </div>}

      {/* 底部装饰条 - 选中时显示 */}
      {isSelected && (
        <div className="h-1 w-full bg-gradient-to-r from-transparent via-apple-blue/50 to-transparent" />
      )}
      </>
      )}
    </div>
  );
};
