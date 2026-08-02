import React, { createContext, useContext } from 'react';

/** 将图片转 3D 底栏挂到对应节点下方（对齐 Image / Video / Audio 的 `.*-text-prompt-panel`） */
export type ImageTo3dInputPanelAnchor = {
  nodeId: string;
  width: number;
  height: number | 'auto';
  panel: React.ReactNode;
};

const ImageTo3dInputPanelContext = createContext<ImageTo3dInputPanelAnchor | null>(null);

export function ImageTo3dInputPanelProvider({
  value,
  children,
}: {
  value: ImageTo3dInputPanelAnchor | null;
  children: React.ReactNode;
}) {
  return <ImageTo3dInputPanelContext.Provider value={value}>{children}</ImageTo3dInputPanelContext.Provider>;
}

export function useImageTo3dInputPanelAnchor(): ImageTo3dInputPanelAnchor | null {
  return useContext(ImageTo3dInputPanelContext);
}
