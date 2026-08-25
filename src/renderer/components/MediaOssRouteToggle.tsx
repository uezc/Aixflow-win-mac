import React, { useCallback, useEffect, useState } from 'react';
import { useAppLocale } from '../contexts/AppLocaleContext';
import { settingsT } from '../i18n/settingsI18n';

type MediaOssRouteToggleProps = {
  isDarkMode?: boolean;
  disabled?: boolean;
  /** 窄顶栏：用短文案，减小占位 */
  compact?: boolean;
};

export default function MediaOssRouteToggle({
  isDarkMode = true,
  disabled = false,
  compact = false,
}: MediaOssRouteToggleProps) {
  const { locale } = useAppLocale();
  const t = settingsT(locale);
  const [region, setRegion] = useState<'cn' | 'hk'>('cn');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.electronAPI?.nxMediaOssGetRegion?.();
        if (!cancelled && (res?.region === 'cn' || res?.region === 'hk')) {
          setRegion(res.region);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = useCallback(async (next: 'cn' | 'hk') => {
    if (busy || disabled || region === next) return;
    const api = window.electronAPI?.nxMediaOssSetRegion;
    if (!api) return;
    setBusy(true);
    try {
      const res = await api(next);
      setRegion(res?.region === 'hk' ? 'hk' : 'cn');
    } catch (e) {
      console.error('[MediaOssRouteToggle] 切换失败:', e);
    } finally {
      setBusy(false);
    }
  }, [busy, disabled, region]);

  const shellClass = isDarkMode
    ? 'border-white/25 bg-white/[0.10]'
    : 'border-gray-400/80 bg-gray-200/90 shadow-sm';

  const idleClass = isDarkMode
    ? 'text-white/55 hover:bg-white/10 hover:text-white/90'
    : 'text-gray-700 hover:bg-gray-300/60 hover:text-gray-900';

  const activeClass = isDarkMode
    ? 'bg-sky-600/70 text-white shadow-sm'
    : 'bg-sky-600 text-white shadow-sm';

  return (
    <div
      className={`flex shrink-0 items-center gap-0.5 rounded-full border p-0.5 nodrag nopan ${shellClass}`}
      role="group"
      aria-label={t.regionRouteTitle}
      title={t.regionRouteTitle}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        disabled={disabled || busy}
        onClick={(e) => {
          e.stopPropagation();
          void handleSelect('cn');
        }}
        className={`rounded-full whitespace-nowrap ${compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'} font-medium transition-colors disabled:cursor-wait disabled:opacity-45 ${
          region === 'cn' ? activeClass : idleClass
        }`}
      >
        {region === 'cn' ? '●' : '○'}{' '}
        {compact ? t.regionRouteChinaOptimizedShort : t.regionRouteChinaOptimized}
      </button>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={(e) => {
          e.stopPropagation();
          void handleSelect('hk');
        }}
        className={`rounded-full whitespace-nowrap ${compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'} font-medium transition-colors disabled:cursor-wait disabled:opacity-45 ${
          region === 'hk' ? activeClass : idleClass
        }`}
      >
        {region === 'hk' ? '●' : '○'}{' '}
        {compact ? t.regionRouteGlobalShort : t.regionRouteGlobal}
      </button>
    </div>
  );
}
