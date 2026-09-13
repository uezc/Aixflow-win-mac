/**
 * Phase 8.1 Live E2E — Canvas rhart-video-x T2V Golden Path
 * 真实 HK FC HTTP + 真实 OTS + FC Worker 调度真实 RunningHub（非 mock 全链路）
 *
 * node scripts/live-phase8-1-video-golden-path.mjs
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '../../');

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

const PREFIX = `__p81live_${Date.now().toString(36)}_`;
const FC_BASE = (process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '').replace(/\/$/, '');
const FC_TOKEN = process.env.ALIYUN_FC_TOKEN || '';
const ADMIN_SECRET = process.env.ADMIN_SETTLE_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || '';

const REPORT = {
  started_at: new Date().toISOString(),
  prefix: PREFIX,
  fc_endpoint: FC_BASE,
  deployment: {},
  golden_e2e: null,
  matrix: [],
  idempotency: {},
  risks: [],
  regressions: {},
  conclusion: 'NOT_READY',
  errors: [],
};

function log(msg) {
  console.log(`[p81-live] ${msg}`);
}

function record(scenario, expected, actual, pass, note = '') {
  REPORT.matrix.push({ scenario, expected, actual, pass, note });
  console.log(pass ? `[PASS] ${scenario}` : `[FAIL] ${scenario}`, { expected, actual, note });
}

function assert(cond, msg) {
  if (!cond) {
    REPORT.errors.push(msg);
    throw new Error(msg);
  }
}

function signAccessToken(userId, tokenVersion = 0) {
  return jwt.sign({ sub: userId, typ: 'access', tv: tokenVersion }, JWT_SECRET, { expiresIn: '7d' });
}

async function fcFetch(pathSuffix, { method = 'POST', body = {}, auth = null, timeoutMs = 180_000 } = {}) {
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
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 800) };
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

async function fcInternal(name, body = {}) {
  return fcFetch(`/internal/${name}`, { body });
}

async function fcTasksCreate(token, prompt = 'Phase 8.1 live golden path test') {
  const forward = {
    provider: 'runninghub',
    path: '/rhart-video-g/text-to-video',
    method: 'POST',
    body: { prompt, aspectRatio: '16:9', resolution: '720p', duration: 10 },
    billingModelId: 'rhart-video-x-720p-10s',
    rhRegion: 'ai',
  };
  return fcFetch('/tasks/create', {
    body: {
      model_id: 'rhart-video-x-720p-10s',
      type: 'video',
      execution_mode: 'queue',
      provider_forward_json: forward,
      params: {
        nodeId: 'live-e2e',
        taskKind: 'video',
        model: 'rhart-video-x',
        prompt,
        nxCloudQueueGoldenPath: true,
      },
      nodeData: {
        model: 'rhart-video-x',
        aspect_ratio: '16:9',
        durationGrok3: '10',
        duration: '10',
        prompt,
      },
    },
    auth: token,
  });
}

async function fcTasksStatus(token, taskId) {
  return fcFetch('/tasks/status', {
    body: { task_id: taskId },
    auth: token,
  });
}

const db = await import('../lib/db-tablestore.mjs');
const { handleTasksCreate } = await import('../lib/handleTasksCreate.mjs');
const {
  dispatchOneChargedTask,
  pollOneProviderTask,
  settleOneTask,
} = await import('../lib/providerPipeline.mjs');
const { tryClaimOneQueuedTask } = await import('../lib/queueScheduler.mjs');
const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');

async function setBalance(userId, balance) {
  const u = await db.getUserById(userId);
  if (!u) {
    try {
      await db.createUserOtpOnly({ userId, email: `${userId}@p81live.local` });
    } catch (_) {}
  }
  const fresh = await db.getUserById(userId);
  const cur = fresh?.balance ?? 0;
  const delta = balance - cur;
  if (delta === 0) return;
  const adjustOp = `adj_${crypto.randomUUID()}`;
  if (delta > 0) {
    await db.atomicCreditWithReceipt(userId, `ref_adj_${adjustOp}`, delta);
  } else {
    const r = await db.atomicDebitWithReceipt(userId, `chg_adj_${adjustOp}`, -delta);
    if (!r.ok) throw new Error('setBalance debit failed');
  }
}

async function setupUser(userId, { balance = 1000, videoConcurrency = 5 } = {}) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p81live.local` });
  } catch (_) {}
  await db.updateUserConcurrencyEntitlement(userId, {
    planId: 'enterprise',
    videoConcurrencyOverride: videoConcurrency,
    concurrencyOverrideExpiresAt: Date.now() + 86400000 * 7,
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
      if (which === 'user') await db.updateSlotReservation(reservationId, { user_slot_held: 1 });
      else await db.updateSlotReservation(reservationId, { platform_slot_held: 1 });
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

async function runFcWorkersUntil(taskId, { maxRounds = 40, intervalMs = 15000 } = {}) {
  const stages = [];
  for (let i = 0; i < maxRounds; i++) {
    await fcInternal('charge-claimed-tasks', { max_tasks: 10 });
    await fcInternal('dispatch-charged-tasks', { max_tasks: 10 });
    await fcInternal('poll-provider-tasks', { max_tasks: 20 });
    const t = await db.getTaskById(taskId);
    stages.push({
      round: i,
      status: t?.status,
      stage: t?.execution_stage,
      pid: t?.provider_task_id,
      unknown: t?.dispatch_unknown,
    });
    const st = String(t?.status || '').toLowerCase();
    if (st === 'success' || st === 'failed' || st === 'cancelled') return { task: t, stages };
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { task: await db.getTaskById(taskId), stages, timeout: true };
}

async function snapshotConcurrency(userId) {
  const userSnap = await db.getUserConcurrencyCounterSnapshot(userId, 'video');
  const platSnap = await db.getPlatformConcurrencyPoolSnapshot();
  return {
    user_occupied: userSnap?.occupied ?? -1,
    platform_video_running: platSnap?.video?.running ?? -1,
  };
}

async function probeDeployment() {
  log('Probing FC deployment...');
  REPORT.deployment.fc_endpoint = FC_BASE;
  REPORT.deployment.video_queue_enabled_local = process.env.VIDEO_QUEUE_ENABLED || '(unset)';
  REPORT.deployment.vite_video_queue_enabled_local = process.env.VITE_VIDEO_QUEUE_ENABLED || '(unset)';

  const promote = await fcInternal('promote-queued-tasks', { max_claims: 0 });
  const charge = await fcInternal('charge-claimed-tasks', { max_tasks: 0 });
  const dispatch = await fcInternal('dispatch-charged-tasks', { max_tasks: 0 });
  const poll = await fcInternal('poll-provider-tasks', { max_tasks: 0 });

  REPORT.deployment.internal_endpoints = {
    promote: promote.status,
    charge: charge.status,
    dispatch: dispatch.status,
    poll: poll.status,
  };

  const ok =
    promote.status === 200 &&
    charge.status === 200 &&
    dispatch.status === 200 &&
    poll.status === 200;
  record(
    'deployment_fc_phase5_7_workers',
    'HTTP 200 on internal workers',
    REPORT.deployment.internal_endpoints,
    ok,
  );
  return ok;
}

async function main() {
  assert(FC_BASE, 'HK_FC_ENDPOINT missing');
  assert(FC_TOKEN, 'ALIYUN_FC_TOKEN missing');
  assert(ADMIN_SECRET, 'ADMIN_SETTLE_SECRET missing');
  assert(JWT_SECRET, 'JWT_SECRET missing');
  assert(process.env.OTS_ENDPOINT, 'OTS_ENDPOINT missing');

  await probeDeployment();

  // —— 1. Real full path via FC HTTP create + FC workers + real RH ——
  const userOk = `${PREFIX}ok`;
  const tokenOk = await setupUser(userOk, { balance: 2000 });
  const createRes = await fcTasksCreate(tokenOk, 'A calm lake at sunrise, soft mist, cinematic 16:9');
  assert(createRes.status === 200, `tasks/create failed: ${createRes.status} ${JSON.stringify(createRes.json)}`);
  const taskId = String(createRes.json.task_id || '');
  assert(taskId, 'no task_id from FC create');

  const tCreate = await db.getTaskById(taskId);
  record(
    'create_queued_with_forward',
    'queued + provider_forward_json',
    { status: tCreate?.status, has_forward: Boolean(tCreate?.provider_forward_json) },
    tCreate?.status === 'queued' && String(tCreate?.provider_forward_json || '').includes('text-to-video'),
  );

  await promoteOneTask(taskId, userOk);
  const tClaimed = await db.getTaskById(taskId);
  record('claim_after_promote', 'claimed', tClaimed?.status, tClaimed?.status === 'claimed');

  const snapAfterClaim = await snapshotConcurrency(userOk);
  log(`after claim: user_occ=${snapAfterClaim.user_occupied} plat=${snapAfterClaim.platform_video_running}`);

  const workerResult = await runFcWorkersUntil(taskId, { maxRounds: 48, intervalMs: 12000 });
  const tFinal = workerResult.task;
  const balAfter = (await db.getUserById(userOk))?.balance;

  REPORT.golden_e2e = {
    aixflow_task_id: taskId,
    runninghub_provider_task_id: tFinal?.provider_task_id || '',
    final_status: tFinal?.status,
    execution_stage: tFinal?.execution_stage,
    result_url: tFinal?.result_oss_url || '',
    dispatch_unknown: tFinal?.dispatch_unknown,
    balance_after: balAfter,
    worker_stages_tail: workerResult.stages?.slice(-5),
    worker_timeout: workerResult.timeout || false,
    charge_at: 'Phase6 after claim (FC charge-claimed-tasks)',
    slot_acquire_at: 'Phase5 claim (user+platform CAS)',
    slot_release_at: 'Phase7 settle success',
    mapping_at: 'atomicSetProviderTaskId after RH submit (OTS provider_task_id SoT)',
  };

  const fullOk =
    String(tFinal?.status).toLowerCase() === 'success' &&
    String(tFinal?.provider_task_id || '').trim() &&
    String(tFinal?.result_oss_url || '').trim() &&
    !tFinal?.user_slot_held &&
    !tFinal?.platform_slot_held;

  record(
    'single_task_real_rh_full_path',
    'success + provider_task_id + result_oss_url + slots released',
  {
      status: tFinal?.status,
      pid: tFinal?.provider_task_id,
      url: (tFinal?.result_oss_url || '').slice(0, 80),
      slots: { u: tFinal?.user_slot_held, p: tFinal?.platform_slot_held },
    },
    fullOk,
    workerResult.timeout ? 'worker poll timeout' : '',
  );

  // —— 2. Insufficient balance ——
  const userPoor = `${PREFIX}poor`;
  const tokenPoor = await setupUser(userPoor, { balance: 0 });
  const poorCreate = await fcTasksCreate(tokenPoor, 'poor balance test');
  const poorId = String(poorCreate.json?.task_id || '');
  await promoteOneTask(poorId, userPoor);
  const rhBeforePoor = 0;
  await fcInternal('charge-claimed-tasks', { max_tasks: 5 });
  await fcInternal('dispatch-charged-tasks', { max_tasks: 5 });
  const tPoor = await db.getTaskById(poorId);
  const poorBal = (await db.getUserById(userPoor))?.balance ?? 0;
  const poorSnap = await snapshotConcurrency(userPoor);
  record(
    'insufficient_balance',
    'failed, no RH pid, balance 0, slots released',
    {
      status: tPoor?.status,
      pid: tPoor?.provider_task_id,
      balance: poorBal,
      snap: poorSnap,
    },
    tPoor?.status === 'failed' && !tPoor?.provider_task_id && poorBal === 0 && poorSnap.user_occupied === 0,
  );

  // —— 3. Concurrency 5/6 ——
  const userConc = `${PREFIX}conc`;
  const tokenConc = await setupUser(userConc, { balance: 5000, videoConcurrency: 5 });
  const concIds = [];
  for (let i = 0; i < 6; i++) {
    const cr = await fcTasksCreate(tokenConc, `conc test ${i}`);
    concIds.push(String(cr.json?.task_id || ''));
  }
  let claimedN = 0;
  for (const id of concIds) {
    const t = await promoteOneTask(id, userConc);
    if (t?.status === 'claimed') claimedN += 1;
  }
  const t6 = await db.getTaskById(concIds[5]);
  const concSnap = await snapshotConcurrency(userConc);
  record(
    'concurrency_5_of_6',
    '5 claimed, 6th queued, user_occ=5',
    { claimed: claimedN, sixth: t6?.status, snap: concSnap },
    claimedN === 5 && t6?.status === 'queued' && concSnap.user_occupied === 5,
  );

  // Release one claimed slot and promote 6th
  if (concIds[0]) {
    const t0 = await db.getTaskById(concIds[0]);
    if (t0?.user_slot_held || t0?.platform_slot_held) {
      try {
        await db.releaseUserConcurrencySlot(userConc, 'video');
        await db.releasePlatformConcurrencySlot('video');
      } catch (_) {}
      await db.upsertTask(concIds[0], userConc, {
        status: 'failed',
        user_slot_held: '0',
        platform_slot_held: '0',
      });
    }
    await promoteOneTask(concIds[5], userConc);
    const t6After = await db.getTaskById(concIds[5]);
    record(
      'concurrency_6th_after_release',
      '6th becomes claimed',
      t6After?.status,
      t6After?.status === 'claimed',
    );
  }

  // —— 4. Dispatch storm (code path + RH submit count via local intercept) ——
  const userStorm = `${PREFIX}storm`;
  const tokenStorm = await setupUser(userStorm, { balance: 2000 });
  const stormId = String((await fcTasksCreate(tokenStorm, 'storm')).json?.task_id || '');
  await promoteOneTask(stormId, userStorm);
  await chargeClaimedTask(stormId, db);
  let rhSubmits = 0;
  const rhMockCounting = async () => {
    rhSubmits += 1;
    return { ok: true, provider_task_id: `rh_storm_${PREFIX}`, data: {} };
  };
  await Promise.all(
    Array.from({ length: 10 }, () =>
      dispatchOneChargedTask(stormId, db, { submitRunningHub: rhMockCounting }),
    ),
  );
  const tStorm = await db.getTaskById(stormId);
  record(
    'dispatch_storm_10_workers',
    'RH submit=1 (dispatch idempotency)',
    { submits: rhSubmits, pid: tStorm?.provider_task_id },
    rhSubmits === 1,
    'local dispatch with counting mock to prove CAS/SoT; full path uses real RH on FC',
  );

  REPORT.idempotency.dispatch =
    'provider_task_id empty → tryAcquireDispatchLease → RH submit → atomicSetProviderTaskId (CAS empty only) → subsequent dispatch returns ALREADY_HAS_PROVIDER_TASK_ID; dispatch_unknown=1 → DISPATCH_UNKNOWN_NO_RETRY';

  // —— 5. Timeout unknown (simulated submit uncertain — not counted as mock E2E pass) ——
  const userTimeout = `${PREFIX}timeout`;
  const tokenTimeout = await setupUser(userTimeout, { balance: 2000 });
  const timeoutId = String((await fcTasksCreate(tokenTimeout, 'timeout test')).json?.task_id || '');
  await promoteOneTask(timeoutId, userTimeout);
  await chargeClaimedTask(timeoutId, db);
  const beforeTimeoutRh = rhSubmits;
  await dispatchOneChargedTask(timeoutId, db, {
    submitRunningHub: async () => ({ ok: false, uncertain: true, reason: 'SUBMIT_TIMEOUT' }),
  });
  await dispatchOneChargedTask(timeoutId, db, {
    submitRunningHub: async () => ({ ok: true, provider_task_id: 'rh_should_not', data: {} }),
  });
  const tTimeout = await db.getTaskById(timeoutId);
  const timeoutRhDelta = rhSubmits - beforeTimeoutRh;
  record(
    'timeout_dispatch_unknown',
    'dispatch_unknown=1, no retry submit, slots held',
    {
      unknown: tTimeout?.dispatch_unknown,
      pid: tTimeout?.provider_task_id,
      held: { u: tTimeout?.user_slot_held, p: tTimeout?.platform_slot_held },
      extra_submits: timeoutRhDelta,
    },
    String(tTimeout?.dispatch_unknown) === '1' &&
      !tTimeout?.provider_task_id &&
      timeoutRhDelta === 0 &&
      (tTimeout?.user_slot_held || tTimeout?.platform_slot_held),
    'simulated uncertain submit — documents Phase7 frozen policy',
  );

  REPORT.risks.push({
    scenario: 'Provider created but provider_task_id lost',
    behavior:
      'submit.uncertain → dispatch_unknown=1; dispatchOneChargedTask returns DISPATCH_UNKNOWN_NO_RETRY; no refund, no release until reconciliation',
    reconciliation:
      'No automated RH reconciliation cron verified in this E2E; manual ops required — Phase 8.1 known limitation',
  });

  // —— 6. Provider failure + refund idempotent (local poll FAILED + settle) ——
  const userFail = `${PREFIX}fail`;
  const tokenFail = await setupUser(userFail, { balance: 2000 });
  const failId = String((await fcTasksCreate(tokenFail, 'fail refund test')).json?.task_id || '');
  await promoteOneTask(failId, userFail);
  await chargeClaimedTask(failId, db);
  const balAfterChargeFail = (await db.getUserById(userFail))?.balance;
  await dispatchOneChargedTask(failId, db, {
    submitRunningHub: async () => ({ ok: true, provider_task_id: `rh_fail_${PREFIX}`, data: {} }),
  });
  await pollOneProviderTask(failId, db, {
    queryRunningHub: async () => ({ ok: true, status: 'FAILED' }),
  });
  await settleOneTask(failId, db, { outcome: 'failed', refund: true });
  const balAfterFail = (await db.getUserById(userFail))?.balance;
  const tFail = await db.getTaskById(failId);
  const failSnap = await snapshotConcurrency(userFail);
  const r2 = await settleOneTask(failId, db, { outcome: 'failed', refund: true });
  record(
    'provider_failure_refund_idempotent',
    'failed, refund once, slots released',
    {
      status: tFail?.status,
      bal: { after_charge: balAfterChargeFail, after_refund: balAfterFail },
      snap: failSnap,
      settle2: r2,
    },
    tFail?.status === 'failed' &&
      Number(balAfterFail) > Number(balAfterChargeFail) &&
      failSnap.user_occupied === 0 &&
      r2?.idempotent === true,
    'poll FAILED simulated; refund idempotency via Phase6 ref_*',
  );

  REPORT.idempotency.charge = 'operation_id chg_{task_id} + ledger SoT; repeat chargeClaimedTask → PHASE6_CHARGE_IDEMPOTENT';
  REPORT.idempotency.refund = 'ref_{task_id} ledger idempotency; settleOneTask repeat → idempotent';
  REPORT.idempotency.release = 'releaseUser/Platform CAS; upsert user_slot_held=0 only after terminal settle or charge fail';

  const criticalPass =
    fullOk &&
    REPORT.matrix.filter((m) =>
      [
        'deployment_fc_phase5_7_workers',
        'create_queued_with_forward',
        'single_task_real_rh_full_path',
        'insufficient_balance',
        'concurrency_5_of_6',
        'dispatch_storm_10_workers',
        'timeout_dispatch_unknown',
        'provider_failure_refund_idempotent',
      ].includes(m.scenario),
    ).every((m) => m.pass);

  REPORT.conclusion = criticalPass ? 'READY_FOR_PHASE_8_2' : 'NOT_READY';
  REPORT.finished_at = new Date().toISOString();

  const outJson = path.resolve(__dirname, 'phase8-1-video-golden-live-e2e-result.json');
  fs.writeFileSync(outJson, JSON.stringify(REPORT, null, 2));
  log(`Report JSON: ${outJson}`);
  log(`CONCLUSION: ${REPORT.conclusion}`);

  if (!criticalPass) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  REPORT.errors.push(String(e?.message || e));
  REPORT.conclusion = 'NOT_READY';
  const outJson = path.resolve(__dirname, 'phase8-1-video-golden-live-e2e-result.json');
  fs.writeFileSync(outJson, JSON.stringify(REPORT, null, 2));
  process.exit(1);
});
