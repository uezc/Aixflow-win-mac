/**
 * Phase 5 自测（不连 OTS）：
 * - 状态机 claimed
 * - User/Platform CAS 模拟 A/B/C 不超卖
 * - Scheduler：user→platform→claim + 回滚
 * - lease recovery
 * - orphan reservation reconcile
 * - 500 入队 + promote 上限
 * - 重复 release 不减负
 * - computeCounterOvershoot 幂等向下修正
 *
 * 运行：node demo/aliyun-fc-init-user/scripts/test-phase5-queue-scheduler.mjs
 */
import {
  TASK_STATUS,
  canTransitionTaskStatus,
  occupiesConcurrencySlot,
  normalizeTaskStatus,
} from '../lib/taskStatusMachine.mjs';
import {
  tryClaimOneQueuedTask,
  promoteQueuedTasks,
  recoverOneExpiredClaim,
  reconcileOneOrphanReservation,
  computeCounterOvershoot,
  normalizeQueueTaskType,
} from '../lib/queueScheduler.mjs';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** 模拟 OTS 条件 INCREMENT */
class CasCounter {
  constructor(name) {
    this.name = name;
    this.value = 0;
    this.lock = Promise.resolve();
  }
  async acquire(limit) {
    const run = async () => {
      if (this.value >= limit) return { ok: false, reason: `${this.name}_FULL` };
      this.value += 1;
      return { ok: true, occupied: this.value, limit };
    };
    const p = this.lock.then(run, run);
    this.lock = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }
  async release() {
    const run = async () => {
      if (this.value <= 0) return { ok: true, already_empty: true, occupied: 0 };
      this.value -= 1;
      return { ok: true, occupied: this.value };
    };
    const p = this.lock.then(run, run);
    this.lock = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }
}

function makeMemoryStore() {
  const tasks = new Map();
  const reservations = new Map();
  const userPools = new Map(); // key userId#type -> CasCounter
  const platformPools = {
    cn_video: new CasCounter('PLATFORM'),
    cn_image: new CasCounter('PLATFORM'),
    overseas_video: new CasCounter('PLATFORM'),
    overseas_image: new CasCounter('PLATFORM'),
    audio: new CasCounter('PLATFORM'),
    // legacy aliases used by assertions
    get video() {
      return this.cn_video;
    },
    get image() {
      return this.cn_image;
    },
  };

  const userKey = (uid, t) => `${uid}#${t}`;
  const getUserPool = (uid, t) => {
    const k = userKey(uid, t);
    if (!userPools.has(k)) userPools.set(k, new CasCounter('USER'));
    return userPools.get(k);
  };

  return {
    tasks,
    reservations,
    userPools,
    platformPools,
    getUserPool,
    deps(nowMs, opts = {}) {
      const forceClaimFail = opts.forceClaimFail || new Set();
      return {
        nowMs,
        leaseMs: opts.leaseMs ?? 60_000,
        orphanMs: opts.orphanMs ?? 120_000,
        leaseOwner: opts.leaseOwner || 'test-scheduler',
        resolveUserLimit: async (userId, taskType) => {
          if (opts.limits && opts.limits[`${userId}#${taskType}`] != null) {
            return opts.limits[`${userId}#${taskType}`];
          }
          return opts.defaultLimit ?? 5;
        },
        createReservation: async (row) => {
          reservations.set(row.reservation_id, { ...row });
          return row;
        },
        markReservationHeld: async (reservationId, which) => {
          const r = reservations.get(reservationId);
          assert(r, 'reservation missing');
          if (which === 'user') r.user_slot_held = 1;
          else r.platform_slot_held = 1;
          r.updated_at = nowMs;
        },
        markReservationState: async (reservationId, state, extra = {}) => {
          const r = reservations.get(reservationId);
          assert(r, 'reservation missing');
          Object.assign(r, extra, { state, updated_at: Date.now() });
        },
        tryAcquireUser: async (userId, taskType, limit) =>
          getUserPool(userId, taskType).acquire(limit),
        releaseUser: async (userId, taskType) => getUserPool(userId, taskType).release(),
        tryAcquirePlatform: async (taskType) => {
          const id =
            taskType === 'video'
              ? 'cn_video'
              : taskType === 'image'
                ? 'cn_image'
                : String(taskType || '');
          const max = opts.platformMax?.[taskType] ?? opts.platformMax?.[id] ?? 100;
          return platformPools[id].acquire(max);
        },
        releasePlatform: async (taskType) => {
          const id =
            taskType === 'video'
              ? 'cn_video'
              : taskType === 'image'
                ? 'cn_image'
                : String(taskType || '');
          return platformPools[id].release();
        },
        atomicClaimQueuedTask: async (args) => {
          if (forceClaimFail.has(args.taskId)) {
            return { ok: false, reason: 'CLAIM_RACE' };
          }
          const t = tasks.get(args.taskId);
          if (!t || t.status !== 'queued') return { ok: false, reason: 'CLAIM_RACE' };
          t.status = 'claimed';
          t.reservation_id = args.reservationId;
          t.claim_token = args.claimToken;
          t.lease_owner = args.leaseOwner;
          t.lease_expires_at = args.leaseExpiresAt;
          t.claimed_at = args.claimedAt;
          t.user_slot_held = true;
          t.platform_slot_held = true;
          return { ok: true };
        },
        atomicUnclaimExpiredTask: async (args) => {
          const t = tasks.get(args.taskId);
          if (!t || t.status !== 'claimed') return { ok: false, reason: 'NOT_CLAIMED' };
          if (t.lease_expires_at > (args.nowMs || nowMs)) {
            return { ok: false, reason: 'LEASE_NOT_EXPIRED' };
          }
          if (args.claimToken && t.claim_token && args.claimToken !== t.claim_token) {
            return { ok: false, reason: 'CLAIM_TOKEN_MISMATCH' };
          }
          const userHeld = t.user_slot_held;
          const platformHeld = t.platform_slot_held;
          const reservationId = t.reservation_id;
          t.status = 'queued';
          t.lease_owner = '';
          t.claim_token = '';
          t.reservation_id = '';
          t.user_slot_held = false;
          t.platform_slot_held = false;
          t.lease_expires_at = 0;
          return {
            ok: true,
            user_slot_held: userHeld,
            platform_slot_held: platformHeld,
            reservation_id: reservationId,
          };
        },
        getTaskById: async (taskId) => {
          const t = tasks.get(taskId);
          return t ? { ...t, task_id: taskId } : null;
        },
      };
    },
  };
}

// —— C. 状态机 ——
assert(canTransitionTaskStatus('queued', 'claimed'), 'queued→claimed');
assert(!canTransitionTaskStatus('queued', 'running'), 'queued↛running (Phase5 path)');
assert(canTransitionTaskStatus('claimed', 'queued'), 'claimed→queued lease');
assert(canTransitionTaskStatus('claimed', 'running'), 'claimed→running future');
assert(occupiesConcurrencySlot('claimed'), 'claimed occupies');
assert(occupiesConcurrencySlot('running'), 'running occupies');
assert(!occupiesConcurrencySlot('queued'), 'queued no occupy');
assert(normalizeQueueTaskType('VIDEO') === 'video', 'normalize type');

// —— I. A/B/C：用户额度=5，occupied 起点=4，三路同时 claim ——
{
  const store = makeMemoryStore();
  const uid = 'user-abc';
  const userPool = store.getUserPool(uid, 'video');
  userPool.value = 4;
  // 预置 3 条 queued
  for (let i = 0; i < 3; i++) {
    store.tasks.set(`t${i}`, {
      status: 'queued',
      user_id: uid,
      task_type: 'video',
      queue_entered_at: 1000 + i,
    });
  }
  const deps = store.deps(10_000, { defaultLimit: 5, platformMax: { video: 100 } });
  const results = await Promise.all([
    tryClaimOneQueuedTask(
      { taskId: 't0', userId: uid, taskType: 'video', queueEnteredAt: 1000 },
      deps,
    ),
    tryClaimOneQueuedTask(
      { taskId: 't1', userId: uid, taskType: 'video', queueEnteredAt: 1001 },
      deps,
    ),
    tryClaimOneQueuedTask(
      { taskId: 't2', userId: uid, taskType: 'video', queueEnteredAt: 1002 },
      deps,
    ),
  ]);
  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;
  assert(ok === 1, `A/B/C ok=${ok} want 1`);
  assert(fail === 2, `A/B/C fail=${fail}`);
  assert(userPool.value === 5, `user occupied=${userPool.value} want 5`);
  assert(userPool.value <= 5, 'never oversell user');
  const claimedTasks = [...store.tasks.values()].filter((t) => t.status === 'claimed');
  assert(claimedTasks.length === 1, `claimed tasks=${claimedTasks.length}`);
  console.log('[I] A/B/C concurrent claim OK (max 5)');
}

// —— 回滚：claim 失败时逆序释放 ——
{
  const store = makeMemoryStore();
  store.tasks.set('tx', {
    status: 'queued',
    user_id: 'u1',
    task_type: 'video',
    queue_entered_at: 1,
  });
  const deps = store.deps(1, {
    defaultLimit: 5,
    forceClaimFail: new Set(['tx']),
  });
  const r = await tryClaimOneQueuedTask(
    { taskId: 'tx', userId: 'u1', taskType: 'video' },
    deps,
  );
  assert(!r.ok, 'claim fail expected');
  assert(store.getUserPool('u1', 'video').value === 0, 'user rolled back');
  assert(store.platformPools.video.value === 0, 'platform rolled back');
  const resv = [...store.reservations.values()][0];
  assert(resv.state === 'rolled_back', 'reservation rolled_back');
  console.log('[F] claim fail rollback OK');
}

// —— G. lease recovery ——
{
  const store = makeMemoryStore();
  store.tasks.set('tl', {
    status: 'claimed',
    user_id: 'u2',
    task_type: 'video',
    claim_token: 'tok',
    reservation_id: 'res-l',
    lease_expires_at: 1000,
    user_slot_held: true,
    platform_slot_held: true,
  });
  store.getUserPool('u2', 'video').value = 1;
  store.platformPools.video.value = 1;
  store.reservations.set('res-l', {
    reservation_id: 'res-l',
    state: 'claimed',
    user_slot_held: 1,
    platform_slot_held: 1,
  });
  const deps = store.deps(5000);
  const r = await recoverOneExpiredClaim(
    {
      taskId: 'tl',
      userId: 'u2',
      taskType: 'video',
      claimToken: 'tok',
      reservationId: 'res-l',
    },
    deps,
  );
  assert(r.ok, 'lease recover ok');
  assert(store.tasks.get('tl').status === 'queued', 'back to queued');
  assert(store.getUserPool('u2', 'video').value === 0, 'user released');
  assert(store.platformPools.video.value === 0, 'platform released');
  // 重复 recover 幂等
  const r2 = await recoverOneExpiredClaim(
    { taskId: 'tl', userId: 'u2', taskType: 'video', claimToken: 'tok' },
    deps,
  );
  assert(!r2.ok, 'second recover no-op race');
  assert(store.getUserPool('u2', 'video').value === 0, 'still 0 after noop');
  console.log('[G] lease recovery OK');
}

// —— H. orphan reservation ——
{
  const store = makeMemoryStore();
  // crash after user+platform acquire, before claim：task still queued
  store.tasks.set('to', {
    status: 'queued',
    user_id: 'u3',
    task_type: 'video',
  });
  store.getUserPool('u3', 'video').value = 1;
  store.platformPools.video.value = 1;
  store.reservations.set('res-o', {
    reservation_id: 'res-o',
    task_id: 'to',
    user_id: 'u3',
    task_type: 'video',
    user_slot_held: 1,
    platform_slot_held: 1,
    state: 'pending',
    expires_at: 1000,
  });
  const deps = store.deps(5000);
  const r = await reconcileOneOrphanReservation(store.reservations.get('res-o'), deps);
  assert(r.orphan_released, 'orphan released');
  assert(store.getUserPool('u3', 'video').value === 0, 'orphan user released');
  assert(store.platformPools.video.value === 0, 'orphan platform released');
  assert(store.reservations.get('res-o').state === 'rolled_back', 'orphan state');
  // 重复 reconcile 幂等
  const r2 = await reconcileOneOrphanReservation(store.reservations.get('res-o'), deps);
  assert(r2.skipped, 'second reconcile skipped');
  assert(store.getUserPool('u3', 'video').value === 0, 'no double release to negative');
  console.log('[H] orphan reconcile OK');
}

// —— K. 重复 release ——
{
  const c = new CasCounter('USER');
  await c.acquire(5);
  await c.release();
  assert(c.value === 0, 'released');
  for (let i = 0; i < 20; i++) {
    const r = await c.release();
    assert(r.already_empty === true, 'empty');
  }
  assert(c.value === 0, 'still 0');
  assert(computeCounterOvershoot(8, 5) === 3, 'overshoot 3');
  assert(computeCounterOvershoot(5, 5) === 0, 'overshoot 0');
  assert(computeCounterOvershoot(3, 5) === 0, 'never increase');
  assert(computeCounterOvershoot(8, 5, { scanComplete: false }) === 0, 'incomplete scan no fix');
  assert(computeCounterOvershoot(8, 5, { scanComplete: true }) === 3, 'complete scan ok');
  console.log('[K] repeat release + overshoot OK');
}

// —— J. 500 入队，平台 100，用户额度 5（单用户）→ 最多 claimed=5 ——
{
  const store = makeMemoryStore();
  const uid = 'u500';
  const queued = [];
  for (let i = 0; i < 500; i++) {
    const id = `q${i}`;
    store.tasks.set(id, {
      status: 'queued',
      user_id: uid,
      task_type: 'video',
      queue_entered_at: i,
    });
    queued.push({ taskId: id, userId: uid, taskType: 'video', queueEnteredAt: i });
  }
  const deps = store.deps(1, { defaultLimit: 5, platformMax: { video: 100 } });
  // 多波 promote：每波每用户只 claim 1（公平），所以需要 5 波才能到额度 5
  let totalClaimed = 0;
  for (let wave = 0; wave < 10; wave++) {
    const stillQueued = queued.filter((t) => store.tasks.get(t.taskId)?.status === 'queued');
    const r = await promoteQueuedTasks(stillQueued, deps, { maxClaims: 50, maxAttempts: 100 });
    totalClaimed += r.claimed;
  }
  const claimed = [...store.tasks.values()].filter((t) => t.status === 'claimed').length;
  const stillQ = [...store.tasks.values()].filter((t) => t.status === 'queued').length;
  assert(claimed === 5, `500-enqueue claimed=${claimed} want 5 (user limit)`);
  assert(stillQ === 495, `queued remain=${stillQ}`);
  assert(store.getUserPool(uid, 'video').value === 5, 'user counter=5');
  assert(store.platformPools.video.value === 5, 'platform=5');
  assert(totalClaimed === 5, `totalClaimed=${totalClaimed}`);
  // 无 running
  assert(
    [...store.tasks.values()].every((t) => t.status !== 'running'),
    'no running written',
  );
  console.log('[J] 500 enqueue → max claimed=5 (user limit) OK');
}

// —— 多用户 500：平台上限 100 ——
{
  const store = makeMemoryStore();
  const queued = [];
  for (let i = 0; i < 500; i++) {
    const uid = `u${i % 50}`; // 50 用户
    const id = `m${i}`;
    store.tasks.set(id, {
      status: 'queued',
      user_id: uid,
      task_type: 'video',
      queue_entered_at: i,
    });
    queued.push({ taskId: id, userId: uid, taskType: 'video', queueEnteredAt: i });
  }
  const deps = store.deps(1, { defaultLimit: 5, platformMax: { video: 100 } });
  // 多波直到稳定
  for (let wave = 0; wave < 30; wave++) {
    const stillQueued = queued.filter((t) => store.tasks.get(t.taskId)?.status === 'queued');
    if (stillQueued.length === 0) break;
    await promoteQueuedTasks(stillQueued, deps, { maxClaims: 50, maxAttempts: 200 });
  }
  const claimed = [...store.tasks.values()].filter((t) => t.status === 'claimed').length;
  assert(claimed === 100, `multi-user claimed=${claimed} want platform 100`);
  assert(store.platformPools.video.value === 100, 'platform counter 100');
  assert(store.platformPools.video.value <= 100, 'never >100');
  // 每用户 ≤5
  for (let i = 0; i < 50; i++) {
    const uid = `u${i}`;
    const n = store.getUserPool(uid, 'video').value;
    assert(n <= 5, `user ${uid} occupied=${n}`);
  }
  console.log('[J2] 500 multi-user → platform cap 100 OK');
}

console.log('[test-phase5-queue-scheduler] ALL OK');
