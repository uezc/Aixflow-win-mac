// @ts-nocheck
import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { Handle, Position, NodeProps, useReactFlow, useUpdateNodeInternals, useStoreApi } from 'reactflow';
import { useFrozenFlowViewport, useFrozenFlowZoom } from '../../hooks/useFrozenFlowViewport';
import { Copy, Check, AlignLeft, AlignCenter, AlignRight, Bold, Italic, Bot, Loader2, ZoomIn, ZoomOut, Type } from 'lucide-react';
import { useAI } from '../../hooks/useAI';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { useLlmInputPanelAnchor } from '../../contexts/LlmInputPanelContext';
import { workspaceChromeT } from '../../i18n/workspaceI18n';
import { nodeFloatToolBtn } from '../../utils/assetLibraryChrome';
import type { ScratchColorId } from '../../theme/scratchColors';
import { ModuleProgressBar } from './ModuleProgressBar';
import { scaleModulePx } from '../../utils/moduleDisplayScale';

interface LLMNodeData {
  prompt?: string;
  /** 执行状态（同步到 node.data，反推图像等场景下避免重渲染导致动画丢失） */
  aiStatus?: 'START' | 'PROCESSING' | 'SUCCESS' | 'ERROR';
  /** 进度 0-100（1 表示进行中，用于 ModuleProgressBar 和连接线流光） */
  progress?: number;
  savedPrompts?: Array<{
    id: string;
    name: string;
    content: string;
  }>;
  width?: number;
  height?: number;
  inputText?: string;
  outputText?: string;
  userInput?: string;
  systemPrompt?: string;
  title?: string;
  errorMessage?: string;
  isUserResized?: boolean; // 标记用户是否手动调整过尺寸
  /** 输出文本对齐 */
  textAlign?: 'left' | 'center' | 'right';
  /** 输出文本加粗 */
  fontWeight?: 'normal' | 'bold';
  /** 输出文本斜体 */
  fontStyle?: 'normal' | 'italic';
  /** 输出区字体大小（px），约 10–28 */
  outputFontSizePx?: number;
  /** 普通对话选用的聊天模型 */
  chatModel?: string;
  /** 最近一次生成耗时（秒） */
  lastElapsedSec?: number;
}

interface LLMNodeProps extends NodeProps<LLMNodeData> {
  isDarkMode?: boolean;
  performanceMode?: boolean;
  /** 经 Workspace setNodes 落盘（受控画布） */
  onDataChange?: (updates: Partial<LLMNodeData>) => void;
}

const ZOOM_THRESHOLD_FAR = 0.1;
const ZOOM_THRESHOLD_NEAR = 0.5;

const LLMNodeComponent: React.FC<LLMNodeProps> = (props) => {
  // 解构出 React Flow 专有属性，避免透传给 DOM
  const {
    id,
    data,
    selected,
    isDarkMode = true,
    performanceMode = false,
    onDataChange,
    // React Flow 专有属性，不应传递给 DOM（显式解构以过滤）
    xPos,
    yPos,
    dragging,
    zIndex: _zIndex,
    width: _width,
    height: _height,
    type: _type,
    targetPosition: _targetPosition,
    sourcePosition: _sourcePosition,
    position: _position,
    // 确保不会透传任何其他 React Flow 内部属性
  } = props as any;
  const { setNodes } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const store = useStoreApi();
  // 最小尺寸约束（与 Text 模块相同）
  const MIN_WIDTH = scaleModulePx(280);
  const MIN_HEIGHT = scaleModulePx(160);
  // 默认初始宽度（生成内容后）
  const DEFAULT_WIDTH = scaleModulePx(300);
  
  // 初始化尺寸：用户改过后以 data 为准，避免 props.style 滞后（主题切换/重挂载时回弹）
  const getInitialSize = () => {
    const nodeStyle = (props as any).style;
    let width = data?.width;
    let height = data?.height;

    if (!data?.isUserResized) {
      if (nodeStyle?.width) {
        const styleWidth = parseFloat(String(nodeStyle.width).replace('px', ''));
        if (!isNaN(styleWidth) && styleWidth > 0) {
          width = styleWidth;
        }
      }
      if (nodeStyle?.height) {
        const styleHeight = parseFloat(String(nodeStyle.height).replace('px', ''));
        if (!isNaN(styleHeight) && styleHeight > 0) {
          height = styleHeight;
        }
      }
    }

    return {
      w: Math.max(MIN_WIDTH, width || MIN_WIDTH),
      h: Math.max(MIN_HEIGHT, height || MIN_HEIGHT),
    };
  };
  
  const [size, setSize] = useState(getInitialSize);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  /** 用户缩放已提交、等待 store 落盘；此期间禁止用滞后的 data/style 把尺寸打回旧值 */
  const userSizeCommitRef = useRef<{ w: number; h: number } | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [outputText, setOutputText] = useState(data?.outputText || '');
  const [title, setTitle] = useState(data?.title || 'llm');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingOutput, setIsEditingOutput] = useState(false);
  const [showCopySuccess, setShowCopySuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState(data?.errorMessage || '');
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const genStartAtRef = useRef<number | null>(null);
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>(data?.textAlign ?? 'left');
  const [fontWeight, setFontWeight] = useState<'normal' | 'bold'>(data?.fontWeight ?? 'normal');
  const [fontStyle, setFontStyle] = useState<'normal' | 'italic'>(data?.fontStyle ?? 'normal');
  const clampLlmOutputFontPx = (n: unknown): number => {
    const x = typeof n === 'number' ? n : typeof n === 'string' ? parseFloat(n) : NaN;
    if (!Number.isFinite(x)) return 28;
    return Math.min(28, Math.max(10, Math.round(x)));
  };
  const [outputFontSizePx, setOutputFontSizePx] = useState(() => clampLlmOutputFontPx(data?.outputFontSizePx ?? 28));
  /** IME 输入法组合状态：组合中不立即同步，避免中文输入被截断 */
  const [titleComposing, setTitleComposing] = useState(false);
  const [titleLocal, setTitleLocal] = useState('');
  const [outputComposing, setOutputComposing] = useState(false);
  const [outputLocal, setOutputLocal] = useState('');
  const [isHovered, setIsHovered] = useState(false);
  const viewport = useFrozenFlowViewport();
  /** 交互锁期间冻结 zoom，避免缩放/平移时整节点重渲染 */
  const liveZoom = useFrozenFlowZoom(1);
  const showAlert = useDarkAlert().showAlert;
  const { locale } = useAppLocale();
  const wc = workspaceChromeT(locale);

  const nodeRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const outputTextareaRef = useRef<HTMLTextAreaElement>(null);

  // AI Hook（仅用于接收状态更新）
  const { status: aiStatus } = useAI({
    nodeId: id,
    modelId: 'chat',
    onStatusUpdate: (packet) => {
      if (!packet) return;
      const packetNodeId = String(packet.nodeId || '').trim();
      const currentNodeId = String(id || '').trim();
      
      if (packetNodeId !== currentNodeId) {
        return;
      }
      
      if (packet.status === 'START') {
        setIsTimerRunning(true);
        setElapsedSeconds(0);
        genStartAtRef.current = Date.now();
        updateNodeData({ aiStatus: 'START', progress: 1, errorMessage: undefined });
      } else if (packet.status === 'PROCESSING') {
        updateNodeData({ aiStatus: 'PROCESSING', progress: Math.max(1, (packet.payload as any)?.progress ?? 1) });
      } else if (packet.status === 'SUCCESS' || packet.status === 'ERROR') {
        setIsTimerRunning(false);
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }
      }
      
      // SUCCESS 状态：显示结果（aiStatus/progress 已在上面清除）
      if (packet.status === 'SUCCESS') {
        const text = (packet.payload as any)?.text;
        const elapsed =
          genStartAtRef.current != null
            ? Math.round(((Date.now() - genStartAtRef.current) / 1000) * 10) / 10
            : elapsedSeconds;
        genStartAtRef.current = null;
        if (text && typeof text === 'string' && text.trim()) {
          setOutputText(text);
          setErrorMessage('');
          
          const updateData: Partial<LLMNodeData> = {
            outputText: text,
            errorMessage: undefined,
            aiStatus: undefined,
            progress: 0,
            lastElapsedSec: elapsed,
          };
          
          if (!data?.isUserResized && size.w < DEFAULT_WIDTH) {
            updateData.width = DEFAULT_WIDTH;
            setSize((prev) => ({ ...prev, w: DEFAULT_WIDTH }));
          }
          
          updateNodeData(updateData);
        } else {
          updateNodeData({ aiStatus: undefined, progress: 0, lastElapsedSec: elapsed });
        }
        return;
      }
      
      // ERROR 状态：显示错误信息；余额不足时弹窗提示
      if (packet.status === 'ERROR') {
        genStartAtRef.current = null;
        const errorMsg = packet.payload?.error || '未知错误';
        const balanceInsufficient = (packet.payload as any)?.balanceInsufficient === true;
        setErrorMessage(errorMsg);
        updateNodeData({ 
          errorMessage: errorMsg,
          aiStatus: undefined,
          progress: 0,
        });
        if (balanceInsufficient) {
          showAlert('元宝不足，请联系管理员充值');
        }
        return;
      }
    },
    onComplete: (result) => {
      if (result?.text && typeof result.text === 'string' && result.text.trim()) {
        setOutputText(result.text);
        setErrorMessage('');
        const elapsed =
          genStartAtRef.current != null
            ? Math.round(((Date.now() - genStartAtRef.current) / 1000) * 10) / 10
            : elapsedSeconds;
        genStartAtRef.current = null;
        setIsTimerRunning(false);
        
        const updateData: Partial<LLMNodeData> = {
          outputText: result.text,
          errorMessage: undefined,
          aiStatus: undefined,
          progress: 0,
          lastElapsedSec: elapsed,
        };
        
        if (!data?.isUserResized && size.w < DEFAULT_WIDTH) {
          updateData.width = DEFAULT_WIDTH;
          setSize((prev) => ({ ...prev, w: DEFAULT_WIDTH }));
        }
        
        updateNodeData(updateData);
      }
    },
    onError: (error) => {
      genStartAtRef.current = null;
      setIsTimerRunning(false);
      const msg =
        typeof error === 'string'
          ? error
          : error && typeof error === 'object' && 'error' in error
            ? String((error as { error?: string }).error || '')
            : '';
      const display = msg.trim() || '生成失败';
      setErrorMessage(display);
      updateNodeData({
        errorMessage: display,
        aiStatus: undefined,
        progress: 0,
      });
    },
  });

  // 判断是否正在处理中（aiStatus、data.aiStatus、isTimerRunning 任一为真即显示生成中，避免重渲染导致动画丢失）
  const isProcessing = aiStatus === 'START' || aiStatus === 'PROCESSING';
  const dataExecuting = data?.aiStatus === 'START' || data?.aiStatus === 'PROCESSING' || (typeof data?.progress === 'number' && data.progress > 0 && data.progress < 100);
  const showTimer = isTimerRunning || isProcessing || dataExecuting;

  // 计时器：生成中按 100ms 刷新已用时间（展示一位小数）
  useEffect(() => {
    if (!showTimer) return;
    if (genStartAtRef.current == null) genStartAtRef.current = Date.now();
    setElapsedSeconds(0);
    timerIntervalRef.current = setInterval(() => {
      const start = genStartAtRef.current ?? Date.now();
      setElapsedSeconds(Math.round(((Date.now() - start) / 1000) * 10) / 10);
    }, 100);
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [showTimer]);

  const displayTitle = useMemo(() => {
    const raw = (title || '').trim();
    if (!raw || raw.toLowerCase() === 'llm') return wc.llmTextCardTitle;
    return raw;
  }, [title, wc.llmTextCardTitle]);

  const displayElapsedSec = showTimer
    ? elapsedSeconds
    : typeof data?.lastElapsedSec === 'number' && data.lastElapsedSec > 0
      ? data.lastElapsedSec
      : null;

  // 同步外部数据变化
  // 注意：编辑模式时不应该改变尺寸，且编辑 output 时不同步 outputText（避免接入 text/llm 时 inputText 同步触发重渲染覆盖用户正在编辑的内容）
  useEffect(() => {
    // 如果正在编辑输出，不覆盖 outputText（上游 inputText 同步会触发重渲染，若同步 outputText 会覆盖用户编辑）
    if (isEditingOutput) {
      // 仅同步 errorMessage（生成失败等），不同步 outputText
      if (data?.errorMessage !== undefined) {
        setErrorMessage(data.errorMessage);
      }
      return;
    }
    // 如果正在编辑标题，不更新 outputText，只更新标题和 errorMessage
    if (isEditingTitle) {
      if (data?.title !== undefined) {
        setTitle(data.title);
      }
      if (data?.errorMessage !== undefined) {
        setErrorMessage(data.errorMessage);
      }
      return;
    }

    if (data?.outputText !== undefined) {
      setOutputText(data.outputText);
    }
    if (data?.title !== undefined) {
      setTitle(data.title);
    }
    if (data?.errorMessage !== undefined) {
      setErrorMessage(data.errorMessage);
    }
    if (data?.textAlign !== undefined) setTextAlign(data.textAlign);
    if (data?.fontWeight !== undefined) setFontWeight(data.fontWeight);
    if (data?.fontStyle !== undefined) setFontStyle(data.fontStyle);
    if (data?.outputFontSizePx !== undefined) setOutputFontSizePx(clampLlmOutputFontPx(data.outputFontSizePx));
  }, [data?.outputText, data?.title, data?.errorMessage, data?.textAlign, data?.fontWeight, data?.fontStyle, data?.outputFontSizePx, isEditingOutput, isEditingTitle]);

  // 双击进入编辑模式（不依赖 isVisualInteractionLocked，确保生成后始终可编辑）
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // 双击输出区域进入编辑模式
    setIsEditingOutput(true);
  }, []);

  // 双击输出文本进入编辑模式
  const handleOutputDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditingOutput(true);
    setTimeout(() => outputTextareaRef.current?.focus(), 0);
  }, []);

  // 双击标题进入编辑模式
  const handleTitleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  }, []);

  // 更新节点数据
  // 注意：编辑模式时不应该改变尺寸
  const updateNodeData = useCallback((updates: Partial<LLMNodeData>, preserveSize = true) => {
    if (onDataChange) {
      onDataChange(updates);
      return;
    }
    // 如果正在编辑，强制 preserveSize = true，确保不改变尺寸
    const shouldPreserveSize = preserveSize || isEditingOutput || isEditingTitle;
    
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          const updatedNode = {
            ...node,
            data: {
              ...node.data,
              ...updates,
            },
          };
          
          // 如果更新了 width 或 height，同时更新节点的 style 属性
          // preserveSize 为 true 时，如果只更新 outputText 等非尺寸字段，不改变尺寸
          if (updates.width !== undefined || updates.height !== undefined) {
            const w = updates.width !== undefined ? updates.width : sizeRef.current.w;
            const h = updates.height !== undefined ? updates.height : sizeRef.current.h;
            updatedNode.style = {
              ...(node.style || {}),
              width: `${w}px`,
              height: `${h}px`,
              minWidth: '280px',
              minHeight: '160px',
            };
          } else {
            // 无论 preserveSize 是否为 true，只要没有更新 width/height，就完全保持原有 style
            // 这样可以确保编辑模式下尺寸不会改变
            if (node.style) {
              updatedNode.style = { ...node.style };
            } else {
              updatedNode.style = {
                width: `${sizeRef.current.w}px`,
                height: `${sizeRef.current.h}px`,
                minWidth: '280px',
                minHeight: '160px',
              };
            }
          }
          
          return updatedNode;
        }
        return node;
      })
    );
  }, [id, onDataChange, setNodes, isEditingOutput, isEditingTitle]);

  const applyFormat = useCallback((key: 'textAlign' | 'fontWeight' | 'fontStyle', value: 'left' | 'center' | 'right' | 'normal' | 'bold' | 'italic') => {
    if (key === 'textAlign') {
      setTextAlign(value as 'left' | 'center' | 'right');
      updateNodeData({ textAlign: value as 'left' | 'center' | 'right' }, true);
    } else if (key === 'fontWeight') {
      const v = value as 'normal' | 'bold';
      setFontWeight(v);
      updateNodeData({ fontWeight: v }, true);
    } else if (key === 'fontStyle') {
      const v = value as 'normal' | 'italic';
      setFontStyle(v);
      updateNodeData({ fontStyle: v }, true);
    }
  }, [updateNodeData]);

  const adjustOutputFontSize = useCallback(
    (delta: number) => {
      setOutputFontSizePx((prev) => {
        const next = clampLlmOutputFontPx(prev + delta);
        if (next !== prev) updateNodeData({ outputFontSizePx: next }, true);
        return next;
      });
    },
    [updateNodeData],
  );

  // 点击非编辑区域退出编辑模式
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      // 检查是否点击在节点外部
      if (isEditingOutput && nodeRef.current && !nodeRef.current.contains(target)) {
        // 确保不是点击在 textarea 内部
        if (!outputTextareaRef.current?.contains(target)) {
          setIsEditingOutput(false);
          // 保存文本更改
          if (data?.outputText !== outputText) {
            updateNodeData({ outputText }, true);
          }
        }
      }
      if (isEditingTitle && nodeRef.current && !nodeRef.current.contains(target)) {
        // 确保不是点击在 title input 内部
        if (!titleInputRef.current?.contains(target)) {
          setIsEditingTitle(false);
          // 保存标题更改
          if (data?.title !== title) {
            updateNodeData({ title });
          }
        }
      }
    };

    if (isEditingOutput || isEditingTitle) {
      // 使用捕获阶段，确保在其他事件之前处理
      document.addEventListener('mousedown', handleClickOutside, true);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside, true);
      };
    }
  }, [isEditingOutput, isEditingTitle, outputText, title, data?.outputText, data?.title, updateNodeData]);

  // 处理尺寸变化（用户手动调整）
  // 注意：编辑模式时不应该改变尺寸
  const handleSizeChange = useCallback((newSize: { w: number; h: number }) => {
    if (isEditingOutput || isEditingTitle) {
      return;
    }
    userSizeCommitRef.current = newSize;
    sizeRef.current = newSize;
    setSize(newSize);
    updateNodeData({
      width: newSize.w,
      height: newSize.h,
      isUserResized: true,
      _isResizing: false,
    } as Partial<LLMNodeData>, false);
  }, [updateNodeData, isEditingOutput, isEditingTitle]);

  // 从 store 同步尺寸（加载/外部更新）；缩放与主题切换时不回退本地已放大尺寸
  useEffect(() => {
    if (isResizing || isEditingOutput || isEditingTitle) return;

    const pending = userSizeCommitRef.current;
    if (pending) {
      const dw = typeof data?.width === 'number' ? data.width : null;
      const dh = typeof data?.height === 'number' ? data.height : null;
      if (
        data?.isUserResized &&
        dw != null &&
        dh != null &&
        Math.abs(dw - pending.w) < 0.5 &&
        Math.abs(dh - pending.h) < 0.5
      ) {
        userSizeCommitRef.current = null;
      }
      return;
    }

    const dw = typeof data?.width === 'number' && data.width > 0 ? data.width : null;
    const dh = typeof data?.height === 'number' && data.height > 0 ? data.height : null;
    if (dw == null || dh == null) return;

    const local = sizeRef.current;
    if (Math.abs(local.w - dw) < 0.1 && Math.abs(local.h - dh) < 0.1) return;

    if (
      data?.isUserResized ||
      local.w > dw + 0.5 ||
      local.h > dh + 0.5
    ) {
      updateNodeData({
        width: local.w,
        height: local.h,
        isUserResized: true,
        _isResizing: false,
      } as Partial<LLMNodeData>, false);
      return;
    }

    const next = { w: dw, h: dh };
    sizeRef.current = next;
    setSize(next);
  }, [isResizing, isEditingOutput, isEditingTitle, data?.width, data?.height, data?.isUserResized, updateNodeData]);

  useEffect(() => {
    userSizeCommitRef.current = null;
  }, [id]);

  // 复制输出文本（必须在 early return 之前调用，遵守 hooks 规则）
  const handleCopyOutput = useCallback(async () => {
    if (outputText) {
      try {
        await navigator.clipboard.writeText(outputText);
        setShowCopySuccess(true);
        setTimeout(() => setShowCopySuccess(false), 2000);
      } catch (err) {
        console.error('复制失败:', err);
      }
    }
  }, [outputText]);

  const zoom = liveZoom || viewport.zoom || 1;
  const vx = viewport.x ?? 0;
  const vy = viewport.y ?? 0;
  const lodLevel = useMemo<'far' | 'mid' | 'near'>(() => {
    if (zoom < ZOOM_THRESHOLD_FAR) return 'far';
    if (zoom < ZOOM_THRESHOLD_NEAR) return 'mid';
    return 'near';
  }, [zoom]);
  const showDetailedUi = lodLevel === 'near';
  const isHardFrozen = useMemo(() => {
    if (!performanceMode || selected || dragging || isResizing) return false;
    const nodeX = Number(xPos ?? 0);
    const nodeY = Number(yPos ?? 0);
    const viewportLeft = -vx / zoom;
    const viewportTop = -vy / zoom;
    const viewportWidth = (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom;
    const viewportHeight = (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom;
    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const nodeRight = nodeX + size.w;
    const nodeBottom = nodeY + size.h;
    const intersects = !(nodeRight < viewportLeft || nodeX > viewportRight || nodeBottom < viewportTop || nodeY > viewportBottom);
    if (intersects) return false;
    const distX = nodeRight < viewportLeft ? (viewportLeft - nodeRight) : (nodeX > viewportRight ? nodeX - viewportRight : 0);
    const distY = nodeBottom < viewportTop ? (viewportTop - nodeBottom) : (nodeY > viewportBottom ? nodeY - viewportBottom : 0);
    return distX > viewportWidth * 2 || distY > viewportHeight * 2;
  }, [performanceMode, selected, dragging, isResizing, xPos, yPos, vx, vy, zoom, size.w, size.h]);
  const showPlaceholder = isResizing || isHardFrozen || lodLevel === 'far';
  const showFloatingToolbar = (selected || isHovered) && !errorMessage;
  const floatToolBtn = (scratch: ScratchColorId, active: boolean, extra = '') =>
    nodeFloatToolBtn(isDarkMode, active, extra, scratch);
  const llmPromptAnchor = useLlmInputPanelAnchor();
  const showLlmPromptPanel = !!llmPromptAnchor && llmPromptAnchor.nodeId === id && selected;
  /** 镜头拉远随画布缩小；拉近反缩放，避免操作栏撑满屏幕 */
  const zoomInv = Math.min(1, 1 / Math.max(zoom, 0.01));

  return (
    <>
      <div
        ref={nodeRef}
        data-id={id}
        style={{
          width: size.w,
          height: size.h,
          minWidth: '280px',
          minHeight: '160px',
          userSelect: isResizing ? 'none' : 'auto',
          willChange: isResizing ? 'transform, width, height' : dragging ? 'transform' : 'auto',
          backfaceVisibility: isResizing ? 'hidden' : 'visible',
          transition: isResizing ? 'none' : 'background-color 0.2s, border-color 0.2s',
          overflow: 'visible', // 使左上角小标题 / 下方输入条可见；内容区由内部 overflow 控制
          boxSizing: 'border-box', // 确保边框包含在尺寸内
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`custom-node-container group relative rounded-2xl p-4 overflow-visible flex flex-col ${
          isDarkMode
            ? 'nexflow-glass-panel'
            : 'apple-panel-light' /* 使用磨砂材质浅灰半透明背板 */
        } ${
          selected && !isResizing
            ? isDarkMode
              ? 'ring-2 ring-green-400/80'
              : 'ring-2 ring-green-500'
            : isDarkMode
              ? ''
              : ''
        } ${isResizing ? '!shadow-none !ring-0' : ''} ${(isProcessing || dataExecuting) ? 'pointer-events-none' : ''}`}
        onDoubleClick={handleDoubleClick}
      >
        {/* Loading 遮罩：运行中时显示，屏蔽二次点击并展示加载状态 */}
        {(isProcessing || dataExecuting) && (
          <div className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-black/40 backdrop-blur-[2px]">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-8 h-8 text-green-400 animate-spin" />
              <span className="text-xs text-white/80">{wc.llmGenerating}</span>
            </div>
          </div>
        )}
        {/* Handle 必须始终渲染，否则连线会断 */}
        <Handle type="target" position={Position.Left} id="input" className={`nexflow-plus-handle nexflow-plus-handle-left ${showPlaceholder ? 'opacity-0 pointer-events-none' : ''}`} />
        <Handle type="source" position={Position.Right} id="output" className={`nexflow-plus-handle nexflow-plus-handle-right ${showPlaceholder ? 'opacity-0 pointer-events-none' : ''}`} />
        {showPlaceholder ? (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center justify-center gap-1">
              <Bot className={`w-4 h-4 ${isDarkMode ? 'text-white/65' : 'text-gray-500'}`} />
              <span className={`text-[10px] font-medium ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>
                {isHardFrozen ? `${displayTitle}（冻结）` : displayTitle}
              </span>
            </div>
          </div>
        ) : (
        <>
        {/* 左上角标题区域（在文本框外部，节点边框外）+ 右侧耗时 */}
        {showDetailedUi && <div className="title-area absolute -top-7 left-0 right-0 z-10 flex items-center justify-between gap-2 pointer-events-none">
          <div className="flex items-center gap-1 min-w-0 pointer-events-auto">
            <Type className={`w-3 h-3 shrink-0 ${isDarkMode ? 'text-white/55' : 'text-gray-500'}`} strokeWidth={2.25} />
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              type="text"
              value={titleComposing ? titleLocal : title}
              onCompositionStart={(e) => {
                setTitleComposing(true);
                setTitleLocal(e.target.value);
              }}
              onCompositionEnd={(e) => {
                setTitleComposing(false);
                setTitle(e.target.value);
              }}
              onChange={(e) => {
                const v = e.target.value;
                if (titleComposing) {
                  setTitleLocal(v);
                } else {
                  setTitle(v);
                }
              }}
              onBlur={() => {
                setIsEditingTitle(false);
                if (data?.title !== title) {
                  updateNodeData({ title });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  setIsEditingTitle(false);
                  if (data?.title !== title) {
                    updateNodeData({ title });
                  }
                }
                if (e.key === 'Escape') {
                  setIsEditingTitle(false);
                  setTitle(data?.title || 'llm');
                }
              }}
              className={`bg-transparent outline-none font-bold text-xs ${
                isDarkMode ? 'text-white/80' : 'text-gray-900'
              }`}
              style={{ 
                caretColor: isDarkMode ? '#0A84FF' : '#22c55e',
                minWidth: '40px',
                maxWidth: '120px',
              }}
              title="编辑标题"
              autoFocus
            />
          ) : (
            <span
              onClick={handleTitleDoubleClick}
              className={`font-bold text-xs cursor-pointer select-none truncate ${
              isDarkMode ? 'text-white/80' : 'text-gray-900'
            } hover:opacity-70 transition-opacity`}
            >
              {displayTitle}
            </span>
          )}
          </div>
          {displayElapsedSec != null && (
            <span
              className={`shrink-0 text-[10px] font-medium tabular-nums pointer-events-none ${
                isDarkMode ? 'text-white/45' : 'text-gray-500'
              }`}
            >
              {wc.llmElapsedLabel(displayElapsedSec)}
            </span>
          )}
        </div>}

        {/* 全模块覆盖进度条（生成中时纯色遮罩，不显示其他内容） */}
        <ModuleProgressBar
          visible={showTimer}
          progress={data?.progress ?? 0}
          solidBackground={isDarkMode ? '#1C1C1E' : '#f5f5f5'}
          progressMessage="正在生成..."
          borderRadius={16}
          onFadeComplete={() => updateNodeData({ progress: 0 })}
        />

        {/* 复制改入悬浮工具条，卡片内不再单独放右上角按钮 */}

             {/* 文本内容显示区域（与文本模块样式一致，支持双击编辑） */}
             <div 
               className={`drag-handle-area w-full h-full flex overflow-auto p-2 relative flex-1 min-h-0 ${
                 isDarkMode ? 'custom-scrollbar-dark' : 'custom-scrollbar'
               } ${
                 isEditingOutput ? '' : 'items-start justify-start'
               }`}
               onDoubleClick={handleDoubleClick}
             >
               {errorMessage ? (
                 // 显示错误信息
                 <div className="flex flex-col items-center justify-center gap-3 p-4">
                   <div className={`text-2xl ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
                     ⚠️
                   </div>
                   <p className={`text-sm font-semibold text-center ${isDarkMode ? 'text-red-300' : 'text-red-700'}`}>
                     生成失败
                   </p>
                   <p className={`text-xs text-center line-clamp-3 ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`}>
                     {errorMessage}
                   </p>
                 </div>
               ) : showTimer ? (
                 // 生成中状态：由 ModuleProgressBar 全模块遮罩展示进度条动画，此处仅保留占位文案
                 <p className={`text-xs text-center ${isDarkMode ? 'text-white/40' : 'text-gray-500'}`}>
                   等待生成…
                 </p>
               ) : isEditingOutput ? (
                 <textarea
                   ref={outputTextareaRef}
                   value={outputComposing ? outputLocal : (outputText || '')}
                   onCompositionStart={(e) => {
                     setOutputComposing(true);
                     setOutputLocal(e.target.value);
                   }}
                   onCompositionEnd={(e) => {
                     setOutputComposing(false);
                     setOutputText(e.target.value);
                   }}
                   onChange={(e) => {
                     const v = e.target.value;
                     if (outputComposing) {
                       setOutputLocal(v);
                     } else {
                       setOutputText(v);
                     }
                   }}
                   onBlur={() => {
                     setIsEditingOutput(false);
                     // 只更新 outputText，不改变尺寸（preserveSize = true）
                     updateNodeData({ outputText }, true);
                   }}
                   onKeyDown={(e) => {
                     if (e.key === 'Escape') {
                       setIsEditingOutput(false);
                       setOutputText(data?.outputText || '');
                     }
                   }}
                   onMouseDown={(e) => {
                     // 阻止事件冒泡，防止触发外部点击处理
                     e.stopPropagation();
                   }}
                   onClick={(e) => {
                     // 阻止事件冒泡，防止触发外部点击处理
                     e.stopPropagation();
                   }}
                   className={`nodrag w-full h-full bg-transparent resize-none outline-none break-words whitespace-pre-wrap overflow-auto ${
                     isDarkMode ? 'custom-scrollbar-dark' : 'custom-scrollbar'
                   } ${
                     textAlign === 'left' ? 'text-left' : textAlign === 'right' ? 'text-right' : 'text-center'
                   } ${fontWeight === 'bold' ? 'font-bold' : ''} ${fontStyle === 'italic' ? 'italic' : ''} ${
                     isDarkMode ? 'text-white/80 placeholder:text-white/40' : 'text-gray-900 placeholder:text-gray-500'
                   }`}
                   style={{
                     caretColor: isDarkMode ? '#0A84FF' : '#22c55e',
                     fontSize: outputFontSizePx,
                     lineHeight: 1.55,
                     wordBreak: 'break-word',
                     overflowWrap: 'break-word',
                     height: '100%',
                   }}
                   title={wc.editOutputCancelEscapeTitle}
                   placeholder={wc.doubleClickEditText}
                   autoFocus
                 />
               ) : (
                 <p 
                   className={`break-words whitespace-pre-wrap w-full ${
                     textAlign === 'left' ? 'text-left' : textAlign === 'right' ? 'text-right' : 'text-center'
                   } ${fontWeight === 'bold' ? 'font-bold' : ''} ${fontStyle === 'italic' ? 'italic' : ''} ${
                     outputText
                       ? (isDarkMode ? 'text-white/80' : 'text-gray-900')
                       : (isDarkMode ? 'text-white/40' : 'text-gray-500')
                   }`} 
                   style={{
                     fontSize: outputFontSizePx,
                     lineHeight: 1.55,
                     maxWidth: '100%',
                     wordBreak: 'break-word',
                     overflowWrap: 'break-word',
                     cursor: 'text',
                   }}
                   onDoubleClick={handleOutputDoubleClick}
                 >
                   {outputText || wc.llmEmptyHint}
                 </p>
               )}
             </div>

        {/* 右下角框外圆弧角缩放手柄 */}
        <div
          ref={resizeHandleRef}
          className="nodrag absolute -bottom-2 -right-2 w-6 h-6 cursor-nwse-resize flex items-center justify-center opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity z-[9999]"
          style={{ pointerEvents: 'all' }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
            
            setIsResizing(true);
            
            // 标记节点正在调整大小，阻止拖动
            updateNodeData({ _isResizing: true } as any);
            
            // 在 body 上设置 cursor 样式（使用 !important 防止鼠标移动过快时样式闪烁）
            const originalCursor = document.body.style.cursor;
            document.body.style.setProperty('cursor', 'nwse-resize', 'important');
            
            const startX = e.clientX;
            const startY = e.clientY;
            const startW = size.w;
            const startH = size.h;
            
            // 使用 requestAnimationFrame 优化 updateNodeInternals 调用
            let rafId: number | null = null;
            const scheduleUpdate = () => {
              if (rafId === null) {
                rafId = requestAnimationFrame(() => {
                  // Tapnow 秘密：在修改 DOM 后立即执行更新，确保连线实时同步
                  updateNodeInternals(id);
                  rafId = null;
                });
              }
            };

            const onMouseMove = (moveEvent: MouseEvent) => {
              moveEvent.preventDefault();
              moveEvent.stopPropagation();
              
              // 获取当前缩放比例（可能在缩放过程中变化）
              // 使用 useStoreApi().getState().transform[2] 获取精确的 zoom 值
              const currentZoom = store.getState().transform[2] || 1;
              
              // 将鼠标移动距离除以缩放比例，转换为画布坐标
              // 确保鼠标指针永远死死地扣住节点边缘
              const deltaX = (moveEvent.clientX - startX) / currentZoom;
              const deltaY = (moveEvent.clientY - startY) / currentZoom;
              
            // 计算新尺寸（最小尺寸约束：280px * 160px）
            const newW = Math.max(280, startW + deltaX);
            const newH = Math.max(160, startH + deltaY);
              
              // 直接操作 DOM，不触发 React 状态更新（非受控样式操作）
              // 禁用 transition 确保零延迟响应
              if (nodeRef.current) {
                nodeRef.current.style.transition = 'none';
                nodeRef.current.style.width = `${newW}px`;
                nodeRef.current.style.height = `${newH}px`;
              }
              
              // Tapnow 秘密：在修改 DOM 后立即调度 updateNodeInternals，确保连线实时同步
              scheduleUpdate();
            };
            
            const onMouseUp = (upEvent: MouseEvent) => {
              const finalSize = {
                w: nodeRef.current ? parseFloat(nodeRef.current.style.width) || sizeRef.current.w : sizeRef.current.w,
                h: nodeRef.current ? parseFloat(nodeRef.current.style.height) || sizeRef.current.h : sizeRef.current.h,
              };

              handleSizeChange(finalSize);
              setIsResizing(false);

              // 恢复 body cursor
              document.body.style.cursor = originalCursor;
              
              // 恢复 transition（仅在非缩放时生效）
              if (nodeRef.current) {
                nodeRef.current.style.transition = '';
              }
              
              // 取消待处理的 requestAnimationFrame
              if (rafId !== null) {
                cancelAnimationFrame(rafId);
                rafId = null;
              }
              
              // 获取最终尺寸（从 DOM 读取）已在上方处理

              // 强制刷新节点连接线位置（最终更新）
              updateNodeInternals(id);
              
              document.removeEventListener('mousemove', onMouseMove);
              document.removeEventListener('mouseup', onMouseUp);
              upEvent.preventDefault();
              upEvent.stopPropagation();
            };
            
            document.addEventListener('mousemove', onMouseMove, { passive: false });
            document.addEventListener('mouseup', onMouseUp, { passive: false });
          }}
          onClick={(e) => {
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
          }}
          onDragStart={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <div className={`w-4 h-4 rounded-br-2xl border-r-2 border-b-2 ${
            isDarkMode ? 'border-white/40' : 'border-gray-400/60'
          }`} />
        </div>
        </>
        )}

      {/* 工具条置于模块上方（对齐 AI Canvas），避免与下方输入条重叠 */}
      {showFloatingToolbar && (
        <div
          className="node-floating-toolbar nodrag nopan absolute bottom-[calc(100%+36px)] left-1/2 z-20 flex w-max max-w-[min(520px,calc(100vw-2rem))] flex-wrap items-center justify-center gap-1.5 overflow-visible"
          style={{
            pointerEvents: 'all',
            transform: `translateX(-50%) scale(${zoomInv})`,
            transformOrigin: 'bottom center',
            transition: 'none',
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={handleCopyOutput}
            disabled={!outputText}
            className={floatToolBtn('motion', showCopySuccess, !outputText ? '!opacity-40' : '')}
            title={showCopySuccess ? wc.llmCopiedTitle : wc.llmCopyTitle}
          >
            {showCopySuccess ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => applyFormat('textAlign', 'left')}
            className={floatToolBtn('looks', textAlign === 'left')}
            title="左对齐"
          >
            <AlignLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => applyFormat('textAlign', 'center')}
            className={floatToolBtn('sensing', textAlign === 'center')}
            title="居中"
          >
            <AlignCenter className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => applyFormat('textAlign', 'right')}
            className={floatToolBtn('control', textAlign === 'right')}
            title="右对齐"
          >
            <AlignRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => applyFormat('fontWeight', fontWeight === 'bold' ? 'normal' : 'bold')}
            className={floatToolBtn('events', fontWeight === 'bold')}
            title="加粗"
          >
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => applyFormat('fontStyle', fontStyle === 'italic' ? 'normal' : 'italic')}
            className={floatToolBtn('variables', fontStyle === 'italic')}
            title="斜体"
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => adjustOutputFontSize(-2)}
            disabled={outputFontSizePx <= 10}
            className={floatToolBtn('operators', false, outputFontSizePx <= 10 ? '!opacity-40' : '')}
            title={wc.fontZoomOutTitle}
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => adjustOutputFontSize(2)}
            disabled={outputFontSizePx >= 28}
            className={floatToolBtn('myBlocks', false, outputFontSizePx >= 28 ? '!opacity-40' : '')}
            title={wc.fontZoomInTitle}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 对齐 AI Canvas `.text-prompt-panel`：挂在模块正下方，随节点平移/缩放 */}
      {showLlmPromptPanel && llmPromptAnchor && (
        <div
          className="llm-text-prompt-panel nodrag nopan absolute z-[60]"
          style={{
            top: 'calc(100% + 14px)',
            left: '50%',
            width: llmPromptAnchor.width,
            height: llmPromptAnchor.height === 'auto' ? 'auto' : llmPromptAnchor.height,
            transform: `translateX(-50%) scale(${zoomInv})`,
            transformOrigin: 'top center',
            pointerEvents: 'auto',
            transition: 'none',
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          {llmPromptAnchor.panel}
        </div>
      )}
      </div>
    </>
  );
};

export const LLMNode = memo(LLMNodeComponent);
LLMNode.displayName = 'LLMNode';
