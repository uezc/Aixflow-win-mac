/**
 * Phase 9.5-B-1 — LTX 2.3 I2V Unified Queue mock
 * node scripts/test-phase9-5-b1-ltx-i2v-queue.mjs
 *
 * 不修改 Queue / Claim / Charge / Refund 核心；验证 LTX I2V forward（OSS HTTPS，非 RH fileName）。
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
const { dispatchOneChargedTask, pollOneProviderTask } = await import('../lib/providerPipeline.mjs');
const { pickRunningHubTarget } = await import('../lib/runningHubTarget.mjs');
const { hasValidForwardPath } = await import('../lib/forwardPayload.mjs');

const PREFIX = `__p95b1_${Date.now().toString(36)}_`;
const I2V_PATH = '/run/ai-app/2034955204851933186';
const T2V_PATH = '/run/ai-app/2034994243982336001';
const H3_I2V_PATH = '/run/ai-app/2085687129061019649';
const H3_T2V_PATH = '/run/ai-app/2085682347676102657';
const OSS_IMG =
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p93d-i2v-test/1788607602254_b2eac80c.jpg';
const SKU_10 = 'ltx-2-3-i2v-720-10s';
const OUT = path.join(__dirname, 'phase9-5-b1-ltx-i2v-queue-test-result.json');

const stats = { rh_submit_calls: 0, tests: [] };

function record(name, ok, detail) {
  stats.tests.push({ name, ok, detail });
  console.log(ok ? `[PASS] ${name}` : `[FAIL] ${name}`, detail || '');
}

function assertOssHttps(nodeInfoList) {
  const n = (nodeInfoList || []).find((x) => String(x.nodeId) === '584' && String(x.fieldName) === 'image');
  const v = String(n?.fieldValue || '').trim();
  if (!v || !(v.startsWith('https://') || v.startsWith('http://'))) throw new Error(`bad oss: ${v}`);
  if (/^(openapi|api)\//i.test(v)) throw new Error(`must not be RH fileName: ${v}`);
  return v;
}

function buildLtxI2vForward({
  prompt = 'ltx i2v mock',
  durationSec = '10',
  resolution = '720',
  imageUrl = OSS_IMG,
} = {}) {
  const res = resolution === '1080' ? '1920' : resolution;
  const sku = `ltx-2-3-i2v-${res}-${durationSec}s`;
  const nodeInfoList = [
    { nodeId: '584', fieldName: 'image', fieldValue: imageUrl },
    { nodeId: '593', fieldName: 'value', fieldValue: String(durationSec) },
    { nodeId: '595', fieldName: 'value', fieldValue: String(res) },
    { nodeId: '602', fieldName: 'positive', fieldValue: prompt },
  ];
  assertOssHttps(nodeInfoList);
  return {
    provider: 'runninghub',
    path: I2V_PATH,
    method: 'POST',
    body: { nodeInfoList, instanceType: 'plus', usePersonalQueue: 'false' },
    billingModelId: sku,
    rhRegion: 'cn',
  };
}

async function setBalance(userId, balance) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p95b1.local` });
  } catch (_) {}
  const cur = (await db.getUserById(userId))?.balance ?? 0;
  const delta = balance - cur;
  if (delta === 0) return;
  const op = crypto.randomUUID();
  if (delta > 0) await db.atomicCreditWithReceipt(userId, `ref_${op}`, delta);
  else await db.atomicDebitWithReceipt(userId, `chg_${op}`, -delta);
}

function mockRhOk(pid) {
  return async (forward) => {
    stats.rh_submit_calls += 1;
    return {
      ok: true,
      provider_task_id: pid || `rh_ltxi2v_${crypto.randomUUID()}`,
      data: {},
      rhRegion: forward?.rhRegion || null,
    };
  };
}

async function createQueueTask(userId, forward, model, sku, quoted, nodeData = {}) {
  const r = await handleTasksCreate(
    userId,
    {
      model_id: sku,
      type: 'video',
      execution_mode: 'queue',
      provider_forward_json: forward,
      params: {
        nodeId: 'n1',
        taskKind: 'video',
        model,
        prompt: 'p95b1',
        nxCloudQueueGoldenPath: true,
      },
      nodeData: { model, ...nodeData },
    },
    db,
    { getFinalPrice: () => quoted },
  );
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
      await db.updateSlotReservation(
        reservationId,
        which === 'user' ? { user_slot_held: 1 } : { platform_slot_held: 1 },
      );
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

function gateLtxI2v(input) {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '') !== 'ltx-2.3-i2v') return false;
  const images = Array.isArray(input.images) ? input.images.filter((u) => String(u || '').trim()) : [];
  if (images.length !== 1) return false;
  if (input.directorSpawned === true || input.drama === true) return false;
  return true;
}

async function main() {
  const uid = `${PREFIX}u`;
  try {
    await db.createUserOtpOnly({ userId: uid, email: `${uid}@t.t` });
  } catch (_) {}
  await db.updateUserConcurrencyEntitlement(uid, {
    planId: 'enterprise',
    videoConcurrencyOverride: 5,
    concurrencyOverrideExpiresAt: Date.now() + 7 * 86400000,
  });
  await setBalance(uid, 2000);

  const QUOTED = 8; // mock fixed; live uses OTS

  {
    const fwd = buildLtxI2vForward();
    const pick = pickRunningHubTarget(fwd.path, { regionHint: fwd.rhRegion });
    const img = assertOssHttps(fwd.body.nodeInfoList);
    record(
      'create_forward_shape',
      fwd.rhRegion === 'cn' &&
        fwd.path === I2V_PATH &&
        fwd.body.instanceType === 'plus' &&
        img.startsWith('https://') &&
        pick.region === 'cn',
      { rhRegion: fwd.rhRegion, path: fwd.path, img: img.slice(0, 60), pick: pick.region },
    );
  }

  for (const sec of ['5', '10', '15']) {
    const fwd = buildLtxI2vForward({ durationSec: sec });
    const dur = fwd.body.nodeInfoList.find((n) => n.nodeId === '593');
    record(
      `duration_${sec}s`,
      String(dur?.fieldValue) === sec && fwd.billingModelId === `ltx-2-3-i2v-720-${sec}s`,
      { field: dur?.fieldValue, sku: fwd.billingModelId },
    );
  }

  for (const res of ['720', '1280', '1920']) {
    const fwd = buildLtxI2vForward({ resolution: res });
    const rn = fwd.body.nodeInfoList.find((n) => n.nodeId === '595');
    record(
      `resolution_${res}`,
      String(rn?.fieldValue) === res && fwd.billingModelId === `ltx-2-3-i2v-${res}-10s`,
      { field: rn?.fieldValue, sku: fwd.billingModelId },
    );
  }

  // reject RH fileName / local
  {
    let rejectedRh = false;
    let rejectedLocal = false;
    try {
      buildLtxI2vForward({ imageUrl: 'openapi/x.jpg' });
    } catch {
      rejectedRh = true;
    }
    try {
      buildLtxI2vForward({ imageUrl: 'file:///C:/a.jpg' });
    } catch {
      rejectedLocal = true;
    }
    record('image_must_be_oss_https', rejectedRh && rejectedLocal, { rejectedRh, rejectedLocal });
  }

  // Full success
  {
    const before = stats.rh_submit_calls;
    const bal0 = (await db.getUserById(uid)).balance;
    const fwd = buildLtxI2vForward();
    const tid = await createQueueTask(uid, fwd, 'ltx-2.3-i2v', SKU_10, QUOTED, {
      durationLtx23I2v: '10',
      resolutionLtx23I2v: '720',
    });
    const t0 = await db.getTaskById(tid);
    const stored = JSON.parse(t0.provider_forward_json || '{}');
    record(
      'test_create_queued',
      t0.status === 'queued' &&
        stored.rhRegion === 'cn' &&
        stored.path === I2V_PATH &&
        assertOssHttps(stored.body?.nodeInfoList).startsWith('https://'),
      { status: t0.status, rhRegion: stored.rhRegion },
    );

    const claimed = await promoteUntilClaimed(tid, uid);
    record('test_claim', claimed?.status === 'claimed', { status: claimed?.status });

    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await chargeClaimedTask(tid, db);
    const bal1 = (await db.getUserById(uid)).balance;
    record('test_charge', Number(bal0) - Number(bal1) === QUOTED, {
      delta: Number(bal0) - Number(bal1),
    });

    const d = await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_ltxi2v_single') });
    record('test_dispatch', d.ok === true || d.idempotent === true, {
      pid: (await db.getTaskById(tid))?.provider_task_id,
      submits: stats.rh_submit_calls - before,
    });

    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/ltx-i2v-golden.mp4',
      }),
    });
    const final = await db.getTaskById(tid);
    const pickPoll = pickRunningHubTarget('/query', {
      regionHint: JSON.parse(final.provider_forward_json || '{}').rhRegion,
    });
    record('test_poll_cn', pickPoll.region === 'cn' && final.status === 'success', {
      seen: pickPoll.region,
      status: final.status,
    });
    record(
      'test_success_release',
      final.status === 'success' &&
        !!final.result_oss_url &&
        !final.user_slot_held &&
        !final.platform_slot_held,
      { status: final.status, url: final.result_oss_url, held: final.user_slot_held },
    );

    // Dup dispatch
    const beforeDup = stats.rh_submit_calls;
    for (let i = 0; i < 10; i++) {
      await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('should_not') });
    }
    record('dup_dispatch_one_rh', stats.rh_submit_calls === beforeDup, {
      submits: stats.rh_submit_calls - beforeDup,
    });
  }

  // Dup charge / refund
  {
    const uDup = `${PREFIX}dup`;
    try {
      await db.createUserOtpOnly({ userId: uDup, email: `${uDup}@t.t` });
    } catch (_) {}
    await db.updateUserConcurrencyEntitlement(uDup, {
      planId: 'enterprise',
      videoConcurrencyOverride: 5,
      concurrencyOverrideExpiresAt: Date.now() + 7 * 86400000,
    });
    await setBalance(uDup, 500);
    const fwd = buildLtxI2vForward({ prompt: 'dup' });
    const tid = await createQueueTask(uDup, fwd, 'ltx-2.3-i2v', SKU_10, QUOTED);
    await promoteUntilClaimed(tid, uDup);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    const bal0 = (await db.getUserById(uDup)).balance;
    for (let i = 0; i < 10; i++) await chargeClaimedTask(tid, db);
    const bal1 = (await db.getUserById(uDup)).balance;
    record('dup_charge_once', Number(bal0) - Number(bal1) === QUOTED, {
      delta: Number(bal0) - Number(bal1),
    });

    await dispatchOneChargedTask(tid, db, {
      submitRunningHub: async () => ({
        ok: true,
        provider_task_id: `rh_dup_${crypto.randomUUID()}`,
        data: {},
        rhRegion: 'cn',
      }),
    });
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({ ok: true, status: 'FAILED', error: 'mock' }),
    });
    const bal2 = (await db.getUserById(uDup)).balance;
    for (let i = 0; i < 10; i++) {
      await pollOneProviderTask(tid, db, {
        queryRunningHub: async () => ({ ok: true, status: 'FAILED', error: 'again' }),
      });
    }
    const bal3 = (await db.getUserById(uDup)).balance;
    record('dup_refund_once', Number(bal2) === Number(bal3) && Number(bal2) === Number(bal0), {
      bal0,
      bal2,
      bal3,
    });
  }

  // Submit fail → refund
  {
    const u = `${PREFIX}subfail`;
    try {
      await db.createUserOtpOnly({ userId: u, email: `${u}@t.t` });
    } catch (_) {}
    await db.updateUserConcurrencyEntitlement(u, {
      planId: 'enterprise',
      videoConcurrencyOverride: 5,
      concurrencyOverrideExpiresAt: Date.now() + 7 * 86400000,
    });
    await setBalance(u, 500);
    const bal0 = (await db.getUserById(u)).balance;
    const tid = await createQueueTask(u, buildLtxI2vForward({ prompt: 'subfail' }), 'ltx-2.3-i2v', SKU_10, QUOTED);
    await promoteUntilClaimed(tid, u);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await chargeClaimedTask(tid, db);
    await dispatchOneChargedTask(tid, db, {
      submitRunningHub: async () => ({ ok: false, error: 'SUBMIT_FAIL', rhRegion: 'cn' }),
    });
    const final = await db.getTaskById(tid);
    const bal1 = (await db.getUserById(u)).balance;
    record(
      'submit_fail_refund',
      ['failed', 'cancelled'].includes(String(final?.status)) && Number(bal1) === Number(bal0),
      { status: final?.status, bal0, bal1 },
    );
  }

  // Lease recovery
  {
    const u = `${PREFIX}lease`;
    try {
      await db.createUserOtpOnly({ userId: u, email: `${u}@t.t` });
    } catch (_) {}
    await db.updateUserConcurrencyEntitlement(u, {
      planId: 'enterprise',
      videoConcurrencyOverride: 5,
      concurrencyOverrideExpiresAt: Date.now() + 7 * 86400000,
    });
    await setBalance(u, 200);
    const tid = await createQueueTask(u, buildLtxI2vForward({ prompt: 'lease' }), 'ltx-2.3-i2v', SKU_10, QUOTED);
    await promoteUntilClaimed(tid, u);
    const before = (await db.getTaskById(tid))?.status;
    await db.atomicUnclaimExpiredTask({
      taskId: tid,
      nowMs: Date.now() + 7 * 24 * 3600 * 1000,
    });
    const after = (await db.getTaskById(tid))?.status;
    record('lease_recovery', before === 'claimed' && after === 'queued', { before, after });
  }

  // Gate
  {
    record(
      'gate_on',
      gateLtxI2v({
        nxCloudQueueGoldenPath: true,
        model: 'ltx-2.3-i2v',
        images: [OSS_IMG],
      }) === true,
      { on: true },
    );
    record(
      'gate_off_direct_fallback',
      gateLtxI2v({
        nxCloudQueueGoldenPath: false,
        model: 'ltx-2.3-i2v',
        images: [OSS_IMG],
      }) === false,
      { off: false },
    );
    const vp = fs.readFileSync(
      path.resolve(__dirname, '../../../src/main/ai/providers/VideoProvider.ts'),
      'utf8',
    );
    const hasEarly =
      vp.includes('executeLtx23I2vCloudQueueGoldenPath') &&
      vp.includes('VIDEO_QUEUE_LTX23_I2V_MODEL');
    const queueIdx = vp.indexOf('executeLtx23I2vCloudQueueGoldenPath');
    const directIdx = vp.indexOf('LTX2.3 图生视频：RunningHub ai-app');
    record(
      'gate_on_no_direct_after_queue',
      hasEarly && queueIdx > 0 && directIdx > queueIdx,
      { hasEarly, queueBeforeDirect: queueIdx < directIdx },
    );
  }

  // invalid-forward
  {
    const good = hasValidForwardPath({
      provider_forward_json: JSON.stringify(buildLtxI2vForward()),
    });
    const bad = hasValidForwardPath({ provider_forward_json: '' });
    record('invalid_forward', good === true && bad === false, { good, bad });
  }

  // regression forwards unchanged
  {
    record(
      'regression_paths',
      T2V_PATH !== I2V_PATH && H3_I2V_PATH !== I2V_PATH && H3_T2V_PATH !== I2V_PATH,
      { i2v: I2V_PATH, t2v: T2V_PATH },
    );
  }

  const passed = stats.tests.every((t) => t.ok);
  const report = {
    passed,
    conclusion: passed ? 'PASS' : 'FAIL',
    tests: stats.tests,
    rh_submit_calls: stats.rh_submit_calls,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ conclusion: report.conclusion, failed: stats.tests.filter((t) => !t.ok) }, null, 2));
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
