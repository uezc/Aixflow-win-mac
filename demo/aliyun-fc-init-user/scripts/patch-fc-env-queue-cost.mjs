/**
 * 双地域 FC 环境变量：空闲探活 15min + 保险巡检 3h（降本，保留 create 唤醒）
 *   node scripts/patch-fc-env-queue-cost.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '../..');
dotenv.config({ path: path.join(REPO, '.env') });
dotenv.config({ path: path.join(ROOT, '.env') });

function env(name) {
  return String(process.env[name] || '').trim();
}

function ensureFcSdk() {
  const requireFromRoot = createRequire(path.join(ROOT, 'package.json'));
  try {
    requireFromRoot.resolve('@alicloud/fc20230330');
    return requireFromRoot;
  } catch {
    execSync(
      'npm install --no-save @alicloud/fc20230330@^4.2.0 @alicloud/openapi-client @alicloud/tea-util',
      { cwd: ROOT, stdio: 'inherit' },
    );
    return createRequire(path.join(ROOT, 'package.json'));
  }
}

const PATCH = {
  NX_QUEUE_IDLE_PROBE_MS: env('NX_QUEUE_IDLE_PROBE_MS') || '900000',
  NX_QUEUE_IDLE_FULL_SWEEP_MS: env('NX_QUEUE_IDLE_FULL_SWEEP_MS') || '10800000',
  NX_QUEUE_TIMER_TICK_MS: env('NX_QUEUE_TIMER_TICK_MS') || '300000',
  NX_TASK_WORK_FALLBACK_ON_EMPTY: '0',
};

async function main() {
  const accessKeyId = env('OTS_ACCESS_KEY_ID') || env('OSS_ACCESS_KEY_ID');
  const accessKeySecret = env('OTS_ACCESS_KEY_SECRET') || env('OSS_ACCESS_KEY_SECRET');
  if (!accessKeyId || !accessKeySecret) {
    console.error('[patch-fc-env-queue-cost] 缺少 AccessKey');
    process.exit(1);
  }
  const targets = [
    {
      region: env('FC_REGION_HK') || 'cn-hongkong',
      functionName: env('FC_FUNCTION_NAME_HK') || env('FC_FUNCTION_NAME') || 'nexflow-api',
    },
    {
      region: env('FC_REGION_BJ') || 'cn-beijing',
      functionName: env('FC_FUNCTION_NAME_BJ') || 'aixflow-api',
    },
  ];

  const require = ensureFcSdk();
  const Fc20230330 = require('@alicloud/fc20230330');
  const OpenApi = require('@alicloud/openapi-client');
  const Util = require('@alicloud/tea-util');
  const report = { patch: PATCH, results: [] };

  for (const { region, functionName } of targets) {
    const config = new OpenApi.Config({
      accessKeyId,
      accessKeySecret,
      endpoint: `fcv3.${region}.aliyuncs.com`,
    });
    const client = new Fc20230330.default(config);
    const getReq = new Fc20230330.GetFunctionRequest({});
    const fn = await client.getFunctionWithOptions(
      functionName,
      getReq,
      {},
      new Util.RuntimeOptions({}),
    );
    const body = fn?.body || fn;
    const existing = body?.environmentVariables || {};
    const merged = { ...existing, ...PATCH };
    const updateInput = new Fc20230330.UpdateFunctionInput({});
    updateInput.environmentVariables = merged;
    const req = new Fc20230330.UpdateFunctionRequest({});
    req.body = updateInput;
    await client.updateFunctionWithOptions(functionName, req, {}, new Util.RuntimeOptions({}));
    const row = {
      region,
      functionName,
      applied: {
        NX_QUEUE_IDLE_PROBE_MS: merged.NX_QUEUE_IDLE_PROBE_MS,
        NX_QUEUE_IDLE_FULL_SWEEP_MS: merged.NX_QUEUE_IDLE_FULL_SWEEP_MS,
        NX_QUEUE_TIMER_TICK_MS: merged.NX_QUEUE_TIMER_TICK_MS,
        NX_TASK_WORK_FALLBACK_ON_EMPTY: merged.NX_TASK_WORK_FALLBACK_ON_EMPTY,
      },
    };
    report.results.push(row);
    console.log(`[patch-fc-env-queue-cost] ✓ ${region}/${functionName}`, row.applied);
  }

  const out = path.join(__dirname, 'patch-fc-env-queue-cost-result.json');
  const fs = await import('fs');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`[patch-fc-env-queue-cost] wrote ${out}`);
}

main().catch((e) => {
  console.error('[patch-fc-env-queue-cost]', e?.message || e);
  process.exit(1);
});
