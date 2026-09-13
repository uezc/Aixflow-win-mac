/**
 * 每分钟 Queue 全链路：POST /internal/run-queue-pipeline
 *   promote → charge → dispatch → poll
 *
 * 环境变量：
 *   ALIYUN_FC_INIT_USER_URL 或 HK_FC_ENDPOINT
 *   ADMIN_SETTLE_SECRET
 *
 * Windows 任务计划（每分钟）：
 *   schtasks /Create /TN "NEXFLOW-QueuePipeline" /SC MINUTE /MO 1 /TR "node D:\\NEXFLOW\\demo\\aliyun-fc-init-user\\scripts\\cron-queue-pipeline.mjs" /F
 *
 * 或 Linux cron：
 *   * * * * * cd /path/to/demo/aliyun-fc-init-user && set -a && . ../../.env && set +a && node scripts/cron-queue-pipeline.mjs
 *
 * 低频 reconcile（每 15 分钟建议）：
 *   RECONCILE=1 node scripts/cron-queue-pipeline.mjs
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

const urlBase = (
  process.env.HK_FC_ENDPOINT ||
  process.env.ALIYUN_FC_INIT_USER_URL ||
  ''
).trim();
if (!urlBase) {
  console.error('ALIYUN_FC_INIT_USER_URL or HK_FC_ENDPOINT required');
  process.exit(1);
}
const secret = (process.env.ADMIN_SETTLE_SECRET || '').trim();
if (!secret) {
  console.error('ADMIN_SETTLE_SECRET required');
  process.exit(1);
}
const nexflowToken = (process.env.ALIYUN_FC_TOKEN || process.env.NEXFLOW_FC_TOKEN || '').trim();

const reconcile =
  process.env.RECONCILE === '1' || String(process.env.RECONCILE || '').toLowerCase() === 'true';

const url = `${urlBase.replace(/\/$/, '')}/internal/run-queue-pipeline`;
const body = {
  max_claims: parseInt(process.env.NX_PROMOTE_BATCH_SIZE || '20', 10) || 20,
  max_charge: parseInt(process.env.NX_CHARGE_BATCH_SIZE || '40', 10) || 40,
  max_dispatch: parseInt(process.env.NX_DISPATCH_BATCH_SIZE || '20', 10) || 20,
  max_poll: parseInt(process.env.NX_POLL_BATCH_SIZE || '40', 10) || 40,
  max_lease_recover: parseInt(process.env.NX_PROMOTE_MAX_LEASE || '50', 10) || 50,
  reconcile,
};

const headers = {
  'content-type': 'application/json',
  'x-admin-settle-secret': secret,
};
if (nexflowToken) headers['x-nexflow-token'] = nexflowToken;

const res = await fetch(url, {
  method: 'POST',
  headers,
  body: JSON.stringify(body),
});
const text = await res.text();
let json = null;
try {
  json = JSON.parse(text);
} catch {
  json = { raw: text.slice(0, 1500) };
}
console.log(
  `[cron-queue-pipeline] http=${res.status} summary=${JSON.stringify(json?.summary || json)} elapsed=${json?.elapsed_ms ?? '?'}`,
);
if (!res.ok) process.exit(1);
