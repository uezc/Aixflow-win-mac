import { LEGAL_FOOTER, LOGO_URL } from '../data/content';
import { isOverseasSite } from '../lib/siteRegion';
import { useSiteLocale } from '../lib/siteLocale';
import { SocialLinks } from './SocialLinks';

export function Footer() {
  return (
    <footer className="mx-auto flex w-full max-w-[1200px] flex-col gap-10 px-6 py-12 md:flex-row md:items-start md:justify-between">
      <a href="./index.html" className="inline-block shrink-0">
        <img src={LOGO_URL} alt="AIXFLOW" className="h-8 w-auto opacity-90" decoding="async" />
      </a>
      <SocialLinks theme="dark" className="md:justify-end" />
    </footer>
  );
}

export function CopyrightBar() {
  const { t } = useSiteLocale();
  const showBeian = !isOverseasSite();
  const copyrightName = isOverseasSite() ? 'Aixflow' : LEGAL_FOOTER.companyName;

  return (
    <div className="border-t border-zinc-800/80 px-6 py-6">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col items-center gap-3 text-center text-xs text-zinc-500 sm:text-sm">
        <p>{t.copyrightAllRights(copyrightName)}</p>
        {showBeian ? (
          <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <a
              href={LEGAL_FOOTER.icpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="transition hover:text-zinc-300"
            >
              {LEGAL_FOOTER.icp}
            </a>
            <span className="hidden text-zinc-700 sm:inline">|</span>
            <a
              href={LEGAL_FOOTER.gonganUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 transition hover:text-zinc-300"
            >
              <img
                src="https://www.beian.gov.cn/img/new/gongan.png"
                alt=""
                className="h-4 w-4"
                decoding="async"
              />
              {LEGAL_FOOTER.gongan}
            </a>
          </p>
        ) : null}
        <a href="./index.html#contact" className="text-zinc-600 transition hover:text-zinc-300">
          {t.contactUs}
        </a>
      </div>
    </div>
  );
}
