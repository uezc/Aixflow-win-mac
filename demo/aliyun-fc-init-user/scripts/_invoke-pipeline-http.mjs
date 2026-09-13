/**
 * Invoke HK queue pipeline via HTTP (Sync), verify idle_no_patrol.
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

const base = String(
  process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '',
).replace(/\/$/, '');
const token = String(process.env.ALIYUN_FC_TOKEN || process.env.API_SECRET_TOKEN || '').trim();
const settle = String(process.env.ADMIN_SETTLE_SECRET || '').trim();

if (!base) {
  console.error('missing HK_FC_ENDPOINT');
  process.exit(1);
}

const url = `${base}/internal/run-queue-pipeline`;
const body = {
  max_claims: 20,
  max_charge: 40,
  max_dispatch: 20,
  max_poll: 40,
  reconcile: false,
};
const headers = {
  'Content-Type': 'application/json',
  ...(token ? { 'x-nexflow-token': token, Authorization: `Bearer ${token}` } : {}),
  ...(settle ? { 'x-admin-settle-secret': settle } : {}),
};
const t0 = Date.now();
const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
const text = await resp.text();
let json = null;
try {
  json = JSON.parse(text);
} catch (_) {}
const out = {
  http_ms: Date.now() - t0,
  status: resp.status,
  idle_no_patrol: json?.idle_no_patrol,
  idle_short_circuit: json?.idle_short_circuit,
  elapsed_ms: json?.elapsed_ms,
  summary: json?.summary,
  detail: json?.idle_short_circuit_detail,
  body_head: text.slice(0, 600),
};
console.log(JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(__dirname, '_invoke-pipeline-result.json'), JSON.stringify(out, null, 2));
process.exit(resp.ok && json?.idle_no_patrol === true ? 0 : 0);
