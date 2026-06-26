#!/usr/bin/env node
/**
 * 一键改价：改好仓库根目录 pricing/*.mjs 后执行本脚本即可串联
 *   ① 复制 pricing → demo/aliyun-fc-init-user/pricing（与 FC 部署包一致）
 *   ② 若已配置 OTS_*：写入 nx_model_config（与客户端 /model-config 展示一致）
 *   ③ 生成 nexflow-fc.zip（需上传 FC 后真实扣费才生效）
 *
 * 用法：
 *   npm run publish:pricing
 *   npm run publish:pricing -- --dry-run          # 不复制、不打 zip；仅 OTS --dry-run 清单
 *   npm run publish:pricing -- --skip-ots        # 只复制 + 打 zip
 *   npm run publish:pricing -- --skip-zip         # 只复制 + 同步 OTS
 *   npm run publish:pricing -- --help
 *
 * 依赖：项目根 .env 中 OTS_ENDPOINT、OTS_INSTANCE、OTS_ID+OTS_SECRET（可选，缺则跳过②）
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PRICING_SRC = path.join(ROOT, 'pricing');
const PRICING_DST = path.join(ROOT, 'demo', 'aliyun-fc-init-user', 'pricing');

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`
npm run publish:pricing

改价后一条命令：同步 demo 侧 pricing →（可选）OTS →（可选）FC zip。

选项：
  --dry-run    ① 不复制 ② OTS 仅 dry-run ③ 不打 zip
  --skip-ots   不写 Tablestore
  --skip-zip   不执行 npm run deploy（不打 zip）

仍需手动：将 demo/aliyun-fc-init-user/nexflow-fc.zip 上传到阿里云 FC。
`);
  process.exit(0);
}

const dryRun = argv.includes('--dry-run');
const skipOts = argv.includes('--skip-ots');
const skipZip = argv.includes('--skip-zip');

function copyPricing() {
  if (!fs.existsSync(PRICING_SRC)) {
    console.error('[publish-pricing] 缺少目录:', PRICING_SRC);
    process.exit(1);
  }
  if (!fs.existsSync(path.join(ROOT, 'demo', 'aliyun-fc-init-user'))) {
    console.error('[publish-pricing] 缺少 demo/aliyun-fc-init-user');
    process.exit(1);
  }
  if (!fs.existsSync(PRICING_DST)) {
    fs.mkdirSync(PRICING_DST, { recursive: true });
  }
  const files = fs.readdirSync(PRICING_SRC).filter((f) => f.endsWith('.mjs'));
  if (files.length === 0) {
    console.error('[publish-pricing] pricing/ 下没有 .mjs');
    process.exit(1);
  }
  console.log('[publish-pricing] ① 复制 pricing/*.mjs → demo/aliyun-fc-init-user/pricing/');
  for (const f of files) {
    const src = path.join(PRICING_SRC, f);
    const dst = path.join(PRICING_DST, f);
    if (dryRun) {
      console.log('  (dry-run，未写入)', f);
    } else {
      fs.copyFileSync(src, dst);
      console.log('  ✓', f);
    }
  }
}

function otsEnvOk() {
  const ep = process.env.OTS_ENDPOINT?.trim();
  const inst = process.env.OTS_INSTANCE?.trim();
  const id = process.env.OTS_ID?.trim() || process.env.OTS_ACCESS_KEY_ID?.trim();
  const sec = process.env.OTS_SECRET?.trim() || process.env.OTS_ACCESS_KEY_SECRET?.trim();
  return Boolean(ep && inst && id && sec);
}

function runSyncOts() {
  if (skipOts) {
    console.log('[publish-pricing] ② 跳过 OTS（--skip-ots）');
    return;
  }
  if (!otsEnvOk()) {
    console.warn(
      '[publish-pricing] ② 跳过 OTS：未配置完整 OTS_ENDPOINT / OTS_INSTANCE / OTS_ID+OTS_SECRET（或 ACCESS_KEY 别名）。',
    );
    console.warn('     需要同步界面价时请配置 .env 后执行：npm run sync:pricing-ots');
    return;
  }
  console.log('[publish-pricing] ② 同步 Tablestore nx_model_config …');
  const scriptPath = path.join(ROOT, 'scripts', 'sync-pricing-to-ots.mjs');
  const extra = dryRun ? ['--dry-run'] : [];
  const r = spawnSync(process.execPath, [scriptPath, ...extra], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function runDeployZip() {
  if (skipZip) {
    console.log('[publish-pricing] ③ 跳过打 zip（--skip-zip）');
    return;
  }
  if (dryRun) {
    console.log('[publish-pricing] ③ (dry-run) 跳过：npm run deploy（加 --skip-zip 可配合仅测 OTS）');
    return;
  }
  console.log('[publish-pricing] ③ 打包 FC：nexflow-fc.zip …');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npmCmd, ['run', 'deploy', '--prefix', 'demo/aliyun-fc-init-user'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log('[publish-pricing] 定价源：仓库根目录 pricing/（请先保存修改）\n');
copyPricing();
runSyncOts();
runDeployZip();
console.log('\n[publish-pricing] 完成。');
if (!skipZip && !dryRun) {
  console.log('  → 请将 demo/aliyun-fc-init-user/nexflow-fc.zip 上传到阿里云 FC 函数。');
}
console.log('  → 客户端未登录时的展示价来自打包进前端的 pricing；发版或 npm run build:renderer 后更新。');
