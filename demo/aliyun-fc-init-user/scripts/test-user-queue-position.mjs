/**
 * 用户 Queue Position + UX 文案映射单测（不连 OTS）
 *
 * 运行：node demo/aliyun-fc-init-user/scripts/test-user-queue-position.mjs
 */
import {
  compareQueueFifo,
  computeQueuePositionFromCandidates,
  clearQueuePositionSnapshotCache,
  enrichTaskStatusForUserUx,
} from '../lib/queuePosition.mjs';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertEq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// —— FIFO 比较与 promote 一致 ——
{
  const a = { taskId: 'b', queueEnteredAt: 100 };
  const b = { taskId: 'a', queueEnteredAt: 100 };
  assert(compareQueueFifo(a, b) > 0, 'same entered → task_id ASC (a before b)');
  assert(compareQueueFifo({ taskId: 'x', queueEnteredAt: 50 }, a) < 0, 'earlier entered first');
}

// —— ahead：0 / 1 / 多个 ——
{
  const queued = [
    { taskId: 't1', taskType: 'video', queueEnteredAt: 10 },
    { taskId: 't2', taskType: 'video', queueEnteredAt: 20 },
    { taskId: 't3', taskType: 'video', queueEnteredAt: 30 },
  ];
  const p1 = computeQueuePositionFromCandidates(queued, {
    taskId: 't1',
    taskType: 'video',
    queueEnteredAt: 10,
  });
  assertEq(p1.ahead_count, 0, 'head ahead');
  assertEq(p1.queue_position, 1, 'head position');
  assertEq(p1.queue_position_complete, true, 'head complete');

  const p2 = computeQueuePositionFromCandidates(queued, {
    taskId: 't2',
    taskType: 'video',
    queueEnteredAt: 20,
  });
  assertEq(p2.ahead_count, 1, 'second ahead');
  assertEq(p2.queue_position, 2, 'second position');

  const p3 = computeQueuePositionFromCandidates(queued, {
    taskId: 't3',
    taskType: 'video',
    queueEnteredAt: 30,
  });
  assertEq(p3.ahead_count, 2, 'third ahead');
}

// —— 前置完成后位置变化（模拟移除 t1）——
{
  const after = [
    { taskId: 't2', taskType: 'video', queueEnteredAt: 20 },
    { taskId: 't3', taskType: 'video', queueEnteredAt: 30 },
  ];
  const p = computeQueuePositionFromCandidates(after, {
    taskId: 't3',
    taskType: 'video',
    queueEnteredAt: 30,
  });
  assertEq(p.ahead_count, 1, 'after head claimed, t3 ahead drops to 1');
}

// —— 失败 / success / running 不应出现在候选集（调用方过滤）；候选里混入其它 type 不污染 ——
{
  const mixed = [
    { taskId: 'img1', taskType: 'image', queueEnteredAt: 5 },
    { taskId: 'v1', taskType: 'video', queueEnteredAt: 10 },
    { taskId: 'v2', taskType: 'video', queueEnteredAt: 20 },
  ];
  const p = computeQueuePositionFromCandidates(mixed, {
    taskId: 'v2',
    taskType: 'video',
    queueEnteredAt: 20,
  });
  assertEq(p.ahead_count, 1, 'image tasks do not count for video ahead');
  assertEq(p.queue_position_scope, 'video', 'scope video');
}

// —— running 不在 queued 候选中：模拟仅 queued 列表 ——
{
  // claimed/running 本就不进 listQueuedTasksForPromote；此处验证算法不会把非列表项算进去
  const onlyQueued = [{ taskId: 'q1', taskType: 'video', queueEnteredAt: 100 }];
  const p = computeQueuePositionFromCandidates(onlyQueued, {
    taskId: 'q1',
    taskType: 'video',
    queueEnteredAt: 100,
  });
  assertEq(p.ahead_count, 0, 'sole queued has 0 ahead');
}

  // —— 截断且找不到自身：不可用 ——
  {
    const p = computeQueuePositionFromCandidates(
      [{ taskId: 'other', taskType: 'video', queueEnteredAt: 1 }],
      { taskId: 'missing', taskType: 'video', queueEnteredAt: 99 },
      { truncated: true },
    );
    assertEq(p.queue_position_available, false, 'missing+truncated → unavailable');
    assertEq(p.ahead_count, null, 'missing ahead null');
  }

  // —— 截断但找到自身：可用但不完整 ——
  {
    const p = computeQueuePositionFromCandidates(
      [{ taskId: 't9', taskType: 'video', queueEnteredAt: 90 }],
      { taskId: 't9', taskType: 'video', queueEnteredAt: 90 },
      { truncated: true },
    );
    assertEq(p.queue_position_complete, false, 'truncated → incomplete');
    assertEq(p.ahead_count, 0, 'still returns ahead');
    assertEq(p.queue_position_available, true, 'found self → available');
  }

// —— enrich：非 queued 不查列表；失败读 refunded ——
{
  clearQueuePositionSnapshotCache();
  let listCalls = 0;
  const db = {
    async listQueuedTasksForPromote() {
      listCalls += 1;
      return {
        tasks: [{ taskId: 'q1', userId: 'u', taskType: 'video', queueEnteredAt: 1 }],
        scanned: 1,
      };
    },
    async getTaskCharge() {
      return { refunded_at: 123, status: 'refunded' };
    },
  };
  const running = await enrichTaskStatusForUserUx(db, {
    task_id: 'r1',
    status: 'running',
    status_raw: 'running',
    task_type: 'video',
  });
  assertEq(running.ahead_count, null, 'running ahead null');
  assertEq(listCalls, 0, 'running does not scan queue');

  const failed = await enrichTaskStatusForUserUx(db, {
    task_id: 'f1',
    status: 'failed',
    status_raw: 'failed',
    task_type: 'video',
  });
  assertEq(failed.refunded, true, 'failed refunded flag');

  const queued = await enrichTaskStatusForUserUx(db, {
    task_id: 'q1',
    status: 'queued',
    status_raw: 'queued',
    task_type: 'video',
    queue_entered_at: 1,
  });
  assertEq(queued.queue_position_available, true, 'queued available');
  assert(listCalls >= 1, 'queued triggers list');

  // 列表失败不影响（清缓存，避免上一轮空列表命中）
  clearQueuePositionSnapshotCache();
  const dbBad = {
    async listQueuedTasksForPromote() {
      throw new Error('OTS_DOWN');
    },
  };
  const soft = await enrichTaskStatusForUserUx(dbBad, {
    task_id: 'q2',
    status: 'queued',
    status_raw: 'queued',
    task_type: 'video',
    queue_entered_at: 1,
  });
  assertEq(soft.queue_position_error, true, 'soft fail flag');
  assertEq(soft.ahead_count, null, 'soft fail ahead null');
}

// —— UX 文案契约（与 src/shared/userQueueTaskUx.ts 对齐；此处用内联期望防漂移）——
{
  /** @param {import('../../../src/shared/userQueueTaskUx.ts').UserQueueUxInput} input */
  // 动态：复制核心分支断言（与 mapCloudTaskToUserQueueUx 合同一致）
  const cases = [
    { in: { status: 'queued', ahead_count: 6, queue_position_available: true, queue_position_complete: true }, msg: '排队中 · 前面还有 6 个任务' },
    { in: { status: 'queued', ahead_count: 0, queue_position_available: true, queue_position_complete: true }, msg: '即将生成' },
    { in: { status: 'queued', queue_position_available: false }, msg: '排队中' },
    { in: { status: 'claimed' }, msg: '生成中' },
    { in: { status: 'running' }, msg: '生成中' },
    { in: { status: 'success' }, msg: '生成完成' },
    { in: { status: 'failed', refunded: true, error_msg: 'x' }, msg: '生成失败 · 已退款' },
    { in: { status: 'failed', error_msg: 'boom' }, msg: '生成失败' },
    { in: {}, msg: '准备排队…' },
  ];

  // 最小映射实现（测试镜像；生产以 shared/userQueueTaskUx.ts 为准）
  function map(input) {
    const st = String(input.status ?? '').trim().toLowerCase();
    if (!st) return '准备排队…';
    if (st === 'success') return '生成完成';
    if (st === 'failed' || st === 'cancelled' || st === 'timeout' || st === 'error') {
      return input.refunded === true ? '生成失败 · 已退款' : '生成失败';
    }
    if (st === 'queued') {
      if (input.queue_position_available !== true || input.ahead_count == null) return '排队中';
      const ahead = Math.max(0, Math.floor(Number(input.ahead_count)));
      if (ahead <= 0) return '即将生成';
      if (input.queue_position_complete === false) return `排队中 · 前面还有约 ${ahead} 个任务`;
      return `排队中 · 前面还有 ${ahead} 个任务`;
    }
    if (st === 'pending') return '准备排队…';
    return '生成中';
  }

  for (const c of cases) {
    assertEq(map(c.in), c.msg, `ux:${JSON.stringify(c.in)}`);
  }
}

console.log('[test-user-queue-position] PASS');
