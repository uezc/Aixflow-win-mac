import React, { useMemo } from 'react';
import { Check, Loader2, RefreshCw, X } from 'lucide-react';
import { useAppLocale } from '../../contexts/AppLocaleContext';

export type SmartEditReviewSegment = {
  startSec: number;
  endSec: number;
  score: number;
  posterUrl?: string;
};

type Props = {
  isDarkMode: boolean;
  analyzing: boolean;
  analyzeProgress: number;
  exporting: boolean;
  exportProgress: number;
  durationSec: number;
  segments: SmartEditReviewSegment[];
  selectedIndexes: Set<number>;
  activeIndex: number;
  onToggleSelect: (index: number) => void;
  onSelectActive: (index: number) => void;
  onCancel: () => void;
  onRetry: () => void;
  onConfirm: () => void;
};

function formatSec(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0.0s';
  return `${s.toFixed(1)}s`;
}

/** 胶片条：分析进度 + 镜头块（与画布模块一一对应，确认后导出） */
export const SmartVideoEditReviewBar: React.FC<Props> = ({
  isDarkMode,
  analyzing,
  analyzeProgress,
  exporting,
  exportProgress,
  durationSec,
  segments,
  selectedIndexes,
  activeIndex,
  onToggleSelect,
  onSelectActive,
  onCancel,
  onRetry,
  onConfirm,
}) => {
  const { locale } = useAppLocale();
  const busy = analyzing || exporting;
  const selectedCount = selectedIndexes.size;

  const statusText = useMemo(() => {
    if (exporting) {
      return locale === 'en'
        ? `Exporting to canvas (${Math.round(exportProgress)}%)`
        : `导出到画布 (${Math.round(exportProgress)}%)`;
    }
    if (analyzing) {
      return locale === 'en'
        ? `Analyzing (${Math.round(analyzeProgress)}%)`
        : `分析中 (${Math.round(analyzeProgress)}%)`;
    }
    return locale === 'en'
      ? `${selectedCount} shot(s) → canvas modules`
      : `已选 ${selectedCount} 镜 → 对应画布模块`;
  }, [analyzing, analyzeProgress, exporting, exportProgress, locale, selectedCount]);

  return (
    <div
      className={`nodrag nopan mt-1.5 w-full rounded-xl border px-2 py-2 ${
        isDarkMode ? 'border-white/10 bg-black/55 text-white' : 'border-gray-200 bg-white/95 text-gray-900'
      }`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
        <span className={`flex items-center gap-1.5 ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>
          {(analyzing || exporting) && <Loader2 className="h-3 w-3 animate-spin text-violet-400" />}
          {statusText}
        </span>
        <span className={isDarkMode ? 'text-white/40' : 'text-gray-400'}>
          {locale === 'en' ? 'Obvious visual cuts only' : '仅画面变化明显镜头'}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
            isDarkMode
              ? 'border-white/15 bg-white/5 hover:bg-white/10 disabled:opacity-40'
              : 'border-gray-200 bg-gray-50 hover:bg-gray-100 disabled:opacity-40'
          }`}
          title={locale === 'en' ? 'Cancel' : '取消'}
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <div
          className={`relative flex min-h-[52px] flex-1 gap-2 overflow-x-auto rounded-lg px-1.5 py-1.5 ${
            isDarkMode ? 'bg-white/5' : 'bg-gray-100'
          }`}
        >
          {analyzing && segments.length === 0 ? (
            <div className="flex w-full items-center justify-center gap-2 text-[11px] opacity-70">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {locale === 'en' ? 'Detecting shots…' : '正在检测镜头…'}
            </div>
          ) : (
            segments.map((seg, i) => {
              const selected = selectedIndexes.has(i);
              const active = activeIndex === i;
              const w = durationSec > 0 ? Math.max(56, ((seg.endSec - seg.startSec) / durationSec) * 280) : 72;
              return (
                <button
                  key={`${seg.startSec}-${seg.endSec}-${i}`}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onSelectActive(i);
                    // 点选即纳入导出（与画布模块对应）；再点同一块可取消
                    if (active && selected) onToggleSelect(i);
                    else if (!selected) onToggleSelect(i);
                  }}
                  className={`relative shrink-0 overflow-hidden rounded-md border transition-all ${
                    selected
                      ? 'border-violet-400 ring-1 ring-violet-400/60'
                      : isDarkMode
                        ? 'border-white/10 opacity-55'
                        : 'border-gray-300 opacity-55'
                  } ${active ? 'scale-[1.02]' : ''}`}
                  style={{ width: w, height: 48 }}
                  title={`${formatSec(seg.startSec)} – ${formatSec(seg.endSec)} · score ${seg.score.toFixed(2)}`}
                >
                  {seg.posterUrl ? (
                    <img src={seg.posterUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    <div
                      className={`flex h-full w-full items-center justify-center text-[10px] ${
                        isDarkMode ? 'bg-violet-500/20' : 'bg-violet-100'
                      }`}
                    >
                      #{i + 1}
                    </div>
                  )}
                  <span className="absolute bottom-0 left-0 right-0 bg-black/55 px-1 py-0.5 text-center text-[9px] text-white">
                    {formatSec(seg.endSec - seg.startSec)}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={onRetry}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
            isDarkMode
              ? 'border-white/15 bg-white/5 hover:bg-white/10 disabled:opacity-40'
              : 'border-gray-200 bg-gray-50 hover:bg-gray-100 disabled:opacity-40'
          }`}
          title={locale === 'en' ? 'Re-analyze' : '重新分析'}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${analyzing ? 'animate-spin' : ''}`} />
        </button>

        <button
          type="button"
          disabled={busy || selectedCount === 0}
          onClick={onConfirm}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
          title={locale === 'en' ? 'Export selected shots to canvas' : '将选中镜头导出为画布模块'}
        >
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
};

export default SmartVideoEditReviewBar;
