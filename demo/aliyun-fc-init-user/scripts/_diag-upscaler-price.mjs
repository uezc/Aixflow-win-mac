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

const db = await import('../lib/db-tablestore.mjs');
const tid = 'd288ef1f-ede0-4092-9faf-ce7bc2f3f5c7';
const uid = 'nx_d8f2ec77-ed40-41e8-89ff-627b24eb1219';

const task = await db.getTaskById(tid);
console.log('task.prompt_json', task?.prompt_json);
console.log('task.model_id', task?.model_id);
console.log('task.quoted_cost/cost/amount', task?.quoted_cost, task?.cost, task?.amount);

// find consume tx for this task
if (typeof db.listRecentTransactionsForUser === 'function') {
  const txs = await db.listRecentTransactionsForUser(uid, 50);
  const hit = (txs || []).filter((t) => String(t.task_id || '') === tid || String(t.description || '').includes('upscaler'));
  console.log('txs_hit', JSON.stringify(hit, null, 2));
}

// OTS model config for SKUs
for (const sku of [
  'rhart-video-upscaler-4k',
  'rhart-video-upscaler-720p',
  'rhart-video-upscaler-1080p',
  'rhart-video-upscaler-2k',
]) {
  try {
    const row =
      typeof db.getModelConfig === 'function'
        ? await db.getModelConfig(sku)
        : typeof db.getNxModelConfig === 'function'
          ? await db.getNxModelConfig(sku)
          : null;
    console.log('sku', sku, row);
  } catch (e) {
    console.log('sku err', sku, e.message);
  }
}

const { VIDEO_RHART_VIDEO_UPSCALER_CNY } = await import('../pricing/cost_table.mjs');
const { getVideoBillingQuantity } = await import('../pricing/videoBillingCloud.mjs');
console.log('CNY_per_sec', VIDEO_RHART_VIDEO_UPSCALER_CNY);
console.log('qty_missing', getVideoBillingQuantity('rhart-video-upscaler', {}));
console.log('qty_5', getVideoBillingQuantity('rhart-video-upscaler', { mediaDurationSec: 5 }));
console.log('qty_19m', getVideoBillingQuantity('rhart-video-upscaler', { mediaDurationSec: 19 * 60 + 1 }));
console.log('qty_1141', getVideoBillingQuantity('rhart-video-upscaler', { mediaDurationSec: 1141 }));
