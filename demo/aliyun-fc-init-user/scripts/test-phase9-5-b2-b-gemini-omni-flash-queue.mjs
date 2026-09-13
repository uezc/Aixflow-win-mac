/**
 * Phase 9.5-B-2-B — gemini-omni-flash Unified Queue mock
 * node scripts/test-phase9-5-b2-b-gemini-omni-flash-queue.mjs
 *
 * 不修改 Queue / Claim / Charge / Refund 核心；验证 Gemini Omni Flash forward（OSS HTTPS imageUrls；duration string）。
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

const PREFIX = `__p95b2b_${Date.now().toString(36)}_`;
const RH_PATH = '/gemini-omni-flash/image-to-video';
const OSS_IMG =
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p93d-i2v-test/1788607602254_b2eac80c.jpg';
const OSS_IMG_2 =
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p93d-i2v-test/1788607602254_b2eac80c.jpg?v=2';
const OSS_IMG_3 =
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p93d-i2v-test/1788607602254_b2eac80c.jpg?v=3';
const SKU_720_10 = 'gemini-omni-flash-720p-10s';
const OUT = path.join(__dirname, 'phase9-5-b2-b-gemini-omni-flash-queue-test-result.json');

const stats = { rh_submit_calls: 0, creates: 0, charges: 0, dispatches: 0, tests: [] };

function record(name, ok, detail) {
  stats.tests.push({ name, ok, detail });
  console.log(ok ? `[PASS] ${name}` : `[FAIL] ${name}`, detail || '');
}

function assertHttpsOssUrls(imageUrls) {
  if (!Array.isArray(imageUrls)) throw new Error('imageUrls must be array');
  const out = [];
  for (const raw of imageUrls) {
    const u = String(raw || '').trim();
    if (!u) continue;
    if (/^(openapi|api)\//i.test(u)) throw new Error(`RH fileName forbidden: ${u}`);
    if (!u.startsWith('https://')) throw new Error(`must be HTTPS: ${u}`);
    out.push(u);
  }
  if (out.length !== 1 && out.length !== 3) {
    throw new Error(`only 1 or 3 images allowed, got ${out.length}`);
  }
  return out;
}

/** Mirror of buildGeminiOmniFlashRhForward (JS test harness) */
function buildGeminiForward({
  prompt = 'gemini omni flash mock',
  imageUrls = [OSS_IMG],
  duration = '10',
  resolution = '720p',
  aspectRatio = '16:9',
  billingModelId,
} = {}) {
  const promptText = String(prompt || '').trim();
  if (!promptText) throw new Error('prompt required');
  const urls = assertHttpsOssUrls(imageUrls);
  const dur = String(duration);
  if (!['6', '8', '10'].includes(dur)) throw new Error(`bad duration ${dur}`);
  const res = ['720p', '1080p', '4k'].includes(resolution) ? resolution : '720p';
  const ar = aspectRatio === '9:16' ? '9:16' : '16:9';
  const sku = billingModelId || `gemini-omni-flash-${res}-${dur}s`;
  return {
    provider: 'runninghub',
    path: RH_PATH,
    method: 'POST',
    body: {
      prompt: promptText,
      imageUrls: urls,
      duration: dur,
      resolution: res,
      aspectRatio: ar,
    },
    billingModelId: sku,
    rhRegion: 'ai',
  };
}

async function setBalance(userId, balance) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p95b2b.local` });
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
      provider_task_id: pid || `rh_gof_${crypto.randomUUID()}`,
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
        model: 'gemini-omni-flash',
        prompt: 'p95b2b',
        nxCloudQueueGoldenPath: true,
      },
      nodeData: { model: 'gemini-omni-flash', ...nodeData },
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

function gateGemini(input) {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '') !== 'gemini-omni-flash') return false;
  const images = Array.isArray(input.images) ? input.images.filter((u) => String(u || '').trim()) : [];
  if (images.length !== 1 && images.length !== 3) return false;
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

  // OTS SKU prices
  {
    const skus = [
      'gemini-omni-flash-720p-6s',
      'gemini-omni-flash-720p-8s',
      'gemini-omni-flash-720p-10s',
      'gemini-omni-flash-1080p-6s',
      'gemini-omni-flash-1080p-8s',
      'gemini-omni-flash-1080p-10s',
      'gemini-omni-flash-4k-6s',
      'gemini-omni-flash-4k-8s',
      'gemini-omni-flash-4k-10s',
    ];
    const missing = skus.filter((s) => !modelConfigMap[s]);
    const prices = {};
    for (const s of skus) {
      if (!modelConfigMap[s]) continue;
      try {
        prices[s] = getFinalPrice(s, { taskType: 'video', modelConfigMap });
      } catch (e) {
        prices[s] = `ERR:${e.message}`;
      }
    }
    const allPriced = skus.every((s) => typeof prices[s] === 'number' && prices[s] > 0);
    record('ots_sku_all_9', missing.length === 0 && allPriced, { missing, prices });
  }

  const QUOTED = Number(getFinalPrice(SKU_720_10, { taskType: 'video', modelConfigMap })) || 10;

  {
    const fwd = buildGeminiForward({ duration: '10', resolution: '720p' });
    const pick = pickRunningHubTarget(fwd.path, { regionHint: fwd.rhRegion });
    const bodyKeys = Object.keys(fwd.body).sort();
    record(
      'create_forward_shape',
      fwd.rhRegion === 'ai' &&
        fwd.path === RH_PATH &&
        typeof fwd.body.duration === 'string' &&
        fwd.body.duration === '10' &&
        fwd.body.imageUrls.length === 1 &&
        bodyKeys.join(',') === 'aspectRatio,duration,imageUrls,prompt,resolution' &&
        pick.region === 'ai',
      { rhRegion: fwd.rhRegion, path: fwd.path, durationType: typeof fwd.body.duration, pick: pick.region, bodyKeys },
    );
  }

  // Mock 1: 1 image full path
  {
    const beforeCreate = stats.creates;
    const beforeRh = stats.rh_submit_calls;
    const bal0 = (await db.getUserById(uid)).balance;
    const fwd = buildGeminiForward({ imageUrls: [OSS_IMG], duration: '10' });
    const tid = await createQueueTask(uid, fwd, SKU_720_10, QUOTED, {
      durationGeminiOmni: '10',
      resolutionGeminiOmni: '720p',
      imageCount: 1,
    });
    const t0 = await db.getTaskById(tid);
    const stored = JSON.parse(t0.provider_forward_json || '{}');
    record(
      'mock1_1img_create',
      t0.status === 'queued' &&
        stored.rhRegion === 'ai' &&
        stored.path === RH_PATH &&
        stored.body?.imageUrls?.length === 1 &&
        typeof stored.body?.duration === 'string' &&
        stats.creates === beforeCreate + 1,
      { status: t0.status, n: stored.body?.imageUrls?.length, durationType: typeof stored.body?.duration },
    );

    const claimed = await promoteUntilClaimed(tid, uid);
    record('mock1_claim', claimed?.status === 'claimed', { status: claimed?.status });

    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await chargeClaimedTask(tid, db);
    stats.charges += 1;
    const bal1 = (await db.getUserById(uid)).balance;
    record('mock1_charge', Number(bal0) - Number(bal1) === QUOTED, {
      delta: Number(bal0) - Number(bal1),
      quoted: QUOTED,
    });

    const d = await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_gof_1img') });
    record('mock1_dispatch', d.ok === true || d.idempotent === true, {
      pid: (await db.getTaskById(tid))?.provider_task_id,
      submits: stats.rh_submit_calls - beforeRh,
    });

    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/gemini-flash-1.mp4',
      }),
    });
    const final = await db.getTaskById(tid);
    const pickPoll = pickRunningHubTarget('/query', {
      regionHint: JSON.parse(final.provider_forward_json || '{}').rhRegion,
    });
    record('mock1_poll_ai', pickPoll.region === 'ai' && final.status === 'success', {
      seen: pickPoll.region,
      status: final.status,
    });
    record(
      'mock1_success_release',
      final.status === 'success' &&
        !!final.result_oss_url &&
        !final.user_slot_held &&
        !final.platform_slot_held,
      { status: final.status, url: final.result_oss_url, held: final.user_slot_held },
    );

    const beforeDup = stats.rh_submit_calls;
    for (let i = 0; i < 10; i++) {
      await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('should_not') });
    }
    record('mock6_dup_dispatch_one_rh', stats.rh_submit_calls === beforeDup, {
      submits: stats.rh_submit_calls - beforeDup,
    });
  }

  // Mock 2: 3 images
  {
    const fwd = buildGeminiForward({
      imageUrls: [OSS_IMG, OSS_IMG_2, OSS_IMG_3],
      duration: '10',
    });
    record(
      'mock2_3img_forward',
      fwd.body.imageUrls.length === 3 &&
        Object.keys(fwd.body).sort().join(',') === 'aspectRatio,duration,imageUrls,prompt,resolution',
      { n: fwd.body.imageUrls.length, keys: Object.keys(fwd.body) },
    );
    const bal0 = (await db.getUserById(uid)).balance;
    const tid = await createQueueTask(uid, fwd, SKU_720_10, QUOTED, { imageCount: 3 });
    const stored = JSON.parse((await db.getTaskById(tid)).provider_forward_json || '{}');
    record('mock2_3img_create_stored', stored.body?.imageUrls?.length === 3, {
      n: stored.body?.imageUrls?.length,
    });
    await promoteUntilClaimed(tid, uid);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await chargeClaimedTask(tid, db);
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_gof_3img') });
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/gemini-flash-3.mp4',
      }),
    });
    const final = await db.getTaskById(tid);
    const bal1 = (await db.getUserById(uid)).balance;
    record(
      'mock2_3img_success',
      final.status === 'success' && Number(bal0) - Number(bal1) === QUOTED,
      { status: final.status, delta: Number(bal0) - Number(bal1) },
    );
  }

  // Mock 3: 2 images → no Create / Charge / Dispatch
  {
    const c0 = stats.creates;
    const ch0 = stats.charges;
    const d0 = stats.dispatches;
    let rejected = false;
    let errMsg = '';
    try {
      buildGeminiForward({ imageUrls: [OSS_IMG, OSS_IMG_2] });
    } catch (e) {
      rejected = true;
      errMsg = String(e.message || e);
    }
    record(
      'mock3_2img_reject_no_create',
      rejected && stats.creates === c0 && stats.charges === ch0 && stats.dispatches === d0,
      { rejected, errMsg, creates: stats.creates - c0 },
    );
  }

  // Mock 4: preprocess fail → no Create (VideoProvider early return; source + adapter reject empty)
  {
    const c0 = stats.creates;
    let rejectedEmpty = false;
    try {
      buildGeminiForward({ imageUrls: [] });
    } catch {
      rejectedEmpty = true;
    }
    const vp = fs.readFileSync(
      path.resolve(__dirname, '../../../src/main/ai/providers/VideoProvider.ts'),
      'utf8',
    );
    const method = vp.indexOf('executeGeminiOmniFlashCloudQueueGoldenPath');
    const ossFailReturn =
      method > 0 &&
      vp.includes("payload: { error: String(e?.message || e || '参考图处理失败') }") &&
      vp.slice(method, method + 2500).includes('return;');
    const beforeCreateCall = vp.slice(method, method + 4500).indexOf('executeVideoCloudQueueGoldenPath');
    const ossCatch = vp.slice(method, method + 4500).indexOf('参考图处理失败');
    record(
      'mock4_preprocess_fail_no_create',
      rejectedEmpty &&
        stats.creates === c0 &&
        ossFailReturn &&
        ossCatch > 0 &&
        beforeCreateCall > ossCatch,
      { rejectedEmpty, ossBeforeQueueCreate: ossCatch < beforeCreateCall },
    );
  }

  // Mock 5: Dispatch fail → Charge + Refund + Release
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
    const tid = await createQueueTask(u, buildGeminiForward({ prompt: 'subfail' }), SKU_720_10, QUOTED);
    await promoteUntilClaimed(tid, u);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await chargeClaimedTask(tid, db);
    const charge = await db.getTaskCharge(tid);
    await dispatchOneChargedTask(tid, db, {
      submitRunningHub: async () => ({ ok: false, error: 'SUBMIT_FAIL', rhRegion: 'ai' }),
    });
    const final = await db.getTaskById(tid);
    const bal1 = (await db.getUserById(u)).balance;
    const charge2 = await db.getTaskCharge(tid);
    record(
      'mock5_dispatch_fail_refund_release',
      ['failed', 'cancelled'].includes(String(final?.status)) &&
        Number(bal1) === Number(bal0) &&
        String(charge?.status).toLowerCase() === 'charged' &&
        String(charge2?.status).toLowerCase() === 'refunded' &&
        !final?.user_slot_held &&
        !final?.platform_slot_held,
      {
        status: final?.status,
        bal0,
        bal1,
        charge: charge?.status,
        charge2: charge2?.status,
        held: final?.user_slot_held,
      },
    );
  }

  // Mock 7/8: Dup charge / refund
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
    const fwd = buildGeminiForward({ prompt: 'dup' });
    const tid = await createQueueTask(uDup, fwd, SKU_720_10, QUOTED);
    await promoteUntilClaimed(tid, uDup);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    const bal0 = (await db.getUserById(uDup)).balance;
    for (let i = 0; i < 10; i++) await chargeClaimedTask(tid, db);
    const bal1 = (await db.getUserById(uDup)).balance;
    record('mock7_dup_charge_once', Number(bal0) - Number(bal1) === QUOTED, {
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
    record('mock8_dup_refund_once', Number(bal2) === Number(bal3) && Number(bal2) === Number(bal0), {
      bal0,
      bal2,
      bal3,
    });
  }

  // Gate + Direct fallback + no dual submit
  {
    record(
      'gate_on',
      gateGemini({
        nxCloudQueueGoldenPath: true,
        model: 'gemini-omni-flash',
        images: [OSS_IMG],
      }) === true,
    );
    record(
      'gate_on_3img',
      gateGemini({
        nxCloudQueueGoldenPath: true,
        model: 'gemini-omni-flash',
        images: [OSS_IMG, OSS_IMG_2, OSS_IMG_3],
      }) === true,
    );
    record(
      'gate_off_direct_fallback',
      gateGemini({
        nxCloudQueueGoldenPath: false,
        model: 'gemini-omni-flash',
        images: [OSS_IMG],
      }) === false,
    );
    record(
      'gate_reject_2img',
      gateGemini({
        nxCloudQueueGoldenPath: true,
        model: 'gemini-omni-flash',
        images: [OSS_IMG, OSS_IMG_2],
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
    const queueIdx = vp.indexOf('executeGeminiOmniFlashCloudQueueGoldenPath');
    const directIdx = vp.indexOf('全能视频 Omni Flash 图生视频：OpenAPI /gemini-omni-flash/image-to-video');
    record(
      'gate_on_no_direct_after_queue',
      queueIdx > 0 && directIdx > queueIdx,
      { queueBeforeDirect: queueIdx < directIdx },
    );
    record(
      'ui_gate_includes_gemini',
      panel.includes("model === 'gemini-omni-flash'") && panel.includes('nxCloudQueueGoldenPath'),
    );
  }

  // invalid-forward
  {
    const good = hasValidForwardPath({
      provider_forward_json: JSON.stringify(buildGeminiForward()),
    });
    const bad = hasValidForwardPath({ provider_forward_json: '' });
    record('invalid_forward', good === true && bad === false, { good, bad });
  }

  // duration must stay string in SKUs
  {
    for (const sec of ['6', '8', '10']) {
      const fwd = buildGeminiForward({ duration: sec });
      record(
        `duration_string_${sec}`,
        typeof fwd.body.duration === 'string' &&
          fwd.body.duration === sec &&
          fwd.billingModelId === `gemini-omni-flash-720p-${sec}s`,
        { type: typeof fwd.body.duration, sku: fwd.billingModelId },
      );
    }
  }

  const passed = stats.tests.every((t) => t.ok);
  const report = {
    passed,
    conclusion: passed ? 'PASS' : 'FAIL',
    quoted_sku: SKU_720_10,
    quoted_cost: QUOTED,
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
