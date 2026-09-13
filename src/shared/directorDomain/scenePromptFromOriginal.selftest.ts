/**
 * 场景提示词保真：原文陈设必须进卡、进生图。
 * 运行：npx tsx src/shared/directorDomain/scenePromptFromOriginal.selftest.ts
 */
import { composeDramaSceneDesignPrompt } from './characterDesignPrompt.js';
import { buildDirectorSceneImagePrompt } from '../directorPipeline/assetImagePrompts.js';
import { createEmptyDramaEpisodeBible } from './episodeBible.js';
import { createEmptyDramaSceneAsset, createEmptyDramaSession } from './factories.js';
import { enrichDramaSceneAssetFromOriginal, extractDramaSceneEnvFactsFromOriginal, } from './scenePromptFromOriginal.js';
function assert(cond, msg) {
    if (!cond)
        throw new Error(msg);
}
function scene(partial) {
    return {
        scene_id: partial.scene_id,
        episode_id: 'ep1',
        scene_number: 1,
        scene_no: '01',
        location_type: partial.location_type || 'INT',
        location: partial.location,
        time: partial.time || '夜',
        original_heading: `【S01 ${partial.location}】`,
        order: 1,
    };
}
const segments = [
    {
        segment_id: 'seg1',
        episode_id: 'ep1',
        scene_id: 'sc1',
        scene_no: '01',
        order: 1,
        original_text: '江澈坐在电竞椅上，左手键盘右手鼠标，面前三块显示器，弹幕飞速滚动。',
        type: 'action',
    },
    {
        segment_id: 'seg2',
        episode_id: 'ep1',
        scene_id: 'sc1',
        scene_no: '01',
        order: 2,
        original_text: '江澈：「今天又是杀疯的一天。」',
        type: 'dialogue',
        character_name: '江澈',
    },
];
const facts = extractDramaSceneEnvFactsFromOriginal({
    location: '电竞直播间',
    original_scenes: [scene({ scene_id: 'sc1', location: '电竞直播间', location_type: 'INT' })],
    original_segments: segments,
});
assert(facts.kind === '室内' || /int/i.test(facts.kind), `kind 应为室内: ${facts.kind}`);
assert(facts.fixed_elements.some((x) => /电竞椅|键盘|鼠标|显示器|弹幕/.test(x)), `陈设应含直播间物件: ${JSON.stringify(facts.fixed_elements)}`);
const composed = composeDramaSceneDesignPrompt({
    name: '电竞直播间',
    location: '电竞直播间',
    kind: facts.kind,
    fixed_elements: facts.fixed_elements,
    time_default: facts.time_default || '夜',
    spatial_structure: facts.spatial_structure,
});
assert(/陈设硬事实/.test(composed), `compose 须含陈设硬事实: ${composed}`);
assert(/电竞椅|键盘|显示器/.test(composed), `compose 须含原文物件: ${composed}`);
assert(!/电影感静帧/.test(composed), `不应再写电影感静帧空壳: ${composed}`);
const shell = composeDramaSceneDesignPrompt({
    name: '电竞直播间',
    location: '电竞直播间',
    prompt: '空场景：电竞直播间，无人物，写清建筑/家具材质与陈设细节，电影感静帧',
    fixed_elements: facts.fixed_elements,
    kind: '室内',
    forceRebuild: true,
});
assert(/陈设硬事实/.test(shell) && /电竞椅|键盘/.test(shell), `空壳应被重拼: ${shell}`);
const session = createEmptyDramaSession({
    active_episode_id: 'ep1',
    bible: {
        scenes: [
            createEmptyDramaSceneAsset({
                name: '电竞直播间',
                location: '电竞直播间',
                prompt: '空场景：电竞直播间，无人物，电影感静帧',
            }),
        ],
    },
});
session.episode_bibles = {
    ep1: createEmptyDramaEpisodeBible({
        episode_id: 'ep1',
        original_scenes: [
            scene({ scene_id: 'sc1', location: '电竞直播间', location_type: 'INT', time: '夜' }),
        ],
        original_segments: segments,
    }),
};
session.active_episode_id = 'ep1';
const enriched = enrichDramaSceneAssetFromOriginal(session, session.bible.scenes[0]);
assert(/电竞椅|键盘|显示器|弹幕/.test(enriched.prompt), `enrich prompt: ${enriched.prompt}`);
assert((enriched.fixed_elements || []).length > 0, 'enrich 应写入 fixed_elements');
const imagePrompt = buildDirectorSceneImagePrompt({
    name: enriched.name,
    prompt: enriched.prompt,
    location: enriched.location,
    kind: enriched.kind,
    fixed_elements: enriched.fixed_elements,
    time_default: enriched.time_default,
    spatial_structure: enriched.spatial_structure,
    styleHint: '电影质感夜戏',
});
assert(/地点硬事实/.test(imagePrompt), `生图须前置地点硬事实: ${imagePrompt.slice(0, 200)}`);
assert(/单张场景约束/.test(imagePrompt), `生图须含单张场景约束: ${imagePrompt.slice(0, 240)}`);
assert(imagePrompt.indexOf('地点硬事实') < imagePrompt.indexOf('单张场景约束'), '硬事实须在单张场景约束之前');
assert(!/【通用九宫格约束】|输出一张完整的\s*3\s*[×xX]\s*3\s*九宫格|九宫格场景参考图（共九格）/.test(imagePrompt), `生图不得再默认生成九宫格: ${imagePrompt.slice(0, 300)}`);
assert(/单幅空场景|single full-frame empty location/i.test(imagePrompt), '须明确单张空场景');
assert(/电竞椅|键盘|显示器/.test(imagePrompt), `生图须含原文陈设: ${imagePrompt.slice(0, 400)}`);
assert(/场景时代锁·现代/.test(imagePrompt), `现代场须有时代锁: ${imagePrompt.slice(0, 400)}`);
assert(!/山水|宝塔|飞檐/.test(imagePrompt) || /禁止山水/.test(imagePrompt), '时代锁应禁止山水古建');
// 全片古风题材不得污染现代电竞房场景卡
const polluted = composeDramaSceneDesignPrompt({
    name: '电竞直播间',
    location: '电竞直播间',
    kind: '室内',
    fixed_elements: ['电竞椅', '三块显示器', '机械键盘'],
    time_default: '夜',
    storyContext: '古装仙侠玄幻；主角下山历练；宗门恩怨',
    eraStyle: '中国古装玄幻 · 冷色仙气',
    forceRebuild: true,
});
assert(!/时代\/题材：[^（，]*古装/.test(polluted), `现代场不得写入全片古装题材: ${polluted}`);
assert(/当代现代|禁止古装/.test(polluted), `现代场须写现代时代锁: ${polluted}`);
assert(!/符合背景故事：[^。]*古装仙侠/.test(polluted), `现代场不得灌入冲突古风故事: ${polluted}`);
const pollutedImage = buildDirectorSceneImagePrompt({
    name: '电竞直播间',
    location: '电竞直播间',
    kind: '室内',
    fixed_elements: ['电竞椅', '三块显示器'],
    prompt: polluted,
    styleHint: '中国古装玄幻；冷色仙气；电影质感',
});
assert(/场景时代锁·现代/.test(pollutedImage), '生图须有现代时代硬锁');
assert(!/光色[^\\n]*古装玄幻/.test(pollutedImage), `styleHint 古风词须剥离: ${pollutedImage.slice(0, 500)}`);
assert(/禁止山水|禁止把直播间/.test(pollutedImage), '须明确禁止山水/古风渗入');
// 已污染厚稿应强制重拼
const rebuiltFromPollutedCard = composeDramaSceneDesignPrompt({
    name: '电竞直播间',
    location: '电竞直播间',
    kind: '室内',
    fixed_elements: ['电竞椅', '显示器', '键盘'],
    prompt: '空场景：电竞直播间，室内，时代/题材：中国古装玄幻，符合背景故事：古装仙侠玄幻下山历练，陈设硬事实：电竞椅、显示器、键盘，无人物，写实空场景静帧',
});
assert(!/时代\/题材：[^（，]*古装/.test(rebuiltFromPollutedCard), `污染厚稿须重拼: ${rebuiltFromPollutedCard}`);
console.log('scenePromptFromOriginal.selftest ok');
