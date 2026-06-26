/**
 * 跨地域同步 Tablestore：香港实例 → 北京实例（全表主键范围扫描 + 批量写入）
 *
 * 说明：
 * - 阿里云表格存储的数据面官方 Node SDK 包名为 `tablestore`（与 demo/aliyun-fc-init-user/lib/db-tablestore.mjs 一致）。
 * - 若你听到 @alicloud/ots，多为管控/OpenAPI；行级迁移请用本脚本 + tablestore。
 *
 * 环境变量（项目根 .env）：
 *   OTS_ACCESS_KEY_ID、OTS_ACCESS_KEY_SECRET 必填
 *   OTS_SOURCE_ENDPOINT（默认香港）、OTS_TARGET_ENDPOINT（默认北京）
 *   OTS_SOURCE_INSTANCE、OTS_TARGET_INSTANCE（默认从 Endpoint 主机名解析，如 nexflow-db）
 *   OTS_TRANSACTIONS_PK（可选，与线上 nx_transactions 主键列一致，默认 transaction_id）
 *   MIGRATE_LEGACY_TRANSACTIONS_PK（可选，仅表 `transactions` 的主键列名，默认同 OTS_TRANSACTIONS_PK）
 *
 * 用法：
 *   node migrate_ots.mjs
 *   node migrate_ots.mjs --dry-run
 *   node migrate_ots.mjs --only nx_email_user
 *   node migrate_ots.mjs --only nx_email_user,nx_users
 */

import 'dotenv/config';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const TableStore = require('tablestore');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_SOURCE_ENDPOINT = 'https://nexflow-db.cn-hongkong.ots.aliyuncs.com';
const DEFAULT_TARGET_ENDPOINT = 'https://nexflow-db.cn-beijing.ots.aliyuncs.com';

/**
 * 要迁移的表名（北京侧须已建同名表且主键一致）。
 * nx_email_user 紧跟 nx_users（邮箱索引与账号一致，且避免长任务跑完后才同步邮箱表被中断）。
 */
const TABLES = [
  'nx_model_config',
  'nx_users',
  'nx_email_user',
  'nx_tasks',
  'nx_coupons',
  'nx_transactions',
  'nx_verify_codes',
  'transactions',
];

const GET_RANGE_LIMIT = 2000;
/** 单次 BatchWriteRow 行数上限（OTS 单请求有上限，保守 100） */
const BATCH_WRITE_ROWS = 100;

function parseInstanceFromEndpoint(endpointUrl) {
  try {
    const raw = String(endpointUrl || '').trim();
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const host = u.hostname;
    const m = /^([^.]+)\.cn-[a-z0-9-]+\.ots\.aliyuncs\.com$/i.exec(host);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

function loadCredentials() {
  const accessKeyId = process.env.OTS_ACCESS_KEY_ID?.trim() || '';
  const secretAccessKey = process.env.OTS_ACCESS_KEY_SECRET?.trim() || '';
  const sourceEndpoint = (process.env.OTS_SOURCE_ENDPOINT || DEFAULT_SOURCE_ENDPOINT).trim();
  const targetEndpoint = (process.env.OTS_TARGET_ENDPOINT || DEFAULT_TARGET_ENDPOINT).trim();
  let sourceInstance = process.env.OTS_SOURCE_INSTANCE?.trim() || '';
  let targetInstance = process.env.OTS_TARGET_INSTANCE?.trim() || '';
  if (!sourceInstance) sourceInstance = parseInstanceFromEndpoint(sourceEndpoint);
  if (!targetInstance) targetInstance = parseInstanceFromEndpoint(targetEndpoint);
  const txPk = (process.env.OTS_TRANSACTIONS_PK || 'transaction_id').trim();
  const legacyTxPk = (process.env.MIGRATE_LEGACY_TRANSACTIONS_PK || txPk).trim();
  return {
    accessKeyId,
    secretAccessKey,
    sourceEndpoint,
    targetEndpoint,
    sourceInstance,
    targetInstance,
    txPk,
    legacyTxPk,
  };
}

function makeClient(cfg, endpoint, instance) {
  return new TableStore.Client({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    endpoint,
    instancename: instance,
  });
}

function pify(fn, client, arg) {
  return new Promise((resolve, reject) => {
    fn.call(client, arg, (err, data) => {
      if (err) reject(err);
      else resolve(data || {});
    });
  });
}

function getRangePromise(client, params) {
  return pify(client.getRange, client, params);
}

function describeTablePromise(client, tableName) {
  return pify(client.describeTable, client, { tableName });
}

function batchWriteRowPromise(client, params) {
  return pify(client.batchWriteRow, client, params);
}

function putRowPromise(client, params) {
  return pify(client.putRow, client, params);
}

function primaryKeyToPutFormat(pkList) {
  if (!Array.isArray(pkList)) return [];
  const out = [];
  for (const p of pkList) {
    if (!p || typeof p !== 'object') continue;
    if (p.name != null && p.value !== undefined) {
      out.push({ [p.name]: p.value });
      continue;
    }
    const keys = Object.keys(p).filter((k) => !['name', 'columnName', 'value'].includes(k));
    for (const k of keys) {
      if (p[k] !== undefined && typeof p[k] !== 'function') {
        out.push({ [k]: p[k] });
      }
    }
  }
  return out;
}

function attributesToPutFormat(attributes) {
  if (!Array.isArray(attributes)) return [];
  const cols = [];
  for (const a of attributes) {
    if (!a || typeof a !== 'object') continue;
    const name = a.columnName || a.name;
    if (!name) continue;
    const val = a.columnValue !== undefined ? a.columnValue : a.value;
    cols.push({ [name]: val });
  }
  return cols;
}

function getPkColumnName(tableName, cfg) {
  const t = tableName.toLowerCase();
  if (t === 'nx_transactions') return cfg.txPk;
  if (t === 'transactions') return cfg.legacyTxPk;
  const map = {
    nx_model_config: 'model_id',
    nx_users: 'user_id',
    nx_tasks: 'task_id',
    nx_coupons: 'code',
    nx_verify_codes: 'email',
    nx_email_user: 'email',
  };
  return map[t] || 'pk';
}

function buildInfRange(pkCol) {
  return {
    inclusiveStartPrimaryKey: [{ [pkCol]: TableStore.INF_MIN }],
    exclusiveEndPrimaryKey: [{ [pkCol]: TableStore.INF_MAX }],
  };
}

function isTableMissingError(err) {
  const c = String(err?.code || '');
  const m = String(err?.message || err || '');
  return (
    /ObjectNotExist|OTSObjectNotExist|ResourceNotFound|TableNotExist|not exist/i.test(c + m) ||
    /表不存在|不存在/i.test(m)
  );
}

async function migrateTable(sourceClient, destClient, tableName, dryRun, cfg) {
  const pkCol = getPkColumnName(tableName, cfg);
  const range = buildInfRange(pkCol);

  console.log(`正在同步表 ${tableName}...`);

  try {
    await describeTablePromise(sourceClient, tableName);
  } catch (e) {
    if (isTableMissingError(e)) {
      console.warn(`[跳过] 源实例不存在表 ${tableName}，已忽略。`);
      return 0;
    }
    throw e;
  }

  try {
    await describeTablePromise(destClient, tableName);
  } catch (e) {
    if (isTableMissingError(e)) {
      console.error(
        `\n[错误] 目标（北京）实例中不存在表「${tableName}」。请先在阿里云控制台创建该表，且主键列名须与香港侧一致（本脚本对当前表推断主键列：${pkCol}）。\n`,
      );
      return 0;
    }
    throw e;
  }

  let nextStart = range.inclusiveStartPrimaryKey;
  const endPK = range.exclusiveEndPrimaryKey;
  let total = 0;
  const cond = new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null);

  while (true) {
    const res = await getRangePromise(sourceClient, {
      tableName,
      direction: TableStore.Direction.FORWARD,
      inclusiveStartPrimaryKey: nextStart,
      exclusiveEndPrimaryKey: endPK,
      limit: GET_RANGE_LIMIT,
    });

    const rows = res.rows || [];
    if (rows.length === 0) {
      const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
      if (!nextPk) break;
      nextStart = nextPk;
      continue;
    }

    if (dryRun) {
      total += rows.length;
    } else {
      for (let i = 0; i < rows.length; i += BATCH_WRITE_ROWS) {
        const chunk = rows.slice(i, i + BATCH_WRITE_ROWS);
        const batchRows = chunk.map((row) => {
          const primaryKey = primaryKeyToPutFormat(row.primaryKey);
          const attributeColumns = attributesToPutFormat(row.attributes);
          return {
            type: 'PUT',
            condition: cond,
            primaryKey,
            attributeColumns,
          };
        });

        try {
          await batchWriteRowPromise(destClient, {
            tables: [{ tableName, rows: batchRows }],
          });
          total += chunk.length;
        } catch (e) {
          console.warn(`[${tableName}] batchWriteRow 失败，改逐行 putRow：`, e?.message || e);
          for (const row of chunk) {
            const primaryKey = primaryKeyToPutFormat(row.primaryKey);
            const attributeColumns = attributesToPutFormat(row.attributes);
            await putRowPromise(destClient, {
              tableName,
              condition: cond,
              primaryKey,
              attributeColumns,
            });
            total += 1;
          }
        }
      }
    }

    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    if (!nextPk) break;
    nextStart = nextPk;
  }

  console.log(`表 ${tableName} 同步成功，共迁移 ${total} 条数据。`);
  return total;
}

/** 解析 --only t1,t2 或 --only=t1 */
function parseOnlyTablesArg() {
  const idx = process.argv.findIndex((a) => a === '--only' || a.startsWith('--only='));
  if (idx < 0) return null;
  const raw = process.argv[idx];
  let eq = '';
  if (raw.startsWith('--only=')) {
    eq = raw.slice('--only='.length);
  } else {
    eq = process.argv[idx + 1] || '';
  }
  const list = String(eq || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? new Set(list) : null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const onlySet = parseOnlyTablesArg();
  const cfg = loadCredentials();
  const miss = [];
  if (!cfg.accessKeyId) miss.push('OTS_ACCESS_KEY_ID');
  if (!cfg.secretAccessKey) miss.push('OTS_ACCESS_KEY_SECRET');
  if (!cfg.sourceInstance) miss.push('OTS_SOURCE_INSTANCE（或可从 OTS_SOURCE_ENDPOINT 解析）');
  if (!cfg.targetInstance) miss.push('OTS_TARGET_INSTANCE（或可从 OTS_TARGET_ENDPOINT 解析）');
  if (miss.length) {
    console.error('[migrate_ots] 缺少环境变量:', miss.join(', '));
    console.error('请在仓库根目录配置 .env 后重试。');
    process.exit(1);
  }

  console.log('[migrate_ots] 源:', cfg.sourceEndpoint, '实例:', cfg.sourceInstance);
  console.log('[migrate_ots] 目标:', cfg.targetEndpoint, '实例:', cfg.targetInstance);
  if (dryRun) console.log('[migrate_ots] --dry-run：仅统计源表行数分页读取，不写入北京。\n');

  const sourceClient = makeClient(cfg, cfg.sourceEndpoint, cfg.sourceInstance);
  const destClient = makeClient(cfg, cfg.targetEndpoint, cfg.targetInstance);

  const toRun = TABLES.filter((t) => !onlySet || onlySet.has(t.toLowerCase()));
  if (onlySet) {
    const unknown = [...onlySet].filter((x) => !TABLES.map((n) => n.toLowerCase()).includes(x));
    if (unknown.length) {
      console.warn('[migrate_ots] --only 中有未在清单内的表名，将忽略:', unknown.join(', '));
    }
    console.log('[migrate_ots] 仅迁移:', toRun.length ? toRun.join(', ') : '（无匹配，请检查表名）');
  }

  let grand = 0;
  for (const tableName of toRun) {
    try {
      const n = await migrateTable(sourceClient, destClient, tableName, dryRun, cfg);
      grand += n;
    } catch (e) {
      console.error(`[migrate_ots] 表 ${tableName} 失败（已跳过，继续后续表）：`, e?.message || e);
    }
  }

  console.log(`\n[migrate_ots] 全部完成。累计行数（含跳过表为 0）：${dryRun ? '（dry-run 计数）' : ''}${grand}`);
}

main().catch((e) => {
  console.error('[migrate_ots] 失败:', e?.message || e);
  process.exit(1);
});
