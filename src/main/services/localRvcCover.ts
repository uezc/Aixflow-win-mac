/**
 * 本地 RVC 翻唱：Demucs 人声分离 → RVC 推理 → 与伴奏混回（100% 本地，不扣元宝）。
 */
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { createRequire } from 'node:module';
import axios from 'axios';
import {
  ensureRvcEngineReady,
  getRvcAssetPaths,
  resolveRvcInferLaunch,
  downloadRvcEngineBundle,
  getRvcEngineStatus,
  type RvcEngineDownloadProgress,
} from './localRvcEngine.js';
import {
  clampCoverAccompanimentMixPct,
  clampCoverIndexRate,
  clampCoverPitch,
  clampCoverVocalMixPct,
} from '../../shared/rvcVoiceCoverUtils.js';
import { materializeRvcModelForInfer } from '../utils/rvcModelPackage.js';
import { getProjectFolderPath, isLocalResourcePathAllowed } from '../utils/projectFolderHelper.js';

export interface LocalRvcCoverParams {
  projectId?: string;
  sourceSongUrl: string;
  modelPackageUrl: string;
  pitch?: number;
  indexRate?: number;
  vocalMixPct?: number;
  accompanimentMixPct?: number;
  /** @deprecated 已改为人声/伴奏音量滑条控制，保留字段兼容旧节点 */
  outputMode?: 'with_accompaniment' | 'vocals_only';
  onProgress?: (message: string) => void;
  onEngineDownload?: (p: RvcEngineDownloadProgress) => void;
}

export interface LocalRvcCoverResult {
  audioUrl: string;
  localPath: string;
}

let bundledDemucsPath: string | null | undefined;

const nodeRequire = createRequire(import.meta.url);

function getBundledDemucsPath(): string | null {
  if (bundledDemucsPath !== undefined) return bundledDemucsPath;
  try {
    const exePath = path.join(process.resourcesPath, 'demucs', 'demucs_cli.exe');
    if (process.resourcesPath && fs.existsSync(exePath)) {
      bundledDemucsPath = exePath;
      return exePath;
    }
  } catch {
    /* ignore */
  }
  bundledDemucsPath = null;
  return null;
}

function resolveFfmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  try {
    const rp = process.resourcesPath;
    if (rp) {
      const extra = path.join(rp, 'ffmpeg', exeName);
      if (fs.existsSync(extra)) return extra;
    }
  } catch {
    /* ignore */
  }
  try {
    const mod = nodeRequire('ffmpeg-static');
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

function decodeLocalResourcePath(urlOrPath: string): string {
  let filePath = (urlOrPath || '').trim();
  if (filePath.startsWith('local-resource://')) {
    filePath = filePath.replace(/^local-resource:\/\/+/, '');
  } else if (filePath.startsWith('file://')) {
    filePath = filePath.replace(/^file:\/\/+/, '');
  } else {
    return path.normalize(filePath);
  }
  filePath = filePath.replace(/%5C/gi, '/');
  if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
  filePath = decodeURIComponent(filePath);
  if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
  return path.normalize(filePath);
}

function toLocalResourceUrl(filePath: string): string {
  let normalized = filePath.replace(/\\/g, '/');
  if (/^\/[a-zA-Z]:/.test(normalized)) normalized = normalized.substring(1);
  return `local-resource://${normalized}`;
}

async function resolveSaveDir(projectId?: string): Promise<string> {
  if (projectId) {
    const folder = await getProjectFolderPath(projectId);
    if (folder) {
      const dir = path.join(folder, 'resources', 'audio');
      fs.mkdirSync(dir, { recursive: true });
      return dir.replace(/\\/g, '/');
    }
  }
  const dir = path.join(app.getPath('userData'), 'generated-audio');
  fs.mkdirSync(dir, { recursive: true });
  return dir.replace(/\\/g, '/');
}

async function resolveInputAudioPath(projectId: string | undefined, url: string): Promise<string> {
  const trimmed = url.trim();
  if (trimmed.startsWith('local-resource://') || trimmed.startsWith('file://')) {
    const filePath = decodeLocalResourcePath(trimmed);
    if (!isLocalResourcePathAllowed(filePath)) {
      throw new Error('原曲文件路径不在允许访问的目录内');
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error('原曲音频文件不存在或无法访问');
    }
    return filePath;
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const saveDir = await resolveSaveDir(projectId);
    const ext = path.extname(new URL(trimmed).pathname || '') || '.mp3';
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const inputPath = path.join(saveDir, `rvc-cover-src-${id}${ext}`).replace(/\\/g, '/');
    const resp = await axios.get<ArrayBuffer>(trimmed, { responseType: 'arraybuffer', timeout: 120000, proxy: false });
    fs.writeFileSync(inputPath, Buffer.from(resp.data));
    return inputPath;
  }
  throw new Error('原曲需为 local-resource://、file:// 或公网 URL');
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

async function runDemucsSeparate(
  inputPath: string,
  outputDir: string,
  opts?: { shifts?: number; overlap?: number },
): Promise<void> {
  const bundled = getBundledDemucsPath();
  const qualityArgs: string[] = [];
  if (opts?.shifts && opts.shifts > 0) {
    qualityArgs.push('--shifts', String(Math.min(4, Math.round(opts.shifts))));
  }
  if (opts?.overlap != null && opts.overlap > 0) {
    qualityArgs.push('--overlap', String(opts.overlap));
  }
  const args = bundled
    ? ['-n', 'htdemucs', '--two-stems', 'vocals', ...qualityArgs, inputPath, '-o', outputDir]
    : ['-m', 'demucs', '-n', 'htdemucs', '--two-stems', 'vocals', ...qualityArgs, inputPath, '-o', outputDir];
  const cmd = bundled || 'python';
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout?.on('data', () => {});
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `Demucs 分离失败 (code ${code})`));
    });
  });
}

async function runFfmpegWavToMp3(inputWav: string, outputMp3: string): Promise<void> {
  const ffmpegBin = resolveFfmpegPath();
  return new Promise<void>((resolve, reject) => {
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputWav,
      '-c:a',
      'libmp3lame',
      '-q:a',
      '2',
      outputMp3,
    ];
    const child = spawn(ffmpegBin, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (c) => {
      stderr += String(c || '');
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr || `ffmpeg 导出失败 (${code})`))));
  });
}

/** 纯人声：从 RVC 人声轨中减去部分伴奏 stem，减轻 Demucs 分离残留 */
async function runFfmpegAttenuateInstrumentalBleed(
  vocalsPath: string,
  accompanimentPath: string,
  outputWav: string,
  subWeight = 0.35,
): Promise<void> {
  const ffmpegBin = resolveFfmpegPath();
  const w = Math.max(0.15, Math.min(0.5, subWeight));
  const filter = `[1:a]volume=${w}[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0:weights=1 -1,alimiter=limit=0.98:level=disabled`;
  return new Promise<void>((resolve, reject) => {
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      vocalsPath,
      '-i',
      accompanimentPath,
      '-filter_complex',
      filter,
      '-c:a',
      'pcm_s16le',
      outputWav,
    ];
    const child = spawn(ffmpegBin, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (c) => {
      stderr += String(c || '');
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr || `ffmpeg 人声去伴奏残留失败 (${code})`))));
  });
}

async function runFfmpegMixVocalsWithAccompaniment(
  vocalsPath: string,
  accompanimentPath: string,
  outputPath: string,
  vocalMixPct = 100,
  accompanimentMixPct = 100,
): Promise<void> {
  const ffmpegBin = resolveFfmpegPath();
  const vGain = clampCoverVocalMixPct(vocalMixPct) / 100;
  const aGain = clampCoverAccompanimentMixPct(accompanimentMixPct) / 100;
  return new Promise<void>((resolve, reject) => {
    // amix 默认 normalize=1 会把总电平压回「安全区」，单独调 volume/滑条几乎听不出变化（尤其两轨同比例放大时）
    const filter = `[0:a]volume=${vGain}[v0];[1:a]volume=${aGain}[v1];[v0][v1]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.98:level=disabled`;
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      vocalsPath,
      '-i',
      accompanimentPath,
      '-filter_complex',
      filter,
      '-c:a',
      'libmp3lame',
      '-q:a',
      '2',
      outputPath,
    ];
    const child = spawn(ffmpegBin, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (c) => {
      stderr += String(c || '');
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr || `ffmpeg 混音失败 (${code})`))));
  });
}

function summarizeCliLog(stdout: string, stderr: string): string {
  const combined = `${stdout}\n${stderr}`;
  const backendErr = combined.match(/rvc-python:\s*(.+)/i);
  if (backendErr?.[1]) return backendErr[1].trim();
  if (/state_dict|SynthesizerTrnMs/i.test(combined)) {
    return 'RVC 模型版本不匹配（v1/v2），或权重文件损坏，请确认训练产出为标准 RVC .pth';
  }
  if (/UnpicklingError|weights_only/i.test(combined)) {
    return 'HuBERT 权重加载失败（PyTorch 与 fairseq 兼容问题），请重启应用后重试';
  }
  const lines = combined
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (/^ERROR:/i.test(line)) return line.replace(/^ERROR:\s*/i, '').trim();
    if (/Traceback|Exception:|Error:|失败|不可用/i.test(line) && !/INFO \|/.test(line)) return line;
  }
  const nonInfo = lines.filter((l) => !/\| INFO \|/.test(l) && !/FutureWarning/.test(l));
  if (nonInfo.length) return nonInfo.slice(-2).join('\n');
  return 'RVC 推理失败';
}

async function runRvcInfer(opts: {
  modelPth: string;
  indexPath?: string;
  inputWav: string;
  outputWav: string;
  pitch: number;
  indexRate: number;
  hubertPath: string;
  rmvpePath: string;
}): Promise<void> {
  const { command, baseArgs } = resolveRvcInferLaunch();
  const args = [
    ...baseArgs,
    '--model-pth',
    opts.modelPth,
    '--input',
    opts.inputWav,
    '--output',
    opts.outputWav,
    '--pitch',
    String(opts.pitch),
    '--index-rate',
    String(opts.indexRate),
    '--hubert',
    opts.hubertPath,
    '--rmvpe',
    opts.rmvpePath,
    '--device',
    'cuda:0',
  ];
  if (opts.indexPath) {
    args.push('--index', opts.indexPath);
  }
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c) => {
      stdout += String(c || '');
    });
    child.stderr.on('data', (c) => {
      stderr += String(c || '');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(opts.outputWav)) resolve();
      else reject(new Error(summarizeCliLog(stdout, stderr) || `RVC 推理失败 (code ${code ?? 'unknown'})`));
    });
  });
}

async function ensureEngineWithOptionalDownload(
  onEngineDownload?: (p: RvcEngineDownloadProgress) => void,
): Promise<void> {
  try {
    await ensureRvcEngineReady();
    return;
  } catch (firstError) {
    const status = getRvcEngineStatus();
    if (!status.downloadUrlConfigured) throw firstError;
    await downloadRvcEngineBundle(onEngineDownload);
    await ensureRvcEngineReady();
  }
}

export async function runLocalRvcCover(params: LocalRvcCoverParams): Promise<LocalRvcCoverResult> {
  const {
    projectId,
    sourceSongUrl,
    modelPackageUrl,
    pitch = 0,
    indexRate = 0.75,
    vocalMixPct = 100,
    accompanimentMixPct = 100,
    onProgress,
    onEngineDownload,
  } = params;
  const pitchVal = clampCoverPitch(pitch);
  const indexRateVal = clampCoverIndexRate(indexRate);
  const vocalMixVal = clampCoverVocalMixPct(vocalMixPct);
  const accompMixVal = clampCoverAccompanimentMixPct(accompanimentMixPct);
  console.log('[localRvcCover] mix vocal=', vocalMixVal, '% accomp=', accompMixVal, '%');
  const songUrl = sourceSongUrl.trim();
  const modelUrl = modelPackageUrl.trim();
  if (!songUrl) throw new Error('RVC 翻唱需要原曲音频');
  if (!modelUrl) throw new Error('RVC 翻唱需要 RVC 模型（音色库或训练节点）');

  onProgress?.('检查本地 RVC 引擎…');
  await ensureEngineWithOptionalDownload(onEngineDownload);

  const hasDemucs = await ensureDemucsAvailable();
  if (!hasDemucs) {
    throw new Error('未检测到 Demucs，无法进行人声分离。请使用已打包 Demucs 的安装包或 pip install demucs');
  }

  const { hubertPath, rmvpePath } = getRvcAssetPaths();
  const tempBase = app.getPath('temp');
  const jobDir = path.join(tempBase, `nexflow-rvc-cover-${Date.now()}`);
  fs.mkdirSync(jobDir, { recursive: true });

  let downloadedSong: string | null = null;
  try {
    onProgress?.('加载原曲…');
    const inputPath = await resolveInputAudioPath(projectId, songUrl);
    if (songUrl.startsWith('http://') || songUrl.startsWith('https://')) {
      downloadedSong = inputPath;
    }

    onProgress?.('分离人声与伴奏…');
    const inputExt = path.extname(inputPath) || '.mp3';
    const tempInput = path.join(jobDir, `input${inputExt}`);
    fs.copyFileSync(inputPath, tempInput);
    const demucsOut = path.join(jobDir, 'demucs');
    fs.mkdirSync(demucsOut, { recursive: true });
    await runDemucsSeparate(tempInput, demucsOut);
    const stemDir = path.join(demucsOut, 'htdemucs', path.basename(tempInput, inputExt));
    const vocalsWav = path.join(stemDir, 'vocals.wav');
    const noVocalsWav = path.join(stemDir, 'no_vocals.wav');
    if (!fs.existsSync(vocalsWav) || !fs.existsSync(noVocalsWav)) {
      throw new Error('Demucs 未生成人声/伴奏轨，请检查原曲格式');
    }

    onProgress?.('准备 RVC 模型…');
    const modelDir = path.join(jobDir, 'model');
    const { pthPath, indexPath } = await materializeRvcModelForInfer(modelUrl, modelDir);

    onProgress?.('RVC 翻唱推理中（本地 GPU/CPU）…');
    const convertedWav = path.join(jobDir, 'converted_vocals.wav');
    await runRvcInfer({
      modelPth: pthPath,
      indexPath,
      inputWav: vocalsWav,
      outputWav: convertedWav,
      pitch: pitchVal,
      indexRate: indexRateVal,
      hubertPath,
      rmvpePath,
    });

    onProgress?.('混音输出…');
    const saveDir = await resolveSaveDir(projectId);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const outputPath = path.join(saveDir, `rvc-cover-${id}.mp3`).replace(/\\/g, '/');
    await runFfmpegMixVocalsWithAccompaniment(
      convertedWav,
      noVocalsWav,
      outputPath,
      vocalMixVal,
      accompMixVal,
    );

    onProgress?.('完成');
    return { audioUrl: toLocalResourceUrl(outputPath), localPath: outputPath };
  } finally {
    try {
      fs.rmSync(jobDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    if (downloadedSong) {
      try {
        fs.unlinkSync(downloadedSong);
      } catch {
        /* ignore */
      }
    }
  }
}
