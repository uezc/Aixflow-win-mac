import React, { createContext, useContext } from 'react';

/** 将音频底栏挂到对应节点下方（对齐 Image / Video / LLM 的 `.*-text-prompt-panel`） */
export type AudioInputPanelAnchor = {
  nodeId: string;
  width: number;
  height: number | 'auto';
  panel: React.ReactNode;
};

const AudioInputPanelContext = createContext<AudioInputPanelAnchor | null>(null);

export function AudioInputPanelProvider({
  value,
  children,
}: {
  value: AudioInputPanelAnchor | null;
  children: React.ReactNode;
}) {
  return <AudioInputPanelContext.Provider value={value}>{children}</AudioInputPanelContext.Provider>;
}

export function useAudioInputPanelAnchor(): AudioInputPanelAnchor | null {
  return useContext(AudioInputPanelContext);
}
