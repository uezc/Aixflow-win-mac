/**
 * 最小回归：OTS getRange 形态下 task_id 不得解析成字面量 "task_id"
 * + 可选：写入 claimed 任务后 runChargeClaimedTasks 能命中真实 UUID
 *
 * node scripts/test-charge-scan-task-id.mjs
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const p of [path.resolve(__dirname, '../../../.env'), path.resolve(__dirname, '../.env')]) {
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

const db = await import('../lib/db-tablestore.mjs');
const { taskIdFromTaskRow } = db;

/** 旧错误逻辑（复现 bug，禁止用于生产） */
function buggyTaskIdFromPk(pk) {
  const tid =
    (pk.find && pk.find((p) => p.task_id != null)?.task_id) ||
    (Array.isArray(pk) && pk[0] && (pk[0].task_id ?? Object.values(pk[0])[0])) ||
    '';
  return String(tid || '').trim();
}

const REAL = '893b137d-77e3-4024-b35f-6207cf8977fa';
const otsNameValueRow = {
  primaryKey: [{ name: 'task_id', value: REAL }],
  attributes: [{ columnName: 'status', columnValue: 'claimed' }],
};
const shorthandRow = {
  primaryKey: [{ task_id: REAL }],
  attributes: [],
};

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.log('[FAIL]', msg);
  } else {
    console.log('[PASS]', msg);
  }
}

const parsedNv = taskIdFromTaskRow(otsNameValueRow);
assert(parsedNv === REAL, `name/value shape → ${parsedNv}`);
assert(parsedNv !== 'task_id', 'name/value shape !== literal task_id');

const buggy = buggyTaskIdFromPk(otsNameValueRow.primaryKey);
assert(buggy === 'task_id', `buggy reproducer still yields literal (got ${buggy})`);

const parsedSh = taskIdFromTaskRow(shorthandRow);
assert(parsedSh === REAL, `shorthand shape → ${parsedSh}`);

// OTS 集成：写入 claimed 任务，扫描 charge 候选必须含真实 UUID
const PREFIX = `__p6scan_${Date.now().toString(36)}_`;
const userId = `${PREFIX}u`;
const taskId = crypto.randomUUID();

try {
  await db.createUserOtpOnly({ userId, email: `${userId}@scan.local` });
} catch (_) {}
await db.upsertTask(taskId, userId, {
  status: 'claimed',
  task_type: 'video',
  model_id: 'sora-2',
  quoted_cost: 15,
  execution_stage: '',
  user_slot_held: '0',
  platform_slot_held: '0',
});

const run = await db.runChargeClaimedTasks({ maxTasks: 50, maxScanRows: 50000 });
const ids = (run.results || []).map((r) => r.task_id);
assert(!ids.includes('task_id'), 'charge results must not contain literal task_id');
const hit = (run.results || []).some((r) => r.task_id === taskId);
assert(hit, `scan+charge must see real task_id ${taskId} (candidates=${run.candidates}, results=${ids.slice(0, 5).join(',')})`);

// 清理：标 failed，避免永久 claimed
await db.upsertTask(taskId, userId, { status: 'failed', execution_stage: 'error' });

if (failed) {
  console.error(`[charge-scan-task-id] FAILED=${failed}`);
  process.exit(1);
}
console.log('[charge-scan-task-id] ALL PASS');
process.exit(0);
