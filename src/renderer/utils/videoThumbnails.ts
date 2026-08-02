/**
 * 从视频中提取帧作为缩略图
 * - 有限并发（默认 3），避免全串行排队与一口气打满解码
 * - 内存 LRU + 同 key 飞行中去重，避免重复加载同一 src
 * - 时间轴可跳过 ffmpeg getMediaDuration；支持渐进 onFrame（先显首帧）
 */

import { configureVideoElementCrossOriginForCapture } from './extractVideoFrame';
import { normalizeVideoUrl } from './normalizeVideoUrl';

const SEEK_TIMEOUT_MS = 8000;
const LOAD_TIMEOUT_MS = 12000;
/** 时间轴多片段同时抽帧：2～3 较稳；过高会抢预览解码 */
const MAX_PARALLEL = 3;
const CACHE_MAX_ENTRIES = 64;
const JPEG_QUALITY = 0.62;

type QueueTask = {
  id: number;
  priority: number;
  signal?: AbortSignal;
  run: () => Promise<void>;
};

let running = 0;
let taskSeq = 0;
const waitQueue: QueueTask[] = [];
/** 画布平移/缩放时暂停新抽帧，避免与合成器抢主线程/解码 */
let extractQueuePaused = false;

type CacheEntry = { frames: string[]; duration: number; touched: number };
const frameCache = new Map<string, CacheEntry>();

type InflightEntry = {
  promise: Promise<FilmstripCaptureResult>;
  /** 仍在等待该次抽帧的调用方数量；归零才真正 abort */
  retainers: number;
  softAbort: AbortController;
};
const inflightMap = new Map<string, InflightEntry>();

function sortWaitQueue() {
  waitQueue.sort((a, b) => b.priority - a.priority || a.id - b.id);
}

function pumpExtractQueue() {
  if (extractQueuePaused) return;
  while (running < MAX_PARALLEL && waitQueue.length > 0) {
    const task = waitQueue.shift()!;
    if (task.signal?.aborted) {
      continue;
    }
    running += 1;
    void task
      .run()
      .catch(() => undefined)
      .finally(() => {
        running = Math.max(0, running - 1);
        pumpExtractQueue();
      });
  }
}

/** 平移/缩放画布时暂停胶片抽帧队列；松手后恢复 */
export function setVideoExtractQueuePaused(paused: boolean) {
  if (extractQueuePaused === paused) return;
  extractQueuePaused = paused;
  if (!paused) pumpExtractQueue();
}

/**
 * 有限并发调度。priority 越高越先跑（可见片段可抬高）。
 * 挂死保护：单任务内部仍有 seek/load 超时；队列不再用「等上一个 2s」串行链。
 */
function enqueueVideoExtract<T>(
  fn: () => Promise<T>,
  opts?: { priority?: number; signal?: AbortSignal },
): Promise<T> {
  const priority = opts?.priority ?? 0;
  const signal = opts?.signal;
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const id = ++taskSeq;
    const onAbort = () => {
      const idx = waitQueue.findIndex((t) => t.id === id);
      if (idx >= 0) {
        waitQueue.splice(idx, 1);
        reject(new DOMException('aborted', 'AbortError'));
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    waitQueue.push({
      id,
      priority,
      signal,
      run: async () => {
        signal?.removeEventListener('abort', onAbort);
        if (signal?.aborted) {
          reject(new DOMException('aborted', 'AbortError'));
          return;
        }
        try {
          resolve(await fn());
        } catch (e) {
          reject(e);
        }
      },
    });
    sortWaitQueue();
    pumpExtractQueue();
  });
}

/** 清空等待队列并丢弃缓存（重试 / 模块热更新）；进行中的任务会自行结束 */
export function resetVideoExtractQueue() {
  waitQueue.length = 0;
  for (const entry of inflightMap.values()) {
    try {
      entry.softAbort.abort();
    } catch {
      /* ignore */
    }
  }
  inflightMap.clear();
  frameCache.clear();
}

/** 仅清某一缓存键（片段重试时用） */
export function invalidateFilmstripCache(cacheKey?: string) {
  if (!cacheKey) {
    frameCache.clear();
    return;
  }
  frameCache.delete(cacheKey);
  const inflight = inflightMap.get(cacheKey);
  if (inflight) {
    try {
      inflight.softAbort.abort();
    } catch {
      /* ignore */
    }
    inflightMap.delete(cacheKey);
  }
}

function touchCache(key: string, entry: CacheEntry) {
  entry.touched = Date.now();
  frameCache.delete(key);
  frameCache.set(key, entry);
  while (frameCache.size > CACHE_MAX_ENTRIES) {
    const oldest = frameCache.keys().next().value;
    if (oldest == null) break;
    frameCache.delete(oldest);
  }
}

export function buildFilmstripCacheKey(
  videoUrl: string,
  trimStart: number,
  trimEnd: number,
  count: number,
  thumbWidth: number,
  thumbHeight?: number,
): string {
  const u = normalizeVideoUrl(videoUrl);
  const th = thumbHeight ?? 0;
  return `${u}|${trimStart.toFixed(3)}|${trimEnd.toFixed(3)}|${count}|${thumbWidth}|${th}`;
}

/** 同区间已有更密胶片时，下采样复用，避免缩放轨道再抽一遍 */
function sampleCachedFrames(frames: string[], count: number): string[] | null {
  if (!frames.length || count <= 0) return null;
  if (frames.length === count) return frames.slice();
  if (frames.length > count) {
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const idx =
        count === 1 ? 0 : Math.round((i * (frames.length - 1)) / Math.max(count - 1, 1));
      out.push(frames[idx] || frames[0]);
    }
    return out;
  }
  return null;
}

function findReusableCache(
  videoUrl: string,
  trimStart: number,
  trimEnd: number,
  count: number,
  thumbWidth: number,
  thumbHeight?: number,
): FilmstripCaptureResult | null {
  const exact = buildFilmstripCacheKey(videoUrl, trimStart, trimEnd, count, thumbWidth, thumbHeight);
  const hit = frameCache.get(exact);
  if (hit?.frames?.length) {
    touchCache(exact, hit);
    return { frames: hit.frames.slice(), duration: hit.duration };
  }
  const prefix = `${normalizeVideoUrl(videoUrl)}|${trimStart.toFixed(3)}|${trimEnd.toFixed(3)}|`;
  const suffix = `|${thumbWidth}|${thumbHeight ?? 0}`;
  const candidates = Array.from(frameCache.entries());
  for (const [key, entry] of candidates) {
    if (!key.startsWith(prefix) || !key.endsWith(suffix) || !entry.frames.length) continue;
    const sampled = sampleCachedFrames(entry.frames, count);
    if (sampled) {
      touchCache(key, entry);
      return { frames: sampled, duration: entry.duration };
    }
  }
  return null;
}

function waitForEvent(
  target: HTMLVideoElement,
  okEvent: string,
  errEvent: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      cleanup();
      fn();
    };
    const onOk = () => finish(() => resolve());
    const onErr = () => finish(() => reject(new Error(`${errEvent || 'error'}`)));
    const onAbort = () => finish(() => reject(new DOMException('aborted', 'AbortError')));
    const timer = window.setTimeout(() => finish(() => reject(new Error(`${okEvent} timeout`))), timeoutMs);
    const cleanup = () => {
      window.clearTimeout(timer);
      target.removeEventListener(okEvent, onOk);
      target.removeEventListener(errEvent, onErr);
      signal?.removeEventListener('abort', onAbort);
    };
    target.addEventListener(okEvent, onOk, { once: true });
    target.addEventListener(errEvent, onErr, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function seekVideo(video: HTMLVideoElement, timeSec: number, signal?: AbortSignal): Promise<void> {
  const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
  const eps = 0.05;
  let t = Number.isFinite(timeSec) ? timeSec : 0;
  if (dur > 0) {
    t = Math.min(Math.max(0, t), Math.max(0, dur - eps));
  } else {
    t = Math.max(0, t);
  }
  if (Math.abs((video.currentTime || 0) - t) < 0.02 && video.readyState >= 2) {
    return;
  }
  const p = waitForEvent(video, 'seeked', 'error', SEEK_TIMEOUT_MS, signal);
  try {
    video.currentTime = t;
  } catch (e) {
    throw e;
  }
  await p;
}

/**
 * 单帧抓取（会新建 video）。优先用 captureVideoThumbnails 批量抽帧。
 */
export function captureVideoFrame(
  videoUrl: string,
  timeSec: number,
  width: number,
  height: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    configureVideoElementCrossOriginForCapture(video, videoUrl);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const ok = (dataUrl: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(dataUrl);
    };

    const timer = window.setTimeout(() => fail(new Error('Video load timeout')), LOAD_TIMEOUT_MS);

    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener('error', onError);
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeAttribute('src');
      video.load();
    };

    const onError = () => fail(new Error('Video load failed'));

    const onMeta = () => {
      void (async () => {
        try {
          await seekVideo(video, timeSec);
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            fail(new Error('Canvas context failed'));
            return;
          }
          ctx.drawImage(video, 0, 0, width, height);
          ok(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
        } catch (e) {
          fail(e);
        }
      })();
    };

    video.addEventListener('error', onError);
    video.addEventListener('loadedmetadata', onMeta, { once: true });
    video.src = videoUrl;
    video.load();
  });
}

/** 提取视频首帧（轻量） */
export async function captureVideoFirstFrame(
  videoUrl: string,
  timeSec: number,
  thumbSize: number = 48,
): Promise<string> {
  return enqueueVideoExtract(() =>
    captureVideoFrame(videoUrl, timeSec, thumbSize, Math.round(thumbSize * 0.6)),
  );
}

export type FilmstripCaptureResult = {
  frames: string[];
  duration: number;
};

export type FilmstripCaptureOptions = {
  signal?: AbortSignal;
  /** 时间轴已知时长时传入，跳过主进程 ffmpeg 探测 */
  knownDuration?: number;
  skipDurationProbe?: boolean;
  /** 每抽出一帧回调（先首帧再补全胶片） */
  onFrame?: (frame: string, index: number, total: number) => void;
  /** 调度优先级，可见片段建议 > 0 */
  priority?: number;
  /** 强制绕过缓存重抽 */
  bypassCache?: boolean;
};

/**
 * 批量抽帧：单个 video 连续 seek（与视频裁剪胶片条同一策略），避免每帧新建 video + loadeddata 挂死队列。
 */
export async function captureVideoThumbnails(
  videoUrl: string,
  trimStart: number,
  trimEnd: number,
  count: number,
  thumbSize: number = 32,
  thumbHeight?: number,
  signal?: AbortSignal,
): Promise<string[]> {
  const result = await captureVideoFilmstrip(videoUrl, trimStart, trimEnd, count, thumbSize, thumbHeight, signal);
  return result.frames;
}

/** 时间轴 / 裁剪共用：在 [trimStart, trimEnd] 内均匀抽帧 */
export async function captureVideoFilmstrip(
  videoUrl: string,
  trimStart: number,
  trimEnd: number,
  count: number,
  thumbWidth: number = 80,
  thumbHeight?: number,
  signalOrOpts?: AbortSignal | FilmstripCaptureOptions,
): Promise<FilmstripCaptureResult> {
  const opts: FilmstripCaptureOptions =
    signalOrOpts && typeof (signalOrOpts as AbortSignal).aborted === 'boolean'
      ? { signal: signalOrOpts as AbortSignal }
      : ((signalOrOpts as FilmstripCaptureOptions) || {});

  const span = trimEnd - trimStart;
  if (span <= 0 || count <= 0) return { frames: [], duration: 0 };

  const signal = opts.signal;
  const cacheKey = buildFilmstripCacheKey(videoUrl, trimStart, trimEnd, count, thumbWidth, thumbHeight);

  if (!opts.bypassCache) {
    const cached = findReusableCache(videoUrl, trimStart, trimEnd, count, thumbWidth, thumbHeight);
    if (cached) {
      cached.frames.forEach((f, i) => opts.onFrame?.(f, i, cached.frames.length));
      return cached;
    }
    const existing = inflightMap.get(cacheKey);
    if (existing) {
      existing.retainers += 1;
      const onAbort = () => {
        existing.retainers = Math.max(0, existing.retainers - 1);
        if (existing.retainers === 0) {
          try {
            existing.softAbort.abort();
          } catch {
            /* ignore */
          }
        }
      };
      if (signal?.aborted) {
        onAbort();
        throw new DOMException('aborted', 'AbortError');
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const shared = await existing.promise;
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        shared.frames.forEach((f, i) => opts.onFrame?.(f, i, shared.frames.length));
        return { frames: shared.frames.slice(), duration: shared.duration };
      } finally {
        signal?.removeEventListener('abort', onAbort);
        existing.retainers = Math.max(0, existing.retainers - 1);
      }
    }
  }

  const softAbort = new AbortController();
  const linkAbort = () => {
    const entry = inflightMap.get(cacheKey);
    if (!entry) return;
    entry.retainers = Math.max(0, entry.retainers - 1);
    if (entry.retainers === 0) {
      try {
        softAbort.abort();
      } catch {
        /* ignore */
      }
    }
  };
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  signal?.addEventListener('abort', linkAbort, { once: true });

  /** 合并调用方 abort 与共享 softAbort */
  const workSignal = softAbort.signal;

  const work = enqueueVideoExtract(
    async () => {
      if (workSignal.aborted) throw new DOMException('aborted', 'AbortError');

      // 二次检查：排队期间可能已被其它任务写入缓存
      if (!opts.bypassCache) {
        const cached = findReusableCache(videoUrl, trimStart, trimEnd, count, thumbWidth, thumbHeight);
        if (cached) return cached;
      }

      const normalized = normalizeVideoUrl(videoUrl);
      const video = document.createElement('video');
      configureVideoElementCrossOriginForCapture(video, normalized);
      video.muted = true;
      video.playsInline = true;
      // metadata 足够 seek；auto 会多拉码流、拖慢多片段并行
      video.preload = 'metadata';
      video.src = normalized;

      try {
        await waitForEvent(video, 'loadedmetadata', 'error', LOAD_TIMEOUT_MS, workSignal);
      } catch (e) {
        video.removeAttribute('src');
        video.load();
        throw e;
      }

      const htmlDur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      const known =
        typeof opts.knownDuration === 'number' && opts.knownDuration > 0.05 ? opts.knownDuration : 0;
      let probedDur = 0;
      const skipProbe = opts.skipDurationProbe === true || known > 0;
      if (!skipProbe) {
        try {
          if (window.electronAPI?.getMediaDuration) {
            probedDur = Number(await window.electronAPI.getMediaDuration(normalized)) || 0;
          }
        } catch {
          probedDur = 0;
        }
      }
      if (workSignal.aborted) {
        video.removeAttribute('src');
        video.load();
        throw new DOMException('aborted', 'AbortError');
      }

      const mediaDur =
        probedDur > 0.2 ? probedDur : known > 0.2 ? known : htmlDur;
      const ts = Math.max(0, trimStart);
      let te = Math.max(ts + 0.05, trimEnd);
      if (mediaDur > 0) {
        te = Math.min(te, mediaDur);
      }
      const range = Math.max(0.05, te - ts);

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) {
        video.removeAttribute('src');
        video.load();
        return { frames: [], duration: mediaDur || range };
      }

      const frames: string[] = [];
      const n = Math.max(1, Math.min(48, Math.floor(count)));
      for (let i = 0; i < n; i++) {
        if (workSignal.aborted) {
          video.removeAttribute('src');
          video.load();
          throw new DOMException('aborted', 'AbortError');
        }
        const t = n === 1 ? ts + range * 0.5 : ts + (range * i) / Math.max(n - 1, 1);
        try {
          await seekVideo(video, t, workSignal);
          const vw = video.videoWidth || 160;
          const vh = video.videoHeight || 90;
          const tw = thumbWidth;
          const th = thumbHeight ?? Math.max(36, Math.round((tw * vh) / Math.max(vw, 1)));
          canvas.width = tw;
          canvas.height = th;
          ctx.drawImage(video, 0, 0, tw, th);
          const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
          frames.push(dataUrl);
          opts.onFrame?.(dataUrl, i, n);
        } catch (e) {
          if ((e as { name?: string })?.name === 'AbortError' || workSignal.aborted) {
            video.removeAttribute('src');
            video.load();
            throw e instanceof DOMException ? e : new DOMException('aborted', 'AbortError');
          }
          frames.push('');
        }
      }

      video.removeAttribute('src');
      video.load();
      const ok = frames.filter(Boolean);
      const result: FilmstripCaptureResult = { frames: ok, duration: mediaDur || range };
      if (ok.length > 0) {
        touchCache(cacheKey, { frames: ok, duration: result.duration, touched: Date.now() });
      }
      return result;
    },
    { priority: opts.priority ?? 0, signal: workSignal },
  );

  const entry: InflightEntry = { promise: work, retainers: 1, softAbort };
  inflightMap.set(cacheKey, entry);
  try {
    const result = await work;
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return result;
  } finally {
    signal?.removeEventListener('abort', linkAbort);
    if (inflightMap.get(cacheKey) === entry) inflightMap.delete(cacheKey);
  }
}
