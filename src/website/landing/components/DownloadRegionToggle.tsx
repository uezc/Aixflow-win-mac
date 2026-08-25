import { useEffect, useState } from 'react';
import {
  getPreferredDownloadRegion,
  setPreferredDownloadRegion,
  subscribeDownloadRegion,
  type ReleaseDownloadRegion,
} from '../lib/installerDownload';
import { useSiteLocale } from '../lib/siteLocale';

type Props = {
  className?: string;
  compact?: boolean;
  disabled?: boolean;
};

export function DownloadRegionToggle({ className = '', compact = false, disabled = false }: Props) {
  const { t } = useSiteLocale();
  const [region, setRegion] = useState<ReleaseDownloadRegion>(() => getPreferredDownloadRegion());

  useEffect(() => subscribeDownloadRegion(setRegion), []);

  const pick = (next: ReleaseDownloadRegion) => {
    if (disabled || region === next) return;
    setPreferredDownloadRegion(next);
    setRegion(next);
  };

  return (
    <div
      className={`inline-flex items-center rounded-full border border-white/15 bg-white/5 p-0.5 ${className}`.trim()}
      role="group"
      aria-label={t.downloadRouteAria}
      title={t.downloadRouteAria}
    >
      <button
        type="button"
        disabled={disabled}
        aria-pressed={region === 'cn'}
        onClick={() => pick('cn')}
        className={`rounded-full font-medium transition disabled:opacity-50 ${
          compact ? 'px-2 py-1 text-[11px] md:text-xs' : 'px-2.5 py-1 text-xs'
        } ${region === 'cn' ? 'bg-white text-zinc-900' : 'text-zinc-400 hover:text-white'}`}
      >
        {t.downloadRouteBeijing}
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={region === 'hk'}
        onClick={() => pick('hk')}
        className={`rounded-full font-medium transition disabled:opacity-50 ${
          compact ? 'px-2 py-1 text-[11px] md:text-xs' : 'px-2.5 py-1 text-xs'
        } ${region === 'hk' ? 'bg-white text-zinc-900' : 'text-zinc-400 hover:text-white'}`}
      >
        {t.downloadRouteHongKong}
      </button>
    </div>
  );
}
