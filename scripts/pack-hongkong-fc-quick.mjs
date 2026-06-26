#!/usr/bin/env node
/** 增量刷新 dist-hongkong-fc 源码并 tar 成 zip（不重新 npm install，适合 C 盘满） */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const demo = path.join(root, 'demo', 'aliyun-fc-init-user');
const outDir = path.join(root, 'dist-hongkong-fc');
const zipPath = path.join(root, 'dist-hongkong-fc.zip');
const pricingRoot = path.join(root, 'pricing');
const tmpDir = path.join(root, '.tmp');

if (!fs.existsSync(path.join(outDir, 'node_modules'))) {
  console.error('[pack-hongkong-fc-quick] 缺少 dist-hongkong-fc/node_modules，请先在本机成功执行过一次 npm run fc:pack-hk');
  process.exit(1);
}

fs.mkdirSync(tmpDir, { recursive: true });

console.log('[pack-hongkong-fc-quick] 刷新 index.mjs / lib / pricing ...');
fs.copyFileSync(path.join(demo, 'index.mjs'), path.join(outDir, 'index.mjs'));
fs.copyFileSync(path.join(demo, 'package.json'), path.join(outDir, 'package.json'));
const plock = path.join(demo, 'package-lock.json');
if (fs.existsSync(plock)) fs.copyFileSync(plock, path.join(outDir, 'package-lock.json'));

const libSrc = path.join(demo, 'lib');
const libDst = path.join(outDir, 'lib');
fs.cpSync(libSrc, libDst, { recursive: true, force: true });
fs.cpSync(pricingRoot, path.join(outDir, 'pricing'), { recursive: true, force: true });

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

console.log('[pack-hongkong-fc-quick] tar 打包 ->', zipPath);
const r = spawnSync('tar', ['-a', '-cf', zipPath, '.'], {
  cwd: outDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, TEMP: tmpDir, TMP: tmpDir },
});
if (r.status !== 0) {
  console.error('[pack-hongkong-fc-quick] tar 失败 exit', r.status);
  process.exit(r.status ?? 1);
}

const mb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(2);
console.log('[pack-hongkong-fc-quick] 完成:', zipPath, `(${mb} MB)`);
