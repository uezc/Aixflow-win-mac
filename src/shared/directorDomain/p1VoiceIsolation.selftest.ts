/**
 * P1 Voice Isolation：人物 / 系统 / 旁白 身份隔离。
 * 运行：npx tsx src/shared/directorDomain/p1VoiceIsolation.selftest.ts
 * 不调用真实 H3。
 */
import { composeDramaShotH3EnglishPrompt, composeDramaShotLensTaggedPrompt, } from './composeDramaShotLensPrompt.js';
import { compileDramaShotVideoRequest } from './compileDramaShotVideoRequest.js';
import { createEmptyDramaCharacter, createEmptyDramaSceneAsset, createEmptyDramaSession, createEmptyDramaShot, createEmptyDramaVoice, } from './factories.js';
import { createEmptyDramaTimelineEvent } from './timelineEvent.js';
import { listDramaShotRefAudioSlots } from './shotRefs.js';
import { attachDramaVoiceBindingPictures, buildDramaShotVoiceBindingTable, formatDramaVoiceBindingTableText, } from './voiceBinding.js';
import { resolveDramaLensSubjects } from './composeDramaShotLensPrompt.js';
import { listDramaShotRefImageSlots } from './shotRefs.js';
import { DRAMA_NARRATOR_SPEAKER_ID, DRAMA_SYSTEM_SPEAKER_ID } from './voiceEntity.js';
function assert(cond, msg) {
    if (!cond)
        throw new Error(msg);
}
const scene = createEmptyDramaSceneAsset({
    scene_id: 'sc-gate',
    name: '云霄峰山门外',
    imageUrl: 'https://example.com/gate.png',
});
const jiang = createEmptyDramaCharacter({
    character_id: 'jiangche',
    name: '江澈',
    voice_id: 'v-jiang',
    imageUrl: 'https://example.com/jiang.png',
});
const su = createEmptyDramaCharacter({
    character_id: 'suwan-yue',
    name: '苏挽月',
    voice_id: 'v-su',
    imageUrl: 'https://example.com/su.png',
});
const elder = createEmptyDramaCharacter({
    character_id: 'elder',
    name: '长老',
    voice_id: 'v-elder',
    imageUrl: 'https://example.com/elder.png',
});
const vJiang = createEmptyDramaVoice({
    voice_id: 'v-jiang',
    character_id: 'jiangche',
    sample_url: 'https://example.com/jiang.mp3',
});
const vSu = createEmptyDramaVoice({
    voice_id: 'v-su',
    character_id: 'suwan-yue',
    sample_url: 'https://example.com/su.mp3',
});
const vElder = createEmptyDramaVoice({
    voice_id: 'v-elder',
    character_id: 'elder',
    sample_url: 'https://example.com/elder.mp3',
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
function sessionOf(chars, voices) {
    return createEmptyDramaSession({
        bible: { characters: chars, scenes: [scene], voices },
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
function dTags(text) {
    return [...String(text || '').matchAll(/<d>\s*\[Chinese[^\]]*\]\s*([\s\S]*?)<\/d>/gi)].map((m) => String(m[1] || '').trim());
}
// ---------- A 单人物 ----------
{
    const session = sessionOf([jiang], [vJiang]);
    const shot = createEmptyDramaShot({
        shot_no: 'A',
        duration_sec: 4,
        character_ids: ['jiangche'],
        scene_asset_id: 'sc-gate',
        timeline_events: [
            ev({
                start_sec: 0,
                end_sec: 4,
                character_ids: ['jiangche'],
                dialogue: '这里是江澈自己的台词。',
                dialogue_character_id: 'jiangche',
                lip_sync: true,
            }),
        ],
    });
    const t = tableOf(session, shot);
    const j = row(t, 'jiangche');
    assert(j?.role === 'character', 'A role');
    assert(j?.audio === 1, `A Audio 1: ${j?.audio}`);
    assert(!j?.missing_voice, 'A has voice');
    const slots = listDramaShotRefAudioSlots(session, shot);
    assert(slots[0]?.character_id === 'jiangche', 'A slot 1 = 江澈');
    const en = composeDramaShotH3EnglishPrompt(session, shot);
    assert(/<Audio 1> is the voice-timbre reference for <Subject 1>/.test(en), `A bind: ${en}`);
    assert(/using the voice timbre referenced from <Audio 1>/.test(en), 'A uses Audio 1');
    assert(/says:\s*<d>\[Chinese\]/.test(en), 'A official says');
    assert(/<d>\[Chinese\]这里是江澈自己的台词。/.test(en), 'A line');
}
// ---------- B 双人物 ----------
{
    const session = sessionOf([jiang, su], [vJiang, vSu]);
    const shot = createEmptyDramaShot({
        shot_no: 'B',
        duration_sec: 6,
        character_ids: ['jiangche', 'suwan-yue'],
        scene_asset_id: 'sc-gate',
        timeline_events: [
            ev({
                start_sec: 0,
                end_sec: 3,
                character_ids: ['jiangche', 'suwan-yue'],
                dialogue: '江澈先说。',
                dialogue_character_id: 'jiangche',
                lip_sync: true,
            }),
            ev({
                start_sec: 3,
                end_sec: 6,
                character_ids: ['jiangche', 'suwan-yue'],
                dialogue: '苏挽月后说。',
                dialogue_character_id: 'suwan-yue',
                lip_sync: true,
            }),
        ],
    });
    const t = tableOf(session, shot);
    assert(row(t, 'jiangche')?.audio === 1, 'B 江澈 Audio 1');
    assert(row(t, 'suwan-yue')?.audio === 2, 'B 苏挽月 Audio 2');
    assert(row(t, 'jiangche')?.audio !== row(t, 'suwan-yue')?.audio, 'B isolated');
    const en = composeDramaShotH3EnglishPrompt(session, shot);
    assert(/Audio 1 = 江澈 voice|Audio 1 = jiangche voice/.test(en) || /<Audio 1> is the voice-timbre reference/.test(en), `B Audio1: ${en}`);
    assert(!new RegExp(`<Subject [^>]+>[\\s\\S]{0,80}<d>\\[Chinese\\]苏挽月后说`).test(en.replace(/江澈[\s\S]*苏挽月后说/, '')), 'B no cross line');
    const jiangBlock = en.split('<d>[Chinese]苏挽月后说')[0];
    assert(/<Audio 1>/.test(jiangBlock), 'B 江澈 block uses Audio 1');
    assert(!/using the voice timbre referenced from <Audio 2>[\s\S]{0,80}江澈先说/.test(en), 'B 江澈 not Audio 2');
}
// ---------- C 三人物 ----------
{
    const session = sessionOf([jiang, su, elder], [vJiang, vSu, vElder]);
    const shot = createEmptyDramaShot({
        shot_no: 'C',
        duration_sec: 9,
        character_ids: ['jiangche', 'suwan-yue', 'elder'],
        scene_asset_id: 'sc-gate',
        timeline_events: [
            ev({ start_sec: 0, end_sec: 3, character_ids: ['jiangche'], dialogue: '江澈。', dialogue_character_id: 'jiangche' }),
            ev({ start_sec: 3, end_sec: 6, character_ids: ['suwan-yue'], dialogue: '苏挽月。', dialogue_character_id: 'suwan-yue' }),
            ev({ start_sec: 6, end_sec: 9, character_ids: ['elder'], dialogue: '长老。', dialogue_character_id: 'elder' }),
        ],
    });
    const t = tableOf(session, shot);
    const a1 = row(t, 'jiangche')?.audio;
    const a2 = row(t, 'suwan-yue')?.audio;
    const a3 = row(t, 'elder')?.audio;
    assert(a1 && a2 && a3 && new Set([a1, a2, a3]).size === 3, `C isolated ${a1}/${a2}/${a3}`);
}
// ---------- D 人物 + 系统 ----------
{
    const session = sessionOf([jiang], [vJiang, vSys]);
    const shot = createEmptyDramaShot({
        shot_no: 'D',
        duration_sec: 4,
        character_ids: ['jiangche'],
        scene_asset_id: 'sc-gate',
        timeline_events: [
            ev({
                start_sec: 0,
                end_sec: 4,
                character_ids: ['jiangche'],
                dialogue: '叮——系统激活。',
                dialogue_character_id: 'system',
            }),
        ],
    });
    const t = tableOf(session, shot);
    assert(!row(t, 'jiangche'), 'D 江澈未开口，不进 Voice 表');
    const sys = row(t, 'system');
    assert(sys?.role === 'system', 'D system role');
    assert(sys?.picture == null && sys?.subject == null, 'D system no picture/subject');
    assert(sys?.audio === 1, `D system audio=${sys?.audio}`);
    const slots = listDramaShotRefAudioSlots(session, shot);
    assert(slots.every((s) => s.character_id !== 'jiangche'), 'D no 江澈 audio slot');
    assert(slots.some((s) => s.character_id === 'system'), 'D system slot');
    const en = composeDramaShotH3EnglishPrompt(session, shot);
    const zh = composeDramaShotLensTaggedPrompt(session, shot);
    assert(/off-screen system voice/i.test(en), `D en system: ${en}`);
    assert(/系统/.test(zh) && /叮——系统激活/.test(zh), `D zh system: ${zh}`);
    assert(!/<Subject 1>[\s\S]{0,80}<d>\[Chinese\]叮——系统激活/.test(en), 'D no lip-sync');
    assert(!/using the voice timbre referenced from <Audio 1>[\s\S]{0,40}says:/.test(en), 'D 江澈 not speak');
    assert(sys?.audio === 1 && /System Voice = <Audio 1>/.test(en) && /off-screen system voice/.test(en), 'D system uses own audio');
}
// ---------- E 人物 + 旁白 ----------
{
    const session = sessionOf([jiang], [vJiang, vNar]);
    const shot = createEmptyDramaShot({
        shot_no: 'E',
        duration_sec: 4,
        character_ids: ['jiangche'],
        scene_asset_id: 'sc-gate',
        timeline_events: [
            ev({
                start_sec: 0,
                end_sec: 4,
                character_ids: ['jiangche'],
                dialogue: '山门外风很大。',
                dialogue_character_id: 'narrator',
            }),
        ],
    });
    const t = tableOf(session, shot);
    assert(!row(t, 'jiangche'), 'E 江澈未开口');
    const nar = row(t, 'narrator');
    assert(nar?.role === 'narrator', 'E narrator role');
    assert(nar?.picture == null && nar?.subject == null, 'E narrator no picture/subject');
    assert(nar?.audio === 1, `E narrator audio=${nar?.audio}`);
    const en = composeDramaShotH3EnglishPrompt(session, shot);
    assert(/off-screen narrator/i.test(en), `E en: ${en}`);
    assert(!/<Subject 1>[\s\S]{0,80}<d>\[Chinese\]山门外风很大/.test(en), 'E no lip-sync');
    assert(/Narrator Voice = <Audio 1>/.test(en), `E identity: ${en}`);
}
// ---------- F 人物 + 系统 + 旁白（H3 最多 3 槽） ----------
{
    const session = sessionOf([jiang, su], [vJiang, vSu, vSys, vNar]);
    const shot = createEmptyDramaShot({
        shot_no: 'F',
        duration_sec: 8,
        character_ids: ['jiangche', 'suwan-yue'],
        scene_asset_id: 'sc-gate',
        timeline_events: [
            ev({ start_sec: 0, end_sec: 2, character_ids: ['jiangche'], dialogue: '江澈句。', dialogue_character_id: 'jiangche' }),
            ev({ start_sec: 2, end_sec: 4, character_ids: ['suwan-yue'], dialogue: '苏挽月句。', dialogue_character_id: 'suwan-yue' }),
            ev({ start_sec: 4, end_sec: 6, character_ids: ['jiangche'], dialogue: '叮——系统。', dialogue_character_id: 'system' }),
            ev({ start_sec: 6, end_sec: 8, character_ids: ['jiangche'], dialogue: '旁白句。', dialogue_character_id: 'narrator' }),
        ],
    });
    const t = tableOf(session, shot);
    const ids = t.rows.map((r) => r.entity_id).sort();
    assert(ids.includes('jiangche') && ids.includes('suwan-yue') && ids.includes('system') && ids.includes('narrator'), `F entities ${ids}`);
    const audios = t.rows.filter((r) => r.audio).map((r) => r.audio);
    assert(new Set(audios).size === audios.length, 'F assigned audios unique');
    const sys = row(t, 'system');
    const nar = row(t, 'narrator');
    assert(sys?.picture == null && sys?.subject == null, 'F system no pic/sub');
    assert(nar?.picture == null && nar?.subject == null, 'F narrator no pic/sub');
    if (nar?.missing_voice) {
        assert(/H3 max 3 audios|missing voice/i.test(nar.warning), `F narrator warn: ${nar.warning}`);
        assert(nar.audio == null, 'F narrator not remapped');
    }
    const jAudio = row(t, 'jiangche')?.audio;
    const sAudio = row(t, 'suwan-yue')?.audio;
    assert(sys?.audio !== jAudio && sys?.audio !== sAudio, 'F system not character audio');
    if (nar?.audio)
        assert(nar.audio !== jAudio && nar.audio !== sAudio && nar.audio !== sys?.audio, 'F narrator isolated');
    const en = composeDramaShotH3EnglishPrompt(session, shot);
    assert(/System Voice =/.test(en), `F system identity: ${en}`);
    assert(/Narrator Voice =/.test(en) || /MISSING VOICE/.test(en), `F narrator identity: ${en}`);
    assert(!/<Subject 1>[\s\S]{0,80}<d>\[Chinese\]叮——系统/.test(en), 'F 江澈 not system');
    assert(!/<Subject 2>[\s\S]{0,80}<d>\[Chinese\]旁白句/.test(en), 'F 苏挽月 not narrator');
}
// ---------- G 删除 System Audio ----------
{
    const session = sessionOf([jiang], [vJiang]);
    const shot = createEmptyDramaShot({
        shot_no: 'G',
        duration_sec: 4,
        character_ids: ['jiangche'],
        scene_asset_id: 'sc-gate',
        timeline_events: [
            ev({ start_sec: 0, end_sec: 4, character_ids: ['jiangche'], dialogue: '叮——系统激活。', dialogue_character_id: 'system' }),
        ],
    });
    const t = tableOf(session, shot);
    const sys = row(t, 'system');
    assert(sys?.missing_voice, 'G missing system voice');
    assert(/missing voice/i.test(sys?.warning || ''), `G warn: ${sys?.warning}`);
    assert(sys?.audio == null, 'G no fallback Audio');
    const slots = listDramaShotRefAudioSlots(session, shot);
    assert(!slots.some((s) => s.character_id === 'jiangche'), 'G 不把江澈音给系统');
    const en = composeDramaShotH3EnglishPrompt(session, shot);
    assert(/MISSING VOICE/.test(en), `G prompt warn: ${en}`);
    assert(!/using the voice timbre referenced from <Audio 1>[\s\S]{0,80}叮——系统激活/.test(en), 'G no Audio 1 fallback');
}
// ---------- H 删除人物 Audio ----------
{
    const session = sessionOf([jiang, su], [vSu]);
    const shot = createEmptyDramaShot({
        shot_no: 'H',
        duration_sec: 4,
        character_ids: ['jiangche', 'suwan-yue'],
        scene_asset_id: 'sc-gate',
        timeline_events: [
            ev({ start_sec: 0, end_sec: 4, character_ids: ['jiangche'], dialogue: '江澈没声音。', dialogue_character_id: 'jiangche' }),
        ],
    });
    const t = tableOf(session, shot);
    const j = row(t, 'jiangche');
    assert(j?.missing_voice, 'H missing 江澈 voice');
    assert(/missing voice/i.test(j?.warning || ''), `H warn: ${j?.warning}`);
    assert(j?.audio == null, 'H 不用苏挽月 Audio');
    const slots = listDramaShotRefAudioSlots(session, shot);
    assert(!slots.some((s) => s.character_id === 'suwan-yue'), 'H 苏挽月未开口不进槽');
    const en = composeDramaShotH3EnglishPrompt(session, shot);
    assert(/MISSING VOICE/.test(en), `H prompt: ${en}`);
}
// ---------- I Subject 顺序变化 ----------
{
    const session = sessionOf([su, jiang], [vSu, vJiang]);
    const shot = createEmptyDramaShot({
        shot_no: 'I',
        duration_sec: 4,
        character_ids: ['suwan-yue', 'jiangche'],
        scene_asset_id: 'sc-gate',
        timeline_events: [
            ev({ start_sec: 0, end_sec: 4, character_ids: ['jiangche', 'suwan-yue'], dialogue: '江澈说话。', dialogue_character_id: 'jiangche' }),
        ],
    });
    const lens = resolveDramaLensSubjects(session, shot);
    const jSub = lens.subjectByCharacterId.get('jiangche');
    assert(jSub && jSub.n !== 1, `I 江澈 Subject ${jSub?.n}（苏挽月先出场）`);
    const t = tableOf(session, shot);
    const j = row(t, 'jiangche');
    assert(j?.audio === 1, 'I 声音仍是江澈自己的 Audio，不跟 Subject 号走');
    assert(j?.subject === jSub?.n, `I subject bind ${j?.subject}`);
    const en = composeDramaShotH3EnglishPrompt(session, shot);
    assert(new RegExp(`<Subject ${jSub.n}>[\\s\\S]{0,120}<Audio ${j.audio}>|<Audio ${j.audio}>[\\s\\S]{0,80}<Subject ${jSub.n}>`).test(en) || new RegExp(`using the voice timbre referenced from <Audio ${j.audio}>`).test(en), `I prompt: ${en}`);
}
// ---------- J Audio 顺序变化（voice_ids 只留江澈，仍绑自己的声音） ----------
{
    const session = sessionOf([jiang, su], [vJiang, vSu]);
    const shot = createEmptyDramaShot({
        shot_no: 'J',
        duration_sec: 6,
        character_ids: ['jiangche', 'suwan-yue'],
        scene_asset_id: 'sc-gate',
        voice_ids: ['v-su', 'v-jiang'],
        timeline_events: [
            ev({ start_sec: 0, end_sec: 3, character_ids: ['jiangche'], dialogue: '江澈。', dialogue_character_id: 'jiangche' }),
            ev({ start_sec: 3, end_sec: 6, character_ids: ['suwan-yue'], dialogue: '苏挽月。', dialogue_character_id: 'suwan-yue' }),
        ],
    });
    const t = tableOf(session, shot);
    assert(row(t, 'jiangche')?.voice_id === 'v-jiang', `J 江澈 voice ${row(t, 'jiangche')?.voice_id}`);
    assert(row(t, 'suwan-yue')?.voice_id === 'v-su', `J 苏挽月 voice ${row(t, 'suwan-yue')?.voice_id}`);
    assert(row(t, 'jiangche')?.sample_url === vJiang.sample_url, 'J 江澈仍用自己的样本');
}
// ---------- 真实 BUG：江澈三句 + 系统两句 ----------
{
    const session = sessionOf([jiang], [vJiang, vSys]);
    const shot = createEmptyDramaShot({
        shot_no: 'BUG',
        duration_sec: 10,
        character_ids: ['jiangche'],
        scene_asset_id: 'sc-gate',
        timeline_events: [
            ev({ start_sec: 0, end_sec: 2, character_ids: ['jiangche'], dialogue: '啥玩意儿？', dialogue_character_id: 'jiangche', lip_sync: true }),
            ev({ start_sec: 2, end_sec: 4, character_ids: ['jiangche'], dialogue: '叮——峡谷商城系统激活完毕。', dialogue_character_id: 'system' }),
            ev({ start_sec: 4, end_sec: 6, character_ids: ['jiangche'], dialogue: '我去。', dialogue_character_id: 'jiangche', lip_sync: true }),
            ev({ start_sec: 6, end_sec: 8, character_ids: ['jiangche'], dialogue: '恭喜宿主获得新手礼包。', dialogue_character_id: 'system' }),
            ev({ start_sec: 8, end_sec: 10, character_ids: ['jiangche'], dialogue: '来都来了。', dialogue_character_id: 'jiangche', lip_sync: true }),
        ],
    });
    const t = tableOf(session, shot);
    const text = formatDramaVoiceBindingTableText(t);
    assert(/VOICE_BINDING_TABLE/.test(text), `BUG table: ${text}`);
    assert(row(t, 'jiangche')?.role === 'character' && row(t, 'jiangche')?.audio === 1, 'BUG 江澈 Audio 1');
    assert(row(t, 'system')?.role === 'system' && row(t, 'system')?.audio === 2, 'BUG system Audio 2');
    assert(row(t, 'system')?.picture == null && row(t, 'system')?.subject == null, 'BUG system no pic/sub');
    const slots = listDramaShotRefAudioSlots(session, shot);
    assert(slots[0]?.character_id === 'jiangche' && slots[1]?.character_id === 'system', JSON.stringify(slots));
    const en = composeDramaShotH3EnglishPrompt(session, shot);
    const zh = composeDramaShotLensTaggedPrompt(session, shot);
    assert(/Character voice = Audio 1|Audio 1 = 江澈 voice|<Audio 1> is the voice-timbre reference/.test(en), `BUG char voice: ${en}`);
    assert(/System Voice = <Audio 2>/.test(en), `BUG system voice: ${en}`);
    assert(/off-screen system voice[\s\S]*<Audio 2>|<Audio 2>[\s\S]*off-screen system voice/.test(en), `BUG system Audio 2: ${en}`);
    assert(/visible character|mouth closed|must NOT lip-sync/i.test(en), 'BUG mouth closed');
    const sysLines = dTags(en).filter((l) => /叮——|恭喜宿主/.test(l));
    assert(sysLines.length === 2, `BUG system <d> ${sysLines}`);
    assert(!/<Subject 1>[\s\S]{0,80}<d>\[Chinese\]叮——/.test(en), 'BUG 江澈不读系统');
    assert(!/<Subject 1>[\s\S]{0,80}<d>\[Chinese\]恭喜宿主/.test(en), 'BUG 江澈不读礼包');
    assert(!/使用 <Audio 1>[\s\S]{0,80}叮——/.test(zh), 'BUG zh 系统不用 Audio 1');
    const compiled = compileDramaShotVideoRequest(session, shot, { mode: 'h3-multi' });
    const auditText = formatDramaVoiceBindingTableText(compiled.audit.voice_binding_table);
    assert(/Role = character/.test(auditText) && /Role = system/.test(auditText), auditText);
    assert(/Voice = Audio 1/.test(auditText) && /Voice = Audio 2/.test(auditText), auditText);
    assert(compiled.inputAudios[0] === vJiang.sample_url, 'BUG send 江澈 audio');
    assert(compiled.inputAudios[1] === vSys.sample_url, 'BUG send system audio');
}
console.log('p1VoiceIsolation.selftest ok');
