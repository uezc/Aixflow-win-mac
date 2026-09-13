/**
 * P0：Visual Event → Timeline → 中英 Compiler 同源。
 * 运行：npx tsx src/shared/directorDomain/p0H3Compiler.selftest.ts
 */
import { stripChineseOutsideH3DialogueTags } from '../directorPipeline/composeFinalPrompt.js';
import { composeDramaShotH3EnglishPrompt, composeDramaShotLensTaggedPrompt, } from './composeDramaShotLensPrompt.js';
import { createEmptyDramaEpisodeBible } from './episodeBible.js';
import { createEmptyDramaCharacter, createEmptyDramaSceneAsset, createEmptyDramaSession, createEmptyDramaShot, createEmptyDramaVoice, } from './factories.js';
import { analyzeDramaEpisodeOriginal } from './originalScript.js';
import { convertShotSuggestionsToDramaShots } from './session.js';
import { buildTimelineEventsFromVisualEvents, createEmptyDramaTimelineEvent, dramaTimelineEventHasContent, ensureDramaShotTimelineEvents, } from './timelineEvent.js';
function assert(cond, msg) {
    if (!cond)
        throw new Error(msg);
}
function dTags(text) {
    return [...String(text || '').matchAll(/<d>\s*\[Chinese[^\]]*\]\s*([\s\S]*?)<\/d>/gi)].map((m) => String(m[1] || '').trim());
}
function char(id, name, voiceId) {
    return createEmptyDramaCharacter({
        character_id: id,
        name,
        voice_id: voiceId || '',
        imageUrl: `https://example.com/${id}.png`,
    });
}
function scene(id, name) {
    return createEmptyDramaSceneAsset({
        scene_id: id,
        name,
        location: name,
        imageUrl: `https://example.com/${id}.png`,
    });
}
function voice(id, characterId, label) {
    return createEmptyDramaVoice({
        voice_id: id,
        character_id: characterId,
        timbre: label,
        voiceStyle: label,
        sample_text: label,
    });
}
const STYLE = {
    presetName: '电影质感夜戏',
    stylePrompt: 'cinematic film look, low saturation, strong contrast, 35mm anamorphic lens, urban night drama',
    selected_at: Date.now(),
};
function sessionFromAnalysis(source, episodeId, characters, scenes, voices) {
    const analysis = analyzeDramaEpisodeOriginal({
        source,
        episodeId,
        characters,
        scenes,
        voices,
    });
    const session = createEmptyDramaSession({
        active_episode_id: episodeId,
        bible: {
            characters,
            scenes,
            voices,
            projectVisualBible: STYLE,
        },
        episode_bibles: {
            [episodeId]: createEmptyDramaEpisodeBible({
                episode_id: episodeId,
                original_scenes: analysis.original_scenes,
                original_segments: analysis.original_segments,
                visual_events: analysis.visual_events,
                shot_suggestions: analysis.shot_suggestions,
            }),
        },
    });
    const converted = convertShotSuggestionsToDramaShots(session, analysis.shot_suggestions);
    const next = { ...session, shots: converted.shots, scene_beats: converted.scene_beats };
    const shots = converted.shots.map((s) => ensureDramaShotTimelineEvents(s, next));
    return { session: { ...next, shots }, shots, analysis };
}
function checkCompilerPair(label, session, shot) {
    const zh = composeDramaShotLensTaggedPrompt(session, shot);
    const en = composeDramaShotH3EnglishPrompt(session, shot);
    const spoken = dTags(en);
    const zhSpoken = dTags(zh);
    const leaks = [...spoken, ...zhSpoken].filter((line) => /拿起汽水|雷声由远及近|画面切黑|屏幕炸开蓝光|雷声逼近/.test(line));
    assert(!leaks.length, `${label} <d> leaked action/sfx: ${leaks.join(' | ')}`);
    assert(!/two-shot push-pull|choke dolly|estranging pull-out/.test(en), `${label} cinematic heal`);
    assert(!/交代环境与站位|神情克制|目光直接|维持环境余韵|窒息推轨|剥离拉远/.test(zh + en), `${label} invented directing`);
    return { zh, en, spoken };
}
// ---------- Case A：动作 + 对白 + 雷声 ----------
const caseA = sessionFromAnalysis(`## 1. 内景 电竞直播间 - 夜

江澈拿起汽水。

江澈
家人们，这把打完就下播了。

雷声由远及近。
`, 'ep-a', [char('c-jiang', '江澈', 'v-jiang')], [scene('sc-room', '电竞直播间')], [voice('v-jiang', 'c-jiang', '男声')]);
const shotA = caseA.shots[0];
assert(shotA, 'case A shot');
assert((shotA.visual_event_ids || []).length >= 3, `case A VE ids: ${JSON.stringify(shotA.visual_event_ids)}`);
assert((shotA.timeline_events || []).length >= 3, `case A TE count ${shotA.timeline_events?.length}`);
assert(shotA.timeline_events.some((e) => /拿起汽水/.test(e.visual_action)), `case A visual: ${JSON.stringify(shotA.timeline_events)}`);
assert(shotA.timeline_events.some((e) => /家人们，这把打完就下播了/.test(e.dialogue)), `case A dialogue: ${JSON.stringify(shotA.timeline_events)}`);
assert(shotA.timeline_events.some((e) => (e.environment_audio || []).some((x) => /雷声/.test(x))), `case A env: ${JSON.stringify(shotA.timeline_events)}`);
assert(!shotA.timeline_events.some((e) => /^江澈[。.]?$/.test(String(e.visual_action || '').trim())), 'case A speaker label must not become a timeline beat');
assert(shotA.timeline_events.filter((e) => dramaTimelineEventHasContent(e)).length === 3 ||
    shotA.timeline_events.length === 3, `case A should be 3 beats, got ${shotA.timeline_events.length}`);
const compiledA = checkCompilerPair('A', caseA.session, shotA);
assert(compiledA.spoken.some((l) => /家人们，这把打完就下播了/.test(l)), `case A <d> ${compiledA.spoken.join(' | ')}`);
// ---------- Case B：系统声音 ----------
const caseB = sessionFromAnalysis(`## 1. 内景 电竞直播间 - 夜

【系统提示音】
叮——峡谷商城系统激活完毕。
`, 'ep-b', [char('c-jiang', '江澈', 'v-jiang')], [scene('sc-room', '电竞直播间')], [voice('v-jiang', 'c-jiang', '男声')]);
const shotB = caseB.shots[0];
assert(shotB, 'case B shot');
const sysEv = shotB.timeline_events.find((e) => /叮——/.test(e.dialogue));
assert(sysEv, `case B system event: ${JSON.stringify(shotB.timeline_events)}`);
assert(sysEv.dialogue_character_id !== 'c-jiang', `system bound to lead: ${sysEv.dialogue_character_id}`);
const compiledB = checkCompilerPair('B', caseB.session, shotB);
assert(/off-screen system voice|off-screen narrator|voice-over/.test(compiledB.en), 'case B en system');
assert(/系统/.test(compiledB.zh) && /叮——/.test(compiledB.zh), 'case B zh 系统声');
assert(!/<Subject 1>[\s\S]{0,80}<d>\[Chinese\]叮——/.test(compiledB.en), 'case B must not bind Subject 1 to system');
// ---------- Case C：用户手写机位 ----------
const sessionC = createEmptyDramaSession({
    bible: {
        characters: [char('c-jiang', '江澈', 'v-jiang')],
        scenes: [scene('sc-room', '电竞直播间')],
        voices: [voice('v-jiang', 'c-jiang', '男声')],
        projectVisualBible: STYLE,
    },
});
const shotC = createEmptyDramaShot({
    shot_no: '1',
    duration_sec: 4,
    character_ids: ['c-jiang'],
    scene_asset_id: 'sc-room',
    timeline_events: [
        createEmptyDramaTimelineEvent({
            start_sec: 0,
            end_sec: 4,
            character_ids: ['c-jiang'],
            visual_action: '江澈坐在电竞椅上',
            camera_action: '缓慢推向江澈',
            dialogue: '',
        }),
    ],
});
const enC = composeDramaShotH3EnglishPrompt(sessionC, shotC);
assert(/slow push-in toward/.test(enC) && /<Subject 1>/.test(enC), `case C cam: ${enC}`);
assert(!/two-shot push-pull|choke dolly|estranging pull-out/.test(enC), 'case C no heal');
// ---------- Case D：空机位 ----------
const shotD = createEmptyDramaShot({
    shot_no: '1',
    duration_sec: 4,
    character_ids: ['c-jiang'],
    scene_asset_id: 'sc-room',
    timeline_events: [
        createEmptyDramaTimelineEvent({
            start_sec: 0,
            end_sec: 4,
            character_ids: ['c-jiang'],
            visual_action: '江澈坐在电竞椅上',
            camera_action: '',
        }),
    ],
});
const enD = composeDramaShotH3EnglishPrompt(sessionC, shotD);
assert(!/cinematic push-in|slow dolly|pull-out|insert shot|choke dolly|Steadicam breathing follow/.test(enD), `case D invented cam: ${enD}`);
// ---------- Case E：中文角色名经 strip 仍完整 ----------
const strippedE = stripChineseOutsideH3DialogueTags(enC);
assert(strippedE.includes('<Subject 1> is the character referenced by') &&
    strippedE.includes('<Subject 2> is the environment referenced by'), `case E subject: ${strippedE}`);
assert(!/<Subject 1> is,\s*$/m.test(strippedE), 'case E subject 1 stripped');
assert(!/<Subject 2> is,\s*$/m.test(strippedE), 'case E subject 2 stripped');
// ---------- 三个真实剧本 ----------
const LIVE = `## 1. 内景 电竞直播间 - 夜

RGB灯条在昏暗房间里闪烁。江澈靠在电竞椅上，左手键盘右手鼠标。

他打了个哈欠，拿起一罐汽水灌了一大口，气泡声嗞——。

江澈
（慵懒）
家人们，这把打完就下播了啊。明天冲峡谷之巅第一，目前差三百分。

【弹幕浮字：澈神今天又杀疯了！／全能王名不虚传！／给别人留点活路吧！】

江澈
（打个汽水嗝）
播啊，怎么不播。

窗外雷声由远及近。一道白光闪过，屏幕炸开蓝光。

第二道雷直接劈进电脑屏幕，蓝光炸裂。江澈浑身一麻，眼睛瞪大。

江澈
我操——

画面切黑。
`;
const PEAK = `## 1. 外景 云霄峰山门外 - 晨

江澈走向云霄峰。

江澈走两步回头。

江澈
对了老爷子，这地方哪里能充电？

赵铁柱
小子你谁啊。

苏挽月
江澈，你来了。
`;
const GATE = `## 1. 内景 入门测试台 - 日

江澈站在台前。

苏挽月
准备好了吗？

赵铁柱
开始。

江澈
来了。
`;
function runReal(label, source, extraChars = []) {
    const pack = sessionFromAnalysis(source, `ep-${label}`, [char('c-jiang', '江澈', 'v-jiang'), ...extraChars], [
        scene('sc-room', '电竞直播间'),
        scene('sc-peak', '云霄峰山门外'),
        scene('sc-gate', '入门测试台'),
    ], [voice('v-jiang', 'c-jiang', '男声')]);
    const shot = pack.shots[0];
    assert(shot, `${label} shot`);
    assert((shot.timeline_events || []).length > 0, `${label} empty timeline`);
    const fromVe = buildTimelineEventsFromVisualEvents(pack.session, shot);
    assert(fromVe.length >= 1, `${label} VE map empty`);
    const compiled = checkCompilerPair(label, pack.session, shot);
    return { pack, shot, compiled };
}
const live = runReal('电竞直播间', LIVE);
assert(live.compiled.spoken.some((l) => /家人们/.test(l)), 'live spoken 家人们');
assert(!live.compiled.spoken.some((l) => /画面切黑|雷声由远及近|屏幕炸开蓝光/.test(l)), 'live <d> leak');
const peak = runReal('云霄峰', PEAK, [char('c-zhao', '赵铁柱'), char('c-su', '苏挽月')]);
assert(peak.compiled.spoken.some((l) => /充电/.test(l)), 'peak spoken 充电');
const gate = runReal('入门测试台', GATE, [char('c-zhao', '赵铁柱'), char('c-su', '苏挽月')]);
assert(gate.compiled.spoken.some((l) => /来了/.test(l)), 'gate spoken 来了');
assert(gate.compiled.spoken.some((l) => /准备好了吗/.test(l)), 'gate spoken 苏挽月');
assert(gate.compiled.spoken.some((l) => /开始/.test(l)), 'gate spoken 赵铁柱');
console.log('p0H3Compiler.selftest ok');
console.log('--- CASE A TIMELINE ---');
console.log(JSON.stringify(shotA.timeline_events, null, 2));
console.log('--- LIVE H3 ENGLISH ---');
console.log(live.compiled.en);
console.log('--- LIVE ZH ---');
console.log(live.compiled.zh);
console.log(JSON.stringify({
    电竞直播间: 'PASS',
    云霄峰: 'PASS',
    入门测试台: 'PASS',
    caseA: 'PASS',
    caseB: 'PASS',
    caseC: 'PASS',
    caseD: 'PASS',
    caseE: 'PASS',
}));
