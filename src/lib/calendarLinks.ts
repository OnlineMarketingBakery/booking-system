export type CalendarEventInput = {
  title: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
};

function toGoogleUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Google Calendar “create event” deep link. */
export function googleCalendarUrl(ev: CalendarEventInput): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates: `${toGoogleUtc(ev.start)}/${toGoogleUtc(ev.end)}`,
  });
  if (ev.description) params.set("details", ev.description);
  if (ev.location) params.set("location", ev.location);
  return `https://www.google.com/calendar/render?${params.toString()}`;
}

/** Outlook / Microsoft 365 compose link (works for many consumer/work accounts). */
export function outlookCalendarUrl(ev: CalendarEventInput): string {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: ev.title,
    startdt: ev.start.toISOString(),
    enddt: ev.end.toISOString(),
    body: ev.description ?? "",
    location: ev.location ?? "",
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

function escapeIcsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

export function buildIcsContent(ev: CalendarEventInput, uidSuffix = "salonora"): string {
  const uid = `${ev.start.getTime()}-${Math.random().toString(36).slice(2, 10)}@${uidSuffix}`;
  const stamp = toGoogleUtc(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Salonora//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${toGoogleUtc(ev.start)}`,
    `DTEND:${toGoogleUtc(ev.end)}`,
    `SUMMARY:${escapeIcsText(ev.title)}`,
  ];
  if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
  if (ev.location) lines.push(`LOCATION:${escapeIcsText(ev.location)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

export function downloadIcsFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".ics") ? filename : `${filename}.ics`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
