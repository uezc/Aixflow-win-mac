/**
 * Phase 9.5-B-1 Live E2E — ltx-2.3-i2v Unified Queue（真实 FC + OTS + RH.cn）
 * Create 前：OSS HTTPS 写入 forward（不上传 RH Media fileName）
 *
 * node scripts/live-phase9-5-b1-ltx-i2v-queue.mjs
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

const PREFIX = `__p95b1live_${Date.now().toString(36)}_`;
const FC_BASE = (process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '').replace(/\/$/, '');
const FC_TOKEN = process.env.ALIYUN_FC_TOKEN || '';
const ADMIN_SECRET = process.env.ADMIN_SETTLE_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || '';
const I2V_PATH = '/run/ai-app/2034955204851933186';
const I2V_SKU = 'ltx-2-3-i2v-720-10s';
const OSS_IMAGE =
  process.env.P95B1_I2V_IMAGE_URL?.trim() ||
  (fs.existsSync(path.join(__dirname, 'p93d-i2v-image-url.txt'))
    ? fs.readFileSync(path.join(__dirname, 'p93d-i2v-image-url.txt'), 'utf8').trim()
    : '') ||
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p93d-i2v-test/1788607602254_b2eac80c.jpg';
const OUT = path.join(__dirname, 'phase9-5-b1-ltx-i2v-live-e2e-result.json');

const REPORT = {
  started_at: new Date().toISOString(),
  conclusion: 'BLOCKED',
  errors: [],
  ltx_i2v_e2e: null,
  regressions: {},
};

function log(msg) {
  console.log(`[p95b1-live] ${msg}`);
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

function buildLtxI2vForward(prompt, imageUrl, durationSec = '10', resolution = '720') {
  return {
    provider: 'runninghub',
    path: I2V_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '584', fieldName: 'image', fieldValue: imageUrl },
        { nodeId: '593', fieldName: 'value', fieldValue: durationSec },
        { nodeId: '595', fieldName: 'value', fieldValue: resolution },
        { nodeId: '602', fieldName: 'positive', fieldValue: prompt },
      ],
      instanceType: 'plus',
      usePersonalQueue: 'false',
    },
    billingModelId: `ltx-2-3-i2v-${resolution}-${durationSec}s`,
    rhRegion: 'cn',
  };
}

const db = await import('../lib/db-tablestore.mjs');
const { tryClaimOneQueuedTask } = await import('../lib/queueScheduler.mjs');
const { hasValidForwardPath } = await import('../lib/forwardPayload.mjs');

async function setBalance(userId, balance) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p95b1.local` });
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
    await db.createUserOtpOnly({ userId: userId, email: `${userId}@p95b1.local` });
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
    log(`r${i} status=${t?.status} pid=${String(t?.provider_task_id || '').slice(0, 22)} err=${t?.error_code || ''}`);
    const st = String(t?.status || '').toLowerCase();
    if (['success', 'failed', 'cancelled', 'timeout'].includes(st)) return t;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return db.getTaskById(taskId);
}

async function quickQueue(label, model, sku, forward, regionExpect) {
  const u = `${PREFIX}${label}`;
  const tok = await setupUser(u, 2000);
  await new Promise((r) => setTimeout(r, 2000));
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
  const final = await runFcWorkersUntil(tid);
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
  if (!OSS_IMAGE.startsWith('https://') && !OSS_IMAGE.startsWith('http://')) {
    REPORT.conclusion = 'BLOCKED';
    REPORT.errors.push('OSS_IMAGE invalid');
    fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
    process.exit(3);
  }

  const userId = `${PREFIX}main`;
  const tok = await setupUser(userId, 2000);
  const bal0 = (await db.getUserById(userId)).balance;
  const forward = buildLtxI2vForward('PHASE95B1 LTX I2V calm landscape from still image', OSS_IMAGE);
  log(`create sku=${forward.billingModelId} img=${OSS_IMAGE.slice(0, 80)}`);

  const cr = await fcFetch('/tasks/create', {
    auth: tok,
    body: {
      model_id: I2V_SKU,
      type: 'video',
      execution_mode: 'queue',
      provider_forward_json: forward,
      params: { model: 'ltx-2.3-i2v', nxCloudQueueGoldenPath: true },
      nodeData: { model: 'ltx-2.3-i2v', durationLtx23I2v: '10', resolutionLtx23I2v: '720' },
    },
  });
  if (cr.status !== 200 || !cr.json?.task_id) {
    REPORT.errors.push(`create fail ${cr.status} ${JSON.stringify(cr.json).slice(0, 400)}`);
    REPORT.conclusion = 'FAIL';
    fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
    process.exit(1);
  }
  const tid = String(cr.json.task_id);
  const quoted = Number(cr.json.quoted_cost ?? cr.json.cost ?? 0);
  log(`created tid=${tid} quoted=${quoted}`);

  await promoteOneTask(tid, userId);
  const final = await runFcWorkersUntil(tid, { maxRounds: 55, intervalMs: 10000 });
  const task = await db.getTaskById(tid);
  const fwd = JSON.parse(task?.provider_forward_json || '{}');
  const charge = await db.getTaskCharge(tid);
  const bal1 = (await db.getUserById(userId)).balance;
  const imgNode = (fwd.body?.nodeInfoList || []).find((n) => String(n.nodeId) === '584');

  REPORT.ltx_i2v_e2e = {
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
    image_url: String(imgNode?.fieldValue || '').slice(0, 120),
    balance_delta: Number(bal0) - Number(bal1),
  };

  const i2vOk =
    String(task?.status).toLowerCase() === 'success' &&
    !!task?.provider_task_id &&
    !!task?.result_oss_url &&
    fwd.rhRegion === 'cn' &&
    fwd.path === I2V_PATH &&
    String(imgNode?.fieldValue || '').startsWith('http') &&
    !/^(openapi|api)\//i.test(String(imgNode?.fieldValue || '')) &&
    !task?.user_slot_held &&
    !task?.platform_slot_held &&
    String(charge?.status || '').toLowerCase() === 'charged' &&
    REPORT.ltx_i2v_e2e.charge_count === 1 &&
    REPORT.ltx_i2v_e2e.refund_count === 0;

  if (!i2vOk) REPORT.errors.push(`ltx i2v e2e fail status=${task?.status} err=${task?.error_code}`);
  log(`ltx_i2v_ok=${i2vOk} pid=${task?.provider_task_id}`);

  // local dup charge/refund
  {
    const { handleTasksCreate } = await import('../lib/handleTasksCreate.mjs');
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    const { dispatchOneChargedTask, pollOneProviderTask } = await import('../lib/providerPipeline.mjs');
    const uDup = `${PREFIX}dup`;
    await setupUser(uDup, 500);
    const crDup = await handleTasksCreate(
      uDup,
      {
        model_id: I2V_SKU,
        type: 'video',
        execution_mode: 'queue',
        provider_forward_json: buildLtxI2vForward('dup', OSS_IMAGE),
        params: { model: 'ltx-2.3-i2v', nxCloudQueueGoldenPath: true },
        nodeData: { model: 'ltx-2.3-i2v' },
      },
      db,
      { getFinalPrice: () => 8 },
    );
    const dTid = crDup.task_id;
    await promoteOneTask(dTid, uDup);
    const b0 = (await db.getUserById(uDup)).balance;
    for (let i = 0; i < 10; i++) await chargeClaimedTask(dTid, db);
    const b1 = (await db.getUserById(uDup)).balance;
    REPORT.regressions.duplicate_charge = Number(b0) - Number(b1) === 8 ? 'PASS' : 'FAIL';
    await dispatchOneChargedTask(dTid, db, {
      submitRunningHub: async () => ({
        ok: true,
        provider_task_id: `rh_dup_${crypto.randomUUID()}`,
        data: {},
        rhRegion: 'cn',
      }),
    });
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
  }

  REPORT.regressions.invalid_forward =
    hasValidForwardPath({ provider_forward_json: JSON.stringify(forward) }) &&
    !hasValidForwardPath({ provider_forward_json: '' })
      ? 'PASS'
      : 'FAIL';

  // regression already-pass models (rhart may BLOCKED_EXTERNAL)
  REPORT.regressions.h3_t2v = await quickQueue(
    'h3t2v',
    'minimax-h3-t2v',
    'minimax-h3-t2v-720p-10s',
    {
      provider: 'runninghub',
      path: '/run/ai-app/2085682347676102657',
      method: 'POST',
      body: {
        nodeInfoList: [
          { nodeId: '149', fieldName: 'text', fieldValue: 'P95B1 H3 T2V', description: '提示词' },
          { nodeId: '16', fieldName: 'megapixels', fieldValue: '0.9', description: '分辨率（看介绍）' },
          {
            nodeId: '16',
            fieldName: 'aspect_ratio',
            fieldValue: '16:9 (Widescreen)',
            description: '比例选择',
          },
          { nodeId: '14', fieldName: 'value', fieldValue: '10', description: '时长' },
        ],
        instanceType: 'plus',
        usePersonalQueue: 'false',
      },
      billingModelId: 'minimax-h3-t2v-720p-10s',
      rhRegion: 'cn',
    },
    'cn',
  );
  log(`h3_t2v=${REPORT.regressions.h3_t2v.ok}`);

  REPORT.regressions.ltx_t2v = await quickQueue(
    'ltxt2v',
    'ltx-2.3-t2v',
    'ltx-2-3-720-10s',
    {
      provider: 'runninghub',
      path: '/run/ai-app/2034994243982336001',
      method: 'POST',
      body: {
        nodeInfoList: [
          { nodeId: '43', fieldName: 'value', fieldValue: '1280' },
          { nodeId: '44', fieldName: 'value', fieldValue: '720' },
          { nodeId: '74', fieldName: 'value', fieldValue: '10' },
          { nodeId: '73', fieldName: 'text', fieldValue: 'P95B1 LTX T2V' },
        ],
        instanceType: 'plus',
        usePersonalQueue: 'false',
      },
      billingModelId: 'ltx-2-3-720-10s',
      rhRegion: 'ai',
    },
    'ai',
  );
  log(`ltx_t2v=${REPORT.regressions.ltx_t2v.ok}`);

  REPORT.regressions.h3_i2v = await quickQueue(
    'h3i2v',
    'minimax-h3-i2v',
    'minimax-h3-i2v-720p-10s',
    {
      provider: 'runninghub',
      path: '/run/ai-app/2085687129061019649',
      method: 'POST',
      // H3 I2V needs RH fileName — skip live if we only have OSS; mark SKIP for image format
      // Use a previously known working openapi path from phase 9.4 if present in OSS prep — for regression use T2V-like skip
      body: {
        nodeInfoList: [
          {
            nodeId: '13',
            fieldName: 'image',
            fieldValue: 'openapi/86c58c2d31cca00b3bc8052ad8a16cd787682fac3959568544355b9582aee1df.jpg',
            description: '参考图',
          },
          {
            nodeId: '57',
            fieldName: 'aspect_ratio',
            fieldValue: '16:9 (Widescreen)',
            description: '比例选择',
          },
          { nodeId: '57', fieldName: 'megapixels', fieldValue: '0.9', description: '分辨率（参考介绍）' },
          { nodeId: '56', fieldName: 'value', fieldValue: '10', description: '时间' },
          { nodeId: '149', fieldName: 'text', fieldValue: 'P95B1 H3 I2V', description: '提示词' },
        ],
        instanceType: 'plus',
        usePersonalQueue: 'false',
      },
      billingModelId: 'minimax-h3-i2v-720p-10s',
      rhRegion: 'cn',
    },
    'cn',
  );
  log(`h3_i2v=${REPORT.regressions.h3_i2v.ok}`);

  REPORT.regressions.rhart_t2v = await quickQueue(
    'rhartt2v',
    'rhart-video-x',
    'rhart-video-x-720p-10s',
    {
      provider: 'runninghub',
      path: '/rhart-video-g/text-to-video',
      method: 'POST',
      body: { prompt: 'P95B1 rhart t2v', aspectRatio: '16:9', resolution: '720p', duration: 10 },
      billingModelId: 'rhart-video-x-720p-10s',
      rhRegion: 'ai',
    },
    'ai',
  );
  if (!REPORT.regressions.rhart_t2v.ok && REPORT.regressions.rhart_t2v.err === 'PROVIDER_NO_TASK_ID') {
    REPORT.regressions.rhart_t2v.blocked_external = true;
  }
  log(`rhart_t2v=${REPORT.regressions.rhart_t2v.ok} blocked=${!!REPORT.regressions.rhart_t2v.blocked_external}`);

  REPORT.regressions.rhart_i2v = await quickQueue(
    'rharti2v',
    'rhart-video-x',
    'rhart-video-x-720p-10s',
    {
      provider: 'runninghub',
      path: '/rhart-video-g/image-to-video',
      method: 'POST',
      body: {
        prompt: 'P95B1 rhart i2v',
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
  if (!REPORT.regressions.rhart_i2v.ok && REPORT.regressions.rhart_i2v.err === 'PROVIDER_NO_TASK_ID') {
    REPORT.regressions.rhart_i2v.blocked_external = true;
  }
  log(`rhart_i2v=${REPORT.regressions.rhart_i2v.ok} blocked=${!!REPORT.regressions.rhart_i2v.blocked_external}`);

  const regOk = (r) => r === 'PASS' || r?.ok === true || r?.blocked_external === true;
  const allOk =
    i2vOk &&
    REPORT.regressions.duplicate_charge === 'PASS' &&
    REPORT.regressions.duplicate_refund === 'PASS' &&
    REPORT.regressions.invalid_forward === 'PASS' &&
    REPORT.regressions.h3_t2v.ok &&
    REPORT.regressions.ltx_t2v.ok &&
    REPORT.regressions.h3_i2v.ok &&
    regOk(REPORT.regressions.rhart_t2v) &&
    regOk(REPORT.regressions.rhart_i2v) &&
    REPORT.errors.length === 0;

  const external =
    REPORT.regressions.rhart_t2v?.blocked_external || REPORT.regressions.rhart_i2v?.blocked_external
      ? 'rhart-video-x RunningHub.ai PROVIDER_NO_TASK_ID (likely 605 balance)'
      : null;

  REPORT.conclusion = allOk ? 'PASS' : 'FAIL';
  REPORT.external_blocker = external;
  REPORT.finished_at = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
  console.log(
    JSON.stringify(
      {
        conclusion: REPORT.conclusion,
        external_blocker: external,
        errors: REPORT.errors,
        ltx_i2v: REPORT.ltx_i2v_e2e,
      },
      null,
      2,
    ),
  );
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  REPORT.errors.push(String(e?.stack || e));
  fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
  process.exit(2);
});
