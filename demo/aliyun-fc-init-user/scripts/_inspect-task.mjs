/**
 * Inspect one task + work row.
 * Usage: node scripts/_inspect-task.mjs <taskId>
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '../..');
const taskId = String(process.argv[2] || '').trim();
if (!taskId) {
  console.error('usage: node scripts/_inspect-task.mjs <taskId>');
  process.exit(1);
}

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

const db = await import('../lib/db-tablestore.mjs');
const task = typeof db.getTaskById === 'function' ? await db.getTaskById(taskId) : null;
const work = typeof db.getTaskWork === 'function' ? await db.getTaskWork(taskId) : null;
const charge =
  typeof db.getTaskCharge === 'function'
    ? await db.getTaskCharge(taskId).catch(() => null)
    : null;

const pick = (o, keys) => {
  if (!o) return null;
  const out = {};
  for (const k of keys) {
    if (o[k] != null && o[k] !== '') out[k] = o[k];
  }
  return out;
};

console.log(
  JSON.stringify(
    {
      task_id: taskId,
      task: pick(task, [
        'task_id',
        'user_id',
        'status',
        'task_type',
        'model_id',
        'execution_stage',
        'quoted_cost',
        'cost',
        'amount',
        'provider_task_id',
        'queue_entered_at',
        'claimed_at',
        'created_at',
        'updated_at',
        'error_code',
        'error_msg',
        'result_oss_url',
        'image_url',
      ]),
      work,
      charge: charge
        ? pick(charge, ['task_id', 'status', 'amount', 'operation_id', 'created_at'])
        : null,
    },
    null,
    2,
  ),
);
