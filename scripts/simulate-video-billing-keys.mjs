/**
 * 脱水复合 Key 场景验证（需先 npm run build:main）
 *
 * GPT-4o：走图像反推专用 model_id「gpt-4o-image-reverse」，与视频计费链路区分，便于云端单独配置；
 *         若坚持空串，可改 TS 中 IMAGE_REVERSE_KEYS 去掉 gpt-4o 映射。
 */
import { buildVideoBillingModelId } from '../dist-electron/main/utils/videoBillingSku.js';

const scenarios = [
  ['1. 可灵 v2.6 Pro（5 秒 / 有声）', 'kling-v2.6-pro', { duration: '5', sound: 'true' }, 'kling-v2-6-pro-5s-audio'],
  ['2. 可灵 v2.6 Pro（10 秒 / 无声，默认档省略 noaudio）', 'kling-v2.6-pro', { duration: '10', sound: 'false' }, 'kling-v2-6-pro'],
  ['3. 海螺 02（默认分辨率 / 10 秒）', 'hailuo-02-t2v-standard', { durationHailuo02: '10' }, 'hailuo-02-10s'],
  ['4. 海螺 02（1080P / 6 秒）', 'hailuo-02-t2v-standard', { resolutionHailuo: '1080p', durationHailuo02: '6' }, 'hailuo-02-1080p-6s'],
  ['5. Veo 3.1 Pro（规格位=1080p，variant=pro）', 'rhart-v3.1-pro', { resolutionRhartV31: '1080p' }, 'veo-3-1-1080p-pro'],
  ['6. LTX 2.3 文生（10 秒 / 未选分辨率，Key 无 t2v）', 'ltx-2.3-t2v', { durationLtx23T2v: '10' }, 'ltx-2-3-10s'],
  ['7. GPT-4o 图像反推', 'gpt-4o', {}, 'gpt-4o-image-reverse'],
  ['7b. GPT-5.6 Terra 图像反推', 'openai/gpt-5.6-terra', {}, 'openai/gpt-5.6-terra-image-reverse'],
  ['8. 可灵 o1 图生（10 秒）', 'kling-video-o1-i2v', { durationKlingO1: '10' }, 'kling-o1-i2v-10s'],
  [
    '9. Wan 2.6 Flash（720p / 10 秒 / 默认有声，省略 audio）',
    'wan-2.6-flash',
    { resolutionWan26: '720p', durationWan26Flash: '10', enableAudio: true },
    'wan-2-6-flash-720p-10s',
  ],
];

console.log('========== 脱水复合 Key 场景 ==========\n');
for (const [label, model, input, expected] of scenarios) {
  const key = buildVideoBillingModelId(model, input);
  const ok = key === expected ? '✓' : '✗';
  console.log(`${label}`);
  console.log(`  预期: ${expected}`);
  console.log(`  实际: ${key}  ${ok}\n`);
}
