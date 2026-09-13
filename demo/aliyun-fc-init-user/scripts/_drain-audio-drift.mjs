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
for (const k of [
  'GLOBAL_CN_VIDEO_CONCURRENCY',
  'GLOBAL_CN_IMAGE_CONCURRENCY',
  'GLOBAL_OVERSEAS_VIDEO_CONCURRENCY',
  'GLOBAL_OVERSEAS_IMAGE_CONCURRENCY',
  'GLOBAL_AUDIO_CONCURRENCY',
]) {
  process.env[k] = '100';
}

const db = await import('../lib/db-tablestore.mjs');
const work = await db.countTaskWorkActive({ maxScanRows: 2000 });
if (work?.has_any || (work?.count || 0) > 0) {
  console.error('ABORT: task_work not empty, refuse drain', work);
  process.exit(2);
}
const before = await db.getPlatformConcurrencyPoolSnapshot();
console.log('before', {
  audio: before.audio,
  total_running: before.total_running,
});
const drained = { audio: 0 };
while ((await db.getPlatformConcurrencyPoolSnapshot()).audio.running > 0 && drained.audio < 100) {
  await db.releasePlatformConcurrencySlot('audio');
  drained.audio += 1;
}
const after = await db.getPlatformConcurrencyPoolSnapshot();
console.log(JSON.stringify({ drained, after: { audio: after.audio, total_running: after.total_running } }, null, 2));
