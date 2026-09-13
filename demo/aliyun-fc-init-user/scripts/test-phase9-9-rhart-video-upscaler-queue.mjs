/**
 * Phase 9.9 — rhart-video-upscaler Unified Queue mock
 * node scripts/test-phase9-9-rhart-video-upscaler-queue.mjs
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

const PREFIX = `__p99_${Date.now().toString(36)}_`;
const UPS_PATH = '/rhart-video/video-upscaler';
const MODEL = 'rhart-video-upscaler';
const SKU = 'rhart-video-upscaler-720p';
const OSS_VID =
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p95b8-wan-animate-test/1788693477632_862b36a4.mp4';
const OUT = path.join(__dirname, 'phase9-9-rhart-video-upscaler-queue-test-result.json');
const QUOTED = 5;

const stats = { rh_submit_calls: 0, tests: [] };

function record(name, ok, detail) {
  stats.tests.push({ name, ok, detail });
  console.log(ok ? `[PASS] ${name}` : `[FAIL] ${name}`, detail || '');
}

function assertHttps(u, label) {
  const s = String(u || '').trim();
  if (!s.startsWith('https://')) throw new Error(`${label} must https: ${s}`);
  if (/^(openapi|api)\//i.test(s)) throw new Error(`${label} must not be RH fileName`);
  return s;
}

function buildUpsForward({
  targetResolution = '720p',
  videoUrl = OSS_VID,
} = {}) {
  const raw = String(targetResolution || '1080p').trim().toLowerCase();
  const res =
    raw === '720p' || raw === '1080p' || raw === '2k' || raw === '4k' ? raw : '1080p';
  assertHttps(videoUrl, 'video');
  return {
    provider: 'runninghub',
    path: UPS_PATH,
    method: 'POST',
    body: {
      videoUrl,
      targetResolution: res,
    },
    billingModelId: `rhart-video-upscaler-${res}`,
    rhRegion: 'cn',
  };
}

async function setBalance(userId, balance) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p99.local` });
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
      provider_task_id: pid || `rh_ups_${crypto.randomUUID()}`,
      data: {},
      rhRegion: forward?.rhRegion || null,
    };
  };
}

async function createQueueTask(userId, forward, sku, quoted, nodeData = {}) {
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
        prompt: '',
        nxCloudQueueGoldenPath: true,
        referenceVideoUrl: OSS_VID,
        targetResolution: '720p',
      },
      nodeData: {
        model: MODEL,
        mediaDurationSec: 5,
        targetResolution: '720p',
        ...nodeData,
      },
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

function gateUps(input) {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '') !== MODEL) return false;
  if (!String(input.referenceVideoUrl || '').trim()) return false;
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

  {
    const fwd = buildUpsForward();
    const pick = pickRunningHubTarget(fwd.path, { regionHint: fwd.rhRegion });
    record(
      'create_forward_shape',
      fwd.rhRegion === 'cn' &&
        fwd.path === UPS_PATH &&
        !fwd.body.nodeInfoList &&
        fwd.body.videoUrl?.startsWith('https://') &&
        fwd.body.targetResolution === '720p' &&
        fwd.billingModelId === SKU &&
        pick.region === 'cn',
      { path: fwd.path, sku: fwd.billingModelId, pick: pick.region },
    );
  }

  {
    const f720 = buildUpsForward({ targetResolution: '720p' });
    const f4k = buildUpsForward({ targetResolution: '4k' });
    record(
      'resolution_sku',
      f720.body.targetResolution === '720p' &&
        f4k.body.targetResolution === '4k' &&
        f720.billingModelId === 'rhart-video-upscaler-720p' &&
        f4k.billingModelId === 'rhart-video-upscaler-4k',
      {},
    );
  }

  {
    let rejectedRhFile = false;
    try {
      buildUpsForward({ videoUrl: 'openapi/x.mp4' });
    } catch {
      rejectedRhFile = true;
    }
    record('media_must_be_oss_https', rejectedRhFile === true, { rejectedRhFile });
  }

  {
    const noDur = buildUpsForward();
    record(
      'duration_not_in_rh_body',
      noDur.body.duration == null && noDur.body.mediaDurationSec == null,
      { keys: Object.keys(noDur.body) },
    );
  }

  {
    const before = stats.rh_submit_calls;
    const bal0 = (await db.getUserById(uid)).balance;
    const tid = await createQueueTask(uid, buildUpsForward(), SKU, QUOTED);
    const t0 = await db.getTaskById(tid);
    const stored = JSON.parse(t0.provider_forward_json || '{}');
    record(
      'test_create_queued',
      t0.status === 'queued' && Number(t0.queue_entered_at || 0) > 0 && stored.path === UPS_PATH,
      { status: t0.status },
    );

    const claimed = await promoteUntilClaimed(tid, uid);
    record('test_claim', claimed?.status === 'claimed', { status: claimed?.status });

    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await chargeClaimedTask(tid, db);
    const bal1 = (await db.getUserById(uid)).balance;
    record('test_charge', Number(bal0) - Number(bal1) === QUOTED, {
      delta: Number(bal0) - Number(bal1),
    });

    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_ups_single') });
    const tD = await db.getTaskById(tid);
    record(
      'test_dispatch',
      tD.provider_task_id === 'rh_ups_single' && stats.rh_submit_calls === before + 1,
      { pid: tD.provider_task_id },
    );

    let pollRegion = null;
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async (_pid, opts) => {
        pollRegion = opts?.rhRegion || null;
        return { ok: true, status: 'SUCCESS', result_url: 'https://example.com/ups-golden.mp4' };
      },
    });
    const t1 = await db.getTaskById(tid);
    const userSnap = await db.getUserConcurrencyCounterSnapshot(uid, 'video');
    record('test_poll_cn', pollRegion === 'cn', { seen: pollRegion });
    record(
      'test_success_release',
      t1.status === 'success' &&
        String(t1.execution_stage || '') === 'done' &&
        String(t1.result_oss_url || '').includes('ups-golden') &&
        String(t1.user_slot_held || '0') !== '1' &&
        Number(userSnap?.occupied ?? userSnap?.running ?? 0) === 0,
      { status: t1.status, stage: t1.execution_stage },
    );
  }

  {
    const before = stats.rh_submit_calls;
    const tid = await createQueueTask(uid, buildUpsForward({ targetResolution: '720p' }), SKU, QUOTED);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    await chargeClaimedTask(tid, db);
    await Promise.all(
      Array.from({ length: 10 }, () =>
        dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_ups_storm') }),
      ),
    );
    const t = await db.getTaskById(tid);
    record(
      'dup_dispatch_one_rh',
      stats.rh_submit_calls === before + 1 && t.provider_task_id === 'rh_ups_storm',
      { submits: stats.rh_submit_calls - before },
    );
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/ups.mp4',
      }),
    });
  }

  {
    const tid = await createQueueTask(uid, buildUpsForward(), SKU, QUOTED);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    const bal0 = (await db.getUserById(uid)).balance;
    for (let i = 0; i < 10; i++) await chargeClaimedTask(tid, db);
    const bal1 = (await db.getUserById(uid)).balance;
    record('dup_charge_once', Number(bal0) - Number(bal1) === QUOTED, {
      delta: Number(bal0) - Number(bal1),
    });
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_ups_chg') });
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/ups.mp4',
      }),
    });
  }

  {
    const tid = await createQueueTask(uid, buildUpsForward(), SKU, QUOTED);
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
    const userSnap = await db.getUserConcurrencyCounterSnapshot(uid, 'video');
    record(
      'submit_fail_refund_release',
      t.status === 'failed' &&
        !String(t.provider_task_id || '').trim() &&
        Number(bal0) === Number(bal1) &&
        Number(userSnap?.occupied ?? userSnap?.running ?? 0) === 0,
      { status: t.status },
    );
  }

  {
    const tid = await createQueueTask(uid, buildUpsForward(), SKU, QUOTED);
    const bal0 = (await db.getUserById(uid)).balance;
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    await chargeClaimedTask(tid, db);
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_ups_fail') });
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

  {
    const before = stats.rh_submit_calls;
    const tid = await createQueueTask(uid, buildUpsForward(), SKU, QUOTED);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    await chargeClaimedTask(tid, db);
    await dispatchOneChargedTask(tid, db, {
      submitRunningHub: async () => {
        stats.rh_submit_calls += 1;
        return { ok: false, reason: 'NETWORK_TIMEOUT_UNKNOWN', unknown: true };
      },
    });
    const t1 = await db.getTaskById(tid);
    await dispatchOneChargedTask(tid, db, {
      submitRunningHub: async () => {
        stats.rh_submit_calls += 1;
        return { ok: true, provider_task_id: 'should_not' };
      },
    });
    const t2 = await db.getTaskById(tid);
    record(
      'timeout_unknown_no_blind_recreate',
      t1.status === 'failed' && !t1.provider_task_id && stats.rh_submit_calls === before + 1 && t2.status === 'failed',
      { status1: t1.status, submits: stats.rh_submit_calls - before },
    );
  }

  {
    const on = gateUps({
      nxCloudQueueGoldenPath: true,
      model: MODEL,
      referenceVideoUrl: OSS_VID,
    });
    const noVideo = gateUps({
      nxCloudQueueGoldenPath: true,
      model: MODEL,
    });
    const dramaOff = gateUps({
      nxCloudQueueGoldenPath: true,
      model: MODEL,
      referenceVideoUrl: OSS_VID,
      drama: true,
    });
    const gp = fs.readFileSync(
      path.resolve(__dirname, '../../../src/shared/videoQueueGoldenPath.ts'),
      'utf8',
    );
    const vp = fs.readFileSync(
      path.resolve(__dirname, '../../../src/main/ai/providers/VideoProvider.ts'),
      'utf8',
    );
    const queueOnly =
      /VIDEO_QUEUE_RHART_VIDEO_UPSCALER_MODEL/.test(gp) &&
      /VIDEO_QUEUE_ONLY_MODEL_IDS[\s\S]*VIDEO_QUEUE_RHART_VIDEO_UPSCALER_MODEL/.test(gp);
    const hasEarly =
      vp.includes('executeRhartVideoUpscalerCloudQueueGoldenPath') &&
      vp.includes('isCanvasRhartVideoUpscalerQueueGoldenPathInput');
    const directSealed = vp.includes('rhart-video-upscaler 已强制云端排队，禁止 Direct');
    const onlyBlock = gp.match(
      /export const VIDEO_QUEUE_ONLY_MODEL_IDS = \[([\s\S]*?)\] as const/,
    );
    const noHeyGemInQueueOnly =
      !!onlyBlock && !/hey-gem|HEY_GEM/.test(onlyBlock[1] || '');
    const heyGemDirectStillPresent =
      /isHeyGemModel/.test(vp) && /2071200225913565185/.test(vp);
    record('gate_on', on === true, { on });
    record('gate_requires_video', noVideo === false, { noVideo });
    record('gate_drama_excluded', dramaOff === false, { dramaOff });
    record('queue_only_forced', queueOnly === true, { queueOnly });
    record('gate_on_no_direct_after_queue', hasEarly && directSealed, { hasEarly, directSealed });
    record(
      'hey_gem_not_migrated',
      noHeyGemInQueueOnly && heyGemDirectStillPresent,
      { noHeyGemInQueueOnly, heyGemDirectStillPresent },
    );
  }

  {
    const gp = fs.readFileSync(
      path.resolve(__dirname, '../../../src/shared/videoQueueGoldenPath.ts'),
      'utf8',
    );
    record(
      'regression_prior_queue_only',
      /VIDEO_QUEUE_ONLY_MODEL_IDS[\s\S]*VIDEO_QUEUE_H3_MULTI_MODEL[\s\S]*VIDEO_QUEUE_H3_AUDIO_MODEL[\s\S]*VIDEO_QUEUE_WAN_ANIMATE_MODEL[\s\S]*VIDEO_QUEUE_WAN_ANIMATE_2_MODEL/.test(
        gp,
      ),
      {},
    );
  }

  const failed = stats.tests.filter((t) => !t.ok);
  const result = {
    phase: '9.9-rhart-video-upscaler',
    conclusion: failed.length === 0 ? 'PASS' : 'FAIL',
    finished_at: new Date().toISOString(),
    rh_submit_calls: stats.rh_submit_calls,
    pass: stats.tests.filter((t) => t.ok).length,
    fail: failed.length,
    tests: stats.tests,
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log('\n===', result.conclusion, `${result.pass}/${stats.tests.length}`, '→', OUT);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
