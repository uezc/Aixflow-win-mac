import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { getStoredSettingsLocale, persistSettingsLocale, type AppLocale } from '../i18n/settingsI18n';

type AppLocaleContextValue = {
  locale: AppLocale;
  setLocale: (next: AppLocale) => void;
};

const AppLocaleContext = createContext<AppLocaleContextValue | null>(null);

export const AppLocaleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<AppLocale>(() => getStoredSettingsLocale());
  const setLocale = useCallback((next: AppLocale) => {
    persistSettingsLocale(next);
    setLocaleState(next);
  }, []);
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <AppLocaleContext.Provider value={value}>{children}</AppLocaleContext.Provider>;
};

export function useAppLocale(): AppLocaleContextValue {
  const ctx = useContext(AppLocaleContext);
  if (!ctx) {
    const fallback = getStoredSettingsLocale();
    return {
      locale: fallback,
      setLocale: (next: AppLocale) => {
        persistSettingsLocale(next);
      },
    };
  }
  return ctx;
}
