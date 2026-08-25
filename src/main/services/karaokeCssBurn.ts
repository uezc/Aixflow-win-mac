/**
 * 方案 A（唯一「合成到视频」路径）：预览级 CSS 烧录。
 * 与导演台预览同一套 wipe（未唱描边 + 已唱半边白描边+填色半扫：左白边右黑边）。
 * 隐藏 BrowserWindow 只渲字幕层 → capturePage raw BGRA/RGBA → ffmpeg rawvideo overlay。
 * 管道提前关闭时停写，避免 write EOF；失败自动回退方案 C（ffmpeg ass 滤镜，不走 stdin）。
 * 相对旧 PNG image2pipe：省去每帧 PNG 编解码；静止/间奏段复用 raw；不走全页 html2canvas。
 */

import { BrowserWindow, app, ipcMain, type NativeImage, type WebContents } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { KaraokeProject } from '../../shared/karaoke/types.js';
import {
  ASS_PLAY_RES_X,
  ASS_PLAY_RES_Y,
  clampKaraokeLineFadeOutSec,
  DEFAULT_KARAOKE_STYLE,
  KARAOKE_LINE_FADE_OUT_SEC,
  resolveKaraokeAudioSource,
} from '../../shared/karaoke/types.js';
import {
  applyGlobalOffsetToLines,
  karaokeCountdownOverlayNeedsUniqueFrame,
  karaokeOpeningCaptureBusyUntilSec,
  karaokeOpeningTimelineForProject,
  karaokeOverlayNeedsUniqueFrame,
  karaokeReentryCountdownWindowsForLines,
  prepareKaraokeLinesForRender,
} from '../../shared/karaoke/index.js';
import {
  karaokeCssBurnFrameTimeSec,
  resolveKaraokeCssBurnFps,
} from '../../shared/karaoke/cssBurnTiming.js';
import { localResourceManager, resolveLocalMediaFilePath } from './localResourceManager.js';
import {
  burnKaraokeSubtitlesToProject,
  cancelActiveKaraokeBurns,
  KARAOKE_BURN_TIMEOUT_MS,
  type KaraokeBurnResult,
} from './karaokeBurn.js';
import { cancelKaraokePreviewComposeSessions } from './karaokePreviewCompose.js';
import { cancelKaraokePreviewRecordSessions } from './karaokePreviewRecord.js';
import {
  karaokeSoftH264Encoder,
  resolveKaraokeFfmpegPath,
  guardKaraokeFfmpegStdin,
  isKaraokeOverlayPipeClosedError,
  KaraokeOverlayPipeClosedError,
} from './karaokeFfmpegEncode.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export {
  KARAOKE_CSS_BURN_DEFAULT_FPS,
  KARAOKE_CSS_BURN_LOW_SPEC_FPS,
  KARAOKE_CSS_BURN_MAX_FPS,
  KARAOKE_CSS_BURN_SMOOTH_FPS,
  karaokeCssBurnFrameTimeSec,
  normalizeKaraokeSourceFps,
  resolveKaraokeCssBurnFps,
} from '../../shared/karaoke/cssBurnTiming.js';
/** 最长时长（秒） */
const KARAOKE_CSS_BURN_MAX_DURATION_SEC = 12 * 60;
/**
 * 字幕层最长边上限：4K 片源降到 1080p 级抓帧再 scale 回片源，减轻 capture/resize；
 * ≤1920 片源不降采样。0 = 永不降。
 */
const KARAOKE_CSS_BURN_MAX_EDGE = 1920;
/** 办公本抓帧最长边（再降一档，显著减 capturePage/resize） */
const KARAOKE_CSS_BURN_LOW_SPEC_MAX_EDGE = 1280;

/** 主进程办公本探测：≤4 核或 ≤8GB 内存 */
export function detectKaraokeLowSpecMachineMain(): boolean {
  try {
    const cores = os.cpus()?.length || 0;
    const memGb = os.totalmem() / (1024 * 1024 * 1024);
    if (cores > 0 && cores <= 4) return true;
    if (Number.isFinite(memGb) && memGb > 0 && memGb <= 8) return true;
    if (!(cores > 0)) return true;
    return false;
  } catch {
    return true;
  }
}

type OverlayEvent =
  | { type: 'boot' }
  | { type: 'ready' }
  | { type: 'painted'; frameIndex?: number }
  | { type: 'shutdown-ack' }
  | { type: 'error'; error?: string };

type ActiveJob = {
  aborted: boolean;
  win: BrowserWindow | null;
  ffmpeg: ChildProcess | null;
  progressCb: ((p: KaraokeCssBurnProgress) => void) | null;
};

let activeJob: ActiveJob | null = null;
let overlayIpcInstalled = false;

export type KaraokeCssBurnProgress = {
  phase: 'prepare' | 'capture' | 'encode' | 'done';
  frame: number;
  total: number;
  percent: number;
  message?: string;
  /** 抓帧帧率（便于 UI 标明办公本降帧） */
  fps?: number;
  /** 预计剩余秒数 */
  etaSeconds?: number | null;
  /** 是否办公本/低配路径 */
  lowSpec?: boolean;
};

export type KaraokeCssBurnOpts = {
  fps?: number;
  durationSec?: number;
  lowSpec?: boolean;
  /**
   * 流畅优先：忽略低配降帧。
   * undefined = 主进程按机器规格自动（办公本关流畅）。
   */
  preferSmooth?: boolean;
  signal?: AbortSignal;
  onProgress?: (p: KaraokeCssBurnProgress) => void;
};

function resolveFfmpegPath(): string {
  return resolveKaraokeFfmpegPath();
}

function makeAbortError(reason: 'cancelled' | 'timeout' = 'cancelled'): Error {
  const e = new Error(reason === 'timeout' ? 'burn timeout' : 'cancelled');
  e.name = reason === 'timeout' ? 'TimeoutError' : 'AbortError';
  return e;
}

function evenDim(n: number): number {
  const v = Math.max(2, Math.round(n));
  return v % 2 === 0 ? v : v + 1;
}

/** Electron NativeImage.toBitmap：Win=BGRA，macOS/Linux=RGBA（均为预乘 alpha） */
function rawPixelFormat(): 'bgra' | 'rgba' {
  return process.platform === 'win32' ? 'bgra' : 'rgba';
}

/**
 * capturePage → 固定 WxH 的 raw 像素（4 bytes/px）。
 * 高 DPI 下 capture 可能放大，先 resize 再 toBitmap，保证 ffmpeg rawvideo 尺寸恒定。
 */
function captureToRawFrame(image: NativeImage, w: number, h: number): Buffer {
  const sz = image.getSize();
  const scaled =
    sz.width === w && sz.height === h
      ? image
      : // good 足够且比 better 快，减轻半扫烧录卡顿
        image.resize({ width: w, height: h, quality: 'good' });
  const buf = scaled.toBitmap();
  const expect = w * h * 4;
  if (buf.length !== expect) {
    throw new Error(
      `raw frame size mismatch: got ${buf.length}, expect ${expect} (${w}x${h})`,
    );
  }
  return buf;
}

function resolveCaptureSize(
  videoW: number,
  videoH: number,
  maxEdge: number = KARAOKE_CSS_BURN_MAX_EDGE,
): { w: number; h: number } {
  let w = videoW > 0 ? videoW : ASS_PLAY_RES_X;
  let h = videoH > 0 ? videoH : ASS_PLAY_RES_Y;
  const longest = Math.max(w, h);
  const edgeCap = maxEdge > 0 ? maxEdge : 0;
  if (edgeCap > 0 && longest > edgeCap) {
    const s = edgeCap / longest;
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  return { w: evenDim(w), h: evenDim(h) };
}

async function probeVideoMeta(inputPath: string): Promise<{
  durationSec: number;
  width: number;
  height: number;
  fps: number;
}> {
  const bin = resolveFfmpegPath();
  const stderr = await new Promise<string>((resolve) => {
    const child = spawn(bin, ['-hide_banner', '-i', inputPath], { windowsHide: true });
    let err = '';
    child.stderr?.on('data', (chunk) => {
      err += String(chunk || '');
    });
    child.on('error', () => resolve(err));
    child.on('close', () => resolve(err));
  });

  let durationSec = 0;
  const durM = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  if (durM) {
    durationSec = Number(durM[1]) * 3600 + Number(durM[2]) * 60 + Number(durM[3]);
  }
  let width = 0;
  let height = 0;
  const dimM = stderr.match(/Video:.*?(\d{2,5})x(\d{2,5})/i);
  if (dimM) {
    width = Number(dimM[1]) || 0;
    height = Number(dimM[2]) || 0;
  }
  let fps = 0;
  const fpsM =
    stderr.match(/,\s*(\d+(?:\.\d+)?)\s*fps/i) ||
    stderr.match(/,\s*(\d+(?:\.\d+)?)\s*tbr/i);
  if (fpsM) {
    fps = Number(fpsM[1]) || 0;
  }
  return {
    durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0,
    width: width > 0 ? width : ASS_PLAY_RES_X,
    height: height > 0 ? height : ASS_PLAY_RES_Y,
    fps: Number.isFinite(fps) && fps > 0 ? fps : 0,
  };
}

/**
 * 离屏字幕窗 preload：产物在 `dist-electron/preload/`（见 tsconfig.preload.json）。
 * 本文件编译后在 `dist-electron/main/services/`，须用 `../../preload`，
 * 勿用 `../preload`（会误指 `dist-electron/main/preload/`）。
 */
function resolveOverlayPreloadPath(): string {
  const candidates = [
    path.join(__dirname, '../../preload/karaokeBurnOverlayPreload.js'),
    path.join(__dirname, '../../preload/karaokeBurnOverlayPreload.cjs'),
    // 兼容：若将来与 main/index 同级放置
    path.join(__dirname, '../preload/karaokeBurnOverlayPreload.js'),
    path.join(__dirname, '../preload/karaokeBurnOverlayPreload.cjs'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

/** 与主窗口一致：未打包或明确 development 即走 Vite */
function isKaraokeCssBurnDev(): boolean {
  return process.env.NODE_ENV === 'development' || !app.isPackaged;
}

function resolveOverlayFileCandidates(): string[] {
  const list: string[] = [];
  try {
    list.push(path.join(app.getAppPath(), 'dist', 'karaoke-burn-overlay.html'));
  } catch {
    /* ignore */
  }
  list.push(path.join(__dirname, '../../dist/karaoke-burn-overlay.html'));
  if (app.isPackaged && process.resourcesPath) {
    list.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'karaoke-burn-overlay.html'));
  }
  return list;
}

function resolveOverlayPageUrl(): { kind: 'url' | 'file'; value: string } {
  // 开发：与主窗口一致走 Vite（避免误用过期 dist 页）
  if (isKaraokeCssBurnDev()) {
    const port = Number(process.env.VITE_DEV_SERVER_PORT) || 5274;
    return { kind: 'url', value: `http://localhost:${port}/karaoke-burn-overlay.html` };
  }
  for (const file of resolveOverlayFileCandidates()) {
    if (fs.existsSync(file)) {
      return { kind: 'file', value: file };
    }
  }
  return {
    kind: 'file',
    value:
      resolveOverlayFileCandidates()[0] ||
      path.join(__dirname, '../../dist/karaoke-burn-overlay.html'),
  };
}

function ensureOverlayIpc(): void {
  if (overlayIpcInstalled) return;
  overlayIpcInstalled = true;
  // 事件由 waitForOverlayEvent 按 webContents 订阅；此处占位避免未监听告警
  ipcMain.on('karaoke-burn-overlay-event', () => {
    /* handled per-job */
  });
}

function waitForOverlayEvent(
  wc: WebContents,
  pred: (msg: OverlayEvent) => boolean,
  timeoutMs: number,
): Promise<OverlayEvent> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('overlay event timeout'));
    }, timeoutMs);

    const onMsg = (event: Electron.IpcMainEvent, msg: OverlayEvent) => {
      if (event.sender !== wc) return;
      if (!pred(msg || ({} as OverlayEvent))) return;
      cleanup();
      resolve(msg);
    };

    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ipcMain.removeListener('karaoke-burn-overlay-event', onMsg);
    };

    ipcMain.on('karaoke-burn-overlay-event', onMsg);
  });
}

function killChild(child: ChildProcess | null): void {
  if (!child || child.killed) return;
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        shell: false,
        stdio: 'ignore',
      });
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    /* ignore */
  }
}

function closeBurnWindow(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  try {
    win.destroy();
  } catch {
    /* ignore */
  }
}

/** 取消 CSS 烧录任务 */
export function cancelKaraokeCssBurn(): { killed: number } {
  if (!activeJob) return { killed: 0 };
  activeJob.aborted = true;
  killChild(activeJob.ffmpeg);
  closeBurnWindow(activeJob.win);
  activeJob.ffmpeg = null;
  activeJob.win = null;
  return { killed: 1 };
}

/** 取消全部卡拉OK合成（CSS + 录制预览 + 旧 session + ASS） */
export function cancelAllKaraokeComposeJobs(): { success: true; killed: number } {
  const css = cancelKaraokeCssBurn();
  const record = cancelKaraokePreviewRecordSessions();
  const preview = cancelKaraokePreviewComposeSessions();
  const ass = cancelActiveKaraokeBurns();
  return {
    success: true,
    killed:
      css.killed + record.killed + preview.killedSessions + preview.killedFfmpeg + ass.killed,
  };
}

/**
 * 方案 A 单次：离屏字幕层 capturePage + ffmpeg overlay 入库。
 */
async function burnKaraokeCssPreviewOnce(
  projectId: string | undefined,
  videoUrl: string,
  karaokeProject: KaraokeProject,
  opts?: KaraokeCssBurnOpts,
): Promise<KaraokeBurnResult> {
  if (activeJob && !activeJob.aborted) {
    return { success: false, error: 'another karaoke css burn is running' };
  }

  ensureOverlayIpc();
  const job: ActiveJob = {
    aborted: false,
    win: null,
    ffmpeg: null,
    progressCb: opts?.onProgress || null,
  };
  activeJob = job;

  const timeoutMs = KARAOKE_BURN_TIMEOUT_MS;
  const ac = new AbortController();
  const onAbort = () => {
    job.aborted = true;
    killChild(job.ffmpeg);
    closeBurnWindow(job.win);
  };
  opts?.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    job.aborted = true;
    ac.abort();
    onAbort();
  }, timeoutMs);

  const report = (p: KaraokeCssBurnProgress) => {
    try {
      job.progressCb?.(p);
    } catch {
      /* ignore */
    }
  };

  let outTmp = '';
  let workDir = '';

  try {
    report({ phase: 'prepare', frame: 0, total: 1, percent: 1, message: 'prepare' });

    const inputPath = await resolveLocalMediaFilePath(projectId, videoUrl);
    const audioSource = resolveKaraokeAudioSource(karaokeProject);
    let songAudioPath: string | null = null;
    if (audioSource === 'song') {
      const songUrl = String(karaokeProject.audioUrl || '').trim();
      if (!songUrl) {
        return { success: false, error: 'song audio required for audioSource=song' };
      }
      songAudioPath = await resolveLocalMediaFilePath(projectId, songUrl);
    }

    const meta = await probeVideoMeta(inputPath);
    const rawDur =
      Number(opts?.durationSec) > 0 ? Number(opts?.durationSec) : meta.durationSec || 0.1;
    const durationSec = Math.max(
      0.1,
      Math.min(KARAOKE_CSS_BURN_MAX_DURATION_SEC, rawDur),
    );
    // undefined = 按机器自动：办公本关流畅并降帧；显式 true/false 尊重调用方
    const lowSpecMachine = detectKaraokeLowSpecMachineMain();
    const preferSmooth =
      opts?.preferSmooth !== undefined ? !!opts.preferSmooth : !lowSpecMachine;
    const lowSpec = preferSmooth
      ? false
      : opts?.lowSpec !== undefined
        ? !!opts.lowSpec
        : lowSpecMachine;
    const fps = resolveKaraokeCssBurnFps({
      fps: opts?.fps,
      lowSpec,
      preferSmooth,
      sourceFps: meta.fps,
    });
    const frameCount = Math.max(1, Math.ceil(durationSec * fps));
    const frameDur = 1 / fps;
    const captureEdge = lowSpec
      ? KARAOKE_CSS_BURN_LOW_SPEC_MAX_EDGE
      : KARAOKE_CSS_BURN_MAX_EDGE;
    const capture = resolveCaptureSize(meta.width, meta.height, captureEdge);
    const outW = evenDim(meta.width || capture.w);
    const outH = evenDim(meta.height || capture.h);

    const offsetLines = prepareKaraokeLinesForRender(
      applyGlobalOffsetToLines(
        karaokeProject.lines || [],
        Number(karaokeProject.globalOffsetSec) || 0,
      ),
      undefined,
      karaokeProject.lyrics,
    );
    const fadeOutSec = clampKaraokeLineFadeOutSec(
      karaokeProject.style?.lineFadeOutSec ??
        DEFAULT_KARAOKE_STYLE.lineFadeOutSec ??
        KARAOKE_LINE_FADE_OUT_SEC,
    );
    const openingTl = karaokeOpeningTimelineForProject(karaokeProject);
    // 须覆盖蓝点倒计时至 firstSing（勿只用 endSec=lyricAppear，否则扣点段复用冻住 4 点）
    const openingBusyUntil = karaokeOpeningCaptureBusyUntilSec(
      openingTl,
      karaokeProject.previewOpeningCredits,
    );
    const reentryCountdownWindows = karaokeReentryCountdownWindowsForLines(offsetLines, {
      fadeOutSec,
      style: karaokeProject.style,
    });

    workDir = path.join(
      os.tmpdir(),
      `nfkcss${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    );
    fs.mkdirSync(workDir, { recursive: true });
    outTmp = path.join(workDir, 'out.mp4');

    const preloadPath = resolveOverlayPreloadPath();
    if (!fs.existsSync(preloadPath)) {
      return { success: false, error: `overlay preload missing: ${preloadPath}` };
    }

    const page = resolveOverlayPageUrl();
    if (page.kind === 'file' && !fs.existsSync(page.value)) {
      return { success: false, error: `overlay page missing: ${page.value}` };
    }

    const win = new BrowserWindow({
      width: capture.w,
      height: capture.h,
      useContentSize: true,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
        // 勿开 offscreen：Win 上 transparent+offscreen 易抓到空/黑帧；用移出屏 showInactive
        offscreen: false,
        webSecurity: false,
      },
    });
    job.win = win;
    win.setMenuBarVisibility(false);
    // 完全隐藏时部分 GPU 驱动不绘制；移出屏幕再 showInactive 保证 capturePage 有像素
    try {
      win.setPosition(-10_000, -10_000);
      win.showInactive();
    } catch {
      /* ignore */
    }

    // 先挂监听再 load，避免错过 boot
    const bootP = waitForOverlayEvent(win.webContents, (m) => m.type === 'boot', 60_000);
    try {
      if (page.kind === 'url') {
        await win.loadURL(page.value);
      } else {
        await win.loadFile(page.value);
      }
    } catch (loadErr: any) {
      throw new Error(
        `overlay load failed (${page.kind}: ${page.value}): ${loadErr?.message || loadErr}. ` +
          (page.kind === 'url'
            ? '请确认 Vite 已启动且可打开 karaoke-burn-overlay.html'
            : '请先 npm run build:renderer 生成 dist/karaoke-burn-overlay.html'),
      );
    }
    await bootP;

    const readyP = waitForOverlayEvent(win.webContents, (m) => m.type === 'ready', 30_000);
    win.webContents.send('karaoke-burn-overlay-cmd', {
      type: 'init',
      project: karaokeProject,
      width: capture.w,
      height: capture.h,
    });
    await readyP;

    if (job.aborted || opts?.signal?.aborted) {
      throw makeAbortError('cancelled');
    }

    // 启动 ffmpeg：raw BGRA/RGBA pipe → scale → overlay（预乘 alpha）
    // 勿对 overlay 再套 fps=：raw 已按 -framerate 打时间戳，二次 fps 易造成重复/丢帧观感卡顿
    // 底片用 fps= 重采样到同一 CFR，避免与叠层时间基错位导致半扫「跳帧」观感
    const pixFmt = rawPixelFormat();
    const filter = [
      `[1:v]scale=${outW}:${outH}:flags=bilinear,format=rgba,setpts=N/${fps}/TB[ov]`,
      `[0:v]fps=${fps},scale=${outW}:${outH}:flags=bilinear,setpts=N/${fps}/TB[base]`,
      // NativeImage.toBitmap 为预乘；PNG 时代为直通 alpha，此处显式声明
      `[base][ov]overlay=0:0:format=auto:alpha=premultiplied[vout]`,
    ].join(';');

    const rawInputArgs = [
      '-thread_queue_size',
      '1024',
      '-f',
      'rawvideo',
      '-pixel_format',
      pixFmt,
      '-video_size',
      `${capture.w}x${capture.h}`,
      '-framerate',
      String(fps),
      '-i',
      '-',
    ];

    // overlay 走 stdin raw：硬编（nvenc/qsv）中途挂掉会关管道并弹 write EOF；软编更稳
    const encoder = karaokeSoftH264Encoder();
    const ffmpegArgs = songAudioPath
      ? [
          '-y',
          '-hide_banner',
          '-i',
          inputPath,
          ...rawInputArgs,
          '-i',
          songAudioPath,
          '-filter_complex',
          filter,
          '-map',
          '[vout]',
          '-map',
          '2:a:0',
          ...encoder.args,
          '-fps_mode',
          'cfr',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-shortest',
          '-movflags',
          '+faststart',
          outTmp,
        ]
      : [
          '-y',
          '-hide_banner',
          '-i',
          inputPath,
          ...rawInputArgs,
          '-filter_complex',
          filter,
          '-map',
          '[vout]',
          '-map',
          '0:a?',
          '-c:a',
          'copy',
          ...encoder.args,
          '-fps_mode',
          'cfr',
          '-movflags',
          '+faststart',
          '-shortest',
          outTmp,
        ];

    const bin = resolveFfmpegPath();
    const ff = spawn(bin, ffmpegArgs, {
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    job.ffmpeg = ff;

    let ffStderr = '';
    ff.stderr?.on('data', (chunk) => {
      ffStderr += String(chunk || '');
      if (ffStderr.length > 80_000) ffStderr = ffStderr.slice(-40_000);
    });

    const ffDone = new Promise<void>((resolve, reject) => {
      ff.on('error', reject);
      ff.on('close', (code) => {
        if (job.aborted) {
          reject(makeAbortError('cancelled'));
          return;
        }
        if (code === 0) resolve();
        else reject(new Error(ffStderr.slice(-2000) || `ffmpeg exited ${code}`));
      });
    });

    console.log(
      '[karaoke] css-burn start engine=css (Plan A dual-stroke wipe)',
      `${frameCount} frames @ ${fps}fps`,
      `sourceFps=${meta.fps || 'n/a'}`,
      preferSmooth ? 'preferSmooth' : lowSpec ? 'lowSpec' : 'default',
      `capture ${capture.w}x${capture.h} ${pixFmt}`,
      `out ${outW}x${outH}`,
      `encoder ${encoder.name}`,
      `page ${page.kind}:${page.value}`,
    );

    const stdin = ff.stdin;
    if (!stdin) {
      throw new Error('ffmpeg stdin unavailable');
    }
    guardKaraokeFfmpegStdin(stdin);
    let overlayPipeClosed = false;
    const markOverlayPipeClosed = () => {
      overlayPipeClosed = true;
    };
    stdin.on('close', markOverlayPipeClosed);
    stdin.on('finish', markOverlayPipeClosed);

    const writeRaw = async (raw: Buffer) => {
      if (overlayPipeClosed || stdin.destroyed || !stdin.writable) {
        throw new KaraokeOverlayPipeClosedError();
      }
      try {
        const ok = stdin.write(raw);
        if (!ok) {
          await new Promise<void>((resolve, reject) => {
            const onDrain = () => {
              cleanup();
              resolve();
            };
            const onErr = (err: Error) => {
              cleanup();
              reject(
                isKaraokeOverlayPipeClosedError(err)
                  ? new KaraokeOverlayPipeClosedError()
                  : err,
              );
            };
            const cleanup = () => {
              stdin.off('drain', onDrain);
              stdin.off('error', onErr);
            };
            stdin.once('drain', onDrain);
            stdin.once('error', onErr);
          });
        }
      } catch (err) {
        if (isKaraokeOverlayPipeClosedError(err)) {
          throw new KaraokeOverlayPipeClosedError();
        }
        throw err;
      }
    };

    /**
     * 静止段批量写入：多帧拼成一块减少 drain 抖动，避免抓帧等待不均匀传导成「跳帧」观感。
     * 输出仍是 CFR（相同 raw 重复 N 次），时间轴连续。
     */
    const writeRawRepeat = async (raw: Buffer, count: number) => {
      if (count <= 0) return;
      if (count === 1) {
        await writeRaw(raw);
        return;
      }
      const CHUNK = 12;
      let left = count;
      while (left > 0) {
        const n = Math.min(CHUNK, left);
        if (n === 1) {
          await writeRaw(raw);
        } else {
          await writeRaw(Buffer.concat(Array.from({ length: n }, () => raw)));
        }
        left -= n;
      }
    };

    const kickAndCapture = async (frameIndex: number): Promise<Buffer> => {
      if (job.aborted || opts?.signal?.aborted) {
        throw makeAbortError('cancelled');
      }
      const painted = waitForOverlayEvent(
        win.webContents,
        (m) => m.type === 'painted' && Number(m.frameIndex) === frameIndex,
        20_000,
      );
      win.webContents.send('karaoke-burn-overlay-cmd', {
        type: 'setTime',
        t: karaokeCssBurnFrameTimeSec(frameIndex, fps),
        frameIndex,
      });
      await painted;
      const image = await win.webContents.capturePage({
        x: 0,
        y: 0,
        width: capture.w,
        height: capture.h,
      });
      return captureToRawFrame(image, capture.w, capture.h);
    };

    // 预计算每帧是否需唯一抓取（动画中 / 进出静止边界各钉 1 帧，避免复用突变）
    const needUnique = new Uint8Array(frameCount);
    {
      let wasAnim = true;
      for (let i = 0; i < frameCount; i++) {
        const t = karaokeCssBurnFrameTimeSec(i, fps);
        const uniqueEps = Math.max(frameDur * 0.5, 1e-4);
        const animating =
          t < openingBusyUntil ||
          karaokeCountdownOverlayNeedsUniqueFrame(t, reentryCountdownWindows, uniqueEps) ||
          karaokeOverlayNeedsUniqueFrame(offsetLines, t, {
            fadeOutSec,
            eps: uniqueEps,
          });
        // 动画段全抓；进入/离开静止各多抓 1 帧，减轻静止复用边界跳变
        needUnique[i] = i === 0 || animating || wasAnim ? 1 : 0;
        wasAnim = animating;
      }
      // 静止→动画边界前一帧也强制唯一（若被标静止），保证接缝时间正确
      for (let i = 1; i < frameCount; i++) {
        if (needUnique[i] && !needUnique[i - 1]) needUnique[i - 1] = 1;
      }
    }

    // 流水线：写 raw[i] 时已 kick 下一帧 paint；静止段批量复用上一 raw
    let rawPrev = await kickAndCapture(0);
    let capturedUnique = 1;
    let reusedStatic = 0;
    let overlayStoppedEarly = false;
    const captureStartedAt = Date.now();
    let lastProgressAt = 0;
    const emitCaptureProgress = (frameDone: number, force = false) => {
      const now = Date.now();
      if (!force && now - lastProgressAt < 500 && frameDone < frameCount) return;
      lastProgressAt = now;
      const done = Math.min(frameDone, frameCount);
      const elapsedSec = Math.max(0.001, (now - captureStartedAt) / 1000);
      const rate = done / elapsedSec;
      const remain = frameCount - done;
      const etaSeconds =
        done >= 2 && rate > 0.05 ? Math.max(0, Math.round(remain / rate)) : null;
      const modeTag = lowSpec ? `office ${fps}fps` : `Plan A ${fps}fps`;
      report({
        phase: 'capture',
        frame: done,
        total: frameCount,
        percent: Math.max(2, Math.round((done / frameCount) * 88)),
        message: `${modeTag} · unique ${capturedUnique}/reuse ${reusedStatic}`,
        fps,
        etaSeconds,
        lowSpec,
      });
    };
    emitCaptureProgress(1, true);

    let i = 1;
    try {
      while (i < frameCount) {
        if (job.aborted || opts?.signal?.aborted) {
          throw makeAbortError('cancelled');
        }
        if (!needUnique[i]) {
          let run = 0;
          while (i + run < frameCount && !needUnique[i + run]) run++;
          await writeRawRepeat(rawPrev, run);
          reusedStatic += run;
          i += run;
        } else {
          const paintedNext = waitForOverlayEvent(
            win.webContents,
            (m) => m.type === 'painted' && Number(m.frameIndex) === i,
            20_000,
          );
          win.webContents.send('karaoke-burn-overlay-cmd', {
            type: 'setTime',
            t: karaokeCssBurnFrameTimeSec(i, fps),
            frameIndex: i,
          });
          // 先 kick 再写上一帧，让 paint 与 stdin drain 重叠，减轻不均匀等待
          await writeRaw(rawPrev);
          await paintedNext;
          const image = await win.webContents.capturePage({
            x: 0,
            y: 0,
            width: capture.w,
            height: capture.h,
          });
          rawPrev = captureToRawFrame(image, capture.w, capture.h);
          capturedUnique += 1;
          i += 1;
        }
        // 更密进度：每 8 帧强制刷新，其余 ≥500ms 节流，避免办公本长时间无反馈
        emitCaptureProgress(i, i % 8 === 0 || i >= frameCount);
      }
      await writeRaw(rawPrev);
    } catch (pipeErr) {
      if (!isKaraokeOverlayPipeClosedError(pipeErr)) throw pipeErr;
      overlayStoppedEarly = true;
      console.warn(
        '[karaoke] css-burn overlay pipe closed; waiting ffmpeg result',
        `frame ${i}/${frameCount}`,
      );
    }

    report({
      phase: 'encode',
      frame: frameCount,
      total: frameCount,
      percent: 92,
      fps,
      etaSeconds: 0,
      lowSpec,
      message: lowSpec ? 'office encode' : 'encode',
    });
    try {
      if (!stdin.destroyed && stdin.writable) stdin.end();
    } catch {
      /* 管道已关时 end 也可能 EOF */
    }
    await ffDone;
    if (overlayStoppedEarly) {
      console.warn('[karaoke] css-burn recovered after overlay pipe close');
    }

    if (job.aborted) throw makeAbortError('cancelled');

    const resource = await localResourceManager.createVideoResourceFromFile(projectId, outTmp);
    report({
      phase: 'done',
      frame: frameCount,
      total: frameCount,
      percent: 100,
      fps,
      etaSeconds: 0,
      lowSpec,
    });
    console.log(
      '[karaoke] css-burn done engine=css (Plan A)',
      `unique=${capturedUnique}`,
      `reuse=${reusedStatic}`,
      `@${fps}fps`,
    );
    return {
      success: true,
      engine: 'css' as const,
      originalUrl: resource.originalUrl,
      originalPath: resource.originalPath,
      posterUrl: resource.posterUrl,
      width: resource.width,
      height: resource.height,
    };
  } catch (e: any) {
    const name = e?.name || '';
    const msg = e?.message || String(e);
    if (name === 'AbortError' || /cancel/i.test(msg)) {
      return { success: false, canceled: true, error: 'cancelled' };
    }
    if (name === 'TimeoutError' || /timeout/i.test(msg)) {
      return { success: false, timedOut: true, error: 'burn timeout' };
    }
    console.error('[karaoke] css-burn failed', e);
    return { success: false, error: msg };
  } finally {
    clearTimeout(timer);
    opts?.signal?.removeEventListener('abort', onAbort);
    killChild(job.ffmpeg);
    closeBurnWindow(job.win);
    if (activeJob === job) activeJob = null;
    if (workDir) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

function shouldFallbackCssBurnToAss(result: KaraokeBurnResult): boolean {
  if (result.success || result.canceled || result.timedOut) return false;
  const err = String(result.error || '');
  if (/another karaoke css burn is running/i.test(err)) return false;
  if (/song audio required/i.test(err)) return false;
  return true;
}

/**
 * 方案 A 主入口：CSS 半扫烧录；管道/编码器失败时回退方案 C（ffmpeg ass 滤镜，不走 stdin）。
 */
export async function burnKaraokeWithCssPreview(
  projectId: string | undefined,
  videoUrl: string,
  karaokeProject: KaraokeProject,
  opts?: KaraokeCssBurnOpts,
): Promise<KaraokeBurnResult> {
  const css = await burnKaraokeCssPreviewOnce(projectId, videoUrl, karaokeProject, opts);
  if (!shouldFallbackCssBurnToAss(css)) return css;
  if (opts?.signal?.aborted) return css;

  console.warn('[karaoke] css-burn failed, falling back to ASS', css.error);
  try {
    opts?.onProgress?.({
      phase: 'encode',
      frame: 0,
      total: 1,
      percent: 90,
      message: 'fallback ass',
    });
  } catch {
    /* ignore */
  }

  const ass = await burnKaraokeSubtitlesToProject(projectId, videoUrl, karaokeProject);
  if (ass.success) {
    console.warn('[karaoke] css-burn recovered via ASS');
    return { ...ass, engine: 'ass' };
  }
  return {
    success: false,
    canceled: ass.canceled,
    timedOut: ass.timedOut,
    error: `${css.error || 'css burn failed'}；ASS 回退失败：${ass.error || 'failed'}`,
  };
}
