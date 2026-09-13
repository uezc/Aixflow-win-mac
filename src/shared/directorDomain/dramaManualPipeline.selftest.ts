/**
 * 人工步骤门禁自测
 * 运行：npx tsx src/shared/directorDomain/dramaManualPipeline.selftest.ts
 */
import assert from 'node:assert/strict';
import {
  applyDramaShotH3OfficialSeal,
  isDramaH3AntiCrosstalkPrompt,
  resolveDramaProductionH3Prompt,
} from './composeDramaShotLensPrompt.js';
import {
  dramaManualPipelineBlockReason,
  dramaShotSkillMatchesLocale,
  isDramaAssetMatchDone,
  isDramaDurationSplitDone,
  isDramaSceneSplitDone,
  isDramaShotH3SkillSealed,
  isDramaVisualStyleLocked,
} from './dramaManualPipeline.js';
import { applyDramaShotZhPlainOfficialSeal } from './dramaH3PromptOptimize.js';
import { createEmptyDramaEpisodeBible } from './episodeBible.js';
import { createEmptyDramaSession, createEmptyDramaShot } from './factories.js';
import { applyVisualStyleLookGrade } from './visualStylePresets.js';
import { createEmptyDramaTimelineEvent } from './timelineEvent.js';
import { createEmptyDramaCharacter, createEmptyDramaSceneAsset } from './factories.js';
import {
  canEnterDramaUserPhase,
  domainPhaseToUserPhase,
  preferredDomainPhaseForUserPhase,
} from './userPhase.js';

let session = createEmptyDramaSession({
  active_episode_id: 'ep1',
  episodes: [{ episode_id: 'ep1', episode_no: 1, title: '1', text: '测试', analyzed: false, updated_at: 1 }],
  bible: {
    characters: [createEmptyDramaCharacter({ character_id: 'c1', name: '甲', imageUrl: 'https://x/a.png' })],
    scenes: [createEmptyDramaSceneAsset({ scene_id: 'sc1', name: '厅', imageUrl: 'https://x/s.png' })],
  },
  episode_bibles: {
    ep1: createEmptyDramaEpisodeBible({ episode_id: 'ep1' }),
  },
});

assert(!isDramaVisualStyleLocked(session), '未锁风格');
assert.equal(dramaManualPipelineBlockReason(session, 'scene_split'), '', '分场不拦风格');
assert.equal(dramaManualPipelineBlockReason(session, 'ingest'), '', '分集不拦风格');
assert.match(dramaManualPipelineBlockReason(session, 'assets'), /画风/, '素材前要风格');

assert.equal(
  preferredDomainPhaseForUserPhase(
    'script',
    createEmptyDramaSession({ episodes: [], active_episode_id: '' }),
  ),
  'ingest',
  '无分集→先分集',
);
assert.equal(preferredDomainPhaseForUserPhase('script', session), 'episodes', '有分集有选集未锁风格→分集');
assert.equal(preferredDomainPhaseForUserPhase('visual', session), 'visual', '顶部第2步→visual');
assert.equal(domainPhaseToUserPhase('visual'), 'visual', 'domain visual 映射到顶部画风色调');

assert.equal(canEnterDramaUserPhase(session, 'visual').ok, true, '有分集有选集即可进画风');
assert.equal(canEnterDramaUserPhase(session, 'assets').ok, false, '未锁风格不可进素材');

session = createEmptyDramaSession({
  ...session,
  bible: {
    ...session.bible,
    projectVisualBible: applyVisualStyleLookGrade('live', 'dark_cyan'),
  },
});
assert(isDramaVisualStyleLocked(session), '已锁风格');
assert.equal(preferredDomainPhaseForUserPhase('script', session), 'analyze', '已锁风格→剧本分析');
assert(!isDramaSceneSplitDone(session), '未分场');

session = createEmptyDramaSession({
  ...session,
  episode_bibles: {
    ep1: createEmptyDramaEpisodeBible({
      episode_id: 'ep1',
      scene_split_at: Date.now(),
      original_scenes: [{ scene_id: 's1', heading: '1', order: 1 } as any],
      original_segments: [{ segment_id: 'g1', episode_id: 'ep1', scene_id: 's1', scene_no: '1', order: 1, original_text: '甲\n“你好”', type: 'dialogue' }],
    }),
  },
});
assert(isDramaSceneSplitDone(session), '已分场');
assert.equal(dramaManualPipelineBlockReason(session, 'duration_split'), '');

session = createEmptyDramaSession({
  ...session,
  episode_bibles: {
    ep1: createEmptyDramaEpisodeBible({
      ...getEp(session),
      duration_split_at: Date.now(),
      shot_suggestions: [{ suggestion_id: 'sg1', action: '你好', duration_sec: 6 } as any],
    }),
  },
});
assert(isDramaDurationSplitDone(session), '已时长拆');
assert(!isDramaAssetMatchDone(session), '未匹配');
assert.match(dramaManualPipelineBlockReason(session, 'board'), /素材匹配/);

session = createEmptyDramaSession({
  ...session,
  episode_bibles: {
    ep1: createEmptyDramaEpisodeBible({
      ...getEp(session),
      asset_match_at: Date.now(),
      shot_suggestions: [
        {
          suggestion_id: 'sg1',
          action: '你好',
          duration_sec: 6,
          asset_match: '甲',
          visual_style: '真实风格',
        } as any,
      ],
    }),
  },
});
assert(isDramaAssetMatchDone(session), '已匹配');
assert.equal(dramaManualPipelineBlockReason(session, 'board'), '');
assert.equal(dramaManualPipelineBlockReason(session, 'generate'), '');

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
      visual_action: '甲点头',
      dialogue: '你好',
    }),
  ],
});
session = { ...session, shots: [shot] };
const sealed = applyDramaShotH3OfficialSeal(session, shot);
assert(isDramaShotH3SkillSealed(sealed), '本地密封可作回退');
assert(isDramaH3AntiCrosstalkPrompt(sealed.h3_skill_prompt || ''), '密封格式');
assert.equal(dramaShotSkillMatchesLocale(sealed, 'en'), true, '英文密封匹配 en');
assert.equal(dramaShotSkillMatchesLocale(sealed, 'zh-CN'), true, '英文 Skill 终稿中文 UI 也可上云');
const prod = resolveDramaProductionH3Prompt(session, sealed, { locale: 'en' });
assert.equal(prod, sealed.h3_skill_prompt, '英文生产用密封稿');

const zhSealed = applyDramaShotZhPlainOfficialSeal(session, shot);
assert(isDramaShotH3SkillSealed(zhSealed), '中文密封仍可识别');
assert.equal(dramaShotSkillMatchesLocale(zhSealed, 'zh-CN'), true, '中文白话算已优化');
assert.equal(dramaShotSkillMatchesLocale(zhSealed, 'en'), true, '中文白话上云可用');
const prodZh = resolveDramaProductionH3Prompt(session, zhSealed, { locale: 'zh-CN' });
assert.equal(prodZh, zhSealed.h3_skill_prompt, '中文白话可直接上云');
assert.match(prodZh, /@图片/, '中文白话保留 @图片');

console.log('dramaManualPipeline.selftest: OK');

function getEp(s: typeof session) {
  return s.episode_bibles.ep1!;
}
