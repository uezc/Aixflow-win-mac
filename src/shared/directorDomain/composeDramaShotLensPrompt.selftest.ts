/**
 * 整镜编译稿自检：短中文时间轴生产稿。
 * 运行：npx tsx src/shared/directorDomain/composeDramaShotLensPrompt.selftest.ts
 */
import { stripChineseOutsideH3DialogueTags } from '../directorPipeline/composeFinalPrompt.js';
import { composeDramaShotH3EnglishPrompt, composeDramaShotLensTaggedPrompt, composeDramaShotLensTaggedPromptEn, isDramaH3AntiCrosstalkPrompt, isDramaH3LensTaggedPrompt, isDramaH3ProductionPrompt, isLegacyDramaH3ChineseLensPrompt, } from './composeDramaShotLensPrompt.js';
import { dramaVisualActionToEnglish } from './dramaVisualToEnglish.js';
import { createEmptyDramaCharacter, createEmptyDramaProp, createEmptyDramaSceneAsset, createEmptyDramaSession, createEmptyDramaShot, } from './factories.js';
import { createEmptyDramaProjectVisualBible } from './visualDna.js';
import { createEmptyDramaTimelineEvent, splitDramaSpeakerTurns } from './timelineEvent.js';
function assert(cond, msg) {
    if (!cond)
        throw new Error(msg);
}
const char = createEmptyDramaCharacter({
    character_id: 'c-jiang',
    name: '江澈',
    imageUrl: 'https://example.com/jiang.png',
});
const elder = createEmptyDramaCharacter({
    character_id: 'c-elder',
    name: '执事长老',
    imageUrl: 'https://example.com/elder.png',
});
const scene = createEmptyDramaSceneAsset({
    scene_id: 'sc-room',
    name: '电竞直播间',
    imageUrl: 'https://example.com/room.png',
});
const session = createEmptyDramaSession({
    bible: {
        characters: [char, elder],
        scenes: [scene],
        projectVisualBible: createEmptyDramaProjectVisualBible({
            presetName: '电影质感夜戏',
            stylePrompt: 'cinematic film look, low saturation, strong contrast, 35mm anamorphic lens, urban night drama',
            selected_at: Date.now(),
        }),
    },
});
const shot = createEmptyDramaShot({
    shot_no: '1',
    duration_sec: 20,
    character_ids: ['c-jiang'],
    scene_asset_id: 'sc-room',
    timeline_events: [
        createEmptyDramaTimelineEvent({
            start_sec: 0,
            end_sec: 6,
            character_ids: ['c-jiang'],
            visual_action: '江澈坐在电竞椅上，左手键盘右手鼠标',
            camera_action: '缓慢推向江澈',
            dialogue: '家人们，这把打完就下播了啊。明天冲峡谷之巅第一，目前差三百分。',
            dialogue_character_id: 'c-jiang',
            eyeline: 'c-jiang',
            character_state: '紧张，情绪强度高',
            lip_sync: true,
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 6,
            end_sec: 8.4,
            character_ids: ['c-jiang'],
            visual_action: '江澈放下汽水罐',
            dialogue: '播啊，怎么不播。',
            dialogue_character_id: 'c-jiang',
            lip_sync: true,
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 8.4,
            end_sec: 11.4,
            character_ids: ['c-jiang'],
            visual_action: '雷声逼近，屏幕被击中',
            camera_action: '硬切急推',
            dialogue: '我操 ——',
            dialogue_character_id: 'c-jiang',
            lip_sync: true,
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 11.4,
            end_sec: 20,
            character_ids: ['c-jiang'],
            visual_action: '画面过渡到黑屏',
            camera_action: '切到黑场',
        }),
    ],
});
const out = composeDramaShotLensTaggedPrompt(session, shot);
assert(isDramaH3LensTaggedPrompt(out), 'lens tagged');
assert(isDramaH3ProductionPrompt(out), 'production zh');
assert(!isDramaH3AntiCrosstalkPrompt(out), 'chinese compile is not english 8-section');
assert(!isLegacyDramaH3ChineseLensPrompt(out), 'plain zh is not legacy');
assert(!out.includes('【参考对应】'), 'no legacy bind header');
assert(!out.includes('【主体定义】'), 'no bracket subject header');
assert(!out.includes('【视觉风格】'), 'no bracket style header');
assert(!/主体定义\s*[：:]/.test(out), 'no dense zh subject_definitions');
assert(!/详细描述\s*[：:]/.test(out), 'no dense zh detailed_description');
assert(/@图片\s*\d+\s*是/.test(out), 'zh @图片 bindings');
assert(/风格色调\s*[：:]/.test(out), 'zh style line');
assert(/剧情\s*[：:]/.test(out), 'zh plot header');
const outEnEditor = composeDramaShotLensTaggedPromptEn(session, shot);
assert(isDramaH3LensTaggedPrompt(outEnEditor), 'en editor lens tagged');
assert(isDramaH3ProductionPrompt(outEnEditor), 'en editor production plain');
assert(/@Picture\s+\d+\s+is\b/i.test(outEnEditor), 'en @Picture bindings');
assert(/Style\s*\/\s*tone\s*[：:]/i.test(outEnEditor), 'en style line');
assert(/Plot\s*[：:]/i.test(outEnEditor), 'en plot header');
assert(!outEnEditor.includes('subject_definitions:'), 'en editor is not 8-section');
assert(outEnEditor.includes('江澈') || outEnEditor.includes('播啊'), 'en editor keeps dialogue text');
assert(!out.includes('**[镜头'), 'no markdown shot labels');
assert(!out.includes('[切]'), 'no [切] token');
assert(!out.includes('<Subject 1>'), 'plain zh no Subject tags');
assert(out.includes('江澈'), 'character name');
assert(out.includes('江澈坐在电竞椅上'), 'keep subject on action');
assert(/@图片\s*\d+/.test(out), 'picture binding');
assert(out.includes('家人们，这把打完就下播了啊'), 'dlg 1 plain');
assert(out.includes('播啊，怎么不播'), 'dlg 2 plain');
assert(out.includes('我操'), 'dlg 3 plain');
assert(/cinematic film look|电影质感/.test(out), 'zh style body');
assert(!/NO_DIALOGUE|全程闭口/.test(out), 'no silent banner');
const en = composeDramaShotH3EnglishPrompt(session, shot);
assert(isDramaH3AntiCrosstalkPrompt(en), 'english 8-section');
assert(en.includes('subject_definitions:'), 'subject_definitions');
assert(/detailed_description:[\s\S]*cinematic film look/.test(en), 'en style in detailed_description');
assert(en.includes('[Shot 1]'), 'Shot 1');
assert(en.includes('<d>[Chinese]播啊，怎么不播。</d>'), 'en dlg');
assert(/says:\s*<d>\[Chinese\]/.test(en), 'official says: <d> form');
assert(!/says with lips moving slightly/.test(en), 'no legacy lips-moving lead');
assert(/Spoken lines use only <d>/.test(en), 'official speech channel');
assert(!/NO_SUBTITLE|Zero letters|burned-in subtitles/i.test(en), 'no subtitle-priming banner');
assert(en.includes('<Subject 1> is the character referenced by'), 'subject no chinese name');
assert(en.includes('<Subject 2> is the environment referenced by'), 'scene subject no chinese name');
assert(!/<Subject 1>\s*=\s*江澈/.test(en), 'no chinese subject assign');
assert(!/Audio \d+\s*=\s*江澈/.test(en), 'no chinese audio assign');
assert(/Visible:\s*<Subject 1> \(locked to <Picture \d+>\)/.test(en), 'visible lock');
assert(/Lip-sync:\s*<Subject 1> only/.test(en), 'lipsync subject only');
assert(!/slow push-in toward|缓慢推向/.test(en), 'source must not emit camera_action; Skill owns framing/move');
assert(!/硬切急推|切到黑场/.test(en), 'source must not emit Chinese camera recipes');
assert(!/two-shot push-pull|choke dolly|estranging pull-out/.test(en), 'no cinematic heal');
assert(/retention_analysis:/.test(en) && /fully_preserved/.test(en), 'retention denser');
assert(/overall_soundscape:/.test(en) && /non_diegetic_music:[\s\S]*N\/A/.test(en), 'soundscape + music');
assert(!/\nAction:\s*/.test(en), 'no Action: label body');
const strippedEn = stripChineseOutsideH3DialogueTags(en);
assert(strippedEn.includes('<Subject 1> is the character referenced by') &&
    strippedEn.includes('<Subject 2> is the environment referenced by'), 'subject lines survive strip');
assert(!/<Subject 1> is,\s*$/m.test(strippedEn) && !/<Subject 2> is,\s*$/m.test(strippedEn), 'no stripped names');
const mash = splitDramaSpeakerTurns('用力了啊，执事长老再用点力，江澈全身用力，玉石依然毫无反应，执事长老长叹一口气，执事长老灵根……无，资质……无', [
    { name: '执事长老', character_id: 'c-elder' },
    { name: '江澈', character_id: 'c-jiang' },
], { name: '江澈', character_id: 'c-jiang' });
assert(mash.turns.some((t) => t.character_id === 'c-jiang' && t.line.includes('用力了啊')), `jiang line: ${JSON.stringify(mash.turns)}`);
assert(mash.turns.some((t) => t.character_id === 'c-elder' && t.line.includes('再用点力')), `elder force: ${JSON.stringify(mash.turns)}`);
assert(mash.turns.some((t) => t.character_id === 'c-elder' && t.line.includes('灵根')), `elder verdict: ${JSON.stringify(mash.turns)}`);
assert(!mash.turns.some((t) => t.line.includes('全身用力')), `action must not be speech: ${JSON.stringify(mash.turns)}`);
const mashShot = createEmptyDramaShot({
    shot_no: '2',
    duration_sec: 8,
    character_ids: ['c-elder', 'c-jiang'],
    scene_asset_id: 'sc-room',
    timeline_events: [
        createEmptyDramaTimelineEvent({
            start_sec: 0,
            end_sec: 8,
            character_ids: ['c-elder', 'c-jiang'],
            visual_action: '中景 · 正面 · 固定镜头',
            dialogue: '你是不是没用力？江澈用力了啊，执事长老再用点力，江澈全身用力，玉石依然毫无反应，执事长老灵根……无，资质……无',
            dialogue_character_id: 'c-elder',
            lip_sync: true,
        }),
    ],
});
const mashOut = composeDramaShotLensTaggedPrompt(session, mashShot);
assert(mashOut.includes('你是不是没用力'), 'mash elder q');
assert(mashOut.includes('用力了啊'), 'mash jiang');
assert(mashOut.includes('再用点力'), 'mash elder force');
assert(/@图片\s*\d+\s*是/.test(mashOut), 'mash has @图片');
assert(/剧情\s*[：:]/.test(mashOut), 'mash has 剧情');
assert(!/江澈 用力了啊，执事长老 再用点力/.test(mashOut), 'no mashed chinese speech');
assert(isLegacyDramaH3ChineseLensPrompt('[镜头 1]<Subject 1>（S1）执事长老：目标视频从 <Picture 1> 开始。\n使用 <Audio 1> 参考的音色，<Subject 1>（S1）说：\n\n> \n> 你是不是没用力？'), 'legacy detect');
const junkShot = createEmptyDramaShot({
    shot_no: '1',
    duration_sec: 8,
    character_ids: ['c-jiang'],
    scene_asset_id: 'sc-room',
    timeline_events: [
        createEmptyDramaTimelineEvent({
            start_sec: 0,
            end_sec: 2,
            character_ids: ['c-jiang'],
            visual_action: '江澈拿起汽水',
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 2,
            end_sec: 3.5,
            character_ids: ['c-jiang'],
            visual_action: '',
            character_state: '轻松、慵懒，情绪强度高',
            eyeline: 'c-jiang',
            expression: '懵逼',
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 3.5,
            end_sec: 5,
            visual_action: '切至：',
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 5,
            end_sec: 6.5,
            visual_action: '。一道白光闪过',
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 6.5,
            end_sec: 8,
            dialogue: '叮——峡谷商城系统激活完毕。',
            dialogue_character_id: 'system',
            eyeline: 'c-jiang',
        }),
    ],
});
const junkZh = composeDramaShotLensTaggedPrompt(session, junkShot);
assert(junkZh.includes('江澈拿起汽水'), 'keep real action');
assert(!/轻松|慵懒|懵逼/.test(junkZh), `skip empty emotion beat: ${junkZh}`);
assert(!junkZh.includes('切至'), `skip empty cut: ${junkZh}`);
assert(!junkZh.includes('情绪强度高'), 'junk shot no intensity meta');
assert(junkZh.includes('一道白光闪过') || junkZh.includes('白光'), 'keep lightning visual');
assert(/系统|叮——峡谷商城/.test(junkZh), 'zh system/content present');
assert(!/system voice/.test(junkZh), 'zh must not say system voice');
const leakedSys = createEmptyDramaShot({
    shot_no: '1',
    duration_sec: 4,
    character_ids: ['c-jiang'],
    scene_asset_id: 'sc-room',
    timeline_events: [
        createEmptyDramaTimelineEvent({
            start_sec: 0,
            end_sec: 4,
            visual_action: '系统。是的。宿主。但当前金币为零。无法购买任何英雄或装备。',
            eyeline: 'c-jiang',
            character_state: '机械',
        }),
    ],
});
const leakedZh = composeDramaShotLensTaggedPrompt(session, leakedSys);
assert(/是的|宿主|金币/.test(leakedZh), `leaked system content: ${leakedZh}`);
assert(/剧情\s*[：:]/.test(leakedZh), `leaked has 剧情: ${leakedZh}`);
const cutSpoken = createEmptyDramaShot({
    shot_no: '1',
    duration_sec: 4,
    character_ids: ['c-jiang'],
    scene_asset_id: 'sc-room',
    timeline_events: [
        createEmptyDramaTimelineEvent({
            start_sec: 0,
            end_sec: 2,
            visual_action: '画面迅速进入纯黑',
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 2,
            end_sec: 4,
            dialogue: '切至：',
            dialogue_character_id: 'system',
        }),
    ],
});
const cutZh = composeDramaShotLensTaggedPrompt(session, cutSpoken);
assert(!/<d>\[Chinese\]切至/.test(cutZh), `切至 must not be spoken: ${cutZh}`);
assert(/@图片|剧情/.test(cutZh), `cut zh plain format: ${cutZh}`);
const sysLabelShot = createEmptyDramaShot({
    shot_no: '1',
    duration_sec: 8,
    character_ids: ['c-jiang'],
    scene_asset_id: 'sc-room',
    timeline_events: [
        createEmptyDramaTimelineEvent({
            start_sec: 0,
            end_sec: 4,
            dialogue: '系统：恭喜宿主获得奖励',
            dialogue_character_id: 'system',
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 4,
            end_sec: 8,
            character_ids: ['c-jiang'],
            dialogue: '系统，你在吗？',
            dialogue_character_id: 'c-jiang',
            lip_sync: true,
        }),
    ],
});
const sysLabelZh = composeDramaShotLensTaggedPrompt(session, sysLabelShot);
assert(/恭喜宿主获得奖励/.test(sysLabelZh), `系统台词保留: ${sysLabelZh}`);
assert(/系统，你在吗/.test(sysLabelZh), `人物台词里的「系统」必须保留: ${sysLabelZh}`);
assert(/@图片|剧情/.test(sysLabelZh), `sysLabel plain format: ${sysLabelZh}`);
const mallLeakShot = createEmptyDramaShot({
    shot_no: '1',
    duration_sec: 4,
    character_ids: ['c-jiang'],
    scene_asset_id: 'sc-room',
    timeline_events: [
        createEmptyDramaTimelineEvent({
            start_sec: 0,
            end_sec: 4,
            dialogue: '系统\n是的，宿主。但当前金币为零，无法购买任何英雄或装备。',
            dialogue_character_id: 'system',
        }),
    ],
});
const mallLeakZh = composeDramaShotLensTaggedPrompt(session, mallLeakShot);
assert(/是的，宿主|金币为零/.test(mallLeakZh), `商城系统内容: ${mallLeakZh}`);
assert(/剧情\s*[：:]/.test(mallLeakZh), `mallLeak plain: ${mallLeakZh}`);
const mindShot = createEmptyDramaShot({
    shot_no: '1',
    duration_sec: 8,
    character_ids: ['c-jiang'],
    scene_asset_id: 'sc-room',
    timeline_events: [
        createEmptyDramaTimelineEvent({
            start_sec: 0,
            end_sec: 3,
            dialogue: '机械声音在江澈脑海中响起',
            dialogue_character_id: 'system',
            eyeline: '脑海中',
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 3,
            end_sec: 6,
            character_ids: ['c-jiang'],
            visual_action: '江澈看向石头',
            eyeline: '石头',
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 6,
            end_sec: 8,
            character_ids: ['c-jiang'],
            visual_action: '江澈从地上醒来',
            eyeline: '意识中',
        }),
    ],
});
const mindZh = composeDramaShotLensTaggedPrompt(session, mindShot);
assert(!/视线\s*脑海/.test(mindZh), `脑海中不得成视线: ${mindZh}`);
assert(!/视线\s*意识/.test(mindZh), `意识中不得成视线: ${mindZh}`);
assert(/看向石头/.test(mindZh), `真实视线石头必须保留: ${mindZh}`);
const lensShot = createEmptyDramaShot({
    shot_no: '1',
    duration_sec: 4,
    character_ids: ['c-jiang'],
    scene_asset_id: 'sc-room',
    timeline_events: [
        createEmptyDramaTimelineEvent({
            start_sec: 0,
            end_sec: 4,
            character_ids: ['c-jiang'],
            visual_action: '江澈站起身。朝云霄峰走去。背影镜头。',
            camera_action: 'slow push-in toward Subject 1',
        }),
    ],
});
const lensZh = composeDramaShotLensTaggedPrompt(session, lensShot);
const lensEn = composeDramaShotH3EnglishPrompt(session, lensShot);
assert(!/背影镜头/.test(lensZh + lensEn), `背影镜头不得进画面: ${lensZh}`);
assert(/站起身/.test(lensZh) && /云霄峰/.test(lensZh), `真实动作必须保留: ${lensZh}`);
assert(!/slow push-in toward Subject 1/i.test(lensEn), `源稿不得写入 camera_action，机位交给 Skill: ${lensEn}`);
assert(!/缓慢推向|中景·|平视·固定/.test(lensZh + lensEn), `源稿不得含中文机位配方: ${lensZh}`);
const su = createEmptyDramaCharacter({
    character_id: 'c-su',
    name: '苏挽月',
    imageUrl: 'https://example.com/su.png',
});
const dirtySession = createEmptyDramaSession({
    bible: {
        characters: [char, su],
        scenes: [scene],
        projectVisualBible: session.bible?.projectVisualBible,
    },
});
const dirtyShot = createEmptyDramaShot({
    shot_no: '1',
    duration_sec: 12,
    character_ids: ['c-jiang', 'c-su'],
    scene_asset_id: 'sc-room',
    timeline_events: [
        createEmptyDramaTimelineEvent({
            start_sec: 0,
            end_sec: 3,
            character_ids: ['c-jiang'],
            visual_action: '江澈靠在电竞椅上，弹幕飞速滚动',
            eyeline: '电竞直播间',
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 3,
            end_sec: 6,
            visual_action: '【弹幕浮字：澈神今天又杀疯了！／全能王名不虚传！／给别人留点活路吧！】',
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 6,
            end_sec: 9,
            visual_action: '【旁白】，出名的烦恼才刚刚开始……',
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 9,
            end_sec: 12,
            character_ids: ['c-su'],
            dialogue: '他怎么还不来。',
            dialogue_character_id: 'c-su',
            expression: '内心OS',
            eyeline: '自己',
        }),
    ],
});
const dirtyZh = composeDramaShotLensTaggedPrompt(dirtySession, dirtyShot);
const dirtyEn = composeDramaShotH3EnglishPrompt(dirtySession, dirtyShot);
assert(/靠在电竞椅上/.test(dirtyZh), `旧脏轴真实动作必须保留: ${dirtyZh}`);
assert(/澈神今天又杀疯了|屏幕弹幕浮字/.test(dirtyZh), `旧脏轴专段弹幕应画屏字: ${dirtyZh}`);
assert(!/内心OS/.test(dirtyZh + dirtyEn), `旧脏轴不得输出内心OS标记: ${dirtyZh}`);
assert(/on-screen live-stream comment overlay/i.test(dirtyEn), `旧脏轴英文应输出弹幕 overlay: ${dirtyEn}`);
assert(!/【旁白】/.test(dirtyZh + dirtyEn), `旧脏轴不得画旁白标签: ${dirtyZh}`);
assert(/出名的烦恼才刚刚开始/.test(dirtyZh), `旧脏轴旁白应进系统声: ${dirtyZh}`);
assert(!/<d>\[Chinese\][^<]*他怎么还不来/.test(dirtyZh), `旧脏轴内心 OS 不得进 <d>: ${dirtyZh}`);
assert(!/视线\s*(?:自己|电竞直播间)/.test(dirtyZh), `旧脏轴不可靠视线必须空: ${dirtyZh}`);
// 混在动作句里的「弹幕飞速滚动」仍应被 scrub，不整句当屏字
assert(!/弹幕飞速滚动/.test(dirtyZh + dirtyEn), `动作句内弹幕飞滚应 scrub: ${dirtyZh}`);
const confuseShot = createEmptyDramaShot({
    shot_no: '1',
    duration_sec: 4,
    character_ids: ['c-jiang'],
    scene_asset_id: 'sc-room',
    timeline_events: [
        createEmptyDramaTimelineEvent({
            start_sec: 0,
            end_sec: 4,
            character_ids: ['c-jiang'],
            visual_action: '江澈站在门外',
            character_state: '困惑',
        }),
    ],
});
const enConfuse = composeDramaShotH3EnglishPrompt(session, confuseShot);
assert(/confused/.test(enConfuse), `困惑 must become confused: ${enConfuse}`);
assert(!/困惑/.test(enConfuse), `english compile must not leak 困惑: ${enConfuse}`);
const alleySession = createEmptyDramaSession({
    bible: {
        characters: [
            createEmptyDramaCharacter({ character_id: 'c-xie', name: '谢必安', imageUrl: 'https://example.com/xie.png' }),
            createEmptyDramaCharacter({ character_id: 'c-fan', name: '范无救', imageUrl: 'https://example.com/fan.png' }),
            createEmptyDramaCharacter({
                character_id: 'c-spirit',
                name: '血怨灵体',
                imageUrl: 'https://example.com/spirit.png',
            }),
        ],
        scenes: [
            createEmptyDramaSceneAsset({
                scene_id: 'sc-alley',
                name: '人间巷弄',
                imageUrl: 'https://example.com/alley.png',
            }),
        ],
        props: [createEmptyDramaProp({ prop_id: 'p-chain', name: '缚魂锁', imageUrl: 'https://example.com/chain.png' })],
    },
});
const alleyShot = createEmptyDramaShot({
    shot_no: '1',
    duration_sec: 20,
    character_ids: ['c-xie', 'c-fan', 'c-spirit'],
    scene_asset_id: 'sc-alley',
    prop_ids: ['p-chain'],
    timeline_events: [
        createEmptyDramaTimelineEvent({
            start_sec: 0,
            end_sec: 1.5,
            character_ids: ['c-xie'],
            camera_action: '—',
            visual_action: '谢必安倒飞出去。撞在墙上。吐出一口黑血。墙面出现裂痕。',
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 1.5,
            end_sec: 4.7,
            character_ids: ['c-fan', 'c-spirit'],
            camera_action: '—',
            visual_action: '血怨灵体从阴影中浮现。形态模糊。眼中泛着红光。',
            dialogue: '你敢打必安！！',
            dialogue_character_id: 'c-fan',
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 4.7,
            end_sec: 7.9,
            character_ids: ['c-fan', 'c-spirit'],
            camera_action: '—',
            visual_action: '范无救举着缠成一团的缚魂锁冲上去。却踩到水渍滑倒。整个人飞出去。锁链团正好砸在血煞鬼头上。血怨灵体在一旁观望。',
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 7.9,
            end_sec: 11.8,
            character_ids: ['c-fan', 'c-spirit'],
            camera_action: '—',
            visual_action: '【慢镜头】锁链团砸中血煞鬼的瞬间。范无救的身体接触到地面的积水。水中的阴寒之气顺着他的经脉涌入。他被篡改的记忆里。一丝战斗本能被触发。缚魂锁发出一道金光。「缚魂诀」无意识发动。血煞鬼被金光弹飞。血怨灵体被金光震退。',
            eyeline: '缚魂锁',
            expression: '震惊',
        }),
    ],
});
const alleyEn = composeDramaShotH3EnglishPrompt(alleySession, alleyShot);
assert(/flung backward|crashes into the wall|black blood/i.test(alleyEn), `alley shot1 action: ${alleyEn}`);
assert(/emerges from the shadows|eyes glow/i.test(alleyEn), `alley shot2 action: ${alleyEn}`);
assert(/charges forward|slips on a wet patch|chain mass/i.test(alleyEn), `alley shot3 action: ${alleyEn}`);
assert(/slow motion|golden light|Soul-Binding Art|blasted away/i.test(alleyEn), `alley shot4 action: ${alleyEn}`);
assert(!/Action:\s*[：:]?\s*[—－–−-]?\s*$/m.test(alleyEn), `action must not be dash-only: ${alleyEn}`);
assert(!/Action:\s*[：:]?\s*—/m.test(alleyEn), `action must not start with emdash: ${alleyEn}`);
assert(/你敢打必安/.test(alleyEn), 'alley dialogue preserved');
const hallSession = createEmptyDramaSession({
    bible: {
        characters: [
            createEmptyDramaCharacter({
                character_id: 'c-jiang',
                name: '江澈',
                imageUrl: 'https://example.com/jiang.png',
            }),
            createEmptyDramaCharacter({
                character_id: 'c-elder',
                name: '白发长老',
                imageUrl: 'https://example.com/elder.png',
            }),
        ],
        scenes: [
            createEmptyDramaSceneAsset({
                scene_id: 'sc-hall',
                name: '主峰议事堂',
                imageUrl: 'https://example.com/hall.png',
            }),
        ],
    },
});
const hallShot = createEmptyDramaShot({
    shot_no: '1',
    duration_sec: 20,
    character_ids: ['c-jiang', 'c-elder'],
    scene_asset_id: 'sc-hall',
    timeline_events: [
        createEmptyDramaTimelineEvent({
            start_sec: 0,
            end_sec: 2.7,
            character_ids: ['c-jiang'],
            visual_action: '议事堂内灯火通明。九把椅子排开。六位长老坐在上面。神情严肃。江澈站在堂中央。灰袍上沾着狼血和泥。红毛刺猬头在烛光下格外显眼。',
            position: '江澈站在堂中央。',
            eyeline: '长老们的眼神',
            character_state: 'anxious、confused',
            expression: '江澈嘴角抽搐。',
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 2.7,
            end_sec: 5.1,
            character_ids: ['c-jiang'],
            position: '江澈站在堂中央。',
            eyeline: '长老们的眼神',
            character_state: 'anxious、confused',
            expression: '江澈嘴角抽搐。',
            dialogue: '？',
            dialogue_character_id: 'c-jiang',
        }),
    ],
});
const hallEn = composeDramaShotH3EnglishPrompt(hallSession, hallShot);
assert(/brightly lit|nine chairs|six elders|stern/i.test(hallEn), `hall establishing: ${hallEn}`);
assert(/stands at the center of the hall/i.test(hallEn), `hall stance: ${hallEn}`);
assert(/mouth corner twitches/i.test(hallEn), `hall twitch: ${hallEn}`);
assert(/eyeline.*elders/i.test(hallEn), `hall eyeline: ${hallEn}`);
assert(/anxious.*confused/i.test(hallEn), `hall state: ${hallEn}`);
assert(!/Action:\s*<Subject 1>\s*\(S1\)\s*$/m.test(hallEn), `hall action not subject-only: ${hallEn}`);
assert(/<d>\[Chinese\]？<\/d>/.test(hallEn), 'hall dialogue d-tag');
const hallBeat2 = dramaVisualActionToEnglish('一位长老激动地拍桌子站起来。大声说道。神情愤怒。', []);
assert(/slams the table/i.test(hallBeat2), `拍桌子: ${hallBeat2}`);
assert(/furious/i.test(hallBeat2), `愤怒: ${hallBeat2}`);
assert(/hands on hips|mouth corner lifts|relaxed/i.test(dramaVisualActionToEnglish('江澈双手叉腰。嘴角微扬。语气轻松地回应。', [
    { name: '江澈', replacement: '<Subject 1> (S1)' },
])), '叉腰微扬');
assert(/kicks the stool|rebuke/i.test(dramaVisualActionToEnglish('另一位长老猛地一脚把凳子踢开。站起身来。大声呵斥。', [])), '踢凳呵斥');
assert(/tilts the head|disdain/i.test(dramaVisualActionToEnglish('江澈微微侧头。眼神中带着一丝不屑。', [
    { name: '江澈', replacement: '<Subject 1> (S1)' },
])), '侧头不屑');
assert(/exchange glances|shock and fury/i.test(dramaVisualActionToEnglish('长老们彼此对视。脸上写满震惊和愤怒。', [])), '对视震惊');
assert(/turns and walks away|solitary and proud|candlelight/i.test(dramaVisualActionToEnglish('江澈转身离开。背影在烛光下显得格外孤傲。', [
    { name: '江澈', replacement: '<Subject 1> (S1)' },
])), '孤傲离场');
// ---------- P0 GAZE 6.6s：动作链不得静默蒸发；对白 Shot 须有说前/说后 ----------
const boy = createEmptyDramaCharacter({
    character_id: 'c-boy',
    name: '少年',
    imageUrl: 'https://example.com/boy.png',
});
const gazeScene = createEmptyDramaSceneAsset({
    scene_id: 'sc-hall',
    name: '灵根殿',
    imageUrl: 'https://example.com/hall.png',
});
const gazeSession = createEmptyDramaSession({
    bible: {
        characters: [boy, char, elder],
        scenes: [gazeScene],
        projectVisualBible: createEmptyDramaProjectVisualBible({
            presetName: '电影质感夜戏',
            stylePrompt: 'cinematic film look, low saturation, strong contrast',
            selected_at: Date.now(),
        }),
    },
});
const gazeShot = createEmptyDramaShot({
    shot_no: '01',
    duration_sec: 6.6,
    character_ids: ['c-boy', 'c-jiang', 'c-elder'],
    scene_asset_id: 'sc-hall',
    action: '青衫少年看向江澈。\n\n少年：\n“你为什么不说话？”\n\n江澈没有回答，转头看向执事长老。\n\n执事长老：\n“开始吧。”',
    timeline_events: [
        createEmptyDramaTimelineEvent({
            start_sec: 0,
            end_sec: 1.5,
            character_ids: ['c-boy'],
            visual_action: '青衫少年看向江澈',
            eyeline: 'c-jiang',
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 1.5,
            end_sec: 3.5,
            character_ids: ['c-boy'],
            visual_action: '',
            dialogue: '“你为什么不说话？”',
            dialogue_character_id: 'c-boy',
            lip_sync: true,
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 3.5,
            end_sec: 5,
            character_ids: ['c-jiang'],
            visual_action: '江澈没有回答，转头看向执事长老',
            eyeline: 'c-elder',
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 5,
            end_sec: 6.6,
            character_ids: ['c-elder'],
            visual_action: '',
            dialogue: '“开始吧。”',
            dialogue_character_id: 'c-elder',
            lip_sync: true,
        }),
    ],
});
const gazeEn = composeDramaShotH3EnglishPrompt(gazeSession, gazeShot);
assert(/looks toward/i.test(gazeEn), `GAZE Shot1 看向必须保留: ${gazeEn}`);
assert(/does not answer/i.test(gazeEn) && /turns the head and looks toward/i.test(gazeEn), `GAZE Shot3 不答+转头看向: ${gazeEn}`);
assert(/你为什么不说话/.test(gazeEn) && /开始吧/.test(gazeEn), `GAZE 台词 <d>: ${gazeEn}`);
assert(/parts the lips and says:\s*<d>\[Chinese\]/.test(gazeEn), `GAZE 说前状态: ${gazeEn}`);
assert(/closes the mouth and holds still after the line/i.test(gazeEn), `GAZE 说后状态: ${gazeEn}`);
assert(!/少年[：:].*执事长老[：:]|你为什么不说话[\s\S]*开始吧[\s\S]*looks toward/i.test(gazeEn.match(/\[Shot 2\][\s\S]*?(?=\[Shot 3\]|$)/)?.[0] || ''), `GAZE 对白 Shot 不得塞整段 action: ${gazeEn}`);
assert(dramaVisualActionToEnglish('青衫少年看向江澈', [
    { name: '少年', replacement: '<Subject 1> (S1)' },
    { name: '江澈', replacement: '<Subject 2> (S2)' },
]).length > 0, '看向不得静默变空');
console.log('composeDramaShotLensPrompt.selftest ok');
