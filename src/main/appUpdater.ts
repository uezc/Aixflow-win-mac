import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { BrowserWindow, ipcMain, app } from 'electron';
/** electron-updater 为 CJS；打包后主进程为 ESM 时不能用 `import { autoUpdater }`，须默认导入再解构 */
import electronUpdater from 'electron-updater';
import { getUpdaterFeedUrlForRegion, type ReleaseFeedRegion } from './config/ossConfig.js';
import { store } from './services/store.js';
import { prepareForUpdateInstall } from './updateQuitHelper.js';
import { requestRendererPrepareForUpdate } from './updatePrepareIpc.js';

const require = createRequire(import.meta.url);

type CancellationTokenCtor = new () => { cancel: () => void; cancelled: boolean };

/**
 * builder-util-runtime 应在 dependencies 中；打包后若顶层缺失，
 * 回退到 electron-updater 自带的嵌套副本，避免主进程启动即崩溃。
 */
function loadCancellationToken(): CancellationTokenCtor {
  const tried: string[] = [];
  const tryLoad = (id: string): CancellationTokenCtor | null => {
    tried.push(id);
    try {
      const mod = require(id) as { CancellationToken?: CancellationTokenCtor };
      if (typeof mod?.CancellationToken === 'function') return mod.CancellationToken;
    } catch {
      /* try next */
    }
    return null;
  };

  const fromTop = tryLoad('builder-util-runtime');
  if (fromTop) return fromTop;

  try {
    const updaterEntry = require.resolve('electron-updater');
    const nested = path.join(
      path.dirname(updaterEntry),
      'node_modules',
      'builder-util-runtime',
    );
    const fromNested = tryLoad(nested);
    if (fromNested) return fromNested;
  } catch {
    /* ignore */
  }

  // 部分打包布局：electron-updater/node_modules 与入口同级的上一级
  try {
    const updaterPkg = require.resolve('electron-updater/package.json');
    const nested = path.join(
      path.dirname(updaterPkg),
      'node_modules',
      'builder-util-runtime',
    );
    const fromNested = tryLoad(nested);
    if (fromNested) return fromNested;
  } catch {
    /* ignore */
  }

  console.error(
    '[autoUpdater] Cannot load CancellationToken from builder-util-runtime. Tried:',
    tried.join(', '),
  );
  // 惰性失败：不在模块加载期 throw，下载时再报错
  return class MissingCancellationToken {
    cancelled = false;
    cancel() {
      this.cancelled = true;
    }
  };
}

const CancellationToken = loadCancellationToken();

const { autoUpdater } = electronUpdater;

/** electron-updater 内部 API，类型定义未导出，运行时可用 */
type UpdaterInternals = {
  getOrCreateDownloadHelper?: () => Promise<{ cacheDirForPendingUpdate: string }>;
  updateInfoAndProvider?: { info?: { version?: string; path?: string } };
};

function getUpdaterInternals(): UpdaterInternals {
  return autoUpdater as unknown as UpdaterInternals;
}

let mainWindowRef: BrowserWindow | null = null;
let feedAndListenersReady = false;
/** 当前 autoUpdater generic feed 区域：大陆默认 cn，失败可回退 hk */
let activeReleaseFeedRegion: ReleaseFeedRegion = resolveInitialReleaseFeedRegion();

function readStoredReleaseFeedRegion(): ReleaseFeedRegion | null {
  try {
    const v = String(store.get('nxReleaseFeedRegion') || '')
      .trim()
      .toLowerCase();
    if (v === 'hk' || v === 'cn') return v;
  } catch {
    /* ignore */
  }
  return null;
}

function resolveInitialReleaseFeedRegion(): ReleaseFeedRegion {
  const stored = readStoredReleaseFeedRegion();
  if (stored) return stored;
  const env = String(process.env.NX_RELEASE_FEED_REGION || '').trim().toLowerCase();
  if (env === 'hk') return 'hk';
  if (env === 'cn') return 'cn';
  try {
    const loc = app.getLocale().toLowerCase().replace(/_/g, '-');
    if (loc === 'zh-cn' || loc.startsWith('zh-cn')) return 'cn';
  } catch {
    /* ignore */
  }
  return 'hk';
}

function persistReleaseFeedRegion(region: ReleaseFeedRegion): void {
  try {
    store.set('nxReleaseFeedRegion', region);
  } catch {
    /* ignore */
  }
}

function applyUpdaterFeed(region: ReleaseFeedRegion): void {
  activeReleaseFeedRegion = region;
  if (!app.isPackaged) return;
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  const platform = process.platform === 'darwin' ? 'darwin' : 'win32';
  const url = getUpdaterFeedUrlForRegion(region, platform);
  autoUpdater.setFeedURL({ provider: 'generic', url });
  console.log(`[autoUpdater] Release feed → ${region}: ${url}`);
}

/** 所选线路失败时回退另一条（不改用户偏好；成功后保持回退源以便紧接着下载） */
async function withReleaseFeedFallback<T>(fn: () => Promise<T>): Promise<T> {
  const preferred = activeReleaseFeedRegion;
  try {
    return await fn();
  } catch (err) {
    const alt: ReleaseFeedRegion = preferred === 'cn' ? 'hk' : 'cn';
    console.warn(
      `[autoUpdater] ${preferred === 'cn' ? '北京' : '香港'} Release feed 失败，回退${alt === 'cn' ? '北京' : '香港'}`,
      err,
    );
    applyUpdaterFeed(alt);
    return await fn();
  }
}
let updateInstallScheduled = false;
/** nsis-web 主包体积（来自 latest.yml packages.x64.size） */
let pendingPackageBytes = 0;
let pendingUpdateVersion: string | null = null;
/** stub exe 体积（来自 download-progress 的 total） */
let stubBytesTotal = 0;
let stubBytesTransferred = 0;
let packagePollTimer: ReturnType<typeof setInterval> | null = null;
let lastPollTransferred = 0;
let lastPollAt = 0;
let pollBytesPerSecond = 0;
let lastPendingDir: string | null = null;
let downloadCancellationToken: { cancel: () => void; cancelled: boolean } | null = null;
let downloadPaused = false;
let downloadCancelled = false;
let downloadInFlight = false;

/** stub exe 通常 < 32MB；主包 .nsis.7z 为 GB 级 */
const NSIS_WEB_STUB_MAX_BYTES = 32 * 1024 * 1024;
const PACKAGE_POLL_MS = 400;

export function setAppUpdaterMainWindow(win: BrowserWindow | null) {
  mainWindowRef = win;
}

function sendToRenderer(channel: string, payload?: unknown) {
  const w = mainWindowRef;
  if (!w || w.isDestroyed() || w.webContents.isDestroyed()) return;
  if (payload === undefined) w.webContents.send(channel);
  else w.webContents.send(channel, payload);
}

function safeNumber(n: unknown, fallback = 0): number {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function readPackageBytes(info: unknown): number {
  if (!info || typeof info !== 'object') return 0;
  const packages = (info as { packages?: Record<string, { size?: number }> }).packages;
  if (!packages) return 0;
  return safeNumber(packages.x64?.size ?? packages['x64']?.size, 0);
}

function stopPackagePoll() {
  if (packagePollTimer) {
    clearInterval(packagePollTimer);
    packagePollTimer = null;
  }
}

async function resolvePendingDir(): Promise<string | null> {
  try {
    const au = getUpdaterInternals();
    if (typeof au.getOrCreateDownloadHelper === 'function') {
      const helper = await au.getOrCreateDownloadHelper();
      if (helper?.cacheDirForPendingUpdate) {
        lastPendingDir = helper.cacheDirForPendingUpdate;
        return helper.cacheDirForPendingUpdate;
      }
    }
  } catch {
    /* ignore */
  }
  const localAppData = process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local');
  for (const dirName of [`${app.getName()}-updater`, 'nexflow-updater', 'Aixflow-updater']) {
    const pending = path.join(localAppData, dirName, 'pending');
    if (fs.existsSync(pending)) {
      lastPendingDir = pending;
      return pending;
    }
  }
  const fallback = path.join(localAppData, `${app.getName()}-updater`, 'pending');
  lastPendingDir = fallback;
  return fallback;
}

function statFileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

/**
 * 读取主包已下载字节。
 * electron-updater 全量下载直接写 package-{ver}.7z；差分/临时可能为 temp-*.7z —— 两者都要计入，否则进度条会卡在 stub 完成后的近 0%。
 */
function readLargestPackageBytes(pendingDir: string, version: string | null): number {
  const candidates: string[] = [];
  if (version) {
    candidates.push(path.join(pendingDir, `package-${version}.7z`));
    candidates.push(path.join(pendingDir, `temp-package-${version}.7z`));
  }
  try {
    for (const name of fs.readdirSync(pendingDir)) {
      if (!/\.7z$/i.test(name)) continue;
      // 包含 temp-*：主包下载过程中体积增长主要发生在这些文件上
      if (/^package-/i.test(name) || /^temp-.*\.7z$/i.test(name) || name.includes('.nsis.7z') || name.endsWith('.7z')) {
        candidates.push(path.join(pendingDir, name));
      }
    }
  } catch {
    /* ignore */
  }
  return candidates.reduce((max, p) => Math.max(max, statFileSize(p)), 0);
}

function resolveInstallerFileName(): string {
  const version = pendingUpdateVersion || getUpdaterInternals().updateInfoAndProvider?.info?.version || 'latest';
  const infoPath = getUpdaterInternals().updateInfoAndProvider?.info?.path;
  if (infoPath && /\.exe$/i.test(infoPath)) return path.basename(infoPath);
  return `Aixflow-Windows-Setup-${version}.exe`;
}

function buildProgressPayload(
  stubDone: number,
  stubTotal: number,
  packageDone: number,
  packageTotal: number,
  bytesPerSecond: number,
  phase: 'stub' | 'main-package' | 'full' | 'paused',
) {
  const safeStubTotal = Math.max(0, safeNumber(stubTotal));
  const safePackageTotal = Math.max(0, safeNumber(packageTotal));
  const combinedTotal = safeStubTotal + safePackageTotal;
  if (combinedTotal <= 0) return null;

  const safeStubDone = Math.min(Math.max(safeNumber(stubDone), 0), safeStubTotal || Number.POSITIVE_INFINITY);
  const safePackageDone = Math.min(Math.max(safeNumber(packageDone), 0), safePackageTotal || Number.POSITIVE_INFINITY);
  const clampedStubDone = safeStubTotal > 0 ? Math.min(safeStubDone, safeStubTotal) : 0;
  const clampedPackageDone = safePackageTotal > 0 ? Math.min(safePackageDone, safePackageTotal) : safePackageDone;
  const combinedTransferred = clampedStubDone + clampedPackageDone;
  const speed = Math.max(0, safeNumber(bytesPerSecond));
  const remaining = Math.max(0, combinedTotal - combinedTransferred);
  const etaSeconds = speed > 0 ? remaining / speed : null;

  const stubPercent = safeStubTotal > 0 ? Math.min(100, (clampedStubDone / safeStubTotal) * 100) : 100;
  const packagePercent =
    safePackageTotal > 0 ? Math.min(100, (clampedPackageDone / safePackageTotal) * 100) : 0;
  const percent = Math.min(100, (combinedTransferred / combinedTotal) * 100);

  return {
    phase,
    percent: safeNumber(percent),
    stubPercent: safeNumber(stubPercent),
    packagePercent: safeNumber(packagePercent),
    transferred: combinedTransferred,
    total: combinedTotal,
    bytesPerSecond: speed,
    etaSeconds: etaSeconds == null ? null : safeNumber(etaSeconds),
    packageBytes: safePackageTotal,
    stubBytes: safeStubTotal,
    fileName: resolveInstallerFileName(),
    savePath: lastPendingDir || '',
    paused: phase === 'paused' || downloadPaused,
  };
}

function emitCombinedProgress(packageBytesDownloaded: number, bytesPerSecond?: number) {
  if (downloadCancelled) return;
  const stubTotal = stubBytesTotal;
  const packageTotal = pendingPackageBytes;
  const stubDone = Math.min(stubBytesTransferred, stubTotal > 0 ? stubTotal : stubBytesTransferred);
  const inMainPhase = packageBytesDownloaded > 0 || (stubTotal > 0 && stubDone >= stubTotal);
  const payload = buildProgressPayload(
    stubDone,
    stubTotal,
    packageBytesDownloaded,
    packageTotal,
    bytesPerSecond ?? pollBytesPerSecond,
    downloadPaused ? 'paused' : inMainPhase ? 'main-package' : 'stub',
  );
  if (payload) sendToRenderer('app:update-download-progress', payload);
}

function startPackagePoll() {
  if (packagePollTimer) return;
  if (pendingPackageBytes <= 0) return;

  lastPollTransferred = Math.min(stubBytesTransferred, stubBytesTotal || stubBytesTransferred);
  lastPollAt = Date.now();
  if (pollBytesPerSecond <= 0) pollBytesPerSecond = 0;

  packagePollTimer = setInterval(() => {
    if (downloadPaused || downloadCancelled) return;
    void (async () => {
      const pendingDir = await resolvePendingDir();
      if (!pendingDir) return;
      const packageBytesDownloaded = readLargestPackageBytes(pendingDir, pendingUpdateVersion);
      const combinedTransferred =
        Math.min(stubBytesTransferred, stubBytesTotal > 0 ? stubBytesTotal : stubBytesTransferred) +
        packageBytesDownloaded;
      const now = Date.now();
      const dt = now - lastPollAt;
      if (dt >= 200 && combinedTransferred >= lastPollTransferred) {
        const delta = combinedTransferred - lastPollTransferred;
        // 指数平滑，避免 ETA 跳动
        const instant = (delta / dt) * 1000;
        pollBytesPerSecond = pollBytesPerSecond > 0 ? pollBytesPerSecond * 0.7 + instant * 0.3 : instant;
        lastPollTransferred = combinedTransferred;
        lastPollAt = now;
      }
      emitCombinedProgress(packageBytesDownloaded);
    })();
  }, PACKAGE_POLL_MS);
}

function syncPendingVersionFromUpdater() {
  const version = getUpdaterInternals().updateInfoAndProvider?.info?.version;
  if (version) pendingUpdateVersion = version;
}

function resetDownloadRuntimeState() {
  stopPackagePoll();
  stubBytesTotal = 0;
  stubBytesTransferred = 0;
  pollBytesPerSecond = 0;
  lastPollTransferred = 0;
  lastPollAt = 0;
  downloadPaused = false;
  downloadCancelled = false;
  downloadCancellationToken = null;
}

function ensureUpdaterFeedAndListeners() {
  if (feedAndListenersReady) return;
  if (!app.isPackaged) return;
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;

  feedAndListenersReady = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.disableDifferentialDownload = true;
  /** nsis-web：按 latest.yml 的 packages 下载 *.nsis.7z，与 OSS 上传及在线安装器一致 */
  autoUpdater.disableWebInstaller = false;

  applyUpdaterFeed(activeReleaseFeedRegion);

  autoUpdater.on('download-progress', (info) => {
    if (downloadPaused || downloadCancelled) return;

    const total = safeNumber(info.total);
    const transferred = safeNumber(info.transferred);
    const bps = safeNumber(info.bytesPerSecond);
    const pct = safeNumber(info.percent);

    const stubPhase =
      pendingPackageBytes > total && total > 0 && total < NSIS_WEB_STUB_MAX_BYTES;

    if (stubPhase) {
      stubBytesTotal = total;
      stubBytesTransferred = transferred;
      const payload = buildProgressPayload(
        transferred,
        total,
        0,
        pendingPackageBytes,
        bps,
        'stub',
      );
      if (payload) sendToRenderer('app:update-download-progress', payload);

      if (pct >= 99 || (total > 0 && transferred >= total)) {
        stubBytesTransferred = total;
        startPackagePoll();
      }
      return;
    }

    // 主包（或非 web-installer 整包）：electron-updater 对全量 .7z 往往不带 onProgress，
    // 若偶发有事件且 total 接近主包体积，则按 stub 已完成 + 主包进度合并。
    if (pendingPackageBytes > 0 && total >= NSIS_WEB_STUB_MAX_BYTES) {
      if (stubBytesTotal <= 0) stubBytesTotal = 0;
      stubBytesTransferred = stubBytesTotal > 0 ? stubBytesTotal : stubBytesTransferred;
      const payload = buildProgressPayload(
        stubBytesTransferred,
        stubBytesTotal,
        transferred,
        Math.max(total, pendingPackageBytes),
        bps,
        'main-package',
      );
      if (payload) sendToRenderer('app:update-download-progress', payload);
      startPackagePoll();
      return;
    }

    const fullPayload = buildProgressPayload(0, 0, transferred, total, bps, 'full');
    if (fullPayload) {
      sendToRenderer('app:update-download-progress', fullPayload);
    } else {
      sendToRenderer('app:update-download-progress', {
        phase: 'full' as const,
        percent: pct,
        stubPercent: pct,
        packagePercent: pct,
        transferred,
        total,
        bytesPerSecond: bps,
        etaSeconds: bps > 0 && total > transferred ? (total - transferred) / bps : null,
        fileName: resolveInstallerFileName(),
        savePath: lastPendingDir || '',
        paused: false,
      });
    }
  });
  autoUpdater.on('update-available', (info) => {
    pendingPackageBytes = readPackageBytes(info);
    pendingUpdateVersion = info.version;
    sendToRenderer('app:update-available', { version: info.version, packageBytes: pendingPackageBytes });
  });
  autoUpdater.on('update-downloaded', () => {
    stopPackagePoll();
    downloadInFlight = false;
    if (pendingPackageBytes > 0 && stubBytesTotal > 0) {
      emitCombinedProgress(pendingPackageBytes, pollBytesPerSecond);
    }
    sendToRenderer('app:update-downloaded');
    void scheduleUpdateInstallAfterAppQuit();
  });
  autoUpdater.on('error', (err) => {
    stopPackagePoll();
    downloadInFlight = false;
    if (downloadCancelled) {
      downloadCancelled = false;
      return;
    }
    if (downloadPaused) {
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (/cancell?ed/i.test(msg)) return;
    console.error('[autoUpdater]', err);
    sendToRenderer('app:update-error', { message: msg });
  });
}

/**
 * 下载完成后：先落盘/关窗/杀子进程释放文件锁，再 quitAndInstall。
 *
 * 为何不能只用 autoInstallOnAppQuit + app.exit(0)：
 * electron-updater 在 quit 钩子里调用 install(true, false)，静默安装且不带 --force-run，
 * 安装结束后不会重启应用，用户体感就是「更新后闪退」。
 *
 * 为何仍先 prepare 再 quitAndInstall：
 * 若未关窗/未杀 ffmpeg 就拉起 NSIS，易触发「Aixflow 无法关闭」。
 * Windows 使用 quitAndInstall(true, true)=/S + --force-run。
 */
async function scheduleUpdateInstallAfterAppQuit(): Promise<void> {
  if (updateInstallScheduled) return;
  updateInstallScheduled = true;
  sendToRenderer('app:update-installing');
  try {
    await requestRendererPrepareForUpdate();
    await prepareForUpdateInstall();
    // 关窗后再装，降低文件锁冲突；true,true → 静默安装并强制安装后启动
    if (process.platform === 'win32') {
      autoUpdater.quitAndInstall(true, true);
    } else {
      autoUpdater.quitAndInstall();
    }
  } catch (e: unknown) {
    updateInstallScheduled = false;
    console.error('[autoUpdater] scheduleUpdateInstallAfterAppQuit:', e);
    const msg = e instanceof Error ? e.message : String(e);
    sendToRenderer('app:update-error', { message: msg });
  }
}

async function beginDownloadUpdate(): Promise<{ success: true } | { success: false; error: string }> {
  if (downloadInFlight && !downloadPaused) {
    return { success: true };
  }
  try {
    ensureUpdaterFeedAndListeners();
    syncPendingVersionFromUpdater();
    void resolvePendingDir();

    if (!downloadPaused) {
      stubBytesTotal = 0;
      stubBytesTransferred = 0;
      pollBytesPerSecond = 0;
      lastPollTransferred = 0;
      lastPollAt = 0;
    }
    downloadPaused = false;
    downloadCancelled = false;
    stopPackagePoll();

    // 关键因修复：原先 `pendingPackageBytes <= 0` 才 poll，导致已知主包体积时反而从不轮询；
    // 而 nsis-web 全量主包下载不带 onProgress，进度条会卡死在引导程序结束后的近 0%。
    if (pendingPackageBytes > 0) startPackagePoll();

    downloadCancellationToken = new CancellationToken();
    downloadInFlight = true;
    await withReleaseFeedFallback(() =>
      autoUpdater.downloadUpdate(downloadCancellationToken as never),
    );
    return { success: true };
  } catch (e: unknown) {
    downloadInFlight = false;
    stopPackagePoll();
    if (downloadCancelled) {
      return { success: false, error: 'cancelled' };
    }
    if (downloadPaused) {
      return { success: true };
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (/cancell?ed/i.test(msg)) {
      return { success: false, error: 'cancelled' };
    }
    console.warn('[autoUpdater] downloadUpdate:', msg);
    sendToRenderer('app:update-error', { message: msg });
    return { success: false, error: msg };
  }
}

export function registerAppUpdaterIpc() {
  ipcMain.handle('app:check-for-updates', async () => {
    const currentVersion = app.getVersion();
    if (!app.isPackaged) {
      return {
        updateAvailable: false,
        currentVersion,
        latestVersion: null,
        packageBytes: 0,
        error: null as string | null,
      };
    }
    if (process.platform !== 'win32' && process.platform !== 'darwin') {
      return {
        updateAvailable: false,
        currentVersion,
        latestVersion: null,
        packageBytes: 0,
        error: '当前平台暂不支持应用内更新',
      };
    }
    try {
      ensureUpdaterFeedAndListeners();
      const preferred = readStoredReleaseFeedRegion() ?? activeReleaseFeedRegion;
      applyUpdaterFeed(preferred);
      const result = await withReleaseFeedFallback(() => autoUpdater.checkForUpdates());
      if (result == null) {
        return {
          updateAvailable: false,
          currentVersion,
          latestVersion: null,
          packageBytes: 0,
          error: null as string | null,
        };
      }
      const latestVersion = result.updateInfo?.version ?? null;
      pendingPackageBytes = readPackageBytes(result.updateInfo);
      if (latestVersion) pendingUpdateVersion = latestVersion;
      return {
        updateAvailable: result.isUpdateAvailable,
        currentVersion,
        latestVersion,
        packageBytes: pendingPackageBytes,
        error: null as string | null,
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[autoUpdater] checkForUpdates:', msg);
      return { updateAvailable: false, currentVersion, latestVersion: null, packageBytes: 0, error: msg };
    }
  });

  ipcMain.handle('app:download-and-install-update', async () => {
    if (!app.isPackaged) {
      return { success: false as const, error: '开发模式下不支持安装更新包' };
    }
    if (process.platform !== 'win32' && process.platform !== 'darwin') {
      return { success: false as const, error: '当前平台暂不支持应用内更新' };
    }
    resetDownloadRuntimeState();
    return beginDownloadUpdate();
  });

  ipcMain.handle('app:pause-update-download', async () => {
    if (!downloadInFlight || downloadPaused) return { success: true as const, paused: true };
    downloadPaused = true;
    try {
      downloadCancellationToken?.cancel();
    } catch {
      /* ignore */
    }
    stopPackagePoll();
    const pendingDir = await resolvePendingDir();
    const packageDone = pendingDir ? readLargestPackageBytes(pendingDir, pendingUpdateVersion) : 0;
    const payload = buildProgressPayload(
      stubBytesTransferred,
      stubBytesTotal,
      packageDone,
      pendingPackageBytes,
      0,
      'paused',
    );
    if (payload) sendToRenderer('app:update-download-progress', payload);
    sendToRenderer('app:update-download-paused', { paused: true });
    return { success: true as const, paused: true };
  });

  ipcMain.handle('app:resume-update-download', async () => {
    if (!downloadPaused) return { success: true as const, paused: false };
    downloadPaused = false;
    sendToRenderer('app:update-download-paused', { paused: false });
    return beginDownloadUpdate();
  });

  ipcMain.handle('app:cancel-update-download', async () => {
    downloadCancelled = true;
    downloadPaused = false;
    downloadInFlight = false;
    try {
      downloadCancellationToken?.cancel();
    } catch {
      /* ignore */
    }
    stopPackagePoll();
    resetDownloadRuntimeState();
    sendToRenderer('app:update-download-cancelled');
    return { success: true as const };
  });

  ipcMain.handle('app:get-release-feed-region', async () => {
    const stored = readStoredReleaseFeedRegion();
    return {
      region: stored ?? activeReleaseFeedRegion,
      active: activeReleaseFeedRegion,
    };
  });

  ipcMain.handle('app:set-release-feed-region', async (_, regionRaw: 'cn' | 'hk') => {
    const region: ReleaseFeedRegion = regionRaw === 'hk' ? 'hk' : 'cn';
    persistReleaseFeedRegion(region);
    applyUpdaterFeed(region);
    return { ok: true as const, region };
  });
}
