// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { videoSpliceT } from '../../i18n/videoSpliceI18n';
import {
  COLLAGE_ASPECT_GROUPS,
  RatioGlyph,
  resolveCollage1080pDefaultSize,
  type CollageAspectGroup,
} from './photoCollageAspectRatio';

export const DEFAULT_SPLICE_PREVIEW_ASPECT_ID = '16-9';

export function resolveSplicePreviewAspectGroup(aspectId?: string | null): CollageAspectGroup {
  return (
    COLLAGE_ASPECT_GROUPS.find((g) => g.id === aspectId) ??
    COLLAGE_ASPECT_GROUPS.find((g) => g.id === DEFAULT_SPLICE_PREVIEW_ASPECT_ID) ??
    COLLAGE_ASPECT_GROUPS[0]
  );
}

/** 解析剪辑预览/导出的像素分辨率（优先 persisted exportOutput*） */
export function resolveSpliceExportDimensions(data?: {
  previewAspectId?: string | null;
  exportOutputWidth?: number | null;
  exportOutputHeight?: number | null;
} | null): { aspectId: string; width: number; height: number; aspectRatio: string } {
  const aspectGroup = resolveSplicePreviewAspectGroup(data?.previewAspectId);
  const [defaultW, defaultH] = resolveCollage1080pDefaultSize(aspectGroup);
  const width = Math.max(2, Math.round(Number(data?.exportOutputWidth) || defaultW));
  const height = Math.max(2, Math.round(Number(data?.exportOutputHeight) || defaultH));
  return {
    aspectId: aspectGroup.id,
    width,
    height,
    aspectRatio: `${aspectGroup.rw}:${aspectGroup.rh}`,
  };
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

  const selectedGroup = useMemo(
    () => resolveSplicePreviewAspectGroup(selectedAspectId),
    [selectedAspectId],
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc, true);
    return () => document.removeEventListener('mousedown', onDoc, true);
  }, [open]);

  const onPickAspect = useCallback(
    (g: CollageAspectGroup) => {
      onSelect(g.id);
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

  return (
    <div ref={rootRef} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        title={vs.pickAspectRatioTitle}
        aria-expanded={open ? 'true' : 'false'}
        aria-label={`${vs.aspectRatioLabel}: ${selectedGroup.label}`}
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
        <RatioGlyph w={selectedGroup.rw} h={selectedGroup.rh} />
        <span className={`font-medium leading-none ${md ? 'text-xs' : 'text-[10px]'}`}>{selectedGroup.label}</span>
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
          <div className="grid grid-cols-3 gap-1.5 max-h-[220px] overflow-y-auto pr-0.5">
            {COLLAGE_ASPECT_GROUPS.map((g) => {
              const active = selectedAspectId === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPickAspect(g);
                  }}
                  className={`flex flex-col items-center justify-center gap-1 rounded-lg border px-1 py-2 transition-colors ${
                    active
                      ? 'border-violet-500/60 bg-violet-500/15 ring-1 ring-violet-400/30'
                      : isDarkMode
                        ? 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20'
                        : 'border-gray-200 bg-gray-50 hover:bg-gray-100 hover:border-gray-300'
                  }`}
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
