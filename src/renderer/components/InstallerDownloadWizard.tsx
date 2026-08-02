import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Package, CheckCircle2, Pause, Play, X, HelpCircle } from 'lucide-react';
import type { useAppUpdate } from '../hooks/useAppUpdate';

type AppUpdateState = ReturnType<typeof useAppUpdate>;

type InstallerDownloadWizardProps = {
  update: AppUpdateState;
  /** 设计预览：用假进度，不依赖真实下载 */
  demo?: boolean;
};

type WizardStep = 'download' | 'install' | 'done';

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

const STEPS: { id: WizardStep; label: string; Icon: typeof Download }[] = [
  { id: 'download', label: '下载与安装', Icon: Download },
  { id: 'install', label: '安装进度', Icon: Package },
  { id: 'done', label: '完成', Icon: CheckCircle2 },
];

/**
 * Aixflow 下载引导安装器 UI（暗黑霓虹风格）。
 * 覆盖应用内更新下载；修复后的进度来自主进程合并 stub + 主包。
 */
export default function InstallerDownloadWizard({ update, demo = false }: InstallerDownloadWizardProps) {
  const {
    t,
    appVersion,
    updateAvailable,
    updateDownloading,
    updateInstalling,
    updateDownloadError,
    downloadProgress,
    downloadPaused,
    formatBytes,
    handlePauseDownload,
    handleResumeDownload,
    handleCancelDownload,
  } = update;

  const [demoTick, setDemoTick] = useState(0.2);

  useEffect(() => {
    if (!demo) return;
    const id = window.setInterval(() => {
      setDemoTick((p) => (p >= 0.95 ? 0.08 : p + 0.01));
    }, 120);
    return () => window.clearInterval(id);
  }, [demo]);

  const visible = demo || updateDownloading || updateInstalling;
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
    (typeof navigator !== 'undefined' ? '更新缓存目录' : '');
  const paused = demo ? false : downloadPaused || downloadProgress?.paused;
  const barWidth = `${percent.toFixed(2)}%`;
  const statusRight = `${formatSpeed(speed, formatBytes)} | 剩余 ${formatEta(etaSeconds)}`;

  if (!visible) return null;

  const body = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Aixflow 安装程序"
    >
      <div
        className="relative flex h-[min(640px,92vh)] w-[min(920px,96vw)] overflow-hidden rounded-2xl border border-white/10 shadow-[0_0_60px_rgba(0,163,255,0.18)]"
        style={{
          background:
            'radial-gradient(1200px 600px at 70% -10%, rgba(0,140,255,0.16), transparent 55%), linear-gradient(160deg, #0b0e14 0%, #0a121c 45%, #070b10 100%)',
        }}
      >
        {/* HUD grid */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(0,180,255,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(0,180,255,0.35) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(circle at 70% 20%, black 20%, transparent 70%)',
          }}
        />

        {/* Left nav */}
        <aside className="relative z-10 flex w-[200px] shrink-0 flex-col border-r border-cyan-500/15 bg-[#070a10]/85 px-4 py-5">
          <div className="mb-8 flex items-center gap-2 px-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-[#00a3ff] to-[#0050c8] text-sm font-bold text-white shadow-[0_0_16px_rgba(0,163,255,0.55)]">
              A
            </div>
            <span className="text-[15px] font-semibold tracking-wide text-white">Aixflow</span>
          </div>

          <nav className="flex flex-1 flex-col gap-2">
            {STEPS.map(({ id, label, Icon }) => {
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
              让 AI 流程更简单
              <br />
              <span className="text-white/40">创意 · 连接 · 无限可能</span>
            </p>
            <button
              type="button"
              className="mt-2 text-[11px] text-[#4dc9ff] hover:underline"
              onClick={() => void window.electronAPI?.openExternalUrl?.('https://aixflow.com.cn')}
            >
              了解更多 &gt;
            </button>
          </div>

          <button
            type="button"
            className="mt-4 flex items-center gap-1.5 px-1 text-[11px] text-white/40 hover:text-white/70"
            onClick={() => void window.electronAPI?.openExternalUrl?.('https://aixflow.com.cn')}
          >
            <HelpCircle className="h-3.5 w-3.5" />
            帮助与支持
          </button>
        </aside>

        {/* Main */}
        <main className="relative z-10 flex min-w-0 flex-1 flex-col px-8 py-6">
          <header className="mb-6 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="bg-gradient-to-r from-[#b57bff] via-[#5aa8ff] to-[#00d4ff] bg-clip-text text-4xl font-semibold tracking-tight text-transparent">
                Aixflow
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-white/55">
                <span>Aixflow 安装程序</span>
                <span className="rounded border border-[#00a3ff]/50 px-1.5 py-0.5 text-[11px] text-[#7ad4ff]">
                  v{version}
                </span>
              </div>
              <p className="mt-3 max-w-md text-[12px] leading-relaxed text-white/40">
                一款强大的 AI 工作流构建与管理平台
                <br />
                拖拽式设计 · 模块化扩展 · 高效执行
              </p>
            </div>
            <div className="relative hidden h-36 w-44 shrink-0 sm:block">
              <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(0,163,255,0.22),transparent_70%)]" />
              <div className="absolute left-1/2 top-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl bg-gradient-to-br from-[#1a6dff] to-[#00c2ff] text-3xl font-black text-white shadow-[0_0_40px_rgba(0,163,255,0.55)]">
                A
              </div>
              <span className="absolute left-2 top-3 rounded border border-white/15 bg-black/40 px-1.5 py-0.5 text-[9px] text-cyan-200/80">
                Workflow
              </span>
              <span className="absolute right-1 top-10 rounded border border-white/15 bg-black/40 px-1.5 py-0.5 text-[9px] text-cyan-200/80">
                Nodes
              </span>
              <span className="absolute bottom-8 left-4 rounded border border-white/15 bg-black/40 px-1.5 py-0.5 text-[9px] text-cyan-200/80">
                Models
              </span>
              <span className="absolute bottom-4 right-3 rounded border border-white/15 bg-black/40 px-1.5 py-0.5 text-[9px] text-cyan-200/80">
                API
              </span>
            </div>
          </header>

          <section className="rounded-2xl border border-cyan-500/20 bg-[#0a1018]/90 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            {updateInstalling ? (
              <div className="py-8 text-center">
                <p className="text-sm text-white/80">{t.installingUpdate}</p>
                <p className="mt-2 text-xs text-white/40">即将退出并启动安装程序，请稍候…</p>
                <div className="mx-auto mt-6 h-1.5 w-48 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-[#0057ff] to-[#00d4ff]" />
                </div>
              </div>
            ) : (
              <>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <h2 className="text-[14px] font-medium text-white/90">
                    {paused ? '下载已暂停' : '正在下载 Aixflow 安装包'}
                  </h2>
                  <p className="shrink-0 text-[12px] tabular-nums text-[#5ad0ff]">
                    已下载 {formatBytes(transferred)}
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
                  <span className="tabular-nums">{paused ? '已暂停' : statusRight}</span>
                </div>

                <dl className="mt-5 space-y-2 border-t border-white/5 pt-4 text-[12px]">
                  <div className="flex gap-3">
                    <dt className="w-16 shrink-0 text-white/35">文件名称</dt>
                    <dd className="min-w-0 truncate text-white/75">{fileName}</dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="w-16 shrink-0 text-white/35">文件大小</dt>
                    <dd className="text-white/75">{total > 0 ? formatBytes(total) : '—'}</dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="w-16 shrink-0 text-white/35">保存位置</dt>
                    <dd className="min-w-0 break-all text-white/55">{savePath || '—'}</dd>
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
              <button
                type="button"
                onClick={() => void (paused ? handleResumeDownload() : handlePauseDownload())}
                className="inline-flex items-center gap-2 rounded-lg border border-white/25 bg-transparent px-4 py-2.5 text-[13px] text-white/85 transition hover:border-white/45 hover:bg-white/5"
              >
                {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                {paused ? '继续' : '暂停'}
              </button>
              <button
                type="button"
                onClick={() => void handleCancelDownload()}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0088ff] px-4 py-2.5 text-[13px] font-medium text-white shadow-[0_0_20px_rgba(0,136,255,0.45)] transition hover:bg-[#1a96ff]"
              >
                <X className="h-4 w-4" />
                取消
              </button>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return body;
  return createPortal(body, document.body);
}
