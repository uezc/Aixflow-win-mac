/**
 * Smoke: Image Unified Cloud Queue wiring (static source checks)
 * node scripts/_smoke-image-queue-wiring.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

const gp = fs.readFileSync(path.join(root, 'src/shared/imageQueueGoldenPath.ts'), 'utf8');
const ip = fs.readFileSync(path.join(root, 'src/main/ai/providers/ImageProvider.ts'), 'utf8');
const panel = fs.readFileSync(
  path.join(root, 'src/renderer/components/Canvas/ImageInputPanel.tsx'),
  'utf8',
);

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(ok ? `[PASS] ${name}` : `[FAIL] ${name}`, detail);
}

const expectedModelConsts = [
  'IMAGE_QUEUE_Z_IMAGE_MODEL',
  'IMAGE_QUEUE_LENS_MODEL',
  'IMAGE_QUEUE_FLUX2_KLEIN_MODEL',
  'IMAGE_QUEUE_RHART_IMAGE_G2_MODEL',
  'IMAGE_QUEUE_BANANA_20_MODEL',
  'IMAGE_QUEUE_SEEDREAM_V5_MODEL',
  'IMAGE_QUEUE_YOUCHUAN_V81_MODEL',
  'IMAGE_QUEUE_YOUCHUAN_V82_MODEL',
  'IMAGE_QUEUE_RHART_IMAGE_G25_MODEL',
];

check(
  'IMAGE_QUEUE_ONLY_MODEL_IDS length 9',
  /IMAGE_QUEUE_ONLY_MODEL_IDS = \[([\s\S]*?)\] as const/.test(gp),
);

const onlyBlock = (gp.match(/IMAGE_QUEUE_ONLY_MODEL_IDS = \[([\s\S]*?)\] as const/) || [])[1] || '';
for (const c of expectedModelConsts) {
  check(`IMAGE_QUEUE_ONLY has ${c}`, onlyBlock.includes(c));
}

for (const m of [
  'z-image',
  'lens',
  'flux2-klein',
  'rhart-image-g-2',
  'banana-2.0',
  'seedream-v5',
  'youchuan-text-to-image-v81',
  'youchuan-text-to-image-v82',
  'rhart-image-g-2.5',
]) {
  check(`const value ${m}`, gp.includes(`'${m}'`));
}

const builders = [
  'buildZImageRhForward',
  'buildLensRhForward',
  'buildFlux2KleinRhForward',
  'buildRhartImageG2RhForward',
  'buildBanana20RhForward',
  'buildSeedreamV5RhForward',
  'buildYouchuanV81RhForward',
  'buildYouchuanV82RhForward',
  'buildRhartImageG25RhForward',
];
for (const b of builders) {
  check(`builder ${b}`, new RegExp(`export function ${b}`).test(gp));
}

const gates = [
  'isCanvasZImageQueueGoldenPathInput',
  'isCanvasLensQueueGoldenPathInput',
  'isCanvasFlux2KleinQueueGoldenPathInput',
  'isCanvasRhartImageG2QueueGoldenPathInput',
  'isCanvasBanana20QueueGoldenPathInput',
  'isCanvasSeedreamV5QueueGoldenPathInput',
  'isCanvasYouchuanV81QueueGoldenPathInput',
  'isCanvasYouchuanV82QueueGoldenPathInput',
  'isCanvasRhartImageG25QueueGoldenPathInput',
];
for (const g of gates) {
  check(`gate ${g}`, new RegExp(`export function ${g}`).test(gp));
}

check('isImageQueueGoldenPathEnabled', /export function isImageQueueGoldenPathEnabled/.test(gp));
check(
  'assertNotDirectChargeForImageQueueOnlyModel',
  /export function assertNotDirectChargeForImageQueueOnlyModel/.test(gp),
);
check('ImageQueueProviderForward type', /export type ImageQueueProviderForward/.test(gp));

check(
  'ImageProvider executeImageCloudQueueGoldenPath',
  /executeImageCloudQueueGoldenPath/.test(ip),
);
check('ImageProvider prepareHttpsImageUrlsForQueue', /prepareHttpsImageUrlsForQueue/.test(ip));
check('ImageProvider assertNotDirectCharge', /assertNotDirectChargeForImageQueueOnlyModel/.test(ip));
check('ImageProvider queue-only early reject', /已强制走云端排队，无法使用 Direct/.test(ip));

const adapters = [
  'executeZImageCloudQueueGoldenPath',
  'executeLensCloudQueueGoldenPath',
  'executeFlux2KleinCloudQueueGoldenPath',
  'executeRhartImageG2CloudQueueGoldenPath',
  'executeBanana20CloudQueueGoldenPath',
  'executeSeedreamV5CloudQueueGoldenPath',
  'executeYouchuanV81CloudQueueGoldenPath',
  'executeYouchuanV82CloudQueueGoldenPath',
  'executeRhartImageG25CloudQueueGoldenPath',
];
for (const a of adapters) {
  check(`ImageProvider ${a}`, new RegExp(a).test(ip));
}

check(
  'ImageInputPanel imports isImageQueueOnlyModel',
  /isImageQueueOnlyModel/.test(panel),
);
check(
  'ImageInputPanel sets nxCloudQueueGoldenPath',
  /nxCloudQueueGoldenPath\s*=\s*true/.test(panel),
);

const pricingFiles = [
  'demo/aliyun-fc-init-user/pricing/price_calculator.mjs',
  'demo/aliyun-fc-init-user/app/pricing/price_calculator.mjs',
  'pricing/price_calculator.mjs',
];
for (const rel of pricingFiles) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    check(`pricing exists ${rel}`, false, 'missing');
    continue;
  }
  const t = fs.readFileSync(p, 'utf8');
  check(
    `pricing fail-closed ${rel}`,
    /image_resolution_required/.test(t) &&
      (/isImageResolutionRequiredModel/.test(t) || /imageResolutionRequired/.test(t)),
  );
}

const failed = checks.filter((c) => !c.ok);
const out = path.join(__dirname, '_smoke-image-queue-wiring-result.json');
fs.writeFileSync(out, JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
console.log(failed.length === 0 ? '\nALL PASS' : `\nFAILED ${failed.length}`);
process.exit(failed.length === 0 ? 0 : 1);
