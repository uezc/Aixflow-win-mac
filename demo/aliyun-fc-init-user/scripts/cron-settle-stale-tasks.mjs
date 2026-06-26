#!/usr/bin/env node
/**
 * 定时结算：调用已部署 FC 的 POST /internal/settle-stale-tasks
 *
 * 环境变量（必填）：
 *   ALIYUN_FC_INIT_USER_URL — FC HTTP 触发器根 URL（可含路径，脚本会拼 /internal/settle-stale-tasks）
 *   ADMIN_SETTLE_SECRET — 与 FC 环境变量 ADMIN_SETTLE_SECRET 一致
 *
 * crontab 示例（每 5 分钟）：
 *   */5 * * * * cd /path/to/demo/aliyun-fc-init-user && set -a && . ./.env && set +a && node scripts/cron-settle-stale-tasks.mjs
 */
const urlBase = (process.env.ALIYUN_FC_INIT_USER_URL || '').trim().replace(/\/$/, '');
const secret = (process.env.ADMIN_SETTLE_SECRET || '').trim();
if (!urlBase || !secret) {
  console.error('[cron-settle] 需要环境变量 ALIYUN_FC_INIT_USER_URL 与 ADMIN_SETTLE_SECRET');
  process.exit(1);
}

const url = `${urlBase.replace(/\/$/, '')}/internal/settle-stale-tasks`;

const maxAgeMs = process.env.NX_STALE_TASK_MAX_AGE_MS;
const body = {};
if (maxAgeMs && String(maxAgeMs).trim()) body.max_age_ms = parseInt(String(maxAgeMs), 10);

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-admin-settle-secret': secret,
  },
  body: JSON.stringify(body),
});

const text = await res.text();
let json;
try {
  json = JSON.parse(text);
} catch {
  json = text;
}
console.log('[cron-settle]', res.status, typeof json === 'string' ? json.slice(0, 800) : JSON.stringify(json).slice(0, 800));
process.exit(res.ok ? 0 : 1);
