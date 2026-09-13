/**
 * P1-A1：程序 VE + Stub LLM VE → Merge → Timeline → Compiler。
 * 不调用云端 LLM。
 * 运行：npx tsx src/shared/directorDomain/p1DirectorTimeline.selftest.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeDramaShotH3EnglishPrompt, composeDramaShotLensTaggedPrompt, } from './composeDramaShotLensPrompt.js';
import { createEmptyDramaEpisodeBible } from './episodeBible.js';
import { createEmptyDramaCharacter, createEmptyDramaSceneAsset, createEmptyDramaSession, createEmptyDramaVoice, } from './factories.js';
import { stripDramaDirectorLensTags, stripDramaSystemSpokenLabel, } from './extractCastFromScript.js';
import { applyLlmAnalyzeOntoProgramSession, mapDramaSeeToEyeline, mergeProgramAndLlmVisualEvents, } from './mergeDramaVisualEvents.js';
import { normalizeDramaDomainAnalyzeResult } from './normalizeAnalyze.js';
import { analyzeDramaEpisodeOriginal } from './originalScript.js';
import { convertShotSuggestionsToDramaShots } from './session.js';
import { estimateDramaTalkSec } from './shotDurationFastPace.js';
import { createEmptyDramaVisualEvent } from './shotPlanning.js';
import { createEmptyDramaTimelineEvent, ensureDramaShotTimelineEvents, minDramaTimelineDialogueSpanSec, } from './timelineEvent.js';
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
const INVENTED_CAM = /\b(push-in|dolly|tracking|OTS|two-shot|close-up)\b/i;
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
                official_scene_beats: analysis.scene_beats,
            }),
        },
    });
    return { session, analysis };
}
function applyStubAndCompile(pack, llmVes) {
    const epId = pack.session.active_episode_id;
    const allowed = (pack.analysis.original_segments || []).map((s) => s.segment_id);
    const merged = mergeProgramAndLlmVisualEvents(pack.analysis.visual_events, llmVes, allowed);
    const session = {
        ...pack.session,
        episode_bibles: {
            ...pack.session.episode_bibles,
            [epId]: createEmptyDramaEpisodeBible({
                ...pack.session.episode_bibles?.[epId],
                episode_id: epId,
                original_scenes: pack.analysis.original_scenes,
                original_segments: pack.analysis.original_segments,
                visual_events: merged.visual_events,
                shot_suggestions: pack.analysis.shot_suggestions,
            }),
        },
    };
    const converted = convertShotSuggestionsToDramaShots(session, pack.analysis.shot_suggestions);
    const next = { ...session, shots: converted.shots, scene_beats: converted.scene_beats };
    const shots = converted.shots.map((s) => ensureDramaShotTimelineEvents(s, next));
    return { session: { ...next, shots }, shots, warnings: merged.warnings };
}
function stubFromProgram(program, enrich) {
    return program.map((ve) => createEmptyDramaVisualEvent({
        event_id: ve.event_id,
        source_segment_ids: ve.source_segment_ids,
        who: ve.who,
        kind: ve.kind,
        ...enrich(ve),
    }));
}
function span(e) {
    return Number(e.end_sec) - Number(e.start_sec);
}
// ---------- SKIP 仍为 true；无内层变量遮蔽 ----------
const hostSrc = readFileSync(join(process.cwd(), 'src/renderer/components/DirectorStudio/DramaStudioHost.tsx'), 'utf8');
assert(/SKIP_LLM_ANALYZE/.test(hostSrc), 'SKIP_LLM_ANALYZE 开关必须保留');
assert(/resolveSkipLlmAnalyze/.test(hostSrc), 'SKIP 必须走可恢复开关，禁止删除');
assert(!/let analyzedSession = normalized\.session/.test(hostSrc), '禁止内层 let analyzedSession 遮蔽');
assert(/baseForNormalize = analyzedSession/.test(hostSrc), 'baseForNormalize 必须使用本次 analyzedSession');
assert(/applyLlmAnalyzeOntoProgramSession\(analyzedSession, normalized\.session\)/.test(hostSrc), 'LLM 必须 merge 而非整表替换');
const analyzePrompt = readFileSync(join(process.cwd(), 'src/shared/directorDomain/prompts/analyze.ts'), 'utf8');
assert(/source_segment_ids/.test(analyzePrompt), 'analyze schema 必须含 source_segment_ids');
assert(/禁止输出 camera_action/.test(analyzePrompt), 'analyze 禁止生产 camera_action');
// ---------- Case A：纯动作 ----------
const caseA = sessionFromAnalysis(`## 1. 内景 房间 - 夜

江澈拿起汽水，望向远处。
`, 'ep-a', [char('c-jiang', '江澈', 'v-jiang')], [scene('sc-room', '房间')], [voice('v-jiang', 'c-jiang', '男声')]);
const llmA = stubFromProgram(caseA.analysis.visual_events, (ve) => {
    if (!/拿起汽水/.test(String(ve.original_text || ve.action || '')))
        return {};
    return {
        who: '江澈',
        see: '远处',
        action: 'LLM 改写：缓缓举起易拉罐',
        expression: '眉头微蹙，呼吸变沉',
        emotion: { primary: '紧张', secondary: '压抑', intensity: 0.8, arc: '' },
        position: '江澈坐在画面左侧',
        cut: 'action',
    };
});
const outA = applyStubAndCompile(caseA, llmA);
assert(outA.shots.length >= 1, 'Case A 必须有程序 shot_suggestions');
assert((caseA.analysis.original_segments || []).length >= 1, 'Case A original_segments');
const teA = outA.shots.flatMap((s) => s.timeline_events || []);
const actA = teA.find((e) => /拿起汽水/.test(e.visual_action));
assert(actA, `Case A 必须保留原文 visual_action: ${JSON.stringify(teA)}`);
assert(!/易拉罐/.test(actA.visual_action), 'Case A 程序原文不得被 LLM action 改写');
assert(actA.eyeline === '远处' || /远处/.test(actA.eyeline), `Case A eyeline 应为远处，实际 ${actA.eyeline}`);
assert(!/camera|viewer|lens/i.test(actA.eyeline), 'Case A 禁止默认 camera/viewer');
assert(!String(actA.dialogue || '').trim(), 'Case A 不得有对白');
assert(!String(actA.camera_action || '').trim(), 'Case A camera_action 必须为空');
assert(actA.character_ids.includes('c-jiang'), `Case A who→character_ids: ${JSON.stringify(actA.character_ids)}`);
assert(/紧张/.test(actA.character_state) && /压抑/.test(actA.character_state), `Case A emotion→character_state: ${actA.character_state}`);
assert(/情绪强度高/.test(actA.character_state), `Case A intensity: ${actA.character_state}`);
assert(/左侧/.test(actA.position), `Case A position: ${actA.position}`);
assert(/眉头微蹙/.test(actA.expression), `Case A expression 可见表演: ${actA.expression}`);
const programOnlyA = applyStubAndCompile(caseA, []);
const teProgramA = programOnlyA.shots.flatMap((s) => s.timeline_events || []);
assert(teProgramA.every((e) => e.eyeline !== e.visual_action && e.eyeline !== e.dialogue), `无 LLM 时不得把原文整句写入 eyeline: ${JSON.stringify(teProgramA)}`);
const compiledA = composeDramaShotH3EnglishPrompt(outA.session, outA.shots[0]);
const zhA = composeDramaShotLensTaggedPrompt(outA.session, outA.shots[0]);
assert(!INVENTED_CAM.test(compiledA), `Case A Compiler 发明运镜: ${compiledA}`);
assert(!INVENTED_CAM.test(zhA), `Case A 中文 Compiler 发明运镜`);
assert(!/情绪强度高/.test(compiledA + zhA), 'Compiler 不得输出情绪强度高');
assert(!/视线\s*<Subject/.test(zhA), '中文视线不得用 Subject 标签');
assert(!/system voice 说/.test(zhA), '中文不得写 system voice 说');
assert(/左侧/.test(compiledA + zhA) || /left/i.test(compiledA), 'Compiler 应读取 position');
assert(/远处|eyeline/.test(compiledA + zhA), 'Compiler 应读取 eyeline');
// ---------- Case B：动作 + 对白 + 环境声 ----------
const caseB = sessionFromAnalysis(`## 1. 内景 房间 - 夜

江澈拿起汽水。

江澈：
“我操……”

雷声由远及近。
`, 'ep-b', [char('c-jiang', '江澈', 'v-jiang')], [scene('sc-room', '房间')], [voice('v-jiang', 'c-jiang', '男声')]);
const llmB = stubFromProgram(caseB.analysis.visual_events, (ve) => ({
    who: '江澈',
    see: /拿起汽水/.test(String(ve.original_text || '')) ? '汽水' : '',
}));
const outB = applyStubAndCompile(caseB, llmB);
const teB = outB.shots.flatMap((s) => s.timeline_events || []);
assert(teB.some((e) => /拿起汽水/.test(e.visual_action)), 'Case B 动作');
assert(teB.some((e) => /我操/.test(e.dialogue)), `Case B dialogue: ${JSON.stringify(teB)}`);
assert(teB.some((e) => (e.environment_audio || []).some((x) => /雷声/.test(x))), `Case B env: ${JSON.stringify(teB)}`);
assert(!teB.some((e) => /我操/.test(e.visual_action) && /我操/.test(e.dialogue)), 'Case B 动作不得等于 dialogue 混写');
const enB = composeDramaShotH3EnglishPrompt(outB.session, outB.shots[0]);
const spokenB = dTags(enB);
assert(spokenB.some((t) => /我操/.test(t)), `Case B <d> 对白: ${spokenB.join(' | ')}`);
assert(!spokenB.some((t) => /雷声|拿起汽水/.test(t)), `Case B 环境声/动作不得进 <d>: ${spokenB.join(' | ')}`);
// ---------- Case C：多人关系 ----------
const caseC = sessionFromAnalysis(`## 1. 内景 灵根殿 - 日

青衫少年看向江澈。

少年：
“你为什么不说话？”

江澈没有回答，转头看向执事长老。

执事长老：
“开始吧。”
`, 'ep-c', [
    char('boy', '少年', 'v-boy'),
    char('c-jiang', '江澈', 'v-jiang'),
    char('c-elder', '执事长老', 'v-elder'),
], [scene('sc-hall', '灵根殿')], [
    voice('v-boy', 'boy', '少年'),
    voice('v-jiang', 'c-jiang', '江澈'),
    voice('v-elder', 'c-elder', '长老'),
]);
const llmC = stubFromProgram(caseC.analysis.visual_events, (ve) => {
    const t = String(ve.original_text || ve.action || '');
    if (/看向江澈/.test(t))
        return { who: '少年', see: '江澈' };
    if (/你为什么不说话/.test(t))
        return { who: '少年', see: '江澈' };
    if (/转头看向执事长老/.test(t))
        return { who: '江澈', see: '执事长老', emotion: { primary: '沉默', secondary: '压抑', intensity: 0.6 } };
    if (/开始吧/.test(t))
        return { who: '执事长老', see: '' };
    return {};
});
const outC = applyStubAndCompile(caseC, llmC);
const teC = outC.shots.flatMap((s) => s.timeline_events || []);
const lookJiang = teC.find((e) => /看向江澈/.test(e.visual_action));
const lookElder = teC.find((e) => /执事长老/.test(e.visual_action) && !e.dialogue);
assert(lookJiang, `Case C 少年看向江澈: ${JSON.stringify(teC)}`);
assert(lookJiang.eyeline === 'c-jiang' || /江澈/.test(lookJiang.eyeline), `Case C 少年 eyeline=${lookJiang.eyeline}`);
assert(lookElder, `Case C 江澈看向执事长老: ${JSON.stringify(teC)}`);
assert(lookElder.eyeline === 'c-elder' || /执事长老/.test(lookElder.eyeline), `Case C 江澈 eyeline=${lookElder.eyeline}`);
assert(lookElder.character_ids.includes('c-jiang'), `Case C 不答+转头必须绑江澈 character_ids=${JSON.stringify(lookElder.character_ids)}`);
assert(!lookElder.character_ids.includes('c-elder'), `Case C 动作主语不得绑执事长老 character_ids=${JSON.stringify(lookElder.character_ids)}`);
assert(!teC.some((e) => /^(camera|viewer|lens)$/i.test(String(e.eyeline || ''))), 'Case C 禁止默认 camera/viewer');
// ---------- Case C-program：无 LLM who 覆盖，纯程序 VE→TE 绑定 ----------
const caseCProg = sessionFromAnalysis(`## 1. 内景 灵根殿 - 日

青衫少年看向江澈。

少年：
“你为什么不说话？”

江澈没有回答，转头看向执事长老。

执事长老：
“开始吧。”
`, 'ep-c-prog', [
    char('boy', '少年', 'v-boy'),
    char('c-jiang', '江澈', 'v-jiang'),
    char('c-elder', '执事长老', 'v-elder'),
], [scene('sc-hall', '灵根殿')], [
    voice('v-boy', 'boy', '少年'),
    voice('v-jiang', 'c-jiang', '江澈'),
    voice('v-elder', 'c-elder', '长老'),
]);
const outCProg = applyStubAndCompile(caseCProg, stubFromProgram(caseCProg.analysis.visual_events, () => ({})));
const veNoAnswer = caseCProg.analysis.visual_events.find((ve) => /没有回答|转头看向/.test(String(ve.original_text || ve.action || '')));
assert(veNoAnswer, 'Case C-program 须有「没有回答」VE');
assert(veNoAnswer.who === '江澈', `Case C-program VE who 须为江澈，实际=${veNoAnswer.who}`);
const veLookBoy = caseCProg.analysis.visual_events.find((ve) => /看向江澈/.test(String(ve.original_text || '')));
assert(veLookBoy, 'Case C-program 须有「看向江澈」VE');
assert(veLookBoy.who === '少年', `Case C-program 看向主语须为少年，实际=${veLookBoy.who}`);
const dlgBoy = caseCProg.analysis.visual_events.find((ve) => ve.kind === 'dialogue' && /你为什么不说话/.test(String(ve.original_text || '')));
assert(dlgBoy, 'Case C-program 须有少年对白 VE');
assert(/面向江澈|站定/.test(String(dlgBoy.action || '')), `Case C-program 对白须有最小 visual，实际=${dlgBoy.action}`);
const teCProg = outCProg.shots.flatMap((s) => s.timeline_events || []);
const lookElderProg = teCProg.find((e) => /没有回答|转头看向/.test(e.visual_action) && !e.dialogue);
assert(lookElderProg, `Case C-program TE 不答转头: ${JSON.stringify(teCProg)}`);
assert(lookElderProg.character_ids.includes('c-jiang') && !lookElderProg.character_ids.includes('c-elder'), `Case C-program TE character_ids=${JSON.stringify(lookElderProg.character_ids)}`);
const dlgTeProg = teCProg.find((e) => /你为什么不说话/.test(e.dialogue || ''));
assert(dlgTeProg, 'Case C-program 对白 TE');
assert(String(dlgTeProg.visual_action || '').trim().length > 0, `Case C-program 对白 TE 须保留最小 visual，实际空`);
// ---------- Case D：系统声 ----------
const caseD = sessionFromAnalysis(`## 1. 内景 房间 - 夜

【系统提示音（机械女声，脑海中响起）】
叮——峡谷商城系统激活完毕。
`, 'ep-d', [char('c-jiang', '江澈', 'v-jiang')], [scene('sc-room', '房间')], [voice('v-jiang', 'c-jiang', '男声')]);
const outD = applyStubAndCompile(caseD, stubFromProgram(caseD.analysis.visual_events, () => ({})));
const teD = outD.shots.flatMap((s) => s.timeline_events || []);
const sys = teD.find((e) => e.dialogue);
assert(sys, `Case D 系统对白: ${JSON.stringify(teD)}`);
assert(sys.dialogue_character_id === 'system', `Case D dialogue_character_id=${sys.dialogue_character_id}`);
const enD = composeDramaShotH3EnglishPrompt(outD.session, outD.shots[0]);
const zhD = composeDramaShotLensTaggedPrompt(outD.session, outD.shots[0]);
assert(/off-screen system voice|off-screen narrator|voice-over/i.test(enD), `Case D 应为系统声: ${enD}`);
assert(/系统/.test(zhD), `Case D 中文应为系统声: ${zhD}`);
assert(!/视线/.test(zhD), `Case D 系统拍不得写视线: ${zhD}`);
assert(!/<Subject 1> says/i.test(enD), 'Case D 不得 Subject 1 says');
// ---------- Case D2：系统。宿主 不得进画面层 ----------
const caseD2 = sessionFromAnalysis(`## 1. 外景 云霄峰山门外 - 晨

系统。是的。宿主。但当前金币为零。无法购买任何英雄或装备。
`, 'ep-d2', [char('c-jiang', '江澈', 'v-jiang')], [scene('sc-peak', '云霄峰山门外')], [voice('v-jiang', 'c-jiang', '男声')]);
const outD2 = applyStubAndCompile(caseD2, stubFromProgram(caseD2.analysis.visual_events, () => ({
    who: '江澈',
    see: '江澈',
    emotion: { primary: '机械', secondary: '', intensity: 0.8, arc: '' },
})));
const teD2 = outD2.shots.flatMap((s) => s.timeline_events || []);
const host = teD2.find((e) => /宿主|当前金币/.test(`${e.dialogue} ${e.visual_action}`));
assert(host, `Case D2 系统宿主: ${JSON.stringify(teD2)}`);
assert(/宿主/.test(host.dialogue), `Case D2 对白应进 dialogue: ${JSON.stringify(host)}`);
assert(!/宿主/.test(host.visual_action), `Case D2 宿主不得留在 visual: ${host.visual_action}`);
assert(host.dialogue_character_id === 'system', `Case D2 id=${host.dialogue_character_id}`);
assert(!String(host.eyeline || '').trim(), `Case D2 eyeline 应空: ${host.eyeline}`);
const zhD2 = composeDramaShotLensTaggedPrompt(outD2.session, outD2.shots[0]);
const enD2 = composeDramaShotH3EnglishPrompt(outD2.session, outD2.shots[0]);
assert(/系统/.test(zhD2) && /当前金币/.test(zhD2), `Case D2 系统声白话: ${zhD2}`);
assert(/<d>\[Chinese\]/.test(enD2) && /当前金币/.test(enD2), `Case D2 EN 系统声 <d>: ${enD2}`);
assert(/当前金币/.test(zhD2), `Case D2 金币进剧情: ${zhD2}`);
assert(!/^[^<]*系统。是的/m.test(zhD2.replace(/<d>[\s\S]*?<\/d>/g, '')), `Case D2 不得当画面字: ${zhD2}`);
assert(!/视线/.test(zhD2), `Case D2 不得视线: ${zhD2}`);
assert(!/机械/.test(zhD2), `Case D2 系统拍不得输出机械: ${zhD2}`);


// ---------- Case D3：切至是场次过渡，不是系统声 ----------
const caseD3 = sessionFromAnalysis(`## 1. 内景 电竞直播间 - 夜

画面切黑。

切至：
`, 'ep-d3', [char('c-jiang', '江澈', 'v-jiang')], [scene('sc-room', '电竞直播间')], [voice('v-jiang', 'c-jiang', '男声')]);
const outD3 = applyStubAndCompile(caseD3, stubFromProgram(caseD3.analysis.visual_events, () => ({
    who: '系统',
    see: '江澈',
})));
const teD3 = outD3.shots.flatMap((s) => s.timeline_events || []);
assert(!teD3.some((e) => /切至/.test(e.dialogue)), `Case D3 切至不得进 dialogue: ${JSON.stringify(teD3)}`);
const zhD3 = composeDramaShotLensTaggedPrompt(outD3.session, outD3.shots[0]);
assert(!/<d>\[Chinese\]切至/.test(zhD3), `Case D3 切至不得念出: ${zhD3}`);
assert(!/画外(?:旁白|系统声)说：[\s\S]{0,40}切至/.test(zhD3), `Case D3 切至不得当旁白: ${zhD3}`);
// ---------- Case E：长对白时长 ----------
const longLine = '家人们，这把打完就下播了啊。明天冲峡谷之巅第一，目前差三百分，你们先别急着走。';
const caseE = sessionFromAnalysis(`## 1. 内景 房间 - 夜

江澈拿起汽水。

江澈：
“${longLine}”
`, 'ep-e', [char('c-jiang', '江澈', 'v-jiang')], [scene('sc-room', '房间')], [voice('v-jiang', 'c-jiang', '男声')]);
const outE = applyStubAndCompile(caseE, stubFromProgram(caseE.analysis.visual_events, (ve) => ({
    who: '江澈',
    see: /拿起汽水/.test(String(ve.original_text || '')) ? '汽水' : '',
})));
const teE = outE.shots.flatMap((s) => s.timeline_events || []);
const dlgE = teE.find((e) => e.dialogue.includes('家人们'));
assert(dlgE, `Case E 长对白: ${JSON.stringify(teE)}`);
const floorE = Math.max(estimateDramaTalkSec(longLine), minDramaTimelineDialogueSpanSec(longLine));
assert(span(dlgE) + 1e-9 >= floorE, `Case E 对白窗口 ${span(dlgE)} < talk estimate ${floorE}`);
// ---------- Case F：用户机位保留 ----------
const shotF = outA.shots[0];
const patchedF = {
    ...shotF,
    timeline_events: (shotF.timeline_events || []).map((e, i) => i === 0
        ? createEmptyDramaTimelineEvent({
            ...e,
            camera_action: 'slow push-in toward Subject 1',
        })
        : e),
};
const keptF = ensureDramaShotTimelineEvents(patchedF, outA.session);
assert((keptF.timeline_events || []).some((e) => e.camera_action === 'slow push-in toward Subject 1'), `Case F ensure 必须保留用户机位: ${JSON.stringify(keptF.timeline_events)}`);
const enF = composeDramaShotH3EnglishPrompt(outA.session, keptF);
assert(!/slow push-in toward Subject 1/i.test(enF), 'Case F 源稿不写机位/运镜，导演权交给 Skill');
// ---------- Case G：空机位不得发明 ----------
const shotG = outA.shots[0];
assert((shotG.timeline_events || []).every((e) => !String(e.camera_action || '').trim()), 'Case G merge 后 camera_action 仍为空');
assert(!INVENTED_CAM.test(compiledA), 'Case G Compiler 不得发明 push-in/dolly/OTS/two-shot/close-up');
// ---------- 编造 segment ID + normalize 保留原文层 ----------
const invented = mergeProgramAndLlmVisualEvents(caseA.analysis.visual_events, [
    createEmptyDramaVisualEvent({
        event_id: 'EV999',
        source_segment_ids: ['seg-999', 'segment-x', 'unknown-segment'],
        see: 'camera',
        action: '伪造动作',
    }),
], caseA.analysis.original_segments.map((s) => s.segment_id));
assert(invented.warnings.some((w) => /seg-999|编造|未知/.test(w)), `必须 warning 编造 ID: ${invented.warnings.join(' | ')}`);
assert(invented.visual_events.every((ve) => /拿起汽水/.test(String(ve.action || ve.original_text || '')) || ve.event_id), '编造 ID 不得覆盖程序 VE');
assert(invented.visual_events.every((ve) => !(ve.source_segment_ids || []).includes('seg-999')), '禁止保留编造 segment ID');
const stubJson = JSON.stringify({
    schemaVersion: 'director-domain.v2',
    type: 'director-drama-domain-analyze',
    project: { name: '测', type: '竖屏短剧', style: '现代', visual_style: '写实' },
    plot: '江澈拿汽水',
    relationships: '',
    script_keywords: [],
    scene_beats: [
        {
            scene_no: 1,
            location_name: '房间',
            int_ext: '内',
            day_night: '夜',
            weather: '',
            cast_names: ['江澈'],
            dramatic_goal: '',
            emotion: '',
        },
    ],
    visual_events: [
        {
            i: 1,
            id: caseA.analysis.visual_events[0]?.event_id || 'EV001',
            source_segment_ids: [caseA.analysis.original_segments[0]?.segment_id, 'seg-999'],
            who: '江澈',
            action: 'LLM改写动作',
            see: '远处',
            cut: 'action',
            position: '江澈坐在画面左侧',
            emotion: { primary: '紧张', secondary: '压抑', intensity: 0.8, arc: '' },
        },
    ],
    characters: [
        {
            name: '江澈',
            age: 20,
            gender: '男',
            role: '男主',
            identity: '男主',
            personality: '冷',
            backstory: '直播',
            prompt: '青年男性站在房间里，写实电影感',
            timbre: '低',
            sample_text: '江澈\n年龄：20岁\n性别：男\n音色描述：偏低\n台词：\n我操',
        },
    ],
    scenes: [{ name: '房间', location: '房间', prompt: '夜晚房间' }],
    props: [],
    creatures: [],
    shots: [],
    shot_suggestions: [],
});
const normalized = normalizeDramaDomainAnalyzeResult(stubJson, caseA.session);
assert(normalized.ok, `normalize 应成功: ${!normalized.ok ? normalized.error : ''}`);
if (normalized.ok) {
    const bible = normalized.session.episode_bibles?.[caseA.session.active_episode_id];
    assert((bible?.original_segments || []).length >= 1, 'normalize 必须保留 original_segments');
    assert((bible?.original_scenes || []).length >= 1, 'normalize 必须保留 original_scenes');
    assert((bible?.shot_suggestions || []).length >= 1, 'normalize 不得用 LLM 清空 shot_suggestions');
    assert((bible?.visual_events || []).some((ve) => /拿起汽水/.test(String(ve.action || ve.original_text || ''))), 'normalize merge 必须保留程序原文 action');
    assert(!(bible?.visual_events || []).some((ve) => (ve.source_segment_ids || []).includes('seg-999')), 'normalize 不得保留编造 segment ID');
    const mergedSession = applyLlmAnalyzeOntoProgramSession(caseA.session, normalized.session);
    const mergedBible = mergedSession.episode_bibles?.[caseA.session.active_episode_id];
    assert((mergedBible?.original_segments || []).length >= 1, 'applyLlm merge 保留 original_segments');
    assert((mergedBible?.shot_suggestions || []).length >= 1, 'applyLlm merge 保留 shot_suggestions');
}
// ---------- P1 收尾：系统标签 / 非视觉视线 / 脏机位词 ----------
assert(stripDramaSystemSpokenLabel('系统：恭喜宿主获得奖励') === '恭喜宿主获得奖励', '系统： 前缀必须剥掉');
assert(stripDramaSystemSpokenLabel('系统，你在吗？') === '系统，你在吗？', '人物台词「系统」不得剥');
assert(mapDramaSeeToEyeline('', [], '系统：机械声音在江澈脑海中响起') === '', '系统脑海声不得成 eyeline');
assert(mapDramaSeeToEyeline('脑海中', [], '机械声音在江澈脑海中响起') === '', 'see=脑海中 必须空');
assert(mapDramaSeeToEyeline('', [], '江澈看向石头') === '石头', '看向石头 → eyeline 石头');
assert(stripDramaDirectorLensTags('江澈站起身。朝云霄峰走去。背影镜头。') === '江澈站起身。朝云霄峰走去', '背影镜头必须从 visual 剥离');
assert(
  !/全景交代|中景看肢体|空间与站位|上半身与手部/.test(
    stripDramaDirectorLensTags(
      '林凡手持木棍。【全景交代人物与环境位置】空间与站位：站定。【中景看肢体与站位】上半身与手部：站定。',
    ),
  ),
  'AI 景别/站位装饰必须剥离',
);
assert(
  /林凡手持木棍/.test(
    stripDramaDirectorLensTags(
      '林凡手持木棍。【全景交代人物与环境位置】空间与站位：站定。【中景看肢体与站位】上半身与手部：站定。',
    ),
  ),
  '小说动作必须保留',
);
const caseShop = sessionFromAnalysis(`## 1. 内景 云霄峰商城 - 夜

系统：恭喜宿主获得奖励

江澈：
“系统，你在吗？”
`, 'ep-shop', [char('c-jiang', '江澈', 'v-jiang')], [scene('sc-shop', '云霄峰商城')], [voice('v-jiang', 'c-jiang', '男声')]);
const shopVe = caseShop.analysis.visual_events.find((ve) => /恭喜宿主/.test(String(ve.original_text || ve.action || '')));
assert(shopVe, '商城必须保留原文 VE');
assert(/系统/.test(String(shopVe.original_text || '')), `original_text 不得清洗系统标签: ${shopVe.original_text}`);
const outShop = applyStubAndCompile(caseShop, stubFromProgram(caseShop.analysis.visual_events, (ve) => {
    const t = String(ve.original_text || ve.action || '');
    if (/恭喜宿主/.test(t))
        return { who: '系统' };
    if (/你在吗/.test(t))
        return { who: '江澈' };
    return {};
}));
const teShop = outShop.shots.flatMap((s) => s.timeline_events || []);
const shopSys = teShop.find((e) => /恭喜宿主/.test(e.dialogue));
const shopAsk = teShop.find((e) => /你在吗/.test(e.dialogue));
assert(shopSys, `商城系统对白: ${JSON.stringify(teShop)}`);
assert(shopSys.dialogue_character_id === 'system', `商城系统 id=${shopSys.dialogue_character_id}`);
assert(!/^系统[:：]/.test(shopSys.dialogue), `Timeline 系统对白不得带标签: ${shopSys.dialogue}`);
assert(shopAsk, `商城人物问系统: ${JSON.stringify(teShop)}`);
assert(shopAsk.dialogue.includes('系统，你在吗'), `人物台词必须保留系统: ${shopAsk.dialogue}`);
const zhShop = composeDramaShotLensTaggedPrompt(outShop.session, outShop.shots[0]);
const enShop = composeDramaShotH3EnglishPrompt(outShop.session, outShop.shots[0]);
assert(/系统/.test(zhShop) && /恭喜宿主获得奖励/.test(zhShop), `商城白话只留台词: ${zhShop}`);
assert(!/系统\s*[：:]\s*恭喜宿主/.test(zhShop), `商城白话不得念系统标签: ${zhShop}`);
assert(/系统，你在吗/.test(zhShop), `商城人物台词保留系统: ${zhShop}`);
assert(/<d>\[Chinese\]恭喜宿主获得奖励/.test(enShop), `商城 EN <d> 只留台词: ${enShop}`);
assert(!/<d>\[Chinese\]系统[:：]/.test(enShop), `商城 EN <d> 不得念系统: ${enShop}`);
assert(/<d>\[Chinese\][“"]?系统，你在吗/.test(enShop), `商城 EN 人物 <d> 保留系统: ${enShop}`);
const caseWake = sessionFromAnalysis(`## 1. 外景 云霄峰山门外 - 晨

系统：机械声音在江澈脑海中响起

江澈看向石头。

江澈站起身。朝云霄峰走去。背影镜头。
`, 'ep-wake', [char('c-jiang', '江澈', 'v-jiang')], [scene('sc-peak', '云霄峰山门外')], [voice('v-jiang', 'c-jiang', '男声')]);
const wakeSrc = caseWake.analysis.visual_events.find((ve) => /背影镜头/.test(String(ve.original_text || '')));
assert(wakeSrc && /背影镜头/.test(String(wakeSrc.original_text || '')), '背影镜头必须留在 original_text');
const outWake = applyStubAndCompile(caseWake, stubFromProgram(caseWake.analysis.visual_events, (ve) => {
    const t = String(ve.original_text || ve.action || '');
    if (/脑海中响起/.test(t))
        return { who: '系统', see: '脑海中' };
    if (/看向石头/.test(t))
        return { who: '江澈', see: '石头' };
    if (/背影镜头|站起身/.test(t))
        return { who: '江澈' };
    return {};
}));
const teWake = outWake.shots.flatMap((s) => s.timeline_events || []);
const wakeMind = teWake.find((e) => /脑海中响起/.test(`${e.dialogue} ${e.visual_action}`));
const wakeStone = teWake.find((e) => /看向石头/.test(e.visual_action));
const wakeWalk = teWake.find((e) => /站起身|云霄峰/.test(e.visual_action));
assert(wakeMind, `醒来系统声: ${JSON.stringify(teWake)}`);
assert(!String(wakeMind.eyeline || '').trim(), `系统脑海声 eyeline 应空: ${wakeMind.eyeline}`);
assert(wakeStone, `醒来看向石头: ${JSON.stringify(teWake)}`);
assert(wakeStone.eyeline === '石头', `醒来 eyeline=${wakeStone.eyeline}`);
assert(wakeWalk, `醒来站起: ${JSON.stringify(teWake)}`);
assert(!/背影镜头/.test(wakeWalk.visual_action), `背影镜头不得进 visual_action: ${wakeWalk.visual_action}`);
const zhWake = composeDramaShotLensTaggedPrompt(outWake.session, outWake.shots[0]);
assert(!/视线\s*脑海/.test(zhWake), `醒来不得视线脑海中: ${zhWake}`);
assert(!/背影镜头/.test(zhWake), `醒来不得输出背影镜头: ${zhWake}`);
const caseRuin = sessionFromAnalysis(`## 1. 外景 战斗遗址 - 夜

苏挽月看向江澈。

苏挽月：
“还站得住吗？”
`, 'ep-ruin', [char('c-jiang', '江澈', 'v-jiang'), char('c-su', '苏挽月', 'v-su')], [scene('sc-ruin', '战斗遗址')], [voice('v-jiang', 'c-jiang', '男声'), voice('v-su', 'c-su', '女声')]);
const outRuin = applyStubAndCompile(caseRuin, stubFromProgram(caseRuin.analysis.visual_events, (ve) => {
    const t = String(ve.original_text || ve.action || '');
    if (/看向江澈/.test(t))
        return { who: '苏挽月', see: '江澈' };
    if (/站得住/.test(t))
        return { who: '苏挽月', see: '江澈' };
    return {};
}));
const teRuin = outRuin.shots.flatMap((s) => s.timeline_events || []);
assert(teRuin.some((e) => /看向江澈/.test(e.visual_action)), '战斗遗址动作');
assert(teRuin.some((e) => /站得住/.test(e.dialogue)), '战斗遗址对白');
assert(!teRuin.some((e) => /背影镜头/.test(e.visual_action)), '战斗遗址无脏机位词');
const caseFire = sessionFromAnalysis(`## 1. 外景 柴堆旁 - 夜

江澈坐在柴堆旁。

江澈：
“先烤干衣服。”
`, 'ep-fire', [char('c-jiang', '江澈', 'v-jiang')], [scene('sc-fire', '柴堆旁')], [voice('v-jiang', 'c-jiang', '男声')]);
const outFire = applyStubAndCompile(caseFire, stubFromProgram(caseFire.analysis.visual_events, (ve) => ({
    who: '江澈',
    see: /坐在柴堆/.test(String(ve.original_text || '')) ? '柴堆' : '',
})));
const teFire = outFire.shots.flatMap((s) => s.timeline_events || []);
assert(teFire.some((e) => /柴堆/.test(e.visual_action)), '柴堆旁动作');
assert(teFire.some((e) => /烤干衣服/.test(e.dialogue)), '柴堆旁对白');
assert(!teFire.some((e) => /脑海中|意识中/.test(e.eyeline)), '柴堆旁不得污染 eyeline');
assert(mapDramaSeeToEyeline('自己', [], '江澈看向自己') === '', 'eyeline 自己必须空');
assert(mapDramaSeeToEyeline('周围环境', [], '江澈看向周围环境') === '', 'eyeline 周围环境必须空');
assert(mapDramaSeeToEyeline('电竞直播间', [], '江澈看向电竞直播间', ['电竞直播间']) === '', 'eyeline 场景名直播间必须空');
assert(mapDramaSeeToEyeline('', [], '江澈看向石头') === '石头', 'eyeline 石头必须保留');
assert(mapDramaSeeToEyeline('', [], '江澈看向屏幕') === '屏幕', 'eyeline 屏幕必须保留');
assert(mapDramaSeeToEyeline('', [], '江澈看向窗外') === '窗外', 'eyeline 窗外必须保留');
assert(mapDramaSeeToEyeline('', [], '江澈看向云霄峰') === '云霄峰', 'eyeline 云霄峰山体必须保留');
const caseBound = sessionFromAnalysis(`## 1. 内景 电竞直播间 - 夜

江澈靠在电竞椅上，弹幕飞速滚动。

【弹幕浮字：澈神今天又杀疯了！／全能王名不虚传！／给别人留点活路吧！】

【旁白】，出名的烦恼才刚刚开始……

江澈看向自己。

江澈看向周围环境。

江澈看向屏幕。

江澈看向窗外。
`, 'ep-bound', [char('c-jiang', '江澈', 'v-jiang')], [scene('sc-live', '电竞直播间')], [voice('v-jiang', 'c-jiang', '男声')]);
assert(caseBound.analysis.original_segments.some((s) => String(s.original_text || '').includes('【弹幕浮字：澈神今天又杀疯了')), '弹幕 OriginalSegment 必须保留原文');
assert(caseBound.analysis.visual_events.some((ve) => String(ve.original_text || '').includes('【弹幕浮字：澈神今天又杀疯了')), '弹幕 VE.original_text 必须保留');
assert(caseBound.analysis.original_segments.some((s) => /出名的烦恼才刚刚开始/.test(String(s.original_text || ''))), '旁白 OriginalSegment 不得删除');
const outBound = applyStubAndCompile(caseBound, stubFromProgram(caseBound.analysis.visual_events, (ve) => {
    const t = String(ve.original_text || ve.action || '');
    if (/看向自己/.test(t))
        return { who: '江澈', see: '自己' };
    if (/周围环境/.test(t))
        return { who: '江澈', see: '周围环境' };
    if (/看向屏幕/.test(t))
        return { who: '江澈', see: '屏幕' };
    if (/看向窗外/.test(t))
        return { who: '江澈', see: '窗外' };
    if (/弹幕浮字/.test(t))
        return { see: '电竞直播间' };
    return { who: '江澈' };
}));
const teBound = outBound.shots.flatMap((s) => s.timeline_events || []);
assert(teBound.some((e) => /弹幕浮字|澈神今天又杀疯了|全能王名不虚传/.test(e.visual_action)), `弹幕必须进 visual_action: ${JSON.stringify(teBound.map((e) => e.visual_action))}`);
assert(teBound.some((e) => /靠在电竞椅上/.test(e.visual_action)), `真实动作必须保留: ${JSON.stringify(teBound.map((e) => e.visual_action))}`);
const boundNar = teBound.find((e) => /出名的烦恼才刚刚开始/.test(`${e.dialogue} ${e.visual_action}`));
assert(boundNar, `旁白必须进入系统声: ${JSON.stringify(teBound)}`);
assert(!/出名的烦恼/.test(boundNar.visual_action), `旁白不得进 visual_action: ${boundNar.visual_action}`);
assert(!/【旁白】/.test(boundNar.dialogue), `旁白标签不得进 dialogue: ${boundNar.dialogue}`);
assert(boundNar.dialogue_character_id === 'system', `旁白应为系统声: ${boundNar.dialogue_character_id}`);
assert(!teBound.some((e) => e.eyeline === '自己' || e.eyeline === '周围环境' || e.eyeline === '电竞直播间'), `不可靠 eyeline 必须空: ${JSON.stringify(teBound.map((e) => e.eyeline))}`);
assert(teBound.some((e) => e.eyeline === '屏幕'), `屏幕 eyeline 必须保留`);
assert(teBound.some((e) => e.eyeline === '窗外'), `窗外 eyeline 必须保留`);
const zhBound = composeDramaShotLensTaggedPrompt(outBound.session, outBound.shots[0]);
const enBound = composeDramaShotH3EnglishPrompt(outBound.session, outBound.shots[0]);
assert(/澈神今天又杀疯了|屏幕弹幕浮字/.test(zhBound), `编译稿应画弹幕: ${zhBound}`);
assert(/on-screen live-stream comment overlay/i.test(enBound), `英文应输出弹幕 overlay: ${enBound}`);
assert(!/【旁白】/.test(zhBound + enBound), `编译稿不得出现旁白标签: ${zhBound}`);
assert(/出名的烦恼才刚刚开始/.test(zhBound), `旁白应进系统 <d>: ${zhBound}`);
const caseOs = sessionFromAnalysis(`## 1. 外景 柴堆旁 - 夜

苏挽月坐在柴堆旁。

苏挽月
（内心OS）
他怎么还不来。
`, 'ep-os', [char('c-su', '苏挽月', 'v-su')], [scene('sc-fire2', '柴堆旁')], [voice('v-su', 'c-su', '女声')]);
assert(caseOs.analysis.original_segments.some((s) => /他怎么还不来/.test(String(s.original_text || ''))), '内心 OS 原文必须保留');
const outOs = applyStubAndCompile(caseOs, stubFromProgram(caseOs.analysis.visual_events, (ve) => {
    const t = String(ve.original_text || ve.action || ve.expression || '');
    if (/他怎么还不来|内心OS/.test(t))
        return { who: '苏挽月', expression: '内心OS' };
    return { who: '苏挽月' };
}));
const teOs = outOs.shots.flatMap((s) => s.timeline_events || []);
assert(!teOs.some((e) => /他怎么还不来/.test(e.dialogue)), `内心 OS 不得进人物 dialogue: ${JSON.stringify(teOs)}`);
const zhOs = composeDramaShotLensTaggedPrompt(outOs.session, outOs.shots[0]);
assert(!/<d>\[Chinese\][^<]*他怎么还不来/.test(zhOs), `内心 OS 不得进 <d>: ${zhOs}`);
assert(teOs.some((e) => /坐在柴堆旁/.test(e.visual_action)), '柴堆旁坐姿动作必须保留');
console.log('p1DirectorTimeline.selftest: PASS');
