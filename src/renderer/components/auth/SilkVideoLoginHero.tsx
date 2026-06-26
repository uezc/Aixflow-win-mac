// @ts-nocheck
import React from 'react';
import LoginSilkVideoBackground from './LoginSilkVideoBackground';

export interface SilkVideoLoginHeroProps {
  brandLabel: string;
  ghostText: string;
  showMarketing?: boolean;
  headerLeftExtra?: React.ReactNode;
  headerRight?: React.ReactNode;
  minHeightClass?: string;
}

const SilkVideoLoginHero: React.FC<SilkVideoLoginHeroProps> = ({
  brandLabel,
  ghostText,
  showMarketing = true,
  headerLeftExtra,
  headerRight,
  minHeightClass = 'min-h-screen',
}) => {
  const viewportHeight = minHeightClass.includes('calc') ? '100%' : '100vh';
  const ghostIsCjk = /[\u4e00-\u9fff]/.test(ghostText);

  return (
    <div
      className={`nexflow-silk-login-hero relative w-full overflow-hidden bg-black ${minHeightClass}`}
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      <div className="relative w-full overflow-hidden" style={{ height: viewportHeight }}>
        <div className="absolute inset-0 z-0">
          <LoginSilkVideoBackground />
        </div>

        {/* Readability overlay */}
        <div
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{
            background:
              'linear-gradient(105deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 45%, rgba(0,0,0,0.35) 100%)',
          }}
          aria-hidden
        />

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
                textShadow: '0 4px 48px rgba(0,0,0,0.45)',
              }}
            >
              {ghostText}
            </span>
          </div>
        ) : null}

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
      </div>
    </div>
  );
};

export default SilkVideoLoginHero;
