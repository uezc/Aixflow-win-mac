/**
 * 剧本分批分析与结果合并。
 *
 * 当剧本原文过长（超出 LLM 单次输出 token 限制）时，自动按段落/场次拆分为多批，
 * 每批独立分析，最后合并 visual_events / scene_beats / characters / scenes / props / creatures。
 */

import type {
  DramaCharacter,
  DramaCreature,
  DramaDirectorSession,
  DramaProp,
  DramaSceneAsset,
  DramaSceneBeat,
} from './types.js';
import type { DramaVisualEvent } from './shotPlanning.js';
import { createEmptyDramaSession } from './factories.js';
import { getActiveEpisodeBible, attachEpisodeBibleAndPlan, createEmptyDramaEpisodeBible } from './episodeBible.js';

/** 单批最大字符数（去空白后）。留足 LLM 输出 JSON 的空间。 */
const DEFAULT_BATCH_MAX_CHARS = 2000;

/** 批次拆分结果 */
export interface DramaScriptBatch {
  index: number;
  text: string;
  /** 该批在原文中的大致起始位置（用于调试） */
  charOffset: number;
  /** 是否为最后一批 */
  isLast: boolean;
}

/**
 * 把剧本原文按段落/场次拆分为多批。
 * 优先按「第N场」「场景：」等场次标记拆，其次按空行段落拆。
 * 每批去空白后字符数不超过 maxChars。
 */
export function splitDramaScriptIntoBatches(
  sourceText: string,
  maxChars: number = DEFAULT_BATCH_MAX_CHARS,
): DramaScriptBatch[] {
  const text = String(sourceText || '').trim();
  if (!text) return [];

  const stripped = text.replace(/\s+/g, '');
  // 不超限 → 单批
  if (stripped.length <= maxChars) {
    return [{ index: 0, text, charOffset: 0, isLast: true }];
  }

  // 按场次标记或段落拆分成块
  const sceneMarkers = /第[一二三四五六七八九十\d]+场|场景\s*[:：]|^\s*场景\b|^\s*第[一二三四五六七八九十\d]+[场幕]/m;
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    const paraTrimmed = para.trim();
    if (!paraTrimmed) continue;

    // 如果是场次标记开头且当前块已有内容 → 新块
    if (sceneMarkers.test(paraTrimmed) && current) {
      chunks.push(current);
      current = paraTrimmed;
    } else {
      current = current ? `${current}\n\n${paraTrimmed}` : paraTrimmed;
    }

    // 当前块超限 → 截断到段落边界
    if (current.replace(/\s+/g, '').length > maxChars) {
      chunks.push(current);
      current = '';
    }
  }
  if (current) chunks.push(current);

  // 如果某个块仍然超限（长段落无场次标记），按句号硬切
  const finalChunks: string[] = [];
  for (const chunk of chunks) {
    if (chunk.replace(/\s+/g, '').length <= maxChars) {
      finalChunks.push(chunk);
      continue;
    }
    // 按句号拆
    const sentences = chunk.split(/(?<=[。！？\n])/);
    let buf = '';
    for (const s of sentences) {
      if ((buf + s).replace(/\s+/g, '').length > maxChars && buf) {
        finalChunks.push(buf);
        buf = s;
      } else {
        buf += s;
      }
    }
    if (buf) finalChunks.push(buf);
  }

  // 计算每批的 charOffset
  let offset = 0;
  return finalChunks.map((t, i) => {
    const batch: DramaScriptBatch = {
      index: i,
      text: t,
      charOffset: offset,
      isLast: i === finalChunks.length - 1,
    };
    offset += t.replace(/\s+/g, '').length;
    return batch;
  });
}

/**
 * 合并多批分析结果为一个完整 session。
 * - project / plot / relationships 取第一批（同集应一致）
 * - characters / scenes / props / creatures 按名去重合并
 * - scene_beats 在 session 级拼接并重新编号
 * - visual_events 在 episode_bible 级拼接并重新编号
 */
export function mergeDramaAnalyzeResults(
  sessions: DramaDirectorSession[],
): DramaDirectorSession {
  if (!sessions.length) return createEmptyDramaSession();
  if (sessions.length === 1) return sessions[0];

  const first = sessions[0];

  // 合并 characters（按 name 去重，保留首次出现的完整定义）
  const seenChars = new Set<string>();
  const characters: DramaCharacter[] = [];
  for (const s of sessions) {
    for (const c of s.bible.characters || []) {
      const key = String(c.name || '').trim();
      if (key && !seenChars.has(key)) {
        seenChars.add(key);
        characters.push(c);
      }
    }
  }

  // 合并 scenes（按 name 去重）
  const seenScenes = new Set<string>();
  const scenes: DramaSceneAsset[] = [];
  for (const s of sessions) {
    for (const sc of s.bible.scenes || []) {
      const key = String(sc.name || sc.location || '').trim();
      if (key && !seenScenes.has(key)) {
        seenScenes.add(key);
        scenes.push(sc);
      }
    }
  }

  // 合并 props（按 name 去重）
  const seenProps = new Set<string>();
  const props: DramaProp[] = [];
  for (const s of sessions) {
    for (const p of s.bible.props || []) {
      const key = String(p.name || '').trim();
      if (key && !seenProps.has(key)) {
        seenProps.add(key);
        props.push(p);
      }
    }
  }

  // 合并 creatures（按 name 去重）
  const seenCreatures = new Set<string>();
  const creatures: DramaCreature[] = [];
  for (const s of sessions) {
    for (const cr of s.bible.creatures || []) {
      const key = String(cr.name || '').trim();
      if (key && !seenCreatures.has(key)) {
        seenCreatures.add(key);
        creatures.push(cr);
      }
    }
  }

  // 合并 scene_beats（session 级，拼接并重新编号 scene_no）
  const sceneBeats: DramaSceneBeat[] = [];
  let sceneNo = 1;
  for (const s of sessions) {
    for (const beat of s.scene_beats || []) {
      sceneBeats.push({
        ...beat,
        scene_no: String(sceneNo++),
      });
    }
  }

  // 合并 visual_events（episode bible 级，拼接并重新编号 id 和 index）
  const visualEvents: DramaVisualEvent[] = [];
  let evIndex = 1;
  for (const s of sessions) {
    const epBible = getActiveEpisodeBible(s);
    for (const ev of epBible.visual_events || []) {
      const evId = `EV${String(evIndex).padStart(3, '0')}`;
      visualEvents.push({
        ...ev,
        index: evIndex,
        event_id: evId,
      });
      evIndex++;
    }
  }

  // 合并 plot / relationships（拼接）
  const plotParts: string[] = [];
  const relParts: string[] = [];
  for (const s of sessions) {
    const p = String(s.bible.plot || '').trim();
    if (p) plotParts.push(p);
    const r = String(s.bible.relationships || '').trim();
    if (r) relParts.push(r);
  }

  const merged = createEmptyDramaSession({
    ...first,
    bible: {
      ...first.bible,
      plot: plotParts.join('\n\n'),
      relationships: relParts.join('\n\n'),
      characters,
      scenes,
      props,
      creatures,
    },
    scene_beats: sceneBeats,
    shots: [],
  });

  // 把合并后的 visual_events 写入 active episode bible
  const epId = String(first.active_episode_id || '').trim();
  if (epId) {
    const prevEpBible = first.episode_bibles?.[epId];
    const epBible = createEmptyDramaEpisodeBible({
      ...(prevEpBible || getActiveEpisodeBible(first)),
      visual_events: visualEvents,
    });
    const prevPlan = merged.production_plans?.[epId];
    return attachEpisodeBibleAndPlan(
      merged,
      epBible,
      prevPlan || { episode_id: epId, items: [], updated_at: Date.now() },
      epId,
    );
  }

  return merged;
}
