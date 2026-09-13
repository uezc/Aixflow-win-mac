/**
 * READ-ONLY: try FC + SLS + CMS for Sep 8 17-23 CST. No OTS table scans.
 * node scripts/_probe-fc-logs-sep8.mjs
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
const env = (k) => String(process.env[k] || '').trim();
const require = createRequire(path.join(ROOT, 'package.json'));

const HOURS = [
  ['17-18', '2026-09-08T09:00:00Z', '2026-09-08T10:00:00Z'],
  ['18-19', '2026-09-08T10:00:00Z', '2026-09-08T11:00:00Z'],
  ['19-20', '2026-09-08T11:00:00Z', '2026-09-08T12:00:00Z'],
  ['19:00-19:13', '2026-09-08T11:00:00Z', '2026-09-08T11:13:49Z'],
  ['19:13-20:00', '2026-09-08T11:13:49Z', '2026-09-08T12:00:00Z'],
  ['20-21', '2026-09-08T12:00:00Z', '2026-09-08T13:00:00Z'],
  ['21-22', '2026-09-08T13:00:00Z', '2026-09-08T14:00:00Z'],
  ['22-23', '2026-09-08T14:00:00Z', '2026-09-08T15:00:00Z'],
];

const out = {
  probed_at: new Date().toISOString(),
  fc_function: null,
  log_config: null,
  sls: null,
  cms: null,
  errors: [],
};

const ak = env('OTS_ACCESS_KEY_ID') || env('OSS_ACCESS_KEY_ID') || env('ALIBABA_CLOUD_ACCESS_KEY_ID');
const sk =
  env('OTS_ACCESS_KEY_SECRET') ||
  env('OSS_ACCESS_KEY_SECRET') ||
  env('ALIBABA_CLOUD_ACCESS_KEY_SECRET');

async function getFcLogConfig() {
  const Fc20230330 = require('@alicloud/fc20230330');
  const OpenApi = require('@alicloud/openapi-client');
  const Util = require('@alicloud/tea-util');
  const region = env('FC_REGION_HK') || 'cn-hongkong';
  const fn = env('FC_FUNCTION_NAME_HK') || env('FC_FUNCTION_NAME') || 'nexflow-api';
  const config = new OpenApi.Config({
    accessKeyId: ak,
    accessKeySecret: sk,
    endpoint: `fcv3.${region}.aliyuncs.com`,
  });
  config.readTimeout = 60000;
  const client = new Fc20230330.default(config);
  const runtime = new Util.RuntimeOptions({ readTimeout: 60000 });
  const resp = await client.getFunctionWithOptions(fn, new Fc20230330.GetFunctionRequest({}), {}, runtime);
  const body = resp?.body || {};
  out.fc_function = {
    region,
    functionName: fn,
    lastModifiedTime: body.lastModifiedTime || body.LastModifiedTime,
    codeChecksum: body.codeChecksum || body.CodeChecksum,
    logConfig: body.logConfig || body.LogConfig || null,
    role: body.role || body.Role || null,
  };
  out.log_config = out.fc_function.logConfig;
  return out.fc_function;
}

async function trySls(project, logstore) {
  let Sls, OpenApi, Util;
  try {
    Sls = require('@alicloud/sls20201230');
    OpenApi = require('@alicloud/openapi-client');
    Util = require('@alicloud/tea-util');
  } catch (e) {
    out.errors.push(`sls_sdk_missing:${e.message}`);
    // try install? NO - user said no changes; npm install would mutate. Skip.
    return { status: 'sdk_missing' };
  }
  const region = env('FC_REGION_HK') || 'cn-hongkong';
  const config = new OpenApi.Config({
    accessKeyId: ak,
    accessKeySecret: sk,
    endpoint: `${region}.log.aliyuncs.com`,
  });
  const client = new Sls.default(config);
  const runtime = new Util.RuntimeOptions({ readTimeout: 60000 });
  const hourStats = {};
  for (const [label, from, to] of HOURS) {
    const fromSec = Math.floor(Date.parse(from) / 1000);
    const toSec = Math.floor(Date.parse(to) / 1000);
    const queries = [
      { name: 'timer_pipeline', query: '* and "timer:run-queue-pipeline" | select count(1) as c' },
      { name: 'idle_no_patrol', query: '* and "idle_no_patrol" | select count(1) as c' },
      { name: 'idle_zero', query: '* and idle_zero_patrol | select count(1) as c' },
      { name: 'fallback_nx_tasks', query: '* and "fallback nx_tasks" | select count(1) as c' },
      { name: 'admin_dashboard', query: '* and "admin-dashboard-stats" | select count(1) as c' },
      { name: 'admin_failed', query: '* and "admin-failed-tasks" | select count(1) as c' },
      { name: 'tasks_status', query: '* and "[tasks/status]" | select count(1) as c' },
      { name: 'any_error', query: '* and (ERROR or Error or error) | select count(1) as c' },
    ];
    hourStats[label] = {};
    for (const q of queries) {
      try {
        const req = new Sls.GetLogsRequest({
          from: fromSec,
          to: toSec,
          query: q.query,
        });
        // API shape varies by SDK version
        const resp = await client.getLogs(project, logstore, req);
        hourStats[label][q.name] = {
          ok: true,
          body: JSON.stringify(resp?.body || resp).slice(0, 500),
        };
      } catch (e) {
        hourStats[label][q.name] = { ok: false, error: String(e?.message || e).slice(0, 300) };
      }
    }
  }
  return { project, logstore, hourStats };
}

async function tryCms() {
  let Cms, OpenApi;
  try {
    Cms = require('@alicloud/cms20190101');
    OpenApi = require('@alicloud/openapi-client');
  } catch (e) {
    return { status: 'cms_sdk_missing', error: e.message };
  }
  const region = 'cn-hongkong';
  const config = new OpenApi.Config({
    accessKeyId: ak,
    accessKeySecret: sk,
    endpoint: 'metrics.cn-hangzhou.aliyuncs.com',
  });
  const client = new Cms.default(config);
  // DescribeMetricList for FC invocations
  const results = {};
  for (const [label, from, to] of [
    ['17-18', '2026-09-08 17:00:00', '2026-09-08 18:00:00'],
    ['18-19', '2026-09-08 18:00:00', '2026-09-08 19:00:00'],
    ['19-20', '2026-09-08 19:00:00', '2026-09-08 20:00:00'],
    ['20-21', '2026-09-08 20:00:00', '2026-09-08 21:00:00'],
    ['21-22', '2026-09-08 21:00:00', '2026-09-08 22:00:00'],
    ['22-23', '2026-09-08 22:00:00', '2026-09-08 23:00:00'],
  ]) {
    try {
      const req = new Cms.DescribeMetricListRequest({
        namespace: 'acs_fc',
        metricName: 'FunctionTotalInvocations',
        period: '3600',
        startTime: from,
        endTime: to,
        dimensions: JSON.stringify([
          { FunctionName: env('FC_FUNCTION_NAME_HK') || 'nexflow-api', Region: 'cn-hongkong' },
        ]),
      });
      const resp = await client.describeMetricList(req);
      results[label] = {
        ok: true,
        code: resp?.body?.code,
        datapoints: String(resp?.body?.datapoints || '').slice(0, 800),
      };
    } catch (e) {
      results[label] = { ok: false, error: String(e?.message || e).slice(0, 300) };
    }
  }
  return results;
}

try {
  await getFcLogConfig();
} catch (e) {
  out.errors.push(`getFcLogConfig: ${e.message || e}`);
}

const lc = out.log_config || {};
const project = lc.project || lc.Project || env('SLS_PROJECT') || '';
const logstore = lc.logstore || lc.Logstore || env('SLS_LOGSTORE') || '';
if (project && logstore) {
  try {
    out.sls = await trySls(project, logstore);
  } catch (e) {
    out.errors.push(`sls: ${e.message || e}`);
    out.sls = { status: 'failed', error: String(e?.message || e) };
  }
} else {
  out.sls = {
    status: 'no_log_config',
    note: 'FC LogConfig empty and no SLS_PROJECT/SLS_LOGSTORE in env',
    logConfig: lc,
  };
}

try {
  out.cms = await tryCms();
} catch (e) {
  out.cms = { status: 'failed', error: String(e?.message || e) };
}

console.log(JSON.stringify(out, null, 2));
