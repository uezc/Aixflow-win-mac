/**
 * Phase 7：Dispatch / Poll / Settle / Recovery 编排
 *
 * - provider_task_id 非空 = Provider 绑定 SoT → 禁止再 POST submit
 * - submit uncertain/timeout → dispatch_unknown=1，禁盲重试、禁盲退
 * - refund 仅 Phase 6 refundTaskCharge / ref_*
 * - release 仅调用现有 CAS release；charged 不释槽
 */

import crypto from 'crypto';
import {
  P7_STAGE,
  P7_DISPATCH_LEASE_MS,
  isProviderTerminalSuccess,
  isProviderTerminalFailed,
  normalizeProviderStatus,
} from './providerStages.mjs';
import { submitRunningHub, queryRunningHub } from './providerRhClient.mjs';
import { resolveRhRegionForQuery } from './runningHubTarget.mjs';
import {
  parseForwardPayload,
  hasValidForwardPath,
  PROVIDER_ERROR_NO_FORWARD,
} from './forwardPayload.mjs';
import {
  resolveProviderPollIntervalMs,
  resolveProviderPollIntervalSec,
} from './queueCostTune.mjs';

export { parseForwardPayload, hasValidForwardPath, PROVIDER_ERROR_NO_FORWARD } from './forwardPayload.mjs';

function logP7(event, fields) {
  console.log(JSON.stringify({ event, timestamp: new Date().toISOString(), ...fields }));
}

function held(v) {
  return v === true || v === 1 || v === '1';
}

/**
 * 抢 dispatch lease；成功后尝试 RH submit（或已有 provider_task_id 则只推进状态）
 */
export async function dispatchOneChargedTask(taskId, db, opts = {}) {
  const tid = String(taskId || '').trim();
  const owner = opts.leaseOwner || `dispatch:${crypto.randomUUID().slice(0, 8)}`;
  const nowMs = opts.nowMs ?? Date.now();
  const leaseMs = opts.leaseMs ?? P7_DISPATCH_LEASE_MS();

  const task = await db.getTaskById(tid);
  if (!task) return { ok: false, reason: 'TASK_NOT_FOUND' };

  // SoT：已有 provider_task_id → 禁止再 submit（任意 status）
  if (String(task.provider_task_id || '').trim()) {
    if (String(task.status).toLowerCase() === 'claimed') {
      await db.markTaskProviderSubmitted(tid, task.user_id, {
        provider_task_id: task.provider_task_id,
        provider_status: task.provider_status || 'QUEUED',
      });
    }
    return { ok: true, idempotent: true, reason: 'ALREADY_HAS_PROVIDER_TASK_ID', provider_task_id: task.provider_task_id };
  }

  if (Number(task.dispatch_unknown) === 1) {
    logP7('PHASE7_DISPATCH_BLOCKED_UNKNOWN', { task_id: tid, user_id: task.user_id });
    return { ok: false, reason: 'DISPATCH_UNKNOWN_NO_RETRY' };
  }

  if (String(task.status).toLowerCase() !== 'claimed') {
    return { ok: false, reason: 'NOT_CLAIMED', status: task.status };
  }
  const stage = String(task.execution_stage || '').toLowerCase();
  if (stage !== P7_STAGE.CHARGED && stage !== P7_STAGE.DISPATCHING) {
    return { ok: false, reason: 'BAD_STAGE', execution_stage: stage };
  }

  const lease = await db.tryAcquireDispatchLease(tid, {
    owner,
    leaseExpiresAt: nowMs + leaseMs,
    nowMs,
  });
  if (!lease?.ok) {
    return { ok: false, reason: lease?.reason || 'LEASE_BUSY' };
  }

  const forward = parseForwardPayload(task);
  if (!forward?.path) {
    return finalizeMissingForwardPayload(db, task, { nowMs });
  }

  logP7('PHASE7_DISPATCH_ATTEMPT', {
    task_id: tid,
    user_id: task.user_id,
    path: forward.path,
    attempt: (task.dispatch_attempt || 0) + 1,
  });

  const submitFn = opts.submitRunningHub || submitRunningHub;
  let submit;
  try {
    submit = await submitFn(forward, {
      userId: task.user_id,
      dbModule: db,
      timeoutMs: opts.submitTimeoutMs,
      fetchImpl: opts.fetchImpl,
    });
  } catch (e) {
    submit = { ok: false, uncertain: true, reason: String(e?.message || e) };
  }

  if (submit.ok && submit.provider_task_id) {
    // 先写 provider_task_id（SoT），再标 running
    const wrote = await db.atomicSetProviderTaskId(tid, submit.provider_task_id);
    if (!wrote?.ok && wrote?.reason === 'ALREADY_SET') {
      // 并发写：以已有为准
      const t2 = await db.getTaskById(tid);
      return { ok: true, idempotent: true, provider_task_id: t2?.provider_task_id };
    }
    await db.markTaskProviderSubmitted(tid, task.user_id, {
      provider_task_id: submit.provider_task_id,
      provider_status: 'QUEUED',
      clear_dispatch_lease: true,
    });
    logP7('PHASE7_DISPATCH_SUCCESS', {
      task_id: tid,
      user_id: task.user_id,
      provider_task_id: submit.provider_task_id,
    });
    return { ok: true, provider_task_id: submit.provider_task_id };
  }

  if (submit.ok && !submit.provider_task_id) {
    // 响应成功但无 taskId：视为明确失败（可退）
    await failDispatchClearAndRefund(db, task, 'PROVIDER_NO_TASK_ID', { refund: true });
    return { ok: false, reason: 'PROVIDER_NO_TASK_ID', failed: true };
  }

  if (submit.uncertain) {
    await db.updateTaskPhase7Fields(tid, task.user_id, {
      execution_stage: P7_STAGE.DISPATCHING,
      dispatch_unknown: '1',
      provider_error: submit.reason || 'SUBMIT_UNCERTAIN',
      // 保留 lease 至过期，避免他人重试 submit
    });
    logP7('PHASE7_DISPATCH_UNKNOWN', {
      task_id: tid,
      user_id: task.user_id,
      reason: submit.reason,
    });
    return { ok: false, reason: 'DISPATCH_UNKNOWN', uncertain: true };
  }

  // 明确失败 → refund + release + failed
  await failDispatchClearAndRefund(db, task, submit.reason || 'PROVIDER_SUBMIT_FAILED', {
    refund: true,
  });
  logP7('PHASE7_DISPATCH_FAILED', {
    task_id: tid,
    user_id: task.user_id,
    reason: submit.reason,
  });
  return { ok: false, reason: submit.reason || 'PROVIDER_SUBMIT_FAILED', failed: true };
}

/**
 * 无有效 forward：永久不可 Dispatch。
 * 首次：标记 provider_error=NO_FORWARD_PAYLOAD（一轮宽限，不 terminal）。
 * 再次：复用 failDispatchClearAndRefund（refund 由现有 Phase6 按 charge 金额处理，含 0）。
 */
async function finalizeMissingForwardPayload(db, task, _opts = {}) {
  const tid = task.task_id;
  const alreadyMarked = String(task.provider_error || '').trim() === PROVIDER_ERROR_NO_FORWARD;
  if (!alreadyMarked) {
    await db.updateTaskPhase7Fields(tid, task.user_id, {
      execution_stage: P7_STAGE.CHARGED,
      provider_error: PROVIDER_ERROR_NO_FORWARD,
      dispatch_lease_owner: '',
      dispatch_lease_expires_at: 0,
    });
    logP7('PHASE7_NO_FORWARD_MARKED', { task_id: tid, user_id: task.user_id });
    return { ok: false, reason: PROVIDER_ERROR_NO_FORWARD, marked: true };
  }

  // 已标记 → 明确出口：terminal + 现有 refund 路径（金额 0 不会产生余额变动）
  await failDispatchClearAndRefund(db, task, PROVIDER_ERROR_NO_FORWARD, { refund: true });
  logP7('PHASE7_NO_FORWARD_TERMINAL', {
    task_id: tid,
    user_id: task.user_id,
    quoted_cost: task.quoted_cost,
  });
  return { ok: false, reason: PROVIDER_ERROR_NO_FORWARD, failed: true, terminal: true };
}

/** 供 recovery worker：处理 claimed+charged 且无 forward 的污染任务 */
export async function recoverInvalidForwardChargedTask(taskId, db, opts = {}) {
  const tid = String(taskId || '').trim();
  const task = await db.getTaskById(tid);
  if (!task) return { ok: false, reason: 'TASK_NOT_FOUND' };
  if (String(task.status).toLowerCase() !== 'claimed') {
    return { ok: false, reason: 'NOT_CLAIMED', status: task.status };
  }
  const stage = String(task.execution_stage || '').toLowerCase();
  if (stage !== P7_STAGE.CHARGED && stage !== P7_STAGE.DISPATCHING) {
    return { ok: false, reason: 'BAD_STAGE', execution_stage: stage };
  }
  if (String(task.provider_task_id || '').trim()) {
    return { ok: false, reason: 'HAS_PROVIDER_TASK_ID' };
  }
  if (hasValidForwardPath(task)) {
    return { ok: false, reason: 'HAS_VALID_FORWARD' };
  }
  return finalizeMissingForwardPayload(db, task, opts);
}

async function failDispatchClearAndRefund(db, task, errorCode, { refund }) {
  const tid = task.task_id;
  const userId = task.user_id;
  if (refund && typeof db.refundTaskCharge === 'function') {
    try {
      await db.refundTaskCharge(tid);
    } catch (e) {
      console.error('[phase7] refund after dispatch fail', e?.message || e);
    }
  }
  await db.upsertTask(tid, userId, {
    status: 'failed',
    execution_stage: P7_STAGE.DONE,
    error_code: errorCode,
    error_msg: errorCode,
    dispatch_lease_owner: '',
    dispatch_lease_expires_at: 0,
    user_slot_held: '0',
    platform_slot_held: '0',
    // 下面显式 releaseSlotsIfHeld，避免与 upsertTask 终态自动释放双减
    skip_slot_auto_release: true,
  });
  await releaseSlotsIfHeld(db, task);
}

async function releaseSlotsIfHeld(db, task) {
  const taskType = String(task.task_type || '').toLowerCase();
  const userId = task.user_id;
  const reservationId = String(task.reservation_id || '');
  let resourcePool = String(task.resource_pool || '').trim().toLowerCase();
  if (!resourcePool) {
    try {
      const { resolveResourcePoolFromTaskRow } = await import('./resourcePool.mjs');
      resourcePool =
        resolveResourcePoolFromTaskRow(task) ||
        (taskType === 'video' ? 'cn_video' : taskType === 'image' ? 'cn_image' : taskType === 'audio' ? 'audio' : '');
    } catch (_) {
      resourcePool =
        taskType === 'video' ? 'cn_video' : taskType === 'image' ? 'cn_image' : taskType === 'audio' ? 'audio' : '';
    }
  }

  const pooled =
    taskType === 'video' || taskType === 'image' || taskType === 'audio' || Boolean(resourcePool);

  if (pooled && held(task.platform_slot_held) && resourcePool) {
    try {
      if (typeof db.releasePlatformSlotAndRefill === 'function') {
        await db.releasePlatformSlotAndRefill(resourcePool, { maxRefill: 1, kickPipeline: true });
      } else {
        await db.releasePlatformConcurrencySlot(resourcePool);
      }
    } catch (e) {
      console.error('[phase7] release platform', e?.message || e);
    }
  }
  if (pooled && held(task.user_slot_held) && (taskType === 'video' || taskType === 'image' || taskType === 'audio')) {
    try {
      await db.releaseUserConcurrencySlot(userId, taskType);
    } catch (e) {
      console.error('[phase7] release user', e?.message || e);
    }
  }
  if (reservationId) {
    try {
      await db.updateSlotReservation(reservationId, {
        state: 'released',
        user_slot_held: 0,
        platform_slot_held: 0,
      });
    } catch (_) {}
  }
}

/**
 * Poll：仅当 provider_task_id 存在
 */
export async function pollOneProviderTask(taskId, db, opts = {}) {
  const tid = String(taskId || '').trim();
  const task = await db.getTaskById(tid);
  if (!task) return { ok: false, reason: 'TASK_NOT_FOUND' };
  const pid = String(task.provider_task_id || '').trim();
  if (!pid) return { ok: false, reason: 'NO_PROVIDER_TASK_ID' };

  const status = String(task.status || '').toLowerCase();
  if (status === 'success' || status === 'failed' || status === 'cancelled') {
    return { ok: true, idempotent: true, terminal: true, status };
  }

  // Poll 必须与 Dispatch 同站：优先 opts → provider_forward_json.rhRegion → 已有 rhreg 映射
  const forward = parseForwardPayload(task);
  let rhRegion = opts.rhRegion != null ? String(opts.rhRegion).trim().toLowerCase() : '';
  if (rhRegion !== 'ai' && rhRegion !== 'cn') rhRegion = '';
  if (!rhRegion) {
    rhRegion =
      (await resolveRhRegionForQuery(db, task.user_id, { taskId: pid }, forward?.rhRegion)) || '';
  }

  const queryFn = opts.queryRunningHub || queryRunningHub;
  const q = await queryFn(pid, {
    rhRegion: rhRegion || undefined,
    fetchImpl: opts.fetchImpl,
    timeoutMs: opts.queryTimeoutMs,
  });

  await db.updateTaskPhase7Fields(tid, task.user_id, {
    provider_last_checked_at: Date.now(),
    provider_status: q.status || task.provider_status || '',
    ...(q.ok ? {} : { provider_error: q.reason || 'QUERY_FAIL' }),
  });

  if (!q.ok) {
    logP7('PHASE7_POLL_UNCERTAIN', { task_id: tid, provider_task_id: pid, reason: q.reason });
    // 查询失败也短暂退避，避免每分钟打爆 RH
    await scheduleNextProviderPoll(db, task, { nowMs: Date.now() });
    return { ok: false, reason: q.reason || 'QUERY_FAIL', uncertain: true };
  }

  const st = normalizeProviderStatus(q.status);
  if (isProviderTerminalSuccess(st)) {
    await db.updateTaskPhase7Fields(tid, task.user_id, {
      execution_stage: P7_STAGE.SETTLING,
      provider_status: st,
      ...(q.result_url ? { result_oss_url: q.result_url } : {}),
    });
    return settleOneTask(tid, db, { outcome: 'success', result_url: q.result_url });
  }
  if (isProviderTerminalFailed(st)) {
    await db.updateTaskPhase7Fields(tid, task.user_id, {
      execution_stage: P7_STAGE.SETTLING,
      provider_status: st,
      provider_error: st,
    });
    return settleOneTask(tid, db, { outcome: 'failed', refund: true, error_code: 'PROVIDER_FAILED' });
  }

  // in-flight
  if (String(task.status).toLowerCase() !== 'running') {
    await db.upsertTask(tid, task.user_id, {
      status: 'running',
      execution_stage: P7_STAGE.PROVIDER_SUBMITTED,
      provider_status: st || 'RUNNING',
    });
  }
  const sched = await scheduleNextProviderPoll(db, task, { nowMs: Date.now() });
  return {
    ok: true,
    in_flight: true,
    provider_status: st,
    poll_interval: sched.poll_interval_sec,
    next_poll_at: sched.next_poll_at,
  };
}

async function scheduleNextProviderPoll(db, task, opts = {}) {
  const now = Number(opts.nowMs) || Date.now();
  const runningAt = Number(task.running_at) || Number(task.created_at) || now;
  const intervalMs = resolveProviderPollIntervalMs(runningAt, now);
  const intervalSec = resolveProviderPollIntervalSec(runningAt, now);
  const nextPollAt = now + intervalMs;
  logP7('PHASE7_POLL_BACKOFF', {
    task_id: task.task_id,
    poll_interval: intervalSec,
    next_poll_at: nextPollAt,
    running_at: runningAt,
  });
  if (typeof db.upsertTaskWork === 'function') {
    try {
      await db.upsertTaskWork({
        task_id: task.task_id,
        user_id: task.user_id,
        status: task.status || 'running',
        provider_task_id: task.provider_task_id,
        execution_stage: task.execution_stage,
        next_poll_at: nextPollAt,
      });
    } catch (e) {
      console.warn('[phase7] next_poll_at write skipped:', e?.message || e);
    }
  }
  return { poll_interval_sec: intervalSec, next_poll_at: nextPollAt, interval_ms: intervalMs };
}

/**
 * Settle：success 不退；failed 可退；然后 release
 */
export async function settleOneTask(taskId, db, opts = {}) {
  const tid = String(taskId || '').trim();
  const task = await db.getTaskById(tid);
  if (!task) return { ok: false, reason: 'TASK_NOT_FOUND' };

  const status = String(task.status || '').toLowerCase();
  if (status === 'success' || status === 'failed' || status === 'cancelled') {
    // 可能只缺 release
    if (held(task.user_slot_held) || held(task.platform_slot_held)) {
      await releaseSlotsIfHeld(db, task);
      await db.updateTaskPhase7Fields(tid, task.user_id, {
        user_slot_held: '0',
        platform_slot_held: '0',
        execution_stage: P7_STAGE.DONE,
      });
    }
    return { ok: true, idempotent: true, status };
  }

  const outcome = opts.outcome || (status === 'running' ? null : null);
  if (outcome === 'success') {
    const slotSnap = {
      ...task,
      user_slot_held: task.user_slot_held,
      platform_slot_held: task.platform_slot_held,
    };
    await db.upsertTask(tid, task.user_id, {
      status: 'success',
      execution_stage: P7_STAGE.DONE,
      ...(opts.result_url ? { result_oss_url: opts.result_url } : {}),
      user_slot_held: '0',
      platform_slot_held: '0',
      error_code: '',
      error_msg: '',
      skip_slot_auto_release: true,
    });
    // 仅按 settle 前 held 标志释放，避免重复 settle 双减计数器
    await releaseSlotsIfHeld(db, slotSnap);
    logP7('PHASE7_SETTLE_SUCCESS', { task_id: tid, user_id: task.user_id });
    return { ok: true, status: 'success' };
  }

  if (outcome === 'failed') {
    if (opts.refund !== false && typeof db.refundTaskCharge === 'function') {
      try {
        await db.refundTaskCharge(tid);
      } catch (e) {
        console.error('[phase7] settle refund', e?.message || e);
      }
    }
    const slotSnap = {
      ...task,
      user_slot_held: task.user_slot_held,
      platform_slot_held: task.platform_slot_held,
    };
    await db.upsertTask(tid, task.user_id, {
      status: 'failed',
      execution_stage: P7_STAGE.DONE,
      error_code: opts.error_code || 'PROVIDER_FAILED',
      error_msg: opts.error_code || 'PROVIDER_FAILED',
      user_slot_held: '0',
      platform_slot_held: '0',
      skip_slot_auto_release: true,
    });
    await releaseSlotsIfHeld(db, slotSnap);
    logP7('PHASE7_SETTLE_FAILED', { task_id: tid, user_id: task.user_id });
    return { ok: true, status: 'failed' };
  }

  return { ok: false, reason: 'SETTLE_NO_OUTCOME' };
}

/**
 * Recovery：按 SoT 推进，禁止盲 submit
 */
export async function recoverOneProviderTask(taskId, db, opts = {}) {
  const tid = String(taskId || '').trim();
  const task = await db.getTaskById(tid);
  if (!task) return { ok: false, reason: 'TASK_NOT_FOUND' };

  // Crash I/J：终态但槽未释 → 只补 release（不 poll、不 submit、不 refund）
  const st0 = String(task.status || '').toLowerCase();
  if (
    (st0 === 'success' || st0 === 'failed' || st0 === 'cancelled') &&
    (held(task.user_slot_held) || held(task.platform_slot_held))
  ) {
    await releaseSlotsIfHeld(db, task);
    await db.updateTaskPhase7Fields(tid, task.user_id, {
      user_slot_held: '0',
      platform_slot_held: '0',
      execution_stage: P7_STAGE.DONE,
    });
    return { ok: true, action: 'release_only' };
  }

  const pid = String(task.provider_task_id || '').trim();
  if (pid) {
    // 有 SoT：只 poll/settle
    return pollOneProviderTask(tid, db, opts);
  }

  if (Number(task.dispatch_unknown) === 1) {
    logP7('PHASE7_RECOVERY_STOP_UNKNOWN', { task_id: tid, user_id: task.user_id });
    return { ok: false, reason: 'DISPATCH_UNKNOWN_STOP', action: 'no_submit_no_refund' };
  }

  const stage = String(task.execution_stage || '').toLowerCase();
  if (stage === P7_STAGE.CHARGED || stage === P7_STAGE.DISPATCHING) {
    // lease 过期才允许再 dispatch
    const nowMs = opts.nowMs ?? Date.now();
    const exp = Number(task.dispatch_lease_expires_at || 0);
    if (exp > nowMs && task.dispatch_lease_owner) {
      return { ok: false, reason: 'LEASE_ACTIVE' };
    }
    return dispatchOneChargedTask(tid, db, opts);
  }

  if (stage === P7_STAGE.SETTLING) {
    // 根据 provider_status 决定
    if (isProviderTerminalSuccess(task.provider_status)) {
      return settleOneTask(tid, db, { outcome: 'success', result_url: task.result_oss_url });
    }
    if (isProviderTerminalFailed(task.provider_status)) {
      return settleOneTask(tid, db, { outcome: 'failed', refund: true });
    }
  }

  return { ok: false, reason: 'NOTHING_TO_RECOVER' };
}

export async function runDispatchChargedTasks(db, opts = {}) {
  const maxTasks = Math.min(50, Math.max(1, Number(opts.maxTasks) || 10));
  const maxInvalid = Math.min(
    50,
    Math.max(0, Number(opts.maxInvalidForwardTasks ?? maxTasks) || maxTasks),
  );
  const ids = await db.listChargedTasksForDispatch({ maxTasks, maxScanRows: opts.maxScanRows });
  const results = [];
  let ok = 0;
  let unknown = 0;
  let failed = 0;
  for (const tid of ids) {
    const r = await dispatchOneChargedTask(tid, db, opts);
    results.push({ task_id: tid, ...r });
    if (r.ok) ok += 1;
    else if (r.uncertain) unknown += 1;
    else if (r.failed) failed += 1;
  }

  // 坏任务出口：不占正常 Dispatch 候选；单独扫 claimed+charged 无 forward → mark / terminal
  let invalidCandidates = 0;
  let invalidMarked = 0;
  let invalidTerminal = 0;
  if (maxInvalid > 0 && typeof db.listInvalidForwardChargedTasks === 'function') {
    const badIds = await db.listInvalidForwardChargedTasks({
      maxTasks: maxInvalid,
      maxScanRows: opts.maxScanRows,
    });
    invalidCandidates = badIds.length;
    for (const tid of badIds) {
      const r = await recoverInvalidForwardChargedTask(tid, db, opts);
      results.push({ task_id: tid, invalid_forward: true, ...r });
      if (r.marked) invalidMarked += 1;
      if (r.terminal || r.failed) {
        invalidTerminal += 1;
        failed += 1;
      }
    }
  }

  return {
    candidates: ids.length,
    ok,
    unknown,
    failed,
    invalid_forward: {
      candidates: invalidCandidates,
      marked: invalidMarked,
      terminal: invalidTerminal,
    },
    results,
  };
}

export async function runPollProviderTasks(db, opts = {}) {
  const maxTasks = Math.min(100, Math.max(1, Number(opts.maxTasks) || 20));
  const ids = await db.listRunningProviderTasks({ maxTasks, maxScanRows: opts.maxScanRows });
  const results = [];
  let settled = 0;
  let inflight = 0;
  for (const tid of ids) {
    const r = await pollOneProviderTask(tid, db, opts);
    results.push({ task_id: tid, ...r });
    if (r.status === 'success' || r.status === 'failed') settled += 1;
    else if (r.in_flight) inflight += 1;
  }
  return { candidates: ids.length, settled, inflight, results };
}

export async function runRecoverProviderTasks(db, opts = {}) {
  const maxTasks = Math.min(50, Math.max(1, Number(opts.maxTasks) || 20));
  const ids = await db.listPhase7RecoveryCandidates({ maxTasks, maxScanRows: opts.maxScanRows });
  const results = [];
  for (const tid of ids) {
    const r = await recoverOneProviderTask(tid, db, opts);
    results.push({ task_id: tid, ...r });
  }
  return { candidates: ids.length, results };
}
