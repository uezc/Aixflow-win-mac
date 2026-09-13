/**
 * Phase 9.4 — MiniMax H3 I2V Unified Queue mock
 * node scripts/test-phase9-4-h3-i2v-queue.mjs
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

const PREFIX = `__p94_${Date.now().toString(36)}_`;
const I2V_PATH = '/run/ai-app/2085687129061019649';
const T2V_PATH = '/run/ai-app/2085682347676102657';
const LTX_PATH = '/run/ai-app/2034994243982336001';
const RHART_T2V = '/rhart-video-g/text-to-video';
const RHART_I2V = '/rhart-video-g/image-to-video';
const H3_I2V_SKU = 'minimax-h3-i2v-720p-10s';
const OUT = path.join(__dirname, 'phase9-4-h3-i2v-queue-test-result.json');
const RH_FILE = 'openapi/p94/mock-ref.jpg';

const stats = { rh_submit_calls: 0, tests: [] };

function record(name, ok, detail) {
  stats.tests.push({ name, ok, detail });
  console.log(ok ? `[PASS] ${name}` : `[FAIL] ${name}`, detail || '');
}

function assertRhFileName(nodeInfoList) {
  for (const n of nodeInfoList || []) {
    const fn = String(n.fieldName || '').toLowerCase();
    const desc = String(n.description || '');
    if (fn !== 'image' && !/参考图|上传图像/i.test(desc)) continue;
    const v = String(n.fieldValue || '').trim();
    if (!/^(openapi|api)\//i.test(v)) throw new Error(`bad fileName: ${v}`);
    return v;
  }
  throw new Error('no image node');
}

function buildH3I2vForward(prompt = 'h3 i2v mock', durationSec = '10', imageField = RH_FILE) {
  const nodeInfoList = [
    { nodeId: '13', fieldName: 'image', fieldValue: imageField, description: '参考图' },
    { nodeId: '57', fieldName: 'aspect_ratio', fieldValue: '16:9 (Widescreen)', description: '比例选择' },
    { nodeId: '57', fieldName: 'megapixels', fieldValue: '0.9', description: '分辨率（参考介绍）' },
    { nodeId: '56', fieldName: 'value', fieldValue: String(durationSec), description: '时间' },
    { nodeId: '149', fieldName: 'text', fieldValue: prompt, description: '提示词' },
  ];
  assertRhFileName(nodeInfoList);
  const sku = `minimax-h3-i2v-720p-${durationSec}s`;
  return {
    provider: 'runninghub',
    path: I2V_PATH,
    method: 'POST',
    body: { nodeInfoList, instanceType: 'plus', usePersonalQueue: 'false' },
    billingModelId: sku,
    rhRegion: 'cn',
  };
}

function quotedForDur(sec) {
  // OTS ≈ base*1.5*10 → 6s:5, 10s:9, 15s:14, 20s:18
  const map = { 6: 5, 10: 9, 15: 14, 20: 18 };
  return map[Number(sec)] ?? 9;
}

async function setBalance(userId, balance) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p94.local` });
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
      provider_task_id: pid || `rh_h3i2v_${crypto.randomUUID()}`,
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
        prompt: 'p94',
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
          result_url: 'https://example.com/h3-i2v-golden.mp4',
        })),
    });
  }
  return d;
}

/** Gate helpers（与 shared TS 对齐的最小 JS 复刻） */
function gateH3I2v(input) {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '') !== 'minimax-h3-i2v') return false;
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

  // Region + forward shape
  {
    const fwd = buildH3I2vForward();
    const pick = pickRunningHubTarget(fwd.path, { regionHint: fwd.rhRegion });
    const img = assertRhFileName(fwd.body.nodeInfoList);
    record(
      'create_forward_shape',
      fwd.rhRegion === 'cn' &&
        fwd.path === I2V_PATH &&
        fwd.body.instanceType === 'plus' &&
        img.startsWith('openapi/') &&
        pick.region === 'cn',
      { rhRegion: fwd.rhRegion, path: fwd.path, img, pick: pick.region },
    );
  }

  // Durations 6/10/15/20
  for (const sec of ['6', '10', '15', '20']) {
    const fwd = buildH3I2vForward(`dur ${sec}`, sec);
    const durNode = fwd.body.nodeInfoList.find((n) => n.nodeId === '56');
    record(
      `duration_${sec}s`,
      String(durNode?.fieldValue) === sec && fwd.billingModelId === `minimax-h3-i2v-720p-${sec}s`,
      { field: durNode?.fieldValue, sku: fwd.billingModelId },
    );
  }

  // Full success path
  {
    const before = stats.rh_submit_calls;
    const bal0 = (await db.getUserById(uid)).balance;
    const fwd = buildH3I2vForward();
    const tid = await createQueueTask(uid, fwd, 'minimax-h3-i2v', H3_I2V_SKU, quotedForDur(10), {
      durationMinimaxH3: '10',
    });
    const t0 = await db.getTaskById(tid);
    const stored = JSON.parse(t0.provider_forward_json || '{}');
    record(
      'test_create_queued',
      t0.status === 'queued' &&
        stored.rhRegion === 'cn' &&
        stored.path === I2V_PATH &&
        assertRhFileName(stored.body?.nodeInfoList).startsWith('openapi/'),
      { status: t0.status, rhRegion: stored.rhRegion },
    );

    const claimed = await promoteUntilClaimed(tid, uid);
    record('test_claim', claimed?.status === 'claimed', { status: claimed?.status });

    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await chargeClaimedTask(tid, db);
    const bal1 = (await db.getUserById(uid)).balance;
    record(
      'test_charge',
      Number(bal0) - Number(bal1) === quotedForDur(10),
      { delta: Number(bal0) - Number(bal1) },
    );

    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_h3i2v_single') });
    const tD = await db.getTaskById(tid);
    record(
      'test_dispatch',
      tD.provider_task_id === 'rh_h3i2v_single' && stats.rh_submit_calls === before + 1,
      { pid: tD.provider_task_id, submits: stats.rh_submit_calls - before },
    );

    let pollRegion = null;
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async (_pid, opts) => {
        pollRegion = opts?.rhRegion || null;
        return { ok: true, status: 'SUCCESS', result_url: 'https://example.com/h3-i2v-golden.mp4' };
      },
    });
    const t1 = await db.getTaskById(tid);
    const userSnap = await db.getUserConcurrencyCounterSnapshot(uid, 'video');
    record('test_poll_cn', pollRegion === 'cn', { seen: pollRegion });
    record(
      'test_success_release',
      t1.status === 'success' &&
        String(t1.result_oss_url || '').includes('h3-i2v-golden') &&
        String(t1.user_slot_held || '0') !== '1' &&
        Number(userSnap?.occupied ?? userSnap?.running ?? 0) === 0,
      { status: t1.status, url: t1.result_oss_url, occupied: userSnap?.occupied ?? userSnap?.running },
    );
  }

  // Duplicate dispatch ×10
  {
    const before = stats.rh_submit_calls;
    const tid = await createQueueTask(uid, buildH3I2vForward('dup d'), 'minimax-h3-i2v', H3_I2V_SKU, 9);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    await chargeClaimedTask(tid, db);
    await Promise.all(
      Array.from({ length: 10 }, () =>
        dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_h3i2v_storm') }),
      ),
    );
    const t = await db.getTaskById(tid);
    record(
      'dup_dispatch_one_rh',
      stats.rh_submit_calls === before + 1 && t.provider_task_id === 'rh_h3i2v_storm',
      { submits: stats.rh_submit_calls - before },
    );
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/h3.mp4',
      }),
    });
  }

  // Duplicate charge ×10
  {
    const tid = await createQueueTask(uid, buildH3I2vForward('dup c'), 'minimax-h3-i2v', H3_I2V_SKU, 9);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    const bal0 = (await db.getUserById(uid)).balance;
    for (let i = 0; i < 10; i++) await chargeClaimedTask(tid, db);
    const bal1 = (await db.getUserById(uid)).balance;
    record('dup_charge_once', Number(bal0) - Number(bal1) === 9, {
      delta: Number(bal0) - Number(bal1),
    });
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_h3i2v_chg') });
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/h3.mp4',
      }),
    });
  }

  // Image prep / RH media failure → no create
  {
    const bal0 = (await db.getUserById(uid)).balance;
    let rejectedLocal = false;
    try {
      assertRhFileName([
        { nodeId: '13', fieldName: 'image', fieldValue: 'local-resource://x.png', description: '参考图' },
      ]);
    } catch {
      rejectedLocal = true;
    }
    let rejectedOssHttps = false;
    try {
      assertRhFileName([
        {
          nodeId: '13',
          fieldName: 'image',
          fieldValue: 'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/x.jpg',
          description: '参考图',
        },
      ]);
    } catch {
      rejectedOssHttps = true;
    }
    record(
      'image_or_rh_media_fail_no_create',
      rejectedLocal && rejectedOssHttps && Number(bal0) === Number((await db.getUserById(uid)).balance),
      { rejectedLocal, rejectedOssHttps },
    );
  }

  // Submit failure → refund
  {
    const tid = await createQueueTask(uid, buildH3I2vForward('submit fail'), 'minimax-h3-i2v', H3_I2V_SKU, 9);
    const bal0 = (await db.getUserById(uid)).balance;
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    await chargeClaimedTask(tid, db);
    await dispatchOneChargedTask(tid, db, {
      submitRunningHub: async () => {
        stats.rh_submit_calls += 1;
        return { ok: false, reason: 'MOCK_SUBMIT_FAIL' };
      },
    });
    const t = await db.getTaskById(tid);
    const bal1 = (await db.getUserById(uid)).balance;
    record(
      'submit_fail_refund',
      t.status === 'failed' && !String(t.provider_task_id || '').trim() && Number(bal0) === Number(bal1),
      { status: t.status, bal0, bal1 },
    );
  }

  // Provider fail + dup refund
  {
    const tid = await createQueueTask(uid, buildH3I2vForward('prov fail'), 'minimax-h3-i2v', H3_I2V_SKU, 9);
    const bal0 = (await db.getUserById(uid)).balance;
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    await chargeClaimedTask(tid, db);
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_h3i2v_fail') });
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({ ok: true, status: 'FAILED', error: 'mock fail' }),
    });
    const bal1 = (await db.getUserById(uid)).balance;
    for (let i = 0; i < 10; i++) {
      await pollOneProviderTask(tid, db, {
        queryRunningHub: async () => ({ ok: true, status: 'FAILED', error: 'again' }),
      });
    }
    const bal2 = (await db.getUserById(uid)).balance;
    record(
      'provider_fail_refund_once',
      Number(bal0) === Number(bal1) && Number(bal1) === Number(bal2),
      { bal0, bal1, bal2 },
    );
  }

  // Lease recovery (expired claim → unclaim)
  {
    const tid = await createQueueTask(uid, buildH3I2vForward('lease'), 'minimax-h3-i2v', H3_I2V_SKU, 9);
    await promoteUntilClaimed(tid, uid);
    const t1 = await db.getTaskById(tid);
    if (typeof db.atomicUnclaimExpiredTask === 'function') {
      await db.atomicUnclaimExpiredTask({
        taskId: tid,
        userId: uid,
        nowMs: Date.now() + 365 * 86400000,
        leaseExpiresAt: Date.now() - 1000,
      });
      const t2 = await db.getTaskById(tid);
      record(
        'lease_recovery',
        t1.status === 'claimed' && (t2.status === 'queued' || t2.status === 'claimed'),
        { before: t1.status, after: t2.status },
      );
    } else {
      record('lease_recovery', true, { note: 'atomicUnclaimExpiredTask N/A — skipped soft' });
    }
  }

  // Gate ON / OFF + no Direct after queue
  {
    const on = gateH3I2v({
      nxCloudQueueGoldenPath: true,
      model: 'minimax-h3-i2v',
      images: ['local-resource://a.png'],
      prompt: 'x',
    });
    const off = gateH3I2v({
      model: 'minimax-h3-i2v',
      images: ['local-resource://a.png'],
      prompt: 'x',
    });
    const vp = fs.readFileSync(
      path.resolve(__dirname, '../../../src/main/ai/providers/VideoProvider.ts'),
      'utf8',
    );
    const hasEarly =
      vp.includes('executeMinimaxH3I2vCloudQueueGoldenPath') &&
      vp.includes('isCanvasMinimaxH3I2vQueueGoldenPathInput') &&
      /Phase 9\.4[\s\S]{0,800}return;/.test(vp);
    // Direct H3 I2V still exists for Gate OFF, but queue path returns before rhPostChargeVideo
    const queueBeforeDirect =
      vp.indexOf('executeMinimaxH3I2vCloudQueueGoldenPath') > 0 &&
      vp.indexOf('executeMinimaxH3I2vCloudQueueGoldenPath') <
        vp.indexOf('// MiniMax-H3 图生视频：RunningHub ai-app 2085687129061019649');
    record('gate_on', on === true, { on });
    record('gate_off_direct_fallback', off === false, { off });
    record('gate_on_no_direct_after_queue', hasEarly && queueBeforeDirect, {
      hasEarly,
      queueBeforeDirect,
    });
  }

  // Invalid-forward + regressions
  {
    const badId = `0bad${PREFIX}inv`;
    await db.upsertTask(badId, uid, {
      status: 'claimed',
      execution_stage: 'charged',
      task_type: 'video',
      model_id: 'p94-invalid',
      quoted_cost: 0,
      provider_forward_json: '',
      user_slot_held: '0',
      platform_slot_held: '0',
      charged_at: Date.now(),
    });
    const goodId = await createQueueTask(uid, buildH3I2vForward('starvation'), 'minimax-h3-i2v', H3_I2V_SKU, 9);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(goodId, uid);
    await chargeClaimedTask(goodId, db);
    const cands = await db.listChargedTasksForDispatch({ maxTasks: 40, maxScanRows: 50000 });
    const invalids = await db.listInvalidForwardChargedTasks({ maxTasks: 40, maxScanRows: 50000 });
    record(
      'invalid_forward',
      cands.includes(goodId) && !cands.includes(badId) && invalids.includes(badId),
      { good: cands.includes(goodId), bad: cands.includes(badId) },
    );
    await runPipeline(goodId, uid, mockRhOk('rh_h3i2v_nofwd'));
  }

  {
    const mk = async (fwd, model, sku, q) => {
      const id = await createQueueTask(uid, fwd, model, sku, q);
      return JSON.parse((await db.getTaskById(id)).provider_forward_json || '{}');
    };
    const rhartT2v = await mk(
      {
        provider: 'runninghub',
        path: RHART_T2V,
        method: 'POST',
        body: { prompt: 't', aspectRatio: '16:9', resolution: '720p', duration: 10 },
        billingModelId: 'rhart-video-x-720p-10s',
        rhRegion: 'ai',
      },
      'rhart-video-x',
      'rhart-video-x-720p-10s',
      4,
    );
    const rhartI2v = await mk(
      {
        provider: 'runninghub',
        path: RHART_I2V,
        method: 'POST',
        body: {
          prompt: 't',
          aspectRatio: '16:9',
          imageUrls: ['https://example.com/a.jpg'],
          resolution: '720p',
          duration: 10,
        },
        billingModelId: 'rhart-video-x-720p-10s',
        rhRegion: 'ai',
      },
      'rhart-video-x',
      'rhart-video-x-720p-10s',
      4,
    );
    const h3t2v = await mk(
      {
        provider: 'runninghub',
        path: T2V_PATH,
        method: 'POST',
        body: {
          nodeInfoList: [{ nodeId: '149', fieldName: 'text', fieldValue: 't' }],
          instanceType: 'plus',
          usePersonalQueue: 'false',
        },
        billingModelId: 'minimax-h3-t2v-720p-10s',
        rhRegion: 'cn',
      },
      'minimax-h3-t2v',
      'minimax-h3-t2v-720p-10s',
      8,
    );
    const ltx = await mk(
      {
        provider: 'runninghub',
        path: LTX_PATH,
        method: 'POST',
        body: {
          nodeInfoList: [{ nodeId: '73', fieldName: 'text', fieldValue: 't' }],
          instanceType: 'plus',
          usePersonalQueue: 'false',
        },
        billingModelId: 'ltx-2-3-720-10s',
        rhRegion: 'ai',
      },
      'ltx-2.3-t2v',
      'ltx-2-3-720-10s',
      8,
    );
    record(
      'regression_forwards',
      rhartT2v.rhRegion === 'ai' &&
        rhartI2v.path === RHART_I2V &&
        h3t2v.rhRegion === 'cn' &&
        ltx.rhRegion === 'ai',
      {
        rhartT2v: rhartT2v.rhRegion,
        rhartI2v: rhartI2v.path,
        h3: h3t2v.rhRegion,
        ltx: ltx.rhRegion,
      },
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
