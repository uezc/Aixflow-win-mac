#!/usr/bin/env node
/**
 * 打包前校验：安装包内置 ffmpeg + yt-dlp；RVC / Whisper 仅带 manifest，首次使用时下载。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const MIN_FFMPEG = 500_000;
const MIN_YTDLP = 50_000;

function readManifest(relPath) {
  const p = path.join(root, relPath);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function main() {
  const win = process.platform === 'win32';
  const ffmpegPath = path.join(root, 'resources', 'ffmpeg', win ? 'ffmpeg.exe' : 'ffmpeg');
  const ytPath = path.join(root, 'resources', 'yt-dlp', win ? 'yt-dlp.exe' : 'yt-dlp');

  const errors = [];
  const warnings = [];

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

  for (const [name, rel] of [
    ['RVC', 'resources/rvc/manifest.json'],
    ['Whisper', 'resources/whisper/manifest.json'],
  ]) {
    const manifest = readManifest(rel);
    if (!manifest) {
      errors.push(`${name}: 缺少 ${rel}`);
      continue;
    }
    if (!manifest.bundleUrl && !process.env[`NEXFLOW_${name.toUpperCase()}_ENGINE_BUNDLE_URL`]) {
      warnings.push(`${name}: manifest.bundleUrl 为空，用户首次使用需配置下载地址`);
    }
  }

  if (errors.length) {
    console.error('[verify-offline-bundle] 无法继续打包：必需资源未就绪');
    errors.forEach((e) => console.error('  -', e));
    console.error('请先执行：node scripts/copy-ffmpeg-to-resources.js && npm run copy-yt-dlp');
    process.exit(1);
  }

  warnings.forEach((w) => console.warn('[verify-offline-bundle] 警告:', w));
  console.log(
    '[verify-offline-bundle] 已确认 ffmpeg / yt-dlp 将随安装包分发；RVC / Whisper 为首次使用下载（不随包）。',
  );
}

main();
