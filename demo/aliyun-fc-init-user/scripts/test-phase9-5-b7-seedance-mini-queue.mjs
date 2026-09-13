/**
 * Phase 9.5-B-7-B — Seedance 2.0 Mini Unified Queue mock
 * node scripts/test-phase9-5-b7-seedance-mini-queue.mjs
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

const PREFIX = `__p95b7_${Date.now().toString(36)}_`;
const SD_PATH = '/rhart-video/sparkvideo-2.0-mini/multimodal-video';
const OSS_IMG =
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p93d-i2v-test/1788607602254_b2eac80c.jpg';
const OSS_AUDIO =
  (fs.existsSync(path.join(__dirname, 'p95b5-lipsync-audio-url.txt'))
    ? fs.readFileSync(path.join(__dirname, 'p95b5-lipsync-audio-url.txt'), 'utf8').trim()
    : '') ||
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p95b5-lipsync-test/sample-audio.mp3';
const OSS_VIDEO =
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p95b7-mini-test/sample-video.mp4';
const OUT = path.join(__dirname, 'phase9-5-b7-seedance-mini-queue-test-result.json');
const MODEL = 'seedance-2.0-mini';
const QUOTED_720_5 = 36;

const stats = { rh_submit_calls: 0, tests: [] };

function record(name, ok, detail) {
  stats.tests.push({ name, ok, detail });
  console.log(ok ? `[PASS] ${name}` : `[FAIL] ${name}`, detail || '');
}

function buildForward({
  prompt = 'seedance mini mock',
  resolution = '720p',
  duration = '5',
  imageUrls = [],
  videoUrls = [],
  audioUrls = [],
} = {}) {
  const allowedRes = new Set(['480p', '720p', '1080p', '2k', '4k']);
  const res = allowedRes.has(String(resolution)) ? String(resolution) : '720p';
  const dur = ['5', '10', '15'].includes(String(duration)) ? String(duration) : '10';
  for (const list of [imageUrls, videoUrls, audioUrls]) {
    for (const u of list) {
      if (!String(u).startsWith('https://')) throw new Error(`url must https: ${u}`);
      if (/^(openapi|api)\//i.test(u)) throw new Error('RH Media forbidden');
    }
  }
  if (imageUrls.length > 9) throw new Error('max 9 images');
  if (videoUrls.length > 1) throw new Error('max 1 video');
  if (audioUrls.length > 1) throw new Error('max 1 audio');
  return {
    provider: 'runninghub',
    path: SD_PATH,
    method: 'POST',
    body: {
      prompt,
      resolution: res,
      duration: dur,
      imageUrls: [...imageUrls],
      videoUrls: [...videoUrls],
      audioUrls: [...audioUrls],
      generateAudio: true,
      ratio: 'adaptive',
      realPersonMode: true,
      conversionSlots: ['all'],
      returnLastFrame: false,
      seed: -1,
    },
    billingModelId: `seedance-2-0-mini-${res}-${dur}s`,
    rhRegion: 'cn',
  };
}

function gateMini(input) {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '') !== MODEL) return false;
  const images = Array.isArray(input.images) ? input.images.filter((u) => String(u || '').trim()) : [];
  if (images.length > 9) return false;
  if (input.directorSpawned === true || input.drama === true) return false;
  return true;
}

function gateFast(input) {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '') !== 'seedance-2.0-fast') return false;
  const images = Array.isArray(input.images) ? input.images.filter((u) => String(u || '').trim()) : [];
  if (images.length > 9) return false;
  if (String(input.inputAudioUrl || '').trim()) return false;
  if (String(input.referenceVideoUrl || '').trim()) return false;
  if (input.directorSpawned === true || input.drama === true) return false;
  return true;
}

async function setBalance(userId, balance) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p95b7.local` });
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
      provider_task_id: pid || `rh_sdmini_${crypto.randomUUID()}`,
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
        prompt: 'p95b7',
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

  {
    const fwd = buildForward({ resolution: '720p', duration: '5', imageUrls: [] });
    const pick = pickRunningHubTarget(fwd.path, { regionHint: fwd.rhRegion });
    record(
      't2v_720p_5s_shape',
      fwd.rhRegion === 'cn' &&
        fwd.path === SD_PATH &&
        fwd.billingModelId === 'seedance-2-0-mini-720p-5s' &&
        fwd.body.imageUrls.length === 0 &&
        fwd.body.videoUrls.length === 0 &&
        fwd.body.audioUrls.length === 0 &&
        typeof fwd.body.duration === 'string' &&
        Array.isArray(fwd.body.conversionSlots) &&
        fwd.body.conversionSlots[0] === 'all' &&
        pick.region === 'cn',
      { sku: fwd.billingModelId, pick: pick.region },
    );
  }

  {
    const fwd = buildForward({ resolution: '4k', duration: '10' });
    record(
      't2v_4k_10s_sku',
      fwd.billingModelId === 'seedance-2-0-mini-4k-10s' && fwd.body.resolution === '4k',
      { sku: fwd.billingModelId },
    );
  }

  {
    const fwd = buildForward({ imageUrls: [OSS_IMG] });
    record('i2v_1_image', fwd.body.imageUrls.length === 1 && fwd.body.imageUrls[0] === OSS_IMG, {});
  }

  {
    const urls = [OSS_IMG, `${OSS_IMG}?v=2`];
    const fwd = buildForward({ imageUrls: urls });
    record(
      'multi_2_images_order',
      fwd.body.imageUrls.length === 2 &&
        fwd.body.imageUrls[0] === urls[0] &&
        fwd.body.imageUrls[1] === urls[1],
      {},
    );
  }

  {
    const urls = Array.from({ length: 9 }, (_, i) => `${OSS_IMG}?i=${i}`);
    const fwd = buildForward({ imageUrls: urls });
    record('multi_9_images', fwd.body.imageUrls.length === 9, { n: fwd.body.imageUrls.length });
  }

  {
    let rejected = false;
    try {
      buildForward({ imageUrls: Array.from({ length: 10 }, (_, i) => `${OSS_IMG}?x=${i}`) });
    } catch {
      rejected = true;
    }
    record('invalid_10_images', rejected, {});
  }

  {
    const fwd = buildForward({
      imageUrls: [OSS_IMG],
      audioUrls: [OSS_AUDIO.startsWith('https://') ? OSS_AUDIO : `${OSS_IMG}?audio=1`],
    });
    record(
      'image_plus_audio',
      fwd.body.imageUrls.length === 1 &&
        fwd.body.audioUrls.length === 1 &&
        fwd.body.videoUrls.length === 0 &&
        fwd.body.conversionSlots?.[0] === 'all',
      {},
    );
  }

  {
    const fwd = buildForward({ videoUrls: [OSS_VIDEO], audioUrls: [OSS_AUDIO.startsWith('https://') ? OSS_AUDIO : `${OSS_IMG}?a=1`] });
    record(
      'video_plus_audio',
      fwd.body.videoUrls.length === 1 &&
        fwd.body.audioUrls.length === 1 &&
        fwd.body.imageUrls.length === 0 &&
        fwd.body.conversionSlots?.[0] === 'all',
      {},
    );
  }

  {
    const fwd = buildForward({
      imageUrls: [OSS_IMG],
      videoUrls: [OSS_VIDEO],
      audioUrls: [OSS_AUDIO.startsWith('https://') ? OSS_AUDIO : `${OSS_IMG}?a=1`],
    });
    record(
      'image_video_audio',
      fwd.body.imageUrls.length === 1 &&
        fwd.body.videoUrls.length === 1 &&
        fwd.body.audioUrls.length === 1 &&
        fwd.body.conversionSlots?.[0] === 'all',
      {},
    );
  }

  {
    const fwd = buildForward({ videoUrls: [OSS_VIDEO] });
    record('video_ref_only', fwd.body.videoUrls.length === 1 && fwd.body.imageUrls.length === 0, {});
  }

  {
    const aud = OSS_AUDIO.startsWith('https://') ? OSS_AUDIO : `${OSS_IMG}?a=1`;
    const fwd = buildForward({ audioUrls: [aud] });
    record('audio_only', fwd.body.audioUrls.length === 1 && fwd.body.imageUrls.length === 0, {});
  }

  {
    let rejected = false;
    try {
      buildForward({ imageUrls: ['http://insecure.example/a.jpg'] });
    } catch {
      rejected = true;
    }
    record('image_preprocess_https_required', rejected, {});
  }

  {
    record(
      'gate_mini_accepts_audio',
      gateMini({
        nxCloudQueueGoldenPath: true,
        model: MODEL,
        images: [OSS_IMG],
        inputAudioUrl: 'https://example.com/a.mp3',
      }) === true,
      {},
    );
    record(
      'gate_fast_rejects_audio',
      gateFast({
        nxCloudQueueGoldenPath: true,
        model: 'seedance-2.0-fast',
        images: [OSS_IMG],
        inputAudioUrl: 'https://example.com/a.mp3',
      }) === false,
      {},
    );
    record(
      'gate_mini_not_fast',
      gateMini({ nxCloudQueueGoldenPath: true, model: 'seedance-2.0-fast', images: [] }) === false,
      {},
    );
  }

  {
    const quoted = QUOTED_720_5;
    const bal0 = (await db.getUserById(uid)).balance;
    const fwd = buildForward({
      resolution: '720p',
      duration: '5',
      imageUrls: [OSS_IMG],
      audioUrls: [OSS_AUDIO.startsWith('https://') ? OSS_AUDIO : `${OSS_IMG}?a=1`],
    });
    const tid = await createQueueTask(uid, fwd, fwd.billingModelId, quoted, {
      resolutionSeedance: '720p',
      durationSeedance: '5',
    });
    const t0 = await db.getTaskById(tid);
    const stored = JSON.parse(t0.provider_forward_json || '{}');
    record(
      'create_forward_persisted',
      t0.status === 'queued' &&
        stored.rhRegion === 'cn' &&
        stored.path === SD_PATH &&
        stored.body?.duration === '5' &&
        stored.body?.conversionSlots?.[0] === 'all' &&
        stored.body?.audioUrls?.length === 1,
      { status: t0.status },
    );

    const claimed = await promoteUntilClaimed(tid, uid);
    record('claim', claimed?.status === 'claimed', { status: claimed?.status });

    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await chargeClaimedTask(tid, db);
    const bal1 = (await db.getUserById(uid)).balance;
    record('charge', Number(bal0) - Number(bal1) === quoted, {
      delta: Number(bal0) - Number(bal1),
    });

    const before = stats.rh_submit_calls;
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_sdmini_single') });
    record('dispatch', (await db.getTaskById(tid))?.provider_task_id === 'rh_sdmini_single', {
      submits: stats.rh_submit_calls - before,
    });

    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/seedance-mini.mp4',
      }),
    });
    const final = await db.getTaskById(tid);
    record(
      'success_release',
      final.status === 'success' &&
        !!final.result_oss_url &&
        !final.user_slot_held &&
        !final.platform_slot_held,
      { status: final.status },
    );

    const beforeDup = stats.rh_submit_calls;
    for (let i = 0; i < 10; i++) {
      await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('should_not') });
    }
    record('duplicate_dispatch', stats.rh_submit_calls === beforeDup, {
      submits: stats.rh_submit_calls - beforeDup,
    });
  }

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
    const quoted = QUOTED_720_5;
    const fwd = buildForward({ prompt: 'dup' });
    const tid = await createQueueTask(uDup, fwd, fwd.billingModelId, quoted);
    await promoteUntilClaimed(tid, uDup);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    const bal0 = (await db.getUserById(uDup)).balance;
    for (let i = 0; i < 10; i++) await chargeClaimedTask(tid, db);
    const bal1 = (await db.getUserById(uDup)).balance;
    record('duplicate_charge', Number(bal0) - Number(bal1) === quoted, {
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
    record('duplicate_refund', Number(bal2) === Number(bal3) && Number(bal2) === Number(bal0), {
      bal0,
      bal2,
      bal3,
    });
  }

  {
    const u = `${PREFIX}fail`;
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
    const fwd = buildForward({ prompt: 'fail' });
    const tid = await createQueueTask(u, fwd, fwd.billingModelId, QUOTED_720_5);
    await promoteUntilClaimed(tid, u);
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    await chargeClaimedTask(tid, db);
    await dispatchOneChargedTask(tid, db, {
      submitRunningHub: async () => ({ ok: false, error: 'SUBMIT_FAIL', rhRegion: 'cn' }),
    });
    const final = await db.getTaskById(tid);
    const bal1 = (await db.getUserById(u)).balance;
    record(
      'submit_fail_refund_release',
      ['failed', 'cancelled'].includes(String(final?.status)) &&
        Number(bal1) === Number(bal0) &&
        !final?.user_slot_held,
      { status: final?.status, bal0, bal1 },
    );
  }

  {
    const panel = fs.readFileSync(
      path.resolve(__dirname, '../../../src/renderer/components/Canvas/VideoInputPanel.tsx'),
      'utf8',
    );
    const autoMini =
      panel.includes("model === 'seedance-2.0-fast'") &&
      panel.includes("onModelChange('seedance-2.0-mini')");
    const gateMiniUi =
      /seedance-2\.0-fast' \|\| model === 'seedance-2\.0-mini'|seedance-2\.0-mini' \|\| model === 'seedance-2\.0-fast/.test(
        panel,
      ) || panel.includes("model === 'seedance-2.0-mini'");
    const vp = fs.readFileSync(
      path.resolve(__dirname, '../../../src/main/ai/providers/VideoProvider.ts'),
      'utf8',
    );
    const golden = fs.readFileSync(
      path.resolve(__dirname, '../../../src/shared/videoQueueGoldenPath.ts'),
      'utf8',
    );
    record('fast_to_mini_auto_switch_preserved', autoMini === true, { autoMini });
    record(
      'gate_mini_wired',
      golden.includes('buildSeedance20MiniRhForward') &&
        golden.includes('conversionSlots') &&
        vp.includes('executeSeedance20MiniCloudQueueGoldenPath') &&
        gateMiniUi,
      {},
    );
    record(
      'fast_forward_no_conversion_slots',
      /buildSeedance20FastRhForward[\s\S]*?returnLastFrame: false,\s*seed: -1,\s*\},/.test(golden) &&
        !/buildSeedance20FastRhForward[\s\S]{0,800}conversionSlots/.test(golden),
      {},
    );
    const queueIdx = vp.indexOf('executeSeedance20MiniCloudQueueGoldenPath');
    const directIdx = vp.indexOf('Seedance 2.0 Fast / Mini 多模态');
    record('queue_before_direct', queueIdx > 0 && directIdx > queueIdx, {
      queueBeforeDirect: queueIdx < directIdx,
    });
  }

  {
    record(
      'invalid_forward',
      hasValidForwardPath({ provider_forward_json: JSON.stringify(buildForward()) }) === true &&
        hasValidForwardPath({ provider_forward_json: '' }) === false,
      {},
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
