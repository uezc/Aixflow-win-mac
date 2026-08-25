#!/usr/bin/env node
/**
 * 上传 Aixflow-Installer-{version}.exe 到香港 + 北京 Release 前缀（与 Setup / latest.yml 同目录）。
 * 不改写 latest.yml（应用内更新仍用 NSIS stub）。
 *
 * 用法: node scripts/upload-glass-installer-to-oss.mjs
 */
import OSS from 'ali-oss';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const exeName = `Aixflow-Installer-${version}.exe`;

function decodeBase64Utf8(v) {
  try {
    return Buffer.from(String(v || ''), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function findLocalExe() {
  const candidates = [
    path.join(root, 'release', exeName),
    path.join(root, 'release', 'glass-installer', exeName),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function makeClient(region, bucket) {
  const accessKeyId = String(
    process.env.OSS_ACCESS_KEY_ID || decodeBase64Utf8('TFRBSTV0N3BKRFo1clpqVEJ5RHJVc0tX'),
  ).trim();
  const accessKeySecret = String(
    process.env.OSS_ACCESS_KEY_SECRET || decodeBase64Utf8('eDBOcG80dWx1TnltN3ZkZGJtYXVaamtRemg4NUNF'),
  ).trim();
  return new OSS({
    region,
    accessKeyId,
    accessKeySecret,
    bucket,
    timeout: 30 * 60 * 1000,
  });
}

async function uploadOne(client, localPath, remoteKey, label) {
  const st = fs.statSync(localPath);
  console.log(
    `[upload-glass-installer] ${label}: ${(st.size / 1024 / 1024).toFixed(1)} MB → ${remoteKey}`,
  );
  await client.multipartUpload(remoteKey, localPath, {
    partSize: 8 * 1024 * 1024,
    timeout: 30 * 60 * 1000,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${exeName}"`,
      'Cache-Control': 'no-cache',
    },
  });
}

async function main() {
  const localPath = findLocalExe();
  if (!localPath) {
    console.error(`[upload-glass-installer] 缺少 ${exeName}，请先 npm run build:glass-installer`);
    process.exit(1);
  }

  const prefix = String(process.env.OSS_INSTALLER_OBJECT_PREFIX || 'aixflow uploads/').replace(
    /\/?$/,
    '/',
  );
  const remoteKey = `${prefix}${exeName}`;

  const hk = makeClient(
    process.env.OSS_RELEASE_HK_REGION || process.env.OSS_REGION || 'oss-cn-hongkong',
    process.env.OSS_RELEASE_HK_BUCKET || process.env.OSS_BUCKET || 'nexflow-temp-images',
  );
  const cn = makeClient(
    process.env.OSS_RELEASE_CN_REGION || 'oss-cn-beijing',
    process.env.OSS_RELEASE_CN_BUCKET || 'nexflow-temp-images-bj',
  );

  await uploadOne(hk, localPath, remoteKey, '香港');
  await uploadOne(cn, localPath, remoteKey, '北京');

  const hkUrl = `https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/aixflow%20uploads/${encodeURIComponent(exeName)}`;
  const cnUrl = `https://nexflow-temp-images-bj.oss-cn-beijing.aliyuncs.com/aixflow%20uploads/${encodeURIComponent(exeName)}`;
  console.log('\n[upload-glass-installer] 完成');
  console.log('  HK:', hkUrl);
  console.log('  CN:', cnUrl);
}

main().catch((e) => {
  console.error('[upload-glass-installer] 失败:', e?.message || e);
  process.exit(1);
});
