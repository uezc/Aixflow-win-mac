/**
 * READ-ONLY SLS query with official SDK for Sep 8 window.
 * node scripts/_sls-sdk-query-sep8.mjs
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

const config = new OpenApi.Config({
  accessKeyId: ak,
  accessKeySecret: sk,
  endpoint: 'cn-hongkong.log.aliyuncs.com',
});
config.readTimeout = 60000;
const client = new Sls.default(config);
const runtime = new Util.RuntimeOptions({ readTimeout: 60000 });
const headers = {};

async function hist(fromIso, toIso, query) {
  const from = Math.floor(Date.parse(fromIso) / 1000);
  const to = Math.floor(Date.parse(toIso) / 1000);
  try {
    const req = new Sls.GetHistogramsRequest({ from, to, query });
    const resp = await client.getHistogramsWithOptions(project, logstore, req, headers, runtime);
    const body = resp.body;
    let total = 0;
    if (Array.isArray(body)) {
      for (const b of body) total += Number(b.count || b.Count || 0);
    }
    return {
      ok: true,
      total_from_body: total,
      x_log_count: resp.headers?.['x-log-count'] || resp.headers?.['X-Log-Count'],
      body_len: Array.isArray(body) ? body.length : typeof body,
      sample: JSON.stringify(body).slice(0, 400),
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 500) };
  }
}

async function logs(fromIso, toIso, query, line = 20) {
  const from = Math.floor(Date.parse(fromIso) / 1000);
  const to = Math.floor(Date.parse(toIso) / 1000);
  try {
    const req = new Sls.GetLogsRequest({
      from,
      to,
      query,
      line,
      offset: 0,
      reverse: false,
    });
    const resp = await client.getLogsWithOptions(project, logstore, req, headers, runtime);
    const body = resp.body;
    const rows = Array.isArray(body) ? body : [];
    const messages = rows.slice(0, 5).map((r) => {
      const m = r.message || r.MESSAGE || r.content || r;
      return typeof m === 'string' ? m.slice(0, 300) : JSON.stringify(m).slice(0, 300);
    });
    return {
      ok: true,
      returned: rows.length,
      x_log_count: resp.headers?.['x-log-count'] || resp.headers?.['X-Log-Count'],
      messages,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 500) };
  }
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

const queries = {
  all: '*',
  timer: '"timer:run-queue-pipeline"',
  idle: 'idle_no_patrol OR idle_zero_patrol OR idle_short_circuit',
  fallback: '"fallback nx_tasks"',
  admin_dash: 'admin-dashboard-stats',
  admin_fail: 'admin-failed-tasks',
  admin_profit: 'admin-profit',
  tasks_status: 'tasks/status OR "/tasks/status"',
  cleanup: 'cleanup-ots OR runOtsRetentionCleanup OR retention',
};

const out = { project, logstore, windows: {} };
for (const [label, a, b] of windows) {
  out.windows[label] = { hist: {}, samples: {} };
  for (const [name, q] of Object.entries(queries)) {
    out.windows[label].hist[name] = await hist(a, b, q);
  }
  out.windows[label].samples.timer = await logs(a, b, '"timer:run-queue-pipeline"', 10);
  out.windows[label].samples.idle = await logs(a, b, 'idle_no_patrol OR idle_zero_patrol', 5);
  out.windows[label].samples.fallback = await logs(a, b, '"fallback nx_tasks"', 5);
  out.windows[label].samples.admin = await logs(a, b, 'admin-dashboard-stats OR admin-failed-tasks', 5);
  out.windows[label].samples.any = await logs(a, b, '*', 3);
}

console.log(JSON.stringify(out, null, 2));
