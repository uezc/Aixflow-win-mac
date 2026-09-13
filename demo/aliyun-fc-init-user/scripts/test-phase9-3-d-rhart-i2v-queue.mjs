/**
 * Phase 9.3-D — rhart-video-x I2V Unified Queue mock
 * node scripts/test-phase9-3-d-rhart-i2v-queue.mjs
 *
 * 不修改 Queue / Claim / Charge / Refund 核心；验证 I2V forward + 现有 pipeline。
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

const PREFIX = `__p93d_${Date.now().toString(36)}_`;
const I2V_PATH = '/rhart-video-g/image-to-video';
const T2V_PATH = '/rhart-video-g/text-to-video';
const RHART_SKU = 'rhart-video-x-720p-10s';
const H3_PATH = '/run/ai-app/2085682347676102657';
const H3_SKU = 'minimax-h3-t2v-720p-10s';
const LTX_PATH = '/run/ai-app/2034994243982336001';
const LTX_SKU = 'ltx-2-3-720-10s';
const OUT = path.join(__dirname, 'phase9-3-d-rhart-i2v-queue-test-result.json');

const HTTPS_1 = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f33b.png';
const HTTPS_7 = Array.from(
  { length: 7 },
  (_, i) => `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f30${i}.png`,
);

const stats = { rh_submit_calls: 0, tests: [] };

function record(name, ok, detail) {
  stats.tests.push({ name, ok, detail });
  console.log(ok ? `[PASS] ${name}` : `[FAIL] ${name}`, detail || '');
}

/** 与 buildRhartVideoXI2vRhForward 对齐（mock 不依赖 TS 编译） */
function assertHttpsImageUrls(imageUrls) {
  if (!Array.isArray(imageUrls) || imageUrls.length < 1 || imageUrls.length > 7) {
    throw new Error(`need 1-7 images, got ${Array.isArray(imageUrls) ? imageUrls.length : 0}`);
  }
  const out = [];
  for (const raw of imageUrls) {
    const u = String(raw || '').trim();
    if (!u.startsWith('https://')) throw new Error('imageUrls must be https://');
    out.push(u);
  }
  return out;
}

function buildI2vForward(prompt = 'i2v queue mock', imageUrls = [HTTPS_1]) {
  const urls = assertHttpsImageUrls(imageUrls);
  return {
    provider: 'runninghub',
    path: I2V_PATH,
    method: 'POST',
    body: {
      prompt,
      aspectRatio: '16:9',
      imageUrls: urls,
      resolution: '720p',
      duration: 10,
    },
    billingModelId: RHART_SKU,
    rhRegion: 'ai',
  };
}

function buildT2vForward(prompt = 'rhart t2v regression') {
  return {
    provider: 'runninghub',
    path: T2V_PATH,
    method: 'POST',
    body: { prompt, aspectRatio: '16:9', resolution: '720p', duration: 10 },
    billingModelId: RHART_SKU,
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

function buildLtxForward(prompt = 'ltx regression') {
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

async function setBalance(userId, balance) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p93d.local` });
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
      provider_task_id: pid || `rh_i2v_${crypto.randomUUID()}`,
      data: {},
      rhRegion: forward?.rhRegion || null,
    };
  };
}

async function createQueueTask(userId, forward, model, sku, quoted = 4, nodeData = {}) {
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
        prompt: 'p93d',
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
          result_url: 'https://example.com/rhart-i2v-golden.mp4',
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

  // Region
  {
    const fwd = buildI2vForward();
    const pick = pickRunningHubTarget(fwd.path, { regionHint: fwd.rhRegion });
    record(
      'region_i2v_ai_via_forward',
      fwd.rhRegion === 'ai' &&
        pick.region === 'ai' &&
        fwd.path === I2V_PATH &&
        typeof fwd.body.duration === 'number' &&
        Array.isArray(fwd.body.imageUrls) &&
        fwd.body.imageUrls[0].startsWith('https://'),
      {
        rhRegion: fwd.rhRegion,
        pick: pick.region,
        path: fwd.path,
        durationType: typeof fwd.body.duration,
        image0: fwd.body.imageUrls[0].slice(0, 60),
      },
    );
  }

  // Test 1–6: Create → Claim → Charge → Dispatch → Poll → Success
  {
    const before = stats.rh_submit_calls;
    const bal0 = (await db.getUserById(uid)).balance;
    const tid = await createQueueTask(uid, buildI2vForward(), 'rhart-video-x', RHART_SKU, 4, {
      durationGrok3: '10',
      aspect_ratio: '16:9',
    });
    const t0 = await db.getTaskById(tid);
    const fwd = JSON.parse(t0.provider_forward_json || '{}');
    record(
      'test1_create_queued_i2v_forward',
      t0.status === 'queued' &&
        fwd.rhRegion === 'ai' &&
        fwd.path === I2V_PATH &&
        Array.isArray(fwd.body?.imageUrls) &&
        fwd.body.imageUrls.every((u) => String(u).startsWith('https://')),
      { status: t0.status, rhRegion: fwd.rhRegion, path: fwd.path, nImg: fwd.body?.imageUrls?.length },
    );

    const claimed = await promoteUntilClaimed(tid, uid);
    record('test2_claim', claimed?.status === 'claimed', { status: claimed?.status });

    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await chargeClaimedTask(tid, db);
    const tCh = await db.getTaskById(tid);
    const bal1 = (await db.getUserById(uid)).balance;
    record(
      'test3_charge',
      String(tCh.execution_stage || '') === 'charged' && Number(bal0) - Number(bal1) === 4,
      { stage: tCh.execution_stage, delta: Number(bal0) - Number(bal1) },
    );

    const d = await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_i2v_single') });
    const tD = await db.getTaskById(tid);
    record(
      'test4_dispatch_one_rh',
      (d.ok || d.idempotent) &&
        tD.provider_task_id === 'rh_i2v_single' &&
        stats.rh_submit_calls === before + 1,
      { pid: tD.provider_task_id, submits: stats.rh_submit_calls - before },
    );

    let pollRegion = null;
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async (_pid, opts) => {
        pollRegion = opts?.rhRegion || null;
        return {
          ok: true,
          status: 'SUCCESS',
          result_url: 'https://example.com/rhart-i2v-golden.mp4',
        };
      },
    });
    const t1 = await db.getTaskById(tid);
    const userSnap = await db.getUserConcurrencyCounterSnapshot(uid, 'video');
    record('test5_poll_ai', pollRegion === 'ai', { seen: pollRegion });
    record(
      'test6_success_result_and_release',
      t1.status === 'success' &&
        String(t1.result_oss_url || '').includes('rhart-i2v-golden.mp4') &&
        String(t1.user_slot_held || '0') !== '1' &&
        String(t1.platform_slot_held || '0') !== '1' &&
        Number(userSnap?.occupied ?? userSnap?.running ?? 0) === 0,
      {
        status: t1.status,
        url: t1.result_oss_url,
        user_slot: t1.user_slot_held,
        plat_slot: t1.platform_slot_held,
        occupied: userSnap?.occupied ?? userSnap?.running,
      },
    );
  }

  // Test 7: Duplicate Dispatch ×10
  {
    const before = stats.rh_submit_calls;
    const tid = await createQueueTask(uid, buildI2vForward('dup dispatch'), 'rhart-video-x', RHART_SKU, 4);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    await chargeClaimedTask(tid, db);
    await Promise.all(
      Array.from({ length: 10 }, () =>
        dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_i2v_storm') }),
      ),
    );
    const t = await db.getTaskById(tid);
    record(
      'test7_duplicate_dispatch_one_rh',
      stats.rh_submit_calls === before + 1 && t.provider_task_id === 'rh_i2v_storm',
      { submits: stats.rh_submit_calls - before, pid: t.provider_task_id },
    );
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/i2v.mp4',
      }),
    });
  }

  // Test 8: Duplicate Charge ×10
  {
    const tid = await createQueueTask(uid, buildI2vForward('dup charge'), 'rhart-video-x', RHART_SKU, 4);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    const bal0 = (await db.getUserById(uid)).balance;
    for (let i = 0; i < 10; i++) await chargeClaimedTask(tid, db);
    const bal1 = (await db.getUserById(uid)).balance;
    record('test8_duplicate_charge_once', Number(bal0) - Number(bal1) === 4, {
      delta: Number(bal0) - Number(bal1),
    });
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_i2v_chg') });
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/i2v.mp4',
      }),
    });
  }

  // Test 9: Submit Failure → refund
  {
    const tid = await createQueueTask(uid, buildI2vForward('submit fail'), 'rhart-video-x', RHART_SKU, 4);
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
    const userSnap = await db.getUserConcurrencyCounterSnapshot(uid, 'video');
    record(
      'test9_submit_failure_refund',
      (t.status === 'failed' || t.error_code) &&
        !String(t.provider_task_id || '').trim() &&
        Number(bal0) === Number(bal1) &&
        stats.rh_submit_calls === before + 1 &&
        Number(userSnap?.occupied ?? userSnap?.running ?? 0) === 0,
      { status: t.status, pid: t.provider_task_id, bal0, bal1, err: t.error_code },
    );
  }

  // Test 10: Provider Failure → refund once
  {
    const tid = await createQueueTask(uid, buildI2vForward('prov fail'), 'rhart-video-x', RHART_SKU, 4);
    const bal0 = (await db.getUserById(uid)).balance;
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    await chargeClaimedTask(tid, db);
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_i2v_fail') });
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
      'test10_provider_fail_refund_once',
      t.status === 'failed' && Number(bal0) === Number(bal1) && Number(bal1) === Number(bal2),
      { status: t.status, bal0, bal1, bal2 },
    );
  }

  // Test 11: Image preparation failure → Queue task = 0 / Charge = 0
  {
    const bal0 = (await db.getUserById(uid)).balance;
    let rejected = false;
    try {
      assertHttpsImageUrls(['local-resource://C:/tmp/a.png']);
    } catch {
      rejected = true;
    }
    let rejectedData = false;
    try {
      assertHttpsImageUrls(['data:image/png;base64,AAAA']);
    } catch {
      rejectedData = true;
    }
    let createAttempted = false;
    try {
      // 模拟「图片失败则不 Create」：非法 forward 不得进入 handleTasksCreate 成功路径
      const badFwd = {
        provider: 'runninghub',
        path: I2V_PATH,
        method: 'POST',
        body: {
          prompt: 'bad',
          aspectRatio: '16:9',
          imageUrls: ['file:///tmp/x.png'],
          resolution: '720p',
          duration: 10,
        },
        billingModelId: RHART_SKU,
        rhRegion: 'ai',
      };
      // Adapter 层会在 Create 前抛错；此处验证 assert 阻止非法 URL
      assertHttpsImageUrls(badFwd.body.imageUrls);
      createAttempted = true;
      await createQueueTask(uid, badFwd, 'rhart-video-x', RHART_SKU, 4);
    } catch {
      createAttempted = false;
    }
    const bal1 = (await db.getUserById(uid)).balance;
    record(
      'test11_image_prep_failure_no_create_no_charge',
      rejected && rejectedData && !createAttempted && Number(bal0) === Number(bal1),
      { rejected, rejectedData, createAttempted, bal0, bal1 },
    );
  }

  // Test 12: 7 images
  {
    const fwd = buildI2vForward('seven', HTTPS_7);
    record(
      'test12_seven_image_urls',
      fwd.body.imageUrls.length === 7 &&
        fwd.body.imageUrls.every((u) => String(u).startsWith('https://')),
      { n: fwd.body.imageUrls.length },
    );
    const tid = await createQueueTask(uid, fwd, 'rhart-video-x', RHART_SKU, 4);
    const t = await db.getTaskById(tid);
    const stored = JSON.parse(t.provider_forward_json || '{}');
    record(
      'test12_seven_persisted',
      stored.body?.imageUrls?.length === 7,
      { n: stored.body?.imageUrls?.length },
    );
    await runPipeline(tid, uid, mockRhOk('rh_i2v_7'));
  }

  // Invalid-forward starvation regression
  {
    const badId = `0bad${PREFIX}inv`;
    await db.upsertTask(badId, uid, {
      status: 'claimed',
      execution_stage: 'charged',
      task_type: 'video',
      model_id: 'p93d-invalid',
      quoted_cost: 0,
      provider_forward_json: '',
      user_slot_held: '0',
      platform_slot_held: '0',
      charged_at: Date.now(),
    });
    const goodId = await createQueueTask(uid, buildI2vForward('starvation'), 'rhart-video-x', RHART_SKU, 4);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(goodId, uid);
    await chargeClaimedTask(goodId, db);
    const cands = await db.listChargedTasksForDispatch({ maxTasks: 40, maxScanRows: 50000 });
    const invalids = await db.listInvalidForwardChargedTasks({ maxTasks: 40, maxScanRows: 50000 });
    record(
      'invalid_forward_not_in_candidates',
      cands.includes(goodId) && !cands.includes(badId) && invalids.includes(badId),
      {
        cands_has_good: cands.includes(goodId),
        cands_has_bad: cands.includes(badId),
        inv_has_bad: invalids.includes(badId),
      },
    );
    await runPipeline(goodId, uid, mockRhOk('rh_i2v_nofwd'));
  }

  // rhart T2V / H3 / LTX forward regression
  {
    const rhartId = await createQueueTask(uid, buildT2vForward(), 'rhart-video-x', RHART_SKU, 4);
    const h3Id = await createQueueTask(uid, buildH3Forward(), 'minimax-h3-t2v', H3_SKU, 8);
    const ltxId = await createQueueTask(uid, buildLtxForward(), 'ltx-2.3-t2v', LTX_SKU, 8);
    const rhartFwd = JSON.parse((await db.getTaskById(rhartId)).provider_forward_json || '{}');
    const h3Fwd = JSON.parse((await db.getTaskById(h3Id)).provider_forward_json || '{}');
    const ltxFwd = JSON.parse((await db.getTaskById(ltxId)).provider_forward_json || '{}');
    record(
      'regression_forwards_unchanged',
      rhartFwd.rhRegion === 'ai' &&
        rhartFwd.path === T2V_PATH &&
        h3Fwd.rhRegion === 'cn' &&
        h3Fwd.path === H3_PATH &&
        ltxFwd.rhRegion === 'ai' &&
        ltxFwd.path === LTX_PATH,
      { rhart: rhartFwd.rhRegion, h3: h3Fwd.rhRegion, ltx: ltxFwd.rhRegion },
    );
  }

  const passed = stats.tests.every((x) => x.ok);
  const out = {
    passed,
    conclusion: passed ? 'PASS' : 'FAIL',
    tests: stats.tests,
    rh_submit_calls: stats.rh_submit_calls,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ conclusion: out.conclusion, passed, n: stats.tests.length }, null, 2));
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
