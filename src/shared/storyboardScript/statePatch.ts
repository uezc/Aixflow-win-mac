import {
  createDefaultStoryboardScriptState,
  type MediaMode,
  type SourceMode,
  type StoryboardScriptRow,
  type StoryboardScriptState,
} from './schema.js';
import type { NormalizeStoryboardScriptGenerationResult } from './normalize.js';

export function buildStoryboardScriptStatePatch(opts: {
  normalized: NormalizeStoryboardScriptGenerationResult;
  prev?: Partial<StoryboardScriptState>;
  sourceMode?: SourceMode;
  mediaMode?: MediaMode;
  viewMode?: 'list' | 'card';
}): StoryboardScriptState {
  const { normalized, prev } = opts;
  const base = createDefaultStoryboardScriptState({
    ...prev,
    rows: normalized.ok ? normalized.rows : prev?.rows ?? [],
    title: normalized.ok ? normalized.title : prev?.title,
    detectedIntent: normalized.ok ? normalized.detectedIntent : prev?.detectedIntent,
    rawJson: normalized.rawJson || prev?.rawJson || '',
    canonicalJson: normalized.rawJson || prev?.canonicalJson,
    mediaMode: opts.mediaMode ?? prev?.mediaMode,
    viewMode: opts.viewMode ?? prev?.viewMode,
  });

  if (normalized.ok && opts.sourceMode) {
    try {
      const doc = JSON.parse(base.canonicalJson || '{}');
      if (doc && typeof doc === 'object') {
        doc.sourceMode = opts.sourceMode;
        base.canonicalJson = JSON.stringify(doc, null, 2);
      }
    } catch {
      /* keep */
    }
  }

  return base;
}

export function updateStoryboardScriptCell(
  state: StoryboardScriptState,
  rowIndex: number,
  columnKey: string,
  value: string,
): StoryboardScriptState {
  if (rowIndex < 0 || rowIndex >= state.rows.length) return state;
  const rows = state.rows.map((row, i) => {
    if (i !== rowIndex) return row;
    return { ...row, [columnKey]: value } as StoryboardScriptRow;
  });
  return createDefaultStoryboardScriptState({
    ...state,
    rows,
    selectedRowIndexes: state.selectedRowIndexes,
    selectionMode: state.selectionMode,
  });
}

export function setStoryboardScriptSelectedRows(
  state: StoryboardScriptState,
  indexes: number[],
): StoryboardScriptState {
  const rowCount = state.rows.length;
  const selectedRowIndexes = [
    ...new Set(
      indexes
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n >= 0 && n < rowCount),
    ),
  ].sort((a, b) => a - b);
  return { ...state, selectedRowIndexes };
}
