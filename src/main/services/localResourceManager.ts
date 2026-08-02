import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn, execFileSync, type ChildProcess } from 'child_process';
import os from 'os';
import axios from 'axios';
import * as OpenCC from 'opencc-js';
import { getProjectFolderPath, isLocalResourcePathAllowed } from '../utils/projectFolderHelper.js';
import { buildYoutubeYtDlpClientArgs, buildYoutubeYtDlpSpeedArgs, runYoutubeYtDlpAdaptive } from './videoScraper.js';
import { listWhisperSearchRoots, ensureWhisperReady } from './localWhisperEngine.js';
import { buildClipLayoutScaleFilter, type ClipLayout } from '../../shared/clipLayout.js';
import { buildClipCropFilterPrefix, type ClipCrop } from '../../shared/clipCrop.js';
import { buildFfmpegChromaKeyVf } from '../../shared/chromaKey.js';

/** 人声分离 / Whisper 转写进行中的子进程，供取消 IPC 杀掉 */
const activeAudioJobChildren = new Set<ChildProcess>();

function trackAudioJobChild(child: ChildProcess): ChildProcess {
  activeAudioJobChildren.add(child);
  const cleanup = () => {
    activeAudioJobChildren.delete(child);
  };
  child.once('close', cleanup);
  child.once('error', cleanup);
  return child;
}

function killTrackedAudioJobChildren(): number {
  const list = [...activeAudioJobChildren];
  activeAudioJobChildren.clear();
  for (const child of list) {
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
  return list.length;
}

export function cancelActiveAudioTranscribeJobs(): { success: true; killed: number } {
  return { success: true, killed: killTrackedAudioJobChildren() };
}

function makeAudioJobAbortError(): Error {
  const e = new Error('cancelled');
  e.name = 'AbortError';
  return e;
}

// 打包时使用 ffmpeg-static 内置的二进制（安装包无需用户单独安装 ffmpeg）
let bundledFfmpegPath: string | null = null;

// 打包时使用 extraResources 中的 demucs_cli.exe（安装包无需用户安装 Python）
let bundledDemucsPath: string | null | undefined = undefined;
function getBundledDemucsPath(): string | null {
  if (bundledDemucsPath !== undefined) return bundledDemucsPath;
  try {
    const resourcesPath = process.resourcesPath;
    const exePath = path.join(resourcesPath, 'demucs', 'demucs_cli.exe');
    if (resourcesPath && fs.existsSync(exePath)) {
      bundledDemucsPath = exePath;
      return exePath;
    }
  } catch {
    // ignore
  }
  bundledDemucsPath = null;
  return null;
}

function getBundledFfmpegPath(): string | null {
  if (bundledFfmpegPath !== null) return bundledFfmpegPath;
  const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  try {
    // 1. 优先：extraResources 中的 ffmpeg（与 demucs 同模式，打包后最可靠，新电脑无需配置 PATH）
    const resourcesPath = process.resourcesPath;
    if (resourcesPath) {
      const extraPath = path.join(resourcesPath, 'ffmpeg', exeName);
      if (fs.existsSync(extraPath)) {
        bundledFfmpegPath = extraPath;
        return extraPath;
      }
    }
    // 2. 开发模式：从 ffmpeg-static 模块获取路径，打包后需替换 app.asar -> app.asar.unpacked
    const mod = require('ffmpeg-static');
    let p = typeof mod === 'string' ? mod : mod?.default ?? mod?.path;
    if (p && typeof p === 'string') {
      if (p.includes('app.asar') && !p.includes('app.asar.unpacked')) {
        p = p.replace(/app\.asar(?!\.unpacked)/g, 'app.asar.unpacked');
      }
      if (fs.existsSync(p)) {
        bundledFfmpegPath = p;
        return p;
      }
    }
    // 3. 兜底：app.asar.unpacked 中的 ffmpeg-static
    if (resourcesPath) {
      const unpackedPath = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', exeName);
      if (fs.existsSync(unpackedPath)) {
        bundledFfmpegPath = unpackedPath;
        return unpackedPath;
      }
    }
    // 4. 兜底：app.getAppPath() 替换 app.asar
    const appPath = app.getAppPath();
    if (appPath.includes('app.asar')) {
      const unpackedBase = appPath.replace(/app\.asar$/, 'app.asar.unpacked');
      const fallbackPath = path.join(unpackedBase, 'node_modules', 'ffmpeg-static', exeName);
      if (fs.existsSync(fallbackPath)) {
        bundledFfmpegPath = fallbackPath;
        return fallbackPath;
      }
    }
  } catch {
    // ignore
  }
  bundledFfmpegPath = null;
  return null;
}

export interface LocalImageResourceResult {
  originalPath: string;
  previewPath: string;
  tinyPath: string;
  originalUrl: string;
  previewUrl: string;
  tinyUrl: string;
  bytesOriginal: number;
  bytesPreview: number;
  bytesTiny: number;
  avgColorHex?: string;
  ghostBase64?: string;
  width?: number;
  height?: number;
}

export interface LocalVideoResourceResult {
  originalPath: string;
  originalUrl: string;
  posterPath?: string;
  posterUrl?: string;
  ghostBase64?: string;
  bytesOriginal: number;
  bytesPoster?: number;
  width?: number;
  height?: number;
  /** WebM VP9+alpha 等带透明通道的成片（色度抠像） */
  hasAlpha?: boolean;
}

let cachedSharp: any = null;
let sharpResolved = false;
const MAX_SHARP_CONCURRENCY = 4;
let runningSharpTasks = 0;
const sharpTaskQueue: Array<() => void> = [];
let sharpQueuePaused = false;
const sharpResumeWaiters: Array<() => void> = [];
const sharpCompletedAtQueue: number[] = [];
let sharpPauseStartedAt = 0;
let sharpPausedTotalMs = 0;
const RESIZE_PRESET = {
  fit: 'inside' as const,
  withoutEnlargement: true,
  position: 'centre' as const,
};

async function getSharp(): Promise<any | null> {
  if (sharpResolved) return cachedSharp;
  sharpResolved = true;
  try {
    cachedSharp = await import('sharp');
  } catch (error) {
    console.warn('[LocalResourceManager] sharp 不可用，预览图将回退为原图路径:', error);
    cachedSharp = null;
  }
  return cachedSharp;
}

function toLocalResourceUrl(filePath: string): string {
  return `local-resource://${filePath.replace(/\\/g, '/')}`;
}

async function runSharpTask<T>(
  task: () => Promise<T>,
  opts?: { bypassPause?: boolean },
): Promise<T> {
  const bypassPause = opts?.bypassPause === true;
  if (!bypassPause && sharpQueuePaused) {
    await new Promise<void>((resolve) => {
      sharpResumeWaiters.push(resolve);
    });
  }
  if (runningSharpTasks >= MAX_SHARP_CONCURRENCY) {
    await new Promise<void>((resolve) => sharpTaskQueue.push(resolve));
  }
  runningSharpTasks += 1;
  try {
    return await task();
  } finally {
    const now = Date.now();
    sharpCompletedAtQueue.push(now);
    while (sharpCompletedAtQueue.length > 0 && now - sharpCompletedAtQueue[0] > 1000) {
      sharpCompletedAtQueue.shift();
    }
    runningSharpTasks = Math.max(0, runningSharpTasks - 1);
    const next = sharpTaskQueue.shift();
    if (next) next();
  }
}

export function setSharpQueuePaused(paused: boolean) {
  const next = !!paused;
  if (sharpQueuePaused === next) return;
  sharpQueuePaused = next;
  if (sharpQueuePaused) {
    sharpPauseStartedAt = Date.now();
  }
  if (!sharpQueuePaused) {
    if (sharpPauseStartedAt > 0) {
      sharpPausedTotalMs += Date.now() - sharpPauseStartedAt;
      sharpPauseStartedAt = 0;
    }
    while (sharpResumeWaiters.length > 0) {
      const resume = sharpResumeWaiters.shift();
      resume?.();
    }
  }
}

export function getSharpQueueStats() {
  const now = Date.now();
  while (sharpCompletedAtQueue.length > 0 && now - sharpCompletedAtQueue[0] > 1000) {
    sharpCompletedAtQueue.shift();
  }
  const pauseTotalMs = sharpPausedTotalMs + (sharpQueuePaused && sharpPauseStartedAt > 0 ? now - sharpPauseStartedAt : 0);
  return {
    maxConcurrency: MAX_SHARP_CONCURRENCY,
    running: runningSharpTasks,
    queued: sharpTaskQueue.length,
    paused: sharpQueuePaused,
    throughputPerSec: sharpCompletedAtQueue.length,
    pauseTotalMs,
  };
}

function safeStem(inputName: string): string {
  const stem = (inputName || 'image')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 48);
  return stem || 'image';
}

async function resolveSaveDir(projectId?: string): Promise<string> {
  if (projectId) {
    const projectFolderPath = await getProjectFolderPath(projectId);
    if (!projectFolderPath) throw new Error('项目不存在');
    const dir = path.join(projectFolderPath, 'assets');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  const dir = path.join(app.getPath('userData'), 'assets');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 解析画布/IPC 传来的媒体路径为真实磁盘文件路径（须存在）。
 * 支持 local-resource://、file://、绝对路径、以及相对当前项目根目录的路径（如 assets/xxx.mp4）。
 */
/** 解析 local-resource / file / 项目相对路径为本地绝对路径（供云端转写上传等复用） */
export async function resolveLocalMediaFilePath(projectId: string | undefined, urlOrPath: string): Promise<string> {
  const raw = (urlOrPath || '').trim();
  if (!raw) throw new Error('路径为空');
  if (raw.startsWith('blob:')) {
    throw new Error('不支持 blob: 预览地址；请使用已保存到项目文件夹的素材，或重新从本机导入文件');
  }

  let filePath: string;
  if (raw.startsWith('local-resource://') || raw.startsWith('file://')) {
    filePath = raw.replace(/^local-resource:\/\/+/, '').replace(/^file:\/\/+/, '');
    if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
    filePath = decodeURIComponent(filePath);
  } else {
    const winDrive = process.platform === 'win32' && /^[a-zA-Z]:[/\\]/.test(raw);
    const looksAbsolute = path.isAbsolute(raw) || winDrive;
    if (looksAbsolute) {
      filePath = raw;
    } else {
      if (!projectId) {
        throw new Error('相对路径需要当前项目：请保存画布所属项目后再试，或使用完整磁盘路径 / local-resource://');
      }
      const pf = await getProjectFolderPath(projectId);
      if (!pf) throw new Error('项目不存在，无法解析相对路径');
      filePath = path.join(pf, raw);
    }
  }

  let normalized = path.normalize(filePath);
  if (process.platform === 'win32' && /^[/\\][a-zA-Z]:[/\\]/.test(normalized)) {
    normalized = normalized.replace(/^[/\\]+/, '');
  }
  if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) {
    throw new Error('文件不存在或无法访问');
  }
  if (!isLocalResourcePathAllowed(normalized)) {
    throw new Error('出于安全策略，该路径不在允许访问的目录内');
  }
  return normalized;
}

async function generatePreviewAssets(
  originalPath: string,
  previewPath: string,
  tinyPath: string,
  opts?: { includeGhost?: boolean; bypassPause?: boolean },
): Promise<{
  bytesPreview: number;
  bytesTiny: number;
  width?: number;
  height?: number;
  avgColorHex?: string;
  ghostBase64?: string;
}> {
  const includeGhost = opts?.includeGhost === true;
  const bypassPause = opts?.bypassPause === true;
  const sharpMod = await getSharp();
  if (!sharpMod) {
    fs.copyFileSync(originalPath, previewPath);
    fs.copyFileSync(originalPath, tinyPath);
    const stat = fs.statSync(previewPath);
    const tinyStat = fs.statSync(tinyPath);
    return { bytesPreview: stat.size, bytesTiny: tinyStat.size, avgColorHex: '#5c5c5c', ghostBase64: '' };
  }
  return runSharpTask(async () => {
    const sharp = sharpMod.default || sharpMod;
    // 单次打开解码，多路输出，避免 preview/tiny/ghost/stats 反复读盘
    const image = sharp(originalPath, { failOn: 'none', sequentialRead: true });
    const metadata = await image.metadata();

    await image
      .clone()
      .resize({
        width: 1024,
        height: 1024,
        ...RESIZE_PRESET,
      })
      .jpeg({
        quality: 70,
        chromaSubsampling: '4:2:0',
      })
      .toFile(previewPath);

    await image
      .clone()
      .resize({
        width: 64,
        height: 64,
        ...RESIZE_PRESET,
      })
      .jpeg({
        quality: 48,
        chromaSubsampling: '4:2:0',
      })
      .toFile(tinyPath);

    let ghostBase64 = '';
    if (includeGhost) {
      const buf = await image
        .clone()
        .resize({
          width: 24,
          height: 24,
          ...RESIZE_PRESET,
        })
        .jpeg({
          quality: 10,
          chromaSubsampling: '4:2:0',
        })
        .toBuffer();
      ghostBase64 = `data:image/jpeg;base64,${buf.toString('base64')}`;
    }

    const stats = await image.clone().stats();
    const dominant = stats?.dominant;
    const avgColorHex = dominant
      ? `#${[dominant.r, dominant.g, dominant.b].map((v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`
      : '#5c5c5c';

    const stat = fs.statSync(previewPath);
    const tinyStat = fs.statSync(tinyPath);
    return {
      bytesPreview: stat.size,
      bytesTiny: tinyStat.size,
      width: metadata.width,
      height: metadata.height,
      avgColorHex,
      ghostBase64,
    };
  }, { bypassPause });
}

async function generateGhostBase64(originalPath: string): Promise<string> {
  const sharpMod = await getSharp();
  if (!sharpMod) return '';
  return runSharpTask(async () => {
    const sharp = sharpMod.default || sharpMod;
    const buf = await sharp(originalPath, { failOn: 'none' })
      .resize({
        width: 24,
        height: 24,
        ...RESIZE_PRESET,
      })
      .jpeg({
        quality: 10,
        mozjpeg: true,
        chromaSubsampling: '4:2:0',
      })
      .toBuffer();
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  });
}

async function runFfmpegCapturePoster(
  inputPath: string,
  posterPath: string,
  timeoutMs = 8000,
  opts?: { preserveAlpha?: boolean },
): Promise<void> {
  const preserveAlpha = !!opts?.preserveAlpha || path.extname(posterPath).toLowerCase() === '.png';
  const ext = path.extname(inputPath).toLowerCase();
  // VP8/VP9 WebM 透明轨：原生解码常忽略 alpha（ffprobe 只见 yuv420p+alpha_mode），须强制 libvpx
  const forceVpxDecoder =
    preserveAlpha && (ext === '.webm' || /chromakey/i.test(path.basename(inputPath)));
  const vf = preserveAlpha
    ? 'scale=640:-2:force_original_aspect_ratio=decrease,format=rgba'
    : 'scale=640:-2:force_original_aspect_ratio=decrease';

  const runOnce = (decoder?: 'libvpx-vp9' | 'libvpx') =>
    new Promise<void>((resolve, reject) => {
      const ffmpegBin = resolveFfmpegPath();
      const args = [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        '0',
        ...(decoder ? (['-c:v', decoder] as string[]) : []),
        '-i',
        inputPath,
        '-frames:v',
        '1',
        '-vf',
        vf,
        posterPath,
      ];
      const child = spawn(ffmpegBin, args, { windowsHide: true });
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
        reject(new Error(`ffmpeg 抽帧超时（>${timeoutMs}ms）`));
      }, timeoutMs);
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk || '');
      });
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(stderr || `ffmpeg exited with code ${code}`));
      });
    });

  if (!forceVpxDecoder) {
    await runOnce();
    return;
  }
  try {
    await runOnce('libvpx-vp9');
  } catch {
    await runOnce('libvpx');
  }
}

async function runFfmpegExtractAudio(inputPath: string, outputPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ffmpegBin = resolveFfmpegPath();
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-vn',
      '-map',
      '0:a:0?',
      '-acodec',
      'libmp3lame',
      '-q:a',
      '2',
      outputPath,
    ];
    const child = spawn(ffmpegBin, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) {
        try {
          if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) {
            reject(new Error('该视频没有音轨，无法提取音频'));
            return;
          }
        } catch {
          reject(new Error('该视频没有音轨，无法提取音频'));
          return;
        }
        resolve();
        return;
      }
      const errText = (stderr || '').trim();
      if (/does not contain any stream|Stream map|'0:a:0'|no audio|Output file does not contain any stream/i.test(errText)) {
        reject(new Error('该视频没有音轨，无法提取音频'));
        return;
      }
      reject(new Error(errText || `ffmpeg exited with code ${code}`));
    });
  });
}

/** 转为 16kHz 单声道 PCM WAV，供 whisper.cpp -f 使用 */
async function runFfmpegTranscodeWhisperWav(inputPath: string, outputPath: string): Promise<void> {
  const ext = path.extname(inputPath).toLowerCase();
  const inputFormatArgs = ext === '.webm' ? ['-f', 'webm'] : [];
  await new Promise<void>((resolve, reject) => {
    const ffmpegBin = resolveFfmpegPath();
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      ...inputFormatArgs,
      '-i',
      inputPath,
      '-ar',
      '16000',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      outputPath,
    ];
    const child = trackAudioJobChild(spawn(ffmpegBin, args, { windowsHide: true }));
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code, signal) => {
      if (code === 0) resolve();
      else if (signal === 'SIGKILL') reject(makeAudioJobAbortError());
      else reject(new Error(stderr || `ffmpeg 转码失败: ${stderr || code}`));
    });
  });
}

/** v1.8+ 发行包优先提供 whisper-cli；main 已弃用但仍可作兜底 */
function whisperCppExecutableBasenames(): string[] {
  if (process.platform === 'win32') {
    return ['whisper-cli.exe', 'main.exe'];
  }
  return ['whisper-cli', 'main'];
}

function collectWhisperBinaryCandidates(): string[] {
  const names = whisperCppExecutableBasenames();
  const dirs = listWhisperSearchRoots();
  const out: string[] = [];
  for (const dir of dirs) {
    for (const name of names) {
      out.push(path.join(dir, name));
    }
  }
  return out;
}

function resolveWhisperCppBinaryPath(): string {
  const env = process.env.WHISPER_CPP_BIN?.trim();
  if (env && fs.existsSync(env)) return env;
  for (const p of collectWhisperBinaryCandidates()) {
    if (p && fs.existsSync(p)) return p;
  }
  const hint =
    process.platform === 'win32'
      ? 'whisper-cli.exe（及同目录 whisper.dll）或 main.exe'
      : 'whisper-cli 或 main';
  throw new Error(
    `未找到 whisper.cpp 可执行文件（${hint}）。首次使用「转文字」时会自动下载引擎，请保持联网。`,
  );
}

/** 按体量从小到大尝试，优先用较小模型；目录内仅有 medium 等时会自动命中 */
const WHISPER_MODEL_CANDIDATE_NAMES = [
  'ggml-tiny.bin',
  'ggml-base.bin',
  'ggml-small.bin',
  'ggml-medium.bin',
  'ggml-large-v3.bin',
  'ggml-large-v2.bin',
  'ggml-large.bin',
];

function collectWhisperModelCandidates(): string[] {
  const dirs = listWhisperSearchRoots();
  const out: string[] = [];
  for (const dir of dirs) {
    for (const name of WHISPER_MODEL_CANDIDATE_NAMES) {
      out.push(path.join(dir, name));
    }
  }
  return out;
}

function resolveWhisperModelPath(): string {
  const env = process.env.WHISPER_MODEL_PATH?.trim();
  if (env && fs.existsSync(env)) return env;
  for (const p of collectWhisperModelCandidates()) {
    if (p && fs.existsSync(p)) return p;
  }
  throw new Error(
    '未找到 Whisper 模型文件。首次使用「转文字」时会自动下载引擎（含模型），请保持联网。',
  );
}

/** 文本节点「中文」转写：固定 whisper 为 zh，并做繁体→简体后处理 */
function resolveWhisperTranscribeLang(languageInput?: string): {
  whisperLang: string | undefined;
  toSimplifiedChinese: boolean;
  simplifiedPrompt?: string;
} {
  const raw = (languageInput || 'auto').trim().toLowerCase().replace(/_/g, '-');
  if (!raw || raw === 'auto') {
    return { whisperLang: undefined, toSimplifiedChinese: false };
  }
  if (raw === 'zh' || raw.startsWith('zh-')) {
    return {
      whisperLang: 'zh',
      toSimplifiedChinese: true,
      simplifiedPrompt: '下面为中文普通话内容，请使用中国大陆规范简化汉字书写。',
    };
  }
  const primary = raw.split('-')[0];
  if (primary.length >= 2 && primary.length <= 3) {
    return { whisperLang: primary, toSimplifiedChinese: false };
  }
  return { whisperLang: undefined, toSimplifiedChinese: false };
}

let tradToSimplCn: ((s: string) => string) | undefined;
function toSimplifiedChineseText(s: string): string {
  tradToSimplCn ??= OpenCC.Converter({ from: 'tw', to: 'cn' });
  return tradToSimplCn(s);
}

async function runWhisperCppToText(
  whisperBin: string,
  modelPath: string,
  wavPath: string,
  language: string | undefined,
  workingDir: string,
  opts?: { initialPrompt?: string }
): Promise<string> {
  const result = await runWhisperCppToSegments(whisperBin, modelPath, wavPath, language, workingDir, opts);
  return result.text;
}

function parseWhisperTimestampToSec(raw: string): number {
  const s = String(raw || '').trim().replace(',', '.');
  // 00:00:01.120 or 00:00:01,120
  const m = s.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:[.:](\d{1,3}))?$/);
  if (!m) return NaN;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  const fracRaw = m[4] || '';
  let frac = 0;
  if (fracRaw) {
    const n = Number(fracRaw);
    if (fracRaw.length <= 2) frac = n / 100;
    else frac = n / 1000;
  }
  return hh * 3600 + mm * 60 + ss + frac;
}

async function runWhisperCppToSegments(
  whisperBin: string,
  modelPath: string,
  wavPath: string,
  language: string | undefined,
  workingDir: string,
  opts?: { initialPrompt?: string }
): Promise<{ text: string; segments: Array<{ text: string; startSec: number; endSec: number }> }> {
  const outBase = path.join(workingDir, 'whisper-out');
  const args = ['-m', modelPath, '-f', wavPath, '-of', outBase, '-otxt', '-oj'];
  if (language && language !== 'auto') {
    args.push('-l', language);
  }
  if (opts?.initialPrompt) {
    args.push('--prompt', opts.initialPrompt);
  }
  await new Promise<void>((resolve, reject) => {
    const child = trackAudioJobChild(
      spawn(whisperBin, args, { cwd: workingDir, windowsHide: true, shell: false }),
    );
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code, signal) => {
      if (code === 0) resolve();
      else if (signal === 'SIGKILL' || /cancel|abort/i.test(stderr)) {
        reject(makeAudioJobAbortError());
      } else {
        reject(new Error(stderr.trim().slice(-4000) || `whisper.cpp 退出码 ${code}`));
      }
    });
  });

  const txtPath = `${outBase}.txt`;
  const jsonPath = `${outBase}.json`;
  let text = '';
  if (fs.existsSync(txtPath)) {
    text = fs.readFileSync(txtPath, 'utf-8').replace(/\r\n/g, '\n').trim();
  }

  const segments: Array<{ text: string; startSec: number; endSec: number }> = [];
  if (fs.existsSync(jsonPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as {
        transcription?: Array<{
          text?: string;
          timestamps?: { from?: string; to?: string };
          offsets?: { from?: number; to?: number };
        }>;
      };
      const rows = Array.isArray(raw?.transcription) ? raw.transcription : [];
      for (const row of rows) {
        const segText = String(row?.text || '').replace(/\s+/g, ' ').trim();
        let startSec = NaN;
        let endSec = NaN;
        if (row?.offsets && Number.isFinite(Number(row.offsets.from)) && Number.isFinite(Number(row.offsets.to))) {
          startSec = Number(row.offsets.from) / 1000;
          endSec = Number(row.offsets.to) / 1000;
        } else {
          startSec = parseWhisperTimestampToSec(String(row?.timestamps?.from || ''));
          endSec = parseWhisperTimestampToSec(String(row?.timestamps?.to || ''));
        }
        if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec + 0.04) continue;
        segments.push({ text: segText, startSec, endSec });
      }
    } catch (e) {
      console.warn('[whisper] 解析 JSON 分段失败:', e);
    }
  }

  if (!text && segments.length > 0) {
    text = segments.map((s) => s.text).filter(Boolean).join('\n').trim();
  }
  if (!text && !segments.length) {
    // 兼容旧输出文件名 input.wav.txt
    const legacyTxt = path.join(workingDir, `${path.basename(wavPath)}.txt`);
    if (fs.existsSync(legacyTxt)) {
      text = fs.readFileSync(legacyTxt, 'utf-8').replace(/\r\n/g, '\n').trim();
    }
  }
  if (!text && !segments.length) {
    throw new Error('未生成转写结果文件');
  }
  return { text, segments };
}

/** 检测输入是否含音轨（无音轨时不要强行 -c:a，避免异常时长） */
async function probeInputHasAudio(inputPath: string): Promise<boolean> {
  const ffmpegBin = resolveFfmpegPath();
  return new Promise((resolve) => {
    const child = spawn(ffmpegBin, ['-hide_banner', '-i', inputPath], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('error', () => resolve(false));
    child.on('close', () => {
      resolve(/Audio:\s/i.test(stderr));
    });
  });
}

function runFfmpegArgs(args: string[], outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpegBin = resolveFfmpegPath();
    const child = spawn(ffmpegBin, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) resolve();
      else reject(new Error(stderr.trim().slice(-2000) || `ffmpeg 退出码 ${code}`));
    });
  });
}

/**
 * 视频时间裁剪：输出侧精确 -ss/-t，默认保留音轨（AAC 重编码）。
 * 音视频都按 -t 限长，避免音轨把容器时长撑开。
 */
async function runFfmpegTrimVideo(inputPath: string, outputPath: string, startSec: number, endSec: number): Promise<void> {
  const start = Math.max(0, Number(startSec) || 0);
  const end = Math.max(start + 0.01, Number(endSec) || 0);
  const duration = Math.max(0.01, Math.round((end - start) * 1000) / 1000);
  const tmpPath = `${outputPath}.tmp.mp4`;

  try {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  } catch {
    /* ignore */
  }

  const buildArgs = (opts: { withAudio: boolean; useFpsMode: boolean }): string[] => {
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-ss',
      String(start),
      '-t',
      String(duration),
      '-map',
      '0:v:0',
    ];
    if (opts.withAudio) {
      // 无音轨时本路失败，外层会回退到仅视频
      args.push('-map', '0:a:0', '-c:v', 'libx264');
    } else {
      args.push('-an', '-c:v', 'libx264');
    }
    args.push(
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      opts.useFpsMode ? '-fps_mode' : '-vsync',
      'cfr',
      '-r',
      '30',
    );
    if (opts.withAudio) {
      args.push('-c:a', 'aac', '-b:a', '192k', '-af', 'aresample=async=1:first_pts=0');
    }
    args.push('-fflags', '+genpts', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', tmpPath);
    return args;
  };

  const tryRun = async (withAudio: boolean, useFpsMode: boolean) => {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    await runFfmpegArgs(buildArgs({ withAudio, useFpsMode }), tmpPath);
  };

  try {
    await tryRun(true, true);
  } catch {
    try {
      await tryRun(true, false);
    } catch {
      try {
        await tryRun(false, true);
      } catch (videoOnlyErr) {
        try {
          await tryRun(false, false);
        } catch {
          throw videoOnlyErr;
        }
      }
    }
  }

  try {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  } catch {
    /* ignore */
  }
  fs.renameSync(tmpPath, outputPath);
}

function dedupeCutTimes(times: number[], minGapSec = 0.28): number[] {
  const sorted = times.filter((t) => Number.isFinite(t) && t > 0.08).sort((a, b) => a - b);
  const dedup: number[] = [];
  for (const t of sorted) {
    if (dedup.length === 0 || t - dedup[dedup.length - 1]! >= minGapSec) dedup.push(t);
  }
  return dedup;
}

type SceneChangeEvent = { time: number; score: number };

async function runFfmpegCollectStderr(args: string[]): Promise<string> {
  const ffmpegBin = resolveFfmpegPath();
  return new Promise<string>((resolve) => {
    const child = spawn(ffmpegBin, args, { windowsHide: true });
    let out = '';
    child.stderr.on('data', (chunk) => {
      out += String(chunk || '');
    });
    child.on('error', () => resolve(out));
    child.on('close', () => resolve(out));
  });
}

function parsePtsTimesFromFfmpegLog(log: string): number[] {
  const times: number[] = [];
  const re = /pts_time:([0-9]+(?:\.[0-9]+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(log))) {
    const t = Number(m[1]);
    if (Number.isFinite(t)) times.push(t);
  }
  return times;
}

function dedupeSceneEvents(events: SceneChangeEvent[], minGapSec = 0.22): SceneChangeEvent[] {
  const sorted = events
    .filter((e) => Number.isFinite(e.time) && e.time > 0.05 && Number.isFinite(e.score) && e.score > 0)
    .sort((a, b) => a.time - b.time || b.score - a.score);
  const out: SceneChangeEvent[] = [];
  for (const e of sorted) {
    const prev = out[out.length - 1];
    if (!prev || e.time - prev.time >= minGapSec) out.push(e);
    else if (e.score > prev.score) out[out.length - 1] = e;
  }
  return out;
}

/**
 * 收集整段视频的画面变化事件（time + scene_score）。
 * 只保留变化明显处，用于：硬切拆镜 + 按变化强度筛选镜头。
 */
async function collectSceneChangeEvents(inputPath: string, minScore = 0.06): Promise<SceneChangeEvent[]> {
  const stderr = await runFfmpegCollectStderr([
    '-hide_banner',
    '-i',
    inputPath,
    '-filter:v',
    `scale=320:-2,select='gt(scene\\,${minScore})',metadata=print`,
    '-an',
    '-f',
    'null',
    '-',
  ]);

  const events: SceneChangeEvent[] = [];
  // metadata=print 常与 frame/pts_time 交错；按行关联最近 pts
  let lastPts: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const pts = line.match(/pts_time:([0-9]+(?:\.[0-9]+)?)/);
    if (pts) {
      lastPts = Number(pts[1]);
      continue;
    }
    const score =
      line.match(/lavfi\.scene_score[=:\s]+([0-9]+(?:\.[0-9]+)?)/i) ||
      line.match(/scene_score[=:\s]+([0-9]+(?:\.[0-9]+)?)/i);
    if (score && lastPts != null) {
      events.push({ time: lastPts, score: Number(score[1]) });
    }
  }

  // 某些构建只有 showinfo、没有 scene_score：退化为「过阈值即记 1 分」
  if (events.length === 0) {
    const times = parsePtsTimesFromFfmpegLog(stderr);
    for (const t of times) events.push({ time: t, score: Math.max(minScore, 0.2) });
  }

  // 叠加 scdet（硬切）
  try {
    const scdetLog = await runFfmpegCollectStderr([
      '-hide_banner',
      '-i',
      inputPath,
      '-filter:v',
      'scale=320:-2,scdet=s=1:t=5',
      '-an',
      '-f',
      'null',
      '-',
    ]);
    const rePair =
      /lavfi\.scd\.score\s*[:=]\s*([0-9]+(?:\.[0-9]+)?).*?lavfi\.scd\.time\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/gis;
    const rePairAlt =
      /lavfi\.scd\.time\s*[:=]\s*([0-9]+(?:\.[0-9]+)?).*?lavfi\.scd\.score\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/gis;
    let m: RegExpExecArray | null;
    while ((m = rePair.exec(scdetLog))) {
      const raw = Number(m[1]);
      const t = Number(m[2]);
      // scdet score 常见 0~100，映射到约 0~1
      events.push({ time: t, score: Math.min(1, raw / 40) });
    }
    while ((m = rePairAlt.exec(scdetLog))) {
      const t = Number(m[1]);
      const raw = Number(m[2]);
      events.push({ time: t, score: Math.min(1, raw / 40) });
    }
  } catch {
    // ignore missing scdet
  }

  return dedupeSceneEvents(events);
}

function peakScoreNear(events: SceneChangeEvent[], timeSec: number, windowSec = 0.45): number {
  let peak = 0;
  for (const e of events) {
    if (Math.abs(e.time - timeSec) <= windowSec) peak = Math.max(peak, e.score);
  }
  return peak;
}

function segmentChangeScore(
  seg: { start: number; end: number },
  events: SceneChangeEvent[],
): number {
  const dur = Math.max(0.2, seg.end - seg.start);
  const entry = peakScoreNear(events, seg.start, 0.5);
  let insideSum = 0;
  let insidePeak = 0;
  let insideCount = 0;
  for (const e of events) {
    if (e.time > seg.start + 0.05 && e.time < seg.end - 0.05) {
      insideSum += e.score;
      insidePeak = Math.max(insidePeak, e.score);
      insideCount += 1;
    }
  }
  const density = insideSum / dur;
  // 入镜硬切权重大：目标是「画面变化明显的镜头」
  return entry * 2.4 + insidePeak * 1.2 + density * 1.6 + Math.min(insideCount, 8) * 0.05;
}

/**
 * 按切点建段：过短镜头并入相邻段。
 */
function buildSegmentsFromCuts(
  start: number,
  end: number,
  cuts: number[],
  minClipSec: number,
): Array<{ start: number; end: number }> {
  const points = [start, ...cuts.filter((t) => t > start + 0.05 && t < end - 0.05), end];
  if (points.length < 2) return [];
  const raw: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < points.length - 1; i++) {
    raw.push({ start: points[i]!, end: points[i + 1]! });
  }
  const merged: Array<{ start: number; end: number }> = [{ ...raw[0]! }];
  for (let i = 1; i < raw.length; i++) {
    const cur = raw[i]!;
    const prev = merged[merged.length - 1]!;
    const curLen = cur.end - cur.start;
    const prevLen = prev.end - prev.start;
    if (curLen < minClipSec || prevLen < minClipSec) {
      prev.end = cur.end;
    } else {
      merged.push({ ...cur });
    }
  }
  if (merged.length > 1) {
    const last = merged[merged.length - 1]!;
    if (last.end - last.start < minClipSec) {
      merged.pop();
      merged[merged.length - 1]!.end = last.end;
    }
  }
  return merged.filter((s) => s.end - s.start >= Math.min(0.35, minClipSec * 0.5));
}

/**
 * 只保留画面变化明显的镜头：硬切拆段后按变化分数筛选。
 */
function selectObviousChangeSegments(
  durationSec: number,
  events: SceneChangeEvent[],
  options: {
    mode: 'stable' | 'balanced' | 'sensitive';
    maxClips: number;
    minClipSec: number;
  },
): { segments: Array<{ start: number; end: number; score: number }>; downgraded: boolean; cutPoints: number[] } {
  const { mode, maxClips, minClipSec } = options;
  // 硬切阈值：只在「变化够明显」处分镜
  const hardCut =
    mode === 'stable' ? 0.32 : mode === 'sensitive' ? 0.16 : 0.22;
  // 镜头保留分数门槛（入镜强度 + 段内变化）
  const keepFloor =
    mode === 'stable' ? 0.55 : mode === 'sensitive' ? 0.28 : 0.4;

  const hardCuts = dedupeCutTimes(
    events.filter((e) => e.score >= hardCut).map((e) => e.time),
    Math.max(0.35, minClipSec * 0.45),
  );

  let segments = buildSegmentsFromCuts(0, durationSec, hardCuts, minClipSec);
  // 若硬切过少，用稍弱但仍明显的变化补切点（仍不是无脑均分）
  let downgraded = false;
  if (segments.length <= 1) {
    const softer = mode === 'stable' ? hardCut * 0.75 : hardCut * 0.65;
    const softCuts = dedupeCutTimes(
      events.filter((e) => e.score >= softer).map((e) => e.time),
      Math.max(0.3, minClipSec * 0.4),
    );
    if (softCuts.length > hardCuts.length) {
      segments = buildSegmentsFromCuts(0, durationSec, softCuts, minClipSec);
      downgraded = true;
    }
  }

  if (segments.length === 0) {
    segments = [{ start: 0, end: durationSec }];
  }

  const scored = segments.map((s) => ({
    ...s,
    score: segmentChangeScore(s, events),
  }));

  // 丢掉几乎静止的段（说话头、长静景）
  let kept = scored.filter((s) => s.score >= keepFloor);
  if (kept.length === 0) {
    // 仍尽量给「相对变化最大」的若干段，而不是整段原片
    kept = [...scored].sort((a, b) => b.score - a.score).slice(0, Math.min(maxClips, Math.max(1, 3)));
    downgraded = true;
  } else if (kept.length > maxClips) {
    kept = [...kept].sort((a, b) => b.score - a.score).slice(0, maxClips);
  }

  kept.sort((a, b) => a.start - b.start);
  return {
    segments: kept,
    downgraded,
    cutPoints: kept.slice(1).map((s) => s.start),
  };
}

/** @deprecated 兼容旧调用名：改为基于 scored events 的硬切时间 */
async function detectSceneCutPoints(inputPath: string, threshold: number): Promise<number[]> {
  const events = await collectSceneChangeEvents(inputPath, Math.min(0.06, threshold));
  return dedupeCutTimes(
    events.filter((e) => e.score >= threshold).map((e) => e.time),
    0.28,
  );
}

async function runFfmpegCaptureFrameAt(inputPath: string, outputPath: string, timeSec: number): Promise<void> {
  const ffmpegBin = resolveFfmpegPath();
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    String(Math.max(0, timeSec)),
    '-i',
    inputPath,
    '-frames:v',
    '1',
    '-q:v',
    '2',
    outputPath,
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegBin, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) resolve();
      else reject(new Error(stderr.trim().slice(-1500) || `ffmpeg frame 退出码 ${code}`));
    });
  });
}

/** 归一化选框 → 偶数像素 crop（yuv420 / libx264 要求） */
function normalizedRectToEvenCropPixels(
  rect: { x: number; y: number; w: number; h: number },
  sourceW: number,
  sourceH: number,
): { cropW: number; cropH: number; cropX: number; cropY: number } {
  const nw = Math.max(2, Math.floor(Number(sourceW) || 0));
  const nh = Math.max(2, Math.floor(Number(sourceH) || 0));
  const toEven = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
  let cropX = Math.round(Number(rect.x) * nw);
  let cropY = Math.round(Number(rect.y) * nh);
  let cropW = Math.round(Number(rect.w) * nw);
  let cropH = Math.round(Number(rect.h) * nh);
  cropX = Math.max(0, Math.min(nw - 2, cropX));
  cropY = Math.max(0, Math.min(nh - 2, cropY));
  cropW = Math.max(2, Math.min(nw - cropX, cropW));
  cropH = Math.max(2, Math.min(nh - cropY, cropH));
  cropX = toEven(cropX);
  cropY = toEven(cropY);
  cropW = toEven(cropW);
  cropH = toEven(cropH);
  if (cropX + cropW > nw) cropW = toEven(Math.max(2, nw - cropX));
  if (cropY + cropH > nh) cropH = toEven(Math.max(2, nh - cropY));
  if (cropW < 2 || cropH < 2) throw new Error('裁剪区域过小');
  return { cropW, cropH, cropX, cropY };
}

function normalizeChromaKeyHex(colorHex: string): string {
  const raw = String(colorHex || '').trim();
  const m = raw.match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) throw new Error('色度键颜色无效，请使用 #RRGGBB');
  return m[1]!.toUpperCase();
}

/**
 * 人像 mask × 原片 → WebM VP9 + alpha（与色度抠像输出一致）。
 * mask：灰度/人像区白；scale2ref 对齐分辨率后 alphamerge。
 */
async function runFfmpegMaskAlphaVideo(
  sourcePath: string,
  maskPath: string,
  outputPath: string,
): Promise<void> {
  const filterComplex =
    '[1:v]format=gray[m];[0:v][m]scale2ref[v][m2];[v]format=rgba[vr];[vr][m2]alphamerge,format=yuva420p[outv]';

  const tryEncode = async (videoCodec: 'libvpx-vp9' | 'libvpx', withAudio: boolean) => {
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      sourcePath,
      '-i',
      maskPath,
      '-filter_complex',
      filterComplex,
      '-map',
      '[outv]',
      '-c:v',
      videoCodec,
      '-pix_fmt',
      'yuva420p',
      '-b:v',
      '0',
      '-crf',
      videoCodec === 'libvpx-vp9' ? '32' : '28',
      '-auto-alt-ref',
      '0',
      '-deadline',
      'good',
      '-cpu-used',
      '4',
      '-metadata:s:v:0',
      'alpha_mode=1',
      '-shortest',
    ];
    if (withAudio) {
      args.push('-map', '0:a:0', '-c:a', 'libopus', '-b:a', '128k');
    } else {
      args.push('-an');
    }
    args.push(outputPath);
    await runFfmpegArgs(args, outputPath);
  };

  try {
    await tryEncode('libvpx-vp9', true);
  } catch {
    try {
      await tryEncode('libvpx-vp9', false);
    } catch {
      try {
        await tryEncode('libvpx', true);
      } catch (err) {
        try {
          await tryEncode('libvpx', false);
        } catch {
          throw err;
        }
      }
    }
  }
}

/** 用 ffmpeg -i 探测时长 / 帧率 / 分辨率（不依赖独立 ffprobe） */
async function probeVideoBasicMeta(inputPath: string): Promise<{
  durationSec: number;
  fps: number;
  width: number;
  height: number;
  approxFrames: number;
}> {
  const ffmpegBin = resolveFfmpegPath();
  const stderr = await new Promise<string>((resolve) => {
    const child = spawn(ffmpegBin, ['-hide_banner', '-i', inputPath], { windowsHide: true });
    let err = '';
    child.stderr.on('data', (chunk) => {
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

  let fps = 0;
  const fpsM = stderr.match(/(\d+(?:\.\d+)?)\s*fps/i) || stderr.match(/(\d+(?:\.\d+)?)\s*tbr/i);
  if (fpsM) fps = Number(fpsM[1]);

  let width = 0;
  let height = 0;
  const dimM = stderr.match(/Video:.*?(\d{2,5})x(\d{2,5})/i);
  if (dimM) {
    width = Number(dimM[1]) || 0;
    height = Number(dimM[2]) || 0;
  }

  if (!(durationSec > 0) || !(fps > 0)) {
    // 回退：仅时长
    if (!(durationSec > 0)) {
      const d = await getMediaDuration(`local-resource://${inputPath.replace(/\\/g, '/')}`);
      durationSec = d > 0 ? d : 0;
    }
    if (!(fps > 0)) fps = 25;
  }

  const approxFrames = Math.ceil(Math.max(0, durationSec) * Math.max(1, fps));
  return { durationSec, fps, width, height, approxFrames };
}

/**
 * 色度抠像 → WebM VP9 + alpha，保留音轨。
 * 绿/蓝幕：chromakey（YUV 色度，与预览一致）+ despill；近黑/灰等：colorkey（RGB）。
 */
async function runFfmpegChromaKeyVideo(
  inputPath: string,
  outputPath: string,
  opts: { colorHex: string; similarity: number; blend: number },
): Promise<void> {
  const hex = normalizeChromaKeyHex(opts.colorHex);
  const vfWithDespill = buildFfmpegChromaKeyVf(hex, opts.similarity, opts.blend, { despill: true });
  const vfNoDespill = buildFfmpegChromaKeyVf(hex, opts.similarity, opts.blend, { despill: false });

  const tryEncode = async (videoCodec: 'libvpx-vp9' | 'libvpx', withAudio: boolean, vf: string) => {
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-vf',
      vf,
      '-c:v',
      videoCodec,
      '-pix_fmt',
      'yuva420p',
      '-b:v',
      '0',
      '-crf',
      videoCodec === 'libvpx-vp9' ? '32' : '28',
      '-auto-alt-ref',
      '0',
      '-deadline',
      'good',
      '-cpu-used',
      '4',
      // Chromium 依此识别 VP9 透明轨；ffprobe 仍可能显示 yuv420p
      '-metadata:s:v:0',
      'alpha_mode=1',
      '-map',
      '0:v:0',
    ];
    if (withAudio) {
      args.push('-map', '0:a:0', '-c:a', 'libopus', '-b:a', '128k');
    } else {
      args.push('-an');
    }
    args.push(outputPath);
    await runFfmpegArgs(args, outputPath);
  };

  const tryCodecCascade = async (vf: string) => {
    try {
      await tryEncode('libvpx-vp9', true, vf);
    } catch {
      try {
        await tryEncode('libvpx-vp9', false, vf);
      } catch {
        try {
          await tryEncode('libvpx', true, vf);
        } catch (err) {
          try {
            await tryEncode('libvpx', false, vf);
          } catch {
            throw err;
          }
        }
      }
    }
  };

  try {
    await tryCodecCascade(vfWithDespill);
  } catch (err) {
    if (vfNoDespill === vfWithDespill) throw err;
    await tryCodecCascade(vfNoDespill);
  }
}

/** 画面空间裁剪：ffmpeg crop 滤镜（须重编码，不能 -c copy） */
async function runFfmpegCropVideo(
  inputPath: string,
  outputPath: string,
  crop: { cropW: number; cropH: number; cropX: number; cropY: number },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ffmpegBin = resolveFfmpegPath();
    const vf = `crop=${crop.cropW}:${crop.cropH}:${crop.cropX}:${crop.cropY}`;
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-vf',
      vf,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      outputPath,
    ];
    const child = spawn(ffmpegBin, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().slice(-4000) || `ffmpeg exited with code ${code}`));
    });
  });
}

/** 音频裁剪：按起始和结束时间截取片段，输出 mp3 */
async function runFfmpegTrimAudio(inputPath: string, outputPath: string, startSec: number, endSec: number): Promise<void> {
  const duration = Math.max(0.01, endSec - startSec);
  await new Promise<void>((resolve, reject) => {
    const ffmpegBin = resolveFfmpegPath();
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      String(startSec),
      '-i',
      inputPath,
      '-t',
      String(duration),
      '-vn',
      '-acodec',
      'libmp3lame',
      '-q:a',
      '2',
      outputPath,
    ];
    const child = spawn(ffmpegBin, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}

let ffmpegAvailable: boolean | null = null;
let resolvedFfmpegPath: string | null = null;

function resolveFfmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (resolvedFfmpegPath) return resolvedFfmpegPath;
  const bundled = getBundledFfmpegPath();
  if (bundled) return bundled;
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || app.getPath('appData').replace('Roaming', 'Local');
    const winGetPkgs = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
    try {
      if (fs.existsSync(winGetPkgs)) {
        const dirs = fs.readdirSync(winGetPkgs);
        const gyanDir = dirs.find((d) => d.startsWith('Gyan.FFmpeg'));
        if (gyanDir) {
          const pkgPath = path.join(winGetPkgs, gyanDir);
          const subdirs = fs.readdirSync(pkgPath);
          const ffmpegBuild = subdirs.find((d) => d.startsWith('ffmpeg-') && d.includes('full_build'));
          if (ffmpegBuild) {
            const binPath = path.join(pkgPath, ffmpegBuild, 'bin', 'ffmpeg.exe');
            if (fs.existsSync(binPath)) {
              resolvedFfmpegPath = binPath;
              return binPath;
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }
  return 'ffmpeg';
}

async function ensureFfmpegAvailable(): Promise<boolean> {
  // 仅缓存成功结果；失败允许下次重试（避免启动瞬间 PATH/资源未就绪后永久判定不可用）
  if (ffmpegAvailable === true) return true;
  const ok = await new Promise<boolean>((resolve) => {
    try {
      const ffmpegBin = resolveFfmpegPath();
      const child = spawn(ffmpegBin, ['-version'], { windowsHide: true, shell: false });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
  if (ok) ffmpegAvailable = true;
  return ok;
}

/** 解析 local-resource/file URL 为本地路径（与协议处理器逻辑一致，支持中文路径） */
function resolveLocalResourceToPath(url: string): string {
  let filePath = url.replace(/^local-resource:\/\/+/, '').replace(/^file:\/\/+/, '');
  if (filePath.includes('?')) filePath = filePath.split('?')[0];
  filePath = filePath.replace(/^\/+/, '');
  if (process.platform === 'win32') {
    if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
    else if (filePath.match(/^\/[a-zA-Z]:/)) filePath = filePath.substring(1);
  }
  try {
    filePath = decodeURIComponent(filePath);
  } catch {
    const parts = filePath.split('/');
    filePath = parts
      .map((part) => {
        try {
          return decodeURIComponent(part);
        } catch {
          return part;
        }
      })
      .join('/');
  }
  return path.normalize(filePath);
}

/** MediaRecorder webm → mp3：修正缺失/错误的 duration 元数据，避免剪辑轨/HTML5 提前结束 */
async function runFfmpegMicRecordingToMp3(inputPath: string, outputPath: string): Promise<void> {
  const ext = path.extname(inputPath).toLowerCase();
  const inputFormatArgs = ext === '.webm' ? ['-f', 'webm'] : [];
  await new Promise<void>((resolve, reject) => {
    const ffmpegBin = resolveFfmpegPath();
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      ...inputFormatArgs,
      '-i',
      inputPath,
      '-vn',
      '-acodec',
      'libmp3lame',
      '-q:a',
      '2',
      outputPath,
    ];
    const child = spawn(ffmpegBin, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}

/**
 * 麦克风录音落盘后重编码为 mp3 并探测真实时长。
 * MediaRecorder 的 webm 常无完整 duration，直连剪辑轨会只播前几秒。
 */
export async function finalizeMicRecording(
  projectId: string | undefined,
  savedPath: string,
): Promise<{ savedPath: string; durationSec: number }> {
  const inputPath = path.normalize(String(savedPath || '').replace(/\\/g, '/'));
  if (!inputPath || !fs.existsSync(inputPath)) {
    return { savedPath: savedPath.replace(/\\/g, '/'), durationSec: 0 };
  }
  const hasFfmpeg = await ensureFfmpegAvailable();
  if (!hasFfmpeg) {
    const d = await getMediaDuration(`local-resource://${inputPath.replace(/\\/g, '/')}`, projectId);
    return { savedPath: inputPath.replace(/\\/g, '/'), durationSec: d };
  }
  const dir = path.dirname(inputPath);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const outputPath = path.join(dir, `mic-rec-${id}.mp3`).replace(/\\/g, '/');
  try {
    await runFfmpegMicRecordingToMp3(inputPath, outputPath);
    try {
      fs.unlinkSync(inputPath);
    } catch {
      /* ignore */
    }
    const outNorm = outputPath.replace(/\\/g, '/');
    const durationSec = await getMediaDuration(`local-resource://${outNorm}`, projectId);
    return { savedPath: outNorm, durationSec };
  } catch (err) {
    console.warn('[finalizeMicRecording] ffmpeg 转码失败，保留原 webm:', err);
    const d = await getMediaDuration(`local-resource://${inputPath.replace(/\\/g, '/')}`, projectId);
    return { savedPath: inputPath.replace(/\\/g, '/'), durationSec: d };
  }
}

/** 从媒体 URL 获取时长（秒），支持 local-resource://、file://、http(s):// */
export async function getMediaDuration(url: string, projectId?: string): Promise<number> {
  const isRemote = url.startsWith('http://') || url.startsWith('https://');
  let inputArg = url;

  if (!isRemote) {
    let filePath = resolveLocalResourceToPath(url);
    if (!filePath) return 0;
    if (!fs.existsSync(filePath) && !path.isAbsolute(filePath)) {
      filePath = path.resolve(app.getPath('userData'), filePath);
    }
    if (!fs.existsSync(filePath) && projectId) {
      const projectFolder = await getProjectFolderPath(projectId);
      if (projectFolder) {
        const pathLower = filePath.replace(/\\/g, '/').toLowerCase();
        const assetsIdx = pathLower.indexOf('assets/');
        if (assetsIdx >= 0) {
          const afterAssets = filePath.substring(assetsIdx).replace(/\\/g, '/');
          const candidate = path.join(projectFolder, afterAssets);
          if (fs.existsSync(candidate)) filePath = candidate;
        } else {
          const candidate = path.join(projectFolder, 'assets', path.basename(filePath));
          if (fs.existsSync(candidate)) filePath = candidate;
        }
      }
    }
    if (!filePath || !fs.existsSync(filePath)) return 0;
    inputArg = filePath;
  }

  const hasFfmpeg = await ensureFfmpegAvailable();
  if (!hasFfmpeg) return 0;
  return new Promise<number>((resolve) => {
    const ffmpegBin = resolveFfmpegPath();
    const child = spawn(ffmpegBin, ['-i', inputArg], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk || ''); });
    child.on('error', () => resolve(0));
    child.on('close', () => {
      const m = stderr.match(/Duration:\s*(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
      if (m) {
        const h = parseInt(m[1], 10);
        const min = parseInt(m[2], 10);
        const s = parseInt(m[3], 10);
        const frac = m[4] ? parseInt(m[4].padEnd(2, '0').slice(0, 2), 10) : 0;
        resolve(h * 3600 + min * 60 + s + frac / 100);
      } else resolve(0);
    });
  });
}

/** 导出时解析片段参考时长：导演 lockTrim 优先 trim，勿被成片探测拉长覆盖有意裁切 */
async function resolveTimelineClipDuration(
  clip: {
    type: string;
    src: string;
    duration: number;
    trimStart?: number;
    trimEnd?: number;
    lockTrim?: boolean;
  },
  projectId?: string,
): Promise<number> {
  if (clip.type === 'image') return clip.duration;
  const ts = Number(clip.trimStart) || 0;
  const te = clip.trimEnd;
  const intentionalTrim =
    te != null && Number.isFinite(te) && (te as number) > ts + 0.01;

  // 导演有意裁切：返回值仅作 trimEnd 缺省；调用方用 trimEnd-trimStart 切片，禁止 max(probed) 抬高
  if (clip.lockTrim && intentionalTrim) {
    return Math.max(Number.isFinite(clip.duration) ? clip.duration : 0, te as number);
  }

  const src = (clip.src || '').trim();
  if (!src) return clip.duration;
  const probed = await getMediaDuration(src, projectId);
  const fromClip = Math.max(
    clip.duration,
    intentionalTrim ? (te as number) : 0,
  );
  // 已有明确 trim 时：探测不得把参考时长抬到超过 trimEnd（避免缺 trim 回退时切到全片）
  if (intentionalTrim && probed > 0) {
    return Math.max(fromClip, Math.min(probed, te as number));
  }
  if (probed > 0) return Math.max(fromClip, probed);
  return fromClip;
}

async function generateVideoPosterAndGhost(
  originalPath: string,
  posterPath: string,
  opts?: { preserveAlpha?: boolean },
): Promise<{ bytesPoster?: number; width?: number; height?: number; ghostBase64?: string }> {
  try {
    const hasFfmpeg = await ensureFfmpegAvailable();
    if (!hasFfmpeg) {
      return {};
    }
    await runFfmpegCapturePoster(originalPath, posterPath, 8000, { preserveAlpha: !!opts?.preserveAlpha });
    if (!fs.existsSync(posterPath) || !fs.statSync(posterPath).isFile()) {
      return {};
    }
    const bytesPoster = fs.statSync(posterPath).size;
    const sharpMod = await getSharp();
    if (!sharpMod) {
      return { bytesPoster };
    }
    return runSharpTask(async () => {
      const sharp = sharpMod.default || sharpMod;
      const poster = sharp(posterPath, { failOn: 'none' });
      const metadata = await poster.metadata();
      // 透明封面叠中灰再压 JPEG ghost，避免透明区变黑导致极暗剪影缩略图
      let ghostPipeline = poster.clone();
      if (opts?.preserveAlpha || path.extname(posterPath).toLowerCase() === '.png') {
        ghostPipeline = ghostPipeline.flatten({ background: { r: 176, g: 176, b: 176 } });
      }
      const ghostBuf = await ghostPipeline
        .resize({
          width: 24,
          height: 24,
          ...RESIZE_PRESET,
        })
        .jpeg({
          quality: 10,
          mozjpeg: true,
          chromaSubsampling: '4:2:0',
        })
        .toBuffer();
      return {
        bytesPoster,
        width: metadata.width,
        height: metadata.height,
        ghostBase64: `data:image/jpeg;base64,${ghostBuf.toString('base64')}`,
      };
    });
  } catch (error) {
    console.warn('[LocalResourceManager] 生成视频 poster/ghost 失败，将回退为无 poster 模式:', error);
    return {};
  }
}

function guessVideoExtFromUrl(inputUrl: string): string {
  try {
    const u = new URL(inputUrl);
    const pathname = (u.pathname || '').toLowerCase();
    const ext = path.extname(pathname);
    if (ext && /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(ext)) return ext;
  } catch {
    // ignore
  }
  return '.mp4';
}

/**
 * 用户常从地址栏复制完整链接；原样交给 yt-dlp。
 * trim、去 BOM、无协议时对 bilibili / b23 / youtube / youtu.be 补 https。
 */
function normalizeStreamPageUrlInput(input: string): string {
  let s = (input || '').trim().replace(/^\uFEFF/, '');
  if (!s) return s;
  s = s.replace(/\u3000/g, ' ').trim();
  if (!/^https?:\/\//i.test(s)) {
    if (/^\/\//.test(s)) s = `https:${s}`;
    else if (
      /^(?:[\w-]+\.)*bilibili\.com\b/i.test(s) ||
      /^b23\.tv\b/i.test(s) ||
      /^youtu\.be\b/i.test(s) ||
      /^(?:[\w-]+\.)*youtube\.com\b/i.test(s) ||
      /^(?:[\w-]+\.)*youtube-nocookie\.com\b/i.test(s)
    ) {
      s = `https://${s.replace(/^\/+/, '')}`;
    }
  }
  return s;
}

function isBilibiliPageUrl(inputUrl: string): boolean {
  try {
    const host = new URL(inputUrl.trim()).hostname.toLowerCase();
    return host.includes('bilibili.com') || host.endsWith('b23.tv');
  } catch {
    return false;
  }
}

function isYouTubePageUrl(inputUrl: string): boolean {
  try {
    const host = new URL(inputUrl.trim()).hostname.toLowerCase();
    if (host === 'youtu.be') return true;
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) return true;
    if (host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com')) return true;
    return false;
  } catch {
    return false;
  }
}

type StreamVideoSite = 'bilibili' | 'youtube';

function classifyStreamVideoSite(url: string): StreamVideoSite | null {
  if (isBilibiliPageUrl(url)) return 'bilibili';
  if (isYouTubePageUrl(url)) return 'youtube';
  return null;
}

/** 独立可执行文件，或 Python 模块方式：python -m yt_dlp（pip install yt-dlp 后可用） */
type YtDlpInvocation = { command: string; prefixArgs: string[] };

function resolveYtDlpInvocation(): YtDlpInvocation | null {
  const envPath = process.env.YT_DLP_PATH?.trim();
  if (envPath && fs.existsSync(envPath)) {
    return { command: envPath, prefixArgs: [] };
  }

  const resourcesPath = process.resourcesPath;
  if (resourcesPath) {
    const bundled =
      process.platform === 'win32'
        ? path.join(resourcesPath, 'yt-dlp', 'yt-dlp.exe')
        : path.join(resourcesPath, 'yt-dlp', 'yt-dlp');
    if (fs.existsSync(bundled)) return { command: bundled, prefixArgs: [] };
  }

  try {
    if (process.platform === 'win32') {
      const out = execFileSync('where.exe', ['yt-dlp'], { encoding: 'utf8', windowsHide: true }).trim();
      const first = out.split(/\r?\n/)[0]?.trim();
      if (first && fs.existsSync(first)) return { command: first, prefixArgs: [] };
    } else {
      const out = execFileSync('which', ['yt-dlp'], { encoding: 'utf8', windowsHide: true }).trim();
      const first = out.split(/\r?\n/)[0]?.trim();
      if (first && fs.existsSync(first)) return { command: first, prefixArgs: [] };
    }
  } catch {
    /* not in PATH */
  }

  const pythonCandidates: YtDlpInvocation[] =
    process.platform === 'win32'
      ? [
          { command: 'py', prefixArgs: ['-3', '-m', 'yt_dlp'] },
          { command: 'python', prefixArgs: ['-m', 'yt_dlp'] },
          { command: 'python3', prefixArgs: ['-m', 'yt_dlp'] },
        ]
      : [
          { command: 'python3', prefixArgs: ['-m', 'yt_dlp'] },
          { command: 'python', prefixArgs: ['-m', 'yt_dlp'] },
        ];

  for (const inv of pythonCandidates) {
    try {
      execFileSync(inv.command, [...inv.prefixArgs, '--version'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      return inv;
    } catch {
      /* try next interpreter */
    }
  }

  return null;
}

/** B 站抓取仅本机直连 bilibili，不经任何云端。仅当 NX_YTDLP_USE_PROXY=1 时才向 yt-dlp 继承系统环境变量里的 HTTP(S)_PROXY（翻墙场景）。 */
function shouldUseSystemProxyForYtDlp(): boolean {
  return process.env.NX_YTDLP_USE_PROXY === '1';
}

/** B 站：不传 --proxy 时由子进程自行处理；仅在不希望继承系统代理时强制 --proxy 为空 */
function buildYtDlpNetworkArgs(): string[] {
  if (shouldUseSystemProxyForYtDlp()) return [];
  return ['--proxy', ''];
}

/**
 * B 站拉取元数据常校验 Referer/UA；缺省易被拒 HTTP 412 Precondition Failed。
 * 若仍 412（会员/风控/登录稿）：用浏览器扩展导出 Netscape cookies.txt，设 NX_BILIBILI_COOKIES=绝对路径。
 */
function buildYtDlpBilibiliClientArgs(): string[] {
  const out: string[] = [
    '--add-header',
    'Referer:https://www.bilibili.com/',
    '--add-header',
    'Origin:https://www.bilibili.com',
    '--user-agent',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  ];
  const cookiesPath = process.env.NX_BILIBILI_COOKIES?.trim();
  if (cookiesPath && fs.existsSync(cookiesPath) && fs.statSync(cookiesPath).isFile()) {
    out.push('--cookies', path.resolve(cookiesPath));
  }
  return out;
}

/** 失败时优先展示 ERROR 行，避免 WARNING 占满 4k 窗口 */
function formatYtDlpStderrForUser(stderr: string): string {
  const t = (stderr || '').trim();
  if (!t) return '';
  const lines = t.split(/\r?\n/).map((l) => l.trimEnd());
  const errLines = lines.filter((l) => /^\s*ERROR\s*:/i.test(l));
  const body = errLines.length ? errLines.join('\n') : t;
  return body.length > 4000 ? body.slice(-4000) : body;
}

/**
 * yt-dlp 子进程环境：合并 PATH。
 * @param stripProxyVars true 时移除 HTTP(S)_PROXY 等（避免死代理）；false 时保留，供 urllib 使用系统/VPN 注入的代理。
 */
function buildEnvForYtDlp(ffmpegDir: string, opts?: { stripProxyVars?: boolean }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${ffmpegDir}${path.delimiter}${process.env.PATH || ''}`,
  };
  const strip =
    opts?.stripProxyVars !== undefined ? opts.stripProxyVars : !shouldUseSystemProxyForYtDlp();
  if (strip) {
    for (const k of [
      'HTTP_PROXY',
      'http_proxy',
      'HTTPS_PROXY',
      'https_proxy',
      'ALL_PROXY',
      'all_proxy',
    ] as const) {
      delete env[k];
    }
  }
  return env;
}

function runYtDlpSpawn(invocation: YtDlpInvocation, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const allArgs = [...invocation.prefixArgs, ...args];
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, allArgs, { windowsHide: true, env });
    let stderr = '';
    child.stderr?.on('data', (c) => {
      stderr += String(c);
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(formatYtDlpStderrForUser(stderr) || `yt-dlp 退出码 ${code}`));
    });
  });
}

export class LocalResourceManager {
  async createImageResourceFromFile(projectId: string | undefined, sourceFilePath: string): Promise<LocalImageResourceResult> {
    const normalized = (sourceFilePath || '').trim().replace(/^file:\/\/\/?/i, '');
    if (!normalized) throw new Error('源文件路径为空');
    if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) {
      throw new Error('源文件不存在或不是文件');
    }
    const saveDir = await resolveSaveDir(projectId);
    const ext = (path.extname(normalized) || '.png').toLowerCase();
    const stem = safeStem(path.basename(normalized, ext));
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const originalPath = path.join(saveDir, `${stem}-${id}${ext}`).replace(/\\/g, '/');
    const previewPath = path.join(saveDir, `${stem}-${id}_preview.jpg`).replace(/\\/g, '/');
    const tinyPath = path.join(saveDir, `${stem}-${id}_tiny.jpg`).replace(/\\/g, '/');

    await fs.promises.copyFile(normalized, originalPath);
    const bytesOriginal = (await fs.promises.stat(originalPath)).size;
    const preview = await generatePreviewAssets(originalPath, previewPath, tinyPath, {
      includeGhost: true,
      bypassPause: true,
    });
    const ghostBase64 = preview.ghostBase64 || '';

    return {
      originalPath,
      previewPath,
      tinyPath,
      originalUrl: toLocalResourceUrl(originalPath),
      previewUrl: toLocalResourceUrl(previewPath),
      tinyUrl: toLocalResourceUrl(tinyPath),
      bytesOriginal,
      bytesPreview: preview.bytesPreview,
      bytesTiny: preview.bytesTiny,
      avgColorHex: preview.avgColorHex,
      ghostBase64,
      width: preview.width,
      height: preview.height,
    };
  }

  async createImageResourceFromBuffer(projectId: string | undefined, originalFileName: string, buffer: ArrayBuffer): Promise<LocalImageResourceResult> {
    const saveDir = await resolveSaveDir(projectId);
    const ext = (path.extname(originalFileName || '') || '.png').toLowerCase();
    const stem = safeStem(path.basename(originalFileName || 'image', ext));
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const originalPath = path.join(saveDir, `${stem}-${id}${ext}`).replace(/\\/g, '/');
    const previewPath = path.join(saveDir, `${stem}-${id}_preview.jpg`).replace(/\\/g, '/');
    const tinyPath = path.join(saveDir, `${stem}-${id}_tiny.jpg`).replace(/\\/g, '/');

    // 异步写盘，避免大图 upload 卡死主进程事件循环
    await fs.promises.writeFile(originalPath, Buffer.from(buffer));
    const bytesOriginal = (await fs.promises.stat(originalPath)).size;
    // 单次 sharp 任务生成 preview/tiny/ghost；bypassPause 避免画布平移时上传永久排队
    const preview = await generatePreviewAssets(originalPath, previewPath, tinyPath, {
      includeGhost: true,
      bypassPause: true,
    });

    return {
      originalPath,
      previewPath,
      tinyPath,
      originalUrl: toLocalResourceUrl(originalPath),
      previewUrl: toLocalResourceUrl(previewPath),
      tinyUrl: toLocalResourceUrl(tinyPath),
      bytesOriginal,
      bytesPreview: preview.bytesPreview,
      bytesTiny: preview.bytesTiny,
      avgColorHex: preview.avgColorHex,
      ghostBase64: preview.ghostBase64 || '',
      width: preview.width,
      height: preview.height,
    };
  }

  /**
   * 资产库列表专用小缩略图（默认 256px）。磁盘缓存，二次打开秒开；
   * 不走画布 sharp pause，避免平移时列表假死。
   */
  async ensureLibraryListThumb(
    sourceUrlOrPath: string,
    maxEdge = 256,
  ): Promise<{ thumbUrl: string; thumbPath: string; cached: boolean }> {
    const raw = String(sourceUrlOrPath || '').trim();
    if (!raw) throw new Error('源路径为空');
    if (/\.(mp4|webm|mov|mkv|m4v)(\?|$)/i.test(raw)) {
      throw new Error('视频请使用 poster，不生成列表缩略图');
    }

    let sourcePath = raw;
    if (raw.startsWith('local-resource://')) {
      sourcePath = decodeURIComponent(raw.slice('local-resource://'.length));
      if (/^\/[A-Za-z]:/.test(sourcePath)) sourcePath = sourcePath.slice(1);
    } else if (raw.startsWith('file://')) {
      sourcePath = raw.replace(/^file:\/\/\/?/i, '');
      if (process.platform === 'win32' && sourcePath.startsWith('/')) sourcePath = sourcePath.slice(1);
    }
    sourcePath = path.normalize(sourcePath.replace(/\//g, path.sep));
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw new Error('源文件不存在');
    }

    const edge = Math.max(64, Math.min(512, Math.round(Number(maxEdge) || 256)));
    const srcStat = fs.statSync(sourcePath);
    const key = crypto
      .createHash('sha1')
      .update(`${sourcePath}|${edge}|${srcStat.mtimeMs}|${srcStat.size}`)
      .digest('hex')
      .slice(0, 20);
    const thumbDir = path.join(app.getPath('userData'), 'library-list-thumbs');
    fs.mkdirSync(thumbDir, { recursive: true });
    const thumbPath = path.join(thumbDir, `${key}.jpg`).replace(/\\/g, '/');

    if (fs.existsSync(thumbPath)) {
      try {
        const tStat = fs.statSync(thumbPath);
        if (tStat.isFile() && tStat.size > 0) {
          return { thumbUrl: toLocalResourceUrl(thumbPath), thumbPath, cached: true };
        }
      } catch {
        /* regenerate */
      }
    }

    const sharpMod = await getSharp();
    if (!sharpMod) {
      return { thumbUrl: toLocalResourceUrl(sourcePath.replace(/\\/g, '/')), thumbPath: sourcePath, cached: false };
    }

    await runSharpTask(async () => {
      const sharp = sharpMod.default || sharpMod;
      await sharp(sourcePath, { failOn: 'none', sequentialRead: true })
        .rotate()
        .resize({
          width: edge,
          height: edge,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 62, chromaSubsampling: '4:2:0' })
        .toFile(thumbPath);
    }, { bypassPause: true });

    return { thumbUrl: toLocalResourceUrl(thumbPath), thumbPath, cached: false };
  }

  /**
   * 从参考视频抽一帧作为数字人列表头像；缓存到 digital-human-library/{id}-list-poster.jpg。
   * 仅 ffmpeg 抽帧，不做 ghost，避免打开数字人库时卡死。
   */
  async ensureDigitalHumanVideoPoster(
    videoUrlOrPath: string,
    itemId: string,
  ): Promise<{ posterUrl: string; localPosterPath: string; cached: boolean }> {
    const id = String(itemId || '').trim() || `dh-${Date.now()}`;
    let videoPath = String(videoUrlOrPath || '').trim();
    if (!videoPath) throw new Error('视频路径为空');
    if (videoPath.startsWith('local-resource://')) {
      videoPath = decodeURIComponent(videoPath.slice('local-resource://'.length));
      if (/^\/[A-Za-z]:/.test(videoPath)) videoPath = videoPath.slice(1);
    } else if (videoPath.startsWith('file://')) {
      videoPath = videoPath.replace(/^file:\/\/\/?/i, '');
      if (process.platform === 'win32' && videoPath.startsWith('/')) videoPath = videoPath.slice(1);
    }
    videoPath = path.normalize(videoPath.replace(/\//g, path.sep));
    if (!fs.existsSync(videoPath) || !fs.statSync(videoPath).isFile()) {
      throw new Error('参考视频不存在');
    }

    const dir = path.join(app.getPath('userData'), 'digital-human-library');
    fs.mkdirSync(dir, { recursive: true });
    const posterPath = path.join(dir, `${id}-list-poster.jpg`).replace(/\\/g, '/');
    if (fs.existsSync(posterPath)) {
      try {
        const st = fs.statSync(posterPath);
        if (st.isFile() && st.size > 0) {
          return {
            posterUrl: toLocalResourceUrl(posterPath),
            localPosterPath: posterPath,
            cached: true,
          };
        }
      } catch {
        /* regenerate */
      }
    }

    const hasFfmpeg = await ensureFfmpegAvailable();
    if (!hasFfmpeg) throw new Error('ffmpeg 不可用，无法生成头像');
    await runFfmpegCapturePoster(videoPath, posterPath, 10000);
    if (!fs.existsSync(posterPath) || fs.statSync(posterPath).size <= 0) {
      throw new Error('头像抽帧失败');
    }

    // 压成较小列表图，加快侧栏解码
    try {
      const thumb = await this.ensureLibraryListThumb(toLocalResourceUrl(posterPath), 256);
      if (thumb.thumbPath && thumb.thumbPath !== posterPath && fs.existsSync(thumb.thumbPath)) {
        try {
          fs.copyFileSync(thumb.thumbPath, posterPath);
        } catch {
          /* keep original poster frame */
        }
      }
    } catch {
      /* ignore thumb shrink failure */
    }

    return {
      posterUrl: toLocalResourceUrl(posterPath),
      localPosterPath: posterPath,
      cached: false,
    };
  }

  async createVideoResourceFromFile(
    projectId: string | undefined,
    sourceFilePath: string,
    options?: { hasAlpha?: boolean },
  ): Promise<LocalVideoResourceResult> {
    const normalized = (sourceFilePath || '').trim().replace(/^file:\/\/\/?/i, '');
    if (!normalized) throw new Error('源文件路径为空');
    if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) {
      throw new Error('源文件不存在或不是文件');
    }
    const hasAlpha = !!options?.hasAlpha;
    const saveDir = await resolveSaveDir(projectId);
    const ext = (path.extname(normalized) || '.mp4').toLowerCase();
    const stem = safeStem(path.basename(normalized, ext));
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const originalPath = path.join(saveDir, `${stem}-${id}${ext}`).replace(/\\/g, '/');
    // 透明成片用 PNG 封面保留 alpha，避免 JPEG 黑底剪影
    const posterExt = hasAlpha ? '.png' : '.jpg';
    const posterPath = path.join(saveDir, `${stem}-${id}_poster${posterExt}`).replace(/\\/g, '/');
    // 异步复制 + 限时抽帧（并行），避免大文件/坏文件卡死主进程与上传按钮
    const posterPromise = generateVideoPosterAndGhost(normalized, posterPath, { preserveAlpha: hasAlpha }).catch((error) => {
      console.warn('[LocalResourceManager] 视频封面生成失败，已跳过:', error);
      return {} as { bytesPoster?: number; width?: number; height?: number; ghostBase64?: string };
    });
    await fs.promises.copyFile(normalized, originalPath);
    const bytesOriginal = (await fs.promises.stat(originalPath)).size;
    const poster = await Promise.race([
      posterPromise,
      new Promise<{ bytesPoster?: number; width?: number; height?: number; ghostBase64?: string }>((resolve) => {
        setTimeout(() => resolve({}), 9000);
      }),
    ]);
    return {
      originalPath,
      originalUrl: toLocalResourceUrl(originalPath),
      posterPath: poster.bytesPoster ? posterPath : undefined,
      posterUrl: poster.bytesPoster ? toLocalResourceUrl(posterPath) : undefined,
      ghostBase64: poster.ghostBase64,
      bytesOriginal,
      bytesPoster: poster.bytesPoster,
      width: poster.width,
      height: poster.height,
      ...(hasAlpha ? { hasAlpha: true } : {}),
    };
  }

  async createVideoResourceFromBuffer(projectId: string | undefined, originalFileName: string, buffer: ArrayBuffer): Promise<LocalVideoResourceResult> {
    const saveDir = await resolveSaveDir(projectId);
    const ext = (path.extname(originalFileName || '') || '.mp4').toLowerCase();
    const stem = safeStem(path.basename(originalFileName || 'video', ext));
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const originalPath = path.join(saveDir, `${stem}-${id}${ext}`).replace(/\\/g, '/');
    const posterPath = path.join(saveDir, `${stem}-${id}_poster.jpg`).replace(/\\/g, '/');
    fs.writeFileSync(originalPath, Buffer.from(buffer));
    const bytesOriginal = fs.statSync(originalPath).size;
    const poster = await generateVideoPosterAndGhost(originalPath, posterPath);
    return {
      originalPath,
      originalUrl: toLocalResourceUrl(originalPath),
      posterPath: poster.bytesPoster ? posterPath : undefined,
      posterUrl: poster.bytesPoster ? toLocalResourceUrl(posterPath) : undefined,
      ghostBase64: poster.ghostBase64,
      bytesOriginal,
      bytesPoster: poster.bytesPoster,
      width: poster.width,
      height: poster.height,
    };
  }

  async createVideoResourceFromUrl(projectId: string | undefined, sourceUrl: string): Promise<LocalVideoResourceResult> {
    const url = (sourceUrl || '').trim();
    if (!url) throw new Error('源视频 URL 为空');
    const saveDir = await resolveSaveDir(projectId);
    const ext = guessVideoExtFromUrl(url);
    const stem = safeStem('remote-video');
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const originalPath = path.join(saveDir, `${stem}-${id}${ext}`).replace(/\\/g, '/');
    const posterPath = path.join(saveDir, `${stem}-${id}_poster.jpg`).replace(/\\/g, '/');

    const resp = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 30000, proxy: false });
    fs.writeFileSync(originalPath, Buffer.from(resp.data));
    const bytesOriginal = fs.statSync(originalPath).size;

    const poster = await generateVideoPosterAndGhost(originalPath, posterPath);
    return {
      originalPath,
      originalUrl: toLocalResourceUrl(originalPath),
      posterPath: poster.bytesPoster ? posterPath : undefined,
      posterUrl: poster.bytesPoster ? toLocalResourceUrl(posterPath) : undefined,
      ghostBase64: poster.ghostBase64,
      bytesOriginal,
      bytesPoster: poster.bytesPoster,
      width: poster.width,
      height: poster.height,
    };
  }

  /**
   * 使用 yt-dlp 从 **哔哩哔哩或 YouTube** 视频页下载到项目本地 assets（需本机 yt-dlp；合并音视频需 ffmpeg）。
   * **不经阿里云**：不调用 FC、不经过 OSS 上传链路。YouTube 使用自适应网络（见 videoScraper）；B 站可设 NX_YTDLP_USE_PROXY=1 继承系统代理变量。
   * IPC 名仍为 create-video-from-bilibili-page，与历史构建兼容。
   */
  async createVideoResourceFromBilibiliPage(projectId: string | undefined, pageUrl: string): Promise<LocalVideoResourceResult> {
    const url = normalizeStreamPageUrlInput(pageUrl);
    if (!url) throw new Error('链接为空');
    const site = classifyStreamVideoSite(url);
    if (!site) {
      throw new Error(
        '仅支持哔哩哔哩或 YouTube 视频链接（如 bilibili.com / b23.tv、youtube.com、youtu.be、Shorts 等）',
      );
    }

    const ytDlp = resolveYtDlpInvocation();
    if (!ytDlp) {
      const packagedHint = app.isPackaged
        ? '正式版安装包应已内置 yt-dlp；若仍提示此项，可能是安装不完整，请重新安装或联系发行方。也可设置环境变量 YT_DLP_PATH 指向本机 yt-dlp 可执行文件。'
        : '开发环境：① 将 yt-dlp 加入 PATH 或设置 YT_DLP_PATH；② 执行 npm run copy-yt-dlp 后重新打包，使安装包内置 yt-dlp；③ 已安装 Python 时可 pip install -U yt-dlp（程序会尝试 python -m yt_dlp）。';
      throw new Error(`未找到 yt-dlp。${packagedHint}`);
    }

    const siteArgs = site === 'bilibili' ? buildYtDlpBilibiliClientArgs() : buildYoutubeYtDlpClientArgs();

    const tmpPrefix = site === 'bilibili' ? 'nexflow-bili-' : 'nexflow-yt-';
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), tmpPrefix));
    const outPattern = path.join(tmpRoot, 'download.%(ext)s');
    const ffmpegBin = resolveFfmpegPath();
    const ffmpegDir = path.dirname(ffmpegBin);

    try {
      // B 站：只选 DASH 分轨（bv+ba），避免回退到单文件 best（老 durl/flv 常带「用户名 bilibili」角标水印）
      const formatSelector =
        site === 'bilibili'
          ? 'bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/bestvideo*[ext!=flv]+bestaudio/bestvideo*+bestaudio'
          : 'bv*+ba/bestvideo*+bestaudio/best';
      const downloadTail: string[] = [
        ...(site === 'youtube' ? buildYoutubeYtDlpSpeedArgs() : []),
        '--no-playlist',
        '--no-mtime',
        '-f',
        formatSelector,
        '--merge-output-format',
        'mp4',
        '-o',
        outPattern,
        url,
      ];
      if (site === 'youtube') {
        const hasProxyInEnv = !!(
          process.env.HTTPS_PROXY?.trim() ||
          process.env.HTTP_PROXY?.trim() ||
          process.env.ALL_PROXY?.trim() ||
          process.env.https_proxy?.trim() ||
          process.env.http_proxy?.trim()
        );
        const useInheritedProxy = shouldUseSystemProxyForYtDlp();
        /** 第 1 级已保留代理时，第 2 级无差异，不必再跑一轮 */
        const skipSecondAttempt = useInheritedProxy || !hasProxyInEnv;
        await runYoutubeYtDlpAdaptive({
          invocation: ytDlp,
          siteArgs,
          downloadArgs: downloadTail,
          skipSecondAttempt,
          buildEnvTier1: () => buildEnvForYtDlp(ffmpegDir, { stripProxyVars: !useInheritedProxy }),
          buildEnvTier2: () => buildEnvForYtDlp(ffmpegDir, { stripProxyVars: false }),
        });
      } else {
        const ytdlpArgs = [...buildYtDlpNetworkArgs(), ...siteArgs, ...downloadTail];
        await runYtDlpSpawn(ytDlp, ytdlpArgs, buildEnvForYtDlp(ffmpegDir));
      }

      const entries = fs.readdirSync(tmpRoot);
      const videoName = entries.find((f) => /\.(mp4|mkv|webm|m4v|flv)$/i.test(f));
      if (!videoName) {
        throw new Error(
          site === 'bilibili'
            ? '下载完成但未找到视频文件，请确认链接为有效哔哩哔哩稿件'
            : '下载完成但未找到视频文件，请确认链接为有效 YouTube 视频；会员/年龄限制等可配置 NX_YOUTUBE_COOKIES 后重试',
        );
      }
      const fullPath = path.join(tmpRoot, videoName);
      return await this.createVideoResourceFromFile(projectId, fullPath);
    } finally {
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * 从视频中提取音频，保存为 mp3 并返回 local-resource URL
   * @param projectId 项目 ID
   * @param videoUrl 视频地址：local-resource://、file://、http(s)://，或项目根下的相对路径、本机绝对路径
   */
  async extractAudioFromVideo(projectId: string | undefined, videoUrl: string): Promise<{ audioUrl: string }> {
    const url = (videoUrl || '').trim();
    if (!url) throw new Error('视频 URL 为空');
    if (url.startsWith('blob:')) {
      throw new Error('当前视频仅有预览地址，请等待下载到本地完成后再提取音频');
    }

    let inputPath: string;

    if (url.startsWith('http://') || url.startsWith('https://')) {
      const saveDir = await resolveSaveDir(projectId);
      const ext = guessVideoExtFromUrl(url);
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      inputPath = path.join(saveDir, `video-extract-${id}${ext}`).replace(/\\/g, '/');
      try {
        const resp = await axios.get<ArrayBuffer>(url, {
          responseType: 'arraybuffer',
          timeout: 60_000,
          proxy: false,
          maxContentLength: 512 * 1024 * 1024,
          maxBodyLength: 512 * 1024 * 1024,
        });
        fs.writeFileSync(inputPath, Buffer.from(resp.data));
      } catch (e: any) {
        const msg = e?.code === 'ECONNABORTED' || /timeout/i.test(String(e?.message || ''))
          ? '下载视频超时，无法提取音频（请确认网络或改用已落盘的本地视频）'
          : `下载视频失败：${e?.message || e}`;
        throw new Error(msg);
      }
    } else {
      inputPath = await resolveLocalMediaFilePath(projectId, url);
    }

    const hasFfmpeg = await ensureFfmpegAvailable();
    if (!hasFfmpeg) {
      throw new Error('未检测到 ffmpeg，无法提取音频。请安装 ffmpeg 并添加到系统 PATH。');
    }

    const saveDir = await resolveSaveDir(projectId);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const outputPath = path.join(saveDir, `extracted-audio-${id}.mp3`).replace(/\\/g, '/');

    try {
      await runFfmpegExtractAudio(inputPath, outputPath);
    } finally {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        try {
          fs.unlinkSync(inputPath);
        } catch {
          // ignore
        }
      }
    }

    return { audioUrl: toLocalResourceUrl(outputPath) };
  }

  /**
   * 音频裁剪：按起始和结束时间截取片段
   * @param projectId 项目 ID
   * @param audioUrl 音频 URL（local-resource://、file://、http(s)://）
   * @param startSec 起始时间（秒）
   * @param endSec 结束时间（秒）
   */
  async trimAudio(
    projectId: string | undefined,
    audioUrl: string,
    startSec: number,
    endSec: number
  ): Promise<{ audioUrl: string }> {
    const url = (audioUrl || '').trim();
    if (!url) throw new Error('音频 URL 为空');
    if (startSec < 0 || endSec <= startSec) throw new Error('起始时间须小于结束时间');

    let inputPath: string;
    let shouldDeleteInput = false;

    if (url.startsWith('data:audio/') && url.includes(';base64,')) {
      const base64Match = url.match(/^data:audio\/[^;]+;base64,(.+)$/);
      if (!base64Match) throw new Error('无效的 data URL 格式');
      const saveDir = await resolveSaveDir(projectId);
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      inputPath = path.join(saveDir, `audio-trim-input-${id}.mp3`).replace(/\\/g, '/');
      const buf = Buffer.from(base64Match[1], 'base64');
      fs.writeFileSync(inputPath, buf);
      shouldDeleteInput = true;
    } else if (url.startsWith('local-resource://') || url.startsWith('file://')) {
      let filePath = url.replace(/^local-resource:\/\/+/, '').replace(/^file:\/\/+/, '');
      if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
      filePath = decodeURIComponent(filePath);
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new Error('音频文件不存在或无法访问');
      }
      inputPath = path.normalize(filePath);
    } else if (url.startsWith('http://') || url.startsWith('https://')) {
      const saveDir = await resolveSaveDir(projectId);
      const ext = path.extname(new URL(url).pathname || '') || '.mp3';
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      inputPath = path.join(saveDir, `audio-trim-input-${id}${ext}`).replace(/\\/g, '/');
      const resp = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 120000, proxy: false });
      fs.writeFileSync(inputPath, Buffer.from(resp.data));
    } else {
      throw new Error('不支持的音频 URL 格式');
    }

    const hasFfmpeg = await ensureFfmpegAvailable();
    if (!hasFfmpeg) {
      throw new Error('未检测到 ffmpeg，无法裁剪音频。请安装 ffmpeg 并添加到系统 PATH。');
    }

    const saveDir = await resolveSaveDir(projectId);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const outputPath = path.join(saveDir, `audio-trimmed-${id}.mp3`).replace(/\\/g, '/');

    await runFfmpegTrimAudio(inputPath, outputPath, startSec, endSec);

    if (url.startsWith('http://') || url.startsWith('https://') || shouldDeleteInput) {
      try {
        fs.unlinkSync(inputPath);
      } catch {
        // ignore
      }
    }

    return { audioUrl: toLocalResourceUrl(outputPath) };
  }

  /**
   * 视频裁剪：按起始和结束时间截取片段
   * @param projectId 项目 ID
   * @param videoUrl 视频 URL（local-resource://、file://、http(s)://）
   * @param startSec 起始时间（秒）
   * @param endSec 结束时间（秒）
   */
  async trimVideo(
    projectId: string | undefined,
    videoUrl: string,
    startSec: number,
    endSec: number
  ): Promise<{ videoUrl: string; durationSec: number }> {
    const url = (videoUrl || '').trim();
    if (!url) throw new Error('视频 URL 为空');
    const start = Math.max(0, Number(startSec));
    const end = Number(endSec);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error('起始时间须小于结束时间');
    }
    const expectedDur = Math.max(0.01, end - start);

    let inputPath: string;

    if (url.startsWith('local-resource://') || url.startsWith('file://')) {
      let filePath = url.replace(/^local-resource:\/\/+/, '').replace(/^file:\/\/+/, '');
      if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
      filePath = decodeURIComponent(filePath);
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new Error('视频文件不存在或无法访问');
      }
      inputPath = path.normalize(filePath);
    } else if (url.startsWith('http://') || url.startsWith('https://')) {
      const saveDir = await resolveSaveDir(projectId);
      const ext = guessVideoExtFromUrl(url);
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      inputPath = path.join(saveDir, `video-trim-input-${id}${ext}`).replace(/\\/g, '/');
      const resp = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 120000, proxy: false });
      fs.writeFileSync(inputPath, Buffer.from(resp.data));
    } else {
      throw new Error('不支持的视频 URL 格式');
    }

    const hasFfmpeg = await ensureFfmpegAvailable();
    if (!hasFfmpeg) {
      throw new Error('未检测到 ffmpeg，无法裁剪视频。请安装 ffmpeg 并添加到系统 PATH。');
    }

    const saveDir = await resolveSaveDir(projectId);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const outputPath = path.join(saveDir, `video-trimmed-${id}.mp4`).replace(/\\/g, '/');

    console.log('[trimVideo]', { start, end, expectedDur, inputPath: path.basename(inputPath) });
    await runFfmpegTrimVideo(inputPath, outputPath, start, end);

    const outUrl = toLocalResourceUrl(outputPath);
    let finalDur = await getMediaDuration(outUrl, projectId);
    if (!(finalDur > 0) || Math.abs(finalDur - expectedDur) > 0.75) {
      console.warn('[trimVideo] 时长需校正', { expectedDur, finalDur });
      const fixPath = `${outputPath}.fix.mp4`;
      try {
        // 与主裁剪一致：保留音轨；失败时再退回无声校正
        const fixWithAudio = [
          '-y',
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          inputPath,
          '-ss',
          String(start),
          '-t',
          String(expectedDur),
          '-map',
          '0:v:0',
          '-map',
          '0:a:0',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '18',
          '-pix_fmt',
          'yuv420p',
          '-vsync',
          'cfr',
          '-r',
          '30',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-af',
          'aresample=async=1:first_pts=0',
          '-fflags',
          '+genpts',
          '-movflags',
          '+faststart',
          fixPath,
        ];
        try {
          await runFfmpegArgs(fixWithAudio, fixPath);
        } catch {
          await runFfmpegArgs(
            [
              '-y',
              '-hide_banner',
              '-loglevel',
              'error',
              '-i',
              inputPath,
              '-ss',
              String(start),
              '-t',
              String(expectedDur),
              '-map',
              '0:v:0',
              '-an',
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-crf',
              '18',
              '-pix_fmt',
              'yuv420p',
              '-vsync',
              'cfr',
              '-r',
              '30',
              '-fflags',
              '+genpts',
              '-movflags',
              '+faststart',
              fixPath,
            ],
            fixPath,
          );
        }
        try {
          fs.unlinkSync(outputPath);
        } catch {
          /* ignore */
        }
        fs.renameSync(fixPath, outputPath);
        finalDur = (await getMediaDuration(outUrl, projectId)) || expectedDur;
      } catch (fixErr) {
        console.warn('[trimVideo] 校正失败，沿用首次结果', fixErr);
        try {
          if (fs.existsSync(fixPath)) fs.unlinkSync(fixPath);
        } catch {
          /* ignore */
        }
        if (!(finalDur > 0)) finalDur = expectedDur;
      }
    }

    if (url.startsWith('http://') || url.startsWith('https://')) {
      try {
        fs.unlinkSync(inputPath);
      } catch {
        // ignore
      }
    }

    return { videoUrl: outUrl, durationSec: finalDur > 0 ? finalDur : expectedDur };
  }

  /**
   * 智能剪辑（仅分析）：检测画面变化明显的镜头，不导出文件。
   * 供胶片条预览 → 确认后再导出到画布对应模块。
   */
  async smartAnalyzeVideoShots(
    projectId: string | undefined,
    videoUrl: string,
    options?: {
      mode?: 'stable' | 'balanced' | 'sensitive';
      maxClips?: number;
      minClipSec?: number;
      withPosters?: boolean;
    },
  ): Promise<{
    segments: Array<{ startSec: number; endSec: number; score: number; posterUrl?: string }>;
    cutPoints: number[];
    durationSec: number;
    downgraded: boolean;
  }> {
    const url = (videoUrl || '').trim();
    if (!url) throw new Error('视频 URL 为空');
    const mode = options?.mode || 'balanced';
    const maxClips = Math.max(1, Math.min(60, Math.floor(Number(options?.maxClips) || 20)));
    const minClipSec = Math.max(0.4, Number(options?.minClipSec) || 0.8);
    const withPosters = options?.withPosters !== false;

    let inputPath: string;
    let tempInput: string | null = null;

    if (url.startsWith('local-resource://') || url.startsWith('file://')) {
      let filePath = url.replace(/^local-resource:\/\/+/, '').replace(/^file:\/\/+/, '');
      if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
      filePath = decodeURIComponent(filePath);
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new Error('视频文件不存在或无法访问');
      }
      inputPath = path.normalize(filePath);
    } else if (url.startsWith('http://') || url.startsWith('https://')) {
      const saveDir = await resolveSaveDir(projectId);
      const ext = guessVideoExtFromUrl(url);
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      tempInput = path.join(saveDir, `smart-analyze-input-${id}${ext}`).replace(/\\/g, '/');
      const resp = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 120000, proxy: false });
      fs.writeFileSync(tempInput, Buffer.from(resp.data));
      inputPath = tempInput;
    } else {
      throw new Error('不支持的视频 URL 格式');
    }

    const hasFfmpeg = await ensureFfmpegAvailable();
    if (!hasFfmpeg) {
      throw new Error('未检测到 ffmpeg，无法智能剪辑。请安装 ffmpeg 并添加到系统 PATH。');
    }

    try {
      const durationSec = await getMediaDuration(toLocalResourceUrl(inputPath), projectId);
      if (!(durationSec > 0.5)) throw new Error('无法读取视频时长');

      const events = await collectSceneChangeEvents(inputPath, 0.05);
      const selected = selectObviousChangeSegments(durationSec, events, {
        mode,
        maxClips,
        minClipSec,
      });
      if (!selected.segments.length) {
        throw new Error('未检测到画面变化明显的镜头');
      }

      const saveDir = await resolveSaveDir(projectId);
      const segments: Array<{ startSec: number; endSec: number; score: number; posterUrl?: string }> = [];
      for (let i = 0; i < selected.segments.length; i++) {
        const seg = selected.segments[i]!;
        let posterUrl: string | undefined;
        if (withPosters) {
          try {
            const t = seg.start + Math.min(0.2, (seg.end - seg.start) * 0.12);
            const id = `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
            const outPath = path.join(saveDir, `smart-seg-thumb-${id}.jpg`).replace(/\\/g, '/');
            await runFfmpegCaptureFrameAt(inputPath, outPath, t);
            if (fs.existsSync(outPath)) posterUrl = toLocalResourceUrl(outPath);
          } catch {
            // ignore thumb failure
          }
        }
        segments.push({
          startSec: seg.start,
          endSec: seg.end,
          score: seg.score,
          posterUrl,
        });
      }

      return {
        segments,
        cutPoints: selected.cutPoints,
        durationSec,
        downgraded: selected.downgraded,
      };
    } finally {
      if (tempInput) {
        try {
          fs.unlinkSync(tempInput);
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * 智能剪辑：场景切点检测 + 按段导出视频片段（不修改源文件）
   */
  async smartExtractVideoClips(
    projectId: string | undefined,
    videoUrl: string,
    options?: {
      mode?: 'stable' | 'balanced' | 'sensitive';
      maxClips?: number;
      minClipSec?: number;
      output?: 'clips' | 'keyframes';
    },
  ): Promise<{
    clips: Array<{ videoUrl: string; startSec: number; endSec: number; posterUrl?: string }>;
    keyframes?: Array<{ imageUrl: string; timeSec: number }>;
    cutPoints: number[];
    durationSec: number;
    downgraded: boolean;
  }> {
    const url = (videoUrl || '').trim();
    if (!url) throw new Error('视频 URL 为空');
    const mode = options?.mode || 'balanced';
    const maxClips = Math.max(1, Math.min(60, Math.floor(Number(options?.maxClips) || 20)));
    const minClipSec = Math.max(0.4, Number(options?.minClipSec) || 0.8);
    const outputKind = options?.output === 'keyframes' ? 'keyframes' : 'clips';

    let inputPath: string;
    let tempInput: string | null = null;

    if (url.startsWith('local-resource://') || url.startsWith('file://')) {
      let filePath = url.replace(/^local-resource:\/\/+/, '').replace(/^file:\/\/+/, '');
      if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
      filePath = decodeURIComponent(filePath);
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new Error('视频文件不存在或无法访问');
      }
      inputPath = path.normalize(filePath);
    } else if (url.startsWith('http://') || url.startsWith('https://')) {
      const saveDir = await resolveSaveDir(projectId);
      const ext = guessVideoExtFromUrl(url);
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      tempInput = path.join(saveDir, `smart-edit-input-${id}${ext}`).replace(/\\/g, '/');
      const resp = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 120000, proxy: false });
      fs.writeFileSync(tempInput, Buffer.from(resp.data));
      inputPath = tempInput;
    } else {
      throw new Error('不支持的视频 URL 格式');
    }

    const hasFfmpeg = await ensureFfmpegAvailable();
    if (!hasFfmpeg) {
      throw new Error('未检测到 ffmpeg，无法智能剪辑。请安装 ffmpeg 并添加到系统 PATH。');
    }

    try {
      const durationSec = await getMediaDuration(toLocalResourceUrl(inputPath), projectId);
      if (!(durationSec > 0.5)) throw new Error('无法读取视频时长');

      // 目标：只保留「画面变化明显」的镜头（硬切拆镜 + 按变化分数筛选，丢掉静景/说话头长镜）
      const events = await collectSceneChangeEvents(inputPath, 0.05);
      const selected = selectObviousChangeSegments(durationSec, events, {
        mode,
        maxClips,
        minClipSec,
      });
      const segments = selected.segments;
      const cutPoints = selected.cutPoints;
      const downgraded = selected.downgraded;

      if (!segments.length) {
        throw new Error('未检测到画面变化明显的镜头');
      }

      const saveDir = await resolveSaveDir(projectId);

      if (outputKind === 'keyframes') {
        // 关键帧：优先取变化峰值时刻（不是段头随便一帧）
        const peakTimes = [...events]
          .filter((e) => e.score >= (mode === 'stable' ? 0.28 : mode === 'sensitive' ? 0.14 : 0.2))
          .sort((a, b) => b.score - a.score)
          .slice(0, maxClips)
          .sort((a, b) => a.time - b.time);
        const times =
          peakTimes.length > 0
            ? peakTimes.map((e) => e.time)
            : segments.map((s) => s.start + Math.min(0.15, (s.end - s.start) * 0.1));

        const keyframes: Array<{ imageUrl: string; timeSec: number }> = [];
        for (let i = 0; i < times.length; i++) {
          const t = Math.min(Math.max(0, times[i]!), Math.max(0, durationSec - 0.05));
          const id = `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
          const outPath = path.join(saveDir, `smart-keyframe-${id}.jpg`).replace(/\\/g, '/');
          await runFfmpegCaptureFrameAt(inputPath, outPath, t);
          if (fs.existsSync(outPath)) {
            keyframes.push({ imageUrl: toLocalResourceUrl(outPath), timeSec: t });
          }
        }
        return { clips: [], keyframes, cutPoints, durationSec, downgraded };
      }

      const clips: Array<{ videoUrl: string; startSec: number; endSec: number; posterUrl?: string }> = [];
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]!;
        const id = `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
        const outPath = path.join(saveDir, `smart-clip-${id}.mp4`).replace(/\\/g, '/');
        await runFfmpegTrimVideo(inputPath, outPath, seg.start, seg.end);
        const posterPath = path.join(saveDir, `smart-clip-${id}-poster.jpg`).replace(/\\/g, '/');
        let posterUrl: string | undefined;
        try {
          await runFfmpegCapturePoster(outPath, posterPath);
          if (fs.existsSync(posterPath)) posterUrl = toLocalResourceUrl(posterPath);
        } catch {
          // ignore poster failure
        }
        clips.push({
          videoUrl: toLocalResourceUrl(outPath),
          startSec: seg.start,
          endSec: seg.end,
          posterUrl,
        });
      }

      return { clips, cutPoints, durationSec, downgraded };
    } finally {
      if (tempInput) {
        try {
          fs.unlinkSync(tempInput);
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * 视频画面裁剪：按归一化矩形 crop（相对源视频宽高 0–1），重编码后落盘并生成 poster。
   */
  async cropVideo(
    projectId: string | undefined,
    videoUrl: string,
    rect: { x: number; y: number; w: number; h: number },
    sourceWidth: number,
    sourceHeight: number,
  ): Promise<LocalVideoResourceResult> {
    const url = (videoUrl || '').trim();
    if (!url) throw new Error('视频 URL 为空');
    const sw = Number(sourceWidth);
    const sh = Number(sourceHeight);
    if (!Number.isFinite(sw) || !Number.isFinite(sh) || sw < 2 || sh < 2) {
      throw new Error('无效的视频尺寸');
    }
    const crop = normalizedRectToEvenCropPixels(rect, sw, sh);

    let inputPath: string;
    let shouldDeleteInput = false;

    if (url.startsWith('http://') || url.startsWith('https://')) {
      const saveDir = await resolveSaveDir(projectId);
      const ext = guessVideoExtFromUrl(url);
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      inputPath = path.join(saveDir, `video-crop-input-${id}${ext}`).replace(/\\/g, '/');
      const resp = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 120000, proxy: false });
      fs.writeFileSync(inputPath, Buffer.from(resp.data));
      shouldDeleteInput = true;
    } else {
      inputPath = await resolveLocalMediaFilePath(projectId, url);
    }

    const hasFfmpeg = await ensureFfmpegAvailable();
    if (!hasFfmpeg) {
      throw new Error('未检测到 ffmpeg，无法裁剪视频画面。请安装 ffmpeg 并添加到系统 PATH。');
    }

    const saveDir = await resolveSaveDir(projectId);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const outputPath = path.join(saveDir, `video-cropped-${id}.mp4`).replace(/\\/g, '/');

    try {
      await runFfmpegCropVideo(inputPath, outputPath, crop);
    } finally {
      if (shouldDeleteInput) {
        try {
          fs.unlinkSync(inputPath);
        } catch {
          // ignore
        }
      }
    }

    return this.createVideoResourceFromFile(projectId, outputPath);
  }

  /** 工程素材保存目录（供智能抠像等外部服务复用） */
  async getProjectSaveDir(projectId?: string): Promise<string> {
    return resolveSaveDir(projectId);
  }

  /**
   * 阿里云 VIAPI SegmentVideoBody 输入预检（≤1GB、≤2000 帧、格式 MP4/AVI/FLV/MOV）。
   */
  async precheckVideoForViapiSegment(
    inputPath: string,
  ): Promise<
    | { ok: true; durationSec: number; approxFrames: number; sizeBytes: number }
    | { ok: false; code: string; message: string }
  > {
    const normalized = path.normalize(inputPath);
    if (!fs.existsSync(normalized)) {
      return { ok: false, code: 'NOT_FOUND', message: '本地视频文件不存在' };
    }
    const sizeBytes = fs.statSync(normalized).size;
    if (sizeBytes <= 0) {
      return { ok: false, code: 'EMPTY_FILE', message: '视频文件为空' };
    }
    if (sizeBytes > 1024 * 1024 * 1024) {
      return {
        ok: false,
        code: 'FILE_TOO_LARGE',
        message: '视频超过 1GB，不符合阿里云智能抠像限制，请先裁剪或压缩后再试',
      };
    }
    const ext = path.extname(normalized).toLowerCase();
    const allowed = new Set(['.mp4', '.avi', '.flv', '.mov', '.m4v']);
    if (ext && !allowed.has(ext)) {
      return {
        ok: false,
        code: 'FORMAT',
        message: `视频格式 ${ext || '(未知)'} 不受支持。智能抠像仅支持 MP4、AVI、FLV、MOV`,
      };
    }

    const hasFfmpeg = await ensureFfmpegAvailable();
    if (!hasFfmpeg) {
      return {
        ok: false,
        code: 'NO_FFMPEG',
        message: '未检测到 ffmpeg，无法预检/合成透明视频。请安装 ffmpeg 并添加到系统 PATH。',
      };
    }

    const meta = await probeVideoBasicMeta(normalized);
    if (!(meta.durationSec > 0)) {
      return { ok: false, code: 'NO_DURATION', message: '无法读取视频时长，请更换素材后重试' };
    }
    if (meta.approxFrames > 2000) {
      return {
        ok: false,
        code: 'TOO_MANY_FRAMES',
        message: `视频约 ${meta.approxFrames} 帧，超过阿里云智能抠像上限 2000 帧（约 ${(meta.durationSec).toFixed(1)} 秒 @ ${meta.fps.toFixed(1)}fps）。请先裁剪缩短后再试`,
      };
    }
    return {
      ok: true,
      durationSec: meta.durationSec,
      approxFrames: meta.approxFrames,
      sizeBytes,
    };
  }

  /**
   * 原片 × mask → WebM VP9+alpha，并写入本地资源（hasAlpha）。
   */
  async composeMaskAlphaWebm(
    projectId: string | undefined,
    sourcePath: string,
    maskPath: string,
  ): Promise<LocalVideoResourceResult> {
    const hasFfmpeg = await ensureFfmpegAvailable();
    if (!hasFfmpeg) {
      throw new Error('未检测到 ffmpeg，无法合成透明视频。请安装 ffmpeg 并添加到系统 PATH。');
    }
    const saveDir = await resolveSaveDir(projectId);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const outputPath = path.join(saveDir, `video-smart-matting-${id}.webm`).replace(/\\/g, '/');
    await runFfmpegMaskAlphaVideo(sourcePath, maskPath, outputPath);
    return this.createVideoResourceFromFile(projectId, outputPath, { hasAlpha: true });
  }

  /**
   * 色度抠像：按键色去除背景，导出 WebM（VP9 + alpha）并生成 poster。
   */
  async chromaKeyVideo(
    projectId: string | undefined,
    videoUrl: string,
    options: { colorHex: string; similarity?: number; blend?: number },
  ): Promise<LocalVideoResourceResult> {
    const url = (videoUrl || '').trim();
    if (!url) throw new Error('视频 URL 为空');
    const colorHex = normalizeChromaKeyHex(options?.colorHex || '#00FF00');
    const similarity = Math.min(1, Math.max(0.01, Number(options?.similarity) || 0.15));
    const blend = Math.min(1, Math.max(0, Number(options?.blend) || 0.05));

    let inputPath: string;
    let shouldDeleteInput = false;

    if (url.startsWith('http://') || url.startsWith('https://')) {
      const saveDir = await resolveSaveDir(projectId);
      const ext = guessVideoExtFromUrl(url);
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      inputPath = path.join(saveDir, `video-chroma-input-${id}${ext}`).replace(/\\/g, '/');
      const resp = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 120000, proxy: false });
      fs.writeFileSync(inputPath, Buffer.from(resp.data));
      shouldDeleteInput = true;
    } else {
      inputPath = await resolveLocalMediaFilePath(projectId, url);
    }

    const hasFfmpeg = await ensureFfmpegAvailable();
    if (!hasFfmpeg) {
      throw new Error('未检测到 ffmpeg，无法进行色度抠像。请安装 ffmpeg 并添加到系统 PATH。');
    }

    const saveDir = await resolveSaveDir(projectId);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const outputPath = path.join(saveDir, `video-chromakey-${id}.webm`).replace(/\\/g, '/');

    try {
      await runFfmpegChromaKeyVideo(inputPath, outputPath, { colorHex: `#${colorHex}`, similarity, blend });
    } finally {
      if (shouldDeleteInput) {
        try {
          fs.unlinkSync(inputPath);
        } catch {
          // ignore
        }
      }
    }

    return this.createVideoResourceFromFile(projectId, outputPath, { hasAlpha: true });
  }

  /**
   * 时间轴导出视频：按 videoClips 顺序拼接视频/图片片段，合并音频轨道（剪映风格）
   */
  async exportTimelineVideo(
    projectId: string | undefined,
    videoClips: Array<{
      type: string;
      src: string;
      duration: number;
      startTime: number;
      trimStart?: number;
      trimEnd?: number;
      lockTrim?: boolean;
      name?: string;
      /** 合成画面布局（归一化）；仅作用于本导出的主轨顺序拼接 */
      layout?: ClipLayout;
      /** 源画面裁剪（归一化边距）；在 scale/pad 前应用 ffmpeg crop */
      crop?: ClipCrop;
    }>,
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
    outputPath: string,
    options?: { videoTrackVolume?: number; videoTrackMuted?: boolean; audioTrackVolume?: number[]; audioTrackMuted?: boolean[]; outputWidth?: number; outputHeight?: number }
  ): Promise<{ videoPath: string; hasAudio: boolean }> {
    // EXPORT_GAP: 本函数只顺序拼接传入的 videoClips（通常为 videoTracks[0]），
    // 多轨叠放/PiP 合成未接入；各 clip.layout / crop 会参与单段 crop→pad/scale。
    // 上层轨的 layout/crop 仅预览生效，导出未合成。
    const hasFfmpeg = await ensureFfmpegAvailable();
    if (!hasFfmpeg) {
      throw new Error('未检测到 ffmpeg，无法导出视频。请安装 ffmpeg 并添加到系统 PATH。');
    }
    const saveDir = await resolveSaveDir(projectId);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const segmentDir = path.join(saveDir, `timeline-export-${id}`).replace(/\\/g, '/');
    fs.mkdirSync(segmentDir, { recursive: true });
    const tempPaths: string[] = [];
    const cleanup = () => {
      try {
        if (fs.existsSync(segmentDir)) fs.rmSync(segmentDir, { recursive: true });
      } catch {
        // ignore
      }
    };
    try {
      const sortedClips = [...videoClips].filter((c) => c.type === 'video' || c.type === 'image').sort((a, b) => a.startTime - b.startTime);
      if (sortedClips.length === 0) throw new Error('没有可导出的视频或图片素材');
      const ffmpegBin = resolveFfmpegPath();
      const outW = Math.max(2, Math.round(Number(options?.outputWidth) || 1280));
      const outH = Math.max(2, Math.round(Number(options?.outputHeight) || 720));
      const scaleFilter = buildClipLayoutScaleFilter(outW, outH, null);
      const videoTrackMuted = options?.videoTrackMuted ?? false;
      const videoTrackVolume = Math.max(0, Math.min(2, options?.videoTrackVolume ?? 1));
      const audioTrackMuted = options?.audioTrackMuted ?? [];
      const audioTrackVolume = (options?.audioTrackVolume ?? []).map((v) => Math.max(0, Math.min(3, v ?? 1)));
      const segmentPaths: string[] = [];
      let timelineCursor = 0;
      // 镜间空隙 / 成片偏短：有前片一律冻末帧（不设时长上限）；仅片头无前片时允许黑场
      const GAP_EPS = 0.05;
      const runExportFfmpeg = (args: string[]): Promise<void> =>
        new Promise((resolve, reject) => {
          const child = spawn(ffmpegBin, args, { windowsHide: true });
          let stderr = '';
          child.stderr.on('data', (chunk) => { stderr += String(chunk || ''); });
          child.on('error', reject);
          child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr || `ffmpeg exited ${code}`))));
        });
      /** 仅片头（无前片可冻）使用 */
      const makeBlackSegment = async (gapSec: number, idxLabel: string): Promise<string> => {
        const gapPath = path.join(segmentDir, `gap-${idxLabel}.mp4`).replace(/\\/g, '/');
        await runExportFfmpeg([
          '-y', '-hide_banner', '-loglevel', 'error',
          '-f', 'lavfi', '-i', `color=c=black:s=${outW}x${outH}:r=30`,
          '-t', String(Math.max(0.01, gapSec)),
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-an',
          gapPath,
        ]);
        return gapPath;
      };
      /** tpad 克隆末帧，把空隙并入前片（少一次 concat 接缝） */
      const extendSegmentWithTpad = async (
        fromSegPath: string,
        extraSec: number,
        outPath: string,
      ): Promise<void> => {
        const t = Math.max(0.01, extraSec);
        await runExportFfmpeg([
          '-y', '-hide_banner', '-loglevel', 'error',
          '-i', fromSegPath,
          '-vf', `tpad=stop_mode=clone:stop_duration=${t.toFixed(4)}`,
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-an',
          outPath,
        ]);
      };
      /** 抽近末帧再 loop（略早于片尾，避开编码器尾黑帧）；失败则抛错，不回退黑场 */
      const makeFreezeFromLastFrame = async (
        fromSegPath: string,
        gapSec: number,
        idxLabel: string,
      ): Promise<string> => {
        const framePath = path.join(segmentDir, `hold-frame-${idxLabel}.png`).replace(/\\/g, '/');
        const holdPath = path.join(segmentDir, `hold-${idxLabel}.mp4`).replace(/\\/g, '/');
        const t = Math.max(0.01, gapSec);
        const dur = await getMediaDuration(fromSegPath, projectId).catch(() => 0);
        const seekNearEnd = dur > 0.2 ? Math.max(0, dur - 0.12) : Math.max(0, dur > 0.08 ? dur - 0.04 : 0);
        const extractAttempts: string[][] = [
          ['-ss', String(seekNearEnd), '-i', fromSegPath, '-frames:v', '1', '-q:v', '2', framePath],
          ['-sseof', '-0.12', '-i', fromSegPath, '-frames:v', '1', '-q:v', '2', framePath],
          ['-sseof', '-0.04', '-i', fromSegPath, '-frames:v', '1', '-update', '1', framePath],
          ['-i', fromSegPath, '-vf', 'select=eq(n\\,0)', '-frames:v', '1', '-q:v', '2', framePath],
        ];
        let extracted = false;
        let lastErr: unknown;
        for (const attempt of extractAttempts) {
          try {
            await runExportFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', ...attempt]);
            if (fs.existsSync(framePath) && fs.statSync(framePath).size > 0) {
              extracted = true;
              break;
            }
          } catch (e) {
            lastErr = e;
          }
        }
        if (!extracted) {
          throw lastErr instanceof Error
            ? lastErr
            : new Error(`无法从前片提取冻帧: ${fromSegPath}`);
        }
        await runExportFfmpeg([
          '-y', '-hide_banner', '-loglevel', 'error',
          '-loop', '1', '-i', framePath,
          '-t', String(t),
          '-vf', scaleFilter,
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-an',
          holdPath,
        ]);
        return holdPath;
      };
      /**
       * 有前片：冻帧填空隙（优先 tpad 并入前片；失败再抽帧垫片）。禁止回退黑场。
       * 无前片：仅片头允许黑场。
       */
      const fillTimelineGap = async (
        gapSec: number,
        idxLabel: string,
        prevSegPath: string | null,
      ): Promise<void> => {
        const t = Math.max(0.01, gapSec);
        if (!prevSegPath) {
          segmentPaths.push(await makeBlackSegment(t, idxLabel));
          return;
        }
        const extendedPath = path.join(segmentDir, `ext-${idxLabel}.mp4`).replace(/\\/g, '/');
        try {
          await extendSegmentWithTpad(prevSegPath, t, extendedPath);
          const idx = segmentPaths.lastIndexOf(prevSegPath);
          if (idx >= 0) segmentPaths[idx] = extendedPath;
          else segmentPaths.push(extendedPath);
          return;
        } catch (e) {
          console.warn('[exportTimelineVideo] tpad 并入前片失败，改抽帧冻帧:', e);
        }
        segmentPaths.push(await makeFreezeFromLastFrame(prevSegPath, t, idxLabel));
      };
      for (let i = 0; i < sortedClips.length; i++) {
        const clip = sortedClips[i];
        const clipDuration = await resolveTimelineClipDuration(clip, projectId);
        const trimStart = clip.trimStart ?? 0;
        const trimEnd = clip.trimEnd ?? clipDuration;
        const segDur = Math.max(0.01, trimEnd - trimStart);
        const clipStart = Math.max(0, Number(clip.startTime) || 0);
        // 尊重时间轴 startTime 空隙；有前片冻帧，勿插黑
        const gap = clipStart - timelineCursor;
        if (gap > GAP_EPS) {
          const prevSeg = segmentPaths.length > 0 ? segmentPaths[segmentPaths.length - 1] : null;
          await fillTimelineGap(gap, `pre-${String(i).padStart(3, '0')}`, prevSeg);
          timelineCursor += gap;
        }
        let inputPath: string;
        const url = (clip.src || '').trim();
        if (url.startsWith('local-resource://') || url.startsWith('file://')) {
          let filePath = url.replace(/^local-resource:\/\/+/, '').replace(/^file:\/\/+/, '');
          if (filePath.includes('?')) filePath = filePath.split('?')[0];
          filePath = filePath.replace(/^\/+/, '');
          if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
          try {
            filePath = decodeURIComponent(filePath);
          } catch {
            // ignore
          }
          if (filePath.match(/^\/[a-zA-Z]:/)) filePath = filePath.substring(1);
          let normalizedPath = path.normalize(filePath);
          if (!path.isAbsolute(normalizedPath)) {
            normalizedPath = path.resolve(app.getPath('userData'), normalizedPath);
          }
          if (!fs.existsSync(normalizedPath) || !fs.statSync(normalizedPath).isFile()) {
            throw new Error(`素材不存在: ${(clip as { name?: string }).name ?? clip.type}`);
          }
          inputPath = normalizedPath;
        } else if (url.startsWith('http://') || url.startsWith('https://')) {
          const ext = clip.type === 'image' ? (path.extname(new URL(url).pathname) || '.png') : guessVideoExtFromUrl(url);
          inputPath = path.join(segmentDir, `dl-${i}${ext}`).replace(/\\/g, '/');
          const resp = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 120000, proxy: false });
          fs.writeFileSync(inputPath, Buffer.from(resp.data));
          tempPaths.push(inputPath);
        } else {
          throw new Error('不支持的 URL 格式');
        }
        const segPath = path.join(segmentDir, `seg-${String(i).padStart(3, '0')}.mp4`).replace(/\\/g, '/');
        // 成片短于规划 trim 时按实际可切长度编码，并用产出时长推进游标，避免 concat 比时间轴短导致后续镜相对原曲前移
        let encodeDur = segDur;
        if (clip.type !== 'image') {
          const mediaDur = await getMediaDuration(
            url.startsWith('http') ? url : inputPath,
            projectId,
          ).catch(() => 0);
          if (mediaDur > 0.05) {
            const available = Math.max(0.01, mediaDur - trimStart);
            if (encodeDur > available + 0.02) encodeDur = available;
          }
        }
        // 规划长于成片：tpad 克隆末帧；并前瞻到下一镜 startTime，把镜间空隙直接冻进本片，避免另插黑垫片
        const inlinePadSec =
          clip.type !== 'image' && segDur > encodeDur + 0.02 ? segDur - encodeDur : 0;
        let tailHoldSec = 0;
        if (i + 1 < sortedClips.length) {
          const nextStart = Math.max(0, Number(sortedClips[i + 1].startTime) || 0);
          const plannedEnd = clipStart + segDur;
          if (nextStart > plannedEnd + GAP_EPS) {
            tailHoldSec = nextStart - plannedEnd;
          }
        }
        const totalClonePad = inlinePadSec + tailHoldSec;
        // 源 crop（若有）→ layout scale/pad；偶数像素由 crop 表达式保证
        const clipScaleFilter =
          buildClipCropFilterPrefix(clip.crop) +
          buildClipLayoutScaleFilter(outW, outH, clip.layout);
        const videoVf =
          totalClonePad > 0.02
            ? `${clipScaleFilter},tpad=stop_mode=clone:stop_duration=${totalClonePad.toFixed(4)}`
            : clipScaleFilter;
        const imageOutDur = encodeDur + tailHoldSec;
        if (clip.type === 'image') {
          await runExportFfmpeg([
            '-y', '-hide_banner', '-loglevel', 'error',
            '-loop', '1', '-i', inputPath,
            '-t', String(Math.max(0.01, imageOutDur)),
            '-vf', clipScaleFilter,
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30',
            segPath,
          ]);
        } else {
          // -t 放在 -i 前限制读入；勿再加输出 -t，否则会裁掉 tpad 冻帧
          await runExportFfmpeg([
            '-y', '-hide_banner', '-loglevel', 'error',
            '-ss', String(trimStart), '-t', String(encodeDur), '-i', inputPath,
            '-vf', videoVf,
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-an',
            segPath,
          ]);
        }
        segmentPaths.push(segPath);
        const targetDur = segDur + tailHoldSec;
        let advanced = clip.type === 'image' ? imageOutDur : encodeDur + totalClonePad;
        if (clip.type !== 'image') {
          const produced = await getMediaDuration(segPath, projectId).catch(() => 0);
          if (produced > 0.05) advanced = produced;
        }
        // 编码后仍短于目标（含镜间冻帧）：并入前片冻帧，禁止黑场
        const padToTarget = targetDur - advanced;
        if (padToTarget > GAP_EPS) {
          await fillTimelineGap(padToTarget, `pad-${String(i).padStart(3, '0')}`, segPath);
          advanced += padToTarget;
        }
        timelineCursor = Math.max(timelineCursor, clipStart) + advanced;
      }

      const listPath = path.join(segmentDir, 'concat.txt').replace(/\\/g, '/');
      const listContent = segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
      fs.writeFileSync(listPath, listContent, 'utf8');
      const tempVideoPath = path.join(segmentDir, 'video-only.mp4').replace(/\\/g, '/');
      await new Promise<void>((resolve, reject) => {
        const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', tempVideoPath];
        const child = spawn(ffmpegBin, args, { windowsHide: true });
        let stderr = '';
        child.stderr.on('data', (chunk) => { stderr += String(chunk || ''); });
        child.on('error', reject);
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr || `ffmpeg exited ${code}`))));
      });

      const resolveUrlToPath = async (url: string, clipType: string, idx: number): Promise<string> => {
        const u = (url || '').trim();
        if (u.startsWith('local-resource://') || u.startsWith('file://')) {
          let filePath = u.replace(/^local-resource:\/\/+/, '').replace(/^file:\/\/+/, '');
          if (filePath.includes('?')) filePath = filePath.split('?')[0];
          filePath = filePath.replace(/^\/+/, '');
          if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
          try {
            filePath = decodeURIComponent(filePath);
          } catch {
            // ignore
          }
          if (filePath.match(/^\/[a-zA-Z]:/)) filePath = filePath.substring(1);
          let normalizedPath = path.normalize(filePath);
          if (!path.isAbsolute(normalizedPath)) {
            normalizedPath = path.resolve(app.getPath('userData'), normalizedPath);
          }
          if (!fs.existsSync(normalizedPath) || !fs.statSync(normalizedPath).isFile()) {
            throw new Error(`素材不存在: ${clipType}`);
          }
          return normalizedPath;
        }
        if (u.startsWith('http://') || u.startsWith('https://')) {
          const ext = clipType === 'image' ? (path.extname(new URL(u).pathname) || '.png') : guessVideoExtFromUrl(u);
          const dest = path.join(segmentDir, `dl-audio-${idx}${ext}`).replace(/\\/g, '/');
          const resp = await axios.get<ArrayBuffer>(u, { responseType: 'arraybuffer', timeout: 120000, proxy: false });
          fs.writeFileSync(dest, Buffer.from(resp.data));
          tempPaths.push(dest);
          return dest;
        }
        throw new Error('不支持的 URL 格式');
      };

      let totalDuration = 0;
      const allClips = [...sortedClips, ...audioTracks.flat()];
      for (const c of allClips) {
        const d = await resolveTimelineClipDuration(c, projectId);
        const end = c.startTime + ((c.trimEnd ?? d) - (c.trimStart ?? 0));
        totalDuration = Math.max(totalDuration, end);
      }
      totalDuration = Math.max(totalDuration, 0.01);

      interface AudioSource {
        inputPath: string;
        trimStart: number;
        trimEnd: number;
        startTime: number;
        volume: number;
      }
      const audioSources: AudioSource[] = [];

      let audioExtractCounter = 0;
      const extractAudioToTemp = async (inputPath: string, trimStart: number, trimEnd: number, volume: number): Promise<string | null> => {
        const segDur = trimEnd - trimStart;
        const idx = audioExtractCounter++;
        const outPath = path.join(segmentDir, `audio-extract-${idx}.wav`).replace(/\\/g, '/');
        let lastStderr = '';
        const runFfmpeg = (args: string[]): Promise<boolean> =>
          new Promise((res) => {
            const child = spawn(ffmpegBin, args, { windowsHide: true });
            let stderr = '';
            child.stderr.on('data', (chunk) => { stderr += String(chunk || ''); });
            child.on('close', (code) => {
              lastStderr = stderr;
              res(code === 0 && fs.existsSync(outPath));
            });
          });
        const encArgs = ['-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', outPath];
        const mapArg = '-map';
        const mapVal = '0:a:0';
        const baseArgs = (seekFirst: boolean) =>
          seekFirst
            ? ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(trimStart), '-i', inputPath, '-t', String(segDur)]
            : ['-y', '-hide_banner', '-loglevel', 'error', '-i', inputPath, '-ss', String(trimStart), '-t', String(segDur)];
        for (const seekFirst of [false, true]) {
          const args1 = [...baseArgs(seekFirst), mapArg, mapVal, '-vn', '-af', `volume=${volume}`, ...encArgs];
          if (await runFfmpeg(args1)) {
            tempPaths.push(outPath);
            return outPath;
          }
        }
        for (const seekFirst of [false, true]) {
          const args2 = [...baseArgs(seekFirst), mapArg, mapVal, '-vn', ...encArgs];
          if (await runFfmpeg(args2)) {
            tempPaths.push(outPath);
            return outPath;
          }
        }
        for (const seekFirst of [false, true]) {
          const args3 = [...baseArgs(seekFirst), '-vn', '-af', `volume=${volume}`, ...encArgs];
          if (await runFfmpeg(args3)) {
            tempPaths.push(outPath);
            return outPath;
          }
        }
        if (lastStderr) console.warn('[exportTimelineVideo] 音频提取失败:', lastStderr.slice(-300));
        return null;
      };

      for (const clip of sortedClips) {
        if (clip.type !== 'video' || videoTrackMuted || videoTrackVolume <= 0) continue;
        const clipDuration = await resolveTimelineClipDuration(clip, projectId);
        const trimStart = clip.trimStart ?? 0;
        const trimEnd = clip.trimEnd ?? clipDuration;
        if (trimEnd <= trimStart) continue;
        try {
          const inputPath = await resolveUrlToPath(clip.src, 'video', audioSources.length);
          const extracted = await extractAudioToTemp(inputPath, trimStart, trimEnd, videoTrackVolume);
          if (extracted) {
            audioSources.push({
              inputPath: extracted,
              trimStart: 0,
              trimEnd: trimEnd - trimStart,
              startTime: clip.startTime,
              volume: 1,
            });
          }
        } catch {
          // 视频可能无音轨，跳过
        }
      }

      for (let trackIdx = 0; trackIdx < audioTracks.length; trackIdx++) {
        if (audioTrackMuted[trackIdx]) continue;
        const vol = audioTrackVolume[trackIdx] ?? 1;
        if (vol <= 0) continue;
        for (const clip of audioTracks[trackIdx]) {
          const clipDuration = await resolveTimelineClipDuration(clip, projectId);
          const trimStart = clip.trimStart ?? 0;
          const trimEnd = clip.trimEnd ?? clipDuration;
          if (trimEnd <= trimStart) continue;
          try {
            const inputPath = await resolveUrlToPath(clip.src, 'audio', audioSources.length);
            const clipVol = Math.max(0, Math.min(3, Number((clip as { volume?: number }).volume) || 1));
            const effectiveVol = Math.min(3, vol * clipVol);
            const extracted = await extractAudioToTemp(inputPath, trimStart, trimEnd, effectiveVol);
            if (extracted) {
              audioSources.push({
                inputPath: extracted,
                trimStart: 0,
                trimEnd: trimEnd - trimStart,
                startTime: clip.startTime,
                volume: 1,
              });
            }
          } catch (e) {
            console.warn('[exportTimelineVideo] 跳过音频片段:', e);
          }
        }
      }

      if (audioSources.length === 0) {
        console.warn('[exportTimelineVideo] 无可用音源，导出视频将无声音。请确认：1) 视频轨道未静音且音量>0；2) 源视频/音频文件包含音轨');
      }
      if (audioSources.length > 0) {
        const mixInputs: string[] = [];
        const mixFilters: string[] = [];
        for (let i = 0; i < audioSources.length; i++) {
          const s = audioSources[i];
          mixInputs.push('-i', s.inputPath);
          const delayMs = Math.round(s.startTime * 1000);
          mixFilters.push(`[${i}:a]adelay=${delayMs}|${delayMs},apad=whole_dur=${totalDuration}[a${i}]`);
        }
        const amixInputs = audioSources.map((_, i) => `[a${i}]`).join('');
        const filterComplex = mixFilters.join(';') + ';' + amixInputs + `amix=inputs=${audioSources.length}:duration=longest[aout]`;
        const mixedAudioPath = path.join(segmentDir, 'mixed-audio.aac').replace(/\\/g, '/');
        await new Promise<void>((resolve, reject) => {
          const args = [
            '-y', '-hide_banner', '-loglevel', 'error',
            ...mixInputs,
            '-filter_complex', filterComplex,
            '-map', '[aout]',
            '-t', String(totalDuration),
            '-ac', '2',
            '-ar', '44100',
            '-c:a', 'aac',
            '-b:a', '192k',
            mixedAudioPath,
          ];
          const child = spawn(ffmpegBin, args, { windowsHide: true });
          let stderr = '';
          child.stderr.on('data', (chunk) => { stderr += String(chunk || ''); });
          child.on('error', reject);
          child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr || `ffmpeg exited ${code}`))));
        });

        await new Promise<void>((resolve, reject) => {
          const args = [
            '-y', '-hide_banner', '-loglevel', 'error',
            '-i', tempVideoPath,
            '-i', mixedAudioPath,
            '-c:v', 'copy',
            '-map', '0:v',
            '-map', '1:a',
            '-shortest',
            outputPath,
          ];
          const child = spawn(ffmpegBin, args, { windowsHide: true });
          let stderr = '';
          child.stderr.on('data', (chunk) => { stderr += String(chunk || ''); });
          child.on('error', reject);
          child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr || `ffmpeg exited ${code}`))));
        });
      } else {
        fs.copyFileSync(tempVideoPath, outputPath);
      }
      return { videoPath: outputPath, hasAudio: audioSources.length > 0 };
    } finally {
      cleanup();
    }
  }

  /**
   * 人声/背景音分离：使用 Demucs（htdemucs 4-stems）
   * @param projectId 项目 ID
   * @param audioUrl 音频 URL（local-resource://、file://、http(s)://）
   * @param mode 'vocals' 人声 | 'accompaniment' 背景音（drums+bass+other 混合）
   */
  async separateVocalsFromAudio(
    projectId: string | undefined,
    audioUrl: string,
    mode: 'vocals' | 'accompaniment'
  ): Promise<{ audioUrl: string }> {
    const url = (audioUrl || '').trim();
    if (!url) throw new Error('音频 URL 为空');

    let inputPath: string;

    if (url.startsWith('local-resource://') || url.startsWith('file://')) {
      let filePath = url.replace(/^local-resource:\/\/+/, '').replace(/^file:\/\/+/, '');
      if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
      filePath = decodeURIComponent(filePath);
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new Error('音频文件不存在或无法访问');
      }
      inputPath = path.normalize(filePath);
    } else if (url.startsWith('http://') || url.startsWith('https://')) {
      const saveDir = await resolveSaveDir(projectId);
      const ext = path.extname(new URL(url).pathname || '') || '.mp3';
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      inputPath = path.join(saveDir, `audio-sep-input-${id}${ext}`).replace(/\\/g, '/');
      const resp = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 120000, proxy: false });
      fs.writeFileSync(inputPath, Buffer.from(resp.data));
    } else {
      throw new Error('不支持的音频 URL 格式');
    }

    const hasDemucs = await ensureDemucsAvailable();
    if (!hasDemucs) {
      throw new Error(
        '未检测到 Demucs，无法进行人声分离。请安装：pip install demucs，并确保 python 在 PATH 中；或使用已打包 Demucs 的 Aixflow 安装包。'
      );
    }

    const saveDir = await resolveSaveDir(projectId);
    // 使用系统临时目录（纯 ASCII 路径），避免中文路径导致 Python/torchaudio 编码错误
    const tempBase = app.getPath('temp');
    const tempDir = path.join(tempBase, `nexflow-demucs-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const inputExt = path.extname(inputPath) || '.mp3';
    const tempInputPath = path.join(tempDir, `input${inputExt}`);
    fs.copyFileSync(inputPath, tempInputPath);

    try {
      await runDemucsSeparate(tempInputPath, tempDir);
      const stemDir = path.join(tempDir, 'htdemucs', path.basename(tempInputPath, inputExt));
      const stemFile = mode === 'vocals' ? 'vocals.wav' : 'no_vocals.wav';
      const wavPath = path.join(stemDir, stemFile);
      if (!fs.existsSync(wavPath)) {
        throw new Error(`Demucs 未生成 ${stemFile}，请检查输入音频格式`);
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const outputPath = path.join(saveDir, `sep-${mode}-${id}.mp3`).replace(/\\/g, '/');
      await runFfmpegExtractAudio(wavPath, outputPath);
      return { audioUrl: toLocalResourceUrl(outputPath) };
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      if (url.startsWith('http://') || url.startsWith('https://')) {
        try {
          fs.unlinkSync(inputPath);
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * @deprecated 业务入口已改走云端 fun-asr（见 dashscopeFileAsr / IPC transcribe-speech-from-audio-url）。
   * 保留本地 whisper.cpp 实现供诊断；勿从新代码调用。
   */
  async transcribeSpeechFromAudioUrl(
    projectId: string | undefined,
    audioUrl: string,
    language?: string
  ): Promise<{ text: string }> {
    const { text } = await this.transcribeSpeechSegmentsFromAudioUrl(projectId, audioUrl, language);
    return { text };
  }

  /**
   * @deprecated 业务入口已改走云端 fun-asr（见 transcribeSpeechSegmentsViaFunAsr）。
   * 本地 Whisper 分段转写；勿从新代码调用。
   */
  async transcribeSpeechSegmentsFromAudioUrl(
    projectId: string | undefined,
    audioUrl: string,
    language?: string
  ): Promise<{ text: string; segments: Array<{ text: string; startSec: number; endSec: number }> }> {
    const hasFfmpeg = await ensureFfmpegAvailable();
    if (!hasFfmpeg) {
      throw new Error('未检测到 ffmpeg，无法预处理音频。');
    }
    await ensureWhisperReady();
    const url = (audioUrl || '').trim();
    if (!url) throw new Error('音频 URL 为空');

    let inputPath: string;
    const deleteHttpDownload = url.startsWith('http://') || url.startsWith('https://');

    if (deleteHttpDownload) {
      const saveDir = await resolveSaveDir(projectId);
      const ext = path.extname(new URL(url).pathname || '') || '.mp3';
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      inputPath = path.join(saveDir, `whisper-src-${id}${ext}`).replace(/\\/g, '/');
      const resp = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 300000, proxy: false });
      fs.writeFileSync(inputPath, Buffer.from(resp.data));
    } else {
      inputPath = await resolveLocalMediaFilePath(projectId, url);
    }

    const whisperBin = resolveWhisperCppBinaryPath();
    const modelPath = resolveWhisperModelPath();
    const tempBase = app.getPath('temp');
    const jobDir = path.join(tempBase, `nexflow-whisper-${Date.now()}`);
    fs.mkdirSync(jobDir, { recursive: true });
    const wavPath = path.join(jobDir, 'input.wav').replace(/\\/g, '/');
    const lang = (language || 'auto').trim();
    const { whisperLang, toSimplifiedChinese, simplifiedPrompt } = resolveWhisperTranscribeLang(lang);

    try {
      await runFfmpegTranscodeWhisperWav(inputPath, wavPath);
      let { text, segments } = await runWhisperCppToSegments(
        whisperBin,
        modelPath,
        wavPath,
        whisperLang,
        jobDir,
        simplifiedPrompt ? { initialPrompt: simplifiedPrompt } : undefined
      );
      if (toSimplifiedChinese && text) {
        try {
          text = toSimplifiedChineseText(text);
        } catch (e) {
          console.warn('[transcribe] 繁简转换失败，保留 Whisper 原文:', e);
        }
      }
      if (toSimplifiedChinese && segments.length > 0) {
        segments = segments.map((s) => {
          try {
            return { ...s, text: s.text ? toSimplifiedChineseText(s.text) : s.text };
          } catch {
            return s;
          }
        });
      }
      return { text, segments };
    } finally {
      try {
        fs.rmSync(jobDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      if (deleteHttpDownload) {
        try {
          fs.unlinkSync(inputPath);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

async function ensureDemucsAvailable(): Promise<boolean> {
  const bundled = getBundledDemucsPath();
  if (bundled) {
    return new Promise<boolean>((resolve) => {
      const child = spawn(bundled, ['--help'], { windowsHide: true, shell: false });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    });
  }
  return new Promise<boolean>((resolve) => {
    const child = spawn('python', ['-m', 'demucs', '--help'], { windowsHide: true, shell: false });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

async function runDemucsSeparate(inputPath: string, outputDir: string): Promise<void> {
  const bundled = getBundledDemucsPath();
  const args = bundled
    ? ['-n', 'htdemucs', '--two-stems', 'vocals', inputPath, '-o', outputDir]
    : ['-m', 'demucs', '-n', 'htdemucs', '--two-stems', 'vocals', inputPath, '-o', outputDir];
  const cmd = bundled ? bundled : 'python';

  return new Promise<void>((resolve, reject) => {
    const child = trackAudioJobChild(spawn(cmd, args, { windowsHide: true, shell: false }));
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code, signal) => {
      if (code === 0) resolve();
      else if (signal === 'SIGKILL') reject(makeAudioJobAbortError());
      else reject(new Error(stderr || `demucs exited with code ${code}`));
    });
  });
}

export const localResourceManager = new LocalResourceManager();
