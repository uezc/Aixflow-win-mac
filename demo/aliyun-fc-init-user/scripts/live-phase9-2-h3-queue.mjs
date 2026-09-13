/**
 * Phase 9.2 Live E2E — minimax-h3-t2v Unified Queue（真实 FC + OTS + RH.cn）
 * node scripts/live-phase9-2-h3-queue.mjs
 *
 * 不修改价格 / schema / Queue 核心。若 MODEL_NOT_PRICED 则 BLOCKED 并停止。
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

const PREFIX = `__p92live_${Date.now().toString(36)}_`;
const FC_BASE = (process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '').replace(/\/$/, '');
const FC_TOKEN = process.env.ALIYUN_FC_TOKEN || '';
const ADMIN_SECRET = process.env.ADMIN_SETTLE_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || '';
const H3_PATH = '/run/ai-app/2085682347676102657';
const H3_SKU = 'minimax-h3-t2v-720p-10s';

const REPORT = {
  started_at: new Date().toISOString(),
  prefix: PREFIX,
  fc_endpoint: FC_BASE,
  create: null,
  golden_e2e: null,
  conclusion: 'BLOCKED',
  errors: [],
};

function log(msg) {
  console.log(`[p92-live] ${msg}`);
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

const db = await import('../lib/db-tablestore.mjs');
const { promoteQueuedTasks } = await import('../lib/queueScheduler.mjs');

async function setBalance(userId, balance) {
  const u = await db.getUserById(userId);
  if (!u) {
    try {
      await db.createUserOtpOnly({ userId, email: `${userId}@p92live.local` });
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

async function setupUser(userId, { balance = 2000, videoConcurrency = 5 } = {}) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p92live.local` });
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
  await promoteQueuedTasks(
    [
      {
        taskId,
        userId,
        taskType: 'video',
        queueEnteredAt: Number(t.queue_entered_at || t.created_at || Date.now()),
      },
    ],
    deps,
    { maxClaims: 1 },
  );
  return db.getTaskById(taskId);
}

async function loadRhKeysFromFcEnv() {
  const requireFromRoot = createRequire(path.join(ROOT, 'package.json'));
  try {
    requireFromRoot.resolve('@alicloud/fc20230330');
  } catch {
    const { execSync } = await import('child_process');
    execSync('npm install --no-save @alicloud/fc20230330@^4.2.0 @alicloud/openapi-client @alicloud/tea-util', {
      cwd: ROOT,
      stdio: 'pipe',
    });
  }
  const Fc20230330 = requireFromRoot('@alicloud/fc20230330');
  const OpenApi = requireFromRoot('@alicloud/openapi-client');
  const Util = requireFromRoot('@alicloud/tea-util');
  const config = new OpenApi.Config({
    accessKeyId: process.env.OTS_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OTS_ACCESS_KEY_SECRET || process.env.OSS_ACCESS_KEY_SECRET,
    endpoint: 'fcv3.cn-hongkong.aliyuncs.com',
  });
  const client = new Fc20230330.default(config);
  const fn = await client.getFunctionWithOptions(
    process.env.FC_FUNCTION_NAME_HK?.trim() || 'nexflow-api',
    new Fc20230330.GetFunctionRequest({}),
    {},
    new Util.RuntimeOptions({}),
  );
  const envMap = fn?.body?.environmentVariables || {};
  for (const k of Object.keys(envMap)) {
    if (k.startsWith('RUNNINGHUB_') && typeof envMap[k] === 'string' && envMap[k].trim()) {
      process.env[k] = envMap[k].trim();
    }
  }
  return {
    has_cn_key: Boolean(process.env.RUNNINGHUB_API_KEY || process.env.RUNNINGHUB_API_KEY_CN),
    has_ai_key: Boolean(process.env.RUNNINGHUB_API_KEY_AI),
  };
}

async function runTargetedPipeline(taskId) {
  const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
  const { dispatchOneChargedTask, pollOneProviderTask } = await import('../lib/providerPipeline.mjs');
  // Charge via FC first (same worker as prod); fallback local if still claimed/uncharged
  await fcInternal('charge-claimed-tasks', { max_tasks: 20 });
  let t = await db.getTaskById(taskId);
  if (t?.status === 'claimed' && String(t.execution_stage || '') !== 'charged') {
    await chargeClaimedTask(taskId, db);
  }
  // FC dispatch 扫描池有大量无 forward 的旧 charged 任务，本任务可能长期轮不到；
  // 因此对目标 task 本地 Dispatch/Poll（RH Key 已从 FC env 注入），验证真实 .cn 链路。
  const d = await dispatchOneChargedTask(taskId, db);
  log(`targeted dispatch: ${JSON.stringify(d)}`);
  const stages = [{ step: 'dispatch', ...d }];
  const deadline = Date.now() + 20 * 60_000;
  let round = 0;
  while (Date.now() < deadline) {
    round += 1;
    const p = await pollOneProviderTask(taskId, db);
    t = await db.getTaskById(taskId);
    stages.push({
      round,
      poll: p,
      status: t?.status,
      stage: t?.execution_stage,
      pid: t?.provider_task_id,
    });
    log(`poll ${round} status=${t?.status} stage=${t?.execution_stage} pid=${(t?.provider_task_id || '').slice(0, 24)}`);
    const st = String(t?.status || '').toLowerCase();
    if (['success', 'failed', 'cancelled', 'timeout'].includes(st)) {
      return { task: t, stages, timeout: false, dispatch: d };
    }
    await new Promise((r) => setTimeout(r, 8000));
  }
  return { task: await db.getTaskById(taskId), stages, timeout: true, dispatch: d };
}

async function main() {
  if (!FC_BASE || !FC_TOKEN || !ADMIN_SECRET || !JWT_SECRET) {
    REPORT.errors.push('missing FC/JWT env');
    REPORT.conclusion = 'BLOCKED';
    fs.writeFileSync(path.join(__dirname, 'phase9-2-h3-live-e2e-result.json'), JSON.stringify(REPORT, null, 2));
    console.log(JSON.stringify({ conclusion: REPORT.conclusion, errors: REPORT.errors }, null, 2));
    process.exit(3);
  }

  const userId = `${PREFIX}ok`;
  const initialBalance = 2000;
  const token = await setupUser(userId, { balance: initialBalance });
  const prompt = 'MiniMax H3 queue live e2e, simple static scene, no text.';
  const forward = buildH3Forward(prompt);

  const createRes = await fcFetch('/tasks/create', {
    auth: token,
    body: {
      model_id: H3_SKU,
      type: 'video',
      execution_mode: 'queue',
      provider_forward_json: forward,
      params: {
        nodeId: 'live-p92',
        taskKind: 'video',
        model: 'minimax-h3-t2v',
        prompt,
        nxCloudQueueGoldenPath: true,
      },
      nodeData: {
        model: 'minimax-h3-t2v',
        aspect_ratio: '16:9',
        durationMinimaxH3: '10',
        resolutionMinimaxH3: '720p',
        duration: '10',
        prompt,
      },
    },
  });

  REPORT.create = {
    http: createRes.status,
    code: createRes.json?.code || createRes.json?.error_code || null,
    error: createRes.json?.error || createRes.json?.message || null,
    task_id: createRes.json?.task_id || null,
    quoted: createRes.json?.quoted_cost_coins ?? createRes.json?.quoted_cost ?? null,
  };
  log(`create http=${createRes.status} body=${JSON.stringify(REPORT.create)}`);

  if (
    createRes.status === 403 ||
    String(createRes.json?.code || createRes.json?.error_code || '') === 'MODEL_NOT_PRICED' ||
    /MODEL_NOT_PRICED|暂未上线或定价/i.test(JSON.stringify(createRes.json || {}))
  ) {
    REPORT.errors.push('MODEL_NOT_PRICED on tasks/create — stop without changing prices');
    REPORT.conclusion = 'BLOCKED';
    fs.writeFileSync(path.join(__dirname, 'phase9-2-h3-live-e2e-result.json'), JSON.stringify(REPORT, null, 2));
    console.log(JSON.stringify({ conclusion: 'BLOCKED', reason: 'MODEL_NOT_PRICED', create: REPORT.create }, null, 2));
    process.exit(4);
  }

  if (createRes.status !== 200 || !createRes.json?.task_id) {
    REPORT.errors.push(`tasks/create failed: ${createRes.status}`);
    REPORT.conclusion = 'BLOCKED';
    fs.writeFileSync(path.join(__dirname, 'phase9-2-h3-live-e2e-result.json'), JSON.stringify(REPORT, null, 2));
    console.log(JSON.stringify({ conclusion: 'BLOCKED', create: REPORT.create }, null, 2));
    process.exit(5);
  }

  const taskId = String(createRes.json.task_id);
  const t0 = await db.getTaskById(taskId);
  const fwd = JSON.parse(t0?.provider_forward_json || '{}');
  if (fwd.rhRegion !== 'cn' || fwd.path !== H3_PATH) {
    REPORT.errors.push(`bad forward region/path: ${fwd.rhRegion} ${fwd.path}`);
    REPORT.conclusion = 'BLOCKED';
    fs.writeFileSync(path.join(__dirname, 'phase9-2-h3-live-e2e-result.json'), JSON.stringify(REPORT, null, 2));
    process.exit(6);
  }

  await promoteOneTask(taskId, userId);
  const keyInfo = await loadRhKeysFromFcEnv();
  log(`RH keys from FC env: ${JSON.stringify(keyInfo)}`);
  if (!keyInfo.has_cn_key) {
    REPORT.errors.push('FC env missing RUNNINGHUB_API_KEY for .cn');
    REPORT.conclusion = 'BLOCKED';
    fs.writeFileSync(path.join(__dirname, 'phase9-2-h3-live-e2e-result.json'), JSON.stringify(REPORT, null, 2));
    process.exit(7);
  }

  const balBeforeWorkers = (await db.getUserById(userId))?.balance;
  const worker = await runTargetedPipeline(taskId);
  const tFinal = worker.task;
  const balFinal = (await db.getUserById(userId))?.balance;
  const userSnap = await db.getUserConcurrencyCounterSnapshot(userId, 'video');
  const platSnap = await db.getPlatformConcurrencyPoolSnapshot();

  const chargeAmount = Number(initialBalance) - Number(balFinal);
  REPORT.golden_e2e = {
    aixflow_task_id: taskId,
    rh_task_id: tFinal?.provider_task_id || '',
    region: fwd.rhRegion,
    path: fwd.path,
    charge_amount: chargeAmount,
    initial_balance: initialBalance,
    balance_before_workers: balBeforeWorkers,
    final_balance: balFinal,
    quoted_on_create: REPORT.create.quoted,
    final_status: tFinal?.status,
    execution_stage: tFinal?.execution_stage,
    video_url: tFinal?.result_oss_url || '',
    user_occupied: userSnap?.occupied ?? userSnap?.running ?? null,
    platform_occupied: platSnap?.video?.running ?? null,
    user_slot_held: tFinal?.user_slot_held,
    platform_slot_held: tFinal?.platform_slot_held,
    worker_timeout: worker.timeout || false,
    dispatch: worker.dispatch || null,
    note: 'dispatch/poll targeted locally with FC RH keys; FC scan backlog of NO_FORWARD_PAYLOAD charged tasks',
    stages_tail: worker.stages?.slice(-6),
  };

  const ok =
    String(tFinal?.status).toLowerCase() === 'success' &&
    String(tFinal?.provider_task_id || '').trim() &&
    String(tFinal?.result_oss_url || '').trim() &&
    !tFinal?.user_slot_held &&
    !tFinal?.platform_slot_held &&
    Number(userSnap?.occupied ?? userSnap?.running ?? 0) === 0;

  REPORT.conclusion = ok ? 'PASS' : 'BLOCKED';
  if (!ok) REPORT.errors.push(worker.timeout ? 'worker timeout' : 'e2e not success');
  fs.writeFileSync(path.join(__dirname, 'phase9-2-h3-live-e2e-result.json'), JSON.stringify(REPORT, null, 2));
  console.log(JSON.stringify({ conclusion: REPORT.conclusion, golden_e2e: REPORT.golden_e2e }, null, 2));
  process.exit(ok ? 0 : 2);
}

main().catch((e) => {
  REPORT.errors.push(String(e?.message || e));
  REPORT.conclusion = 'BLOCKED';
  fs.writeFileSync(path.join(__dirname, 'phase9-2-h3-live-e2e-result.json'), JSON.stringify(REPORT, null, 2));
  console.error(e);
  process.exit(1);
});
