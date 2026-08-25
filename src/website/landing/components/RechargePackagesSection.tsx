import {
  LEGAL_FOOTER,
  SOCIAL_LINKS,
  getPayGuideVideoUrl,
} from '../data/content';
import {
  packagesByPriceAsc,
  packageTotalYuanbao,
  type RechargePackage,
} from '../../../shared/rechargePackages';
import { isOverseasSite } from '../lib/siteRegion';
import { useDualInstallerDownload } from '../hooks/useInstallerDownload';
import { setPreferredDownloadRegion } from '../lib/installerDownload';
import { useSiteLocale } from '../lib/siteLocale';
import { Button } from './Button';
import { animClass, useInViewAnimation } from '../hooks/useInViewAnimation';

function PackageCard({ pkg, delay }: { pkg: RechargePackage; delay: string }) {
  const { t } = useSiteLocale();
  const { ref, inView } = useInViewAnimation();
  const total = packageTotalYuanbao(pkg);
  const bonus = pkg.bonusYuanbao ?? 0;
  const label = t.packageLabel[pkg.id];

  return (
    <article
      ref={ref as React.RefObject<HTMLElement>}
      className={`relative flex flex-col rounded-[28px] border px-6 py-7 ${
        pkg.tag
          ? 'border-violet-300/35 bg-[#0a1f2a] shadow-[0_0_0_1px_rgba(167,139,250,0.12)]'
          : 'border-white/10 bg-[#051A24]'
      } ${animClass(inView)}`}
      style={{ animationDelay: delay }}
    >
      {pkg.tag ? (
        <span className="absolute right-5 top-5 rounded-full bg-violet-400/20 px-2.5 py-0.5 text-[11px] font-medium text-violet-100">
          {t.packageTag[pkg.tag]}
        </span>
      ) : null}
      <h3 className="text-lg font-medium text-[#F6FCFF]">{label}</h3>
      <p className="mt-4 flex items-baseline gap-1">
        <span className="text-3xl font-semibold tracking-tight text-white">¥{pkg.priceCny}</span>
        <span className="text-sm text-[#E0EBF0]/55">{t.recharge.cny}</span>
      </p>
      <p className="mt-4 text-sm leading-relaxed text-[#E0EBF0]/90">
        {(() => {
          const text = t.recharge.credited(total);
          const idx = text.indexOf(String(total));
          if (idx < 0) return text;
          return (
            <>
              {text.slice(0, idx)}
              <span className="font-semibold text-white">{total}</span>
              {text.slice(idx + String(total).length)}
            </>
          );
        })()}
        {bonus > 0 ? (
          <span className="mt-1 block text-xs text-[#E0EBF0]/55">
            {t.recharge.includesBonus(pkg.baseYuanbao, bonus)}
          </span>
        ) : (
          <span className="mt-1 block text-xs text-[#E0EBF0]/55">{t.recharge.baseOnly(pkg.baseYuanbao)}</span>
        )}
      </p>
      <p className="mt-3 text-xs text-[#E0EBF0]/45">{t.recharge.productName(label)}</p>
    </article>
  );
}

export function RechargePackagesSection() {
  const { t } = useSiteLocale();
  const { beijingUrl, hongKongUrl, loading } = useDualInstallerDownload();
  const { ref, inView } = useInViewAnimation();
  const packages = packagesByPriceAsc();
  const support = SOCIAL_LINKS.find((s) => s.id === 'qq') || SOCIAL_LINKS.find((s) => s.id === 'wechat');
  const payGuideVideo = getPayGuideVideoUrl();
  const overseas = isOverseasSite();
  const r = t.recharge;

  return (
    <section id="recharge" className="scroll-mt-24 w-full px-6 py-16 md:py-20">
      <div className="mx-auto max-w-5xl">
        <div
          ref={ref as React.RefObject<HTMLElement>}
          className={`mb-10 max-w-2xl ${animClass(inView)}`}
          style={{ animationDelay: '0.05s' }}
        >
          <p className="text-xs tracking-wide text-violet-200/70">{r.eyebrow}</p>
          <h2 className="mt-2 font-serif text-[28px] font-semibold tracking-tight text-zinc-50 md:text-[34px]">
            {r.title}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400 md:text-base">{r.summary}</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {packages.map((pkg, i) => (
            <PackageCard key={pkg.id} pkg={pkg} delay={`${0.1 + i * 0.05}s`} />
          ))}
        </div>

        <div className="mt-10 overflow-hidden rounded-[28px] border border-white/10 bg-black/25">
          <div className="border-b border-white/10 px-6 py-4 md:px-8">
            <h3 className="text-base font-medium text-zinc-100">{r.payGuideTitle}</h3>
            <p className="mt-1 text-xs text-zinc-500">{r.payGuideHint}</p>
          </div>
          <div className="bg-black/40 px-3 py-3 md:px-5 md:py-5">
            <video
              className="aspect-video w-full rounded-2xl bg-black object-contain"
              src={payGuideVideo}
              controls
              playsInline
              preload="metadata"
              title={r.payGuideTitle}
            >
              {r.videoUnsupported}
              <a
                href={payGuideVideo}
                className="text-violet-200 underline-offset-2 hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                {r.openPayGuide}
              </a>
              {r.videoFallback}
            </video>
          </div>
        </div>

        <div className="mt-10 space-y-5 rounded-[28px] border border-white/10 bg-black/25 px-6 py-7 text-sm leading-relaxed text-zinc-300 md:px-8">
          <div>
            <h3 className="text-base font-medium text-zinc-100">{r.howTitle}</h3>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-zinc-400">
              {r.howSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
          <div>
            <h3 className="text-base font-medium text-zinc-100">{r.serviceTitle}</h3>
            <p className="mt-2 text-zinc-400">{r.serviceText}</p>
          </div>
          <div>
            <h3 className="text-base font-medium text-zinc-100">{r.refundTitle}</h3>
            <p className="mt-2 text-zinc-400">{r.refundText}</p>
          </div>
          <div>
            <h3 className="text-base font-medium text-zinc-100">
              {overseas ? r.supportOnlyTitle : r.salesAndSupportTitle}
            </h3>
            <p className="mt-2 text-zinc-400">
              {!overseas ? (
                <>
                  {r.salesEntity(LEGAL_FOOTER.companyName)}
                  <br />
                  {r.officialSite}
                  <br />
                </>
              ) : null}
              {support ? (
                <>
                  {r.supportLabel(support.label, support.detail)}
                  {support.href ? (
                    <>
                      {' '}
                      ·{' '}
                      <a href={support.href} className="text-violet-200/90 underline-offset-2 hover:underline">
                        {r.contactEntry}
                      </a>
                    </>
                  ) : null}
                </>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-3 pt-1">
            {loading ? (
              <span className="inline-flex items-center justify-center rounded-full bg-zinc-700/80 px-5 py-2.5 text-sm font-medium text-zinc-300">
                {t.preparingDownload}
              </span>
            ) : (
              <>
                {beijingUrl ? (
                  <Button
                    href={beijingUrl}
                    variant="secondary"
                    className="px-5 py-2.5 text-sm"
                    download
                    rel="noopener noreferrer"
                    onClick={() => setPreferredDownloadRegion('cn')}
                  >
                    {t.downloadBeijing}
                  </Button>
                ) : null}
                {hongKongUrl ? (
                  <Button
                    href={hongKongUrl}
                    variant="secondary"
                    className="px-5 py-2.5 text-sm"
                    download
                    rel="noopener noreferrer"
                    onClick={() => setPreferredDownloadRegion('hk')}
                  >
                    {t.downloadHongKong}
                  </Button>
                ) : null}
                {!beijingUrl && !hongKongUrl ? (
                  <span className="inline-flex items-center justify-center rounded-full bg-zinc-700/80 px-5 py-2.5 text-sm font-medium text-zinc-300">
                    {t.installerUnavailable}
                  </span>
                ) : null}
              </>
            )}
            <Button href="./index.html#contact" variant="tertiary" className="px-5 py-2.5 text-sm">
              {r.contactSupport}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
