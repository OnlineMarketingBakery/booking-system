/** Shared ICS + calendar URLs for booking emails (Deno). */

export type CalendarEventParts = {
  title: string;
  description?: string;
  location?: string;
  startIso: string;
  endIso: string;
};

function toGoogleUtc(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

export function buildIcsContent(ev: CalendarEventParts): string {
  const uid = `${ev.startIso}-${Math.random().toString(36).slice(2, 10)}@salonora`;
  const stamp = toGoogleUtc(new Date().toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Salonora//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${toGoogleUtc(ev.startIso)}`,
    `DTEND:${toGoogleUtc(ev.endIso)}`,
    `SUMMARY:${escapeIcsText(ev.title)}`,
  ];
  if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
  if (ev.location) lines.push(`LOCATION:${escapeIcsText(ev.location)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

export function googleCalendarUrl(ev: CalendarEventParts): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates: `${toGoogleUtc(ev.startIso)}/${toGoogleUtc(ev.endIso)}`,
  });
  if (ev.description) params.set("details", ev.description);
  if (ev.location) params.set("location", ev.location);
  return `https://www.google.com/calendar/render?${params.toString()}`;
}
