/**
 * Phase 9.5-B-2-B Live E2E — gemini-omni-flash Unified Queue（真实 FC + OTS + RH.ai）
 * Create 前：OSS HTTPS imageUrls（1 或 3）；duration 为 string；rhRegion=ai
 *
 * node scripts/live-phase9-5-b2-b-gemini-omni-flash-queue.mjs
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '../..');

function loadEnvFile(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvFile(path.join(REPO, '.env'));
loadEnvFile(path.join(ROOT, '.env'));
process.env.NX_SKIP_QUEUE_PIPELINE_ON_CREATE = '1';

const require = createRequire(path.join(ROOT, 'package.json'));
const jwt = require('jsonwebtoken');

const PREFIX = `__p95b2blive_${Date.now().toString(36)}_`;
const FC_BASE = (process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '').replace(/\/$/, '');
const FC_TOKEN = process.env.ALIYUN_FC_TOKEN || '';
const ADMIN_SECRET = process.env.ADMIN_SETTLE_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || '';
const RH_PATH = '/gemini-omni-flash/image-to-video';
const SKU = 'gemini-omni-flash-720p-10s';
const OSS_IMAGE =
  process.env.P95B2B_IMAGE_URL?.trim() ||
  (fs.existsSync(path.join(__dirname, 'p93d-i2v-image-url.txt'))
    ? fs.readFileSync(path.join(__dirname, 'p93d-i2v-image-url.txt'), 'utf8').trim()
    : '') ||
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p93d-i2v-test/1788607602254_b2eac80c.jpg';
const OUT = path.join(__dirname, 'phase9-5-b2-b-gemini-omni-flash-live-e2e-result.json');

const REPORT = {
  started_at: new Date().toISOString(),
  conclusion: 'BLOCKED',
  errors: [],
  live_a_1img: null,
  live_b_3img: null,
  regressions: {},
};

function log(msg) {
  console.log(`[p95b2b-live] ${msg}`);
}
function sign(userId, tv = 0) {
  return jwt.sign({ sub: userId, typ: 'access', tv }, JWT_SECRET, { expiresIn: '7d' });
}

async function fcFetch(pathSuffix, { body = {}, auth = null, timeoutMs = 180000 } = {}) {
  const url = `${FC_BASE}${pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`}`;
  const headers = { 'content-type': 'application/json', 'x-nexflow-token': FC_TOKEN };
  if (auth) headers.authorization = `Bearer ${auth}`;
  if (ADMIN_SECRET) headers['x-admin-settle-secret'] = ADMIN_SECRET;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 400) };
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}
async function fcInternal(name, body = {}) {
  return fcFetch(`/internal/${name}`, { body });
}

function buildGeminiForward(prompt, imageUrls, duration = '10', resolution = '720p', aspectRatio = '16:9') {
  return {
    provider: 'runninghub',
    path: RH_PATH,
    method: 'POST',
    body: {
      prompt,
      imageUrls,
      duration: String(duration),
      resolution,
      aspectRatio,
    },
    billingModelId: `gemini-omni-flash-${resolution}-${duration}s`,
    rhRegion: 'ai',
  };
}

const db = await import('../lib/db-tablestore.mjs');
const { tryClaimOneQueuedTask } = await import('../lib/queueScheduler.mjs');
const { hasValidForwardPath } = await import('../lib/forwardPayload.mjs');
const { getFinalPrice } = await import('../pricing/price_calculator.mjs');

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
async function setupUser(userId, balance = 5000) {
  try {
    await db.createUserOtpOnly({ userId: userId, email: `${userId}@p95b2b.local` });
  } catch (_) {}
  await db.updateUserConcurrencyEntitlement(userId, {
    planId: 'enterprise',
    videoConcurrencyOverride: 5,
    concurrencyOverrideExpiresAt: Date.now() + 7 * 86400000,
  });
  await setBalance(userId, balance);
  const u = await db.getUserById(userId);
  return sign(userId, u?.tokenVersion ?? 0);
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
async function promoteOneTask(taskId, userId) {
  const t = await db.getTaskById(taskId);
  if (!t || t.status !== 'queued') return t;
  await tryClaimOneQueuedTask(
    {
      taskId,
      userId,
      taskType: 'video',
      queueEnteredAt: Number(t.queue_entered_at || t.created_at || Date.now()),
    },
    await buildPromoteDeps(),
  );
  return db.getTaskById(taskId);
}
async function runFcWorkersUntil(taskId, { maxRounds = 60, intervalMs = 10000 } = {}) {
  for (let i = 0; i < maxRounds; i++) {
    await fcInternal('charge-claimed-tasks', { max_tasks: 50 });
    await fcInternal('dispatch-charged-tasks', { max_tasks: 50 });
    await fcInternal('poll-provider-tasks', { max_tasks: 50 });
    const t = await db.getTaskById(taskId);
    log(`r${i} status=${t?.status} pid=${String(t?.provider_task_id || '').slice(0, 22)} err=${t?.error_code || ''}`);
    const st = String(t?.status || '').toLowerCase();
    if (['success', 'failed', 'cancelled', 'timeout'].includes(st)) return t;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return db.getTaskById(taskId);
}

async function runOneLive(label, imageUrls) {
  const userId = `${PREFIX}${label}`;
  const tok = await setupUser(userId, 5000);
  const bal0 = (await db.getUserById(userId)).balance;
  const forward = buildGeminiForward(
    `PHASE95B2B Gemini Omni Flash ${label} calm motion from still`,
    imageUrls,
    '10',
    '720p',
    '16:9',
  );
  log(`${label} create sku=${forward.billingModelId} n=${imageUrls.length}`);

  const cr = await fcFetch('/tasks/create', {
    auth: tok,
    body: {
      model_id: SKU,
      type: 'video',
      execution_mode: 'queue',
      provider_forward_json: forward,
      params: { model: 'gemini-omni-flash', nxCloudQueueGoldenPath: true },
      nodeData: {
        model: 'gemini-omni-flash',
        durationGeminiOmni: '10',
        resolutionGeminiOmni: '720p',
        imageCount: imageUrls.length,
      },
    },
  });
  if (cr.status !== 200 || !cr.json?.task_id) {
    return {
      ok: false,
      error: `create fail ${cr.status} ${JSON.stringify(cr.json).slice(0, 400)}`,
    };
  }
  const tid = String(cr.json.task_id);
  const quoted = Number(cr.json.quoted_cost ?? cr.json.cost ?? 0);
  log(`${label} created tid=${tid} quoted=${quoted}`);

  await promoteOneTask(tid, userId);
  const final = await runFcWorkersUntil(tid, { maxRounds: 70, intervalMs: 10000 });
  const task = await db.getTaskById(tid);
  const fwd = JSON.parse(task?.provider_forward_json || '{}');
  const charge = await db.getTaskCharge(tid);
  const bal1 = (await db.getUserById(userId)).balance;

  const result = {
    aixflow_task_id: tid,
    runninghub_task_id: task?.provider_task_id || '',
    submit_region: fwd.rhRegion,
    poll_region: fwd.rhRegion,
    path: fwd.path,
    billing_sku: fwd.billingModelId,
    quoted_cost: quoted || Number(task?.quoted_cost || 0),
    actual_charge: charge?.amount ?? null,
    charge_status: charge?.status,
    charge_count: charge && String(charge.status).toLowerCase() === 'charged' ? 1 : 0,
    refund_count: charge && String(charge.status).toLowerCase() === 'refunded' ? 1 : 0,
    final_status: task?.status,
    result_url: task?.result_oss_url || '',
    user_slot_held: task?.user_slot_held,
    platform_slot_held: task?.platform_slot_held,
    imageUrls_len: Array.isArray(fwd.body?.imageUrls) ? fwd.body.imageUrls.length : 0,
    duration_type: typeof fwd.body?.duration,
    duration_value: fwd.body?.duration,
    balance_delta: Number(bal0) - Number(bal1),
    error_code: task?.error_code || '',
  };

  const ok =
    String(task?.status).toLowerCase() === 'success' &&
    !!task?.provider_task_id &&
    !!task?.result_oss_url &&
    fwd.rhRegion === 'ai' &&
    fwd.path === RH_PATH &&
    result.imageUrls_len === imageUrls.length &&
    result.duration_type === 'string' &&
    !task?.user_slot_held &&
    !task?.platform_slot_held &&
    String(charge?.status || '').toLowerCase() === 'charged' &&
    result.charge_count === 1 &&
    result.refund_count === 0;

  return { ok, ...result };
}

async function quickQueue(label, model, sku, forward, regionExpect) {
  const u = `${PREFIX}${label}`;
  const tok = await setupUser(u, 2000);
  await new Promise((r) => setTimeout(r, 1500));
  const cr = await fcFetch('/tasks/create', {
    auth: tok,
    body: {
      model_id: sku,
      type: 'video',
      execution_mode: 'queue',
      provider_forward_json: forward,
      params: { model, nxCloudQueueGoldenPath: true },
      nodeData: { model },
    },
  });
  if (cr.status !== 200 || !cr.json?.task_id) {
    return { ok: false, status: `create_${cr.status}`, err: JSON.stringify(cr.json).slice(0, 200) };
  }
  const tid = String(cr.json.task_id);
  await promoteOneTask(tid, u);
  const final = await runFcWorkersUntil(tid, { maxRounds: 45, intervalMs: 10000 });
  const fwd = JSON.parse((await db.getTaskById(tid))?.provider_forward_json || '{}');
  const ok =
    String(final?.status).toLowerCase() === 'success' &&
    fwd.rhRegion === regionExpect &&
    !!final?.provider_task_id;
  return {
    ok,
    status: final?.status,
    pid: final?.provider_task_id,
    region: fwd.rhRegion,
    err: final?.error_code,
    task_id: tid,
  };
}

async function main() {
  if (!FC_BASE || !FC_TOKEN || !ADMIN_SECRET || !JWT_SECRET) {
    REPORT.conclusion = 'BLOCKED';
    REPORT.errors.push('missing FC/JWT env');
    fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
    process.exit(3);
  }
  if (!OSS_IMAGE.startsWith('https://')) {
    REPORT.conclusion = 'BLOCKED';
    REPORT.errors.push('OSS_IMAGE must be https');
    fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
    process.exit(3);
  }

  // OTS price check
  let modelConfigMap = {};
  try {
    modelConfigMap = Object.fromEntries((await db.listModelConfig()).map((r) => [r.model_id, r]));
    const p = getFinalPrice(SKU, { taskType: 'video', modelConfigMap });
    REPORT.ots_price_720p_10s = p;
    log(`OTS price ${SKU}=${p}`);
  } catch (e) {
    REPORT.errors.push(`OTS price fail: ${e.message}`);
  }

  // Live A: 1 image
  const liveA = await runOneLive('a1', [OSS_IMAGE]);
  REPORT.live_a_1img = liveA;
  if (!liveA.ok) REPORT.errors.push(`liveA fail: ${liveA.error || liveA.final_status} ${liveA.error_code || ''}`);
  log(`liveA ok=${liveA.ok} pid=${liveA.runninghub_task_id}`);

  // Live B: 3 images
  const liveB = await runOneLive('b3', [OSS_IMAGE, `${OSS_IMAGE}?v=2`, `${OSS_IMAGE}?v=3`]);
  REPORT.live_b_3img = liveB;
  if (!liveB.ok) REPORT.errors.push(`liveB fail: ${liveB.error || liveB.final_status} ${liveB.error_code || ''}`);
  log(`liveB ok=${liveB.ok} n=${liveB.imageUrls_len} pid=${liveB.runninghub_task_id}`);

  // local dup charge/refund + invalid-forward
  {
    const { handleTasksCreate } = await import('../lib/handleTasksCreate.mjs');
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    const { dispatchOneChargedTask, pollOneProviderTask } = await import('../lib/providerPipeline.mjs');
    const quoted = Number(REPORT.ots_price_720p_10s) || 10;
    const uDup = `${PREFIX}dup`;
    await setupUser(uDup, 500);
    const crDup = await handleTasksCreate(
      uDup,
      {
        model_id: SKU,
        type: 'video',
        execution_mode: 'queue',
        provider_forward_json: buildGeminiForward('dup', [OSS_IMAGE]),
        params: { model: 'gemini-omni-flash', nxCloudQueueGoldenPath: true },
        nodeData: { model: 'gemini-omni-flash' },
      },
      db,
      { getFinalPrice: () => quoted },
    );
    const dTid = crDup.task_id;
    await promoteOneTask(dTid, uDup);
    const b0 = (await db.getUserById(uDup)).balance;
    for (let i = 0; i < 10; i++) await chargeClaimedTask(dTid, db);
    const b1 = (await db.getUserById(uDup)).balance;
    REPORT.regressions.duplicate_charge = Number(b0) - Number(b1) === quoted ? 'PASS' : 'FAIL';

    let rhCalls = 0;
    await dispatchOneChargedTask(dTid, db, {
      submitRunningHub: async () => {
        rhCalls += 1;
        return {
          ok: true,
          provider_task_id: `rh_dup_${crypto.randomUUID()}`,
          data: {},
          rhRegion: 'ai',
        };
      },
    });
    for (let i = 0; i < 10; i++) {
      await dispatchOneChargedTask(dTid, db, {
        submitRunningHub: async () => {
          rhCalls += 1;
          return { ok: true, provider_task_id: 'should_not', data: {}, rhRegion: 'ai' };
        },
      });
    }
    REPORT.regressions.duplicate_dispatch = rhCalls === 1 ? 'PASS' : `FAIL:${rhCalls}`;

    await pollOneProviderTask(dTid, db, {
      queryRunningHub: async () => ({ ok: true, status: 'FAILED', error: 'mock' }),
    });
    const b2 = (await db.getUserById(uDup)).balance;
    for (let i = 0; i < 10; i++) {
      await pollOneProviderTask(dTid, db, {
        queryRunningHub: async () => ({ ok: true, status: 'FAILED', error: 'again' }),
      });
    }
    const b3 = (await db.getUserById(uDup)).balance;
    REPORT.regressions.duplicate_refund = Number(b2) === Number(b3) && Number(b2) === Number(b0) ? 'PASS' : 'FAIL';

    REPORT.regressions.invalid_forward =
      hasValidForwardPath({ provider_forward_json: JSON.stringify(buildGeminiForward('x', [OSS_IMAGE])) }) &&
      !hasValidForwardPath({ provider_forward_json: '' })
        ? 'PASS'
        : 'FAIL';
  }

  // Light regressions (optional; may BLOCKED_EXTERNAL on rhart balance)
  try {
    REPORT.regressions.h3_t2v = await quickQueue(
      'h3t',
      'minimax-h3-t2v',
      'minimax-h3-t2v-720p-6s',
      {
        provider: 'runninghub',
        path: '/run/ai-app/2085682347676102657',
        method: 'POST',
        body: {
          nodeInfoList: [
            { nodeId: '98', fieldName: 'prompt', fieldValue: 'reg h3 t2v' },
            { nodeId: '103', fieldName: 'duration', fieldValue: '6' },
          ],
          instanceType: 'plus',
          usePersonalQueue: 'false',
        },
        billingModelId: 'minimax-h3-t2v-720p-6s',
        rhRegion: 'cn',
      },
      'cn',
    );
  } catch (e) {
    REPORT.regressions.h3_t2v = { ok: false, err: String(e.message || e) };
  }

  const liveOk = liveA.ok && liveB.ok;
  const localOk = Object.entries(REPORT.regressions)
    .filter(([k]) => ['duplicate_charge', 'duplicate_refund', 'duplicate_dispatch', 'invalid_forward'].includes(k))
    .every(([, v]) => v === 'PASS');

  REPORT.finished_at = new Date().toISOString();
  REPORT.conclusion = liveOk && localOk ? 'PASS' : liveOk ? 'NEEDS-REVIEW' : 'FAIL';
  fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
  log(`conclusion=${REPORT.conclusion}`);
  console.log(JSON.stringify({ conclusion: REPORT.conclusion, errors: REPORT.errors }, null, 2));
  process.exit(REPORT.conclusion === 'PASS' ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  REPORT.errors.push(String(e?.stack || e));
  fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
  process.exit(2);
});
