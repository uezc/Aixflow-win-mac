/**
 * 系统声音身份边界：Voice Entity，不是 Character。
 * 运行：npx tsx src/shared/directorDomain/systemVoice.selftest.ts
 */
import { composeDramaShotH3EnglishPrompt, composeDramaShotLensTaggedPrompt, } from './composeDramaShotLensPrompt.js';
import { createEmptyDramaEpisodeBible } from './episodeBible.js';
import { extractCharacterNamesFromScriptText, isDramaInnerOsCue, looksLikeDramaInMindSystemVoice, looksLikeDramaSystemSpokenText, } from './extractCastFromScript.js';
import { buildVisualEventsFromOriginalSegments } from './originalScript.js';
import { createEmptyDramaCharacter, createEmptyDramaSceneAsset, createEmptyDramaSession, createEmptyDramaShot, createEmptyDramaVoice, createDramaSystemVoice, ensureDramaSystemVoice, syncDramaSystemVoice, } from './factories.js';
import { ensureAppearingCharactersInBible } from './ensureAppearingCharacters.js';
import { parseOriginalScript } from './originalScript.js';
import { listDramaShotRefAudioSlots } from './shotRefs.js';
import { createEmptyDramaVisualEvent } from './shotPlanning.js';
import { buildTimelineEventsFromVisualEvents, createEmptyDramaTimelineEvent, hydrateDramaTimelineEventDialogue, } from './timelineEvent.js';
import { DRAMA_SYSTEM_SPEAKER_ID, composeDramaSystemVisualPrompt, dramaSessionNeedsSystemVoice, dropDramaSystemVoice, isDramaSystemVoiceId, resolveDramaSystemVoice, sanitizeDramaCharacterIds, stripDramaSystemSpeakerCharacters, systemVoiceSampleUrl, } from './voiceEntity.js';
import { applyDramaSessionAssetImage } from './assetImageSync.js';
import { mergeDramaPipelineAssetsFromSession } from './projectToPipeline.js';
import { standardizeMinimaxH3VideoPrompt } from '../minimaxH3StandardizePrompt.js';
function assert(cond, msg) {
    if (!cond)
        throw new Error(msg);
}
function dTags(text) {
    return [...String(text || '').matchAll(/<d>\s*\[Chinese[^\]]*\]\s*([\s\S]*?)<\/d>/gi)].map((m) => String(m[1] || '').trim());
}
const jiang = createEmptyDramaCharacter({
    character_id: 'c-jiang',
    name: '江澈',
    voice_id: 'v-jiang',
    imageUrl: 'https://example.com/jiang.png',
});
const scene = createEmptyDramaSceneAsset({
    scene_id: 'sc-room',
    name: '房间',
    imageUrl: 'https://example.com/room.png',
});
const vJiang = createEmptyDramaVoice({
    voice_id: 'v-jiang',
    character_id: 'c-jiang',
    timbre: 'Jiang Che voice',
    sample_url: 'https://example.com/jiang.mp3',
});
const vSys = createEmptyDramaVoice({
    voice_id: 'v-system',
    character_id: DRAMA_SYSTEM_SPEAKER_ID,
    timbre: 'System voice',
    sample_url: 'https://example.com/system.mp3',
});
function sessionWithVoices(voices = [vJiang, vSys]) {
    return createEmptyDramaSession({
        active_episode_id: 'ep-sys',
        bible: {
            characters: [jiang],
            scenes: [scene],
            voices,
        },
    });
}
assert(isDramaSystemVoiceId('system'), 'system id');
assert(isDramaSystemVoiceId('SYSTEM'), 'SYSTEM id');
assert(isDramaSystemVoiceId('system_voice'), 'system_voice id');
assert(!isDramaSystemVoiceId('c-jiang'), 'jiang is not system id');
assert(JSON.stringify(sanitizeDramaCharacterIds(['system', 'c-jiang', '系统'])) ===
    JSON.stringify(['c-jiang']), 'character_ids must drop system');
assert(looksLikeDramaSystemSpokenText('系统：恭喜宿主获得新手礼包。'), 'label 系统：');
assert(looksLikeDramaSystemSpokenText('【系统】恭喜宿主获得新手礼包。'), 'label 【系统】');
assert(looksLikeDramaSystemSpokenText('SYSTEM: Host rewarded.'), 'label SYSTEM:');
assert(looksLikeDramaSystemSpokenText('系统提示：商城已开启。'), 'label 系统提示');
assert(looksLikeDramaInMindSystemVoice('江澈突然听见脑海中响起机械声音：“叮——检测到宿主已完成任务。”'), 'in-mind mechanical is system');
assert(!looksLikeDramaInMindSystemVoice('江澈心想：他真的来了。'), '心想 alone is not system');
assert(isDramaInnerOsCue('江澈心想：这下完了。'), '心想 is inner OS');
assert(!isDramaInnerOsCue('江澈突然听见脑海中响起机械声音'), 'in-mind mechanical is not inner OS');
assert(!looksLikeDramaSystemSpokenText('系统，你在吗？'), 'mentioning 系统 in speech is not a system label');
assert(!extractCharacterNamesFromScriptText('系统：恭喜宿主获得新手礼包。').includes('系统'), 'extract must not create 系统 character');
const parsedA = parseOriginalScript('系统：恭喜宿主获得新手礼包。', 'ep-a', ['江澈']);
const segA = parsedA.segments.find((s) => /恭喜宿主获得新手礼包/.test(s.original_text));
assert(segA, `Case A segment: ${JSON.stringify(parsedA.segments)}`);
assert(segA.type === 'system', `Case A type=${segA.type}`);
assert(segA.speaker_type === 'system', `Case A speaker_type=${segA.speaker_type}`);
assert(segA.character_name !== '江澈', 'Case A must not bind 江澈');
const vesA = buildVisualEventsFromOriginalSegments(parsedA.scenes, parsedA.segments);
const veSys = vesA.visualEvents.find((e) => (e.source_segment_ids || []).includes(segA.segment_id));
assert(veSys, 'Case A visual event');
assert(/全息系统面板/.test(String(veSys.action || '')), `Case A VE hologram: ${veSys.action}`);
assert(!/恭喜宿主/.test(String(veSys.action || '')), 'Case A VE action must not be spoken line');
const parsedD = parseOriginalScript('江澈心想：\n“这下完了。”', 'ep-d', ['江澈']);
assert(parsedD.segments.every((s) => s.type !== 'dialogue' && s.type !== 'system'), `Case D parse must not become dialogue/system: ${JSON.stringify(parsedD.segments)}`);
assert(parsedD.segments.some((s) => s.type === 'performance_direction' && s.performance === '内心OS'), `Case D must be 内心OS: ${JSON.stringify(parsedD.segments)}`);
const parsedE = parseOriginalScript('江澈：\n“系统，你在吗？”', 'ep-e', ['江澈']);
const segE = parsedE.segments.find((s) => /系统，你在吗/.test(s.original_text));
assert(segE, `Case E segment: ${JSON.stringify(parsedE.segments)}`);
assert(segE.type === 'dialogue', `Case E type=${segE.type}`);
assert(segE.character_name === '江澈', `Case E speaker=${segE.character_name}`);
assert(/系统，你在吗/.test(segE.original_text), 'Case E keep 系统 in speech');
// ---------- Case A：明确系统标签 ----------
const sessionA = sessionWithVoices([]);
const shotA = createEmptyDramaShot({
    shot_no: '1',
    duration_sec: 4,
    character_ids: [],
    scene_asset_id: 'sc-room',
    timeline_events: [
        createEmptyDramaTimelineEvent({
            start_sec: 0,
            end_sec: 4,
            dialogue: '系统：恭喜宿主获得新手礼包。',
            dialogue_character_id: 'system',
        }),
    ],
});
assert(!shotA.character_ids.includes('system'), 'Case A shot.character_ids no system');
assert(shotA.timeline_events[0].dialogue_character_id === 'system', 'Case A id=system');
assert(!shotA.timeline_events[0].character_ids.includes('system'), 'Case A event.character_ids no system');
const zhA = composeDramaShotLensTaggedPrompt(sessionA, shotA);
const enA = composeDramaShotH3EnglishPrompt(sessionA, shotA);
assert(/<d>\[Chinese\]恭喜宿主获得新手礼包/.test(zhA + enA), `Case A <d>: ${zhA}`);
assert(/系统/.test(zhA) && /恭喜宿主获得新手礼包/.test(zhA), `Case A zh system: ${zhA}`);
assert(/off-screen system voice|voice-over/i.test(enA), `Case A en system: ${enA}`);
assert(/not using any character Audio|not by any visible character/i.test(enA), `Case A no-character-audio: ${enA}`);
assert(!/<Subject 1>[\s\S]{0,80}<d>\[Chinese\]恭喜宿主/.test(enA), 'Case A no Subject 1 on system');
assert(!/江澈[\s\S]{0,40}<d>\[Chinese\]恭喜宿主/.test(zhA), 'Case A 江澈 must not speak system');
assert(!/使用 <Audio 1>[\s\S]{0,80}恭喜宿主/.test(zhA), 'Case A no character Audio 1');
assert(/全息系统面板|holographic system panel/i.test(zhA + enA), `Case A hologram visual: ${zhA}`);
// ---------- Case B：画面人物 + 系统声音 ----------
const sessionB = sessionWithVoices();
const shotB = createEmptyDramaShot({
    shot_no: '1',
    duration_sec: 8,
    character_ids: ['c-jiang'],
    scene_asset_id: 'sc-room',
    timeline_events: [
        createEmptyDramaTimelineEvent({
            start_sec: 0,
            end_sec: 4,
            character_ids: ['c-jiang'],
            visual_action: '江澈愣住',
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 4,
            end_sec: 8,
            character_ids: ['c-jiang'],
            dialogue: '系统：商城系统激活完毕。',
            dialogue_character_id: 'system',
        }),
    ],
});
assert(shotB.character_ids.includes('c-jiang'), 'Case B on-screen 江澈');
assert(!shotB.character_ids.includes('system'), 'Case B shot no system character');
assert(shotB.timeline_events[1].dialogue_character_id === 'system', 'Case B id=system');
assert(shotB.timeline_events[1].character_ids.includes('c-jiang'), 'Case B picture can keep 江澈');
const slotsB = listDramaShotRefAudioSlots(sessionB, shotB);
assert(!slotsB.some((s) => s.character_id === 'c-jiang'), `Case B 江澈未开口不得占槽: ${JSON.stringify(slotsB)}`);
assert(slotsB.some((s) => s.character_id === 'system'), `Case B system slot: ${JSON.stringify(slotsB)}`);
const zhB = composeDramaShotLensTaggedPrompt(sessionB, shotB);
const enB = composeDramaShotH3EnglishPrompt(sessionB, shotB);
assert(/System Voice = <Audio 1>/.test(enB), `Case B system identity: ${enB}`);
assert(/voice-timbre for off-screen system voice|voice timbre referenced from <Audio 1>/.test(enB), `Case B Audio 1 system: ${enB}`);
assert(/Never assign to any visible character|NEVER be assigned to any visible character/.test(enB), `Case B never assign: ${enB}`);
assert(/voice timbre referenced from <Audio 1>|voice-timbre for off-screen system voice/.test(enB), `Case B system uses Audio 1: ${enB}`);
assert(/<Audio 1>(?:\: reference -| \(Picture = NONE)/.test(enB), `Case B Audio 1 official reference marker: ${enB}`);
assert(/off-screen system voice \(S\d+\)|off-screen system voice/.test(enB), `Case B system speaker id: ${enB}`);
assert(/mouth closed|lips remain completely closed|must NOT lip-sync|Lip-sync:\s*none/i.test(enB), `Case B no lip-sync on system: ${enB}`);
assert(/系统/.test(zhB) && /商城系统激活完毕/.test(zhB), `Case B zh system plain: ${zhB}`);
assert(/voice timbre referenced from <Audio 1>|voice-timbre for off-screen system voice/.test(enB), `Case B en Audio 1 on system: ${enB}`);
assert(!/<Subject 1>[\s\S]{0,80}<d>\[Chinese\]商城系统激活完毕/.test(enB), 'Case B 江澈 not system');
assert(!/<Subject\s+\d+>[\s\S]{0,80}<d>\[Chinese\]商城系统激活完毕/.test(zhB), `Case B zh Subject not system: ${zhB}`);
assert(!/江澈[\s\S]{0,40}<d>\[Chinese\]商城系统激活完毕/.test(zhB), `Case B zh 江澈 not system: ${zhB}`);
assert(/<d>\[Chinese\]商城系统激活完毕/.test(zhB + enB), `Case B spoken text: ${zhB}`);
assert(/全息系统面板|holographic system panel/i.test(zhB + enB), `Case B hologram visual: ${zhB}`);
const enBScaled = composeDramaShotH3EnglishPrompt(sessionB, shotB, { durationSec: 4 });
assert(/At 00:02/.test(enBScaled), `出片档缩短应对齐时间戳: ${enBScaled}`);
assert(!/At 00:04/.test(enBScaled), `缩短后不应再出现原 4s 时间戳: ${enBScaled}`);
const enBStd = standardizeMinimaxH3VideoPrompt(enB);
assert((enBStd.match(/generate accurate lip-sync/gi) || []).length === 1, `standardize must not stack a second lip-sync rule: ${enBStd}`);
assert(!/When Subject 1 speaks, generate accurate lip-sync matching his spoken dialogue/.test(enBStd), 'standardize must not inject old all-speech lip-sync');
assert(/mouth closed|lips remain completely closed|must NOT lip-sync|Lip-sync:\s*none|off-screen voiceover/i.test(enBStd), `standardize keep system silence: ${enBStd}`);
// ---------- Case C：脑海中的系统 ----------
const veC = createEmptyDramaVisualEvent({
    event_id: 've-mind',
    who: '江澈',
    kind: 'dialogue',
    action: '江澈突然听见脑海中响起机械声音：“叮——检测到宿主已完成任务。”',
    original_text: '江澈突然听见脑海中响起机械声音：“叮——检测到宿主已完成任务。”',
    see: '脑海中',
});
const sessionC = createEmptyDramaSession({
    active_episode_id: 'ep-c',
    bible: {
        characters: [jiang],
        scenes: [scene],
        voices: [vJiang, vSys],
    },
    episode_bibles: {
        'ep-c': createEmptyDramaEpisodeBible({
            episode_id: 'ep-c',
            visual_events: [veC],
        }),
    },
});
const mappedC = buildTimelineEventsFromVisualEvents(sessionC, createEmptyDramaShot({
    shot_no: '1',
    duration_sec: 4,
    character_ids: ['c-jiang'],
    visual_event_ids: ['ve-mind'],
    scene_asset_id: 'sc-room',
}));
const evC = mappedC.find((e) => e.dialogue) || mappedC[0];
assert(evC, `Case C mapped: ${JSON.stringify(mappedC)}`);
assert(evC.dialogue_character_id === 'system', `Case C id=${evC.dialogue_character_id}`);
assert(!String(evC.eyeline || '').trim(), `Case C eyeline must be empty: ${evC.eyeline}`);
assert(!evC.character_ids.includes('system'), 'Case C character_ids no system');
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
            visual_action: '江澈突然听见脑海中响起机械声音',
            dialogue: '叮——检测到宿主已完成任务。',
            dialogue_character_id: 'system',
            eyeline: '脑海中',
        }),
    ],
});
const zhC = composeDramaShotLensTaggedPrompt(sessionC, shotC);
assert(!/视线/.test(zhC), `Case C compiler no eyeline: ${zhC}`);
assert(/系统/.test(zhC), `Case C system: ${zhC}`);
assert(/叮——检测到宿主已完成任务/.test(zhC), `Case C spoken: ${zhC}`);
// ---------- Case D：内心 OS ----------
const rawD = createEmptyDramaTimelineEvent({
    start_sec: 0,
    end_sec: 3,
    character_ids: ['c-jiang'],
    dialogue: '江澈心想：这下完了。',
    dialogue_character_id: 'c-jiang',
    expression: '内心OS',
});
const hydD = hydrateDramaTimelineEventDialogue(rawD, 'c-jiang');
assert(!hydD.dialogue, `Case D dialogue cleared: ${hydD.dialogue}`);
assert(hydD.dialogue_character_id !== 'c-jiang', `Case D id=${hydD.dialogue_character_id}`);
assert(hydD.dialogue_character_id !== 'system', 'Case D must not become system');
const shotD = createEmptyDramaShot({
    shot_no: '1',
    duration_sec: 4,
    character_ids: ['c-jiang'],
    scene_asset_id: 'sc-room',
    timeline_events: [rawD],
});
const zhD = composeDramaShotLensTaggedPrompt(sessionWithVoices(), shotD);
const enD = composeDramaShotH3EnglishPrompt(sessionWithVoices(), shotD);
assert(!dTags(zhD + enD).some((t) => /这下完了/.test(t)), `Case D no <d>: ${zhD}\n${enD}`);
assert(!/off-screen narrator|off-screen system voice|voice-over narration/i.test(enD), `Case D not offscreen: ${enD}`);
// ---------- Case E：人物台词提到“系统” ----------
const shotE = createEmptyDramaShot({
    shot_no: '1',
    duration_sec: 4,
    character_ids: ['c-jiang'],
    scene_asset_id: 'sc-room',
    timeline_events: [
        createEmptyDramaTimelineEvent({
            start_sec: 0,
            end_sec: 4,
            character_ids: ['c-jiang'],
            dialogue: '系统，你在吗？',
            dialogue_character_id: 'c-jiang',
            lip_sync: true,
        }),
    ],
});
assert(shotE.timeline_events[0].dialogue_character_id === 'c-jiang', 'Case E id=jiangche');
const zhE = composeDramaShotLensTaggedPrompt(sessionWithVoices(), shotE);
const enE = composeDramaShotH3EnglishPrompt(sessionWithVoices(), shotE);
assert(/<d>\[Chinese\]系统，你在吗？<\/d>/.test(zhE + enE), `Case E keep wording: ${zhE}`);
assert(!/system voice, using/.test(enE), `Case E not system audio: ${enE}`);
assert(/江澈/.test(zhE), `Case E 江澈 speaks: ${zhE}`);
const emptySys = createEmptyDramaSession({ bible: { characters: [jiang], voices: [] } });
const ensured = ensureDramaSystemVoice(emptySys);
const sysVoice = resolveDramaSystemVoice(ensured);
assert(sysVoice, 'ensure creates system voice');
assert(sysVoice.character_id === 'system', `system voice id=${sysVoice.character_id}`);
assert(!ensured.bible.characters.some((c) => c.character_id === 'system' || c.name === '系统'), 'ensure must not create 系统 Character');
assert(ensureDramaSystemVoice(ensured) === ensured, 'ensure is idempotent');
const fakeSysChar = createEmptyDramaCharacter({
    character_id: 'c-system-prompt',
    name: '系统提示音（机械女声，脑海中响起）',
    imageUrl: 'https://example.com/should-not-keep.png',
});
const withFakeLook = createEmptyDramaSession({
    bible: { characters: [jiang, fakeSysChar], voices: [vJiang] },
    shots: [
        createEmptyDramaShot({
            shot_id: 'sh-sys-img',
            shot_no: '1',
            character_ids: ['c-jiang', 'c-system-prompt'],
        }),
    ],
});
const strippedLook = stripDramaSystemSpeakerCharacters(withFakeLook);
assert(!strippedLook.bible.characters.some((c) => c.character_id === 'c-system-prompt' || /系统提示/.test(c.name)), 'strip must drop 系统提示音 character even with imageUrl');
assert(strippedLook.bible.characters.some((c) => c.character_id === 'c-jiang'), 'strip must keep 江澈');
assert(!strippedLook.shots[0].character_ids.includes('c-system-prompt'), 'strip must drop system from shot.character_ids');
const withSysVoiceAndFake = createEmptyDramaSession({
    bible: {
        characters: [jiang, fakeSysChar],
        voices: [vJiang, createDramaSystemVoice()],
    },
});
const strippedMigrate = stripDramaSystemSpeakerCharacters(withSysVoiceAndFake);
const migratedSys = resolveDramaSystemVoice(strippedMigrate);
assert(String(migratedSys?.imageUrl || '') === 'https://example.com/should-not-keep.png', 'strip must migrate system look onto system voice');
const imaged = applyDramaSessionAssetImage(ensureDramaSystemVoice(emptySys), 'system', {
    imageUrl: 'https://example.com/system-holo.png',
    status: 'ready',
});
assert(imaged, 'apply system image must succeed');
assert(String(resolveDramaSystemVoice(imaged)?.imageUrl || '') === 'https://example.com/system-holo.png', 'system imageUrl lives on voice');
assert(!imaged.bible.characters.some((c) => c.character_id === 'system' || /系统提示/.test(c.name)), 'system image must not create character card');
const pipeAssets = mergeDramaPipelineAssetsFromSession(imaged);
assert(pipeAssets.characters.some((a) => a.id === 'system' && a.imageUrl === 'https://example.com/system-holo.png'), 'pipeline must expose system visual asset');
const customPromptSession = createEmptyDramaSession({
    bible: {
        characters: [jiang],
        voices: [
            createDramaSystemVoice({
                image_prompt: '冷青光悬浮终端，只有抽象圆环，不要人脸',
            }),
        ],
    },
});
const customSys = resolveDramaSystemVoice(customPromptSession);
assert(composeDramaSystemVisualPrompt(customSys?.image_prompt) ===
    '冷青光悬浮终端，只有抽象圆环，不要人脸', 'compose must keep short user image_prompt verbatim');
const customPipe = mergeDramaPipelineAssetsFromSession(customPromptSession);
assert(customPipe.characters.some((a) => a.id === 'system' && a.prompt === '冷青光悬浮终端，只有抽象圆环，不要人脸'), 'pipeline prompt must follow edited system image_prompt');
const rebound = ensureAppearingCharactersInBible(withFakeLook);
assert(!rebound.bible.characters.some((c) => /系统提示/.test(c.name) || c.character_id === 'c-system-prompt'), 'ensureAppearing must not keep 系统提示音 card');
assert(rebound.bible.characters.some((c) => c.character_id === 'c-jiang'), 'ensureAppearing must keep 江澈');
const pinned = createDramaSystemVoice({
    sample_url: 'https://example.com/fixed-system.mp3',
});
assert(systemVoiceSampleUrl(pinned) === 'https://example.com/fixed-system.mp3', 'system sample url');
assert(/机械电子播报/.test(pinned.sample_text || pinned.timbre), 'system timbre locked');
const noSysScript = createEmptyDramaSession({
    bible: {
        characters: [jiang],
        voices: [vJiang, createDramaSystemVoice()],
    },
    meta: { source_script: '江澈站在窗边。\n江澈：今天天气不错。' },
    episodes: [
        {
            episode_id: 'ep1',
            episode_no: 1,
            title: '1',
            text: '江澈站在窗边。\n江澈：今天天气不错。',
            analyzed: false,
            updated_at: 0,
        },
    ],
    active_episode_id: 'ep1',
});
assert(!dramaSessionNeedsSystemVoice(noSysScript), 'plain script needs no system voice');
const syncedAway = syncDramaSystemVoice(noSysScript);
assert(!resolveDramaSystemVoice(syncedAway), 'sync must drop system voice when script has none');
const appearedNoSys = ensureAppearingCharactersInBible(noSysScript);
assert(!resolveDramaSystemVoice(appearedNoSys), 'ensureAppearing must not keep system voice without script');
assert(!appearedNoSys.bible.characters.some((c) => /系统提示/.test(c.name)), 'ensureAppearing must not invent 系统提示音 character');
const withSysScript = createEmptyDramaSession({
    bible: { characters: [jiang], voices: [vJiang] },
    meta: {
        source_script: '【系统提示音（机械女声，脑海中响起）】\n恭喜宿主激活系统。\n江澈：什么声音？',
    },
    episodes: [
        {
            episode_id: 'ep1',
            episode_no: 1,
            title: '1',
            text: '【系统提示音（机械女声，脑海中响起）】\n恭喜宿主激活系统。\n江澈：什么声音？',
            analyzed: false,
            updated_at: 0,
        },
    ],
    active_episode_id: 'ep1',
});
assert(dramaSessionNeedsSystemVoice(withSysScript), 'system heading script needs system voice');
const syncedIn = syncDramaSystemVoice(withSysScript);
assert(resolveDramaSystemVoice(syncedIn), 'sync must create system voice when script has it');
assert(!resolveDramaSystemVoice(dropDramaSystemVoice(syncedIn)), 'drop clears');
const mentionOnly = createEmptyDramaSession({
    bible: { characters: [jiang], voices: [vJiang, createDramaSystemVoice()] },
    meta: {
        source_script: '江澈看着屏幕。\n江澈：系统，你在吗？\n林沐然：别喊系统了。',
    },
    episodes: [
        {
            episode_id: 'ep1',
            episode_no: 1,
            title: '1',
            text: '江澈看着屏幕。\n江澈：系统，你在吗？\n林沐然：别喊系统了。',
            analyzed: false,
            updated_at: 0,
        },
    ],
    active_episode_id: 'ep1',
});
assert(!dramaSessionNeedsSystemVoice(mentionOnly), 'mentioning 系统 in dialogue must not need system voice card');
assert(!resolveDramaSystemVoice(syncDramaSystemVoice(mentionOnly)), 'sync must drop system voice for mention-only script');
const analyzedNoSys = createEmptyDramaSession({
    bible: { characters: [jiang], voices: [vJiang, createDramaSystemVoice()] },
    meta: { source_script: '系统：这行不该再触发，因为已有原文分析。' },
    episodes: [
        {
            episode_id: 'ep1',
            episode_no: 1,
            title: '1',
            text: '江澈：今天天气不错。',
            analyzed: true,
            updated_at: 0,
        },
    ],
    active_episode_id: 'ep1',
    episode_bibles: {
        ep1: createEmptyDramaEpisodeBible({
            episode_id: 'ep1',
            original_segments: [
                {
                    segment_id: 's1',
                    type: 'dialogue',
                    original_text: '江澈：今天天气不错。',
                    character_name: '江澈',
                    speaker_type: 'character',
                },
            ],
        }),
    },
});
assert(!dramaSessionNeedsSystemVoice(analyzedNoSys), 'with original_segments, stale source_script system line must not force card');
const narrationOnly = createEmptyDramaSession({
    bible: { characters: [jiang], voices: [vJiang, createDramaSystemVoice()] },
    meta: { source_script: '【旁白】夜色很深。\n江澈站在窗边。' },
    episodes: [
        {
            episode_id: 'ep1',
            episode_no: 1,
            title: '1',
            text: '【旁白】夜色很深。\n江澈站在窗边。',
            analyzed: true,
            updated_at: 0,
        },
    ],
    active_episode_id: 'ep1',
    shots: [
        createEmptyDramaShot({
            shot_no: '1',
            duration_sec: 4,
            character_ids: ['c-jiang'],
            timeline_events: [
                createEmptyDramaTimelineEvent({
                    start_sec: 0,
                    end_sec: 4,
                    dialogue: '夜色很深。',
                    dialogue_character_id: 'system',
                }),
            ],
        }),
    ],
    episode_bibles: {
        ep1: createEmptyDramaEpisodeBible({
            episode_id: 'ep1',
            original_segments: [
                {
                    segment_id: 'n1',
                    type: 'narration',
                    original_text: '【旁白】夜色很深。',
                    character_name: '旁白',
                    speaker_type: 'narration',
                },
                {
                    segment_id: 'a1',
                    type: 'action',
                    original_text: '江澈站在窗边。',
                },
            ],
        }),
    },
});
assert(!dramaSessionNeedsSystemVoice(narrationOnly), '旁白复用 system 槽不得弹出系统提示音卡');
assert(!resolveDramaSystemVoice(syncDramaSystemVoice(narrationOnly)), '旁白剧本 sync 应去掉系统提示音 Voice');
console.log('systemVoice.selftest ok');
