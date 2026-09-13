/**
 * Snapshot drama prompt before/after dedupe — local only, no H3.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  composeDramaShotH3EnglishPrompt,
  composeDramaShotLensTaggedPrompt,
} from '../src/shared/directorDomain/composeDramaShotLensPrompt.ts';
import {
  createEmptyDramaCharacter,
  createEmptyDramaSceneAsset,
  createEmptyDramaSession,
  createEmptyDramaShot,
} from '../src/shared/directorDomain/factories.ts';
import { createEmptyDramaProjectVisualBible } from '../src/shared/directorDomain/visualDna.ts';
import { createEmptyDramaTimelineEvent } from '../src/shared/directorDomain/timelineEvent.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '../audit-reports/prompt-dedupe-2026-09-11');
const label = process.argv[2] === 'after' ? 'after' : 'before';

const char = createEmptyDramaCharacter({
  character_id: 'c-jiang',
  name: '江澈',
  imageUrl: 'https://example.com/jiang.png',
});
const scene = createEmptyDramaSceneAsset({
  scene_id: 'sc-room',
  name: '电竞直播间',
  imageUrl: 'https://example.com/room.png',
});
const session = createEmptyDramaSession({
  bible: {
    characters: [char],
    scenes: [scene],
    projectVisualBible: createEmptyDramaProjectVisualBible({
      presetName: '电影质感夜戏',
      stylePrompt: 'cinematic film look, low saturation, strong contrast',
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

const en = composeDramaShotH3EnglishPrompt(session, shot);
const zh = composeDramaShotLensTaggedPrompt(session, shot);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${label}-en.txt`), en, 'utf8');
fs.writeFileSync(path.join(outDir, `${label}-zh.txt`), zh, 'utf8');
console.log(
  JSON.stringify(
    {
      label,
      en_chars: en.length,
      zh_chars: zh.length,
      en_lines: en.split(/\n/).length,
      zh_lines: zh.split(/\n/).length,
      outDir,
    },
    null,
    2,
  ),
);
