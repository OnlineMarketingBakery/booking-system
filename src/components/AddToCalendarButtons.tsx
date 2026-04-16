import { Button } from "@/components/ui/button";
import type { CalendarEventInput } from "@/lib/calendarLinks";
import { buildIcsContent, downloadIcsFile, googleCalendarUrl, outlookCalendarUrl } from "@/lib/calendarLinks";

type Props = {
  event: CalendarEventInput;
  /** File name without extension for Apple / generic .ics download */
  icsFileName?: string;
  className?: string;
};

export function AddToCalendarButtons({ event, icsFileName = "appointment", className }: Props) {
  const gcal = googleCalendarUrl(event);
  const outlook = outlookCalendarUrl(event);
  const ics = buildIcsContent(event);

  return (
    <div className={className}>
      <p className="mb-2 text-sm font-medium text-muted-foreground">Add to calendar</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" className="gap-2" asChild>
          <a href={gcal} target="_blank" rel="noopener noreferrer">
            <span className="font-semibold text-[#4285F4]" aria-hidden>
              G
            </span>
            Google
          </a>
        </Button>
        <Button type="button" variant="outline" size="sm" className="gap-2" asChild>
          <a href={outlook} target="_blank" rel="noopener noreferrer">
            Outlook
          </a>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => downloadIcsFile(icsFileName, ics)}
        >
          Apple / .ics
        </Button>
      </div>
    </div>
  );
}
