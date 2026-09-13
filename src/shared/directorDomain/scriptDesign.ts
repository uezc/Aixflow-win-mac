/**
 * 脚本设计：本地挂上「素材匹配 + 视觉风格 + 小说原文」。
 * 不调用 LLM，不拆画面/对白/情绪，不填景别/运镜。
 */

import { deriveCharacterVisualAnchors } from './constraints.js';
import { resolveDramaCharacterIdByName } from './ensureAppearingCharacters.js';
import { getActiveEpisodeBible } from './episodeBible.js';
import type {
  DramaCharacter,
  DramaDirectorSession,
  DramaSceneAsset,
  DramaShotSuggestion,
} from './types.js';
import { scrubVisualStyleToLookAndColor } from './visualStyleLookColor.js';
import { getVisualStylePreset } from './visualStylePresets.js';

export type DramaAssetMatchEntry = {
  kind: 'character' | 'scene' | 'prop' | 'creature';
  name: string;
  /** 括号里的识别点，如「红发黑卫衣冷脸」；没有就不写括号 */
  look?: string;
};

function shortAnchors(parts: string[], max = 3): string {
  const seen: string[] = [];
  for (const raw of parts) {
    const t = trimLine(raw).replace(/[。；;，,]+$/g, '');
    if (!t) continue;
    if (seen.some((x) => x === t || x.includes(t) || t.includes(x))) continue;
    seen.push(t);
    if (seen.length >= max) break;
  }
  return seen.join('');
}

export function characterRefLook(ch?: DramaCharacter): string {
  if (!ch) return '';
  return shortAnchors(
    [
      ...deriveCharacterVisualAnchors(ch),
      ch.visual?.hair,
      ch.hair_color ? `${ch.hair_color}发` : '',
      ch.visual?.clothing,
      ch.visual?.face,
      ch.visual?.specialFeature,
    ],
    3,
  );
}

export function sceneRefLook(scene?: DramaSceneAsset): string {
  if (!scene) return '';
  return shortAnchors(
    [
      ...(scene.fixed_elements || []),
      scene.lighting,
      scene.light_sources,
      scene.mood,
      scene.color_palette,
    ],
    3,
  );
}

/** 【参考】图1=江澈角色卡（红发黑卫衣冷脸）；图2=电竞直播间（RGB灯+蓝屏） */
export function formatDramaAssetMatchEntries(entries: DramaAssetMatchEntry[]): string {
  const parts: string[] = [];
  let n = 1;
  for (const e of entries) {
    const name = trimLine(e.name);
    if (!name) continue;
    const look = trimLine(e.look);
    const title =
      e.kind === 'character'
        ? look
          ? `${name}角色卡（${look}）`
          : `${name}角色卡`
        : look
          ? `${name}（${look}）`
          : name;
    parts.push(`图${n}=${title}`);
    n += 1;
  }
  return parts.length ? `【参考】${parts.join('；')}` : '';
}

function trimLine(s: unknown): string {
  return String(s || '').trim();
}

export function resolveDramaScriptDesignVisualStyle(session: DramaDirectorSession): string {
  const pvb = session.bible?.projectVisualBible;
  const dna = pvb?.visualDNA || session.bible?.visualDNA;
  const preset = getVisualStylePreset(pvb?.presetId || dna?.presetId || '');
  const short = scrubVisualStyleToLookAndColor(
    String(
      preset?.visualDNA?.promptTemplateZh ||
        preset?.visualDNA?.promptTemplate ||
        pvb?.stylePrompt ||
        dna?.generatedPrompt ||
        session.bible?.visual?.style ||
        '',
    ).trim(),
  );
  return short;
}

export function isDramaScriptDesignShotTable(suggestions: DramaShotSuggestion[] | undefined): boolean {
  return (suggestions || []).some(
    (s) => trimLine(s.asset_match) || trimLine(s.visual_style),
  );
}

function findCharacter(session: DramaDirectorSession, name: string): DramaCharacter | undefined {
  const id = resolveDramaCharacterIdByName(session.bible.characters || [], name);
  if (id) return (session.bible.characters || []).find((c) => c.character_id === id);
  return undefined;
}

function findSceneAsset(session: DramaDirectorSession, sug: DramaShotSuggestion): DramaSceneAsset | undefined {
  const scenes = session.bible.scenes || [];
  if (!scenes.length) return undefined;
  const keys = [sug.environment, sug.scene].map(trimLine).filter(Boolean);
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  for (const key of keys) {
    const exact = scenes.find((sc) => sc.name === key || sc.location === key);
    if (exact) return exact;
  }
  for (const key of keys) {
    const nk = norm(key);
    if (!nk) continue;
    const loose = scenes.find((sc) => {
      const n = norm(sc.name);
      const l = norm(sc.location);
      return (n && (nk.includes(n) || n.includes(nk))) || (l && (nk.includes(l) || l.includes(nk)));
    });
    if (loose) return loose;
  }
  return undefined;
}

function displayPersonName(raw: string, ch?: DramaCharacter): string {
  if (ch && trimLine(ch.name)) return trimLine(ch.name);
  return trimLine(raw).replace(/^C-\d+\s+/, '') || trimLine(raw);
}

function sceneDisplayName(session: DramaDirectorSession, sug: DramaShotSuggestion): string {
  const env = trimLine(sug.environment);
  if (env) return env;
  const bible = getActiveEpisodeBible(session);
  const heading = trimLine(sug.scene);
  const orig = (bible.original_scenes || []).find((sc) => {
    const label = trimLine(sc.original_heading).replace(/^#{1,6}\s*/, '');
    return (label && heading.includes(label)) || (sc.location && heading.includes(sc.location));
  });
  return trimLine(orig?.location) || heading || '场景';
}

export function composeDramaScriptDesignAssetMatch(
  session: DramaDirectorSession,
  sug: DramaShotSuggestion,
): string {
  const entries: DramaAssetMatchEntry[] = [];
  const seen = new Set<string>();
  const push = (entry: DramaAssetMatchEntry) => {
    const name = trimLine(entry.name);
    if (!name) return;
    const key = `${entry.kind}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ ...entry, name });
  };
  for (const raw of sug.cast_names || []) {
    const ch = findCharacter(session, raw);
    push({
      kind: 'character',
      name: displayPersonName(raw, ch),
      look: characterRefLook(ch),
    });
  }
  const sceneName = sceneDisplayName(session, sug);
  const scene = findSceneAsset(session, sug);
  push({
    kind: 'scene',
    name: trimLine(scene?.name || scene?.location || sceneName),
    look: sceneRefLook(scene),
  });
  for (const raw of sug.prop_names || []) {
    push({ kind: 'prop', name: raw });
  }
  for (const raw of sug.creature_names || []) {
    push({ kind: 'creature', name: raw });
  }
  return formatDramaAssetMatchEntries(entries);
}

/** 在已有拆分段上挂素材匹配与视觉风格，原文（action）不改写。 */
export function applyDramaScriptDesign(
  session: DramaDirectorSession,
  suggestions?: DramaShotSuggestion[],
): DramaShotSuggestion[] {
  const list = suggestions || getActiveEpisodeBible(session).shot_suggestions || [];
  const style = resolveDramaScriptDesignVisualStyle(session);
  return list.map((s) => ({
    ...s,
    asset_match: composeDramaScriptDesignAssetMatch(session, s),
    visual_style: style,
    size: '',
    camera: '',
    move: '',
  }));
}
