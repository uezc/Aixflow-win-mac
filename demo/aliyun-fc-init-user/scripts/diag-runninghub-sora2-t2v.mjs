/**
 * Phase 8.1 诊断：直连 RunningHub text-to-video（不经 AIXFLOW queue/charge/slot）
 * 不打印 API Key / Authorization。
 *
 * node scripts/diag-runninghub-sora2-t2v.mjs
 */
import fs from 'fs';
import path from 'path';
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvFile(path.join(REPO, '.env'));
loadEnvFile(path.join(ROOT, '.env'));

/** 本地 .env 常缺 RH Key：从 HK FC 环境变量注入到 process.env（不打印值） */
async function hydrateRhKeyFromFcIfNeeded() {
  const has =
    process.env.RUNNINGHUB_API_KEY?.trim() ||
    process.env.RUNNINGHUB_API_KEY_CN?.trim() ||
    process.env.RUNNINGHUB_API_KEY_AI?.trim();
  if (has) return { source: 'local_env' };
  const { createRequire } = await import('module');
  const { execSync } = await import('child_process');
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
  const accessKeyId =
    process.env.OTS_ACCESS_KEY_ID?.trim() || process.env.OSS_ACCESS_KEY_ID?.trim() || '';
  const accessKeySecret =
    process.env.OTS_ACCESS_KEY_SECRET?.trim() || process.env.OSS_ACCESS_KEY_SECRET?.trim() || '';
  if (!accessKeyId || !accessKeySecret) return { source: 'fc_unavailable_no_ak' };
  const region = process.env.FC_REGION_HK?.trim() || 'cn-hongkong';
  const functionName = process.env.FC_FUNCTION_NAME_HK?.trim() || 'nexflow-api';
  const config = new OpenApi.Config({
    accessKeyId,
    accessKeySecret,
    endpoint: `fcv3.${region}.aliyuncs.com`,
  });
  const client = new Fc20230330.default(config);
  const getReq = new Fc20230330.GetFunctionRequest({});
  const fn = await client.getFunctionWithOptions(functionName, getReq, {}, new Util.RuntimeOptions({}));
  const envMap = fn?.body?.environmentVariables || fn?.environmentVariables || {};
  const keys = ['RUNNINGHUB_API_KEY', 'RUNNINGHUB_API_KEY_CN', 'RUNNINGHUB_API_KEY_AI', 'RUNNINGHUB_API_BASE', 'RUNNINGHUB_API_BASE_CN', 'RUNNINGHUB_API_BASE_AI'];
  let injected = 0;
  for (const k of keys) {
    const v = envMap[k];
    if (typeof v === 'string' && v.trim() && !process.env[k]?.trim()) {
      process.env[k] = v.trim();
      injected += 1;
    }
  }
  return {
    source: 'fc_hk_env',
    region,
    functionName,
    injected_env_names: keys.filter((k) => Boolean(process.env[k]?.trim())),
    injected,
  };
}

const hydrate = await hydrateRhKeyFromFcIfNeeded();

const {
  pickRunningHubTarget,
  buildRunningHubForwardUrl,
  forceOverseasByBillingOrPath,
  extractRhTaskIdFromForwardData,
  pathMatchesOverseasPrefix,
} = await import('../lib/runningHubTarget.mjs');

const PATH = '/rhart-video-s/text-to-video';
const BILLING = 'sora-2';
const body = {
  prompt: 'Phase81 RH diagnostic only: soft daylight forest path, static camera, no text.',
  duration: '10',
  aspectRatio: '16:9',
};

const forceAi = forceOverseasByBillingOrPath(PATH, BILLING);
const overseasPath = pathMatchesOverseasPrefix(PATH);
const regionHint = forceAi ? 'ai' : null;
const rhTarget = pickRunningHubTarget(PATH, { regionHint });
const url = buildRunningHubForwardUrl(PATH, rhTarget);

const keyPresent = Boolean(String(rhTarget.apiKey || '').trim());
const keySource =
  rhTarget.region === 'ai'
    ? 'RUNNINGHUB_API_KEY_AI'
    : process.env.RUNNINGHUB_API_KEY?.trim()
      ? 'RUNNINGHUB_API_KEY'
      : process.env.RUNNINGHUB_API_KEY_CN?.trim()
        ? 'RUNNINGHUB_API_KEY_CN'
        : '(none)';

const report = {
  started_at: new Date().toISOString(),
  credential_hydrate: {
    source: hydrate.source,
    region: hydrate.region || null,
    functionName: hydrate.functionName || null,
    injected_env_names: hydrate.injected_env_names || [],
  },
  mapping: {
    aixflow_model_id: 'sora-2',
    billing_model_id: BILLING,
    provider: 'runninghub',
    forward_path: PATH,
    forceOverseasByBillingOrPath: forceAi,
    pathMatchesOverseasPrefix: overseasPath,
    region_selected: rhTarget.region,
    api_base: rhTarget.base,
    final_url: url,
    api_key_present: keyPresent,
    api_key_env_name: keySource,
  },
  request: {
    method: 'POST',
    content_type: 'application/json',
    authorization: keyPresent ? 'Bearer ***REDACTED***' : '(missing)',
    body_field_names: Object.keys(body),
    body,
  },
  response: null,
  parser: null,
  conclusion_hints: [],
};

if (!keyPresent) {
  report.conclusion_hints.push('NO_API_KEY_IN_LOCAL_ENV');
  const outPath = path.join(__dirname, 'phase8-1-rh-diag-result.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.error('[diag] missing RH API key in local env — cannot call RH');
  process.exit(2);
}

const ac = new AbortController();
const timer = setTimeout(() => ac.abort(), 120_000);
let res;
let rawText = '';
let json = null;
try {
  res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${rhTarget.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: ac.signal,
  });
  rawText = await res.text();
  try {
    json = JSON.parse(rawText);
  } catch {
    json = null;
  }
} catch (e) {
  report.response = {
    error: e?.name === 'AbortError' ? 'ABORT_TIMEOUT' : String(e?.message || e),
  };
  const outPath = path.join(__dirname, 'phase8-1-rh-diag-result.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
} finally {
  clearTimeout(timer);
}

const headersSafe = {};
for (const [k, v] of res.headers.entries()) {
  const lk = k.toLowerCase();
  if (lk === 'authorization' || lk.includes('key') || lk.includes('token') || lk.includes('secret')) continue;
  headersSafe[k] = v;
}

const parsedTaskId = extractRhTaskIdFromForwardData(json || {});
report.response = {
  http_status: res.status,
  ok: res.ok,
  content_type: res.headers.get('content-type') || '',
  headers_safe: headersSafe,
  raw_body: rawText.slice(0, 8000),
  json,
  json_top_keys: json && typeof json === 'object' ? Object.keys(json) : [],
  nested_data_keys:
    json && json.data && typeof json.data === 'object' && !Array.isArray(json.data)
      ? Object.keys(json.data)
      : [],
};
report.parser = {
  extractRhTaskIdFromForwardData: parsedTaskId || '',
  looks_for: ['taskId', 'task_id', 'data.taskId', 'data.task_id'],
  submit_ok_would_be: res.ok,
  provider_no_task_id_would_trigger: Boolean(res.ok && !parsedTaskId),
};

if (parsedTaskId) {
  report.conclusion_hints.push('RH_CREATED_TASK_WITH_TASK_ID');
  report.created_provider_task_id = parsedTaskId;
  // 可选：立刻 query 确认（仍不经 AIXFLOW）
  try {
    const qUrl = buildRunningHubForwardUrl('/query', rhTarget);
    const qRes = await fetch(qUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${rhTarget.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ taskId: parsedTaskId }),
    });
    const qText = await qRes.text();
    let qJson = null;
    try {
      qJson = JSON.parse(qText);
    } catch {
      qJson = null;
    }
    report.query_after_create = {
      http_status: qRes.status,
      raw_body: qText.slice(0, 2000),
      json: qJson,
    };
  } catch (e) {
    report.query_after_create = { error: String(e?.message || e) };
  }
} else if (res.ok) {
  report.conclusion_hints.push('HTTP_200_BUT_NO_TASK_ID');
} else {
  report.conclusion_hints.push('HTTP_NON_OK');
}

const outPath = path.join(__dirname, 'phase8-1-rh-diag-result.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log('[diag] wrote', outPath);
