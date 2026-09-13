/**
 * 超分只读验收：OTS 价表 + getFinalPrice 行为（不 Create、不调 RH）
 * node scripts/_audit-upscaler-ready.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '../..');

function loadEnvFile(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
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
const { getFinalPrice, isModelNotPricedError } = await import('../pricing/price_calculator.mjs');
const { getVideoBillingQuantity } = await import('../pricing/videoBillingCloud.mjs');

const SKUS = [
  'rhart-video-upscaler-720p',
  'rhart-video-upscaler-1080p',
  'rhart-video-upscaler-2k',
  'rhart-video-upscaler-4k',
  'Rhart-video-upscaler-2k',
  'Rhart-video-upscaler-4k',
];

const rows = await db.listModelConfig();
const map = Object.create(null);
for (const r of rows || []) {
  const id = String(r.model_id || '').trim().toLowerCase();
  if (id) map[id] = r;
}

console.log('=== OTS 超分 SKU ===');
const hits = (rows || []).filter((r) =>
  String(r.model_id || '')
    .toLowerCase()
    .includes('rhart-video-upscaler'),
);
if (!hits.length) {
  console.log('FAIL: OTS 无任何 rhart-video-upscaler 行');
} else {
  for (const r of hits) {
    const ok =
      r.is_active !== false &&
      Number(r.base_price) > 0 &&
      Number(r.multiplier) > 0 &&
      Number(r.yuanbao_rate) > 0;
    console.log(
      ok ? 'OK ' : 'BAD',
      JSON.stringify({
        model_id: r.model_id,
        is_active: r.is_active,
        base_price: r.base_price,
        multiplier: r.multiplier,
        yuanbao_rate: r.yuanbao_rate,
      }),
    );
  }
}

const active4k = map['rhart-video-upscaler-4k'];
console.log('\n=== Quantity 层 ===');
console.log('缺时长', getVideoBillingQuantity('rhart-video-upscaler', {}));
console.log('3s', getVideoBillingQuantity('rhart-video-upscaler', { mediaDurationSec: 3 }));
console.log('60s', getVideoBillingQuantity('rhart-video-upscaler', { mediaDurationSec: 60 }));

function tryPrice(label, modelId, nodeData) {
  try {
    const y = getFinalPrice(modelId, {
      taskType: 'video',
      nodeData,
      modelConfigMap: map,
    });
    console.log('PRICE_OK', label, y);
  } catch (e) {
    const code = isModelNotPricedError(e) ? e.message : String(e?.message || e);
    console.log('PRICE_BLOCK', label, code);
  }
}

console.log('\n=== getFinalPrice ===');
tryPrice('SKU-only 无时长', 'rhart-video-upscaler-4k', {});
tryPrice('有 model 无时长', 'rhart-video-upscaler-4k', {
  model: 'rhart-video-upscaler',
  targetResolution: '4k',
});
tryPrice('4k × 3s', 'rhart-video-upscaler-4k', {
  model: 'rhart-video-upscaler',
  targetResolution: '4k',
  mediaDurationSec: 3,
});
tryPrice('4k × 60s', 'rhart-video-upscaler-4k', {
  model: 'rhart-video-upscaler',
  targetResolution: '4k',
  mediaDurationSec: 60,
});

if (active4k && active4k.is_active === false) {
  console.log('\nWARN: 4k is_active=false，线上用户将无法使用');
} else if (active4k && Number(active4k.base_price) > 0) {
  const y60 = 0.56 * 2 * 10 * 60; // 若 OTS 仍是 0.56×2×10
  console.log(
    '\n参考：若 OTS 为 base=0.56 mul=2 rate=10，60s 期望约',
    Math.max(1, Math.round(Number(active4k.base_price) * Number(active4k.multiplier) * Number(active4k.yuanbao_rate) * 60)),
    '元宝（公式验算）',
  );
}

console.log('\n=== 结论提示 ===');
const inactive = hits.filter((r) => r.is_active === false);
const badPrice = hits.filter(
  (r) => !(Number(r.base_price) > 0 && Number(r.multiplier) > 0 && Number(r.yuanbao_rate) > 0),
);
if (inactive.length) console.log('- 有未启用 SKU:', inactive.map((r) => r.model_id).join(', '));
if (badPrice.length) console.log('- 有非法价列 SKU:', badPrice.map((r) => r.model_id).join(', '));
if (!inactive.length && !badPrice.length && hits.length) {
  console.log('- OTS 超分行可用；缺时长会被拒价；有时长可计价。可进行一次真实冒烟（会花元宝）。');
}
