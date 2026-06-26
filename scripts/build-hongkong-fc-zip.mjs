/**
 * 香港 FC 部署包：仓库根目录 dist-hongkong-fc.zip
 * 内容与 fc:pack（dist_final）一致：demo/aliyun-fc-init-user 的 index、lib、node_modules、package.json
 * + 仓库根目录 pricing/（与 index.mjs 运行时 import 一致）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const demo = path.join(root, 'demo', 'aliyun-fc-init-user');
const outDir = path.join(root, 'dist-hongkong-fc');
const zipPath = path.join(root, 'dist-hongkong-fc.zip');
const pricingRoot = path.join(root, 'pricing');

const requiredPricing = [
  'price_calculator.mjs',
  'cost_table.mjs',
  'markup_table.mjs',
  'price_tiers.mjs',
  'videoBillingSku.mjs',
  'videoBillingCloud.mjs',
  'recharge_packages.mjs',
];

for (const f of requiredPricing) {
  const p = path.join(pricingRoot, f);
  if (!fs.existsSync(p)) {
    console.error('[build-hongkong-fc-zip] Missing canonical file:', p);
    process.exit(1);
  }
}

if (!fs.existsSync(path.join(demo, 'index.mjs'))) {
  console.error('[build-hongkong-fc-zip] Missing:', path.join(demo, 'index.mjs'));
  process.exit(1);
}
if (!fs.existsSync(path.join(demo, 'node_modules'))) {
  console.error('[build-hongkong-fc-zip] Run: cd demo/aliyun-fc-init-user && npm install');
  process.exit(1);
}

console.log('[build-hongkong-fc-zip] Clean', outDir);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

fs.copyFileSync(path.join(demo, 'index.mjs'), path.join(outDir, 'index.mjs'));
fs.copyFileSync(path.join(demo, 'package.json'), path.join(outDir, 'package.json'));
const plock = path.join(demo, 'package-lock.json');
if (fs.existsSync(plock)) fs.copyFileSync(plock, path.join(outDir, 'package-lock.json'));

console.log('[build-hongkong-fc-zip] Copy node_modules...');
fs.cpSync(path.join(demo, 'node_modules'), path.join(outDir, 'node_modules'), { recursive: true });

console.log('[build-hongkong-fc-zip] Copy lib/ (entire directory, recursive)...');
const libSrc = path.join(demo, 'lib');
const libDst = path.join(outDir, 'lib');
if (!fs.existsSync(libSrc)) {
  console.error('[build-hongkong-fc-zip] Missing source lib directory:', libSrc);
  process.exit(1);
}
fs.cpSync(libSrc, libDst, { recursive: true, force: true });

/** FC Linux 区分大小写：须与 import 路径一致（小写 lib/、*.mjs） */
const REQUIRED_LIB_FILES = [
  'cors-admin-headers.mjs',
  'aixflow-admin-oss.mjs',
  'oss-sdk-options.mjs',
  'db-tablestore.mjs',
  'db-oss-json.mjs',
];
for (const f of REQUIRED_LIB_FILES) {
  const p = path.join(libDst, f);
  if (!fs.existsSync(p)) {
    console.error('[build-hongkong-fc-zip] ASSERT: required file missing after copy:', p);
    process.exit(1);
  }
}
const libEntries = fs.readdirSync(libDst, { withFileTypes: true });
const libFileCount = libEntries.filter((e) => e.isFile()).length;
console.log('[build-hongkong-fc-zip] lib/ files:', libFileCount, libEntries.map((e) => e.name).join(', '));

console.log('[build-hongkong-fc-zip] Copy pricing from repo root...');
fs.cpSync(pricingRoot, path.join(outDir, 'pricing'), { recursive: true });

const check = path.join(outDir, 'pricing', 'price_calculator.mjs');
if (!fs.existsSync(check)) {
  console.error('[build-hongkong-fc-zip] ASSERT FAIL:', check);
  process.exit(1);
}

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

console.log('[build-hongkong-fc-zip] Zip -> dist-hongkong-fc.zip (tar on D:, avoids C: temp)');
const tarZip = spawnSync('tar', ['-a', '-cf', zipPath, '.'], {
  cwd: outDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, TEMP: path.join(root, '.tmp'), TMP: path.join(root, '.tmp') },
});
if (tarZip.status !== 0) {
  console.error('[build-hongkong-fc-zip] tar failed, exit', tarZip.status);
  process.exit(tarZip.status ?? 1);
}

console.log('[build-hongkong-fc-zip] Done:', zipPath);
