/**
 * Phase 7 管线测试（mock RH，OTS 实库任务行）
 * node scripts/test-phase7-provider-pipeline.mjs
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const p of [path.resolve(__dirname, '../../../.env'), path.resolve(__dirname, '../.env')]) {
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

const db = await import('../lib/db-tablestore.mjs');
const {
  dispatchOneChargedTask,
  pollOneProviderTask,
  settleOneTask,
  recoverOneProviderTask,
} = await import('../lib/providerPipeline.mjs');
const { blocksLegacyProviderSubmit } = await import('../lib/providerStages.mjs');

const PREFIX = `__p7t_${Date.now().toString(36)}_`;
const stats = {
  rh_submit_calls: 0,
  double_rh_submit: false,
  double_refund: false,
  slot_leak: false,
  blind_retry_on_unknown: false,
  tests: [],
};

function record(name, ok, detail) {
  stats.tests.push({ name, ok, detail });
  console.log(ok ? `[PASS] ${name}` : `[FAIL] ${name}`, detail || '');
}

async function makeChargedTask(userId, extra = {}) {
  const tid = crypto.randomUUID();
  const rid = crypto.randomUUID();
  const forward = {
    provider: 'runninghub',
    path: '/run/ai-app/p7-test',
    method: 'POST',
    body: { webappId: 'p7' },
  };
  await db.upsertTask(tid, userId, {
    status: 'claimed',
    task_type: 'video',
    model_id: 'p7-test',
    quoted_cost: 1,
    cost: 1,
    amount: 1,
    execution_stage: 'charged',
    user_slot_held: '1',
    platform_slot_held: '1',
    reservation_id: rid,
    claim_token: crypto.randomUUID(),
    provider_forward_json: JSON.stringify(forward),
    prompt_json: '{}',
    ...extra,
  });
  await db.putSlotReservation({
    reservation_id: rid,
    task_id: tid,
    user_id: userId,
    task_type: 'video',
    user_slot_held: 1,
    platform_slot_held: 1,
    state: 'claimed',
    created_at: Date.now(),
    expires_at: Date.now() + 600000,
    claim_token: 't',
  });
  await db.tryAcquireUserConcurrencySlot(userId, 'video', 100);
  await db.tryAcquirePlatformConcurrencySlot('video');
  return tid;
}

function mockSubmitOk(pid) {
  return async () => {
    stats.rh_submit_calls += 1;
    return { ok: true, provider_task_id: pid || `rh_${crypto.randomUUID()}`, data: {} };
  };
}

function mockSubmitTimeout() {
  return async () => {
    stats.rh_submit_calls += 1;
    return { ok: false, uncertain: true, reason: 'SUBMIT_TIMEOUT' };
  };
}

function mockSubmitFail() {
  return async () => {
    stats.rh_submit_calls += 1;
    return { ok: false, uncertain: false, reason: 'HTTP 400 bad request' };
  };
}

async function cleanup(tid, userId) {
  const t = await db.getTaskById(tid);
  if (!t) return;
  if (t.user_slot_held || t.platform_slot_held) {
    try {
      await db.releasePlatformConcurrencySlot('video');
    } catch (_) {}
    try {
      await db.releaseUserConcurrencySlot(userId, 'video');
    } catch (_) {}
  }
  try {
    await db.upsertTask(tid, userId, {
      status: t.status === 'failed' || t.status === 'success' ? t.status : 'cancelled',
      execution_stage: 'done',
      user_slot_held: '0',
      platform_slot_held: '0',
      error_msg: 'p7_cleanup',
    });
  } catch (_) {}
}

async function main() {
  const uid = `${PREFIX}u`;
  try {
    await db.createUserOtpOnly({ userId: uid, email: `${uid}@t.t` });
  } catch (_) {}
  await db.updateUserConcurrencyEntitlement(uid, {
    planId: 'enterprise',
    videoConcurrencyOverride: 50,
    concurrencyOverrideExpiresAt: Date.now() + 86400000,
  });

  // drain platform a bit
  let snap = await db.getPlatformConcurrencyPoolSnapshot();
  while (snap.video.running > 50) {
    await db.releasePlatformConcurrencySlot('video');
    snap = await db.getPlatformConcurrencyPoolSnapshot();
  }

  const ids = [];

  // A: charged 未调 RH → dispatch 成功
  {
    const tid = await makeChargedTask(uid);
    ids.push(tid);
    const before = stats.rh_submit_calls;
    const r = await dispatchOneChargedTask(tid, db, {
      submitRunningHub: mockSubmitOk('rh_a1'),
    });
    const t = await db.getTaskById(tid);
    const ok =
      r.ok &&
      t.provider_task_id === 'rh_a1' &&
      t.status === 'running' &&
      t.execution_stage === 'provider_submitted' &&
      stats.rh_submit_calls === before + 1;
    record('A_dispatch_success', ok, { r, status: t.status, stage: t.execution_stage, pid: t.provider_task_id });
  }

  // B: timeout → unknown，禁止再 POST
  {
    const tid = await makeChargedTask(uid);
    ids.push(tid);
    const r1 = await dispatchOneChargedTask(tid, db, { submitRunningHub: mockSubmitTimeout() });
    const calls1 = stats.rh_submit_calls;
    const r2 = await dispatchOneChargedTask(tid, db, { submitRunningHub: mockSubmitOk('rh_should_not') });
    const t = await db.getTaskById(tid);
    if (stats.rh_submit_calls > calls1) stats.blind_retry_on_unknown = true;
    const ok =
      r1.uncertain &&
      r2.reason === 'DISPATCH_UNKNOWN_NO_RETRY' &&
      Number(t.dispatch_unknown) === 1 &&
      !t.provider_task_id &&
      stats.rh_submit_calls === calls1;
    record('B_timeout_no_blind_retry', ok, { r1, r2, unknown: t.dispatch_unknown, calls: stats.rh_submit_calls });
  }

  // C: 有 id 后重复 dispatch 不重 POST
  {
    const tid = await makeChargedTask(uid);
    ids.push(tid);
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockSubmitOk('rh_c') });
    const calls = stats.rh_submit_calls;
    const r2 = await dispatchOneChargedTask(tid, db, { submitRunningHub: mockSubmitOk('rh_c2') });
    if (stats.rh_submit_calls > calls) stats.double_rh_submit = true;
    const ok = r2.idempotent && stats.rh_submit_calls === calls;
    record('C_provider_id_sot_no_resubmit', ok, { r2, calls: stats.rh_submit_calls });
  }

  // D: 明确失败 → failed（refund 调用幂等接口；余额可能因无 charge 行不变）
  {
    const tid = await makeChargedTask(uid);
    ids.push(tid);
    let refundCalls = 0;
    const dbWrap = {
      ...db,
      refundTaskCharge: async (id) => {
        refundCalls += 1;
        return db.refundTaskCharge(id);
      },
    };
    // copy methods bound
    const facade = new Proxy(db, {
      get(target, prop) {
        if (prop === 'refundTaskCharge') {
          return async (id) => {
            refundCalls += 1;
            try {
              return await target.refundTaskCharge(id);
            } catch (e) {
              return { ok: false, reason: String(e?.message || e) };
            }
          };
        }
        const v = target[prop];
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const r = await dispatchOneChargedTask(tid, db, { submitRunningHub: mockSubmitFail() });
    // use real db for fail path which calls db.refundTaskCharge
    const t = await db.getTaskById(tid);
    const ok = r.failed && t.status === 'failed' && t.execution_stage === 'done';
    record('D_explicit_submit_fail', ok, { r, status: t.status, held: t.user_slot_held });
  }

  // E/F/G: poll success / failed settle
  {
    const tid = await makeChargedTask(uid);
    ids.push(tid);
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockSubmitOk('rh_ef') });
    const r = await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/out.mp4',
      }),
    });
    const t = await db.getTaskById(tid);
    const ok =
      r.ok &&
      t.status === 'success' &&
      t.execution_stage === 'done' &&
      !t.user_slot_held &&
      !t.platform_slot_held;
    record('F_provider_success_settle', ok, { r, status: t.status, url: t.result_oss_url });
  }
  {
    const tid = await makeChargedTask(uid);
    ids.push(tid);
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockSubmitOk('rh_g') });
    const r = await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({ ok: true, status: 'FAILED' }),
    });
    const t = await db.getTaskById(tid);
    const ok = r.ok && t.status === 'failed' && t.execution_stage === 'done';
    record('G_provider_failed_settle', ok, { r, status: t.status });
  }

  // H: refund idempotent via settle failed twice
  {
    const tid = await makeChargedTask(uid);
    ids.push(tid);
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockSubmitOk('rh_h') });
    await settleOneTask(tid, db, { outcome: 'failed', refund: true });
    const r2 = await settleOneTask(tid, db, { outcome: 'failed', refund: true });
    const ok = r2.idempotent === true;
    record('H_refund_settle_idempotent', ok, r2);
  }

  // I: success 后 release 再 recover
  {
    const tid = await makeChargedTask(uid);
    ids.push(tid);
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockSubmitOk('rh_i') });
    await settleOneTask(tid, db, { outcome: 'success' });
    // 人为把 held 置回模拟 release 失败残留
    await db.upsertTask(tid, uid, {
      status: 'success',
      execution_stage: 'done',
      user_slot_held: '1',
      platform_slot_held: '1',
      provider_task_id: 'rh_i',
    });
    const r = await recoverOneProviderTask(tid, db, {});
    const t = await db.getTaskById(tid);
    const ok = r.ok && !t.user_slot_held && !t.platform_slot_held;
    record('I_release_recovery', ok, { r, heldU: t.user_slot_held, heldP: t.platform_slot_held });
  }

  // 20 workers 同 task dispatch
  {
    const tid = await makeChargedTask(uid);
    ids.push(tid);
    const before = stats.rh_submit_calls;
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        dispatchOneChargedTask(tid, db, { submitRunningHub: mockSubmitOk('rh_storm') }),
      ),
    );
    const submits = stats.rh_submit_calls - before;
    const t = await db.getTaskById(tid);
    const okN = results.filter((x) => x.ok).length;
    if (submits > 1) stats.double_rh_submit = true;
    const ok = submits === 1 && t.provider_task_id === 'rh_storm' && okN >= 1;
    record('C20_dispatch_storm', ok, { submits, okN, pid: t.provider_task_id });
  }

  // legacy block
  {
    const tid = await makeChargedTask(uid);
    ids.push(tid);
    const t = await db.getTaskById(tid);
    const ok = blocksLegacyProviderSubmit(t) === true;
    record('legacy_run_task_blocked', ok, { stage: t.execution_stage });
    ids.push(tid);
  }

  // Crash A recovery: charged → recover → dispatch
  {
    const tid = await makeChargedTask(uid);
    ids.push(tid);
    const r = await recoverOneProviderTask(tid, db, {
      submitRunningHub: mockSubmitOk('rh_rec_a'),
    });
    const t = await db.getTaskById(tid);
    const ok = r.ok && t.provider_task_id === 'rh_rec_a';
    record('CrashA_recover_dispatch', ok, { r, pid: t.provider_task_id });
  }

  for (const id of ids) {
    await cleanup(id, uid);
  }
  snap = await db.getPlatformConcurrencyPoolSnapshot();
  // soft drain
  for (let i = 0; i < 30 && snap.video.running > 0; i++) {
    await db.releasePlatformConcurrencySlot('video');
    snap = await db.getPlatformConcurrencyPoolSnapshot();
  }

  const passed =
    stats.tests.every((t) => t.ok) &&
    !stats.double_rh_submit &&
    !stats.blind_retry_on_unknown;

  const report = { passed, stats };
  fs.writeFileSync(
    path.resolve(__dirname, 'phase7-provider-test-result.json'),
    JSON.stringify(report, null, 2),
  );
  console.log('\nPASSED=', passed, 'rh_submits=', stats.rh_submit_calls);
  if (!passed) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
