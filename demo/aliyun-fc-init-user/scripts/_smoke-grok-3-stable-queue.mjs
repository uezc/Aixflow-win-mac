/**
 * Smoke: grok-3-stable → Unified Queue wiring (static source checks)
 * node scripts/_smoke-grok-3-stable-queue.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const gp = fs.readFileSync(path.join(root, 'src/shared/videoQueueGoldenPath.ts'), 'utf8');
const vp = fs.readFileSync(path.join(root, 'src/main/ai/providers/VideoProvider.ts'), 'utf8');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(ok ? `[PASS] ${name}` : `[FAIL] ${name}`, detail);
}

check(
  'VIDEO_QUEUE_GROK_3_STABLE_MODEL',
  /export const VIDEO_QUEUE_GROK_3_STABLE_MODEL = 'grok-3-stable'/.test(gp),
);
check(
  'in VIDEO_QUEUE_ONLY_MODEL_IDS',
  /VIDEO_QUEUE_ONLY_MODEL_IDS = \[[\s\S]*VIDEO_QUEUE_GROK_3_STABLE_MODEL[\s\S]*\] as const/.test(gp),
);
check('gate', /export function isCanvasGrok3StableQueueGoldenPathInput/.test(gp));
check('builder', /export function buildGrok3StableRhForward/.test(gp));
check(
  'run path',
  /GROK_3_STABLE_RUN_PATH = '\/rhart-video-g-official\/reference-to-video'/.test(gp),
);
check('rhRegion ai', /buildGrok3StableRhForward[\s\S]{0,800}rhRegion: 'ai'/.test(gp));
check('duration string helper', /normalizeGrok3StableDurationString/.test(gp));
check('VideoProvider adapter', /executeGrok3StableCloudQueueGoldenPath/.test(vp));
check('VideoProvider gate wire', /isCanvasGrok3StableQueueGoldenPathInput\(queueForcedInput\)/.test(vp));
check('VideoProvider Direct reject', /grok-3-stable 已强制云端排队/.test(vp));
check('prepare HTTPS images', /prepareGrok3StableHttpsImageUrls/.test(vp));
check('FC allowlist rhart-video-g-official', (() => {
  const t = fs.readFileSync(
    path.join(root, 'demo/aliyun-fc-init-user/lib/runningHubTarget.mjs'),
    'utf8',
  );
  return /rhart-video-g-official/.test(t);
})());

const failed = checks.filter((c) => !c.ok);
const out = path.join(__dirname, 'phase9-11-grok-3-stable-queue-smoke-result.json');
fs.writeFileSync(out, JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
console.log(failed.length === 0 ? '\nALL PASS' : `\nFAILED ${failed.length}`);
process.exit(failed.length === 0 ? 0 : 1);
