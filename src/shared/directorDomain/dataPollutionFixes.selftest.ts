/**
 * 三处数据污染修复自检（不跑 H3）：
 * 1) 镜头动作链禁止串入站定/狼群中/视线屏幕/疑惑隐忧等 TE 脏字段
 * 2) 道具 Picture 禁止套用角色外貌/服装轮廓模板
 * 3) 专段弹幕不得注入未出镜 Subject（含场景 Subject）
 * 运行：npx tsx src/shared/directorDomain/dataPollutionFixes.selftest.ts
 */
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
const guest = createEmptyDramaCharacter({
  character_id: 'c-guest',
  name: '弹幕路人甲',
  imageUrl: 'https://example.com/guest.png',
});
const room = createEmptyDramaSceneAsset({
  scene_id: 'sc-room',
  name: '电竞直播间',
  imageUrl: 'https://example.com/room.png',
});
const chair = createEmptyDramaProp({
  prop_id: 'p-chair',
  name: '电竞椅',
  appearance: '黑红电竞椅，高背头枕，碳纤维纹理扶手',
  material: 'PU皮与金属支架',
  imageUrl: 'https://example.com/chair.png',
});

const session = createEmptyDramaSession({
  bible: {
    characters: [jiang, guest],
    scenes: [room],
    props: [chair],
    projectVisualBible: createEmptyDramaProjectVisualBible({
      presetName: '电竞',
      stylePrompt: 'cinematic',
      selected_at: Date.now(),
    }),
  },
});

// 1) 脏 TE 字段不得进入动作链
const polluted = createEmptyDramaShot({
  shot_no: '4',
  duration_sec: 6,
  character_ids: ['c-jiang'],
  scene_asset_id: 'sc-room',
  prop_ids: ['p-chair'],
  timeline_events: [
    createEmptyDramaTimelineEvent({
      start_sec: 0,
      end_sec: 6,
      character_ids: ['c-jiang'],
      visual_action: '站定',
      position: '狼群中',
      eyeline: '屏幕',
      character_state: '疑惑、隐忧',
      dialogue: '播啊，怎么不播。',
      dialogue_character_id: 'c-jiang',
    }),
  ],
});
const zhPolluted = composeDramaShotLensTaggedPrompt(session, polluted);
const enPolluted = composeDramaShotH3EnglishPrompt(session, polluted);
assert(!/狼群中/.test(zhPolluted + enPolluted), `不得串入狼群中: ${zhPolluted}`);
assert(!/站定/.test(zhPolluted), `占位站定不得进中文动作链: ${zhPolluted}`);
assert(!/视线\s*屏幕/.test(zhPolluted), `稀疏视觉不得串入视线屏幕: ${zhPolluted}`);
assert(!/疑惑/.test(zhPolluted) && !/隐忧/.test(zhPolluted), `稀疏视觉不得串入疑惑隐忧: ${zhPolluted}`);
assert(!/among\s+the\s+wolves|wolf\s+pack|puzzled|worried|eyeline\s+screen/i.test(enPolluted), `EN 不得译出脏字段: ${enPolluted}`);
assert(/播啊，怎么不播/.test(zhPolluted), `对白须保留: ${zhPolluted}`);

// 有真实动作时，情绪状态仍可保留（回归 confuse）
const grounded = createEmptyDramaShot({
  shot_no: '4b',
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
const enGrounded = composeDramaShotH3EnglishPrompt(session, grounded);
assert(/confused/.test(enGrounded), `真实动作下困惑须保留: ${enGrounded}`);

// 2) 道具 Picture 禁止角色外貌/服装模板
const propShot = createEmptyDramaShot({
  shot_no: '1',
  duration_sec: 6,
  character_ids: ['c-jiang'],
  scene_asset_id: 'sc-room',
  prop_ids: ['p-chair'],
  timeline_events: [
    createEmptyDramaTimelineEvent({
      start_sec: 0,
      end_sec: 6,
      character_ids: ['c-jiang'],
      visual_action: '江澈坐在电竞椅上',
    }),
  ],
});
const zhProp = composeDramaShotLensTaggedPrompt(session, propShot);
const enProp = composeDramaShotH3EnglishPrompt(session, propShot);
assert(/@图片\s*\d+\s*是电竞椅/.test(zhProp), `白话道具绑定须含电竞椅: ${zhProp}`);
assert(!/外貌与服装轮廓/.test(zhProp), `白话稿不得套用外貌与服装轮廓: ${zhProp}`);
assert(
  /prop appearance, materials, silhouette, and structure/i.test(enProp),
  `EN 道具保留须用 prop appearance/materials/structure: ${enProp.slice(enProp.indexOf('retention'), enProp.indexOf('retention') + 900)}`,
);
assert(
  !/<Picture\s+\d+>[^\n]*face, hair, costume/.test(
    [...enProp.matchAll(/<Picture\s+\d+>[^\n]+/g)]
      .map((m) => m[0])
      .find((l) => /prop appearance|face, hair, costume/i.test(l) && /prop|materials, silhouette/i.test(l)) || '',
  ),
  '道具 Picture EN 不得 face/hair/costume',
);
const enPicPropLine = [...enProp.matchAll(/<Picture\s+\d+>[^\n]+/g)].find((m) =>
  /prop appearance, materials/i.test(m[0]),
);
assert(enPicPropLine, `EN 须有道具 Picture 行: ${[...enProp.matchAll(/<Picture\s+\d+>[^\n]+/g)].map((m) => m[0]).join(' | ')}`);
assert(!/face, hair, costume/i.test(enPicPropLine![0]), `EN 道具行: ${enPicPropLine![0]}`);

// 3) 弹幕拍不得注入 Subject（含错误 character_ids / 场景 Subject）
const barrage = createEmptyDramaShot({
  shot_no: '5',
  duration_sec: 4,
  character_ids: ['c-jiang', 'c-guest'],
  scene_asset_id: 'sc-room',
  prop_ids: ['p-chair'],
  timeline_events: [
    createEmptyDramaTimelineEvent({
      start_sec: 0,
      end_sec: 4,
      // 脏数据：弹幕拍误绑角色
      character_ids: ['c-jiang', 'c-guest'],
      visual_action: '【弹幕浮字：澈神今天又杀疯了！／全能王名不虚传！】',
    }),
  ],
});
const zhBarrage = composeDramaShotLensTaggedPrompt(session, barrage);
const enBarrage = composeDramaShotH3EnglishPrompt(session, barrage);
assert(/澈神今天又杀疯了|屏幕弹幕浮字|on-screen live-stream comment overlay/i.test(zhBarrage + enBarrage), `弹幕须保留: ${zhBarrage}`);
assert(!/可见：/.test(zhBarrage) && !/Visible:/i.test(enBarrage), `弹幕专段不得 Visible 注入 Subject: ZH=${zhBarrage} EN=${enBarrage}`);

console.log('dataPollutionFixes.selftest: OK');
