#!/usr/bin/env node
/**
 * electron-builder 完成后校验 nsis-web 三件套（latest.yml、*.nsis.7z、stub .exe）是否同一轮构建。
 * 避免 yml 与 7z 校验不一致导致安装器忽略本地包并去 OSS 下载（404）。
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const nsisWebDir = path.join(projectRoot, 'release', 'nsis-web');

function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
  return pkg.version || '0.0.0';
}

function sha512Base64(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('base64')));
  });
}

function parseLatestYml(content) {
  const pkg = {};
  const lines = content.split(/\r?\n/);
  let inPackagesX64 = false;
  for (const line of lines) {
    if (/^packages:/.test(line)) {
      inPackagesX64 = false;
      continue;
    }
    if (/^  x64:/.test(line)) {
      inPackagesX64 = true;
      continue;
    }
    if (inPackagesX64 && /^  [a-zA-Z]/.test(line) && !/^    /.test(line)) {
      inPackagesX64 = false;
    }
    const m = line.match(/^    (path|file|size|sha512):\s*(.+)$/);
    if (inPackagesX64 && m) {
      pkg[m[1]] = m[2].trim();
    }
    const pathM = line.match(/^path:\s*(.+)$/);
    if (pathM) pkg.stubExe = pathM[1].trim();
  }
  return pkg;
}

async function main() {
  const version = readVersion();
  const ymlPath = path.join(nsisWebDir, 'latest.yml');
  if (!fs.existsSync(ymlPath)) {
    console.error('[verify-nsis-web] 缺少 release/nsis-web/latest.yml，请先完整执行 npm run electron:build');
    process.exit(1);
  }

  const yml = parseLatestYml(fs.readFileSync(ymlPath, 'utf-8'));
  const sevenZName = yml.path || yml.file || `nexflow-${version}-x64.nsis.7z`;
  const sevenZPath = path.join(nsisWebDir, sevenZName);
  const stubName = yml.stubExe || `Aixflow-Windows-Setup-${version}.exe`;
  const stubPath = path.join(nsisWebDir, stubName);

  if (!fs.existsSync(sevenZPath)) {
    console.error('[verify-nsis-web] 缺少', sevenZPath);
    process.exit(1);
  }
  if (!fs.existsSync(stubPath)) {
    console.error('[verify-nsis-web] 缺少', stubPath);
    process.exit(1);
  }

  const actualSize = fs.statSync(sevenZPath).size;
  const expectedSize = yml.size ? Number(yml.size) : null;
  const actualSha = await sha512Base64(sevenZPath);
  const expectedSha = yml.sha512 || '';

  const ymlMtime = fs.statSync(ymlPath).mtimeMs;
  const sevenZMtime = fs.statSync(sevenZPath).mtimeMs;
  const stubMtime = fs.statSync(stubPath).mtimeMs;
  const maxDeltaMs = 10 * 60 * 1000;
  if (Math.abs(ymlMtime - sevenZMtime) > maxDeltaMs || Math.abs(stubMtime - sevenZMtime) > maxDeltaMs) {
    console.warn(
      '[verify-nsis-web] 警告：latest.yml / .7z / .exe 修改时间相差超过 10 分钟，可能来自多次不完整构建。',
    );
  }

  if (expectedSize != null && expectedSize !== actualSize) {
    console.error(
      `[verify-nsis-web] 7z 体积与 latest.yml 不一致：yml=${expectedSize} 实际=${actualSize}。请删除 release/nsis-web 下本版本文件后重新 npm run electron:build。`,
    );
    process.exit(1);
  }

  if (expectedSha && expectedSha !== actualSha) {
    console.error('[verify-nsis-web] 7z 校验和与 latest.yml 不一致，离线安装会失败并尝试从 OSS 下载。');
    console.error('  expected:', expectedSha);
    console.error('  actual:  ', actualSha);
    console.error('  请删除 release/nsis-web 下本版本 *.exe / *.7z / latest.yml 后，一次性执行 npm run electron:build。');
    process.exit(1);
  }

  console.log('[verify-nsis-web] 通过：', stubName, '+', sevenZName, `(${(actualSize / 1024 / 1024 / 1024).toFixed(2)} GB)`);
  console.log('[verify-nsis-web] 离线安装：将上述两个文件放在同一文件夹内，再运行 exe（勿只复制 exe）。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
