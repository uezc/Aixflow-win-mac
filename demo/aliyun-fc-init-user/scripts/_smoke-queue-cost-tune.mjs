/**
 * 低风险降本：空闲探活 / poll 退避 单元自检
 * 运行：node demo/aliyun-fc-init-user/scripts/_smoke-queue-cost-tune.mjs
 */
import {
  decideIdleProbeDeferral,
  recordIdleProbeResult,
  resetIdleProbeGateForTests,
  resolveProviderPollIntervalMs,
  resolveProviderPollIntervalSec,
  getQueueIdleProbeMs,
} from '../lib/queueCostTune.mjs';
import { runQueuePipeline } from '../lib/runQueuePipeline.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.log(`[FAIL] ${msg}`);
  } else {
    console.log(`[PASS] ${msg}`);
  }
}

// --- Poll intervals ---
const t0 = 1_000_000_000_000;
assert(resolveProviderPollIntervalMs(t0, t0) === 60_000, 'poll age0 → 60s');
assert(resolveProviderPollIntervalMs(t0, t0 + 119_000) === 60_000, 'poll <2min → 60s');
assert(resolveProviderPollIntervalMs(t0, t0 + 120_000) === 120_000, 'poll 2min → 120s');
assert(resolveProviderPollIntervalMs(t0, t0 + 5 * 60_000) === 120_000, 'poll 5min → 120s');
assert(resolveProviderPollIntervalMs(t0, t0 + 6 * 60_000) === 180_000, 'poll 6min → 180s');
assert(resolveProviderPollIntervalMs(t0, t0 + 30 * 60_000) === 180_000, 'poll 30min → 180s');
assert(resolveProviderPollIntervalSec(t0, t0 + 7 * 60_000) === 180, 'poll_interval=180');

// --- Idle deferral ---
resetIdleProbeGateForTests();
const d0 = decideIdleProbeDeferral({ nowMs: t0, force: false, safetyWindow: false, idleProbeMs: 300_000 });
assert(d0.defer === false, 'unknown mode first probe not deferred');

recordIdleProbeResult({ clearlyIdle: true, nowMs: t0 });
const d1 = decideIdleProbeDeferral({
  nowMs: t0 + 60_000,
  force: false,
  safetyWindow: false,
  idleProbeMs: 300_000,
});
assert(d1.defer === true && d1.mode === 'idle', 'idle within 5min deferred');

const d2 = decideIdleProbeDeferral({
  nowMs: t0 + 300_000,
  force: false,
  safetyWindow: false,
  idleProbeMs: 300_000,
});
assert(d2.defer === false, 'idle at 5min probe due');

const dForce = decideIdleProbeDeferral({
  nowMs: t0 + 60_000,
  force: true,
  safetyWindow: false,
  idleProbeMs: 300_000,
});
assert(dForce.defer === false, 'force never deferred');

recordIdleProbeResult({ clearlyIdle: false, nowMs: t0 + 400_000 });
const dActive = decideIdleProbeDeferral({
  nowMs: t0 + 430_000,
  force: false,
  safetyWindow: false,
  idleProbeMs: 300_000,
});
assert(dActive.defer === false && dActive.mode === 'active', 'active mode not deferred');

// --- Pipeline idle defer: no OTS calls ---
resetIdleProbeGateForTests();
recordIdleProbeResult({ clearlyIdle: true, nowMs: t0 });
let otsCalls = 0;
const dbStub = {
  getPlatformConcurrencyPoolSnapshot: async () => {
    otsCalls += 1;
    return { video: { running: 0 }, image: { running: 0 } };
  },
  countTaskWorkActive: async () => {
    otsCalls += 1;
    return { has_any: false, count: 0 };
  },
  runPromoteQueuedTasks: async () => {
    otsCalls += 1;
    return { promote: { claimed: 0 } };
  },
};
const r = await runQueuePipeline(dbStub, { nowMs: t0 + 60_000 });
// note: runQueuePipeline uses Date.now() not opts.nowMs for started — gate uses started from Date.now()
// So re-test with controlling gate only via decide path already covered.
// Instead call pipeline after setting gate with recent lastProbeAt relative to real now:
resetIdleProbeGateForTests();
const nowReal = Date.now();
recordIdleProbeResult({ clearlyIdle: true, nowMs: nowReal });
otsCalls = 0;
const r2 = await runQueuePipeline(dbStub, {});
assert(r2.idle_no_patrol === true, 'pipeline deferred → idle_no_patrol');
assert(r2.queue_mode === 'idle', 'pipeline queue_mode=idle');
assert(otsCalls === 0, 'deferred idle: zero OTS/db calls');
assert(!/nx_tasks/.test(JSON.stringify(r2)), 'no nx_tasks in result');

// active path still promotes
resetIdleProbeGateForTests();
otsCalls = 0;
let promoted = false;
const dbActive = {
  getPlatformConcurrencyPoolSnapshot: async () => {
    otsCalls += 1;
    return { video: { running: 1 }, image: { running: 0 } };
  },
  countTaskWorkActive: async () => {
    otsCalls += 1;
    return { has_any: true, count: 1 };
  },
  runPromoteQueuedTasks: async () => {
    promoted = true;
    return { promote: { claimed: 0 }, lease_recovery: { recovered: 0 } };
  },
  runChargeClaimedTasks: async () => ({ charged: 0 }),
  runDispatchChargedTasks: async () => ({ ok: 0 }),
  runPollProviderTasks: async () => ({ settled: 0 }),
};
const r3 = await runQueuePipeline(dbActive, {});
assert(r3.queue_mode === 'active', 'active queue_mode');
assert(promoted === true, 'active runs promote');
assert(r3.idle_no_patrol !== true, 'active not idle_no_patrol');

// --- Static: create path untouched ---
const createSrc = fs.readFileSync(path.join(root, 'lib/handleTasksCreate.mjs'), 'utf8');
assert(/runPromoteQueuedTasks/.test(createSrc), 'create still async promote');
assert(/runDispatchChargedTasks/.test(createSrc), 'create still async dispatch');

// --- Static: anti-dup / fallback / no fat scan regression ---
const pipe = fs.readFileSync(path.join(root, 'lib/providerPipeline.mjs'), 'utf8');
assert(/ALREADY_HAS_PROVIDER_TASK_ID/.test(pipe), 'anti-dup provider_task_id kept');
assert(/DISPATCH_UNKNOWN_NO_RETRY/.test(pipe), 'dispatch_unknown block kept');
assert(/poll_interval/.test(pipe), 'poll_interval logged');

const dbSrc = fs.readFileSync(path.join(root, 'lib/db-tablestore.mjs'), 'utf8');
assert(/NX_TASK_WORK_FALLBACK_ON_EMPTY/.test(dbSrc), 'FALLBACK flag still gated');
assert(/next_poll_at/.test(dbSrc), 'next_poll_at used in listRunning');
assert(/columnToGet:\s*TASK_SCAN_COLUMNS/.test(dbSrc), 'TASK_SCAN_COLUMNS still on fallback scans');

assert(getQueueIdleProbeMs() === 900000, 'default idle probe 15min');

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\n_smoke-queue-cost-tune ok');
