/**
 * 清理压测队列垃圾（__p5/__p81/...），再推进指定真实任务。
 * Usage: node scripts/cleanup-junk-queue-then-promote.mjs [taskId]
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
const MAX_SCAN = Math.min(200000, Math.max(10000, parseInt(process.env.JUNK_MAX_SCAN || '120000', 10) || 120000));
const MAX_FAIL = Math.min(50000, Math.max(100, parseInt(process.env.JUNK_MAX_FAIL || '20000', 10) || 20000));

const JUNK_PREFIXES = [
  '__p5',
  '__p81',
  '__p9',
  '__p815',
  '__test',
  '__live',
  '__phase',
];

function isJunkUser(userId) {
  const u = String(userId || '').trim();
  if (!u) return false;
  if (u.startsWith('nx_')) return false; // 永远不碰真实用户
  return JUNK_PREFIXES.some((p) => u.startsWith(p));
}

function held(v) {
  return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
}

const db = await import('../lib/db-tablestore.mjs');
const { tryClaimOneQueuedTask } = await import('../lib/queueScheduler.mjs');
const TableStore = (await import('tablestore')).default;

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

function getClient() {
  // reuse via listQueued — we'll scan using exported helpers + getTaskById
  return null;
}

async function scanActiveJunkTasks() {
  // Use listQueuedTasksForPromote in large batches + dedicated claimed scan via getRange through db internals.
  // Prefer: scan queued candidates repeatedly + scanTasks via promoting list with high max.
  const junk = [];
  const seen = new Set();

  // 1) queued：尽量扫全
  let queuedScanned = 0;
  let startHint = 0;
  while (junk.length < MAX_FAIL) {
    const listed = await db.listQueuedTasksForPromote({
      maxTasks: 500,
      maxScanRows: Math.min(50000, MAX_SCAN - queuedScanned || 50000),
    });
    queuedScanned += listed.scanned || 0;
    let added = 0;
    for (const t of listed.tasks || []) {
      if (!isJunkUser(t.userId)) continue;
      if (t.taskId === TARGET) continue;
      if (seen.has(t.taskId)) continue;
      seen.add(t.taskId);
      junk.push({ taskId: t.taskId, userId: t.userId, from: 'queued' });
      added += 1;
    }
    // listQueued always restarts from INF_MIN — so once we've collected all junk in the
    // first maxTasks window of PK order, further calls return the same set.
    // Break when a full pass adds 0 new junk beyond already-seen, after failing some.
    if (added === 0) break;
    // Fail this batch immediately so next listQueued pass surfaces the next PK window.
    break;
  }

  return { junk, queuedScanned, note: 'batch_mode' };
}

async function failOneJunk(taskId) {
  const t = await db.getTaskById(taskId);
  if (!t) return { ok: false, reason: 'NOT_FOUND', task_id: taskId };
  if (taskId === TARGET) return { ok: false, reason: 'PROTECTED_TARGET', task_id: taskId };
  if (!isJunkUser(t.user_id)) return { ok: false, reason: 'NOT_JUNK_USER', task_id: taskId };

  const st = String(t.status || '').toLowerCase();
  if (st === 'success' || st === 'failed' || st === 'cancelled') {
    return { ok: true, skipped: true, reason: 'ALREADY_TERMINAL', task_id: taskId, status: st };
  }

  // 已 charged 的压测任务：退款（测试账号）
  const stage = String(t.execution_stage || '').toLowerCase();
  const maybeCharged =
    stage === 'charged' ||
    stage === 'dispatching' ||
    stage === 'provider_submitted' ||
    stage === 'settling' ||
    Number(t.cost || t.amount || 0) > 0 ||
    String(t.charge_id || '').trim() !== '';
  if (maybeCharged && typeof db.refundTaskCharge === 'function') {
    try {
      await db.refundTaskCharge(taskId);
    } catch (e) {
      // 无 charge 行时忽略
      if (!String(e?.message || e).includes('NOT_FOUND')) {
        console.warn('[junk] refund', taskId, e?.message || e);
      }
    }
  }

  const slotSnap = {
    task_id: t.task_id,
    user_id: t.user_id,
    task_type: t.task_type,
    reservation_id: t.reservation_id,
    user_slot_held: t.user_slot_held,
    platform_slot_held: t.platform_slot_held,
  };

  await db.upsertTask(taskId, t.user_id, {
    status: 'failed',
    execution_stage: 'done',
    error_code: 'JUNK_TEST_QUEUE_CLEANUP',
    error_msg: 'historical loadtest task cancelled to unblock real queue',
    user_slot_held: '0',
    platform_slot_held: '0',
    lease_owner: '',
    lease_expires_at: 0,
    dispatch_lease_owner: '',
    dispatch_lease_expires_at: 0,
  });

  const taskType = String(t.task_type || '').toLowerCase();
  if ((taskType === 'video' || taskType === 'image') && held(slotSnap.platform_slot_held)) {
    try {
      await db.releasePlatformConcurrencySlot(taskType);
    } catch (e) {
      console.warn('[junk] release platform', taskId, e?.message || e);
    }
  }
  if ((taskType === 'video' || taskType === 'image') && held(slotSnap.user_slot_held)) {
    try {
      await db.releaseUserConcurrencySlot(t.user_id, taskType);
    } catch (e) {
      console.warn('[junk] release user', taskId, e?.message || e);
    }
  }
  if (String(t.reservation_id || '').trim()) {
    try {
      await db.updateSlotReservation(String(t.reservation_id), {
        state: 'released',
        user_slot_held: 0,
        platform_slot_held: 0,
      });
    } catch (_) {}
  }

  return { ok: true, task_id: taskId, prev_status: st, user_id: t.user_id };
}

async function cleanupAllJunkQueued() {
  const stats = { rounds: 0, failed: 0, skipped: 0, errors: 0, samples: [] };
  // 反复：列出 queued 前 500 → 失败其中的 junk → 直到一轮里 queued 候选 junk=0
  // 同时扫 claimed junk（lease recovery 会不断把它们捡回来）
  for (let round = 0; round < 80; round += 1) {
    stats.rounds += 1;
    const listed = await db.listQueuedTasksForPromote({ maxTasks: 400, maxScanRows: 80000 });
    const queuedJunk = (listed.tasks || []).filter(
      (t) => isJunkUser(t.userId) && t.taskId !== TARGET,
    );

    // 也扫过期 claimed（压测常卡在 claimed）
    let claimedJunk = [];
    if (typeof db.listExpiredClaimedTasks === 'function') {
      const exp = await db.listExpiredClaimedTasks({ maxTasks: 200, maxScanRows: 40000 });
      claimedJunk = (exp.tasks || []).filter((t) => isJunkUser(t.userId) && t.taskId !== TARGET);
    }

    // 额外：用 promote 扫描不到的「未过期 claimed junk」——通过 FC lease recover 不够，
    // 对刚被我们 kick claim 的压测任务，lease 还没过期。用 getTaskById 批量？无法枚举。
    // 折中：对本轮 promote 结果里已 claim 的 junk，在 cleanup 前先走 FC promote 的反面——
    // 直接扫 listQueued 不够。改用 TableStore range 手工扫 claimed junk。
    const activeClaimedJunk = await scanClaimedOrRunningJunk(300);

    const batchIds = [
      ...queuedJunk.map((t) => t.taskId),
      ...claimedJunk.map((t) => t.taskId),
      ...activeClaimedJunk,
    ];
    let uniq = [...new Set(batchIds)];

    console.log(
      JSON.stringify({
        round,
        queued_candidates: listed.tasks?.length || 0,
        queued_junk: queuedJunk.length,
        expired_claimed_junk: claimedJunk.length,
        active_claimed_running_junk: activeClaimedJunk.length,
        batch: uniq.length,
        scanned: listed.scanned,
      }),
    );

    if (!uniq.length) {
      const check = await db.listQueuedTasksForPromote({ maxTasks: 200, maxScanRows: 50000 });
      const still = (check.tasks || []).filter(
        (t) => isJunkUser(t.userId) && t.taskId !== TARGET,
      );
      if (!still.length) break;
      uniq = still.map((t) => t.taskId);
    }

    for (const tid of uniq) {
      if (stats.failed + stats.errors >= MAX_FAIL) break;
      try {
        const r = await failOneJunk(tid);
        if (r.skipped) stats.skipped += 1;
        else if (r.ok) {
          stats.failed += 1;
          if (stats.samples.length < 20) stats.samples.push(r);
        } else {
          stats.errors += 1;
          if (stats.samples.length < 30) stats.samples.push(r);
        }
      } catch (e) {
        stats.errors += 1;
        console.warn('[junk] fail error', tid, e?.message || e);
      }
    }

    if (stats.failed + stats.errors >= MAX_FAIL) break;
  }
  return stats;
}

async function scanClaimedOrRunningJunk(maxTasks = 300) {
  // 借用 listQueued 的 OTS 扫描模式：通过 db 未导出 getRange，改用多次 listExpired +
  // 对已知压测前缀无能为力枚举全部 claimed。
  // 使用 runPromote 不会列出 claimed。
  // 这里用 internal：动态 import tablestore + 复制 listQueued 扫描逻辑，过滤 status。
  const out = [];
  const clientMod = await import('../lib/db-tablestore.mjs');
  // getTaskById only — use listInvalidForward + promote scan is insufficient.
  // Direct range scan via undocumented: call listQueued style by reading source...
  // Implement local range using same env credentials as db module.
  const TableStorePkg = (await import('tablestore')).default;
  const endpoint = process.env.OTS_ENDPOINT || process.env.TABLESTORE_ENDPOINT;
  const accessKeyId = process.env.OTS_ACCESS_KEY_ID || process.env.ALIYUN_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OTS_ACCESS_KEY_SECRET || process.env.ALIYUN_ACCESS_KEY_SECRET;
  const instanceName = process.env.OTS_INSTANCE_NAME || process.env.TABLESTORE_INSTANCE;
  const table =
    process.env.OTS_TASKS_TABLE || process.env.NX_TASKS_TABLE || 'nx_tasks';
  if (!endpoint || !accessKeyId || !accessKeySecret || !instanceName) {
    console.warn('[junk] OTS env incomplete for claimed scan; skip active claimed scan');
    return out;
  }
  const client = new TableStorePkg.Client({
    accessKeyId,
    secretAccessKey: accessKeySecret,
    endpoint,
    instancename: instanceName,
  });
  const getRange = (params) =>
    new Promise((resolve, reject) => {
      client.getRange(params, (err, data) => (err ? reject(err) : resolve(data)));
    });

  let nextStart = [{ task_id: TableStorePkg.INF_MIN }];
  const endPK = [{ task_id: TableStorePkg.INF_MAX }];
  let scanned = 0;
  while (out.length < maxTasks && scanned < MAX_SCAN) {
    const res = await getRange({
      tableName: table,
      direction: TableStorePkg.Direction.FORWARD,
      inclusiveStartPrimaryKey: nextStart,
      exclusiveEndPrimaryKey: endPK,
      limit: 500,
    });
    for (const row of res.rows || []) {
      scanned += 1;
      const attrs = {};
      for (const a of row.attributes || []) {
        const k = Object.keys(a)[0];
        attrs[k] = a[k];
      }
      // TableStore attr format may be { columnName, columnValue } depending on SDK
      const obj = {};
      if (row.attributes?.[0] && 'columnName' in (row.attributes[0] || {})) {
        for (const a of row.attributes) obj[a.columnName] = a.columnValue;
      } else {
        for (const a of row.attributes || []) {
          const k = Object.keys(a).find((x) => x !== 'timestamp');
          if (k) obj[k] = a[k];
        }
      }
      const uid = String(obj.user_id || '').trim();
      const st = String(obj.status || '').toLowerCase();
      if (!isJunkUser(uid)) continue;
      if (!['claimed', 'running', 'processing'].includes(st)) continue;
      let tid = '';
      const pk = row.primaryKey || [];
      for (const p of pk) {
        if (p.task_id != null) tid = String(p.task_id);
        else if (p.name === 'task_id') tid = String(p.value);
        else if (typeof p === 'object') {
          const k = Object.keys(p)[0];
          if (k === 'task_id') tid = String(p[k]);
        }
      }
      if (!tid || tid === TARGET) continue;
      out.push(tid);
      if (out.length >= maxTasks) break;
    }
    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    if (!nextPk) break;
    // convert next pk
    if (Array.isArray(nextPk)) {
      nextStart = nextPk.map((p) => {
        if (p.task_id != null) return { task_id: p.task_id };
        if (p.name === 'task_id') return { task_id: p.value };
        const k = Object.keys(p)[0];
        return { [k]: p[k] };
      });
    } else break;
  }
  console.log(JSON.stringify({ claimed_running_junk_scan: scanned, found: out.length }));
  return out;
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

async function promoteTarget() {
  const t0 = await db.getTaskById(TARGET);
  if (!t0) return { ok: false, reason: 'TARGET_NOT_FOUND' };
  if (String(t0.status).toLowerCase() !== 'queued') {
    return {
      ok: true,
      already: true,
      status: t0.status,
      stage: t0.execution_stage,
      pid: t0.provider_task_id,
    };
  }

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
  if (!claim?.ok) return { ok: false, reason: 'CLAIM_FAILED', claim };

  // 优先走 FC charge/dispatch/poll（与线上一致）
  const charge = await fc('charge-claimed-tasks', { max_tasks: 50 });
  const dispatch = await fc('dispatch-charged-tasks', { max_tasks: 50 });
  const poll = await fc('poll-provider-tasks', { max_tasks: 50 });
  const t1 = await db.getTaskById(TARGET);
  return {
    ok: true,
    claim,
    charge_http: charge.http,
    dispatch_http: dispatch.http,
    poll_http: poll.http,
    charge_summary: {
      charged: charge.json?.charged,
      failed: charge.json?.failed,
    },
    dispatch_summary: {
      ok: dispatch.json?.ok,
      failed: dispatch.json?.failed,
      candidates: dispatch.json?.candidates,
    },
    after: {
      status: t1?.status,
      stage: t1?.execution_stage,
      pid: t1?.provider_task_id,
      err: t1?.error_code || t1?.error_msg,
    },
  };
}

console.log(JSON.stringify({ start: true, TARGET, FC, MAX_SCAN, MAX_FAIL }, null, 2));

const cleanup = await cleanupAllJunkQueued();
console.log('cleanup', JSON.stringify(cleanup, null, 2));

// 清理后再看队列头部
const head = await db.listQueuedTasksForPromote({ maxTasks: 30, maxScanRows: 50000 });
const headPreview = (head.tasks || []).map((t, i) => ({
  i,
  taskId: t.taskId,
  userId: t.userId,
  junk: isJunkUser(t.userId),
}));
console.log('queue_head', JSON.stringify({ scanned: head.scanned, headPreview }, null, 2));

const promoted = await promoteTarget();
console.log('promote_target', JSON.stringify(promoted, null, 2));

// 若仍 queued，再跑一两轮 cleanup+claim
if (!promoted.ok || (promoted.after && !promoted.after.pid && promoted.after.status === 'queued')) {
  console.log('retry cleanup+claim…');
  const cleanup2 = await cleanupAllJunkQueued();
  console.log('cleanup2', JSON.stringify({ failed: cleanup2.failed, rounds: cleanup2.rounds }));
  const promoted2 = await promoteTarget();
  console.log('promote_target2', JSON.stringify(promoted2, null, 2));
}

const final = await db.getTaskById(TARGET);
const plat = await db.getPlatformConcurrencyPoolSnapshot();
const report = {
  target_final: {
    task_id: TARGET,
    status: final?.status,
    execution_stage: final?.execution_stage,
    provider_task_id: final?.provider_task_id,
    error_code: final?.error_code,
    error_msg: final?.error_msg,
    user_id: final?.user_id,
    model_id: final?.model_id,
  },
  platform: plat,
  cleanup_failed_count: cleanup.failed,
};
fs.writeFileSync(
  path.join(__dirname, 'cleanup-junk-queue-result.json'),
  JSON.stringify(report, null, 2),
);
console.log('FINAL', JSON.stringify(report, null, 2));
