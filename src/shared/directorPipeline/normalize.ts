import {
  SCHEMA_VERSION,
  composeDirectorMvScriptText,
  createEmptyDirectorAsset,
  createEmptyDirectorShot,
  normalizeDirectorMvScriptSections,
  parseDirectorMvScriptSectionsFromText,
  type DirectorAsset,
  type DirectorAssetKind,
  type DirectorAssetsBag,
  type DirectorMvScriptSections,
  type DirectorShot,
} from './schema.js';
import { ensureDirectorSceneBuiltinPrompt } from './assetImagePrompts.js';
import {
  DIRECTOR_MV_PLOT_BEAT_HEADER,
  formatDirectorMvPlotBeatTable,
  parseDirectorMvPlotBeatTable,
  type DirectorMvPlotBeatRow,
} from './plotBeatSheet.js';

/** 将助手返回（string / 多模态 parts / 误传入对象）压成纯文本 */
export function coerceAssistantText(text: unknown): string {
  if (text == null) return '';
  if (typeof text === 'string') return text.trim();
  if (typeof text === 'number' || typeof text === 'boolean') return String(text);
  if (Array.isArray(text)) {
    return text
      .map((part) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        const p = part as Record<string, unknown>;
        const type = String(p.type || '').toLowerCase();
        if (/reason|thinking|thought/.test(type)) return '';
        const piece = p.text ?? p.content ?? p.value ?? p.output_text;
        if (typeof piece === 'string') return piece;
        if (Array.isArray(piece)) return coerceAssistantText(piece);
        return '';
      })
      .filter((s) => String(s || '').trim())
      .join('\n')
      .trim();
  }
  if (typeof text === 'object') {
    const o = text as Record<string, unknown>;
    // 已是剧本对象：交给后续 extractJsonObject
    if (
      o.plot != null ||
      o.剧情规划 != null ||
      o.sections != null ||
      o.script != null ||
      o.schemaVersion != null
    ) {
      try {
        return JSON.stringify(o);
      } catch {
        /* fall through */
      }
    }
    const nested = o.text ?? o.content ?? o.result ?? o.output ?? o.message;
    if (typeof nested === 'string') return nested.trim();
    if (nested != null && nested !== text) return coerceAssistantText(nested);
    try {
      return JSON.stringify(o);
    } catch {
      return String(text);
    }
  }
  return String(text).trim();
}

function stripMarkdownFences(raw: string): string {
  let s = String(raw || '').trim();
  if (!s) return '';
  // 去掉 BOM / 零宽字符
  s = s.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '');
  // 提取所有 ``` / ```json 围栏内容，优先取含 { 的块
  const fenceRe = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(s))) {
    const body = String(m[1] || '').trim();
    if (body) blocks.push(body);
  }
  if (blocks.length) {
    const withJson = blocks.find((b) => b.includes('{') && b.includes('}'));
    return (withJson || blocks[blocks.length - 1] || s).trim();
  }
  // 半截围栏：```json\n{...
  s = s.replace(/^```(?:json|JSON)?\s*/i, '').replace(/\s*```$/i, '');
  return s.trim();
}

function repairJsonCandidate(value: string): string {
  let s = String(value || '').trim();
  if (!s) return s;
  // 智能引号 → 标准 JSON 引号
  s = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  // 尾逗号
  s = s.replace(/,\s*([}\]])/g, '$1');
  return s;
}

export function extractJsonObject(text: unknown): unknown | null {
  if (text && typeof text === 'object' && !Array.isArray(text)) {
    return text;
  }

  const raw = coerceAssistantText(text);
  if (!raw) return null;

  const candidate = stripMarkdownFences(raw);

  const tryParse = (value: string): unknown | null => {
    if (!value) return null;
    const repaired = repairJsonCandidate(value);
    try {
      return JSON.parse(repaired);
    } catch {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }
  };

  const unwrapParsed = (parsed: unknown): unknown | null => {
    if (parsed == null) return null;
    if (Array.isArray(parsed)) {
      const objs = parsed.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
      if (objs.length === 1) return objs[0];
      // 镜头表等场景可能就是数组
      return parsed;
    }
    return parsed;
  };

  const direct = unwrapParsed(tryParse(candidate));
  if (direct != null) return direct;

  // 正文前有 reasoning / 说明文字：取最外层平衡的 { ... }
  const balanced = extractBalancedJsonObject(candidate);
  if (balanced) {
    const sliced = unwrapParsed(tryParse(balanced));
    if (sliced != null) return sliced;
  }

  const objectStart = candidate.indexOf('{');
  const objectEnd = candidate.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    const sliced = unwrapParsed(tryParse(candidate.slice(objectStart, objectEnd + 1)));
    if (sliced != null) return sliced;
  }

  const arrayStart = candidate.indexOf('[');
  const arrayEnd = candidate.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return unwrapParsed(tryParse(candidate.slice(arrayStart, arrayEnd + 1)));
  }

  // JSON.parse 失败时，尝试从半结构化文本捞剧本字段（含未转义换行）
  const loose = extractMvScriptFieldsFromLooseText(candidate);
  if (loose) return loose;

  return null;
}

/** 提取第一个花括号平衡的 JSON 对象子串（忽略字符串内括号） */
function extractBalancedJsonObject(text: string): string | null {
  const s = String(text || '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
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
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * 当模型在 JSON 字符串里直接换行导致 parse 失败时，
 * 用字段边界捞出 plot / worldView 等文本。
 */
function extractMvScriptFieldsFromLooseText(text: string): Record<string, unknown> | null {
  const s = String(text || '');
  if (!/"plot"\s*:|"剧情规划"\s*:|"worldView"\s*:|"characters"\s*:/i.test(s)) {
    // 也可能是纯明细表
    if (/段号\s*\|\s*曲式/.test(s) && s.includes('|')) {
      return { plot: s.replace(/^[\s\S]*?(段号\s*\|)/, '$1').trim() };
    }
    return null;
  }

  const keys = [
    'plot',
    'worldView',
    'relationships',
    'characters',
    'scenes',
    'props',
    '剧情规划',
    '世界观',
    '人物关系',
    '人物库',
    '场景库',
    '道具库',
    'script',
    '剧本',
  ];
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const val = extractJsonStringFieldLoose(s, key);
    if (val != null && val.trim()) out[key] = val.trim();
  }

  // scriptKeywords 数组
  const kwMatch = s.match(/"scriptKeywords"\s*:\s*\[([\s\S]*?)\]/);
  if (kwMatch) {
    const items = Array.from(kwMatch[1].matchAll(/"((?:\\.|[^"\\])*)"/g)).map((m) =>
      m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n'),
    );
    if (items.length) out.scriptKeywords = items;
  }

  if (!out.plot && !out.剧情规划 && !out.script && !out.剧本 && !out.characters && !out.人物库) {
    return null;
  }
  if (!out.schemaVersion) out.schemaVersion = SCHEMA_VERSION;
  if (!out.type) out.type = 'director-mv-script';
  return out;
}

function extractJsonStringFieldLoose(text: string, key: string): string | null {
  const re = new RegExp(`"${key}"\\s*:\\s*"`);
  const m = re.exec(text);
  if (!m) return null;
  let i = m.index + m[0].length;
  let out = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length) {
      const next = text[i + 1];
      if (next === 'n') {
        out += '\n';
        i += 2;
        continue;
      }
      if (next === 't') {
        out += '\t';
        i += 2;
        continue;
      }
      if (next === '"' || next === '\\' || next === '/') {
        out += next;
        i += 2;
        continue;
      }
      out += next;
      i += 2;
      continue;
    }
    if (ch === '"') {
      // 结束引号：后面应是 , 或 }
      const rest = text.slice(i + 1).match(/^\s*[,}]/);
      if (rest) return out;
      // 可能是未转义的内容里的引号，吞掉继续
      out += ch;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out || null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toCellString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((v) => toCellString(v)).filter(Boolean).join('，');
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const SHOT_FIELD_ALIASES: Record<string, keyof DirectorShot> = {
  镜号: '镜号',
  shot: '镜号',
  shotNo: '镜号',
  index: '镜号',
  时长: '时长',
  duration: '时长',
  画面描述: '画面描述',
  description: '画面描述',
  visual: '画面描述',
  镜头角度: '镜头角度',
  角度: '镜头角度',
  angle: '镜头角度',
  cameraAngle: '镜头角度',
  焦距: '焦距',
  focal: '焦距',
  focalLength: '焦距',
  景别: '景别',
  shotSize: '景别',
  光影氛围: '光影氛围',
  lighting: '光影氛围',
  对白旁白: '对白旁白',
  对白: '对白旁白',
  旁白: '对白旁白',
  dialogue: '对白旁白',
  音效: '音效',
  sfx: '音效',
  运镜: '运镜',
  camera: '运镜',
  最终提示词: '最终提示词',
  finalPrompt: '最终提示词',
  prompt: '最终提示词',
};

function normalizeShot(raw: Record<string, unknown>, index: number): DirectorShot {
  const shot = createEmptyDirectorShot(index);
  for (const [key, value] of Object.entries(raw)) {
    const mapped = SHOT_FIELD_ALIASES[key] || SHOT_FIELD_ALIASES[key.trim()];
    if (mapped) {
      shot[mapped] = toCellString(value);
    }
  }
  if (!shot['镜号']) shot['镜号'] = String(index + 1);
  return shot;
}

function pickShotArray(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed.filter(isPlainObject);
  if (!isPlainObject(parsed)) return [];
  for (const key of ['shots', 'rows', 'items', 'scenes']) {
    const value = parsed[key];
    if (Array.isArray(value)) return value.filter(isPlainObject);
  }
  return [];
}

export type NormalizeDirectorShotsResult =
  | { ok: true; title: string; shots: DirectorShot[]; rawJson: string }
  | { ok: false; error: string; rawJson: string };

export function normalizeDirectorShotsResult(text: unknown): NormalizeDirectorShotsResult {
  const rawJson = coerceAssistantText(text) || (typeof text === 'string' ? text : JSON.stringify(text ?? ''));
  const parsed = extractJsonObject(text);
  if (parsed == null) {
    return { ok: false, error: '无法解析 JSON', rawJson };
  }
  const rows = pickShotArray(parsed);
  if (rows.length === 0) {
    return { ok: false, error: '镜头表为空', rawJson };
  }
  const shots = rows.slice(0, 60).map((row, i) => normalizeShot(row, i));
  const title = isPlainObject(parsed) ? toCellString(parsed.title) || '导演' : '导演';
  return { ok: true, title, shots, rawJson };
}

function normalizeAssetItem(
  raw: Record<string, unknown>,
  kind: DirectorAssetKind,
  index: number,
): DirectorAsset {
  const name = toCellString(raw.name ?? raw.title ?? raw['名称'] ?? '');
  let prompt = toCellString(
    raw.prompt ?? raw.description ?? raw['提示词'] ?? raw['描述'] ?? '',
  );
  if (kind === 'scene') {
    prompt = ensureDirectorSceneBuiltinPrompt(prompt || name);
  }
  const asset = createEmptyDirectorAsset(kind, name || `${kind}-${index + 1}`, prompt, index);
  const imageUrl = toCellString(raw.imageUrl ?? raw.image ?? raw.url ?? '');
  if (imageUrl) {
    asset.imageUrl = imageUrl;
    asset.status = 'ready';
  }
  return asset;
}

function pickAssetArray(parsed: Record<string, unknown>, keys: string[]): Record<string, unknown>[] {
  for (const key of keys) {
    const value = parsed[key];
    if (Array.isArray(value)) return value.filter(isPlainObject);
  }
  return [];
}

export type NormalizeDirectorAssetsResult =
  | {
      ok: true;
      globalStyle: string;
      assets: DirectorAssetsBag;
      rawJson: string;
    }
  | { ok: false; error: string; rawJson: string };

export function normalizeDirectorAssetsResult(text: unknown): NormalizeDirectorAssetsResult {
  const rawJson = coerceAssistantText(text) || (typeof text === 'string' ? text : JSON.stringify(text ?? ''));
  const parsed = extractJsonObject(text);
  if (!isPlainObject(parsed)) {
    return { ok: false, error: '无法解析资产 JSON', rawJson };
  }
  const characters = pickAssetArray(parsed, ['characters', 'roles', '角色']).map((r, i) =>
    normalizeAssetItem(r, 'character', i),
  );
  const scenes = pickAssetArray(parsed, ['scenes', 'locations', '场景']).map((r, i) =>
    normalizeAssetItem(r, 'scene', i),
  );
  const props = pickAssetArray(parsed, ['props', 'items', '道具']).map((r, i) =>
    normalizeAssetItem(r, 'prop', i),
  );
  if (characters.length + scenes.length + props.length === 0) {
    return { ok: false, error: '未抽取到任何资产', rawJson };
  }
  return {
    ok: true,
    globalStyle: toCellString(parsed.globalStyle ?? parsed.style ?? parsed['全篇风格']),
    assets: { characters, scenes, props },
    rawJson,
  };
}

export type NormalizeDirectorPromptsResult =
  | { ok: true; promptsByShotNo: Record<string, string>; rawJson: string }
  | { ok: false; error: string; rawJson: string };

export function normalizeDirectorPromptsResult(text: unknown): NormalizeDirectorPromptsResult {
  const rawJson = coerceAssistantText(text) || (typeof text === 'string' ? text : JSON.stringify(text ?? ''));
  const parsed = extractJsonObject(text);
  const rows = pickShotArray(parsed);
  if (rows.length === 0) {
    return { ok: false, error: '无法解析最终提示词', rawJson };
  }
  const promptsByShotNo: Record<string, string> = {};
  rows.forEach((row, i) => {
    const shotNo = toCellString(row['镜号'] ?? row.shotNo ?? row.index) || String(i + 1);
    const prompt = toCellString(row['最终提示词'] ?? row.finalPrompt ?? row.prompt ?? row['提示词']);
    if (prompt) promptsByShotNo[shotNo] = prompt;
  });
  if (Object.keys(promptsByShotNo).length === 0) {
    return { ok: false, error: '无法解析最终提示词', rawJson };
  }
  return { ok: true, promptsByShotNo, rawJson };
}

export type NormalizeDirectorMvStoryAnalyzeResult =
  | {
      ok: true;
      summary: string;
      genre: string;
      emotions: string[];
      keywords: string[];
      rawJson: string;
    }
  | { ok: false; error: string; rawJson: string };

export function normalizeDirectorMvStoryAnalyzeResult(
  text: unknown,
): NormalizeDirectorMvStoryAnalyzeResult {
  const rawJson = coerceAssistantText(text) || (typeof text === 'string' ? text : JSON.stringify(text ?? ''));
  const parsed = extractJsonObject(text);
  if (!isPlainObject(parsed)) {
    return { ok: false, error: '无法解析音乐分析结果', rawJson };
  }
  const summary = toCellString(parsed.summary ?? parsed.分析总结);
  const genre = toCellString(parsed.genre ?? parsed.曲风);
  const emotions = Array.isArray(parsed.emotions)
    ? parsed.emotions.map((x) => toCellString(x)).filter(Boolean)
    : Array.isArray(parsed.主要情绪)
      ? (parsed.主要情绪 as unknown[]).map((x) => toCellString(x)).filter(Boolean)
      : [];
  const keywords = Array.isArray(parsed.keywords)
    ? parsed.keywords.map((x) => toCellString(x)).filter(Boolean)
    : Array.isArray(parsed.关键词)
      ? (parsed.关键词 as unknown[]).map((x) => toCellString(x)).filter(Boolean)
      : [];
  if (!summary && emotions.length === 0 && keywords.length === 0) {
    return { ok: false, error: '分析结果为空', rawJson };
  }
  return { ok: true, summary, genre, emotions, keywords, rawJson };
}

export type NormalizeDirectorMvScriptResult =
  | {
      ok: true;
      script: string;
      scriptKeywords: string[];
      sections: DirectorMvScriptSections;
      rawJson: string;
    }
  | { ok: false; error: string; rawJson: string };

function canonicalizeDirectorMvPlotSection(sections: DirectorMvScriptSections): DirectorMvScriptSections {
  const rows = parseDirectorMvPlotBeatTable(sections.plot);
  if (!rows?.length) return sections;
  return { ...sections, plot: formatDirectorMvPlotBeatTable(rows) };
}

/** 兼容模型把剧本包在 data/result/sections 里，或 plot 用数组行 */
function unwrapDirectorMvScriptObject(parsed: unknown): Record<string, unknown> | null {
  if (Array.isArray(parsed)) {
    const objs = parsed.filter(isPlainObject);
    if (objs.length === 1) return unwrapDirectorMvScriptObject(objs[0]);
    return null;
  }
  if (!isPlainObject(parsed)) return null;

  const hasDirect =
    parsed.plot != null ||
    parsed.剧情规划 != null ||
    parsed.story != null ||
    parsed.script != null ||
    parsed.剧本 != null ||
    parsed.scriptText != null ||
    parsed.characters != null ||
    parsed.人物库 != null ||
    parsed.scenes != null ||
    parsed.场景库 != null ||
    parsed.worldView != null ||
    parsed.世界观 != null;

  if (isPlainObject(parsed.sections)) {
    const merged = { ...parsed, ...parsed.sections };
    if (
      merged.plot != null ||
      merged.剧情规划 != null ||
      merged.characters != null ||
      merged.人物库 != null
    ) {
      return merged;
    }
  }

  if (hasDirect) return parsed;

  for (const key of [
    'data',
    'result',
    'output',
    'payload',
    'mvScript',
    'mv_script',
    'script',
    '剧本',
    'content',
  ]) {
    const inner: unknown = parsed[key];
    if (inner && inner !== parsed) {
      const unwrapped = unwrapDirectorMvScriptObject(inner);
      if (unwrapped) return unwrapped;
    }
  }
  return parsed;
}

function plotArrayToBeatTable(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) return '';
  if (raw.every((x) => typeof x === 'string')) {
    const lines = (raw as string[]).map((l) => String(l || '').trim()).filter(Boolean);
    const joined = lines.join('\n');
    if (parseDirectorMvPlotBeatTable(joined)) return joined;
    if (lines.some((l) => l.includes('|'))) {
      return [DIRECTOR_MV_PLOT_BEAT_HEADER, ...lines.filter((l) => !/段号/.test(l))].join('\n');
    }
    return joined;
  }
  if (!raw.every((x) => x && typeof x === 'object' && !Array.isArray(x))) return '';

  const rows: DirectorMvPlotBeatRow[] = (raw as Record<string, unknown>[]).map((o, i) => ({
    no: toCellString(o.no ?? o.段号 ?? o.index ?? i + 1) || String(i + 1),
    section: toCellString(o.section ?? o.曲式段 ?? o.曲式 ?? '—') || '—',
    vocal: toCellString(o.vocal ?? o.人声 ?? '—') || '—',
    castType: toCellString(o.castType ?? o.画面类型 ?? o.type ?? '—') || '—',
    scene: toCellString(o.scene ?? o.场景 ?? '—') || '—',
    cast: toCellString(o.cast ?? o.出场角色 ?? o.角色 ?? '—') || '—',
    angle: toCellString(o.angle ?? o.镜头角度 ?? o.机位 ?? '—') || '—',
    focal: toCellString(o.focal ?? o.焦距 ?? o.焦段 ?? '—') || '—',
    action: toCellString(o.action ?? o.动作与画面 ?? o.动作 ?? o.画面 ?? '—') || '—',
    mood: toCellString(o.mood ?? o.情绪 ?? '—') || '—',
  }));
  return formatDirectorMvPlotBeatTable(rows);
}

function lookLikeTruncatedJson(raw: string): boolean {
  const s = String(raw || '').trim();
  if (!s) return false;
  const opens = (s.match(/\{/g) || []).length;
  const closes = (s.match(/\}/g) || []).length;
  if (opens > closes) return true;
  if (/```/.test(s) && !/```[\s\S]*```/.test(s)) return true;
  if (/"plot"\s*:\s*"/.test(s) && !/"worldView"|"世界观"|"characters"|"人物库"/.test(s)) return true;
  return false;
}

export function normalizeDirectorMvScriptResult(text: unknown): NormalizeDirectorMvScriptResult {
  const rawJson = coerceAssistantText(text);
  if (!rawJson) {
    return {
      ok: false,
      error: '模型返回为空，无法解析 MV 剧本（可能被截断或仅含推理内容）',
      rawJson: '',
    };
  }

  let parsed = extractJsonObject(text);
  parsed = unwrapDirectorMvScriptObject(parsed);

  // plot 若是对象数组，先转成明细表再规范化
  if (isPlainObject(parsed) && Array.isArray(parsed.plot)) {
    const table = plotArrayToBeatTable(parsed.plot);
    if (table) parsed = { ...parsed, plot: table };
  }
  if (isPlainObject(parsed) && Array.isArray(parsed.剧情规划)) {
    const table = plotArrayToBeatTable(parsed.剧情规划);
    if (table) parsed = { ...parsed, 剧情规划: table, plot: table };
  }

  if (!isPlainObject(parsed)) {
    const plain = rawJson;
    // 含明细表或分节标题时，按纯文本剧本接受
    if (
      plain.length > 40 ||
      /段号\s*\|/.test(plain) ||
      /【\s*剧情/.test(plain) ||
      plain.includes('|')
    ) {
      const sections = canonicalizeDirectorMvPlotSection(parseDirectorMvScriptSectionsFromText(plain));
      const script = composeDirectorMvScriptText(sections) || plain;
      if (script.trim()) {
        return { ok: true, script, scriptKeywords: [], sections, rawJson: plain };
      }
    }
    if (lookLikeTruncatedJson(plain)) {
      return {
        ok: false,
        error: '无法解析 MV 剧本：模型输出疑似被截断，请重试或换用更大上下文的模型',
        rawJson: plain,
      };
    }
    const preview = plain.replace(/\s+/g, ' ').slice(0, 120);
    return {
      ok: false,
      error: preview
        ? `无法解析 MV 剧本（非合法 JSON）：${preview}`
        : '无法解析 MV 剧本',
      rawJson: plain,
    };
  }

  let sections = normalizeDirectorMvScriptSections(parsed);

  // 兼容旧版：只有 script 大字段（可能是 JSON 字符串或【】分节）
  const legacyScript = toCellString(parsed.script ?? parsed.剧本 ?? parsed.scriptText ?? parsed.content);
  const hasSection =
    !!sections.plot ||
    !!sections.worldView ||
    !!sections.relationships ||
    !!sections.characters ||
    !!sections.scenes ||
    !!sections.props;
  if (!hasSection && legacyScript) {
    // legacy 本身可能还是 JSON
    const nested = extractJsonObject(legacyScript);
    if (isPlainObject(nested)) {
      sections = normalizeDirectorMvScriptSections(unwrapDirectorMvScriptObject(nested) || nested);
    } else {
      sections = parseDirectorMvScriptSectionsFromText(legacyScript);
    }
  }
  sections = canonicalizeDirectorMvPlotSection(sections);

  const scriptKeywords = Array.isArray(parsed.scriptKeywords)
    ? parsed.scriptKeywords.map((x) => toCellString(x)).filter(Boolean)
    : Array.isArray(parsed.剧本关键词)
      ? (parsed.剧本关键词 as unknown[]).map((x) => toCellString(x)).filter(Boolean)
      : [];

  const script = composeDirectorMvScriptText(sections) || legacyScript;
  if (!script) {
    if (lookLikeTruncatedJson(rawJson)) {
      return {
        ok: false,
        error: '剧本正文为空（输出疑似被截断），请重试',
        rawJson,
      };
    }
    return { ok: false, error: '剧本正文为空', rawJson };
  }
  return {
    ok: true,
    script,
    scriptKeywords,
    sections,
    rawJson,
  };
}

export function assertSchemaVersion(parsed: unknown): boolean {
  if (!isPlainObject(parsed)) return false;
  const v = toCellString(parsed.schemaVersion);
  return !v || v === SCHEMA_VERSION;
}
