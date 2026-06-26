#!/usr/bin/env node
/** 从香港 OSS 下载离线 zip 并上传到北京 Release 桶（跨区无法 copyObject） */
import OSS from 'ali-oss';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = process.argv[2] || pkg.version;
const zipName = `Aixflow-Windows-Offline-${version}.zip`;
const remoteFolder = String(process.env.OSS_INSTALLER_OBJECT_PREFIX || 'aixflow uploads/').trim();
const remoteKey = `${remoteFolder}${zipName}`;
const localPath = path.join(root, 'release', zipName);

function decodeBase64Utf8(v) {
  try {
    return Buffer.from(String(v || ''), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

const accessKeyId = String(process.env.OSS_ACCESS_KEY_ID || decodeBase64Utf8('TFRBSTV0N3BKRFo1clpqVEJ5RHJVc0tX')).trim();
const accessKeySecret = String(process.env.OSS_ACCESS_KEY_SECRET || decodeBase64Utf8('eDBOcG80dWx1TnltN3ZkZGJtYXVaamtRemg4NUNF')).trim();
const hkBucket = String(process.env.OSS_BUCKET || 'nexflow-temp-images').trim();
const hkRegion = String(process.env.OSS_REGION || process.env.OSS_REGION_ID || 'oss-cn-hongkong').trim();
const cnRegion = String(process.env.OSS_RELEASE_CN_REGION || process.env.OSS_CN_REGION || 'oss-cn-beijing').trim();
const cnBucket = String(process.env.OSS_RELEASE_CN_BUCKET || process.env.OSS_CN_BUCKET || 'nexflow-temp-images-bj').trim();

fs.mkdirSync(path.dirname(localPath), { recursive: true });

const hk = new OSS({ region: hkRegion, accessKeyId, accessKeySecret, bucket: hkBucket, timeout: 3600000 });
const cn = new OSS({ region: cnRegion, accessKeyId, accessKeySecret, bucket: cnBucket, timeout: 3600000 });

if (!fs.existsSync(localPath)) {
  console.log(`[sync-offline-cn] 从香港下载 → ${localPath}`);
  await hk.get(remoteKey, localPath);
  const mb = (fs.statSync(localPath).size / 1024 / 1024).toFixed(2);
  console.log(`[sync-offline-cn] 下载完成 (${mb} MB)`);
} else {
  const mb = (fs.statSync(localPath).size / 1024 / 1024).toFixed(2);
  console.log(`[sync-offline-cn] 本地已存在 (${mb} MB)，跳过下载`);
}

console.log(`[sync-offline-cn] 上传到北京 ${cnBucket}/${remoteKey}`);
await cn.put(remoteKey, localPath, { headers: { 'Content-Type': 'application/zip' } });
console.log('[sync-offline-cn] 北京上传完成');
