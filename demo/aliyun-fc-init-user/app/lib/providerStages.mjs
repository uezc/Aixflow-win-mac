/**
 * Phase 7 execution_stage / Provider 管线常量
 * 不修改 Phase 5/6 Money SoT 与 CAS。
 */

export const P7_STAGE = Object.freeze({
  CHARGED: 'charged',
  DISPATCHING: 'dispatching',
  PROVIDER_SUBMITTED: 'provider_submitted',
  SETTLING: 'settling',
  DONE: 'done',
  ERROR: 'error',
});

export const P7_DISPATCH_LEASE_MS = () => {
  const n = parseInt(String(process.env.NX_DISPATCH_LEASE_MS ?? ''), 10);
  return Number.isFinite(n) && n >= 5000 ? n : 90_000;
};

export function isPhase7PipelineStage(stage) {
  const s = String(stage || '').toLowerCase();
  return (
    s === P7_STAGE.CHARGED ||
    s === P7_STAGE.DISPATCHING ||
    s === P7_STAGE.PROVIDER_SUBMITTED ||
    s === P7_STAGE.SETTLING ||
    s === P7_STAGE.DONE
  );
}

/** 已进入 Phase7 Provider 管线：禁止 legacy run-task 再提交（允许 /query） */
export function blocksLegacyProviderSubmit(task) {
  if (!task) return false;
  const stage = String(task.execution_stage || '').toLowerCase();
  const status = String(task.status || '').toLowerCase();
  if (Number(task.dispatch_unknown) === 1) return true;
  if (String(task.provider_task_id || '').trim()) return true;
  if (
    stage === P7_STAGE.CHARGED ||
    stage === P7_STAGE.DISPATCHING ||
    stage === P7_STAGE.PROVIDER_SUBMITTED ||
    stage === P7_STAGE.SETTLING
  ) {
    return true;
  }
  // claimed+charged 语义
  if (status === 'claimed' && stage === P7_STAGE.CHARGED) return true;
  return false;
}

export function normalizeProviderStatus(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase();
}

export function isProviderTerminalSuccess(st) {
  const s = normalizeProviderStatus(st);
  return s === 'SUCCESS' || s === 'SUCCEED' || s === 'COMPLETED' || s === 'DONE';
}

export function isProviderTerminalFailed(st) {
  const s = normalizeProviderStatus(st);
  return s === 'FAILED' || s === 'FAIL' || s === 'ERROR' || s === 'CANCEL' || s === 'CANCELLED';
}

export function isProviderInFlight(st) {
  const s = normalizeProviderStatus(st);
  return (
    !s ||
    s === 'CREATE' ||
    s === 'CREATED' ||
    s === 'QUEUED' ||
    s === 'RUNNING' ||
    s === 'PENDING' ||
    s === 'PROCESSING'
  );
}
