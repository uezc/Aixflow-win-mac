// @ts-nocheck
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

export type PanelOption = { value: string; label: string };

export interface PanelOptionDropdownProps {
  value: string;
  options: PanelOption[];
  onChange: (value: string) => void;
  isDarkMode?: boolean;
  title?: string;
  className?: string;
  minWidthPx?: number;
  /** 拼图模块同系触发器样式 */
  triggerVariant?: 'default' | 'collage';
}

/** 画布底部面板用：避免 Electron 在 transform 祖先内渲染原生 select 出现幽灵空框 */
export const PanelOptionDropdown: React.FC<PanelOptionDropdownProps> = ({
  value,
  options,
  onChange,
  isDarkMode = true,
  title,
  className = '',
  minWidthPx = 88,
  triggerVariant = 'default',
}) => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number; minWidth: number } | null>(null);

  const selected = options.find((o) => o.value === value) ?? options[0];

  const updateMenuPos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuStyle({
      top: rect.bottom + 4,
      left: rect.left,
      minWidth: Math.max(minWidthPx, rect.width),
    });
  }, [minWidthPx]);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPos();
    window.addEventListener('resize', updateMenuPos);
    window.addEventListener('scroll', updateMenuPos, true);
    return () => {
      window.removeEventListener('resize', updateMenuPos);
      window.removeEventListener('scroll', updateMenuPos, true);
    };
  }, [open, updateMenuPos]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      const t = ev.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc, true);
    return () => document.removeEventListener('mousedown', onDoc, true);
  }, [open]);

  const triggerSkin =
    triggerVariant === 'collage'
      ? isDarkMode
        ? 'bg-white/15 text-white/85 border border-white/10 hover:bg-white/22'
        : 'bg-black/10 text-gray-800 border border-black/10 hover:bg-black/15'
      : isDarkMode
        ? 'bg-black/30 text-white border border-gray-600/50 hover:bg-black/40'
        : 'bg-white/90 text-gray-900 border border-gray-300 hover:bg-white';

  const menu =
    open && menuStyle && options.length > 0
      ? createPortal(
          <div
            ref={menuRef}
            className={`panel-option-dropdown-menu fixed z-[9999] max-h-48 overflow-y-auto rounded-lg border py-1 shadow-xl shadow-black/30 ${
              isDarkMode
                ? 'border-white/12 text-white'
                : 'panel-option-dropdown-menu--light border-gray-300/60 text-gray-900'
            }`}
            style={{ top: menuStyle.top, left: menuStyle.left, minWidth: menuStyle.minWidth }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`nodrag nopan block w-full px-2 py-1.5 text-left text-xs transition-colors ${
                  opt.value === value
                    ? isDarkMode
                      ? 'bg-violet-500/25 text-white'
                      : 'bg-violet-100 text-violet-900'
                    : isDarkMode
                      ? 'hover:bg-white/10'
                      : 'hover:bg-gray-100'
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={title}
        aria-expanded={open ? 'true' : 'false'}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className={`nodrag nopan inline-flex items-center justify-between gap-1 rounded-lg px-2 py-1 text-xs outline-none ${triggerSkin} ${className}`}
        style={{ minWidth: minWidthPx }}
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {menu}
    </>
  );
};
