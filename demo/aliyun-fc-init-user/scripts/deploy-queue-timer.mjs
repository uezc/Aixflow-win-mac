/**
 * 为香港 nexflow-api（及可选北京）创建/更新 FC Timer：
 *   cron 默认 @every 5m → 函数内跑 run-queue-pipeline（空闲另有探活降频）
 *
 * 用法：node scripts/deploy-queue-timer.mjs
 * 覆盖：FC_QUEUE_TIMER_CRON="@every 5m"
 * 不打印密钥。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '../..');

dotenv.config({ path: path.join(ROOT, '.env') });
dotenv.config({ path: path.join(REPO, '.env') });

function env(name) {
  return String(process.env[name] || '').trim();
}

function ensureFcSdk() {
  const requireFromRoot = createRequire(path.join(ROOT, 'package.json'));
  try {
    requireFromRoot.resolve('@alicloud/fc20230330');
    requireFromRoot.resolve('@alicloud/openapi-client');
    return requireFromRoot;
  } catch {
    console.log('[queue-timer] 安装 @alicloud/fc20230330 …');
    execSync(
      'npm install --no-save @alicloud/fc20230330@^4.2.0 @alicloud/openapi-client @alicloud/tea-util',
      { cwd: ROOT, stdio: 'inherit' },
    );
    return createRequire(path.join(ROOT, 'package.json'));
  }
}

const TRIGGER_NAME = env('FC_QUEUE_TIMER_NAME') || 'nexflow-queue-pipeline';
const CRON = env('FC_QUEUE_TIMER_CRON') || '@every 5m';
const PAYLOAD = JSON.stringify({
  action: 'run-queue-pipeline',
  max_claims: 20,
  max_charge: 40,
  max_dispatch: 20,
  max_poll: 40,
  reconcile: false,
});

const targets = [
  {
    region: env('FC_REGION_HK') || 'cn-hongkong',
    functionName: env('FC_FUNCTION_NAME_HK') || env('FC_FUNCTION_NAME') || 'nexflow-api',
    primary: true,
  },
];

// 可选：北京也挂（双活）；默认只挂香港，避免双端同时 promote 抢 claim（同 OTS 下可幂等但浪费）
if (env('FC_QUEUE_TIMER_BOTH') === '1') {
  targets.push({
    region: env('FC_REGION_BJ') || 'cn-beijing',
    functionName: env('FC_FUNCTION_NAME_BJ') || 'aixflow-api',
    primary: false,
  });
}

async function main() {
  const accessKeyId =
    env('OTS_ACCESS_KEY_ID') || env('OSS_ACCESS_KEY_ID') || env('ALIBABA_CLOUD_ACCESS_KEY_ID');
  const accessKeySecret =
    env('OTS_ACCESS_KEY_SECRET') ||
    env('OSS_ACCESS_KEY_SECRET') ||
    env('ALIBABA_CLOUD_ACCESS_KEY_SECRET');
  if (!accessKeyId || !accessKeySecret) {
    console.error('[queue-timer] 缺少 AccessKey');
    process.exit(1);
  }

  const require = ensureFcSdk();
  const Fc20230330 = require('@alicloud/fc20230330');
  const OpenApi = require('@alicloud/openapi-client');
  const Util = require('@alicloud/tea-util');

  const report = {
    triggerName: TRIGGER_NAME,
    cron: CRON,
    payload_action: 'run-queue-pipeline',
    results: [],
  };

  for (const t of targets) {
    console.log(`[queue-timer] ${t.region}/${t.functionName} …`);
    const config = new OpenApi.Config({
      accessKeyId,
      accessKeySecret,
      endpoint: `fcv3.${t.region}.aliyuncs.com`,
    });
    config.readTimeout = 60000;
    config.connectTimeout = 20000;
    const client = new Fc20230330.default(config);
    const runtime = new Util.RuntimeOptions({ readTimeout: 60000, connectTimeout: 20000 });

    const triggerConfig = JSON.stringify({
      cronExpression: CRON,
      enable: true,
      payload: PAYLOAD,
    });

    let listed = null;
    try {
      const listReq = new Fc20230330.ListTriggersRequest({});
      const listResp = await client.listTriggersWithOptions(t.functionName, listReq, {}, runtime);
      listed = listResp?.body?.triggers || listResp?.body?.Triggers || [];
    } catch (e) {
      console.warn('[queue-timer] listTriggers failed:', e?.message || e);
      listed = [];
    }

    const existing = (listed || []).find(
      (x) => String(x.triggerName || x.TriggerName || '') === TRIGGER_NAME,
    );

    try {
      if (existing) {
        const upd = new Fc20230330.UpdateTriggerInput({});
        upd.triggerConfig = triggerConfig;
        upd.description = 'NEXFLOW Queue Pipeline every 1m (promote→charge→dispatch→poll)';
        const req = new Fc20230330.UpdateTriggerRequest({});
        req.body = upd;
        const resp = await client.updateTriggerWithOptions(
          t.functionName,
          TRIGGER_NAME,
          req,
          {},
          runtime,
        );
        const body = resp?.body || {};
        report.results.push({
          region: t.region,
          functionName: t.functionName,
          action: 'updated',
          triggerName: TRIGGER_NAME,
          lastModifiedTime: body.lastModifiedTime || body.LastModifiedTime || null,
          triggerConfig: body.triggerConfig || triggerConfig,
        });
        console.log(`[queue-timer] ✓ updated ${t.region}/${t.functionName}/${TRIGGER_NAME}`);
      } else {
        const cre = new Fc20230330.CreateTriggerInput({});
        cre.triggerName = TRIGGER_NAME;
        cre.triggerType = 'timer';
        cre.description = 'NEXFLOW Queue Pipeline every 1m (promote→charge→dispatch→poll)';
        cre.qualifier = 'LATEST';
        cre.triggerConfig = triggerConfig;
        const req = new Fc20230330.CreateTriggerRequest({});
        req.body = cre;
        const resp = await client.createTriggerWithOptions(t.functionName, req, {}, runtime);
        const body = resp?.body || {};
        report.results.push({
          region: t.region,
          functionName: t.functionName,
          action: 'created',
          triggerName: TRIGGER_NAME,
          triggerId: body.triggerId || body.TriggerId || null,
          createdTime: body.createdTime || body.CreatedTime || null,
          triggerConfig: body.triggerConfig || triggerConfig,
        });
        console.log(`[queue-timer] ✓ created ${t.region}/${t.functionName}/${TRIGGER_NAME}`);
      }
    } catch (e) {
      console.error(`[queue-timer] ✗ ${t.region}/${t.functionName}:`, e?.message || e);
      if (e?.data) console.error('[queue-timer] detail:', JSON.stringify(e.data));
      report.results.push({
        region: t.region,
        functionName: t.functionName,
        action: 'error',
        error: String(e?.message || e),
        data: e?.data || null,
      });
      process.exitCode = 1;
    }
  }

  fs.writeFileSync(
    path.join(__dirname, 'deploy-queue-timer-result.json'),
    JSON.stringify(report, null, 2),
  );
  console.log('[queue-timer] wrote scripts/deploy-queue-timer-result.json');
  if (!process.exitCode) {
    console.log(`[queue-timer] 完成。Timer 云端 cron=${CRON}，不依赖本机。`);
  }
}

main().catch((e) => {
  console.error('[queue-timer] failed:', e?.message || e);
  process.exit(1);
});
