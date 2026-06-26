import { useCallback, useEffect, useState } from 'react';

const DEFAULT_OSS_ROOT = 'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com';

/** Bucket 公网根（不含 /web）；配 `VITE_OSS_PUBLIC_BASE` 时与 CDN 一致 */
export const OSS_BUCKET_ROOT = (import.meta.env.VITE_OSS_PUBLIC_BASE || DEFAULT_OSS_ROOT).replace(/\/$/, '');

/** Web 静态资源前缀：${OSS_BUCKET_ROOT}/web */
export const OSS_WEB_BASE = `${OSS_BUCKET_ROOT}/web`;

/** 配置文件：${OSS_WEB_BASE}/data/config.json */
export const OSS_WEB_CONFIG_DEFAULT_URL = `${OSS_WEB_BASE}/data/config.json`;

/** 与 public/config_template.json 一致 */
export type SceneMediaType = string;

export type SceneItem = {
  title: string;
  mediaUrl: string;
  type: SceneMediaType;
  description?: string;
  /** ready：正常展示媒体；processing：可配合前端模拟进度 */
  status?: 'ready' | 'processing' | string;
};

export type OssSceneConfig = {
  version: string;
  projectName: string;
  scenes: SceneItem[];
};

/** 根据 type 映射到 /web 下子目录 */
export function typeToWebMediaFolder(type: string): 'video' | 'image' | 'music' | 'workflow' {
  const t = String(type || '').toLowerCase();
  if (t === 'video') return 'video';
  if (t === 'manga' || t === 'image' || t === 'picture' || t === 'img') return 'image';
  if (t === 'music' || t === 'audio') return 'music';
  if (t === 'workflow') return 'workflow';
  return 'image';
}

/**
 * 将 config 中的 mediaUrl 解析为可请求的绝对 URL。
 * - 已是 http(s):// 则原样返回；
 * - 以 /web/ 或 web/ 开头则拼在 Bucket 根下；
 * - 否则视为相对文件名或相对路径，按 type 拼到 ${OSS_WEB_BASE}/{video|image|music|workflow}/ 下。
 */
export function resolveOssWebMediaUrl(
  mediaUrl: string,
  type: string,
  options?: { webBase?: string; bucketRoot?: string },
): string {
  const raw = String(mediaUrl || '').trim();
  if (!raw) return '';

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  const bucketRoot = (options?.bucketRoot || OSS_BUCKET_ROOT).replace(/\/$/, '');
  const webBase = (options?.webBase || OSS_WEB_BASE).replace(/\/$/, '');

  if (raw.startsWith('/web/') || raw.startsWith('web/')) {
    const pathFromRoot = raw.startsWith('/web/') ? raw : `/${raw}`;
    return `${bucketRoot}${pathFromRoot}`;
  }

  const folder = typeToWebMediaFolder(type);
  const pathOnly = raw.replace(/^\/+/, '');
  return `${webBase}/${folder}/${pathOnly}`;
}

function defaultConfigUrl(): string {
  const u = (import.meta.env.VITE_OSS_SCENE_CONFIG_URL || '').trim();
  if (u) return u;
  return OSS_WEB_CONFIG_DEFAULT_URL;
}

function withCacheBust(url: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}t=${Date.now()}`;
}

function normalizeConfig(raw: unknown): OssSceneConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const version = String(o.version ?? '1');
  const projectName = String(o.projectName ?? 'Untitled');
  const scenesRaw = o.scenes;
  if (!Array.isArray(scenesRaw)) return null;
  const scenes: SceneItem[] = scenesRaw
    .filter((s) => s && typeof s === 'object')
    .map((s) => {
      const r = s as Record<string, unknown>;
      return {
        title: String(r.title ?? ''),
        mediaUrl: String(r.mediaUrl ?? ''),
        type: String(r.type ?? 'image'),
        description: r.description != null ? String(r.description) : undefined,
        status: r.status != null ? String(r.status) : 'ready',
      };
    });
  return { version, projectName, scenes };
}

export type UseOSSConfigResult = {
  data: OssSceneConfig | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  configUrl: string;
};

/**
 * 从 OSS 拉取 web/data/config.json（默认），URL 后附加时间戳防缓存。
 */
export function useOSSConfig(urlOverride?: string): UseOSSConfigResult {
  const baseUrl = (urlOverride || defaultConfigUrl()).trim();
  const [data, setData] = useState<OssSceneConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!baseUrl) {
      setLoading(false);
      setError('未配置 OSS 配置地址（VITE_OSS_SCENE_CONFIG_URL）。');
      setData(null);
      return;
    }

    const ac = new AbortController();
    let cancelled = false;

    setLoading(true);
    setError(null);

    const run = async () => {
      try {
        const res = await fetch(withCacheBust(baseUrl), {
          method: 'GET',
          signal: ac.signal,
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();
        const norm = normalizeConfig(json);
        if (!norm) {
          throw new Error('JSON 结构无效：需要 version、projectName、scenes 数组');
        }
        if (!cancelled) {
          setData(norm);
          setError(null);
        }
      } catch (e) {
        if (ac.signal.aborted || cancelled) return;
        const isTypeErr = e instanceof TypeError;
        const msg = isTypeErr
          ? '无法拉取配置：多为跨域（CORS）未放行、或对象不存在/未公开读。请将 config.json 置于 Bucket 的 web/data/ 下，并在 OSS 配置 CORS（允许 GET）。'
          : e instanceof Error
            ? e.message
            : String(e);
        setError(msg);
        setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [baseUrl, tick]);

  return { data, loading, error, refetch, configUrl: baseUrl };
}
