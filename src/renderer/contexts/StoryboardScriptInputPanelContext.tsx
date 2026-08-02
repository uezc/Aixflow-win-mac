import React, { createContext, useContext } from 'react';

/** 分镜脚本底栏挂到对应节点下方（对齐 LLMInputPanel） */
export type StoryboardScriptInputPanelAnchor = {
  nodeId: string;
  width: number;
  height: number | 'auto';
  panel: React.ReactNode;
};

const StoryboardScriptInputPanelContext = createContext<StoryboardScriptInputPanelAnchor | null>(null);

export function StoryboardScriptInputPanelProvider({
  value,
  children,
}: {
  value: StoryboardScriptInputPanelAnchor | null;
  children: React.ReactNode;
}) {
  return (
    <StoryboardScriptInputPanelContext.Provider value={value}>
      {children}
    </StoryboardScriptInputPanelContext.Provider>
  );
}

export function useStoryboardScriptInputPanelAnchor(): StoryboardScriptInputPanelAnchor | null {
  return useContext(StoryboardScriptInputPanelContext);
}
