import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';

let mainWindowGetter: (() => BrowserWindow | null) | null = null;

export function registerUpdatePrepareMainWindow(getter: () => BrowserWindow | null): void {
  mainWindowGetter = getter;
}

/** 通知渲染进程落盘，最多等待 timeoutMs */
export async function requestRendererPrepareForUpdate(timeoutMs = 12000): Promise<void> {
  const win = mainWindowGetter?.();
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      ipcMain.removeListener('app:prepare-for-update-done', onDone);
      resolve();
    }, timeoutMs);

    const onDone = () => {
      clearTimeout(timer);
      ipcMain.removeListener('app:prepare-for-update-done', onDone);
      resolve();
    };

    ipcMain.once('app:prepare-for-update-done', onDone);
    win.webContents.send('app:prepare-for-update');
  });
}
