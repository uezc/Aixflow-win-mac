/**
 * Phase 9.5-B-8-B Live E2E — wan-animate Unified Queue（真实 FC + OTS + RH.cn）
 * Live A: 1 image + 1 video + 720p + 8s
 * Live B: 1 image + 1 video + 1080p + 8s
 *
 * node scripts/live-phase9-5-b8-wan-animate-queue.mjs
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
const OSS = require('ali-oss');

const PREFIX = `__p95b8live_${Date.now().toString(36)}_`;
const FC_BASE = (process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '').replace(/\/$/, '');
const FC_TOKEN = process.env.ALIYUN_FC_TOKEN || '';
const ADMIN_SECRET = process.env.ADMIN_SETTLE_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || '';
const RH_PATH = '/run/ai-app/2048978834447409154';
const MODEL = 'wan-animate';
const SKU_720_8 = 'wan-animate-720p-8s';
const SKU_1080_8 = 'wan-animate-1080p-8s';
const OSS_IMAGE =
  process.env.P95B8_IMAGE_URL?.trim() ||
  (fs.existsSync(path.join(__dirname, 'p93d-i2v-image-url.txt'))
    ? fs.readFileSync(path.join(__dirname, 'p93d-i2v-image-url.txt'), 'utf8').trim()
    : '') ||
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p93d-i2v-test/1788607602254_b2eac80c.jpg';
const VIDEO_CACHE = path.join(__dirname, 'p95b8-wan-animate-video-url.txt');
const LOCAL_VIDEO =
  process.env.P95B8_LOCAL_VIDEO?.trim() ||
  path.resolve(
    REPO,
    'resources/default-asset-library/files/assets/video-trimmed-1786372706418-e8l9re-1786373255539-bz9o5k.mp4',
  );
const OUT = path.join(__dirname, 'phase9-5-b8-wan-animate-live-e2e-result.json');

const REPORT = {
  started_at: new Date().toISOString(),
  conclusion: 'BLOCKED',
  errors: [],
  live_a_720p_8s: null,
  live_b_1080p_8s: null,
  live_fail_refund: null,
  external_blocker: null,
  ots_prices: {},
};

function log(msg) {
  console.log(`[p95b8-live] ${msg}`);
}
function sign(userId, tv = 0) {
  return jwt.sign({ sub: userId, typ: 'access', tv }, JWT_SECRET, { expiresIn: '7d' });
}

async function ensureVideoHttpsUrl() {
  const fromEnv = process.env.P95B8_VIDEO_URL?.trim();
  if (fromEnv && fromEnv.startsWith('https://')) return fromEnv;
  if (fs.existsSync(VIDEO_CACHE)) {
    const cached = fs.readFileSync(VIDEO_CACHE, 'utf8').trim();
    if (cached.startsWith('https://')) return cached;
  }
  if (!fs.existsSync(LOCAL_VIDEO)) throw new Error(`local video missing: ${LOCAL_VIDEO}`);
  const region = process.env.OSS_REGION || 'oss-cn-hongkong';
  const bucket = process.env.OSS_BUCKET || 'nexflow-temp-images';
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID || process.env.OTS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET || process.env.OTS_ACCESS_KEY_SECRET;
  if (!accessKeyId || !accessKeySecret) throw new Error('missing OSS credentials for video upload');
  const client = new OSS({ region, bucket, accessKeyId, accessKeySecret, secure: true });
  const key = `p95b8-wan-animate-test/${Date.now()}_${crypto.randomBytes(4).toString('hex')}.mp4`;
  await client.put(key, fs.readFileSync(LOCAL_VIDEO), { headers: { 'Content-Type': 'video/mp4' } });
  const url = `https://${bucket}.${region}.aliyuncs.com/${key}`;
  fs.writeFileSync(VIDEO_CACHE, url);
  log(`uploaded video → ${url}`);
  return url;
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

function buildForward(imageUrl, videoUrl, resolutionUi) {
  const resKey = resolutionUi === '1080p' ? '1080p' : '720p';
  const rhRes = resKey === '1080p' ? '1080' : '720';
  return {
    provider: 'runninghub',
    path: RH_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '57', fieldName: 'image', fieldValue: imageUrl, description: 'image' },
        { nodeId: '63', fieldName: 'video', fieldValue: videoUrl, description: 'video' },
        { nodeId: '250', fieldName: 'value', fieldValue: '8', description: 'value' },
        { nodeId: '259', fieldName: 'value', fieldValue: rhRes, description: 'resolution' },
      ],
      instanceType: 'plus',
      usePersonalQueue: 'false',
    },
    billingModelId: `wan-animate-${resKey}-8s`,
    rhRegion: 'cn',
  };
}

const db = await import('../lib/db-tablestore.mjs');
const { tryClaimOneQueuedTask } = await import('../lib/queueScheduler.mjs');
const { getFinalPrice } = await import('../pricing/price_calculator.mjs');
const { handleTasksCreate } = await import('../lib/handleTasksCreate.mjs');
const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
const { dispatchOneChargedTask, pollOneProviderTask } = await import('../lib/providerPipeline.mjs');

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
async function setupUser(userId, balance = 3000) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p95b8.local` });
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
async function runFcWorkersUntil(taskId, { maxRounds = 90, intervalMs = 10000 } = {}) {
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
    node_250: (fwd.body?.nodeInfoList || []).find((n) => String(n.nodeId) === '250')?.fieldValue,
    node_259: (fwd.body?.nodeInfoList || []).find((n) => String(n.nodeId) === '259')?.fieldValue,
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
    Math.abs(Number(summary.actual_charge) - Number(expectCharge)) < 0.01
  );
}

async function runLiveCase(label, userId, forward, sku, expectCharge) {
  await setupUser(userId, 3000);
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
        resolutionWanAnimate: sku.includes('1080p') ? '1080p' : '720p',
        wanAnimateClipSec: '8',
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

  const videoUrl = await ensureVideoHttpsUrl();
  const modelConfigMap = Object.fromEntries((await db.listModelConfig()).map((r) => [r.model_id, r]));
  const price7208 = getFinalPrice(SKU_720_8, { taskType: 'video', modelConfigMap });
  const price10808 = getFinalPrice(SKU_1080_8, { taskType: 'video', modelConfigMap });
  REPORT.ots_prices = { [SKU_720_8]: price7208, [SKU_1080_8]: price10808 };
  log(`OTS 720p-8s=${price7208} 1080p-8s=${price10808}`);
  log(`image=${OSS_IMAGE.slice(0, 72)}`);
  log(`video=${videoUrl.slice(0, 72)}`);

  {
    const fwd = buildForward(OSS_IMAGE, videoUrl, '720p');
    const r = await runLiveCase('liveA', `${PREFIX}a`, fwd, SKU_720_8, price7208);
    REPORT.live_a_720p_8s = { ok: r.ok, external: r.external, ...r.summary, error: r.error };
    if (!r.ok && !r.external) REPORT.errors.push(`liveA ${r.error}`);
    log(`liveA ok=${r.ok} external=${r.external}`);
  }

  {
    const fwd = buildForward(OSS_IMAGE, videoUrl, '1080p');
    const r = await runLiveCase('liveB', `${PREFIX}b`, fwd, SKU_1080_8, price10808);
    REPORT.live_b_1080p_8s = { ok: r.ok, external: r.external, ...r.summary, error: r.error };
    if (!r.ok && !r.external) REPORT.errors.push(`liveB ${r.error}`);
    log(`liveB ok=${r.ok} external=${r.external}`);
  }

  {
    const uf = `${PREFIX}f`;
    await setupUser(uf, 500);
    const fwd = buildForward(OSS_IMAGE, videoUrl, '720p');
    const cr = await handleTasksCreate(
      uf,
      {
        model_id: SKU_720_8,
        type: 'video',
        execution_mode: 'queue',
        provider_forward_json: fwd,
        params: { model: MODEL, nxCloudQueueGoldenPath: true },
        nodeData: { model: MODEL, resolutionWanAnimate: '720p', wanAnimateClipSec: '8' },
      },
      db,
      { getFinalPrice: () => price7208 },
    );
    const tid = cr.task_id;
    await promoteOneTask(tid, uf);
    await chargeClaimedTask(tid, db);
    const bal0 = (await db.getUserById(uf)).balance;
    await dispatchOneChargedTask(tid, db, {
      submitRunningHub: async () => ({ ok: false, reason: 'RH_CREATE_FAIL', uncertain: false }),
    });
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({ ok: true, status: 'FAILED', data: {} }),
    });
    const row = await db.getTaskById(tid);
    const bal1 = (await db.getUserById(uf)).balance;
    REPORT.live_fail_refund = {
      ok: !row?.user_slot_held && (String(row?.status).toLowerCase() === 'failed' || Math.abs(bal1 - 500) < 0.01),
      status: row?.status,
      bal0,
      bal1,
    };
  }

  const ok =
    REPORT.live_a_720p_8s?.ok === true &&
    REPORT.live_b_1080p_8s?.ok === true &&
    REPORT.live_fail_refund?.ok === true;
  REPORT.conclusion = ok ? 'PASS' : REPORT.external_blocker ? 'BLOCKED' : 'FAIL';
  REPORT.finished_at = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
  console.log(
    JSON.stringify(
      { conclusion: REPORT.conclusion, a: REPORT.live_a_720p_8s?.ok, b: REPORT.live_b_1080p_8s?.ok },
      null,
      2,
    ),
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  REPORT.conclusion = 'FAIL';
  REPORT.errors.push(String(e?.stack || e));
  fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
  console.error(e);
  process.exit(2);
});
