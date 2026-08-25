import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  CheckCircle2,
  Download,
  FolderOpen,
  HelpCircle,
  Pause,
  Play,
  Package,
  Rocket,
  X,
} from 'lucide-react';
import {
  installerWizardT,
  readInstallerDownloadRegion,
  readInstallerLocale,
  writeInstallerDownloadRegion,
  writeInstallerLocale,
  type InstallerLocale,
} from '@/shared/installerWizardI18n';
import {
  getGlassInstallerApi,
  type GlassInstallerMeta,
  type GlassInstallerPhase,
  type GlassInstallerProgress,
} from './glassInstallerApi';

const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;

type WizardStep = 'download' | 'install' | 'done';

const DEFAULT_INSTALL_DIR = 'C:\\Program Files\\Aixflow';

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${Math.floor(n)} B`;
}

function formatEta(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '--:--:--';
  const s = Math.floor(seconds);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 1) return '—';
  return `${formatBytes(bytesPerSecond)}/s`;
}

function normalizeInstallDir(raw: string): string {
  const t = String(raw || '')
    .trim()
    .replace(/\//g, '\\')
    .replace(/[\\\/]+$/, '');
  return t || DEFAULT_INSTALL_DIR;
}

function wizardStepFromPhase(phase: GlassInstallerPhase): WizardStep {
  if (phase === 'done') return 'done';
  if (phase === 'installing') return 'install';
  return 'download';
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
      style={noDragStyle}
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
      title={t.downloadRouteAria}
      style={noDragStyle}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('cn')}
        className={`rounded-md px-2 py-1 transition disabled:opacity-40 ${
          region === 'cn'
            ? 'bg-[#00a3ff]/25 text-white'
            : 'text-white/45 hover:text-white/75'
        }`}
      >
        {t.downloadRouteBeijing}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('hk')}
        className={`rounded-md px-2 py-1 transition disabled:opacity-40 ${
          region === 'hk'
            ? 'bg-[#00a3ff]/25 text-white'
            : 'text-white/45 hover:text-white/75'
        }`}
      >
        {t.downloadRouteHongKong}
      </button>
    </div>
  );
}

export function GlassInstallerApp() {
  const api = useMemo(() => {
    try {
      return getGlassInstallerApi();
    } catch {
      return null;
    }
  }, []);

  const [locale, setLocale] = useState<InstallerLocale>(() => readInstallerLocale());
  const t = useMemo(() => installerWizardT(locale), [locale]);
  const [downloadRegion, setDownloadRegion] = useState<'cn' | 'hk'>(() =>
    readInstallerDownloadRegion(readInstallerLocale()),
  );

  const [installDir, setInstallDir] = useState(DEFAULT_INSTALL_DIR);
  const [meta, setMeta] = useState<GlassInstallerMeta | null>(null);
  const [phase, setPhase] = useState<GlassInstallerPhase>('idle');
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState<GlassInstallerProgress>({
    phase: 'download',
    transferred: 0,
    total: 0,
    percent: 0,
    bytesPerSecond: 0,
    etaSeconds: null,
    fileName: '',
    savePath: '',
  });

  const setLocalePersist = (next: InstallerLocale) => {
    setLocale(next);
    writeInstallerLocale(next);
  };

  useEffect(() => {
    if (!api) {
      setError(t.connectFailed);
      setPhase('error');
      return;
    }
    let cancelled = false;
    (async () => {
      const dir = await api.getDefaultInstallDir();
      if (!cancelled && dir) setInstallDir(dir);
      const res = await api.resolveMeta(readInstallerDownloadRegion(readInstallerLocale()));
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        setPhase('error');
        return;
      }
      setMeta(res.meta);
      setProgress((p) => ({
        ...p,
        total: res.meta.packageBytes || 0,
        fileName: res.meta.packageName,
      }));
      setPhase('ready');
    })();

    const offProgress = api.onProgress((p) => setProgress(p));
    const offPhase = api.onPhase(({ phase: next, error: err }) => {
      setPhase(next);
      if (err) setError(err);
      if (next === 'downloading') setPaused(false);
      if (next === 'cancelled') setPaused(false);
    });

    return () => {
      cancelled = true;
      offProgress();
      offPhase();
    };
    // t.connectFailed 仅在 api 缺失时用一次；避免 locale 切换反复 resolve
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const step = wizardStepFromPhase(phase);
  const version = meta?.version || '—';
  const fileName = progress.fileName || meta?.packageName || '—';
  const total = progress.total || meta?.packageBytes || 0;
  const downloading = phase === 'downloading';
  const installing = phase === 'installing';
  const busy = downloading || installing;

  const steps = useMemo(
    () =>
      [
        { id: 'download' as const, label: t.stepDownload, Icon: Download },
        { id: 'install' as const, label: t.stepInstall, Icon: Package },
        { id: 'done' as const, label: t.stepDone, Icon: CheckCircle2 },
      ] as const,
    [t],
  );

  const statusTitle = installing
    ? t.statusInstalling
    : phase === 'done'
      ? t.statusDone
      : paused
        ? t.statusPaused
        : downloading
          ? t.statusDownloading
          : phase === 'resolving'
            ? t.statusResolving
            : phase === 'error'
              ? t.statusError
              : phase === 'cancelled'
                ? t.statusCancelled
                : t.statusReady;

  const statusRight = installing
    ? t.installingWait
    : paused
      ? t.paused
      : `${formatSpeed(progress.bytesPerSecond)} | ${t.remaining} ${formatEta(progress.etaSeconds)}`;

  const start = async () => {
    if (!api) return;
    setError('');
    setPaused(false);
    const res = await api.startInstall(normalizeInstallDir(installDir));
    if (!res.ok && res.error !== '已取消' && res.error !== 'Cancelled') setError(res.error);
  };

  const pickDir = async () => {
    if (!api || busy) return;
    const picked = await api.pickInstallDir(installDir);
    if (picked) setInstallDir(picked);
  };

  const togglePause = async () => {
    if (!api || !downloading) return;
    if (paused) {
      setPaused(false);
      await api.resumeDownload();
    } else {
      setPaused(true);
      await api.pauseDownload();
    }
  };

  const cancel = async () => {
    if (!api) return;
    await api.cancel();
    setPaused(false);
  };

  const launch = async () => {
    if (!api) return;
    const res = await api.launchApp(normalizeInstallDir(installDir));
    if (!res.ok) setError(res.error || t.launchFailed);
    else await api.quit();
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-transparent p-2">
      <div
        className="relative flex h-full w-full overflow-hidden rounded-2xl border border-white/10 shadow-[0_0_60px_rgba(0,163,255,0.18)]"
        style={{
          ...dragStyle,
          background:
            'radial-gradient(1200px 600px at 70% -10%, rgba(0,140,255,0.16), transparent 55%), linear-gradient(160deg, #0b0e14 0%, #0a121c 45%, #070b10 100%)',
        }}
        role="dialog"
        aria-label={t.dialogAria}
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

        <div className="absolute right-3 top-3 z-20 flex items-center gap-2" style={noDragStyle}>
          <DownloadRouteToggle
            region={downloadRegion}
            disabled={busy}
            t={t}
            onChange={(next) => {
              if (busy || next === downloadRegion) return;
              writeInstallerDownloadRegion(next);
              setDownloadRegion(next);
              void (async () => {
                if (!api) return;
                setError('');
                const res = await api.resolveMeta(next);
                if (!res.ok) {
                  setError(res.error);
                  setPhase('error');
                  return;
                }
                setMeta(res.meta);
                setProgress((p) => ({
                  ...p,
                  total: res.meta.packageBytes || 0,
                  fileName: res.meta.packageName,
                }));
                setPhase('ready');
              })();
            }}
          />
          <LangToggle locale={locale} onChange={setLocalePersist} t={t} />
          <button
            type="button"
            aria-label={t.close}
            title={t.close}
            onClick={() => void api?.quit()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-black/20 text-white/55 transition hover:border-white/25 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
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
              const done =
                (step === 'install' && id === 'download') ||
                (step === 'done' && id !== 'done');
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
              style={noDragStyle}
              onClick={() => void api?.openExternal('https://aixflow.com.cn')}
            >
              {t.learnMore}
            </button>
          </div>

          <button
            type="button"
            className="mt-4 flex items-center gap-1.5 px-1 text-[11px] text-white/40 hover:text-white/70"
            style={noDragStyle}
            onClick={() => void api?.openExternal('https://aixflow.com.cn')}
          >
            <HelpCircle className="h-3.5 w-3.5" />
            {t.helpSupport}
          </button>
        </aside>

        <main
          className="relative z-10 flex min-w-0 flex-1 flex-col px-8 py-6 pr-24"
          style={noDragStyle}
        >
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
                {t.heroDescLine1}
                <br />
                {t.heroDescLine2}
              </p>
            </div>
          </header>

          <section className="rounded-2xl border border-cyan-500/20 bg-[#0a1018]/90 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            {installing ? (
              <div className="py-6 text-center">
                <p className="text-sm text-white/80">{statusTitle}</p>
                <p className="mt-2 text-xs text-white/40">
                  {t.installingHint}{' '}
                  <span className="font-mono text-white/70">{normalizeInstallDir(installDir)}</span>
                </p>
                <div className="mx-auto mt-6 h-1.5 w-48 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-[#0057ff] to-[#00d4ff]" />
                </div>
              </div>
            ) : (
              <>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <h2 className="text-[14px] font-medium text-white/90">{statusTitle}</h2>
                  <p className="shrink-0 text-[12px] tabular-nums text-[#5ad0ff]">
                    {t.downloaded} {formatBytes(progress.transferred)}
                    {total > 0 ? ` / ${formatBytes(total)}` : ''}
                  </p>
                </div>

                <div className="h-2 overflow-hidden rounded-full bg-[#121820] ring-1 ring-white/5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#0047d6] via-[#0088ff] to-[#00e5ff] shadow-[0_0_12px_rgba(0,180,255,0.75)] transition-[width] duration-300 ease-out"
                    style={{
                      width: `${Math.max(phase === 'done' ? 100 : progress.percent, 0).toFixed(2)}%`,
                    }}
                  />
                </div>

                <div className="mt-2 flex items-center justify-between text-[12px] text-white/45">
                  <span className="tabular-nums text-white/70">
                    {phase === 'done' ? '100.0%' : `${progress.percent.toFixed(1)}%`}
                  </span>
                  <span className="tabular-nums">{statusRight}</span>
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
                    <dd className="min-w-0 break-all text-white/55">
                      {progress.savePath || t.systemTemp}
                    </dd>
                  </div>
                  <div className="flex items-start gap-3">
                    <dt className="w-[4.5rem] shrink-0 pt-1.5 text-white/35">{t.installDir}</dt>
                    <dd className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={installDir}
                          onChange={(e) => setInstallDir(e.target.value)}
                          onBlur={() => setInstallDir(normalizeInstallDir(installDir))}
                          disabled={busy || phase === 'done'}
                          spellCheck={false}
                          className="min-w-0 flex-1 rounded-md border border-white/15 bg-[#0c121a] px-2.5 py-1.5 font-mono text-[12px] text-white/80 outline-none ring-[#00a3ff]/40 focus:border-[#00a3ff]/50 focus:ring-1 disabled:opacity-50"
                          placeholder={DEFAULT_INSTALL_DIR}
                          aria-label={t.installDirAria}
                        />
                        <button
                          type="button"
                          onClick={() => void pickDir()}
                          disabled={busy || phase === 'done'}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/20 px-2.5 py-1.5 text-[12px] text-white/75 transition hover:border-white/40 hover:bg-white/5 disabled:opacity-50"
                          title={t.browseTitle}
                        >
                          <FolderOpen className="h-3.5 w-3.5" />
                          {t.browse}
                        </button>
                      </div>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-white/35">
                        {t.installDirHint}
                      </p>
                    </dd>
                  </div>
                </dl>
              </>
            )}

            {error ? <p className="mt-3 text-[12px] text-amber-400/90">{error}</p> : null}
            {phase === 'done' ? (
              <p className="mt-3 text-[12px] text-emerald-300/90">
                {t.installedTo}{' '}
                <span className="font-mono text-emerald-200/95">
                  {normalizeInstallDir(installDir)}
                </span>
              </p>
            ) : null}
          </section>

          <div className="mt-auto flex flex-wrap justify-end gap-3 pt-6">
            {phase === 'ready' || phase === 'error' || phase === 'cancelled' || phase === 'idle' ? (
              <button
                type="button"
                disabled={!meta || phase === 'resolving'}
                onClick={() => void start()}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0088ff] px-4 py-2.5 text-[13px] font-medium text-white shadow-[0_0_20px_rgba(0,136,255,0.45)] transition hover:bg-[#1a96ff] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                {phase === 'resolving' ? t.preparing : t.startInstall}
              </button>
            ) : null}

            {downloading ? (
              <button
                type="button"
                onClick={() => void togglePause()}
                className="inline-flex items-center gap-2 rounded-lg border border-white/25 bg-transparent px-4 py-2.5 text-[13px] text-white/85 transition hover:border-white/45 hover:bg-white/5"
              >
                {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                {paused ? t.continue : t.pause}
              </button>
            ) : null}

            {busy ? (
              <button
                type="button"
                onClick={() => void cancel()}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0088ff] px-4 py-2.5 text-[13px] font-medium text-white shadow-[0_0_20px_rgba(0,136,255,0.45)] transition hover:bg-[#1a96ff]"
              >
                <X className="h-4 w-4" />
                {t.cancel}
              </button>
            ) : null}

            {phase === 'done' ? (
              <>
                <button
                  type="button"
                  onClick={() => void api?.quit()}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/25 bg-transparent px-4 py-2.5 text-[13px] text-white/85 transition hover:border-white/45 hover:bg-white/5"
                >
                  {t.close}
                </button>
                <button
                  type="button"
                  onClick={() => void launch()}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#0088ff] px-4 py-2.5 text-[13px] font-medium text-white shadow-[0_0_20px_rgba(0,136,255,0.45)] transition hover:bg-[#1a96ff]"
                >
                  <Rocket className="h-4 w-4" />
                  {t.launch}
                </button>
              </>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
