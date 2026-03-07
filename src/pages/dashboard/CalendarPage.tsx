import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronLeft, ChevronRight, Calendar, ExternalLink } from "lucide-react";
import { format, startOfWeek, addDays, addWeeks, subWeeks, isSameDay, setHours, parseISO } from "date-fns";

const HOURS = Array.from({ length: 12 }, (_, i) => i + 8);

export default function CalendarPage() {
  const { organization } = useOrganization();
  const { user } = useAuth();
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const rangeStart = weekDays[0].toISOString();
  const rangeEnd = addDays(weekDays[6], 1).toISOString();

  // Check if Google Calendar is connected
  const { data: gcalConnected } = useQuery({
    queryKey: ["gcal-connected", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("google_calendar_tokens")
        .select("id")
        .eq("user_id", user!.id)
        .maybeSingle();
      return !!data;
    },
    enabled: !!user,
  });

  // Fetch Google Calendar events for the week
  const { data: gcalEvents = [], isLoading } = useQuery({
    queryKey: ["gcal-events", user?.id, rangeStart],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("fetch-gcal-events", {
        body: {
          user_id: user!.id,
          time_min: rangeStart,
          time_max: rangeEnd,
        },
      });
      if (error) throw error;
      return data?.events || [];
    },
    enabled: !!user && !!gcalConnected,
  });

  const getEventsForDayHour = (day: Date, hour: number) => {
    return gcalEvents.filter((e: any) => {
      if (!e.start) return false;
      const eDate = new Date(e.start);
      return isSameDay(eDate, day) && eDate.getHours() === hour;
    });
  };

  const handleConnectGoogle = () => {
    const redirectUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-auth-callback?action=login&state=${user?.id}`;
    window.location.href = redirectUrl;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Calendar className="h-6 w-6 text-primary" />
            Google Calendar
          </h1>
          <p className="text-muted-foreground">Week of {format(weekStart, "MMM d, yyyy")}</p>
        </div>
        <div className="flex items-center gap-2">
          {gcalConnected && (
            <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
              Connected
            </Badge>
          )}
          <Button variant="outline" size="icon" onClick={() => setCurrentWeek(w => subWeeks(w, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentWeek(new Date())}>Today</Button>
          <Button variant="outline" size="icon" onClick={() => setCurrentWeek(w => addWeeks(w, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!gcalConnected ? (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <Calendar className="mx-auto h-16 w-16 text-muted-foreground" />
            <h2 className="text-xl font-semibold">Connect Google Calendar</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              Connect your Google Calendar to see all your events here and automatically sync bookings.
            </p>
            <Button onClick={handleConnectGoogle} className="gap-2">
              <ExternalLink className="h-4 w-4" />
              Connect Google Calendar
            </Button>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[800px]">
            {/* Header row */}
            <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b">
              <div className="p-2" />
              {weekDays.map(day => (
                <div
                  key={day.toISOString()}
                  className={`p-2 text-center border-l ${isSameDay(day, new Date()) ? "bg-primary/5" : ""}`}
                >
                  <p className="text-xs text-muted-foreground">{format(day, "EEE")}</p>
                  <p className={`text-lg font-semibold ${isSameDay(day, new Date()) ? "text-primary" : ""}`}>
                    {format(day, "d")}
                  </p>
                </div>
              ))}
            </div>

            {/* Time grid */}
            {HOURS.map(hour => (
              <div key={hour} className="grid grid-cols-[60px_repeat(7,1fr)] border-b min-h-[80px]">
                <div className="p-1 text-xs text-muted-foreground text-right pr-2 pt-1">
                  {format(setHours(new Date(), hour), "h a")}
                </div>
                {weekDays.map(day => {
                  const dayEvents = getEventsForDayHour(day, hour);
                  return (
                    <div
                      key={day.toISOString() + hour}
                      className={`border-l p-1 ${isSameDay(day, new Date()) ? "bg-primary/5" : ""}`}
                    >
                      {dayEvents.map((e: any) => (
                        <div
                          key={e.id}
                          className="rounded-md border bg-primary/10 border-primary/20 p-1.5 mb-1 text-xs shadow-sm"
                        >
                          <p className="font-medium truncate">{e.summary}</p>
                          <p className="text-muted-foreground">
                            {e.start ? format(new Date(e.start), "h:mm a") : ""}
                            {e.end ? ` — ${format(new Date(e.end), "h:mm a")}` : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
