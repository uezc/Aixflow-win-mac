/**
 * 用户轮询 /tasks/status 时按需推进自己的 queue 任务：
 * queued → claim → charge → dispatch；已有 provider_task_id → poll settle。
 * 失败不抛，保证 status 仍可读。
 */
export async function advanceOwnQueueTaskOnStatus(taskId, userId, db) {
  const tid = String(taskId || '').trim();
  const uid = String(userId || '').trim();
  if (!tid || !uid || !db) return { ok: false, reason: 'BAD_ARGS' };

  let row =
    typeof db.getTaskRowForUser === 'function'
      ? await db.getTaskRowForUser(tid, uid)
      : null;
  if (!row) return { ok: false, reason: 'NOT_FOUND' };

  const st = String(row.status_raw || row.status || '').toLowerCase();
  if (st === 'success' || st === 'failed' || st === 'cancelled') {
    return { ok: true, skipped: true, reason: 'TERMINAL', status: st };
  }

  const pid = String(row.provider_task_id || '').trim();
  const stage = String(row.execution_stage || '').toLowerCase();

  try {
    // 1) 已提交 RH：按需 poll settle（画布才能拿到 result_oss_url）
    if (pid && (st === 'running' || st === 'claimed' || st === 'processing')) {
      const { pollOneProviderTask } = await import('./providerPipeline.mjs');
      await pollOneProviderTask(tid, db);
      return { ok: true, action: 'poll' };
    }

    // 2) 已扣费未派发
    if (st === 'claimed' && (stage === 'charged' || stage === 'dispatching') && !pid) {
      const { dispatchOneChargedTask } = await import('./providerPipeline.mjs');
      await dispatchOneChargedTask(tid, db);
      const again = await db.getTaskRowForUser(tid, uid);
      if (String(again?.provider_task_id || '').trim()) {
        const { pollOneProviderTask } = await import('./providerPipeline.mjs');
        await pollOneProviderTask(tid, db);
      }
      return { ok: true, action: 'dispatch' };
    }

    // 3) claimed 未扣费
    if (st === 'claimed' && !stage && !pid) {
      const { chargeClaimedTask } = await import('./taskCharge.mjs');
      await chargeClaimedTask(tid, db);
      const { dispatchOneChargedTask } = await import('./providerPipeline.mjs');
      await dispatchOneChargedTask(tid, db);
      const again = await db.getTaskRowForUser(tid, uid);
      if (String(again?.provider_task_id || '').trim()) {
        const { pollOneProviderTask } = await import('./providerPipeline.mjs');
        await pollOneProviderTask(tid, db);
      }
      return { ok: true, action: 'charge_dispatch' };
    }

    // 4) 仍在 queued：只 claim 当前任务（不扫全表，避免被压测垃圾饿死）
    if (st === 'queued') {
      const full = typeof db.getTaskById === 'function' ? await db.getTaskById(tid) : null;
      if (!full || String(full.user_id || '').trim() !== uid) {
        return { ok: false, reason: 'OWNER_MISMATCH' };
      }
      const { tryClaimOneQueuedTask } = await import('./queueScheduler.mjs');
      const nowMs = Date.now();
      const deps = {
        nowMs,
        resolveUserLimit: async (userId, taskType) => {
          const u = await db.getUserById(userId);
          const { resolveEffectiveConcurrency } = await import('./userConcurrencyEntitlement.mjs');
          const r = resolveEffectiveConcurrency(u || {}, nowMs);
          return taskType === 'image' ? r.imageConcurrencyLimit : r.videoConcurrencyLimit;
        },
        createReservation: (r) => db.putSlotReservation(r),
        markReservationHeld: async (reservationId, which) => {
          if (which === 'user') await db.updateSlotReservation(reservationId, { user_slot_held: 1 });
          else await db.updateSlotReservation(reservationId, { platform_slot_held: 1 });
        },
        markReservationState: async (reservationId, state, extra = {}) => {
          await db.updateSlotReservation(reservationId, { state, ...extra });
        },
        tryAcquireUser: (userId, taskType, limit) =>
          db.tryAcquireUserConcurrencySlot(userId, taskType, limit),
        releaseUser: (userId, taskType) => db.releaseUserConcurrencySlot(userId, taskType),
        tryAcquirePlatform: (taskType) => db.tryAcquirePlatformConcurrencySlot(taskType),
        releasePlatform: (taskType) => db.releasePlatformConcurrencySlot(taskType),
        atomicClaimQueuedTask: (args) => db.atomicClaimQueuedTask(args),
        getTaskById: (id) => db.getTaskById(id),
      };
      const claim = await tryClaimOneQueuedTask(
        {
          taskId: tid,
          userId: uid,
          taskType: String(full.task_type || row.task_type || 'video').toLowerCase(),
          queueEnteredAt: Number(full.queue_entered_at || 0),
        },
        deps,
      );
      if (!claim?.ok) return { ok: false, reason: claim?.reason || 'CLAIM_FAILED', claim };
      const { chargeClaimedTask } = await import('./taskCharge.mjs');
      await chargeClaimedTask(tid, db);
      const { dispatchOneChargedTask, pollOneProviderTask } = await import('./providerPipeline.mjs');
      await dispatchOneChargedTask(tid, db);
      const again = await db.getTaskRowForUser(tid, uid);
      if (String(again?.provider_task_id || '').trim()) {
        await pollOneProviderTask(tid, db);
      }
      return { ok: true, action: 'claim_charge_dispatch' };
    }
  } catch (e) {
    console.warn('[advanceOwnQueueTaskOnStatus]', tid, e?.message || e);
    return { ok: false, reason: e?.message || 'ADVANCE_ERROR' };
  }

  return { ok: true, skipped: true, reason: 'NO_ACTION', status: st, stage };
}
