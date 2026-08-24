/**
 * MV 出片角色绑定：素材库第一人不得在未点名时被当成主角。
 */
import {
  createEmptyDirectorAsset,
  createDefaultDirectorPipelineState,
  ensureDirectorMvLeadSlots,
  listDirectorMvLeadAssetIds,
} from '../src/shared/directorPipeline/schema.ts';
import { matchDirectorAssetIndicesForShot, resolveDirectorShotCastAssetIds } from '../src/shared/directorPipeline/bindAssetRefs.ts';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const lu = {
  ...createEmptyDirectorAsset('character', '陆天仰', '性别：男，短发灰衣', 0, 'male'),
  imageUrl: 'https://example.com/lu.png',
  status: 'ready' as const,
};
const lead = {
  ...createEmptyDirectorAsset('character', '男主', '性别：男，东亚面孔', 1, 'male'),
  imageUrl: 'https://example.com/lead.png',
  status: 'ready' as const,
};
const ray = {
  ...createEmptyDirectorAsset('character', 'Ray 雷', '性别：男，西装', 2, 'male'),
  imageUrl: 'https://example.com/ray.png',
  status: 'ready' as const,
};

// 有图顺序：素材库第一人在前，主角槽在后（旧逻辑会误抓陆天仰）
const refs = [lu, lead, ray];
const shotMaleWalk = {
  镜号: '1',
  画面描述: '男主缓步走过雨巷，背影入画',
  出场人物: '',
  最终提示词: '',
};

const leaked = matchDirectorAssetIndicesForShot(shotMaleWalk, refs);
assert(
  !leaked.some((i) => refs[i]?.name === '陆天仰'),
  `未传主角槽时仍绑到陆天仰: ${leaked.map((i) => refs[i]?.name).join(',')}`,
);

const withLeads = matchDirectorAssetIndicesForShot(shotMaleWalk, refs, {
  leadAssetIds: [lead.id],
});
assert(
  withLeads.some((i) => refs[i]?.id === lead.id),
  `点名男主应绑主角槽，实际: ${withLeads.map((i) => refs[i]?.name).join(',')}`,
);
assert(
  !withLeads.some((i) => refs[i]?.name === '陆天仰'),
  `点名男主不应绑陆天仰: ${withLeads.map((i) => refs[i]?.name).join(',')}`,
);

const named = matchDirectorAssetIndicesForShot(
  { 镜号: '2', 画面描述: 'Ray 雷站在窗边', 出场人物: 'Ray 雷' },
  refs,
  { leadAssetIds: [lead.id] },
);
assert(
  named.some((i) => refs[i]?.name === 'Ray 雷'),
  `点名 Ray 雷应绑到该卡: ${named.map((i) => refs[i]?.name).join(',')}`,
);
assert(
  !named.some((i) => refs[i]?.name === '陆天仰'),
  `点名 Ray 雷不应绑陆天仰`,
);

let state = createDefaultDirectorPipelineState({
  mode: 'mv',
  assets: {
    characters: [lu, ray],
    scenes: [],
    props: [],
    creatures: [],
  },
  mvCastPlan: { leadCount: 1, lead1Gender: 'male', lead2Gender: 'female', userLocked: false },
});
state = ensureDirectorMvLeadSlots(state);
const names = (state.assets.characters || []).map((c) => String(c.name || ''));
assert(names[0] === '男主', `主角槽应是新建男主，实际首位: ${names.join(',')}`);
assert(names.includes('陆天仰'), `陆天仰应留在额外角色: ${names.join(',')}`);
assert(
  !listDirectorMvLeadAssetIds(state).includes(lu.id),
  `陆天仰不应进入主角槽 id 列表: ${listDirectorMvLeadAssetIds(state).join(',')}`,
);

const onlyLibrary = matchDirectorAssetIndicesForShot(shotMaleWalk, [lu], {
  leadAssetIds: ['character-lead-missing'],
});
assert(
  !onlyLibrary.some((i) => [lu][i]?.name === '陆天仰'),
  `主角槽无图时不应回退素材库第一人: ${onlyLibrary.join(',')}`,
);

const videoIdsNone = resolveDirectorShotCastAssetIds(
  { 镜号: '3', 画面描述: '雨巷空镜，无人出镜', 出场人物: '' },
  refs,
  { leadAssetIds: [lead.id], emptyShot: true },
);
assert(videoIdsNone.length === 0, `空镜不应传角色 id: ${videoIdsNone.join(',')}`);

const videoIdsLead = resolveDirectorShotCastAssetIds(shotMaleWalk, refs, {
  leadAssetIds: [lead.id],
});
assert(videoIdsLead.includes(lead.id), `出片应传男主 id`);
assert(!videoIdsLead.includes(lu.id), `出片不应传陆天仰 id: ${videoIdsLead.join(',')}`);

const videoIdsEmptyMatch = resolveDirectorShotCastAssetIds(shotMaleWalk, [lu], {
  leadAssetIds: ['missing-lead'],
});
assert(
  videoIdsEmptyMatch.length === 0,
  `匹配为空必须返回 [] 而不能 undefined/第一人: ${JSON.stringify(videoIdsEmptyMatch)}`,
);

const videoIdsLocked = resolveDirectorShotCastAssetIds(shotMaleWalk, refs, {
  castAssetIds: [lu.id],
  leadAssetIds: [lead.id],
});
assert(
  videoIdsLocked.includes(lu.id) && videoIdsLocked.length === 1,
  `用户勾选陆天仰时应只传他: ${videoIdsLocked.join(',')}`,
);

console.log('check-director-mv-cast-bind: ok');
