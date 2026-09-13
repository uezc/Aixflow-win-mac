/**
 * 计费 fail-closed 冒烟：缺时长拒价、SKU-only 缺时长拒价、有时长正常计价
 * node scripts/_smoke-billing-failclosed.mjs
 */
import { getFinalPrice, isModelNotPricedError } from '../pricing/price_calculator.mjs';
import { getVideoBillingQuantity } from '../pricing/videoBillingCloud.mjs';

const map = {
  'rhart-video-upscaler-4k': {
    model_id: 'rhart-video-upscaler-4k',
    is_active: true,
    base_price: 0.56,
    multiplier: 2,
    yuanbao_rate: 10,
  },
  'wan-animate-2-720p': {
    model_id: 'wan-animate-2-720p',
    is_active: true,
    base_price: 0.1,
    multiplier: 1,
    yuanbao_rate: 10,
  },
  'bad-zero': {
    model_id: 'bad-zero',
    is_active: true,
    base_price: 0,
    multiplier: 2,
    yuanbao_rate: 10,
  },
};

function expectThrow(label, fn, detail) {
  try {
    const v = fn();
    console.error('FAIL', label, 'expected throw, got', v);
    process.exitCode = 1;
  } catch (e) {
    if (!isModelNotPricedError(e)) {
      console.error('FAIL', label, 'wrong error', e);
      process.exitCode = 1;
      return;
    }
    if (detail && String(e.message) !== detail) {
      console.error('FAIL', label, 'detail', e.message, 'want', detail);
      process.exitCode = 1;
      return;
    }
    console.log('OK', label);
  }
}

function expectVal(label, fn, want) {
  const v = fn();
  if (v !== want) {
    console.error('FAIL', label, v, 'want', want);
    process.exitCode = 1;
  } else console.log('OK', label, v);
}

expectVal('qty upscaler missing', () => getVideoBillingQuantity('rhart-video-upscaler', {}), null);
expectVal('qty upscaler 5s', () => getVideoBillingQuantity('rhart-video-upscaler', { mediaDurationSec: 5 }), 5);
expectVal('qty animate2 missing', () => getVideoBillingQuantity('wan-animate-2', {}), null);

expectThrow(
  'create sku-only no duration',
  () =>
    getFinalPrice('rhart-video-upscaler-4k', {
      taskType: 'video',
      nodeData: {},
      modelConfigMap: map,
    }),
  'media_duration_required',
);

expectVal(
  'create with model+duration',
  () =>
    getFinalPrice('rhart-video-upscaler-4k', {
      taskType: 'video',
      nodeData: { model: 'rhart-video-upscaler', targetResolution: '4k', mediaDurationSec: 5 },
      modelConfigMap: map,
    }),
  56,
);

expectThrow(
  'base_price 0 row',
  () =>
    getFinalPrice('bad-zero', {
      taskType: 'video',
      nodeData: { model: 'bad-zero' },
      modelConfigMap: map,
    }),
);

console.log('done');
