/**
 * 定点复测：resource_pool / release-refill / dup-claim / idle HTTP
 * node scripts/accept-phase1-retest-http.mjs
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

const db = await import('../lib/db-tablestore.mjs');
const { tryClaimOneQueuedTask, tryRefillAfterSlotRelease } = await import('../lib/queueScheduler.mjs');
const out = { at: new Date().toISOString(), tests: {}, errors: [] };
const PREFIX = `__p1h_${Date.now().toString(36)}_`;
const tids = [];

function deps() {
  return {
    nowMs: Date.now(),
    leaseMs: 120000,
    orphanMs: 180000,
    leaseOwner: `p1h-${crypto.randomUUID().slice(0, 6)}`,
    resolveUserLimit: async () => 100,
    createReservation: (row) => db.putSlotReservation(row),
    markReservationHeld: async (id, which) =>
      db.updateSlotReservation(id, which === 'user' ? { user_slot_held: 1 } : { platform_slot_held: 1 }),
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

async function cleanupAll() {
  for (const tid of tids) {
    try {
      const t = await db.getTaskById(tid);
      if (!t) continue;
      const heldP = !!t.platform_slot_held;
      const heldU = !!t.user_slot_held;
      await db.upsertTask(tid, t.user_id, {
        status: 'failed',
        skip_slot_auto_release: true,
        user_slot_held: '0',
        platform_slot_held: '0',
        error_code: 'P1H_CLEAN',
      });
      if (heldP) await db.releasePlatformConcurrencySlot(t.resource_pool || 'cn_video').catch(() => {});
      if (heldU) await db.releaseUserConcurrencySlot(t.user_id, t.task_type).catch(() => {});
      await db.deleteTaskById?.(tid).catch(() => {});
    } catch (_) {}
  }
  for (let i = 0; i < 30; i++) {
    const s = await db.getPlatformConcurrencyPoolSnapshot();
    if (!(s.total_running > 0)) break;
    for (const p of ['cn_video', 'cn_image', 'overseas_video', 'overseas_image', 'audio']) {
      if (s[p]?.running > 0) await db.releasePlatformConcurrencySlot(p).catch(() => {});
    }
  }
}

try {
  const snap0 = await db.getPlatformConcurrencyPoolSnapshot();
  if ((snap0.total_running || 0) > 0) throw new Error(`busy total_running=${snap0.total_running}`);

  const uid = `${PREFIX}u0`;
  try {
    await db.createUserOtpOnly({ userId: uid, email: `${uid}@p1h.test` });
  } catch (_) {}
  await db.updateUserConcurrencyEntitlement(uid, {
    planId: 'enterprise',
    videoConcurrencyOverride: 100,
    imageConcurrencyOverride: 100,
    concurrencyOverrideExpiresAt: Date.now() + 86400000,
  });

  async function enq(pool) {
    const tid = crypto.randomUUID();
    await db.upsertTask(tid, uid, {
      status: 'queued',
      task_type: 'video',
      resource_pool: pool,
      model_id: `p1h-${pool}`,
      cost: 0,
      amount: 0,
      quoted_cost: 0,
      provider_forward_json: JSON.stringify({ path: '/openapi/v2/x', rhRegion: 'cn' }),
      prompt_json: '{}',
    });
    tids.push(tid);
    return tid;
  }

  // resource_pool
  {
    const tid = await enq('cn_video');
    const t = await db.getTaskById(tid);
    const w = await db.getTaskWork(tid);
    out.tests.resource_pool_rw = {
      task_pool: t?.resource_pool,
      work_pool: w?.resource_pool,
      ok: t?.resource_pool === 'cn_video' && w?.resource_pool === 'cn_video',
    };
    console.log('resource_pool_rw', out.tests.resource_pool_rw);
  }

  // release1 refill1
  {
    const d = deps();
    for (let i = 0; i < 5; i++) {
      const tid = await enq('cn_video');
      await tryClaimOneQueuedTask(
        { taskId: tid, userId: uid, taskType: 'video', resourcePool: 'cn_video', queueEnteredAt: i },
        d,
      );
    }
    for (let i = 0; i < 3; i++) await enq('cn_video');
    const before = (await db.getPlatformConcurrencyPoolSnapshot()).cn_video.running;
    await db.releasePlatformConcurrencySlot('cn_video');
    const mid = (await db.getPlatformConcurrencyPoolSnapshot()).cn_video.running;
    const refill = await tryRefillAfterSlotRelease('cn_video', d, {
      listQueuedForPool: async (pool, opts = {}) =>
        db.listQueuedTasksForPromote({
          maxTasks: opts.maxTasks ?? 10,
          maxScanRows: 5000,
          resourcePool: pool,
        }),
      maxRefill: 1,
    });
    const after = (await db.getPlatformConcurrencyPoolSnapshot()).cn_video.running;
    out.tests.release1_refill1 = {
      before,
      mid,
      after,
      refill_claimed: refill.claimed,
      ok: mid === before - 1 && refill.claimed === 1 && after === before,
    };
    console.log('release1_refill1', out.tests.release1_refill1);
  }

  // duplicate claim
  {
    await cleanupAll();
    tids.length = 0;
    const tid = await enq('cn_video');
    const args = {
      taskId: tid,
      userId: uid,
      taskType: 'video',
      resourcePool: 'cn_video',
      queueEnteredAt: 1,
    };
    const results = await Promise.all([
      tryClaimOneQueuedTask(args, deps()),
      tryClaimOneQueuedTask(args, deps()),
      tryClaimOneQueuedTask(args, deps()),
    ]);
    const okN = results.filter((r) => r.ok).length;
    out.tests.duplicate_claim = {
      ok: okN,
      results: results.map((r) => ({ ok: r.ok, reason: r.reason })),
      pass: okN === 1,
    };
    console.log('duplicate_claim', out.tests.duplicate_claim);
  }

  await cleanupAll();

  // idle HTTP
  {
    const base = String(process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '').replace(
      /\/$/,
      '',
    );
    const token = String(process.env.ALIYUN_FC_TOKEN || process.env.API_SECRET_TOKEN || '').trim();
    const settle = String(process.env.ADMIN_SETTLE_SECRET || '').trim();
    if (!base) {
      out.tests.idle_behavior = { ok: false, reason: 'missing HK_FC_ENDPOINT' };
    } else {
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'x-nexflow-token': token, Authorization: `Bearer ${token}` } : {}),
        ...(settle ? { 'x-admin-settle-secret': settle } : {}),
      };
      const t0 = Date.now();
      const resp = await fetch(`${base}/internal/run-queue-pipeline`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          max_claims: 5,
          max_charge: 10,
          max_dispatch: 5,
          max_poll: 10,
          reconcile: false,
        }),
      });
      const text = await resp.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch (_) {}
      const elapsed = Date.now() - t0;
      out.tests.idle_behavior = {
        http_status: resp.status,
        elapsed_ms: elapsed,
        idle_no_patrol: !!json?.idle_no_patrol,
        idle_short_circuit: !!json?.idle_short_circuit,
        queue_mode: json?.queue_mode || null,
        summary: json?.summary || null,
        ok:
          resp.status < 500 &&
          elapsed < 15000 &&
          (json?.idle_no_patrol ||
            json?.idle_short_circuit ||
            json?.queue_mode === 'idle' ||
            (json?.summary?.claimed === 0 && json?.summary?.poll_settled === 0)),
      };
    }
    console.log('idle_behavior', out.tests.idle_behavior);
  }
} catch (e) {
  out.errors.push(e?.message || String(e));
  console.error(e);
} finally {
  try {
    await cleanupAll();
  } catch (_) {}
  const p = path.join(__dirname, 'accept-phase1-retest-http-result.json');
  fs.writeFileSync(p, JSON.stringify(out, null, 2));
  console.log('wrote', p);
}
