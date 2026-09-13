/**
 * P1/P0 三修：弹幕→TE→Prompt；VE 噪声+代词主语；35mm [ ] ：泄漏
 * 运行：npx tsx src/shared/directorDomain/fixP1P0Trio.selftest.ts
 */
import { composeDramaShotH3EnglishPrompt, composeDramaShotLensTaggedPrompt, sealDramaProductionCloudPrompt, } from './composeDramaShotLensPrompt.js';
import { createEmptyDramaEpisodeBible } from './episodeBible.js';
import { createEmptyDramaCharacter, createEmptyDramaSceneAsset, createEmptyDramaSession, createEmptyDramaVoice, } from './factories.js';
import { analyzeDramaEpisodeOriginal, resolveDramaActionSubjectName, } from './originalScript.js';
import { convertShotSuggestionsToDramaShots } from './session.js';
import { ensureDramaShotTimelineEvents } from './timelineEvent.js';
function assert(cond, msg) {
    if (!cond)
        throw new Error(msg);
}
const LIVE = `## 1. 内景 电竞直播间 - 夜

RGB灯条在昏暗房间里闪烁。江澈靠在电竞椅上，左手键盘右手鼠标。

他打了个哈欠，拿起一罐汽水灌了一大口，气泡声嗞——。

江澈
（慵懒）
家人们，这把打完就下播了啊。

【弹幕浮字：澈神今天又杀疯了！／全能王名不虚传！／给别人留点活路吧！】

江澈
（打个汽水嗝）
播啊，怎么不播。
`;
const jiang = createEmptyDramaCharacter({
    character_id: 'c-jiang',
    name: '江澈',
    voice_id: 'v-jiang',
    imageUrl: 'https://example.com/j.png',
});
const room = createEmptyDramaSceneAsset({
    scene_id: 'sc-room',
    name: '电竞直播间',
    location: '电竞直播间',
    imageUrl: 'https://example.com/r.png',
});
const voice = createEmptyDramaVoice({ voice_id: 'v-jiang', character_id: 'c-jiang', timbre: '男' });
assert(resolveDramaActionSubjectName('他打了个哈欠，拿起一罐汽水', ['江澈'], { previousWho: '江澈' }) ===
    '江澈', '代词他应回落上一主语');
const analysis = analyzeDramaEpisodeOriginal({
    source: LIVE,
    episodeId: 'ep-trio',
    characters: [jiang],
    scenes: [room],
    voices: [voice],
});
const noise = analysis.visual_events.filter((v) => (v.action === v.who && String(v.who || '').length <= 4) ||
    /^（/.test(String(v.who || '')) ||
    (String(v.who || '') === '（慵懒）' || String(v.action || '') === '（慵懒）'));
assert(noise.length === 0, `VE 噪声应清零，实际 ${JSON.stringify(noise)}`);
const yawn = analysis.visual_events.find((v) => /哈欠|汽水/.test(String(v.action || v.original_text || '')));
assert(yawn, '哈欠/汽水 VE 必须存在');
assert(yawn.who === '江澈', `代词动作 who 应为江澈，实际 ${yawn.who}`);
const danmuVe = analysis.visual_events.find((v) => /弹幕浮字/.test(String(v.original_text || '')));
assert(danmuVe, '弹幕 VE 必须存在');
const session0 = createEmptyDramaSession({
    active_episode_id: 'ep-trio',
    bible: {
        characters: [jiang],
        scenes: [room],
        voices: [voice],
        projectVisualBible: {
            presetName: '电竞',
            stylePrompt: 'cinematic',
            selected_at: Date.now(),
        },
    },
    episode_bibles: {
        'ep-trio': createEmptyDramaEpisodeBible({
            episode_id: 'ep-trio',
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
const tes = shot.timeline_events || [];
assert(tes.some((e) => /弹幕浮字|澈神今天又杀疯了/.test(String(e.visual_action || ''))), `弹幕必须进 TE: ${JSON.stringify(tes.map((e) => e.visual_action))}`);
const yawnTe = tes.find((e) => /哈欠|汽水/.test(String(e.visual_action || '')));
assert(yawnTe, '哈欠 TE 必须存在');
assert((yawnTe.character_ids || []).includes('c-jiang'), `哈欠 TE 应绑江澈，实际 ${JSON.stringify(yawnTe.character_ids)}`);
const dlgLazy = tes.find((e) => /家人们/.test(String(e.dialogue || '')));
assert(dlgLazy, '慵懒对白 TE');
assert(dlgLazy.dialogue_character_id === 'c-jiang', '对白绑江澈');
assert(!/江澈/.test(String(dlgLazy.dialogue || '')) && !/（慵懒）/.test(String(dlgLazy.dialogue || '')), `TE.dialogue 须纯对白: ${dlgLazy.dialogue}`);
assert(String(dlgLazy.dialogue || '').includes('家人们'), `对白正文保留: ${dlgLazy.dialogue}`);
const zh = composeDramaShotLensTaggedPrompt(session, shot);
const en = composeDramaShotH3EnglishPrompt(session, shot);
assert(/澈神今天又杀疯了|屏幕弹幕浮字/.test(zh), `ZH 应含弹幕: ${zh}`);
assert(/on-screen live-stream comment overlay/i.test(en), `EN 应含 overlay: ${en}`);
assert(/"澈神今天又杀疯了！"/.test(en), `EN overlay 应保留双引号中文条目: ${en}`);
assert(!/\[\s*[．.／/]/.test(en), `EN 不得残留屏字剥汉字空括号: ${en}`);
assert(!/35mm\s*\[\s*\]\s*[：:]/i.test(en), `EN 不得泄漏 35mm [ ] ：: ${en}`);
assert(!/\[\s*\]\s*[：:]/.test(en), `EN 不得残留空括号冒号: ${en}`);
assert(!/【弹幕浮字[^】]*】/.test(zh), `ZH 不得重复裸写【弹幕浮字】块: ${zh}`);
// seal 后双引号中文仍须保留
const sealed = sealDramaProductionCloudPrompt(en, { hasDialogue: true });
assert(/"澈神今天又杀疯了！"/.test(sealed), `seal 后仍应保留 overlay 中文: ${sealed}`);
console.log('fixP1P0Trio.selftest: OK');
