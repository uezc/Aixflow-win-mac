/**
 * P1 Voice Isolation：人物 / 系统 / 旁白 身份表。
 * Audio 编号只是槽位，不是身份。缺少声音只 warning，禁止静默 fallback。
 */

import { resolveDramaCharacterIdByName } from './ensureAppearingCharacters.js';
import {
  isDramaNarrationVisual,
  looksLikeDramaInMindSystemVoice,
  looksLikeDramaSystemSpokenText,
} from './extractCastFromScript.js';
import type { DramaDirectorSession, DramaShot, DramaVoice } from './types.js';
import {
  DRAMA_NARRATOR_SPEAKER_ID,
  DRAMA_SYSTEM_SPEAKER_ID,
  type DramaVoiceRole,
  resolveDramaNarratorVoice,
  resolveDramaSystemVoice,
  resolveDramaVoiceRole,
  systemVoiceSampleUrl,
} from './voiceEntity.js';

export type DramaVoiceBindingRow = {
  entity_id: string;
  role: DramaVoiceRole;
  name: string;
  picture: number | null;
  subject: number | null;
  audio: number | null;
  voice_id: string;
  sample_url: string;
  missing_voice: boolean;
  warning: string;
};

export type DramaVoiceBindingTable = {
  rows: DramaVoiceBindingRow[];
  warnings: string[];
};

export type DramaSpokenEntity = {
  entity_id: string;
  role: DramaVoiceRole;
  name: string;
};

function trimOf(s: unknown): string {
  return String(s || '').trim();
}

function characterNameById(session: DramaDirectorSession, id: string): string {
  const cid = trimOf(id);
  if (!cid) return '';
  return trimOf((session.bible?.characters || []).find((c) => c.character_id === cid)?.name);
}

/** 本句的 Voice Entity。显式 dialogue_character_id 优先；禁止把系统/旁白判成在场人物。 */
export function resolveSpokenLineVoiceRole(
  characterId: string,
  characterName: string,
  text: string,
): DramaVoiceRole {
  const explicit = resolveDramaVoiceRole(characterId, characterName);
  if (explicit === 'system' || explicit === 'narrator') return explicit;
  const line = trimOf(text);
  if (looksLikeDramaSystemSpokenText(line) || looksLikeDramaInMindSystemVoice(line)) return 'system';
  if (isDramaNarrationVisual(line)) return 'narrator';
  return 'character';
}

/** 对白缺 character_id 时：按名 / 本段唯一在场人物补齐，避免素材音色挂不上。 */
function resolveCharacterEntityId(
  session: DramaDirectorSession,
  characterId: string,
  characterName: string,
  onScreenIds?: string[],
): string {
  const id = trimOf(characterId);
  if (id) return id;
  const byName = resolveDramaCharacterIdByName(
    session.bible?.characters || [],
    characterName,
  );
  if (byName) return byName;
  const onScreen = (onScreenIds || []).map((x) => trimOf(x)).filter(Boolean);
  return onScreen.length === 1 ? onScreen[0] : '';
}

export function collectDramaShotSpeakingEntities(
  session: DramaDirectorSession,
  shot: DramaShot,
): DramaSpokenEntity[] {
  const out: DramaSpokenEntity[] = [];
  const seen = new Set<string>();
  const push = (
    characterId: string,
    characterName: string,
    text: string,
    onScreenIds?: string[],
  ) => {
    const line = trimOf(text);
    if (!line) return;
    const name = trimOf(characterName);
    const resolvedId = resolveCharacterEntityId(session, characterId, name, onScreenIds);
    const role = resolveSpokenLineVoiceRole(resolvedId, name, line);
    const entityId =
      role === 'system'
        ? DRAMA_SYSTEM_SPEAKER_ID
        : role === 'narrator'
          ? DRAMA_NARRATOR_SPEAKER_ID
          : resolvedId;
    if (role === 'character' && !entityId) return;
    if (!entityId || seen.has(entityId)) return;
    seen.add(entityId);
    out.push({
      entity_id: entityId,
      role,
      name:
        role === 'system'
          ? '系统'
          : role === 'narrator'
            ? '旁白'
            : name || characterNameById(session, entityId) || entityId,
    });
  };
  for (const ev of shot.timeline_events || []) {
    push(
      trimOf(ev.dialogue_character_id),
      '',
      trimOf(ev.dialogue),
      ev.character_ids || shot.character_ids,
    );
  }
  for (const line of shot.dialogue || []) {
    push(
      trimOf(line.character_id),
      trimOf(line.character_name),
      trimOf(line.text),
      shot.character_ids,
    );
  }
  return out;
}

function resolveOwnCharacterVoice(
  session: DramaDirectorSession,
  characterId: string,
): DramaVoice | null {
  const cid = trimOf(characterId);
  if (!cid) return null;
  const ch = (session.bible?.characters || []).find((c) => c.character_id === cid);
  const voices = session.bible?.voices || [];
  if (ch?.voice_id) {
    const byVoiceId = voices.find((v) => v.voice_id === ch.voice_id);
    if (byVoiceId) return byVoiceId;
  }
  return voices.find((v) => v.character_id === cid) || null;
}

function resolveOwnVoice(
  session: DramaDirectorSession,
  entity: DramaSpokenEntity,
): DramaVoice | null {
  if (entity.role === 'system') return resolveDramaSystemVoice(session);
  if (entity.role === 'narrator') return resolveDramaNarratorVoice(session);
  return resolveOwnCharacterVoice(session, entity.entity_id);
}

function missingWarning(entity: DramaSpokenEntity, reason: string): string {
  return `missing voice: ${entity.role} ${entity.entity_id || entity.name} ${reason}`.trim();
}

/**
 * 为本镜说话实体分配 Audio 槽。
 * 只给「自己的」参考音（素材试听/reference_audio）；绝不把 A 的声音给 B。
 * shot.voice_ids 只影响排序优先级，不能剥夺说话人自己的素材音色。
 */
export function buildDramaShotVoiceBindingTable(
  session: DramaDirectorSession,
  shot: DramaShot,
  maxAudios = 3,
): DramaVoiceBindingTable {
  const limit = Math.max(1, Math.min(3, maxAudios));
  const speakers = collectDramaShotSpeakingEntities(session, shot);
  const explicitVoiceIds = (shot.voice_ids || []).map((id) => trimOf(id)).filter(Boolean);
  const explicitRank = new Map(explicitVoiceIds.map((id, i) => [id, i] as const));
  // 显式 voice_ids：优先按表内顺序排槽；未列入的说话人自己素材仍绑定，排在后面
  const ordered = [...speakers].sort((a, b) => {
    if (!explicitVoiceIds.length) return 0;
    const va = trimOf(resolveOwnVoice(session, a)?.voice_id);
    const vb = trimOf(resolveOwnVoice(session, b)?.voice_id);
    const ra = va && explicitRank.has(va) ? explicitRank.get(va)! : 1000;
    const rb = vb && explicitRank.has(vb) ? explicitRank.get(vb)! : 1000;
    return ra - rb;
  });
  const warnings: string[] = [];
  const rows: DramaVoiceBindingRow[] = [];
  let nextAudio = 1;

  for (const entity of ordered) {
    const voice = resolveOwnVoice(session, entity);
    const url = systemVoiceSampleUrl(voice);
    const voiceId = trimOf(voice?.voice_id);
    let warning = '';
    let missing = false;

    if (!url) {
      missing = true;
      warning = missingWarning(entity, 'no reference audio; refuse fallback');
    } else if (nextAudio > limit) {
      missing = true;
      warning = missingWarning(entity, `H3 max ${limit} audios; not sent; refuse remap`);
    }

    if (warning) warnings.push(warning);

    const audio = missing ? null : nextAudio;
    if (!missing) nextAudio += 1;

    rows.push({
      entity_id: entity.entity_id,
      role: entity.role,
      name: entity.name,
      picture: null,
      subject: null,
      audio,
      voice_id: missing ? '' : voiceId,
      sample_url: missing ? '' : url,
      missing_voice: missing,
      warning,
    });
  }

  return { rows, warnings };
}

export function attachDramaVoiceBindingPictures(
  rows: DramaVoiceBindingRow[],
  pictures: Array<{ index: number; asset_id?: string; role: string }>,
  subjects: Array<{ n: number; character_id?: string }>,
): DramaVoiceBindingRow[] {
  return rows.map((row) => {
    if (row.role !== 'character') {
      return { ...row, picture: null, subject: null };
    }
    const pic = pictures.find((s) => trimOf(s.asset_id) === row.entity_id && s.role === 'character');
    const sub = subjects.find((s) => trimOf(s.character_id) === row.entity_id);
    return {
      ...row,
      picture: pic && pic.index > 0 ? pic.index : null,
      subject: sub && sub.n > 0 ? sub.n : null,
    };
  });
}

export function audioIndexForVoiceEntity(
  table: DramaVoiceBindingTable,
  entityId: string,
): number {
  const id = trimOf(entityId);
  if (!id) return 0;
  const row = table.rows.find((r) => r.entity_id === id);
  return row?.audio && row.audio > 0 ? row.audio : 0;
}

export function voiceBindingRowForEntity(
  table: DramaVoiceBindingTable,
  entityId: string,
): DramaVoiceBindingRow | null {
  const id = trimOf(entityId);
  if (!id) return null;
  return table.rows.find((r) => r.entity_id === id) || null;
}

export function formatDramaVoiceBindingTableText(table: DramaVoiceBindingTable): string {
  const lines = ['VOICE_BINDING_TABLE', ''];
  if (!table.rows.length) {
    lines.push('(no spoken voice entities)');
  }
  for (const row of table.rows) {
    lines.push(row.entity_id);
    lines.push(`Role = ${row.role}`);
    lines.push(`Picture = ${row.picture ? `Picture ${row.picture}` : 'NONE'}`);
    lines.push(`Subject = ${row.subject ? `Subject ${row.subject}` : 'NONE'}`);
    lines.push(`Voice = ${row.audio ? `Audio ${row.audio}` : 'NONE'}`);
    if (row.warning) lines.push(`Warning = ${row.warning}`);
    lines.push('');
  }
  if (table.warnings.length) {
    lines.push('VOICE_WARNINGS');
    for (const w of table.warnings) lines.push(`- ${w}`);
  }
  return lines.filter((x, i, arr) => x !== '' || arr[i - 1] !== '').join('\n').trim();
}
