/**
 * Phase 8.1：Poll 必须按任务 rhRegion 选站（ai → .ai，cn → .cn；禁止全局改 .ai）
 * node scripts/test-poll-rh-region.mjs
 */
import crypto from 'crypto';
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvFile(path.join(REPO, '.env'));
loadEnvFile(path.join(ROOT, '.env'));

process.env.NX_SKIP_QUEUE_PIPELINE_ON_CREATE = '1';

const db = await import('../lib/db-tablestore.mjs');
const { pollOneProviderTask } = await import('../lib/providerPipeline.mjs');

const PREFIX = `__p81reg_${Date.now().toString(36)}_`;
const results = [];

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(pass ? `[PASS] ${name}` : `[FAIL] ${name}`, detail || '');
}

async function makeTask(userId, rhRegion) {
  const tid = crypto.randomUUID();
  const forward = {
    provider: 'runninghub',
    path: '/rhart-video-g/text-to-video',
    method: 'POST',
    body: { prompt: 'region test', aspectRatio: '16:9', resolution: '720p', duration: 10 },
    billingModelId: 'rhart-video-x-720p-10s',
    rhRegion,
  };
  await db.upsertTask(tid, userId, {
    status: 'running',
    type: 'video',
    execution_mode: 'queue',
    execution_stage: 'provider_submitted',
    provider_task_id: `rh_mock_${rhRegion}_${tid.slice(0, 8)}`,
    provider_forward_json: JSON.stringify(forward),
    quoted_cost: 4,
    user_slot_held: '0',
    platform_slot_held: '0',
  });
  return tid;
}

async function main() {
  const uid = `${PREFIX}u`;
  try {
    await db.createUserOtpOnly({ userId: uid, email: `${uid}@t.t` });
  } catch (_) {}

  // A: rhRegion=ai → query opts.rhRegion === 'ai'
  {
    const tid = await makeTask(uid, 'ai');
    let seen = null;
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async (_pid, opts) => {
        seen = opts?.rhRegion ?? null;
        return { ok: true, status: 'RUNNING' };
      },
    });
    record('A_poll_rhRegion_ai', seen === 'ai', { seen });
  }

  // B: rhRegion=cn → query opts.rhRegion === 'cn'
  {
    const tid = await makeTask(uid, 'cn');
    let seen = null;
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async (_pid, opts) => {
        seen = opts?.rhRegion ?? null;
        return { ok: true, status: 'RUNNING' };
      },
    });
    record('B_poll_rhRegion_cn', seen === 'cn', { seen });
  }

  // C: 无 rhRegion → 不强制 ai（undefined / 空）
  {
    const tid = crypto.randomUUID();
    await db.upsertTask(tid, uid, {
      status: 'running',
      type: 'video',
      execution_mode: 'queue',
      execution_stage: 'provider_submitted',
      provider_task_id: `rh_mock_none_${tid.slice(0, 8)}`,
      provider_forward_json: JSON.stringify({
        provider: 'runninghub',
        path: '/some-cn-path/text-to-video',
        method: 'POST',
        body: {},
      }),
      quoted_cost: 1,
      user_slot_held: '0',
      platform_slot_held: '0',
    });
    let seen = 'UNSET';
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async (_pid, opts) => {
        seen = opts?.rhRegion;
        return { ok: true, status: 'RUNNING' };
      },
    });
    record('C_poll_no_rhRegion_not_forced_ai', seen !== 'ai', { seen });
  }

  const passed = results.every((r) => r.pass);
  console.log(JSON.stringify({ passed, results }, null, 2));
  if (!passed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
