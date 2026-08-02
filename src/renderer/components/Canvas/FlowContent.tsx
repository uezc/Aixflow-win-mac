// @ts-nocheck
import React, { useCallback, useMemo, useEffect, useRef, useState, memo } from 'react';
import { createPortal } from 'react-dom';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Node,
  Edge,
  Connection,
  useNodesState,
  useEdgesState,
  NodeTypes,
  EdgeTypes,
  useReactFlow,
  useStoreApi,
  SelectionMode,
  ReactFlowInstance,
  useStore,
  getNodesBounds,
  MiniMap,
  Panel,
  getBezierPath,
  getSmoothStepPath,
  Position,
  internalsSymbol,
  ConnectionLineType,
  useUpdateNodeInternals,
} from 'reactflow';
import { Camera, ChevronDown, Keyboard, Maximize2, MousePointer2 } from 'lucide-react';
import CanvasShortcutsPanel from './CanvasShortcutsPanel';
import ContextMenu from './ContextMenu';
import BatchRunButton from './BatchRunButton';
import SuperConnectButton from './SuperConnectButton';
import VideoJoinButton from './VideoJoinButton';
import GridMapFromSelectionButton from './GridMapFromSelectionButton';
import type { CreateGridMapFromSelectionOpts } from './GridMapFromSelectionButton';
import CanvasHardwareAccelToggle from './CanvasHardwareAccelToggle';

const noopReverseSuperConnect = (_sourceNodeId: string, _targetNodeIds: string[]) => {};
import { getAllowedMenuTypes, isConnectionAllowed, isCharacterConnectionDataValid } from '../../utils/connectionRules';
import { isDigitalHumanConnectionDataValid, pickDigitalHumanVideoUrl } from '../../utils/digitalHumanNodeMedia';
import {
  isTimelineMediaSourceNodeType,
  isTimelineVideoSourceNodeType,
  resolveTimelineMediaFromSource,
  sortNodesByReadingOrder,
} from '../../utils/timelineSourceMedia';
import { resolveImageUrlFromNodeForPhotoCollage } from '../../utils/photoCollageFromEdges';
import { snapConnectionToPlusHandle } from '../../utils/plusHandleConnectionSnap';
import { ErrorBoundary } from '../ErrorBoundary';
import { getNodeDisplayPrice } from '../../utils/cloudModelPricing';
import { useNxModelPricing } from '../../contexts/NxModelPricingContext';
import { PERF_POLICY, SILENCE_PERF_MONITOR, TAPNOW_INTERACTION_SUSPEND } from '../../config/perfPolicy';
import {
  ASSET_LIBRARY_CANVAS_GAP_PX,
  ASSET_LIBRARY_SIDEBAR_COLLAPSED_WIDTH_PX,
  ASSET_LIBRARY_SIDEBAR_WIDTH_PX,
} from '../../utils/assetLibraryChrome';
import {
  getGlobalInteractionSnapshot,
  setActiveVideoNodeId,
  setGlobalInteracting,
  setGlobalPerfLevel,
  setGlobalRuntimeFps,
  setGlobalViewportVelocity,
  setGlobalVisualLockState,
  setVideoViewportSnapshot,
  triggerEmergencyVideoUnload,
  resetGlobalInteractionLocks,
  useGlobalInteractionSelector,
} from '../../utils/globalInteractionStore';
import { ZERO_FLICKER_INTERACTION_UNLOCK_MS } from '../../config/videoVisualConstants';
import { setImageLoadMaxParallel } from '../../utils/imageLoadPriorityQueue';
import { setVideoExtractQueuePaused } from '../../utils/videoThumbnails';
import { setOnAfterPositionApply } from '../../utils/nativeNodePositionSync';
import { consumeAbortCount } from '../../utils/abortStats';
import AnimatedGradientEdge from './AnimatedGradientEdge';
import FrozenBezierEdge from './FrozenBezierEdge';
import FrozenSmoothStepEdge from './FrozenSmoothStepEdge';
import SplitRibbonEdge from './SplitRibbonEdge';
import { CanvasEngine } from '../../utils/CanvasEngine';
import { useHasPlayingAudioNodes } from '../../utils/audioNodePlaybackStore';
import EdgeCanvasLayer, { type EdgeCanvasLayerHandle } from './EdgeCanvasLayer';
import EdgeCanvasHitLayer from './EdgeCanvasHitLayer';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import { flowEmptyCanvasT } from '../../i18n/flowEmptyCanvasI18n';
import { canvasShortcutsT } from '../../i18n/canvasShortcutsI18n';
import { VIDEO_NODE_DEFAULT_H, VIDEO_NODE_DEFAULT_W } from '../../utils/nodeSizeFromAspectRatio';
import 'reactflow/dist/style.css';

/** 与 Workspace pickCharacterLibraryAvatarUrlFromNode 一致：可点选参考图的 image / character 模块 */
function nodeHasPickableCharacterLibraryImage(n: Node): boolean {
  const t = n.type;
  const d = (n.data || {}) as Record<string, unknown>;
  if (t === 'image') {
    const out = typeof d.outputImage === 'string' ? d.outputImage.trim() : '';
    const av = typeof d.avatar === 'string' ? d.avatar.trim() : '';
    return Boolean(out || av);
  }
  if (t === 'character') {
    const preview =
      (typeof d.outputImage === 'string' && d.outputImage.trim()) ||
      (typeof d.avatar === 'string' && d.avatar.trim()) ||
      '';
    const original = (typeof d.originalImageUrl === 'string' && d.originalImageUrl.trim()) || preview;
    return Boolean(preview || original);
  }
  return false;
}

/** 与 Workspace pickCharacterLibraryVoiceUrlFromNode / handleMenuSelect isAudioType 对齐 */
const VOICE_PICK_AUDIO_TYPES = new Set([
  'audio',
  'audio-extract-from-video',
  'audio-extract-vocals',
  'audio-extract-background',
]);

/** 从画布选角色参考音：与 Workspace pickCharacterLibraryVoiceUrlFromNode 一致 */
function nodeHasPickableVoiceForCharacterLibrary(n: Node): boolean {
  const t = n.type;
  const d = (n.data || {}) as Record<string, unknown>;
  const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string).trim() : '');
  if (t && VOICE_PICK_AUDIO_TYPES.has(t)) return Boolean(str('outputAudio') || str('originalAudioUrl') || str('referenceAudioUrl'));
  if (t === 'audioTranscribe') return Boolean(str('audioUrl'));
  if (t === 'minimalistText' || t === 'text') return Boolean(str('outputAudio') || str('originalAudioUrl') || str('referenceAudioUrl'));
  if (t === 'character') return Boolean(str('voiceClip') || str('referenceAudioUrl') || str('outputAudio') || str('originalAudioUrl'));
  return false;
}

function nodeHasPickableDigitalHumanVideo(n: Node): boolean {
  const t = n.type;
  if (t === 'digitalHuman') {
    return Boolean(pickDigitalHumanVideoUrl(n.data as Record<string, unknown>));
  }
  if (t !== 'video' && t !== 'wanAnimate' && t !== 'heyGem') return false;
  const d = (n.data || {}) as Record<string, unknown>;
  const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string).trim() : '');
  return Boolean(str('outputVideo') || str('originalVideoUrl') || str('referenceVideoUrl'));
}

function canvasPickWantsImageTarget(target: string): boolean {
  return (
    target === 'avatar' ||
    target === 'view' ||
    target === 'sceneNormal' ||
    target === 'sceneDisplay3d'
  );
}

function isNodePickableForCanvasTarget(n: Node, target: string): boolean {
  if (target === 'digitalHumanVideo') return nodeHasPickableDigitalHumanVideo(n);
  return canvasPickWantsImageTarget(target)
    ? nodeHasPickableCharacterLibraryImage(n)
    : nodeHasPickableVoiceForCharacterLibrary(n);
}

function stripCanvasPickNodeClasses(className?: string): string {
  return (className || '')
    .replace(/\bcanvas-pick-\S+/g, '')
    .replace(/\bquick-connect-\S+/g, '')
    .trim();
}

/** 连接线样式上下文，供 CustomConnectionLine / PendingConnectionLine 使用 */
const EdgePathStyleContext = React.createContext<'curve' | 'smoothStep'>('curve');

/** 节点类型中文名映射 */
const NODE_TYPE_LABELS: Record<string, string> = {
  custom: '自定义',
  textNode: '文本',
  minimalistText: '极简文本',
  llm: '大模型',
  image: '图片',
  video: '视频',
  wanAnimate: '视频换人',
  heyGem: 'HeyGem 数字人',
  digitalHuman: '视频+参考音',
  videoSplice: '视频剪辑',
  photoCollage: '拼图',
  gridMap: '宫格图',
  imageComparer: '图片对比',
  character: '角色',
  audio: '音频',
  audioTranscribe: '语音转文字(旧)',
  textSplit: '文本拆分',
  cameraControl: '3D视角',
};

/** 画布右下角模块数量统计：显示总数，点击展开各类型数量 */
const ModuleCountStats = memo(function ModuleCountStats({ nodes, isDarkMode }: { nodes: Node[]; isDarkMode: boolean }) {
  const [open, setOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const stats = useMemo(() => {
    const map: Record<string, number> = {};
    nodes.forEach((n) => {
      const t = n.type || 'custom';
      map[t] = (map[t] ?? 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [nodes]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const el = e.target as Node;
      if (popupRef.current?.contains(el) || btnRef.current?.contains(el)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  if (nodes.length === 0) return null;

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
          isDarkMode ? 'apple-panel text-white/80 hover:bg-white/15' : 'apple-panel-light text-gray-700 hover:bg-gray-200/50'
        }`}
        title="点击查看各类型模块数量"
      >
        <span>{nodes.length}</span>
        <span className="text-xs opacity-70">模块</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          ref={popupRef}
          className={`absolute bottom-full right-0 mb-2 min-w-[160px] rounded-xl border shadow-xl py-2 ${
            isDarkMode ? 'nexflow-glass-panel border-white/20' : 'bg-white/95 border-gray-200'
          }`}
        >
          <div className={`px-3 pb-2 mb-2 border-b text-xs font-semibold ${isDarkMode ? 'border-white/10 text-white' : 'border-gray-200 text-gray-600'}`}>
            按类型统计
          </div>
          <div className="max-h-[200px] overflow-y-auto space-y-1 px-3">
            {stats.map(([type, count]) => (
              <div key={type} className="flex items-center justify-between gap-4 text-sm">
                <span className={isDarkMode ? 'text-white/90' : 'text-gray-800'}>
                  {NODE_TYPE_LABELS[type] ?? type}
                </span>
                <span className={`font-medium tabular-nums ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

/** 稳定大画布模式：画布逻辑边界固定，禁止随内容动态扩容，避免渲染进程崩溃 */
const MAX_CANVAS_SIZE = 8000;

/** 点阵背景基础间距（会随 zoom 动态换算） */
const DOT_GAP_DEFAULT = 60;
const DOT_GAP_MIN = 20;
const DOT_GAP_MAX = 180;
/** 缩放滑块：独立订阅 zoom，避免 FlowContent 在缩放时全树重渲染导致卡顿 */
const ZoomSlider = memo(function ZoomSlider({ isDarkMode }: { isDarkMode: boolean }) {
  const zoom = useStore((s) => s.transform?.[2] ?? 1);
  const { getViewport, setViewport } = useReactFlow();
  const [sliderZoom, setSliderZoom] = useState(zoom);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    setSliderZoom(zoom);
  }, [zoom]);
  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);
  const applyZoom = useCallback((v: number) => {
    const vp = getViewport();
    const snapped = Math.max(0.1, Math.min(1, Math.round(v * 100) / 100));
    setViewport({ ...vp, zoom: snapped });
  }, [getViewport, setViewport]);
  const onSliderChange = useCallback((v: number) => {
    setSliderZoom(v);
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      applyZoom(v);
    });
  }, [applyZoom]);
  return (
    <div className="flex items-center gap-2" style={{ width: 160 }}>
      <span className={`text-xs flex-shrink-0 ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`} title="画布缩放">
        {Math.round(sliderZoom * 100)}%
      </span>
      <input
        type="range"
        min={0.1}
        max={1}
        step={0.01}
        value={sliderZoom}
        onChange={(e) => onSliderChange(parseFloat(e.target.value))}
        className="flex-1 h-2 rounded-full appearance-none cursor-pointer accent-green-500 bg-white/20"
        title="拖动调节画布缩放"
      />
    </div>
  );
});

const FlowDotBackground = memo(function FlowDotBackground({
  isDarkMode,
  degraded = false,
  lightDotsColor = '#000000',
  lightDotSize = 2,
  canvasDotGap = DOT_GAP_DEFAULT,
}: {
  isDarkMode: boolean;
  degraded?: boolean;
  lightDotsColor?: string;
  lightDotSize?: number;
  canvasDotGap?: number;
}) {
  // 固定 flow 坐标下的间距/大小：随画布 zoom 一起放大缩小，缩小时也不隐藏
  const sizeScale = Math.max(0.5, Math.min(4, lightDotSize));
  const gap = Math.max(DOT_GAP_MIN, Math.min(DOT_GAP_MAX, canvasDotGap || DOT_GAP_DEFAULT));
  const size = Math.max(0.8, Math.min(4, 1.35 * sizeScale));

  const hexToRgba = (hex: string, alpha: number) => {
    const m = hex.slice(1).match(/.{2}/g);
    if (!m) return `rgba(0,0,0,${alpha})`;
    const [r, g, b] = m.map((x) => parseInt(x, 16));
    return `rgba(${r},${g},${b},${alpha})`;
  };
  const color = isDarkMode ? 'rgba(255,255,255,0.14)' : hexToRgba(lightDotsColor, 0.14);
  const effectiveColor = color;
  // 鼠标范围内点亮的波点颜色（比底图更亮，聚光灯中心最亮）
  const highlightColor = isDarkMode ? 'rgba(255,255,255,0.72)' : hexToRgba(lightDotsColor, 0.72);

  return (
    <>
      <Background
        id="nexflow-dynamic-dots"
        variant={BackgroundVariant.Dots}
        gap={gap}
        size={size}
        color={effectiveColor}
        style={{
          transition: degraded ? 'none' : 'all 0.1s ease-out',
          imageRendering: 'auto' /* 避免 pixelated 与细连线叠加产生摩尔纹 */,
          transform: 'translateZ(0)',
          willChange: 'transform',
        }}
      />
      {/* 鼠标聚光灯：拖拽/缩放时保持；半径用屏幕像素，不随 zoom 隐藏 */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: -1,
          pointerEvents: 'none',
          maskImage: 'radial-gradient(circle 180px at var(--dot-mouse-x, 50%) var(--dot-mouse-y, 50%), white 0%, rgba(255,255,255,0.9) 20%, rgba(255,255,255,0.5) 50%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(circle 180px at var(--dot-mouse-x, 50%) var(--dot-mouse-y, 50%), white 0%, rgba(255,255,255,0.9) 20%, rgba(255,255,255,0.5) 50%, transparent 100%)',
          maskSize: '100% 100%',
          maskPosition: '0 0',
        }}
      >
        <Background
          id="nexflow-dots-highlight"
          variant={BackgroundVariant.Dots}
          gap={gap}
          size={size}
          color={highlightColor}
          style={{
            transition: degraded ? 'none' : 'all 0.1s ease-out',
            imageRendering: 'auto',
            transform: 'translateZ(0)',
          }}
        />
      </div>
      {/* 明亮模式保留极轻纵向罩层；暗黑模式不再叠竖向渐变（易出现横向色带/斑纹） */}
      {!degraded && !isDarkMode && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: -1,
            pointerEvents: 'none',
            background:
              'linear-gradient(to bottom, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.08) 65%, rgba(255,255,255,0.14) 100%)',
            mixBlendMode: 'multiply',
          }}
        />
      )}
    </>
  );
});

/** 从 store 的 nodeInternals 获取 handleBounds，计算精确的 Handle 中心 Flow 坐标 */
function getSourceHandleFlowPosition(
  nodeInternals: Map<string, Node>,
  sourceNodeId: string,
  sourceHandleId: string | null,
  handleType: 'source' | 'target'
): { x: number; y: number } | null {
  const node = nodeInternals.get(sourceNodeId);
  if (!node?.positionAbsolute) return null;
  const bounds = (node as Node & { [key: symbol]: { handleBounds?: { source?: Array<{ id?: string | null; x: number; y: number; width: number; height: number }>; target?: Array<{ id?: string | null; x: number; y: number; width: number; height: number }> } } })[internalsSymbol]?.handleBounds;
  if (!bounds) return null;
  const list = handleType === 'source' ? bounds.source : bounds.target;
  if (!list?.length) return null;
  const handle = sourceHandleId ? list.find((h) => h.id === sourceHandleId) : list[0];
  if (!handle) return null;
  const cx = node.positionAbsolute.x + handle.x + handle.width / 2;
  const cy = node.positionAbsolute.y + handle.y + handle.height / 2;
  return { x: cx, y: cy };
}

/** TextSplit 输出 handle 在 right:-8 容器内，连线需延伸 8px 消除与模块空隙 */
const TEXTSPLIT_RIGHT_OFFSET = 8;

/** 无 handleBounds 时的回退：用节点宽高估算起点（右侧中点或 TextSplit 多输出） */
function getSourceHandleFlowPositionFallback(
  nodeInternals: Map<string, Node>,
  sourceNodeId: string,
  sourceHandleId: string | null,
  handleType: 'source' | 'target'
): { x: number; y: number } | null {
  const node = nodeInternals.get(sourceNodeId);
  if (!node) return null;
  const pos = node.positionAbsolute ?? node.position;
  const w = Number((node as Node).data?.width ?? 200);
  const h = Number((node as Node).data?.height ?? 200);
  let sourceX = pos.x + w;
  let sourceY = pos.y + h / 2;
  if (node.type === 'textSplit' && sourceHandleId && sourceHandleId.startsWith('output-')) {
    sourceX += TEXTSPLIT_RIGHT_OFFSET;
    if (sourceHandleId === 'output-null') {
      sourceY = pos.y + h / 2;
    } else {
      const idx = Number(sourceHandleId.replace('output-', ''));
      if (Number.isFinite(idx) && idx >= 0) {
        const outputBaseTop = 72;
        const perHandle = 28;
        sourceY = pos.y + outputBaseTop + idx * perHandle + perHandle / 2;
      }
    }
  }
  return { x: sourceX, y: sourceY };
}

/** 自定义 ConnectionLine：拖拽时用 handleBounds 精确计算起点，修正偏移 */
const CustomConnectionLine = memo(function CustomConnectionLine({
  fromNode,
  fromHandle,
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
  connectionLineType,
  connectionLineStyle,
}: {
  fromNode?: Node;
  fromHandle?: { id?: string | null; x: number; y: number; width: number; height: number; position?: Position };
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  fromPosition: Position;
  toPosition: Position;
  connectionLineType: ConnectionLineType;
  connectionLineStyle?: React.CSSProperties;
}) {
  const nodeInternals = useStore((s) => s.nodeInternals);
  const connectionHandleId = useStore((s) => s.connectionHandleId);
  const connectionHandleType = useStore((s) => s.connectionHandleType);
  const edgePathStyle = React.useContext(EdgePathStyleContext);
  const EDGE_ATTACH_OVERLAP = 0;
  const handleType = connectionHandleType === 'target' ? 'target' : 'source';
  const recalc = fromNode
    ? (getSourceHandleFlowPosition(nodeInternals, fromNode.id, connectionHandleId ?? fromHandle?.id ?? null, handleType)
        ?? getSourceHandleFlowPositionFallback(nodeInternals, fromNode.id, connectionHandleId ?? fromHandle?.id ?? null, handleType))
    : null;
  const sx = fromPosition === Position.Right
    ? (recalc?.x ?? fromX) - EDGE_ATTACH_OVERLAP
    : fromPosition === Position.Left
      ? (recalc?.x ?? fromX) + EDGE_ATTACH_OVERLAP
      : (recalc?.x ?? fromX);
  const sy = recalc?.y ?? fromY;
  const txAdjusted = toPosition === Position.Right
    ? toX - EDGE_ATTACH_OVERLAP
    : toPosition === Position.Left
      ? toX + EDGE_ATTACH_OVERLAP
      : toX;
  const [path] = edgePathStyle === 'smoothStep'
    ? getSmoothStepPath({
        sourceX: sx,
        sourceY: sy,
        sourcePosition: fromPosition,
        targetX: txAdjusted,
        targetY: toY,
        targetPosition: toPosition,
        borderRadius: 20,
      })
    : getBezierPath({
        sourceX: sx,
        sourceY: sy,
        sourcePosition: fromPosition,
        targetX: txAdjusted,
        targetY: toY,
        targetPosition: toPosition,
        curvature: 0.25,
      });
  return (
    <path
      d={path}
      fill="none"
      className="react-flow__connection-path nexflow-connection-drag-path"
      style={{
        ...connectionLineStyle,
        strokeDasharray: '8 6',
        strokeLinecap: 'round',
      }}
    />
  );
});

const PendingConnectionLine = memo(function PendingConnectionLine({
  connectFrom,
  flowX,
  flowY,
  isDarkMode,
}: {
  connectFrom?: { sourceNodeId: string; sourceHandleId: string | null; handleType: string | null };
  flowX?: number;
  flowY?: number;
  isDarkMode: boolean;
}) {
  const nodeInternals = useStore((s) => s.nodeInternals);
  const transform = useStore((s) => s.transform ?? [0, 0, 1]);
  const edgePathStyle = React.useContext(EdgePathStyleContext);
  const EDGE_ATTACH_OVERLAP = 0;
  if (!connectFrom || flowX == null || flowY == null) return null;
  const handleType = connectFrom.handleType === 'target' ? 'target' : 'source';
  const sourceFlow =
    getSourceHandleFlowPosition(nodeInternals, connectFrom.sourceNodeId, connectFrom.sourceHandleId, handleType)
    ?? getSourceHandleFlowPositionFallback(nodeInternals, connectFrom.sourceNodeId, connectFrom.sourceHandleId, handleType);
  if (!sourceFlow) return null;
  const [path] = edgePathStyle === 'smoothStep'
    ? getSmoothStepPath({
        sourceX: sourceFlow.x - EDGE_ATTACH_OVERLAP,
        sourceY: sourceFlow.y,
        sourcePosition: Position.Right,
        targetX: flowX + EDGE_ATTACH_OVERLAP,
        targetY: flowY,
        targetPosition: Position.Left,
        borderRadius: 20,
      })
    : getBezierPath({
        sourceX: sourceFlow.x - EDGE_ATTACH_OVERLAP,
        sourceY: sourceFlow.y,
        sourcePosition: Position.Right,
        targetX: flowX + EDGE_ATTACH_OVERLAP,
        targetY: flowY,
        targetPosition: Position.Left,
        curvature: 0.25,
      });
  return (
    <Panel position="top-left" style={{ left: 0, top: 0, margin: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 5 }}>
      <svg className="absolute inset-0 w-full h-full" style={{ overflow: 'visible' }}>
        <g transform={`translate(${transform[0]}, ${transform[1]}) scale(${transform[2]})`}>
          <path
            d={path}
            fill="none"
            stroke={isDarkMode ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)'}
            strokeWidth={3}
            strokeDasharray="8 6"
            strokeLinecap="round"
            className="nexflow-connection-drag-path"
          />
        </g>
      </svg>
    </Panel>
  );
});

interface FlowContentProps {
  nodes: Node[];
  edges: Edge[];
  selectedEdgeId?: string | null;
  edgeDeleteModeId?: string | null;
  onEdgeDeleteRequest?: (edgeId: string) => void;
  onNodesChange: any;
  onEdgesChange: any;
  onNodesDelete?: (nodes: Node[]) => void;
  onConnect: (params: Connection) => void;
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  onSelectionChange?: (params: { nodes: Node[]; edges: Edge[] }) => void;
  onNodeDragStart?: (event: React.MouseEvent, node: Node) => void | false;
  onNodeDrag?: (event: React.MouseEvent, node: Node) => void;
  onNodeDragStop?: (event: React.MouseEvent, node: Node) => void;
  onPaneClick: () => void;
  onDrop: (event: React.DragEvent, flowPosition: { x: number; y: number }) => void;
  onDragOver: (event: React.DragEvent) => void;
  onEdgeClick?: (event: React.MouseEvent, edge: Edge) => void;
  onEdgeCenterClick?: (edge: Edge) => void;
  nodeTypes: NodeTypes;
  /** x,y: clientX/clientY 用于菜单 fixed 定位；flowX/flowY: 画布坐标用于连接线终点与节点创建 */
  contextMenu: { x: number; y: number; flowX?: number; flowY?: number; connectFrom?: { sourceNodeId: string; sourceHandleId: string | null; handleType: string | null } } | null;
  setContextMenu: (menu: FlowContentProps['contextMenu']) => void;
  handleMenuSelect: (type: string, position: { x: number; y: number }, connectFrom?: { sourceNodeId: string; sourceHandleId: string | null; handleType: string | null }) => void;
  reactFlowWrapper: React.RefObject<HTMLDivElement>;
  isDarkMode: boolean;
  onPaneMouseDown?: (event: React.MouseEvent) => void;
  onBatchRun?: (nodeIds: string[]) => void; // 批量运行回调
  batchRunInProgress?: boolean; // 批量运行中，用于禁用按钮并显示绿色
  onSuperConnect?: (sourceNodeIds: string[], targetNodeId: string) => void; // 超级连线：多选模块输出全部接入目标
  onReverseSuperConnect?: (sourceNodeId: string, targetNodeIds: string[]) => void; // 反向：一源输出批量接入多选目标
  /** 多选视频一键拼接 */
  onJoinSelectedVideos?: (nodeIds: string[]) => void;
  videoJoinBusy?: boolean;
  /** 多选图片一键生成宫格图 */
  onCreateGridMapFromSelection?: (opts: CreateGridMapFromSelectionOpts) => void;
  lightCanvasBgColor?: string; // 光明模式画布背景色
  lightDotsColor?: string; // 光明模式波点色
  lightDotSize?: number; // 光明模式波点粗细倍率 0.5–4（50%–400%）
  /** 画布波点间距（flow 坐标） */
  canvasDotGap?: number;
  moduleComponentColor?: string; // 模块组件颜色（适用所有模块）
  edgeColor?: string; // 连接线颜色（光明/暗黑模式通用）
  characterListCollapsed?: boolean; // 角色列表是否收起
  setNodes?: (nodes: Node[] | ((nodes: Node[]) => Node[])) => void; // 用于复制粘贴
  setEdges?: (edges: Edge[] | ((edges: Edge[]) => Edge[])) => void; // 用于复制粘贴
  /** 供父组件（如 Workspace）获取画布坐标转换、fitView、鼠标位置等 */
  flowContentApiRef?: React.MutableRefObject<{
    screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number };
    getLastMousePosition: () => { x: number; y: number };
    fitView: (opts?: { duration?: number; padding?: number }) => void;
  } | null>;
  onPerformanceModeChange?: (enabled: boolean) => void;
  onOpenProjects?: () => void;
  /** 连接线样式：curve=曲线，smoothStep=直角圆角 */
  edgePathStyle?: 'curve' | 'smoothStep';
  /** 手动点击一键归位后，动画结束时回调（用于自动截取项目卡片图） */
  onFitViewComplete?: () => void;
  /** 当前工程 ID，用于截图落盘到项目 assets */
  projectId?: string;
  /** 添加角色「从画布选参考图」：为可点选的 image 模块显示悬停绿框 */
  characterAvatarPickActive?: boolean;
  /** 与 characterAvatarPickActive 配合：avatar / view=高亮 image，voice=高亮可选取参考音的节点 */
  characterCanvasPickTarget?: 'avatar' | 'voice' | 'view' | 'sceneNormal' | 'sceneDisplay3d' | 'digitalHumanVideo';
  /** Ctrl+点击快速连线：已选定的源模块 id */
  quickConnectSourceId?: string | null;
}

const FlowContent: React.FC<FlowContentProps> = (props) => {
  // 防御性处理：避免某些热更新或错误调用导致 props 为 undefined
  const {
    nodes,
    edges,
    selectedEdgeId = null,
    edgeDeleteModeId = null,
    onEdgeDeleteRequest,
    onNodesChange,
    onEdgesChange,
    onNodesDelete,
    onConnect,
    onNodeClick,
    onSelectionChange,
    onNodeDragStart,
    onNodeDrag,
    onNodeDragStop,
    onPaneClick,
    onDrop,
    onDragOver,
    onEdgeClick,
    onEdgeCenterClick,
    nodeTypes,
    contextMenu,
    setContextMenu,
    handleMenuSelect,
    reactFlowWrapper,
    isDarkMode,
    onPaneMouseDown: externalOnPaneMouseDown,
    onBatchRun,
    batchRunInProgress = false,
    onSuperConnect,
    onReverseSuperConnect,
    onJoinSelectedVideos,
    videoJoinBusy = false,
    onCreateGridMapFromSelection,
    lightCanvasBgColor = '#E5E7EB',
    lightDotsColor = '#000000',
    lightDotSize = 2,
    canvasDotGap = DOT_GAP_DEFAULT,
    moduleComponentColor,
    edgeColor = '#9CA3AF',
    characterListCollapsed = true, // 默认收起
    setNodes: externalSetNodes,
    setEdges: externalSetEdges,
    flowContentApiRef,
    onPerformanceModeChange,
    onOpenProjects,
    edgePathStyle = 'curve',
    onFitViewComplete,
    projectId,
    characterAvatarPickActive = false,
    characterCanvasPickTarget = 'avatar',
    quickConnectSourceId = null,
  } = props || ({} as FlowContentProps);
  const { locale } = useAppLocale();
  const { showAlert } = useDarkAlert();
  const [characterAvatarPickHoverNodeId, setCharacterAvatarPickHoverNodeId] = useState<string | null>(null);
  const [quickConnectHoverNodeId, setQuickConnectHoverNodeId] = useState<string | null>(null);
  const [quickConnectHoverClient, setQuickConnectHoverClient] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!characterAvatarPickActive) setCharacterAvatarPickHoverNodeId(null);
  }, [characterAvatarPickActive, characterCanvasPickTarget]);
  useEffect(() => {
    if (!quickConnectSourceId) {
      setQuickConnectHoverNodeId(null);
      setQuickConnectHoverClient(null);
    }
  }, [quickConnectSourceId]);
  const [screenshotSnipping, setScreenshotSnipping] = useState(false);
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onScreenshotSnipActive) return () => {};
    return api.onScreenshotSnipActive(({ active }) => setScreenshotSnipping(Boolean(active)));
  }, []);
  const emptyCanvas = useMemo(() => flowEmptyCanvasT(locale), [locale]);
  const shortcutsT = useMemo(() => canvasShortcutsT(locale), [locale]);
  const [shortcutsPanelOpen, setShortcutsPanelOpen] = useState(false);
  const startCanvasScreenshot = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.startScreenshotSnip) {
      showAlert(
        '截图功能不可用：请执行 npm run build:main（已包含 preload 编译）后重启应用；若仍无效请查看主进程控制台 [screenSnip] 日志。',
      );
      return;
    }
    try {
      await api.startScreenshotSnip(projectId);
    } catch (e) {
      console.error('[FlowContent] 截图启动失败:', e);
      showAlert(e instanceof Error ? e.message : String(e));
    }
  }, [projectId, showAlert]);
  const { cloudMap } = useNxModelPricing();
  const { screenToFlowPosition, flowToScreenPosition, getNodes, fitView, setViewport, getViewport, setCenter, setNodes: reactFlowSetNodes, setEdges: reactFlowSetEdges } = useReactFlow();
  useEffect(() => {
    if (!quickConnectSourceId) return;
    let raf = 0;
    let lastX = 0;
    let lastY = 0;
    const onMove = (e: MouseEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setQuickConnectHoverClient({ x: lastX, y: lastY });
      });
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [quickConnectSourceId]);
  const storeApi = useStoreApi();
  const isPanOrZoomingRef = useRef(false);
  /** 避免平移时每帧重复写 --rf-zoom*；仅 zoom 变化时更新 */
  const lastRfZoomCssRef = useRef(0);
  const [isPanOrZooming, setIsPanOrZooming] = useState(false);
  // 注意：禁止用 state 回写 ref。MoveStart 先置 ref=true，若中途因 setGlobalInteracting
  // 触发重渲染而把 ref 同步回 false，transform 防抖会失效，导致每帧重渲染 FlowContent。
  const setPanOrZooming = useCallback((next: boolean) => {
    isPanOrZoomingRef.current = next;
    const host = reactFlowWrapper.current;
    if (host) {
      // 挂在外层 wrapper：CSS `.react-flow-wrapper--interacting …` 立即生效，不依赖本次 setState 提交
      host.classList.toggle('react-flow-wrapper--interacting', next);
      host.querySelector('.nexflow-canvas-stack')?.classList.toggle('react-flow-wrapper--interacting', next);
    }
    setIsPanOrZooming((prev) => (prev === next ? prev : next));
  }, [reactFlowWrapper]);
  const viewportWidth = useStore((s) => s.width ?? 800);
  const viewportHeight = useStore((s) => s.height ?? 600);
  const hasPlayingAudioNodes = useHasPlayingAudioNodes();
  const zoom = useStore(
    (s) => s.transform?.[2] ?? 1,
    (prev, next) => (isPanOrZoomingRef.current ? true : prev === next),
  );
  const connectionNodeId = useStore((s) => s.connectionNodeId);
  const connectionPosition = useStore((s) => s.connectionPosition);
  const connectionHandleId = useStore((s) => s.connectionHandleId);
  const transform = useStore(
    (s) => s.transform ?? [0, 0, 1],
    (prev, next) =>
      isPanOrZoomingRef.current
        ? true
        : prev[0] === next[0] && prev[1] === next[1] && prev[2] === next[2],
  );

  /** 画布引擎：脱离 React 的 transform 矩阵，Pan/Zoom 仅更新此处，不触发状态 */
  const canvasEngineRef = useRef<CanvasEngine | null>(null);
  if (!canvasEngineRef.current) canvasEngineRef.current = new CanvasEngine();
  const canvasEngine = canvasEngineRef.current;
  const getLiveCanvasTransform = useCallback((): [number, number, number] => {
    const t = storeApi.getState().transform ?? [0, 0, 1];
    return [t[0], t[1], t[2]];
  }, [storeApi]);
  const isInteracting = useGlobalInteractionSelector((s) => s.isInteracting);

  /** fitView 动画期间为 true，避免 sync 的 zoom 步进覆盖 viewport 导致每次只动一点 */
  const isFitViewAnimatingRef = useRef(false);
  /** 订阅 React Flow store，将 transform 同步到 CanvasEngine；静止时再按 1% 步进对齐 zoom */
  useEffect(() => {
    const ZOOM_STEP = 0.01;
    const sync = () => {
      const t = storeApi.getState().transform ?? [0, 0, 1];
      // 连线 Canvas 必须与 .react-flow__viewport 矩阵实时一致（ComfyUI 同帧 draw）
      canvasEngine.setTransform(t[0], t[1], t[2]);

      // 选框：与 AI Canvas 一样只写 :root 的 --rf-zoom-inv；zoom 未变时跳过，减少缩放抖动
      const z = Math.max(0.1, t[2] || 1);
      if (Math.abs(z - lastRfZoomCssRef.current) > 0.00005) {
        lastRfZoomCssRef.current = z;
        const rootStyle = document.documentElement.style;
        rootStyle.setProperty('--rf-zoom', String(z));
        rootStyle.setProperty('--rf-zoom-inv', String(1 / z));
      }

      if (isFitViewAnimatingRef.current) return;
      // 平移/滚轮缩放期间不做步进 snap，避免 setViewport 与实时矩阵争抢导致连线滞后
      if (isPanOrZoomingRef.current) return;

      const currentZoom = t[2];
      const snappedZoom = Math.max(0.1, Math.min(1, Math.round(currentZoom / ZOOM_STEP) * ZOOM_STEP));
      if (Math.abs(currentZoom - snappedZoom) > 0.0001) {
        setViewport({ x: t[0], y: t[1], zoom: snappedZoom });
      }
    };
    sync();
    return storeApi.subscribe(sync);
  }, [storeApi, canvasEngine, setViewport, reactFlowWrapper]);

  // 零闪烁：同步视口快照到 VideoNode，仅非交互时更新，交互期间冻结
  useEffect(() => {
    if (isInteracting) return;
    const [vx, vy, z] = transform ?? [0, 0, 1];
    setVideoViewportSnapshot(vx, vy, z);
  }, [transform, isInteracting]);
  
  // 使用外部传入的 setNodes 和 setEdges，如果没有则使用 React Flow 内部的
  const setNodes = externalSetNodes || reactFlowSetNodes;
  const setEdges = externalSetEdges || reactFlowSetEdges;
  
  // 保存 ReactFlow 实例引用，用于调用 fitView
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  // 跟踪是否已经执行过初始 fitView
  const hasInitialFitViewRef = useRef(false);
  const nodesRef = useRef<Node[]>(nodes);
  nodesRef.current = nodes;
  // 小地图容器 ref，用于点击时换算画布坐标
  const minimapContainerRef = useRef<HTMLDivElement>(null);
  // 拖线到空白处时暂存 source，用于弹出菜单后创建节点并自动连边
  const pendingConnectRef = useRef<{ sourceNodeId: string; sourceHandleId: string | null; handleType: string | null } | null>(null);
  const interactionVelocityRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const moveStartViewportRef = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const hasActivatedMoveInteractionRef = useRef(false);
  const hasActivatedNodeDragInteractionRef = useRef(false);
  const edgeCanvasRef = useRef<EdgeCanvasLayerHandle | null>(null);
  const edgePositionOverridesRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const activeDraggingNodeIdRef = useRef<string | null>(null);
  const interactionRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visualUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visualLockTokenRef = useRef(0);
  // PlusHandle 磁吸：仅记录最新指针位置，在 rAF 中批量刷新 CSS 变量
  const magneticRafRef = useRef<number | null>(null);
  const magneticPointerRef = useRef<{ x: number; y: number } | null>(null);
  const lastDotHighlightAtRef = useRef(0);

  // 使用 ref 存储上一次的选中节点 ID，避免不必要的更新
  const prevSelectedNodeIdsRef = useRef<string>('');
  
  // 获取选中的节点 ID 数组（使用 React Flow 的 store，但只提取 ID）
  const selectedNodeIds = useStore((store) => {
    if (store.nodeInternals.size === 0) return '';
    const ids = Array.from(store.nodeInternals.values())
      .filter((node) => node.selected)
      .map((node) => node.id)
      .sort()
      .join(',');
    return ids;
  });
  
  // 使用 state 存储选中的可运行节点（只在 ID 变化时更新）
  const [selectedRunnableNodes, setSelectedRunnableNodes] = useState<Node[]>([]);
  
  // 隔离选中状态监听：只在节点 ID 变化时更新
  useEffect(() => {
    // 对比新旧 ID 列表是否一致
    if (prevSelectedNodeIdsRef.current === selectedNodeIds) {
      return; // ID 列表未变化，不更新
    }
    
    prevSelectedNodeIdsRef.current = selectedNodeIds;
    
    // 如果 ID 列表为空，清空选中节点
    if (!selectedNodeIds) {
      setSelectedRunnableNodes([]);
      return;
    }
    
    // 从 nodes 中筛选出可运行的节点
    const runnableNodes = nodes.filter((node) => {
      const nodeType = node.type;
      const isRunnable =
        nodeType === 'video' || nodeType === 'wanAnimate' || nodeType === 'heyGem' || nodeType === 'image' || nodeType === 'llm' || nodeType === 'audio';
      if (!isRunnable) {
        return false;
      }
      
      // 检查节点是否在选中的 ID 列表中
      const isSelected = selectedNodeIds.split(',').includes(node.id);
      return isSelected;
    });
    
    // 只有当节点数量 >= 2 时才更新
    if (runnableNodes.length >= 2) {
      setSelectedRunnableNodes(runnableNodes);
    } else {
      setSelectedRunnableNodes([]);
    }
  }, [selectedNodeIds, nodes]);
  
  // 计算节点 ID 字符串（用于依赖项比较）
  // 使用 selectedNodeIds 作为依赖，因为它已经是稳定的字符串
  const selectedNodeIdsString = useMemo(() => {
    if (selectedRunnableNodes.length === 0) return '';
    return selectedRunnableNodes.map((n) => n.id).sort().join(',');
  }, [selectedRunnableNodes.length, selectedNodeIds]);
  
  // 所有选中的节点（用于超级连线）
  const selectedNodes = useMemo(() => {
    if (!selectedNodeIds) return [];
    const ids = new Set(selectedNodeIds.split(',').filter(Boolean));
    return nodes.filter((n) => ids.has(n.id));
  }, [selectedNodeIds, nodes]);

  /** 框选中的可导入宫格图的图片模块（全部选中项须为 image 且有图），已按阅读顺序排序 */
  const selectedJoinableImages = useMemo(() => {
    if (selectedNodes.length < 2) return [];
    if (!selectedNodes.every((n) => n.type === 'image')) return [];
    const withUrl = selectedNodes.filter((n) =>
      !!resolveImageUrlFromNodeForPhotoCollage(n.data as Record<string, unknown>),
    );
    if (withUrl.length < 2 || withUrl.length !== selectedNodes.length) return [];
    return sortNodesByReadingOrder(withUrl);
  }, [selectedNodes]);

  const gridMapFromSelectionButtonPosition = useMemo(() => {
    if (selectedJoinableImages.length < 2) return null;
    try {
      const bounds = getNodesBounds(selectedJoinableImages);
      if (!bounds || !reactFlowInstanceRef.current || !reactFlowWrapper.current) return null;
      const viewport = reactFlowInstanceRef.current.getViewport();
      const wrapperBounds = reactFlowWrapper.current.getBoundingClientRect();
      const z = Math.max(0.1, viewport.zoom);
      const screenX = bounds.x * z + viewport.x;
      const screenY = bounds.y * z + viewport.y;
      const screenWidth = bounds.width * z;
      const offsetPx = Math.max(16, 28 * z);
      return {
        x: screenX + screenWidth / 2 - wrapperBounds.left,
        y: screenY - offsetPx - wrapperBounds.top,
      };
    } catch {
      return null;
    }
  }, [selectedJoinableImages, reactFlowWrapper, transform]);

  /** 框选中的可拼接视频模块（全部选中项须为视频且可播），已按从上到下、从左到右排序 */
  const selectedJoinableVideos = useMemo(() => {
    if (selectedNodes.length < 2) return [];
    if (!selectedNodes.every((n) => isTimelineVideoSourceNodeType(n.type))) return [];
    const withMedia = selectedNodes.filter((n) => {
      const m = resolveTimelineMediaFromSource(n);
      return !!m?.url && m.clipType === 'video';
    });
    if (withMedia.length < 2 || withMedia.length !== selectedNodes.length) return [];
    return sortNodesByReadingOrder(withMedia);
  }, [selectedNodes]);

  const videoJoinButtonPosition = useMemo(() => {
    if (selectedJoinableVideos.length < 2) return null;
    try {
      const bounds = getNodesBounds(selectedJoinableVideos);
      if (!bounds || !reactFlowInstanceRef.current || !reactFlowWrapper.current) return null;
      const viewport = reactFlowInstanceRef.current.getViewport();
      const wrapperBounds = reactFlowWrapper.current.getBoundingClientRect();
      const z = Math.max(0.1, viewport.zoom);
      const screenX = bounds.x * z + viewport.x;
      const screenY = bounds.y * z + viewport.y;
      const screenWidth = bounds.width * z;
      const offsetPx = Math.max(16, 28 * z);
      return {
        x: screenX + screenWidth / 2 - wrapperBounds.left,
        y: screenY - offsetPx - wrapperBounds.top,
      };
    } catch {
      return null;
    }
  }, [selectedJoinableVideos, reactFlowWrapper, transform]);

  // 超级连线按钮位置：选中框右侧框外 3 格、垂直居中；offset 用 flow 格距 * zoom 保证缩放时相对位置不变
  const superConnectButtonPosition = useMemo(() => {
    if (selectedNodes.length < 2) return null;
    try {
      const bounds = getNodesBounds(selectedNodes);
      if (!bounds || !reactFlowInstanceRef.current || !reactFlowWrapper.current) return null;
      const viewport = reactFlowInstanceRef.current.getViewport();
      const wrapperBounds = reactFlowWrapper.current.getBoundingClientRect();
      const z = Math.max(0.1, viewport.zoom);
      const screenX = bounds.x * z + viewport.x;
      const screenY = bounds.y * z + viewport.y;
      const screenWidth = bounds.width * z;
      const screenHeight = bounds.height * z;
      const gapFlow = Math.max(DOT_GAP_MIN, Math.min(DOT_GAP_MAX, canvasDotGap || DOT_GAP_DEFAULT));
      const offsetPx = 3 * gapFlow * z;
      return {
        x: screenX + screenWidth + offsetPx - wrapperBounds.left,
        y: screenY + screenHeight / 2 - wrapperBounds.top,
      };
    } catch {
      return null;
    }
  }, [selectedNodes, reactFlowWrapper, transform, canvasDotGap]);

  // 反向超级连线：选区左侧框外（与右侧对称）
  const superReverseConnectButtonPosition = useMemo(() => {
    if (selectedNodes.length < 2) return null;
    try {
      const bounds = getNodesBounds(selectedNodes);
      if (!bounds || !reactFlowInstanceRef.current || !reactFlowWrapper.current) return null;
      const viewport = reactFlowInstanceRef.current.getViewport();
      const wrapperBounds = reactFlowWrapper.current.getBoundingClientRect();
      const z = Math.max(0.1, viewport.zoom);
      const screenX = bounds.x * z + viewport.x;
      const screenY = bounds.y * z + viewport.y;
      const screenHeight = bounds.height * z;
      const gapFlow = Math.max(DOT_GAP_MIN, Math.min(DOT_GAP_MAX, canvasDotGap || DOT_GAP_DEFAULT));
      const offsetPx = 3 * gapFlow * z;
      return {
        x: screenX - offsetPx - wrapperBounds.left,
        y: screenY + screenHeight / 2 - wrapperBounds.top,
      };
    } catch {
      return null;
    }
  }, [selectedNodes, reactFlowWrapper, transform, canvasDotGap]);

  // 计算批量运行按钮位置（选区右上角外侧约 20px）
  // 只依赖节点 ID 字符串，避免循环更新
  const batchRunButtonPosition = useMemo(() => {
    if (selectedRunnableNodes.length < 2) {
      return null;
    }
    
    try {
      // 使用新的 getNodesBounds API（替代已弃用的 getRectOfNodes）
      const bounds = getNodesBounds(selectedRunnableNodes);
      if (!bounds) {
        return null;
      }
      
      // 获取 React Flow 实例用于坐标转换
      const reactFlowInstance = reactFlowInstanceRef.current;
      if (!reactFlowInstance) {
        return null;
      }
      
      const wrapperBounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!wrapperBounds) {
        return null;
      }
      
      // 获取 viewport 信息
      const viewport = reactFlowInstance.getViewport();
      
      // 将 flow 坐标转换为屏幕坐标
      const screenX = bounds.x * viewport.zoom + viewport.x;
      const screenY = bounds.y * viewport.zoom + viewport.y;
      const screenWidth = bounds.width * viewport.zoom;
      
      // 计算按钮位置：选区右上角外侧约 20px
      const x = screenX + screenWidth + 20;
      const y = screenY - 20; // 稍微向上偏移
      
      const position = {
        x: x - wrapperBounds.left,
        y: y - wrapperBounds.top,
      };
      
      return position;
    } catch (error) {
      console.error('[FlowContent] 计算批量运行按钮位置失败:', error);
      return null;
    }
    // 只依赖节点 ID 字符串，而不是整个节点对象数组
  }, [selectedNodeIdsString, selectedRunnableNodes, reactFlowWrapper]);
  
  // 批量运行处理函数（使用节点 ID 字符串作为依赖，避免循环更新）
  const handleBatchRun = useCallback(() => {
    if (!onBatchRun || selectedRunnableNodes.length === 0) {
      return;
    }
    
    const nodeIds = selectedRunnableNodes.map((node) => node.id);
    onBatchRun(nodeIds);
  }, [onBatchRun, selectedRunnableNodes.length]);
  
  // 计算批量运行总价（仅图片/视频节点有定价）
  const totalPrice = useMemo(() => {
    let sum = 0;
    let hasAny = false;
    for (const node of selectedRunnableNodes) {
      const p = getNodeDisplayPrice(node.type || '', node.data as Record<string, unknown> | undefined, cloudMap);
      if (p !== null) {
        sum += p;
        hasAny = true;
      }
    }
    return hasAny ? sum : null;
  }, [selectedNodeIdsString, selectedRunnableNodes, cloudMap]);

  // 中心聚焦：一键归位默认 800ms；裁剪等局部对焦默认约 320ms（跟手、少等待）
  const FIT_VIEW_DURATION = 800;
  const CROP_FOCUS_DURATION = 320;
  const centerNodes = useCallback((
    targetNodes: Node[] = nodes,
    opts?: { duration?: number; padding?: number },
  ) => {
    if (!reactFlowInstanceRef.current || targetNodes.length === 0) {
      return;
    }
    const duration =
      typeof opts?.duration === 'number' && opts.duration >= 0 ? opts.duration : FIT_VIEW_DURATION;
    const padding =
      typeof opts?.padding === 'number' && opts.padding >= 0 ? opts.padding : 0.2;
    isFitViewAnimatingRef.current = true;
    // 传入完整 nodes，避免断头台过滤时只拟合可见节点；fitView 根据传入节点计算边界
    reactFlowInstanceRef.current.fitView({
      nodes: targetNodes,
      padding,
      includeHiddenNodes: false,
      duration,
    });
    setTimeout(() => {
      isFitViewAnimatingRef.current = false;
    }, duration + 50); // 略长于动画，确保结束后才恢复 zoom 步进
  }, [nodes]);
  
  // 一键归位按钮点击处理；动画结束后触发 onFitViewComplete（用于自动截取项目卡片图）
  const handleFitView = useCallback(() => {
    centerNodes();
    setTimeout(() => {
      onFitViewComplete?.();
    }, FIT_VIEW_DURATION + 50);
  }, [centerNodes, onFitViewComplete]);

  const centerNodesRef = useRef(centerNodes);
  centerNodesRef.current = centerNodes;

  /**
   * 供节点内操作（如图片/视频裁剪放大）请求平滑对焦：
   * detail.nodes: [{ id, width?, height? }] — 可带放大后尺寸，避免仍按旧小框取景
   * detail.duration / padding 可选；未传 duration 时用裁剪对焦默认 320ms
   *
   * 注意：React Flow 的 fitView({ nodes }) 只用 id 过滤，会忽略传入的 width/height，
   * 仍按 store 里旧尺寸取景。裁剪放大后必须用 getNodesBounds + fitBounds 才能真正居中。
   */
  useEffect(() => {
    const onFocusNodes = (ev: Event) => {
      const detail = (ev as CustomEvent<{
        nodes?: Array<{ id: string; width?: number; height?: number }>;
        duration?: number;
        padding?: number;
      }>).detail;
      const specs = detail?.nodes;
      const rf = reactFlowInstanceRef.current;
      if (!specs?.length || !rf) return;
      const all = getNodes();
      const targetNodes: Node[] = [];
      let hasExplicitSize = false;
      for (const spec of specs) {
        const n = all.find((x) => x.id === spec.id);
        if (!n) continue;
        const w =
          typeof spec.width === 'number' && spec.width > 0
            ? spec.width
            : Number(n.width) || Number((n.style as { width?: number } | undefined)?.width) || undefined;
        const h =
          typeof spec.height === 'number' && spec.height > 0
            ? spec.height
            : Number(n.height) || Number((n.style as { height?: number } | undefined)?.height) || undefined;
        if (typeof spec.width === 'number' && spec.width > 0 && typeof spec.height === 'number' && spec.height > 0) {
          hasExplicitSize = true;
        }
        targetNodes.push({
          ...n,
          ...(w != null ? { width: w } : {}),
          ...(h != null ? { height: h } : {}),
          style: {
            ...(n.style as object),
            ...(w != null ? { width: w } : {}),
            ...(h != null ? { height: h } : {}),
          },
        });
      }
      if (targetNodes.length === 0) return;
      const duration =
        typeof detail?.duration === 'number' && detail.duration >= 0
          ? detail.duration
          : CROP_FOCUS_DURATION;
      const padding =
        typeof detail?.padding === 'number' && detail.padding >= 0 ? detail.padding : 0.2;

      // 带显式放大尺寸时走 fitBounds，保证目标模块落在视口正中心
      if (hasExplicitSize && typeof rf.fitBounds === 'function') {
        try {
          const bounds = getNodesBounds(targetNodes);
          const bx = Number(bounds?.x);
          const by = Number(bounds?.y);
          const bw = Number(bounds?.width);
          const bh = Number(bounds?.height);
          const boundsOk =
            Number.isFinite(bx) &&
            Number.isFinite(by) &&
            Number.isFinite(bw) &&
            Number.isFinite(bh) &&
            bw > 1 &&
            bh > 1;
          if (boundsOk) {
            isFitViewAnimatingRef.current = true;
            rf.fitBounds(
              { x: bx, y: by, width: bw, height: bh },
              { padding, duration },
            );
            window.setTimeout(() => {
              isFitViewAnimatingRef.current = false;
            }, duration + 50);
            return;
          }
        } catch (err) {
          console.warn('[FlowContent] fitBounds skipped (invalid bounds)', err);
        }
      }
      try {
        centerNodesRef.current(targetNodes, { duration, padding });
      } catch (err) {
        console.warn('[FlowContent] centerNodes failed', err);
      }
    };
    window.addEventListener('nexflow-canvas-focus-nodes', onFocusNodes as EventListener);
    return () => window.removeEventListener('nexflow-canvas-focus-nodes', onFocusNodes as EventListener);
  }, [getNodes]);

  // 配置边的样式：拖动时虚线，连接后实线（无箭头）
  const edgeTypes = useMemo<EdgeTypes>(() => ({
    animatedGradient: AnimatedGradientEdge,
    frozenBezier: FrozenBezierEdge,
    frozenSmoothStep: FrozenSmoothStepEdge,
    splitRibbon: SplitRibbonEdge,
  }), []);

  // 执行中的节点 ID：仅这些节点的输入连接线才有流光动画
  const executingNodeIds = useMemo(() => {
    return new Set(
      nodes
        .filter((n) => {
          const progress = Number(n.data?.progress);
          const aiStatus = n.data?.aiStatus;
          return (
            (typeof progress === 'number' && progress > 0 && progress < 100) ||
            aiStatus === 'START' ||
            aiStatus === 'PROCESSING'
          );
        })
        .map((n) => n.id)
    );
  }, [nodes]);
  /** TapNow / RH 无限画布：默认 SVG 边；auto 时超大工程才用 Canvas */
  const useEdgeCanvasForDensity =
    PERF_POLICY.edgeRenderMode === 'auto' &&
    (nodes.length > PERF_POLICY.edgeCanvasSwitchNodeCount ||
      edges.length > PERF_POLICY.edgeCanvasSwitchEdgeCount);

  /** 由 native sync 统一驱动边画布，不跑独立 RAF */
  const useNativeSyncDriven =
    useEdgeCanvasForDensity && nodes.length >= PERF_POLICY.nativePositionSyncNodeCount;

  const renderedEdges = useMemo(
    () => {
      if (useEdgeCanvasForDensity) return [];
      return (
      edges.map((edge) => {
        const isTaskEdgeAnimating = executingNodeIds.has(edge.target);
        const isManualSelected = edge.id === selectedEdgeId;
        const isFromTextSplit =
          (edge.sourceHandle === 'output-null' || (edge.sourceHandle && String(edge.sourceHandle).startsWith('output-'))) &&
          nodes.some((n) => n.id === edge.source && n.type === 'textSplit');
        const cleanClassName = (edge.className || '')
          .split(/\s+/)
          .filter((cls) => cls && cls !== 'rf-edge-gradient' && cls !== 'manual-edge-selected')
          .join(' ');
        const baseClassName = [
          cleanClassName,
          isManualSelected ? 'manual-edge-selected' : '',
        ].filter(Boolean).join(' ');

        const showScissors = edge.id === edgeDeleteModeId && !!onEdgeDeleteRequest;
        const edgeData = {
          ...edge.data,
          showScissors,
          onDelete: showScissors ? () => onEdgeDeleteRequest(edge.id) : undefined,
          isSelected: isManualSelected,
          onCenterClick: isManualSelected && !showScissors && onEdgeCenterClick ? () => onEdgeCenterClick(edge) : undefined,
        };

        // TextSplit 也遵守档位：curve=曲线，smoothStep=直角（TextSplit 用 splitRibbon 排线）
        const baseType = edgePathStyle === 'smoothStep' ? 'frozenSmoothStep' : 'frozenBezier';
        const textSplitType = edgePathStyle === 'smoothStep' ? 'splitRibbon' : 'frozenBezier';
        const animType = edgePathStyle === 'smoothStep' ? 'frozenSmoothStep' : 'animatedGradient';
        const textSplitAnimType = edgePathStyle === 'smoothStep' ? 'splitRibbon' : 'animatedGradient';
        if (!isTaskEdgeAnimating) {
          return {
            ...edge,
            selected: false,
            type: isFromTextSplit ? textSplitType : baseType,
            className: baseClassName || undefined,
            data: edgeData,
          };
        }

        return {
          ...edge,
          selected: isManualSelected,
          type: isFromTextSplit ? textSplitAnimType : animType,
          className: isFromTextSplit ? baseClassName || undefined : `${baseClassName ? `${baseClassName} ` : ''}rf-edge-gradient`,
          data: isFromTextSplit ? edgeData : { ...edgeData, animated: true, isDarkMode },
        };
      })
      );
    },
    [edges, nodes, executingNodeIds, isDarkMode, selectedEdgeId, edgeDeleteModeId, onEdgeDeleteRequest, onEdgeCenterClick, useEdgeCanvasForDensity, edgePathStyle]
  );

  const canvasEdges = useMemo(
    () => edges.map((edge) => ({ ...edge, selected: edge.id === selectedEdgeId })),
    [edges, selectedEdgeId]
  );

  const isGlobalInteracting = useGlobalInteractionSelector((s) => s.isGlobalInteracting);

  const [viewportSize, setViewportSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const el = reactFlowWrapper.current;
    if (!el) return;
    const updateSize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setViewportSize({ width: w, height: h });
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [reactFlowWrapper]);

  /** 连线拖拽高亮等样式；完整 nodes 始终交给 ReactFlow（勿裁切，避免误删落盘） */
  const renderedNodes = useMemo(() => {
    const [tx, ty, tz] = transform;
    let base: Node[] = nodes;

    if (connectionNodeId && connectionPosition && nodes.length) {
      const sourceNode = base.find((n) => n.id === connectionNodeId);
      if (sourceNode) {
        const flowX = (connectionPosition.x - tx) / tz;
        const flowY = (connectionPosition.y - ty) / tz;
        const w = (n: Node) => (Number(n.data?.width) || 300);
        const h = (n: Node) => (Number(n.data?.height) || 200);
        const contains = (n: Node) => {
          const x = n.position.x;
          const y = n.position.y;
          return flowX >= x && flowX <= x + w(n) && flowY >= y && flowY <= y + h(n);
        };
        const atPosition = base.filter(contains);
        const targetNode = atPosition.length > 0 ? atPosition[atPosition.length - 1] : null;
        if (
          targetNode &&
          targetNode.id !== connectionNodeId &&
          !isConnectionAllowed(
            sourceNode.type ?? '',
            targetNode.type ?? '',
            connectionHandleId ?? null,
            null
          )
        ) {
          base = base.map((n) =>
            n.id === targetNode.id
              ? { ...n, className: `${n.className || ''} connection-invalid-target`.trim() }
              : n
          );
        }
      }
    }

    if (characterAvatarPickActive) {
      base = base.map((n) => {
        const pickable = isNodePickableForCanvasTarget(n, characterCanvasPickTarget);
        const isHover = n.id === characterAvatarPickHoverNodeId;
        const prevClass = stripCanvasPickNodeClasses(n.className);

        if (!pickable) {
          return {
            ...n,
            className: [prevClass, 'canvas-pick-muted'].filter(Boolean).join(' '),
          };
        }

        return {
          ...n,
          className: [prevClass, 'canvas-pick-target', isHover ? 'canvas-pick-target--hover' : '']
            .filter(Boolean)
            .join(' '),
        };
      });
    }

    if (quickConnectSourceId) {
      const sourceNode = base.find((n) => n.id === quickConnectSourceId);
      const sourceType = sourceNode?.type ?? '';
      base = base.map((n) => {
        const prevClass = stripCanvasPickNodeClasses(n.className);
        if (n.id === quickConnectSourceId) {
          return {
            ...n,
            className: [prevClass, 'quick-connect-source'].filter(Boolean).join(' '),
          };
        }
        if (n.id !== quickConnectHoverNodeId) {
          return {
            ...n,
            className: prevClass || undefined,
          };
        }
        const targetType = n.type ?? '';
        const ok =
          !!sourceType &&
          !!targetType &&
          isConnectionAllowed(sourceType, targetType) &&
          !(targetType === 'videoSplice' && !isTimelineMediaSourceNodeType(sourceType));
        return {
          ...n,
          className: [prevClass, ok ? 'quick-connect-target--ok' : 'quick-connect-target--bad']
            .filter(Boolean)
            .join(' '),
        };
      });
    }

    // 不向 ReactFlow 传入裁切后的 nodes：断头台 + 受控 onNodesChange 曾导致屏外节点被误删并落盘。
    // 性能由 onlyRenderVisibleElements 与 EdgeCanvas 密度策略承担；
    // 有音频播放时关闭视口外卸载，避免 AudioNode 与 <audio> 被销毁。
    return base;
  }, [
    nodes,
    edges,
    connectionNodeId,
    connectionPosition,
    connectionHandleId,
    transform,
    characterAvatarPickActive,
    characterCanvasPickTarget,
    characterAvatarPickHoverNodeId,
    quickConnectSourceId,
    quickConnectHoverNodeId,
    executingNodeIds,
  ]);

  const quickConnectHoverHint = useMemo(() => {
    if (!quickConnectSourceId || !quickConnectHoverNodeId) return null;
    const sourceNode = nodes.find((n) => n.id === quickConnectSourceId);
    const targetNode = nodes.find((n) => n.id === quickConnectHoverNodeId);
    const sourceType = sourceNode?.type ?? '';
    const targetType = targetNode?.type ?? '';
    const ok =
      !!sourceType &&
      !!targetType &&
      isConnectionAllowed(sourceType, targetType) &&
      !(targetType === 'videoSplice' && !isTimelineMediaSourceNodeType(sourceType));
    return {
      ok,
      text:
        locale === 'en'
          ? ok
            ? 'Connect to this module'
            : 'Cannot connect'
          : ok
            ? '接入此模块'
            : '无法连接',
    };
  }, [quickConnectSourceId, quickConnectHoverNodeId, nodes, locale]);

  const scheduleInteractionRestore = useCallback(() => {
    if (interactionRestoreTimerRef.current) {
      clearTimeout(interactionRestoreTimerRef.current);
      interactionRestoreTimerRef.current = null;
    }
    interactionRestoreTimerRef.current = setTimeout(() => {
      setGlobalInteracting(false);
      setImageLoadMaxParallel(5);
      setVideoExtractQueuePaused(false);
      window.electronAPI?.setSharpQueuePaused?.(false).catch(() => undefined);
      interactionRestoreTimerRef.current = null;
    }, ZERO_FLICKER_INTERACTION_UNLOCK_MS);
  }, []);

  const clearVisualUnlockTimer = useCallback(() => {
    if (visualUnlockTimerRef.current) {
      clearTimeout(visualUnlockTimerRef.current);
      visualUnlockTimerRef.current = null;
    }
  }, []);

  const beginVisualInteractionLock = useCallback(() => {
    visualLockTokenRef.current += 1;
    clearVisualUnlockTimer();
    setGlobalVisualLockState('interacting_locked');
  }, [clearVisualUnlockTimer]);

  const scheduleVisualInteractionUnlock = useCallback(() => {
    visualLockTokenRef.current += 1;
    const currentToken = visualLockTokenRef.current;
    clearVisualUnlockTimer();
    setGlobalVisualLockState('cooldown');
    visualUnlockTimerRef.current = setTimeout(() => {
      if (visualLockTokenRef.current !== currentToken) return;
      setGlobalVisualLockState('unlocked');
      visualUnlockTimerRef.current = null;
    }, ZERO_FLICKER_INTERACTION_UNLOCK_MS);
  }, [clearVisualUnlockTimer]);

  // 原生位置同步：apply 前触发边重绘（顺序：更新 Map -> 本回调 -> 写 DOM），确保同源同步
  useEffect(() => {
    setOnAfterPositionApply(() => {
      edgeCanvasRef.current?.redraw(activeDraggingNodeIdRef.current ?? undefined);
    });
    return () => setOnAfterPositionApply(null);
  }, []);

  /* transform 已由 store 订阅同步到 CanvasEngine，RAF 循环每帧读取，无需依赖 React 的 transform 触发重绘 */

  const defaultEdgeOptions = useMemo(() => ({
    type: edgePathStyle === 'smoothStep' ? 'frozenSmoothStep' : 'frozenBezier',
    animated: false,
    zIndex: 0, // 连接线始终在节点下方
    style: {
      strokeWidth: 4,
      stroke: isDarkMode ? 'rgba(255, 255, 255, 0.3)' : '#9CA3AF', // 暗黑模式：半透明白色，明亮模式：浅灰色
      strokeDasharray: 'none', // 强制实线，覆盖可能存在的虚线默认样式
    },
  }), [isDarkMode, edgePathStyle]);
  
  // 节点连线兼容性：禁止不兼容的 source -> target
  const isValidConnection = useCallback(
    (params: Connection | null) => {
      if (!params?.source || !params?.target) return false;
      // 禁止节点自连：模块输出不能连接回自身输入
      if (params.source === params.target) return false;
      const sourceNode = nodes.find((n) => n.id === params!.source);
      const targetNode = nodes.find((n) => n.id === params!.target);
      if (!sourceNode || !targetNode) return false;
      if (sourceNode.type === 'character') {
        if (!isCharacterConnectionDataValid(targetNode.type ?? '', sourceNode.data as Record<string, unknown>)) {
          return false;
        }
      }
      if (sourceNode.type === 'digitalHuman') {
        if (
          !isDigitalHumanConnectionDataValid(
            targetNode.type ?? '',
            params.sourceHandle ?? null,
            sourceNode.data as Record<string, unknown>,
          )
        ) {
          return false;
        }
      }
      if (targetNode.type === 'videoSplice' && !isTimelineMediaSourceNodeType(sourceNode.type ?? '')) {
        return false;
      }
      return isConnectionAllowed(
        sourceNode.type ?? '',
        targetNode.type ?? '',
        params.sourceHandle ?? null,
        params.targetHandle ?? null
      );
    },
    [nodes]
  );

  // 处理连接创建（连接完成后，将边样式改为实线；成功连到节点时清空拖线到空白处的 pending）
  const handleConnect = useCallback((params: Connection) => {
    pendingConnectRef.current = null;
    if (onConnect) {
      onConnect(params);
      canvasEngine.requestUpdate();
      // 连接完成后，边会自动应用实线样式（通过 edgeTypes 或默认样式）
    }
  }, [onConnect, canvasEngine]);
  
  // 处理画布右键点击：点选模式则取消；否则弹出菜单
  const onPaneContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      try {
        window.getSelection()?.removeAllRanges();
      } catch {
        /* ignore */
      }
      if (characterAvatarPickActive) {
        return;
      }
      const flowPosition = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        flowX: flowPosition.x,
        flowY: flowPosition.y,
      });
    },
    [setContextMenu, screenToFlowPosition, characterAvatarPickActive]
  );

  const updateNodeInternals = useUpdateNodeInternals();

  // 从节点拖出连线开始时记录 source，并刷新 handleBounds 确保连接线起点精确
  const onConnectStart = useCallback(
    (_event: React.MouseEvent | React.TouchEvent, params: { nodeId: string | null; handleId: string | null; handleType: string | null }) => {
      if (params.nodeId) {
        updateNodeInternals(params.nodeId);
        pendingConnectRef.current = {
          sourceNodeId: params.nodeId,
          sourceHandleId: params.handleId ?? null,
          handleType: params.handleType ?? null,
        };
      } else {
        pendingConnectRef.current = null;
      }
    },
    [updateNodeInternals]
  );

  // 拖线结束且未连到有效 target 时：用 React Flow API 转为画布坐标，在松开处弹出菜单
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const pending = pendingConnectRef.current;
      if (!pending) return;
      const clientX = 'clientX' in event ? event.clientX : event.changedTouches?.[0]?.clientX ?? 0;
      const clientY = 'clientY' in event ? event.clientY : event.changedTouches?.[0]?.clientY ?? 0;
      const host = reactFlowWrapper.current;

      if (host) {
        const wantHandleType: 'source' | 'target' = pending.handleType === 'target' ? 'source' : 'target';
        const snapped = snapConnectionToPlusHandle(host, clientX, clientY, zoom, wantHandleType);
        if (snapped) {
          const connection: Connection =
            pending.handleType === 'target'
              ? {
                  source: snapped.nodeId,
                  target: pending.sourceNodeId,
                  sourceHandle: snapped.handleId,
                  targetHandle: pending.sourceHandleId ?? 'input',
                }
              : {
                  source: pending.sourceNodeId,
                  target: snapped.nodeId,
                  sourceHandle: pending.sourceHandleId ?? 'output',
                  targetHandle: snapped.handleId,
                };
          if (isValidConnection(connection)) {
            updateNodeInternals(snapped.nodeId);
            updateNodeInternals(pending.sourceNodeId);
            handleConnect(connection);
            pendingConnectRef.current = null;
            return;
          }
        }
      }

      // 左侧输入磁吸（target）拖到空白：可吸附连到其他模块输出，但不弹出「创建模块」菜单
      if (pending.handleType === 'target') {
        updateNodeInternals(pending.sourceNodeId);
        pendingConnectRef.current = null;
        return;
      }

      updateNodeInternals(pending.sourceNodeId);
      const flowPosition = screenToFlowPosition({ x: clientX, y: clientY });
      setContextMenu({
        x: clientX,
        y: clientY,
        flowX: flowPosition.x,
        flowY: flowPosition.y,
        connectFrom: pending,
      });
      pendingConnectRef.current = null;
    },
    [handleConnect, isValidConnection, reactFlowWrapper, screenToFlowPosition, setContextMenu, updateNodeInternals, zoom],
  );

  // 处理画布双击：clientX/Y 用于菜单 fixed 定位，screenToFlowPosition 用于节点创建
  const onPaneDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      if ((event.target as HTMLElement).closest('.react-flow__node')) return;
      const flowPosition = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        flowX: flowPosition.x,
        flowY: flowPosition.y,
      });
    },
    [setContextMenu, screenToFlowPosition]
  );

  // 确保容器在挂载时能正确计算尺寸
  useEffect(() => {
    // 强制触发 resize 事件，确保 React Flow 能获取正确的容器尺寸
    const handleResize = () => {
      window.dispatchEvent(new Event('resize'));
    };
    
    // 延迟执行，确保 DOM 已完全渲染
    const timer = setTimeout(handleResize, 100);
    
    return () => clearTimeout(timer);
  }, []);

  // 进入画布后自动执行一次一键归位：使用 centerNodes 确保与按钮行为一致，并受 isFitViewAnimatingRef 保护
  useEffect(() => {
    if (nodes.length > 0 && reactFlowInstanceRef.current && !hasInitialFitViewRef.current) {
      const timer = setTimeout(() => {
        if (reactFlowInstanceRef.current && !hasInitialFitViewRef.current) {
          hasInitialFitViewRef.current = true;
          centerNodes(nodes);
        }
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [nodes.length, nodes, centerNodes]);

  // 首次进入时自动激活一个可见的视频节点，使 poster 显示并可播放（避免全部灰块/加载态）
  // 使用 nodes 而非 nodeInternals，避免订阅 store 导致 setActiveVideoNodeId 触发循环更新
  const hasInitialActiveVideoSetRef = useRef(false);
  useEffect(() => {
    if (hasInitialActiveVideoSetRef.current || nodes.length === 0) return;
    const videoNodes = nodes.filter((n) => {
      if (n.type !== 'video') return false;
      const d = (n as Node).data || {};
      return !!(d.outputVideo || d.originalVideoUrl);
    });
    if (videoNodes.length === 0) return;
    const timer = setTimeout(() => {
      if (hasInitialActiveVideoSetRef.current) return;
      const snapshot = getGlobalInteractionSnapshot();
      if (snapshot.activeVideoNodeId != null || snapshot.hoveredVideoNodeId != null) return;
      try {
        const { x: vx, y: vy, zoom } = getViewport();
        const vw = (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom;
        const vh = (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom;
        const left = -vx / zoom;
        const top = -vy / zoom;
        const centerX = left + vw / 2;
        const centerY = top + vh / 2;
        let best: { id: string; dist: number } | null = null;
        for (const node of videoNodes) {
          const pos = (node as Node).position ?? { x: 0, y: 0 };
          const w = Number((node as Node).data?.width ?? 400);
          const h = Number((node as Node).data?.height ?? 300);
          const inView = !(pos.x + w < left || pos.x > left + vw || pos.y + h < top || pos.y > top + vh);
          if (!inView) continue;
          const cx = pos.x + w / 2;
          const cy = pos.y + h / 2;
          const dist = Math.hypot(cx - centerX, cy - centerY);
          if (!best || dist < best.dist) best = { id: node.id, dist };
        }
        const targetId = best?.id ?? videoNodes[0]?.id;
        if (targetId) {
          setActiveVideoNodeId(targetId);
          hasInitialActiveVideoSetRef.current = true;
        }
      } catch (_) {}
    }, 450);
    return () => clearTimeout(timer);
  }, [nodes]);

  // ReactFlow 初始化回调：进入画布后先初始化 viewport 为安全默认，并执行首次一键归位
  const onInit = useCallback((reactFlowInstance: ReactFlowInstance) => {
    reactFlowInstanceRef.current = reactFlowInstance;
    const safeViewport = { x: 0, y: 0, zoom: 1 };
    reactFlowInstance.setViewport(safeViewport);
    const ns = nodesRef.current;
    if (ns.length > 0 && !hasInitialFitViewRef.current) {
      hasInitialFitViewRef.current = true;
      setTimeout(() => centerNodesRef.current?.(ns), 250);
    }
  }, []);
  
  // 复制/剪切/粘贴状态管理
  const copiedDataRef = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const pasteOffsetRef = useRef(0); // 用于连续粘贴时的偏移
  
  // 生成唯一 ID
  const generateId = useCallback((prefix: string) => {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  /** 将当前选中节点写入内部剪贴板（两端均在选区内的边一并复制）。成功返回选中节点，否则 null。 */
  const copySelectedNodesToClipboard = useCallback((): Node[] | null => {
    const selectedNodes = nodes.filter((node) => node.selected);
    if (selectedNodes.length === 0) return null;

    const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));
    const relatedEdges = edges.filter(
      (edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target)
    );

    const clonedNodes = selectedNodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        progress: 0,
        progressMessage: undefined,
        errorMessage: undefined,
      },
    }));

    copiedDataRef.current = {
      nodes: clonedNodes,
      edges: relatedEdges.map((edge) => ({ ...edge })),
    };
    pasteOffsetRef.current = 0;
    return selectedNodes;
  }, [nodes, edges]);
  
  // 复制逻辑 (Ctrl+C / Cmd+C)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isCopy = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c';
      if (!isCopy) return;

      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const selectedNodes = copySelectedNodesToClipboard();
      if (!selectedNodes) return;
      console.log(
        `[FlowContent] 已复制 ${copiedDataRef.current?.nodes.length ?? 0} 个节点和 ${copiedDataRef.current?.edges.length ?? 0} 条连线`
      );
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [copySelectedNodesToClipboard]);

  // 剪切逻辑 (Ctrl+X / Cmd+X)：复制后删除选中节点及相连边
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isCut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x';
      if (!isCut) return;

      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const selectedNodes = copySelectedNodesToClipboard();
      if (!selectedNodes || selectedNodes.length === 0) return;

      event.preventDefault();

      const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));
      const edgesToRemove = edges.filter(
        (edge) => selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target)
      );

      // 走 React Flow change 管道，与 Delete 一致（任务同步 + 历史记录）
      onNodesChange(selectedNodes.map((node) => ({ type: 'remove', id: node.id })));
      if (edgesToRemove.length > 0) {
        onEdgesChange(edgesToRemove.map((edge) => ({ type: 'remove', id: edge.id })));
      }

      console.log(
        `[FlowContent] 已剪切 ${selectedNodes.length} 个节点和 ${edgesToRemove.length} 条连线`
      );
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [copySelectedNodesToClipboard, edges, onNodesChange, onEdgesChange]);
  
  // 粘贴逻辑 (Ctrl+V / Cmd+V)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isPaste = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v';
      
      if (isPaste && copiedDataRef.current) {
        // 检查是否在输入框中（避免粘贴文本时触发）
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
        
        event.preventDefault();
        
        const { nodes: copiedNodes, edges: copiedEdges } = copiedDataRef.current;
        
        if (copiedNodes.length === 0) {
          return;
        }
        
        // 获取鼠标当前位置（使用最后记录的鼠标位置，或画布中心）
        const reactFlowElement = reactFlowWrapper.current?.querySelector('.react-flow') as HTMLElement;
        let mousePos = { x: 0, y: 0 };
        
        if (reactFlowElement) {
          const lastMousePos = (reactFlowWrapper.current as any)?.lastMousePosition;
          if (lastMousePos) {
            mousePos = screenToFlowPosition({ x: lastMousePos.x, y: lastMousePos.y });
          } else {
            const reactFlowBounds = reactFlowElement.getBoundingClientRect();
            const centerX = reactFlowBounds.left + reactFlowBounds.width / 2;
            const centerY = reactFlowBounds.top + reactFlowBounds.height / 2;
            mousePos = screenToFlowPosition({ x: centerX, y: centerY });
          }
        }
        
        // 计算节点组的边界框和中心点
        const bounds = getNodesBounds(copiedNodes);
        if (!bounds) {
          console.warn('[FlowContent] 无法计算节点边界，使用默认位置');
          return;
        }
        
        const centerOffsetX = bounds.x + bounds.width / 2;
        const centerOffsetY = bounds.y + bounds.height / 2;
        
        // 应用连续粘贴偏移
        const offsetX = pasteOffsetRef.current * 20;
        const offsetY = pasteOffsetRef.current * 20;
        pasteOffsetRef.current += 1;
        
        // 创建 ID 映射表
        const idMap = new Map<string, string>();
        
        // 生成新节点（添加动画效果）
        const newNodes = copiedNodes.map((node) => {
          const newId = generateId(node.type || 'node');
          idMap.set(node.id, newId);
          
          const newNode = {
            ...node,
            id: newId,
            position: {
              x: mousePos.x + (node.position.x - centerOffsetX) + offsetX,
              y: mousePos.y + (node.position.y - centerOffsetY) + offsetY,
            },
            selected: true, // 自动选中新粘贴的节点
            data: {
              ...node.data,
              // 确保重置运行状态
              progress: 0,
              progressMessage: undefined,
              errorMessage: undefined,
            },
          };
          
          // 不再添加动画类名，避免点击时闪动
          // 如果需要保留粘贴动画，可以在动画完成后移除类名
          
          return newNode;
        });
        
        // 生成新连线
        const newEdges = copiedEdges.map((edge) => {
          const newId = generateId('edge');
          const newSource = idMap.get(edge.source);
          const newTarget = idMap.get(edge.target);
          
          if (!newSource || !newTarget) {
            console.warn(`[FlowContent] 无法找到节点映射: ${edge.source} -> ${edge.target}`);
            return null;
          }
          
          return {
            ...edge,
            id: newId,
            source: newSource,
            target: newTarget,
            selected: false,
          };
        }).filter((edge): edge is Edge => edge !== null);
        
        // 先取消所有节点的选中状态
        setNodes((currentNodes) =>
          currentNodes.map((node) => ({ ...node, selected: false }))
        );
        
        // 添加新节点和连线
        setNodes((currentNodes) => [...currentNodes, ...newNodes]);
        setEdges((currentEdges) => [...currentEdges, ...newEdges]);
        
        // 显示提示信息
        console.log(`[FlowContent] 已在鼠标处克隆 ${newNodes.length} 个模块`);
        
        // 简单的视觉反馈（可以使用更优雅的 toast 组件）
        const message = `已在鼠标处克隆 ${newNodes.length} 个模块`;
        // 创建一个临时的提示元素
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
          position: fixed;
          top: 20px;
          left: 50%;
          transform: translateX(-50%);
          background: ${isDarkMode ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.9)'};
          color: ${isDarkMode ? '#fff' : '#000'};
          padding: 12px 24px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          z-index: 10000;
          font-size: 14px;
          font-weight: 500;
          pointer-events: none;
          animation: fadeInZoom 0.3s ease-out;
        `;
        
        // 添加动画样式
        if (!document.getElementById('copy-paste-toast-style')) {
          const style = document.createElement('style');
          style.id = 'copy-paste-toast-style';
          style.textContent = `
            @keyframes fadeInZoom {
              from {
                opacity: 0;
                transform: translateX(-50%) scale(0.9);
              }
              to {
                opacity: 1;
                transform: translateX(-50%) scale(1);
              }
            }
          `;
          document.head.appendChild(style);
        }
        
        document.body.appendChild(toast);
        
        // 3秒后移除提示
        setTimeout(() => {
          toast.style.animation = 'fadeInZoom 0.3s ease-out reverse';
          setTimeout(() => {
            if (toast.parentNode) {
              toast.parentNode.removeChild(toast);
            }
          }, 300);
        }, 3000);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [screenToFlowPosition, getNodesBounds, generateId, setNodes, setEdges, reactFlowWrapper, isDarkMode]);
  
  const updateDotHighlightByClient = useCallback((clientX: number, clientY: number) => {
    if (!reactFlowWrapper.current) return;
    const reactFlowElement = reactFlowWrapper.current.querySelector('.react-flow') as HTMLElement | null;
    if (!reactFlowElement) return;
    const bounds = reactFlowElement.getBoundingClientRect();
    const localX = clientX - bounds.left;
    const localY = clientY - bounds.top;
    reactFlowElement.style.setProperty('--dot-mouse-x', `${localX}px`);
    reactFlowElement.style.setProperty('--dot-mouse-y', `${localY}px`);
    (reactFlowWrapper.current as any).lastMousePosition = { x: clientX, y: clientY };
  }, [reactFlowWrapper]);

  // 监听鼠标/指针移动，记录最后位置（client 坐标，用于粘贴定位与高光跟随）
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      updateDotHighlightByClient(event.clientX, event.clientY);
    };
    const handlePointerMove = (event: PointerEvent) => {
      updateDotHighlightByClient(event.clientX, event.clientY);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('pointermove', handlePointerMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('pointermove', handlePointerMove);
    };
  }, [updateDotHighlightByClient]);

  // PlusHandle 鼠标磁吸：d < 50px 时朝鼠标方向偏移（max 5px），并通过 CSS 变量驱动视觉反馈
  useEffect(() => {
    const host = reactFlowWrapper.current;
    if (!host) return;
    const safeZoom = Math.max(0.1, zoom || 1);
    // 先仅调试 Image 模块：吸附区改为“贴边半圆”，并增强位移强度
    const SHADOW_FACTOR = 0.35;

    const writeHandleVars = (el: HTMLElement, mx: number, my: number, p: number) => {
      el.style.setProperty('--magnet-x', `${mx.toFixed(2)}px`);
      el.style.setProperty('--magnet-y', `${my.toFixed(2)}px`);
      el.style.setProperty('--plus-p', `${p.toFixed(3)}`);
      el.style.setProperty('--plus-shadow-x', `${(mx * SHADOW_FACTOR).toFixed(2)}px`);
      el.style.setProperty('--plus-shadow-y', `${(my * SHADOW_FACTOR).toFixed(2)}px`);
    };

    const clearHandleVars = (el: HTMLElement) => {
      el.style.setProperty('--magnet-x', '0px');
      el.style.setProperty('--magnet-y', '0px');
      el.style.setProperty('--plus-p', '0');
      el.style.setProperty('--plus-shadow-x', '0px');
      el.style.setProperty('--plus-shadow-y', '0px');
    };
    const setNearState = (el: HTMLElement, isNear: boolean) => {
      el.classList.toggle('plus-near', isNear);
    };
    const setHotState = (el: HTMLElement, isHot: boolean) => {
      el.classList.toggle('plus-hot', isHot);
    };

    const tick = () => {
      magneticRafRef.current = null;
      if (isPanOrZoomingRef.current) {
        const handles = host.querySelectorAll<HTMLElement>('.nexflow-plus-handle');
        handles.forEach((el) => {
          setNearState(el, false);
          setHotState(el, false);
          clearHandleVars(el);
        });
        return;
      }
      const pt = magneticPointerRef.current;
      const handles = host.querySelectorAll<HTMLElement>('.nexflow-plus-handle');
      if (!pt || handles.length === 0) return;

      handles.forEach((el) => {
        if (el.classList.contains('plus-snapping')) {
          setNearState(el, true);
          setHotState(el, true);
        }
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const visualX = parseFloat(style.getPropertyValue('--plus-visual-x')) || 0;
        const visualY = parseFloat(style.getPropertyValue('--plus-visual-y')) || 0;
        const magnetX = parseFloat(style.getPropertyValue('--magnet-x')) || 0;
        const magnetY = parseFloat(style.getPropertyValue('--magnet-y')) || 0;
        const baseCx = rect.left + rect.width / 2 + visualX * safeZoom;
        const baseCy = rect.top + rect.height / 2 + visualY * safeZoom;
        const cx = baseCx + magnetX * safeZoom;
        const cy = baseCy + magnetY * safeZoom;
        const dx = pt.x - cx;
        const dy = pt.y - cy;
        const d = Math.hypot(dx, dy);

        const isLeftHandle = el.classList.contains('nexflow-plus-handle-left');
        const isRightHandle = el.classList.contains('nexflow-plus-handle-right');
        const isBottomHandle = el.classList.contains('nexflow-plus-handle-bottom');
        const isSplitHandle = el.classList.contains('nexflow-split-handle');
        if (!isLeftHandle && !isRightHandle && !isBottomHandle) {
          setNearState(el, false);
          setHotState(el, false);
          clearHandleVars(el);
          return;
        }

        // 对所有自定义节点启用磁吸
        const nodeEl = el.closest('.react-flow__node') as HTMLElement | null;
        if (!nodeEl) {
          setNearState(el, false);
          setHotState(el, false);
          clearHandleVars(el);
          return;
        }

        const nodeRect = nodeEl.getBoundingClientRect();
        // 分隔符模块输出点：范围 80 用于 proximity 亮度渐变（越近越亮）。
        // 其他 handle：用各自把手中心 cy（而非节点垂直中心），避免同侧双输出（如角色卡）共享一大块半圆磁区互相抢焦点。
        // 底边 A/B：必须用「视觉中心全圆」——图片连线常从左侧/斜上方靠近，半圆「仅节点下方」会完全吸不到。
        const compactMagnet = el.classList.contains('nexflow-plus-handle-magnet-compact');
        const zoneRadius = isSplitHandle
          ? 80 * safeZoom
          : isBottomHandle
            ? 108 * safeZoom
            : (compactMagnet ? 52 : 72) * safeZoom;
        let inZone = false;
        if (isSplitHandle) {
          const zoneCx = cx;
          const zoneCy = cy;
          const zoneDistance = Math.hypot(pt.x - zoneCx, pt.y - zoneCy);
          inZone = Number.isFinite(zoneDistance) && zoneDistance < zoneRadius;
        } else if (isBottomHandle) {
          // 相对视觉「+」全圆；侧方/上方靠近也能高亮 A 或 B
          inZone = Number.isFinite(d) && d < zoneRadius;
        } else {
          const zoneCx = isLeftHandle ? nodeRect.left : nodeRect.right;
          const zoneCy = cy;
          const zoneDistance = Math.hypot(pt.x - zoneCx, pt.y - zoneCy);
          const inHalfCircle = isLeftHandle ? pt.x <= zoneCx : pt.x >= zoneCx;
          inZone = inHalfCircle && Number.isFinite(zoneDistance) && zoneDistance < zoneRadius;
        }
        setNearState(el, inZone);

        if (!inZone || !Number.isFinite(d) || d <= 0.0001) {
          setHotState(el, false);
          clearHandleVars(el);
          return;
        }

        // 分隔符输出点：鼠标越近 --plus-p 越高，亮度渐变；其他 handle：二值吸附
        const t = isSplitHandle ? Math.max(0, 1 - d / zoneRadius) : 1;
        let mx = (pt.x - baseCx) / safeZoom;
        let my = (pt.y - baseCy) / safeZoom;

        // 仅允许朝模块外侧偏移，避免“+”回到主模块内部
        if (isLeftHandle && mx > 0) mx = 0;
        if (isRightHandle && mx < 0) mx = 0;
        if (isBottomHandle && my < 0) my = 0;
        if (isSplitHandle) {
          mx = Math.max(-15, Math.min(15, mx));
          my = Math.max(-3, Math.min(3, my));
        }

        // 左右把手：投影落入节点水平范围则取消（防 + 缩进节点内）。
        // 底边把手的 cx 本来就在节点宽度内，套用 insideNodeX 会永远清掉磁吸（图片对比 A/B 失效根因）。
        if (!isBottomHandle) {
          const projectedX = cx + mx * safeZoom;
          const insideNodeX = projectedX > nodeRect.left && projectedX < nodeRect.right;
          if (insideNodeX) {
            setNearState(el, false);
            setHotState(el, false);
            clearHandleVars(el);
            return;
          }
        }

        writeHandleVars(el, mx, my, t);
        // 分隔符输出点：仅非常近时切到 plus-hot 白高亮；其他 handle 始终 hot
        setHotState(el, isSplitHandle ? t > 0.85 : true);
      });
    };

    const scheduleTick = () => {
      if (magneticRafRef.current != null) return;
      magneticRafRef.current = requestAnimationFrame(tick);
    };

    const onPointerMove = (event: PointerEvent) => {
      magneticPointerRef.current = { x: event.clientX, y: event.clientY };
      if (isPanOrZoomingRef.current) return;
      scheduleTick();
    };

    const onPointerLeave = () => {
      magneticPointerRef.current = null;
      const handles = host.querySelectorAll<HTMLElement>('.nexflow-plus-handle');
      handles.forEach((el) => {
        setNearState(el, false);
        setHotState(el, false);
        clearHandleVars(el);
      });
    };

    // 拖线开始时锁定到 Handle 中心（避免点击偏移导致起线视觉偏差）
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      let handle = target?.closest('.nexflow-plus-handle') as HTMLElement | null;

      // 命中补偿：如果未直接点中真实锚点，但点中了可见的“+”视觉区，也要路由到对应 handle
      if (!handle) {
        const candidates = Array.from(host.querySelectorAll<HTMLElement>('.nexflow-plus-handle'));
        let best: { el: HTMLElement; d: number } | null = null;
        candidates.forEach((el) => {
          const computed = window.getComputedStyle(el);
          if (computed.pointerEvents === 'none') return;
          const isBottom = el.classList.contains('nexflow-plus-handle-bottom');
          const HIT_RADIUS = isBottom ? 36 : 16;
          const rect = el.getBoundingClientRect();
          const visualX = parseFloat(computed.getPropertyValue('--plus-visual-x')) || 0;
          const visualY = parseFloat(computed.getPropertyValue('--plus-visual-y')) || 0;
          const magnetX = parseFloat(computed.getPropertyValue('--magnet-x')) || 0;
          const magnetY = parseFloat(computed.getPropertyValue('--magnet-y')) || 0;
          const cx = rect.left + rect.width / 2 + (visualX + magnetX) * safeZoom;
          const cy = rect.top + rect.height / 2 + (visualY + magnetY) * safeZoom;
          const dd = Math.hypot(event.clientX - cx, event.clientY - cy);
          if (dd > HIT_RADIUS) return;
          if (!best || dd < best.d) best = { el, d: dd };
        });
        handle = best?.el ?? null;
        if (handle) {
          handle.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            button: event.button,
            buttons: event.buttons,
            clientX: event.clientX,
            clientY: event.clientY,
          }));
          return;
        }
      }

      if (!handle) return;
      // 点击开始拉线时保持当前位置，避免“+”先弹回原处再开始拖线
      magneticPointerRef.current = { x: event.clientX, y: event.clientY };
      handle.classList.add('plus-snapping');
      scheduleTick();
    };
    const onPointerUp = () => {
      const snappingHandles = host.querySelectorAll<HTMLElement>('.nexflow-plus-handle.plus-snapping');
      snappingHandles.forEach((el) => el.classList.remove('plus-snapping'));
      scheduleTick();
    };

    host.addEventListener('pointermove', onPointerMove, { passive: true });
    host.addEventListener('pointerleave', onPointerLeave, { passive: true });
    host.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    return () => {
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerleave', onPointerLeave);
      host.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      if (magneticRafRef.current != null) {
        cancelAnimationFrame(magneticRafRef.current);
        magneticRafRef.current = null;
      }
    };
  }, [reactFlowWrapper, zoom]);

  const handleFlowMove = useCallback((event: MouseEvent | TouchEvent | null) => {
    if (SILENCE_PERF_MONITOR || (TAPNOW_INTERACTION_SUSPEND && getGlobalInteractionSnapshot().isGlobalInteracting)) return;
    const now = Date.now();
    const vp = getViewport();
    const prev = interactionVelocityRef.current;
    interactionVelocityRef.current = { x: vp.x, y: vp.y, t: now };
    if (prev) {
      const dt = Math.max(now - prev.t, 1);
      const vx = (vp.x - prev.x) / (dt / 1000);
      const vy = (vp.y - prev.y) / (dt / 1000);
      setGlobalViewportVelocity(vx, vy);
    }
    if (!event) return;
    // 拖拽平移时仍更新亮点位置，保持聚光区域跟随指针
    if (isPanOrZoomingRef.current) {
      if ('clientX' in event) {
        updateDotHighlightByClient(event.clientX, event.clientY);
        return;
      }
      const touchPan = event.touches?.[0] ?? event.changedTouches?.[0];
      if (touchPan) updateDotHighlightByClient(touchPan.clientX, touchPan.clientY);
      return;
    }
    const now2 = Date.now();
    if (now2 - lastDotHighlightAtRef.current < 80) return;
    lastDotHighlightAtRef.current = now2;
    if ('clientX' in event) {
      updateDotHighlightByClient(event.clientX, event.clientY);
      return;
    }
    const touch = event.touches?.[0] ?? event.changedTouches?.[0];
    if (touch) updateDotHighlightByClient(touch.clientX, touch.clientY);
  }, [updateDotHighlightByClient, getViewport]);

  const ensureMoveInteractionActive = useCallback(() => {
    if (hasActivatedMoveInteractionRef.current) return;
    hasActivatedMoveInteractionRef.current = true;
    beginVisualInteractionLock();
    setGlobalInteracting(true);
    setVideoExtractQueuePaused(true);
  }, [beginVisualInteractionLock]);

  /** 仅在确有平移/拖拽/全局交互锁时复位；勿在每次普通点击上 reset（会抢 click、加剧卡顿） */
  const forceEndPanInteraction = useCallback(() => {
    // 无论锁状态如何，先恢复 sharp，避免「锁已清但预览队列仍暂停」导致上传/资源区假死
    window.electronAPI?.setSharpQueuePaused?.(false).catch(() => undefined);

    const snap = getGlobalInteractionSnapshot();
    const hadPan = isPanOrZoomingRef.current || hasActivatedMoveInteractionRef.current;
    const hadNodeDrag = hasActivatedNodeDragInteractionRef.current;
    const locked =
      snap.isGlobalInteracting ||
      snap.isInteracting ||
      snap.visualLockState !== 'unlocked';
    if (!hadPan && !hadNodeDrag && !locked) return;

    setPanOrZooming(false);
    canvasEngine.setPanning(false);
    canvasEngine.requestUpdate();

    if (interactionRestoreTimerRef.current) {
      clearTimeout(interactionRestoreTimerRef.current);
      interactionRestoreTimerRef.current = null;
    }
    if (visualUnlockTimerRef.current) {
      clearTimeout(visualUnlockTimerRef.current);
      visualUnlockTimerRef.current = null;
    }
    visualLockTokenRef.current += 1;

    hasActivatedMoveInteractionRef.current = false;
    hasActivatedNodeDragInteractionRef.current = false;
    moveStartViewportRef.current = null;
    setGlobalViewportVelocity(0, 0);
    setImageLoadMaxParallel(5);
    setVideoExtractQueuePaused(false);
    // 必须走 setGlobalVisualLockState，保证 isVisualInteractionLocked 与 visualLockState 同步
    setGlobalVisualLockState('unlocked');
    setGlobalInteracting(false);
    resetGlobalInteractionLocks();
  }, [canvasEngine, setPanOrZooming]);

  useEffect(() => {
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const buttons = typeof (e as any).buttons === 'number' ? (e as any).buttons : 0;
      if (buttons === 0) forceEndPanInteraction();
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.buttons !== 0) return;
      const snap = getGlobalInteractionSnapshot();
      const interacting =
        isPanOrZoomingRef.current ||
        hasActivatedMoveInteractionRef.current ||
        hasActivatedNodeDragInteractionRef.current ||
        snap.isGlobalInteracting ||
        snap.visualLockState !== 'unlocked';
      if (!interacting) return;
      // 必须解锁：松手落在底栏/按钮上时若跳过，宽底栏(840)极易把 is-dragging / interacting 卡死，表现为画布不能拖、点什么都没反应
      forceEndPanInteraction();
    };
    const onWindowBlur = () => forceEndPanInteraction();
    const onVisibility = () => {
      if (document.hidden) forceEndPanInteraction();
    };
    const onWindowResize = () => forceEndPanInteraction();
    /** Esc：紧急解除画布交互锁 + 清语音弹窗标记（透明遮罩/假死自救） */
    const onEscUnlock = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const snap = getGlobalInteractionSnapshot();
      const interacting =
        isPanOrZoomingRef.current ||
        hasActivatedMoveInteractionRef.current ||
        hasActivatedNodeDragInteractionRef.current ||
        snap.isGlobalInteracting ||
        snap.isInteracting ||
        snap.visualLockState !== 'unlocked';
      forceEndPanInteraction();
      (window as Window & { __nexflowVoiceModalOpen?: boolean }).__nexflowVoiceModalOpen = false;
      if (interacting) {
        // 阻止 Workspace 同一次 Esc 再弹「退出确认」
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    /** 无按键按住却仍处于交互锁：定时自救（丢失 pointerup / HMR / 松在底栏上） */
    let stuckSince = 0;
    const buttonsRef = { current: 0 };
    const onPointerButtonsTrack = (e: PointerEvent) => {
      buttonsRef.current = e.buttons;
    };
    const onWatchdog = () => {
      const snap = getGlobalInteractionSnapshot();
      const interacting =
        isPanOrZoomingRef.current ||
        hasActivatedMoveInteractionRef.current ||
        hasActivatedNodeDragInteractionRef.current ||
        snap.isGlobalInteracting ||
        snap.visualLockState !== 'unlocked';
      if (!interacting || buttonsRef.current !== 0) {
        stuckSince = 0;
        return;
      }
      if (!stuckSince) stuckSince = Date.now();
      else if (Date.now() - stuckSince > 1200) {
        console.warn('[FlowContent] 交互锁看门狗：无按键却锁住 >1.2s，强制解锁');
        forceEndPanInteraction();
        stuckSince = 0;
      }
    };
    const onForceEndEvent = () => forceEndPanInteraction();
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
    window.addEventListener('pointerdown', onPointerButtonsTrack, true);
    window.addEventListener('pointermove', onPointerButtonsTrack, true);
    window.addEventListener('keydown', onEscUnlock, true);
    window.addEventListener('nexflow-force-end-interaction', onForceEndEvent);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('resize', onWindowResize);
    document.addEventListener('visibilitychange', onVisibility);
    const watchdogId = window.setInterval(onWatchdog, 500);
    return () => {
      window.clearInterval(watchdogId);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerUp, true);
      window.removeEventListener('pointerdown', onPointerButtonsTrack, true);
      window.removeEventListener('pointermove', onPointerButtonsTrack, true);
      window.removeEventListener('keydown', onEscUnlock, true);
      window.removeEventListener('nexflow-force-end-interaction', onForceEndEvent);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('resize', onWindowResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [forceEndPanInteraction]);

  // 向父组件暴露 screenToFlowPosition、fitView、getLastMousePosition
  useEffect(() => {
    if (!flowContentApiRef) return;
    flowContentApiRef.current = {
      screenToFlowPosition,
      getLastMousePosition: () => (reactFlowWrapper.current as any)?.lastMousePosition ?? { x: 0, y: 0 },
      fitView: (opts) => {
        const duration = opts?.duration ?? FIT_VIEW_DURATION;
        isFitViewAnimatingRef.current = true;
        reactFlowInstanceRef.current?.fitView({
          duration,
          padding: opts?.padding ?? 0.2,
          includeHiddenNodes: false,
        });
        window.setTimeout(() => {
          isFitViewAnimatingRef.current = false;
        }, duration + 50);
      },
    };
    return () => {
      flowContentApiRef.current = null;
    };
  }, [flowContentApiRef, screenToFlowPosition]);

  const canvasStyle = useMemo(() => {
    const base: React.CSSProperties = { position: 'relative', overflow: 'hidden' };
    if (viewportSize) {
      base.width = viewportSize.width;
      base.height = viewportSize.height;
    } else {
      base.width = '100%';
      base.height = '100%';
    }
    return base;
  }, [viewportSize]);

  const [isPerformanceMode, setIsPerformanceMode] = useState(false);
  const perfLevel = useGlobalInteractionSelector((state) => state.perfLevel);
  const canvasDrawFps = useGlobalInteractionSelector((state) => state.canvasDrawFps);
  const emergencyUnloadCount = useGlobalInteractionSelector((state) => state.emergencyUnloadCount);
  const velocityX = useGlobalInteractionSelector((state) => state.velocityX);
  const velocityY = useGlobalInteractionSelector((state) => state.velocityY);
  const isFastDragDegraded = isPanOrZooming && Math.hypot(velocityX, velocityY) > 20;
  const perfRecoverHighFpsSecRef = useRef(0);
  const perfModeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lowFpsStreakRef = useRef(0);
  const frameMonitorRafRef = useRef<number | null>(null);
  const lastEmergencyAtRef = useRef(0);
  const abortPerSecAvgRef = useRef(0);
  const [showPerfPanel, setShowPerfPanel] = useState(false);
  const [hwAccelSessionActive, setHwAccelSessionActive] = useState(false);
  const frameSampleRef = useRef<{ lastTs: number; frames: number; janks: number }>({ lastTs: 0, frames: 0, janks: 0 });
  const [perfMetrics, setPerfMetrics] = useState<{
    fps: number;
    jankPerSec: number;
    activeVideoDecodes: number;
    ioQueueLength: number;
    emergencyUnloadCount: number;
    sharpTps: number;
    ioPauseTotalSec: number;
  }>({
    fps: 0,
    jankPerSec: 0,
    activeVideoDecodes: 0,
    ioQueueLength: 0,
    emergencyUnloadCount: 0,
    sharpTps: 0,
    ioPauseTotalSec: 0,
  });

  useEffect(() => {
    if (!window.electronAPI?.getExperimentalHardwareAcceleration) return;
    void window.electronAPI.getExperimentalHardwareAcceleration().then((s) => {
      setHwAccelSessionActive(s.active === true);
    });
  }, []);

  useEffect(() => {
    const nodeThreshold = hwAccelSessionActive ? 12 : 25;
    const shouldEnable = nodes.length > nodeThreshold || zoom < 0.5;
    if (perfModeTimerRef.current) clearTimeout(perfModeTimerRef.current);
    perfModeTimerRef.current = setTimeout(() => {
      setIsPerformanceMode((prev) => {
        if (prev !== shouldEnable) {
          console.log(`[FlowContent] 智能性能模式${shouldEnable ? '已开启' : '已关闭'}（nodes=${nodes.length}, zoom=${zoom.toFixed(2)}）`);
        }
        return shouldEnable;
      });
    }, 120);
    return () => {
      if (perfModeTimerRef.current) {
        clearTimeout(perfModeTimerRef.current);
        perfModeTimerRef.current = null;
      }
    };
  }, [nodes.length, zoom, hwAccelSessionActive]);

  useEffect(() => {
    onPerformanceModeChange?.(isPerformanceMode);
  }, [isPerformanceMode, onPerformanceModeChange]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && (event.key === 'D' || event.key === 'd')) {
        event.preventDefault();
        setShowPerfPanel((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (TAPNOW_INTERACTION_SUSPEND && isGlobalInteracting) return; /* [Tapnow] 交互期间暂停 FPS 统计 */
    let rafId = 0;
    const tick = (ts: number) => {
      const sample = frameSampleRef.current;
      if (sample.lastTs > 0) {
        const dt = Math.max(ts - sample.lastTs, 1);
        if (1000 / dt < 45) sample.janks += 1;
      }
      sample.frames += 1;
      sample.lastTs = ts;
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    const timer = window.setInterval(async () => {
      const sample = frameSampleRef.current;
      const fps = sample.frames;
      const jankPerSec = sample.janks;
      sample.frames = 0;
      sample.janks = 0;
      const activeVideoDecodes = reactFlowWrapper.current
        ? reactFlowWrapper.current.querySelectorAll('.react-flow__node video').length
        : 0;
      let ioQueueLength = 0;
      let sharpTps = 0;
      let ioPauseTotalSec = 0;
      try {
        if (window.electronAPI?.getSharpQueueStats) {
          const stats = await window.electronAPI.getSharpQueueStats();
          ioQueueLength = stats.queued;
          sharpTps = stats.throughputPerSec;
          ioPauseTotalSec = Number((stats.pauseTotalMs / 1000).toFixed(1));
        }
      } catch {
        // ignore stats polling failures
      }
      setPerfMetrics({
        fps,
        jankPerSec,
        activeVideoDecodes,
        ioQueueLength,
        emergencyUnloadCount,
        sharpTps,
        ioPauseTotalSec,
      });
      const abortCount = consumeAbortCount();
      if (isGlobalInteracting) {
        const nextAvg = abortPerSecAvgRef.current <= 0
          ? abortCount
          : abortPerSecAvgRef.current * 0.7 + abortCount * 0.3;
        abortPerSecAvgRef.current = nextAvg;
        console.debug('[RenderPerf][Abort]', {
          abortPerSec: abortCount,
          avgAbortPerSec: Number(nextAvg.toFixed(2)),
        });
      } else {
        abortPerSecAvgRef.current = 0;
      }
      if (!SILENCE_PERF_MONITOR) {
        setGlobalRuntimeFps(fps);
        let nextLevel: 0 | 1 | 2 | 3 = 0;
        if (fps < 30) nextLevel = 3;
        else if (fps < 40) nextLevel = 2;
        else if (fps < PERF_POLICY.fpsP1Threshold) nextLevel = 1;
        if (nextLevel === 0 && perfLevel > 0) {
          if (fps > 55) {
            perfRecoverHighFpsSecRef.current += 1;
          } else {
            perfRecoverHighFpsSecRef.current = 0;
          }
          if (perfRecoverHighFpsSecRef.current < 1) {
            nextLevel = perfLevel;
          }
        } else {
          perfRecoverHighFpsSecRef.current = 0;
        }
        if (nextLevel !== perfLevel) {
          setGlobalPerfLevel(nextLevel);
        }
      }
    }, 1000);
    return () => {
      cancelAnimationFrame(rafId);
      clearInterval(timer);
    };
  }, [reactFlowWrapper, emergencyUnloadCount, perfLevel, isGlobalInteracting]);

  useEffect(() => {
    const host = reactFlowWrapper.current;
    if (!host) return;
    const nodesEls = host.querySelectorAll<HTMLElement>('.custom-node-container');
    nodesEls.forEach((el) => {
      if (isGlobalInteracting) el.classList.add('is-dragging');
      else el.classList.remove('is-dragging');
    });
  }, [isGlobalInteracting, nodes.length]);

  useEffect(() => {
    if (!isGlobalInteracting || SILENCE_PERF_MONITOR || TAPNOW_INTERACTION_SUSPEND) {
      lowFpsStreakRef.current = 0;
      if (frameMonitorRafRef.current != null) {
        cancelAnimationFrame(frameMonitorRafRef.current);
        frameMonitorRafRef.current = null;
      }
      return;
    }
    let lastTs = 0;
    const tick = (ts: number) => {
      if (lastTs > 0) {
        const dt = Math.max(ts - lastTs, 1);
        const fps = 1000 / dt;
        if (fps < 45) lowFpsStreakRef.current += 1;
        else lowFpsStreakRef.current = 0;
        if (lowFpsStreakRef.current >= 3 && ts - lastEmergencyAtRef.current > 600) {
          const vp = getViewport();
          const left = -vp.x / vp.zoom;
          const top = -vp.y / vp.zoom;
          const width = viewportWidth / vp.zoom;
          const height = viewportHeight / vp.zoom;
          const right = left + width;
          const bottom = top + height;
          const unloadIds = nodes
            .filter((n) => (n.type === 'video' || n.type === 'wanAnimate' || n.type === 'heyGem') && !!(n.data as any)?.outputVideo)
            .filter((n) => {
              const nw = Number((n.data as any)?.width || VIDEO_NODE_DEFAULT_W);
              const nh = Number((n.data as any)?.height || VIDEO_NODE_DEFAULT_H);
              const pos = (n as any).positionAbsolute || n.position;
              return pos.x + nw < left || pos.x > right || pos.y + nh < top || pos.y > bottom;
            })
            .map((n) => n.id);
          if (unloadIds.length > 0) {
            triggerEmergencyVideoUnload(unloadIds, 1200);
          }
          lowFpsStreakRef.current = 0;
          lastEmergencyAtRef.current = ts;
        }
      }
      lastTs = ts;
      frameMonitorRafRef.current = requestAnimationFrame(tick);
    };
    frameMonitorRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameMonitorRafRef.current != null) {
        cancelAnimationFrame(frameMonitorRafRef.current);
        frameMonitorRafRef.current = null;
      }
    };
  }, [isGlobalInteracting, getViewport, viewportWidth, viewportHeight, nodes]);

  useEffect(() => {
    return () => {
      if (interactionRestoreTimerRef.current) {
        clearTimeout(interactionRestoreTimerRef.current);
        interactionRestoreTimerRef.current = null;
      }
      clearVisualUnlockTimer();
      visualLockTokenRef.current += 1;
      setGlobalVisualLockState('unlocked');
      setGlobalInteracting(false);
      setGlobalViewportVelocity(0, 0);
      window.electronAPI?.setSharpQueuePaused?.(false).catch(() => undefined);
    };
  }, [clearVisualUnlockTimer]);

  // 小地图点击：将点击位置换算为画布坐标并 setCenter 跳转
  const handleMinimapClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!minimapContainerRef.current) return;
      const rect = minimapContainerRef.current.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const relY = (e.clientY - rect.top) / rect.height;
      const nodesList = getNodes();
      const vp = getViewport();
      const defaultW = Math.max(viewportWidth / vp.zoom, 500);
      const defaultH = Math.max(viewportHeight / vp.zoom, 500);
      const bounds =
        nodesList.length > 0
          ? getNodesBounds(nodesList)
          : { x: -defaultW / 2, y: -defaultH / 2, width: defaultW, height: defaultH };
      const flowX = bounds.x + relX * bounds.width;
      const flowY = bounds.y + relY * bounds.height;
      setCenter(flowX, flowY, { zoom: vp.zoom });
    },
    [getNodes, getViewport, getNodesBounds, setCenter, viewportWidth, viewportHeight]
  );

  return (
    <ErrorBoundary>
      <EdgePathStyleContext.Provider value={edgePathStyle}>
      <div
        ref={reactFlowWrapper}
        className={isDarkMode ? 'dark-mode' : 'light-mode'}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          overflow: 'auto',
        }}
      >
        <div
          style={{
            ...canvasStyle,
            isolation: 'isolate' as const,
            ...(edgeColor ? { ['--nexflow-edge-color' as string]: edgeColor } : {}),
            ['--nexflow-edge-zoom-opacity' as string]: String(0.45 * Math.max(0.2, zoom)),
          }}
          className={`nexflow-canvas-stack ${characterAvatarPickActive ? 'canvas-pick-mode' : ''} ${quickConnectSourceId ? 'quick-connect-mode' : ''} ${isPanOrZooming ? 'react-flow-wrapper--interacting' : ''} ${isPerformanceMode ? 'pf-performance-mode' : ''} ${isGlobalInteracting ? 'is-dragging' : ''} ${isFastDragDegraded ? 'react-flow-wrapper--fast-drag' : ''}`.trim() || undefined}
        >
        <EdgeCanvasLayer
          ref={edgeCanvasRef}
          enabled={useEdgeCanvasForDensity}
          edges={canvasEdges}
          nodes={getNodes()}
          canvasEngine={canvasEngine}
          getLiveTransform={getLiveCanvasTransform}
          viewportWidth={viewportWidth}
          viewportHeight={viewportHeight}
          isDarkMode={!!isDarkMode}
          edgeColor={edgeColor}
          containerRef={reactFlowWrapper}
          useNativeSyncDriven={useNativeSyncDriven}
          executingNodeIds={executingNodeIds}
        />
        <ReactFlow
          nodes={renderedNodes}
          edges={renderedEdges}
          onlyRenderVisibleElements={!hasPlayingAudioNodes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodesDelete={onNodesDelete}
          onConnect={handleConnect}
          isValidConnection={isValidConnection}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onNodeClick={onNodeClick}
          onNodeMouseEnter={(_e, node) => {
            if (quickConnectSourceId) {
              if (node.id !== quickConnectSourceId) {
                setQuickConnectHoverNodeId(node.id);
              }
              return;
            }
            if (!characterAvatarPickActive) return;
            if (isNodePickableForCanvasTarget(node, characterCanvasPickTarget)) {
              setCharacterAvatarPickHoverNodeId(node.id);
            }
          }}
          onNodeMouseLeave={(_e, node) => {
            if (quickConnectSourceId) {
              setQuickConnectHoverNodeId((prev) => (prev === node.id ? null : prev));
              return;
            }
            if (!characterAvatarPickActive) return;
            setCharacterAvatarPickHoverNodeId((prev) => (prev === node.id ? null : prev));
          }}
          onSelectionChange={(params) => {
            canvasEngine.requestUpdate();
            onSelectionChange?.(params);
          }}
          onNodeDragStart={(event, node) => {
            hasActivatedNodeDragInteractionRef.current = false;
            activeDraggingNodeIdRef.current = node.id;
            const w = Number(node.data?.width ?? (node.style as any)?.width) || 300;
            const h = Number(node.data?.height ?? (node.style as any)?.height) || 200;
            canvasEngine.setDraggingNode(node.id, { x: node.position.x, y: node.position.y, width: w, height: h });
            canvasEngine.requestUpdate();
            onNodeDragStart?.(event as any, node as any);
          }}
          onNodeDrag={(event, node) => {
            if (!Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y)) {
              return;
            }
            if (!hasActivatedNodeDragInteractionRef.current) {
              hasActivatedNodeDragInteractionRef.current = true;
              beginVisualInteractionLock();
              setGlobalInteracting(true);
              setImageLoadMaxParallel(perfLevel >= 2 ? 1 : 2);
              setVideoExtractQueuePaused(true);
              // 不 pause sharp，避免侧栏缩略图/上传被拖拽锁死
            }
            // 关闭 transform-only 直改：避免节点视觉位置先行、连线路径后一帧更新造成“慢半拍”。
            // 拖拽位置统一由 ReactFlow 状态驱动，确保节点与连线同源同步。
            const w = Number(node.data?.width ?? (node.style as any)?.width) || 300;
            const h = Number(node.data?.height ?? (node.style as any)?.height) || 200;
            canvasEngine.setDraggingNode(node.id, { x: node.position.x, y: node.position.y, width: w, height: h });
            edgePositionOverridesRef.current.set(node.id, { x: node.position.x, y: node.position.y });
            edgeCanvasRef.current?.redraw(node.id);
            onNodeDrag?.(event as any, node as any);
          }}
          onNodeDragStop={(event, node) => {
            if (!Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y)) {
              return;
            }
            canvasEngine.setDraggingNode(null, null);
            if (hasActivatedNodeDragInteractionRef.current) {
              scheduleVisualInteractionUnlock();
              scheduleInteractionRestore();
            }
            hasActivatedNodeDragInteractionRef.current = false;
            edgePositionOverridesRef.current.delete(node.id);
            edgeCanvasRef.current?.redraw(null);
            activeDraggingNodeIdRef.current = null;
            canvasEngine.requestUpdate();
            setGlobalViewportVelocity(0, 0);
            onNodeDragStop?.(event as any, node as any);
          }}
          onPaneClick={onPaneClick}
          onDrop={(e) => {
            const flowPosition = screenToFlowPosition({ x: e.clientX, y: e.clientY });
            onDrop(e, flowPosition);
          }}
          onDragOver={onDragOver}
          onEdgeClick={onEdgeClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionLineComponent={CustomConnectionLine}
          connectionLineStyle={{ strokeWidth: 3 }}
          defaultEdgeOptions={defaultEdgeOptions}
          elementsSelectable={!characterAvatarPickActive}
          nodesDraggable={!characterAvatarPickActive}
          nodeDragThreshold={0}
          nodesConnectable={!characterAvatarPickActive}
          selectionOnDrag={!characterAvatarPickActive}
          selectionMode={SelectionMode.Partial}
          selectionKeyCode="Shift"
          multiSelectionKeyCode={null}
          panActivationKeyCode="Space"
          panOnDrag={[1, 2]}
          onSelectionStart={(e) => e.preventDefault()}
          panOnScroll={false}
          deleteKeyCode={['Delete', 'Backspace']}
          minZoom={0.1}
          maxZoom={1}
          zoomOnScroll={true}
          zoomOnPinch={true}
          zoomOnDoubleClick={false}
          translateExtent={[[-Infinity, -Infinity], [Infinity, Infinity]]}
          nodeExtent={[[-Infinity, -Infinity], [Infinity, Infinity]]}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          fitView={false}
          fitViewOptions={{ padding: 0.2, includeHiddenNodes: false }}
          snapToGrid={false}
          connectionRadius={40}
          onInit={onInit}
          onMoveStart={(event) => {
            // 立刻冻结：先 ref/锁，再让后续 transform 订阅与大节点 useViewport 跳过重渲染
            setPanOrZooming(true);
            canvasEngine.setPanning(true);
            canvasEngine.requestUpdate();
            setImageLoadMaxParallel(perfLevel >= 2 ? 1 : 2);
            setVideoExtractQueuePaused(true);
            moveStartViewportRef.current = getViewport();
            ensureMoveInteractionActive();
            handleFlowMove(event);
          }}
          onMove={(event) => {
            handleFlowMove(event);
            edgeCanvasRef.current?.redraw(activeDraggingNodeIdRef.current);
          }}
          onMoveEnd={(event) => {
            setPanOrZooming(false);
            canvasEngine.setPanning(false);
            canvasEngine.requestUpdate();
            const vp = getViewport();
            const ZOOM_STEP = 0.01;
            const snappedZoom = Math.max(0.1, Math.min(1, Math.round(vp.zoom / ZOOM_STEP) * ZOOM_STEP));
            if (Math.abs(vp.zoom - snappedZoom) > 0.0001) {
              setViewport({ x: vp.x, y: vp.y, zoom: snappedZoom });
            }
            if (hasActivatedMoveInteractionRef.current) {
              scheduleVisualInteractionUnlock();
              scheduleInteractionRestore();
            } else {
              setVideoExtractQueuePaused(false);
            }
            hasActivatedMoveInteractionRef.current = false;
            moveStartViewportRef.current = null;
            setGlobalViewportVelocity(0, 0);
            handleFlowMove(event);
          }}
          className={`${isDarkMode ? "bg-[#121212] dark-mode" : "light-mode"}${moduleComponentColor ? " nexflow-module-custom-color" : ""}`}
          style={{
            ...(!isDarkMode ? { backgroundColor: lightCanvasBgColor } : { backgroundColor: '#121212' }),
            ...(moduleComponentColor ? { ['--nexflow-module-bg' as string]: moduleComponentColor } : {}),
          }}
          onContextMenu={onPaneContextMenu}
          onDoubleClick={onPaneDoubleClick}
          proOptions={{ hideAttribution: true }}
        >
          {/* 开启“仅渲染可见元素”，降低大画布场景渲染压力 */}
        <FlowDotBackground
          isDarkMode={!!isDarkMode}
          degraded={isPanOrZooming || isFastDragDegraded}
          lightDotsColor={lightDotsColor}
          lightDotSize={lightDotSize}
          canvasDotGap={canvasDotGap}
        />
        {/* 空白画布悬浮入口 */}
        {nodes.length === 0 && !contextMenu && (
          <Panel position="top-left" style={{ left: 0, top: 0, margin: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 12 }}>
            <div className="w-full h-full flex items-center justify-center">
              <div className="flex flex-col items-center gap-8" style={{ marginTop: '-6vh' }}>
                <button
                  type="button"
                  className={`pointer-events-auto px-5 py-2 rounded-xl text-xl font-semibold tracking-wide transition-colors ${
                    isDarkMode
                      ? 'apple-panel text-white/95 hover:bg-white/15'
                      : 'apple-panel-light text-gray-800/90 hover:bg-gray-100'
                  }`}
                  onClick={() => {}}
                >
                  <span className="inline-flex items-center gap-2">
                    <MousePointer2 className="w-4 h-4 text-emerald-400" />
                    {emptyCanvas.doubleClickScreen}
                  </span>
                </button>
              </div>
            </div>
          </Panel>
        )}
        {/* 拖线到空白处弹出菜单时：保持一条从源节点到松开点的连接线，起点用 React Flow 内部 handleBounds 保证精确 */}
        <PendingConnectionLine
          connectFrom={contextMenu?.connectFrom}
          flowX={contextMenu?.flowX}
          flowY={contextMenu?.flowY}
          isDarkMode={isDarkMode}
        />
        {/* 屏幕截图（Alt+1）在上，一键归位在下 — 小地图面板右侧 */}
        <div
          className="absolute bottom-4 z-10 nodrag nopan flex flex-col items-center gap-2"
          style={{
            left: characterListCollapsed
              ? `${ASSET_LIBRARY_SIDEBAR_COLLAPSED_WIDTH_PX + 160 + ASSET_LIBRARY_CANVAS_GAP_PX + 16}px`
              : `${ASSET_LIBRARY_SIDEBAR_WIDTH_PX + 160 + ASSET_LIBRARY_CANVAS_GAP_PX + 16}px`,
            transition: 'left 0.3s ease-in-out',
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void startCanvasScreenshot();
            }}
            className={`nexflow-theme-fixed nexflow-frosted-glass flex items-center justify-center w-10 h-10 rounded-lg transition-all ${
              screenshotSnipping
                ? isDarkMode
                  ? 'ring-2 ring-green-400/90 ring-offset-2 ring-offset-black/40 bg-green-500/30 text-green-200 shadow-[0_0_14px_rgba(34,197,94,0.45)]'
                  : 'ring-2 ring-green-600/85 ring-offset-2 ring-offset-white bg-green-500/25 text-green-800 shadow-[0_0_12px_rgba(22,163,74,0.35)]'
                : isDarkMode
                  ? 'nexflow-frosted-glass-dark hover:bg-white/15 text-white/80'
                  : 'nexflow-frosted-glass-light hover:bg-white/60 text-gray-700'
            }`}
            title={emptyCanvas.screenshotTooltip}
            aria-pressed={screenshotSnipping}
          >
            <Camera className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleFitView();
            }}
            className={`nexflow-theme-fixed nexflow-frosted-glass flex items-center justify-center w-10 h-10 rounded-lg transition-all ${
              isDarkMode
                ? 'nexflow-frosted-glass-dark hover:bg-white/15 text-white/80'
                : 'nexflow-frosted-glass-light hover:bg-white/60 text-gray-700'
            }`}
            title={emptyCanvas.fitViewTitle}
          >
            <Maximize2 className="w-5 h-5" />
          </button>
        </div>

        {/* 左下角：画布小地图 + 缩放滑动条 */}
        <div
          className="absolute bottom-4 left-4 z-10 flex flex-col gap-2 nodrag nopan"
          style={{
            left: characterListCollapsed
              ? `${ASSET_LIBRARY_SIDEBAR_COLLAPSED_WIDTH_PX + ASSET_LIBRARY_CANVAS_GAP_PX}px`
              : `${ASSET_LIBRARY_SIDEBAR_WIDTH_PX + ASSET_LIBRARY_CANVAS_GAP_PX}px`,
            transition: 'left 0.3s ease-in-out',
          }}
        >
          {/* 小地图：可拖拽平移画布，点击跳转到对应位置 */}
          <div
            ref={minimapContainerRef}
            role="button"
            tabIndex={0}
            aria-label={emptyCanvas.minimapAria}
            title={emptyCanvas.minimapTitle}
            className={`nexflow-theme-fixed rounded-lg overflow-hidden cursor-crosshair ${isDarkMode ? 'apple-panel' : 'apple-panel-light'}`}
            style={{ width: 160, height: 100 }}
            onClick={handleMinimapClick}
            onKeyDown={(e) => e.key === 'Enter' && minimapContainerRef.current?.click()}
          >
            <MiniMap
              pannable
              nodeColor={isDarkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.6)'}
              maskColor={isDarkMode ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)'}
              className="!bg-transparent w-full h-full"
            />
          </div>
          {/* 光明模式亮度滑动条 */}
          {/* 缩放滑动条：独立组件订阅 zoom，避免 FlowContent 在缩放时重渲染节点导致卡顿 */}
          <ZoomSlider isDarkMode={!!isDarkMode} />
        </div>

        {/* 右下角：快捷键查询 + GPU 加速 + 模块数量统计（横向排列） */}
        <div className="absolute bottom-4 right-4 z-[12] nodrag nopan flex flex-row items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShortcutsPanelOpen(true);
            }}
            className={`nexflow-theme-fixed nexflow-frosted-glass flex items-center justify-center w-10 h-10 rounded-lg transition-all ${
              shortcutsPanelOpen
                ? isDarkMode
                  ? 'ring-2 ring-sky-400/80 ring-offset-2 ring-offset-black/40 bg-sky-500/20 text-sky-200'
                  : 'ring-2 ring-sky-600/75 ring-offset-2 ring-offset-white bg-sky-500/15 text-sky-800'
                : isDarkMode
                  ? 'nexflow-frosted-glass-dark hover:bg-white/15 text-white/80'
                  : 'nexflow-frosted-glass-light hover:bg-white/60 text-gray-700'
            }`}
            title={shortcutsT.openPanelTitle}
            aria-pressed={shortcutsPanelOpen}
            aria-label={shortcutsT.openPanelTitle}
          >
            <Keyboard className="w-5 h-5" />
          </button>
          <CanvasHardwareAccelToggle isDarkMode={!!isDarkMode} />
          <ModuleCountStats nodes={getNodes()} isDarkMode={!!isDarkMode} />
        </div>

        {showPerfPanel && (
          <div className="pointer-events-none absolute right-4 top-4 z-[90] min-w-[120px] rounded-lg border border-white/20 bg-black/75 px-3 py-2 font-mono text-xs text-green-200 shadow-xl backdrop-blur-sm">
            <div className="mb-2 text-[11px] font-semibold tracking-wide text-green-100">性能调试面板</div>
            <div className="flex items-center justify-between gap-3">
              <span>画布 FPS</span>
              <span>{canvasDrawFps}</span>
            </div>
            <div className="mt-1 text-[10px] text-green-100/70">快捷键：Ctrl+Shift+D（显示/隐藏）</div>
          </div>
        )}
      </ReactFlow>
        {quickConnectSourceId && quickConnectHoverClient && quickConnectHoverHint
          ? createPortal(
              <div
                className={`nexflow-quick-connect-hover-tip ${
                  quickConnectHoverHint.ok
                    ? 'nexflow-quick-connect-hover-tip--ok'
                    : 'nexflow-quick-connect-hover-tip--bad'
                }`}
                style={{
                  position: 'fixed',
                  left: quickConnectHoverClient.x + 14,
                  top: quickConnectHoverClient.y + 14,
                  pointerEvents: 'none',
                  zIndex: 10050,
                }}
              >
                {quickConnectHoverHint.text}
              </div>,
              document.body,
            )
          : null}
        {/* 批量运行 + 超级连线按钮：放在 ReactFlow 外、与画布同坐标系，确保坐标正确 */}
        {(() => {
          const showBatchRun = selectedRunnableNodes.length >= 2 && batchRunButtonPosition;
          const showSuperForward =
            selectedNodes.length >= 2 && superConnectButtonPosition && onSuperConnect;
          const showSuperReverse =
            selectedNodes.length >= 2 &&
            superReverseConnectButtonPosition &&
            onSuperConnect &&
            onReverseSuperConnect;
          const showVideoJoin =
            selectedJoinableVideos.length >= 2 && videoJoinButtonPosition && onJoinSelectedVideos;
          const showGridMapFromSelection =
            selectedJoinableImages.length >= 2 &&
            gridMapFromSelectionButtonPosition &&
            onCreateGridMapFromSelection;
          const shouldShow =
            showBatchRun || showSuperForward || showSuperReverse || showVideoJoin || showGridMapFromSelection;
          if (!shouldShow) return null;
          return (
            <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 50 }}>
              {showGridMapFromSelection && gridMapFromSelectionButtonPosition && (
                <GridMapFromSelectionButton
                  selectedNodes={selectedJoinableImages}
                  position={gridMapFromSelectionButtonPosition}
                  isDarkMode={isDarkMode}
                  onCreate={(opts) => onCreateGridMapFromSelection?.(opts)}
                />
              )}
              {showVideoJoin && videoJoinButtonPosition && (
                <VideoJoinButton
                  selectedNodes={selectedJoinableVideos}
                  position={videoJoinButtonPosition}
                  isDarkMode={isDarkMode}
                  busy={videoJoinBusy}
                  onJoin={() => onJoinSelectedVideos?.(selectedJoinableVideos.map((n) => n.id))}
                />
              )}
              {showBatchRun && batchRunButtonPosition && (
                <BatchRunButton
                  selectedNodes={selectedRunnableNodes}
                  position={batchRunButtonPosition}
                  isDarkMode={isDarkMode}
                  onBatchRun={handleBatchRun}
                  isRunning={batchRunInProgress}
                  totalPrice={totalPrice}
                />
              )}
              {showSuperReverse && superReverseConnectButtonPosition && (
                <SuperConnectButton
                  mode="reverse"
                  placement="selection-left"
                  selectedNodes={selectedNodes}
                  position={superReverseConnectButtonPosition}
                  onSuperConnect={onSuperConnect}
                  onReverseSuperConnect={onReverseSuperConnect}
                  isDarkMode={isDarkMode}
                  containerRef={reactFlowWrapper}
                  zoom={zoom}
                />
              )}
              {showSuperForward && superConnectButtonPosition && (
                <SuperConnectButton
                  mode="forward"
                  placement="selection-right"
                  selectedNodes={selectedNodes}
                  position={superConnectButtonPosition}
                  onSuperConnect={onSuperConnect}
                  onReverseSuperConnect={onReverseSuperConnect ?? noopReverseSuperConnect}
                  isDarkMode={isDarkMode}
                  containerRef={reactFlowWrapper}
                  zoom={zoom}
                />
              )}
            </div>
          );
        })()}
        {/* Canvas 模式下连接线点击层：pointer-events: none 让拖拽/缩放穿透到画布，仅 path 有 stroke 可点 */}
        <div style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 9999, pointerEvents: 'none' }}>
        <EdgeCanvasHitLayer
          enabled={useEdgeCanvasForDensity}
          edges={canvasEdges}
          nodes={getNodes()}
          canvasEngine={canvasEngine}
          viewportWidth={viewportWidth}
          viewportHeight={viewportHeight}
          containerRef={reactFlowWrapper}
          selectedEdgeId={selectedEdgeId}
          onEdgeClick={onEdgeClick}
          onEdgeCenterClick={onEdgeCenterClick}
          onEdgeDeleteRequest={onEdgeDeleteRequest}
          onPaneClick={onPaneClick}
          edgeDeleteModeId={edgeDeleteModeId}
        />
        </div>
        </div>

      {/* 右键/双击菜单：x,y 为 clientX/clientY，直接用于 fixed 定位 */}
      {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            allowedTypes={
              contextMenu.connectFrom && nodes.length > 0
                ? (() => {
                    const src = nodes.find((n) => n.id === contextMenu.connectFrom!.sourceNodeId);
                    const types = getAllowedMenuTypes(src?.type ?? null, contextMenu.connectFrom?.sourceHandleId ?? null) ?? [];
                    return types.filter((t) => t !== 'canvas-tool');
                  })()
                : undefined
            }
            onSelect={(type) => {
              if (contextMenu && 'flowX' in contextMenu && 'flowY' in contextMenu) {
                const flowX = (contextMenu as { flowX?: number; flowY?: number; connectFrom?: { sourceNodeId: string; sourceHandleId: string | null; handleType: string | null } }).flowX ?? 0;
                const flowY = (contextMenu as { flowX?: number; flowY?: number; connectFrom?: { sourceNodeId: string; sourceHandleId: string | null; handleType: string | null } }).flowY ?? 0;
                const connectFrom = (contextMenu as { flowX?: number; flowY?: number; connectFrom?: { sourceNodeId: string; sourceHandleId: string | null; handleType: string | null } }).connectFrom;
                console.log('[FlowContent] 创建节点，画布坐标:', { flowX, flowY, type, connectFrom });
                handleMenuSelect(type, { x: flowX, y: flowY }, connectFrom);
              } else {
                console.warn('[FlowContent] contextMenu 缺少 flowX 或 flowY', contextMenu);
              }
            }}
          />
      )}

      {/* 选框 */}
      {/* 使用 React Flow 内置的框选高亮，不再自绘矩形 */}
      </div>
      <CanvasShortcutsPanel open={shortcutsPanelOpen} onClose={() => setShortcutsPanelOpen(false)} />
      </EdgePathStyleContext.Provider>
    </ErrorBoundary>
  );
};

export default FlowContent;
