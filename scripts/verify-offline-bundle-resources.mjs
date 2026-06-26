#!/usr/bin/env node
/**
 * 在 electron-builder 之前校验：正式安装包应内置 ffmpeg + yt-dlp + Whisper ggml 模型，
 * 用户离线安装后即可使用在线视频导入与本地转写，无需再 pip / 访问 GitHub / HuggingFace。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const MIN_FFMPEG = 500_000;
const MIN_YTDLP = 50_000;
/** 与 main 进程 WHISPER_MODEL_CANDIDATE_NAMES 一致；任一生效即通过（优先小包时可为 tiny） */
const WHISPER_MODEL_FILES = [
  'ggml-tiny.bin',
  'ggml-base.bin',
  'ggml-small.bin',
  'ggml-medium.bin',
  'ggml-large-v3.bin',
  'ggml-large-v2.bin',
  'ggml-large.bin',
];
const MIN_WHISPER_MODEL = 65_000_000;

function main() {
  const win = process.platform === 'win32';
  const ffmpegPath = path.join(root, 'resources', 'ffmpeg', win ? 'ffmpeg.exe' : 'ffmpeg');
  const ytPath = path.join(root, 'resources', 'yt-dlp', win ? 'yt-dlp.exe' : 'yt-dlp');
  const whisperDir = path.join(root, 'resources', 'whisper');

  const errors = [];
  for (const [label, filePath, minBytes] of [
    ['ffmpeg', ffmpegPath, MIN_FFMPEG],
    ['yt-dlp', ytPath, MIN_YTDLP],
  ]) {
    if (!fs.existsSync(filePath)) {
      errors.push(`${label}: 缺少 ${filePath}`);
      continue;
    }
    const st = fs.statSync(filePath);
    if (st.size < minBytes) {
      errors.push(`${label}: 文件过小 (${st.size} bytes)，疑似损坏: ${filePath}`);
    }
  }

  let whisperOk = false;
  let whisperFoundPath = '';
  for (const name of WHISPER_MODEL_FILES) {
    const p = path.join(whisperDir, name);
    if (!fs.existsSync(p)) continue;
    const st = fs.statSync(p);
    if (st.size >= MIN_WHISPER_MODEL) {
      whisperOk = true;
      whisperFoundPath = p;
      break;
    }
  }
  if (!whisperOk) {
    errors.push(
      `whisper 模型: 在 ${whisperDir} 下需要上述文件名之一且 ≥ ${(MIN_WHISPER_MODEL / 1e6).toFixed(0)}MB（如 ggml-base.bin）`,
    );
  }

  if (errors.length) {
    console.error('[verify-offline-bundle] 无法继续打包：离线安装所需二进制未就绪');
    errors.forEach((e) => console.error('  -', e));
    console.error('请先执行：node scripts/copy-ffmpeg-to-resources.js && npm run copy-yt-dlp');
    console.error('并下载 Whisper 模型：npm run download-whisper-model');
    console.error('（国内构建机见 docs/BUILD.md「yt-dlp 与国内构建」；Whisper 可用 NEXFLOW_WHISPER_HF_PROXY 或 WHISPER_MODEL_DOWNLOAD_URL）');
    process.exit(1);
  }

  console.log(
    `[verify-offline-bundle] 已确认 ffmpeg / yt-dlp / whisper 模型将随安装包分发（用户无需单独安装）。模型: ${path.basename(whisperFoundPath)}`,
  );
}

main();
