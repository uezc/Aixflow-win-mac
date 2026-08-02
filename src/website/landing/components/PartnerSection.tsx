import { useCallback, useRef } from 'react';
import { LOGO_URL } from '../data/content';
import { animClass, useInViewAnimation } from '../hooks/useInViewAnimation';
import { useSiteLocale } from '../lib/siteLocale';
import { SocialLinks } from './SocialLinks';

type Trail = { id: number; x: number; y: number; src: string; rotation: number };

export function PartnerSection() {
  const { t } = useSiteLocale();
  const { ref, inView } = useInViewAnimation();
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSpawnRef = useRef(0);
  const idRef = useRef(0);
  const trailsRef = useRef<Trail[]>([]);
  const layerRef = useRef<HTMLDivElement>(null);

  const renderTrails = useCallback(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.innerHTML = '';
    for (const trail of trailsRef.current) {
      const img = document.createElement('img');
      img.src = trail.src;
      img.alt = '';
      img.className =
        'pointer-events-none absolute h-24 w-36 rounded-xl object-cover shadow-lg transition-all duration-1000 ease-out';
      img.style.left = `${trail.x}px`;
      img.style.top = `${trail.y}px`;
      img.style.transform = `translate(-50%, -50%) rotate(${trail.rotation}deg) scale(1)`;
      layer.appendChild(img);
      requestAnimationFrame(() => {
        img.style.opacity = '0';
        img.style.transform = `translate(-50%, -50%) rotate(${trail.rotation}deg) scale(0.6)`;
      });
    }
  }, []);

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const now = Date.now();
      if (now - lastSpawnRef.current < 80) return;
      lastSpawnRef.current = now;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const trail: Trail = {
        id: idRef.current++,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        src: LOGO_URL,
        rotation: Math.random() * 20 - 10,
      };

      trailsRef.current = [...trailsRef.current.slice(-12), trail];
      renderTrails();

      window.setTimeout(() => {
        trailsRef.current = trailsRef.current.filter((t) => t.id !== trail.id);
        renderTrails();
      }, 1000);
    },
    [renderTrails],
  );

  return (
    <section id="contact" ref={ref as React.RefObject<HTMLElement>} className="w-full px-6 py-12">
      <div
        ref={containerRef}
        onMouseMove={onMouseMove}
        className={`relative mx-auto max-w-7xl overflow-hidden rounded-[40px] bg-white py-24 shadow-[0_4px_16px_rgba(0,0,0,0.08)] md:py-32 ${animClass(inView)}`}
      >
        <div ref={layerRef} className="pointer-events-none absolute inset-0" />
        <div className="relative z-10 flex flex-col items-center px-6 text-center">
          <h2 className="font-serif text-[40px] leading-none text-[#0D212C] md:text-[56px] lg:text-[64px]">
            {t.contactTitle}
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-[#051A24]/70 md:text-base">
            {t.contactSubtitle}
          </p>
          <SocialLinks theme="light" className="mt-10 justify-center" />
        </div>
      </div>
    </section>
  );
}
