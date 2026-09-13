/**
 * Invoke HK nexflow-api once with timer-like payload (read-only effect when idle).
 * Verifies new idle_no_patrol path after deploy.
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvFile(path.join(REPO, '.env'));
loadEnvFile(path.join(ROOT, '.env'));

const require = createRequire(path.join(ROOT, 'package.json'));
const Fc20230330 = require('@alicloud/fc20230330');
const OpenApi = require('@alicloud/openapi-client');
const Util = require('@alicloud/tea-util');

const ak = process.env.OTS_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_ID;
const sk = process.env.OTS_ACCESS_KEY_SECRET || process.env.OSS_ACCESS_KEY_SECRET;
const config = new OpenApi.Config({
  accessKeyId: ak,
  accessKeySecret: sk,
  endpoint: 'fcv3.cn-hongkong.aliyuncs.com',
});
config.readTimeout = 120000;
const client = new Fc20230330.default(config);
const runtime = new Util.RuntimeOptions({ readTimeout: 120000 });

const event = {
  triggerTime: new Date().toISOString(),
  triggerName: 'nexflow-queue-pipeline',
  payload: {
    action: 'run-queue-pipeline',
    max_claims: 20,
    max_charge: 40,
    max_dispatch: 20,
    max_poll: 40,
    reconcile: false,
  },
};

const req = new Fc20230330.InvokeFunctionRequest({});
req.body = Buffer.from(JSON.stringify(event));
const headers = { 'x-fc-invocation-type': 'Sync' };
const started = Date.now();
const resp = await client.invokeFunctionWithOptions('nexflow-api', req, headers, {}, runtime);
const elapsed = Date.now() - started;
let body = resp?.body;
if (body && typeof body.read === 'function') {
  const chunks = [];
  for await (const c of body) chunks.push(c);
  body = Buffer.concat(chunks).toString('utf8');
} else if (Buffer.isBuffer(body)) {
  body = body.toString('utf8');
} else if (typeof body !== 'string') {
  body = JSON.stringify(body);
}
let parsed = null;
try {
  parsed = JSON.parse(body);
  if (parsed?.body && typeof parsed.body === 'string') {
    try {
      parsed.body = JSON.parse(parsed.body);
    } catch (_) {}
  }
} catch (_) {}
const out = {
  invoke_ms: elapsed,
  statusCode: resp?.statusCode || parsed?.statusCode,
  idle_no_patrol: parsed?.body?.idle_no_patrol ?? parsed?.idle_no_patrol,
  idle_short_circuit: parsed?.body?.idle_short_circuit ?? parsed?.idle_short_circuit,
  elapsed_ms: parsed?.body?.elapsed_ms ?? parsed?.elapsed_ms,
  summary: parsed?.body?.summary ?? parsed?.summary,
  detail: parsed?.body?.idle_short_circuit_detail ?? parsed?.idle_short_circuit_detail,
  raw_head: String(body || '').slice(0, 800),
};
console.log(JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(__dirname, '_invoke-pipeline-result.json'), JSON.stringify(out, null, 2));
