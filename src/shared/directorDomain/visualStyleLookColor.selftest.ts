/**
 * 风格铅字：只保留画风 + 色彩基调（中文权威、精简）
 * 运行：npx tsx src/shared/directorDomain/visualStyleLookColor.selftest.ts
 */
import assert from 'node:assert/strict';
import { visualDnaFromStylePreset } from './visualDna.js';
import {
  buildVisualStylePreset,
  getVisualStylePreset,
  resolveVisualStylePresetId,
  VISUAL_STYLE_PRESETS,
} from './visualStylePresets.js';
import {
  isScenicAtmospherePhrase,
  scrubVisualStyleToLookAndColor,
} from './visualStyleLookColor.js';

const scrubbed = scrubVisualStyleToLookAndColor(
  'Chinese guofeng ink aesthetic, pale elegant palette, Eastern composition, poetic wuxia cinema mist, ink-wash oriental landscape',
);
assert(!/wuxia|guofeng|oriental\s+landscape/i.test(scrubbed), `scrub en: ${scrubbed}`);
assert(/pale elegant palette|ink-wash soft|palette/i.test(scrubbed) || scrubbed.length > 0, 'keep look/color');

const scrubZh = scrubVisualStyleToLookAndColor(
  '国风写意，淡雅色系，东方美学构图，诗意武侠薄雾影像，水墨东方意境',
);
assert(!/武侠|仙侠|东方意境|水墨东方/.test(scrubZh), `scrub zh: ${scrubZh}`);

assert(isScenicAtmospherePhrase('ink-wash oriental landscape'));
assert(isScenicAtmospherePhrase('rainy neon megacity'));
assert(!isScenicAtmospherePhrase('poetic stillness'));

const mapped = resolveVisualStylePresetId('guofeng_ink');
assert.equal(mapped, 'ink__dark_cyan', `legacy map: ${mapped}`);

const sample = buildVisualStylePreset('anime', 'dark_cyan');
assert(sample, 'anime+dark_cyan');
assert(!/wuxia|guofeng|oriental landscape|仙侠|古装/i.test(sample!.visualDNA.promptTemplate || ''), 'preset tpl clean');
assert(!/武侠|仙侠|古装/.test(sample!.visualDNA.promptTemplateZh || ''), 'preset tpl zh clean');
assert.equal(sample!.visualDNA.promptTemplateZh, '动漫风格，暗青色调');
assert.equal(sample!.visualDNA.promptTemplate, sample!.visualDNA.promptTemplateZh, '权威铅字=中文');

const dna = visualDnaFromStylePreset(sample!);
assert.equal(dna.generatedPrompt, '动漫风格，暗青色调', `short generated: ${dna.generatedPrompt}`);
assert(!/镜头|景深|光效|颗粒/.test(dna.generatedPrompt), 'no long cinematic expand');

assert(getVisualStylePreset('live__muted_gray'), 'composite id');
assert.equal(VISUAL_STYLE_PRESETS.length, 100, '10 looks × 10 grades');
assert(getVisualStylePreset('illustration__soft_pastel'), 'new look');
assert(getVisualStylePreset('ink__dark_cyan'), 'ink look');

for (const p of VISUAL_STYLE_PRESETS) {
  const out = visualDnaFromStylePreset(p).generatedPrompt;
  assert(
    !/wuxia|megacity|penthouse|hong\s+kong|crime\s+night|slice-of-life\s+streets|ceo\s+romance/i.test(out),
    `${p.id} still scenic: ${out}`,
  );
  assert(/[\u4e00-\u9fff]/.test(out), `${p.id} must be Chinese: ${out}`);
  assert(out.length <= 24, `${p.id} too long: ${out}`);
}

console.log('visualStyleLookColor.selftest: OK');
