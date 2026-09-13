/**
 * 平台槽计数漂移修复：瘦表/lean 审计无 holder 时，把 video/image/audio.running 泄放到 0。
 * 默认 DRY_RUN。Apply：
 *   APPLY=1 node scripts/repair-platform-slot-counter-drift.mjs
 *
 * 禁止胖扫 nx_tasks；仅用 counters + 既有 lean list + 可选已知 ID。
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

const apply = String(process.env.APPLY || '') === '1';
const maxReleases = Math.min(50, Math.max(1, parseInt(process.env.MAX_RELEASES || '20', 10) || 20));

const db = await import('../lib/db-tablestore.mjs');

const before = await db.getPlatformConcurrencyPoolSnapshot();
const work = await db.countTaskWorkActive({ maxScanRows: 2000 });
const promote = await db.listTaskWorkForPromote({ maxTasks: 100, maxScanRows: 2000 });
const expired = await db.listExpiredClaimedFromTaskWork({ maxTasks: 100, maxScanRows: 2000 });

const pools = ['video', 'image', 'audio'];
const leaked = {};
for (const k of pools) {
  leaked[k] = Math.max(0, Number(before?.[k]?.running) || 0);
}

const workBusy =
  (typeof work === 'object' ? Number(work.count || 0) : Number(work) || 0) > 0 ||
  (promote?.tasks?.length || 0) > 0 ||
  (expired?.tasks?.length || 0) > 0;

const plan = {
  dry_run: !apply,
  before,
  work_active: work,
  promote_queued: promote?.tasks?.length || 0,
  expired_claimed: expired?.tasks?.length || 0,
  work_busy: workBusy,
  leaked_counters: leaked,
  safe_to_drain:
    !workBusy && Object.values(leaked).some((n) => n > 0),
  note: workBusy
    ? 'work 表仍有活跃行，拒绝盲泄放 counters（先结清任务）'
    : 'work 空且 counters>0 → 判定计数漂移，可泄放',
};

console.log(JSON.stringify(plan, null, 2));

if (!apply) {
  console.log('[repair-platform-slot-counter-drift] DRY_RUN. Re-run APPLY=1 to drain.');
  process.exit(0);
}

if (workBusy) {
  console.error('[repair-platform-slot-counter-drift] abort: work still busy');
  process.exit(2);
}

const drain = { video: [], image: [], audio: [] };
for (const kind of pools) {
  let snap = await db.getPlatformConcurrencyPoolSnapshot();
  for (let i = 0; i < maxReleases && (snap?.[kind]?.running || 0) > 0; i++) {
    const rel = await db.releasePlatformConcurrencySlot(kind);
    drain[kind].push(rel);
    snap = await db.getPlatformConcurrencyPoolSnapshot();
    if (rel?.already_empty) break;
  }
}

const after = await db.getPlatformConcurrencyPoolSnapshot();
const ok = pools.every((k) => (after?.[k]?.running || 0) === 0);
const result = { ok, before, after, drain };
const outPath = path.join(__dirname, 'repair-platform-slot-counter-drift-result.json');
fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ok, after, wrote: outPath }, null, 2));
process.exit(ok ? 0 : 1);
