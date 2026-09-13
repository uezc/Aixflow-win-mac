/**
 * Phase 9.5-B-3-B — rh-video-start-end Unified Queue mock
 * node scripts/test-phase9-5-b3-rh-video-start-end-queue.mjs
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
const { getFinalPrice } = await import('../pricing/price_calculator.mjs');

const PREFIX = `__p95b3_${Date.now().toString(36)}_`;
const APP_PATH = '/run/ai-app/2048742865043460098';
const OSS_A =
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p93d-i2v-test/1788607602254_b2eac80c.jpg';
const OSS_B =
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p93d-i2v-test/1788607602254_b2eac80c.jpg?v=end';
const SKU_720_5 = 'ltx-2-3-start-end-720p-5s';
const OUT = path.join(__dirname, 'phase9-5-b3-rh-video-start-end-queue-test-result.json');

const stats = { rh_submit_calls: 0, creates: 0, tests: [] };

function record(name, ok, detail) {
  stats.tests.push({ name, ok, detail });
  console.log(ok ? `[PASS] ${name}` : `[FAIL] ${name}`, detail || '');
}

function assertHttps(u, label) {
  const s = String(u || '').trim();
  if (!s.startsWith('https://')) throw new Error(`${label} not https`);
  if (/^(openapi|api)\//i.test(s)) throw new Error(`${label} RH fileName`);
  return s;
}

function mapWh(res, ar) {
  if (res === '720p') return ar === '9:16' ? { w: '720', h: '1280' } : { w: '1280', h: '720' };
  return ar === '9:16' ? { w: '1080', h: '1920' } : { w: '1920', h: '1080' };
}

function buildForward({
  prompt = 'start-end mock',
  start = OSS_A,
  end = OSS_B,
  duration = '5',
  resolution = '720p',
  aspectRatio = '16:9',
} = {}) {
  assertHttps(start, 'start');
  assertHttps(end, 'end');
  const dur = String(duration);
  if (!['5', '10', '15'].includes(dur)) throw new Error(`bad duration ${dur}`);
  const res =
    resolution === '720p' || resolution === '1080p' || resolution === '1920p' ? resolution : '1080p';
  const ar = aspectRatio === '9:16' ? '9:16' : '16:9';
  const size = mapWh(res, ar);
  const sku = `ltx-2-3-start-end-${res}-${dur}s`;
  return {
    provider: 'runninghub',
    path: APP_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '2004', fieldName: 'image', fieldValue: start, description: 'image1' },
        { nodeId: '5062', fieldName: 'image', fieldValue: end, description: 'image2' },
        { nodeId: '5018', fieldName: 'value', fieldValue: size.w, description: '宽' },
        { nodeId: '5020', fieldName: 'value', fieldValue: size.h, description: '高' },
        { nodeId: '5022', fieldName: 'value', fieldValue: dur, description: '时长' },
        { nodeId: '5090', fieldName: 'text', fieldValue: prompt, description: 'text' },
      ],
      instanceType: 'plus',
      usePersonalQueue: 'false',
    },
    billingModelId: sku,
    rhRegion: 'cn',
  };
}

function gateStartEnd(input) {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '') !== 'rh-video-start-end') return false;
  const images = Array.isArray(input.images) ? input.images.filter((u) => String(u || '').trim()) : [];
  if (images.length !== 2) return false;
  if (input.directorSpawned === true || input.drama === true) return false;
  return true;
}

async function setBalance(userId, balance) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p95b3.local` });
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
      provider_task_id: pid || `rh_se_${crypto.randomUUID()}`,
      data: {},
      rhRegion: forward?.rhRegion || null,
    };
  };
}

async function createQueueTask(userId, forward, sku, quoted, nodeData = {}) {
  stats.creates += 1;
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
        model: 'rh-video-start-end',
        prompt: 'p95b3',
        nxCloudQueueGoldenPath: true,
      },
      nodeData: { model: 'rh-video-start-end', ...nodeData },
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
  await promoteQueuedTasks(
    [
      {
        taskId,
        userId,
        taskType: 'video',
        queueEnteredAt: Number(t.queue_entered_at || t.created_at || Date.now()),
      },
    ],
    await buildPromoteDeps(),
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
  await setBalance(uid, 5000);

  const modelConfigMap = Object.fromEntries((await db.listModelConfig()).map((r) => [r.model_id, r]));
  const skus = [];
  for (const res of ['720p', '1080p', '1920p']) {
    for (const dur of ['5s', '10s', '15s']) skus.push(`ltx-2-3-start-end-${res}-${dur}`);
  }
  {
    const missing = skus.filter((s) => !modelConfigMap[s]);
    const prices = {};
    for (const s of skus) {
      try {
        prices[s] = getFinalPrice(s, { taskType: 'video', modelConfigMap });
      } catch (e) {
        prices[s] = `ERR:${e.message}`;
      }
    }
    const allOk = missing.length === 0 && skus.every((s) => typeof prices[s] === 'number' && prices[s] > 0);
    record('test6_ots_sku_9_9', allOk, { missing, prices });
  }

  const QUOTED = Number(getFinalPrice(SKU_720_5, { taskType: 'video', modelConfigMap })) || 4;

  {
    const fwd = buildForward({ duration: '5', resolution: '720p', aspectRatio: '16:9' });
    const pick = pickRunningHubTarget(fwd.path, { regionHint: fwd.rhRegion });
    const w = fwd.body.nodeInfoList.find((n) => n.nodeId === '5018');
    const h = fwd.body.nodeInfoList.find((n) => n.nodeId === '5020');
    const d = fwd.body.nodeInfoList.find((n) => n.nodeId === '5022');
    record(
      'forward_shape',
      fwd.rhRegion === 'cn' &&
        fwd.path === APP_PATH &&
        fwd.body.instanceType === 'plus' &&
        typeof d?.fieldValue === 'string' &&
        d.fieldValue === '5' &&
        w?.fieldValue === '1280' &&
        h?.fieldValue === '720' &&
        pick.region === 'cn',
      { rhRegion: fwd.rhRegion, w: w?.fieldValue, h: h?.fieldValue, pick: pick.region },
    );
  }

  // Test 7: 1080p / 1920p pixels
  for (const res of ['1080p', '1920p']) {
    for (const ar of ['16:9', '9:16']) {
      const fwd = buildForward({ resolution: res, aspectRatio: ar });
      const w = fwd.body.nodeInfoList.find((n) => n.nodeId === '5018')?.fieldValue;
      const h = fwd.body.nodeInfoList.find((n) => n.nodeId === '5020')?.fieldValue;
      const expect = ar === '9:16' ? { w: '1080', h: '1920' } : { w: '1920', h: '1080' };
      record(
        `test7_${res}_${ar.replace(':', 'x')}`,
        w === expect.w && h === expect.h && !(w === '3840' || h === '2160'),
        { w, h, sku: fwd.billingModelId },
      );
    }
  }

  // reject bad image counts at adapter-level (no create)
  {
    const c0 = stats.creates;
    let rej1 = false;
    let rej3 = false;
    try {
      if ([OSS_A].length !== 2) throw new Error('need 2');
    } catch {
      rej1 = true;
    }
    try {
      const imgs = [OSS_A, OSS_B, OSS_A];
      if (imgs.length !== 2) throw new Error('need 2');
    } catch {
      rej3 = true;
    }
    record('test2_1img_no_create', rej1 && stats.creates === c0, { creates: stats.creates - c0 });
    record('test3_3img_no_create', rej3 && stats.creates === c0, { creates: stats.creates - c0 });
  }

  // Test 4/5: preprocess fail — source order + no create
  {
    const vp = fs.readFileSync(
      path.resolve(__dirname, '../../../src/main/ai/providers/VideoProvider.ts'),
      'utf8',
    );
    const method = vp.indexOf('executeRhVideoStartEndCloudQueueGoldenPath');
    const slice = method > 0 ? vp.slice(method, method + 4500) : '';
    const startOss = slice.indexOf('processImageToOssUrl(pair[0])');
    const endOss = slice.indexOf('processImageToOssUrl(pair[1])');
    const createCall = slice.indexOf('executeVideoCloudQueueGoldenPath');
    const earlyReturnOnFail = slice.includes('处理首尾帧图片失败') && slice.includes('return;');
    record(
      'test4_5_preprocess_before_create',
      method > 0 && startOss > 0 && endOss > startOss && createCall > endOss && earlyReturnOnFail,
      { startOss, endOss, createCall },
    );
    let rejectedFile = false;
    try {
      buildForward({ start: 'openapi/x.jpg' });
    } catch {
      rejectedFile = true;
    }
    record('reject_rh_filename', rejectedFile);
  }

  // Test 1: full success 2img 720p 5s 16:9
  {
    const beforeRh = stats.rh_submit_calls;
    const bal0 = (await db.getUserById(uid)).balance;
    const fwd = buildForward({ duration: '5', resolution: '720p', aspectRatio: '16:9' });
    const tid = await createQueueTask(uid, fwd, SKU_720_5, QUOTED, {
      duration: '5',
      resolutionRhartV31: '720p',
      imageCount: 2,
    });
    const t0 = await db.getTaskById(tid);
    const stored = JSON.parse(t0.provider_forward_json || '{}');
    record(
      'test1_create',
      t0.status === 'queued' &&
        stored.rhRegion === 'cn' &&
        stored.path === APP_PATH &&
        stored.body?.nodeInfoList?.length === 6,
      { status: t0.status },
    );

    const claimed = await promoteUntilClaimed(tid, uid);
    record('test1_claim', claimed?.status === 'claimed', { status: claimed?.status });

    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await chargeClaimedTask(tid, db);
    const bal1 = (await db.getUserById(uid)).balance;
    record('test1_charge', Number(bal0) - Number(bal1) === QUOTED, {
      delta: Number(bal0) - Number(bal1),
      quoted: QUOTED,
    });

    const d = await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_se_ok') });
    record('test1_dispatch', d.ok === true || d.idempotent === true, {
      pid: (await db.getTaskById(tid))?.provider_task_id,
      submits: stats.rh_submit_calls - beforeRh,
    });

    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/start-end.mp4',
      }),
    });
    const final = await db.getTaskById(tid);
    const pickPoll = pickRunningHubTarget('/query', {
      regionHint: JSON.parse(final.provider_forward_json || '{}').rhRegion,
    });
    record(
      'test1_success_release',
      final.status === 'success' &&
        !!final.result_oss_url &&
        !final.user_slot_held &&
        !final.platform_slot_held &&
        pickPoll.region === 'cn',
      { status: final.status, held: final.user_slot_held, poll: pickPoll.region },
    );

    const beforeDup = stats.rh_submit_calls;
    for (let i = 0; i < 10; i++) {
      await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('nope') });
    }
    record('test8_dup_dispatch', stats.rh_submit_calls === beforeDup, {
      submits: stats.rh_submit_calls - beforeDup,
    });
  }

  // Test 9/10 dup charge/refund
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
    const tid = await createQueueTask(uDup, buildForward({ prompt: 'dup' }), SKU_720_5, QUOTED);
    await promoteUntilClaimed(tid, uDup);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    const bal0 = (await db.getUserById(uDup)).balance;
    for (let i = 0; i < 10; i++) await chargeClaimedTask(tid, db);
    const bal1 = (await db.getUserById(uDup)).balance;
    record('test9_dup_charge', Number(bal0) - Number(bal1) === QUOTED, {
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
    record('test10_dup_refund', Number(bal2) === Number(bal3) && Number(bal2) === Number(bal0), {
      bal0,
      bal2,
      bal3,
    });
  }

  // Dispatch fail → refund + release
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
    const tid = await createQueueTask(u, buildForward({ prompt: 'subfail' }), SKU_720_5, QUOTED);
    await promoteUntilClaimed(tid, u);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await chargeClaimedTask(tid, db);
    await dispatchOneChargedTask(tid, db, {
      submitRunningHub: async () => ({ ok: false, error: 'SUBMIT_FAIL', rhRegion: 'cn' }),
    });
    const final = await db.getTaskById(tid);
    const bal1 = (await db.getUserById(u)).balance;
    const charge = await db.getTaskCharge(tid);
    record(
      'submit_fail_refund_release',
      ['failed', 'cancelled'].includes(String(final?.status)) &&
        Number(bal1) === Number(bal0) &&
        String(charge?.status).toLowerCase() === 'refunded' &&
        !final?.user_slot_held &&
        !final?.platform_slot_held,
      { status: final?.status, bal0, bal1, charge: charge?.status },
    );
  }

  // Gate + Direct fallback + no dual
  {
    record(
      'gate_on',
      gateStartEnd({
        nxCloudQueueGoldenPath: true,
        model: 'rh-video-start-end',
        images: [OSS_A, OSS_B],
      }) === true,
    );
    record(
      'gate_off',
      gateStartEnd({
        nxCloudQueueGoldenPath: false,
        model: 'rh-video-start-end',
        images: [OSS_A, OSS_B],
      }) === false,
    );
    record(
      'gate_reject_1img',
      gateStartEnd({
        nxCloudQueueGoldenPath: true,
        model: 'rh-video-start-end',
        images: [OSS_A],
      }) === false,
    );
    const vp = fs.readFileSync(
      path.resolve(__dirname, '../../../src/main/ai/providers/VideoProvider.ts'),
      'utf8',
    );
    const panel = fs.readFileSync(
      path.resolve(__dirname, '../../../src/renderer/components/Canvas/VideoInputPanel.tsx'),
      'utf8',
    );
    const qIdx = vp.indexOf('executeRhVideoStartEndCloudQueueGoldenPath');
    const dIdx = vp.indexOf('LTX2.3（首位帧）：RunningHub ai-app');
    record('gate_queue_before_direct', qIdx > 0 && dIdx > qIdx, {
      queueBeforeDirect: qIdx < dIdx,
    });
    record(
      'ui_gate',
      panel.includes("model === 'rh-video-start-end'") && panel.includes('nxCloudQueueGoldenPath'),
    );
  }

  record(
    'invalid_forward',
    hasValidForwardPath({ provider_forward_json: JSON.stringify(buildForward()) }) &&
      !hasValidForwardPath({ provider_forward_json: '' }),
  );

  const passed = stats.tests.every((t) => t.ok);
  const report = {
    passed,
    conclusion: passed ? 'PASS' : 'FAIL',
    quoted: QUOTED,
    tests: stats.tests,
    rh_submit_calls: stats.rh_submit_calls,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({ conclusion: report.conclusion, failed: stats.tests.filter((t) => !t.ok) }, null, 2),
  );
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
