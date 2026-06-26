import fs from 'fs';
import path from 'path';
import { BrowserWindow, ipcMain, app } from 'electron';
/** electron-updater 为 CJS；打包后主进程为 ESM 时不能用 `import { autoUpdater }`，须默认导入再解构 */
import electronUpdater from 'electron-updater';
import { getUpdaterFeedUrlForRegion, type ReleaseFeedRegion } from './config/ossConfig.js';
import { prepareAndExitForUpdate } from './updateQuitHelper.js';
import { requestRendererPrepareForUpdate } from './updatePrepareIpc.js';

const { autoUpdater } = electronUpdater;

/** electron-updater 内部 API，类型定义未导出，运行时可用 */
type UpdaterInternals = {
  getOrCreateDownloadHelper?: () => Promise<{ cacheDirForPendingUpdate: string }>;
  updateInfoAndProvider?: { info?: { version?: string } };
};

function getUpdaterInternals(): UpdaterInternals {
  return autoUpdater as unknown as UpdaterInternals;
}

let mainWindowRef: BrowserWindow | null = null;
let feedAndListenersReady = false;
/** 当前 autoUpdater generic feed 区域：大陆默认 cn，失败可回退 hk */
let activeReleaseFeedRegion: ReleaseFeedRegion = resolveInitialReleaseFeedRegion();

function resolveInitialReleaseFeedRegion(): ReleaseFeedRegion {
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

function applyUpdaterFeed(region: ReleaseFeedRegion): void {
  activeReleaseFeedRegion = region;
  const platform = process.platform === 'darwin' ? 'darwin' : 'win32';
  const url = getUpdaterFeedUrlForRegion(region, platform);
  autoUpdater.setFeedURL({ provider: 'generic', url });
  console.log(`[autoUpdater] Release feed → ${region}: ${url}`);
}

/** 大陆用户：北京 feed 失败时回退香港（海外用户默认 hk，不回退 cn） */
async function withReleaseFeedFallback<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (activeReleaseFeedRegion !== 'cn') throw err;
    console.warn('[autoUpdater] 北京 Release feed 失败，回退香港 feed', err);
    applyUpdaterFeed('hk');
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

function readPackageBytes(info: unknown): number {
  if (!info || typeof info !== 'object') return 0;
  const packages = (info as { packages?: Record<string, { size?: number }> }).packages;
  if (!packages) return 0;
  return Number(packages.x64?.size ?? packages['x64']?.size ?? 0) || 0;
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
      if (helper?.cacheDirForPendingUpdate) return helper.cacheDirForPendingUpdate;
    }
  } catch {
    /* ignore */
  }
  const localAppData = process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local');
  for (const dirName of [`${app.getName()}-updater`, 'nexflow-updater', 'Aixflow-updater']) {
    const pending = path.join(localAppData, dirName, 'pending');
    if (fs.existsSync(pending)) return pending;
  }
  return path.join(localAppData, `${app.getName()}-updater`, 'pending');
}

function statFileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function readLargestPackageBytes(pendingDir: string, version: string | null): number {
  const candidates: string[] = [];
  if (version) {
    candidates.push(path.join(pendingDir, `package-${version}.7z`));
  }
  try {
    for (const name of fs.readdirSync(pendingDir)) {
      if (name.endsWith('.7z') && !name.startsWith('temp-')) {
        candidates.push(path.join(pendingDir, name));
      }
    }
  } catch {
    /* ignore */
  }
  return candidates.reduce((max, p) => Math.max(max, statFileSize(p)), 0);
}

function buildProgressPayload(
  stubDone: number,
  stubTotal: number,
  packageDone: number,
  packageTotal: number,
  bytesPerSecond: number,
  phase: 'stub' | 'main-package' | 'full',
) {
  const combinedTotal = stubTotal + packageTotal;
  if (combinedTotal <= 0) return null;
  const safeStubDone = Math.min(Math.max(stubDone, 0), stubTotal);
  const safePackageDone = Math.min(Math.max(packageDone, 0), packageTotal);
  const combinedTransferred = safeStubDone + safePackageDone;
  const stubPercent = stubTotal > 0 ? Math.min(100, (safeStubDone / stubTotal) * 100) : 100;
  const packagePercent = packageTotal > 0 ? Math.min(100, (safePackageDone / packageTotal) * 100) : 0;
  return {
    phase,
    percent: Math.min(100, (combinedTransferred / combinedTotal) * 100),
    stubPercent,
    packagePercent,
    transferred: combinedTransferred,
    total: combinedTotal,
    bytesPerSecond,
    packageBytes: packageTotal,
    stubBytes: stubTotal,
  };
}

function emitCombinedProgress(packageBytesDownloaded: number, bytesPerSecond?: number) {
  const stubTotal = stubBytesTotal;
  const packageTotal = pendingPackageBytes;
  const stubDone = Math.min(stubBytesTransferred, stubTotal);
  const inMainPhase = packageBytesDownloaded > 0 || (stubTotal > 0 && stubDone >= stubTotal);
  const payload = buildProgressPayload(
    stubDone,
    stubTotal,
    packageBytesDownloaded,
    packageTotal,
    bytesPerSecond ?? pollBytesPerSecond,
    inMainPhase ? 'main-package' : 'stub',
  );
  if (payload) sendToRenderer('app:update-download-progress', payload);
}

function startPackagePoll() {
  if (packagePollTimer || pendingPackageBytes <= 0) return;
  lastPollTransferred = stubBytesTransferred;
  lastPollAt = Date.now();
  pollBytesPerSecond = 0;

  packagePollTimer = setInterval(() => {
    void (async () => {
      const pendingDir = await resolvePendingDir();
      if (!pendingDir) return;
      const packageBytesDownloaded = readLargestPackageBytes(pendingDir, pendingUpdateVersion);
      const combinedTransferred = Math.min(stubBytesTransferred, stubBytesTotal) + packageBytesDownloaded;
      const now = Date.now();
      if (now > lastPollAt && combinedTransferred >= lastPollTransferred) {
        pollBytesPerSecond = ((combinedTransferred - lastPollTransferred) / (now - lastPollAt)) * 1000;
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
    const stubPhase =
      pendingPackageBytes > info.total && info.total > 0 && info.total < NSIS_WEB_STUB_MAX_BYTES;

    if (stubPhase) {
      stubBytesTotal = info.total;
      stubBytesTransferred = info.transferred;
      const payload = buildProgressPayload(
        info.transferred,
        info.total,
        0,
        pendingPackageBytes,
        info.bytesPerSecond,
        'stub',
      );
      if (payload) sendToRenderer('app:update-download-progress', payload);

      if (info.percent >= 99) {
        stubBytesTransferred = info.total;
        startPackagePoll();
      }
      return;
    }

    const fullPayload = buildProgressPayload(0, 0, info.transferred, info.total, info.bytesPerSecond, 'full');
    if (fullPayload) {
      sendToRenderer('app:update-download-progress', fullPayload);
    } else {
      sendToRenderer('app:update-download-progress', {
        phase: 'full' as const,
        percent: info.percent,
        stubPercent: info.percent,
        packagePercent: info.percent,
        transferred: info.transferred,
        total: info.total,
        bytesPerSecond: info.bytesPerSecond,
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
    if (pendingPackageBytes > 0 && stubBytesTotal > 0) {
      emitCombinedProgress(pendingPackageBytes, pollBytesPerSecond);
    }
    sendToRenderer('app:update-downloaded');
    void scheduleUpdateInstallAfterAppQuit();
  });
  autoUpdater.on('error', (err) => {
    stopPackagePoll();
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[autoUpdater]', err);
    sendToRenderer('app:update-error', { message: msg });
  });
}

/** 下载完成后先退出应用，再由 autoInstallOnAppQuit 拉起安装器（避免 quitAndInstall 先启安装器导致「Aixflow 无法关闭」） */
async function scheduleUpdateInstallAfterAppQuit(): Promise<void> {
  if (updateInstallScheduled) return;
  updateInstallScheduled = true;
  sendToRenderer('app:update-installing');
  try {
    await requestRendererPrepareForUpdate();
    await prepareAndExitForUpdate();
  } catch (e: unknown) {
    updateInstallScheduled = false;
    console.error('[autoUpdater] scheduleUpdateInstallAfterAppQuit:', e);
    const msg = e instanceof Error ? e.message : String(e);
    sendToRenderer('app:update-error', { message: msg });
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
    try {
      ensureUpdaterFeedAndListeners();
      syncPendingVersionFromUpdater();
      stubBytesTotal = 0;
      stubBytesTransferred = 0;
      pollBytesPerSecond = 0;
      stopPackagePoll();
      if (pendingPackageBytes <= 0) startPackagePoll();

      await withReleaseFeedFallback(() => autoUpdater.downloadUpdate());
      return { success: true as const };
    } catch (e: unknown) {
      stopPackagePoll();
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[autoUpdater] downloadUpdate:', msg);
      sendToRenderer('app:update-error', { message: msg });
      return { success: false as const, error: msg };
    }
  });
}
