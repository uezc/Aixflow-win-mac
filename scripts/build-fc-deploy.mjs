/**
 * FC 部署包：dist_final/ + aixflow-final.zip
 * - index.mjs、package.json、node_modules、lib 来自 demo/aliyun-fc-init-user
 * - pricing/ 始终从仓库根目录 pricing/ 复制（避免漏打 zip 导致 /code/pricing 缺失）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const demo = path.join(root, 'demo', 'aliyun-fc-init-user');
const distFinal = path.join(root, 'dist_final');
const pricingRoot = path.join(root, 'pricing');
const zipPath = path.join(root, 'aixflow-final.zip');

const requiredPricing = [
  'price_calculator.mjs',
  'cost_table.mjs',
  'markup_table.mjs',
  'price_tiers.mjs',
  'videoBillingSku.mjs',
  'videoBillingCloud.mjs',
];

for (const f of requiredPricing) {
  const p = path.join(pricingRoot, f);
  if (!fs.existsSync(p)) {
    console.error('[build-fc-deploy] Missing canonical file:', p);
    process.exit(1);
  }
}

if (!fs.existsSync(path.join(demo, 'index.mjs'))) {
  console.error('[build-fc-deploy] Missing:', path.join(demo, 'index.mjs'));
  process.exit(1);
}
if (!fs.existsSync(path.join(demo, 'node_modules'))) {
  console.error('[build-fc-deploy] Run npm install in demo/aliyun-fc-init-user first.');
  process.exit(1);
}

console.log('[build-fc-deploy] Clean dist_final...');
fs.rmSync(distFinal, { recursive: true, force: true });
fs.mkdirSync(distFinal, { recursive: true });

fs.copyFileSync(path.join(demo, 'index.mjs'), path.join(distFinal, 'index.mjs'));
fs.copyFileSync(path.join(demo, 'package.json'), path.join(distFinal, 'package.json'));
const plock = path.join(demo, 'package-lock.json');
if (fs.existsSync(plock)) fs.copyFileSync(plock, path.join(distFinal, 'package-lock.json'));

console.log('[build-fc-deploy] Copy node_modules (large)...');
fs.cpSync(path.join(demo, 'node_modules'), path.join(distFinal, 'node_modules'), { recursive: true });

console.log('[build-fc-deploy] Copy lib...');
fs.cpSync(path.join(demo, 'lib'), path.join(distFinal, 'lib'), { recursive: true });

console.log('[build-fc-deploy] Copy pricing from repo root (canonical)...');
fs.cpSync(pricingRoot, path.join(distFinal, 'pricing'), { recursive: true });

const check = path.join(distFinal, 'pricing', 'price_calculator.mjs');
if (!fs.existsSync(check)) {
  console.error('[build-fc-deploy] ASSERT FAIL: missing', check);
  process.exit(1);
}
console.log('[build-fc-deploy] Verified:', check);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

// 必须用 tar 打 zip：PowerShell Compress-Archive 会写入反斜杠路径（lib\xxx.mjs），
// 阿里云 Linux FC 解压后无法形成 lib/ 目录，导致 ERR_MODULE_NOT_FOUND。
const tmpDir = path.join(root, '.tmp');
fs.mkdirSync(tmpDir, { recursive: true });
console.log('[build-fc-deploy] Zip -> aixflow-final.zip (tar, forward-slash paths)');
const r = spawnSync('tar', ['-a', '-cf', zipPath, '.'], {
  cwd: distFinal,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, TEMP: tmpDir, TMP: tmpDir },
});
if (r.status !== 0) {
  console.error('[build-fc-deploy] tar 失败 exit', r.status);
  process.exit(r.status ?? 1);
}

const mb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(2);
console.log('[build-fc-deploy] Done:', zipPath, `(${mb} MB)`);
