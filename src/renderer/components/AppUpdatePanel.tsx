import React from 'react';
import { Download, RefreshCw } from 'lucide-react';
import type { useAppUpdate } from '../hooks/useAppUpdate';

type AppUpdateState = ReturnType<typeof useAppUpdate>;

type AppUpdatePanelProps = {
  update: AppUpdateState;
  /** compact：登录页/激活页；account：已登录账户区 */
  variant?: 'compact' | 'account';
  align?: 'left' | 'right';
  /** 紧跟「检查更新」按钮右侧的附加控件（如 FC 线路切换） */
  trailing?: React.ReactNode;
};

function PhaseProgressBar({
  label,
  percent,
  className,
}: {
  label: string;
  percent: number;
  className?: string;
}) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className={className}>
      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-white/45">
        <span className="truncate">{label}</span>
        <span className="shrink-0 tabular-nums">{clamped.toFixed(0)}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full bg-emerald-500/80 transition-all duration-300"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

export default function AppUpdatePanel({ update, variant = 'compact', align = 'right', trailing }: AppUpdatePanelProps) {
  const {
    t,
    supportsUpdate,
    appVersion,
    updateChecking,
    updateAvailable,
    updateDownloading,
    updateInstalling,
    updateDownloadError,
    downloadProgress,
    lastCheckResult,
    handleCheckUpdate,
    handleInstallUpdate,
    formatBytes,
  } = update;

  if (!supportsUpdate) return null;

  const alignClass = align === 'right' ? 'items-end text-right' : 'items-start text-left';
  const stubBytes = downloadProgress?.stubBytes ?? 0;
  const packageBytes = downloadProgress?.packageBytes ?? 0;
  const isNsisWeb = packageBytes > 0;
  const overallPercent = Math.min(100, downloadProgress?.percent ?? 0);
  const stubPercent =
    downloadProgress?.stubPercent ??
    (isNsisWeb && stubBytes > 0
      ? Math.min(100, ((Math.min(downloadProgress?.transferred ?? 0, stubBytes)) / stubBytes) * 100)
      : overallPercent);
  const packagePercent =
    downloadProgress?.packagePercent ??
    (isNsisWeb && packageBytes > 0
      ? Math.min(100, (Math.max(0, (downloadProgress?.transferred ?? 0) - stubBytes) / packageBytes) * 100)
      : 0);
  const speed = downloadProgress?.bytesPerSecond ?? 0;

  const renderDownloadProgress = () => {
    if (!updateDownloading) return null;
    return (
      <div className={`w-full min-w-[220px] space-y-2 ${align === 'right' ? 'text-right' : ''}`}>
        {isNsisWeb ? (
          <>
            <PhaseProgressBar label={t.downloadStubLabel} percent={stubPercent} />
            <PhaseProgressBar label={t.downloadPackageLabel} percent={packagePercent} />
          </>
        ) : (
          <PhaseProgressBar label={t.downloading} percent={overallPercent} />
        )}
        <p className="text-[11px] text-white/45">
          {downloadProgress && downloadProgress.total > 0
            ? `${formatBytes(downloadProgress.transferred)} / ${formatBytes(downloadProgress.total)} (${overallPercent.toFixed(1)}%)${speed > 1024 ? ` · ${formatBytes(speed)}/s` : ''}`
            : t.preparingDownload}
        </p>
      </div>
    );
  };

  if (variant === 'account') {
    return (
      <div className="space-y-3">
        <div className="space-y-2">
          <p className="text-xs text-white/45">{t.appUpdate}</p>
          <div className="flex flex-wrap items-center gap-2">
            {appVersion ? (
              <span className="text-xs text-white/40">
                {t.currentVersion} v{appVersion}
              </span>
            ) : null}
            <button
              type="button"
              onClick={handleCheckUpdate}
              disabled={updateChecking || updateDownloading || updateInstalling}
              className="nexflow-btn-secondary nexflow-btn-secondary-sm"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${updateChecking ? 'animate-spin' : ''}`} />
              {updateChecking ? t.checkingUpdate : t.checkUpdate}
            </button>
            {lastCheckResult?.isLatest && !updateChecking && !updateAvailable ? (
              <span className="text-xs text-white/45">{t.alreadyLatest}</span>
            ) : null}
            {lastCheckResult?.error && !updateChecking ? (
              <span className="text-xs text-amber-400/80" title={lastCheckResult?.errorMessage ?? undefined}>
                {lastCheckResult?.errorMessage
                  ? `${t.checkFailedPrefix} ${lastCheckResult.errorMessage}`
                  : t.checkFailedGeneric}
              </span>
            ) : null}
          </div>
          {updateAvailable ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-emerald-400/95">{t.newVersionAvailable(updateAvailable)}</span>
              <button
                type="button"
                onClick={handleInstallUpdate}
                disabled={updateDownloading || updateInstalling}
                className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3 py-2 text-xs text-emerald-300 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                {updateInstalling ? t.installingUpdate : updateDownloading ? t.downloading : t.downloadInstall(updateAvailable)}
              </button>
              {updateInstalling ? (
                <span className="text-xs text-white/55">{t.installingUpdate}</span>
              ) : null}
              {updateDownloadError ? (
                <span className="text-xs text-amber-400/90">{updateDownloadError}</span>
              ) : null}
              {renderDownloadProgress()}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-2 ${alignClass}`}>
      <div className={`flex flex-wrap gap-2 sm:gap-3 ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
        {appVersion ? (
          <span className="text-xs text-white/40">
            {t.currentVersion} v{appVersion}
          </span>
        ) : null}
        <button
          type="button"
          onClick={handleCheckUpdate}
          disabled={updateChecking || updateDownloading || updateInstalling}
          className="nexflow-btn-secondary nexflow-btn-secondary-sm"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${updateChecking ? 'animate-spin' : ''}`} />
          {updateChecking ? t.checkingUpdate : t.checkUpdate}
        </button>
        {trailing}
        {lastCheckResult?.isLatest && !updateChecking && !updateAvailable ? (
          <span className="text-xs text-white/45">{t.alreadyLatest}</span>
        ) : null}
        {lastCheckResult?.error && !updateChecking ? (
          <span className="text-xs text-amber-400/80" title={lastCheckResult?.errorMessage ?? undefined}>
            {lastCheckResult?.errorMessage
              ? `${t.checkFailedPrefix} ${lastCheckResult.errorMessage}`
              : t.checkFailedGeneric}
          </span>
        ) : null}
      </div>
      {updateAvailable && !updateChecking ? (
        <div className={`flex flex-col gap-2 ${alignClass}`}>
          <span className="text-xs font-medium text-emerald-400/95">{t.newVersionAvailable(updateAvailable)}</span>
          <button
            type="button"
            onClick={handleInstallUpdate}
            disabled={updateDownloading || updateInstalling}
            className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3 py-2 text-xs text-emerald-300 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {updateInstalling ? t.installingUpdate : updateDownloading ? t.downloading : t.downloadInstall(updateAvailable)}
          </button>
          {updateInstalling ? (
            <span className="text-xs text-white/55">{t.installingUpdate}</span>
          ) : null}
          {updateDownloadError ? (
            <span className="text-xs text-amber-400/90">{updateDownloadError}</span>
          ) : null}
          {renderDownloadProgress()}
        </div>
      ) : null}
    </div>
  );
}
