/**
 * Smoke: OTS cost-saving plan static checks
 * node scripts/_smoke-ots-cost-plan.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(ok ? `[PASS] ${name}` : `[FAIL] ${name}`, detail);
}

const dbLib = fs.readFileSync(path.join(root, 'lib/db-tablestore.mjs'), 'utf8');
const dbApp = fs.readFileSync(path.join(root, 'app/lib/db-tablestore.mjs'), 'utf8');
const qpLib = fs.readFileSync(path.join(root, 'lib/queuePosition.mjs'), 'utf8');
const qpApp = fs.readFileSync(path.join(root, 'app/lib/queuePosition.mjs'), 'utf8');
const pipeLib = fs.readFileSync(path.join(root, 'lib/runQueuePipeline.mjs'), 'utf8');
const pipeApp = fs.readFileSync(path.join(root, 'app/lib/runQueuePipeline.mjs'), 'utf8');
const cleanup = path.join(root, 'scripts/cleanup-ots-retention.mjs');

function extractFn(src, name) {
  const re = new RegExp(`export async function ${name}\\s*\\([\\s\\S]*?\\n\\}`, 'm');
  const m = src.match(re);
  return m ? m[0] : '';
}

for (const [label, src] of [
  ['lib', dbLib],
  ['app/lib', dbApp],
]) {
  check(`${label} TASK_SCAN_COLUMNS exported`, /export const TASK_SCAN_COLUMNS\s*=/.test(src));
  check(`${label} OTS_TABLE_TASK_WORK / nx_task_work`, /OTS_TABLE_TASK_WORK|nx_task_work/.test(src));
  check(`${label} upsertTaskWork`, /export async function upsertTaskWork/.test(src));
  check(`${label} deleteTaskWork`, /export async function deleteTaskWork/.test(src));
  check(`${label} ensureTaskWorkTable`, /export async function ensureTaskWorkTable/.test(src));
  check(`${label} deleteTaskById`, /export async function deleteTaskById/.test(src));
  check(`${label} deleteTransactionById`, /export async function deleteTransactionById/.test(src));
  check(`${label} deleteTaskCharge`, /export async function deleteTaskCharge/.test(src));
  check(`${label} runOtsRetentionCleanup`, /export async function runOtsRetentionCleanup/.test(src));

  const promote = extractFn(src, 'listQueuedTasksForPromoteFromTasksTable') || extractFn(src, 'listQueuedTasksForPromote');
  check(
    `${label} listQueued* uses columnToGet`,
    /columnToGet:\s*TASK_SCAN_COLUMNS/.test(promote) || /columnToGet:\s*TASK_SCAN_COLUMNS/.test(src),
    promote ? `fn_len=${promote.length}` : 'fallback whole-file',
  );
  check(
    `${label} listQueuedTasksForPromote prefers task_work`,
    /listTaskWorkForPromote/.test(src),
  );
}

for (const [label, src] of [
  ['lib', qpLib],
  ['app/lib', qpApp],
]) {
  const m = src.match(/:\s*(\d[\d_]*)\s*;\s*\n\}/);
  // getQueuePositionMaxScanRows default
  const def = src.match(
    /getQueuePositionMaxScanRows[\s\S]*?:\s*([\d_]+)\s*;/,
  );
  const n = def ? Number(String(def[1]).replace(/_/g, '')) : NaN;
  check(`${label} queue position max scan default <= 15000`, Number.isFinite(n) && n <= 15000, `default=${n}`);
}

for (const [label, src] of [
  ['lib', pipeLib],
  ['app/lib', pipeApp],
]) {
  check(
    `${label} idle activeSlots includes audio`,
    /pools\?\.audio\?\.running/.test(src),
  );
  check(`${label} idle_no_patrol / zero patrol`, /idle_no_patrol|idle_zero_patrol/.test(src));
  check(
    `${label} default idle safety 1h`,
    /3600000/.test(src) && /countTaskWorkActive|work_active/.test(src),
  );
}
check('lib countTaskWorkActive', /export async function countTaskWorkActive/.test(dbLib));
check('app countTaskWorkActive', /export async function countTaskWorkActive/.test(dbApp));

check('cleanup-ots-retention.mjs exists', fs.existsSync(cleanup));
if (fs.existsSync(cleanup)) {
  const c = fs.readFileSync(cleanup, 'utf8');
  check('cleanup DRY_RUN/APPLY docs', /DRY_RUN|APPLY/.test(c));
  check('cleanup calls runOtsRetentionCleanup', /runOtsRetentionCleanup/.test(c));
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) {
  console.error('FAILED:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
process.exit(0);
