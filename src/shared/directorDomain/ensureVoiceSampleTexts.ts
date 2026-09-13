/**
 * 为每个声音卡补齐 sample_text（音色描写 + 可念台词）。
 * 台词只允许来自剧本/小说原文；有原文时强制覆盖乱编台词。
 */

import type { DramaDirectorSession, DramaVoice } from './types.js';
import {
  composeDramaVoiceSampleLine,
  extractDramaVoiceSpokenText,
  isDramaVoiceSampleTextRichEnough,
  stripDramaSpokenLineBody,
} from './characterDesignPrompt.js';
import { namesLikelySameDramaPerson } from './extractCastFromScript.js';
import { composeDramaSystemVoiceSampleText, isDramaSystemVoiceId } from './voiceEntity.js';

function normName(s: string): string {
  return String(s || '')
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase();
}

function pushLine(map: Map<string, string[]>, key: string, text: string) {
  const k = String(key || '').trim();
  const t = stripDramaSpokenLineBody(text);
  if (!k || t.length < 2) return;
  const arr = map.get(k) || [];
  if (!arr.includes(t)) arr.push(t);
  map.set(k, arr);
}

/**
 * 从原文片段 + 分镜对白收集角色可念台词（1～3 句）。
 */
export function collectDramaCharacterScriptLines(
  session: DramaDirectorSession,
  opts: { characterId?: string; characterName?: string },
): string {
  const cid = String(opts.characterId || '').trim();
  const cname = String(opts.characterName || '').trim();
  const byIdLines = new Map<string, string[]>();
  const byNameLines = new Map<string, string[]>();
  const nameKeys: string[] = [];

  const epId = String(session.active_episode_id || '').trim();
  const segs = session.episode_bibles?.[epId]?.original_segments || [];
  for (const seg of segs) {
    if (seg.type !== 'dialogue' && seg.type !== 'system') continue;
    const name = String(seg.character_name || '').trim();
    const text = String(seg.original_text || '').trim();
    if (!text) continue;
    if (name) {
      const key = normName(name);
      pushLine(byNameLines, key, text);
      if (!nameKeys.includes(name)) nameKeys.push(name);
    }
  }

  for (const shot of session.shots || []) {
    for (const line of shot.dialogue || []) {
      const text = String(line.text || '').trim();
      if (!text) continue;
      const id = String(line.character_id || '').trim();
      const name = String(line.character_name || '').trim();
      if (id) pushLine(byIdLines, id, text);
      if (name) {
        const key = normName(name);
        pushLine(byNameLines, key, text);
        if (!nameKeys.includes(name)) nameKeys.push(name);
      }
    }
  }

  const join = (arr: string[] | undefined) => (arr || []).slice(0, 3).join('\n');
  if (cid && byIdLines.has(cid)) return join(byIdLines.get(cid));
  if (cname) {
    const exact = byNameLines.get(normName(cname));
    if (exact?.length) return join(exact);
    for (const n of nameKeys) {
      if (namesLikelySameDramaPerson(n, cname)) {
        return join(byNameLines.get(normName(n)));
      }
    }
  }
  return '';
}

function dialogueHintForVoice(session: DramaDirectorSession, voice: DramaVoice): string {
  const cid = String(voice.character_id || '').trim();
  const ch = (session.bible.characters || []).find((c) => c.character_id === cid);
  return collectDramaCharacterScriptLines(session, {
    characterId: cid,
    characterName: ch?.name,
  });
}

function spokenLooksLikeScript(spoken: string, scriptLines: string): boolean {
  const spokenNorm = stripDramaSpokenLineBody(spoken).replace(/\s+/g, '');
  if (!spokenNorm || !scriptLines) return false;
  for (const line of scriptLines.split(/\n+/)) {
    const body = stripDramaSpokenLineBody(line).replace(/\s+/g, '');
    if (body.length >= 4 && (spokenNorm.includes(body.slice(0, 8)) || body.includes(spokenNorm.slice(0, 8)))) {
      return true;
    }
  }
  return false;
}

/**
 * 已是新结构且台词已对齐剧本原文则不改；否则用剧本台词重写。
 */
export function ensureVoiceSampleTexts(session: DramaDirectorSession): DramaDirectorSession {
  let changed = false;
  const voices = (session.bible.voices || []).map((v) => {
    const existing = String(v.sample_text || '').trim();
    if (isDramaSystemVoiceId(v.character_id)) {
      const sample_text = composeDramaSystemVoiceSampleText(existing);
      if (sample_text === existing) return v;
      changed = true;
      return { ...v, sample_text };
    }
    const ch = (session.bible.characters || []).find((c) => c.character_id === v.character_id);
    const fromScript = dialogueHintForVoice(session, v);
    const spoken = extractDramaVoiceSpokenText(existing);
    const alreadyAligned = fromScript && spokenLooksLikeScript(spoken, fromScript);
    if (existing && isDramaVoiceSampleTextRichEnough(existing) && (!fromScript || alreadyAligned)) {
      return v;
    }
    const sample_text = composeDramaVoiceSampleLine({
      name: ch?.name,
      age: ch?.age,
      role: ch?.role,
      identity: ch?.identity,
      personality: ch?.personality,
      gender: ch?.gender,
      timbre: v.timbre,
      voiceStyle: v.voiceStyle,
      language_style: v.language_style,
      emotion_range: v.emotion_range,
      dialogueHint: fromScript || existing,
      forceScriptLines: Boolean(fromScript),
    });
    if (sample_text === existing) return v;
    changed = true;
    return { ...v, sample_text };
  });

  if (!changed) return session;
  return {
    ...session,
    bible: {
      ...session.bible,
      voices,
    },
  };
}
