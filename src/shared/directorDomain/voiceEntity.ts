/**
 * 非人物语音实体：系统声 / 旁白声。
 * 不是 Character，不进 character_ids / Picture Subject。
 * Timeline 仍用既有 dialogue_character_id（system | narrator），不新增字段。
 */

import {
  isDramaNarrationVisual,
  isSystemSpeakerName,
  looksLikeDramaSystemSpokenText,
} from './extractCastFromScript.js';
import type { DramaDirectorSession, DramaShot, DramaVoice } from './types.js';

/** 明确的系统播报标题：【系统…】或「系统提示音：」等；禁止把「系统，你在吗」当成标题。 */
const SYSTEM_SCRIPT_HEADING_RE =
  /(?:^|\n)\s*(?:【\s*(?:系统提示音|系统声音|系统提示|系统播报|系统音|系统|SYSTEM)[^】]*】|(?:系统提示音|系统声音|系统提示|系统播报|系统音|SYSTEM)(?:\s*[（(][^)）]*[)）])?\s*[:：.。]|系统\s*[:：.。])/i;

/** 用户主动关掉系统提示音卡时写入 suppressed_character_names 的键。 */
export const DRAMA_SYSTEM_VOICE_SUPPRESS_KEY = '系统提示音';

/** 与 Timeline.dialogue_character_id 约定一致；不是 Character。 */
export const DRAMA_SYSTEM_SPEAKER_ID = 'system';
export const DRAMA_NARRATOR_SPEAKER_ID = 'narrator';

export type DramaVoiceEntityKind = 'system_voice' | 'narrator_voice';
export type DramaVoiceRole = 'character' | 'system' | 'narrator';

export const DRAMA_SYSTEM_VOICE_ENTITY = 'system_voice' as const;
export const DRAMA_NARRATOR_VOICE_ENTITY = 'narrator_voice' as const;

/** 非人物（系统或旁白）：sanitize / 门禁用，禁止进 characters。 */
const NON_CHARACTER_VOICE_ID_RE = /^(?:system|system_voice|narrator|narration)$/i;
const SYSTEM_ONLY_ID_RE = /^(?:system|system_voice)$/i;
const NARRATOR_ID_RE = /^(?:narrator|narration|narrator_voice)$/i;
const NARRATOR_NAME_RE = /^(?:旁白|画外音|narrator|narration)$/i;
const SYSTEM_VOICE_BLOB_RE = /系统|机械女|机械音|电子音|system[_\s-]?voice|narrator/i;

export function isDramaSystemVoiceId(id: string): boolean {
  const raw = String(id || '').trim();
  if (!raw) return false;
  if (NON_CHARACTER_VOICE_ID_RE.test(raw)) return true;
  return isSystemSpeakerName(raw);
}

export function isDramaSystemOnlyVoiceId(id: string): boolean {
  return SYSTEM_ONLY_ID_RE.test(String(id || '').trim());
}

export function isDramaNarratorVoiceId(id: string): boolean {
  const raw = String(id || '').trim();
  if (!raw) return false;
  if (NARRATOR_ID_RE.test(raw)) return true;
  return NARRATOR_NAME_RE.test(raw);
}

export function isDramaNarratorSpeakerName(raw: string): boolean {
  return NARRATOR_NAME_RE.test(String(raw || '').trim());
}

/** 身份角色：character / system / narrator。编号不是身份。 */
export function resolveDramaVoiceRole(id: string, name = ''): DramaVoiceRole {
  const cid = String(id || '').trim();
  const nm = String(name || '').trim();
  if (isDramaNarratorVoiceId(cid) || isDramaNarratorSpeakerName(nm) || isDramaNarratorSpeakerName(cid)) {
    return 'narrator';
  }
  if (isDramaSystemOnlyVoiceId(cid) || isDramaSystemOnlyVoiceId(nm)) return 'system';
  if (isDramaSystemVoiceId(cid) || isSystemSpeakerName(cid) || isSystemSpeakerName(nm)) {
    return isDramaNarratorSpeakerName(cid) || isDramaNarratorSpeakerName(nm) ? 'narrator' : 'system';
  }
  return 'character';
}

export function isDramaSystemVoiceEntity(
  voice: DramaVoice | null | undefined,
  session?: DramaDirectorSession | null,
): boolean {
  if (!voice) return false;
  const cid = String(voice.character_id || '').trim();
  if (cid && session?.bible?.characters?.length) {
    const owner = session.bible.characters.find((c) => c.character_id === cid);
    if (owner && !isSystemSpeakerName(owner.name) && !isDramaSystemVoiceId(cid)) {
      return false;
    }
  }
  if (isDramaSystemVoiceId(cid) || isDramaSystemVoiceId(voice.voice_id)) return true;
  const blob = [
    voice.identity?.voice_character,
    voice.voiceStyle,
    voice.timbre,
    voice.identity?.timbre,
    voice.sample_text,
    voice.voice_id,
  ]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .join(' ');
  return SYSTEM_VOICE_BLOB_RE.test(blob);
}

function isNarratorPinnedVoice(voice: DramaVoice): boolean {
  return (
    isDramaNarratorVoiceId(voice.character_id) ||
    isDramaNarratorVoiceId(voice.voice_id) ||
    isDramaNarratorSpeakerName(voice.voiceStyle) ||
    isDramaNarratorSpeakerName(voice.identity?.voice_character)
  );
}

export function resolveDramaSystemVoice(
  session: DramaDirectorSession | null | undefined,
): DramaVoice | null {
  const voices = session?.bible?.voices || [];
  if (!voices.length) return null;
  const bound = voices.find((v) => isDramaSystemOnlyVoiceId(v.character_id));
  if (bound) return bound;
  const byId = voices.find((v) => isDramaSystemOnlyVoiceId(v.voice_id));
  if (byId) return byId;
  const entities = voices.filter(
    (v) => isDramaSystemVoiceEntity(v, session) && !isNarratorPinnedVoice(v),
  );
  if (entities.length === 1) return entities[0];
  const withSample = entities.find((v) =>
    String(v.identity?.reference_audio || v.sample_url || '').trim(),
  );
  return withSample || entities[0] || null;
}

/** 旁白声：只认旁白实体，绝不回落到系统声或人物声。 */
export function resolveDramaNarratorVoice(
  session: DramaDirectorSession | null | undefined,
): DramaVoice | null {
  const voices = session?.bible?.voices || [];
  if (!voices.length) return null;
  const bound = voices.find((v) => isDramaNarratorVoiceId(v.character_id));
  if (bound) return bound;
  const byId = voices.find((v) => isDramaNarratorVoiceId(v.voice_id));
  if (byId) return byId;
  return null;
}

export function dramaShotHasSystemDialogue(
  session: DramaDirectorSession | null | undefined,
  shot: DramaShot | null | undefined,
): boolean {
  void session;
  if (!shot) return false;
  for (const ev of shot.timeline_events || []) {
    const cid = String(ev.dialogue_character_id || '').trim();
    const dlg = String(ev.dialogue || '').trim();
    if (!dlg) continue;
    if (isReliableSystemDialogueLine(cid, dlg)) return true;
  }
  for (const line of shot.dialogue || []) {
    const cid = String(line.character_id || '').trim();
    const name = String(line.character_name || '').trim();
    const text = String(line.text || '').trim();
    if (!text) continue;
    if (isReliableSystemDialogueLine(cid || name, text)) return true;
  }
  return false;
}

/**
 * 真·系统播报行：标签/机械播报文案，或确认为 system 且不像人物喊「系统」。
 * 避免「系统，你在吗？」被 dialogue_character_id=system 误伤。
 */
function isReliableSystemDialogueLine(speakerIdOrName: string, text: string): boolean {
  const dlg = String(text || '').trim();
  if (!dlg) return false;
  if (looksLikeDramaSystemSpokenText(dlg)) return true;
  if (resolveDramaVoiceRole(speakerIdOrName) !== 'system') return false;
  // 人物对系统说话 / 称呼，不是系统开口
  if (/^系统[，,！!？?\s]/.test(dlg) && !/^系统\s*[:：.。]/.test(dlg)) return false;
  return true;
}

export function dramaShotHasNarratorDialogue(
  session: DramaDirectorSession | null | undefined,
  shot: DramaShot | null | undefined,
): boolean {
  void session;
  if (!shot) return false;
  for (const ev of shot.timeline_events || []) {
    const cid = String(ev.dialogue_character_id || '').trim();
    const dlg = String(ev.dialogue || '').trim();
    if (!dlg) continue;
    if (resolveDramaVoiceRole(cid) === 'narrator') return true;
    if (isDramaNarrationVisual(dlg) && !looksLikeDramaSystemSpokenText(dlg)) return true;
  }
  for (const line of shot.dialogue || []) {
    const cid = String(line.character_id || '').trim();
    const name = String(line.character_name || '').trim();
    if (resolveDramaVoiceRole(cid, name) === 'narrator') return true;
  }
  return false;
}

function dramaSessionSourceScriptText(session: DramaDirectorSession): string {
  const epId = String(session.active_episode_id || '').trim();
  const ep = (session.episodes || []).find((e) => e.episode_id === epId);
  const fromEp = String(ep?.text || '').trim();
  if (fromEp) return fromEp;
  return String(session.meta?.source_script || '').trim();
}

function isNarrationLikeSpeakerName(name: string): boolean {
  const n = String(name || '').trim();
  return isDramaNarratorSpeakerName(n) || /^(?:旁白|画外音)$/i.test(n);
}

/** 用户是否已关掉系统提示音素材卡（旁白仍可走 system 槽，不弹此卡）。 */
export function isDramaSystemVoiceSuppressed(
  session: DramaDirectorSession | null | undefined,
): boolean {
  const list = session?.bible?.suppressed_character_names || [];
  if (!list.length) return false;
  const keys = new Set(
    [DRAMA_SYSTEM_VOICE_SUPPRESS_KEY, '系统', 'system', DRAMA_SYSTEM_SPEAKER_ID].map((s) =>
      String(s).trim().toLowerCase().replace(/\s+/g, ''),
    ),
  );
  return list.some((raw) => keys.has(String(raw || '').trim().toLowerCase().replace(/\s+/g, '')));
}

/**
 * 镜头里是否有「真·系统播报」台词。
 * 注意：本仓库旁白常复用 dialogue_character_id=system，不能单凭 cid 判定。
 */
function dramaShotHasTrueSystemPromptDialogue(shot: DramaShot | null | undefined): boolean {
  if (!shot) return false;
  for (const ev of shot.timeline_events || []) {
    const dlg = String(ev.dialogue || '').trim();
    if (!dlg) continue;
    if (isDramaNarrationVisual(dlg)) continue;
    if (looksLikeDramaSystemSpokenText(dlg)) return true;
  }
  for (const line of shot.dialogue || []) {
    const name = String(line.character_name || '').trim();
    const text = String(line.text || '').trim();
    if (!text) continue;
    if (isNarrationLikeSpeakerName(name) || isDramaNarrationVisual(text)) continue;
    if (looksLikeDramaSystemSpokenText(text)) return true;
  }
  return false;
}

/**
 * 当前剧本是否需要「系统提示音」素材卡（全息系统形象）。
 * 旁白/画外音不算；它们即使 timeline 标成 system 也不弹此卡。
 */
export function dramaSessionNeedsSystemVoice(
  session: DramaDirectorSession | null | undefined,
): boolean {
  if (!session) return false;
  if (isDramaSystemVoiceSuppressed(session)) return false;

  const epId = String(session.active_episode_id || '').trim();
  const segs = session.episode_bibles?.[epId]?.original_segments || [];

  if (segs.length) {
    for (const seg of segs) {
      if (seg.type === 'narration') continue;
      if (seg.type === 'system') return true;
      if (seg.speaker_type === 'system') {
        const name = String(seg.character_name || '').trim();
        if (isNarrationLikeSpeakerName(name)) continue;
        return true;
      }
      const text = String(seg.original_text || '');
      if (isDramaNarrationVisual(text)) continue;
      if (looksLikeDramaSystemSpokenText(text)) return true;
    }
    for (const shot of session.shots || []) {
      if (dramaShotHasTrueSystemPromptDialogue(shot)) return true;
    }
    return false;
  }

  for (const shot of session.shots || []) {
    if (dramaShotHasTrueSystemPromptDialogue(shot)) return true;
  }

  const source = dramaSessionSourceScriptText(session);
  if (!source) return false;
  if (SYSTEM_SCRIPT_HEADING_RE.test(source)) return true;
  for (const line of source.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (isDramaNarrationVisual(t)) continue;
    if (looksLikeDramaSystemSpokenText(t)) return true;
  }
  return false;
}

/** 去掉系统提示音 Voice 实体（人物卡仍由 stripDramaSystemSpeakerCharacters 处理）。 */
export function dropDramaSystemVoice(session: DramaDirectorSession): DramaDirectorSession {
  const sys = resolveDramaSystemVoice(session);
  const voices = session?.bible?.voices || [];
  if (!sys) {
    return stripDramaSystemSpeakerCharacters(session);
  }
  const nextVoices = voices.filter((v) => v.voice_id !== sys.voice_id);
  if (nextVoices.length === voices.length) {
    return stripDramaSystemSpeakerCharacters(session);
  }
  return stripDramaSystemSpeakerCharacters({
    ...session,
    bible: {
      ...session.bible,
      voices: nextVoices,
    },
  });
}

/** 素材页关掉系统提示音卡：删除实体并禁止自动补回。 */
export function suppressDramaSystemVoice(session: DramaDirectorSession): DramaDirectorSession {
  const prev = session.bible?.suppressed_character_names || [];
  const suppressed = [
    ...new Set([
      ...prev,
      DRAMA_SYSTEM_VOICE_SUPPRESS_KEY,
      '系统',
      DRAMA_SYSTEM_SPEAKER_ID,
    ]),
  ];
  return dropDramaSystemVoice({
    ...session,
    bible: {
      ...session.bible,
      suppressed_character_names: suppressed,
    },
  });
}

export function isDramaSystemSpeakerCharacter(c: {
  character_id?: string;
  name?: string;
} | null | undefined): boolean {
  if (!c) return false;
  const id = String(c.character_id || '').trim();
  const name = String(c.name || '').trim();
  return isDramaSystemVoiceId(id) || isSystemSpeakerName(id) || isSystemSpeakerName(name);
}

/** 系统/旁白不是 Character：有形象图也要从人物卡剔除；形象迁到系统 Voice。 */
export function stripDramaSystemSpeakerCharacters(
  session: DramaDirectorSession,
): DramaDirectorSession {
  const chars = session?.bible?.characters || [];
  const dropped = chars.filter((c) => isDramaSystemSpeakerCharacter(c));
  const drop = new Set(
    dropped.map((c) => String(c.character_id || '').trim()).filter(Boolean),
  );
  if (!drop.size) return session;
  const migrateImage =
    dropped
      .map((c) => String(c.imageUrl || '').trim())
      .find(Boolean) || '';
  const migratePrompt =
    dropped
      .map((c) => String(c.prompt || '').trim())
      .find(Boolean) || '';
  let voices = (session.bible.voices || []).map((v) =>
    drop.has(String(v.character_id || '').trim())
      ? { ...v, character_id: DRAMA_SYSTEM_SPEAKER_ID }
      : v,
  );
  const sysVoice =
    voices.find((v) => isDramaSystemOnlyVoiceId(v.character_id)) ||
    voices.find((v) => isDramaSystemOnlyVoiceId(v.voice_id)) ||
    null;
  if (sysVoice && (migrateImage || migratePrompt)) {
    voices = voices.map((v) => {
      if (v.voice_id !== sysVoice.voice_id) return v;
      const ownImg = String(v.imageUrl || '').trim();
      const ownPrompt = String(v.image_prompt || '').trim();
      return {
        ...v,
        character_id: DRAMA_SYSTEM_SPEAKER_ID,
        ...(!ownImg && migrateImage
          ? { imageUrl: migrateImage, image_status: 'ready' as const }
          : {}),
        ...(!ownPrompt && migratePrompt ? { image_prompt: migratePrompt } : {}),
      };
    });
  }
  return {
    ...session,
    bible: {
      ...session.bible,
      characters: chars.filter((c) => !drop.has(String(c.character_id || '').trim())),
      voices,
    },
    shots: (session.shots || []).map((s) => ({
      ...s,
      character_ids: sanitizeDramaCharacterIds(
        (s.character_ids || []).filter((id) => !drop.has(String(id || '').trim())),
      ),
      dialogue: (s.dialogue || []).map((line) => {
        const cid = String(line.character_id || '').trim();
        const name = String(line.character_name || '').trim();
        if (!drop.has(cid) && !isSystemSpeakerName(name) && !isDramaSystemVoiceId(cid)) return line;
        return { ...line, character_id: DRAMA_SYSTEM_SPEAKER_ID };
      }),
    })),
    scene_beats: (session.scene_beats || []).map((b) => ({
      ...b,
      cast_ids: (b.cast_ids || []).filter((id) => !drop.has(String(id || '').trim())),
      characters: (b.characters || []).filter((n) => !isSystemSpeakerName(String(n))),
    })),
  };
}

/** 素材仓库 / pipeline 生图用的系统形象资产名（不是 Character）。 */
export const DRAMA_SYSTEM_VISUAL_ASSET_NAME = '系统提示音';

/** 系统形象默认生图提示：全息面板，禁止写成真人角色。用户已填则原样保留。 */
export function composeDramaSystemVisualPrompt(existing?: string): string {
  const t = String(existing || '').trim();
  if (t) return t;
  return [
    DRAMA_SYSTEM_HOLOGRAM_VISUAL_ZH,
    '科技感产品定妆图，白底或简洁深色棚拍',
    '禁止文字水印与可读字幕，禁止写成真人角色面孔',
  ].join('，');
}

/** pipeline / 上传回写用的固定系统形象资产 id（= dialogue_character_id）。 */
export function isDramaSystemVisualAssetId(
  assetId: string,
  session?: DramaDirectorSession | null,
): boolean {
  const id = String(assetId || '').trim();
  if (!id) return false;
  if (isDramaSystemOnlyVoiceId(id) || id === DRAMA_SYSTEM_SPEAKER_ID) return true;
  const voice = resolveDramaSystemVoice(session);
  return !!voice && String(voice.voice_id || '').trim() === id;
}

export function resolveDramaSystemVisualAssetId(
  session?: DramaDirectorSession | null,
): string {
  void session;
  return DRAMA_SYSTEM_SPEAKER_ID;
}

export function sanitizeDramaCharacterIds(ids: string[] | undefined | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids || []) {
    const id = String(raw || '').trim();
    if (!id || seen.has(id) || isDramaSystemVoiceId(id) || isSystemSpeakerName(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function systemVoiceSampleUrl(voice: DramaVoice | null | undefined): string {
  if (!voice) return '';
  return String(voice.identity?.reference_audio || voice.sample_url || '').trim();
}

export const DRAMA_SYSTEM_VOICE_TIMBRE =
  '机械电子播报，冷静、清晰、非人声，固定系统音色，绝不模仿任何在场人物';

/** 系统弹出时的默认画面事实：3D 全息面板，禁止可读汉字/字母（否则会烧成字幕）。 */
export const DRAMA_SYSTEM_HOLOGRAM_VISUAL_ZH =
  '半空浮现半透明3D全息系统面板，冷蓝光几何框与光粒子环绕，面板只有抽象图标与无字光带';

export const DRAMA_SYSTEM_HOLOGRAM_VISUAL_EN =
  'A translucent 3D holographic system panel materializes in mid-air, cool-blue geometric frames and light particles; the panel shows only abstract icons and unreadable light bands';

export function isDramaSystemHologramVisual(raw: string): boolean {
  const t = String(raw || '').trim();
  if (!t) return false;
  return /3D全息|全息系统面板|holographic system panel/i.test(t);
}

/** 系统对白且画面空时补全息；已有用户画面不覆盖。 */
export function ensureDramaSystemHologramVisual(visual: string, hasSystemDialogue: boolean): string {
  const v = String(visual || '').trim();
  if (!hasSystemDialogue) return v;
  if (v) return v;
  return DRAMA_SYSTEM_HOLOGRAM_VISUAL_ZH;
}

export function composeDramaSystemVoiceSampleText(existing?: string): string {
  const t = String(existing || '').trim();
  if (
    t.length >= 40 &&
    /音色描述\s*[：:]/.test(t) &&
    /台词\s*[：:]/.test(t) &&
    /系统|机械|电子/.test(t)
  ) {
    return t;
  }
  return [
    '系统',
    '年龄：非人',
    '性别：中性',
    `音色描述：${DRAMA_SYSTEM_VOICE_TIMBRE}`,
    '台词：',
    '叮——峡谷商城系统激活完毕。',
    '恭喜宿主获得新手礼包。',
  ].join('\n');
}
