/**
 * 从原文场次/片段抽取场景陈设硬事实，回填场景卡提示词（不发明戏）。
 */

import { composeDramaSceneDesignPrompt } from './characterDesignPrompt.js';
import type {
  DramaDirectorSession,
  DramaOriginalScene,
  DramaOriginalSegment,
  DramaSceneAsset,
} from './types.js';

const ENV_OBJECT_RE =
  /电竞椅|机械键盘|键盘|鼠标|显示器|显示屏|屏幕|弹幕|麦克风|话筒|耳机|直播灯|环形灯|沙发|茶几|书桌|办公桌|电脑桌|床|衣柜|落地窗|窗帘|霓虹|招牌|柜台|货架|街灯|骑楼|石阶|香炉|蒲团|匾额|红木|青石板|青石|雨棚|收银台|吧台|吊灯|日光灯|灯箱|玻璃幕墙|扶手|栏杆|井盖|斑马线|便利店|冰箱|冰柜|自动门|卷帘门|榻榻米|矮桌|屏风|烛台|香案|牌位|石狮|牌坊|城墙|巷口|路灯|摊位|遮阳伞|白板|黑板|课桌|讲台|手术灯|病床|输液架|警车|摩托车|电动车|头盔/;

const ENV_SPACE_RE =
  /坐在|放在|摆着|挂着|墙上|桌上|窗外|门口|室内|室外|天花板|地板|地面|墙角|角落|对面|两侧|中央|深处|进门|走廊|巷子|山门|殿内|殿外|直播间|卧室|客厅|厨房|阳台|天台|天桥|地下通道/;

function trimLine(s: unknown): string {
  return String(s || '').trim();
}

function uniqueKeepOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const t = trimLine(raw);
    if (!t) continue;
    const key = t.replace(/\s+/g, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function stripDialogueQuotes(text: string): string {
  return String(text || '')
    .replace(/「[^」]*」/g, ' ')
    .replace(/『[^』]*』/g, ' ')
    .replace(/“[^”]*”/g, ' ')
    .replace(/"[^"]*"/g, ' ')
    .replace(/\([^)]{0,40}\)|\（[^）]{0,40}\）/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKind(locationType: string): string {
  const t = trimLine(locationType);
  if (!t) return '';
  if (/^i\.?\s*\/?\s*e|内外/i.test(t)) return t;
  if (/ext|外景|室外|外/i.test(t)) return '室外';
  if (/int|内景|室内|内/i.test(t)) return '室内';
  return t;
}

function clauseLooksEnvironmental(clause: string): boolean {
  const c = trimLine(clause);
  if (c.length < 4 || c.length > 80) return false;
  if (/^[\d一二三四五六七八九十]+[.、．]/.test(c)) return false;
  return ENV_OBJECT_RE.test(c) || ENV_SPACE_RE.test(c);
}

function extractObjectMentions(text: string): string[] {
  const hits: string[] = [];
  const re = new RegExp(ENV_OBJECT_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    hits.push(m[0]);
  }
  return hits;
}

export type DramaSceneEnvFacts = {
  kind: string;
  time_default: string;
  spatial_structure: string;
  fixed_elements: string[];
  /** 可核验的原文环境短句（最多几条） */
  env_clauses: string[];
};

/** 按地点从原文场次抽陈设/内外景/时段（只抽取，不改写剧情） */
export function extractDramaSceneEnvFactsFromOriginal(input: {
  location: string;
  original_scenes?: DramaOriginalScene[] | null;
  original_segments?: DramaOriginalSegment[] | null;
}): DramaSceneEnvFacts {
  const location = trimLine(input.location);
  const scenes = (input.original_scenes || []).filter(
    (s) =>
      !location ||
      trimLine(s.location) === location ||
      trimLine(s.location).includes(location) ||
      location.includes(trimLine(s.location)),
  );
  const sceneIds = new Set(scenes.map((s) => s.scene_id).filter(Boolean));
  const segments = (input.original_segments || []).filter((seg) => {
    if (sceneIds.size && sceneIds.has(seg.scene_id)) return true;
    if (!sceneIds.size && location) {
      // 无场次匹配时不乱扫全集
      return false;
    }
    return false;
  });

  const kind =
    normalizeKind(scenes.find((s) => s.location_type)?.location_type || '') ||
    (/(?:街|路|山|峰|门外|户外|广场|巷)/.test(location) ? '室外' : /(?:间|室|殿|厅|店|馆|房)/.test(location) ? '室内' : '');

  const time_default = trimLine(scenes.find((s) => trimLine(s.time))?.time || '');

  const preferredTypes = new Set([
    'action',
    'stage_direction',
    'performance_direction',
    'other',
    'montage',
    'transition',
  ]);

  const clauses: string[] = [];
  const objects: string[] = [];
  for (const seg of segments) {
    const type = String(seg.type || '');
    if (type === 'dialogue' || type === 'system' || type === 'narration' || type === 'screen_text') {
      continue;
    }
    if (type && !preferredTypes.has(type) && type !== '') continue;
    const cleaned = stripDialogueQuotes(seg.original_text);
    if (!cleaned) continue;
    objects.push(...extractObjectMentions(cleaned));
    for (const part of cleaned.split(/[。！？；;\n]+/)) {
      if (clauseLooksEnvironmental(part)) {
        clauses.push(trimLine(part).replace(/^[，、]+|[，、]+$/g, ''));
      }
    }
  }

  const fixed_elements = uniqueKeepOrder([
    ...objects,
    ...clauses.map((c) => (c.length > 28 ? `${c.slice(0, 28)}…` : c)),
  ]).slice(0, 12);

  const spatial_structure = clauses[0] ? clauses[0].slice(0, 60) : '';

  return {
    kind,
    time_default,
    spatial_structure,
    fixed_elements,
    env_clauses: uniqueKeepOrder(clauses).slice(0, 6),
  };
}

function sceneStoryContext(session: DramaDirectorSession): string {
  return [
    session.bible?.project?.worldview,
    session.bible?.plot,
    session.bible?.project?.style,
    session.bible?.project?.era,
  ]
    .filter(Boolean)
    .join('；');
}

function sceneEraStyle(session: DramaDirectorSession): string {
  return trimLine(session.bible?.project?.era || session.bible?.project?.style || '');
}

function isThinDramaScenePrompt(prompt: string, fixed: string[]): boolean {
  const p = trimLine(prompt);
  if (!p) return true;
  if (fixed.length && fixed.some((f) => p.includes(f.slice(0, Math.min(4, f.length))))) {
    return p.length < 40;
  }
  if (p.length < 80) return true;
  if (/电影感静帧/.test(p) && !/陈设硬事实/.test(p)) return true;
  return false;
}

/** 用原文事实加厚单张场景卡（已有图则不改 prompt，避免冲掉用户认可的图） */
export function enrichDramaSceneAssetFromOriginal(
  session: DramaDirectorSession,
  scene: DramaSceneAsset,
): DramaSceneAsset {
  if (trimLine(scene.imageUrl)) return scene;

  const epId = session.active_episode_id;
  const epBible = session.episode_bibles?.[epId];
  const location = trimLine(scene.location || scene.name);
  const facts = extractDramaSceneEnvFactsFromOriginal({
    location,
    original_scenes: epBible?.original_scenes,
    original_segments: epBible?.original_segments,
  });

  const fixed_elements = uniqueKeepOrder([
    ...(scene.fixed_elements || []),
    ...facts.fixed_elements,
  ]).slice(0, 12);
  const kind = trimLine(scene.kind) || facts.kind;
  const spatial_structure = trimLine(scene.spatial_structure) || facts.spatial_structure;
  const time_default = trimLine(scene.time_default) || facts.time_default;
  const thin = isThinDramaScenePrompt(scene.prompt, fixed_elements);

  if (!thin && !facts.fixed_elements.length && !facts.kind && !facts.time_default) {
    return scene;
  }

  const prompt = composeDramaSceneDesignPrompt({
    name: scene.name,
    location: scene.location || scene.name,
    mood: scene.mood,
    time_default,
    weather_default: scene.weather_default,
    prompt: thin ? '' : scene.prompt,
    spatial_structure,
    lighting: scene.lighting,
    architecture: scene.architecture,
    materials: scene.materials,
    kind,
    fixed_elements,
    storyContext: sceneStoryContext(session),
    eraStyle: sceneEraStyle(session),
    forceRebuild: thin,
  });

  return {
    ...scene,
    kind,
    time_default,
    spatial_structure,
    fixed_elements,
    prompt,
  };
}

/** 本集全部场景卡：从原文回填陈设后重拼生图 prompt */
export function enrichDramaBibleScenesFromOriginal(
  session: DramaDirectorSession,
): DramaDirectorSession {
  const scenes = session.bible?.scenes || [];
  if (!scenes.length) return session;
  let changed = false;
  const next = scenes.map((s) => {
    const enriched = enrichDramaSceneAssetFromOriginal(session, s);
    if (enriched !== s) changed = true;
    return enriched;
  });
  if (!changed) return session;
  return {
    ...session,
    bible: {
      ...session.bible,
      scenes: next,
    },
  };
}
