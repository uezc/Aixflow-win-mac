/**
 * 短剧 2 代一键生成：按用户图片最大并发数并行跑素材。
 */
import { NEXFLOW_MAX_TASK_CONCURRENCY } from '../../shared/nexflowTaskConcurrency';

/** 读取当前用户图片并发上限；无账号/旧服务端时回落客户端全局上限 */
export async function resolveDramaFlowImageConcurrency(): Promise<number> {
  const fallback = NEXFLOW_MAX_TASK_CONCURRENCY;
  try {
    const state = (await window.electronAPI?.getLafUserState?.()) as
      | {
          concurrency?: { image?: { limit?: number } };
        }
      | null
      | undefined;
    const lim = Number(state?.concurrency?.image?.limit);
    if (Number.isFinite(lim) && lim >= 1) {
      return Math.max(1, Math.min(Math.round(lim), fallback));
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

/** 固定并发池：同时最多 limit 路，完成自动取下一个 */
export async function runDramaFlowBatchPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (!items.length) return;
  const max = Math.max(1, Math.min(Math.round(limit) || 1, items.length));
  let cursor = 0;
  const runOne = async () => {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      const item = items[i];
      if (item === undefined) continue;
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: max }, () => runOne()));
}
