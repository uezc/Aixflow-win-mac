/**
 * 低风险降本：空闲 Timer 探活降频 + RunningHub poll 退避。
 * 不改状态机 / 计费 / 防重 submit / OTS 胖扫。
 */

/** 空闲时两次 OTS 探活最小间隔（默认 15min；可用 NX_QUEUE_IDLE_PROBE_MS 覆盖） */
export function getQueueIdleProbeMs() {
  const n = Number(process.env.NX_QUEUE_IDLE_PROBE_MS || 900000);
  if (!Number.isFinite(n)) return 900000;
  return Math.min(3600000, Math.max(60000, Math.floor(n)));
}

/** 有活时按 Timer cron 推进；语义默认 5min（与 FC_QUEUE_TIMER_CRON=@every 5m 对齐） */
export const QUEUE_ACTIVE_TIMER_MS = 300000;

const POLL_MS_0_2 = 60_000;
const POLL_MS_2_6 = 120_000;
const POLL_MS_6_PLUS = 180_000;

/**
 * 按 running_at 起算的 poll 间隔。
 * 0～2min → 60s；2～6min → 120s；6min+ → 180s
 */
export function resolveProviderPollIntervalMs(runningAtMs, nowMs = Date.now()) {
  const start = Number(runningAtMs) || 0;
  const now = Number(nowMs) || Date.now();
  if (!start || start <= 0) return POLL_MS_0_2;
  const age = Math.max(0, now - start);
  if (age < 2 * 60_000) return POLL_MS_0_2;
  if (age < 6 * 60_000) return POLL_MS_2_6;
  return POLL_MS_6_PLUS;
}

export function resolveProviderPollIntervalSec(runningAtMs, nowMs = Date.now()) {
  return Math.round(resolveProviderPollIntervalMs(runningAtMs, nowMs) / 1000);
}

/**
 * 进程内空闲探活门闩（FC 实例级；冷启动 fail-open 立即探活）。
 * @returns {{ defer: boolean, mode: 'idle'|'active'|'unknown', idle_probe_ms: number, since_last_probe_ms: number|null }}
 */
export function decideIdleProbeDeferral(opts = {}) {
  const now = Number(opts.nowMs) || Date.now();
  const force = opts.force === true;
  const safetyWindow = opts.safetyWindow === true;
  const idleProbeMs = Number(opts.idleProbeMs) || getQueueIdleProbeMs();
  const g = (globalThis.__nxQueueIdleGate ||= {
    lastProbeAt: 0,
    mode: 'unknown',
  });

  if (force || safetyWindow) {
    return {
      defer: false,
      mode: g.mode === 'active' ? 'active' : g.mode === 'idle' ? 'idle' : 'unknown',
      idle_probe_ms: idleProbeMs,
      since_last_probe_ms: g.lastProbeAt > 0 ? now - g.lastProbeAt : null,
      reason: force ? 'force' : 'safety_window',
    };
  }

  if (g.mode === 'idle' && g.lastProbeAt > 0 && now - g.lastProbeAt < idleProbeMs) {
    return {
      defer: true,
      mode: 'idle',
      idle_probe_ms: idleProbeMs,
      since_last_probe_ms: now - g.lastProbeAt,
      reason: 'idle_probe_deferred',
    };
  }

  return {
    defer: false,
    mode: g.mode === 'active' ? 'active' : g.mode === 'idle' ? 'idle' : 'unknown',
    idle_probe_ms: idleProbeMs,
    since_last_probe_ms: g.lastProbeAt > 0 ? now - g.lastProbeAt : null,
    reason: 'probe_due',
  };
}

/** 探活结束后更新门闩 */
export function recordIdleProbeResult({ clearlyIdle, nowMs } = {}) {
  const now = Number(nowMs) || Date.now();
  const g = (globalThis.__nxQueueIdleGate ||= {
    lastProbeAt: 0,
    mode: 'unknown',
  });
  g.lastProbeAt = now;
  g.mode = clearlyIdle ? 'idle' : 'active';
  return { mode: g.mode, lastProbeAt: g.lastProbeAt };
}

/** 测试用 */
export function resetIdleProbeGateForTests() {
  globalThis.__nxQueueIdleGate = { lastProbeAt: 0, mode: 'unknown' };
}
