import { Button } from './Button';
import { LOGO_URL } from '../data/content';
import { useSiteLocale } from '../lib/siteLocale';

export function BottomNav() {
  const { t } = useSiteLocale();
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-white px-5 py-2 shadow-vo-secondary md:gap-4 md:px-8">
        <a href="#" className="shrink-0" aria-label={t.navDownload}>
          <img src={LOGO_URL} alt="" className="h-7 w-auto" decoding="async" />
        </a>
        <Button href="./recharge.html" variant="tertiary" className="px-4 py-2 text-sm">
          {t.navRecharge}
        </Button>
        <Button href="#contact" className="px-5 py-2 text-sm">
          {t.contactUs}
        </Button>
      </div>
    </div>
  );
}
