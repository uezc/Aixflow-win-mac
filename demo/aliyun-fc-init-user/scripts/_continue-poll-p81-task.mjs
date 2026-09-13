/**
 * Continue polling one already-dispatched Phase 8.1 live golden task (no code changes).
 * Usage: node scripts/_continue-poll-p81-task.mjs
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvFile(path.join(REPO, '.env'));
loadEnvFile(path.join(ROOT, '.env'));

const TASK = process.env.P81_TASK_ID || 'b8dc5a03-fe6e-446b-995d-dc1b16a41ea6';
const USER = process.env.P81_USER_ID || '__p81live_mtnt97ar_ok';
const FC = (process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '').replace(/\/$/, '');
const TOK = process.env.ALIYUN_FC_TOKEN || '';
const ADM = process.env.ADMIN_SETTLE_SECRET || '';

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
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

const db = await import('../lib/db-tablestore.mjs');
const stages = [];

for (let i = 0; i < 80; i++) {
  await fc('poll-provider-tasks', { max_tasks: 20 });
  const t = await db.getTaskById(TASK);
  const u = await db.getUserById(USER);
  const snap = await db.getUserConcurrencyCounterSnapshot(USER, 'video');
  const plat = await db.getPlatformConcurrencyPoolSnapshot();
  const row = {
    i,
    status: t?.status,
    stage: t?.execution_stage,
    pid: t?.provider_task_id,
    url: (t?.result_oss_url || '').slice(0, 120),
    bal: u?.balance,
    uocc: snap?.occupied,
    prun: plat?.video?.running,
    held: { u: t?.user_slot_held, p: t?.platform_slot_held },
  };
  stages.push(row);
  console.log(JSON.stringify(row));
  const st = String(t?.status || '').toLowerCase();
  if (st === 'success' || st === 'failed' || st === 'cancelled') {
    const out = {
      task_id: TASK,
      status: t.status,
      stage: t.execution_stage,
      provider_task_id: t.provider_task_id,
      result_url: t.result_oss_url || '',
      quoted_cost: t.quoted_cost,
      balance: u?.balance,
      user_occupied: snap?.occupied,
      platform_running: plat?.video?.running,
      slots_held: { u: t.user_slot_held, p: t.platform_slot_held },
      stages_tail: stages.slice(-5),
    };
    fs.writeFileSync(path.join(__dirname, 'phase8-1-continue-poll-result.json'), JSON.stringify(out, null, 2));
    console.log('TERMINAL', JSON.stringify(out));
    process.exit(st === 'success' ? 0 : 2);
  }
  await new Promise((r) => setTimeout(r, 15000));
}

console.log('TIMEOUT still non-terminal');
process.exit(3);
