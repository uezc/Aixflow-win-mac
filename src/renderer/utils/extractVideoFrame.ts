/** 视频帧 canvas 最大纹理边长，超过会按比例缩小，避免 GPU 崩溃 */
export const MAX_VIDEO_FRAME_TEXTURE_SIZE = 2048;

/** 仅远程 http(s) 视频需 crossOrigin；本地 local-resource / file / data URL 设 anonymous 易导致无法解码或 canvas 污染。 */
export function configureVideoElementCrossOriginForCapture(video: HTMLVideoElement, videoUrl: string) {
  const u = (videoUrl || '').trim();
  if (/^https?:\/\//i.test(u)) {
    video.crossOrigin = 'anonymous';
  } else {
    video.removeAttribute('crossOrigin');
  }
}

function clampCaptureTimeSec(video: HTMLVideoElement, timeSec: number): number {
  const dur = video.duration;
  let t = typeof timeSec === 'number' && Number.isFinite(timeSec) ? timeSec : 0.1;
  if (Number.isFinite(dur) && dur > 0) {
    const eps = 0.05;
    const hi = Math.max(eps, dur - eps);
    const lo = Math.min(eps, hi);
    t = Math.min(Math.max(lo, t), hi);
  } else {
    t = Math.max(0.1, t);
  }
  return t;
}

function captureFrameFromVideo(video: HTMLVideoElement): { ok: true; imageUrl: string } | { ok: false; error: string } {
  let w = video.videoWidth;
  let h = video.videoHeight;
  if (!w || !h) {
    return { ok: false, error: '视频尚未解码出画面' };
  }
  if (w > MAX_VIDEO_FRAME_TEXTURE_SIZE || h > MAX_VIDEO_FRAME_TEXTURE_SIZE) {
    const r = Math.min(MAX_VIDEO_FRAME_TEXTURE_SIZE / w, MAX_VIDEO_FRAME_TEXTURE_SIZE / h);
    w = Math.round(w * r);
    h = Math.round(h * r);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { ok: false, error: '无法获取 canvas 上下文' };
  }
  ctx.drawImage(video, 0, 0, w, h);
  try {
    const imageUrl = canvas.toDataURL('image/png');
    if (!imageUrl || imageUrl.length < 32) {
      return { ok: false, error: '导出帧为空' };
    }
    return { ok: true, imageUrl };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '导出帧失败';
    return { ok: false, error: msg };
  }
}

/** 截取视频中指定时刻的一帧（秒），时间会在 [0, duration] 内夹紧 */
export async function extractVideoFrameAtTime(
  videoUrl: string,
  timeSec: number | undefined,
): Promise<{ success: boolean; imageUrl?: string; error?: string; width?: number; height?: number }> {
  return new Promise((resolve) => {
    try {
      const video = document.createElement('video');
      configureVideoElementCrossOriginForCapture(video, videoUrl);
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      video.src = videoUrl;

      let settled = false;
      const finish = (
        ok: boolean,
        imageUrl?: string,
        error?: string,
        width?: number,
        height?: number,
      ) => {
        if (settled) return;
        settled = true;
        try {
          video.src = '';
          video.load();
        } catch {
          /* ignore */
        }
        resolve(ok ? { success: true, imageUrl, width, height } : { success: false, error });
      };

      video.addEventListener('loadedmetadata', () => {
        try {
          video.currentTime = clampCaptureTimeSec(video, typeof timeSec === 'number' ? timeSec : 0.1);
        } catch (error) {
          console.error('[extractVideoFrame] 设置 currentTime 失败:', error);
        }
      });

      video.addEventListener('seeked', () => {
        const cap = captureFrameFromVideo(video);
        if (!cap.ok) {
          finish(false, undefined, cap.error);
          return;
        }
        finish(true, cap.imageUrl, undefined, video.videoWidth, video.videoHeight);
      });

      video.addEventListener('error', () => {
        finish(false, undefined, '视频加载失败');
      });

      setTimeout(() => {
        if (!settled && video.readyState < 2) {
          finish(false, undefined, '视频加载超时');
        }
      }, 15000);

      video.load();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '创建视频元素失败';
      resolve({ success: false, error: msg });
    }
  });
}

export const VIDEO_FRAME_SPLIT_INTERVALS = [1, 2, 3, 5, 10, 20, 30] as const;
export type VideoFrameSplitIntervalSec = (typeof VIDEO_FRAME_SPLIT_INTERVALS)[number];

/** 按间隔生成拆帧时间点（含首尾），秒 */
export function buildVideoFrameTimestamps(durationSec: number, intervalSec: number): number[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [0];
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) return [0];
  const eps = 0.05;
  const end = Math.max(eps, durationSec - eps);
  const times: number[] = [];
  for (let t = 0; t <= end + 1e-6; t += intervalSec) {
    times.push(Math.round(Math.min(t, end) * 100) / 100);
  }
  if (times.length === 0) times.push(0);
  const last = Math.round(end * 100) / 100;
  if (Math.abs(times[times.length - 1] - last) > 0.15) {
    times.push(last);
  }
  return times;
}

export type ExtractedVideoFrame = {
  timeSec: number;
  success: boolean;
  imageUrl?: string;
  error?: string;
  width?: number;
  height?: number;
};

/** 同一 video 元素顺序 seek，批量截取多帧 */
export async function extractVideoFramesAtTimes(
  videoUrl: string,
  timeSecs: number[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ durationSec?: number; frames: ExtractedVideoFrame[] }> {
  if (!timeSecs.length) return { frames: [] };

  return new Promise((resolve) => {
    const video = document.createElement('video');
    configureVideoElementCrossOriginForCapture(video, videoUrl);
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = videoUrl;

    let settled = false;
    const frames: ExtractedVideoFrame[] = [];
    let idx = 0;
    let durationSec: number | undefined;

    const cleanup = () => {
      try {
        video.src = '';
        video.load();
      } catch {
        /* ignore */
      }
    };

    const finishAll = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ durationSec, frames });
    };

    const failAll = (error: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        durationSec,
        frames: timeSecs.map((timeSec) => ({ timeSec, success: false, error })),
      });
    };

    const seekNext = () => {
      if (idx >= timeSecs.length) {
        finishAll();
        return;
      }
      const t = clampCaptureTimeSec(video, timeSecs[idx]!);
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        const cap = captureFrameFromVideo(video);
        if (!cap.ok) {
          frames.push({ timeSec: timeSecs[idx]!, success: false, error: cap.error });
        } else {
          frames.push({
            timeSec: timeSecs[idx]!,
            success: true,
            imageUrl: cap.imageUrl,
            width: video.videoWidth,
            height: video.videoHeight,
          });
        }
        idx += 1;
        onProgress?.(idx, timeSecs.length);
        seekNext();
      };
      video.addEventListener('seeked', onSeeked);
      try {
        video.currentTime = t;
      } catch {
        video.removeEventListener('seeked', onSeeked);
        failAll('设置播放时间失败');
      }
    };

    video.addEventListener('loadedmetadata', () => {
      durationSec = Number.isFinite(video.duration) ? video.duration : undefined;
      seekNext();
    });

    video.addEventListener('error', () => failAll('视频加载失败'));

    setTimeout(() => {
      if (!settled && video.readyState < 2) {
        failAll('视频加载超时');
      }
    }, 20000);

    video.load();
  });
}

/** 读取视频时长（秒） */
export function probeVideoDuration(videoUrl: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    try {
      const video = document.createElement('video');
      configureVideoElementCrossOriginForCapture(video, videoUrl);
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.src = videoUrl;

      let settled = false;
      const done = (dur?: number) => {
        if (settled) return;
        settled = true;
        try {
          video.src = '';
          video.load();
        } catch {
          /* ignore */
        }
        resolve(dur);
      };

      video.addEventListener('loadedmetadata', () => {
        done(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined);
      });
      video.addEventListener('error', () => done(undefined));
      setTimeout(() => {
        if (!settled) done(undefined);
      }, 15000);
      video.load();
    } catch {
      resolve(undefined);
    }
  });
}

export function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const comma = dataUrl.indexOf(',');
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
