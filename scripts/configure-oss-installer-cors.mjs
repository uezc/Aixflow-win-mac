#!/usr/bin/env node
/**
 * 为官网安装包下载配置 OSS CORS（aixflow.com.cn 等 Origin 可 fetch latest.yml / HEAD 离线 zip）。
 * 与 src/website/landing/lib/installerDownload.ts 一致。
 */
import OSS from 'ali-oss';

function decodeBase64Utf8(v) {
  try {
    return Buffer.from(String(v || ''), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function loadOssClient() {
  const env = process.env;
  const accessKeyId = String(env.OSS_ACCESS_KEY_ID || decodeBase64Utf8('TFRBSTV0N3BKRFo1clpqVEJ5RHJVc0tX')).trim();
  const accessKeySecret = String(env.OSS_ACCESS_KEY_SECRET || decodeBase64Utf8('eDBOcG80dWx1TnltN3ZkZGJtYXVaamtRemg4NUNF')).trim();
  const region = String(env.OSS_REGION || env.OSS_REGION_ID || 'oss-cn-hongkong').trim();
  const bucket = String(env.OSS_BUCKET || 'nexflow-temp-images').trim();
  if (!accessKeyId || !accessKeySecret) {
    throw new Error('OSS 凭证缺失');
  }
  return { client: new OSS({ region, accessKeyId, accessKeySecret, bucket, timeout: 120000 }), bucket };
}

const REQUIRED_ORIGINS = [
  'https://aixflow.com.cn',
  'https://www.aixflow.com.cn',
  'http://aixflow.com.cn',
  'http://www.aixflow.com.cn',
  'https://aixflow.ai',
  'https://www.aixflow.ai',
  'http://localhost:5274',
  'http://localhost:5173',
  'http://127.0.0.1:5274',
  'http://127.0.0.1:5173',
];

function mergeOrigins(existing, required) {
  const set = new Set(
    [...existing, ...required].map((o) => String(o || '').trim()).filter(Boolean),
  );
  return [...set];
}

function normalizeRules(raw) {
  const rules = raw?.rules ?? raw ?? [];
  return Array.isArray(rules) ? rules : [];
}

async function main() {
  const { client, bucket } = loadOssClient();
  let rules = [];
  try {
    const res = await client.getBucketCORS(bucket);
    rules = normalizeRules(res);
  } catch (e) {
    if (e.code !== 'NoSuchCORSConfiguration' && e.status !== 404) {
      throw e;
    }
  }

  const installerRule = {
    allowedOrigin: mergeOrigins(
      rules.flatMap((r) => r.allowedOrigin || r.AllowedOrigin || []),
      REQUIRED_ORIGINS,
    ),
    allowedMethod: ['GET', 'HEAD'],
    allowedHeader: ['*'],
    exposeHeader: ['Content-Length', 'Content-Type', 'ETag', 'x-oss-request-id'],
    maxAgeSeconds: 600,
  };

  const otherRules = rules.filter((r) => {
    const methods = r.allowedMethod || r.AllowedMethod || [];
    const hasWrite = methods.some((m) => !/^(GET|HEAD)$/i.test(String(m)));
    return hasWrite;
  });

  const nextRules = [...otherRules, installerRule];
  await client.putBucketCORS(bucket, nextRules);
  console.log(`[configure-oss-installer-cors] 已更新 ${bucket} CORS，安装包下载 Origin 共 ${installerRule.allowedOrigin.length} 个`);
  console.log('[configure-oss-installer-cors] 含:', REQUIRED_ORIGINS.join(', '));
}

main().catch((e) => {
  console.error('[configure-oss-installer-cors] 失败:', e?.message || e);
  process.exit(1);
});
