/**
 * 应用内嵌浏览窗口：用独立 BrowserWindow 加载 https 外链（如飞书文档），
 * 登录态用 persist partition 保留；加载失败时 fallback 系统浏览器。
 */
import { BrowserWindow, shell, type BrowserWindowConstructorOptions } from 'electron';

let inAppBrowserWin: BrowserWindow | null = null;

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export type OpenInAppBrowserResult =
  | { ok: true; mode: 'in-app' | 'external' }
  | { ok: false; error: string };

export async function openInAppBrowser(
  urlRaw: string,
  opts?: { title?: string },
): Promise<OpenInAppBrowserResult> {
  const url = String(urlRaw ?? '').trim();
  if (!url) return { ok: false, error: 'URL_REQUIRED' };
  if (!isHttpUrl(url)) return { ok: false, error: 'UNSUPPORTED_URL_PROTOCOL' };

  const title = String(opts?.title ?? '').trim() || 'Aixflow';

  try {
    if (inAppBrowserWin && !inAppBrowserWin.isDestroyed()) {
      inAppBrowserWin.setTitle(title);
      await inAppBrowserWin.loadURL(url);
      if (inAppBrowserWin.isMinimized()) inAppBrowserWin.restore();
      inAppBrowserWin.show();
      inAppBrowserWin.focus();
      return { ok: true, mode: 'in-app' };
    }

    const winOpts: BrowserWindowConstructorOptions = {
      width: 1100,
      height: 800,
      minWidth: 640,
      minHeight: 480,
      title,
      show: false,
      autoHideMenuBar: true,
      skipTaskbar: true,
      backgroundColor: '#0b0b0c',
      webPreferences: {
        partition: 'persist:nexflow-in-app-browser',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    };

    const win = new BrowserWindow(winOpts);
    inAppBrowserWin = win;
    win.setMenuBarVisibility(false);
    win.removeMenu();

    win.webContents.setWindowOpenHandler(({ url: target }) => {
      if (!isHttpUrl(target)) {
        void shell.openExternal(target).catch(() => {});
        return { action: 'deny' };
      }
      // 飞书登录等会 window.open；允许同 partition 弹窗以保留登录态
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 960,
          height: 720,
          autoHideMenuBar: true,
          skipTaskbar: true,
          webPreferences: {
            partition: 'persist:nexflow-in-app-browser',
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    });

    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.show();
    });

    win.on('closed', () => {
      if (inAppBrowserWin === win) inAppBrowserWin = null;
    });

    await win.loadURL(url);
    return { ok: true, mode: 'in-app' };
  } catch (e) {
    console.error('[inAppBrowser] 应用内打开失败，改用系统浏览器:', e);
    try {
      await shell.openExternal(url);
      return { ok: true, mode: 'external' };
    } catch (e2) {
      return { ok: false, error: e2 instanceof Error ? e2.message : String(e2) };
    }
  }
}
