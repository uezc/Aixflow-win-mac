// 必须在所有其他导入之前加载环境变量（含安装包 resources/.env；勿改用仅 cwd 的 dotenv/config）
import './envLoader.js';

/** GUI 启动无终端时 stdout/stderr 管道关闭，console.log 会 EPIPE/EOF 崩溃（笔记本双击启动尤甚） */
function isBrokenPipeError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === 'EPIPE' || code === 'EOF' || code === 'ECONNRESET';
}
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (isBrokenPipeError(err)) return;
    throw err;
  });
}
for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  const original = console[method].bind(console);
  console[method] = (...args: unknown[]) => {
    try {
      original(...args);
    } catch (err) {
      if (!isBrokenPipeError(err)) throw err;
    }
  };
}

process.on('uncaughtException', (err) => {
  if (isBrokenPipeError(err) || /write EOF/i.test(String((err as Error)?.message || ''))) {
    console.error('[main] ignored broken pipe (stdio/ffmpeg already closed)', err);
    return;
  }
  console.error('[main] uncaughtException', err);
  try {
    dialog.showErrorBox(
      'A JavaScript error occurred in the main process',
      String((err as Error)?.stack || err),
    );
  } catch {
    /* ignore */
  }
});

import { app, BrowserWindow, ipcMain, dialog, shell, protocol, clipboard, nativeImage, session } from 'electron';

// V8 堆上限已在 envLoader（首个 import）里 appendSwitch js-flags

import path from 'path';
import crypto, { randomUUID } from 'node:crypto';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname } from 'path';
import http from 'http';
import fs from 'fs';
import axios from 'axios';
import FormData from 'form-data';
import express from 'express';
import AdmZip from 'adm-zip';
import { store } from './services/store.js';

/**
 * Node Readable.toWeb 在 end+close 双事件时会二次 close controller，触发
 * ERR_INVALID_STATE（视频 Range 预览时尤甚）。此处自行桥接并吞掉重复 close。
 */
function fsReadStreamToWebBody(fileStream: fs.ReadStream): ReadableStream<Uint8Array> {
  let closed = false;
  const safeClose = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (closed) return;
    closed = true;
    try {
      controller.close();
    } catch {
      /* already closed */
    }
  };
  const safeError = (controller: ReadableStreamDefaultController<Uint8Array>, err: Error) => {
    if (closed) return;
    closed = true;
    try {
      controller.error(err);
    } catch {
      /* already closed */
    }
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      // 仅用 end 关闭 controller；close 在 abort/destroy 且未 end 时兜底，且必须幂等
      fileStream.pause();
      fileStream.on('data', (chunk: string | Buffer) => {
        if (closed) return;
        try {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          // 拷贝一份，避免底层 Buffer pool 被复用后污染已入队数据
          controller.enqueue(new Uint8Array(buf));
          if (controller.desiredSize !== null && controller.desiredSize <= 0) {
            fileStream.pause();
          }
        } catch {
          closed = true;
          try {
            fileStream.destroy();
          } catch {
            /* ignore */
          }
        }
      });
      fileStream.once('end', () => safeClose(controller));
      fileStream.once('close', () => {
        // destroy()/abort 可能不触发 end，仍需结束 web stream
        if (!closed) safeClose(controller);
      });
      fileStream.on('error', (err) => safeError(controller, err instanceof Error ? err : new Error(String(err))));
    },
    pull() {
      if (!closed) fileStream.resume();
    },
    cancel() {
      closed = true;
      try {
        fileStream.destroy();
      } catch {
        /* ignore */
      }
    },
  });
}
import {
  buildDefaultSavePath,
  fileNameFromUrl,
  parseDataUrl,
  pickSavePath,
  saveFiltersForExt,
  saveFiltersForVideo,
  saveFiltersForAudio,
  resolveAudioSaveDefaults,
} from './utils/assetDownloadDialog.js';
import { importDefaultAssetLibraryIfNeeded, repairAssetLibraryInStore } from './utils/defaultAssetLibrary.js';
import {
  importDefaultDigitalHumanLibraryIfNeeded,
  repairDigitalHumanLibraryInStore,
} from './utils/defaultDigitalHumanLibrary.js';
import {
  saveProjectGraphDurable,
  loadProjectGraphDurable,
  resolveBestProjectGraph,
  atomicWriteText,
  writeRollingBackup,
  listProjectBackupSummaries,
  archiveGraphToLost,
  readProjectGraphFile,
  graphScore,
  enqueueProjectSave,
} from './utils/projectDataDurability.js';
import {
  clearSessionBeijingFcProxyUpload,
  ensureOssUploadRouteProbed,
  applyMediaOssRegion,
  getStoredMediaOssRegion,
  getActiveMediaOssRegion,
  getEffectiveDualRegion,
  mediaOssRegionToFcRoute,
} from './services/ossUploadSession.js';
import { getBLTCYBalance, getRHBalance } from './services/balance.js';
import {
  activateLicense,
  checkLicenseStatus,
  generateActivationCode,
  isActivationSkipped,
} from './services/licenseManager.js';
import { runMattingViaFc } from './services/matting.js';
import {
  runWatermarkRemovalViaFc,
  runVideoWatermarkRemovalViaFc,
  runVideoDepthConvertViaFc,
  runVideoSubtitleWatermarkRemovalViaFc,
} from './services/watermarkRemoval.js';
import { runImageUpscaleV3ViaFc } from './services/imageUpscaleV3.js';
import {
  runCharacterMultiAngleViaFc,
  runImageTo3dModelViaFc,
} from './services/runningHubAiAppFc.js';
import { resolveImageTo3dModelId } from '../shared/imageTo3dModels.js';
import {
  clearNxAuth,
  getCloudUserState,
  getNxAccessToken,
  getNxLastLoginEmail,
  initCloudUser,
  isNxSaasMode,
  nxAdminDashboardStats,
  nxAdminFailedTasks,
  nxAdminGetAllUsers,
  nxAdminIssueCoupon,
  nxAdminModelConfigList,
  nxAdminModelConfigUpsert,
  nxAdminProfitAnalytics,
  nxAdminRefundTask,
  nxCloudChangePassword,
  nxCloudFetchModelConfig,
  nxCloudGetProfile,
  nxCloudGetTasks,
  nxCloudGetTransactions,
  nxCloudLogin,
  nxCloudLoginWithCode,
  nxCloudRecharge,
  nxCloudRedeemCoupon,
  nxCloudRegister,
  nxCloudSendAuthCode,
  nxCloudTaskStatus,
} from './services/aliyunService.js';
import {
  getAliyunFcInitUserUrl,
  getBeijingFcEndpoint,
  getHongKongFcEndpoint,
  NX_ENABLE_DIRECT_RECHARGE,
} from './config/aliyunConfig.js';
import {
  applyNxFcRoute,
  applyStartupFcRoute,
  ensureFcRouteForCanvas,
  ensureFcRouteForPayment,
  getStoredNxFcRoute,
  shouldAutoFailoverFcError,
} from './services/nxFcRouteManager.js';
import { getOssRouteChannel } from './config/ossConfig.js';
import { registerAppUpdaterIpc, setAppUpdaterMainWindow } from './appUpdater.js';
import { registerBeforeUpdateQuitHook } from './updateQuitHelper.js';
import { registerUpdatePrepareMainWindow } from './updatePrepareIpc.js';
import { setCloudBalanceNotifier } from './cloudBalanceNotifier.js';
import { resolveWeChatGroupQrFromOss } from './services/wechatGroupQr.js';
import { listTutorialVideosFromOss } from './services/tutorialVideos.js';
import {
  asrRealtimeCancel,
  asrRealtimeSendAudio,
  asrRealtimeStart,
  asrRealtimeStop,
} from './services/dashscopeRealtimeAsr.js';
import {
  transcribeSpeechSegmentsViaFunAsr,
  transcribeSpeechViaFunAsr,
} from './services/dashscopeFileAsr.js';
import {
  burnKaraokeSubtitlesToProject,
  detectChineseKaraokeFont,
  exportKaraokeAssFile,
  previewWriteKaraokeAss,
} from './services/karaokeBurn.js';
import {
  abortKaraokePreviewComposeSession,
  beginKaraokePreviewCompose,
  finalizeKaraokePreviewCompose,
  writeKaraokePreviewComposeFrame,
} from './services/karaokePreviewCompose.js';
import {
  burnKaraokeWithCssPreview,
  cancelAllKaraokeComposeJobs,
  type KaraokeCssBurnProgress,
} from './services/karaokeCssBurn.js';
import type { KaraokeProject } from '../shared/karaoke/types.js';
import {
  finalizeMicRecording,
  getMediaDuration,
  getSharpQueueStats,
  localResourceManager,
  cancelActiveAudioTranscribeJobs,
  setSharpQueuePaused,
} from './services/localResourceManager.js';
import { initScreenSnip, setMainWindowForSnip } from './screenSnip.js';
import { openInAppBrowser } from './inAppBrowser.js';
import { aiCore } from './ai/AICore.js';
import { registerProvider } from './ai/Registry.js';
import { loadMinimaxH3PromptWritingBundle } from './utils/minimaxH3SkillGuide.js';
import { ChatProvider } from './ai/providers/ChatProvider.js';
import { ImageProvider } from './ai/providers/ImageProvider.js';
import { VideoProvider } from './ai/providers/VideoProvider.js';
import { VideoAnalysisProvider } from './ai/providers/VideoAnalysisProvider.js';
import { createAliOssClient } from './utils/ossTimeSkew.js';
import { AudioProvider } from './ai/providers/AudioProvider.js';
import { migrateProjectFolders, migrateNameBasedFoldersToIdBased, migrateProjectsFromUserDataToAppDir, removeOrphanedProjects, getProjectFolderPath, getProjectOriginalFolderPath, getProjectsBasePath, getProjectFolderPathSync, sanitizeProjectName, isLocalResourcePathAllowed } from './utils/projectFolderHelper.js';
import { sortProjectsByCreatedAtDesc, reorderProjectsByIds, type ProjectListRecord } from './utils/projectsSort.js';
import { getAverageDuration, recordTaskHistory, TaskType } from './services/taskHistory.js';
import {
  applyHardwareAccelerationPolicy,
  disableHardwareAccelerationAfterBlackScreen,
  hardwareAccelerationActive,
  isExperimentalHardwareAccelerationEnabled,
  markHardwareAccelerationSessionOk,
  setExperimentalHardwareAccelerationEnabled,
} from './utils/hardwareAccelerationPref.js';

/** 与 vite.config 默认一致；Windows 上 5173 可能落入保留段导致 listen EACCES */
const VITE_DEV_SERVER_PORT = Number(process.env.VITE_DEV_SERVER_PORT) || 5274;
// 用 127.0.0.1 而非 localhost：Windows 上 localhost 可能解析成 IPv6 ::1，而 Vite 只监听 IPv4 127.0.0.1，导致主进程连不上（整窗黑屏）
const VITE_DEV_SERVER_ORIGIN = `http://127.0.0.1:${VITE_DEV_SERVER_PORT}`;

applyHardwareAccelerationPolicy();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let statsServer: http.Server | null = null;
/** 仅在有 did-finish-load 后为 true，避免向未就绪的渲染进程发送消息触发 WidgetHost 报错 */
let rendererReady = false;
/** 启动参数或二次启动传入的 .aixflow/.nexflow，待渲染进程就绪后导入 */
let pendingOpenProjectPath: string | null = null;

const SNIP_OVERLAY_WINDOW_TITLE = '截图';

function isSnipOverlayBrowserWindow(win: BrowserWindow): boolean {
  if (win.isDestroyed()) return false;
  return win.getTitle() === SNIP_OVERLAY_WINDOW_TITLE;
}

function isInAppBrowserSession(win: BrowserWindow): boolean {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return false;
  try {
    return win.webContents.session === session.fromPartition('persist:nexflow-in-app-browser');
  } catch {
    return false;
  }
}

/** 同页克隆：window.open / target=_blank 若落到 Vite 或 index.html，会再开一整份导演台 */
function isAppRendererUrl(url: string): boolean {
  const u = String(url || '').trim();
  if (!u) return false;
  if (u.startsWith(VITE_DEV_SERVER_ORIGIN)) return true;
  if (/[/\\]dist[/\\]index\.html/i.test(u)) return true;
  if (u.startsWith('data:text/html') && /Aixflow/i.test(u)) return true;
  return false;
}

function hideNonMainWindowFromTaskSwitch(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  if (mainWindow && win === mainWindow) return;
  try {
    win.setSkipTaskbar(true);
  } catch {
    /* ignore */
  }
}

function closeDuplicateAppWindows(except?: BrowserWindow | null): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win === except) continue;
    if (mainWindow && win === mainWindow) continue;
    if (isSnipOverlayBrowserWindow(win) || isInAppBrowserSession(win)) continue;
    let url = '';
    try {
      url = win.webContents.getURL();
    } catch {
      continue;
    }
    if (!isAppRendererUrl(url)) continue;
    console.warn('[window-guard] 关闭重复的应用窗口', url);
    try {
      win.close();
    } catch {
      /* ignore */
    }
  }
}

function openExternalOrDeny(url: string): { action: 'deny' } {
  const target = String(url || '').trim();
  if (/^https?:\/\//i.test(target)) {
    void shell.openExternal(target).catch(() => {});
  } else if (/^file:\/\//i.test(target)) {
    void shell.openExternal(target).catch(() => {});
  }
  return { action: 'deny' };
}

function attachMainWindowOpenGuard(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => openExternalOrDeny(url));
}

function attachWindowTaskSwitchGuard(win: BrowserWindow): void {
  const apply = () => {
    if (win.isDestroyed()) return;
    hideNonMainWindowFromTaskSwitch(win);
    if (mainWindow && win === mainWindow) return;
    if (isSnipOverlayBrowserWindow(win) || isInAppBrowserSession(win)) return;
    let url = '';
    try {
      url = win.webContents.getURL();
    } catch {
      return;
    }
    if (isAppRendererUrl(url)) {
      console.warn('[window-guard] 拦截同页克隆窗', url);
      try {
        win.close();
      } catch {
        /* ignore */
      }
    }
  };
  queueMicrotask(apply);
  win.webContents.on('did-finish-load', apply);
  win.webContents.on('did-navigate', apply);
}

app.on('browser-window-created', (_event, win) => {
  attachWindowTaskSwitchGuard(win);
});

function extractProjectFileFromArgv(argv: string[]): string | null {
  const execLower = path.resolve(process.execPath).toLowerCase();
  for (const raw of argv) {
    const arg = String(raw || '').trim().replace(/^["']|["']$/g, '');
    if (!arg || arg.startsWith('-')) continue;
    const ext = path.extname(arg).toLowerCase();
    if (ext !== '.aixflow' && ext !== '.nexflow') continue;
    let resolved = arg;
    try {
      resolved = path.resolve(arg);
    } catch {
      continue;
    }
    if (resolved.toLowerCase() === execLower) continue;
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}

function focusMainApplicationWindow(): void {
  const focusWin = (win: BrowserWindow) => {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    focusWin(mainWindow);
    return;
  }
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed() || isSnipOverlayBrowserWindow(w)) continue;
    focusWin(w);
    return;
  }
}

function notifyRendererProjectImported(imported: {
  project: ProjectListRecord;
  cardBackground?: string;
}): void {
  const payload = {
    project: imported.project,
    cardBackground: imported.cardBackground,
  };
  const send = (win: BrowserWindow) => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send('app:project-imported-from-file', payload);
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    send(mainWindow);
    return;
  }
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed() || isSnipOverlayBrowserWindow(w)) continue;
    send(w);
    return;
  }
}

function importProjectFromPathAndNotify(filePath: string): boolean {
  try {
    const imported = importProjectFromNexflowPath(filePath);
    if (!imported) {
      console.warn('[single-instance] 无法导入项目文件:', filePath);
      return false;
    }
    console.log('[single-instance] 已导入项目:', imported.project.name, imported.project.id);
    notifyRendererProjectImported(imported);
    return true;
  } catch (e) {
    console.warn('[single-instance] 导入项目失败:', filePath, e);
    return false;
  }
}

function queueOpenProjectPath(filePath: string): void {
  pendingOpenProjectPath = filePath;
  if (rendererReady) {
    flushPendingOpenProjectPath();
  }
}

function flushPendingOpenProjectPath(): void {
  if (!rendererReady || !pendingOpenProjectPath) return;
  const p = pendingOpenProjectPath;
  pendingOpenProjectPath = null;
  importProjectFromPathAndNotify(p);
}

function createWindow() {
  rendererReady = false;
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  const preloadDir = path.join(__dirname, '../preload');
  const preloadPathJs = path.join(preloadDir, 'index.js');
  const preloadPathMjs = path.join(preloadDir, 'index.mjs');
  const preloadPath = fs.existsSync(preloadPathJs)
    ? preloadPathJs
    : fs.existsSync(preloadPathMjs)
      ? preloadPathMjs
      : preloadPathJs;

  const buildDir = app.isPackaged ? path.join(app.getAppPath(), 'build') : path.join(process.cwd(), 'build');
  const iconCandidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'icon.ico'),
        path.join(buildDir, 'icon.ico'),
        path.join(buildDir, 'icon.png'),
        path.join(process.resourcesPath, 'icon.png'),
      ]
    : (['icon.ico', 'icon.png', 'icon.jpg'] as const).map((name) => path.join(buildDir, name));
  const iconPath = iconCandidates.find((p) => fs.existsSync(p)) ?? path.join(buildDir, 'icon.ico');
  const iconOpt = fs.existsSync(iconPath) ? { icon: iconPath } : {};

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Aixflow',
    show: true,
    fullscreen: false,
    autoHideMenuBar: true,
    transparent: false,
    // 勿用纯黑：Vite 未就绪时窗口会像「黑屏」
    backgroundColor: '#1c1d22',
    ...iconOpt,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      autoplayPolicy: 'no-user-gesture-required',
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  setMainWindowForSnip(mainWindow);
  setAppUpdaterMainWindow(mainWindow);

  attachMainWindowOpenGuard(mainWindow);
  mainWindow.setSkipTaskbar(false);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();
  queueMicrotask(() => closeDuplicateAppWindows(mainWindow));
  if (mainWindow.isFullScreen()) {
    mainWindow.setFullScreen(false);
  }
  mainWindow.show();

  // 设置 Content Security Policy
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self' ${VITE_DEV_SERVER_ORIGIN} https: http:; ` +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; " +
          "worker-src 'self' blob:; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src 'self' https://fonts.gstatic.com data:; " +
          "media-src 'self' https://midjourney-plus.oss-us-west-1.aliyuncs.com https: http: file: data: blob: local-resource:; " +
          "img-src * 'self' data: blob: file: https: http: local-resource:; " +
          "connect-src 'self' https: http: local-resource:;"
        ],
      },
    });
  });

  // 开发态先画启动页，避免 Vite 编译期间整窗像黑屏；真正页面加载后再标 rendererReady
  mainWindow.webContents.on('did-finish-load', () => {
    const url = mainWindow?.webContents.getURL() || '';
    const pageReady = isDev
      ? url.startsWith(VITE_DEV_SERVER_ORIGIN)
      : /index\.html/i.test(url) || url.startsWith('file:');
    if (!pageReady) return;
    rendererReady = true;
    markHardwareAccelerationSessionOk();
    flushPendingOpenProjectPath();
  });
  mainWindow.on('closed', () => {
    rendererReady = false;
    try {
      asrRealtimeCancel();
    } catch {
      /* ignore */
    }
    aiCore.setMainWindow(null);
    setMainWindowForSnip(null);
    setAppUpdaterMainWindow(null);
    mainWindow = null;
  });
  if (isDev) {
    const splash =
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Aixflow</title></head>' +
      '<body style="margin:0;background:#1c1d22;color:#d4d4d8;font-family:Segoe UI,sans-serif;' +
      'display:flex;align-items:center;justify-content:center;height:100vh;letter-spacing:.04em">' +
      '正在启动…</body></html>';
    void mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(splash));
    loadViteDevServer();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level < 2) return;
    console.error('[渲染进程]', message, sourceId ? `${sourceId}:${line}` : '');
  });

  // 页面加载失败时打印详情，便于排查白屏/崩溃
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[主进程] did-fail-load:', { errorCode, errorDescription, validatedURL });
    if (hardwareAccelerationActive && errorCode !== -3) {
      disableHardwareAccelerationAfterBlackScreen(`did-fail-load ${errorCode}`);
    }
  });
  // 渲染进程崩溃时置位并弹窗，提供重新加载选项
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    rendererReady = false;
    try {
      asrRealtimeCancel();
    } catch {
      /* ignore */
    }
    const msg = `reason: ${details.reason}\nexitCode: ${details.exitCode}\n\n可能原因：整轨音频 decodeAudioData、麦克风实时采集、3D 视角、大量图片或其它渲染压力。若刚操作角色参考音/画布选音，或刚按住语音听写，请更新后重试；否则可减少画布图片/关闭 3D 预览后再重新加载。`;
    console.error('[主进程] 渲染进程已退出:', msg);
    dialog.showMessageBox(mainWindow!, {
      type: 'error',
      title: '渲染进程崩溃',
      message: msg,
      buttons: ['重新加载', '关闭'],
      defaultId: 0,
      cancelId: 1,
    }).then((result) => {
      if (result.response === 0 && mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.webContents?.reload();
        } catch (_e) {
          // 崩溃后 webContents 可能不可用，忽略
        }
      }
    }).catch(() => {});
  });
  mainWindow.webContents.on('unresponsive', () => {
    console.warn('[主进程] 渲染进程未响应');
  });
  mainWindow.webContents.on('responsive', () => {
    console.warn('[主进程] 渲染进程恢复响应');
  });

  // 设置 AICore 的主窗口引用
  aiCore.setMainWindow(mainWindow);
}

function checkViteServerReady(): Promise<boolean> {
  return new Promise((resolve) => {
    // 首编 Workspace/DirectorNode 等超大文件时，Vite 端口已开但首包可能超过 1s
    const req = http.get(VITE_DEV_SERVER_ORIGIN, { timeout: 12000 }, (res) => {
      resolve(true);
      res.resume();
    });
    req.on('error', () => { resolve(false); });
    req.on('timeout', () => {
      // 超时多半是正在编译，当作已就绪，交给 loadURL 继续等
      req.destroy();
      resolve(true);
    });
  });
}

async function loadViteDevServer(retryCount = 0) {
  if (!mainWindow) return;
  const viteUrl = VITE_DEV_SERVER_ORIGIN;
  const maxRetries = 120;
  if (retryCount >= maxRetries) {
    console.warn('[主进程] Vite 探测超时，仍尝试直接加载', viteUrl);
    if (hardwareAccelerationActive) {
      disableHardwareAccelerationAfterBlackScreen('开发服长时间未响应');
    }
    mainWindow.loadURL(viteUrl);
    return;
  }
  const isReady = await checkViteServerReady();
  if (isReady) {
    mainWindow.loadURL(viteUrl);
    console.log('✅ Vite 服务器已就绪，加载开发服务器');
  } else {
    if (retryCount === 0 || retryCount % 10 === 0) {
      console.log(`[主进程] 等待 Vite ${viteUrl}… (${retryCount}/${maxRetries})`);
    }
    setTimeout(() => { loadViteDevServer(retryCount + 1); }, 500);
  }
}

// 在应用启动前注册协议权限（必须在 app.whenReady 之前调用）
if (process.platform === 'win32') {
  app.setAppUserModelId('com.nexflow.app');
}
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-resource',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

/**
 * 将仍含 URI 百分号编码的「磁盘路径」按段解码为真实 Unicode 路径（Windows 优先）。
 * 须与 local-resource / check-file-exists 共用：pathToFileURL→fileURLToPath 在输入仍为 `E:\%E6...` 时会保留 %，fs 会判不存在。
 */
function decodeFsPathPercentEncoding(inputPath: string): string {
  const slashNorm = path.normalize(inputPath.replace(/\\/g, '/'));
  const parts = slashNorm.split('/').map((part, index) => {
    if (!part) return part;
    if (process.platform === 'win32' && index === 0 && /^[a-zA-Z]:$/.test(part)) return part;
    if (!/%[0-9A-F]{2}/i.test(part)) return part;
    try {
      return decodeURIComponent(part);
    } catch {
      try {
        return part.replace(/%([0-9A-F]{2})/gi, (_m, hex: string) =>
          String.fromCharCode(parseInt(hex, 16)),
        );
      } catch {
        return part;
      }
    }
  });
  let joined = parts.join('/');
  if (process.platform === 'win32') {
    joined = joined.replace(/\//g, '\\');
  }
  return path.normalize(joined);
}

/**
 * 将 local-resource URL 去掉协议头后的路径段解析为真实文件系统路径。
 * 必须与 protocol.handle('local-resource') 内解码逻辑一致；末尾须用 fileURLToPath(pathToFileURL(...))，
 * 禁止仅用 pathToFileURL().pathname，否则 Windows 上中文会再变成 %XX 导致 fs 找不到文件。
 */
function localResourceUrlBodyToFsPath(rawAfterProtocol: string, logRedecode = false): string {
  let filePath = rawAfterProtocol;
  if (filePath.includes('?')) {
    filePath = filePath.split('?')[0];
  }
  // 先统一为正斜杠，后续按 / 分段解码才能覆盖 `E:\%E6%88%91\...`（否则整段当作一节，decode 抛错后残留 %）
  filePath = filePath.replace(/\\/g, '/');
  filePath = filePath.replace(/^\/+/, '');
  if (filePath.match(/^[a-zA-Z]\//)) {
    filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
  }
  try {
    filePath = decodeURIComponent(filePath);
  } catch {
    const parts = filePath.split('/');
    filePath = parts
      .map((part, index) => {
        if (!part) return part;
        if (index === 0 && /^[a-zA-Z]:$/.test(part)) return part;
        try {
          return decodeURIComponent(part);
        } catch {
          if (part.includes('%')) {
            try {
              return part.replace(/%([0-9A-F]{2})/gi, (_, hex: string) =>
                String.fromCharCode(parseInt(hex, 16)),
              );
            } catch {
              return part;
            }
          }
          return part;
        }
      })
      .join('/');
  }
  if (filePath.includes('%')) {
    const parts = filePath.split('/');
    filePath = parts
      .map((part, index) => {
        if (!part || !part.includes('%')) return part;
        if (index === 0 && /^[a-zA-Z]:$/.test(part)) return part;
        try {
          return decodeURIComponent(part);
        } catch {
          return part;
        }
      })
      .join('/');
  }
  if (filePath.match(/^\/[a-zA-Z]:/)) {
    filePath = filePath.substring(1);
  }
  let normalizedPath = path.normalize(filePath);
  if (normalizedPath.includes('%')) {
    if (logRedecode) {
      console.warn('[local-resource] 规范化后路径仍包含编码字符，尝试再次解码:', normalizedPath);
    }
    const tempPath = normalizedPath.replace(/\\/g, '/');
    const redecodedParts = tempPath.split('/').map((part) => {
      if (!part || !part.includes('%')) return part;
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
    const redecodedPath = redecodedParts.join('/');
    normalizedPath = path.normalize(redecodedPath);
    if (logRedecode) {
      console.log('[local-resource] 重新解码后的路径:', normalizedPath);
    }
  }
  if (!path.isAbsolute(normalizedPath)) {
    const userDataPath = app.getPath('userData');
    normalizedPath = path.resolve(userDataPath, normalizedPath);
  }
  try {
    normalizedPath = fileURLToPath(pathToFileURL(normalizedPath));
  } catch (urlError) {
    console.warn('[local-resource] pathToFileURL/fileURLToPath 失败，使用 normalize 结果:', urlError);
  }
  let safety = 0;
  while (safety < 4 && /%[0-9A-F]{2}/i.test(normalizedPath)) {
    const next = decodeFsPathPercentEncoding(normalizedPath);
    if (next === normalizedPath) break;
    normalizedPath = next;
    safety += 1;
  }
  return normalizedPath;
}

// 注册 local-resource 协议处理器
function registerLocalResourceProtocol() {
  protocol.handle('local-resource', (request) => {
    try {
      const pathBody = request.url.replace(/^local-resource:\/\/+/, '');
      const normalizedPath = localResourceUrlBodyToFsPath(pathBody, true);

      const userDataPath = app.getPath('userData');
      const normalizedUserData = path.normalize(userDataPath);
      const projectsBase = path.normalize(getProjectsBasePath());
      const defaultProjectsPath = path.normalize(path.join(process.cwd(), 'projects'));
      // 允许的根目录：userData、当前配置的项目根目录、应用运行目录下的 projects、用户常用目录
      const allowedRoots = [
        normalizedUserData,
        projectsBase,
        ...(defaultProjectsPath !== projectsBase ? [defaultProjectsPath] : []),
        path.normalize(app.getPath('home')),
        path.normalize(app.getPath('desktop')),
        path.normalize(app.getPath('documents')),
        path.normalize(app.getPath('downloads')),
        path.normalize(app.getPath('music')),
        path.normalize(app.getPath('pictures')),
        path.normalize(app.getPath('videos')),
      ];
      let isAllowed = allowedRoots.some((root) => {
        const r = root.replace(/[/\\]+$/, '');
        const p = normalizedPath;
        if (process.platform === 'win32') {
          const rl = r.toLowerCase();
          const pl = p.toLowerCase();
          return pl === rl || pl.startsWith(rl + path.sep) || pl.startsWith(rl + '/');
        }
        return p === r || p.startsWith(r + path.sep) || p.startsWith(r + '/');
      });
      // Windows：若未命中常用目录，允许任意盘符下的 Users\<用户名>\（与文件选择器可选范围一致）
      if (!isAllowed && process.platform === 'win32' && /^[a-zA-Z]:[\\/]Users[\\/][^\\/]+/.test(normalizedPath)) {
        isAllowed = true;
      }
      // Windows：允许任意盘符下的项目结构路径（如 E:\我的项目NEXFLOW\project-xxx\assets），避免项目在其它盘时 403 导致图片/视频不显示
      if (!isAllowed && process.platform === 'win32' && path.isAbsolute(normalizedPath)) {
        const normalizedSlash = normalizedPath.replace(/\\/g, '/');
        if (/\/project-[^/]+\//.test(normalizedSlash) || /\/assets\//.test(normalizedSlash)) {
          isAllowed = true;
        }
      }
      if (!isAllowed) {
        console.error('[local-resource] 访问路径超出允许范围:', {
          requested: normalizedPath,
          allowed: allowedRoots,
          pathBody,
          url: request.url
        });
        return new Response('Forbidden', { status: 403 });
      }

      // 检查文件是否存在
      if (!fs.existsSync(normalizedPath)) {
        console.error('[local-resource] 文件不存在:', {
          path: normalizedPath,
          pathBody,
          url: request.url,
          // 尝试列出目录内容（如果路径是目录）
          parentDir: path.dirname(normalizedPath),
          parentExists: fs.existsSync(path.dirname(normalizedPath)),
        });
        
        // 如果父目录存在，尝试列出其内容（用于调试）
        const parentDir = path.dirname(normalizedPath);
        if (fs.existsSync(parentDir)) {
          try {
            const files = fs.readdirSync(parentDir);
            console.log('[local-resource] 父目录内容:', {
              parentDir,
              files: files.slice(0, 10), // 只显示前10个文件
            });
          } catch (err) {
            console.warn('[local-resource] 无法读取父目录:', err);
          }
        }
        
        return new Response('Not Found', { status: 404 });
      }

      // 检查是否是文件
      const stats = fs.statSync(normalizedPath);
      if (!stats.isFile()) {
        console.error('[local-resource] 路径不是文件:', normalizedPath);
        return new Response('Bad Request', { status: 400 });
      }

      // 检查文件大小（空文件可能导致播放问题）
      if (stats.size === 0) {
        console.error('[local-resource] 文件为空:', {
          path: normalizedPath,
          size: stats.size
        });
        return new Response('File is empty', { status: 400 });
      }

      const fileSize = stats.size;
      const ext = path.extname(normalizedPath).toLowerCase();
      let mimeType = 'application/octet-stream';
      if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
      else if (ext === '.webp') mimeType = 'image/webp';
      else if (ext === '.mp4') mimeType = 'video/mp4';
      else if (ext === '.webm') mimeType = 'video/webm';
      else if (ext === '.mov') mimeType = 'video/quicktime';
      else if (ext === '.avi') mimeType = 'video/x-msvideo';
      else if (ext === '.mkv') mimeType = 'video/x-matroska';
      else if (ext === '.m4v') mimeType = 'video/x-m4v';
      else if (ext === '.mp3') mimeType = 'audio/mpeg';
      else if (ext === '.wav') mimeType = 'audio/wav';
      else if (ext === '.ogg') mimeType = 'audio/ogg';
      else if (ext === '.m4a') mimeType = 'audio/mp4';
      else if (ext === '.aac') mimeType = 'audio/aac';
      else if (ext === '.glb') mimeType = 'model/gltf-binary';

      // 解析 Range 请求（视频/音频播放器会按需请求字节范围，不支持会导致只播放几秒或 PIPELINE_ERROR_DECODE）
      const rangeHeader = request.headers.get('Range') || request.headers.get('range');
      let start = 0;
      let end = fileSize - 1;
      let isRangeRequest = false;
      if (rangeHeader && rangeHeader.startsWith('bytes=')) {
        const part = rangeHeader.slice(6).trim();
        const dash = part.indexOf('-');
        if (dash !== -1) {
          const startStr = part.slice(0, dash).trim();
          const endStr = part.slice(dash + 1).trim();
          start = startStr ? Math.max(0, parseInt(startStr, 10)) : 0;
          end = endStr ? Math.min(fileSize - 1, parseInt(endStr, 10)) : fileSize - 1;
          if (!Number.isNaN(start) && !Number.isNaN(end) && start <= end) {
            isRangeRequest = true;
          }
        }
      }

      let fileStream: fs.ReadStream;
      try {
        if (isRangeRequest) {
          fileStream = fs.createReadStream(normalizedPath, { start, end });
        } else {
          // 禁止 readFileSync 整文件进内存：大视频会直接卡死主进程（上传后预览即冻住）
          fileStream = fs.createReadStream(normalizedPath);
        }
      } catch (readError: any) {
        console.error('[local-resource] 读取文件失败:', {
          path: normalizedPath,
          error: readError.message,
          code: readError.code
        });
        return new Response('Read Error', { status: 500 });
      }

      const contentLength = isRangeRequest ? end - start + 1 : fileSize;
      const headers: Record<string, string> = {
        'Content-Type': mimeType,
        'Content-Length': contentLength.toString(),
        'Accept-Ranges': 'bytes',
      };
      if (mimeType.startsWith('image/')) {
        headers['Cache-Control'] = 'private, max-age=86400';
      }
      // 勿用 Readable.toWeb：Range/seek 时 end+close 会二次 close，主进程弹 ERR_INVALID_STATE
      request.signal?.addEventListener(
        'abort',
        () => {
          try {
            fileStream.destroy();
          } catch {
            /* ignore */
          }
        },
        { once: true },
      );
      const body = fsReadStreamToWebBody(fileStream) as any;
      if (isRangeRequest) {
        headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`;
        return new Response(body, { status: 206, headers });
      }
      return new Response(body, { status: 200, headers });
    } catch (error: any) {
      console.error('[local-resource] 处理请求失败:', {
        error: error.message,
        stack: error.stack,
        url: request.url
      });
      return new Response('Internal Server Error', { status: 500 });
    }
  });
}

/**
 * 启动统计 API 服务器
 */
function startStatsServer(): void {
  const app = express();
  app.use(express.json());

  // CORS 支持
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // 获取平均时长接口
  app.get('/api/stats/avg-duration/:taskType', (req, res) => {
    try {
      const taskType = req.params.taskType as TaskType;
      if (!['llm', 'image', 'video'].includes(taskType)) {
        return res.status(400).json({ error: 'Invalid task type. Must be llm, image, or video' });
      }
      const avgDuration = getAverageDuration(taskType, 10);
      res.json({ taskType, avgDuration });
    } catch (error: any) {
      console.error('[StatsServer] 获取平均时长失败:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  });

  // 记录任务历史接口（可选，主要用于调试）
  app.post('/api/stats/record', (req, res) => {
    try {
      const { taskType, duration, success } = req.body;
      if (!taskType || typeof duration !== 'number') {
        return res.status(400).json({ error: 'Invalid request body' });
      }
      recordTaskHistory(taskType as TaskType, duration, success !== false);
      res.json({ success: true });
    } catch (error: any) {
      console.error('[StatsServer] 记录任务历史失败:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  });

  const PORT = 3001;
  statsServer = app.listen(PORT, () => {
    console.log(`[StatsServer] 统计 API 服务器已启动，端口: ${PORT}`);
  });

  statsServer.on('error', (error: any) => {
    if (error.code === 'EADDRINUSE') {
      console.warn(`[StatsServer] 端口 ${PORT} 已被占用，尝试使用其他端口`);
      // 可以尝试其他端口，但为了简单起见，这里只记录警告
    } else {
      console.error('[StatsServer] 服务器错误:', error);
    }
  });
}

type ProjectRecord = ProjectListRecord;

/** 导入时重写节点中的 local-resource 路径，使其指向新项目目录 */
function rewriteAssetPathsForImport(
  nodes: any[],
  assetRelativePaths: Set<string>,
  newProjectFolderPath: string
): { nodes: any[] } {
  let newBase = newProjectFolderPath.replace(/\\/g, '/');
  if (newBase.match(/^\/[a-zA-Z]:/)) newBase = newBase.substring(1);
  const rewriteUrl = (url: string): string => {
    if (!url || typeof url !== 'string' || !url.startsWith('local-resource://')) return url;
    let pathPart = url.replace(/^local-resource:\/\/+/, '');
    try { pathPart = decodeURIComponent(pathPart); } catch { /* ignore */ }
    const assetsIdx = pathPart.toLowerCase().indexOf('assets/');
    if (assetsIdx === -1) return url;
    const afterAssets = pathPart.substring(assetsIdx + 7);
    const normalized = afterAssets.replace(/\\/g, '/');
    if (!assetRelativePaths.has(normalized)) return url;
    return `local-resource://${newBase}/assets/${normalized}`;
  };
  return {
    nodes: nodes.map((node) => {
      const data = node.data || {};
      const updates: Record<string, any> = {};
      if (data.outputImage) updates.outputImage = rewriteUrl(data.outputImage);
      if (data.outputVideo) updates.outputVideo = rewriteUrl(data.outputVideo);
      if (data.outputAudio) updates.outputAudio = rewriteUrl(data.outputAudio);
      if (data.avatar) updates.avatar = rewriteUrl(data.avatar);
      if (Array.isArray(data.inputImages)) updates.inputImages = data.inputImages.map((u: string) => rewriteUrl(u));
      if (data.referenceVideoUrl) updates.referenceVideoUrl = rewriteUrl(data.referenceVideoUrl);
      if (data.referenceAudioUrl) updates.referenceAudioUrl = rewriteUrl(data.referenceAudioUrl);
      if (Object.keys(updates).length === 0) return node;
      return { ...node, data: { ...data, ...updates } };
    }),
  };
}

/**
 * 从 .aixflow / .nexflow（ZIP）文件路径导入项目到当前 store 与项目目录，用于「导入」和「首次运行注入默认项目」。
 */
function importProjectFromNexflowPath(filePath: string): { project: ProjectRecord; cardBackground?: string } | null {
  const fileExt = path.extname(filePath).toLowerCase();
  if (fileExt !== '.nexflow' && fileExt !== '.aixflow' && fileExt !== '.zip') return null;
  if (!fs.existsSync(filePath)) return null;
  const zip = new AdmZip(filePath);
  const zipEntries = zip.getEntries();
  const dataEntry = zipEntries.find((entry: any) => entry.entryName === 'data.json');
  if (!dataEntry) return null;
  const importData = JSON.parse(dataEntry.getData().toString('utf-8'));
  const projectName = importData.projectName || path.basename(filePath, path.extname(filePath));
  const projects = (store.get('projects') as ProjectRecord[]) || [];
  let finalProjectName = projectName;
  let counter = 1;
  while (projects.some((p) => p.name === finalProjectName)) {
    finalProjectName = `${projectName} (${counter})`;
    counter++;
  }
  const now = Date.now();
  const newProject: ProjectRecord = {
    id: `project-${now}`,
    name: finalProjectName,
    date: new Date(now).toISOString().split('T')[0],
    createdAt: importData.createdAt || now,
    lastModified: now,
  };
  const basePath = getProjectsBasePath();
  const projectFolderPath = path.join(basePath, sanitizeProjectName(newProject.id));
  if (!fs.existsSync(projectFolderPath)) fs.mkdirSync(projectFolderPath, { recursive: true });
  const assetRelativePaths = new Set<string>();
  let cardBackground: string | undefined;
  for (const entry of zipEntries) {
    const entryName = entry.entryName;
    if (entry.isDirectory) continue;
    if (entryName === 'card-bg.txt') {
      cardBackground = entry.getData().toString('utf-8').trim() || undefined;
      continue;
    }
    if (entryName.startsWith('assets/')) {
      assetRelativePaths.add(entryName.substring('assets/'.length));
    }
  }
  // 将 outputImage 等 local-resource 路径重写为新项目目录，解决导入后图片加载失败
  const rewritten = rewriteAssetPathsForImport(importData.nodes || [], assetRelativePaths, projectFolderPath);
  for (const entry of zipEntries) {
    const entryName = entry.entryName;
    if (entry.isDirectory) continue;
    if (entryName === 'card-bg.txt') continue;
    if (entryName === 'data.json') {
      fs.writeFileSync(
        path.join(projectFolderPath, 'data.json'),
        JSON.stringify({ nodes: rewritten.nodes, edges: importData.edges || [] }, null, 2),
        'utf-8'
      );
      continue;
    }
    if (entryName === 'metadata.json') {
      fs.writeFileSync(path.join(projectFolderPath, 'metadata.json'), entry.getData(), 'utf-8');
      continue;
    }
    if (entryName.startsWith('assets/')) {
      const relativePath = entryName.substring('assets/'.length);
      const targetPath = path.join(projectFolderPath, 'assets', relativePath);
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(targetPath, entry.getData());
    }
  }
  projects.unshift(newProject);
  store.set('projects', projects);
  return { project: newProject, cardBackground };
}

/** 安装包内默认 LLM 人设 JSON 路径（打包后从 extraResources 复制到 resources） */
function getDefaultLLMPersonasPath(): string {
  if (app.isPackaged && process.resourcesPath) {
    return path.join(process.resourcesPath, 'default-llm-personas.json');
  }
  return path.join(app.getAppPath(), 'resources', 'default-llm-personas.json');
}

// 安装包首次运行：保留草稿；不注入默认项目；片头与 LLM 人设从安装包内默认资源注入；API Key 与授权清空以显示激活页
// 重装检测：exe 修改时间变化视为重装，强制清空任务、激活、API Key（因 userData 可能保留导致 packagedAppHasRun 仍为 true）
function applyFirstRunAfterInstall() {
  const lastVersion = store.get('lastLaunchedVersion') as string | undefined;
  const currentVersion = app.getVersion();

  let shouldClearSensitive = false;
  if (app.isPackaged) {
    const lastExeMtime = store.get('lastExeMtime') as number | undefined;
    let currentExeMtime: number;
    try {
      currentExeMtime = fs.statSync(process.execPath).mtimeMs;
    } catch {
      currentExeMtime = 0;
    }
    if (lastExeMtime !== undefined && currentExeMtime !== lastExeMtime) {
      shouldClearSensitive = true;
      console.log('[重装检测] exe mtime 变化，视为重装，将清空任务、激活、API Key');
    }
    store.set('lastExeMtime', currentExeMtime);
  }

  // 安装包首次运行或重装：清除授权与 API Key，确保激活码、核心算力、插件算力均为空，需用户重新配置
  if ((app.isPackaged && !store.get('packagedAppHasRun')) || shouldClearSensitive) {
    try {
      const licensePath = path.join(getUserDataPath(), 'license.json');
      if (fs.existsSync(licensePath)) {
        fs.unlinkSync(licensePath);
        console.log('[首次运行] 已清除旧授权文件');
      }
    } catch (e) {
      console.warn('[首次运行] 清除旧授权文件失败:', e);
    }
    store.set('license_info_encrypted', '');
    store.set('bltcyApiKey', '');
    store.set('runningHubApiKey', '');
    store.set('tasks', []); // 任务历史列表置空
    store.set('packagedAppHasRun', true);
    console.log('[首次运行] 已清空激活码、核心算力、插件算力、任务列表');
  }

  if (lastVersion === undefined) {
    store.set('tasks', []);
    store.set('bltcyApiKey', '');
    store.set('runningHubApiKey', '');
    store.set('lastLaunchedVersion', currentVersion);
    // 安装包安装时不保留/注入默认项目，用户项目列表为空
    const personas = store.get('globalLLMPersonas') as Array<{ id: string; name: string; content: string }> | undefined;
    if (!personas || personas.length === 0) {
      const defaultPath = getDefaultLLMPersonasPath();
      if (fs.existsSync(defaultPath)) {
        try {
          const raw = fs.readFileSync(defaultPath, 'utf-8');
          const arr = JSON.parse(raw);
          if (Array.isArray(arr) && arr.length > 0) {
            store.set('globalLLMPersonas', arr);
            console.log('[首次运行] 已注入默认 LLM 人设:', arr.length, '条');
          }
        } catch (e) {
          console.warn('[首次运行] 读取默认 LLM 人设失败:', e);
        }
      }
    }
    console.log('[首次运行] 片头资源、LLM 人设已按需注入');
  } else {
    store.set('lastLaunchedVersion', currentVersion);
  }

  importDefaultAssetLibraryIfNeeded(store);
  repairAssetLibraryInStore(store);
  importDefaultDigitalHumanLibraryIfNeeded(store);
  repairDigitalHumanLibraryInStore(store);
}

/** 禁止多开：再次启动时聚焦已有窗口（Windows 任务切换里不再出现多个 Aixflow） */
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    console.log('[single-instance] 检测到重复启动，聚焦已有窗口');
    closeDuplicateAppWindows(mainWindow);
    focusMainApplicationWindow();
    const projectPath = extractProjectFileFromArgv(argv);
    if (projectPath) {
      queueOpenProjectPath(projectPath);
    }
  });

  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    focusMainApplicationWindow();
    queueOpenProjectPath(filePath);
  });

  // 应用启动
  app.whenReady().then(() => {
  app.on('browser-window-created', (_event, win) => {
    attachWindowTaskSwitchGuard(win);
  });

  // 不再删除 Chromium 内部目录（GPUCache、Cache），否则会导致 Gpu Cache Creation failed 与渲染进程 exitCode -2147483645。仅清理自定义缓存（如项目临时目录、缩略图）时使用 app 自有路径。
  applyFirstRunAfterInstall();

  /** 启动时按「中国优化/全球线路」同步 FC 与素材 OSS，并探测直连 */
  void (async () => {
    try {
      const { route, activeEndpoint } = await applyStartupFcRoute();
      if (activeEndpoint) {
        console.log(
          `[NxFc] 启动 FC 路由: ${route} → ${activeEndpoint.replace(/https?:\/\/[^/]+/, 'https://***')}`,
        );
      }
      const ossRoute = await ensureOssUploadRouteProbed();
      const regionLabel = ossRoute.mediaRegion === 'cn' ? '北京' : '香港';
      console.log(`[OSS上传] 启动策略: 素材桶 ${regionLabel}（${ossRoute.mediaRegion}）`);
      if (ossRoute.preferFc) {
        console.log('[OSS上传] 直连不可达，本会话将优先 FC 代传');
      }
    } catch (e) {
      console.warn('[NxFc] 启动应用 FC 路由失败，回退 .env 默认:', e);
    }
  })();

  // 注册 local-resource 协议
  registerLocalResourceProtocol();

  // 截图覆盖层、快捷键与 screenshot:* IPC（须在 createWindow 前注册 handler）
  initScreenSnip();

  setCloudBalanceNotifier((state) => {
    safeSendToRenderer('laf-balance-updated', state);
  });

  // 从 C 盘 userData/projects 迁移到安装目录（或自定义路径）下的 projects
  migrateProjectsFromUserDataToAppDir();
  // 迁移旧的项目ID文件夹到统一按 ID 的路径
  migrateProjectFolders();
  // 将按“项目名”的旧文件夹迁到按“项目 ID”，使卡片名称仅作显示、路径不变
  migrateNameBasedFoldersToIdBased();
  // 清理孤立项目（重装后安装目录被删、userData 仍保留旧列表导致的空项目）
  removeOrphanedProjects();

  // 任务列表：启动时自动清理失败、卡住、无内容、本地文件已删除的无效任务
  try {
    const tasks = store.get('tasks') || [];
    if (tasks.length > 0) filterInvalidTasks(tasks);
  } catch (e) {
    console.warn('[启动] 任务列表清理失败:', e);
  }

  // 注册 AI Providers
  registerProvider(new ChatProvider());
  registerProvider(new ImageProvider());
  registerProvider(new VideoProvider());
  registerProvider(new VideoAnalysisProvider());
  registerProvider(new AudioProvider());

  // 启动统计 API 服务器
  startStatsServer();

  // 开发环境：未开 GPU 时删除 GPUCache，减少旧缓存崩溃；开启 GPU 时保留缓存
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev && !hardwareAccelerationActive) {
    try {
      const userData = app.getPath('userData');
      const gpuCacheDir = path.join(userData, 'GPUCache');
      if (fs.existsSync(gpuCacheDir)) {
        fs.rmSync(gpuCacheDir, { recursive: true, force: true });
        console.log('[主进程] 开发环境已删除 GPUCache:', gpuCacheDir);
      }
    } catch (e) {
      console.warn('[主进程] 删除 GPUCache 失败:', e);
    }
  }

  // 创建窗口
  createWindow();

  const initialProjectPath = extractProjectFileFromArgv(process.argv);
  if (initialProjectPath) {
    queueOpenProjectPath(initialProjectPath);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // 关闭统计服务器
    if (statsServer) {
      statsServer.close();
      statsServer = null;
    }
    app.quit();
  }
});

// ==================== IPC Handlers ====================

// 激活码管理（精简版：NXF-SERIAL-ENCODED_EXPIRE-SIGN + license.json）
const getUserDataPath = () => app.getPath('userData');

ipcMain.handle('validate-activation', async (_, activationCode: string) => {
  const activateResult = activateLicense(activationCode, getUserDataPath());
  return {
    valid: activateResult.valid,
    message: activateResult.message,
    expireAt: activateResult.expireAt,
    errorCode: activateResult.errorCode,
    level: activateResult.valid ? 'PRO' : undefined,
  };
});

ipcMain.handle('check-activation', () => {
  const skipped = isActivationSkipped();
  const check = checkLicenseStatus(getUserDataPath());
  const activated = skipped || check.status === 'VALID';
  return {
    activated,
    skipped,
    status: check.status,
    activationCode: check.activationCode ?? '',
    expireAt: check.expireAt,
    message: check.message,
    level: activated ? 'PRO' : undefined,
  };
});

/** 主应用读取当前授权（VALID 视为 PRO，用于抠图/去水印等） */
ipcMain.handle('get-license-info', () => {
  const check = checkLicenseStatus(getUserDataPath());
  return { level: check.status === 'VALID' ? 'PRO' : null };
});

/** 管理员：生成激活码并写入剪贴板 */
ipcMain.handle('generate-activation-code', (_, days: number) => {
  const code = generateActivationCode(typeof days === 'number' ? days : 30);
  clipboard.writeText(code);
  return { code };
});

/** 语音→文本：云端 fun-asr（经 FC），契约 { text }；不再下载/调用本地 Whisper */
ipcMain.handle(
  'transcribe-speech-from-audio-url',
  async (_, projectId: string | undefined, audioUrl: string, language?: string) =>
    transcribeSpeechViaFunAsr(projectId, audioUrl, language),
);
/** MV 歌词时间线：云端 fun-asr（经 FC），契约 { text, segments } */
ipcMain.handle(
  'transcribe-speech-segments-from-audio-url',
  async (_, projectId: string | undefined, audioUrl: string, language?: string) =>
    transcribeSpeechSegmentsViaFunAsr(projectId, audioUrl, language),
);
ipcMain.handle(
  'separate-vocals-from-audio',
  async (
    _,
    projectId: string | undefined,
    audioUrl: string,
    mode: 'vocals' | 'accompaniment',
  ) => localResourceManager.separateVocalsFromAudio(projectId, audioUrl, mode),
);
ipcMain.handle('cancel-audio-transcribe-jobs', async () => cancelActiveAudioTranscribeJobs());

/** 卡拉OK：探测中文字体 */
ipcMain.handle('karaoke-detect-font', async () => detectChineseKaraokeFont());
/** 卡拉OK：导出 ASS 到用户选择路径 */
ipcMain.handle('karaoke-export-ass', async (_, project: KaraokeProject, defaultName?: string) =>
  exportKaraokeAssFile(project, defaultName),
);
/** 卡拉OK：写临时 ASS（调试/预览） */
ipcMain.handle('karaoke-write-ass-temp', async (_, project: KaraokeProject) =>
  previewWriteKaraokeAss(project),
);
/** 卡拉OK：ffmpeg 烧录字幕到成片并入库（ASS 路径 / 兼容后备） */
ipcMain.handle(
  'karaoke-burn-subtitles',
  async (_, projectId: string | undefined, videoUrl: string, project: KaraokeProject) =>
    burnKaraokeSubtitlesToProject(projectId, videoUrl, project),
);
/**
 * 卡拉OK 方案 A（默认）：隐藏窗只渲字幕层 + capturePage + ffmpeg overlay（与预览 CSS wipe 一致）。
 * 进度经 event.sender 推送 karaoke-css-burn-progress。
 */
ipcMain.handle(
  'karaoke-css-burn',
  async (
    event,
    projectId: string | undefined,
    videoUrl: string,
    project: KaraokeProject,
    opts?: {
      fps?: number;
      durationSec?: number;
      lowSpec?: boolean;
      preferSmooth?: boolean;
    },
  ) => {
    const sender = event.sender;
    return burnKaraokeWithCssPreview(projectId, videoUrl, project, {
      fps: opts?.fps,
      durationSec: opts?.durationSec,
      // 透传 undefined，由主进程按机器规格自动选办公本/流畅档
      lowSpec: opts?.lowSpec,
      preferSmooth: opts?.preferSmooth,
      onProgress: (p: KaraokeCssBurnProgress) => {
        try {
          if (!sender.isDestroyed()) sender.send('karaoke-css-burn-progress', p);
        } catch {
          /* ignore */
        }
      },
    });
  },
);
/** 旧 PNG session API（兼容；方案 A 不再走 html2canvas） */
ipcMain.handle(
  'karaoke-preview-compose-begin',
  async (
    _,
    projectId: string | undefined,
    videoUrl: string,
    project: KaraokeProject,
    opts?: { fps?: number; durationSec?: number },
  ) => beginKaraokePreviewCompose(projectId, videoUrl, project, opts),
);
ipcMain.handle(
  'karaoke-preview-compose-write-frame',
  async (_, sessionId: string, frameIndex: number, png: ArrayBuffer | Uint8Array | Buffer) =>
    writeKaraokePreviewComposeFrame(sessionId, frameIndex, png),
);
ipcMain.handle('karaoke-preview-compose-finalize', async (_, sessionId: string) =>
  finalizeKaraokePreviewCompose(sessionId),
);
ipcMain.handle('karaoke-preview-compose-abort', async (_, sessionId: string) =>
  abortKaraokePreviewComposeSession(sessionId),
);
/** 卡拉OK：取消进行中的烧录（方案 A + ASS + 旧 session） */
ipcMain.handle('karaoke-cancel-burn', async () => cancelAllKaraokeComposeJobs());

/** 百炼实时 ASR 听写：票据经 FC，WebSocket 仅在主进程 */
ipcMain.handle('asr-realtime-start', async () => asrRealtimeStart());
/** 音频块用 on（单向），避免每帧 invoke 往返拖垮渲染进程 */
ipcMain.on('asr-realtime-send-audio', (_event, sessionId: string, pcmBase64: string) => {
  if (typeof sessionId !== 'string' || typeof pcmBase64 !== 'string') return;
  asrRealtimeSendAudio(sessionId, pcmBase64);
});
ipcMain.handle('asr-realtime-stop', async (_, sessionId: string) => asrRealtimeStop(sessionId));
ipcMain.handle('asr-realtime-cancel', async (_, sessionId?: string) => asrRealtimeCancel(sessionId));

// 片头视频：开发时用项目下的 splash-videos，打包后优先用 userData/splash-videos，为空则从安装包内复制默认资源
const SPLASH_VIDEO_EXT = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
const SPLASH_AUDIO_EXT = ['.mp3'];

/** 安装包内自带的片头资源目录（打包时由 extraResources 复制到 resources/splash-videos） */
function getBundledSplashVideosDir(): string {
  if (app.isPackaged && process.resourcesPath) {
    return path.join(process.resourcesPath, 'splash-videos');
  }
  return path.join(app.getAppPath(), 'resources', 'splash-videos');
}

function getSplashVideosDir(): string {
  const dir = app.isPackaged
    ? path.join(getUserDataPath(), 'splash-videos')
    : path.join(app.getAppPath(), 'splash-videos');
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      console.error('[splash] 创建片头视频目录失败:', e);
    }
  }
  return dir;
}

const SPLASH_BUNDLE_VERSION_KEY = 'lastSplashBundleVersion';

function isSplashMediaFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return (
    SPLASH_VIDEO_EXT.includes(ext) ||
    SPLASH_AUDIO_EXT.includes(ext) ||
        ['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(ext)
  );
}

/** 将安装包内片头资源同步到 userData/splash-videos：首次为空时全量复制；版本升级时清空旧媒体再复制 */
function copyBundledSplashVideosIfNeeded(userDir: string): void {
  const bundled = getBundledSplashVideosDir();
  if (!fs.existsSync(bundled)) return;

  const currentVersion = app.getVersion();
  const lastSynced = store.get(SPLASH_BUNDLE_VERSION_KEY) as string | undefined;
  const existing = fs.existsSync(userDir) ? fs.readdirSync(userDir) : [];
  const hasMedia = existing.some((n) => isSplashMediaFile(n));
  const versionUpgraded = app.isPackaged && lastSynced !== currentVersion;
  const shouldSync = !hasMedia || versionUpgraded;

  if (!shouldSync) return;

  try {
    if (versionUpgraded && hasMedia) {
      for (const n of existing) {
        if (!isSplashMediaFile(n)) continue;
        try {
          fs.unlinkSync(path.join(userDir, n));
        } catch {
          /* ignore */
        }
      }
      console.log('[splash] 检测到新版本', currentVersion, '，已清除旧片头缓存');
    }

    const names = fs.readdirSync(bundled);
    for (const n of names) {
      if (!isSplashMediaFile(n)) continue;
      const src = path.join(bundled, n);
      if (!fs.statSync(src).isFile()) continue;
      const dest = path.join(userDir, n);
      fs.copyFileSync(src, dest);
      console.log('[splash] 已同步片头资源:', n);
    }
    store.set(SPLASH_BUNDLE_VERSION_KEY, currentVersion);
  } catch (e) {
    console.warn('[splash] 同步片头资源失败:', e);
  }
}

/** 删除 userData 中安装包已不再包含的片头文件（如旧版 C.mov 换 C.mp4 后残留） */
function pruneOrphanSplashMedia(userDir: string): void {
  const bundled = getBundledSplashVideosDir();
  if (!fs.existsSync(bundled) || !fs.existsSync(userDir)) return;
  const bundledNames = new Set(fs.readdirSync(bundled).filter((n) => isSplashMediaFile(n)));
  for (const n of fs.readdirSync(userDir)) {
    if (!isSplashMediaFile(n) || bundledNames.has(n)) continue;
    try {
      fs.unlinkSync(path.join(userDir, n));
      console.log('[splash] 已移除安装包中不存在的旧片头文件:', n);
    } catch {
      /* ignore */
    }
  }
}

function readSplashMediaFromDir(dir: string): { urls: string[]; logoUrl: string | null; musicUrl: string | null } {
  const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const videos = names
    .filter((n) => SPLASH_VIDEO_EXT.includes(path.extname(n).toLowerCase()))
    .sort()
    .map((n) => pathToFileURL(path.join(dir, n)).href);
  const logoExt = ['.svg', '.png', '.jpg', '.jpeg', '.webp'];
  let logoName: string | undefined = ['logo.png', 'logo.svg', 'logo.jpg', 'logo.webp'].find((n) => names.includes(n));
  if (!logoName) {
    logoName = names.find((n) => logoExt.includes(path.extname(n).toLowerCase()) && !SPLASH_VIDEO_EXT.includes(path.extname(n).toLowerCase()));
  }
  const logoUrl = logoName ? pathToFileURL(path.join(dir, logoName)).href : null;
  const audioNames = names.filter((n) => SPLASH_AUDIO_EXT.includes(path.extname(n).toLowerCase())).sort();
  const musicName = ['bgm.mp3', 'music.mp3'].find((n) => names.includes(n)) ?? audioNames[0];
  const musicUrl = musicName ? pathToFileURL(path.join(dir, musicName)).href : null;
  return { urls: videos, logoUrl, musicUrl };
}

ipcMain.handle('get-splash-videos', async () => {
  const dir = getSplashVideosDir();
  if (app.isPackaged) {
    copyBundledSplashVideosIfNeeded(dir);
    pruneOrphanSplashMedia(dir);
  }
  try {
    const result = readSplashMediaFromDir(dir);
    const hasAnyMedia = result.urls.length > 0 || result.logoUrl || result.musicUrl;
    if (!hasAnyMedia && app.isPackaged) {
      const bundled = getBundledSplashVideosDir();
      if (fs.existsSync(bundled)) {
        const bundledResult = readSplashMediaFromDir(bundled);
        if (bundledResult.urls.length > 0 || bundledResult.logoUrl || bundledResult.musicUrl) {
          return { folderPath: dir, ...bundledResult };
        }
      }
    }
    return { folderPath: dir, ...result };
  } catch (e) {
    console.error('[splash] 读取片头视频目录失败:', e);
    return { folderPath: dir, urls: [], logoUrl: null, musicUrl: null };
  }
});
ipcMain.handle('open-splash-folder', () => {
  const dir = getSplashVideosDir();
  if (fs.existsSync(dir)) shell.openPath(dir);
});

// 安全向渲染进程发送消息（避免窗口已关闭/渲染帧已销毁或未就绪时报错）
function safeSendToRenderer(channel: string, ...args: any[]) {
  if (!rendererReady || !mainWindow?.webContents || mainWindow.isDestroyed()) return;
  try {
    if (mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send(channel, ...args);
  } catch (_err) {
    // 忽略 Render frame was disposed、Message rejected by WidgetHost 等
  }
}

import('./utils/optionalEngineDownloadProgress.js').then(({ setOptionalEngineDownloadSender }) => {
  setOptionalEngineDownloadSender((channel, payload) => safeSendToRenderer(channel, payload));
});

// API Key 管理
ipcMain.handle('save-bltcy-api-key', async (_, apiKey: string) => {
  store.set('bltcyApiKey', apiKey);
  try {
    const balance = await getBLTCYBalance(true);
    safeSendToRenderer('balance-updated', { type: 'bltcy', balance });
  } catch (error) {
    console.error('查询 BLTCY 余额失败:', error);
  }
  return { success: true };
});

ipcMain.handle('save-rh-api-key', async (_, apiKey: string) => {
  store.set('runningHubApiKey', apiKey);
  try {
    const balance = await getRHBalance(true);
    safeSendToRenderer('balance-updated', { type: 'rh', balance });
  } catch (error) {
    console.error('查询 RH 余额失败:', error);
  }
  return { success: true };
});

ipcMain.handle('get-bltcy-api-key', () => {
  return store.get('bltcyApiKey') as string || '';
});

ipcMain.handle('get-rh-api-key', () => {
  return store.get('runningHubApiKey') as string || '';
});

// 余额查询
ipcMain.handle('query-bltcy-balance', async (_, force?: boolean) => {
  const balance = await getBLTCYBalance(force);
  safeSendToRenderer('balance-updated', { type: 'bltcy', balance });
  return balance;
});

ipcMain.handle('query-rh-balance', async (_, force?: boolean) => {
  const balance = await getRHBalance(force);
  safeSendToRenderer('balance-updated', { type: 'rh', balance });
  return balance;
});

ipcMain.handle('query-all-balances', async (_, force?: boolean) => {
  const [bltcy, rh] = await Promise.all([
    getBLTCYBalance(force),
    getRHBalance(force),
  ]);
  safeSendToRenderer('balance-updated', { type: 'bltcy', balance: bltcy });
  safeSendToRenderer('balance-updated', { type: 'rh', balance: rh });
  return { bltcy, rh };
});

// 项目管理
ipcMain.handle('get-projects', () => {
  const raw = store.get('projects') || [];
  return Array.isArray(raw) ? raw : [];
});

ipcMain.handle('create-project', async (_, name: string) => {
  const projects = (store.get('projects') || []) as Array<{
    id: string;
    name: string;
    date: string;
    createdAt: number;
    lastModified: number;
  }>;
  
  const newProject = {
    id: `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name,
    date: new Date().toLocaleDateString('zh-CN'),
    createdAt: Date.now(),
    lastModified: Date.now(),
  };
  
  projects.unshift(newProject);
  store.set('projects', projects);

  const projectDir = getProjectFolderPathSync(newProject.id);
  if (projectDir) {
    fs.mkdirSync(projectDir, { recursive: true });
    const assetsDir = path.join(projectDir, 'assets');
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
  }

  return newProject;
});

ipcMain.handle('update-project', async (_, projectId: string, name: string) => {
  const projects = (store.get('projects') || []) as Array<{
    id: string;
    name: string;
    date: string;
    createdAt: number;
    lastModified: number;
  }>;
  
  const index = projects.findIndex((p) => p.id === projectId);
  if (index !== -1) {
    // 仅更新卡片显示名称，不重命名磁盘路径（路径固定为 projectId）
    projects[index].name = name;
    projects[index].lastModified = Date.now();
    store.set('projects', projects);
    return projects[index];
  }
  throw new Error('项目不存在');
});

ipcMain.handle('reorder-projects', async (_, projectIds: string[]) => {
  const projects = (store.get('projects') || []) as ProjectListRecord[];
  const ids = Array.isArray(projectIds) ? projectIds.filter((id) => typeof id === 'string' && id) : [];
  if (ids.length === 0) return projects;
  const reordered = reorderProjectsByIds(projects, ids);
  store.set('projects', reordered);
  return reordered;
});

ipcMain.handle('delete-project', async (_, projectId: string) => {
  const projects = (store.get('projects') || []) as Array<{
    id: string;
    name: string;
    date: string;
    createdAt: number;
    lastModified: number;
  }>;
  const project = projects.find((p) => p.id === projectId);
  const projectDir = project ? getProjectFolderPathSync(projectId) : null;
  const filtered = projects.filter((p) => p.id !== projectId);
  store.set('projects', filtered);

  if (projectDir && fs.existsSync(projectDir)) {
    try {
      fs.rmSync(projectDir, { recursive: true, force: true });
    } catch (e) {
      console.error('[delete-project] 删除项目文件夹失败:', e);
    }
  }

  // 清理引用该项目的任务（任务列表全局存储，删除项目后需同步移除失效任务）
  try {
    const projectFolderName = projectDir ? path.basename(projectDir) : '';
    if (!projectFolderName) return { success: true };

    const tasks = (store.get('tasks') || []) as Array<{ imageUrl?: string; videoUrl?: string; audioUrl?: string; localFilePath?: string }>;
    const filteredTasks = tasks.filter((t) => {
      const urls = [t.imageUrl, t.videoUrl, t.audioUrl, t.localFilePath].filter(Boolean) as string[];
      for (const u of urls) {
        const normalized = String(u).replace(/\\/g, '/').toLowerCase();
        if (normalized.includes(projectFolderName.toLowerCase())) return false; // 移除：引用已删项目
      }
      return true; // 保留
    });
    if (filteredTasks.length !== tasks.length) {
      store.set('tasks', filteredTasks);
      console.log(`[delete-project] 已清理 ${tasks.length - filteredTasks.length} 个关联任务`);
    }
  } catch (e) {
    console.error('[delete-project] 清理关联任务失败:', e);
  }

  return { success: true };
});

function readProjectDataFile(filePath: string): { nodes: any[]; edges: any[] } | null {
  return readProjectGraphFile(filePath);
}

// 项目数据（节点和边）：原子落盘 + 滚动备份 + 防空/防缩；不删除项目文件夹内任何素材
ipcMain.handle(
  'save-project-data',
  async (
    _,
    projectId: string,
    nodes: any[],
    edges: any[],
    opts?: { allowEmptyOverwrite?: boolean; allowShrinkOverwrite?: boolean; force?: boolean },
  ) => {
    const projectFolderPath = await getProjectFolderPath(projectId);
    if (!projectFolderPath) {
      throw new Error('项目不存在');
    }
    if (!fs.existsSync(projectFolderPath)) {
      fs.mkdirSync(projectFolderPath, { recursive: true });
    }
    return enqueueProjectSave(projectId, () =>
      saveProjectGraphDurable(projectFolderPath, projectId, nodes, edges, opts),
    );
  },
);

ipcMain.handle('load-project-data', async (_, projectId: string) => {
  const projectFolderPath = await getProjectFolderPath(projectId);
  if (!projectFolderPath) {
    return { nodes: [], edges: [] };
  }
  if (!fs.existsSync(projectFolderPath)) {
    fs.mkdirSync(projectFolderPath, { recursive: true });
  }
  const loaded = loadProjectGraphDurable(projectFolderPath, projectId);
  // 迁移旧数据：把节点里内嵌 base64 图片提取为文件，避免短剧草稿整图几十 MB 塞进内存导致切步卡顿/OOM
  try {
    const { directorV2MigrateGraphDataUrls } = await import('./director/directorV2Store.js');
    if (directorV2MigrateGraphDataUrls(loaded.nodes, projectFolderPath)) {
      await enqueueProjectSave(projectId, () =>
        saveProjectGraphDurable(projectFolderPath, projectId, loaded.nodes, loaded.edges, {
          force: true,
        }),
      );
    }
  } catch (e) {
    console.warn('[load-project-data] base64 迁移失败（不影响加载）:', e);
  }
  return {
    nodes: loaded.nodes,
    edges: loaded.edges,
    ...(loaded.recoveredFrom ? { recoveredFrom: loaded.recoveredFrom } : {}),
  };
});

ipcMain.handle('list-project-data-backups', async (_, projectId: string) => {
  const projectFolderPath = await getProjectFolderPath(projectId);
  if (!projectFolderPath || !fs.existsSync(projectFolderPath)) {
    return { success: false as const, error: 'NO_PROJECT' as const, backups: [] as const };
  }
  return { success: true as const, backups: listProjectBackupSummaries(projectFolderPath) };
});

ipcMain.handle(
  'backup-project-data',
  async (
    _,
    projectId: string,
  ): Promise<{ success: true; files: string[] } | { success: false; error: string; files: string[] }> => {
    const files: string[] = [];
    try {
      const projectFolderPath = await getProjectFolderPath(projectId);
      if (!projectFolderPath || !fs.existsSync(projectFolderPath)) {
        return { success: false, error: 'NO_PROJECT', files: [] };
      }
      const graph =
        readProjectGraphFile(path.join(projectFolderPath, 'data.json')) ||
        readProjectGraphFile(path.join(projectFolderPath, 'data.json.bak'));
      if (!graph || graphScore(graph) <= 0) {
        return { success: false, error: 'NO_DATA_FILES', files: [] };
      }
      const rolled = writeRollingBackup(projectFolderPath, graph, 'manual');
      if (rolled) files.push(rolled);
      const names = ['data.json', 'data.json.bak'] as const;
      const backupsDir = path.join(projectFolderPath, 'backups');
      fs.mkdirSync(backupsDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
      for (const name of names) {
        const src = path.join(projectFolderPath, name);
        try {
          if (fs.existsSync(src) && fs.statSync(src).isFile()) {
            const destName = `${stamp}-${name}`;
            const dest = path.join(backupsDir, destName);
            fs.copyFileSync(src, dest);
            files.push(`backups/${destName}`);
          }
        } catch {
          /* skip */
        }
      }
      if (files.length === 0) return { success: false, error: 'NO_DATA_FILES', files: [] };
      return { success: true, files };
    } catch (e) {
      console.error('[backup-project-data]', e);
      return { success: false, error: 'IO_ERROR', files };
    }
  },
);

ipcMain.handle(
  'restore-project-data-from-backup',
  async (
    _,
    projectId: string,
  ): Promise<
    | { success: true; nodeCount: number; previousCount: number; source?: string }
    | { success: false; error: string; currentCount?: number; backupCount?: number }
  > => {
    try {
      const projectFolderPath = await getProjectFolderPath(projectId);
      if (!projectFolderPath || !fs.existsSync(projectFolderPath)) {
        return { success: false, error: 'NO_PROJECT' };
      }
      const dataPath = path.join(projectFolderPath, 'data.json');
      const current = readProjectGraphFile(dataPath);
      const best = resolveBestProjectGraph(projectFolderPath, projectId);
      if (!best || graphScore(best.graph) <= 0) {
        return {
          success: false,
          error: 'NO_BACKUP',
          currentCount: current?.nodes?.length ?? 0,
          backupCount: 0,
        };
      }
      const currentCount = current?.nodes?.length ?? 0;
      const backupCount = best.graph.nodes.length;
      if (backupCount <= currentCount) {
        return { success: false, error: 'BACKUP_NOT_NEWER', currentCount, backupCount };
      }
      if (current && graphScore(current) > 0) {
        archiveGraphToLost(projectId, current, 'pre-manual-restore');
        writeRollingBackup(projectFolderPath, current, 'pre-restore');
      }
      atomicWriteText(
        dataPath,
        JSON.stringify({ nodes: best.graph.nodes, edges: best.graph.edges }, null, 2),
      );
      console.log(
        `[restore-project-data-from-backup] 已从 ${best.source} 恢复 ${backupCount} 个节点（原 ${currentCount}）: ${projectId}`,
      );
      return {
        success: true,
        nodeCount: backupCount,
        previousCount: currentCount,
        source: best.source,
      };
    } catch (e) {
      console.error('[restore-project-data-from-backup]', e);
      return { success: false, error: 'IO_ERROR' };
    }
  },
);

// 将本地文件复制到项目 assets（拖拽到画布的图片/视频/音频持久化到项目，避免 OSS 过期或原路径失效导致“图片加载失败”）
ipcMain.handle('copy-file-to-project-assets', async (_, projectId: string | undefined, sourceFilePath: string) => {
  const normalized = (sourceFilePath || '').trim().replace(/^file:\/\/\/?/i, '');
  if (!normalized) {
    throw new Error('源文件路径为空');
  }
  if (!isLocalResourcePathAllowed(normalized)) {
    throw new Error('源路径不在允许访问的目录内');
  }
  if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) {
    throw new Error('源文件不存在或不是文件');
  }
  let saveDir: string;
  if (projectId) {
    const projectFolderPath = await getProjectFolderPath(projectId);
    if (!projectFolderPath) {
      throw new Error('项目不存在');
    }
    saveDir = path.join(projectFolderPath, 'assets');
  } else {
    saveDir = path.join(app.getPath('userData'), 'assets');
  }
  if (!fs.existsSync(saveDir)) {
    fs.mkdirSync(saveDir, { recursive: true });
  }
  const ext = path.extname(normalized) || '.bin';
  const base = path.basename(normalized, ext);
  const safeBase = base.replace(/[<>:"/\\|?*]/g, '_').slice(0, 32) || 'file';
  const fileName = `dropped-${Date.now()}-${safeBase}${ext}`;
  const destPath = path.join(saveDir, fileName);
  fs.copyFileSync(normalized, destPath);
  const savedPath = destPath.replace(/\\/g, '/');
  return { savedPath };
});

// 将拖入的文件内容（无 path 时由渲染进程读取后传入）写入项目 assets，保证「先保存到项目再读取」
ipcMain.handle('save-dropped-file-buffer-to-project-assets', async (_, projectId: string | undefined, fileName: string, buffer: ArrayBuffer) => {
  const name = (fileName || 'dropped').replace(/[<>:"/\\|?*]/g, '_').slice(0, 64) || 'dropped';
  const ext = path.extname(name) || '';
  const base = ext ? name.slice(0, -ext.length) : name;
  const safeBase = base.slice(0, 32) || 'file';
  let saveDir: string;
  if (projectId) {
    const projectFolderPath = await getProjectFolderPath(projectId);
    if (!projectFolderPath) {
      throw new Error('项目不存在');
    }
    saveDir = path.join(projectFolderPath, 'assets');
  } else {
    saveDir = path.join(app.getPath('userData'), 'assets');
  }
  if (!fs.existsSync(saveDir)) {
    fs.mkdirSync(saveDir, { recursive: true });
  }
  const destFileName = `dropped-${Date.now()}-${safeBase}${ext || '.bin'}`;
  const destPath = path.join(saveDir, destFileName);
  fs.writeFileSync(destPath, Buffer.from(buffer));
  const savedPath = destPath.replace(/\\/g, '/');
  return { savedPath };
});

// 导出项目
ipcMain.handle('export-project', async (_, projectId: string, cardBgDataUrl?: string) => {
  // 导出时使用原始路径（中文路径），确保导出功能正常
  const projectFolderPath = getProjectOriginalFolderPath(projectId);
  
  if (!projectFolderPath) {
    throw new Error('项目不存在');
  }
  
  const dataPath = path.join(projectFolderPath, 'data.json');
  if (!fs.existsSync(dataPath)) {
    throw new Error('项目数据文件不存在');
  }
  
  try {
    const projectData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    const projects = (store.get('projects') as Array<{
      id: string;
      name: string;
      date: string;
      createdAt: number;
      lastModified: number;
    }>) || [];
    
    const project = projects.find((p) => p.id === projectId);
    if (!project) {
      throw new Error('项目信息不存在');
    }
    
    // 构建导出数据（包含项目信息和节点/边数据）
    const exportData = {
      version: '1.0',
      projectName: project.name,
      projectId: project.id,
      createdAt: project.createdAt,
      lastModified: project.lastModified,
      nodes: projectData.nodes || [],
      edges: projectData.edges || [],
    };
    
    // 打开保存对话框
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: '导出项目',
      defaultPath: `${project.name}.aixflow`,
      filters: [
        { name: 'Aixflow 项目文件', extensions: ['aixflow'] },
        { name: '旧版 NEXFLOW 项目 (.nexflow)', extensions: ['nexflow'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }
    
    // 创建 ZIP 文件
    const zip = new AdmZip();
    
    // 添加 data.json
    zip.addFile('data.json', Buffer.from(JSON.stringify(exportData, null, 2), 'utf-8'));
    
    // 添加 metadata.json（如果存在）
    const metadataPath = path.join(projectFolderPath, 'metadata.json');
    if (fs.existsSync(metadataPath)) {
      const metadataContent = fs.readFileSync(metadataPath, 'utf-8');
      zip.addFile('metadata.json', Buffer.from(metadataContent, 'utf-8'));
    }
    // 添加项目卡片背景图（data URL，由渲染进程传入）
    if (cardBgDataUrl && typeof cardBgDataUrl === 'string' && cardBgDataUrl.trim()) {
      zip.addFile('card-bg.txt', Buffer.from(cardBgDataUrl.trim(), 'utf-8'));
    }
    // 添加 assets 文件夹中的所有文件（text、image、video、声音文件）
    const assetsPath = path.join(projectFolderPath, 'assets');
    if (fs.existsSync(assetsPath)) {
      const addDirectoryToZip = (dirPath: string, zipPath: string = '') => {
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
          const filePath = path.join(dirPath, file);
          const stats = fs.statSync(filePath);
          const zipFilePath = zipPath ? `${zipPath}/${file}` : file;
          
          if (stats.isDirectory()) {
            // 递归添加子目录
            addDirectoryToZip(filePath, zipFilePath);
          } else {
            // 添加文件（支持 .txt, .png, .jpg, .jpeg, .webp, .mp4, .webm, .mov, .mp3, .wav, .ogg 等）
            const ext = path.extname(file).toLowerCase();
            const supportedExtensions = ['.txt', '.png', '.jpg', '.jpeg', '.webp', '.mp4', '.webm', '.mov', '.mp3', '.wav', '.ogg', '.aac', '.m4a'];
            if (supportedExtensions.includes(ext)) {
              const fileContent = fs.readFileSync(filePath);
              zip.addFile(`assets/${zipFilePath}`, fileContent);
              console.log(`[导出] 添加文件: assets/${zipFilePath}`);
            }
          }
        }
      };
      
      addDirectoryToZip(assetsPath);
    }
    
    // 保存 ZIP 文件
    zip.writeZip(result.filePath);
    console.log(`[导出] 项目已导出到: ${result.filePath}`);
    
    return { success: true, filePath: result.filePath };
  } catch (error: any) {
    console.error('导出项目失败:', error);
    throw new Error(`导出项目失败: ${error.message}`);
  }
});

// 导入项目
ipcMain.handle('import-project', async () => {
  try {
    // 打开文件选择对话框
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '导入项目',
      filters: [
        { name: 'Aixflow 项目文件', extensions: ['aixflow', 'nexflow'] },
        { name: 'JSON 项目', extensions: ['json'] },
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    
    if (result.canceled || !result.filePaths.length) {
      return { success: false, canceled: true };
    }
    
    const filePath = result.filePaths[0];
    const fileExt = path.extname(filePath).toLowerCase();

    if (fileExt === '.nexflow' || fileExt === '.aixflow' || fileExt === '.zip') {
      const imported = importProjectFromNexflowPath(filePath);
      if (!imported) throw new Error('ZIP 文件中缺少 data.json 或格式无效');
      return { success: true, project: imported.project, cardBackground: imported.cardBackground };
    }

    let importData: any;
    // JSON 文件：向后兼容旧格式
    {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      importData = JSON.parse(fileContent);
      
      // 验证数据格式
      if (!importData.nodes || !importData.edges) {
        throw new Error('无效的项目文件格式');
      }
      
      // 获取项目名称（优先使用导入数据中的项目名，否则使用文件名）
      let projectName = importData.projectName || path.basename(filePath, path.extname(filePath));
      
      // 如果项目名已存在，添加后缀
      const projects = (store.get('projects') as Array<{
        id: string;
        name: string;
        date: string;
        createdAt: number;
        lastModified: number;
      }>) || [];
      
      let finalProjectName = projectName;
      let counter = 1;
      while (projects.some((p) => p.name === finalProjectName)) {
        finalProjectName = `${projectName} (${counter})`;
        counter++;
      }
      
      // 创建新项目
      const now = Date.now();
      const newProject = {
        id: `project-${now}`,
        name: finalProjectName,
        date: new Date(now).toISOString().split('T')[0],
        createdAt: importData.createdAt || now,
        lastModified: now,
      };
      
      projects.unshift(newProject);
      store.set('projects', projects);

      const basePath = getProjectsBasePath();
      const projectFolderPath = path.join(basePath, sanitizeProjectName(newProject.id));
      if (!fs.existsSync(projectFolderPath)) {
        fs.mkdirSync(projectFolderPath, { recursive: true });
      }
      const dataPath = path.join(projectFolderPath, 'data.json');
      fs.writeFileSync(
        dataPath,
        JSON.stringify(
          {
            nodes: importData.nodes || [],
            edges: importData.edges || [],
          },
          null,
          2
        ),
        'utf-8'
      );
      
      return { success: true, project: newProject };
    }
  } catch (error: any) {
    console.error('导入项目失败:', error);
    throw new Error(`导入项目失败: ${error.message}`);
  }
});

// AI 调用（统一规范化 nodeId，避免前后端匹配失败）
ipcMain.handle('ai:invoke', async (_, params: any) => {
  const normalized = {
    ...params,
    nodeId: params?.nodeId != null ? String(params.nodeId).trim() : '',
  };
  return await aiCore.invoke(normalized);
});

/** 取消进行中的 FC LLM（导演/LLM 节点取消按钮） */
ipcMain.handle('ai:abort-llm', async () => {
  try {
    const { abortInFlightFcLlm } = await import('./ai-provider.js');
    return abortInFlightFcLlm();
  } catch (e: any) {
    console.warn('[ai:abort-llm]', e?.message || e);
    return { aborted: false };
  }
});

/** MiniMax-H3 本地 skill 指南（resources/skills/minimax-h3/h3-prompt-writing） */
ipcMain.handle(
  'skills:get-minimax-h3-prompt-guide',
  async (_, kind: 'base' | 'ref' = 'base') => {
    try {
      const k = kind === 'ref' ? 'ref' : 'base';
      const bundle = loadMinimaxH3PromptWritingBundle(k);
      return {
        ok: true as const,
        kind: bundle.kind,
        skillMd: bundle.skillMd,
        guide: bundle.guide,
      };
    } catch (e: any) {
      return {
        ok: false as const,
        error: e?.message || String(e || '读取 MiniMax-H3 skill 失败'),
      };
    }
  },
);

/** 重启后根据已持久化的 RunningHub taskId 恢复轮询 */
ipcMain.handle(
  'video:resume-runninghub-poll',
  async (
    _,
    args: {
      nodeId: string;
      rhTaskId: string;
      projectId?: string;
      prompt?: string;
      nodeTitle?: string;
    },
  ) => {
    aiCore.startResumeRunningHubVideoPoll(args);
    return { ok: true };
  },
);
ipcMain.handle(
  'image:resume-runninghub-poll',
  async (
    _,
    args: {
      nodeId: string;
      rhTaskId: string;
      projectId?: string;
      prompt?: string;
      nodeTitle?: string;
    },
  ) => {
    aiCore.startResumeRunningHubImagePoll(args);
    return { ok: true };
  },
);
ipcMain.handle(
  'audio:resume-runninghub-poll',
  async (
    _,
    args: {
      nodeId: string;
      rhTaskId: string;
      projectId?: string;
      prompt?: string;
      nodeTitle?: string;
    },
  ) => {
    aiCore.startResumeRunningHubAudioPoll(args);
    return { ok: true };
  },
);

// 窗口操作
ipcMain.handle('resize-window', (_, width: number, height: number) => {
  if (mainWindow) {
    mainWindow.setSize(width, height);
  }
  return { success: true };
});

ipcMain.handle('quit-app', () => {
  app.quit();
  return { success: true };
});

ipcMain.handle('toggle-fullscreen', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { success: false, isFullScreen: false };
  }
  const next = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(next);
  return { success: true, isFullScreen: next };
});

/** 渲染进程检测高内存等时请求重载（preload requestRendererReload，避免无 handler 报错） */
ipcMain.handle('request-renderer-reload', (event) => {
  const wc = event.sender;
  if (!wc || wc.isDestroyed()) return { success: false };
  try {
    wc.reload();
    return { success: true };
  } catch {
    return { success: false };
  }
});

// 全局 LLM 人设管理
ipcMain.handle('get-global-llm-personas', () => {
  return store.get('globalLLMPersonas') || [];
});

ipcMain.handle('save-global-llm-persona', (_, persona: { id: string; name: string; content: string }) => {
  const personas = (store.get('globalLLMPersonas') || []) as Array<{
    id: string;
    name: string;
    content: string;
  }>;
  
  const index = personas.findIndex((p) => p.id === persona.id);
  if (index !== -1) {
    personas[index] = persona;
  } else {
    personas.push(persona);
  }
  
  store.set('globalLLMPersonas', personas);
  return persona;
});

ipcMain.handle('update-global-llm-personas', (_, personas: Array<{ id: string; name: string; content: string }>) => {
  store.set('globalLLMPersonas', personas);
  return { success: true };
});

ipcMain.handle('delete-global-llm-persona', (_, personaId: string) => {
  const personas = (store.get('globalLLMPersonas') || []) as Array<{
    id: string;
    name: string;
    content: string;
  }>;
  
  const filtered = personas.filter((p) => p.id !== personaId);
  store.set('globalLLMPersonas', filtered);
  return { success: true };
});

// 选择自定义保存路径
ipcMain.handle('select-save-path', async () => {
  try {
    if (!mainWindow) {
      return { success: false, error: '主窗口未就绪' };
    }
    
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择保存路径',
      properties: ['openDirectory'],
    });
    
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { success: false, error: '用户取消选择' };
    }
    
    const selectedPath = result.filePaths[0];
    store.set('customSavePath', selectedPath);
    return { success: true, path: selectedPath };
  } catch (error) {
    console.error('选择保存路径失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// 自动保存视频到本地
ipcMain.handle('auto-save-video', async (_, videoUrl: string, nodeTitle: string, projectId?: string) => {
  try {
    // 如果是 local-resource:// 或 file:// URL，说明已经保存到本地，直接返回路径
    if (videoUrl.startsWith('local-resource://')) {
      const localPath = videoUrl.replace('local-resource://', '');
      if (fs.existsSync(localPath)) {
        return { success: true, filePath: localPath };
      }
    }
    
    if (videoUrl.startsWith('file://')) {
      const localPath = videoUrl.replace(/^file:\/\/\/?/, '').replace(/\//g, path.sep);
      if (fs.existsSync(localPath)) {
        return { success: true, filePath: localPath };
      }
    }
    
    // 使用 userData 作为基础目录
    const baseDir = app.getPath('userData');
    let projectDir: string;
    
    if (projectId) {
      const projectFolderPath = await getProjectFolderPath(projectId);
      if (projectFolderPath) {
        projectDir = projectFolderPath;
      } else {
        console.warn(`[自动保存视频] 项目不存在: ${projectId}，保存到 assets 文件夹`);
        projectDir = path.join(baseDir, 'assets');
      }
    } else {
      projectDir = path.join(baseDir, 'assets');
    }
    
    // 确保项目文件夹存在
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }
    
    // 确保 assets 子文件夹存在
    const assetsDir = path.join(projectDir, 'assets');
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }
    
    // 生成文件名，保存到 assets 文件夹
    const timestamp = Date.now();
    const sanitizedTitle = nodeTitle.replace(/[<>:"/\\|?*]/g, '_');
    const filePath = path.join(assetsDir, `${sanitizedTitle}-${timestamp}.mp4`);
    
    // 下载视频
    const response = await axios.get(videoUrl, {
      responseType: 'arraybuffer',
      timeout: 300000,
      proxy: false,
    });
    
    // 保存到本地
    fs.writeFileSync(filePath, Buffer.from(response.data));
    
    // 确保文件完全写入
    try {
      const fd = fs.openSync(filePath, 'r+');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    } catch (syncError) {
      console.warn('[自动保存视频] 文件同步失败，但文件已保存:', syncError);
    }
    
    console.log(`视频已自动保存: ${filePath}`);
    return { success: true, filePath };
  } catch (error) {
    console.error('自动保存视频失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// 自动保存图片到本地
ipcMain.handle('auto-save-image', async (_, imageUrl: string, nodeTitle: string, projectId?: string) => {
  try {
    // 如果是 local-resource:// 或 file:// URL，说明已经保存到本地，直接返回路径
    if (imageUrl.startsWith('local-resource://')) {
      const localPath = imageUrl.replace('local-resource://', '');
      if (fs.existsSync(localPath)) {
        return { success: true, filePath: localPath };
      }
    }
    
    if (imageUrl.startsWith('file://')) {
      const localPath = imageUrl.replace(/^file:\/\/\/?/, '').replace(/\//g, path.sep);
      if (fs.existsSync(localPath)) {
        return { success: true, filePath: localPath };
      }
    }
    
    // 使用 userData 作为基础目录
    const baseDir = app.getPath('userData');
    let projectDir: string;
    
    if (projectId) {
      const projectFolderPath = await getProjectFolderPath(projectId);
      if (projectFolderPath) {
        projectDir = projectFolderPath;
      } else {
        console.warn(`[自动保存图片] 项目不存在: ${projectId}，保存到 assets 文件夹`);
        projectDir = path.join(baseDir, 'assets');
      }
    } else {
      projectDir = path.join(baseDir, 'assets');
    }
    
    // 确保项目文件夹存在
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }
    
    // 确保 assets 子文件夹存在
    const assetsDir = path.join(projectDir, 'assets');
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }
    
    // 生成文件名，保存到 assets 文件夹
    const timestamp = Date.now();
    const sanitizedTitle = nodeTitle.replace(/[<>:"/\\|?*]/g, '_');
    const filePath = path.join(assetsDir, `${sanitizedTitle}-${timestamp}.png`);
    
    // 下载图片
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      proxy: false,
    });
    
    // 保存到本地
    fs.writeFileSync(filePath, Buffer.from(response.data));
    
    console.log(`图片已自动保存: ${filePath}`);
    return { success: true, filePath };
  } catch (error) {
    console.error('自动保存图片失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// 自动保存音频到本地（生成的歌曲等）。文件名优先使用 preferredFileName（如歌曲名），否则用 nodeTitle
ipcMain.handle('auto-save-audio', async (_, audioUrl: string, preferredFileName: string, projectId?: string) => {
  try {
    if (audioUrl.startsWith('local-resource://')) {
      const localPath = audioUrl.replace('local-resource://', '').replace(/\//g, path.sep);
      if (fs.existsSync(localPath)) {
        return { success: true, filePath: localPath };
      }
    }
    if (audioUrl.startsWith('file://')) {
      const localPath = audioUrl.replace(/^file:\/\/\/?/, '').replace(/\//g, path.sep);
      if (fs.existsSync(localPath)) {
        return { success: true, filePath: localPath };
      }
    }

    const baseDir = app.getPath('userData');
    let projectDir: string;
    if (projectId) {
      const projectFolderPath = await getProjectFolderPath(projectId);
      projectDir = projectFolderPath ? projectFolderPath : path.join(baseDir, 'assets');
    } else {
      projectDir = path.join(baseDir, 'assets');
    }
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }
    const assetsDir = path.join(projectDir, 'assets');
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }

    const timestamp = Date.now();
    const rawBase = (preferredFileName || 'audio').replace(/[<>:"/\\|?*]/g, '_').trim() || 'audio';
    const baseName = rawBase.replace(/\.(mp3|wav|flac|m4a|ogg|aac)$/i, '') || 'audio';
    const filePath = path.join(assetsDir, `${baseName}-${timestamp}.mp3`);

    const response = await axios.get(audioUrl, {
      responseType: 'arraybuffer',
      timeout: 120000,
      proxy: false,
    });
    fs.writeFileSync(filePath, Buffer.from(response.data));
    try {
      const fd = fs.openSync(filePath, 'r+');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    } catch (e) {
      // ignore
    }
    console.log(`音频已自动保存: ${filePath}`);
    return { success: true, filePath };
  } catch (error) {
    console.error('自动保存音频失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// 下载图片（另存为：可改文件名与类型）
ipcMain.handle('download-image', async (_, imageUrl: string, nodeTitle: string) => {
  try {
    if (!mainWindow) {
      return { success: false, error: '主窗口未就绪' };
    }

    const url = String(imageUrl || '').trim();
    const defaultPath = buildDefaultSavePath(url, nodeTitle, '.png');
    const defaultExt = path.extname(defaultPath).toLowerCase() || '.png';

    const result = await pickSavePath(mainWindow, {
      title: '另存为',
      defaultPath,
      filters: saveFiltersForExt(defaultExt),
    });

    if (result.canceled || !result.filePath) {
      return { success: false, error: '用户取消保存' };
    }

    if (url.startsWith('data:')) {
      const parsed = parseDataUrl(url);
      if (!parsed) return { success: false, error: '无效的图片数据' };
      fs.writeFileSync(result.filePath, parsed.buffer);
      return { success: true, filePath: result.filePath };
    }

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      proxy: false,
    });

    fs.writeFileSync(result.filePath, Buffer.from(response.data));
    return { success: true, filePath: result.filePath };
  } catch (error) {
    console.error('下载图片失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// 下载视频（另存为：可改文件名与类型；支持远程 URL 与本地文件）
ipcMain.handle('download-video', async (_, videoUrl: string, nodeTitle: string) => {
  try {
    if (!mainWindow) {
      return { success: false, error: '主窗口未就绪' };
    }

    const url = String(videoUrl || '').trim();
    if (!url) return { success: false, error: '视频地址为空' };

    const isLocal =
      url.startsWith('local-resource://') ||
      url.startsWith('file://') ||
      (/^[a-zA-Z]:\\/.test(url) && fs.existsSync(url));

    let sourcePath = '';
    if (isLocal) {
      if (url.startsWith('local-resource://') || url.startsWith('file://')) {
        const mapped = toLocalFilePath(url);
        sourcePath = mapped || url.replace(/^local-resource:\/\//, '').replace(/^file:\/\/\/?/, '');
      } else {
        sourcePath = url;
      }
      sourcePath = path.normalize(decodeURIComponent(sourcePath));
      if (!fs.existsSync(sourcePath)) {
        return { success: false, error: `源文件不存在: ${sourcePath}` };
      }
    }

    const nameHint = fileNameFromUrl(url) || String(nodeTitle || '').trim() || 'video';
    const defaultPath = buildDefaultSavePath(nameHint, nodeTitle, isLocal ? path.extname(sourcePath) || '.mp4' : '.mp4');
    const defaultExt = path.extname(defaultPath).toLowerCase() || '.mp4';

    const result = await pickSavePath(mainWindow, {
      title: '另存为',
      defaultPath,
      filters: saveFiltersForVideo(defaultExt),
    });

    if (result.canceled || !result.filePath) {
      return { success: false, error: '用户取消保存' };
    }

    if (isLocal) {
      fs.copyFileSync(sourcePath, result.filePath);
      return { success: true, filePath: result.filePath };
    }

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 300000,
      proxy: false,
    });

    fs.writeFileSync(result.filePath, Buffer.from(response.data));
    return { success: true, filePath: result.filePath };
  } catch (error) {
    console.error('下载视频失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// 下载音频（另存为：可改文件名与类型；支持远程 URL 与本地文件）
ipcMain.handle('download-audio', async (_, audioUrl: string, nodeTitle: string) => {
  try {
    if (!mainWindow) {
      return { success: false, error: '主窗口未就绪' };
    }

    const url = String(audioUrl || '').trim();
    if (!url) return { success: false, error: '音频地址为空' };

    const isLocal =
      url.startsWith('local-resource://') ||
      url.startsWith('file://') ||
      (/^[a-zA-Z]:\\/.test(url) && fs.existsSync(url));

    let sourcePath = '';
    if (isLocal) {
      if (url.startsWith('local-resource://') || url.startsWith('file://')) {
        const mapped = toLocalFilePath(url);
        sourcePath = mapped || url.replace(/^local-resource:\/\//, '').replace(/^file:\/\/\/?/, '');
      } else {
        sourcePath = url;
      }
      sourcePath = path.normalize(decodeURIComponent(sourcePath));
      if (!fs.existsSync(sourcePath)) {
        return { success: false, error: `源文件不存在: ${sourcePath}` };
      }
    }

    const { defaultPath, defaultExt } = resolveAudioSaveDefaults(
      url,
      String(nodeTitle || ''),
      isLocal,
      sourcePath,
    );

    const result = await pickSavePath(mainWindow, {
      title: '另存为',
      defaultPath,
      filters: saveFiltersForAudio(defaultExt),
    });

    if (result.canceled || !result.filePath) {
      return { success: false, error: '用户取消保存' };
    }

    if (isLocal) {
      fs.copyFileSync(sourcePath, result.filePath);
      return { success: true, filePath: result.filePath };
    }

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 120000,
      proxy: false,
    });

    fs.writeFileSync(result.filePath, Buffer.from(response.data));
    return { success: true, filePath: result.filePath };
  } catch (error) {
    console.error('下载音频失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// 本地素材另存为（可改文件名与类型，不再仅选文件夹）
ipcMain.handle('download-local-file-to-folder', async (_, localFilePath: string, preferredFileName?: string) => {
  try {
    if (!mainWindow) return { success: false, error: '主窗口未就绪' };
    const raw = String(localFilePath || '').trim();
    if (!raw) return { success: false, error: '文件路径为空' };

    let sourcePath = raw;
    if (raw.startsWith('local-resource://') || raw.startsWith('file://')) {
      const mapped = toLocalFilePath(raw);
      if (mapped) sourcePath = mapped;
      else if (raw.startsWith('file://')) {
        sourcePath = raw.replace(/^file:\/\/\/?/, '');
      } else {
        sourcePath = raw.replace(/^local-resource:\/\//, '');
      }
    }
    sourcePath = decodeURIComponent(sourcePath);
    sourcePath = path.normalize(sourcePath);
    if (!fs.existsSync(sourcePath)) {
      return { success: false, error: `源文件不存在: ${sourcePath}` };
    }

    const sourceExt = path.extname(sourcePath).toLowerCase();
    const sourceBase = path.basename(sourcePath);
    const hintName = String(preferredFileName || sourceBase).trim();
    const isAudioExt = ['.mp3', '.wav', '.flac', '.m4a', '.ogg', '.aac'].includes(sourceExt);
    const defaultPath = isAudioExt
      ? resolveAudioSaveDefaults(sourcePath, hintName, true, sourcePath).defaultPath
      : buildDefaultSavePath(
          fileNameFromUrl(sourceBase) || hintName,
          hintName,
          sourceExt || '.bin',
        );

    const result = await pickSavePath(mainWindow, {
      title: '另存为',
      defaultPath,
      filters: ['.mp4', '.webm', '.mov', '.mkv', '.avi'].includes(sourceExt)
        ? saveFiltersForVideo(sourceExt)
        : isAudioExt
          ? saveFiltersForAudio(sourceExt)
          : saveFiltersForExt(sourceExt || path.extname(defaultPath)),
    });
    if (result.canceled || !result.filePath) {
      return { success: false, error: '用户取消保存' };
    }

    fs.copyFileSync(sourcePath, result.filePath);
    return { success: true, filePath: result.filePath };
  } catch (error) {
    console.error('另存为本地文件失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

function extFromMimeHeaderForDrag(contentType: string | undefined): string {
  const m = String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return '.jpg';
  if (m === 'image/webp') return '.webp';
  if (m === 'image/gif') return '.gif';
  if (m === 'image/png') return '.png';
  return '';
}

/** 将画布中的图片解析为磁盘绝对路径（或写入临时文件），供拖出到资源管理器 / 桌面 */
ipcMain.handle(
  'prepare-image-for-external-drag',
  async (_, payload: { imageUrl?: string; preferredBaseName?: string }) => {
    const url = String(payload?.imageUrl || '').trim();
    const stem = String(payload?.preferredBaseName || 'image')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .trim()
      .replace(/\.+$/g, '')
      .slice(0, 80);
    const safeStem = stem || 'image';
    const tmpDir = app.getPath('temp');
    const writeTempImage = (buf: Buffer, ext: string) => {
      const safeExt = ext && ext.startsWith('.') ? ext : `.${ext || 'png'}`;
      const dest = path.join(tmpDir, `nexflow-drag-${safeStem}-${randomUUID().slice(0, 8)}${safeExt}`);
      fs.writeFileSync(dest, buf);
      return dest;
    };
    try {
      if (!url) return { success: false, error: 'empty' };
      if (url.startsWith('blob:')) return { success: false, error: 'blob unsupported' };

      if (url.startsWith('data:')) {
        const semi = url.indexOf(',');
        if (semi < 0) return { success: false, error: 'bad data url' };
        const header = url.slice(0, semi);
        const body = url.slice(semi + 1);
        let buf: Buffer;
        if (/;base64/i.test(header)) {
          buf = Buffer.from(body, 'base64');
        } else {
          buf = Buffer.from(decodeURIComponent(body), 'utf8');
        }
        const mimeMatch = header.match(/^data:([^;,]+)/i);
        const mime = mimeMatch?.[1]?.trim() || 'image/png';
        let ext = extFromMimeHeaderForDrag(mime);
        if (!ext) {
          if (mime.includes('jpeg')) ext = '.jpg';
          else if (mime.includes('webp')) ext = '.webp';
          else if (mime.includes('gif')) ext = '.gif';
          else ext = '.png';
        }
        const dest = writeTempImage(buf, ext);
        return { success: true, path: dest };
      }

      if (url.startsWith('http://') || url.startsWith('https://')) {
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 120000,
          proxy: false,
        });
        const ct = response.headers?.['content-type'] as string | undefined;
        let ext = extFromMimeHeaderForDrag(ct);
        if (!ext) {
          try {
            const u = new URL(url);
            const pe = path.extname(u.pathname);
            if (pe && pe.length <= 5) ext = pe;
          } catch {
            /* ignore */
          }
        }
        if (!ext) ext = '.png';
        const dest = writeTempImage(Buffer.from(response.data), ext);
        return { success: true, path: dest };
      }

      let normalizedPath = url;
      if (normalizedPath.startsWith('local-resource://')) {
        const body = normalizedPath.replace(/^local-resource:\/\/+/, '');
        normalizedPath = localResourceUrlBodyToFsPath(body, false);
      } else if (normalizedPath.startsWith('file://')) {
        try {
          normalizedPath = fileURLToPath(normalizedPath);
        } catch {
          normalizedPath = path.normalize(normalizedPath.replace(/^file:\/+/, ''));
        }
      } else {
        normalizedPath = path.normalize(normalizedPath);
        if (/%[0-9A-F]{2}/i.test(normalizedPath)) {
          normalizedPath = decodeFsPathPercentEncoding(normalizedPath);
        }
      }

      if (/%[0-9A-F]{2}/i.test(normalizedPath)) {
        let safety = 0;
        while (safety < 4 && /%[0-9A-F]{2}/i.test(normalizedPath)) {
          const next = decodeFsPathPercentEncoding(normalizedPath);
          if (next === normalizedPath) break;
          normalizedPath = next;
          safety += 1;
        }
      }

      if (!path.isAbsolute(normalizedPath)) {
        return { success: false, error: 'relative path not supported' };
      }
      if (!fs.existsSync(normalizedPath)) {
        return { success: false, error: 'file not found' };
      }
      const stat = fs.statSync(normalizedPath);
      if (!stat.isFile()) {
        return { success: false, error: 'not a file' };
      }
      if (!isLocalResourcePathAllowed(normalizedPath)) {
        return { success: false, error: 'path not allowed' };
      }
      return { success: true, path: normalizedPath };
    } catch (error) {
      console.error('[prepare-image-for-external-drag]', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
);

ipcMain.on('start-native-file-drag', (event, filePath: unknown) => {
  try {
    const fp = String(filePath || '').trim();
    if (!fp || !fs.existsSync(fp)) return;
    const stat = fs.statSync(fp);
    if (!stat.isFile()) return;
    const icon = nativeImage.createFromPath(fp);
    event.sender.startDrag({
      file: fp,
      icon: icon.isEmpty() ? nativeImage.createEmpty() : icon,
    });
  } catch (e) {
    console.error('[start-native-file-drag]', e);
  }
});

// 打开文件
ipcMain.handle('open-file', async (_, filePath: string) => {
  try {
    await shell.openPath(filePath);
    return { success: true };
  } catch (error) {
    console.error('打开文件失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// 选择参考音文件（用于 Index-TTS2.0 等）
ipcMain.handle('show-open-audio-dialog', async () => {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (!mainWindow) return { success: false, filePath: undefined, error: '窗口未就绪' };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择参考音文件',
    properties: ['openFile'],
    filters: [
      { name: '音频', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths?.length) return { success: false, filePath: undefined };
  let filePath = path.normalize(result.filePaths[0]).replace(/\\/g, '/');
  if (process.platform === 'win32' && filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
  return { success: true, filePath };
});

// 选择参考图片（Doubao 音频等）
ipcMain.handle('show-open-image-dialog', async () => {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (!mainWindow) return { success: false, filePath: undefined, error: '窗口未就绪' };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择参考图片',
    properties: ['openFile'],
    filters: [
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths?.length) return { success: false, filePath: undefined };
  let filePath = path.normalize(result.filePaths[0]).replace(/\\/g, '/');
  if (process.platform === 'win32' && filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
  return { success: true, filePath };
});

// 选择视频文件（与 AudioNode 上传参考音一致的 IPC 方案）
ipcMain.handle('show-open-video-dialog', async () => {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (!mainWindow) return { success: false, filePath: undefined, error: '窗口未就绪' };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择视频文件',
    properties: ['openFile'],
    filters: [
      { name: '视频', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths?.length) return { success: false, filePath: undefined };
  let filePath = path.normalize(result.filePaths[0]).replace(/\\/g, '/');
  if (process.platform === 'win32' && filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
  return { success: true, filePath };
});

// 检查文件是否存在（用于播放器预检查）
// 项目路径 IPC 处理器（统一使用 projects/[项目名]，无软链接）
ipcMain.handle('ensure-project-mapping', async (_, projectId: string) => {
  return await getProjectFolderPath(projectId);
});

ipcMain.handle('get-project-mapped-path', async (_, projectId: string) => {
  return await getProjectFolderPath(projectId);
});

ipcMain.handle('get-project-original-path', (_, projectId: string) => {
  return getProjectOriginalFolderPath(projectId);
});

ipcMain.handle('director-v2-save-session', async (_, projectId: string, session: unknown) => {
  const { directorV2SaveSession } = await import('./director/directorV2Store.js');
  return directorV2SaveSession(projectId, session);
});

ipcMain.handle(
  'director-v2-save-asset-file',
  async (
    _,
    projectId: string,
    opts: { kind: 'image' | 'audio'; filename: string; mime?: string; data: ArrayBuffer | Uint8Array },
  ) => {
    const { directorV2SaveAssetFile } = await import('./director/directorV2Store.js');
    return directorV2SaveAssetFile(projectId, opts);
  },
);

ipcMain.handle('director-v2-load-session', async (_, projectId: string) => {
  const { directorV2LoadSession } = await import('./director/directorV2Store.js');
  return directorV2LoadSession(projectId);
});

ipcMain.handle('director-v2-exists', async (_, projectId: string) => {
  const { directorV2Exists } = await import('./director/directorV2Store.js');
  return directorV2Exists(projectId);
});

ipcMain.handle('director-v2-load-cast-library', async (_, projectId: string) => {
  const { directorV2LoadCastLibrary } = await import('./director/directorV2Store.js');
  return directorV2LoadCastLibrary(projectId);
});

ipcMain.handle('director-v2-recover-cast-picks', async (_, projectId: string) => {
  const { directorV2RecoverCastPicks } = await import('./director/directorV2Store.js');
  return directorV2RecoverCastPicks(projectId);
});

ipcMain.handle(
  'director-v2-upsert-cast-library',
  async (
    _,
    projectId: string,
    incoming: {
      characters?: Array<{
        id?: string;
        name?: string;
        gender?: string;
        prompt?: string;
        imageUrl?: string;
        voiceUrl?: string;
      }>;
      scenes?: Array<{ id?: string; name?: string; imageUrl?: string }>;
    },
  ) => {
    const { directorV2UpsertCastLibrary } = await import('./director/directorV2Store.js');
    return directorV2UpsertCastLibrary(projectId, incoming || {});
  },
);

ipcMain.handle('get-project-base-path', () => {
  return getProjectsBasePath();
});

ipcMain.handle('set-project-base-path', async () => {
  const win = BrowserWindow.getAllWindows()[0];
  const result = await dialog.showOpenDialog(win || null, {
    title: '选择项目保存位置',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths?.length) {
    return { success: false, path: '' };
  }
  const chosen = path.normalize(result.filePaths[0]);
  store.set('customProjectPath', chosen);
  return { success: true, path: chosen };
});

ipcMain.handle('check-file-exists', async (_, filePath: string) => {
  try {
    let normalizedPath = filePath.trim();
    if (normalizedPath.startsWith('local-resource://')) {
      const body = normalizedPath.replace(/^local-resource:\/\/+/, '');
      normalizedPath = localResourceUrlBodyToFsPath(body, false);
    } else if (normalizedPath.startsWith('file://')) {
      try {
        normalizedPath = fileURLToPath(normalizedPath);
      } catch {
        normalizedPath = path.normalize(normalizedPath.replace(/^file:\/+/, ''));
      }
    } else {
      normalizedPath = path.normalize(normalizedPath);
      if (/%[0-9A-F]{2}/i.test(normalizedPath)) {
        normalizedPath = decodeFsPathPercentEncoding(normalizedPath);
      }
    }

    if (/%[0-9A-F]{2}/i.test(normalizedPath)) {
      let safety = 0;
      while (safety < 4 && /%[0-9A-F]{2}/i.test(normalizedPath)) {
        const next = decodeFsPathPercentEncoding(normalizedPath);
        if (next === normalizedPath) break;
        normalizedPath = next;
        safety += 1;
      }
    }

    // 检查文件是否存在且可读
    const exists = fs.existsSync(normalizedPath);
    if (!exists) {
      console.log('[check-file-exists] 文件不存在:', normalizedPath);
      return { exists: false, path: normalizedPath };
    }
    
    // 检查是否是文件
    const stats = fs.statSync(normalizedPath);
    const isFile = stats.isFile();
    const size = stats.size;
    
    if (!isFile) {
      console.log('[check-file-exists] 路径不是文件:', normalizedPath);
      return { exists: false, path: normalizedPath };
    }
    
    if (size === 0) {
      console.log('[check-file-exists] 文件为空:', normalizedPath);
      return { exists: true, path: normalizedPath, size: 0, readable: false };
    }
    
    return { 
      exists: true, 
      path: normalizedPath,
      size: size,
      readable: true
    };
  } catch (error: any) {
    console.error('[check-file-exists] 检查文件失败:', error);
    return { 
      exists: false, 
      error: error.message 
    };
  }
});

// 在文件管理器中显示文件
ipcMain.handle('show-item-in-folder', async (_, filePath: string) => {
  try {
    shell.showItemInFolder(filePath);
    return { success: true };
  } catch (error) {
    console.error('显示文件失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// 获取用户数据路径
ipcMain.handle('get-user-data-path', () => {
  return app.getPath('userData');
});

/** 在系统默认浏览器打开 https/http 链接（充值跳转支付宝等） */
ipcMain.handle('open-external-url', async (_, urlRaw: string) => {
  const url = String(urlRaw ?? '').trim();
  if (!url) throw new Error('URL_REQUIRED');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('INVALID_URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('UNSUPPORTED_URL_PROTOCOL');
  }
  await shell.openExternal(url);
});

/** 应用内 BrowserWindow 打开 https/http（飞书文档等）；失败时 fallback 系统浏览器 */
ipcMain.handle('open-in-app-browser', async (_, urlRaw: string, title?: string) => {
  return openInAppBrowser(urlRaw, { title: typeof title === 'string' ? title : undefined });
});

// 打开路径（文件夹或文件）
ipcMain.handle('open-path', async (_, pathToOpen: string) => {
  try {
    // 如果路径不存在，尝试创建目录
    if (!fs.existsSync(pathToOpen)) {
      try {
        fs.mkdirSync(pathToOpen, { recursive: true });
      } catch (mkdirError) {
        // 如果创建失败，可能是文件路径，继续尝试打开
      }
    }
    
    await shell.openPath(pathToOpen);
    return { success: true };
  } catch (error) {
    console.error('打开路径失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

function persistDataUrlImageSync(
  characterId: string,
  fileStem: string,
  dataUrl: string,
): { url: string; fsPath: string } | null {
  const raw = String(dataUrl || '').trim();
  if (!raw.startsWith('data:image/')) return null;
  const comma = raw.indexOf(',');
  if (comma < 0) return null;
  const header = raw.slice(0, comma);
  const b64 = raw.slice(comma + 1).replace(/\s/g, '');
  const mimeMatch = header.match(/data:image\/([a-zA-Z0-9+.-]+)/i);
  const extRaw = (mimeMatch?.[1] || 'png').toLowerCase();
  const ext = extRaw === 'jpeg' ? 'jpg' : extRaw.replace(/[^a-z0-9]/g, '') || 'png';
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, 'base64');
  } catch {
    return null;
  }
  if (buf.length < 1 || buf.length > 8 * 1024 * 1024) return null;
  const dir = path.join(app.getPath('userData'), fileStem.startsWith('view') ? 'character-views' : 'avatars');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fsPath = path.join(dir, `${characterId}-${fileStem}.${ext}`);
  try {
    if (!fs.existsSync(fsPath) || fs.statSync(fsPath).size !== buf.length) {
      fs.writeFileSync(fsPath, buf);
    }
  } catch (e) {
    console.error('[角色库] 落盘头像失败:', e);
    return null;
  }
  let normalizedPath = fsPath.replace(/\\/g, '/');
  if (normalizedPath.match(/^\/[a-zA-Z]:/)) normalizedPath = normalizedPath.substring(1);
  return { url: `local-resource://${normalizedPath}`, fsPath };
}

function fsPathToLocalResource(fsPath: string): string {
  let normalizedPath = String(fsPath || '').replace(/\\/g, '/');
  if (!normalizedPath) return '';
  if (normalizedPath.match(/^\/[a-zA-Z]:/)) normalizedPath = normalizedPath.substring(1);
  if (normalizedPath.startsWith('local-resource://')) return normalizedPath;
  return `local-resource://${normalizedPath}`;
}

function hydrateCharacterLocalMedia(raw: Record<string, unknown>): { character: Record<string, unknown>; changed: boolean } {
  const next: Record<string, unknown> = { ...raw };
  let changed = false;
  const id = String(raw.id || 'character');
  const avatar = String(raw.avatar || '').trim();
  const localAvatar = String(raw.localAvatarPath || '').trim();
  if (!localAvatar && avatar.startsWith('data:image/')) {
    const one = persistDataUrlImageSync(id, 'avatar', avatar);
    if (one) {
      next.localAvatarPath = one.fsPath;
      next.avatar = one.url;
      changed = true;
    }
  } else if (localAvatar && avatar.startsWith('data:')) {
    next.avatar = fsPathToLocalResource(localAvatar);
    changed = true;
  }
  const views = Array.isArray(raw.viewImages) ? [...(raw.viewImages as unknown[])] : [];
  const localViews = Array.isArray(raw.localViewPaths)
    ? [...(raw.localViewPaths as unknown[])].map((p) => String(p || ''))
    : [];
  for (let i = 0; i < Math.max(4, views.length); i++) {
    const v = String(views[i] || '').trim();
    if (!v.startsWith('data:image/')) continue;
    const one = persistDataUrlImageSync(id, `view${i}`, v);
    if (!one) continue;
    views[i] = one.url;
    if (one.fsPath && !localViews.includes(one.fsPath)) localViews.push(one.fsPath);
    changed = true;
  }
  if (changed) {
    next.viewImages = views;
    next.localViewPaths = localViews;
  }
  return { character: next, changed };
}

function compactCharacterForIpc(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const c = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...c };
  const localAvatar = String(c.localAvatarPath || '').trim();
  if (localAvatar) {
    out.avatar = fsPathToLocalResource(localAvatar);
  } else if (typeof out.avatar === 'string' && out.avatar.startsWith('data:') && out.avatar.length > 120_000) {
    out.avatar = '';
  }
  if (Array.isArray(out.viewImages)) {
    const locals = Array.isArray(out.localViewPaths) ? (out.localViewPaths as unknown[]) : [];
    out.viewImages = (out.viewImages as unknown[]).map((v, i) => {
      const s = String(v || '');
      if (s.startsWith('data:') && s.length > 120_000) {
        const lp = String(locals[i] || '').trim();
        return lp ? fsPathToLocalResource(lp) : '';
      }
      return v;
    });
  }
  return out;
}

let characterPersistQueued = false;
function queueCharacterMediaPersist() {
  if (characterPersistQueued) return;
  characterPersistQueued = true;
  let index = 0;
  const step = () => {
    try {
      const list = (store.get('characters') || []) as Array<Record<string, unknown>>;
      if (!Array.isArray(list) || index >= list.length) {
        characterPersistQueued = false;
        return;
      }
      const item = list[index++];
      if (item && typeof item === 'object') {
        const { character, changed } = hydrateCharacterLocalMedia(item);
        if (changed) {
          const next = list.slice();
          next[index - 1] = character;
          store.set('characters', next);
          for (const win of BrowserWindow.getAllWindows()) {
            try {
              win.webContents.send('characters-updated');
            } catch {
              /* ignore */
            }
          }
        }
      }
    } catch (e) {
      console.error('[角色库] 后台落盘失败:', e);
    }
    setImmediate(step);
  };
  setImmediate(step);
}

// 角色管理：立刻返回，落盘放到后台，避免进草稿时主进程卡死、哪儿都点不了
ipcMain.handle('get-characters', () => {
  const list = store.get('characters') || [];
  if (!Array.isArray(list)) return [];
  queueCharacterMediaPersist();
  return list.map((c) => compactCharacterForIpc(c));
});

/** 将 data URL 音频写入 userData/character-voices，返回 local-resource URL 与磁盘路径（供删除时清理） */
function persistCharacterVoiceDataUrl(
  characterId: string,
  dataUrl: string,
): { localResourceUrl: string; fsPath: string } | null {
  const raw = (dataUrl || '').trim();
  if (!raw.startsWith('data:audio/')) return null;
  const comma = raw.indexOf(',');
  if (comma < 0) return null;
  const header = raw.slice(0, comma);
  const b64 = raw.slice(comma + 1).replace(/\s/g, '');
  const mimeMatch = header.match(/data:(audio\/[a-zA-Z0-9.+-]+)/i);
  const mime = (mimeMatch?.[1] || 'audio/webm').toLowerCase();
  let ext = 'webm';
  if (mime.includes('mpeg') || mime.includes('mp3')) ext = 'mp3';
  else if (mime.includes('wav')) ext = 'wav';
  else if (mime.includes('ogg')) ext = 'ogg';
  else if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) ext = 'm4a';
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, 'base64');
  } catch {
    return null;
  }
  const maxBytes = 20 * 1024 * 1024;
  if (buf.length < 1 || buf.length > maxBytes) return null;
  const userDataPath = app.getPath('userData');
  const dir = path.join(userDataPath, 'character-voices');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const fsPath = path.join(dir, `${characterId}.${ext}`);
  try {
    fs.writeFileSync(fsPath, buf);
  } catch (e) {
    console.error('[角色创建] 写入声音片段失败:', e);
    return null;
  }
  let normalizedPath = fsPath.replace(/\\/g, '/');
  if (normalizedPath.match(/^\/[a-zA-Z]:/)) {
    normalizedPath = normalizedPath.substring(1);
  }
  return { localResourceUrl: `local-resource://${normalizedPath}`, fsPath };
}

/** 将单张「角色四视图」参考图持久化（data URL 写入 character-views；远程走自动下载） */
async function persistCharacterViewImageSlot(
  characterId: string,
  slotIndex: number,
  raw: string,
): Promise<{ url: string; fsPath?: string } | null> {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('data:image/')) {
    const comma = trimmed.indexOf(',');
    if (comma < 0) return null;
    const header = trimmed.slice(0, comma);
    const b64 = trimmed.slice(comma + 1).replace(/\s/g, '');
    const mimeMatch = header.match(/data:image\/([a-zA-Z0-9+.-]+)/i);
    const extRaw = (mimeMatch?.[1] || 'png').toLowerCase();
    const ext = extRaw === 'jpeg' ? 'jpg' : extRaw.replace(/[^a-z0-9]/g, '') || 'png';
    let buf: Buffer;
    try {
      buf = Buffer.from(b64, 'base64');
    } catch {
      return null;
    }
    const maxBytes = 8 * 1024 * 1024;
    if (buf.length < 1 || buf.length > maxBytes) return null;
    const userDataPath = app.getPath('userData');
    const dir = path.join(userDataPath, 'character-views');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const fsPath = path.join(dir, `${characterId}-view${slotIndex}.${ext}`);
    try {
      fs.writeFileSync(fsPath, buf);
    } catch (e) {
      console.error('[角色创建] 写入四视图失败:', e);
      return null;
    }
    let normalizedPath = fsPath.replace(/\\/g, '/');
    if (normalizedPath.match(/^\/[a-zA-Z]:/)) {
      normalizedPath = normalizedPath.substring(1);
    }
    return { url: `local-resource://${normalizedPath}`, fsPath };
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const { autoDownloadResource } = await import('./utils/resourceDownloader.js');
      const localPath = await autoDownloadResource(trimmed, 'image', {
        nodeId: `${characterId}-view${slotIndex}`,
        nodeTitle: 'character-view',
        projectId: undefined,
        resourceType: 'character-avatar',
      });
      if (!localPath) return null;
      let normalizedPath = localPath.replace(/\\/g, '/');
      if (normalizedPath.match(/^\/[a-zA-Z]:/)) {
        normalizedPath = normalizedPath.substring(1);
      }
      return { url: `local-resource://${normalizedPath}`, fsPath: localPath };
    } catch (e) {
      console.error('[角色创建] 下载四视图失败:', e);
      return null;
    }
  }

  if (trimmed.startsWith('local-resource://') || trimmed.startsWith('file://')) {
    return { url: trimmed };
  }

  return { url: trimmed };
}

async function persistCharacterFourViewSlots(
  characterId: string,
  slotInputs: string[],
): Promise<{ viewImages: string[]; localViewPaths: string[] }> {
  const slots: string[] = ['', '', '', ''];
  const localViewPaths: string[] = [];
  for (let i = 0; i < 4; i++) {
    const src = (slotInputs[i] || '').trim();
    if (!src) continue;
    const one = await persistCharacterViewImageSlot(characterId, i, src);
    if (one?.url) {
      slots[i] = one.url;
      if (one.fsPath) localViewPaths.push(one.fsPath);
    }
  }
  return { viewImages: slots, localViewPaths };
}

ipcMain.handle(
  'create-character',
  async (
    _,
    nickname: string,
    name: string,
    avatar: string,
    roleId?: string,
    permalink?: string,
    voiceClip?: string,
    viewImages?: string[],
    imageDescription?: string,
  ) => {
  const characters = (store.get('characters') || []) as Array<{
    id: string;
    nickname: string;
    name: string;
    avatar: string;
    roleId?: string;
    permalink?: string;
    createdAt: number;
    localAvatarPath?: string; // 本地头像路径
    voiceClip?: string;
    localVoicePath?: string;
    viewImages?: string[];
    localViewPaths?: string[];
    imageDescription?: string;
  }>;

  const characterId = `character-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // 如果头像 URL 是远程 URL，自动下载到本地
  let finalAvatar = avatar;
  let localAvatarPath: string | undefined;
  
  if (avatar && !avatar.startsWith('local-resource://') && !avatar.startsWith('data:') && !avatar.startsWith('file://')) {
    try {
      const { autoDownloadResource } = await import('./utils/resourceDownloader.js');
      const userDataPath = app.getPath('userData');
      const avatarsDir = path.join(userDataPath, 'avatars');
      
      // 确保 avatars 目录存在
      if (!fs.existsSync(avatarsDir)) {
        fs.mkdirSync(avatarsDir, { recursive: true });
      }
      
      // 下载头像到 avatars 文件夹（不使用项目ID，因为角色是全局的）
      const localPath = await autoDownloadResource(avatar, 'image', {
        nodeId: characterId,
        nodeTitle: nickname || name,
        projectId: undefined, // 角色头像不使用项目ID，保存到全局 avatars
      });
      
      if (localPath) {
        // 将本地路径转换为 local-resource:// URL
        let normalizedPath = localPath.replace(/\\/g, '/');
        if (normalizedPath.match(/^\/[a-zA-Z]:/)) {
          normalizedPath = normalizedPath.substring(1);
        }
        finalAvatar = `local-resource://${normalizedPath}`;
        localAvatarPath = localPath;
        console.log(`[角色创建] 头像已下载到本地: ${localPath}`);
      }
    } catch (error) {
      console.error('[角色创建] 下载头像失败，使用原始 URL:', error);
    }
  }

  let finalVoiceClip: string | undefined;
  let localVoicePath: string | undefined;
  const vIn = typeof voiceClip === 'string' ? voiceClip.trim() : '';
  if (vIn) {
    if (vIn.startsWith('data:audio/')) {
      const persisted = persistCharacterVoiceDataUrl(characterId, vIn);
      if (persisted) {
        finalVoiceClip = persisted.localResourceUrl;
        localVoicePath = persisted.fsPath;
        console.log('[角色创建] 声音片段已保存:', persisted.fsPath);
      }
    } else if (vIn.startsWith('local-resource://') || vIn.startsWith('file://')) {
      finalVoiceClip = vIn;
    }
  }
  
  const rawViewSlots = Array.isArray(viewImages) ? viewImages : [];
  const paddedViews = [0, 1, 2, 3].map((i) => String(rawViewSlots[i] ?? '').trim());
  let viewImagesPersisted: string[] | undefined;
  let localViewPathsPersisted: string[] | undefined;
  if (paddedViews.some(Boolean)) {
    const { viewImages: viSlots, localViewPaths: lvPaths } = await persistCharacterFourViewSlots(characterId, paddedViews);
    if (viSlots.some((u) => String(u || '').trim())) {
      viewImagesPersisted = viSlots;
      if (lvPaths.length) localViewPathsPersisted = lvPaths;
    }
  }

  const desc = typeof imageDescription === 'string' ? imageDescription.trim() : '';
  const newCharacter = {
    id: characterId,
    nickname,
    name,
    avatar: finalAvatar,
    localAvatarPath,
    roleId: roleId || undefined,
    permalink: permalink?.trim() || undefined,
    voiceClip: finalVoiceClip,
    localVoicePath,
    createdAt: Date.now(),
    ...(viewImagesPersisted ? { viewImages: viewImagesPersisted } : {}),
    ...(localViewPathsPersisted?.length ? { localViewPaths: localViewPathsPersisted } : {}),
    ...(desc ? { imageDescription: desc } : {}),
  };
  
  characters.push(newCharacter);
  store.set('characters', characters);
  return newCharacter;
});

async function persistImageTo3dCharacterReferenceImage(
  characterId: string,
  raw: string,
): Promise<{ url: string; localPath?: string } | null> {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('data:image/')) {
    const one = await persistCharacterViewImageSlot(`${characterId}-ref`, 0, trimmed);
    if (!one?.url) return null;
    return { url: one.url, localPath: one.fsPath };
  }

  const localRef = resolveFsPathFromUrlish(trimmed);
  if (localRef) {
    const ext = path.extname(localRef) || '.png';
    const copied = copyFileIntoCharacter3dDir(localRef, `${characterId}-ref${ext}`);
    if (!copied) return null;
    return { url: fsPathToLocalResourceUrl(copied), localPath: copied };
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const userDataPath = app.getPath('userData');
      const dir = path.join(userDataPath, 'character-3d');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const saved = await downloadRemoteAssetToDir(trimmed, dir, `${characterId}-ref.png`);
      if (!saved) return null;
      return { url: fsPathToLocalResourceUrl(saved), localPath: saved };
    } catch (e) {
      console.error('[图片转3D] 下载参考图缩略图失败:', e);
      return null;
    }
  }

  return { url: trimmed };
}

ipcMain.handle('update-character', async (_, characterId: string, updates: { nickname?: string; name?: string; avatar?: string; roleId?: string; voiceClip?: string; viewImages?: string[]; imageDescription?: string }) => {
  const characters = (store.get('characters') || []) as Array<{
    id: string;
    nickname: string;
    name: string;
    avatar: string;
    roleId?: string;
    createdAt: number;
    assetKind?: 'role' | 'imageTo3d';
    inputImageUrl?: string;
    localAvatarPath?: string; // 本地头像路径
    voiceClip?: string;
    localVoicePath?: string;
    viewImages?: string[];
    localViewPaths?: string[];
    imageDescription?: string;
  }>;
  
  const index = characters.findIndex((c) => c.id === characterId);
  if (index !== -1) {
    const character = characters[index];
    const isImageTo3d = character.assetKind === 'imageTo3d';
    let finalUpdates: {
      nickname?: string;
      name?: string;
      avatar?: string;
      roleId?: string;
      inputImageUrl?: string;
      localAvatarPath?: string;
      voiceClip?: string;
      localVoicePath?: string;
      viewImages?: string[];
      localViewPaths?: string[];
      imageDescription?: string;
    } = { ...updates };
    
    if (updates.avatar !== undefined && isImageTo3d) {
      const raw = (updates.avatar || '').trim();
      if (!raw) {
        finalUpdates.avatar = '';
        finalUpdates.inputImageUrl = '';
        finalUpdates.localAvatarPath = undefined;
      } else {
        const one = await persistImageTo3dCharacterReferenceImage(characterId, raw);
        if (one?.url) {
          finalUpdates.avatar = one.url;
          finalUpdates.inputImageUrl = one.url;
          finalUpdates.localAvatarPath = one.localPath;
        } else {
          delete finalUpdates.avatar;
        }
      }
    } else if (updates.avatar && !updates.avatar.startsWith('local-resource://') && !updates.avatar.startsWith('data:') && !updates.avatar.startsWith('file://')) {
    // 如果更新了头像 URL 且是远程 URL，自动下载到本地
      try {
        const { autoDownloadResource } = await import('./utils/resourceDownloader.js');
        const userDataPath = app.getPath('userData');
        const avatarsDir = path.join(userDataPath, 'avatars');
        
        // 确保 avatars 目录存在
        if (!fs.existsSync(avatarsDir)) {
          fs.mkdirSync(avatarsDir, { recursive: true });
        }
        
        // 下载头像到 avatars 文件夹
        const localPath = await autoDownloadResource(updates.avatar, 'image', {
          nodeId: characterId,
          nodeTitle: updates.nickname || character.nickname || character.name,
          projectId: undefined, // 角色头像不使用项目ID，保存到全局 avatars
        });
        
        if (localPath) {
          // 将本地路径转换为 local-resource:// URL
          let normalizedPath = localPath.replace(/\\/g, '/');
          if (normalizedPath.match(/^\/[a-zA-Z]:/)) {
            normalizedPath = normalizedPath.substring(1);
          }
          finalUpdates.avatar = `local-resource://${normalizedPath}`;
          finalUpdates.localAvatarPath = localPath;
          console.log(`[角色更新] 头像已下载到本地: ${localPath}`);
        }
      } catch (error) {
        console.error('[角色更新] 下载头像失败，使用原始 URL:', error);
      }
    }

    if (updates.voiceClip !== undefined) {
      const v = typeof updates.voiceClip === 'string' ? updates.voiceClip.trim() : '';
      if (!v) {
        finalUpdates.voiceClip = '';
        finalUpdates.localVoicePath = undefined;
        const oldVp = (character as { localVoicePath?: string }).localVoicePath;
        if (oldVp && fs.existsSync(oldVp)) {
          try {
            fs.unlinkSync(oldVp);
          } catch {
            /* noop */
          }
        }
      } else if (v.startsWith('data:audio/')) {
        const oldVp = (character as { localVoicePath?: string }).localVoicePath;
        if (oldVp && fs.existsSync(oldVp)) {
          try {
            fs.unlinkSync(oldVp);
          } catch {
            /* noop */
          }
        }
        const persisted = persistCharacterVoiceDataUrl(characterId, v);
        if (persisted) {
          finalUpdates.voiceClip = persisted.localResourceUrl;
          finalUpdates.localVoicePath = persisted.fsPath;
        } else {
          delete finalUpdates.voiceClip;
          delete finalUpdates.localVoicePath;
        }
      } else {
        finalUpdates.voiceClip = v;
      }
    }

    if (updates.viewImages !== undefined) {
      const raw = Array.isArray(updates.viewImages) ? updates.viewImages : [];
      const paddedViews = [0, 1, 2, 3].map((i) => String(raw[i] ?? '').trim());
      const oldVps = (character as { localViewPaths?: string[] }).localViewPaths;
      if (Array.isArray(oldVps)) {
        for (const p of oldVps) {
          if (p && fs.existsSync(p)) {
            try {
              fs.unlinkSync(p);
            } catch {
              /* noop */
            }
          }
        }
      }
      if (!paddedViews.some(Boolean)) {
        finalUpdates.viewImages = ['', '', '', ''];
        finalUpdates.localViewPaths = undefined;
      } else {
        const { viewImages: viSlots, localViewPaths: lvPaths } = await persistCharacterFourViewSlots(characterId, paddedViews);
        finalUpdates.viewImages = viSlots;
        finalUpdates.localViewPaths = lvPaths.length ? lvPaths : undefined;
      }
    }

    if (updates.imageDescription !== undefined) {
      finalUpdates.imageDescription =
        typeof updates.imageDescription === 'string' ? updates.imageDescription.trim() : '';
    }
    
    characters[index] = { ...character, ...finalUpdates };
    store.set('characters', characters);
    return characters[index];
  }
  throw new Error('角色不存在');
});

ipcMain.handle('delete-character', (_, characterId: string) => {
  const characters = (store.get('characters') || []) as Array<{
    id: string;
    nickname: string;
    name: string;
    avatar: string;
    roleId?: string;
    createdAt: number;
    localAvatarPath?: string;
    localVoicePath?: string;
    localViewPaths?: string[];
    localGlbPath?: string;
    localTexturePath?: string;
  }>;
  const toRemove = characters.find((c) => c.id === characterId);
  const vp = toRemove?.localVoicePath;
  if (vp && fs.existsSync(vp)) {
    try {
      fs.unlinkSync(vp);
    } catch {
      /* noop */
    }
  }
  const vpaths = toRemove?.localViewPaths;
  if (Array.isArray(vpaths)) {
    for (const p of vpaths) {
      if (p && fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {
          /* noop */
        }
      }
    }
  }
  for (const p of [toRemove?.localGlbPath, toRemove?.localTexturePath]) {
    if (p && fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* noop */
      }
    }
  }
  const filtered = characters.filter((c) => c.id !== characterId);
  store.set('characters', filtered);
  return { success: true };
});

// 清理无效的头像 URL
ipcMain.handle('clear-invalid-avatar-url', (_, characterId: string, invalidUrl: string) => {
  const characters = (store.get('characters') || []) as Array<{
    id: string;
    nickname: string;
    name: string;
    avatar: string;
    roleId?: string;
    createdAt: number;
    localAvatarPath?: string;
  }>;
  
  const character = characters.find((c) => c.id === characterId);
  if (character && character.avatar === invalidUrl) {
    // 如果当前头像 URL 就是无效的 URL，清空它
    character.avatar = '';
    character.localAvatarPath = undefined;
    store.set('characters', characters);
    console.log(`[清理无效头像] 角色 ${characterId} 的头像 URL 已清空`);
    return { success: true };
  }
  return { success: false, message: '角色不存在或头像 URL 不匹配' };
});

// 上传本地视频到 OSS（用于角色创建模块）
ipcMain.handle('upload-local-video-to-oss', async (_, localVideoPath: string) => {
  try {
    const { VideoProvider } = await import('./ai/providers/VideoProvider.js');
    const videoProvider = new VideoProvider();
    
    console.log('[上传本地视频到OSS] 开始处理本地视频路径:', localVideoPath);
    
    const ossUrl = await videoProvider.uploadLocalVideoToOSS(localVideoPath);
    
    console.log('[上传本地视频到OSS] 上传成功，OSS URL:', ossUrl);
    return { success: true, url: ossUrl };
  } catch (error: any) {
    console.error('[上传本地视频到OSS] 上传失败:', error);
    return {
      success: false,
      error: error.message || '上传失败',
    };
  }
});

// 上传本地音频到 OSS（用于声音模块连接下一声音模块时，将参考音上传后回传 URL 到参考音输入框）
ipcMain.handle('upload-local-audio-to-oss', async (_, localAudioPath: string) => {
  try {
    const { VideoProvider } = await import('./ai/providers/VideoProvider.js');
    const videoProvider = new VideoProvider();
    const ossUrl = await videoProvider.uploadLocalAudioToOSS(localAudioPath);
    console.log('[上传本地音频到OSS] 上传成功，OSS URL:', ossUrl);
    return { success: true, url: ossUrl };
  } catch (error: any) {
    console.error('[上传本地音频到OSS] 上传失败:', error);
    return { success: false, error: error.message || '上传失败' };
  }
});

// 上传图片到 OSS（接收 base64 图片数据或 http URL）
ipcMain.handle('upload-image-to-oss', async (_, imageData: string) => {
  try {
    console.log('[上传图片到OSS] 开始处理图片数据，长度:', imageData.length);
    const { VideoProvider } = await import('./ai/providers/VideoProvider.js');
    const videoProvider = new VideoProvider();
    const publicUrl = await videoProvider.processImageToOssUrl(imageData);
    console.log('[上传图片到OSS] 图片上传成功，公网 URL:', publicUrl);
    return { success: true, url: publicUrl };
  } catch (error: any) {
    console.error('[上传图片到OSS] 上传失败:', error);
    return {
      success: false,
      error: error.message || '上传失败',
    };
  }
});

// 上传视频到 OSS
ipcMain.handle('upload-video-to-oss', async (_, videoUrl: string) => {
  try {
    const { VideoProvider } = await import('./ai/providers/VideoProvider.js');
    const videoProvider = new VideoProvider();
    
    console.log('[上传视频到OSS] 开始处理视频 URL:', videoUrl);
    
    let videoBuffer: Buffer;
    let mimeType = 'video/mp4';
    
    // 处理不同的视频 URL 格式
    if (videoUrl.startsWith('local-resource://') || videoUrl.startsWith('file://')) {
      let filePath: string;
      
      if (videoUrl.startsWith('local-resource://')) {
        filePath = videoUrl.replace(/^local-resource:\/\//, '');
        filePath = decodeURIComponent(filePath);
        // 处理 Windows 路径格式（c/Users -> C:/Users）
        if (filePath.match(/^[a-zA-Z]\//)) {
          filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
        }
        // 处理 /C:/ 格式（移除开头的 /）
        if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') {
          filePath = filePath.substring(1);
        }
      } else {
        filePath = videoUrl.replace(/^file:\/\//, '');
        if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') {
          filePath = filePath.substring(1);
        }
        filePath = decodeURIComponent(filePath);
      }
      
      const userDataPath = app.getPath('userData');
      const projectsBase = getProjectsBasePath();
      const normalizedFilePath = path.normalize(filePath);
      const allowedRoots = [
        path.normalize(userDataPath),
        path.normalize(projectsBase),
        path.normalize(app.getPath('home')),
        path.normalize(app.getPath('desktop')),
        path.normalize(app.getPath('documents')),
        path.normalize(app.getPath('downloads')),
        path.normalize(app.getPath('videos')),
        path.normalize(app.getPath('pictures')),
      ];
      const allowed = allowedRoots.some((root) => {
        const r = root.replace(/[/\\]+$/, '');
        const p = normalizedFilePath;
        if (process.platform === 'win32') {
          return p.toLowerCase().startsWith(r.toLowerCase() + path.sep) || p.toLowerCase().startsWith(r.toLowerCase() + '/') || p.toLowerCase() === r.toLowerCase();
        }
        return p.startsWith(r + path.sep) || p.startsWith(r + '/') || p === r;
      });
      if (!allowed) {
        throw new Error(`访问路径超出允许范围，请将视频放在用户目录、桌面、文档、下载或项目目录下: ${filePath}`);
      }
      if (!fs.existsSync(normalizedFilePath)) {
        throw new Error(`文件不存在: ${normalizedFilePath}`);
      }
      videoBuffer = await fs.promises.readFile(normalizedFilePath);
      
      // 根据文件扩展名确定 MIME 类型
      const ext = path.extname(normalizedFilePath).toLowerCase();
      if (ext === '.webm') {
        mimeType = 'video/webm';
      } else if (ext === '.mov') {
        mimeType = 'video/quicktime';
      } else if (ext === '.avi') {
        mimeType = 'video/x-msvideo';
      } else if (ext === '.mkv') {
        mimeType = 'video/x-matroska';
      }
      
      console.log('[上传视频到OSS] 从本地文件读取视频，大小:', videoBuffer.length, 'bytes');
    } else if (videoUrl.startsWith('data:video/')) {
      // Base64 数据 URL
      const base64Match = videoUrl.match(/^data:video\/([^;]+);base64,(.+)$/);
      if (!base64Match) {
        throw new Error('无效的 Base64 视频数据 URL');
      }
      const [, videoMimeType, base64Data] = base64Match;
      mimeType = `video/${videoMimeType}`;
      videoBuffer = Buffer.from(base64Data, 'base64');
      console.log('[上传视频到OSS] 从 Base64 数据读取视频，大小:', videoBuffer.length, 'bytes');
    } else if (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) {
      // 下载远程视频
      console.log('[上传视频到OSS] 开始下载远程视频:', videoUrl);
      const axios = (await import('axios')).default;
      const response = await axios.get(videoUrl, { responseType: 'arraybuffer' });
      videoBuffer = Buffer.from(response.data);
      
      // 尝试从 Content-Type 获取 MIME 类型
      const contentType = response.headers['content-type'];
      if (contentType && contentType.startsWith('video/')) {
        mimeType = contentType;
      }
      
      console.log('[上传视频到OSS] 远程视频下载完成，大小:', videoBuffer.length, 'bytes');
    } else {
      throw new Error(`不支持的视频 URL 格式: ${videoUrl.substring(0, 50)}`);
    }
    
    // 上传到 OSS
    console.log('[上传视频到OSS] 开始上传到 OSS，MIME 类型:', mimeType);
    const ossUrl = await videoProvider.uploadVideoToOSS(videoBuffer, mimeType);
    
    console.log('[上传视频到OSS] 上传成功，OSS URL:', ossUrl);
    return { success: true, url: ossUrl };
  } catch (error: any) {
    console.error('[上传视频到OSS] 上传失败:', error);
    return {
      success: false,
      error: error.message || '上传失败',
    };
  }
});

// 上传角色视频（经 FC 转发 RunningHub 国内站，不再直连 .cn）
ipcMain.handle('upload-character-video', async (_, videoUrl: string, timestamp?: string) => {
  const { fcForwardRequest } = await import('./utils/fcForwardTask.js');
  const {
    unwrapRunningHubForwardBody,
    extractRhTaskIdFromForward,
  } = await import('./utils/runningHubFcHelpers.js');

  // 专门处理 Electron 传过来的各种奇葩路径格式
  function sanitizePath(inputPath: string) {
    let p = inputPath.replace('local-resource://', '');
    // 如果是 /C:/ 这种格式，去掉开头的斜杠
    if (p.startsWith('/') && p.charAt(2) === ':') {
      p = p.substring(1);
    }
    // 转换为当前系统的标准分隔符
    return path.normalize(p);
  }

  try {
    let finalVideoUrl: string;
    
    // 检查 videoUrl 是否是公网 URL
    if (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) {
      // 已经是公网 URL，直接使用
      finalVideoUrl = videoUrl;
      console.log('[角色视频上传] 使用公网 URL:', finalVideoUrl);
    } else {
      // 不是公网 URL，需要上传到 OSS
      console.log('[角色视频上传] 检测到非公网 URL，开始上传到 OSS:', videoUrl);
      
      // 调用 uploadLocalVideoToOSS 上传到 OSS
      const { VideoProvider } = await import('./ai/providers/VideoProvider.js');
      const videoProvider = new VideoProvider();
      
      // 处理路径格式
      let localPath = videoUrl;
      if (videoUrl.startsWith('local-resource://')) {
        localPath = videoUrl.replace(/^local-resource:\/\//, '');
        localPath = decodeURIComponent(localPath);
        if (localPath.match(/^[a-zA-Z]\//)) {
          localPath = localPath[0].toUpperCase() + ':' + localPath.substring(1);
        }
      } else if (videoUrl.startsWith('file://')) {
        localPath = videoUrl.replace(/^file:\/\//, '');
        if (localPath.startsWith('/') && localPath.length > 1 && localPath[2] === ':') {
          localPath = localPath.substring(1);
        }
        localPath = decodeURIComponent(localPath);
      }
      
      // 使用路径漂白函数处理路径
      const sanitizedPath = sanitizePath(localPath);
      
      // 上传到 OSS
      finalVideoUrl = await videoProvider.uploadLocalVideoToOSS(sanitizedPath);
      console.log('[角色视频上传] 上传到 OSS 成功，OSS URL:', finalVideoUrl);
    }

    // 解析时间戳（格式：1,3 -> startTime: "1.3"）
    // 1,3 表示视频的1-3秒中出现的角色，转换为 startTime: "1.3"
    let startTimeStr = '1.3'; // 默认值
    if (timestamp && timestamp.trim()) {
      const parts = timestamp.split(',');
      if (parts.length === 2) {
        const start = parseFloat(parts[0].trim());
        const end = parseFloat(parts[1].trim());
        if (!isNaN(start) && !isNaN(end)) {
          // 将 "1,3" 转换为 "1.3"（开始时间.结束时间）
          startTimeStr = `${start}.${end}`;
        }
      } else {
        // 如果格式不正确，尝试直接使用
        const parsed = parseFloat(timestamp.trim());
        if (!isNaN(parsed)) {
          startTimeStr = parsed.toString();
        }
      }
    }

    // 构建请求体
    const requestBody = {
      videoUrl: finalVideoUrl,
      startTime: startTimeStr,
    };

    console.log('[角色视频上传] 最终提交给API的URL:', finalVideoUrl);
    console.log('[角色视频上传] 请求体:', JSON.stringify(requestBody, null, 2));

    const submitRaw = await fcForwardRequest(
      `sora-char:${randomUUID()}`,
      'video',
      'none',
      {
        provider: 'runninghub',
        path: '/rhart-video-s/sora-upload-character',
        method: 'POST',
        body: requestBody,
        rhRegion: 'cn',
      },
    );
    const submitResult = unwrapRunningHubForwardBody(submitRaw.data as Record<string, unknown>);
    const taskId = extractRhTaskIdFromForward(submitResult as Record<string, unknown>);

    if (!taskId) {
      throw new Error('未获取到任务ID');
    }

    const startTime = Date.now();
    const timeout = 10 * 60 * 1000;

    while (true) {
      if (Date.now() - startTime > timeout) {
        throw new Error('上传超时，请稍后重试');
      }

      try {
        const queryRaw = await fcForwardRequest(
          `sora-char-poll:${randomUUID()}`,
          'video',
          'none',
          {
            provider: 'runninghub',
            path: '/query',
            method: 'POST',
            body: { taskId },
            rhRegion: 'cn',
          },
        );
        const queryResult = unwrapRunningHubForwardBody(
          queryRaw.data as Record<string, unknown>,
        ) as Record<string, any>;
        const status = queryResult.status;

        // 添加调试日志
        console.log('[角色视频上传] 查询响应状态:', status);
        console.log('[角色视频上传] 完整响应数据:', JSON.stringify(queryResult, null, 2));

        if (status === 'SUCCESS') {
          // 首先尝试从 results 数组中获取 URL
          if (queryResult.results && queryResult.results.length > 0) {
            const result = queryResult.results[0];
            console.log('[角色视频上传] 结果对象:', JSON.stringify(result, null, 2));
            
            // 尝试多种可能的字段名
            const url = result.url || 
                       result.videoUrl || 
                       result.fileUrl || 
                       result.downloadUrl ||
                       result.video_url ||
                       result.file_url ||
                       result.download_url;
            
            // 提取 roleId（从 result.text 中提取）
            let roleId: string | undefined;
            if (result.text && typeof result.text === 'string') {
              roleId = result.text.trim();
              console.log('[角色视频上传] 提取到 roleId:', roleId);
            } else if (result.roleId) {
              roleId = result.roleId;
              console.log('[角色视频上传] 从 roleId 字段提取:', roleId);
            }
            
            if (url) {
              console.log('[角色视频上传] 找到 URL:', url);
              return { success: true, url, roleId: roleId || undefined };
            }
            
            // 如果 results[0] 中没有 URL，检查是否整个 result 就是一个 URL 字符串
            if (typeof result === 'string' && (result.startsWith('http://') || result.startsWith('https://'))) {
              console.log('[角色视频上传] 结果本身就是 URL:', result);
              return { success: true, url: result, roleId: roleId || undefined };
            }
            
            // 如果只有 roleId 没有 URL，也返回成功（URL 可能是可选的）
            if (roleId) {
              console.log('[角色视频上传] 找到 roleId 但未找到 URL，返回 roleId:', roleId);
              return { success: true, url: '', roleId };
            }
            
            console.error('[角色视频上传] 结果对象中没有找到 URL 或 roleId 字段');
            console.error('[角色视频上传] 结果对象的所有字段:', Object.keys(result));
            throw new Error('上传成功但未获取到 URL 或 roleId');
          } 
          
          // 如果 results 为空，尝试直接从 queryResult 中获取 URL
          const directUrl = queryResult.url || 
                           queryResult.videoUrl || 
                           queryResult.fileUrl || 
                           queryResult.downloadUrl ||
                           queryResult.video_url ||
                           queryResult.file_url ||
                           queryResult.download_url;
          
          // 尝试从 queryResult 中提取 roleId
          let roleId: string | undefined;
          if (queryResult.text && typeof queryResult.text === 'string') {
            roleId = queryResult.text.trim();
            console.log('[角色视频上传] 从 queryResult.text 提取到 roleId:', roleId);
          } else if (queryResult.roleId) {
            roleId = queryResult.roleId;
            console.log('[角色视频上传] 从 queryResult.roleId 提取:', roleId);
          }
          
          if (directUrl) {
            console.log('[角色视频上传] 从 queryResult 直接获取到 URL:', directUrl);
            return { success: true, url: directUrl, roleId: roleId || undefined };
          }
          
          // 如果只有 roleId 没有 URL，也返回成功
          if (roleId) {
            console.log('[角色视频上传] 找到 roleId 但未找到 URL，返回 roleId:', roleId);
            return { success: true, url: '', roleId };
          }
          
          console.error('[角色视频上传] 未找到任何 URL 或 roleId 字段');
          console.error('[角色视频上传] queryResult 的所有字段:', Object.keys(queryResult));
          throw new Error('上传成功但未获取到结果');
        } else if (status === 'FAILED' || status === 'FAILURE') {
          const errorMessage = queryResult.errorMessage || queryResult.error || '上传失败';
          const errorCode = queryResult.errorCode || '';
          throw new Error(errorCode ? `[错误码: ${errorCode}] ${errorMessage}` : errorMessage);
        } else if (status === 'QUEUED' || status === 'RUNNING') {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        } else {
          throw new Error(`未知状态: ${status}`);
        }
      } catch (error: any) {
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || error.message?.includes('socket hang up')) {
          console.log('[角色视频上传] 网络错误，5秒后重试...');
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }
        throw error;
      }
    }
  } catch (error: any) {
    console.error('[角色视频上传] 失败:', error);
    throw error;
  }
});

// 上传图片到 runninghub 并获取 view URL（用于 sora-2 图生视频；经 FC，国内站）
ipcMain.handle('upload-image-to-runninghub', async (_, imageUrl: string) => {
  const { fcForwardRequest } = await import('./utils/fcForwardTask.js');
  const {
    unwrapRunningHubForwardBody,
    extractRhTaskIdFromForward,
  } = await import('./utils/runningHubFcHelpers.js');

  try {
    // 如果已经是 runninghub view URL，直接返回
    if (imageUrl.includes('www.runninghub.cn/view') || imageUrl.includes('www.runninghub.ai/view')) {
      return { success: true, url: imageUrl };
    }

    // 修复数据源：准备图片 Buffer
    let imageBuffer: Buffer;
    let mimeType = 'image/png';
    let filename = 'image.png';

    if (imageUrl.startsWith('data:')) {
      // 如果输入是 data:image/...;base64，使用 Buffer.from(base64Data, 'base64') 将其转换为二进制 Buffer
      console.log('[图片上传] 检测到 data URL，转换为 Buffer');
      const base64Match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!base64Match) {
        throw new Error('无效的 data URL 格式');
      }
      
      const [, imageType, base64Data] = base64Match;
      mimeType = `image/${imageType}`;
      filename = `image.${imageType === 'jpeg' ? 'jpg' : imageType}`;
      
      // 不要直接把 Base64 字符串作为 URL 发送，转换为 Buffer
      imageBuffer = Buffer.from(base64Data, 'base64');
      console.log('[图片上传] data URL 已转换为 Buffer，大小:', imageBuffer.length, 'bytes');
    } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
      // 本地文件：读取文件
      let filePath: string;
      
      if (imageUrl.startsWith('local-resource://')) {
        filePath = imageUrl.replace(/^local-resource:\/\//, '');
        filePath = decodeURIComponent(filePath);
        
        if (filePath.match(/^[a-zA-Z]\//)) {
          filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
        }
      } else {
        filePath = imageUrl.replace(/^file:\/\//, '');
        if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') {
          filePath = filePath.substring(1);
        }
        filePath = decodeURIComponent(filePath);
      }
      
      const userDataPath = app.getPath('userData');
      const projectsBase = getProjectsBasePath();
      const normalizedFilePath = path.normalize(filePath);
      const normalizedUserData = path.normalize(userDataPath);
      const normalizedProjectsBase = path.normalize(projectsBase);
      const allowed = normalizedFilePath.startsWith(normalizedUserData) || normalizedFilePath.startsWith(normalizedProjectsBase);
      if (!allowed) {
        throw new Error(`访问路径超出允许范围: ${filePath}`);
      }
      if (!fs.existsSync(normalizedFilePath)) {
        throw new Error(`文件不存在: ${normalizedFilePath}`);
      }
      imageBuffer = fs.readFileSync(normalizedFilePath);
      const fileExt = path.extname(normalizedFilePath).toLowerCase();
      if (fileExt === '.jpg' || fileExt === '.jpeg') {
        mimeType = 'image/jpeg';
        filename = 'image.jpg';
      } else if (fileExt === '.png') {
        mimeType = 'image/png';
        filename = 'image.png';
      } else if (fileExt === '.webp') {
        mimeType = 'image/webp';
        filename = 'image.webp';
      }
      console.log('[图片上传] 本地文件已读取，大小:', imageBuffer.length, 'bytes');
    } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      // HTTP/HTTPS URL：下载图片
      console.log('[图片上传] 检测到 HTTP/HTTPS URL，开始下载...');
      const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      imageBuffer = Buffer.from(response.data);
      const contentType = response.headers['content-type'] || 'image/png';
      mimeType = contentType;
      filename = `image.${contentType.includes('jpeg') ? 'jpg' : contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'png'}`;
      console.log('[图片上传] HTTP 图片已下载，大小:', imageBuffer.length, 'bytes');
    } else {
      throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
    }

    console.log('[图片上传] 开始经 FC 提交上传任务，文件大小:', imageBuffer.length, 'bytes');

    let submitResult: Record<string, any>;
    try {
      const submitRaw = await fcForwardRequest(
        `sora-img:${randomUUID()}`,
        'video',
        'none',
        {
          provider: 'runninghub',
          path: '/rhart-video-s/upload-image',
          method: 'POST',
          uploadMultipart: {
            fieldName: 'file',
            filename,
            contentType: mimeType,
            base64: imageBuffer.toString('base64'),
          },
          rhRegion: 'cn',
        },
      );
      submitResult = unwrapRunningHubForwardBody(submitRaw.data as Record<string, unknown>) as Record<
        string,
        any
      >;
      console.log('[图片上传] 提交响应数据:', JSON.stringify(submitResult, null, 2));
    } catch (error: any) {
      console.error('[图片上传] 提交请求失败', error?.message || error);
      const msg = error?.message || '未知错误';
      if (/401|鉴权/i.test(msg)) {
        throw new Error('云端 RunningHub 鉴权失败，请检查 FC 的 RUNNINGHUB_API_KEY');
      }
      throw new Error(`图片上传失败: ${msg}`);
    }

    // 增加容错：打印完整的响应数据
    console.log('[图片上传] 完整响应数据（用于调试）:', JSON.stringify(submitResult, null, 2));
    
    // 检查响应格式：可能直接返回 URL，也可能返回 taskId
    if (submitResult.url && (submitResult.url.startsWith('http://') || submitResult.url.startsWith('https://'))) {
      console.log('[图片上传] API 直接返回了 URL:', submitResult.url);
      // 返回格式：确保成功后返回的 JSON 包含 filename
      return { success: true, url: submitResult.url, filename: submitResult.filename };
    }
    
    // 尝试多种可能的字段名获取 taskId
    const taskId =
      extractRhTaskIdFromForward(submitResult as Record<string, unknown>) ||
      submitResult.taskId ||
      submitResult.task_id ||
      submitResult.data?.taskId ||
      submitResult.data?.task_id ||
      submitResult.result?.taskId ||
      submitResult.result?.task_id;

    if (!taskId) {
      // 增加容错：打印完整的响应数据（错误路径）
      console.error('[图片上传] API 响应格式不正确，未找到 taskId');
      console.error('[图片上传] 完整响应数据（错误路径）:', JSON.stringify(submitResult, null, 2));
      console.error('[图片上传] 响应字段列表:', Object.keys(submitResult));
      
      // 检查是否有错误信息
      if (submitResult.error || submitResult.errorMessage || submitResult.message) {
        const errorMsg = submitResult.error || submitResult.errorMessage || submitResult.message;
        throw new Error(`图片上传失败: ${errorMsg}`);
      }
      
      // 如果响应中有其他有用信息，尝试提取
      if (submitResult.code !== undefined && submitResult.code !== 0) {
        throw new Error(`图片上传失败: 错误码 ${submitResult.code}, 消息: ${submitResult.message || submitResult.msg || '未知错误'}`);
      }
      
      throw new Error('未获取到任务ID，API 响应格式可能不正确。响应数据已记录到控制台，请检查 API 文档确认正确的端点。');
    }

    // 轮询任务状态
    const startTime = Date.now();
    const timeout = 10 * 60 * 1000; // 10分钟超时

    while (true) {
      if (Date.now() - startTime > timeout) {
        throw new Error('上传超时，请稍后重试');
      }

      try {
        const queryRaw = await fcForwardRequest(
          `sora-img-poll:${randomUUID()}`,
          'video',
          'none',
          {
            provider: 'runninghub',
            path: '/query',
            method: 'POST',
            body: { taskId },
            rhRegion: 'cn',
          },
        );
        const queryResult = unwrapRunningHubForwardBody(
          queryRaw.data as Record<string, unknown>,
        ) as Record<string, any>;
        const status = queryResult.status;

        if (status === 'SUCCESS') {
          // 上传成功，返回结果
          if (queryResult.results && queryResult.results.length > 0) {
            const result = queryResult.results[0];
            const resultUrl = result.url;
            
            // 如果返回的 URL 已经是完整的 view URL，直接使用
            if (resultUrl && typeof resultUrl === 'string' && resultUrl.includes('www.runninghub.cn/view')) {
              console.log('[图片上传] 返回完整的 view URL:', resultUrl);
              // 返回格式：确保成功后返回的 JSON 包含 filename
              return { success: true, url: resultUrl, filename: result.filename };
            }
            
            // 返回格式：确保成功后返回的 JSON 包含 filename，以便前端 VideoInputPanel 拼接出正确的 view?filename=... 地址
            const filename = result.filename || resultUrl;
            if (filename) {
              // 尝试从返回结果中提取 Rh-Comfy-Auth 和 Rh-Identify
              let rhComfyAuth: string | undefined;
              let rhIdentify: string | undefined;
              
              // 如果返回的 URL 中包含这些参数，提取它们
              if (typeof resultUrl === 'string' && resultUrl.includes('Rh-Comfy-Auth=')) {
                try {
                  const urlObj = new URL(resultUrl);
                  rhComfyAuth = urlObj.searchParams.get('Rh-Comfy-Auth') || undefined;
                  rhIdentify = urlObj.searchParams.get('Rh-Identify') || undefined;
                } catch (e) {
                  console.warn('[图片上传] 解析返回 URL 参数失败:', e);
                }
              }
              
              // 从响应中获取
              if (!rhComfyAuth) {
                rhComfyAuth = result.rhComfyAuth || result.auth || result['Rh-Comfy-Auth'];
              }
              if (!rhIdentify) {
                rhIdentify = result.rhIdentify || result.identify || result['Rh-Identify'];
              }
              
              // 构建 view URL
              const viewUrl = `https://www.runninghub.cn/view?filename=${encodeURIComponent(filename)}&type=input&subfolder=${rhComfyAuth ? `&Rh-Comfy-Auth=${encodeURIComponent(rhComfyAuth)}` : ''}${rhIdentify ? `&Rh-Identify=${encodeURIComponent(rhIdentify)}` : ''}&rand=${Math.random()}`;
              console.log('[图片上传] 构建的 view URL:', viewUrl);
              return { success: true, url: viewUrl, filename: filename };
            }
            throw new Error('上传成功但未获取到 filename 或 URL');
          } else {
            throw new Error('上传成功但未获取到结果');
          }
        } else if (status === 'FAILED' || status === 'FAILURE') {
          // 增加容错：打印失败响应数据
          console.error('[图片上传] 任务失败，完整响应数据:', JSON.stringify(queryResult, null, 2));
          const errorMessage = queryResult.errorMessage || queryResult.error || '上传失败';
          const errorCode = queryResult.errorCode || '';
          throw new Error(errorCode ? `[错误码: ${errorCode}] ${errorMessage}` : errorMessage);
        } else if (status === 'QUEUED' || status === 'RUNNING') {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        } else {
          throw new Error(`未知状态: ${status}`);
        }
      } catch (error: any) {
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || error.message?.includes('socket hang up')) {
          console.log('[图片上传] 网络错误，5秒后重试...');
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }
        throw error;
      }
    }
  } catch (error: any) {
    console.error('[图片上传] 失败:', error);
    throw error;
  }
});

// 抠图：先将图片上传到 OSS 得到公网 URL，再调用 matting 工作流；仅有效授权可用
function fileNameFromRemoteAssetUrl(remoteUrl: string, fallback: string): string {
  try {
    const base = decodeURIComponent(new URL(remoteUrl).pathname.split('/').pop() || '');
    const safe = base.replace(/[<>:"|?*\\]/g, '_').trim();
    if (safe) return safe;
  } catch {
    /* ignore */
  }
  return fallback;
}

async function downloadRemoteAssetToDir(remoteUrl: string, saveDir: string, fallbackName: string): Promise<string | null> {
  const url = remoteUrl?.trim();
  if (!url) return null;
  const fileName = fileNameFromRemoteAssetUrl(url, fallbackName);
  const filePath = path.join(saveDir, fileName);
  if (!fs.existsSync(filePath)) {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 600000,
      proxy: false,
    });
    fs.writeFileSync(filePath, Buffer.from(response.data));
    console.log(`[图片转3D] 资源已保存: ${filePath}`);
  }
  return filePath;
}

/** 下载 GLB；若为 zip 则解压出首个 .glb */
async function downloadGlbAssetToDir(
  remoteUrl: string,
  saveDir: string,
  fallbackName: string,
): Promise<string | null> {
  const saved = await downloadRemoteAssetToDir(remoteUrl, saveDir, fallbackName);
  if (!saved) return null;
  if (!saved.toLowerCase().endsWith('.zip')) return saved;
  try {
    const zip = new AdmZip(saved);
    const glbEntry = zip
      .getEntries()
      .find((e) => !e.isDirectory && /\.glb$/i.test(e.entryName));
    if (!glbEntry) {
      console.warn('[图片转3D] zip 内未找到 .glb:', saved);
      return null;
    }
    const base = path.basename(glbEntry.entryName) || 'model.glb';
    const glbDest = path.join(saveDir, base);
    fs.writeFileSync(glbDest, glbEntry.getData());
    console.log(`[图片转3D] 已从 zip 解压 GLB: ${glbDest}`);
    return glbDest;
  } catch (e) {
    console.error('[图片转3D] 解压 zip 失败', e);
    return null;
  }
}

/** 解析 GLB 内 JSON 块引用的外部贴图文件名（Hy3D 等 workflow 常用相对路径） */
function parseGlbExternalImageUris(glbPath: string): string[] {
  try {
    const buf = fs.readFileSync(glbPath);
    if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) return [];
    const jsonLen = buf.readUInt32LE(12);
    const jsonStart = 20;
    if (jsonStart + jsonLen > buf.length) return [];
    const json = JSON.parse(buf.toString('utf8', jsonStart, jsonStart + jsonLen)) as {
      images?: Array<{ uri?: string }>;
    };
    const uris: string[] = [];
    for (const img of json.images || []) {
      const uri = typeof img.uri === 'string' ? img.uri.trim() : '';
      if (!uri || uri.startsWith('data:')) continue;
      uris.push(uri.replace(/^\.\//, ''));
    }
    return uris;
  } catch (e) {
    console.warn('[图片转3D] 解析 GLB 外部贴图引用失败', e);
    return [];
  }
}

/** 从 Trellis2 等内嵌 baseColor 的 GLB 提取首张 PNG，供面板缩略图与预览兜底 */
function extractEmbeddedGlbBaseColorToPng(glbPath: string, destPath: string): boolean {
  try {
    const buf = fs.readFileSync(glbPath);
    if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) return false;
    const jsonLen = buf.readUInt32LE(12);
    const jsonStart = 20;
    const binStart = jsonStart + jsonLen;
    if (jsonStart + jsonLen > buf.length || binStart + 8 > buf.length) return false;
    const binLen = buf.readUInt32LE(binStart + 4);
    const binDataStart = binStart + 8;
    if (binDataStart + binLen > buf.length) return false;

    const root = JSON.parse(buf.toString('utf8', jsonStart, jsonStart + jsonLen)) as {
      materials?: Array<{ pbrMetallicRoughness?: { baseColorTexture?: { index?: number } } }>;
      textures?: Array<{ source?: number }>;
      images?: Array<{ bufferView?: number; mimeType?: string }>;
      bufferViews?: Array<{ byteOffset?: number; byteLength?: number }>;
    };
    const mat0 = root.materials?.[0]?.pbrMetallicRoughness;
    const texIndex = mat0?.baseColorTexture?.index;
    const sourceIndex =
      texIndex != null && root.textures?.[texIndex]?.source != null
        ? root.textures[texIndex].source
        : 0;
    const image = root.images?.[sourceIndex ?? 0];
    if (!image || image.bufferView == null) return false;
    const view = root.bufferViews?.[image.bufferView];
    if (!view || view.byteLength == null) return false;
    const offset = binDataStart + (view.byteOffset ?? 0);
    const length = view.byteLength;
    if (offset + length > buf.length) return false;
    const pngBytes = buf.subarray(offset, offset + length);
    if (pngBytes.length < 8) return false;
    fs.writeFileSync(destPath, pngBytes);
    console.log(`[图片转3D] 已从 GLB 内嵌提取 baseColor: ${destPath}`);
    return true;
  } catch (e) {
    console.warn('[图片转3D] 提取 GLB 内嵌 baseColor 失败', e);
    return false;
  }
}

/** 下载 GLB 及同任务贴图到同一目录（Hy3D 等 workflow 可能用外部贴图相对路径） */
async function downloadImageTo3dAssetsToProject(
  remoteGlbUrl: string,
  companionUrls: string[] | undefined,
  projectId?: string,
  nodeId?: string,
  preferredTextureUrl?: string,
): Promise<{ glbPath: string; resultTexturePath: string | null; resultTextureRemoteUrl: string | null } | null> {
  const glbUrl = remoteGlbUrl?.trim();
  if (!glbUrl) return null;
  const { pickBestTextureCompanionUrl } = await import('./services/runningHubAiAppFc.js');
  try {
    const userDataPath = app.getPath('userData');
    let saveDir: string;
    if (projectId?.trim()) {
      const { getProjectFolderPath } = await import('./utils/projectFolderHelper.js');
      const projectFolderPath = await getProjectFolderPath(projectId.trim());
      saveDir = projectFolderPath
        ? path.join(projectFolderPath, 'assets', 'models')
        : path.join(userDataPath, 'assets', 'models');
    } else {
      saveDir = path.join(userDataPath, 'assets', 'models');
    }
    if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

    const urlHash = crypto.createHash('md5').update(glbUrl).digest('hex').slice(0, 12);
    const glbPath = await downloadGlbAssetToDir(glbUrl, saveDir, `3d-${urlHash}.glb`);
    if (!glbPath) return null;

    const extras = (companionUrls || []).filter((u) => u?.trim() && u.trim() !== glbUrl);
    const pref = preferredTextureUrl?.trim();
    let textureRemote =
      pref && extras.includes(pref) ? pref : pickBestTextureCompanionUrl(extras);
    if (!textureRemote && pref && /^https?:\/\//i.test(pref)) {
      textureRemote = pref;
      if (!extras.includes(pref)) extras.unshift(pref);
    }
    let resultTexturePath: string | null = null;
    for (let i = 0; i < extras.length; i++) {
      const u = extras[i].trim();
      const saved = await downloadRemoteAssetToDir(u, saveDir, `3d-tex-${urlHash}-${i}.png`);
      if (saved && u === textureRemote) resultTexturePath = saved;
    }
    if (!resultTexturePath && textureRemote) {
      resultTexturePath = await downloadRemoteAssetToDir(
        textureRemote,
        saveDir,
        `3d-tex-${urlHash}-main.png`,
      );
    }

    /** GLB 引用外部贴图时，确保同目录存在对应文件（按 basename 匹配 companion） */
    const externalUris = parseGlbExternalImageUris(glbPath);
    for (const relUri of externalUris) {
      const base = path.basename(relUri.replace(/^\.\//, ''));
      const dest = path.join(saveDir, base);
      if (fs.existsSync(dest)) {
        if (!resultTexturePath) resultTexturePath = dest;
        continue;
      }
      const matchUrl = extras.find((u) => {
        try {
          return fileNameFromRemoteAssetUrl(u, '') === base;
        } catch {
          return u.toLowerCase().includes(base.toLowerCase());
        }
      });
      if (matchUrl) {
        const saved = await downloadRemoteAssetToDir(matchUrl, saveDir, base);
        if (saved) {
          if (!resultTexturePath) resultTexturePath = saved;
          if (!textureRemote) textureRemote = matchUrl;
        }
      }
    }

    if (!resultTexturePath) {
      const stem = path.basename(glbPath, path.extname(glbPath));
      const embeddedDest = path.join(saveDir, `${stem}-basecolor.png`);
      if (extractEmbeddedGlbBaseColorToPng(glbPath, embeddedDest)) {
        resultTexturePath = embeddedDest;
      }
    }

    return {
      glbPath,
      resultTexturePath,
      resultTextureRemoteUrl: textureRemote || null,
    };
  } catch (e) {
    console.error('[图片转3D] 下载 3D 资源失败', e);
    return null;
  }
}

function fsPathToLocalResourceUrl(filePath: string): string {
  let normalizedPath = filePath.replace(/\\/g, '/');
  if (normalizedPath.match(/^\/[a-zA-Z]:/)) {
    normalizedPath = normalizedPath.substring(1);
  }
  return `local-resource://${normalizedPath}`;
}

function resolveFsPathFromUrlish(urlOrPath: string | undefined): string | null {
  const v = (urlOrPath || '').trim();
  if (!v) return null;
  if (v.startsWith('local-resource://')) {
    let p = v.slice('local-resource://'.length);
    if (process.platform === 'win32' && p.match(/^\/[a-zA-Z]:/)) {
      p = p.substring(1);
    }
    p = p.replace(/\//g, path.sep);
    return fs.existsSync(p) ? p : null;
  }
  if (v.startsWith('file://')) {
    try {
      const p = fileURLToPath(v);
      return fs.existsSync(p) ? p : null;
    } catch {
      return null;
    }
  }
  if (fs.existsSync(v)) return v;
  return null;
}

function copyFileIntoCharacter3dDir(srcFsPath: string, destFileName: string): string | null {
  if (!srcFsPath || !fs.existsSync(srcFsPath)) return null;
  const userDataPath = app.getPath('userData');
  const dir = path.join(userDataPath, 'character-3d');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, destFileName);
  try {
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(srcFsPath, dest);
    }
    return dest;
  } catch (e) {
    console.error('[图片转3D] 复制到角色库失败:', e);
    return null;
  }
}

/** 图片转 3D 成功后写入全局角色列表（assetKind=imageTo3d） */
ipcMain.handle(
  'register-image-to-3d-character',
  async (
    _,
    payload: {
      nickname?: string;
      inputImageUrl?: string;
      localAvatarPath?: string;
      localGlbPath?: string;
      localGlbUrl?: string;
      remoteGlbUrl?: string;
      resultTextureLocalUrl?: string;
      resultTextureRemoteUrl?: string;
    },
  ) => {
    const characters = (store.get('characters') || []) as Array<Record<string, unknown>>;
    const characterId = `image3d-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const stamp = new Date();
    const defaultName = `3D ${stamp.getMonth() + 1}/${stamp.getDate()} ${String(stamp.getHours()).padStart(2, '0')}:${String(stamp.getMinutes()).padStart(2, '0')}`;
    const displayName = (payload.nickname || '').trim() || defaultName;

    const inputImage = (payload.inputImageUrl || '').trim();
    let finalAvatar = '';
    let localAvatarPath: string | undefined;

    // 导入 .aixflow 时 reference.png → 资产库卡片头像（localAvatarPath + avatar）
    const importAvatarFs = (payload.localAvatarPath || '').trim();
    if (importAvatarFs && fs.existsSync(importAvatarFs)) {
      const copiedRef = copyFileIntoCharacter3dDir(
        importAvatarFs,
        `${characterId}-ref${path.extname(importAvatarFs) || '.png'}`,
      );
      const avatarFs = copiedRef || importAvatarFs;
      localAvatarPath = avatarFs;
      finalAvatar = fsPathToLocalResourceUrl(avatarFs);
    }

    if (!localAvatarPath && inputImage && !inputImage.startsWith('local-resource://') && !inputImage.startsWith('data:') && !inputImage.startsWith('file://')) {
      try {
        const { autoDownloadResource } = await import('./utils/resourceDownloader.js');
        const localPath = await autoDownloadResource(inputImage, 'image', {
          nodeId: characterId,
          nodeTitle: displayName,
          projectId: undefined,
          resourceType: 'character-avatar',
        });
        if (localPath) {
          finalAvatar = fsPathToLocalResourceUrl(localPath);
          localAvatarPath = localPath;
        }
      } catch (error) {
        console.error('[图片转3D] 下载参考图缩略图失败:', error);
      }
    } else if (!localAvatarPath && inputImage.startsWith('data:image/')) {
      const one = await persistCharacterViewImageSlot(characterId, 0, inputImage);
      if (one?.url) {
        finalAvatar = one.url;
        if (one.fsPath) localAvatarPath = one.fsPath;
      }
    } else if (!localAvatarPath && inputImage) {
      const localRef = resolveFsPathFromUrlish(inputImage);
      if (localRef) {
        const copied = copyFileIntoCharacter3dDir(localRef, `${characterId}-ref${path.extname(localRef) || '.png'}`);
        if (copied) {
          finalAvatar = fsPathToLocalResourceUrl(copied);
          localAvatarPath = copied;
        } else {
          finalAvatar = inputImage;
        }
      } else {
        finalAvatar = inputImage;
      }
    }

    let localGlbPath: string | undefined;
    let localGlbUrl = (payload.localGlbUrl || '').trim();
    const glbSrc =
      resolveFsPathFromUrlish(payload.localGlbPath) ||
      resolveFsPathFromUrlish(payload.localGlbUrl) ||
      null;
    if (glbSrc) {
      const copiedGlb = copyFileIntoCharacter3dDir(glbSrc, `${characterId}.glb`);
      if (copiedGlb) {
        localGlbPath = copiedGlb;
        localGlbUrl = fsPathToLocalResourceUrl(copiedGlb);
      }
    } else if ((payload.remoteGlbUrl || '').trim()) {
      try {
        const userDataPath = app.getPath('userData');
        const dir = path.join(userDataPath, 'character-3d');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const saved = await downloadRemoteAssetToDir(payload.remoteGlbUrl!.trim(), dir, `${characterId}.glb`);
        if (saved) {
          localGlbPath = saved;
          localGlbUrl = fsPathToLocalResourceUrl(saved);
        }
      } catch (e) {
        console.error('[图片转3D] 下载 GLB 到角色库失败:', e);
      }
    }

    let resultTextureUrl: string | undefined;
    let localTexturePath: string | undefined;
    const texLocal =
      resolveFsPathFromUrlish(payload.resultTextureLocalUrl) ||
      resolveFsPathFromUrlish(payload.resultTextureRemoteUrl);
    if (texLocal) {
      const copiedTex = copyFileIntoCharacter3dDir(texLocal, `${characterId}-tex${path.extname(texLocal) || '.png'}`);
      if (copiedTex) {
        localTexturePath = copiedTex;
        resultTextureUrl = fsPathToLocalResourceUrl(copiedTex);
      }
    } else if ((payload.resultTextureRemoteUrl || '').trim()) {
      try {
        const userDataPath = app.getPath('userData');
        const dir = path.join(userDataPath, 'character-3d');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const saved = await downloadRemoteAssetToDir(
          payload.resultTextureRemoteUrl!.trim(),
          dir,
          `${characterId}-tex.png`,
        );
        if (saved) {
          localTexturePath = saved;
          resultTextureUrl = fsPathToLocalResourceUrl(saved);
        }
      } catch {
        /* optional texture */
      }
    }

    if (!localGlbPath && !localGlbUrl && !(payload.remoteGlbUrl || '').trim()) {
      throw new Error('没有可入库的 GLB 模型');
    }

    const refCoverUrl = finalAvatar || inputImage || '';
    const newCharacter = {
      id: characterId,
      assetKind: 'imageTo3d' as const,
      nickname: displayName,
      name: displayName,
      avatar: refCoverUrl,
      localAvatarPath,
      inputImageUrl: refCoverUrl,
      localGlbPath,
      localGlbUrl: localGlbUrl || undefined,
      remoteGlbUrl: (payload.remoteGlbUrl || '').trim() || undefined,
      resultTextureUrl,
      localTexturePath,
      createdAt: Date.now(),
    };

    characters.push(newCharacter);
    store.set('characters', characters);
    return newCharacter;
  },
);

function copyFileIntoSceneLibraryDir(srcFsPath: string, destFileName: string): string | null {
  if (!srcFsPath || !fs.existsSync(srcFsPath)) return null;
  const userDataPath = app.getPath('userData');
  const dir = path.join(userDataPath, 'scene-library');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, destFileName);
  try {
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(srcFsPath, dest);
    }
    return dest;
  } catch (e) {
    console.error('[场景库] 复制文件失败:', e);
    return null;
  }
}

ipcMain.handle('get-scenes', () => store.get('sceneLibrary') || []);

type SceneImageRole = 'normal' | 'display3d';

async function persistSceneLibraryImage(
  sceneId: string,
  role: SceneImageRole,
  raw: string,
): Promise<{ url: string; localPath?: string } | null> {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  const suffix = role === 'normal' ? '-normal' : '-display3d';

  if (trimmed.startsWith('data:image/')) {
    const one = await persistCharacterViewImageSlot(`${sceneId}${suffix}`, 0, trimmed);
    if (!one?.url) return null;
    return { url: one.url, localPath: one.fsPath };
  }

  const localRef = resolveFsPathFromUrlish(trimmed);
  if (localRef) {
    const ext = path.extname(localRef) || '.png';
    const copied = copyFileIntoSceneLibraryDir(localRef, `${sceneId}${suffix}${ext}`);
    if (!copied) return null;
    return { url: fsPathToLocalResourceUrl(copied), localPath: copied };
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const userDataPath = app.getPath('userData');
      const dir = path.join(userDataPath, 'scene-library');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const saved = await downloadRemoteAssetToDir(trimmed, dir, `${sceneId}${suffix}.png`);
      if (!saved) return null;
      return { url: fsPathToLocalResourceUrl(saved), localPath: saved };
    } catch (e) {
      console.error('[场景库] 下载远程场景图失败:', e);
      return null;
    }
  }

  return { url: trimmed };
}

ipcMain.handle(
  'register-scene',
  async (
    _,
    payload: {
      nickname?: string;
      panoramaUrl?: string;
      normalImageUrl?: string;
      display3dImageUrl?: string;
    },
  ) => {
    const scenes = (store.get('sceneLibrary') || []) as Array<Record<string, unknown>>;
    const sceneId = `scene-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const stamp = new Date();
    const defaultName = `场景 ${stamp.getMonth() + 1}/${stamp.getDate()} ${String(stamp.getHours()).padStart(2, '0')}:${String(stamp.getMinutes()).padStart(2, '0')}`;
    const displayName = (payload.nickname || '').trim() || defaultName;

    const normalRaw = (payload.normalImageUrl || '').trim();
    const displayRaw = (payload.display3dImageUrl || '').trim();
    const legacyRaw = (payload.panoramaUrl || '').trim();

    const isExplicitDual = Boolean(normalRaw && displayRaw);
    if (!isExplicitDual && !legacyRaw) {
      throw new Error('请同时提供正常图与 3D 展示图');
    }

    const normalSrc = normalRaw || legacyRaw;
    const displaySrc = displayRaw || legacyRaw;
    if (!normalSrc || !displaySrc) {
      throw new Error('请同时提供正常图与 3D 展示图');
    }

    const normal = await persistSceneLibraryImage(sceneId, 'normal', normalSrc);
    const display3d = await persistSceneLibraryImage(sceneId, 'display3d', displaySrc);
    if (!normal?.url || !display3d?.url) {
      throw new Error('场景图保存失败');
    }

    const newScene = {
      id: sceneId,
      nickname: displayName,
      name: displayName,
      avatar: normal.url,
      localAvatarPath: normal.localPath,
      normalImageUrl: normal.url,
      localNormalImagePath: normal.localPath,
      display3dImageUrl: display3d.url,
      localDisplay3dImagePath: display3d.localPath,
      panoramaUrl: display3d.url,
      localPanoramaPath: display3d.localPath,
      createdAt: Date.now(),
    };
    scenes.push(newScene);
    store.set('sceneLibrary', scenes);
    return newScene;
  },
);

ipcMain.handle(
  'update-scene',
  async (
    _,
    sceneId: string,
    updates: { nickname?: string; normalImageUrl?: string; display3dImageUrl?: string },
  ) => {
    const scenes = (store.get('sceneLibrary') || []) as Array<Record<string, unknown>>;
    const idx = scenes.findIndex((s) => s.id === sceneId);
    if (idx < 0) throw new Error('场景不存在');

    const scene = { ...scenes[idx] } as Record<string, unknown>;
    if (updates.nickname !== undefined) {
      const n = updates.nickname.trim();
      scene.nickname = n;
      scene.name = n;
    }

    if (updates.normalImageUrl !== undefined) {
      const raw = updates.normalImageUrl.trim();
      if (!raw) {
        scene.normalImageUrl = '';
        scene.localNormalImagePath = undefined;
        scene.avatar = '';
        scene.localAvatarPath = undefined;
      } else {
        const one = await persistSceneLibraryImage(sceneId, 'normal', raw);
        if (!one?.url) throw new Error('正常图保存失败');
        scene.normalImageUrl = one.url;
        scene.localNormalImagePath = one.localPath;
        scene.avatar = one.url;
        scene.localAvatarPath = one.localPath;
      }
    }

    if (updates.display3dImageUrl !== undefined) {
      const raw = updates.display3dImageUrl.trim();
      if (!raw) {
        scene.display3dImageUrl = '';
        scene.localDisplay3dImagePath = undefined;
        scene.panoramaUrl = '';
        scene.localPanoramaPath = undefined;
      } else {
        const one = await persistSceneLibraryImage(sceneId, 'display3d', raw);
        if (!one?.url) throw new Error('3D 展示图保存失败');
        scene.display3dImageUrl = one.url;
        scene.localDisplay3dImagePath = one.localPath;
        scene.panoramaUrl = one.url;
        scene.localPanoramaPath = one.localPath;
      }
    }

    scenes[idx] = scene;
    store.set('sceneLibrary', scenes);
    return scene;
  },
);

ipcMain.handle('delete-scenes', async (_, sceneIds: string[]) => {
  const ids = Array.isArray(sceneIds) ? sceneIds.filter(Boolean) : [];
  if (!ids.length) return { success: true };
  const scenes = (store.get('sceneLibrary') || []) as Array<{
    id: string;
    localPanoramaPath?: string;
    localAvatarPath?: string;
    localNormalImagePath?: string;
    localDisplay3dImagePath?: string;
  }>;
  const remove = new Set(ids);
  for (const s of scenes) {
    if (!remove.has(s.id)) continue;
    for (const p of [
      s.localPanoramaPath,
      s.localAvatarPath,
      s.localNormalImagePath,
      s.localDisplay3dImagePath,
    ]) {
      if (p && fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {
          /* ignore */
        }
      }
    }
  }
  store.set(
    'sceneLibrary',
    scenes.filter((s) => !remove.has(s.id)),
  );
  return { success: true };
});

ipcMain.handle('pick-scene-image', async (_, role?: SceneImageRole) => {
  const is3d = role === 'display3d';
  const { filePaths, canceled } = await dialog.showOpenDialog({
    title: is3d ? '上传 3D 展示图（全景/equirect）' : '上传正常图（平面展示）',
    properties: ['openFile'],
    filters: [
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
      { name: '全部', extensions: ['*'] },
    ],
  });
  if (canceled || !filePaths?.[0]) return { canceled: true };
  return { canceled: false, filePath: filePaths[0], role: role || 'normal' };
});

ipcMain.handle('pick-scene-upload', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog({
    title: '上传场景图',
    properties: ['openFile'],
    filters: [
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
      { name: '全部', extensions: ['*'] },
    ],
  });
  if (canceled || !filePaths?.[0]) return { canceled: true };
  return { canceled: false, filePath: filePaths[0] };
});

type SceneLibraryEntry = {
  id: string;
  nickname?: string;
  name?: string;
  avatar?: string;
  localAvatarPath?: string;
  normalImageUrl?: string;
  localNormalImagePath?: string;
  display3dImageUrl?: string;
  localDisplay3dImagePath?: string;
  panoramaUrl?: string;
  localPanoramaPath?: string;
};

async function readSceneRoleImageBuffer(
  scene: SceneLibraryEntry,
  role: SceneImageRole,
): Promise<Buffer | null> {
  if (role === 'normal') {
    return readFileBufferFromPathOrUrl({
      localPath: scene.localNormalImagePath || scene.localAvatarPath,
      remoteUrl: scene.normalImageUrl || scene.avatar,
    });
  }
  return readFileBufferFromPathOrUrl({
    localPath: scene.localDisplay3dImagePath || scene.localPanoramaPath,
    remoteUrl: scene.display3dImageUrl || scene.panoramaUrl,
  });
}

async function buildSceneAixflowZipBuffer(
  scene: SceneLibraryEntry,
  exportNickname?: string,
): Promise<Buffer> {
  const normalBuf = await readSceneRoleImageBuffer(scene, 'normal');
  const displayBuf = await readSceneRoleImageBuffer(scene, 'display3d');
  if (!normalBuf?.length || !displayBuf?.length) {
    throw new Error('没有可导出的场景图（需同时含正常图与 3D 展示图）');
  }
  const zip = new AdmZip();
  zip.addFile('normal.png', normalBuf);
  zip.addFile('display3d.png', displayBuf);
  zip.addFile(
    'manifest.json',
    Buffer.from(
      JSON.stringify(
        {
          format: 'nexflow-scene',
          version: 1,
          createdAt: Date.now(),
          nickname: (exportNickname || scene.nickname || scene.name || '').trim(),
          files: ['normal.png', 'display3d.png'],
        },
        null,
        2,
      ),
      'utf-8',
    ),
  );
  return zip.toBuffer();
}

function unpackSceneAixflowFile(filePath: string): {
  nickname: string;
  normalImageUrl: string;
  localNormalPath: string;
  display3dImageUrl: string;
  localDisplay3dPath: string;
} {
  const lower = filePath.toLowerCase();
  if (!lower.endsWith('.aixflow')) {
    throw new Error('仅支持 .aixflow 场景资产包');
  }
  const zip = new AdmZip(filePath);
  const normalEntry = zip.getEntry('normal.png');
  const displayEntry = zip.getEntry('display3d.png') || zip.getEntry('panorama.png');
  if (!normalEntry || !displayEntry) {
    throw new Error('无效的 .aixflow：缺少 normal.png 或 display3d.png');
  }
  let nickname = path.basename(filePath, path.extname(filePath)) || '场景';
  const manifestEntry = zip.getEntry('manifest.json');
  if (manifestEntry) {
    try {
      const manifest = JSON.parse(manifestEntry.getData().toString('utf-8')) as { nickname?: string };
      if ((manifest.nickname || '').trim()) nickname = manifest.nickname!.trim();
    } catch {
      /* ignore */
    }
  }
  const importId = `scene-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const userDataPath = app.getPath('userData');
  const dir = path.join(userDataPath, 'scene-library');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const normalDest = path.join(dir, `${importId}-normal.png`);
  const displayDest = path.join(dir, `${importId}-display3d.png`);
  fs.writeFileSync(normalDest, normalEntry.getData());
  fs.writeFileSync(displayDest, displayEntry.getData());
  return {
    nickname,
    normalImageUrl: fsPathToLocalResourceUrl(normalDest),
    localNormalPath: normalDest,
    display3dImageUrl: fsPathToLocalResourceUrl(displayDest),
    localDisplay3dPath: displayDest,
  };
}

/** 导出场景库条目为 .aixflow（含 normal + display3d） */
ipcMain.handle('export-scenes', async (_, sceneIds: string[]) => {
  const all = (store.get('sceneLibrary') || []) as SceneLibraryEntry[];
  const idSet = Array.isArray(sceneIds) && sceneIds.length > 0 ? new Set(sceneIds) : null;
  const targets = all.filter((s) => !idSet || idSet.has(s.id));
  if (!targets.length) {
    return { success: false, error: '没有可导出的场景' };
  }

  try {
    if (targets.length === 1) {
      const s = targets[0];
      const label = safeExportBaseName(s.nickname || s.name || 'scene');
      const { filePath, canceled } = await dialog.showSaveDialog({
        title: '导出场景',
        defaultPath: `${label}.aixflow`,
        filters: [{ name: 'Aixflow 场景资产包', extensions: ['aixflow'] }],
      });
      if (canceled || !filePath) {
        return { success: false, error: '已取消' };
      }
      const dest = /\.aixflow$/i.test(filePath) ? filePath : `${filePath}.aixflow`;
      const buffer = await buildSceneAixflowZipBuffer(s, s.nickname || s.name);
      fs.writeFileSync(dest, buffer);
      return { success: true, filePath: dest, count: 1 };
    }

    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: '选择导出文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });
    const dir = filePaths?.[0];
    if (canceled || !dir) {
      return { success: false, error: '已取消' };
    }
    const usedNames = new Set<string>();
    let count = 0;
    for (const s of targets) {
      const base = safeExportBaseName(s.nickname || s.name || s.id);
      let fileName = `${base}.aixflow`;
      let n = 2;
      while (usedNames.has(fileName)) {
        fileName = `${base}-${n}.aixflow`;
        n += 1;
      }
      usedNames.add(fileName);
      const buffer = await buildSceneAixflowZipBuffer(s, s.nickname || s.name);
      fs.writeFileSync(path.join(dir, fileName), buffer);
      count += 1;
    }
    return { success: true, filePath: dir, count };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '导出失败';
    return { success: false, error: msg };
  }
});

/** 导入 .aixflow 场景资产包 */
ipcMain.handle('import-scenes', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog({
    title: '导入场景',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Aixflow 场景资产包', extensions: ['aixflow'] }],
  });
  if (canceled || !filePaths?.length) {
    return { success: false, canceled: true, count: 0 };
  }

  const scenes = (store.get('sceneLibrary') || []) as Array<Record<string, unknown>>;
  let count = 0;
  const errors: string[] = [];

  for (const fp of filePaths) {
    try {
      const item = unpackSceneAixflowFile(fp);
      const sceneId = `scene-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const displayName = item.nickname || `场景 ${count + 1}`;
      scenes.push({
        id: sceneId,
        nickname: displayName,
        name: displayName,
        avatar: item.normalImageUrl,
        localAvatarPath: item.localNormalPath,
        normalImageUrl: item.normalImageUrl,
        localNormalImagePath: item.localNormalPath,
        display3dImageUrl: item.display3dImageUrl,
        localDisplay3dImagePath: item.localDisplay3dPath,
        panoramaUrl: item.display3dImageUrl,
        localPanoramaPath: item.localDisplay3dPath,
        createdAt: Date.now(),
      });
      count += 1;
      await new Promise((r) => setTimeout(r, 2));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  if (count > 0) {
    store.set('sceneLibrary', scenes);
  }

  if (!count && errors.length) {
    return { success: false, count: 0, error: errors[0] };
  }
  return {
    success: count > 0,
    count,
    error: errors.length ? `部分文件导入失败：${errors[0]}` : undefined,
  };
});

// —— 数字人资产库（HeyGem 参考视频 + 驱动音频） ——
function copyFileIntoDigitalHumanLibraryDir(srcFsPath: string, destFileName: string): string | null {
  if (!srcFsPath || !fs.existsSync(srcFsPath)) return null;
  const userDataPath = app.getPath('userData');
  const dir = path.join(userDataPath, 'digital-human-library');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, destFileName);
  try {
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(srcFsPath, dest);
    }
    return dest;
  } catch (e) {
    console.error('[数字人库] 复制文件失败:', e);
    return null;
  }
}

type DigitalHumanMediaRole = 'video' | 'audio' | 'poster';

async function persistDigitalHumanLibraryMedia(
  itemId: string,
  role: DigitalHumanMediaRole,
  raw: string,
): Promise<{ url: string; localPath?: string; originalUrl?: string } | null> {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  const suffix =
    role === 'video' ? '-video' : role === 'audio' ? '-audio' : '-poster';

  if (trimmed.startsWith('data:image/')) {
    const one = await persistCharacterViewImageSlot(`${itemId}${suffix}`, 0, trimmed);
    if (!one?.url) return null;
    return { url: one.url, localPath: one.fsPath };
  }

  if (trimmed.startsWith('data:audio/')) {
    const persisted = persistCharacterVoiceDataUrl(`${itemId}${suffix}`, trimmed);
    if (!persisted) return null;
    return { url: persisted.localResourceUrl, localPath: persisted.fsPath };
  }

  let localRef = resolveFsPathFromUrlish(trimmed);
  if (!localRef && trimmed.startsWith('local-resource://')) {
    try {
      const body = trimmed.slice('local-resource://'.length);
      const decoded = localResourceUrlBodyToFsPath(body, false);
      if (decoded && fs.existsSync(decoded)) localRef = decoded;
    } catch {
      /* fallback below */
    }
  }
  if (localRef) {
    const ext = path.extname(localRef) || (role === 'audio' ? '.mp3' : role === 'video' ? '.mp4' : '.png');
    const copied = copyFileIntoDigitalHumanLibraryDir(localRef, `${itemId}${suffix}${ext}`);
    if (copied) {
      return { url: fsPathToLocalResourceUrl(copied), localPath: copied };
    }
    const fallbackUrl = trimmed.startsWith('local-resource://')
      ? trimmed
      : fsPathToLocalResourceUrl(localRef);
    return { url: fallbackUrl, localPath: localRef };
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const userDataPath = app.getPath('userData');
      const dir = path.join(userDataPath, 'digital-human-library');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const fallback =
        role === 'audio'
          ? `${itemId}${suffix}.mp3`
          : role === 'video'
            ? `${itemId}${suffix}.mp4`
            : `${itemId}${suffix}.png`;
      const saved = await downloadRemoteAssetToDir(trimmed, dir, fallback);
      if (!saved) return null;
      return { url: fsPathToLocalResourceUrl(saved), localPath: saved, originalUrl: trimmed };
    } catch (e) {
      console.error('[数字人库] 下载远程媒体失败:', e);
      return { url: trimmed, originalUrl: trimmed };
    }
  }

  return { url: trimmed };
}

ipcMain.handle('get-digital-humans', () => store.get('digitalHumanLibrary') || []);

ipcMain.handle(
  'register-digital-human',
  async (
    _,
    payload: {
      nickname?: string;
      videoUrl?: string;
      audioUrl?: string;
      posterUrl?: string;
    },
  ) => {
    const items = (store.get('digitalHumanLibrary') || []) as Array<Record<string, unknown>>;
    const itemId = `dh-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const stamp = new Date();
    const defaultName = `数字人 ${stamp.getMonth() + 1}/${stamp.getDate()} ${String(stamp.getHours()).padStart(2, '0')}:${String(stamp.getMinutes()).padStart(2, '0')}`;
    const displayName = (payload.nickname || '').trim() || defaultName;

    const videoRaw = (payload.videoUrl || '').trim();
    const audioRaw = (payload.audioUrl || '').trim();
    if (!videoRaw) {
      throw new Error('请提供参考视频');
    }

    const video = await persistDigitalHumanLibraryMedia(itemId, 'video', videoRaw);
    if (!video?.url) {
      throw new Error('参考视频保存失败');
    }

    let audioUrl: string | undefined;
    let localAudioPath: string | undefined;
    let originalAudioUrl: string | undefined;
    if (audioRaw) {
      const audio = await persistDigitalHumanLibraryMedia(itemId, 'audio', audioRaw);
      if (!audio?.url) {
        throw new Error('驱动音频保存失败');
      }
      audioUrl = audio.url;
      localAudioPath = audio.localPath;
      originalAudioUrl = audio.originalUrl || (audioRaw.startsWith('http') ? audioRaw : undefined);
    }

    let posterUrl = '';
    let localPosterPath: string | undefined;
    const posterRaw = (payload.posterUrl || '').trim();
    if (posterRaw) {
      const poster = await persistDigitalHumanLibraryMedia(itemId, 'poster', posterRaw);
      if (poster?.url) {
        posterUrl = poster.url;
        localPosterPath = poster.localPath;
      }
    }
    if (!posterUrl && video.localPath) {
      try {
        const auto = await localResourceManager.ensureDigitalHumanVideoPoster(video.localPath, itemId);
        posterUrl = auto.posterUrl;
        localPosterPath = auto.localPosterPath;
      } catch (e) {
        console.warn('[数字人] 自动生成列表头像失败:', e);
      }
    }

    const newItem = {
      id: itemId,
      nickname: displayName,
      name: displayName,
      poster: posterUrl || undefined,
      localPosterPath,
      videoUrl: video.url,
      localVideoPath: video.localPath,
      originalVideoUrl: video.originalUrl || (videoRaw.startsWith('http') ? videoRaw : undefined),
      audioUrl,
      localAudioPath,
      originalAudioUrl,
      createdAt: Date.now(),
    };

    items.push(newItem);
    store.set('digitalHumanLibrary', items);
    return newItem;
  },
);

ipcMain.handle(
  'update-digital-human',
  async (
    _,
    itemId: string,
    updates: {
      nickname?: string;
      videoUrl?: string;
      audioUrl?: string;
      posterUrl?: string;
    },
  ) => {
    const items = (store.get('digitalHumanLibrary') || []) as Array<Record<string, unknown>>;
    const idx = items.findIndex((s) => s.id === itemId);
    if (idx < 0) throw new Error('数字人条目不存在');

    const item = { ...items[idx] } as Record<string, unknown>;

    if (updates.nickname !== undefined) {
      const n = updates.nickname.trim();
      item.nickname = n;
      item.name = n;
    }

    if (updates.videoUrl !== undefined) {
      const raw = updates.videoUrl.trim();
      if (!raw) {
        item.videoUrl = '';
        item.localVideoPath = undefined;
        item.originalVideoUrl = undefined;
      } else {
        const one = await persistDigitalHumanLibraryMedia(itemId, 'video', raw);
        if (!one?.url) throw new Error('参考视频保存失败');
        item.videoUrl = one.url;
        item.localVideoPath = one.localPath;
        item.originalVideoUrl = one.originalUrl || (raw.startsWith('http') ? raw : item.originalVideoUrl);
      }
    }

    if (updates.audioUrl !== undefined) {
      const raw = updates.audioUrl.trim();
      if (!raw) {
        item.audioUrl = '';
        item.localAudioPath = undefined;
        item.originalAudioUrl = undefined;
      } else {
        const one = await persistDigitalHumanLibraryMedia(itemId, 'audio', raw);
        if (!one?.url) throw new Error('驱动音频保存失败');
        item.audioUrl = one.url;
        item.localAudioPath = one.localPath;
        item.originalAudioUrl = one.originalUrl || (raw.startsWith('http') ? raw : item.originalAudioUrl);
      }
    }

    if (updates.posterUrl !== undefined) {
      const raw = updates.posterUrl.trim();
      if (!raw) {
        item.poster = '';
        item.localPosterPath = undefined;
      } else {
        const one = await persistDigitalHumanLibraryMedia(itemId, 'poster', raw);
        if (one?.url) {
          item.poster = one.url;
          item.localPosterPath = one.localPath;
        }
      }
    }

    items[idx] = item;
    store.set('digitalHumanLibrary', items);
    return item;
  },
);

ipcMain.handle('delete-digital-humans', async (_, itemIds: string[]) => {
  const ids = Array.isArray(itemIds) ? itemIds.filter(Boolean) : [];
  if (!ids.length) return { success: true };
  const remove = new Set(ids);
  const items = (store.get('digitalHumanLibrary') || []) as Array<{
    id: string;
    localVideoPath?: string;
    localAudioPath?: string;
    localPosterPath?: string;
  }>;

  for (const s of items) {
    if (!remove.has(s.id)) continue;
    for (const p of [s.localVideoPath, s.localAudioPath, s.localPosterPath]) {
      if (p && fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {
          /* ignore */
        }
      }
    }
  }

  store.set(
    'digitalHumanLibrary',
    items.filter((s) => !remove.has(s.id)),
  );
  return { success: true };
});

// —— RVC 音色模型资产库（训练 zip 包） ——
function copyFileIntoRvcVoiceLibraryDir(srcFsPath: string, destFileName: string): string | null {
  if (!srcFsPath || !fs.existsSync(srcFsPath)) return null;
  const userDataPath = app.getPath('userData');
  const dir = path.join(userDataPath, 'rvc-voice-library');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, destFileName);
  try {
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(srcFsPath, dest);
    }
    return dest;
  } catch (e) {
    console.error('[RVC音色库] 复制文件失败:', e);
    return null;
  }
}

function inferRvcModelPackageExt(rawUrl: string): string {
  const u = (rawUrl || '').trim().toLowerCase();
  if (/\.zip(\?|$)/.test(u)) return '.zip';
  if (/\.pth(\?|$)/.test(u)) return '.pth';
  if (/\.index(\?|$)/.test(u)) return '.index';
  if (/\.tar\.gz(\?|$)/.test(u)) return '.tar.gz';
  if (/\.tgz(\?|$)/.test(u)) return '.tgz';
  return '.zip';
}

async function persistRvcVoiceLibraryPackage(
  itemId: string,
  raw: string,
): Promise<{ url: string; localPath?: string; originalUrl?: string } | null> {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  let localRef = resolveFsPathFromUrlish(trimmed);
  if (!localRef && trimmed.startsWith('local-resource://')) {
    try {
      const body = trimmed.slice('local-resource://'.length);
      const decoded = localResourceUrlBodyToFsPath(body, false);
      if (decoded && fs.existsSync(decoded)) localRef = decoded;
    } catch {
      /* fallback below */
    }
  }
  if (localRef) {
    const ext = path.extname(localRef) || inferRvcModelPackageExt(trimmed);
    const copied = copyFileIntoRvcVoiceLibraryDir(localRef, `${itemId}${ext}`);
    if (copied) {
      return { url: fsPathToLocalResourceUrl(copied), localPath: copied };
    }
    const fallbackUrl = trimmed.startsWith('local-resource://')
      ? trimmed
      : fsPathToLocalResourceUrl(localRef);
    return { url: fallbackUrl, localPath: localRef };
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const userDataPath = app.getPath('userData');
      const dir = path.join(userDataPath, 'rvc-voice-library');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const ext = inferRvcModelPackageExt(trimmed);
      const saved = await downloadRemoteAssetToDir(trimmed, dir, `${itemId}${ext}`);
      if (!saved) return null;
      return { url: fsPathToLocalResourceUrl(saved), localPath: saved, originalUrl: trimmed };
    } catch (e) {
      console.error('[RVC音色库] 下载远程模型包失败:', e);
      return { url: trimmed, originalUrl: trimmed };
    }
  }

  return { url: trimmed };
}

function deriveRvcPackageFileBaseName(localPath?: string, rawUrl?: string): string {
  if (localPath) {
    const base = path.basename(localPath, path.extname(localPath));
    if (base.trim()) return base.trim();
  }
  const raw = (rawUrl || '').trim();
  if (!raw) return 'RVC';
  const seg = raw.split('?')[0].split(/[/\\]/).pop() || 'RVC';
  return seg.replace(/\.(zip|pth|index|tar\.gz|tgz)$/i, '').trim() || 'RVC';
}

async function persistRvcVoiceLibraryAvatar(
  itemId: string,
  raw: string,
): Promise<{ url: string; localPath?: string } | null> {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('data:image/')) {
    const one = await persistCharacterViewImageSlot(`${itemId}-avatar`, 0, trimmed);
    if (!one?.url) return null;
    return { url: one.url, localPath: one.fsPath };
  }

  const localRef = resolveFsPathFromUrlish(trimmed);
  if (localRef) {
    const ext = path.extname(localRef) || '.png';
    const copied = copyFileIntoRvcVoiceLibraryDir(localRef, `${itemId}-avatar${ext}`);
    if (!copied) return null;
    return { url: fsPathToLocalResourceUrl(copied), localPath: copied };
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const userDataPath = app.getPath('userData');
      const dir = path.join(userDataPath, 'rvc-voice-library');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const saved = await downloadRemoteAssetToDir(trimmed, dir, `${itemId}-avatar.png`);
      if (!saved) return null;
      return { url: fsPathToLocalResourceUrl(saved), localPath: saved };
    } catch (e) {
      console.error('[RVC音色库] 下载头像失败:', e);
      return null;
    }
  }

  return { url: trimmed };
}

function inferRvcTrainAudioExt(raw: string): string {
  const u = (raw || '').toLowerCase();
  if (/\.wav(\?|$)/.test(u)) return '.wav';
  if (/\.ogg(\?|$)/.test(u)) return '.ogg';
  if (/\.m4a(\?|$)/.test(u)) return '.m4a';
  if (/\.flac(\?|$)/.test(u)) return '.flac';
  if (/\.aac(\?|$)/.test(u)) return '.aac';
  return '.mp3';
}

async function persistRvcVoiceLibraryTrainAudio(
  itemId: string,
  raw: string,
): Promise<{ url: string; localPath?: string; originalUrl?: string } | null> {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  let localRef = resolveFsPathFromUrlish(trimmed);
  if (!localRef && trimmed.startsWith('local-resource://')) {
    try {
      const body = trimmed.slice('local-resource://'.length);
      const decoded = localResourceUrlBodyToFsPath(body, false);
      if (decoded && fs.existsSync(decoded)) localRef = decoded;
    } catch {
      /* fallback below */
    }
  }
  if (localRef) {
    const ext = path.extname(localRef) || inferRvcTrainAudioExt(trimmed);
    const copied = copyFileIntoRvcVoiceLibraryDir(localRef, `${itemId}-train${ext}`);
    if (copied) {
      return { url: fsPathToLocalResourceUrl(copied), localPath: copied };
    }
    const fallbackUrl = trimmed.startsWith('local-resource://')
      ? trimmed
      : fsPathToLocalResourceUrl(localRef);
    return { url: fallbackUrl, localPath: localRef };
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const userDataPath = app.getPath('userData');
      const dir = path.join(userDataPath, 'rvc-voice-library');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const ext = inferRvcTrainAudioExt(trimmed);
      const saved = await downloadRemoteAssetToDir(trimmed, dir, `${itemId}-train${ext}`);
      if (!saved) return null;
      return { url: fsPathToLocalResourceUrl(saved), localPath: saved, originalUrl: trimmed };
    } catch (e) {
      console.error('[RVC音色库] 下载训练音频失败:', e);
      return { url: trimmed, originalUrl: trimmed };
    }
  }

  return { url: trimmed };
}

ipcMain.handle('get-rvc-voices', () => store.get('rvcVoiceLibrary') || []);

ipcMain.handle('get-rvc-engine-status', async () => {
  const { getRvcEngineStatus } = await import('./services/localRvcEngine.js');
  return getRvcEngineStatus();
});

ipcMain.handle('download-rvc-engine', async () => {
  const { downloadRvcEngineBundle, getRvcEngineStatus } = await import('./services/localRvcEngine.js');
  await downloadRvcEngineBundle();
  return getRvcEngineStatus();
});

ipcMain.handle('get-whisper-engine-status', async () => {
  const { getWhisperEngineStatus } = await import('./services/localWhisperEngine.js');
  return getWhisperEngineStatus();
});

ipcMain.handle('download-whisper-engine', async () => {
  const { downloadWhisperEngineBundle, getWhisperEngineStatus } = await import('./services/localWhisperEngine.js');
  await downloadWhisperEngineBundle();
  return getWhisperEngineStatus();
});

ipcMain.handle(
  'register-rvc-voice',
  async (
    _,
    payload: {
      nickname?: string;
      modelPackageUrl?: string;
      modelPackageRemoteUrl?: string;
      rvcTrainModelName?: string;
      avatarUrl?: string;
      trainAudioUrl?: string;
      trainAudioRemoteUrl?: string;
    },
  ) => {
    const items = (store.get('rvcVoiceLibrary') || []) as Array<Record<string, unknown>>;
    const itemId = `rvc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const packageRaw = (payload.modelPackageUrl || payload.modelPackageRemoteUrl || '').trim();
    if (!packageRaw) {
      throw new Error('请提供 RVC 模型包');
    }

    const pkg = await persistRvcVoiceLibraryPackage(itemId, packageRaw);
    if (!pkg?.url) {
      throw new Error('RVC 模型包保存失败');
    }

    const packageFileName = deriveRvcPackageFileBaseName(pkg.localPath, packageRaw);
    const modelName = (payload.rvcTrainModelName || '').trim();
    const displayName = (payload.nickname || modelName || '').trim() || packageFileName;

    let avatarUrl = '';
    let localAvatarPath: string | undefined;
    const avatarRaw = (payload.avatarUrl || '').trim();
    if (avatarRaw) {
      const av = await persistRvcVoiceLibraryAvatar(itemId, avatarRaw);
      if (av?.url) {
        avatarUrl = av.url;
        localAvatarPath = av.localPath;
      }
    }

    let trainAudioUrl = '';
    let localTrainAudioPath: string | undefined;
    let originalTrainAudioUrl: string | undefined;
    const trainRaw = (payload.trainAudioUrl || payload.trainAudioRemoteUrl || '').trim();
    if (trainRaw) {
      const ta = await persistRvcVoiceLibraryTrainAudio(itemId, trainRaw);
      if (ta?.url) {
        trainAudioUrl = ta.url;
        localTrainAudioPath = ta.localPath;
        originalTrainAudioUrl = ta.originalUrl || (trainRaw.startsWith('http') ? trainRaw : undefined);
      }
    }

    const newItem = {
      id: itemId,
      nickname: displayName,
      name: displayName,
      avatar: avatarUrl || undefined,
      localAvatarPath,
      packageFileName,
      rvcTrainModelName: modelName || undefined,
      modelPackageUrl: pkg.url,
      localModelPath: pkg.localPath,
      originalModelUrl:
        pkg.originalUrl ||
        (payload.modelPackageRemoteUrl?.startsWith('http') ? payload.modelPackageRemoteUrl : undefined),
      trainAudioUrl: trainAudioUrl || undefined,
      localTrainAudioPath,
      originalTrainAudioUrl,
      createdAt: Date.now(),
    };

    items.push(newItem);
    store.set('rvcVoiceLibrary', items);
    return newItem;
  },
);

ipcMain.handle(
  'update-rvc-voice',
  async (
    _,
    itemId: string,
    updates: {
      nickname?: string;
      modelPackageUrl?: string;
      rvcTrainModelName?: string;
      avatarUrl?: string;
      trainAudioUrl?: string;
    },
  ) => {
    const items = (store.get('rvcVoiceLibrary') || []) as Array<Record<string, unknown>>;
    const idx = items.findIndex((s) => s.id === itemId);
    if (idx < 0) throw new Error('RVC 音色条目不存在');

    const item = { ...items[idx] } as Record<string, unknown>;

    if (updates.nickname !== undefined) {
      const n = updates.nickname.trim();
      item.nickname = n;
      item.name = n;
    }
    if (updates.rvcTrainModelName !== undefined) {
      item.rvcTrainModelName = updates.rvcTrainModelName.trim();
    }
    if (updates.avatarUrl !== undefined) {
      const raw = updates.avatarUrl.trim();
      if (!raw) {
        item.avatar = '';
        item.localAvatarPath = undefined;
      } else {
        const one = await persistRvcVoiceLibraryAvatar(itemId, raw);
        if (one?.url) {
          item.avatar = one.url;
          item.localAvatarPath = one.localPath;
        }
      }
    }
    if (updates.modelPackageUrl !== undefined) {
      const raw = updates.modelPackageUrl.trim();
      if (!raw) {
        item.modelPackageUrl = '';
        item.localModelPath = undefined;
        item.originalModelUrl = undefined;
      } else {
        const one = await persistRvcVoiceLibraryPackage(itemId, raw);
        if (!one?.url) throw new Error('RVC 模型包保存失败');
        item.modelPackageUrl = one.url;
        item.localModelPath = one.localPath;
        item.originalModelUrl = one.originalUrl || (raw.startsWith('http') ? raw : item.originalModelUrl);
      }
    }
    if (updates.trainAudioUrl !== undefined) {
      const raw = updates.trainAudioUrl.trim();
      if (!raw) {
        const oldPath = item.localTrainAudioPath as string | undefined;
        if (oldPath && fs.existsSync(oldPath)) {
          try {
            fs.unlinkSync(oldPath);
          } catch {
            /* ignore */
          }
        }
        item.trainAudioUrl = '';
        item.localTrainAudioPath = undefined;
        item.originalTrainAudioUrl = undefined;
      } else {
        const one = await persistRvcVoiceLibraryTrainAudio(itemId, raw);
        if (one?.url) {
          item.trainAudioUrl = one.url;
          item.localTrainAudioPath = one.localPath;
          item.originalTrainAudioUrl = one.originalUrl || (raw.startsWith('http') ? raw : item.originalTrainAudioUrl);
        }
      }
    }

    items[idx] = item;
    store.set('rvcVoiceLibrary', items);
    return item;
  },
);

ipcMain.handle('delete-rvc-voices', async (_, itemIds: string[]) => {
  const ids = Array.isArray(itemIds) ? itemIds.filter(Boolean) : [];
  if (!ids.length) return { success: true };
  const remove = new Set(ids);
  const items = (store.get('rvcVoiceLibrary') || []) as Array<{
    id: string;
    localModelPath?: string;
    localAvatarPath?: string;
    localTrainAudioPath?: string;
  }>;

  for (const s of items) {
    if (!remove.has(s.id)) continue;
    for (const p of [s.localModelPath, s.localAvatarPath, s.localTrainAudioPath]) {
      if (p && fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {
          /* ignore */
        }
      }
    }
  }

  store.set(
    'rvcVoiceLibrary',
    items.filter((s) => !remove.has(s.id)),
  );
  return { success: true };
});

ipcMain.handle('pick-rvc-voice-package', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog({
    title: '导入 RVC 模型包',
    properties: ['openFile'],
    filters: [
      { name: 'RVC 模型包', extensions: ['zip', 'pth', 'index', 'tar', 'gz', 'tgz'] },
      { name: '全部', extensions: ['*'] },
    ],
  });
  if (canceled || !filePaths?.[0]) return { canceled: true };
  return { canceled: false, filePath: filePaths[0] };
});

ipcMain.handle('pick-rvc-voice-avatar', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog({
    title: '上传 RVC 音色头像',
    properties: ['openFile'],
    filters: [
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
      { name: '全部', extensions: ['*'] },
    ],
  });
  if (canceled || !filePaths?.[0]) return { canceled: true };
  return { canceled: false, filePath: filePaths[0] };
});

ipcMain.handle('pick-rvc-voice-train-audio', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog({
    title: '选择训练音频片段',
    properties: ['openFile'],
    filters: [
      { name: '音频', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'] },
      { name: '全部', extensions: ['*'] },
    ],
  });
  if (canceled || !filePaths?.[0]) return { canceled: true };
  return { canceled: false, filePath: filePaths[0] };
});

ipcMain.handle(
  'image-to-3d-ensure-local-texture',
  async (
    _,
    opts: { glbLocalPath?: string; glbResourceUrl?: string },
  ): Promise<{ textureLocalPath: string; textureLocalUrl: string }> => {
    const glbPath =
      resolveFsPathFromUrlish(opts.glbLocalPath) ||
      resolveFsPathFromUrlish(opts.glbResourceUrl);
    if (!glbPath || !fs.existsSync(glbPath)) {
      return { textureLocalPath: '', textureLocalUrl: '' };
    }
    const dir = path.dirname(glbPath);
    const stem = path.basename(glbPath, path.extname(glbPath));
    const texPath = path.join(dir, `${stem}-basecolor.png`);
    if (!fs.existsSync(texPath)) {
      if (!extractEmbeddedGlbBaseColorToPng(glbPath, texPath)) {
        return { textureLocalPath: '', textureLocalUrl: '' };
      }
    }
    return {
      textureLocalPath: texPath,
      textureLocalUrl: fsPathToLocalResourceUrl(texPath),
    };
  },
);

ipcMain.handle('image-to-3d', async (_, imageUrl: string, projectId?: string, nodeId?: string, modelId?: string) => {
  const check = checkLicenseStatus(getUserDataPath());
  if (check.status !== 'VALID') {
    throw new Error('图片转 3D 需要有效授权，请先激活');
  }
  if (!getNxAccessToken()) {
    throw new Error('请先登录云端账号');
  }
  try {
    const videoProvider = new VideoProvider();
    const publicImageUrl = await videoProvider.processImageToOssUrl(imageUrl);
    const resolvedModel = resolveImageTo3dModelId(modelId);
    console.log('[图片转3D] 开始', {
      modelId: resolvedModel,
      nodeId,
      imageOssUrl: publicImageUrl.length > 96 ? `${publicImageUrl.slice(0, 96)}…` : publicImageUrl,
    });
    const result = await runImageTo3dModelViaFc(resolvedModel, publicImageUrl);
    if (!result.success) {
      throw new Error(result.message);
    }
    const assets = await downloadImageTo3dAssetsToProject(
      result.glbUrl,
      result.companionUrls,
      projectId,
      nodeId,
      result.resultTextureUrl,
    );
    const toLocalResourceUrl = (filePath: string | null | undefined): string => {
      if (!filePath) return '';
      let p = filePath.replace(/\\/g, '/');
      if (p.match(/^([a-zA-Z])\//)) p = p[0].toUpperCase() + ':' + p.substring(1);
      return `local-resource://${p}`;
    };
    const localGlbPath = assets?.glbPath;
    const localGlbUrl = toLocalResourceUrl(localGlbPath) || result.glbUrl;
    const resultTextureLocalUrl = toLocalResourceUrl(assets?.resultTexturePath);
    const resultTextureRemoteUrl = assets?.resultTextureRemoteUrl || undefined;
    return {
      success: true,
      glbUrl: result.glbUrl,
      remoteGlbUrl: result.glbUrl,
      localGlbPath: localGlbPath || undefined,
      localGlbUrl,
      resultTextureRemoteUrl,
      resultTextureLocalPath: assets?.resultTexturePath || undefined,
      resultTextureLocalUrl: resultTextureLocalUrl || resultTextureRemoteUrl || undefined,
    };
  } catch (err: unknown) {
    console.error('[图片转3D]', err);
    throw err;
  }
});

async function readFileBufferFromPathOrUrl(opts: {
  localPath?: string;
  remoteUrl?: string;
}): Promise<Buffer | null> {
  const local = opts.localPath?.trim();
  if (local && fs.existsSync(local)) {
    return fs.readFileSync(local);
  }
  const remote = opts.remoteUrl?.trim();
  if (remote && (remote.startsWith('http://') || remote.startsWith('https://'))) {
    const response = await axios.get(remote, { responseType: 'arraybuffer', timeout: 600000, proxy: false });
    return Buffer.from(response.data);
  }
  const localFromUrl = resolveFsPathFromUrlish(remote || local);
  if (localFromUrl && fs.existsSync(localFromUrl)) {
    return fs.readFileSync(localFromUrl);
  }
  return null;
}

/** 参考图 / 贴图：支持 local-resource、data:、http */
async function readImageBufferForAixflowZip(opts: {
  localPath?: string;
  remoteUrl?: string;
}): Promise<Buffer | null> {
  const local = opts.localPath?.trim();
  if (local && fs.existsSync(local)) {
    return fs.readFileSync(local);
  }
  const remote = opts.remoteUrl?.trim();
  if (!remote) return null;
  try {
    const { buffer } = await resolveImageToBufferForOSS(remote);
    return buffer?.length ? buffer : null;
  } catch {
    return readFileBufferFromPathOrUrl(opts);
  }
}

async function buildImageTo3dAixflowZipBuffer(opts: {
  glbLocalPath?: string;
  glbRemoteUrl?: string;
  textureLocalPath?: string;
  textureRemoteUrl?: string;
  textureResourceUrl?: string;
  referenceLocalPath?: string;
  referenceRemoteUrl?: string;
}): Promise<{ buffer: Buffer; hasTexture: boolean; hasReference: boolean }> {
  const glbBuf = await readFileBufferFromPathOrUrl({
    localPath: opts?.glbLocalPath,
    remoteUrl: opts?.glbRemoteUrl,
  });
  if (!glbBuf?.length) {
    throw new Error('没有可保存的 GLB 模型');
  }

  const zip = new AdmZip();
  zip.addFile('model.glb', glbBuf);

  let hasTexture = false;
  const texBuf = await readImageBufferForAixflowZip({
    localPath: opts?.textureLocalPath,
    remoteUrl: opts?.textureRemoteUrl || opts?.textureResourceUrl,
  });
  if (texBuf?.length) {
    zip.addFile('texture.png', texBuf);
    hasTexture = true;
  }

  let hasReference = false;
  const refBuf = await readImageBufferForAixflowZip({
    localPath: opts?.referenceLocalPath,
    remoteUrl: opts?.referenceRemoteUrl,
  });
  if (refBuf?.length) {
    zip.addFile('reference.png', refBuf);
    hasReference = true;
  }

  const files = ['model.glb'];
  if (hasReference) files.push('reference.png');
  if (hasTexture) files.push('texture.png');

  zip.addFile(
    'manifest.json',
    Buffer.from(
      JSON.stringify(
        {
          format: 'nexflow-image-to-3d',
          version: 2,
          createdAt: Date.now(),
          hasTexture,
          hasReference,
          files,
        },
        null,
        2,
      ),
      'utf-8',
    ),
  );

  return { buffer: zip.toBuffer(), hasTexture, hasReference };
}

function safeExportBaseName(name: string): string {
  const base = (name || '3d-model').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  return base.slice(0, 80) || '3d-model';
}

type ImageTo3dLibraryCharacter = {
  id: string;
  assetKind?: string;
  nickname?: string;
  name?: string;
  avatar?: string;
  localAvatarPath?: string;
  inputImageUrl?: string;
  localGlbPath?: string;
  localGlbUrl?: string;
  remoteGlbUrl?: string;
  localTexturePath?: string;
  resultTextureUrl?: string;
};

/** 保存图片转 3D 资产包：ZIP，默认后缀 .aixflow（内含 model.glb + texture.png + manifest.json） */
ipcMain.handle(
  'save-image-to-3d-aixflow',
  async (
    _,
    opts: {
      defaultName?: string;
      glbLocalPath?: string;
      glbRemoteUrl?: string;
      textureLocalPath?: string;
      textureRemoteUrl?: string;
      textureResourceUrl?: string;
      referenceLocalPath?: string;
      referenceRemoteUrl?: string;
    },
  ) => {
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: '保存图片转 3D',
      defaultPath: opts?.defaultName || 'image-to-3d.aixflow',
      filters: [{ name: 'Aixflow 3D 资产包', extensions: ['aixflow'] }],
    });
    if (canceled || !filePath) return { canceled: true };

    const dest = /\.aixflow$/i.test(filePath) ? filePath : `${filePath}.aixflow`;
    const { buffer, hasTexture, hasReference } = await buildImageTo3dAixflowZipBuffer(opts);
    fs.writeFileSync(dest, buffer);
    return { canceled: false, filePath: dest, hasTexture, hasReference };
  },
);

/** 从 3D 模型库导出 .aixflow（单文件）或 zip 包（多选） */
ipcMain.handle('export-image-to-3d-models', async (_, characterIds: string[]) => {
  const all = (store.get('characters') || []) as ImageTo3dLibraryCharacter[];
  const idSet = Array.isArray(characterIds) && characterIds.length > 0 ? new Set(characterIds) : null;
  const targets = all.filter(
    (c) => c.assetKind === 'imageTo3d' && (!idSet || idSet.has(c.id)),
  );
  if (!targets.length) {
    return { success: false, error: '没有可导出的 3D 模型' };
  }

  try {
    if (targets.length === 1) {
      const c = targets[0];
      const label = safeExportBaseName(c.nickname || c.name || '3d-model');
      const { filePath, canceled } = await dialog.showSaveDialog({
        title: '导出 3D 模型',
        defaultPath: `${label}.aixflow`,
        filters: [{ name: 'Aixflow 3D 资产包', extensions: ['aixflow'] }],
      });
      if (canceled || !filePath) {
        return { success: false, error: '已取消' };
      }
      const dest = /\.aixflow$/i.test(filePath) ? filePath : `${filePath}.aixflow`;
      const { buffer } = await buildImageTo3dAixflowZipBuffer({
        glbLocalPath: c.localGlbPath,
        glbRemoteUrl: c.localGlbUrl || c.remoteGlbUrl,
        textureLocalPath: c.localTexturePath,
        textureRemoteUrl: c.resultTextureUrl,
        referenceLocalPath: c.localAvatarPath,
        referenceRemoteUrl: c.inputImageUrl || c.avatar,
      });
      fs.writeFileSync(dest, buffer);
      return { success: true, filePath: dest, count: 1 };
    }

    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: '选择导出文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });
    const dir = filePaths?.[0];
    if (canceled || !dir) {
      return { success: false, error: '已取消' };
    }
    const usedNames = new Set<string>();
    const written: string[] = [];
    for (const c of targets) {
      const base = safeExportBaseName(c.nickname || c.name || c.id);
      let fileName = `${base}.aixflow`;
      let n = 2;
      while (usedNames.has(fileName)) {
        fileName = `${base}-${n}.aixflow`;
        n += 1;
      }
      usedNames.add(fileName);
      const { buffer } = await buildImageTo3dAixflowZipBuffer({
        glbLocalPath: c.localGlbPath,
        glbRemoteUrl: c.localGlbUrl || c.remoteGlbUrl,
        textureLocalPath: c.localTexturePath,
        textureRemoteUrl: c.resultTextureUrl,
        referenceLocalPath: c.localAvatarPath,
        referenceRemoteUrl: c.inputImageUrl || c.avatar,
      });
      const dest = path.join(dir, fileName);
      fs.writeFileSync(dest, buffer);
      written.push(dest);
    }
    return { success: true, filePath: dir, count: written.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '导出失败';
    return { success: false, error: msg };
  }
});

/** 从 .aixflow 或 .glb 解压/复制到本机角色库目录，供注册或画布拖入 */
ipcMain.handle(
  'import-image-to-3d-asset',
  async (_, opts?: { filePath?: string }) => {
    let filePath = (opts?.filePath || '').trim();
    if (!filePath) {
      const { filePaths, canceled } = await dialog.showOpenDialog({
        title: '导入图片转 3D 模型',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Aixflow / GLB', extensions: ['aixflow', 'glb'] },
          { name: 'Aixflow 3D 资产包', extensions: ['aixflow'] },
          { name: 'GLB 模型', extensions: ['glb'] },
        ],
      });
      if (canceled || !filePaths?.length) return { canceled: true };
      if (filePaths.length === 1) {
        filePath = filePaths[0];
      } else {
        const items: Array<{
          nickname: string;
          localGlbPath: string;
          localGlbUrl: string;
          localTexturePath?: string;
          resultTextureUrl?: string;
          inputImageUrl?: string;
        }> = [];
        for (const fp of filePaths) {
          try {
            items.push(unpackImageTo3dAssetFile(fp));
          } catch (e) {
            console.warn('[图片转3D] 批量导入跳过:', fp, e);
          }
        }
        if (!items.length) throw new Error('未能导入任何 3D 模型文件');
        return { canceled: false, items };
      }
    }

    if (!fs.existsSync(filePath)) throw new Error('文件不存在');
    const item = unpackImageTo3dAssetFile(filePath);
    return { canceled: false, item };
  },
);

/** 3D 模型库卡片编辑：仅选择参考图/头像 */
ipcMain.handle('pick-image-to-3d-avatar', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog({
    title: '选择 3D 模型参考图',
    properties: ['openFile'],
    filters: [
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
      { name: '全部', extensions: ['*'] },
    ],
  });
  if (canceled || !filePaths?.[0]) return { canceled: true };
  return { canceled: false, filePath: filePaths[0] };
});

/** 图片转 3D 底栏「上传」：原生文件选择（含 .aixflow / GLB / 参考图） */
ipcMain.handle('pick-image-to-3d-upload', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog({
    title: '上传参考图或 3D 模型',
    properties: ['openFile'],
    filters: [
      {
        name: '全部支持',
        extensions: ['aixflow', 'glb', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'],
      },
      { name: 'Aixflow 3D 资产包', extensions: ['aixflow'] },
      { name: 'GLB 模型', extensions: ['glb'] },
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
    ],
  });
  if (canceled || !filePaths?.[0]) return { canceled: true };
  return { canceled: false, filePath: filePaths[0] };
});

function unpackImageTo3dAssetFile(filePath: string): {
  nickname: string;
  localGlbPath: string;
  localGlbUrl: string;
  localTexturePath?: string;
  resultTextureUrl?: string;
  inputImageUrl?: string;
  localAvatarPath?: string;
  avatar?: string;
} {
  const lower = filePath.toLowerCase();
  const importId = `image3d-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const nickname = path.basename(filePath, path.extname(filePath)) || '3D 模型';

  if (lower.endsWith('.glb')) {
    const copied = copyFileIntoCharacter3dDir(filePath, `${importId}.glb`);
    if (!copied) throw new Error('无法读取 GLB 文件');
    return {
      nickname,
      localGlbPath: copied,
      localGlbUrl: fsPathToLocalResourceUrl(copied),
    };
  }

  if (!lower.endsWith('.aixflow')) {
    throw new Error('仅支持 .aixflow 或 .glb 文件');
  }

  const zip = new AdmZip(filePath);
  const glbEntry = zip.getEntry('model.glb');
  if (!glbEntry) throw new Error('无效的 .aixflow：缺少 model.glb');

  const userDataPath = app.getPath('userData');
  const dir = path.join(userDataPath, 'character-3d');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const glbDest = path.join(dir, `${importId}.glb`);
  fs.writeFileSync(glbDest, glbEntry.getData());

  let localTexturePath: string | undefined;
  let resultTextureUrl: string | undefined;
  let inputImageUrl: string | undefined;
  let localAvatarPath: string | undefined;

  let refEntry =
    zip.getEntry('reference.png') ||
    zip.getEntry('reference.jpg') ||
    zip.getEntry('reference.jpeg') ||
    zip.getEntry('reference.webp');
  if (!refEntry) {
    const manifestEntry = zip.getEntry('manifest.json');
    if (manifestEntry) {
      try {
        const manifest = JSON.parse(manifestEntry.getData().toString('utf8')) as {
          files?: string[];
        };
        const refName = (manifest.files || []).find((f) => /^reference\./i.test(f));
        if (refName) {
          const found = zip.getEntry(refName);
          if (found) refEntry = found;
        }
      } catch {
        /* ignore invalid manifest */
      }
    }
  }
  if (refEntry) {
    const refExt = path.extname(refEntry.entryName) || '.png';
    const refDest = path.join(dir, `${importId}-ref${refExt}`);
    fs.writeFileSync(refDest, refEntry.getData());
    localAvatarPath = refDest;
    inputImageUrl = fsPathToLocalResourceUrl(refDest);
  }

  const texEntry = zip.getEntry('texture.png');
  if (texEntry) {
    const texDest = path.join(dir, `${importId}-tex.png`);
    fs.writeFileSync(texDest, texEntry.getData());
    localTexturePath = texDest;
    resultTextureUrl = fsPathToLocalResourceUrl(texDest);
  }

  return {
    nickname,
    localGlbPath: glbDest,
    localGlbUrl: fsPathToLocalResourceUrl(glbDest),
    localTexturePath,
    resultTextureUrl,
    inputImageUrl,
    localAvatarPath,
    avatar: inputImageUrl,
  };
}

ipcMain.handle(
  'save-glb-file',
  async (
    _,
    opts: { localPath?: string; remoteUrl?: string; defaultName?: string },
  ) => {
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: '保存 GLB 模型',
      defaultPath: opts?.defaultName || 'model.glb',
      filters: [{ name: 'GLB 模型', extensions: ['glb'] }],
    });
    if (canceled || !filePath) return { canceled: true };
    const dest = filePath.endsWith('.glb') ? filePath : `${filePath}.glb`;
    const local = opts?.localPath?.trim();
    if (local && fs.existsSync(local)) {
      fs.copyFileSync(local, dest);
      return { canceled: false, filePath: dest };
    }
    const remote = opts?.remoteUrl?.trim();
    if (remote) {
      const response = await axios.get(remote, { responseType: 'arraybuffer', timeout: 600000, proxy: false });
      fs.writeFileSync(dest, Buffer.from(response.data));
      return { canceled: false, filePath: dest };
    }
    throw new Error('没有可保存的模型文件');
  },
);

ipcMain.handle('image-matting', async (_, imageUrl: string) => {
  const check = checkLicenseStatus(getUserDataPath());
  if (check.status !== 'VALID') {
    throw new Error('抠图功能需要有效授权，请先激活');
  }

  if (!getNxAccessToken()) {
    throw new Error('请先登录云端账号');
  }

  try {
    const { buffer, mimeType } = await resolveImageToBufferForOSS(imageUrl);
    const videoProvider = new VideoProvider();
    const publicImageUrl = await videoProvider.uploadImageToOSS(buffer, mimeType);
    const result = await runMattingViaFc(publicImageUrl);
    if (result.success) {
      return { success: true, imageUrl: result.imageUrl };
    }
    throw new Error(result.message);
  } catch (err: any) {
    console.error('[抠图]', err);
    throw err;
  }
});

/** 将图片地址解析为 Buffer + MIME（抠图/去水印共用） */
function resolveImageToBufferForOSS(imageUrl: string): Promise<{ buffer: Buffer; mimeType: string }> {
  if (!imageUrl || !imageUrl.trim()) return Promise.reject(new Error('图片地址为空'));
  const url = imageUrl.trim();

  if (url.startsWith('data:image/')) {
    const matches = url.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches || matches.length < 3) return Promise.reject(new Error('无效的 Base64 图片数据'));
    const mimeType = (matches[1] || 'image/png').trim();
    const buffer = Buffer.from(matches[2], 'base64');
    return Promise.resolve({ buffer, mimeType });
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    return axios.get(url, { responseType: 'arraybuffer', timeout: 60000, proxy: false }).then((response) => {
      const buffer = Buffer.from(response.data);
      const contentType = response.headers['content-type'];
      const mimeType = (typeof contentType === 'string' && contentType.split(';')[0].trim()) || 'image/png';
      return { buffer, mimeType };
    });
  }

  if (url.startsWith('local-resource://') || url.startsWith('file://')) {
    let filePath = url.startsWith('local-resource://') ? url.replace(/^local-resource:\/\//, '') : url.replace(/^file:\/\//, '');
    filePath = decodeURIComponent(filePath.replace(/\//g, path.sep));
    if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
    if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
    const normalized = path.normalize(filePath);
    if (!fs.existsSync(normalized)) return Promise.reject(new Error('本地图片文件不存在'));
    const buffer = fs.readFileSync(normalized);
    const ext = path.extname(normalized).toLowerCase();
    const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
    return Promise.resolve({ buffer, mimeType });
  }

  return Promise.reject(new Error('不支持的图片格式，请使用网络链接、Base64 或本地路径'));
}

// 去水印：先上传 OSS 得到公网 URL，再调用 AI 应用；仅有效授权可用
ipcMain.handle('image-watermark-removal', async (_, imageUrl: string) => {
  const check = checkLicenseStatus(getUserDataPath());
  if (check.status !== 'VALID') {
    throw new Error('去水印功能需要有效授权，请先激活');
  }

  if (!getNxAccessToken()) {
    throw new Error('请先登录云端账号');
  }

  try {
    const { buffer, mimeType } = await resolveImageToBufferForOSS(imageUrl);
    const videoProvider = new VideoProvider();
    const publicImageUrl = await videoProvider.uploadImageToOSS(buffer, mimeType);
    const result = await runWatermarkRemovalViaFc(publicImageUrl);
    if (result.success) {
      return { success: true, imageUrl: result.imageUrl };
    }
    throw new Error(result.message);
  } catch (err: any) {
    console.error('[去水印]', err);
    throw err;
  }
});

// 超分放大：先上传 OSS，再经 FC 调 RunningHub AI App
ipcMain.handle('image-upscale-v3', async (_, imageUrl: string) => {
  const check = checkLicenseStatus(getUserDataPath());
  if (check.status !== 'VALID') {
    throw new Error('超分放大需要有效授权，请先激活');
  }

  if (!getNxAccessToken()) {
    throw new Error('请先登录云端账号');
  }

  try {
    const { buffer, mimeType } = await resolveImageToBufferForOSS(imageUrl);
    const videoProvider = new VideoProvider();
    const publicImageUrl = await videoProvider.uploadImageToOSS(buffer, mimeType);
    const result = await runImageUpscaleV3ViaFc(publicImageUrl);
    if (result.success) {
      return { success: true, imageUrl: result.imageUrl };
    }
    throw new Error(result.message);
  } catch (err: any) {
    console.error('[超分放大]', err);
    throw err;
  }
});

// 视频去水印：转码上传 OSS 后经 FC 调 RunningHub AI App
ipcMain.handle('video-watermark-removal', async (_, videoUrl: string, strength?: number) => {
  const check = checkLicenseStatus(getUserDataPath());
  if (check.status !== 'VALID') {
    throw new Error('视频去水印功能需要有效授权，请先激活');
  }
  if (!getNxAccessToken()) {
    throw new Error('请先登录云端账号');
  }
  try {
    const videoProvider = new VideoProvider();
    const publicVideoUrl = await videoProvider.prepareVideoForWatermarkRemovalRemoteUrl(String(videoUrl || ''));
    const result = await runVideoWatermarkRemovalViaFc(publicVideoUrl, strength);
    if (result.success) {
      return { success: true, videoUrl: result.videoUrl };
    }
    throw new Error(result.message);
  } catch (err: any) {
    console.error('[视频去水印]', err);
    throw err;
  }
});

// 视频深度转换：上传 OSS 后经 FC 调 RunningHub AI App 2082392424818757633
ipcMain.handle('video-depth-convert', async (_, videoUrl: string) => {
  const check = checkLicenseStatus(getUserDataPath());
  if (check.status !== 'VALID') {
    throw new Error('视频深度转换需要有效授权，请先激活');
  }
  if (!getNxAccessToken()) {
    throw new Error('请先登录云端账号');
  }
  try {
    const videoProvider = new VideoProvider();
    const publicVideoUrl = await videoProvider.prepareVideoForWatermarkRemovalRemoteUrl(String(videoUrl || ''));
    const result = await runVideoDepthConvertViaFc(publicVideoUrl);
    if (result.success) {
      return {
        success: true,
        kind: result.kind,
        url: result.url,
        ...(result.kind === 'video' ? { videoUrl: result.url } : { imageUrl: result.url }),
      };
    }
    throw new Error(result.message);
  } catch (err: any) {
    console.error('[视频深度转换]', err);
    throw err;
  }
});

// 视频去字幕/水印：上传 OSS 后经 FC 调 RunningHub AI App 2082682378039943169
ipcMain.handle('video-subtitle-watermark-removal', async (_, videoUrl: string) => {
  const check = checkLicenseStatus(getUserDataPath());
  if (check.status !== 'VALID') {
    throw new Error('视频去字幕/水印需要有效授权，请先激活');
  }
  if (!getNxAccessToken()) {
    throw new Error('请先登录云端账号');
  }
  try {
    const videoProvider = new VideoProvider();
    const publicVideoUrl = await videoProvider.prepareVideoForWatermarkRemovalRemoteUrl(String(videoUrl || ''));
    const result = await runVideoSubtitleWatermarkRemovalViaFc(publicVideoUrl);
    if (result.success) {
      return {
        success: true,
        kind: result.kind,
        url: result.url,
        ...(result.kind === 'video' ? { videoUrl: result.url } : { imageUrl: result.url }),
      };
    }
    throw new Error(result.message);
  } catch (err: any) {
    console.error('[视频去字幕/水印]', err);
    throw err;
  }
});

// 人物多角度：先上传 OSS 得公网 URL，再经 FC 调用 RunningHub AI 应用；与抠图/去水印一致
ipcMain.handle('image-character-multi-angle', async (_, imageUrl: string) => {
  const check = checkLicenseStatus(getUserDataPath());
  if (check.status !== 'VALID') {
    throw new Error('人物多角度功能需要有效授权，请先激活');
  }

  if (!getNxAccessToken()) {
    throw new Error('请先登录云端账号');
  }

  try {
    const { buffer, mimeType } = await resolveImageToBufferForOSS(imageUrl);
    const videoProvider = new VideoProvider();
    const publicImageUrl = await videoProvider.uploadImageToOSS(buffer, mimeType);
    const result = await runCharacterMultiAngleViaFc(publicImageUrl);
    if (result.success) {
      return result;
    }
    throw new Error(result.message);
  } catch (err: any) {
    console.error('[人物多角度]', err);
    throw err;
  }
});

function toLocalFilePath(url: string | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const u = url.trim();
  let raw: string;
  if (u.startsWith('local-resource://')) {
    raw = u.replace(/^local-resource:\/\/+/, '');
  } else if (u.startsWith('file:///') || u.startsWith('file://')) {
    raw = u.replace(/^file:\/\/+/, '');
  } else {
    return null;
  }
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  // Windows: file:///C:/path → /C:/path，需去掉首位斜杠
  if (raw.match(/^\/[a-zA-Z]:/)) raw = raw.slice(1);
  return raw.replace(/\//g, path.sep);
}

/** 任务是否有可展示内容（含 LLM 纯文本结果） */
function taskHasDisplayableOutput(t: any): boolean {
  const hasMedia = !!(t.imageUrl || t.videoUrl || t.audioUrl || t.localFilePath);
  if (hasMedia) return true;
  const prompt = typeof t.prompt === 'string' ? t.prompt.trim() : '';
  if (!prompt) return false;
  if (t.taskType === 'text') return true;
  // 兼容未写 taskType 的 LLM 文本任务（仅有 prompt、无媒体）
  if (!t.taskType) return true;
  return false;
}

/** 过滤掉失败任务和无法正常显示的任务，并持久化清理后的列表 */
function filterInvalidTasks(tasks: any[]): any[] {
  const STUCK_PROCESSING_MS = 30 * 60 * 1000; // 超过 30 分钟仍在 processing 视为卡住
  const now = Date.now();
  const valid = tasks.filter((t) => {
    const hasOutput = taskHasDisplayableOutput(t);
    if (t.status === 'error') return false; // 失败任务
    if (t.status === 'processing' || t.status === 'running') {
      const age = now - (t.createdAt || 0);
      if (age > STUCK_PROCESSING_MS) return false; // 卡住的 processing / running
    }
    if (t.status === 'success') {
      if (!hasOutput) return false; // 成功但无任何可展示内容
      // 检查本地文件是否存在：若输出指向本地路径但文件已删除，则无法正常显示，移除
      const urls = [t.imageUrl, t.videoUrl, t.audioUrl, t.localFilePath].filter(Boolean) as string[];
      for (const u of urls) {
        const localPath = toLocalFilePath(u);
        if (localPath && !fs.existsSync(localPath)) return false;
      }
    }
    // 无状态且无输出：旧数据或异常记录，无法正常显示
    if ((t.status === undefined || t.status === null) && !hasOutput) return false;
    return true;
  });
  const removed = tasks.length - valid.length;
  if (removed > 0) {
    store.set('tasks', valid);
    console.log(`[任务列表] 已自动清理 ${removed} 个无效任务（失败/卡住/无内容/本地文件已删除）`);
  }
  return valid;
}

// 任务列表管理
ipcMain.handle('save-tasks', (_, tasks: any[]) => {
  try {
    const filtered = filterInvalidTasks(tasks);
    store.set('tasks', filtered);
    return { success: true, tasks: filtered };
  } catch (error: any) {
    console.error('[任务列表] 保存失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-tasks', () => {
  try {
    const tasks = store.get('tasks') || [];
    const filtered = filterInvalidTasks(tasks);
    return { success: true, tasks: filtered };
  } catch (error: any) {
    console.error('[任务列表] 加载失败:', error);
    return { success: false, error: error.message, tasks: [] };
  }
});

ipcMain.handle('nx-cloud-get-fc-route', () => {
  const route = getStoredNxFcRoute();
  const activeEndpoint = applyNxFcRoute(route);
  return {
    route,
    activeEndpoint,
    hkEndpoint: getHongKongFcEndpoint(),
    beijingEndpoint: getBeijingFcEndpoint(),
  };
});

ipcMain.handle('nx-cloud-set-fc-route', async (_, routeRaw: 'hk' | 'beijing') => {
  const route: 'hk' | 'beijing' = routeRaw === 'beijing' ? 'beijing' : 'hk';
  if (route === 'hk') {
    clearSessionBeijingFcProxyUpload();
  }
  store.set('nxCloudFcRoute', route);
  const activeEndpoint = applyNxFcRoute(route);
  try {
    await initCloudUser();
  } catch {
    // ignore refresh failures after route switch
  }
  return { ok: true, route, activeEndpoint };
});

ipcMain.handle('nx-media-oss-get-region', () => {
  const region = getEffectiveDualRegion();
  const manual = getStoredMediaOssRegion();
  const fcRoute = mediaOssRegionToFcRoute(region);
  return {
    region,
    fcRoute,
    manual: manual != null,
    activeRegion: getActiveMediaOssRegion(),
  };
});

ipcMain.handle('nx-media-oss-set-region', async (_, regionRaw: 'cn' | 'hk') => {
  const region = regionRaw === 'cn' ? 'cn' : 'hk';
  applyMediaOssRegion(region);
  const fcRoute = mediaOssRegionToFcRoute(region);
  if (fcRoute === 'hk') {
    clearSessionBeijingFcProxyUpload();
  }
  store.set('nxCloudFcRoute', fcRoute);
  const activeEndpoint = applyNxFcRoute(fcRoute);
  try {
    await initCloudUser();
  } catch {
    // ignore refresh failures after route switch
  }
  const probed = await ensureOssUploadRouteProbed(true);
  return { ok: true, region, fcRoute, activeEndpoint, ...probed };
});

ipcMain.handle('nx-cloud-ensure-fc-route-for-canvas', async () => {
  const fc = await ensureFcRouteForCanvas();
  const oss = await ensureOssUploadRouteProbed();
  return {
    ...fc,
    ossPreferFc: oss.preferFc,
    ossDirectReachable: oss.reachable,
    ossMediaRegion: oss.mediaRegion,
  };
});

ipcMain.handle('nx-cloud-login', async (_, email: string, password: string) => {
  const currentRoute = getStoredNxFcRoute();
  const alternateRoute: 'hk' | 'beijing' = currentRoute === 'hk' ? 'beijing' : 'hk';

  const currentEndpoint = applyNxFcRoute(currentRoute);
  try {
    return await nxCloudLogin(email, password);
  } catch (err) {
    const alternateEndpoint = applyNxFcRoute(alternateRoute);
    const alternateAvailable =
      Boolean(alternateEndpoint) && alternateEndpoint !== currentEndpoint;
    if (!alternateAvailable || !shouldAutoFailoverFcError(err)) {
      throw err;
    }

    console.warn(
      `[NxFc] 登录失败自动切换线路重试: ${currentRoute} -> ${alternateRoute}`,
      `from=${currentEndpoint}`,
      `to=${alternateEndpoint}`,
    );
    store.set('nxCloudFcRoute', alternateRoute);
    try {
      return await nxCloudLogin(email, password);
    } catch (retryErr) {
      store.set('nxCloudFcRoute', currentRoute);
      applyNxFcRoute(currentRoute);
      throw retryErr;
    }
  }
});
ipcMain.handle('nx-cloud-send-auth-code', async (_, email: string, purpose?: 'login' | 'change_password') => {
  await nxCloudSendAuthCode(email, purpose);
  return { ok: true };
});
ipcMain.handle('nx-cloud-change-password', async (_, email: string, code: string, newPassword: string) => {
  await nxCloudChangePassword(email, code, newPassword);
  return { ok: true };
});
ipcMain.handle('nx-cloud-login-with-code', async (_, email: string, code: string) => nxCloudLoginWithCode(email, code));
ipcMain.handle('nx-cloud-register', async (_, email: string, password: string, code: string) =>
  nxCloudRegister(email, password, code)
);
ipcMain.handle('nx-cloud-logout', async () => {
  clearNxAuth();
  return getCloudUserState();
});
ipcMain.handle('nx-cloud-get-profile', async () => nxCloudGetProfile());
ipcMain.handle('nx-cloud-get-transactions', async (_, limit?: number, page?: number) =>
  nxCloudGetTransactions(limit, page),
);
ipcMain.handle('nx-cloud-get-tasks', async (_, limit?: number) => ({ items: await nxCloudGetTasks(limit) }));
ipcMain.handle('nx-cloud-task-status', async (_, taskId: string) => nxCloudTaskStatus(taskId));
ipcMain.handle('nx-cloud-recharge', async (_, amountCny: number) => nxCloudRecharge(amountCny));
ipcMain.handle('alipay-create-recharge-order', async (_, packageId: string) => {
  await ensureFcRouteForPayment();
  const { createAlipayRechargeOrder } = await import('./services/alipayRecharge.js');
  return createAlipayRechargeOrder(String(packageId ?? '').trim());
});
ipcMain.handle('alipay-watch-order-settlement', async (_, outTradeNo: string, baselineBalance: number) => {
  const { watchAlipayOrderSettlement } = await import('./services/alipaySettlementService.js');
  watchAlipayOrderSettlement(String(outTradeNo ?? '').trim(), Number(baselineBalance) || 0, ({ outTradeNo, balance, addedYuanbao }) => {
    safeSendToRenderer('recharge-settled', {
      out_trade_no: outTradeNo,
      balance,
      added_yuanbao: addedYuanbao,
    });
    safeSendToRenderer('laf-balance-updated', getCloudUserState());
  });
  return { watching: true as const };
});
ipcMain.handle('alipay-get-order-status', async (_, outTradeNo: string) => {
  const { fetchAlipayOrderStatus } = await import('./services/alipaySettlementService.js');
  return fetchAlipayOrderStatus(String(outTradeNo ?? '').trim());
});
ipcMain.handle('nx-cloud-redeem-coupon', async (_, code: string) => nxCloudRedeemCoupon(code));
ipcMain.handle('nx-cloud-fetch-model-config', async () => nxCloudFetchModelConfig());

ipcMain.handle('get-nx-saas-state', async () => {
  const st = getCloudUserState();
  const token = getNxAccessToken();
  return {
    enabled: isNxSaasMode(),
    loggedIn: Boolean(token),
    balance: Number(st.balance || 0),
    email: st.nxEmail ?? null,
    lastLoginEmail: getNxLastLoginEmail(),
    isFirstRecharge: st.isFirstRecharge === true,
    directRechargeEnabled: NX_ENABLE_DIRECT_RECHARGE,
  };
});

ipcMain.handle('get-oss-route-channel', () => getOssRouteChannel());
ipcMain.handle('set-oss-route-channel', (_, channelRaw: 'cn' | 'global') => {
  const channel: 'cn' | 'global' = channelRaw === 'global' ? 'global' : 'cn';
  store.set('ossRouteChannel', channel);
  return { success: true as const, channel };
});

ipcMain.handle('get-experimental-hardware-acceleration', () => ({
  enabled: isExperimentalHardwareAccelerationEnabled(),
  active: hardwareAccelerationActive,
}));

ipcMain.handle('set-experimental-hardware-acceleration', (_, enabledRaw: boolean) => {
  const prev = isExperimentalHardwareAccelerationEnabled();
  const enabled = Boolean(enabledRaw);
  setExperimentalHardwareAccelerationEnabled(enabled);
  return { success: true as const, enabled, needsRestart: prev !== enabled };
});

ipcMain.handle('get-gpu-diagnostics', async () => {
  let gpuDevice: string | null = null;
  try {
    const info = (await app.getGPUInfo('basic')) as {
      gpuDevice?: Array<{ deviceString?: string }>;
    };
    gpuDevice = info?.gpuDevice?.[0]?.deviceString?.trim() || null;
  } catch {
    /* noop */
  }
  const featureStatus = app.getGPUFeatureStatus();
  return {
    experimentalEnabled: isExperimentalHardwareAccelerationEnabled(),
    sessionActive: hardwareAccelerationActive,
    featureStatus,
    gpuDevice,
  };
});

ipcMain.handle('app:relaunch', () => {
  app.relaunch();
  app.quit();
  return { success: true as const };
});

ipcMain.handle('app:set-fullscreen', (_, enable: boolean) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { isFullScreen: false };
  mainWindow.setFullScreen(Boolean(enable));
  return { isFullScreen: mainWindow.isFullScreen() };
});
ipcMain.handle('get-fullscreen-state', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { isFullScreen: false };
  return { isFullScreen: mainWindow.isFullScreen() };
});
ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.handle('app:get-network-time', () => Date.now());
registerUpdatePrepareMainWindow(() => mainWindow);
registerBeforeUpdateQuitHook(async () => {
  if (statsServer) {
    statsServer.close();
    statsServer = null;
  }
});
registerAppUpdaterIpc();

/** 登录页交流群：列举北京桶 WX/ 下最新图片公开 URL（换图只需替换 OSS 文件） */
ipcMain.handle('wechat-group:get-qr-url', async (_evt, force?: boolean) => {
  return resolveWeChatGroupQrFromOss(Boolean(force));
});

/** 顶栏教学视频：列举北京桶 `软件内教学视频/` 下 mp4（按文件名序号排序） */
ipcMain.handle('tutorial-videos:list', async (_evt, force?: boolean) => {
  return listTutorialVideosFromOss(Boolean(force));
});

ipcMain.handle('local-resource:set-sharp-queue-paused', async (_, paused: boolean) => {
  setSharpQueuePaused(Boolean(paused));
  return { success: true, paused: Boolean(paused) };
});

ipcMain.on('local-resource:peek-library-list-thumb', (event, sourceUrlOrPath: string, maxEdge?: number) => {
  try {
    const r = localResourceManager.peekLibraryListThumb(sourceUrlOrPath, maxEdge);
    event.returnValue = r ? { success: true, ...r } : { success: false };
  } catch {
    event.returnValue = { success: false };
  }
});

ipcMain.handle('local-resource:ensure-library-list-thumb', async (_, sourceUrlOrPath: string, maxEdge?: number) => {
  try {
    const r = await localResourceManager.ensureLibraryListThumb(sourceUrlOrPath, maxEdge);
    return { success: true, ...r };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle('ensure-digital-human-list-poster', async (_, itemId: string) => {
  try {
    const id = String(itemId || '').trim();
    if (!id) throw new Error('条目 ID 为空');
    const items = (store.get('digitalHumanLibrary') || []) as Array<Record<string, unknown>>;
    const idx = items.findIndex((s) => String(s.id || '') === id);
    if (idx < 0) throw new Error('数字人条目不存在');
    const item = { ...items[idx] };
    const existingPoster = String(item.localPosterPath || item.poster || '').trim();
    if (existingPoster) {
      const p = existingPoster.startsWith('local-resource://')
        ? existingPoster
        : existingPoster.includes('://')
          ? existingPoster
          : `local-resource://${String(existingPoster).replace(/\\/g, '/')}`;
      // 若本地 poster 文件仍在，直接返回
      try {
        let fsPath = existingPoster;
        if (fsPath.startsWith('local-resource://')) {
          fsPath = decodeURIComponent(fsPath.slice('local-resource://'.length));
          if (/^\/[A-Za-z]:/.test(fsPath)) fsPath = fsPath.slice(1);
        }
        if (fs.existsSync(fsPath) && fs.statSync(fsPath).isFile()) {
          return {
            success: true,
            posterUrl: p.startsWith('local-resource://') ? p : `local-resource://${fsPath.replace(/\\/g, '/')}`,
            localPosterPath: fsPath.replace(/\\/g, '/'),
            cached: true,
          };
        }
      } catch {
        /* regenerate */
      }
    }
    const videoSrc = String(item.localVideoPath || item.videoUrl || '').trim();
    if (!videoSrc) throw new Error('无参考视频');
    const r = await localResourceManager.ensureDigitalHumanVideoPoster(videoSrc, id);
    item.poster = r.posterUrl;
    item.localPosterPath = r.localPosterPath;
    items[idx] = item;
    store.set('digitalHumanLibrary', items);
    return { success: true, posterUrl: r.posterUrl, localPosterPath: r.localPosterPath, cached: r.cached };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle('local-resource:get-sharp-queue-stats', async () => getSharpQueueStats());

ipcMain.handle(
  'extract-audio-from-video',
  async (_, projectId: string | undefined, videoUrl: string) =>
    localResourceManager.extractAudioFromVideo(projectId, videoUrl),
);

ipcMain.handle(
  'trim-audio',
  async (_, projectId: string | undefined, audioUrl: string, startSec: number, endSec: number) =>
    localResourceManager.trimAudio(projectId, audioUrl, startSec, endSec),
);

ipcMain.handle(
  'trim-video',
  async (_, projectId: string | undefined, videoUrl: string, startSec: number, endSec: number) =>
    localResourceManager.trimVideo(projectId, videoUrl, startSec, endSec),
);

ipcMain.handle(
  'smart-analyze-video-shots',
  async (
    _,
    projectId: string | undefined,
    videoUrl: string,
    options?: {
      mode?: 'stable' | 'balanced' | 'sensitive';
      maxClips?: number;
      minClipSec?: number;
      withPosters?: boolean;
    },
  ) => localResourceManager.smartAnalyzeVideoShots(projectId, videoUrl, options),
);

ipcMain.handle(
  'smart-extract-video-clips',
  async (
    _,
    projectId: string | undefined,
    videoUrl: string,
    options?: {
      mode?: 'stable' | 'balanced' | 'sensitive';
      maxClips?: number;
      minClipSec?: number;
      output?: 'clips' | 'keyframes';
    },
  ) => localResourceManager.smartExtractVideoClips(projectId, videoUrl, options),
);

ipcMain.handle(
  'crop-video',
  async (
    _,
    projectId: string | undefined,
    videoUrl: string,
    rect: { x: number; y: number; w: number; h: number },
    sourceWidth: number,
    sourceHeight: number,
  ) => localResourceManager.cropVideo(projectId, videoUrl, rect, sourceWidth, sourceHeight),
);

ipcMain.handle(
  'chroma-key-video',
  async (
    _,
    projectId: string | undefined,
    videoUrl: string,
    options: { colorHex: string; similarity?: number; blend?: number },
  ) => localResourceManager.chromaKeyVideo(projectId, videoUrl, options),
);

/** 智能抠像（阿里云 VIAPI 一键人像 → WebM alpha）；进度经 event 推送 */
ipcMain.handle(
  'smart-portrait-matting',
  async (event, projectId: string | undefined, videoUrl: string) => {
    const { runSmartPortraitMatting } = await import('./services/viapiSegmentVideoBody.js');
    return runSmartPortraitMatting(projectId, videoUrl, (p) => {
      try {
        event.sender.send('smart-portrait-matting-progress', p);
      } catch {
        // ignore
      }
    });
  },
);

ipcMain.handle('get-media-duration', async (_, url: string, projectId?: string) =>
  getMediaDuration(url, projectId),
);

ipcMain.handle(
  'finalize-mic-recording',
  async (_, projectId: string | undefined, savedPath: string) =>
    finalizeMicRecording(projectId, savedPath),
);

ipcMain.handle(
  'export-timeline-video',
  async (
    _,
    projectId: string | undefined,
    videoClipsOrTracks: unknown,
    audioTracks: Array<
      Array<{
        type: string;
        src: string;
        duration: number;
        startTime: number;
        trimStart?: number;
        trimEnd?: number;
        lockTrim?: boolean;
      }>
    >,
    options?: {
      videoTrackVolume?: number | number[];
      videoTrackMuted?: boolean | boolean[];
      audioTrackVolume?: number[];
      audioTrackMuted?: boolean[];
      outputWidth?: number;
      outputHeight?: number;
    },
  ) => {
    try {
      if (!mainWindow) {
        return { success: false, error: '主窗口未就绪' };
      }
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '保存到电脑',
        defaultPath: `剪辑导出-${new Date().toISOString().slice(0, 10)}.mp4`,
        filters: saveFiltersForVideo('.mp4'),
      });
      if (result.canceled || !result.filePath) {
        return { success: false, error: '用户取消保存' };
      }
      const { videoPath, hasAudio } = await localResourceManager.exportTimelineVideo(
        projectId,
        videoClipsOrTracks as Parameters<typeof localResourceManager.exportTimelineVideo>[1],
        audioTracks,
        result.filePath,
        options,
      );
      return { success: true, videoPath, hasAudio };
    } catch (error) {
      console.error('[export-timeline-video] 失败:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
);

ipcMain.handle(
  'export-timeline-video-to-project',
  async (
    _,
    projectId: string | undefined,
    videoClipsOrTracks: unknown,
    audioTracks: Array<
      Array<{
        type: string;
        src: string;
        duration: number;
        startTime: number;
        trimStart?: number;
        trimEnd?: number;
        lockTrim?: boolean;
      }>
    >,
    options?: {
      videoTrackVolume?: number | number[];
      videoTrackMuted?: boolean | boolean[];
      audioTrackVolume?: number[];
      audioTrackMuted?: boolean[];
      outputWidth?: number;
      outputHeight?: number;
    },
  ) => {
    try {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const tmpPath = path.join(os.tmpdir(), `nexflow-splice-${id}.mp4`).replace(/\\/g, '/');
      const { hasAudio } = await localResourceManager.exportTimelineVideo(
        projectId,
        videoClipsOrTracks as Parameters<typeof localResourceManager.exportTimelineVideo>[1],
        audioTracks,
        tmpPath,
        options,
      );
      const resource = await localResourceManager.createVideoResourceFromFile(projectId, tmpPath);
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        // ignore
      }
      return {
        success: true,
        hasAudio,
        ...resource,
        width: options?.outputWidth ?? resource.width,
        height: options?.outputHeight ?? resource.height,
      };
    } catch (error) {
      console.error('[export-timeline-video-to-project] 失败:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
);

ipcMain.handle('local-resource:create-image-from-file', async (_, projectId: string | undefined, sourceFilePath: string) => {
  return localResourceManager.createImageResourceFromFile(projectId, sourceFilePath);
});

ipcMain.handle(
  'local-resource:create-image-from-buffer',
  async (_, projectId: string | undefined, fileName: string, buffer: ArrayBuffer) => {
    return localResourceManager.createImageResourceFromBuffer(projectId, fileName, buffer);
  }
);

ipcMain.handle('local-resource:create-video-from-file', async (_, projectId: string | undefined, sourceFilePath: string) => {
  return localResourceManager.createVideoResourceFromFile(projectId, sourceFilePath);
});

ipcMain.handle(
  'local-resource:create-video-from-buffer',
  async (_, projectId: string | undefined, fileName: string, buffer: ArrayBuffer) => {
    return localResourceManager.createVideoResourceFromBuffer(projectId, fileName, buffer);
  }
);

ipcMain.handle('local-resource:create-video-from-url', async (_, projectId: string | undefined, sourceUrl: string) => {
  return localResourceManager.createVideoResourceFromUrl(projectId, sourceUrl);
});

/** B 站 / YouTube 页：yt-dlp 本地下载后落盘到项目 assets（与 preload 中 IPC 名一致） */
ipcMain.handle('local-resource:create-video-from-bilibili-page', async (_, projectId: string | undefined, pageUrl: string) => {
  return localResourceManager.createVideoResourceFromBilibiliPage(projectId, pageUrl);
});

/** 运营控制台（需本机 NX_ADMIN_ISSUE_COUPON_SECRET 与 FC 一致） */
ipcMain.handle('admin-issue-coupon', async (_, amountCny: number) => nxAdminIssueCoupon(amountCny));
ipcMain.handle('admin-dashboard-stats', async () => nxAdminDashboardStats());
ipcMain.handle('admin-failed-tasks', async () => nxAdminFailedTasks());
ipcMain.handle('admin-refund-task', async (_, userId: string, taskId: string) =>
  nxAdminRefundTask(userId, taskId)
);
ipcMain.handle('admin-model-config-list', async () => nxAdminModelConfigList());
ipcMain.handle('admin-model-config-upsert', async (_, row) => nxAdminModelConfigUpsert(row));
ipcMain.handle('admin-get-all-users', async (_, maxScanRows?: number) => nxAdminGetAllUsers(maxScanRows));
ipcMain.handle('admin-profit-analytics', async (_, opts?: { maxTxScanRows?: number; maxCouponScanRows?: number }) =>
  nxAdminProfitAnalytics(opts)
);
