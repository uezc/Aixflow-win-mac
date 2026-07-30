/**
 * 提示词内联引用胶囊（对齐 AI CanvasPro `.ref-pill`）：
 * 展示缩略图 + 名称；序列化为 insertText（如 @图片1）供生成逻辑使用。
 */
import type { PromptMentionCandidate } from './promptMentionCandidates';

export const REF_PILL_CLASS = 'ref-pill';
export const REF_PILL_LABEL_CLASS = 'ref-pill-label';
export const REF_PILL_THUMB_CLASS = 'ref-pill-thumb';

export function isRefPillNode(node: Node | null | undefined): node is HTMLElement {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
  return (node as HTMLElement).classList?.contains(REF_PILL_CLASS) ?? false;
}

export function getPillInsertText(el: HTMLElement): string {
  return String(el.dataset.insertText || el.getAttribute('data-insert-text') || '').trim();
}

/** 悬停胶囊时传给面板，用于对齐右侧参考图缩略图 */
export type RefPillHoverMatch = {
  insertText: string;
  refLabel?: string;
  nodeId?: string;
  thumbUrl?: string;
  /** 从 @图片N / @ImageN 解析出的 1-based 序号 */
  imageIndex1Based?: number;
};

/** 从 insertText / label 解析「图片N」类序号（1-based） */
export function parseRefImageIndex1Based(text: string): number | null {
  const s = String(text || '').trim();
  if (!s) return null;
  const m =
    s.match(/@(?:图片|Image|图)\s*(\d+)\s*$/i) ||
    s.match(/(?:^|[\s@])(?:图片|Image|图)\s*(\d+)\s*$/i) ||
    s.match(/^(?:图片|Image|图)\s*(\d+)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

export function parseRefPillHoverMatch(el: HTMLElement): RefPillHoverMatch | null {
  if (!isRefPillNode(el)) return null;
  const insertText = getPillInsertText(el);
  const refLabel = String(el.dataset.refLabel || el.getAttribute('data-ref-label') || '').trim();
  const label = String(el.dataset.label || el.getAttribute('data-label') || '').trim();
  const nodeId = String(el.dataset.nodeId || el.getAttribute('data-node-id') || '').trim() || undefined;
  const dataThumb = String(el.dataset.thumbUrl || el.getAttribute('data-thumb-url') || '').trim();
  const thumbEl = el.querySelector(`img.${REF_PILL_THUMB_CLASS}`) as HTMLImageElement | null;
  const thumbUrl =
    dataThumb ||
    String(thumbEl?.getAttribute('src') || thumbEl?.currentSrc || thumbEl?.src || '').trim() ||
    undefined;
  const imageIndex1Based =
    parseRefImageIndex1Based(insertText) ??
    parseRefImageIndex1Based(refLabel) ??
    parseRefImageIndex1Based(label) ??
    undefined;
  return {
    insertText,
    refLabel: refLabel || undefined,
    nodeId,
    thumbUrl,
    imageIndex1Based,
  };
}

/**
 * 将胶囊匹配到 orderedInputImages 下标。
 * 优先 @图片N 序号（与列表位次一致），其次 thumbUrl；无法对齐则返回 null。
 */
export function resolveRefPillToOrderedIndex(
  match: RefPillHoverMatch | null | undefined,
  orderedInputImages: string[],
): number | null {
  if (!match || !Array.isArray(orderedInputImages) || orderedInputImages.length === 0) return null;
  const urls = orderedInputImages.map((u) => String(u || '').trim());

  if (match.imageIndex1Based != null) {
    const i = match.imageIndex1Based - 1;
    if (i >= 0 && i < urls.length && urls[i]) return i;
  }

  if (match.thumbUrl) {
    const t = match.thumbUrl.trim();
    const byExact = urls.findIndex((u) => u && u === t);
    if (byExact >= 0) return byExact;
    // file:// / 编码差异：用末段文件名兜底
    const base = t.split(/[\\/]/).pop()?.split('?')[0] || '';
    if (base) {
      const byBase = urls.findIndex((u) => {
        if (!u) return false;
        const b = u.split(/[\\/]/).pop()?.split('?')[0] || '';
        return b && b === base;
      });
      if (byBase >= 0) return byBase;
    }
  }

  return null;
}

export function createRefPillElement(
  item: Pick<
    PromptMentionCandidate,
    'label' | 'insertText' | 'thumbUrl' | 'type' | 'origin' | 'nodeId' | 'refLabel'
  >,
): HTMLSpanElement {
  const pill = document.createElement('span');
  pill.className = REF_PILL_CLASS;
  pill.contentEditable = 'false';
  pill.dataset.insertText = String(item.insertText || '').trim();
  pill.dataset.label = String(item.label || item.refLabel || '').trim();
  if (item.refLabel) pill.dataset.refLabel = String(item.refLabel).trim();
  if (item.type) pill.dataset.refType = item.type;
  if (item.origin) pill.dataset.refOrigin = item.origin;
  if (item.nodeId) pill.dataset.nodeId = item.nodeId;
  if (item.thumbUrl) pill.dataset.thumbUrl = String(item.thumbUrl).trim();

  const labelText = String(item.label || item.refLabel || item.insertText || '').trim() || 'ref';

  if (item.thumbUrl) {
    const img = document.createElement('img');
    img.className = REF_PILL_THUMB_CLASS;
    img.src = item.thumbUrl;
    img.alt = '';
    img.draggable = false;
    img.contentEditable = 'false';
    pill.appendChild(img);
  } else {
    const fallback = document.createElement('span');
    fallback.className = `${REF_PILL_THUMB_CLASS} mention-ref-thumb-fallback`;
    fallback.textContent = labelText.slice(0, 2);
    fallback.contentEditable = 'false';
    pill.appendChild(fallback);
  }

  const label = document.createElement('span');
  label.className = REF_PILL_LABEL_CLASS;
  label.textContent = labelText;
  pill.appendChild(label);
  return pill;
}

/** 将编辑器 DOM 序列化为生成用纯文本（pill → insertText） */
export function serializePromptEditor(root: HTMLElement): string {
  const parts: string[] = [];

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent || '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (isRefPillNode(el)) {
      const t = getPillInsertText(el);
      if (t) parts.push(t);
      return;
    }
    if (el.tagName === 'BR') {
      parts.push('\n');
      return;
    }
    if (el.tagName === 'DIV' || el.tagName === 'P') {
      if (parts.length > 0 && !parts[parts.length - 1]?.endsWith('\n')) {
        parts.push('\n');
      }
    }
    Array.from(el.childNodes).forEach(walk);
  };

  Array.from(root.childNodes).forEach(walk);
  return parts.join('').replace(/\u00a0/g, ' ');
}

/** 取光标前纯文本（pill 计入 insertText），用于 @ 触发检测 */
export function getPlainTextBeforeCaret(root: HTMLElement): { text: string; atInCurrentTextNode: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;

  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const textNode = range.startContainer as Text;
    const beforeInNode = String(textNode.textContent || '').slice(0, range.startOffset);
    // 仅用当前 text node 检测 @（与 AI Canvas 一致）；跨 pill 的 @ 无意义
    return { text: beforeInNode, atInCurrentTextNode: range.startOffset };
  }
  return { text: '', atInCurrentTextNode: 0 };
}

export function getCaretClientPoint(root: HTMLElement): { x: number; y: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  const rect = range.getBoundingClientRect();
  if (rect && (rect.width || rect.height || rect.top || rect.left)) {
    return { x: rect.left, y: rect.bottom + 4 };
  }
  const rootRect = root.getBoundingClientRect();
  return { x: rootRect.left + 8, y: rootRect.bottom };
}

/** 在当前选区用胶囊替换 @query，光标落到胶囊后 */
export function insertMentionPillAtCaret(
  root: HTMLElement,
  item: PromptMentionCandidate,
  atIndexInTextNode: number,
): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (range.startContainer.nodeType !== Node.TEXT_NODE) return false;
  const textNode = range.startContainer as Text;
  if (!root.contains(textNode)) return false;

  const full = String(textNode.textContent || '');
  const caret = range.startOffset;
  const atIndex = atIndexInTextNode >= 0 ? atIndexInTextNode : -1;
  if (atIndex < 0 || atIndex > caret) return false;

  const before = full.slice(0, atIndex);
  const after = full.slice(caret);
  const pill = createRefPillElement(item);
  const beforeNode = document.createTextNode(before);
  const afterNode = document.createTextNode(after.startsWith(' ') ? after : ` ${after}`);
  const parent = textNode.parentNode;
  if (!parent) return false;

  parent.replaceChild(afterNode, textNode);
  parent.insertBefore(pill, afterNode);
  parent.insertBefore(beforeNode, pill);

  const next = document.createRange();
  next.setStart(afterNode, after.startsWith(' ') ? 1 : 1);
  next.collapse(true);
  sel.removeAllRanges();
  sel.addRange(next);
  return true;
}

/** 在光标处插入纯文本（替换 @query 或直接插入） */
export function insertPlainTextAtCaret(
  root: HTMLElement,
  text: string,
  atIndexInTextNode: number | null,
): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (range.startContainer.nodeType !== Node.TEXT_NODE) {
    // 退化：在末尾追加
    const spacer = text.endsWith(' ') ? '' : ' ';
    root.appendChild(document.createTextNode(text + spacer));
    return true;
  }
  const textNode = range.startContainer as Text;
  if (!root.contains(textNode)) return false;
  const full = String(textNode.textContent || '');
  const caret = range.startOffset;
  const atIndex = atIndexInTextNode != null && atIndexInTextNode >= 0 ? atIndexInTextNode : caret;
  const before = full.slice(0, atIndex);
  const after = full.slice(caret);
  const spacer = text.endsWith(' ') || text.endsWith('\n') || after.startsWith(' ') ? '' : ' ';
  const nextText = before + text + spacer + after;
  textNode.textContent = nextText;
  const pos = before.length + text.length + spacer.length;
  const next = document.createRange();
  next.setStart(textNode, Math.min(pos, nextText.length));
  next.collapse(true);
  sel.removeAllRanges();
  sel.addRange(next);
  return true;
}

function findRefPillNear(node: Node | null, dir: 'previous' | 'next'): HTMLElement | null {
  let cur: Node | null = node;
  while (cur) {
    if (isRefPillNode(cur)) return cur;
    if (cur.nodeType === Node.TEXT_NODE && !String(cur.textContent || '').replace(/\u00a0/g, ' ').trim()) {
      cur = dir === 'previous' ? cur.previousSibling : cur.nextSibling;
      continue;
    }
    break;
  }
  return null;
}

/** Backspace / Delete 一次删整颗胶囊 */
export function handlePillAtomicDelete(root: HTMLElement, e: KeyboardEvent): boolean {
  if (e.key !== 'Backspace' && e.key !== 'Delete') return false;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);

  if (!range.collapsed) {
    const common = range.commonAncestorContainer;
    const walkerRoot = common.nodeType === Node.ELEMENT_NODE ? (common as HTMLElement) : common.parentElement;
    if (!walkerRoot) return false;
    const pills = Array.from(walkerRoot.querySelectorAll?.('.ref-pill') || []).filter((p) =>
      range.intersectsNode(p),
    );
    if (pills.length === 0 && !isRefPillNode(common as HTMLElement)) return false;
    e.preventDefault();
    pills.forEach((p) => p.remove());
    return true;
  }

  const start = range.startContainer;
  const offset = range.startOffset;
  let pill: HTMLElement | null = null;

  if (start.nodeType === Node.TEXT_NODE) {
    const text = String(start.textContent || '');
    if (e.key === 'Backspace' && offset === 0) {
      pill = findRefPillNear(start.previousSibling, 'previous');
    } else if (e.key === 'Delete' && offset === text.length) {
      pill = findRefPillNear(start.nextSibling, 'next');
    }
  } else if (start.nodeType === Node.ELEMENT_NODE) {
    const el = start as HTMLElement;
    if (e.key === 'Backspace' && offset > 0) {
      pill = findRefPillNear(el.childNodes[offset - 1] || null, 'previous');
    } else if (e.key === 'Delete' && offset < el.childNodes.length) {
      pill = findRefPillNear(el.childNodes[offset] || null, 'next');
    }
  }

  if (!isRefPillNode(pill)) return false;
  e.preventDefault();
  const parent = pill.parentNode;
  const nextSibling = pill.nextSibling;
  pill.remove();
  if (parent) {
    const next = document.createRange();
    if (nextSibling) {
      if (nextSibling.nodeType === Node.TEXT_NODE) {
        next.setStart(nextSibling, 0);
      } else {
        next.setStartBefore(nextSibling);
      }
    } else {
      next.selectNodeContents(parent);
      next.collapse(false);
    }
    sel.removeAllRanges();
    sel.addRange(next);
  }
  return true;
}

/**
 * 将纯文本中的 mention token 还原为带 pill 的 HTML 字符串。
 * 按 insertText 最长优先匹配，避免短 token 误伤。
 */
export function hydratePlainTextToEditorHtml(
  plain: string,
  candidates: PromptMentionCandidate[],
): string {
  const raw = String(plain || '');
  if (!raw) return '';

  const mediaCandidates = candidates
    .filter((c) => c.type !== 'text')
    .slice()
    .sort((a, b) => String(b.insertText || '').length - String(a.insertText || '').length);

  if (mediaCandidates.length === 0) {
    return escapeHtml(raw).replace(/\n/g, '<br>');
  }

  type Part = { type: 'text'; value: string } | { type: 'pill'; item: PromptMentionCandidate };
  let parts: Part[] = [{ type: 'text', value: raw }];

  for (const item of mediaCandidates) {
    const token = String(item.insertText || '').trim();
    if (!token) continue;
    const next: Part[] = [];
    for (const part of parts) {
      if (part.type !== 'text') {
        next.push(part);
        continue;
      }
      let rest = part.value;
      let idx = rest.indexOf(token);
      while (idx >= 0) {
        if (idx > 0) next.push({ type: 'text', value: rest.slice(0, idx) });
        next.push({ type: 'pill', item });
        rest = rest.slice(idx + token.length);
        idx = rest.indexOf(token);
      }
      if (rest) next.push({ type: 'text', value: rest });
    }
    parts = next;
  }

  return parts
    .map((p) => {
      if (p.type === 'text') return escapeHtml(p.value).replace(/\n/g, '<br>');
      return pillToHtml(p.item);
    })
    .join('');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pillToHtml(item: PromptMentionCandidate): string {
  const label = escapeHtml(String(item.label || item.refLabel || item.insertText || '').trim() || 'ref');
  const insertText = escapeHtml(String(item.insertText || '').trim());
  const thumb = item.thumbUrl
    ? `<img class="${REF_PILL_THUMB_CLASS}" src="${escapeHtml(item.thumbUrl)}" alt="" draggable="false" contenteditable="false" />`
    : `<span class="${REF_PILL_THUMB_CLASS} mention-ref-thumb-fallback" contenteditable="false">${label.slice(0, 2)}</span>`;
  const attrs = [
    `class="${REF_PILL_CLASS}"`,
    'contenteditable="false"',
    `data-insert-text="${insertText}"`,
    `data-label="${label}"`,
  ];
  if (item.refLabel) attrs.push(`data-ref-label="${escapeHtml(item.refLabel)}"`);
  if (item.type) attrs.push(`data-ref-type="${escapeHtml(item.type)}"`);
  if (item.origin) attrs.push(`data-ref-origin="${escapeHtml(item.origin)}"`);
  if (item.nodeId) attrs.push(`data-node-id="${escapeHtml(item.nodeId)}"`);
  if (item.thumbUrl) attrs.push(`data-thumb-url="${escapeHtml(item.thumbUrl)}"`);
  return `<span ${attrs.join(' ')}>${thumb}<span class="${REF_PILL_LABEL_CLASS}">${label}</span></span>`;
}

export function shouldUsePillForCandidate(item: PromptMentionCandidate): boolean {
  // 文本类选中后直接展开正文，不做胶囊
  if (item.type === 'text') return false;
  return Boolean(String(item.insertText || '').trim());
}
