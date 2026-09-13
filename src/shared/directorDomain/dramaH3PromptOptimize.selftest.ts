/**
 * 短剧 H3 Skill 提示词优化消息组装自测（不调 LLM）
 * 运行：npx tsx src/shared/directorDomain/dramaH3PromptOptimize.selftest.ts
 */
import assert from 'node:assert/strict';
import {
  applyDramaShotH3SkillOptimizeResult,
  applyDramaShotZhPlainOfficialSeal,
  applyDramaShotZhPlainOptimizeResult,
  buildDramaShotH3SkillOptimizeMessages,
  buildDramaShotZhPlainOptimizeMessages,
  isDramaZhPlainOptimizedPrompt,
} from './dramaH3PromptOptimize.js';
import { isDramaH3AntiCrosstalkPrompt } from './composeDramaShotLensPrompt.js';
import { createEmptyDramaSession, createEmptyDramaShot, createEmptyDramaCharacter } from './factories.js';
import { createEmptyDramaTimelineEvent } from './timelineEvent.js';

const session = createEmptyDramaSession({
  bible: {
    characters: [
      createEmptyDramaCharacter({ character_id: 'c1', name: '甲', imageUrl: 'https://x/a.png' }),
    ],
  },
  shots: [],
});

const shot = createEmptyDramaShot({
  shot_id: 's1',
  shot_no: '1',
  duration_sec: 6,
  character_ids: ['c1'],
  timeline_events: [
    createEmptyDramaTimelineEvent({
      event_id: 'e1',
      start_sec: 0,
      end_sec: 6,
      visual_action: '甲走近镜头',
      dialogue: '你好',
    }),
  ],
});

const built = buildDramaShotH3SkillOptimizeMessages({
  session,
  shot,
  skillMd: '# skill',
  guideText: 'guide',
  videoModel: 'minimax-h3-multi',
});

assert.equal(built.structure, 'ref');
assert.ok(built.sourcePrompt.length > 20, '有 Compiler 源稿');
assert.ok(built.systemPrompt.includes('skill') || built.systemPrompt.includes('Skill'), '含 Skill');
assert.ok(built.userPrompt.includes(built.sourcePrompt.slice(0, 40)), 'user 含源稿');
assert.ok(/DRAMA SHORT-FORM HARD LOCKS/.test(built.userPrompt), '含短剧硬锁');

const fakeSkillOut = [
  'subject_definitions:',
  '<Subject 1> Character Jia',
  '',
  'summary:',
  'A short greeting.',
  '',
  'retention_analysis:',
  'Keep face.',
  '',
  'detailed_description:',
  '[Shot 1] At 00:00.000 <Subject 1> (S1), using the voice timbre referenced from <Audio 1> says: <d>[Chinese]你好</d>',
  '',
  'overall_soundscape:',
  'Room tone.',
  '',
  'non_diegetic_music:',
  'N/A',
].join('\n');

const applied = applyDramaShotH3SkillOptimizeResult(
  session,
  shot,
  fakeSkillOut,
  built.sourcePrompt,
  'ref',
);
assert.ok(String(applied.h3_skill_prompt || '').length > 20, '写回优化稿');
assert.equal(applied.h3_skill_prompt_from, built.sourcePrompt);
assert.ok(
  isDramaH3AntiCrosstalkPrompt(applied.h3_skill_prompt || '') ||
    /subject_definitions/i.test(applied.h3_skill_prompt || ''),
  '优化稿结构可用',
);

{
  const zhBuilt = buildDramaShotZhPlainOptimizeMessages({ session, shot });
  assert.ok(/@图片|风格色调|剧情/.test(zhBuilt.sourcePrompt), '中文源稿结构');
  assert.ok(/中文白话/.test(zhBuilt.systemPrompt), '中文润色 system');
  const zhFake = [
    '@图片1 是甲。',
    '风格色调：需要写实真实风格，暗青色色调。',
    '剧情：',
    '内景 房间 - 日',
    '',
    '甲走近镜头。',
    '',
    '甲',
    '你好',
  ].join('\n');
  const zhApplied = applyDramaShotZhPlainOptimizeResult(session, shot, zhFake, zhBuilt.sourcePrompt);
  assert.ok(isDramaZhPlainOptimizedPrompt(zhApplied.h3_skill_prompt || ''), '中文优化稿合格');
  assert.equal(zhApplied.h3_skill_prompt_from, zhBuilt.sourcePrompt);
  const zhSeal = applyDramaShotZhPlainOfficialSeal(session, shot);
  assert.ok(isDramaZhPlainOptimizedPrompt(zhSeal.h3_skill_prompt || ''), '中文本地密封');
}

console.log('dramaH3PromptOptimize.selftest: ok');
