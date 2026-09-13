/**
 * READ-ONLY SLS GetLogs via OpenAPI (no new npm packages).
 * node scripts/_sls-query-sep8.mjs
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
const client = new OpenApi.default(config);
const runtime = new Util.RuntimeOptions({ readTimeout: 60000, connectTimeout: 20000 });

async function getLogs(fromIso, toIso, query, line = 100) {
  const from = Math.floor(Date.parse(fromIso) / 1000);
  const to = Math.floor(Date.parse(toIso) / 1000);
  const params = new OpenApi.Params({
    action: 'GetLogs',
    version: '0.6.0',
    protocol: 'HTTPS',
    method: 'GET',
    authType: 'AK',
    style: 'ROA',
    pathname: `/logstores/${encodeURIComponent(logstore)}`,
    reqBodyType: 'json',
    bodyType: 'json',
  });
  const request = new OpenApi.OpenApiRequest({
    headers: {
      'x-log-bodyrawsize': '0',
      'x-acs-project': project,
      Accept: 'application/json',
    },
    query: {
      type: 'log',
      from: String(from),
      to: String(to),
      query,
      line: String(line),
      offset: '0',
      reverse: 'false',
    },
  });
  try {
    const resp = await client.callApi(params, request, runtime);
    return { ok: true, statusCode: resp.statusCode, body: resp.body, headers: resp.headers };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 800), code: e?.code };
  }
}

async function getHistograms(fromIso, toIso, query) {
  const from = Math.floor(Date.parse(fromIso) / 1000);
  const to = Math.floor(Date.parse(toIso) / 1000);
  const params = new OpenApi.Params({
    action: 'GetHistograms',
    version: '0.6.0',
    protocol: 'HTTPS',
    method: 'GET',
    authType: 'AK',
    style: 'ROA',
    pathname: `/logstores/${encodeURIComponent(logstore)}/index`,
    reqBodyType: 'json',
    bodyType: 'json',
  });
  // Actually GetHistograms path is /logstores/{logstore}?type=histogram
  const params2 = new OpenApi.Params({
    action: 'GetHistograms',
    version: '0.6.0',
    protocol: 'HTTPS',
    method: 'GET',
    authType: 'AK',
    style: 'ROA',
    pathname: `/logstores/${encodeURIComponent(logstore)}`,
    reqBodyType: 'json',
    bodyType: 'json',
  });
  const request = new OpenApi.OpenApiRequest({
    headers: { 'x-log-bodyrawsize': '0', 'x-acs-project': project, Accept: 'application/json' },
    query: { type: 'histogram', from: String(from), to: String(to), query },
  });
  try {
    const resp = await client.callApi(params2, request, runtime);
    return { ok: true, statusCode: resp.statusCode, body: resp.body, headers: resp.headers };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 800) };
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

const queries = [
  '* and timer:run-queue-pipeline',
  '* and "timer:run-queue-pipeline"',
  '* and idle_no_patrol',
  '* and idle_zero_patrol',
  '* and "fallback nx_tasks"',
  '* and admin-dashboard-stats',
  '* and admin-failed-tasks',
  '* and "/tasks/status"',
  '* and tasks/status',
  '* and FunctionName',
  '*',
];

const out = { project, logstore, windows: {} };

// First: histogram of all logs per hour
for (const [label, a, b] of windows) {
  out.windows[label] = { histograms: {}, samples: {} };
  const h = await getHistograms(a, b, '*');
  out.windows[label].histograms['*'] = h.ok
    ? {
        ok: true,
        statusCode: h.statusCode,
        // SLS returns count in headers x-log-count often
        x_log_count: h.headers?.['x-log-count'] || h.headers?.['X-Log-Count'],
        x_log_count_precise: h.headers?.['x-log-count'] || null,
        body_preview: JSON.stringify(h.body).slice(0, 600),
        headers_keys: Object.keys(h.headers || {}).slice(0, 30),
      }
    : h;

  for (const q of [
    '* and "timer:run-queue-pipeline"',
    '* and idle_no_patrol',
    '* and "fallback nx_tasks"',
    '* and admin-dashboard-stats',
    '* and admin-failed-tasks',
    '* and "/tasks/status"',
  ]) {
    const hh = await getHistograms(a, b, q);
    out.windows[label].histograms[q] = hh.ok
      ? {
          ok: true,
          x_log_count: hh.headers?.['x-log-count'] || hh.headers?.['X-Log-Count'],
          body_preview: JSON.stringify(hh.body).slice(0, 300),
        }
      : hh;
  }

  // sample a few timer logs
  const sample = await getLogs(a, b, '* and "timer:run-queue-pipeline"', 5);
  out.windows[label].samples.timer = sample.ok
    ? {
        ok: true,
        x_log_count: sample.headers?.['x-log-count'] || sample.headers?.['X-Log-Count'],
        body_preview: JSON.stringify(sample.body).slice(0, 1200),
      }
    : sample;
}

console.log(JSON.stringify(out, null, 2));
