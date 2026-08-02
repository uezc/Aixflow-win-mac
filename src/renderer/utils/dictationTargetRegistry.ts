/**
 * 画布级语音听写目标：记录最近一次聚焦的可听写输入，
 * 供居中大话筒在点击失焦后仍能写入正确文本框。
 */

export const DICTATION_TARGET_ATTR = 'data-nexflow-dictation-target';

export type DictationTargetAdapter = {
  getText: () => string;
  setText: (text: string) => void;
  /** 元素仍在 DOM，且当前可写入 */
  isAvailable: () => boolean;
};

const adapters = new WeakMap<Element, DictationTargetAdapter>();
let lastEl: Element | null = null;
let focusTracking = false;

function createNativeFieldAdapter(el: HTMLInputElement | HTMLTextAreaElement): DictationTargetAdapter {
  return {
    getText: () => el.value ?? '',
    setText: (text: string) => {
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      desc?.set?.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    isAvailable: () => el.isConnected && !el.disabled && !el.readOnly,
  };
}

function ensureFocusTracking(): void {
  if (focusTracking || typeof document === 'undefined') return;
  focusTracking = true;
  document.addEventListener(
    'focusin',
    (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const resolved = resolveAdapterForElement(t);
      if (resolved) lastEl = resolved.el;
    },
    true,
  );
}

function resolveAdapterForElement(
  el: Element | null,
): { el: Element; adapter: DictationTargetAdapter } | null {
  let cur: Element | null = el;
  while (cur) {
    const registered = adapters.get(cur);
    if (registered) return { el: cur, adapter: registered };

    if (
      typeof cur.hasAttribute === 'function' &&
      cur.hasAttribute(DICTATION_TARGET_ATTR) &&
      (cur instanceof HTMLTextAreaElement || cur instanceof HTMLInputElement)
    ) {
      let ad = adapters.get(cur);
      if (!ad) {
        ad = createNativeFieldAdapter(cur);
        adapters.set(cur, ad);
      }
      return { el: cur, adapter: ad };
    }
    cur = cur.parentElement;
  }
  return null;
}

/** 注册富文本等非原生控件；返回卸载函数 */
export function registerDictationTarget(el: Element, adapter: DictationTargetAdapter): () => void {
  ensureFocusTracking();
  adapters.set(el, adapter);
  if (el instanceof HTMLElement) {
    el.setAttribute(DICTATION_TARGET_ATTR, '1');
  }
  return () => {
    adapters.delete(el);
    if (lastEl === el) lastEl = null;
  };
}

/** 取最近聚焦的可听写目标（点击大话筒失焦后仍可用） */
export function getLastDictationTarget(): DictationTargetAdapter | null {
  ensureFocusTracking();

  if (lastEl?.isConnected) {
    const ad = adapters.get(lastEl) ?? resolveAdapterForElement(lastEl)?.adapter ?? null;
    if (ad) return ad;
  }

  const active = typeof document !== 'undefined' ? document.activeElement : null;
  if (active instanceof Element) {
    const resolved = resolveAdapterForElement(active);
    if (resolved) {
      lastEl = resolved.el;
      return resolved.adapter;
    }
  }

  return null;
}

export function hasWritableDictationTarget(): boolean {
  const ad = getLastDictationTarget();
  return !!(ad && ad.isAvailable());
}
