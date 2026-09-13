/**
 * P2 叙事拆镜：LIVE 应硬切成 15s + 6s，而非整场 20s。
 * 运行：npx tsx src/shared/directorDomain/p2NarrativeSplit.selftest.ts
 */
import { analyzeDramaEpisodeOriginal, isDramaNarrativeHardCutStart, packOriginalSegmentsIntoH3ShotBeats, parseOriginalScript, } from './originalScript.js';
import { createEmptyDramaCharacter, createEmptyDramaSceneAsset, createEmptyDramaVoice } from './factories.js';
function assert(cond, msg) {
    if (!cond)
        throw new Error(msg);
}
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
const GAZE = `## 1. 内景 灵根殿 - 日

青衫少年看向江澈。

少年：
“你为什么不说话？”

江澈没有回答，转头看向执事长老。

执事长老：
“开始吧。”
`;
assert(isDramaNarrativeHardCutStart({
    segment_id: 'x',
    episode_id: 'e',
    scene_id: 's',
    scene_no: '01',
    order: 1,
    original_text: '窗外雷声由远及近。一道白光闪过，屏幕炸开蓝光。',
    type: 'action',
}), '雷声入口须硬切');
assert(!isDramaNarrativeHardCutStart({
    segment_id: 'x',
    episode_id: 'e',
    scene_id: 's',
    scene_no: '01',
    order: 1,
    original_text: '第二道雷直接劈进电脑屏幕，蓝光炸裂。江澈浑身一麻，眼睛瞪大。',
    type: 'action',
}), '第二道雷不得切断高潮链');
assert(!isDramaNarrativeHardCutStart({
    segment_id: 'x',
    episode_id: 'e',
    scene_id: 's',
    scene_no: '01',
    order: 1,
    original_text: '画面切黑。',
    type: 'action',
}), '切黑并入上一镜');
const { segments } = parseOriginalScript(LIVE, 'ep-live', ['江澈']);
const packs = packOriginalSegmentsIntoH3ShotBeats(segments);
assert(packs.length === 2, `LIVE 硬切应 2 包，实际 ${packs.length}`);
assert(/播啊/.test(packs[0].map((s) => s.original_text).join('\n')), '包1 含日常对白');
assert(/雷声|白光/.test(packs[1].map((s) => s.original_text).join('\n')), '包2 含雷击');
assert(/我操|切黑/.test(packs[1].map((s) => s.original_text).join('\n')), '包2 含反应+切黑');
const live = analyzeDramaEpisodeOriginal({
    source: LIVE,
    episodeId: 'ep-live',
    characters: [
        createEmptyDramaCharacter({
            character_id: 'c-jiang',
            name: '江澈',
            voice_id: 'v-jiang',
            imageUrl: 'https://example.com/j.png',
        }),
    ],
    scenes: [
        createEmptyDramaSceneAsset({
            scene_id: 'sc-room',
            name: '电竞直播间',
            location: '电竞直播间',
            imageUrl: 'https://example.com/s.png',
        }),
    ],
    voices: [createEmptyDramaVoice({ voice_id: 'v-jiang', character_id: 'c-jiang', timbre: '男' })],
});
assert(live.shot_suggestions.length === 2, `LIVE 分析应 2 镜，实际 ${live.shot_suggestions.length}`);
const [s1, s2] = live.shot_suggestions;
assert(Number(s1.duration_sec) === 15, `Shot1 应为 15s，实际 ${s1.duration_sec} (ai=${s1.duration_ai})`);
assert(Number(s2.duration_sec) === 6, `Shot2 应为 6s，实际 ${s2.duration_sec} (ai=${s2.duration_ai})`);
assert(/播啊|家人们/.test(String(s1.action || '') + String(s1.dialogue || '')), 'Shot1 日常');
assert(/雷|白光|我操|切黑/.test(String(s2.action || '') + String(s2.dialogue || '')), 'Shot2 高潮');
assert(!/雷声|白光闪过/.test(String(s1.action || '')), 'Shot1 不得吞雷击');
const gaze = analyzeDramaEpisodeOriginal({
    source: GAZE,
    episodeId: 'ep-gaze',
    characters: [
        createEmptyDramaCharacter({ character_id: 'boy', name: '少年', imageUrl: 'https://example.com/b.png' }),
        createEmptyDramaCharacter({ character_id: 'c-jiang', name: '江澈', imageUrl: 'https://example.com/j.png' }),
        createEmptyDramaCharacter({ character_id: 'c-elder', name: '执事长老', imageUrl: 'https://example.com/e.png' }),
    ],
    scenes: [
        createEmptyDramaSceneAsset({
            scene_id: 'sc-hall',
            name: '灵根殿',
            location: '灵根殿',
            imageUrl: 'https://example.com/h.png',
        }),
    ],
    voices: [],
});
assert(gaze.shot_suggestions.length === 1, `GAZE 无类型墙应保持 1 镜，实际 ${gaze.shot_suggestions.length}`);
assert([6, 10, 15].includes(Number(gaze.shot_suggestions[0].duration_sec)), 'GAZE 落档合法');
console.log('p2NarrativeSplit.selftest: OK', {
    live: live.shot_suggestions.map((s) => ({
        shot: s.shot,
        sec: s.duration_sec,
        ai: s.duration_ai,
        why: s.duration_why,
    })),
    gaze: gaze.shot_suggestions.map((s) => ({ shot: s.shot, sec: s.duration_sec })),
});
