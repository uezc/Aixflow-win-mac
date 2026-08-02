/**
 * 官网站点区域：国内 .com.cn 优先北京；海外 .ai 优先香港。
 * 构建期可用 VITE_SITE_REGION=cn|hk 强制指定。
 */

export type SiteMediaRegion = 'cn' | 'hk';

const CN_HOST_RE = /(^|\.)aixflow\.com\.cn$/i;
const AI_HOST_RE = /(^|\.)aixflow\.ai$/i;

/** 素材公网桶根（对象同名，双桶各存一份） */
export const MEDIA_OSS_CN_BASE = 'https://nexflow-temp-images-bj.oss-cn-beijing.aliyuncs.com';
export const MEDIA_OSS_HK_BASE = 'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com';

export function getSiteMediaRegion(): SiteMediaRegion {
  const forced = String(import.meta.env.VITE_SITE_REGION || '')
    .trim()
    .toLowerCase();
  if (forced === 'cn' || forced === 'hk') return forced;
  if (forced === 'ai' || forced === 'overseas') return 'hk';

  if (typeof window !== 'undefined' && window.location?.hostname) {
    const host = window.location.hostname.replace(/\.$/, '');
    if (AI_HOST_RE.test(host)) return 'hk';
    if (CN_HOST_RE.test(host)) return 'cn';
  }
  return 'cn';
}

/** 是否海外站（aixflow.ai） */
export function isOverseasSite(): boolean {
  return getSiteMediaRegion() === 'hk';
}

/**
 * 官网展示媒体 URL：按站点选北京/香港桶，对象键保持一致。
 * @param objectKey 如 `A.mp4` 或 `支付方法.mp4`
 */
export function mediaObjectUrl(objectKey: string, region: SiteMediaRegion = getSiteMediaRegion()): string {
  const key = String(objectKey || '')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(decodeURIComponent(seg)))
    .join('/');
  const base = region === 'hk' ? MEDIA_OSS_HK_BASE : MEDIA_OSS_CN_BASE;
  return `${base}/${key}`;
}

/** 将已写死的北京（或香港）媒体 URL 映射到当前站点桶，保留对象路径 */
export function remapMediaUrlToSite(url: string, region: SiteMediaRegion = getSiteMediaRegion()): string {
  const raw = String(url || '').trim();
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const isCn =
      host.includes('oss-cn-beijing') ||
      host === 'nexflow-temp-images-bj.oss-cn-beijing.aliyuncs.com';
    const isHk =
      host.includes('oss-cn-hongkong') ||
      host === 'nexflow-temp-images.oss-cn-hongkong.aliyuncs.com' ||
      host === 'cdn.aixflow.ai';
    if (!isCn && !isHk) return raw;
    const objectKey = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
    return mediaObjectUrl(objectKey, region);
  } catch {
    return raw;
  }
}
