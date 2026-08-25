/**
 * RunningHub 工作流无法清空默认测试素材时，客户端上传占位媒体并缓存 RH fieldValue，
 * 用于强制覆盖 apiCallDemo 暴露的全部 image/audio 槽位。
 */
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  rhComfyMediaFieldValue,
  uploadRunningHubMediaBinaryViaFc,
} from '../services/runningHubAiAppFc.js';

export type RhSealMediaFields = {
  /** RH openapi/… 静音 MP3（约 1s） */
  silentAudio: string;
  /** RH openapi/… 中性灰占位图（64×64 JPEG） */
  blankImage: string;
};

let cachedBundle: RhSealMediaFields | null = null;
let inflightBundle: Promise<RhSealMediaFields> | null = null;
/** 实际触发 RH 二进制上传次数（期望：每进程 2 = 静音 + 灰图各 1 次） */
let sealBinaryUploadCount = 0;
/** 完成上传的轮次（期望：每进程 ≤ 1） */
let sealUploadRounds = 0;
let sealLogPrinted = false;

export const RH_SEAL_UPLOAD_LOG = '[RH seal] 封口媒体已上传';

export type RhSealMediaMonitor = {
  cached: boolean;
  uploadInFlight: boolean;
  uploadRounds: number;
  binaryUploadCount: number;
  logPrinted: boolean;
};

/** 供调试/测试：查看封口媒体是否只上传一次 */
export function getRhSealMediaMonitor(): RhSealMediaMonitor {
  return {
    cached: cachedBundle !== null,
    uploadInFlight: inflightBundle !== null,
    uploadRounds: sealUploadRounds,
    binaryUploadCount: sealBinaryUploadCount,
    logPrinted: sealLogPrinted,
  };
}

/** 仅测试脚本使用：重置会话缓存与计数 */
export function resetRhSealMediaStateForTests(): void {
  cachedBundle = null;
  inflightBundle = null;
  sealBinaryUploadCount = 0;
  sealUploadRounds = 0;
  sealLogPrinted = false;
}

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

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegPath(), args, { windowsHide: true, shell: false });
    let stderr = '';
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });
}

async function withTempFile(ext: string, run: (filePath: string) => Promise<void>): Promise<Buffer> {
  const filePath = path.join(os.tmpdir(), `nexflow-rh-seal-${randomUUID()}${ext}`);
  try {
    await run(filePath);
    return await fsPromises.readFile(filePath);
  } finally {
    await fsPromises.unlink(filePath).catch(() => undefined);
  }
}

async function buildSilentMp3Buffer(): Promise<Buffer> {
  return withTempFile('.mp3', async (out) => {
    await runFfmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=44100:cl=mono',
      '-t',
      '1',
      '-acodec',
      'libmp3lame',
      '-q:a',
      '9',
      '-y',
      out,
    ]);
  });
}

async function buildBlankJpegBuffer(): Promise<Buffer> {
  return withTempFile('.jpg', async (out) => {
    await runFfmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=gray:s=64x64',
      '-frames:v',
      '1',
      '-y',
      out,
    ]);
  });
}

function assertRhMediaField(field: string, label: string): string {
  const v = String(field || '').trim();
  if (!/^(openapi|api)\//i.test(v)) {
    throw new Error(`RH ${label}封口上传失败（需 openapi/… 或 api/…，实际: ${v || '空'}）`);
  }
  return v;
}

/** 会话内缓存：静音 MP3 + 灰图各上传一次到 RH */
export async function getRhSealMediaBundle(): Promise<RhSealMediaFields> {
  if (process.env.NEXFLOW_RH_SEAL_MOCK === '1') {
    if (!cachedBundle) {
      cachedBundle = {
        silentAudio: 'openapi/nexflow-mock-seal-silent.mp3',
        blankImage: 'openapi/nexflow-mock-seal-blank.jpg',
      };
      sealUploadRounds = 1;
      sealBinaryUploadCount = 2;
      if (!sealLogPrinted) {
        console.log(RH_SEAL_UPLOAD_LOG, {
          mock: true,
          silentAudio: cachedBundle.silentAudio,
          blankImage: cachedBundle.blankImage,
        });
        sealLogPrinted = true;
      }
    }
    return cachedBundle;
  }

  if (cachedBundle) return cachedBundle;
  if (inflightBundle) return inflightBundle;

  inflightBundle = (async () => {
    sealUploadRounds += 1;
    const [mp3Buf, jpgBuf] = await Promise.all([buildSilentMp3Buffer(), buildBlankJpegBuffer()]);
    sealBinaryUploadCount += 1;
    const audioUp = await uploadRunningHubMediaBinaryViaFc(
      mp3Buf,
      'audio/mpeg',
      'nexflow-rh-seal-silent.mp3',
    );
    sealBinaryUploadCount += 1;
    const imageUp = await uploadRunningHubMediaBinaryViaFc(
      jpgBuf,
      'image/jpeg',
      'nexflow-rh-seal-blank.jpg',
    );
    const bundle: RhSealMediaFields = {
      silentAudio: assertRhMediaField(rhComfyMediaFieldValue(audioUp), '静音音频'),
      blankImage: assertRhMediaField(rhComfyMediaFieldValue(imageUp), '占位图'),
    };
    if (!sealLogPrinted) {
      console.log(RH_SEAL_UPLOAD_LOG, {
        silentAudio: bundle.silentAudio.slice(0, 72),
        blankImage: bundle.blankImage.slice(0, 72),
        binaryUploadCount: sealBinaryUploadCount,
      });
      sealLogPrinted = true;
    }
    cachedBundle = bundle;
    return bundle;
  })();

  try {
    return await inflightBundle;
  } finally {
    inflightBundle = null;
  }
}
