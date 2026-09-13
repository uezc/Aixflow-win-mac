/**
 * P1 VE/TE 绑定：GAZE 验收（程序路径，无 LLM who 覆盖）。
 * 运行：npx tsx src/shared/directorDomain/p1VeTeBinding.selftest.ts
 */
import { analyzeDramaEpisodeOriginal, buildVisualEventsFromOriginalSegments, parseOriginalScript, resolveDramaActionSubjectName, } from './originalScript.js';
import { createEmptyDramaCharacter, createEmptyDramaSceneAsset, createEmptyDramaSession, createEmptyDramaVoice } from './factories.js';
import { createEmptyDramaEpisodeBible } from './episodeBible.js';
import { convertShotSuggestionsToDramaShots } from './session.js';
import { ensureDramaShotTimelineEvents } from './timelineEvent.js';
import { composeDramaShotH3EnglishPrompt } from './composeDramaShotLensPrompt.js';
function assert(cond, msg) {
    if (!cond)
        throw new Error(msg);
}
const GAZE = `## 1. 内景 灵根殿 - 日

青衫少年看向江澈。

少年：
“你为什么不说话？”

江澈没有回答，转头看向执事长老。

执事长老：
“开始吧。”
`;
const KNOWN = ['江澈', '少年', '执事长老'];
assert(resolveDramaActionSubjectName('江澈没有回答，转头看向执事长老。', KNOWN) === '江澈', '主语：没有回答→江澈');
assert(resolveDramaActionSubjectName('青衫少年看向江澈。', KNOWN) === '少年', '主语：看向→少年（非江澈）');
const { scenes, segments } = parseOriginalScript(GAZE, 'ep-gaze', KNOWN);
const noAnswerSeg = segments.find((s) => /没有回答/.test(s.original_text || ''));
assert(noAnswerSeg?.character_name === '江澈', `segment.character_name=${noAnswerSeg?.character_name}`);
const lookSeg = segments.find((s) => /看向江澈/.test(s.original_text || ''));
assert(lookSeg?.character_name === '少年', `看向 segment who=${lookSeg?.character_name}`);
const { visualEvents } = buildVisualEventsFromOriginalSegments(scenes, segments);
const veNoAnswer = visualEvents.find((ve) => /没有回答/.test(String(ve.original_text || '')));
const veLook = visualEvents.find((ve) => /看向江澈/.test(String(ve.original_text || '')));
const veDlg = visualEvents.find((ve) => ve.kind === 'dialogue' && /你为什么不说话/.test(String(ve.original_text || '')));
console.log('--- GAZE VE/TE 修复后 ---');
for (const ve of visualEvents) {
    console.log(JSON.stringify({
        kind: ve.kind,
        who: ve.who,
        action: String(ve.action || '').slice(0, 48),
        see: String(ve.see || '').slice(0, 24),
    }));
}
assert(veLook?.who === '少年', `VE 看向 who=${veLook?.who}`);
assert(veNoAnswer?.who === '江澈', `VE 不答 who=${veNoAnswer?.who}`);
assert(/面向江澈|站定/.test(String(veDlg?.action || '')), `对白最小 visual=${veDlg?.action}`);
const chars = [
    createEmptyDramaCharacter({ character_id: 'boy', name: '少年', voice_id: 'v-boy', imageUrl: 'https://example.com/b.png' }),
    createEmptyDramaCharacter({ character_id: 'c-jiang', name: '江澈', voice_id: 'v-jiang', imageUrl: 'https://example.com/j.png' }),
    createEmptyDramaCharacter({ character_id: 'c-elder', name: '执事长老', voice_id: 'v-elder', imageUrl: 'https://example.com/e.png' }),
];
const sc = [createEmptyDramaSceneAsset({ scene_id: 'sc-hall', name: '灵根殿', location: '灵根殿', imageUrl: 'https://example.com/s.png' })];
const voices = [
    createEmptyDramaVoice({ voice_id: 'v-boy', character_id: 'boy', timbre: '少年' }),
    createEmptyDramaVoice({ voice_id: 'v-jiang', character_id: 'c-jiang', timbre: '江澈' }),
    createEmptyDramaVoice({ voice_id: 'v-elder', character_id: 'c-elder', timbre: '长老' }),
];
const analysis = analyzeDramaEpisodeOriginal({
    source: GAZE,
    episodeId: 'ep-gaze',
    characters: chars,
    scenes: sc,
    voices,
});
const session = createEmptyDramaSession({
    active_episode_id: 'ep-gaze',
    bible: { characters: chars, scenes: sc, voices, projectVisualBible: { presetName: 't', stylePrompt: 't', selected_at: 1 } },
    episode_bibles: {
        'ep-gaze': createEmptyDramaEpisodeBible({
            episode_id: 'ep-gaze',
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
const tes = shots.flatMap((s) => s.timeline_events || []);
console.log('--- GAZE TE ---');
for (const e of tes) {
    console.log(JSON.stringify({
        visual_action: String(e.visual_action || '').slice(0, 40),
        dialogue: String(e.dialogue || '').slice(0, 24),
        character_ids: e.character_ids,
        eyeline: e.eyeline,
    }));
}
const teNoAnswer = tes.find((e) => /没有回答|转头看向/.test(e.visual_action || '') && !e.dialogue);
assert(teNoAnswer, 'TE 须有不答转头');
assert(teNoAnswer.character_ids.includes('c-jiang') && !teNoAnswer.character_ids.includes('c-elder'), `TE character_ids=${JSON.stringify(teNoAnswer.character_ids)}`);
assert(teNoAnswer.eyeline === 'c-elder' || /执事长老/.test(teNoAnswer.eyeline), `eyeline=${teNoAnswer.eyeline}`);
const en = composeDramaShotH3EnglishPrompt({ ...next, shots }, shots[0]);
assert(/does not answer/i.test(en) && /looks toward/i.test(en), `英文须保留不答+看向: ${en.slice(0, 400)}`);
console.log('p1VeTeBinding.selftest: OK');
