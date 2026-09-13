/**
 * Diagnose RH.ai gemini-omni-flash submit response (no queue/charge).
 * node scripts/diag-gemini-omni-flash-ai.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execSync } from 'child_process';

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

async function hydrateRhFromFcHk() {
  const requireFromRoot = createRequire(path.join(ROOT, 'package.json'));
  try {
    requireFromRoot.resolve('@alicloud/fc20230330');
  } catch {
    execSync(
      'npm install --no-save @alicloud/fc20230330@^4.2.0 @alicloud/openapi-client @alicloud/tea-util',
      { cwd: ROOT, stdio: 'pipe' },
    );
  }
  const Fc20230330 = requireFromRoot('@alicloud/fc20230330');
  const OpenApi = requireFromRoot('@alicloud/openapi-client');
  const Util = requireFromRoot('@alicloud/tea-util');
  const accessKeyId = process.env.OTS_ACCESS_KEY_ID?.trim() || process.env.OSS_ACCESS_KEY_ID?.trim() || '';
  const accessKeySecret =
    process.env.OTS_ACCESS_KEY_SECRET?.trim() || process.env.OSS_ACCESS_KEY_SECRET?.trim() || '';
  if (!accessKeyId || !accessKeySecret) return { ok: false, reason: 'NO_ALIYUN_AK' };
  const config = new OpenApi.Config({
    accessKeyId,
    accessKeySecret,
    endpoint: 'fcv3.cn-hongkong.aliyuncs.com',
  });
  const client = new Fc20230330.default(config);
  const fn = await client.getFunctionWithOptions(
    process.env.FC_FUNCTION_NAME_HK?.trim() || 'nexflow-api',
    new Fc20230330.GetFunctionRequest({}),
    {},
    new Util.RuntimeOptions({}),
  );
  const envMap = fn?.body?.environmentVariables || {};
  for (const k of Object.keys(envMap)) {
    if (k.startsWith('RUNNINGHUB_') && typeof envMap[k] === 'string' && envMap[k].trim()) {
      process.env[k] = envMap[k].trim();
    }
  }
  return {
    ok: true,
    has_ai_key: Boolean(process.env.RUNNINGHUB_API_KEY_AI?.trim()),
  };
}

const hydrate = await hydrateRhFromFcHk();
const OUT = path.join(__dirname, 'phase9-5-b2-b-gemini-rh-diag-result.json');
if (!hydrate.ok || !hydrate.has_ai_key) {
  const r = { conclusion: 'BLOCKED', hydrate };
  fs.writeFileSync(OUT, JSON.stringify(r, null, 2));
  console.log(JSON.stringify(r, null, 2));
  process.exit(2);
}

const { submitRunningHub } = await import('../lib/providerRhClient.mjs');
const OSS =
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p93d-i2v-test/1788607602254_b2eac80c.jpg';

const forward = {
  provider: 'runninghub',
  path: '/gemini-omni-flash/image-to-video',
  method: 'POST',
  rhRegion: 'ai',
  billingModelId: 'gemini-omni-flash-720p-10s',
  body: {
    prompt: 'diag gemini omni flash single still to calm motion',
    imageUrls: [OSS],
    duration: '10',
    resolution: '720p',
    aspectRatio: '16:9',
  },
};

const submit = await submitRunningHub(forward, { timeoutMs: 120000 });
const data = submit?.data || {};
const code = data?.code ?? data?.errorCode ?? data?.error_code;
const msg = data?.message || data?.msg || data?.errorMessage || data?.error_msg || '';
const report = {
  conclusion:
    submit.ok && submit.provider_task_id
      ? 'RH_ACCEPT'
      : String(code) === '605' || /余额|insufficient|balance/i.test(String(msg))
        ? 'BLOCKED_EXTERNAL_BALANCE'
        : submit.ok && !submit.provider_task_id
          ? 'NO_TASK_ID'
          : 'RH_REJECT',
  ok: submit.ok,
  provider_task_id: submit.provider_task_id || '',
  region: submit.region,
  reason: submit.reason || '',
  http_status: submit.http_status,
  rh_code: code,
  rh_msg: String(msg).slice(0, 300),
  data_keys: Object.keys(data || {}),
  data_preview: JSON.parse(
    JSON.stringify(data, (k, v) => (typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v)),
  ),
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.conclusion === 'RH_ACCEPT' ? 0 : 1);
