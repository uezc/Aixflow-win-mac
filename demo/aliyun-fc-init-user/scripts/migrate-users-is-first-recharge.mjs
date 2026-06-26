#!/usr/bin/env node
/**
 * 一次性数据初始化：遍历 nx_users，对缺少 is_first_recharge 属性的行执行 UpdateRow，写入 'true'（字符串）。
 *
 * 运行前在 demo/aliyun-fc-init-user 目录安装依赖：npm install
 * 环境变量（与 FC / lib/db-tablestore.mjs 一致）：
 *   OTS_ENDPOINT, OTS_INSTANCE, OTS_ACCESS_KEY_ID, OTS_ACCESS_KEY_SECRET
 *   OTS_TABLE_USERS（可选，默认 nx_users）
 *
 * 执行：
 *   node scripts/migrate-users-is-first-recharge.mjs
 *
 * 完成后可在表格存储控制台打开 nx_users 抽样行，确认已出现 is_first_recharge 列。
 *
 * 环境变量从项目根目录（与 package.json 同级）的 .env 加载；PowerShell 下直接 npm run 即可。
 */
import { createRequire } from 'module';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const envPath = join(ROOT, '.env');

const envResult = dotenv.config({ path: envPath });
if (envResult.error) {
  if (!existsSync(envPath)) {
    console.error('[migrate] 未找到 .env 文件:', envPath);
    console.error('[migrate] 请在 demo/aliyun-fc-init-user 目录创建 .env，并填写 OTS_ENDPOINT、OTS_INSTANCE、OTS_ACCESS_KEY_ID、OTS_ACCESS_KEY_SECRET');
    process.exit(1);
  }
  console.warn('[migrate] 读取 .env 时出现警告:', envResult.error.message);
}

const require = createRequire(import.meta.url);
const TableStore = require('tablestore');

const OTS_ENDPOINT = process.env.OTS_ENDPOINT?.trim() || '';
const OTS_INSTANCE = process.env.OTS_INSTANCE?.trim() || '';
const USERS_TABLE = (process.env.OTS_TABLE_USERS || 'nx_users').toLowerCase();

function missingOtsVars() {
  const miss = [];
  if (!OTS_ENDPOINT) miss.push('OTS_ENDPOINT');
  if (!OTS_INSTANCE) miss.push('OTS_INSTANCE');
  if (!process.env.OTS_ACCESS_KEY_ID?.trim()) miss.push('OTS_ACCESS_KEY_ID');
  if (!process.env.OTS_ACCESS_KEY_SECRET?.trim()) miss.push('OTS_ACCESS_KEY_SECRET');
  return miss;
}
const missing = missingOtsVars();
if (missing.length) {
  console.error('[migrate] 以下环境变量未设置或为空:', missing.join(', '));
  console.error('[migrate] 请在', envPath, '中填写（或先在 PowerShell 中 $env:OTS_xxx=... 再运行）。');
  process.exit(1);
}

function getClient() {
  return new TableStore.Client({
    accessKeyId: process.env.OTS_ACCESS_KEY_ID,
    secretAccessKey: process.env.OTS_ACCESS_KEY_SECRET,
    endpoint: OTS_ENDPOINT,
    instancename: OTS_INSTANCE,
  });
}

function attrsToObj(attributes) {
  if (!attributes || !Array.isArray(attributes)) return {};
  const obj = {};
  attributes.forEach((a) => {
    obj[a.columnName] = a.columnValue?.toString?.() ?? a.columnValue;
  });
  return obj;
}

/** 从 getRange 返回的 primaryKey 解析主键字符串（nx_users 仅 user_id） */
function extractUserIdFromRow(row) {
  const pk = row.primaryKey;
  if (!pk || !pk.length) return null;
  const cell = pk[0];
  if (!cell || typeof cell !== 'object') return null;
  const v = cell.user_id ?? cell.value;
  return v != null ? String(v) : null;
}

function getRangePromise(client, params) {
  return new Promise((resolve, reject) => {
    client.getRange(params, (err, data) => {
      if (err) reject(err);
      else resolve(data || {});
    });
  });
}

function updateRowPromise(client, params) {
  return new Promise((resolve, reject) => {
    client.updateRow(params, (err, data) => {
      if (err) reject(err);
      else resolve(data || {});
    });
  });
}

async function main() {
  const client = getClient();
  let nextStart = [{ user_id: TableStore.INF_MIN }];
  const endPK = [{ user_id: TableStore.INF_MAX }];

  let scanned = 0;
  let updated = 0;
  let skippedHasAttr = 0;
  let errors = 0;
  const sampleUpdated = [];

  let safety = 0;
  const maxPages = 100000;

  console.log('[migrate] 表:', USERS_TABLE, '| endpoint 已配置:', Boolean(OTS_ENDPOINT));

  while (safety < maxPages) {
    safety += 1;
    const res = await getRangePromise(client, {
      tableName: USERS_TABLE,
      direction: TableStore.Direction.FORWARD,
      inclusiveStartPrimaryKey: nextStart,
      exclusiveEndPrimaryKey: endPK,
      limit: 100,
    });

    const rows = res.rows || [];
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      const userId = extractUserIdFromRow(row);
      if (!userId) {
        console.warn('[migrate] 跳过无法解析主键的行');
        errors += 1;
        continue;
      }

      const attrs = attrsToObj(row.attributes);
      if (Object.prototype.hasOwnProperty.call(attrs, 'is_first_recharge')) {
        skippedHasAttr += 1;
        continue;
      }

      try {
        await updateRowPromise(client, {
          tableName: USERS_TABLE,
          condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, null),
          primaryKey: [{ user_id: userId }],
          updateOfAttributeColumns: [{ PUT: [{ is_first_recharge: 'true' }] }],
        });
        updated += 1;
        if (sampleUpdated.length < 5) sampleUpdated.push(userId);
        console.log('[migrate] UpdateRow OK user_id=', userId);
      } catch (e) {
        errors += 1;
        console.error('[migrate] UpdateRow 失败 user_id=', userId, e?.message || e);
      }
    }

    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    if (!nextPk) break;
    nextStart = nextPk;
  }

  console.log('');
  console.log('[migrate] 完成统计');
  console.log('  扫描行数:', scanned);
  console.log('  已存在 is_first_recharge，跳过:', skippedHasAttr);
  console.log('  UpdateRow 写入:', updated);
  console.log('  失败:', errors);
  if (sampleUpdated.length) {
    console.log('  抽样已更新 user_id（前几条）:', sampleUpdated.join(', '));
  }
  console.log('');
  console.log('[migrate] 请在阿里云表格存储控制台打开表', USERS_TABLE, '抽样查看列 is_first_recharge 是否为 true。');
}

main().catch((e) => {
  console.error('[migrate] 异常:', e?.stack || e);
  process.exit(1);
});
