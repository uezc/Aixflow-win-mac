/**
 * READ-ONLY: dig reservations + zombie running task for video.running drift
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
const ots = new TableStore.Client({
  accessKeyId: String(process.env.OTS_ACCESS_KEY_ID || '').trim(),
  secretAccessKey: String(process.env.OTS_ACCESS_KEY_SECRET || '').trim(),
  endpoint: String(process.env.OTS_ENDPOINT || '').trim(),
  instancename: String(process.env.OTS_INSTANCE || process.env.OTS_INST_NAME || '').trim(),
});

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

const SLOTS = (process.env.OTS_TABLE_SLOT_RESERVATIONS || 'nx_slot_reservations').toLowerCase();
const ids = [
  'eee77543-9df5-4c82-9556-3bb654c5c4bb',
  '5ab09eb3-ca0c-4c87-8132-80b27a3d6f77',
  '66fa0126-48cd-46ef-baee-64c5df215fa3',
  '6a7295a2-1ce1-4f39-8f17-fd2d28e10b0d',
  '708217d5-1bd3-4b49-9560-9de57d9f75f0',
  '7f3eea30-e856-46fc-b211-98ab8217e6c4',
  '9519ff5c-8c76-46aa-bf30-726c3583e2ac',
  'e5e4fd68-a976-4141-9265-547628906fb8',
];

const tasks = [];
for (const id of ids) {
  const t = await db.getTaskById(id);
  tasks.push(
    t
      ? {
          task_id: id,
          status: t.status,
          task_type: t.task_type,
          model_id: t.model_id,
          platform_slot_held: t.platform_slot_held,
          user_slot_held: t.user_slot_held,
          reservation_id: t.reservation_id,
          provider_task_id: t.provider_task_id,
          execution_stage: t.execution_stage,
          error_msg: t.error_msg,
          error_code: t.error_code,
          created_at: t.created_at,
          updated_at: t.updated_at,
          finished_at: t.finished_at,
          claimed_at: t.claimed_at,
          running_at: t.running_at,
          charge_id: t.charge_id,
        }
      : { task_id: id, missing: true },
  );
}

const reservations = [];
for (const t of tasks) {
  const rid = String(t.reservation_id || '').trim();
  if (!rid) continue;
  const res = await new Promise((resolve, reject) => {
    ots.getRow(
      { tableName: SLOTS, primaryKey: [{ reservation_id: rid }] },
      (err, data) => (err ? reject(err) : resolve(data)),
    );
  });
  const row = res.row;
  if (!row || !row.primaryKey) {
    reservations.push({ reservation_id: rid, task_id: t.task_id, exists: false });
  } else {
    reservations.push({
      reservation_id: rid,
      task_id: t.task_id,
      exists: true,
      ...attrsToObj(row.attributes),
    });
  }
}

// scan reservations with platform_slot_held==1 (cap)
function getRange(params) {
  return new Promise((resolve, reject) => {
    ots.getRange(params, (err, data) => (err ? reject(err) : resolve(data)));
  });
}
const heldRes = [];
let ns = [{ reservation_id: TableStore.INF_MIN }];
const endPK = [{ reservation_id: TableStore.INF_MAX }];
let scanned = 0;
while (scanned < 20000) {
  const res = await getRange({
    tableName: SLOTS,
    direction: TableStore.Direction.FORWARD,
    inclusiveStartPrimaryKey: ns,
    exclusiveEndPrimaryKey: endPK,
    limit: 500,
  });
  for (const row of res.rows || []) {
    scanned += 1;
    const a = attrsToObj(row.attributes);
    const pk = row.primaryKey || [];
    let rid = '';
    for (const c of pk) {
      if (c.name === 'reservation_id') rid = String(c.value ?? '');
    }
    const ph = Number(a.platform_slot_held || 0) === 1 || String(a.platform_slot_held) === '1';
    if (ph) {
      heldRes.push({
        reservation_id: rid,
        task_id: a.task_id,
        user_id: a.user_id,
        task_type: a.task_type,
        status: a.status,
        platform_slot_held: a.platform_slot_held,
        user_slot_held: a.user_slot_held,
        updated_at: a.updated_at,
      });
    }
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

console.log(
  JSON.stringify(
    {
      tasks,
      reservations_for_tasks: reservations,
      reservations_platform_held_scan: { scanned, held_count: heldRes.length, held: heldRes.slice(0, 30) },
    },
    null,
    2,
  ),
);
