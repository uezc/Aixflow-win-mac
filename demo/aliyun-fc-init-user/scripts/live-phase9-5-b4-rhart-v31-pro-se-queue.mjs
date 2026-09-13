/**
 * Phase 9.5-B-4-B Live E2E — rhart-v3.1-pro-se Unified Queue（真实 FC + OTS + RH.ai）
 * Live A: 1 image 720p；Live B: 2 images 1080p
 *
 * node scripts/live-phase9-5-b4-rhart-v31-pro-se-queue.mjs
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

const PREFIX = `__p95b4live_${Date.now().toString(36)}_`;
const FC_BASE = (process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '').replace(/\/$/, '');
const FC_TOKEN = process.env.ALIYUN_FC_TOKEN || '';
const ADMIN_SECRET = process.env.ADMIN_SETTLE_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || '';
const RH_PATH = '/rhart-video-v3.1-pro/start-end-to-video';
const MODEL = 'rhart-v3.1-pro-se';
const SKU_720 = 'veo-3-1-720p-pro-se';
const SKU_1080 = 'veo-3-1-1080p-pro-se';
const OSS_IMAGE =
  process.env.P95B4_IMAGE_URL?.trim() ||
  (fs.existsSync(path.join(__dirname, 'p93d-i2v-image-url.txt'))
    ? fs.readFileSync(path.join(__dirname, 'p93d-i2v-image-url.txt'), 'utf8').trim()
    : '') ||
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p93d-i2v-test/1788607602254_b2eac80c.jpg';
const OUT = path.join(__dirname, 'phase9-5-b4-rhart-v31-pro-se-live-e2e-result.json');

const REPORT = {
  started_at: new Date().toISOString(),
  conclusion: 'BLOCKED',
  errors: [],
  live_a_1img: null,
  live_b_2img: null,
  live_fail_refund: null,
  regressions: {},
  external_blocker: null,
};

function log(msg) {
  console.log(`[p95b4-live] ${msg}`);
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

function buildForward(prompt, firstFrameUrl, lastFrameUrl, resolution, aspectRatio = '16:9') {
  const body = {
    prompt,
    firstFrameUrl,
    aspectRatio,
    duration: '8',
    resolution,
  };
  if (lastFrameUrl) body.lastFrameUrl = lastFrameUrl;
  return {
    provider: 'runninghub',
    path: RH_PATH,
    method: 'POST',
    body,
    billingModelId: `veo-3-1-${resolution}-pro-se`,
    rhRegion: 'ai',
  };
}

const db = await import('../lib/db-tablestore.mjs');
const { tryClaimOneQueuedTask } = await import('../lib/queueScheduler.mjs');
const { hasValidForwardPath } = await import('../lib/forwardPayload.mjs');
const { getFinalPrice } = await import('../pricing/price_calculator.mjs');

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
async function setupUser(userId, balance = 2000) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p95b4.local` });
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
async function runFcWorkersUntil(taskId, { maxRounds = 55, intervalMs = 10000 } = {}) {
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

function summarizeLive(task, fwd, charge, bal0, bal1, quoted, expectSku, expectCharge) {
  return {
    aixflow_task_id: task?.task_id || '',
    runninghub_task_id: task?.provider_task_id || '',
    region: fwd.rhRegion,
    path: fwd.path,
    billing_sku: fwd.billingModelId,
    quoted_cost: quoted,
    actual_charge: charge?.amount ?? null,
    charge_status: charge?.status,
    charge_count: charge && String(charge.status).toLowerCase() === 'charged' ? 1 : 0,
    refund_count: charge && String(charge.status).toLowerCase() === 'refunded' ? 1 : 0,
    final_status: task?.status,
    result_url: task?.result_oss_url || '',
    user_slot_held: task?.user_slot_held,
    platform_slot_held: task?.platform_slot_held,
    balance_delta: Number(bal0) - Number(bal1),
    error_code: task?.error_code || '',
    has_lastFrameUrl: Object.prototype.hasOwnProperty.call(fwd.body || {}, 'lastFrameUrl'),
    expect_sku: expectSku,
    expect_charge: expectCharge,
  };
}

function isLiveOk(summary, expectSku, expectCharge) {
  return (
    String(summary.final_status).toLowerCase() === 'success' &&
    !!summary.runninghub_task_id &&
    !!summary.result_url &&
    summary.region === 'ai' &&
    summary.path === RH_PATH &&
    summary.billing_sku === expectSku &&
    !summary.user_slot_held &&
    !summary.platform_slot_held &&
    String(summary.charge_status || '').toLowerCase() === 'charged' &&
    summary.charge_count === 1 &&
    summary.refund_count === 0 &&
    Number(summary.actual_charge) === Number(expectCharge)
  );
}

async function runLiveCase(label, userId, forward, sku, expectCharge) {
  const tok = await setupUser(userId, 2000);
  const bal0 = (await db.getUserById(userId)).balance;
  const cr = await fcFetch('/tasks/create', {
    auth: tok,
    body: {
      model_id: sku,
      type: 'video',
      execution_mode: 'queue',
      provider_forward_json: forward,
      params: { model: MODEL, nxCloudQueueGoldenPath: true },
      nodeData: { model: MODEL, duration: '8', resolutionRhartV31: forward.body.resolution },
    },
  });
  if (cr.status !== 200 || !cr.json?.task_id) {
    return {
      ok: false,
      error: `create fail ${cr.status} ${JSON.stringify(cr.json).slice(0, 400)}`,
      summary: null,
    };
  }
  const tid = String(cr.json.task_id);
  const quoted = Number(cr.json.quoted_cost ?? cr.json.cost ?? 0) || expectCharge;
  log(`${label} created tid=${tid} quoted=${quoted}`);
  await promoteOneTask(tid, userId);
  await runFcWorkersUntil(tid);
  const task = await db.getTaskById(tid);
  const fwd = JSON.parse(task?.provider_forward_json || '{}');
  const charge = await db.getTaskCharge(tid);
  const bal1 = (await db.getUserById(userId)).balance;
  const summary = summarizeLive(
    { ...task, task_id: tid },
    fwd,
    charge,
    bal0,
    bal1,
    quoted,
    sku,
    expectCharge,
  );
  const ok = isLiveOk(summary, sku, expectCharge);
  if (!ok && task?.error_code === 'PROVIDER_NO_TASK_ID') {
    REPORT.external_blocker = 'BLOCKED_EXTERNAL';
  }
  return { ok, summary, error: ok ? null : `status=${task?.status} err=${task?.error_code}` };
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

  const modelConfigMap = Object.fromEntries((await db.listModelConfig()).map((r) => [r.model_id, r]));
  const price720 = getFinalPrice(SKU_720, { taskType: 'video', modelConfigMap });
  const price1080 = getFinalPrice(SKU_1080, { taskType: 'video', modelConfigMap });
  REPORT.ots_prices = { [SKU_720]: price720, [SKU_1080]: price1080 };
  log(`OTS 720=${price720} 1080=${price1080}`);

  // Live A — 1 image 720p
  {
    const fwd = buildForward(
      'PHASE95B4-A V3.1-pro start-end single still to cinematic motion',
      OSS_IMAGE,
      null,
      '720p',
      '16:9',
    );
    const r = await runLiveCase('liveA', `${PREFIX}a`, fwd, SKU_720, price720);
    REPORT.live_a_1img = { ok: r.ok, ...r.summary, error: r.error };
    if (!r.ok) REPORT.errors.push(`liveA ${r.error}`);
    log(`liveA ok=${r.ok}`);
  }

  // Live B — 2 images 1080p
  {
    const fwd = buildForward(
      'PHASE95B4-B V3.1-pro start-end calm transition between two stills',
      OSS_IMAGE,
      `${OSS_IMAGE}?v=end`,
      '1080p',
      '16:9',
    );
    const r = await runLiveCase('liveB', `${PREFIX}b`, fwd, SKU_1080, price1080);
    REPORT.live_b_2img = { ok: r.ok, ...r.summary, error: r.error };
    if (!r.ok) REPORT.errors.push(`liveB ${r.error}`);
    log(`liveB ok=${r.ok}`);
  }

  // Failure path: local mock submit fail after charge
  {
    const { handleTasksCreate } = await import('../lib/handleTasksCreate.mjs');
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    const { dispatchOneChargedTask } = await import('../lib/providerPipeline.mjs');
    const uFail = `${PREFIX}fail`;
    await setupUser(uFail, 500);
    const crFail = await handleTasksCreate(
      uFail,
      {
        model_id: SKU_720,
        type: 'video',
        execution_mode: 'queue',
        provider_forward_json: buildForward('fail', OSS_IMAGE, null, '720p'),
        params: { model: MODEL, nxCloudQueueGoldenPath: true },
        nodeData: { model: MODEL },
      },
      db,
      { getFinalPrice: () => price720 },
    );
    const fTid = crFail.task_id;
    await promoteOneTask(fTid, uFail);
    const b0 = (await db.getUserById(uFail)).balance;
    await chargeClaimedTask(fTid, db);
    await dispatchOneChargedTask(fTid, db, {
      submitRunningHub: async () => ({ ok: false, error: 'SUBMIT_FAIL', rhRegion: 'ai' }),
    });
    const fTask = await db.getTaskById(fTid);
    const b1 = (await db.getUserById(uFail)).balance;
    const fCharge = await db.getTaskCharge(fTid);
    REPORT.live_fail_refund = {
      ok:
        ['failed', 'cancelled'].includes(String(fTask?.status)) &&
        Number(b1) === Number(b0) &&
        String(fCharge?.status).toLowerCase() === 'refunded' &&
        !fTask?.user_slot_held &&
        !fTask?.platform_slot_held,
      status: fTask?.status,
      charge: fCharge?.status,
      bal0: b0,
      bal1: b1,
    };
  }

  // local dups
  {
    const { handleTasksCreate } = await import('../lib/handleTasksCreate.mjs');
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    const { dispatchOneChargedTask, pollOneProviderTask } = await import('../lib/providerPipeline.mjs');
    const uDup = `${PREFIX}dup`;
    await setupUser(uDup, 500);
    const crDup = await handleTasksCreate(
      uDup,
      {
        model_id: SKU_720,
        type: 'video',
        execution_mode: 'queue',
        provider_forward_json: buildForward('dup', OSS_IMAGE, null, '720p'),
        params: { model: MODEL, nxCloudQueueGoldenPath: true },
        nodeData: { model: MODEL },
      },
      db,
      { getFinalPrice: () => price720 },
    );
    const dTid = crDup.task_id;
    await promoteOneTask(dTid, uDup);
    const b0 = (await db.getUserById(uDup)).balance;
    for (let i = 0; i < 10; i++) await chargeClaimedTask(dTid, db);
    const b1 = (await db.getUserById(uDup)).balance;
    REPORT.regressions.duplicate_charge =
      Number(b0) - Number(b1) === Number(price720) ? 'PASS' : 'FAIL';

    let submits = 0;
    await dispatchOneChargedTask(dTid, db, {
      submitRunningHub: async () => {
        submits += 1;
        return { ok: true, provider_task_id: `rh_dup_${crypto.randomUUID()}`, data: {}, rhRegion: 'ai' };
      },
    });
    for (let i = 0; i < 10; i++) {
      await dispatchOneChargedTask(dTid, db, {
        submitRunningHub: async () => {
          submits += 1;
          return { ok: true, provider_task_id: 'should_not', data: {}, rhRegion: 'ai' };
        },
      });
    }
    REPORT.regressions.duplicate_dispatch = submits === 1 ? 'PASS' : 'FAIL';

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
    REPORT.regressions.duplicate_refund =
      Number(b2) === Number(b3) && Number(b2) === Number(b0) ? 'PASS' : 'FAIL';
  }

  REPORT.regressions.invalid_forward = hasValidForwardPath({
    provider_forward_json: JSON.stringify(buildForward('x', OSS_IMAGE, null, '720p')),
  })
    ? 'PASS'
    : 'FAIL';

  const livePass = REPORT.live_a_1img?.ok && REPORT.live_b_2img?.ok;
  const localPass =
    REPORT.live_fail_refund?.ok &&
    REPORT.regressions.duplicate_charge === 'PASS' &&
    REPORT.regressions.duplicate_dispatch === 'PASS' &&
    REPORT.regressions.duplicate_refund === 'PASS' &&
    REPORT.regressions.invalid_forward === 'PASS';

  if (livePass && localPass) REPORT.conclusion = 'PASS';
  else if (REPORT.external_blocker === 'BLOCKED_EXTERNAL') REPORT.conclusion = 'NEEDS-REVIEW';
  else REPORT.conclusion = livePass || localPass ? 'NEEDS-REVIEW' : 'FAIL';

  REPORT.finished_at = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
  console.log(JSON.stringify({ conclusion: REPORT.conclusion, errors: REPORT.errors }, null, 2));
  process.exit(REPORT.conclusion === 'PASS' ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  REPORT.errors.push(String(e.message || e));
  REPORT.finished_at = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
  process.exit(2);
});
