// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { photoCollageCanvasPixelTitle, photoCollageT } from '../../i18n/photoCollageI18n';
import {
  COLLAGE_ASPECT_GROUPS,
  findCollageAspectGroupId,
  RatioGlyph,
  resolveCollage1080pDefaultSize,
  type CollageAspectGroup,
} from './photoCollageAspectRatio';

export interface PhotoCollageAspectRatioDropdownProps {
  cw: number;
  ch: number;
  isDarkMode?: boolean;
  onApplySize: (w: number, h: number) => void;
  /** 下拉面板展开方向，拼图工具栏默认向下 */
  placement?: 'up' | 'down';
  className?: string;
  /** 仅选比例（隐藏画布尺寸区与触发器上的像素尺寸） */
  ratioOnly?: boolean;
  /** 仅展示这些比例 id（如宫格：16-9 / 9-16 / 4-3 / 3-4 / 1-1） */
  allowedAspectIds?: string[];
}

export const PhotoCollageAspectRatioDropdown: React.FC<PhotoCollageAspectRatioDropdownProps> = ({
  cw,
  ch,
  isDarkMode = true,
  onApplySize,
  placement = 'down',
  className = '',
  ratioOnly = false,
  allowedAspectIds,
}) => {
  const { locale } = useAppLocale();
  const ct = photoCollageT(locale);
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const aspectGroups = useMemo(() => {
    if (!allowedAspectIds?.length) return COLLAGE_ASPECT_GROUPS;
    const byId = new Map(COLLAGE_ASPECT_GROUPS.map((g) => [g.id, g]));
    const filtered = allowedAspectIds
      .map((id) => byId.get(id))
      .filter(Boolean) as CollageAspectGroup[];
    return filtered.length > 0 ? filtered : COLLAGE_ASPECT_GROUPS;
  }, [allowedAspectIds]);

  const resolveAspectId = useCallback(
    (w: number, h: number) => {
      const id = findCollageAspectGroupId(w, h);
      if (!allowedAspectIds?.length) return id;
      if (aspectGroups.some((g) => g.id === id)) return id;
      // 不在白名单时，就近映射到允许的比例
      const r = w / Math.max(h, 1);
      let bestId = aspectGroups[0]?.id || id;
      let bestDiff = Infinity;
      for (const g of aspectGroups) {
        const d = Math.abs(r - g.rw / Math.max(g.rh, 1));
        if (d < bestDiff) {
          bestDiff = d;
          bestId = g.id;
        }
      }
      return bestId;
    },
    [allowedAspectIds, aspectGroups],
  );

  const [selectedAspectId, setSelectedAspectId] = useState(() => resolveAspectId(cw, ch));

  useEffect(() => {
    setSelectedAspectId(resolveAspectId(cw, ch));
  }, [cw, ch, resolveAspectId]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc, true);
    return () => document.removeEventListener('mousedown', onDoc, true);
  }, [open]);

  const selectedGroup = useMemo(() => {
    if (selectedAspectId === '__custom__') return null;
    return aspectGroups.find((g) => g.id === selectedAspectId)
      ?? COLLAGE_ASPECT_GROUPS.find((g) => g.id === selectedAspectId)
      ?? null;
  }, [aspectGroups, selectedAspectId]);

  const triggerLabel = useMemo(() => {
    if (selectedGroup) return selectedGroup.label;
    return ct.custom;
  }, [selectedGroup, ct.custom]);

  const [customWText, setCustomWText] = useState(String(cw));
  const [customHText, setCustomHText] = useState(String(ch));

  useEffect(() => {
    if (!open) {
      setCustomWText(String(cw));
      setCustomHText(String(ch));
    }
  }, [cw, ch, open]);

  const applyCustomSize = useCallback(() => {
    const w = parseInt(customWText.trim(), 10);
    const h = parseInt(customHText.trim(), 10);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    onApplySize(w, h);
    setSelectedAspectId(resolveAspectId(w, h));
  }, [customWText, customHText, onApplySize, resolveAspectId]);

  const onPickAspect = useCallback(
    (g: CollageAspectGroup) => {
      setSelectedAspectId(g.id);
      const [w, h] = resolveCollage1080pDefaultSize(g);
      onApplySize(w, h);
      if (ratioOnly) setOpen(false);
    },
    [onApplySize, ratioOnly],
  );

  const onPickCanvasSize = useCallback(
    (w: number, h: number, aspectId: string) => {
      setSelectedAspectId(aspectId);
      onApplySize(w, h);
    },
    [onApplySize],
  );

  const panelPos =
    placement === 'up'
      ? 'bottom-full left-0 mb-1.5'
      : 'top-full left-0 mt-1.5';

  const panelSkin = isDarkMode
    ? 'border-white/12 bg-zinc-900/95 text-white shadow-xl shadow-black/40'
    : 'border-gray-200 bg-white text-gray-900 shadow-xl';

  const triggerSkin = isDarkMode
    ? 'bg-white/15 text-white/85 hover:bg-white/22 border border-white/10'
    : 'bg-black/10 text-gray-800 hover:bg-black/15 border border-black/10';

  return (
    <div ref={rootRef} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        title={ct.pickRatioTitle}
        aria-expanded={open ? 'true' : 'false'}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className={`nodrag nopan inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors ${triggerSkin}`}
      >
        <span className={isDarkMode ? 'text-white/55' : 'text-gray-500'}>{ct.ratioLabel}</span>
        {selectedGroup ? <RatioGlyph w={selectedGroup.rw} h={selectedGroup.rh} /> : null}
        <span>{triggerLabel}</span>
        {!ratioOnly ? (
          <span className={`text-[10px] ${isDarkMode ? 'text-white/35' : 'text-gray-400'}`}>
            {cw}×{ch}
          </span>
        ) : null}
        <ChevronDown className={`w-3 h-3 shrink-0 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open ? (
        <div
          className={`nodrag nopan absolute ${panelPos} z-[80] rounded-xl border p-2 ${
            aspectGroups.length <= 5 ? 'w-36' : 'w-[15.5rem]'
          } ${panelSkin}`}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          <div
            className={`grid gap-1.5 ${
              aspectGroups.length <= 5 ? 'grid-cols-1' : 'grid-cols-3'
            }`}
          >
            {aspectGroups.map((g) => {
              const active = selectedAspectId === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPickAspect(g);
                  }}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors ${
                    aspectGroups.length <= 5 ? 'justify-start' : 'flex-col justify-center gap-1 px-1'
                  } ${
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

          {!ratioOnly ? (
          <div
            className={`mt-2 rounded-lg border px-2 py-2 ${
              isDarkMode ? 'border-white/[0.08] bg-black/25' : 'border-gray-200 bg-gray-50'
            }`}
          >
            <div className={`mb-1.5 text-[10px] font-medium ${isDarkMode ? 'text-white/55' : 'text-gray-600'}`}>
              {ct.canvasSize}
            </div>
            {selectedGroup ? (
              <div className="flex max-h-[120px] flex-wrap gap-1.5 overflow-y-auto pr-0.5">
                {selectedGroup.resolutions.map(([w, h]) => {
                  const on = cw === w && ch === h;
                  return (
                    <button
                      key={`${selectedGroup.id}-${w}-${h}`}
                      type="button"
                      title={photoCollageCanvasPixelTitle(locale, w, h)}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPickCanvasSize(w, h, selectedGroup.id);
                      }}
                      className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${
                        on
                          ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-100'
                          : isDarkMode
                            ? 'border-white/10 bg-white/[0.05] text-white/75 hover:border-violet-400/35 hover:bg-violet-500/15'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-violet-300 hover:bg-violet-50'
                      }`}
                    >
                      {w}×{h}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <p className={`py-0.5 text-[10px] leading-relaxed ${isDarkMode ? 'text-white/40' : 'text-gray-500'}`}>
                  {ct.customSizeHint}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <input
                    type="number"
                    title={ct.canvasWidth}
                    aria-label={ct.canvasWidth}
                    className={`nodrag nopan w-[4.5rem] rounded-md border px-2 py-1 text-[10px] outline-none ${
                      isDarkMode
                        ? 'border-white/15 bg-zinc-900/90 text-white'
                        : 'border-gray-300 bg-white text-gray-900'
                    }`}
                    value={customWText}
                    onChange={(e) => setCustomWText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applyCustomSize();
                    }}
                  />
                  <span className={`text-[10px] ${isDarkMode ? 'text-white/35' : 'text-gray-400'}`}>×</span>
                  <input
                    type="number"
                    title={ct.canvasHeight}
                    aria-label={ct.canvasHeight}
                    className={`nodrag nopan w-[4.5rem] rounded-md border px-2 py-1 text-[10px] outline-none ${
                      isDarkMode
                        ? 'border-white/15 bg-zinc-900/90 text-white'
                        : 'border-gray-300 bg-white text-gray-900'
                    }`}
                    value={customHText}
                    onChange={(e) => setCustomHText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applyCustomSize();
                    }}
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      applyCustomSize();
                    }}
                    className={`rounded-md px-2 py-1 text-[10px] font-medium ${
                      isDarkMode
                        ? 'bg-violet-500/25 text-violet-100 hover:bg-violet-500/35'
                        : 'bg-violet-100 text-violet-900 hover:bg-violet-200'
                    }`}
                  >
                    {ct.apply}
                  </button>
                </div>
              </div>
            )}
          </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
