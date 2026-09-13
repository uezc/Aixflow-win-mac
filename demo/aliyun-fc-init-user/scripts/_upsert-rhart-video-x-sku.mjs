/**
 * One-shot: ensure lowercase rhart-video-x-* SKUs exist in nx_model_config
 * (official cost_table keys). Does not change pricing formulas.
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

const { pathToFileURL } = await import('url');
const { VIDEO_BILLING_SKU_CNY } = await import(pathToFileURL(path.join(REPO, 'pricing/cost_table.mjs')).href);
const db = await import('../lib/db-tablestore.mjs');
const { getFinalPrice } = await import('../pricing/price_calculator.mjs');

const keys = Object.keys(VIDEO_BILLING_SKU_CNY).filter((k) => k.startsWith('rhart-video-x-'));
for (const model_id of keys) {
  const base_price = Number(VIDEO_BILLING_SKU_CNY[model_id]);
  await db.upsertModelConfigRow({
    model_id,
    function_name: model_id,
    is_active: true,
    base_price,
    multiplier: 1,
    yuanbao_rate: 10,
  });
}

const map = Object.fromEntries((await db.listModelConfig()).map((r) => [r.model_id, r]));
const sku = 'rhart-video-x-720p-10s';
const price = getFinalPrice(sku, {
  taskType: 'video',
  nodeData: { model: 'rhart-video-x', durationGrok3: '10', aspect_ratio: '16:9' },
  modelConfigMap: map,
});
console.log(
  JSON.stringify({
    upserted_count: keys.length,
    sku,
    price_yuanbao: price,
    base_price: map[sku]?.base_price,
    yuanbao_rate: map[sku]?.yuanbao_rate,
  }),
);
