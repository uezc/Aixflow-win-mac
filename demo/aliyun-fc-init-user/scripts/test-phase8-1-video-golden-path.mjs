/**
 * Phase 8.1 Video Golden Path 测试（mock RH + 实库 OTS）
 * node scripts/test-phase8-1-video-golden-path.mjs
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const p of [path.resolve(__dirname, '../../../.env'), path.resolve(__dirname, '../.env')]) {
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}
process.env.NX_SKIP_QUEUE_PIPELINE_ON_CREATE = '1';

const db = await import('../lib/db-tablestore.mjs');
const { handleTasksCreate } = await import('../lib/handleTasksCreate.mjs');
const {
  dispatchOneChargedTask,
  pollOneProviderTask,
  settleOneTask,
} = await import('../lib/providerPipeline.mjs');
const { runPromoteQueuedTasks } = db;

const PREFIX = `__p81_${Date.now().toString(36)}_`;
const stats = {
  rh_submit_calls: 0,
  double_rh_submit: false,
  double_charge: false,
  double_refund: false,
  slot_leak: false,
  tests: [],
};

function record(name, ok, detail) {
  stats.tests.push({ name, ok, detail });
  console.log(ok ? `[PASS] ${name}` : `[FAIL] ${name}`, detail || '');
}

async function setBalance(userId, balance) {
  const u = await db.getUserById(userId);
  if (!u) {
    try {
      await db.createUserOtpOnly({ userId, email: `${userId}@p81.local` });
    } catch (_) {}
  }
  const fresh = await db.getUserById(userId);
  const cur = fresh?.balance ?? 0;
  const delta = balance - cur;
  if (delta === 0) return;
  const adjustOp = `adj_${crypto.randomUUID()}`;
  if (delta > 0) {
    await db.atomicCreditWithReceipt(userId, `ref_adj_${adjustOp}`, delta);
  } else {
    const r = await db.atomicDebitWithReceipt(userId, `chg_adj_${adjustOp}`, -delta);
    if (!r.ok) throw new Error('forceBalance debit failed ' + r.reason);
  }
}

function mockRhOk(pid) {
  return async () => {
    stats.rh_submit_calls += 1;
    return { ok: true, provider_task_id: pid || `rh_${crypto.randomUUID()}`, data: {} };
  };
}

function mockRhTimeout() {
  return async () => {
    stats.rh_submit_calls += 1;
    return { ok: false, uncertain: true, reason: 'SUBMIT_TIMEOUT' };
  };
}

function forwardJson(prompt = 'golden path test') {
  return JSON.stringify({
    provider: 'runninghub',
    path: '/rhart-video-g/text-to-video',
    method: 'POST',
    body: { prompt, aspectRatio: '16:9', resolution: '720p', duration: 10 },
    billingModelId: 'rhart-video-x-720p-10s',
    rhRegion: 'ai',
  });
}

async function createQueueVideoTask(userId, extra = {}) {
  const body = {
    model_id: extra.model_id || 'rhart-video-x-720p-10s',
    type: 'video',
    execution_mode: 'queue',
    provider_forward_json: JSON.parse(forwardJson(extra.prompt || 'p81 test')),
    params: {
      nodeId: 'n1',
      taskKind: 'video',
      model: 'rhart-video-x',
      prompt: extra.prompt || 'p81 test',
      nxCloudQueueGoldenPath: true,
    },
    nodeData: {
      model: 'rhart-video-x',
      aspect_ratio: '16:9',
      durationGrok3: '10',
      duration: '10',
    },
    ...extra.body,
  };
  const r = await handleTasksCreate(userId, body, db, {
    getFinalPrice: () => extra.quoted ?? 5,
  });
  return r.task_id;
}

async function drainVideoSlots(max = 120) {
  let snap = await db.getPlatformConcurrencyPoolSnapshot();
  let n = 0;
  while (n < max && snap.video.running > 0) {
    await db.releasePlatformConcurrencySlot('video');
    n += 1;
    snap = await db.getPlatformConcurrencyPoolSnapshot();
  }
}

async function buildPromoteDeps(nowMs = Date.now()) {
  return {
    nowMs,
    resolveUserLimit: async (userId, taskType) => {
      const u = await db.getUserById(userId);
      const { resolveEffectiveConcurrency } = await import('../lib/userConcurrencyEntitlement.mjs');
      const r = resolveEffectiveConcurrency(u || {}, nowMs);
      return taskType === 'image' ? r.imageConcurrencyLimit : r.videoConcurrencyLimit;
    },
    createReservation: (row) => db.putSlotReservation(row),
    markReservationHeld: async (reservationId, which) => {
      if (which === 'user') {
        await db.updateSlotReservation(reservationId, { user_slot_held: 1 });
      } else {
        await db.updateSlotReservation(reservationId, { platform_slot_held: 1 });
      }
    },
    markReservationState: async (reservationId, state, extra = {}) => {
      await db.updateSlotReservation(reservationId, { state, ...extra });
    },
    tryAcquireUser: (userId, taskType, limit) => db.tryAcquireUserConcurrencySlot(userId, taskType, limit),
    releaseUser: (userId, taskType) => db.releaseUserConcurrencySlot(userId, taskType),
    tryAcquirePlatform: (taskType) => db.tryAcquirePlatformConcurrencySlot(taskType),
    releasePlatform: (taskType) => db.releasePlatformConcurrencySlot(taskType),
    atomicClaimQueuedTask: (args) => db.atomicClaimQueuedTask(args),
    atomicUnclaimExpiredTask: (args) => db.atomicUnclaimExpiredTask(args),
    getTaskById: (taskId) => db.getTaskById(taskId),
  };
}

/** 单任务 promote（与 Phase5 queueScheduler 同序：slot → claim） */
async function promoteOneTaskForTest(taskId, userId) {
  const t = await db.getTaskById(taskId);
  if (!t || t.status !== 'queued') return t;
  const { promoteQueuedTasks } = await import('../lib/queueScheduler.mjs');
  const deps = await buildPromoteDeps();
  await promoteQueuedTasks(
    [
      {
        taskId,
        userId,
        taskType: 'video',
        queueEnteredAt: Number(t.queue_entered_at || t.created_at || Date.now()),
      },
    ],
    deps,
    { maxClaims: 1 },
  );
  return db.getTaskById(taskId);
}

async function promoteUntilClaimed(taskId, userId) {
  const t = await db.getTaskById(taskId);
  if (!t) return null;
  if (t.status === 'claimed' || t.status === 'running') return t;
  return promoteOneTaskForTest(taskId, userId);
}

async function runPipelineForTask(taskId, userId, rhMock) {
  const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
  await promoteUntilClaimed(taskId, userId);
  await chargeClaimedTask(taskId, db);
  const d = await dispatchOneChargedTask(taskId, db, { submitRunningHub: rhMock });
  if (d.ok || d.idempotent) {
    await pollOneProviderTask(taskId, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/golden.mp4',
      }),
    });
  }
  return d;
}

async function runPipeline(taskId, userId, rhMock) {
  return runPipelineForTask(taskId, userId, rhMock);
}

async function cleanup(tid, uid) {
  const t = await db.getTaskById(tid);
  if (!t) return;
  if (t.user_slot_held || t.platform_slot_held) {
    try {
      await db.releasePlatformConcurrencySlot('video');
    } catch (_) {}
    try {
      await db.releaseUserConcurrencySlot(uid, 'video');
    } catch (_) {}
  }
}

async function main() {
  const uid = `${PREFIX}u`;
  try {
    await db.createUserOtpOnly({ userId: uid, email: `${uid}@t.t` });
  } catch (_) {}
  await db.updateUserConcurrencyEntitlement(uid, {
    planId: 'enterprise',
    videoConcurrencyOverride: 5,
    concurrencyOverrideExpiresAt: Date.now() + 86400000,
  });
  await setBalance(uid, 1000);
  await drainVideoSlots();

  const ids = [];

  // 1. 单任务 full path（独立用户，避免历史 queued 干扰）
  {
    const u1 = `${PREFIX}u1`;
    try {
      await db.createUserOtpOnly({ userId: u1, email: `${u1}@t.t` });
    } catch (_) {}
    await db.updateUserConcurrencyEntitlement(u1, {
      planId: 'enterprise',
      videoConcurrencyOverride: 5,
      concurrencyOverrideExpiresAt: Date.now() + 86400000,
    });
    await setBalance(u1, 1000);
    const tid = await createQueueVideoTask(u1, { prompt: 'single golden' });
    ids.push(tid);
    const t0 = await db.getTaskById(tid);
    const ok0 = t0.status === 'queued' && t0.quoted_cost === 5 && t0.provider_forward_json.includes('text-to-video');
    record('1_create_queued_with_forward', ok0, { status: t0.status, quoted: t0.quoted_cost });
    await runPipeline(tid, u1, mockRhOk('rh_single'));
    const t1 = await db.getTaskById(tid);
    const ok1 =
      t1.status === 'success' &&
      t1.provider_task_id === 'rh_single' &&
      t1.result_oss_url.includes('golden.mp4') &&
      !t1.user_slot_held &&
      !t1.platform_slot_held;
    record('1_full_pipeline_success', ok1, {
      status: t1.status,
      stage: t1.execution_stage,
      pid: t1.provider_task_id,
    });
    await cleanup(tid, u1);
  }

  // 2. 余额不足
  {
    const poor = `${PREFIX}poor`;
    try {
      await db.createUserOtpOnly({ userId: poor, email: `${poor}@t.t` });
    } catch (_) {}
    await db.updateUserConcurrencyEntitlement(poor, {
      planId: 'enterprise',
      videoConcurrencyOverride: 5,
      concurrencyOverrideExpiresAt: Date.now() + 86400000,
    });
    await setBalance(poor, 0);
    const tid = await createQueueVideoTask(poor, { quoted: 99 });
    ids.push(tid);
    await promoteUntilClaimed(tid, poor);
    const beforeRh = stats.rh_submit_calls;
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await chargeClaimedTask(tid, db);
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_should_not') });
    const t = await db.getTaskById(tid);
    const ok = t.status === 'failed' && stats.rh_submit_calls === beforeRh && !t.provider_task_id;
    record('2_insufficient_no_rh', ok, { status: t.status, rh: stats.rh_submit_calls - beforeRh });
    await cleanup(tid, poor);
  }

  // 3. 用户并发 video_concurrency=5（直接 claim 6 个，第 6 个应留在 queued）
  {
    const concU = `${PREFIX}conc`;
    try {
      await db.createUserOtpOnly({ userId: concU, email: `${concU}@t.t` });
    } catch (_) {}
    await db.updateUserConcurrencyEntitlement(concU, {
      planId: 'enterprise',
      videoConcurrencyOverride: 5,
      concurrencyOverrideExpiresAt: Date.now() + 86400000,
    });
    await setBalance(concU, 1000);
    const batchIds = [];
    for (let i = 0; i < 6; i++) {
      batchIds.push(await createQueueVideoTask(concU, { prompt: `conc ${i}` }));
    }
    ids.push(...batchIds);
    let claimedCount = 0;
    for (let i = 0; i < 6; i++) {
      const t = await promoteOneTaskForTest(batchIds[i], concU);
      if (t?.status === 'claimed') claimedCount += 1;
    }
    const t6 = await db.getTaskById(batchIds[5]);
    const ok = claimedCount === 5 && t6.status === 'queued';
    record('3_user_concurrency_5_of_6', ok, { claimed: claimedCount, sixth: t6.status });
    for (const id of batchIds) await cleanup(id, concU);
  }

  // 7. 同 task 双 dispatch
  {
    const tid = await createQueueVideoTask(uid, { prompt: 'storm' });
    ids.push(tid);
    await promoteUntilClaimed(tid, uid);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await chargeClaimedTask(tid, db);
    const before = stats.rh_submit_calls;
    await Promise.all(
      Array.from({ length: 10 }, () => dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_storm') })),
    );
    const submits = stats.rh_submit_calls - before;
    if (submits > 1) stats.double_rh_submit = true;
    const t = await db.getTaskById(tid);
    record('7_no_double_rh_submit', submits === 1 && t.provider_task_id === 'rh_storm', { submits, pid: t.provider_task_id });
  }

  // 8. timeout unknown
  {
    const tid = await createQueueVideoTask(uid, { prompt: 'timeout' });
    ids.push(tid);
    await promoteUntilClaimed(tid, uid);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await chargeClaimedTask(tid, db);
    const before = stats.rh_submit_calls;
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhTimeout() });
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_no') });
    const t = await db.getTaskById(tid);
    const ok =
      String(t.dispatch_unknown) === '1' &&
      !t.provider_task_id &&
      stats.rh_submit_calls === before + 1 &&
      (t.user_slot_held || t.platform_slot_held);
    record('8_timeout_unknown_no_retry_no_refund', ok, {
      unknown: t.dispatch_unknown,
      held: { u: t.user_slot_held, p: t.platform_slot_held },
    });
  }

  // 10. provider fail + refund idempotent
  {
    const tid = await createQueueVideoTask(uid, { prompt: 'fail' });
    ids.push(tid);
    await promoteUntilClaimed(tid, uid);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await chargeClaimedTask(tid, db);
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_fail') });
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({ ok: true, status: 'FAILED' }),
    });
    const t = await db.getTaskById(tid);
    const r2 = await settleOneTask(tid, db, { outcome: 'failed', refund: true });
    const ok = t.status === 'failed' && r2.idempotent !== undefined;
    record('10_provider_fail_refund', ok, { status: t.status, r2 });
  }

  for (const id of ids) {
    await cleanup(id, uid);
  }

  const passed =
    stats.tests.every((t) => t.ok) &&
    !stats.double_rh_submit &&
    !stats.double_charge &&
    !stats.double_refund;

  const report = { passed, stats };
  fs.writeFileSync(
    path.resolve(__dirname, 'phase8-1-video-golden-test-result.json'),
    JSON.stringify(report, null, 2),
  );
  console.log('\nPASSED=', passed);
  if (!passed) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
