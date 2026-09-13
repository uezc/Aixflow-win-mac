/**
 * Phase 9.5-B-4-B — rhart-v3.1-pro-se Unified Queue mock
 * node scripts/test-phase9-5-b4-rhart-v31-pro-se-queue.mjs
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

const PREFIX = `__p95b4_${Date.now().toString(36)}_`;
const RH_PATH = '/rhart-video-v3.1-pro/start-end-to-video';
const MODEL = 'rhart-v3.1-pro-se';
const OSS_A =
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p93d-i2v-test/1788607602254_b2eac80c.jpg';
const OSS_B =
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p93d-i2v-test/1788607602254_b2eac80c.jpg?v=end';
const SKU_720 = 'veo-3-1-720p-pro-se';
const SKU_1080 = 'veo-3-1-1080p-pro-se';
const SKU_4K = 'veo-3-1-4k-pro-se';
const OUT = path.join(__dirname, 'phase9-5-b4-rhart-v31-pro-se-queue-test-result.json');

const stats = { rh_submit_calls: 0, creates: 0, charges: 0, dispatches: 0, tests: [] };

function record(name, ok, detail) {
  stats.tests.push({ name, ok, detail });
  console.log(ok ? `[PASS] ${name}` : `[FAIL] ${name}`, detail || '');
}

function assertHttps(u, label) {
  const s = String(u || '').trim();
  if (!s) throw new Error(`${label} empty`);
  if (/^(openapi|api)\//i.test(s)) throw new Error(`${label} RH fileName forbidden`);
  if (!s.startsWith('https://')) throw new Error(`${label} must be HTTPS`);
  return s;
}

/** Mirror of buildRhArtV31ProSeRhForward */
function buildProSeForward({
  prompt = 'pro-se mock',
  firstFrameUrl = OSS_A,
  lastFrameUrl = null,
  resolution = '720p',
  aspectRatio = '16:9',
  billingModelId,
} = {}) {
  const promptText = String(prompt || '').trim();
  if (!promptText) throw new Error('prompt required');
  const first = assertHttps(firstFrameUrl, 'first');
  const lastRaw = lastFrameUrl != null ? String(lastFrameUrl).trim() : '';
  const last = lastRaw ? assertHttps(lastRaw, 'last') : '';
  const res = ['720p', '1080p', '4k'].includes(resolution) ? resolution : '1080p';
  const ar = aspectRatio === '9:16' ? '9:16' : '16:9';
  const sku = billingModelId || `veo-3-1-${res}-pro-se`;
  const body = {
    prompt: promptText,
    firstFrameUrl: first,
    aspectRatio: ar,
    duration: '8',
    resolution: res,
  };
  if (last) body.lastFrameUrl = last;
  return {
    provider: 'runninghub',
    path: RH_PATH,
    method: 'POST',
    body,
    billingModelId: sku,
    rhRegion: 'ai',
  };
}

async function setBalance(userId, balance) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p95b4.local` });
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
    stats.dispatches += 1;
    return {
      ok: true,
      provider_task_id: pid || `rh_prose_${crypto.randomUUID()}`,
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
        model: MODEL,
        prompt: 'p95b4',
        nxCloudQueueGoldenPath: true,
      },
      nodeData: { model: MODEL, ...nodeData },
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

function gateProSe(input) {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '') !== MODEL) return false;
  const images = Array.isArray(input.images) ? input.images.filter((u) => String(u || '').trim()) : [];
  if (images.length < 1 || images.length > 2) return false;
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
  await setBalance(uid, 5000);

  const modelConfigMap = Object.fromEntries((await db.listModelConfig()).map((r) => [r.model_id, r]));
  const skus = [SKU_720, SKU_1080, SKU_4K];
  const prices = {};
  const missing = [];
  for (const s of skus) {
    if (!modelConfigMap[s]) {
      missing.push(s);
      continue;
    }
    try {
      prices[s] = getFinalPrice(s, { taskType: 'video', modelConfigMap });
    } catch (e) {
      prices[s] = `ERR:${e.message}`;
    }
  }
  record(
    'test7_ots_sku_3_3',
    missing.length === 0 && skus.every((s) => typeof prices[s] === 'number' && prices[s] > 0),
    { missing, prices },
  );

  const QUOTED_720 = Number(prices[SKU_720]) || 7;
  const QUOTED_1080 = Number(prices[SKU_1080]) || 15;

  {
    const fwd1 = buildProSeForward({ resolution: '720p' });
    const fwd2 = buildProSeForward({ resolution: '1080p', lastFrameUrl: OSS_B });
    const fwd4 = buildProSeForward({ resolution: '4k' });
    record(
      'test7_sku_ids',
      fwd1.billingModelId === SKU_720 &&
        fwd2.billingModelId === SKU_1080 &&
        fwd4.billingModelId === SKU_4K,
      { a: fwd1.billingModelId, b: fwd2.billingModelId, c: fwd4.billingModelId },
    );
  }

  {
    const a = buildProSeForward({ aspectRatio: '16:9' });
    const b = buildProSeForward({ aspectRatio: '9:16' });
    const c = buildProSeForward({ aspectRatio: '1:1' });
    record(
      'test8_aspect',
      a.body.aspectRatio === '16:9' && b.body.aspectRatio === '9:16' && c.body.aspectRatio === '16:9',
      { a: a.body.aspectRatio, b: b.body.aspectRatio, c: c.body.aspectRatio },
    );
  }

  {
    const fwd = buildProSeForward({});
    record(
      'test9_duration_string_8',
      fwd.body.duration === '8' && typeof fwd.body.duration === 'string',
      { duration: fwd.body.duration, type: typeof fwd.body.duration },
    );
  }

  {
    const fwd = buildProSeForward({});
    const pick = pickRunningHubTarget(fwd.path, { regionHint: fwd.rhRegion });
    record(
      'test10_region_ai',
      fwd.rhRegion === 'ai' && pick.region === 'ai' && fwd.path === RH_PATH,
      { rhRegion: fwd.rhRegion, pick: pick.region, path: fwd.path },
    );
  }

  // Test 1 — 1 image
  {
    const beforeCreate = stats.creates;
    const beforeRh = stats.rh_submit_calls;
    const bal0 = (await db.getUserById(uid)).balance;
    const fwd = buildProSeForward({ resolution: '720p' });
    record(
      'test1_no_lastFrameUrl',
      !Object.prototype.hasOwnProperty.call(fwd.body, 'lastFrameUrl'),
      { keys: Object.keys(fwd.body) },
    );
    const tid = await createQueueTask(uid, fwd, SKU_720, QUOTED_720, {
      resolutionRhartV31: '720p',
      imageCount: 1,
    });
    const t0 = await db.getTaskById(tid);
    const stored = JSON.parse(t0.provider_forward_json || '{}');
    record(
      'test1_create',
      t0.status === 'queued' &&
        stored.rhRegion === 'ai' &&
        !Object.prototype.hasOwnProperty.call(stored.body || {}, 'lastFrameUrl') &&
        stats.creates === beforeCreate + 1,
      { status: t0.status, hasLast: Object.prototype.hasOwnProperty.call(stored.body || {}, 'lastFrameUrl') },
    );

    const claimed = await promoteUntilClaimed(tid, uid);
    record('test1_claim', claimed?.status === 'claimed', { status: claimed?.status });

    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await chargeClaimedTask(tid, db);
    stats.charges += 1;
    const bal1 = (await db.getUserById(uid)).balance;
    record('test1_charge', Number(bal0) - Number(bal1) === QUOTED_720, {
      delta: Number(bal0) - Number(bal1),
      quoted: QUOTED_720,
    });

    const d = await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_prose_1') });
    record('test1_dispatch', d.ok === true || d.idempotent === true, {
      pid: (await db.getTaskById(tid))?.provider_task_id,
      submits: stats.rh_submit_calls - beforeRh,
    });

    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/pro-se-1.mp4',
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
        pickPoll.region === 'ai',
      { status: final.status, poll: pickPoll.region, held: final.user_slot_held },
    );

    const beforeDup = stats.rh_submit_calls;
    for (let i = 0; i < 10; i++) {
      await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('should_not') });
    }
    record('test11_dup_dispatch', stats.rh_submit_calls === beforeDup, {
      submits: stats.rh_submit_calls - beforeDup,
    });
  }

  // Test 2 — 2 images
  {
    const fwd = buildProSeForward({
      resolution: '1080p',
      lastFrameUrl: OSS_B,
      billingModelId: SKU_1080,
    });
    record(
      'test2_has_lastFrameUrl',
      fwd.body.firstFrameUrl === OSS_A &&
        fwd.body.lastFrameUrl === OSS_B &&
        Object.prototype.hasOwnProperty.call(fwd.body, 'lastFrameUrl'),
      { first: fwd.body.firstFrameUrl?.slice(0, 40), last: fwd.body.lastFrameUrl?.slice(0, 40) },
    );
    const bal0 = (await db.getUserById(uid)).balance;
    const tid = await createQueueTask(uid, fwd, SKU_1080, QUOTED_1080, {
      resolutionRhartV31: '1080p',
      imageCount: 2,
    });
    const stored = JSON.parse((await db.getTaskById(tid)).provider_forward_json || '{}');
    record(
      'test2_create_stored',
      stored.body?.firstFrameUrl === OSS_A && stored.body?.lastFrameUrl === OSS_B,
      { first: !!stored.body?.firstFrameUrl, last: !!stored.body?.lastFrameUrl },
    );
    await promoteUntilClaimed(tid, uid);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await chargeClaimedTask(tid, db);
    stats.charges += 1;
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_prose_2') });
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/pro-se-2.mp4',
      }),
    });
    const final = await db.getTaskById(tid);
    const bal1 = (await db.getUserById(uid)).balance;
    record(
      'test2_success',
      final.status === 'success' && Number(bal0) - Number(bal1) === QUOTED_1080,
      { status: final.status, delta: Number(bal0) - Number(bal1) },
    );
  }

  // Test 3 — 0 images
  {
    const c0 = stats.creates;
    const ch0 = stats.charges;
    const d0 = stats.dispatches;
    let rejected = false;
    try {
      buildProSeForward({ firstFrameUrl: '' });
    } catch {
      rejected = true;
    }
    record(
      'test3_0img_no_create',
      rejected && stats.creates === c0 && stats.charges === ch0 && stats.dispatches === d0,
      { rejected, creates: stats.creates - c0 },
    );
    record('gate_reject_0img', gateProSe({ nxCloudQueueGoldenPath: true, model: MODEL, images: [] }) === false);
  }

  // Test 4 — 3 images
  {
    const c0 = stats.creates;
    record(
      'test4_3img_gate_reject',
      gateProSe({
        nxCloudQueueGoldenPath: true,
        model: MODEL,
        images: [OSS_A, OSS_B, `${OSS_A}?3`],
      }) === false && stats.creates === c0,
      { creates: stats.creates - c0 },
    );
  }

  // Test 5/6 preprocess fail source order
  {
    const vp = fs.readFileSync(
      path.resolve(__dirname, '../../../src/main/ai/providers/VideoProvider.ts'),
      'utf8',
    );
    const method = vp.indexOf('executeRhArtV31ProSeCloudQueueGoldenPath');
    const slice = method > 0 ? vp.slice(method, method + 5000) : '';
    const ossCatch = slice.indexOf('处理首尾帧图片失败');
    const createCall = slice.indexOf('executeVideoCloudQueueGoldenPath');
    record(
      'test5_6_preprocess_before_create',
      method > 0 && ossCatch > 0 && createCall > ossCatch && slice.includes('return;'),
      { ossCatch, createCall, ossBeforeCreate: ossCatch < createCall },
    );
  }

  // Test 14 — submit fail refund
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
    const tid = await createQueueTask(u, buildProSeForward({ prompt: 'subfail' }), SKU_720, QUOTED_720);
    await promoteUntilClaimed(tid, u);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await chargeClaimedTask(tid, db);
    await dispatchOneChargedTask(tid, db, {
      submitRunningHub: async () => ({ ok: false, error: 'SUBMIT_FAIL', rhRegion: 'ai' }),
    });
    const final = await db.getTaskById(tid);
    const bal1 = (await db.getUserById(u)).balance;
    const charge2 = await db.getTaskCharge(tid);
    record(
      'test14_submit_fail_refund_release',
      ['failed', 'cancelled'].includes(String(final?.status)) &&
        Number(bal1) === Number(bal0) &&
        String(charge2?.status).toLowerCase() === 'refunded' &&
        !final?.user_slot_held &&
        !final?.platform_slot_held,
      { status: final?.status, bal0, bal1, charge: charge2?.status },
    );
  }

  // Test 12/13 dup charge/refund
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
    const tid = await createQueueTask(uDup, buildProSeForward({ prompt: 'dup' }), SKU_720, QUOTED_720);
    await promoteUntilClaimed(tid, uDup);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    const bal0 = (await db.getUserById(uDup)).balance;
    for (let i = 0; i < 10; i++) await chargeClaimedTask(tid, db);
    const bal1 = (await db.getUserById(uDup)).balance;
    record('test12_dup_charge', Number(bal0) - Number(bal1) === QUOTED_720, {
      delta: Number(bal0) - Number(bal1),
    });

    await dispatchOneChargedTask(tid, db, {
      submitRunningHub: async () => ({
        ok: true,
        provider_task_id: `rh_dup_${crypto.randomUUID()}`,
        data: {},
        rhRegion: 'ai',
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
    record('test13_dup_refund', Number(bal2) === Number(bal3) && Number(bal2) === Number(bal0), {
      bal0,
      bal2,
      bal3,
    });
  }

  // Gate
  {
    record(
      'gate_on_1img',
      gateProSe({ nxCloudQueueGoldenPath: true, model: MODEL, images: [OSS_A] }) === true,
    );
    record(
      'gate_on_2img',
      gateProSe({ nxCloudQueueGoldenPath: true, model: MODEL, images: [OSS_A, OSS_B] }) === true,
    );
    record(
      'gate_off',
      gateProSe({ nxCloudQueueGoldenPath: false, model: MODEL, images: [OSS_A] }) === false,
    );
    const vp = fs.readFileSync(
      path.resolve(__dirname, '../../../src/main/ai/providers/VideoProvider.ts'),
      'utf8',
    );
    const panel = fs.readFileSync(
      path.resolve(__dirname, '../../../src/renderer/components/Canvas/VideoInputPanel.tsx'),
      'utf8',
    );
    const queueIdx = vp.indexOf('executeRhArtV31ProSeCloudQueueGoldenPath');
    const directIdx = vp.indexOf('全能视频V3.1-pro 首尾帧生视频（海外）');
    record(
      'gate_queue_before_direct',
      queueIdx > 0 && directIdx > queueIdx,
      { queueBeforeDirect: queueIdx < directIdx },
    );
    record(
      'ui_gate',
      panel.includes("model === 'rhart-v3.1-pro-se'") && panel.includes('nxCloudQueueGoldenPath'),
    );
  }

  {
    const good = hasValidForwardPath({
      provider_forward_json: JSON.stringify(buildProSeForward()),
    });
    const bad = hasValidForwardPath({ provider_forward_json: '' });
    record('invalid_forward', good === true && bad === false, { good, bad });
  }

  {
    let rejectedFn = false;
    try {
      buildProSeForward({ firstFrameUrl: 'openapi/xxx.png' });
    } catch {
      rejectedFn = true;
    }
    record('reject_rh_filename', rejectedFn);
  }

  const passed = stats.tests.every((t) => t.ok);
  const report = {
    passed,
    conclusion: passed ? 'PASS' : 'FAIL',
    prices,
    tests: stats.tests,
    rh_submit_calls: stats.rh_submit_calls,
    creates: stats.creates,
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
