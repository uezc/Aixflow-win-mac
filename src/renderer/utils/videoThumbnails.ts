/**
 * 从视频中提取帧作为缩略图
 * 使用全局队列限制并发；单 video 连续 seek（对齐 VideoTrimFilmstripBar.extractFilmstrip）
 */

import { configureVideoElementCrossOriginForCapture } from './extractVideoFrame';
import { normalizeVideoUrl } from './normalizeVideoUrl';

let videoExtractQueue = Promise.resolve<void>(undefined);

/** 打断可能已挂死的旧队列（preload=metadata + loadeddata 曾导致永久卡住） */
export function resetVideoExtractQueue() {
  videoExtractQueue = Promise.resolve();
}

function enqueueVideoExtract<T>(fn: () => Promise<T>): Promise<T> {
  const prev = videoExtractQueue;
  let release!: () => void;
  videoExtractQueue = new Promise<void>((r) => {
    release = r;
  });
  // 若上一个任务挂死，最多等 2s 后继续，避免整条胶片永久空白
  const waitPrev = Promise.race([
    prev.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((r) => {
      window.setTimeout(r, 2000);
    }),
  ]);
  return waitPrev
    .then(() => fn())
    .finally(() => {
      release();
    });
}

const SEEK_TIMEOUT_MS = 8000;
const LOAD_TIMEOUT_MS = 12000;

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
  // 已在目标附近则跳过 seek，避免部分源不触发 seeked
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
          ok(canvas.toDataURL('image/jpeg', 0.7));
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
  signal?: AbortSignal,
): Promise<FilmstripCaptureResult> {
  const span = trimEnd - trimStart;
  if (span <= 0 || count <= 0) return { frames: [], duration: 0 };

  return enqueueVideoExtract(async () => {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

    const normalized = normalizeVideoUrl(videoUrl);
    const video = document.createElement('video');
    configureVideoElementCrossOriginForCapture(video, normalized);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = normalized;

    try {
      await waitForEvent(video, 'loadedmetadata', 'error', LOAD_TIMEOUT_MS, signal);
    } catch (e) {
      video.removeAttribute('src');
      video.load();
      throw e;
    }

    const htmlDur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    let probedDur = 0;
    try {
      if (window.electronAPI?.getMediaDuration) {
        probedDur = Number(await window.electronAPI.getMediaDuration(normalized)) || 0;
      }
    } catch {
      probedDur = 0;
    }
    if (signal?.aborted) {
      video.removeAttribute('src');
      video.load();
      throw new DOMException('aborted', 'AbortError');
    }

    const mediaDur = probedDur > 0.2 ? probedDur : htmlDur;
    const ts = Math.max(0, trimStart);
    let te = Math.max(ts + 0.05, trimEnd);
    if (mediaDur > 0) {
      te = Math.min(te, mediaDur);
    }
    const range = Math.max(0.05, te - ts);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      video.removeAttribute('src');
      video.load();
      return { frames: [], duration: mediaDur || range };
    }

    const frames: string[] = [];
    const n = Math.max(1, Math.min(48, Math.floor(count)));
    for (let i = 0; i < n; i++) {
      if (signal?.aborted) {
        video.removeAttribute('src');
        video.load();
        throw new DOMException('aborted', 'AbortError');
      }
      const t = n === 1 ? ts + range * 0.5 : ts + (range * i) / Math.max(n - 1, 1);
      try {
        await seekVideo(video, t, signal);
        const vw = video.videoWidth || 160;
        const vh = video.videoHeight || 90;
        const tw = thumbWidth;
        const th = thumbHeight ?? Math.max(36, Math.round((tw * vh) / Math.max(vw, 1)));
        canvas.width = tw;
        canvas.height = th;
        ctx.drawImage(video, 0, 0, tw, th);
        frames.push(canvas.toDataURL('image/jpeg', 0.72));
      } catch {
        frames.push('');
      }
    }

    video.removeAttribute('src');
    video.load();
    const ok = frames.filter(Boolean);
    return { frames: ok, duration: mediaDur || range };
  });
}
