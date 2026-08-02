import { useInstallerDownload } from '../hooks/useInstallerDownload';
import { useSiteLocale } from '../lib/siteLocale';
import { Button } from './Button';
import type { MouseEvent } from 'react';

type Props = {
  className?: string;
};

export function DownloadButton({ className = '' }: Props) {
  const { t } = useSiteLocale();
  const { primaryUrl, loading, platform } = useInstallerDownload();
  const label = t.startUsing;
  const loadingLabel = t.preparingDownload;
  const unavailableLabel = t.installerUnavailable;

  if (loading) {
    return (
      <span
        className={`inline-flex cursor-wait items-center justify-center rounded-full bg-[#051A24]/70 px-7 py-3 text-sm font-medium text-white/80 ${className}`.trim()}
        aria-busy="true"
      >
        {loadingLabel}
      </span>
    );
  }

  if (!primaryUrl) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-full bg-zinc-700/80 px-7 py-3 text-sm font-medium text-zinc-300 ${className}`.trim()}
        aria-disabled="true"
      >
        {unavailableLabel}
      </span>
    );
  }

  const fileHint = platform === 'mac' ? t.downloadTitleMac : t.downloadTitleWin;

  const handleDownloadClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    window.location.href = primaryUrl;
  };

  return (
    <Button
      href={primaryUrl}
      className={className}
      title={`Aixflow ${fileHint}`}
      rel="noopener noreferrer"
      onClick={handleDownloadClick}
    >
      {label}
    </Button>
  );
}
