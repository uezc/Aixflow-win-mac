/**
 * 输出与 sync-pricing-to-ots 一致的 model_id + 基准价 + 推荐倍率（JSON），供 Python 后台一键同步。
 * 在仓库根执行：node scripts/dump-pricing-for-admin.mjs
 */
import { VIDEO_BILLING_SKU_CNY, IMAGE_MODEL_CNY } from '../pricing/cost_table.mjs';
import { IMAGE_BILLING_MULTIPLIER_BY_MODEL, resolveImageBillingModelId } from '../pricing/price_calculator.mjs';

function imageMultiplierForModelId(modelId) {
  let id = String(modelId || '').trim();
  const m = id.match(/^(.+)-(1k|2k|4k)$/i);
  if (m) id = m[1];
  const resolved = resolveImageBillingModelId(id);
  return (
    IMAGE_BILLING_MULTIPLIER_BY_MODEL[resolved] ??
    IMAGE_BILLING_MULTIPLIER_BY_MODEL[id] ??
    1
  );
}

function flattenImageModelCny(map) {
  const out = [];
  for (const [model, val] of Object.entries(map)) {
    if (val != null && typeof val === 'object' && !Array.isArray(val)) {
      for (const [resKey, num] of Object.entries(val)) {
        const price = Number(num);
        if (!Number.isFinite(price)) continue;
        const rk = String(resKey).trim().toLowerCase();
        const model_id = rk === 'default' || rk === '' ? model : `${model}-${rk}`;
        out.push({ model_id, base_price: price, kind: 'image' });
      }
    } else {
      const price = Number(val);
      if (!Number.isFinite(price)) continue;
      out.push({ model_id: model, base_price: price, kind: 'image' });
    }
  }
  return out;
}

const video = Object.entries(VIDEO_BILLING_SKU_CNY).map(([model_id, v]) => ({
  model_id,
  base_price: Number(v),
  multiplier: 1,
  kind: 'video',
}));

const image = flattenImageModelCny(IMAGE_MODEL_CNY).map((r) => ({
  ...r,
  multiplier: imageMultiplierForModelId(r.model_id),
}));

const byId = new Map();
for (const row of [...video, ...image]) {
  if (!row.model_id || !Number.isFinite(row.base_price)) continue;
  byId.set(row.model_id, row);
}

const list = [...byId.values()].sort((a, b) => a.model_id.localeCompare(b.model_id));
process.stdout.write(JSON.stringify(list, null, 0));
