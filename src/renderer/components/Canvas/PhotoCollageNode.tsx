// @ts-nocheck
import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';
import {
  LayoutGrid,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  ChevronsDown,
  Trash2,
  Download,
  ImagePlus,
  Maximize2,
  FlipHorizontal2,
  FlipVertical2,
  RotateCcw,
} from 'lucide-react';
import { mapProjectPath } from '../../utils/pathMapper';
import { scaleModulePx } from '../../utils/moduleDisplayScale';
import {
  applyLayerTransform,
  collageLayerSourceNodeId,
  isPhotoCollageLayerEdge,
  layerHasTransform,
  paintLayerWithTransform,
} from '../../utils/collageLayerTransform';
import { PhotoCollageFullscreenView } from './PhotoCollageFullscreenView';
import { PhotoCollageLayerItem } from './PhotoCollageLayerItem';
import { PhotoCollageRotationKnob } from './PhotoCollageRotationKnob';
import { PhotoCollageAspectRatioDropdown } from './PhotoCollageAspectRatioDropdown';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { photoCollageT } from '../../i18n/photoCollageI18n';

export interface CollageLayer {
  id: string;
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  /** 创建该图层的上游画布节点 id（图片节点连线进入拼图时） */
  sourceNodeId?: string;
  /** 绕图层中心旋转（度） */
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
}

export interface PhotoCollageNodeData {
  width?: number;
  height?: number;
  /** 拼图逻辑画布宽度（像素） */
  collageCanvasW?: number;
  /** 拼图逻辑画布高度（像素） */
  collageCanvasH?: number;
  layers?: CollageLayer[];
}

interface PhotoCollageNodeProps extends NodeProps<PhotoCollageNodeData> {
  projectId?: string;
  isDarkMode?: boolean;
  onDataChange?: (nodeId: string, updates: Partial<PhotoCollageNodeData>) => void;
  /** 将当前拼图栅格导出为画布上的图片节点（Workspace 注入） */
  onExportToCanvas?: (
    nodeId: string,
    dataUrl: string,
    logicalW: number,
    logicalH: number,
  ) => void | Promise<void>;
}

/** 与 ImageNode 一致：本地路径 → local-resource，http/data 原样 */
function formatImagePath(path: string): string {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:') || path.startsWith('blob:'))
    return path;
  if (path.startsWith('local-resource://')) return path;
  const cleanPath = path.replace(/^(file:\/\/|local-resource:\/\/)/, '');
  let normalizedPath = cleanPath.replace(/\\/g, '/');
  if (normalizedPath.match(/^([a-zA-Z])\//)) {
    normalizedPath = normalizedPath[0].toUpperCase() + ':' + normalizedPath.substring(1);
  }
  if (normalizedPath.match(/^\/[a-zA-Z]:/)) normalizedPath = normalizedPath.substring(1);
  const pathParts = normalizedPath.split('/');
  const encodedParts = pathParts.map((part, index) => {
    if (index === 0 && /^[a-zA-Z]:$/.test(part)) return part;
    if (/[\u4e00-\u9fa5\s]/.test(part)) return encodeURIComponent(part);
    return part;
  });
  return `local-resource://${encodedParts.join('/')}`;
}

function paintCollageBoardBackground(ctx: CanvasRenderingContext2D, cw: number, ch: number) {
  ctx.fillStyle = '#1a1a1f';
  ctx.fillRect(0, 0, cw, ch);
  const cell = 8;
  ctx.fillStyle = '#2a2a30';
  for (let y = 0; y < ch; y += cell) {
    for (let x = 0; x < cw; x += cell) {
      if ((Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0) {
        ctx.fillRect(x, y, Math.min(cell, cw - x), Math.min(cell, ch - y));
      }
    }
  }
}

function loadImageForRaster(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const im = new Image();
    if (/^https?:\/\//i.test(src)) {
      try {
        im.crossOrigin = 'anonymous';
      } catch {
        /* ignore */
      }
    }
    const finish = () => resolve(im.naturalWidth > 0 ? im : null);
    im.onload = finish;
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

/**
 * 用 Canvas2D 按逻辑像素重绘拼图（与 DOM 中 object-contain 一致），避免 html2canvas 对图片/半透明合成失真（如背景变黑）。
 */
async function rasterizeCollageCanvas2D(
  cw: number,
  ch: number,
  layersSorted: CollageLayer[],
  resolveLayerSrc: (layer: CollageLayer) => string,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D 不可用');
  paintCollageBoardBackground(ctx, cw, ch);

  const loaded = await Promise.all(
    layersSorted.map(async (L) => {
      const src = resolveLayerSrc(L);
      if (!src) return { L, img: null as HTMLImageElement | null };
      const img = await loadImageForRaster(src);
      return { L, img };
    }),
  );

  for (const { L, img } of loaded) {
    if (!img || !img.naturalWidth) continue;
    paintLayerWithTransform(ctx, L, img);
  }
  return canvas;
}

const MIN_CANVAS = 64;
const MAX_CANVAS = 8192;
/** 预览区最大显示高度，避免节点 data.height 过大产生底部空白 */
const COLLAGE_MAX_PREVIEW_DISPLAY_H = scaleModulePx(360);
/** 预览区最大显示宽度（节点外框随画布比例收缩，标题/连线对齐棋盘） */
const COLLAGE_MAX_PREVIEW_DISPLAY_W = scaleModulePx(520);

const PhotoCollageNode: React.FC<PhotoCollageNodeProps> = ({
  id,
  data,
  selected = false,
  isDarkMode = true,
  projectId,
  onDataChange,
  onExportToCanvas,
}) => {
  const { setNodes, setEdges } = useReactFlow();
  const { locale } = useAppLocale();
  const ct = photoCollageT(locale);
  const cw = Math.max(MIN_CANVAS, Math.min(MAX_CANVAS, Number(data?.collageCanvasW) || 800));
  const ch = Math.max(MIN_CANVAS, Math.min(MAX_CANVAS, Number(data?.collageCanvasH) || 600));
  const layers: CollageLayer[] = Array.isArray(data?.layers) ? data.layers.slice() : [];
  const sorted = useMemo(() => [...layers].sort((a, b) => a.z - b.z), [layers]);
  const layersTopFirst = useMemo(() => [...sorted].reverse(), [sorted]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [resolvedSrc, setResolvedSrc] = useState<Record<string, string>>({});
  const boardRef = useRef<HTMLDivElement>(null);
  const fullscreenBoardRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(1);

  const [fullscreen, setFullscreen] = useState(false);
  const [fsViewport, setFsViewport] = useState({ w: typeof window !== 'undefined' ? window.innerWidth : 1200, h: 800 });

  /** 始终加载/解析图层与交互，不再因未选中降级为空占位（多拼图节点会多占解码与显存，按产品要求不做降级） */

  useEffect(() => {
    if (!fullscreen) return;
    const update = () => setFsViewport({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [fullscreen]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  const showFloatingUi = selected || isHovered;
  const floatIconBtn = (extra = '') =>
    `p-1.5 rounded-lg transition-all disabled:opacity-30 ${
      isDarkMode
        ? 'apple-panel hover:bg-white/20 text-white/80'
        : 'apple-panel-light hover:bg-gray-200/30 text-gray-700'
    } ${extra}`;

  useEffect(() => {
    let cancelled = false;
    const next: Record<string, string> = {};
    void (async () => {
      for (const L of layers) {
        const raw = formatImagePath(L.src || '');
        if (!raw) continue;
        let u = raw;
        if (projectId && u.startsWith('local-resource://')) {
          try {
            u = (await mapProjectPath(u, projectId)) || u;
          } catch {
            /* keep */
          }
        }
        next[L.id] = u;
      }
      if (!cancelled) setResolvedSrc(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [layers, projectId]);

  const getLayerSrc = useCallback(
    (L: CollageLayer) => resolvedSrc[L.id] || formatImagePath(L.src),
    [resolvedSrc],
  );

  const pushData = useCallback(
    (patch: Partial<PhotoCollageNodeData>) => {
      onDataChange?.(id, patch);
    },
    [id, onDataChange],
  );

  const setCanvasSize = useCallback(
    (w: number, h: number) => {
      const nw = Math.max(MIN_CANVAS, Math.min(MAX_CANVAS, Math.round(w)));
      const nh = Math.max(MIN_CANVAS, Math.min(MAX_CANVAS, Math.round(h)));
      const nextLayers = layers.map((L) => ({
        ...L,
        x: Math.max(0, Math.min(L.x, Math.max(0, nw - Math.max(1, L.w)))),
        y: Math.max(0, Math.min(L.y, Math.max(0, nh - Math.max(1, L.h)))),
        w: Math.min(Math.max(32, L.w), nw),
        h: Math.min(Math.max(32, L.h), nh),
      }));
      setNodes((nds) =>
        nds.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  collageCanvasW: nw,
                  collageCanvasH: nh,
                  layers: nextLayers,
                },
              }
            : node,
        ),
      );
      onDataChange?.(id, { collageCanvasW: nw, collageCanvasH: nh, layers: nextLayers });
    },
    [id, layers, setNodes, onDataChange],
  );

  const previewW = cw;
  const previewH = ch;

  const scale = Math.min(
    COLLAGE_MAX_PREVIEW_DISPLAY_W / Math.max(previewW, 1),
    COLLAGE_MAX_PREVIEW_DISPLAY_H / Math.max(previewH, 1),
    1,
  );
  scaleRef.current = scale;

  const boardDisplayW = Math.ceil(previewW * scale);
  const boardDisplayH = Math.ceil(previewH * scale);

  useEffect(() => {
    const patch: Partial<PhotoCollageNodeData> = {};
    if (data?.height == null || Math.abs(Number(data.height) - boardDisplayH) > 12) {
      patch.height = boardDisplayH;
    }
    if (data?.width == null || Math.abs(Number(data.width) - boardDisplayW) > 12) {
      patch.width = boardDisplayW;
    }
    if (Object.keys(patch).length > 0) pushData(patch);
  }, [boardDisplayW, boardDisplayH, data?.width, data?.height, pushData]);

  const normalizeZ = useCallback((list: CollageLayer[]) => {
    const o = [...list].sort((a, b) => a.z - b.z);
    return o.map((L, i) => ({ ...L, z: i * 10 }));
  }, []);

  const updateLayers = useCallback(
    (updater: (prev: CollageLayer[]) => CollageLayer[]) => {
      pushData({ layers: normalizeZ(updater(layers)) });
    },
    [layers, pushData, normalizeZ],
  );

  const selectedLayer = sorted.find((L) => L.id === selectedId) || null;

  const layerTransformEls = useRef(new Map<string, HTMLDivElement>());
  const [rotationPreview, setRotationPreview] = useState<{ layerId: string; deg: number } | null>(
    null,
  );

  const registerLayerTransformEl = useCallback((layerId: string, el: HTMLDivElement | null) => {
    if (el) layerTransformEls.current.set(layerId, el);
    else layerTransformEls.current.delete(layerId);
  }, []);

  const getLayerRotationDeg = useCallback(
    (layer: CollageLayer) => {
      if (rotationPreview?.layerId === layer.id) return rotationPreview.deg;
      return layer.rotation ?? 0;
    },
    [rotationPreview],
  );

  const setLayerRotationLive = useCallback((layer: CollageLayer, rotation: number) => {
    const el = layerTransformEls.current.get(layer.id);
    if (el) applyLayerTransform(el, { ...layer, rotation });
    setRotationPreview({ layerId: layer.id, deg: rotation });
  }, []);

  const commitLayerRotation = useCallback(
    (layerId: string, rotation: number) => {
      setRotationPreview(null);
      updateLayers((prev) =>
        prev.map((L) => (L.id === layerId ? { ...L, rotation } : L)),
      );
    },
    [updateLayers],
  );

  const onLayerRotationChange = useCallback(
    (layerId: string, deg: number) => {
      const layer = layers.find((L) => L.id === layerId);
      if (!layer) return;
      if (selectedId !== layerId) setSelectedId(layerId);
      setLayerRotationLive(layer, deg);
    },
    [layers, selectedId, setLayerRotationLive],
  );

  const onLayerRotationCommit = useCallback(
    (layerId: string, deg: number) => {
      commitLayerRotation(layerId, deg);
    },
    [commitLayerRotation],
  );

  const selectedRotationDeg = selectedLayer ? getLayerRotationDeg(selectedLayer) : 0;

  const onSelectedRotationChange = useCallback(
    (deg: number) => {
      if (!selectedLayer) return;
      onLayerRotationChange(selectedLayer.id, deg);
    },
    [selectedLayer, onLayerRotationChange],
  );

  const onSelectedRotationCommit = useCallback(
    (deg: number) => {
      if (!selectedLayer) return;
      onLayerRotationCommit(selectedLayer.id, deg);
    },
    [selectedLayer, onLayerRotationCommit],
  );

  const bringForward = () => {
    if (!selectedLayer) return;
    updateLayers((prev) =>
      prev.map((L) => (L.id === selectedLayer.id ? { ...L, z: L.z + 15 } : L)),
    );
  };
  const sendBackward = () => {
    if (!selectedLayer) return;
    updateLayers((prev) =>
      prev.map((L) => (L.id === selectedLayer.id ? { ...L, z: L.z - 15 } : L)),
    );
  };
  const bringToFront = () => {
    if (!selectedLayer) return;
    const maxZ = Math.max(0, ...layers.map((L) => L.z));
    updateLayers((prev) =>
      prev.map((L) => (L.id === selectedLayer.id ? { ...L, z: maxZ + 100 } : L)),
    );
  };
  const sendToBack = () => {
    if (!selectedLayer) return;
    const minZ = Math.min(0, ...layers.map((L) => L.z));
    updateLayers((prev) =>
      prev.map((L) => (L.id === selectedLayer.id ? { ...L, z: minZ - 100 } : L)),
    );
  };
  const removeLayer = () => {
    if (!selectedLayer) return;
    const layerId = selectedLayer.id;
    const sourceNodeId = collageLayerSourceNodeId(selectedLayer);
    updateLayers((prev) => prev.filter((L) => L.id !== layerId));
    setSelectedId(null);
    if (sourceNodeId) {
      setEdges((eds) => eds.filter((e) => !isPhotoCollageLayerEdge(e, id, sourceNodeId)));
    }
  };

  const flipSelectedHorizontal = () => {
    if (!selectedLayer) return;
    updateLayers((prev) =>
      prev.map((L) => (L.id === selectedLayer.id ? { ...L, flipH: !L.flipH } : L)),
    );
  };

  const flipSelectedVertical = () => {
    if (!selectedLayer) return;
    updateLayers((prev) =>
      prev.map((L) => (L.id === selectedLayer.id ? { ...L, flipV: !L.flipV } : L)),
    );
  };

  const resetLayerTransform = useCallback(
    (layerId: string) => {
      setRotationPreview(null);
      const el = layerTransformEls.current.get(layerId);
      const layer = layers.find((L) => L.id === layerId);
      if (el && layer) {
        applyLayerTransform(el, { ...layer, rotation: 0, flipH: false, flipV: false });
      }
      updateLayers((prev) =>
        prev.map((L) =>
          L.id === layerId ? { ...L, rotation: 0, flipH: false, flipV: false } : L,
        ),
      );
    },
    [layers, updateLayers],
  );

  const resetSelectedTransform = () => {
    setRotationPreview(null);
    if (!selectedLayer) return;
    resetLayerTransform(selectedLayer.id);
  };

  const exportPng = useCallback(async () => {
    try {
      const canvas = await rasterizeCollageCanvas2D(cw, ch, sorted, (L) => resolvedSrc[L.id] || formatImagePath(L.src));
      const url = canvas.toDataURL('image/png');
      if (window.electronAPI?.downloadImage) {
        await window.electronAPI.downloadImage(url, `collage-${id.slice(0, 8)}`);
        return;
      }
      const a = document.createElement('a');
      a.href = url;
      a.download = `collage-${id.slice(0, 8)}.png`;
      a.click();
    } catch (e) {
      console.error('[PhotoCollage] 导出失败', e);
    }
  }, [cw, ch, id, sorted, resolvedSrc]);

  const exportToCanvas = useCallback(async () => {
    if (!onExportToCanvas) return;
    try {
      const canvas = await rasterizeCollageCanvas2D(cw, ch, sorted, (L) => resolvedSrc[L.id] || formatImagePath(L.src));
      const dataUrl = canvas.toDataURL('image/png');
      await onExportToCanvas(id, dataUrl, cw, ch);
    } catch (e) {
      console.error('[PhotoCollage] 导出到画布失败', e);
      throw e;
    }
  }, [cw, ch, id, sorted, resolvedSrc, onExportToCanvas]);

  const onLayerMouseDown = (
    e: React.MouseEvent,
    layer: CollageLayer,
    mode: 'move' | 'resize' | 'rotate',
    interactionScale?: number,
    logicalCW?: number,
    logicalCH?: number,
    boardElRef?: React.RefObject<HTMLDivElement | null>,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedId(layer.id);
    const startX = e.clientX;
    const startY = e.clientY;
    const ox = layer.x;
    const oy = layer.y;
    const ow = layer.w;
    const oh = layer.h;
    const sc = interactionScale ?? (scaleRef.current || 1);
    const lw = typeof logicalCW === 'number' ? logicalCW : previewW;
    const lh = typeof logicalCH === 'number' ? logicalCH : previewH;
    const boardEl = boardElRef?.current;

    const clientToLogical = (clientX: number, clientY: number) => {
      if (!boardEl) {
        return {
          x: (clientX - startX) / sc + ox + ow / 2,
          y: (clientY - startY) / sc + oy + oh / 2,
        };
      }
      const rect = boardEl.getBoundingClientRect();
      return {
        x: (clientX - rect.left) / sc,
        y: (clientY - rect.top) / sc,
      };
    };

    const cx = ox + ow / 2;
    const cy = oy + oh / 2;
    const startRot = layer.rotation ?? 0;
    const startPointer = clientToLogical(e.clientX, e.clientY);
    const startAngle = Math.atan2(startPointer.y - cy, startPointer.x - cx);

    const onMove = (ev: MouseEvent) => {
      if (mode === 'rotate') {
        const p = clientToLogical(ev.clientX, ev.clientY);
        const angle = Math.atan2(p.y - cy, p.x - cx);
        const deltaDeg = ((angle - startAngle) * 180) / Math.PI;
        const nextRot = startRot + deltaDeg;
        setNodes((nds) => {
          const node = nds.find((n) => n.id === id);
          const list = ((node?.data || {})?.layers || []) as CollageLayer[];
          const nextLayers = list.map((L) => (L.id === layer.id ? { ...L, rotation: nextRot } : L));
          onDataChange?.(id, { layers: nextLayers });
          return nds.map((n) =>
            n.id === id ? { ...n, data: { ...n.data, layers: nextLayers } } : n,
          );
        });
        return;
      }
      const dx = (ev.clientX - startX) / sc;
      const dy = (ev.clientY - startY) / sc;
      setNodes((nds) => {
        const node = nds.find((n) => n.id === id);
        const list = ((node?.data || {})?.layers || []) as CollageLayer[];
        let nextLayers: CollageLayer[];
        if (mode === 'move') {
          const nx = Math.round(Math.max(0, Math.min(lw - ow, ox + dx)));
          const ny = Math.round(Math.max(0, Math.min(lh - oh, oy + dy)));
          nextLayers = list.map((L) => (L.id === layer.id ? { ...L, x: nx, y: ny } : L));
        } else {
          const nw = Math.round(Math.max(32, Math.min(lw - ox, ow + dx)));
          const nh = Math.round(Math.max(32, Math.min(lh - oy, oh + dy)));
          nextLayers = list.map((L) => (L.id === layer.id ? { ...L, w: nw, h: nh } : L));
        }
        onDataChange?.(id, { layers: nextLayers });
        return nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, layers: nextLayers } } : n,
        );
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setNodes((nds) => {
        const node = nds.find((n) => n.id === id);
        const list = ((node?.data || {})?.layers || []) as CollageLayer[];
        if (list.length) onDataChange?.(id, { layers: list });
        return nds;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      data-id={id}
      className="custom-node-container group relative rounded-2xl overflow-visible p-0 bg-transparent shadow-none custom-node-container--transparent transition-all duration-200"
      style={{ width: boardDisplayW, height: boardDisplayH, minWidth: boardDisplayW, minHeight: boardDisplayH }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        style={{ top: '50%' }}
        className="nexflow-plus-handle nexflow-plus-handle-left"
        title={ct.importFromNodesTitle}
      />

      {showFloatingUi ? (
        <div className="title-area absolute -top-7 left-0 z-10 flex items-center gap-1.5 whitespace-nowrap">
          <LayoutGrid className={`w-3.5 h-3.5 ${isDarkMode ? 'text-violet-300' : 'text-violet-600'}`} />
          <span className={`text-xs font-bold ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>{ct.nodeTitle}</span>
        </div>
      ) : null}

      <div
        className="relative overflow-visible rounded-2xl"
        style={{
          width: boardDisplayW,
          height: boardDisplayH,
        }}
      >
        <div
          ref={boardRef}
          className="absolute left-0 top-0 origin-top-left overflow-visible"
          style={{
            width: previewW,
            height: previewH,
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSelectedId(null);
          }}
        >
          <div
            className={`pointer-events-none absolute inset-0 overflow-hidden rounded-2xl ${
              isDarkMode ? 'bg-[#1a1a1f]' : 'bg-[#F0F0F0]'
            }`}
            style={
              isDarkMode
                ? {
                    backgroundImage:
                      'linear-gradient(45deg, #2a2a30 25%, transparent 25%), linear-gradient(-45deg, #2a2a30 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a30 75%), linear-gradient(-45deg, transparent 75%, #2a2a30 75%)',
                    backgroundSize: '16px 16px',
                    backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
                  }
                : undefined
            }
            aria-hidden
          />
          {sorted.map((L) => {
            const src = resolvedSrc[L.id] || formatImagePath(L.src);
            const isSel = selectedId === L.id;
            return (
              <PhotoCollageLayerItem
                key={L.id}
                layer={L}
                selected={isSel}
                src={src}
                isDarkMode={isDarkMode}
                rotationDeg={getLayerRotationDeg(L)}
                onMove={(e) => onLayerMouseDown(e, L, 'move', undefined, undefined, undefined, boardRef)}
                onResize={(e) => onLayerMouseDown(e, L, 'resize', undefined, undefined, undefined, boardRef)}
                registerTransformEl={(el) => registerLayerTransformEl(L.id, el)}
              />
            );
          })}
        </div>
      </div>

      {showFloatingUi ? (
        <div
          className="nodrag nopan node-floating-toolbar absolute top-full left-1/2 z-10 mt-1.5 flex w-max max-w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 flex-wrap items-center justify-center gap-x-2 gap-y-1.5 px-1 overflow-visible"
          style={{ pointerEvents: 'all' }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          <PhotoCollageAspectRatioDropdown
            cw={cw}
            ch={ch}
            isDarkMode={isDarkMode}
            onApplySize={setCanvasSize}
          />

          <button
            type="button"
            title={ct.layerUp}
            disabled={!selectedLayer}
            onClick={(e) => {
              e.stopPropagation();
              bringForward();
            }}
            className={floatIconBtn()}
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={ct.layerDown}
            disabled={!selectedLayer}
            onClick={(e) => {
              e.stopPropagation();
              sendBackward();
            }}
            className={floatIconBtn()}
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={ct.layerFront}
            disabled={!selectedLayer}
            onClick={(e) => {
              e.stopPropagation();
              bringToFront();
            }}
            className={floatIconBtn()}
          >
            <ChevronsUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={ct.layerBack}
            disabled={!selectedLayer}
            onClick={(e) => {
              e.stopPropagation();
              sendToBack();
            }}
            className={floatIconBtn()}
          >
            <ChevronsDown className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={ct.flipH}
            disabled={!selectedLayer}
            onClick={(e) => {
              e.stopPropagation();
              flipSelectedHorizontal();
            }}
            className={floatIconBtn()}
          >
            <FlipHorizontal2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={ct.flipV}
            disabled={!selectedLayer}
            onClick={(e) => {
              e.stopPropagation();
              flipSelectedVertical();
            }}
            className={floatIconBtn()}
          >
            <FlipVertical2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={ct.deleteLayer}
            disabled={!selectedLayer}
            onClick={(e) => {
              e.stopPropagation();
              removeLayer();
            }}
            className={floatIconBtn(isDarkMode ? 'hover:!bg-red-500/20 !text-red-300' : 'hover:!bg-red-100 !text-red-600')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          {onExportToCanvas ? (
            <button
              type="button"
              title={ct.exportToWorkspaceTitle}
              onClick={(e) => {
                e.stopPropagation();
                void exportToCanvas();
              }}
              className={floatIconBtn(isDarkMode ? 'hover:!bg-sky-500/20 !text-sky-300' : 'hover:!bg-sky-100 !text-sky-700')}
            >
              <ImagePlus className="w-3.5 h-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            title={ct.fullscreenEdit}
            onClick={(e) => {
              e.stopPropagation();
              setFullscreen(true);
            }}
            className={floatIconBtn(isDarkMode ? 'hover:!bg-sky-500/20 !text-sky-300' : 'hover:!bg-sky-100 !text-sky-700')}
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={ct.resetTransform}
            disabled={!selectedLayer || !layerHasTransform(selectedLayer)}
            onClick={(e) => {
              e.stopPropagation();
              resetSelectedTransform();
            }}
            className={floatIconBtn()}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <PhotoCollageRotationKnob
            value={selectedRotationDeg}
            disabled={!selectedLayer}
            isDarkMode={isDarkMode}
            size={28}
            title={ct.rotateKnob}
            onChange={onSelectedRotationChange}
            onCommit={onSelectedRotationCommit}
          />
          <button
            type="button"
            title={ct.exportPng}
            onClick={(e) => {
              e.stopPropagation();
              void exportPng();
            }}
            className={floatIconBtn(isDarkMode ? 'hover:!bg-emerald-500/20 !text-emerald-300' : 'hover:!bg-emerald-100 !text-emerald-700')}
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : null}

      {fullscreen &&
        createPortal(
          <PhotoCollageFullscreenView
            cw={cw}
            ch={ch}
            setCanvasSize={setCanvasSize}
            sorted={sorted}
            layersTopFirst={layersTopFirst}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            getLayerSrc={getLayerSrc}
            fsViewport={fsViewport}
            onClose={() => setFullscreen(false)}
            onExport={exportPng}
            onExportToWorkspace={onExportToCanvas ? exportToCanvas : undefined}
            bringForward={bringForward}
            sendBackward={sendBackward}
            bringToFront={bringToFront}
            sendToBack={sendToBack}
            removeLayer={removeLayer}
            flipHorizontal={flipSelectedHorizontal}
            flipVertical={flipSelectedVertical}
            resetLayerTransform={resetLayerTransform}
            selectedLayer={selectedLayer}
            getLayerRotationDeg={getLayerRotationDeg}
            onLayerRotationChange={onLayerRotationChange}
            onLayerRotationCommit={onLayerRotationCommit}
            registerLayerTransformEl={registerLayerTransformEl}
            fullscreenBoardRef={fullscreenBoardRef}
            onLayerMouseDown={onLayerMouseDown}
            isDarkMode={isDarkMode}
          />,
          document.body,
        )}
    </div>
  );
};

export default PhotoCollageNode;
