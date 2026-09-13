// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { videoSpliceT } from '../../i18n/videoSpliceI18n';
import { aspectRatioLabelFromPixelSize } from '../../utils/nodeSizeFromAspectRatio';
import {
  COLLAGE_ASPECT_GROUPS,
  RatioGlyph,
  resolveCollage1080pDefaultSize,
  type CollageAspectGroup,
} from './photoCollageAspectRatio';

export const SPLICE_ASPECT_AUTO_ID = 'auto';
export const DEFAULT_SPLICE_PREVIEW_ASPECT_ID = SPLICE_ASPECT_AUTO_ID;
/** 剪辑比例菜单：不含拼图用的 Open Graph ≈1.91:1 */
export const SPLICE_ASPECT_GROUPS: CollageAspectGroup[] = COLLAGE_ASPECT_GROUPS.filter(
  (g) => g.id !== 'og',
);

const LEGACY_DEFAULT_ASPECT_IDS = new Set(['', '16-9', '9-16', SPLICE_ASPECT_AUTO_ID]);

export type SplicePixelSize = { width: number; height: number };

export function isSpliceAspectAuto(aspectId?: string | null): boolean {
  const id = String(aspectId || '').trim();
  return !id || id === SPLICE_ASPECT_AUTO_ID;
}

export function evenSpliceExportDim(n: number): number {
  return Math.max(2, Math.round(Number(n) || 0) & ~1);
}

export function normalizeSpliceExportSize(width: number, height: number): SplicePixelSize {
  return {
    width: evenSpliceExportDim(width),
    height: evenSpliceExportDim(height),
  };
}

function asPositivePixelSize(w: unknown, h: unknown): SplicePixelSize | null {
  const width = Number(w);
  const height = Number(h);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) return null;
  return { width, height };
}

export type SpliceAspectData = {
  previewAspectId?: string | null;
  previewAspectUserPicked?: boolean | null;
  exportOutputWidth?: number | null;
  exportOutputHeight?: number | null;
};

/** 未手选过的旧默认 16:9 / 9:16 视为 auto，手选过的固定比例保持 */
export function resolveEffectiveSpliceAspectId(data?: SpliceAspectData | null): string {
  const id = String(data?.previewAspectId || '').trim();
  if (data?.previewAspectUserPicked && id) return id;
  if (id && !LEGACY_DEFAULT_ASPECT_IDS.has(id)) return id;
  return SPLICE_ASPECT_AUTO_ID;
}

/** 导演/新建写入：用户手选过则保留，否则 auto */
export function splicePreviewAspectIdForImport(existing?: SpliceAspectData | null): string {
  if (existing?.previewAspectUserPicked && existing.previewAspectId) {
    return String(existing.previewAspectId);
  }
  return SPLICE_ASPECT_AUTO_ID;
}

/** 只读素材像素，不用模块外框宽高 */
export function resolveAssetPixelSizeFromNodeData(
  data?: Record<string, unknown> | null,
  kind: 'video' | 'image' = 'video',
): SplicePixelSize | null {
  if (!data) return null;
  const asset =
    kind === 'image'
      ? (data.imageAsset as { width?: number; height?: number } | undefined)
      : (data.videoAsset as { width?: number; height?: number } | undefined);
  return asPositivePixelSize(asset?.width, asset?.height);
}

export function resolveClipSourcePixelSize(
  clip?: {
    type?: string;
    sourceWidth?: number;
    sourceHeight?: number;
    sourceNodeId?: string;
  } | null,
  sourceNode?: { type?: string; data?: Record<string, unknown> } | null,
): SplicePixelSize | null {
  if (!clip) return null;
  const fromClip = asPositivePixelSize(clip.sourceWidth, clip.sourceHeight);
  if (fromClip) return fromClip;
  if (!sourceNode) return null;
  const kind = clip.type === 'image' || sourceNode.type === 'image' ? 'image' : 'video';
  return resolveAssetPixelSizeFromNodeData(sourceNode.data, kind);
}

export function resolveSpliceSourcePixelSize(
  clips?: Array<{
    type?: string;
    startTime?: number;
    sourceWidth?: number;
    sourceHeight?: number;
    sourceNodeId?: string;
  }> | null,
  sourceNodes?: Array<{ id: string; type?: string; data?: Record<string, unknown> }> | null,
): SplicePixelSize | null {
  const visual = (clips || [])
    .filter((c) => c && (c.type === 'video' || c.type === 'image'))
    .slice()
    .sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0));
  const nodeById = new Map((sourceNodes || []).map((n) => [n.id, n]));
  for (const c of visual) {
    const node = c.sourceNodeId ? nodeById.get(c.sourceNodeId) : undefined;
    const size = resolveClipSourcePixelSize(c, node);
    if (size) return size;
  }
  return null;
}

function makeAutoAspectGroup(sourceSize?: SplicePixelSize | null): CollageAspectGroup {
  if (sourceSize) {
    const even = normalizeSpliceExportSize(sourceSize.width, sourceSize.height);
    return {
      id: SPLICE_ASPECT_AUTO_ID,
      label: 'Auto',
      rw: even.width,
      rh: even.height,
      resolutions: [[even.width, even.height]],
    };
  }
  return {
    id: SPLICE_ASPECT_AUTO_ID,
    label: 'Auto',
    rw: 16,
    rh: 9,
    resolutions: [[1920, 1080]],
  };
}

export function resolveSplicePreviewAspectGroup(
  aspectId?: string | null,
  sourceSize?: SplicePixelSize | null,
): CollageAspectGroup {
  if (isSpliceAspectAuto(aspectId)) return makeAutoAspectGroup(sourceSize);
  return (
    SPLICE_ASPECT_GROUPS.find((g) => g.id === aspectId) ??
    COLLAGE_ASPECT_GROUPS.find((g) => g.id === aspectId) ??
    makeAutoAspectGroup(sourceSize)
  );
}

/** 解析剪辑预览/导出的像素分辨率；auto 跟原片，固定比例用 1080p 档 */
export function resolveSpliceExportDimensions(
  data?: SpliceAspectData | null,
  sourceSize?: SplicePixelSize | null,
): { aspectId: string; width: number; height: number; aspectRatio: string; auto: boolean } {
  const aspectId = resolveEffectiveSpliceAspectId(data);
  if (isSpliceAspectAuto(aspectId)) {
    const fromSource = sourceSize
      ? normalizeSpliceExportSize(sourceSize.width, sourceSize.height)
      : null;
    const persisted = asPositivePixelSize(data?.exportOutputWidth, data?.exportOutputHeight);
    const size = fromSource || persisted || { width: 1920, height: 1080 };
    const even = normalizeSpliceExportSize(size.width, size.height);
    return {
      aspectId: SPLICE_ASPECT_AUTO_ID,
      width: even.width,
      height: even.height,
      aspectRatio: aspectRatioLabelFromPixelSize(even.width, even.height),
      auto: true,
    };
  }
  const aspectGroup = resolveSplicePreviewAspectGroup(aspectId);
  const [defaultW, defaultH] = resolveCollage1080pDefaultSize(aspectGroup);
  const width = Math.max(2, Math.round(Number(data?.exportOutputWidth) || defaultW));
  const height = Math.max(2, Math.round(Number(data?.exportOutputHeight) || defaultH));
  return {
    aspectId: aspectGroup.id,
    width,
    height,
    aspectRatio: `${aspectGroup.rw}:${aspectGroup.rh}`,
    auto: false,
  };
}

function AutoRatioGlyph() {
  return (
    <svg width={30} height={18} className="shrink-0 text-violet-300" aria-hidden>
      <rect
        x="0.5"
        y="0.5"
        width={29}
        height={17}
        rx="4"
        fill="rgba(255,255,255,0.06)"
        stroke="rgba(255,255,255,0.14)"
      />
      <rect
        x="6"
        y="3.5"
        width="18"
        height="11"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeDasharray="2.2 1.6"
        opacity={0.92}
      />
    </svg>
  );
}

export interface VideoSpliceAspectRatioDropdownProps {
  selectedAspectId: string;
  isDarkMode?: boolean;
  md?: boolean;
  placement?: 'up' | 'down';
  onSelect: (aspectId: string) => void;
  className?: string;
}

export const VideoSpliceAspectRatioDropdown: React.FC<VideoSpliceAspectRatioDropdownProps> = ({
  selectedAspectId,
  isDarkMode = true,
  md = false,
  placement = 'up',
  onSelect,
  className = '',
}) => {
  const { locale } = useAppLocale();
  const vs = videoSpliceT(locale);
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIsAuto = isSpliceAspectAuto(selectedAspectId);

  const selectedGroup = useMemo(
    () => resolveSplicePreviewAspectGroup(selectedAspectId),
    [selectedAspectId],
  );
  const selectedLabel = selectedIsAuto ? vs.aspectAuto : selectedGroup.label;

  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc, true);
    return () => document.removeEventListener('mousedown', onDoc, true);
  }, [open]);

  const onPickAspect = useCallback(
    (aspectId: string) => {
      onSelect(aspectId);
      setOpen(false);
    },
    [onSelect],
  );

  const panelPos = placement === 'up' ? 'bottom-full left-0 mb-1.5' : 'top-full left-0 mt-1.5';

  const panelSkin = isDarkMode
    ? 'border-white/12 bg-zinc-900/95 text-white shadow-xl shadow-black/40'
    : 'border-gray-200 bg-white text-gray-900 shadow-xl';

  const triggerSkin = isDarkMode
    ? 'bg-white/10 text-white/85 hover:bg-white/18 border border-white/10'
    : 'bg-black/10 text-gray-800 hover:bg-black/15 border border-black/10';

  const iconSize = md ? '!h-10 !w-auto !min-w-[2.5rem] !px-2' : '!h-8 !w-auto !min-w-[2rem] !px-1.5';

  const optionClass = (active: boolean) =>
    `flex flex-col items-center justify-center gap-1 rounded-lg border px-1 py-2 transition-colors ${
      active
        ? 'border-violet-500/60 bg-violet-500/15 ring-1 ring-violet-400/30'
        : isDarkMode
          ? 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20'
          : 'border-gray-200 bg-gray-50 hover:bg-gray-100 hover:border-gray-300'
    }`;

  return (
    <div ref={rootRef} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        title={vs.pickAspectRatioTitle}
        aria-expanded={open ? 'true' : 'false'}
        aria-label={`${vs.aspectRatioLabel}: ${selectedLabel}`}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((v) => !v);
        }}
        className={`nodrag nopan inline-flex items-center justify-center gap-0.5 rounded-lg transition-colors ${triggerSkin} ${iconSize}`}
      >
        {selectedIsAuto ? <AutoRatioGlyph /> : <RatioGlyph w={selectedGroup.rw} h={selectedGroup.rh} />}
        <span className={`font-medium leading-none ${md ? 'text-xs' : 'text-[10px]'}`}>{selectedLabel}</span>
        <ChevronDown
          className={`shrink-0 opacity-70 transition-transform ${md ? 'w-3.5 h-3.5' : 'w-3 h-3'} ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div
          className={`nodrag nopan absolute ${panelPos} z-[120] w-[15.5rem] rounded-xl border p-2 ${panelSkin}`}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          <div className={`mb-1.5 px-0.5 text-[10px] font-medium ${isDarkMode ? 'text-white/55' : 'text-gray-600'}`}>
            {vs.aspectRatioLabel}
          </div>
          <div
            className={`grid grid-cols-3 gap-1.5 max-h-[220px] overflow-y-auto pr-0.5 ${
              isDarkMode ? 'custom-scrollbar-dark' : 'custom-scrollbar'
            }`}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPickAspect(SPLICE_ASPECT_AUTO_ID);
              }}
              className={optionClass(selectedIsAuto)}
            >
              <AutoRatioGlyph />
              <span
                className={`text-[10px] font-medium leading-none text-center ${
                  isDarkMode ? 'text-white/85' : 'text-gray-800'
                }`}
              >
                {vs.aspectAuto}
              </span>
            </button>
            {SPLICE_ASPECT_GROUPS.map((g) => {
              const active = selectedAspectId === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPickAspect(g.id);
                  }}
                  className={optionClass(active)}
                >
                  <RatioGlyph w={g.rw} h={g.rh} />
                  <span
                    className={`text-[10px] font-medium leading-none text-center ${
                      isDarkMode ? 'text-white/85' : 'text-gray-800'
                    }`}
                  >
                    {g.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
};
