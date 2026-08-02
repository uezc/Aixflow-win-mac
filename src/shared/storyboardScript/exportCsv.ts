import {
  STORYBOARD_SCRIPT_COLUMNS,
  type StoryboardScriptColumnKey,
  type StoryboardScriptRow,
} from './schema.js';

function formatTableCellValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function escapeCsvCell(value: unknown): string {
  const text = formatTableCellValue(value).replace(/\r\n?/g, '\n');
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Export rows to CSV (UTF-8 BOM) for Excel-friendly download. */
export function serializeStoryboardScriptRowsToCsv(
  rows: StoryboardScriptRow[],
  columns: readonly StoryboardScriptColumnKey[] = STORYBOARD_SCRIPT_COLUMNS,
): string {
  const keys = columns.length ? [...columns] : [...STORYBOARD_SCRIPT_COLUMNS];
  const header = keys.map((k) => escapeCsvCell(k)).join(',');
  const body = rows.map((row) => keys.map((k) => escapeCsvCell(row?.[k])).join(','));
  return `\ufeff${[header, ...body].join('\r\n')}\r\n`;
}
