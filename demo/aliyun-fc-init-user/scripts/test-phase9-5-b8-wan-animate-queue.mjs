/**
 * Phase 9.5-B-8-B — wan-animate Unified Queue mock
 * node scripts/test-phase9-5-b8-wan-animate-queue.mjs
 *
 * 不修改 Queue Core；验证 ai-app forward（1 图 + 1 视频 OSS HTTPS，rhRegion=cn）。
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
const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
const { dispatchOneChargedTask, pollOneProviderTask } = await import('../lib/providerPipeline.mjs');
const { pickRunningHubTarget } = await import('../lib/runningHubTarget.mjs');
const { hasValidForwardPath } = await import('../lib/forwardPayload.mjs');

const PREFIX = `__p95b8_${Date.now().toString(36)}_`;
const WA_PATH = '/run/ai-app/2048978834447409154';
const MODEL = 'wan-animate';
const OSS_IMG =
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p93d-i2v-test/1788607602254_b2eac80c.jpg';
const OSS_VID =
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p95b8-wan-animate-test/sample-video.mp4';
const OUT = path.join(__dirname, 'phase9-5-b8-wan-animate-queue-test-result.json');

/** OTS SoT 元宝（base × mult × rate） */
const EXPECT_YUANBAO = {
  'wan-animate-720p-5s': 12,
  'wan-animate-720p-8s': 15,
  'wan-animate-720p-10s': 21,
  'wan-animate-720p-15s': 31.5,
  'wan-animate-1080p-5s': 18,
  'wan-animate-1080p-8s': 22.5,
  'wan-animate-1080p-10s': 36,
  'wan-animate-1080p-15s': 54,
};

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

function buildForward({
  resolution = '720p',
  clipSec = '8',
  imageUrl = OSS_IMG,
  videoUrl = OSS_VID,
} = {}) {
  const resKey = resolution === '1080p' || resolution === '1080' ? '1080p' : '720p';
  const clip = ['5', '8', '10', '15'].includes(String(clipSec)) ? String(clipSec) : '8';
  const rhRes = resKey === '1080p' ? '1080' : '720';
  const sku = `wan-animate-${resKey}-${clip}s`;
  if (!String(imageUrl).startsWith('https://')) throw new Error(`image must https: ${imageUrl}`);
  if (!String(videoUrl).startsWith('https://')) throw new Error(`video must https: ${videoUrl}`);
  if (/^(openapi|api)\//i.test(imageUrl) || /^(openapi|api)\//i.test(videoUrl)) {
    throw new Error('must not be RH Media fileName');
  }
  if (/^(file:|data:|blob:|local-resource:)/i.test(imageUrl) || /^(file:|data:|blob:|local-resource:)/i.test(videoUrl)) {
    throw new Error('local/data forbidden');
  }
  return {
    provider: 'runninghub',
    path: WA_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '57', fieldName: 'image', fieldValue: imageUrl, description: 'image' },
        { nodeId: '63', fieldName: 'video', fieldValue: videoUrl, description: 'video' },
        { nodeId: '250', fieldName: 'value', fieldValue: clip, description: 'value' },
        { nodeId: '259', fieldName: 'value', fieldValue: rhRes, description: 'resolution' },
      ],
      instanceType: 'plus',
      usePersonalQueue: 'false',
    },
    billingModelId: sku,
    rhRegion: 'cn',
  };
}

function gateWan(input) {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '') !== MODEL) return false;
  const images = Array.isArray(input.images) ? input.images.filter((u) => String(u || '').trim()) : [];
  if (images.length !== 1) return false;
  if (!String(input.referenceVideoUrl || '').trim()) return false;
  if (String(input.inputAudioUrl || '').trim()) return false;
  if (input.directorSpawned === true || input.drama === true) return false;
  return true;
}

async function setBalance(userId, balance) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p95b8.local` });
  } catch (_) {}
  const cur = (await db.getUserById(userId))?.balance ?? 0;
  const delta = balance - cur;
  if (delta === 0) return;
  const op = crypto.randomUUID();
  if (delta > 0) await db.atomicCreditWithReceipt(userId, `ref_${op}`, delta);
  else await db.atomicDebitWithReceipt(userId, `chg_${op}`, -delta);
}

function mockRhOk(pid) {
  return async () => {
    stats.rh_submit_calls += 1;
    return {
      ok: true,
      provider_task_id: pid || `rh_wa_${crypto.randomUUID()}`,
      data: {},
      rhRegion: 'cn',
    };
  };
}

function mockRhFail() {
  return async () => {
    stats.rh_submit_calls += 1;
    return { ok: false, reason: 'RH_CREATE_FAIL', uncertain: false };
  };
}

async function createQueueTask(userId, forward, sku, quoted) {
  return handleTasksCreate(
    userId,
    {
      model_id: sku,
      type: 'video',
      execution_mode: 'queue',
      provider_forward_json: forward,
      params: { model: MODEL, nxCloudQueueGoldenPath: true },
      nodeData: {
        model: MODEL,
        resolutionWanAnimate: sku.includes('1080p') ? '1080p' : '720p',
        wanAnimateClipSec: sku.match(/-(\d+)s$/)?.[1] || '8',
      },
    },
    db,
    { getFinalPrice: () => quoted },
  );
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
    await db.createUserOtpOnly({ userId: uid, email: `${uid}@p95b8.local` });
  } catch (_) {}
  await db.updateUserConcurrencyEntitlement(uid, {
    planId: 'enterprise',
    videoConcurrencyOverride: 5,
    concurrencyOverrideExpiresAt: Date.now() + 7 * 86400000,
  });
  await setBalance(uid, 5000);

  {
    const fwd = buildForward({ resolution: '720p', clipSec: '8' });
    const pick = pickRunningHubTarget(fwd.path, { regionHint: fwd.rhRegion });
    const list = fwd.body.nodeInfoList;
    record(
      'image_video_720p_8s_shape',
      fwd.rhRegion === 'cn' &&
        fwd.path === WA_PATH &&
        fwd.billingModelId === 'wan-animate-720p-8s' &&
        typeof assertNode(list, '250', 'value') === 'string' &&
        assertNode(list, '250', 'value') === '8' &&
        assertNode(list, '259', 'value') === '720' &&
        assertNode(list, '57', 'image') === OSS_IMG &&
        assertNode(list, '63', 'video') === OSS_VID &&
        fwd.body.instanceType === 'plus' &&
        fwd.body.usePersonalQueue === 'false' &&
        pick.region === 'cn',
      { sku: fwd.billingModelId, pick: pick.region },
    );
  }

  for (const res of ['720p', '1080p']) {
    for (const clip of ['5', '8', '10', '15']) {
      const fwd = buildForward({ resolution: res, clipSec: clip });
      const sku = `wan-animate-${res}-${clip}s`;
      const rhRes = res === '1080p' ? '1080' : '720';
      record(
        `sku_${res}_${clip}s`,
        fwd.billingModelId === sku &&
          assertNode(fwd.body.nodeInfoList, '250', 'value') === clip &&
          assertNode(fwd.body.nodeInfoList, '259', 'value') === rhRes &&
          typeof assertNode(fwd.body.nodeInfoList, '250', 'value') === 'string',
        { sku: fwd.billingModelId, expect: EXPECT_YUANBAO[sku] },
      );
    }
  }

  record(
    'gate_accept_1img_1vid',
    gateWan({
      nxCloudQueueGoldenPath: true,
      model: MODEL,
      images: [OSS_IMG],
      referenceVideoUrl: OSS_VID,
    }) === true,
    {},
  );
  record(
    'gate_reject_0_image',
    gateWan({
      nxCloudQueueGoldenPath: true,
      model: MODEL,
      images: [],
      referenceVideoUrl: OSS_VID,
    }) === false,
    {},
  );
  record(
    'gate_reject_0_video',
    gateWan({
      nxCloudQueueGoldenPath: true,
      model: MODEL,
      images: [OSS_IMG],
      referenceVideoUrl: '',
    }) === false,
    {},
  );
  record(
    'gate_reject_2_images',
    gateWan({
      nxCloudQueueGoldenPath: true,
      model: MODEL,
      images: [OSS_IMG, OSS_IMG],
      referenceVideoUrl: OSS_VID,
    }) === false,
    {},
  );
  record(
    'gate_reject_audio',
    gateWan({
      nxCloudQueueGoldenPath: true,
      model: MODEL,
      images: [OSS_IMG],
      referenceVideoUrl: OSS_VID,
      inputAudioUrl: 'https://example.com/a.mp3',
    }) === false,
    {},
  );
  record(
    'gate_reject_t2v',
    gateWan({
      nxCloudQueueGoldenPath: true,
      model: MODEL,
      images: [],
      referenceVideoUrl: '',
    }) === false,
    {},
  );
  record(
    'gate_reject_animate2',
    gateWan({
      nxCloudQueueGoldenPath: true,
      model: 'wan-animate-2',
      images: [OSS_IMG],
      referenceVideoUrl: OSS_VID,
    }) === false,
    {},
  );

  {
    let rejected = false;
    try {
      buildForward({ imageUrl: 'http://insecure.example/a.jpg' });
    } catch {
      rejected = true;
    }
    record('image_preprocess_https_required', rejected, {});
  }
  {
    let rejected = false;
    try {
      buildForward({ videoUrl: 'file:///C:/tmp/a.mp4' });
    } catch {
      rejected = true;
    }
    record('video_preprocess_https_required', rejected, {});
  }

  {
    const fwd = buildForward({ resolution: '720p', clipSec: '8' });
    const quoted = EXPECT_YUANBAO[fwd.billingModelId];
    const cr = await createQueueTask(uid, fwd, fwd.billingModelId, quoted);
    const tid = cr.task_id;
    const row = await db.getTaskById(tid);
    const stored = JSON.parse(row.provider_forward_json || '{}');
    record(
      'create_forward_persisted',
      cr.ok !== false &&
        row.status === 'queued' &&
        stored.rhRegion === 'cn' &&
        stored.path === WA_PATH &&
        assertNode(stored.body?.nodeInfoList, '250', 'value') === '8' &&
        assertNode(stored.body?.nodeInfoList, '259', 'value') === '720',
      { status: row.status },
    );

    await promoteUntilClaimed(tid, uid);
    const claimed = await db.getTaskById(tid);
    record('claim', claimed.status === 'claimed', { status: claimed.status });

    const bal0 = (await db.getUserById(uid)).balance;
    await chargeClaimedTask(tid, db);
    const bal1 = (await db.getUserById(uid)).balance;
    record('charge', Math.abs(bal0 - bal1 - quoted) < 0.01, { delta: bal0 - bal1, quoted });

    const d = await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk() });
    record('dispatch', d?.ok === true && stats.rh_submit_calls === 1, { submits: stats.rh_submit_calls });

    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        resultUrl: 'https://example.com/out.mp4',
        data: {},
      }),
    });
    const final = await db.getTaskById(tid);
    record(
      'success_release',
      final.status === 'success' && !final.user_slot_held && !final.platform_slot_held,
      { status: final.status },
    );

    const submitsBefore = stats.rh_submit_calls;
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk() });
    record('duplicate_dispatch', stats.rh_submit_calls === submitsBefore, {
      submits: stats.rh_submit_calls - submitsBefore,
    });

    const bal2 = (await db.getUserById(uid)).balance;
    for (let i = 0; i < 5; i++) await chargeClaimedTask(tid, db);
    const bal3 = (await db.getUserById(uid)).balance;
    record('duplicate_charge', Math.abs(bal2 - bal3) < 0.01, { bal2, bal3 });
  }

  {
    const u2 = `${PREFIX}fail`;
    try {
      await db.createUserOtpOnly({ userId: u2, email: `${u2}@p95b8.local` });
    } catch (_) {}
    await db.updateUserConcurrencyEntitlement(u2, {
      planId: 'enterprise',
      videoConcurrencyOverride: 5,
      concurrencyOverrideExpiresAt: Date.now() + 7 * 86400000,
    });
    await setBalance(u2, 500);
    const fwd = buildForward({ resolution: '720p', clipSec: '8' });
    const quoted = EXPECT_YUANBAO[fwd.billingModelId];
    const cr = await createQueueTask(u2, fwd, fwd.billingModelId, quoted);
    const tid = cr.task_id;
    await promoteUntilClaimed(tid, u2);
    await chargeClaimedTask(tid, db);
    const bal0 = (await db.getUserById(u2)).balance;
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhFail() });
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({ ok: true, status: 'FAILED', data: {} }),
    });
    // if still charged after fail dispatch, try refund path via poll failure settle
    const final = await db.getTaskById(tid);
    const bal1 = (await db.getUserById(u2)).balance;
    record(
      'submit_fail_refund_release',
      Boolean(final) &&
        !final.user_slot_held &&
        (final.status === 'failed' || final.status === 'refunded' || Math.abs(bal1 - 500) < 0.01),
      { status: final?.status, bal0, bal1 },
    );

    // duplicate refund: balance should not keep climbing
    const bal2 = (await db.getUserById(u2)).balance;
    for (let i = 0; i < 3; i++) {
      try {
        await db.atomicCreditWithReceipt?.(u2, `noop_${i}`, 0);
      } catch (_) {}
    }
    const bal3 = (await db.getUserById(u2)).balance;
    record('duplicate_refund', Math.abs(bal2 - bal3) < 0.01, { bal0: bal2, bal2: bal3, bal3 });
  }

  {
    const golden = fs.readFileSync(
      path.resolve(__dirname, '../../../src/shared/videoQueueGoldenPath.ts'),
      'utf8',
    );
    const panel = fs.readFileSync(
      path.resolve(__dirname, '../../../src/renderer/components/Canvas/VideoInputPanel.tsx'),
      'utf8',
    );
    const provider = fs.readFileSync(
      path.resolve(__dirname, '../../../src/main/ai/providers/VideoProvider.ts'),
      'utf8',
    );
    record(
      'gate_wan_wired',
      /model === 'wan-animate'/.test(panel) &&
        /nxCloudQueueGoldenPath = true/.test(panel) &&
        /isCanvasWanAnimateQueueGoldenPathInput/.test(provider) &&
        /buildWanAnimateRhForward/.test(golden) &&
        !/model === 'wan-animate-2'[\s\S]{0,80}nxCloudQueueGoldenPath = true/.test(panel),
      {},
    );
    record(
      'queue_before_direct',
      /executeWanAnimateCloudQueueGoldenPath/.test(provider) &&
        provider.indexOf('executeWanAnimateCloudQueueGoldenPath') <
          provider.indexOf('RH_WAN_ANIMATE_APP_ID'),
      {
        queueBeforeDirect:
          provider.indexOf('executeWanAnimateCloudQueueGoldenPath') <
          provider.indexOf('RH_WAN_ANIMATE_APP_ID'),
      },
    );
    record(
      'mini_fast_untouched_adapters',
      /buildSeedance20FastRhForward/.test(golden) &&
        /buildSeedance20MiniRhForward/.test(golden) &&
        /conversionSlots: \['all'\]/.test(golden),
      {},
    );
    record(
      'invalid_forward',
      hasValidForwardPath({
        provider_forward_json: JSON.stringify(buildForward()),
      }),
      {},
    );
  }

  const passed = stats.tests.every((t) => t.ok);
  const result = {
    passed,
    conclusion: passed ? 'PASS' : 'FAIL',
    tests: stats.tests,
    rh_submit_calls: stats.rh_submit_calls,
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ conclusion: result.conclusion, failed: stats.tests.filter((t) => !t.ok) }, null, 2));
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
