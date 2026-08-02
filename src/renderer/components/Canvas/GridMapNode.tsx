import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeProps, useUpdateNodeInternals, useReactFlow } from 'reactflow';
import { LayoutGroup, motion } from 'framer-motion';
import {
  ChevronDown,
  LayoutTemplate,
  Trash2,
  LayoutGrid,
  Loader2,
  Plus,
  Check,
  X,
} from 'lucide-react';
import { PhotoCollageAspectRatioDropdown } from './PhotoCollageAspectRatioDropdown';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import { gridMapT } from '../../i18n/gridMapI18n';
import { scaleModulePx } from '../../utils/moduleDisplayScale';
import {
  DEFAULT_GRID_MAP_CANVAS_H,
  DEFAULT_GRID_MAP_CANVAS_W,
  DEFAULT_GRID_MAP_COLS,
  DEFAULT_GRID_MAP_GAP_PX,
  DEFAULT_GRID_MAP_ROWS,
  GRID_MAP_PRESETS,
  composeGridMapToDataUrl,
  formatGridMapImagePath,
  newGridMapCellId,
  resizeGridMapCells,
  resolveGridMapCanvasSizeForCellAspect,
  resolveGridMapCellAspectFromCanvas,
  type GridMapCell,
} from '../../utils/gridMapCompose';
import {
  aspectsApproximatelyEqual,
  clampCoverTranslate,
  coverTranslateLayout,
  coverTranslateToCropRect,
  cropImageToPngBuffer,
  loadImageNaturalSize,
} from '../../utils/imageCropUtils';
import { NODE_SIZE_TRANSITION, nodeStyleDimensions } from '../../utils/nodeSizeFromAspectRatio';
import { COLLAGE_ASPECT_GROUPS } from './photoCollageAspectRatio';
import { computeMultiGridCellRects } from '../../utils/multiImageGridPreview';

export type { GridMapCell };

/** 热更新版本戳：变更时强制 Workspace 重建 nodeTypes */
export const GRID_MAP_HMR_REV = 7;

/** 宫格比例仅保留常用五项 */
const GRID_MAP_ASPECT_IDS = ['16-9', '9-16', '4-3', '3-4', '1-1'] as const;

type CellPanAdjust = {
  index: number;
  url: string;
  imgW: number;
  imgH: number;
  cellW: number;
  cellH: number;
  /** cover 平移：上限恒为 0，下限为 cell - disp */
  offsetX: number;
  offsetY: number;
};

export interface GridMapNodeData {
  width?: number;
  height?: number;
  gridCols?: number;
  gridRows?: number;
  canvasW?: number;
  canvasH?: number;
  gapPx?: number;
  cells?: GridMapCell[];
  label?: string;
}

interface GridMapNodeProps extends NodeProps<GridMapNodeData> {
  projectId?: string;
  isDarkMode?: boolean;
  onDataChange?: (nodeId: string, updates: Partial<GridMapNodeData>) => void;
  onExportToCanvas?: (
    nodeId: string,
    dataUrl: string,
    logicalW: number,
    logicalH: number,
    label?: string,
  ) => void | Promise<void>;
  /** 空格：从画布点选图片模块 */
  onPickImageFromCanvas?: () => Promise<string | null>;
}

const GRID_MAP_MIME = 'application/x-nexflow-grid-map-cell';
/** 模块显示尺寸最短边下限（含 MODULE_DISPLAY_SCALE） */
export const GRID_MAP_MIN_SIDE = scaleModulePx(540);
export const GRID_MAP_MAX_SIDE = scaleModulePx(780);
const GRID_DRAG_THRESHOLD_PX = 6;
const GRID_LAYOUT_SPRING = { type: 'spring' as const, stiffness: 400, damping: 30 };

/** 按合成画布比例计算宫格模块在画布上的显示宽高 */
export function nodeOuterSizeForCanvas(cw: number, ch: number): { w: number; h: number } {
  const aspect = cw / Math.max(ch, 1);
  let w: number;
  let h: number;
  if (aspect >= 1) {
    w = GRID_MAP_MAX_SIDE;
    h = w / aspect;
  } else {
    h = GRID_MAP_MAX_SIDE;
    w = h * aspect;
  }
  const minSide = Math.min(w, h);
  if (minSide < GRID_MAP_MIN_SIDE) {
    const scale = GRID_MAP_MIN_SIDE / minSide;
    w *= scale;
    h *= scale;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

const GridMapNodeComponent: React.FC<GridMapNodeProps> = ({
  id,
  data,
  selected,
  isDarkMode = true,
  projectId,
  onDataChange,
  onExportToCanvas,
  onPickImageFromCanvas,
}) => {
  const { locale } = useAppLocale();
  const gt = useMemo(() => gridMapT(locale), [locale]);
  const { showAlert } = useDarkAlert();
  const updateNodeInternals = useUpdateNodeInternals();
  const { getZoom } = useReactFlow();
  const rootRef = useRef<HTMLDivElement>(null);

  const cols = Math.max(1, Math.min(6, Number(data?.gridCols) || DEFAULT_GRID_MAP_COLS));
  const rows = Math.max(1, Math.min(6, Number(data?.gridRows) || DEFAULT_GRID_MAP_ROWS));
  const canvasW = Math.max(64, Number(data?.canvasW) || DEFAULT_GRID_MAP_CANVAS_W);
  const canvasH = Math.max(64, Number(data?.canvasH) || DEFAULT_GRID_MAP_CANVAS_H);
  const gapPx = Math.max(0, Number(data?.gapPx) || DEFAULT_GRID_MAP_GAP_PX);

  /** 与格子可视比例一致：用于判断是否需要格内拖拽微调 */
  const cellAspect = useMemo(() => {
    const rects = computeMultiGridCellRects(canvasW, canvasH, cols, rows, gapPx, gapPx);
    const r = rects[0];
    if (r && r.h > 0) return r.w / r.h;
    return canvasW / Math.max(canvasH, 1);
  }, [canvasW, canvasH, cols, rows, gapPx]);

  /** 与比例下拉一致：单格画面比例文案（非整张画布） */
  const intakeRatioLabel = useMemo(() => {
    const r = cellAspect;
    const allowed = COLLAGE_ASPECT_GROUPS.filter((g) =>
      (GRID_MAP_ASPECT_IDS as readonly string[]).includes(g.id),
    );
    let best = allowed[0];
    let bestDiff = Infinity;
    for (const g of allowed) {
      const d = Math.abs(Math.log(r / (g.rw / Math.max(g.rh, 1))));
      if (d < bestDiff) {
        bestDiff = d;
        best = g;
      }
    }
    return best?.label || '1:1';
  }, [cellAspect]);

  /** 比例下拉用「单格」等效像素，避免显示成整张画布的 8:3 等 */
  const cellAspectDropdownSize = useMemo((): [number, number] => {
    if (cellAspect >= 1) return [Math.round(1080 * cellAspect), 1080];
    return [1080, Math.round(1080 / Math.max(cellAspect, 0.05))];
  }, [cellAspect]);

  const cells = useMemo(
    () => resizeGridMapCells(data?.cells, cols, rows),
    [data?.cells, cols, rows],
  );

  const [gridMenuOpen, setGridMenuOpen] = useState(false);
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [dragOverCell, setDragOverCell] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  /** 按住图片卡片拖拽换位（对齐项目卡片：挤开 + layout 弹簧） */
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [dragPreviewPos, setDragPreviewPos] = useState<{ x: number; y: number } | null>(null);
  /** 比例不符：图直接进格，格内拖拽平移后确认裁剪 */
  const [cellPanAdjust, setCellPanAdjust] = useState<CellPanAdjust | null>(null);
  const [cropBusy, setCropBusy] = useState(false);
  const panDragRef = useRef<{
    startClientX: number;
    startClientY: number;
    offsetX: number;
    offsetY: number;
    minX: number;
    minY: number;
    zoom: number;
  } | null>(null);
  const dragFromRef = useRef<number | null>(null);
  const dragStartOffsetRef = useRef({ x: 0, y: 0 });
  const dragCardSizeRef = useRef({ w: 80, h: 80 });
  const dropTargetIndexRef = useRef<number | null>(null);
  const ignoreNextClickRef = useRef(false);
  const pointerDownRef = useRef<{
    index: number;
    clientX: number;
    clientY: number;
    started: boolean;
  } | null>(null);

  const outer = useMemo(() => nodeOuterSizeForCanvas(canvasW, canvasH), [canvasW, canvasH]);

  /** 把真实显示尺寸写回 RF node.style / data，避免放大后连线锚点仍按旧宽高计算 */
  useEffect(() => {
    const dw = Number(data?.width);
    const dh = Number(data?.height);
    if (Math.abs(dw - outer.w) <= 1 && Math.abs(dh - outer.h) <= 1) return;
    onDataChange?.(id, { width: outer.w, height: outer.h });
  }, [id, outer.w, outer.h, data?.width, data?.height, onDataChange]);

  useEffect(() => {
    const sync = () => updateNodeInternals(id);
    const raf = requestAnimationFrame(sync);
    // 尺寸 CSS transition 结束后再刷一次 handle，避免过渡中途锚点错位
    const t = window.setTimeout(sync, 360);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [id, outer.w, outer.h, cols, rows, updateNodeInternals]);

  const persistCells = useCallback(
    (next: GridMapCell[]) => {
      onDataChange?.(id, { cells: next });
    },
    [id, onDataChange],
  );

  useEffect(() => {
    if (!cells.some((c) => !c.id)) return;
    persistCells(cells.map((c) => ({ ...c, id: c.id || newGridMapCellId() })));
  }, [cells, persistCells]);

  const applyCanvasSize = useCallback(
    (w: number, h: number) => {
      // 下拉给出的是「单格」目标比例（如 16:9），再反推整张合成画布
      const [nextW, nextH] = resolveGridMapCanvasSizeForCellAspect(w, h, cols, rows, gapPx);
      const sized = nodeOuterSizeForCanvas(nextW, nextH);
      onDataChange?.(id, {
        canvasW: nextW,
        canvasH: nextH,
        width: sized.w,
        height: sized.h,
      });
    },
    [id, onDataChange, cols, rows, gapPx],
  );

  const applyGridSize = useCallback(
    (nextCols: number, nextRows: number) => {
      const nextCells = resizeGridMapCells(cells, nextCols, nextRows);
      // 切换网格时保持单格比例不变，重算画布
      const cellA = resolveGridMapCellAspectFromCanvas(canvasW, canvasH, cols, rows, gapPx);
      const [nextW, nextH] = resolveGridMapCanvasSizeForCellAspect(
        cellA,
        1,
        nextCols,
        nextRows,
        gapPx,
      );
      const sized = nodeOuterSizeForCanvas(nextW, nextH);
      onDataChange?.(id, {
        gridCols: nextCols,
        gridRows: nextRows,
        cells: nextCells,
        canvasW: nextW,
        canvasH: nextH,
        width: sized.w,
        height: sized.h,
      });
      setGridMenuOpen(false);
      setSelectedCell(null);
    },
    [cells, id, onDataChange, canvasW, canvasH, cols, rows, gapPx],
  );

  const setCellAt = useCallback(
    (index: number, patch: GridMapCell) => {
      const next = cells.map((c, i) =>
        i === index
          ? { ...c, ...patch, id: patch.id || c.id || newGridMapCellId() }
          : { ...c },
      );
      persistCells(next);
    },
    [cells, persistCells],
  );

  /** 与格子比例一致则直接填格；否则图进格，拖拽平移后点确认 */
  const placeOrCropIntake = useCallback(
    async (index: number, rawUrl: string) => {
      const url = formatGridMapImagePath(String(rawUrl || '').trim());
      if (!url) return;
      setSelectedCell(index);
      try {
        const { w, h } = await loadImageNaturalSize(url);
        if (w > 0 && h > 0 && aspectsApproximatelyEqual(w / h, cellAspect)) {
          setCellPanAdjust(null);
          setCellAt(index, { src: url, sourceNodeId: undefined });
          return;
        }
        setCellPanAdjust({
          index,
          url,
          imgW: w || 1,
          imgH: h || 1,
          cellW: 0,
          cellH: 0,
          offsetX: 0,
          offsetY: 0,
        });
      } catch {
        setCellPanAdjust({
          index,
          url,
          imgW: 1,
          imgH: 1,
          cellW: 0,
          cellH: 0,
          offsetX: 0,
          offsetY: 0,
        });
      }
    },
    [cellAspect, setCellAt],
  );

  /** 进入格内取景后，按格子实测尺寸居中，并锁定 max 锚点为 0 */
  useEffect(() => {
    if (!cellPanAdjust || cellPanAdjust.cellW > 0) return;
    const slot = rootRef.current?.querySelector(
      `[data-grid-slot="${cellPanAdjust.index}"]`,
    ) as HTMLElement | null;
    if (!slot) return;
    // 使用 layout 尺寸（非 getBoundingClientRect），避免画布 zoom 把像素算错
    const cellW = Math.max(1, slot.offsetWidth);
    const cellH = Math.max(1, slot.offsetHeight);
    const { minX, minY } = coverTranslateLayout(
      cellPanAdjust.imgW,
      cellPanAdjust.imgH,
      cellW,
      cellH,
    );
    const centered = clampCoverTranslate(minX / 2, minY / 2, minX, minY);
    setCellPanAdjust((prev) =>
      prev && prev.index === cellPanAdjust.index
        ? { ...prev, cellW, cellH, offsetX: centered.offsetX, offsetY: centered.offsetY }
        : prev,
    );
  }, [cellPanAdjust]);

  const handlePanAdjustCancel = useCallback(() => {
    if (cropBusy) return;
    setCellPanAdjust(null);
  }, [cropBusy]);

  const handlePanAdjustConfirm = useCallback(async () => {
    if (!cellPanAdjust || cropBusy) return;
    if (!window.electronAPI?.createImageLocalResourceFromBuffer || !projectId) {
      showAlert(gt.cropFailed);
      return;
    }
    const cellW = cellPanAdjust.cellW;
    const cellH = cellPanAdjust.cellH;
    if (!(cellW > 0 && cellH > 0)) {
      showAlert(gt.cropFailed);
      return;
    }
    setCropBusy(true);
    try {
      const rect = coverTranslateToCropRect(
        cellPanAdjust.imgW,
        cellPanAdjust.imgH,
        cellW,
        cellH,
        cellPanAdjust.offsetX,
        cellPanAdjust.offsetY,
      );
      const { buffer } = await cropImageToPngBuffer(cellPanAdjust.url, rect);
      const result = await window.electronAPI.createImageLocalResourceFromBuffer(
        projectId,
        `grid-crop-${Date.now()}.png`,
        buffer,
      );
      const out = formatGridMapImagePath(result?.previewUrl || result?.originalUrl || '');
      if (!out) throw new Error('empty crop url');
      setCellAt(cellPanAdjust.index, { src: out, sourceNodeId: undefined });
      setCellPanAdjust(null);
    } catch (err) {
      console.error('[GridMapNode] cell pan crop failed', err);
      showAlert(gt.cropFailed);
    } finally {
      setCropBusy(false);
    }
  }, [cellPanAdjust, cropBusy, gt.cropFailed, projectId, setCellAt, showAlert]);

  const beginCellPanDrag = useCallback(
    (e: React.PointerEvent) => {
      if (!cellPanAdjust || cropBusy) return;
      if (!(cellPanAdjust.cellW > 0 && cellPanAdjust.cellH > 0)) return;
      e.preventDefault();
      e.stopPropagation();
      const { minX, minY } = coverTranslateLayout(
        cellPanAdjust.imgW,
        cellPanAdjust.imgH,
        cellPanAdjust.cellW,
        cellPanAdjust.cellH,
      );
      panDragRef.current = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        offsetX: cellPanAdjust.offsetX,
        offsetY: cellPanAdjust.offsetY,
        minX,
        minY,
        zoom: getZoom() || 1,
      };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [cellPanAdjust, cropBusy, getZoom],
  );

  const onCellPanMove = useCallback((e: React.PointerEvent) => {
    const d = panDragRef.current;
    if (!d) return;
    e.stopPropagation();
    const z = d.zoom > 0 ? d.zoom : 1;
    const dx = (e.clientX - d.startClientX) / z;
    const dy = (e.clientY - d.startClientY) / z;
    // 手指拖图 1:1；上限锚点恒为 0，不能拖出空白
    const next = clampCoverTranslate(d.offsetX + dx, d.offsetY + dy, d.minX, d.minY);
    setCellPanAdjust((prev) =>
      prev ? { ...prev, offsetX: next.offsetX, offsetY: next.offsetY } : prev,
    );
  }, []);

  const endCellPanDrag = useCallback((e: React.PointerEvent) => {
    if (!panDragRef.current) return;
    panDragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!cellPanAdjust) return;
    const onKey = (e: KeyboardEvent) => {
      if (cropBusy) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setCellPanAdjust(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        void handlePanAdjustConfirm();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [cellPanAdjust, cropBusy, handlePanAdjustConfirm]);

  const displayCells = useMemo(() => {
    if (draggingIndex == null || dropTargetIndex == null) return cells;
    if (draggingIndex === dropTargetIndex) return cells;
    const next = cells.map((c) => ({ ...c }));
    const [item] = next.splice(draggingIndex, 1);
    if (!item) return cells;
    next.splice(dropTargetIndex, 0, item);
    return next;
  }, [cells, draggingIndex, dropTargetIndex]);

  const draggingCell =
    draggingIndex != null ? cells[draggingIndex] : null;
  const draggingSrc = formatGridMapImagePath(String(draggingCell?.src || '').trim());

  useEffect(() => {
    if (draggingIndex == null) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.userSelect = prev;
    };
  }, [draggingIndex]);

  useEffect(() => {
    if (draggingIndex == null) return;
    const gridEl = () => rootRef.current?.querySelector('[data-grid-map-grid]') as HTMLElement | null;

    const onMove = (e: MouseEvent) => {
      setDragPreviewPos({
        x: e.clientX - dragStartOffsetRef.current.x,
        y: e.clientY - dragStartOffsetRef.current.y,
      });
      const grid = gridEl();
      if (!grid) return;
      const slots = grid.querySelectorAll('[data-grid-slot]');
      let best = draggingIndex;
      let bestDist = Infinity;
      slots.forEach((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const d = (e.clientX - cx) ** 2 + (e.clientY - cy) ** 2;
        const slotIdx = parseInt((el as HTMLElement).getAttribute('data-grid-slot') || '-1', 10);
        if (slotIdx >= 0 && d < bestDist) {
          bestDist = d;
          best = slotIdx;
        }
      });
      dropTargetIndexRef.current = best;
      setDropTargetIndex(best);
    };

    const onUp = (e: MouseEvent) => {
      const fromIdx = draggingIndex;
      ignoreNextClickRef.current = true;
      const root = rootRef.current;
      const src = formatGridMapImagePath(String(cells[fromIdx]?.src || '').trim());
      let outside = false;
      if (root) {
        const rect = root.getBoundingClientRect();
        outside =
          e.clientX < rect.left - 8 ||
          e.clientX > rect.right + 8 ||
          e.clientY < rect.top - 8 ||
          e.clientY > rect.bottom + 8;
      }

      if (outside && src) {
        // 拖出宫格外：删除该格图片（不再生成新图节点）
        const next = cells.map((c, i) =>
          i === fromIdx ? { id: c.id || newGridMapCellId() } : { ...c },
        );
        persistCells(next);
        setSelectedCell(null);
      } else {
        const toIdx = dropTargetIndexRef.current ?? fromIdx;
        if (fromIdx !== toIdx) {
          const next = cells.map((c) => ({ ...c }));
          const [item] = next.splice(fromIdx, 1);
          if (item) {
            next.splice(toIdx, 0, item);
            persistCells(next);
            setSelectedCell(toIdx);
          }
        }
      }

      setDraggingIndex(null);
      setDropTargetIndex(null);
      setDragPreviewPos(null);
      dropTargetIndexRef.current = null;
      dragFromRef.current = null;
      pointerDownRef.current = null;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, true);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp, true);
    };
  }, [draggingIndex, cells, persistCells]);

  const beginCellPointerDown = useCallback(
    (index: number, e: React.MouseEvent) => {
      if (cellPanAdjust) return;
      const src = formatGridMapImagePath(String(cells[index]?.src || '').trim());
      if (!src) return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget as HTMLElement;
      const rect = el.getBoundingClientRect();
      dragStartOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      dragCardSizeRef.current = { w: rect.width, h: rect.height };
      pointerDownRef.current = {
        index,
        clientX: e.clientX,
        clientY: e.clientY,
        started: false,
      };
      setSelectedCell(index);

      const onMove = (ev: MouseEvent) => {
        const pd = pointerDownRef.current;
        if (!pd || pd.started) return;
        const dist = Math.hypot(ev.clientX - pd.clientX, ev.clientY - pd.clientY);
        if (dist < GRID_DRAG_THRESHOLD_PX) return;
        pd.started = true;
        dragFromRef.current = pd.index;
        dropTargetIndexRef.current = pd.index;
        setDraggingIndex(pd.index);
        setDropTargetIndex(pd.index);
        setDragPreviewPos({
          x: ev.clientX - dragStartOffsetRef.current.x,
          y: ev.clientY - dragStartOffsetRef.current.y,
        });
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp, true);
        const pd = pointerDownRef.current;
        if (pd && !pd.started) {
          pointerDownRef.current = null;
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp, true);
    },
    [cellPanAdjust, cells],
  );

  const onCellDrop = useCallback(
    async (index: number, e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverCell(null);
      // 内部换位走指针拖拽；此处仅接收外部拖入的图片
      if (e.dataTransfer.getData(GRID_MAP_MIME)) return;

      const uri =
        e.dataTransfer.getData('text/uri-list') ||
        e.dataTransfer.getData('text/plain') ||
        '';
      const maybeUrl = uri.split('\n').map((s) => s.trim()).find((s) => s && !s.startsWith('#'));
      if (maybeUrl && /^(https?:|local-resource:|data:|file:|blob:)/i.test(maybeUrl)) {
        await placeOrCropIntake(index, maybeUrl);
        return;
      }

      if (e.dataTransfer.files?.length) {
        const file = e.dataTransfer.files[0];
        if (!file) return;
        let url = '';
        if (window.electronAPI?.createImageLocalResourceFromBuffer && projectId) {
          try {
            const buf = await file.arrayBuffer();
            const res = await window.electronAPI.createImageLocalResourceFromBuffer(
              projectId,
              file.name || `grid-drop-${Date.now()}.png`,
              buf,
            );
            url = formatGridMapImagePath(res.previewUrl || res.originalUrl);
          } catch {
            /* ignore */
          }
        }
        if (!url) {
          url = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => resolve('');
            reader.readAsDataURL(file);
          });
        }
        if (url) await placeOrCropIntake(index, url);
      }
    },
    [placeOrCropIntake, projectId],
  );

  const handleSynthesize = useCallback(async () => {
    if (busy) return;
    const hasAny = cells.some((c) => String(c?.src || '').trim());
    if (!hasAny) {
      showAlert(gt.needImages);
      return;
    }
    if (!onExportToCanvas) {
      showAlert(gt.synthesizeFailed);
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await composeGridMapToDataUrl({
        canvasW,
        canvasH,
        cols,
        rows,
        gapPx,
        cells,
      });
      await onExportToCanvas(id, dataUrl, canvasW, canvasH, gt.exportLabel);
    } catch (err) {
      console.error('[GridMapNode] synthesize failed', err);
      showAlert(gt.synthesizeFailed);
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    cells,
    canvasW,
    canvasH,
    cols,
    rows,
    gapPx,
    gt,
    id,
    onExportToCanvas,
    showAlert,
  ]);

  const clearSelected = useCallback(() => {
    if (selectedCell == null) {
      persistCells(cells.map((c) => ({ id: c.id || newGridMapCellId() })));
      return;
    }
    setCellAt(selectedCell, { src: undefined, sourceNodeId: undefined });
  }, [cells, persistCells, selectedCell, setCellAt]);

  const pickCellFromCanvas = useCallback(
    async (index: number) => {
      if (!onPickImageFromCanvas) return;
      setSelectedCell(index);
      const url = await onPickImageFromCanvas();
      if (!url) return;
      await placeOrCropIntake(index, url);
    },
    [onPickImageFromCanvas, placeOrCropIntake],
  );

  const shell = isDarkMode
    ? 'bg-[#141416] text-white'
    : 'bg-white text-gray-900';
  const cellActive = isDarkMode ? 'ring-2 ring-violet-400/70' : 'ring-2 ring-violet-500/60';
  const cellDrop = isDarkMode ? 'ring-2 ring-emerald-400/60 bg-emerald-500/10' : 'ring-2 ring-emerald-500/50 bg-emerald-50';

  const gridMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!gridMenuOpen) return;
    const onDoc = (ev: MouseEvent) => {
      if (!gridMenuRef.current?.contains(ev.target as Node)) setGridMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc, true);
    return () => document.removeEventListener('mousedown', onDoc, true);
  }, [gridMenuOpen]);

  const toolBtn = (active = false) =>
    `nodrag nopan inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
      active
        ? isDarkMode
          ? 'bg-white/18 text-white'
          : 'bg-black/10 text-gray-900'
        : isDarkMode
          ? 'text-white/75 hover:bg-white/10 hover:text-white'
          : 'text-gray-600 hover:bg-black/5 hover:text-gray-900'
    }`;

  return (
    <div
      ref={rootRef}
      className={`custom-node-container relative overflow-visible rounded-2xl shadow-xl ${shell} ${
        selected ? 'nexflow-node-selected' : ''
      }`}
      style={{
        ...nodeStyleDimensions(outer.w, outer.h),
        width: outer.w,
        height: outer.h,
        transition: NODE_SIZE_TRANSITION,
        contain: 'style',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="nexflow-plus-handle nexflow-plus-handle-left"
        title={locale === 'en' ? 'Connect images' : '接入图片'}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="nexflow-plus-handle nexflow-plus-handle-right"
      />

      {/* 顶栏：平移画布时仍保持完整显示（勿被 interacting 藏成空胶囊） */}
      <div
        className={`node-floating-toolbar nodrag nopan absolute bottom-[calc(100%+12px)] left-1/2 z-20 flex w-max max-w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 overflow-visible rounded-full border px-2 py-1.5 shadow-xl backdrop-blur-md ${
          isDarkMode ? 'border-white/12 bg-zinc-900/92' : 'border-gray-200 bg-white/95'
        }`}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
          <PhotoCollageAspectRatioDropdown
            cw={cellAspectDropdownSize[0]}
            ch={cellAspectDropdownSize[1]}
            isDarkMode={isDarkMode}
            onApplySize={applyCanvasSize}
            placement="down"
            ratioOnly
            allowedAspectIds={[...GRID_MAP_ASPECT_IDS]}
          />

          <div ref={gridMenuRef} className="relative">
            <button
              type="button"
              className={`nodrag nopan inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium ${
                isDarkMode
                  ? 'border border-white/10 bg-white/15 text-white/85 hover:bg-white/22'
                  : 'border border-black/10 bg-black/10 text-gray-800 hover:bg-black/15'
              }`}
              onClick={(e) => {
                e.stopPropagation();
                setGridMenuOpen((v) => !v);
              }}
            >
              <LayoutGrid className="h-3.5 w-3.5 opacity-80" />
              <span className={isDarkMode ? 'text-white/55' : 'text-gray-500'}>{gt.gridLabel}</span>
              <span>{gt.gridOption(cols, rows)}</span>
              <ChevronDown className={`h-3 w-3 opacity-70 ${gridMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {gridMenuOpen ? (
              <div
                className={`absolute left-0 top-full z-[80] mt-1.5 grid w-40 grid-cols-2 gap-1 rounded-xl border p-2 ${
                  isDarkMode
                    ? 'border-white/12 bg-zinc-900/95 text-white'
                    : 'border-gray-200 bg-white text-gray-900'
                }`}
              >
                {GRID_MAP_PRESETS.map((p) => {
                  const active = p.cols === cols && p.rows === rows;
                  return (
                    <button
                      key={`${p.cols}x${p.rows}`}
                      type="button"
                      className={`rounded-lg px-2 py-1.5 text-[11px] ${
                        active
                          ? isDarkMode
                            ? 'bg-violet-500/30 text-white'
                            : 'bg-violet-100 text-violet-800'
                          : isDarkMode
                            ? 'hover:bg-white/10'
                            : 'hover:bg-black/5'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        applyGridSize(p.cols, p.rows);
                      }}
                    >
                      {gt.gridOption(p.cols, p.rows)}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          <span className={`mx-0.5 h-4 w-px ${isDarkMode ? 'bg-white/15' : 'bg-black/10'}`} />

          <button
            type="button"
            className="nodrag nopan inline-flex items-center justify-center gap-1.5 rounded-full bg-emerald-600/90 px-2.5 py-1.5 text-[10px] font-medium leading-none text-white shadow-sm transition-colors hover:bg-emerald-500 active:scale-[0.98] disabled:opacity-45"
            title={gt.synthesizeTitle}
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              void handleSynthesize();
            }}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LayoutTemplate className="h-3.5 w-3.5" />}
            <span>{gt.synthesize}</span>
          </button>
          <button
            type="button"
            className={toolBtn(false)}
            title={selectedCell == null ? gt.clearAll : gt.clearCell}
            onClick={(e) => {
              e.stopPropagation();
              clearSelected();
            }}
          >
            <Trash2 className="h-4 w-4" />
          </button>
      </div>

      <div className="absolute inset-0 flex flex-col overflow-hidden rounded-2xl p-2.5">
        <LayoutGroup>
          <div
            className="min-h-0 flex-1"
            data-grid-map-grid
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
              gap: gapPx,
            }}
          >
            {displayCells.map((cell, index) => {
              const src = formatGridMapImagePath(String(cell.src || '').trim());
              const cellId = cell.id || `slot-${index}`;
              const isDraggingThis =
                draggingIndex != null && cells[draggingIndex]?.id === cell.id;
              const isPanAdjust = cellPanAdjust?.index === index;
              const isSel = (selectedCell === index || isPanAdjust) && !isDraggingThis;
              const isOver = dragOverCell === index;
              return (
                <motion.div
                  key={cellId}
                  layout
                  transition={GRID_LAYOUT_SPRING}
                  data-grid-slot={index}
                  className={`nodrag nopan relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-md ${
                    isPanAdjust
                      ? 'cursor-grab active:cursor-grabbing'
                      : src
                        ? 'cursor-grab active:cursor-grabbing'
                        : isDarkMode
                          ? 'bg-white/[0.04]'
                          : 'bg-black/[0.03]'
                  } ${isSel ? cellActive : ''} ${isOver ? cellDrop : ''} ${
                    isPanAdjust ? 'ring-2 ring-sky-400/80 ring-inset' : ''
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (ignoreNextClickRef.current) {
                      ignoreNextClickRef.current = false;
                      return;
                    }
                    if (draggingIndex != null || cellPanAdjust) return;
                    setSelectedCell(index);
                  }}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    if (isPanAdjust) return;
                    if (!src) return;
                    beginCellPointerDown(index, e);
                  }}
                  onDragOver={(e) => {
                    if (cellPanAdjust) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOverCell(index);
                  }}
                  onDragLeave={() => setDragOverCell((v) => (v === index ? null : v))}
                  onDrop={(e) => {
                    if (cellPanAdjust) {
                      e.preventDefault();
                      e.stopPropagation();
                      return;
                    }
                    void onCellDrop(index, e);
                  }}
                >
                  {isDraggingThis ? (
                    <div
                      className={`h-full w-full rounded-md border border-dashed ${
                        isDarkMode ? 'border-white/20 bg-white/5' : 'border-gray-300 bg-gray-100/80'
                      }`}
                    />
                  ) : isPanAdjust && cellPanAdjust ? (
                    <>
                      {(() => {
                        const layout =
                          cellPanAdjust.cellW > 0 && cellPanAdjust.cellH > 0
                            ? coverTranslateLayout(
                                cellPanAdjust.imgW,
                                cellPanAdjust.imgH,
                                cellPanAdjust.cellW,
                                cellPanAdjust.cellH,
                              )
                            : null;
                        return (
                          <div
                            className="nodrag nopan absolute inset-0 overflow-hidden"
                            style={{
                              cursor: cropBusy ? 'wait' : 'grab',
                              touchAction: 'none',
                            }}
                            onPointerDown={beginCellPanDrag}
                            onPointerMove={onCellPanMove}
                            onPointerUp={endCellPanDrag}
                            onPointerCancel={endCellPanDrag}
                          >
                            <img
                              src={cellPanAdjust.url}
                              alt=""
                              draggable={false}
                              className="pointer-events-none absolute left-0 top-0 max-w-none select-none"
                              style={
                                layout
                                  ? {
                                      width: layout.dispW,
                                      height: layout.dispH,
                                      transform: `translate(${cellPanAdjust.offsetX}px, ${cellPanAdjust.offsetY}px)`,
                                    }
                                  : {
                                      width: '100%',
                                      height: '100%',
                                      objectFit: 'cover',
                                    }
                              }
                            />
                          </div>
                        );
                      })()}
                      <div
                        className={`pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t px-1.5 pb-1.5 pt-6 ${
                          isDarkMode ? 'from-black/70 to-transparent' : 'from-black/50 to-transparent'
                        }`}
                      >
                        <p className="pointer-events-none text-center text-[10px] leading-tight text-white/90">
                          {gt.cropHint(intakeRatioLabel)}
                        </p>
                      </div>
                      <div className="absolute right-1 top-1 z-10 flex gap-1">
                        <button
                          type="button"
                          disabled={cropBusy}
                          className="nodrag nopan inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white shadow-sm backdrop-blur-sm transition hover:bg-black/75 disabled:opacity-50"
                          title={gt.cropCancel}
                          aria-label={gt.cropCancel}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            handlePanAdjustCancel();
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                        </button>
                        <button
                          type="button"
                          disabled={cropBusy}
                          className="nodrag nopan inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/90 text-white shadow-sm transition hover:bg-emerald-500 disabled:opacity-50"
                          title={cropBusy ? gt.cropConfirming : gt.cropConfirm}
                          aria-label={cropBusy ? gt.cropConfirming : gt.cropConfirm}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            void handlePanAdjustConfirm();
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          {cropBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                          )}
                        </button>
                      </div>
                    </>
                  ) : src ? (
                    <>
                      <img
                        src={src}
                        alt=""
                        draggable={false}
                        className="pointer-events-none h-full w-full select-none object-cover"
                      />
                      <span
                        className={`pointer-events-none absolute left-1.5 top-1.5 rounded px-1 py-0.5 text-[10px] font-medium tabular-nums leading-none ${
                          isDarkMode ? 'bg-black/45 text-white/80' : 'bg-white/70 text-black/70'
                        }`}
                        aria-hidden
                      >
                        {index + 1}
                      </span>
                    </>
                  ) : (
                    <div
                      className="relative flex h-full w-full cursor-pointer items-center justify-center px-1.5 py-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (cellPanAdjust) return;
                        if (onPickImageFromCanvas) void pickCellFromCanvas(index);
                      }}
                    >
                      <span
                        className={`pointer-events-none absolute left-1.5 top-1.5 text-[11px] font-medium tabular-nums leading-none ${
                          isDarkMode ? 'text-white/35' : 'text-black/30'
                        }`}
                        aria-hidden
                      >
                        {index + 1}
                      </span>
                      {onPickImageFromCanvas ? (
                        <button
                          type="button"
                          className={`nodrag nopan inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors active:scale-[0.96] ${
                            isDarkMode
                              ? 'border-white/15 bg-white/10 text-white/80 hover:bg-white/18 hover:text-white'
                              : 'border-black/10 bg-black/5 text-gray-600 hover:bg-black/10 hover:text-gray-900'
                          }`}
                          title={gt.pickFromCanvas}
                          aria-label={gt.pickFromCanvas}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            void pickCellFromCanvas(index);
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <Plus className="h-5 w-5" strokeWidth={2.25} />
                        </button>
                      ) : (
                        <Plus
                          className={`h-5 w-5 ${isDarkMode ? 'text-white/30' : 'text-gray-400'}`}
                          strokeWidth={2.25}
                          aria-hidden
                        />
                      )}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </LayoutGroup>
      </div>

      {draggingSrc && dragPreviewPos
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[99998] overflow-hidden rounded-md shadow-2xl"
              style={{
                left: dragPreviewPos.x,
                top: dragPreviewPos.y,
                width: dragCardSizeRef.current.w,
                height: dragCardSizeRef.current.h,
                transform: 'scale(1.05)',
              }}
            >
              <img src={draggingSrc} alt="" className="h-full w-full object-cover" draggable={false} />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};

export const GridMapNode = React.memo(GridMapNodeComponent);
export default GridMapNode;
