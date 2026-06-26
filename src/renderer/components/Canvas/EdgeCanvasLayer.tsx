import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import type { Edge, Node } from 'reactflow';
import { currentActivePositionsMap } from '../../utils/nativeNodePositionSync';
import { setGlobalCanvasDrawFps } from '../../utils/globalInteractionStore';
import type { CanvasEngine } from '../../utils/CanvasEngine';

export interface EdgeCanvasLayerHandle {
  redraw: (activeNodeId?: string | null) => void;
}

interface EdgeCanvasLayerProps {
  enabled: boolean;
  edges: Edge[];
  nodes: Node[];
  /** 从 CanvasEngine 读取 transform，脱离 React 更新 */
  canvasEngine: CanvasEngine;
  /** 每帧直读 React Flow store，与 .react-flow__viewport 矩阵零延迟对齐 */
  getLiveTransform?: () => [number, number, number];
  viewportWidth: number;
  viewportHeight: number;
  isDarkMode: boolean;
  /** 连接线颜色（可选，覆盖默认） */
  edgeColor?: string;
  /** 连接线粗细倍数（1–4，即 100%–400%） */
  edgeThickness?: number;
  /** 容器 ref，用于 querySelector('.react-flow__viewport') 读取 DOM 节点位置 */
  containerRef: React.RefObject<HTMLElement | null>;
  /** 由 native sync 统一触发重绘，不跑独立 RAF */
  useNativeSyncDriven?: boolean;
  /** 执行中节点 ID，这些节点的连线使用不透明高亮样式 */
  executingNodeIds?: Set<string>;
}

const EDGE_ATTACH_OVERLAP = 0;

/** TextSplit 输出 handle 垂直布局常量，与 TextSplitNode 一致 */
const OUTPUT_BASE_TOP = 72;
const PER_HANDLE = 28;
/** TextSplit 输出 handle 容器 right: -8，连接线需延伸到 handle 位置，消除模块与连线空隙 */
const TEXTSPLIT_RIGHT_OFFSET = 8;

/** 各模块默认尺寸（与 Workspace.handleMenuSelect / 节点 MIN 一致），避免 fallback 300×200 导致连线错位 */
const NODE_DEFAULT_FLOW_SIZE: Record<string, { w: number; h: number }> = {
  video: { w: 738.91, h: 422.22 },
  wanAnimate: { w: 738.91, h: 422.22 },
  image: { w: 369.46, h: 211.12 },
  text: { w: 369.46, h: 211.12 },
  llm: { w: 280, h: 160 },
  textSplit: { w: 240, h: 200 },
  character: { w: 624, h: 468 },
  audio: { w: 280, h: 160 },
};

function parseFlowNum(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v || ''));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getNodeFlowSize(node: Node | undefined): { w: number; h: number } {
  const typeDefault = node?.type ? NODE_DEFAULT_FLOW_SIZE[node.type] : undefined;
  const fbW = typeDefault?.w ?? 300;
  const fbH = typeDefault?.h ?? 200;
  return {
    w: parseFlowNum(node?.data?.width ?? (node?.style as { width?: unknown })?.width, fbW),
    h: parseFlowNum(node?.data?.height ?? (node?.style as { height?: unknown })?.height, fbH),
  };
}

/** ComfyUI/LiteGraph SPLINE_LINK：控制点从端点延展，offset = dist * 0.25 */
const COMFYUI_OFFSET_FACTOR = 0.25;

function distance(sx: number, sy: number, tx: number, ty: number): number {
  return Math.sqrt((tx - sx) ** 2 + (ty - sy) ** 2);
}

/** ComfyUI 风格控制点：source 向右、target 向左（RIGHT→LEFT） */
function getComfyUIControlPoints(sx: number, sy: number, tx: number, ty: number) {
  const dist = distance(sx, sy, tx, ty);
  const off = dist * COMFYUI_OFFSET_FACTOR;
  return {
    c1x: sx + off,
    c1y: sy,
    c2x: tx - off,
    c2y: ty,
  };
}

/** 导出供 EdgeCanvasHitLayer 复用；完全精确浮点，禁止 toFixed/Math.round */
export function buildBezierPathD(sx: number, sy: number, tx: number, ty: number): string {
  const { c1x, c1y, c2x, c2y } = getComfyUIControlPoints(sx, sy, tx, ty);
  return `M ${sx},${sy} C ${c1x},${c1y} ${c2x},${c2y} ${tx},${ty}`;
}

/** Bezier t=0.5 midpoint（ComfyUI 曲线），供剪刀定位 */
export function getBezierMidpoint(sx: number, sy: number, tx: number, ty: number): { x: number; y: number } {
  const { c1x, c1y, c2x, c2y } = getComfyUIControlPoints(sx, sy, tx, ty);
  const t = 0.5;
  const mt = 1 - t;
  const x = mt * mt * mt * sx + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * tx;
  const y = mt * mt * mt * sy + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * ty;
  return { x, y };
}

/** flow 空间 SPLINE 贝塞尔（LiteGraph bezierCurveTo，无采样折线） */
function strokeComfyUILink(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  lineWidthFlow: number,
  strokeStyle: string,
) {
  const { c1x, c1y, c2x, c2y } = getComfyUIControlPoints(sx, sy, ex, ey);
  ctx.lineWidth = lineWidthFlow;
  ctx.strokeStyle = strokeStyle;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.bezierCurveTo(c1x, c1y, c2x, c2y, ex, ey);
  ctx.stroke();
}

/** 拖拽节点覆盖：用于连接线实时跟随 */
type DraggingNodeOverride = { nodeId: string; x: number; y: number; width: number; height: number } | null;

/** 优先从 nodes/Map 或 draggingOverride 读取，否则从 DOM；返回 flow 坐标下的端点 */
export function getNodeHandle(
  viewport: Element,
  nodeId: string,
  side: 'right' | 'left',
  viewportRect: DOMRect,
  tx: number,
  ty: number,
  zoom: number,
  nodesMap: Map<string, Node> | null,
  handleId?: string | null,
  draggingOverride?: DraggingNodeOverride,
): { x: number; y: number } | null {
  if (draggingOverride && draggingOverride.nodeId === nodeId) {
    let x = side === 'right' ? draggingOverride.x + draggingOverride.width : draggingOverride.x;
    let y = draggingOverride.y + draggingOverride.height / 2;
    const node = nodesMap?.get(nodeId);
    if (side === 'right' && node?.type === 'textSplit' && handleId && String(handleId).startsWith('output-')) {
      x += TEXTSPLIT_RIGHT_OFFSET;
      if (handleId !== 'output-null') {
        const idx = parseInt(String(handleId).replace('output-', ''), 10);
        if (Number.isInteger(idx) && idx >= 0) {
          y = draggingOverride.y + OUTPUT_BASE_TOP + idx * PER_HANDLE + PER_HANDLE / 2;
        }
      }
    }
    return { x, y };
  }
  const node = nodesMap?.get(nodeId);
  const pos = node ? ((node as Node & { positionAbsolute?: { x: number; y: number } }).positionAbsolute ?? node.position) : null;
  const el = viewport.querySelector(`[data-id="${nodeId}"]`) as HTMLElement | null;

  if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
    let { w, h } = getNodeFlowSize(node);
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        w = rect.width / zoom;
        h = rect.height / zoom;
      }
    }
    if (w > 0 && h > 0) {
      let x = side === 'right' ? pos.x + w : pos.x;
      let y = pos.y + h / 2;
      if (side === 'right' && node?.type === 'textSplit' && handleId && String(handleId).startsWith('output-')) {
        x += TEXTSPLIT_RIGHT_OFFSET;
        if (handleId === 'output-null') {
          y = pos.y + h / 2;
        } else {
          const idx = parseInt(String(handleId).replace('output-', ''), 10);
          if (Number.isInteger(idx) && idx >= 0) {
            y = pos.y + OUTPUT_BASE_TOP + idx * PER_HANDLE + PER_HANDLE / 2;
          }
        }
      }
      return { x, y };
    }
  }

  const cached = currentActivePositionsMap.get(nodeId);
  if (!el) return null;

  if (cached) {
    const rect = el.getBoundingClientRect();
    const flowW = rect.width / zoom;
    const flowH = rect.height / zoom;
    let x = side === 'right' ? cached.x + flowW : cached.x;
    let y = cached.y + flowH / 2;
    if (side === 'right' && node?.type === 'textSplit' && handleId && String(handleId).startsWith('output-')) {
      x += TEXTSPLIT_RIGHT_OFFSET;
      if (handleId !== 'output-null') {
        const idx = parseInt(String(handleId).replace('output-', ''), 10);
        if (Number.isInteger(idx) && idx >= 0) {
          y = cached.y + OUTPUT_BASE_TOP + idx * PER_HANDLE + PER_HANDLE / 2;
        }
      }
    }
    return { x, y };
  }

  const rect = el.getBoundingClientRect();
  const flowX = (rect.left - viewportRect.left - tx) / zoom;
  const flowY = (rect.top - viewportRect.top - ty) / zoom;
  const flowW = rect.width / zoom;
  const flowH = rect.height / zoom;
  let x = side === 'right' ? flowX + flowW : flowX;
  let y = flowY + flowH / 2;
  if (side === 'right' && node?.type === 'textSplit' && handleId && String(handleId).startsWith('output-')) {
    x += TEXTSPLIT_RIGHT_OFFSET;
    if (handleId !== 'output-null') {
      const idx = parseInt(String(handleId).replace('output-', ''), 10);
      if (Number.isInteger(idx) && idx >= 0) {
        y = flowY + OUTPUT_BASE_TOP + idx * PER_HANDLE + PER_HANDLE / 2;
      }
    }
  }
  return { x, y };
}

function toRgbaWithAlpha(color: string, alpha = 0.96): string {
  if (color.startsWith('rgba(')) {
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const parts = m[1].split(',').map((s) => s.trim());
      if (parts.length >= 3) return `rgba(${parts[0]},${parts[1]},${parts[2]},${alpha})`;
    }
    return color;
  }
  if (color.startsWith('rgb(')) {
    const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    return m ? `rgba(${m[1]},${m[2]},${m[3]},${alpha})` : color;
  }
  const hex = color.replace(/^#/, '');
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}

const EdgeCanvasLayer = forwardRef<EdgeCanvasLayerHandle, EdgeCanvasLayerProps>(function EdgeCanvasLayer(
  {
    enabled,
    edges,
    nodes,
    canvasEngine,
    getLiveTransform,
    viewportWidth,
    viewportHeight,
    isDarkMode,
    edgeColor,
    edgeThickness = 1,
    containerRef,
    useNativeSyncDriven = false,
    executingNodeIds,
  },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nodesMapRef = useRef<Map<string, Node>>(new Map());
  const edgesRef = useRef(edges);
  const nodesRef = useRef(nodes);
  const executingRef = useRef(executingNodeIds);
  const isDarkRef = useRef(isDarkMode);
  const edgeColorRef = useRef(edgeColor);
  const edgeThicknessRef = useRef(edgeThickness);
  edgesRef.current = edges;
  nodesRef.current = nodes;
  executingRef.current = executingNodeIds;
  isDarkRef.current = isDarkMode;
  edgeColorRef.current = edgeColor;
  edgeThicknessRef.current = edgeThickness;

  const rafIdRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);
  const activeNodeIdRef = useRef<string | null>(null);
  const dprRef = useRef(1);
  const fpsFrameCountRef = useRef(0);
  const fpsLastLogRef = useRef(0);

  useEffect(() => {
    if (enabled) canvasEngine.requestUpdate();
  }, [enabled, edges, nodes, isDarkMode, edgeColor, edgeThickness, executingNodeIds, canvasEngine]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    const rect = container.getBoundingClientRect();
    canvas.width = Math.max(1, Math.ceil(rect.width * dpr));
    canvas.height = Math.max(1, Math.ceil(rect.height * dpr));
  }, [viewportWidth, viewportHeight, containerRef]);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = dprRef.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!enabled) return;

    canvasEngine.tick();

    const liveTransform = getLiveTransform?.() ?? canvasEngine.getTransform();
    const [tx, ty, zoom] = liveTransform;
    const thickness = edgeThicknessRef.current;
    const dark = isDarkRef.current;
    const strokeColor = edgeColorRef.current;
    const edgeList = edgesRef.current;
    const nodeList = nodesRef.current;
    const executing = executingRef.current;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 10;
    ctx.setLineDash([]);

    const viewport = containerRef.current?.querySelector('.react-flow__viewport') as HTMLElement | null;
    if (!viewport) return;

    const viewportRect = viewport.getBoundingClientRect();

    /** ComfyUI/LiteGraph：ctx 先 apply 与 viewport 相同的 translate+scale，在 flow 坐标里画线 */
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * tx, dpr * ty);

    const FLOW_STROKE_WIDTH = 4 * thickness;
    const SELECTED_FLOW_STROKE = 4.6 * thickness;

    nodesMapRef.current.clear();
    for (const n of nodeList) nodesMapRef.current.set(n.id, n);
    const nodesMap = nodesMapRef.current;
    const draggingOverride = canvasEngine.getDraggingNode();
    const currentActive = activeNodeIdRef.current;

    const vpLeft = -tx / zoom;
    const vpTop = -ty / zoom;
    const vpRight = vpLeft + viewportWidth / zoom;
    const vpBottom = vpTop + viewportHeight / zoom;

    for (const edge of edgeList) {
      const src = getNodeHandle(
        viewport, edge.source, 'right', viewportRect, tx, ty, zoom, nodesMap,
        edge.sourceHandle ?? undefined, draggingOverride,
      );
      const tgt = getNodeHandle(
        viewport, edge.target, 'left', viewportRect, tx, ty, zoom, nodesMap,
        edge.targetHandle ?? undefined, draggingOverride,
      );
      if (!src || !tgt) continue;

      const srcOutside = src.x < vpLeft || src.x > vpRight || src.y < vpTop || src.y > vpBottom;
      const tgtOutside = tgt.x < vpLeft || tgt.x > vpRight || tgt.y < vpTop || tgt.y > vpBottom;
      if (srcOutside && tgtOutside) continue;

      const selected = !currentActive && !!(edge as Edge & { selected?: boolean }).selected;
      const gradientEdge = (edge.className || '').includes('rf-edge-gradient') || edge.type === 'animatedGradient';
      const isTaskEdge = executing?.has(edge.target) ?? false;
      const lineWidthFlow = selected ? SELECTED_FLOW_STROKE : FLOW_STROKE_WIDTH;

      let strokeStyle: string;
      if (selected) {
        strokeStyle = 'rgba(34,197,94,0.98)';
      } else if (isTaskEdge || gradientEdge) {
        strokeStyle = dark ? 'rgba(220,220,220,0.85)' : 'rgba(70,70,70,0.88)';
      } else if (strokeColor) {
        strokeStyle = toRgbaWithAlpha(strokeColor);
      } else {
        strokeStyle = dark ? 'rgba(255,255,255,0.35)' : 'rgba(156,163,175,0.96)';
      }

      strokeComfyUILink(
        ctx,
        src.x - EDGE_ATTACH_OVERLAP,
        src.y,
        tgt.x + EDGE_ATTACH_OVERLAP,
        tgt.y,
        lineWidthFlow,
        strokeStyle,
      );
    }

    const dragNode = canvasEngine.getDraggingNode();
    if (dragNode) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const topLeft = {
        x: dragNode.x * zoom + tx,
        y: dragNode.y * zoom + ty,
      };
      const screenW = dragNode.width * zoom;
      const screenH = dragNode.height * zoom;
      ctx.fillStyle = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
      ctx.beginPath();
      if (typeof (ctx as CanvasRenderingContext2D & { roundRect?: (...args: number[]) => void }).roundRect === 'function') {
        (ctx as CanvasRenderingContext2D & { roundRect: (...args: number[]) => void }).roundRect(
          topLeft.x, topLeft.y, screenW, screenH, Math.min(16, Math.min(screenW, screenH) / 4),
        );
      } else {
        ctx.rect(topLeft.x, topLeft.y, screenW, screenH);
      }
      ctx.fill();
    }
  }, [
    enabled,
    canvasEngine,
    viewportHeight,
    viewportWidth,
    containerRef,
    getLiveTransform,
  ]);

  const runLoop = useCallback(() => {
    if (!isMountedRef.current) return;
    drawFrame();
    fpsFrameCountRef.current += 1;
    const now = performance.now();
    const elapsed = now - fpsLastLogRef.current;
    if (elapsed >= 1000) {
      const fps = Math.round((fpsFrameCountRef.current * 1000) / elapsed);
      setGlobalCanvasDrawFps(fps);
      fpsFrameCountRef.current = 0;
      fpsLastLogRef.current = now;
    }
    const keepAlive =
      canvasEngine.getPanning() ||
      canvasEngine.getDraggingNode() ||
      canvasEngine.getNeedsUpdate();
    if (!keepAlive && canvasEngine.trySleep()) {
      setGlobalCanvasDrawFps(0);
      rafIdRef.current = null;
      return;
    }
    rafIdRef.current = requestAnimationFrame(runLoop);
  }, [drawFrame, canvasEngine]);

  useImperativeHandle(ref, () => ({
    redraw: (activeNodeId?: string | null) => {
      activeNodeIdRef.current = activeNodeId ?? null;
      canvasEngine.requestUpdate();
    },
  }), [canvasEngine]);

  useEffect(() => {
    if (!enabled) return;
    const wake = () => {
      if (isMountedRef.current && !rafIdRef.current) {
        rafIdRef.current = requestAnimationFrame(runLoop);
      }
    };
    return canvasEngine.subscribeToRequestUpdate(wake);
  }, [enabled, canvasEngine, runLoop]);

  useEffect(() => {
    isMountedRef.current = true;
    if (!enabled) {
      setGlobalCanvasDrawFps(0);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (ctx && canvas) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      return;
    }
    fpsLastLogRef.current = performance.now();
    rafIdRef.current = requestAnimationFrame(runLoop);
    return () => {
      isMountedRef.current = false;
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [enabled, useNativeSyncDriven, runLoop]);

  return (
    <canvas
      ref={canvasRef}
      className="nexflow-edge-canvas absolute inset-0 pointer-events-none"
    />
  );
});

export default EdgeCanvasLayer;
