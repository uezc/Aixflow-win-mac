/**
 * 只验证：FC 响应含字段 + OTS 上 queued 时 enrich 能算出 ahead（不经 advance）
 * node scripts/smoke-user-queue-ux-position-only.mjs
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
const FC = (process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '').replace(/\/$/, '');
const FC_TOKEN = process.env.ALIYUN_FC_TOKEN || '';
const JWT_SECRET = process.env.JWT_SECRET || '';

const db = await import('../lib/db-tablestore.mjs');
const { enrichTaskStatusForUserUx, clearQueuePositionSnapshotCache } = await import(
  '../lib/queuePosition.mjs'
);

const userId = `__uxpos_${Date.now().toString(36)}`;
await db.createUserOtpOnly({ userId, email: `${userId}@t.local` });
const auth = jwt.sign({ sub: userId, typ: 'access', tv: 0 }, JWT_SECRET, { expiresIn: '1h' });

const fwd = {
  provider: 'runninghub',
  path: '/run/ai-app/2085682347676102657',
  method: 'POST',
  body: {
    nodeInfoList: [
      { nodeId: '149', fieldName: 'text', fieldValue: 'pos', description: '提示词' },
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

async function create() {
  const res = await fetch(`${FC}/tasks/create`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-nexflow-token': FC_TOKEN,
      authorization: `Bearer ${auth}`,
    },
    body: JSON.stringify({
      model_id: 'minimax-h3-t2v-720p-6s',
      type: 'video',
      execution_mode: 'queue',
      skip_queue_pipeline: true,
      provider_forward_json: fwd,
      params: {},
    }),
  });
  return res.json();
}

const a = await create();
const b = await create();
console.log('[pos] created', a.task_id, b.task_id, a.status, b.status);

clearQueuePositionSnapshotCache();
const rowA = await db.getTaskRowForUser(a.task_id, userId);
const rowB = await db.getTaskRowForUser(b.task_id, userId);
const uxA = await enrichTaskStatusForUserUx(db, rowA);
const uxB = await enrichTaskStatusForUserUx(db, rowB);
console.log('[pos] OTS enrich A', { status: rowA?.status, ...uxA });
console.log('[pos] OTS enrich B', { status: rowB?.status, ...uxB });

const st = await fetch(`${FC}/tasks/status`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-nexflow-token': FC_TOKEN,
    authorization: `Bearer ${auth}`,
  },
  body: JSON.stringify({ task_id: a.task_id }),
});
const sj = await st.json();
console.log('[pos] FC /tasks/status sample', {
  status: sj.status,
  ahead_count: sj.ahead_count,
  queue_position: sj.queue_position,
  queue_position_available: sj.queue_position_available,
  has_ahead_key: Object.prototype.hasOwnProperty.call(sj, 'ahead_count'),
  has_pos_key: Object.prototype.hasOwnProperty.call(sj, 'queue_position'),
});

for (const tid of [a.task_id, b.task_id]) {
  try {
    await db.upsertTask(tid, userId, {
      status: 'failed',
      error_code: 'UX_SMOKE_CLEANUP',
      error_msg: 'cleanup',
    });
  } catch (_) {}
}

const otsOk =
  rowA?.status === 'queued' &&
  uxA.queue_position_available === true &&
  Number.isFinite(Number(uxA.ahead_count)) &&
  uxB.queue_position_available === true &&
  Number(uxB.ahead_count) >= Number(uxA.ahead_count);
const fcDeployed = Object.prototype.hasOwnProperty.call(sj, 'ahead_count');

console.log('[pos] RESULT', { otsOk, fcDeployed, ok: otsOk && fcDeployed });
process.exit(otsOk && fcDeployed ? 0 : 1);
