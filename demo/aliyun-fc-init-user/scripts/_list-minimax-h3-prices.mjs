import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

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

const { VIDEO_BILLING_SKU_CNY, VIDEO_MINIMAX_H3_CNY } = await import(
  pathToFileURL(path.join(REPO, 'pricing/cost_table.mjs')).href,
);
const db = await import('../lib/db-tablestore.mjs');

console.log('=== VIDEO_MINIMAX_H3_CNY (仓库基准) ===');
console.log(JSON.stringify(VIDEO_MINIMAX_H3_CNY, null, 2));

const tableKeys = Object.keys(VIDEO_BILLING_SKU_CNY)
  .filter((k) => k.startsWith('minimax-h3-'))
  .sort();
console.log('\n=== cost_table SKU (元 / 约元宝×10) ===');
for (const k of tableKeys) {
  const cny = VIDEO_BILLING_SKU_CNY[k];
  console.log(`${k}\t${cny}\t~${Math.round(Number(cny) * 10)}元宝`);
}

const ots = (await db.listModelConfig())
  .filter((r) => String(r.model_id || '').startsWith('minimax-h3-'))
  .sort((a, b) => String(a.model_id).localeCompare(String(b.model_id)));

console.log('\n=== OTS nx_model_config (线上) ===');
console.log('model_id\tbase_price\tmultiplier\tyuanbao_rate\tis_active\t~元宝');
for (const r of ots) {
  const bp = Number(r.base_price) || 0;
  const mul = Number(r.multiplier) || 1;
  const yr = Number(r.yuanbao_rate) || 10;
  const yb = Math.round(bp * mul * yr);
  console.log(
    `${r.model_id}\t${r.base_price}\t${r.multiplier}\t${r.yuanbao_rate}\t${r.is_active}\t~${yb}`,
  );
}
console.log(`\nOTS count: ${ots.length}`);
