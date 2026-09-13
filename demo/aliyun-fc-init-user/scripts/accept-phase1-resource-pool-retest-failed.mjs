/**
 * Phase1 失败项定点复测（短、隔离）
 * node scripts/accept-phase1-resource-pool-retest-failed.mjs
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
for (const k of [
  'GLOBAL_CN_VIDEO_CONCURRENCY',
  'GLOBAL_CN_IMAGE_CONCURRENCY',
  'GLOBAL_OVERSEAS_VIDEO_CONCURRENCY',
  'GLOBAL_OVERSEAS_IMAGE_CONCURRENCY',
  'GLOBAL_AUDIO_CONCURRENCY',
]) process.env[k] = '100';

const require = createRequire(path.join(ROOT, 'package.json'));
const db = await import('../lib/db-tablestore.mjs');
const { tryClaimOneQueuedTask, tryRefillAfterSlotRelease } = await import('../lib/queueScheduler.mjs');

const out = { at: new Date().toISOString(), tests: {} };
const PREFIX = `__p1rt_${Date.now().toString(36)}_`;
const tids = [];

function buildDeps() {
  return {
    nowMs: Date.now(),
    leaseMs: 120000,
    orphanMs: 180000,
    leaseOwner: 'p1-retest',
    resolveUserLimit: async () => 100,
    createReservation: (row) => db.putSlotReservation(row),
    markReservationHeld: async (id, which) => {
      await db.updateSlotReservation(id, which === 'user' ? { user_slot_held: 1 } : { platform_slot_held: 1 });
    },
    markReservationState: async (id, state, extra = {}) => {
      try {
        await db.updateSlotReservation(id, { state, ...extra });
      } catch (_) {}
    },
    tryAcquireUser: (u, t, l) => db.tryAcquireUserConcurrencySlot(u, t, l),
    releaseUser: (u, t) => db.releaseUserConcurrencySlot(u, t),
    tryAcquirePlatform: (p) => db.tryAcquirePlatformConcurrencySlot(p),
    releasePlatform: (p) => db.releasePlatformConcurrencySlot(p),
    atomicClaimQueuedTask: (a) => db.atomicClaimQueuedTask(a),
    atomicUnclaimExpiredTask: (a) => db.atomicUnclaimExpiredTask(a),
    getTaskById: (id) => db.getTaskById(id),
  };
}

async function ensureUser(uid) {
  try {
    await db.createUserOtpOnly({ userId: uid, email: `${uid}@p1rt.test` });
  } catch (_) {}
  await db.updateUserConcurrencyEntitlement(uid, {
    planId: 'enterprise',
    videoConcurrencyOverride: 100,
    imageConcurrencyOverride: 100,
    concurrencyOverrideExpiresAt: Date.now() + 86400000,
  });
}

async function enq(uid, pool, pathStr) {
  const tid = crypto.randomUUID();
  await db.upsertTask(tid, uid, {
    status: 'queued',
    task_type: pool.includes('image') ? 'image' : 'video',
    resource_pool: pool,
    model_id: `p1rt-${pool}`,
    cost: 0,
    amount: 0,
    quoted_cost: 0,
    provider_forward_json: JSON.stringify({
      path: pathStr,
      rhRegion: pool.startsWith('overseas') ? 'ai' : 'cn',
    }),
    prompt_json: JSON.stringify({ p1rt: true }),
  });
  tids.push(tid);
  return tid;
}

// precheck
const snap0 = await db.getPlatformConcurrencyPoolSnapshot();
if ((snap0.total_running || 0) > 0) {
  console.error('ABORT busy', snap0.total_running);
  process.exit(2);
}

const uid = `${PREFIX}u0`;
await ensureUser(uid);
const deps = buildDeps();

// —— resource_pool write/read ——
{
  const tid = await enq(uid, 'cn_video', '/openapi/v2/cn-video');
  const t = await db.getTaskById(tid);
  const w = await db.getTaskWork(tid);
  out.tests.resource_pool_rw = {
    task_pool: t?.resource_pool,
    work_pool: w?.resource_pool,
    ok: t?.resource_pool === 'cn_video' && w?.resource_pool === 'cn_video',
  };
}

// —— fill 5 claimed + 3 queued; release 1 refill 1 ——
{
  const claimed = [];
  for (let i = 0; i < 5; i++) {
    const tid = await enq(uid, 'cn_video', '/openapi/v2/cn-video');
    const r = await tryClaimOneQueuedTask(
      { taskId: tid, userId: uid, taskType: 'video', resourcePool: 'cn_video', queueEnteredAt: i },
      deps,
    );
    claimed.push({ tid, ok: r.ok });
  }
  const waiting = [];
  for (let i = 0; i < 3; i++) waiting.push(await enq(uid, 'cn_video', '/openapi/v2/cn-video'));
  const before = (await db.getPlatformConcurrencyPoolSnapshot()).cn_video.running;
  await db.releasePlatformConcurrencySlot('cn_video');
  const mid = (await db.getPlatformConcurrencyPoolSnapshot()).cn_video.running;
  const refill = await tryRefillAfterSlotRelease('cn_video', deps, {
    listQueuedForPool: async (pool, opts = {}) =>
      db.listQueuedTasksForPromote({ maxTasks: opts.maxTasks ?? 10, maxScanRows: 5000, resourcePool: pool }),
    maxRefill: 1,
  });
  const after = (await db.getPlatformConcurrencyPoolSnapshot()).cn_video.running;
  out.tests.release1_refill1 = {
    before,
    mid,
    after,
    refill_claimed: refill.claimed,
    claimed_setup: claimed.filter((x) => x.ok).length,
    ok: mid === before - 1 && refill.claimed === 1 && after === before,
  };
}

// —— duplicate claim ——
{
  // free capacity
  const s = await db.getPlatformConcurrencyPoolSnapshot();
  while (s.cn_video && (await db.getPlatformConcurrencyPoolSnapshot()).cn_video.running > 0) {
    await db.releasePlatformConcurrencySlot('cn_video');
  }
  // also clear held user slots by finishing claimed
  for (const tid of tids) {
    const t = await db.getTaskById(tid);
    if (t && String(t.status) === 'claimed') {
      await db.upsertTask(tid, t.user_id, {
        status: 'failed',
        skip_slot_auto_release: true,
        user_slot_held: '0',
        platform_slot_held: '0',
        error_code: 'P1RT_DRAIN',
      });
      if (t.user_slot_held) await db.releaseUserConcurrencySlot(t.user_id, 'video').catch(() => {});
    }
  }
  const dup = await enq(uid, 'cn_video', '/openapi/v2/cn-video');
  const t0 = await db.getTaskById(dup);
  const args = {
    taskId: dup,
    userId: uid,
    taskType: 'video',
    resourcePool: 'cn_video',
    queueEnteredAt: 1,
  };
  console.log('dup status before', t0?.status, t0?.resource_pool);
  const results = await Promise.all([
    tryClaimOneQueuedTask(args, buildDeps()),
    tryClaimOneQueuedTask(args, buildDeps()),
    tryClaimOneQueuedTask(args, buildDeps()),
  ]);
  const ok = results.filter((r) => r.ok).length;
  out.tests.duplicate_claim = {
    ok,
    results: results.map((r) => ({ ok: r.ok, reason: r.reason })),
    pass: ok === 1,
  };
}

// —— idle invoke (timer-like) ——
{
  // drain all
  for (const tid of tids) {
    const t = await db.getTaskById(tid);
    if (!t) continue;
    const heldP = !!t.platform_slot_held;
    const heldU = !!t.user_slot_held;
    await db.upsertTask(tid, t.user_id, {
      status: 'failed',
      skip_slot_auto_release: true,
      user_slot_held: '0',
      platform_slot_held: '0',
      error_code: 'P1RT_CLEAN',
    }).catch(() => {});
    if (heldP) await db.releasePlatformConcurrencySlot(t.resource_pool || 'cn_video').catch(() => {});
    if (heldU) await db.releaseUserConcurrencySlot(t.user_id, t.task_type).catch(() => {});
    await db.deleteTaskById?.(tid).catch(() => {});
  }
  while ((await db.getPlatformConcurrencyPoolSnapshot()).total_running > 0) {
    for (const p of ['cn_video', 'cn_image', 'overseas_video', 'overseas_image', 'audio']) {
      await db.releasePlatformConcurrencySlot(p).catch(() => {});
    }
  }
  const Fc20230330 = require('@alicloud/fc20230330');
  const OpenApi = require('@alicloud/openapi-client');
  const Util = require('@alicloud/tea-util');
  const ak = process.env.OTS_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_ID;
  const sk = process.env.OTS_ACCESS_KEY_SECRET || process.env.OSS_ACCESS_KEY_SECRET;
  const client = new Fc20230330.default(
    new OpenApi.Config({ accessKeyId: ak, accessKeySecret: sk, endpoint: 'fcv3.cn-hongkong.aliyuncs.com' }),
  );
  const event = {
    triggerTime: new Date().toISOString(),
    triggerName: 'nexflow-queue-pipeline',
    payload: { action: 'run-queue-pipeline', max_claims: 5, reconcile: false },
  };
  const req = new Fc20230330.InvokeFunctionRequest({});
  req.body = Buffer.from(JSON.stringify(event));
  const t0 = Date.now();
  const resp = await client.invokeFunctionWithOptions(
    'nexflow-api',
    req,
    { 'x-fc-invocation-type': 'Sync' },
    {},
    new Util.RuntimeOptions({ readTimeout: 120000 }),
  );
  const elapsed = Date.now() - t0;
  let body = resp?.body;
  if (body && typeof body.read === 'function') {
    const chunks = [];
    for await (const c of body) chunks.push(c);
    body = Buffer.concat(chunks).toString('utf8');
  } else if (Buffer.isBuffer(body)) body = body.toString('utf8');
  let parsed = null;
  try {
    parsed = JSON.parse(body);
    if (parsed?.body && typeof parsed.body === 'string') {
      try {
        parsed = JSON.parse(parsed.isBase64Encoded ? Buffer.from(parsed.body, 'base64').toString() : parsed.body);
      } catch (_) {
        parsed = parsed.body;
      }
    }
  } catch (_) {
    parsed = { raw: String(body).slice(0, 500) };
  }
  out.tests.idle_behavior = {
    elapsed_ms: elapsed,
    parsed_summary: parsed?.summary || parsed?.idle_short_circuit_detail || parsed,
    idle_short_circuit: parsed?.idle_short_circuit,
    idle_no_patrol: parsed?.idle_no_patrol,
    queue_mode: parsed?.queue_mode,
    ok:
      elapsed < 15000 &&
      (parsed?.idle_short_circuit === true ||
        parsed?.queue_mode === 'idle' ||
        (parsed?.summary && parsed.summary.claimed === 0 && parsed.summary.poll_settled === 0)),
  };
}

const pathOut = path.join(__dirname, 'accept-phase1-resource-pool-retest-failed-result.json');
fs.writeFileSync(pathOut, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
console.log('wrote', pathOut);
