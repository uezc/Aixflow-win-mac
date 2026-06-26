/**
 * 定价 model_id / 视频 SKU / cost_table 对齐检查（本地离线）
 *
 * 用法：
 *   node scripts/check-pricing-alignment.mjs
 *   node scripts/check-pricing-alignment.mjs path/to/model-config-export.json
 *   node scripts/check-pricing-alignment.mjs --verbose-skus
 *
 * 视频复合 Key 由 pricing/videoBillingSku.mjs 生成（与 src/main/utils/videoBillingSku.ts 一致）；
 * 成本映射：pricing/cost_table.mjs → VIDEO_BILLING_SKU_CNY。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  VIDEO_BILLING_SKU_CNY,
  tryComputeRawVideoCny,
  mergeVideoPriceDefaults,
  enumerateRepresentativeVideoSkuInputs,
} from '../pricing/cost_table.mjs';
import { buildVideoBillingSkuKey } from '../pricing/videoBillingSku.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

function nearlyEqual(a, b) {
  return Math.abs(Number(a) - Number(b)) < 1e-9;
}

/** sync_to_tablestore.py 中 DEFAULT_MODEL_ROWS 的 model_id */
function extractSyncModelIds(pyText) {
  const set = new Set();
  const re = /["']model_id["']\s*:\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(pyText)) !== null) set.add(m[1]);
  return [...set].sort();
}

/** VideoInputPanel 里 <option value="..."> 的模型类 id（排除纯数字、比例、plugin 等） */
function extractVideoUiModelIds(ts) {
  const raw = new Set();
  const re = /<option\s+value="([^"]+)"/g;
  let m;
  while ((m = re.exec(ts)) !== null) raw.add(m[1]);
  const out = new Set();
  for (const v of raw) {
    if (/^\d+$/.test(v)) continue;
    if (/:/.test(v)) continue;
    if (v === 'plugin' || v === 'core' || v === 'single' || v === 'multi') continue;
    if (v === 'std' || v === 'pro' || v === 'true' || v === 'false') continue;
    if (v === 'na' || v === '720p' || v === '1080p' || v === '4k') continue;
    if (/^6s$|^10s$/.test(v)) continue;
    if (/^[a-z0-9][a-z0-9.-]*-[a-z0-9][a-z0-9.-]*$/i.test(v)) out.add(v);
  }
  return [...out].sort();
}

/** ImageInputPanel allModelOptions / imageToImageOptions 的 value: 'model-id' */
function extractImageUiModelIds(ts) {
  const set = new Set();
  const re = /\{\s*value:\s*'([^']+)'\s*,\s*label:/g;
  let m;
  while ((m = re.exec(ts)) !== null) {
    const v = m[1];
    if (/:/.test(v)) continue;
    if (/^(1k|2k|4k)$/.test(v)) continue;
    if (/^[a-z0-9][a-z0-9.-]*-[a-z0-9]/i.test(v) || /^[a-z0-9]+-\d+\.\d+$/i.test(v)) set.add(v);
  }
  return [...set].sort();
}

function extractAudioUiModelIds(ts) {
  const set = new Set();
  const re = /value:\s*'([^']+)'/g;
  const block = ts.includes('audioModelOptions') ? ts.split('audioModelOptions')[1].slice(0, 800) : '';
  let m;
  while ((m = re.exec(block)) !== null) {
    const v = m[1];
    if (v.includes('-')) set.add(v);
  }
  return [...set].sort();
}

/** 旧 canonical model_id → 示例参数 → 复合 Key（对照表） */
const LEGACY_TO_SKU_EXAMPLES = [
  ['hailuo-02-t2v-standard', { durationHailuo02: '10' }],
  ['hailuo-02-t2v-standard', { resolutionHailuo: '1080p', durationHailuo02: '6' }],
  ['hailuo-02-i2v-standard', { resolutionHailuo: '4k', durationHailuo02: '10' }],
  ['hailuo-2.3-t2v-standard', { durationHailuo02: '6' }],
  ['hailuo-2.3-i2v-standard', { resolutionHailuo: '720p', durationHailuo02: '10' }],
  ['kling-v2.6-pro', { duration: '5', sound: 'true' }],
  ['kling-v2.6-pro', { duration: '10', sound: 'false' }],
  ['kling-video-o1', { modeKlingO1: 'std', durationKlingO1: '5' }],
  ['kling-video-o1', { modeKlingO1: 'pro', durationKlingO1: '10' }],
  ['kling-video-o1-i2v', { durationKlingO1: '10' }],
  ['kling-video-o1-ref', { modeKlingO1: 'pro', durationKlingO1: '5' }],
  ['kling-video-o1-start-end', { durationKlingO1: '5' }],
  ['grok-3', { resolutionGrok3: '720p', durationGrok3: '10' }],
  ['rhart-v3.1-fast', { resolutionRhartV31: '720p' }],
  ['rhart-v3.1-pro', { resolutionRhartV31: '1080p' }],
  ['rhart-v3.1-pro-se', { resolutionRhartV31: '4k' }],
  [
    'rhart-v3.1-pro-official-i2v',
    { durationVeo31ProOfficial: '8', generateAudioVeo31ProOfficial: true },
  ],
  ['wan-2.6', { resolutionWan26: '720p', duration: '15' }],
  ['wan-2.6-flash', { resolutionWan26: '1080p', durationWan26Flash: '10', enableAudio: false }],
  ['ltx-2.3-t2v', { resolutionLtx23T2v: '720', durationLtx23T2v: '10' }],
  ['ltx-2.3-i2v', { resolutionLtx23I2v: '1280', durationLtx23I2v: '5' }],
  ['ltx-2.3-lipsync', { resolutionLtx23Lipsync: '1920' }],
  ['sora-2', {}],
  ['sora-2-pro', {}],
  ['gpt-4o', {}],
  ['joy-caption-two', {}],
];

function printLegacySkuTable() {
  console.log('\n【对照表】旧 model_id → 复合 Key（示例参数，V2.3）');
  console.log('| 旧 ID | 示例复合 Key | 备注 |');
  console.log('| --- | --- | --- |');
  for (const [legacy, input] of LEGACY_TO_SKU_EXAMPLES) {
    const sku = buildVideoBillingSkuKey(legacy, input);
    const merged = mergeVideoPriceDefaults(legacy, input);
    const cost = tryComputeRawVideoCny(merged);
    const note =
      legacy === 'gpt-4o' || legacy === 'joy-caption-two'
        ? '图像反推（REVERSE_CAPTION_CNY，非视频 SKU 表）'
        : legacy === 'kling-video-o1-start-end'
          ? '无 list 价（VIDEO_MODELS_WITHOUT_LIST_PRICE）'
          : cost == null
            ? '—'
            : Object.prototype.hasOwnProperty.call(VIDEO_BILLING_SKU_CNY, sku)
              ? '已在 VIDEO_BILLING_SKU_CNY'
              : '缺表项';
    console.log(`| \`${legacy}\` | \`${sku}\` | ${note} |`);
  }
}

function imageResolutionKeys(models, resolutions) {
  const keys = new Set();
  for (const m of models) {
    keys.add(m);
    for (const r of resolutions) keys.add(`${m}-${r}`);
  }
  return [...keys].sort();
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--verbose-skus');
  const verboseSkus = process.argv.includes('--verbose-skus');

  const syncPath = path.join(root, 'sync_to_tablestore.py');
  const syncText = read(syncPath);
  const syncIds = new Set(extractSyncModelIds(syncText));

  const videoTs = read(path.join(root, 'src/renderer/components/Canvas/VideoInputPanel.tsx'));
  const imageTs = read(path.join(root, 'src/renderer/components/Canvas/ImageInputPanel.tsx'));
  const audioTs = read(path.join(root, 'src/renderer/components/Canvas/AudioInputPanel.tsx'));

  const videoUi = extractVideoUiModelIds(videoTs);
  const imageUi = extractImageUiModelIds(imageTs);
  const audioUi = extractAudioUiModelIds(audioTs);

  console.log('=== NEXFLOW 定价对齐检查 ===\n');
  console.log(`sync_to_tablestore.py 中 model_id 数量: ${syncIds.size}`);
  console.log(`VIDEO_BILLING_SKU_CNY 条目数: ${Object.keys(VIDEO_BILLING_SKU_CNY).length}`);

  const vMissingInSync = videoUi.filter((id) => !syncIds.has(id));
  const iMissingInSync = imageUi.filter((id) => !syncIds.has(id));
  const aMissingInSync = audioUi.filter((id) => !syncIds.has(id));

  if (vMissingInSync.length) {
    console.log('\n【警告】视频 UI 出现但 sync 种子无此 model_id（需在 OTS 补行或改 UI）：');
    vMissingInSync.forEach((x) => console.log('  -', x));
  } else console.log('\n视频 UI 中的模型 id 均在 sync 种子中有条目。');

  if (iMissingInSync.length) {
    console.log('\n【警告】图片 UI 出现但 sync 种子无此 model_id：');
    iMissingInSync.forEach((x) => console.log('  -', x));
  } else console.log('\n图片 UI 中的模型 id 均在 sync 种子中有条目。');

  if (aMissingInSync.length) {
    console.log('\n【警告】音频 UI 出现但 sync 种子无此 model_id：');
    aMissingInSync.forEach((x) => console.log('  -', x));
  } else console.log('\n音频 UI 中的模型 id 均在 sync 种子中有条目。');

  printLegacySkuTable();

  const videoBases = videoUi.filter((id) => syncIds.has(id));
  const pricingRows = enumerateRepresentativeVideoSkuInputs(videoBases);
  let costOk = 0;
  const costMissing = [];
  const costMismatch = [];

  for (const { model, input } of pricingRows) {
    const merged = mergeVideoPriceDefaults(model, input);
    const { model: m, ...rest } = merged;
    const sku = buildVideoBillingSkuKey(m, rest);
    const cost = tryComputeRawVideoCny(merged);
    if (cost == null) {
      if (model === 'kling-video-o1-start-end') continue;
      continue;
    }
    const tab = VIDEO_BILLING_SKU_CNY[sku];
    if (tab === undefined) costMissing.push({ model, sku, cost });
    else if (!nearlyEqual(tab, cost)) costMismatch.push({ sku, tab, cost, model });
    else costOk++;
  }

  console.log('\n=== cost_table.mjs（VIDEO_BILLING_SKU_CNY）自动化校验 ===');
  if (!costMissing.length && !costMismatch.length) {
    console.log(`通过：${costOk} 个可计价 UI 组合均与 VIDEO_BILLING_SKU_CNY 一致。`);
  } else {
    console.error('失败：存在缺表项或金额不一致。');
    if (costMissing.length) {
      console.error(`\n缺表项（${costMissing.length}）：`);
      const cap = verboseSkus ? costMissing.length : 40;
      costMissing.slice(0, cap).forEach((x) => console.error('  -', x.sku, `(model=${x.model}, tryCompute=${x.cost})`));
      if (!verboseSkus && costMissing.length > 40) console.error(`  ... 共 ${costMissing.length} 条，加 --verbose-skus 全列`);
    }
    if (costMismatch.length) {
      console.error(`\n金额不一致（${costMismatch.length}）：`);
      costMismatch.forEach((x) =>
        console.error('  -', x.sku, `table=${x.tab} tryCompute=${x.cost} model=${x.model}`),
      );
    }
    process.exitCode = 1;
  }

  const skusFromEnum = new Set();
  for (const { model, input } of pricingRows) {
    const merged = mergeVideoPriceDefaults(model, input);
    const { model: m, ...rest } = merged;
    const sku = buildVideoBillingSkuKey(m, rest);
    if (tryComputeRawVideoCny(merged) != null) skusFromEnum.add(sku);
  }
  const tableKeys = Object.keys(VIDEO_BILLING_SKU_CNY);
  const orphanInTable = tableKeys.filter((k) => !skusFromEnum.has(k));
  if (orphanInTable.length) {
    console.log(
      `\n【提示】VIDEO_BILLING_SKU_CNY 中有 ${orphanInTable.length} 个 Key 未由当前 UI 枚举命中（可能为全量表余量）：`,
    );
    const cap = verboseSkus ? orphanInTable.length : 15;
    orphanInTable.slice(0, cap).forEach((x) => console.log('  -', x));
    if (!verboseSkus && orphanInTable.length > 15) console.log(`  ... 共 ${orphanInTable.length} 条`);
  }

  const representativeSkus = [...skusFromEnum].sort();
  const skuMissingSync = representativeSkus.filter((s) => !syncIds.has(s));
  const skuPresentSync = representativeSkus.filter((s) => syncIds.has(s));
  if (skuMissingSync.length === 0) {
    console.log(`\n视频：代表性可计价 SKU 共 ${representativeSkus.length} 个，均在 sync 种子中有独立 model_id。`);
  } else if (skuMissingSync.length === representativeSkus.length) {
    console.log(
      `\n视频：sync 种子仅含「基础 model_id」，未为 ${representativeSkus.length} 个复合 SKU 单独建行（常见：客户端回退基础价）。`,
    );
    if (verboseSkus) {
      console.log('\n  --verbose-skus 列表示例 SKU：');
      skuMissingSync.slice(0, 80).forEach((x) => console.log('   ', x));
    }
  } else {
    console.log(
      `\n【信息】可计价复合 SKU ${representativeSkus.length} 个：sync 命中 ${skuPresentSync.length} 个，未命中 ${skuMissingSync.length} 个。`,
    );
    const cap = verboseSkus ? skuMissingSync.length : 30;
    skuMissingSync.slice(0, cap).forEach((x) => console.log('  -', x));
    if (!verboseSkus && skuMissingSync.length > 30) console.log(`  ... 共 ${skuMissingSync.length} 条`);
  }

  const imgRes = ['1k', '2k', '4k'];
  const imgKeys = imageResolutionKeys(imageUi.filter((id) => syncIds.has(id)), imgRes);
  const imgKeyMissing = imgKeys.filter((k) => !syncIds.has(k));
  if (imgKeyMissing.length) {
    console.log(
      `\n【提示】图片 cloud 查找会尝试 \`model\` 与 \`model-resolution\`。下列组合在 sync 中无独立行：`,
    );
    imgKeyMissing.forEach((x) => console.log('  -', x));
  }

  const argJson = args[0];
  if (argJson && fs.existsSync(argJson)) {
    let data;
    try {
      data = JSON.parse(read(path.resolve(argJson)));
    } catch (e) {
      console.error('无法解析 JSON:', e.message);
      process.exitCode = 1;
      return;
    }
    const items = Array.isArray(data.items) ? data.items : [];
    const ots = new Set(items.map((r) => String(r.model_id || '').trim()).filter(Boolean));
    console.log(`\n=== 对比导出表 ${argJson} （${ots.size} 行）===`);

    const notInOts = [...syncIds].filter((id) => !ots.has(id));
    if (notInOts.length) {
      console.log('\n【警告】sync 种子有而导出表无：');
      notInOts.slice(0, 50).forEach((x) => console.log('  -', x));
      if (notInOts.length > 50) console.log(`  ... 共 ${notInOts.length} 条`);
    }

    const inOtsNotSync = [...ots].filter((id) => !syncIds.has(id));
    if (inOtsNotSync.length) {
      console.log('\n【提示】导出表有而 sync 种子无：');
      inOtsNotSync.slice(0, 50).forEach((x) => console.log('  -', x));
      if (inOtsNotSync.length > 50) console.log(`  ... 共 ${inOtsNotSync.length} 条`);
    }

    const criticalSkuMissing = skuMissingSync.filter((s) => !ots.has(s));
    if (criticalSkuMissing.length) {
      console.log('\n【警告】可计价 SKU 在导出表中也不存在（且 sync 也无独立行）：');
      criticalSkuMissing.slice(0, 30).forEach((x) => console.log('  -', x));
    }
  } else if (argJson) {
    console.log('\n未找到 JSON 文件，跳过与导出表对比。');
  }

  console.log(
    '\n---\n建议：改 videoBillingSku / cost_table / 面板选项 / sync 种子后执行 `npm run check:pricing`。',
  );
}

main();
