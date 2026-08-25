import { AixflowDotCanvas } from './components/AixflowDotCanvas';
import { BottomNav } from './components/BottomNav';
import { MarqueeVideos } from './components/MarqueeVideos';
import { DownloadButton } from './components/DownloadButton';
import { Button } from './components/Button';
import { SiteHeader } from './components/SiteHeader';
import { CopyrightBar, Footer } from './components/Footer';
import { PartnerSection } from './components/PartnerSection';
import { PricingSection } from './components/PricingSection';
import { ProjectsSection } from './components/ProjectsSection';
import { RechargePackagesSection } from './components/RechargePackagesSection';
import { TestimonialCarousel } from './components/TestimonialCarousel';
import { TestimonialSection } from './components/TestimonialSection';
import { animClass, useInViewAnimation } from './hooks/useInViewAnimation';
import { useSiteLocale } from './lib/siteLocale';

export default function App() {
  const { ref, inView } = useInViewAnimation();
  const { t } = useSiteLocale();
  const [p1a, p1b] = t.heroP1.split('\n');

  return (
    <>
      <AixflowDotCanvas />
      <SiteHeader />
      <div className="relative z-10 pb-28">
        <header
          ref={ref as React.RefObject<HTMLElement>}
          className="mx-auto max-w-[480px] px-6 pt-12 md:pt-16"
        >
          <p
            className={`mb-4 font-serif text-[32px] font-semibold tracking-tight text-zinc-50 md:text-[40px] lg:text-[44px] ${animClass(inView)}`}
            style={{ animationDelay: '0.1s' }}
          >
            {t.heroBrand}
          </p>
          <p
            className={`mb-2 text-xs text-violet-200/80 md:text-sm ${animClass(inView)}`}
            style={{ animationDelay: '0.2s' }}
          >
            {t.heroEyebrow}
          </p>
          <h1
            className={`text-[28px] leading-[1.25] tracking-tight text-zinc-100 md:text-[36px] lg:text-[40px] ${animClass(inView)}`}
            style={{ animationDelay: '0.3s' }}
          >
            <span className="font-serif text-gradient-aix">{t.heroLine1}</span>
            <br />
            <span className="font-serif text-gradient-aix">{t.heroLine2}</span>
          </h1>
          <div
            className={`mt-5 flex flex-col gap-5 text-sm leading-relaxed text-zinc-300 md:mt-6 md:text-base md:leading-loose ${animClass(inView)}`}
            style={{ animationDelay: '0.4s' }}
          >
            <p>
              {p1a}
              <br className="hidden sm:block" />
              {p1b}
            </p>
            <p>
              {t.heroP2a}
              <br className="hidden sm:block" />
              {t.heroP2b}
              <br className="hidden sm:block" />
              {t.heroP2c}
            </p>
            <p>{t.heroP3}</p>
          </div>
          <div
            id="download"
            className={`mt-5 flex flex-col gap-3 md:mt-6 ${animClass(inView)}`}
            style={{ animationDelay: '0.5s' }}
          >
            <DownloadButton />
            <Button href="./recharge.html" variant="secondary">
              {t.viewRecharge}
            </Button>
          </div>
        </header>

        <MarqueeVideos />
        <TestimonialSection />
        <PricingSection />
        <RechargePackagesSection />
        <TestimonialCarousel />
        <div id="work">
          <ProjectsSection />
        </div>
        <PartnerSection />
        <Footer />
        <CopyrightBar />
        <BottomNav />
      </div>
    </>
  );
}
