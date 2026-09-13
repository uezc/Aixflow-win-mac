/**
 * 降本验收快照（即时）+ 空闲夜人工清单。
 *   node scripts/accept-queue-cost-night.mjs
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvFile(path.join(REPO, '.env'));
loadEnvFile(path.join(ROOT, '.env'));

const require = createRequire(path.join(ROOT, 'package.json'));
const db = await import('../lib/db-tablestore.mjs');
const Fc20230330 = require('@alicloud/fc20230330');
const OpenApi = require('@alicloud/openapi-client');
const Util = require('@alicloud/tea-util');

const ak = process.env.OTS_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_ID;
const sk = process.env.OTS_ACCESS_KEY_SECRET || process.env.OSS_ACCESS_KEY_SECRET;

const out = {
  at: new Date().toISOString(),
  target: '≤¥10/day',
  checks: {},
  overnight_checklist: [
    '费用中心：空闲夜余额缓降接近 ¥2～5，或至少 ≤¥10/天',
    '费用中心：OTS 小时应付 < ¥1；下行 ≪ 100MB/h',
    'SLS：timer 日志大量 idle_no_patrol=1 / queue_mode=idle，ms 亚秒～数百 ms',
    'counters：video.running / image.running 保持 0（无真实任务）',
    '若再次出现计数漂移：APPLY=1 node scripts/repair-platform-slot-counter-drift.mjs',
  ],
  errors: [],
};

const snap = await db.getPlatformConcurrencyPoolSnapshot();
const work = await db.countTaskWorkActive({ maxScanRows: 2000 });
out.checks.slots_zero =
  (snap?.video?.running || 0) === 0 &&
  (snap?.image?.running || 0) === 0 &&
  (snap?.audio?.running || 0) === 0;
out.checks.work_idle = !(work?.has_any) && (work?.count || 0) === 0;
out.platform = snap;
out.work_active = work;

const config = new OpenApi.Config({
  accessKeyId: ak,
  accessKeySecret: sk,
  endpoint: 'fcv3.cn-hongkong.aliyuncs.com',
});
const client = new Fc20230330.default(config);
const runtime = new Util.RuntimeOptions({ readTimeout: 60000 });

const getReq = new Fc20230330.GetFunctionRequest({});
const fn = await client.getFunctionWithOptions('nexflow-api', getReq, {}, runtime);
const envMap = (fn?.body || fn)?.environmentVariables || {};
out.checks.fc_env = {
  NX_QUEUE_IDLE_PROBE_MS: envMap.NX_QUEUE_IDLE_PROBE_MS,
  NX_QUEUE_IDLE_FULL_SWEEP_MS: envMap.NX_QUEUE_IDLE_FULL_SWEEP_MS,
  NX_QUEUE_TIMER_TICK_MS: envMap.NX_QUEUE_TIMER_TICK_MS,
  NX_TASK_WORK_FALLBACK_ON_EMPTY: envMap.NX_TASK_WORK_FALLBACK_ON_EMPTY,
};
out.checks.env_ok =
  String(envMap.NX_QUEUE_IDLE_PROBE_MS) === '900000' &&
  String(envMap.NX_QUEUE_IDLE_FULL_SWEEP_MS) === '10800000' &&
  String(envMap.NX_TASK_WORK_FALLBACK_ON_EMPTY || '0') === '0';

const listReq = new Fc20230330.ListTriggersRequest({});
const listResp = await client.listTriggersWithOptions('nexflow-api', listReq, {}, runtime);
const triggers = listResp?.body?.triggers || [];
const qt = triggers.find((t) => (t.triggerName || '') === 'nexflow-queue-pipeline');
let cron = null;
if (qt) {
  let cfg = qt.triggerConfig || '';
  if (typeof cfg === 'string') {
    try {
      cfg = JSON.parse(cfg);
    } catch {
      /* */
    }
  }
  cron = cfg?.cronExpression || null;
}
out.checks.timer_cron = cron;
out.checks.timer_cron_ok = cron === '@every 5m';

async function invokeOnce() {
  const base = String(
    process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '',
  ).replace(/\/$/, '');
  const token = String(process.env.ALIYUN_FC_TOKEN || process.env.API_SECRET_TOKEN || '').trim();
  const settle = String(process.env.ADMIN_SETTLE_SECRET || '').trim();
  if (!base) throw new Error('missing HK_FC_ENDPOINT');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'x-nexflow-token': token, Authorization: `Bearer ${token}` } : {}),
    ...(settle ? { 'x-admin-settle-secret': settle } : {}),
  };
  const t0 = Date.now();
  const resp = await fetch(`${base}/internal/run-queue-pipeline`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      max_claims: 20,
      max_charge: 40,
      max_dispatch: 20,
      max_poll: 40,
      reconcile: false,
    }),
  });
  const text = await resp.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* */
  }
  return {
    http_status: resp.status,
    elapsed_ms: Date.now() - t0,
    idle_no_patrol: !!json?.idle_no_patrol,
    idle_short_circuit: !!json?.idle_short_circuit,
    queue_mode: json?.queue_mode || null,
    pipeline_elapsed_ms: json?.elapsed_ms ?? null,
    detail: json?.idle_short_circuit_detail || null,
    body_head: text.slice(0, 400),
  };
}

try {
  out.checks.invoke1 = await invokeOnce();
  out.checks.invoke2 = await invokeOnce();
} catch (e) {
  out.errors.push(`invoke:${e?.message || e}`);
}

const i1 = out.checks.invoke1;
const i2 = out.checks.invoke2;
out.checks.pipeline_idle_ok = !!(
  i1 &&
  (i1.idle_no_patrol || i1.idle_short_circuit || i1.queue_mode === 'idle') &&
  i2 &&
  (i2.idle_no_patrol || i2.idle_short_circuit || i2.queue_mode === 'idle')
);

out.ok =
  out.checks.slots_zero &&
  out.checks.work_idle &&
  out.checks.env_ok &&
  out.checks.timer_cron_ok &&
  out.checks.pipeline_idle_ok &&
  out.errors.length === 0;

const outPath = path.join(__dirname, 'accept-queue-cost-night-result.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
console.log(`[accept-queue-cost-night] wrote ${outPath} ok=${out.ok}`);
process.exit(out.ok ? 0 : 1);
