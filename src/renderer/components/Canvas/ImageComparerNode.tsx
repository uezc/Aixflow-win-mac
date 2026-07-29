// @ts-nocheck
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeProps, useUpdateNodeInternals } from 'reactflow';
import { Maximize2, SplitSquareHorizontal, X } from 'lucide-react';
import { mapProjectPath } from '../../utils/pathMapper';
import { scaleModulePx } from '../../utils/moduleDisplayScale';
import {
  IMAGE_NODE_MAX_H,
  IMAGE_NODE_MAX_W,
  IMAGE_NODE_MIN_H,
  IMAGE_NODE_MIN_W,
  NODE_SIZE_TRANSITION,
  aspectRatioLabelFromPixelSize,
  computeNodeSizeFromMedia,
} from '../../utils/nodeSizeFromAspectRatio';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { imageComparerT, type ImageComparerStrings } from '../../i18n/imageComparerI18n';
import {
  IMAGE_COMPARER_HANDLE_A,
  IMAGE_COMPARER_HANDLE_B,
} from '../../utils/imageComparerFromEdges';

/** 默认窗口相对初版 ×1.5 */
export const IMAGE_COMPARER_DEFAULT_W = Math.round(scaleModulePx(420) * 1.5);
export const IMAGE_COMPARER_DEFAULT_H = Math.round(scaleModulePx(280) * 1.5);

/** 对比模块短边算法结果再 ×1.5，便于 wipe 观看 */
const COMPARER_SIZE_SCALE = 1.5;
const COMPARER_MIN_W = Math.round(IMAGE_NODE_MIN_W * COMPARER_SIZE_SCALE);
const COMPARER_MIN_H = Math.round(IMAGE_NODE_MIN_H * COMPARER_SIZE_SCALE);
const COMPARER_MAX_W = Math.min(IMAGE_NODE_MAX_W, Math.round(960 * COMPARER_SIZE_SCALE));
const COMPARER_MAX_H = Math.min(IMAGE_NODE_MAX_H, Math.round(960 * COMPARER_SIZE_SCALE));

export interface ImageComparerNodeData {
  width?: number;
  height?: number;
  imageAUrl?: string;
  imageBUrl?: string;
  imageASourceNodeId?: string;
  imageBSourceNodeId?: string;
  /** 0–1，分割线位置（左侧可见 A 的比例） */
  splitRatio?: number;
  aspectRatio?: string;
  mediaWidth?: number;
  mediaHeight?: number;
  isUserResized?: boolean;
}

interface ImageComparerNodeProps extends NodeProps<ImageComparerNodeData> {
  projectId?: string;
  isDarkMode?: boolean;
  onDataChange?: (nodeId: string, updates: Partial<ImageComparerNodeData>) => void;
}

/** 从 string / {url|preview|original|path} / 其它值里抽出可用的图片 URL 字符串 */
function coerceImageUrl(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw).trim();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const u = coerceImageUrl(item);
      if (u) return u;
    }
    return '';
  }
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    for (const key of ['url', 'preview', 'original', 'src', 'path', 'localPath'] as const) {
      const v = o[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return '';
}

/** 与 ImageNode / PhotoCollage 一致：本地路径 → local-resource */
function formatImagePath(path: unknown): string {
  const s = coerceImageUrl(path);
  if (!s || typeof s !== 'string') return '';
  if (
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('data:') ||
    s.startsWith('blob:')
  ) {
    return s;
  }
  if (s.startsWith('local-resource://')) return s;
  const cleanPath = s.replace(/^(file:\/\/|local-resource:\/\/)/, '');
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

/** 同步格式化（不做 mapProjectPath；该 API 是 async，不能在 render 里同步调用） */
function formatDisplaySrcSync(raw: unknown): string {
  return formatImagePath(raw);
}

function clampSplit(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.min(0.98, Math.max(0.02, v));
}

function clampZoom(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(4, Math.max(0.5, v));
}

function loadImageNaturalSize(src: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    if (!src || typeof src !== 'string') {
      resolve(null);
      return;
    }
    const im = new Image();
    if (/^https?:\/\//i.test(src)) {
      try {
        im.crossOrigin = 'anonymous';
      } catch {
        /* ignore */
      }
    }
    im.onload = () => {
      const w = im.naturalWidth;
      const h = im.naturalHeight;
      resolve(w > 0 && h > 0 ? { w, h } : null);
    };
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

function aspectsClose(a: number, b: number, tol = 0.04): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return true;
  return Math.abs(a - b) / Math.max(a, b) <= tol;
}

function fitBoxInViewport(aspectW: number, aspectH: number, maxW: number, maxH: number): { w: number; h: number } {
  if (aspectW <= 0 || aspectH <= 0 || maxW <= 0 || maxH <= 0) {
    return { w: maxW, h: maxH };
  }
  const ratio = aspectW / aspectH;
  let w = maxW;
  let h = w / ratio;
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

type WipeStageProps = {
  imageAUrl: string;
  imageBUrl: string;
  split: number;
  isDarkMode: boolean;
  t: ImageComparerStrings;
  variant: 'inline' | 'fullscreen';
  zoom?: number;
  aspectMismatch?: boolean;
  onSplitChange: (next: number) => void;
  onSplitCommit?: () => void;
  className?: string;
  style?: React.CSSProperties;
};

/** 共用 wipe 舞台：B 在底、A 用 clip-path 盖住左侧 */
const ImageComparerWipeStage: React.FC<WipeStageProps> = ({
  imageAUrl,
  imageBUrl,
  split,
  isDarkMode,
  t,
  variant,
  zoom = 1,
  aspectMismatch = false,
  onSplitChange,
  onSplitCommit,
  className = '',
  style,
}) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const hasAny = !!(imageAUrl || imageBUrl);
  const hasBoth = !!(imageAUrl && imageBUrl);
  const pct = Math.round(split * 1000) / 10;
  const clipA = `inset(0 ${100 - pct}% 0 0)`;
  const isFs = variant === 'fullscreen';

  const updateFromClientX = useCallback(
    (clientX: number) => {
      const el = stageRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      onSplitChange(clampSplit((clientX - rect.left) / rect.width));
    },
    [onSplitChange],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => updateFromClientX(e.clientX);
    const onUp = () => {
      setDragging(false);
      onSplitCommit?.();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, updateFromClientX, onSplitCommit]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (!hasAny) return;
    e.stopPropagation();
    e.preventDefault();
    setDragging(true);
    updateFromClientX(e.clientX);
  };

  const placeholderCls = isDarkMode ? 'text-white/55' : 'text-gray-500';
  // 深色透明棋盘格（接近 PS/参考截图的灰格）
  const checkerDark =
    'linear-gradient(45deg, #323238 25%, transparent 25%), linear-gradient(-45deg, #323238 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #323238 75%), linear-gradient(-45deg, transparent 75%, #323238 75%)';
  const checkerLight =
    'linear-gradient(45deg, #d4d4d8 25%, transparent 25%), linear-gradient(-45deg, #d4d4d8 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d4d4d8 75%), linear-gradient(-45deg, transparent 75%, #d4d4d8 75%)';
  const imgFit = hasBoth ? 'object-cover' : 'object-contain';

  return (
    <div
      ref={stageRef}
      className={`relative overflow-hidden select-none ${
        variant === 'inline' ? 'nodrag nopan nowheel' : ''
      } ${className}`}
      style={{
        zIndex: 1,
        backgroundColor: isDarkMode ? '#1c1c20' : '#ececef',
        backgroundImage: isDarkMode ? checkerDark : checkerLight,
        backgroundSize: '16px 16px',
        backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
        cursor: hasAny ? 'ew-resize' : 'default',
        // 空态不拦左侧把手命中；有图时仍需拖分割线
        pointerEvents: hasAny ? 'auto' : 'none',
        ...style,
      }}
      onPointerDown={onPointerDown}
      title={hasAny ? t.dragHint : t.emptyHint}
    >
      {!hasAny ? (
        <div className="pointer-events-none absolute inset-0 flex h-full w-full flex-col items-center justify-center gap-3 px-8 text-center">
          <SplitSquareHorizontal
            className={`${isFs ? 'h-12 w-12' : 'h-9 w-9'} ${isDarkMode ? 'text-white' : 'text-gray-700'}`}
            strokeWidth={1.75}
          />
          <p
            className={`max-w-[22rem] leading-snug ${
              isFs ? 'text-sm' : 'text-[13px]'
            } ${isDarkMode ? 'text-white' : 'text-gray-700'}`}
          >
            {t.emptyHint}
          </p>
        </div>
      ) : (
        <>
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={zoom !== 1 ? { transform: `scale(${zoom})`, transformOrigin: 'center center' } : undefined}
          >
            <div className="relative h-full w-full">
              {imageBUrl ? (
                <img
                  src={imageBUrl}
                  alt=""
                  draggable={false}
                  className={`pointer-events-none absolute inset-0 z-[1] h-full w-full select-none ${imgFit}`}
                />
              ) : (
                <div
                  className={`absolute inset-0 z-[1] flex items-center justify-center ${isFs ? 'text-base' : 'text-xs'} ${placeholderCls}`}
                >
                  {t.connectBHint}
                </div>
              )}

              {imageAUrl ? (
                <img
                  src={imageAUrl}
                  alt=""
                  draggable={false}
                  className={`pointer-events-none absolute inset-0 z-[2] h-full w-full select-none ${imgFit}`}
                  style={{ clipPath: clipA }}
                />
              ) : (
                <div
                  className={`pointer-events-none absolute inset-0 z-[2] flex items-center justify-center overflow-hidden ${
                    isFs ? 'text-base' : 'text-xs'
                  } ${placeholderCls}`}
                  style={{ clipPath: clipA }}
                >
                  <span className="px-3 text-center">{t.connectAHint}</span>
                </div>
              )}
            </div>
          </div>

          {/* 竖向 wipe 分割：白线 + 中间黑圆拖动手柄 */}
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-10"
            style={{ left: `${pct}%`, transform: 'translateX(-50%)' }}
          >
            <div className="h-full w-px bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" />
            <div
              className={`absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black text-white shadow-lg ring-1 ring-white/20 ${
                isFs ? 'h-10 w-10' : 'h-8 w-8'
              }`}
              aria-hidden
            >
              <svg
                viewBox="0 0 24 24"
                className={isFs ? 'h-4 w-4' : 'h-3.5 w-3.5'}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M8 9l-3 3 3 3" />
                <path d="M16 9l3 3-3 3" />
              </svg>
            </div>
          </div>

          {/* A / B 浅灰方角标签 */}
          <span
            className={`pointer-events-none absolute left-2 top-2 z-10 rounded-sm bg-white/75 px-1.5 py-0.5 font-semibold tracking-wide text-zinc-800 ${
              isFs ? 'text-xs' : 'text-[10px]'
            }`}
          >
            {t.slotA}
          </span>
          <span
            className={`pointer-events-none absolute right-2 top-2 z-10 rounded-sm bg-white/75 px-1.5 py-0.5 font-semibold tracking-wide text-zinc-800 ${
              isFs ? 'text-xs' : 'text-[10px]'
            }`}
          >
            {t.slotB}
          </span>

          {aspectMismatch && hasBoth ? (
            <span
              className={`pointer-events-none absolute bottom-2 left-1/2 z-10 max-w-[90%] -translate-x-1/2 truncate rounded px-2 py-0.5 text-center ${
                isFs ? 'text-[11px]' : 'text-[9px]'
              } ${isDarkMode ? 'bg-amber-500/20 text-amber-100/90' : 'bg-amber-100 text-amber-900/80'}`}
            >
              {t.aspectMismatch}
            </span>
          ) : null}
        </>
      )}
    </div>
  );
};

type FullscreenProps = {
  imageAUrl: string;
  imageBUrl: string;
  split: number;
  isDarkMode: boolean;
  t: ImageComparerStrings;
  mediaW?: number;
  mediaH?: number;
  aspectMismatch?: boolean;
  onSplitChange: (next: number) => void;
  onSplitCommit: () => void;
  onClose: () => void;
};

const ImageComparerFullscreenView: React.FC<FullscreenProps> = ({
  imageAUrl,
  imageBUrl,
  split,
  isDarkMode,
  t,
  mediaW,
  mediaH,
  aspectMismatch,
  onSplitChange,
  onSplitCommit,
  onClose,
}) => {
  const [zoom, setZoom] = useState(1);
  const areaRef = useRef<HTMLDivElement>(null);
  const [stageBox, setStageBox] = useState({ w: 800, h: 450 });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const update = () => {
      const pad = 32;
      const header = 56;
      const maxW = Math.max(320, window.innerWidth - pad * 2);
      const maxH = Math.max(240, window.innerHeight - header - pad * 2);
      const aw = mediaW && mediaW > 0 ? mediaW : 16;
      const ah = mediaH && mediaH > 0 ? mediaH : 9;
      setStageBox(fitBoxInViewport(aw, ah, maxW, maxH));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [mediaW, mediaH]);

  useEffect(() => {
    const root = areaRef.current;
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      setZoom((z) => clampZoom(z + delta));
    };
    root.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => root.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions);
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex flex-col bg-[#0a0a0c]"
      style={{ pointerEvents: 'auto' }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-white/85">
          <SplitSquareHorizontal className="h-4 w-4 opacity-70" />
          <span className="font-medium">{t.label}</span>
          <span className="text-xs text-white/40">{t.zoomHint}</span>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/10 px-3 py-1.5 text-xs text-white/90 hover:bg-white/16"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title={t.closeFullscreen}
        >
          <X className="h-3.5 w-3.5" />
          {t.closeFullscreen}
        </button>
      </div>
      <div ref={areaRef} className="relative flex min-h-0 flex-1 items-center justify-center p-4">
        <ImageComparerWipeStage
          imageAUrl={imageAUrl}
          imageBUrl={imageBUrl}
          split={split}
          isDarkMode={isDarkMode}
          t={t}
          variant="fullscreen"
          zoom={zoom}
          aspectMismatch={aspectMismatch}
          onSplitChange={onSplitChange}
          onSplitCommit={onSplitCommit}
          className="rounded-xl border border-white/10 shadow-2xl"
          style={{ width: stageBox.w, height: stageBox.h }}
        />
      </div>
    </div>,
    document.body,
  );
};

const ImageComparerNode: React.FC<ImageComparerNodeProps> = ({
  id,
  data,
  selected = false,
  isDarkMode = true,
  projectId,
  onDataChange,
}) => {
  const { locale } = useAppLocale();
  const t = imageComparerT(locale);
  const updateNodeInternals = useUpdateNodeInternals();
  const w = Math.max(COMPARER_MIN_W, Number(data?.width) || IMAGE_COMPARER_DEFAULT_W);
  const h = Math.max(COMPARER_MIN_H, Number(data?.height) || IMAGE_COMPARER_DEFAULT_H);

  const rawA = coerceImageUrl(data?.imageAUrl);
  const rawB = coerceImageUrl(data?.imageBUrl);
  const [imageAUrl, setImageAUrl] = useState(() => formatDisplaySrcSync(rawA));
  const [imageBUrl, setImageBUrl] = useState(() => formatDisplaySrcSync(rawB));

  const [split, setSplit] = useState(() => clampSplit(Number(data?.splitRatio) || 0.5));
  const splitRef = useRef(split);
  splitRef.current = split;
  const [fullscreen, setFullscreen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [aspectMismatch, setAspectMismatch] = useState(false);
  const [mediaSize, setMediaSize] = useState<{ w: number; h: number } | null>(() => {
    const mw = Number(data?.mediaWidth);
    const mh = Number(data?.mediaHeight);
    return Number.isFinite(mw) && Number.isFinite(mh) && mw > 0 && mh > 0 ? { w: mw, h: mh } : null;
  });
  const lastAppliedSizeRef = useRef<{ srcKey: string; w: number; h: number } | null>(null);
  const isUserResized = Boolean(data?.isUserResized);

  // 与 PhotoCollage 一致：先 sync format，再异步 mapProjectPath（切勿在 render 里 await/同步当 string 用）
  useEffect(() => {
    let cancelled = false;
    const a0 = formatDisplaySrcSync(rawA);
    const b0 = formatDisplaySrcSync(rawB);
    setImageAUrl(a0);
    setImageBUrl(b0);
    void (async () => {
      let a = a0;
      let b = b0;
      if (projectId && a.startsWith('local-resource://')) {
        try {
          const mapped = await mapProjectPath(a, projectId);
          if (typeof mapped === 'string' && mapped.trim()) a = mapped;
        } catch {
          /* keep */
        }
      }
      if (projectId && b.startsWith('local-resource://')) {
        try {
          const mapped = await mapProjectPath(b, projectId);
          if (typeof mapped === 'string' && mapped.trim()) b = mapped;
        } catch {
          /* keep */
        }
      }
      if (!cancelled) {
        setImageAUrl(a);
        setImageBUrl(b);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rawA, rawB, projectId]);

  // 按输入图比例自适应节点外框（优先 A；同比例对比场景）
  useEffect(() => {
    let cancelled = false;
    const srcKey = `${imageAUrl || ''}|${imageBUrl || ''}`;
    if (!imageAUrl && !imageBUrl) {
      setAspectMismatch(false);
      setMediaSize(null);
      return;
    }
    void (async () => {
      const sizeA = imageAUrl ? await loadImageNaturalSize(imageAUrl) : null;
      const sizeB = imageBUrl ? await loadImageNaturalSize(imageBUrl) : null;
      if (cancelled) return;

      const primary = sizeA || sizeB;
      if (!primary) return;

      const mismatch =
        !!(sizeA && sizeB) &&
        !aspectsClose(sizeA.w / sizeA.h, sizeB.w / sizeB.h);
      setAspectMismatch(mismatch);
      setMediaSize(primary);

      if (isUserResized) return;

      const adapted0 = computeNodeSizeFromMedia(
        primary.w,
        primary.h,
        Math.round(IMAGE_NODE_MIN_W),
        Math.round(IMAGE_NODE_MIN_H),
        Math.round(960),
        Math.round(960),
        Math.round(scaleModulePx(420)),
        Math.round(scaleModulePx(280)),
      );
      const adapted = {
        w: Math.min(COMPARER_MAX_W, Math.max(COMPARER_MIN_W, Math.round(adapted0.w * COMPARER_SIZE_SCALE))),
        h: Math.min(COMPARER_MAX_H, Math.max(COMPARER_MIN_H, Math.round(adapted0.h * COMPARER_SIZE_SCALE))),
      };
      const last = lastAppliedSizeRef.current;
      if (last && last.srcKey === srcKey && last.w === adapted.w && last.h === adapted.h) {
        return;
      }
      lastAppliedSizeRef.current = { srcKey, w: adapted.w, h: adapted.h };
      const aspectRatio = aspectRatioLabelFromPixelSize(primary.w, primary.h);
      onDataChange?.(id, {
        width: adapted.w,
        height: adapted.h,
        aspectRatio,
        mediaWidth: primary.w,
        mediaHeight: primary.h,
        isUserResized: false,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [imageAUrl, imageBUrl, id, isUserResized, onDataChange]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => updateNodeInternals(id));
    const tmr = window.setTimeout(() => updateNodeInternals(id), 360);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(tmr);
    };
  }, [id, w, h, updateNodeInternals]);

  useEffect(() => {
    if (typeof data?.splitRatio === 'number' && Number.isFinite(data.splitRatio)) {
      setSplit(clampSplit(data.splitRatio));
    }
  }, [data?.splitRatio]);

  const onSplitChange = useCallback((next: number) => {
    setSplit(next);
    splitRef.current = next;
  }, []);

  const onSplitCommit = useCallback(() => {
    onDataChange?.(id, { splitRatio: splitRef.current });
  }, [id, onDataChange]);

  const hasAnyPreview = !!(imageAUrl || imageBUrl);

  const showChrome = selected || hovered || fullscreen;

  const handleBadge = (label: string, topPct: string) => (
    <div
      className={`pointer-events-none absolute z-[5] rounded px-1 py-0.5 text-[9px] font-bold leading-none tracking-wide ${
        isDarkMode
          ? 'bg-zinc-800/90 text-white/55 ring-1 ring-white/10'
          : 'bg-white/95 text-gray-500 ring-1 ring-black/10'
      }`}
      style={{ left: 10, top: topPct, transform: 'translateY(-50%)' }}
    >
      {label}
    </div>
  );

  return (
    <>
      <div
        className={`custom-node-container group relative overflow-visible rounded-2xl ${
          hasAnyPreview
            ? 'custom-node-container--transparent bg-transparent p-0 shadow-none'
            : isDarkMode
              ? 'nexflow-glass-panel text-white'
              : 'apple-panel-light text-gray-900'
        } ${selected ? 'nexflow-node-selected' : ''}`}
        style={{ width: w, height: h, transition: NODE_SIZE_TRANSITION }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* 与 ImageNode 一致：模块上方图标 + 标题 */}
        {(showChrome || !hasAnyPreview) && (
          <div className="title-area pointer-events-none absolute -top-7 left-0 right-0 z-10 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1">
              <SplitSquareHorizontal
                className={`h-3 w-3 shrink-0 ${isDarkMode ? 'text-white/55' : 'text-gray-500'}`}
                strokeWidth={2.25}
              />
              <span
                className={`truncate text-xs font-medium ${
                  isDarkMode ? 'text-white/75' : 'text-gray-700'
                }`}
              >
                {t.label}
              </span>
            </div>
          </div>
        )}

        {showChrome && (
          <button
            type="button"
            className={`nodrag absolute top-2 right-2 z-20 rounded-lg p-1.5 transition-all ${
              isDarkMode ? 'apple-panel hover:bg-white/20' : 'apple-panel-light hover:bg-gray-200/30'
            }`}
            style={{ pointerEvents: 'all' }}
            title={t.fullscreen}
            aria-label={t.fullscreen}
            onClick={(e) => {
              e.stopPropagation();
              setFullscreen(true);
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
          >
            <Maximize2 className={`h-3.5 w-3.5 ${isDarkMode ? 'text-white/80' : 'text-gray-700'}`} />
          </button>
        )}

        <ImageComparerWipeStage
          imageAUrl={imageAUrl}
          imageBUrl={imageBUrl}
          split={split}
          isDarkMode={isDarkMode}
          t={t}
          variant="inline"
          aspectMismatch={aspectMismatch}
          onSplitChange={onSplitChange}
          onSplitCommit={onSplitCommit}
          className="node-body absolute inset-0 rounded-2xl"
        />

        {/* 左侧 A/B：与 ImageNode 同款 nexflow-plus-handle-left，走标准左磁吸 */}
        <Handle
          type="target"
          position={Position.Left}
          id={IMAGE_COMPARER_HANDLE_A}
          isConnectable={true}
          style={{ top: '35%', left: 0, zIndex: 50 }}
          className="nexflow-plus-handle nexflow-plus-handle-left nodrag nopan"
          title={t.connectA}
        />
        {handleBadge(t.slotA, '35%')}
        <Handle
          type="target"
          position={Position.Left}
          id={IMAGE_COMPARER_HANDLE_B}
          isConnectable={true}
          style={{ top: '65%', left: 0, zIndex: 50 }}
          className="nexflow-plus-handle nexflow-plus-handle-left nodrag nopan"
          title={t.connectB}
        />
        {handleBadge(t.slotB, '65%')}
      </div>

      {fullscreen && (
        <ImageComparerFullscreenView
          imageAUrl={imageAUrl}
          imageBUrl={imageBUrl}
          split={split}
          isDarkMode={isDarkMode}
          t={t}
          mediaW={mediaSize?.w || w}
          mediaH={mediaSize?.h || h}
          aspectMismatch={aspectMismatch}
          onSplitChange={onSplitChange}
          onSplitCommit={onSplitCommit}
          onClose={() => setFullscreen(false)}
        />
      )}
    </>
  );
};

export default ImageComparerNode;
