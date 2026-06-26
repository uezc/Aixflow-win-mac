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
import { TestimonialCarousel } from './components/TestimonialCarousel';
import { TestimonialSection } from './components/TestimonialSection';
import { animClass, useInViewAnimation } from './hooks/useInViewAnimation';

export default function App() {
  const { ref, inView } = useInViewAnimation();

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
          地心引力聚合平台Aixflow
        </p>
        <p
          className={`mb-2 text-xs text-violet-200/80 md:text-sm ${animClass(inView)}`}
          style={{ animationDelay: '0.2s' }}
        >
          AI工作流与内容生产平台
        </p>
        <h1
          className={`text-[28px] leading-[1.25] tracking-tight text-zinc-100 md:text-[36px] lg:text-[40px] ${animClass(inView)}`}
          style={{ animationDelay: '0.3s' }}
        >
          <span className="font-serif text-gradient-aix">一体化AI生产系统</span>
          <br />
          <span className="font-serif text-gradient-aix">让创意直接变成结果</span>
        </h1>
        <div
          className={`mt-5 flex flex-col gap-5 text-sm leading-relaxed text-zinc-300 md:mt-6 md:text-base md:leading-loose ${animClass(inView)}`}
          style={{ animationDelay: '0.4s' }}
        >
          <p>
            连接AI模型、工作流与自动化流程，
            <br className="hidden sm:block" />
            在一个无限画布中完成内容生产与业务执行。
          </p>
          <p>
            从电商内容到营销素材，
            <br className="hidden sm:block" />
            从文案生成到视频与图像，
            <br className="hidden sm:block" />
            从单点工具到完整生产线。
          </p>
          <p>为创作者、团队与企业打造。</p>
        </div>
        <div
          id="download"
          className={`mt-5 flex flex-col gap-3 sm:flex-row md:mt-6 md:gap-4 ${animClass(inView)}`}
          style={{ animationDelay: '0.5s' }}
        >
          <DownloadButton />
          <Button href="#work" variant="secondary">
            了解更多
          </Button>
        </div>
      </header>

      <MarqueeVideos />
      <TestimonialSection />
      <PricingSection />
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
