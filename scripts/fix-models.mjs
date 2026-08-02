/**
 * 临时修复：将仓库 pricing 中的模型基准价批量写入 Tablestore 表 nx_model_config。
 * （误删表后用于快速灌回；与 scripts/sync-pricing-to-ots.mjs 同源数据，并额外补充 LLM / RH 占位行。）
 *
 * 环境变量（与 .env / FC 一致）：
 *   OTS_ENDPOINT、OTS_INSTANCE 必填
 *   OTS_ID + OTS_SECRET 或 OTS_ACCESS_KEY_ID + OTS_ACCESS_KEY_SECRET
 * 可选：OTS_TABLE_MODEL_CONFIG（默认 nx_model_config）
 *
 * 用法：
 *   node scripts/fix-models.mjs
 *   node scripts/fix-models.mjs --dry-run
 */

import 'dotenv/config';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import {
  VIDEO_BILLING_SKU_CNY,
  IMAGE_MODEL_CNY,
  REVERSE_CAPTION_CNY,
  AUDIO_MODEL_CNY,
} from '../pricing/cost_table.mjs';

const require = createRequire(import.meta.url);
const TableStore = require('tablestore');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

/** 与客户端 / FC 缺省一致：1 元 = 10 元宝 */
const DEFAULT_YUANBAO_RATE = 10;

/**
 * 对话类 LLM：CNY/次（占位零售价，可按运营调整）。
 * 写入时覆盖同 id 的 REVERSE 占位（如 gpt-4o / terra）；专用反推键 gpt-4o-image-reverse 等仍走 REVERSE。
 */
const LLM_CHAT_MODEL_CNY = {
  /** 1 元宝 = 0.1 元 × yuanbao_rate10（与 MODEL_YUANBAO_RATES / UI 大语言模型档一致） */
  'gpt-3.5-turbo': 0.1,
  'gpt-4o': 0.1,
  'openai/gpt-5.6-terra': 0.1,
  'gpt-4-turbo': 0.03,
  'gpt-4': 0.08,
  'gpt-4o-mini': 0.1,
  'claude-3-5-sonnet-20240620': 0.04,
  'claude-3-5-sonnet-latest': 0.04,
  'claude-3-opus-20240229': 0.12,
  'claude-3-haiku-20240307': 0.008,
  'deepseek-chat': 0.005,
  'deepseek-reasoner': 0.01,
  'qwen-turbo': 0.01,
  'qwen-plus': 0.02,
  'qwen-max': 0.05,
};

/** sync_to_tablestore.py 中与 cost 细表无键的 RunningHub 等占位（CNY） */
const EXTRA_MODEL_CNY = {
  '2033537159944212482': 0.01, // 视频分析 RH 应用
};

function loadEnv() {
  const endpoint = process.env.OTS_ENDPOINT?.trim() || '';
  const instance = process.env.OTS_INSTANCE?.trim() || '';
  const accessKeyId =
    process.env.OTS_ID?.trim() || process.env.OTS_ACCESS_KEY_ID?.trim() || '';
  const secretAccessKey =
    process.env.OTS_SECRET?.trim() || process.env.OTS_ACCESS_KEY_SECRET?.trim() || '';
  const tableName = (process.env.OTS_TABLE_MODEL_CONFIG || 'nx_model_config').toLowerCase();
  return { endpoint, instance, accessKeyId, secretAccessKey, tableName };
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
        out.push({ model_id, price_cny: price, kind: 'image' });
      }
    } else {
      const price = Number(val);
      if (!Number.isFinite(price)) continue;
      out.push({ model_id: model, price_cny: price, kind: 'image' });
    }
  }
  return out;
}

function buildAllRows() {
  const byId = new Map();

  const video = Object.entries(VIDEO_BILLING_SKU_CNY).map(([model_id, v]) => ({
    model_id,
    price_cny: Number(v),
    kind: 'video',
  }));
  const image = flattenImageModelCny(IMAGE_MODEL_CNY);

  for (const row of [...video, ...image]) {
    if (!row.model_id || !Number.isFinite(row.price_cny)) continue;
    byId.set(row.model_id, row);
  }

  for (const [model_id, v] of Object.entries(REVERSE_CAPTION_CNY)) {
    const p = Number(v);
    if (!Number.isFinite(p)) continue;
    byId.set(model_id, { model_id, price_cny: p, kind: 'reverse' });
  }

  for (const [model_id, v] of Object.entries(AUDIO_MODEL_CNY)) {
    const p = Number(v);
    if (!Number.isFinite(p)) continue;
    byId.set(model_id, { model_id, price_cny: p, kind: 'audio' });
  }

  for (const [model_id, v] of Object.entries(LLM_CHAT_MODEL_CNY)) {
    const p = Number(v);
    if (!Number.isFinite(p)) continue;
    byId.set(model_id, { model_id, price_cny: p, kind: 'llm' });
  }

  for (const [model_id, v] of Object.entries(EXTRA_MODEL_CNY)) {
    if (byId.has(model_id)) continue;
    const p = Number(v);
    if (!Number.isFinite(p)) continue;
    byId.set(model_id, { model_id, price_cny: p, kind: 'extra' });
  }

  return [...byId.values()].sort((a, b) => a.model_id.localeCompare(b.model_id));
}

function putRowPromise(client, params) {
  return new Promise((resolve, reject) => {
    client.putRow(params, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

function endpointHostname(endpoint) {
  try {
    const raw = String(endpoint || '').trim();
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    return u.hostname || '';
  } catch {
    return '';
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const rows = buildAllRows();

  console.log(`\n[fix-models] 将写入 nx_model_config 共 ${rows.length} 行（model_id 去重后）\n`);
  console.table(rows.map((r) => ({ model_id: r.model_id, price_cny: r.price_cny, kind: r.kind })));

  if (dryRun) {
    console.log('\n[fix-models] --dry-run：未连接 OTS。\n');
    return;
  }

  const env = loadEnv();
  const miss = [];
  if (!env.endpoint) miss.push('OTS_ENDPOINT');
  if (!env.instance) miss.push('OTS_INSTANCE');
  if (!env.accessKeyId) miss.push('OTS_ID 或 OTS_ACCESS_KEY_ID');
  if (!env.secretAccessKey) miss.push('OTS_SECRET 或 OTS_ACCESS_KEY_SECRET');
  if (miss.length) {
    console.error('[fix-models] 缺少环境变量:', miss.join(', '));
    console.error(`请在仓库根目录配置 .env，当前工作目录建议: ${ROOT}`);
    process.exit(1);
  }

  const host = endpointHostname(env.endpoint);
  console.log(`[fix-models] 连接 OTS：实例=${env.instance} | 主机=${host || '(解析失败)'}`);

  const client = new TableStore.Client({
    accessKeyId: env.accessKeyId,
    secretAccessKey: env.secretAccessKey,
    endpoint: env.endpoint,
    instancename: env.instance,
  });

  const cond = new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null);
  let ok = 0;
  for (const r of rows) {
    const p = Number(r.price_cny);
    await putRowPromise(client, {
      tableName: env.tableName,
      condition: cond,
      primaryKey: [{ model_id: r.model_id }],
      attributeColumns: [
        { function_name: '' },
        { is_active: true },
        { base_price: p },
        { multiplier: 1 },
        { yuanbao_rate: DEFAULT_YUANBAO_RATE },
        { price_cny: p },
      ],
    });
    ok += 1;
    if (ok % 50 === 0) console.log(`[fix-models] 已写入 ${ok}/${rows.length}…`);
  }
  console.log(`\n[fix-models] 完成：${ok} 行 -> ${env.tableName}\n`);
}

main().catch((e) => {
  const msg = e?.message || String(e);
  console.error('[fix-models] 失败:', msg);
  if (/ENOTFOUND|getaddrinfo|ECONNREFUSED/i.test(msg)) {
    const cfg = loadEnv();
    console.error(`[fix-models] 请核对 OTS_ENDPOINT 是否为控制台「公网 Endpoint」完整 URL。当前=${cfg.endpoint || '(空)'}`);
  }
  process.exit(1);
});
