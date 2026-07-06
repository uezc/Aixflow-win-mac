#!/usr/bin/env node
/**
 * 打包 aixflow.com.cn 官网静态资源（落地页 + 依赖 JS/CSS）。
 * 部署后「开始使用」会从 OSS 拉 latest.yml，优先下载 Aixflow-Windows-Setup-{version}.exe（在线安装，无需解压）。
 *
 * 用法: node scripts/pack-aixflow-website-zip.mjs
 * 产物: release/Aixflow-Website-{version}.zip
 *
 * 服务器目录结构（与当前 nginx 一致）:
 *   {webroot}/index.html          ← dist/public/index.html
 *   {webroot}/../icon.png         ← dist/icon.png（index 里 ../icon.png）
 *   {webroot}/../assets/*         ← dist/assets/aixflowLanding-* + client + chevron
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;

function mustExist(p, hint) {
  if (!fs.existsSync(p)) {
    console.error(`[pack-website] 缺少: ${p}`);
    if (hint) console.error(hint);
    process.exit(1);
  }
}

function collectLandingAssets() {
  const assetsDir = path.join(dist, 'assets');
  mustExist(assetsDir, '请先执行: npm run build:renderer');
  const files = fs.readdirSync(assetsDir);
  const landingJs = files.filter((f) => /^aixflowLanding-.*\.js$/i.test(f));
  const landingCss = files.filter((f) => /^aixflowLanding-.*\.css$/i.test(f));
  const clientJs = files.filter((f) => /^client-.*\.js$/i.test(f));
  const chevronJs = files.filter((f) => /^chevron-right-.*\.js$/i.test(f));
  const brandPng = files.filter((f) => /^aixflow-brand-logo-.*\.png$/i.test(f));
  if (landingJs.length !== 1 || landingCss.length !== 1) {
    console.error('[pack-website] 未找到唯一的 aixflowLanding js/css，请先 npm run build:renderer');
    process.exit(1);
  }
  return {
    landingJs: landingJs[0],
    landingCss: landingCss[0],
    clientJs: clientJs[0],
    chevronJs: chevronJs[0],
    brandPng: brandPng[0],
  };
}

function main() {
  const landingIndex = path.join(dist, 'public', 'index.html');
  mustExist(landingIndex, '请先执行: npm run build:renderer');
  mustExist(path.join(dist, 'icon.png'));
  const a = collectLandingAssets();

  const zipPath = path.join(root, 'release', `Aixflow-Website-${version}.zip`);
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });

  const zip = new AdmZip();
  zip.addFile('site/index.html', fs.readFileSync(landingIndex));
  zip.addFile('site/icon.png', fs.readFileSync(path.join(dist, 'icon.png')));
  zip.addFile(`site/assets/${a.landingJs}`, fs.readFileSync(path.join(dist, 'assets', a.landingJs)));
  zip.addFile(`site/assets/${a.landingCss}`, fs.readFileSync(path.join(dist, 'assets', a.landingCss)));
  zip.addFile(`site/assets/${a.clientJs}`, fs.readFileSync(path.join(dist, 'assets', a.clientJs)));
  zip.addFile(`site/assets/${a.chevronJs}`, fs.readFileSync(path.join(dist, 'assets', a.chevronJs)));
  if (a.brandPng) {
    zip.addFile(`site/assets/${a.brandPng}`, fs.readFileSync(path.join(dist, 'assets', a.brandPng)));
  }

  const readme = `Aixflow 官网静态包 v${version}

解压后目录:
  site/index.html
  site/icon.png
  site/assets/

部署到 aixflow.com.cn（与现有 nginx 一致，index 使用 ../assets 与 ../icon.png）:

  方式 A — 站点根即 site/ 的上一级（推荐，与线上一致）:
    将 site/index.html  →  /var/www/aixflow/public/index.html  （或你当前的 web 根 index.html）
    将 site/icon.png    →  /var/www/aixflow/icon.png
    将 site/assets/*    →  /var/www/aixflow/assets/

  方式 B — 整包覆盖（备份后）:
    cd /var/www/aixflow && unzip -o Aixflow-Website-${version}.zip
    cp site/index.html public/index.html   # 若 nginx root 是 public/
    cp site/icon.png ./
    cp -r site/assets/* assets/

验证:
  1. 浏览器打开 https://aixflow.com.cn/ 强制刷新 Ctrl+F5
  2. 首屏按钮应先显示「准备下载…」再变为「开始使用」
  3. 点击应下载 Aixflow-Windows-Setup-${version}.exe（约 1MB 在线安装器，无需解压；安装时会自动下载完整包）

OSS 安装包须已 upload:release（含 latest.yml + stub exe + .nsis.7z）；离线 zip 仅作备用，官网不会优先使用。
`;
  zip.addFile('DEPLOY.txt', Buffer.from(readme, 'utf8'));
  zip.writeZip(zipPath);

  const jsText = fs.readFileSync(path.join(dist, 'assets', a.landingJs), 'utf8');
  const hasDownload =
    jsText.includes('latest.yml') &&
    jsText.includes('method:"HEAD"') &&
    jsText.includes('Aixflow-Windows-Offline');
  console.log(`[pack-website] 已生成 ${zipPath}`);
  console.log(`[pack-website] landing js: ${a.landingJs} | 含 OSS 下载逻辑: ${hasDownload ? '是' : '否'}`);
}

main();
