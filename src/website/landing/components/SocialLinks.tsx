import { useCallback, useState } from 'react';
import { SOCIAL_LINKS, type SocialLinkItem } from '../data/content';
import { useSiteLocale } from '../lib/siteLocale';
import { SocialPlatformIcon } from './SocialPlatformIcon';

type SocialLinksProps = {
  theme?: 'light' | 'dark';
  className?: string;
};

function ariaLabel(item: SocialLinkItem) {
  return item.detail ? `${item.label} ${item.detail}` : item.label;
}

export function SocialLinks({ theme = 'light', className = '' }: SocialLinksProps) {
  const { t } = useSiteLocale();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const btnClass =
    theme === 'light'
      ? 'border-[#051A24]/10 bg-[#051A24]/5 text-[#051A24] hover:border-[#051A24]/20 hover:bg-[#051A24]/10'
      : 'border-zinc-500/30 bg-zinc-800/40 text-zinc-200 hover:border-violet-400/40 hover:text-violet-200';

  const copyWechat = useCallback(async (item: SocialLinkItem) => {
    if (!item.detail) return;
    try {
      await navigator.clipboard.writeText(item.detail);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      window.prompt(t.social.copyWechatPrompt, item.detail);
    }
  }, [t.social.copyWechatPrompt]);

  const iconWrap = `${btnClass} inline-flex h-12 w-12 items-center justify-center rounded-full border transition`;

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      {SOCIAL_LINKS.map((item) => {
        const label = ariaLabel(item);
        const title = copiedId === item.id ? t.social.copiedWechat : label;

        if (item.href) {
          return (
            <a
              key={item.id}
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              className={iconWrap}
              aria-label={label}
              title={label}
            >
              <SocialPlatformIcon id={item.id} />
            </a>
          );
        }

        if (item.detail) {
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => copyWechat(item)}
              className={`${iconWrap} cursor-pointer`}
              aria-label={label}
              title={title}
            >
              <SocialPlatformIcon id={item.id} />
            </button>
          );
        }

        return (
          <span key={item.id} className={`${iconWrap} opacity-40`} aria-label={label} title={label}>
            <SocialPlatformIcon id={item.id} />
          </span>
        );
      })}
    </div>
  );
}
