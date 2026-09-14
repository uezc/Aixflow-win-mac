/**
 * AI 短剧 2 代模块左上角标题标签：
 * - 粉色：模块名（剧本 / 角色设计师），约比原 text-xs 大三号
 * - 黄色：角色名，比粉色小一号
 */
import React from 'react';

export function DramaFlowModuleTitleTag({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`pointer-events-none inline-flex select-none items-center rounded-md border border-pink-400/55 bg-pink-500/30 px-2.5 py-0.5 text-xl font-bold leading-tight text-pink-100 shadow-sm ${className}`}
    >
      {children}
    </span>
  );
}

/** 角色卡名称：黄色标签，比粉色模块标题小一号，偏扁避免与卡片顶缘挤叠 */
export function DramaFlowCharacterNameTag({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`pointer-events-none inline-flex max-w-[11rem] select-none items-center truncate rounded border border-amber-400/55 bg-amber-400/20 px-1.5 py-px text-sm font-bold leading-tight text-amber-100 shadow-sm ${className}`}
    >
      {children}
    </span>
  );
}
