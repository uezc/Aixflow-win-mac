#!/usr/bin/env node
/**
 * 阿里云 FC 部署脚本
 * 精简模式：仅打包 tablestore 依赖（约 3MB），10 秒内完成
 * 完整模式：打包全部 node_modules（需 7z 或等 1–2 分钟）
 */
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
/** 与 index.mjs 同目录的 pricing（deploy 包必须与 FC 源码一致；勿再用仓库根 pricing 以免与 demo 分叉） */
const PRICING_SRC = path.join(ROOT, 'pricing');
const OUT_ZIP = path.join(ROOT, 'nexflow-fc.zip');
const OUT_ZIP_NEW = path.join(ROOT, 'nexflow-fc-new.zip');
const TMP = path.join(ROOT, '.deploy-tmp');

// 精简打包：含 Tablestore/JWT/密码 + Resend（POST /auth/send-code 动态 import 依赖）
const MINIMAL_PKG = {
  name: 'nexflow-fc-init-user',
  version: '1.0.0',
  type: 'module',
  dependencies: {
    'ali-oss': '^6.23.0',
    tablestore: '^5.2.0',
    jsonwebtoken: '^9.0.2',
    bcryptjs: '^2.4.3',
    resend: '^4.0.1',
  },
};

console.log('[deploy-fc] 工作目录:', ROOT);
if (!fs.existsSync(PRICING_SRC)) {
  console.error('[deploy-fc] 缺少定价目录:', PRICING_SRC);
  process.exit(1);
}
const FC_ENTRY = fs.existsSync(path.join(ROOT, 'index.mjs'))
  ? path.join(ROOT, 'index.mjs')
  : fs.existsSync(path.join(ROOT, 'app.mjs'))
    ? path.join(ROOT, 'app.mjs')
    : null;
if (!FC_ENTRY || !fs.existsSync(path.join(ROOT, 'lib/db-tablestore.mjs'))) {
  console.error('[deploy-fc] 缺少 app.mjs（或 index.mjs）或 lib/db-tablestore.mjs');
  process.exit(1);
}
console.log('[deploy-fc] ✓', path.basename(FC_ENTRY), '→ index.mjs');

// 精简打包：只装 tablestore
if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'index.mjs'), fs.readFileSync(FC_ENTRY));
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify(MINIMAL_PKG, null, 2));
const LIB_SRC = path.join(ROOT, 'lib');
fs.mkdirSync(path.join(TMP, 'lib'), { recursive: true });
const libFiles = fs.readdirSync(LIB_SRC).filter((f) => f.endsWith('.mjs'));
for (const f of libFiles) {
  fs.copyFileSync(path.join(LIB_SRC, f), path.join(TMP, 'lib', f));
}
console.log('[deploy-fc] lib/*.mjs:', libFiles.join(', '));
fs.mkdirSync(path.join(TMP, 'pricing'), { recursive: true });
const pricingFiles = fs.readdirSync(PRICING_SRC).filter((f) => f.endsWith('.mjs'));
for (const f of pricingFiles) {
  fs.copyFileSync(path.join(PRICING_SRC, f), path.join(TMP, 'pricing', f));
}
console.log('[deploy-fc] pricing/*.mjs:', pricingFiles.join(', '));

console.log('[deploy-fc] 安装依赖（tablestore + jwt + bcrypt + resend）...');
execSync('npm install', { cwd: TMP, stdio: 'pipe' });

// 优先 7z，输出到 NEW 文件（避免覆盖被锁定的 zip）
function run7z() {
  const opts = { cwd: TMP, stdio: 'pipe', timeout: 30000, shell: true };
  for (const p7z of ['7z', 'C:\\Program Files\\7-Zip\\7z.exe', 'C:\\Program Files (x86)\\7-Zip\\7z.exe']) {
    try {
      const r = spawnSync(p7z, ['a', '-tzip', '-y', '-mx1', OUT_ZIP_NEW, 'index.mjs', 'package.json', 'lib', 'pricing', 'node_modules'],
        { ...opts, cwd: TMP });
      if (r.status === 0) return true;
    } catch (e) { continue; }
  }
  return false;
}

[OUT_ZIP_NEW, OUT_ZIP + '.tmp'].forEach((f) => { try { fs.unlinkSync(f); } catch (e) {} });

if (run7z()) {
  try {
    fs.renameSync(OUT_ZIP_NEW, OUT_ZIP);
    console.log('[deploy-fc] 已生成:', OUT_ZIP);
  } catch (e) {
    console.log('[deploy-fc] 已生成:', OUT_ZIP_NEW, '(请手动替换 nexflow-fc.zip)');
  }
} else {
  console.log('[deploy-fc] 使用 adm-zip 打包...');
  let AdmZip;
  try { AdmZip = require(path.resolve(ROOT, '../../node_modules/adm-zip')); } catch (e) { AdmZip = require('adm-zip'); }
  const zip = new AdmZip();
  zip.addLocalFolder(TMP, '.');
  zip.writeZip(OUT_ZIP_NEW);
  try {
    fs.renameSync(OUT_ZIP_NEW, OUT_ZIP);
    console.log('[deploy-fc] 已生成:', OUT_ZIP);
  } catch (e) {
    console.log('[deploy-fc] 已生成:', OUT_ZIP_NEW, '(请手动替换 nexflow-fc.zip)');
  }
}

fs.rmSync(TMP, { recursive: true, force: true });

// 验证（adm-zip 可能无法解析 7z 生成的 zip，仅做基础检查）
const finalZip = fs.existsSync(OUT_ZIP) ? OUT_ZIP : OUT_ZIP_NEW;
const stat = fs.statSync(finalZip);
console.log('[deploy-fc] 大小:', (stat.size / 1024 / 1024).toFixed(2), 'MB');
try {
  const AdmZipVerify = require(path.resolve(ROOT, '../../node_modules/adm-zip'));
  const verify = new AdmZipVerify(finalZip);
  const entries = verify.getEntries();
  const hasIndex = entries.some((e) => e.entryName.includes('index.mjs'));
  const hasLibDb = entries.some((e) => e.entryName.includes('lib/db-tablestore.mjs'));
  const hasLibCors = entries.some((e) => e.entryName.includes('lib/cors-admin-headers.mjs'));
  const hasPricing = entries.some(
    (e) => e.entryName.includes('price_calculator.mjs') && /pricing[\\/]/i.test(e.entryName),
  );

  const hasTablestore = entries.some((e) => e.entryName.includes('node_modules/tablestore'));
  const hasResend = entries.some((e) => e.entryName.includes('node_modules/resend'));
  console.log(
    '[deploy-fc] 验证: index.mjs=',
    !!hasIndex,
    '| lib/db=',
    !!hasLibDb,
    '| lib/cors=',
    !!hasLibCors,
    '| pricing=',
    !!hasPricing,
    '| tablestore=',
    !!hasTablestore,
    '| resend=',
    !!hasResend,
  );
  if (!hasIndex || !hasLibDb || !hasLibCors || !hasPricing) process.exit(1);
} catch (e) {
  console.log('[deploy-fc] 跳过格式验证（7z 生成）');
}
console.log('[deploy-fc] 部署包已就绪:', finalZip);
console.log('[deploy-fc] 上传方式任选：');
console.log('[deploy-fc]   1) 阿里云 FC 控制台 → 函数 → 上传代码 → 选择本 zip');
console.log('[deploy-fc]   2) Serverless Devs：先 npm i -g @serverless-devs/s，再在仓库根目录执行 s deploy（见 s.yaml）');
console.log('[deploy-fc]   若未装 s：也可 npx @serverless-devs/s deploy（需在项目根且已配置 access）');
