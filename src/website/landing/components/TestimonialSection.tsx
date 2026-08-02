import { Quote } from 'lucide-react';
import { animClass, useInViewAnimation } from '../hooks/useInViewAnimation';
import { useSiteLocale } from '../lib/siteLocale';
import { FeatureVideoPlayer } from './FeatureVideoPlayer';

export function TestimonialSection() {
  const { ref, inView } = useInViewAnimation();
  const { t } = useSiteLocale();

  return (
    <section ref={ref as React.RefObject<HTMLElement>} className="py-12 text-center">
      <div className="mx-auto max-w-2xl px-6">
        <Quote
          className={`mx-auto mb-6 h-6 w-6 text-violet-300 ${animClass(inView)}`}
          style={{ animationDelay: '0.1s' }}
        />
        <h2
          className={`text-[32px] font-normal leading-[1.1] tracking-tight text-zinc-100 md:text-[40px] lg:text-[44px] ${animClass(inView)}`}
          style={{ animationDelay: '0.2s' }}
        >
          <span className="font-serif text-gradient-aix">{t.canvasTitle}</span>
        </h2>
        <p
          className={`mt-6 text-sm text-zinc-400 md:text-base ${animClass(inView)}`}
          style={{ animationDelay: '0.3s' }}
        >
          {t.canvasSubtitle}
        </p>
        <div
          className={`mt-10 flex flex-col items-center gap-3 ${animClass(inView)}`}
          style={{ animationDelay: '0.4s' }}
        >
          <p className="text-base font-medium text-zinc-300">{t.youCan}</p>
          <ul className="flex flex-col gap-2 text-lg font-medium text-zinc-200 md:text-xl">
            {t.youCanItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
      <div
        className={`mt-12 flex justify-center px-6 ${animClass(inView)}`}
        style={{ animationDelay: '0.5s' }}
      >
        <FeatureVideoPlayer />
      </div>
    </section>
  );
}
