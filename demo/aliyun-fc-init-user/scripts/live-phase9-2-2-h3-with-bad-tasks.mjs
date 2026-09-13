/**
 * Phase 9.2.2 Live E2E：坏任务仍在池中时，H3 仍能被候选选中并完成 .cn 全链路
 * node scripts/live-phase9-2-2-h3-with-bad-tasks.mjs
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
const PREFIX = `__p922live_${Date.now().toString(36)}_`;
const FC_BASE = (process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '').replace(/\/$/, '');
const FC_TOKEN = process.env.ALIYUN_FC_TOKEN || '';
const ADMIN_SECRET = process.env.ADMIN_SETTLE_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || '';
const H3_PATH = '/run/ai-app/2085682347676102657';
const H3_SKU = 'minimax-h3-t2v-720p-10s';

const REPORT = { started_at: new Date().toISOString(), conclusion: 'BLOCKED', errors: [] };

function signAccessToken(userId, tv = 0) {
  return jwt.sign({ sub: userId, typ: 'access', tv }, JWT_SECRET, { expiresIn: '7d' });
}

async function fcFetch(pathSuffix, { body = {}, auth = null } = {}) {
  const res = await fetch(`${FC_BASE}${pathSuffix}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-nexflow-token': FC_TOKEN,
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      ...(ADMIN_SECRET ? { 'x-admin-settle-secret': ADMIN_SECRET } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: res.status, json };
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
}

const db = await import('../lib/db-tablestore.mjs');
const { promoteQueuedTasks } = await import('../lib/queueScheduler.mjs');
const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
const { dispatchOneChargedTask, pollOneProviderTask } = await import('../lib/providerPipeline.mjs');

async function setBalance(userId, balance) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p922.local` });
  } catch (_) {}
  const cur = (await db.getUserById(userId))?.balance ?? 0;
  const delta = balance - cur;
  if (delta === 0) return;
  const op = crypto.randomUUID();
  if (delta > 0) await db.atomicCreditWithReceipt(userId, `ref_${op}`, delta);
  else await db.atomicDebitWithReceipt(userId, `chg_${op}`, -delta);
}

async function promoteOne(taskId, userId) {
  const t = await db.getTaskById(taskId);
  if (!t || t.status !== 'queued') return t;
  const nowMs = Date.now();
  const deps = {
    nowMs,
    resolveUserLimit: async (uid, taskType) => {
      const u = await db.getUserById(uid);
      const { resolveEffectiveConcurrency } = await import('../lib/userConcurrencyEntitlement.mjs');
      const r = resolveEffectiveConcurrency(u || {}, nowMs);
      return taskType === 'image' ? r.imageConcurrencyLimit : r.videoConcurrencyLimit;
    },
    createReservation: (row) => db.putSlotReservation(row),
    markReservationHeld: async (reservationId, which) => {
      await db.updateSlotReservation(reservationId, which === 'user' ? { user_slot_held: 1 } : { platform_slot_held: 1 });
    },
    markReservationState: async (reservationId, state, extra = {}) => {
      await db.updateSlotReservation(reservationId, { state, ...extra });
    },
    tryAcquireUser: (uid, taskType, limit) => db.tryAcquireUserConcurrencySlot(uid, taskType, limit),
    releaseUser: (uid, taskType) => db.releaseUserConcurrencySlot(uid, taskType),
    tryAcquirePlatform: (taskType) => db.tryAcquirePlatformConcurrencySlot(taskType),
    releasePlatform: (taskType) => db.releasePlatformConcurrencySlot(taskType),
    atomicClaimQueuedTask: (args) => db.atomicClaimQueuedTask(args),
    atomicUnclaimExpiredTask: (args) => db.atomicUnclaimExpiredTask(args),
    getTaskById: (id) => db.getTaskById(id),
  };
  await promoteQueuedTasks(
    [{ taskId, userId, taskType: 'video', queueEnteredAt: Number(t.queue_entered_at || Date.now()) }],
    deps,
    { maxClaims: 1 },
  );
  return db.getTaskById(taskId);
}

async function main() {
  await loadRhKeysFromFcEnv();
  const userId = `${PREFIX}ok`;
  await setBalance(userId, 2000);
  await db.updateUserConcurrencyEntitlement(userId, {
    planId: 'enterprise',
    videoConcurrencyOverride: 5,
    concurrencyOverrideExpiresAt: Date.now() + 7 * 86400000,
  });
  const u = await db.getUserById(userId);
  const token = signAccessToken(userId, u?.tokenVersion ?? 0);

  // 确保坏任务存在（饥饿场景）：种 15 个无 forward 的 claimed+charged
  const plantedBad = [];
  for (let i = 0; i < 15; i++) {
    const tid = `0bad${crypto.randomUUID().slice(4)}`;
    await db.upsertTask(tid, userId, {
      status: 'claimed',
      execution_stage: 'charged',
      task_type: 'video',
      model_id: 'p5-live-video',
      quoted_cost: 0,
      provider_forward_json: '',
      user_slot_held: '0',
      platform_slot_held: '0',
    });
    plantedBad.push(tid);
  }
  REPORT.planted_bad = plantedBad.length;

  // 统计坏任务仍在
  const invalidBefore = await db.listInvalidForwardChargedTasks({ maxTasks: 50, maxScanRows: 20000 });
  REPORT.invalid_before = invalidBefore.length;

  const prompt = 'MiniMax H3 9.2.2 live with bad tasks present, simple static scene.';
  const forward = {
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

  const createRes = await fcFetch('/tasks/create', {
    auth: token,
    body: {
      model_id: H3_SKU,
      type: 'video',
      execution_mode: 'queue',
      provider_forward_json: forward,
      params: { model: 'minimax-h3-t2v', nxCloudQueueGoldenPath: true, prompt },
      nodeData: {
        model: 'minimax-h3-t2v',
        durationMinimaxH3: '10',
        resolutionMinimaxH3: '720p',
        aspect_ratio: '16:9',
      },
    },
  });
  REPORT.create = { http: createRes.status, ...(createRes.json || {}) };
  if (createRes.status !== 200 || !createRes.json?.task_id) {
    REPORT.errors.push('create failed');
    fs.writeFileSync(path.join(__dirname, 'phase9-2-2-live-e2e-result.json'), JSON.stringify(REPORT, null, 2));
    process.exit(2);
  }
  const taskId = String(createRes.json.task_id);
  await promoteOne(taskId, userId);
  await chargeClaimedTask(taskId, db);

  const candidates = await db.listChargedTasksForDispatch({ maxTasks: 20, maxScanRows: 50000 });
  REPORT.candidate_includes_h3 = candidates.includes(taskId);
  REPORT.candidate_count = candidates.length;
  if (!candidates.includes(taskId)) {
    REPORT.errors.push('H3 not in dispatch candidates despite valid forward');
    fs.writeFileSync(path.join(__dirname, 'phase9-2-2-live-e2e-result.json'), JSON.stringify(REPORT, null, 2));
    process.exit(3);
  }

  const d = await dispatchOneChargedTask(taskId, db);
  REPORT.dispatch = d;
  if (!d.ok) {
    REPORT.errors.push('dispatch failed: ' + d.reason);
    fs.writeFileSync(path.join(__dirname, 'phase9-2-2-live-e2e-result.json'), JSON.stringify(REPORT, null, 2));
    process.exit(4);
  }

  const deadline = Date.now() + 20 * 60_000;
  let final = null;
  while (Date.now() < deadline) {
    await pollOneProviderTask(taskId, db);
    final = await db.getTaskById(taskId);
    console.log(`[p922-live] status=${final.status} stage=${final.execution_stage}`);
    if (['success', 'failed', 'cancelled'].includes(String(final.status).toLowerCase())) break;
    await new Promise((r) => setTimeout(r, 8000));
  }

  const bal = (await db.getUserById(userId))?.balance;
  const userSnap = await db.getUserConcurrencyCounterSnapshot(userId, 'video');
  const platSnap = await db.getPlatformConcurrencyPoolSnapshot();
  REPORT.golden_e2e = {
    aixflow_task_id: taskId,
    rh_task_id: final?.provider_task_id,
    region: 'cn',
    charge: 2000 - Number(bal),
    initial_balance: 2000,
    final_balance: bal,
    final_status: final?.status,
    video_url: final?.result_oss_url || '',
    user_occupied: userSnap?.occupied ?? userSnap?.running,
    platform_occupied: platSnap?.video?.running,
    user_slot_held: final?.user_slot_held,
    platform_slot_held: final?.platform_slot_held,
    invalid_before: REPORT.invalid_before,
    candidate_includes_h3: REPORT.candidate_includes_h3,
  };

  const ok =
    String(final?.status).toLowerCase() === 'success' &&
    String(final?.provider_task_id || '') &&
    String(final?.result_oss_url || '') &&
    !final?.user_slot_held &&
    !final?.platform_slot_held &&
    REPORT.candidate_includes_h3;

  REPORT.conclusion = ok ? 'PASS' : 'BLOCKED';
  fs.writeFileSync(path.join(__dirname, 'phase9-2-2-live-e2e-result.json'), JSON.stringify(REPORT, null, 2));
  console.log(JSON.stringify({ conclusion: REPORT.conclusion, golden_e2e: REPORT.golden_e2e }, null, 2));
  process.exit(ok ? 0 : 2);
}

main().catch((e) => {
  REPORT.errors.push(String(e?.message || e));
  fs.writeFileSync(path.join(__dirname, 'phase9-2-2-live-e2e-result.json'), JSON.stringify(REPORT, null, 2));
  console.error(e);
  process.exit(1);
});
