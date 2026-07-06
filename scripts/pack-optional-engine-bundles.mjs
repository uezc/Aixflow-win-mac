#!/usr/bin/env node
/**
 * 将本地 resources/rvc/engine 与 resources/whisper（二进制+模型）打成 zip，
 * 供上传 OSS 后填入 manifest.bundleUrl。
 *
 * 大文件（>2GB）使用系统 tar 打包，避免 Node readFileSync 限制。
 *
 * 用法: npm run pack:optional-bundles
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createReadStream } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'release', 'optional-bundles');

const RVC_ENGINE_DIR = path.join(root, 'resources', 'rvc', 'engine');
const WHISPER_DIR = path.join(root, 'resources', 'whisper');

const WHISPER_INCLUDE = [
  'whisper-cli.exe',
  'main.exe',
  'whisper.dll',
  'ggml.dll',
  'ggml-base.dll',
  'ggml-cpu.dll',
  'SDL2.dll',
  'ggml-base.bin',
  'ggml-tiny.bin',
  'ggml-small.bin',
  'ggml-medium.bin',
];

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function zipDirWithTar(srcDir, zipPath) {
  if (!fs.existsSync(srcDir)) {
    throw new Error(`源目录不存在: ${srcDir}`);
  }
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  console.log(`[pack-optional-bundles] tar 打包: ${srcDir} → ${zipPath}`);
  const result = spawnSync('tar', ['-a', '-cf', zipPath, '-C', srcDir, '.'], {
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`tar 打包失败 (exit ${result.status ?? 'unknown'})`);
  }
}

function zipFilesWithTar(srcDir, fileNames, zipPath) {
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  console.log(`[pack-optional-bundles] tar 打包 ${fileNames.length} 个文件 → ${zipPath}`);
  const result = spawnSync('tar', ['-a', '-cf', zipPath, '-C', srcDir, ...fileNames], {
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`tar 打包失败 (exit ${result.status ?? 'unknown'})`);
  }
}

async function packRvc() {
  if (!fs.existsSync(path.join(RVC_ENGINE_DIR, 'rvc_infer_cli.exe'))) {
    console.warn('[pack-optional-bundles] 跳过 RVC：未找到 resources/rvc/engine/rvc_infer_cli.exe');
    console.warn('  请先执行: python scripts/build-rvc-cli/build_rvc.py');
    return null;
  }
  const zipName = 'rvc-engine-win-x64-1.0.0.zip';
  const zipPath = path.join(outDir, zipName);
  zipDirWithTar(RVC_ENGINE_DIR, zipPath);
  const sha = await sha256File(zipPath);
  const size = fs.statSync(zipPath).size;
  console.log(`[pack-optional-bundles] RVC: ${zipPath} (${(size / 1e9).toFixed(2)} GB, sha256=${sha.slice(0, 16)}…)`);
  return { zipName, sha, size };
}

async function packWhisper() {
  const fileNames = [];
  let modelFile = 'ggml-base.bin';
  for (const name of WHISPER_INCLUDE) {
    const full = path.join(WHISPER_DIR, name);
    if (!fs.existsSync(full)) continue;
    const st = fs.statSync(full);
    if (name.endsWith('.bin') && st.size < 65_000_000) continue;
    fileNames.push(name);
    if (name.endsWith('.bin')) modelFile = name;
  }
  if (fileNames.length === 0) {
    console.warn('[pack-optional-bundles] 跳过 Whisper：resources/whisper 下无可打包文件');
    console.warn('  请先下载 whisper.cpp 二进制与 ggml-base.bin（npm run download-whisper-model）');
    return null;
  }
  const zipName = 'whisper-engine-win-x64-base-1.0.0.zip';
  const zipPath = path.join(outDir, zipName);
  zipFilesWithTar(WHISPER_DIR, fileNames, zipPath);
  const sha = await sha256File(zipPath);
  const size = fs.statSync(zipPath).size;
  console.log(
    `[pack-optional-bundles] Whisper: ${zipPath} (${(size / 1e6).toFixed(0)} MB, model=${modelFile}, sha256=${sha.slice(0, 16)}…)`,
  );
  return { zipName, sha, size, modelFile };
}

function patchManifest(relPath, patch) {
  const p = path.join(root, relPath);
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  Object.assign(data, patch);
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const rvc = await packRvc();
  const whisper = await packWhisper();
  if (rvc) {
    patchManifest('resources/rvc/manifest.json', { sha256: rvc.sha, sizeBytes: rvc.size });
  }
  if (whisper) {
    patchManifest('resources/whisper/manifest.json', {
      sha256: whisper.sha,
      sizeBytes: whisper.size,
      modelFile: whisper.modelFile,
    });
  }
  console.log('[pack-optional-bundles] 完成。请执行: npm run upload:optional-bundles');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
