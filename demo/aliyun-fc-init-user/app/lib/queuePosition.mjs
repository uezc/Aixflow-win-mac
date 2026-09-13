/**
 * 用户侧 Queue Position（只读）
 *
 * 与 promoteQueuedTasks 使用同一 FIFO 键：
 *   (queue_entered_at ASC, task_id ASC)
 * 仅 status===queued 计入 ahead；claimed/running 已占并发槽，不算排队。
 *
 * 不修改 Claim / Charge / Lease / Timer。
 */

import { normalizeQueueTaskType } from './queueScheduler.mjs';

/** @type {Map<string, { at: number, tasks: object[], scanned: number, truncated: boolean }>} */
const snapshotCache = new Map();

export function getQueuePositionCacheTtlMs(env = process.env) {
  const n = parseInt(String(env.NX_QUEUE_POSITION_CACHE_MS ?? ''), 10);
  return Number.isFinite(n) && n >= 1000 ? Math.min(60_000, n) : 8_000;
}

export function getQueuePositionMaxTasks(env = process.env) {
  const n = parseInt(String(env.NX_QUEUE_POSITION_MAX_TASKS ?? ''), 10);
  // 默认提高候选上限，降低「扫不到自己」概率（只读；有 8s 缓存）
  return Number.isFinite(n) && n >= 50 ? Math.min(5000, n) : 2000;
}

export function getQueuePositionMaxScanRows(env = process.env) {
  const n = parseInt(String(env.NX_QUEUE_POSITION_MAX_SCAN ?? ''), 10);
  return Number.isFinite(n) && n >= 1000 ? Math.min(200_000, n) : 10_000;
}

export function queueFifoEnteredAt(task) {
  const entered = Number(task?.queueEnteredAt ?? task?.queue_entered_at ?? 0);
  if (Number.isFinite(entered) && entered > 0) return entered;
  const created = Number(task?.createdAt ?? task?.created_at ?? 0);
  return Number.isFinite(created) && created > 0 ? created : 0;
}

export function queueFifoTaskId(task) {
  return String(task?.taskId ?? task?.task_id ?? '').trim();
}

/** 与 promoteQueuedTasks 相同的比较器 */
export function compareQueueFifo(a, b) {
  const ta = queueFifoEnteredAt(a);
  const tb = queueFifoEnteredAt(b);
  if (ta !== tb) return ta - tb;
  return queueFifoTaskId(a).localeCompare(queueFifoTaskId(b));
}

/**
 * 在候选 queued 列表中计算 ahead / position（纯函数，便于单测）。
 *
 * @param {object[]} queuedTasks  仅 queued 候选（可含多 type）
 * @param {{ taskId: string, taskType: string, queueEnteredAt?: number, queue_entered_at?: number, created_at?: number }} target
 * @param {{ truncated?: boolean }} [meta]
 */
export function computeQueuePositionFromCandidates(queuedTasks, target, meta = {}) {
  const taskId = queueFifoTaskId(target);
  const taskType = normalizeQueueTaskType(target.taskType ?? target.task_type);
  if (!taskId || !taskType) {
    return {
      queue_position: null,
      ahead_count: null,
      queue_position_available: false,
      queue_position_complete: false,
      reason: 'INVALID_TARGET',
    };
  }

  const sameType = (queuedTasks || []).filter((t) => {
    const tt = normalizeQueueTaskType(t.taskType ?? t.task_type);
    return tt === taskType && queueFifoTaskId(t);
  });

  const targetKey = {
    taskId,
    task_id: taskId,
    queueEnteredAt: queueFifoEnteredAt(target),
    queue_entered_at: queueFifoEnteredAt(target),
  };

  let ahead = 0;
  let foundSelf = false;
  for (const t of sameType) {
    const id = queueFifoTaskId(t);
    if (id === taskId) {
      foundSelf = true;
      continue;
    }
    if (compareQueueFifo(t, targetKey) < 0) ahead += 1;
  }

  const truncated = meta.truncated === true;
  // 自身未进入有界扫描结果：数字不可信（常见于队列积压、PK 扫描未扫到本任务）
  if (!foundSelf) {
    return {
      queue_position: null,
      ahead_count: null,
      queue_position_available: false,
      queue_position_complete: false,
      queue_position_found_self: false,
      queue_position_scope: taskType,
      reason: truncated ? 'target_not_in_bounded_scan' : 'target_not_in_scan',
    };
  }

  const complete = !truncated;

  return {
    queue_position: ahead + 1,
    ahead_count: ahead,
    queue_position_available: true,
    queue_position_complete: complete,
    queue_position_found_self: true,
    queue_position_scope: taskType,
    reason: complete ? 'ok' : 'bounded_scan',
  };
}

/**
 * @param {object} db 需有 listQueuedTasksForPromote
 * @param {'video'|'image'} taskType
 */
export async function loadQueuedSnapshot(db, taskType, opts = {}) {
  const tt = normalizeQueueTaskType(taskType);
  if (!tt) throw new Error('INVALID_TASK_TYPE');
  if (typeof db.listQueuedTasksForPromote !== 'function') {
    throw new Error('LIST_QUEUED_UNAVAILABLE');
  }

  const ttl = opts.cacheTtlMs ?? getQueuePositionCacheTtlMs();
  const now = Date.now();
  const cached = snapshotCache.get(tt);
  if (cached && now - cached.at < ttl) {
    return { ...cached, from_cache: true };
  }

  const maxTasks = opts.maxTasks ?? getQueuePositionMaxTasks();
  const maxScanRows = opts.maxScanRows ?? getQueuePositionMaxScanRows();
  const listed = await db.listQueuedTasksForPromote({
    maxTasks,
    maxScanRows,
    taskType: tt,
  });
  const tasks = listed?.tasks || [];
  const scanned = Number(listed?.scanned || 0);
  const truncated = tasks.length >= maxTasks || scanned >= maxScanRows;
  const snap = { at: now, tasks, scanned, truncated, from_cache: false };
  snapshotCache.set(tt, snap);
  return snap;
}

/** 测试用：清空快照缓存 */
export function clearQueuePositionSnapshotCache() {
  snapshotCache.clear();
}

/**
 * 为 /tasks/status 附加只读 UX 字段。失败时返回空字段，绝不抛给上层。
 * @param {object} db
 * @param {object} row getTaskRowForUser 结果
 */
export async function enrichTaskStatusForUserUx(db, row) {
  const base = {
    queue_position: null,
    ahead_count: null,
    queue_position_available: false,
    queue_position_complete: false,
    refunded: false,
  };
  if (!row || typeof row !== 'object') return base;

  const statusRaw = String(row.status_raw || row.status || '')
    .trim()
    .toLowerCase();

  // 失败退款：只读 nx_task_charges.refunded_at（不触发 refund）
  if (statusRaw === 'failed' && typeof db.getTaskCharge === 'function') {
    try {
      const charge = await db.getTaskCharge(String(row.task_id || ''));
      const refundedAt = Number(charge?.refunded_at || 0);
      const st = String(charge?.status || '').toLowerCase();
      if (refundedAt > 0 || st === 'refunded') {
        base.refunded = true;
      }
    } catch (_) {
      /* ignore */
    }
  }

  if (statusRaw !== 'queued') {
    return base;
  }

  const taskType = normalizeQueueTaskType(row.task_type);
  if (!taskType) {
    return { ...base, reason: 'TASK_TYPE_NOT_POOLED' };
  }

  try {
    // 位置查询用更大候选集（只读；与 Claim 排序键一致）。截断时若找不到自身则不返回假数字。
    const snap = await loadQueuedSnapshot(db, taskType, {
      maxTasks: Math.max(getQueuePositionMaxTasks(), 2000),
      maxScanRows: Math.max(getQueuePositionMaxScanRows(), 10_000),
    });
    const pos = computeQueuePositionFromCandidates(
      snap.tasks,
      {
        taskId: row.task_id,
        taskType,
        queueEnteredAt: row.queue_entered_at,
        created_at: row.created_at,
      },
      { truncated: snap.truncated },
    );
    return {
      queue_position: pos.queue_position,
      ahead_count: pos.ahead_count,
      queue_position_available: pos.queue_position_available,
      queue_position_complete: pos.queue_position_complete,
      queue_position_scope: pos.queue_position_scope,
      queue_position_reason: pos.reason,
      refunded: false,
    };
  } catch (e) {
    console.warn('[queuePosition] enrich skipped:', e?.message || e);
    return {
      ...base,
      queue_position_error: true,
    };
  }
}
