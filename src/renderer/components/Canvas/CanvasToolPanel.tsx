import React, { useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Eraser, Check, X, Square, Circle, Type, Maximize2, Minimize2, ZoomIn, ZoomOut } from 'lucide-react';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { canvasToolPanelT } from '../../i18n/canvasToolPanelI18n';
import { assetLibBtnPrimary, assetLibBtnSecondary, nodeFloatPillBtn, nodeFloatToolBtn } from '../../utils/assetLibraryChrome';
import { type ScratchColorId } from '../../theme/scratchColors';

type ToolMode = 'brush' | 'eraser' | 'rect' | 'circle' | 'text';

function canvasToolPill(isDarkMode: boolean, scratch: ScratchColorId, extra = '') {
  if (!isDarkMode) {
    return nodeFloatPillBtn(isDarkMode, extra, scratch);
  }
  return nodeFloatPillBtn(isDarkMode, extra);
}

function canvasToolIcon(isDarkMode: boolean, scratch: ScratchColorId, active = false, extra = '') {
  return nodeFloatToolBtn(isDarkMode, active, extra, isDarkMode ? undefined : scratch);
}

const PRESET_COLORS = [
  '#000000', '#ffffff', '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#78716c', '#a8a29e',
];

const BRUSH_SIZE_MIN = 2;
const BRUSH_SIZE_MAX = 48;
const ERASER_SIZE_MIN = 2;
const ERASER_SIZE_MAX = 32;
const ERASER_SIZE_SCALE = 4;

const DEFAULT_CANVAS_W = 640;
const DEFAULT_CANVAS_H = 480;
const MAX_CANVAS_W = 960;
const MAX_CANVAS_H = 720;
/** 全屏时顶栏 + 工具条占用高度估算（用于 ResizeObserver 尚未就绪时的回退尺寸） */
const FULLSCREEN_CHROME_ESTIMATE_PX = 240;

interface CanvasToolPanelProps {
  onConfirm: (dataUrl: string) => void;
  onCancel: () => void;
  isDarkMode?: boolean;
  /** 初始图片 URL：提供时在画布上加载该图片供绘图标记 */
  initialImageUrl?: string;
  /** 本地文件路径：本地上传图片时用于 readImageAsDataUrl，避免 canvas 污染导致无法绘制/导出 */
  localPath?: string;
  /** 编辑模式：提供 nodeId 和 onApplyToNode 时，完成将更新该节点而非创建新节点 */
  nodeId?: string;
  onApplyToNode?: (nodeId: string, dataUrl: string) => void;
}

const CanvasToolPanel: React.FC<CanvasToolPanelProps> = ({
  onConfirm,
  onCancel,
  isDarkMode = true,
  initialImageUrl,
  localPath,
  nodeId,
  onApplyToNode,
}) => {
  const showAlert = useDarkAlert().showAlert;
  const { locale } = useAppLocale();
  const tt = useMemo(() => canvasToolPanelT(locale), [locale]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawLayerRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const drawCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const overlayCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const eraserCursorRef = useRef<HTMLDivElement>(null);
  const lastPaintedImageUrlRef = useRef<string | null>(null);
  const baseImageRef = useRef<HTMLImageElement | null>(null);
  const [color, setColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(6);
  const [eraserSize, setEraserSize] = useState(12);
  const [toolMode, setToolMode] = useState<ToolMode>('brush');
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const shapeStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastMousePosRef = useRef<{ x: number; y: number } | null>(null);
  const hasDrawnRef = useRef(false);
  const [textInput, setTextInput] = useState('');
  const [textPos, setTextPos] = useState<{ x: number; y: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const panelRef = useRef<HTMLDivElement>(null);
  const wasFullscreenRef = useRef(false);
  const isEraserTool = toolMode === 'eraser';
  const activeStrokeSize = isEraserTool ? eraserSize : brushSize;
  const strokeSizeMin = isEraserTool ? ERASER_SIZE_MIN : BRUSH_SIZE_MIN;
  const strokeSizeMax = isEraserTool ? ERASER_SIZE_MAX : BRUSH_SIZE_MAX;

  const handleStrokeSizeChange = useCallback(
    (raw: number) => {
      const v = Math.round(Math.max(strokeSizeMin, Math.min(strokeSizeMax, raw)));
      if (isEraserTool) setEraserSize(v);
      else setBrushSize(v);
    },
    [isEraserTool, strokeSizeMin, strokeSizeMax],
  );

  const handleFullscreenToggle = useCallback(async () => {
    if (isFullscreen) {
      try {
        await (window as any).electronAPI?.setFullscreen?.(false);
      } catch (_e) {}
      wasFullscreenRef.current = false;
      setIsFullscreen(false);
      setZoomScale(1);
    } else {
      try {
        await (window as any).electronAPI?.setFullscreen?.(true);
      } catch (_e) {}
      wasFullscreenRef.current = true;
      setIsFullscreen(true);
    }
  }, [isFullscreen]);

  // ESC 退出全屏（非文字输入时）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (textPos) return; // 文字输入时由 input 自己处理
      if (isFullscreen) {
        e.preventDefault();
        handleFullscreenToggle();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullscreen, textPos, handleFullscreenToggle]);

  // 滚轮缩放（全屏与非全屏均可用，需 passive: false 才能 preventDefault）
  useEffect(() => {
    const el = canvasWrapperRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoomScale((s) => Math.max(0.5, Math.min(3, s + delta)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [isFullscreen]);

  useEffect(() => {
    return () => {
      if (wasFullscreenRef.current) {
        (window as any).electronAPI?.setFullscreen?.(false).catch(() => {});
      }
    };
  }, []);
  const rafIdRef = useRef<number | null>(null);
  const pendingDrawsRef = useRef<Array<{ from: { x: number; y: number }; to: { x: number; y: number } }>>([]);
  const drawRAFRef = useRef<number | null>(null);
  const toolModeRef = useRef(toolMode);
  const brushSizeRef = useRef(brushSize);
  const eraserSizeRef = useRef(eraserSize);
  const colorRef = useRef(color);
  toolModeRef.current = toolMode;
  brushSizeRef.current = brushSize;
  eraserSizeRef.current = eraserSize;
  colorRef.current = color;
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const [canvasHostSize, setCanvasHostSize] = useState({ w: 0, h: 0 });
  const [canvasSize, setCanvasSize] = useState({ w: DEFAULT_CANVAS_W, h: DEFAULT_CANVAS_H });
  /** 解析后的图片 URL：本地上传时通过 readImageAsDataUrl 转为 data URL，避免 canvas 污染 */
  const [resolvedImageUrl, setResolvedImageUrl] = useState<string | null>(null);

  const getContext = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.getContext('2d');
  }, []);

  const getDrawContext = useCallback(() => drawCtxRef.current, []);

  const initCanvas = useCallback(() => {
    const ctx = getContext();
    if (!ctx) return;
    baseImageRef.current = null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasSize.w, canvasSize.h);
    hasDrawnRef.current = false;
    lastPaintedImageUrlRef.current = null;
  }, [getContext, canvasSize.w, canvasSize.h]);

  // 本地上传图片（local-resource://、file://）：必须用 readImageAsDataUrl 转 data URL 加载，否则 canvas 污染导致 toDataURL 失败、标记无法导出
  useEffect(() => {
    if (!initialImageUrl) {
      setResolvedImageUrl(null);
      return;
    }
    const isLocal = initialImageUrl.startsWith('local-resource://') || initialImageUrl.startsWith('file://');
    if (!isLocal) {
      setResolvedImageUrl(initialImageUrl);
      return;
    }
    const api = typeof window !== 'undefined' ? (window as any).electronAPI : null;
    if (!api?.readImageAsDataUrl) {
      setResolvedImageUrl(initialImageUrl);
      return;
    }
    const urlForRead = initialImageUrl.split('?')[0];
    let cancelled = false;
    // 编辑模式（有 nodeId）时不要传 localPath：outputImage 可能已更新为标记后的新文件（如 drawing-marked.png），
    // 而 localPath 可能仍指向原始图片，readImageAsDataUrl 会优先用 localPath 导致加载到未标记的旧图
    const pathToUse = nodeId ? undefined : localPath;
    api
      .readImageAsDataUrl(urlForRead, undefined, pathToUse)
      .then(({ dataUrl }: { dataUrl: string }) => {
        if (!cancelled) setResolvedImageUrl(dataUrl);
      })
      .catch((err: unknown) => {
        console.error('[CanvasToolPanel] readImageAsDataUrl 失败:', err);
        if (!cancelled) setResolvedImageUrl(initialImageUrl);
      });
    return () => { cancelled = true; };
  }, [initialImageUrl, localPath, nodeId]);

  const loadInitialImage = useCallback(() => {
    const isLocal = initialImageUrl?.startsWith('local-resource://') || initialImageUrl?.startsWith('file://');
    const url = isLocal ? resolvedImageUrl : (resolvedImageUrl ?? initialImageUrl);
    if (!url) {
      if (!initialImageUrl) setCanvasSize({ w: DEFAULT_CANVAS_W, h: DEFAULT_CANVAS_H });
      return;
    }
    const img = new Image();
    if (!url.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => {
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w <= 0 || h <= 0) {
        setCanvasSize({ w: DEFAULT_CANVAS_W, h: DEFAULT_CANVAS_H });
        return;
      }
      if (w > MAX_CANVAS_W || h > MAX_CANVAS_H) {
        const scale = Math.min(MAX_CANVAS_W / w, MAX_CANVAS_H / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      setCanvasSize({ w, h });
    };
    img.onerror = () => setCanvasSize({ w: DEFAULT_CANVAS_W, h: DEFAULT_CANVAS_H });
    img.src = url;
  }, [resolvedImageUrl, initialImageUrl]);

  useEffect(() => {
    loadInitialImage();
  }, [loadInitialImage]);

  const resolvePaintImageUrl = useCallback(() => {
    const isLocal = initialImageUrl?.startsWith('local-resource://') || initialImageUrl?.startsWith('file://');
    return isLocal ? resolvedImageUrl : (resolvedImageUrl ?? initialImageUrl);
  }, [initialImageUrl, resolvedImageUrl]);

  const blitBaseToMainCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasSize.w <= 0 || canvasSize.h <= 0) return;
    if (canvas.width !== canvasSize.w || canvas.height !== canvasSize.h) {
      canvas.width = canvasSize.w;
      canvas.height = canvasSize.h;
    }
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasSize.w, canvasSize.h);
    const img = baseImageRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, 0, 0, canvasSize.w, canvasSize.h);
    }
  }, [canvasSize.w, canvasSize.h]);

  const paintBaseImage = useCallback(() => {
    const url = resolvePaintImageUrl();
    if (!url) {
      baseImageRef.current = null;
      if (!initialImageUrl) initCanvas();
      return;
    }
    const cached = baseImageRef.current;
    if (cached && lastPaintedImageUrlRef.current === url && cached.complete && cached.naturalWidth > 0) {
      blitBaseToMainCanvas();
      return;
    }
    const img = new Image();
    if (!url.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => {
      lastPaintedImageUrlRef.current = url;
      baseImageRef.current = img;
      blitBaseToMainCanvas();
      hasDrawnRef.current = false;
    };
    img.onerror = () => {
      baseImageRef.current = null;
      initCanvas();
    };
    img.src = url;
  }, [resolvePaintImageUrl, initialImageUrl, blitBaseToMainCanvas, initCanvas]);

  useEffect(() => {
    paintBaseImage();
  }, [paintBaseImage]);

  useEffect(() => {
    if (!isFullscreen) return;
    const timer = window.setTimeout(() => paintBaseImage(), 280);
    return () => window.clearTimeout(timer);
  }, [isFullscreen, paintBaseImage]);

  useEffect(() => {
    const el = canvasWrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setCanvasHostSize({ w: Math.max(0, Math.floor(rect.width)), h: Math.max(0, Math.floor(rect.height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isFullscreen]);

  const canvasFrameSize = useMemo(() => {
    const { w: cw, h: ch } = canvasSize;
    if (cw <= 0 || ch <= 0) return null;

    if (isFullscreen) {
      let hw = canvasHostSize.w;
      let hh = canvasHostSize.h;
      if (hw <= 0 || hh <= 0) {
        if (typeof window === 'undefined') return null;
        hw = window.innerWidth;
        hh = Math.max(160, window.innerHeight - FULLSCREEN_CHROME_ESTIMATE_PX);
      }
      const scale = Math.min(hw / cw, hh / ch) * zoomScale;
      return {
        w: Math.max(1, Math.round(cw * scale)),
        h: Math.max(1, Math.round(ch * scale)),
      };
    }

    if (typeof window === 'undefined') return null;
    const maxW = Math.min(window.innerWidth * 0.92, 720) - 32;
    const maxH = window.innerHeight * 0.6;
    const scale = Math.min(maxW / cw, maxH / ch, 1) * zoomScale;
    return {
      w: Math.max(1, Math.round(cw * scale)),
      h: Math.max(1, Math.round(ch * scale)),
    };
  }, [isFullscreen, canvasSize, canvasHostSize, zoomScale]);

  const stackedCanvasStyle = { width: '100%', height: '100%' } as const;

  // 全屏切换与容器尺寸变化后立即重绘底图（明亮模式 GPU 合成层偶发不刷新）
  useLayoutEffect(() => {
    if (!isFullscreen) return;
    blitBaseToMainCanvas();
    const raf = requestAnimationFrame(() => blitBaseToMainCanvas());
    const timer = window.setTimeout(() => blitBaseToMainCanvas(), 120);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [isFullscreen, isDarkMode, canvasHostSize.w, canvasHostSize.h, zoomScale, canvasFrameSize?.w, canvasFrameSize?.h, blitBaseToMainCanvas]);

  useEffect(() => {
    const layer = drawLayerRef.current;
    if (!layer || canvasSize.w <= 0 || canvasSize.h <= 0) return;
    layer.width = canvasSize.w;
    layer.height = canvasSize.h;
    const ctx = layer.getContext('2d', { alpha: true });
    drawCtxRef.current = ctx;
    if (ctx) ctx.clearRect(0, 0, canvasSize.w, canvasSize.h);
  }, [canvasSize.w, canvasSize.h]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || canvasSize.w <= 0 || canvasSize.h <= 0) return;
    overlay.width = canvasSize.w;
    overlay.height = canvasSize.h;
    overlayCtxRef.current = overlay.getContext('2d', { alpha: true });
  }, [canvasSize.w, canvasSize.h]);

  const getCanvasPos = (e: React.PointerEvent | PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvasSize.w / rect.width;
    const scaleY = canvasSize.h / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const updateEraserCursor = useCallback(
    (clientX: number, clientY: number) => {
      const el = eraserCursorRef.current;
      const canvas = canvasRef.current;
      if (!el || !canvas || toolModeRef.current !== 'eraser') return;
      const rect = canvas.getBoundingClientRect();
      const scale = rect.width / canvasSize.w;
      const size = (eraserSizeRef.current * ERASER_SIZE_SCALE * scale);
      const x = clientX - rect.left - size / 2;
      const y = clientY - rect.top - size / 2;
      el.style.display = 'block';
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.transform = `translate(${x}px, ${y}px)`;
    },
    [canvasSize.w]
  );

  const hideEraserCursor = useCallback(() => {
    const el = eraserCursorRef.current;
    if (el) el.style.display = 'none';
  }, []);

  const drawHollowRect = useCallback(
    (x1: number, y1: number, x2: number, y2: number) => {
      const ctx = getDrawContext();
      if (!ctx) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = brushSize;
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      hasDrawnRef.current = true;
    },
    [getDrawContext, color, brushSize]
  );

  const drawHollowCircle = useCallback(
    (x1: number, y1: number, x2: number, y2: number) => {
      const ctx = getDrawContext();
      if (!ctx) return;
      const rx = Math.abs(x2 - x1) / 2;
      const ry = Math.abs(y2 - y1) / 2;
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      ctx.strokeStyle = color;
      ctx.lineWidth = brushSize;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(rx, 2), Math.max(ry, 2), 0, 0, Math.PI * 2);
      ctx.stroke();
      hasDrawnRef.current = true;
    },
    [getDrawContext, color, brushSize]
  );

  const drawPreviewOnOverlay = useCallback(
    (x1: number, y1: number, x2: number, y2: number) => {
      const ctx = overlayCtxRef.current;
      if (!ctx) return;
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.strokeStyle = colorRef.current;
      ctx.lineWidth = brushSizeRef.current;
      const mode = toolModeRef.current;
      if (mode === 'rect') {
        ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      } else {
        const rx = Math.abs(x2 - x1) / 2;
        const ry = Math.abs(y2 - y1) / 2;
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(rx, 2), Math.max(ry, 2), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    },
    []
  );

  const clearOverlay = useCallback(() => {
    const ctx = overlayCtxRef.current;
    if (ctx) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }, []);

  const drawTextAt = useCallback(
    (x: number, y: number, text: string) => {
      const ctx = getDrawContext();
      if (!ctx || !text.trim()) return;
      const fontSize = Math.max(12, brushSize * 2);
      const lineHeight = fontSize * 1.2;
      ctx.fillStyle = color;
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textBaseline = 'top';
      const lines = text.trim().split('\n');
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], x, y + i * lineHeight);
      }
      hasDrawnRef.current = true;
    },
    [getDrawContext, color, brushSize]
  );

  const handleMouseDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const pos = getCanvasPos(e);
    if (!pos) return;
    if (toolMode === 'text') {
      if (textPos) {
        handleTextConfirm();
        return;
      }
      setTextPos(pos);
      setTextInput('');
      return;
    }
    lastPosRef.current = pos;
    shapeStartRef.current = pos;
    isDrawingRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (toolMode === 'brush' || toolMode === 'eraser') {
      const ctx = getDrawContext();
      if (ctx) {
        const mode = toolModeRef.current;
        if (mode === 'eraser') {
          const size = eraserSizeRef.current * ERASER_SIZE_SCALE;
          ctx.globalCompositeOperation = 'destination-out';
          ctx.fillStyle = 'rgba(0,0,0,1)';
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, size / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        } else {
          ctx.fillStyle = colorRef.current;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, brushSizeRef.current / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        hasDrawnRef.current = true;
      }
    }
  };

  const handleMouseMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pos = getCanvasPos(e);
    if (pos) lastMousePosRef.current = pos;
    if (toolModeRef.current === 'eraser') {
      updateEraserCursor(e.clientX, e.clientY);
    } else {
      hideEraserCursor();
    }
    if (isDrawingRef.current && (toolMode === 'rect' || toolMode === 'circle') && pos && shapeStartRef.current) {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = requestAnimationFrame(() => {
        drawPreviewOnOverlay(shapeStartRef.current!.x, shapeStartRef.current!.y, pos.x, pos.y);
        rafIdRef.current = null;
      });
    }
    if (!isDrawingRef.current || (toolMode !== 'brush' && toolMode !== 'eraser')) return;
    if (pos && lastPosRef.current) {
      pendingDrawsRef.current.push({ from: { ...lastPosRef.current }, to: { ...pos } });
      lastPosRef.current = pos;
      if (!drawRAFRef.current) {
        drawRAFRef.current = requestAnimationFrame(() => {
          flushPendingDraws();
          drawRAFRef.current = null;
        });
      }
    }
  };

  const flushPendingDraws = useCallback(() => {
    const draws = pendingDrawsRef.current;
    if (draws.length === 0) return;
    const ctx = getDrawContext();
    if (!ctx) return;
    const mode = toolModeRef.current;
    if (mode === 'eraser') {
      const size = eraserSizeRef.current * ERASER_SIZE_SCALE;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(draws[0].from.x, draws[0].from.y);
      for (const d of draws) {
        ctx.lineTo(d.to.x, d.to.y);
      }
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = colorRef.current;
      ctx.lineWidth = brushSizeRef.current;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(draws[0].from.x, draws[0].from.y);
      for (const d of draws) {
        ctx.lineTo(d.to.x, d.to.y);
      }
      ctx.stroke();
    }
    hasDrawnRef.current = true;
    pendingDrawsRef.current = [];
  }, [getDrawContext]);

  const handleMouseUp = (e?: React.PointerEvent<HTMLCanvasElement>) => {
    if (toolMode === 'brush' || toolMode === 'eraser') {
      flushPendingDraws();
      if (drawRAFRef.current) {
        cancelAnimationFrame(drawRAFRef.current);
        drawRAFRef.current = null;
      }
    }
    if (toolMode === 'rect' || toolMode === 'circle') {
      clearOverlay();
      const pos = e ? getCanvasPos(e) : lastMousePosRef.current;
      if (pos && shapeStartRef.current) {
        if (toolMode === 'rect') {
          drawHollowRect(shapeStartRef.current.x, shapeStartRef.current.y, pos.x, pos.y);
        } else {
          drawHollowCircle(shapeStartRef.current.x, shapeStartRef.current.y, pos.x, pos.y);
        }
      }
    }
    isDrawingRef.current = false;
    lastPosRef.current = null;
    shapeStartRef.current = null;
  };

  const handleTextConfirm = () => {
    if (textPos && textInput.trim()) {
      drawTextAt(textPos.x, textPos.y, textInput);
    }
    setTextPos(null);
    setTextInput('');
  };

  const handleToolModeChange = (mode: ToolMode) => {
    if (textPos) {
      handleTextConfirm();
    }
    if (mode !== 'eraser') {
      hideEraserCursor();
    }
    setToolMode(mode);
  };

  const handleMouseUpRef = useRef(handleMouseUp);
  handleMouseUpRef.current = handleMouseUp;

  useEffect(() => {
    const onUp = () => handleMouseUpRef.current();
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, []);

  const handleClear = () => {
    const ctx = drawCtxRef.current;
    if (ctx) ctx.clearRect(0, 0, canvasSize.w, canvasSize.h);
    hasDrawnRef.current = false;
  };

  const handleConfirm = () => {
    const canvas = canvasRef.current;
    const drawLayer = drawLayerRef.current;
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      onCancel();
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      onCancel();
      return;
    }
    if (hasDrawnRef.current && drawLayer) {
      ctx.drawImage(drawLayer, 0, 0);
    }
    let dataUrl: string;
    try {
      dataUrl = canvas.toDataURL('image/png');
    } catch (e) {
      console.error('[CanvasToolPanel] toDataURL 失败（可能因跨域图片导致 canvas 污染）:', e);
      showAlert(tt.exportCrossOriginAlert);
      return;
    }
    const shouldExport = hasDrawnRef.current;
    if (nodeId && onApplyToNode) {
      onApplyToNode(nodeId, dataUrl);
    } else if (shouldExport) {
      onConfirm(dataUrl);
    } else {
      onCancel();
    }
  };

  const applyPresetColor = useCallback((c: string) => {
    setColor(c);
  }, []);

  return createPortal(
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center ${
        isFullscreen ? (isDarkMode ? 'bg-zinc-900' : 'bg-white') : 'bg-black/50'
      } ${!isDarkMode ? 'light-mode' : ''}`}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        ref={panelRef}
        className={`overflow-hidden flex flex-col ${isDarkMode ? 'nexflow-glass-panel border-white/10' : 'bg-white border-gray-200'} ${
          isFullscreen ? 'fixed inset-0 w-screen h-screen border-0' : 'rounded-2xl shadow-2xl border transition-[border-radius,box-shadow] duration-200'
        }`}
        style={isFullscreen ? { width: '100vw', height: '100vh' } : { width: 'min(92vw, 720px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`flex flex-col gap-2 px-4 py-3 flex-shrink-0 border-b sm:flex-row sm:items-center sm:gap-3 ${
            isDarkMode ? 'border-white/10' : 'border-gray-200/80'
          }`}
        >
          <h3 className={`font-semibold text-sm shrink-0 ${isDarkMode ? 'text-white/90' : 'text-gray-800'}`}>
            {tt.panelTitle}
          </h3>
          <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1 sm:justify-end">
            <div
              className={`flex items-center gap-0.5 rounded-lg px-1 py-0.5 ${isDarkMode ? 'apple-panel' : 'border border-gray-200/80 bg-gray-50'}`}
              title={tt.wheelZoomTitle}
            >
              <button
                type="button"
                onClick={() => setZoomScale((s) => Math.max(0.5, s - 0.2))}
                className={canvasToolIcon(isDarkMode, 'sensing')}
                title={tt.zoomOutTitle}
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className={`text-[10px] min-w-[3.5ch] tabular-nums px-1 ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>
                {Math.round(zoomScale * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoomScale((s) => Math.min(3, s + 0.2))}
                className={canvasToolIcon(isDarkMode, 'sensing')}
                title={tt.zoomInTitle}
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
            <button
              type="button"
              onClick={handleFullscreenToggle}
              className={canvasToolPill(isDarkMode, 'looks')}
              title={isFullscreen ? tt.fullscreenExit : tt.fullscreenToggleTitle}
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              {isFullscreen ? tt.fullscreenExit : tt.fullscreenEnter}
            </button>
            <button type="button" onClick={handleClear} className={canvasToolPill(isDarkMode, 'events')}>
              <Eraser className="w-3.5 h-3.5" />
              {tt.clear}
            </button>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 self-stretch sm:self-auto">
            <button
              type="button"
              onClick={handleConfirm}
              className={assetLibBtnPrimary(isDarkMode, 'shrink-0', 'operators')}
            >
              <Check className="w-3.5 h-3.5" />
              {tt.done}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className={assetLibBtnSecondary(isDarkMode, 'shrink-0', 'control')}
            >
              <X className="w-3.5 h-3.5" />
              {tt.cancel}
            </button>
          </div>
        </div>

        <div className={`p-4 flex flex-col gap-4 ${isFullscreen ? 'flex-1 min-h-0 overflow-hidden' : ''}`}>
          <div className="flex flex-col gap-2 flex-shrink-0">
            <span className={`text-[11px] font-medium ${isDarkMode ? 'text-white/45' : 'text-gray-500'}`}>{tt.color}</span>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => applyPresetColor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${
                    color === c
                      ? isDarkMode
                        ? 'border-violet-300 ring-2 ring-violet-400/40'
                        : 'border-violet-500 ring-2 ring-violet-400/30'
                      : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                  aria-label={tt.colorAria(c)}
                />
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3 flex-shrink-0">
            <div className="flex flex-col gap-2 flex-1 min-w-[180px] max-w-sm">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-[11px] font-medium ${isDarkMode ? 'text-white/45' : 'text-gray-500'}`}>
                  {isEraserTool ? tt.eraserSizeLabel : tt.brushSizeLabel}
                </span>
                <span className={`text-[10px] tabular-nums ${isDarkMode ? 'text-white/55' : 'text-gray-500'}`}>
                  {activeStrokeSize}px
                </span>
              </div>
              <div
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 ${isDarkMode ? 'apple-panel' : 'apple-panel-light'}`}
              >
                <input
                  type="range"
                  min={strokeSizeMin}
                  max={strokeSizeMax}
                  step={1}
                  value={activeStrokeSize}
                  title={isEraserTool ? tt.eraserSizeLabel : tt.brushSizeLabel}
                  aria-label={isEraserTool ? tt.eraserSizeLabel : tt.brushSizeLabel}
                  onChange={(ev) => handleStrokeSizeChange(parseInt(ev.target.value, 10))}
                  className="min-w-[100px] flex-1 accent-violet-500"
                />
                <span
                  className="shrink-0 rounded-full border border-white/10"
                  style={{
                    width: Math.min(activeStrokeSize, 22),
                    height: Math.min(activeStrokeSize, 22),
                    backgroundColor: isEraserTool ? (isDarkMode ? '#94a3b8' : '#64748b') : color,
                  }}
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <span className={`text-[11px] font-medium ${isDarkMode ? 'text-white/45' : 'text-gray-500'}`}>{tt.shape}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleToolModeChange('brush')}
                  className={canvasToolIcon(isDarkMode, 'motion', toolMode === 'brush')}
                  title={tt.toolBrushTitle}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleToolModeChange('eraser')}
                  className={canvasToolIcon(isDarkMode, 'myBlocks', toolMode === 'eraser')}
                  title={tt.toolEraserTitle}
                >
                  <Eraser className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleToolModeChange('rect')}
                  className={canvasToolIcon(isDarkMode, 'looks', toolMode === 'rect')}
                  title={tt.toolRectTitle}
                >
                  <Square className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleToolModeChange('circle')}
                  className={canvasToolIcon(isDarkMode, 'sound', toolMode === 'circle')}
                  title={tt.toolCircleTitle}
                >
                  <Circle className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleToolModeChange('text')}
                  className={canvasToolIcon(isDarkMode, 'variables', toolMode === 'text')}
                  title={tt.toolTextTitle}
                >
                  <Type className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
          <div
            ref={canvasWrapperRef}
            className={`flex justify-center relative w-full ${isFullscreen ? 'flex-1 min-h-0 items-center overflow-hidden' : ''}`}
          >
            <div
              className={`relative shrink-0 ${isFullscreen ? '' : 'inline-block'}`}
              style={
                canvasFrameSize
                  ? { width: canvasFrameSize.w, height: canvasFrameSize.h, isolation: 'isolate' }
                  : { width: canvasSize.w, height: canvasSize.h, maxWidth: '100%', maxHeight: '60vh' }
              }
            >
              <canvas
                ref={canvasRef}
                width={canvasSize.w}
                height={canvasSize.h}
                className={`touch-none rounded-lg bg-white block cursor-crosshair absolute inset-0 w-full h-full ${isDarkMode ? 'border-0' : 'border'}`}
                style={{
                  ...stackedCanvasStyle,
                  boxShadow: isDarkMode ? undefined : '0 2px 8px rgba(0,0,0,0.15)',
                }}
                onPointerDown={handleMouseDown}
                onPointerMove={handleMouseMove}
                onPointerUp={(e) => handleMouseUp(e)}
                onPointerLeave={(e) => {
                  handleMouseUp(e);
                  hideEraserCursor();
                }}
                onPointerCancel={(e) => handleMouseUp(e)}
              />
              <canvas
                ref={drawLayerRef}
                width={canvasSize.w}
                height={canvasSize.h}
                className="absolute inset-0 w-full h-full border-0 rounded-lg pointer-events-none"
                style={stackedCanvasStyle}
              />
              <canvas
                ref={overlayRef}
                width={canvasSize.w}
                height={canvasSize.h}
                className="absolute inset-0 w-full h-full border-0 rounded-lg pointer-events-none"
                style={stackedCanvasStyle}
              />
              <div
                ref={eraserCursorRef}
                className="pointer-events-none absolute left-0 top-0 hidden rounded-full border-2 border-gray-500/90"
                style={{ willChange: 'transform, width, height' }}
              />
              {textPos && (
                <textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setTextPos(null); setTextInput(''); }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  placeholder={tt.textPlaceholder}
                  className="absolute outline-none border-0 bg-transparent px-0.5 py-0 cursor-text resize-none overflow-auto"
                  style={{
                    left: `${(textPos.x / canvasSize.w) * 100}%`,
                    top: `${(textPos.y / canvasSize.h) * 100}%`,
                    width: `${Math.max(20, 100 - (textPos.x / canvasSize.w) * 100 - 2)}%`,
                    minHeight: 48,
                    maxHeight: `${Math.max(40, 100 - (textPos.y / canvasSize.h) * 100 - 2)}%`,
                    fontSize: Math.max(12, brushSize * 2),
                    color,
                    fontFamily: 'sans-serif',
                    caretColor: color,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                  rows={3}
                  autoFocus
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default CanvasToolPanel;
