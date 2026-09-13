/**
 * Phase 9.10 — hey-gem Unified Queue mock
 * node scripts/test-phase9-10-hey-gem-queue.mjs
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

const PREFIX = `__p910_${Date.now().toString(36)}_`;
const HG_PATH = '/run/ai-app/2071200225913565185';
const MODEL = 'hey-gem';
const SKU = 'hey-gem-plus';
const OSS_VID =
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p95b8-wan-animate-test/1788693477632_862b36a4.mp4';
const OSS_AUD =
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p95b5-lipsync-test/1788675141908_d98cec33.mp3';
const OUT = path.join(__dirname, 'phase9-10-hey-gem-queue-test-result.json');
const QUOTED = 10;

const stats = { rh_submit_calls: 0, tests: [] };

function record(name, ok, detail) {
  stats.tests.push({ name, ok, detail });
  console.log(ok ? `[PASS] ${name}` : `[FAIL] ${name}`, detail || '');
}

function assertHttps(u, label) {
  const s = String(u || '').trim();
  if (!s.startsWith('https://')) throw new Error(`${label} must https`);
  if (/^(openapi|api)\//i.test(s)) throw new Error(`${label} RH fileName forbidden`);
  return s;
}

function buildHgForward({ videoUrl = OSS_VID, audioUrl = OSS_AUD } = {}) {
  assertHttps(videoUrl, 'video');
  assertHttps(audioUrl, 'audio');
  return {
    provider: 'runninghub',
    path: HG_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '1', fieldName: 'file', fieldValue: videoUrl, description: 'file' },
        { nodeId: '4', fieldName: 'audio', fieldValue: audioUrl, description: 'audio' },
      ],
      instanceType: 'plus',
      usePersonalQueue: 'false',
    },
    billingModelId: SKU,
    rhRegion: 'cn',
  };
}

async function setBalance(userId, balance) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p910.local` });
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
      provider_task_id: pid || `rh_hg_${crypto.randomUUID()}`,
      data: {},
      rhRegion: forward?.rhRegion || null,
    };
  };
}

async function createQueueTask(userId, forward, quoted = QUOTED) {
  const r = await handleTasksCreate(
    userId,
    {
      model_id: SKU,
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
        inputAudioUrl: OSS_AUD,
      },
      nodeData: { model: MODEL, hasVideo: true, hasAudio: true },
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

function gateHg(input) {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '') !== MODEL) return false;
  if (!String(input.referenceVideoUrl || '').trim()) return false;
  if (!String(input.inputAudioUrl || '').trim()) return false;
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
    const fwd = buildHgForward();
    const pick = pickRunningHubTarget(fwd.path, { regionHint: fwd.rhRegion });
    const nodes = fwd.body.nodeInfoList;
    record(
      'create_forward_shape',
      fwd.rhRegion === 'cn' &&
        fwd.path === HG_PATH &&
        fwd.body.instanceType === 'plus' &&
        nodes.find((n) => n.nodeId === '1')?.fieldValue?.startsWith('https://') &&
        nodes.find((n) => n.nodeId === '4')?.fieldValue?.startsWith('https://') &&
        pick.region === 'cn',
      { path: fwd.path, sku: fwd.billingModelId },
    );
  }

  {
    let rejected = false;
    try {
      buildHgForward({ videoUrl: 'openapi/x.mp4' });
    } catch {
      rejected = true;
    }
    record('media_must_be_oss_https', rejected === true, { rejected });
  }

  {
    const before = stats.rh_submit_calls;
    const bal0 = (await db.getUserById(uid)).balance;
    const tid = await createQueueTask(uid, buildHgForward());
    const t0 = await db.getTaskById(tid);
    record(
      'test_create_queued',
      t0.status === 'queued' && Number(t0.queue_entered_at || 0) > 0,
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
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_hg_single') });
    const tD = await db.getTaskById(tid);
    record(
      'test_dispatch',
      tD.provider_task_id === 'rh_hg_single' && stats.rh_submit_calls === before + 1,
      { pid: tD.provider_task_id },
    );
    let pollRegion = null;
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async (_pid, opts) => {
        pollRegion = opts?.rhRegion || null;
        return { ok: true, status: 'SUCCESS', result_url: 'https://example.com/hg-golden.mp4' };
      },
    });
    const t1 = await db.getTaskById(tid);
    const userSnap = await db.getUserConcurrencyCounterSnapshot(uid, 'video');
    record('test_poll_cn', pollRegion === 'cn', { seen: pollRegion });
    record(
      'test_success_release',
      t1.status === 'success' &&
        t1.execution_stage === 'done' &&
        String(t1.result_oss_url || '').includes('hg-golden') &&
        String(t1.user_slot_held || '0') !== '1' &&
        Number(userSnap?.occupied ?? userSnap?.running ?? 0) === 0,
      { status: t1.status },
    );
  }

  {
    const before = stats.rh_submit_calls;
    const tid = await createQueueTask(uid, buildHgForward());
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    await chargeClaimedTask(tid, db);
    await Promise.all(
      Array.from({ length: 10 }, () =>
        dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_hg_storm') }),
      ),
    );
    const t = await db.getTaskById(tid);
    record(
      'dup_dispatch_one_rh',
      stats.rh_submit_calls === before + 1 && t.provider_task_id === 'rh_hg_storm',
      { submits: stats.rh_submit_calls - before },
    );
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/hg.mp4',
      }),
    });
  }

  {
    const tid = await createQueueTask(uid, buildHgForward());
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    const bal0 = (await db.getUserById(uid)).balance;
    for (let i = 0; i < 10; i++) await chargeClaimedTask(tid, db);
    const bal1 = (await db.getUserById(uid)).balance;
    record('dup_charge_once', Number(bal0) - Number(bal1) === QUOTED, {
      delta: Number(bal0) - Number(bal1),
    });
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_hg_chg') });
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/hg.mp4',
      }),
    });
  }

  {
    const tid = await createQueueTask(uid, buildHgForward());
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
    const tid = await createQueueTask(uid, buildHgForward());
    const bal0 = (await db.getUserById(uid)).balance;
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    await chargeClaimedTask(tid, db);
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_hg_fail') });
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({ ok: true, status: 'FAILED', error: 'mock' }),
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
    const tid = await createQueueTask(uid, buildHgForward());
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
      { submits: stats.rh_submit_calls - before },
    );
  }

  {
    const on = gateHg({
      nxCloudQueueGoldenPath: true,
      model: MODEL,
      referenceVideoUrl: OSS_VID,
      inputAudioUrl: OSS_AUD,
    });
    const noAudio = gateHg({
      nxCloudQueueGoldenPath: true,
      model: MODEL,
      referenceVideoUrl: OSS_VID,
    });
    const dramaOff = gateHg({
      nxCloudQueueGoldenPath: true,
      model: MODEL,
      referenceVideoUrl: OSS_VID,
      inputAudioUrl: OSS_AUD,
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
    const onlyBlock = gp.match(/export const VIDEO_QUEUE_ONLY_MODEL_IDS = \[([\s\S]*?)\] as const/);
    const queueOnly =
      !!onlyBlock && /VIDEO_QUEUE_HEY_GEM_MODEL/.test(onlyBlock[1] || '');
    const hasEarly =
      vp.includes('executeHeyGemCloudQueueGoldenPath') &&
      vp.includes('isCanvasHeyGemQueueGoldenPathInput');
    const directSealed = vp.includes('hey-gem 已强制云端排队，禁止 Direct');
    const priorStill =
      /VIDEO_QUEUE_H3_MULTI_MODEL/.test(onlyBlock?.[1] || '') &&
      /VIDEO_QUEUE_H3_AUDIO_MODEL/.test(onlyBlock?.[1] || '') &&
      /VIDEO_QUEUE_WAN_ANIMATE_MODEL/.test(onlyBlock?.[1] || '') &&
      /VIDEO_QUEUE_WAN_ANIMATE_2_MODEL/.test(onlyBlock?.[1] || '') &&
      /VIDEO_QUEUE_RHART_VIDEO_UPSCALER_MODEL/.test(onlyBlock?.[1] || '');
    record('gate_on', on === true, {});
    record('gate_requires_audio', noAudio === false, {});
    record('gate_drama_excluded', dramaOff === false, {});
    record('queue_only_forced', queueOnly === true, {});
    record('gate_on_no_direct_after_queue', hasEarly && directSealed, {
      hasEarly,
      directSealed,
    });
    record('regression_prior_queue_only', priorStill === true, {});
  }

  const failed = stats.tests.filter((t) => !t.ok);
  const result = {
    phase: '9.10-hey-gem',
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
