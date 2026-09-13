/**
 * Compiler 镜头语言默认回填自检。
 * 运行：npx tsx src/shared/directorDomain/cameraLanguageDefaults.selftest.ts
 */
import {
  applyDramaShotPromptBackfill,
  classifyDramaCameraBeatKind,
  defaultDramaCameraActionForBeat,
  DRAMA_DEFAULT_CAMERA_BY_BEAT,
  dramaShotCameraRecipeFromFields,
} from './dramaShotPromptBackfill.js';
import {
  composeDramaShotH3EnglishPrompt,
  composeDramaShotLensTaggedPrompt,
} from './composeDramaShotLensPrompt.js';
import {
  createEmptyDramaCharacter,
  createEmptyDramaProp,
  createEmptyDramaSceneAsset,
  createEmptyDramaSession,
  createEmptyDramaShot,
} from './factories.js';
import { createEmptyDramaTimelineEvent } from './timelineEvent.js';
import { createEmptyDramaProjectVisualBible } from './visualDna.js';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const jiang = createEmptyDramaCharacter({
  character_id: 'c-jiang',
  name: '江澈',
  imageUrl: 'https://example.com/jiang.png',
});
const room = createEmptyDramaSceneAsset({
  scene_id: 'sc-room',
  name: '电竞直播间',
  imageUrl: 'https://example.com/room.png',
});
const chair = createEmptyDramaProp({
  prop_id: 'p-chair',
  name: '电竞椅',
  imageUrl: 'https://example.com/chair.png',
});
const session = createEmptyDramaSession({
  bible: {
    characters: [jiang],
    scenes: [room],
    props: [chair],
    projectVisualBible: createEmptyDramaProjectVisualBible({
      presetName: '电竞',
      stylePrompt: 'cinematic',
      selected_at: Date.now(),
    }),
  },
});

function emptyCamShot(
  events: ReturnType<typeof createEmptyDramaTimelineEvent>[],
  extra?: Partial<ReturnType<typeof createEmptyDramaShot>>,
) {
  return createEmptyDramaShot({
    shot_no: '1',
    duration_sec: 20,
    character_ids: ['c-jiang'],
    scene_asset_id: 'sc-room',
    prop_ids: ['p-chair'],
    size: '',
    angle: '',
    camera: '',
    move: '',
    framing: '',
    timeline_events: events,
    ...extra,
  });
}

// --- 分类规则 ---
{
  const establishEv = createEmptyDramaTimelineEvent({
    start_sec: 0,
    end_sec: 3,
    character_ids: ['c-jiang'],
    visual_action: 'RGB灯条在昏暗房间里闪烁。江澈靠在电竞椅上',
  });
  assert(
    classifyDramaCameraBeatKind(establishEv, emptyCamShot([establishEv], { dramatic_purpose: 'establish' }), 0) ===
      'establish',
    'establish',
  );
  assert(
    defaultDramaCameraActionForBeat(establishEv, emptyCamShot([establishEv]), 0) ===
      DRAMA_DEFAULT_CAMERA_BY_BEAT.establish,
    'establish default',
  );
}

{
  const screenEv = createEmptyDramaTimelineEvent({
    start_sec: 3,
    end_sec: 5,
    character_ids: ['c-jiang'],
    visual_action: '【弹幕浮字：澈神今天又杀疯了！／全能王名不虚传！】',
  });
  assert(classifyDramaCameraBeatKind(screenEv, emptyCamShot([screenEv]), 1) === 'screen', 'screen');
  assert(
    defaultDramaCameraActionForBeat(screenEv, emptyCamShot([screenEv]), 1) ===
      DRAMA_DEFAULT_CAMERA_BY_BEAT.screen,
    'screen default',
  );
  assert(!/特写|近景|face/i.test(DRAMA_DEFAULT_CAMERA_BY_BEAT.screen), 'screen 禁止看脸近景');
}

{
  const dlgEv = createEmptyDramaTimelineEvent({
    start_sec: 5,
    end_sec: 9,
    character_ids: ['c-jiang'],
    visual_action: '',
    dialogue: '家人们，这把打完就下播了啊。',
    dialogue_character_id: 'c-jiang',
  });
  assert(classifyDramaCameraBeatKind(dlgEv, emptyCamShot([dlgEv]), 2) === 'dialogue', 'dialogue');
  assert(
    defaultDramaCameraActionForBeat(dlgEv, emptyCamShot([dlgEv]), 2) ===
      DRAMA_DEFAULT_CAMERA_BY_BEAT.dialogue,
    'dialogue default',
  );
  assert(!/大特写/.test(DRAMA_DEFAULT_CAMERA_BY_BEAT.dialogue), 'dialogue 避免大特写');
}

{
  const envEv = createEmptyDramaTimelineEvent({
    start_sec: 12,
    end_sec: 16,
    character_ids: ['c-jiang'],
    visual_action: '窗外雷声由远及近，江澈看向窗户方向',
  });
  assert(
    classifyDramaCameraBeatKind(envEv, emptyCamShot([envEv]), 3) === 'action_environment',
    'action_environment',
  );
  assert(
    /环境/.test(defaultDramaCameraActionForBeat(envEv, emptyCamShot([envEv]), 3)),
    'action_environment 须点环境',
  );
}

{
  const actEv = createEmptyDramaTimelineEvent({
    start_sec: 1,
    end_sec: 3,
    character_ids: ['c-jiang'],
    visual_action: '他打了个哈欠，拿起一罐汽水灌了一大口',
  });
  assert(classifyDramaCameraBeatKind(actEv, emptyCamShot([actEv]), 1) === 'action', 'action');
  assert(
    defaultDramaCameraActionForBeat(actEv, emptyCamShot([actEv]), 1) ===
      DRAMA_DEFAULT_CAMERA_BY_BEAT.action,
    'action default',
  );
}

// --- 优先级：已有 camera_action 不覆盖 ---
{
  const kept = '低机位仰拍 · 急推变焦';
  const shot = emptyCamShot([
    createEmptyDramaTimelineEvent({
      start_sec: 0,
      end_sec: 4,
      character_ids: ['c-jiang'],
      visual_action: 'RGB灯条闪烁，江澈靠在电竞椅上',
      camera_action: kept,
      dialogue: '',
    }),
  ]);
  const filled = applyDramaShotPromptBackfill(shot);
  assert(filled.timeline_events?.[0]?.camera_action === kept, `不得覆盖已有机位: ${filled.timeline_events?.[0]?.camera_action}`);
}

// --- 优先级：镜级 recipe 优于默认 ---
{
  const shot = emptyCamShot(
    [
      createEmptyDramaTimelineEvent({
        start_sec: 0,
        end_sec: 4,
        character_ids: ['c-jiang'],
        visual_action: 'RGB灯条闪烁，江澈靠在电竞椅上',
        camera_action: '',
      }),
    ],
    { size: '全景', angle: '俯拍', move: '环绕审视' },
  );
  const recipe = dramaShotCameraRecipeFromFields(shot);
  assert(/全景/.test(recipe), `recipe=${recipe}`);
  const filled = applyDramaShotPromptBackfill(shot);
  assert(
    filled.timeline_events?.[0]?.camera_action === recipe,
    `镜级 recipe 优先: ${filled.timeline_events?.[0]?.camera_action}`,
  );
}

// --- 皆空才默认 ---
{
  const shot = emptyCamShot([
    createEmptyDramaTimelineEvent({
      start_sec: 0,
      end_sec: 3,
      character_ids: ['c-jiang'],
      visual_action: 'RGB灯条在昏暗房间里闪烁。江澈靠在电竞椅上',
      camera_action: '',
    }),
    createEmptyDramaTimelineEvent({
      start_sec: 3,
      end_sec: 5,
      character_ids: ['c-jiang'],
      visual_action: '【弹幕浮字：澈神今天又杀疯了！】',
      camera_action: '',
    }),
    createEmptyDramaTimelineEvent({
      start_sec: 5,
      end_sec: 9,
      character_ids: ['c-jiang'],
      visual_action: '江澈坐在电竞椅上，左手键盘右手鼠标',
      camera_action: '',
    }),
    createEmptyDramaTimelineEvent({
      start_sec: 9,
      end_sec: 12,
      character_ids: ['c-jiang'],
      dialogue: '播啊，怎么不播。',
      dialogue_character_id: 'c-jiang',
      camera_action: '',
    }),
    createEmptyDramaTimelineEvent({
      start_sec: 12,
      end_sec: 14,
      character_ids: ['c-jiang'],
      visual_action: '【弹幕浮字：全能王名不虚传！】',
      camera_action: '',
    }),
    createEmptyDramaTimelineEvent({
      start_sec: 14,
      end_sec: 18,
      character_ids: ['c-jiang'],
      visual_action: '窗外雷声由远及近，一道白光闪过',
      camera_action: '',
    }),
  ], { dramatic_purpose: 'establish' });

  const filled = applyDramaShotPromptBackfill(shot);
  const cams = (filled.timeline_events || []).map((e) => e.camera_action);
  assert(cams[0] === DRAMA_DEFAULT_CAMERA_BY_BEAT.establish, `S1 establish: ${cams[0]}`);
  assert(cams[1] === DRAMA_DEFAULT_CAMERA_BY_BEAT.screen, `S2 screen: ${cams[1]}`);
  assert(cams[2] === DRAMA_DEFAULT_CAMERA_BY_BEAT.action_environment, `S3 chair/desk env mid: ${cams[2]}`);
  assert(cams[3] === DRAMA_DEFAULT_CAMERA_BY_BEAT.dialogue, `S4 dialogue: ${cams[3]}`);
  assert(cams[4] === DRAMA_DEFAULT_CAMERA_BY_BEAT.screen, `S5 screen: ${cams[4]}`);
  assert(cams[5] === DRAMA_DEFAULT_CAMERA_BY_BEAT.action_environment, `S6 env: ${cams[5]}`);
  assert(cams.every((c) => c && !/大特写|贴脸/.test(c)), `禁止默认看脸: ${cams.join(' | ')}`);

  const zh = composeDramaShotLensTaggedPrompt(session, filled);
  const en = composeDramaShotH3EnglishPrompt(session, filled);
  assert(/@图片|剧情/.test(zh), `ZH 白话格式: ${zh}`);
  assert(/Medium-wide|screen insert|push-in onto the screen|Medium close-up|slow drift/i.test(en), `EN 须含镜头语言: ${en}`);
  assert(!/Extreme close-up|贴脸/i.test(en), `EN 不得默认贴脸大特写: ${en}`);
}

console.log('cameraLanguageDefaults.selftest: OK');
