/**
 * 异步任务：提交时已按 taskId 扣费，生成失败时退回元宝（FC billing=refund，幂等）。
 */
import { callFCGenericTask } from '../ai-provider.js';
import { notifyCloudBalance } from '../cloudBalanceNotifier.js';
import { getAliyunFcInitUserUrl } from '../config/aliyunConfig.js';

export async function tryRefundFcForwardCharge(
  taskId: string | undefined,
  taskType: 'image' | 'video' | 'audio',
  reason = 'async_task_failed',
): Promise<void> {
  const tid = String(taskId ?? '').trim();
  if (!tid) return;
  if (!getAliyunFcInitUserUrl().trim()) return;
  try {
    const { balance } = await callFCGenericTask({
      type: taskType,
      taskId: tid,
      billing: 'refund',
      refundReason: reason,
    });
    const bal = typeof balance === 'number' ? balance : Number(balance);
    if (Number.isFinite(bal)) notifyCloudBalance(bal);
  } catch (e) {
    console.warn(`[fcRefund] ${taskType} taskId=${tid}`, e);
  }
}
