/**
 * Phase 5：队列 Scheduler（queued → claimed）
 *
 * 固定顺序：
 *   ① User CAS +1（按 video|image|audio）
 *   → ② Platform CAS +1（按 resource_pool）
 *   → ③ queued → claimed 原子更新
 * 任一步失败：逆序幂等回滚已取得的 reservation。
 *
 * Phase 5 严禁：扣费、RunningHub、写入 running。
 *
 * 补位：释放 1 个平台槽后，最多 tryClaim 1 个同池 waiting（必须再走 acquire，禁止绕过）。
 */

import crypto from 'crypto';
import {
  TASK_STATUS,
  normalizeTaskStatus,
  occupiesConcurrencySlot,
} from './taskStatusMachine.mjs';
import {
  normalizePlatformPoolKind,
  normalizeUserConcurrencyKind,
  userTaskTypeFromResourcePool,
} from './platformConcurrencyConfig.mjs';
import { resolveResourcePoolFromTaskRow } from './resourcePool.mjs';

export function getClaimLeaseMs(env = process.env) {
  const n = parseInt(String(env.NX_CLAIM_LEASE_MS ?? ''), 10);
  return Number.isFinite(n) && n >= 5000 ? n : 60_000;
}

export function getReservationOrphanMs(env = process.env) {
  const n = parseInt(String(env.NX_RESERVATION_ORPHAN_MS ?? ''), 10);
  // 默认略大于 claim lease，覆盖 crash 窗口
  return Number.isFinite(n) && n >= 10_000 ? n : 120_000;
}

export function getPromoteBatchSize(env = process.env) {
  const n = parseInt(String(env.NX_PROMOTE_BATCH_SIZE ?? ''), 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(200, n) : 20;
}

/**
 * 规范化 video|image|audio（用户并发池）。
 * @param {unknown} taskType
 * @returns {'video'|'image'|'audio'|null}
 */
export function normalizeQueueTaskType(taskType) {
  return normalizeUserConcurrencyKind(taskType);
}

/**
 * @param {{
 *   taskType?: string,
 *   task_type?: string,
 *   resourcePool?: string,
 *   resource_pool?: string,
 * }} task
 * @returns {string|null}
 */
export function resolveTaskResourcePool(task) {
  return resolveResourcePoolFromTaskRow(task);
}

/**
 * 对单条 queued 任务尝试 claim（含 reservation 追踪）。
 *
 * @param {{
 *   taskId: string,
 *   userId: string,
 *   taskType: string,
 *   resourcePool?: string,
 *   queueEnteredAt?: number,
 * }} task
 * @param {{
 *   resolveUserLimit: (userId: string, taskType: 'video'|'image'|'audio') => Promise<number>,
 *   createReservation: (row: object) => Promise<object>,
 *   markReservationHeld: (reservationId: string, which: 'user'|'platform') => Promise<void>,
 *   markReservationState: (reservationId: string, state: string, extra?: object) => Promise<void>,
 *   tryAcquireUser: (userId: string, taskType: string, limit: number) => Promise<{ok:boolean, reason?:string}>,
 *   releaseUser: (userId: string, taskType: string) => Promise<{ok:boolean}>,
 *   tryAcquirePlatform: (resourcePool: string) => Promise<{ok:boolean, reason?:string}>,
 *   releasePlatform: (resourcePool: string) => Promise<{ok:boolean}>,
 *   atomicClaimQueuedTask: (args: object) => Promise<{ok:boolean, reason?:string}>,
 *   nowMs?: number,
 *   leaseMs?: number,
 *   orphanMs?: number,
 *   leaseOwner?: string,
 * }} deps
 */
export async function tryClaimOneQueuedTask(task, deps) {
  const taskType = normalizeQueueTaskType(task.taskType ?? task.task_type);
  if (!taskType) {
    return { ok: false, reason: 'TASK_TYPE_NOT_POOLED', task_id: task.taskId };
  }

  const resourcePool =
    normalizePlatformPoolKind(task.resourcePool ?? task.resource_pool) ||
    resolveTaskResourcePool({
      task_type: taskType,
      resource_pool: task.resourcePool ?? task.resource_pool,
      model_id: task.modelId ?? task.model_id,
      path: task.path,
      rhRegion: task.rhRegion,
    });
  if (!resourcePool) {
    return { ok: false, reason: 'RESOURCE_POOL_UNRESOLVED', task_id: task.taskId };
  }
  // 池与任务类型必须一致（防止海外视频误占图片池）
  const expectedType = userTaskTypeFromResourcePool(resourcePool);
  if (expectedType && expectedType !== taskType) {
    return { ok: false, reason: 'RESOURCE_POOL_TYPE_MISMATCH', task_id: task.taskId };
  }

  const nowMs = deps.nowMs ?? Date.now();
  const leaseMs = deps.leaseMs ?? getClaimLeaseMs();
  const orphanMs = deps.orphanMs ?? getReservationOrphanMs();
  const leaseOwner = deps.leaseOwner || `scheduler:${crypto.randomUUID().slice(0, 8)}`;
  const claimToken = crypto.randomUUID();
  const reservationId = crypto.randomUUID();

  const limit = await deps.resolveUserLimit(task.userId, taskType);
  if (!(limit >= 1)) {
    return { ok: false, reason: 'INVALID_USER_LIMIT', task_id: task.taskId };
  }

  await deps.createReservation({
    reservation_id: reservationId,
    task_id: task.taskId,
    user_id: task.userId,
    task_type: taskType,
    resource_pool: resourcePool,
    user_slot_held: 0,
    platform_slot_held: 0,
    state: 'pending',
    created_at: nowMs,
    expires_at: nowMs + orphanMs,
    claim_token: claimToken,
  });

  let userHeld = false;
  let platformHeld = false;

  const rollback = async (reason) => {
    if (platformHeld) {
      try {
        await deps.releasePlatform(resourcePool);
      } catch (e) {
        console.error('[queueScheduler] rollback platform failed', e?.message || e);
      }
      platformHeld = false;
    }
    if (userHeld) {
      try {
        await deps.releaseUser(task.userId, taskType);
      } catch (e) {
        console.error('[queueScheduler] rollback user failed', e?.message || e);
      }
      userHeld = false;
    }
    try {
      await deps.markReservationState(reservationId, 'rolled_back', {
        user_slot_held: 0,
        platform_slot_held: 0,
        rollback_reason: reason,
      });
    } catch (_) {}
    return {
      ok: false,
      reason,
      task_id: task.taskId,
      reservation_id: reservationId,
      resource_pool: resourcePool,
    };
  };

  // ① User CAS
  const uAcq = await deps.tryAcquireUser(task.userId, taskType, limit);
  if (!uAcq?.ok) {
    return rollback(uAcq?.reason || 'USER_CONCURRENCY_FULL');
  }
  userHeld = true;
  await deps.markReservationHeld(reservationId, 'user');

  // ② Platform CAS（resource_pool）
  const pAcq = await deps.tryAcquirePlatform(resourcePool);
  if (!pAcq?.ok) {
    return rollback(pAcq?.reason || 'PLATFORM_POOL_FULL');
  }
  platformHeld = true;
  await deps.markReservationHeld(reservationId, 'platform');

  // ③ queued → claimed
  const claim = await deps.atomicClaimQueuedTask({
    taskId: task.taskId,
    userId: task.userId,
    taskType,
    resourcePool,
    reservationId,
    claimToken,
    leaseOwner,
    leaseExpiresAt: nowMs + leaseMs,
    claimedAt: nowMs,
  });

  if (!claim?.ok) {
    return rollback(claim?.reason || 'CLAIM_RACE');
  }

  await deps.markReservationState(reservationId, 'claimed', {
    user_slot_held: 1,
    platform_slot_held: 1,
  });

  return {
    ok: true,
    task_id: task.taskId,
    user_id: task.userId,
    task_type: taskType,
    resource_pool: resourcePool,
    reservation_id: reservationId,
    claim_token: claimToken,
    lease_expires_at: nowMs + leaseMs,
  };
}

/**
 * 批量 promote：FIFO（queue_entered_at）+ 每波每用户至多 1 次成功 claim（简易公平）。
 * 可选 resourcePool：只 promote 该池 waiting。
 *
 * @param {object[]} queuedTasks
 * @param {object} deps 同 tryClaimOneQueuedTask
 * @param {{ maxClaims?: number, maxAttempts?: number, resourcePool?: string|null }} [opts]
 */
export async function promoteQueuedTasks(queuedTasks, deps, opts = {}) {
  const maxClaims = Math.max(0, opts.maxClaims ?? getPromoteBatchSize());
  if (maxClaims <= 0) {
    return { attempts: 0, claimed: 0, results: [] };
  }
  const maxAttempts = Math.max(maxClaims, opts.maxAttempts ?? maxClaims * 5);
  const poolFilter = opts.resourcePool
    ? normalizePlatformPoolKind(opts.resourcePool)
    : null;

  const sorted = [...(queuedTasks || [])].sort((a, b) => {
    const ta = Number(a.queueEnteredAt || a.queue_entered_at || 0);
    const tb = Number(b.queueEnteredAt || b.queue_entered_at || 0);
    if (ta !== tb) return ta - tb;
    return String(a.taskId || a.task_id).localeCompare(String(b.taskId || b.task_id));
  });

  const claimedThisWave = new Set();
  const results = [];
  let claims = 0;
  let attempts = 0;

  for (const raw of sorted) {
    if (claims >= maxClaims || attempts >= maxAttempts) break;
    const task = {
      taskId: String(raw.taskId || raw.task_id || ''),
      userId: String(raw.userId || raw.user_id || ''),
      taskType: String(raw.taskType || raw.task_type || ''),
      resourcePool: String(raw.resourcePool || raw.resource_pool || ''),
      modelId: String(raw.modelId || raw.model_id || ''),
      queueEnteredAt: Number(raw.queueEnteredAt || raw.queue_entered_at || 0),
    };
    if (!task.taskId || !task.userId) continue;
    if (!normalizeQueueTaskType(task.taskType)) continue;
    const rp = resolveTaskResourcePool(task);
    if (poolFilter && rp !== poolFilter) continue;
    if (claimedThisWave.has(task.userId)) continue;

    attempts += 1;
    const r = await tryClaimOneQueuedTask(
      { ...task, resourcePool: rp || task.resourcePool },
      deps,
    );
    results.push(r);
    if (r.ok) {
      claims += 1;
      claimedThisWave.add(task.userId);
    }
    // 同池已满：后续同池几乎必然失败，可提前停（跨用户仍可能因用户额度失败）
    if (!r.ok && r.reason === 'PLATFORM_POOL_FULL' && poolFilter) {
      break;
    }
  }

  return {
    attempts,
    claimed: claims,
    results,
    resource_pool: poolFilter || null,
  };
}

/**
 * 释槽后同池补位：最多 claim `maxRefill` 个（默认 1）。
 * 每个补位都必须走 tryClaimOneQueuedTask → platform acquire，禁止绕过。
 *
 * @param {string} resourcePool
 * @param {object} deps
 * @param {{
 *   listQueuedForPool: (pool: string, opts?: object) => Promise<{tasks: object[]}>,
 *   maxRefill?: number,
 *   maxAttempts?: number,
 * }} listDeps
 */
export async function tryRefillAfterSlotRelease(resourcePool, deps, listDeps) {
  const pool = normalizePlatformPoolKind(resourcePool);
  if (!pool) {
    return { ok: false, reason: 'INVALID_POOL', claimed: 0, results: [] };
  }
  const maxRefill = Math.max(0, Math.min(20, Number(listDeps?.maxRefill ?? 1) || 0));
  if (maxRefill <= 0) {
    return { ok: true, skipped: true, claimed: 0, resource_pool: pool, results: [] };
  }
  if (typeof listDeps?.listQueuedForPool !== 'function') {
    return { ok: false, reason: 'LIST_FN_REQUIRED', claimed: 0, resource_pool: pool, results: [] };
  }

  const listed = await listDeps.listQueuedForPool(pool, {
    maxTasks: Math.max(maxRefill * 5, 10),
  });
  const promote = await promoteQueuedTasks(listed?.tasks || [], deps, {
    maxClaims: maxRefill,
    maxAttempts: listDeps.maxAttempts ?? maxRefill * 8,
    resourcePool: pool,
  });

  return {
    ok: true,
    resource_pool: pool,
    claimed: promote.claimed,
    attempts: promote.attempts,
    results: promote.results,
    max_refill: maxRefill,
  };
}

/**
 * lease 到期：先原子 claimed→queued，成功后再 release platform → user。
 *
 * @param {object} expiredClaim  { taskId, userId, taskType, resourcePool?, claimToken?, reservationId? }
 * @param {object} deps
 */
export async function recoverOneExpiredClaim(expiredClaim, deps) {
  const taskId = String(expiredClaim.taskId || expiredClaim.task_id || '');
  const userId = String(expiredClaim.userId || expiredClaim.user_id || '');
  const taskType = normalizeQueueTaskType(expiredClaim.taskType || expiredClaim.task_type);
  const resourcePool =
    normalizePlatformPoolKind(expiredClaim.resourcePool || expiredClaim.resource_pool) ||
    resolveTaskResourcePool(expiredClaim) ||
    (taskType === 'video'
      ? 'cn_video'
      : taskType === 'image'
        ? 'cn_image'
        : taskType === 'audio'
          ? 'audio'
          : null);
  const claimToken = expiredClaim.claimToken || expiredClaim.claim_token || '';
  const reservationId = expiredClaim.reservationId || expiredClaim.reservation_id || '';

  if (!taskId || !userId || !taskType || !resourcePool) {
    return { ok: false, reason: 'INVALID_EXPIRED_CLAIM' };
  }

  const unclaim = await deps.atomicUnclaimExpiredTask({
    taskId,
    userId,
    claimToken,
    nowMs: deps.nowMs ?? Date.now(),
  });

  if (!unclaim?.ok) {
    return { ok: false, reason: unclaim?.reason || 'UNCLAIM_RACE', task_id: taskId };
  }

  // 仅当任务侧确认曾持有槽位时释放（幂等）
  const platformHeld = unclaim.platform_slot_held !== false && unclaim.platform_slot_held !== 0;
  const userHeld = unclaim.user_slot_held !== false && unclaim.user_slot_held !== 0;

  let releasedPlatform = false;
  if (platformHeld) {
    const rel = await deps.releasePlatform(resourcePool);
    releasedPlatform = Boolean(rel?.ok) && !rel?.already_empty;
  }
  if (userHeld) {
    await deps.releaseUser(userId, taskType);
  }

  if (reservationId && typeof deps.markReservationState === 'function') {
    try {
      await deps.markReservationState(reservationId, 'released', {
        user_slot_held: 0,
        platform_slot_held: 0,
      });
    } catch (_) {}
  }

  return {
    ok: true,
    task_id: taskId,
    resource_pool: resourcePool,
    released_platform: releasedPlatform || Boolean(platformHeld),
    released_user: Boolean(userHeld),
    platform_slot_freed: releasedPlatform,
  };
}

/**
 * Orphan reservation：pending 且过期，且仍标记持有槽位，但任务未以同 reservation 处于 claimed/running。
 * 幂等：只释放本 reservation 记录的 held；重复执行 state 已非 pending 则跳过。
 *
 * @param {object} reservation
 * @param {object} deps
 */
export async function reconcileOneOrphanReservation(reservation, deps) {
  const nowMs = deps.nowMs ?? Date.now();
  const rid = String(reservation.reservation_id || reservation.reservationId || '');
  const state = String(reservation.state || '').toLowerCase();
  const expiresAt = Number(reservation.expires_at || reservation.expiresAt || 0);
  const userHeld = Number(reservation.user_slot_held || reservation.userSlotHeld || 0) === 1;
  const platformHeld =
    Number(reservation.platform_slot_held || reservation.platformSlotHeld || 0) === 1;

  if (!rid) return { ok: false, reason: 'NO_RESERVATION_ID' };
  if (state !== 'pending') return { ok: true, skipped: true, reason: 'NOT_PENDING' };
  if (!(expiresAt > 0) || expiresAt > nowMs) {
    return { ok: true, skipped: true, reason: 'NOT_EXPIRED' };
  }
  if (!userHeld && !platformHeld) {
    await deps.markReservationState(rid, 'rolled_back', { rollback_reason: 'expired_empty' });
    return { ok: true, cleaned_empty: true, reservation_id: rid };
  }

  const taskId = String(reservation.task_id || reservation.taskId || '');
  const userId = String(reservation.user_id || reservation.userId || '');
  const taskType = normalizeQueueTaskType(reservation.task_type || reservation.taskType);
  const resourcePool =
    normalizePlatformPoolKind(reservation.resource_pool || reservation.resourcePool) ||
    resolveTaskResourcePool(reservation) ||
    (taskType === 'video'
      ? 'cn_video'
      : taskType === 'image'
        ? 'cn_image'
        : taskType === 'audio'
          ? 'audio'
          : null);
  if (!taskType || !userId || !resourcePool) {
    return { ok: false, reason: 'INVALID_RESERVATION_META', reservation_id: rid };
  }

  const task = taskId ? await deps.getTaskById(taskId) : null;
  const taskStatus = normalizeTaskStatus(task?.status);
  const taskResId = String(task?.reservation_id || task?.reservationId || '');

  // 任务已成功绑定本 reservation 且仍占用槽 → 非 orphan，仅修正 reservation state
  if (task && taskResId === rid && occupiesConcurrencySlot(taskStatus)) {
    await deps.markReservationState(rid, 'claimed', {
      user_slot_held: 1,
      platform_slot_held: 1,
    });
    return { ok: true, healed_state: 'claimed', reservation_id: rid };
  }

  // 真正 orphan：计数已占但任务未绑定（仍 queued / 缺失 / 其它 reservation）
  let platformSlotFreed = false;
  if (platformHeld) {
    const rel = await deps.releasePlatform(resourcePool);
    platformSlotFreed = Boolean(rel?.ok) && !rel?.already_empty;
  }
  if (userHeld) {
    await deps.releaseUser(userId, taskType);
  }
  await deps.markReservationState(rid, 'rolled_back', {
    user_slot_held: 0,
    platform_slot_held: 0,
    rollback_reason: 'orphan_reconcile',
  });

  return {
    ok: true,
    orphan_released: true,
    reservation_id: rid,
    task_id: taskId,
    resource_pool: resourcePool,
    released_platform: platformHeld,
    released_user: userHeld,
    platform_slot_freed: platformSlotFreed,
  };
}

/**
 * 计数器相对「完整扫描得到的 actual」的超卖量。
 * 扫描不完整时必须返回 0，禁止误释放。
 *
 * @param {number} counterOccupied
 * @param {number} actualOccupied
 * @param {{ scanComplete?: boolean }} [opts]
 * @returns {number} 需要 release 的次数（永不产生负数修正意图）
 */
export function computeCounterOvershoot(counterOccupied, actualOccupied, opts = {}) {
  if (opts.scanComplete === false) return 0;
  const c = Math.max(0, Math.floor(Number(counterOccupied) || 0));
  const a = Math.max(0, Math.floor(Number(actualOccupied) || 0));
  return c > a ? c - a : 0;
}

// silence unused import in case bundlers drop TASK_STATUS
void TASK_STATUS;
