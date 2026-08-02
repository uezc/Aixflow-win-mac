/**
 * 客户端素材代传：JWT 鉴权后将图/音/视频（≤20MB）写入 OSS 素材桶（aixflow-temp-media/）
 * POST /upload-media
 * Body: { mimeType, fileBase64, objectKey?, mediaRegion?: 'hk'|'cn'|'sh'|'shanghai' }
 * mediaRegion=cn → 北京桶 nexflow-temp-images-bj
 * mediaRegion=sh|shanghai → 上海桶（VIAPI 智能抠像要求；需配置 OSS_MEDIA_SH_*）
 * 默认 hk → 香港桶
 */
import crypto from 'crypto';
import { createOssClientInstance } from './oss-sdk-options.mjs';

const TEMP_PREFIX = 'aixflow-temp-media/';
/** 与桌面端 OSS_MAX_IMAGE_UPLOAD_BYTES 一致 */
const MAX_BYTES = 20 * 1024 * 1024;

const SH_NOT_CONFIGURED_MSG = '请配置上海 OSS 素材桶供智能抠像使用（FC 环境变量 OSS_MEDIA_SH_BUCKET、OSS_MEDIA_SH_REGION=oss-cn-shanghai）';

function normalizeMediaRegion(raw) {
  const v = String(raw || '')
    .trim()
    .toLowerCase();
  if (v === 'cn') return 'cn';
  if (v === 'sh' || v === 'shanghai') return 'sh';
  return 'hk';
}

function resolveOssEnvForMediaRegion(mediaRegion) {
  const base = { ...process.env };
  if (mediaRegion === 'cn') {
    base.OSS_REGION = (process.env.OSS_MEDIA_CN_REGION || 'oss-cn-beijing').trim();
    base.OSS_BUCKET = (process.env.OSS_MEDIA_CN_BUCKET || 'nexflow-temp-images-bj').trim();
    return base;
  }
  if (mediaRegion === 'sh') {
    const region = (process.env.OSS_MEDIA_SH_REGION || 'oss-cn-shanghai').trim();
    const bucket = (process.env.OSS_MEDIA_SH_BUCKET || '').trim();
    if (!bucket) {
      const err = new Error(SH_NOT_CONFIGURED_MSG);
      err.code = 'OSS_SH_NOT_CONFIGURED';
      throw err;
    }
    base.OSS_REGION = region || 'oss-cn-shanghai';
    base.OSS_BUCKET = bucket;
    // 跨地域写入上海桶：禁用内网 endpoint（内网仅同地域可用）
    base.OSS_USE_INTERNAL = '0';
    delete base.OSS_ENDPOINT;
    return base;
  }
  return base;
}

function buildPublicObjectUrl(objectKey, mediaRegion) {
  const key = String(objectKey || '').replace(/^\/+/, '');
  // 上海/北京桶必须返回源站公网 URL（VIAPI 等按地域校验；勿改写 CDN）
  if (mediaRegion === 'cn' || mediaRegion === 'sh') {
    const env = resolveOssEnvForMediaRegion(mediaRegion);
    const bucket = env.OSS_BUCKET?.trim();
    const reg = (env.OSS_REGION || (mediaRegion === 'sh' ? 'oss-cn-shanghai' : 'oss-cn-beijing')).trim();
    if (!bucket || !reg) return '';
    return `https://${bucket}.${reg}.aliyuncs.com/${key}`;
  }
  const base = process.env.OSS_PUBLIC_BASE_URL?.replace(/\/$/, '').trim();
  if (base) return `${base}/${key}`;
  const env = resolveOssEnvForMediaRegion(mediaRegion);
  const bucket = env.OSS_BUCKET?.trim();
  const reg = (env.OSS_REGION || 'oss-cn-hongkong').trim();
  if (!bucket || !reg) return '';
  return `https://${bucket}.${reg}.aliyuncs.com/${key}`;
}

function extFromMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('png')) return 'png';
  if (m.includes('webm')) return 'webm';
  if (m.includes('quicktime') || m.includes('mov')) return 'mov';
  if (m.includes('mp4') || m.includes('video')) return 'mp4';
  if (m.includes('wav')) return 'wav';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mpeg') || m.includes('mp3') || m.includes('audio')) return 'mp3';
  return 'bin';
}

function isAllowedMime(mime) {
  const m = String(mime || '').toLowerCase();
  return m.startsWith('image/') || m.startsWith('video/') || m.startsWith('audio/');
}

function safeObjectKey(input, mime) {
  const raw = String(input || '').trim().replace(/^\/+/, '');
  if (raw.startsWith(TEMP_PREFIX) && !raw.includes('..')) return raw.slice(0, 512);
  const ext = extFromMime(mime);
  const hash = crypto.randomBytes(4).toString('hex');
  return `${TEMP_PREFIX}${Date.now()}-${hash}.${ext}`;
}

export async function handleUploadMedia(body, userId, jsonHeaders) {
  if (!userId) {
    return { statusCode: 401, headers: jsonHeaders, body: JSON.stringify({ error: 'UNAUTHORIZED' }) };
  }

  const mimeType = String(body?.mimeType || body?.mime || 'image/png').trim();
  if (!isAllowedMime(mimeType)) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'INVALID_MIME', message: '仅支持 image/*、video/*、audio/*' }),
    };
  }

  const b64 = body?.fileBase64 ?? body?.file_base64;
  if (typeof b64 !== 'string' || !b64.trim()) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'MISSING_FILE', message: 'fileBase64 必填' }),
    };
  }

  let buf;
  try {
    buf = Buffer.from(String(b64).replace(/\s/g, ''), 'base64');
  } catch {
    return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ error: 'INVALID_BASE64' }) };
  }

  if (!buf.length) {
    return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ error: 'EMPTY_FILE' }) };
  }
  if (buf.length > MAX_BYTES) {
    return {
      statusCode: 413,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: 'FILE_TOO_LARGE',
        message: `单张图片不超过 ${MAX_BYTES / 1024 / 1024}MB`,
      }),
    };
  }

  const mediaRegion = normalizeMediaRegion(body?.mediaRegion);

  let client;
  try {
    client = createOssClientInstance(resolveOssEnvForMediaRegion(mediaRegion));
  } catch (e) {
    if (e?.code === 'OSS_SH_NOT_CONFIGURED' || mediaRegion === 'sh') {
      return {
        statusCode: 503,
        headers: jsonHeaders,
        body: JSON.stringify({
          error: 'OSS_SH_NOT_CONFIGURED',
          message: e?.message || SH_NOT_CONFIGURED_MSG,
        }),
      };
    }
    return {
      statusCode: 503,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'OSS_NOT_CONFIGURED', message: e?.message || 'OSS' }),
    };
  }

  const objectKey = safeObjectKey(body?.objectKey, mimeType);
  try {
    const result = await client.put(objectKey, buf, { mime: mimeType });
    const url = buildPublicObjectUrl(objectKey, mediaRegion) || result?.url || '';
    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({ url, key: objectKey, userId, mediaRegion }),
    };
  } catch (e) {
    console.error('[upload-media]', userId, mediaRegion, e?.stack ?? e);
    const msg = String(e?.message || e || '');
    if (
      mediaRegion === 'sh' &&
      /NoSuchBucket|AccessDenied|InvalidBucketName|The specified bucket does not exist/i.test(msg)
    ) {
      return {
        statusCode: 503,
        headers: jsonHeaders,
        body: JSON.stringify({
          error: 'OSS_SH_NOT_CONFIGURED',
          message: SH_NOT_CONFIGURED_MSG,
        }),
      };
    }
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'UPLOAD_FAILED', message: e?.message || 'OSS put failed' }),
    };
  }
}
