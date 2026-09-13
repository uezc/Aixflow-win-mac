/**
 * Pull a few nx_tasks-matching log lines in 21-22 and 22-23 to see WHY the keyword hits.
 */
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import fs from 'fs';

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

async function sample(fromIso, toIso, query, n = 8) {
  const from = Math.floor(Date.parse(fromIso) / 1000);
  const to = Math.floor(Date.parse(toIso) / 1000);
  const req = new Sls.GetLogsRequest({ from, to, query, line: n, offset: 0, reverse: true });
  const resp = await client.getLogsWithOptions(project, logstore, req, {}, runtime);
  const rows = Array.isArray(resp.body) ? resp.body : [];
  return rows.map((r) => {
    const msg = String(r.message || r.content || JSON.stringify(r)).slice(0, 280);
    return msg;
  });
}

const out = {
  '21-22_nx_tasks': await sample('2026-09-08T13:00:00Z', '2026-09-08T14:00:00Z', 'nx_tasks'),
  '22-23_nx_tasks': await sample('2026-09-08T14:00:00Z', '2026-09-08T15:00:00Z', 'nx_tasks'),
  '22-23_not_timer': await sample(
    '2026-09-08T14:00:00Z',
    '2026-09-08T15:00:00Z',
    'not "timer:run-queue-pipeline"',
  ),
  '17-18_timer_sample': await sample('2026-09-08T09:00:00Z', '2026-09-08T10:00:00Z', '"timer:run-queue-pipeline"', 3),
};
console.log(JSON.stringify(out, null, 2));
