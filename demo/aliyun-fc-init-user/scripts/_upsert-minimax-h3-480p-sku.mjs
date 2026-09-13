/**
 * One-shot: upsert MiniMax-H3 480P|720P SKUs into nx_model_config from cost_table.
 * DRY_RUN=1 to preview only.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '../..');
const DRY_RUN = String(process.env.DRY_RUN || '').trim() === '1';

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

const { VIDEO_BILLING_SKU_CNY } = await import(
  pathToFileURL(path.join(REPO, 'pricing/cost_table.mjs')).href,
);
const db = await import('../lib/db-tablestore.mjs');

const keys = Object.keys(VIDEO_BILLING_SKU_CNY)
  .filter((k) =>
    /^minimax-h3-(t2v|i2v|multi|audio)-(480p|720p)-(6|10|15|20)s$/.test(k),
  )
  .sort();

const rows = keys.map((model_id) => ({
  model_id,
  base_price: Number(VIDEO_BILLING_SKU_CNY[model_id]),
  yuanbao_est: Math.round(Number(VIDEO_BILLING_SKU_CNY[model_id]) * 10),
}));

if (DRY_RUN) {
  console.log(JSON.stringify({ dry_run: true, count: rows.length, rows }, null, 2));
  process.exit(0);
}

for (const row of rows) {
  await db.upsertModelConfigRow({
    model_id: row.model_id,
    function_name: row.model_id,
    is_active: true,
    base_price: row.base_price,
    multiplier: 1,
    yuanbao_rate: 10,
  });
}

console.log(JSON.stringify({ upserted: rows.length, rows }, null, 2));
