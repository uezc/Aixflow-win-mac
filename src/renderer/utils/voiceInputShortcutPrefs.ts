/**
 * 全局语音听写快捷键（按住说话）：默认 Ctrl+`（Backquote）。
 * 偏好存 localStorage，快捷键面板可改。
 */

export type VoiceInputShortcut = {
  /** KeyboardEvent.code，如 Backquote、KeyM */
  code: string;
  /** 展示用单键字符/名 */
  keyLabel: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

export const VOICE_INPUT_SHORTCUT_LS_KEY = 'nexflow.voiceInput.shortcut.v2';
export const VOICE_INPUT_SHORTCUT_CHANGED_EVENT = 'nexflow-voice-shortcut-changed';

/** 录制中时 FloatingDictationMic 勿抢键 */
export const VOICE_SHORTCUT_RECORDING_ATTR = 'data-nexflow-recording-voice-shortcut';

export const DEFAULT_VOICE_INPUT_SHORTCUT: VoiceInputShortcut = {
  code: 'Backquote',
  keyLabel: '`',
  ctrlKey: true,
  altKey: false,
  shiftKey: false,
  metaKey: false,
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function normalizeShortcut(raw: unknown): VoiceInputShortcut | null {
  if (!isPlainObject(raw)) return null;
  const code = typeof raw.code === 'string' ? raw.code.trim() : '';
  if (!code) return null;
  const keyLabel =
    typeof raw.keyLabel === 'string' && raw.keyLabel.trim()
      ? raw.keyLabel.trim()
      : code.replace(/^Key/, '').replace(/^Digit/, '') || code;
  return {
    code,
    keyLabel,
    ctrlKey: !!raw.ctrlKey,
    altKey: !!raw.altKey,
    shiftKey: !!raw.shiftKey,
    metaKey: !!raw.metaKey,
  };
}

export function readVoiceInputShortcut(): VoiceInputShortcut {
  try {
    const raw = localStorage.getItem(VOICE_INPUT_SHORTCUT_LS_KEY);
    if (!raw) return { ...DEFAULT_VOICE_INPUT_SHORTCUT };
    const parsed = normalizeShortcut(JSON.parse(raw));
    return parsed ? parsed : { ...DEFAULT_VOICE_INPUT_SHORTCUT };
  } catch {
    return { ...DEFAULT_VOICE_INPUT_SHORTCUT };
  }
}

export function writeVoiceInputShortcut(next: VoiceInputShortcut): void {
  const normalized = normalizeShortcut(next) ?? { ...DEFAULT_VOICE_INPUT_SHORTCUT };
  try {
    localStorage.setItem(VOICE_INPUT_SHORTCUT_LS_KEY, JSON.stringify(normalized));
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(VOICE_INPUT_SHORTCUT_CHANGED_EVENT, { detail: normalized }),
    );
  }
}

export function resetVoiceInputShortcut(): VoiceInputShortcut {
  const def = { ...DEFAULT_VOICE_INPUT_SHORTCUT };
  try {
    localStorage.removeItem(VOICE_INPUT_SHORTCUT_LS_KEY);
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(VOICE_INPUT_SHORTCUT_CHANGED_EVENT, { detail: def }));
  }
  return def;
}

/** 展示为 keycap 列表，如 ['Ctrl','Shift','M'] 或 ['`'] */
export function voiceInputShortcutToKeycaps(sc: VoiceInputShortcut): string[] {
  const keys: string[] = [];
  if (sc.ctrlKey || sc.metaKey) keys.push('Ctrl');
  if (sc.altKey) keys.push('Alt');
  if (sc.shiftKey) keys.push('Shift');
  keys.push(formatVoiceKeyLabel(sc));
  return keys;
}

export function formatVoiceKeyLabel(sc: VoiceInputShortcut): string {
  if (sc.code === 'Backquote') return sc.keyLabel === '~' ? '~' : '`';
  if (sc.code === 'Space') return 'Space';
  if (sc.keyLabel && sc.keyLabel.length <= 3) return sc.keyLabel;
  if (sc.code.startsWith('Key') && sc.code.length === 4) return sc.code.slice(3);
  if (sc.code.startsWith('Digit') && sc.code.length === 6) return sc.code.slice(5);
  if (sc.code.startsWith('F') && /^F\d{1,2}$/.test(sc.code)) return sc.code;
  return sc.keyLabel || sc.code;
}

export function formatVoiceInputShortcutLabel(sc: VoiceInputShortcut): string {
  return voiceInputShortcutToKeycaps(sc).join('+');
}

/**
 * 是否命中按住说话快捷键。
 * 无修饰键绑定时：忽略 Shift，使 ` / ~ 同一物理键都能触发。
 */
export function matchesVoiceInputShortcut(e: KeyboardEvent, sc: VoiceInputShortcut): boolean {
  if (e.code !== sc.code) return false;
  if (!!e.ctrlKey !== !!sc.ctrlKey) return false;
  if (!!e.altKey !== !!sc.altKey) return false;
  if (!!e.metaKey !== !!sc.metaKey) return false;
  const hasMods = sc.ctrlKey || sc.altKey || sc.metaKey || sc.shiftKey;
  if (hasMods && !!e.shiftKey !== !!sc.shiftKey) return false;
  return true;
}

/** 从键盘事件生成绑定（忽略纯修饰键） */
export function shortcutFromKeyboardEvent(e: KeyboardEvent): VoiceInputShortcut | null {
  if (e.isComposing) return null;
  const code = e.code;
  if (
    code === 'ControlLeft' ||
    code === 'ControlRight' ||
    code === 'ShiftLeft' ||
    code === 'ShiftRight' ||
    code === 'AltLeft' ||
    code === 'AltRight' ||
    code === 'MetaLeft' ||
    code === 'MetaRight' ||
    code === 'CapsLock' ||
    code === 'Escape' ||
    code === 'Tab'
  ) {
    return null;
  }
  let keyLabel = e.key;
  if (code === 'Backquote') keyLabel = e.shiftKey ? '~' : '`';
  else if (code === 'Space') keyLabel = 'Space';
  else if (e.key.length === 1) keyLabel = e.key.toUpperCase();
  else if (code.startsWith('Key') && code.length === 4) keyLabel = code.slice(3);
  else keyLabel = e.key;

  return {
    code,
    keyLabel,
    ctrlKey: !!e.ctrlKey,
    altKey: !!e.altKey,
    shiftKey: !!e.shiftKey,
    metaKey: !!e.metaKey,
  };
}

export function isVoiceShortcutRecording(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute(VOICE_SHORTCUT_RECORDING_ATTR) === '1';
}

export function setVoiceShortcutRecording(active: boolean): void {
  if (typeof document === 'undefined') return;
  if (active) document.documentElement.setAttribute(VOICE_SHORTCUT_RECORDING_ATTR, '1');
  else document.documentElement.removeAttribute(VOICE_SHORTCUT_RECORDING_ATTR);
}
