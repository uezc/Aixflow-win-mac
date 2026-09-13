/**
 * Phase 9.5-B-5-B — LTX 2.3 LipSync Unified Queue mock
 * node scripts/test-phase9-5-b5-ltx-lipsync-queue.mjs
 *
 * 不修改 Queue / Claim / Charge / Refund 核心；验证 lipsync forward（图+音 OSS HTTPS，rhRegion=cn）。
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

const PREFIX = `__p95b5_${Date.now().toString(36)}_`;
const LIPSYNC_PATH = '/run/ai-app/2029400959335534594';
const I2V_PATH = '/run/ai-app/2034955204851933186';
const START_END_PATH = '/run/ai-app/2048742865043460098';
const OSS_IMG =
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p93d-i2v-test/1788607602254_b2eac80c.jpg';
const OSS_AUD =
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p95b5-lipsync-test/sample-audio.mp3';
const SKU_720 = 'ltx-2-3-lipsync-720';
const OUT = path.join(__dirname, 'phase9-5-b5-ltx-lipsync-queue-test-result.json');

const stats = { rh_submit_calls: 0, tests: [] };

function record(name, ok, detail) {
  stats.tests.push({ name, ok, detail });
  console.log(ok ? `[PASS] ${name}` : `[FAIL] ${name}`, detail || '');
}

function assertNode(list, nodeId, fieldName) {
  const n = (list || []).find(
    (x) => String(x.nodeId) === String(nodeId) && String(x.fieldName) === String(fieldName),
  );
  return String(n?.fieldValue || '').trim();
}

function buildLtxLipsyncForward({
  prompt = '正在讲解，有一些手势动作',
  resolution = '720',
  imageUrl = OSS_IMG,
  audioUrl = OSS_AUD,
} = {}) {
  const res = resolution === '720' || resolution === '1280' || resolution === '1920' ? resolution : '720';
  const sku = `ltx-2-3-lipsync-${res}`;
  if (!String(imageUrl).startsWith('https://')) throw new Error(`image must https: ${imageUrl}`);
  if (!String(audioUrl).startsWith('https://')) throw new Error(`audio must https: ${audioUrl}`);
  if (/^(openapi|api)\//i.test(imageUrl) || /^(openapi|api)\//i.test(audioUrl)) {
    throw new Error('must not be RH Media fileName');
  }
  if (/^(file:|data:|blob:|local-resource:)/i.test(imageUrl) || /^(file:|data:|blob:|local-resource:)/i.test(audioUrl)) {
    throw new Error('local/data forbidden');
  }
  return {
    provider: 'runninghub',
    path: LIPSYNC_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '50', fieldName: 'image', fieldValue: imageUrl },
        { nodeId: '37', fieldName: 'audio', fieldValue: audioUrl },
        { nodeId: '54', fieldName: 'value', fieldValue: prompt },
        { nodeId: '187', fieldName: 'value', fieldValue: String(res) },
      ],
      instanceType: 'plus',
      usePersonalQueue: 'false',
    },
    billingModelId: sku,
    rhRegion: 'cn',
  };
}

function gateLipsync(input) {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '') !== 'ltx-2.3-lipsync') return false;
  const images = Array.isArray(input.images) ? input.images.filter((u) => String(u || '').trim()) : [];
  if (images.length !== 1) return false;
  if (!String(input.inputAudioUrl || '').trim()) return false;
  if (input.directorSpawned === true || input.drama === true) return false;
  return true;
}

async function setBalance(userId, balance) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p95b5.local` });
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
      provider_task_id: pid || `rh_lipsync_${crypto.randomUUID()}`,
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
        prompt: 'p95b5',
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

  const QUOTED = 11; // mock fixed for 720; live uses OTS

  // Test 1: shape 720
  {
    const fwd = buildLtxLipsyncForward({ resolution: '720' });
    const pick = pickRunningHubTarget(fwd.path, { regionHint: fwd.rhRegion });
    const img = assertNode(fwd.body.nodeInfoList, '50', 'image');
    const aud = assertNode(fwd.body.nodeInfoList, '37', 'audio');
    record(
      'test1_create_forward_720',
      fwd.rhRegion === 'cn' &&
        fwd.path === LIPSYNC_PATH &&
        fwd.body.instanceType === 'plus' &&
        fwd.billingModelId === SKU_720 &&
        img.startsWith('https://') &&
        aud.startsWith('https://') &&
        pick.region === 'cn',
      { sku: fwd.billingModelId, pick: pick.region },
    );
  }

  // Test 2 / 3: SKU 1280 / 1920
  for (const res of ['1280', '1920']) {
    const fwd = buildLtxLipsyncForward({ resolution: res });
    const rn = assertNode(fwd.body.nodeInfoList, '187', 'value');
    record(
      `test_sku_${res}`,
      rn === res && fwd.billingModelId === `ltx-2-3-lipsync-${res}`,
      { field: rn, sku: fwd.billingModelId },
    );
  }

  // Test 4: no image → gate reject (no Create)
  {
    const ok =
      gateLipsync({
        nxCloudQueueGoldenPath: true,
        model: 'ltx-2.3-lipsync',
        images: [],
        inputAudioUrl: OSS_AUD,
      }) === false;
    record('test4_no_image_reject', ok, {});
  }

  // Test 5: no audio → gate reject
  {
    const ok =
      gateLipsync({
        nxCloudQueueGoldenPath: true,
        model: 'ltx-2.3-lipsync',
        images: [OSS_IMG],
        inputAudioUrl: '',
      }) === false;
    record('test5_no_audio_reject', ok, {});
  }

  // Test 6: 2 images → gate reject
  {
    const ok =
      gateLipsync({
        nxCloudQueueGoldenPath: true,
        model: 'ltx-2.3-lipsync',
        images: [OSS_IMG, `${OSS_IMG}?v=2`],
        inputAudioUrl: OSS_AUD,
      }) === false;
    record('test6_two_images_reject', ok, {});
  }

  // Test 7 / 8: OSS fail simulated as non-https reject before Create
  {
    let imgFail = false;
    let audFail = false;
    try {
      buildLtxLipsyncForward({ imageUrl: 'http://insecure.example/a.jpg' });
    } catch {
      imgFail = true;
    }
    try {
      buildLtxLipsyncForward({ audioUrl: 'file:///C:/a.mp3' });
    } catch {
      audFail = true;
    }
    record('test7_8_oss_https_required', imgFail && audFail, { imgFail, audFail });
  }

  // Test 9: non-HTTPS / RH fileName
  {
    let rejectedRh = false;
    let rejectedLocal = false;
    try {
      buildLtxLipsyncForward({ imageUrl: 'openapi/x.jpg' });
    } catch {
      rejectedRh = true;
    }
    try {
      buildLtxLipsyncForward({ audioUrl: 'data:audio/mpeg;base64,AAA' });
    } catch {
      rejectedLocal = true;
    }
    record('test9_non_https_reject', rejectedRh && rejectedLocal, { rejectedRh, rejectedLocal });
  }

  // Test 10 / 11: region + full forward persisted
  {
    const before = stats.rh_submit_calls;
    const bal0 = (await db.getUserById(uid)).balance;
    const fwd = buildLtxLipsyncForward();
    const tid = await createQueueTask(uid, fwd, 'ltx-2.3-lipsync', SKU_720, QUOTED, {
      resolutionLtx23Lipsync: '720',
    });
    const t0 = await db.getTaskById(tid);
    const stored = JSON.parse(t0.provider_forward_json || '{}');
    record(
      'test10_11_region_and_forward',
      t0.status === 'queued' &&
        stored.rhRegion === 'cn' &&
        stored.path === LIPSYNC_PATH &&
        assertNode(stored.body?.nodeInfoList, '50', 'image').startsWith('https://') &&
        assertNode(stored.body?.nodeInfoList, '37', 'audio').startsWith('https://') &&
        assertNode(stored.body?.nodeInfoList, '187', 'value') === '720',
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

    const d = await dispatchOneChargedTask(tid, db, {
      submitRunningHub: mockRhOk('rh_lipsync_single'),
    });
    record('test_dispatch', d.ok === true || d.idempotent === true, {
      pid: (await db.getTaskById(tid))?.provider_task_id,
      submits: stats.rh_submit_calls - before,
    });

    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/ltx-lipsync-golden.mp4',
      }),
    });
    const final = await db.getTaskById(tid);
    const pickPoll = pickRunningHubTarget('/query', {
      regionHint: JSON.parse(final.provider_forward_json || '{}').rhRegion,
    });
    record('test_poll_cn_success_release', pickPoll.region === 'cn' && final.status === 'success' && !!final.result_oss_url && !final.user_slot_held && !final.platform_slot_held, {
      seen: pickPoll.region,
      status: final.status,
      held: final.user_slot_held,
    });

    // Test 12: Dup dispatch ×10
    const beforeDup = stats.rh_submit_calls;
    for (let i = 0; i < 10; i++) {
      await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('should_not') });
    }
    record('test12_dup_dispatch_one_rh', stats.rh_submit_calls === beforeDup, {
      submits: stats.rh_submit_calls - beforeDup,
    });
  }

  // Test 13 / 14: Dup charge / refund ×10
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
    const fwd = buildLtxLipsyncForward({ prompt: 'dup' });
    const tid = await createQueueTask(uDup, fwd, 'ltx-2.3-lipsync', SKU_720, QUOTED);
    await promoteUntilClaimed(tid, uDup);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    const bal0 = (await db.getUserById(uDup)).balance;
    for (let i = 0; i < 10; i++) await chargeClaimedTask(tid, db);
    const bal1 = (await db.getUserById(uDup)).balance;
    record('test13_dup_charge_once', Number(bal0) - Number(bal1) === QUOTED, {
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
    record('test14_dup_refund_once', Number(bal2) === Number(bal3) && Number(bal2) === Number(bal0), {
      bal0,
      bal2,
      bal3,
    });
  }

  // Test 15: Submit fail → refund + release
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
    const tid = await createQueueTask(
      u,
      buildLtxLipsyncForward({ prompt: 'subfail' }),
      'ltx-2.3-lipsync',
      SKU_720,
      QUOTED,
    );
    await promoteUntilClaimed(tid, u);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await chargeClaimedTask(tid, db);
    await dispatchOneChargedTask(tid, db, {
      submitRunningHub: async () => ({ ok: false, error: 'SUBMIT_FAIL', rhRegion: 'cn' }),
    });
    const final = await db.getTaskById(tid);
    const bal1 = (await db.getUserById(u)).balance;
    record(
      'test15_submit_fail_refund_release',
      ['failed', 'cancelled'].includes(String(final?.status)) &&
        Number(bal1) === Number(bal0) &&
        !final?.user_slot_held &&
        !final?.platform_slot_held,
      { status: final?.status, bal0, bal1, held: final?.user_slot_held },
    );
  }

  // Gate dual-path
  {
    record(
      'gate_on',
      gateLipsync({
        nxCloudQueueGoldenPath: true,
        model: 'ltx-2.3-lipsync',
        images: [OSS_IMG],
        inputAudioUrl: OSS_AUD,
      }) === true,
      {},
    );
    record(
      'gate_off_direct_fallback',
      gateLipsync({
        nxCloudQueueGoldenPath: false,
        model: 'ltx-2.3-lipsync',
        images: [OSS_IMG],
        inputAudioUrl: OSS_AUD,
      }) === false,
      {},
    );
    const vp = fs.readFileSync(
      path.resolve(__dirname, '../../../src/main/ai/providers/VideoProvider.ts'),
      'utf8',
    );
    const panel = fs.readFileSync(
      path.resolve(__dirname, '../../../src/renderer/components/Canvas/VideoInputPanel.tsx'),
      'utf8',
    );
    const golden = fs.readFileSync(
      path.resolve(__dirname, '../../../src/shared/videoQueueGoldenPath.ts'),
      'utf8',
    );
    const hasAdapter = golden.includes('buildLtx23LipsyncRhForward');
    const hasEarly = vp.includes('executeLtx23LipsyncCloudQueueGoldenPath');
    const hasGate = panel.includes("model === 'ltx-2.3-lipsync'") && panel.includes('nxCloudQueueGoldenPath');
    const queueIdx = vp.indexOf('executeLtx23LipsyncCloudQueueGoldenPath');
    const directIdx = vp.indexOf('LTX2.3 数字人对口型：RunningHub ai-app API');
    record(
      'gate_on_no_direct_after_queue',
      hasAdapter && hasEarly && hasGate && queueIdx > 0 && directIdx > queueIdx,
      { hasAdapter, hasEarly, hasGate, queueBeforeDirect: queueIdx < directIdx },
    );
  }

  {
    const good = hasValidForwardPath({
      provider_forward_json: JSON.stringify(buildLtxLipsyncForward()),
    });
    const bad = hasValidForwardPath({ provider_forward_json: '' });
    record('invalid_forward', good === true && bad === false, { good, bad });
  }

  {
    record(
      'regression_paths_distinct',
      LIPSYNC_PATH !== I2V_PATH && LIPSYNC_PATH !== START_END_PATH,
      { lipsync: LIPSYNC_PATH, i2v: I2V_PATH },
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
  console.log(
    JSON.stringify(
      { conclusion: report.conclusion, failed: stats.tests.filter((t) => !t.ok) },
      null,
      2,
    ),
  );
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
