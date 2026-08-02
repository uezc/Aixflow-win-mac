import React, { createContext, useContext } from 'react';

/** 将图像底栏挂到对应节点下方（对齐 LLM `.llm-text-prompt-panel`） */
export type ImageInputPanelAnchor = {
  nodeId: string;
  width: number;
  height: number | 'auto';
  panel: React.ReactNode;
};

const ImageInputPanelContext = createContext<ImageInputPanelAnchor | null>(null);

export function ImageInputPanelProvider({
  value,
  children,
}: {
  value: ImageInputPanelAnchor | null;
  children: React.ReactNode;
}) {
  return <ImageInputPanelContext.Provider value={value}>{children}</ImageInputPanelContext.Provider>;
}

export function useImageInputPanelAnchor(): ImageInputPanelAnchor | null {
  return useContext(ImageInputPanelContext);
}
