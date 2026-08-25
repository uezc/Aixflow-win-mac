import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Package, CheckCircle2, Pause, Play, X, HelpCircle, RefreshCw } from 'lucide-react';
import type { useAppUpdate } from '../hooks/useAppUpdate';
import {
  installerWizardT,
  readInstallerLocale,
  writeInstallerLocale,
  type InstallerLocale,
} from '@/shared/installerWizardI18n';

type AppUpdateState = ReturnType<typeof useAppUpdate>;

type InstallerDownloadWizardProps = {
  update: AppUpdateState;
  /** 设计预览：用假进度，不依赖真实下载 */
  demo?: boolean;
  /** 由更新按钮打开；下载/安装中也会强制显示 */
  open?: boolean;
  onClose?: () => void;
};

type WizardStep = 'download' | 'install' | 'done';

const DEFAULT_INSTALL_DIR = 'C:\\Program Files\\Aixflow';

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function formatEta(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '--:--:--';
  const s = Math.floor(seconds);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function formatSpeed(bytesPerSecond: number, formatBytes: (n: number) => string): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 1) return '—';
  return `${formatBytes(bytesPerSecond)}/s`;
}

function LangToggle({
  locale,
  onChange,
  t,
}: {
  locale: InstallerLocale;
  onChange: (next: InstallerLocale) => void;
  t: ReturnType<typeof installerWizardT>;
}) {
  return (
    <div
      className="inline-flex items-center rounded-lg border border-white/10 bg-black/25 p-0.5 text-[11px]"
      role="group"
      aria-label={t.langToggleAria}
    >
      <button
        type="button"
        onClick={() => onChange('zh')}
        className={`rounded-md px-2 py-1 transition ${
          locale === 'zh'
            ? 'bg-[#00a3ff]/25 text-white'
            : 'text-white/45 hover:text-white/75'
        }`}
      >
        {t.langZh}
      </button>
      <button
        type="button"
        onClick={() => onChange('en')}
        className={`rounded-md px-2 py-1 transition ${
          locale === 'en'
            ? 'bg-[#00a3ff]/25 text-white'
            : 'text-white/45 hover:text-white/75'
        }`}
      >
        {t.langEn}
      </button>
    </div>
  );
}

function DownloadRouteToggle({
  region,
  onChange,
  disabled,
  t,
}: {
  region: 'cn' | 'hk';
  onChange: (next: 'cn' | 'hk') => void;
  disabled?: boolean;
  t: ReturnType<typeof installerWizardT>;
}) {
  return (
    <div
      className="inline-flex items-center rounded-lg border border-white/10 bg-black/25 p-0.5 text-[11px]"
      role="group"
      aria-label={t.downloadRouteAria}
      title={t.downloadRouteHint}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('cn')}
        className={`rounded-md px-2.5 py-1 transition disabled:opacity-40 ${
          region === 'cn' ? 'bg-[#00a3ff]/25 text-white' : 'text-white/45 hover:text-white/75'
        }`}
      >
        {t.downloadRouteBeijing}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('hk')}
        className={`rounded-md px-2.5 py-1 transition disabled:opacity-40 ${
          region === 'hk' ? 'bg-[#00a3ff]/25 text-white' : 'text-white/45 hover:text-white/75'
        }`}
      >
        {t.downloadRouteHongKong}
      </button>
    </div>
  );
}

/**
 * Aixflow 下载引导安装器 UI（暗黑霓虹风格）。
 * 覆盖应用内更新下载；修复后的进度来自主进程合并 stub + 主包。
 */
export default function InstallerDownloadWizard({
  update,
  demo = false,
  open = false,
  onClose,
}: InstallerDownloadWizardProps) {
  const {
    t: updateT,
    appVersion,
    updateAvailable,
    updateChecking,
    updateDownloading,
    updateInstalling,
    updateDownloadError,
    downloadProgress,
    downloadPaused,
    lastCheckResult,
    formatBytes,
    handleCheckUpdate,
    handleInstallUpdate,
    handlePauseDownload,
    handleResumeDownload,
    handleCancelDownload,
  } = update;

  const [locale, setLocale] = useState<InstallerLocale>(() => readInstallerLocale());
  const t = useMemo(() => installerWizardT(locale), [locale]);
  const [demoTick, setDemoTick] = useState(0.2);
  const [region, setRegion] = useState<'cn' | 'hk'>('cn');

  const setLocalePersist = (next: InstallerLocale) => {
    setLocale(next);
    writeInstallerLocale(next);
  };

  useEffect(() => {
    if (!demo) return;
    const id = window.setInterval(() => {
      setDemoTick((p) => (p >= 0.95 ? 0.08 : p + 0.01));
    }, 120);
    return () => window.clearInterval(id);
  }, [demo]);

  useEffect(() => {
    if (!open && !demo) return;
    void window.electronAPI?.getReleaseFeedRegion?.().then((res) => {
      if (res?.region === 'hk' || res?.region === 'cn') setRegion(res.region);
      else if (res?.active === 'hk' || res?.active === 'cn') setRegion(res.active);
    });
  }, [open, demo]);

  const changeRegion = useCallback(async (next: 'cn' | 'hk') => {
    setRegion(next);
    await window.electronAPI?.setReleaseFeedRegion?.(next);
  }, []);

  const downloading = demo || updateDownloading || updateInstalling;
  const visible = demo || open || updateDownloading || updateInstalling;

  const handleClose = useCallback(async () => {
    if (updateInstalling) return;
    if (updateDownloading) await handleCancelDownload();
    onClose?.();
  }, [updateInstalling, updateDownloading, handleCancelDownload, onClose]);
  const version = updateAvailable || appVersion || '1.0.0';
  const step: WizardStep = updateInstalling ? 'install' : 'download';

  const transferred = demo
    ? demoTick * 1.25 * 1024 * 1024 * 1024
    : downloadProgress?.transferred ?? 0;
  const total = demo ? 1.25 * 1024 * 1024 * 1024 : downloadProgress?.total ?? 0;
  const percent = demo
    ? clampPercent(demoTick * 100)
    : clampPercent(downloadProgress?.percent ?? (total > 0 ? (transferred / total) * 100 : 0));
  const speed = demo ? 12.4 * 1024 * 1024 : downloadProgress?.bytesPerSecond ?? 0;
  const etaSeconds = demo
    ? (total - transferred) / speed
    : downloadProgress?.etaSeconds ??
      (speed > 0 && total > transferred ? (total - transferred) / speed : null);
  const fileName =
    downloadProgress?.fileName || `Aixflow-Windows-Setup-${version}.exe`;
  const savePath =
    downloadProgress?.savePath ||
    (typeof navigator !== 'undefined' ? t.updateCacheDir : '');
  const paused = demo ? false : downloadPaused || downloadProgress?.paused;
  const barWidth = `${percent.toFixed(2)}%`;
  const phase = demo ? 'main-package' : downloadProgress?.phase;
  const downloadTitle = paused
    ? t.statusPaused
    : phase === 'stub'
      ? t.statusDownloadingStub
      : phase === 'main-package' || phase === 'full'
        ? t.statusDownloadingPackage
        : t.statusDownloading;
  const waitingSlow =
    !demo && !paused && !updateInstalling && speed <= 0 && percent > 0 && percent < 99.5;
  const statusRight = waitingSlow
    ? t.statusDownloadingWaiting
    : `${formatSpeed(speed, formatBytes)} | ${t.remaining} ${formatEta(etaSeconds)}`;

  const steps = useMemo(
    () =>
      [
        { id: 'download' as const, label: t.stepDownload, Icon: Download },
        { id: 'install' as const, label: t.stepInstall, Icon: Package },
        { id: 'done' as const, label: t.stepDone, Icon: CheckCircle2 },
      ] as const,
    [t],
  );

  if (!visible) return null;

  const body = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t.dialogAria}
      onClick={() => {
        if (!downloading) void handleClose();
      }}
    >
      <div
        className="relative flex h-[min(640px,92vh)] w-[min(920px,96vw)] overflow-hidden rounded-2xl border border-white/10 shadow-[0_0_60px_rgba(0,163,255,0.18)]"
        onClick={(e) => e.stopPropagation()}
        style={{
          background:
            'radial-gradient(1200px 600px at 70% -10%, rgba(0,140,255,0.16), transparent 55%), linear-gradient(160deg, #0b0e14 0%, #0a121c 45%, #070b10 100%)',
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(0,180,255,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(0,180,255,0.35) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(circle at 70% 20%, black 20%, transparent 70%)',
          }}
        />

        <div className="absolute right-3 top-3 z-20 flex items-center gap-2">
          <LangToggle locale={locale} onChange={setLocalePersist} t={t} />
          {!updateInstalling ? (
            <button
              type="button"
              onClick={() => void handleClose()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-black/25 text-white/50 transition hover:bg-white/10 hover:text-white"
              aria-label={t.close}
              title={t.close}
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <aside className="relative z-10 flex w-[200px] shrink-0 flex-col border-r border-cyan-500/15 bg-[#070a10]/85 px-4 py-5">
          <div className="mb-8 flex items-center gap-2 px-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-[#00a3ff] to-[#0050c8] text-sm font-bold text-white shadow-[0_0_16px_rgba(0,163,255,0.55)]">
              A
            </div>
            <span className="text-[15px] font-semibold tracking-wide text-white">Aixflow</span>
          </div>

          <nav className="flex flex-1 flex-col gap-2">
            {steps.map(({ id, label, Icon }) => {
              const active = step === id;
              const done = (step === 'install' && id === 'download') || step === 'done';
              return (
                <div
                  key={id}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] transition ${
                    active
                      ? 'bg-[#00a3ff]/20 text-white shadow-[inset_0_0_0_1px_rgba(0,163,255,0.45)]'
                      : done
                        ? 'text-cyan-200/70'
                        : 'text-white/35'
                  }`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-[#4dc9ff]' : ''}`} />
                  <span className="truncate">{label}</span>
                </div>
              );
            })}
          </nav>

          <div className="mt-4 rounded-xl border border-cyan-500/20 bg-gradient-to-b from-[#0c1824] to-[#081018] p-3">
            <div className="mb-2 h-12 rounded-lg bg-[radial-gradient(circle_at_50%_40%,rgba(0,180,255,0.35),transparent_65%)]" />
            <p className="text-[11px] leading-relaxed text-white/70">
              {t.tagline}
              <br />
              <span className="text-white/40">{t.taglineSub}</span>
            </p>
            <button
              type="button"
              className="mt-2 text-[11px] text-[#4dc9ff] hover:underline"
              onClick={() => void window.electronAPI?.openExternalUrl?.('https://aixflow.com.cn')}
            >
              {t.learnMore}
            </button>
          </div>

          <button
            type="button"
            className="mt-4 flex items-center gap-1.5 px-1 text-[11px] text-white/40 hover:text-white/70"
            onClick={() => void window.electronAPI?.openExternalUrl?.('https://aixflow.com.cn')}
          >
            <HelpCircle className="h-3.5 w-3.5" />
            {t.helpSupport}
          </button>
        </aside>

        <main className="relative z-10 flex min-w-0 flex-1 flex-col px-8 py-6 pr-24">
          <header className="mb-6">
            <div className="min-w-0">
              <h1 className="bg-gradient-to-r from-[#b57bff] via-[#5aa8ff] to-[#00d4ff] bg-clip-text text-4xl font-semibold tracking-tight text-transparent">
                {t.productTitle}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-white/55">
                <span>{t.installerName}</span>
                <span className="rounded border border-[#00a3ff]/50 px-1.5 py-0.5 text-[11px] text-[#7ad4ff]">
                  v{version}
                </span>
              </div>
              <p className="mt-3 max-w-lg text-[12px] leading-relaxed text-white/40">
                {t.updateHeroLine1}
                <br />
                {t.updateHeroLine2}
              </p>
            </div>
          </header>

          <section className="rounded-2xl border border-cyan-500/20 bg-[#0a1018]/90 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            {!downloading ? (
              <div className="space-y-5">
                <div>
                  <h2 className="text-[14px] font-medium text-white/90">{t.idleChooseRoute}</h2>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-white/45">{t.downloadRouteHint}</p>
                  <div className="mt-3">
                    <DownloadRouteToggle
                      region={region}
                      onChange={(next) => void changeRegion(next)}
                      t={t}
                    />
                  </div>
                </div>

                <dl className="space-y-2 border-t border-white/5 pt-4 text-[12px]">
                  <div className="flex gap-3">
                    <dt className="w-[4.5rem] shrink-0 text-white/35">{t.idleCurrentVersion}</dt>
                    <dd className="text-white/75">{appVersion ? `v${appVersion}` : '—'}</dd>
                  </div>
                  {updateChecking ? (
                    <p className="text-white/55">{t.idleChecking}</p>
                  ) : lastCheckResult?.error ? (
                    <p className="text-amber-400/90">
                      {lastCheckResult.errorMessage || updateDownloadError || t.statusError}
                    </p>
                  ) : updateAvailable ? (
                    <p className="text-emerald-300/90">
                      {t.idleHasUpdate} v{updateAvailable}
                    </p>
                  ) : lastCheckResult?.isLatest ? (
                    <p className="text-white/55">{t.idleLatest}</p>
                  ) : updateDownloadError ? (
                    <p className="text-amber-400/90">{updateDownloadError}</p>
                  ) : null}
                </dl>
              </div>
            ) : updateInstalling ? (
              <div className="py-8 text-center">
                <p className="text-sm text-white/80">{updateT.installingUpdate}</p>
                <p className="mt-2 text-xs text-white/40">{t.updateInstallingHint}</p>
                <div className="mx-auto mt-6 h-1.5 w-48 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-[#0057ff] to-[#00d4ff]" />
                </div>
              </div>
            ) : (
              <>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-[14px] font-medium text-white/90">
                      {downloadTitle}
                    </h2>
                    <div className="mt-2">
                      <DownloadRouteToggle region={region} onChange={() => {}} disabled t={t} />
                    </div>
                  </div>
                  <p className="shrink-0 text-[12px] tabular-nums text-[#5ad0ff]">
                    {t.downloaded} {formatBytes(transferred)}
                    {total > 0 ? ` / ${formatBytes(total)}` : ''}
                  </p>
                </div>

                <div className="h-2 overflow-hidden rounded-full bg-[#121820] ring-1 ring-white/5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#0047d6] via-[#0088ff] to-[#00e5ff] shadow-[0_0_12px_rgba(0,180,255,0.75)] transition-[width] duration-300 ease-out"
                    style={{ width: barWidth }}
                  />
                </div>

                <div className="mt-2 flex items-center justify-between text-[12px] text-white/45">
                  <span className="tabular-nums text-white/70">{percent.toFixed(1)}%</span>
                  <span className="tabular-nums">{paused ? t.paused : statusRight}</span>
                </div>

                <dl className="mt-5 space-y-2 border-t border-white/5 pt-4 text-[12px]">
                  <div className="flex gap-3">
                    <dt className="w-[4.5rem] shrink-0 text-white/35">{t.fileName}</dt>
                    <dd className="min-w-0 truncate text-white/75">{fileName}</dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="w-[4.5rem] shrink-0 text-white/35">{t.fileSize}</dt>
                    <dd className="text-white/75">{total > 0 ? formatBytes(total) : '—'}</dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="w-[4.5rem] shrink-0 text-white/35">{t.cacheDir}</dt>
                    <dd className="min-w-0 break-all text-white/55">{savePath || '—'}</dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="w-[4.5rem] shrink-0 text-white/35">{t.installDir}</dt>
                    <dd className="min-w-0 text-white/55">
                      <span className="font-mono text-white/75">{DEFAULT_INSTALL_DIR}</span>
                      <span className="mt-0.5 block text-[11px] text-white/35">
                        {t.updateInstallHint}
                      </span>
                    </dd>
                  </div>
                </dl>

                {updateDownloadError ? (
                  <p className="mt-3 text-[12px] text-amber-400/90">{updateDownloadError}</p>
                ) : null}
              </>
            )}
          </section>

          {!updateInstalling ? (
            <div className="mt-auto flex justify-end gap-3 pt-6">
              {!downloading ? (
                <>
                  <button
                    type="button"
                    onClick={() => void handleClose()}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/25 bg-transparent px-4 py-2.5 text-[13px] text-white/85 transition hover:border-white/45 hover:bg-white/5"
                  >
                    {t.close}
                  </button>
                  {updateAvailable ? (
                    <button
                      type="button"
                      onClick={() => void handleInstallUpdate()}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#0088ff] px-4 py-2.5 text-[13px] font-medium text-white shadow-[0_0_20px_rgba(0,136,255,0.45)] transition hover:bg-[#1a96ff]"
                    >
                      <Download className="h-4 w-4" />
                      {t.actionDownloadInstall} v{updateAvailable}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={updateChecking}
                      onClick={() => void handleCheckUpdate()}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#0088ff] px-4 py-2.5 text-[13px] font-medium text-white shadow-[0_0_20px_rgba(0,136,255,0.45)] transition hover:bg-[#1a96ff] disabled:opacity-50"
                    >
                      <RefreshCw className={`h-4 w-4 ${updateChecking ? 'animate-spin' : ''}`} />
                      {updateChecking ? t.idleChecking : t.actionCheckUpdate}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void (paused ? handleResumeDownload() : handlePauseDownload())}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/25 bg-transparent px-4 py-2.5 text-[13px] text-white/85 transition hover:border-white/45 hover:bg-white/5"
                  >
                    {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                    {paused ? t.continue : t.pause}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCancelDownload()}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#0088ff] px-4 py-2.5 text-[13px] font-medium text-white shadow-[0_0_20px_rgba(0,136,255,0.45)] transition hover:bg-[#1a96ff]"
                  >
                    <X className="h-4 w-4" />
                    {t.cancel}
                  </button>
                </>
              )}
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return body;
  return createPortal(body, document.body);
}
