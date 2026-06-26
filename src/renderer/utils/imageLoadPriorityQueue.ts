import { recordAbortEvent } from './abortStats';

type QueueTask = {
  id: number;
  src: string;
  priority: number;
  signal?: AbortSignal;
  isCancelled: boolean;
  resolve: (src: string) => void;
  reject: (error: unknown) => void;
};

export type ImageTaskBucket = 'center' | 'inside' | 'buffer';

/** 大图布节点多时，并行过低会导致排队过长、易与视口变化 abort 叠加；略提高上限减轻「加载失败」误报 */
const DEFAULT_MAX_PARALLEL = 12;
const MAX_PARALLEL_CAP = 20;
let currentMaxParallel = DEFAULT_MAX_PARALLEL;
let running = 0;
let seq = 1;
const queue: QueueTask[] = [];
const loadedCacheMap = new Map<string, true>();
const inflightMap = new Map<string, Promise<string>>();

function sortQueue() {
  queue.sort((a, b) => b.priority - a.priority || a.id - b.id);
}

function pump() {
  while (running < currentMaxParallel && queue.length > 0) {
    const task = queue.shift()!;
    if (task.isCancelled || task.signal?.aborted) {
      task.reject(new DOMException('Image load aborted', 'AbortError'));
      continue;
    }
    running += 1;
    const img = new Image();
    img.decoding = 'async';
    let finished = false;
    let abortCleanup: (() => void) | null = null;
    const finalize = () => {
      if (finished) return false;
      finished = true;
      if (abortCleanup) {
        abortCleanup();
        abortCleanup = null;
      }
      running = Math.max(0, running - 1);
      pump();
      return true;
    };
    const abortLoad = () => {
      task.isCancelled = true;
      img.onload = null;
      img.onerror = null;
      // 清空 src 终止请求，便于在 DevTools 里看到 canceled。
      img.src = '';
      recordAbortEvent(1);
      if (finalize()) {
        task.reject(new DOMException('Image load aborted', 'AbortError'));
      }
    };
    if (task.signal) {
      if (task.signal.aborted) {
        abortLoad();
        continue;
      }
      const onAbort = () => abortLoad();
      task.signal.addEventListener('abort', onAbort, { once: true });
      abortCleanup = () => task.signal?.removeEventListener('abort', onAbort);
    }
    img.onload = async () => {
      try {
        if (task.isCancelled || task.signal?.aborted) {
          throw new DOMException('Image load aborted', 'AbortError');
        }
        if (typeof img.decode === 'function') {
          await img.decode().catch(() => undefined);
        }
        if (task.isCancelled || task.signal?.aborted) {
          throw new DOMException('Image load aborted', 'AbortError');
        }
        task.resolve(task.src);
      } catch (error) {
        task.reject(error);
      } finally {
        finalize();
      }
    };
    img.onerror = (error) => {
      task.reject(error);
      finalize();
    };
    img.src = task.src;
  }
}

export function setImageLoadMaxParallel(next: number): void {
  const normalized = Math.max(1, Math.min(MAX_PARALLEL_CAP, Math.round(next)));
  if (normalized === currentMaxParallel) return;
  currentMaxParallel = normalized;
  pump();
}

export function enqueueImageLoad(
  src: string,
  priority: number,
  options?: { signal?: AbortSignal; dedupe?: boolean }
): Promise<string> {
  if (!src) return Promise.resolve(src);
  if (loadedCacheMap.has(src)) return Promise.resolve(src);
  if (options?.signal?.aborted) {
    return Promise.reject(new DOMException('Image load aborted', 'AbortError'));
  }
  const shouldDedupe = options?.dedupe ?? false;
  const inflight = inflightMap.get(src);
  if (shouldDedupe && inflight) return inflight;
  const taskPromise = new Promise<string>((resolve, reject) => {
    const task: QueueTask = {
      id: seq += 1,
      src,
      priority,
      signal: options?.signal,
      isCancelled: false,
      resolve,
      reject,
    };
    queue.push({
      ...task,
    });
    sortQueue();
    pump();
  });
  if (shouldDedupe) {
    inflightMap.set(src, taskPromise);
  }
  return taskPromise.finally(() => {
    if (shouldDedupe && inflightMap.get(src) === taskPromise) {
      inflightMap.delete(src);
    }
  });
}

export function isImageLoadedInSession(src: string): boolean {
  return !!src && loadedCacheMap.has(src);
}

export function markImageLoadedInSession(src: string): void {
  if (!src) return;
  loadedCacheMap.set(src, true);
}

export function calcViewportPriority(distanceToCenter: number, inViewport: boolean, directionalBias = 0): number {
  const bucketPriority = distanceToCenter <= 500 ? 30_000 : inViewport ? 20_000 : 10_000;
  return bucketPriority - Math.round(Math.min(distanceToCenter, 9_999)) + Math.round(directionalBias);
}

export function getBucketByDistance(distanceToCenter: number, inViewport: boolean): ImageTaskBucket {
  if (distanceToCenter <= 500) return 'center';
  if (inViewport) return 'inside';
  return 'buffer';
}

