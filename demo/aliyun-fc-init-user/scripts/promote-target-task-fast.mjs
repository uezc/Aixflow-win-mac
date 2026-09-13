/**
 * 快速推进指定 queued 任务（不依赖清完压测积压）。
 * 可选：顺带批量失败「纯 queued」压测垃圾（不退款、高并发）。
 *
 * Usage: node scripts/promote-target-task-fast.mjs [taskId]
 */
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvFile(path.join(REPO, '.env'));
loadEnvFile(path.join(ROOT, '.env'));

const TARGET = String(process.argv[2] || 'fa86cc56-176d-414c-84cb-e7138b36c2c2').trim();
const CLEAN_QUEUED_JUNK = process.env.SKIP_JUNK_CLEAN !== '1';
const JUNK_PREFIXES = ['__p5', '__p81', '__p9', '__p815', '__test', '__live', '__phase'];

function isJunkUser(userId) {
  const u = String(userId || '').trim();
  if (!u || u.startsWith('nx_')) return false;
  return JUNK_PREFIXES.some((p) => u.startsWith(p));
}

function held(v) {
  return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
}

async function mapPool(items, concurrency, fn) {
  const ret = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      ret[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return ret;
}

const db = await import('../lib/db-tablestore.mjs');
const { tryClaimOneQueuedTask } = await import('../lib/queueScheduler.mjs');

const FC = (process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '').replace(/\/$/, '');
const ADM = process.env.ADMIN_SETTLE_SECRET || '';
const TOK = process.env.ALIYUN_FC_TOKEN || '';

async function fc(name, body = {}) {
  const res = await fetch(`${FC}/internal/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-nexflow-token': TOK,
      'x-admin-settle-secret': ADM,
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
  return { http: res.status, json };
}

function buildDeps(nowMs = Date.now()) {
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
    tryAcquireUser: (userId, taskType, limit) =>
      db.tryAcquireUserConcurrencySlot(userId, taskType, limit),
    releaseUser: (userId, taskType) => db.releaseUserConcurrencySlot(userId, taskType),
    tryAcquirePlatform: (taskType) => db.tryAcquirePlatformConcurrencySlot(taskType),
    releasePlatform: (taskType) => db.releasePlatformConcurrencySlot(taskType),
    atomicClaimQueuedTask: (args) => db.atomicClaimQueuedTask(args),
    getTaskById: (taskId) => db.getTaskById(taskId),
  };
}

async function failQueuedJunkFast(tid) {
  const t = await db.getTaskById(tid);
  if (!t || tid === TARGET || !isJunkUser(t.user_id)) return { ok: false };
  const st = String(t.status || '').toLowerCase();
  if (st !== 'queued') return { ok: false, reason: 'not_queued' };
  await db.upsertTask(tid, t.user_id, {
    status: 'failed',
    execution_stage: 'done',
    error_code: 'JUNK_TEST_QUEUE_CLEANUP',
    error_msg: 'historical loadtest queued task cancelled',
  });
  return { ok: true, task_id: tid };
}

async function failClaimedJunkWithRefund(tid) {
  const t = await db.getTaskById(tid);
  if (!t || tid === TARGET || !isJunkUser(t.user_id)) return { ok: false };
  const st = String(t.status || '').toLowerCase();
  if (st === 'success' || st === 'failed' || st === 'cancelled') return { ok: true, skipped: true };
  if (st === 'queued') return failQueuedJunkFast(tid);

  if (String(t.charge_id || '').trim() && typeof db.refundTaskCharge === 'function') {
    try {
      await db.refundTaskCharge(tid);
    } catch (e) {
      console.warn('[refund]', tid, e?.message || e);
    }
  }

  const slotSnap = { ...t };
  await db.upsertTask(tid, t.user_id, {
    status: 'failed',
    execution_stage: 'done',
    error_code: 'JUNK_TEST_QUEUE_CLEANUP',
    error_msg: 'historical loadtest claimed task cancelled',
    user_slot_held: '0',
    platform_slot_held: '0',
    lease_owner: '',
    lease_expires_at: 0,
  });
  const taskType = String(t.task_type || '').toLowerCase();
  if ((taskType === 'video' || taskType === 'image') && held(slotSnap.platform_slot_held)) {
    try {
      await db.releasePlatformConcurrencySlot(taskType);
    } catch (_) {}
  }
  if ((taskType === 'video' || taskType === 'image') && held(slotSnap.user_slot_held)) {
    try {
      await db.releaseUserConcurrencySlot(t.user_id, taskType);
    } catch (_) {}
  }
  return { ok: true, task_id: tid, prev: st };
}

console.log(JSON.stringify({ TARGET, FC, CLEAN_QUEUED_JUNK }, null, 2));

// 1) 先直接 claim 目标（不依赖清垃圾）
let t0 = await db.getTaskById(TARGET);
console.log('before', JSON.stringify({
  status: t0?.status,
  stage: t0?.execution_stage,
  pid: t0?.provider_task_id,
  user: t0?.user_id,
  model: t0?.model_id,
}));

if (!t0) {
  console.error('TARGET_NOT_FOUND');
  process.exit(1);
}

if (String(t0.status).toLowerCase() === 'queued') {
  const claim = await tryClaimOneQueuedTask(
    {
      taskId: TARGET,
      userId: t0.user_id,
      taskType: String(t0.task_type || 'video').toLowerCase(),
      queueEnteredAt: Number(t0.queue_entered_at || 0),
    },
    buildDeps(),
  );
  console.log('claim', JSON.stringify(claim));
  if (!claim?.ok) {
    console.error('CLAIM_FAILED', claim);
    process.exit(2);
  }
}

// 2) charge → dispatch → poll（多轮，确保命中本任务）
for (let i = 0; i < 5; i++) {
  const charge = await fc('charge-claimed-tasks', { max_tasks: 80 });
  const dispatch = await fc('dispatch-charged-tasks', { max_tasks: 80 });
  const poll = await fc('poll-provider-tasks', { max_tasks: 40 });
  t0 = await db.getTaskById(TARGET);
  console.log(
    JSON.stringify({
      i,
      charge: { http: charge.http, charged: charge.json?.charged, failed: charge.json?.failed },
      dispatch: { http: dispatch.http, ok: dispatch.json?.ok, failed: dispatch.json?.failed },
      poll: { http: poll.http, settled: poll.json?.settled },
      target: {
        status: t0?.status,
        stage: t0?.execution_stage,
        pid: t0?.provider_task_id,
        err: t0?.error_code || t0?.error_msg,
      },
    }),
  );
  if (t0?.provider_task_id || ['success', 'failed', 'cancelled'].includes(String(t0?.status || '').toLowerCase())) {
    break;
  }
  // 若还在 claimed 但未 charged，继续
  await new Promise((r) => setTimeout(r, 1500));
}

// 3) 顺带清一批纯 queued 垃圾（快路径，不退款）
let junkFailed = 0;
if (CLEAN_QUEUED_JUNK) {
  for (let round = 0; round < 25; round++) {
    const listed = await db.listQueuedTasksForPromote({ maxTasks: 500, maxScanRows: 80000 });
    const junkIds = (listed.tasks || [])
      .filter((t) => isJunkUser(t.userId) && t.taskId !== TARGET)
      .map((t) => t.taskId);
    if (!junkIds.length) {
      console.log(JSON.stringify({ junk_round: round, done: true, queued_left_sample: listed.tasks?.length }));
      break;
    }
    const results = await mapPool(junkIds, 25, (tid) => failQueuedJunkFast(tid));
    const ok = results.filter((r) => r?.ok).length;
    junkFailed += ok;
    console.log(JSON.stringify({ junk_round: round, batch: junkIds.length, failed_ok: ok, total: junkFailed }));
  }

  // 清一小批已 claimed 的压测（含退款），避免继续占槽
  const exp = await db.listExpiredClaimedTasks({ maxTasks: 100, maxScanRows: 40000 });
  const claimedJunk = (exp.tasks || []).filter((t) => isJunkUser(t.userId)).map((t) => t.taskId);
  if (claimedJunk.length) {
    const results = await mapPool(claimedJunk, 8, (tid) => failClaimedJunkWithRefund(tid));
    console.log(
      JSON.stringify({
        expired_claimed_junk: claimedJunk.length,
        cleaned: results.filter((r) => r?.ok && !r.skipped).length,
      }),
    );
  }
}

const final = await db.getTaskById(TARGET);
const plat = await db.getPlatformConcurrencyPoolSnapshot();
const head = await db.listQueuedTasksForPromote({ maxTasks: 20, maxScanRows: 30000 });
const report = {
  target_final: {
    task_id: TARGET,
    status: final?.status,
    execution_stage: final?.execution_stage,
    provider_task_id: final?.provider_task_id,
    error_code: final?.error_code,
    error_msg: final?.error_msg,
    model_id: final?.model_id,
    user_id: final?.user_id,
  },
  platform: plat,
  junk_queued_failed: junkFailed,
  queue_head_junk: (head.tasks || []).filter((t) => isJunkUser(t.userId)).length,
  queue_head_total: head.tasks?.length || 0,
};
fs.writeFileSync(path.join(__dirname, 'promote-target-fast-result.json'), JSON.stringify(report, null, 2));
console.log('FINAL', JSON.stringify(report, null, 2));
