/**
 * POST /tasks/create 实现（Phase 2：状态机 + queued 入队基础能力）
 *
 * execution_mode=queue（目标）：
 *   写入 nx_tasks status=queued，不扣费、不调 RunningHub
 *
 * execution_mode=legacy（Phase 2 默认，兼容现网 Provider）：
 *   计价 + deductWithTransaction + status=pending（旧预扣费建单）
 */

import crypto from 'crypto';
import {
  TASK_STATUS,
  normalizeTaskStatus,
  resolveTaskCreateExecutionMode,
  toPublicTaskStatus,
} from './taskStatusMachine.mjs';

/**
 * @param {string} userId
 * @param {Record<string, unknown>} body
 * @param {any} dbModule
 * @param {{
 *   getFinalPrice: (modelId: string, opts: object) => number,
 *   loadNxModelConfigMapForBilling?: (db: any) => Promise<object|null>,
 * }} deps
 */
export async function handleTasksCreate(userId, body, dbModule, deps) {
  if (!deps || typeof deps.getFinalPrice !== 'function') {
    throw new Error('handleTasksCreate: getFinalPrice required');
  }
  const getFinalPrice = deps.getFinalPrice;
  const loadNxModelConfigMapForBilling = deps.loadNxModelConfigMapForBilling;

  const modelId = String(body?.model_id ?? body?.modelId ?? '').trim();
  if (!modelId) throw new Error('model_id required');

  const taskTypeRaw = String(body?.type ?? body?.task_type ?? 'image').toLowerCase();
  const taskType =
    taskTypeRaw === 'llm' || taskTypeRaw === 'image' || taskTypeRaw === 'video' || taskTypeRaw === 'audio'
      ? taskTypeRaw
      : 'image';

  const nodeData =
    body?.nodeData && typeof body.nodeData === 'object'
      ? body.nodeData
      : body?.node_data && typeof body.node_data === 'object'
        ? body.node_data
        : {};

  let params = body?.params;
  if (params === undefined || params === null) {
    params = body?.prompt_json ?? body?.promptJson ?? {};
  }
  const promptJsonStr =
    typeof params === 'string'
      ? params
      : JSON.stringify(params && typeof params === 'object' ? params : { value: params });

  const workflowRaw = body?.workflow_json ?? body?.workflowJson;
  const workflowStr =
    workflowRaw === undefined || workflowRaw === null
      ? ''
      : typeof workflowRaw === 'string'
        ? workflowRaw
        : JSON.stringify(workflowRaw);

  const executionMode = resolveTaskCreateExecutionMode(body);
  const taskId = crypto.randomUUID();

  let modelConfigMap = null;
  if (typeof loadNxModelConfigMapForBilling === 'function') {
    try {
      modelConfigMap = await loadNxModelConfigMapForBilling(dbModule);
    } catch (e) {
      console.warn('[tasks/create] listModelConfig skipped:', e?.message || e);
    }
  }

  const cost = getFinalPrice(modelId, { taskType, nodeData, modelConfigMap });

  // —— 目标路径：只入队，不扣费 ——
  if (executionMode === 'queue') {
    let providerForwardJson = '';
    const pfRaw = body?.provider_forward_json ?? body?.providerForwardJson;
    if (pfRaw != null) {
      if (typeof pfRaw === 'string') {
        providerForwardJson = pfRaw;
      } else if (typeof pfRaw === 'object') {
        providerForwardJson = JSON.stringify(pfRaw);
      }
    }

    // Phase 9.2.2：queue 模式 Dispatch 依赖 forward.path；缺则拒绝创建（legacy 不受影响）
    let forwardOk = false;
    if (providerForwardJson) {
      try {
        const o = JSON.parse(providerForwardJson);
        forwardOk = Boolean(o && typeof o === 'object' && String(o.path || '').trim());
      } catch (_) {
        forwardOk = false;
      }
    }
    if (!forwardOk) {
      const err = new Error('provider_forward_json.path required for execution_mode=queue');
      err.nxErrorCode = 'QUEUE_FORWARD_REQUIRED';
      throw err;
    }

    let forwardPath = '';
    let forwardRhRegion = '';
    try {
      const o = JSON.parse(providerForwardJson);
      forwardPath = String(o?.path || '').trim();
      forwardRhRegion = o?.rhRegion != null ? String(o.rhRegion).trim() : '';
    } catch (_) {}

    let resourcePool = '';
    try {
      const { resolveResourcePool } = await import('./resourcePool.mjs');
      resourcePool =
        resolveResourcePool(taskType, {
          path: forwardPath,
          rhRegion: forwardRhRegion || null,
          modelId,
        }) || '';
    } catch (e) {
      console.warn('[tasks/create] resolveResourcePool failed:', e?.message || e);
    }

    await dbModule.upsertTask(taskId, userId, {
      status: TASK_STATUS.QUEUED,
      cost: 0,
      amount: 0,
      task_type: taskType,
      resource_pool: resourcePool || '',
      model_id: modelId,
      quoted_cost: cost,
      prompt_json: promptJsonStr,
      ...(workflowStr ? { workflow_json: workflowStr } : {}),
      provider_forward_json: providerForwardJson,
      error_code: '',
      error_msg: '',
    });

    // 活跃投影（upsertTask 已同步；此处显式再写一次，兼容旧 db 无 hook）
    if (typeof dbModule.upsertTaskWork === 'function') {
      try {
        await dbModule.upsertTaskWork({
          task_id: taskId,
          user_id: userId,
          task_type: taskType,
          resource_pool: resourcePool || '',
          status: TASK_STATUS.QUEUED,
          model_id: modelId,
          queue_entered_at: Date.now(),
          created_at: Date.now(),
        });
      } catch (e) {
        console.warn('[tasks/create] upsertTaskWork skipped:', e?.message || e);
      }
    }

    // Phase 5→7：异步推进 promote → charge → dispatch → poll（失败不影响 create 响应）
    // skip_queue_pipeline：验收/压测可跳过 create 后异步，改由 cron 独立推进
    const skipPipeline =
      String(process.env.NX_SKIP_QUEUE_PIPELINE_ON_CREATE || '') === '1' ||
      body?.skip_queue_pipeline === true ||
      body?.skip_queue_pipeline === 1 ||
      body?.skip_queue_pipeline === '1';
    if (!skipPipeline) {
      const pipelineOpts = {
        maxClaims: Math.min(20, Math.max(1, parseInt(process.env.NX_PROMOTE_ON_CREATE_BATCH || '5', 10) || 5)),
        reconcile: false,
      };
      Promise.resolve()
        .then(async () => {
          if (typeof dbModule.runPromoteQueuedTasks === 'function') {
            const pr = await dbModule.runPromoteQueuedTasks(pipelineOpts);
            console.log(
              `[tasks/create] promote after queue: claimed=${pr?.promote?.claimed ?? 0} lease_recovered=${pr?.lease_recovery?.recovered ?? 0}`,
            );
          }
          if (typeof dbModule.runChargeClaimedTasks === 'function') {
            await dbModule.runChargeClaimedTasks({ maxTasks: pipelineOpts.maxClaims * 2 });
          }
          if (typeof dbModule.runDispatchChargedTasks === 'function') {
            await dbModule.runDispatchChargedTasks({ maxTasks: pipelineOpts.maxClaims });
          }
          if (typeof dbModule.runPollProviderTasks === 'function') {
            await dbModule.runPollProviderTasks({ maxTasks: Math.max(20, pipelineOpts.maxClaims * 2) });
          }
        })
        .catch((e) => {
          console.warn('[tasks/create] queue pipeline after create failed:', e?.message || e);
        });
    } else {
      console.log(`[tasks/create] skip_queue_pipeline=1 task=${taskId} (await cron)`);
    }

    const u = await dbModule.getUserById(userId);
    console.log(
      `[tasks/create] mode=queue task=${taskId} type=${taskType} model=${modelId} quoted=${cost} status=queued user=${userId} has_forward=${Boolean(providerForwardJson)}`,
    );
    return {
      task_id: taskId,
      status: TASK_STATUS.QUEUED,
      task_type: taskType,
      resource_pool: resourcePool || undefined,
      model_id: modelId,
      quoted_cost_coins: cost,
      cost_coins: 0,
      charged: false,
      execution_mode: 'queue',
      balance: u?.balance ?? 0,
    };
  }

  // —— Legacy：预扣费 + pending（现网 Image/Video Provider 仍依赖）——
  const billingUserTask = await dbModule.getUserById(userId);
  if (billingUserTask && typeof dbModule.assertModelCostThreshold === 'function') {
    dbModule.assertModelCostThreshold(billingUserTask, cost, taskType);
  }

  const deductResult = await dbModule.deductWithTransaction(userId, taskId, cost, {
    provider: 'task_create',
    description: `create:${modelId}`,
  });

  if (deductResult.idempotent) {
    const u = await dbModule.getUserById(userId);
    return {
      task_id: taskId,
      status: toPublicTaskStatus(TASK_STATUS.PENDING),
      task_type: taskType,
      balance: u?.balance ?? deductResult.balance,
      cost_coins: cost,
      model_id: modelId,
      charged: true,
      execution_mode: 'legacy',
      duplicate_task: true,
    };
  }

  let refunded = false;
  const safeRefund = async () => {
    if (refunded) return;
    refunded = true;
    try {
      await dbModule.refundWithLedger(userId, taskId, cost, {
        provider: 'task_create',
        description: 'task_record_failed',
      });
    } catch (re) {
      console.error('[tasks/create] refund failed', re?.message || re);
    }
  };

  try {
    await dbModule.upsertTask(taskId, userId, {
      status: TASK_STATUS.PENDING,
      cost,
      amount: cost,
      task_type: taskType,
      model_id: modelId,
      quoted_cost: cost,
      prompt_json: promptJsonStr,
      ...(workflowStr ? { workflow_json: workflowStr } : {}),
      error_code: '',
      error_msg: '',
    });
  } catch (e) {
    await safeRefund();
    throw e;
  }

  const u = await dbModule.getUserById(userId);
  console.log(
    `[tasks/create] mode=legacy task=${taskId} type=${taskType} model=${modelId} cost=${cost} status=pending user=${userId}`,
  );
  return {
    task_id: taskId,
    status: normalizeTaskStatus(TASK_STATUS.PENDING),
    task_type: taskType,
    balance: u?.balance ?? deductResult.balance,
    cost_coins: cost,
    model_id: modelId,
    charged: true,
    execution_mode: 'legacy',
  };
}
