/**
 * SLS: 22-23 CST all FC invocation durations + HTTP path counts (read-only).
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
const client = new Sls.default(
  new OpenApi.Config({
    accessKeyId: process.env.OTS_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OTS_ACCESS_KEY_SECRET || process.env.OSS_ACCESS_KEY_SECRET,
    endpoint: 'cn-hongkong.log.aliyuncs.com',
  }),
);
const runtime = new Util.RuntimeOptions({ readTimeout: 60000 });
const project = 'serverless-cn-hongkong-19bf0789-a97c-5b1d-953a-7c77f8773286';
const logstore = 'default-logs';

async function fetchAll(fromIso, toIso, query) {
  const from = Math.floor(Date.parse(fromIso) / 1000);
  const to = Math.floor(Date.parse(toIso) / 1000);
  const all = [];
  let offset = 0;
  for (;;) {
    const req = new Sls.GetLogsRequest({ from, to, query, line: 100, offset, reverse: false });
    const resp = await client.getLogsWithOptions(project, logstore, req, {}, runtime);
    const rows = Array.isArray(resp.body) ? resp.body : [];
    all.push(...rows);
    if (rows.length < 100) break;
    offset += rows.length;
    if (offset > 5000) break;
  }
  return all;
}

const windows = {
  '22-23': ['2026-09-08T14:00:00Z', '2026-09-08T15:00:00Z'],
  '21-22': ['2026-09-08T13:00:00Z', '2026-09-08T14:00:00Z'],
  '17-18': ['2026-09-08T09:00:00Z', '2026-09-08T10:00:00Z'],
};

const out = {};
for (const [label, [a, b]] of Object.entries(windows)) {
  const timers = await fetchAll(a, b, '"timer:run-queue-pipeline"');
  const ms = timers
    .map((r) => Number(String(r.message || '').match(/ms=(\d+)/)?.[1]))
    .filter((n) => Number.isFinite(n));
  const long = timers.filter((r) => /ms=(\d+)/.test(r.message || '') && Number(RegExp.$1) > 5000);
  const queries = {
    admin_dash: '"admin-dashboard-stats"',
    admin_fail: '"admin-failed-tasks"',
    admin_profit: '"admin-profit-analytics"',
    tasks_status: '"/tasks/status"',
    tasks_create: '"/tasks/create"',
    cleanup: 'cleanup-ots-retention',
    fallback: 'fallback',
    idle_no: 'idle_no_patrol OR idle_zero_patrol OR idle_short_circuit',
    GetRange_log: 'GetRange',
    nx_tasks: 'nx_tasks',
    promote: 'runPromote OR promote',
  };
  const counts = {};
  for (const [k, q] of Object.entries(queries)) {
    const rows = await fetchAll(a, b, q);
    counts[k] = rows.length;
  }
  // duration distribution of ALL info lines with ms=
  const anyMs = await fetchAll(a, b, 'ms=');
  const allMs = anyMs
    .map((r) => Number(String(r.message || '').match(/ms=(\d+)/)?.[1]))
    .filter((n) => Number.isFinite(n));
  out[label] = {
    timer_count: ms.length,
    timer_avg: ms.length ? Math.round(ms.reduce((x, y) => x + y, 0) / ms.length) : null,
    timer_max: ms.length ? Math.max(...ms) : null,
    timer_gt5s: ms.filter((x) => x > 5000).length,
    keyword_counts: counts,
    any_ms_lines: allMs.length,
    any_ms_max: allMs.length ? Math.max(...allMs) : null,
    any_ms_gt5s: allMs.filter((x) => x > 5000).length,
    sample_long: long.slice(0, 3).map((r) => String(r.message || '').slice(0, 200)),
  };
}
console.log(JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(__dirname, '_sls-22-deep-result.json'), JSON.stringify(out, null, 2));
