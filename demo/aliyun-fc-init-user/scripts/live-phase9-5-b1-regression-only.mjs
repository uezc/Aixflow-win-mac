/**
 * Phase 9.5-B-1 — regression after LTX I2V live PASS
 * node scripts/live-phase9-5-b1-regression-only.mjs
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
const PREFIX = `__p95b1reg_${Date.now().toString(36)}_`;
const FC_BASE = (process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '').replace(/\/$/, '');
const FC_TOKEN = process.env.ALIYUN_FC_TOKEN || '';
const ADMIN_SECRET = process.env.ADMIN_SETTLE_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || '';
const OSS_IMAGE =
  process.env.P95B1_I2V_IMAGE_URL?.trim() ||
  (fs.existsSync(path.join(__dirname, 'p93d-i2v-image-url.txt'))
    ? fs.readFileSync(path.join(__dirname, 'p93d-i2v-image-url.txt'), 'utf8').trim()
    : '') ||
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p93d-i2v-test/1788607602254_b2eac80c.jpg';
const OUT = path.join(__dirname, 'phase9-5-b1-regression-only-result.json');
const MAIN_OUT = path.join(__dirname, 'phase9-5-b1-ltx-i2v-live-e2e-result.json');

function log(m) {
  console.log(`[p95b1-reg] ${m}`);
}
function sign(userId, tv = 0) {
  return jwt.sign({ sub: userId, typ: 'access', tv }, JWT_SECRET, { expiresIn: '7d' });
}
async function fcFetch(pathSuffix, { body = {}, auth = null, timeoutMs = 180000 } = {}) {
  const url = `${FC_BASE}${pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`}`;
  const headers = { 'content-type': 'application/json', 'x-nexflow-token': FC_TOKEN };
  if (auth) headers.authorization = `Bearer ${auth}`;
  if (ADMIN_SECRET) headers['x-admin-settle-secret'] = ADMIN_SECRET;
  for (let a = 1; a <= 3; a++) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeoutMs);
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
          json = { raw: text.slice(0, 400) };
        }
        return { status: res.status, json };
      } finally {
        clearTimeout(t);
      }
    } catch (e) {
      log(`fcFetch retry ${a}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * a));
    }
  }
  throw new Error('fcFetch failed');
}
async function fcInternal(name, body = {}) {
  return fcFetch(`/internal/${name}`, { body });
}

const db = await import('../lib/db-tablestore.mjs');
const { tryClaimOneQueuedTask } = await import('../lib/queueScheduler.mjs');
const { hasValidForwardPath } = await import('../lib/forwardPayload.mjs');

async function setBalance(userId, balance) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p95b1reg.local` });
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
    await db.createUserOtpOnly({ userId, email: `${userId}@p95b1reg.local` });
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
async function runFcWorkersUntil(taskId, { maxRounds = 45, intervalMs = 10000 } = {}) {
  for (let i = 0; i < maxRounds; i++) {
    await fcInternal('charge-claimed-tasks', { max_tasks: 50 });
    await fcInternal('dispatch-charged-tasks', { max_tasks: 50 });
    await fcInternal('poll-provider-tasks', { max_tasks: 50 });
    const t = await db.getTaskById(taskId);
    log(`r${i} status=${t?.status} pid=${String(t?.provider_task_id || '').slice(0, 20)}`);
    const st = String(t?.status || '').toLowerCase();
    if (['success', 'failed', 'cancelled', 'timeout'].includes(st)) return t;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return db.getTaskById(taskId);
}

async function quick(label, model, sku, forward, region) {
  await new Promise((r) => setTimeout(r, 2500));
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
    return { ok: false, reason: `create ${cr.status}` };
  }
  const tid = String(cr.json.task_id);
  await promoteOneTask(tid, u);
  const final = await runFcWorkersUntil(tid);
  const fwd = JSON.parse((await db.getTaskById(tid))?.provider_forward_json || '{}');
  const ok =
    String(final?.status).toLowerCase() === 'success' &&
    fwd.rhRegion === region &&
    !!final?.provider_task_id;
  return {
    ok,
    status: final?.status,
    pid: final?.provider_task_id,
    region: fwd.rhRegion,
    err: final?.error_code,
    blocked_external: !ok && final?.error_code === 'PROVIDER_NO_TASK_ID',
  };
}

async function main() {
  const REPORT = { started_at: new Date().toISOString() };

  REPORT.invalid_forward =
    hasValidForwardPath({
      provider_forward_json: JSON.stringify({
        provider: 'runninghub',
        path: '/run/ai-app/2034955204851933186',
        method: 'POST',
        rhRegion: 'cn',
        billingModelId: 'ltx-2-3-i2v-720-10s',
        body: { nodeInfoList: [{ nodeId: '584', fieldName: 'image', fieldValue: OSS_IMAGE }] },
      }),
    }) && !hasValidForwardPath({ provider_forward_json: '' })
      ? 'PASS'
      : 'FAIL';

  // dup charge/refund local
  {
    const { handleTasksCreate } = await import('../lib/handleTasksCreate.mjs');
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    const { dispatchOneChargedTask, pollOneProviderTask } = await import('../lib/providerPipeline.mjs');
    const uDup = `${PREFIX}dup`;
    await setupUser(uDup, 500);
    const forward = {
      provider: 'runninghub',
      path: '/run/ai-app/2034955204851933186',
      method: 'POST',
      rhRegion: 'cn',
      billingModelId: 'ltx-2-3-i2v-720-10s',
      body: {
        nodeInfoList: [
          { nodeId: '584', fieldName: 'image', fieldValue: OSS_IMAGE },
          { nodeId: '593', fieldName: 'value', fieldValue: '10' },
          { nodeId: '595', fieldName: 'value', fieldValue: '720' },
          { nodeId: '602', fieldName: 'positive', fieldValue: 'dup' },
        ],
        instanceType: 'plus',
        usePersonalQueue: 'false',
      },
    };
    const cr = await handleTasksCreate(
      uDup,
      {
        model_id: 'ltx-2-3-i2v-720-10s',
        type: 'video',
        execution_mode: 'queue',
        provider_forward_json: forward,
        params: { model: 'ltx-2.3-i2v', nxCloudQueueGoldenPath: true },
        nodeData: { model: 'ltx-2.3-i2v' },
      },
      db,
      { getFinalPrice: () => 8 },
    );
    const tid = cr.task_id;
    await promoteOneTask(tid, uDup);
    const bal0 = (await db.getUserById(uDup)).balance;
    for (let i = 0; i < 10; i++) await chargeClaimedTask(tid, db);
    const bal1 = (await db.getUserById(uDup)).balance;
    REPORT.duplicate_charge = Number(bal0) - Number(bal1) === 8 ? 'PASS' : 'FAIL';
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
        queryRunningHub: async () => ({ ok: true, status: 'FAILED', error: 'x' }),
      });
    }
    const bal3 = (await db.getUserById(uDup)).balance;
    REPORT.duplicate_refund = Number(bal2) === Number(bal3) && Number(bal2) === Number(bal0) ? 'PASS' : 'FAIL';
    log(`dup_charge=${REPORT.duplicate_charge} dup_refund=${REPORT.duplicate_refund}`);
  }

  REPORT.h3_t2v = await quick(
    'h3t2v',
    'minimax-h3-t2v',
    'minimax-h3-t2v-720p-10s',
    {
      provider: 'runninghub',
      path: '/run/ai-app/2085682347676102657',
      method: 'POST',
      body: {
        nodeInfoList: [
          { nodeId: '149', fieldName: 'text', fieldValue: 'P95B1reg H3 T2V', description: '提示词' },
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
  log(`h3_t2v=${REPORT.h3_t2v.ok}`);

  REPORT.ltx_t2v = await quick(
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
          { nodeId: '73', fieldName: 'text', fieldValue: 'P95B1reg LTX T2V' },
        ],
        instanceType: 'plus',
        usePersonalQueue: 'false',
      },
      billingModelId: 'ltx-2-3-720-10s',
      rhRegion: 'ai',
    },
    'ai',
  );
  log(`ltx_t2v=${REPORT.ltx_t2v.ok}`);

  REPORT.h3_i2v = await quick(
    'h3i2v',
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
          { nodeId: '149', fieldName: 'text', fieldValue: 'P95B1reg H3 I2V', description: '提示词' },
        ],
        instanceType: 'plus',
        usePersonalQueue: 'false',
      },
      billingModelId: 'minimax-h3-i2v-720p-10s',
      rhRegion: 'cn',
    },
    'cn',
  );
  log(`h3_i2v=${REPORT.h3_i2v.ok}`);

  REPORT.rhart_t2v = await quick(
    'rhartt2v',
    'rhart-video-x',
    'rhart-video-x-720p-10s',
    {
      provider: 'runninghub',
      path: '/rhart-video-g/text-to-video',
      method: 'POST',
      body: { prompt: 'P95B1reg rhart t2v', aspectRatio: '16:9', resolution: '720p', duration: 10 },
      billingModelId: 'rhart-video-x-720p-10s',
      rhRegion: 'ai',
    },
    'ai',
  );
  log(`rhart_t2v=${REPORT.rhart_t2v.ok} blocked=${!!REPORT.rhart_t2v.blocked_external}`);

  REPORT.rhart_i2v = await quick(
    'rharti2v',
    'rhart-video-x',
    'rhart-video-x-720p-10s',
    {
      provider: 'runninghub',
      path: '/rhart-video-g/image-to-video',
      method: 'POST',
      body: {
        prompt: 'P95B1reg rhart i2v',
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
  log(`rhart_i2v=${REPORT.rhart_i2v.ok} blocked=${!!REPORT.rhart_i2v.blocked_external}`);

  const okOrExt = (r) => r?.ok || r?.blocked_external;
  const all =
    REPORT.invalid_forward === 'PASS' &&
    REPORT.duplicate_charge === 'PASS' &&
    REPORT.duplicate_refund === 'PASS' &&
    REPORT.h3_t2v.ok &&
    REPORT.ltx_t2v.ok &&
    REPORT.h3_i2v.ok &&
    okOrExt(REPORT.rhart_t2v) &&
    okOrExt(REPORT.rhart_i2v);

  REPORT.conclusion = all ? 'PASS' : 'FAIL';
  REPORT.external_blocker =
    REPORT.rhart_t2v?.blocked_external || REPORT.rhart_i2v?.blocked_external
      ? 'rhart-video-x PROVIDER_NO_TASK_ID (likely RH.ai 605)'
      : null;
  REPORT.finished_at = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));

  // merge into main live result
  let main = {};
  try {
    main = JSON.parse(fs.readFileSync(MAIN_OUT, 'utf8'));
  } catch (_) {}
  main.regressions = REPORT;
  main.conclusion = all && String(main.ltx_i2v_e2e?.final_status).toLowerCase() === 'success' ? 'PASS' : 'FAIL';
  main.external_blocker = REPORT.external_blocker;
  main.finished_at = new Date().toISOString();
  main.errors = (main.errors || []).filter((e) => !String(e).includes('fetch failed'));
  fs.writeFileSync(MAIN_OUT, JSON.stringify(main, null, 2));

  console.log(JSON.stringify(REPORT, null, 2));
  process.exit(all ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
