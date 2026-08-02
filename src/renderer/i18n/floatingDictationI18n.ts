import type { AppLocale } from './settingsI18n';

export type FloatingDictationStrings = {
  startTitle: string;
  stopTitle: string;
  busyTitle: string;
  collapseTitle: string;
  expandTitle: string;
  needFocusToast: string;
  shortcutHint: string;
};

const zh: FloatingDictationStrings = {
  startTitle: '按住说话（Ctrl+S）',
  stopTitle: '松开结束听写',
  busyTitle: '听写处理中…',
  collapseTitle: '收起话筒',
  expandTitle: '展开话筒',
  needFocusToast: '请先点击要输入的文本框',
  shortcutHint: '先点输入框，再按住话筒或按住 Ctrl+S 说话，松开结束',
};

const en: FloatingDictationStrings = {
  startTitle: 'Hold to talk (Ctrl/Cmd+S)',
  stopTitle: 'Release to finish',
  busyTitle: 'Dictation busy…',
  collapseTitle: 'Collapse mic',
  expandTitle: 'Expand mic',
  needFocusToast: 'Please click a text field first',
  shortcutHint: 'Focus a text field, then hold mic or Ctrl/Cmd+S; release to finish',
};

export function floatingDictationT(locale: AppLocale): FloatingDictationStrings {
  return locale === 'en' ? en : zh;
}
