/**
 * 设计师组底栏用暗色风格下拉（避免原生 <select> 白底蓝高亮）。
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

export type DramaFlowGlassSelectOption = { value: string; label: string };

type Props = {
  value: string;
  options: DramaFlowGlassSelectOption[];
  onChange: (value: string) => void;
  isDark: boolean;
  title?: string;
  className?: string;
  menuMinWidth?: number;
};

export function DramaFlowGlassSelect({
  value,
  options,
  onChange,
  isDark,
  title,
  className = '',
  menuMinWidth = 128,
}: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const current = options.find((o) => o.value === value) || options[0];

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      setPos({
        left: r.left,
        top: r.bottom + 4,
        width: Math.max(r.width, menuMinWidth),
      });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (btnRef.current?.contains(t)) return;
      const menus = document.querySelectorAll('[data-drama-flow-glass-select-menu]');
      for (const m of menus) {
        if (m.contains(t)) return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const itemCls = `nodrag flex h-8 w-full items-center px-2.5 text-left text-[11px] transition-colors ${
    isDark
      ? 'text-white/90 hover:bg-sky-500/90 hover:text-white'
      : 'text-gray-800 hover:bg-sky-500 hover:text-white'
  }`;

  return (
    <div className={`relative ${className}`}>
      <button
        ref={btnRef}
        type="button"
        title={title}
        className={`nodrag flex max-w-[10rem] items-center gap-0.5 truncate rounded-lg border-0 bg-transparent px-1.5 py-1 text-[11px] outline-none ${
          isDark ? 'text-white/85' : 'text-gray-800'
        }`}
        onClick={(e) => {
          e.stopPropagation();
          if (open) setOpen(false);
          else openMenu();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <span className="min-w-0 truncate">{current?.label || value}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" strokeWidth={2} />
      </button>
      {open && pos
        ? createPortal(
            <div
              data-drama-flow-glass-select-menu
              className={`nodrag fixed z-[100090] overflow-hidden rounded-lg border shadow-xl ${
                isDark
                  ? 'border-white/15 bg-[#1c1c1e] shadow-black/50'
                  : 'border-gray-200 bg-white shadow-black/10'
              }`}
              style={{ left: pos.left, top: pos.top, width: pos.width }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {options.map((o) => {
                const active = o.value === (current?.value || value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    className={`${itemCls} ${
                      active
                        ? isDark
                          ? 'bg-sky-500/80 text-white'
                          : 'bg-sky-500 text-white'
                        : ''
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange(o.value);
                      setOpen(false);
                    }}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
