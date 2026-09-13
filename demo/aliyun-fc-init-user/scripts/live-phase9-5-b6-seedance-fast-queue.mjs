/**
 * Phase 9.5-B-6-B Live E2E — seedance-2.0-fast Unified Queue
 * Live A: T2V 720p 5s；Live B: I2V 1 image 720p 5s；Live C: Multi 2 images（可选）
 *
 * node scripts/live-phase9-5-b6-seedance-fast-queue.mjs
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

const PREFIX = `__p95b6live_${Date.now().toString(36)}_`;
const FC_BASE = (process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '').replace(/\/$/, '');
const FC_TOKEN = process.env.ALIYUN_FC_TOKEN || '';
const ADMIN_SECRET = process.env.ADMIN_SETTLE_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || '';
const RH_PATH = '/rhart-video/sparkvideo-2.0-fast/multimodal-video';
const MODEL = 'seedance-2.0-fast';
const SKU_720_5 = 'seedance-2-0-fast-720p-5s';
const OSS_IMAGE =
  process.env.P95B6_IMAGE_URL?.trim() ||
  (fs.existsSync(path.join(__dirname, 'p93d-i2v-image-url.txt'))
    ? fs.readFileSync(path.join(__dirname, 'p93d-i2v-image-url.txt'), 'utf8').trim()
    : '') ||
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p93d-i2v-test/1788607602254_b2eac80c.jpg';
const RUN_LIVE_C = String(process.env.P95B6_LIVE_C || '').trim() === '1';
const OUT = path.join(__dirname, 'phase9-5-b6-seedance-fast-live-e2e-result.json');

const REPORT = {
  started_at: new Date().toISOString(),
  conclusion: 'BLOCKED',
  errors: [],
  live_a_t2v: null,
  live_b_i2v: null,
  live_c_multi: null,
  live_fail_refund: null,
  external_blocker: null,
};

function log(msg) {
  console.log(`[p95b6-live] ${msg}`);
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

function buildForward(prompt, imageUrls, resolution = '720p', duration = '5', ratio = 'adaptive') {
  const res = resolution === '1080p' ? '1080p' : '720p';
  const dur = String(duration);
  return {
    provider: 'runninghub',
    path: RH_PATH,
    method: 'POST',
    body: {
      prompt,
      resolution: res,
      duration: dur,
      imageUrls: [...imageUrls],
      videoUrls: [],
      audioUrls: [],
      generateAudio: true,
      ratio,
      realPersonMode: true,
      returnLastFrame: false,
      seed: -1,
    },
    billingModelId: `seedance-2-0-fast-${res}-${dur}s`,
    rhRegion: 'cn',
  };
}

const db = await import('../lib/db-tablestore.mjs');
const { tryClaimOneQueuedTask } = await import('../lib/queueScheduler.mjs');
const { getFinalPrice } = await import('../pricing/price_calculator.mjs');

async function setBalance(userId, balance) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p95b6.local` });
  } catch (_) {}
  const cur = (await db.getUserById(userId))?.balance ?? 0;
  const delta = balance - cur;
  if (delta === 0) return;
  const op = crypto.randomUUID();
  if (delta > 0) await db.atomicCreditWithReceipt(userId, `ref_${op}`, delta);
  else await db.atomicDebitWithReceipt(userId, `chg_${op}`, -delta);
}
async function setupUser(userId, balance = 3000) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p95b6.local` });
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

function summarizeLive(task, fwd, charge, bal0, bal1, quoted, expectSku, expectCharge) {
  return {
    aixflow_task_id: task?.task_id || '',
    runninghub_task_id: task?.provider_task_id || '',
    region: fwd.rhRegion,
    path: fwd.path,
    billing_sku: fwd.billingModelId,
    image_count: Array.isArray(fwd.body?.imageUrls) ? fwd.body.imageUrls.length : null,
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
    error_message: task?.error_message || '',
    expect_sku: expectSku,
    expect_charge: expectCharge,
  };
}

function isExternalBlock(task) {
  const code = String(task?.error_code || '');
  const msg = String(task?.error_message || task?.error || '');
  if (code === 'PROVIDER_NO_TASK_ID') return true;
  if (/605|insufficient.?balance|余额不足/i.test(msg) || /605|insufficient.?balance/i.test(code)) return true;
  return false;
}

function isLiveOk(summary, expectSku, expectCharge) {
  return (
    String(summary.final_status).toLowerCase() === 'success' &&
    !!summary.runninghub_task_id &&
    !!summary.result_url &&
    summary.region === 'cn' &&
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
  const tok = await setupUser(userId, 3000);
  const bal0 = (await db.getUserById(userId)).balance;
  const cr = await fcFetch('/tasks/create', {
    auth: tok,
    body: {
      model_id: sku,
      type: 'video',
      execution_mode: 'queue',
      provider_forward_json: forward,
      params: { model: MODEL, nxCloudQueueGoldenPath: true },
      nodeData: {
        model: MODEL,
        resolutionSeedance: forward.body.resolution,
        durationSeedance: forward.body.duration,
      },
    },
  });
  if (cr.status !== 200 || !cr.json?.task_id) {
    return {
      ok: false,
      external: false,
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
  const external = !ok && isExternalBlock(task);
  if (external) REPORT.external_blocker = 'BLOCKED_EXTERNAL';
  return {
    ok,
    external,
    summary,
    error: ok ? null : `status=${task?.status} err=${task?.error_code} ${summary.error_message}`,
  };
}

async function main() {
  if (!FC_BASE || !FC_TOKEN || !ADMIN_SECRET || !JWT_SECRET) {
    REPORT.conclusion = 'BLOCKED';
    REPORT.errors.push('missing FC/JWT env');
    fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
    process.exit(3);
  }

  const modelConfigMap = Object.fromEntries((await db.listModelConfig()).map((r) => [r.model_id, r]));
  const price7205 = getFinalPrice(SKU_720_5, { taskType: 'video', modelConfigMap });
  REPORT.ots_prices = { [SKU_720_5]: price7205 };
  log(`OTS 720p-5s=${price7205}`);

  {
    const fwd = buildForward('PHASE95B6-A Seedance Fast T2V calm cinematic shot', [], '720p', '5');
    const r = await runLiveCase('liveA', `${PREFIX}a`, fwd, SKU_720_5, price7205);
    REPORT.live_a_t2v = { ok: r.ok, external: r.external, ...r.summary, error: r.error };
    if (!r.ok && !r.external) REPORT.errors.push(`liveA ${r.error}`);
    log(`liveA ok=${r.ok} external=${r.external}`);
  }

  {
    const fwd = buildForward(
      'PHASE95B6-B Seedance Fast I2V gentle motion from still',
      [OSS_IMAGE],
      '720p',
      '5',
    );
    const r = await runLiveCase('liveB', `${PREFIX}b`, fwd, SKU_720_5, price7205);
    REPORT.live_b_i2v = { ok: r.ok, external: r.external, ...r.summary, error: r.error };
    if (!r.ok && !r.external) REPORT.errors.push(`liveB ${r.error}`);
    log(`liveB ok=${r.ok} external=${r.external}`);
  }

  if (RUN_LIVE_C) {
    const fwd = buildForward(
      'PHASE95B6-C Seedance Fast multi-image continuity',
      [OSS_IMAGE, `${OSS_IMAGE}?v=end`],
      '720p',
      '5',
    );
    const r = await runLiveCase('liveC', `${PREFIX}c`, fwd, SKU_720_5, price7205);
    REPORT.live_c_multi = { ok: r.ok, external: r.external, ...r.summary, error: r.error };
    if (!r.ok && !r.external) REPORT.errors.push(`liveC ${r.error}`);
    log(`liveC ok=${r.ok} external=${r.external}`);
  } else {
    REPORT.live_c_multi = { ok: null, skipped: true, note: 'NOT RUN (set P95B6_LIVE_C=1 to enable)' };
    log('liveC skipped (cost control); use Mock multi-image');
  }

  {
    const { handleTasksCreate } = await import('../lib/handleTasksCreate.mjs');
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    const { dispatchOneChargedTask } = await import('../lib/providerPipeline.mjs');
    const uFail = `${PREFIX}fail`;
    await setupUser(uFail, 500);
    const bal0 = (await db.getUserById(uFail)).balance;
    const fwd = buildForward('fail path', [], '720p', '5');
    const crFail = await handleTasksCreate(
      uFail,
      {
        model_id: SKU_720_5,
        type: 'video',
        execution_mode: 'queue',
        provider_forward_json: fwd,
        params: { model: MODEL, nxCloudQueueGoldenPath: true },
        nodeData: { model: MODEL, resolutionSeedance: '720p', durationSeedance: '5' },
      },
      db,
      { getFinalPrice: () => price7205 },
    );
    const tid = crFail.task_id;
    await promoteOneTask(tid, uFail);
    await chargeClaimedTask(tid, db);
    await dispatchOneChargedTask(tid, db, {
      submitRunningHub: async () => ({ ok: false, error: 'SUBMIT_FAIL', rhRegion: 'cn' }),
    });
    const final = await db.getTaskById(tid);
    const bal1 = (await db.getUserById(uFail)).balance;
    const ok =
      ['failed', 'cancelled'].includes(String(final?.status)) &&
      Number(bal1) === Number(bal0) &&
      !final?.user_slot_held &&
      !final?.platform_slot_held;
    REPORT.live_fail_refund = { ok, status: final?.status, bal0, bal1 };
    if (!ok) REPORT.errors.push('live_fail_refund');
    log(`fail_refund ok=${ok}`);
  }

  const aOk = REPORT.live_a_t2v?.ok === true;
  const bOk = REPORT.live_b_i2v?.ok === true;
  const aExt = REPORT.live_a_t2v?.external === true;
  const bExt = REPORT.live_b_i2v?.external === true;
  const failOk = REPORT.live_fail_refund?.ok === true;
  const cOk =
    REPORT.live_c_multi?.skipped === true ||
    REPORT.live_c_multi?.ok === true ||
    REPORT.live_c_multi?.external === true;

  REPORT.finished_at = new Date().toISOString();
  if (aOk && bOk && failOk && cOk && REPORT.errors.length === 0) {
    REPORT.conclusion = 'PASS';
  } else if (failOk && (aOk || aExt) && (bOk || bExt) && (aExt || bExt)) {
    REPORT.conclusion = 'NEEDS-REVIEW';
    REPORT.external_blocker = REPORT.external_blocker || 'BLOCKED_EXTERNAL';
  } else {
    REPORT.conclusion = 'FAIL';
  }

  fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
  log(`conclusion=${REPORT.conclusion}`);
  console.log(JSON.stringify(REPORT, null, 2));
  process.exit(REPORT.conclusion === 'PASS' ? 0 : REPORT.conclusion === 'NEEDS-REVIEW' ? 4 : 1);
}

main().catch((e) => {
  console.error(e);
  REPORT.error = String(e?.stack || e);
  fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
  process.exit(2);
});
