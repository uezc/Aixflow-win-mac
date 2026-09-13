/**
 * 短剧素材准备：人工勾选已有人物形象 + 对应声音（角色库 / 本集已有卡片）。
 */

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import AssetLibLazyThumb from '../AssetLibLazyThumb';
import {
  applyDramaSessionVoiceSample,
  characterHasUsableReference,
  composeDramaCharacterDesignPrompt,
  composeDramaVoiceSampleLine,
  coreDramaPersonName,
  createEmptyDramaAssetReferenceImage,
  createEmptyDramaCharacter,
  createEmptyDramaCharacterCostume,
  createEmptyDramaVoice,
  namesLikelySameDramaPerson,
  resolveDramaCharacterIdByName,
  isDramaSystemSpeakerCharacter,
  type DramaDirectorSession,
} from '../../../shared/directorDomain';
import {
  isImageTo3dLibraryCharacter,
  resolveCharacterVoiceUrlForDrag,
  type Character,
} from '../characterListShared';
import { getCharactersCoalesced } from '../../utils/characterLibraryCache';

export type DramaLibraryPickItem = {
  id: string;
  source: 'cast' | 'library' | 'session';
  name: string;
  imageUrl: string;
  voiceUrl: string;
};

export type DramaLibraryPickMode = 'image' | 'voice' | 'both';

type CheckState = Record<string, { image: boolean; voice: boolean }>;

function normPersonName(name: string): string {
  return String(name || '')
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase();
}

function localResourceFromFsPath(filePath: string): string {
  const raw = String(filePath || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:') || raw.startsWith('blob:')) {
    return raw;
  }
  let body = raw
    .replace(/^file:\/\/\/?/, '')
    .replace(/^local-resource:\/\/+/, '')
    .replace(/\\/g, '/');
  try {
    body = decodeURIComponent(body);
  } catch {
    /* keep */
  }
  body = body.replace(/^\/([a-zA-Z]:)/, '$1');
  if (/^[a-zA-Z]\//.test(body)) {
    body = `${body[0].toUpperCase()}:${body.slice(1)}`;
  }
  const encoded = body.split('/').map((part, index) => {
    if (index === 0 && /^[a-zA-Z]:$/.test(part)) return part;
    if (!part) return part;
    if (/[\u4e00-\u9fa5\s%]/.test(part) || /[^\x00-\x7F]/.test(part)) {
      try {
        return encodeURIComponent(decodeURIComponent(part));
      } catch {
        return encodeURIComponent(part);
      }
    }
    return part;
  });
  return `local-resource://${encoded.join('/')}`;
}

/** 卡片/缩略图可加载的地址：本地盘符路径转 local-resource。 */
export function toDisplayableDramaMediaUrl(url: string | undefined | null): string {
  return localResourceFromFsPath(String(url || '').trim());
}

function libraryCharacterImageUrl(c: Character): string {
  const fromLocal = localResourceFromFsPath(String(c.localAvatarPath || ''));
  if (fromLocal) return fromLocal;
  const views = Array.isArray(c.viewImages) ? c.viewImages : [];
  for (const v of views) {
    const u = localResourceFromFsPath(String(v || ''));
    if (u) return u;
  }
  return localResourceFromFsPath(String(c.avatar || ''));
}

export function listSessionCharacterPicks(
  session: DramaDirectorSession,
  excludeCharacterId?: string,
): DramaLibraryPickItem[] {
  const skip = String(excludeCharacterId || '').trim();
  const items: DramaLibraryPickItem[] = [];
  for (const ch of session.bible.characters || []) {
    const id = String(ch.character_id || '').trim();
    if (!id || id === skip) continue;
    const imageUrl = String(ch.imageUrl || '').trim();
    const voiceId = String(ch.voice_id || '').trim();
    const voice =
      (voiceId && session.bible.voices.find((v) => v.voice_id === voiceId)) ||
      session.bible.voices.find((v) => v.character_id === id);
    const voiceUrl = String(voice?.sample_url || '').trim();
    if (!imageUrl && !voiceUrl) continue;
    items.push({
      id: `session:${id}`,
      source: 'session',
      name: String(ch.name || '').trim() || id,
      imageUrl,
      voiceUrl,
    });
  }
  return items;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  const safe = promise.catch(() => fallback);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), ms);
    void safe.then((value) => {
      window.clearTimeout(timer);
      resolve(value);
    });
  });
}

function defaultPickChecks(
  items: DramaLibraryPickItem[],
  targetKey: string,
  prefer: DramaLibraryPickMode,
): CheckState {
  const next: CheckState = {};
  for (const item of items) {
    const nameHit = !!targetKey && normPersonName(item.name) === targetKey;
    next[item.id] = {
      image: !!(item.imageUrl && nameHit && prefer !== 'voice'),
      voice: !!(item.voiceUrl && nameHit && prefer !== 'image'),
    };
  }
  return next;
}

export async function loadDramaCharacterLibraryPicks(): Promise<DramaLibraryPickItem[]> {
  if (!window.electronAPI?.getCharacters) return [];
  const list = (await withTimeout(getCharactersCoalesced<Character>(), 8000, [] as Character[])) as Character[];
  return list
    .filter((c) => !isImageTo3dLibraryCharacter(c))
    .map((c) => {
      const imageUrl = libraryCharacterImageUrl(c);
      const voiceUrl = resolveCharacterVoiceUrlForDrag(c) || '';
      return {
        id: `library:${c.id}`,
        source: 'library' as const,
        name: String(c.nickname || c.name || c.id).trim() || c.id,
        imageUrl,
        voiceUrl,
      };
    })
    .filter((x) => x.imageUrl || x.voiceUrl);
}

function mapCastLibraryCharacters(
  characters: Array<{ id?: string; name?: string; imageUrl?: string; voiceUrl?: string }>,
  idPrefix: string,
): DramaLibraryPickItem[] {
  return characters
    .filter((c) => String(c.imageUrl || '').trim() || String(c.voiceUrl || '').trim())
    .map((c, i) => ({
      id: `${idPrefix}${c.id || i}:${String(c.name || '').trim() || i}`,
      source: 'cast' as const,
      name: String(c.name || '').trim() || `cast-${i}`,
      imageUrl: String(c.imageUrl || '').trim(),
      voiceUrl: String(c.voiceUrl || '').trim(),
    }));
}

export async function loadDramaCastLibraryPicks(
  projectId?: string | null,
): Promise<DramaLibraryPickItem[]> {
  const id = String(projectId || '').trim();
  if (!id) return [];
  try {
    if (window.electronAPI?.directorV2RecoverCastPicks) {
      const recovered = await withTimeout(
        window.electronAPI.directorV2RecoverCastPicks(id),
        4000,
        { ok: false as const },
      );
      if (recovered?.ok && recovered.picks?.length) {
        return mapCastLibraryCharacters(recovered.picks, 'cast-recover:');
      }
    }
    if (!window.electronAPI?.directorV2LoadCastLibrary) return [];
    const res = await withTimeout(
      window.electronAPI.directorV2LoadCastLibrary(id),
      4000,
      { ok: false as const },
    );
    if (res && 'ok' in res && res.ok && res.library?.characters?.length) {
      return mapCastLibraryCharacters(res.library.characters, 'cast:');
    }
    return [];
  } catch {
    return [];
  }
}

export async function upsertDramaSessionToCastLibrary(
  projectId: string | null | undefined,
  session: DramaDirectorSession,
): Promise<{ characters: number; scenes: number; failed: number }> {
  const id = String(projectId || '').trim();
  if (!id || !window.electronAPI?.directorV2UpsertCastLibrary) {
    return { characters: 0, scenes: 0, failed: 1 };
  }
  const characters = (session.bible.characters || [])
    .map((ch) => ({
      id: ch.character_id,
      name: String(ch.name || '').trim(),
      gender: ch.gender,
      prompt: ch.prompt,
      imageUrl: String(ch.imageUrl || '').trim(),
      voiceUrl: characterVoiceSampleUrl(session, ch.character_id),
    }))
    .filter((c) => c.name && (c.imageUrl || c.voiceUrl));
  const scenes = (session.bible.scenes || [])
    .map((s) => ({
      id: s.scene_id,
      name: String(s.name || s.location || '').trim(),
      imageUrl: String(s.imageUrl || '').trim(),
    }))
    .filter((s) => s.name && s.imageUrl);
  if (!characters.length && !scenes.length) {
    return { characters: 0, scenes: 0, failed: 0 };
  }
  const res = await window.electronAPI.directorV2UpsertCastLibrary(id, { characters, scenes });
  if (!res?.ok) return { characters: 0, scenes: 0, failed: 1 };
  return { characters: characters.length, scenes: scenes.length, failed: 0 };
}

function patchDramaBible(
  session: DramaDirectorSession,
  bible: DramaDirectorSession['bible'],
): DramaDirectorSession {
  return { ...session, bible };
}

function ensureCharacterVoice(
  session: DramaDirectorSession,
  characterId: string,
): { session: DramaDirectorSession; voiceId: string } {
  const id = String(characterId || '').trim();
  const ch = session.bible.characters.find((c) => c.character_id === id);
  const bound = String(ch?.voice_id || '').trim();
  const existing =
    (bound && session.bible.voices.find((v) => v.voice_id === bound)) ||
    session.bible.voices.find((v) => v.character_id === id);
  if (existing) return { session, voiceId: existing.voice_id };
  const created = createEmptyDramaVoice({ character_id: id });
  return {
    session: patchDramaBible(session, {
      ...session.bible,
      voices: [...(session.bible.voices || []), created],
      characters: session.bible.characters.map((c) =>
        c.character_id === id ? { ...c, voice_id: created.voice_id } : c,
      ),
    }),
    voiceId: created.voice_id,
  };
}

export function applyDramaLibraryPickToCharacter(
  session: DramaDirectorSession,
  characterId: string,
  pick: { imageUrl?: string; voiceUrl?: string },
): DramaDirectorSession {
  const id = String(characterId || '').trim();
  if (!id) return session;
  let next = session;
  const imageUrl = String(pick.imageUrl || '').trim();
  const voiceUrl = String(pick.voiceUrl || '').trim();
  if (imageUrl) {
    const characters = next.bible.characters.map((c) => {
      if (c.character_id !== id) return c;
      const list = c.costumes || [];
      const hasActive = list.some((cos) => cos.active);
      const nextCostumes = list.length
        ? list.map((cos, i) => {
            const writeHere = cos.active || (!hasActive && i === 0);
            if (!writeHere) return cos;
            return {
              ...cos,
              active: true,
              images: [imageUrl, ...(cos.images || []).filter((u) => u !== imageUrl)],
            };
          })
        : [
            createEmptyDramaCharacterCostume({
              name: '默认服装',
              prompt: '',
              images: [imageUrl],
              active: true,
              tag: '常服',
            }),
          ];
      return {
        ...c,
        imageUrl,
        status: 'ready' as const,
        reference_images: [
          createEmptyDramaAssetReferenceImage({ kind: 'master', url: imageUrl, label: 'master' }),
          ...(c.reference_images || []).filter((r) => r.kind !== 'master' && r.kind !== 'main'),
        ],
        costumes: nextCostumes,
      };
    });
    next = patchDramaBible(next, { ...next.bible, characters });
  }
  if (voiceUrl) {
    // 走统一入口 applyDramaSessionVoiceSample：
    // 1) 更新 voice.sample_url；
    // 2) 同步失效所有引用该 voice 的已生成镜头配音（清 audio_url / 置 audio_status=pending），
    //    让分镜角色声音卡立刻显示新声音、生成按钮重新点亮。
    const ensured = ensureCharacterVoice(next, id);
    next =
      applyDramaSessionVoiceSample(ensured.session, ensured.voiceId, {
        sampleUrl: voiceUrl,
        status: 'ready',
        error: undefined,
      }) || ensured.session;
  }
  return next;
}

function createDramaCharacterFromLibraryPick(
  session: DramaDirectorSession,
  sel: { name: string; imageUrl?: string; voiceUrl?: string },
): { session: DramaDirectorSession; characterId: string } {
  const name = String(sel.name || '').trim();
  const ch = createEmptyDramaCharacter({
    name,
    role: '出场角色',
    identity: '出场角色',
    status: 'pending',
    prompt: composeDramaCharacterDesignPrompt({
      name,
      role: '出场角色',
      identity: '出场角色',
      prompt: '',
    }),
    costumes: [
      createEmptyDramaCharacterCostume({
        name: '默认服装',
        prompt: '',
        images: [],
        active: true,
        tag: '常服',
      }),
    ],
  });
  const voice = createEmptyDramaVoice({
    character_id: ch.character_id,
    sample_text: composeDramaVoiceSampleLine({ name, role: '出场角色' }),
    language: 'zh',
  });
  ch.voice_id = voice.voice_id;
  const next = patchDramaBible(session, {
    ...session.bible,
    characters: [...(session.bible.characters || []), ch],
    voices: [...(session.bible.voices || []), voice],
  });
  return { session: next, characterId: ch.character_id };
}

function scriptTextHasCastName(text: string, name: string): boolean {
  const raw = String(text || '');
  const n = String(name || '').trim();
  if (!n) return true;
  if (raw.includes(n)) return true;
  const core = coreDramaPersonName(n);
  return !!(core && core !== n && raw.includes(core));
}

/** 勾选人物写入本集剧本正文（未出现的名字补一行出场人物）。 */
export function injectDramaCastNamesIntoScript(
  session: DramaDirectorSession,
  names: string[],
): { session: DramaDirectorSession; injected: string[] } {
  const unique = [...new Set(names.map((n) => String(n || '').trim()).filter(Boolean))];
  if (!unique.length) return { session, injected: [] };
  const epId = String(session.active_episode_id || '').trim();
  const ep =
    (session.episodes || []).find((e) => e.episode_id === epId) ||
    (session.episodes || [])[0] ||
    null;
  const currentText = String(ep?.text || session.meta.source_script || '');
  const missing = unique.filter((n) => !scriptTextHasCastName(currentText, n));
  if (!missing.length) return { session, injected: [] };
  const line = `出场人物：${missing.join('、')}`;
  const trimmed = currentText.replace(/\s+$/, '');
  const nextText = trimmed ? `${trimmed}\n\n${line}` : line;
  const now = Date.now();
  const nextEps = ep
    ? (session.episodes || []).map((e) =>
        e.episode_id === ep.episode_id
          ? { ...e, text: nextText, updated_at: now, analyzed: false }
          : e,
      )
    : session.episodes || [];
  return {
    session: {
      ...session,
      episodes: nextEps,
      meta: {
        ...session.meta,
        source_script: nextText,
      },
    },
    injected: missing,
  };
}

export function applyDramaLibraryPicksByName(
  session: DramaDirectorSession,
  selections: Array<{ name: string; imageUrl?: string; voiceUrl?: string }>,
): { session: DramaDirectorSession; applied: number; created: number; skipped: number } {
  let next = session;
  let applied = 0;
  let created = 0;
  let skipped = 0;
  for (const sel of selections) {
    const name = String(sel.name || '').trim();
    if (!name) {
      skipped += 1;
      continue;
    }
    let targetId = resolveDramaCharacterIdByName(next.bible.characters || [], name);
    if (!targetId) {
      const made = createDramaCharacterFromLibraryPick(next, sel);
      next = made.session;
      targetId = made.characterId;
      created += 1;
    }
    next = applyDramaLibraryPickToCharacter(next, targetId, sel);
    applied += 1;
  }
  return { session: next, applied, created, skipped };
}

/** 勾选人物写入本页素材卡；同名补图/声，没有则新建。不切阶段，避免卡死。 */
export function putDramaLibraryPicksIntoScript(
  session: DramaDirectorSession,
  selections: Array<{ name: string; imageUrl?: string; voiceUrl?: string }>,
): {
  session: DramaDirectorSession;
  applied: number;
  created: number;
  injected: string[];
  skipped: number;
} {
  const upserted = applyDramaLibraryPicksByName(session, selections);
  return {
    session: upserted.session,
    applied: upserted.applied,
    created: upserted.created,
    injected: [],
    skipped: upserted.skipped,
  };
}

function characterVoiceSampleUrl(session: DramaDirectorSession, characterId: string): string {
  const id = String(characterId || '').trim();
  const ch = session.bible.characters.find((c) => c.character_id === id);
  const bound = String(ch?.voice_id || '').trim();
  const voice =
    (bound && session.bible.voices.find((v) => v.voice_id === bound)) ||
    session.bible.voices.find((v) => v.character_id === id);
  return String(voice?.sample_url || '').trim();
}

function findLibraryPickForName(
  name: string,
  byName: Map<string, { imageUrl: string; voiceUrl: string }>,
  picks: Array<{ name: string; imageUrl?: string; voiceUrl?: string }>,
): { imageUrl: string; voiceUrl: string } | null {
  const exactKey = normPersonName(name);
  const exact = exactKey ? byName.get(exactKey) : undefined;
  if (exact && (exact.imageUrl || exact.voiceUrl)) return exact;
  const coreKey = normPersonName(coreDramaPersonName(name));
  if (coreKey && coreKey !== exactKey) {
    const coreHit = byName.get(coreKey);
    if (coreHit && (coreHit.imageUrl || coreHit.voiceUrl)) return coreHit;
  }
  let best: { imageUrl: string; voiceUrl: string; score: number } | null = null;
  for (const p of picks) {
    const pname = String(p.name || '').trim();
    if (!pname) continue;
    const imageUrl = String(p.imageUrl || '').trim();
    const voiceUrl = String(p.voiceUrl || '').trim();
    if (!imageUrl && !voiceUrl) continue;
    let score = 0;
    if (namesLikelySameDramaPerson(name, pname)) score = 3;
    else {
      const pn = normPersonName(coreDramaPersonName(pname) || pname);
      const cn = coreKey || exactKey;
      if (cn && pn && pn.length >= 3 && cn.length >= 3 && (cn.endsWith(pn) || pn.endsWith(cn))) {
        score = 2;
      }
    }
    if (score > (best?.score || 0)) best = { imageUrl, voiceUrl, score };
  }
  return best ? { imageUrl: best.imageUrl, voiceUrl: best.voiceUrl } : null;
}

/** 按同名把角色库形象/声音填进空卡片，不覆盖已有素材。 */
export function fillEmptyDramaAssetsFromLibraryPicks(
  session: DramaDirectorSession,
  picks: Array<{ name: string; imageUrl?: string; voiceUrl?: string }>,
): { session: DramaDirectorSession; images: number; voices: number } {
  const byName = new Map<string, { imageUrl: string; voiceUrl: string }>();
  for (const p of picks) {
    const key = normPersonName(p.name);
    if (!key) continue;
    const imageUrl = String(p.imageUrl || '').trim();
    const voiceUrl = String(p.voiceUrl || '').trim();
    const prev = byName.get(key);
    if (!prev) {
      byName.set(key, { imageUrl, voiceUrl });
      continue;
    }
    byName.set(key, {
      imageUrl: prev.imageUrl || imageUrl,
      voiceUrl: prev.voiceUrl || voiceUrl,
    });
  }
  let next = session;
  let images = 0;
  let voices = 0;
  for (const ch of session.bible.characters || []) {
    if (isDramaSystemSpeakerCharacter(ch)) continue;
    const pick = findLibraryPickForName(ch.name, byName, picks);
    if (!pick) continue;
    const needImage = !characterHasUsableReference(ch) && pick.imageUrl;
    const needVoice = !characterVoiceSampleUrl(next, ch.character_id) && pick.voiceUrl;
    if (!needImage && !needVoice) continue;
    next = applyDramaLibraryPickToCharacter(next, ch.character_id, {
      imageUrl: needImage ? pick.imageUrl : undefined,
      voiceUrl: needVoice ? pick.voiceUrl : undefined,
    });
    if (needImage) images += 1;
    if (needVoice) voices += 1;
  }
  return { session: next, images, voices };
}

export function pickDramaLibraryImageUrl(
  name: string,
  picks: Array<{ name: string; imageUrl?: string; voiceUrl?: string }>,
): string {
  const byName = new Map<string, { imageUrl: string; voiceUrl: string }>();
  for (const p of picks) {
    const key = normPersonName(p.name);
    if (!key) continue;
    const imageUrl = String(p.imageUrl || '').trim();
    const voiceUrl = String(p.voiceUrl || '').trim();
    const prev = byName.get(key);
    if (!prev) {
      byName.set(key, { imageUrl, voiceUrl });
      continue;
    }
    byName.set(key, {
      imageUrl: prev.imageUrl || imageUrl,
      voiceUrl: prev.voiceUrl || voiceUrl,
    });
  }
  return findLibraryPickForName(name, byName, picks)?.imageUrl || '';
}

/**
 * 把本集已有形象/声音按同名写入全局角色库、场景库。
 * 有同名则更新，没有则新建；空卡片跳过。这是跨集复用的档案层。
 */
export async function syncDramaSessionToAssetLibraries(
  session: DramaDirectorSession,
): Promise<{ characters: number; scenes: number; failed: number }> {
  const api = window.electronAPI;
  let charactersN = 0;
  let scenesN = 0;
  let failed = 0;

  const libChars = (await getCharactersCoalesced<Character>()) as Character[];
  const charByName = new Map<string, Character>();
  for (const c of libChars) {
    if (isImageTo3dLibraryCharacter(c)) continue;
    const key = normPersonName(String(c.nickname || c.name || ''));
    if (key && !charByName.has(key)) charByName.set(key, c);
  }

  for (const ch of session.bible.characters || []) {
    const name = String(ch.name || '').trim();
    const imageUrl = String(ch.imageUrl || '').trim();
    const voiceUrl = characterVoiceSampleUrl(session, ch.character_id);
    if (!name || (!imageUrl && !voiceUrl)) continue;
    const hit = charByName.get(normPersonName(name));
    try {
      if (hit) {
        await api?.updateCharacter?.(hit.id, {
          ...(imageUrl ? { avatar: imageUrl } : {}),
          ...(voiceUrl ? { voiceClip: voiceUrl } : {}),
          ...(String(ch.prompt || '').trim()
            ? { imageDescription: String(ch.prompt).trim() }
            : {}),
        });
      } else {
        const created = await api?.createCharacter?.(
          name,
          name,
          imageUrl,
          undefined,
          undefined,
          voiceUrl || undefined,
          undefined,
          String(ch.prompt || '').trim() || undefined,
        );
        if (created?.id && voiceUrl && !created.voiceClip) {
          await api?.updateCharacter?.(created.id, { voiceClip: voiceUrl });
        }
      }
      charactersN += 1;
    } catch {
      failed += 1;
    }
  }

  const libScenes = (await api?.getScenes?.()) || [];
  const sceneByName = new Map<string, { id: string }>();
  for (const s of libScenes) {
    const key = normPersonName(String(s.nickname || s.name || ''));
    if (key && !sceneByName.has(key)) sceneByName.set(key, { id: s.id });
  }

  for (const sc of session.bible.scenes || []) {
    const name = String(sc.name || sc.location || '').trim();
    const imageUrl = String(sc.imageUrl || '').trim();
    if (!name || !imageUrl) continue;
    const hit = sceneByName.get(normPersonName(name));
    try {
      if (hit) {
        await api?.updateScene?.(hit.id, { nickname: name, normalImageUrl: imageUrl });
      } else {
        await api?.registerScene?.({ nickname: name, normalImageUrl: imageUrl });
      }
      scenesN += 1;
    } catch {
      failed += 1;
    }
  }

  return { characters: charactersN, scenes: scenesN, failed };
}

export function DramaCharacterLibraryPickModal({
  open,
  isDark,
  session,
  projectId,
  targetCharacterId,
  prefer = 'both',
  onClose,
  onApply,
}: {
  open: boolean;
  isDark: boolean;
  session: DramaDirectorSession;
  projectId?: string | null;
  /** 有则写入该卡片；无则按同名批量写入本集人物 */
  targetCharacterId?: string | null;
  prefer?: DramaLibraryPickMode;
  onClose: () => void;
  onApply: (next: DramaDirectorSession, summary: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [castItems, setCastItems] = useState<DramaLibraryPickItem[]>([]);
  const [libraryItems, setLibraryItems] = useState<DramaLibraryPickItem[]>([]);
  const [checks, setChecks] = useState<CheckState>({});
  const targetId = String(targetCharacterId || '').trim();
  const targetName =
    session.bible.characters.find((c) => c.character_id === targetId)?.name || '';

  const sessionItems = useMemo(
    () => listSessionCharacterPicks(session, targetId || undefined),
    [session, targetId],
  );
  const items = useMemo(
    () => [...castItems, ...libraryItems, ...sessionItems],
    [castItems, libraryItems, sessionItems],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const targetKey = normPersonName(targetName);
    const sessionSeed = listSessionCharacterPicks(session, targetId || undefined);
    setCastItems([]);
    setLibraryItems([]);
    setChecks(defaultPickChecks(sessionSeed, targetKey, prefer));
    setLoading(true);

    const mergeIncoming = (incoming: DramaLibraryPickItem[], kind: 'cast' | 'library') => {
      if (cancelled) return;
      if (kind === 'cast') setCastItems(incoming);
      else setLibraryItems(incoming);
      setChecks((prev) => {
        const extra = defaultPickChecks(incoming, targetKey, prefer);
        return { ...extra, ...prev };
      });
    };

    const castP = loadDramaCastLibraryPicks(projectId).then((castList) => {
      mergeIncoming(castList, 'cast');
    });
    const libP = loadDramaCharacterLibraryPicks().then((list) => {
      mergeIncoming(list, 'library');
    });
    void Promise.allSettled([castP, libP]).then(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // 只在打开时读一次名册，避免勾选过程被 session 刷新冲掉
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefer, targetId, targetName, projectId]);

  if (!open || typeof document === 'undefined') return null;

  const muted = isDark ? 'text-white/55' : 'text-gray-500';
  const card = isDark ? 'bg-zinc-900 ring-white/10 text-white' : 'bg-white ring-gray-200 text-gray-900';
  const selectedCount = Object.values(checks).filter((c) => c.image || c.voice).length;

  const toggle = (id: string, field: 'image' | 'voice', enabled: boolean) => {
    if (!enabled) return;
    setChecks((prev) => {
      const cur = prev[id] || { image: false, voice: false };
      const turnedOn = !cur[field];
      if (!targetId) {
        return { ...prev, [id]: { ...cur, [field]: turnedOn } };
      }
      const next: CheckState = { ...prev };
      if (turnedOn) {
        for (const key of Object.keys(next)) {
          if (key === id) continue;
          next[key] = { ...(next[key] || { image: false, voice: false }), [field]: false };
        }
      }
      next[id] = { ...cur, [field]: turnedOn };
      return next;
    });
  };

  const apply = () => {
    const selected = items
      .map((it) => ({
        it,
        image: !!checks[it.id]?.image && !!it.imageUrl,
        voice: !!checks[it.id]?.voice && !!it.voiceUrl,
      }))
      .filter((x) => x.image || x.voice);
    if (!selected.length) return;
    if (targetId) {
      const imagePick = selected.find((x) => x.image);
      const voicePick = selected.find((x) => x.voice);
      const next = applyDramaLibraryPickToCharacter(session, targetId, {
        imageUrl: imagePick?.it.imageUrl,
        voiceUrl: voicePick?.it.voiceUrl,
      });
      const bits = [
        imagePick ? `形象「${imagePick.it.name}」` : '',
        voicePick ? `声音「${voicePick.it.name}」` : '',
      ].filter(Boolean);
      onApply(next, `已写入 ${targetName || '本角色'}：${bits.join(' + ')}`);
      onClose();
      return;
    }
    const { session: next, applied, created, injected } = putDramaLibraryPicksIntoScript(
      session,
      selected.map((x) => ({
        name: x.it.name,
        imageUrl: x.image ? x.it.imageUrl : '',
        voiceUrl: x.voice ? x.it.voiceUrl : '',
      })),
    );
    const bits = [
      created ? `新建 ${created} 人` : '',
      applied - created > 0 ? `补齐 ${applied - created} 人形象/声音` : '',
      injected.length ? `剧本补入 ${injected.join('、')}` : '',
    ].filter(Boolean);
    onApply(
      next,
      bits.length ? `已写入本页：${bits.join('，')}` : `已写入本页 ${applied} 人`,
    );
    onClose();
  };

  return createPortal(
    <div
      className={`fixed inset-0 z-[100002] flex items-center justify-center p-4 ${
        isDark ? 'bg-black/70' : 'bg-black/45'
      }`}
      onClick={onClose}
    >
      <div
        className={`flex h-[min(72vh,620px)] w-[min(70vw,820px)] flex-col overflow-hidden rounded-2xl shadow-2xl ring-1 ${card}`}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className={`flex items-start justify-between gap-3 border-b px-4 py-3 ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <div>
            <div className="text-[16px] font-medium">
              {targetId ? `勾选已有人物与声音` : '勾选本剧人物库（写入本页）'}
            </div>
            <div className={`mt-0.5 text-[12px] ${muted}`}>
              {targetId
                ? `写入「${targetName || '当前角色'}」。优先用本剧人物库；形象、声音可分别勾选。`
                : '勾选后留在素材准备：有同名则补形象/声音，没有则在本页新建人物卡。'}
            </div>
          </div>
          <button
            type="button"
            className={`nodrag rounded-md px-2 py-1 text-[13px] ${isDark ? 'bg-white/10' : 'bg-gray-100'}`}
            onClick={onClose}
          >
            关闭
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar-dark p-3">
          {loading && items.length === 0 ? (
            <div className={`py-10 text-center text-[13px] ${muted}`}>正在读取人物库…</div>
          ) : items.length === 0 ? (
            <div className={`px-2 py-10 text-center text-[13px] leading-relaxed ${muted}`}>
              还没有可勾选的形象或声音。请先在本集生成/上传定妆图，或从全局角色库选用。
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {loading ? (
                <div className={`col-span-full text-[12px] ${muted}`}>正在读取人物库…</div>
              ) : null}
              {castItems.length ? (
                <div className={`col-span-full text-[12px] font-medium ${muted}`}>本剧人物库</div>
              ) : null}
              {castItems.map((item) => (
                <DramaLibraryPickRow
                  key={item.id}
                  item={item}
                  isDark={isDark}
                  checked={checks[item.id] || { image: false, voice: false }}
                  onToggle={toggle}
                />
              ))}
              {libraryItems.length ? (
                <div className={`col-span-full mt-1 text-[12px] font-medium ${muted}`}>全局角色库</div>
              ) : null}
              {libraryItems.map((item) => (
                <DramaLibraryPickRow
                  key={item.id}
                  item={item}
                  isDark={isDark}
                  checked={checks[item.id] || { image: false, voice: false }}
                  onToggle={toggle}
                />
              ))}
              {sessionItems.length ? (
                <div className={`col-span-full mt-1 text-[12px] font-medium ${muted}`}>本集已有卡片</div>
              ) : null}
              {sessionItems.map((item) => (
                <DramaLibraryPickRow
                  key={item.id}
                  item={item}
                  isDark={isDark}
                  checked={checks[item.id] || { image: false, voice: false }}
                  onToggle={toggle}
                />
              ))}
            </div>
          )}
        </div>
        <div
          className={`flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3 ${
            isDark ? 'border-white/10' : 'border-gray-200'
          }`}
        >
          <div className={`text-[12px] ${muted}`}>已勾选 {selectedCount} 项</div>
          <button
            type="button"
            className={`nodrag rounded-lg px-3.5 py-1.5 text-[14px] font-medium disabled:opacity-40 ${
              isDark ? 'bg-sky-500/85 text-white' : 'bg-gray-900 text-white'
            }`}
            disabled={!selectedCount}
            onClick={apply}
          >
            {targetId ? '写入本角色' : '写入本页'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function DramaLibraryPickRow({
  item,
  isDark,
  checked,
  onToggle,
}: {
  item: DramaLibraryPickItem;
  isDark: boolean;
  checked: { image: boolean; voice: boolean };
  onToggle: (id: string, field: 'image' | 'voice', enabled: boolean) => void;
}) {
  const hasImage = !!item.imageUrl;
  const hasVoice = !!item.voiceUrl;
  return (
    <div
      className={`flex flex-col gap-2 rounded-xl p-2 ${
        isDark ? 'bg-white/[0.05]' : 'bg-gray-50'
      }`}
    >
      {hasImage ? (
        <div className={`overflow-hidden rounded-lg ${isDark ? 'bg-black/50' : 'bg-gray-200'}`}>
          <AssetLibLazyThumb
            src={toDisplayableDramaMediaUrl(item.imageUrl)}
            className="aspect-[3/4] w-full"
            imgClassName="h-full w-full object-contain bg-black/20"
            maxEdge={640}
            alt=""
          />
        </div>
      ) : (
        <div
          className={`flex aspect-[9/16] w-full items-center justify-center overflow-hidden rounded-lg text-[13px] opacity-50 ${
            isDark ? 'bg-black/50' : 'bg-gray-200'
          }`}
        >
          无图
        </div>
      )}
      <div className="min-w-0 text-center">
        <div className="truncate text-[14px] font-medium">{item.name}</div>
        <div className={`text-[12px] ${isDark ? 'text-white/45' : 'text-gray-500'}`}>
          {item.source === 'cast' ? '本剧人物库' : item.source === 'library' ? '全局角色库' : '本集卡片'}
          {hasVoice ? ' · 有声音' : ' · 无声音'}
        </div>
      </div>
      <div className="flex items-center justify-center gap-2">
        <label
          className={`nodrag flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12px] ${
            hasImage ? '' : 'opacity-35'
          } ${isDark ? 'bg-white/8' : 'bg-white'}`}
        >
          <input
            type="checkbox"
            className="nodrag"
            disabled={!hasImage}
            checked={!!checked.image}
            onChange={() => onToggle(item.id, 'image', hasImage)}
          />
          形象
        </label>
        <label
          className={`nodrag flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12px] ${
            hasVoice ? '' : 'opacity-35'
          } ${isDark ? 'bg-white/8' : 'bg-white'}`}
        >
          <input
            type="checkbox"
            className="nodrag"
            disabled={!hasVoice}
            checked={!!checked.voice}
            onChange={() => onToggle(item.id, 'voice', hasVoice)}
          />
          声音
        </label>
      </div>
    </div>
  );
}
