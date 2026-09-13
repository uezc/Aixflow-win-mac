/**
 * OTS 成本保留清理
 *
 * - 终端任务（success|failed|cancelled|timeout）超过 3 天 → 删除 nx_tasks
 *   （并删匹配的 nx_task_charges / nx_task_work）
 * - 每用户 nx_transactions 仅保留最新 100 条
 * - 不动余额、nx_users、nx_model_config、已支付订单
 *
 * Usage:
 *   node scripts/cleanup-ots-retention.mjs              # DRY_RUN=1 默认，只统计
 *   APPLY=1 node scripts/cleanup-ots-retention.mjs      # 真正删除
 *
 * 亦可经 FC：POST /internal/cleanup-ots-retention
 *   Header: x-admin-settle-secret: $ADMIN_SETTLE_SECRET
 *   Body: { "apply": true, "task_retention_days": 3, "tx_keep_per_user": 100 }
 *
 * 需本地/CI 配置 .env（OTS_ENDPOINT、OTS_INSTANCE、密钥等）。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

const apply =
  String(process.env.APPLY || '') === '1' ||
  String(process.env.DRY_RUN || '1') === '0';

const db = await import('../lib/db-tablestore.mjs');

if (typeof db.ensureTaskWorkTable === 'function') {
  try {
    const er = await db.ensureTaskWorkTable();
    console.log('[ensureTaskWorkTable]', JSON.stringify(er));
  } catch (e) {
    console.warn('[ensureTaskWorkTable] skipped:', e?.message || e);
  }
}

const r = await db.runOtsRetentionCleanup({
  apply,
  taskRetentionDays: parseInt(process.env.TASK_RETENTION_DAYS || '3', 10) || 3,
  txKeepPerUser: parseInt(process.env.TX_KEEP_PER_USER || '100', 10) || 100,
  maxTaskDeletes: parseInt(process.env.MAX_TASK_DELETES || '500', 10) || 500,
  maxTxDeletes: parseInt(process.env.MAX_TX_DELETES || '2000', 10) || 2000,
  maxScanRows: parseInt(process.env.MAX_SCAN_ROWS || '10000', 10) || 10000,
  skip_tx: String(process.env.SKIP_TX || process.env.TASKS_ONLY || '') === '1',
  skip_tasks: String(process.env.SKIP_TASKS || '') === '1',
});

console.log(JSON.stringify(r, null, 2));
const outPath = path.join(__dirname, 'cleanup-ots-retention-result.json');
fs.writeFileSync(outPath, JSON.stringify(r, null, 2));
console.log('wrote', outPath);
process.exit(r.ok ? 0 : 1);
