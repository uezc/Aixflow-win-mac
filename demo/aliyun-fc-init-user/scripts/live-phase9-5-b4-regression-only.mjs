/**
 * Phase 9.5-B-4-B — light regression after rhart-v3.1-pro-se
 * node scripts/live-phase9-5-b4-regression-only.mjs
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
const PREFIX = `__p95b4reg_${Date.now().toString(36)}_`;
const FC_BASE = (process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '').replace(/\/$/, '');
const FC_TOKEN = process.env.ALIYUN_FC_TOKEN || '';
const ADMIN_SECRET = process.env.ADMIN_SETTLE_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || '';
const OSS_IMAGE =
  (fs.existsSync(path.join(__dirname, 'p93d-i2v-image-url.txt'))
    ? fs.readFileSync(path.join(__dirname, 'p93d-i2v-image-url.txt'), 'utf8').trim()
    : '') ||
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p93d-i2v-test/1788607602254_b2eac80c.jpg';
const OUT = path.join(__dirname, 'phase9-5-b4-regression-only-result.json');
const MAIN = path.join(__dirname, 'phase9-5-b4-rhart-v31-pro-se-live-e2e-result.json');

function log(m) {
  console.log(`[p95b4-reg] ${m}`);
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
    await db.createUserOtpOnly({ userId, email: `${userId}@p95b4reg.local` });
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
    await db.createUserOtpOnly({ userId, email: `${userId}@p95b4reg.local` });
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
async function runFcWorkersUntil(taskId, { maxRounds = 30, intervalMs = 8000 } = {}) {
  for (let i = 0; i < maxRounds; i++) {
    try {
      await fcInternal('charge-claimed-tasks', { max_tasks: 50 });
      await fcInternal('dispatch-charged-tasks', { max_tasks: 50 });
      await fcInternal('poll-provider-tasks', { max_tasks: 50 });
    } catch (e) {
      log(`worker ${e.message}`);
    }
    const t = await db.getTaskById(taskId);
    log(`${taskId.slice(0, 8)} r${i} ${t?.status} ${t?.error_code || ''}`);
    const st = String(t?.status || '').toLowerCase();
    if (['success', 'failed', 'cancelled', 'timeout'].includes(st)) return t;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return db.getTaskById(taskId);
}

async function quick(label, model, sku, forward, regionExpect) {
  try {
    const u = `${PREFIX}${label}`;
    const tok = await setupUser(u, 2000);
    await new Promise((r) => setTimeout(r, 800));
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
      return { ok: false, verdict: 'FAIL_CREATE', err: JSON.stringify(cr.json).slice(0, 160) };
    }
    const tid = String(cr.json.task_id);
    await promoteOneTask(tid, u);
    const final = await runFcWorkersUntil(tid);
    const fwd = JSON.parse((await db.getTaskById(tid))?.provider_forward_json || '{}');
    if (String(final?.status).toLowerCase() === 'success' && fwd.rhRegion === regionExpect) {
      return { ok: true, verdict: 'PASS', pid: final.provider_task_id, region: fwd.rhRegion, task_id: tid };
    }
    if (final?.error_code === 'PROVIDER_NO_TASK_ID') {
      return { ok: false, verdict: 'BLOCKED_EXTERNAL', err: final.error_code, task_id: tid, region: fwd.rhRegion };
    }
    return { ok: false, verdict: 'FAIL', status: final?.status, err: final?.error_code, task_id: tid };
  } catch (e) {
    return { ok: false, verdict: 'FAIL', err: String(e.message || e) };
  }
}

const REPORT = { started_at: new Date().toISOString(), results: {} };

async function main() {
  if (!FC_BASE || !FC_TOKEN || !ADMIN_SECRET || !JWT_SECRET) {
    REPORT.conclusion = 'BLOCKED';
    fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
    process.exit(3);
  }

  if (fs.existsSync(MAIN)) {
    const main = JSON.parse(fs.readFileSync(MAIN, 'utf8'));
    REPORT.from_live = {
      conclusion: main.conclusion,
      duplicate_charge: main.regressions?.duplicate_charge,
      duplicate_refund: main.regressions?.duplicate_refund,
      duplicate_dispatch: main.regressions?.duplicate_dispatch,
      invalid_forward: main.regressions?.invalid_forward,
      live_fail_refund: main.live_fail_refund?.ok,
    };
  }

  REPORT.results.invalid_forward = hasValidForwardPath({
    provider_forward_json: JSON.stringify({
      provider: 'runninghub',
      path: '/run/ai-app/2048742865043460098',
      method: 'POST',
      rhRegion: 'cn',
      billingModelId: 'ltx-2-3-start-end-720p-5s',
      body: { nodeInfoList: [], instanceType: 'plus', usePersonalQueue: 'false' },
    }),
  })
    ? 'PASS'
    : 'FAIL';

  REPORT.results.ltx_t2v = await quick(
    'ltxt',
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
          { nodeId: '73', fieldName: 'text', fieldValue: 'P95B4reg LTX T2V' },
        ],
        instanceType: 'plus',
        usePersonalQueue: 'false',
      },
      billingModelId: 'ltx-2-3-720-10s',
      rhRegion: 'ai',
    },
    'ai',
  );
  log(`ltx_t2v=${REPORT.results.ltx_t2v.verdict}`);

  REPORT.results.ltx_i2v = await quick(
    'ltxi',
    'ltx-2.3-i2v',
    'ltx-2-3-i2v-720-10s',
    {
      provider: 'runninghub',
      path: '/run/ai-app/2034955204851933186',
      method: 'POST',
      body: {
        nodeInfoList: [
          { nodeId: '584', fieldName: 'image', fieldValue: OSS_IMAGE },
          { nodeId: '593', fieldName: 'value', fieldValue: '10' },
          { nodeId: '595', fieldName: 'value', fieldValue: '720' },
          { nodeId: '602', fieldName: 'positive', fieldValue: 'P95B4reg LTX I2V' },
        ],
        instanceType: 'plus',
        usePersonalQueue: 'false',
      },
      billingModelId: 'ltx-2-3-i2v-720-10s',
      rhRegion: 'cn',
    },
    'cn',
  );
  log(`ltx_i2v=${REPORT.results.ltx_i2v.verdict}`);

  REPORT.results.h3_t2v = await quick(
    'h3t',
    'minimax-h3-t2v',
    'minimax-h3-t2v-720p-10s',
    {
      provider: 'runninghub',
      path: '/run/ai-app/2085682347676102657',
      method: 'POST',
      body: {
        nodeInfoList: [
          { nodeId: '149', fieldName: 'text', fieldValue: 'P95B4reg H3 T2V', description: '提示词' },
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
  log(`h3_t2v=${REPORT.results.h3_t2v.verdict}`);

  REPORT.results.h3_i2v = await quick(
    'h3i',
    'minimax-h3-i2v',
    'minimax-h3-i2v-720p-10s',
    {
      provider: 'runninghub',
      path: '/run/ai-app/2085687129061019649',
      method: 'POST',
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
          { nodeId: '149', fieldName: 'text', fieldValue: 'P95B4reg H3 I2V', description: '提示词' },
        ],
        instanceType: 'plus',
        usePersonalQueue: 'false',
      },
      billingModelId: 'minimax-h3-i2v-720p-10s',
      rhRegion: 'cn',
    },
    'cn',
  );
  log(`h3_i2v=${REPORT.results.h3_i2v.verdict}`);

  REPORT.results.ltx_start_end = await quick(
    'ltxse',
    'rh-video-start-end',
    'ltx-2-3-start-end-720p-5s',
    {
      provider: 'runninghub',
      path: '/run/ai-app/2048742865043460098',
      method: 'POST',
      body: {
        nodeInfoList: [
          { nodeId: '2004', fieldName: 'image', fieldValue: OSS_IMAGE, description: 'image1' },
          {
            nodeId: '5062',
            fieldName: 'image',
            fieldValue: `${OSS_IMAGE}?v=end`,
            description: 'image2',
          },
          { nodeId: '5018', fieldName: 'value', fieldValue: '1280', description: '宽' },
          { nodeId: '5020', fieldName: 'value', fieldValue: '720', description: '高' },
          { nodeId: '5022', fieldName: 'value', fieldValue: '5', description: '时长' },
          { nodeId: '5090', fieldName: 'text', fieldValue: 'P95B4reg LTX start-end', description: 'text' },
        ],
        instanceType: 'plus',
        usePersonalQueue: 'false',
      },
      billingModelId: 'ltx-2-3-start-end-720p-5s',
      rhRegion: 'cn',
    },
    'cn',
  );
  log(`ltx_start_end=${REPORT.results.ltx_start_end.verdict}`);

  REPORT.results.rhart_t2v = await quick(
    'rxt',
    'rhart-video-x',
    'rhart-video-x-720p-10s',
    {
      provider: 'runninghub',
      path: '/rhart-video-g/text-to-video',
      method: 'POST',
      body: { prompt: 'P95B4reg rhart t2v', aspectRatio: '16:9', resolution: '720p', duration: 10 },
      billingModelId: 'rhart-video-x-720p-10s',
      rhRegion: 'ai',
    },
    'ai',
  );
  log(`rhart_t2v=${REPORT.results.rhart_t2v.verdict}`);

  REPORT.results.rhart_i2v = await quick(
    'rxi',
    'rhart-video-x',
    'rhart-video-x-720p-10s',
    {
      provider: 'runninghub',
      path: '/rhart-video-g/image-to-video',
      method: 'POST',
      body: {
        prompt: 'P95B4reg rhart i2v',
        duration: 10,
        aspectRatio: '16:9',
        resolution: '720p',
        imageUrls: [OSS_IMAGE],
      },
      billingModelId: 'rhart-video-x-720p-10s',
      rhRegion: 'ai',
    },
    'ai',
  );
  log(`rhart_i2v=${REPORT.results.rhart_i2v.verdict}`);

  const modelKeys = [
    'ltx_t2v',
    'ltx_i2v',
    'h3_t2v',
    'h3_i2v',
    'ltx_start_end',
    'rhart_t2v',
    'rhart_i2v',
  ];
  const hardFail = modelKeys.some(
    (k) => REPORT.results[k]?.verdict === 'FAIL' || REPORT.results[k]?.verdict === 'FAIL_CREATE',
  );
  const modelOk = modelKeys.every((k) => {
    const v = REPORT.results[k]?.verdict;
    return v === 'PASS' || v === 'BLOCKED_EXTERNAL';
  });

  REPORT.finished_at = new Date().toISOString();
  REPORT.conclusion = !hardFail && modelOk && REPORT.results.invalid_forward === 'PASS' ? 'PASS' : 'NEEDS-REVIEW';
  fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
  log(`conclusion=${REPORT.conclusion}`);
  console.log(JSON.stringify(REPORT, null, 2));
  process.exit(REPORT.conclusion === 'PASS' ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  REPORT.error = String(e?.stack || e);
  fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
  process.exit(2);
});
