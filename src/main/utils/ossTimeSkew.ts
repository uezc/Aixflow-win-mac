/**
 * 校正本机与 OSS 服务端时间差，避免「The difference between the request time and the current time is too large」
 *（用户电脑日期/时区错误或未同步时常见）。
 *
 * 通过 HEAD 桶域名读取响应 Date，计算 offset；ali-oss 使用 options.amendTimeSkewed（见 node_modules/ali-oss/lib/common/utils/createRequest.js）。
 */
import https from 'https';
import OSS from 'ali-oss';
import {
  getBuiltInOSSConfig,
  getBuiltInOSSConfigForMedia,
  type BuiltInOssConfig,
  type MediaUploadOssRegion,
  OSS_TIMEOUT_MS,
} from '../config/ossConfig.js';

const skewCache = new Map<string, { offsetMs: number; cachedAt: number }>();
const CACHE_MS = 5 * 60 * 1000;

function cacheKeyForConfig(cfg: BuiltInOssConfig): string {
  return `${cfg.bucket}@${cfg.region}`;
}

export function invalidateOssTimeSkewCache(): void {
  skewCache.clear();
}

function parseHttpDateHeader(gmt: string | undefined): number | null {
  if (!gmt || typeof gmt !== 'string') return null;
  const t = Date.parse(gmt.trim());
  return Number.isFinite(t) ? t : null;
}

/** 返回 serverTime - localTime（毫秒）；失败时 0 */
export async function getOssDateSkewOffsetMsForConfig(cfg: BuiltInOssConfig): Promise<number> {
  const key = cacheKeyForConfig(cfg);
  const now = Date.now();
  const hit = skewCache.get(key);
  if (hit && now - hit.cachedAt < CACHE_MS) {
    return hit.offsetMs;
  }

  const host = `${cfg.bucket}.${cfg.region}.aliyuncs.com`;
  const offset = await new Promise<number>((resolve) => {
    const req = https.request(
      {
        method: 'HEAD',
        host,
        path: '/',
        timeout: 8000,
        servername: host,
      },
      (res) => {
        const serverMs = parseHttpDateHeader(res.headers.date);
        res.resume();
        if (serverMs == null) {
          resolve(0);
          return;
        }
        resolve(serverMs - Date.now());
      },
    );
    req.on('error', () => resolve(0));
    req.on('timeout', () => {
      req.destroy();
      resolve(0);
    });
    req.end();
  });

  skewCache.set(key, { offsetMs: offset, cachedAt: Date.now() });
  if (Math.abs(offset) > 30_000) {
    console.warn(
      `[OSS] ${cfg.region} 时间偏差约 ${(offset / 1000).toFixed(0)}s，已自动校正签名时间`,
    );
  }
  return offset;
}

/** @deprecated 使用 getOssDateSkewOffsetMsForConfig */
export async function getOssDateSkewOffsetMs(): Promise<number> {
  return getOssDateSkewOffsetMsForConfig(getBuiltInOSSConfig());
}

async function createAliOssClientFromConfig(cfg: BuiltInOssConfig): Promise<OSS> {
  const skew = await getOssDateSkewOffsetMsForConfig(cfg);
  return new OSS({
    accessKeyId: cfg.accessKeyId,
    accessKeySecret: cfg.accessKeySecret,
    region: cfg.region,
    bucket: cfg.bucket,
    secure: true,
    timeout: cfg.timeout ?? OSS_TIMEOUT_MS,
    amendTimeSkewed: skew,
  } as ConstructorParameters<typeof OSS>[0]);
}

/** 按素材区域创建 OSS 客户端（大陆 cn / 海外 hk / 上海 sh） */
export async function createAliOssClientForMedia(region: MediaUploadOssRegion): Promise<OSS> {
  return createAliOssClientFromConfig(getBuiltInOSSConfigForMedia(region));
}

/** 香港桶（兼容旧调用） */
export async function createAliOssClient(): Promise<OSS> {
  return createAliOssClientForMedia('hk');
}
