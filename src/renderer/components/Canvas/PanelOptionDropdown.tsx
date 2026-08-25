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
  /**
   * 菜单展开方向：
   * - auto：视口下方空间不足时改为上拉（全屏底部「比例」等场景）
   * - up / down：强制上拉或下拉
   */
  menuPlacement?: 'auto' | 'up' | 'down';
}

type MenuPosStyle = {
  top?: number;
  bottom?: number;
  left: number;
  minWidth: number;
  maxHeight: number;
};

const MENU_GAP_PX = 4;
/** 与 max-h-48 / 每项 py-1.5 text-xs 大致对齐，用于尚未测量时估算 */
const MENU_ITEM_EST_H = 30;
const MENU_MAX_H = 192;

/** 强制清掉残留的下拉透明垫层（HMR / 异常卸载时可能卡住导致整页点不动） */
export function forceRemoveOrphanPanelDropdownPortals(): void {
  if (typeof document === 'undefined') return;
  try {
    document
      .querySelectorAll('.panel-option-dropdown-backdrop, .panel-option-dropdown-menu')
      .forEach((el) => {
        el.parentElement?.removeChild(el);
      });
    window.dispatchEvent(
      new CustomEvent('nexflow-panel-dropdown-open', { detail: { id: '__force_close__' } }),
    );
  } catch {
    /* ignore */
  }
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
  menuPlacement = 'auto',
}) => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const instanceIdRef = useRef(`pod-${Math.random().toString(36).slice(2, 9)}`);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<MenuPosStyle | null>(null);

  const selected = options.find((o) => o.value === value) ?? options[0];

  const updateMenuPos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const minWidth = Math.max(minWidthPx, rect.width);
    const neededH = Math.min(
      MENU_MAX_H,
      Math.max(options.length * MENU_ITEM_EST_H + 8, MENU_ITEM_EST_H + 8),
    );
    const measuredH = menuRef.current?.offsetHeight;
    const estimatedH = Math.min(MENU_MAX_H, Math.max(measuredH || 0, neededH));
    const spaceBelow = Math.max(0, vh - rect.bottom - MENU_GAP_PX);
    const spaceAbove = Math.max(0, rect.top - MENU_GAP_PX);

    let placeUp = menuPlacement === 'up';
    if (menuPlacement === 'auto') {
      placeUp = estimatedH > spaceBelow && spaceAbove > spaceBelow;
    } else if (menuPlacement === 'down') {
      placeUp = false;
    }
    // 强制上拉但上方放不下全部选项、且下方更宽裕时，改向下展开
    if (placeUp && spaceAbove < neededH && spaceBelow >= neededH) {
      placeUp = false;
    } else if (placeUp && spaceAbove < neededH && spaceBelow > spaceAbove) {
      placeUp = false;
    } else if (!placeUp && spaceBelow < neededH && spaceAbove > spaceBelow) {
      placeUp = true;
    }

    const avail = placeUp ? spaceAbove : spaceBelow;
    // 尽量用满可用空间以显示全部选项（3.5 / 4o / 5.6）
    const finalMaxH = Math.max(96, Math.min(MENU_MAX_H, avail > 0 ? Math.max(avail, 96) : MENU_MAX_H));

    let left = rect.left;
    if (left + minWidth > vw - 8) left = Math.max(8, vw - minWidth - 8);
    if (left < 8) left = 8;

    if (placeUp) {
      setMenuStyle({
        bottom: vh - rect.top + MENU_GAP_PX,
        left,
        minWidth,
        maxHeight: finalMaxH,
      });
    } else {
      setMenuStyle({
        top: rect.bottom + MENU_GAP_PX,
        left,
        minWidth,
        maxHeight: finalMaxH,
      });
    }
  }, [menuPlacement, minWidthPx, options.length]);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPos();
    // 菜单渲染后再测一次真实高度，修正上/下方向
    const raf = requestAnimationFrame(() => updateMenuPos());
    window.addEventListener('resize', updateMenuPos);
    window.addEventListener('scroll', updateMenuPos, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', updateMenuPos);
      window.removeEventListener('scroll', updateMenuPos, true);
    };
  }, [open, updateMenuPos]);

  useEffect(() => {
    if (!open) return;
    // 同一时刻只允许一个下拉开着，避免多层透明垫层叠死点击
    const onOtherOpen = (ev: Event) => {
      const detail = (ev as CustomEvent<{ id?: string }>).detail;
      if (detail?.id && detail.id === instanceIdRef.current) return;
      setOpen(false);
    };
    window.addEventListener('nexflow-panel-dropdown-open', onOtherOpen);
    window.dispatchEvent(
      new CustomEvent('nexflow-panel-dropdown-open', {
        detail: { id: instanceIdRef.current },
      }),
    );
    return () => window.removeEventListener('nexflow-panel-dropdown-open', onOtherOpen);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      const t = ev.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDoc, true);
      window.removeEventListener('keydown', onKey, true);
    };
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
          <>
            {/* 透明全屏垫层：确保点空白一定能关掉，避免被 React Flow / 全屏层吞掉外点 */}
            <div
              className="panel-option-dropdown-backdrop fixed inset-0 z-[2147482990]"
              aria-hidden
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
              }}
            />
            <div
              ref={menuRef}
              className={`panel-option-dropdown-menu fixed z-[2147483000] overflow-y-auto rounded-lg border py-1 shadow-xl shadow-black/30 ${
                isDarkMode
                  ? 'border-white/12 text-white bg-zinc-950'
                  : 'panel-option-dropdown-menu--light border-gray-300/60 text-gray-900 bg-white'
              }`}
              style={{
                top: menuStyle.top,
                bottom: menuStyle.bottom,
                left: menuStyle.left,
                minWidth: menuStyle.minWidth,
                maxHeight: menuStyle.maxHeight,
                backgroundColor: isDarkMode ? '#09090b' : '#ffffff',
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
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
            </div>
          </>,
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
        <ChevronDown
          className={`h-3 w-3 shrink-0 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {menu}
    </>
  );
};
