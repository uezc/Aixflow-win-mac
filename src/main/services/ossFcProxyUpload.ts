import axios from 'axios';
import https from 'https';
import { getAliyunFcToken } from '../config/aliyunConfig.js';
import {
  buildOssUploadObjectKey,
  OSS_MAX_IMAGE_UPLOAD_BYTES,
  normalizeOssMediaUrlForGeneration,
  type MediaUploadOssRegion,
} from '../config/ossConfig.js';
import { getFcBaseUrlForClient } from './nxFcClient.js';
import { applyNxFcRoute } from './nxFcRouteManager.js';
import { store } from './store.js';

export const OSS_FC_PROXY_MAX_BYTES = OSS_MAX_IMAGE_UPLOAD_BYTES;

const fcUploadAgent = new https.Agent({ keepAlive: false });
const FC_UPLOAD_TIMEOUT_MS = 180000;

const SH_NOT_CONFIGURED_MSG =
  '请配置上海 OSS 素材桶供智能抠像使用（FC 环境变量 OSS_MEDIA_SH_BUCKET、OSS_MEDIA_SH_REGION=oss-cn-shanghai）';

function readNxAccessToken(): string {
  const raw = store.get('cloudUser') as Record<string, unknown> | undefined;
  if (raw && typeof raw === 'object' && typeof raw.nxAccessToken === 'string') {
    return raw.nxAccessToken.trim();
  }
  return '';
}

function extFromMime(mimeType: string): string {
  const m = (mimeType || '').toLowerCase();
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

function isAllowedFcProxyMime(mimeType: string): boolean {
  const m = (mimeType || '').toLowerCase();
  return m.startsWith('image/') || m.startsWith('video/') || m.startsWith('audio/');
}

function normalizeUploadMediaRegion(raw?: string): MediaUploadOssRegion {
  const v = String(raw || '')
    .trim()
    .toLowerCase();
  if (v === 'cn') return 'cn';
  if (v === 'sh' || v === 'shanghai') return 'sh';
  return 'hk';
}

/**
 * 经北京 FC 将素材写入指定区域 OSS 素材桶（POST /upload-media）。
 * mediaRegion=cn → 北京桶；hk → 香港桶；sh → 上海桶（VIAPI 智能抠像）。
 * 需已登录且 FC 已部署 upload-media。
 */
export async function uploadMediaBufferViaFcProxy(
  buffer: Buffer,
  mimeType: string,
  options?: { objectKey?: string; mediaRegion?: MediaUploadOssRegion },
): Promise<string> {
  if (!buffer?.length) throw new Error('OSS上传失败: 空文件');
  if (buffer.length > OSS_FC_PROXY_MAX_BYTES) {
    throw new Error(
      `OSS上传失败: 文件过大（${(buffer.length / 1024 / 1024).toFixed(1)}MB），FC 代传上限 ${OSS_FC_PROXY_MAX_BYTES / 1024 / 1024}MB`,
    );
  }
  const mime = (mimeType || 'application/octet-stream').trim();
  if (!isAllowedFcProxyMime(mime)) {
    throw new Error(`OSS上传失败: FC 代传不支持 MIME ${mime}`);
  }

  const token = readNxAccessToken();
  if (!token) {
    throw new Error('OSS上传失败: 请先登录后再通过 FC 代传素材');
  }

  applyNxFcRoute('beijing');

  const base = getFcBaseUrlForClient();
  if (!base) throw new Error('OSS上传失败: 未配置 FC 地址');

  const fcTok = getAliyunFcToken();
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).slice(-5);
  const fileName = `${timestamp}-${randomStr}.${extFromMime(mime)}`;
  const objectKey = options?.objectKey || buildOssUploadObjectKey(fileName);
  const mediaRegion = normalizeUploadMediaRegion(options?.mediaRegion);

  const res = await axios.post(
    `${base}/upload-media`,
    {
      mimeType: mime,
      fileBase64: buffer.toString('base64'),
      objectKey,
      mediaRegion,
    },
    {
      timeout: FC_UPLOAD_TIMEOUT_MS,
      proxy: false,
      httpsAgent: fcUploadAgent,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
        ...(fcTok ? { 'x-nexflow-token': fcTok } : {}),
      },
      validateStatus: (s) => s > 0 && s < 600,
    },
  );

  if (res.status < 200 || res.status >= 300) {
    const errCode = String(res.data?.error || '').trim();
    if (errCode === 'OSS_SH_NOT_CONFIGURED' || mediaRegion === 'sh') {
      const msg = String(res.data?.message || '').trim();
      if (errCode === 'OSS_SH_NOT_CONFIGURED' || /上海|shanghai|OSS_MEDIA_SH/i.test(msg)) {
        throw Object.assign(new Error(msg || SH_NOT_CONFIGURED_MSG), {
          code: 'OSS_SH_NOT_CONFIGURED',
        });
      }
    }
    const msg =
      (res.data && (res.data.message || res.data.error)) ||
      `HTTP ${res.status}`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  const url = String(res.data?.url || '').trim();
  if (!url) throw new Error('OSS上传失败: FC 未返回 url');
  return normalizeOssMediaUrlForGeneration(url);
}

/** @deprecated 使用 uploadMediaBufferViaFcProxy */
export async function uploadImageBufferViaFcProxy(imageBuffer: Buffer, mimeType: string): Promise<string> {
  return uploadMediaBufferViaFcProxy(imageBuffer, mimeType);
}
