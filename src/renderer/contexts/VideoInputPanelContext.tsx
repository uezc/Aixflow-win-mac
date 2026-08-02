import React, { createContext, useContext } from 'react';

/** 将视频底栏挂到对应节点下方（对齐 Image / LLM 的 `.*-text-prompt-panel`） */
export type VideoInputPanelAnchor = {
  nodeId: string;
  width: number;
  height: number | 'auto';
  panel: React.ReactNode;
};

const VideoInputPanelContext = createContext<VideoInputPanelAnchor | null>(null);

export function VideoInputPanelProvider({
  value,
  children,
}: {
  value: VideoInputPanelAnchor | null;
  children: React.ReactNode;
}) {
  return <VideoInputPanelContext.Provider value={value}>{children}</VideoInputPanelContext.Provider>;
}

export function useVideoInputPanelAnchor(): VideoInputPanelAnchor | null {
  return useContext(VideoInputPanelContext);
}
