import React from 'react';
import { Download, RefreshCw } from 'lucide-react';
import type { useAppUpdate } from '../hooks/useAppUpdate';
import InstallerDownloadWizard from './InstallerDownloadWizard';

type AppUpdateState = ReturnType<typeof useAppUpdate>;

type AppUpdatePanelProps = {
  update: AppUpdateState;
  /** compact：登录页/激活页；account：已登录账户区（布局相同，保留兼容） */
  variant?: 'compact' | 'account';
  align?: 'left' | 'right';
  /** 主行末尾附加控件（如「交流群」），与更新按钮同一行 */
  trailing?: React.ReactNode;
};

function withVersion(label: string, version?: string | null): string {
  const v = version?.trim();
  return v ? `${v} ${label}` : label;
}

export default function AppUpdatePanel({ update, align = 'right', trailing }: AppUpdatePanelProps) {
  const {
    t,
    supportsUpdate,
    appVersion,
    updateChecking,
    updateAvailable,
    updateDownloading,
    updateInstalling,
    updateDownloadError,
    lastCheckResult,
    handleCheckUpdate,
    handleInstallUpdate,
  } = update;

  /** 与「交流群」入口同高同字号 */
  const footerCtrlBtnClass =
    'nexflow-btn-secondary h-[26px] w-fit shrink-0 !gap-1.5 !px-2.5 !py-0 !text-xs !leading-none';
  const footerCtrlBtnReadyClass =
    'inline-flex h-[26px] w-fit shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0 text-xs leading-none text-emerald-300 disabled:opacity-50';

  // 无更新能力时仍可渲染 trailing（如登录页「交流群」），避免入口被整块吞掉
  if (!supportsUpdate) {
    if (!trailing) return null;
    return (
      <div className={`flex flex-nowrap items-center gap-1.5 sm:gap-2 ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
        {trailing}
      </div>
    );
  }

  const busy = updateChecking || updateDownloading || updateInstalling;
  const canInstall = Boolean(updateAvailable) && !busy;

  let buttonLabel = withVersion(t.checkUpdate, appVersion);
  let buttonTitle: string | undefined = appVersion ? `${t.currentVersion} v${appVersion}` : undefined;
  if (updateChecking) {
    buttonLabel = withVersion(t.checkingUpdate, appVersion);
  } else if (updateInstalling) {
    buttonLabel = t.installingShort;
    buttonTitle = t.installingUpdate;
  } else if (updateDownloading) {
    buttonLabel = t.downloading;
  } else if (updateAvailable) {
    buttonLabel = withVersion(t.updateReadyBtn, updateAvailable);
    buttonTitle = t.newVersionAvailable(updateAvailable);
  } else if (updateDownloadError) {
    buttonLabel = withVersion(t.checkFailedShort, appVersion);
    buttonTitle = updateDownloadError;
  } else if (lastCheckResult?.error) {
    buttonLabel = withVersion(t.checkFailedShort, appVersion);
    buttonTitle = lastCheckResult.errorMessage
      ? `${t.checkFailedPrefix} ${lastCheckResult.errorMessage}`
      : t.checkFailedGeneric;
  } else if (lastCheckResult?.isLatest) {
    buttonLabel = withVersion(t.alreadyLatest, appVersion);
  }

  const onPrimaryClick = () => {
    if (canInstall) {
      void handleInstallUpdate();
      return;
    }
    void handleCheckUpdate();
  };

  const PrimaryIcon = canInstall ? Download : RefreshCw;

  /** 单行：更新按钮（文案含版本/状态）+ 可选 trailing（交流群） */
  return (
    <>
      <InstallerDownloadWizard update={update} />
      <div
        className={`flex min-w-0 flex-nowrap items-center gap-1.5 sm:gap-2 ${
          align === 'right' ? 'justify-end' : 'justify-start'
        }`}
      >
        <button
          type="button"
          onClick={onPrimaryClick}
          disabled={busy}
          title={buttonTitle}
          className={canInstall ? footerCtrlBtnReadyClass : footerCtrlBtnClass}
        >
          <PrimaryIcon className={`h-3.5 w-3.5 shrink-0 ${updateChecking ? 'animate-spin' : ''}`} />
          <span className="max-w-[12.5rem] truncate whitespace-nowrap">{buttonLabel}</span>
        </button>
        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </div>
    </>
  );
}
