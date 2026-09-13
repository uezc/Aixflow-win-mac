/**
 * 声音绑定最终收口：Compiler + Audio Mapping 硬断言。
 * 复用 Isolation / systemVoice 夹具，不新建 Voice 系统。
 * 运行：npx tsx src/shared/directorDomain/p1VoiceBinding.selftest.ts
 * 不调用真实 H3 / RunningHub。
 */
import { composeDramaShotH3EnglishPrompt, resolveDramaLensSubjects, resolveDramaProductionH3Prompt, sealDramaProductionCloudPrompt, } from './composeDramaShotLensPrompt.js';
import { compileDramaShotVideoRequest } from './compileDramaShotVideoRequest.js';
import { createEmptyDramaCharacter, createEmptyDramaProp, createEmptyDramaSceneAsset, createEmptyDramaSession, createEmptyDramaShot, createEmptyDramaVoice, } from './factories.js';
import { createEmptyDramaTimelineEvent } from './timelineEvent.js';
import { listDramaShotRefAudioSlots, listDramaShotRefImageSlots } from './shotRefs.js';
import { attachDramaVoiceBindingPictures, audioIndexForVoiceEntity, buildDramaShotVoiceBindingTable, resolveSpokenLineVoiceRole, } from './voiceBinding.js';
import { DRAMA_NARRATOR_SPEAKER_ID, DRAMA_SYSTEM_SPEAKER_ID } from './voiceEntity.js';
import { looksLikeDramaSystemSpokenText } from './extractCastFromScript.js';
import { reinjectSpokenLinesIntoH3SkillPrompt } from '../minimaxH3OptimizePrompt.js';
function assert(cond, msg) {
    if (!cond)
        throw new Error(msg);
}
const scene = createEmptyDramaSceneAsset({
    scene_id: 'sc-office',
    name: '漫小施办公室',
    imageUrl: 'https://example.com/office.png',
});
const c1 = createEmptyDramaCharacter({
    character_id: 'c1',
    name: '苏念晴',
    voice_id: 'v-c1',
    imageUrl: 'https://example.com/c1.png',
});
const c2 = createEmptyDramaCharacter({
    character_id: 'c2',
    name: '江澈',
    voice_id: 'v-c2',
    imageUrl: 'https://example.com/c2.png',
});
const c7 = createEmptyDramaCharacter({
    character_id: 'c7',
    name: '樱花',
    voice_id: 'v-c7',
    imageUrl: 'https://example.com/c7.png',
});
const vC1 = createEmptyDramaVoice({
    voice_id: 'v-c1',
    character_id: 'c1',
    sample_url: 'https://example.com/c1.mp3',
});
const vC2 = createEmptyDramaVoice({
    voice_id: 'v-c2',
    character_id: 'c2',
    sample_url: 'https://example.com/c2.mp3',
});
const vC7 = createEmptyDramaVoice({
    voice_id: 'v-c7',
    character_id: 'c7',
    sample_url: 'https://example.com/c7.mp3',
});
const vSys = createEmptyDramaVoice({
    voice_id: 'v-system',
    character_id: DRAMA_SYSTEM_SPEAKER_ID,
    sample_url: 'https://example.com/system.mp3',
});
const vNar = createEmptyDramaVoice({
    voice_id: 'v-narrator',
    character_id: DRAMA_NARRATOR_SPEAKER_ID,
    sample_url: 'https://example.com/narrator.mp3',
});
const phone = createEmptyDramaProp({
    prop_id: 'p1',
    name: '手机',
    imageUrl: 'https://example.com/phone.png',
});
function sessionOf(chars, voices, extra) {
    return createEmptyDramaSession({
        bible: {
            characters: chars,
            scenes: [scene],
            voices,
            props: extra?.props || [],
        },
    });
}
function ev(partial) {
    return createEmptyDramaTimelineEvent(partial);
}
function tableOf(session, shot) {
    const raw = buildDramaShotVoiceBindingTable(session, shot, 3);
    const pics = listDramaShotRefImageSlots(session, shot);
    const lens = resolveDramaLensSubjects(session, shot);
    return {
        ...raw,
        rows: attachDramaVoiceBindingPictures(raw.rows, pics.map((s) => ({ index: s.index, asset_id: s.asset_id, role: s.role })), lens.subjects.map((s) => ({ n: s.n, character_id: s.character_id }))),
    };
}
function row(table, id) {
    return table.rows.find((r) => r.entity_id === id);
}
function cloudPrompt(session, shot) {
    const src = resolveDramaProductionH3Prompt(session, shot);
    return sealDramaProductionCloudPrompt(src, { hasDialogue: true });
}
function blockAroundD(prompt, spoken) {
    const idx = prompt.indexOf(`<d>[Chinese]${spoken}`);
    if (idx < 0)
        return '';
    const head = prompt.slice(0, idx);
    const start = Math.max(head.lastIndexOf('[Shot'), 0);
    const close = prompt.indexOf('</d>', idx);
    const tail = prompt.slice(close >= 0 ? close : idx, (close >= 0 ? close : idx) + 200);
    const nextShot = tail.indexOf('\n[Shot');
    const end = (close >= 0 ? close : idx) + (nextShot >= 0 ? nextShot : Math.min(tail.length, 160));
    return prompt.slice(start, end);
}
function assertNoGenericReinject(prompt, label) {
    assert(!/The on-camera speaker,/i.test(prompt), `${label} 不得退化成 generic on-camera speaker`);
    assert(!/The off-screen narrator, not by any visible character, delivers voice-over narration/i.test(prompt), `${label} 不得把系统退化成 generic narrator`);
}
function assertPromptAudioMatchesInput(session, shot, label) {
    const compiled = compileDramaShotVideoRequest(session, shot, { mode: 'h3-multi' });
    const sealed = compiled.audit.api.production_prompt;
    assert(!!sealed, `${label} production_prompt`);
    assertNoGenericReinject(sealed, label);
    const slots = listDramaShotRefAudioSlots(session, shot);
    assert(compiled.inputAudios.length === slots.length, `${label} inputAudios length`);
    for (let i = 0; i < slots.length; i++) {
        const n = i + 1;
        assert(compiled.inputAudios[i] === slots[i].sample_url, `${label} inputAudios[${i}] !== Audio ${n} url`);
        const entity = slots[i].character_id;
        if (entity === DRAMA_SYSTEM_SPEAKER_ID) {
            assert(new RegExp(`<Audio ${n}> is the voice-timbre reference for the off-screen system voice`).test(sealed), `${label} Prompt Audio ${n} must be System`);
        }
        else if (entity === DRAMA_NARRATOR_SPEAKER_ID) {
            assert(new RegExp(`<Audio ${n}> is the voice-timbre reference for the off-screen narrator`).test(sealed), `${label} Prompt Audio ${n} must be Narrator`);
        }
        else {
            const sub = resolveDramaLensSubjects(session, shot).subjectByCharacterId.get(entity);
            assert(sub, `${label} subject for ${entity}`);
            assert(new RegExp(`<Audio ${n}> is the voice-timbre reference for ${sub.tag}`).test(sealed) ||
                new RegExp(`Audio ${n} = .* voice`).test(sealed), `${label} Prompt Audio ${n} must bind ${entity} / ${sub.tag}`);
        }
    }
}
// ---------- CASE A 单人物 ----------
{
    const session = sessionOf([c1], [vC1]);
    const shot = createEmptyDramaShot({
        shot_no: 'A',
        duration_sec: 4,
        character_ids: ['c1'],
        scene_asset_id: 'sc-office',
        timeline_events: [
            ev({
                start_sec: 0,
                end_sec: 4,
                character_ids: ['c1'],
                dialogue: '我是苏念晴。',
                dialogue_character_id: 'c1',
                lip_sync: true,
            }),
        ],
    });
    const t = tableOf(session, shot);
    const r = row(t, 'c1');
    const lens = resolveDramaLensSubjects(session, shot);
    const sub = lens.subjectByCharacterId.get('c1');
    assert(r?.audio === 1 && sub?.n === 1, `A C1→Audio1→Subject1 audio=${r?.audio} sub=${sub?.n}`);
    const en = cloudPrompt(session, shot);
    const blk = blockAroundD(en, '我是苏念晴。');
    assert(/<Subject 1>/.test(blk), `A lip-sync Subject 1: ${blk}`);
    assert(/<Audio 1>/.test(blk), `A uses Audio 1: ${blk}`);
    assert(/says:\s*<d>\[Chinese\]/.test(blk), `A official says: ${blk}`);
    assertPromptAudioMatchesInput(session, shot, 'A');
}
// ---------- CASE B 双人物 ----------
{
    const session = sessionOf([c1, c2], [vC1, vC2]);
    const shot = createEmptyDramaShot({
        shot_no: 'B',
        duration_sec: 6,
        character_ids: ['c1', 'c2'],
        scene_asset_id: 'sc-office',
        timeline_events: [
            ev({
                start_sec: 0,
                end_sec: 3,
                character_ids: ['c1', 'c2'],
                dialogue: '苏念晴先说。',
                dialogue_character_id: 'c1',
                lip_sync: true,
            }),
            ev({
                start_sec: 3,
                end_sec: 6,
                character_ids: ['c1', 'c2'],
                dialogue: '江澈后说。',
                dialogue_character_id: 'c2',
                lip_sync: true,
            }),
        ],
    });
    const t = tableOf(session, shot);
    assert(row(t, 'c1')?.audio === 1, 'B C1 Audio 1');
    assert(row(t, 'c2')?.audio === 2, 'B C2 Audio 2');
    const en = cloudPrompt(session, shot);
    const b1 = blockAroundD(en, '苏念晴先说。');
    const b2 = blockAroundD(en, '江澈后说。');
    assert(/<Audio 1>/.test(b1) && !/<Audio 2>/.test(b1), `B C1 not Audio 2: ${b1}`);
    assert(/<Audio 2>/.test(b2) && !/<Audio 1>/.test(b2), `B C2 not Audio 1: ${b2}`);
    assert(/<Subject 1>/.test(b1), 'B C1 Subject 1');
    assert(/<Subject 2>/.test(b2), 'B C2 Subject 2');
    assertPromptAudioMatchesInput(session, shot, 'B');
}
// ---------- CASE C 人物 + 系统 ----------
{
    const session = sessionOf([c1], [vC1, vSys]);
    const shot = createEmptyDramaShot({
        shot_no: 'C',
        duration_sec: 6,
        character_ids: ['c1'],
        scene_asset_id: 'sc-office',
        timeline_events: [
            ev({
                start_sec: 0,
                end_sec: 3,
                character_ids: ['c1'],
                dialogue: '我先开口。',
                dialogue_character_id: 'c1',
                lip_sync: true,
            }),
            ev({
                start_sec: 3,
                end_sec: 6,
                character_ids: ['c1'],
                dialogue: '叮——系统激活。',
                dialogue_character_id: 'system',
            }),
        ],
    });
    const t = tableOf(session, shot);
    assert(row(t, 'c1')?.audio === 1 && row(t, 'c1')?.subject === 1, 'C C1 Audio1 Subject1');
    assert(row(t, 'system')?.audio === 2, 'C SYSTEM Audio 2');
    assert(row(t, 'system')?.subject == null && row(t, 'system')?.picture == null, 'C system no pic/sub');
    const en = cloudPrompt(session, shot);
    const sysBlk = blockAroundD(en, '叮——系统激活。');
    assert(/off-screen system voice/i.test(sysBlk), `C system off-screen: ${sysBlk}`);
    assert(/<Audio 2>/.test(sysBlk), `C system Audio 2: ${sysBlk}`);
    assert(/mouth closed|do not lip-sync|lips remain completely closed/i.test(sysBlk), `C no lip-sync: ${sysBlk}`);
    assert(!/<Subject 1>[\s\S]{0,80}<d>\[Chinese\]叮——系统激活/.test(en), 'C Subject 1 not system line');
    assertPromptAudioMatchesInput(session, shot, 'C');
}
// ---------- CASE D 人物 + 旁白 ----------
{
    const session = sessionOf([c1], [vC1, vNar]);
    const shot = createEmptyDramaShot({
        shot_no: 'D',
        duration_sec: 6,
        character_ids: ['c1'],
        scene_asset_id: 'sc-office',
        timeline_events: [
            ev({
                start_sec: 0,
                end_sec: 3,
                character_ids: ['c1'],
                dialogue: '我在场。',
                dialogue_character_id: 'c1',
                lip_sync: true,
            }),
            ev({
                start_sec: 3,
                end_sec: 6,
                character_ids: ['c1'],
                dialogue: '很多年以后。',
                dialogue_character_id: 'narrator',
            }),
        ],
    });
    const t = tableOf(session, shot);
    assert(row(t, 'c1')?.audio === 1, 'D C1 Audio 1');
    assert(row(t, 'narrator')?.audio === 2, 'D NARRATOR Audio 2');
    assert(row(t, 'narrator')?.subject == null, 'D narrator no subject');
    const en = cloudPrompt(session, shot);
    const narBlk = blockAroundD(en, '很多年以后。');
    assert(/off-screen narrator/i.test(narBlk), `D narrator: ${narBlk}`);
    assert(/<Audio 2>/.test(narBlk), `D narrator Audio 2: ${narBlk}`);
    assert(/mouth closed|do not lip-sync|lips remain completely closed/i.test(narBlk), `D no lip-sync: ${narBlk}`);
    assert(!/<Subject 1>[\s\S]{0,80}<d>\[Chinese\]很多年以后/.test(en), 'D Subject 1 not narrator');
    assertPromptAudioMatchesInput(session, shot, 'D');
}
// ---------- CASE E 人物 + 系统 + 旁白 ----------
{
    const session = sessionOf([c1], [vC1, vSys, vNar]);
    const shot = createEmptyDramaShot({
        shot_no: 'E',
        duration_sec: 9,
        character_ids: ['c1'],
        scene_asset_id: 'sc-office',
        timeline_events: [
            ev({
                start_sec: 0,
                end_sec: 3,
                character_ids: ['c1'],
                dialogue: '人物句。',
                dialogue_character_id: 'c1',
                lip_sync: true,
            }),
            ev({
                start_sec: 3,
                end_sec: 6,
                character_ids: ['c1'],
                dialogue: '叮——系统句。',
                dialogue_character_id: 'system',
            }),
            ev({
                start_sec: 6,
                end_sec: 9,
                character_ids: ['c1'],
                dialogue: '旁白句。',
                dialogue_character_id: 'narrator',
            }),
        ],
    });
    const t = tableOf(session, shot);
    assert(row(t, 'c1')?.audio === 1, 'E C1 Audio 1');
    assert(row(t, 'system')?.audio === 2, 'E SYSTEM Audio 2');
    assert(row(t, 'narrator')?.audio === 3, 'E NARRATOR Audio 3');
    const ids = new Set([row(t, 'c1')?.audio, row(t, 'system')?.audio, row(t, 'narrator')?.audio].filter(Boolean));
    assert(ids.size === 3, 'E three isolated slots');
    const en = cloudPrompt(session, shot);
    assert(/<Audio 1>/.test(blockAroundD(en, '人物句。')), 'E char Audio 1');
    assert(/off-screen system voice[\s\S]{0,120}<Audio 2>|<Audio 2>[\s\S]{0,80}叮——系统句/.test(en), 'E sys Audio 2');
    assert(/off-screen narrator[\s\S]{0,120}<Audio 3>|<Audio 3>[\s\S]{0,80}旁白句/.test(en), 'E nar Audio 3');
    assert(!/<Subject 1>[\s\S]{0,80}<d>\[Chinese\]叮——系统句/.test(en), 'E no char lip-sync system');
    assert(!/<Subject 1>[\s\S]{0,80}<d>\[Chinese\]旁白句/.test(en), 'E no char lip-sync narrator');
    assertPromptAudioMatchesInput(session, shot, 'E');
}
// ---------- CASE F 台词里出现「系统」仍是人物 ----------
{
    const session = sessionOf([c1], [vC1, vSys]);
    const shot = createEmptyDramaShot({
        shot_no: 'F',
        duration_sec: 4,
        character_ids: ['c1'],
        scene_asset_id: 'sc-office',
        timeline_events: [
            ev({
                start_sec: 0,
                end_sec: 4,
                character_ids: ['c1'],
                dialogue: '系统，你在吗？',
                dialogue_character_id: 'c1',
                lip_sync: true,
            }),
        ],
    });
    assert(resolveSpokenLineVoiceRole('c1', '苏念晴', '系统，你在吗？') === 'character', 'F role');
    assert(!looksLikeDramaSystemSpokenText('系统，你在吗？'), 'F heuristic');
    const t = tableOf(session, shot);
    assert(row(t, 'c1')?.audio === 1, 'F C1 Audio 1');
    assert(!row(t, 'system'), 'F 不得建 System entity');
    const en = cloudPrompt(session, shot);
    const blk = blockAroundD(en, '系统，你在吗？');
    assert(/<Subject 1>/.test(blk), `F lip-sync C1: ${blk}`);
    assert(/<Audio 1>/.test(blk), `F C1 Audio: ${blk}`);
    assert(/says:\s*<d>\[Chinese\]/.test(blk), `F char official says: ${blk}`);
    assert(!/off-screen system voice[\s\S]{0,80}系统，你在吗/.test(en), 'F not system voice');
    assertPromptAudioMatchesInput(session, shot, 'F');
}
// ---------- CASE G 真系统台词 ----------
{
    const session = sessionOf([c1], [vC1, vSys]);
    const shot = createEmptyDramaShot({
        shot_no: 'G',
        duration_sec: 4,
        character_ids: ['c1'],
        scene_asset_id: 'sc-office',
        timeline_events: [
            ev({
                start_sec: 0,
                end_sec: 4,
                character_ids: ['c1'],
                dialogue: '恭喜宿主获得奖励。',
                dialogue_character_id: 'system',
            }),
        ],
    });
    const t = tableOf(session, shot);
    assert(row(t, 'system')?.audio === 1, 'G only system speaking → Audio 1');
    assert(!row(t, 'c1'), 'G C1 未开口');
    const en = cloudPrompt(session, shot);
    const blk = blockAroundD(en, '恭喜宿主获得奖励。');
    assert(/off-screen system voice/i.test(blk), `G off-screen: ${blk}`);
    assert(/<Audio 1>/.test(blk), `G System Audio: ${blk}`);
    assert(/mouth closed|do not lip-sync|lips remain completely closed/i.test(blk), `G no lip-sync: ${blk}`);
    assert(!/<Subject 1>[\s\S]{0,80}<d>\[Chinese\]恭喜宿主获得奖励/.test(en), 'G no visible lip-sync');
    assertPromptAudioMatchesInput(session, shot, 'G');
}
// ---------- CASE H 旁白 ----------
{
    const session = sessionOf([c1], [vC1, vNar]);
    const shot = createEmptyDramaShot({
        shot_no: 'H',
        duration_sec: 4,
        character_ids: ['c1'],
        scene_asset_id: 'sc-office',
        timeline_events: [
            ev({
                start_sec: 0,
                end_sec: 4,
                character_ids: ['c1'],
                dialogue: '很多年以后……',
                dialogue_character_id: 'narrator',
            }),
        ],
    });
    const t = tableOf(session, shot);
    assert(row(t, 'narrator')?.audio === 1, 'H narrator Audio 1');
    const en = cloudPrompt(session, shot);
    const blk = blockAroundD(en, '很多年以后……');
    assert(/off-screen narrator/i.test(blk), `H off-screen: ${blk}`);
    assert(/<Audio 1>/.test(blk), `H Narrator Audio: ${blk}`);
    assert(/mouth closed|do not lip-sync|lips remain completely closed/i.test(blk), `H no lip-sync: ${blk}`);
    assert(!/<Subject 1>[\s\S]{0,80}<d>\[Chinese\]很多年以后/.test(en), 'H no visible lip-sync');
    assertPromptAudioMatchesInput(session, shot, 'H');
}
// ---------- CASE I 系统无参考音 ----------
{
    const session = sessionOf([c1], [vC1]);
    const shot = createEmptyDramaShot({
        shot_no: 'I',
        duration_sec: 4,
        character_ids: ['c1'],
        scene_asset_id: 'sc-office',
        timeline_events: [
            ev({
                start_sec: 0,
                end_sec: 4,
                character_ids: ['c1'],
                dialogue: '叮——系统激活。',
                dialogue_character_id: 'system',
            }),
        ],
    });
    const t = tableOf(session, shot);
    assert(row(t, 'system')?.missing_voice, 'I missing system voice');
    assert(row(t, 'system')?.audio == null, 'I no fallback Audio');
    const slots = listDramaShotRefAudioSlots(session, shot);
    assert(!slots.some((s) => s.character_id === 'c1'), 'I 不把人物音给系统');
    const en = cloudPrompt(session, shot);
    assert(/MISSING VOICE/.test(en), `I prompt warn: ${en}`);
    assert(!/using the voice timbre referenced from <Audio 1>[\s\S]{0,80}叮——系统激活/.test(en), 'I no char Audio');
    const compiled = compileDramaShotVideoRequest(session, shot, { mode: 'h3-multi' });
    assert(compiled.inputAudios.length === 0, 'I send no borrowed audio');
}
// ---------- CASE J 旁白无参考音 ----------
{
    const session = sessionOf([c1], [vC1]);
    const shot = createEmptyDramaShot({
        shot_no: 'J',
        duration_sec: 4,
        character_ids: ['c1'],
        scene_asset_id: 'sc-office',
        timeline_events: [
            ev({
                start_sec: 0,
                end_sec: 4,
                character_ids: ['c1'],
                dialogue: '很多年以后……',
                dialogue_character_id: 'narrator',
            }),
        ],
    });
    const t = tableOf(session, shot);
    assert(row(t, 'narrator')?.missing_voice, 'J missing narrator voice');
    assert(row(t, 'narrator')?.audio == null, 'J no fallback Audio');
    const slots = listDramaShotRefAudioSlots(session, shot);
    assert(!slots.some((s) => s.character_id === 'c1'), 'J 不把人物音给旁白');
    const en = cloudPrompt(session, shot);
    assert(/MISSING VOICE/.test(en), `J prompt warn: ${en}`);
    assert(!/using the voice timbre referenced from <Audio 1>[\s\S]{0,80}很多年以后/.test(en), 'J no char Audio');
    const compiled = compileDramaShotVideoRequest(session, shot, { mode: 'h3-multi' });
    assert(compiled.inputAudios.length === 0, 'J send no borrowed audio');
}
// ---------- CASE K Subject 顺序打乱 ----------
{
    const session = sessionOf([c7, c2], [vC7, vC2]);
    const shot = createEmptyDramaShot({
        shot_no: 'K',
        duration_sec: 6,
        character_ids: ['c7', 'c2'],
        scene_asset_id: 'sc-office',
        timeline_events: [
            ev({
                start_sec: 0,
                end_sec: 3,
                character_ids: ['c7', 'c2'],
                dialogue: '江澈先说。',
                dialogue_character_id: 'c2',
                lip_sync: true,
            }),
            ev({
                start_sec: 3,
                end_sec: 6,
                character_ids: ['c7', 'c2'],
                dialogue: '樱花后说。',
                dialogue_character_id: 'c7',
                lip_sync: true,
            }),
        ],
    });
    const lens = resolveDramaLensSubjects(session, shot);
    assert(lens.subjectByCharacterId.get('c7')?.n === 1, 'K C7 Subject 1');
    assert(lens.subjectByCharacterId.get('c2')?.n === 2, 'K C2 Subject 2');
    const t = tableOf(session, shot);
    assert(row(t, 'c2')?.audio === 1, 'K C2 先开口 → Audio 1，不跟 Subject 2');
    assert(row(t, 'c7')?.audio === 2, 'K C7 后开口 → Audio 2，不跟 Subject 1');
    assert(audioIndexForVoiceEntity(t, 'c2') === 1, 'K lookup by character_id');
    assert(audioIndexForVoiceEntity(t, 'c7') === 2, 'K lookup C7');
    const en = cloudPrompt(session, shot);
    const b2 = blockAroundD(en, '江澈先说。');
    const b7 = blockAroundD(en, '樱花后说。');
    assert(/<Subject 2>/.test(b2) && /<Audio 1>/.test(b2), `K C2 Subject2+Audio1: ${b2}`);
    assert(/<Subject 1>/.test(b7) && /<Audio 2>/.test(b7), `K C7 Subject1+Audio2: ${b7}`);
    assert(!/<Subject 1>[\s\S]{0,80}using the voice timbre referenced from <Audio 1>[\s\S]{0,40}江澈先说/.test(en), 'K no Subject1=Audio1 guess');
    assertPromptAudioMatchesInput(session, shot, 'K');
}
// ---------- CASE L 多图 + 多 Subject + 多 Audio ----------
{
    const session = sessionOf([c1, c2], [vC1, vC2], { props: [phone] });
    const shot = createEmptyDramaShot({
        shot_no: 'L',
        duration_sec: 6,
        character_ids: ['c1', 'c2'],
        scene_asset_id: 'sc-office',
        prop_ids: ['p1'],
        timeline_events: [
            ev({
                start_sec: 0,
                end_sec: 3,
                character_ids: ['c1'],
                dialogue: '看手机。',
                dialogue_character_id: 'c1',
                lip_sync: true,
            }),
            ev({
                start_sec: 3,
                end_sec: 6,
                character_ids: ['c2'],
                dialogue: '我在听。',
                dialogue_character_id: 'c2',
                lip_sync: true,
            }),
        ],
    });
    const pics = listDramaShotRefImageSlots(session, shot);
    const lens = resolveDramaLensSubjects(session, shot);
    const t = tableOf(session, shot);
    const c1Sub = lens.subjectByCharacterId.get('c1');
    const c2Sub = lens.subjectByCharacterId.get('c2');
    assert(c1Sub && c2Sub && c1Sub.n !== c2Sub.n, 'L distinct subjects');
    const c1Pic = pics.find((p) => p.asset_id === 'c1' && p.role === 'character');
    const c2Pic = pics.find((p) => p.asset_id === 'c2' && p.role === 'character');
    const scenePic = pics.find((p) => p.role === 'scene');
    const propPic = pics.find((p) => p.asset_id === 'p1' && p.role === 'prop');
    const propSub = lens.subjects.find((s) => s.role === 'prop' && s.prop_id === 'p1');
    assert(!!c1Pic && !!c2Pic && !!scenePic, `L pictures ${JSON.stringify(pics.map((p) => [p.index, p.role, p.asset_id]))}`);
    assert(!!propPic && !!propSub, 'L prop picture + subject');
    assert(c1Sub.n !== propSub.n && c2Sub.n !== propSub.n, 'L prop subject not a character');
    assert(row(t, 'c1')?.subject === c1Sub.n && row(t, 'c1')?.picture === c1Pic.index, 'L C1 pic↔sub');
    assert(row(t, 'c2')?.subject === c2Sub.n && row(t, 'c2')?.picture === c2Pic.index, 'L C2 pic↔sub');
    assert(row(t, 'c1')?.audio === 1 && row(t, 'c1')?.voice_id === 'v-c1', 'L C1 voice');
    assert(row(t, 'c2')?.audio === 2 && row(t, 'c2')?.voice_id === 'v-c2', 'L C2 voice');
    const en = cloudPrompt(session, shot);
    assert(new RegExp(`${c1Sub.tag}[\\s\\S]{0,160}<Audio 1>`).test(en) || /<Audio 1> is the voice-timbre reference for <Subject 1>/.test(en), `L C1 bind: ${en}`);
    assert(en.includes(`${propSub.tag} is the prop referenced by ${propSub.pictureTag}`), 'L prop subject def');
    assert(!new RegExp(`${propSub.tag}\\s*=\\s*手机`).test(en), 'L no chinese prop name assign');
    assert(/Visible:/.test(en) && new RegExp(`${propSub.tag} \\(locked to ${propSub.pictureTag}\\)`).test(en), 'L visible includes prop');
    assert(/Lip-sync:\s*<Subject 1> only/.test(en), 'L lipsync C1');
    assert(/Lip-sync:\s*<Subject 2> only/.test(en), 'L lipsync C2');
    assertPromptAudioMatchesInput(session, shot, 'L');
}
// ---------- 生产封口不得走 reinject 身份改写 ----------
{
    const session = sessionOf([c1], [vC1, vSys]);
    const shot = createEmptyDramaShot({
        shot_no: 'SEAL',
        duration_sec: 6,
        character_ids: ['c1'],
        scene_asset_id: 'sc-office',
        timeline_events: [
            ev({
                start_sec: 0,
                end_sec: 3,
                character_ids: ['c1'],
                dialogue: '系统，你在吗？',
                dialogue_character_id: 'c1',
                lip_sync: true,
            }),
            ev({
                start_sec: 3,
                end_sec: 6,
                character_ids: ['c1'],
                dialogue: '恭喜宿主获得奖励。',
                dialogue_character_id: 'system',
            }),
        ],
    });
    const raw = composeDramaShotH3EnglishPrompt(session, shot);
    const sealed = sealDramaProductionCloudPrompt(raw, { hasDialogue: true });
    assertNoGenericReinject(sealed, 'SEAL');
    assert(/<Audio 1>/.test(blockAroundD(sealed, '系统，你在吗？')), 'SEAL keep C1 audio');
    assert(/Lip-sync:\s*<Subject 1> only/.test(blockAroundD(sealed, '系统，你在吗？')), 'SEAL char lipsync');
    assert(/off-screen system voice/i.test(blockAroundD(sealed, '恭喜宿主获得奖励。')), 'SEAL keep system');
    assert(/Lip-sync:\s*none/.test(blockAroundD(sealed, '恭喜宿主获得奖励。')), 'SEAL system no lipsync');
    const poisoned = reinjectSpokenLinesIntoH3SkillPrompt('subject_definitions:\n<summary:\n', [
        '系统，你在吗？',
        '恭喜宿主获得奖励。',
    ]);
    assert(/on-camera speaker says:|off-screen narrator says in an off-screen voiceover/i.test(poisoned), 'SEAL reinject still exists for Skill');
    assert(!/on-camera speaker/i.test(sealed), 'SEAL production skipped reinject');
}
// ---------- 素材音色：说话人自己的 sample 不被陈旧 voice_ids 误拒；缺 id 按名/在场补齐 ----------
{
    const session = sessionOf([c1, c2], [vC1, vC2]);
    // voice_ids 只挂了 c2，但本镜说话人是 c1 —— 旧逻辑会 missing；应仍绑定 c1.mp3
    const shotStale = createEmptyDramaShot({
        shot_no: 'TIMBRE-STALE',
        duration_sec: 6,
        character_ids: ['c1'],
        voice_ids: ['v-c2'],
        scene_asset_id: 'sc-office',
        timeline_events: [
            ev({
                start_sec: 0,
                end_sec: 6,
                character_ids: ['c1'],
                dialogue: '同学们，请打开课本。',
                dialogue_character_id: 'c1',
                lip_sync: true,
            }),
        ],
    });
    const tStale = tableOf(session, shotStale);
    const rC1 = row(tStale, 'c1');
    assert(rC1 && rC1.audio === 1, `TIMBRE-STALE c1 audio=${rC1?.audio}`);
    assert(rC1?.sample_url === 'https://example.com/c1.mp3', 'TIMBRE-STALE must use c1 material');
    assert(!rC1?.missing_voice, 'TIMBRE-STALE c1 must not be missing');
    assertPromptAudioMatchesInput(session, shotStale, 'TIMBRE-STALE');
    // 对白只有人名、无 character_id
    const shotByName = createEmptyDramaShot({
        shot_no: 'TIMBRE-NAME',
        duration_sec: 4,
        character_ids: ['c1'],
        scene_asset_id: 'sc-office',
        dialogue: [{ dialogue_id: 'd1', character_id: '', character_name: '苏念晴', text: '我在。' }],
    });
    const tName = tableOf(session, shotByName);
    assert(row(tName, 'c1')?.sample_url === 'https://example.com/c1.mp3', 'TIMBRE-NAME by character_name');
    // timeline 缺 dialogue_character_id，但在场仅一人
    const shotOnScreen = createEmptyDramaShot({
        shot_no: 'TIMBRE-ONE',
        duration_sec: 4,
        character_ids: ['c1'],
        scene_asset_id: 'sc-office',
        timeline_events: [
            ev({
                start_sec: 0,
                end_sec: 4,
                character_ids: ['c1'],
                dialogue: '注意听讲。',
                dialogue_character_id: '',
                lip_sync: true,
            }),
        ],
    });
    const tOne = tableOf(session, shotOnScreen);
    assert(row(tOne, 'c1')?.sample_url === 'https://example.com/c1.mp3', 'TIMBRE-ONE single on-screen');
}
console.log('p1VoiceBinding.selftest ok');
