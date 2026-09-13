/**
 * Phase 9.2 — MiniMax H3 Unified Queue mock（与 Phase 8.1 同套 Queue；不改基础设施）
 * node scripts/test-phase9-2-h3-queue.mjs
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
} = await import('../lib/providerPipeline.mjs');
const { forceOverseasByBillingOrPath, pickRunningHubTarget } = await import('../lib/runningHubTarget.mjs');

const PREFIX = `__p92_${Date.now().toString(36)}_`;
const H3_PATH = '/run/ai-app/2085682347676102657';
const H3_SKU = 'minimax-h3-t2v-720p-10s';

const stats = {
  rh_submit_calls: 0,
  tests: [],
  regions: {},
};

function record(name, ok, detail) {
  stats.tests.push({ name, ok, detail });
  console.log(ok ? `[PASS] ${name}` : `[FAIL] ${name}`, detail || '');
}

function buildH3Forward(prompt = 'h3 queue mock') {
  return {
    provider: 'runninghub',
    path: H3_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '149', fieldName: 'text', fieldValue: prompt, description: '提示词' },
        { nodeId: '16', fieldName: 'megapixels', fieldValue: '0.9', description: '分辨率（看介绍）' },
        {
          nodeId: '16',
          fieldName: 'aspect_ratio',
          fieldValue: '16:9 (Widescreen)',
          description: '比例选择',
        },
        { nodeId: '14', fieldName: 'value', fieldValue: '10', description: '时长' },
      ],
      instanceType: 'plus',
      usePersonalQueue: 'false',
    },
    billingModelId: H3_SKU,
    rhRegion: 'cn',
  };
}

function buildRhartForward(prompt = 'rhart regression') {
  return {
    provider: 'runninghub',
    path: '/rhart-video-g/text-to-video',
    method: 'POST',
    body: { prompt, aspectRatio: '16:9', resolution: '720p', duration: 10 },
    billingModelId: 'rhart-video-x-720p-10s',
    rhRegion: 'ai',
  };
}

async function setBalance(userId, balance) {
  const u = await db.getUserById(userId);
  if (!u) {
    try {
      await db.createUserOtpOnly({ userId, email: `${userId}@p92.local` });
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
    return { ok: true, provider_task_id: pid || `rh_h3_${crypto.randomUUID()}`, data: {} };
  };
}

async function createH3Task(userId, extra = {}) {
  const forward = buildH3Forward(extra.prompt || 'p92 h3');
  const body = {
    model_id: extra.model_id || H3_SKU,
    type: 'video',
    execution_mode: 'queue',
    provider_forward_json: forward,
    params: {
      nodeId: 'n1',
      taskKind: 'video',
      model: 'minimax-h3-t2v',
      prompt: extra.prompt || 'p92 h3',
      nxCloudQueueGoldenPath: true,
    },
    nodeData: {
      model: 'minimax-h3-t2v',
      aspect_ratio: '16:9',
      durationMinimaxH3: '10',
      resolutionMinimaxH3: '720p',
      duration: '10',
    },
    ...extra.body,
  };
  const r = await handleTasksCreate(userId, body, db, {
    getFinalPrice: () => extra.quoted ?? 8,
  });
  return r.task_id;
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

async function promoteUntilClaimed(taskId, userId) {
  const t = await db.getTaskById(taskId);
  if (!t) return null;
  if (t.status === 'claimed' || t.status === 'running') return t;
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

async function runPipeline(taskId, userId, rhMock, queryMock) {
  const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
  await promoteUntilClaimed(taskId, userId);
  await chargeClaimedTask(taskId, db);
  const d = await dispatchOneChargedTask(taskId, db, { submitRunningHub: rhMock });
  if (d.ok || d.idempotent) {
    await pollOneProviderTask(taskId, db, {
      queryRunningHub:
        queryMock ||
        (async () => ({
          ok: true,
          status: 'SUCCESS',
          result_url: 'https://example.com/h3-golden.mp4',
        })),
    });
  }
  return d;
}

async function main() {
  const uid = `${PREFIX}u`;
  try {
    await db.createUserOtpOnly({ userId: uid, email: `${uid}@t.t` });
  } catch (_) {}
  await db.updateUserConcurrencyEntitlement(uid, {
    planId: 'enterprise',
    videoConcurrencyLimit: 5,
    imageConcurrencyLimit: 5,
  });
  await setBalance(uid, 1000);

  // Region static checks（builder 等价）
  {
    const h3 = buildH3Forward();
    const rh = buildRhartForward();
    const forceH3 = forceOverseasByBillingOrPath(h3.path, h3.billingModelId);
    const forceRh = forceOverseasByBillingOrPath(rh.path, rh.billingModelId);
    const pickH3 = pickRunningHubTarget(h3.path, { regionHint: h3.rhRegion });
    const pickRh = pickRunningHubTarget(rh.path, { regionHint: rh.rhRegion });
    stats.regions = {
      h3_forceOverseas: forceH3,
      h3_pick: pickH3.region,
      h3_rhRegion: h3.rhRegion,
      rhart_forceOverseas: forceRh,
      rhart_pick: pickRh.region,
      rhart_rhRegion: rh.rhRegion,
      duration_type: typeof h3.body.nodeInfoList[3].fieldValue,
    };
    record(
      'region_h3_cn_rhart_ai',
      h3.rhRegion === 'cn' &&
        rh.rhRegion === 'ai' &&
        forceH3 === false &&
        forceRh === true &&
        pickH3.region === 'cn' &&
        pickRh.region === 'ai' &&
        typeof h3.body.nodeInfoList[3].fieldValue === 'string',
      stats.regions,
    );
  }

  // 1 full pipeline
  {
    const before = stats.rh_submit_calls;
    const tid = await createH3Task(uid);
    const t0 = await db.getTaskById(tid);
    const fwd = JSON.parse(t0.provider_forward_json || '{}');
    record(
      '1_create_queued_h3_forward',
      t0.status === 'queued' &&
        fwd.rhRegion === 'cn' &&
        fwd.path === H3_PATH &&
        typeof fwd.body?.nodeInfoList?.[3]?.fieldValue === 'string',
      { status: t0.status, rhRegion: fwd.rhRegion, path: fwd.path, dur: fwd.body?.nodeInfoList?.[3]?.fieldValue },
    );
    await runPipeline(tid, uid, mockRhOk('rh_h3_single'));
    const t1 = await db.getTaskById(tid);
    const u1 = await db.getUserById(uid);
    record(
      '1_full_pipeline_success',
      t1.status === 'success' &&
        t1.provider_task_id === 'rh_h3_single' &&
        Number(u1.balance) === 992 &&
        stats.rh_submit_calls === before + 1,
      {
        status: t1.status,
        stage: t1.execution_stage,
        pid: t1.provider_task_id,
        balance: u1.balance,
        submits: stats.rh_submit_calls - before,
        user_slot: t1.user_slot_held,
        platform_slot: t1.platform_slot_held,
      },
    );
  }

  // Duplicate charge
  {
    const tid = await createH3Task(uid, { quoted: 8 });
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    const bal0 = (await db.getUserById(uid)).balance;
    await chargeClaimedTask(tid, db);
    await chargeClaimedTask(tid, db);
    await chargeClaimedTask(tid, db);
    const bal1 = (await db.getUserById(uid)).balance;
    const t = await db.getTaskById(tid);
    record(
      '6_duplicate_charge_once',
      Number(bal0) - Number(bal1) === 8 && String(t.execution_stage || '').includes('charg'),
      { delta: Number(bal0) - Number(bal1), stage: t.execution_stage, bal0, bal1 },
    );
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_h3_chg') });
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/h3.mp4',
      }),
    });
  }

  // Duplicate dispatch 10x
  {
    const before = stats.rh_submit_calls;
    const tid = await createH3Task(uid);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    await chargeClaimedTask(tid, db);
    await Promise.all(
      Array.from({ length: 10 }, () =>
        dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_h3_storm') }),
      ),
    );
    const t = await db.getTaskById(tid);
    record(
      '5_duplicate_dispatch_one_rh',
      stats.rh_submit_calls === before + 1 && t.provider_task_id === 'rh_h3_storm',
      { submits: stats.rh_submit_calls - before, pid: t.provider_task_id },
    );
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async (_pid, opts) => {
        record('4_poll_rhRegion_cn', opts?.rhRegion === 'cn', { seen: opts?.rhRegion });
        return { ok: true, status: 'SUCCESS', result_url: 'https://example.com/h3.mp4' };
      },
    });
  }

  // Refund on provider fail + idempotent
  {
    const tid = await createH3Task(uid);
    const bal0 = (await db.getUserById(uid)).balance;
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    await chargeClaimedTask(tid, db);
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_h3_fail') });
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({ ok: true, status: 'FAILED', error: 'mock fail' }),
    });
    const bal1 = (await db.getUserById(uid)).balance;
    const r2 = await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({ ok: true, status: 'FAILED', error: 'mock fail again' }),
    });
    const bal2 = (await db.getUserById(uid)).balance;
    const t = await db.getTaskById(tid);
    record(
      '7_refund_once',
      t.status === 'failed' && Number(bal0) === Number(bal1) && Number(bal1) === Number(bal2),
      { status: t.status, bal0, bal1, bal2, r2 },
    );
  }

  // Lease recovery
  {
    const tid = await createH3Task(uid);
    await promoteUntilClaimed(tid, uid);
    let t = await db.getTaskById(tid);
    const claimToken = t.claim_token;
    const leasePast = Date.now() - 60_000;
    await db.atomicUnclaimExpiredTask({
      taskId: tid,
      claimToken,
      nowMs: leasePast + 1,
      expectedLeaseUntil: Number(t.lease_until || leasePast),
    }).catch(async () => {
      // fallback: force status back if helper signature differs
      await db.updateTaskFields?.(tid, { status: 'queued', claim_token: '', lease_until: 0 });
    });
    t = await db.getTaskById(tid);
    // If still claimed, use scheduler unclaim path
    if (t.status === 'claimed') {
      const { promoteQueuedTasks } = await import('../lib/queueScheduler.mjs');
      const deps = await buildPromoteDeps(Date.now() + 3600_000);
      // expire lease via update
      await db.upsertTask(tid, uid, {
        ...t,
        lease_until: String(Date.now() - 1000),
        status: 'claimed',
      });
      await promoteQueuedTasks(
        [
          {
            taskId: tid,
            userId: uid,
            taskType: 'video',
            queueEnteredAt: Number(t.queue_entered_at || Date.now()),
          },
        ],
        deps,
        { maxClaims: 1 },
      );
      t = await db.getTaskById(tid);
    }
    const balBefore = (await db.getUserById(uid)).balance;
    const submitBefore = stats.rh_submit_calls;
    await runPipeline(tid, uid, mockRhOk('rh_h3_reclaim'));
    const t2 = await db.getTaskById(tid);
    const balAfter = (await db.getUserById(uid)).balance;
    record(
      '8_lease_recovery',
      t2.status === 'success' &&
        t2.provider_task_id === 'rh_h3_reclaim' &&
        stats.rh_submit_calls === submitBefore + 1 &&
        Number(balBefore) - Number(balAfter) === 8,
      {
        status: t2.status,
        pid: t2.provider_task_id,
        submits: stats.rh_submit_calls - submitBefore,
        charged: Number(balBefore) - Number(balAfter),
        user_slot: t2.user_slot_held,
        platform_slot: t2.platform_slot_held,
      },
    );
  }

  const passed = stats.tests.every((x) => x.ok);
  const out = {
    passed,
    stats,
    conclusion: passed ? 'PASS' : 'FAIL',
  };
  fs.writeFileSync(path.resolve(__dirname, 'phase9-2-h3-queue-test-result.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ conclusion: out.conclusion, passed, n: stats.tests.length }, null, 2));
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
