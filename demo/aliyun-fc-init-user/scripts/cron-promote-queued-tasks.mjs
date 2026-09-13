/**
 * Phase 5 定时 promote：调用 FC POST /internal/promote-queued-tasks
 *
 * 环境变量：
 *   ALIYUN_FC_INIT_USER_URL — FC HTTP 触发器根 URL
 *   ADMIN_SETTLE_SECRET — 与 settle-stale 共用
 *
 * 示例 cron（每分钟）：
 *   * * * * * cd /path/to/demo/aliyun-fc-init-user && set -a && . ./.env && set +a && node scripts/cron-promote-queued-tasks.mjs
 *
 * 低频 reconcile（建议每 10–30 分钟另跑）：
 *   RECONCILE=1 node scripts/cron-promote-queued-tasks.mjs
 */
const urlBase = (process.env.ALIYUN_FC_INIT_USER_URL || '').trim();
if (!urlBase) {
  console.error('ALIYUN_FC_INIT_USER_URL required');
  process.exit(1);
}
const secret = (process.env.ADMIN_SETTLE_SECRET || '').trim();
if (!secret) {
  console.error('ADMIN_SETTLE_SECRET required');
  process.exit(1);
}

const reconcile =
  process.env.RECONCILE === '1' ||
  String(process.env.RECONCILE || '').toLowerCase() === 'true';

const path = reconcile
  ? '/internal/reconcile-queue-reservations'
  : '/internal/promote-queued-tasks';
const url = `${urlBase.replace(/\/$/, '')}${path}`;

const body = reconcile
  ? {
      max_orphans: parseInt(process.env.NX_RECONCILE_MAX_ORPHANS || '50', 10) || 50,
      max_lease_recover: parseInt(process.env.NX_RECONCILE_MAX_LEASE || '50', 10) || 50,
    }
  : {
      max_claims: parseInt(process.env.NX_PROMOTE_BATCH_SIZE || '20', 10) || 20,
      reconcile: false,
      max_lease_recover: parseInt(process.env.NX_PROMOTE_MAX_LEASE || '50', 10) || 50,
    };

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-admin-settle-secret': secret,
  },
  body: JSON.stringify(body),
});

const text = await res.text();
console.log(`[cron-promote] ${path} status=${res.status} body=${text.slice(0, 2000)}`);
if (!res.ok) process.exit(1);
