/**
 * 对照：同一请求打到 runninghub.ai（不经 AIXFLOW queue）
 * 不打印 API Key。
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

async function hydrateFromFc() {
  const requireFromRoot = createRequire(path.join(ROOT, 'package.json'));
  try {
    requireFromRoot.resolve('@alicloud/fc20230330');
  } catch {
    execSync('npm install --no-save @alicloud/fc20230330@^4.2.0 @alicloud/openapi-client @alicloud/tea-util', {
      cwd: ROOT,
      stdio: 'pipe',
    });
  }
  const Fc20230330 = requireFromRoot('@alicloud/fc20230330');
  const OpenApi = requireFromRoot('@alicloud/openapi-client');
  const Util = requireFromRoot('@alicloud/tea-util');
  const accessKeyId = process.env.OTS_ACCESS_KEY_ID?.trim() || process.env.OSS_ACCESS_KEY_ID?.trim() || '';
  const accessKeySecret =
    process.env.OTS_ACCESS_KEY_SECRET?.trim() || process.env.OSS_ACCESS_KEY_SECRET?.trim() || '';
  const config = new OpenApi.Config({
    accessKeyId,
    accessKeySecret,
    endpoint: 'fcv3.cn-hongkong.aliyuncs.com',
  });
  const client = new Fc20230330.default(config);
  const fn = await client.getFunctionWithOptions(
    'nexflow-api',
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
}

await hydrateFromFc();

const { pickRunningHubTarget, buildRunningHubForwardUrl, extractRhTaskIdFromForwardData } =
  await import('../lib/runningHubTarget.mjs');

const PATH = '/rhart-video-s/text-to-video';
const body = {
  prompt: 'Phase81 RH AI-endpoint diagnostic: soft daylight forest path, static camera.',
  duration: '10',
  aspectRatio: '16:9',
};

const rhTarget = pickRunningHubTarget(PATH, { regionHint: 'ai' });
const url = buildRunningHubForwardUrl(PATH, rhTarget);
const keyPresent = Boolean(rhTarget.apiKey?.trim());

const out = {
  region: rhTarget.region,
  api_base: rhTarget.base,
  final_url: url,
  api_key_present: keyPresent,
  request_body: body,
};

if (!keyPresent) {
  out.error = 'RUNNINGHUB_API_KEY_AI missing on FC';
  console.log(JSON.stringify(out, null, 2));
  process.exit(2);
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
const tid = extractRhTaskIdFromForwardData(json || {});
out.response = {
  http_status: res.status,
  content_type: res.headers.get('content-type') || '',
  raw_body: raw.slice(0, 4000),
  json,
  parsed_taskId: tid || '',
  created_task: Boolean(tid),
};

if (tid) {
  const qUrl = buildRunningHubForwardUrl('/query', rhTarget);
  const qRes = await fetch(qUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${rhTarget.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ taskId: tid }),
  });
  const qRaw = await qRes.text();
  let qJson = null;
  try {
    qJson = JSON.parse(qRaw);
  } catch {
    qJson = null;
  }
  out.query = { http_status: qRes.status, raw_body: qRaw.slice(0, 2000), json: qJson };
}

fs.writeFileSync(path.join(__dirname, 'phase8-1-rh-diag-ai-result.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
