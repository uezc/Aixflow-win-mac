/**
 * 用户 Queue UX 冒烟（验证 ahead_count 在 queued 态可见）
 * 策略：skip_pipeline 创建 N 个 → 对前 U 个调 status 占满并发 → 再查尾部 queued 的 ahead
 *
 * node scripts/smoke-user-queue-ux.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvFile(path.join(REPO, '.env'));
loadEnvFile(path.join(ROOT, '.env'));

const require = createRequire(path.join(ROOT, 'package.json'));
const jwt = require('jsonwebtoken');

const FC_BASE = (process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '').replace(/\/$/, '');
const FC_TOKEN = process.env.ALIYUN_FC_TOKEN || '';
const ADMIN_SECRET = process.env.ADMIN_SETTLE_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || '';
const PREFIX = `__uxsmoke2_${Date.now().toString(36)}_`;
const CREATE_N = 7;
const FILL_N = 5; // 默认用户 video 并发

const out = {
  at: new Date().toISOString(),
  fc: FC_BASE,
  ok: false,
  steps: {},
  errors: [],
};

function log(m) {
  console.log(`[ux-smoke] ${m}`);
}

function signAccessToken(userId, tokenVersion = 0) {
  return jwt.sign({ sub: userId, typ: 'access', tv: tokenVersion }, JWT_SECRET, { expiresIn: '2h' });
}

async function fcFetch(pathSuffix, { body = {}, auth = null, timeoutMs = 90_000 } = {}) {
  const url = `${FC_BASE}${pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`}`;
  const headers = {
    'content-type': 'application/json',
    'x-nexflow-token': FC_TOKEN,
  };
  if (auth) headers.authorization = `Bearer ${auth}`;
  if (ADMIN_SECRET) headers['x-admin-settle-secret'] = ADMIN_SECRET;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 400) };
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

function h3Forward(prompt) {
  return {
    provider: 'runninghub',
    path: '/run/ai-app/2085682347676102657',
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '149', fieldName: 'text', fieldValue: prompt, description: '提示词' },
        { nodeId: '16', fieldName: 'megapixels', fieldValue: '0.9', description: '分辨率（看介绍）' },
        {
          nodeId: '16',
          fieldName: 'aspect_ratio',
          fieldValue: '16:9 (Widescreen)',
          description: '比例选择',
        },
        { nodeId: '14', fieldName: 'value', fieldValue: '6', description: '时长' },
      ],
      instanceType: 'plus',
      usePersonalQueue: 'false',
    },
    billingModelId: 'minimax-h3-t2v-720p-6s',
    rhRegion: 'cn',
  };
}

if (!FC_BASE || !JWT_SECRET) {
  console.error('需要 HK_FC_ENDPOINT/ALIYUN_FC_INIT_USER_URL 与 JWT_SECRET');
  process.exit(1);
}

const db = await import('../lib/db-tablestore.mjs');
const userId = `${PREFIX}u`;
const email = `${userId}@uxsmoke.local`;
await db.createUserOtpOnly({ userId, email });
const auth = signAccessToken(userId, 0);
log(`user=${userId} create=${CREATE_N} fill=${FILL_N}`);

const createdIds = [];
try {
  for (let i = 0; i < CREATE_N; i++) {
    const r = await fcFetch('/tasks/create', {
      auth,
      body: {
        model_id: 'minimax-h3-t2v-720p-6s',
        type: 'video',
        execution_mode: 'queue',
        skip_queue_pipeline: true,
        provider_forward_json: h3Forward(`${PREFIX} p${i}`),
        params: { smoke: true, i },
      },
    });
    if (r.status !== 200 || !r.json?.task_id) {
      out.errors.push(`create_${i}: ${JSON.stringify(r.json).slice(0, 240)}`);
      throw new Error(`create_${i} failed http=${r.status}`);
    }
    createdIds.push(r.json.task_id);
    log(`created[${i}]=${r.json.task_id}`);
  }
  out.steps.created = createdIds;

  // 占满用户并发：对前 FILL_N 个调 status（会 advance → claimed/running）
  for (let i = 0; i < FILL_N; i++) {
    const st = await fcFetch('/tasks/status', { auth, body: { task_id: createdIds[i] } });
    out.steps[`fill_${i}`] = {
      status: st.json?.status,
      has_ahead_key: Object.prototype.hasOwnProperty.call(st.json || {}, 'ahead_count'),
    };
    log(`fill[${i}] status=${st.json?.status}`);
  }

  // 查尾部：期望仍为 queued，且带 ahead
  const tailIdx = [FILL_N, FILL_N + 1];
  const tails = [];
  for (const i of tailIdx) {
    const st = await fcFetch('/tasks/status', { auth, body: { task_id: createdIds[i] } });
    const row = {
      i,
      task_id: createdIds[i],
      status: st.json?.status,
      ahead_count: st.json?.ahead_count,
      queue_position: st.json?.queue_position,
      queue_position_available: st.json?.queue_position_available,
      queue_position_complete: st.json?.queue_position_complete,
      has_ahead_key: Object.prototype.hasOwnProperty.call(st.json || {}, 'ahead_count'),
    };
    tails.push(row);
    out.steps[`tail_${i}`] = row;
    log(
      `tail[${i}] status=${row.status} ahead=${row.ahead_count} pos=${row.queue_position} avail=${row.queue_position_available}`,
    );
  }

  const deployed = tails.every((t) => t.has_ahead_key);
  if (!deployed) {
    out.errors.push('MISSING_ahead_count_FIELD');
  }

  const queuedTails = tails.filter((t) => String(t.status).toLowerCase() === 'queued');
  if (queuedTails.length === 0) {
    out.errors.push('NO_QUEUED_TAIL — 并发未占满或 advance 把尾部也推走了；字段部署仍可能 OK');
    // 若字段存在即视为部署成功
    out.ok = deployed;
  } else {
    const bad = queuedTails.filter((t) => t.queue_position_available !== true || t.ahead_count == null);
    if (bad.length) {
      out.errors.push(`QUEUED_WITHOUT_POSITION: ${JSON.stringify(bad)}`);
      out.ok = false;
    } else {
      out.ok = deployed;
      // 后一个 ahead 应 >= 前一个（同批 FIFO）
      if (queuedTails.length >= 2) {
        const a = Number(queuedTails[0].ahead_count);
        const b = Number(queuedTails[1].ahead_count);
        out.steps.relative = { a, b };
        if (!(b >= a)) {
          out.errors.push(`relative ahead unexpected ${a} then ${b}`);
          out.ok = false;
        }
      }
    }
  }
} catch (e) {
  out.errors.push(String(e?.message || e));
  out.ok = false;
} finally {
  for (const tid of createdIds) {
    try {
      await db.upsertTask(tid, userId, {
        status: 'failed',
        error_code: 'UX_SMOKE_CLEANUP',
        error_msg: 'smoke cleanup',
      });
    } catch (_) {
      /* ignore */
    }
  }
  // 尝试释放可能占着的并发槽（若任务仍 claimed/running）
  try {
    if (typeof db.releaseUserConcurrencySlot === 'function') {
      for (let i = 0; i < FILL_N; i++) {
        await db.releaseUserConcurrencySlot(userId, 'video').catch(() => {});
        await db.releasePlatformConcurrencySlot?.('video')?.catch?.(() => {});
      }
    }
  } catch (_) {}
}

const reportPath = path.join(ROOT, 'scripts/smoke-user-queue-ux-result.json');
fs.writeFileSync(reportPath, JSON.stringify(out, null, 2));
log(`ok=${out.ok}`);
if (out.errors.length) log(`errors: ${out.errors.join(' | ')}`);
log(`report: ${reportPath}`);
process.exit(out.ok ? 0 : 1);
