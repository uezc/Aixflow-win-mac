/**
 * Markdown 剧本 **姓名**（情绪）： 抽人
 * 运行：npx tsx src/shared/directorDomain/markdownCastExtract.selftest.ts
 */
import assert from 'node:assert/strict';
import { extractCharacterNamesFromScriptText } from './extractCastFromScript.js';
import { analyzeDramaEpisodeOriginal, parseDramaSceneHeadingLine } from './originalScript.js';
import { ensureAppearingCharactersInBible } from './ensureAppearingCharacters.js';
import { createEmptyDramaSession } from './factories.js';
import { createEmptyDramaEpisodeBible } from './episodeBible.js';

const source = `标题：**《木棍天仙》**

---

**场景一：天庭金殿**

（布衣男主“林凡”手持一根破旧木棍，破开天庭大门，昂首踏入金殿。天庭众仙惊愕，玉皇大帝冷眼扫视。）

**林凡**（怒目而视）：玉皇！今日，我带着这根木棍，来讨一个公道！

**玉皇大帝**（冷笑）：一个凡人，手持腐朽木棍，也敢闯我天庭？公道？你配吗？

**林凡**（坚定）：十年前，你以天庭之名灭我师尊，毁我宗门，只因我们不愿屈服！

**天庭战神**（喝道）：狂妄凡人，让我来教你天庭的规矩！

**战神**（喘气，震惊）：这是什么妖棍？

**林凡**（冷笑）：上古神器“天木棍”。

**玉皇大帝**（沉声）：大胆！诸仙听令，围剿此子！

**林凡**（怒喝）：来吧！

---

**场景二：天庭裂缝前**

**玉皇大帝**（愤怒）：凡人，敢如此挑衅天庭！

**林凡**（冷笑）：天庭之威，不过虚伪假象！

**玉皇大帝**（大吼）：你……究竟是何人？

**林凡**（冷冷一笑）：我是凡人，但也是你们的劫难！
`;

assert.ok(parseDramaSceneHeadingLine('**场景一：天庭金殿**'), '场景一行应识别');
assert.equal(parseDramaSceneHeadingLine('**场景一：天庭金殿**')?.location, '天庭金殿');

const names = extractCharacterNamesFromScriptText(source);
console.log('extract:', names);
assert.ok(names.includes('林凡'), `extract 林凡: ${names.join(',')}`);
assert.ok(names.includes('玉皇大帝'), `extract 玉皇大帝: ${names.join(',')}`);

const analysis = analyzeDramaEpisodeOriginal({
  source,
  episodeId: 'ep1',
  characters: [],
  scenes: [],
  voices: [],
});
const speakers = [
  ...new Set((analysis.original_segments || []).map((s) => s.character_name).filter(Boolean)),
];
console.log('seg speakers:', speakers);
console.log(
  'bindings:',
  (analysis.character_bindings || []).map((b) => `${b.original_name}:${b.speaker_type || b.tier || ''}`),
);
assert.ok(speakers.includes('林凡'), `seg 林凡: ${speakers.join(',')}`);
assert.ok(speakers.includes('玉皇大帝'), `seg 玉皇: ${speakers.join(',')}`);

let session = createEmptyDramaSession({
  active_episode_id: 'ep1',
  episodes: [
    {
      episode_id: 'ep1',
      episode_no: 1,
      title: '1',
      text: source,
      analyzed: false,
      updated_at: 1,
    },
  ],
  episode_bibles: {
    ep1: createEmptyDramaEpisodeBible({
      episode_id: 'ep1',
      original_segments: analysis.original_segments,
      original_scenes: analysis.original_scenes,
      character_bindings: analysis.character_bindings,
      shot_suggestions: analysis.shot_suggestions,
      scene_split_at: Date.now(),
    }),
  },
});
session = ensureAppearingCharactersInBible(session);
const bibleNames = session.bible.characters.map((c) => c.name);
console.log('bible chars:', bibleNames);
assert.ok(bibleNames.some((n) => n === '林凡'), `bible 林凡: ${bibleNames.join(',')}`);
assert.ok(bibleNames.some((n) => /玉皇/.test(n)), `bible 玉皇: ${bibleNames.join(',')}`);

console.log('markdownCastExtract.selftest: OK');
