/**
 * Queue 全链路编排（不改 Phase 5/6/7 核心 CAS）：
 * lease recovery + promote（recovery 兜底）→ charge → dispatch → poll
 *
 * 正常调度：create 异步 pipeline + settle 释槽后同池 refill（均经 OTS acquire）
 * Timer：异常恢复 / 故障巡检；空闲秒退，不负责高频正常调度
 *
 * 省钱策略（稳 + 体验）：
 * - 有活跃工作 / 平台槽位：按 Timer cron 推进（建议 @every 5m）
 * - 完全空闲：代码层 15min 才探活一次（中间 Timer 秒退，不读 OTS）；靠 create 唤醒
 * - 默认每 3h 一次瘦表保险巡检（防 lease/计数器漂移）
 * - opts.force=1：强制全跑（运维/验收）
 */

import {
  decideIdleProbeDeferral,
  getQueueIdleProbeMs,
  QUEUE_ACTIVE_TIMER_MS,
  recordIdleProbeResult,
} from './queueCostTune.mjs';

export async function runQueuePipeline(db, opts = {}) {
  const maxClaims = Math.min(
    200,
    Math.max(0, parseInt(String(opts.maxClaims ?? opts.max_claims ?? '20'), 10) || 20),
  );
  const maxCharge = Math.min(
    200,
    Math.max(1, parseInt(String(opts.maxCharge ?? opts.max_charge ?? maxClaims * 2), 10) || maxClaims * 2),
  );
  const maxDispatch = Math.min(
    50,
    Math.max(1, parseInt(String(opts.maxDispatch ?? opts.max_dispatch ?? maxClaims), 10) || maxClaims),
  );
  const maxPoll = Math.min(
    100,
    Math.max(1, parseInt(String(opts.maxPoll ?? opts.max_poll ?? Math.max(20, maxClaims * 2)), 10) || 40),
  );
  const reconcile = opts.reconcile === true || opts.reconcile === '1';
  const force =
    opts.force === true ||
    opts.force === '1' ||
    opts.force === 1 ||
    String(process.env.NX_QUEUE_FORCE_PIPELINE || '') === '1';
  const started = Date.now();

  // 空闲保险窗口：默认 3 小时一次（可 env 覆盖）；Timer 建议 @every 5m，空闲时多数直接 return
  const idleSafetyMsRaw = Number(
    opts.idleFullSweepMs ??
      opts.idle_full_sweep_ms ??
      process.env.NX_QUEUE_IDLE_FULL_SWEEP_MS ??
      10800000,
  );
  const idleSafetyMs = Number.isFinite(idleSafetyMsRaw)
    ? Math.min(24 * 3600000, Math.max(60000, Math.floor(idleSafetyMsRaw)))
    : 10800000;
  // 假定 Timer 约每 5min 触发一次：跨过 safety 边界的那一拍跑保险
  const safetyTickMs = Number(process.env.NX_QUEUE_TIMER_TICK_MS || QUEUE_ACTIVE_TIMER_MS) || 300000;
  const safetyWindow =
    Math.floor(started / idleSafetyMs) !==
    Math.floor((started - Math.max(60000, safetyTickMs)) / idleSafetyMs);

  const idleProbeMs = getQueueIdleProbeMs();
  const deferral = decideIdleProbeDeferral({
    nowMs: started,
    force,
    safetyWindow,
    idleProbeMs,
  });

  const out = {
    ok: true,
    started_at: started,
    promote: null,
    charge: null,
    dispatch: null,
    poll: null,
    idle_short_circuit: false,
    idle_no_patrol: false,
    queue_mode: deferral.mode,
  };

  // 空闲降频：跳过 OTS 探活与全链路（create 异步 pipeline 不受影响）
  if (deferral.defer) {
    out.idle_short_circuit = true;
    out.idle_no_patrol = true;
    out.queue_mode = 'idle';
    out.idle_short_circuit_detail = {
      active_slots: null,
      work_active: null,
      safety_window: safetyWindow,
      idle_full_sweep_ms: idleSafetyMs,
      idle_probe_ms: idleProbeMs,
      since_last_probe_ms: deferral.since_last_probe_ms,
      reason: deferral.reason || 'idle_probe_deferred',
    };
    out.elapsed_ms = Date.now() - started;
    out.summary = {
      lease_recovered: 0,
      claimed: 0,
      charged: 0,
      dispatched_ok: 0,
      poll_settled: 0,
    };
    console.log(
      JSON.stringify({
        event: 'queue_mode',
        queue_mode: 'idle',
        reason: deferral.reason || 'idle_probe_deferred',
        idle_probe_ms: idleProbeMs,
        since_last_probe_ms: deferral.since_last_probe_ms,
        timestamp: new Date().toISOString(),
      }),
    );
    return out;
  }

  let activeSlots = null;
  let counterReadError = null;
  if (typeof db.getPlatformConcurrencyPoolSnapshot === 'function') {
    try {
      const pools = await db.getPlatformConcurrencyPoolSnapshot();
      if (pools?.total_running != null) {
        activeSlots = Math.max(0, Number(pools.total_running) || 0);
      } else {
        activeSlots =
          Math.max(0, Number(pools?.cn_video?.running ?? pools?.video?.running) || 0) +
          Math.max(0, Number(pools?.cn_image?.running ?? pools?.image?.running) || 0) +
          Math.max(0, Number(pools?.overseas_video?.running) || 0) +
          Math.max(0, Number(pools?.overseas_image?.running) || 0) +
          Math.max(0, Number(pools?.audio?.running) || 0);
      }
    } catch (e) {
      counterReadError = e?.message || String(e);
    }
  }

  let workActive = null;
  let workProbeError = null;
  if (typeof db.countTaskWorkActive === 'function') {
    try {
      const c = await db.countTaskWorkActive({ maxScanRows: 2000 });
      workActive = c?.has_any === true || Number(c?.count || 0) > 0;
    } catch (e) {
      workProbeError = e?.message || String(e);
    }
  }

  const clearlyIdle = activeSlots === 0 && workActive === false;
  const idleNoPatrol = !force && clearlyIdle && !safetyWindow;

  const gate = recordIdleProbeResult({ clearlyIdle, nowMs: started });
  out.queue_mode = gate.mode;

  console.log(
    JSON.stringify({
      event: 'queue_mode',
      queue_mode: gate.mode,
      active_slots: activeSlots,
      work_active: workActive,
      safety_window: safetyWindow,
      idle_probe_ms: idleProbeMs,
      timestamp: new Date().toISOString(),
    }),
  );

  if (idleNoPatrol) {
    out.idle_short_circuit = true;
    out.idle_no_patrol = true;
    out.idle_short_circuit_detail = {
      active_slots: activeSlots,
      work_active: workActive,
      safety_window: safetyWindow,
      idle_full_sweep_ms: idleSafetyMs,
      idle_probe_ms: idleProbeMs,
      reason: 'idle_zero_patrol',
      ...(counterReadError ? { counter_read_error: counterReadError } : {}),
      ...(workProbeError ? { work_probe_error: workProbeError } : {}),
    };
    out.elapsed_ms = Date.now() - started;
    out.summary = {
      lease_recovered: 0,
      claimed: 0,
      charged: 0,
      dispatched_ok: 0,
      poll_settled: 0,
    };
    return out;
  }

  // 有活 / 强制 / 保险窗 / 探测失败(fail-open)：跑 promote
  if (typeof db.runPromoteQueuedTasks === 'function') {
    out.promote = await db.runPromoteQueuedTasks({
      maxClaims,
      reconcile,
      maxLeaseRecover: Math.min(
        200,
        Math.max(1, parseInt(String(opts.maxLeaseRecover ?? opts.max_lease_recover ?? '50'), 10) || 50),
      ),
      maxOrphans: Math.min(
        200,
        Math.max(1, parseInt(String(opts.maxOrphans ?? opts.max_orphans ?? '50'), 10) || 50),
      ),
      maxScanRows: Math.min(
        500000,
        Math.max(1000, parseInt(String(opts.maxScanRows ?? opts.max_scan_rows ?? '20000'), 10) || 20000),
      ),
    });
  }

  const claimedThisRun = Number(out.promote?.promote?.claimed || 0);
  // charge/dispatch/poll：有槽、本轮 claim、工作表有活、保险窗、强制、或探测失败时跑
  const shouldRunActiveStages =
    force ||
    safetyWindow ||
    activeSlots == null ||
    activeSlots > 0 ||
    workActive == null ||
    workActive === true ||
    claimedThisRun > 0;

  if (shouldRunActiveStages && typeof db.runChargeClaimedTasks === 'function') {
    out.charge = await db.runChargeClaimedTasks({ maxTasks: maxCharge });
  }

  if (shouldRunActiveStages && typeof db.runDispatchChargedTasks === 'function') {
    out.dispatch = await db.runDispatchChargedTasks({ maxTasks: maxDispatch });
  }

  if (shouldRunActiveStages && typeof db.runPollProviderTasks === 'function') {
    out.poll = await db.runPollProviderTasks({ maxTasks: maxPoll });
  }

  out.idle_short_circuit = !shouldRunActiveStages;
  out.idle_short_circuit_detail = {
    active_slots: activeSlots,
    work_active: workActive,
    safety_window: safetyWindow,
    idle_full_sweep_ms: idleSafetyMs,
    idle_probe_ms: idleProbeMs,
    force,
    ...(counterReadError ? { counter_read_error: counterReadError } : {}),
    ...(workProbeError ? { work_probe_error: workProbeError } : {}),
  };

  out.elapsed_ms = Date.now() - started;
  out.summary = {
    lease_recovered: out.promote?.lease_recovery?.recovered ?? 0,
    claimed: out.promote?.promote?.claimed ?? 0,
    charged: out.charge?.charged ?? 0,
    dispatched_ok: out.dispatch?.ok ?? 0,
    poll_settled: out.poll?.settled ?? 0,
  };
  return out;
}
