import https from 'https';
import { app } from 'electron';
import {
  getBuiltInOSSConfigForMedia,
  type BuiltInOssConfig,
  type MediaOssRegion,
} from '../config/ossConfig.js';
import { store } from './store.js';

/** 本会话素材存储区域（大陆 cn / 海外 hk，桶独立不同步） */
let activeMediaOssRegion: MediaOssRegion = resolveInitialMediaOssRegion();
/** 直连失败后 FC 代传已成功 → 本会话后续上传优先 FC */
let sessionFcProxyUpload = false;
/** 当前区域 OSS 直连不可达 */
let mediaOssDirectUnreachable = false;
let ossRouteProbeDone = false;

export function resolveInitialMediaOssRegion(): MediaOssRegion {
  const env = String(process.env.NX_MEDIA_OSS_REGION || '').trim().toLowerCase();
  if (env === 'hk' || env === 'cn') return env;
  try {
    const stored = String(store.get('nxMediaOssRegion') || '').trim().toLowerCase();
    if (stored === 'cn' || stored === 'hk') return stored;
  } catch {
    /* ignore */
  }
  try {
    const loc = app.getLocale().toLowerCase().replace(/_/g, '-');
    if (loc === 'zh-cn' || loc.startsWith('zh-cn')) return 'cn';
  } catch {
    /* ignore */
  }
  return 'cn';
}

export function mediaOssRegionToFcRoute(region: MediaOssRegion): 'hk' | 'beijing' {
  return region === 'cn' ? 'beijing' : 'hk';
}

export function getEffectiveDualRegion(): MediaOssRegion {
  const stored = getStoredMediaOssRegion();
  if (stored) return stored;
  try {
    const fc = String(store.get('nxCloudFcRoute') || '').toLowerCase();
    if (fc === 'beijing') return 'cn';
    if (fc === 'hk') return 'hk';
  } catch {
    /* ignore */
  }
  return resolveInitialMediaOssRegion();
}

export function getStoredMediaOssRegion(): MediaOssRegion | null {
  try {
    const stored = String(store.get('nxMediaOssRegion') || '').trim().toLowerCase();
    if (stored === 'cn' || stored === 'hk') return stored;
  } catch {
    /* ignore */
  }
  return null;
}

/** 用户切换「中国优化/全球线路」时同步 OSS 素材桶 */
export function applyMediaOssRegion(region: MediaOssRegion): MediaOssRegion {
  store.set('nxMediaOssRegion', region);
  activeMediaOssRegion = region;
  sessionFcProxyUpload = false;
  mediaOssDirectUnreachable = false;
  ossRouteProbeDone = false;
  const label = region === 'cn' ? '北京' : '香港';
  console.log(`[OSS上传] 素材线路已切换 → ${label}桶（${region}）`);
  return region;
}

export function getActiveMediaOssRegion(): MediaOssRegion {
  return activeMediaOssRegion;
}

export function isSessionBeijingFcProxyUpload(): boolean {
  return sessionFcProxyUpload;
}

/** @deprecated 使用 isMediaOssDirectUnreachable */
export function isHkOssDirectUnreachable(): boolean {
  return mediaOssDirectUnreachable;
}

export function isMediaOssDirectUnreachable(): boolean {
  return mediaOssDirectUnreachable;
}

/** 是否应跳过直连 OSS，优先北京 FC 代传（仅直连失败后会话内固定） */
export function shouldPreferFcProxyUpload(): boolean {
  return sessionFcProxyUpload || mediaOssDirectUnreachable;
}

export function markSessionFcProxyUpload(region?: MediaOssRegion): void {
  if (sessionFcProxyUpload) return;
  sessionFcProxyUpload = true;
  const r = region ?? activeMediaOssRegion;
  console.log(
    `[OSS上传] 本会话已固定：北京 FC 代传 → ${r === 'cn' ? '北京' : '香港'} OSS 素材桶`,
  );
}

/** @deprecated 使用 markSessionFcProxyUpload */
export function markSessionBeijingFcProxyUpload(): void {
  markSessionFcProxyUpload('hk');
}

export function clearSessionBeijingFcProxyUpload(): void {
  sessionFcProxyUpload = false;
  mediaOssDirectUnreachable = false;
  ossRouteProbeDone = false;
  activeMediaOssRegion = resolveInitialMediaOssRegion();
}

export function markMediaOssDirectUnreachable(reason?: string): void {
  if (mediaOssDirectUnreachable) return;
  mediaOssDirectUnreachable = true;
  const label = activeMediaOssRegion === 'cn' ? '北京' : '香港';
  console.warn(`[OSS上传] 直连${label} OSS 素材桶不可达，后续优先 FC 代传${reason ? `: ${reason}` : ''}`);
}

/** @deprecated 使用 markMediaOssDirectUnreachable */
export function markHkOssDirectUnreachable(reason?: string): void {
  markMediaOssDirectUnreachable(reason);
}

async function probeOssDirectReachable(cfg: BuiltInOssConfig, timeoutMs = 8000): Promise<boolean> {
  const host = `${cfg.bucket}.${cfg.region}.aliyuncs.com`;
  return new Promise<boolean>((resolve) => {
    const req = https.request(
      { method: 'HEAD', host, path: '/', timeout: timeoutMs, servername: host },
      (res) => {
        res.resume();
        resolve(res.statusCode != null && res.statusCode < 500);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/** HEAD 指定区域素材桶，判断客户端能否直连 */
export async function probeMediaOssDirectReachable(
  region: MediaOssRegion = activeMediaOssRegion,
  timeoutMs = 8000,
): Promise<boolean> {
  try {
    return await probeOssDirectReachable(getBuiltInOSSConfigForMedia(region), timeoutMs);
  } catch {
    return false;
  }
}

/** @deprecated 使用 probeMediaOssDirectReachable('hk') */
export async function probeHongKongOssDirectReachable(timeoutMs = 8000): Promise<boolean> {
  return probeMediaOssDirectReachable('hk', timeoutMs);
}

/** 启动 / 进画布时探测一次当前区域素材桶是否可达 */
export async function ensureOssUploadRouteProbed(force = false): Promise<{
  preferFc: boolean;
  reachable: boolean;
  mediaRegion: MediaOssRegion;
}> {
  activeMediaOssRegion = resolveInitialMediaOssRegion();

  if (ossRouteProbeDone && !force) {
    return {
      preferFc: shouldPreferFcProxyUpload(),
      reachable: !mediaOssDirectUnreachable,
      mediaRegion: activeMediaOssRegion,
    };
  }
  ossRouteProbeDone = true;

  const label = activeMediaOssRegion === 'cn' ? '北京' : '香港';
  console.log(`[OSS上传] 素材区域: ${activeMediaOssRegion}（${label}桶，与另一区域不同步）`);

  const reachable = await probeMediaOssDirectReachable(activeMediaOssRegion);
  if (!reachable) {
    markMediaOssDirectUnreachable('启动探测失败');
  }
  return {
    preferFc: shouldPreferFcProxyUpload(),
    reachable,
    mediaRegion: activeMediaOssRegion,
  };
}
