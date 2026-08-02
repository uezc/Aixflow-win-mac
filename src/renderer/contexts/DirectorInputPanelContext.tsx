import React, { createContext, useContext } from 'react';

export type DirectorInputPanelAnchor = {
  nodeId: string;
  width: number;
  height: number | 'auto';
  panel: React.ReactNode;
};

const DirectorInputPanelContext = createContext<DirectorInputPanelAnchor | null>(null);

export function DirectorInputPanelProvider({
  value,
  children,
}: {
  value: DirectorInputPanelAnchor | null;
  children: React.ReactNode;
}) {
  return (
    <DirectorInputPanelContext.Provider value={value}>{children}</DirectorInputPanelContext.Provider>
  );
}

export function useDirectorInputPanelAnchor(): DirectorInputPanelAnchor | null {
  return useContext(DirectorInputPanelContext);
}
