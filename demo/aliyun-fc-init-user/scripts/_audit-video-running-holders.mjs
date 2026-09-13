/**
 * READ-ONLY: find video tasks that explain platform pool video.running
 * node scripts/_audit-video-running-holders.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import TableStore from 'tablestore';

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

const db = await import('../lib/db-tablestore.mjs');

function attrsToObj(attributes = []) {
  const o = {};
  for (const a of attributes || []) {
    if (!a) continue;
    const k = a.columnName || a.name;
    let v = a.columnValue ?? a.value;
    if (v && typeof v === 'object' && v.toNumber) v = v.toNumber();
    if (k) o[k] = v;
  }
  return o;
}

function pkTaskId(row) {
  const pk = row.primaryKey || [];
  for (const c of pk) {
    if (c.name === 'task_id' || c.task_id != null) return String(c.value ?? c.task_id ?? '');
  }
  return '';
}

const workRows = [];

// 1) Work helpers (read-only list APIs)
{
  const promote = await db.listTaskWorkForPromote({ maxTasks: 500, maxScanRows: 5000 });
  const expired = await db.listExpiredClaimedFromTaskWork({ maxTasks: 500, maxScanRows: 5000 });
  const charge = await db.listTaskWorkForCharge({ maxTasks: 500, maxScanRows: 5000 });
  workRows.push({
    promote_queued: promote?.tasks?.length ?? 0,
    expired_claimed: expired?.tasks?.length ?? 0,
    charge_candidates: charge?.taskIds?.length ?? 0,
    promote_sample: (promote?.tasks || []).slice(0, 10),
    expired_sample: (expired?.tasks || []).slice(0, 10),
    charge_sample: (charge?.taskIds || []).slice(0, 10),
  });
}

// 2) Scan nx_tasks lean for video claimed/running/platform_slot_held (readonly getRange via internal path)
// Use listQueued won't catch running. Use scan via getTask - implement lean range with exported getClient if any.
const TableStoreMod = TableStore;
const endpoint = String(process.env.OTS_ENDPOINT || '').trim();
const instance = String(process.env.OTS_INSTANCE || process.env.OTS_INST_NAME || '').trim();
const ak = String(process.env.OTS_ACCESS_KEY_ID || '').trim();
const sk = String(process.env.OTS_ACCESS_KEY_SECRET || '').trim();
const ots = new TableStoreMod.Client({
  accessKeyId: ak,
  secretAccessKey: sk,
  endpoint,
  instancename: instance,
});

function getRange(params) {
  return new Promise((resolve, reject) => {
    ots.getRange(params, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

const TASKS = (process.env.OTS_TABLE_TASKS || 'nx_tasks').toLowerCase();
const WORK = (process.env.OTS_TABLE_TASK_WORK || 'nx_task_work').toLowerCase();
const SLOTS = (process.env.OTS_TABLE_SLOT_RESERVATIONS || 'nx_slot_reservations').toLowerCase();
const COUNTERS = (process.env.OTS_TABLE_QUEUE_COUNTERS || 'nx_queue_counters').toLowerCase();

const leanCols = [
  'status',
  'task_type',
  'user_id',
  'model_id',
  'execution_stage',
  'provider_task_id',
  'platform_slot_held',
  'user_slot_held',
  'reservation_id',
  'claimed_at',
  'updated_at',
  'created_at',
  'lease_expires_at',
];

let nextStart = [{ task_id: TableStoreMod.INF_MIN }];
const endPK = [{ task_id: TableStoreMod.INF_MAX }];
let scanned = 0;
const maxScan = 80000;
const videoActive = [];
const videoSlotHeld = [];

while (scanned < maxScan) {
  const res = await getRange({
    tableName: TASKS,
    direction: TableStoreMod.Direction.FORWARD,
    inclusiveStartPrimaryKey: nextStart,
    exclusiveEndPrimaryKey: endPK,
    limit: 500,
    columnToGet: leanCols,
  });
  for (const row of res.rows || []) {
    scanned += 1;
    const tid = pkTaskId(row);
    const a = attrsToObj(row.attributes);
    const st = String(a.status || '').toLowerCase();
    const tt = String(a.task_type || '').toLowerCase();
    const slot = String(a.platform_slot_held || '0') === '1' || a.platform_slot_held === 1;
    if (tt !== 'video' && tt !== 'image' && tt !== 'audio') continue;
    if (st === 'claimed' || st === 'running' || st === 'pending' || st === 'processing') {
      const rec = {
        task_id: tid,
        status: st,
        task_type: tt,
        model_id: a.model_id,
        execution_stage: a.execution_stage,
        provider_task_id: a.provider_task_id,
        platform_slot_held: slot,
        user_slot_held: String(a.user_slot_held || '0'),
        reservation_id: a.reservation_id,
        updated_at: a.updated_at,
        created_at: a.created_at,
      };
      if (tt === 'video') videoActive.push(rec);
      if (slot && tt === 'video') videoSlotHeld.push(rec);
    } else if (slot && tt === 'video') {
      // terminal but still holding flag — leak
      videoSlotHeld.push({
        task_id: tid,
        status: st,
        task_type: tt,
        model_id: a.model_id,
        execution_stage: a.execution_stage,
        provider_task_id: a.provider_task_id,
        platform_slot_held: true,
        reservation_id: a.reservation_id,
        note: 'NON_ACTIVE_BUT_SLOT_HELD',
        updated_at: a.updated_at,
      });
    }
  }
  const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
  if (!nextPk) break;
  // convert next pk
  const shorthand = [];
  for (const c of nextPk) {
    const name = c.name || Object.keys(c).find((k) => k !== 'value');
    const value = c.value !== undefined ? c.value : c[name];
    shorthand.push({ [name]: value });
  }
  nextStart = shorthand.length ? shorthand : nextPk;
}

// work table full scan sample
const workAll = [];
{
  let ns = [{ task_id: TableStoreMod.INF_MIN }];
  let sc = 0;
  while (sc < 5000) {
    const res = await getRange({
      tableName: WORK,
      direction: TableStoreMod.Direction.FORWARD,
      inclusiveStartPrimaryKey: ns,
      exclusiveEndPrimaryKey: endPK,
      limit: 500,
    });
    for (const row of res.rows || []) {
      sc += 1;
      const tid = pkTaskId(row);
      const a = attrsToObj(row.attributes);
      workAll.push({
        task_id: tid,
        status: a.status,
        task_type: a.task_type,
        model_id: a.model_id,
        execution_stage: a.execution_stage,
        provider_task_id: a.provider_task_id,
      });
    }
    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    if (!nextPk) break;
    const shorthand = [];
    for (const c of nextPk) {
      const name = c.name || Object.keys(c).find((k) => k !== 'value');
      const value = c.value !== undefined ? c.value : c[name];
      shorthand.push({ [name]: value });
    }
    ns = shorthand.length ? shorthand : nextPk;
  }
}

// counter raw row
let counterRow = null;
{
  const res = await new Promise((resolve, reject) => {
    ots.getRow(
      {
        tableName: COUNTERS,
        primaryKey: [{ pool_id: 'video' }],
      },
      (err, data) => (err ? reject(err) : resolve(data)),
    );
  });
  counterRow = attrsToObj(res.row?.attributes || []);
}

// For each slot-held / active video task: check work presence
const traced = [];
for (const t of [...videoSlotHeld, ...videoActive.filter((x) => !videoSlotHeld.find((y) => y.task_id === x.task_id))]) {
  const inWork = workAll.find((w) => w.task_id === t.task_id) || null;
  let workGet = null;
  try {
    workGet = typeof db.getTaskWork === 'function' ? await db.getTaskWork(t.task_id) : null;
  } catch (e) {
    workGet = { error: e.message || String(e) };
  }
  let full = null;
  try {
    full = await db.getTaskById(t.task_id);
  } catch (e) {
    full = { error: e.message || String(e) };
  }
  traced.push({
    ...t,
    in_work_scan: Boolean(inWork),
    work_get: workGet,
    full_status: full?.status,
    full_stage: full?.execution_stage,
    full_platform_slot_held: full?.platform_slot_held,
  });
}

console.log(
  JSON.stringify(
    {
      counter_video_raw: counterRow,
      tasks_scanned: scanned,
      video_active_count: videoActive.length,
      video_platform_slot_held_count: videoSlotHeld.length,
      video_active: videoActive.slice(0, 50),
      video_platform_slot_held: videoSlotHeld.slice(0, 50),
      work_table_rows: workAll.length,
      work_table_sample: workAll.slice(0, 20),
      work_helpers: workRows,
      traced_holders: traced,
      note: 'readonly lean scan; if scanned hit maxScan table may be larger',
      hit_scan_cap: scanned >= maxScan,
    },
    null,
    2,
  ),
);
