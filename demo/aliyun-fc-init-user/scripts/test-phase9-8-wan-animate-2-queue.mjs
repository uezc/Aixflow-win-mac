/**
 * Phase 9.8 — wan-animate-2 Unified Queue mock
 * node scripts/test-phase9-8-wan-animate-2-queue.mjs
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

const PREFIX = `__p98_${Date.now().toString(36)}_`;
const WA2_PATH = '/run/ai-app/2086818758475210753';
const WA1_PATH = '/run/ai-app/2048978834447409154';
const MODEL = 'wan-animate-2';
const SKU = 'wan-animate-2-720p';
const OSS_IMG =
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p93d-i2v-test/1788607602254_b2eac80c.jpg';
const OSS_VID =
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p95b8-wan-animate-test/sample-video.mp4';
const OUT = path.join(__dirname, 'phase9-8-wan-animate-2-queue-test-result.json');
const QUOTED = 8;

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

function buildWa2Forward({
  resolution = '720p',
  prompt = '',
  imageUrl = OSS_IMG,
  videoUrl = OSS_VID,
} = {}) {
  const resKey = resolution === '1080p' || resolution === '1080' ? '1080p' : '720p';
  const rhRes = resKey === '1080p' ? '1280' : '832';
  assertHttps(imageUrl, 'image');
  assertHttps(videoUrl, 'video');
  return {
    provider: 'runninghub',
    path: WA2_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '637', fieldName: 'value', fieldValue: rhRes, description: '分辨率' },
        { nodeId: '642', fieldName: 'value', fieldValue: String(prompt || ''), description: '提示词' },
        { nodeId: '651', fieldName: 'value', fieldValue: '', description: '原视频描述' },
        { nodeId: '647', fieldName: 'video', fieldValue: videoUrl, description: '原视频' },
        { nodeId: '655', fieldName: 'image', fieldValue: imageUrl, description: '替换参考图' },
      ],
      instanceType: 'plus',
      usePersonalQueue: 'false',
    },
    billingModelId: `wan-animate-2-${resKey}`,
    rhRegion: 'cn',
  };
}

async function setBalance(userId, balance) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p98.local` });
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
      provider_task_id: pid || `rh_wa2_${crypto.randomUUID()}`,
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
        prompt: 'p98',
        nxCloudQueueGoldenPath: true,
        images: [OSS_IMG],
        referenceVideoUrl: OSS_VID,
      },
      nodeData: { model: MODEL, mediaDurationSec: 1, resolutionWanAnimate: '720p', ...nodeData },
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

function gateWa2(input) {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '') !== MODEL) return false;
  const images = Array.isArray(input.images) ? input.images.filter((u) => String(u || '').trim()) : [];
  if (images.length !== 1) return false;
  if (!String(input.referenceVideoUrl || '').trim()) return false;
  if (String(input.inputAudioUrl || '').trim()) return false;
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
    const fwd = buildWa2Forward();
    const pick = pickRunningHubTarget(fwd.path, { regionHint: fwd.rhRegion });
    const nodes = fwd.body.nodeInfoList;
    const hasClip = nodes.some((n) => n.nodeId === '250' || n.nodeId === '259');
    record(
      'create_forward_shape',
      fwd.rhRegion === 'cn' &&
        fwd.path === WA2_PATH &&
        fwd.path !== WA1_PATH &&
        fwd.body.instanceType === 'plus' &&
        !hasClip &&
        nodes.find((n) => n.nodeId === '637')?.fieldValue === '832' &&
        nodes.find((n) => n.nodeId === '655')?.fieldValue?.startsWith('https://') &&
        nodes.find((n) => n.nodeId === '647')?.fieldValue?.startsWith('https://') &&
        pick.region === 'cn',
      { path: fwd.path, sku: fwd.billingModelId, pick: pick.region },
    );
  }

  {
    const f720 = buildWa2Forward({ resolution: '720p' });
    const f1080 = buildWa2Forward({ resolution: '1080p' });
    record(
      'resolution_mapping',
      f720.body.nodeInfoList.find((n) => n.nodeId === '637')?.fieldValue === '832' &&
        f1080.body.nodeInfoList.find((n) => n.nodeId === '637')?.fieldValue === '1280' &&
        f720.billingModelId === 'wan-animate-2-720p' &&
        f1080.billingModelId === 'wan-animate-2-1080p',
      {},
    );
  }

  {
    const withPrompt = buildWa2Forward({ prompt: 'swap face gently' });
    record(
      'optional_prompt',
      withPrompt.body.nodeInfoList.find((n) => n.nodeId === '642')?.fieldValue === 'swap face gently' &&
        buildWa2Forward({ prompt: '' }).body.nodeInfoList.find((n) => n.nodeId === '642')?.fieldValue === '',
      {},
    );
  }

  {
    let rejectedRhFile = false;
    try {
      buildWa2Forward({ imageUrl: 'openapi/x.jpg' });
    } catch {
      rejectedRhFile = true;
    }
    record('media_must_be_oss_https', rejectedRhFile === true, { rejectedRhFile });
  }

  {
    const before = stats.rh_submit_calls;
    const bal0 = (await db.getUserById(uid)).balance;
    const tid = await createQueueTask(uid, buildWa2Forward(), SKU, QUOTED);
    const t0 = await db.getTaskById(tid);
    const stored = JSON.parse(t0.provider_forward_json || '{}');
    record(
      'test_create_queued',
      t0.status === 'queued' && Number(t0.queue_entered_at || 0) > 0 && stored.path === WA2_PATH,
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

    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_wa2_single') });
    const tD = await db.getTaskById(tid);
    record(
      'test_dispatch',
      tD.provider_task_id === 'rh_wa2_single' && stats.rh_submit_calls === before + 1,
      { pid: tD.provider_task_id },
    );

    let pollRegion = null;
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async (_pid, opts) => {
        pollRegion = opts?.rhRegion || null;
        return { ok: true, status: 'SUCCESS', result_url: 'https://example.com/wa2-golden.mp4' };
      },
    });
    const t1 = await db.getTaskById(tid);
    const userSnap = await db.getUserConcurrencyCounterSnapshot(uid, 'video');
    record('test_poll_cn', pollRegion === 'cn', { seen: pollRegion });
    record(
      'test_success_release',
      t1.status === 'success' &&
        String(t1.execution_stage || '') === 'done' &&
        String(t1.result_oss_url || '').includes('wa2-golden') &&
        String(t1.user_slot_held || '0') !== '1' &&
        Number(userSnap?.occupied ?? userSnap?.running ?? 0) === 0,
      { status: t1.status, stage: t1.execution_stage },
    );
  }

  {
    const before = stats.rh_submit_calls;
    const tid = await createQueueTask(uid, buildWa2Forward({ prompt: 'dup' }), SKU, QUOTED);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    await chargeClaimedTask(tid, db);
    await Promise.all(
      Array.from({ length: 10 }, () =>
        dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_wa2_storm') }),
      ),
    );
    const t = await db.getTaskById(tid);
    record(
      'dup_dispatch_one_rh',
      stats.rh_submit_calls === before + 1 && t.provider_task_id === 'rh_wa2_storm',
      { submits: stats.rh_submit_calls - before },
    );
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/wa2.mp4',
      }),
    });
  }

  {
    const tid = await createQueueTask(uid, buildWa2Forward({ prompt: 'dupc' }), SKU, QUOTED);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    const bal0 = (await db.getUserById(uid)).balance;
    for (let i = 0; i < 10; i++) await chargeClaimedTask(tid, db);
    const bal1 = (await db.getUserById(uid)).balance;
    record('dup_charge_once', Number(bal0) - Number(bal1) === QUOTED, {
      delta: Number(bal0) - Number(bal1),
    });
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_wa2_chg') });
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/wa2.mp4',
      }),
    });
  }

  {
    const tid = await createQueueTask(uid, buildWa2Forward({ prompt: 'fail' }), SKU, QUOTED);
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
    const tid = await createQueueTask(uid, buildWa2Forward({ prompt: 'prov' }), SKU, QUOTED);
    const bal0 = (await db.getUserById(uid)).balance;
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    await chargeClaimedTask(tid, db);
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_wa2_fail') });
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
    const tid = await createQueueTask(uid, buildWa2Forward({ prompt: 'unk' }), SKU, QUOTED);
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
    const on = gateWa2({
      nxCloudQueueGoldenPath: true,
      model: MODEL,
      images: [OSS_IMG],
      referenceVideoUrl: OSS_VID,
      prompt: 'x',
    });
    const noVideo = gateWa2({
      nxCloudQueueGoldenPath: true,
      model: MODEL,
      images: [OSS_IMG],
      prompt: 'x',
    });
    const wrongModel = gateWa2({
      nxCloudQueueGoldenPath: true,
      model: 'wan-animate',
      images: [OSS_IMG],
      referenceVideoUrl: OSS_VID,
    });
    const dramaOff = gateWa2({
      nxCloudQueueGoldenPath: true,
      model: MODEL,
      images: [OSS_IMG],
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
      /VIDEO_QUEUE_WAN_ANIMATE_2_MODEL/.test(gp) &&
      /VIDEO_QUEUE_ONLY_MODEL_IDS[\s\S]*VIDEO_QUEUE_WAN_ANIMATE_2_MODEL/.test(gp);
    const hasEarly =
      vp.includes('executeWanAnimate2CloudQueueGoldenPath') &&
      vp.includes('isCanvasWanAnimate2QueueGoldenPathInput');
    const directSealed = vp.includes('wan-animate-2 已强制云端排队，禁止 Direct');
    const wa1Intact =
      /VIDEO_QUEUE_ONLY_MODEL_IDS[\s\S]*VIDEO_QUEUE_WAN_ANIMATE_MODEL/.test(gp) &&
      gp.includes("WAN_ANIMATE_APP_ID = '2048978834447409154'") &&
      gp.includes("WAN_ANIMATE_2_APP_ID = '2086818758475210753'");
    record('gate_on', on === true, { on });
    record('gate_requires_video', noVideo === false, { noVideo });
    record('gate_not_wan_animate_v1', wrongModel === false, { wrongModel });
    record('gate_drama_excluded', dramaOff === false, { dramaOff });
    record('queue_only_forced', queueOnly === true, { queueOnly });
    record('gate_on_no_direct_after_queue', hasEarly && directSealed, { hasEarly, directSealed });
    record('diff_appid_from_wan_animate', wa1Intact === true, { wa1Intact });
  }

  {
    const gp = fs.readFileSync(
      path.resolve(__dirname, '../../../src/shared/videoQueueGoldenPath.ts'),
      'utf8',
    );
    record(
      'regression_h3_multi_audio_queue_only',
      /VIDEO_QUEUE_ONLY_MODEL_IDS[\s\S]*VIDEO_QUEUE_H3_MULTI_MODEL[\s\S]*VIDEO_QUEUE_H3_AUDIO_MODEL/.test(
        gp,
      ),
      {},
    );
    record(
      'regression_wan_animate_v1_queue_only',
      /VIDEO_QUEUE_ONLY_MODEL_IDS[\s\S]*VIDEO_QUEUE_WAN_ANIMATE_MODEL/.test(gp),
      {},
    );
  }

  const failed = stats.tests.filter((t) => !t.ok);
  const result = {
    phase: '9.8-wan-animate-2',
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
