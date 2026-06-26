#!/usr/bin/env node
/** 仅将 release/Aixflow-Windows-Offline-{version}.zip 补传到北京 Release OSS */
import OSS from 'ali-oss';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const zipName = `Aixflow-Windows-Offline-${version}.zip`;
const localPath = path.join(root, 'release', zipName);
const remoteFolder = String(process.env.OSS_INSTALLER_OBJECT_PREFIX || 'aixflow uploads/').trim();
const remoteKey = `${remoteFolder}${zipName}`;

function decodeBase64Utf8(v) {
  try {
    return Buffer.from(String(v || ''), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

const accessKeyId = String(process.env.OSS_ACCESS_KEY_ID || decodeBase64Utf8('TFRBSTV0N3BKRFo1clpqVEJ5RHJVc0tX')).trim();
const accessKeySecret = String(process.env.OSS_ACCESS_KEY_SECRET || decodeBase64Utf8('eDBOcG80dWx1TnltN3ZkZGJtYXVaamtRemg4NUNF')).trim();
const region = String(process.env.OSS_RELEASE_CN_REGION || process.env.OSS_CN_REGION || 'oss-cn-beijing').trim();
const bucket = String(process.env.OSS_RELEASE_CN_BUCKET || process.env.OSS_CN_BUCKET || 'nexflow-temp-images-bj').trim();

if (!fs.existsSync(localPath)) {
  console.error('[upload-offline-cn] 本地未找到:', localPath);
  process.exit(1);
}

const client = new OSS({ region, accessKeyId, accessKeySecret, bucket, timeout: 3600000 });
const sizeMb = (fs.statSync(localPath).size / 1024 / 1024).toFixed(2);
console.log(`[upload-offline-cn] 上传 ${localPath} (${sizeMb} MB)`);
console.log(`[upload-offline-cn] → ${bucket} @ ${region} : ${remoteKey}`);

await client.put(remoteKey, localPath, { headers: { 'Content-Type': 'application/zip' } });
console.log('[upload-offline-cn] 完成');
