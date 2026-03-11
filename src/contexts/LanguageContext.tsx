import { createContext, useContext, useState, useCallback, useEffect } from "react";
import type { Locale } from "@/lib/i18n";
import { getStoredLocale, setStoredLocale, translateVatName } from "@/lib/i18n";

type LanguageContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Translate VAT rate name for display (backend stores English) */
  tVat: (name: string) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    setLocaleState(getStoredLocale());
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    setStoredLocale(next);
  }, []);

  const tVat = useCallback((name: string) => translateVatName(name, locale), [locale]);

  return (
    <LanguageContext.Provider value={{ locale, setLocale, tVat }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    return {
      locale: "en" as Locale,
      setLocale: () => {},
      tVat: (name: string) => name,
    };
  }
  return ctx;
}
