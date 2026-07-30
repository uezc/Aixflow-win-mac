/**
 * 对齐 AI CanvasPro `.at-mention-menu`：深色浮层、缩略图 + 名称、键盘上下/Enter/Esc。
 */
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { PromptMentionCandidate } from '../../utils/promptMentionCandidates';

export type AtMentionMenuProps = {
  open: boolean;
  items: PromptMentionCandidate[];
  activeIndex: number;
  x: number;
  y: number;
  onHoverIndex: (index: number) => void;
  onSelect: (item: PromptMentionCandidate) => void;
  onClose: () => void;
  emptyText?: string;
};

const MENU_W = 280;
const MENU_MAX_H = 420;

export const AtMentionMenu: React.FC<AtMentionMenuProps> = ({
  open,
  items,
  activeIndex,
  x,
  y,
  onHoverIndex,
  onSelect,
  onClose,
  emptyText = '无可用引用',
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      const t = ev.target as Node | null;
      if (menuRef.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDoc, true);
    return () => document.removeEventListener('mousedown', onDoc, true);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const el = menuRef.current?.querySelector<HTMLElement>('.at-mention-item.active');
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  if (!open || typeof document === 'undefined') return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = Math.max(8, Math.min(x, vw - MENU_W - 8));
  let top = y;
  const estimatedH = Math.min(MENU_MAX_H, Math.max(80, items.length * 54 + 16));
  if (top + estimatedH > vh - 8 && y > estimatedH + 16) {
    top = Math.max(8, y - estimatedH - 10);
  }

  return createPortal(
    <div
      ref={menuRef}
      className="at-mention-menu prompt-mention-menu nodrag nopan"
      style={{ display: 'flex', left, top }}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      role="listbox"
      aria-label="mention"
    >
      {items.length === 0 ? (
        <div className="at-mention-empty">{emptyText}</div>
      ) : (
        items.map((item, index) => {
          const active = index === activeIndex;
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={active}
              className={`at-mention-item${active ? ' active at-mention-keyboard-active' : ''}`}
              onMouseEnter={() => onHoverIndex(index)}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSelect(item);
              }}
            >
              <span className="at-mention-visual">
                {item.thumbUrl ? (
                  <img className="at-mention-thumb" src={item.thumbUrl} alt="" draggable={false} />
                ) : (
                  <span className="at-mention-thumb mention-ref-thumb-fallback">
                    {(item.refLabel || item.label || '?').slice(0, 2)}
                  </span>
                )}
              </span>
              <span className={`at-mention-copy${item.subtitle ? ' at-mention-has-subtitle' : ''}`}>
                <span className="at-mention-label">{item.label}</span>
                {item.subtitle ? <span className="at-mention-subtitle">{item.subtitle}</span> : null}
              </span>
            </button>
          );
        })
      )}
    </div>,
    document.body,
  );
};

export default AtMentionMenu;
