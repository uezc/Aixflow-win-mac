import {
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  screen,
  type IpcMainInvokeEvent,
} from 'electron';
import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { localResourceManager } from './services/localResourceManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SNIP_HTML = path.join(__dirname, 'snipOverlay.html');

let mainWindowRef: BrowserWindow | null = null;
/** 最近一次工作区工程 ID，供快捷键落盘；由渲染进程 sync */
let lastSnipProjectId: string | undefined;
let snipInProgress = false;

/** 当前截屏会话：每块屏幕一张图，与子窗口索引对应 */
let sessionImages: Map<number, Electron.NativeImage> = new Map();
let snipWindows: BrowserWindow[] = [];

function closeSnipWindows() {
  for (const w of snipWindows) {
    if (!w.isDestroyed()) w.close();
  }
  snipWindows = [];
  sessionImages = new Map();
  snipInProgress = false;
  broadcastSnipActive(false);
}

function isSnipOverlayWindow(win: BrowserWindow): boolean {
  return (win as unknown as { snipDisplayIndex?: number }).snipDisplayIndex !== undefined;
}

/** 主窗口引用丢失或已销毁时，从现有窗口中解析（排除截图覆盖层） */
function resolveSnipMainWindow(): BrowserWindow | null {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) return mainWindowRef;
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed() && !isSnipOverlayWindow(focused)) return focused;
  const others = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && !isSnipOverlayWindow(w));
  return others[0] ?? null;
}

function broadcastSnipActive(active: boolean) {
  const w = resolveSnipMainWindow();
  if (w && !w.isDestroyed()) w.webContents.send('screenshot:snip-active', { active });
}

/** Windows 上 display_id 常与 screen.Display.id 不一致，需多路回退 */
function hasUsableScreenThumbnail(sources: Electron.DesktopCapturerSource[]): boolean {
  return sources.some((s) => s.thumbnail && !s.thumbnail.isEmpty());
}

/** 部分显卡/缩放环境下过大 thumbnailSize 会得到空缩略图，依次降级重试 */
async function getScreenSourcesWithFallback(displays: Electron.Display[]): Promise<Electron.DesktopCapturerSource[]> {
  let maxTw = 0;
  let maxTh = 0;
  for (const d of displays) {
    const w = Math.min(4096, Math.max(1, Math.floor(d.size.width * d.scaleFactor)));
    const h = Math.min(4096, Math.max(1, Math.floor(d.size.height * d.scaleFactor)));
    maxTw = Math.max(maxTw, w);
    maxTh = Math.max(maxTh, h);
  }
  maxTw = Math.min(2048, maxTw);
  maxTh = Math.min(2048, maxTh);

  const trySizes = [
    { width: maxTw, height: maxTh },
    { width: Math.min(1920, maxTw), height: Math.min(1080, maxTh) },
    { width: 1280, height: 720 },
    { width: 800, height: 600 },
  ];
  const seen = new Set<string>();
  for (const sz of trySizes) {
    const key = `${sz.width}x${sz.height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: sz,
      fetchWindowIcons: false,
    });
    if (hasUsableScreenThumbnail(sources)) return sources;
  }
  return desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 800, height: 600 },
    fetchWindowIcons: false,
  });
}

function pickSourceForDisplay(
  display: Electron.Display,
  displayIndex: number,
  sources: Electron.DesktopCapturerSource[],
): Electron.DesktopCapturerSource | undefined {
  if (sources.length === 0) return undefined;
  const idStr = String(display.id);
  const byId = sources.find((s) => String(s.display_id) === idStr);
  if (byId?.thumbnail && !byId.thumbnail.isEmpty()) return byId;
  if (sources.length === 1) {
    const s = sources[0];
    return s?.thumbnail && !s.thumbnail.isEmpty() ? s : undefined;
  }
  const byIndex = sources[displayIndex];
  if (byIndex?.thumbnail && !byIndex.thumbnail.isEmpty()) return byIndex;
  const anyOk = sources.find((s) => s.thumbnail && !s.thumbnail.isEmpty());
  return anyOk ?? undefined;
}

async function beginSnipSession() {
  if (snipInProgress) {
    const alive = snipWindows.filter((w) => !w.isDestroyed());
    if (alive.length === 0) closeSnipWindows();
    else return;
  }

  const notifyWin = resolveSnipMainWindow();
  if (!notifyWin) {
    console.error('[screenSnip] 无法解析主窗口，截图未启动（请确认应用主窗口已打开）');
    dialog.showErrorBox('区域截图', '无法找到主窗口，请重启应用后再试。');
    return;
  }

  snipInProgress = true;
  const projectId = lastSnipProjectId;
  let setupOk = false;

  const sendSnipError = (message: string) => {
    const w = resolveSnipMainWindow();
    if (w && !w.isDestroyed()) w.webContents.send('screenshot:snip-error', { message });
    else dialog.showErrorBox('区域截图', message);
  };

  try {
    const displays = screen.getAllDisplays();
    if (displays.length === 0) {
      closeSnipWindows();
      return;
    }

    const sources = await getScreenSourcesWithFallback(displays);

    const preloadPath = path.join(__dirname, '../preload/snipOverlayPreload.js');
    if (!fs.existsSync(preloadPath)) {
      console.error('[screenSnip] snipOverlayPreload 缺失:', preloadPath, '请执行 npm run build:preload');
      closeSnipWindows();
      sendSnipError('截图模块 preload 未构建，请重新执行 npm run build:preload');
      return;
    }
    if (!fs.existsSync(SNIP_HTML)) {
      console.error('[screenSnip] snipOverlay.html 缺失:', SNIP_HTML, '请执行 npm run build:main');
      closeSnipWindows();
      sendSnipError('截图页面缺失，请重新执行 npm run build:main');
      return;
    }

    sessionImages = new Map();
    snipWindows = [];

    const sortedDisplays = [...displays].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);

    sortedDisplays.forEach((display, index) => {
      const src = pickSourceForDisplay(display, index, sources);
      if (!src?.thumbnail || src.thumbnail.isEmpty()) {
        console.warn('[screenSnip] 跳过显示器：无可用缩略图', { index, displayId: display.id, sourceIds: sources.map((s) => s.display_id) });
        return;
      }
      sessionImages.set(index, src.thumbnail);

      const win = new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        fullscreen: false,
        show: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        autoHideMenuBar: true,
        focusable: true,
        hasShadow: false,
        thickFrame: false,
        /** 允许进入全屏，便于在 show 后对 Windows 调用 setFullScreen，避免焦点切换时任务栏弹出 */
        fullscreenable: true,
        webPreferences: {
          preload: preloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          // 覆盖层仅加载本地 snipOverlay.html；部分 Windows 环境下 webSecurity 会阻碍 file+preload 组合
          webSecurity: false,
        },
      });
      (win as unknown as { snipDisplayIndex?: number }).snipDisplayIndex = index;
      snipWindows.push(win);

      win.setIgnoreMouseEvents(false);
      void win
        .loadFile(SNIP_HTML)
        .then(() => {
          if (!win.isDestroyed()) {
            win.show();
            // 主窗口全屏时，普通置顶窗获得焦点常会逼出 Windows 任务栏；对该显示器进入独占全屏可压住任务栏
            if (process.platform === 'win32') {
              win.setFullScreen(true);
              // 全屏后 Windows 常把窗口重新挂回 Alt+Tab，必须再藏一次
              win.setSkipTaskbar(true);
            }
            try {
              win.setAlwaysOnTop(true, 'screen-saver', 1);
            } catch {
              win.setAlwaysOnTop(true);
            }
            win.focus();
            win.moveTop();
          }
        })
        .catch((err) => {
          console.error('[screenSnip] loadFile 失败:', err);
          if (!win.isDestroyed()) win.close();
          queueMicrotask(() => {
            const alive = snipWindows.filter((sw) => !sw.isDestroyed());
            if (alive.length === 0) closeSnipWindows();
          });
        });
    });

    if (snipWindows.length === 0) {
      console.warn('[screenSnip] 无法获取屏幕缩略图（权限或源列表为空）');
      closeSnipWindows();
      sendSnipError('无法截取屏幕，请检查系统屏幕录制权限');
      return;
    }
    setupOk = true;
  } catch (e) {
    console.error('[screenSnip] beginSnipSession 失败:', e);
    closeSnipWindows();
    sendSnipError(e instanceof Error ? e.message : String(e));
    return;
  }

  if (!setupOk) {
    closeSnipWindows();
    return;
  }

  async function finishWithPng(png: Buffer) {
    try {
      const ab = new Uint8Array(png).buffer;
      const result = await localResourceManager.createImageResourceFromBuffer(
        projectId,
        `screenshot-${Date.now()}.png`,
        ab,
      );
      closeSnipWindows();
      const target = resolveSnipMainWindow();
      if (target && !target.isDestroyed()) {
        target.webContents.send('screenshot:import-to-canvas', result);
        target.focus();
      }
    } catch (err) {
      console.error('[screenSnip] 保存截图失败:', err);
      closeSnipWindows();
      const w = resolveSnipMainWindow();
      if (w && !w.isDestroyed()) {
        w.webContents.send('screenshot:snip-error', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const cleanupSnipIpc = () => {
    ipcMain.removeListener('snip-overlay:submit', onSubmit);
    ipcMain.removeListener('snip-overlay:cancel', onCancel);
  };

  const onSubmit = (_: Electron.IpcMainEvent, rect: { x: number; y: number; width: number; height: number }) => {
    const win = BrowserWindow.getFocusedWindow() || snipWindows[0];
    const idx = win ? (win as unknown as { snipDisplayIndex?: number }).snipDisplayIndex ?? 0 : 0;
    const native = sessionImages.get(idx);
    if (!native || native.isEmpty() || !rect || rect.width < 2 || rect.height < 2) {
      cleanupSnipIpc();
      closeSnipWindows();
      return;
    }
    cleanupSnipIpc();
    try {
      const size = native.getSize();
      const x = Math.max(0, Math.min(size.width - 1, Math.floor(rect.x)));
      const y = Math.max(0, Math.min(size.height - 1, Math.floor(rect.y)));
      const w = Math.max(1, Math.min(size.width - x, Math.floor(rect.width)));
      const h = Math.max(1, Math.min(size.height - y, Math.floor(rect.height)));
      const cropped = native.crop({ x, y, width: w, height: h });
      const png = cropped.toPNG();
      void finishWithPng(png);
    } catch (err) {
      console.error('[screenSnip] crop 失败:', err);
      closeSnipWindows();
    }
  };

  const onCancel = () => {
    cleanupSnipIpc();
    closeSnipWindows();
  };

  ipcMain.removeAllListeners('snip-overlay:submit');
  ipcMain.removeAllListeners('snip-overlay:cancel');
  ipcMain.on('snip-overlay:submit', onSubmit);
  ipcMain.on('snip-overlay:cancel', onCancel);

  broadcastSnipActive(true);
}

export function setMainWindowForSnip(win: BrowserWindow | null) {
  mainWindowRef = win;
}

function safeRegisterHandler(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: any[]) => unknown,
) {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, handler);
}

export function initScreenSnip() {
  safeRegisterHandler('snip-overlay:get-frame', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const idx = win ? (win as unknown as { snipDisplayIndex?: number }).snipDisplayIndex ?? 0 : 0;
    const img = sessionImages.get(idx);
    if (!img || img.isEmpty()) return null;
    const sz = img.getSize();
    // 覆盖层不绘制整屏位图，只返回尺寸用于坐标映射；实际裁切仍用内存中的 NativeImage
    return {
      imgW: sz.width,
      imgH: sz.height,
    };
  });

  safeRegisterHandler('screenshot:sync-project', (_, projectId?: string) => {
    lastSnipProjectId = projectId?.trim() || undefined;
    return { ok: true };
  });

  /** 兼容旧版：仅同步工程 ID，不再使用「武装」概念 */
  safeRegisterHandler('screenshot:set-armed', (_, _armed: boolean, projectId?: string) => {
    if (projectId?.trim()) lastSnipProjectId = projectId.trim();
    return { ok: true, armed: false };
  });

  safeRegisterHandler('screenshot:start-snip', (_, projectId?: string) => {
    if (projectId?.trim()) lastSnipProjectId = projectId.trim();
    void beginSnipSession();
    return { ok: true as const };
  });

  const onSnipShortcut = () => {
    void beginSnipSession();
  };
  try {
    globalShortcut.unregister('Alt+1');
  } catch {
    /* ignore */
  }
  try {
    globalShortcut.unregister('Alt+num1');
  } catch {
    /* ignore */
  }
  try {
    globalShortcut.unregister('Alt+Shift+S');
  } catch {
    /* ignore */
  }
  try {
    globalShortcut.unregister('CommandOrControl+Shift+Y');
  } catch {
    /* ignore */
  }
  const reg1 = globalShortcut.register('Alt+1', onSnipShortcut);
  let regNum = false;
  try {
    regNum = globalShortcut.register('Alt+num1', onSnipShortcut);
  } catch {
    /* 部分平台无 num1 加速器名称 */
  }
  const regAltShiftS = globalShortcut.register('Alt+Shift+S', onSnipShortcut);
  const regCtrlShiftY = globalShortcut.register('CommandOrControl+Shift+Y', onSnipShortcut);
  if (!reg1 && !regNum && !regAltShiftS && !regCtrlShiftY) {
    console.warn('[screenSnip] 全局快捷键均未注册成功，请使用工具栏相机开始截图（Ctrl+Shift+Y / Alt+Shift+S / Alt+1）');
  } else if (!reg1 && !regNum && regAltShiftS) {
    console.warn('[screenSnip] Alt+1 未注册（可能被系统占用），已启用 Alt+Shift+S 与 Ctrl+Shift+Y 作为区域截图快捷键');
  }
}
