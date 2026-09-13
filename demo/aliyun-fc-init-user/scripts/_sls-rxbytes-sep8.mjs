/**
 * Pull instance metrics rxTotalBytes samples per hour from SLS.
 * node scripts/_sls-rxbytes-sep8.mjs
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
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
const require = createRequire(path.join(ROOT, 'package.json'));
const Sls = require('@alicloud/sls20201230');
const OpenApi = require('@alicloud/openapi-client');
const Util = require('@alicloud/tea-util');
const ak = process.env.OTS_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_ID;
const sk = process.env.OTS_ACCESS_KEY_SECRET || process.env.OSS_ACCESS_KEY_SECRET;
const project = 'serverless-cn-hongkong-19bf0789-a97c-5b1d-953a-7c77f8773286';
const logstore = 'default-logs';
const client = new Sls.default(
  new OpenApi.Config({ accessKeyId: ak, accessKeySecret: sk, endpoint: 'cn-hongkong.log.aliyuncs.com' }),
);
const runtime = new Util.RuntimeOptions({ readTimeout: 60000 });

async function fetchAll(fromIso, toIso, query) {
  const from = Math.floor(Date.parse(fromIso) / 1000);
  const to = Math.floor(Date.parse(toIso) / 1000);
  const all = [];
  let offset = 0;
  for (let i = 0; i < 50; i++) {
    const req = new Sls.GetLogsRequest({ from, to, query, line: 100, offset, reverse: false });
    const resp = await client.getLogsWithOptions(project, logstore, req, {}, runtime);
    const rows = Array.isArray(resp.body) ? resp.body : [];
    all.push(...rows);
    if (rows.length < 100) break;
    offset += rows.length;
  }
  return all;
}

function parseRx(row) {
  const raw = row.message || row.content || row;
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  if (obj.rxTotalBytes == null && obj.operation !== 'CollectInstanceMetrics') return null;
  return {
    rx: Number(obj.rxTotalBytes || 0),
    tx: Number(obj.txTotalBytes || 0),
    period: Number(obj.aggPeriodSeconds || 0),
    instanceID: obj.instanceID,
  };
}

const windows = [
  ['17-18', '2026-09-08T09:00:00Z', '2026-09-08T10:00:00Z'],
  ['18-19', '2026-09-08T10:00:00Z', '2026-09-08T11:00:00Z'],
  ['19a', '2026-09-08T11:00:00Z', '2026-09-08T11:13:49Z'],
  ['19b', '2026-09-08T11:13:49Z', '2026-09-08T12:00:00Z'],
  ['20-21', '2026-09-08T12:00:00Z', '2026-09-08T13:00:00Z'],
  ['21-22', '2026-09-08T13:00:00Z', '2026-09-08T14:00:00Z'],
  ['22-23', '2026-09-08T14:00:00Z', '2026-09-08T15:00:00Z'],
];

const out = {};
for (const [label, a, b] of windows) {
  const rows = await fetchAll(a, b, 'rxTotalBytes OR CollectInstanceMetrics');
  const parsed = rows.map(parseRx).filter(Boolean);
  const rxSum = parsed.reduce((s, x) => s + x.rx, 0);
  const txSum = parsed.reduce((s, x) => s + x.tx, 0);
  const maxRx = parsed.reduce((m, x) => Math.max(m, x.rx), 0);
  out[label] = {
    metric_rows: parsed.length,
    rx_sum_bytes: rxSum,
    rx_sum_GB: +(rxSum / 1e9).toFixed(3),
    tx_sum_bytes: txSum,
    tx_sum_GB: +(txSum / 1e9).toFixed(3),
    max_single_period_rx_MB: +(maxRx / 1e6).toFixed(1),
    note: 'FC instance network RX over metric periods; OTS GetRange downlink is primary contributor when Timer scans fat rows',
  };
}
console.log(JSON.stringify(out, null, 2));
