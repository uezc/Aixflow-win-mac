/**
 * 为 HK/BJ FC 函数设置 VIDEO_QUEUE_ENABLED=1（不打印密钥）
 * node scripts/patch-fc-env-video-queue.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '../../');
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
    execSync('npm install --no-save @alicloud/fc20230330@^4.2.0 @alicloud/openapi-client @alicloud/tea-util', {
      cwd: ROOT,
      stdio: 'inherit',
    });
    return createRequire(path.join(ROOT, 'package.json'));
  }
}

async function main() {
  const accessKeyId = env('OTS_ACCESS_KEY_ID') || env('OSS_ACCESS_KEY_ID');
  const accessKeySecret = env('OTS_ACCESS_KEY_SECRET') || env('OSS_ACCESS_KEY_SECRET');
  if (!accessKeyId || !accessKeySecret) {
    console.error('[patch-fc-env] 缺少 AccessKey');
    process.exit(1);
  }
  const targets = [
    { region: env('FC_REGION_BJ') || 'cn-beijing', functionName: env('FC_FUNCTION_NAME_BJ') || 'aixflow-api' },
    { region: env('FC_REGION_HK') || 'cn-hongkong', functionName: env('FC_FUNCTION_NAME_HK') || 'nexflow-api' },
  ];

  const require = ensureFcSdk();
  const Fc20230330 = require('@alicloud/fc20230330');
  const OpenApi = require('@alicloud/openapi-client');
  const Util = require('@alicloud/tea-util');

  for (const { region, functionName } of targets) {
    const config = new OpenApi.Config({
      accessKeyId,
      accessKeySecret,
      endpoint: `fcv3.${region}.aliyuncs.com`,
    });
    const client = new Fc20230330.default(config);
    const getReq = new Fc20230330.GetFunctionRequest({});
    const fn = await client.getFunctionWithOptions(functionName, getReq, {}, new Util.RuntimeOptions({}));
    const body = fn?.body || fn;
    const existing = body?.environmentVariables || {};
    const merged = { ...existing, VIDEO_QUEUE_ENABLED: '1' };
    const updateInput = new Fc20230330.UpdateFunctionInput({});
    updateInput.environmentVariables = merged;
    const req = new Fc20230330.UpdateFunctionRequest({});
    req.body = updateInput;
    await client.updateFunctionWithOptions(functionName, req, {}, new Util.RuntimeOptions({}));
    console.log(`[patch-fc-env] ✓ ${region}/${functionName} VIDEO_QUEUE_ENABLED=1`);
  }
}

main().catch((e) => {
  console.error('[patch-fc-env]', e?.message || e);
  process.exit(1);
});
