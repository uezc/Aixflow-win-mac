/**
 * 登录页「交流群」二维码：从北京桶 `WX/` 前缀列举图片，取最新一张公开 URL。
 * 换图：在 OSS 控制台替换/覆盖 `WX/` 内图片即可，无需改客户端代码。
 */
import {
  getDirectOssPublicObjectOriginForMedia,
} from '../config/ossConfig.js';
import { createAliOssClientForMedia } from '../utils/ossTimeSkew.js';

export const WECHAT_GROUP_OSS_PREFIX = 'WX/';

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;
const CACHE_MS = 60_000;

type Cached = { url: string; objectKey: string; cachedAt: number };
let cache: Cached | null = null;

function isUsableImageObject(name: string, size: number | undefined): boolean {
  if (!name || name === WECHAT_GROUP_OSS_PREFIX || name.endsWith('/')) return false;
  if (typeof size === 'number' && size <= 0) return false;
  return IMAGE_EXT_RE.test(name);
}

/** 将对象键编码为公网 URL（支持中文文件名） */
export function buildWeChatGroupPublicUrl(objectKey: string, cacheBust?: string | number): string {
  const origin = getDirectOssPublicObjectOriginForMedia('cn');
  const path = String(objectKey || '')
    .split('/')
    .filter((s, i, arr) => !(i === arr.length - 1 && s === ''))
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const base = `${origin}/${path}`;
  if (cacheBust == null || cacheBust === '') return base;
  return `${base}?v=${encodeURIComponent(String(cacheBust))}`;
}

export type ResolveWeChatGroupQrResult =
  | { ok: true; url: string; objectKey: string }
  | { ok: false; error: string };

/**
 * 列举北京桶 `WX/`，返回最新一张图片的公开 URL。
 * @param force 跳过短缓存（例如用户刚换图后想立刻刷新）
 */
export async function resolveWeChatGroupQrFromOss(force = false): Promise<ResolveWeChatGroupQrResult> {
  const now = Date.now();
  if (!force && cache && now - cache.cachedAt < CACHE_MS) {
    return { ok: true, url: cache.url, objectKey: cache.objectKey };
  }

  try {
    const client = await createAliOssClientForMedia('cn');
    const listed = await client.list(
      {
        prefix: WECHAT_GROUP_OSS_PREFIX,
        'max-keys': 100,
      },
      {},
    );
    const objects = (listed.objects || []).filter((o) =>
      isUsableImageObject(String(o.name || ''), o.size),
    );
    if (objects.length === 0) {
      return { ok: false, error: 'WX/ 下未找到图片' };
    }

    objects.sort((a, b) => {
      const ta = Date.parse(String(a.lastModified || '')) || 0;
      const tb = Date.parse(String(b.lastModified || '')) || 0;
      return tb - ta;
    });

    const best = objects[0]!;
    const objectKey = String(best.name);
    const bust = Date.parse(String(best.lastModified || '')) || now;
    const url = buildWeChatGroupPublicUrl(objectKey, bust);
    cache = { url, objectKey, cachedAt: now };
    return { ok: true, url, objectKey };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[wechatGroupQr] list WX/ failed:', msg);
    return { ok: false, error: msg || '列举 WX/ 失败' };
  }
}
