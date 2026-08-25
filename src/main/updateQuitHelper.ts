import { execFile } from 'child_process';
import { promisify } from 'util';
import { BrowserWindow } from 'electron';

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
 * 应用内更新安装前准备：落盘钩子 / 关窗 / 结束子进程。
 * 不在此处 exit——应由调用方再执行 quitAndInstall(true, true)，
 * 以便静默安装仍带 --force-run，安装完成后自动拉起应用。
 *
 * 说明：仅依赖 autoInstallOnAppQuit + app.exit(0) 时，electron-updater
 * 会走 install(true, false)，NSIS 无 --force-run，表现为「更新后闪退/不再启动」。
 */
export async function prepareForUpdateInstall(): Promise<void> {
  if (beforeUpdateQuitHook) {
    await beforeUpdateQuitHook();
  }
  destroyAllApplicationWindows();
  await killBundledChildProcesses();
  await new Promise((r) => setTimeout(r, 400));
}
