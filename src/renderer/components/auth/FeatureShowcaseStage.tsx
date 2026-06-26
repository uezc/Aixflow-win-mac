// @ts-nocheck
import React, { useEffect, useRef, useCallback } from 'react';
import { Play, ArrowRight, ShoppingCart } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type FeatureShowcaseItem = {
  id: string;
  icon: LucideIcon;
  label: string;
  variant: 'image' | 'video' | 'tryon' | 'chart' | 'detail' | 'poster' | 'copy' | 'matting' | 'batch';
};

const CARD_TOP_GLOW: Record<FeatureShowcaseItem['variant'], string> = {
  image: 'from-violet-500/40 via-transparent to-transparent',
  video: 'from-sky-500/35 via-transparent to-transparent',
  tryon: 'from-rose-500/35 via-transparent to-transparent',
  chart: 'from-emerald-500/30 via-transparent to-transparent',
  detail: 'from-amber-500/30 via-transparent to-transparent',
  poster: 'from-orange-500/35 via-transparent to-transparent',
  copy: 'from-cyan-500/35 via-transparent to-transparent',
  matting: 'from-fuchsia-500/35 via-transparent to-transparent',
  batch: 'from-lime-500/30 via-transparent to-transparent',
};

function FeaturePortraitCard({
  label,
  variant,
  className = '',
  landscape = false,
  fillCell = false,
}: {
  label: string;
  variant: FeatureShowcaseItem['variant'];
  className?: string;
  landscape?: boolean;
  fillCell?: boolean;
}) {
  const aspectClass = fillCell ? 'h-full min-h-0' : landscape ? 'aspect-[4/3]' : 'aspect-[3/4]';
  return (
    <article
      className={`group relative flex ${aspectClass} flex-col overflow-hidden rounded-xl border border-white/[0.1] bg-[#121218]/95 shadow-[0_12px_40px_rgba(0,0,0,0.55)] transition-transform duration-300 hover:scale-[1.02] sm:rounded-2xl ${className}`}
    >
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b ${CARD_TOP_GLOW[variant]}`}
      />
      <div className="relative border-b border-white/[0.06] px-2.5 py-2 sm:px-3 sm:py-2.5">
        <h3 className="text-[10px] font-medium leading-snug text-white/88 sm:text-[11px]">{label}</h3>
      </div>
      <div className="relative min-h-0 flex-1 bg-gradient-to-b from-[#16161c] to-[#0a0a0e] p-2 sm:p-2.5">
        {variant === 'image' && (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <div className="relative h-[42%] w-[58%] rounded-lg bg-gradient-to-br from-zinc-600 via-zinc-700 to-zinc-900 shadow-inner">
              <div className="absolute inset-x-2 top-2 h-2 rounded-full bg-white/15" />
              <div className="absolute bottom-2 left-1/2 h-3 w-[70%] -translate-x-1/2 rounded-full bg-zinc-800" />
            </div>
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-7 w-7 rounded border border-white/10 bg-white/[0.06] sm:h-8 sm:w-8" />
              ))}
            </div>
          </div>
        )}
        {variant === 'video' && (
          <div className="relative flex h-full flex-col justify-center gap-2 px-1">
            <div className="relative mx-auto aspect-video w-[88%] overflow-hidden rounded-md border border-white/10 bg-zinc-800">
              <div className="absolute inset-0 bg-gradient-to-br from-zinc-600/80 to-zinc-900" />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
                  <Play className="ml-0.5 h-3.5 w-3.5 fill-white text-white" />
                </span>
              </div>
            </div>
            <div className="mx-auto h-1 w-[75%] rounded-full bg-white/15">
              <div className="h-full w-1/3 rounded-full bg-amber-400/70" />
            </div>
          </div>
        )}
        {variant === 'tryon' && (
          <div className="flex h-full items-end justify-center gap-1.5 pb-1 sm:gap-2">
            <div className="h-[72%] w-[28%] rounded-t-full bg-gradient-to-t from-zinc-600 to-zinc-800" />
            <ArrowRight className="mb-[28%] h-3.5 w-3.5 shrink-0 text-amber-400/70" />
            <div className="h-[78%] w-[30%] rounded-t-full bg-gradient-to-t from-amber-600/70 to-amber-900/40" />
          </div>
        )}
        {variant === 'chart' && (
          <div className="flex h-full flex-col justify-between p-1">
            <p className="text-right text-[10px] font-semibold tabular-nums text-amber-300/95 sm:text-xs">
              ¥ 128,560
            </p>
            <svg viewBox="0 0 120 48" className="h-[55%] w-full" preserveAspectRatio="none">
              <polyline
                fill="none"
                stroke="url(#goldLine)"
                strokeWidth="2"
                strokeLinecap="round"
                points="0,40 18,32 36,36 54,22 72,26 90,12 108,8 120,4"
              />
              <defs>
                <linearGradient id="goldLine" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#d4a853" />
                  <stop offset="100%" stopColor="#f5e6c8" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        )}
        {variant === 'detail' && (
          <div className="flex h-full items-center justify-center">
            <div className="h-[88%] w-[52%] overflow-hidden rounded-lg border border-white/12 bg-zinc-900">
              <div className="h-[38%] bg-gradient-to-br from-zinc-600 to-zinc-800" />
              <div className="space-y-1 p-1.5">
                <div className="h-1 w-full rounded bg-white/12" />
                <div className="h-1 w-4/5 rounded bg-white/8" />
                <div className="mx-auto mt-2 flex h-4 w-[80%] items-center justify-center gap-0.5 rounded bg-orange-500/85 text-[6px] text-white">
                  <ShoppingCart className="h-2 w-2" />
                  <span>加购</span>
                </div>
              </div>
            </div>
          </div>
        )}
        {variant === 'poster' && (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 bg-gradient-to-b from-orange-950/50 to-black/60 p-2 text-center">
            <span className="text-[11px] font-black tracking-[0.2em] text-amber-200 sm:text-xs">SUMMER</span>
            <span className="text-sm font-black tracking-widest text-white sm:text-base">SALE</span>
            <div className="mt-1 h-10 w-10 rounded-lg bg-gradient-to-br from-zinc-500 to-zinc-800 sm:h-12 sm:w-12" />
          </div>
        )}
        {variant === 'copy' && (
          <div className="flex h-full flex-col justify-center gap-1.5 px-1.5">
            {[0.95, 0.72, 0.85, 0.6].map((w, i) => (
              <div
                key={i}
                className="h-1.5 rounded-full bg-white/12"
                style={{ width: `${w * 100}%` }}
              />
            ))}
            <div className="mt-1 self-end rounded bg-cyan-500/20 px-1.5 py-0.5 text-[7px] text-cyan-100">AI</div>
          </div>
        )}
        {variant === 'matting' && (
          <div className="relative flex h-full items-center justify-center">
            <div className="absolute inset-2 rounded-lg bg-[linear-gradient(45deg,#555_25%,transparent_25%,transparent_75%,#555_75%),linear-gradient(45deg,#555_25%,transparent_25%,transparent_75%,#555_75%)] bg-[length:8px_8px] bg-[position:0_0,4px_4px] opacity-40" />
            <div className="relative h-[62%] w-[48%] rounded-lg bg-gradient-to-br from-fuchsia-400/80 to-violet-700 shadow-lg" />
          </div>
        )}
        {variant === 'batch' && (
          <div className="grid h-full grid-cols-3 gap-1 p-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded border border-lime-400/20 bg-lime-500/10" />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function ShowcasePedestal({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) {
  if (compact) {
    return (
      <div className="relative flex h-full min-h-0 flex-col">
        <div className="pointer-events-none absolute inset-0 flex items-end justify-center">
          <div className="mb-0 h-[55%] w-full bg-[radial-gradient(ellipse_at_50%_100%,rgba(212,168,83,0.14),transparent_74%)]" />
        </div>
        <div className="pointer-events-none absolute bottom-0 left-1/2 h-[8%] w-[min(90%,500px)] -translate-x-1/2 rounded-[100%] border border-amber-500/20 bg-gradient-to-t from-amber-600/[0.14] via-amber-500/[0.05] to-transparent" />
        <div className="relative z-[1] h-full min-h-0 w-full">{children}</div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-[min(48vh,380px)] flex-1 flex-col items-center justify-end pb-[min(8vh,72px)] pt-4 lg:min-h-0 lg:pb-[min(10vh,88px)]">
      {/* 展台光晕 */}
      <div className="pointer-events-none absolute inset-0 flex items-end justify-center">
        <div className="mb-[2%] h-[55%] w-[min(92%,680px)] bg-[radial-gradient(ellipse_at_50%_100%,rgba(212,168,83,0.2),transparent_68%)]" />
      </div>
      <div className="pointer-events-none absolute bottom-[6%] left-1/2 h-[14%] w-[min(78%,560px)] -translate-x-1/2 rounded-[100%] border border-amber-500/30 bg-gradient-to-t from-amber-600/[0.22] via-amber-500/[0.08] to-transparent shadow-[0_0_80px_rgba(212,168,83,0.25)]" />
      <div className="pointer-events-none absolute bottom-[10%] left-1/2 h-16 w-[50%] max-w-md -translate-x-1/2 rounded-full bg-amber-400/[0.1] blur-2xl" />

      <div className="relative z-[1] w-full max-w-[min(100%,820px)] px-2 sm:px-4">{children}</div>
    </div>
  );
}

function FeatureCarousel({ items, landscape = false }: { items: FeatureShowcaseItem[]; landscape?: boolean }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const segmentWidthRef = useRef(0);
  const pausedRef = useRef(false);
  const draggingRef = useRef(false);
  const dragStateRef = useRef({ active: false, startX: 0, startScroll: 0 });
  const loopItems = [...items, ...items, ...items];

  const measureSegment = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || items.length === 0) return;
    segmentWidthRef.current = el.scrollWidth / 3;
    if (segmentWidthRef.current > 0 && el.scrollLeft < segmentWidthRef.current * 0.1) {
      el.scrollLeft = segmentWidthRef.current;
    }
  }, [items.length]);

  useEffect(() => {
    measureSegment();
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measureSegment());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureSegment]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let raf = 0;
    const speed = 0.38;
    const normalize = () => {
      const seg = segmentWidthRef.current;
      if (seg <= 0) return;
      if (el.scrollLeft >= seg * 2) el.scrollLeft -= seg;
      else if (el.scrollLeft < seg * 0.5) el.scrollLeft += seg;
    };
    const tick = () => {
      if (!pausedRef.current && !draggingRef.current && segmentWidthRef.current > 0) {
        el.scrollLeft += speed;
        normalize();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const resumeSoon = () => {
    window.setTimeout(() => {
      if (!draggingRef.current) pausedRef.current = false;
    }, 1400);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const el = scrollerRef.current;
    if (!el) return;
    draggingRef.current = true;
    pausedRef.current = true;
    dragStateRef.current = { active: true, startX: e.clientX, startScroll: el.scrollLeft };
    el.setPointerCapture(e.pointerId);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const el = scrollerRef.current;
    dragStateRef.current.active = false;
    draggingRef.current = false;
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    const seg = segmentWidthRef.current;
    if (el && seg > 0) {
      if (el.scrollLeft >= seg * 2) el.scrollLeft -= seg;
      else if (el.scrollLeft < seg * 0.5) el.scrollLeft += seg;
    }
    resumeSoon();
  };

  return (
    <div className="relative w-full xl:hidden">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-[2] w-8 bg-gradient-to-r from-[#08080a] to-transparent sm:w-12" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-[2] w-8 bg-gradient-to-r from-transparent to-[#08080a] sm:w-12" />
      <div
        ref={scrollerRef}
        className="flex cursor-grab gap-3 overflow-x-auto py-1 [-ms-overflow-style:none] [scrollbar-width:none] active:cursor-grabbing [&::-webkit-scrollbar]:hidden"
        style={{ scrollSnapType: 'x mandatory', touchAction: 'pan-x' }}
        onPointerDown={onPointerDown}
        onPointerMove={(e) => {
          if (!dragStateRef.current.active) return;
          const el = scrollerRef.current;
          if (!el) return;
          el.scrollLeft = dragStateRef.current.startScroll - (e.clientX - dragStateRef.current.startX);
        }}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(e) => {
          const el = scrollerRef.current;
          if (!el || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
          pausedRef.current = true;
          el.scrollLeft += e.deltaY;
          resumeSoon();
        }}
      >
        {loopItems.map((f, i) => (
          <FeaturePortraitCard
            key={`${f.id}-${i}`}
            label={f.label}
            variant={f.variant}
            landscape={landscape}
            className={
              landscape
                ? 'w-[clamp(148px,36vw,196px)] shrink-0 snap-center'
                : 'w-[clamp(118px,28vw,150px)] shrink-0 snap-center'
            }
          />
        ))}
      </div>
    </div>
  );
}

/** 参考图：大屏 3×N 展台网格 + 小屏横向轮播；compact 用于登录页左栏 */
const FeatureShowcaseStage: React.FC<{
  items: FeatureShowcaseItem[];
  compact?: boolean;
  gridRows?: number;
}> = ({ items, compact = false, gridRows = 2 }) => (
  <ShowcasePedestal compact={compact}>
    <div
      className={
        compact
          ? 'hidden h-full grid-cols-3 gap-2 sm:grid sm:gap-2.5'
          : 'hidden grid-cols-3 gap-3 xl:grid xl:gap-3.5'
      }
      style={compact ? { gridTemplateRows: `repeat(${gridRows}, minmax(0, 1fr))` } : undefined}
    >
      {items.map((f) => (
        <FeaturePortraitCard
          key={f.id}
          label={f.label}
          variant={f.variant}
          landscape={compact}
          fillCell={compact}
          className="w-full"
        />
      ))}
    </div>
    <div className={compact ? 'sm:hidden' : 'xl:hidden'}>
      <FeatureCarousel items={items} landscape={compact} />
    </div>
  </ShowcasePedestal>
);

export default FeatureShowcaseStage;
