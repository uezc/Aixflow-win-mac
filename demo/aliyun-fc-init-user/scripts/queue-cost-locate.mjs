/**
 * 降本只读定位：平台槽 + 瘦表活跃 + 近窗 SLS Timer idle 占比 + FC Timer cron/env。
 * 禁止无 columnToGet 胖扫 nx_tasks。
 *
 *   node scripts/queue-cost-locate.mjs
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

const ak = process.env.OTS_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_ID;
const sk = process.env.OTS_ACCESS_KEY_SECRET || process.env.OSS_ACCESS_KEY_SECRET;

const report = {
  at: new Date().toISOString(),
  goal: '≤¥10/day idle+light',
  platform: null,
  work_active: null,
  work_lists: null,
  sls_last_21h: null,
  sls_last_30m: null,
  fc: [],
  errors: [],
};

try {
  report.platform = await db.getPlatformConcurrencyPoolSnapshot();
} catch (e) {
  report.errors.push(`platform:${e?.message || e}`);
}
try {
  report.work_active = await db.countTaskWorkActive({ maxScanRows: 2000 });
} catch (e) {
  report.errors.push(`work_active:${e?.message || e}`);
}
try {
  const promote = await db.listTaskWorkForPromote({ maxTasks: 200, maxScanRows: 2000 });
  const expired = await db.listExpiredClaimedFromTaskWork({ maxTasks: 200, maxScanRows: 2000 });
  const charge = await db.listTaskWorkForCharge({ maxTasks: 200, maxScanRows: 2000 });
  report.work_lists = {
    promote_queued: promote?.tasks?.length ?? 0,
    expired_claimed: expired?.tasks?.length ?? 0,
    charge_candidates: charge?.taskIds?.length ?? charge?.tasks?.length ?? 0,
    promote_sample: (promote?.tasks || []).slice(0, 8).map((t) => ({
      task_id: t.taskId || t.task_id,
      status: t.status,
      user_id: t.userId || t.user_id,
    })),
    expired_sample: (expired?.tasks || []).slice(0, 8).map((t) => ({
      task_id: t.taskId || t.task_id,
      status: t.status,
    })),
  };
} catch (e) {
  report.errors.push(`work_lists:${e?.message || e}`);
}

async function slsWindow(label, fromSec, toSec) {
  const Sls = require('@alicloud/sls20201230');
  const OpenApi = require('@alicloud/openapi-client');
  const Util = require('@alicloud/tea-util');
  const client = new Sls.default(
    new OpenApi.Config({
      accessKeyId: ak,
      accessKeySecret: sk,
      endpoint: 'cn-hongkong.log.aliyuncs.com',
    }),
  );
  const runtime = new Util.RuntimeOptions({ readTimeout: 60000 });
  const project = 'serverless-cn-hongkong-19bf0789-a97c-5b1d-953a-7c77f8773286';
  const logstore = 'default-logs';
  const msgs = [];
  let offset = 0;
  for (;;) {
    const req = new Sls.GetLogsRequest({
      from: fromSec,
      to: toSec,
      query: '"timer:run-queue-pipeline" or queue_mode or idle_no_patrol or idle_probe',
      line: 100,
      offset,
      reverse: false,
    });
    const resp = await client.getLogsWithOptions(project, logstore, req, {}, runtime);
    const rows = Array.isArray(resp.body) ? resp.body : [];
    for (const r of rows) {
      const m = String(r.message || r.content || '').trim();
      if (m) msgs.push(m);
    }
    if (rows.length < 100) break;
    offset += rows.length;
    if (offset > 3000) break;
  }
  const timerMsgs = msgs.filter((m) => /timer:run-queue-pipeline/.test(m));
  const ms = timerMsgs
    .map((m) => Number((m.match(/ms=(\d+)/) || [])[1]))
    .filter((n) => Number.isFinite(n));
  const idle1 = timerMsgs.filter((m) => /idle_no_patrol=1/.test(m)).length;
  const idle0 = timerMsgs.filter((m) => /idle_no_patrol=0/.test(m)).length;
  const modeIdle = msgs.filter((m) => /"queue_mode":"idle"|queue_mode":"idle"/.test(m)).length;
  const modeActive = msgs.filter((m) => /"queue_mode":"active"|queue_mode":"active"/.test(m)).length;
  const deferred = msgs.filter((m) => /idle_probe_deferred|idle_probe_deferred/.test(m)).length;
  ms.sort((a, b) => a - b);
  return {
    label,
    from: new Date(fromSec * 1000).toISOString(),
    to: new Date(toSec * 1000).toISOString(),
    timer_lines: timerMsgs.length,
    idle_no_patrol_1: idle1,
    idle_no_patrol_0: idle0,
    idle_ratio: timerMsgs.length ? Number((idle1 / timerMsgs.length).toFixed(3)) : null,
    queue_mode_idle_logs: modeIdle,
    queue_mode_active_logs: modeActive,
    idle_probe_deferred_logs: deferred,
    ms_min: ms[0] ?? null,
    ms_median: ms[Math.floor(ms.length / 2)] ?? null,
    ms_max: ms.length ? ms[ms.length - 1] : null,
    ms_avg: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null,
    ms_gt_5s: ms.filter((x) => x > 5000).length,
    samples: timerMsgs.slice(-5),
  };
}

if (ak && sk) {
  const to = Math.floor(Date.now() / 1000);
  try {
    report.sls_last_30m = await slsWindow('last_30m', to - 30 * 60, to);
  } catch (e) {
    report.errors.push(`sls_30m:${e?.message || e}`);
  }
  try {
    // 昨日 12:00 CST → 今日 09:00 CST ≈ 21h（用户账单窗）
    report.sls_last_21h = await slsWindow('bill_window_approx_21h', to - 21 * 3600, to);
  } catch (e) {
    report.errors.push(`sls_21h:${e?.message || e}`);
  }

  try {
    const Fc20230330 = require('@alicloud/fc20230330');
    const OpenApi = require('@alicloud/openapi-client');
    const Util = require('@alicloud/tea-util');
    const targets = [
      {
        region: process.env.FC_REGION_HK || 'cn-hongkong',
        functionName:
          process.env.FC_FUNCTION_NAME_HK || process.env.FC_FUNCTION_NAME || 'nexflow-api',
      },
      {
        region: process.env.FC_REGION_BJ || 'cn-beijing',
        functionName: process.env.FC_FUNCTION_NAME_BJ || 'aixflow-api',
      },
    ];
    for (const t of targets) {
      const config = new OpenApi.Config({
        accessKeyId: ak,
        accessKeySecret: sk,
        endpoint: `fcv3.${t.region}.aliyuncs.com`,
      });
      const client = new Fc20230330.default(config);
      const runtime = new Util.RuntimeOptions({ readTimeout: 60000 });
      const getReq = new Fc20230330.GetFunctionRequest({});
      const fn = await client.getFunctionWithOptions(t.functionName, getReq, {}, runtime);
      const body = fn?.body || fn;
      const envMap = body?.environmentVariables || body?.EnvironmentVariables || {};
      let triggers = [];
      try {
        const listReq = new Fc20230330.ListTriggersRequest({});
        const listResp = await client.listTriggersWithOptions(t.functionName, listReq, {}, runtime);
        triggers = listResp?.body?.triggers || listResp?.body?.Triggers || [];
      } catch (e) {
        report.errors.push(`triggers_${t.region}:${e?.message || e}`);
      }
      const queueTriggers = (triggers || [])
        .map((tr) => {
          const name = tr.triggerName || tr.TriggerName;
          let cfg = tr.triggerConfig || tr.TriggerConfig || '';
          if (typeof cfg === 'string') {
            try {
              cfg = JSON.parse(cfg);
            } catch {
              /* keep */
            }
          }
          return {
            name,
            cron: cfg?.cronExpression || cfg?.CronExpression || null,
            enable: cfg?.enable ?? cfg?.Enable ?? null,
            payload_head: String(cfg?.payload || cfg?.Payload || '').slice(0, 120),
          };
        })
        .filter((tr) => /queue|pipeline/i.test(String(tr.name || '')) || /run-queue/i.test(tr.payload_head));
      report.fc.push({
        region: t.region,
        functionName: t.functionName,
        env: {
          NX_QUEUE_IDLE_PROBE_MS: envMap.NX_QUEUE_IDLE_PROBE_MS || null,
          NX_QUEUE_IDLE_FULL_SWEEP_MS: envMap.NX_QUEUE_IDLE_FULL_SWEEP_MS || null,
          NX_TASK_WORK_FALLBACK_ON_EMPTY: envMap.NX_TASK_WORK_FALLBACK_ON_EMPTY || null,
          NX_QUEUE_FORCE_PIPELINE: envMap.NX_QUEUE_FORCE_PIPELINE || null,
        },
        queue_triggers: queueTriggers,
      });
    }
  } catch (e) {
    report.errors.push(`fc:${e?.message || e}`);
  }
} else {
  report.errors.push('no_access_key');
}

const videoRunning = Number(report.platform?.video?.running) || 0;
const imageRunning = Number(report.platform?.image?.running) || 0;
const audioRunning = Number(report.platform?.audio?.running) || 0;
const workCount =
  typeof report.work_active === 'number'
    ? report.work_active
    : Number(report.work_active?.count ?? report.work_active?.active ?? 0) || 0;
report.verdict = {
  slots_busy: videoRunning + imageRunning + audioRunning > 0,
  work_busy: workCount > 0 || (report.work_lists?.promote_queued || 0) > 0,
  likely_need_cleanup:
    videoRunning + imageRunning + audioRunning > 0 ||
    workCount > 0 ||
    (report.work_lists?.expired_claimed || 0) > 0,
  sls_idle_ok:
    report.sls_last_21h?.idle_ratio != null ? report.sls_last_21h.idle_ratio >= 0.7 : null,
  note:
    '账单 OTS/FC 拆分请在费用中心人工确认；本脚本不拉消费明细以免权限/延迟问题。',
};

const outPath = path.join(__dirname, 'queue-cost-locate-result.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`[queue-cost-locate] wrote ${outPath}`);
