import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { isOverseasSite } from './siteRegion';
import { SITE_COPY, type SiteCopy, type SiteLocale } from '../data/i18n';

const STORAGE_KEY = 'aixflow_site_locale';

type SiteLocaleContextValue = {
  locale: SiteLocale;
  setLocale: (locale: SiteLocale) => void;
  toggleLocale: () => void;
  t: SiteCopy;
};

const SiteLocaleContext = createContext<SiteLocaleContextValue | null>(null);

function readStoredLocale(): SiteLocale | null {
  try {
    const v = String(localStorage.getItem(STORAGE_KEY) || '')
      .trim()
      .toLowerCase();
    if (v === 'zh' || v === 'en') return v;
  } catch {
    /* ignore */
  }
  return null;
}

function defaultLocale(): SiteLocale {
  const stored = readStoredLocale();
  if (stored) return stored;
  return isOverseasSite() ? 'en' : 'zh';
}

function applyDocumentLocale(locale: SiteLocale, copy: SiteCopy) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  document.title = copy.metaTitle;
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute('content', copy.metaDescription);
}

export function SiteLocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<SiteLocale>(() => defaultLocale());

  const setLocale = useCallback((next: SiteLocale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === 'zh' ? 'en' : 'zh');
  }, [locale, setLocale]);

  const t = SITE_COPY[locale];

  useEffect(() => {
    applyDocumentLocale(locale, t);
  }, [locale, t]);

  const value = useMemo(
    () => ({ locale, setLocale, toggleLocale, t }),
    [locale, setLocale, toggleLocale, t],
  );

  return <SiteLocaleContext.Provider value={value}>{children}</SiteLocaleContext.Provider>;
}

export function useSiteLocale(): SiteLocaleContextValue {
  const ctx = useContext(SiteLocaleContext);
  if (!ctx) throw new Error('useSiteLocale must be used within SiteLocaleProvider');
  return ctx;
}
