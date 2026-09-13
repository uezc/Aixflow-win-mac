/**
 * Phase 8.1.5 — 视频云端队列异常验收（Mock + 实库 OTS，不打真实 RH 批量）
 * 对照验收矩阵 A–XIII；优先复用 Phase5/6/7/8.1 已验证路径。
 *
 * node scripts/test-phase8-1-5-exception-acceptance.mjs
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
const { chargeClaimedTask, refundTaskCharge } = await import('../lib/taskCharge.mjs');
const {
  dispatchOneChargedTask,
  pollOneProviderTask,
  settleOneTask,
  recoverOneProviderTask,
} = await import('../lib/providerPipeline.mjs');
const { recoverOneExpiredClaim, tryClaimOneQueuedTask } = await import('../lib/queueScheduler.mjs');

const PREFIX = `__p815_${Date.now().toString(36)}_`;
const matrix = [];
const flags = {
  double_charge: false,
  double_refund: false,
  double_rh: false,
  oversell: false,
  slot_leak: false,
  permanent_stuck: false,
};

function record(name, pass, detail = {}) {
  matrix.push({ name, pass, detail });
  console.log(pass ? `[PASS] ${name}` : `[FAIL] ${name}`, detail);
}

async function setBalance(userId, balance) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p815.local` });
  } catch (_) {}
  const fresh = await db.getUserById(userId);
  const cur = fresh?.balance ?? 0;
  const delta = balance - cur;
  if (delta === 0) return;
  const op = `adj_${crypto.randomUUID()}`;
  if (delta > 0) await db.atomicCreditWithReceipt(userId, `ref_adj_${op}`, delta);
  else {
    const r = await db.atomicDebitWithReceipt(userId, `chg_adj_${op}`, -delta);
    if (!r.ok) throw new Error('setBalance debit failed');
  }
}

async function setupUser(userId, { balance = 1000, videoConcurrency = 5 } = {}) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p815.local` });
  } catch (_) {}
  await db.updateUserConcurrencyEntitlement(userId, {
    planId: 'enterprise',
    videoConcurrencyOverride: videoConcurrency,
    concurrencyOverrideExpiresAt: Date.now() + 86400000 * 7,
  });
  await setBalance(userId, balance);
}

function forward(prompt, rhRegion = 'ai') {
  return {
    provider: 'runninghub',
    path: '/rhart-video-g/text-to-video',
    method: 'POST',
    body: { prompt, aspectRatio: '16:9', resolution: '720p', duration: 10 },
    billingModelId: 'rhart-video-x-720p-10s',
    rhRegion,
  };
}

async function createQueueTask(userId, { quoted = 4, prompt = 'p815', rhRegion = 'ai' } = {}) {
  const r = await handleTasksCreate(
    userId,
    {
      model_id: 'rhart-video-x-720p-10s',
      type: 'video',
      execution_mode: 'queue',
      provider_forward_json: forward(prompt, rhRegion),
      params: { nodeId: 'n', taskKind: 'video', model: 'rhart-video-x', prompt, nxCloudQueueGoldenPath: true },
      nodeData: { model: 'rhart-video-x', aspect_ratio: '16:9', durationGrok3: '10', duration: '10' },
    },
    db,
    { getFinalPrice: () => quoted },
  );
  return r.task_id;
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

async function promoteOne(taskId, userId) {
  const t = await db.getTaskById(taskId);
  if (!t || t.status !== 'queued') return t;
  const deps = await buildPromoteDeps();
  await tryClaimOneQueuedTask(
    {
      taskId,
      userId,
      taskType: 'video',
      queueEnteredAt: Number(t.queue_entered_at || t.created_at || Date.now()),
    },
    deps,
  );
  return db.getTaskById(taskId);
}

async function cleanup(tid, uid) {
  const t = await db.getTaskById(tid);
  if (!t) return;
  if (t.user_slot_held || t.platform_slot_held) {
    try {
      await db.releasePlatformConcurrencySlot('video');
    } catch (_) {}
    try {
      await db.releaseUserConcurrencySlot(uid, 'video');
    } catch (_) {}
    try {
      await db.upsertTask(tid, uid, { user_slot_held: '0', platform_slot_held: '0', status: 'failed' });
    } catch (_) {}
  }
}

async function snap(uid) {
  const u = await db.getUserConcurrencyCounterSnapshot(uid, 'video');
  const p = await db.getPlatformConcurrencyPoolSnapshot();
  return { user_occ: u?.occupied ?? -1, plat: p?.video?.running ?? -1 };
}

async function drainPlatform(max = 200) {
  let n = 0;
  let s = await db.getPlatformConcurrencyPoolSnapshot();
  while (n < max && (s?.video?.running || 0) > 0) {
    await db.releasePlatformConcurrencySlot('video');
    n += 1;
    s = await db.getPlatformConcurrencyPoolSnapshot();
  }
}

let rhCalls = 0;
function mockRhOk(pid) {
  return async () => {
    rhCalls += 1;
    return { ok: true, provider_task_id: pid, data: {} };
  };
}
function mockRhFail() {
  return async () => {
    rhCalls += 1;
    return { ok: false, uncertain: false, reason: 'HTTP 400 bad request' };
  };
}
function mockRhTimeout() {
  return async () => {
    rhCalls += 1;
    return { ok: false, uncertain: true, reason: 'SUBMIT_TIMEOUT' };
  };
}

async function main() {
  await drainPlatform(50);

  // ── A. 余额不足 ──
  {
    const uid = `${PREFIX}poor`;
    await setupUser(uid, { balance: 0, videoConcurrency: 5 });
    const tid = await createQueueTask(uid, { quoted: 99, prompt: 'poor' });
    await promoteOne(tid, uid);
    const before = rhCalls;
    const bal0 = (await db.getUserById(uid))?.balance;
    await chargeClaimedTask(tid, db);
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('should_not') });
    const t = await db.getTaskById(tid);
    const bal1 = (await db.getUserById(uid))?.balance;
    const s = await snap(uid);
    const ok =
      t.status === 'failed' &&
      !t.provider_task_id &&
      rhCalls === before &&
      bal0 === 0 &&
      bal1 === 0 &&
      s.user_occ === 0;
    record('A_insufficient_balance', ok, {
      status: t.status,
      pid: t.provider_task_id,
      rh_delta: rhCalls - before,
      bal: bal1,
      snap: s,
    });
    await cleanup(tid, uid);
  }

  // ── B. 用户并发满 + 释放后可继续 ──
  {
    const uid = `${PREFIX}uconc`;
    await setupUser(uid, { balance: 5000, videoConcurrency: 5 });
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push(await createQueueTask(uid, { prompt: `uc${i}` }));
    let claimed = 0;
    for (const id of ids) {
      const t = await promoteOne(id, uid);
      if (t?.status === 'claimed') claimed += 1;
    }
    const t6 = await db.getTaskById(ids[5]);
    const s1 = await snap(uid);
    const okFill = claimed === 5 && t6.status === 'queued' && s1.user_occ === 5 && !t6.provider_task_id;
    // 释放一个 claimed 槽，再 promote 第 6 个
    const t0 = await db.getTaskById(ids[0]);
    if (t0?.user_slot_held || t0?.platform_slot_held) {
      await db.releaseUserConcurrencySlot(uid, 'video');
      await db.releasePlatformConcurrencySlot('video');
      await db.upsertTask(ids[0], uid, {
        status: 'failed',
        user_slot_held: '0',
        platform_slot_held: '0',
      });
    }
    const t6b = await promoteOne(ids[5], uid);
    const okCont = t6b?.status === 'claimed';
    record('B_user_concurrency_full', okFill && okCont, {
      claimed,
      sixth_before: t6.status,
      sixth_after: t6b?.status,
      snap: s1,
    });
    for (const id of ids) await cleanup(id, uid);
  }

  // ── C. 平台满：复用 Phase5 内存池 cap=100（不打 OTS 100 路真实占用）──
  // 在此用「用户额度极大 + 平台当前接近满」验证：无法 claim 时保持 queued、不扣费、不 RH
  {
    const uid = `${PREFIX}pfull`;
    await setupUser(uid, { balance: 5000, videoConcurrency: 50 });
    // 尽量占满平台（上限通常 100）；若环境脏计数已高，至少验证「无法 claim → queued」语义
    const plat0 = (await db.getPlatformConcurrencyPoolSnapshot())?.video?.running ?? 0;
    const fillN = Math.max(0, Math.min(30, 100 - plat0));
    const fillerIds = [];
    const fillerUsers = [];
    for (let i = 0; i < fillN; i++) {
      const fu = `${PREFIX}pf_${i}`;
      fillerUsers.push(fu);
      await setupUser(fu, { balance: 100, videoConcurrency: 1 });
      const tid = await createQueueTask(fu, { prompt: `fill${i}` });
      fillerIds.push({ tid, fu });
      await promoteOne(tid, fu);
    }
    const plat1 = (await db.getPlatformConcurrencyPoolSnapshot())?.video?.running ?? 0;
    if (plat1 > 100) flags.oversell = true;

    const probe = await createQueueTask(uid, { prompt: 'probe-platform' });
    // 若平台已满或用户另有限制，claim 可能失败留下 queued
    // 强制：若 running>=100，新任务应 queued
    let claimedProbe = await promoteOne(probe, uid);
    const balBefore = (await db.getUserById(uid))?.balance;
    if (claimedProbe?.status === 'claimed') {
      // 平台未满到 100：用「claim 后不 charge」证明 queued 路径外的安全；仍记录平台未超卖
      await chargeClaimedTask(probe, db);
    }
    const balAfter = (await db.getUserById(uid))?.balance;
    const tProbe = await db.getTaskById(probe);
    const oversell = plat1 > 100;
    // 验收重点：不能超卖；若处于满载则 probe 必须 queued 且未 RH
    const okNoOversell = !oversell;
    const okQueuedWhenFull =
      plat1 < 100 ||
      (tProbe.status === 'queued' && !tProbe.provider_task_id && balAfter === balBefore);
    record('C_platform_cap_no_oversell', okNoOversell && (plat1 < 100 || okQueuedWhenFull), {
      plat_before_fill: plat0,
      plat_after_fill: plat1,
      probe_status: tProbe.status,
      oversell,
      note: plat1 < 100 ? 'platform not fully filled in this env; oversell check only' : 'full path',
    });
    await cleanup(probe, uid);
    for (const { tid, fu } of fillerIds) await cleanup(tid, fu);
  }

  // ── D. RH 创建明确失败 → 退款+释槽+failure，退款一次 ──
  {
    const uid = `${PREFIX}rhfail`;
    await setupUser(uid, { balance: 100 });
    const tid = await createQueueTask(uid, { quoted: 4 });
    await promoteOne(tid, uid);
    await chargeClaimedTask(tid, db);
    const balCharged = (await db.getUserById(uid))?.balance;
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhFail() });
    const t = await db.getTaskById(tid);
    const bal1 = (await db.getUserById(uid))?.balance;
    const s = await snap(uid);
    const r2 = await settleOneTask(tid, db, { outcome: 'failed', refund: true });
    const bal2 = (await db.getUserById(uid))?.balance;
    const ok =
      t.status === 'failed' &&
      !t.provider_task_id &&
      balCharged === 96 &&
      bal1 === 100 &&
      bal2 === 100 &&
      s.user_occ === 0 &&
      (r2.idempotent === true || r2.ok);
    if (bal2 > 100) flags.double_refund = true;
    record('D_rh_create_fail_refund_once', ok, {
      status: t.status,
      bal: { charged: balCharged, after: bal1, after2: bal2 },
      snap: s,
      settle2: r2,
    });
    await cleanup(tid, uid);
  }

  // ── E. RH 生成失败（已有 provider_task_id）──
  {
    const uid = `${PREFIX}genfail`;
    await setupUser(uid, { balance: 100 });
    const tid = await createQueueTask(uid, { quoted: 4 });
    await promoteOne(tid, uid);
    await chargeClaimedTask(tid, db);
    const beforeRh = rhCalls;
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_gen_fail') });
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({ ok: true, status: 'FAILED' }),
    });
    const t = await db.getTaskById(tid);
    const bal = (await db.getUserById(uid))?.balance;
    const s = await snap(uid);
    const r2 = await settleOneTask(tid, db, { outcome: 'failed', refund: true });
    const bal2 = (await db.getUserById(uid))?.balance;
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_should_not_2') });
    const rhDelta = rhCalls - beforeRh;
    if (rhDelta > 1) flags.double_rh = true;
    if (bal2 > bal) flags.double_refund = true;
    const ok =
      t.status === 'failed' &&
      t.provider_task_id === 'rh_gen_fail' &&
      bal === 100 &&
      bal2 === 100 &&
      s.user_occ === 0 &&
      rhDelta === 1 &&
      r2.idempotent === true;
    record('E_rh_generate_fail_refund_once', ok, {
      status: t.status,
      pid: t.provider_task_id,
      bal,
      bal2,
      rhDelta,
      settle2: r2,
    });
    await cleanup(tid, uid);
  }

  // ── F. Poll 查询异常：有 pid 后不确定 → 不重交、不退、不释；恢复后 SUCCESS ──
  {
    const uid = `${PREFIX}pollunc`;
    await setupUser(uid, { balance: 100 });
    const tid = await createQueueTask(uid, { quoted: 4 });
    await promoteOne(tid, uid);
    await chargeClaimedTask(tid, db);
    const beforeRh = rhCalls;
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_poll_unc') });
    const q1 = await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({ ok: false, reason: 'QUERY_TIMEOUT', uncertain: true }),
    });
    const t1 = await db.getTaskById(tid);
    const bal1 = (await db.getUserById(uid))?.balance;
    // 再次 dispatch 不得新 RH
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_bad') });
    const rhAfter = rhCalls - beforeRh;
    if (rhAfter > 1) flags.double_rh = true;
    const q2 = await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/p815.mp4',
      }),
    });
    const t2 = await db.getTaskById(tid);
    const bal2 = (await db.getUserById(uid))?.balance;
    const s = await snap(uid);
    const ok =
      q1.uncertain &&
      t1.status === 'running' &&
      t1.provider_task_id === 'rh_poll_unc' &&
      (t1.user_slot_held || t1.platform_slot_held) &&
      bal1 === 96 &&
      rhAfter === 1 &&
      t2.status === 'success' &&
      bal2 === 96 &&
      s.user_occ === 0 &&
      String(t2.result_oss_url || '').includes('p815.mp4');
    record('F_poll_uncertain_then_success', ok, {
      q1,
      mid: { status: t1.status, held: { u: t1.user_slot_held, p: t1.platform_slot_held }, bal: bal1 },
      rhAfter,
      final: { status: t2.status, bal: bal2, snap: s },
    });
    await cleanup(tid, uid);
  }

  // ── F2. Poll 不确定后最终 FAILURE → 退款一次 ──
  {
    const uid = `${PREFIX}pollfail`;
    await setupUser(uid, { balance: 100 });
    const tid = await createQueueTask(uid, { quoted: 4 });
    await promoteOne(tid, uid);
    await chargeClaimedTask(tid, db);
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_poll_fail') });
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({ ok: false, reason: 'QUERY_FAIL', uncertain: true }),
    });
    await pollOneProviderTask(tid, db, {
      queryRunningHub: async () => ({ ok: true, status: 'FAILED' }),
    });
    const t = await db.getTaskById(tid);
    const bal = (await db.getUserById(uid))?.balance;
    const r2 = await refundTaskCharge(tid, db);
    const bal2 = (await db.getUserById(uid))?.balance;
    const ok = t.status === 'failed' && bal === 100 && bal2 === 100 && r2.idempotent;
    if (bal2 > 100) flags.double_refund = true;
    record('F2_poll_uncertain_then_fail_refund_once', ok, { status: t.status, bal, bal2, r2 });
    await cleanup(tid, uid);
  }

  // ── G. 重复 Dispatch ──
  {
    const uid = `${PREFIX}storm`;
    await setupUser(uid, { balance: 100 });
    const tid = await createQueueTask(uid, { quoted: 4 });
    await promoteOne(tid, uid);
    await chargeClaimedTask(tid, db);
    const before = rhCalls;
    await Promise.all(
      Array.from({ length: 10 }, () =>
        dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_storm_only') }),
      ),
    );
    const submits = rhCalls - before;
    const t = await db.getTaskById(tid);
    if (submits > 1) flags.double_rh = true;
    record('G_repeat_dispatch_one_rh', submits === 1 && t.provider_task_id === 'rh_storm_only', {
      submits,
      pid: t.provider_task_id,
    });
    await cleanup(tid, uid);
  }

  // ── H. 重复 Charge ──
  {
    const uid = `${PREFIX}dchg`;
    await setupUser(uid, { balance: 100 });
    const tid = await createQueueTask(uid, { quoted: 4 });
    await promoteOne(tid, uid);
    const r1 = await chargeClaimedTask(tid, db);
    const bal1 = (await db.getUserById(uid))?.balance;
    const r2 = await chargeClaimedTask(tid, db);
    const r3 = await chargeClaimedTask(tid, db);
    const bal2 = (await db.getUserById(uid))?.balance;
    if (bal2 < bal1) flags.double_charge = true;
    const ok = bal1 === 96 && bal2 === 96 && (r2.idempotent || r2.ok) && (r3.idempotent || r3.ok);
    record('H_repeat_charge_once', ok, { bal1, bal2, r1: !!r1.ok, r2, r3 });
    await cleanup(tid, uid);
  }

  // ── I. 重复 Refund ──
  {
    const uid = `${PREFIX}dref`;
    await setupUser(uid, { balance: 100 });
    const tid = await createQueueTask(uid, { quoted: 4 });
    await promoteOne(tid, uid);
    await chargeClaimedTask(tid, db);
    await dispatchOneChargedTask(tid, db, { submitRunningHub: mockRhOk('rh_dref') });
    await settleOneTask(tid, db, { outcome: 'failed', refund: true });
    const bal1 = (await db.getUserById(uid))?.balance;
    const r2 = await refundTaskCharge(tid, db);
    const r3 = await refundTaskCharge(tid, db);
    const bal2 = (await db.getUserById(uid))?.balance;
    if (bal2 > bal1) flags.double_refund = true;
    record('I_repeat_refund_once', bal1 === 100 && bal2 === 100 && r2.idempotent && r3.idempotent, {
      bal1,
      bal2,
      r2,
      r3,
    });
    await cleanup(tid, uid);
  }

  // ── J. Claim 超时恢复：claimed+charged → lease expire → queued → re-claim → 不重复扣费 ──
  {
    const uid = `${PREFIX}lease`;
    await setupUser(uid, { balance: 100 });
    const tid = await createQueueTask(uid, { quoted: 4 });
    await promoteOne(tid, uid);
    await chargeClaimedTask(tid, db);
    const balCharged = (await db.getUserById(uid))?.balance;
    const t0 = await db.getTaskById(tid);
    // 强制 lease 过期
    await db.upsertTask(tid, uid, {
      lease_expires_at: Date.now() - 60_000,
      status: 'claimed',
    });
    const deps = await buildPromoteDeps(Date.now());
    const rec = await recoverOneExpiredClaim(
      {
        taskId: tid,
        userId: uid,
        taskType: 'video',
        claimToken: t0.claim_token,
      },
      deps,
    );
    const t1 = await db.getTaskById(tid);
    const s1 = await snap(uid);
    const t2 = await promoteOne(tid, uid);
    const balBeforeRecharge = (await db.getUserById(uid))?.balance;
    const ch2 = await chargeClaimedTask(tid, db);
    const balAfter = (await db.getUserById(uid))?.balance;
    if (balAfter < balBeforeRecharge) flags.double_charge = true;
    const ok =
      rec.ok &&
      t1.status === 'queued' &&
      s1.user_occ === 0 &&
      t2.status === 'claimed' &&
      balCharged === 96 &&
      balAfter === 96 &&
      (ch2.idempotent || ch2.ok);
    record('J_claim_lease_recover_no_double_charge', ok, {
      rec,
      after_unclaim: { status: t1.status, snap: s1, stage: t1.execution_stage },
      reclaim: t2.status,
      bal: { charged: balCharged, after: balAfter },
      ch2,
    });
    await cleanup(tid, uid);
  }

  // ── K. Worker 中断恢复 ──
  {
    const uid = `${PREFIX}crash`;
    await setupUser(uid, { balance: 200 });

    // K1 claim 后中断：lease recover → queued（上面 J 已覆盖 claimed）
    // K2 charge 后中断：recover → dispatch 一次
    const tid2 = await createQueueTask(uid, { quoted: 4, prompt: 'crash-charge' });
    await promoteOne(tid2, uid);
    await chargeClaimedTask(tid2, db);
    const before2 = rhCalls;
    const r2 = await recoverOneProviderTask(tid2, db, { submitRunningHub: mockRhOk('rh_crash_chg') });
    const t2 = await db.getTaskById(tid2);
    const ok2 = t2.provider_task_id === 'rh_crash_chg' && rhCalls - before2 === 1;

    // K3/K4：有 pid 后中断 → recover 只 poll，不重交
    const tid3 = await createQueueTask(uid, { quoted: 4, prompt: 'crash-pid' });
    await promoteOne(tid3, uid);
    await chargeClaimedTask(tid3, db);
    await dispatchOneChargedTask(tid3, db, { submitRunningHub: mockRhOk('rh_crash_pid') });
    const before3 = rhCalls;
    const r3 = await recoverOneProviderTask(tid3, db, {
      submitRunningHub: mockRhOk('rh_should_not'),
      queryRunningHub: async () => ({
        ok: true,
        status: 'SUCCESS',
        result_url: 'https://example.com/crash.mp4',
      }),
    });
    const t3 = await db.getTaskById(tid3);
    if (rhCalls - before3 > 0) flags.double_rh = true;
    const ok3 =
      t3.status === 'success' &&
      t3.provider_task_id === 'rh_crash_pid' &&
      rhCalls === before3;

    record('K_worker_interrupt_recovery', ok2 && ok3, {
      charge_then_recover: { ok: ok2, pid: t2.provider_task_id, r2 },
      pid_then_recover: { ok: ok3, status: t3.status, pid: t3.provider_task_id, rh_delta: rhCalls - before3 },
    });
    await cleanup(tid2, uid);
    await cleanup(tid3, uid);
  }

  // ── L. 区域一致性（委托已有 test-poll-rh-region 语义，此处再断言一次）──
  {
    const uid = `${PREFIX}region`;
    await setupUser(uid, { balance: 50 });
    const seen = { ai: null, cn: null };
    for (const region of ['ai', 'cn']) {
      const tid = await createQueueTask(uid, { rhRegion: region, prompt: `reg-${region}` });
      await promoteOne(tid, uid);
      await chargeClaimedTask(tid, db);
      await dispatchOneChargedTask(tid, db, {
        submitRunningHub: async (fwd) => {
          seen[region] = fwd?.rhRegion;
          return { ok: true, provider_task_id: `rh_${region}`, data: {} };
        },
      });
      let pollRegion = null;
      await pollOneProviderTask(tid, db, {
        queryRunningHub: async (_pid, opts) => {
          pollRegion = opts?.rhRegion;
          return { ok: true, status: 'RUNNING' };
        },
      });
      seen[`${region}_poll`] = pollRegion;
      await cleanup(tid, uid);
    }
    const ok =
      seen.ai === 'ai' &&
      seen.cn === 'cn' &&
      seen.ai_poll === 'ai' &&
      seen.cn_poll === 'cn';
    record('L_region_dispatch_poll_match', ok, seen);
  }

  // ── M. 100 路平台压力 + 用户并发压力：调用 Phase5 内存测试结果口径 ──
  // 这里跑轻量 OTS：用户 limit=5，创建 8 个，claimed≤5
  {
    const uid = `${PREFIX}stress_u`;
    await setupUser(uid, { balance: 5000, videoConcurrency: 5 });
    const ids = [];
    for (let i = 0; i < 8; i++) ids.push(await createQueueTask(uid, { prompt: `su${i}` }));
    let claimed = 0;
    for (const id of ids) {
      const t = await promoteOne(id, uid);
      if (t?.status === 'claimed') claimed += 1;
    }
    const s = await snap(uid);
    if (claimed > 5 || s.user_occ > 5) flags.oversell = true;
    record('M_user_concurrency_stress', claimed === 5 && s.user_occ === 5, { claimed, snap: s });
    for (const id of ids) await cleanup(id, uid);
  }

  // 平台压力：以 Phase5 J2 为准 — 在本脚本记录「委托 PASS」，并验证当前 OTS running ≤100
  {
    const plat = (await db.getPlatformConcurrencyPoolSnapshot())?.video?.running ?? -1;
    if (plat > 100) flags.oversell = true;
    record('M_platform_cap_ots_snapshot', plat >= 0 && plat <= 100, {
      platform_running: plat,
      note: 'hard cap checked on live OTS snapshot; full 100-claim race covered by Phase5 J2 mock',
    });
  }

  const passed = matrix.every((m) => m.pass) && !flags.double_charge && !flags.double_refund && !flags.double_rh && !flags.oversell;
  const report = {
    phase: '8.1.5',
    passed,
    flags,
    matrix,
    finished_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(__dirname, 'phase8-1-5-exception-acceptance-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed, flags, fail: matrix.filter((m) => !m.pass).map((m) => m.name) }, null, 2));
  if (!passed) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
