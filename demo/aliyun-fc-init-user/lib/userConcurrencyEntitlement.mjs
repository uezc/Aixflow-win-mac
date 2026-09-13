/**
 * AIXFLOW 用户并发权益（Phase 3）
 *
 * 有效额度 = 套餐默认值，可被用户级覆盖字段取代（覆盖未过期时）。
 * 不与元宝余额混用。
 *
 * 环境变量：
 *   DEFAULT_VIDEO_CONCURRENCY=5
 *   DEFAULT_IMAGE_CONCURRENCY=10
 *   DEFAULT_AUDIO_CONCURRENCY=（默认同 IMAGE）
 */

function envInt(name, fallback) {
  const n = parseInt(String(process.env[name] ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function getDefaultVideoConcurrency() {
  return Math.max(1, envInt('DEFAULT_VIDEO_CONCURRENCY', 5));
}

export function getDefaultImageConcurrency() {
  return Math.max(1, envInt('DEFAULT_IMAGE_CONCURRENCY', 10));
}

export function getDefaultAudioConcurrency() {
  return Math.max(1, envInt('DEFAULT_AUDIO_CONCURRENCY', getDefaultImageConcurrency()));
}

/**
 * 云端套餐目录（可后续迁到 OTS / 配置中心；本阶段为代码+环境可覆盖）
 * @type {Record<string, { video: number, image: number, audio: number, label: string }>}
 */
export const CONCURRENCY_PLAN_CATALOG = {
  free: {
    get video() {
      return getDefaultVideoConcurrency();
    },
    get image() {
      return getDefaultImageConcurrency();
    },
    get audio() {
      return getDefaultAudioConcurrency();
    },
    label: 'Free',
  },
  basic: { video: 5, image: 10, audio: 10, label: 'Basic' },
  pro: { video: 20, image: 40, audio: 40, label: 'Pro' },
  studio: { video: 50, image: 100, audio: 100, label: 'Studio' },
  enterprise: { video: 100, image: 100, audio: 100, label: 'Enterprise' },
};

export function normalizePlanId(raw) {
  const id = String(raw || '')
    .trim()
    .toLowerCase();
  if (!id) return 'free';
  if (CONCURRENCY_PLAN_CATALOG[id]) return id;
  return 'free';
}

/**
 * @param {string} planId
 * @returns {{ video: number, image: number, audio: number, label: string, planId: string }}
 */
export function getPlanConcurrencyLimits(planId) {
  const id = normalizePlanId(planId);
  const plan = CONCURRENCY_PLAN_CATALOG[id] || CONCURRENCY_PLAN_CATALOG.free;
  return {
    planId: id,
    label: plan.label,
    video: Math.max(1, Math.round(Number(plan.video) || getDefaultVideoConcurrency())),
    image: Math.max(1, Math.round(Number(plan.image) || getDefaultImageConcurrency())),
    audio: Math.max(1, Math.round(Number(plan.audio) || getDefaultAudioConcurrency())),
  };
}

function parseOptionalPositiveInt(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

function parseExpiresAtMs(raw) {
  if (raw === undefined || raw === null || raw === '') return 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw >= 1e11 ? Math.round(raw) : Math.round(raw * 1000);
  }
  const n = parseInt(String(raw), 10);
  if (Number.isFinite(n) && n > 0) return n >= 1e11 ? n : n * 1000;
  const d = Date.parse(String(raw));
  return Number.isFinite(d) ? d : 0;
}

/**
 * 从用户行计算当前有效并发。
 * audio 暂无独立 override 字段：优先 image override，否则套餐 audio。
 */
export function resolveEffectiveConcurrency(userLike, nowMs = Date.now()) {
  const u = userLike && typeof userLike === 'object' ? userLike : {};
  const plan = getPlanConcurrencyLimits(u.planId ?? u.plan_id);

  const expiresAt = parseExpiresAtMs(
    u.concurrencyOverrideExpiresAt ?? u.concurrency_override_expires_at,
  );
  const overrideActive = !expiresAt || expiresAt > nowMs;

  const videoOv = overrideActive
    ? parseOptionalPositiveInt(u.videoConcurrencyOverride ?? u.video_concurrency_override)
    : null;
  const imageOv = overrideActive
    ? parseOptionalPositiveInt(u.imageConcurrencyOverride ?? u.image_concurrency_override)
    : null;

  const video = videoOv != null ? videoOv : plan.video;
  const image = imageOv != null ? imageOv : plan.image;
  // 无独立 audio override：image override 生效时音频跟随 image，否则用套餐 audio
  const audio = imageOv != null ? imageOv : plan.audio;

  return {
    planId: plan.planId,
    planLabel: plan.label,
    videoConcurrencyLimit: video,
    imageConcurrencyLimit: image,
    audioConcurrencyLimit: audio,
    videoFrom: videoOv != null ? 'override' : 'plan',
    imageFrom: imageOv != null ? 'override' : 'plan',
    audioFrom: imageOv != null ? 'override' : 'plan',
    overrideExpiresAt: expiresAt || null,
    overrideActive: Boolean(overrideActive && (videoOv != null || imageOv != null)),
    concurrency: {
      video: { limit: video },
      image: { limit: image },
      audio: { limit: audio },
      plan_id: plan.planId,
      plan_label: plan.label,
    },
  };
}

/**
 * 供 /me JSON 展开（旧客户端忽略未知字段）
 */
export function concurrencyFieldsForMeResponse(userLike, nowMs = Date.now()) {
  const r = resolveEffectiveConcurrency(userLike, nowMs);
  return {
    plan_id: r.planId,
    concurrency: r.concurrency,
    video_concurrency_limit: r.videoConcurrencyLimit,
    image_concurrency_limit: r.imageConcurrencyLimit,
    audio_concurrency_limit: r.audioConcurrencyLimit,
  };
}
