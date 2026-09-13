/**
 * Count-only: how many terminal tasks older than 3d remain (capped scan).
 * node scripts/_count-ots-retention-left.mjs
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

const db = await import('../lib/db-tablestore.mjs');
const cutoffMs = Date.now() - 3 * 24 * 60 * 60 * 1000;
const maxScanRows = Number(process.env.MAX_SCAN_ROWS || 20000);
const t0 = Date.now();
const r = await db.listTerminalTasksForRetention({
  cutoffMs,
  maxTasks: 2000,
  maxScanRows,
});
const testLike = r.tasks.filter((t) => String(t.userId || '').startsWith('__')).length;
console.log(
  JSON.stringify(
    {
      elapsed_ms: Date.now() - t0,
      cutoff: new Date(cutoffMs).toISOString(),
      scanned: r.scanned,
      matched_old_terminal: r.tasks.length,
      matched_test_users: testLike,
      matched_real_users: r.tasks.length - testLike,
      hit_scan_cap: r.scanned >= maxScanRows,
      hit_match_cap: r.tasks.length >= 2000,
      note:
        r.tasks.length >= 2000 || r.scanned >= maxScanRows
          ? '这是下限估计（触达扫描/匹配上限），实际残留可能更多'
          : '本窗口内已扫完，匹配数较接近真实残留',
    },
    null,
    2,
  ),
);
