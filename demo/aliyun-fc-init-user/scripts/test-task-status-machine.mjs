/**
 * Phase 2 自测：任务状态机（不连 OTS）
 * 运行：node demo/aliyun-fc-init-user/scripts/test-task-status-machine.mjs
 */
import {
  TASK_STATUS,
  normalizeTaskStatus,
  toPublicTaskStatus,
  canTransitionTaskStatus,
  occupiesConcurrencySlot,
  occupiesPhase5CounterSlot,
  resolveTaskCreateExecutionMode,
  timestampsForStatusChange,
  isTerminalTaskStatus,
} from '../lib/taskStatusMachine.mjs';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(normalizeTaskStatus('PROCESSING') === TASK_STATUS.PROCESSING, 'normalize processing');
assert(toPublicTaskStatus('processing') === TASK_STATUS.RUNNING, 'public processing→running');
assert(toPublicTaskStatus('queued') === TASK_STATUS.QUEUED, 'public queued');
assert(toPublicTaskStatus('claimed') === TASK_STATUS.CLAIMED, 'public claimed');
assert(canTransitionTaskStatus('queued', 'claimed'), 'queued→claimed');
assert(!canTransitionTaskStatus('queued', 'running'), 'queued↛running');
assert(canTransitionTaskStatus('queued', 'cancelled'), 'queued→cancelled');
assert(!canTransitionTaskStatus('queued', 'success'), 'queued↛success');
assert(canTransitionTaskStatus('claimed', 'queued'), 'claimed→queued');
assert(canTransitionTaskStatus('claimed', 'running'), 'claimed→running');
assert(canTransitionTaskStatus('running', 'success'), 'running→success');
assert(canTransitionTaskStatus('running', 'failed'), 'running→failed');
assert(!canTransitionTaskStatus('success', 'running'), 'success↛running');
assert(!occupiesConcurrencySlot('queued'), 'queued no slot');
assert(occupiesConcurrencySlot('claimed'), 'claimed has slot');
assert(occupiesConcurrencySlot('running'), 'running has slot');
assert(occupiesConcurrencySlot('processing'), 'processing semantic slot');
assert(occupiesPhase5CounterSlot('claimed'), 'phase5 claimed');
assert(occupiesPhase5CounterSlot('running'), 'phase5 running');
assert(!occupiesPhase5CounterSlot('processing'), 'phase5 excludes processing');
assert(isTerminalTaskStatus('failed'), 'failed terminal');

assert(resolveTaskCreateExecutionMode({ execution_mode: 'queue' }) === 'queue', 'mode queue');
assert(resolveTaskCreateExecutionMode({ defer_charge: true }) === 'queue', 'defer→queue');
assert(resolveTaskCreateExecutionMode({ legacy_immediate_charge: true }) === 'legacy', 'legacy flag');
assert(resolveTaskCreateExecutionMode({}, { NX_TASKS_CREATE_DEFAULT_MODE: 'legacy' }) === 'legacy', 'env legacy');
assert(resolveTaskCreateExecutionMode({}, { NX_TASKS_CREATE_DEFAULT_MODE: 'queue' }) === 'queue', 'env queue');
assert(resolveTaskCreateExecutionMode({}) === 'legacy', 'default legacy');

const ts = timestampsForStatusChange('', 'queued', {}, Date.now());
assert(ts.queue_entered_at > 0, 'queue_entered_at set');
const tsClaim = timestampsForStatusChange('queued', 'claimed', { queue_entered_at: 1_700_000_000_000 }, 1_700_000_000_100);
assert(tsClaim.claimed_at === 1_700_000_000_100, 'claimed_at set');
assert(tsClaim.queue_entered_at === 1_700_000_000_000, 'keep queue_entered_at');
const ts2 = timestampsForStatusChange('claimed', 'running', { queue_entered_at: 1_700_000_000_000, claimed_at: 1_700_000_000_100 }, 1_700_000_000_200);
assert(ts2.running_at === 1_700_000_000_200, 'running_at set');
const ts3 = timestampsForStatusChange('running', 'success', { running_at: 1_700_000_000_200 }, 1_700_000_000_300);
assert(ts3.finished_at === 1_700_000_000_300, 'finished_at set');

console.log('[test-task-status-machine] OK');
