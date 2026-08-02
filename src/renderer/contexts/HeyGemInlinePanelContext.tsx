import React, { createContext, useContext } from 'react';

/** HeyGem 节点内嵌 VideoInputPanel 所需的 Workspace 级回调（不依赖 selected） */
export type HeyGemInlinePanelApi = {
  projectId?: string;
  onPickReferenceVideoFromCanvas: () => Promise<string | null>;
  onOutputVideoReady: (
    nodeId: string,
    url: string,
    originalUrl?: string,
    localAsset?: { poster?: string; ghost?: string; width?: number; height?: number },
    prompt?: string,
  ) => void;
  onErrorTask?: (nodeId: string, message: string) => void;
};

const HeyGemInlinePanelContext = createContext<HeyGemInlinePanelApi | null>(null);

export function HeyGemInlinePanelProvider({
  value,
  children,
}: {
  value: HeyGemInlinePanelApi | null;
  children: React.ReactNode;
}) {
  return (
    <HeyGemInlinePanelContext.Provider value={value}>{children}</HeyGemInlinePanelContext.Provider>
  );
}

export function useHeyGemInlinePanelApi(): HeyGemInlinePanelApi | null {
  return useContext(HeyGemInlinePanelContext);
}
