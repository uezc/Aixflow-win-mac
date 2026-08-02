import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import type { Node } from 'reactflow';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { GRID_MAP_PRESETS, resolveGridMapCanvasSizeForCellAspect, type GridMapSize } from '../../utils/gridMapCompose';
import {
  COLLAGE_ASPECT_GROUPS,
  resolveCollage1080pDefaultSize,
  type CollageAspectGroup,
} from './photoCollageAspectRatio';
import {
  parseAspectRatioValue,
  resolveAspectRatioFromNodeData,
  resolveMediaPixelSizeFromNodeData,
} from '../../utils/nodeSizeFromAspectRatio';

const GRID_MAP_ASPECT_IDS = ['16-9', '9-16', '4-3', '3-4', '1-1'] as const;

export type CreateGridMapFromSelectionOpts = {
  nodeIds: string[];
  cols: number;
  rows: number;
  canvasW: number;
  canvasH: number;
};

type Props = {
  selectedNodes: Node[];
  position: { x: number; y: number };
  isDarkMode: boolean;
  onCreate: (opts: CreateGridMapFromSelectionOpts) => void;
};

function nodeOuterSize(n: Node): { w: number; h: number } {
  const w =
    Number(n.data?.width) ||
    Number((n.style as { width?: number } | undefined)?.width) ||
    280;
  const h =
    Number(n.data?.height) ||
    Number((n.style as { height?: number } | undefined)?.height) ||
    280;
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

/** 框选包围盒宽高比（仅用于宫格横竖倾向，不用于画布比例） */
function getSelectionAspectRatio(nodes: Node[]): number {
  if (!nodes.length) return 1;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const { w, h } = nodeOuterSize(n);
    const x = Number(n.position?.x) || 0;
    const y = Number(n.position?.y) || 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  return bw / bh;
}

/** 单张图的「画面」宽高比：优先素材像素 → aspectRatio 字段 → 模块外框 */
function getImageContentAspectRatio(node: Node): number {
  const data = node.data as Record<string, unknown> | undefined;
  const px = resolveMediaPixelSizeFromNodeData(data, 'image');
  if (px && px.width > 0 && px.height > 0) return px.width / px.height;
  const label = resolveAspectRatioFromNodeData(data, 'image');
  const parsed = parseAspectRatioValue(label);
  if (parsed) return parsed.w / parsed.h;
  const { w, h } = nodeOuterSize(node);
  return w / h;
}

function closestAspectGroup(ratio: number, groups: CollageAspectGroup[]): CollageAspectGroup {
  let best = groups[0]!;
  let bestDiff = Infinity;
  for (const g of groups) {
    const d = Math.abs(Math.log(ratio / (g.rw / Math.max(g.rh, 1))));
    if (d < bestDiff) {
      bestDiff = d;
      best = g;
    }
  }
  return best;
}

/**
 * 分析框选内大部分画面比例：每张图映射到最近预设后多数表决；
 * 平票时用比例中位数再匹配最近预设。
 */
function pickDefaultAspect(nodes: Node[], groups: CollageAspectGroup[]): CollageAspectGroup {
  if (!groups.length) {
    return COLLAGE_ASPECT_GROUPS.find((g) => g.id === '1-1') ?? COLLAGE_ASPECT_GROUPS[0]!;
  }
  if (!nodes.length) return groups.find((g) => g.id === '1-1') ?? groups[0]!;

  const ratios = nodes.map((n) => getImageContentAspectRatio(n));
  const votes = new Map<string, number>();
  for (const ratio of ratios) {
    const g = closestAspectGroup(ratio, groups);
    votes.set(g.id, (votes.get(g.id) || 0) + 1);
  }

  let bestId = groups[0]!.id;
  let bestCount = -1;
  let tie = false;
  for (const g of groups) {
    const c = votes.get(g.id) || 0;
    if (c > bestCount) {
      bestCount = c;
      bestId = g.id;
      tie = false;
    } else if (c === bestCount && c > 0) {
      tie = true;
    }
  }

  if (!tie && bestCount > 0) {
    return groups.find((g) => g.id === bestId) ?? groups[0]!;
  }

  const sorted = [...ratios].sort((a, b) => a - b);
  const mid = sorted[Math.floor((sorted.length - 1) / 2)] ?? 1;
  return closestAspectGroup(mid, groups);
}

/**
 * 按图片数量 + 框选横竖倾向预选宫格。
 * 优先精确匹配（4→2×2、6→3×2/2×3、9→3×3…），否则取能装下的最小预设并贴近横竖。
 */
function pickDefaultGrid(count: number, selectionRatio: number): GridMapSize {
  const n = Math.max(2, count);
  const landscape = selectionRatio >= 1.08;
  const portrait = selectionRatio <= 0.92;

  if (n === 4) return { cols: 2, rows: 2 };
  if (n === 9) return { cols: 3, rows: 3 };
  if (n === 16) return { cols: 4, rows: 4 };
  if (n === 6) return portrait ? { cols: 2, rows: 3 } : { cols: 3, rows: 2 };
  if (n === 2 || n === 3) return { cols: 2, rows: 2 };
  if (n === 5) return portrait ? { cols: 2, rows: 3 } : { cols: 3, rows: 2 };
  if (n >= 7 && n <= 8) return { cols: 3, rows: 3 };
  if (n >= 10 && n <= 12) {
    return { cols: 4, rows: 4 };
  }
  if (n >= 13) return { cols: 4, rows: 4 };

  const fitting = GRID_MAP_PRESETS.filter((p) => p.cols * p.rows >= n);
  if (fitting.length === 0) return { cols: 4, rows: 4 };

  const orientScore = (p: GridMapSize) => {
    const pr = p.cols / Math.max(p.rows, 1);
    if (landscape) return pr;
    if (portrait) return -pr;
    return -Math.abs(Math.log(pr));
  };

  return [...fitting].sort((a, b) => {
    const sa = a.cols * a.rows;
    const sb = b.cols * b.rows;
    if (sa !== sb) return sa - sb;
    const oa = orientScore(a);
    const ob = orientScore(b);
    if (oa !== ob) return ob - oa;
    return Math.abs(a.cols - a.rows) - Math.abs(b.cols - b.rows);
  })[0]!;
}

/**
 * 框选 ≥2 个图片模块时，在选区上方显示「宫格图」；展开后选比例与几乘几，一键生成宫格节点。
 */
const GridMapFromSelectionButton: React.FC<Props> = ({
  selectedNodes,
  position,
  isDarkMode,
  onCreate,
}) => {
  const { locale } = useAppLocale();
  const count = selectedNodes.length;
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const aspectGroups = useMemo(() => {
    const byId = new Map(COLLAGE_ASPECT_GROUPS.map((g) => [g.id, g]));
    return GRID_MAP_ASPECT_IDS.map((id) => byId.get(id)).filter(Boolean) as CollageAspectGroup[];
  }, []);

  const [aspectId, setAspectId] = useState('1-1');
  const [grid, setGrid] = useState<GridMapSize>(() => pickDefaultGrid(count, 1));
  const [canvasW, setCanvasW] = useState(1080);
  const [canvasH, setCanvasH] = useState(1080);

  const applyCellAspectAndGrid = (g: CollageAspectGroup, nextGrid: GridMapSize) => {
    setAspectId(g.id);
    setGrid(nextGrid);
    const [cellW, cellH] = resolveCollage1080pDefaultSize(g);
    const [w, h] = resolveGridMapCanvasSizeForCellAspect(
      cellW,
      cellH,
      nextGrid.cols,
      nextGrid.rows,
    );
    setCanvasW(w);
    setCanvasH(h);
  };

  useEffect(() => {
    if (!open) return;
    const selectionRatio = getSelectionAspectRatio(selectedNodes);
    const nextGrid = pickDefaultGrid(count, selectionRatio);
    const g = pickDefaultAspect(selectedNodes, aspectGroups);
    if (g) applyCellAspectAndGrid(g, nextGrid);
    else {
      setGrid(nextGrid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在打开时按框选重算
  }, [open, count, aspectGroups, selectedNodes]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      if (!rootRef.current?.contains(ev.target as HTMLElement)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc, true);
    return () => document.removeEventListener('mousedown', onDoc, true);
  }, [open]);

  const slotCount = grid.cols * grid.rows;
  const overflow = count > slotCount;

  const applyAspect = (g: CollageAspectGroup) => {
    applyCellAspectAndGrid(g, grid);
  };

  const panelBg = isDarkMode
    ? 'bg-zinc-900/95 border-white/15 text-white'
    : 'bg-white/95 border-gray-200 text-gray-900';
  const chipIdle = isDarkMode
    ? 'border-white/20 bg-white/5 hover:bg-white/10 text-white/85'
    : 'border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-700';
  const chipActive = isDarkMode
    ? 'border-emerald-400/70 bg-emerald-500/25 text-emerald-100'
    : 'border-emerald-500 bg-emerald-50 text-emerald-800';

  return (
    <div
      ref={rootRef}
      className="flex flex-col items-center gap-1.5"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: 'translate(-50%, -100%)',
        position: 'absolute',
        pointerEvents: 'auto',
        zIndex: 1000,
        isolation: 'isolate',
      }}
    >
      {open ? (
        <div
          className={`mb-1 w-[280px] rounded-2xl border px-3 py-3 shadow-xl backdrop-blur-md ${panelBg}`}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className={`mb-2 text-xs font-semibold ${isDarkMode ? 'text-white/80' : 'text-gray-600'}`}>
            {locale === 'en' ? 'Cell aspect' : '格子比例'}
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {aspectGroups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => applyAspect(g)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                  aspectId === g.id ? chipActive : chipIdle
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
          <div className={`mb-2 text-xs font-semibold ${isDarkMode ? 'text-white/80' : 'text-gray-600'}`}>
            {locale === 'en' ? 'Grid' : '宫格'}
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {GRID_MAP_PRESETS.map((p) => {
              const key = `${p.cols}x${p.rows}`;
              const active = grid.cols === p.cols && grid.rows === p.rows;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setGrid(p);
                    const g =
                      aspectGroups.find((x) => x.id === aspectId) ??
                      aspectGroups[0];
                    if (g) {
                      const [cellW, cellH] = resolveCollage1080pDefaultSize(g);
                      const [w, h] = resolveGridMapCanvasSizeForCellAspect(
                        cellW,
                        cellH,
                        p.cols,
                        p.rows,
                      );
                      setCanvasW(w);
                      setCanvasH(h);
                    }
                  }}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                    active ? chipActive : chipIdle
                  }`}
                >
                  {p.cols}×{p.rows}
                </button>
              );
            })}
          </div>
          {overflow ? (
            <p className={`mb-2 text-[11px] leading-snug ${isDarkMode ? 'text-amber-200/90' : 'text-amber-700'}`}>
              {locale === 'en'
                ? `${count} images selected; ${grid.cols}×${grid.rows} holds ${slotCount}. Extra images will be skipped.`
                : `已选 ${count} 张，${grid.cols}×${grid.rows} 仅 ${slotCount} 格，多余图片将跳过。`}
            </p>
          ) : (
            <p className={`mb-2 text-[11px] leading-snug ${isDarkMode ? 'text-white/45' : 'text-gray-500'}`}>
              {locale === 'en'
                ? `Suggested from image aspect · ${Math.min(count, slotCount)} images · ${canvasW}×${canvasH}`
                : `已按画面比例预选 · 导入 ${Math.min(count, slotCount)} 张 · ${canvasW}×${canvasH}`}
            </p>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCreate({
                nodeIds: selectedNodes.map((n) => n.id),
                cols: grid.cols,
                rows: grid.rows,
                canvasW,
                canvasH,
              });
              setOpen(false);
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-md transition-colors hover:bg-emerald-500"
          >
            <LayoutGrid className="h-4 w-4" />
            {locale === 'en' ? 'Create grid map' : '生成宫格图'}
          </button>
        </div>
      ) : null}
      <button
        type="button"
        disabled={count < 2}
        onClick={(e) => {
          e.stopPropagation();
          if (count < 2) return;
          setOpen((v) => !v);
        }}
        className={`
          flex items-center gap-2 rounded-full px-4 py-2 shadow-lg transition-all
          animate-in fade-in zoom-in
          disabled:cursor-not-allowed disabled:opacity-60
          ${
            isDarkMode
              ? 'bg-emerald-600 text-white hover:bg-emerald-500'
              : 'bg-emerald-600 text-white hover:bg-emerald-500'
          }
        `}
        title={
          locale === 'en'
            ? 'Create a grid map from selected images'
            : '用选中图片快速生成宫格图（可选比例与几乘几）'
        }
      >
        <LayoutGrid className="h-4 w-4" />
        <span className="text-sm font-medium">
          {locale === 'en' ? `Grid map · ${count}` : `宫格图 · ${count}`}
        </span>
      </button>
    </div>
  );
};

export default GridMapFromSelectionButton;
