// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DarkAlertModal } from '../DarkAlertModal';
import {
  ArrowDown,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  Download,
  FlipHorizontal2,
  FlipVertical2,
  RotateCcw,
  ImagePlus,
  Image as ImageIcon,
  LayoutGrid,
  PanelLeftClose,
  Ruler,
  Trash2,
} from 'lucide-react';
import { layerHasTransform, layerImageWrapperStyle } from '../../utils/collageLayerTransform';
import { PhotoCollageLayerItem } from './PhotoCollageLayerItem';
import { PhotoCollageRotationKnob } from './PhotoCollageRotationKnob';
import {
  COLLAGE_ASPECT_GROUPS,
  findCollageAspectGroupId,
  RatioGlyph,
  resolveCollage1080pDefaultSize,
  type CollageAspectGroup,
} from './photoCollageAspectRatio';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { photoCollageT } from '../../i18n/photoCollageI18n';
import { scratchTintClass, type ScratchColorId } from '../../theme/scratchColors';

const SCRATCH_CYCLE: ScratchColorId[] = ['motion', 'looks', 'sound', 'events', 'control', 'sensing', 'operators'];

function studioActionBtn(isDarkMode: boolean, scratch: ScratchColorId, darkClass: string, extra = '') {
  if (!isDarkMode) {
    return `inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium scratch-float-btn ${scratchTintClass(scratch)} disabled:opacity-45 disabled:pointer-events-none ${extra}`.trim();
  }
  return `${darkClass} inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-45 disabled:pointer-events-none ${extra}`.trim();
}

function studioIconBtn(isDarkMode: boolean, scratch: ScratchColorId, darkClass: string, extra = '') {
  if (!isDarkMode) {
    return `p-1.5 rounded-md inline-flex items-center justify-center scratch-float-btn ${scratchTintClass(scratch)} disabled:opacity-25 ${extra}`.trim();
  }
  return `${darkClass} p-1.5 rounded-md inline-flex items-center justify-center disabled:opacity-25 ${extra}`.trim();
}

function studioChipBtn(
  isDarkMode: boolean,
  scratch: ScratchColorId,
  active: boolean,
  darkActive: string,
  darkIdle: string,
  size: 'sm' | 'md' = 'md',
) {
  if (!isDarkMode) {
    const pad = size === 'sm' ? 'px-2 py-1 text-[10px]' : 'px-1 py-2 text-[10px]';
    const cls = active ? scratchTintClass('myBlocks') : scratchTintClass(scratch);
    return `scratch-float-btn flex flex-col items-center justify-center gap-1 rounded-lg border transition-colors ${pad} ${cls}`.trim();
  }
  return `flex flex-col items-center justify-center gap-1 rounded-lg border transition-colors ${
    size === 'sm' ? 'px-2 py-1 text-[10px]' : 'px-1 py-2'
  } ${active ? darkActive : darkIdle}`;
}

function studioResBtn(isDarkMode: boolean, active: boolean, darkActive: string, darkIdle: string) {
  if (!isDarkMode) {
    return `rounded-md border px-2 py-1 text-[10px] transition-colors scratch-float-btn ${scratchTintClass(active ? 'operators' : 'variables')}`;
  }
  return `rounded-md border px-2 py-1 text-[10px] transition-colors ${active ? darkActive : darkIdle}`;
}

/** 与主节点数据结构一致，避免循环依赖 */
export interface CollageLayerLike {
  id: string;
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
}

const MIN_CANVAS = 64;
const MAX_CANVAS = 8192;

const DEFAULT_LIGHT_CANVAS_BG = '#E5E7EB';
const DEFAULT_LIGHT_DOTS_COLOR = '#000000';
const DEFAULT_LIGHT_DOT_SIZE = 2;

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.slice(1).match(/.{2}/g);
  if (!m) return `rgba(0,0,0,${alpha})`;
  const [r, g, b] = m.map((x) => parseInt(x, 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

function collageBoardBackgroundStyle(
  isDarkMode: boolean,
  lightCanvasBgColor: string,
  lightDotsColor: string,
  lightDotSize: number,
): React.CSSProperties {
  if (isDarkMode) {
    return {
      backgroundColor: '#1a1a1f',
      backgroundImage:
        'linear-gradient(45deg, #2a2a30 25%, transparent 25%), linear-gradient(-45deg, #2a2a30 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a30 75%), linear-gradient(-45deg, transparent 75%, #2a2a30 75%)',
      backgroundSize: '16px 16px',
      backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
    };
  }
  const gap = 20 * lightDotSize;
  const dotRadius = Math.max(0.6, lightDotSize * 0.75);
  return {
    backgroundColor: lightCanvasBgColor,
    backgroundImage: `radial-gradient(circle, ${hexToRgba(lightDotsColor, 0.14)} ${dotRadius}px, transparent ${dotRadius}px)`,
    backgroundSize: `${gap}px ${gap}px`,
  };
}

function mkStudioTheme(isDarkMode: boolean) {
  const t = (d: string, l: string) => (isDarkMode ? d : l);
  return {
    text: t('text-white', 'text-gray-900'),
    textMuted: t('text-white/70', 'text-gray-600'),
    textSubtle: t('text-white/45', 'text-gray-500'),
    textFaint: t('text-white/35', 'text-gray-400'),
    border: t('border-white/[0.08]', 'border-gray-200'),
    asideBg: t('bg-black/20', 'bg-gray-50'),
    headerBg: t('bg-black/25 backdrop-blur-md', 'bg-white/95 backdrop-blur-sm shadow-sm'),
    footerBg: t('bg-black/30', 'bg-white'),
    btnGhost: t(
      'border-white/15 bg-white/5 hover:bg-white/10 text-white/90',
      'border-gray-300 bg-white hover:bg-gray-50 text-gray-800',
    ),
    cardIdle: t(
      'border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20',
      'border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300',
    ),
    cardActive: t(
      'border-violet-500/60 bg-violet-500/15 ring-1 ring-violet-400/30',
      'border-violet-500 bg-violet-50 ring-1 ring-violet-400/40',
    ),
    panelInner: t('border-white/[0.08] bg-black/25', 'border-gray-200 bg-white'),
    input: t('border-white/15 bg-zinc-900/90 text-white', 'border-gray-300 bg-white text-gray-900'),
    iconBtn: t('hover:bg-white/10', 'hover:bg-gray-100 text-gray-700'),
    layerCardSel: t(
      'border-violet-500/60 bg-violet-500/15 ring-1 ring-violet-400/25',
      'border-[var(--scratch-looks)] bg-[var(--scratch-looks)]/15 ring-2 ring-[var(--scratch-looks)]/35',
    ),
    layerCardIdle: t('border-white/8 bg-white/[0.03] hover:bg-white/[0.06]', 'border-gray-200 bg-white hover:bg-gray-50'),
    resOn: t('border-emerald-400/50 bg-emerald-500/20 text-emerald-100', 'border-emerald-500 bg-emerald-50 text-emerald-800'),
    resOff: t(
      'border-white/10 bg-white/[0.05] text-white/75 hover:border-violet-400/35 hover:bg-violet-500/15',
      'border-gray-200 bg-white text-gray-700 hover:border-violet-400 hover:bg-violet-50',
    ),
    customOn: t('border-amber-400/50 bg-amber-500/15 text-amber-100', 'border-amber-500 bg-amber-50 text-amber-900'),
    customOff: t(
      'border-white/15 bg-white/[0.06] text-white/85 hover:bg-white/10',
      'border-gray-300 bg-white text-gray-800 hover:bg-gray-50',
    ),
    customPanel: t('border-amber-400/25 bg-amber-500/5', 'border-amber-300 bg-amber-50/80'),
    customHint: t('text-amber-200/70', 'text-amber-700'),
    thumbBg: t('bg-black/40 ring-1 ring-white/10', 'bg-gray-100 ring-1 ring-gray-200'),
    emptyLayers: t('border-dashed border-white/10', 'border-dashed border-gray-300'),
    resetBtn: t(
      'border-white/12 bg-white/5 text-white/80 hover:bg-white/10',
      'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
    ),
    deleteBtn: t('hover:bg-red-500/20 text-red-300', 'hover:bg-red-50 text-red-600'),
    exportSky: t(
      'border-sky-400/35 bg-sky-500/15 hover:bg-sky-500/25 text-sky-200',
      'border-sky-400 bg-sky-50 hover:bg-sky-100 text-sky-800',
    ),
    mainBg: t('bg-transparent', 'bg-[#f5f5f7]'),
  };
}

export interface PhotoCollageFullscreenViewProps {
  cw: number;
  ch: number;
  setCanvasSize: (w: number, h: number) => void;
  sorted: CollageLayerLike[];
  /** 自上而下：最上层在前（与堆叠顺序一致） */
  layersTopFirst: CollageLayerLike[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  getLayerSrc: (layer: CollageLayerLike) => string;
  fsViewport: { w: number; h: number };
  onClose: () => void;
  onExport: () => void;
  /** 将当前拼图栅格导出为画布上的图片节点（与节点内按钮一致） */
  onExportToWorkspace?: () => void | Promise<void>;
  bringForward: () => void;
  sendBackward: () => void;
  bringToFront: () => void;
  sendToBack: () => void;
  removeLayer: () => void;
  flipHorizontal: () => void;
  flipVertical: () => void;
  /** 复位指定图层的旋转与镜像 */
  resetLayerTransform: (layerId: string) => void;
  selectedLayer: CollageLayerLike | null;
  getLayerRotationDeg: (layer: CollageLayerLike) => number;
  onLayerRotationChange: (layerId: string, degrees: number) => void;
  onLayerRotationCommit: (layerId: string, degrees: number) => void;
  registerLayerTransformEl: (layerId: string, el: HTMLDivElement | null) => void;
  fullscreenBoardRef: React.RefObject<HTMLDivElement>;
  onLayerMouseDown: (
    e: React.MouseEvent,
    layer: CollageLayerLike,
    mode: 'move' | 'resize' | 'rotate',
    interactionScale?: number,
    logicalCW?: number,
    logicalCH?: number,
    boardElRef?: React.RefObject<HTMLDivElement | null>,
  ) => void;
  isDarkMode?: boolean;
  lightCanvasBgColor?: string;
  lightDotsColor?: string;
  lightDotSize?: number;
}

/**
 * 拼图「全屏工作室」专用界面：顶栏 + 左侧画布/图层面板 + 中央编辑区 + 底栏状态。
 */
export const PhotoCollageFullscreenView: React.FC<PhotoCollageFullscreenViewProps> = ({
  cw,
  ch,
  setCanvasSize,
  sorted,
  layersTopFirst,
  selectedId,
  setSelectedId,
  getLayerSrc,
  fsViewport,
  onClose,
  onExport,
  onExportToWorkspace,
  bringForward,
  sendBackward,
  bringToFront,
  sendToBack,
  removeLayer,
  flipHorizontal,
  flipVertical,
  resetLayerTransform,
  selectedLayer,
  getLayerRotationDeg,
  onLayerRotationChange,
  onLayerRotationCommit,
  registerLayerTransformEl,
  fullscreenBoardRef,
  onLayerMouseDown,
  isDarkMode = true,
  lightCanvasBgColor = DEFAULT_LIGHT_CANVAS_BG,
  lightDotsColor = DEFAULT_LIGHT_DOTS_COLOR,
  lightDotSize = DEFAULT_LIGHT_DOT_SIZE,
}) => {
  const { locale } = useAppLocale();
  const ct = photoCollageT(locale);
  const th = useMemo(() => mkStudioTheme(isDarkMode), [isDarkMode]);
  const boardBgStyle = useMemo(
    () => collageBoardBackgroundStyle(isDarkMode, lightCanvasBgColor, lightDotsColor, lightDotSize),
    [isDarkMode, lightCanvasBgColor, lightDotsColor, lightDotSize],
  );
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const [mainScale, setMainScale] = useState(1);

  const scalePct = useMemo(() => Math.round(mainScale * 100), [mainScale]);

  const [customActive, setCustomActive] = useState(false);
  const [selectedAspectId, setSelectedAspectId] = useState(() => findCollageAspectGroupId(cw, ch));

  const [customWFocused, setCustomWFocused] = useState(false);
  const [customHFocused, setCustomHFocused] = useState(false);
  const [customWText, setCustomWText] = useState('');
  const [customHText, setCustomHText] = useState('');
  const [exportWorkspaceAlert, setExportWorkspaceAlert] = useState<string | null>(null);
  const [exportWorkspaceBusy, setExportWorkspaceBusy] = useState(false);

  const handleCustomWFocus = useCallback(() => {
    setCustomWFocused(true);
    setCustomWText(String(cw));
  }, [cw]);
  const handleCustomWBlur = useCallback(() => {
    setCustomWFocused(false);
    const t = customWText.trim();
    if (t === '') {
      setCustomWText(String(cw));
      return;
    }
    const n = parseInt(t, 10);
    if (!Number.isFinite(n)) {
      setCustomWText(String(cw));
      return;
    }
    setCanvasSize(n, ch);
  }, [customWText, cw, ch, setCanvasSize]);

  const handleCustomHFocus = useCallback(() => {
    setCustomHFocused(true);
    setCustomHText(String(ch));
  }, [ch]);
  const handleCustomHBlur = useCallback(() => {
    setCustomHFocused(false);
    const t = customHText.trim();
    if (t === '') {
      setCustomHText(String(ch));
      return;
    }
    const n = parseInt(t, 10);
    if (!Number.isFinite(n)) {
      setCustomHText(String(ch));
      return;
    }
    setCanvasSize(cw, n);
  }, [customHText, cw, ch, setCanvasSize]);

  const handleCustomWChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      if (customWFocused) {
        setCustomWText(v);
      } else {
        const n = parseInt(v, 10);
        if (Number.isFinite(n)) setCanvasSize(n, ch);
      }
    },
    [customWFocused, ch, setCanvasSize],
  );
  const handleCustomHChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      if (customHFocused) {
        setCustomHText(v);
      } else {
        const n = parseInt(v, 10);
        if (Number.isFinite(n)) setCanvasSize(cw, n);
      }
    },
    [customHFocused, cw, setCanvasSize],
  );

  const previewW = useMemo(() => {
    if (!customWFocused) return cw;
    const t = customWText.trim();
    if (t === '') return cw;
    const n = parseInt(t, 10);
    if (!Number.isFinite(n)) return cw;
    return Math.max(MIN_CANVAS, Math.min(MAX_CANVAS, Math.round(n)));
  }, [customWFocused, customWText, cw]);

  const previewH = useMemo(() => {
    if (!customHFocused) return ch;
    const t = customHText.trim();
    if (t === '') return ch;
    const n = parseInt(t, 10);
    if (!Number.isFinite(n)) return ch;
    return Math.max(MIN_CANVAS, Math.min(MAX_CANVAS, Math.round(n)));
  }, [customHFocused, customHText, ch]);

  useEffect(() => {
    const el = canvasHostRef.current;
    if (!el) return;
    const measure = () => {
      const cr = el.getBoundingClientRect();
      const pad = 0;
      const sw = Math.max(previewW, 1);
      const sh = Math.max(previewH, 1);
      const s = Math.max(0.05, Math.min((cr.width - pad) / sw, (cr.height - pad) / sh, 1));
      setMainScale(s);
    };
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [previewW, previewH]);

  useEffect(() => {
    if (customActive) return;
    setSelectedAspectId(findCollageAspectGroupId(cw, ch));
  }, [cw, ch, customActive]);

  const selectedGroup = useMemo(() => {
    if (selectedAspectId === '__custom__') return null;
    return COLLAGE_ASPECT_GROUPS.find((g) => g.id === selectedAspectId) ?? null;
  }, [selectedAspectId]);

  const onPickAspect = (g: CollageAspectGroup) => {
    setCustomActive(false);
    setSelectedAspectId(g.id);
    const [w, h] = resolveCollage1080pDefaultSize(g);
    setCanvasSize(w, h);
  };

  return (
    <div
      className={`fixed inset-0 z-[100001] flex flex-col overflow-hidden ${th.text} ${
        isDarkMode ? '' : 'light-mode bg-[#f5f5f7]'
      }`}
      style={
        isDarkMode
          ? {
              background: 'linear-gradient(165deg, #0c0a12 0%, #12101c 40%, #0f0d16 100%)',
              boxShadow: 'inset 0 0 120px rgba(124, 58, 237, 0.06)',
            }
          : undefined
      }
      onMouseDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal
      aria-labelledby="collage-fs-title"
    >
      {/* 顶栏 */}
      <header className={`shrink-0 flex items-center gap-4 px-4 sm:px-6 h-14 border-b ${th.border} ${th.headerBg}`}>
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-lg ring-1 ${
              isDarkMode
                ? 'bg-violet-600/90 shadow-violet-900/40 ring-white/10'
                : 'bg-violet-600 shadow-violet-200/60 ring-violet-300/40'
            }`}
          >
            <LayoutGrid className="h-4 w-4 text-white" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 id="collage-fs-title" className={`text-sm sm:text-base font-semibold tracking-tight truncate ${th.text}`}>
              {ct.studioTitle}
            </h1>
            <p className={`text-[11px] truncate hidden sm:block ${th.textSubtle}`}>{ct.studioSubtitle}</p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className={`text-[11px] hidden md:inline pr-1 ${th.textFaint}`}>{ct.escClose}</span>
          {onExportToWorkspace ? (
            <button
              type="button"
              title={ct.exportToCanvas}
              disabled={exportWorkspaceBusy}
              onClick={() => {
                void (async () => {
                  setExportWorkspaceBusy(true);
                  try {
                    await onExportToWorkspace();
                    setExportWorkspaceAlert(ct.exportToCanvasDone);
                  } catch {
                    setExportWorkspaceAlert(ct.exportToCanvasFailed);
                  } finally {
                    setExportWorkspaceBusy(false);
                  }
                })();
              }}
              className={studioActionBtn(
                isDarkMode,
                'sensing',
                `${th.exportSky} ring-1 ring-white/10 border`,
              )}
            >
              <ImagePlus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{ct.exportToCanvasShort}</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void onExport()}
            className={studioActionBtn(
              isDarkMode,
              'operators',
              'bg-emerald-600/90 hover:bg-emerald-500 text-white shadow-md shadow-emerald-950/30 ring-1 ring-white/10',
            )}
          >
            <Download className="h-3.5 w-3.5" />
            {ct.exportPng}
          </button>
          <button
            type="button"
            title={ct.backToCanvas}
            onClick={onClose}
            className={studioActionBtn(
              isDarkMode,
              'control',
              `border transition-colors ${th.btnGhost}`,
            )}
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{ct.backToCanvas}</span>
          </button>
        </div>
      </header>

      {/* 主体：侧栏 + 画布区 */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* 左侧专用面板 */}
        <aside
          className={`w-full lg:w-[328px] shrink-0 flex flex-col border-b lg:border-b-0 lg:border-r ${th.border} ${th.asideBg} overflow-hidden max-h-[42vh] lg:max-h-none`}
        >
          <div className="p-4 space-y-5 overflow-y-auto flex-1 min-h-0">
            <section>
              <div className={`flex items-center gap-2 mb-2 ${th.textMuted}`}>
                <Ruler className="h-3.5 w-3.5" />
                <span className="text-xs font-semibold uppercase tracking-wider">{ct.canvasSizeSection}</span>
              </div>

              <p className={`text-[10px] mb-2 leading-relaxed ${th.textFaint}`}>{ct.aspectPickHint}</p>

              <div className="grid grid-cols-3 gap-1.5">
                {COLLAGE_ASPECT_GROUPS.map((g, gi) => {
                  const active = !customActive && selectedAspectId === g.id;
                  const scratch = SCRATCH_CYCLE[gi % SCRATCH_CYCLE.length];
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => onPickAspect(g)}
                      className={studioChipBtn(
                        isDarkMode,
                        scratch,
                        active,
                        'border-violet-500/60 bg-violet-500/15 ring-1 ring-violet-400/30',
                        'border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20',
                      )}
                    >
                      <RatioGlyph w={g.rw} h={g.rh} />
                      <span
                        className={`font-medium leading-none text-center ${
                          isDarkMode ? 'text-white/85' : active ? '' : ''
                        }`}
                      >
                        {g.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className={`mt-3 rounded-lg border px-2.5 py-2 ${th.panelInner}`}>
                <div className={`text-[10px] font-medium mb-1.5 ${isDarkMode ? 'text-white/55' : 'text-gray-600'}`}>{ct.canvasSize}</div>
                <p className={`text-[9px] mb-2 ${th.textFaint}`}>{ct.canvasSizeDesc}</p>
                {customActive ? (
                  <p className={`text-[10px] py-1 ${th.customHint}`}>{ct.customModeHint}</p>
                ) : selectedGroup ? (
                  <div className="flex flex-wrap gap-1.5 max-h-[140px] overflow-y-auto pr-0.5">
                    {selectedGroup.resolutions.map(([w, h]) => {
                      const on = cw === w && ch === h;
                      return (
                        <button
                          key={`${selectedGroup.id}-${w}-${h}`}
                          type="button"
                          onClick={() => {
                            setCustomActive(false);
                            setSelectedAspectId(selectedGroup.id);
                            setCanvasSize(w, h);
                          }}
                          className={studioResBtn(
                            isDarkMode,
                            on,
                            'border-emerald-400/50 bg-emerald-500/20 text-emerald-100',
                            'border-white/10 bg-white/[0.05] text-white/75 hover:border-violet-400/35 hover:bg-violet-500/15',
                          )}
                        >
                          {w}×{h}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className={`text-[10px] py-1 leading-relaxed ${th.textFaint}`}>
                    {ct.noTemplateHint}
                  </p>
                )}
              </div>

              <div className="mt-3 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCustomActive((v) => {
                      const next = !v;
                      if (next) {
                        setCustomWText(String(cw));
                        setCustomHText(String(ch));
                        setCustomWFocused(false);
                        setCustomHFocused(false);
                      }
                      return next;
                    });
                  }}
                  className={
                    isDarkMode
                      ? `w-full rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                          customActive ? th.customOn : th.customOff
                        }`
                      : `w-full rounded-lg border px-3 py-2 text-xs font-medium transition-colors scratch-float-btn ${scratchTintClass(customActive ? 'events' : 'variables')}`
                  }
                >
                  {customActive ? ct.collapseCustom : ct.custom}
                </button>
                {customActive ? (
                  <div
                    className={`nodrag nopan flex flex-wrap items-end gap-2 rounded-lg border p-2 ${th.customPanel}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onWheel={(e) => e.stopPropagation()}
                  >
                    <label className="flex flex-col gap-1">
                      <span className={`text-[10px] ${th.textSubtle}`}>{ct.width}</span>
                      <input
                        type="number"
                        title="画布宽度（像素）"
                        aria-label="画布宽度"
                        className={`nodrag nopan w-[5.5rem] rounded-md border px-2 py-1.5 text-xs ${th.input}`}
                        min={MIN_CANVAS}
                        max={MAX_CANVAS}
                        step={1}
                        value={customWFocused ? customWText : String(cw)}
                        onPointerDown={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        onFocus={handleCustomWFocus}
                        onBlur={handleCustomWBlur}
                        onChange={handleCustomWChange}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                      />
                    </label>
                    <span className={`pb-1.5 text-xs ${th.textFaint}`}>×</span>
                    <label className="flex flex-col gap-1">
                      <span className={`text-[10px] ${th.textSubtle}`}>{ct.height}</span>
                      <input
                        type="number"
                        title="画布高度（像素）"
                        aria-label="画布高度"
                        className={`nodrag nopan w-[5.5rem] rounded-md border px-2 py-1.5 text-xs ${th.input}`}
                        min={MIN_CANVAS}
                        max={MAX_CANVAS}
                        step={1}
                        value={customHFocused ? customHText : String(ch)}
                        onPointerDown={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        onFocus={handleCustomHFocus}
                        onBlur={handleCustomHBlur}
                        onChange={handleCustomHChange}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                      />
                    </label>
                  </div>
                ) : null}
              </div>
            </section>

            <section className={`border-t pt-4 ${isDarkMode ? 'border-white/[0.06]' : 'border-gray-200'}`}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className={`flex items-center gap-2 ${th.textMuted}`}>
                  <ImageIcon className="h-3.5 w-3.5" />
                  <span className="text-xs font-semibold uppercase tracking-wider">{ct.layers}</span>
                  <span className={`text-[10px] ${th.textFaint}`}>({layersTopFirst.length})</span>
                </div>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    title={ct.layerUpTitle}
                    disabled={!selectedLayer}
                    onClick={bringForward}
                    className={studioIconBtn(isDarkMode, 'motion', th.iconBtn)}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title={ct.layerDownTitle}
                    disabled={!selectedLayer}
                    onClick={sendBackward}
                    className={studioIconBtn(isDarkMode, 'motion', th.iconBtn)}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title={ct.layerFrontTitle}
                    disabled={!selectedLayer}
                    onClick={bringToFront}
                    className={studioIconBtn(isDarkMode, 'looks', th.iconBtn)}
                  >
                    <ChevronsUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title={ct.layerBackTitle}
                    disabled={!selectedLayer}
                    onClick={sendToBack}
                    className={studioIconBtn(isDarkMode, 'looks', th.iconBtn)}
                  >
                    <ChevronsDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title={ct.flipHTitle}
                    disabled={!selectedLayer}
                    onClick={flipHorizontal}
                    className={studioIconBtn(isDarkMode, 'sensing', th.iconBtn)}
                  >
                    <FlipHorizontal2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title={ct.flipVTitle}
                    disabled={!selectedLayer}
                    onClick={flipVertical}
                    className={studioIconBtn(isDarkMode, 'sensing', th.iconBtn)}
                  >
                    <FlipVertical2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title={ct.deleteLayerTitle}
                    disabled={!selectedLayer}
                    onClick={removeLayer}
                    className={studioIconBtn(isDarkMode, 'myBlocks', th.deleteBtn)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="space-y-1.5 max-h-[min(40vh,280px)] lg:max-h-[calc(100vh-22rem)] overflow-y-auto pr-1">
                {layersTopFirst.length === 0 ? (
                  <p className={`text-[11px] py-6 text-center rounded-lg border ${th.emptyLayers} ${th.textFaint}`}>
                    {ct.noLayers}
                  </p>
                ) : (
                  layersTopFirst.map((L, idx) => {
                    const src = getLayerSrc(L);
                    const isSel = selectedId === L.id;
                    return (
                      <div
                        key={L.id}
                        className={`flex items-center gap-1.5 rounded-lg border px-1.5 py-1.5 transition-colors ${
                          isSel ? th.layerCardSel : th.layerCardIdle
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedId(L.id)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <div className={`h-10 w-10 shrink-0 overflow-hidden rounded-md ${th.thumbBg}`}>
                            {src ? (
                              <div className="h-full w-full" style={layerImageWrapperStyle(L)}>
                                <img src={src} alt="" className="h-full w-full object-cover" draggable={false} />
                              </div>
                            ) : (
                              <div className={`h-full w-full flex items-center justify-center text-[10px] ${th.textFaint}`}>
                                ?
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className={`text-[11px] font-medium truncate ${isDarkMode ? 'text-white/90' : 'text-gray-900'}`}>
                              {ct.layerLabel} {layersTopFirst.length - idx}
                            </div>
                            <div className={`text-[10px] truncate ${th.textFaint}`}>
                              {L.w}×{L.h} · ({L.x},{L.y})
                            </div>
                          </div>
                        </button>
                        <div className="flex shrink-0 items-end gap-2 nodrag nopan pr-0.5">
                          <div className="flex flex-col items-center gap-0.5">
                            <button
                              type="button"
                              title={ct.resetLayerTitle}
                              disabled={!layerHasTransform(L)}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedId(L.id);
                                resetLayerTransform(L.id);
                              }}
                              className={
                                isDarkMode
                                  ? `inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors disabled:opacity-25 disabled:pointer-events-none ${th.resetBtn}`
                                  : `inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors scratch-float-btn ${scratchTintClass('control')} disabled:opacity-25 disabled:pointer-events-none`
                              }
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                            <span className={`text-[9px] leading-none select-none ${th.textFaint}`}>{ct.reset}</span>
                          </div>
                          <div className="flex flex-col items-center gap-0.5">
                            <PhotoCollageRotationKnob
                              value={getLayerRotationDeg(L)}
                              isDarkMode={isDarkMode}
                              size={28}
                              title={`${ct.rotateLayerTitle} ${layersTopFirst.length - idx}`}
                              onChange={(deg) => onLayerRotationChange(L.id, deg)}
                              onCommit={(deg) => onLayerRotationCommit(L.id, deg)}
                            />
                            <span className={`text-[9px] leading-none select-none ${th.textFaint}`}>{ct.direction}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        </aside>

        {/* 中央编辑区 */}
        <main className={`flex-1 min-h-0 flex flex-col min-w-0 relative ${th.mainBg}`}>
          {isDarkMode ? (
            <div
              className="absolute inset-0 opacity-[0.35] pointer-events-none"
              style={{
                backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.07) 1px, transparent 0)`,
                backgroundSize: '20px 20px',
              }}
            />
          ) : null}
          <div
            ref={canvasHostRef}
            className="relative flex-1 min-h-0 flex items-center justify-center overflow-auto p-0"
          >
            <div
              className="relative overflow-visible shrink-0"
              style={{
                width: previewW * mainScale,
                height: previewH * mainScale,
              }}
            >
              <div
                ref={fullscreenBoardRef}
                className="absolute left-0 top-0 origin-top-left overflow-visible nodrag nopan pointer-events-auto"
                style={{
                  width: previewW,
                  height: previewH,
                  transform: `scale(${mainScale})`,
                  transformOrigin: '0 0',
                }}
                onMouseDown={(e) => {
                  if (e.target === e.currentTarget) setSelectedId(null);
                }}
              >
                <div
                  className="pointer-events-none absolute inset-0 overflow-hidden"
                  style={boardBgStyle}
                  aria-hidden
                />
                {sorted.map((L) => {
                  const src = getLayerSrc(L);
                  const isSel = selectedId === L.id;
                  return (
                    <PhotoCollageLayerItem
                      key={L.id}
                      layer={L}
                      selected={isSel}
                      src={src}
                      isDarkMode={isDarkMode}
                      rotationDeg={getLayerRotationDeg(L)}
                      onMove={(e) => onLayerMouseDown(e, L, 'move', mainScale, previewW, previewH, fullscreenBoardRef)}
                      onResize={(e) =>
                        onLayerMouseDown(e, L, 'resize', mainScale, previewW, previewH, fullscreenBoardRef)
                      }
                      registerTransformEl={(el) => registerLayerTransformEl(L.id, el)}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* 底栏状态 */}
      <footer className={`shrink-0 h-9 px-4 flex items-center justify-between gap-3 border-t ${th.border} ${th.footerBg} text-[11px] ${th.textSubtle}`}>
        <span>
          {ct.footerCanvas} <span className={isDarkMode ? 'text-white/60' : 'text-gray-700'}>{previewW}</span> ×{' '}
          <span className={isDarkMode ? 'text-white/60' : 'text-gray-700'}>{previewH}</span> px
        </span>
        <span className="hidden sm:inline truncate">
          {ct.footerViewport} {fsViewport.w}×{fsViewport.h} · {ct.footerScale} {scalePct}%
        </span>
        <span className={`truncate max-w-[40%] sm:max-w-none ${th.textFaint}`}>
          {selectedLayer
            ? `${ct.footerSelectedLayer} · ${selectedLayer.w}×${selectedLayer.h}${
                Number.isFinite(selectedLayer.rotation) && Math.abs(selectedLayer.rotation ?? 0) > 0.05
                  ? ` · ${Math.round(selectedLayer.rotation!)}°`
                  : ''
              }`
            : ct.footerNoSelection}
        </span>
      </footer>
      <DarkAlertModal
        open={!!exportWorkspaceAlert}
        message={exportWorkspaceAlert || ''}
        onClose={() => setExportWorkspaceAlert(null)}
        size="double"
        stackZClass="z-[110000]"
      />
    </div>
  );
};
