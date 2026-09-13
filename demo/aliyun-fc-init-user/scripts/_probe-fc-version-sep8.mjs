/**
 * READ-ONLY: FC version metadata + optional log probe for 2026-09-08 17:00-23:00 CST
 * Does NOT touch OTS. node scripts/_probe-fc-version-sep8.mjs
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

const WINDOW = {
  label: '2026-09-08 17:00-23:00 Asia/Shanghai',
  startMs: Date.parse('2026-09-08T09:00:00.000Z'), // CST 17:00
  endMs: Date.parse('2026-09-08T15:00:00.000Z'), // CST 23:00
};

const out = {
  probed_at: new Date().toISOString(),
  window: WINDOW,
  functions: [],
  oss_fc_deploys: null,
  logs: null,
  errors: [],
};

function pick(body, ...keys) {
  for (const k of keys) {
    if (body?.[k] != null) return body[k];
  }
  return null;
}

async function getFcMeta(region, functionName) {
  const require = createRequire(path.join(ROOT, 'package.json'));
  const Fc20230330 = require('@alicloud/fc20230330');
  const OpenApi = require('@alicloud/openapi-client');
  const Util = require('@alicloud/tea-util');
  const ak = env('OTS_ACCESS_KEY_ID') || env('OSS_ACCESS_KEY_ID') || env('ALIBABA_CLOUD_ACCESS_KEY_ID');
  const sk =
    env('OTS_ACCESS_KEY_SECRET') ||
    env('OSS_ACCESS_KEY_SECRET') ||
    env('ALIBABA_CLOUD_ACCESS_KEY_SECRET');
  if (!ak || !sk) throw new Error('no_access_key');

  const config = new OpenApi.Config({
    accessKeyId: ak,
    accessKeySecret: sk,
    endpoint: `fcv3.${region}.aliyuncs.com`,
  });
  config.readTimeout = 60000;
  const client = new Fc20230330.default(config);
  const runtime = new Util.RuntimeOptions({ readTimeout: 60000 });

  const getResp = await client.getFunctionWithOptions(
    functionName,
    new Fc20230330.GetFunctionRequest({}),
    {},
    runtime,
  );
  const body = getResp?.body || {};
  const envMap = pick(body, 'environmentVariables', 'EnvironmentVariables') || {};
  const interesting = [
    'NX_TASK_WORK_FALLBACK_ON_EMPTY',
    'NX_QUEUE_IDLE_FULL_SWEEP_MS',
    'OTS_TABLE_TASK_WORK',
    'OTS_INSTANCE',
    'OTS_INST_NAME',
    'OTS_ENDPOINT',
  ];
  const envSan = {};
  for (const k of interesting) {
    if (envMap[k] == null || envMap[k] === '') envSan[k] = '(not set)';
    else if (k === 'OTS_ENDPOINT') {
      try {
        envSan[k] = new URL(String(envMap[k])).host;
      } catch {
        envSan[k] = '(set)';
      }
    } else envSan[k] = String(envMap[k]);
  }

  let triggers = [];
  try {
    const listResp = await client.listTriggersWithOptions(
      functionName,
      new Fc20230330.ListTriggersRequest({}),
      {},
      runtime,
    );
    const listed = listResp?.body?.triggers || listResp?.body?.Triggers || [];
    triggers = listed.map((tr) => {
      const conf = tr.triggerConfig || tr.TriggerConfig;
      let parsed = conf;
      try {
        parsed = typeof conf === 'string' ? JSON.parse(conf) : conf;
      } catch (_) {}
      return {
        triggerName: tr.triggerName || tr.TriggerName,
        triggerType: tr.triggerType || tr.TriggerType,
        createdTime: tr.createdTime || tr.CreatedTime || null,
        lastModifiedTime: tr.lastModifiedTime || tr.LastModifiedTime || null,
        cronExpression: parsed?.cronExpression || null,
        enable: parsed?.enable ?? null,
        payload: String(parsed?.payload || '').slice(0, 300),
      };
    });
  } catch (e) {
    out.errors.push(`listTriggers ${region}/${functionName}: ${e.message || e}`);
  }

  const lastMod = pick(body, 'lastModifiedTime', 'LastModifiedTime', 'lastModified');
  const created = pick(body, 'createdTime', 'CreatedTime');
  const lastModMs = lastMod ? Date.parse(String(lastMod)) : NaN;
  const inOrBeforeWindow =
    Number.isFinite(lastModMs) && lastModMs <= WINDOW.endMs
      ? lastModMs < WINDOW.startMs
        ? 'version_frozen_before_window_start'
        : 'modified_during_window'
      : Number.isFinite(lastModMs) && lastModMs > WINDOW.endMs
        ? 'modified_AFTER_window_end'
        : 'unknown';

  return {
    region,
    functionName,
    lastModifiedTime: lastMod,
    createdTime: created,
    codeSize: pick(body, 'codeSize', 'CodeSize'),
    codeChecksum: pick(body, 'codeChecksum', 'CodeChecksum'),
    description: pick(body, 'description', 'Description'),
    runtime: pick(body, 'runtime', 'Runtime'),
    timeout: pick(body, 'timeout', 'Timeout'),
    memorySize: pick(body, 'memorySize', 'MemorySize'),
    handler: pick(body, 'handler', 'Handler'),
    env: envSan,
    triggers,
    window_vs_lastModified: inOrBeforeWindow,
    lastModified_iso_cst_hint:
      Number.isFinite(lastModMs) ? new Date(lastModMs + 8 * 3600e3).toISOString().replace('Z', '+08:00') : null,
  };
}

async function listOssDeploys() {
  const bucket = env('OSS_BUCKET');
  const ossEndpoint = env('OSS_ENDPOINT').replace(/^https?:\/\//, '');
  const ak = env('OSS_ACCESS_KEY_ID') || env('OTS_ACCESS_KEY_ID');
  const sk = env('OSS_ACCESS_KEY_SECRET') || env('OTS_ACCESS_KEY_SECRET');
  if (!bucket || !ossEndpoint || !ak || !sk) {
    out.errors.push('oss_list_skipped_missing_creds_or_bucket');
    return null;
  }
  const require = createRequire(path.join(ROOT, 'package.json'));
  const OSS = require('ali-oss');
  const oss = new OSS({
    accessKeyId: ak,
    accessKeySecret: sk,
    bucket,
    endpoint: ossEndpoint.startsWith('http') ? ossEndpoint : `https://${ossEndpoint}`,
    timeout: 60000,
  });
  const res = await oss.list({ prefix: 'fc-deploys/', 'max-keys': 100 });
  const objects = (res.objects || [])
    .map((o) => ({
      name: o.name,
      size: o.size,
      lastModified: o.lastModified,
      lastModifiedMs: o.lastModified ? Date.parse(o.lastModified) : null,
    }))
    .sort((a, b) => (a.lastModifiedMs || 0) - (b.lastModifiedMs || 0));
  const inWindow = objects.filter(
    (o) => o.lastModifiedMs >= WINDOW.startMs && o.lastModifiedMs < WINDOW.endMs,
  );
  const beforeWindow = objects.filter((o) => o.lastModifiedMs && o.lastModifiedMs < WINDOW.startMs);
  const afterWindow = objects.filter((o) => o.lastModifiedMs && o.lastModifiedMs >= WINDOW.endMs);
  return {
    bucket,
    prefix: 'fc-deploys/',
    total_listed: objects.length,
    latest: objects.slice(-5),
    deploys_in_window_cst_17_23: inWindow,
    last_deploy_before_window: beforeWindow.slice(-3),
    deploys_after_window: afterWindow.slice(0, 5),
  };
}

async function tryFcLogs(region, functionName) {
  // FC3 GetFunctionLogs / ListStatefulAsyncInvocations may not exist; try common patterns.
  const require = createRequire(path.join(ROOT, 'package.json'));
  const Fc20230330 = require('@alicloud/fc20230330');
  const OpenApi = require('@alicloud/openapi-client');
  const Util = require('@alicloud/tea-util');
  const ak = env('OTS_ACCESS_KEY_ID') || env('OSS_ACCESS_KEY_ID');
  const sk = env('OTS_ACCESS_KEY_SECRET') || env('OSS_ACCESS_KEY_SECRET');
  const config = new OpenApi.Config({
    accessKeyId: ak,
    accessKeySecret: sk,
    endpoint: `fcv3.${region}.aliyuncs.com`,
  });
  const client = new Fc20230330.default(config);
  const runtime = new Util.RuntimeOptions({ readTimeout: 60000 });
  const attempts = [];

  // List instances / invocations if available
  for (const method of ['listFunctionVersionsWithOptions', 'listAliasesWithOptions']) {
    if (typeof client[method] !== 'function') {
      attempts.push({ method, status: 'sdk_method_absent' });
      continue;
    }
    try {
      const resp = await client[method](functionName, {}, {}, runtime);
      attempts.push({
        method,
        status: 'ok',
        body_keys: Object.keys(resp?.body || {}),
        preview: JSON.stringify(resp?.body || {}).slice(0, 800),
      });
    } catch (e) {
      attempts.push({ method, status: 'error', error: String(e?.message || e).slice(0, 200) });
    }
  }
  return { region, functionName, attempts, note: 'FC request logs typically need SLS; not queried here unless SDK exposes them' };
}

const targets = [
  { region: env('FC_REGION_HK') || 'cn-hongkong', functionName: env('FC_FUNCTION_NAME_HK') || env('FC_FUNCTION_NAME') || 'nexflow-api' },
  { region: env('FC_REGION_BJ') || 'cn-beijing', functionName: env('FC_FUNCTION_NAME_BJ') || 'aixflow-api' },
];

for (const t of targets) {
  try {
    out.functions.push(await getFcMeta(t.region, t.functionName));
  } catch (e) {
    out.errors.push(`getFunction ${t.region}/${t.functionName}: ${e.message || e}`);
  }
}

try {
  out.oss_fc_deploys = await listOssDeploys();
} catch (e) {
  out.errors.push(`oss_list: ${e.message || e}`);
}

try {
  out.logs = await tryFcLogs(targets[0].region, targets[0].functionName);
} catch (e) {
  out.errors.push(`logs: ${e.message || e}`);
}

// Local zip mtime as weak hint only
const zip = path.join(ROOT, 'nexflow-fc.zip');
if (fs.existsSync(zip)) {
  const st = fs.statSync(zip);
  out.local_nexflow_fc_zip = {
    path: 'demo/aliyun-fc-init-user/nexflow-fc.zip',
    size: st.size,
    mtime: st.mtime.toISOString(),
  };
}

console.log(JSON.stringify(out, null, 2));
