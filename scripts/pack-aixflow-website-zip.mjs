#!/usr/bin/env node
/**
 * 打包 aixflow.com.cn 官网静态资源（落地页 + 充值公示页 + 依赖 JS/CSS）。
 *
 * 用法: node scripts/pack-aixflow-website-zip.mjs
 * 产物: release/Aixflow-Website-{version}.zip
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

/** 从 HTML 抽取 ../assets/ 或 /assets/ 或 ./assets/ 引用的文件名 */
function assetNamesFromHtml(html) {
  const names = new Set();
  const re = /(?:src|href)=["'](?:\.\.\/assets\/|\/assets\/|\.\/assets\/)([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) names.add(m[1]);
  return names;
}

function ensureHtmlRelPaths(html) {
  // 若构建已是 ../assets，保持；若是 /assets 或 ./assets，改成 ../assets
  return html
    .replace(/(href|src)="\/assets\//g, '$1="../assets/')
    .replace(/(href|src)="\.\/assets\//g, '$1="../assets/')
    .replace(/(href|src)="\/icon\.png"/g, '$1="../icon.png"')
    .replace(/(href|src)="\.\/icon\.png"/g, '$1="../icon.png"');
}

function main() {
  const landingIndex = path.join(dist, 'public', 'index.html');
  const rechargeIndex = path.join(dist, 'public', 'recharge.html');
  const installerIndex = path.join(dist, 'public', 'installer.html');
  mustExist(landingIndex, '请先执行: npm run build:renderer');
  mustExist(rechargeIndex, '请先执行: npm run build:renderer（需生成 public/recharge.html）');
  mustExist(installerIndex, '请先执行: npm run build:renderer（需生成 public/installer.html）');
  mustExist(path.join(dist, 'icon.png'));

  const landingHtml = fs.readFileSync(landingIndex, 'utf8');
  const rechargeHtml = fs.readFileSync(rechargeIndex, 'utf8');
  const installerHtml = fs.readFileSync(installerIndex, 'utf8');
  const assetNames = new Set([
    ...assetNamesFromHtml(landingHtml),
    ...assetNamesFromHtml(rechargeHtml),
    ...assetNamesFromHtml(installerHtml),
  ]);

  // 品牌图可能被 JS 动态引用，尽量带上
  const assetsDir = path.join(dist, 'assets');
  for (const f of fs.readdirSync(assetsDir)) {
    if (/^aixflow-brand-logo-.*\.png$/i.test(f)) assetNames.add(f);
  }

  if (![...assetNames].some((n) => /^aixflowLanding-.*\.js$/i.test(n))) {
    console.error('[pack-website] HTML 未引用 aixflowLanding-*.js');
    process.exit(1);
  }
  if (![...assetNames].some((n) => /^aixflowRecharge-.*\.js$/i.test(n))) {
    console.error('[pack-website] HTML 未引用 aixflowRecharge-*.js');
    process.exit(1);
  }
  if (![...assetNames].some((n) => /^aixflowInstaller-.*\.js$/i.test(n))) {
    console.error('[pack-website] HTML 未引用 aixflowInstaller-*.js');
    process.exit(1);
  }

  const zipPath = path.join(root, 'release', `Aixflow-Website-${version}.zip`);
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  const zip = new AdmZip();
  zip.addFile('site/index.html', Buffer.from(ensureHtmlRelPaths(landingHtml), 'utf8'));
  zip.addFile('site/recharge.html', Buffer.from(ensureHtmlRelPaths(rechargeHtml), 'utf8'));
  zip.addFile('site/installer.html', Buffer.from(ensureHtmlRelPaths(installerHtml), 'utf8'));
  zip.addFile('site/icon.png', fs.readFileSync(path.join(dist, 'icon.png')));

  for (const name of assetNames) {
    const p = path.join(assetsDir, name);
    mustExist(p, `HTML 引用了缺失资源: ${name}`);
    zip.addFile(`site/assets/${name}`, fs.readFileSync(p));
  }

  const readme = `Aixflow 官网静态包 v${version}

解压后目录:
  site/index.html
  site/recharge.html   ← 元宝充值套餐公示（支付宝合规）
  site/installer.html  ← 网页下载辅助（可选，非主入口）
  site/icon.png
  site/assets/

主下载路径（用户点「下载安装」）:
  直链 OSS Aixflow-Windows-Setup-{version}.exe（NSIS 在线安装 stub，~1MB）
  本机运行 stub → 下载完整包 → 可选安装路径 → 安装客户端

部署（国内站 nginx，路径保持 ../assets）：
  sudo cp site/index.html /var/www/aixflow/public/index.html
  sudo cp site/recharge.html /var/www/aixflow/public/recharge.html
  sudo cp site/installer.html /var/www/aixflow/public/installer.html
  sudo cp site/icon.png /var/www/aixflow/icon.png
  sudo cp -r site/assets/* /var/www/aixflow/assets/

海外站 aixflow.ai（当前多在 Cloudflare，需换成与 .com.cn 同一套 Vite 站）：
  1) Cloudflare Pages：以 site/ 为根上传；HTML 内 ../assets 需先改为 ./assets（脚本：upload-website-static-to-hk-oss.mjs）
  2) 或 CF 源站指到与 .com.cn 相同的 Nginx，并清 CF 缓存
  3) 预览（香港 OSS）: node scripts/upload-website-static-to-hk-oss.mjs

同一静态包可部署到国内站与海外站（运行时按域名选北京/香港下载与视频）：
  https://aixflow.com.cn/
  https://aixflow.ai/

验证:
  https://aixflow.com.cn/          ← 「下载安装」应触发 Setup .exe 下载（非打开 installer.html）
  https://aixflow.com.cn/recharge.html
  https://aixflow.com.cn/installer.html  ← 可选辅助页，非主入口
  https://aixflow.ai/

支付宝合规建议提交: https://aixflow.com.cn/recharge.html

官网视频需双桶同名对象（北京 ↔ 香港）:
  node scripts/sync-website-media-bj-hk.mjs
`;
  zip.addFile('DEPLOY.txt', Buffer.from(readme, 'utf8'));
  zip.writeZip(zipPath);

  console.log(`[pack-website] 已生成 ${zipPath}`);
  console.log(`[pack-website] 资源 ${assetNames.size} 个: ${[...assetNames].sort().join(', ')}`);
}

main();
