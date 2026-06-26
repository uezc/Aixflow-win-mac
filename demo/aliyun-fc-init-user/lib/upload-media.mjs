/**
 * 客户端素材代传：JWT 鉴权后将图/音/视频（≤20MB）写入 OSS 素材桶（aixflow-temp-media/）
 * POST /upload-media
 * Body: { mimeType, fileBase64, objectKey?, mediaRegion?: 'hk'|'cn' }
 * mediaRegion=cn → 北京桶 nexflow-temp-images-bj；默认 hk → 香港桶
 */
import crypto from 'crypto';
import { createOssClientInstance } from './oss-sdk-options.mjs';

const TEMP_PREFIX = 'aixflow-temp-media/';
/** 与桌面端 OSS_MAX_IMAGE_UPLOAD_BYTES 一致 */
const MAX_BYTES = 20 * 1024 * 1024;

function resolveOssEnvForMediaRegion(mediaRegion) {
  const base = { ...process.env };
  if (mediaRegion === 'cn') {
    base.OSS_REGION = (process.env.OSS_MEDIA_CN_REGION || 'oss-cn-beijing').trim();
    base.OSS_BUCKET = (process.env.OSS_MEDIA_CN_BUCKET || 'nexflow-temp-images-bj').trim();
  }
  return base;
}

function buildPublicObjectUrl(objectKey, mediaRegion) {
  const key = String(objectKey || '').replace(/^\/+/, '');
  const base = process.env.OSS_PUBLIC_BASE_URL?.replace(/\/$/, '').trim();
  if (base && mediaRegion !== 'cn') return `${base}/${key}`;
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

  const mediaRegion = body?.mediaRegion === 'cn' ? 'cn' : 'hk';

  let client;
  try {
    client = createOssClientInstance(resolveOssEnvForMediaRegion(mediaRegion));
  } catch (e) {
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
      body: JSON.stringify({ url, key: objectKey, userId }),
    };
  } catch (e) {
    console.error('[upload-media]', userId, e?.stack ?? e);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'UPLOAD_FAILED', message: e?.message || 'OSS put failed' }),
    };
  }
}
