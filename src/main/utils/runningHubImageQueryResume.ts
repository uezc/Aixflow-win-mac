/**
 * 应用重启后根据 RunningHub taskId 对图片任务继续 /query（FC taskType=image）。
 */
import { randomUUID } from 'crypto';
import axios from 'axios';
import AdmZip from 'adm-zip';
import { rhQueryPollImage } from './runningHubFcHelpers.js';
import { getAliyunFcInitUserUrl } from '../config/aliyunConfig.js';
import { normalizeRunningHubPollStatus } from './runningHubVideoQueryResume.js';

const IMAGE_OUTPUT_TYPES = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'image', 'img', 'picture', 'photo']);
const NON_IMAGE_OUTPUT_TYPES = new Set(['txt', 'text', 'json', 'mp4', 'webm', 'mov', 'avi', 'zip', 'glb', 'gltf']);
const IMAGE_URL_EXT_RE = /\.(png|jpg|jpeg|webp|bmp|gif)(?:$|[?#])/i;
const NON_IMAGE_URL_EXT_RE = /\.(zip|mp4|webm|mov|avi|txt|json|glb|gltf|obj|fbx)(?:$|[?#])/i;

function isExplicitNonImageUrl(u: string): boolean {
  return NON_IMAGE_URL_EXT_RE.test(u.trim());
}

function isLikelyImageHttpUrl(u: string): boolean {
  const s = u.trim();
  if (!/^https?:\/\//i.test(s)) return false;
  /** zip/视频等即使挂在 RH/OSS 域名上也绝不当图片 */
  if (isExplicitNonImageUrl(s)) return false;
  if (IMAGE_URL_EXT_RE.test(s)) return true;
  if (/runninghub|aliyuncs|oss-|rh-artifacts|rhcdn|rh-images/i.test(s)) return true;
  return false;
}

function pushImageUrl(urls: string[], raw: string): void {
  const u = raw.trim();
  if (!u || !isLikelyImageHttpUrl(u)) return;
  if (!urls.includes(u)) urls.push(u);
}

/** 结果条目：优先 png/jpg 等图片，zip 永远排到最后（且通常已被过滤） */
function scoreImageUrlCandidate(u: string, outputType?: string): number {
  const lower = u.toLowerCase();
  const out = String(outputType || '')
    .trim()
    .toLowerCase();
  if (out === 'zip' || /\.zip(?:$|[?#])/i.test(lower)) return -1000;
  if (NON_IMAGE_OUTPUT_TYPES.has(out) && !IMAGE_OUTPUT_TYPES.has(out)) return -500;
  let score = 0;
  if (IMAGE_OUTPUT_TYPES.has(out)) score += 80;
  if (/\.png(?:$|[?#])/i.test(lower)) score += 40;
  else if (/\.(jpe?g|webp|bmp|gif)(?:$|[?#])/i.test(lower)) score += 30;
  if (/comfyui_/i.test(lower) && !/comfyui_zip/i.test(lower)) score += 10;
  return score;
}

function splitUrlListString(s: string): string[] {
  const parts = s.split(/[\n\r,;|\t]+/).map((x) => x.trim()).filter(Boolean);
  if (parts.length <= 1) return parts;
  return parts.filter((p) => /^https?:\/\//i.test(p));
}

function urlFromRhResultItem(item: unknown, relaxed: boolean): string {
  if (!item || typeof item !== 'object') return '';
  const o = item as Record<string, unknown>;
  const out = String(o.outputType ?? o.type ?? '').trim().toLowerCase();
  if (out && NON_IMAGE_OUTPUT_TYPES.has(out) && !IMAGE_OUTPUT_TYPES.has(out)) return '';

  for (const k of ['url', 'fileUrl', 'imageUrl', 'image_url', 'output', 'href']) {
    const v = o[k];
    if (typeof v !== 'string') continue;
    const pieces = splitUrlListString(v);
    if (pieces.length > 1) {
      const preferred = pieces.find((p) => isLikelyImageHttpUrl(p) && !isExplicitNonImageUrl(p));
      if (preferred) return preferred;
      continue;
    }
    const trimmed = v.trim();
    if (!/^https?:\/\//i.test(trimmed) || isExplicitNonImageUrl(trimmed)) continue;
    /** outputType=png/jpg 时即使无扩展名（签名下载链）也采纳 */
    if (IMAGE_OUTPUT_TYPES.has(out)) return trimmed;
    if (isLikelyImageHttpUrl(trimmed)) return trimmed;
  }
  const nested = o.url;
  if (nested && typeof nested === 'object') {
    const n = nested as { url?: string; href?: string };
    if (typeof n.url === 'string' && isLikelyImageHttpUrl(n.url)) return n.url.trim();
    if (typeof n.href === 'string' && isLikelyImageHttpUrl(n.href)) return n.href.trim();
  }
  if (relaxed) {
    if (out && NON_IMAGE_OUTPUT_TYPES.has(out)) return '';
  }
  return '';
}

function collectUrlsFromResultItem(item: unknown, urls: string[], relaxed: boolean): void {
  if (typeof item === 'string') {
    for (const u of splitUrlListString(item)) pushImageUrl(urls, u);
    return;
  }
  if (!item || typeof item !== 'object') return;
  const o = item as Record<string, unknown>;
  for (const k of ['urls', 'images', 'outputs', 'image_list', 'imageList', 'files']) {
    const arr = o[k];
    if (Array.isArray(arr)) {
      for (const el of arr) collectUrlsFromResultItem(el, urls, relaxed);
    }
  }
  const out = String(o.outputType ?? o.type ?? '').trim().toLowerCase();
  /** 明确非图（zip 等）直接跳过，避免 results[0] 误取压缩包 */
  if (out && NON_IMAGE_OUTPUT_TYPES.has(out) && !IMAGE_OUTPUT_TYPES.has(out)) return;

  const u = urlFromRhResultItem(item, relaxed);
  if (u) {
    if (!out || relaxed || IMAGE_OUTPUT_TYPES.has(out) || IMAGE_URL_EXT_RE.test(u)) {
      pushImageUrl(urls, u);
    }
  }
}

function deepCollectImageUrls(value: unknown, urls: string[], relaxed: boolean, depth: number): void {
  if (depth > 10 || value == null) return;
  if (typeof value === 'string') {
    for (const u of splitUrlListString(value)) pushImageUrl(urls, u);
    return;
  }
  if (Array.isArray(value)) {
    for (const el of value) {
      collectUrlsFromResultItem(el, urls, relaxed);
      deepCollectImageUrls(el, urls, relaxed, depth + 1);
    }
    return;
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (Array.isArray(o.results)) {
      for (const item of o.results) collectUrlsFromResultItem(item, urls, relaxed);
    }
    const tr = o.task_result;
    if (tr && typeof tr === 'object') {
      const tro = tr as Record<string, unknown>;
      for (const k of ['images', 'image', 'outputs', 'files', 'results']) {
        const v = tro[k];
        if (Array.isArray(v)) for (const el of v) collectUrlsFromResultItem(el, urls, relaxed);
        else collectUrlsFromResultItem(v, urls, relaxed);
      }
    }
    for (const k of Object.keys(o)) {
      if (['nodeInfoList', 'prompt', 'errorMessage', 'error', 'message', 'msg'].includes(k)) continue;
      deepCollectImageUrls(o[k], urls, relaxed, depth + 1);
    }
  }
}

/** 从 /query 提取全部图片 URL（人物多角度等多图任务）；始终排除 zip 等非图输出 */
export function extractAllRunningHubImageUrlsFromPoll(
  pollData: Record<string, unknown>,
  options?: { relaxed?: boolean },
): string[] {
  const relaxed = options?.relaxed ?? false;
  const urls: string[] = [];
  deepCollectImageUrls(pollData, urls, relaxed, 0);

  /** 顶层 results 再扫一遍：按 outputType 明确挑图，防止深搜漏掉或混入 zip */
  const results = Array.isArray(pollData.results)
    ? pollData.results
    : Array.isArray((pollData as { data?: { results?: unknown } }).data?.results)
      ? ((pollData as { data: { results: unknown[] } }).data.results as unknown[])
      : [];
  if (results.length > 0) {
    const scored: { url: string; score: number }[] = [];
    for (const item of results) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const out = String(rec.outputType ?? rec.type ?? '').trim().toLowerCase();
      if (out && NON_IMAGE_OUTPUT_TYPES.has(out) && !IMAGE_OUTPUT_TYPES.has(out)) continue;
      const u = urlFromRhResultItem(item, true);
      if (!u || isExplicitNonImageUrl(u)) continue;
      scored.push({ url: u, score: scoreImageUrlCandidate(u, out) });
    }
    scored.sort((a, b) => b.score - a.score);
    for (const s of scored) {
      if (s.score < 0) continue;
      pushImageUrl(urls, s.url);
    }
  }

  const filtered = urls.filter((u) => !isExplicitNonImageUrl(u));
  filtered.sort((a, b) => scoreImageUrlCandidate(b) - scoreImageUrlCandidate(a));
  return filtered;
}

async function tryExpandJsonManifest(url: string): Promise<string[]> {
  if (!/\.json(?:$|[?#])/i.test(url)) return [];
  try {
    const res = await axios.get(url, { timeout: 30000, responseType: 'json' });
    const urls: string[] = [];
    deepCollectImageUrls(res.data, urls, true, 0);
    return urls;
  } catch {
    return [];
  }
}

async function expandZipToUploadedImageUrls(zipUrl: string): Promise<string[]> {
  const { VideoProvider } = await import('../ai/providers/VideoProvider.js');
  const vp = new VideoProvider();
  const res = await axios.get(zipUrl, {
    responseType: 'arraybuffer',
    timeout: 120000,
    maxContentLength: 200 * 1024 * 1024,
  });
  const zip = new AdmZip(Buffer.from(res.data));
  const urls: string[] = [];
  const entries = zip
    .getEntries()
    .filter((e) => !e.isDirectory && /\.(png|jpe?g|webp|bmp)$/i.test(e.entryName));
  entries.sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));
  for (const entry of entries) {
    const n = entry.entryName.toLowerCase();
    const mime = n.endsWith('.png')
      ? 'image/png'
      : n.endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg';
    const publicUrl = await vp.uploadImageToOSS(entry.getData(), mime);
    urls.push(publicUrl);
  }
  return urls;
}

/** 人物多角度：解压 zip / 读取 json 清单，展开为多张可展示 URL */
export async function finalizeCharacterMultiAngleImageUrls(urls: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const raw of urls) {
    const u = raw.trim();
    if (!u) continue;
    if (/\.zip(?:$|[?#])/i.test(u)) {
      try {
        out.push(...(await expandZipToUploadedImageUrls(u)));
      } catch (e) {
        console.warn('[人物多角度] zip 解压失败', u, e);
        pushImageUrl(out, u);
      }
      continue;
    }
    if (/\.json(?:$|[?#])/i.test(u)) {
      const fromJson = await tryExpandJsonManifest(u);
      if (fromJson.length > 0) {
        out.push(...fromJson);
        continue;
      }
    }
    pushImageUrl(out, u);
  }
  return out;
}

function firstRhImageUrlFromResultItem(item: unknown): string | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const o = item as Record<string, unknown>;
  const out = String(o.outputType ?? o.type ?? '').trim().toLowerCase();
  if (out && NON_IMAGE_OUTPUT_TYPES.has(out) && !IMAGE_OUTPUT_TYPES.has(out)) return undefined;
  for (const k of ['url', 'fileUrl', 'imageUrl', 'image_url', 'videoUrl', 'video_url']) {
    const v = o[k];
    if (typeof v === 'string' && /^https?:\/\//i.test(v) && !isExplicitNonImageUrl(v)) {
      if (IMAGE_OUTPUT_TYPES.has(out) || isLikelyImageHttpUrl(v)) return v;
    }
  }
  const nested = o.url;
  if (nested && typeof nested === 'object' && 'url' in nested && typeof (nested as { url?: string }).url === 'string') {
    const inner = (nested as { url: string }).url;
    if (/^https?:\/\//i.test(inner) && !isExplicitNonImageUrl(inner) && isLikelyImageHttpUrl(inner)) return inner;
  }
  return undefined;
}

/** 从 /query 响应中尽量提取图片 URL（与 ImageProvider 宽松解析、FC 解包后结构对齐） */
export function extractRunningHubImageUrlFromPoll(pollData: Record<string, unknown>): string | undefined {
  const all = extractAllRunningHubImageUrlsFromPoll(pollData, { relaxed: true });
  if (all.length > 0) return all[0];
  const d = pollData as Record<string, any>;
  const resultsArray = Array.isArray(d.results) ? d.results : d.data?.results;
  if (resultsArray && resultsArray.length > 0) {
    for (const item of resultsArray) {
      const u = firstRhImageUrlFromResultItem(item);
      if (u) return u;
    }
  }
  const tr = d.data?.task_result;
  const images = tr?.images;
  if (Array.isArray(images) && images.length > 0) {
    const u = firstRhImageUrlFromResultItem(images[0]);
    if (u) return u;
  }
  const deepTr = d.data?.data?.task_result;
  const deepImages = deepTr?.images;
  if (Array.isArray(deepImages) && deepImages.length > 0) {
    const u = firstRhImageUrlFromResultItem(deepImages[0]);
    if (u) return u;
  }
  const topImage =
    typeof d.image_url === 'string' && /^https?:\/\//i.test(d.image_url) && !isExplicitNonImageUrl(d.image_url)
      ? d.image_url
      : typeof d.imageUrl === 'string' && /^https?:\/\//i.test(d.imageUrl) && !isExplicitNonImageUrl(d.imageUrl)
        ? d.imageUrl
        : undefined;
  if (topImage) return topImage;

  const fallback =
    d.data?.output ||
    d.data?.data?.output ||
    d.output ||
    d.url ||
    d.data?.url ||
    undefined;
  if (typeof fallback === 'string' && /^https?:\/\//i.test(fallback) && !isExplicitNonImageUrl(fallback)) {
    return fallback;
  }
  return undefined;
}

export type RunningHubImageResumeResult =
  | { ok: true; imageUrl: string }
  | { ok: false; error: string };

const DEFAULT_TIMEOUT_MS = 25 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;
const MAX_SUCCESS_WITHOUT_URL_ROUNDS = 24;

function isRetryableResumeQueryError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  const code = String((err as { code?: string })?.code || '');
  return (
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNABORTED' ||
    /ECONNRESET|socket hang up|ETIMEDOUT|ECONNREFUSED|ECONNABORTED|network error/i.test(msg)
  );
}

/** 恢复轮询时国内/海外都问一遍，避免粘性丢失后问错站、平台已出图却一直 RUNNING */
async function rhQueryPollImageResumeOnce(
  rhTaskId: string,
  attempt: number,
): Promise<Record<string, unknown>> {
  const token = randomUUID();
  const regions: Array<'ai' | 'cn'> = ['ai', 'cn'];
  let last: Record<string, unknown> = {};
  let lastErr: unknown;
  let progressHit: Record<string, unknown> | null = null;
  let failHit: Record<string, unknown> | null = null;
  for (const region of regions) {
    try {
      const data = (await rhQueryPollImage(
        String(rhTaskId),
        `resume-rh-img:${token}:p${attempt}:${region}`,
        undefined,
        { rhRegion: region },
      )) as Record<string, unknown>;
      last = data;
      const rawSt = data.status ?? data.taskStatus ?? data.task_status;
      const normalized = normalizeRunningHubPollStatus(rawSt);
      if (normalized === 'SUCCESS') return data;
      if (normalized === 'IN_PROGRESS' || normalized === 'NOT_START') {
        if (!progressHit) progressHit = data;
        continue;
      }
      if (normalized === 'FAILURE' || normalized === 'FAILED') {
        if (!failHit) failHit = data;
      }
    } catch (e) {
      lastErr = e;
    }
  }
  if (progressHit) return progressHit;
  if (failHit) return failHit;
  if (Object.keys(last).length > 0) return last;
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || '查询失败'));
}

export async function pollRunningHubImageUntilTerminal(
  rhTaskId: string,
  options?: {
    totalTimeoutMs?: number;
    onTick?: (info: { attempt: number; normalizedStatus?: string }) => void;
  },
): Promise<RunningHubImageResumeResult> {
  if (!getAliyunFcInitUserUrl().trim()) {
    return { ok: false, error: '未配置云端转发（ALIYUN_FC_INIT_USER_URL），无法恢复 RunningHub 图片任务' };
  }
  const deadline = Date.now() + (options?.totalTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  let attempt = 0;
  let successWithoutUrlRounds = 0;

  while (Date.now() < deadline) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    attempt++;
    let pollData: Record<string, unknown>;
    try {
      pollData = await rhQueryPollImageResumeOnce(String(rhTaskId), attempt);
    } catch (e) {
      if (isRetryableResumeQueryError(e)) {
        continue;
      }
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `查询任务失败：${msg}` };
    }

    const rawSt =
      pollData.status ??
      (pollData as Record<string, unknown>).taskStatus ??
      (pollData as Record<string, unknown>).task_status;
    const normalized = normalizeRunningHubPollStatus(rawSt);
    options?.onTick?.({ attempt, normalizedStatus: normalized });

    if (normalized === 'SUCCESS') {
      const url = extractRunningHubImageUrlFromPoll(pollData);
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        return { ok: true, imageUrl: url };
      }
      successWithoutUrlRounds += 1;
      if (successWithoutUrlRounds >= MAX_SUCCESS_WITHOUT_URL_ROUNDS) {
        return { ok: false, error: '任务已成功但未解析到图片地址，请在 RunningHub 控制台查看' };
      }
      continue;
    }
    successWithoutUrlRounds = 0;
    if (normalized === 'FAILURE' || normalized === 'FAILED') {
      const msg = String(pollData.errorMessage ?? pollData.error ?? pollData.message ?? '生成失败');
      return { ok: false, error: msg };
    }
  }

  return { ok: false, error: '恢复轮询超时。若云端已生成完成，可在 RunningHub 任务详情中查看。' };
}
