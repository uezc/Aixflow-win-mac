/**
 * Repair leaked video platform slots using known audit IDs (lean, no full-table fat scan).
 *
 * Default DRY_RUN. Apply:
 *   APPLY=1 node scripts/repair-video-slot-leak.mjs
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

const HELD_FAILED_IDS = [
  '5ab09eb3-ca0c-4c87-8132-80b27a3d6f77',
  '66fa0126-48cd-46ef-baee-64c5df215fa3',
  '6a7295a2-1ce1-4f39-8f17-fd2d28e10b0d',
  '708217d5-1bd3-4b49-9560-9de57d9f75f0',
  '7f3eea30-e856-46fc-b211-98ab8217e6c4',
  '9519ff5c-8c76-46aa-bf30-726c3583e2ac',
  'e5e4fd68-a976-4141-9265-547628906fb8',
];
const ZOMBIE_RUNNING_ID = 'eee77543-9df5-4c82-9556-3bb654c5c4bb';

const db = await import('../lib/db-tablestore.mjs');

function held(v) {
  return v === true || v === 1 || String(v || '') === '1';
}

const snap0 = await db.getPlatformConcurrencyPoolSnapshot();
const inspected = [];
for (const id of HELD_FAILED_IDS) {
  const t = await db.getTaskById(id);
  inspected.push(
    t
      ? {
          task_id: id,
          status: t.status,
          platform_slot_held: held(t.platform_slot_held),
          user_slot_held: held(t.user_slot_held),
          reservation_id: t.reservation_id || '',
          user_id: t.user_id || '',
          task_type: t.task_type || '',
          model_id: t.model_id || '',
        }
      : { task_id: id, missing: true },
  );
}
const zombie = await db.getTaskById(ZOMBIE_RUNNING_ID);

const toRelease = inspected.filter((t) => !t.missing && held(t.platform_slot_held)).slice(0, maxReleases);
const plan = {
  dry_run: !apply,
  before: { video_running: snap0?.video?.running ?? null, image_running: snap0?.image?.running ?? null },
  inspected,
  will_release: toRelease.map((t) => t.task_id),
  zombie: zombie
    ? {
        task_id: ZOMBIE_RUNNING_ID,
        status: zombie.status,
        provider_task_id: zombie.provider_task_id || '',
        platform_slot_held: held(zombie.platform_slot_held),
      }
    : { missing: true },
};
console.log(JSON.stringify(plan, null, 2));

if (!apply) {
  console.log('[repair-video-slot-leak] DRY_RUN only. Re-run with APPLY=1 to apply.');
  process.exit(0);
}

const actions = [];
for (const t of toRelease) {
  const row = { task_id: t.task_id, steps: [] };
  try {
    row.steps.push({ release_platform: await db.releasePlatformConcurrencySlot('video') });
  } catch (e) {
    row.steps.push({ release_platform_error: e?.message || String(e) });
  }
  if (held(t.user_slot_held) && t.user_id) {
    try {
      row.steps.push({ release_user: await db.releaseUserConcurrencySlot(t.user_id, 'video') });
    } catch (e) {
      row.steps.push({ release_user_error: e?.message || String(e) });
    }
  }
  try {
    // Direct flag clear via updateTaskPhase7Fields to avoid status-machine noise
    if (typeof db.updateTaskPhase7Fields === 'function') {
      await db.updateTaskPhase7Fields(t.task_id, t.user_id || 'unknown', {
        platform_slot_held: '0',
        user_slot_held: '0',
      });
      row.steps.push({ clear_flags: 'phase7' });
    } else {
      await db.upsertTask(t.task_id, t.user_id || 'unknown', {
        status: String(t.status || 'failed').toLowerCase(),
        platform_slot_held: '0',
        user_slot_held: '0',
        skip_slot_auto_release: true,
      });
      row.steps.push({ clear_flags: 'upsert' });
    }
  } catch (e) {
    row.steps.push({ clear_flags_error: e?.message || String(e) });
  }
  if (t.reservation_id) {
    try {
      await db.updateSlotReservation(t.reservation_id, {
        state: 'released',
        user_slot_held: 0,
        platform_slot_held: 0,
        rollback_reason: 'repair_video_slot_leak',
      });
      row.steps.push({ reservation: 'released' });
    } catch (e) {
      row.steps.push({ reservation_error: e?.message || String(e) });
    }
  }
  actions.push(row);
}

if (zombie && String(zombie.status || '').toLowerCase() === 'running' && !String(zombie.provider_task_id || '').trim()) {
  const row = { task_id: ZOMBIE_RUNNING_ID, steps: [] };
  try {
    await db.upsertTask(ZOMBIE_RUNNING_ID, zombie.user_id || 'unknown', {
      status: 'failed',
      error_code: 'ZOMBIE_RUNNING_REPAIR',
      error_msg: 'stale running without provider_task_id; repaired',
      platform_slot_held: '0',
      user_slot_held: '0',
      skip_slot_auto_release: true,
    });
    row.steps.push({ mark_failed: 'ok' });
  } catch (e) {
    row.steps.push({ mark_failed_error: e?.message || String(e) });
  }
  actions.push(row);
}

// Drain remaining counter while >0 (idempotent at 0)
const drain = [];
let snap = await db.getPlatformConcurrencyPoolSnapshot();
for (let i = 0; i < maxReleases && (snap?.video?.running || 0) > 0; i++) {
  const rel = await db.releasePlatformConcurrencySlot('video');
  drain.push(rel);
  snap = await db.getPlatformConcurrencyPoolSnapshot();
  if (rel.already_empty) break;
}

const after = await db.getPlatformConcurrencyPoolSnapshot();
const verify = [];
for (const id of HELD_FAILED_IDS) {
  const t = await db.getTaskById(id);
  verify.push({
    task_id: id,
    status: t?.status,
    platform_slot_held: t ? held(t.platform_slot_held) : null,
  });
}
const zombieAfter = await db.getTaskById(ZOMBIE_RUNNING_ID);
const result = {
  ok: (after?.video?.running || 0) === 0 && verify.every((v) => v.platform_slot_held === false),
  after: { video_running: after?.video?.running ?? null, image_running: after?.image?.running ?? null },
  zombie_after: zombieAfter ? { status: zombieAfter.status, provider_task_id: zombieAfter.provider_task_id } : null,
  verify,
  drain,
  actions,
};
const outPath = path.join(__dirname, 'repair-video-slot-leak-result.json');
fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ok: result.ok, after: result.after, verify_held_left: verify.filter((v) => v.platform_slot_held).length, wrote: outPath }, null, 2));
process.exit(result.ok ? 0 : 1);
