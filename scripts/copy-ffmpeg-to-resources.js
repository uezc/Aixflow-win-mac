#!/usr/bin/env node
/**
 * 构建前复制：将 ffmpeg-static 的 ffmpeg 二进制复制到 resources/ffmpeg/，
 * 作为 extraResources 打包，与 demucs 同路径模式，确保新电脑安装后无需用户配置 PATH。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const srcPath = path.join(projectRoot, 'node_modules', 'ffmpeg-static', exeName);
const destDir = path.join(projectRoot, 'resources', 'ffmpeg');
const destPath = path.join(destDir, exeName);

function main() {
  if (!fs.existsSync(srcPath)) {
    console.error('[copy-ffmpeg] 未找到 ffmpeg 二进制:', srcPath);
    console.error('[copy-ffmpeg] 请先执行 npm install 确保 ffmpeg-static 已安装');
    process.exit(1);
  }
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(srcPath, destPath);
  const stat = fs.statSync(destPath);
  console.log(`[copy-ffmpeg] 已复制到 ${destPath} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
}

main();
