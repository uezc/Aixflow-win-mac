#!/usr/bin/env node
/**
 * 上传 release/optional-bundles/*.zip 到 OSS optional-bundles/（香港主源 + 北京副本）。
 *
 * 用法: npm run upload:optional-bundles
 *   --hk-only  仅香港
 *   --cn-only  仅北京
 *   --no-confirm  跳过确认（CI）
 */
import OSS from 'ali-oss';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const bundleDir = path.join(root, 'release', 'optional-bundles');

function decodeBase64Utf8(v) {
  try {
    return Buffer.from(String(v || ''), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function loadOssConfigs() {
  const env = process.env;
  const accessKeyId = String(env.OSS_ACCESS_KEY_ID || decodeBase64Utf8('TFRBSTV0N3BKRFo1clpqVEJ5RHJVc0tX')).trim();
  const accessKeySecret = String(
    env.OSS_ACCESS_KEY_SECRET || decodeBase64Utf8('eDBOcG80dWx1TnltN3ZkZGJtYXVaamtRemg4NUNF'),
  ).trim();
  const installerPrefix = String(env.OSS_INSTALLER_OBJECT_PREFIX || 'aixflow uploads/').trim();
  const prefix = installerPrefix.endsWith('/') ? installerPrefix : `${installerPrefix}/`;
  const remoteFolder = `${prefix}optional-bundles/`;

  const hk = {
    region: String(env.OSS_REGION || env.OSS_REGION_ID || 'oss-cn-hongkong').trim(),
    bucket: String(env.OSS_BUCKET || 'nexflow-temp-images').trim(),
    accessKeyId,
    accessKeySecret,
  };

  let cn = null;
  if (String(env.OSS_RELEASE_CN_DISABLED || '').trim() !== '1') {
    cn = {
      region: String(env.OSS_RELEASE_CN_REGION || env.OSS_CN_REGION || 'oss-cn-beijing').trim(),
      bucket: String(env.OSS_RELEASE_CN_BUCKET || env.OSS_CN_BUCKET || 'nexflow-temp-images-bj').trim(),
      accessKeyId,
      accessKeySecret,
    };
  }

  return { remoteFolder, hk, cn };
}

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(2)} KB`;
  return `${n} B`;
}

async function uploadFiles(files, ossConfig, tag, remoteFolder) {
  const client = new OSS({
    region: ossConfig.region,
    accessKeyId: ossConfig.accessKeyId,
    accessKeySecret: ossConfig.accessKeySecret,
    bucket: ossConfig.bucket,
    timeout: 7200000,
  });

  for (const localPath of files) {
    const name = path.basename(localPath);
    const remoteKey = `${remoteFolder}${name}`;
    const st = fs.statSync(localPath);
    console.log(`[upload-optional-bundles][${tag}] 上传 ${name} (${formatSize(st.size)}) → ${remoteKey}`);
    await client.multipartUpload(remoteKey, localPath, {
      parallel: 4,
      partSize: 10 * 1024 * 1024,
      headers: { 'Content-Type': 'application/zip' },
    });
    console.log(`[upload-optional-bundles][${tag}] 完成: ${remoteKey}`);
  }
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer?.trim() || '');
    });
  });
}

async function main() {
  if (!fs.existsSync(bundleDir)) {
    console.error('[upload-optional-bundles] 目录不存在，请先执行: npm run pack:optional-bundles');
    process.exit(1);
  }

  const files = fs
    .readdirSync(bundleDir)
    .filter((n) => n.endsWith('.zip'))
    .map((n) => path.join(bundleDir, n));

  if (files.length === 0) {
    console.error('[upload-optional-bundles] release/optional-bundles/ 下无 zip，请先打包。');
    process.exit(1);
  }

  const { remoteFolder, hk, cn } = loadOssConfigs();
  const args = process.argv.slice(2);
  const hkOnly = args.includes('--hk-only');
  const cnOnly = args.includes('--cn-only');
  const noConfirm = args.includes('--no-confirm');

  console.log('[upload-optional-bundles] 待上传:');
  for (const f of files) {
    const st = fs.statSync(f);
    console.log(`  - ${path.basename(f)} (${formatSize(st.size)})`);
  }
  console.log(`[upload-optional-bundles] 远程前缀: ${remoteFolder}`);

  if (!noConfirm) {
    const ok = await prompt('确认上传到 OSS？[Y/n] ');
    if (ok && ok.toLowerCase() === 'n') {
      console.log('已取消');
      return;
    }
  }

  if (!cnOnly) {
    await uploadFiles(files, hk, 'HK', remoteFolder);
  }

  if (!hkOnly && cn) {
    await uploadFiles(files, cn, 'CN', remoteFolder);
  } else if (!hkOnly && !cn) {
    console.warn('[upload-optional-bundles] 北京副本未配置，仅上传香港');
  }

  console.log('[upload-optional-bundles] 全部完成。请验证 URL 可下载，例如:');
  const sample = path.basename(files[0]);
  const encoded = remoteFolder.replace(/ /g, '%20') + sample;
  console.log(`  https://${hk.bucket}.${hk.region}.aliyuncs.com/${encoded}`);
}

main().catch((err) => {
  console.error('[upload-optional-bundles] 失败:', err);
  process.exit(1);
});
