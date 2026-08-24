/**
 * 出场角色标准化人设 → 写入 EpisodeBible.directing_notes.dossier
 * 供后续 Shot Planning 使用；不负责外貌定妆。
 */

import { extractJsonObject } from '../../directorPipeline/normalize.js';
import { namesLikelySameDramaPerson } from '../extractCastFromScript.js';
import { createEmptyDramaCharacter } from '../factories.js';
import {
  createEmptyDramaCharacterDossier,
  createEmptyDramaEpisodeBible,
} from '../episodeBible.js';
import type {
  DramaCharacterDirecting,
  DramaCharacterDossier,
  DramaCharacterDossierRow,
  DramaDirectorSession,
  DramaShotSuggestion,
} from '../types.js';

export const DRAMA_CHARACTER_DOSSIER_SYSTEM_PROMPT = `你是短剧人物总监。任务：根据剧本，为所有出场角色生成标准化人设，供后续自动化分镜拆解。

规则：
1. 只输出合法 JSON，不要 Markdown，不要代码块，不要解释。
2. 顶层：{ "schemaVersion": "director-domain.v2", "type": "director-drama-character-dossier", "characters": [...] }
3. 必须覆盖剧本里每一个会出镜、说话、被点名的人物（含配角/功能性角色）。name 与已有角色名单对齐，禁止另起花名。
4. characters[] 每项字段（全部必填，短句即可）：
   {
     "code": "C-01",
     "name": "周一川",
     "character_type": "主角|配角|反派|功能性角色",
     "age": "28岁 或 35-40岁",
     "identity": "职业+经济层级",
     "desire": "他/她最想要什么",
     "fear": "他/她最怕什么",
     "surface_personality": "对外呈现的情绪状态",
     "deep_personality": "未被看见的心理内核",
     "emotion_signals": { "愤怒":"咬下唇内侧/攥拳", "焦虑":"拇指猛戳/肩颈绷紧", "隐忍":"说没事/低头" },
     "signature_actions": [{"action":"用手背试门板温度","trigger":"进入陌生室内空间"},{"action":"攥拳后展开看掌心指印","trigger":"克制愤怒后"}] 最多5个，必须是镜头里看得见的身体语言，且每条带触发条件,
     "action_index": [{"trigger":"进入陌生室内空间","name":"周一川","action":"用手背试门板温度"}],
     "dialogue_style": "句式/标点/语气风格",
     "subtext_rule": "字面话→真实心理，如 超时了→你在我眼里不值钱",
     "relation_to_lead": "敌对/同盟/镜像/施加者/被施加者 + 一句说明",
     "scene_anchor": "该角色出场默认氛围：光线/声音/运镜倾向"
   }
5. 人设必须能被镜头执行：欲望/恐惧要能变成景别与动作，不要空泛鸡汤。
6. action_index 是拆镜检索表：覆盖本集所有会触发标志性动作的场景条件，供后续强制调用。
7. 禁止输出外貌五官长文（定妆已另有字段）。禁止发明剧本没有的新主角。`;

export const DRAMA_CHARACTER_DOSSIER_USER_PROMPT_TEMPLATE = `请为下列剧本生成 director-drama-character-dossier JSON。
{retryHint}
标题：{title}
已有角色名单（name 必须对齐，可补全人设，不要改名）：
{castJson}
剧本：
{sourceText}
只输出一个 JSON 对象。`;

export function buildDramaCharacterDossierMessages(opts: {
  sourceText: string;
  title?: string;
  existingCharacters?: Array<{
    name: string;
    role?: string;
    identity?: string;
    personality?: string;
    age?: string;
  }>;
  retryHint?: string;
}): { systemPrompt: string; userPrompt: string } {
  const castJson = JSON.stringify(
    (opts.existingCharacters || []).map((c) => ({
      name: c.name,
      role: c.role || '',
      identity: c.identity || '',
      personality: c.personality || '',
      age: c.age || '',
    })),
  );
  return {
    systemPrompt: DRAMA_CHARACTER_DOSSIER_SYSTEM_PROMPT,
    userPrompt: DRAMA_CHARACTER_DOSSIER_USER_PROMPT_TEMPLATE.replace(
      '{title}',
      String(opts.title || '').trim() || '未命名',
    )
      .replace('{castJson}', castJson)
      .replace('{sourceText}', String(opts.sourceText || '').trim())
      .replace(
        '{retryHint}',
        String(opts.retryHint || '').trim()
          ? `\n【重试】${opts.retryHint}\n`
          : '',
      ),
  };
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map((x) => asStr(x)).filter(Boolean).join('；');
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return '';
    }
  }
  return String(v).trim();
}

function pickRow(raw: Record<string, unknown>): DramaCharacterDossierRow | null {
  const name = asStr(raw.name || raw.角色名称 || raw.character_name);
  if (!name) return null;
  const signals = raw.emotion_signals ?? raw.情绪信号库;
  const actions = raw.signature_actions ?? raw.标志性动作;
  return {
    name,
    code: asStr(raw.code || raw.角色编号),
    character_type: asStr(raw.character_type || raw.角色类型 || raw.type),
    age: asStr(raw.age || raw.年龄),
    identity: asStr(raw.identity || raw.社会身份),
    desire: asStr(raw.desire || raw.核心欲望),
    fear: asStr(raw.fear || raw.核心恐惧),
    surface_personality: asStr(raw.surface_personality || raw.表层性格),
    deep_personality: asStr(raw.deep_personality || raw.深层性格),
    emotion_signals: asStr(signals),
    signature_actions: asStr(actions),
    dialogue_style: asStr(raw.dialogue_style || raw.对白特征),
    subtext_rule: asStr(raw.subtext_rule || raw.对白潜台词规则),
    relation_to_lead: asStr(raw.relation_to_lead || raw.与主角关系),
    scene_anchor: asStr(raw.scene_anchor || raw.场景情绪锚点),
    action_index: asStr(raw.action_index || raw.动作触发索引),
  };
}

export function parseDramaCharacterDossier(text: string): DramaCharacterDossierRow[] {
  const parsed = extractJsonObject(text);
  const obj = asObj(parsed);
  const list: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(obj?.characters)
      ? (obj!.characters as unknown[])
      : Array.isArray(obj?.dossiers)
        ? (obj!.dossiers as unknown[])
        : [];
  const rows: DramaCharacterDossierRow[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const rec = asObj(item);
    if (!rec) continue;
    const row = pickRow(rec);
    if (!row) continue;
    const key = row.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return rows;
}

export function formatDramaCharacterDossierForShotPlan(
  notes: DramaCharacterDirecting[] | undefined,
): string {
  const rows = (notes || [])
    .map((n) => {
      const d = n.dossier;
      if (!d) return null;
      return {
        name: n.name,
        code: d.code,
        type: d.character_type,
        desire: d.desire,
        fear: d.fear,
        surface: d.surface_personality,
        deep: d.deep_personality,
        signals: d.emotion_signals,
        actions: d.signature_actions,
        dialogue: d.dialogue_style,
        subtext: d.subtext_rule,
        relation: d.relation_to_lead,
        anchor: d.scene_anchor,
        signature_actions: d.signature_actions,
        action_index: d.action_index,
      };
    })
    .filter(Boolean);
  return rows.length ? JSON.stringify(rows) : '';
}

const CAST_CODE_PREFIX = /^C-\d+\s+/i;

export function stampDramaCastNameWithCode(
  name: string,
  notes: DramaCharacterDirecting[] | undefined,
): string {
  const raw = String(name || '').trim();
  if (!raw) return '';
  const stripped = raw.replace(CAST_CODE_PREFIX, '').trim();
  const existingCode = (raw.match(/^(C-\d+)/i) || [])[1] || '';
  const hit = (notes || []).find((n) => {
    const code = String(n.dossier?.code || '').trim();
    if (existingCode && code && existingCode.toUpperCase() === code.toUpperCase()) return true;
    return (
      namesLikelySameDramaPerson(n.name, stripped) || namesLikelySameDramaPerson(n.name, raw)
    );
  });
  const code = String(hit?.dossier?.code || existingCode || '').trim();
  const display = String(hit?.name || stripped || raw).trim();
  return code ? `${code} ${display}` : display;
}

export function stampDramaShotCastCodes(
  shots: DramaShotSuggestion[],
  notes: DramaCharacterDirecting[] | undefined,
): DramaShotSuggestion[] {
  return (shots || []).map((s) => ({
    ...s,
    cast_names: (s.cast_names || [])
      .map((n) => stampDramaCastNameWithCode(n, notes))
      .filter(Boolean),
  }));
}

export function formatDramaCharacterNamesForShotPlan(
  names: string[],
  notes: DramaCharacterDirecting[] | undefined,
): string[] {
  return (names || []).map((n) => stampDramaCastNameWithCode(n, notes));
}

export function applyDramaCharacterDossiersToSession(
  session: DramaDirectorSession,
  rows: DramaCharacterDossierRow[],
  episodeId?: string,
): DramaDirectorSession {
  const epId = String(episodeId || session.active_episode_id || '').trim();
  let characters = [...(session.bible.characters || [])];
  const notesById = new Map<string, DramaCharacterDirecting>();
  const prevBible = epId ? session.episode_bibles?.[epId] : undefined;
  for (const n of prevBible?.directing_notes || []) {
    notesById.set(n.character_id, { ...n });
  }

  const findChar = (name: string) =>
    characters.find((c) => namesLikelySameDramaPerson(c.name, name));

  for (const row of rows) {
    const name = String(row.name || '').trim();
    if (!name) continue;
    let ch = findChar(name);
    if (!ch) {
      ch = createEmptyDramaCharacter({ name });
      characters = [...characters, ch];
    }
    const id = ch.character_id;
    characters = characters.map((c) => {
      if (c.character_id !== id) return c;
      const backstory = [
        row.deep_personality,
        row.desire ? `核心欲望：${row.desire}` : '',
        row.fear ? `核心恐惧：${row.fear}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      return {
        ...c,
        role: row.character_type || c.role,
        identity: row.identity || c.identity,
        age: row.age || c.age,
        personality: row.surface_personality || c.personality,
        backstory: backstory || c.backstory,
      };
    });
    const prev = notesById.get(id);
    const dossier = createEmptyDramaCharacterDossier(row);
    notesById.set(id, {
      character_id: id,
      name: ch.name,
      positioning: row.character_type || prev?.positioning || '',
      episode_goal: row.desire || prev?.episode_goal || '',
      psychological_arc: row.deep_personality || prev?.psychological_arc || '',
      key_actions: row.signature_actions || prev?.key_actions || '',
      performance_focus: row.surface_personality || prev?.performance_focus || '',
      relationship_changes:
        [row.relation_to_lead, row.subtext_rule].filter(Boolean).join('；') ||
        prev?.relationship_changes ||
        '',
      dossier,
    });
  }

  const directing_notes: DramaCharacterDirecting[] = characters.map((c) => {
    const prev = notesById.get(c.character_id);
    if (prev) return { ...prev, name: c.name };
    return {
      character_id: c.character_id,
      name: c.name,
      positioning: c.role || c.identity,
      episode_goal: '',
      psychological_arc: c.personality,
      key_actions: '',
      performance_focus: c.personality,
      relationship_changes: '',
    };
  });

  const next: DramaDirectorSession = {
    ...session,
    bible: { ...session.bible, characters },
  };
  if (!epId) return next;
  return {
    ...next,
    episode_bibles: {
      ...(session.episode_bibles || {}),
      [epId]: createEmptyDramaEpisodeBible({
        ...(prevBible || { episode_id: epId }),
        episode_id: epId,
        directing_notes,
        updated_at: Date.now(),
      }),
    },
  };
}

export const DRAMA_CHARACTER_DOSSIER_FIELDS: Array<{
  key: keyof DramaCharacterDossier;
  label: string;
  labelEn: string;
}> = [
  { key: 'code', label: '角色编号', labelEn: 'Code' },
  { key: 'character_type', label: '角色类型', labelEn: 'Type' },
  { key: 'age', label: '年龄', labelEn: 'Age' },
  { key: 'identity', label: '社会身份', labelEn: 'Identity' },
  { key: 'desire', label: '核心欲望', labelEn: 'Desire' },
  { key: 'fear', label: '核心恐惧', labelEn: 'Fear' },
  { key: 'surface_personality', label: '表层性格', labelEn: 'Surface' },
  { key: 'deep_personality', label: '深层性格', labelEn: 'Core' },
  { key: 'emotion_signals', label: '情绪信号库', labelEn: 'Emotion cues' },
  { key: 'signature_actions', label: '标志性动作', labelEn: 'Signature moves' },
  { key: 'dialogue_style', label: '对白特征', labelEn: 'Speech' },
  { key: 'subtext_rule', label: '对白潜台词规则', labelEn: 'Subtext' },
  { key: 'relation_to_lead', label: '与主角关系', labelEn: 'To lead' },
  { key: 'scene_anchor', label: '场景情绪锚点', labelEn: 'Scene anchor' },
  { key: 'action_index', label: '动作触发索引', labelEn: 'Action index' },
];
