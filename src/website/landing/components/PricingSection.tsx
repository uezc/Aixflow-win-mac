import { FEATURE_CARDS } from '../data/content';
import { animClass, useInViewAnimation } from '../hooks/useInViewAnimation';

function FeatureGroups({
  groups,
  labelClass,
  textClass,
}: {
  groups: { label: string; text: string }[];
  labelClass: string;
  textClass: string;
}) {
  return (
    <div className="mt-5 space-y-3.5">
      {groups.map((group) => (
        <div key={`${group.label}-${group.text.slice(0, 12)}`}>
          <p className={`text-xs tracking-wide ${labelClass}`}>{group.label}</p>
          <p className={`mt-1 text-sm leading-relaxed ${textClass}`}>{group.text}</p>
        </div>
      ))}
    </div>
  );
}

export function PricingSection() {
  const { ref, inView } = useInViewAnimation();
  const [canvasCard, productionCard] = FEATURE_CARDS;

  return (
    <section ref={ref as React.RefObject<HTMLElement>} className="w-full px-6 py-12">
      <div className="mx-auto grid max-w-4xl grid-cols-1 gap-8 md:ml-auto md:grid-cols-2 md:justify-end">
        <article
          className={`rounded-[40px] bg-[#051A24] pb-10 pl-10 pr-10 pt-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] md:pr-12 ${animClass(inView)}`}
          style={{ animationDelay: '0.1s' }}
        >
          <h3 className="text-[22px] font-medium text-[#F6FCFF]">{canvasCard.title}</h3>
          <p className="mt-3 text-sm text-[#E0EBF0]/90">{canvasCard.summary}</p>
          <FeatureGroups
            groups={canvasCard.groups}
            labelClass="text-[#E0EBF0]/45"
            textClass="text-[#E0EBF0]/85"
          />
        </article>

        <article
          className={`rounded-[40px] bg-white pb-10 pl-10 pr-10 pt-8 shadow-[0_4px_16px_rgba(0,0,0,0.08)] md:pr-12 ${animClass(inView)}`}
          style={{ animationDelay: '0.2s' }}
        >
          <h3 className="text-[22px] font-medium text-[#0D212C]">{productionCard.title}</h3>
          <p className="mt-3 text-sm text-[#051A24]/80">{productionCard.summary}</p>
          <FeatureGroups
            groups={productionCard.groups}
            labelClass="text-[#051A24]/40"
            textClass="text-[#051A24]/75"
          />
        </article>
      </div>
    </section>
  );
}
