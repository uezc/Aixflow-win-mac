import { execFile } from 'child_process';
import { promisify } from 'util';
import { app, BrowserWindow } from 'electron';

const execFileAsync = promisify(execFile);

let beforeUpdateQuitHook: (() => void | Promise<void>) | null = null;

export function registerBeforeUpdateQuitHook(fn: () => void | Promise<void>): void {
  beforeUpdateQuitHook = fn;
}

async function runTaskkill(args: string[]): Promise<void> {
  if (process.platform !== 'win32') return;
  try {
    await execFileAsync('taskkill', args, { windowsHide: true });
  } catch {
    /* 进程不存在或已退出 */
  }
}

/** 结束可能占用安装目录文件锁的 bundled 子进程（不结束当前 Aixflow 主进程） */
export async function killBundledChildProcesses(): Promise<void> {
  if (process.platform !== 'win32') return;
  await runTaskkill(['/F', '/IM', 'ffmpeg.exe', '/T']);
  await runTaskkill(['/F', '/IM', 'yt-dlp.exe', '/T']);
  await runTaskkill(['/F', '/IM', 'whisper.exe', '/T']);
}

export function destroyAllApplicationWindows(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.removeAllListeners('close');
      win.destroy();
    }
  }
}

/**
 * 应用内更新：先落盘/关窗/结束子进程，再 app.exit(0)。
 * 安装包由 electron-updater 的 autoInstallOnAppQuit 在进程退出时拉起（避免 quitAndInstall 先启安装器再退出导致「无法关闭」）。
 */
export async function prepareAndExitForUpdate(): Promise<void> {
  if (beforeUpdateQuitHook) {
    await beforeUpdateQuitHook();
  }
  destroyAllApplicationWindows();
  await killBundledChildProcesses();
  await new Promise((r) => setTimeout(r, 400));
  app.exit(0);
}
