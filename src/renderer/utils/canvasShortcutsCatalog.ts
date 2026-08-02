import { canvasShortcutModLabel, canvasShortcutsT } from '../i18n/canvasShortcutsI18n';
import type { AppLocale } from '../i18n/settingsI18n';

export type CanvasShortcutRow = {
  id: string;
  label: string;
  /** 拆成多个 keycap；为空时用 hint */
  keys: string[];
  hint?: string;
};

export type CanvasShortcutSection = {
  id: 'general' | 'edit';
  title: string;
  rows: CanvasShortcutRow[];
};

export type CanvasShortcutOpRow = {
  id: string;
  action: string;
  desc: string;
};

function modKey(): string {
  return canvasShortcutModLabel();
}

/** 默认快捷键列表（与 FlowContent / Workspace 实际绑定一致，无持久化自定义） */
export function buildDefaultCanvasShortcutSections(locale: AppLocale): CanvasShortcutSection[] {
  const t = canvasShortcutsT(locale);
  const m = modKey();
  return [
    { id: 'general', title: t.generalSection, rows: generalRows(t, m) },
    { id: 'edit', title: t.editSection, rows: editRows(t, m) },
  ];
}

/** 常规操作说明：仅保留上方双栏未列出的鼠标操作，避免与快捷键区重复 */
export function buildDefaultCanvasOperationRows(locale: AppLocale): CanvasShortcutOpRow[] {
  const t = canvasShortcutsT(locale);
  const o = t.ops;
  return [
    { id: 'double-click', action: o.doubleClick.action, desc: o.doubleClick.desc },
    { id: 'left-drag', action: o.leftDrag.action, desc: o.leftDrag.desc },
    { id: 'right-click', action: o.rightClick.action, desc: o.rightClick.desc },
    { id: 'box-select', action: o.boxSelect.action, desc: o.boxSelect.desc },
  ];
}

function generalRows(t: ReturnType<typeof canvasShortcutsT>, m: string): CanvasShortcutRow[] {
  void m;
  return [
    { id: 'zoom-in', label: t.zoomIn.label, keys: [t.wheelUpKey] },
    { id: 'zoom-out', label: t.zoomOut.label, keys: [t.wheelDownKey] },
    { id: 'fit-view', label: t.fitView.label, keys: [], hint: t.fitView.hint },
    { id: 'minimap', label: t.minimap.label, keys: [], hint: t.minimap.hint },
    { id: 'pan', label: t.panCanvas.label, keys: [], hint: t.panCanvas.hint },
    { id: 'save', label: t.saveCanvas.label, keys: [], hint: t.saveCanvas.hint },
    { id: 'settings', label: t.openSettings.label, keys: [], hint: t.openSettings.hint },
  ];
}

function editRows(t: ReturnType<typeof canvasShortcutsT>, m: string): CanvasShortcutRow[] {
  return [
    { id: 'cut', label: t.cutNodes.label, keys: [m, 'X'] },
    { id: 'copy', label: t.copyNodes.label, keys: [m, 'C'] },
    { id: 'screenshot', label: t.regionScreenshot.label, keys: ['Alt', '1'] },
    { id: 'paste', label: t.pasteNodes.label, keys: [m, 'V'] },
    { id: 'undo', label: t.undo.label, keys: [m, 'Z'] },
    { id: 'delete', label: t.deleteNodes.label, keys: ['Delete', 'Backspace'] },
    { id: 'multi-select', label: t.multiSelect.label, keys: ['Shift'] },
    { id: 'quick-connect', label: t.quickConnect.label, keys: [m, t.clickKey] },
  ];
}
