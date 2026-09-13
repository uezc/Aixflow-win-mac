/**
 * 分场去噪 + 短镜凑档
 * 运行：npx tsx src/shared/directorDomain/scriptNoiseAndCoalesce.selftest.ts
 */
import assert from 'node:assert/strict';
import {
  analyzeDramaEpisodeOriginal,
  coalesceAdjacentShortDurationShots,
  isDramaScriptMetaNoiseLine,
} from './originalScript.js';
import { createEmptyDramaShotSuggestion } from './episodeBible.js';

assert.equal(isDramaScriptMetaNoiseLine('标题：**《木棍天仙》**'), true);
assert.equal(isDramaScriptMetaNoiseLine('---'), true);
assert.equal(isDramaScriptMetaNoiseLine('作者：张三'), true);
assert.equal(isDramaScriptMetaNoiseLine('《木棍天仙》'), true);
assert.equal(isDramaScriptMetaNoiseLine('第1集'), true);
assert.equal(isDramaScriptMetaNoiseLine('（林凡推门而入。）'), false);
assert.equal(isDramaScriptMetaNoiseLine('**林凡**：来了。'), false);

const source = `标题：**《木棍天仙》**

---

作者：测试

**场景一：天庭金殿**

（布衣男主林凡手持木棍。）

**林凡**（怒）：玉皇！
`;

const analysis = analyzeDramaEpisodeOriginal({
  source,
  episodeId: 'ep1',
  characters: [],
  scenes: [],
  voices: [],
});

const texts = (analysis.original_segments || []).map((s) => s.original_text);
assert.ok(
  !texts.some((t) => /标题|作者|^---$|《木棍天仙》/.test(String(t || '').trim())),
  `标题等不应进片段: ${JSON.stringify(texts)}`,
);
assert.ok(
  texts.some((t) => /林凡|木棍|玉皇/.test(t)),
  `正文应保留: ${JSON.stringify(texts)}`,
);
assert.ok(
  !(analysis.original_scenes || []).some((s) => s.location === '开场' && !(s.original_heading || '').trim()),
  '不应因标题多造空「开场」场',
);

const pair1010 = coalesceAdjacentShortDurationShots([
  createEmptyDramaShotSuggestion({
    suggestion_id: 'a',
    scene: '天庭金殿',
    shot: '01',
    duration_sec: 10,
    action: 'A',
  }),
  createEmptyDramaShotSuggestion({
    suggestion_id: 'b',
    scene: '天庭金殿',
    shot: '02',
    duration_sec: 10,
    action: 'B',
  }),
]);
assert.equal(pair1010.length, 1, '10+10 应合并为 1 镜');
assert.equal(pair1010[0].duration_sec, 20, '10+10 → 20');

const pair610 = coalesceAdjacentShortDurationShots([
  createEmptyDramaShotSuggestion({
    suggestion_id: 'a',
    scene: '天庭金殿',
    shot: '01',
    duration_sec: 6,
    action: 'A',
  }),
  createEmptyDramaShotSuggestion({
    suggestion_id: 'b',
    scene: '天庭金殿',
    shot: '02',
    duration_sec: 10,
    action: 'B',
  }),
]);
assert.equal(pair610.length, 1);
assert.equal(pair610[0].duration_sec, 15, '6+10 → 15');

const pair66 = coalesceAdjacentShortDurationShots([
  createEmptyDramaShotSuggestion({
    suggestion_id: 'a',
    scene: '天庭金殿',
    shot: '01',
    duration_sec: 6,
    action: 'A',
  }),
  createEmptyDramaShotSuggestion({
    suggestion_id: 'b',
    scene: '天庭金殿',
    shot: '02',
    duration_sec: 6,
    action: 'B',
  }),
]);
assert.equal(pair66.length, 1);
assert.equal(pair66[0].duration_sec, 10, '6+6 → 10');

const crossScene = coalesceAdjacentShortDurationShots([
  createEmptyDramaShotSuggestion({
    suggestion_id: 'a',
    scene: '天庭金殿',
    shot: '01',
    duration_sec: 10,
    action: 'A',
  }),
  createEmptyDramaShotSuggestion({
    suggestion_id: 'b',
    scene: '裂缝前',
    shot: '02',
    duration_sec: 10,
    action: 'B',
  }),
]);
assert.equal(crossScene.length, 2, '跨场不合并');

console.log('scriptNoiseAndCoalesce.selftest: OK');
