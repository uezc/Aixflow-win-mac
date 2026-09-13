/**
 * 一期资源池 + 释槽补位自测（不连 OTS）
 * 运行：node demo/aliyun-fc-init-user/scripts/test-resource-pool-phase1.mjs
 */
import {
  RESOURCE_POOL,
  normalizePlatformPoolKind,
  getPlatformPoolMax,
  PLATFORM_RESOURCE_POOL_IDS,
} from '../lib/platformConcurrencyConfig.mjs';
import { resolveResourcePool } from '../lib/resourcePool.mjs';
import {
  tryClaimOneQueuedTask,
  promoteQueuedTasks,
  tryRefillAfterSlotRelease,
} from '../lib/queueScheduler.mjs';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

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

function makeStore() {
  const tasks = new Map();
  const reservations = new Map();
  const userPools = new Map();
  const platformPools = {
    cn_video: new CasCounter('CN_VIDEO'),
    cn_image: new CasCounter('CN_IMAGE'),
    overseas_video: new CasCounter('OV_VIDEO'),
    overseas_image: new CasCounter('OV_IMAGE'),
    audio: new CasCounter('AUDIO'),
  };
  const getUser = (uid, t) => {
    const k = `${uid}#${t}`;
    if (!userPools.has(k)) userPools.set(k, new CasCounter('USER'));
    return userPools.get(k);
  };
  return {
    tasks,
    platformPools,
    getUser,
    deps(nowMs, opts = {}) {
      return {
        nowMs,
        leaseMs: 60_000,
        orphanMs: 120_000,
        leaseOwner: 'test',
        resolveUserLimit: async () => opts.defaultLimit ?? 100,
        createReservation: async (row) => {
          reservations.set(row.reservation_id, { ...row });
          return row;
        },
        markReservationHeld: async () => {},
        markReservationState: async () => {},
        tryAcquireUser: async (userId, taskType, limit) => getUser(userId, taskType).acquire(limit),
        releaseUser: async (userId, taskType) => getUser(userId, taskType).release(),
        tryAcquirePlatform: async (pool) => {
          const id = normalizePlatformPoolKind(pool);
          const max = opts.platformMax?.[id] ?? getPlatformPoolMax(id);
          return platformPools[id].acquire(max);
        },
        releasePlatform: async (pool) => {
          const id = normalizePlatformPoolKind(pool);
          return platformPools[id].release();
        },
        atomicClaimQueuedTask: async (args) => {
          const t = tasks.get(args.taskId);
          if (!t || t.status !== 'queued') return { ok: false, reason: 'CLAIM_RACE' };
          t.status = 'claimed';
          t.resource_pool = args.resourcePool;
          t.user_slot_held = true;
          t.platform_slot_held = true;
          return { ok: true };
        },
        atomicUnclaimExpiredTask: async () => ({ ok: false }),
        getTaskById: async (id) => tasks.get(id) || null,
      };
    },
  };
}

// —— resolve ——
assert(resolveResourcePool('video', { path: '/some/cn/path' }) === RESOURCE_POOL.CN_VIDEO, 'cn video');
assert(
  resolveResourcePool('video', { path: '/rhart-video-g/foo' }) === RESOURCE_POOL.OVERSEAS_VIDEO,
  'overseas video',
);
assert(
  resolveResourcePool('image', { path: '/rhart-image-g/x' }) === RESOURCE_POOL.OVERSEAS_IMAGE,
  'overseas image',
);
assert(resolveResourcePool('audio', {}) === RESOURCE_POOL.AUDIO, 'audio');
assert(normalizePlatformPoolKind('video') === 'cn_video', 'alias video');
assert(PLATFORM_RESOURCE_POOL_IDS.length === 5, '5 pools');
console.log('[ok] resolveResourcePool');

// —— 池隔离：cn_video 满不影响 cn_image ——
{
  const store = makeStore();
  store.platformPools.cn_video.value = 2;
  for (let i = 0; i < 3; i++) {
    store.tasks.set(`v${i}`, {
      status: 'queued',
      user_id: `u${i}`,
      task_type: 'video',
      resource_pool: 'cn_video',
      queue_entered_at: i,
    });
  }
  store.tasks.set('img0', {
    status: 'queued',
    user_id: 'ui',
    task_type: 'image',
    resource_pool: 'cn_image',
    queue_entered_at: 0,
  });
  const deps = store.deps(1, { platformMax: { cn_video: 2, cn_image: 100 } });
  const pv = await promoteQueuedTasks(
    [
      { taskId: 'v0', userId: 'u0', taskType: 'video', resourcePool: 'cn_video', queueEnteredAt: 0 },
      { taskId: 'v1', userId: 'u1', taskType: 'video', resourcePool: 'cn_video', queueEnteredAt: 1 },
      { taskId: 'v2', userId: 'u2', taskType: 'video', resourcePool: 'cn_video', queueEnteredAt: 2 },
    ],
    deps,
    { maxClaims: 5, resourcePool: 'cn_video' },
  );
  assert(pv.claimed === 0, `cn_video full claimed=${pv.claimed}`);
  const pi = await tryClaimOneQueuedTask(
    { taskId: 'img0', userId: 'ui', taskType: 'image', resourcePool: 'cn_image' },
    deps,
  );
  assert(pi.ok, 'image claim while video full');
  assert(store.platformPools.cn_image.value === 1, 'image pool=1');
  assert(store.platformPools.cn_video.value === 2, 'video still 2');
  console.log('[ok] pool isolation');
}

// —— 释 1 补 1：禁止绕过 acquire；满池不超卖 ——
{
  const store = makeStore();
  const max = 3;
  // 填满 3
  for (let i = 0; i < 3; i++) {
    store.tasks.set(`run${i}`, {
      status: 'claimed',
      user_id: `r${i}`,
      task_type: 'video',
      resource_pool: 'cn_video',
    });
    store.platformPools.cn_video.value += 1;
  }
  assert(store.platformPools.cn_video.value === 3, 'filled');
  // waiting 5
  for (let i = 0; i < 5; i++) {
    store.tasks.set(`w${i}`, {
      status: 'queued',
      user_id: `w${i}`,
      task_type: 'video',
      resource_pool: 'cn_video',
      queue_entered_at: i,
    });
  }
  const deps = store.deps(1, { platformMax: { cn_video: max } });

  // 释放 1 槽
  await deps.releasePlatform('cn_video');
  assert(store.platformPools.cn_video.value === 2, 'after release=2');

  const refill = await tryRefillAfterSlotRelease('cn_video', deps, {
    listQueuedForPool: async () => ({
      tasks: [0, 1, 2, 3, 4].map((i) => ({
        taskId: `w${i}`,
        userId: `w${i}`,
        taskType: 'video',
        resourcePool: 'cn_video',
        queueEnteredAt: i,
      })),
    }),
    maxRefill: 1,
  });
  assert(refill.claimed === 1, `refill claimed=${refill.claimed}`);
  assert(store.platformPools.cn_video.value === 3, `after refill running=${store.platformPools.cn_video.value}`);
  assert(store.tasks.get('w0').status === 'claimed', 'FIFO w0 claimed');
  assert(store.tasks.get('w1').status === 'queued', 'w1 still waiting');

  // 再释放 10 次，每次最多补 1，最终仍 ≤ max，waiting 只剩 0
  let freed = 0;
  for (let i = 0; i < 10; i++) {
    const before = store.platformPools.cn_video.value;
    if (before <= 0) break;
    await deps.releasePlatform('cn_video');
    freed += 1;
    const r = await tryRefillAfterSlotRelease('cn_video', deps, {
      listQueuedForPool: async () => ({
        tasks: [0, 1, 2, 3, 4]
          .filter((j) => store.tasks.get(`w${j}`)?.status === 'queued')
          .map((j) => ({
            taskId: `w${j}`,
            userId: `w${j}`,
            taskType: 'video',
            resourcePool: 'cn_video',
            queueEnteredAt: j,
          })),
      }),
      maxRefill: 1,
    });
    assert(store.platformPools.cn_video.value <= max, 'never exceed max');
    if (r.claimed === 0 && store.platformPools.cn_video.value < max) {
      // 无 waiting
      break;
    }
  }
  assert(store.platformPools.cn_video.value <= max, 'final ≤ max');
  const waiting = [0, 1, 2, 3, 4].filter((j) => store.tasks.get(`w${j}`)?.status === 'queued').length;
  assert(waiting === 0, `all waiting claimed waiting=${waiting} freed=${freed}`);
  console.log('[ok] release-N refill-N via acquire');
}

// —— 重复 claim：同任务第二次失败 ——
{
  const store = makeStore();
  store.tasks.set('dup', {
    status: 'queued',
    user_id: 'u',
    task_type: 'video',
    resource_pool: 'cn_video',
  });
  const deps = store.deps(1, { platformMax: { cn_video: 100 } });
  const a = await tryClaimOneQueuedTask(
    { taskId: 'dup', userId: 'u', taskType: 'video', resourcePool: 'cn_video' },
    deps,
  );
  const b = await tryClaimOneQueuedTask(
    { taskId: 'dup', userId: 'u', taskType: 'video', resourcePool: 'cn_video' },
    deps,
  );
  assert(a.ok && !b.ok, 'duplicate claim');
  assert(store.platformPools.cn_video.value === 1, 'platform=1 after dup');
  console.log('[ok] duplicate claim safe');
}

console.log('\nALL resource-pool phase1 tests passed');
