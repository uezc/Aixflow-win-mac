/**
 * 非空镜必须有出场人物 + 人物参考图，且提示词须点名出演者。
 * 仅当镜头被明确标成空镜/无人物时，才允许无角色。
 */

import { characterHasUsableReference, resolveCharacterMasterReferenceUrl } from './constraints.js';
import { resolveDramaCharacterIdByName } from './ensureAppearingCharacters.js';
import type { DramaDirectorSession, DramaShot } from './types.js';

const EMPTY_SHOT_RE = /空镜|无人物|无人出场|无人镜|纯空镜|environment.?only|empty.?shot/i;

/** 是否被明确标成空镜（未标明则一律视为有人镜） */
export function isDramaShotExplicitEmptyShot(shot: {
  action?: string;
  purpose?: string;
  dramatic_purpose?: string;
  visual_focus?: string;
  continuity_notes?: string;
  model_params?: Record<string, string> | null;
  character_ids?: string[];
  dialogue?: { text?: string }[];
}): boolean {
  const flag = String(
    shot.model_params?.empty_shot || shot.model_params?.emptyShot || '',
  )
    .trim()
    .toLowerCase();
  if (flag === '1' || flag === 'true' || flag === 'yes') return true;
  const blob = [
    shot.action,
    shot.purpose,
    shot.dramatic_purpose,
    shot.visual_focus,
    shot.continuity_notes,
  ]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .join('\n');
  if (EMPTY_SHOT_RE.test(blob)) return true;
  return false;
}

export function dramaShotRequiresCast(shot: Parameters<typeof isDramaShotExplicitEmptyShot>[0]): boolean {
  return !isDramaShotExplicitEmptyShot(shot);
}

export type DramaShotCastGateIssue = {
  code: 'missing_cast' | 'missing_char_image' | 'unnamed_cast' | 'missing_char_asset';
  message: string;
};

function shotCastTextBlob(shot: Pick<
  DramaShot,
  | 'action'
  | 'blocking'
  | 'dialogue'
  | 'timeline_events'
  | 'h3_skill_prompt'
  | 'last_compiled_prompt'
  | 'final_prompt'
>): string {
  const evText = (shot.timeline_events || [])
    .map((ev) => [ev.visual_action, ev.character_state, ev.dialogue].filter(Boolean).join(' '))
    .join('\n');
  return [
    shot.action,
    shot.blocking,
    evText,
    shot.h3_skill_prompt,
    shot.last_compiled_prompt,
    shot.final_prompt,
    ...(shot.dialogue || []).map((d) => `${d.character_name || ''} ${d.text || ''}`),
  ]
    .map((x) => String(x || ''))
    .join('\n');
}

/**
 * 有效出演 id：镜级绑定 ∪ 时间轴出场 ∪ 文案点名（与参考图推送一致，避免「左边有人、门禁判空」）。
 */
export function resolveEffectiveDramaShotCharacterIds(
  session: DramaDirectorSession,
  shot: DramaShot,
): string[] {
  const byId = new Map((session.bible.characters || []).map((c) => [c.character_id, c]));
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: string) => {
    const id = String(raw || '').trim();
    if (!id || seen.has(id) || !byId.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  for (const id of shot.character_ids || []) add(id);
  for (const ev of shot.timeline_events || []) {
    for (const id of ev.character_ids || []) add(id);
  }
  for (const line of shot.dialogue || []) {
    if (line.character_id) add(line.character_id);
    else if (line.character_name) add(resolveDramaCharacterIdByName(session.bible.characters || [], line.character_name));
  }
  // 分镜建议 cast_names（分析/分镜表里已有，常带 C-01 前缀）
  const epId = session.active_episode_id;
  const sug =
    (session.episode_bibles?.[epId]?.shot_suggestions || []).find(
      (s) => String(s.shot || '').trim() === String(shot.shot_no || '').trim(),
    ) || null;
  for (const n of sug?.cast_names || []) {
    add(resolveDramaCharacterIdByName(session.bible.characters || [], n));
  }
  // 手动加人/优化提示词后：文案已写姓名，但 character_ids 漏绑
  const blob = shotCastTextBlob(shot);
  if (blob.trim()) {
    const ranked = [...(session.bible.characters || [])]
      .map((c) => ({ id: c.character_id, name: String(c.name || '').trim() }))
      .filter((x) => x.name.length >= 2)
      .sort((a, b) => b.name.length - a.name.length);
    for (const { id, name } of ranked) {
      if (blob.includes(name)) add(id);
    }
  }
  return out;
}

/** 把有效出演写回镜级 character_ids（漏绑自愈，不删用户已绑） */
export function syncDramaShotCharacterIds(
  session: DramaDirectorSession,
  shot: DramaShot,
): DramaShot {
  const effective = resolveEffectiveDramaShotCharacterIds(session, shot);
  const cur = [...new Set((shot.character_ids || []).map(String).filter(Boolean))];
  if (!effective.length) return shot;
  if (cur.length === effective.length && cur.every((id, i) => id === effective[i])) return shot;
  const merged = [...new Set([...cur, ...effective])];
  if (merged.length === cur.length && merged.every((id) => cur.includes(id))) return shot;
  return { ...shot, character_ids: merged };
}

/** 本镜出演角色显示名（按有效出演顺序） */
export function listDramaShotCastDisplayNames(
  session: DramaDirectorSession,
  shot: Pick<DramaShot, 'character_ids' | 'dialogue' | 'timeline_events'> & Partial<DramaShot>,
): string[] {
  const byId = new Map((session.bible.characters || []).map((c) => [c.character_id, c]));
  const names: string[] = [];
  const seen = new Set<string>();
  const pushName = (raw: string) => {
    const n = String(raw || '').trim();
    if (!n || n === '出场人物' || seen.has(n)) return;
    seen.add(n);
    names.push(n);
  };
  const ids = resolveEffectiveDramaShotCharacterIds(session, shot as DramaShot);
  for (const id of ids) {
    const c = byId.get(id);
    if (c?.name) pushName(c.name);
  }
  for (const d of shot.dialogue || []) {
    pushName(String(d.character_name || '').trim());
  }
  return names;
}

/**
 * 非空镜门禁：须绑定人物、有参考图，且能解析出演姓名（禁止「出场人物」占位）。
 */
export function collectDramaShotCastGateIssues(
  session: DramaDirectorSession,
  shot: DramaShot,
): DramaShotCastGateIssue[] {
  if (!dramaShotRequiresCast(shot)) return [];
  const issues: DramaShotCastGateIssue[] = [];
  const ids = resolveEffectiveDramaShotCharacterIds(session, shot);
  if (!ids.length) {
    issues.push({
      code: 'missing_cast',
      message: '本镜未标明空镜，须绑定出场人物并配人物素材，提示词须写清谁出演',
    });
    return issues;
  }
  for (const id of ids) {
    const ch = session.bible.characters.find((c) => c.character_id === id);
    if (!ch) {
      issues.push({
        code: 'missing_char_asset',
        message: `出场人物资产不存在：${id}`,
      });
      continue;
    }
    if (!characterHasUsableReference(ch) || !resolveCharacterMasterReferenceUrl(ch)) {
      issues.push({
        code: 'missing_char_image',
        message: `「${ch.name || id}」缺少人物参考图，请先回资产生成`,
      });
    }
  }
  const names = listDramaShotCastDisplayNames(session, shot);
  if (!names.length) {
    issues.push({
      code: 'unnamed_cast',
      message: '本镜须写清出演角色姓名，禁止使用「出场人物」占位',
    });
  }
  return issues;
}

export function formatDramaShotCastGateError(
  session: DramaDirectorSession,
  shot: DramaShot,
): string {
  const issues = collectDramaShotCastGateIssues(session, shot);
  if (!issues.length) return '';
  return issues.map((x) => x.message).join('\n');
}

/** 把文案里的「出场人物」替换成真实角色名；无姓名则原样返回 */
export function replaceDramaAnonymousCastLabel(text: string, castNames: string[]): string {
  const t = String(text || '');
  if (!t || !/出场人物/.test(t)) return t;
  const who = (castNames || []).map((n) => String(n || '').trim()).filter(Boolean);
  if (!who.length) return t;
  const label = who.length === 1 ? who[0] : who.join('、');
  return t.replace(/出场人物/g, label);
}
