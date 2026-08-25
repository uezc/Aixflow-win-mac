import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
} from 'electron';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { downloadFile } from './downloadFile.js';
import { resolveReleaseMeta, type ResolvedReleaseMeta } from './releaseFeed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_INSTALL_DIR =
  process.env.ProgramFiles
    ? path.join(process.env.ProgramFiles, 'Aixflow')
    : 'C:\\Program Files\\Aixflow';

type Phase =
  | 'idle'
  | 'resolving'
  | 'ready'
  | 'downloading'
  | 'installing'
  | 'done'
  | 'error'
  | 'cancelled';

let mainWindow: BrowserWindow | null = null;
let cachedMeta: ResolvedReleaseMeta | null = null;
let abortController: AbortController | null = null;
let paused = false;
let pauseResolve: (() => void) | null = null;
let workDir = '';
let currentPhase: Phase = 'idle';

function sendProgress(payload: Record<string, unknown>) {
  mainWindow?.webContents.send('gi:progress', payload);
}

function sendPhase(phase: Phase, error?: string) {
  currentPhase = phase;
  mainWindow?.webContents.send('gi:phase', { phase, error });
}

function normalizeInstallDir(raw: string): string {
  const t = String(raw || '')
    .trim()
    .replace(/\//g, '\\')
    .replace(/[\\\/]+$/, '');
  return t || DEFAULT_INSTALL_DIR;
}

function resolvePreloadPath(): string {
  const preloadJs = path.join(__dirname, '../preload/index.js');
  const preloadCjs = path.join(__dirname, '../preload/index.cjs');
  if (fs.existsSync(preloadJs)) return preloadJs;
  if (fs.existsSync(preloadCjs)) return preloadCjs;
  return preloadJs;
}

function createWindow() {
  const preloadPath = resolvePreloadPath();
  if (!fs.existsSync(preloadPath)) {
    console.error('[glass-installer] preload 不存在:', preloadPath);
  }

  mainWindow = new BrowserWindow({
    width: 936,
    height: 656,
    minWidth: 840,
    minHeight: 580,
    resizable: true,
    frame: false,
    transparent: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    title: 'Aixflow 安装程序',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    const port = process.env.VITE_GLASS_INSTALLER_PORT || '5288';
    void mainWindow.loadURL(`http://127.0.0.1:${port}/glass-installer.html`);
  } else {
    const htmlCandidates = [
      path.join(__dirname, '../renderer/glass-installer.html'),
      path.join(__dirname, '../renderer/index.html'),
    ];
    const html = htmlCandidates.find((p) => fs.existsSync(p)) || htmlCandidates[0];
    void mainWindow.loadFile(html);
  }

  mainWindow.webContents.on('preload-error', (_event, preloadPathFailed, error) => {
    console.error('[glass-installer] preload-error:', preloadPathFailed, error);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function waitIfPaused() {
  while (paused) {
    await new Promise<void>((resolve) => {
      pauseResolve = resolve;
    });
  }
}

async function downloadWithPause(opts: {
  url: string;
  destPath: string;
  knownSize: number;
  fileName: string;
  baseTransferred: number;
  grandTotal: number;
}) {
  const { url, destPath, knownSize, fileName, baseTransferred, grandTotal } = opts;
  // 简单续传循环：暂停时 abort，继续时 Range 续传
  for (;;) {
    await waitIfPaused();
    if (!abortController || abortController.signal.aborted) {
      throw new Error('cancelled');
    }
    const localAbort = new AbortController();
    const onParentAbort = () => localAbort.abort();
    abortController.signal.addEventListener('abort', onParentAbort);
    try {
      await downloadFile({
        url,
        destPath,
        knownSize,
        signal: localAbort.signal,
        onProgress: (p) => {
          const transferred = baseTransferred + p.transferred;
          const total = grandTotal > 0 ? grandTotal : baseTransferred + (p.total || knownSize);
          sendProgress({
            phase: 'download',
            transferred,
            total,
            percent: total > 0 ? Math.min(100, (transferred / total) * 100) : 0,
            bytesPerSecond: p.bytesPerSecond,
            etaSeconds: p.etaSeconds,
            fileName,
            savePath: workDir,
          });
        },
      });
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (paused || /aborted|cancell?ed/i.test(msg)) {
        if (abortController?.signal.aborted && !paused) throw new Error('cancelled');
        // paused: loop and resume
        continue;
      }
      throw e;
    } finally {
      abortController.signal.removeEventListener('abort', onParentAbort);
    }
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function psSingleQuote(s: string): string {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/** 去掉 Mark-of-the-Web，避免 Temp 下刚下载的 exe 被 CreateProcess 拒权 (EACCES) */
function unblockDownloadedExe(filePath: string) {
  try {
    fs.unlinkSync(`${filePath}:Zone.Identifier`);
  } catch {
    /* 无 ADS */
  }
  try {
    fs.chmodSync(filePath, 0o755);
  } catch {
    /* Windows 上常为 no-op */
  }
  try {
    spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Unblock-File -LiteralPath ${psSingleQuote(filePath)}`,
      ],
      { windowsHide: true, stdio: 'ignore', timeout: 15000 },
    );
  } catch {
    /* ignore */
  }
}

function isAccessDenied(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'EACCES' || code === 'EPERM') return true;
  const msg = err instanceof Error ? err.message : String(err || '');
  return /\bEACCES\b|\bEPERM\b|access is denied/i.test(msg);
}

/** 直接 spawn Setup；/D= 必须最后且不加引号（NSIS 约定） */
function spawnSetupOnce(
  setupExe: string,
  installDir: string,
  opts: { shell?: boolean } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['/S', `/D=${installDir}`];
    const child = spawn(setupExe, args, {
      cwd: path.dirname(setupExe),
      windowsHide: true,
      stdio: 'ignore',
      shell: opts.shell === true,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new Error(`安装程序退出码 ${code}`));
    });
  });
}

/** PowerShell Start-Process 回退（已提权时无需 -Verb RunAs） */
function runSetupViaPowerShell(setupExe: string, installDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cwd = path.dirname(setupExe);
    // ArgumentList 两项分开传，避免 /D= 路径被错误加引号
    const ps = [
      `$p = Start-Process -FilePath ${psSingleQuote(setupExe)} -ArgumentList @('/S', ${psSingleQuote(`/D=${installDir}`)}) -WorkingDirectory ${psSingleQuote(cwd)} -Wait -PassThru -WindowStyle Hidden`,
      `if ($null -eq $p) { exit 1 }`,
      `exit $p.ExitCode`,
    ].join('; ');
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { windowsHide: true, stdio: 'ignore' },
    );
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new Error(`安装程序退出码 ${code}`));
    });
  });
}

/**
 * 静默运行 NSIS stub。
 * Windows 上对 Temp 内刚下载完的 exe 直接 spawn 常会 EACCES（Defender 扫描锁 / MOTW）。
 * 策略：解锁 → 短重试 → shell:true → PowerShell Start-Process。
 */
async function runSilentNsis(setupExe: string, installDir: string): Promise<void> {
  if (!fs.existsSync(setupExe)) {
    throw new Error(`安装包不存在: ${setupExe}`);
  }

  const setupDir = path.dirname(setupExe);
  const setupBase = path.basename(setupExe).toLowerCase();
  try {
    for (const name of fs.readdirSync(setupDir)) {
      if (!/\.(exe|7z)$/i.test(name)) continue;
      // Setup 必解锁；主包仅去 Zone.Identifier（避免对 1.6GB 包跑完整 Unblock 流程过慢）
      const full = path.join(setupDir, name);
      if (name.toLowerCase() === setupBase) {
        unblockDownloadedExe(full);
      } else {
        try {
          fs.unlinkSync(`${full}:Zone.Identifier`);
        } catch {
          /* none */
        }
      }
    }
  } catch {
    unblockDownloadedExe(setupExe);
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(400 * attempt);
    try {
      await spawnSetupOnce(setupExe, installDir, { shell: false });
      return;
    } catch (e) {
      lastErr = e;
      if (!isAccessDenied(e)) throw e;
    }
  }

  try {
    await spawnSetupOnce(setupExe, installDir, { shell: true });
    return;
  } catch (e) {
    lastErr = e;
    if (!isAccessDenied(e)) throw e;
  }

  try {
    await runSetupViaPowerShell(setupExe, installDir);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    const prev = lastErr instanceof Error ? lastErr.message : String(lastErr || '');
    throw new Error(`无法启动安装程序（${prev || 'EACCES'}；回退亦失败: ${detail}）`);
  }
}

async function runInstallPipeline(installDir: string) {
  const meta = cachedMeta || (await resolveReleaseMeta());
  if (!meta) throw new Error('无法解析安装包元数据（请检查网络）');
  cachedMeta = meta;

  workDir = path.join(app.getPath('temp'), `aixflow-glass-install-${meta.version}`);
  fs.mkdirSync(workDir, { recursive: true });

  const stubPath = path.join(workDir, meta.stubName);
  const packagePath = path.join(workDir, meta.packageName);
  const stubKnown = 2 * 1024 * 1024;
  const pkgKnown = meta.packageBytes || 0;
  const grandTotal = stubKnown + pkgKnown;

  sendPhase('downloading');
  abortController = new AbortController();
  paused = false;

  // 先下小 stub，再下主包（进度合并）
  await downloadWithPause({
    url: meta.stubUrl,
    destPath: stubPath,
    knownSize: stubKnown,
    fileName: meta.stubName,
    baseTransferred: 0,
    grandTotal,
  });

  const stubSize = fs.existsSync(stubPath) ? fs.statSync(stubPath).size : stubKnown;
  await downloadWithPause({
    url: meta.packageUrl,
    destPath: packagePath,
    knownSize: pkgKnown,
    fileName: meta.packageName,
    baseTransferred: stubSize,
    grandTotal: pkgKnown > 0 ? stubSize + pkgKnown : 0,
  });

  if (abortController.signal.aborted) throw new Error('cancelled');

  sendPhase('installing');
  sendProgress({
    phase: 'install',
    transferred: grandTotal || stubSize + (fs.existsSync(packagePath) ? fs.statSync(packagePath).size : 0),
    total: grandTotal || 0,
    percent: 100,
    bytesPerSecond: 0,
    etaSeconds: 0,
    fileName: meta.stubName,
    savePath: workDir,
    message: '正在静默安装到所选目录…',
  });

  // 给 Defender 等完成对刚落盘文件的扫描锁一点时间，降低首轮 EACCES
  await sleep(800);
  await runSilentNsis(stubPath, installDir);

  const exePath = path.join(installDir, 'Aixflow.exe');
  if (!fs.existsSync(exePath)) {
    // 部分布局可能在子目录；宽松成功（NSIS 已 0 退出）
    console.warn('[glass-installer] Aixflow.exe 未立即出现于', exePath);
  }

  sendPhase('done');
}

function registerIpc() {
  ipcMain.handle('gi:get-default-install-dir', () => DEFAULT_INSTALL_DIR);

  ipcMain.handle('gi:pick-install-dir', async (_e, current?: string) => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: '选择 Aixflow 安装目录',
      defaultPath: normalizeInstallDir(current || DEFAULT_INSTALL_DIR),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return normalizeInstallDir(res.filePaths[0]);
  });

  ipcMain.handle('gi:resolve-meta', async (_e, regionRaw?: 'cn' | 'hk') => {
    sendPhase('resolving');
    try {
      const preferred = regionRaw === 'hk' || regionRaw === 'cn' ? regionRaw : undefined;
      const order: Array<'cn' | 'hk'> = preferred === 'hk' ? ['hk', 'cn'] : ['cn', 'hk'];
      const meta = await resolveReleaseMeta(order);
      if (!meta) {
        sendPhase('error', '无法获取安装包信息');
        return { ok: false as const, error: '无法获取安装包信息（北京/香港 Release 均不可用）' };
      }
      cachedMeta = meta;
      sendPhase('ready');
      return {
        ok: true as const,
        meta: {
          version: meta.version,
          stubName: meta.stubName,
          packageName: meta.packageName,
          packageBytes: meta.packageBytes,
          region: meta.region,
          feedBase: meta.feedBase,
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sendPhase('error', msg);
      return { ok: false as const, error: msg };
    }
  });

  ipcMain.handle('gi:start-install', async (_e, installDir: string) => {
    if (currentPhase === 'downloading' || currentPhase === 'installing') {
      return { ok: false as const, error: '安装已在进行中' };
    }
    const dir = normalizeInstallDir(installDir);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* NSIS 会创建；此处失败不阻断 */
    }
    try {
      await runInstallPipeline(dir);
      return { ok: true as const };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/cancell?ed/i.test(msg)) {
        sendPhase('cancelled');
        return { ok: false as const, error: '已取消' };
      }
      sendPhase('error', msg);
      return { ok: false as const, error: msg };
    } finally {
      abortController = null;
      paused = false;
    }
  });

  ipcMain.handle('gi:pause-download', async () => {
    if (currentPhase !== 'downloading') return;
    paused = true;
    abortController?.abort();
    abortController = new AbortController();
  });

  ipcMain.handle('gi:resume-download', async () => {
    if (!paused) return;
    paused = false;
    pauseResolve?.();
    pauseResolve = null;
  });

  ipcMain.handle('gi:cancel', async () => {
    paused = false;
    pauseResolve?.();
    pauseResolve = null;
    abortController?.abort();
    sendPhase('cancelled');
  });

  ipcMain.handle('gi:launch-app', async (_e, installDir: string) => {
    const dir = normalizeInstallDir(installDir);
    const exePath = path.join(dir, 'Aixflow.exe');
    if (!fs.existsSync(exePath)) {
      return { ok: false, error: `未找到 ${exePath}` };
    }
    const err = await shell.openPath(exePath);
    if (err) return { ok: false, error: err };
    return { ok: true };
  });

  ipcMain.handle('gi:open-external', async (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url);
  });

  ipcMain.handle('gi:quit', async () => {
    app.quit();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerIpc();
    createWindow();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
