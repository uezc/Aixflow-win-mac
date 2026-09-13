/**
 * READ-ONLY audit probe — no writes, no deletes, no deploy.
 * node scripts/_audit-ots-readonly.mjs
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
const report = {
  source: 'readonly_probe',
  local_env: {
    OTS_INSTANCE: env('OTS_INSTANCE') || env('OTS_INST_NAME') || null,
    OTS_ENDPOINT_host: (() => {
      try {
        return env('OTS_ENDPOINT') ? new URL(env('OTS_ENDPOINT')).host : null;
      } catch {
        return 'parse_error';
      }
    })(),
    OTS_TABLE_TASKS: env('OTS_TABLE_TASKS') || 'nx_tasks(default)',
    OTS_TABLE_TASK_WORK: env('OTS_TABLE_TASK_WORK') || 'nx_task_work(default)',
    NX_TASK_WORK_FALLBACK_ON_EMPTY: env('NX_TASK_WORK_FALLBACK_ON_EMPTY') || '(unset → code default 0)',
    NX_QUEUE_IDLE_FULL_SWEEP_MS: env('NX_QUEUE_IDLE_FULL_SWEEP_MS') || '(unset → code default 3600000)',
    FC_QUEUE_TIMER_BOTH: env('FC_QUEUE_TIMER_BOTH') || '(unset → false)',
    FC_QUEUE_TIMER_CRON: env('FC_QUEUE_TIMER_CRON') || '(unset → @every 1m)',
    FC_FUNCTION_NAME_HK: env('FC_FUNCTION_NAME_HK') || env('FC_FUNCTION_NAME') || 'nexflow-api',
    FC_FUNCTION_NAME_BJ: env('FC_FUNCTION_NAME_BJ') || 'aixflow-api',
    FC_REGION_HK: env('FC_REGION_HK') || 'cn-hongkong',
    FC_REGION_BJ: env('FC_REGION_BJ') || 'cn-beijing',
  },
  fc_triggers: [],
  fc_env_keys: {},
  ots: null,
  errors: [],
};

async function listFcTriggers(region, functionName) {
  const require = createRequire(path.join(ROOT, 'package.json'));
  let Fc20230330, OpenApi, Util;
  try {
    Fc20230330 = require('@alicloud/fc20230330');
    OpenApi = require('@alicloud/openapi-client');
    Util = require('@alicloud/tea-util');
  } catch (e) {
    report.errors.push(`fc_sdk_missing:${e.message}`);
    return;
  }
  const ak = env('OTS_ACCESS_KEY_ID') || env('OSS_ACCESS_KEY_ID') || env('ALIBABA_CLOUD_ACCESS_KEY_ID');
  const sk =
    env('OTS_ACCESS_KEY_SECRET') ||
    env('OSS_ACCESS_KEY_SECRET') ||
    env('ALIBABA_CLOUD_ACCESS_KEY_SECRET');
  if (!ak || !sk) {
    report.errors.push('no_access_key_for_fc_list');
    return;
  }
  const config = new OpenApi.Config({
    accessKeyId: ak,
    accessKeySecret: sk,
    endpoint: `fcv3.${region}.aliyuncs.com`,
  });
  config.readTimeout = 60000;
  const client = new Fc20230330.default(config);
  const runtime = new Util.RuntimeOptions({ readTimeout: 60000 });
  try {
    const listReq = new Fc20230330.ListTriggersRequest({});
    const listResp = await client.listTriggersWithOptions(functionName, listReq, {}, runtime);
    const listed = listResp?.body?.triggers || listResp?.body?.Triggers || [];
    for (const tr of listed) {
      const name = tr.triggerName || tr.TriggerName;
      const conf = tr.triggerConfig || tr.TriggerConfig;
      let parsed = conf;
      try {
        parsed = typeof conf === 'string' ? JSON.parse(conf) : conf;
      } catch (_) {}
      report.fc_triggers.push({
        region,
        functionName,
        triggerName: name,
        triggerType: tr.triggerType || tr.TriggerType,
        cronExpression: parsed?.cronExpression || parsed?.CronExpression || null,
        enable: parsed?.enable ?? parsed?.Enable ?? null,
        payload_preview: String(parsed?.payload || parsed?.Payload || '').slice(0, 200),
      });
    }
  } catch (e) {
    report.errors.push(`listTriggers ${region}/${functionName}: ${e.message || e}`);
  }
  try {
    const getReq = new Fc20230330.GetFunctionRequest({});
    const getResp = await client.getFunctionWithOptions(functionName, getReq, {}, runtime);
    const body = getResp?.body || {};
    const envMap = body.environmentVariables || body.EnvironmentVariables || {};
    const keysOfInterest = [
      'NX_TASK_WORK_FALLBACK_ON_EMPTY',
      'NX_QUEUE_IDLE_FULL_SWEEP_MS',
      'FC_QUEUE_TIMER_BOTH',
      'OTS_INSTANCE',
      'OTS_INST_NAME',
      'OTS_ENDPOINT',
      'OTS_TABLE_TASKS',
      'OTS_TABLE_TASK_WORK',
      'NX_QUEUE_POSITION_MAX_SCAN',
    ];
    const sanitized = {};
    for (const k of keysOfInterest) {
      if (envMap[k] == null || envMap[k] === '') {
        sanitized[k] = '(not set on FC)';
      } else if (k === 'OTS_ENDPOINT') {
        try {
          sanitized[k] = new URL(String(envMap[k])).host;
        } catch {
          sanitized[k] = '(set, host parse fail)';
        }
      } else {
        sanitized[k] = String(envMap[k]);
      }
    }
    report.fc_env_keys[`${region}/${functionName}`] = sanitized;
  } catch (e) {
    report.errors.push(`getFunction ${region}/${functionName}: ${e.message || e}`);
  }
}

async function otsReadonlyStats() {
  try {
    const db = await import('../lib/db-tablestore.mjs');
    const t0 = Date.now();
    const work = await db.countTaskWorkActive({ maxScanRows: 5000 });
    const workMs = Date.now() - t0;
    let pools = null;
    try {
      pools = await db.getPlatformConcurrencyPoolSnapshot();
    } catch (e) {
      pools = { error: e.message || String(e) };
    }
    // Sample terminal scan size (lean columns) — read only, capped
    const t1 = Date.now();
    const terminal = await db.listTerminalTasksForRetention({
      cutoffMs: Date.now() - 3 * 864e5,
      maxTasks: 50,
      maxScanRows: 2000,
    });
    const termMs = Date.now() - t1;
    // Estimate avg attr bytes from one getRow of a known recent success if work empty — skip write
    let sampleTaskBytes = null;
    if (terminal.tasks?.[0]?.taskId && typeof db.getTaskById === 'function') {
      const full = await db.getTaskById(terminal.tasks[0].taskId);
      if (full) {
        sampleTaskBytes = Buffer.byteLength(JSON.stringify(full), 'utf8');
      }
    }
    report.ots = {
      probed_at: new Date().toISOString(),
      countTaskWorkActive: { ...work, elapsed_ms: workMs },
      platform_pools: pools,
      sample_terminal_scan: {
        scanned: terminal.scanned,
        matched: terminal.tasks?.length || 0,
        elapsed_ms: termMs,
        note: 'capped maxScanRows=2000; not full table size',
      },
      sample_full_task_json_bytes: sampleTaskBytes,
      note: 'GetRow full task JSON size is upper-bound proxy for fat row; not OTS wire size',
    };
  } catch (e) {
    report.errors.push(`ots_probe: ${e.message || e}`);
  }
}

await listFcTriggers(report.local_env.FC_REGION_HK, report.local_env.FC_FUNCTION_NAME_HK);
await listFcTriggers(report.local_env.FC_REGION_BJ, report.local_env.FC_FUNCTION_NAME_BJ);
await otsReadonlyStats();
console.log(JSON.stringify(report, null, 2));
