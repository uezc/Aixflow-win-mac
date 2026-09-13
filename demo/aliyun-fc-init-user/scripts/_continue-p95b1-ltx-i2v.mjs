/**
 * Continue/settle Phase 9.5-B-1 LTX I2V live task after network blip.
 * node scripts/_continue-p95b1-ltx-i2v.mjs [taskId]
 */
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

const require = createRequire(path.join(ROOT, 'package.json'));
const jwt = require('jsonwebtoken');
const TID = process.argv[2] || '268ccade-9492-44f6-8114-2ed666db670a';
const FC_BASE = (process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '').replace(/\/$/, '');
const FC_TOKEN = process.env.ALIYUN_FC_TOKEN || '';
const ADMIN_SECRET = process.env.ADMIN_SETTLE_SECRET || '';
const OUT = path.join(__dirname, 'phase9-5-b1-ltx-i2v-live-e2e-result.json');

async function fcInternal(name, body = {}) {
  const url = `${FC_BASE}/internal/${name}`;
  const headers = {
    'content-type': 'application/json',
    'x-nexflow-token': FC_TOKEN,
    'x-admin-settle-secret': ADMIN_SECRET,
  };
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text.slice(0, 200) };
      }
      return { status: res.status, json };
    } catch (e) {
      console.log(`fcInternal ${name} attempt ${attempt} fail: ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  throw new Error(`fcInternal ${name} failed`);
}

const db = await import('../lib/db-tablestore.mjs');

let t = await db.getTaskById(TID);
console.log('initial', {
  status: t?.status,
  pid: t?.provider_task_id,
  quoted: t?.quoted_cost,
  err: t?.error_code,
});

for (let i = 0; i < 40; i++) {
  await fcInternal('charge-claimed-tasks', { max_tasks: 50 });
  await fcInternal('dispatch-charged-tasks', { max_tasks: 50 });
  await fcInternal('poll-provider-tasks', { max_tasks: 50 });
  t = await db.getTaskById(TID);
  console.log(`r${i} status=${t?.status} pid=${t?.provider_task_id} url=${String(t?.result_oss_url || '').slice(0, 60)}`);
  const st = String(t?.status || '').toLowerCase();
  if (['success', 'failed', 'cancelled', 'timeout'].includes(st)) break;
  await new Promise((r) => setTimeout(r, 10000));
}

const fwd = JSON.parse(t?.provider_forward_json || '{}');
const charge = await db.getTaskCharge(TID);
const img = (fwd.body?.nodeInfoList || []).find((n) => String(n.nodeId) === '584');
const report = {
  continued_at: new Date().toISOString(),
  task_id: TID,
  status: t?.status,
  provider_task_id: t?.provider_task_id,
  quoted_cost: t?.quoted_cost,
  charge,
  rhRegion: fwd.rhRegion,
  path: fwd.path,
  billingModelId: fwd.billingModelId,
  image: img?.fieldValue,
  result_url: t?.result_oss_url,
  user_slot_held: t?.user_slot_held,
  platform_slot_held: t?.platform_slot_held,
  error_code: t?.error_code,
};
let prev = {};
try {
  prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
} catch (_) {}
const merged = {
  ...prev,
  continue: report,
  ltx_i2v_e2e: {
    aixflow_task_id: TID,
    runninghub_task_id: t?.provider_task_id,
    submit_region: fwd.rhRegion,
    poll_region: fwd.rhRegion,
    billing_sku: fwd.billingModelId,
    quoted_cost: t?.quoted_cost,
    actual_charge: charge?.amount,
    charge_status: charge?.status,
    charge_count: String(charge?.status || '').toLowerCase() === 'charged' ? 1 : 0,
    refund_count: String(charge?.status || '').toLowerCase() === 'refunded' ? 1 : 0,
    final_status: t?.status,
    result_url: t?.result_oss_url,
    user_slot_held: t?.user_slot_held,
    platform_slot_held: t?.platform_slot_held,
    image_url: img?.fieldValue,
  },
  conclusion:
    String(t?.status).toLowerCase() === 'success' &&
    String(charge?.status).toLowerCase() === 'charged' &&
    fwd.rhRegion === 'cn' &&
    !!t?.result_oss_url
      ? 'PASS_MAIN_PENDING_REGRESSION'
      : 'NEEDS_FIX',
  finished_at: new Date().toISOString(),
};
fs.writeFileSync(OUT, JSON.stringify(merged, null, 2));
console.log(JSON.stringify(merged.ltx_i2v_e2e, null, 2));
console.log('conclusion=', merged.conclusion);
process.exit(merged.conclusion.startsWith('PASS') ? 0 : 1);
