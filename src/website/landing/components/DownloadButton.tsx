import { useSiteLocale } from '../lib/siteLocale';
import { setPreferredDownloadRegion, type ReleaseDownloadRegion } from '../lib/installerDownload';
import { useDualInstallerDownload } from '../hooks/useInstallerDownload';
import { Button } from './Button';

type Props = {
  className?: string;
};

/**
 * 官网下载入口：北京 / 香港两条直链并列，用户按网速自选。
 * 文件为玻璃拟态本机安装器 Aixflow-Installer-*.exe；若该线路没有则该按钮不可用。
 */
export function DownloadButton({ className = '' }: Props) {
  const { t } = useSiteLocale();
  const { beijingUrl, hongKongUrl, loading, platform } = useDualInstallerDownload();
  const fileHint = platform === 'mac' ? t.downloadTitleMac : t.downloadTitleWin;

  return (
    <div className={`flex flex-col items-start gap-2 ${className}`.trim()}>
      <p className="text-xs text-zinc-400">{t.downloadRouteHint}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap" role="group" aria-label={t.downloadRouteAria}>
        <RouteLink
          loading={loading}
          url={beijingUrl}
          region="cn"
          label={t.downloadBeijing}
          unavailable={t.installerUnavailable}
          title={`Aixflow ${fileHint} · ${t.downloadRouteBeijing}`}
        />
        <RouteLink
          loading={loading}
          url={hongKongUrl}
          region="hk"
          label={t.downloadHongKong}
          unavailable={t.installerUnavailable}
          title={`Aixflow ${fileHint} · ${t.downloadRouteHongKong}`}
        />
      </div>
    </div>
  );
}

function RouteLink({
  loading,
  url,
  region,
  label,
  unavailable,
  title,
}: {
  loading: boolean;
  url: string;
  region: ReleaseDownloadRegion;
  label: string;
  unavailable: string;
  title: string;
}) {
  if (loading) {
    return (
      <span
        className="inline-flex cursor-wait items-center justify-center rounded-full bg-[#051A24]/70 px-7 py-3 text-sm font-medium text-white/80"
        aria-busy="true"
      >
        {label}
      </span>
    );
  }
  if (!url) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-full bg-zinc-700/80 px-7 py-3 text-sm font-medium text-zinc-300"
        aria-disabled="true"
        title={unavailable}
      >
        {label}
      </span>
    );
  }
  return (
    <Button
      href={url}
      title={title}
      rel="noopener noreferrer"
      download
      onClick={() => setPreferredDownloadRegion(region)}
    >
      {label}
    </Button>
  );
}
