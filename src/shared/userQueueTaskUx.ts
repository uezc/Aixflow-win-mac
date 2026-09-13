/**
 * 用户侧视频 Queue 状态文案（与后端 status / ahead_count 对齐）
 * 不暴露 queued/claimed/lease 等内部术语。
 */

export type UserQueueUxPhase = 'preparing' | 'queued' | 'generating' | 'success' | 'failed';

export type UserQueueUxInput = {
  status?: string | null;
  execution_stage?: string | null;
  ahead_count?: number | null;
  queue_position?: number | null;
  queue_position_available?: boolean | null;
  queue_position_complete?: boolean | null;
  error_msg?: string | null;
  error_code?: string | null;
  refunded?: boolean | null;
};

export type UserQueueUxView = {
  phase: UserQueueUxPhase;
  /** 主文案（节点进度条） */
  progressMessage: string;
  /** 失败时的原因行（可选） */
  failureDetail?: string;
};

function normStatus(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase();
}

function aheadLabel(ahead: number, complete: boolean): string {
  // 仅在扫描完整且确认 ahead=0 时说「即将生成」；不完整时绝不假装下一位
  if (ahead <= 0) {
    return complete ? '即将生成' : '排队中';
  }
  if (!complete) return `排队中 · 前面还有约 ${ahead} 个任务`;
  return `排队中 · 前面还有 ${ahead} 个任务`;
}

/**
 * 将云端任务状态映射为用户可读文案。
 * ahead_count 仅在 queued 且 available 时使用；查询失败时仍显示「排队中」。
 */
export function mapCloudTaskToUserQueueUx(input: UserQueueUxInput): UserQueueUxView {
  const st = normStatus(input.status);
  const stage = normStatus(input.execution_stage);

  if (!st) {
    return { phase: 'preparing', progressMessage: '准备排队…' };
  }

  if (st === 'success') {
    return { phase: 'success', progressMessage: '生成完成' };
  }

  if (st === 'failed' || st === 'cancelled' || st === 'timeout' || st === 'error') {
    const refunded = input.refunded === true;
    const err = String(input.error_msg || input.error_code || '').trim();
    return {
      phase: 'failed',
      progressMessage: refunded ? '生成失败 · 已退款' : '生成失败',
      ...(err ? { failureDetail: `失败原因：${err}` } : {}),
    };
  }

  if (st === 'queued' || st === 'pending') {
    if (st === 'pending') {
      return { phase: 'preparing', progressMessage: '准备排队…' };
    }
    const available = input.queue_position_available === true;
    const aheadRaw = input.ahead_count;
    const ahead =
      available && aheadRaw != null && Number.isFinite(Number(aheadRaw))
        ? Math.max(0, Math.floor(Number(aheadRaw)))
        : null;
    if (ahead == null) {
      return { phase: 'queued', progressMessage: '排队中' };
    }
    const complete = input.queue_position_complete !== false;
    return { phase: 'queued', progressMessage: aheadLabel(ahead, complete) };
  }

  // claimed 已占槽：不再显示 ahead；用户层归入「生成中」管线
  if (
    st === 'claimed' ||
    st === 'running' ||
    st === 'processing' ||
    stage === 'charged' ||
    stage === 'dispatching' ||
    stage === 'provider_submitted' ||
    stage === 'settling' ||
    stage === 'awaiting_charge'
  ) {
    return { phase: 'generating', progressMessage: '生成中' };
  }

  return { phase: 'generating', progressMessage: '生成中' };
}

/** Queue 路径：无真实 Provider 百分比时使用的固定进度（仅驱动遮罩显示，不表示 %） */
export const USER_QUEUE_UX_INDETERMINATE_PROGRESS = 8;
