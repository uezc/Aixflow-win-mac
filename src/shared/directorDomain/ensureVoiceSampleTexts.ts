/**
 * 为每个声音卡补齐 sample_text（音色描写 + 可念台词）。
 * 旧数据只有台词、没有「音色：」段的会升级；已结构化的不改写。
 */

import type { DramaDirectorSession, DramaVoice } from './types.js';
import {
  composeDramaVoiceSampleLine,
  isDramaVoiceSampleTextRichEnough,
} from './characterDesignPrompt.js';

function normName(s: string): string {
  return String(s || '')
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase();
}

function collectDialogueMaps(session: DramaDirectorSession): {
  byId: Map<string, string>;
  byName: Map<string, string>;
} {
  const byIdLines = new Map<string, string[]>();
  const byNameLines = new Map<string, string[]>();
  for (const shot of session.shots || []) {
    for (const line of shot.dialogue || []) {
      const text = String(line.text || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length < 2) continue;
      const cid = String(line.character_id || '').trim();
      const cname = String(line.character_name || '').trim();
      if (cid) {
        const arr = byIdLines.get(cid) || [];
        if (!arr.includes(text)) arr.push(text);
        byIdLines.set(cid, arr);
      }
      if (cname) {
        const key = normName(cname);
        const arr = byNameLines.get(key) || [];
        if (!arr.includes(text)) arr.push(text);
        byNameLines.set(key, arr);
      }
    }
  }
  const join = (arr: string[]) => arr.slice(0, 3).join('\n');
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const [k, arr] of byIdLines) byId.set(k, join(arr));
  for (const [k, arr] of byNameLines) byName.set(k, join(arr));
  return { byId, byName };
}

function dialogueHintForVoice(
  session: DramaDirectorSession,
  voice: DramaVoice,
  byId: Map<string, string>,
  byName: Map<string, string>,
): string {
  const cid = String(voice.character_id || '').trim();
  if (cid && byId.has(cid)) return byId.get(cid) || '';
  const ch = (session.bible.characters || []).find((c) => c.character_id === cid);
  const name = String(ch?.name || '').trim();
  if (name && byName.has(normName(name))) return byName.get(normName(name)) || '';
  return '';
}

/**
 * 已是新结构（名字/年龄/性别 + 音色描述 + 台词）的不改写；旧生硬结构会升级。
 */
export function ensureVoiceSampleTexts(session: DramaDirectorSession): DramaDirectorSession {
  const { byId, byName } = collectDialogueMaps(session);

  let changed = false;
  const voices = (session.bible.voices || []).map((v) => {
    const existing = String(v.sample_text || '').trim();
    if (existing && isDramaVoiceSampleTextRichEnough(existing)) return v;
    const ch = (session.bible.characters || []).find((c) => c.character_id === v.character_id);
    const fromScript = dialogueHintForVoice(session, v, byId, byName);
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
      // 升级旧稿时优先用剧本对白；没有再从旧提示词里抽台词段
      dialogueHint: fromScript || existing,
    });
    if (sample_text === existing) return v;
    changed = true;
    return { ...v, sample_text };
  });

  if (!changed) return session;
  // 热路径：只补声音稿，禁止整会话迁移
  return {
    ...session,
    bible: {
      ...session.bible,
      voices,
    },
  };
}
