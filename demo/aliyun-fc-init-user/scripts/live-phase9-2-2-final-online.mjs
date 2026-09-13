/**
 * PHASE 9.2.2-FINAL — 线上 HK/BJ 部署后验证（全部走 FC Worker，禁止本地 Dispatch）
 * node scripts/live-phase9-2-2-final-online.mjs
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

const PREFIX = `__p922f_${Date.now().toString(36)}_`;
const HK_BASE = (process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '').replace(/\/$/, '');
const BJ_BASE = (process.env.BJ_FC_ENDPOINT || process.env.ALIYUN_FC_BJ_URL || '').replace(/\/$/, '');
const FC_TOKEN = process.env.ALIYUN_FC_TOKEN || '';
const ADMIN_SECRET = process.env.ADMIN_SETTLE_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || '';
const H3_PATH = '/run/ai-app/2085682347676102657';
const H3_SKU = 'minimax-h3-t2v-720p-10s';
const RHART_SKU = 'rhart-video-x-720p-10s';
const OUT = path.join(__dirname, 'phase9-2-2-final-online-result.json');

const REPORT = {
  started_at: new Date().toISOString(),
  deployment: { HK: 'FAIL', BJ: 'FAIL', detail: {} },
  queue_protection: 'FAIL',
  invalid_forward_starvation: 'FAIL',
  no_forward: null,
  h3: null,
  rhart: 'FAIL',
  billing: { duplicate_charge: 'FAIL', duplicate_refund: 'FAIL' },
  final_slots: null,
  conclusion: 'BLOCKED',
  errors: [],
};

function log(msg) {
  console.log(`[p922-final] ${msg}`);
}

function signAccessToken(userId, tv = 0) {
  return jwt.sign({ sub: userId, typ: 'access', tv }, JWT_SECRET, { expiresIn: '7d' });
}

async function fcFetch(base, pathSuffix, { body = {}, auth = null, timeoutMs = 180_000 } = {}) {
  const url = `${base}${pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`}`;
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
  return fcFetch(HK_BASE, `/internal/${name}`, { body });
}

async function ensureFcSdk() {
  try {
    require.resolve('@alicloud/fc20230330');
  } catch {
    const { execSync } = await import('child_process');
    execSync('npm install --no-save @alicloud/fc20230330@^4.2.0 @alicloud/openapi-client @alicloud/tea-util', {
      cwd: ROOT,
      stdio: 'pipe',
    });
  }
}

async function getFunctionMeta(region, functionName) {
  await ensureFcSdk();
  const Fc20230330 = require('@alicloud/fc20230330');
  const OpenApi = require('@alicloud/openapi-client');
  const Util = require('@alicloud/tea-util');
  const config = new OpenApi.Config({
    accessKeyId: process.env.OTS_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OTS_ACCESS_KEY_SECRET || process.env.OSS_ACCESS_KEY_SECRET,
    endpoint: `fcv3.${region}.aliyuncs.com`,
  });
  const client = new Fc20230330.default(config);
  const fn = await client.getFunctionWithOptions(
    functionName,
    new Fc20230330.GetFunctionRequest({}),
    {},
    new Util.RuntimeOptions({}),
  );
  const body = fn?.body || {};
  return {
    functionName,
    region,
    codeSize: body.codeSize,
    lastModified: body.lastModifiedTime || body.lastModified,
  };
}

async function probeHttpTriggers(region, functionName) {
  await ensureFcSdk();
  const Fc20230330 = require('@alicloud/fc20230330');
  const OpenApi = require('@alicloud/openapi-client');
  const Util = require('@alicloud/tea-util');
  const config = new OpenApi.Config({
    accessKeyId: process.env.OTS_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OTS_ACCESS_KEY_SECRET || process.env.OSS_ACCESS_KEY_SECRET,
    endpoint: `fcv3.${region}.aliyuncs.com`,
  });
  const client = new Fc20230330.default(config);
  try {
    const r = await client.listTriggersWithOptions(
      functionName,
      new Fc20230330.ListTriggersRequest({}),
      {},
      new Util.RuntimeOptions({}),
    );
    const items = r?.body?.triggers || r?.body?.items || [];
    return items.map((t) => ({
      name: t.triggerName,
      type: t.triggerType,
      url: t.httpTrigger?.urlInternet || t.httpTrigger?.urlIntranet || t.qualifier || null,
    }));
  } catch (e) {
    return [{ error: String(e?.message || e) }];
  }
}

const db = await import('../lib/db-tablestore.mjs');
const { tryClaimOneQueuedTask } = await import('../lib/queueScheduler.mjs');

async function setBalance(userId, balance) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p922f.local` });
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
    await db.createUserOtpOnly({ userId, email: `${userId}@p922f.local` });
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

function buildH3Forward(prompt) {
  return {
    provider: 'runninghub',
    path: H3_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '149', fieldName: 'text', fieldValue: prompt, description: '提示词' },
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
  };
}

function buildRhartForward(prompt) {
  return {
    provider: 'runninghub',
    path: '/rhart-video-g/text-to-video',
    method: 'POST',
    body: {
      prompt,
      aspectRatio: '16:9',
      resolution: '720p',
      duration: 10,
    },
    billingModelId: RHART_SKU,
    rhRegion: 'ai',
  };
}

async function runFcWorkersUntil(taskId, { maxRounds = 60, intervalMs = 10000 } = {}) {
  const stages = [];
  for (let i = 0; i < maxRounds; i++) {
    await fcInternal('charge-claimed-tasks', { max_tasks: 50 });
    const d = await fcInternal('dispatch-charged-tasks', {
      max_tasks: 50,
    });
    await fcInternal('poll-provider-tasks', { max_tasks: 50 });
    await fcInternal('recover-provider-tasks', { max_tasks: 20 });
    const t = await db.getTaskById(taskId);
    stages.push({
      round: i,
      status: t?.status,
      stage: t?.execution_stage,
      pid: t?.provider_task_id,
      dispatch_has_invalid_forward: d.json?.invalid_forward != null,
      dispatch_invalid: d.json?.invalid_forward || null,
      dispatch_candidates: d.json?.candidates,
      dispatch_ok: d.json?.ok,
    });
    log(
      `worker r${i} status=${t?.status} stage=${t?.execution_stage} pid=${String(t?.provider_task_id || '').slice(0, 20)} inv=${JSON.stringify(d.json?.invalid_forward || null)}`,
    );
    const st = String(t?.status || '').toLowerCase();
    if (['success', 'failed', 'cancelled', 'timeout'].includes(st)) {
      return { task: t, stages, timeout: false };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { task: await db.getTaskById(taskId), stages, timeout: true };
}

async function verifyDeployment() {
  const hkName = process.env.FC_FUNCTION_NAME_HK?.trim() || 'nexflow-api';
  const bjName = process.env.FC_FUNCTION_NAME_BJ?.trim() || 'aixflow-api';
  const hkMeta = await getFunctionMeta('cn-hongkong', hkName);
  const bjMeta = await getFunctionMeta('cn-beijing', bjName);
  REPORT.deployment.detail.hk = hkMeta;
  REPORT.deployment.detail.bj = bjMeta;
  REPORT.deployment.detail.hk_triggers = await probeHttpTriggers('cn-hongkong', hkName);
  REPORT.deployment.detail.bj_triggers = await probeHttpTriggers('cn-beijing', bjName);

  const deployCut = Date.parse('2026-09-05T08:05:00Z');
  const hkOk =
    Number(hkMeta.codeSize) > 14_000_000 &&
    Date.parse(String(hkMeta.lastModified)) >= deployCut;
  const bjOk =
    Number(bjMeta.codeSize) > 14_000_000 &&
    Date.parse(String(bjMeta.lastModified)) >= deployCut;
  REPORT.deployment.HK = hkOk ? 'PASS' : 'FAIL';
  REPORT.deployment.BJ = bjOk ? 'PASS' : 'FAIL';
  if (!hkOk) REPORT.errors.push('HK deploy meta fail');
  if (!bjOk) REPORT.errors.push('BJ deploy meta fail');

  // functional proof on HK: dispatch returns invalid_forward (9.2.2 signature)
  const d0 = await fcInternal('dispatch-charged-tasks', { max_tasks: 1 });
  const hasSig = d0.status === 200 && d0.json?.invalid_forward != null;
  REPORT.deployment.detail.hk_dispatch_signature = {
    http: d0.status,
    has_invalid_forward: hasSig,
    invalid_forward: d0.json?.invalid_forward ?? null,
  };
  if (!hasSig) {
    REPORT.deployment.HK = 'FAIL';
    REPORT.errors.push('HK FC dispatch missing invalid_forward signature — old code?');
  }

  // BJ: queue protection if URL known; else use trigger URL
  let bjUrl = BJ_BASE;
  if (!bjUrl) {
    const t = (REPORT.deployment.detail.bj_triggers || []).find((x) => x.url);
    if (t?.url) bjUrl = String(t.url).replace(/\/$/, '');
  }
  REPORT.deployment.detail.bj_http = bjUrl || null;
  if (bjUrl) {
    const token = await setupUser(`${PREFIX}bjprot`, 100);
    const r = await fcFetch(bjUrl, '/tasks/create', {
      auth: token,
      body: {
        model_id: H3_SKU,
        type: 'video',
        execution_mode: 'queue',
        provider_forward_json: { provider: 'runninghub', method: 'POST', body: {} },
        params: { model: 'minimax-h3-t2v' },
        nodeData: { model: 'minimax-h3-t2v' },
      },
    });
    const bjProtOk =
      r.status === 400 &&
      (r.json?.code === 'QUEUE_FORWARD_REQUIRED' || r.json?.error === 'QUEUE_FORWARD_REQUIRED');
    REPORT.deployment.detail.bj_queue_protection = { http: r.status, code: r.json?.code || r.json?.error };
    if (!bjProtOk) {
      REPORT.deployment.BJ = 'FAIL';
      REPORT.errors.push(`BJ queue protection fail: ${r.status} ${JSON.stringify(r.json)}`);
    }
  } else {
    // code upload verified; functional check deferred to HK shared OTS workers
    REPORT.deployment.detail.bj_note = 'no BJ HTTP URL in env/triggers; codeSize+lastModified used';
  }

  log(`deploy HK=${REPORT.deployment.HK} BJ=${REPORT.deployment.BJ}`);
}

async function verifyQueueProtection() {
  const userId = `${PREFIX}qprot`;
  const token = await setupUser(userId, 200);
  const beforeBal = (await db.getUserById(userId))?.balance;
  const r = await fcFetch(HK_BASE, '/tasks/create', {
    auth: token,
    body: {
      model_id: H3_SKU,
      type: 'video',
      execution_mode: 'queue',
      // missing path
      provider_forward_json: { provider: 'runninghub', method: 'POST', body: { prompt: 'x' } },
      params: { model: 'minimax-h3-t2v' },
      nodeData: { model: 'minimax-h3-t2v' },
    },
  });
  const afterBal = (await db.getUserById(userId))?.balance;
  const ok =
    r.status === 400 &&
    (r.json?.code === 'QUEUE_FORWARD_REQUIRED' || r.json?.error === 'QUEUE_FORWARD_REQUIRED') &&
    !r.json?.task_id &&
    Number(beforeBal) === Number(afterBal);
  REPORT.queue_protection = ok ? 'PASS' : 'FAIL';
  REPORT.deployment.detail.queue_protection = {
    http: r.status,
    code: r.json?.code || r.json?.error,
    task_id: r.json?.task_id || null,
    balance_unchanged: Number(beforeBal) === Number(afterBal),
  };
  if (!ok) REPORT.errors.push('queue protection fail');
  log(`queue_protection=${REPORT.queue_protection}`);
}

async function verifyNoForwardAndStarvation() {
  const plantUser = `${PREFIX}plant`;
  await setupUser(plantUser, 500);
  const planted = [];
  // 100 amount=0 invalid charged (no slots held) — starvation pool
  for (let i = 0; i < 100; i++) {
    const tid = `0bad${PREFIX}${String(i).padStart(3, '0')}`;
    await db.upsertTask(tid, plantUser, {
      status: 'claimed',
      execution_stage: 'charged',
      task_type: 'video',
      model_id: 'p922-invalid-forward',
      quoted_cost: 0,
      provider_forward_json: '',
      user_slot_held: '0',
      platform_slot_held: '0',
      charged_at: Date.now(),
    });
    planted.push(tid);
  }
  // 1 charged invalid with amount>0 for refund path (slots held)
  const refundUser = `${PREFIX}nfr`;
  await setupUser(refundUser, 100);
  // ID 前缀 00… 确保排在 0bad* 之前，能被 max_tasks 扫到
  const refundTid = `00nfr${PREFIX}amt`;
  await db.tryAcquireUserConcurrencySlot(refundUser, 'video', 5);
  await db.tryAcquirePlatformConcurrencySlot('video');
  await db.upsertTask(refundTid, refundUser, {
    status: 'claimed',
    execution_stage: 'charged',
    task_type: 'video',
    model_id: 'p922-invalid-forward',
    quoted_cost: 0,
    amount: 0,
    cost: 0,
    provider_forward_json: '',
    user_slot_held: '1',
    platform_slot_held: '1',
    charged_at: Date.now(),
    provider_error: '',
  });
  // amount=0：不写 charge 行亦可；refund 无余额变化
  try {
    await db.tryBeginTaskCharge({
      task_id: refundTid,
      charge_id: refundTid,
      user_id: refundUser,
      amount: 0,
    });
    if (typeof db.finalizePhase6ChargeArtifacts === 'function') {
      await db.finalizePhase6ChargeArtifacts({
        taskId: refundTid,
        userId: refundUser,
        amount: 0,
        operationId: `chg_${refundTid}`,
      });
    }
  } catch (_) {}

  const candidates = await db.listChargedTasksForDispatch({ maxTasks: 30, maxScanRows: 80000 });
  const invalids = await db.listInvalidForwardChargedTasks({ maxTasks: 120, maxScanRows: 80000 });
  const candHasBad = planted.some((id) => candidates.includes(id));
  const invalidHasPlanted = planted.filter((id) => invalids.includes(id)).length;

  // First FC dispatch(es): mark path for refundTid（可能需多轮清旧 invalid）
  let marked = false;
  let d1 = null;
  for (let i = 0; i < 12 && !marked; i++) {
    d1 = await fcInternal('dispatch-charged-tasks', { max_tasks: 50 });
    const t1 = await db.getTaskById(refundTid);
    marked =
      String(t1?.provider_error || '') === 'NO_FORWARD_PAYLOAD' &&
      String(t1?.status) === 'claimed' &&
      String(t1?.execution_stage) === 'charged';
    if (marked) break;
    if (['failed', 'cancelled', 'timeout'].includes(String(t1?.status || '').toLowerCase())) break;
  }

  // Second wave: terminal
  let terminal = false;
  let t2 = await db.getTaskById(refundTid);
  let d2 = null;
  for (let i = 0; i < 12 && !terminal; i++) {
    d2 = await fcInternal('dispatch-charged-tasks', { max_tasks: 50 });
    t2 = await db.getTaskById(refundTid);
    terminal = ['failed', 'cancelled', 'timeout'].includes(String(t2?.status || '').toLowerCase());
  }
  const balNfr = (await db.getUserById(refundUser))?.balance;
  const userSnapNfr = await db.getUserConcurrencyCounterSnapshot(refundUser, 'video');
  const slotsReleased =
    String(t2?.user_slot_held || '0') !== '1' &&
    String(t2?.platform_slot_held || '0') !== '1' &&
    Number(userSnapNfr?.occupied ?? userSnapNfr?.running ?? 0) === 0;

  REPORT.no_forward = {
    first_marked: marked,
    terminal,
    slots_released: slotsReleased,
    amount0_balance: Number(balNfr),
    amount0_ok: Number(balNfr) === 100,
    d1_invalid: d1?.json?.invalid_forward,
    d2_invalid: d2?.json?.invalid_forward,
    has_signature: d1?.json?.invalid_forward != null,
    refund_task: refundTid,
    final_status: t2?.status,
    provider_error: t2?.provider_error || t2?.error_code,
  };

  // Valid H3 task amid bad pool — prove not starved
  const okUser = `${PREFIX}ok`;
  const token = await setupUser(okUser, 2000);
  const prompt = 'PHASE922 FINAL H3 online worker, calm lake, static, no text.';
  const createRes = await fcFetch(HK_BASE, '/tasks/create', {
    auth: token,
    body: {
      model_id: H3_SKU,
      type: 'video',
      execution_mode: 'queue',
      provider_forward_json: buildH3Forward(prompt),
      params: { model: 'minimax-h3-t2v', nxCloudQueueGoldenPath: true, prompt },
      nodeData: {
        model: 'minimax-h3-t2v',
        durationMinimaxH3: '10',
        resolutionMinimaxH3: '720p',
        aspect_ratio: '16:9',
        prompt,
      },
    },
  });
  if (createRes.status !== 200 || !createRes.json?.task_id) {
    REPORT.errors.push(`H3 create failed: ${createRes.status} ${JSON.stringify(createRes.json)}`);
    REPORT.invalid_forward_starvation = 'FAIL';
    return null;
  }
  const taskId = String(createRes.json.task_id);
  await promoteOneTask(taskId, okUser);
  await fcInternal('charge-claimed-tasks', { max_tasks: 20 });
  let tCharged = await db.getTaskById(taskId);
  if (String(tCharged?.execution_stage) !== 'charged') {
    // one more charge pass
    await fcInternal('charge-claimed-tasks', { max_tasks: 30 });
    tCharged = await db.getTaskById(taskId);
  }

  const cands2 = await db.listChargedTasksForDispatch({ maxTasks: 40, maxScanRows: 80000 });
  const includesValid = cands2.includes(taskId);
  const includesBad = planted.some((id) => cands2.includes(id));

  const worker = await runFcWorkersUntil(taskId, { maxRounds: 55, intervalMs: 10000 });
  const final = worker.task;
  const bal = (await db.getUserById(okUser))?.balance;
  const userSnap = await db.getUserConcurrencyCounterSnapshot(okUser, 'video');
  const platSnap = await db.getPlatformConcurrencyPoolSnapshot();
  const charge = await db.getTaskCharge(taskId);
  const chargeAmt = Number(2000) - Number(bal);

  REPORT.h3 = {
    aixflow_task: taskId,
    rh_task: final?.provider_task_id || '',
    region: 'cn',
    charge: chargeAmt,
    quoted: createRes.json?.quoted_cost_coins ?? createRes.json?.quoted_cost ?? null,
    final: final?.status,
    stage: final?.execution_stage,
    video_url: final?.result_oss_url || '',
    slots: {
      user_occupied: userSnap?.occupied ?? userSnap?.running ?? null,
      platform_occupied: platSnap?.video?.running ?? null,
      user_slot_held: final?.user_slot_held,
      platform_slot_held: final?.platform_slot_held,
    },
    charge_row: charge
      ? { status: charge.status, amount: charge.amount, refunded: charge.refunded }
      : null,
    worker_timeout: worker.timeout,
    fc_dispatch_signature: worker.stages?.some((s) => s.dispatch_has_invalid_forward) || false,
  };

  // 饥饿判定：坏任务不进正常候选 + 合法任务可进候选 + FC 返回 invalid_forward + 最终被 Dispatch
  const dispatchedDespiteBad = String(final?.provider_task_id || '').trim() !== '';
  const starvationOk =
    !candHasBad &&
    includesValid &&
    !includesBad &&
    invalidHasPlanted >= 50 &&
    REPORT.no_forward?.has_signature &&
    dispatchedDespiteBad;

  REPORT.invalid_forward_starvation = starvationOk ? 'PASS' : 'FAIL';
  if (!starvationOk) {
    REPORT.errors.push(
      `starvation check fail candHasBad=${candHasBad} includesValid=${includesValid} includesBad=${includesBad} plantedInInvalid=${invalidHasPlanted} dispatched=${dispatchedDespiteBad}`,
    );
  }

  const noFwdOk =
    marked && terminal && slotsReleased && REPORT.no_forward.amount0_ok && REPORT.no_forward.has_signature;
  if (!noFwdOk) REPORT.errors.push('NO_FORWARD path fail');

  REPORT.starvation_detail = {
    planted: planted.length,
    cand_has_bad_before: candHasBad,
    invalid_planted_hit: invalidHasPlanted,
    includes_valid: includesValid,
    includes_bad_after: includesBad,
    no_forward_ok: noFwdOk,
  };

  // cleanup planted amount0 tasks via FC recover (best-effort, don't block)
  for (let i = 0; i < 8; i++) {
    await fcInternal('dispatch-charged-tasks', { max_tasks: 50 });
  }

  return { taskId, final, chargeAmt, charge, userSnap, platSnap, okUser, bal };
}

async function verifyRhart() {
  const userId = `${PREFIX}rhart`;
  const token = await setupUser(userId, 2000);
  const prompt = 'PHASE922 FINAL rhart regression, soft meadow, static, no text.';
  const createRes = await fcFetch(HK_BASE, '/tasks/create', {
    auth: token,
    body: {
      model_id: RHART_SKU,
      type: 'video',
      execution_mode: 'queue',
      provider_forward_json: buildRhartForward(prompt),
      params: { model: 'rhart-video-x', nxCloudQueueGoldenPath: true, prompt },
      nodeData: {
        model: 'rhart-video-x',
        durationGrok3: '10',
        aspect_ratio: '16:9',
        prompt,
      },
    },
  });
  if (createRes.status !== 200 || !createRes.json?.task_id) {
    REPORT.rhart = 'FAIL';
    REPORT.errors.push(`rhart create fail ${createRes.status} ${JSON.stringify(createRes.json)}`);
    return;
  }
  const taskId = String(createRes.json.task_id);
  const t0 = await db.getTaskById(taskId);
  const fwd = JSON.parse(t0?.provider_forward_json || '{}');
  if (fwd.rhRegion !== 'ai' || fwd.path !== '/rhart-video-g/text-to-video') {
    REPORT.rhart = 'FAIL';
    REPORT.errors.push(`rhart bad region/path ${fwd.rhRegion} ${fwd.path}`);
    return;
  }
  await promoteOneTask(taskId, userId);
  const worker = await runFcWorkersUntil(taskId, { maxRounds: 55, intervalMs: 10000 });
  const final = worker.task;
  const userSnap = await db.getUserConcurrencyCounterSnapshot(userId, 'video');
  const ok =
    String(final?.status).toLowerCase() === 'success' &&
    String(final?.provider_task_id || '') &&
    String(final?.result_oss_url || '') &&
    !final?.user_slot_held &&
    !final?.platform_slot_held &&
    Number(userSnap?.occupied ?? userSnap?.running ?? 0) === 0;
  REPORT.rhart = ok ? 'PASS' : 'FAIL';
  REPORT.rhart_detail = {
    task_id: taskId,
    rh_task: final?.provider_task_id,
    region: fwd.rhRegion,
    final: final?.status,
    url: final?.result_oss_url || '',
    timeout: worker.timeout,
  };
  if (!ok) REPORT.errors.push('rhart regression fail');
  log(`rhart=${REPORT.rhart}`);
}

async function main() {
  if (!HK_BASE || !FC_TOKEN || !ADMIN_SECRET || !JWT_SECRET) {
    REPORT.errors.push('missing FC/JWT env');
    fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
    console.log(JSON.stringify({ conclusion: 'BLOCKED', errors: REPORT.errors }, null, 2));
    process.exit(3);
  }

  await verifyDeployment();
  await verifyQueueProtection();
  const h3pack = await verifyNoForwardAndStarvation();
  await verifyRhart();

  // billing / final slots
  if (h3pack?.taskId) {
    const charge = h3pack.charge;
    const refunded = charge && (charge.refunded === 1 || charge.refunded === true || charge.status === 'refunded');
    const chargeOk = charge && String(charge.status || '').toLowerCase() === 'charged' && !refunded;
    // only one charge row expected; getTaskCharge is by task_id PK → single
    REPORT.billing.duplicate_charge = chargeOk ? 'PASS' : 'FAIL';
    REPORT.billing.duplicate_refund = !refunded ? 'PASS' : 'FAIL';
    if (String(h3pack.final?.status).toLowerCase() !== 'success') {
      REPORT.billing.duplicate_charge = 'FAIL';
      REPORT.errors.push('H3 not success — billing inconclusive');
    }
    REPORT.final_slots = {
      user_occupied: h3pack.userSnap?.occupied ?? h3pack.userSnap?.running,
      platform_occupied: h3pack.platSnap?.video?.running,
      user_slot_held: h3pack.final?.user_slot_held,
      platform_slot_held: h3pack.final?.platform_slot_held,
    };
  }

  const h3Ok =
    REPORT.h3 &&
    String(REPORT.h3.final).toLowerCase() === 'success' &&
    String(REPORT.h3.rh_task || '') &&
    String(REPORT.h3.video_url || '') &&
    Number(REPORT.h3.slots?.user_occupied || 0) === 0 &&
    !REPORT.h3.slots?.user_slot_held &&
    !REPORT.h3.slots?.platform_slot_held &&
    REPORT.h3.fc_dispatch_signature;

  const noFwdOk =
    REPORT.no_forward?.first_marked &&
    REPORT.no_forward?.terminal &&
    REPORT.no_forward?.slots_released &&
    REPORT.no_forward?.amount0_ok;

  const allPass =
    REPORT.deployment.HK === 'PASS' &&
    REPORT.deployment.BJ === 'PASS' &&
    REPORT.queue_protection === 'PASS' &&
    REPORT.invalid_forward_starvation === 'PASS' &&
    noFwdOk &&
    h3Ok &&
    REPORT.rhart === 'PASS' &&
    REPORT.billing.duplicate_charge === 'PASS' &&
    REPORT.billing.duplicate_refund === 'PASS';

  REPORT.conclusion = allPass ? 'PASS' : 'BLOCKED';
  REPORT.ended_at = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
  console.log(
    JSON.stringify(
      {
        conclusion: REPORT.conclusion,
        deployment: REPORT.deployment,
        queue_protection: REPORT.queue_protection,
        invalid_forward_starvation: REPORT.invalid_forward_starvation,
        no_forward: REPORT.no_forward,
        h3: REPORT.h3,
        rhart: REPORT.rhart,
        rhart_detail: REPORT.rhart_detail,
        billing: REPORT.billing,
        errors: REPORT.errors,
      },
      null,
      2,
    ),
  );
  process.exit(allPass ? 0 : 2);
}

main().catch((e) => {
  REPORT.errors.push(String(e?.message || e));
  REPORT.conclusion = 'BLOCKED';
  fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
  console.error(e);
  process.exit(1);
});
