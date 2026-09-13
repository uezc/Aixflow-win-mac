/**
 * 双地域 FC：写入 Phase1 资源池并发环境变量（显式 100）
 *   node scripts/patch-fc-env-resource-pools.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execSync } from 'child_process';
import fs from 'fs';
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
  GLOBAL_CN_VIDEO_CONCURRENCY: '100',
  GLOBAL_CN_IMAGE_CONCURRENCY: '100',
  GLOBAL_OVERSEAS_VIDEO_CONCURRENCY: '100',
  GLOBAL_OVERSEAS_IMAGE_CONCURRENCY: '100',
  GLOBAL_AUDIO_CONCURRENCY: '100',
};

async function main() {
  const accessKeyId = env('OTS_ACCESS_KEY_ID') || env('OSS_ACCESS_KEY_ID');
  const accessKeySecret = env('OTS_ACCESS_KEY_SECRET') || env('OSS_ACCESS_KEY_SECRET');
  if (!accessKeyId || !accessKeySecret) {
    console.error('[patch-fc-env-resource-pools] 缺少 AccessKey');
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
  const report = { patch: PATCH, before: {}, results: [] };

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
    report.before[`${region}/${functionName}`] = {
      GLOBAL_CN_VIDEO_CONCURRENCY: existing.GLOBAL_CN_VIDEO_CONCURRENCY ?? null,
      GLOBAL_CN_IMAGE_CONCURRENCY: existing.GLOBAL_CN_IMAGE_CONCURRENCY ?? null,
      GLOBAL_OVERSEAS_VIDEO_CONCURRENCY: existing.GLOBAL_OVERSEAS_VIDEO_CONCURRENCY ?? null,
      GLOBAL_OVERSEAS_IMAGE_CONCURRENCY: existing.GLOBAL_OVERSEAS_IMAGE_CONCURRENCY ?? null,
      GLOBAL_AUDIO_CONCURRENCY: existing.GLOBAL_AUDIO_CONCURRENCY ?? null,
      GLOBAL_VIDEO_CONCURRENCY: existing.GLOBAL_VIDEO_CONCURRENCY ?? null,
      GLOBAL_IMAGE_CONCURRENCY: existing.GLOBAL_IMAGE_CONCURRENCY ?? null,
    };
    const merged = { ...existing, ...PATCH };
    const updateInput = new Fc20230330.UpdateFunctionInput({});
    updateInput.environmentVariables = merged;
    const req = new Fc20230330.UpdateFunctionRequest({});
    req.body = updateInput;
    await client.updateFunctionWithOptions(functionName, req, {}, new Util.RuntimeOptions({}));
    const row = {
      region,
      functionName,
      lastModified: body?.lastModifiedTime || body?.lastModified,
      applied: Object.fromEntries(Object.keys(PATCH).map((k) => [k, merged[k]])),
    };
    report.results.push(row);
    console.log(`[patch-fc-env-resource-pools] ✓ ${region}/${functionName}`, row.applied);
  }

  const out = path.join(__dirname, 'patch-fc-env-resource-pools-result.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`[patch-fc-env-resource-pools] wrote ${out}`);
}

main().catch((e) => {
  console.error('[patch-fc-env-resource-pools]', e?.message || e);
  process.exit(1);
});
