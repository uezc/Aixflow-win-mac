import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SCENARIO_CARDS } from '../data/content';
import { animClass, useInViewAnimation } from '../hooks/useInViewAnimation';

function QuoteIcon() {
  return (
    <svg width="32" height="24" viewBox="0 0 32 24" fill="none" aria-hidden="true">
      <path
        d="M0 24V14.4C0 6.4 4.8 0 14.4 0V6.4C9.6 6.4 6.4 9.6 6.4 14.4H12.8V24H0ZM17.6 24V14.4C17.6 6.4 22.4 0 32 0V6.4C27.2 6.4 24 9.6 24 14.4H30.4V24H17.6Z"
        fill="#0D212C"
        fillOpacity="0.15"
      />
    </svg>
  );
}

export function TestimonialCarousel() {
  const { ref, inView } = useInViewAnimation();
  const count = SCENARIO_CARDS.length;
  const items = useMemo(() => [...SCENARIO_CARDS, ...SCENARIO_CARDS, ...SCENARIO_CARDS], []);
  const [index, setIndex] = useState(count);
  const [paused, setPaused] = useState(false);
  const [animating, setAnimating] = useState(false);

  const go = useCallback(
    (dir: -1 | 1) => {
      if (animating) return;
      setAnimating(true);
      setIndex((i) => i + dir);
      window.setTimeout(() => setAnimating(false), 800);
    },
    [animating],
  );

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => go(1), 3000);
    return () => window.clearInterval(timer);
  }, [paused, go]);

  useEffect(() => {
    if (index >= count * 2) {
      const t = window.setTimeout(() => setIndex(count), 800);
      return () => window.clearTimeout(t);
    }
    if (index < count) {
      const t = window.setTimeout(() => setIndex(count * 2 - 1), 800);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [index, count]);

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      className="w-full py-20"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div
        className={`mx-auto mb-12 flex max-w-4xl flex-col gap-4 px-6 md:ml-auto md:flex-row md:items-end md:justify-between ${animClass(inView)}`}
      >
        <h2 className="text-[32px] leading-[1.1] tracking-tight text-zinc-100 md:text-[40px] lg:text-[44px]">
          他们这样用 <span className="font-serif text-gradient-aix">Aixflow</span>
        </h2>
        <p className="text-sm font-medium text-zinc-400">{count} 种典型场景</p>
      </div>

      <div className="relative overflow-hidden px-6">
        <div
          className="flex gap-6 transition-transform duration-[800ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
          style={{ transform: `translateX(calc(-${index} * (min(100vw - 48px, 427.5px) + 24px)))` }}
        >
          {items.map((item, i) => (
            <article
              key={`${item.tag}-${i}`}
              className="w-[calc(100vw-48px)] shrink-0 rounded-[32px] bg-white px-6 py-8 shadow-[0_4px_16px_rgba(0,0,0,0.08)] md:w-[427.5px] md:rounded-[40px] md:pl-10 md:pr-24"
            >
              <QuoteIcon />
              <p className="mt-6 text-base leading-relaxed text-[#0D212C]">{item.quote}</p>
              <p className="mt-8 inline-flex rounded-full bg-[#051A24]/5 px-4 py-1.5 text-sm font-medium text-[#051A24]">
                {item.tag}
              </p>
            </article>
          ))}
        </div>

        <div className="mx-auto mt-8 flex max-w-4xl justify-end gap-3 md:ml-auto">
          <button
            type="button"
            aria-label="上一张"
            onClick={() => go(-1)}
            className="flex h-12 w-12 items-center justify-center rounded-full border border-zinc-500/40 text-zinc-200"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="下一张"
            onClick={() => go(1)}
            className="flex h-12 w-12 items-center justify-center rounded-full border border-zinc-500/40 text-zinc-200"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>
    </section>
  );
}
