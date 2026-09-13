/**
 * Phase 9.3-B Live E2E — ltx-2.3-t2v Unified Queue（真实 FC + OTS + RH.ai）
 * + rhart / H3 / invalid-forward 回归（mock+轻量）
 *
 * node scripts/live-phase9-3-b-ltx-t2v-queue.mjs
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

const PREFIX = `__p93blive_${Date.now().toString(36)}_`;
const FC_BASE = (process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '').replace(/\/$/, '');
const FC_TOKEN = process.env.ALIYUN_FC_TOKEN || '';
const ADMIN_SECRET = process.env.ADMIN_SETTLE_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || '';
const LTX_PATH = '/run/ai-app/2034994243982336001';
const LTX_SKU = 'ltx-2-3-720-10s';
const OUT = path.join(__dirname, 'phase9-3-b-ltx-t2v-live-e2e-result.json');

const REPORT = {
  started_at: new Date().toISOString(),
  conclusion: 'BLOCKED',
  errors: [],
  ltx_e2e: null,
  rhart_regression: 'FAIL',
  h3_regression: 'FAIL',
  invalid_forward: 'FAIL',
};

function log(msg) {
  console.log(`[p93b-live] ${msg}`);
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

function buildLtxForward(prompt) {
  return {
    provider: 'runninghub',
    path: LTX_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '43', fieldName: 'value', fieldValue: '1280' },
        { nodeId: '44', fieldName: 'value', fieldValue: '720' },
        { nodeId: '74', fieldName: 'value', fieldValue: '10' },
        { nodeId: '73', fieldName: 'text', fieldValue: prompt },
      ],
      instanceType: 'plus',
      usePersonalQueue: 'false',
    },
    billingModelId: LTX_SKU,
    rhRegion: 'ai',
  };
}

const db = await import('../lib/db-tablestore.mjs');
const { tryClaimOneQueuedTask } = await import('../lib/queueScheduler.mjs');

async function setBalance(userId, balance) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p93blive.local` });
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
    await db.createUserOtpOnly({ userId, email: `${userId}@p93blive.local` });
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
  const stages = [];
  for (let i = 0; i < maxRounds; i++) {
    await fcInternal('charge-claimed-tasks', { max_tasks: 50 });
    const d = await fcInternal('dispatch-charged-tasks', { max_tasks: 50 });
    await fcInternal('poll-provider-tasks', { max_tasks: 50 });
    const t = await db.getTaskById(taskId);
    stages.push({
      round: i,
      status: t?.status,
      stage: t?.execution_stage,
      pid: t?.provider_task_id,
      dispatch_invalid: d.json?.invalid_forward || null,
    });
    log(`r${i} status=${t?.status} stage=${t?.execution_stage} pid=${String(t?.provider_task_id || '').slice(0, 22)}`);
    const st = String(t?.status || '').toLowerCase();
    if (['success', 'failed', 'cancelled', 'timeout'].includes(st)) {
      return { task: t, stages, timeout: false };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { task: await db.getTaskById(taskId), stages, timeout: true };
}

async function main() {
  if (!FC_BASE || !FC_TOKEN || !ADMIN_SECRET || !JWT_SECRET) {
    REPORT.errors.push('missing FC/JWT env');
    fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
    process.exit(3);
  }

  // Invalid-forward regression (OTS filter + FC signature)
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
        model_id: 'p93b-invalid',
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
    if (!ok) REPORT.errors.push('invalid-forward regression fail');
    log(`invalid_forward=${REPORT.invalid_forward}`);
  }

  // LTX real E2E
  const userId = `${PREFIX}ltx`;
  const initial = 2000;
  const token = await setupUser(userId, initial);
  const prompt = 'PHASE 9.3-B LTX T2V queue live, calm lake sunrise, static camera, no text.';
  const forward = buildLtxForward(prompt);

  const createRes = await fcFetch('/tasks/create', {
    auth: token,
    body: {
      model_id: LTX_SKU,
      type: 'video',
      execution_mode: 'queue',
      provider_forward_json: forward,
      params: { model: 'ltx-2.3-t2v', nxCloudQueueGoldenPath: true, prompt },
      nodeData: {
        model: 'ltx-2.3-t2v',
        durationLtx23T2v: '10',
        resolutionLtx23T2v: '720',
        aspect_ratio: '16:9',
        prompt,
      },
    },
  });

  if (createRes.status !== 200 || !createRes.json?.task_id) {
    REPORT.errors.push(`LTX create failed: ${createRes.status} ${JSON.stringify(createRes.json)}`);
    fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
    console.log(JSON.stringify(REPORT, null, 2));
    process.exit(2);
  }

  const taskId = String(createRes.json.task_id);
  const t0 = await db.getTaskById(taskId);
  const fwd = JSON.parse(t0?.provider_forward_json || '{}');
  if (fwd.rhRegion !== 'ai' || fwd.path !== LTX_PATH) {
    REPORT.errors.push(`bad forward: ${fwd.rhRegion} ${fwd.path}`);
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

  REPORT.ltx_e2e = {
    aixflow_task: taskId,
    rh_task: final?.provider_task_id || '',
    region: fwd.rhRegion,
    charge: chargeAmt,
    quoted: createRes.json?.quoted_cost_coins ?? createRes.json?.quoted_cost ?? null,
    final: final?.status,
    result_url: final?.result_oss_url || '',
    user_occupied: userSnap?.occupied ?? userSnap?.running ?? null,
    platform_occupied: platSnap?.video?.running ?? null,
    user_slot_held: final?.user_slot_held,
    platform_slot_held: final?.platform_slot_held,
    charge_row: charge ? { status: charge.status, amount: charge.amount } : null,
    worker_timeout: worker.timeout,
  };

  const ltxOk =
    String(final?.status).toLowerCase() === 'success' &&
    String(final?.provider_task_id || '') &&
    String(final?.result_oss_url || '') &&
    fwd.rhRegion === 'ai' &&
    Number(userSnap?.occupied ?? userSnap?.running ?? 0) === 0 &&
    !final?.user_slot_held &&
    !final?.platform_slot_held &&
    chargeAmt > 0 &&
    String(charge?.status || '').toLowerCase() === 'charged';

  if (!ltxOk) REPORT.errors.push(worker.timeout ? 'LTX worker timeout' : 'LTX e2e not success');

  // rhart regression (queue create + FC workers) — short path
  {
    const u = `${PREFIX}rhart`;
    const tok = await setupUser(u, 2000);
    const promptRh = 'PHASE93B rhart regression, meadow, static, no text.';
    const cr = await fcFetch('/tasks/create', {
      auth: tok,
      body: {
        model_id: 'rhart-video-x-720p-10s',
        type: 'video',
        execution_mode: 'queue',
        provider_forward_json: {
          provider: 'runninghub',
          path: '/rhart-video-g/text-to-video',
          method: 'POST',
          body: { prompt: promptRh, aspectRatio: '16:9', resolution: '720p', duration: 10 },
          billingModelId: 'rhart-video-x-720p-10s',
          rhRegion: 'ai',
        },
        params: { model: 'rhart-video-x', nxCloudQueueGoldenPath: true, prompt: promptRh },
        nodeData: { model: 'rhart-video-x', durationGrok3: '10', aspect_ratio: '16:9' },
      },
    });
    if (cr.status === 200 && cr.json?.task_id) {
      const tid = String(cr.json.task_id);
      await promoteOneTask(tid, u);
      const w = await runFcWorkersUntil(tid, { maxRounds: 55, intervalMs: 10000 });
      const f = w.task;
      const fwdRh = JSON.parse((await db.getTaskById(tid))?.provider_forward_json || '{}');
      const ok =
        String(f?.status).toLowerCase() === 'success' &&
        fwdRh.rhRegion === 'ai' &&
        String(f?.provider_task_id || '') &&
        String(f?.result_oss_url || '');
      REPORT.rhart_regression = ok ? 'PASS' : 'FAIL';
      REPORT.rhart_detail = { task: tid, rh: f?.provider_task_id, final: f?.status, region: fwdRh.rhRegion };
      if (!ok) REPORT.errors.push('rhart regression fail');
    } else {
      REPORT.errors.push(`rhart create fail ${cr.status}`);
    }
    log(`rhart=${REPORT.rhart_regression}`);
  }

  // H3 regression
  {
    const u = `${PREFIX}h3`;
    const tok = await setupUser(u, 2000);
    const promptH3 = 'PHASE93B H3 regression, calm lake, static, no text.';
    const cr = await fcFetch('/tasks/create', {
      auth: tok,
      body: {
        model_id: 'minimax-h3-t2v-720p-10s',
        type: 'video',
        execution_mode: 'queue',
        provider_forward_json: {
          provider: 'runninghub',
          path: '/run/ai-app/2085682347676102657',
          method: 'POST',
          body: {
            nodeInfoList: [
              { nodeId: '149', fieldName: 'text', fieldValue: promptH3, description: '提示词' },
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
        params: { model: 'minimax-h3-t2v', nxCloudQueueGoldenPath: true, prompt: promptH3 },
        nodeData: {
          model: 'minimax-h3-t2v',
          durationMinimaxH3: '10',
          resolutionMinimaxH3: '720p',
          aspect_ratio: '16:9',
        },
      },
    });
    if (cr.status === 200 && cr.json?.task_id) {
      const tid = String(cr.json.task_id);
      await promoteOneTask(tid, u);
      const w = await runFcWorkersUntil(tid, { maxRounds: 55, intervalMs: 10000 });
      const f = w.task;
      const fwdH3 = JSON.parse((await db.getTaskById(tid))?.provider_forward_json || '{}');
      const ok =
        String(f?.status).toLowerCase() === 'success' &&
        fwdH3.rhRegion === 'cn' &&
        String(f?.provider_task_id || '') &&
        String(f?.result_oss_url || '');
      REPORT.h3_regression = ok ? 'PASS' : 'FAIL';
      REPORT.h3_detail = { task: tid, rh: f?.provider_task_id, final: f?.status, region: fwdH3.rhRegion };
      if (!ok) REPORT.errors.push('H3 regression fail');
    } else {
      REPORT.errors.push(`H3 create fail ${cr.status}`);
    }
    log(`h3=${REPORT.h3_regression}`);
  }

  const all =
    ltxOk &&
    REPORT.rhart_regression === 'PASS' &&
    REPORT.h3_regression === 'PASS' &&
    REPORT.invalid_forward === 'PASS';

  REPORT.conclusion = all ? 'PASS' : 'BLOCKED';
  REPORT.ended_at = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
  console.log(JSON.stringify(REPORT, null, 2));
  process.exit(all ? 0 : 2);
}

main().catch((e) => {
  REPORT.errors.push(String(e?.message || e));
  REPORT.conclusion = 'BLOCKED';
  fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
  console.error(e);
  process.exit(1);
});
