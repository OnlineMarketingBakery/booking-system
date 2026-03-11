/**
 * Frontend-only translations. Backend stores English keys; we translate for display.
 * Add more keys here for other languages or UI strings.
 */
export type Locale = "en" | "nl";

const VAT_NAME_TRANSLATIONS: Record<Locale, Record<string, string>> = {
  en: {
    "VAT high": "VAT high",
    "VAT low": "VAT low",
    "VAT free": "VAT free",
    "VAT exempt": "VAT exempt",
    "VAT": "VAT",
  },
  nl: {
    "VAT high": "BTW hoog",
    "VAT low": "BTW laag",
    "VAT free": "BTW vrij",
    "VAT exempt": "BTW vrijgesteld",
    "VAT": "BTW",
  },
};

/**
 * Translate a VAT rate name for display. Backend always stores English (e.g. "VAT high").
 * Returns the localized label when we have one; otherwise returns the name as-is (custom names).
 */
export function translateVatName(name: string, locale: Locale): string {
  const map = VAT_NAME_TRANSLATIONS[locale];
  return (map && map[name]) ?? name;
}

export const LOCALE_STORAGE_KEY = "glowbook_locale";

export function getStoredLocale(): Locale {
  if (typeof window === "undefined") return "en";
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  return stored === "nl" ? "nl" : "en";
}

export function setStoredLocale(locale: Locale): void {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
}
