/**
 * 电影级运镜：按镜头语言推导，禁止随机，禁止复用「中景·正面·固定」。
 * 运行：npx tsx src/shared/directorDomain/cinematicCameraAction.selftest.ts
 */
import { applyCinematicCamerasToTimelineEvents, composeDramaCinematicCameraDesign, inferDramaCamBeatRole, inferDramaCamEmotionLane, isThinDramaCameraAction, resolveDramaEventCameraAction, } from './cinematicCameraAction.js';
import { createEmptyDramaDialogueLine, createEmptyDramaShot } from './factories.js';
import { createEmptyDramaTimelineEvent, ensureDramaShotTimelineEvents, } from './timelineEvent.js';
function assert(cond, msg) {
    if (!cond)
        throw new Error(msg);
}
assert(isThinDramaCameraAction(''), 'empty is thin');
assert(isThinDramaCameraAction('中景 · 正面 · 固定镜头'), 'stock chinese is thin');
assert(isThinDramaCameraAction('全景｜平视｜固定｜35mm｜三分法'), 'cut-cycle is thin');
assert(isThinDramaCameraAction('缓慢推向江澈'), 'short push is thin');
assert(!isThinDramaCameraAction('中近景 · 过肩对切感 · 过肩压迫，前景肩背虚化，85mm浅景深隔离，85mm，三分构图，质问落在听者耳后'), 'named over-shoulder is not thin');
const shot = createEmptyDramaShot({
    shot_no: '1',
    duration_sec: 12,
    purpose: '对峙宣判',
    dramatic_purpose: '权力压迫下质问',
    action: '江澈走进灵根殿，执事长老宣判',
    expression: '冷、压抑',
    character_ids: ['c-jiang', 'c-elder'],
    dialogue: [
        createEmptyDramaDialogueLine({
            dialogue_id: 'dlg-elder-1',
            character_id: 'c-elder',
            character_name: '执事长老',
            text: '还来？你是不是没用力？',
        }),
    ],
});
const rawEvents = [
    createEmptyDramaTimelineEvent({
        start_sec: 0,
        end_sec: 3,
        visual_action: '江澈进入灵根殿画面，站位落定，双手自然下垂',
        camera_action: '中景 · 正面 · 固定镜头',
    }),
    createEmptyDramaTimelineEvent({
        start_sec: 3,
        end_sec: 8,
        visual_action: '执事长老俯视质问',
        dialogue: '还来？你是不是没用力？',
        dialogue_character_id: 'c-elder',
        lip_sync: true,
        camera_action: '中景 · 正面 · 固定镜头',
    }),
    createEmptyDramaTimelineEvent({
        start_sec: 8,
        end_sec: 12,
        visual_action: '维持落点，呼吸起伏',
        camera_action: '中景 · 正面 · 固定镜头',
    }),
];
assert(inferDramaCamBeatRole(shot, rawEvents[0], 0, 3) === 'establish', 'first silent is establish');
assert(inferDramaCamBeatRole(shot, rawEvents[1], 1, 3) === 'dialogue', 'spoken is dialogue');
assert(inferDramaCamEmotionLane(shot, rawEvents[1]) === 'power' || inferDramaCamEmotionLane(shot, rawEvents[1]) === 'confront', 'lane from 宣判/对峙');
const designed = applyCinematicCamerasToTimelineEvents(shot, rawEvents);
assert(designed[0].camera_action === rawEvents[0].camera_action, `written camera must be kept: ${designed[0].camera_action}`);
assert(designed[1].camera_action === rawEvents[1].camera_action, `written dialogue camera must be kept: ${designed[1].camera_action}`);
assert(resolveDramaEventCameraAction({
    shot,
    event: { camera_action: '', visual_action: '穿过人群' },
    index: 0,
    total: 2,
}) === '', 'empty camera stays empty');
assert(resolveDramaEventCameraAction({
    shot,
    event: { camera_action: '缓慢推向江澈', visual_action: '江澈坐着' },
    index: 0,
    total: 1,
}) === '缓慢推向江澈', 'short user camera is kept');
const custom = '极低机位超广角贴地穿过人群，24mm，框中框，用户手写机位';
assert(resolveDramaEventCameraAction({
    shot,
    event: { camera_action: custom, visual_action: '穿过人群' },
    index: 0,
    total: 2,
}) === custom, 'user-authored cinematic line is kept');
const a = composeDramaCinematicCameraDesign({
    shot,
    event: rawEvents[0],
    index: 0,
    total: 3,
});
const b = composeDramaCinematicCameraDesign({
    shot,
    event: rawEvents[0],
    index: 0,
    total: 3,
});
assert(a.line === b.line, 'same inputs must be deterministic, never random');
const ready = ensureDramaShotTimelineEvents({
    ...shot,
    timeline_events: rawEvents,
});
assert(ready.timeline_events[0].camera_action === rawEvents[0].camera_action, `ensure must not upgrade cameras: ${ready.timeline_events[0].camera_action}`);
assert(ready.timeline_events[1].camera_action === rawEvents[1].camera_action, `ensure must keep dialogue camera: ${ready.timeline_events[1].camera_action}`);
console.log('cinematicCameraAction.selftest ok');
console.log(ready.timeline_events.map((e) => e.camera_action).join('\n'));
