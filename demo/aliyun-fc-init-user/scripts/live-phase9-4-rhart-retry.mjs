/**
 * Phase 9.4 — rhart T2V/I2V regression retry only（PROVIDER_NO_TASK_ID 瞬时失败补跑）
 * + invalid-forward / dup charge·refund 快验
 * node scripts/live-phase9-4-rhart-retry.mjs
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
const PREFIX = `__p94rr_${Date.now().toString(36)}_`;
const FC_BASE = (process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '').replace(/\/$/, '');
const FC_TOKEN = process.env.ALIYUN_FC_TOKEN || '';
const ADMIN_SECRET = process.env.ADMIN_SETTLE_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || '';
const OSS_IMAGE =
  process.env.P94_I2V_IMAGE_URL?.trim() ||
  (fs.existsSync(path.join(__dirname, 'p93d-i2v-image-url.txt'))
    ? fs.readFileSync(path.join(__dirname, 'p93d-i2v-image-url.txt'), 'utf8').trim()
    : '') ||
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p93d-i2v-test/1788607602254_b2eac80c.jpg';
const H3_TID = process.env.P94_H3_I2V_TASK_ID || 'adb81f9d-d8a1-4e3f-bb0f-2ceb2ae93f90';
const OUT = path.join(__dirname, 'phase9-4-rhart-retry-result.json');

function log(m) {
  console.log(`[p94-rr] ${m}`);
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

const db = await import('../lib/db-tablestore.mjs');
const { tryClaimOneQueuedTask } = await import('../lib/queueScheduler.mjs');
const { hasValidForwardPath } = await import('../lib/forwardPayload.mjs');

async function setBalance(userId, balance) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p94rr.local` });
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
    await db.createUserOtpOnly({ userId, email: `${userId}@p94rr.local` });
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
async function runFcWorkersUntil(taskId, { maxRounds = 50, intervalMs = 10000 } = {}) {
  for (let i = 0; i < maxRounds; i++) {
    await fcInternal('charge-claimed-tasks', { max_tasks: 50 });
    await fcInternal('dispatch-charged-tasks', { max_tasks: 50 });
    await fcInternal('poll-provider-tasks', { max_tasks: 50 });
    const t = await db.getTaskById(taskId);
    log(`r${i} status=${t?.status} pid=${String(t?.provider_task_id || '').slice(0, 20)} err=${t?.error_code || ''}`);
    const st = String(t?.status || '').toLowerCase();
    if (['success', 'failed', 'cancelled', 'timeout'].includes(st)) return t;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return db.getTaskById(taskId);
}

async function quickWithRetry(label, model, sku, forward, region, attempts = 3) {
  let last = null;
  for (let a = 1; a <= attempts; a++) {
    log(`${label} attempt ${a}/${attempts}`);
    await new Promise((r) => setTimeout(r, a === 1 ? 5000 : 15000));
    const u = `${PREFIX}${label}_a${a}`;
    const tok = await setupUser(u, 2000);
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
      last = { ok: false, reason: `create ${cr.status}`, attempt: a };
      continue;
    }
    const tid = String(cr.json.task_id);
    await promoteOneTask(tid, u);
    const final = await runFcWorkersUntil(tid);
    const fwd = JSON.parse((await db.getTaskById(tid))?.provider_forward_json || '{}');
    const ok =
      String(final?.status).toLowerCase() === 'success' &&
      fwd.rhRegion === region &&
      !!final?.provider_task_id;
    last = {
      ok,
      status: final?.status,
      pid: final?.provider_task_id,
      region: fwd.rhRegion,
      err: final?.error_code,
      task_id: tid,
      attempt: a,
    };
    if (ok) return last;
    // PROVIDER_NO_TASK_ID / transient → retry
    log(`${label} fail status=${last.status} err=${last.err}`);
  }
  return last;
}

async function main() {
  if (!FC_BASE || !FC_TOKEN || !ADMIN_SECRET || !JWT_SECRET) {
    console.log(JSON.stringify({ conclusion: 'BLOCKED' }));
    process.exit(3);
  }
  const REPORT = { started_at: new Date().toISOString(), h3_i2v_prior: null };

  // Confirm prior H3 I2V live task
  {
    const t = await db.getTaskById(H3_TID);
    const fwd = JSON.parse(t?.provider_forward_json || '{}');
    const charge = await db.getTaskCharge(H3_TID);
    const uid = t?.user_id;
    let userOcc = null;
    try {
      const c = await db.getUserConcurrencyCounter(uid, 'video');
      userOcc = c?.occupied ?? c?.running ?? null;
    } catch (_) {}
    REPORT.h3_i2v_prior = {
      task_id: H3_TID,
      status: t?.status,
      pid: t?.provider_task_id,
      region: fwd.rhRegion,
      path: fwd.path,
      billing: fwd.billingModelId,
      instanceType: fwd.body?.instanceType,
      image: fwd.body?.nodeInfoList?.find((n) => String(n.fieldName) === 'image'),
      result_url: t?.result_oss_url || '',
      charge_status: charge?.status,
      charge_amount: charge?.amount ?? charge?.yuanbao ?? charge?.cost,
      user_slot_held: t?.user_slot_held,
      platform_slot_held: t?.platform_slot_held,
      user_occupied: userOcc,
    };
    log(`h3_i2v_prior status=${t?.status} pid=${t?.provider_task_id} charge=${charge?.status}`);
  }

  REPORT.rhart_t2v = await quickWithRetry(
    'rt2v',
    'rhart-video-x',
    'rhart-video-x-720p-10s',
    {
      provider: 'runninghub',
      path: '/rhart-video-g/text-to-video',
      method: 'POST',
      body: { prompt: 'P94 rr rhart t2v calm meadow', aspectRatio: '16:9', resolution: '720p', duration: 10 },
      billingModelId: 'rhart-video-x-720p-10s',
      rhRegion: 'ai',
    },
    'ai',
  );
  log(`rhart_t2v=${REPORT.rhart_t2v.ok}`);

  REPORT.rhart_i2v = await quickWithRetry(
    'ri2v',
    'rhart-video-x',
    'rhart-video-x-720p-10s',
    {
      provider: 'runninghub',
      path: '/rhart-video-g/image-to-video',
      method: 'POST',
      body: {
        prompt: 'P94 rr rhart i2v',
        aspectRatio: '16:9',
        imageUrls: [OSS_IMAGE],
        resolution: '720p',
        duration: 10,
      },
      billingModelId: 'rhart-video-x-720p-10s',
      rhRegion: 'ai',
    },
    'ai',
  );
  log(`rhart_i2v=${REPORT.rhart_i2v.ok}`);

  // invalid-forward（与 mock：空 forward 不可 dispatch；合法 path 可解析）
  {
    const goodTask = {
      provider_forward_json: JSON.stringify({
        provider: 'runninghub',
        path: '/run/ai-app/2085687129061019649',
        method: 'POST',
        rhRegion: 'cn',
        billingModelId: 'minimax-h3-i2v-720p-10s',
        body: {
          nodeInfoList: [{ nodeId: '13', fieldName: 'image', fieldValue: 'openapi/x.jpg' }],
          instanceType: 'plus',
          usePersonalQueue: 'false',
        },
      }),
    };
    const emptyTask = { provider_forward_json: '' };
    const badTask = { provider_forward_json: JSON.stringify({ provider: 'runninghub', method: 'POST' }) };
    const gPass = hasValidForwardPath(goodTask) === true;
    const ePass = hasValidForwardPath(emptyTask) === false;
    const bPass = hasValidForwardPath(badTask) === false;
    REPORT.invalid_forward = gPass && ePass && bPass ? 'PASS' : 'FAIL';
    REPORT.invalid_forward_detail = { good: gPass, empty: ePass, noPath: bPass };
    log(`invalid_forward=${REPORT.invalid_forward}`);
  }

  // dup charge / refund (local)
  {
    const { handleTasksCreate } = await import('../lib/handleTasksCreate.mjs');
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    const { dispatchOneChargedTask, pollOneProviderTask } = await import('../lib/providerPipeline.mjs');
    const uDup = `${PREFIX}dup`;
    await setupUser(uDup, 500);
    const forward = {
      provider: 'runninghub',
      path: '/run/ai-app/2085687129061019649',
      method: 'POST',
      rhRegion: 'cn',
      billingModelId: 'minimax-h3-i2v-720p-10s',
      body: {
        nodeInfoList: [
          { nodeId: '13', fieldName: 'image', fieldValue: 'openapi/dup.jpg', description: 'image' },
          { nodeId: '149', fieldName: 'text', fieldValue: 'dup', description: '提示词' },
          { nodeId: '16', fieldName: 'megapixels', fieldValue: '0.9', description: '分辨率（看介绍）' },
          { nodeId: '16', fieldName: 'aspect_ratio', fieldValue: '16:9 (Widescreen)', description: '比例选择' },
          { nodeId: '14', fieldName: 'value', fieldValue: '10', description: '时长' },
        ],
        instanceType: 'plus',
        usePersonalQueue: 'false',
      },
    };
    const cr = await handleTasksCreate(
      uDup,
      {
        model_id: 'minimax-h3-i2v-720p-10s',
        type: 'video',
        execution_mode: 'queue',
        provider_forward_json: forward,
        params: { model: 'minimax-h3-i2v', nxCloudQueueGoldenPath: true },
        nodeData: { model: 'minimax-h3-i2v' },
      },
      db,
      { getFinalPrice: () => 9 },
    );
    const tid = cr.task_id;
    await promoteOneTask(tid, uDup);
    const bal0 = (await db.getUserById(uDup)).balance;
    for (let i = 0; i < 10; i++) await chargeClaimedTask(tid, db);
    const bal1 = (await db.getUserById(uDup)).balance;
    REPORT.duplicate_charge = Number(bal0) - Number(bal1) === 9 ? 'PASS' : 'FAIL';

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
    REPORT.duplicate_refund = Number(bal2) === Number(bal3) && Number(bal2) === Number(bal0) ? 'PASS' : 'FAIL';
    log(`dup_charge=${REPORT.duplicate_charge} dup_refund=${REPORT.duplicate_refund}`);
  }

  const priorOk =
    String(REPORT.h3_i2v_prior?.status).toLowerCase() === 'success' &&
    REPORT.h3_i2v_prior?.region === 'cn' &&
    !!REPORT.h3_i2v_prior?.pid &&
    String(REPORT.h3_i2v_prior?.charge_status || '').toLowerCase() === 'charged';

  const all =
    priorOk &&
    REPORT.rhart_t2v.ok &&
    REPORT.rhart_i2v.ok &&
    REPORT.invalid_forward === 'PASS' &&
    REPORT.duplicate_charge === 'PASS' &&
    REPORT.duplicate_refund === 'PASS';

  REPORT.prior_h3_i2v_ok = priorOk;
  REPORT.h3_t2v_from_prev_reg = true; // already PASS in phase9-4-regression-only
  REPORT.ltx_from_prev_reg = true;
  REPORT.conclusion = all ? 'PASS' : 'FAIL';
  REPORT.finished_at = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
  console.log(JSON.stringify(REPORT, null, 2));
  process.exit(all ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
