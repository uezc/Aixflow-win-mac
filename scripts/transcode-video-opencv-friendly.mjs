#!/usr/bin/env node
/**
 * 本地转码：将任意常见视频转为 OpenCV / ComfyUI VHS_LoadVideo 易解码的 MP4
 * （H.264 High、yuv420p、偶数分辨率、faststart、AAC 音轨）。
 *
 * 用法:
 *   node scripts/transcode-video-opencv-friendly.mjs <输入视频> [输出.mp4]
 *   npm run transcode:video -- ./a.mp4
 *
 * 选项:
 *   --crf <18-28>     画质（默认 20，越小越清晰）
 *   --preset <name>  x264 preset（默认 medium）
 *   --fps <n>        强制恒定帧率（可选，如 30）
 *   --an             不要音轨
 *   --dry-run        只打印将要执行的 ffmpeg 命令
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const require = createRequire(import.meta.url);

function resolveFfmpegBin() {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const bundled = path.join(projectRoot, 'resources', 'ffmpeg', exe);
  if (fs.existsSync(bundled)) return bundled;
  try {
    const mod = require('ffmpeg-static');
    const p = typeof mod === 'string' ? mod : mod?.default;
    if (p && fs.existsSync(p)) return p;
  } catch {
    /* no ffmpeg-static */
  }
  return exe;
}

function parseArgs(argv) {
  const positional = [];
  let crf = 20;
  let preset = 'medium';
  let fps = null;
  let noAudio = false;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--crf') {
      crf = Number(argv[++i]);
      if (!Number.isFinite(crf) || crf < 0 || crf > 51) {
        console.error('[transcode] --crf 需在 0–51 之间');
        process.exit(1);
      }
    } else if (a === '--preset') {
      preset = argv[++i] || 'medium';
    } else if (a === '--fps') {
      fps = Number(argv[++i]);
      if (!Number.isFinite(fps) || fps <= 0) {
        console.error('[transcode] --fps 无效');
        process.exit(1);
      }
    } else if (a === '--an') {
      noAudio = true;
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a.startsWith('-')) {
      console.error('[transcode] 未知选项:', a);
      process.exit(1);
    } else {
      positional.push(a);
    }
  }
  return { positional, crf, preset, fps, noAudio, dryRun };
}

function defaultOutputPath(inputPath) {
  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  return path.join(dir, `${base}-opencv-h264.mp4`);
}

function buildFilterGraph(fps) {
  const parts = [
    'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    'format=yuv420p',
  ];
  if (fps != null) {
    parts.push(`fps=${fps}`);
  }
  return parts.join(',');
}

function main() {
  const raw = process.argv.slice(2);
  if (raw.length === 0) {
    console.log(`用法: node scripts/transcode-video-opencv-friendly.mjs <输入> [输出] [选项]

将视频转为 H.264 + AAC（8bit yuv420p），便于 OpenCV / ComfyUI-VideoHelperSuite 读取。

选项:
  --crf 20        画质（默认 20）
  --preset medium x264 preset
  --fps 30        强制恒定帧率（可选，可改善 VFR 素材兼容性）
  --an            仅视频、不要音轨
  --dry-run       只打印 ffmpeg 命令

示例:
  npm run transcode:video -- "D:\\dl\\bilibili.mp4"
  npm run transcode:video -- ./a.m4v ./a_comfy.mp4 --fps 30
`);
    process.exit(0);
  }

  const { positional, crf, preset, fps, noAudio, dryRun } = parseArgs(raw);
  if (positional.length < 1) {
    console.error('[transcode] 请指定输入文件');
    process.exit(1);
  }
  const inputPath = path.resolve(positional[0]);
  const outputPath = positional.length >= 2
    ? path.resolve(positional[1])
    : defaultOutputPath(inputPath);

  if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) {
    console.error('[transcode] 输入不是有效文件:', inputPath);
    process.exit(1);
  }
  if (path.resolve(inputPath) === path.resolve(outputPath)) {
    console.error('[transcode] 输出不能与输入相同，请指定另一输出路径');
    process.exit(1);
  }

  const ffmpegBin = resolveFfmpegBin();
  const vf = buildFilterGraph(fps);
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'info',
    '-i',
    inputPath,
    '-vf',
    vf,
    '-c:v',
    'libx264',
    '-preset',
    preset,
    '-crf',
    String(crf),
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
  ];
  if (noAudio) {
    args.push('-an');
  } else {
    args.push(
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      '48000',
      '-ac',
      '2',
    );
  }
  args.push(outputPath);

  console.log('[transcode] ffmpeg:', ffmpegBin);
  console.log('[transcode] 输出:', outputPath);

  if (dryRun) {
    console.log('[dry-run]', [ffmpegBin, ...args].map((s) => (/\s/.test(s) ? `"${s}"` : s)).join(' '));
    process.exit(0);
  }

  const child = spawn(ffmpegBin, args, {
    stdio: 'inherit',
    windowsHide: true,
    shell: false,
  });
  child.on('error', (err) => {
    console.error('[transcode] 无法启动 ffmpeg:', err.message);
    console.error('[transcode] 若未安装依赖，请在项目根目录执行 npm install（含 ffmpeg-static）');
    process.exit(1);
  });
  child.on('close', (code) => {
    if (code === 0) {
      const st = fs.statSync(outputPath);
      console.log(`[transcode] 完成，大小 ${(st.size / 1024 / 1024).toFixed(2)} MB`);
    } else {
      process.exit(code ?? 1);
    }
  });
}

main();
