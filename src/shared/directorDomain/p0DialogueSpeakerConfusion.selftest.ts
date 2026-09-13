/**
 * P0：人物台词混淆 — who SoT / Subject·SpeakId 对齐 / <d> 纯对白 / GAZE·C4。
 * 运行：npx tsx src/shared/directorDomain/p0DialogueSpeakerConfusion.selftest.ts
 */
import { composeDramaShotH3EnglishPrompt } from './composeDramaShotLensPrompt.js';
import { createEmptyDramaEpisodeBible } from './episodeBible.js';
import {
  createEmptyDramaCharacter,
  createEmptyDramaSceneAsset,
  createEmptyDramaSession,
  createEmptyDramaShot,
} from './factories.js';
import { createEmptyDramaVisualEvent } from './shotPlanning.js';
import {
  buildTimelineEventsFromVisualEvents,
  createEmptyDramaTimelineEvent,
  ensureDramaShotTimelineEvents,
} from './timelineEvent.js';
import { createEmptyDramaProjectVisualBible } from './visualDna.js';
import type { DramaOriginalSegment } from './types.js';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function dBodies(text: string): string[] {
  return [...String(text || '').matchAll(/<d>\s*\[Chinese[^\]]*\]\s*([\s\S]*?)<\/d>/gi)].map((m) =>
    String(m[1] || '').trim(),
  );
}

const boy = createEmptyDramaCharacter({
  character_id: 'c-boy',
  name: '少年',
  imageUrl: 'https://example.com/boy.png',
});
const jiang = createEmptyDramaCharacter({
  character_id: 'c-jiang',
  name: '江澈',
  imageUrl: 'https://example.com/jiang.png',
});
const elder = createEmptyDramaCharacter({
  character_id: 'c-elder',
  name: '执事长老',
  imageUrl: 'https://example.com/elder.png',
});
const hall = createEmptyDramaSceneAsset({
  scene_id: 'sc-hall',
  name: '灵根殿',
  imageUrl: 'https://example.com/hall.png',
});

// ---------- 1) Dialogue who 为唯一 SoT：segment.character_id 不得覆盖 ----------
const wrongSeg: DramaOriginalSegment = {
  segment_id: 'seg-wrong',
  episode_id: 'ep-gaze',
  scene_id: 'sc-hall',
  scene_no: '1',
  order: 1,
  original_text: '少年\n“你为什么不说话？”',
  type: 'dialogue',
  character_name: '少年',
  // 故意绑错：segment 指向江澈
  character_id: 'c-jiang',
};
const veDlg = createEmptyDramaVisualEvent({
  event_id: 've-dlg-boy',
  index: 1,
  kind: 'dialogue',
  who: '少年',
  action: '你为什么不说话？',
  original_text: '少年\n“你为什么不说话？”',
  source_segment_ids: ['seg-wrong'],
});
const whoSotSession = createEmptyDramaSession({
  active_episode_id: 'ep-gaze',
  bible: {
    characters: [boy, jiang, elder],
    scenes: [hall],
    projectVisualBible: createEmptyDramaProjectVisualBible({
      presetName: '仙侠',
      stylePrompt: 'cinematic',
      selected_at: Date.now(),
    }),
  },
  episode_bibles: {
    'ep-gaze': createEmptyDramaEpisodeBible({
      episode_id: 'ep-gaze',
      original_segments: [wrongSeg],
      visual_events: [veDlg],
    }),
  },
  shots: [
    createEmptyDramaShot({
      shot_no: '01',
      duration_sec: 4,
      character_ids: ['c-boy', 'c-jiang', 'c-elder'],
      scene_asset_id: 'sc-hall',
      visual_event_ids: ['ve-dlg-boy'],
    }),
  ],
});
const whoShot = ensureDramaShotTimelineEvents(whoSotSession.shots[0], whoSotSession);
const whoTes = buildTimelineEventsFromVisualEvents(whoSotSession, whoShot);
assert(whoTes.length >= 1, `who SoT TE 应生成: ${JSON.stringify(whoTes)}`);
const whoDlg = whoTes.find((e) => /不说话/.test(String(e.dialogue || '')));
assert(whoDlg, `who SoT 对白 TE: ${JSON.stringify(whoTes)}`);
assert(
  whoDlg.dialogue_character_id === 'c-boy',
  `who SoT 必须是少年/c-boy，不得被 segment.c-jiang 覆盖，实际=${whoDlg.dialogue_character_id}`,
);
assert(!/江澈|执事长老|少年/.test(String(whoDlg.dialogue || '')), `TE.dialogue 须纯正文: ${whoDlg.dialogue}`);

// ---------- 2) GAZE / C4 多人物：Subject↔SpeakId 对齐、<d> 纯、<d> 归属 ----------
const gazeShot = createEmptyDramaShot({
  shot_no: '01',
  duration_sec: 6.6,
  character_ids: ['c-boy', 'c-jiang', 'c-elder'],
  scene_asset_id: 'sc-hall',
  action:
    '青衫少年看向江澈。\n\n少年：\n“你为什么不说话？”\n\n江澈没有回答，转头看向执事长老。\n\n执事长老：\n“开始吧。”',
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
const gazeSession = createEmptyDramaSession({
  bible: {
    characters: [boy, jiang, elder],
    scenes: [hall],
    projectVisualBible: createEmptyDramaProjectVisualBible({
      presetName: '仙侠',
      stylePrompt: 'cinematic short drama, low saturation',
      selected_at: Date.now(),
    }),
  },
});
const gazeEn = composeDramaShotH3EnglishPrompt(gazeSession, gazeShot);
const bodies = dBodies(gazeEn);
assert(bodies.some((b) => b.includes('你为什么不说话')), `少年台词进 <d>: ${JSON.stringify(bodies)}`);
assert(bodies.some((b) => b === '开始吧。' || b.includes('开始吧')), `长老台词进 <d>: ${JSON.stringify(bodies)}`);
for (const b of bodies) {
  assert(!/少年|江澈|执事长老/.test(b) || /你为什么不说话|开始吧/.test(b), `<d> 不得混入他人名作说话人标签: ${b}`);
  // 称呼可以出现在正文；禁止「人名：」说话人前缀
  assert(!/^(?:少年|江澈|执事长老)\s*[：:]/m.test(b), `<d> 不得含说话人冒号前缀: ${b}`);
  assert(!/[（(][^）)]{0,12}[）)]/.test(b), `<d> 不得含括注: ${b}`);
}

// Subject N (SN) 对齐：禁止 Subject 3 (S2)
assert(/<Subject 1>\s*\(S1\)/.test(gazeEn), `Subject1 须 (S1):\n${gazeEn}`);
assert(/<Subject 3>\s*\(S3\)/.test(gazeEn), `Subject3 须 (S3) 而非 (S2):\n${gazeEn}`);
assert(!/<Subject 3>\s*\(S2\)/.test(gazeEn), `禁止 Subject3(S2) 错位:\n${gazeEn}`);

// 少年台词块：开口人必须是 Subject 1（只在 detailed_description 后匹配，避开 retention 的 [Shot N] 列表）
const detailed = gazeEn.split(/detailed_description\s*:/i)[1] || '';
const shot2 = detailed.match(/\[Shot 2\][\s\S]*?(?=\[Shot 3\]|$)/)?.[0] || '';
assert(/你为什么不说话/.test(shot2), `Shot2 含少年台词: ${shot2}`);
assert(
  /<Subject 1>\s*\(S1\)[\s\S]*parts the lips and says:\s*<d>\[Chinese\]你为什么不说话/.test(shot2),
  `Shot2 须 Subject1 开口: ${shot2}`,
);
assert(/Other visible Subjects keep mouths closed/i.test(shot2), `Shot2 须强制其余闭嘴: ${shot2}`);
assert(!/<Subject 2>\s*\(S\d+\)[\s\S]*parts the lips and says:[\s\S]*你为什么不说话/.test(shot2), `Shot2 不得 Subject2 抢少年台词: ${shot2}`);
assert(!/continues the on-screen action/i.test(shot2), `对白镜不得错误 continues 填充: ${shot2}`);

const shot4 = detailed.match(/\[Shot 4\][\s\S]*?(?=overall_soundscape|$)/)?.[0] || '';
assert(
  /<Subject 3>\s*\(S3\)[\s\S]*parts the lips and says:\s*<d>\[Chinese\]开始吧/.test(shot4),
  `Shot4 须 Subject3(S3) 说开始吧: ${shot4}`,
);
assert(!/<Subject 3>\s*\(S2\)/.test(shot4), `Shot4 禁止 Subject3(S2): ${shot4}`);
assert(/Other visible Subjects keep mouths closed/i.test(shot4), `Shot4 须强制其余闭嘴: ${shot4}`);

// 人物参考图白底不得带进成片
assert(
  /Never inherit their white, blank, or studio backdrop/i.test(gazeEn) ||
    /discard any white, blank, or studio backdrop/i.test(gazeEn),
  `须禁止人物图白底渗入成片:\n${gazeEn}`,
);
assert(
  /only the current speaker Subject opens the mouth/i.test(gazeEn),
  `须含说话人切换隔离规则:\n${gazeEn}`,
);

// Picture：有图时角色不得锁到场景 Picture 1；无独立角色图时可为 NONE（不强制错绑场景）
assert(
  !/<Subject [123]> is the character referenced by <Picture 1>/.test(gazeEn) ||
    !/<Picture 1> is the environment/.test(gazeEn),
  `角色不得把场景 Picture 1 当外貌锁（若 Picture1 为环境）:\n${gazeEn}`,
);

console.log('p0DialogueSpeakerConfusion.selftest: OK');
