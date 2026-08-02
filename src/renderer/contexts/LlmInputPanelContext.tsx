import React, { createContext, useContext } from 'react';

/** 将 LLM 底栏挂到对应节点下方（对齐 AI Canvas `.text-prompt-panel`） */
export type LlmInputPanelAnchor = {
  nodeId: string;
  width: number;
  /** 固定高度，或 'auto'（胶囊在输入框外时由内容撑开） */
  height: number | 'auto';
  panel: React.ReactNode;
};

const LlmInputPanelContext = createContext<LlmInputPanelAnchor | null>(null);

export function LlmInputPanelProvider({
  value,
  children,
}: {
  value: LlmInputPanelAnchor | null;
  children: React.ReactNode;
}) {
  return <LlmInputPanelContext.Provider value={value}>{children}</LlmInputPanelContext.Provider>;
}

export function useLlmInputPanelAnchor(): LlmInputPanelAnchor | null {
  return useContext(LlmInputPanelContext);
}
