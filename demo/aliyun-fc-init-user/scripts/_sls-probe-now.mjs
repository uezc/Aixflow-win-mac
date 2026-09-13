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
const to = Math.floor(Date.now() / 1000);
const from = to - 3600;
for (const q of ['*', 'timer', 'nexflow', 'run-queue', 'idle_no_patrol']) {
  const req = new Sls.GetLogsRequest({ from, to, query: q, line: 3, offset: 0, reverse: true });
  try {
    const resp = await client.getLogsWithOptions(project, logstore, req, {}, runtime);
    const rows = Array.isArray(resp.body) ? resp.body : [];
    const sample = String(rows[0]?.message || rows[0]?.content || JSON.stringify(rows[0] || {})).slice(0, 160);
    console.log(JSON.stringify({ q, n: rows.length, sample }));
  } catch (e) {
    console.log(JSON.stringify({ q, err: e.message }));
  }
}
