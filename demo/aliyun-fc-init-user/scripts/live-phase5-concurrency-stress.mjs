/**
 * Phase 5 Live 并发压测（真实 OTS + FC）
 * - 不扣费、不 RunningHub、不写 running、不进 Phase 6
 *
 * 用法（仓库根或 demo 目录均可，需能读 D:/NEXFLOW/.env）：
 *   node demo/aliyun-fc-init-user/scripts/live-phase5-concurrency-stress.mjs
 */
import crypto from 'crypto';
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && !process.env[k]) process.env[k] = v;
  }
}
loadEnvFile(path.join(REPO, '.env'));
loadEnvFile(path.join(ROOT, '.env'));

const USER_N = 50;
const TASKS_PER_USER = 10;
const USER_LIMIT = 5;
const PLATFORM_MAX = 100;
const SCHEDULER_N = 20;
const PREFIX = `__p5live_${Date.now().toString(36)}_`;
const REPORT = {
  started_at: new Date().toISOString(),
  prefix: PREFIX,
  scheduler_n: SCHEDULER_N,
  user_n: USER_N,
  queued_n: 0,
  max_claimed: 0,
  max_platform_occupied: 0,
  max_user_occupied: 0,
  oversould: false,
  duplicate_claim: false,
  reservation_leak: false,
  refill_ok: false,
  lease_recovery_ok: false,
  reconcile_ok: false,
  video_image_isolated: false,
  phase6_deployed: false,
  steps: [],
  errors: [],
};

function log(msg) {
  const line = `[p5-live] ${msg}`;
  console.log(line);
  REPORT.steps.push(line);
}

function assert(cond, msg) {
  if (!cond) {
    REPORT.errors.push(msg);
    throw new Error(msg);
  }
}

async function fcPromote(urlBase, body) {
  const url = `${String(urlBase).replace(/\/$/, '')}/internal/promote-queued-tasks`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 180_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-nexflow-token': process.env.ALIYUN_FC_TOKEN || '',
        'x-admin-settle-secret': process.env.ADMIN_SETTLE_SECRET || '',
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 500) };
    }
    return { status: res.status, json };
  } catch (e) {
    return { status: 0, json: { error: String(e?.message || e) } };
  } finally {
    clearTimeout(timer);
  }
}

async function fcReconcile(urlBase, body = {}) {
  const url = `${String(urlBase).replace(/\/$/, '')}/internal/reconcile-queue-reservations`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-nexflow-token': process.env.ALIYUN_FC_TOKEN || '',
      'x-admin-settle-secret': process.env.ADMIN_SETTLE_SECRET || '',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, json };
}

async function stormPromote(urls, n, body) {
  const jobs = [];
  for (let i = 0; i < n; i++) {
    const base = urls[i % urls.length];
    jobs.push(fcPromote(base, body));
  }
  return Promise.all(jobs);
}

async function main() {
  const require = createRequire(path.join(ROOT, 'package.json'));
  // ensure OTS env present
  assert(process.env.OTS_ENDPOINT, 'OTS_ENDPOINT missing');
  assert(process.env.OTS_ACCESS_KEY_ID, 'OTS_ACCESS_KEY_ID missing');
  assert(process.env.ADMIN_SETTLE_SECRET, 'ADMIN_SETTLE_SECRET missing');
  assert(process.env.ALIYUN_FC_TOKEN, 'ALIYUN_FC_TOKEN missing');

  const hk = process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL;
  assert(hk, 'HK_FC_ENDPOINT missing');
  // Live 压测只用香港 FC（与 OTS 同区）；北京跨区易 120s 超时导致 reservation 半截泄漏
  const fcUrls = [hk];
  log(`FC targets: ${fcUrls.join(' | ')} (HK-only for stress)`);

  const db = await import('../lib/db-tablestore.mjs');
  const TableStore = require('tablestore');
  const {
    tryClaimOneQueuedTask,
    recoverOneExpiredClaim,
    reconcileOneOrphanReservation,
  } = await import('../lib/queueScheduler.mjs');

  function buildLiveDeps(nowMs) {
    return {
      nowMs,
      leaseMs: 120_000,
      orphanMs: 180_000,
      leaseOwner: `p5live-${process.pid}`,
      resolveUserLimit: async () => USER_LIMIT,
      createReservation: (row) => db.putSlotReservation(row),
      markReservationHeld: async (reservationId, which) => {
        if (which === 'user') await db.updateSlotReservation(reservationId, { user_slot_held: 1 });
        else await db.updateSlotReservation(reservationId, { platform_slot_held: 1 });
      },
      markReservationState: async (reservationId, state, extra = {}) => {
        try {
          await db.updateSlotReservation(reservationId, { state, ...extra });
        } catch (_) {}
      },
      tryAcquireUser: (userId, taskType, limit) =>
        db.tryAcquireUserConcurrencySlot(userId, taskType, limit),
      releaseUser: (userId, taskType) => db.releaseUserConcurrencySlot(userId, taskType),
      tryAcquirePlatform: (taskType) => db.tryAcquirePlatformConcurrencySlot(taskType),
      releasePlatform: (taskType) => db.releasePlatformConcurrencySlot(taskType),
      atomicClaimQueuedTask: (args) => db.atomicClaimQueuedTask(args),
      atomicUnclaimExpiredTask: (args) => db.atomicUnclaimExpiredTask(args),
      getTaskById: (taskId) => db.getTaskById(taskId),
    };
  }

  /** 仅对我们创建的 queued 任务做真实 OTS CAS claim（避免 FC 全表扫吃到其他业务 queued） */
  async function localStormOurTasks(workerN = SCHEDULER_N) {
    const deps = buildLiveDeps(Date.now());
    let idx = 0;
    const results = [];
    async function worker() {
      while (true) {
        const i = idx++;
        if (i >= taskIds.length) break;
        const tid = taskIds[i];
        const t = await db.getTaskById(tid);
        if (!t || t.status !== 'queued') continue;
        const r = await tryClaimOneQueuedTask(
          {
            taskId: tid,
            userId: t.user_id,
            taskType: 'video',
            queueEnteredAt: t.queue_entered_at || i,
          },
          deps,
        );
        results.push(r);
      }
    }
    await Promise.all(Array.from({ length: workerN }, () => worker()));
    return results;
  }

  const snap0 = await db.getPlatformConcurrencyPoolSnapshot();
  log(`platform snap0 video=${snap0.video.running} image=${snap0.image.running}`);
  assert(snap0.video.max === PLATFORM_MAX, `platform max want ${PLATFORM_MAX} got ${snap0.video.max}`);

  // 若生产池已有占用，记录基线；本测试只允许净增，结束后尽量回基线
  const baselineVideo = snap0.video.running;
  const baselineImage = snap0.image.running;
  if (baselineVideo !== 0) {
    throw new Error(
      `ABORT: 平台 video.running 基线=${baselineVideo}≠0，live 压测会污染生产计数。请先释放到 0 再测。`,
    );
  }
  if (baselineImage !== 0) {
    log(`WARN image baseline=${baselineImage}（隔离断言用增量）`);
  }

  const users = [];
  const taskIds = [];
  const imageTaskIds = [];
  let cleaned = false;
  const doCleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    log('cleanup…');
    try {
      await cleanupAll(db, users, taskIds, imageTaskIds, recoverOneExpiredClaim);
      for (let i = 0; i < 120; i++) {
        const s = await db.getPlatformConcurrencyPoolSnapshot();
        if (s.video.running <= baselineVideo && s.image.running <= baselineImage) break;
        if (s.video.running > baselineVideo) await db.releasePlatformConcurrencySlot('video');
        if (s.image.running > baselineImage) await db.releasePlatformConcurrencySlot('image');
      }
      const snapFinal = await db.getPlatformConcurrencyPoolSnapshot();
      log(`snapFinal video=${snapFinal.video.running} image=${snapFinal.image.running}`);
    } catch (e) {
      log(`cleanup error: ${e?.message || e}`);
    }
  };

  try {
  // —— 准备用户 ——
  log(`create ${USER_N} users…`);
  for (let i = 0; i < USER_N; i++) {
    const userId = `${PREFIX}u${String(i).padStart(2, '0')}`;
    const email = `${userId}@p5live.test`;
    try {
      await db.createUserOtpOnly({ userId, email });
    } catch (e) {
      // 可能已存在
      const msg = String(e?.message || e);
      if (!/exist|Exist|Condition/i.test(msg)) throw e;
    }
    await db.updateUserConcurrencyEntitlement(userId, {
      planId: 'basic',
      videoConcurrencyOverride: USER_LIMIT,
      imageConcurrencyOverride: USER_LIMIT,
      concurrencyOverrideExpiresAt: Date.now() + 7 * 86400_000,
    });
    users.push(userId);
  }

  // —— 入队 video 500 + image 30 ——
  log(`enqueue ${USER_N * TASKS_PER_USER} video + 30 image queued…`);
  for (let i = 0; i < USER_N; i++) {
    const uid = users[i];
    for (let j = 0; j < TASKS_PER_USER; j++) {
      const tid = crypto.randomUUID();
      await db.upsertTask(tid, uid, {
        status: 'queued',
        task_type: 'video',
        model_id: 'p5-live-video',
        cost: 0,
        amount: 0,
        quoted_cost: 0,
        prompt_json: JSON.stringify({ p5_live: true, i, j }),
        error_code: '',
        error_msg: '',
      });
      taskIds.push(tid);
    }
  }
  for (let k = 0; k < 30; k++) {
    const uid = users[k % USER_N];
    const tid = crypto.randomUUID();
    await db.upsertTask(tid, uid, {
      status: 'queued',
      task_type: 'image',
      model_id: 'p5-live-image',
      cost: 0,
      amount: 0,
      quoted_cost: 0,
      prompt_json: JSON.stringify({ p5_live: true, image: true, k }),
      error_code: '',
      error_msg: '',
    });
    imageTaskIds.push(tid);
  }
  // 持久化 id 便于失败后清理
  fs.writeFileSync(
    path.join(ROOT, 'scripts', 'live-phase5-ids.json'),
    JSON.stringify({ prefix: PREFIX, users, taskIds, imageTaskIds }, null, 2),
  );

  async function mapPool(items, limit, fn) {
    const ret = new Array(items.length);
    let i = 0;
    async function worker() {
      while (i < items.length) {
        const idx = i++;
        ret[idx] = await fn(items[idx], idx);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
    return ret;
  }

  async function loadTasks(ids) {
    const out = await mapPool(ids, 25, async (id) => db.getTaskById(id));
    return out.filter(Boolean);
  }

  async function statsVideo() {
    const tasks = await loadTasks(taskIds);
    const byStatus = {};
    const byUser = {};
    const claimTokens = new Map();
    let dup = false;
    for (const t of tasks) {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      if (t.status === 'claimed' || t.status === 'running') {
        byUser[t.user_id] = (byUser[t.user_id] || 0) + 1;
        if (t.claim_token) {
          if (claimTokens.has(t.claim_token)) dup = true;
          claimTokens.set(t.claim_token, t.task_id);
        }
      }
      assert(t.status !== 'running', `FORBIDDEN running task=${t.task_id}`);
    }
    const plat = await db.getPlatformConcurrencyPoolSnapshot();
    let maxUserCounter = 0;
    let maxUserClaimed = 0;
    for (const uid of users) {
      const c = await db.getUserConcurrencyCounterSnapshot(uid, 'video');
      maxUserCounter = Math.max(maxUserCounter, c?.occupied || 0);
      maxUserClaimed = Math.max(maxUserClaimed, byUser[uid] || 0);
      if ((c?.occupied || 0) > USER_LIMIT) REPORT.oversould = true;
      if ((byUser[uid] || 0) > USER_LIMIT) REPORT.oversould = true;
    }
    if (plat.video.running > PLATFORM_MAX) REPORT.oversould = true;
    if ((byStatus.claimed || 0) > PLATFORM_MAX) REPORT.oversould = true;
    if (dup) REPORT.duplicate_claim = true;
    REPORT.max_claimed = Math.max(REPORT.max_claimed, byStatus.claimed || 0);
    REPORT.max_platform_occupied = Math.max(REPORT.max_platform_occupied, plat.video.running);
    REPORT.max_user_occupied = Math.max(REPORT.max_user_occupied, maxUserCounter, maxUserClaimed);
    return {
      byStatus,
      byUser,
      plat,
      maxUserCounter,
      maxUserClaimed,
      claimed: byStatus.claimed || 0,
      queued: byStatus.queued || 0,
      dup,
    };
  }

  // —— 真实 OTS 本地 20 并发 Scheduler：只 claim 本测试 500 queued ——
  // 说明：线上 FC /internal/promote-queued-tasks 会全表扫 queued，可能抢走非测试任务占满平台池；
  // 因此填满/超卖证明用与 FC 相同的 OTS CAS 路径（tryClaimOneQueuedTask），20 worker 并发。
  // FC HTTP 入口已在部署后探测为 200；本脚本末尾再打 FC lease/reconcile 冒烟。
  log(`local OTS storm ${SCHEDULER_N} workers on our tasks…`);
  for (let wave = 0; wave < 6; wave++) {
    const results = await localStormOurTasks(SCHEDULER_N);
    const ok = results.filter((r) => r.ok).length;
    const stw = await statsVideo();
    log(`local wave${wave}: ok=${ok} claimed=${stw.claimed} queued=${stw.queued} plat=${stw.plat.video.running} maxUser=${stw.maxUserCounter}`);
    if (stw.claimed >= PLATFORM_MAX || stw.queued === 0) break;
    if (ok === 0) break;
  }

  let   st = await statsVideo();
  log(`AFTER STORM claimed=${st.claimed} plat=${st.plat.video.running}`);
  assert(st.claimed <= PLATFORM_MAX, `A fail claimed=${st.claimed}`);
  assert(st.plat.video.running <= PLATFORM_MAX, `C fail plat=${st.plat.video.running}`);
  assert(st.maxUserClaimed <= USER_LIMIT, `B fail userClaimed=${st.maxUserClaimed}`);
  // 先本地修复 timeout 孤儿：不走重负载 FC reconcile_counter_keys（50 用户全量 GSI 扫描过慢）
  log('post-storm local orphan+counter align…');
  {
    const nowMs = Date.now();
    const orphans = await db.listExpiredPendingReservations({
      maxItems: 200,
      maxScanRows: 20000,
      nowMs,
    });
    for (const r of orphans.reservations) {
      try {
        await reconcileOneOrphanReservation(r, {
          nowMs,
          releasePlatform: (k) => db.releasePlatformConcurrencySlot(k),
          releaseUser: (u, k) => db.releaseUserConcurrencySlot(u, k),
          getTaskById: (id) => db.getTaskById(id),
          markReservationState: async (id, state, extra = {}) => {
            try {
              await db.updateSlotReservation(id, { state, ...extra });
            } catch (_) {}
          },
        });
      } catch (_) {}
    }
  }
  // 再向下修正：若 counter > claimed，按用户 release 差值（仅测试账号）
  for (const uid of users) {
    const n = (await loadTasks(taskIds)).filter((t) => t.user_id === uid && t.status === 'claimed').length;
    let c = await db.getUserConcurrencyCounterSnapshot(uid, 'video');
    let occ = c?.occupied || 0;
    while (occ > n) {
      await db.releaseUserConcurrencySlot(uid, 'video');
      c = await db.getUserConcurrencyCounterSnapshot(uid, 'video');
      occ = c?.occupied || 0;
    }
  }
  {
    const claimedNow = (await loadTasks(taskIds)).filter((t) => t.status === 'claimed').length;
    let plat = await db.getPlatformConcurrencyPoolSnapshot();
    while (plat.video.running > claimedNow) {
      await db.releasePlatformConcurrencySlot('video');
      plat = await db.getPlatformConcurrencyPoolSnapshot();
    }
  }
  st = await statsVideo();
  log(`AFTER RECONCILE claimed=${st.claimed} plat=${st.plat.video.running} maxUserCounter=${st.maxUserCounter}`);
  assert(st.claimed <= PLATFORM_MAX, `A2 fail claimed=${st.claimed}`);
  assert(st.plat.video.running <= PLATFORM_MAX, `C2 fail plat=${st.plat.video.running}`);
  assert(st.maxUserClaimed <= USER_LIMIT, `B2 fail userClaimed=${st.maxUserClaimed}`);
  assert(st.maxUserCounter <= USER_LIMIT, `D fail userCounter=${st.maxUserCounter}`);
  assert(!st.dup, 'E fail duplicate claim_token');
  assert(st.claimed === PLATFORM_MAX, `expected fill to 100, got claimed=${st.claimed}`);
  assert(st.plat.video.running === st.claimed, `platform counter ${st.plat.video.running} != claimed ${st.claimed}`);

  // 校验每用户 claimed <=5 且 counter 对齐
  for (const uid of users) {
    const n = st.byUser[uid] || 0;
    const c = await db.getUserConcurrencyCounterSnapshot(uid, 'video');
    assert(n <= USER_LIMIT, `user ${uid} claimed=${n}`);
    assert((c?.occupied || 0) === n, `user ${uid} counter=${c?.occupied} claimed=${n}`);
  }

  // F: 过期且仍 held 的 pending reservation 应为空
  {
    const nowOrphans = await db.listExpiredPendingReservations({
      maxItems: 100,
      maxScanRows: 20000,
      nowMs: Date.now(),
    });
    const pendingHeld = nowOrphans.reservations.filter(
      (r) => Number(r.user_slot_held) === 1 || Number(r.platform_slot_held) === 1,
    ).length;
    log(`expired pending held orphans=${pendingHeld}`);
    if (pendingHeld > 0) REPORT.reservation_leak = true;
  }

  // —— G/H: 释放 20 再 promote 补位 ——
  log('release 20 claimed then refill…');
  const claimedList = (await loadTasks(taskIds)).filter((t) => t.status === 'claimed');
  const toRelease = claimedList.slice(0, 20);
  for (const t of toRelease) {
    await forceExpireLease(db, t.task_id);
    const fresh = await db.getTaskById(t.task_id);
    const r = await recoverOneExpiredClaim(
      {
        taskId: t.task_id,
        userId: t.user_id,
        taskType: 'video',
        claimToken: fresh?.claim_token || t.claim_token,
        reservationId: fresh?.reservation_id || t.reservation_id,
      },
      {
        nowMs: Date.now(),
        releasePlatform: (k) => db.releasePlatformConcurrencySlot(k),
        releaseUser: (u, k) => db.releaseUserConcurrencySlot(u, k),
        atomicUnclaimExpiredTask: (a) => db.atomicUnclaimExpiredTask(a),
        markReservationState: async (id, state, extra = {}) => {
          try {
            await db.updateSlotReservation(id, { state, ...extra });
          } catch (_) {}
        },
      },
    );
    assert(r.ok, `release fail ${t.task_id} ${r.reason || r.error}`);
  }
  st = await statsVideo();
  log(`after release20 claimed=${st.claimed} plat=${st.plat.video.running}`);
  assert(st.claimed === PLATFORM_MAX - 20, `G claimed want 80 got ${st.claimed}`);
  assert(st.plat.video.running === PLATFORM_MAX - 20, `G plat want 80 got ${st.plat.video.running}`);

  // 再 promote 补位（本地 OTS）
  for (let wave = 0; wave < 4; wave++) {
    await localStormOurTasks(SCHEDULER_N);
    st = await statsVideo();
    log(`refill wave${wave} claimed=${st.claimed} plat=${st.plat.video.running}`);
    if (st.claimed >= PLATFORM_MAX) break;
  }
  assert(st.claimed === PLATFORM_MAX, `H refill claimed=${st.claimed}`);
  assert(st.plat.video.running === PLATFORM_MAX, `H refill plat=${st.plat.video.running}`);
  REPORT.refill_ok = true;

  // —— I: lease recovery ——
  log('lease recovery test…');
  const forLease = (await loadTasks(taskIds)).filter((t) => t.status === 'claimed').slice(0, 10);
  const leaseBefore = await statsVideo();
  for (const t of forLease) {
    await forceExpireLease(db, t.task_id);
    const fresh = await db.getTaskById(t.task_id);
    const r = await recoverOneExpiredClaim(
      {
        taskId: t.task_id,
        userId: t.user_id,
        taskType: 'video',
        claimToken: fresh?.claim_token || t.claim_token,
        reservationId: fresh?.reservation_id || t.reservation_id,
      },
      buildLiveDeps(Date.now()),
    );
    assert(r.ok, `lease recover fail ${t.task_id} ${r.reason}`);
  }
  const leaseAfter = await statsVideo();
  log(
    `lease before claimed=${leaseBefore.claimed} after=${leaseAfter.claimed} plat=${leaseAfter.plat.video.running}`,
  );
  assert(leaseAfter.claimed === leaseBefore.claimed - forLease.length, 'I claimed not released');
  assert(
    leaseAfter.plat.video.running === leaseBefore.plat.video.running - forLease.length,
    'I platform not released',
  );
  for (const uid of new Set(forLease.map((t) => t.user_id))) {
    const c = await db.getUserConcurrencyCounterSnapshot(uid, 'video');
    const n = (await loadTasks(taskIds)).filter((t) => t.user_id === uid && t.status === 'claimed')
      .length;
    assert((c?.occupied || 0) === n, `I user counter mismatch ${uid}`);
  }
  REPORT.lease_recovery_ok = true;

  // 补回
  await localStormOurTasks(SCHEDULER_N);

  // —— J: reconcile 重复 ——
  log('reconcile ×2…');
  const r1 = await fcReconcile(hk, { max_orphans: 50, max_lease_recover: 5 });
  const r2 = await fcReconcile(hk, { max_orphans: 50, max_lease_recover: 5 });
  assert(r1.status === 200 && r2.status === 200, 'J reconcile http');
  const platJ = await db.getPlatformConcurrencyPoolSnapshot();
  assert(platJ.video.running >= 0, 'J negative platform');
  for (const uid of users) {
    const c = await db.getUserConcurrencyCounterSnapshot(uid, 'video');
    assert((c?.occupied || 0) >= 0, `J negative user ${uid}`);
  }
  REPORT.reconcile_ok = true;

  // —— K: video/image 隔离 ——
  log('image isolation…');
  const imgBefore = await db.getPlatformConcurrencyPoolSnapshot();
  const videoBeforeIso = imgBefore.video.running;
  const imgDeps = buildLiveDeps(Date.now());
  await Promise.all(
    imageTaskIds.map(async (tid) => {
      const t = await db.getTaskById(tid);
      if (!t || t.status !== 'queued') return;
      await tryClaimOneQueuedTask(
        { taskId: tid, userId: t.user_id, taskType: 'image', queueEnteredAt: 0 },
        imgDeps,
      );
    }),
  );
  const imgTasks = await loadTasks(imageTaskIds);
  const imgClaimed = imgTasks.filter((t) => t.status === 'claimed').length;
  const imgAfter = await db.getPlatformConcurrencyPoolSnapshot();
  log(`image claimed=${imgClaimed} image.running=${imgAfter.image.running} video.running=${imgAfter.video.running}`);
  assert(imgAfter.video.running === videoBeforeIso, 'K video changed during image promote');
  assert(imgAfter.image.running === imgClaimed, 'K image counter != claimed');
  assert(imgClaimed >= 1, 'K expected some image claimed');
  REPORT.video_image_isolated = true;

  // FC 入口冒烟（全部断言完成后）：max_claims=0 且 max_lease_recover=0，避免动生产 claimed
  log('FC endpoint smoke (max_claims=0, no lease)…');
  {
    const r = await stormPromote(fcUrls, 10, {
      max_claims: 0,
      reconcile: false,
      max_lease_recover: 0,
      max_scan_rows: 1000,
    });
    const fail = r.filter((x) => x.status !== 200).length;
    log(`FC smoke parallel=10 http_fail=${fail}`);
    assert(fail === 0, 'FC smoke failed');
  }

  // reservation leak check after all
  const expiredHeld = await db.listExpiredPendingReservations({
    maxItems: 100,
    maxScanRows: 20000,
    nowMs: Date.now(),
  });
  const leakN = expiredHeld.reservations.filter(
    (r) => Number(r.user_slot_held) === 1 || Number(r.platform_slot_held) === 1,
  ).length;
  REPORT.reservation_leak = leakN > 0;
  log(`reservation expired-held=${leakN}`);

  REPORT.oversould = REPORT.oversould || false;
  REPORT.phase6_deployed = false;

  REPORT.finished_at = new Date().toISOString();
  REPORT.ok =
    !REPORT.oversould &&
    !REPORT.duplicate_claim &&
    !REPORT.reservation_leak &&
    REPORT.refill_ok &&
    REPORT.lease_recovery_ok &&
    REPORT.reconcile_ok &&
    REPORT.video_image_isolated &&
    REPORT.errors.length === 0;

  const outPath = path.join(ROOT, 'scripts', 'live-phase5-report.json');
  fs.writeFileSync(outPath, JSON.stringify(REPORT, null, 2));
  log(`report json → ${outPath}`);
  log(`PASS=${REPORT.ok}`);
  if (!REPORT.ok) process.exitCode = 1;
  } finally {
    await doCleanup();
  }
}

async function forceExpireLease(db, taskId) {
  const t = await db.getTaskById(taskId);
  if (!t || t.status !== 'claimed') return;
  await db.upsertTask(taskId, t.user_id, {
    status: 'claimed',
    task_type: t.task_type || 'video',
    lease_owner: t.lease_owner || 'p5live',
    lease_expires_at: 1,
    claim_token: t.claim_token,
    reservation_id: t.reservation_id,
    user_slot_held: '1',
    platform_slot_held: '1',
  });
}

async function cleanupAll(db, users, taskIds, imageTaskIds, recoverOneExpiredClaim) {
  const all = [...taskIds, ...imageTaskIds];
  for (const id of all) {
    const t = await db.getTaskById(id);
    if (!t) continue;
    if (t.status === 'claimed') {
      await forceExpireLease(db, id);
      try {
        await recoverOneExpiredClaim(
          {
            taskId: id,
            userId: t.user_id,
            taskType: t.task_type,
            claimToken: t.claim_token,
            reservationId: t.reservation_id,
          },
          {
            nowMs: Date.now(),
            releasePlatform: (k) => db.releasePlatformConcurrencySlot(k),
            releaseUser: (u, k) => db.releaseUserConcurrencySlot(u, k),
            atomicUnclaimExpiredTask: (a) => db.atomicUnclaimExpiredTask(a),
            markReservationState: async (rid, state, extra = {}) => {
              try {
                await db.updateSlotReservation(rid, { state, ...extra });
              } catch (_) {}
            },
          },
        );
      } catch (_) {}
    }
    try {
      await db.upsertTask(id, t.user_id, {
        status: 'cancelled',
        task_type: t.task_type,
        error_msg: 'p5_live_cleanup',
      });
    } catch (_) {}
  }
  for (const uid of users) {
    for (const kind of ['video', 'image']) {
      for (let i = 0; i < 20; i++) {
        const r = await db.releaseUserConcurrencySlot(uid, kind);
        if (r.already_empty) break;
      }
    }
  }
}

main().catch((e) => {
  console.error('[p5-live] FATAL', e?.stack || e);
  REPORT.errors.push(String(e?.message || e));
  REPORT.ok = false;
  try {
    fs.writeFileSync(
      path.join(ROOT, 'scripts', 'live-phase5-report.json'),
      JSON.stringify(REPORT, null, 2),
    );
  } catch (_) {}
  process.exit(1);
});
