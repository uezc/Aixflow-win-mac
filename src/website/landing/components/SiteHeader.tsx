import { LOGO_URL } from '../data/content';

export function SiteHeader() {
  return (
    <header className="pointer-events-none fixed left-0 top-0 z-20 w-full px-6 py-5 md:px-8 md:py-6">
      <a href="#" className="pointer-events-auto inline-block" aria-label="AIXFLOW">
        <img
          src={LOGO_URL}
          alt="AIXFLOW"
          className="h-7 w-auto md:h-9"
          width={160}
          height={36}
          decoding="async"
        />
      </a>
    </header>
  );
}
