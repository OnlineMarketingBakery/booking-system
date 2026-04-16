import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

const DEFAULT_ORG_TZ = "Europe/Amsterdam";

export function getOrgIanaTimezone(org: { timezone?: string | null } | null | undefined): string {
  const t = org?.timezone?.trim();
  return t || DEFAULT_ORG_TZ;
}

/**
 * Combine a calendar date (from the date picker) and "HH:mm" as **salon-local** wall time in `orgTz`,
 * returning the correct UTC instant for `timestamptz` columns.
 */
export function orgPickerDateAndTimeToUtc(calendarDate: Date, hhmm: string, orgTz: string): Date {
  const [h, min] = hhmm.split(":").map(Number);
  const y = calendarDate.getFullYear();
  const mo = calendarDate.getMonth();
  const d = calendarDate.getDate();
  const wall = new Date(y, mo, d, h, min, 0, 0);
  return fromZonedTime(wall, orgTz);
}

export function formatInOrgTz(iso: Date | string, orgTz: string, pattern: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return formatInTimeZone(d, orgTz, pattern);
}

/** yyyy-MM-dd of the instant in the salon zone (for "is today" checks). */
export function orgDayKey(date: Date, orgTz: string): string {
  return formatInTimeZone(date, orgTz, "yyyy-MM-dd");
}

export function orgNowTimeHhmm(orgTz: string): string {
  return formatInTimeZone(new Date(), orgTz, "HH:mm");
}

/** Build a local Date for the calendar control from an ISO instant, using the salon's calendar day. */
export function utcToOrgLocalCalendarDate(iso: Date | string, orgTz: string): Date {
  const ymd = formatInTimeZone(typeof iso === "string" ? new Date(iso) : iso, orgTz, "yyyy-MM-dd");
  const [y, mo, d] = ymd.split("-").map(Number);
  return new Date(y, mo - 1, d);
}

/** JS weekday 0=Sun..6=Sat for a civil YYYY-MM-DD (same in every IANA zone). */
export function civilCalendarDayOfWeek(ymd: string): number {
  const [y, mo, d] = ymd.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return 0;
  return new Date(Date.UTC(y, mo - 1, d, 12, 0, 0)).getUTCDay();
}

/** UTC ISO bounds for the salon’s full calendar day in `orgTz` (occupancy / GCal range). */
export function orgLocalDayRangeUtcIso(ymd: string, orgTz: string): { dayStart: string; dayEnd: string } {
  const [y, mo, d] = ymd.split("-").map(Number);
  const dayStartUtc = fromZonedTime(new Date(y, mo - 1, d, 0, 0, 0, 0), orgTz);
  const dayEndUtc = fromZonedTime(new Date(y, mo - 1, d, 23, 59, 59, 999), orgTz);
  return { dayStart: dayStartUtc.toISOString(), dayEnd: dayEndUtc.toISOString() };
}

/** Monday `yyyy-MM-dd` (org-local week, ISO week starting Monday) for the org week containing `anchor`. */
export function orgMondayYmdContainingInstant(anchor: Date, orgTz: string): string {
  const ymd = formatInTimeZone(anchor, orgTz, "yyyy-MM-dd");
  const [y, mo, d] = ymd.split("-").map(Number);
  const noonUtc = fromZonedTime(new Date(y, mo - 1, d, 12, 0, 0, 0), orgTz);
  const iso = Number(formatInTimeZone(noonUtc, orgTz, "i"));
  const offsetMon = iso === 7 ? -6 : 1 - iso;
  const monNoonUtc = addDays(noonUtc, offsetMon);
  return formatInTimeZone(monNoonUtc, orgTz, "yyyy-MM-dd");
}

export function orgAddCalendarDaysFromYmd(ymd: string, deltaDays: number, orgTz: string): string {
  const [y, mo, d] = ymd.split("-").map(Number);
  const baseNoon = fromZonedTime(new Date(y, mo - 1, d, 12, 0, 0, 0), orgTz);
  return formatInTimeZone(addDays(baseNoon, deltaDays), orgTz, "yyyy-MM-dd");
}

/** Salon wall time on an org `yyyy-MM-dd` → UTC Date. */
export function orgWallDateTimeToUtc(orgYmd: string, hhmm: string, orgTz: string): Date {
  const [y, mo, d] = orgYmd.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  return fromZonedTime(new Date(y, mo - 1, d, h, min ?? 0, 0, 0), orgTz);
}
