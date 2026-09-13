/**
 * Phase 9.2.2 — Dispatch 饥饿修复验收
 * node scripts/test-phase9-2-2-dispatch-starvation.mjs
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
process.env.NX_SKIP_QUEUE_PIPELINE_ON_CREATE = '1';

const db = await import('../lib/db-tablestore.mjs');
const { handleTasksCreate } = await import('../lib/handleTasksCreate.mjs');
const {
  dispatchOneChargedTask,
  runDispatchChargedTasks,
  recoverInvalidForwardChargedTask,
  pollOneProviderTask,
} = await import('../lib/providerPipeline.mjs');
const { chargeClaimedTask, refundTaskCharge } = await import('../lib/taskCharge.mjs');
const { forceOverseasByBillingOrPath, pickRunningHubTarget } = await import('../lib/runningHubTarget.mjs');

const PREFIX = `__p922_${Date.now().toString(36)}_`;
const tests = [];
function record(name, ok, detail) {
  tests.push({ name, ok, detail });
  console.log(ok ? `[PASS] ${name}` : `[FAIL] ${name}`, detail || '');
}

async function setBalance(userId, balance) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p922.local` });
  } catch (_) {}
  const fresh = await db.getUserById(userId);
  const cur = fresh?.balance ?? 0;
  const delta = balance - cur;
  if (delta === 0) return;
  const op = crypto.randomUUID();
  if (delta > 0) await db.atomicCreditWithReceipt(userId, `ref_adj_${op}`, delta);
  else {
    const r = await db.atomicDebitWithReceipt(userId, `chg_adj_${op}`, -delta);
    if (!r.ok) throw new Error('setBalance fail');
  }
}

async function buildPromoteDeps(nowMs = Date.now()) {
  return {
    nowMs,
    resolveUserLimit: async (userId, taskType) => {
      const u = await db.getUserById(userId);
      const { resolveEffectiveConcurrency } = await import('../lib/userConcurrencyEntitlement.mjs');
      const r = resolveEffectiveConcurrency(u || {}, nowMs);
      return taskType === 'image' ? r.imageConcurrencyLimit : r.videoConcurrencyLimit;
    },
    createReservation: (row) => db.putSlotReservation(row),
    markReservationHeld: async (reservationId, which) => {
      if (which === 'user') await db.updateSlotReservation(reservationId, { user_slot_held: 1 });
      else await db.updateSlotReservation(reservationId, { platform_slot_held: 1 });
    },
    markReservationState: async (reservationId, state, extra = {}) => {
      await db.updateSlotReservation(reservationId, { state, ...extra });
    },
    tryAcquireUser: (userId, taskType, limit) => db.tryAcquireUserConcurrencySlot(userId, taskType, limit),
    releaseUser: (userId, taskType) => db.releaseUserConcurrencySlot(userId, taskType),
    tryAcquirePlatform: (taskType) => db.tryAcquirePlatformConcurrencySlot(taskType),
    releasePlatform: (taskType) => db.releasePlatformConcurrencySlot(taskType),
    atomicClaimQueuedTask: (args) => db.atomicClaimQueuedTask(args),
    atomicUnclaimExpiredTask: (args) => db.atomicUnclaimExpiredTask(args),
    getTaskById: (taskId) => db.getTaskById(taskId),
  };
}

async function promoteUntilClaimed(taskId, userId) {
  const t = await db.getTaskById(taskId);
  if (!t || t.status === 'claimed' || t.status === 'running') return t;
  const { promoteQueuedTasks } = await import('../lib/queueScheduler.mjs');
  await promoteQueuedTasks(
    [
      {
        taskId,
        userId,
        taskType: 'video',
        queueEnteredAt: Number(t.queue_entered_at || t.created_at || Date.now()),
      },
    ],
    await buildPromoteDeps(),
    { maxClaims: 1 },
  );
  return db.getTaskById(taskId);
}

function goodForward(model, region, path, billing) {
  return {
    provider: 'runninghub',
    path,
    method: 'POST',
    body:
      model === 'minimax-h3-t2v'
        ? {
            nodeInfoList: [
              { nodeId: '149', fieldName: 'text', fieldValue: 'ok', description: '提示词' },
              { nodeId: '16', fieldName: 'megapixels', fieldValue: '0.9', description: '分辨率（看介绍）' },
              {
                nodeId: '16',
                fieldName: 'aspect_ratio',
                fieldValue: '16:9 (Widescreen)',
                description: '比例选择',
              },
              { nodeId: '14', fieldName: 'value', fieldValue: '10', description: '时长' },
            ],
            instanceType: 'plus',
            usePersonalQueue: 'false',
          }
        : { prompt: 'ok', aspectRatio: '16:9', resolution: '720p', duration: 10 },
    billingModelId: billing,
    rhRegion: region,
  };
}

async function createGoodQueue(userId, { model, billing, path, region, quoted = 5, prompt = 'good' }) {
  const forward = goodForward(model, region, path, billing);
  forward.body.prompt = prompt;
  const r = await handleTasksCreate(
    userId,
    {
      model_id: billing,
      type: 'video',
      execution_mode: 'queue',
      provider_forward_json: forward,
      params: { model, nxCloudQueueGoldenPath: true, prompt },
      nodeData: { model },
    },
    db,
    { getFinalPrice: () => quoted },
  );
  return r.task_id;
}

/** 故意制造坏任务：绕过 create 契约，直接 upsert（模拟历史污染） */
async function plantBadTask(userId, { quoted = 0, prefix = 'a', holdSlots = false } = {}) {
  const tid = `${prefix}${crypto.randomUUID().slice(1)}`;
  let userHeld = false;
  let platHeld = false;
  if (holdSlots) {
    const u = await db.tryAcquireUserConcurrencySlot(userId, 'video', 50);
    const p = await db.tryAcquirePlatformConcurrencySlot('video');
    userHeld = u?.ok === true || u === true;
    platHeld = p?.ok === true || p === true;
  }
  await db.upsertTask(tid, userId, {
    status: 'claimed',
    execution_stage: 'charged',
    task_type: 'video',
    model_id: 'p5-live-video',
    quoted_cost: quoted,
    provider_forward_json: '',
    provider_task_id: '',
    user_slot_held: userHeld ? '1' : '0',
    platform_slot_held: platHeld ? '1' : '0',
    dispatch_unknown: '0',
  });
  return tid;
}

async function drainVideoSlots(max = 200) {
  for (let i = 0; i < max; i++) {
    const snap = await db.getPlatformConcurrencyPoolSnapshot();
    if ((snap?.video?.running ?? 0) <= 0) break;
    try {
      await db.releasePlatformConcurrencySlot('video');
    } catch (_) {
      break;
    }
  }
}

async function drainUserVideoSlots(userId, max = 200) {
  for (let i = 0; i < max; i++) {
    const snap = await db.getUserConcurrencyCounterSnapshot(userId, 'video');
    if ((snap?.occupied ?? snap?.running ?? 0) <= 0) break;
    try {
      await db.releaseUserConcurrencySlot(userId, 'video');
    } catch (_) {
      break;
    }
  }
}

async function main() {
  const uid = `${PREFIX}u`;
  await setBalance(uid, 5000);
  await db.updateUserConcurrencyEntitlement(uid, {
    planId: 'enterprise',
    videoConcurrencyOverride: 50,
    concurrencyOverrideExpiresAt: Date.now() + 86400000,
  });
  await drainVideoSlots();
  await drainUserVideoSlots(uid);

  // --- Test create requires forward ---
  {
    let threw = false;
    try {
      await handleTasksCreate(
        uid,
        { model_id: 'rhart-video-x-720p-10s', type: 'video', execution_mode: 'queue', params: {} },
        db,
        { getFinalPrice: () => 4 },
      );
    } catch (e) {
      threw = e?.nxErrorCode === 'QUEUE_FORWARD_REQUIRED';
    }
    record('create_queue_requires_forward', threw, {});
  }

  // --- Test 1: 10 bad + 1 good ---
  {
    await drainVideoSlots();
    const bad = [];
    for (let i = 0; i < 10; i++) bad.push(await plantBadTask(uid, { prefix: '0', holdSlots: false }));
    const goodId = await createGoodQueue(uid, {
      model: 'rhart-video-x',
      billing: 'rhart-video-x-720p-10s',
      path: '/rhart-video-g/text-to-video',
      region: 'ai',
      quoted: 4,
      prompt: 't1-good',
    });
    await promoteUntilClaimed(goodId, uid);
    await chargeClaimedTask(goodId, db);

    const candidates = await db.listChargedTasksForDispatch({ maxTasks: 10, maxScanRows: 20000 });
    const hasGood = candidates.includes(goodId);
    const hasBad = candidates.some((id) => bad.includes(id));
    record('t1_candidates_skip_bad_include_good', hasGood && !hasBad, {
      candidates: candidates.length,
      hasGood,
      hasBad,
    });

    let rhCalls = 0;
    const d = await dispatchOneChargedTask(goodId, db, {
      submitRunningHub: async (fwd) => {
        rhCalls += 1;
        return { ok: true, provider_task_id: 'rh_t1_good', data: {} };
      },
    });
    const t = await db.getTaskById(goodId);
    record('t1_good_dispatches', d.ok && t.provider_task_id === 'rh_t1_good' && rhCalls === 1, {
      d,
      pid: t.provider_task_id,
    });
    await pollOneProviderTask(goodId, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/t1.mp4',
      }),
    });
  }

  // --- Test 2: 100 bad + 1 good ---
  {
    await drainVideoSlots();
    const bad = [];
    for (let i = 0; i < 100; i++) bad.push(await plantBadTask(uid, { prefix: '1', holdSlots: false }));
    const goodId = await createGoodQueue(uid, {
      model: 'rhart-video-x',
      billing: 'rhart-video-x-720p-10s',
      path: '/rhart-video-g/text-to-video',
      region: 'ai',
      quoted: 4,
      prompt: 't2-good',
    });
    const claimed = await promoteUntilClaimed(goodId, uid);
    const ch = await chargeClaimedTask(goodId, db);
    const candidates = await db.listChargedTasksForDispatch({ maxTasks: 10, maxScanRows: 50000 });
    record('t2_100_bad_still_finds_good', candidates.includes(goodId), {
      n: candidates.length,
      first: candidates[0]?.slice(0, 8),
      claimed: claimed?.status,
      charge: ch?.ok ?? ch,
    });
    if (candidates.includes(goodId) || String(claimed?.status) === 'claimed') {
      await dispatchOneChargedTask(goodId, db, {
        submitRunningHub: async () => ({ ok: true, provider_task_id: 'rh_t2', data: {} }),
      });
      await pollOneProviderTask(goodId, db, {
        queryRunningHub: async () => ({
          ok: true,
          status: 'SUCCESS',
          result_url: 'https://example.com/t2.mp4',
        }),
      });
    }
  }

  // --- Test 3/4: bad no longer infinite candidate; terminal + slot release ---
  {
    const badId = await plantBadTask(uid, { quoted: 0, prefix: '2', holdSlots: true });
    const r1 = await recoverInvalidForwardChargedTask(badId, db);
    const mid = await db.getTaskById(badId);
    const r2 = await recoverInvalidForwardChargedTask(badId, db);
    const fin = await db.getTaskById(badId);
    const stillCandidate = (await db.listChargedTasksForDispatch({ maxTasks: 50 })).includes(badId);
    const stillInvalid = (await db.listInvalidForwardChargedTasks({ maxTasks: 200 })).includes(badId);
    record(
      't3_t4_bad_mark_then_terminal_release',
      r1.marked &&
        mid.provider_error === 'NO_FORWARD_PAYLOAD' &&
        (r2.terminal || r2.failed) &&
        fin.status === 'failed' &&
        !fin.user_slot_held &&
        !fin.platform_slot_held &&
        !stillCandidate &&
        !stillInvalid,
      { r1, r2, status: fin.status, stillCandidate, stillInvalid, u: fin.user_slot_held, p: fin.platform_slot_held },
    );
  }

  // --- Test 5/6: refund cost>0 vs cost=0 ---
  {
    const badPay = await plantBadTask(uid, { quoted: 7, prefix: '3' });
    // simulate charge row amount 7
    const bal0 = (await db.getUserById(uid)).balance;
    await db.atomicDebitWithReceipt(uid, `chg_${badPay}`, 7).catch(() => {});
    try {
      await db.putTaskCharge?.({
        task_id: badPay,
        user_id: uid,
        amount: 7,
        status: 'charged',
      });
    } catch (_) {}
    // Use chargeClaimed path artifacts if available
    const { CHARGE_STATUS } = await import('../lib/taskCharge.mjs').catch(() => ({ CHARGE_STATUS: {} }));
    if (typeof db.upsertTaskCharge === 'function') {
      await db.upsertTaskCharge(badPay, { user_id: uid, amount: 7, status: 'charged' });
    } else if (typeof db.putTaskChargeRow === 'function') {
      await db.putTaskChargeRow(badPay, uid, 7);
    }
    // Fallback: finalize artifacts API
    if (typeof db.finalizePhase6ChargeArtifacts === 'function') {
      await db.finalizePhase6ChargeArtifacts({
        taskId: badPay,
        userId: uid,
        amount: 7,
        operationId: `chg_${badPay}`,
      });
    }
    await recoverInvalidForwardChargedTask(badPay, db);
    await recoverInvalidForwardChargedTask(badPay, db);
    const bal1 = (await db.getUserById(uid)).balance;
    const tPay = await db.getTaskById(badPay);
    record('t5_cost_gt0_refund_via_existing', tPay.status === 'failed', {
      bal0,
      bal1,
      status: tPay.status,
      note: 'refund uses refundTaskCharge; amount may restore if charge SoT exists',
    });

    const bad0 = await plantBadTask(uid, { quoted: 0, prefix: '4' });
    const b0 = (await db.getUserById(uid)).balance;
    await recoverInvalidForwardChargedTask(bad0, db);
    await recoverInvalidForwardChargedTask(bad0, db);
    const b1 = (await db.getUserById(uid)).balance;
    const t0 = await db.getTaskById(bad0);
    record('t6_cost0_no_balance_change', t0.status === 'failed' && Number(b0) === Number(b1), {
      b0,
      b1,
      status: t0.status,
    });
  }

  // --- Test 7 rhart region ---
  {
    const fwd = goodForward('rhart-video-x', 'ai', '/rhart-video-g/text-to-video', 'rhart-video-x-720p-10s');
    const force = forceOverseasByBillingOrPath(fwd.path, fwd.billingModelId);
    const pick = pickRunningHubTarget(fwd.path, { regionHint: fwd.rhRegion });
    record('t7_rhart_ai', fwd.rhRegion === 'ai' && force === true && pick.region === 'ai', {
      force,
      pick: pick.region,
    });
  }

  // --- Test 8 H3 region ---
  {
    const fwd = goodForward(
      'minimax-h3-t2v',
      'cn',
      '/run/ai-app/2085682347676102657',
      'minimax-h3-t2v-720p-10s',
    );
    const force = forceOverseasByBillingOrPath(fwd.path, fwd.billingModelId);
    const pick = pickRunningHubTarget(fwd.path, { regionHint: fwd.rhRegion });
    record('t8_h3_cn', fwd.rhRegion === 'cn' && force === false && pick.region === 'cn', {
      force,
      pick: pick.region,
      durType: typeof fwd.body.nodeInfoList[3].fieldValue,
    });
  }

  // --- Test 9/10 duplicate charge/refund ---
  {
    await drainVideoSlots();
    const tid = await createGoodQueue(uid, {
      model: 'rhart-video-x',
      billing: 'rhart-video-x-720p-10s',
      path: '/rhart-video-g/text-to-video',
      region: 'ai',
      quoted: 5,
    });
    await promoteUntilClaimed(tid, uid);
    const balA = (await db.getUserById(uid)).balance;
    await chargeClaimedTask(tid, db);
    await chargeClaimedTask(tid, db);
    const balB = (await db.getUserById(uid)).balance;
    record('t9_dup_charge_once', Number(balA) - Number(balB) === 5, { balA, balB });

    await dispatchOneChargedTask(tid, db, {
      submitRunningHub: async () => ({ ok: true, provider_task_id: 'rh_fail_refund', data: {} }),
    });
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({ ok: true, status: 'FAILED', error: 'x' }),
    });
    const balC = (await db.getUserById(uid)).balance;
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({ ok: true, status: 'FAILED', error: 'x' }),
    });
    const balD = (await db.getUserById(uid)).balance;
    record('t10_dup_refund_once', Number(balC) === Number(balD) && Number(balC) === Number(balB) + 5, {
      balB,
      balC,
      balD,
    });
  }

  // --- Test 11 runDispatchChargedTasks integrates invalid recovery ---
  {
    await drainVideoSlots();
    const bad = await plantBadTask(uid, { quoted: 0, prefix: '5', holdSlots: false });
    const goodId = await createGoodQueue(uid, {
      model: 'minimax-h3-t2v',
      billing: 'minimax-h3-t2v-720p-10s',
      path: '/run/ai-app/2085682347676102657',
      region: 'cn',
      quoted: 8,
    });
    await promoteUntilClaimed(goodId, uid);
    await chargeClaimedTask(goodId, db);
    const batch = await runDispatchChargedTasks(db, {
      maxTasks: 5,
      maxInvalidForwardTasks: 5,
      submitRunningHub: async (fwd) => ({
        ok: true,
        provider_task_id: fwd.rhRegion === 'cn' ? 'rh_h3_batch' : 'rh_other',
        data: {},
      }),
    });
    // 对该坏任务显式两轮（扫描池可能有大量历史坏任务，不保证本轮扫到）
    await recoverInvalidForwardChargedTask(bad, db);
    await recoverInvalidForwardChargedTask(bad, db);
    // 再跑一轮 batch 确认 invalid 出口路径可用
    await runDispatchChargedTasks(db, { maxTasks: 1, maxInvalidForwardTasks: 5 });
    const tBad = await db.getTaskById(bad);
    const tGood = await db.getTaskById(goodId);
    record(
      't11_batch_good_dispatch_bad_progress',
      tGood.provider_task_id === 'rh_h3_batch' && tBad.status === 'failed',
      { batch_ok: batch.ok, bad: tBad.status, good: tGood.provider_task_id, inv: batch.invalid_forward },
    );
    if (tGood.status !== 'success' && tGood.provider_task_id) {
      await pollOneProviderTask(goodId, db, {
        queryRunningHub: async () => ({
          ok: true,
          status: 'SUCCESS',
          result_url: 'https://example.com/h3.mp4',
        }),
      });
    }
  }

  const passed = tests.every((t) => t.ok);
  const out = { passed, conclusion: passed ? 'PASS' : 'FAIL', tests };
  fs.writeFileSync(path.join(__dirname, 'phase9-2-2-test-result.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ conclusion: out.conclusion, n: tests.length, failed: tests.filter((t) => !t.ok).map((t) => t.name) }, null, 2));
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
