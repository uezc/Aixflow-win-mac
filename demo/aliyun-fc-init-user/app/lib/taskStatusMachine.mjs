/**
 * AIXFLOW 云端任务状态机（Phase 2 + Phase 5 claimed）
 *
 * 正式生命周期：
 *   queued → claimed → running → success | failed | cancelled
 *
 * Phase 5 仅允许推进：queued → claimed（及 lease 回收 claimed → queued）
 * Phase 5 严禁写入 running（由 Phase 7 负责）。
 *
 * 兼容旧值：
 *   pending / processing 视为历史别名（读时归一；写时尽量迁到正式状态）
 */

export const TASK_STATUS = Object.freeze({
  QUEUED: 'queued',
  CLAIMED: 'claimed',
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  /** @deprecated 旧 /tasks/create 预扣费建单 */
  PENDING: 'pending',
  /** @deprecated 旧 LLM/转发 PROCESSING 写法 */
  PROCESSING: 'processing',
});

/** 正式对外状态（不含 deprecated 别名） */
export const TASK_STATUS_CANONICAL = Object.freeze([
  TASK_STATUS.QUEUED,
  TASK_STATUS.CLAIMED,
  TASK_STATUS.RUNNING,
  TASK_STATUS.SUCCESS,
  TASK_STATUS.FAILED,
  TASK_STATUS.CANCELLED,
]);

const ALLOWED = new Map([
  [
    TASK_STATUS.QUEUED,
    new Set([TASK_STATUS.CLAIMED, TASK_STATUS.FAILED, TASK_STATUS.CANCELLED]),
  ],
  [
    TASK_STATUS.CLAIMED,
    new Set([
      TASK_STATUS.QUEUED, // lease 到期回队
      TASK_STATUS.RUNNING, // Phase 7
      TASK_STATUS.FAILED,
      TASK_STATUS.CANCELLED,
      TASK_STATUS.CLAIMED,
    ]),
  ],
  [
    TASK_STATUS.RUNNING,
    new Set([TASK_STATUS.SUCCESS, TASK_STATUS.FAILED, TASK_STATUS.CANCELLED, TASK_STATUS.RUNNING]),
  ],
  // legacy：预扣费后等待 Provider / 转发
  [
    TASK_STATUS.PENDING,
    new Set([
      TASK_STATUS.QUEUED,
      TASK_STATUS.CLAIMED,
      TASK_STATUS.RUNNING,
      TASK_STATUS.SUCCESS,
      TASK_STATUS.FAILED,
      TASK_STATUS.CANCELLED,
      TASK_STATUS.PENDING,
    ]),
  ],
  [
    TASK_STATUS.PROCESSING,
    new Set([TASK_STATUS.RUNNING, TASK_STATUS.SUCCESS, TASK_STATUS.FAILED, TASK_STATUS.CANCELLED]),
  ],
  [TASK_STATUS.SUCCESS, new Set([TASK_STATUS.SUCCESS])],
  [TASK_STATUS.FAILED, new Set([TASK_STATUS.FAILED, TASK_STATUS.QUEUED])], // 允许未来重入队
  [TASK_STATUS.CANCELLED, new Set([TASK_STATUS.CANCELLED])],
]);

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeTaskStatus(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (!s) return TASK_STATUS.QUEUED;
  if (s === 'process' || s === 'processing') return TASK_STATUS.PROCESSING;
  if (s === 'timeout') return TASK_STATUS.FAILED;
  if (s === 'error' || s === 'err') return TASK_STATUS.FAILED;
  if (s === 'canceled') return TASK_STATUS.CANCELLED;
  if (s === 'done' || s === 'ok' || s === 'completed' || s === 'complete') return TASK_STATUS.SUCCESS;
  return s;
}

/**
 * 对外/调度视角：把 legacy 别名映射到正式状态。
 * pending（已扣费待转发）在调度语义上接近 running 前夜，但未 claim slot → 仍暴露为 pending，
 * 新队列任务一律 queued。
 * @param {unknown} raw
 */
export function toPublicTaskStatus(raw) {
  const st = normalizeTaskStatus(raw);
  if (st === TASK_STATUS.PROCESSING) return TASK_STATUS.RUNNING;
  return st;
}

export function isTerminalTaskStatus(raw) {
  const st = normalizeTaskStatus(raw);
  return st === TASK_STATUS.SUCCESS || st === TASK_STATUS.FAILED || st === TASK_STATUS.CANCELLED;
}

export function isInFlightTaskStatus(raw) {
  const st = normalizeTaskStatus(raw);
  return (
    st === TASK_STATUS.QUEUED ||
    st === TASK_STATUS.CLAIMED ||
    st === TASK_STATUS.RUNNING ||
    st === TASK_STATUS.PENDING ||
    st === TASK_STATUS.PROCESSING
  );
}

/**
 * 是否占用用户/平台并发槽位（业务语义）。
 * Phase 5 正式计入：claimed + running。
 * legacy processing 视为 running 别名，仅用于「任务仍在飞」语义；
 * 但 Phase 5 的 User/Platform CAS 计数器只在 queued→claimed 路径增减，
 * legacy processing 从未 acquire，故 counter 对账请用 occupiesPhase5CounterSlot。
 * @param {unknown} raw
 */
export function occupiesConcurrencySlot(raw) {
  const st = normalizeTaskStatus(raw);
  return (
    st === TASK_STATUS.CLAIMED ||
    st === TASK_STATUS.RUNNING ||
    st === TASK_STATUS.PROCESSING
  );
}

/**
 * Phase 5 计数器应对齐的任务：仅 claimed / running。
 * 不含 processing（legacy 未走 CAS，不能当作 counter actual）。
 * @param {unknown} raw
 */
export function occupiesPhase5CounterSlot(raw) {
  const st = normalizeTaskStatus(raw);
  return st === TASK_STATUS.CLAIMED || st === TASK_STATUS.RUNNING;
}

/**
 * @param {unknown} fromRaw
 * @param {unknown} toRaw
 */
export function canTransitionTaskStatus(fromRaw, toRaw) {
  const from = normalizeTaskStatus(fromRaw);
  const to = normalizeTaskStatus(toRaw);
  if (from === to) return true;
  const allowed = ALLOWED.get(from);
  if (!allowed) return false;
  return allowed.has(to);
}

/**
 * @param {unknown} fromRaw
 * @param {unknown} toRaw
 * @returns {{ ok: true } | { ok: false, from: string, to: string, message: string }}
 */
export function assertCanTransitionTaskStatus(fromRaw, toRaw) {
  const from = normalizeTaskStatus(fromRaw);
  const to = normalizeTaskStatus(toRaw);
  if (canTransitionTaskStatus(from, to)) return { ok: true };
  return {
    ok: false,
    from,
    to,
    message: `INVALID_TASK_STATUS_TRANSITION: ${from} → ${to}`,
  };
}

/**
 * 解析 /tasks/create 执行模式。
 *
 * - queue：只入队 queued，不扣费、不调 RunningHub（目标架构）
 * - legacy：保持旧行为：扣费 + pending（Phase 2 默认，待 Phase 6/7 迁移 Provider）
 *
 * @param {Record<string, unknown> | null | undefined} body
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {'queue' | 'legacy'}
 */
export function resolveTaskCreateExecutionMode(body, env = process.env) {
  const b = body && typeof body === 'object' ? body : {};
  const explicit = String(
    b.execution_mode ?? b.executionMode ?? b.create_mode ?? b.createMode ?? '',
  )
    .trim()
    .toLowerCase();
  if (explicit === 'queue' || explicit === 'queued' || explicit === 'enqueue') return 'queue';
  if (explicit === 'legacy' || explicit === 'charge' || explicit === 'immediate') return 'legacy';

  if (b.legacy_immediate_charge === true || b.legacyImmediateCharge === true) return 'legacy';
  if (b.defer_charge === true || b.deferCharge === true || b.enqueue_only === true) return 'queue';

  const envDefault = String(env.NX_TASKS_CREATE_DEFAULT_MODE || 'legacy')
    .trim()
    .toLowerCase();
  if (envDefault === 'queue' || envDefault === 'queued') return 'queue';
  return 'legacy';
}

/**
 * 状态变更时补时间戳字段（毫秒）。
 * @param {string} prevStatus
 * @param {string} nextStatus
 * @param {Record<string, unknown>} prevAttrs
 * @param {number} nowMs
 */
export function timestampsForStatusChange(prevStatus, nextStatus, prevAttrs, nowMs) {
  const prev = normalizeTaskStatus(prevStatus);
  const next = normalizeTaskStatus(nextStatus);
  const out = {};
  const prevQueue = toTaskTsMs(prevAttrs?.queue_entered_at, 0);
  const prevClaimed = toTaskTsMs(prevAttrs?.claimed_at, 0);
  const prevRun = toTaskTsMs(prevAttrs?.running_at, 0);
  const prevFin = toTaskTsMs(prevAttrs?.finished_at, 0);

  if (next === TASK_STATUS.QUEUED && !prevQueue) {
    out.queue_entered_at = nowMs;
  } else if (prevQueue) {
    out.queue_entered_at = prevQueue;
  }

  if (next === TASK_STATUS.CLAIMED && prev !== TASK_STATUS.CLAIMED) {
    out.claimed_at = nowMs;
  } else if (prevClaimed && next === TASK_STATUS.CLAIMED) {
    out.claimed_at = prevClaimed;
  } else if (prevClaimed && next !== TASK_STATUS.QUEUED) {
    // 保留历史 claimed_at，除非 lease 回队清空
    out.claimed_at = prevClaimed;
  }

  if (
    (next === TASK_STATUS.RUNNING || next === TASK_STATUS.PROCESSING) &&
    prev !== TASK_STATUS.RUNNING &&
    prev !== TASK_STATUS.PROCESSING
  ) {
    out.running_at = nowMs;
  } else if (prevRun) {
    out.running_at = prevRun;
  }

  if (isTerminalTaskStatus(next) && prev !== next) {
    out.finished_at = nowMs;
  } else if (prevFin && isTerminalTaskStatus(next)) {
    out.finished_at = prevFin;
  }

  return out;
}

function toTaskTsMs(v, fallback = 0) {
  if (v == null || v === '') return fallback;
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v <= 0) return fallback;
    // 秒级时间戳约 1e9；毫秒约 1e12。阈值 1e11 区分。
    return v >= 1e11 ? Math.round(v) : Math.round(v * 1000);
  }
  if (typeof v === 'object' && v && typeof v.toNumber === 'function') {
    try {
      const n = v.toNumber();
      if (Number.isFinite(n) && n > 0) return n >= 1e11 ? Math.round(n) : Math.round(n * 1000);
    } catch {
      /* ignore */
    }
  }
  const n = parseInt(String(v), 10);
  if (Number.isFinite(n) && n > 0) return n >= 1e11 ? n : n * 1000;
  const d = Date.parse(String(v));
  return Number.isFinite(d) ? d : fallback;
}
