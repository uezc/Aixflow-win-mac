/**
 * 分镜素材添加卡 + 大图选择框。额度由父组件传入；未传时默认允许添加。
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Image, Package, PawPrint, Plus, User } from 'lucide-react';

export type DramaShotAddKind = 'scene' | 'character' | 'prop' | 'creature';
export type DramaShotAddOpt = {
  value: string;
  label: string;
  kind: DramaShotAddKind;
  thumb: string;
};

const ADD_KINDS: { id: DramaShotAddKind; label: string; Icon: typeof Image }[] = [
  { id: 'scene', label: '场景', Icon: Image },
  { id: 'character', label: '人物', Icon: User },
  { id: 'prop', label: '道具', Icon: Package },
  { id: 'creature', label: '生物', Icon: PawPrint },
];

function mutedCls(isDark: boolean) {
  return isDark ? 'text-white/50' : 'text-gray-500';
}

export function DramaShotAddAssetCard({
  options,
  onAdd,
  disabled,
  isDark,
  thumbBox,
  allowAddKind,
  quotaLabel,
  onQuotaBlocked,
}: {
  options: DramaShotAddOpt[];
  onAdd: (value: string) => void;
  disabled?: boolean;
  isDark: boolean;
  thumbBox: (extra?: string) => string;
  allowAddKind?: (kind: DramaShotAddKind) => boolean;
  quotaLabel?: string;
  onQuotaBlocked?: (kind: DramaShotAddKind) => void;
}) {
  const allowKind = (kind: DramaShotAddKind) =>
    typeof allowAddKind === 'function' ? !!allowAddKind(kind) : true;
  const quotaText = String(quotaLabel || '添加镜头素材');
  const notifyBlocked = (kind: DramaShotAddKind) => {
    if (typeof onQuotaBlocked === 'function') onQuotaBlocked(kind);
  };
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<DramaShotAddKind | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; height: number } | null>(
    null,
  );

  const items = kind ? options.filter((o) => o.kind === kind) : [];
  const hasAnyAddable = ADD_KINDS.some(
    (k) => allowKind(k.id) && options.some((o) => o.kind === k.id),
  );

  const close = () => {
    setOpen(false);
    setKind(null);
    setPos(null);
  };

  const openPicker = () => {
    const first = ADD_KINDS.find((k) => allowKind(k.id) && options.some((o) => o.kind === k.id));
    setKind(first?.id ?? null);
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open || !btnRef.current) {
      setPos(null);
      return;
    }
    const place = () => {
      const anchor = btnRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(420, Math.max(280, Math.round(window.innerWidth * 0.4)));
      const height = Math.min(720, Math.max(360, Math.round(window.innerHeight * 0.62)));
      let left = anchor.right + 12;
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, anchor.left - 12 - width);
      }
      let top = anchor.top;
      top = Math.min(Math.max(8, top), window.innerHeight - height - 8);
      setPos({ left, top, width, height });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  /** 点空白关闭：非交互控件（页签/素材卡）的区域 */
  const closeOnBlankClick = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement | null;
    if (!el) return;
    if (el.closest('[data-add-asset-keep]')) return;
    close();
  };

  return (
    <div className="relative min-w-0">
      <div className="mb-0.5 truncate text-[11px] font-medium text-violet-300">添加</div>
      <button
        ref={btnRef}
        type="button"
        className={`nodrag ${thumbBox('aspect-[3/4] w-full')} flex items-center justify-center disabled:opacity-40`}
        disabled={disabled || !hasAnyAddable}
        title={
          !options.length
            ? '素材库暂无可添加项'
            : !hasAnyAddable
              ? quotaText
              : `${quotaText} · 添加镜头素材`
        }
        onClick={(e) => {
          e.stopPropagation();
          if (open) close();
          else openPicker();
        }}
      >
        <Plus className={`h-7 w-7 ${isDark ? 'text-white/55' : 'text-gray-500'}`} strokeWidth={1.75} />
      </button>
      {open && pos
        ? createPortal(
            <>
              <div
                className="fixed inset-0 z-[100049]"
                aria-hidden
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  close();
                }}
              />
              <div
                ref={panelRef}
                className={`fixed z-[100050] flex flex-col overflow-hidden rounded-2xl shadow-2xl ${
                  isDark ? 'bg-[#1c1c1e] ring-1 ring-white/15' : 'bg-white ring-1 ring-gray-200'
                }`}
                style={{ left: pos.left, top: pos.top, width: pos.width, height: pos.height }}
                onClick={(e) => {
                  e.stopPropagation();
                  closeOnBlankClick(e);
                }}
              >
                <div
                  className={`shrink-0 border-b px-2 py-1.5 ${
                    isDark ? 'border-white/10' : 'border-gray-200'
                  }`}
                >
                  <div
                    className={`mb-1.5 truncate text-[11px] ${
                      isDark ? 'text-white/55' : 'text-gray-500'
                    }`}
                  >
                    {quotaText}
                  </div>
                  <div className="flex gap-1" data-add-asset-keep>
                    {ADD_KINDS.map((k) => {
                      const count = options.filter((o) => o.kind === k.id).length;
                      const Icon = k.Icon;
                      const on = kind === k.id;
                      const allowed = allowKind(k.id);
                      const blocked = count > 0 && !allowed;
                      return (
                        <button
                          key={k.id}
                          type="button"
                          disabled={!count}
                          title={
                            blocked
                              ? `${k.label} · ${quotaText}`
                              : `${k.label}${count ? ` · ${count}` : ' · 无可添加'}`
                          }
                          className={`nodrag flex min-w-0 flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[12px] disabled:opacity-30 ${
                            on
                              ? 'bg-sky-500/80 text-white'
                              : blocked
                                ? isDark
                                  ? 'bg-white/5 text-white/35'
                                  : 'bg-gray-50 text-gray-400'
                                : isDark
                                  ? 'bg-white/8 text-white/80 hover:bg-white/12'
                                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                          onClick={() => {
                            if (blocked) {
                              notifyBlocked(k.id);
                              return;
                            }
                            setKind((prev) => (prev === k.id ? prev : k.id));
                          }}
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                          <span className="truncate">{k.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-2 custom-scrollbar-dark">
                  {kind && !allowKind(kind) ? (
                    <div
                      className={`flex h-full items-center justify-center px-4 text-center text-[13px] ${mutedCls(isDark)}`}
                    >
                      {quotaText}
                      <br />
                      请先点缩略图右上角 × 移出后再添加
                    </div>
                  ) : items.length ? (
                    <div className="grid grid-cols-2 gap-2">
                      {items.map((o) => {
                        const allowed = allowKind(o.kind);
                        return (
                          <button
                            key={o.value}
                            type="button"
                            data-add-asset-keep
                            title={allowed ? o.label : quotaText}
                            className={`nodrag overflow-hidden rounded-xl text-left ${
                              allowed
                                ? isDark
                                  ? 'ring-1 ring-white/10 hover:ring-white/25'
                                  : 'ring-1 ring-gray-200 hover:ring-gray-300'
                                : 'opacity-40'
                            }`}
                            onClick={() => {
                              if (!allowed) {
                                notifyBlocked(o.kind);
                                return;
                              }
                              onAdd(o.value);
                              close();
                            }}
                          >
                            <div className="flex w-full items-center justify-center bg-white">
                              {o.thumb ? (
                                <img
                                  src={o.thumb}
                                  alt=""
                                  className="block h-auto w-full object-contain"
                                  draggable={false}
                                  loading="lazy"
                                  decoding="async"
                                />
                              ) : (
                                <span className="flex min-h-[6rem] items-center justify-center px-2 text-center text-[12px] leading-snug text-gray-500">
                                  {o.label.replace(/^[^·]*·\s*/, '')}
                                </span>
                              )}
                            </div>
                            <div className="truncate bg-black px-1.5 py-1 text-[11px] text-white">
                              {o.label.replace(/^[^·]*·\s*/, '') || o.label}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div
                      className={`flex h-full items-center justify-center text-[13px] ${mutedCls(isDark)}`}
                    >
                      无可添加
                    </div>
                  )}
                </div>
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
