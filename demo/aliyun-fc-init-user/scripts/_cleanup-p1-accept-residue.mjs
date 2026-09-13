/**
 * 清理 p1 accept / 压测残留：按 task_id 前缀或 resource_pool 测试模型。
 * 仅处理 model_id 以 p1- 开头或 prompt 含 p1_accept 的任务（通过已知 id 文件或 work 扫瘦列）。
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

async function mapPool(items, limit, fn) {
  let i = 0;
  const out = [];
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, () => worker()));
  return out;
}

const listed = await db.listTaskWorkIdsMatching((w) => {
  const m = String(w.model_id || '');
  return m.startsWith('p1-') || m.includes('p1-');
}, { maxTasks: 2000, maxScanRows: 20000 });

console.log('p1 work candidates', listed.taskIds.length);

await mapPool(listed.taskIds, 20, async (tid) => {
  const t = await db.getTaskById(tid);
  if (!t) return;
  const st = String(t.status || '').toLowerCase();
  const heldP = !!t.platform_slot_held;
  const heldU = !!t.user_slot_held;
  const pool = t.resource_pool || (t.task_type === 'image' ? 'cn_image' : t.task_type === 'audio' ? 'audio' : 'cn_video');
  try {
    if (st === 'queued' || st === 'claimed' || st === 'running') {
      await db.upsertTask(tid, t.user_id, {
        status: 'failed',
        error_code: 'P1_ACCEPT_CLEANUP',
        user_slot_held: '0',
        platform_slot_held: '0',
        skip_slot_auto_release: true,
        execution_stage: 'done',
      });
    }
    if (heldP) await db.releasePlatformConcurrencySlot(pool).catch(() => {});
    if (heldU) await db.releaseUserConcurrencySlot(t.user_id, t.task_type).catch(() => {});
    if (typeof db.deleteTaskById === 'function') await db.deleteTaskById(tid).catch(() => {});
  } catch (e) {
    console.warn('cleanup', tid.slice(0, 8), e?.message || e);
  }
});

// Drain all platform pools to 0 (work empty check)
const work = await db.countTaskWorkActive({ maxScanRows: 5000 });
console.log('work after task cleanup', work);
const pools = ['cn_video', 'cn_image', 'overseas_video', 'overseas_image', 'audio', 'video', 'image'];
const drained = {};
for (const pool of pools) {
  drained[pool] = 0;
  for (let i = 0; i < 200; i++) {
    const snap = await db.getPlatformConcurrencyPoolSnapshot();
    // video/image alias to cn_*
    const running =
      pool === 'video'
        ? snap.cn_video?.running
        : pool === 'image'
          ? snap.cn_image?.running
          : snap[pool]?.running;
    if (!(running > 0)) break;
    // only drain raw legacy PKs via release which normalizes
    const r = await db.releasePlatformConcurrencySlot(pool === 'video' ? 'cn_video' : pool === 'image' ? 'cn_image' : pool);
    if (r?.already_empty) break;
    drained[pool] += 1;
  }
}
const snap = await db.getPlatformConcurrencyPoolSnapshot();
console.log(JSON.stringify({ drained, snap: {
  cn_video: snap.cn_video,
  cn_image: snap.cn_image,
  overseas_video: snap.overseas_video,
  overseas_image: snap.overseas_image,
  audio: snap.audio,
  total_running: snap.total_running,
}}, null, 2));
