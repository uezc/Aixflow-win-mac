/**
 * 将 pricing/cost_table.mjs 中的视频 SKU 与图片档位价同步到 Tablestore nx_model_config。
 *
 * 环境变量（与仓库约定；支持别名）：
 *   OTS_ENDPOINT、OTS_INSTANCE 必填
 *   OTS_ID / OTS_SECRET 或 OTS_ACCESS_KEY_ID / OTS_ACCESS_KEY_SECRET
 * 可选：OTS_TABLE_MODEL_CONFIG（默认 nx_model_config）
 *
 * 用法：
 *   node scripts/sync-pricing-to-ots.mjs
 *   node scripts/sync-pricing-to-ots.mjs --dry-run
 *
 * 说明：PutRow 会覆盖整行属性；若需保留 function_name 等请在 Streamlit 后台补写。
 */

import 'dotenv/config';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import { VIDEO_BILLING_SKU_CNY, IMAGE_MODEL_CNY } from '../pricing/cost_table.mjs';

const require = createRequire(import.meta.url);
const TableStore = require('tablestore');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

/** 与客户端 cloudModelPricing 缺省折算一致（1 元 = 10 元宝） */
const DEFAULT_YUANBAO_RATE = 10;

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

/**
 * 与 getImageDisplayPrice 一致：先 model_id，再 model-resolution（如 banana-2.0-2k）
 * @returns {{ model_id: string, price_cny: number, kind: 'image' }[]}
 */
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
  const video = Object.entries(VIDEO_BILLING_SKU_CNY).map(([model_id, v]) => ({
    model_id,
    price_cny: Number(v),
    kind: 'video',
  }));
  const image = flattenImageModelCny(IMAGE_MODEL_CNY);
  const byId = new Map();
  for (const row of [...video, ...image]) {
    if (!row.model_id || !Number.isFinite(row.price_cny)) continue;
    byId.set(row.model_id, row);
  }
  return [...byId.values()].sort((a, b) => a.model_id.localeCompare(b.model_id));
}

function printManifest(rows) {
  console.log(`\n[sync-pricing-to-ots] 待写入 nx_model_config 共 ${rows.length} 行（去重后 model_id）：\n`);
  console.table(
    rows.map((r) => ({
      model_id: r.model_id,
      price_cny: r.price_cny,
      kind: r.kind,
    })),
  );
}

function putRowPromise(client, params) {
  return new Promise((resolve, reject) => {
    client.putRow(params, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

/** @param {string} endpoint */
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
  printManifest(rows);

  if (dryRun) {
    console.log('\n[sync-pricing-to-ots] --dry-run：未连接 OTS。\n');
    return;
  }

  const env = loadEnv();
  const miss = [];
  if (!env.endpoint) miss.push('OTS_ENDPOINT');
  if (!env.instance) miss.push('OTS_INSTANCE');
  if (!env.accessKeyId) miss.push('OTS_ID 或 OTS_ACCESS_KEY_ID');
  if (!env.secretAccessKey) miss.push('OTS_SECRET 或 OTS_ACCESS_KEY_SECRET');
  if (miss.length) {
    console.error('[sync-pricing-to-ots] 缺少环境变量:', miss.join(', '));
    console.error(`工作目录建议为仓库根: ${ROOT}`);
    process.exit(1);
  }

  const host = endpointHostname(env.endpoint);
  console.log(
    `[sync-pricing-to-ots] 连接 OTS：实例名=${env.instance} | 解析主机=${host || '(无法解析 URL)'}`,
  );

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
    if (ok % 50 === 0) console.log(`[sync-pricing-to-ots] 已写入 ${ok}/${rows.length}…`);
  }
  console.log(`\n[sync-pricing-to-ots] 完成：${ok} 行 -> ${env.tableName}\n`);
}

main().catch((e) => {
  const msg = e?.message || String(e);
  console.error('[sync-pricing-to-ots] 失败:', msg);
  if (/ENOTFOUND|getaddrinfo|ECONNREFUSED/i.test(msg)) {
    const cfg = loadEnv();
    const host = endpointHostname(cfg.endpoint);
    console.error(
      '\n[sync-pricing-to-ots] 网络/域名提示：',
      '\n  · ENOTFOUND 表示当前 OTS 域名无法解析，多半是 OTS_ENDPOINT 的「地域」与控制台不一致。',
      '\n  · 请到 阿里云控制台 → 表格存储 → 目标实例 → 复制「公网 Endpoint」整段（含 https://）。',
      '\n  · 香港与杭州等地域主机名不同（如 …cn-hongkong… 与 …cn-hangzhou…），不可凭猜测填写。',
      `\n  · 当前 OTS_ENDPOINT=${cfg.endpoint || '(空)'}`,
      host ? `\n  · 将尝试连接的主机：${host}` : '',
      '\n',
    );
  }
  process.exit(1);
});
