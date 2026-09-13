/**
 * Smoke only: rhart-video-x 文生 → .ai /rhart-video-g/text-to-video
 * 不经 AIXFLOW queue/charge；不修改任何生产代码。
 * Key 从 HK FC 环境注入（不打印）。
 *
 * node scripts/smoke-rhart-video-x-t2v-ai.mjs
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
    has_cn_key: Boolean(process.env.RUNNINGHUB_API_KEY?.trim()),
  };
}

const hydrate = await hydrateRhFromFcHk();
if (!hydrate.ok) {
  console.log(JSON.stringify({ conclusion: 'BLOCKED', reason: hydrate.reason }, null, 2));
  process.exit(2);
}
if (!hydrate.has_ai_key) {
  console.log(
    JSON.stringify(
      {
        conclusion: 'BLOCKED',
        reason: 'RUNNINGHUB_API_KEY_AI missing on FC HK',
      },
      null,
      2,
    ),
  );
  process.exit(2);
}

const {
  pickRunningHubTarget,
  buildRunningHubForwardUrl,
  forceOverseasByBillingOrPath,
  pathMatchesOverseasPrefix,
  extractRhTaskIdFromForwardData,
} = await import('../lib/runningHubTarget.mjs');

// 与 VideoProvider rhart-video-x 文生一致
const PATH = '/rhart-video-g/text-to-video';
const BILLING = 'rhart-video-x';
const body = {
  prompt: 'Smoke test rhart-video-x: soft daylight meadow, static camera, no text overlay.',
  aspectRatio: '16:9',
  resolution: '720p',
  duration: 10,
};

// 使用 AIXFLOW 现有选站逻辑（不改路由）：billing + path 应强制海外
const forceAi = forceOverseasByBillingOrPath(PATH, BILLING);
const pathOverseas = pathMatchesOverseasPrefix(PATH);
const regionHint = forceAi ? 'ai' : null;
const rhTarget = pickRunningHubTarget(PATH, { regionHint });
const url = buildRunningHubForwardUrl(PATH, rhTarget);

const report = {
  model: 'rhart-video-x',
  mapping: {
    forceOverseasByBillingOrPath: forceAi,
    pathMatchesOverseasPrefix: pathOverseas,
    region_selected: rhTarget.region,
    api_base: rhTarget.base,
    final_url: url,
    api_key_env: rhTarget.region === 'ai' ? 'RUNNINGHUB_API_KEY_AI' : 'RUNNINGHUB_API_KEY',
    api_key_present: Boolean(rhTarget.apiKey?.trim()),
  },
  request: {
    method: 'POST',
    content_type: 'application/json',
    authorization: 'Bearer ***REDACTED***',
    body,
  },
  submit: null,
  query: null,
  conclusion: 'FAIL',
};

if (rhTarget.region !== 'ai') {
  report.conclusion = 'FAIL';
  report.note = 'Existing routing did not select .ai for rhart-video-x — unexpected';
  fs.writeFileSync(path.join(__dirname, 'smoke-rhart-video-x-t2v-ai-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

const res = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${rhTarget.apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
});
const raw = await res.text();
let json = null;
try {
  json = JSON.parse(raw);
} catch {
  json = null;
}
const taskId = extractRhTaskIdFromForwardData(json || {}) || '';
report.submit = {
  http_status: res.status,
  ok: res.ok,
  content_type: res.headers.get('content-type') || '',
  raw_body: raw.slice(0, 4000),
  json,
  taskId,
  errorCode: json?.errorCode ?? null,
  errorMessage: json?.errorMessage ?? null,
  status: json?.status ?? null,
};

if (!res.ok || !taskId) {
  report.conclusion = res.status === 401 || res.status === 403 ? 'BLOCKED' : 'FAIL';
  fs.writeFileSync(path.join(__dirname, 'smoke-rhart-video-x-t2v-ai-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.conclusion === 'BLOCKED' ? 2 : 1);
}

const qUrl = buildRunningHubForwardUrl('/query', rhTarget);
const qRes = await fetch(qUrl, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${rhTarget.apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ taskId }),
});
const qRaw = await qRes.text();
let qJson = null;
try {
  qJson = JSON.parse(qRaw);
} catch {
  qJson = null;
}
const qStatus = String(qJson?.status || '').toUpperCase();
report.query = {
  http_status: qRes.status,
  raw_body: qRaw.slice(0, 2000),
  json: qJson,
  status: qStatus,
};

const okStatus = ['QUEUED', 'RUNNING', 'SUCCESS'].includes(qStatus);
report.conclusion = qRes.ok && okStatus ? 'PASS' : 'FAIL';

fs.writeFileSync(path.join(__dirname, 'smoke-rhart-video-x-t2v-ai-result.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.conclusion === 'PASS' ? 0 : 1);
