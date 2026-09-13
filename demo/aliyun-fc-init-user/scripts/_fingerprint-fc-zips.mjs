/** Download two FC deploy zips from OSS and fingerprint cost-related symbols. READ-ONLY. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
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
const env = (k) => String(process.env[k] || '').trim();
const require = createRequire(path.join(ROOT, 'package.json'));
const OSS = require('ali-oss');
const AdmZip = (() => {
  try {
    return require('adm-zip');
  } catch {
    return require(path.join(REPO, 'node_modules/adm-zip'));
  }
})();

const oss = new OSS({
  accessKeyId: env('OSS_ACCESS_KEY_ID') || env('OTS_ACCESS_KEY_ID'),
  accessKeySecret: env('OSS_ACCESS_KEY_SECRET') || env('OTS_ACCESS_KEY_SECRET'),
  bucket: env('OSS_BUCKET'),
  endpoint: env('OSS_ENDPOINT').startsWith('http')
    ? env('OSS_ENDPOINT')
    : `https://${env('OSS_ENDPOINT').replace(/^https?:\/\//, '')}`,
  timeout: 180000,
});

const keys = [
  'fc-deploys/nexflow-fc-2026-09-07T10-14-37-153Z.zip',
  'fc-deploys/nexflow-fc-2026-09-08T11-13-28-919Z.zip',
];
const dir = path.join(__dirname, '_fc_zip_probe');
fs.mkdirSync(dir, { recursive: true });

const markers = [
  'idle_zero_patrol',
  'countTaskWorkActive',
  'nx_task_work',
  'TASK_WORK_TABLE',
  'NX_TASK_WORK_FALLBACK_ON_EMPTY',
  'TASK_SCAN_COLUMNS',
  'runQueuePipeline',
  'adminAggregateDashboardStats',
  'columnToGet',
];

const report = [];
for (const key of keys) {
  const local = path.join(dir, path.basename(key));
  if (!fs.existsSync(local) || fs.statSync(local).size < 1000) {
    await oss.get(key, local);
  }
  const zip = new AdmZip(local);
  const names = zip.getEntries().map((e) => e.entryName.replace(/\\/g, '/'));
  const has = {
    'lib/runQueuePipeline.mjs': names.includes('lib/runQueuePipeline.mjs'),
    'lib/db-tablestore.mjs': names.includes('lib/db-tablestore.mjs'),
    'index.mjs': names.includes('index.mjs'),
  };
  const texts = {};
  for (const f of ['lib/runQueuePipeline.mjs', 'lib/db-tablestore.mjs', 'index.mjs']) {
    const ent = zip.getEntry(f);
    texts[f] = ent ? ent.getData().toString('utf8') : '';
  }
  const hits = {};
  for (const m of markers) {
    hits[m] = {
      runQueuePipeline: (texts['lib/runQueuePipeline.mjs'] || '').includes(m),
      db: (texts['lib/db-tablestore.mjs'] || '').includes(m),
      index: (texts['index.mjs'] || '').includes(m),
    };
  }
  // adminAggregateDashboardStats: does task GetRange use columnToGet nearby?
  const db = texts['lib/db-tablestore.mjs'] || '';
  const adminIdx = db.indexOf('adminAggregateDashboardStats');
  let adminHasColumnToGetInTaskScan = null;
  if (adminIdx >= 0) {
    const slice = db.slice(adminIdx, adminIdx + 4500);
    const taskScan = slice.indexOf('tableName: TASKS_TABLE');
    if (taskScan >= 0) {
      const block = slice.slice(taskScan, taskScan + 400);
      adminHasColumnToGetInTaskScan = block.includes('columnToGet');
    }
  }
  report.push({
    key,
    size: fs.statSync(local).size,
    entry_count: names.length,
    has_files: has,
    marker_hits: hits,
    admin_task_scan_has_columnToGet: adminHasColumnToGetInTaskScan,
  });
}

console.log(JSON.stringify(report, null, 2));
