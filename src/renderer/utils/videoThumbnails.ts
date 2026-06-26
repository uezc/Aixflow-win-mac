/**
 * 从视频中提取帧作为缩略图
 * 使用全局队列限制并发，降低显存压力
 */

let videoExtractQueue = Promise.resolve<void>(undefined);

function enqueueVideoExtract<T>(fn: () => Promise<T>): Promise<T> {
  const prev = videoExtractQueue;
  let resolve: () => void;
  videoExtractQueue = new Promise<void>((r) => { resolve = r; });
  return prev.then(() => fn()).finally(() => resolve!());
}

export function captureVideoFrame(
  videoUrl: string,
  timeSec: number,
  width: number,
  height: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';

    const onError = () => {
      cleanup();
      reject(new Error('Video load failed'));
    };

    const onLoadedData = () => {
      video.currentTime = timeSec;
    };

    const onSeeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          cleanup();
          reject(new Error('Canvas context failed'));
          return;
        }
        ctx.drawImage(video, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        cleanup();
        resolve(dataUrl);
      } catch (e) {
        cleanup();
        reject(e);
      }
    };

    const cleanup = () => {
      video.removeEventListener('error', onError);
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('seeked', onSeeked);
      video.src = '';
      video.load();
    };

    video.addEventListener('error', onError);
    video.addEventListener('loadeddata', onLoadedData);
    video.addEventListener('seeked', onSeeked);
    video.src = videoUrl;
    video.load();
  });
}

/** 提取视频首帧（轻量，用于素材条缩略图） */
export async function captureVideoFirstFrame(
  videoUrl: string,
  timeSec: number,
  thumbSize: number = 48
): Promise<string> {
  return enqueueVideoExtract(() =>
    captureVideoFrame(videoUrl, timeSec, thumbSize, Math.round(thumbSize * 0.6))
  );
}

/** 批量提取视频帧，按每秒一帧（图二风格） */
export async function captureVideoThumbnails(
  videoUrl: string,
  trimStart: number,
  trimEnd: number,
  count: number,
  thumbSize: number = 32
): Promise<string[]> {
  const dur = trimEnd - trimStart;
  if (dur <= 0 || count <= 0) return [];
  return enqueueVideoExtract(async () => {
    const results: string[] = [];
    for (let i = 0; i < count; i++) {
      const t = trimStart + (dur * (i + 0.5)) / count;
      try {
        const dataUrl = await captureVideoFrame(videoUrl, t, thumbSize, Math.round(thumbSize * 0.6));
        results.push(dataUrl);
      } catch {
        results.push('');
      }
    }
    return results;
  });
}
