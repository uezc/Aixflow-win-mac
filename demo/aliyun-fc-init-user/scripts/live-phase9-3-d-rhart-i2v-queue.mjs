/**
 * Phase 9.3-D Live E2E — rhart-video-x I2V Unified Queue（真实 FC + OTS + RH.ai）
 * + rhart T2V / H3 / LTX / invalid-forward 回归
 *
 * node scripts/live-phase9-3-d-rhart-i2v-queue.mjs
 *
 * 使用 1 张公网 HTTPS 图（模拟客户端 Create 前已完成 OSS 预处理后的 imageUrls）。
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

const PREFIX = `__p93dlive_${Date.now().toString(36)}_`;
const FC_BASE = (process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '').replace(/\/$/, '');
const FC_TOKEN = process.env.ALIYUN_FC_TOKEN || '';
const ADMIN_SECRET = process.env.ADMIN_SETTLE_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || '';
const I2V_PATH = '/rhart-video-g/image-to-video';
const T2V_PATH = '/rhart-video-g/text-to-video';
const RHART_SKU = 'rhart-video-x-720p-10s';
const H3_PATH = '/run/ai-app/2085682347676102657';
const H3_SKU = 'minimax-h3-t2v-720p-10s';
const LTX_PATH = '/run/ai-app/2034994243982336001';
const LTX_SKU = 'ltx-2-3-720-10s';
/** 公网 HTTPS 参考图（模拟 Create 前 OSS 产物；须 RH 可拉取，优先我方 OSS） */
const I2V_IMAGE =
  process.env.P93D_I2V_IMAGE_URL?.trim() ||
  (fs.existsSync(path.join(__dirname, 'p93d-i2v-image-url.txt'))
    ? fs.readFileSync(path.join(__dirname, 'p93d-i2v-image-url.txt'), 'utf8').trim()
    : '') ||
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p93d-i2v-test/1788607602254_b2eac80c.jpg';
const OUT = path.join(__dirname, 'phase9-3-d-rhart-i2v-live-e2e-result.json');

const REPORT = {
  started_at: new Date().toISOString(),
  conclusion: 'BLOCKED',
  errors: [],
  i2v_e2e: null,
  rhart_t2v_regression: 'FAIL',
  h3_regression: 'FAIL',
  ltx_regression: 'FAIL',
  invalid_forward: 'FAIL',
  duplicate_charge: 'SKIP',
  duplicate_refund: 'SKIP',
};

function log(msg) {
  console.log(`[p93d-live] ${msg}`);
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

function buildI2vForward(prompt) {
  return {
    provider: 'runninghub',
    path: I2V_PATH,
    method: 'POST',
    body: {
      prompt,
      aspectRatio: '16:9',
      imageUrls: [I2V_IMAGE],
      resolution: '720p',
      duration: 10,
    },
    billingModelId: RHART_SKU,
    rhRegion: 'ai',
  };
}

const db = await import('../lib/db-tablestore.mjs');
const { tryClaimOneQueuedTask } = await import('../lib/queueScheduler.mjs');

async function setBalance(userId, balance) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p93dlive.local` });
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
    await db.createUserOtpOnly({ userId, email: `${userId}@p93dlive.local` });
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

  // Invalid-forward regression
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
        model_id: 'p93d-invalid',
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

  // I2V real E2E — 1 image, 720p, 10s
  const userId = `${PREFIX}i2v`;
  const initial = 2000;
  const token = await setupUser(userId, initial);
  const prompt =
    'PHASE 9.3-D rhart-video-x I2V queue live, gentle camera, soft light, no text, no watermark.';
  const forward = buildI2vForward(prompt);

  const createRes = await fcFetch('/tasks/create', {
    auth: token,
    body: {
      model_id: RHART_SKU,
      type: 'video',
      execution_mode: 'queue',
      provider_forward_json: forward,
      params: { model: 'rhart-video-x', nxCloudQueueGoldenPath: true, prompt },
      nodeData: {
        model: 'rhart-video-x',
        durationGrok3: '10',
        aspect_ratio: '16:9',
        prompt,
        imageCount: 1,
      },
    },
  });

  if (createRes.status !== 200 || !createRes.json?.task_id) {
    REPORT.errors.push(`I2V create failed: ${createRes.status} ${JSON.stringify(createRes.json)}`);
    fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
    console.log(JSON.stringify(REPORT, null, 2));
    process.exit(2);
  }

  const taskId = String(createRes.json.task_id);
  const t0 = await db.getTaskById(taskId);
  const fwd = JSON.parse(t0?.provider_forward_json || '{}');
  if (
    fwd.rhRegion !== 'ai' ||
    fwd.path !== I2V_PATH ||
    !Array.isArray(fwd.body?.imageUrls) ||
    !String(fwd.body.imageUrls[0] || '').startsWith('https://') ||
    typeof fwd.body.duration !== 'number'
  ) {
    REPORT.errors.push(`bad I2V forward: ${JSON.stringify(fwd).slice(0, 400)}`);
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
  const quoted = createRes.json?.quoted_cost_coins ?? createRes.json?.quoted_cost ?? null;

  REPORT.i2v_e2e = {
    aixflow_task: taskId,
    rh_task: final?.provider_task_id || '',
    submit_region: fwd.rhRegion,
    poll_region: fwd.rhRegion,
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
    charge_row: charge ? { status: charge.status, amount: charge.amount } : null,
    worker_timeout: worker.timeout,
    imageUrls_n: fwd.body?.imageUrls?.length,
  };

  const i2vOk =
    String(final?.status).toLowerCase() === 'success' &&
    String(final?.provider_task_id || '') &&
    String(final?.result_oss_url || '') &&
    fwd.rhRegion === 'ai' &&
    Number(userSnap?.occupied ?? userSnap?.running ?? 0) === 0 &&
    !final?.user_slot_held &&
    !final?.platform_slot_held &&
    chargeAmt > 0 &&
    String(charge?.status || '').toLowerCase() === 'charged';

  if (!i2vOk) REPORT.errors.push(worker.timeout ? 'I2V worker timeout' : 'I2V e2e not success');
  log(`i2v_ok=${i2vOk} status=${final?.status} pid=${final?.provider_task_id}`);

  // Duplicate charge / refund (local OTS mock path after live create pattern)
  {
    process.env.NX_SKIP_QUEUE_PIPELINE_ON_CREATE = '1';
    const { handleTasksCreate } = await import('../lib/handleTasksCreate.mjs');
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    const { dispatchOneChargedTask, pollOneProviderTask } = await import('../lib/providerPipeline.mjs');
    const uDup = `${PREFIX}dup`;
    await setupUser(uDup, 500);
    const cr = await handleTasksCreate(
      uDup,
      {
        model_id: RHART_SKU,
        type: 'video',
        execution_mode: 'queue',
        provider_forward_json: buildI2vForward('dup charge mock'),
        params: { model: 'rhart-video-x', nxCloudQueueGoldenPath: true },
        nodeData: { model: 'rhart-video-x' },
      },
      db,
      { getFinalPrice: () => 4 },
    );
    const tid = cr.task_id;
    await promoteOneTask(tid, uDup);
    const bal0 = (await db.getUserById(uDup)).balance;
    for (let i = 0; i < 10; i++) await chargeClaimedTask(tid, db);
    const bal1 = (await db.getUserById(uDup)).balance;
    const dupChgOk = Number(bal0) - Number(bal1) === 4;
    REPORT.duplicate_charge = dupChgOk ? 'PASS' : 'FAIL';
    if (!dupChgOk) REPORT.errors.push('duplicate charge fail');

    await dispatchOneChargedTask(tid, db, {
      submitRunningHub: async () => ({
        ok: true,
        provider_task_id: `rh_dup_${crypto.randomUUID()}`,
        data: {},
        rhRegion: 'ai',
      }),
    });
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({ ok: true, status: 'FAILED', error: 'mock fail' }),
    });
    const bal2 = (await db.getUserById(uDup)).balance;
    for (let i = 0; i < 10; i++) {
      await pollOneProviderTask(tid, db, {
        queryRunningHub: async () => ({ ok: true, status: 'FAILED', error: 'again' }),
      });
    }
    const bal3 = (await db.getUserById(uDup)).balance;
    const dupRefOk = Number(bal2) === Number(bal3) && Number(bal2) === Number(bal0);
    REPORT.duplicate_refund = dupRefOk ? 'PASS' : 'FAIL';
    if (!dupRefOk) REPORT.errors.push(`duplicate refund fail bal0=${bal0} bal2=${bal2} bal3=${bal3}`);
    log(`dup_charge=${REPORT.duplicate_charge} dup_refund=${REPORT.duplicate_refund}`);
  }

  // rhart T2V regression
  {
    const u = `${PREFIX}rhart`;
    const tok = await setupUser(u, 2000);
    const promptRh = 'PHASE93D rhart T2V regression, meadow, static, no text.';
    const cr = await fcFetch('/tasks/create', {
      auth: tok,
      body: {
        model_id: RHART_SKU,
        type: 'video',
        execution_mode: 'queue',
        provider_forward_json: {
          provider: 'runninghub',
          path: T2V_PATH,
          method: 'POST',
          body: { prompt: promptRh, aspectRatio: '16:9', resolution: '720p', duration: 10 },
          billingModelId: RHART_SKU,
          rhRegion: 'ai',
        },
        params: { model: 'rhart-video-x', nxCloudQueueGoldenPath: true, prompt: promptRh },
        nodeData: { model: 'rhart-video-x', durationGrok3: '10', aspect_ratio: '16:9' },
      },
    });
    if (cr.status === 200 && cr.json?.task_id) {
      const tid = String(cr.json.task_id);
      await promoteOneTask(tid, u);
      const w = await runFcWorkersUntil(tid, { maxRounds: 45, intervalMs: 10000 });
      const ok =
        String(w.task?.status).toLowerCase() === 'success' &&
        String(JSON.parse((await db.getTaskById(tid))?.provider_forward_json || '{}').rhRegion) === 'ai';
      REPORT.rhart_t2v_regression = ok ? 'PASS' : 'FAIL';
      if (!ok) REPORT.errors.push(`rhart t2v fail status=${w.task?.status}`);
    } else {
      REPORT.errors.push(`rhart t2v create fail ${cr.status}`);
    }
    log(`rhart_t2v=${REPORT.rhart_t2v_regression}`);
  }

  // H3 T2V .cn regression
  {
    const u = `${PREFIX}h3`;
    const tok = await setupUser(u, 2000);
    const promptH3 = 'PHASE93D H3 T2V regression, calm lake, static, no text.';
    const cr = await fcFetch('/tasks/create', {
      auth: tok,
      body: {
        model_id: H3_SKU,
        type: 'video',
        execution_mode: 'queue',
        provider_forward_json: {
          provider: 'runninghub',
          path: H3_PATH,
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
          billingModelId: H3_SKU,
          rhRegion: 'cn',
        },
        params: { model: 'minimax-h3-t2v', nxCloudQueueGoldenPath: true, prompt: promptH3 },
        nodeData: { model: 'minimax-h3-t2v', durationMinimaxH3: '10', resolutionMinimaxH3: '720p' },
      },
    });
    if (cr.status === 200 && cr.json?.task_id) {
      const tid = String(cr.json.task_id);
      await promoteOneTask(tid, u);
      const w = await runFcWorkersUntil(tid, { maxRounds: 45, intervalMs: 10000 });
      const fwdH3 = JSON.parse((await db.getTaskById(tid))?.provider_forward_json || '{}');
      const ok = String(w.task?.status).toLowerCase() === 'success' && fwdH3.rhRegion === 'cn';
      REPORT.h3_regression = ok ? 'PASS' : 'FAIL';
      if (!ok) REPORT.errors.push(`h3 fail status=${w.task?.status} region=${fwdH3.rhRegion}`);
    } else {
      REPORT.errors.push(`h3 create fail ${cr.status}`);
    }
    log(`h3=${REPORT.h3_regression}`);
  }

  // LTX T2V .ai regression
  {
    const u = `${PREFIX}ltx`;
    const tok = await setupUser(u, 2000);
    const promptLtx = 'PHASE93D LTX T2V regression, calm lake sunrise, static, no text.';
    const cr = await fcFetch('/tasks/create', {
      auth: tok,
      body: {
        model_id: LTX_SKU,
        type: 'video',
        execution_mode: 'queue',
        provider_forward_json: {
          provider: 'runninghub',
          path: LTX_PATH,
          method: 'POST',
          body: {
            nodeInfoList: [
              { nodeId: '43', fieldName: 'value', fieldValue: '1280' },
              { nodeId: '44', fieldName: 'value', fieldValue: '720' },
              { nodeId: '74', fieldName: 'value', fieldValue: '10' },
              { nodeId: '73', fieldName: 'text', fieldValue: promptLtx },
            ],
            instanceType: 'plus',
            usePersonalQueue: 'false',
          },
          billingModelId: LTX_SKU,
          rhRegion: 'ai',
        },
        params: { model: 'ltx-2.3-t2v', nxCloudQueueGoldenPath: true, prompt: promptLtx },
        nodeData: {
          model: 'ltx-2.3-t2v',
          durationLtx23T2v: '10',
          resolutionLtx23T2v: '720',
          aspect_ratio: '16:9',
        },
      },
    });
    if (cr.status === 200 && cr.json?.task_id) {
      const tid = String(cr.json.task_id);
      await promoteOneTask(tid, u);
      const w = await runFcWorkersUntil(tid, { maxRounds: 45, intervalMs: 10000 });
      const fwdLtx = JSON.parse((await db.getTaskById(tid))?.provider_forward_json || '{}');
      const ok = String(w.task?.status).toLowerCase() === 'success' && fwdLtx.rhRegion === 'ai';
      REPORT.ltx_regression = ok ? 'PASS' : 'FAIL';
      if (!ok) REPORT.errors.push(`ltx fail status=${w.task?.status} region=${fwdLtx.rhRegion}`);
    } else {
      REPORT.errors.push(`ltx create fail ${cr.status}`);
    }
    log(`ltx=${REPORT.ltx_regression}`);
  }

  const allOk =
    i2vOk &&
    REPORT.rhart_t2v_regression === 'PASS' &&
    REPORT.h3_regression === 'PASS' &&
    REPORT.ltx_regression === 'PASS' &&
    REPORT.invalid_forward === 'PASS' &&
    REPORT.duplicate_charge === 'PASS' &&
    REPORT.duplicate_refund === 'PASS' &&
    REPORT.errors.length === 0;

  REPORT.conclusion = allOk ? 'PASS' : 'FAIL';
  REPORT.finished_at = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
  console.log(JSON.stringify({ conclusion: REPORT.conclusion, errors: REPORT.errors, i2v: REPORT.i2v_e2e }, null, 2));
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  REPORT.errors.push(String(e?.stack || e));
  fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
  process.exit(2);
});
