import { LOGO_URL } from '../data/content';
import { useSiteLocale } from '../lib/siteLocale';

export function SiteHeader() {
  const { locale, setLocale, t } = useSiteLocale();

  return (
    <header className="pointer-events-none fixed left-0 top-0 z-20 w-full px-6 py-5 md:px-8 md:py-6">
      <div className="pointer-events-auto flex items-center justify-between gap-4">
        <a href="./index.html" className="inline-block" aria-label="AIXFLOW">
          <img
            src={LOGO_URL}
            alt="AIXFLOW"
            className="h-7 w-auto md:h-9"
            width={160}
            height={36}
            decoding="async"
          />
        </a>
        <nav className="flex items-center gap-2 text-xs text-zinc-300 md:gap-3 md:text-sm">
          <a href="./recharge.html" className="rounded-full px-3 py-1.5 transition hover:bg-white/10 hover:text-white">
            {t.navRecharge}
          </a>
          <a
            href="./index.html#download"
            className="rounded-full px-3 py-1.5 transition hover:bg-white/10 hover:text-white"
            title={t.downloadRouteHint}
          >
            {t.navDownload}
          </a>
          <a href="./index.html#contact" className="rounded-full px-3 py-1.5 transition hover:bg-white/10 hover:text-white">
            {t.navContact}
          </a>
          <div
            className="flex items-center rounded-full border border-white/15 bg-white/5 p-0.5"
            role="group"
            aria-label={t.langToggleAria}
          >
            <button
              type="button"
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition md:text-xs ${
                locale === 'zh' ? 'bg-white text-zinc-900' : 'text-zinc-400 hover:text-white'
              }`}
              aria-pressed={locale === 'zh'}
              onClick={() => setLocale('zh')}
            >
              中文
            </button>
            <button
              type="button"
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition md:text-xs ${
                locale === 'en' ? 'bg-white text-zinc-900' : 'text-zinc-400 hover:text-white'
              }`}
              aria-pressed={locale === 'en'}
              onClick={() => setLocale('en')}
            >
              EN
            </button>
          </div>
        </nav>
      </div>
    </header>
  );
}
