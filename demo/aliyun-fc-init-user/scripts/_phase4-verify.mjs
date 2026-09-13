/**
 * Phase4: verify slots + recent timer logs + optional FC trigger meta.
 */
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import fs from 'fs';

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

const db = await import('../lib/db-tablestore.mjs');
const snap = await db.getPlatformConcurrencyPoolSnapshot();
const work = await db.countTaskWorkActive({ maxScanRows: 2000 });

const require = createRequire(path.join(ROOT, 'package.json'));
const Sls = require('@alicloud/sls20201230');
const OpenApi = require('@alicloud/openapi-client');
const Util = require('@alicloud/tea-util');
const Fc20230330 = require('@alicloud/fc20230330');

const ak = process.env.OTS_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_ID;
const sk = process.env.OTS_ACCESS_KEY_SECRET || process.env.OSS_ACCESS_KEY_SECRET;
const runtime = new Util.RuntimeOptions({ readTimeout: 60000 });

async function timerLogs() {
  const client = new Sls.default(
    new OpenApi.Config({ accessKeyId: ak, accessKeySecret: sk, endpoint: 'cn-hongkong.log.aliyuncs.com' }),
  );
  const project = 'serverless-cn-hongkong-19bf0789-a97c-5b1d-953a-7c77f8773286';
  const logstore = 'default-logs';
  const to = Math.floor(Date.now() / 1000);
  const from = to - 30 * 60;
  const all = [];
  let offset = 0;
  for (;;) {
    const req = new Sls.GetLogsRequest({
      from,
      to,
      query: '"timer:run-queue-pipeline"',
      line: 100,
      offset,
      reverse: false,
    });
    const resp = await client.getLogsWithOptions(project, logstore, req, {}, runtime);
    const rows = Array.isArray(resp.body) ? resp.body : [];
    all.push(...rows);
    if (rows.length < 100) break;
    offset += rows.length;
    if (offset > 500) break;
  }
  const msgs = all.map((r) => String(r.message || '').trim()).filter(Boolean);
  const ms = msgs.map((m) => Number((m.match(/ms=(\d+)/) || [])[1])).filter((n) => Number.isFinite(n));
  return {
    count: msgs.length,
    idle_no_patrol_1: msgs.filter((m) => /idle_no_patrol=1/.test(m)).length,
    ms_avg: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null,
    ms_max: ms.length ? Math.max(...ms) : null,
    samples: msgs.slice(-8),
  };
}

async function listTriggers() {
  const config = new OpenApi.Config({
    accessKeyId: ak,
    accessKeySecret: sk,
    endpoint: 'fcv3.cn-hongkong.aliyuncs.com',
  });
  config.readTimeout = 60000;
  const client = new Fc20230330.default(config);
  const listReq = new Fc20230330.ListTriggersRequest({});
  const listResp = await client.listTriggersWithOptions('nexflow-api', listReq, {}, runtime);
  const listed = listResp?.body?.triggers || listResp?.body?.Triggers || [];
  return listed.map((tr) => ({
    name: tr.triggerName || tr.TriggerName,
    type: tr.triggerType || tr.TriggerType,
    config: tr.triggerConfig || tr.TriggerConfig,
  }));
}

const out = {
  snap,
  work: { has_any: work?.has_any, scanned: work?.scanned, count: work?.count },
  timer: await timerLogs(),
  triggers: await listTriggers(),
  fallback_env_hint: process.env.NX_TASK_WORK_FALLBACK_ON_EMPTY || '(local unset)',
};
console.log(JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(__dirname, 'phase4-verify-result.json'), JSON.stringify(out, null, 2));
