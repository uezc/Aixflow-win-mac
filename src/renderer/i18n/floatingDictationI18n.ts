import type { AppLocale } from './settingsI18n';
import {
  formatVoiceInputShortcutLabel,
  readVoiceInputShortcut,
} from '../utils/voiceInputShortcutPrefs';

export type FloatingDictationStrings = {
  startTitle: string;
  stopTitle: string;
  busyTitle: string;
  needFocusToast: string;
  shortcutHint: string;
  dragHint: string;
  dockHint: string;
};

function buildZh(keyLabel: string): FloatingDictationStrings {
  return {
    startTitle: `按住说话（${keyLabel}）`,
    stopTitle: '松开结束听写',
    busyTitle: '听写处理中…',
    needFocusToast: '请先点击要输入的文本框',
    shortcutHint: `先点输入框，再按住话筒或按住 ${keyLabel} 说话，松开结束`,
    dragHint: '拖动可移动；靠近窗口边缘松开会半露收起',
    dockHint: '拖回画布可展开',
  };
}

function buildEn(keyLabel: string): FloatingDictationStrings {
  return {
    startTitle: `Hold to talk (${keyLabel})`,
    stopTitle: 'Release to finish',
    busyTitle: 'Dictation busy…',
    needFocusToast: 'Please click a text field first',
    shortcutHint: `Focus a text field, then hold mic or ${keyLabel}; release to finish`,
    dragHint: 'Drag to move; release near an edge to dock half-visible',
    dockHint: 'Drag back onto the canvas to expand',
  };
}

export function floatingDictationT(locale: AppLocale): FloatingDictationStrings {
  const keyLabel = formatVoiceInputShortcutLabel(readVoiceInputShortcut());
  return locale === 'en' ? buildEn(keyLabel) : buildZh(keyLabel);
}
