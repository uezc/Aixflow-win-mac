#!/usr/bin/env node
/** 将 Aixflow-Website-{version}.zip 上传到 OSS，供 ECS  wget 后部署官网 */
import OSS from 'ali-oss';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const zipName = `Aixflow-Website-${version}.zip`;
const localPath = path.join(root, 'release', zipName);

function decodeBase64Utf8(v) {
  try {
    return Buffer.from(String(v || ''), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function loadCnClient() {
  const builtInAccessKeyId = decodeBase64Utf8('TFRBSTV0N3BKRFo1clpqVEJ5RHJVc0tX');
  const builtInAccessKeySecret = decodeBase64Utf8('eDBOcG80dWx1TnltN3ZkZGJtYXVaamtRemg4NUNF');
  const accessKeyId = String(process.env.OSS_ACCESS_KEY_ID || builtInAccessKeyId).trim();
  const accessKeySecret = String(process.env.OSS_ACCESS_KEY_SECRET || builtInAccessKeySecret).trim();
  const region = String(process.env.OSS_RELEASE_CN_REGION || 'oss-cn-beijing').trim();
  const bucket = String(process.env.OSS_RELEASE_CN_BUCKET || 'nexflow-temp-images-bj').trim();
  return new OSS({ region, accessKeyId, accessKeySecret, bucket, timeout: 600000 });
}

async function main() {
  if (!fs.existsSync(localPath)) {
    console.error(`[upload-website-deploy] 缺少 ${localPath}，请先 node scripts/pack-aixflow-website-zip.mjs`);
    process.exit(1);
  }
  const remoteKey = `aixflow uploads/deploy/${zipName}`;
  const client = loadCnClient();
  const st = fs.statSync(localPath);
  console.log(`[upload-website-deploy] 上传 ${zipName} (${(st.size / 1024).toFixed(0)} KB) → ${remoteKey}`);
  await client.put(remoteKey, localPath, { headers: { 'Content-Type': 'application/zip' } });
  const url = `https://nexflow-temp-images-bj.oss-cn-beijing.aliyuncs.com/${encodeURIComponent('aixflow uploads/deploy').replace(/%2F/g, '/')}/${encodeURIComponent(zipName)}`;
  const urlFixed = `https://nexflow-temp-images-bj.oss-cn-beijing.aliyuncs.com/aixflow%20uploads/deploy/${encodeURIComponent(zipName)}`;
  console.log(`[upload-website-deploy] 完成。国内站 / 海外站可部署同一包（运行时按域名选北京或香港下载与视频）。\n`);
  console.log(`wget: ${urlFixed}\n`);
  console.log(
    `ECS 示例（路径按实际站点目录改）：\n` +
      `cd ~ && wget -O ${zipName} "${urlFixed}" && unzip -o ${zipName} && ` +
      `sudo cp site/index.html /var/www/aixflow/public/index.html && ` +
      `sudo cp site/recharge.html /var/www/aixflow/public/recharge.html && ` +
      `sudo cp site/icon.png /var/www/aixflow/icon.png && ` +
      `sudo cp -r site/assets/* /var/www/aixflow/assets/ && ` +
      `ls /var/www/aixflow/public/recharge.html /var/www/aixflow/assets/aixflowLanding-*.js /var/www/aixflow/assets/aixflowRecharge-*.js`,
  );
  console.log(`\n验证: https://aixflow.com.cn/ 与 https://aixflow.ai/`);
}

main().catch((e) => {
  console.error('[upload-website-deploy] 失败:', e?.message || e);
  process.exit(1);
});
