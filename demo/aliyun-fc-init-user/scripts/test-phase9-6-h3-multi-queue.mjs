/**
 * Phase 9.6 — MiniMax H3 Multi Unified Queue mock
 * node scripts/test-phase9-6-h3-multi-queue.mjs
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

const PREFIX = `__p96_${Date.now().toString(36)}_`;
const MULTI_PATH = '/run/ai-app/2086289185186603010';
const H3_MULTI_SKU = 'minimax-h3-multi-720p-6s';
const OUT = path.join(__dirname, 'phase9-6-h3-multi-queue-test-result.json');
const RH_IMG = 'openapi/p96/mock-img1.jpg';
const RH_AUD = 'openapi/p96/mock-audio1.mp3';

const stats = { rh_submit_calls: 0, tests: [] };

function record(name, ok, detail) {
  stats.tests.push({ name, ok, detail });
  console.log(ok ? `[PASS] ${name}` : `[FAIL] ${name}`, detail || '');
}

function assertRhMedia(nodeInfoList) {
  const images = [];
  const audios = [];
  for (const n of nodeInfoList || []) {
    const fn = String(n.fieldName || '').toLowerCase();
    const desc = String(n.description || '');
    const v = String(n.fieldValue || '').trim();
    if (!v) continue;
    const isImage = fn === 'image' || /^image\d+$/i.test(desc) || /参考图|上传图像/i.test(desc);
    const isAudio = fn === 'audio' || /参考音|参考音频/i.test(desc);
    if (!isImage && !isAudio) continue;
    if (!/^(openapi|api)\//i.test(v)) throw new Error(`bad fileName: ${v}`);
    if (isAudio) audios.push(v);
    else images.push(v);
  }
  return { images, audios };
}

function buildH3MultiForward(prompt = 'h3 multi mock', durationSec = '6', opts = {}) {
  const images = opts.images ?? [RH_IMG];
  const audios = opts.audios ?? [];
  const nodeInfoList = [
    { nodeId: '25', fieldName: 'value', fieldValue: prompt, description: '提示词' },
    { nodeId: '26', fieldName: 'aspect_ratio', fieldValue: '16:9 (Widescreen)', description: '比例' },
    { nodeId: '26', fieldName: 'megapixels', fieldValue: '0.9', description: '分辨率（看介绍）' },
    { nodeId: '28', fieldName: 'value', fieldValue: String(durationSec), description: '时长' },
  ];
  const IMAGE_SLOTS = [
    { nodeId: '18', description: 'image1' },
    { nodeId: '23', description: 'image2' },
    { nodeId: '22', description: 'image3' },
  ];
  images.slice(0, 9).forEach((f, i) => {
    nodeInfoList.push({
      nodeId: IMAGE_SLOTS[i]?.nodeId || String(18 + i),
      fieldName: 'image',
      fieldValue: f,
      description: IMAGE_SLOTS[i]?.description || `image${i + 1}`,
    });
  });
  const AUDIO_SLOTS = [
    { nodeId: '38', description: '参考音1' },
    { nodeId: '67', description: '参考音2' },
    { nodeId: '68', description: '参考音3' },
  ];
  audios.slice(0, 3).forEach((f, i) => {
    nodeInfoList.push({
      nodeId: AUDIO_SLOTS[i].nodeId,
      fieldName: 'audio',
      fieldValue: f,
      description: AUDIO_SLOTS[i].description,
    });
  });
  assertRhMedia(nodeInfoList);
  const sku = `minimax-h3-multi-720p-${durationSec}s`;
  return {
    provider: 'runninghub',
    path: MULTI_PATH,
    method: 'POST',
    body: {
      nodeInfoList,
      instanceType: 'plus',
      randomSeed: true,
      retainSeconds: 0,
      usePersonalQueue: 'false',
    },
    billingModelId: sku,
    rhRegion: 'cn',
  };
}

function quotedForDur(sec) {
  const map = { 6: 5, 10: 9, 15: 14, 20: 18 };
  return map[Number(sec)] ?? 5;
}

async function setBalance(userId, balance) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p96.local` });
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
      provider_task_id: pid || `rh_h3multi_${crypto.randomUUID()}`,
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
        prompt: 'p96',
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

function gateH3Multi(input) {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '') !== 'minimax-h3-multi') return false;
  const images = Array.isArray(input.images) ? input.images.filter((u) => String(u || '').trim()) : [];
  if (images.length > 9) return false;
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
    const fwd = buildH3MultiForward();
    const pick = pickRunningHubTarget(fwd.path, { regionHint: fwd.rhRegion });
    const media = assertRhMedia(fwd.body.nodeInfoList);
    record(
      'create_forward_shape',
      fwd.rhRegion === 'cn' &&
        fwd.path === MULTI_PATH &&
        fwd.body.instanceType === 'plus' &&
        fwd.body.randomSeed === true &&
        fwd.body.retainSeconds === 0 &&
        media.images[0]?.startsWith('openapi/') &&
        pick.region === 'cn',
      { rhRegion: fwd.rhRegion, path: fwd.path, imgs: media.images.length, pick: pick.region },
    );
  }

  for (const sec of ['6', '10', '15', '20']) {
    const fwd = buildH3MultiForward(`dur ${sec}`, sec);
    const durNode = fwd.body.nodeInfoList.find((n) => n.nodeId === '28');
    record(
      `duration_${sec}s`,
      String(durNode?.fieldValue) === sec && fwd.billingModelId === `minimax-h3-multi-720p-${sec}s`,
      { field: durNode?.fieldValue, sku: fwd.billingModelId },
    );
  }

  {
    const fwd = buildH3MultiForward('with audio', '6', { images: [RH_IMG], audios: [RH_AUD] });
    const media = assertRhMedia(fwd.body.nodeInfoList);
    record(
      'audio_slot_ok',
      media.audios.length === 1 && media.audios[0] === RH_AUD,
      { audios: media.audios },
    );
  }

  {
    const before = stats.rh_submit_calls;
    const bal0 = (await db.getUserById(uid)).balance;
    const fwd = buildH3MultiForward();
    const tid = await createQueueTask(uid, fwd, 'minimax-h3-multi', H3_MULTI_SKU, quotedForDur(6), {
      durationMinimaxH3: '6',
    });
    const t0 = await db.getTaskById(tid);
    const stored = JSON.parse(t0.provider_forward_json || '{}');
    record(
      'test_create_queued',
      t0.status === 'queued' &&
        Number(t0.queue_entered_at || 0) > 0 &&
        stored.rhRegion === 'cn' &&
        stored.path === MULTI_PATH,
      { status: t0.status, qat: t0.queue_entered_at },
    );

    const claimed = await promoteUntilClaimed(tid, uid);
    record(
      'test_claim',
      claimed?.status === 'claimed' && Number(claimed?.claimed_at || 0) > 0,
      { status: claimed?.status, claimed_at: claimed?.claimed_at },
    );

    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await chargeClaimedTask(tid, db);
    const bal1 = (await db.getUserById(uid)).balance;
    const tCh = await db.getTaskById(tid);
    record(
      'test_charge',
      Number(bal0) - Number(bal1) === quotedForDur(6) && Number(tCh.charged_at || 0) > 0,
      { delta: Number(bal0) - Number(bal1), charged_at: tCh.charged_at },
    );

    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_h3multi_single') });
    const tD = await db.getTaskById(tid);
    record(
      'test_dispatch',
      tD.provider_task_id === 'rh_h3multi_single' && stats.rh_submit_calls === before + 1,
      { pid: tD.provider_task_id, submits: stats.rh_submit_calls - before },
    );

    let pollRegion = null;
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async (_pid, opts) => {
        pollRegion = opts?.rhRegion || null;
        return { ok: true, status: 'SUCCESS', result_url: 'https://example.com/h3-multi-golden.mp4' };
      },
    });
    const t1 = await db.getTaskById(tid);
    const userSnap = await db.getUserConcurrencyCounterSnapshot(uid, 'video');
    record('test_poll_cn', pollRegion === 'cn', { seen: pollRegion });
    record(
      'test_success_release',
      t1.status === 'success' &&
        String(t1.execution_stage || '') === 'done' &&
        String(t1.result_oss_url || '').includes('h3-multi-golden') &&
        String(t1.user_slot_held || '0') !== '1' &&
        Number(userSnap?.occupied ?? userSnap?.running ?? 0) === 0,
      {
        status: t1.status,
        stage: t1.execution_stage,
        completed_at: t1.completed_at ?? t1.finished_at ?? t1.updated_at,
        occupied: userSnap?.occupied ?? userSnap?.running,
      },
    );
  }

  {
    const before = stats.rh_submit_calls;
    const tid = await createQueueTask(uid, buildH3MultiForward('dup d'), 'minimax-h3-multi', H3_MULTI_SKU, 5);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    await chargeClaimedTask(tid, db);
    await Promise.all(
      Array.from({ length: 10 }, () =>
        dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_h3multi_storm') }),
      ),
    );
    const t = await db.getTaskById(tid);
    record(
      'dup_dispatch_one_rh',
      stats.rh_submit_calls === before + 1 && t.provider_task_id === 'rh_h3multi_storm',
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

  {
    const tid = await createQueueTask(uid, buildH3MultiForward('dup c'), 'minimax-h3-multi', H3_MULTI_SKU, 5);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    const bal0 = (await db.getUserById(uid)).balance;
    for (let i = 0; i < 10; i++) await chargeClaimedTask(tid, db);
    const bal1 = (await db.getUserById(uid)).balance;
    record('dup_charge_once', Number(bal0) - Number(bal1) === 5, {
      delta: Number(bal0) - Number(bal1),
    });
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_h3multi_chg') });
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/h3.mp4',
      }),
    });
  }

  {
    const bal0 = (await db.getUserById(uid)).balance;
    let rejectedLocal = false;
    try {
      assertRhMedia([
        { nodeId: '18', fieldName: 'image', fieldValue: 'local-resource://x.png', description: 'image1' },
      ]);
    } catch {
      rejectedLocal = true;
    }
    let rejectedHttps = false;
    try {
      assertRhMedia([
        {
          nodeId: '18',
          fieldName: 'image',
          fieldValue: 'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/x.jpg',
          description: 'image1',
        },
      ]);
    } catch {
      rejectedHttps = true;
    }
    record(
      'media_must_be_rh_filename',
      rejectedLocal && rejectedHttps && Number(bal0) === Number((await db.getUserById(uid)).balance),
      { rejectedLocal, rejectedHttps },
    );
  }

  {
    const tid = await createQueueTask(uid, buildH3MultiForward('submit fail'), 'minimax-h3-multi', H3_MULTI_SKU, 5);
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
      { status: t.status, bal0, bal1 },
    );
  }

  {
    const tid = await createQueueTask(uid, buildH3MultiForward('prov fail'), 'minimax-h3-multi', H3_MULTI_SKU, 5);
    const bal0 = (await db.getUserById(uid)).balance;
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await promoteUntilClaimed(tid, uid);
    await chargeClaimedTask(tid, db);
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_h3multi_fail') });
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
    const userSnap = await db.getUserConcurrencyCounterSnapshot(uid, 'video');
    record(
      'provider_fail_refund_once',
      Number(bal0) === Number(bal1) &&
        Number(bal1) === Number(bal2) &&
        Number(userSnap?.occupied ?? userSnap?.running ?? 0) === 0,
      { bal0, bal1, bal2 },
    );
  }

  {
    const on = gateH3Multi({
      nxCloudQueueGoldenPath: true,
      model: 'minimax-h3-multi',
      images: ['local-resource://a.png'],
      prompt: 'x',
    });
    const onText = gateH3Multi({
      nxCloudQueueGoldenPath: true,
      model: 'minimax-h3-multi',
      images: [],
      prompt: 'x',
    });
    const off = gateH3Multi({
      model: 'minimax-h3-multi',
      images: [],
      prompt: 'x',
    });
    const dramaOff = gateH3Multi({
      nxCloudQueueGoldenPath: true,
      model: 'minimax-h3-multi',
      drama: true,
      prompt: 'x',
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
      /VIDEO_QUEUE_H3_MULTI_MODEL/.test(gp) &&
      /VIDEO_QUEUE_ONLY_MODEL_IDS[\s\S]*VIDEO_QUEUE_H3_MULTI_MODEL/.test(gp);
    const hasEarly =
      vp.includes('executeMinimaxH3MultiCloudQueueGoldenPath') &&
      vp.includes('isCanvasMinimaxH3MultiQueueGoldenPathInput');
    const directSealed =
      vp.includes('已强制云端排队，禁止 Direct') &&
      vp.indexOf('executeMinimaxH3MultiCloudQueueGoldenPath') <
        vp.indexOf('已强制云端排队，禁止 Direct');
    record('gate_on', on === true && onText === true, { on, onText });
    record('gate_off_no_flag', off === false, { off });
    record('gate_drama_excluded', dramaOff === false, { dramaOff });
    record('queue_only_forced', queueOnly === true, { queueOnly });
    record('gate_on_no_direct_after_queue', hasEarly && directSealed, {
      hasEarly,
      directSealed,
    });
  }

  const failed = stats.tests.filter((t) => !t.ok);
  const result = {
    phase: '9.6-h3-multi',
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
