import Holidays from "date-holidays";

export const HOLIDAY_REGION_OPTIONS: { code: string; label: string }[] = [
  { code: "NL", label: "Netherlands" },
  { code: "BE", label: "Belgium" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "GB", label: "United Kingdom" },
  { code: "US", label: "United States" },
  { code: "ES", label: "Spain" },
  { code: "IT", label: "Italy" },
  { code: "AT", label: "Austria" },
  { code: "CH", label: "Switzerland" },
  { code: "PL", label: "Poland" },
  { code: "PT", label: "Portugal" },
  { code: "IE", label: "Ireland" },
  { code: "DK", label: "Denmark" },
  { code: "SE", label: "Sweden" },
  { code: "NO", label: "Norway" },
  { code: "FI", label: "Finland" },
  { code: "IN", label: "India" },
  { code: "AU", label: "Australia" },
  { code: "CA", label: "Canada" },
  { code: "BR", label: "Brazil" },
  { code: "MX", label: "Mexico" },
  { code: "JP", label: "Japan" },
  { code: "CN", label: "China" },
  { code: "GR", label: "Greece" },
  { code: "CZ", label: "Czech Republic" },
  { code: "HU", label: "Hungary" },
  { code: "RO", label: "Romania" },
  { code: "TR", label: "Turkey" },
].sort((a, b) => a.label.localeCompare(b.label));

const cache = new Map<string, string[]>();

function cacheKey(country: string, year: number) {
  return `${country}-${year}`;
}

/**
 * Returns public holiday dates for a country/region and year as YYYY-MM-DD.
 * Uses country code (e.g. NL, US). Cached per country+year.
 */
export function getHolidayDates(countryCode: string, year: number): string[] {
  const key = cacheKey(countryCode, year);
  const cached = cache.get(key);
  if (cached) return cached;

  const hd = new Holidays(countryCode);
  const list = hd.getHolidays(year);
  if (!Array.isArray(list) || list.length === 0) {
    cache.set(key, []);
    return [];
  }
  const dates = list.map((h: { date?: string; start?: Date }) => {
    if (typeof h.date === "string") {
      return h.date.slice(0, 10);
    }
    if (h.start instanceof Date) {
      const y = h.start.getFullYear();
      const m = String(h.start.getMonth() + 1).padStart(2, "0");
      const d = String(h.start.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    return "";
  }).filter(Boolean);
  cache.set(key, dates);
  return dates;
}

/**
 * Get holidays for a range of years (e.g. current and next year for calendar).
 */
export function getHolidayDatesForYears(
  countryCode: string,
  years: number[]
): string[] {
  const set = new Set<string>();
  for (const year of years) {
    getHolidayDates(countryCode, year).forEach((d) => set.add(d));
  }
  return Array.from(set);
}

export type HolidayEntry = { date: string; name?: string };

/**
 * Returns public holidays with optional names for a country and year(s).
 */
export function getHolidaysWithNames(
  countryCode: string,
  years: number[]
): HolidayEntry[] {
  const hd = new Holidays(countryCode);
  const result: HolidayEntry[] = [];
  const seen = new Set<string>();
  for (const year of years) {
    const list = hd.getHolidays(year);
    if (!Array.isArray(list)) continue;
    list.forEach((h: { date?: string; start?: Date; name?: string }) => {
      let d = "";
      if (typeof h.date === "string") d = h.date.slice(0, 10);
      else if (h.start instanceof Date)
        d = `${h.start.getFullYear()}-${String(h.start.getMonth() + 1).padStart(2, "0")}-${String(h.start.getDate()).padStart(2, "0")}`;
      if (d && !seen.has(d)) {
        seen.add(d);
        result.push({ date: d, name: h.name });
      }
    });
  }
  result.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}
