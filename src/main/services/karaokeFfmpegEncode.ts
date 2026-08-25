/**
 * 卡拉OK 导出共用：ffmpeg 路径、硬编探测（nvenc/qsv/amf → libx264）。
 */

import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export type KaraokeEncoderPick = {
  name: string;
  args: string[];
};

let encoderCache: KaraokeEncoderPick[] | null = null;

export function resolveKaraokeFfmpegPath(): string {
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

async function listEncoderNames(bin: string): Promise<Set<string>> {
  const out = await new Promise<string>((resolve) => {
    const child = spawn(bin, ['-hide_banner', '-encoders'], { windowsHide: true });
    let buf = '';
    child.stdout?.on('data', (c) => {
      buf += String(c || '');
    });
    child.stderr?.on('data', (c) => {
      buf += String(c || '');
    });
    child.on('error', () => resolve(buf));
    child.on('close', () => resolve(buf));
  });
  const set = new Set<string>();
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^\s*V\.?.{4}\s+(\S+)/);
    if (m?.[1]) set.add(m[1]);
  }
  return set;
}

function probeEncoderWorks(bin: string, encName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const args = [
      '-y',
      '-hide_banner',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=64x64:d=0.05',
      '-frames:v',
      '1',
      '-c:v',
      encName,
      '-f',
      'null',
      '-',
    ];
    const child = spawn(bin, args, { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => {
      killChild(child);
      resolve(false);
    }, 4000);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

export function karaokeSoftH264Encoder(): KaraokeEncoderPick {
  return {
    name: 'libx264',
    args: [
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '17',
      '-pix_fmt',
      'yuv420p',
      '-profile:v',
      'high',
    ],
  };
}

/** 探测可用硬编；办公本无独显时落到 libx264 veryfast + CRF17 */
export async function pickKaraokeH264Encoder(
  bin = resolveKaraokeFfmpegPath(),
): Promise<KaraokeEncoderPick> {
  if (encoderCache?.length) return encoderCache[0];
  const names = await listEncoderNames(bin);
  const list: KaraokeEncoderPick[] = [];
  const hw: KaraokeEncoderPick[] = [];
  if (names.has('h264_nvenc')) {
    hw.push({
      name: 'h264_nvenc',
      args: [
        '-c:v',
        'h264_nvenc',
        '-preset',
        'p4',
        '-rc',
        'constqp',
        '-qp',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-profile:v',
        'high',
      ],
    });
  }
  if (names.has('h264_qsv')) {
    hw.push({
      name: 'h264_qsv',
      args: [
        '-c:v',
        'h264_qsv',
        '-global_quality',
        '18',
        '-look_ahead',
        '0',
        '-pix_fmt',
        'nv12',
      ],
    });
  }
  if (names.has('h264_amf')) {
    hw.push({
      name: 'h264_amf',
      args: [
        '-c:v',
        'h264_amf',
        '-rc',
        'cqp',
        '-qp_i',
        '18',
        '-qp_p',
        '20',
        '-pix_fmt',
        'yuv420p',
        '-quality',
        'quality',
      ],
    });
  }
  for (const enc of hw) {
    if (await probeEncoderWorks(bin, enc.name)) list.push(enc);
  }
  list.push(karaokeSoftH264Encoder());
  encoderCache = list;
  return list[0];
}

export function isKaraokeBrokenPipeError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  const msg = String((err as Error)?.message || err || '');
  return code === 'EPIPE' || code === 'EOF' || code === 'ECONNRESET' || /write EOF/i.test(msg);
}

/** overlay 管道已关（ffmpeg 先退出 / write EOF）；应停写并看编码结果，勿当未捕获异常。 */
export class KaraokeOverlayPipeClosedError extends Error {
  constructor(message = 'ffmpeg overlay pipe closed') {
    super(message);
    this.name = 'KaraokeOverlayPipeClosedError';
  }
}

export function isKaraokeOverlayPipeClosedError(err: unknown): boolean {
  return (
    err instanceof KaraokeOverlayPipeClosedError ||
    (err as Error)?.name === 'KaraokeOverlayPipeClosedError' ||
    isKaraokeBrokenPipeError(err)
  );
}

/** ffmpeg 提前退出后 stdin.write 会抛 write EOF；不监听会变成主进程未捕获异常弹窗。 */
export function guardKaraokeFfmpegStdin(stdin: NodeJS.WritableStream | null | undefined): void {
  if (!stdin || (stdin as { _nexflowEofGuard?: boolean })._nexflowEofGuard) return;
  (stdin as { _nexflowEofGuard?: boolean })._nexflowEofGuard = true;
  stdin.on('error', (err: NodeJS.ErrnoException) => {
    if (isKaraokeBrokenPipeError(err)) return;
    console.error('[karaoke] ffmpeg stdin', err);
  });
}
