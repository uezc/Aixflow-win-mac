// @ts-nocheck
import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';

export const TOONHUB_IMAGES = [
  {
    src: 'https://nexflow-temp-images-bj.oss-cn-beijing.aliyuncs.com/%E5%B0%8F%E6%A9%99.png',
    bg: '#F4845F',
    panel: '#F79B7F',
  },
  {
    src: 'https://nexflow-temp-images-bj.oss-cn-beijing.aliyuncs.com/%E7%BB%BF%E8%89%B2.png',
    bg: '#6BBF7A',
    panel: '#85CC92',
  },
  {
    src: 'https://nexflow-temp-images-bj.oss-cn-beijing.aliyuncs.com/%E5%B0%8F%E7%B2%89.png',
    bg: '#E882B4',
    panel: '#ED9DC4',
  },
  {
    src: 'https://nexflow-temp-images-bj.oss-cn-beijing.aliyuncs.com/%E5%B0%8F%E8%93%9D.png',
    bg: '#6EB5FF',
    panel: '#8DC4FF',
  },
] as const;

const GRAIN_BG = `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E")`;

const TRANSITION = 'transform 650ms cubic-bezier(0.4,0,0.2,1), filter 650ms cubic-bezier(0.4,0,0.2,1), opacity 650ms cubic-bezier(0.4,0,0.2,1), left 650ms cubic-bezier(0.4,0,0.2,1)';

type CarouselRole = 'center' | 'left' | 'right' | 'back';

function getRole(imageIndex: number, activeIndex: number): CarouselRole {
  if (imageIndex === activeIndex) return 'center';
  if (imageIndex === (activeIndex + 3) % 4) return 'left';
  if (imageIndex === (activeIndex + 1) % 4) return 'right';
  return 'back';
}

function getItemStyle(role: CarouselRole, isMobile: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    aspectRatio: '0.6 / 1',
    transition: TRANSITION,
    willChange: 'transform, filter, opacity',
  };

  switch (role) {
    case 'center':
      return {
        ...base,
        left: '50%',
        bottom: isMobile ? '26%' : '12%',
        height: isMobile ? '48%' : '73.6%',
        transform: `translateX(-50%) scale(${isMobile ? 1 : 1.344})`,
        filter: 'blur(0px)',
        opacity: 1,
        zIndex: 20,
      };
    case 'left':
      return {
        ...base,
        left: isMobile ? '20%' : '30%',
        bottom: isMobile ? '36%' : '24%',
        height: isMobile ? '12.8%' : '22.4%',
        transform: 'translateX(-50%) scale(1)',
        filter: 'blur(2px)',
        opacity: 0.85,
        zIndex: 10,
      };
    case 'right':
      return {
        ...base,
        left: isMobile ? '80%' : '70%',
        bottom: isMobile ? '36%' : '24%',
        height: isMobile ? '12.8%' : '22.4%',
        transform: 'translateX(-50%) scale(1)',
        filter: 'blur(2px)',
        opacity: 0.85,
        zIndex: 10,
      };
    case 'back':
      return {
        ...base,
        left: '50%',
        bottom: isMobile ? '36%' : '24%',
        height: isMobile ? '10.4%' : '17.6%',
        transform: 'translateX(-50%) scale(1)',
        filter: 'blur(4px)',
        opacity: 1,
        zIndex: 5,
      };
    default:
      return base;
  }
}

export interface ToonhubLoginHeroProps {
  brandLabel: string;
  ghostText: string;
  figurineTitle: string;
  figurineDesc: string;
  showDiscover?: boolean;
  showMarketing?: boolean;
  onDiscover?: () => void;
  headerLeftExtra?: React.ReactNode;
  headerRight?: React.ReactNode;
  minHeightClass?: string;
  onActivePanelChange?: (panelColor: string) => void;
}

const ToonhubLoginHero: React.FC<ToonhubLoginHeroProps> = ({
  brandLabel,
  ghostText,
  figurineTitle,
  figurineDesc,
  showDiscover = false,
  showMarketing = true,
  onDiscover,
  headerLeftExtra,
  headerRight,
  minHeightClass = 'min-h-screen',
  onActivePanelChange,
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false,
  );

  useEffect(() => {
    TOONHUB_IMAGES.forEach((item) => {
      const img = new Image();
      img.src = item.src;
    });
  }, []);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const navigate = useCallback((dir: 'next' | 'prev') => {
    if (isAnimating) return;
    setIsAnimating(true);
    setActiveIndex((prev) => (dir === 'next' ? (prev + 1) % 4 : (prev + 3) % 4));
    window.setTimeout(() => setIsAnimating(false), 650);
  }, [isAnimating]);

  const activeBg = TOONHUB_IMAGES[activeIndex].bg;
  const activePanel = TOONHUB_IMAGES[activeIndex].panel;
  const viewportHeight = minHeightClass.includes('calc') ? '100%' : '100vh';
  const ghostIsCjk = /[\u4e00-\u9fff]/.test(ghostText);

  useEffect(() => {
    onActivePanelChange?.(activePanel);
  }, [activePanel, onActivePanelChange]);

  return (
    <div
      className={`nexflow-toonhub-hero relative w-full overflow-hidden ${minHeightClass}`}
      style={{
        backgroundColor: activeBg,
        transition: 'background-color 650ms cubic-bezier(0.4,0,0.2,1)',
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <div className="relative w-full overflow-hidden" style={{ height: viewportHeight }}>
        {/* Grain */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            zIndex: 50,
            opacity: 0.4,
            backgroundImage: GRAIN_BG,
            backgroundSize: '200px 200px',
            backgroundRepeat: 'repeat',
          }}
          aria-hidden
        />

        {/* Ghost text */}
        {showMarketing ? (
          <div
            className="pointer-events-none absolute inset-x-0 top-[18%] z-[2] flex select-none items-center justify-center"
            aria-hidden
          >
            <span
              className={`text-center text-white ${ghostIsCjk ? 'whitespace-nowrap px-4' : 'whitespace-nowrap uppercase'}`}
              style={{
                fontFamily: ghostIsCjk ? "'Inter', sans-serif" : "'Anton', sans-serif",
                fontSize: ghostIsCjk ? 'clamp(97px, 21.85vw, 294px)' : 'clamp(207px, 64.4vw, 874px)',
                fontWeight: ghostIsCjk ? 700 : 900,
                lineHeight: 1.05,
                letterSpacing: ghostIsCjk ? '0.02em' : '-0.02em',
              }}
            >
              {ghostText}
            </span>
          </div>
        ) : null}

        {/* Brand */}
        <div className="absolute left-4 top-6 z-[60] flex items-center gap-3 sm:left-8">
          <span
            className="text-xs font-semibold uppercase text-white"
            style={{ opacity: 0.9, letterSpacing: '0.18em' }}
          >
            {brandLabel}
          </span>
          {headerLeftExtra}
        </div>

        {headerRight ? (
          <div className="absolute right-4 top-5 z-[60] flex items-center gap-2 sm:right-8">{headerRight}</div>
        ) : null}

        {/* Carousel */}
        <div className="absolute inset-0 z-[3]">
          {TOONHUB_IMAGES.map((item, index) => {
            const role = getRole(index, activeIndex);
            return (
              <div key={item.src} style={getItemStyle(role, isMobile)}>
                <img
                  src={item.src}
                  alt=""
                  draggable={false}
                  className="h-full w-full object-contain"
                  style={{ objectPosition: 'bottom center' }}
                />
              </div>
            );
          })}
        </div>

        {/* Bottom-left */}
        {showMarketing ? (
          <div className="absolute bottom-6 left-4 z-[60] max-w-[320px] sm:bottom-20 sm:left-24">
            <p
              className="mb-2 text-base font-bold uppercase tracking-widest text-white sm:mb-3 sm:text-[22px]"
              style={{ opacity: 0.95, letterSpacing: '0.02em' }}
            >
              {figurineTitle}
            </p>
            <p
              className="mb-4 hidden text-xs text-white sm:mb-5 sm:block sm:text-sm"
              style={{ opacity: 0.85, lineHeight: 1.6 }}
            >
              {figurineDesc}
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => navigate('prev')}
                className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white bg-transparent text-white transition-[transform,background-color] duration-150 hover:scale-[1.08] hover:bg-white/[0.12] sm:h-16 sm:w-16"
                aria-label="Previous"
              >
                <ArrowLeft size={26} strokeWidth={2.25} />
              </button>
              <button
                type="button"
                onClick={() => navigate('next')}
                className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white bg-transparent text-white transition-[transform,background-color] duration-150 hover:scale-[1.08] hover:bg-white/[0.12] sm:h-16 sm:w-16"
                aria-label="Next"
              >
                <ArrowRight size={26} strokeWidth={2.25} />
              </button>
            </div>
          </div>
        ) : null}

        {/* Bottom-right discover */}
        {showMarketing && showDiscover && onDiscover ? (
          <button
            type="button"
            onClick={onDiscover}
            className="group absolute bottom-6 right-4 z-[60] flex items-center uppercase text-white transition-opacity duration-200 hover:opacity-100 sm:bottom-20 sm:right-10"
            style={{
              fontFamily: "'Anton', sans-serif",
              fontSize: 'clamp(20px, 4vw, 56px)',
              fontWeight: 400,
              opacity: 0.95,
              letterSpacing: '-0.02em',
              lineHeight: 1,
            }}
          >
            DISCOVER
            <ArrowRight className="ml-2 h-5 w-5 sm:h-8 sm:w-8" strokeWidth={2.25} />
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default ToonhubLoginHero;
