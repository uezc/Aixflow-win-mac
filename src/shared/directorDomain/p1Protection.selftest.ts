/**
 * P1 第一阶段保护层：A3 有效 Timeline 不被覆盖 / A4 生产不用 skill / A2 对白不裁短。
 * 运行：npx tsx src/shared/directorDomain/p1Protection.selftest.ts
 */
import { resolveDramaProductionH3Prompt } from './composeDramaShotLensPrompt.js';
import { applyDramaDirectingBreakdownSession, applyDramaDirectingBreakdownToShot } from './directingBreakdown.js';
import { createEmptyDramaCharacter, createEmptyDramaSceneAsset, createEmptyDramaSession, createEmptyDramaShot, } from './factories.js';
import { estimateDramaTalkSec } from './shotDurationFastPace.js';
import { applyDramaBoardEnrichResult, alignDramaShotTimelineToGenerateDuration, downshiftDramaShotDurationTierSec, enrichDramaShotLocally, resolveDramaGenerateDurationSec, } from './shotTimeline.js';
import { createEmptyDramaTimelineEvent, ensureDramaShotTimelineEvents, minDramaTimelineDialogueSpanSec, normalizeDramaTimelineEvents, rescaleDramaTimelineEventsToDuration, setDramaTimelineBoundarySec, } from './timelineEvent.js';
function assert(cond, msg) {
    if (!cond)
        throw new Error(msg);
}
function span(e) {
    return Number(e.end_sec) - Number(e.start_sec);
}
function charJiang() {
    return createEmptyDramaCharacter({
        character_id: 'c-jiang',
        name: '江澈',
        imageUrl: 'https://example.com/jiang.png',
    });
}
function baseSession(shot) {
    return createEmptyDramaSession({
        bible: {
            characters: [charJiang()],
            scenes: [
                createEmptyDramaSceneAsset({
                    scene_id: 'sc-room',
                    name: '房间',
                    imageUrl: 'https://example.com/room.png',
                }),
            ],
        },
        shots: [shot],
    });
}
function validShot(partial) {
    return createEmptyDramaShot({
        shot_id: 'shot-p1',
        shot_no: '1',
        duration_sec: 6,
        scene_asset_id: 'sc-room',
        character_ids: ['c-jiang'],
        timeline_events: [
            createEmptyDramaTimelineEvent({
                event_id: 'te-action',
                start_sec: 0,
                end_sec: 1.2,
                character_ids: ['c-jiang'],
                visual_action: '江澈拿起汽水',
                camera_action: 'slow push-in toward Subject 1',
            }),
            createEmptyDramaTimelineEvent({
                event_id: 'te-talk',
                start_sec: 1.2,
                end_sec: 2.4,
                character_ids: ['c-jiang'],
                dialogue: '我操……',
                dialogue_character_id: 'c-jiang',
            }),
        ],
        ...partial,
    });
}
// ---------- A3 ----------
const shot0 = validShot();
const session0 = baseSession(shot0);
const forced = applyDramaDirectingBreakdownToShot(session0, shot0, null, { force: true });
assert(forced.timeline_events[0].camera_action === 'slow push-in toward Subject 1', `A3 force 不得改 camera: ${forced.timeline_events[0].camera_action}`);
assert(forced.timeline_events[0].visual_action === '江澈拿起汽水', `A3 force 不得改 visual_action: ${forced.timeline_events[0].visual_action}`);
assert(forced.timeline_events[1].dialogue === '我操……', 'A3 force 不得改 dialogue');
const sessionForced = applyDramaDirectingBreakdownSession(session0, {
    force: true,
    shotIds: [shot0.shot_id],
});
assert(sessionForced.shots[0].timeline_events[0].camera_action === 'slow push-in toward Subject 1', 'A3 session force 不得覆盖 camera');
const llmJson = JSON.stringify({
    shots: [
        {
            shot_id: shot0.shot_id,
            duration_sec: 6,
            timeline_events: [
                {
                    event_id: 'te-action',
                    start_sec: 0,
                    end_sec: 9,
                    visual_action: 'INVENTED_REWRITE 优雅缓缓举起',
                    camera_action: 'two-shot close-up dolly',
                    eyeline: '远处',
                },
                {
                    event_id: 'te-talk',
                    start_sec: 9,
                    end_sec: 12,
                    dialogue: '改写台词',
                    camera_action: 'over-the-shoulder',
                },
            ],
        },
    ],
});
const enriched = applyDramaBoardEnrichResult(session0, llmJson);
const enShot = enriched.shots[0];
assert(enShot.timeline_events[0].visual_action === '江澈拿起汽水', `A3 enrich 不得覆盖 visual_action: ${enShot.timeline_events[0].visual_action}`);
assert(enShot.timeline_events[0].camera_action === 'slow push-in toward Subject 1', `A3 enrich 不得覆盖 camera: ${enShot.timeline_events[0].camera_action}`);
assert(enShot.timeline_events[1].dialogue === '我操……', 'A3 enrich 不得覆盖 dialogue');
assert(enShot.timeline_events[0].eyeline === '远处', 'A3 enrich 可填空 eyeline');
const ensured = ensureDramaShotTimelineEvents(forced, session0);
assert(ensured.timeline_events[0].camera_action === 'slow push-in toward Subject 1', 'A3 ensure 后 camera 仍在');
const emptyCam = validShot({
    timeline_events: [
        createEmptyDramaTimelineEvent({
            event_id: 'te-empty-cam',
            start_sec: 0,
            end_sec: 2,
            visual_action: '江澈望向远处',
            camera_action: '',
        }),
    ],
});
const emptyForced = applyDramaDirectingBreakdownToShot(baseSession(emptyCam), emptyCam, null, {
    force: true,
});
assert(emptyForced.timeline_events[0].camera_action === '', `A3 空机位不得被 cinematic 填入: ${emptyForced.timeline_events[0].camera_action}`);
assert(!/push-in|dolly|two-shot|close-up|over-the-shoulder/i.test(emptyForced.timeline_events[0].camera_action), 'A3 空机位无运镜词');
// ---------- A4 ----------
const skillShot = validShot({
    h3_skill_prompt: 'SKILL_TOKEN_P1_SHOULD_NOT_CLOUD two-shot close-up dolly push-in over-the-shoulder',
});
const prod = resolveDramaProductionH3Prompt(baseSession(skillShot), skillShot, { locale: 'zh-CN' });
assert(!/SKILL_TOKEN_P1_SHOULD_NOT_CLOUD/.test(prod), 'A4 非官方格式的 h3_skill_prompt 不得上云');
assert(/@图片|风格色调|剧情/.test(prod), 'A4 中文默认回退白话 Compiler，不用英文 subject_definitions');
const prodEnFallback = resolveDramaProductionH3Prompt(baseSession(skillShot), skillShot, {
    locale: 'en',
});
assert(
    /subject_definitions\s*:/i.test(prodEnFallback) || /<Subject\s+1>/i.test(prodEnFallback),
    'A4 英文 locale 才回退英文 Compiler',
);
const sealedOk = validShot({
    h3_skill_prompt: [
        'subject_definitions:',
        '<Picture 1> is the environment.',
        '<Subject 1> is the character referenced by <Picture 1>.',
        'summary:',
        'retention_analysis:',
        'detailed_description:',
        '[Shot 1] At 00:00.000-00:04.000 <Subject 1> holds still.',
        'overall_soundscape:',
        'non_diegetic_music: N/A',
    ].join('\n'),
});
const prodSealed = resolveDramaProductionH3Prompt(baseSession(sealedOk), sealedOk, { locale: 'en' });
assert(/SKILL_TOKEN/.test(prodSealed) === false && /subject_definitions\s*:/i.test(prodSealed), 'A4 官方密封稿可上云');
assert(prodSealed.includes('[Shot 1]'), 'A4 密封稿保留 Shot');
const zhPlain = validShot({
    h3_skill_prompt: [
        '@图片1 是江澈',
        '风格色调：需要写实。',
        '剧情：',
        '江澈拿起汽水。',
    ].join('\n'),
});
const prodZh = resolveDramaProductionH3Prompt(baseSession(zhPlain), zhPlain, { locale: 'zh-CN' });
assert(/@图片1 是江澈/.test(prodZh), 'A4 中文白话优化稿可直接上云');
const prodZhIgnoredEn = resolveDramaProductionH3Prompt(baseSession(zhPlain), zhPlain, { locale: 'en' });
assert(/@图片1 是江澈/.test(prodZhIgnoredEn), 'A4 英文 locale 同样可用中文密封稿');
// ---------- A2 ----------
const shortLine = '我操——';
const floorShort = minDramaTimelineDialogueSpanSec(shortLine);
const shortPacked = normalizeDramaTimelineEvents([
    createEmptyDramaTimelineEvent({
        start_sec: 0,
        end_sec: 1.2,
        visual_action: '拿起汽水',
    }),
    createEmptyDramaTimelineEvent({
        start_sec: 1.2,
        end_sec: 1.5,
        dialogue: shortLine,
        dialogue_character_id: 'c-jiang',
    }),
], 4);
const shortDlg = shortPacked.find((e) => e.dialogue);
assert(shortDlg, 'A2 case1 应对白 event');
assert(span(shortDlg) + 1e-9 >= floorShort, `A2 case1 窗口 ${span(shortDlg)} < floor ${floorShort}`);
const longLine = '家人们，这把打完就下播了啊。明天冲峡谷之巅第一，目前差三百分……';
const floorLong = estimateDramaTalkSec(longLine);
assert(floorLong > 3, `A2 长对白估时应明显大于 3s，实际 ${floorLong}`);
const longPacked = normalizeDramaTimelineEvents([
    createEmptyDramaTimelineEvent({
        start_sec: 0,
        end_sec: 1.5,
        visual_action: '动作',
    }),
    createEmptyDramaTimelineEvent({
        start_sec: 1.5,
        end_sec: 2.0,
        dialogue: longLine,
        dialogue_character_id: 'c-jiang',
    }),
    createEmptyDramaTimelineEvent({
        start_sec: 2.0,
        end_sec: 3.0,
        environment_audio: ['雷声由远及近'],
    }),
], 4);
const longDlg = longPacked.find((e) => e.dialogue);
assert(longDlg, 'A2 case2 应对白 event');
assert(span(longDlg) + 1e-9 >= floorLong, `A2 case2 窗口 ${span(longDlg)} < estimateTalkSec ${floorLong}`);
assert(longPacked[0].visual_action === '动作', 'A2 不得按比例拉长而改写动作内容');
const actionSpan = span(longPacked[0]);
assert(actionSpan <= 1.6 + 1e-9, `A2 动作不应被同比拉长，实际 ${actionSpan}`);
const lastTalk = normalizeDramaTimelineEvents([
    createEmptyDramaTimelineEvent({
        start_sec: 0,
        end_sec: 1,
        visual_action: '动作',
    }),
    createEmptyDramaTimelineEvent({
        start_sec: 1,
        end_sec: 1.4,
        environment_audio: ['雷声'],
    }),
    createEmptyDramaTimelineEvent({
        start_sec: 1.4,
        end_sec: 2.0,
        dialogue: longLine,
        dialogue_character_id: 'c-jiang',
    }),
], 4);
const lastDlg = lastTalk[lastTalk.length - 1];
assert(lastDlg.dialogue === longLine, 'A2 case3 末段仍是对白');
assert(span(lastDlg) + 1e-9 >= floorLong, `A2 case3 末段对白被裁短 ${span(lastDlg)} < ${floorLong}`);
const need82shot = createEmptyDramaShot({
    shot_id: 'shot-dur',
    shot_no: '2',
    duration_sec: 6,
    character_ids: ['c-jiang'],
    timeline_events: [
        createEmptyDramaTimelineEvent({
            start_sec: 0,
            end_sec: 1,
            visual_action: '动作',
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 1,
            end_sec: 1.5,
            dialogue: longLine,
            dialogue_character_id: 'c-jiang',
        }),
    ],
});
const lifted = ensureDramaShotTimelineEvents(need82shot, baseSession(need82shot));
const liftedDlg = lifted.timeline_events.find((e) => e.dialogue);
assert(liftedDlg, 'A2 case4 应对白');
assert(span(liftedDlg) + 1e-9 >= floorLong, `A2 case4 窗口 ${span(liftedDlg)} < ${floorLong}`);
assert(Number(lifted.duration_sec) + 1e-9 >= floorLong, `A2 case4 duration ${lifted.duration_sec} < ${floorLong}`);
const rescaled = rescaleDramaTimelineEventsToDuration(need82shot.timeline_events, 6, 6);
const rescaledDlg = rescaled.find((e) => e.dialogue);
assert(rescaledDlg, 'A2 rescale 应对白');
assert(span(rescaledDlg) + 1e-9 >= floorLong, `A2 rescale 压缩对白 ${span(rescaledDlg)} < ${floorLong}`);
const shrunk = rescaleDramaTimelineEventsToDuration([
    createEmptyDramaTimelineEvent({ start_sec: 0, end_sec: 8, visual_action: '走' }),
    createEmptyDramaTimelineEvent({ start_sec: 8, end_sec: 15, visual_action: '停' }),
], 15, 10);
const shrunkEnd = Math.max(0, ...shrunk.map((e) => Number(e.end_sec) || 0));
assert(Math.abs(shrunkEnd - 10) < 0.2, `A2 rescale 缩短失败 ${shrunkEnd} != 10`);
assert(downshiftDramaShotDurationTierSec(20) === 15, '出片减档 20→15');
assert(downshiftDramaShotDurationTierSec(15) === 10, '出片减档 15→10');
assert(downshiftDramaShotDurationTierSec(10) === 6, '出片减档 10→6');
assert(downshiftDramaShotDurationTierSec(6) === 6, '出片减档 6 保持');
assert(downshiftDramaShotDurationTierSec(18) === 15, '出片减档 18 先落到 20 再减到 15');
assert(downshiftDramaShotDurationTierSec(12) === 6, '出片减档 12 先落到 10 再减到 6');
assert(resolveDramaGenerateDurationSec(20) === 15, '默认出片 20→15');
assert(resolveDramaGenerateDurationSec(20, { video_duration: '20' }) === 20, '手选出片 20');
assert(resolveDramaGenerateDurationSec(20, { video_duration: '10' }) === 10, '手选出片 10');
{
  const plan20 = createEmptyDramaShot({
    shot_id: 'align-20',
    duration_sec: 20,
    timeline_events: [
      createEmptyDramaTimelineEvent({ start_sec: 0, end_sec: 10, visual_action: 'A' }),
      createEmptyDramaTimelineEvent({ start_sec: 10, end_sec: 20, visual_action: 'B' }),
    ],
    h3_skill_prompt: [
      'subject_definitions:',
      '[Shot 1] At 00:00.000 the beat starts.',
      '[Shot 2] At 00:10.000-00:20.000 <Subject 1> holds still.',
    ].join('\n'),
    h3_skill_prompt_from: '[Shot 2] At 00:10.000 continues.',
    last_compiled_prompt: 'At 00:10.000 keep.',
  });
  const aligned = alignDramaShotTimelineToGenerateDuration(plan20, 15);
  assert(aligned.changed, '20→15 应对齐');
  assert(aligned.shot.duration_sec === 15, '彩条时长=生成时长 15');
  assert(Math.abs(aligned.shot.timeline_events[1].end_sec - 15) < 0.05, '末段对齐到 15s');
  assert(aligned.shot.model_params?.video_duration === '15', 'video_duration 同步');
  assert(!!String(aligned.shot.h3_skill_prompt || '').trim(), '切换时长不得清空提示词');
  assert(/At 00:07\.500/.test(aligned.shot.h3_skill_prompt || ''), `提示词按时长比例重映射: ${aligned.shot.h3_skill_prompt}`);
  assert(/00:15\.000/.test(aligned.shot.h3_skill_prompt || ''), `末段时码应对齐 15s: ${aligned.shot.h3_skill_prompt}`);
  assert(/At 00:07\.500/.test(aligned.shot.h3_skill_prompt_from || ''), 'from 稿同步重映射');
  assert(/At 00:07\.500/.test(aligned.shot.last_compiled_prompt || ''), '编译稿同步重映射');
  const pct15 = aligned.shot.timeline_events[0].end_sec / 15;
  const to6 = alignDramaShotTimelineToGenerateDuration(aligned.shot, 6);
  assert(Math.abs(to6.shot.timeline_events[0].end_sec / 6 - pct15) < 0.02, '换档后分界占比不变');
  assert(Math.abs(to6.shot.timeline_events[1].end_sec - 6) < 0.05, '6s 末段贴齐总长');
}
const locally = enrichDramaShotLocally(baseSession(need82shot), need82shot);
const locDlg = locally.timeline_events.find((e) => e.dialogue);
assert(locDlg && span(locDlg) + 1e-9 >= floorLong, 'A2 enrichDramaShotLocally 不得压对白');
assert(Number(locally.duration_sec) + 1e-9 >= floorLong, 'A2 enrich 应抬高 duration');
{
    const longOs = '击杀任意生物可获得金币，金币可在商城购买菜单、装备、武器。';
    const pair = [
        createEmptyDramaTimelineEvent({
            start_sec: 0,
            end_sec: 10,
            visual_action: '全息系统面板',
            dialogue: longOs,
            dialogue_character_id: 'system',
        }),
        createEmptyDramaTimelineEvent({
            start_sec: 10,
            end_sec: 20,
            visual_action: '空镜',
        }),
    ];
    const left = setDramaTimelineBoundarySec(pair, 0, 6, 20);
    assert(left.length === 2, '分界左拉应保持两段');
    assert(Math.abs(left[0].end_sec - 6) < 0.05, `分界左拉第一段应到 6s，实际 ${left[0].end_sec}`);
    assert(Math.abs(left[1].start_sec - 6) < 0.05, '分界左拉第二段起点跟随');
    assert(Math.abs(left[1].end_sec - 20) < 0.05, '分界左拉总时长仍 20s');
    const right = setDramaTimelineBoundarySec(pair, 0, 16, 20);
    assert(Math.abs(right[0].end_sec - 16) < 0.05, `分界右拉第一段应到 16s，实际 ${right[0].end_sec}`);
    assert(Math.abs(right[1].end_sec - 20) < 0.05, '分界右拉总时长仍 20s');
    const kept = ensureDramaShotTimelineEvents(createEmptyDramaShot({ duration_sec: 20, timeline_events: left }), undefined, { preserveTiming: true });
    assert(Number(kept.duration_sec) === 20, '手拖后 ensure 不得抬高 duration');
    assert(Math.abs(kept.timeline_events[0].end_sec - 6) < 0.05, '手拖后 ensure 不得把对白段弹回');
}
console.log('p1Protection.selftest ok');
console.log(JSON.stringify({
    A3: 'PASS',
    A4: 'PASS',
    A2: 'PASS',
    talkFloorShort: floorShort,
    talkFloorLong: floorLong,
    liftedDuration: lifted.duration_sec,
}));
