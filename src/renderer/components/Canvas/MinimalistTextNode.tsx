// @ts-nocheck
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Handle, Position, NodeProps, useReactFlow, useStore, useUpdateNodeInternals, useStoreApi } from 'reactflow';
import {
  Copy,
  Check,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Bold,
  Italic,
  ZoomIn,
  ZoomOut,
  Loader2,
  Headphones,
} from 'lucide-react';
import { ModuleProgressBar } from './ModuleProgressBar';
import { useAI } from '../../hooks/useAI';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import { workspaceChromeT } from '../../i18n/workspaceI18n';
import { audioInputPanelT } from '../../i18n/audioInputPanelI18n';
import { useCloudRealtimeDictation } from '../../hooks/useCloudRealtimeDictation';
import { useDictationPushToTalk } from '../../hooks/useDictationPushToTalk';
import { micLevelCssVars } from '../../utils/micInputLevel';
import { acquireVoiceModalLock, releaseVoiceModalLock } from '../../utils/voiceModalGate';
import { nodeFloatToolBtn } from '../../utils/assetLibraryChrome';
import { scratchTintClass, type ScratchColorId } from '../../theme/scratchColors';
import { scaleModulePx, clampTextModuleSize, TEXT_MODULE_MAX_W, TEXT_MODULE_MAX_H } from '../../utils/moduleDisplayScale';
import VoiceMicGlyph from './VoiceMicGlyph';

/** 悬停正文时滚轮翻文字，不缩放画布（React 合成 onWheel 拦不住 React Flow 的原生监听） */
function bindWheelToElementScroll(el: HTMLElement | null): () => void {
  if (!el) return () => {};
  const onWheel = (e: WheelEvent) => {
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    const line = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
    const dy = e.deltaY * line;
    const dx = e.deltaX * line;
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    if (maxTop > 0) el.scrollTop = Math.max(0, Math.min(maxTop, el.scrollTop + dy));
    if (maxLeft > 0) el.scrollLeft = Math.max(0, Math.min(maxLeft, el.scrollLeft + dx));
    e.preventDefault();
  };
  el.addEventListener('wheel', onWheel, { passive: false, capture: true });
  return () => el.removeEventListener('wheel', onWheel, { capture: true });
}

/** 10 个常用字体选项 */
const TEXT_FONT_OPTIONS: { value: string; label: string }[] = [
  { value: 'Microsoft YaHei', label: '微软雅黑' },
  { value: 'PingFang SC', label: '苹方' },
  { value: 'Noto Sans SC', label: '思源黑体' },
  { value: 'SimSun', label: '宋体' },
  { value: 'SimHei', label: '黑体' },
  { value: 'KaiTi', label: '楷体' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Helvetica', label: 'Helvetica' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Times New Roman', label: 'Times New Roman' },
];

interface MinimalistTextNodeData {
  text?: string;
  width?: number;
  height?: number;
  title?: string;
  isUserResized?: boolean;
  progress?: number;
  progressMessage?: string;
  errorMessage?: string;
  /** 文本对齐 */
  textAlign?: 'left' | 'center' | 'right';
  /** 加粗 */
  fontWeight?: 'normal' | 'bold';
  /** 斜体 */
  fontStyle?: 'normal' | 'italic';
  /** 字体 */
  fontFamily?: string;
  /** 正文字体大小（px），约 10–28 */
  fontSizePx?: number;
  /** 左侧接入声音/视频时，用于云端转写的音源 URL */
  transcribeAudioUrl?: string;
  transcribeLanguage?: string;
  transcribeStatus?: 'idle' | 'START' | 'PROCESSING' | 'SUCCESS' | 'ERROR';
  transcribeErrorMessage?: string;
}


interface MinimalistTextNodeProps extends NodeProps<MinimalistTextNodeData> {
  isDarkMode?: boolean;
  performanceMode?: boolean;
  projectId?: string;
  /** 经 Workspace setNodes 落盘（受控画布）；勿仅用 useReactFlow().setNodes */
  onDataChange?: (updates: Partial<MinimalistTextNodeData>) => void;
}

function pickTwAudioUrl(srcData: Record<string, unknown> | undefined): string {
  if (!srcData) return '';
  const raw = (srcData.outputAudio ?? srcData.originalAudioUrl ?? srcData.referenceAudioUrl) as string | undefined;
  return typeof raw === 'string' ? raw.trim() : '';
}

function pickTwVideoUrl(srcData: Record<string, unknown> | undefined): string {
  if (!srcData) return '';
  const raw = (srcData.outputVideo ?? srcData.originalVideoUrl) as string | undefined;
  return typeof raw === 'string' ? raw.trim() : '';
}

export const MinimalistTextNode: React.FC<MinimalistTextNodeProps> = (props) => {
  // 解构出 React Flow 专有属性，避免透传给 DOM
  const {
    id,
    data,
    selected,
    isDarkMode = true,
    performanceMode = false,
    projectId,
    onDataChange,
    // React Flow 专有属性，不应传递给 DOM（显式解构以过滤）
    xPos = 0,
    yPos = 0,
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
  const { setNodes, getViewport } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const store = useStoreApi();
  const edges = useStore((s) => s.edges) ?? [];
  const nodes = useStore((s) => s.nodes) ?? [];
  const { locale } = useAppLocale();
  const wc = workspaceChromeT(locale);
  const { showAlert } = useDarkAlert();
  const refMicAt = audioInputPanelT(locale);
  // 订阅画布 transform，用于超远节点冻结判定
  const transform = useStore((state) => state.transform);
  // 直接从 store 订阅选中状态，确保选中变化时立即重渲染（不依赖父级 memo 传递，解决缩放后才显示控件的问题）
  const selectedFromStore = useStore((state) => state.nodeInternals.get(id)?.selected ?? false);
  const isSelected = selectedFromStore || selected;
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [text, setText] = useState(data?.text || '');
  const [title, setTitle] = useState(data?.title || 'text');
  const [progress, setProgress] = useState(data?.progress || 0);
  const [progressMessage, setProgressMessage] = useState(data?.progressMessage || '');
  const [errorMessage, setErrorMessage] = useState(data?.errorMessage || '');
  const [linkingTw, setLinkingTw] = useState(false);
  const [transcribeBusy, setTranscribeBusy] = useState(false);
  const textRef = useRef(text);
  textRef.current = text;
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>(data?.textAlign || 'center');
  const [fontWeight, setFontWeight] = useState<'normal' | 'bold'>(data?.fontWeight || 'normal');
  const [fontStyle, setFontStyle] = useState<'normal' | 'italic'>(data?.fontStyle || 'normal');
  const [fontFamily, setFontFamily] = useState(data?.fontFamily || TEXT_FONT_OPTIONS[0].value);
  const TEXT_FONT_DEFAULT = 14;
  const clampTextFontPx = (n: unknown): number => {
    const x = typeof n === 'number' ? n : typeof n === 'string' ? parseFloat(n) : NaN;
    if (!Number.isFinite(x)) return TEXT_FONT_DEFAULT;
    return Math.min(28, Math.max(10, Math.round(x)));
  };
  const [fontSizePx, setFontSizePx] = useState(() => clampTextFontPx(data?.fontSizePx ?? TEXT_FONT_DEFAULT));
  // 最小尺寸约束（与 TextNode 相同）
  const MIN_WIDTH = scaleModulePx(280);
  const MIN_HEIGHT = scaleModulePx(160);
  
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

    const c = clampTextModuleSize(width || MIN_WIDTH, height || MIN_HEIGHT);
    return { w: c.width, h: c.height };
  };
  
  const [size, setSize] = useState(getInitialSize);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  /** 用户缩放已提交、等待 store 落盘；此期间禁止用滞后的 data/style 把尺寸打回旧值 */
  const userSizeCommitRef = useRef<{ w: number; h: number } | null>(null);
  const [showCopySuccess, setShowCopySuccess] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textViewRef = useRef<HTMLDivElement>(null);
  /** 预览↔编辑切换时保留滚动位置，避免双击后滚回顶部 */
  const pendingTextScrollTopRef = useRef<number | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const textSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (textSaveTimeoutRef.current) clearTimeout(textSaveTimeoutRef.current);
    };
  }, []);

  // 更新节点数据（须在 useAI / 同步 effect 之前定义）
  const updateNodeData = useCallback((updates: Partial<MinimalistTextNodeData>) => {
    if (onDataChange) {
      onDataChange(updates);
      return;
    }
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
          }

          return updatedNode;
        }
        return node;
      })
    );
  }, [id, onDataChange, setNodes]);

  // 挂载时若历史尺寸异常偏大，立刻压回正常范围（无需等重新加载工程）
  useEffect(() => {
    const cur = sizeRef.current;
    const clamped = clampTextModuleSize(cur.w, cur.h);
    if (Math.abs(cur.w - clamped.width) < 0.5 && Math.abs(cur.h - clamped.height) < 0.5) return;
    const next = { w: clamped.width, h: clamped.height };
    sizeRef.current = next;
    setSize(next);
    updateNodeData({
      width: next.w,
      height: next.h,
      isUserResized: true,
      _isResizing: false,
    } as Partial<MinimalistTextNodeData>);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // AI Hook（用于接收状态更新，支持进度条和内容回传）
  const { status: aiStatus } = useAI({
    nodeId: id,
    modelId: 'chat', // text 节点也使用 chat 模型
    onStatusUpdate: (packet) => {
      // START 状态：初始化进度条
      if (packet.status === 'START') {
        setErrorMessage('');
        const initialProgress = Math.max(1, packet.payload?.progress || 1);
        const initialMessage = packet.payload?.text || '正在初始化模型...';
        setProgress(initialProgress);
        setProgressMessage(initialMessage);
        updateNodeData({ 
          errorMessage: undefined,
          progress: initialProgress,
          progressMessage: initialMessage,
        });
        return;
      }
      
      // PROCESSING 状态：更新进度和消息
      if (packet.status === 'PROCESSING') {
        if (packet.payload?.progress !== undefined) {
          const newProgress = Math.max(1, packet.payload.progress);
          setProgress(newProgress);
          updateNodeData({ progress: newProgress });
        } else {
          if (progress === 0) {
            setProgress(1);
            updateNodeData({ progress: 1 });
          }
        }
        
        if (packet.payload?.text) {
          setProgressMessage(packet.payload.text);
          updateNodeData({ progressMessage: packet.payload.text });
        }
        return;
      }
      
      // SUCCESS 状态：更新文本内容，清除进度条
      // 双重保障：优先使用 text，而不是等待 localPath 读取
      if (packet.status === 'SUCCESS') {
        try {
          // 优先使用 text 字段（后端已经发送了 text）
          const resultText = packet.payload?.text;
          if (resultText) {
            setText(resultText);
            setProgress(0);
            setProgressMessage('');
            setErrorMessage('');
            updateNodeData({ 
              text: resultText,
              progress: 0,
              progressMessage: undefined,
              errorMessage: undefined,
            });
            console.log(`[MinimalistTextNode] SUCCESS 状态：使用 text 字段，长度: ${resultText.length}`);
            return;
          }
          
          // 如果没有 text，尝试从 localPath 读取（备用方案）
          // 注意：这可能会因为乱码路径而失败，所以用 try-catch 包裹
          const localPath = packet.payload?.localPath;
          if (localPath) {
            console.log(`[MinimalistTextNode] 尝试从 localPath 读取: ${localPath}`);
            // 这里可以添加文件读取逻辑，但优先使用 text 更可靠
            // 暂时跳过，因为后端已经发送了 text
          }
        } catch (error) {
          // 解决乱码中断：即使处理失败，也不阻塞界面
          console.warn('[MinimalistTextNode] 处理 SUCCESS 状态时出错（可能是乱码路径导致）:', error);
          // 如果出错，至少清除进度条
          setProgress(0);
          setProgressMessage('');
          updateNodeData({ 
            progress: 0,
            progressMessage: undefined,
          });
        }
        return;
      }
      
      // ERROR 状态：显示错误信息，清除进度条
      if (packet.status === 'ERROR') {
        const errorMsg = packet.payload?.error || '未知错误';
        setErrorMessage(errorMsg);
        setProgress(0);
        setProgressMessage('');
        updateNodeData({ 
          errorMessage: errorMsg,
          progress: 0,
          progressMessage: undefined,
        });
        return;
      }
    },
    onComplete: (result) => {
      // 完成回调：确保结果正确显示
      // 双重保障：优先使用 text，而不是等待 localPath 读取
      try {
        if (result?.text) {
          setText(result.text);
          setProgress(0);
          setProgressMessage('');
          setErrorMessage('');
          updateNodeData({
            text: result.text,
            progress: 0,
            progressMessage: undefined,
            errorMessage: undefined,
          });
          console.log(`[MinimalistTextNode] onComplete：使用 text 字段，长度: ${result.text.length}`);
        } else if (result?.localPath) {
          // 如果没有 text，尝试从 localPath 读取（备用方案）
          // 注意：这可能会因为乱码路径而失败，所以用 try-catch 包裹
          console.warn('[MinimalistTextNode] onComplete：没有 text 字段，尝试从 localPath 读取（可能失败）:', result.localPath);
          // 暂时跳过，因为后端应该已经发送了 text
        }
      } catch (error) {
        // 解决乱码中断：即使处理失败，也不阻塞界面
        console.warn('[MinimalistTextNode] onComplete 处理时出错（可能是乱码路径导致）:', error);
        // 如果出错，至少清除进度条
        setProgress(0);
        setProgressMessage('');
        updateNodeData({
          progress: 0,
          progressMessage: undefined,
        });
      }
    },
  });

  // 同步外部数据变化（编辑中不同步；避免 store 未落盘时用空 data.text 覆盖刚输入的内容）
  useEffect(() => {
    if (!isEditing && data?.text !== undefined) {
      const external = data.text;
      const local = textRef.current;
      if (external === local) {
        if (text !== external) setText(external);
      } else if (!external && local.trim()) {
        if (text !== local) setText(local);
        updateNodeData({ text: local });
      } else if (external !== text) {
        setText(external);
        textRef.current = external;
      }
    }
    if (!isEditingTitle && data?.title !== undefined) {
      setTitle(data.title);
    }

    if (data?.progress !== undefined) {
      setProgress(data.progress);
    }
    if (data?.progressMessage !== undefined) {
      setProgressMessage(data.progressMessage);
    }
    if (data?.errorMessage !== undefined) {
      setErrorMessage(data.errorMessage);
    }
    if (data?.textAlign !== undefined) setTextAlign(data.textAlign);
    if (data?.fontWeight !== undefined) setFontWeight(data.fontWeight);
    if (data?.fontStyle !== undefined) setFontStyle(data.fontStyle);
    if (data?.fontFamily !== undefined) setFontFamily(data.fontFamily);
    if (data?.fontSizePx !== undefined) setFontSizePx(clampTextFontPx(data.fontSizePx));
  }, [
    isEditing,
    isEditingTitle,
    data?.text,
    data?.title,
    data?.progress,
    data?.progressMessage,
    data?.errorMessage,
    data?.textAlign,
    data?.fontWeight,
    data?.fontStyle,
    data?.fontFamily,
    data?.fontSizePx,
    text,
    updateNodeData,
  ]);

  // 双击标题进入编辑模式
  const handleTitleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditingTitle(true);
    setTimeout(() => {
      titleInputRef.current?.focus();
      if (titleInputRef.current) {
        titleInputRef.current.select();
      }
    }, 0);
  }, []);

  /** 退出编辑时立即落盘，避免防抖未触发或被外部 data 同步覆盖 */
  const commitTextEdit = useCallback(
    (value?: string) => {
      const next = (value ?? textareaRef.current?.value ?? text).replace(/\r\n/g, '\n');
      if (textSaveTimeoutRef.current) {
        clearTimeout(textSaveTimeoutRef.current);
        textSaveTimeoutRef.current = null;
      }
      textRef.current = next;
      setText(next);
      updateNodeData({ text: next });
    },
    [text, updateNodeData],
  );

  const commitTitleEdit = useCallback(
    (value?: string) => {
      const next = value ?? titleInputRef.current?.value ?? title;
      setTitle(next);
      if (data?.title !== next) {
        updateNodeData({ title: next });
      }
    },
    [title, data?.title, updateNodeData],
  );

  const transcribeUpstreamKey = useMemo(() => {
    return edges
      .filter((e) => e.target === id)
      .map((e) => {
        const s = nodes.find((n) => n.id === e.source);
        if (!s) return `${e.source}:unknown`;
        if (s.type === 'audio') return `${e.source}:audio:${pickTwAudioUrl(s.data as Record<string, unknown>)}`;
        if (s.type === 'video') return `${e.source}:video:${pickTwVideoUrl(s.data as Record<string, unknown>)}`;
        return `${e.source}:${s.type}`;
      })
      .sort()
      .join('|');
  }, [edges, nodes, id]);

  /** 新建出边时立即落盘文本，确保下游 LLM 等能读到 data.text（避免 300ms 防抖未写入） */
  const outgoingTargetsKey = useMemo(
    () =>
      edges
        .filter((e) => e.source === id)
        .map((e) => `${e.target}:${e.targetHandle ?? ''}`)
        .sort()
        .join('|'),
    [edges, id],
  );

  useEffect(() => {
    if (!outgoingTargetsKey) return;
    const next = textRef.current.replace(/\r\n/g, '\n');
    const stored = data?.text ?? '';
    if (next === stored) return;
    if (textSaveTimeoutRef.current) {
      clearTimeout(textSaveTimeoutRef.current);
      textSaveTimeoutRef.current = null;
    }
    updateNodeData({ text: next });
  }, [outgoingTargetsKey, updateNodeData]);

  const hasTranscribeMediaSource = useMemo(() => {
    return edges.some((e) => {
      if (e.target !== id) return false;
      const src = nodes.find((n) => n.id === e.source);
      return src?.type === 'audio' || src?.type === 'video';
    });
  }, [edges, nodes, id]);

  useEffect(() => {
    let cancelled = false;
    let clearDebounce: ReturnType<typeof setTimeout> | null = null;

    const hasMediaEdgeIn = (edgeList: typeof edges, nodeList: typeof nodes) =>
      edgeList.some((e) => {
        if (e.target !== id) return false;
        const src = nodeList.find((n) => n.id === e.source);
        return src?.type === 'audio' || src?.type === 'video';
      });

    const incoming = edges.filter((e) => e.target === id);
    const self = nodes.find((n) => n.id === id);
    const curUrl = String(self?.data?.transcribeAudioUrl || '').trim();

    const mediaEdges = incoming.filter((e) => {
      const src = nodes.find((n) => n.id === e.source);
      return src?.type === 'audio' || src?.type === 'video';
    });

    if (mediaEdges.length === 0) {
      setLinkingTw(false);
      // 连线刚建立时，edges/nodes 可能短暂不同步，立即清空会导致转写条「一闪而过」；延迟后从 store 再读一遍再决定是否清空
      if (curUrl) {
        clearDebounce = setTimeout(() => {
          if (cancelled) return;
          const st = store.getState();
          const eList = st.edges ?? [];
          const nList = st.nodes ?? [];
          if (hasMediaEdgeIn(eList, nList)) return;
          updateNodeData({
            transcribeAudioUrl: '',
            transcribeErrorMessage: undefined,
            transcribeStatus: 'idle',
          });
        }, 400);
      }
      return () => {
        cancelled = true;
        if (clearDebounce) clearTimeout(clearDebounce);
        setLinkingTw(false);
      };
    }

    const audioUrls: string[] = [];
    let videoUrl = '';
    for (const e of mediaEdges) {
      const src = nodes.find((n) => n.id === e.source);
      if (!src) continue;
      if (src.type === 'audio') {
        const u = pickTwAudioUrl(src.data as Record<string, unknown>);
        if (u) audioUrls.push(u);
      } else if (src.type === 'video') {
        const v = pickTwVideoUrl(src.data as Record<string, unknown>);
        if (v) videoUrl = v;
      }
    }

    const nextAudio = audioUrls[0] || '';
    if (nextAudio) {
      setLinkingTw(false);
      if (nextAudio !== curUrl) {
        updateNodeData({
          transcribeAudioUrl: nextAudio,
          transcribeErrorMessage: undefined,
          transcribeStatus: 'idle',
        });
      }
      updateNodeInternals(id);
      return () => {
        cancelled = true;
        setLinkingTw(false);
      };
    }

    if (!videoUrl || !window.electronAPI?.extractAudioFromVideo) {
      setLinkingTw(false);
      return () => {
        cancelled = true;
        setLinkingTw(false);
      };
    }

    setLinkingTw(true);
    void window.electronAPI
      .extractAudioFromVideo(projectId || undefined, videoUrl)
      .then((res) => {
        if (cancelled) return;
        setLinkingTw(false);
        if (!res?.audioUrl) return;
        if (res.audioUrl !== curUrl) {
          updateNodeData({
            transcribeAudioUrl: res.audioUrl,
            transcribeErrorMessage: undefined,
            transcribeStatus: 'idle',
          });
        }
        updateNodeInternals(id);
      })
      .catch((err) => {
        if (cancelled) return;
        setLinkingTw(false);
        updateNodeData({
          transcribeErrorMessage: err?.message || String(err) || '从视频提取音频失败',
          transcribeStatus: 'ERROR',
        });
      });

    return () => {
      cancelled = true;
      setLinkingTw(false);
    };
  }, [transcribeUpstreamKey, id, projectId, updateNodeData, updateNodeInternals]);

  const runCloudTranscribe = useCallback(async () => {
    let url = String(data?.transcribeAudioUrl || '').trim();
    if (!url) {
      const incoming = edges.filter((e) => e.target === id);
      for (const e of incoming) {
        const src = nodes.find((n) => n.id === e.source);
        if (!src) continue;
        if (src.type === 'audio') {
          const picked = pickTwAudioUrl(src.data as Record<string, unknown>);
          if (picked) {
            url = picked;
            break;
          }
        }
      }
      if (!url && window.electronAPI?.extractAudioFromVideo) {
        for (const e of incoming) {
          const src = nodes.find((n) => n.id === e.source);
          if (!src || src.type !== 'video') continue;
          const v = pickTwVideoUrl(src.data as Record<string, unknown>);
          if (!v) continue;
          try {
            const res = await window.electronAPI.extractAudioFromVideo(projectId || undefined, v);
            if (res?.audioUrl) {
              url = String(res.audioUrl).trim();
              updateNodeData({ transcribeAudioUrl: url, transcribeStatus: 'idle', transcribeErrorMessage: undefined });
              break;
            }
          } catch {
            // ignore: keep falling back to unified error below
          }
        }
      }
    }
    if (!url) {
      updateNodeData({
        transcribeErrorMessage: '暂无可用音频：请从左侧连接「声音」或「视频」模块',
        transcribeStatus: 'ERROR',
      });
      return;
    }
    if (!window.electronAPI?.transcribeSpeechFromAudioUrl) {
      updateNodeData({
        transcribeErrorMessage: '当前环境不支持语音转写',
        transcribeStatus: 'ERROR',
      });
      return;
    }
    setTranscribeBusy(true);
    updateNodeData({ transcribeStatus: 'PROCESSING', transcribeErrorMessage: undefined });
    try {
      // language 不传：FC fun-asr 使用 language_hints ['zh','en'] 自动识别
      const { text: out } = await window.electronAPI.transcribeSpeechFromAudioUrl(
        projectId || undefined,
        url,
      );
      const t = (out || '').trim();
      setText(t);
      updateNodeData({
        text: t,
        transcribeStatus: 'SUCCESS',
        transcribeErrorMessage: undefined,
      });
    } catch (e: any) {
      updateNodeData({
        transcribeStatus: 'ERROR',
        transcribeErrorMessage: e?.message || String(e),
      });
    } finally {
      setTranscribeBusy(false);
      updateNodeInternals(id);
    }
  }, [data?.transcribeAudioUrl, projectId, updateNodeData, updateNodeInternals, id, edges, nodes]);

  const {
    status: dictationStatus,
    isActive: isDictationActive,
    inputLevel: dictationInputLevel,
    start: startRealtimeDictation,
    stop: stopRealtimeDictation,
    cancel: cancelRealtimeDictation,
  } = useCloudRealtimeDictation({
    getBaseText: () => {
      const prev = String(textRef.current || '').trimEnd();
      return prev ? `${prev}\n` : '';
    },
    onLiveText: (full) => {
      textRef.current = full;
      setText(full);
      updateNodeData({ text: full });
    },
    onError: (message) => {
      showAlert(message);
    },
    onMicDenied: () => {
      showAlert(refMicAt.micPermissionDenied);
    },
  });

  const micVoiceBusy = dictationStatus === 'connecting' || dictationStatus === 'stopping';
  const micVoiceStopping = dictationStatus === 'stopping';

  const { pointerHandlers: micPointerHandlers } = useDictationPushToTalk({
    start: startRealtimeDictation,
    stop: stopRealtimeDictation,
    cancel: cancelRealtimeDictation,
    status: dictationStatus,
    disabled: micVoiceStopping || transcribeBusy,
  });

  // 双击文本区域进入编辑（不依赖 isVisualInteractionLocked，避免拖选后冷却期内无法编辑）
  const handleTextDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const target = e.target as HTMLElement | null;
    if (
      target?.closest?.(
        'button, input, textarea, .title-area, .node-floating-toolbar, .nexflow-plus-handle, .nodrag.absolute.-bottom-2',
      )
    ) {
      return;
    }
    if (isDictationActive || errorMessage) return;
    pendingTextScrollTopRef.current = textViewRef.current?.scrollTop ?? 0;
    setIsEditing(true);
  }, [isDictationActive, errorMessage]);

  // 进入编辑：还原滚动并 focus（preventScroll，避免滚到顶部/文末）
  useEffect(() => {
    if (!isEditing) return;
    const top = pendingTextScrollTopRef.current;
    pendingTextScrollTopRef.current = null;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        try {
          ta.focus({ preventScroll: true });
        } catch {
          ta.focus();
        }
        if (typeof top === 'number' && Number.isFinite(top)) {
          ta.scrollTop = top;
        }
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [isEditing]);

  // 悬停正文：滚轮上下翻页，不缩放画布
  useEffect(() => {
    if (errorMessage) return undefined;
    const el = isEditing ? textareaRef.current : textViewRef.current;
    return bindWheelToElementScroll(el);
  }, [isEditing, errorMessage]);

  // 退出编辑：把 textarea 滚动位置带回预览层
  useEffect(() => {
    if (isEditing) return;
    const top = pendingTextScrollTopRef.current;
    if (typeof top !== 'number' || !Number.isFinite(top)) return;
    pendingTextScrollTopRef.current = null;
    const id = requestAnimationFrame(() => {
      if (textViewRef.current) textViewRef.current.scrollTop = top;
    });
    return () => cancelAnimationFrame(id);
  }, [isEditing]);

  useEffect(() => {
    if (!isDictationActive) return;
    acquireVoiceModalLock();
    return () => releaseVoiceModalLock();
  }, [isDictationActive]);

  // 处理尺寸变化（用户手动调整）
  const handleSizeChange = useCallback((newSize: { w: number; h: number }) => {
    const clamped = clampTextModuleSize(newSize.w, newSize.h);
    const next = { w: clamped.width, h: clamped.height };
    userSizeCommitRef.current = next;
    sizeRef.current = next;
    setSize(next);
    updateNodeData({
      width: next.w,
      height: next.h,
      isUserResized: true,
      _isResizing: false,
    } as Partial<MinimalistTextNodeData>);
  }, [updateNodeData]);

  // 从 store 同步尺寸（加载/外部更新）；用户缩放落盘前不回退
  useEffect(() => {
    if (isResizing) return;

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
      const clamped = clampTextModuleSize(local.w, local.h);
      updateNodeData({
        width: clamped.width,
        height: clamped.height,
        isUserResized: true,
        _isResizing: false,
      } as Partial<MinimalistTextNodeData>);
      if (Math.abs(local.w - clamped.width) > 0.5 || Math.abs(local.h - clamped.height) > 0.5) {
        sizeRef.current = { w: clamped.width, h: clamped.height };
        setSize({ w: clamped.width, h: clamped.height });
      }
      return;
    }

    const next = clampTextModuleSize(dw, dh);
    sizeRef.current = { w: next.width, h: next.height };
    setSize({ w: next.width, h: next.height });
  }, [isResizing, data?.width, data?.height, data?.isUserResized, updateNodeData]);

  useEffect(() => {
    userSizeCommitRef.current = null;
  }, [id]);

  // 点击非编辑区域退出编辑模式
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (isEditing && nodeRef.current && !nodeRef.current.contains(e.target as HTMLElement)) {
        pendingTextScrollTopRef.current = textareaRef.current?.scrollTop ?? null;
        commitTextEdit();
        setIsEditing(false);
      }
      if (isEditingTitle && nodeRef.current && !nodeRef.current.contains(e.target as HTMLElement)) {
        commitTitleEdit();
        setIsEditingTitle(false);
      }
    };

    if (isEditing || isEditingTitle) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isEditing, isEditingTitle, commitTextEdit, commitTitleEdit]);

  const updateNodeDataRef = useRef(updateNodeData);
  updateNodeDataRef.current = updateNodeData;

  useEffect(() => {
    return () => {
      if (textSaveTimeoutRef.current) {
        clearTimeout(textSaveTimeoutRef.current);
        textSaveTimeoutRef.current = null;
      }
      const next = textRef.current.replace(/\r\n/g, '\n');
      updateNodeDataRef.current({ text: next });
    };
  }, []);

  // 复制到剪贴板
  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setShowCopySuccess(true);
      setTimeout(() => {
        setShowCopySuccess(false);
      }, 2000);
    } catch (err) {
      console.error('复制失败:', err);
    }
  }, [text]);


  // 处理文本变化：实时写入节点数据并触发保存（300ms 防抖）
  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    textRef.current = newText;
    setText(newText);
    if (textSaveTimeoutRef.current) clearTimeout(textSaveTimeoutRef.current);
    textSaveTimeoutRef.current = setTimeout(() => {
      updateNodeData({ text: newText });
      textSaveTimeoutRef.current = null;
    }, 300);
  }, [updateNodeData]);

  // 文本样式（对齐、加粗、斜体、字体）
  const textContentStyle = useMemo((): React.CSSProperties => ({
    textAlign,
    fontWeight,
    fontStyle,
    fontFamily: fontFamily || TEXT_FONT_OPTIONS[0].value,
    fontSize: fontSizePx,
    lineHeight: 1.55,
  }), [textAlign, fontWeight, fontStyle, fontFamily, fontSizePx]);

  const applyFormat = useCallback((key: 'textAlign' | 'fontWeight' | 'fontStyle' | 'fontFamily', value: string) => {
    if (key === 'textAlign') {
      setTextAlign(value as 'left' | 'center' | 'right');
      updateNodeData({ textAlign: value as 'left' | 'center' | 'right' });
    } else if (key === 'fontWeight') {
      const v = value as 'normal' | 'bold';
      setFontWeight(v);
      updateNodeData({ fontWeight: v });
    } else if (key === 'fontStyle') {
      const v = value as 'normal' | 'italic';
      setFontStyle(v);
      updateNodeData({ fontStyle: v });
    } else if (key === 'fontFamily') {
      setFontFamily(value);
      updateNodeData({ fontFamily: value });
    }
  }, [updateNodeData]);

  const adjustTextFontSize = useCallback(
    (delta: number) => {
      setFontSizePx((prev) => {
        const next = clampTextFontPx(prev + delta);
        if (next !== prev) updateNodeData({ fontSizePx: next });
        return next;
      });
    },
    [updateNodeData],
  );

  // 合并所有样式到一个对象中
  const nodeStyle = useMemo(() => {
    const baseStyle: React.CSSProperties = {
      width: size.w,
      height: size.h,
      minWidth: '280px',
      minHeight: '160px',
      userSelect: isResizing ? 'none' : 'auto',
      willChange: isResizing ? 'transform, width, height' : dragging ? 'transform' : 'auto',
      backfaceVisibility: isResizing ? 'hidden' : 'visible',
      transition: isResizing ? 'none' : 'background-color 0.2s, border-color 0.2s',
    };

    return baseStyle;
  }, [size.w, size.h, isResizing]);

  const zoom = transform?.[2] ?? 1;
  const vx = transform?.[0] ?? 0;
  const vy = transform?.[1] ?? 0;
  const isHardFrozen = useMemo(() => {
    if (!performanceMode || isSelected || dragging || isResizing) return false;
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
  }, [performanceMode, isSelected, dragging, isResizing, vx, vy, zoom, xPos, yPos, size.w, size.h]);
  // 选中或正在编辑时始终显示完整内容与控件，避免框选/创建后控件不显示（isHardFrozen 等可能误判）
  const showPlaceholder = (isResizing || isHardFrozen) && !isSelected && !isEditing;
  const showTranscribeBar =
    hasTranscribeMediaSource || linkingTw || !!(data?.transcribeAudioUrl || '').trim();
  const showFloatingToolbar = (isSelected || isHovered) && !errorMessage;
  const floatToolBtn = (scratch: ScratchColorId, active: boolean, extra = '') =>
    nodeFloatToolBtn(isDarkMode, active, extra, scratch);
  /** 与 VideoNode 顶部工具钮（floatTopPillBtn）同款视觉 token */
  const floatTopPillBtn = (extra = '') =>
    isDarkMode
      ? `nodrag nopan flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15 hover:bg-white/25 text-white transition-colors ${extra}`
      : `nodrag nopan flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/90 hover:bg-white text-gray-800 border border-gray-200/80 shadow-sm transition-colors ${extra}`;
  return (
    <div
      ref={nodeRef}
      data-id={id}
      style={nodeStyle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onDoubleClick={handleTextDoubleClick}
      className={`custom-node-container group relative rounded-2xl p-4 overflow-visible flex flex-col ${
        isDarkMode 
          ? 'nexflow-glass-panel'
          : 'apple-panel-light'
        } ${
        isSelected && !isResizing
          ? isDarkMode
            ? 'ring-2 ring-green-400/80'
            : 'ring-2 ring-green-500'
          : ''
      } ${isResizing ? '!shadow-none !ring-0' : ''}`}
    >
      <Handle type="target" position={Position.Left} id="input" className="nexflow-plus-handle nexflow-plus-handle-left" />
      <Handle type="source" position={Position.Right} id="output" className={`nexflow-plus-handle nexflow-plus-handle-right ${showPlaceholder ? 'opacity-0 pointer-events-none' : ''}`} />
      {/* 与 Image 等模块一致：进度条覆盖主卡片区域（仅音轨/转写；听写不用全遮罩以免挡住停止） */}
      {(linkingTw || data?.transcribeStatus === 'PROCESSING') && (
        <ModuleProgressBar
          visible
          progress={linkingTw ? 0 : 45}
          solidBackground={isDarkMode ? '#1C1C1E' : '#f5f5f5'}
          progressMessage={linkingTw ? '正在从视频提取音轨…' : '正在转写'}
          borderRadius={16}
        />
      )}
      {/* 听写中：顶栏状态提示（松开麦克风即结束；pointer-events-none 以免挡按住中的麦） */}
      {isDictationActive && !linkingTw && data?.transcribeStatus !== 'PROCESSING' && (
        <div
          className={`nodrag absolute left-10 right-2 top-2 z-[55] flex items-center gap-2 rounded-lg px-2.5 py-1.5 pointer-events-none shadow-sm ${
            isDarkMode
              ? 'border border-orange-400/50 bg-orange-500/25 text-orange-50'
              : 'border border-orange-300 bg-orange-50 text-orange-900'
          }`}
        >
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={2.25} />
            <span className="truncate">{wc.textVoiceTranscribing}</span>
          </span>
        </div>
      )}
      {data?.transcribeErrorMessage &&
        !(linkingTw || data?.transcribeStatus === 'PROCESSING' || isDictationActive) && (
        <p className="pointer-events-none absolute top-2 left-2 right-12 z-20 text-[10px] text-red-400 break-words leading-snug">
          {data.transcribeErrorMessage}
        </p>
      )}
      {showPlaceholder ? (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className={`text-xs font-medium ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>
            {isHardFrozen ? `${title || 'text'}（冻结）` : (title || 'text')}
          </span>
        </div>
      ) : (
      <>
      {/* 左上角标题区域（在文本框外部，节点边框外） */}
      {(showFloatingToolbar || isSelected) && (
      <div className="title-area absolute -top-7 left-0 z-10">
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              setIsEditingTitle(false);
              commitTitleEdit();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setIsEditingTitle(false);
                commitTitleEdit();
              }
              if (e.key === 'Escape') {
                setIsEditingTitle(false);
                setTitle(data?.title || 'text');
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
            autoFocus
          />
        ) : (
          <span
            onClick={handleTitleDoubleClick}
            className={`font-bold text-xs cursor-pointer select-none ${
              isDarkMode ? 'text-white/80' : 'text-gray-900'
            } hover:opacity-70 transition-opacity`}
          >
            {title || 'text'}
          </span>
        )}
      </div>
      )}

      {/* 模块外上方居中：话筒 / 复制 /（连音频时）转文字 */}
      {(isSelected || isHovered || isDictationActive || transcribeBusy) &&
        !showPlaceholder &&
        !errorMessage && (
        <div
          className="nodrag nopan pointer-events-auto absolute -top-14 left-0 right-0 z-[56] flex justify-center gap-2"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            {...micPointerHandlers}
            disabled={transcribeBusy || micVoiceStopping}
            style={
              dictationStatus === 'listening' || dictationStatus === 'connecting'
                ? micLevelCssVars(dictationInputLevel)
                : undefined
            }
            className={`nexflow-voice-mic-btn ${floatTopPillBtn(
              dictationStatus === 'connecting'
                ? 'connecting'
                : dictationStatus === 'listening'
                  ? 'listening'
                  : '',
            )} ${
              transcribeBusy || micVoiceStopping
                ? 'opacity-50 cursor-wait'
                : ''
            }`}
            title={
              micVoiceBusy || isDictationActive
                ? wc.textVoiceInputStopButton
                : wc.textVoiceInputTitle
            }
            aria-label={
              micVoiceBusy || isDictationActive
                ? wc.textVoiceInputStopButton
                : wc.textVoiceInputButton
            }
          >
            <VoiceMicGlyph
              busy={transcribeBusy || micVoiceBusy}
              active={dictationStatus === 'listening'}
              level={dictationInputLevel}
            />
          </button>
          {(isSelected || isHovered) && !isEditing ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                handleCopy();
              }}
              className={floatTopPillBtn()}
              title={showCopySuccess ? '已复制' : '复制'}
              aria-label={showCopySuccess ? '已复制' : '复制'}
            >
              {showCopySuccess ? (
                <Check className={`h-4 w-4 shrink-0 ${isDarkMode ? 'text-green-400' : 'text-emerald-600'}`} />
              ) : (
                <Copy className={`h-4 w-4 shrink-0 ${isDarkMode ? 'text-white/90' : 'text-gray-700'}`} />
              )}
            </button>
          ) : null}
          {showTranscribeBar ? (
            <button
              type="button"
              disabled={transcribeBusy || !!(linkingTw && !(data?.transcribeAudioUrl || '').trim())}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                void runCloudTranscribe();
              }}
              className={floatTopPillBtn(
                transcribeBusy || !!(linkingTw && !(data?.transcribeAudioUrl || '').trim())
                  ? 'opacity-50 cursor-wait'
                  : '',
              )}
              title="转文字"
              aria-label="转文字"
            >
              {transcribeBusy || data?.transcribeStatus === 'PROCESSING' ? (
                <Loader2 className={`h-4 w-4 shrink-0 animate-spin ${isDarkMode ? 'text-white/90' : 'text-gray-700'}`} />
              ) : (
                <Headphones className={`h-4 w-4 shrink-0 ${isDarkMode ? 'text-white/90' : 'text-gray-700'}`} />
              )}
            </button>
          ) : null}
        </div>
      )}

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
            
            // 计算新尺寸（最小/最大约束，避免拖成整屏发糊）
            const newW = Math.min(TEXT_MODULE_MAX_W, Math.max(MIN_WIDTH, startW + deltaX));
            const newH = Math.min(TEXT_MODULE_MAX_H, Math.max(MIN_HEIGHT, startH + deltaY));
            sizeRef.current = { w: newW, h: newH };

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
            // 获取最终尺寸（从 DOM 读取）
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

      {/* 复制成功提示 */}
      {showCopySuccess && (
        <div className="absolute top-12 right-2 apple-panel px-2 py-1 rounded text-xs text-white/80 z-20 animate-fade-in">
          已复制
        </div>
      )}

      {/* 文本内容 */}
      <div
        className={`nowheel flex-1 overflow-hidden flex flex-col min-h-0 ${
          isDictationActive ? 'pt-10' : ''
        }`}
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
        ) : isEditing ? (
          // 编辑模式：显示 textarea
          <textarea
            ref={textareaRef}
            data-nexflow-dictation-target="1"
            value={text}
            readOnly={isDictationActive}
            disabled={isDictationActive}
            onChange={(e) => {
              if (isDictationActive) return;
              handleTextChange(e);
            }}
            className={`nodrag nowheel drag-handle-area w-full h-full bg-transparent resize-none outline-none flex-1 overflow-auto p-2 ${
              isDarkMode ? 'custom-scrollbar-dark' : 'custom-scrollbar'
            } ${
              isDarkMode 
                ? 'text-white placeholder:text-white/40' 
                : 'text-gray-900 placeholder:text-gray-400'
            } ${isDictationActive ? 'opacity-45 cursor-not-allowed' : ''}`}
            placeholder="输入文本..."
            style={{ 
              caretColor: isDarkMode ? '#0A84FF' : '#22c55e',
              ...textContentStyle,
            }}
            onBlur={() => {
              pendingTextScrollTopRef.current = textareaRef.current?.scrollTop ?? null;
              commitTextEdit();
              setIsEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                pendingTextScrollTopRef.current = textareaRef.current?.scrollTop ?? null;
                setIsEditing(false);
                setText(data?.text || '');
              }
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            ref={textViewRef}
            className={`nodrag nowheel drag-handle-area w-full h-full flex items-start overflow-auto p-2 relative flex-1 cursor-text ${
              isDarkMode ? 'custom-scrollbar-dark' : 'custom-scrollbar'
            } ${
              textAlign === 'left' ? 'justify-start' : textAlign === 'right' ? 'justify-end' : 'justify-center'
            }`}
            onDoubleClick={handleTextDoubleClick}
          >
            {text ? (
              <p className={`break-words whitespace-pre-wrap ${
                isDarkMode ? 'text-white/80' : 'text-gray-900'
              }`} style={{ 
                maxWidth: '100%',
                wordBreak: 'break-word',
                overflowWrap: 'break-word',
                ...textContentStyle,
              }}>
                {text}
              </p>
            ) : (
              <p className={`${isDarkMode ? 'text-white/40' : 'text-gray-500'}`} style={{ fontSize: fontSizePx, lineHeight: 1.55 }}>
                {wc.doubleClickEditText}
              </p>
            )}
          </div>
        )}
      </div>

      </>
      )}

      {/* 模块外下方：对齐/字号等格式悬浮工具栏（话筒/复制/转文字在节点外上方居中） */}
      {showFloatingToolbar && (
        <div
          className="node-floating-toolbar nodrag nopan absolute top-full left-1/2 z-20 mt-1.5 flex w-max max-w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 overflow-visible"
          style={{ pointerEvents: 'all' }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => applyFormat('textAlign', 'left')}
            className={floatToolBtn('motion', textAlign === 'left')}
            title="左对齐"
          >
            <AlignLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => applyFormat('textAlign', 'center')}
            className={floatToolBtn('looks', textAlign === 'center')}
            title="居中"
          >
            <AlignCenter className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => applyFormat('textAlign', 'right')}
            className={floatToolBtn('sensing', textAlign === 'right')}
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
            onClick={() => adjustTextFontSize(-2)}
            disabled={fontSizePx <= 10}
            className={floatToolBtn('control', false, fontSizePx <= 10 ? '!opacity-40' : '')}
            title={wc.fontZoomOutTitle}
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => adjustTextFontSize(2)}
            disabled={fontSizePx >= 28}
            className={floatToolBtn('operators', false, fontSizePx >= 28 ? '!opacity-40' : '')}
            title={wc.fontZoomInTitle}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
