import React from 'react';
import { Download, RefreshCw } from 'lucide-react';
import type { useAppUpdate } from '../hooks/useAppUpdate';
import InstallerDownloadWizard from './InstallerDownloadWizard';

type AppUpdateState = ReturnType<typeof useAppUpdate>;

type AppUpdatePanelProps = {
  update: AppUpdateState;
  /** compact：登录页/激活页；account：已登录账户区 */
  variant?: 'compact' | 'account';
  align?: 'left' | 'right';
  /** 紧跟「检查更新」按钮右侧的附加控件（如 FC 线路切换） */
  trailing?: React.ReactNode;
};

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

  const alignClass = align === 'right' ? 'items-end text-right' : 'items-start text-left';
  const overallPercent = Math.min(100, Number.isFinite(downloadProgress?.percent) ? downloadProgress!.percent : 0);
  const speed = Number.isFinite(downloadProgress?.bytesPerSecond) ? downloadProgress!.bytesPerSecond : 0;

  // 无更新能力时仍可渲染 trailing（如登录页「交流群」），避免入口被整块吞掉
  if (!supportsUpdate) {
    if (!trailing) return null;
    return (
      <div className={`flex flex-wrap gap-2 sm:gap-3 ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
        {trailing}
      </div>
    );
  }

  const renderDownloadProgress = () => {
    // 完整下载 UI 由 InstallerDownloadWizard 覆盖层承担；此处仅保留简短状态行
    if (!updateDownloading) return null;
    return (
      <p className={`text-[11px] text-white/45 ${align === 'right' ? 'text-right' : ''}`}>
        {downloadProgress && downloadProgress.total > 0
          ? `${formatBytes(downloadProgress.transferred)} / ${formatBytes(downloadProgress.total)} (${overallPercent.toFixed(1)}%)${speed > 1024 ? ` · ${formatBytes(speed)}/s` : ''}`
          : t.preparingDownload}
      </p>
    );
  };

  const wizard = <InstallerDownloadWizard update={update} />;

  if (variant === 'account') {
    return (
      <>
        {wizard}
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
      </>
    );
  }

  return (
    <>
      {wizard}
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
    </>
  );
}
