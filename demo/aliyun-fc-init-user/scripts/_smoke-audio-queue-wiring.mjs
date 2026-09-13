/**
 * Smoke: Audio/TTS Unified Cloud Queue wiring (static source checks)
 * node scripts/_smoke-audio-queue-wiring.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

const gp = fs.readFileSync(path.join(root, 'src/shared/audioQueueGoldenPath.ts'), 'utf8');
const ap = fs.readFileSync(path.join(root, 'src/main/ai/providers/AudioProvider.ts'), 'utf8');
const panel = fs.readFileSync(
  path.join(root, 'src/renderer/components/Canvas/AudioInputPanel.tsx'),
  'utf8',
);
const sched = fs.readFileSync(
  path.join(root, 'demo/aliyun-fc-init-user/lib/queueScheduler.mjs'),
  'utf8',
);
const pcc = fs.readFileSync(
  path.join(root, 'demo/aliyun-fc-init-user/lib/platformConcurrencyConfig.mjs'),
  'utf8',
);

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(ok ? `[PASS] ${name}` : `[FAIL] ${name}`, detail);
}

const expectedModelConsts = [
  'AUDIO_QUEUE_SPEECH_28_HD_MODEL',
  'AUDIO_QUEUE_INDEX_TTS2_MODEL',
  'AUDIO_QUEUE_DOUBAO_SEED_AUDIO_MODEL',
  'AUDIO_QUEUE_RHART_SONG_V55_MODEL',
  'AUDIO_QUEUE_RVC_VOICE_TRAIN_MODEL',
];

const onlyBlock = (gp.match(/AUDIO_QUEUE_ONLY_MODEL_IDS = \[([\s\S]*?)\] as const/) || [])[1] || '';
check('AUDIO_QUEUE_ONLY_MODEL_IDS length 5', expectedModelConsts.every((c) => onlyBlock.includes(c)));
for (const c of expectedModelConsts) {
  check(`AUDIO_QUEUE_ONLY has ${c}`, onlyBlock.includes(c));
}

for (const m of [
  'speech-2.8-hd',
  'index-tts2',
  'doubao-seed-audio-1.0',
  'rhart-song-v5.5',
  'rvc-voice-train',
]) {
  check(`const value ${m}`, gp.includes(`'${m}'`) || gp.includes(`"${m}"`));
}

check('ai-voice-cover NOT in AUDIO_QUEUE_ONLY', !onlyBlock.includes('ai-voice-cover'));

const builders = [
  'buildSpeech28HdRhForward',
  'buildIndexTts2RhForward',
  'buildDoubaoSeedAudioRhForward',
  'buildRhartSongV55RhForward',
  'buildRvcVoiceTrainRhForward',
];
for (const b of builders) {
  check(`builder ${b}`, new RegExp(`export function ${b}`).test(gp));
}

const gates = [
  'isCanvasSpeech28HdQueueGoldenPathInput',
  'isCanvasIndexTts2QueueGoldenPathInput',
  'isCanvasDoubaoSeedAudioQueueGoldenPathInput',
  'isCanvasRhartSongV55QueueGoldenPathInput',
  'isCanvasRvcVoiceTrainQueueGoldenPathInput',
];
for (const g of gates) {
  check(`gate ${g}`, new RegExp(`export function ${g}`).test(gp));
}

check('isAudioQueueGoldenPathEnabled', /export function isAudioQueueGoldenPathEnabled/.test(gp));
check(
  'assertNotDirectChargeForAudioQueueOnlyModel',
  /export function assertNotDirectChargeForAudioQueueOnlyModel/.test(gp),
);
check('AudioQueueProviderForward type', /export type AudioQueueProviderForward/.test(gp));

check(
  'AudioProvider executeAudioCloudQueueGoldenPath',
  /executeAudioCloudQueueGoldenPath/.test(ap),
);
check('AudioProvider queue-only early reject', /已强制走云端排队，无法使用 Direct/.test(ap));
check('AudioProvider assertNotDirectCharge', /assertNotDirectChargeForAudioQueueOnlyModel/.test(ap));
check('AudioProvider keeps ai-voice-cover local', /model === 'ai-voice-cover'/.test(ap));

const adapters = [
  'executeSpeech28HdCloudQueueGoldenPath',
  'executeIndexTts2CloudQueueGoldenPath',
  'executeDoubaoSeedAudioCloudQueueGoldenPath',
  'executeRhartSongV55CloudQueueGoldenPath',
  'executeRvcVoiceTrainCloudQueueGoldenPath',
];
for (const a of adapters) {
  check(`AudioProvider ${a}`, new RegExp(a).test(ap));
}

check(
  'AudioInputPanel imports isAudioQueueOnlyModel',
  /isAudioQueueOnlyModel/.test(panel),
);
check(
  'AudioInputPanel sets nxCloudQueueGoldenPath',
  /nxCloudQueueGoldenPath\s*=\s*true/.test(panel),
);

check(
  'normalizeQueueTaskType accepts audio',
  /t === 'video' \|\| t === 'image' \|\| t === 'audio'/.test(sched),
);
check(
  'platformConcurrencyConfig getGlobalAudioConcurrency',
  /export function getGlobalAudioConcurrency/.test(pcc),
);

const failed = checks.filter((c) => !c.ok);
const out = path.join(__dirname, '_smoke-audio-queue-wiring-result.json');
fs.writeFileSync(out, JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
console.log(failed.length === 0 ? '\nALL PASS' : `\nFAILED ${failed.length}`);
process.exit(failed.length === 0 ? 0 : 1);
