#!/usr/bin/env node
/**
 * 将官网展示视频从北京桶同步到香港桶（对象键同名），供 aixflow.ai / aixflow.com.cn 按域名取最近源。
 *
 * 用法:
 *   node scripts/sync-website-media-bj-hk.mjs
 *   node scripts/sync-website-media-bj-hk.mjs --dry-run
 *
 * 对象列表与 src/website/landing/data/content.ts 中 KEYS 保持一致。
 */
import OSS from 'ali-oss';

function decodeBase64Utf8(v) {
  try {
    return Buffer.from(String(v || ''), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

const OBJECT_KEYS = [
  'A.mp4',
  'B.mp4',
  'C.mp4',
  'D.mp4',
  'AA.mp4',
  'BB.mp4',
  'CC.mp4',
  '支付方法.mp4',
];

function loadClient(region, bucket) {
  const accessKeyId = String(process.env.OSS_ACCESS_KEY_ID || decodeBase64Utf8('TFRBSTV0N3BKRFo1clpqVEJ5RHJVc0tX')).trim();
  const accessKeySecret = String(
    process.env.OSS_ACCESS_KEY_SECRET || decodeBase64Utf8('eDBOcG80dWx1TnltN3ZkZGJtYXVaamtRemg4NUNF'),
  ).trim();
  return new OSS({ region, accessKeyId, accessKeySecret, bucket, timeout: 600000 });
}

async function headOk(client, key) {
  try {
    await client.head(key);
    return true;
  } catch (e) {
    if (e?.status === 404 || e?.code === 'NoSuchKey') return false;
    throw e;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const cn = loadClient(
    process.env.OSS_RELEASE_CN_REGION || 'oss-cn-beijing',
    process.env.OSS_RELEASE_CN_BUCKET || 'nexflow-temp-images-bj',
  );
  const hk = loadClient(
    process.env.OSS_RELEASE_HK_REGION || process.env.OSS_REGION || 'oss-cn-hongkong',
    process.env.OSS_RELEASE_HK_BUCKET || process.env.OSS_BUCKET || 'nexflow-temp-images',
  );

  console.log(`[sync-website-media] dryRun=${dryRun} keys=${OBJECT_KEYS.length}`);
  let copied = 0;
  let skipped = 0;
  let missing = 0;

  for (const key of OBJECT_KEYS) {
    const cnOk = await headOk(cn, key);
    if (!cnOk) {
      console.warn(`[sync-website-media] 北京缺失，跳过: ${key}`);
      missing += 1;
      continue;
    }
    const hkOk = await headOk(hk, key);
    if (hkOk && !process.argv.includes('--force')) {
      console.log(`[sync-website-media] 香港已有，跳过: ${key}`);
      skipped += 1;
      continue;
    }
    if (dryRun) {
      console.log(`[sync-website-media] dry-run 将复制: ${key}`);
      copied += 1;
      continue;
    }
    console.log(`[sync-website-media] 复制中: ${key}`);
    const result = await cn.get(key);
    const body = result.content;
    const headers = {};
    const ct = result.res?.headers?.['content-type'] || result.res?.headers?.['Content-Type'];
    if (ct) headers['Content-Type'] = ct;
    await hk.put(key, body, { headers });
    console.log(`[sync-website-media] 已写入香港: ${key} (${Math.round((body?.length || 0) / 1024)} KB)`);
    copied += 1;
  }

  console.log(
    `[sync-website-media] 完成：copied/planned=${copied}, skipped=${skipped}, missingCn=${missing}`,
  );
  console.log(
    '验证示例:\n' +
      '  https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/A.mp4\n' +
      '  https://nexflow-temp-images-bj.oss-cn-beijing.aliyuncs.com/A.mp4',
  );
}

main().catch((e) => {
  console.error('[sync-website-media] 失败:', e?.message || e);
  process.exit(1);
});
