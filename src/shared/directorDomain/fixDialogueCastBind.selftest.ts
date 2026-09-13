/**
 * 第一刀：对白污染清洗 + 多角色 Subject/Picture 一一绑定
 * 运行：npx tsx src/shared/directorDomain/fixDialogueCastBind.selftest.ts
 */
import { stripDramaSpokenLineBody } from './characterDesignPrompt.js';
import { composeDramaShotH3EnglishPrompt, composeDramaShotLensTaggedPrompt, resolveDramaLensSubjects, } from './composeDramaShotLensPrompt.js';
import { createEmptyDramaEpisodeBible } from './episodeBible.js';
import { createEmptyDramaCharacter, createEmptyDramaSceneAsset, createEmptyDramaSession, createEmptyDramaShot, createEmptyDramaVoice, } from './factories.js';
import { analyzeDramaEpisodeOriginal } from './originalScript.js';
import { convertShotSuggestionsToDramaShots } from './session.js';
import { listDramaShotRefImageSlots } from './shotRefs.js';
import { collectDramaEventSpokenTurns, createEmptyDramaTimelineEvent, ensureDramaShotTimelineEvents, } from './timelineEvent.js';
function assert(cond, msg) {
    if (!cond)
        throw new Error(msg);
}
const SHARED = 'https://example.com/shared-ref.png';
const jiang = createEmptyDramaCharacter({
    character_id: 'c-jiang',
    name: '江澈',
    voice_id: 'v-jiang',
    imageUrl: SHARED,
});
const zhao = createEmptyDramaCharacter({
    character_id: 'c-zhao',
    name: '赵铁柱',
    voice_id: 'v-zhao',
    imageUrl: SHARED,
});
const su = createEmptyDramaCharacter({
    character_id: 'c-su',
    name: '苏挽月',
    voice_id: 'v-su',
    imageUrl: SHARED,
});
const peak = createEmptyDramaSceneAsset({
    scene_id: 'sc-peak',
    name: '云霄峰山门外',
    location: '云霄峰山门外',
    imageUrl: SHARED,
});
const voices = [
    createEmptyDramaVoice({ voice_id: 'v-jiang', character_id: 'c-jiang', timbre: '男' }),
    createEmptyDramaVoice({ voice_id: 'v-zhao', character_id: 'c-zhao', timbre: '男' }),
    createEmptyDramaVoice({ voice_id: 'v-su', character_id: 'c-su', timbre: '女' }),
];
// --- strip：纯对白 ---
assert(stripDramaSpokenLineBody('江澈\n（慵懒）\n家人们，这把打完就下播了啊。', ['江澈']) ===
    '家人们，这把打完就下播了啊。', 'strip lazy multiline');
assert(stripDramaSpokenLineBody('苏挽月\n江澈，你来了。', ['苏挽月', '江澈']) === '江澈，你来了。', 'strip speaker line keeps vocative');
assert(stripDramaSpokenLineBody('赵铁柱\n小子你谁啊。', ['赵铁柱']) === '小子你谁啊。', 'strip zhao label');
assert(!/（慵懒）/.test(stripDramaSpokenLineBody('（慵懒）家人们好', ['江澈'])), 'inline paren');
// --- 三角色同场 + 同 URL：Subject/Picture 一一对应，禁止 NONE / 末角色吞 Picture1 ---
const PEAK_SCRIPT = `## 1. 外景 云霄峰山门外 - 晨

江澈走向云霄峰。

江澈走两步回头。

江澈
对了老爷子，这地方哪里能充电？

赵铁柱
小子你谁啊。

苏挽月
江澈，你来了。
`;
const analysis = analyzeDramaEpisodeOriginal({
    source: PEAK_SCRIPT,
    episodeId: 'ep-bind',
    characters: [jiang, zhao, su],
    scenes: [peak],
    voices,
});
const session0 = createEmptyDramaSession({
    active_episode_id: 'ep-bind',
    bible: {
        characters: [jiang, zhao, su],
        scenes: [peak],
        voices,
        projectVisualBible: {
            presetName: '仙侠',
            stylePrompt: 'cinematic',
            selected_at: Date.now(),
        },
    },
    episode_bibles: {
        'ep-bind': createEmptyDramaEpisodeBible({
            episode_id: 'ep-bind',
            original_scenes: analysis.original_scenes,
            original_segments: analysis.original_segments,
            visual_events: analysis.visual_events,
            shot_suggestions: analysis.shot_suggestions,
            official_scene_beats: analysis.scene_beats,
        }),
    },
});
const converted = convertShotSuggestionsToDramaShots(session0, analysis.shot_suggestions);
const session = { ...session0, shots: converted.shots, scene_beats: converted.scene_beats };
const shot = ensureDramaShotTimelineEvents(converted.shots[0], session);
const slots = listDramaShotRefImageSlots(session, shot);
const charSlots = slots.filter((s) => s.role === 'character');
assert(charSlots.length === 3, `三角色应各占一槽，实际 ${charSlots.length}: ${JSON.stringify(slots)}`);
assert(new Set(charSlots.map((s) => s.asset_id)).size === 3, `三角色 asset_id 唯一: ${JSON.stringify(charSlots)}`);
const sceneSlot = slots.find((s) => s.role === 'scene');
assert(sceneSlot?.asset_id === 'sc-peak', `场景槽不得被角色覆盖: ${JSON.stringify(sceneSlot)}`);
assert(sceneSlot?.index === 1, '场景应为 Picture 1');
const lens = resolveDramaLensSubjects(session, shot);
const byId = lens.subjectByCharacterId;
for (const id of ['c-jiang', 'c-zhao', 'c-su']) {
    const sub = byId.get(id);
    assert(sub, `missing subject ${id}`);
    assert(sub.pictureTag, `${id} 不得 locked to NONE / 空 Picture`);
    assert(/^<Picture \d+>$/.test(sub.pictureTag), `${id} pictureTag=${sub.pictureTag}`);
}
assert(byId.get('c-jiang').pictureTag !== byId.get('c-zhao').pictureTag, '江澈≠赵铁柱 Picture');
assert(byId.get('c-zhao').pictureTag !== byId.get('c-su').pictureTag, '赵≠苏 Picture');
assert(byId.get('c-jiang').pictureTag !== byId.get('c-su').pictureTag, '江≠苏 Picture');
assert(lens.sceneSubject?.pictureTag === '<Picture 1>', `场景 Subject 锁 Picture 1，实际 ${lens.sceneSubject?.pictureTag}`);
assert(byId.get('c-su').pictureTag !== '<Picture 1>', '末角色苏挽月不得独占/覆盖场景 Picture 1');
// --- 多角色对白 + <d> 纯对白 ---
const tes = shot.timeline_events || [];
const dlgSu = tes.find((e) => e.dialogue_character_id === 'c-su' && /你来了/.test(e.dialogue || ''));
assert(dlgSu, `苏挽月对白 TE 应存在: ${JSON.stringify(tes.map((e) => e.dialogue))}`);
assert(!/苏挽月/.test(String(dlgSu.dialogue || '')), `TE.dialogue 不得含说话人名: ${dlgSu.dialogue}`);
assert(!/（/.test(String(dlgSu.dialogue || '')), `TE.dialogue 不得含括注: ${dlgSu.dialogue}`);
assert(String(dlgSu.dialogue || '').includes('江澈，你来了'), `对白正文应保留称呼: ${dlgSu.dialogue}`);
const speakers = [
    { name: '江澈', character_id: 'c-jiang' },
    { name: '赵铁柱', character_id: 'c-zhao' },
    { name: '苏挽月', character_id: 'c-su' },
];
const turns = collectDramaEventSpokenTurns({
    dialogue: '苏挽月\n江澈，你来了。',
    dialogue_character_id: 'c-su',
}, speakers);
assert(turns.turns.length === 1, `turns=${JSON.stringify(turns.turns)}`);
assert(turns.turns[0].character_id === 'c-su', '说话人仍为苏挽月');
assert(turns.turns[0].line === '江澈，你来了。', `纯对白 line=${turns.turns[0].line}`);
const en = composeDramaShotH3EnglishPrompt(session, shot);
const zh = composeDramaShotLensTaggedPrompt(session, shot);
const dBlocks = [...en.matchAll(/<d>\[Chinese\]([\s\S]*?)<\/d>/gi)].map((m) => m[1].trim());
assert(dBlocks.length >= 3, `应有多段 <d>，实际 ${dBlocks.length}`);
for (const body of dBlocks) {
    assert(!/^(?:江澈|赵铁柱|苏挽月)\n/m.test(body), `<d> 不得含人名行: ${body}`);
    assert(!/（慵懒）|（紧张）/.test(body), `<d> 不得含括注: ${body}`);
    assert(!/^苏挽月/.test(body), `<d> 不得以说话人名开头: ${body}`);
}
assert(dBlocks.some((b) => b === '江澈，你来了。' || b.includes('江澈，你来了')), `苏挽月台词应进 <d>: ${JSON.stringify(dBlocks)}`);
assert(!/locked to NONE/i.test(en), `EN 不得 locked to NONE:\n${en}`);
assert(/<Subject 1>[\s\S]*locked to <Picture \d+>/i.test(en) ||
    /Visible: <Subject 1> \(locked to <Picture \d+>\)/i.test(en), 'Subject1 应有 Picture 锁');
for (const id of ['c-jiang', 'c-zhao', 'c-su']) {
    const tag = byId.get(id).pictureTag;
    assert(en.includes(`locked to ${tag}`), `${id} EN 应出现 ${tag}`);
}
// 手工三角色 shot（不经 analyze）再验槽位
const manual = createEmptyDramaShot({
    shot_no: '9',
    duration_sec: 10,
    character_ids: ['c-jiang', 'c-zhao', 'c-su'],
    scene_asset_id: 'sc-peak',
    timeline_events: [
        createEmptyDramaTimelineEvent({
            start_sec: 0,
            end_sec: 3,
            dialogue: '江澈\n对了老爷子，这地方哪里能充电？',
            dialogue_character_id: 'c-jiang',
            character_ids: ['c-jiang'],
            lip_sync: true,
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 3,
            end_sec: 6,
            dialogue: '赵铁柱\n小子你谁啊。',
            dialogue_character_id: 'c-zhao',
            character_ids: ['c-zhao'],
            lip_sync: true,
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 6,
            end_sec: 10,
            dialogue: '苏挽月\n江澈，你来了。',
            dialogue_character_id: 'c-su',
            character_ids: ['c-su'],
            lip_sync: true,
        }),
    ],
});
const manualEn = composeDramaShotH3EnglishPrompt(session, manual);
const manualD = [...manualEn.matchAll(/<d>\[Chinese\]([\s\S]*?)<\/d>/gi)].map((m) => m[1].trim());
assert(manualD.includes('对了老爷子，这地方哪里能充电？') ||
    manualD.some((b) => b.includes('哪里能充电')), `manual jiang d: ${JSON.stringify(manualD)}`);
assert(manualD.includes('小子你谁啊。') || manualD.some((b) => b.includes('小子你谁啊')), `manual zhao d: ${JSON.stringify(manualD)}`);
assert(manualD.includes('江澈，你来了。') || manualD.some((b) => b.includes('江澈，你来了')), `manual su d: ${JSON.stringify(manualD)}`);
assert(!manualD.some((b) => /赵铁柱|苏挽月\n|^江澈\n/.test(b)), `manual <d> 污染: ${JSON.stringify(manualD)}`);
assert(!/locked to NONE/i.test(manualEn), 'manual 不得 NONE');
void zh;
console.log('fixDialogueCastBind.selftest: OK');
