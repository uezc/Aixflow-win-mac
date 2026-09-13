/**
 * Phase 6：Claim → Charge 编排（B′ 单行原子扣款）
 *
 * Money SoT = nx_users.dr_{opHash}（与 balance 同一次 UpdateRow）
 * 禁止写 running / 调用 RunningHub / 修改 Phase 5 CAS
 */

import crypto from 'crypto';

export const CHARGE_STATUS = Object.freeze({
  PENDING: 'pending',
  CHARGED: 'charged',
  FAILED: 'failed',
  REFUNDED: 'refunded',
});

export const EXECUTION_STAGE = Object.freeze({
  AWAITING_CHARGE: 'awaiting_charge',
  CHARGED: 'charged',
  DONE: 'done',
  ERROR: 'error',
});

export function chargeOperationId(taskId) {
  return `chg_${String(taskId || '').trim()}`;
}

export function refundOperationId(taskId) {
  return `ref_${String(taskId || '').trim()}`;
}

export function opHash(operationId) {
  return crypto.createHash('sha256').update(String(operationId || '')).digest('hex').slice(0, 16);
}

export function debitReceiptCol(operationId) {
  return `dr_${opHash(operationId)}`;
}

export function refundReceiptCol(refundOpId) {
  return `rr_${opHash(refundOpId)}`;
}

export function ledgerTxIdForTask(userId, taskId) {
  const h = crypto.createHash('sha256').update(`${userId}|${taskId}`).digest('hex');
  return `idem_${h}`;
}

function logPhase6(event, fields) {
  const payload = {
    event,
    timestamp: new Date().toISOString(),
    ...fields,
  };
  console.log(JSON.stringify(payload));
}

function held(v) {
  return v === true || v === 1 || v === '1';
}

function parseQuotedCost(task) {
  if (task?.quoted_cost === undefined || task?.quoted_cost === null || task?.quoted_cost === '') {
    return { ok: false, reason: 'QUOTED_COST_MISSING' };
  }
  const n = parseInt(String(task.quoted_cost), 10);
  if (!Number.isFinite(n) || n < 0) return { ok: false, reason: 'QUOTED_COST_INVALID' };
  return { ok: true, amount: n };
}

/**
 * @param {string} taskId
 * @param {object} db  db-tablestore 模块导出
 */
export async function chargeClaimedTask(taskId, db, opts = {}) {
  const tid = String(taskId || '').trim();
  if (!tid) return { ok: false, reason: 'TASK_ID_REQUIRED' };

  const task = await db.getTaskById(tid);
  if (!task) return { ok: false, reason: 'TASK_NOT_FOUND', task_id: tid };

  const userId = String(task.user_id || '');
  const status = String(task.status || '').toLowerCase();
  let stage = String(task.execution_stage || '').toLowerCase();

  // 已 charged：幂等（以 Money SoT 为准再 finalize）
  if (status === 'claimed' && stage === EXECUTION_STAGE.CHARGED) {
    const opId = chargeOperationId(tid);
    const money = await db.getDebitReceiptSot(userId, opId);
    if (money === 'APPLIED') {
      await db.finalizePhase6ChargeArtifacts({
        taskId: tid,
        userId,
        amount: parseInt(String(task.quoted_cost ?? task.cost ?? '0'), 10) || 0,
        operationId: opId,
      });
      logPhase6('PHASE6_CHARGE_IDEMPOTENT', {
        task_id: tid,
        user_id: userId,
        amount: task.quoted_cost,
        charge_id: tid,
        operation_id: opId,
        ledger_tx_id: ledgerTxIdForTask(userId, tid),
        status: 'charged',
      });
      return { ok: true, idempotent: true, task_id: tid, execution_stage: 'charged' };
    }
  }

  if (status !== 'claimed') {
    return { ok: false, reason: 'NOT_CLAIMED', task_id: tid, status };
  }

  // 懒引导：空 stage → awaiting_charge（不改 Phase 5 claim）
  if (!stage || stage === EXECUTION_STAGE.AWAITING_CHARGE) {
    if (!stage) {
      await db.ensureTaskAwaitingCharge(tid);
      const t2 = await db.getTaskById(tid);
      stage = String(t2?.execution_stage || '').toLowerCase();
    }
  }

  if (stage !== EXECUTION_STAGE.AWAITING_CHARGE && stage !== EXECUTION_STAGE.CHARGED) {
    return { ok: false, reason: 'BAD_EXECUTION_STAGE', task_id: tid, execution_stage: stage };
  }

  if (!held(task.user_slot_held) || !held(task.platform_slot_held)) {
    return { ok: false, reason: 'SLOTS_NOT_HELD', task_id: tid };
  }
  if (!String(task.reservation_id || '').trim()) {
    return { ok: false, reason: 'RESERVATION_REQUIRED', task_id: tid };
  }

  const cost = parseQuotedCost(task);
  if (!cost.ok) {
    await failChargeAndReleaseSlots(db, task, cost.reason);
    logPhase6('PHASE6_CHARGE_FAILED', {
      task_id: tid,
      user_id: userId,
      amount: null,
      charge_id: tid,
      operation_id: chargeOperationId(tid),
      ledger_tx_id: ledgerTxIdForTask(userId, tid),
      status: 'failed',
      error_code: cost.reason,
    });
    return { ok: false, reason: cost.reason, task_id: tid, failed: true };
  }

  const amount = cost.amount;
  const operationId = chargeOperationId(tid);
  const ledgerTxId = ledgerTxIdForTask(userId, tid);
  const chargeId = tid;

  logPhase6('PHASE6_CHARGE_ATTEMPT', {
    task_id: tid,
    user_id: userId,
    amount,
    charge_id: chargeId,
    operation_id: operationId,
    ledger_tx_id: ledgerTxId,
    status: 'pending',
  });

  // 建立 / 读取 charge 行（task_id 幂等）
  const begin = await db.tryBeginTaskCharge({
    task_id: tid,
    charge_id: chargeId,
    operation_id: operationId,
    user_id: userId,
    amount,
    ledger_tx_id: ledgerTxId,
  });

  if (begin.existing?.status === CHARGE_STATUS.CHARGED) {
    await db.finalizePhase6ChargeArtifacts({ taskId: tid, userId, amount, operationId });
    logPhase6('PHASE6_CHARGE_IDEMPOTENT', {
      task_id: tid,
      user_id: userId,
      amount,
      charge_id: chargeId,
      operation_id: operationId,
      ledger_tx_id: ledgerTxId,
      status: 'charged',
    });
    return { ok: true, idempotent: true, task_id: tid };
  }

  // 已有 pending：先看 Money SoT（Crash recovery）
  const sotBefore = await db.getDebitReceiptSot(userId, operationId);
  if (sotBefore === 'APPLIED') {
    logPhase6('PHASE6_CHARGE_RECOVERY', {
      task_id: tid,
      user_id: userId,
      amount,
      charge_id: chargeId,
      operation_id: operationId,
      ledger_tx_id: ledgerTxId,
      status: 'APPLIED',
    });
    await db.finalizePhase6ChargeArtifacts({ taskId: tid, userId, amount, operationId });
    logPhase6('PHASE6_CHARGE_SUCCESS', {
      task_id: tid,
      user_id: userId,
      amount,
      charge_id: chargeId,
      operation_id: operationId,
      ledger_tx_id: ledgerTxId,
      status: 'charged',
      recovered: true,
    });
    return { ok: true, recovered: true, task_id: tid, money_sot: 'APPLIED' };
  }

  // 原子扣款（amount=0：只写 receipt）
  let debit;
  try {
    debit = await db.atomicDebitWithReceipt(userId, operationId, amount);
  } catch (e) {
    // timeout / 未知：禁止盲重扣 → 读 SoT
    const sot = await db.getDebitReceiptSot(userId, operationId);
    logPhase6('PHASE6_CHARGE_RECOVERY', {
      task_id: tid,
      user_id: userId,
      amount,
      charge_id: chargeId,
      operation_id: operationId,
      ledger_tx_id: ledgerTxId,
      status: sot,
      error_code: 'DEBIT_EXCEPTION',
      message: String(e?.message || e).slice(0, 200),
    });
    if (sot === 'APPLIED') {
      await db.finalizePhase6ChargeArtifacts({ taskId: tid, userId, amount, operationId });
      return { ok: true, recovered: true, task_id: tid, money_sot: 'APPLIED' };
    }
    // NOT_APPLIED 且不确定业务是否放弃：不释槽、不二次猜测失败；返回可重试
    return { ok: false, reason: 'DEBIT_UNCERTAIN_NOT_APPLIED', task_id: tid, money_sot: sot };
  }

  if (debit.ok) {
    await db.finalizePhase6ChargeArtifacts({ taskId: tid, userId, amount, operationId });
    logPhase6('PHASE6_CHARGE_SUCCESS', {
      task_id: tid,
      user_id: userId,
      amount,
      charge_id: chargeId,
      operation_id: operationId,
      ledger_tx_id: ledgerTxId,
      status: 'charged',
      balance: debit.balance,
    });
    return {
      ok: true,
      task_id: tid,
      amount,
      balance: debit.balance,
      money_sot: 'APPLIED',
      execution_stage: 'charged',
    };
  }

  // 条件失败：再读 SoT 区分 已应用 vs 余额不足
  const sotAfter = await db.getDebitReceiptSot(userId, operationId);
  if (sotAfter === 'APPLIED') {
    await db.finalizePhase6ChargeArtifacts({ taskId: tid, userId, amount, operationId });
    logPhase6('PHASE6_CHARGE_IDEMPOTENT', {
      task_id: tid,
      user_id: userId,
      amount,
      charge_id: chargeId,
      operation_id: operationId,
      ledger_tx_id: ledgerTxId,
      status: 'charged',
    });
    return { ok: true, idempotent: true, task_id: tid, money_sot: 'APPLIED' };
  }

  // NOT_APPLIED → 余额不足或其它条件失败
  const reason = debit.reason || 'BALANCE_INSUFFICIENT';
  await failChargeAndReleaseSlots(db, task, reason, { amount, operationId, ledgerTxId });
  logPhase6('PHASE6_CHARGE_INSUFFICIENT_BALANCE', {
    task_id: tid,
    user_id: userId,
    amount,
    charge_id: chargeId,
    operation_id: operationId,
    ledger_tx_id: ledgerTxId,
    status: 'failed',
    error_code: reason,
  });
  return { ok: false, reason, task_id: tid, failed: true, money_sot: 'NOT_APPLIED' };
}

async function failChargeAndReleaseSlots(db, task, errorCode, extra = {}) {
  const tid = task.task_id;
  const userId = task.user_id;
  const taskType = String(task.task_type || '').toLowerCase();
  const reservationId = String(task.reservation_id || '');
  let resourcePool = String(task.resource_pool || '').trim().toLowerCase();
  if (!resourcePool) {
    try {
      const { resolveResourcePoolFromTaskRow } = await import('./resourcePool.mjs');
      resourcePool =
        resolveResourcePoolFromTaskRow(task) ||
        (taskType === 'video' ? 'cn_video' : taskType === 'image' ? 'cn_image' : taskType === 'audio' ? 'audio' : '');
    } catch (_) {
      resourcePool =
        taskType === 'video' ? 'cn_video' : taskType === 'image' ? 'cn_image' : taskType === 'audio' ? 'audio' : '';
    }
  }

  try {
    await db.markTaskChargeFailed(tid, userId, errorCode, extra);
  } catch (e) {
    console.error('[phase6] markTaskChargeFailed', e?.message || e);
  }

  await db.upsertTask(tid, userId, {
    status: 'failed',
    execution_stage: EXECUTION_STAGE.ERROR,
    error_code: errorCode,
    error_msg: errorCode,
    user_slot_held: '0',
    platform_slot_held: '0',
    skip_slot_auto_release: true,
  });

  if (taskType === 'video' || taskType === 'image' || taskType === 'audio') {
    if (held(task.platform_slot_held) && resourcePool) {
      try {
        if (typeof db.releasePlatformSlotAndRefill === 'function') {
          await db.releasePlatformSlotAndRefill(resourcePool, { maxRefill: 1, kickPipeline: true });
        } else {
          await db.releasePlatformConcurrencySlot(resourcePool);
        }
      } catch (e) {
        console.error('[phase6] release platform', e?.message || e);
      }
    }
    if (held(task.user_slot_held)) {
      try {
        await db.releaseUserConcurrencySlot(userId, taskType);
      } catch (e) {
        console.error('[phase6] release user', e?.message || e);
      }
    }
  }
  if (reservationId) {
    try {
      await db.updateSlotReservation(reservationId, {
        state: 'released',
        user_slot_held: 0,
        platform_slot_held: 0,
        rollback_reason: errorCode,
      });
    } catch (_) {}
  }
}

/**
 * Crash recovery 入口
 */
export async function recoverPendingCharge(taskId, db) {
  const tid = String(taskId || '').trim();
  const task = await db.getTaskById(tid);
  if (!task) return { ok: false, reason: 'TASK_NOT_FOUND' };
  const userId = task.user_id;
  const opId = chargeOperationId(tid);
  const charge = await db.getTaskCharge(tid);
  const sot = await db.getDebitReceiptSot(userId, opId);

  if (sot === 'APPLIED') {
    const amount =
      charge?.amount != null
        ? parseInt(String(charge.amount), 10) || 0
        : parseInt(String(task.quoted_cost ?? '0'), 10) || 0;
    await db.finalizePhase6ChargeArtifacts({ taskId: tid, userId, amount, operationId: opId });
    logPhase6('PHASE6_CHARGE_RECOVERY', {
      task_id: tid,
      user_id: userId,
      amount,
      charge_id: tid,
      operation_id: opId,
      ledger_tx_id: ledgerTxIdForTask(userId, tid),
      status: 'APPLIED',
    });
    return { ok: true, money_sot: 'APPLIED', action: 'finalized' };
  }

  if (sot === 'NOT_APPLIED') {
    // 可安全用同一 operation_id 重试 charge
    return chargeClaimedTask(tid, db);
  }

  logPhase6('PHASE6_CHARGE_FAILED', {
    task_id: tid,
    user_id: userId,
    amount: charge?.amount ?? null,
    charge_id: tid,
    operation_id: opId,
    ledger_tx_id: ledgerTxIdForTask(userId, tid),
    status: 'STOP',
    error_code: 'DATA_ANOMALY',
  });
  return { ok: false, reason: 'DATA_ANOMALY_STOP', money_sot: sot };
}

/**
 * 幂等退款：Money SoT = rr_{hash} 与 balance 同 UpdateRow
 */
export async function refundTaskCharge(taskId, db) {
  const tid = String(taskId || '').trim();
  const task = await db.getTaskById(tid);
  if (!task) return { ok: false, reason: 'TASK_NOT_FOUND' };
  const userId = task.user_id;
  const charge = await db.getTaskCharge(tid);
  if (charge?.status === CHARGE_STATUS.REFUNDED) {
    logPhase6('PHASE6_REFUND_IDEMPOTENT', {
      task_id: tid,
      user_id: userId,
      amount: charge.amount,
      charge_id: tid,
      operation_id: refundOperationId(tid),
      ledger_tx_id: ledgerTxIdForTask(userId, tid),
      status: 'refunded',
    });
    return { ok: true, idempotent: true, refunded: false };
  }
  if (charge && charge.status !== CHARGE_STATUS.CHARGED) {
    return { ok: false, reason: 'CHARGE_NOT_REFUNDABLE', status: charge.status };
  }

  const debitOp = chargeOperationId(tid);
  const debitSot = await db.getDebitReceiptSot(userId, debitOp);
  if (debitSot !== 'APPLIED' && charge?.status !== CHARGE_STATUS.CHARGED) {
    return { ok: false, reason: 'NOT_CHARGED', task_id: tid };
  }

  const amount =
    charge?.amount != null
      ? parseInt(String(charge.amount), 10) || 0
      : parseInt(String(task.quoted_cost ?? task.cost ?? '0'), 10) || 0;
  if (amount < 0) return { ok: false, reason: 'INVALID_AMOUNT' };

  const refOp = refundOperationId(tid);
  const refundSot = await db.getRefundReceiptSot(userId, refOp);
  if (refundSot === 'APPLIED') {
    try {
      await db.markTaskChargeRefunded(tid);
    } catch (_) {}
    logPhase6('PHASE6_REFUND_IDEMPOTENT', {
      task_id: tid,
      user_id: userId,
      amount,
      charge_id: tid,
      operation_id: refOp,
      ledger_tx_id: ledgerTxIdForTask(userId, tid),
      status: 'refunded',
    });
    return { ok: true, idempotent: true, refunded: false, amount };
  }

  let credit;
  try {
    credit = await db.atomicCreditWithReceipt(userId, refOp, amount);
  } catch (e) {
    const sot = await db.getRefundReceiptSot(userId, refOp);
    if (sot === 'APPLIED') {
      await db.finalizePhase6RefundArtifacts({ taskId: tid, userId, amount });
      return { ok: true, recovered: true, amount };
    }
    return { ok: false, reason: 'REFUND_UNCERTAIN', money_sot: sot };
  }

  if (!credit.ok) {
    const sot = await db.getRefundReceiptSot(userId, refOp);
    if (sot === 'APPLIED') {
      await db.finalizePhase6RefundArtifacts({ taskId: tid, userId, amount });
      logPhase6('PHASE6_REFUND_IDEMPOTENT', {
        task_id: tid,
        user_id: userId,
        amount,
        charge_id: tid,
        operation_id: refOp,
        ledger_tx_id: ledgerTxIdForTask(userId, tid),
        status: 'refunded',
      });
      return { ok: true, idempotent: true, amount };
    }
    return { ok: false, reason: credit.reason || 'REFUND_CONDITION_FAIL' };
  }

  await db.finalizePhase6RefundArtifacts({ taskId: tid, userId, amount });
  logPhase6('PHASE6_REFUND_SUCCESS', {
    task_id: tid,
    user_id: userId,
    amount,
    charge_id: tid,
    operation_id: refOp,
    ledger_tx_id: ledgerTxIdForTask(userId, tid),
    status: 'refunded',
    balance: credit.balance,
  });
  return { ok: true, refunded: true, amount, balance: credit.balance };
}
