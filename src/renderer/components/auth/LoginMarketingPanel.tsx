// @ts-nocheck
import React from 'react';
import { Check } from 'lucide-react';
import type { LoginPageStrings } from '../../i18n/loginPageI18n';
import brandLogoUrl from '../../assets/brandLogo';

export function LoginHeroTitle({ t, centered = false, locale = 'zh' }: { t: LoginPageStrings; centered?: boolean; locale?: 'zh' | 'en' }) {
  const align = centered ? 'items-center text-center' : '';
  const lg = centered;
  const titleSize = lg
    ? locale === 'en'
      ? 'text-[2.5rem] sm:text-[2.85rem]'
      : 'text-[3.375rem]'
    : 'text-[2.25rem]';

  const blockGap = lg ? 'gap-5' : 'gap-4';
  const logoSize = lg ? 'w-full max-w-[464px] h-auto' : 'h-8 sm:h-9 w-auto';

  return (
    <div className={`flex max-w-4xl flex-col select-none ${align} ${blockGap}`}>
      <img
        src={brandLogoUrl}
        alt="Aixflow"
        draggable={false}
        className={`mx-auto block object-contain select-none ${logoSize}`}
      />

      <h1
        className={`nexflow-login-hero-title whitespace-nowrap font-bold leading-none tracking-tight text-white ${titleSize}`}
      >
        {t.heroTitle}
      </h1>
      <p
        className={`max-w-lg leading-relaxed text-white/60 ${lg ? 'text-[21px] sm:text-[22.5px]' : 'text-sm sm:text-[15px]'} ${
          centered ? 'mx-auto' : ''
        }`}
      >
        {t.heroSubtitle}
      </p>

      <div className={`flex flex-wrap gap-2 ${lg ? 'gap-3' : ''} ${centered ? 'justify-center' : ''}`}>
        {[t.tagAiGenerate, t.tagBatchCreate].map((tag) => (
          <span
            key={tag}
            className={`inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-500/[0.08] text-amber-100/90 ${
              lg ? 'px-[18px] py-1.5 text-[16.5px] sm:text-lg' : 'px-3 py-1 text-[11px] sm:text-xs'
            }`}
          >
            <Check className={`text-amber-300/90 ${lg ? 'h-[18px] w-[18px]' : 'h-3 w-3'}`} strokeWidth={2.5} />
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

export default LoginHeroTitle;
