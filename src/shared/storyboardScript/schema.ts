export const SCHEMA_VERSION = 'storyboard-script.v1';

/** NEXFLOW node type (camelCase). AI Canvas JSON uses `storyboard-script`. */
export const NODE_TYPE = 'storyboardScript';

export const STORYBOARD_SCRIPT_COLUMNS = [
  '镜号',
  '时长',
  '景别',
  '场景',
  '画面描述',
  '角色',
  '角色描述',
  '角色动作',
  '情绪',
  '角色图',
  '参考',
  '图片提示词',
  '视频提示词',
  '对白',
  '音效',
] as const;

export type StoryboardScriptColumnKey = (typeof STORYBOARD_SCRIPT_COLUMNS)[number];
export type StoryboardScriptRow = Record<StoryboardScriptColumnKey, string>;

export type MediaMode = 'image' | 'video';
export type SourceMode = 'text' | 'image' | 'video' | 'multimodal';

export const IMAGE_MODE_COLUMN_KEYS = new Set<StoryboardScriptColumnKey>([
  '镜号',
  '时长',
  '景别',
  '场景',
  '画面描述',
  '角色',
  '角色描述',
  '角色动作',
  '情绪',
  '角色图',
  '参考',
  '图片提示词',
]);

export const VIDEO_MODE_COLUMN_KEYS = new Set<StoryboardScriptColumnKey>([
  '镜号',
  '时长',
  '景别',
  '场景',
  '画面描述',
  '角色',
  '角色描述',
  '角色动作',
  '情绪',
  '角色图',
  '参考',
  '视频提示词',
  '对白',
  '音效',
]);

const ALWAYS_VISIBLE_COLUMN_KEYS = new Set<StoryboardScriptColumnKey>(['镜号']);

export interface StoryboardScriptDetectedIntent {
  shotCount?: number;
  totalDurationSeconds?: number;
  aspectRatio?: string;
  style?: string;
  language?: string;
  [key: string]: unknown;
}

export interface StoryboardScriptDocument {
  schemaVersion: string;
  type: string;
  sourceMode: SourceMode;
  title: string;
  detectedIntent: StoryboardScriptDetectedIntent;
  rows: StoryboardScriptRow[];
}

export interface StoryboardScriptState {
  version: number;
  viewMode: 'list' | 'card';
  mediaMode: MediaMode;
  rawJson: string;
  canonicalJson: string;
  rows: StoryboardScriptRow[];
  title: string;
  detectedIntent: StoryboardScriptDetectedIntent;
  selectedRowIndexes: number[];
  selectionMode: boolean;
}

function formatCellValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function hasColumnValue(rows: StoryboardScriptRow[], key: StoryboardScriptColumnKey): boolean {
  return rows.some((row) => formatCellValue(row[key]).trim().length > 0);
}

export function getStoryboardScriptDisplayColumns(
  mediaMode: MediaMode,
  rows: StoryboardScriptRow[] = [],
): StoryboardScriptColumnKey[] {
  const allowedKeys =
    mediaMode === 'video' ? VIDEO_MODE_COLUMN_KEYS : IMAGE_MODE_COLUMN_KEYS;

  return STORYBOARD_SCRIPT_COLUMNS.filter((key) => {
    if (!allowedKeys.has(key)) return false;
    if (ALWAYS_VISIBLE_COLUMN_KEYS.has(key)) return true;
    return hasColumnValue(rows, key);
  });
}

export function createEmptyStoryboardScriptRow(index = 0): StoryboardScriptRow {
  const row = {} as StoryboardScriptRow;
  for (const key of STORYBOARD_SCRIPT_COLUMNS) {
    row[key] = key === '镜号' ? String(index + 1) : '';
  }
  return row;
}

export function createDefaultStoryboardScriptState(
  partial: Partial<StoryboardScriptState> = {},
): StoryboardScriptState {
  const rows = Array.isArray(partial.rows) ? partial.rows : [];
  const detectedIntent: StoryboardScriptDetectedIntent = {
    shotCount: rows.length,
    language: 'zh-CN',
    ...(partial.detectedIntent ?? {}),
  };
  const title = String(partial.title ?? '').trim() || '分镜脚本';
  const doc: StoryboardScriptDocument = {
    schemaVersion: SCHEMA_VERSION,
    type: NODE_TYPE,
    sourceMode: 'text',
    title,
    detectedIntent,
    rows,
  };

  return {
    version: 1,
    viewMode: partial.viewMode === 'card' ? 'card' : 'list',
    mediaMode: partial.mediaMode === 'video' ? 'video' : 'image',
    rawJson: partial.rawJson ?? '',
    canonicalJson: partial.canonicalJson ?? JSON.stringify(doc, null, 2),
    rows,
    title,
    detectedIntent,
    selectedRowIndexes: Array.isArray(partial.selectedRowIndexes) ? partial.selectedRowIndexes : [],
    selectionMode: partial.selectionMode === true,
  };
}
