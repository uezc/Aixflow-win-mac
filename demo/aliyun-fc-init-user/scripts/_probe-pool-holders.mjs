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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvFile(path.join(REPO, '.env'));
loadEnvFile(path.join(ROOT, '.env'));
for (const [k, v] of Object.entries({
  GLOBAL_CN_VIDEO_CONCURRENCY: '100',
  GLOBAL_CN_IMAGE_CONCURRENCY: '100',
  GLOBAL_OVERSEAS_VIDEO_CONCURRENCY: '100',
  GLOBAL_OVERSEAS_IMAGE_CONCURRENCY: '100',
  GLOBAL_AUDIO_CONCURRENCY: '100',
})) process.env[k] = v;

const db = await import('../lib/db-tablestore.mjs');
const snap = await db.getPlatformConcurrencyPoolSnapshot();
const work = await db.countTaskWorkActive({ maxScanRows: 2000 });
const listed = await db.listTaskWorkIdsMatching((w) => {
  const s = String(w.status || '').toLowerCase();
  return s === 'claimed' || s === 'running' || s === 'queued';
}, { maxTasks: 50, maxScanRows: 5000 });
const rows = [];
for (const id of listed.taskIds.slice(0, 50)) {
  const t = await db.getTaskById(id);
  rows.push({
    id: id.slice(0, 8),
    status: t?.status,
    type: t?.task_type,
    pool: t?.resource_pool || '',
    model: String(t?.model_id || '').slice(0, 40),
    user: String(t?.user_id || '').slice(0, 20),
    held_p: !!t?.platform_slot_held,
    stage: t?.execution_stage,
  });
}
const out = {
  snap: {
    cn_video: snap.cn_video,
    cn_image: snap.cn_image,
    overseas_video: snap.overseas_video,
    overseas_image: snap.overseas_image,
    audio: snap.audio,
    total_running: snap.total_running,
  },
  work,
  sample: rows,
};
fs.writeFileSync(path.join(__dirname, '_probe-pool-holders-result.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
