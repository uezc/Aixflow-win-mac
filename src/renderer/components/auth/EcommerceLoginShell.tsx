// @ts-nocheck
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { loginPageT, type LoginPageLocale } from '../../i18n/loginPageI18n';
import LoginHeroTitle from './LoginMarketingPanel';
import LoginSilkVideoBackground from './LoginSilkVideoBackground';

/** 与主进程默认窗口一致，全屏时整页等比放大此画布 */
export const LOGIN_SHELL_DESIGN_WIDTH = 1200;
export const LOGIN_SHELL_DESIGN_HEIGHT = 800;

export interface EcommerceLoginShellProps {
  locale: LoginPageLocale;
  headerLeftExtra?: React.ReactNode;
  headerRight?: React.ReactNode;
  loginCard: React.ReactNode;
  loginFooter?: React.ReactNode;
  loading?: boolean;
  cardTitle?: string;
  cardSubtitle?: string;
  wideCard?: boolean;
}

function useLoginShellScale() {
  const [scale, setScale] = useState(1);

  const updateScale = useCallback(() => {
    const w = window.innerWidth || LOGIN_SHELL_DESIGN_WIDTH;
    const h = window.innerHeight || LOGIN_SHELL_DESIGN_HEIGHT;
    setScale(Math.min(w / LOGIN_SHELL_DESIGN_WIDTH, h / LOGIN_SHELL_DESIGN_HEIGHT));
  }, []);

  useEffect(() => {
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [updateScale]);

  return scale;
}

const EcommerceLoginShell: React.FC<EcommerceLoginShellProps> = ({
  locale,
  headerLeftExtra,
  headerRight,
  loginCard,
  loginFooter,
  loading = false,
  cardTitle,
  cardSubtitle,
  wideCard = false,
}) => {
  const t = loginPageT(locale);
  const loginPanelRef = useRef<HTMLDivElement>(null);
  const scale = useLoginShellScale();

  return (
    <section
      className="relative flex h-screen w-full select-none items-center justify-center overflow-hidden bg-black"
      onMouseDown={(e) => {
        const el = e.target as HTMLElement;
        if (el.closest('#nexflow-login-panel')) return;
        if (el.closest('button, a, input, textarea, select, [role="button"], [role="menuitem"]')) return;
        e.preventDefault();
      }}
    >
      {/* 背景视频铺满视口，object-cover 保持比例；UI 画布单独等比缩放 */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <LoginSilkVideoBackground />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(105deg, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.45) 42%, rgba(0,0,0,0.55) 100%)',
          }}
          aria-hidden
        />
      </div>

      {(headerLeftExtra || headerRight) ? (
        <div
          className="pointer-events-none fixed inset-x-0 top-0 z-20 flex items-start justify-between gap-3 px-5 py-4 sm:px-6 sm:py-5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div className="pointer-events-auto min-w-0 shrink-0">{headerLeftExtra ?? null}</div>
          {headerRight ? (
            <div className="pointer-events-auto flex shrink-0 items-center gap-2 sm:gap-3">{headerRight}</div>
          ) : null}
        </div>
      ) : null}

      <div
        className="nexflow-login-shell-canvas relative z-10 shrink-0 overflow-hidden"
        style={{
          width: LOGIN_SHELL_DESIGN_WIDTH,
          height: LOGIN_SHELL_DESIGN_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
        }}
      >
        <div
          className="relative flex h-full flex-col overflow-hidden"
          style={{ fontFamily: "'Inter', sans-serif" }}
        >
          <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
            <div
              className="nexflow-login-hero-column flex w-[55%] min-w-0 items-center justify-center px-10"
              onMouseDown={(e) => e.preventDefault()}
            >
              <LoginHeroTitle t={t} centered locale={locale} />
            </div>

            <div className="flex w-[45%] shrink-0 items-center justify-center p-6 pr-10">
              <div
                ref={loginPanelRef}
                id="nexflow-login-panel"
                className={`flex h-full max-h-[620px] w-full flex-col select-text ${
                  wideCard ? 'max-w-[440px]' : 'max-w-[380px]'
                }`}
              >
                <div className="nexflow-glass-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/[0.12] backdrop-blur-xl">
                  <div
                    className={`flex min-h-0 flex-1 flex-col overflow-y-auto custom-scrollbar-dark ${
                      wideCard ? 'p-5 sm:p-6' : 'p-5 sm:p-6'
                    }`}
                  >
                    <div className="mb-4 shrink-0 text-left">
                      <h2 className="text-xl font-semibold tracking-tight text-white">
                        {cardTitle ?? t.welcomeBack}
                      </h2>
                      <p className="mt-1.5 text-sm leading-snug text-white/60">
                        {cardSubtitle ?? t.welcomeSubtitle}
                      </p>
                    </div>
                    {loading ? (
                      <div className="flex items-center justify-center py-10">
                        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-white" />
                      </div>
                    ) : (
                      <div className="flex flex-col">{loginCard}</div>
                    )}
                  </div>
                  {loginFooter ? (
                    <div className="shrink-0 border-t border-white/10 px-5 py-3 sm:px-6">{loginFooter}</div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default EcommerceLoginShell;
