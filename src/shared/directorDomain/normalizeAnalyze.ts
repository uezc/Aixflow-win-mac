/**
 * 将 V2 分析 JSON 归一为 DramaDirectorSession
 * analyze 阶段：写入 bible + EpisodeBible + ProductionPlan + Visual Events
 * 不写入 shots / 正式 DramaShot；分镜建议由 Shot Planning 阶段写入。
 */

import { dramaNewId } from './ids.js';
import {
  attachEpisodeBibleAndPlan,
  createEmptyDramaShotSuggestion,
  deriveEpisodeBibleAndPlan,
} from './episodeBible.js';
import {
  createEmptyDramaBible,
  createEmptyDramaCharacter,
  createEmptyDramaCharacterCostume,
  createEmptyDramaCreature,
  createEmptyDramaNodeMeta,
  createEmptyDramaOrganization,
  createEmptyDramaProp,
  createEmptyDramaSceneAsset,
  createEmptyDramaSceneBeat,
  createEmptyDramaSession,
  createEmptyDramaVoice,
  parseDurationSec,
} from './factories.js';
import {
  ensureDramaCharacterPromptGenreLock,
  resolveDramaGenreLock,
} from './genreLock.js';
import {
  composeDramaCharacterDesignPrompt,
  composeDramaSceneDesignPrompt,
  composeDramaVoiceDesign,
  composeDramaVoiceSampleLine,
} from './characterDesignPrompt.js';
import {
  coreDramaPersonName,
  extractCharacterNamesFromDialogueBlob,
  extractCharacterNamesFromScriptText,
  isDramaAnimalCreatureName,
  isDramaCharacterNameAcceptable,
  isDramaCharacterNamePlausible,
  mergeUniqueNames,
  namesLikelySameDramaPerson,
  salvageDramaPersonName,
  canonicalizeDramaCreatureName,
  composeDramaCreatureDesignPrompt,
  dramaCreaturePromptLooksHuman,
} from './extractCastFromScript.js';
import { ensureAppearingCharactersInBible } from './ensureAppearingCharacters.js';
import { ensureCharacterCostumes } from './characterCostumes.js';
import { collectDramaCharacterScriptLines, ensureVoiceSampleTexts } from './ensureVoiceSampleTexts.js';
import { extractJsonObject as extractPipelineJsonObject } from '../directorPipeline/normalize.js';
import {
  mergeAnalyzeCharacters,
  mergeAnalyzeCreatures,
  mergeAnalyzeOrganizations,
  mergeAnalyzeProps,
  mergeAnalyzeScenes,
  mergeAnalyzeVoices,
} from './mergeAnalyzeBible.js';
import { dedupeDramaPropsByKind } from './pruneUnusedAssets.js';
import {
  assignDramaVisualEventPriorities,
  createEmptyDramaVisualEvent,
  normalizeDramaDramaticPurpose,
  normalizeDramaEmotion,
  normalizeDramaEventId,
  normalizeDramaVisualEventKind,
  recommendDramaShotPlanDurationSec,
} from './shotPlanning.js';
import {
  mergeProgramAndLlmVisualEvents,
  sanitizeLlmSourceSegmentIds,
} from './mergeDramaVisualEvents.js';
import {
  dramaActiveEpisodeSourceText,
  resolveDramaProjectSeriesName,
} from './episodes.js';
import type {
  DramaDirectorSession,
  DramaSceneBeat,
  DramaShotSuggestion,
} from './types.js';
import { normalizeDramaShotTimeOfDay } from './types.js';

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function parseWhoField(row: Record<string, unknown>): string {
  if (Array.isArray(row.who)) return row.who.map((x) => str(x)).filter(Boolean).join('、');
  return str(row.who);
}

function pickFirstArray(obj: Record<string, unknown>, keys: string[]): unknown[] {
  const lower = new Map(Object.keys(obj).map((k) => [k.toLowerCase(), k]));
  for (const key of keys) {
    const hit = obj[key] ?? (lower.has(key.toLowerCase()) ? obj[lower.get(key.toLowerCase())!] : undefined);
    if (Array.isArray(hit)) return hit;
  }
  return [];
}

function scoreAnalyzePayload(o: Record<string, unknown>): number {
  const characters = pickFirstArray(o, ['characters', 'character', 'cast', 'roles', '人物', '角色']);
  const beats = pickFirstArray(o, ['scene_beats', 'scenebeats', 'beats', '场次']);
  const events = pickFirstArray(o, [
    'visual_events',
    'visualevents',
    'events',
    'visual_event',
    '视觉事件',
  ]);
  const scenes = pickFirstArray(o, ['scenes', 'scene', 'locations', '场景']);
  const namedChars = characters.filter(
    (c) => isObj(c) && !!(str(c.name) || str(c['姓名']) || str(c['角色名'])),
  );
  return namedChars.length * 4 + beats.length * 3 + events.length * 3 + scenes.length;
}

function canonicalizeAnalyzeJson(o: Record<string, unknown>): Record<string, unknown> {
  const characters = pickFirstArray(o, ['characters', 'character', 'cast', 'roles', '人物', '角色']);
  const scenes = pickFirstArray(o, ['scenes', 'scene', 'locations', '场景']);
  const scene_beats = pickFirstArray(o, ['scene_beats', 'sceneBeats', 'scenebeats', 'beats', '场次']);
  const visual_events = pickFirstArray(o, [
    'visual_events',
    'visualEvents',
    'visualevents',
    'events',
    'visual_event',
    '视觉事件',
  ]);
  const props = pickFirstArray(o, ['props', 'prop', '道具']);
  const creatures = pickFirstArray(o, ['creatures', 'creature', '生物']);
  return {
    ...o,
    ...(characters.length ? { characters } : {}),
    ...(scenes.length ? { scenes } : {}),
    ...(scene_beats.length ? { scene_beats } : {}),
    ...(visual_events.length ? { visual_events } : {}),
    ...(props.length ? { props } : {}),
    ...(creatures.length ? { creatures } : {}),
  };
}

function findRichestAnalyzeObject(root: unknown): Record<string, unknown> | null {
  let best: Record<string, unknown> | null = null;
  let bestScore = -1;
  const walk = (v: unknown, depth: number) => {
    if (depth > 6 || v == null) return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    if (!isObj(v)) return;
    const s = scoreAnalyzePayload(v);
    if (s > bestScore) {
      bestScore = s;
      best = v;
    }
    for (const child of Object.values(v)) walk(child, depth + 1);
  };
  walk(root, 0);
  if (best && bestScore > 0) return canonicalizeAnalyzeJson(best);
  return isObj(root) ? canonicalizeAnalyzeJson(root) : null;
}

function salvageAnalyzeJsonFromRaw(raw: string): Record<string, unknown> | null {
  const keys = ['"visual_events"', '"scene_beats"', '"characters"', '"visualEvents"', '"sceneBeats"'];
  let hit = -1;
  for (const k of keys) {
    const i = raw.indexOf(k);
    if (i >= 0 && (hit < 0 || i < hit)) hit = i;
  }
  if (hit < 0) return null;
  let start = raw.lastIndexOf('{', hit);
  if (start < 0) start = raw.indexOf('{');
  if (start < 0) return null;
  return repairTruncatedJsonObject(raw.slice(start));
}

function str(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function stripMarkdownFences(raw: string): string {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '');
  const fenceRe = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(s))) {
    const body = String(m[1] || '').trim();
    if (body) blocks.push(body);
  }
  if (blocks.length) {
    const withJson = blocks.find((b) => b.includes('{'));
    return (withJson || blocks[blocks.length - 1] || s).trim();
  }
  return s.replace(/^```(?:json|JSON)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function scanJsonStructure(s: string): {
  stack: Array<'{' | '['>;
  inString: boolean;
} {
  const stack: Array<'{' | '['> = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') stack.push('{');
    else if (ch === '[') stack.push('[');
    else if (ch === '}') {
      if (stack[stack.length - 1] === '{') stack.pop();
    } else if (ch === ']') {
      if (stack[stack.length - 1] === '[') stack.pop();
    }
  }
  return { stack, inString };
}

/** 结构层最后一个逗号位置（忽略字符串内） */
function lastStructuralCommaIndex(s: string): number {
  let inString = false;
  let escape = false;
  let last = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === ',') last = i;
  }
  return last;
}

function closeJsonFragment(fragment: string): string {
  let s = fragment;
  const { stack, inString } = scanJsonStructure(s);
  if (inString) s += '"';
  s = s.replace(/,\s*$/, '');
  s = s.replace(/,\s*"[^"]*"\s*:\s*$/, '');
  s = s.replace(/:\s*$/, ':null');
  s = s.replace(/,\s*$/, '');
  const rest = [...stack];
  while (rest.length) {
    const open = rest.pop();
    s += open === '{' ? '}' : ']';
  }
  // 尾逗号（补括号前可能残留）
  s = s.replace(/,\s*([}\]])/g, '$1');
  return s;
}

/** 截断 JSON：补全引号/括号；失败则逐级砍掉末尾残缺字段再试 */
function repairTruncatedJsonObject(text: string): Record<string, unknown> | null {
  let s = stripMarkdownFences(text);
  const start = s.indexOf('{');
  if (start < 0) return null;
  s = s.slice(start);

  for (let attempt = 0; attempt < 48; attempt++) {
    const repaired = closeJsonFragment(s);
    try {
      const p = JSON.parse(repaired);
      if (isObj(p)) return p;
    } catch {
      /* trim and retry */
    }
    const comma = lastStructuralCommaIndex(s);
    if (comma < 0) break;
    s = s.slice(0, comma);
  }
  return null;
}

/** 供冒烟/调试：从模型原文抽出分析 JSON 对象 */
export function extractDramaDomainAnalyzeJsonObject(
  text: unknown,
): Record<string, unknown> | null {
  return extractJsonObject(String(text || ''));
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const fromPipe = extractPipelineJsonObject(raw);
  const pickedPipe = findRichestAnalyzeObject(fromPipe);
  if (pickedPipe && scoreAnalyzePayload(pickedPipe) > 0) return pickedPipe;

  const candidate = stripMarkdownFences(raw);
  try {
    const p = JSON.parse(candidate);
    const picked = findRichestAnalyzeObject(p);
    if (picked && scoreAnalyzePayload(picked) > 0) return picked;
  } catch {
    /* continue */
  }

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const p = JSON.parse(candidate.slice(start, end + 1));
      const picked = findRichestAnalyzeObject(p);
      if (picked && scoreAnalyzePayload(picked) > 0) return picked;
    } catch {
      /* continue */
    }
  }

  const repaired = repairTruncatedJsonObject(candidate);
  const pickedRepaired = findRichestAnalyzeObject(repaired);
  if (pickedRepaired && scoreAnalyzePayload(pickedRepaired) > 0) return pickedRepaired;

  const salvaged = salvageAnalyzeJsonFromRaw(candidate);
  const pickedSalvage = findRichestAnalyzeObject(salvaged);
  if (pickedSalvage && scoreAnalyzePayload(pickedSalvage) > 0) return pickedSalvage;

  if (pickedPipe) return pickedPipe;
  if (pickedRepaired) return pickedRepaired;
  return isObj(fromPipe) ? canonicalizeAnalyzeJson(fromPipe) : null;
}

function formatDialogue(
  lines: { character_name?: string; character_id?: string; text?: string }[],
): string {
  return lines
    .map((d) => {
      const name = d.character_name || '';
      const text = d.text || '';
      if (!text) return '';
      return name ? `${name}：${text}` : text;
    })
    .filter(Boolean)
    .join(' / ');
}

export type NormalizeDramaDomainAnalyzeResult =
  | { ok: true; session: DramaDirectorSession; rawJson: string }
  | { ok: false; error: string; rawJson: string };

export function normalizeDramaDomainAnalyzeResult(
  text: unknown,
  base?: Partial<DramaDirectorSession>,
): NormalizeDramaDomainAnalyzeResult {
  const rawJson = String(text || '');
  const parsed = extractJsonObject(rawJson);
  if (!parsed) {
    const preview = rawJson.replace(/\s+/g, ' ').trim().slice(0, 120);
    const open = (rawJson.match(/\{/g) || []).length;
    const close = (rawJson.match(/\}/g) || []).length;
    const looksTruncated = open > 0 && open > close;
    return {
      ok: false,
      error: looksTruncated
        ? '分析 JSON 被截断（模型输出过长）。请重试分析，或换上下文更长的聊天模型'
        : `无法解析分析 JSON${preview ? `（开头：${preview}${rawJson.length > 120 ? '…' : ''}）` : ''}。请重试`,
      rawJson,
    };
  }

  const projectRaw = isObj(parsed.project) ? parsed.project : {};
  const charactersRaw = Array.isArray(parsed.characters) ? parsed.characters : [];
  const scenesRaw = Array.isArray(parsed.scenes) ? parsed.scenes : [];
  const propsRaw = Array.isArray(parsed.props) ? parsed.props : [];
  const creaturesRaw = Array.isArray(parsed.creatures) ? parsed.creatures : [];
  const orgsRaw = Array.isArray(parsed.organizations) ? parsed.organizations : [];
  const beatsRaw = Array.isArray(parsed.scene_beats) ? parsed.scene_beats : [];
  const visualEventsEarly = Array.isArray(parsed.visual_events) ? parsed.visual_events : [];

  const modelNamedChars = charactersRaw.filter(isObj).some((c) => str(c.name) || str(c['姓名']));
  const keys = Object.keys(parsed).slice(0, 12).join(', ');
  const modelGaveStructure =
    modelNamedChars || beatsRaw.length > 0 || visualEventsEarly.length > 0;
  const epIdHint = String(base?.active_episode_id || '').trim();
  const prevHint = epIdHint ? base?.episode_bibles?.[epIdHint] : undefined;
  const hasProgramOriginal = !!(
    (prevHint?.original_segments || []).length ||
    (prevHint?.visual_events || []).length ||
    (prevHint?.shot_suggestions || []).length
  );
  if (!modelGaveStructure && !hasProgramOriginal) {
    return {
      ok: false,
      error: `分析 JSON 缺少角色/场次/视觉事件（可能被截断成空壳${keys ? `，现有字段：${keys}` : ''}），请重试`,
      rawJson,
    };
  }

  const storyContextHint = [
    str(projectRaw.worldview),
    str(parsed.plot).slice(0, 160),
    str(projectRaw.style),
    str(projectRaw.era),
  ]
    .filter(Boolean)
    .join('；');
  const sourceText = dramaActiveEpisodeSourceText(base);
  const eraStyleHint = [str(projectRaw.style), str(projectRaw.era), str(projectRaw.visual_style)]
    .filter(Boolean)
    .join(' · ');

  let characters = charactersRaw
    .filter(isObj)
    .filter((c) => {
      const n = str(c.name) || str(c['姓名']);
      return !!n && !isDramaAnimalCreatureName(n);
    })
    .map((c) => {
    const name = str(c.name) || str(c['姓名']);
    const genderRaw = str(c.gender).toLowerCase() || str(c['性别']).toLowerCase();
    const gender =
      genderRaw === 'male' || genderRaw === '男'
        ? 'male'
        : genderRaw === 'female' || genderRaw === '女'
          ? 'female'
          : '';
    const visual = isObj(c.visual)
      ? {
          face: str(c.visual.face),
          hair: str(c.visual.hair),
          body: str(c.visual.body),
          clothing: str(c.visual.clothing),
          specialFeature: str(c.visual.specialFeature) || str(c.materials),
        }
      : {
          face: str(c.face),
          hair: str(c.hair),
          body: str(c.body) || str(c.build),
          clothing: str(c.clothing) || str(c.outfit),
          specialFeature: str(c.specialFeature) || str(c.materials),
        };
    const expression = str(c.expression) || str(c.default_expression);
    const materials = str(c.materials);
    const backstory = str(c.backstory);
    const prompt = composeDramaCharacterDesignPrompt({
      name,
      age: str(c.age),
      gender,
      role: str(c.role),
      identity: str(c.identity) || str(c.role),
      personality: str(c.personality),
      backstory,
      prompt: str(c.prompt),
      visual,
      expression,
      materials,
      storyContext: storyContextHint,
    });
    const costumesRaw = Array.isArray(c.costumes) ? c.costumes : [];
    const costumes = costumesRaw
      .filter(isObj)
      .map((x, i) =>
        createEmptyDramaCharacterCostume({
          name: str(x.name) || str(x.label) || (i === 0 ? '默认服装' : `装扮${i + 1}`),
          prompt: str(x.prompt) || str(x.clothing) || str(x.description),
          tag: str(x.tag) || str(x.kind),
          active: i === 0,
        }),
      );
    return createEmptyDramaCharacter({
      name,
      age: str(c.age),
      gender: gender as any,
      identity: str(c.identity) || str(c.role),
      role: str(c.role),
      personality: str(c.personality),
      backstory,
      prompt,
      visual,
      states: expression ? { normal: expression, battle: '', injured: '' } : undefined,
      costumes,
    });
  }).map((c) => {
    if (isDramaCharacterNameAcceptable(c.name, sourceText)) return c;
    const salvaged = salvageDramaPersonName(c.name, sourceText);
    return salvaged ? { ...c, name: salvaged } : null;
  }).filter((c): c is NonNullable<typeof c> => !!c);

  characters = mergeAnalyzeCharacters(characters, base?.bible?.characters)
    .map((c) => {
      if (isDramaCharacterNameAcceptable(c.name, sourceText)) return c;
      const salvaged = salvageDramaPersonName(c.name, sourceText);
      return salvaged ? { ...c, name: salvaged } : null;
    })
    .filter((c): c is NonNullable<typeof c> => !!c);

  const nameToId = new Map<string, string>();
  const registerName = (name: string, id: string) => {
    const n = String(name || '').trim();
    if (!n || !id) return;
    nameToId.set(n, id);
    nameToId.set(n.replace(/\s+/g, '').toLowerCase(), id);
    const core = coreDramaPersonName(n);
    if (core) {
      nameToId.set(core, id);
      nameToId.set(core.replace(/\s+/g, '').toLowerCase(), id);
      if (core.length === 3) {
        const given = core.slice(1);
        if (given.length >= 2 && !nameToId.has(given)) nameToId.set(given, id);
      }
    }
  };
  for (const c of characters) registerName(c.name, c.character_id);

  const resolveNameId = (name: string): string => {
    const n = String(name || '').trim();
    if (!n) return '';
    const exact =
      nameToId.get(n) ||
      nameToId.get(n.replace(/\s+/g, '').toLowerCase()) ||
      nameToId.get(coreDramaPersonName(n)) ||
      nameToId.get(coreDramaPersonName(n).replace(/\s+/g, '').toLowerCase());
    if (exact) return exact;
    const hit = characters.find((c) => namesLikelySameDramaPerson(c.name, n));
    return hit?.character_id || '';
  };

  let scenes = scenesRaw.filter(isObj).map((s) =>
    createEmptyDramaSceneAsset({
      name: str(s.name),
      location: str(s.location) || str(s.name),
      time_default: str(s.time_default),
      weather_default: str(s.weather_default),
      mood: str(s.mood),
      prompt: composeDramaSceneDesignPrompt({
        name: str(s.name),
        location: str(s.location) || str(s.name),
        mood: str(s.mood),
        time_default: str(s.time_default),
        weather_default: str(s.weather_default),
        prompt: str(s.prompt),
        spatial_structure: str(s.spatial_structure),
        lighting: str(s.lighting),
        architecture: str(s.architecture),
        materials: str(s.materials),
        kind: str(s.kind) || str(s.int_ext),
        fixed_elements: Array.isArray(s.fixed_elements)
          ? s.fixed_elements.map((x) => str(x)).filter(Boolean)
          : [],
        storyContext: storyContextHint,
        eraStyle: eraStyleHint,
      }),
      spatial_structure: str(s.spatial_structure),
      architecture: str(s.architecture),
      materials: str(s.materials),
      kind: str(s.kind) || str(s.int_ext),
      fixed_elements: Array.isArray(s.fixed_elements)
        ? s.fixed_elements.map((x) => str(x)).filter(Boolean)
        : [],
      camera_reference: str(s.camera_reference),
      lighting: str(s.lighting),
      weather: str(s.weather) || str(s.weather_default),
    }),
  );
  scenes = mergeAnalyzeScenes(scenes, base?.bible?.scenes);
  const locToId = new Map<string, string>();
  for (const sc of scenes) {
    locToId.set(sc.name, sc.scene_id);
    locToId.set(sc.location, sc.scene_id);
  }

  const props = dedupeDramaPropsByKind(
    mergeAnalyzeProps(
      propsRaw.filter(isObj).map((p) =>
        createEmptyDramaProp({
          name: str(p.name),
          description: str(p.description),
          prompt: str(p.prompt) || str(p.description),
        }),
      ),
      base?.bible?.props,
    ),
    5,
  );

  const creatures = mergeAnalyzeCreatures(
    [
      ...creaturesRaw.filter(isObj).map((c) => {
        const name = canonicalizeDramaCreatureName(str(c.name)) || str(c.name);
        const appearance = str(c.appearance);
        const behavior = str(c.behavior);
        const rawPrompt = str(c.prompt) || appearance;
        return createEmptyDramaCreature({
          name,
          appearance,
          behavior,
          prompt: composeDramaCreatureDesignPrompt({
            name,
            appearance,
            behavior,
            prompt: dramaCreaturePromptLooksHuman(rawPrompt) ? '' : rawPrompt,
          }),
        });
      }),
      ...charactersRaw
        .filter(isObj)
        .filter((c) => isDramaAnimalCreatureName(str(c.name)))
        .map((c) => {
          const name = canonicalizeDramaCreatureName(str(c.name)) || str(c.name);
          return createEmptyDramaCreature({
            name,
            appearance: '',
            prompt: composeDramaCreatureDesignPrompt({ name }),
          });
        }),
    ],
    base?.bible?.creatures,
  );

  const organizations = mergeAnalyzeOrganizations(
    orgsRaw.filter(isObj).map((o) =>
      createEmptyDramaOrganization({
        name: str(o.name),
        kind: str(o.kind) || str(o.type) || '势力',
        description: str(o.description),
        visual_traits: str(o.visual_traits) || str(o.prompt),
      }),
    ),
    base?.bible?.organizations,
  );

  const incomingVoices = characters.map((c) => {
    const raw =
      charactersRaw.filter(isObj).find((x) => {
        const n = str(x.name);
        return n === c.name || namesLikelySameDramaPerson(n, c.name);
      }) || {};
    const voiceObj = isObj(raw.voice) ? raw.voice : null;
    const designed = composeDramaVoiceDesign({
      name: c.name,
      age: c.age,
      gender: c.gender,
      role: c.role,
      personality: c.personality,
      backstory: c.backstory,
      timbre: str(raw.timbre) || str(voiceObj?.timbre) || str(raw.voice_timbre),
      voiceStyle:
        str(raw.voiceStyle) ||
        str(raw.voice_style) ||
        str(voiceObj?.voiceStyle) ||
        str(voiceObj?.style),
      language_style: str(raw.language_style) || str(voiceObj?.language_style),
      emotion_range: str(raw.emotion_range) || str(voiceObj?.emotion_range),
    });
    const llmSample =
      str(raw.sample_text) ||
      str(raw.sampleText) ||
      str(voiceObj?.sample_text) ||
      str(voiceObj?.sampleText);
    const scriptLines = base
      ? collectDramaCharacterScriptLines(base as DramaDirectorSession, { characterName: c.name })
      : '';
    const sample_text = composeDramaVoiceSampleLine({
      name: c.name,
      age: c.age,
      role: c.role,
      identity: c.identity,
      personality: c.personality,
      gender: c.gender,
      timbre: designed.timbre,
      voiceStyle: designed.voiceStyle,
      language_style: designed.language_style,
      emotion_range: designed.emotion_range,
      dialogueHint: scriptLines || llmSample,
      forceScriptLines: Boolean(scriptLines),
    });
    return createEmptyDramaVoice({
      character_id: c.character_id,
      timbre: designed.timbre,
      voiceStyle: designed.voiceStyle,
      language: 'zh',
      language_style: designed.language_style,
      emotion_range: designed.emotion_range,
      sample_text,
    });
  });
  const voices = mergeAnalyzeVoices(incomingVoices, characters, base?.bible?.voices);
  for (const c of characters) {
    const v = voices.find((x) => x.character_id === c.character_id);
    if (v) c.voice_id = v.voice_id;
  }

  const plot = str(parsed.plot);
  const bible = createEmptyDramaBible({
    project: {
      project_id: String(base?.bible?.project?.project_id || '').trim() || dramaNewId('proj'),
      name: resolveDramaProjectSeriesName(
        str(projectRaw.name),
        String(base?.bible?.project?.name || ''),
      ),
      type: str(projectRaw.type) || '竖屏短剧',
      style: str(projectRaw.style),
      worldview: str(projectRaw.worldview) || plot.slice(0, 200),
      visual_style: str(projectRaw.visual_style),
      color_style: str(projectRaw.color_style),
      references: Array.isArray(projectRaw.references)
        ? projectRaw.references.map((x) => str(x)).filter(Boolean)
        : [],
      era: str(projectRaw.era),
    },
    story: {
      worldview: str(projectRaw.worldview) || plot.slice(0, 200),
      era: str(projectRaw.era),
      rules: Array.isArray(parsed.rules)
        ? parsed.rules.map((x) => str(x)).filter(Boolean)
        : [],
      forbidden_elements: Array.isArray(parsed.forbidden_elements)
        ? parsed.forbidden_elements.map((x) => str(x)).filter(Boolean)
        : [],
      synopsis: plot,
    },
    visual: {
      style: str(projectRaw.visual_style) || str(projectRaw.style),
      color: str(projectRaw.color_style),
      camera: str(projectRaw.camera),
      lighting: str(projectRaw.lighting),
      referenceWorks: Array.isArray(projectRaw.references)
        ? projectRaw.references.map((x) => str(x)).filter(Boolean)
        : [],
      negativePrompt: str(projectRaw.negativePrompt) || str(parsed.negativePrompt),
    },
    sound: {
      voiceStyle: str(parsed.voiceStyle) || '',
      emotionRange: str(parsed.emotionRange) || '',
      ambientSound: Array.isArray(parsed.ambientSound)
        ? parsed.ambientSound.map((x) => str(x)).filter(Boolean)
        : [],
      musicStyle: str(parsed.musicStyle) || '',
    },
    // 保留用户在 Visual DNA / Project Visual Bible 中的整片视觉设定（分析不覆盖）
    visualDNA: base?.bible?.visualDNA,
    projectVisualBible: base?.bible?.projectVisualBible,
    plot,
    relationships: str(parsed.relationships),
    script_keywords: Array.isArray(parsed.script_keywords)
      ? parsed.script_keywords.map((x) => str(x)).filter(Boolean)
      : [],
    characters,
    scenes,
    props,
    creatures,
    voices,
    organizations,
  });

  const sceneNoToBeat = new Map<string, DramaSceneBeat>();
  const scene_beats: DramaSceneBeat[] = [];
  for (const b of beatsRaw.filter(isObj)) {
    const scene_no = str(b.scene_no) || '1';
    const location_name = str(b.location_name);
    const cast_names = Array.isArray(b.cast_names)
      ? b.cast_names
          .map((x) => salvageDramaPersonName(str(x), sourceText) || str(x))
          .filter((n) => isDramaCharacterNameAcceptable(n, sourceText))
      : [];
    const beat = createEmptyDramaSceneBeat({
      scene_no,
      location_name,
      scene_asset_id: locToId.get(location_name) || '',
      int_ext: str(b.int_ext),
      day_night: str(b.day_night),
      weather: str(b.weather),
      cast_ids: cast_names.map((n) => resolveNameId(n)).filter(Boolean),
      dramatic_goal: str(b.dramatic_goal),
      emotion: str(b.emotion),
    });
    sceneNoToBeat.set(scene_no, beat);
    scene_beats.push(beat);
  }

  // LLM 禁止生成 Shot；程序一场一镜建议必须保留
  const epIdForOriginal = String(base?.active_episode_id || '').trim();
  const prevEpBibleEarly = epIdForOriginal ? base?.episode_bibles?.[epIdForOriginal] : undefined;
  const allowedSegmentIds = new Set(
    (prevEpBibleEarly?.original_segments || []).map((s) => String(s.segment_id || '').trim()).filter(Boolean),
  );
  const programVisualEvents = Array.isArray(prevEpBibleEarly?.visual_events)
    ? prevEpBibleEarly!.visual_events
    : [];
  const shotSuggestions: DramaShotSuggestion[] = Array.isArray(prevEpBibleEarly?.shot_suggestions)
    ? [...prevEpBibleEarly!.shot_suggestions]
    : [];

  const visualEventsRaw = Array.isArray(parsed.visual_events) ? parsed.visual_events : [];
  const mergeWarnings: string[] = [];
  const llmVisualEvents = assignDramaVisualEventPriorities(
    visualEventsRaw.filter(isObj).map((row, idx) => {
      const event_id = normalizeDramaEventId(row.id || row.event_id || row.i || idx + 1);
      const source_segment_ids = sanitizeLlmSourceSegmentIds(
        row.source_segment_ids ?? row.sourceSegmentIds,
        allowedSegmentIds,
        mergeWarnings,
        `LLM VE ${event_id}`,
      );
      return createEmptyDramaVisualEvent({
        event_id,
        index: Number(row.i) || Number(row.index) || idx + 1,
        location: str(row.loc) || str(row.location),
        kind: normalizeDramaVisualEventKind(row.kind),
        who: parseWhoField(row),
        action: str(row.action),
        expression: str(row.expression),
        emotion: normalizeDramaEmotion(row.emotion),
        see: str(row.see) || str(row.visual_focus),
        cut: str(row.cut),
        position: str(row.position),
        source_segment_ids,
      });
    }),
    visualEventsRaw.filter(isObj).map((row) => row.pri || row.priority || row.class),
  );
  const mergedVe = mergeProgramAndLlmVisualEvents(
    programVisualEvents,
    llmVisualEvents,
    allowedSegmentIds,
  );
  mergeWarnings.push(...mergedVe.warnings);
  const visualEvents = programVisualEvents.length ? mergedVe.visual_events : llmVisualEvents;

  if (!characters.length && !visualEvents.length && !shotSuggestions.length) {
    return { ok: false, error: '分析结果缺少角色与视觉事件', rawJson };
  }
  if (!visualEvents.length) {
    return { ok: false, error: '分析结果缺少 visual_events。第一阶段必须先拆事件，不能直接出镜头。', rawJson };
  }

  // —— 人物补全：LLM 漏提的出场名，从场次/分镜/对白/源剧本回填（不伪造剧情，只补条目）——
  const namesFromBeats = beatsRaw
    .filter(isObj)
    .flatMap((b) => (Array.isArray(b.cast_names) ? b.cast_names.map((x) => str(x)) : []))
    .filter((n) => isDramaCharacterNamePlausible(n));
  const namesFromShots = shotSuggestions.flatMap((s) => [
    ...(s.cast_names || []),
    ...extractCharacterNamesFromDialogueBlob(s.dialogue || ''),
  ]);
  const namesFromScript = extractCharacterNamesFromScriptText(sourceText);
  const allCastNames = mergeUniqueNames(
    characters.map((c) => c.name),
    namesFromBeats,
    namesFromShots,
    namesFromScript,
  );
  const existingNorm = new Set(
    characters.map((c) =>
      String(c.name || '')
        .trim()
        .replace(/\s+/g, '')
        .toLowerCase(),
    ),
  );
  for (const name of allCastNames) {
    const key = name.replace(/\s+/g, '').toLowerCase();
    if (existingNorm.has(key)) continue;
    if (isDramaAnimalCreatureName(name)) continue;
    if (!isDramaCharacterNameAcceptable(name, sourceText)) continue;
    existingNorm.add(key);
    const ch = createEmptyDramaCharacter({
      name,
      role: '出场角色',
      identity: '剧本出场人物（分析补全）',
      prompt: composeDramaCharacterDesignPrompt({
        name,
        role: '出场角色',
        identity: '剧本出场人物',
        storyContext: storyContextHint,
      }),
      needs_reanalyze: true,
      priority: 'P1',
    });
    characters.push(ch);
    registerName(name, ch.character_id);
    const designed = composeDramaVoiceDesign({ name, role: '出场角色' });
    voices.push(
      createEmptyDramaVoice({
        character_id: ch.character_id,
        timbre: designed.timbre,
        voiceStyle: designed.voiceStyle,
        language: 'zh',
        language_style: designed.language_style,
        emotion_range: designed.emotion_range,
        sample_text: composeDramaVoiceSampleLine({
          name,
          role: '出场角色',
          timbre: designed.timbre,
          voiceStyle: designed.voiceStyle,
          language_style: designed.language_style,
          emotion_range: designed.emotion_range,
        }),
      }),
    );
    ch.voice_id = voices[voices.length - 1].voice_id;
  }
  // 回写圣经（bible 已创建，需同步补全后的人物/音色）
  bible.characters = characters;
  bible.voices = voices;
  // 场次 cast_ids 按补全后的 nameToId 重绑
  for (const beat of scene_beats) {
    const raw = beatsRaw.filter(isObj).find((b) => str(b.scene_no) === beat.scene_no);
    const cast_names = Array.isArray(raw?.cast_names)
      ? raw!.cast_names
          .map((x) => salvageDramaPersonName(str(x), sourceText) || str(x))
          .filter((n) => isDramaCharacterNameAcceptable(n, sourceText))
      : [];
    if (cast_names.length) {
      beat.cast_ids = cast_names.map((n) => resolveNameId(n)).filter(Boolean);
      beat.characters = [...cast_names];
    }
  }

  const genreLock = resolveDramaGenreLock({
    style: bible.project.style,
    type: bible.project.type,
    era: bible.project.era,
    visual_style: bible.project.visual_style,
    worldview: bible.project.worldview,
    plot: bible.plot,
    script: dramaActiveEpisodeSourceText(base),
    keywords: bible.script_keywords,
  });
  if (genreLock.kind !== 'unknown') {
    if (!bible.project.style.trim()) bible.project.style = genreLock.styleLine;
    else if (!/古装|玄幻|武侠|都市|末世|民国|科幻/.test(bible.project.style)) {
      bible.project.style = `${genreLock.label}；${bible.project.style}`;
    }
    if (!bible.project.visual_style.trim()) {
      bible.project.visual_style = genreLock.styleLine;
    }
    if (!bible.visual.style.trim()) bible.visual.style = genreLock.styleLine;
    if (!bible.project.era.trim() && genreLock.kind === 'costume_xuanhuan') {
      bible.project.era = '架空古代';
      bible.story.era = bible.story.era || '架空古代';
    }
    bible.characters = bible.characters.map((c) => {
      if (String(c.imageUrl || '').trim()) return c;
      return {
      ...c,
      prompt: ensureDramaCharacterPromptGenreLock(
        composeDramaCharacterDesignPrompt({
          name: c.name,
          age: c.age,
          gender: c.gender,
          role: c.role,
          identity: c.identity,
          personality: c.personality,
          backstory: c.backstory,
          prompt: c.prompt,
          visual: c.visual,
          expression: c.states?.normal,
          storyContext: storyContextHint || bible.plot || bible.project.worldview,
        }),
        genreLock,
      ),
    };
    });
    bible.scenes = bible.scenes.map((s) => {
      if (String(s.imageUrl || '').trim()) return s;
      return {
      ...s,
      prompt: composeDramaSceneDesignPrompt({
        name: s.name,
        location: s.location,
        mood: s.mood,
        time_default: s.time_default,
        weather_default: s.weather_default,
        prompt: s.prompt,
        spatial_structure: s.spatial_structure,
        lighting: s.lighting,
        architecture: s.architecture,
        materials: s.materials,
        kind: s.kind,
        fixed_elements: s.fixed_elements,
        storyContext: storyContextHint || bible.plot || bible.project.worldview,
        eraStyle: eraStyleHint || genreLock.styleLine,
      }),
    };
    });
    bible.voices = bible.voices.map((v) => {
      if (String(v.sample_url || '').trim()) return v;
      const ch = bible.characters.find((c) => c.character_id === v.character_id);
      if (!ch) return v;
      const designed = composeDramaVoiceDesign({
        name: ch.name,
        age: ch.age,
        gender: ch.gender,
        role: ch.role,
        personality: ch.personality,
        backstory: ch.backstory,
        timbre: v.timbre,
        voiceStyle: v.voiceStyle,
        language_style: v.language_style,
        emotion_range: v.emotion_range,
      });
      return { ...v, ...designed };
    });
  }

  // 若用户已选项目视觉风格，优先保留，不被模型 visual 覆盖
  if (String(base?.meta?.globalStyle || '').trim()) {
    bible.visual.style = String(base!.meta!.globalStyle).trim();
    bible.project.visual_style = bible.visual.style;
  }

  let session = createEmptyDramaSession({
    ...base,
    meta: createEmptyDramaNodeMeta({
      ...base?.meta,
      phase: 'analyze',
      analyze_confirmed: false,
      globalStyle:
        String(base?.meta?.globalStyle || '').trim() ||
        bible.visual.style ||
        bible.project.visual_style ||
        genreLock.styleLine ||
        '',
      // 保留用户已选画幅 / 风格预设，不被分析覆盖
      aspect_ratio: base?.meta?.aspect_ratio,
      stylePresetId: base?.meta?.stylePresetId,
    }),
    bible,
    scene_beats,
    /** analyze 不落正式镜头 */
    shots: [],
    episode_bibles: base?.episode_bibles,
    production_plans: base?.production_plans,
  });

  const epId = String(base?.active_episode_id || '').trim();
  const ep = (base?.episodes || []).find((e) => e.episode_id === epId) || null;
  const prevEpBible = epId ? base?.episode_bibles?.[epId] : undefined;
  const { episodeBible, productionPlan } = deriveEpisodeBibleAndPlan(session, {
    episode: ep,
    shotSuggestions,
    visualEvents,
  });
  // 程序原文层 authoritative：LLM 不得清空 original / 一场一镜 suggestions
  if (prevEpBible) {
    episodeBible.original_segments = prevEpBible.original_segments?.length
      ? [...prevEpBible.original_segments]
      : episodeBible.original_segments;
    episodeBible.original_scenes = prevEpBible.original_scenes?.length
      ? [...prevEpBible.original_scenes]
      : episodeBible.original_scenes;
    episodeBible.shot_suggestions = prevEpBible.shot_suggestions?.length
      ? [...prevEpBible.shot_suggestions]
      : episodeBible.shot_suggestions;
    episodeBible.character_bindings = prevEpBible.character_bindings?.length
      ? [...prevEpBible.character_bindings]
      : episodeBible.character_bindings;
    episodeBible.voice_bindings = prevEpBible.voice_bindings?.length
      ? [...prevEpBible.voice_bindings]
      : episodeBible.voice_bindings;
    episodeBible.scene_bindings = prevEpBible.scene_bindings?.length
      ? [...prevEpBible.scene_bindings]
      : episodeBible.scene_bindings;
    if (prevEpBible.visual_bible_binding) {
      episodeBible.visual_bible_binding = prevEpBible.visual_bible_binding;
    }
    if (prevEpBible.analysis_summary) {
      episodeBible.analysis_summary = prevEpBible.analysis_summary;
    }
    if (prevEpBible.official_scene_beats?.length) {
      episodeBible.official_scene_beats = [...prevEpBible.official_scene_beats];
    }
    const notes = [
      ...(prevEpBible.original_integrity?.notes || []),
      ...mergeWarnings,
    ];
    if (prevEpBible.original_integrity) {
      episodeBible.original_integrity = { ...prevEpBible.original_integrity, notes };
    } else if (mergeWarnings.length) {
      episodeBible.original_integrity = {
        ok: true,
        source_chars: 0,
        covered_chars: 0,
        missing_samples: [],
        dialogue_ok: true,
        notes,
      };
    }
  }
  episodeBible.visual_events = visualEvents;
  // 保留用户为本集选过的视觉风格覆盖
  if (prevEpBible?.style_preset_id || prevEpBible?.visual_override?.style) {
    episodeBible.style_preset_id = prevEpBible.style_preset_id || '';
    episodeBible.visual_override = {
      ...episodeBible.visual_override,
      ...prevEpBible.visual_override,
      style:
        prevEpBible.visual_override?.style || episodeBible.visual_override.style,
    };
  }
  session = attachEpisodeBibleAndPlan(
    session,
    episodeBible,
    productionPlan,
    epId || episodeBible.episode_id,
  );

  // 再跑一遍：把 suggestion 对白/cast 里仍缺的人名补进圣经
  session = ensureAppearingCharactersInBible(session);
  session = ensureCharacterCostumes(session);
  // 用镜头对白优先回填每人一段试听台词
  session = ensureVoiceSampleTexts(session);

  return { ok: true, session, rawJson };
}

export type NormalizeDramaShotPlanResult =
  | { ok: true; suggestions: DramaShotSuggestion[]; rawJson: string }
  | { ok: false; error: string; rawJson: string };

/** 第二阶段：把事件→镜头 JSON 解析为 ShotSuggestion（不写正式 DramaShot） */
export function normalizeDramaShotPlanResult(
  text: unknown,
  beats: DramaSceneBeat[] = [],
): NormalizeDramaShotPlanResult {
  const rawJson = String(text || '');
  const parsed = extractJsonObject(rawJson);
  if (!parsed) {
    return { ok: false, error: '无法解析分镜建议 JSON，请重试', rawJson };
  }
  const shotsRaw = Array.isArray(parsed.shots) ? parsed.shots : [];
  if (!shotsRaw.length) {
    return { ok: false, error: '分镜建议 JSON 没有 shots。不得保存。', rawJson };
  }
  const beatByNo = new Map(beats.map((b) => [String(b.scene_no || ''), b]));
  // 20s 模式：从 video_segments[].beats[] 提取对白，按 video_id 映射到 shots
  const dialogueByVideoId = new Map<string, Array<Record<string, unknown>>>();
  const videoSegmentsRaw = Array.isArray(parsed.video_segments) ? parsed.video_segments : [];
  for (const seg of videoSegmentsRaw.filter(isObj)) {
    const videoId = str(seg.video_id);
    if (!videoId) continue;
    const segBeats = Array.isArray(seg.beats) ? seg.beats : [];
    const dlgList: Array<Record<string, unknown>> = [];
    for (const b of segBeats.filter(isObj)) {
      const bd = b.dialogue;
      if (!bd || !isObj(bd)) continue;
      const speaker = str(bd.speaker) || str(bd.character_name);
      const line = str(bd.line) || str(bd.text);
      if (speaker && line) dlgList.push({ character_name: speaker, text: line, subtext: str(bd.subtext) || '' });
    }
    if (dlgList.length) dialogueByVideoId.set(videoId, dlgList);
  }
  const suggestions: DramaShotSuggestion[] = [];
  for (const row of shotsRaw.filter(isObj)) {
    const scene_no = str(row.scene_no) || '1';
    const beat = beatByNo.get(scene_no);
    let dialogueRaw = Array.isArray(row.dialogue) ? row.dialogue : [];
    if (!dialogueRaw.length) {
      const vid = str(row.video_id);
      if (vid && dialogueByVideoId.has(vid)) dialogueRaw = dialogueByVideoId.get(vid)!;
    }
    const dialogueForFormat = dialogueRaw.filter(isObj).map((d) => ({
      character_name: str(d.character_name) || str(d.speaker),
      text: str(d.text || d.line).replace(/【潜台词[:：]?[^】]*】/g, '').trim(),
    }));
    const subtextFromDlg = dialogueRaw
      .filter(isObj)
      .map((d) => str(d.subtext))
      .filter(Boolean)
      .join('；');
    const eventIds = Array.isArray(row.event_ids)
      ? row.event_ids
      : Array.isArray(row.covers_events)
        ? row.covers_events
        : Array.isArray(row.visual_event_ids)
          ? row.visual_event_ids
          : [];
    const action = str(row.action);
    const purpose = str(row.purpose);
    const dialogue = formatDialogue(dialogueForFormat);
    const dramatic_purpose =
      normalizeDramaDramaticPurpose(row.dramatic_purpose) || str(row.dramatic_purpose);
    const llmDur = parseDurationSec(row.duration_sec, 6);
    const recDur = recommendDramaShotPlanDurationSec({
      dramatic_purpose,
      purpose,
      action,
      dialogue,
      size: str(row.size),
    });
    // 自动选择：取 LLM 与推荐值中较大者（对白/动作需要更多时间时以推荐值为准）
    const duration_sec = Math.max(llmDur, recDur);
    // 生成时长选择理由
    const dlgCharsForWhy = dialogue
      .replace(/[^0-9A-Za-z\u4e00-\u9fff：:、。，！？\s]/g, '')
      .replace(/[A-Za-z\u4e00-\u9fff]+[：:]/g, '') // 去掉角色名
      .replace(/[^0-9A-Za-z\u4e00-\u9fff]/g, '')
      .length;
    const secondsNeeded = Math.ceil(dlgCharsForWhy / 4.5);
    let durationWhy = str(row.duration_why);
    if (recDur > llmDur) {
      durationWhy = durationWhy
        ? `${durationWhy}；推荐${recDur}s（对白${dlgCharsForWhy}字≈${secondsNeeded}s）`
        : `对白${dlgCharsForWhy}字（约${secondsNeeded}秒），选${recDur}s`;
    } else if (!durationWhy && dlgCharsForWhy > 0) {
      durationWhy = `对白${dlgCharsForWhy}字（约${secondsNeeded}秒），选${duration_sec}s`;
    }
    suggestions.push(
      createEmptyDramaShotSuggestion({
        scene: str(row.scene) || beat?.location_name || scene_no,
        shot: str(row.shot_no) || String(suggestions.length + 1),
        purpose,
        size: str(row.size),
        camera: str(row.camera) || str(row.angle),
        move: str(row.move),
        action,
        dialogue,
        sound: [str(row.sfx), str(row.music_note)].filter(Boolean).join('；'),
        emotion_play: str(row.expression) || str(row.emotion_play),
        subtext: subtextFromDlg || str(row.subtext),
        lighting: str(row.lighting),
        blocking: str(row.blocking) || str(row.composition),
        time_of_day: normalizeDramaShotTimeOfDay(str(row.time_of_day) || str(row.tod)),
        environment: str(row.environment) || str(row.atmosphere),
        duration_sec,
        duration_why: durationWhy,
        cast_names: Array.isArray(row.cast_names)
          ? row.cast_names.map((x) => str(x)).filter(Boolean)
          : [],
        dramatic_purpose,
        visual_focus: str(row.visual_focus),
        transition_in: str(row.transition_in),
        transition_out: str(row.transition_out),
        visual_event_ids: eventIds.map((x) => normalizeDramaEventId(x)).filter(Boolean),
        prop_names: Array.isArray(row.prop_names)
          ? row.prop_names.map((x) => str(x)).filter(Boolean)
          : [],
        creature_names: Array.isArray(row.creature_names)
          ? row.creature_names.map((x) => str(x)).filter(Boolean)
          : [],
      }),
    );
  }
  if (!suggestions.length) {
    return { ok: false, error: '分镜建议为空，不得保存。', rawJson };
  }
  return { ok: true, suggestions, rawJson };
}
