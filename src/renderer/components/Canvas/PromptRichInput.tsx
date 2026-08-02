/**
 * 提示词富文本输入：contenteditable + `.ref-pill` 内联胶囊（缩略图 + 名称）。
 * 对外仍以纯文本 value/onChange 对接现有生成逻辑。
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { PromptMentionCandidate } from '../../utils/promptMentionCandidates';
import {
  createRefPillElement,
  handlePillAtomicDelete,
  hydratePlainTextToEditorHtml,
  insertMentionPillAtCaret,
  insertPlainTextAtCaret,
  isRefPillNode,
  parseRefPillHoverMatch,
  REF_PILL_CLASS,
  serializePromptEditor,
  shouldUsePillForCandidate,
  type RefPillHoverMatch,
} from '../../utils/promptRefPill';
import { parseAtMentionQuery } from '../../utils/promptMentionCandidates';
import { registerDictationTarget } from '../../utils/dictationTargetRegistry';

export type { RefPillHoverMatch };

function placeCaretAfter(node: Node) {
  const sel = window.getSelection();
  if (!sel) return;
  const r = document.createRange();
  r.setStartAfter(node);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

export type PromptRichInputHandle = {
  focus: () => void;
  blur: () => void;
  getEditorEl: () => HTMLDivElement | null;
  getPlainText: () => string;
  /** 插入 @ 选中项（媒体→胶囊；文本→纯文本） */
  insertMention: (item: PromptMentionCandidate) => string;
  /** 在末尾或光标处追加纯文本（语音/快捷标签等） */
  appendText: (text: string) => string;
  /** 用纯文本整体重置（并按 candidates 水合胶囊） */
  setPlainText: (text: string) => void;
};

export type PromptRichInputProps = {
  value: string;
  onChange: (plain: string) => void;
  candidates?: PromptMentionCandidate[];
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
  title?: string;
  readOnly?: boolean;
  disabled?: boolean;
  isDarkMode?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  /**
   * Enter 提交（等同点击生成）；Shift+Enter 换行。
   * 会在 onKeyDown 之后触发；若已 preventDefault（如 @ 菜单选中）则跳过。
   * 中文输入法组合中（isComposing / keyCode 229）不触发。
   */
  onSubmit?: () => void;
  onInputCheck?: () => void;
  onCompositionChange?: (composing: boolean) => void;
  /** 悬停/离开 `.ref-pill` 时回调，供右侧参考图联动放大 */
  onRefPillHover?: (match: RefPillHoverMatch | null) => void;
};

export const PromptRichInput = forwardRef<PromptRichInputHandle, PromptRichInputProps>(
  function PromptRichInput(
    {
      value,
      onChange,
      candidates = [],
      className = '',
      style,
      placeholder,
      title,
      readOnly = false,
      disabled = false,
      isDarkMode = true,
      onFocus,
      onBlur,
      onKeyDown,
      onSubmit,
      onInputCheck,
      onCompositionChange,
      onRefPillHover,
    },
    ref,
  ) {
    const editorRef = useRef<HTMLDivElement>(null);
    const focusedRef = useRef(false);
    const composingRef = useRef(false);
    const lastEmittedRef = useRef(value);
    const candidatesRef = useRef(candidates);
    candidatesRef.current = candidates;
    const onRefPillHoverRef = useRef(onRefPillHover);
    onRefPillHoverRef.current = onRefPillHover;
    const lastHoverKeyRef = useRef<string | null>(null);

    const emitRefPillHover = useCallback((match: RefPillHoverMatch | null) => {
      const key = match
        ? [match.insertText, match.thumbUrl || '', match.nodeId || '', String(match.imageIndex1Based ?? '')].join('|')
        : null;
      if (key === lastHoverKeyRef.current) return;
      lastHoverKeyRef.current = key;
      onRefPillHoverRef.current?.(match);
    }, []);

    // 事件委托：动态插入的 pill 也能联动悬停
    useEffect(() => {
      const el = editorRef.current;
      if (!el || !onRefPillHover) return;

      const findPill = (node: EventTarget | null): HTMLElement | null => {
        if (!node || !(node instanceof Element)) return null;
        const pill = node.closest(`.${REF_PILL_CLASS}`) as HTMLElement | null;
        if (!pill || !el.contains(pill) || !isRefPillNode(pill)) return null;
        return pill;
      };

      const onOver = (e: MouseEvent) => {
        const pill = findPill(e.target);
        if (!pill) return;
        emitRefPillHover(parseRefPillHoverMatch(pill));
      };

      const onOut = (e: MouseEvent) => {
        const fromPill = findPill(e.target);
        if (!fromPill) return;
        const related = e.relatedTarget;
        if (related instanceof Node && fromPill.contains(related)) return;
        const nextPill = findPill(related);
        if (nextPill) {
          emitRefPillHover(parseRefPillHoverMatch(nextPill));
          return;
        }
        emitRefPillHover(null);
      };

      el.addEventListener('mouseover', onOver);
      el.addEventListener('mouseout', onOut);
      return () => {
        el.removeEventListener('mouseover', onOver);
        el.removeEventListener('mouseout', onOut);
        if (lastHoverKeyRef.current != null) {
          lastHoverKeyRef.current = null;
          onRefPillHoverRef.current?.(null);
        }
      };
    }, [emitRefPillHover, onRefPillHover]);

    const emitFromDom = useCallback(() => {
      const el = editorRef.current;
      if (!el) return '';
      const plain = serializePromptEditor(el);
      lastEmittedRef.current = plain;
      onChange(plain);
      return plain;
    }, [onChange]);

    const applyHtmlFromPlain = useCallback((plain: string) => {
      const el = editorRef.current;
      if (!el) return;
      const html = hydratePlainTextToEditorHtml(plain, candidatesRef.current);
      el.innerHTML = html || '';
      lastEmittedRef.current = plain;
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => editorRef.current?.focus(),
        blur: () => editorRef.current?.blur(),
        getEditorEl: () => editorRef.current,
        getPlainText: () => {
          const el = editorRef.current;
          return el ? serializePromptEditor(el) : lastEmittedRef.current;
        },
        insertMention: (item: PromptMentionCandidate) => {
          const el = editorRef.current;
          if (!el || disabled || readOnly) return lastEmittedRef.current;
          el.focus();
          const sel = window.getSelection();
          let atIndex = -1;
          if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            if (range.startContainer.nodeType === Node.TEXT_NODE && el.contains(range.startContainer)) {
              const before = String(range.startContainer.textContent || '').slice(0, range.startOffset);
              const parsed = parseAtMentionQuery(before, before.length);
              if (parsed) atIndex = parsed.atIndex;
            }
          }
          if (shouldUsePillForCandidate(item)) {
            if (atIndex >= 0 && insertMentionPillAtCaret(el, item, atIndex)) {
              return emitFromDom();
            }
            const pill = createRefPillElement(item);
            const space = document.createTextNode(' ');
            if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
              const range = sel.getRangeAt(0);
              range.deleteContents();
              range.insertNode(space);
              range.insertNode(pill);
            } else {
              el.appendChild(pill);
              el.appendChild(space);
            }
            placeCaretAfter(space);
          } else {
            insertPlainTextAtCaret(
              el,
              item.insertText || item.content || item.label,
              atIndex >= 0 ? atIndex : null,
            );
          }
          return emitFromDom();
        },
        appendText: (text: string) => {
          const el = editorRef.current;
          if (!el || disabled || readOnly) return lastEmittedRef.current;
          el.focus();
          const cur = serializePromptEditor(el);
          const needSpace = cur.trim().length > 0 && !/\s$/.test(cur) && !text.startsWith('\n');
          const next = cur + (needSpace ? ' ' : '') + text;
          applyHtmlFromPlain(next);
          // caret to end
          const sel = window.getSelection();
          if (sel) {
            const r = document.createRange();
            r.selectNodeContents(el);
            r.collapse(false);
            sel.removeAllRanges();
            sel.addRange(r);
          }
          lastEmittedRef.current = next;
          onChange(next);
          return next;
        },
        setPlainText: (text: string) => {
          applyHtmlFromPlain(text);
          onChange(text);
        },
      }),
      [applyHtmlFromPlain, disabled, emitFromDom, onChange, readOnly],
    );

    // 外部 value 同步（未聚焦时水合）
    useEffect(() => {
      if (focusedRef.current || composingRef.current) return;
      if (value === lastEmittedRef.current) return;
      applyHtmlFromPlain(value);
    }, [value, applyHtmlFromPlain]);

    // 候选变化时刷新缩略图/标签（未聚焦）
    useEffect(() => {
      if (focusedRef.current || composingRef.current) return;
      applyHtmlFromPlain(lastEmittedRef.current);
    }, [candidates, applyHtmlFromPlain]);

    // 初次挂载
    useEffect(() => {
      applyHtmlFromPlain(value);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 注册为画布级大话筒听写目标
    useEffect(() => {
      const el = editorRef.current;
      if (!el) return;
      return registerDictationTarget(el, {
        getText: () => {
          const node = editorRef.current;
          return node ? serializePromptEditor(node) : lastEmittedRef.current;
        },
        setText: (text: string) => {
          applyHtmlFromPlain(text);
          lastEmittedRef.current = text;
          onChange(text);
        },
        isAvailable: () => {
          const node = editorRef.current;
          return !!node?.isConnected && !disabled && !readOnly;
        },
      });
    }, [applyHtmlFromPlain, disabled, onChange, readOnly]);

    const onEditorInput = useCallback(() => {
      if (composingRef.current) {
        onInputCheck?.();
        return;
      }
      emitFromDom();
      onInputCheck?.();
    }, [emitFromDom, onInputCheck]);

    const onEditorKeyDown = useCallback(
      (e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (disabled || readOnly) return;
        if (!composingRef.current && handlePillAtomicDelete(editorRef.current!, e.nativeEvent)) {
          emitFromDom();
          onInputCheck?.();
          return;
        }
        onKeyDown?.(e);
        if (e.defaultPrevented || !onSubmit) return;
        if (e.key !== 'Enter' || e.shiftKey) return;
        // IME 组合中不误发：React composing / native isComposing / 旧 IME keyCode 229
        if (
          composingRef.current ||
          e.nativeEvent.isComposing ||
          (e.nativeEvent as KeyboardEvent).keyCode === 229
        ) {
          return;
        }
        e.preventDefault();
        onSubmit();
      },
      [disabled, readOnly, emitFromDom, onInputCheck, onKeyDown, onSubmit],
    );

    const onPaste = useCallback(
      (e: React.ClipboardEvent<HTMLDivElement>) => {
        if (disabled || readOnly) return;
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        if (!text) return;
        document.execCommand('insertText', false, text);
        emitFromDom();
        onInputCheck?.();
      },
      [disabled, readOnly, emitFromDom, onInputCheck],
    );

    return (
      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        aria-readonly={readOnly || disabled}
        contentEditable={!disabled && !readOnly}
        suppressContentEditableWarning
        data-placeholder={placeholder || ''}
        title={title}
        className={`prompt-rich-input nodrag nopan nowheel ${isDarkMode ? 'is-dark' : 'is-light'} ${
          disabled || readOnly ? 'is-disabled' : ''
        } ${className}`}
        style={style}
        onFocus={() => {
          focusedRef.current = true;
          onFocus?.();
        }}
        onBlur={() => {
          focusedRef.current = false;
          const plain = emitFromDom();
          lastEmittedRef.current = plain;
          onBlur?.();
        }}
        onCompositionStart={() => {
          composingRef.current = true;
          onCompositionChange?.(true);
        }}
        onCompositionEnd={() => {
          // 先同步清 IME 标记，再通知父级并检测 @ / ＠（中文输入法常走 composition）
          composingRef.current = false;
          onCompositionChange?.(false);
          emitFromDom();
          onInputCheck?.();
          // 部分 IME 在 compositionend 之后才落字，再补一次检测
          setTimeout(() => onInputCheck?.(), 0);
        }}
        onInput={onEditorInput}
        onKeyDown={onEditorKeyDown}
        onPaste={onPaste}
        onMouseDown={(e) => e.stopPropagation()}
      />
    );
  },
);

export default PromptRichInput;
