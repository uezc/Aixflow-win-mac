import {
  NEXFLOW_MAX_LLM_SKILL_OPTIMIZE_CONCURRENCY,
  NEXFLOW_MAX_TASK_CONCURRENCY,
} from '../../shared/nexflowTaskConcurrency';

/**
 * 导演台并发 LLM 客户端限流：同时最多跑 N 路，其余排队；完成自动泵下一个。
 */

export const DIRECTOR_CONCURRENT_CHAT_MAX = NEXFLOW_MAX_TASK_CONCURRENCY;

export const DIRECTOR_SKILL_OPTIMIZE_CHAT_MAX = NEXFLOW_MAX_LLM_SKILL_OPTIMIZE_CONCURRENCY;

export type DirectorConcurrentChatQueueStatus = {
  phase: 'waiting' | 'running';
  /** 在「等待+运行」全体中的 1-based 位次（等待中靠前） */
  position: number;
  total: number;
  waiting: number;
  running: number;
};

type QueueEntry<T> = {
  id: string;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: Error) => void;
  onStatus?: (status: DirectorConcurrentChatQueueStatus) => void;
  cancelled: boolean;
  phase: 'waiting' | 'running';
};

function createDirectorConcurrentChatQueue(maxConcurrent: number) {
  const waiting: QueueEntry<unknown>[] = [];
  const running = new Set<QueueEntry<unknown>>();

  function abortError(): Error {
    const err = new Error('cancelled');
    err.name = 'AbortError';
    return err;
  }

  function notifyAll(): void {
    const total = waiting.length + running.size;
    waiting.forEach((e, i) => {
      e.onStatus?.({
        phase: 'waiting',
        position: i + 1,
        total,
        waiting: waiting.length,
        running: running.size,
      });
    });
    let runIdx = 0;
    for (const e of running) {
      runIdx += 1;
      e.onStatus?.({
        phase: 'running',
        position: waiting.length + runIdx,
        total,
        waiting: waiting.length,
        running: running.size,
      });
    }
  }

  function pump(): void {
    while (running.size < maxConcurrent && waiting.length > 0) {
      const entry = waiting.shift()!;
      if (entry.cancelled) continue;
      entry.phase = 'running';
      running.add(entry);
      notifyAll();
      void Promise.resolve()
        .then(() => entry.run())
        .then((value) => {
          running.delete(entry);
          if (!entry.cancelled) entry.resolve(value);
          notifyAll();
          pump();
        })
        .catch((err: unknown) => {
          running.delete(entry);
          if (!entry.cancelled) {
            entry.reject(err instanceof Error ? err : new Error(String(err || 'failed')));
          }
          notifyAll();
          pump();
        });
    }
    notifyAll();
  }

  return function enqueueDirectorConcurrentChat<T>(opts: {
    run: () => Promise<T>;
    onStatus?: (status: DirectorConcurrentChatQueueStatus) => void;
    signal?: AbortSignal | null;
  }): { promise: Promise<T>; cancel: () => void } {
    const id = `conc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let resolve!: (value: T) => void;
    let reject!: (err: Error) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const entry: QueueEntry<T> = {
      id,
      run: opts.run,
      resolve,
      reject,
      onStatus: opts.onStatus,
      cancelled: false,
      phase: 'waiting',
    };

    const cancel = () => {
      if (entry.cancelled) return;
      entry.cancelled = true;
      const wi = waiting.indexOf(entry as QueueEntry<unknown>);
      if (wi >= 0) {
        waiting.splice(wi, 1);
        try {
          entry.reject(abortError());
        } catch {
          /* ignore */
        }
        notifyAll();
        return;
      }
      if (running.has(entry as QueueEntry<unknown>)) {
        try {
          entry.reject(abortError());
        } catch {
          /* ignore */
        }
      }
    };

    if (opts.signal?.aborted) {
      queueMicrotask(() => {
        try {
          reject(abortError());
        } catch {
          /* ignore */
        }
      });
      return { promise, cancel };
    }
    opts.signal?.addEventListener('abort', cancel, { once: true });

    waiting.push(entry as QueueEntry<unknown>);
    notifyAll();
    pump();
    return { promise, cancel };
  };
}

/** 通用并发 LLM（上限 5） */
export const enqueueDirectorConcurrentChat = createDirectorConcurrentChatQueue(
  DIRECTOR_CONCURRENT_CHAT_MAX,
);

/** 提示词 Skill 优化专用队列（上限 2，防多镜同时打满 FC） */
export const enqueueDirectorSkillOptimizeChat = createDirectorConcurrentChatQueue(
  DIRECTOR_SKILL_OPTIMIZE_CHAT_MAX,
);
