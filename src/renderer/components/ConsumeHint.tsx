// @ts-nocheck
import React from 'react';
import { formatConsumeHint, consumeTierLabel, type ConsumeTier } from '../../shared/yuanbaoModelBilling';
import { useAppLocale } from '../contexts/AppLocaleContext';

type Props = {
  yuanbao: number;
  tier?: ConsumeTier;
  className?: string;
};

/** 操作按钮旁消耗提示：「本次消耗：2元宝（约0.2元）」+ 低/中/高消耗 */
export function ConsumeHint({ yuanbao, tier = 'medium', className = '' }: Props) {
  const { locale } = useAppLocale();
  const loc = locale === 'en' ? 'en' : 'zh';
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 text-[11px] text-white/50 ${className}`}>
      <span>{formatConsumeHint(yuanbao, loc)}</span>
      <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/65">
        {consumeTierLabel(tier, loc)}
      </span>
    </span>
  );
}

export default ConsumeHint;
