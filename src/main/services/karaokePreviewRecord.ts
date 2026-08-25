/**
 * 卡拉OK「录制预览导出」：
 * 片源文件作主输入（全分辨率），渲染进程只喂透明歌词叠层 raw（BGRA/RGBA），
 * ffmpeg overlay 一次硬编；无词时段写全透明帧（不 seek、不复用烂画面）。
 */

import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { KaraokeProject } from '../../shared/karaoke/types.js';
import { resolveKaraokeAudioSource } from '../../shared/karaoke/types.js';
import { localResourceManager, resolveLocalMediaFilePath } from './localResourceManager.js';
import { KARAOKE_BURN_TIMEOUT_MS, type KaraokeBurnResult } from './karaokeBurn.js';
import {
  pickKaraokeH264Encoder,
  resolveKaraokeFfmpegPath,
  guardKaraokeFfmpegStdin,
  type KaraokeEncoderPick,
} from './karaokeFfmpegEncode.js';

export const KARAOKE_PREVIEW_RECORD_DEFAULT_FPS = 30;
export const KARAOKE_PREVIEW_RECORD_MAX_FPS = 60;
const KARAOKE_PREVIEW_RECORD_MAX_DURATION_SEC = 3 * 60 * 60;

type RecordSession = {
  id: string;
  projectId: string | undefined;
  workDir: string;
  outTmp: string;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  durationSec: number;
  encoderName: string;
  /** rawvideo 像素格式：Win capturePage→BGRA，其余 RGBA */
  pixelFormat: 'bgra' | 'rgba';
  ffmpeg: ChildProcess | null;
  aborted: boolean;
  framesWritten: number;
  ffDone: Promise<void> | null;
  ffStderr: string;
  createdAt: number;
};

const sessions = new Map<string, RecordSession>();

function evenDim(n: number): number {
  const v = Math.max(2, Math.round(n));
  return v % 2 === 0 ? v : v + 1;
}

function makeAbortError(reason: 'cancelled' | 'timeout' = 'cancelled'): Error {
  const e = new Error(reason === 'timeout' ? 'burn timeout' : 'cancelled');
  e.name = reason === 'timeout' ? 'TimeoutError' : 'AbortError';
  return e;
}

function rmDirSafe(dir: string): void {
  try {
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
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

function abortSession(session: RecordSession): void {
  session.aborted = true;
  try {
    session.ffmpeg?.stdin?.destroy();
  } catch {
    /* ignore */
  }
  killChild(session.ffmpeg);
  session.ffmpeg = null;
}

async function probeVideoMeta(inputPath: string): Promise<{
  durationSec: number;
  width: number;
  height: number;
}> {
  const bin = resolveKaraokeFfmpegPath();
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
  return {
    durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0,
    width: width > 0 ? width : 1920,
    height: height > 0 ? height : 1080,
  };
}

function buildFfmpegArgs(opts: {
  width: number;
  height: number;
  fps: number;
  inputPath: string;
  songAudioPath: string | null;
  encoder: KaraokeEncoderPick;
  outTmp: string;
  pixelFormat: 'bgra' | 'rgba';
}): string[] {
  const { width, height, fps, inputPath, songAudioPath, encoder, outTmp, pixelFormat } = opts;
  const rawIn = [
    '-f',
    'rawvideo',
    '-pix_fmt',
    pixelFormat,
    '-s',
    `${width}x${height}`,
    '-r',
    String(fps),
    '-i',
    '-',
  ];
  const commonTail = [
    ...encoder.args,
    '-fps_mode',
    'cfr',
    '-movflags',
    '+faststart',
    '-shortest',
    outTmp,
  ];

  if (songAudioPath) {
    return [
      '-y',
      '-hide_banner',
      '-i',
      inputPath,
      ...rawIn,
      '-i',
      songAudioPath,
      '-map',
      '1:v:0',
      '-map',
      '2:a:0',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      ...commonTail,
    ];
  }
  return [
    '-y',
    '-hide_banner',
    '-i',
    inputPath,
    ...rawIn,
    '-map',
    '1:v:0',
    '-map',
    '0:a?',
    '-c:a',
    'copy',
    ...commonTail,
  ];
}

async function writeStdin(child: ChildProcess, buf: Buffer): Promise<void> {
  const stdin = child.stdin;
  if (!stdin || stdin.destroyed || !stdin.writable) throw new Error('ffmpeg stdin unavailable');
  guardKaraokeFfmpegStdin(stdin);
  const ok = stdin.write(buf);
  if (!ok) {
    await new Promise<void>((resolve, reject) => {
      const onDrain = () => {
        cleanup();
        resolve();
      };
      const onErr = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        stdin.off('drain', onDrain);
        stdin.off('error', onErr);
      };
      stdin.once('drain', onDrain);
      stdin.once('error', onErr);
    });
  }
}

export type KaraokePreviewRecordBeginOpts = {
  fps?: number;
  durationSec?: number;
  width?: number;
  height?: number;
  /** 渲染侧 canvas=rgba；capturePage Win=bgra */
  pixelFormat?: 'rgba' | 'bgra';
};

export type KaraokePreviewRecordBeginResult = {
  success: boolean;
  sessionId?: string;
  width?: number;
  height?: number;
  fps?: number;
  frameCount?: number;
  durationSec?: number;
  encoder?: string;
  error?: string;
};

export async function beginKaraokePreviewRecord(
  projectId: string | undefined,
  videoUrl: string,
  karaokeProject: KaraokeProject,
  opts?: KaraokePreviewRecordBeginOpts,
): Promise<KaraokePreviewRecordBeginResult> {
  cancelKaraokePreviewRecordSessions();

  try {
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
    const width = evenDim(
      Number(opts?.width) > 0 ? Number(opts?.width) : meta.width || 1920,
    );
    const height = evenDim(
      Number(opts?.height) > 0 ? Number(opts?.height) : meta.height || 1080,
    );
    const rawDur =
      Number(opts?.durationSec) > 0 ? Number(opts?.durationSec) : meta.durationSec || 0.1;
    const durationSec = Math.max(
      0.1,
      Math.min(KARAOKE_PREVIEW_RECORD_MAX_DURATION_SEC, rawDur),
    );
    const fpsRaw = Number(opts?.fps);
    const fps =
      Number.isFinite(fpsRaw) && fpsRaw >= 1
        ? Math.min(KARAOKE_PREVIEW_RECORD_MAX_FPS, Math.max(1, Math.round(fpsRaw)))
        : KARAOKE_PREVIEW_RECORD_DEFAULT_FPS;
    const frameCount = Math.max(1, Math.ceil(durationSec * fps));

    const workDir = path.join(
      os.tmpdir(),
      `nfkrec${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    );
    fs.mkdirSync(workDir, { recursive: true });
    const outTmp = path.join(workDir, 'out.mp4');

    const bin = resolveKaraokeFfmpegPath();
    const encoder = await pickKaraokeH264Encoder(bin);
    const pixelFormat: 'bgra' | 'rgba' =
      opts?.pixelFormat === 'rgba' || opts?.pixelFormat === 'bgra'
        ? opts.pixelFormat
        : process.platform === 'win32'
          ? 'bgra'
          : 'rgba';
    const args = buildFfmpegArgs({
      width,
      height,
      fps,
      inputPath,
      songAudioPath,
      encoder,
      outTmp,
      pixelFormat,
    });

    const child = spawn(bin, args, {
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    guardKaraokeFfmpegStdin(child.stdin);
    let ffStderr = '';
    child.stderr?.on('data', (chunk) => {
      ffStderr += String(chunk || '');
      if (ffStderr.length > 80_000) ffStderr = ffStderr.slice(-40_000);
    });
    const ffDone = new Promise<void>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(ffStderr.slice(-2000) || `ffmpeg exited ${code}`));
      });
    });

    const id = `krec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const session: RecordSession = {
      id,
      projectId,
      workDir,
      outTmp,
      width,
      height,
      fps,
      frameCount,
      durationSec,
      encoderName: encoder.name,
      pixelFormat,
      ffmpeg: child,
      aborted: false,
      framesWritten: 0,
      ffDone,
      ffStderr: '',
      createdAt: Date.now(),
    };
    child.stderr?.on('data', () => {
      session.ffStderr = ffStderr;
    });
    sessions.set(id, session);

    console.log(
      '[karaoke] preview-record begin',
      `${width}x${height} @ ${fps}fps`,
      `${frameCount} frames`,
      `encoder ${encoder.name}`,
    );

    return {
      success: true,
      sessionId: id,
      width,
      height,
      fps,
      frameCount,
      durationSec,
      encoder: encoder.name,
    };
  } catch (e: any) {
    return { success: false, error: String(e?.message || e || 'begin failed') };
  }
}

export async function writeKaraokePreviewRecordFrame(
  sessionId: string,
  _frameIndex: number,
  rgba: ArrayBuffer | Uint8Array | Buffer,
): Promise<{ success: boolean; error?: string }> {
  const session = sessions.get(String(sessionId || ''));
  if (!session) return { success: false, error: 'session not found' };
  if (session.aborted) return { success: false, error: 'cancelled' };
  if (!session.ffmpeg) return { success: false, error: 'ffmpeg not running' };

  const expect = session.width * session.height * 4;
  const buf = Buffer.isBuffer(rgba)
    ? rgba
    : Buffer.from(rgba instanceof ArrayBuffer ? new Uint8Array(rgba) : rgba);
  if (buf.length !== expect) {
    return {
      success: false,
      error: `frame size mismatch: got ${buf.length}, expect ${expect}`,
    };
  }

  try {
    if (Date.now() - session.createdAt > KARAOKE_BURN_TIMEOUT_MS) {
      abortSession(session);
      return { success: false, error: 'burn timeout' };
    }
    await writeStdin(session.ffmpeg, buf);
    session.framesWritten += 1;
    return { success: true };
  } catch (e: any) {
    const msg = String(e?.message || e || '');
    if (session.aborted || /cancel|abort/i.test(msg)) {
      return { success: false, error: 'cancelled' };
    }
    return { success: false, error: msg || 'write frame failed' };
  }
}

export async function finalizeKaraokePreviewRecord(
  sessionId: string,
): Promise<KaraokeBurnResult & { encoder?: string }> {
  const session = sessions.get(String(sessionId || ''));
  if (!session) return { success: false, error: 'session not found' };
  if (session.aborted) {
    sessions.delete(session.id);
    rmDirSafe(session.workDir);
    return { success: false, canceled: true, error: 'cancelled' };
  }

  try {
    const stdin = session.ffmpeg?.stdin;
    if (stdin && !stdin.destroyed) {
      await new Promise<void>((resolve) => {
        stdin.end(() => resolve());
        setTimeout(() => resolve(), 2000);
      });
    }

    if (!session.ffDone) throw new Error('ffmpeg promise missing');
    await session.ffDone;

    if (session.aborted) {
      return { success: false, canceled: true, error: 'cancelled' };
    }
    if (!fs.existsSync(session.outTmp)) {
      throw new Error('output missing after encode');
    }

    const created = await localResourceManager.createVideoResourceFromFile(
      session.projectId,
      session.outTmp,
    );

    return {
      success: true,
      originalUrl: created.originalUrl,
      originalPath: created.originalPath,
      posterUrl: created.posterUrl,
      width: created.width || session.width,
      height: created.height || session.height,
      engine: 'record',
      encoder: session.encoderName,
    };
  } catch (e: any) {
    const msg = String(e?.message || e || '');
    if (session.aborted || /cancel|abort/i.test(msg)) {
      return { success: false, canceled: true, error: 'cancelled' };
    }
    if (/timeout/i.test(msg)) {
      return { success: false, timedOut: true, error: 'burn timeout' };
    }
    return {
      success: false,
      error: msg || session.ffStderr.slice(-1500) || 'finalize failed',
    };
  } finally {
    killChild(session.ffmpeg);
    session.ffmpeg = null;
    sessions.delete(session.id);
    rmDirSafe(session.workDir);
  }
}

export async function abortKaraokePreviewRecord(
  sessionId: string,
): Promise<{ success: boolean; error?: string }> {
  const session = sessions.get(String(sessionId || ''));
  if (!session) return { success: true };
  abortSession(session);
  sessions.delete(session.id);
  rmDirSafe(session.workDir);
  return { success: true };
}

/** 供渲染进程抓取当前窗某一矩形 → 平台 raw（Win=BGRA，其它=RGBA），与 session pixelFormat 一致 */
export async function captureWebContentsRectRaw(
  webContents: Electron.WebContents,
  rect: { x: number; y: number; width: number; height: number },
): Promise<{ width: number; height: number; raw: Buffer; pixelFormat: 'bgra' | 'rgba' }> {
  const x = Math.max(0, Math.floor(Number(rect.x) || 0));
  const y = Math.max(0, Math.floor(Number(rect.y) || 0));
  const width = evenDim(Math.max(2, Math.floor(Number(rect.width) || 2)));
  const height = evenDim(Math.max(2, Math.floor(Number(rect.height) || 2)));
  const image = await webContents.capturePage({ x, y, width, height });
  let img = image;
  const sz = img.getSize();
  if (sz.width !== width || sz.height !== height) {
    img = img.resize({ width, height, quality: 'better' });
  }
  const raw = img.toBitmap();
  const expect = width * height * 4;
  if (raw.length !== expect) {
    throw new Error(`capture raw size mismatch: got ${raw.length}, expect ${expect}`);
  }
  return {
    width,
    height,
    raw,
    pixelFormat: process.platform === 'win32' ? 'bgra' : 'rgba',
  };
}

// ─── MediaRecorder 分块会话（长视频实时录制）──────────────────────────

type MediaSession = {
  id: string;
  projectId: string | undefined;
  workDir: string;
  webmPath: string;
  outTmp: string;
  inputPath: string;
  songAudioPath: string | null;
  /** 叠层 raw 宽高（capture 尺寸） */
  width: number;
  height: number;
  /** 成片分辨率（= 片源，禁止缩小） */
  outWidth: number;
  outHeight: number;
  fps: number;
  durationSec: number;
  encoderName: string;
  aborted: boolean;
  createdAt: number;
  writeChain: Promise<void>;
  /**
   * webm=MediaRecorder；
   * overlay-raw=片源+透明叠层 raw pipe（推荐）；
   * jpeg-pipe=旧整帧 JPEG（兼容，勿新用）
   */
  mode: 'webm' | 'overlay-raw' | 'jpeg-pipe';
  pixelFormat: 'bgra' | 'rgba';
  /** 上一帧叠层；1 字节 chunk 表示复用 */
  lastOverlayRaw: Buffer | null;
  emptyOverlayRaw: Buffer | null;
  framesWritten: number;
  /** 加速录制时 webm 墙钟偏短，封装时 setpts 拉回片长 */
  timeStretch: number;
  ffmpeg: ChildProcess | null;
  ffDone: Promise<void> | null;
  ffStderr: string;
};

const mediaSessions = new Map<string, MediaSession>();

function runFfmpegOnce(args: string[], timeoutMs: number): Promise<void> {
  const bin = resolveKaraokeFfmpegPath();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, shell: false });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      killChild(child);
      if (!settled) {
        settled = true;
        reject(makeAbortError('timeout'));
      }
    }, timeoutMs);
    child.stderr?.on('data', (c) => {
      stderr += String(c || '');
      if (stderr.length > 80_000) stderr = stderr.slice(-40_000);
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-2000) || `ffmpeg exited ${code}`));
    });
  });
}

export function cancelKaraokePreviewRecordSessions(): { killed: number } {
  let killed = 0;
  for (const session of sessions.values()) {
    if (!session.aborted) {
      abortSession(session);
      killed += 1;
    }
    rmDirSafe(session.workDir);
  }
  sessions.clear();
  for (const ms of mediaSessions.values()) {
    if (!ms.aborted) {
      ms.aborted = true;
      killed += 1;
    }
    try {
      ms.ffmpeg?.stdin?.destroy();
    } catch {
      /* ignore */
    }
    killChild(ms.ffmpeg);
    ms.ffmpeg = null;
    rmDirSafe(ms.workDir);
  }
  mediaSessions.clear();
  return { killed };
}

export type KaraokePreviewRecordSessionStartOpts = {
  fps?: number;
  durationSec?: number;
  /** 叠层 capture 宽（overlay-raw）；缺省=片源宽 */
  width?: number;
  height?: number;
  /** webm | overlay-raw | jpeg-pipe；默认 overlay-raw */
  mode?: 'webm' | 'overlay-raw' | 'jpeg-pipe';
  pixelFormat?: 'bgra' | 'rgba';
  /** webm 加速播放时的倍率，封装 setpts */
  timeStretch?: number;
};

export async function startKaraokePreviewRecordSession(
  projectId: string | undefined,
  videoUrl: string,
  karaokeProject: KaraokeProject,
  opts?: KaraokePreviewRecordSessionStartOpts,
): Promise<{
  success: boolean;
  sessionId?: string;
  width?: number;
  height?: number;
  outWidth?: number;
  outHeight?: number;
  fps?: number;
  durationSec?: number;
  encoder?: string;
  pixelFormat?: 'bgra' | 'rgba';
  error?: string;
}> {
  cancelKaraokePreviewRecordSessions();
  try {
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
    const outWidth = evenDim(meta.width || 1920);
    const outHeight = evenDim(meta.height || 1080);
    const width = evenDim(
      Number(opts?.width) > 0 ? Number(opts?.width) : outWidth,
    );
    const height = evenDim(
      Number(opts?.height) > 0 ? Number(opts?.height) : outHeight,
    );
    const rawDur =
      Number(opts?.durationSec) > 0 ? Number(opts?.durationSec) : meta.durationSec || 0.1;
    const durationSec = Math.max(
      0.1,
      Math.min(KARAOKE_PREVIEW_RECORD_MAX_DURATION_SEC, rawDur),
    );
    const fpsRaw = Number(opts?.fps);
    const fps =
      Number.isFinite(fpsRaw) && fpsRaw >= 1
        ? Math.min(KARAOKE_PREVIEW_RECORD_MAX_FPS, Math.max(1, Math.round(fpsRaw)))
        : KARAOKE_PREVIEW_RECORD_DEFAULT_FPS;
    const mode: 'webm' | 'overlay-raw' | 'jpeg-pipe' =
      opts?.mode === 'webm'
        ? 'webm'
        : opts?.mode === 'jpeg-pipe'
          ? 'jpeg-pipe'
          : 'overlay-raw';
    const timeStretch =
      Number.isFinite(Number(opts?.timeStretch)) && Number(opts?.timeStretch) > 0
        ? Number(opts?.timeStretch)
        : 1;
    const pixelFormat: 'bgra' | 'rgba' =
      opts?.pixelFormat === 'rgba' || opts?.pixelFormat === 'bgra'
        ? opts.pixelFormat
        : process.platform === 'win32'
          ? 'bgra'
          : 'rgba';

    const workDir = path.join(
      os.tmpdir(),
      `nfkmrec${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    );
    fs.mkdirSync(workDir, { recursive: true });
    const webmPath = path.join(workDir, 'rec.webm');
    const outTmp = path.join(workDir, 'out.mp4');
    if (mode === 'webm') {
      fs.writeFileSync(webmPath, Buffer.alloc(0));
    }

    const encoder = await pickKaraokeH264Encoder(resolveKaraokeFfmpegPath());
    const id = `kmrec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    let ffmpeg: ChildProcess | null = null;
    let ffDone: Promise<void> | null = null;
    let ffStderr = '';
    let emptyOverlayRaw: Buffer | null = null;

    if (mode === 'overlay-raw') {
      const bin = resolveKaraokeFfmpegPath();
      emptyOverlayRaw = Buffer.alloc(width * height * 4, 0);
      const baseSame = outWidth === meta.width && outHeight === meta.height;
      const ovSame = width === outWidth && height === outHeight;
      const ovScale = ovSame
        ? `[1:v]format=rgba,setpts=PTS-STARTPTS[ov]`
        : `[1:v]scale=${outWidth}:${outHeight}:flags=lanczos,format=rgba,setpts=PTS-STARTPTS[ov]`;
      const baseScale = baseSame
        ? `[0:v]setpts=PTS-STARTPTS[base]`
        : `[0:v]scale=${outWidth}:${outHeight}:flags=lanczos,setpts=PTS-STARTPTS[base]`;
      const filter = [
        ovScale,
        baseScale,
        `[base][ov]overlay=0:0:format=auto:alpha=premultiplied[vout]`,
      ].join(';');

      const rawIn = [
        '-f',
        'rawvideo',
        '-pixel_format',
        pixelFormat,
        '-video_size',
        `${width}x${height}`,
        '-framerate',
        String(fps),
        '-i',
        '-',
      ];
      const args = songAudioPath
        ? [
            '-y',
            '-hide_banner',
            '-i',
            inputPath,
            ...rawIn,
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
            ...rawIn,
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
      const child = spawn(bin, args, {
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      ffmpeg = child;
      guardKaraokeFfmpegStdin(child.stdin);
      child.stderr?.on('data', (c) => {
        ffStderr += String(c || '');
        if (ffStderr.length > 80_000) ffStderr = ffStderr.slice(-40_000);
      });
      ffDone = new Promise<void>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(ffStderr.slice(-2000) || `ffmpeg exited ${code}`));
        });
      });
    } else if (mode === 'jpeg-pipe') {
      const bin = resolveKaraokeFfmpegPath();
      const jpegIn = [
        '-f',
        'image2pipe',
        '-framerate',
        String(fps),
        '-i',
        '-',
      ];
      const args = songAudioPath
        ? [
            '-y',
            '-hide_banner',
            ...jpegIn,
            '-i',
            songAudioPath,
            '-map',
            '0:v:0',
            '-map',
            '1:a:0',
            ...encoder.args,
            '-r',
            String(fps),
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
            ...jpegIn,
            '-i',
            inputPath,
            '-map',
            '0:v:0',
            '-map',
            '1:a?',
            ...encoder.args,
            '-r',
            String(fps),
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-shortest',
            '-movflags',
            '+faststart',
            outTmp,
          ];
      const child = spawn(bin, args, {
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      ffmpeg = child;
      guardKaraokeFfmpegStdin(child.stdin);
      child.stderr?.on('data', (c) => {
        ffStderr += String(c || '');
        if (ffStderr.length > 80_000) ffStderr = ffStderr.slice(-40_000);
      });
      ffDone = new Promise<void>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(ffStderr.slice(-2000) || `ffmpeg exited ${code}`));
        });
      });
    }

    mediaSessions.set(id, {
      id,
      projectId,
      workDir,
      webmPath,
      outTmp,
      inputPath,
      songAudioPath,
      width,
      height,
      outWidth,
      outHeight,
      fps,
      durationSec,
      encoderName: encoder.name,
      aborted: false,
      createdAt: Date.now(),
      writeChain: Promise.resolve(),
      mode,
      pixelFormat,
      lastOverlayRaw: null,
      emptyOverlayRaw,
      framesWritten: 0,
      timeStretch,
      ffmpeg,
      ffDone,
      ffStderr: '',
    });

    console.log(
      '[karaoke] preview-record session start',
      mode,
      `overlay ${width}x${height}`,
      `out ${outWidth}x${outHeight} @ ${fps}fps`,
      `dur ${durationSec.toFixed(1)}s`,
      `encoder ${encoder.name}`,
    );

    return {
      success: true,
      sessionId: id,
      width,
      height,
      outWidth,
      outHeight,
      fps,
      durationSec,
      encoder: encoder.name,
      pixelFormat,
    };
  } catch (e: any) {
    return { success: false, error: String(e?.message || e || 'session start failed') };
  }
}

export async function appendKaraokePreviewRecordSessionChunk(
  sessionId: string,
  chunk: ArrayBuffer | Uint8Array | Buffer,
): Promise<{ success: boolean; error?: string }> {
  const ms = mediaSessions.get(String(sessionId || ''));
  if (!ms) return { success: false, error: 'session not found' };
  if (ms.aborted) return { success: false, error: 'cancelled' };

  const buf = Buffer.isBuffer(chunk)
    ? chunk
    : Buffer.from(chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : chunk);

  try {
    if (ms.mode === 'overlay-raw') {
      const stdin = ms.ffmpeg?.stdin;
      if (!stdin || stdin.destroyed) {
        return { success: false, error: 'ffmpeg stdin unavailable' };
      }
      const expect = ms.width * ms.height * 4;
      let toWrite: Buffer;
      if (buf.length === 0) {
        // 无词：全透明（片源直通观感）
        toWrite = ms.emptyOverlayRaw || Buffer.alloc(expect, 0);
        ms.lastOverlayRaw = null;
      } else if (buf.length === 1) {
        // 复用上一叠层（有词静止段）；无上一帧则透明
        toWrite =
          ms.lastOverlayRaw || ms.emptyOverlayRaw || Buffer.alloc(expect, 0);
      } else if (buf.length === expect) {
        toWrite = buf;
        ms.lastOverlayRaw = buf;
      } else {
        return {
          success: false,
          error: `overlay frame size mismatch: got ${buf.length}, expect ${expect} or 0/1`,
        };
      }
      ms.writeChain = ms.writeChain.then(async () => {
        if (ms.aborted) return;
        if (stdin.destroyed || !stdin.writable) {
          throw new Error('ffmpeg stdin closed');
        }
        guardKaraokeFfmpegStdin(stdin);
        const ok = stdin.write(toWrite);
        if (!ok) {
          await new Promise<void>((r) => stdin.once('drain', () => r()));
        }
        ms.framesWritten += 1;
      });
      await ms.writeChain;
      return { success: true };
    }

    if (ms.mode === 'jpeg-pipe') {
      if (buf.length < 1) return { success: true };
      const stdin = ms.ffmpeg?.stdin;
      if (!stdin || stdin.destroyed) {
        return { success: false, error: 'ffmpeg stdin unavailable' };
      }
      ms.writeChain = ms.writeChain.then(async () => {
        if (ms.aborted) return;
        if (stdin.destroyed || !stdin.writable) {
          throw new Error('ffmpeg stdin closed');
        }
        guardKaraokeFfmpegStdin(stdin);
        const ok = stdin.write(buf);
        if (!ok) {
          await new Promise<void>((r) => stdin.once('drain', () => r()));
        }
      });
      await ms.writeChain;
      return { success: true };
    }

    if (buf.length < 1) return { success: true };
    ms.writeChain = ms.writeChain.then(async () => {
      if (ms.aborted) return;
      await fs.promises.appendFile(ms.webmPath, buf);
    });
    await ms.writeChain;
    return { success: true };
  } catch (e: any) {
    return { success: false, error: String(e?.message || e || 'chunk append failed') };
  }
}

export async function finishKaraokePreviewRecordSession(
  sessionId: string,
): Promise<KaraokeBurnResult & { encoder?: string }> {
  const ms = mediaSessions.get(String(sessionId || ''));
  if (!ms) return { success: false, error: 'session not found' };
  if (ms.aborted) {
    killChild(ms.ffmpeg);
    mediaSessions.delete(ms.id);
    rmDirSafe(ms.workDir);
    return { success: false, canceled: true, error: 'cancelled' };
  }

  try {
    await ms.writeChain;

    if (ms.mode === 'jpeg-pipe' || ms.mode === 'overlay-raw') {
      const stdin = ms.ffmpeg?.stdin;
      if (stdin && !stdin.destroyed) {
        await new Promise<void>((resolve) => {
          stdin.end(() => resolve());
          setTimeout(() => resolve(), 3000);
        });
      }
      if (!ms.ffDone) throw new Error('ffmpeg promise missing');
      const timeoutMs = Math.max(
        KARAOKE_BURN_TIMEOUT_MS,
        Math.ceil(ms.durationSec * 1000 + 10 * 60 * 1000),
      );
      await Promise.race([
        ms.ffDone,
        new Promise<void>((_, reject) => {
          setTimeout(() => reject(makeAbortError('timeout')), timeoutMs);
        }),
      ]);
    } else {
      if (!fs.existsSync(ms.webmPath) || fs.statSync(ms.webmPath).size < 32) {
        throw new Error('recorded webm empty');
      }

      const encoder = await pickKaraokeH264Encoder(resolveKaraokeFfmpegPath());
      const timeoutMs = Math.max(
        KARAOKE_BURN_TIMEOUT_MS,
        Math.ceil(ms.durationSec * 1000 + 10 * 60 * 1000),
      );
      const stretch =
        Number.isFinite(ms.timeStretch) && ms.timeStretch > 1.01 ? ms.timeStretch : 1;
      const vfilter =
        stretch > 1.01 ? `setpts=${stretch.toFixed(6)}*PTS` : null;

      const args = ms.songAudioPath
        ? [
            '-y',
            '-hide_banner',
            '-i',
            ms.webmPath,
            '-i',
            ms.songAudioPath,
            ...(vfilter ? ['-filter:v', vfilter] : []),
            '-map',
            '0:v:0',
            '-map',
            '1:a:0',
            ...encoder.args,
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-shortest',
            '-movflags',
            '+faststart',
            ms.outTmp,
          ]
        : [
            '-y',
            '-hide_banner',
            '-i',
            ms.webmPath,
            '-i',
            ms.inputPath,
            ...(vfilter ? ['-filter:v', vfilter] : []),
            '-map',
            '0:v:0',
            '-map',
            '1:a?',
            ...encoder.args,
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-shortest',
            '-movflags',
            '+faststart',
            ms.outTmp,
          ];

      console.log(
        '[karaoke] preview-record session encode',
        encoder.name,
        stretch > 1.01 ? `setpts*${stretch}` : '1x',
        ms.webmPath,
      );
      await runFfmpegOnce(args, timeoutMs);
      ms.encoderName = encoder.name;
    }

    if (ms.aborted) {
      return { success: false, canceled: true, error: 'cancelled' };
    }
    if (!fs.existsSync(ms.outTmp)) {
      throw new Error('output missing after encode');
    }

    const created = await localResourceManager.createVideoResourceFromFile(
      ms.projectId,
      ms.outTmp,
    );
    return {
      success: true,
      originalUrl: created.originalUrl,
      originalPath: created.originalPath,
      posterUrl: created.posterUrl,
      width: created.width || ms.outWidth || ms.width,
      height: created.height || ms.outHeight || ms.height,
      engine: 'record',
      encoder: ms.encoderName,
    };
  } catch (e: any) {
    const msg = String(e?.message || e || '');
    if (ms.aborted || /cancel|abort/i.test(msg)) {
      return { success: false, canceled: true, error: 'cancelled' };
    }
    if (/timeout/i.test(msg)) {
      return { success: false, timedOut: true, error: 'burn timeout' };
    }
    return {
      success: false,
      error: msg || ms.ffStderr.slice(-1500) || 'session finish failed',
    };
  } finally {
    killChild(ms.ffmpeg);
    ms.ffmpeg = null;
    mediaSessions.delete(ms.id);
    rmDirSafe(ms.workDir);
  }
}

export async function abortKaraokePreviewRecordSession(
  sessionId: string,
): Promise<{ success: boolean; error?: string }> {
  const ms = mediaSessions.get(String(sessionId || ''));
  if (!ms) {
    return abortKaraokePreviewRecord(sessionId);
  }
  ms.aborted = true;
  try {
    ms.ffmpeg?.stdin?.destroy();
  } catch {
    /* ignore */
  }
  killChild(ms.ffmpeg);
  ms.ffmpeg = null;
  mediaSessions.delete(ms.id);
  rmDirSafe(ms.workDir);
  return { success: true };
}
