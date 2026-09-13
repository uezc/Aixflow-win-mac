/**
 * 平台全局并发资源池配置（按真实上游站点 + 能力类型拆池）
 *
 * Phase 1 池：
 *   cn_video / cn_image / overseas_video / overseas_image / audio
 *
 * 兼容别名：video→cn_video，image→cn_image（旧代码/旧任务）
 * 不引入 Redis；实际原子占用在 db-tablestore.mjs / OTS。
 *
 * Apilio / DashScope ASR / VIAPI：一期不迁入平台池。
 */

function envInt(name, fallback) {
  const n = parseInt(String(process.env[name] ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** @typedef {'cn_video'|'cn_image'|'overseas_video'|'overseas_image'|'audio'} ResourcePoolId */

export const RESOURCE_POOL = Object.freeze({
  CN_VIDEO: 'cn_video',
  CN_IMAGE: 'cn_image',
  OVERSEAS_VIDEO: 'overseas_video',
  OVERSEAS_IMAGE: 'overseas_image',
  AUDIO: 'audio',
});

/** 一期平台池全集（ensure / snapshot 默认枚举） */
export const PLATFORM_RESOURCE_POOL_IDS = Object.freeze([
  RESOURCE_POOL.CN_VIDEO,
  RESOURCE_POOL.CN_IMAGE,
  RESOURCE_POOL.OVERSEAS_VIDEO,
  RESOURCE_POOL.OVERSEAS_IMAGE,
  RESOURCE_POOL.AUDIO,
]);

/**
 * 规范化平台池 ID。接受新 ID 与旧别名 video|image。
 * @param {unknown} kind
 * @returns {ResourcePoolId|null}
 */
export function normalizePlatformPoolKind(kind) {
  const t = String(kind || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (t === 'video' || t === 'cn_video') return RESOURCE_POOL.CN_VIDEO;
  if (t === 'image' || t === 'cn_image') return RESOURCE_POOL.CN_IMAGE;
  if (t === 'overseas_video' || t === 'ai_video' || t === 'oversea_video') {
    return RESOURCE_POOL.OVERSEAS_VIDEO;
  }
  if (t === 'overseas_image' || t === 'ai_image' || t === 'oversea_image') {
    return RESOURCE_POOL.OVERSEAS_IMAGE;
  }
  if (t === 'audio') return RESOURCE_POOL.AUDIO;
  return null;
}

export function getGlobalCnVideoConcurrency() {
  return Math.max(
    1,
    envInt('GLOBAL_CN_VIDEO_CONCURRENCY', envInt('GLOBAL_VIDEO_CONCURRENCY', 100)),
  );
}

export function getGlobalCnImageConcurrency() {
  return Math.max(
    1,
    envInt('GLOBAL_CN_IMAGE_CONCURRENCY', envInt('GLOBAL_IMAGE_CONCURRENCY', 100)),
  );
}

export function getGlobalOverseasVideoConcurrency() {
  return Math.max(
    1,
    envInt('GLOBAL_OVERSEAS_VIDEO_CONCURRENCY', envInt('GLOBAL_VIDEO_CONCURRENCY', 100)),
  );
}

export function getGlobalOverseasImageConcurrency() {
  return Math.max(
    1,
    envInt('GLOBAL_OVERSEAS_IMAGE_CONCURRENCY', envInt('GLOBAL_IMAGE_CONCURRENCY', 100)),
  );
}

/** 音频池默认与国内图片同档 */
export function getGlobalAudioConcurrency() {
  return Math.max(1, envInt('GLOBAL_AUDIO_CONCURRENCY', getGlobalCnImageConcurrency()));
}

/** @deprecated 使用 getGlobalCnVideoConcurrency；保留给旧脚本 */
export function getGlobalVideoConcurrency() {
  return getGlobalCnVideoConcurrency();
}

/** @deprecated 使用 getGlobalCnImageConcurrency */
export function getGlobalImageConcurrency() {
  return getGlobalCnImageConcurrency();
}

/**
 * @param {unknown} kind
 * @returns {number}
 */
export function getPlatformPoolMax(kind) {
  const k = normalizePlatformPoolKind(kind);
  if (k === RESOURCE_POOL.CN_VIDEO) return getGlobalCnVideoConcurrency();
  if (k === RESOURCE_POOL.CN_IMAGE) return getGlobalCnImageConcurrency();
  if (k === RESOURCE_POOL.OVERSEAS_VIDEO) return getGlobalOverseasVideoConcurrency();
  if (k === RESOURCE_POOL.OVERSEAS_IMAGE) return getGlobalOverseasImageConcurrency();
  if (k === RESOURCE_POOL.AUDIO) return getGlobalAudioConcurrency();
  throw new Error(`INVALID_POOL_KIND: ${kind}`);
}

/**
 * 用户并发池仍按能力类型 video|image|audio（套餐额度），与平台 resource_pool 分离。
 * @param {unknown} taskType
 * @returns {'video'|'image'|'audio'|null}
 */
export function normalizeUserConcurrencyKind(taskType) {
  const t = String(taskType || '')
    .trim()
    .toLowerCase();
  if (t === 'video' || t === 'image' || t === 'audio') return t;
  return null;
}

/**
 * resource_pool → 用户并发任务类型
 * @param {unknown} resourcePool
 * @returns {'video'|'image'|'audio'|null}
 */
export function userTaskTypeFromResourcePool(resourcePool) {
  const k = normalizePlatformPoolKind(resourcePool);
  if (k === RESOURCE_POOL.CN_VIDEO || k === RESOURCE_POOL.OVERSEAS_VIDEO) return 'video';
  if (k === RESOURCE_POOL.CN_IMAGE || k === RESOURCE_POOL.OVERSEAS_IMAGE) return 'image';
  if (k === RESOURCE_POOL.AUDIO) return 'audio';
  return null;
}
