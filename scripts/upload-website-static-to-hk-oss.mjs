#!/usr/bin/env node
/**
 * 将官网静态站上传到香港 OSS，供 aixflow.ai（Cloudflare）同源替换成与 .com.cn 相同设计。
 *
 * 用法:
 *   1) npm run build:renderer && node scripts/pack-aixflow-website-zip.mjs
 *   2) node scripts/upload-website-static-to-hk-oss.mjs
 *
 * 上传前缀: aixflow-web/（对象示例 aixflow-web/index.html）
 * 公网根:   https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/aixflow-web/
 */
import OSS from 'ali-oss';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const zipPath = path.join(root, 'release', `Aixflow-Website-${version}.zip`);
const PREFIX = String(process.env.OSS_WEBSITE_HK_PREFIX || 'aixflow-web').replace(/^\/+|\/+$/g, '');

function decodeBase64Utf8(v) {
  try {
    return Buffer.from(String(v || ''), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function loadHkClient() {
  const accessKeyId = String(
    process.env.OSS_ACCESS_KEY_ID || decodeBase64Utf8('TFRBSTV0N3BKRFo1clpqVEJ5RHJVc0tX'),
  ).trim();
  const accessKeySecret = String(
    process.env.OSS_ACCESS_KEY_SECRET || decodeBase64Utf8('eDBOcG80dWx1TnltN3ZkZGJtYXVaamtRemg4NUNF'),
  ).trim();
  const region = String(process.env.OSS_RELEASE_HK_REGION || process.env.OSS_REGION || 'oss-cn-hongkong').trim();
  const bucket = String(process.env.OSS_RELEASE_HK_BUCKET || process.env.OSS_BUCKET || 'nexflow-temp-images').trim();
  return { client: new OSS({ region, accessKeyId, accessKeySecret, bucket, timeout: 600000 }), bucket, region };
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
  };
  return map[ext] || 'application/octet-stream';
}

/** OSS 静态站根路径下需要用相对路径引用 assets，zip 内已是 site/index.html + site/assets */
function rewriteHtmlForOssPrefix(html) {
  // zip 内是 ../assets/（相对 public→上一级），OSS 前缀下应改为 ./assets/
  return html
    .replace(/(href|src)="\.\.\/assets\//g, '$1="./assets/')
    .replace(/(href|src)="\.\.\/icon\.png"/g, '$1="./icon.png"');
}

async function main() {
  if (!fs.existsSync(zipPath)) {
    console.error(`[upload-website-hk] 缺少 ${zipPath}，请先 pack`);
    process.exit(1);
  }
  const { client, bucket } = loadHkClient();
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries().filter((e) => !e.isDirectory && String(e.entryName).startsWith('site/'));
  if (entries.length === 0) {
    console.error('[upload-website-hk] zip 内无 site/ 文件');
    process.exit(1);
  }

  console.log(`[upload-website-hk] bucket=${bucket} prefix=${PREFIX}/  files=${entries.length}`);

  for (const entry of entries) {
    const rel = entry.entryName.replace(/^site\//, '');
    const key = `${PREFIX}/${rel}`.replace(/\\/g, '/');
    let buf = entry.getData();
    if (/\.html$/i.test(rel)) {
      buf = Buffer.from(rewriteHtmlForOssPrefix(buf.toString('utf8')), 'utf8');
    }
    const headers = {
      'Content-Type': contentTypeFor(rel),
      'Cache-Control': /\.html$/i.test(rel) ? 'public, max-age=60' : 'public, max-age=31536000, immutable',
      // 避免桶默认 force-download，便于浏览器直接打开预览
      'Content-Disposition': 'inline',
    };
    await client.put(key, buf, { headers });
    console.log(`[upload-website-hk] put ${key} (${buf.length} B)`);
  }

  const base = `https://${bucket}.oss-cn-hongkong.aliyuncs.com/${PREFIX}`;
  console.log(
    `\n[upload-website-hk] 完成。预览:\n  ${base}/index.html\n  ${base}/recharge.html\n  ${base}/installer.html\n`,
  );
  console.log(`把 aixflow.ai 换成与 .com.cn 相同设计，任选其一：`);
  console.log(`A) Cloudflare Pages：把 release 解压后的 site/ 整目录上传/关联为 Pages 项目根目录`);
  console.log(`B) Cloudflare DNS：将 aixflow.ai 源站指到已部署本包的 Nginx（与 .com.cn 同站也可）`);
  console.log(`C) 临时验证可用香港 OSS 直链: ${base}/index.html`);
}

main().catch((e) => {
  console.error('[upload-website-hk] 失败:', e?.message || e);
  process.exit(1);
});
