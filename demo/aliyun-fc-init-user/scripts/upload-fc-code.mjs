/**
 * 将 nexflow-fc.zip 上传 OSS 后，用 FC3 UpdateFunction 覆盖北京/香港函数代码。
 * 凭证从仓库 .env 读取（OTS_* 或 OSS_*）；不向 stdout 打印密钥。
 *
 * 用法：node scripts/upload-fc-code.mjs
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
const ZIP = path.join(ROOT, 'nexflow-fc.zip');

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
    console.log('[upload-fc] 安装 @alicloud/fc20230330 …');
    execSync('npm install --no-save @alicloud/fc20230330@^4.2.0 @alicloud/openapi-client @alicloud/tea-util', {
      cwd: ROOT,
      stdio: 'inherit',
    });
    return createRequire(path.join(ROOT, 'package.json'));
  }
}

async function main() {
  if (!fs.existsSync(ZIP)) {
    console.error('[upload-fc] 缺少', ZIP, '请先 npm run deploy');
    process.exit(1);
  }

  const accessKeyId = env('OTS_ACCESS_KEY_ID') || env('OSS_ACCESS_KEY_ID') || env('ALIBABA_CLOUD_ACCESS_KEY_ID');
  const accessKeySecret =
    env('OTS_ACCESS_KEY_SECRET') || env('OSS_ACCESS_KEY_SECRET') || env('ALIBABA_CLOUD_ACCESS_KEY_SECRET');
  const ossAk = env('OSS_ACCESS_KEY_ID') || accessKeyId;
  const ossSk = env('OSS_ACCESS_KEY_SECRET') || accessKeySecret;
  const bucket = env('OSS_BUCKET');
  const ossEndpoint = env('OSS_ENDPOINT').replace(/^https?:\/\//, '');
  const functionNameDefault = env('FC_FUNCTION_NAME') || 'nexflow-api';
  const targets = [
    {
      region: env('FC_REGION_BJ') || 'cn-beijing',
      functionName: env('FC_FUNCTION_NAME_BJ') || 'aixflow-api',
    },
    {
      region: env('FC_REGION_HK') || 'cn-hongkong',
      functionName: env('FC_FUNCTION_NAME_HK') || functionNameDefault,
    },
  ];

  if (!accessKeyId || !accessKeySecret) {
    console.error('[upload-fc] 缺少 AccessKey（OTS_ACCESS_KEY_ID / OSS_ACCESS_KEY_ID）');
    process.exit(1);
  }
  if (!bucket || !ossEndpoint) {
    console.error('[upload-fc] 缺少 OSS_BUCKET / OSS_ENDPOINT');
    process.exit(1);
  }

  const require = ensureFcSdk();
  const Fc20230330 = require('@alicloud/fc20230330');
  const OpenApi = require('@alicloud/openapi-client');
  const Util = require('@alicloud/tea-util');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const objectKey = `fc-deploys/nexflow-fc-${stamp}.zip`;
  console.log('[upload-fc] 上传 OSS:', bucket, objectKey, `(${(fs.statSync(ZIP).size / 1024 / 1024).toFixed(2)} MB)`);

  const OSS = require('ali-oss');
  const oss = new OSS({
    accessKeyId: ossAk,
    accessKeySecret: ossSk,
    bucket,
    endpoint: ossEndpoint.startsWith('http') ? ossEndpoint : `https://${ossEndpoint}`,
    timeout: 120000,
  });
  await oss.put(objectKey, ZIP);
  console.log('[upload-fc] OSS 上传完成');

  for (const { region, functionName } of targets) {
    console.log(`[upload-fc] 更新函数 ${functionName} @ ${region} …`);
    const config = new OpenApi.Config({
      accessKeyId,
      accessKeySecret,
      endpoint: `fcv3.${region}.aliyuncs.com`,
    });
    config.readTimeout = 180000;
    config.connectTimeout = 60000;
    const client = new Fc20230330.default(config);
    const bodyInput = new Fc20230330.UpdateFunctionInput({});
    // 剧本分析等长 LLM：平台默认常为 60–120s，会 502；提到 300s（与客户端 axios 对齐）
    bodyInput.timeout = 300;
    // 香港可用跨区 OSS；北京函数角色若无 OSS 读权限则改走 zipFile
    if (region === 'cn-beijing') {
      bodyInput.code = new Fc20230330.InputCodeLocation({
        zipFile: fs.readFileSync(ZIP).toString('base64'),
      });
    } else {
      bodyInput.code = new Fc20230330.InputCodeLocation({
        ossBucketName: bucket,
        ossObjectName: objectKey,
      });
    }
    const req = new Fc20230330.UpdateFunctionRequest({});
    req.body = bodyInput;
    const runtime = new Util.RuntimeOptions({
      readTimeout: 180000,
      connectTimeout: 60000,
      autoretry: true,
      maxAttempts: 3,
    });
    try {
      const resp = await client.updateFunctionWithOptions(functionName, req, {}, runtime);
      const body = resp?.body || resp;
      console.log(
        `[upload-fc] ✓ ${region}/${functionName} codeSize=${body?.codeSize ?? '?'} lastModified=${body?.lastModifiedTime ?? body?.lastModified ?? '?'}`,
      );
    } catch (e) {
      console.error(`[upload-fc] ✗ ${region}/${functionName}:`, e?.message || e);
      if (e?.data) console.error('[upload-fc] detail:', JSON.stringify(e.data));
      process.exitCode = 1;
    }
  }

  if (!process.exitCode) {
    console.log('[upload-fc] 全部完成。请回客户端刷新账单列表验证分页。');
  }
}

main().catch((e) => {
  console.error('[upload-fc] failed:', e?.message || e);
  process.exit(1);
});
