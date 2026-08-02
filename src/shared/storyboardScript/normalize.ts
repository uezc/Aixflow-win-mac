import {
  NODE_TYPE,
  SCHEMA_VERSION,
  STORYBOARD_SCRIPT_COLUMNS,
  createEmptyStoryboardScriptRow,
  type SourceMode,
  type StoryboardScriptDetectedIntent,
  type StoryboardScriptDocument,
  type StoryboardScriptRow,
} from './schema.js';

const MAX_ROWS = 100;
const VALID_SOURCE_MODES = new Set<SourceMode>(['text', 'image', 'video', 'multimodal']);

export function extractJsonObject(text: unknown): unknown | null {
  if (text && typeof text === 'object' && !Array.isArray(text)) {
    return text;
  }

  const raw = String(text ?? '').trim();
  if (!raw) return null;

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? raw).trim();

  const tryParse = (value: string): unknown | null => {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  const direct = tryParse(candidate);
  if (direct != null) return direct;

  const objectStart = candidate.indexOf('{');
  const objectEnd = candidate.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    const sliced = tryParse(candidate.slice(objectStart, objectEnd + 1));
    if (sliced != null) return sliced;
  }

  const arrayStart = candidate.indexOf('[');
  const arrayEnd = candidate.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return tryParse(candidate.slice(arrayStart, arrayEnd + 1));
  }

  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSourceMode(value: unknown, fallback: SourceMode): SourceMode {
  const mode = String(value ?? '').trim() as SourceMode;
  return VALID_SOURCE_MODES.has(mode) ? mode : fallback;
}

function toCellString(value: unknown, columnKey: string): string {
  if (value == null) return '';
  if (Array.isArray(value)) {
    return value
      .map((item) => toCellString(item, columnKey))
      .filter(Boolean)
      .join('，');
  }
  if (typeof value === 'number') {
    return columnKey === '时长' ? `${value}s` : String(value);
  }
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string') return value.trim();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function pickRows(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) {
    return parsed.filter(isPlainObject);
  }
  if (!isPlainObject(parsed)) return [];

  for (const key of ['rows', 'shots', 'scenes', 'items']) {
    const value = parsed[key];
    if (Array.isArray(value)) {
      return value.filter(isPlainObject);
    }
  }

  return [];
}

function normalizeRow(rawRow: Record<string, unknown>, index: number): StoryboardScriptRow {
  const row = createEmptyStoryboardScriptRow(index);
  for (const key of STORYBOARD_SCRIPT_COLUMNS) {
    row[key] = toCellString(rawRow[key], key);
  }
  if (!row['镜号']) {
    row['镜号'] = String(index + 1);
  }
  return row;
}

function normalizeDetectedIntent(
  rawIntent: unknown,
  rowCount: number,
): StoryboardScriptDetectedIntent {
  const intent = isPlainObject(rawIntent) ? { ...rawIntent } : {};
  const shotCount = Number(intent.shotCount);
  intent.shotCount = Number.isFinite(shotCount) && shotCount > 0 ? Math.trunc(shotCount) : rowCount;
  if (!intent.language) intent.language = 'zh-CN';
  return intent;
}

export interface NormalizeStoryboardScriptGenerationResultOptions {
  sourceMode?: SourceMode;
}

export interface NormalizeStoryboardScriptGenerationResult {
  ok: boolean;
  rows: StoryboardScriptRow[];
  title: string;
  detectedIntent: StoryboardScriptDetectedIntent;
  rawJson: string;
  warnings: string[];
  error?: string;
}

export function normalizeStoryboardScriptGenerationResult(
  rawText: unknown,
  options: NormalizeStoryboardScriptGenerationResultOptions = {},
): NormalizeStoryboardScriptGenerationResult {
  const parsed = extractJsonObject(rawText);
  if (!parsed) {
    return {
      ok: false,
      rows: [],
      title: '',
      detectedIntent: { shotCount: 0, language: 'zh-CN' },
      rawJson: '',
      warnings: [],
      error: 'NO_VALID_JSON',
    };
  }

  const fallbackSourceMode = normalizeSourceMode(options.sourceMode, 'text');
  const sourceMode = normalizeSourceMode(
    isPlainObject(parsed) ? parsed.sourceMode : undefined,
    fallbackSourceMode,
  );

  const rawRows = pickRows(parsed).slice(0, MAX_ROWS);
  if (rawRows.length === 0) {
    return {
      ok: false,
      rows: [],
      title: '',
      detectedIntent: { shotCount: 0, language: 'zh-CN' },
      rawJson: '',
      warnings: [],
      error: 'NO_ROWS',
    };
  }

  const rows = rawRows.map((row, index) => normalizeRow(row, index));
  const detectedIntent = normalizeDetectedIntent(
    isPlainObject(parsed) ? parsed.detectedIntent : undefined,
    rows.length,
  );
  const title =
    String(isPlainObject(parsed) ? parsed.title ?? '' : '').trim() || '分镜脚本';

  const warnings: string[] = [];
  if (
    Number.isFinite(Number(detectedIntent.shotCount)) &&
    Number(detectedIntent.shotCount) !== rows.length
  ) {
    warnings.push('SHOT_COUNT_MISMATCH');
  }

  const doc: StoryboardScriptDocument = {
    schemaVersion: SCHEMA_VERSION,
    type: NODE_TYPE,
    sourceMode,
    title,
    detectedIntent,
    rows,
  };

  return {
    ok: true,
    rows,
    title,
    detectedIntent,
    rawJson: JSON.stringify(doc, null, 2),
    warnings,
  };
}
