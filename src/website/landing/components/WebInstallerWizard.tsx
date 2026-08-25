import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, FolderOpen, HelpCircle, Pause, Play, Package, X } from 'lucide-react';
import {
  detectInstallerPlatform,
  formatInstallerBytes,
  getPreferredDownloadRegion,
  resolveInstallerArtifactForPlatform,
  subscribeDownloadRegion,
  type InstallerArtifact,
} from '../lib/installerDownload';
import {
  BrowserInstallerDownloader,
  type BrowserDownloadMode,
  type BrowserDownloadProgress,
} from '../lib/browserInstallerDownload';
import { DownloadRegionToggle } from './DownloadRegionToggle';

type WizardStep = 'download' | 'install' | 'done';

const DEFAULT_INSTALL_DIR = 'C:\\Program Files\\Aixflow';
const INSTALL_DIR_STORAGE_KEY = 'aixflow.webInstaller.installDir';

const STEPS: { id: WizardStep; label: string; Icon: typeof Download }[] = [
  { id: 'download', label: '下载与安装', Icon: Download },
  { id: 'install', label: '安装进度', Icon: Package },
  { id: 'done', label: '完成', Icon: CheckCircle2 },
];

function normalizeInstallDir(raw: string): string {
  const t = String(raw || '').trim().replace(/\//g, '\\');
  if (!t) return DEFAULT_INSTALL_DIR;
  return t.replace(/[\\\/]+$/, '') || DEFAULT_INSTALL_DIR;
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
  return `${formatInstallerBytes(bytesPerSecond)}/s`;
}

export function WebInstallerWizard() {
  const [artifact, setArtifact] = useState<InstallerArtifact | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [metaError, setMetaError] = useState('');
  const [phase, setPhase] = useState<'ready' | 'downloading' | 'paused' | 'done' | 'native' | 'error'>(
    'ready',
  );
  const [progress, setProgress] = useState<BrowserDownloadProgress>({
    transferred: 0,
    total: 0,
    percent: 0,
    bytesPerSecond: 0,
    etaSeconds: null,
  });
  const [error, setError] = useState('');
  const [saveHint, setSaveHint] = useState('浏览器下载文件夹');
  const [installDir, setInstallDir] = useState(DEFAULT_INSTALL_DIR);
  const downloaderRef = useRef(new BrowserInstallerDownloader());
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(INSTALL_DIR_STORAGE_KEY);
      if (saved) setInstallDir(normalizeInstallDir(saved));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadingMeta(true);
      setMetaError('');
      const platform = detectInstallerPlatform();
      const art = await resolveInstallerArtifactForPlatform(
        platform,
        getPreferredDownloadRegion(),
      );
      if (cancelled) return;
      if (!art) {
        setMetaError('安装包暂不可用，请稍后重试');
        setLoadingMeta(false);
        return;
      }
      setArtifact(art);
      setProgress((p) => ({ ...p, total: art.size || 0 }));
      setLoadingMeta(false);
    };
    void load();
    const unsub = subscribeDownloadRegion(() => {
      const current = phaseRef.current;
      if (current === 'downloading' || current === 'paused') return;
      void load();
    });
    return () => {
      cancelled = true;
      unsub();
      void downloaderRef.current.cancel();
    };
  }, []);

  const persistInstallDir = (next: string) => {
    const normalized = normalizeInstallDir(next);
    setInstallDir(normalized);
    try {
      localStorage.setItem(INSTALL_DIR_STORAGE_KEY, normalized);
    } catch {
      /* ignore */
    }
  };

  const pickInstallDirHint = async () => {
    // 浏览器无法真正选定「软件安装目录」落盘路径；目录选择器仅作路径提示（Chrome 等可能支持）
    const picker = (window as Window & {
      showDirectoryPicker?: (opts?: { mode?: string }) => Promise<{ name: string }>;
    }).showDirectoryPicker;
    if (typeof picker !== 'function') {
      setError('当前浏览器不支持文件夹选择。请直接编辑安装目录，或在运行 Setup 时于安装向导中选择。');
      return;
    }
    try {
      const handle = await picker({ mode: 'read' });
      const name = String(handle?.name || '').trim();
      if (!name) return;
      // File System Access API 只暴露目录名，不暴露完整盘符路径；用常见默认盘符拼接作提示
      persistInstallDir(`C:\\${name}\\Aixflow`);
      setError('');
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      if (name !== 'AbortError') {
        setError('未能选择文件夹，请手动输入安装目录（如 D:\\Apps\\Aixflow）');
      }
    }
  };

  const version = artifact?.version || '—';
  const fileName = artifact?.fileName || '—';
  const total = progress.total || artifact?.size || 0;
  const step: WizardStep = phase === 'done' ? 'done' : 'download';
  const paused = phase === 'paused';
  const downloading = phase === 'downloading';
  const canStream = downloaderRef.current.canStream;

  const onProgress = (p: BrowserDownloadProgress) => setProgress(p);

  const startDownload = async () => {
    if (!artifact) return;
    setError('');
    setPhase('downloading');
    if (canStream) setSaveHint('你选择的本地路径');
    else setSaveHint('浏览器下载文件夹');

    await downloaderRef.current.start({
      url: artifact.url,
      fileName: artifact.fileName,
      knownSize: artifact.size,
      onProgress,
      onDone: (mode: BrowserDownloadMode) => {
        if (mode === 'native') {
          setPhase('native');
          return;
        }
        setPhase('done');
        setProgress((prev) => ({
          ...prev,
          transferred: prev.total || prev.transferred,
          percent: 100,
          bytesPerSecond: 0,
          etaSeconds: 0,
        }));
      },
      onError: (message) => {
        setError(message);
        setPhase('error');
      },
    });
  };

  const handlePauseResume = async () => {
    if (!artifact) return;
    if (phase === 'native') return;
    if (paused) {
      setPhase('downloading');
      await downloaderRef.current.resume(artifact.url, onProgress, (mode) => {
        if (mode === 'native') setPhase('native');
        else setPhase('done');
      }, (message) => {
        setError(message);
        setPhase('error');
      });
      return;
    }
    if (downloading) {
      await downloaderRef.current.pause();
      setPhase('paused');
    }
  };

  const handleCancel = async () => {
    await downloaderRef.current.cancel();
    setPhase('ready');
    setProgress({
      transferred: 0,
      total: artifact?.size || 0,
      percent: 0,
      bytesPerSecond: 0,
      etaSeconds: null,
    });
    setError('');
  };

  const statusTitle =
    phase === 'done'
      ? '下载完成'
      : phase === 'native'
        ? '已交给浏览器下载'
        : phase === 'paused'
          ? '下载已暂停'
          : phase === 'downloading'
            ? '正在下载 Aixflow 安装包'
            : phase === 'error'
              ? '下载出错'
              : loadingMeta
                ? '正在解析安装包…'
                : '准备下载 Aixflow 安装包';

  const statusRight =
    phase === 'native'
      ? '请查看浏览器下载栏'
      : paused
        ? '已暂停'
        : `${formatSpeed(progress.bytesPerSecond)} | 剩余 ${formatEta(progress.etaSeconds)}`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#05070b] p-4">
      <div
        className="relative flex h-[min(640px,92vh)] w-[min(920px,96vw)] overflow-hidden rounded-2xl border border-white/10 shadow-[0_0_60px_rgba(0,163,255,0.18)]"
        style={{
          background:
            'radial-gradient(1200px 600px at 70% -10%, rgba(0,140,255,0.16), transparent 55%), linear-gradient(160deg, #0b0e14 0%, #0a121c 45%, #070b10 100%)',
        }}
        role="dialog"
        aria-label="Aixflow 安装程序"
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
              const done = step === 'done' && id !== 'done';
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
            <a
              href="./index.html"
              className="mt-2 inline-block text-[11px] text-[#4dc9ff] hover:underline"
            >
              了解更多 &gt;
            </a>
          </div>

          <a
            href="./index.html#contact"
            className="mt-4 flex items-center gap-1.5 px-1 text-[11px] text-white/40 hover:text-white/70"
          >
            <HelpCircle className="h-3.5 w-3.5" />
            帮助与支持
          </a>
        </aside>

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
                <DownloadRegionToggle
                  compact
                  disabled={downloading || paused}
                />
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
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 className="text-[14px] font-medium text-white/90">{statusTitle}</h2>
              <p className="shrink-0 text-[12px] tabular-nums text-[#5ad0ff]">
                已下载 {formatInstallerBytes(progress.transferred)}
                {total > 0 ? ` / ${formatInstallerBytes(total)}` : ''}
              </p>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-[#121820] ring-1 ring-white/5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#0047d6] via-[#0088ff] to-[#00e5ff] shadow-[0_0_12px_rgba(0,180,255,0.75)] transition-[width] duration-300 ease-out"
                style={{
                  width:
                    phase === 'native'
                      ? '100%'
                      : `${Math.max(phase === 'ready' || loadingMeta ? 0 : progress.percent, 0).toFixed(2)}%`,
                  opacity: phase === 'native' ? 0.45 : 1,
                }}
              />
            </div>

            <div className="mt-2 flex items-center justify-between text-[12px] text-white/45">
              <span className="tabular-nums text-white/70">
                {phase === 'native' ? '…' : `${progress.percent.toFixed(1)}%`}
              </span>
              <span className="tabular-nums">{statusRight}</span>
            </div>

            <dl className="mt-5 space-y-2 border-t border-white/5 pt-4 text-[12px]">
              <div className="flex gap-3">
                <dt className="w-16 shrink-0 text-white/35">文件名称</dt>
                <dd className="min-w-0 truncate text-white/75">{fileName}</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-16 shrink-0 text-white/35">文件大小</dt>
                <dd className="text-white/75">{total > 0 ? formatInstallerBytes(total) : '—'}</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-16 shrink-0 text-white/35">安装包保存</dt>
                <dd className="min-w-0 break-all text-white/55">{saveHint}</dd>
              </div>
              <div className="flex items-start gap-3">
                <dt className="w-16 shrink-0 pt-1.5 text-white/35">安装目录</dt>
                <dd className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={installDir}
                      onChange={(e) => setInstallDir(e.target.value)}
                      onBlur={() => persistInstallDir(installDir)}
                      disabled={downloading || paused}
                      spellCheck={false}
                      className="min-w-0 flex-1 rounded-md border border-white/15 bg-[#0c121a] px-2.5 py-1.5 font-mono text-[12px] text-white/80 outline-none ring-[#00a3ff]/40 focus:border-[#00a3ff]/50 focus:ring-1 disabled:opacity-50"
                      placeholder={DEFAULT_INSTALL_DIR}
                      aria-label="软件安装目录"
                    />
                    <button
                      type="button"
                      onClick={() => void pickInstallDirHint()}
                      disabled={downloading || paused}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/20 px-2.5 py-1.5 text-[12px] text-white/75 transition hover:border-white/40 hover:bg-white/5 disabled:opacity-50"
                      title="选择文件夹（浏览器仅作路径提示）"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      浏览
                    </button>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-white/35">
                    此为网页辅助页。推荐从官网首页下载「Aixflow-Installer」玻璃本机安装器，可在本机真正选择安装目录并全程玻璃 UI。
                  </p>
                </dd>
              </div>
            </dl>

            {metaError || error ? (
              <p className="mt-3 text-[12px] text-amber-400/90">{metaError || error}</p>
            ) : null}
            {phase === 'native' ? (
              <p className="mt-3 text-[12px] text-white/45">
                当前浏览器不支持带进度的流式保存，已启动系统下载。下载完成后请运行安装包，并在向导中选择安装目录：
                <span className="ml-1 font-mono text-white/70">{normalizeInstallDir(installDir)}</span>
              </p>
            ) : null}
            {phase === 'done' ? (
              <p className="mt-3 text-[12px] text-emerald-300/90">
                安装包已保存。请运行 Setup；在「选择安装位置」页确认为：
                <span className="ml-1 font-mono text-emerald-200/95">{normalizeInstallDir(installDir)}</span>
              </p>
            ) : null}
          </section>

          <div className="mt-auto flex flex-wrap justify-end gap-3 pt-6">
            {phase === 'ready' || phase === 'error' ? (
              <button
                type="button"
                disabled={loadingMeta || !artifact}
                onClick={() => void startDownload()}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0088ff] px-4 py-2.5 text-[13px] font-medium text-white shadow-[0_0_20px_rgba(0,136,255,0.45)] transition hover:bg-[#1a96ff] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                {loadingMeta ? '准备中…' : '开始下载'}
              </button>
            ) : null}

            {(downloading || paused) && canStream ? (
              <button
                type="button"
                onClick={() => void handlePauseResume()}
                className="inline-flex items-center gap-2 rounded-lg border border-white/25 bg-transparent px-4 py-2.5 text-[13px] text-white/85 transition hover:border-white/45 hover:bg-white/5"
              >
                {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                {paused ? '继续' : '暂停'}
              </button>
            ) : null}

            {phase !== 'done' && phase !== 'ready' ? (
              <button
                type="button"
                onClick={() => void handleCancel()}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0088ff] px-4 py-2.5 text-[13px] font-medium text-white shadow-[0_0_20px_rgba(0,136,255,0.45)] transition hover:bg-[#1a96ff]"
              >
                <X className="h-4 w-4" />
                取消
              </button>
            ) : null}

            {phase === 'done' || phase === 'native' ? (
              <a
                href="./index.html"
                className="inline-flex items-center gap-2 rounded-lg border border-white/25 bg-transparent px-4 py-2.5 text-[13px] text-white/85 transition hover:border-white/45 hover:bg-white/5"
              >
                返回官网
              </a>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
