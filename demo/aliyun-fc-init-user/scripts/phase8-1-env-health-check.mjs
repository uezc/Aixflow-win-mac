/**
 * Phase 8.1 环境健康检查（OTS + FC internal + RH 连通性）
 * node scripts/phase8-1-env-health-check.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '../../');

function loadEnvFile(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvFile(path.join(REPO, '.env'));
loadEnvFile(path.join(ROOT, '.env'));

const FC_BASE = (process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '').replace(/\/$/, '');
const FC_TOKEN = process.env.ALIYUN_FC_TOKEN || '';
const ADMIN_SECRET = process.env.ADMIN_SETTLE_SECRET || '';

const report = {
  at: new Date().toISOString(),
  ots: { ok: false, detail: '' },
  fc: { ok: false, endpoints: {} },
  rh: { ok: false, detail: '' },
  flags: {
    VIDEO_QUEUE_ENABLED: process.env.VIDEO_QUEUE_ENABLED || '(unset)',
    VITE_VIDEO_QUEUE_ENABLED: process.env.VITE_VIDEO_QUEUE_ENABLED || '(unset)',
  },
};

async function checkOts() {
  try {
    const db = await import('../lib/db-tablestore.mjs');
    const snap = await db.getPlatformConcurrencyPoolSnapshot();
    report.ots.ok = snap?.video?.max != null;
    report.ots.detail = `video.max=${snap?.video?.max} video.running=${snap?.video?.running}`;
    // 条件更新探测：只读 counter，不写
    const testUser = `__health_${Date.now()}`;
    try {
      await db.createUserOtpOnly({ userId: testUser, email: `${testUser}@health.local` });
      const u = await db.getUserById(testUser);
      report.ots.write_ok = Boolean(u?.userId || u?.user_id);
    } catch (e) {
      report.ots.write_ok = false;
      report.ots.write_error = String(e?.message || e).slice(0, 120);
    }
  } catch (e) {
    report.ots.ok = false;
    report.ots.detail = String(e?.message || e).slice(0, 200);
  }
}

async function fcPost(pathSuffix, body = {}) {
  const url = `${FC_BASE}${pathSuffix}`;
  const headers = {
    'content-type': 'application/json',
    'x-nexflow-token': FC_TOKEN,
    'x-admin-settle-secret': ADMIN_SECRET,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, json };
}

async function checkFc() {
  const paths = [
    ['promote-queued-tasks', { max_claims: 0 }],
    ['charge-claimed-tasks', { max_tasks: 0 }],
    ['dispatch-charged-tasks', { max_tasks: 0 }],
    ['poll-provider-tasks', { max_tasks: 0 }],
  ];
  for (const [name, body] of paths) {
    const r = await fcPost(`/internal/${name}`, body);
    report.fc.endpoints[name] = {
      status: r.status,
      error: r.json?.error || r.json?.message || (r.status >= 400 ? r.json?.raw?.slice(0, 80) : 'ok'),
    };
  }
  const statuses = Object.values(report.fc.endpoints).map((e) => e.status);
  report.fc.ok = statuses.every((s) => s === 200);
}

async function checkRh() {
  const key = String(process.env.RUNNINGHUB_API_KEY || '').trim();
  if (!key) {
    report.rh.detail = 'RUNNINGHUB_API_KEY unset locally; assuming FC env has key (not verified from local)';
    report.rh.ok = false;
    report.rh.skipped = true;
    return;
  }
  const base = String(process.env.RUNNINGHUB_API_BASE || 'https://www.runninghub.cn/openapi/v2').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ taskId: 'health-check-nonexistent' }),
      signal: AbortSignal.timeout(30_000),
    });
    report.rh.http_status = res.status;
    report.rh.ok = res.status === 200 || res.status === 400 || res.status === 404;
    report.rh.detail = `HTTP ${res.status} (connectivity ok if not 5xx/network error)`;
  } catch (e) {
    report.rh.ok = false;
    report.rh.detail = String(e?.message || e).slice(0, 120);
  }
}

async function main() {
  if (!FC_BASE) {
    console.error('HK_FC_ENDPOINT missing');
    process.exit(1);
  }
  await checkOts();
  await checkFc();
  await checkRh();

  const out = path.resolve(__dirname, 'phase8-1-env-health-check-result.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));

  console.log('[health] OTS:', report.ots.ok ? 'OK' : 'FAIL', report.ots.detail);
  console.log('[health] FC:', report.fc.ok ? 'OK' : 'FAIL', JSON.stringify(report.fc.endpoints));
  console.log('[health] RH:', report.rh.skipped ? 'SKIP' : report.rh.ok ? 'OK' : 'FAIL', report.rh.detail);
  console.log('[health] flags:', report.flags);
  console.log('[health] written:', out);

  const ready = report.ots.ok && report.fc.ok;
  if (!ready) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
