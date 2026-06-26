/**
 * 检查阿里云表格存储 nx_tasks（或 OTS_TABLE_TASKS）是否满足任务系统约定。
 *
 * - describeTable：表存在、主键含 task_id（STRING）。
 * - getRange 采样：合并多行属性列名（OTS 宽列模型无固定属性 schema，仅能靠样例行推断）。
 *
 * 环境变量（与 scripts/sync-pricing-to-ots.mjs 一致）：
 *   OTS_ENDPOINT、OTS_INSTANCE 必填
 *   OTS_ID / OTS_SECRET 或 OTS_ACCESS_KEY_ID / OTS_ACCESS_KEY_SECRET
 *   OTS_TABLE_TASKS（可选，默认 nx_tasks）
 *   TASKS_CHECK_SCAN_LIMIT 单次 getRange 条数，默认 200
 *   TASKS_CHECK_MAX_PAGES 最多翻页次数，默认 20
 *
 * 用法：
 *   node scripts/check-tasks-table.mjs
 *   node scripts/check-tasks-table.mjs --dry-run   # 不连 OTS、不要求 AK/SK
 *   node scripts/check-tasks-table.mjs --strict   # 要求列名严格为 status / cost_coins / result_url / params
 *   node scripts/check-tasks-table.mjs --allow-empty-table  # 表无数据时仍退出 0（仅校验 describe）
 */

import 'dotenv/config';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const TableStore = require('tablestore');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

/** 逻辑名 -> 允许的 OTS 属性列名（小写比较）；与 demo/aliyun-fc-init-user/lib/db-tablestore upsertTask 对齐 */
const CORE_GROUPS = [
  { label: 'status', alternatives: ['status'] },
  {
    label: 'cost_coins',
    alternatives: ['cost_coins', 'cost', 'amount'],
    note: '云函数侧常用 cost、amount（INTEGER）',
  },
  {
    label: 'result_url',
    alternatives: ['result_url', 'result_oss_url'],
    note: '云函数侧为 result_oss_url',
  },
  {
    label: 'params',
    alternatives: ['params', 'prompt_json', 'workflow_json'],
    match: 'any',
    note: '任一为任务参数载体即可（prompt_json / workflow_json 为现有实现）',
  },
];

/** 非阻断：建议存在的列 */
const RECOMMENDED = ['user_id', 'created_at', 'updated_at', 'error_msg'];

const STRICT_ALTERNATIVES = ['status', 'cost_coins', 'result_url', 'params'];

function loadEnv() {
  const endpoint = process.env.OTS_ENDPOINT?.trim() || '';
  const instance = process.env.OTS_INSTANCE?.trim() || '';
  const accessKeyId =
    process.env.OTS_ID?.trim() || process.env.OTS_ACCESS_KEY_ID?.trim() || '';
  const secretAccessKey =
    process.env.OTS_SECRET?.trim() || process.env.OTS_ACCESS_KEY_SECRET?.trim() || '';
  const tableName = (process.env.OTS_TABLE_TASKS || 'nx_tasks').trim().toLowerCase();
  const scanLimit = Math.min(
    500,
    Math.max(1, parseInt(process.env.TASKS_CHECK_SCAN_LIMIT || '200', 10) || 200),
  );
  const maxPages = Math.min(
    100,
    Math.max(1, parseInt(process.env.TASKS_CHECK_MAX_PAGES || '20', 10) || 20),
  );
  return { endpoint, instance, accessKeyId, secretAccessKey, tableName, scanLimit, maxPages };
}

function describeTablePromise(client, tableName) {
  return new Promise((resolve, reject) => {
    client.describeTable({ tableName }, (err, data) => {
      if (err) reject(err);
      else resolve(data || {});
    });
  });
}

function getRangePromise(client, params) {
  return new Promise((resolve, reject) => {
    client.getRange(params, (err, data) => {
      if (err) reject(err);
      else resolve(data || {});
    });
  });
}

function attrNamesFromRow(row) {
  const names = new Set();
  const attrs = row?.attributes;
  if (!attrs || !Array.isArray(attrs)) return names;
  for (const a of attrs) {
    if (!a || typeof a !== 'object') continue;
    const key = a.columnName || a.name;
    if (key) names.add(String(key).toLowerCase());
  }
  return names;
}

function pkSchemaFromDescribe(data) {
  const meta = data.tableMeta || data.TableMeta || {};
  const pk = meta.primaryKey || meta.primary_key || [];
  if (!Array.isArray(pk)) return [];
  return pk.map((col) => ({
    name: String(col.name || col.Name || '').trim(),
    type: String(col.type || col.Type || '').trim(),
  }));
}

async function sampleAttributeNames(client, tableName, scanLimit, maxPages) {
  const union = new Set();
  let rowCount = 0;
  let nextStart = [{ task_id: TableStore.INF_MIN }];
  const endPK = [{ task_id: TableStore.INF_MAX }];
  let pages = 0;

  while (pages < maxPages) {
    pages += 1;
    const res = await getRangePromise(client, {
      tableName,
      direction: TableStore.Direction.FORWARD,
      inclusiveStartPrimaryKey: nextStart,
      exclusiveEndPrimaryKey: endPK,
      limit: scanLimit,
    });
    const rows = res.rows || [];
    for (const row of rows) {
      rowCount += 1;
      for (const n of attrNamesFromRow(row)) union.add(n);
    }
    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    if (!nextPk || rows.length === 0) break;
    nextStart = nextPk;
  }

  return { union, rowCount, pages };
}

function checkCore(union, strict) {
  const failures = [];
  const ok = [];

  if (strict) {
    for (const name of STRICT_ALTERNATIVES) {
      if (union.has(name)) ok.push(name);
      else failures.push({ label: name, missing: name, alternatives: [name] });
    }
    return { failures, ok, mode: 'strict' };
  }

  for (const g of CORE_GROUPS) {
    const alts = g.alternatives.map((a) => a.toLowerCase());
    const hit = alts.find((a) => union.has(a));
    if (hit) {
      ok.push(`${g.label} (命中列: ${hit})`);
    } else {
      failures.push({
        label: g.label,
        missing: alts.join(' | '),
        alternatives: alts,
        note: g.note,
      });
    }
  }
  return { failures, ok, mode: 'alias' };
}

function checkRecommended(union) {
  const missing = [];
  for (const r of RECOMMENDED) {
    if (!union.has(r.toLowerCase())) missing.push(r);
  }
  return missing;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const strict = process.argv.includes('--strict');
  const allowEmpty = process.argv.includes('--allow-empty-table');

  console.log(`[check-tasks-table] 仓库根: ${ROOT}\n`);

  const env = loadEnv();
  console.log(
    `[check-tasks-table] 目标表: ${env.tableName} | 采样 limit=${env.scanLimit}/页, 最多 ${env.maxPages} 页 | 模式: ${strict ? 'strict' : 'alias（兼容云函数列名）'}`,
  );

  if (dryRun) {
    console.log('\n[check-tasks-table] --dry-run：未连接 OTS，不校验环境变量。\n');
    process.exit(0);
  }

  const miss = [];
  if (!env.endpoint) miss.push('OTS_ENDPOINT');
  if (!env.instance) miss.push('OTS_INSTANCE');
  if (!env.accessKeyId) miss.push('OTS_ID 或 OTS_ACCESS_KEY_ID');
  if (!env.secretAccessKey) miss.push('OTS_SECRET 或 OTS_ACCESS_KEY_SECRET');
  if (miss.length) {
    console.error('[check-tasks-table] 缺少环境变量:', miss.join(', '));
    process.exit(1);
  }

  const client = new TableStore.Client({
    accessKeyId: env.accessKeyId,
    secretAccessKey: env.secretAccessKey,
    endpoint: env.endpoint,
    instancename: env.instance,
  });

  let describeData;
  try {
    describeData = await describeTablePromise(client, env.tableName);
  } catch (e) {
    console.error('[check-tasks-table] describeTable 失败:', e?.message || e);
    process.exit(1);
  }

  const pkCols = pkSchemaFromDescribe(describeData);
  console.log('\n[check-tasks-table] 主键定义:');
  if (pkCols.length === 0) {
    console.error('  (无法解析 primaryKey，请检查 SDK 返回结构)');
    process.exit(1);
  }
  pkCols.forEach((c) => console.log(`  - ${c.name}: ${c.type || '(?)'}`));

  const hasTaskId = pkCols.some((c) => c.name.toLowerCase() === 'task_id');
  if (!hasTaskId) {
    console.error('\n[check-tasks-table] 失败: 主键中未找到 task_id');
    process.exit(1);
  }

  const taskIdCol = pkCols.find((c) => c.name.toLowerCase() === 'task_id');
  if (taskIdCol?.type && !/string/i.test(taskIdCol.type)) {
    console.warn('[check-tasks-table] 警告: task_id 类型非 STRING，请与控制台核对');
  }

  let sample;
  try {
    sample = await sampleAttributeNames(client, env.tableName, env.scanLimit, env.maxPages);
  } catch (e) {
    console.error('[check-tasks-table] getRange 采样失败:', e?.message || e);
    process.exit(1);
  }

  console.log(`\n[check-tasks-table] 采样: 共 ${sample.rowCount} 行, ${sample.pages} 次请求, 合并属性列 ${sample.union.size} 个`);
  if (sample.union.size > 0) {
    console.log('  列名:', [...sample.union].sort().join(', '));
  }

  if (sample.rowCount === 0) {
    console.warn(
      '\n[check-tasks-table] 表内暂无数据行，无法从样例推断属性列是否存在。\n' +
        '  若仅建表未写入任务，请使用 --allow-empty-table 跳过属性检查（退出 0），或插入样例行后重跑。',
    );
    if (!allowEmpty) {
      process.exit(1);
    }
    console.log('[check-tasks-table] --allow-empty-table：主键检查通过，退出 0。\n');
    process.exit(0);
  }

  const core = checkCore(sample.union, strict);
  console.log(`\n[check-tasks-table] 核心属性组 (${core.mode}):`);
  core.ok.forEach((x) => console.log(`  ✓ ${x}`));
  if (core.failures.length) {
    core.failures.forEach((f) => {
      console.error(`  ✗ ${f.label}: 未找到列（需要其一: ${f.missing}）`);
      if (f.note) console.error(`      说明: ${f.note}`);
    });
  }

  const recMiss = checkRecommended(sample.union);
  if (recMiss.length) {
    console.log('\n[check-tasks-table] 建议列（未在采样中出现，不阻断）:');
    recMiss.forEach((r) => console.log(`  - ${r}`));
  } else {
    console.log('\n[check-tasks-table] 建议列均在采样中出现。');
  }

  if (core.failures.length) {
    console.error('\n[check-tasks-table] 结论: 未通过\n');
    process.exit(1);
  }

  console.log('\n[check-tasks-table] 结论: 通过\n');
  process.exit(0);
}

main().catch((e) => {
  console.error('[check-tasks-table] 未捕获错误:', e?.message || e);
  process.exit(1);
});
