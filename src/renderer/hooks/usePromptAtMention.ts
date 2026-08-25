/**
 * 对齐 AI CanvasPro `_checkAtTrigger` / `_handleMentionMenuKeyboard` / `_insertMentionPill`：
 * - 检测 @ / ＠（textarea 或 contenteditable）
 * - IME composition 延后
 * - 键盘 ↑↓ Enter Esc
 * - 选中后插入：富文本胶囊 或 纯文本 token
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useStore } from 'reactflow';
import {
  applyMentionInsert,
  buildPromptMentionCandidates,
  parseAtMentionQuery,
  type MentionInputAudioRef,
  type PromptMentionCandidate,
} from '../utils/promptMentionCandidates';
import { getCaretClientPoint } from '../utils/promptRefPill';
import type { PromptRichInputHandle } from '../components/Canvas/PromptRichInput';

export type UsePromptAtMentionOptions = {
  nodeId: string;
  value: string;
  /** 旧版 textarea；与 richEditorRef 二选一 */
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  /** 富文本 contenteditable 手柄 */
  richEditorRef?: RefObject<PromptRichInputHandle | null>;
  enabled?: boolean;
  composing?: boolean;
  orderedInputImages?: string[];
  /** 面板已挂载参考音（与 @音频N / 声音标签对齐） */
  orderedInputAudios?: MentionInputAudioRef[];
  locale?: string;
  preferSeedanceTag?: boolean;
  onApply: (next: string) => void;
};

type MenuState = {
  open: boolean;
  query: string;
  atIndex: number;
  x: number;
  y: number;
  activeIndex: number;
};

const CLOSED: MenuState = {
  open: false,
  query: '',
  atIndex: -1,
  x: 0,
  y: 0,
  activeIndex: 0,
};

function getCaretViewportPoint(textarea: HTMLTextAreaElement, position: number): { x: number; y: number } {
  const rect = textarea.getBoundingClientRect();
  const style = window.getComputedStyle(textarea);
  const div = document.createElement('div');
  const span = document.createElement('span');
  const mirrorProps = [
    'boxSizing',
    'width',
    'height',
    'overflowX',
    'overflowY',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'fontStyle',
    'fontVariant',
    'fontWeight',
    'fontStretch',
    'fontSize',
    'fontSizeAdjust',
    'lineHeight',
    'fontFamily',
    'textAlign',
    'textTransform',
    'textIndent',
    'textDecoration',
    'letterSpacing',
    'wordSpacing',
    'tabSize',
    'whiteSpace',
    'wordBreak',
    'wordWrap',
  ] as const;
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordWrap = 'break-word';
  div.style.top = '0';
  div.style.left = '-9999px';
  mirrorProps.forEach((p) => {
    // @ts-expect-error CSSStyleDeclaration index
    div.style[p] = style[p];
  });
  div.style.width = `${textarea.clientWidth}px`;
  const value = textarea.value;
  div.textContent = value.slice(0, position);
  span.textContent = value.slice(position) || '.';
  div.appendChild(span);
  document.body.appendChild(div);
  const spanRect = span.getBoundingClientRect();
  const divRect = div.getBoundingClientRect();
  const x = rect.left + (spanRect.left - divRect.left) - textarea.scrollLeft;
  const y = rect.top + (spanRect.top - divRect.top) - textarea.scrollTop + spanRect.height + 5;
  document.body.removeChild(div);
  return {
    x: Number.isFinite(x) ? x : rect.left + 12,
    y: Number.isFinite(y) ? y : rect.bottom,
  };
}

export function usePromptAtMention(opts: UsePromptAtMentionOptions) {
  const {
    nodeId,
    value,
    textareaRef,
    richEditorRef,
    enabled = true,
    composing = false,
    orderedInputImages = [],
    orderedInputAudios = [],
    locale,
    preferSeedanceTag = false,
    onApply,
  } = opts;

  const nodes = useStore((s) => s.nodes) ?? [];
  const edges = useStore((s) => s.edges) ?? [];
  const [menu, setMenu] = useState<MenuState>(CLOSED);
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menu.open;
  /**
   * IME 合成态用 ref 同步闸门：compositionend 里若只靠 React setState(composing)，
   * 紧接着的 @ 检测仍会读到旧的 true，导致中文模式下 @ / ＠ 不弹菜单。
   * 注意：不要在每次 render 用 props 覆盖 ref，否则会盖掉 composition 回调里的同步写入。
   */
  const composingRef = useRef(!!composing);
  useEffect(() => {
    composingRef.current = !!composing;
  }, [composing]);

  const items = useMemo(
    () =>
      buildPromptMentionCandidates({
        targetNodeId: nodeId,
        nodes: nodes as any,
        edges: edges as any,
        orderedInputImages,
        orderedInputAudios,
        locale,
        query: menu.query,
        preferSeedanceTag,
      }),
    [nodeId, nodes, edges, orderedInputImages, orderedInputAudios, locale, menu.query, preferSeedanceTag],
  );

  /** 完整候选（无 query），供富文本水合缩略图 */
  const allCandidates = useMemo(
    () =>
      buildPromptMentionCandidates({
        targetNodeId: nodeId,
        nodes: nodes as any,
        edges: edges as any,
        orderedInputImages,
        orderedInputAudios,
        locale,
        query: '',
        preferSeedanceTag,
      }),
    [nodeId, nodes, edges, orderedInputImages, orderedInputAudios, locale, preferSeedanceTag],
  );

  const closeMenu = useCallback(() => setMenu(CLOSED), []);

  /** 供 PromptRichInput onCompositionChange 同步写入，避免中文 IME 竞态 */
  const onMentionCompositionChange = useCallback((next: boolean) => {
    composingRef.current = !!next;
  }, []);

  const checkAtTrigger = useCallback(() => {
    if (!enabled) return;
    if (composingRef.current) return;

    const richEl = richEditorRef?.current?.getEditorEl?.() ?? null;
    if (richEl) {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) {
        if (menuOpenRef.current) closeMenu();
        return;
      }
      const range = sel.getRangeAt(0);
      if (!richEl.contains(range.startContainer) || range.startContainer.nodeType !== Node.TEXT_NODE) {
        if (menuOpenRef.current) closeMenu();
        return;
      }
      const before = String(range.startContainer.textContent || '').slice(0, range.startOffset);
      const parsed = parseAtMentionQuery(before, before.length);
      if (!parsed) {
        if (menuOpenRef.current) closeMenu();
        return;
      }
      const pt = getCaretClientPoint(richEl) || { x: 0, y: 0 };
      setMenu((prev) => ({
        open: true,
        query: parsed.query,
        atIndex: parsed.atIndex,
        x: pt.x,
        y: pt.y,
        activeIndex: prev.open && prev.query === parsed.query ? prev.activeIndex : 0,
      }));
      return;
    }

    const el = textareaRef?.current;
    if (!el) return;
    const cursor = el.selectionStart ?? 0;
    const parsed = parseAtMentionQuery(el.value, cursor);
    if (!parsed) {
      if (menuOpenRef.current) closeMenu();
      return;
    }
    const pt = getCaretViewportPoint(el, parsed.atIndex);
    setMenu((prev) => ({
      open: true,
      query: parsed.query,
      atIndex: parsed.atIndex,
      x: pt.x,
      y: pt.y,
      activeIndex: prev.open && prev.query === parsed.query ? prev.activeIndex : 0,
    }));
  }, [enabled, richEditorRef, textareaRef, closeMenu]);

  const selectItem = useCallback(
    (item: PromptMentionCandidate) => {
      if (richEditorRef?.current) {
        const next = richEditorRef.current.insertMention(item);
        onApply(next);
        closeMenu();
        requestAnimationFrame(() => richEditorRef.current?.focus());
        return;
      }
      const el = textareaRef?.current;
      if (!el) return;
      const cursor = el.selectionStart ?? value.length;
      const { next, cursor: nextCursor } = applyMentionInsert(el.value, cursor, item.insertText);
      onApply(next);
      closeMenu();
      requestAnimationFrame(() => {
        const t = textareaRef?.current;
        if (!t) return;
        t.focus();
        try {
          t.setSelectionRange(nextCursor, nextCursor);
        } catch {
          /* ignore */
        }
      });
    },
    [richEditorRef, textareaRef, value, onApply, closeMenu],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement | HTMLDivElement>) => {
      if (!enabled) return;
      if (!menu.open) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setMenu((m) => ({
          ...m,
          activeIndex: items.length ? (m.activeIndex + 1) % items.length : 0,
        }));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setMenu((m) => ({
          ...m,
          activeIndex: items.length ? (m.activeIndex - 1 + items.length) % items.length : 0,
        }));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (!items.length) return;
        e.preventDefault();
        e.stopPropagation();
        const item = items[Math.max(0, Math.min(menu.activeIndex, items.length - 1))];
        if (item) selectItem(item);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
      }
    },
    [enabled, menu.open, menu.activeIndex, items, selectItem, closeMenu],
  );

  const onChangeCheck = useCallback(() => {
    // 合成中跳过；合成结束时由 compositionchange 同步清 ref 后再检测。
    // 再延后一帧，兼容部分中文输入法先 input 再 compositionend 的顺序。
    requestAnimationFrame(() => {
      if (composingRef.current) {
        setTimeout(() => {
          if (!composingRef.current) checkAtTrigger();
        }, 0);
        return;
      }
      checkAtTrigger();
    });
  }, [checkAtTrigger]);

  useEffect(() => {
    if (!menu.open) return;
    if (items.length === 0) return;
    setMenu((m) => (m.activeIndex >= items.length ? { ...m, activeIndex: 0 } : m));
  }, [items.length, menu.open]);

  return {
    mentionMenuProps: {
      open: menu.open && enabled,
      items,
      activeIndex: menu.activeIndex,
      x: menu.x,
      y: menu.y,
      onHoverIndex: (index: number) => setMenu((m) => ({ ...m, activeIndex: index })),
      onSelect: selectItem,
      onClose: closeMenu,
      emptyText: locale === 'en' ? 'No upstream media' : '无上游素材',
    },
    mentionCandidates: allCandidates,
    onMentionKeyDown: onKeyDown,
    onMentionInputCheck: onChangeCheck,
    onMentionCompositionChange,
    closeMentionMenu: closeMenu,
  };
}
