import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { spawn, execFileSync } from 'child_process';
import os from 'os';
import axios from 'axios';
import * as OpenCC from 'opencc-js';
import { getProjectFolderPath, isLocalResourcePathAllowed } from '../utils/projectFolderHelper.js';
import { buildYoutubeYtDlpClientArgs, buildYoutubeYtDlpSpeedArgs, runYoutubeYtDlpAdaptive } from './videoScraper.js';
import { listWhisperSearchRoots, ensureWhisperReady } from './localWhisperEngine.js';

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
}

let cachedSharp: any = null;
let sharpResolved = false;
const MAX_SHARP_CONCURRENCY = 20;
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

async function runSharpTask<T>(task: () => Promise<T>): Promise<T> {
  if (sharpQueuePaused) {
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
async function resolveLocalMediaFilePath(projectId: string | undefined, urlOrPath: string): Promise<string> {
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
  tinyPath: string
): Promise<{ bytesPreview: number; bytesTiny: number; width?: number; height?: number; avgColorHex?: string }> {
  const sharpMod = await getSharp();
  if (!sharpMod) {
    fs.copyFileSync(originalPath, previewPath);
    fs.copyFileSync(originalPath, tinyPath);
    const stat = fs.statSync(previewPath);
    const tinyStat = fs.statSync(tinyPath);
    return { bytesPreview: stat.size, bytesTiny: tinyStat.size, avgColorHex: '#5c5c5c' };
  }
  return runSharpTask(async () => {
    const sharp = sharpMod.default || sharpMod;
    const image = sharp(originalPath, { failOn: 'none' });
    const metadata = await image.metadata();

    await image
      .clone()
      .resize({
        width: 1280,
        height: 1280,
        ...RESIZE_PRESET,
      })
      .jpeg({
        quality: 72,
        mozjpeg: true,
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
        quality: 50,
        mozjpeg: true,
        chromaSubsampling: '4:2:0',
      })
      .toFile(tinyPath);

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
    };
  });
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

async function runFfmpegCapturePoster(inputPath: string, posterPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ffmpegBin = resolveFfmpegPath();
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      '0',
      '-i',
      inputPath,
      '-frames:v',
      '1',
      '-vf',
      'scale=640:-2:force_original_aspect_ratio=decrease',
      posterPath,
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
    const child = spawn(ffmpegBin, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) resolve();
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
  const args = ['-m', modelPath, '-f', wavPath, '-otxt'];
  if (language && language !== 'auto') {
    args.push('-l', language);
  }
  if (opts?.initialPrompt) {
    args.push('--prompt', opts.initialPrompt);
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(whisperBin, args, { cwd: workingDir, windowsHide: true, shell: false });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().slice(-4000) || `whisper.cpp 退出码 ${code}`));
    });
  });
  const baseTxt = `${path.basename(wavPath)}.txt`;
  const txtPath = path.join(workingDir, baseTxt);
  if (!fs.existsSync(txtPath)) {
    throw new Error(`未生成转写结果文件: ${baseTxt}`);
  }
  return fs.readFileSync(txtPath, 'utf-8').replace(/\r\n/g, '\n').trim();
}

/** 视频裁剪：按起始和结束时间截取片段，输出 mp4（-c copy 不重新编码，速度快） */
async function runFfmpegTrimVideo(inputPath: string, outputPath: string, startSec: number, endSec: number): Promise<void> {
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
      '-c',
      'copy',
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
  if (ffmpegAvailable != null) return ffmpegAvailable;
  ffmpegAvailable = await new Promise<boolean>((resolve) => {
    try {
      const ffmpegBin = resolveFfmpegPath();
      const child = spawn(ffmpegBin, ['-version'], { windowsHide: true, shell: false });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
  return ffmpegAvailable;
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

/** 导出时解析片段有效时长：始终与源文件探测值取较大者 */
async function resolveTimelineClipDuration(
  clip: { type: string; src: string; duration: number; trimEnd?: number },
  projectId?: string,
): Promise<number> {
  if (clip.type === 'image') return clip.duration;
  const src = (clip.src || '').trim();
  if (!src) return clip.duration;
  const probed = await getMediaDuration(src, projectId);
  const fromClip = Math.max(
    clip.duration,
    clip.trimEnd != null && clip.trimEnd > 0 ? clip.trimEnd : 0,
  );
  if (probed > 0) return Math.max(fromClip, probed);
  return fromClip;
}

async function generateVideoPosterAndGhost(originalPath: string, posterPath: string): Promise<{ bytesPoster?: number; width?: number; height?: number; ghostBase64?: string }> {
  try {
    const hasFfmpeg = await ensureFfmpegAvailable();
    if (!hasFfmpeg) {
      return {};
    }
    await runFfmpegCapturePoster(originalPath, posterPath);
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
      const ghostBuf = await poster
        .clone()
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

    fs.copyFileSync(normalized, originalPath);
    const bytesOriginal = fs.statSync(originalPath).size;
    const [preview, ghostBase64] = await Promise.all([
      generatePreviewAssets(originalPath, previewPath, tinyPath),
      generateGhostBase64(originalPath),
    ]);

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

    fs.writeFileSync(originalPath, Buffer.from(buffer));
    const bytesOriginal = fs.statSync(originalPath).size;
    const [preview, ghostBase64] = await Promise.all([
      generatePreviewAssets(originalPath, previewPath, tinyPath),
      generateGhostBase64(originalPath),
    ]);

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

  async createVideoResourceFromFile(projectId: string | undefined, sourceFilePath: string): Promise<LocalVideoResourceResult> {
    const normalized = (sourceFilePath || '').trim().replace(/^file:\/\/\/?/i, '');
    if (!normalized) throw new Error('源文件路径为空');
    if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) {
      throw new Error('源文件不存在或不是文件');
    }
    const saveDir = await resolveSaveDir(projectId);
    const ext = (path.extname(normalized) || '.mp4').toLowerCase();
    const stem = safeStem(path.basename(normalized, ext));
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const originalPath = path.join(saveDir, `${stem}-${id}${ext}`).replace(/\\/g, '/');
    const posterPath = path.join(saveDir, `${stem}-${id}_poster.jpg`).replace(/\\/g, '/');
    fs.copyFileSync(normalized, originalPath);
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
      const downloadTail: string[] = [
        ...(site === 'youtube' ? buildYoutubeYtDlpSpeedArgs() : []),
        '--no-playlist',
        '--no-mtime',
        '-f',
        'bv*+ba/bestvideo*+bestaudio/best',
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

    let inputPath: string;

    if (url.startsWith('http://') || url.startsWith('https://')) {
      const saveDir = await resolveSaveDir(projectId);
      const ext = guessVideoExtFromUrl(url);
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      inputPath = path.join(saveDir, `video-extract-${id}${ext}`).replace(/\\/g, '/');
      const resp = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 120000, proxy: false });
      fs.writeFileSync(inputPath, Buffer.from(resp.data));
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

    await runFfmpegExtractAudio(inputPath, outputPath);

    if (url.startsWith('http://') || url.startsWith('https://')) {
      try {
        fs.unlinkSync(inputPath);
      } catch {
        // ignore
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
  ): Promise<{ videoUrl: string }> {
    const url = (videoUrl || '').trim();
    if (!url) throw new Error('视频 URL 为空');
    if (startSec < 0 || endSec <= startSec) throw new Error('起始时间须小于结束时间');

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

    await runFfmpegTrimVideo(inputPath, outputPath, startSec, endSec);

    if (url.startsWith('http://') || url.startsWith('https://')) {
      try {
        fs.unlinkSync(inputPath);
      } catch {
        // ignore
      }
    }

    return { videoUrl: toLocalResourceUrl(outputPath) };
  }

  /**
   * 时间轴导出视频：按 videoClips 顺序拼接视频/图片片段，合并音频轨道（剪映风格）
   */
  async exportTimelineVideo(
    projectId: string | undefined,
    videoClips: Array<{ type: string; src: string; duration: number; startTime: number; trimStart?: number; trimEnd?: number }>,
    audioTracks: Array<Array<{ type: string; src: string; duration: number; startTime: number; trimStart?: number; trimEnd?: number }>>,
    outputPath: string,
    options?: { videoTrackVolume?: number; videoTrackMuted?: boolean; audioTrackVolume?: number[]; audioTrackMuted?: boolean[]; outputWidth?: number; outputHeight?: number }
  ): Promise<{ videoPath: string; hasAudio: boolean }> {
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
      const scaleFilter = `scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`;
      const videoTrackMuted = options?.videoTrackMuted ?? false;
      const videoTrackVolume = Math.max(0, Math.min(2, options?.videoTrackVolume ?? 1));
      const audioTrackMuted = options?.audioTrackMuted ?? [];
      const audioTrackVolume = (options?.audioTrackVolume ?? []).map((v) => Math.max(0, Math.min(3, v ?? 1)));
      const segmentPaths: string[] = [];
      for (let i = 0; i < sortedClips.length; i++) {
        const clip = sortedClips[i];
        const clipDuration = await resolveTimelineClipDuration(clip, projectId);
        const trimStart = clip.trimStart ?? 0;
        const trimEnd = clip.trimEnd ?? clipDuration;
        const segDur = Math.max(0.01, trimEnd - trimStart);
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
        if (clip.type === 'image') {
          await new Promise<void>((resolve, reject) => {
            const args = [
              '-y', '-hide_banner', '-loglevel', 'error',
              '-loop', '1', '-i', inputPath,
              '-t', String(segDur),
              '-vf', scaleFilter,
              '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30',
              segPath,
            ];
            const child = spawn(ffmpegBin, args, { windowsHide: true });
            let stderr = '';
            child.stderr.on('data', (chunk) => { stderr += String(chunk || ''); });
            child.on('error', reject);
            child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr || `ffmpeg exited ${code}`))));
          });
        } else {
          await new Promise<void>((resolve, reject) => {
            const args = [
              '-y', '-hide_banner', '-loglevel', 'error',
              '-ss', String(trimStart), '-i', inputPath,
              '-t', String(segDur),
              '-vf', scaleFilter,
              '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-an',
              segPath,
            ];
            const child = spawn(ffmpegBin, args, { windowsHide: true });
            let stderr = '';
            child.stderr.on('data', (chunk) => { stderr += String(chunk || ''); });
            child.on('error', reject);
            child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr || `ffmpeg exited ${code}`))));
          });
        }
        segmentPaths.push(segPath);
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
   * 本地语音转文字（whisper.cpp）：支持 local-resource://、file://、http(s)://，
   * 以及项目文件夹内相对路径与本机绝对路径（须落在允许访问的目录内）。
   * 需配置 WHISPER_CPP_BIN、WHISPER_MODEL_PATH，或打包 resources/whisper/main(.exe) 与 ggml-base.bin。
   */
  async transcribeSpeechFromAudioUrl(
    projectId: string | undefined,
    audioUrl: string,
    language?: string
  ): Promise<{ text: string }> {
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
      let text = await runWhisperCppToText(
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
      return { text };
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
    const child = spawn(cmd, args, { windowsHide: true, shell: false });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `demucs exited with code ${code}`));
    });
  });
}

export const localResourceManager = new LocalResourceManager();
