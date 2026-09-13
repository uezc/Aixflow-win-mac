/**
 * Phase 9.3-B — LTX 2.3 T2V Unified Queue mock
 * node scripts/test-phase9-3-b-ltx-t2v-queue.mjs
 *
 * 不修改 Queue / Claim / Charge / Refund 核心；仅验证 LTX forward + 现有 pipeline。
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

const PREFIX = `__p93b_${Date.now().toString(36)}_`;
const LTX_PATH = '/run/ai-app/2034994243982336001';
const LTX_SKU = 'ltx-2-3-720-10s';
const H3_PATH = '/run/ai-app/2085682347676102657';
const H3_SKU = 'minimax-h3-t2v-720p-10s';
const OUT = path.join(__dirname, 'phase9-3-b-ltx-t2v-queue-test-result.json');

const stats = { rh_submit_calls: 0, tests: [] };

function record(name, ok, detail) {
  stats.tests.push({ name, ok, detail });
  console.log(ok ? `[PASS] ${name}` : `[FAIL] ${name}`, detail || '');
}

function buildLtxForward(prompt = 'ltx queue mock') {
  return {
    provider: 'runninghub',
    path: LTX_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '43', fieldName: 'value', fieldValue: '1280' },
        { nodeId: '44', fieldName: 'value', fieldValue: '720' },
        { nodeId: '74', fieldName: 'value', fieldValue: '10' },
        { nodeId: '73', fieldName: 'text', fieldValue: prompt },
      ],
      instanceType: 'plus',
      usePersonalQueue: 'false',
    },
    billingModelId: LTX_SKU,
    rhRegion: 'ai',
  };
}

function buildH3Forward(prompt = 'h3 regression') {
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
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p93b.local` });
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
      provider_task_id: pid || `rh_ltx_${crypto.randomUUID()}`,
      data: {},
      rhRegion: forward?.rhRegion || null,
    };
  };
}

async function createQueueTask(userId, forward, model, sku, quoted = 8, nodeData = {}) {
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
        prompt: 'p93b',
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
          result_url: 'https://example.com/ltx-golden.mp4',
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
    videoConcurrencyOverride: 5,
    concurrencyOverrideExpiresAt: Date.now() + 7 * 86400000,
  });
  await setBalance(uid, 1000);

  // Region: LTX forward.rhRegion=ai must pick .ai (without changing global overseas table)
  {
    const ltx = buildLtxForward();
    const pick = pickRunningHubTarget(ltx.path, { regionHint: ltx.rhRegion });
    const dur = ltx.body.nodeInfoList.find((n) => n.nodeId === '74')?.fieldValue;
    record(
      'region_ltx_ai_via_forward',
      ltx.rhRegion === 'ai' && pick.region === 'ai' && typeof dur === 'string' && dur === '10',
      { rhRegion: ltx.rhRegion, pick: pick.region, path: ltx.path, duration: dur },
    );
  }

  // Create + full success
  {
    const before = stats.rh_submit_calls;
    const tid = await createQueueTask(uid, buildLtxForward(), 'ltx-2.3-t2v', LTX_SKU, 8, {
      durationLtx23T2v: '10',
      resolutionLtx23T2v: '720',
      aspect_ratio: '16:9',
    });
    const t0 = await db.getTaskById(tid);
    const fwd = JSON.parse(t0.provider_forward_json || '{}');
    record(
      'create_queued_ltx_forward',
      t0.status === 'queued' && fwd.rhRegion === 'ai' && fwd.path === LTX_PATH,
      { status: t0.status, rhRegion: fwd.rhRegion, path: fwd.path },
    );
    await runPipeline(tid, uid, mockRhOk('rh_ltx_single'));
    const t1 = await db.getTaskById(tid);
    const u1 = await db.getUserById(uid);
    const userSnap = await db.getUserConcurrencyCounterSnapshot(uid, 'video');
    record(
      'full_pipeline_success',
      t1.status === 'success' &&
        t1.provider_task_id === 'rh_ltx_single' &&
        Number(u1.balance) === 992 &&
        stats.rh_submit_calls === before + 1 &&
        String(t1.user_slot_held || '0') !== '1' &&
        Number(userSnap?.occupied ?? userSnap?.running ?? 0) === 0,
      {
        status: t1.status,
        pid: t1.provider_task_id,
        balance: u1.balance,
        submits: stats.rh_submit_calls - before,
        user_slot: t1.user_slot_held,
        occupied: userSnap?.occupied ?? userSnap?.running,
        url: t1.result_oss_url,
      },
    );
  }

  // Duplicate charge ×10
  {
    const tid = await createQueueTask(uid, buildLtxForward('dup charge'), 'ltx-2.3-t2v', LTX_SKU, 8);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    const bal0 = (await db.getUserById(uid)).balance;
    for (let i = 0; i < 10; i++) await chargeClaimedTask(tid, db);
    const bal1 = (await db.getUserById(uid)).balance;
    record(
      'duplicate_charge_once',
      Number(bal0) - Number(bal1) === 8,
      { delta: Number(bal0) - Number(bal1) },
    );
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_ltx_chg') });
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/ltx.mp4',
      }),
    });
  }

  // Duplicate dispatch ×10
  {
    const before = stats.rh_submit_calls;
    const tid = await createQueueTask(uid, buildLtxForward('dup dispatch'), 'ltx-2.3-t2v', LTX_SKU, 8);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    await chargeClaimedTask(tid, db);
    await Promise.all(
      Array.from({ length: 10 }, () =>
        dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_ltx_storm') }),
      ),
    );
    const t = await db.getTaskById(tid);
    record(
      'duplicate_dispatch_one_rh',
      stats.rh_submit_calls === before + 1 && t.provider_task_id === 'rh_ltx_storm',
      { submits: stats.rh_submit_calls - before, pid: t.provider_task_id },
    );
    let pollRegion = null;
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async (_pid, opts) => {
        pollRegion = opts?.rhRegion || null;
        return { ok: true, status: 'SUCCESS', result_url: 'https://example.com/ltx.mp4' };
      },
    });
    record('poll_rhRegion_ai', pollRegion === 'ai', { seen: pollRegion });
  }

  // Submit failure → no RH task / refund path via fail
  {
    const tid = await createQueueTask(uid, buildLtxForward('submit fail'), 'ltx-2.3-t2v', LTX_SKU, 8);
    const bal0 = (await db.getUserById(uid)).balance;
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    await chargeClaimedTask(tid, db);
    const before = stats.rh_submit_calls;
    await dispatchOneChargedTask(tid, db, {
      submitRunningHub: async () => {
        stats.rh_submit_calls += 1;
        return { ok: false, reason: 'MOCK_SUBMIT_FAIL' };
      },
    });
    const t = await db.getTaskById(tid);
    const bal1 = (await db.getUserById(uid)).balance;
    record(
      'submit_failure_refund',
      (t.status === 'failed' || t.error_code) &&
        !String(t.provider_task_id || '').trim() &&
        Number(bal0) === Number(bal1) &&
        stats.rh_submit_calls === before + 1,
      { status: t.status, pid: t.provider_task_id, bal0, bal1, err: t.error_code },
    );
  }

  // Provider failure + duplicate refund
  {
    const tid = await createQueueTask(uid, buildLtxForward('prov fail'), 'ltx-2.3-t2v', LTX_SKU, 8);
    const bal0 = (await db.getUserById(uid)).balance;
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    await chargeClaimedTask(tid, db);
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_ltx_fail') });
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({ ok: true, status: 'FAILED', error: 'mock fail' }),
    });
    const bal1 = (await db.getUserById(uid)).balance;
    for (let i = 0; i < 10; i++) {
      await pollOneProviderTask(tid, db, {
        queryRunningHub: async () => ({ ok: true, status: 'FAILED', error: 'mock fail again' }),
      });
    }
    const bal2 = (await db.getUserById(uid)).balance;
    const t = await db.getTaskById(tid);
    record(
      'provider_fail_refund_once',
      t.status === 'failed' && Number(bal0) === Number(bal1) && Number(bal1) === Number(bal2),
      { status: t.status, bal0, bal1, bal2 },
    );
  }

  // Invalid-forward starvation regression (candidate filter)
  {
    const badId = `0bad${PREFIX}inv`;
    await db.upsertTask(badId, uid, {
      status: 'claimed',
      execution_stage: 'charged',
      task_type: 'video',
      model_id: 'p93b-invalid',
      quoted_cost: 0,
      provider_forward_json: '',
      user_slot_held: '0',
      platform_slot_held: '0',
      charged_at: Date.now(),
    });
    const goodId = await createQueueTask(uid, buildLtxForward('starvation'), 'ltx-2.3-t2v', LTX_SKU, 8);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(goodId, uid);
    await chargeClaimedTask(goodId, db);
    const cands = await db.listChargedTasksForDispatch({ maxTasks: 40, maxScanRows: 50000 });
    const invalids = await db.listInvalidForwardChargedTasks({ maxTasks: 40, maxScanRows: 50000 });
    record(
      'invalid_forward_not_in_candidates',
      cands.includes(goodId) && !cands.includes(badId) && invalids.includes(badId),
      { cands_has_good: cands.includes(goodId), cands_has_bad: cands.includes(badId), inv_has_bad: invalids.includes(badId) },
    );
    await runPipeline(goodId, uid, mockRhOk('rh_ltx_nofwd'));
  }

  // rhart / H3 region regression (mock create only)
  {
    const rhartId = await createQueueTask(uid, buildRhartForward(), 'rhart-video-x', 'rhart-video-x-720p-10s', 4);
    const h3Id = await createQueueTask(uid, buildH3Forward(), 'minimax-h3-t2v', H3_SKU, 8);
    const rhartFwd = JSON.parse((await db.getTaskById(rhartId)).provider_forward_json || '{}');
    const h3Fwd = JSON.parse((await db.getTaskById(h3Id)).provider_forward_json || '{}');
    record(
      'rhart_h3_forward_unchanged',
      rhartFwd.rhRegion === 'ai' &&
        rhartFwd.path === '/rhart-video-g/text-to-video' &&
        h3Fwd.rhRegion === 'cn' &&
        h3Fwd.path === H3_PATH,
      { rhart: rhartFwd.rhRegion, h3: h3Fwd.rhRegion },
    );
  }

  const passed = stats.tests.every((x) => x.ok);
  const out = { passed, conclusion: passed ? 'PASS' : 'FAIL', tests: stats.tests, rh_submit_calls: stats.rh_submit_calls };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ conclusion: out.conclusion, passed, n: stats.tests.length }, null, 2));
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
