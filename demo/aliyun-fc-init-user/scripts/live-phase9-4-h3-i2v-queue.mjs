/**
 * Phase 9.4 Live E2E — minimax-h3-i2v Unified Queue（真实 FC + OTS + RH.cn）
 * + rhart T2V/I2V / H3 T2V / LTX / invalid-forward / dup charge·refund 回归
 *
 * node scripts/live-phase9-4-h3-i2v-queue.mjs
 *
 * Create 前：OSS HTTPS → FC media upload → RH fileName → forward.nodeInfoList
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

const PREFIX = `__p94live_${Date.now().toString(36)}_`;
const FC_BASE = (process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '').replace(/\/$/, '');
const FC_TOKEN = process.env.ALIYUN_FC_TOKEN || '';
const ADMIN_SECRET = process.env.ADMIN_SETTLE_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || '';
const I2V_PATH = '/run/ai-app/2085687129061019649';
const H3_I2V_SKU = 'minimax-h3-i2v-720p-10s';
const H3_T2V_PATH = '/run/ai-app/2085682347676102657';
const H3_T2V_SKU = 'minimax-h3-t2v-720p-10s';
const LTX_PATH = '/run/ai-app/2034994243982336001';
const LTX_SKU = 'ltx-2-3-720-10s';
const RHART_SKU = 'rhart-video-x-720p-10s';
const OSS_IMAGE =
  process.env.P94_I2V_IMAGE_URL?.trim() ||
  (fs.existsSync(path.join(__dirname, 'p93d-i2v-image-url.txt'))
    ? fs.readFileSync(path.join(__dirname, 'p93d-i2v-image-url.txt'), 'utf8').trim()
    : '') ||
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p93d-i2v-test/1788607602254_b2eac80c.jpg';
const OUT = path.join(__dirname, 'phase9-4-h3-i2v-live-e2e-result.json');

const REPORT = {
  started_at: new Date().toISOString(),
  conclusion: 'BLOCKED',
  errors: [],
  h3_i2v_e2e: null,
  rhart_t2v_regression: 'FAIL',
  rhart_i2v_regression: 'FAIL',
  h3_t2v_regression: 'FAIL',
  ltx_regression: 'FAIL',
  invalid_forward: 'FAIL',
  duplicate_charge: 'SKIP',
  duplicate_refund: 'SKIP',
};

function log(msg) {
  console.log(`[p94-live] ${msg}`);
}

function signAccessToken(userId, tv = 0) {
  return jwt.sign({ sub: userId, typ: 'access', tv }, JWT_SECRET, { expiresIn: '7d' });
}

async function fcFetch(pathSuffix, { body = {}, auth = null, timeoutMs = 180_000 } = {}) {
  const url = `${FC_BASE}${pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`}`;
  const headers = {
    'content-type': 'application/json',
    'x-nexflow-token': FC_TOKEN,
  };
  if (auth) headers.authorization = `Bearer ${auth}`;
  if (ADMIN_SECRET) headers['x-admin-settle-secret'] = ADMIN_SECRET;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 600) };
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

async function fcInternal(name, body = {}) {
  return fcFetch(`/internal/${name}`, { body });
}

function parseRhMediaField(raw) {
  const data = raw?.data ?? raw;
  const candidates = [
    data?.fileName,
    data?.file_name,
    data?.fileNamePath,
    data?.data?.fileName,
    data?.data?.file_name,
    typeof data === 'string' ? data : null,
  ];
  for (const c of candidates) {
    const s = String(c || '').trim();
    if (/^(openapi|api)\//i.test(s)) return s;
  }
  // nested search
  const blob = JSON.stringify(data || {});
  const m = blob.match(/"(openapi\/[^"]+|api\/[^"]+)"/i);
  return m ? m[1] : '';
}

async function uploadRhMediaFromUrl(auth, imageUrl) {
  const taskId = crypto.randomUUID();
  const res = await fcFetch('/run-task', {
    auth,
    body: {
      type: 'image',
      billing: 'none',
      taskId,
      forward: {
        provider: 'runninghub',
        path: '/media/upload/binary',
        method: 'POST',
        rhRegion: 'cn',
        uploadFromUrl: {
          url: imageUrl,
          filename: 'minimax-h3-ref.jpg',
          contentType: 'image/jpeg',
          fieldName: 'file',
        },
      },
    },
    timeoutMs: 120_000,
  });
  if (res.status !== 200) {
    throw new Error(`RH media upload HTTP ${res.status}: ${JSON.stringify(res.json).slice(0, 400)}`);
  }
  const field = parseRhMediaField(res.json);
  if (!field) {
    throw new Error(`RH media upload no fileName: ${JSON.stringify(res.json).slice(0, 500)}`);
  }
  return field;
}

function buildH3I2vForward(prompt, rhImageField, durationSec = '10') {
  return {
    provider: 'runninghub',
    path: I2V_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '13', fieldName: 'image', fieldValue: rhImageField, description: '参考图' },
        {
          nodeId: '57',
          fieldName: 'aspect_ratio',
          fieldValue: '16:9 (Widescreen)',
          description: '比例选择',
        },
        { nodeId: '57', fieldName: 'megapixels', fieldValue: '0.9', description: '分辨率（参考介绍）' },
        { nodeId: '56', fieldName: 'value', fieldValue: durationSec, description: '时间' },
        { nodeId: '149', fieldName: 'text', fieldValue: prompt, description: '提示词' },
      ],
      instanceType: 'plus',
      usePersonalQueue: 'false',
    },
    billingModelId: `minimax-h3-i2v-720p-${durationSec}s`,
    rhRegion: 'cn',
  };
}

const db = await import('../lib/db-tablestore.mjs');
const { tryClaimOneQueuedTask } = await import('../lib/queueScheduler.mjs');

async function setBalance(userId, balance) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p94live.local` });
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
    await db.createUserOtpOnly({ userId, email: `${userId}@p94live.local` });
  } catch (_) {}
  await db.updateUserConcurrencyEntitlement(userId, {
    planId: 'enterprise',
    videoConcurrencyOverride: 5,
    concurrencyOverrideExpiresAt: Date.now() + 7 * 86400000,
  });
  await setBalance(userId, balance);
  const u = await db.getUserById(userId);
  return signAccessToken(userId, u?.tokenVersion ?? 0);
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
  const deps = await buildPromoteDeps();
  await tryClaimOneQueuedTask(
    {
      taskId,
      userId,
      taskType: 'video',
      queueEnteredAt: Number(t.queue_entered_at || t.created_at || Date.now()),
    },
    deps,
  );
  return db.getTaskById(taskId);
}

async function runFcWorkersUntil(taskId, { maxRounds = 60, intervalMs = 10000 } = {}) {
  for (let i = 0; i < maxRounds; i++) {
    await fcInternal('charge-claimed-tasks', { max_tasks: 50 });
    await fcInternal('dispatch-charged-tasks', { max_tasks: 50 });
    await fcInternal('poll-provider-tasks', { max_tasks: 50 });
    const t = await db.getTaskById(taskId);
    log(`r${i} status=${t?.status} stage=${t?.execution_stage} pid=${String(t?.provider_task_id || '').slice(0, 22)}`);
    const st = String(t?.status || '').toLowerCase();
    if (['success', 'failed', 'cancelled', 'timeout'].includes(st)) {
      return { task: t, timeout: false };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { task: await db.getTaskById(taskId), timeout: true };
}

async function main() {
  if (!FC_BASE || !FC_TOKEN || !ADMIN_SECRET || !JWT_SECRET) {
    REPORT.errors.push('missing FC/JWT env');
    fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
    process.exit(3);
  }
  if (!OSS_IMAGE.startsWith('https://')) {
    REPORT.errors.push(`bad OSS image: ${OSS_IMAGE}`);
    fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
    process.exit(4);
  }

  // Invalid-forward
  {
    const plantUser = `${PREFIX}bad`;
    await setupUser(plantUser, 100);
    const badIds = [];
    for (let i = 0; i < 5; i++) {
      const tid = `0bad${PREFIX}${i}`;
      await db.upsertTask(tid, plantUser, {
        status: 'claimed',
        execution_stage: 'charged',
        task_type: 'video',
        model_id: 'p94-invalid',
        quoted_cost: 0,
        provider_forward_json: '',
        user_slot_held: '0',
        platform_slot_held: '0',
        charged_at: Date.now(),
      });
      badIds.push(tid);
    }
    const cands = await db.listChargedTasksForDispatch({ maxTasks: 30, maxScanRows: 50000 });
    const inv = await db.listInvalidForwardChargedTasks({ maxTasks: 30, maxScanRows: 50000 });
    const d = await fcInternal('dispatch-charged-tasks', { max_tasks: 5 });
    const ok =
      !badIds.some((id) => cands.includes(id)) &&
      badIds.every((id) => inv.includes(id)) &&
      d.status === 200 &&
      d.json?.invalid_forward != null;
    REPORT.invalid_forward = ok ? 'PASS' : 'FAIL';
    if (!ok) REPORT.errors.push('invalid-forward fail');
    log(`invalid_forward=${REPORT.invalid_forward}`);
  }

  // H3 I2V live
  const userId = `${PREFIX}i2v`;
  const initial = 2000;
  const token = await setupUser(userId, initial);
  log(`oss_image=${OSS_IMAGE.slice(0, 90)}`);
  let rhFile = '';
  try {
    rhFile = await uploadRhMediaFromUrl(token, OSS_IMAGE);
    log(`rh_file=${rhFile}`);
  } catch (e) {
    REPORT.errors.push(`RH media upload failed: ${e?.message || e}`);
    fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
    console.log(JSON.stringify(REPORT, null, 2));
    process.exit(5);
  }

  const prompt = 'PHASE 9.4 MiniMax H3 I2V queue live, gentle camera, soft light, no text.';
  const forward = buildH3I2vForward(prompt, rhFile, '10');

  const createRes = await fcFetch('/tasks/create', {
    auth: token,
    body: {
      model_id: H3_I2V_SKU,
      type: 'video',
      execution_mode: 'queue',
      provider_forward_json: forward,
      params: { model: 'minimax-h3-i2v', nxCloudQueueGoldenPath: true, prompt },
      nodeData: {
        model: 'minimax-h3-i2v',
        durationMinimaxH3: '10',
        resolutionMinimaxH3: '720p',
        aspect_ratio: '16:9',
        prompt,
        imageCount: 1,
      },
    },
  });

  if (createRes.status !== 200 || !createRes.json?.task_id) {
    REPORT.errors.push(`create failed: ${createRes.status} ${JSON.stringify(createRes.json)}`);
    fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
    console.log(JSON.stringify(REPORT, null, 2));
    process.exit(2);
  }

  const taskId = String(createRes.json.task_id);
  const quoted = createRes.json?.quoted_cost_coins ?? createRes.json?.quoted_cost ?? null;
  const t0 = await db.getTaskById(taskId);
  const fwd = JSON.parse(t0?.provider_forward_json || '{}');
  if (fwd.rhRegion !== 'cn' || fwd.path !== I2V_PATH || fwd.body?.instanceType !== 'plus') {
    REPORT.errors.push(`bad forward ${JSON.stringify(fwd).slice(0, 400)}`);
    fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
    process.exit(6);
  }

  await promoteOneTask(taskId, userId);
  const worker = await runFcWorkersUntil(taskId, { maxRounds: 60, intervalMs: 10000 });
  const final = worker.task;
  const bal = (await db.getUserById(userId))?.balance;
  const userSnap = await db.getUserConcurrencyCounterSnapshot(userId, 'video');
  const platSnap = await db.getPlatformConcurrencyPoolSnapshot();
  const charge = await db.getTaskCharge(taskId);
  const chargeAmt = Number(initial) - Number(bal);

  REPORT.h3_i2v_e2e = {
    aixflow_task: taskId,
    rh_task: final?.provider_task_id || '',
    submit_region: fwd.rhRegion,
    poll_region: fwd.rhRegion,
    billing_sku: H3_I2V_SKU,
    quoted_cost: quoted,
    actual_charge: chargeAmt,
    charge_count: charge && String(charge.status || '').toLowerCase() === 'charged' ? 1 : 0,
    refund_count: charge && String(charge.status || '').toLowerCase() === 'refunded' ? 1 : 0,
    final_status: final?.status,
    result_url: final?.result_oss_url || '',
    user_occupied: userSnap?.occupied ?? userSnap?.running ?? null,
    platform_occupied: platSnap?.video?.running ?? null,
    user_slot_held: final?.user_slot_held,
    platform_slot_held: final?.platform_slot_held,
    rh_file: rhFile,
    worker_timeout: worker.timeout,
  };

  const i2vOk =
    String(final?.status).toLowerCase() === 'success' &&
    String(final?.provider_task_id || '') &&
    String(final?.result_oss_url || '') &&
    fwd.rhRegion === 'cn' &&
    Number(userSnap?.occupied ?? userSnap?.running ?? 0) === 0 &&
    !final?.user_slot_held &&
    !final?.platform_slot_held &&
    chargeAmt > 0 &&
    String(charge?.status || '').toLowerCase() === 'charged' &&
    REPORT.h3_i2v_e2e.charge_count === 1 &&
    REPORT.h3_i2v_e2e.refund_count === 0;

  if (!i2vOk) REPORT.errors.push(worker.timeout ? 'H3 I2V timeout' : 'H3 I2V e2e not success');
  log(`h3_i2v_ok=${i2vOk} status=${final?.status} pid=${final?.provider_task_id}`);

  // Dup charge/refund (local mock pipeline)
  {
    const { handleTasksCreate } = await import('../lib/handleTasksCreate.mjs');
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    const { dispatchOneChargedTask, pollOneProviderTask } = await import('../lib/providerPipeline.mjs');
    const uDup = `${PREFIX}dup`;
    await setupUser(uDup, 500);
    const cr = await handleTasksCreate(
      uDup,
      {
        model_id: H3_I2V_SKU,
        type: 'video',
        execution_mode: 'queue',
        provider_forward_json: buildH3I2vForward('dup', rhFile, '10'),
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
    if (REPORT.duplicate_charge !== 'PASS') REPORT.errors.push('dup charge fail');

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
    if (REPORT.duplicate_refund !== 'PASS') REPORT.errors.push('dup refund fail');
    log(`dup_charge=${REPORT.duplicate_charge} dup_refund=${REPORT.duplicate_refund}`);
  }

  async function quickQueue(model, sku, forward, regionExpect, label) {
    const u = `${PREFIX}${label}`;
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
      REPORT.errors.push(`${label} create fail ${cr.status}`);
      return 'FAIL';
    }
    const tid = String(cr.json.task_id);
    await promoteOneTask(tid, u);
    const w = await runFcWorkersUntil(tid, { maxRounds: 45, intervalMs: 10000 });
    const f = JSON.parse((await db.getTaskById(tid))?.provider_forward_json || '{}');
    const ok = String(w.task?.status).toLowerCase() === 'success' && f.rhRegion === regionExpect;
    if (!ok) REPORT.errors.push(`${label} fail status=${w.task?.status} region=${f.rhRegion}`);
    return ok ? 'PASS' : 'FAIL';
  }

  REPORT.rhart_t2v_regression = await quickQueue(
    'rhart-video-x',
    RHART_SKU,
    {
      provider: 'runninghub',
      path: '/rhart-video-g/text-to-video',
      method: 'POST',
      body: { prompt: 'PHASE94 rhart t2v', aspectRatio: '16:9', resolution: '720p', duration: 10 },
      billingModelId: RHART_SKU,
      rhRegion: 'ai',
    },
    'ai',
    'rhartt2v',
  );
  log(`rhart_t2v=${REPORT.rhart_t2v_regression}`);

  // rhart I2V regression — reuse OSS image in imageUrls (openapi path not needed for rhart)
  REPORT.rhart_i2v_regression = await quickQueue(
    'rhart-video-x',
    RHART_SKU,
    {
      provider: 'runninghub',
      path: '/rhart-video-g/image-to-video',
      method: 'POST',
      body: {
        prompt: 'PHASE94 rhart i2v',
        aspectRatio: '16:9',
        imageUrls: [OSS_IMAGE],
        resolution: '720p',
        duration: 10,
      },
      billingModelId: RHART_SKU,
      rhRegion: 'ai',
    },
    'ai',
    'rharti2v',
  );
  log(`rhart_i2v=${REPORT.rhart_i2v_regression}`);

  REPORT.h3_t2v_regression = await quickQueue(
    'minimax-h3-t2v',
    H3_T2V_SKU,
    {
      provider: 'runninghub',
      path: H3_T2V_PATH,
      method: 'POST',
      body: {
        nodeInfoList: [
          { nodeId: '149', fieldName: 'text', fieldValue: 'PHASE94 H3 T2V', description: '提示词' },
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
      billingModelId: H3_T2V_SKU,
      rhRegion: 'cn',
    },
    'cn',
    'h3t2v',
  );
  log(`h3_t2v=${REPORT.h3_t2v_regression}`);

  REPORT.ltx_regression = await quickQueue(
    'ltx-2.3-t2v',
    LTX_SKU,
    {
      provider: 'runninghub',
      path: LTX_PATH,
      method: 'POST',
      body: {
        nodeInfoList: [
          { nodeId: '43', fieldName: 'value', fieldValue: '1280' },
          { nodeId: '44', fieldName: 'value', fieldValue: '720' },
          { nodeId: '74', fieldName: 'value', fieldValue: '10' },
          { nodeId: '73', fieldName: 'text', fieldValue: 'PHASE94 LTX T2V' },
        ],
        instanceType: 'plus',
        usePersonalQueue: 'false',
      },
      billingModelId: LTX_SKU,
      rhRegion: 'ai',
    },
    'ai',
    'ltx',
  );
  log(`ltx=${REPORT.ltx_regression}`);

  // Platform occupied may be non-zero if other jobs run; require our task slots released
  const platOk = !final?.platform_slot_held;
  if (!platOk) REPORT.errors.push('platform_slot not released');

  const allOk =
    i2vOk &&
    platOk &&
    REPORT.rhart_t2v_regression === 'PASS' &&
    REPORT.rhart_i2v_regression === 'PASS' &&
    REPORT.h3_t2v_regression === 'PASS' &&
    REPORT.ltx_regression === 'PASS' &&
    REPORT.invalid_forward === 'PASS' &&
    REPORT.duplicate_charge === 'PASS' &&
    REPORT.duplicate_refund === 'PASS' &&
    REPORT.errors.length === 0;

  REPORT.conclusion = allOk ? 'PASS' : 'FAIL';
  REPORT.finished_at = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
  console.log(
    JSON.stringify(
      { conclusion: REPORT.conclusion, errors: REPORT.errors, h3_i2v: REPORT.h3_i2v_e2e },
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
