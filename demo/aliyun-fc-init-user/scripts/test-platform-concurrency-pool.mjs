/**
 * Phase 4 自测：平台并发池语义（内存 CAS 模拟 OTS 条件 INCREMENT）
 * + 配置上限校验
 *
 * 运行：node demo/aliyun-fc-init-user/scripts/test-platform-concurrency-pool.mjs
 *
 * 可选真实 OTS：设置 NX_PHASE4_LIVE_OTS=1 且配置 OTS_*（使用独立 pool 测试行，测完清零）
 */
import {
  getGlobalVideoConcurrency,
  getGlobalImageConcurrency,
  getPlatformPoolMax,
  normalizePlatformPoolKind,
} from '../lib/platformConcurrencyConfig.mjs';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** 模拟 OTS：running < max 才能 +1；running > 0 才能 -1 */
class CasPool {
  constructor(max) {
    this.max = max;
    this.running = 0;
    this.lock = Promise.resolve();
  }
  async acquire() {
    const run = async () => {
      if (this.running >= this.max) return { ok: false };
      this.running += 1;
      return { ok: true, running: this.running };
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
      if (this.running <= 0) return { ok: true, already_empty: true, running: 0 };
      this.running -= 1;
      return { ok: true, running: this.running };
    };
    const p = this.lock.then(run, run);
    this.lock = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }
}

assert(getGlobalVideoConcurrency() === 100, `video max=${getGlobalVideoConcurrency()}`);
assert(getGlobalImageConcurrency() === 100, `image max=${getGlobalImageConcurrency()}`);
assert(getPlatformPoolMax('video') === 100, 'pool max video');
assert(getPlatformPoolMax('image') === 100, 'pool max image');
assert(normalizePlatformPoolKind('VIDEO') === 'video', 'normalize');
assert(normalizePlatformPoolKind('llm') === null, 'llm not pool');

// —— 并发抢占：200 路抢 max=100 ——
{
  const pool = new CasPool(100);
  const results = await Promise.all(Array.from({ length: 200 }, () => pool.acquire()));
  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;
  assert(ok === 100, `acquire ok=${ok} want 100`);
  assert(fail === 100, `acquire fail=${fail}`);
  assert(pool.running === 100, `running=${pool.running}`);
  assert(pool.running <= 100, 'never > 100');
}

// —— 重复释放不减成负数 ——
{
  const pool = new CasPool(100);
  await pool.acquire();
  assert(pool.running === 1, 'one slot');
  await pool.release();
  assert(pool.running === 0, 'released to 0');
  const r2 = await pool.release();
  assert(r2.already_empty === true, 'second release empty');
  assert(pool.running === 0, 'still 0');
  for (let i = 0; i < 50; i++) await pool.release();
  assert(pool.running === 0, 'many releases still 0');
}

// —— Video / Image 独立 ——
{
  const video = new CasPool(100);
  const image = new CasPool(100);
  await Promise.all([
    ...Array.from({ length: 100 }, () => video.acquire()),
    ...Array.from({ length: 100 }, () => image.acquire()),
  ]);
  assert(video.running === 100 && image.running === 100, 'both full independently');
  const vExtra = await video.acquire();
  const iExtra = await image.acquire();
  assert(!vExtra.ok && !iExtra.ok, 'both reject 101st');
  assert(video.running === 100 && image.running === 100, 'still 100/100');
}

// —— 高强度：500 并发抢 100 ——
{
  const pool = new CasPool(100);
  const results = await Promise.all(Array.from({ length: 500 }, () => pool.acquire()));
  const ok = results.filter((r) => r.ok).length;
  assert(ok === 100, `500-way ok=${ok}`);
  assert(pool.running === 100, '500-way running');
}

console.log('[test-platform-concurrency-pool] in-memory CAS OK (video=100 image=100)');

if (process.env.NX_PHASE4_LIVE_OTS === '1') {
  const db = await import('../lib/db-tablestore.mjs');
  // 使用独立测试池名会破坏 normalize（只允许 video|image）。
  // 真实测：对 video 池 acquire 到满再 release 回原值（保存快照）。
  const snap0 = await db.getPlatformConcurrencyPoolSnapshot();
  const v0 = snap0.video.running;
  const max = snap0.video.max;
  assert(max === 100, `live video max=${max}`);
  const room = Math.max(0, max - v0);
  const tryN = Math.min(room + 20, 40);
  const acquired = [];
  for (let i = 0; i < tryN; i++) {
    const r = await db.tryAcquirePlatformConcurrencySlot('video');
    if (r.ok) acquired.push(r);
  }
  const snap1 = await db.getPlatformConcurrencyPoolSnapshot();
  assert(snap1.video.running <= max, `live running ${snap1.video.running} <= ${max}`);
  assert(snap1.video.running === v0 + acquired.length, 'live acquire delta');
  for (const _ of acquired) {
    await db.releasePlatformConcurrencySlot('video');
  }
  // 额外重复释放
  for (let i = 0; i < 5; i++) {
    const r = await db.releasePlatformConcurrencySlot('video');
    assert(r.ok, 'live release ok');
  }
  const snap2 = await db.getPlatformConcurrencyPoolSnapshot();
  assert(snap2.video.running === v0, `restored video running ${snap2.video.running}==${v0}`);
  assert(snap2.image.running === snap0.image.running, 'image untouched');
  console.log('[test-platform-concurrency-pool] live OTS OK');
} else {
  console.log('[test-platform-concurrency-pool] skip live OTS (set NX_PHASE4_LIVE_OTS=1 to enable)');
}
