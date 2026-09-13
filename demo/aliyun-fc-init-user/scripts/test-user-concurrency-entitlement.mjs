/**
 * Phase 3 自测：并发权益解析（不连 OTS）
 * node demo/aliyun-fc-init-user/scripts/test-user-concurrency-entitlement.mjs
 */
import {
  resolveEffectiveConcurrency,
  getPlanConcurrencyLimits,
  concurrencyFieldsForMeResponse,
} from '../lib/userConcurrencyEntitlement.mjs';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const free = resolveEffectiveConcurrency({ planId: 'free' });
assert(free.videoConcurrencyLimit === 5, `free video got ${free.videoConcurrencyLimit}`);
assert(free.imageConcurrencyLimit === 10, `free image got ${free.imageConcurrencyLimit}`);

const pro = resolveEffectiveConcurrency({ planId: 'pro' });
assert(pro.videoConcurrencyLimit === 20, 'pro video');
assert(pro.imageConcurrencyLimit === 40, 'pro image');

const ov = resolveEffectiveConcurrency({
  planId: 'pro',
  videoConcurrencyOverride: 50,
});
assert(ov.videoConcurrencyLimit === 50, 'override video');
assert(ov.imageConcurrencyLimit === 40, 'plan image kept');
assert(ov.videoFrom === 'override', 'videoFrom');

const expired = resolveEffectiveConcurrency(
  {
    planId: 'pro',
    videoConcurrencyOverride: 50,
    concurrencyOverrideExpiresAt: Date.now() - 1000,
  },
  Date.now(),
);
assert(expired.videoConcurrencyLimit === 20, 'expired override ignored');

const down = resolveEffectiveConcurrency({ planId: 'free' });
assert(down.videoConcurrencyLimit === 5, 'downgrade');

const me = concurrencyFieldsForMeResponse({ planId: 'studio' });
assert(me.concurrency.video.limit === 50, 'me studio video');
assert(me.concurrency.image.limit === 100, 'me studio image');
assert(me.video_concurrency_limit === 50, 'flat field');
assert(me.concurrency.running === undefined, 'no fake running');

const plan = getPlanConcurrencyLimits('enterprise');
assert(plan.video === 100 && plan.image === 100, 'enterprise');

console.log('[test-user-concurrency-entitlement] OK');
