#!/usr/bin/env node
/**
 * 下载 Microsoft Visual C++ Redistributable (x64) 到 build/vc_redist.x64.exe
 * 用于打包进安装程序，实现用户一键安装、无需额外依赖
 * 若文件已存在则跳过
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(__dirname, '..', 'build');
const outPath = path.join(buildDir, 'vc_redist.x64.exe');
const VC_REDIST_URL = 'https://aka.ms/vc_redist.x64.exe';

async function download() {
  const res = await fetch(VC_REDIST_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

async function main() {
  if (fs.existsSync(outPath)) {
    const stat = fs.statSync(outPath);
    if (stat.size > 1_000_000) {
      console.log('[download-vc-redist] build/vc_redist.x64.exe 已存在，跳过下载');
      return;
    }
  }
  console.log('[download-vc-redist] 正在下载 VC++ 运行库...');
  fs.mkdirSync(buildDir, { recursive: true });
  const buf = await download();
  fs.writeFileSync(outPath, buf);
  console.log(`[download-vc-redist] 已保存到 ${outPath} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((e) => {
  console.error('[download-vc-redist] 下载失败:', e.message);
  process.exit(1);
});
