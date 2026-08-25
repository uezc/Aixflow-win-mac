/**
 * 卡拉OK「预览级合成」：渲染进程抓取透明字幕 PNG 序列后，由本模块 ffmpeg overlay 到片源。
 * 与 ASS 烧录并行存在；办公本策略：≤6fps、ffmpeg 单线程 + veryfast（勿用 slow）。
 */

import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { KaraokeProject } from '../../shared/karaoke/types.js';
import { ASS_PLAY_RES_X, ASS_PLAY_RES_Y, resolveKaraokeAudioSource } from '../../shared/karaoke/types.js';
import { localResourceManager, resolveLocalMediaFilePath } from './localResourceManager.js';
import {
  cancelActiveKaraokeBurns,
  KARAOKE_BURN_TIMEOUT_MS,
  type KaraokeBurnResult,
} from './karaokeBurn.js';

/** 默认抓帧 FPS（实验路径；办公本上限 6） */
export const KARAOKE_PREVIEW_COMPOSE_FPS = 6;
/** FPS 硬上限 */
const KARAOKE_PREVIEW_COMPOSE_MAX_FPS = 6;
/** 预览级合成最长时长（秒），避免超长片帧数爆炸 */
const KARAOKE_PREVIEW_COMPOSE_MAX_DURATION_SEC = 6 * 60;

type ComposeSession = {
  id: string;
  projectId: string | undefined;
  workDir: string;
  framesDir: string;
  inputPath: string;
  songAudioPath: string | null;
  videoWidth: number;
  videoHeight: number;
  durationSec: number;
  fps: number;
  frameCount: number;
  aborted: boolean;
  createdAt: number;
};

const sessions = new Map<string, ComposeSession>();

/** 与 karaokeBurn 共用取消入口时一并清理 session */
const activeComposeFinalizeChildren = new Set<ChildProcess>();

function resolveFfmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  try {
    const resourcesPath = process.resourcesPath;
    if (resourcesPath) {
      const extra = path.join(resourcesPath, 'ffmpeg', exeName);
      if (fs.existsSync(extra)) return extra;
    }
  } catch {
    /* ignore */
  }
  try {
    const mod = require('ffmpeg-static');
    let p = typeof mod === 'string' ? mod : mod?.default ?? mod?.path;
    if (p && typeof p === 'string') {
      if (p.includes('app.asar') && !p.includes('app.asar.unpacked')) {
        p = p.replace(/app\.asar(?!\.unpacked)/g, 'app.asar.unpacked');
      }
      if (fs.existsSync(p)) return p;
    }
  } catch {
    /* ignore */
  }
  return 'ffmpeg';
}

function makeAbortError(reason: 'cancelled' | 'timeout' = 'cancelled'): Error {
  const e = new Error(reason === 'timeout' ? 'burn timeout' : 'cancelled');
  e.name = reason === 'timeout' ? 'TimeoutError' : 'AbortError';
  return e;
}

function rmDirSafe(dir: string): void {
  try {
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    /* ignore */
  }
}

function frameFileName(index: number): string {
  return `f${String(index).padStart(6, '0')}.png`;
}

async function probeVideoMeta(inputPath: string): Promise<{
  durationSec: number;
  width: number;
  height: number;
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

  return {
    durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0,
    width: width > 0 ? width : ASS_PLAY_RES_X,
    height: height > 0 ? height : ASS_PLAY_RES_Y,
  };
}

function runFfmpeg(
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number; signal?: AbortSignal },
): Promise<void> {
  const bin = resolveFfmpegPath();
  return new Promise((resolve, reject) => {
    if (opts?.signal?.aborted) {
      reject(makeAbortError('cancelled'));
      return;
    }
    const child = spawn(bin, args, {
      windowsHide: true,
      shell: false,
      cwd: opts?.cwd || undefined,
    });
    activeComposeFinalizeChildren.add(child);
    let settled = false;
    let stderr = '';
    let abortReason: 'cancelled' | 'timeout' | null = null;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      activeComposeFinalizeChildren.delete(child);
      if (timer) clearTimeout(timer);
      opts?.signal?.removeEventListener('abort', onAbort);
      fn();
    };

    const kill = (reason: 'cancelled' | 'timeout') => {
      abortReason = reason;
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
    };

    const onAbort = () => kill('cancelled');
    opts?.signal?.addEventListener('abort', onAbort, { once: true });

    const timeoutMs = Number(opts?.timeoutMs);
    const timer =
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => kill('timeout'), timeoutMs)
        : null;

    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('error', (err) => settle(() => reject(err)));
    child.on('close', (code) => {
      settle(() => {
        if (code === 0) {
          resolve();
          return;
        }
        if (abortReason === 'timeout') {
          reject(makeAbortError('timeout'));
          return;
        }
        if (abortReason === 'cancelled' || /cancel|abort/i.test(stderr)) {
          reject(makeAbortError('cancelled'));
          return;
        }
        reject(new Error(stderr.slice(-2000) || `ffmpeg exited with code ${code}`));
      });
    });
  });
}

export function cancelKaraokePreviewComposeSessions(): { killedSessions: number; killedFfmpeg: number } {
  let killedSessions = 0;
  for (const s of sessions.values()) {
    s.aborted = true;
    rmDirSafe(s.workDir);
    killedSessions += 1;
  }
  sessions.clear();

  let killedFfmpeg = 0;
  for (const child of [...activeComposeFinalizeChildren]) {
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
      killedFfmpeg += 1;
    } catch {
      /* ignore */
    }
  }
  activeComposeFinalizeChildren.clear();
  return { killedSessions, killedFfmpeg };
}

/**
 * @deprecated 请用 karaokeCssBurn.cancelAllKaraokeComposeJobs（含方案 A CSS 烧录）
 * 此处仅清旧 PNG session + ASS。
 */
export function cancelLegacyKaraokeComposeJobs(): { success: true; killed: number } {
  const preview = cancelKaraokePreviewComposeSessions();
  const ass = cancelActiveKaraokeBurns();
  return { success: true, killed: preview.killedSessions + preview.killedFfmpeg + ass.killed };
}

export type KaraokePreviewComposeBeginResult = {
  success: boolean;
  sessionId?: string;
  fps?: number;
  durationSec?: number;
  frameCount?: number;
  captureWidth?: number;
  captureHeight?: number;
  videoWidth?: number;
  videoHeight?: number;
  error?: string;
};

/**
 * 准备临时目录并探测片源；抓帧固定 PlayRes 1920×1080（透明 PNG）。
 */
export async function beginKaraokePreviewCompose(
  projectId: string | undefined,
  videoUrl: string,
  karaokeProject: KaraokeProject,
  opts?: { fps?: number; durationSec?: number },
): Promise<KaraokePreviewComposeBeginResult> {
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
    const rawDur =
      Number(opts?.durationSec) > 0 ? Number(opts?.durationSec) : meta.durationSec || 0.1;
    const durationSec = Math.max(
      0.1,
      Math.min(KARAOKE_PREVIEW_COMPOSE_MAX_DURATION_SEC, rawDur),
    );
    const fpsRaw = Number(opts?.fps);
    const fps =
      Number.isFinite(fpsRaw) && fpsRaw >= 1 && fpsRaw <= KARAOKE_PREVIEW_COMPOSE_MAX_FPS
        ? Math.round(fpsRaw)
        : KARAOKE_PREVIEW_COMPOSE_FPS;
    const frameCount = Math.max(1, Math.ceil(durationSec * fps));

    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const workDir = path.join(os.tmpdir(), `nfkpc${id}`);
    const framesDir = path.join(workDir, 'frames');
    fs.mkdirSync(framesDir, { recursive: true });

    const session: ComposeSession = {
      id,
      projectId,
      workDir,
      framesDir,
      inputPath,
      songAudioPath,
      videoWidth: meta.width || ASS_PLAY_RES_X,
      videoHeight: meta.height || ASS_PLAY_RES_Y,
      durationSec,
      fps,
      frameCount,
      aborted: false,
      createdAt: Date.now(),
    };
    sessions.set(id, session);

    return {
      success: true,
      sessionId: id,
      fps,
      durationSec,
      frameCount,
      captureWidth: ASS_PLAY_RES_X,
      captureHeight: ASS_PLAY_RES_Y,
      videoWidth: session.videoWidth,
      videoHeight: session.videoHeight,
    };
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  }
}

export function writeKaraokePreviewComposeFrame(
  sessionId: string,
  frameIndex: number,
  png: ArrayBuffer | Uint8Array | Buffer,
): { success: boolean; error?: string } {
  const session = sessions.get(String(sessionId || ''));
  if (!session) return { success: false, error: 'session not found' };
  if (session.aborted) return { success: false, error: 'cancelled' };
  const idx = Math.floor(Number(frameIndex));
  if (!Number.isFinite(idx) || idx < 0 || idx >= session.frameCount) {
    return { success: false, error: 'bad frame index' };
  }
  try {
    const buf = Buffer.isBuffer(png)
      ? png
      : Buffer.from(png instanceof ArrayBuffer ? new Uint8Array(png) : png);
    if (buf.length < 8) return { success: false, error: 'empty png' };
    fs.writeFileSync(path.join(session.framesDir, frameFileName(idx)), buf);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  }
}

/** 缺帧时用 1×1 透明 PNG 占位，避免 ffmpeg image2 断序 */
const EMPTY_PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

function ensureAllFrames(session: ComposeSession): void {
  for (let i = 0; i < session.frameCount; i++) {
    const p = path.join(session.framesDir, frameFileName(i));
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, EMPTY_PNG_1X1);
    }
  }
}

/**
 * 将 PNG 序列 overlay 到片源并入库。
 * 字幕层：PlayRes → scale 到片源宽高（保持与预览 object-contain / PlayRes 坐标一致）。
 */
export async function finalizeKaraokePreviewCompose(
  sessionId: string,
  opts?: { timeoutMs?: number },
): Promise<KaraokeBurnResult> {
  const session = sessions.get(String(sessionId || ''));
  if (!session) {
    return { success: false, error: 'session not found' };
  }
  if (session.aborted) {
    sessions.delete(session.id);
    rmDirSafe(session.workDir);
    return { success: false, canceled: true, error: 'cancelled' };
  }

  const timeoutMs =
    Number.isFinite(Number(opts?.timeoutMs)) && Number(opts?.timeoutMs) > 0
      ? Number(opts?.timeoutMs)
      : KARAOKE_BURN_TIMEOUT_MS;
  const outTmp = path.join(session.workDir, 'out.mp4');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    ensureAllFrames(session);

    const vw = Math.max(2, session.videoWidth);
    const vh = Math.max(2, session.videoHeight);
    // 偶数尺寸（yuv420p）
    const outW = vw % 2 === 0 ? vw : vw + 1;
    const outH = vh % 2 === 0 ? vh : vh + 1;

    // [1] PNG 序列 → scale 到片源 → overlay；bilinear + 单线程，降低办公本编码压力
    const filter = [
      `[1:v]fps=${session.fps},scale=${outW}:${outH}:flags=bilinear,format=rgba[ov]`,
      `[0:v]scale=${outW}:${outH}:flags=bilinear[base]`,
      `[base][ov]overlay=0:0:format=auto[vout]`,
    ].join(';');

    const framePattern = path.join(session.framesDir, 'f%06d.png');
    const ffmpegArgs = session.songAudioPath
      ? [
          '-y',
          '-hide_banner',
          '-threads',
          '1',
          '-i',
          session.inputPath,
          '-framerate',
          String(session.fps),
          '-start_number',
          '0',
          '-i',
          framePattern,
          '-i',
          session.songAudioPath,
          '-filter_complex',
          filter,
          '-map',
          '[vout]',
          '-map',
          '2:a:0',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-threads',
          '1',
          '-crf',
          '20',
          '-pix_fmt',
          'yuv420p',
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
          '-threads',
          '1',
          '-i',
          session.inputPath,
          '-framerate',
          String(session.fps),
          '-start_number',
          '0',
          '-i',
          framePattern,
          '-filter_complex',
          filter,
          '-map',
          '[vout]',
          '-map',
          '0:a?',
          '-c:a',
          'copy',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-threads',
          '1',
          '-crf',
          '20',
          '-pix_fmt',
          'yuv420p',
          '-movflags',
          '+faststart',
          '-shortest',
          outTmp,
        ];

    console.log(
      '[karaoke] preview-compose finalize',
      session.id,
      `${session.frameCount} frames @ ${session.fps}fps`,
      `${outW}x${outH}`,
    );

    await runFfmpeg(ffmpegArgs, {
      timeoutMs,
      signal: ac.signal,
    });

    if (session.aborted) {
      return { success: false, canceled: true, error: 'cancelled' };
    }

    const resource = await localResourceManager.createVideoResourceFromFile(
      session.projectId,
      outTmp,
    );
    return {
      success: true,
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
    console.error('[karaoke] preview-compose finalize failed', e);
    return { success: false, error: msg };
  } finally {
    clearTimeout(timer);
    sessions.delete(session.id);
    rmDirSafe(session.workDir);
  }
}

export function abortKaraokePreviewComposeSession(
  sessionId: string,
): { success: boolean; error?: string } {
  const session = sessions.get(String(sessionId || ''));
  if (!session) return { success: false, error: 'session not found' };
  session.aborted = true;
  rmDirSafe(session.workDir);
  sessions.delete(session.id);
  return { success: true };
}
