/**
 * 云端 Timer 自治验收：create(skip_pipeline) 后不调用任何 pipeline/status，只等 FC Timer。
 * Usage: node scripts/accept-queue-fc-timer.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';

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

const FC = (process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '').replace(/\/$/, '');
const ADM = process.env.ADMIN_SETTLE_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || '';
const TOKEN = (process.env.ALIYUN_FC_TOKEN || process.env.NEXFLOW_FC_TOKEN || '').trim();
const USER_ID = process.env.ACCEPT_USER_ID || 'nx_88948564-5e6f-4be3-be7f-7f53c150ad79';
const H3_APP = '2085682347676102657';
const SKU = 'minimax-h3-t2v-720p-6s';
const WAIT_MS = Math.min(20 * 60_000, Math.max(3 * 60_000, parseInt(process.env.ACCEPT_TIMER_WAIT_MS || '720000', 10) || 720000));

function held(v) {
  return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
}

if (!FC || !JWT_SECRET) {
  console.error('need HK FC URL + JWT_SECRET');
  process.exit(1);
}

const db = await import('../lib/db-tablestore.mjs');
const userRow = await db.getUserById(USER_ID);
const tv = Number(userRow?.token_version ?? 0) || 0;
const bal0 = userRow?.balance ?? null;

function accessToken() {
  return jwt.sign({ sub: USER_ID, typ: 'access', tv }, JWT_SECRET, { expiresIn: '30m' });
}

async function createSkipPipeline() {
  const forward = {
    provider: 'runninghub',
    path: `/run/ai-app/${H3_APP}`,
    method: 'POST',
    body: {
      nodeInfoList: [
        {
          nodeId: '149',
          fieldName: 'text',
          fieldValue: 'FC Timer cloud autonomy accept — soft daylight lake drone shot',
          description: '提示词',
        },
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
    billingModelId: SKU,
    rhRegion: 'cn',
  };
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${accessToken()}`,
  };
  if (TOKEN) headers['x-nexflow-token'] = TOKEN;
  const res = await fetch(`${FC}/tasks/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model_id: SKU,
      type: 'video',
      execution_mode: 'queue',
      skip_queue_pipeline: true,
      provider_forward_json: forward,
      params: {
        nodeId: 'accept-fc-timer',
        taskKind: 'video',
        model: 'minimax-h3-t2v',
        prompt: 'FC Timer cloud autonomy accept',
        nxCloudQueueGoldenPath: true,
      },
      nodeData: {
        model: 'minimax-h3-t2v',
        aspect_ratio: '16:9',
        durationMinimaxH3: '6',
        resolutionMinimaxH3: '720p',
        duration: '6',
      },
    }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { http: res.status, json };
}

console.log(
  JSON.stringify(
    {
      mode: 'fc-timer-only',
      note: 'Will NOT call /tasks/status or /internal/run-queue-pipeline from this script',
      wait_ms: WAIT_MS,
      local_pipeline_calls: 0,
    },
    null,
    2,
  ),
);

const created = await createSkipPipeline();
console.log('create', JSON.stringify({ http: created.http, task: created.json?.task_id, status: created.json?.status }));
if (created.http !== 200 || !created.json?.task_id) {
  console.error('CREATE_FAILED', created);
  process.exit(2);
}
const taskId = created.json.task_id;
const t0 = await db.getTaskById(taskId);
const snaps = [
  {
    at: Date.now(),
    status: t0?.status,
    stage: t0?.execution_stage,
    pid: t0?.provider_task_id,
    claimed_at: t0?.claimed_at,
    charged_at: t0?.charged_at,
    slots: { u: t0?.user_slot_held, p: t0?.platform_slot_held },
  },
];

let final = null;
const deadline = Date.now() + WAIT_MS;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 20_000));
  const t = await db.getTaskById(taskId);
  snaps.push({
    at: Date.now(),
    status: t?.status,
    stage: t?.execution_stage,
    pid: t?.provider_task_id,
    claimed_at: t?.claimed_at,
    charged_at: t?.charged_at,
    url: (t?.result_oss_url || '').slice(0, 80),
    slots: { u: t?.user_slot_held, p: t?.platform_slot_held },
  });
  console.log(
    'watch',
    JSON.stringify({
      status: t?.status,
      stage: t?.execution_stage,
      pid: t?.provider_task_id || '',
      slots: { u: t?.user_slot_held, p: t?.platform_slot_held },
    }),
  );
  const st = String(t?.status || '').toLowerCase();
  if (st === 'success' || st === 'failed' || st === 'cancelled') {
    final = t;
    break;
  }
}

const bal1 = (await db.getUserById(USER_ID))?.balance ?? null;
const plat = await db.getPlatformConcurrencyPoolSnapshot();
const report = {
  task_id: taskId,
  user_id: USER_ID,
  model_id: SKU,
  skip_queue_pipeline: true,
  called_tasks_status: false,
  called_run_queue_pipeline: false,
  relied_on_local_minute_loop: false,
  balance_before: bal0,
  balance_after: bal1,
  evidence: {
    queue_entered_at: final?.queue_entered_at ?? t0?.queue_entered_at,
    claimed_at: final?.claimed_at,
    charged_at: final?.charged_at,
    execution_stage: final?.execution_stage,
    provider_task_id: final?.provider_task_id,
    completed_at: final?.finished_at || final?.updated_at,
    status: final?.status,
    result_oss_url: (final?.result_oss_url || '').slice(0, 160),
    user_slot_held: final?.user_slot_held,
    platform_slot_held: final?.platform_slot_held,
    cost: final?.cost,
    quoted_cost: final?.quoted_cost,
  },
  platform: plat,
  snaps,
  pass:
    String(final?.status).toLowerCase() === 'success' &&
    Boolean(final?.provider_task_id) &&
    Boolean(final?.charged_at) &&
    !held(final?.user_slot_held) &&
    !held(final?.platform_slot_held),
};

fs.writeFileSync(path.join(__dirname, 'accept-queue-fc-timer-result.json'), JSON.stringify(report, null, 2));
console.log('FINAL', JSON.stringify({ pass: report.pass, evidence: report.evidence, bal0, bal1 }, null, 2));
process.exit(report.pass ? 0 : 3);
