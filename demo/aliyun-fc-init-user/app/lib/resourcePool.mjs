/**
 * 任务 → resource_pool 解析（一期：RH 国内/海外 × video/image + audio）
 *
 * 不迁入：Apilio / DashScope ASR / VIAPI（仍旁路同步路径）
 */

import {
  normalizePlatformPoolKind,
  RESOURCE_POOL,
  userTaskTypeFromResourcePool,
} from './platformConcurrencyConfig.mjs';
import {
  forceOverseasByBillingOrPath,
  pathMatchesOverseasPrefix,
  pickRunningHubTarget,
} from './runningHubTarget.mjs';

/**
 * @param {unknown} taskType
 * @returns {'video'|'image'|'audio'|null}
 */
export function normalizePooledTaskType(taskType) {
  const t = String(taskType || '')
    .trim()
    .toLowerCase();
  if (t === 'video' || t === 'image' || t === 'audio') return t;
  return null;
}

/**
 * 从 forward / model 判断 RH 站点。
 * @param {{
 *   path?: string,
 *   rhRegion?: string|null,
 *   billingModelId?: string,
 *   modelId?: string,
 * }} [opts]
 * @returns {'cn'|'ai'}
 */
export function resolveRhSiteRegion(opts = {}) {
  const hint = opts.rhRegion != null ? String(opts.rhRegion).trim().toLowerCase() : '';
  if (hint === 'ai' || hint === 'cn') return hint;
  const path = String(opts.path || '').trim();
  const billing =
    String(opts.billingModelId || opts.modelId || '')
      .trim()
      .toLowerCase() || '';
  if (forceOverseasByBillingOrPath(path, billing) || pathMatchesOverseasPrefix(path)) {
    return 'ai';
  }
  if (path) {
    try {
      const t = pickRunningHubTarget(path, { regionHint: hint || null });
      if (t?.region === 'ai' || t?.region === 'cn') return t.region;
    } catch (_) {}
  }
  return 'cn';
}

/**
 * @param {unknown} taskType
 * @param {{
 *   path?: string,
 *   rhRegion?: string|null,
 *   billingModelId?: string,
 *   modelId?: string,
 *   resourcePool?: string|null,
 * }} [opts]
 * @returns {string|null} 平台池 ID；非池化类型返回 null
 */
export function resolveResourcePool(taskType, opts = {}) {
  if (opts.resourcePool != null && String(opts.resourcePool).trim()) {
    const forced = normalizePlatformPoolKind(opts.resourcePool);
    if (forced) return forced;
  }

  const tt = normalizePooledTaskType(taskType);
  if (!tt) return null;
  if (tt === 'audio') return RESOURCE_POOL.AUDIO;

  const region = resolveRhSiteRegion(opts);
  if (tt === 'video') {
    return region === 'ai' ? RESOURCE_POOL.OVERSEAS_VIDEO : RESOURCE_POOL.CN_VIDEO;
  }
  return region === 'ai' ? RESOURCE_POOL.OVERSEAS_IMAGE : RESOURCE_POOL.CN_IMAGE;
}

/**
 * 缺省 resource_pool 的旧任务：用 task_type（+ 可选 model）兜底。
 * @param {{
 *   task_type?: string,
 *   taskType?: string,
 *   resource_pool?: string,
 *   resourcePool?: string,
 *   model_id?: string,
 *   modelId?: string,
 *   provider_forward_json?: string,
 *   path?: string,
 *   rhRegion?: string,
 * }} row
 * @returns {string|null}
 */
export function resolveResourcePoolFromTaskRow(row = {}) {
  const existing = row.resource_pool ?? row.resourcePool;
  if (existing != null && String(existing).trim()) {
    return normalizePlatformPoolKind(existing);
  }
  const taskType = row.task_type ?? row.taskType;
  let path = row.path != null ? String(row.path) : '';
  let rhRegion = row.rhRegion != null ? String(row.rhRegion) : '';
  const pf = row.provider_forward_json;
  if ((!path || !rhRegion) && pf) {
    try {
      const o = typeof pf === 'string' ? JSON.parse(pf) : pf;
      if (o && typeof o === 'object') {
        if (!path) path = String(o.path || '').trim();
        if (!rhRegion && o.rhRegion != null) rhRegion = String(o.rhRegion).trim();
      }
    } catch (_) {}
  }
  return resolveResourcePool(taskType, {
    path,
    rhRegion: rhRegion || null,
    modelId: row.model_id ?? row.modelId,
  });
}

export { RESOURCE_POOL, userTaskTypeFromResourcePool, normalizePlatformPoolKind };
