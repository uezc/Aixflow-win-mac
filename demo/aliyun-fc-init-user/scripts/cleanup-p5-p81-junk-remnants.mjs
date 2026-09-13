/**
 * 分析 + 清理压测残骸（user 前缀 __p5 / __p81 / __p9 等）。
 * claimed / queued / running 一并处理。
 * Usage: node scripts/cleanup-p5-p81-junk-remnants.mjs [--apply]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '../..');
const APPLY = process.argv.includes('--apply');

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

const JUNK_PREFIXES = ['__p5', '__p81', '__p9', '__p815', '__test', '__live', '__phase'];
function isJunkUser(uid) {
  const u = String(uid || '').trim();
  if (!u || u.startsWith('nx_')) return false;
  return JUNK_PREFIXES.some((p) => u.startsWith(p));
}
function held(v) {
  return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
}

const db = await import('../lib/db-tablestore.mjs');
const { getClaimLeaseMs, getReservationOrphanMs } = await import('../lib/queueScheduler.mjs');

const now = Date.now();
const leaseMs = getClaimLeaseMs();
const orphanMs = getReservationOrphanMs();
const platBefore = await db.getPlatformConcurrencyPoolSnapshot();

const analysis = {
  now,
  lease_ms: leaseMs,
  orphan_ms: orphanMs,
  platform_before: platBefore,
  samples: [],
  counts: {
    queued_junk: 0,
    claimed_junk: 0,
    running_junk: 0,
    claimed_lease_expired: 0,
    claimed_lease_active: 0,
    claimed_slots_held: 0,
    claimed_with_charge: 0,
    claimed_with_provider: 0,
  },
  root_cause_notes: [],
};

// Scan via listQueued + listExpiredClaimed + full-ish promote scan patterns
const queued = await db.listQueuedTasksForPromote({ maxTasks: 2000, maxScanRows: 100000 });
for (const t of queued.tasks || []) {
  if (!isJunkUser(t.userId)) continue;
  analysis.counts.queued_junk += 1;
}

const expired = await db.listExpiredClaimedTasks({ maxTasks: 500, maxScanRows: 100000, nowMs: now });
const expiredJunkIds = (expired.tasks || []).filter((t) => isJunkUser(t.userId)).map((t) => t.taskId);

// Also pull recently known claimed junk by scanning expired + attempting get on promote candidates' siblings:
// Broader: scan claimed by recovering list with future now trick won't work.
// Use expired list + also scan with nowMs far future to get ALL claimed with any lease.
const allClaimedLike = await db.listExpiredClaimedTasks({
  maxTasks: 500,
  maxScanRows: 100000,
  nowMs: now + 365 * 24 * 3600 * 1000,
});
const activeJunk = [];
const seen = new Set();
for (const c of allClaimedLike.tasks || []) {
  if (!isJunkUser(c.userId)) continue;
  if (seen.has(c.taskId)) continue;
  seen.add(c.taskId);
  const full = await db.getTaskById(c.taskId);
  if (!full) continue;
  const st = String(full.status || '').toLowerCase();
  if (!['claimed', 'running', 'processing'].includes(st)) continue;
  if (st === 'claimed') analysis.counts.claimed_junk += 1;
  if (st === 'running') analysis.counts.running_junk += 1;
  const leaseExp = Number(full.lease_expires_at || 0);
  const expiredLease = leaseExp > 0 && leaseExp <= now;
  if (expiredLease) analysis.counts.claimed_lease_expired += 1;
  else if (leaseExp > now) analysis.counts.claimed_lease_active += 1;
  if (held(full.user_slot_held) || held(full.platform_slot_held)) {
    analysis.counts.claimed_slots_held += 1;
  }
  if (String(full.charge_id || '').trim() || Number(full.cost || 0) > 0) {
    analysis.counts.claimed_with_charge += 1;
  }
  if (String(full.provider_task_id || '').trim()) {
    analysis.counts.claimed_with_provider += 1;
  }
  activeJunk.push(full);
  if (analysis.samples.length < 25) {
    analysis.samples.push({
      task_id: full.task_id,
      user_id: full.user_id,
      status: full.status,
      stage: full.execution_stage,
      lease_expires_at: leaseExp,
      lease_expired: expiredLease,
      user_slot_held: full.user_slot_held,
      platform_slot_held: full.platform_slot_held,
      provider_task_id: full.provider_task_id || '',
      charge_id: full.charge_id || '',
      model_id: full.model_id,
    });
  }
}

// 补充：lease_expires_at=0 的 claimed 不会进 listExpiredClaimedTasks，直接 range 扫
{
  const TableStorePkg = (await import('tablestore')).default;
  const endpoint = process.env.OTS_ENDPOINT;
  const accessKeyId = process.env.OTS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OTS_ACCESS_KEY_SECRET;
  const instanceName = process.env.OTS_INSTANCE;
  const table = process.env.OTS_TABLE_TASKS || 'nx_tasks';
  if (endpoint && accessKeyId && accessKeySecret && instanceName) {
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
    while (scanned < 80000 && activeJunk.length < 800) {
      const res = await getRange({
        tableName: table,
        direction: TableStorePkg.Direction.FORWARD,
        inclusiveStartPrimaryKey: nextStart,
        exclusiveEndPrimaryKey: endPK,
        limit: 500,
      });
      for (const row of res.rows || []) {
        scanned += 1;
        const obj = {};
        for (const a of row.attributes || []) {
          if (a.columnName) obj[a.columnName] = a.columnValue;
          else {
            const k = Object.keys(a).find((x) => x !== 'timestamp');
            if (k) obj[k] = a[k];
          }
        }
        const uid = String(obj.user_id || '').trim();
        if (!isJunkUser(uid)) continue;
        const st = String(obj.status || '').toLowerCase();
        if (!['claimed', 'running', 'processing', 'queued'].includes(st)) continue;
        let tid = '';
        for (const p of row.primaryKey || []) {
          if (p.task_id != null) tid = String(p.task_id);
          else if (p.name === 'task_id') tid = String(p.value);
          else {
            const k = Object.keys(p)[0];
            if (k === 'task_id') tid = String(p[k]);
          }
        }
        if (!tid || seen.has(tid)) continue;
        seen.add(tid);
        const full = await db.getTaskById(tid);
        if (!full) continue;
        if (['claimed', 'running', 'processing'].includes(String(full.status).toLowerCase())) {
          if (String(full.status).toLowerCase() === 'claimed') analysis.counts.claimed_junk += 1;
          if (String(full.status).toLowerCase() === 'running') analysis.counts.running_junk += 1;
          activeJunk.push(full);
        }
      }
      const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
      if (!nextPk) break;
      nextStart = Array.isArray(nextPk)
        ? nextPk.map((p) => {
            if (p.task_id != null) return { task_id: p.task_id };
            if (p.name === 'task_id') return { task_id: p.value };
            const k = Object.keys(p)[0];
            return { [k]: p[k] };
          })
        : null;
      if (!nextStart) break;
    }
    analysis.ots_extra_scanned = scanned;
  }
}

analysis.root_cause_notes = [
  'Claim lease 默认 NX_CLAIM_LEASE_MS=60s；无 cron 时 expired claimed 不会被 recover，槽位可持续占用直到有人调用 promote。',
  '压测脚本常 NX_SKIP_QUEUE_PIPELINE_ON_CREATE=1 且中途退出，留下 claimed/charged/无 forward 任务。',
  'promote 扫描按 PK 取前 N 个 queued；大量 junk queued 会饿死真实用户（已在先前事件验证）。',
  'lease recovery 在 runPromoteQueuedTasks 开头执行；无 cron = 无自动恢复。',
  'Reconcile orphan reservation 默认不在 promote 每分钟跑（reconcile=false）；需低频 RECONCILE=1。',
];

analysis.counts.expired_claimed_scan_junk = expiredJunkIds.length;
analysis.counts.active_claimed_running_junk = activeJunk.length;
analysis.counts.queued_junk_in_scan = analysis.counts.queued_junk;

const cleanup = { mode: APPLY ? 'APPLY' : 'DRY_RUN', failed: 0, skipped: 0, errors: [], released_slots: 0 };

async function failJunk(t) {
  const tid = t.task_id;
  const st = String(t.status || '').toLowerCase();
  if (['success', 'failed', 'cancelled'].includes(st)) {
    cleanup.skipped += 1;
    return;
  }
  if (String(t.charge_id || '').trim() && typeof db.refundTaskCharge === 'function') {
    try {
      await db.refundTaskCharge(tid);
    } catch (e) {
      /* no charge row ok */
    }
  }
  const snap = {
    user_slot_held: t.user_slot_held,
    platform_slot_held: t.platform_slot_held,
    task_type: t.task_type,
    user_id: t.user_id,
    reservation_id: t.reservation_id,
  };
  await db.upsertTask(tid, t.user_id, {
    status: 'failed',
    execution_stage: 'done',
    error_code: 'JUNK_TEST_QUEUE_CLEANUP',
    error_msg: 'p5/p81 loadtest remnant cancelled (queue stability P0)',
    user_slot_held: '0',
    platform_slot_held: '0',
    lease_owner: '',
    lease_expires_at: 0,
  });
  const tt = String(t.task_type || '').toLowerCase();
  if ((tt === 'video' || tt === 'image') && held(snap.platform_slot_held)) {
    try {
      await db.releasePlatformConcurrencySlot(tt);
      cleanup.released_slots += 1;
    } catch (_) {}
  }
  if ((tt === 'video' || tt === 'image') && held(snap.user_slot_held)) {
    try {
      await db.releaseUserConcurrencySlot(t.user_id, tt);
      cleanup.released_slots += 1;
    } catch (_) {}
  }
  cleanup.failed += 1;
}

// Also fail queued junk in batches
const queuedJunkIds = (queued.tasks || []).filter((t) => isJunkUser(t.userId)).map((t) => t.taskId);

if (APPLY) {
  for (const t of activeJunk) {
    try {
      await failJunk(t);
    } catch (e) {
      cleanup.errors.push({ task_id: t.task_id, err: String(e?.message || e) });
    }
  }
  for (const tid of queuedJunkIds) {
    try {
      const t = await db.getTaskById(tid);
      if (t) await failJunk(t);
    } catch (e) {
      cleanup.errors.push({ task_id: tid, err: String(e?.message || e) });
    }
  }
  // Extra rounds for queued junk beyond first window
  for (let r = 0; r < 30; r++) {
    const listed = await db.listQueuedTasksForPromote({ maxTasks: 400, maxScanRows: 80000 });
    const ids = (listed.tasks || []).filter((t) => isJunkUser(t.userId)).map((t) => t.taskId);
    if (!ids.length) break;
    for (const tid of ids) {
      const t = await db.getTaskById(tid);
      if (t) await failJunk(t);
    }
  }
}

const platAfter = await db.getPlatformConcurrencyPoolSnapshot();
const report = {
  analysis,
  cleanup,
  platform_after: platAfter,
  starvation_risk:
    analysis.counts.queued_junk > 50 || analysis.counts.claimed_slots_held > 0
      ? 'HIGH_IF_NO_CRON'
      : 'LOW_AFTER_CLEANUP',
};

fs.writeFileSync(
  path.join(__dirname, 'cleanup-p5-p81-junk-result.json'),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
