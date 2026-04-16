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
