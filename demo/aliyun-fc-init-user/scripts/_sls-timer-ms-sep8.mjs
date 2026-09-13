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
const Sls = require('@alicloud/sls20201230');
const OpenApi = require('@alicloud/openapi-client');
const Util = require('@alicloud/tea-util');
const client = new Sls.default(
  new OpenApi.Config({
    accessKeyId: process.env.OTS_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OTS_ACCESS_KEY_SECRET || process.env.OSS_ACCESS_KEY_SECRET,
    endpoint: 'cn-hongkong.log.aliyuncs.com',
  }),
);
const runtime = new Util.RuntimeOptions({ readTimeout: 60000 });
const project = 'serverless-cn-hongkong-19bf0789-a97c-5b1d-953a-7c77f8773286';
const logstore = 'default-logs';

async function timerMs(label, fromIso, toIso) {
  const from = Math.floor(Date.parse(fromIso) / 1000);
  const to = Math.floor(Date.parse(toIso) / 1000);
  const all = [];
  let offset = 0;
  for (;;) {
    const req = new Sls.GetLogsRequest({
      from,
      to,
      query: '"timer:run-queue-pipeline"',
      line: 100,
      offset,
      reverse: false,
    });
    const resp = await client.getLogsWithOptions(project, logstore, req, {}, runtime);
    const rows = Array.isArray(resp.body) ? resp.body : [];
    all.push(...rows);
    if (rows.length < 100) break;
    offset += rows.length;
  }
  const ms = [];
  for (const row of all) {
    const m = String(row.message || '').match(/ms=(\d+)/);
    if (m) ms.push(Number(m[1]));
  }
  ms.sort((a, b) => a - b);
  return {
    label,
    count: ms.length,
    min: ms[0] ?? null,
    max: ms[ms.length - 1] ?? null,
    median: ms[Math.floor(ms.length / 2)] ?? null,
    gt5s: ms.filter((x) => x > 5000).length,
    gt20s: ms.filter((x) => x > 20000).length,
    avg: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null,
  };
}

const out = [];
for (const w of [
  ['17-18', '2026-09-08T09:00:00Z', '2026-09-08T10:00:00Z'],
  ['18-19', '2026-09-08T10:00:00Z', '2026-09-08T11:00:00Z'],
  ['19a', '2026-09-08T11:00:00Z', '2026-09-08T11:13:49Z'],
  ['19b', '2026-09-08T11:13:49Z', '2026-09-08T12:00:00Z'],
  ['20-21', '2026-09-08T12:00:00Z', '2026-09-08T13:00:00Z'],
  ['21-22', '2026-09-08T13:00:00Z', '2026-09-08T14:00:00Z'],
  ['22-23', '2026-09-08T14:00:00Z', '2026-09-08T15:00:00Z'],
]) {
  out.push(await timerMs(...w));
}
console.log(JSON.stringify(out, null, 2));
