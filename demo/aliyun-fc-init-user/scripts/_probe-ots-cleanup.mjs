/**
 * Quick OTS probe for retention cleanup.
 * node scripts/_probe-ots-cleanup.mjs
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvFile(path.join(REPO, '.env'));
loadEnvFile(path.join(ROOT, '.env'));

const t0 = Date.now();
const db = await import('../lib/db-tablestore.mjs');
console.log('[probe] import_ms', Date.now() - t0);

const r = await db.listTerminalTasksForRetention({
  cutoffMs: Date.now() - 3 * 24 * 60 * 60 * 1000,
  maxTasks: 10,
  maxScanRows: 3000,
});
console.log(
  JSON.stringify(
    {
      elapsed_ms: Date.now() - t0,
      scanned: r.scanned,
      matched: r.tasks.length,
      sample: r.tasks.slice(0, 5),
    },
    null,
    2,
  ),
);
