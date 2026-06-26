import React, { createContext, useContext, useMemo } from 'react';

export type CanvasThemeValue = {
  isDarkMode: boolean;
  performanceMode: boolean;
};

const CanvasThemeContext = createContext<CanvasThemeValue>({
  isDarkMode: true,
  performanceMode: false,
});

export const CanvasThemeProvider: React.FC<{
  isDarkMode: boolean;
  performanceMode: boolean;
  children: React.ReactNode;
}> = ({ isDarkMode, performanceMode, children }) => {
  const value = useMemo(
    () => ({ isDarkMode, performanceMode }),
    [isDarkMode, performanceMode],
  );
  return <CanvasThemeContext.Provider value={value}>{children}</CanvasThemeContext.Provider>;
};

export function useCanvasTheme(): CanvasThemeValue {
  return useContext(CanvasThemeContext);
}
