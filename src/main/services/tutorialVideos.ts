/**
 * 软件内教学视频：从北京桶 `软件内教学视频/` 列举 mp4，按文件名序号排序，返回公开可播 URL。
 * 运维换片：OSS 控制台覆盖/增删该目录下文件即可，无需改客户端。
 */
import { getDirectOssPublicObjectOriginForMedia } from '../config/ossConfig.js';
import { createAliOssClientForMedia } from '../utils/ossTimeSkew.js';

export const TUTORIAL_VIDEOS_OSS_PREFIX = '软件内教学视频/';

const VIDEO_EXT_RE = /\.mp4$/i;
const CACHE_MS = 60_000;

export type TutorialVideoItem = {
  /** 对象键，如 `软件内教学视频/1.数字人展示.mp4` */
  objectKey: string;
  /** 展示名（去扩展名），如 `1.数字人展示` */
  title: string;
  /** 公开可播 URL */
  url: string;
  /** 排序序号（文件名前缀数字） */
  sortIndex: number;
};

export type ListTutorialVideosResult =
  | { ok: true; items: TutorialVideoItem[] }
  | { ok: false; error: string };

type Cached = { items: TutorialVideoItem[]; cachedAt: number };
let cache: Cached | null = null;

function fileBaseName(objectKey: string): string {
  const parts = String(objectKey || '').split('/');
  return parts[parts.length - 1] || objectKey;
}

/** 从 `1.数字人展示.mp4` 提取序号；无数字则排到末尾 */
export function parseTutorialSortIndex(objectKeyOrName: string): number {
  const base = fileBaseName(objectKeyOrName);
  const m = base.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

export function tutorialDisplayTitle(objectKey: string): string {
  const base = fileBaseName(objectKey);
  return base.replace(/\.mp4$/i, '') || base;
}

function isUsableMp4(name: string, size: number | undefined): boolean {
  if (!name || name === TUTORIAL_VIDEOS_OSS_PREFIX || name.endsWith('/')) return false;
  if (typeof size === 'number' && size <= 0) return false;
  return VIDEO_EXT_RE.test(name);
}

/** 将对象键编码为公网 URL（支持中文路径） */
export function buildTutorialVideoPublicUrl(objectKey: string, cacheBust?: string | number): string {
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

/**
 * 列举北京桶教学视频目录，按文件名序号升序。
 * @param force 跳过短缓存
 */
export async function listTutorialVideosFromOss(force = false): Promise<ListTutorialVideosResult> {
  const now = Date.now();
  if (!force && cache && now - cache.cachedAt < CACHE_MS) {
    return { ok: true, items: cache.items };
  }

  try {
    const client = await createAliOssClientForMedia('cn');
    const listed = await client.list(
      {
        prefix: TUTORIAL_VIDEOS_OSS_PREFIX,
        'max-keys': 200,
      },
      {},
    );
    const objects = (listed.objects || []).filter((o) =>
      isUsableMp4(String(o.name || ''), o.size),
    );
    if (objects.length === 0) {
      return { ok: false, error: 'empty' };
    }

    const items: TutorialVideoItem[] = objects
      .map((o) => {
        const objectKey = String(o.name);
        const bust = Date.parse(String(o.lastModified || '')) || now;
        return {
          objectKey,
          title: tutorialDisplayTitle(objectKey),
          url: buildTutorialVideoPublicUrl(objectKey, bust),
          sortIndex: parseTutorialSortIndex(objectKey),
        };
      })
      .sort((a, b) => {
        if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
        return a.title.localeCompare(b.title, 'zh-CN');
      });

    cache = { items, cachedAt: now };
    return { ok: true, items };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[tutorialVideos] list failed:', msg);
    return { ok: false, error: msg || 'list failed' };
  }
}
