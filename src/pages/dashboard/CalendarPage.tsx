import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/PhoneInput";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, ChevronLeft, ChevronRight, Calendar as CalendarIcon, Plus, ExternalLink, MapPin, Pencil, CalendarClock, Trash2 } from "lucide-react";
import {
  format,
  startOfWeek,
  addDays,
  addWeeks,
  subWeeks,
  isSameDay,
  setHours,
  setMinutes,
  startOfDay,
  isBefore,
} from "date-fns";
import { toast } from "@/hooks/use-toast";

const HOURS = Array.from({ length: 12 }, (_, i) => i + 8);

const BOOKING_STATUS_COLORS: Record<string, string> = {
  pending: "bg-warning/20 text-warning-foreground border-warning/30",
  confirmed: "bg-primary/20 text-primary border-primary/30",
  paid: "bg-success/20 text-success border-success/30",
  completed: "bg-success/20 text-success border-success/30",
  cancelled: "bg-destructive/20 text-destructive border-destructive/30",
  no_show: "bg-muted text-muted-foreground border-border",
};

const BOOKING_STATUS_OPTIONS = [
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "no_show", label: "No show" },
] as const;

type SlotSource = "booking" | "gcal";

function getSlotKey(s: { id: string; source: SlotSource }) {
  return `${s.source}-${s.id}`;
}

export default function CalendarPage() {
  const { organization } = useOrganization();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [addBookingOpen, setAddBookingOpen] = useState(false);
  const [slotStart, setSlotStart] = useState<Date | null>(null);
  const [refreshingAfterNavigate, setRefreshingAfterNavigate] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [selectedBooking, setSelectedBooking] = useState<any | null>(null);
  const [selectedOrphanGcalEvent, setSelectedOrphanGcalEvent] = useState<{ id: string; summary: string; start: string; end: string } | null>(null);

  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const rangeStart = weekDays[0].toISOString();
  const rangeEnd = addDays(weekDays[6], 1).toISOString();

  // Organization bookings for the week (include gcal_event_id to dedupe with Google Calendar)
  const {
    data: orgBookings = [],
    isLoading: bookingsLoading,
    refetch: refetchBookings,
  } = useQuery({
    queryKey: ["calendar-bookings", organization?.id, rangeStart, rangeEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*, services(name, duration_minutes), staff(name), locations(name), gcal_event_id")
        .eq("organization_id", organization!.id)
        .gte("start_time", rangeStart)
        .lt("start_time", rangeEnd)
        .order("start_time", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!organization,
    refetchOnWindowFocus: true,
    refetchInterval: 45 * 1000,
    staleTime: 0,
  });

  // Locations for tabs (each tab shows that location's calendar only)
  const { data: locations = [] } = useQuery({
    queryKey: ["locations", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, name")
        .eq("organization_id", organization!.id)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organization,
  });

  // Default to first location when locations load
  useEffect(() => {
    if (locations.length > 0 && !selectedLocationId) {
      setSelectedLocationId(locations[0].id);
    }
    if (locations.length > 0 && selectedLocationId && !locations.some((l) => l.id === selectedLocationId)) {
      setSelectedLocationId(locations[0].id);
    }
  }, [locations, selectedLocationId]);

  // Resolve which location is active (for tabs and for Add booking default)
  const effectiveLocationId = selectedLocationId || locations[0]?.id;
  const firstLocationId = locations[0]?.id ?? "";

  // Check if Google Calendar is connected
  const { data: gcalConnected } = useQuery({
    queryKey: ["gcal-connected", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("google_calendar_tokens")
        .select("id")
        .eq("user_id", user!.id)
        .is("disconnected_at", null)
        .maybeSingle();
      return !!data;
    },
    enabled: !!user,
  });

  // Fetch Google Calendar events for the week
  const {
    data: gcalEvents = [],
    isLoading: gcalLoading,
    refetch: refetchGcal,
  } = useQuery({
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
    refetchOnWindowFocus: true,
    refetchInterval: 45 * 1000,
    staleTime: 0,
  });

  // When user navigates back to calendar, refetch so we never show stale duplicates
  useEffect(() => {
    if (!organization) return;
    setRefreshingAfterNavigate(true);
    const p1 = refetchBookings();
    const p2 = gcalConnected ? refetchGcal() : Promise.resolve();
    Promise.all([p1, p2]).finally(() => setRefreshingAfterNavigate(false));
  }, [organization?.id, gcalConnected]);

  // When GCal connected: show only synced GCal events (existing bookings are backfilled on connect).
  // When not connected: DB bookings only.
  const getSlotsForDayHour = (day: Date, hour: number, locationId: string): { id: string; source: SlotSource; summary: string; start: string; end: string; bookingId?: string; locationId?: string }[] => {
    const slots: { id: string; source: SlotSource; summary: string; start: string; end: string; bookingId?: string; locationId?: string }[] = [];

    if (gcalConnected && gcalEvents) {
      gcalEvents.forEach((e: any) => {
        if (!e.start) return;
        const eDate = new Date(e.start);
        if (!isSameDay(eDate, day) || eDate.getHours() !== hour) return;
        if (locationId && e.location_id != null && String(e.location_id) !== String(locationId)) return;
        if (locationId && (e.location_id == null || e.location_id === "") && firstLocationId && String(locationId) !== String(firstLocationId)) return;
        slots.push({
          id: e.id || `gcal-${e.start}`,
          source: "gcal",
          summary: e.summary || "Event",
          start: e.start,
          end: e.end || e.start,
          bookingId: e.booking_id || undefined,
          locationId: e.location_id ?? undefined,
        });
      });
      return slots;
    }

    // No GCal: use custom (DB) bookings only, filtered by location
    const bookingsForThisLocation =
      locationId
        ? orgBookings.filter((b: any) => String(b.location_id) === String(locationId))
        : orgBookings;
    bookingsForThisLocation.forEach((b: any) => {
      const start = new Date(b.start_time);
      if (isSameDay(start, day) && start.getHours() === hour) {
        const svc = b.services as { name?: string } | null;
        const staffName = (b.staff as { name?: string } | null)?.name;
        slots.push({
          id: b.id,
          source: "booking",
          summary: [b.customer_name, svc?.name, staffName].filter(Boolean).join(" · ") || "Booking",
          start: b.start_time,
          end: b.end_time,
        });
      }
    });
    return slots;
  };

  const openAddBooking = (day?: Date, hour?: number) => {
    if (day != null && hour != null) {
      const start = setMinutes(setHours(startOfDay(day), hour), 0);
      setSlotStart(start);
    } else {
      const now = new Date();
      const nextHour = now.getHours() + 1;
      setSlotStart(setMinutes(setHours(startOfDay(now), nextHour > 23 ? 0 : nextHour), 0));
    }
    setAddBookingOpen(true);
  };

  const closeAddBooking = () => {
    setAddBookingOpen(false);
    setSlotStart(null);
  };

  const isInitialLoading = bookingsLoading || (!!gcalConnected && gcalLoading);
  const hasCachedData = orgBookings.length > 0 || (!!gcalConnected && gcalEvents.length > 0);
  // When we have cache and just navigated back, show loading until refetch completes so we never flash duplicates
  const isLoading = isInitialLoading || (hasCachedData && refreshingAfterNavigate);

  const handleConnectGoogle = () => {
    const redirectUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-auth-callback?action=login&state=${user?.id}`;
    window.location.href = redirectUrl;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CalendarIcon className="h-6 w-6 text-primary" />
            Calendar
          </h1>
          <p className="text-muted-foreground">Week of {format(weekStart, "MMM d, yyyy")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => openAddBooking()} className="gap-2">
            <Plus className="h-4 w-4" />
            Add booking
          </Button>
          {gcalConnected ? (
            <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
              Google connected
            </Badge>
          ) : (
            <Button variant="outline" size="sm" onClick={handleConnectGoogle} className="gap-2">
              <ExternalLink className="h-4 w-4" />
              Connect Google Calendar
            </Button>
          )}
          <Button variant="outline" size="icon" onClick={() => setCurrentWeek((w) => subWeeks(w, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentWeek(new Date())}>
            Today
          </Button>
          <Button variant="outline" size="icon" onClick={() => setCurrentWeek((w) => addWeeks(w, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {locations.length > 0 && (
        <Tabs className="w-fit" value={effectiveLocationId || ""} onValueChange={setSelectedLocationId}>
          <TabsList className="flex flex-wrap h-auto gap-1">
            {locations.map((loc) => (
              <TabsTrigger key={loc.id} value={loc.id} className="gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {loc.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {locations.length > 0 && (
        <>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="overflow-hidden w-full" key={effectiveLocationId}>
              <div className="min-w-0">
                <div className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))] border-b">
                  <div className="p-2 shrink-0" />
                  {weekDays.map((day) => (
                    <div
                      key={day.toISOString()}
                      className={`p-2 text-center border-l min-w-0 ${isSameDay(day, new Date()) ? "bg-primary/5" : ""}`}
                    >
                      <p className="text-xs text-muted-foreground">{format(day, "EEE")}</p>
                      <p className={`text-lg font-semibold ${isSameDay(day, new Date()) ? "text-primary" : ""}`}>
                        {format(day, "d")}
                      </p>
                    </div>
                  ))}
                </div>
                {HOURS.map((hour) => (
                  <div key={hour} className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))] border-b min-h-[80px]">
                    <div className="p-1 text-xs text-muted-foreground text-right pr-2 pt-1 shrink-0">
                      {format(setHours(new Date(), hour), "h a")}
                    </div>
                    {weekDays.map((day) => {
                      const daySlots = getSlotsForDayHour(day, hour, effectiveLocationId || "");
                      const slotTime = setMinutes(setHours(startOfDay(day), hour), 0);
                      const isPastSlot = isBefore(slotTime, new Date());
                      return (
                        <div
                          key={day.toISOString() + hour}
                          role={isPastSlot ? undefined : "button"}
                          tabIndex={isPastSlot ? undefined : 0}
                          onClick={isPastSlot ? undefined : () => openAddBooking(day, hour)}
                          onKeyDown={isPastSlot ? undefined : (e) => e.key === "Enter" && openAddBooking(day, hour)}
                          className={`border-l p-1 text-left min-h-[80px] min-w-0 overflow-hidden rounded-none ${isPastSlot ? "cursor-not-allowed opacity-75 bg-muted/30" : "cursor-pointer transition-colors hover:bg-primary/10 focus:outline-none focus:ring-1 focus:ring-ring focus:ring-inset"} ${isSameDay(day, new Date()) && !isPastSlot ? "bg-primary/5" : ""} ${isSameDay(day, new Date()) && isPastSlot ? "bg-muted/20" : ""}`}
                        >
                          {daySlots.map((s) => {
                              const booking =
                                s.source === "booking"
                                  ? orgBookings.find((b: any) => b.id === s.id)
                                  : s.source === "gcal"
                                    ? (s.bookingId
                                        ? orgBookings.find((b: any) => b.id === s.bookingId)
                                        : orgBookings.find((b: any) => b.gcal_event_id === s.id) ??
                                          (s.start && s.locationId
                                            ? orgBookings.find(
                                                (b: any) =>
                                                  String(b.location_id) === String(s.locationId) &&
                                                  Math.abs(new Date(b.start_time).getTime() - new Date(s.start).getTime()) < 60000
                                              )
                                            : null))
                                    : null;
                              const isManageable = !!booking;
                              const isOrphanGcal = s.source === "gcal" && !booking;
                              const isClickable = isManageable || isOrphanGcal;
                              const tooltipContent = booking
                                ? `${booking.customer_name}${(booking.services as { name?: string })?.name ? ` · ${(booking.services as { name?: string }).name}` : ""}${(booking.staff as { name?: string })?.name ? ` · ${(booking.staff as { name?: string }).name}` : ""}\n${format(new Date(booking.start_time), "MMM d, h:mm a")} – ${format(new Date(booking.end_time), "h:mm a")}${booking.notes ? `\n${booking.notes}` : ""}`
                                : `${s.summary}\n${format(new Date(s.start), "MMM d, h:mm a")}${s.end ? ` – ${format(new Date(s.end), "h:mm a")}` : ""}`;
                              return (
                                <Tooltip key={getSlotKey(s)} delayDuration={300}>
                                  <TooltipTrigger asChild>
                                    <div
                                      role={isClickable ? "button" : undefined}
                                      tabIndex={isClickable ? 0 : undefined}
                                      className={`rounded-md border p-1.5 mb-1 text-xs shadow-sm min-w-0 overflow-hidden ${
                                        isManageable
                                          ? "bg-primary/10 border-primary/20 cursor-pointer hover:bg-primary/20 transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
                                          : isOrphanGcal
                                            ? "bg-muted border-border cursor-pointer hover:bg-muted/80 transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
                                            : "bg-muted border-border"
                                      }`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (booking) setSelectedBooking(booking);
                                        else if (isOrphanGcal) setSelectedOrphanGcalEvent({ id: s.id, summary: s.summary, start: s.start, end: s.end || s.start });
                                      }}
                                      onKeyDown={(e) => {
                                        if (isClickable && e.key === "Enter") {
                                          e.stopPropagation();
                                          if (booking) setSelectedBooking(booking);
                                          else if (isOrphanGcal) setSelectedOrphanGcalEvent({ id: s.id, summary: s.summary, start: s.start, end: s.end || s.start });
                                        }
                                      }}
                                    >
                                      <p className="font-medium truncate">{s.summary}</p>
                                      <p className="text-muted-foreground truncate">
                                        {format(new Date(s.start), "h:mm a")}
                                        {s.end ? ` — ${format(new Date(s.end), "h:mm a")}` : ""}
                                      </p>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-[280px] whitespace-pre-line text-xs">
                                    {tooltipContent}
                                  </TooltipContent>
                                </Tooltip>
                              );
                            })}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {locations.length === 0 && (
        <>
          <p className="text-sm text-muted-foreground">Add locations in Locations to see the calendar by location.</p>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="overflow-hidden w-full">
              <div className="min-w-0">
                <div className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))] border-b">
                  <div className="p-2 shrink-0" />
                  {weekDays.map((day) => (
                    <div
                      key={day.toISOString()}
                      className={`p-2 text-center border-l min-w-0 ${isSameDay(day, new Date()) ? "bg-primary/5" : ""}`}
                    >
                      <p className="text-xs text-muted-foreground">{format(day, "EEE")}</p>
                      <p className={`text-lg font-semibold ${isSameDay(day, new Date()) ? "text-primary" : ""}`}>
                        {format(day, "d")}
                      </p>
                    </div>
                  ))}
                </div>
                {HOURS.map((hour) => (
                  <div key={hour} className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))] border-b min-h-[80px]">
                    <div className="p-1 text-xs text-muted-foreground text-right pr-2 pt-1 shrink-0">
                      {format(setHours(new Date(), hour), "h a")}
                    </div>
                    {weekDays.map((day) => {
                      const daySlots = getSlotsForDayHour(day, hour, "");
                      const slotTime = setMinutes(setHours(startOfDay(day), hour), 0);
                      const isPastSlot = isBefore(slotTime, new Date());
                      return (
                        <div
                          key={day.toISOString() + hour}
                          role={isPastSlot ? undefined : "button"}
                          tabIndex={isPastSlot ? undefined : 0}
                          onClick={isPastSlot ? undefined : () => openAddBooking(day, hour)}
                          onKeyDown={isPastSlot ? undefined : (e) => e.key === "Enter" && openAddBooking(day, hour)}
                          className={`border-l p-1 text-left min-h-[80px] min-w-0 overflow-hidden rounded-none ${isPastSlot ? "cursor-not-allowed opacity-75 bg-muted/30" : "cursor-pointer transition-colors hover:bg-primary/10 focus:outline-none focus:ring-1 focus:ring-ring focus:ring-inset"} ${isSameDay(day, new Date()) && !isPastSlot ? "bg-primary/5" : ""} ${isSameDay(day, new Date()) && isPastSlot ? "bg-muted/20" : ""}`}
                        >
                          {daySlots.map((s) => {
                              const booking =
                                s.source === "booking"
                                  ? orgBookings.find((b: any) => b.id === s.id)
                                  : s.source === "gcal"
                                    ? (s.bookingId
                                        ? orgBookings.find((b: any) => b.id === s.bookingId)
                                        : orgBookings.find((b: any) => b.gcal_event_id === s.id) ??
                                          (s.start && s.locationId
                                            ? orgBookings.find(
                                                (b: any) =>
                                                  String(b.location_id) === String(s.locationId) &&
                                                  Math.abs(new Date(b.start_time).getTime() - new Date(s.start).getTime()) < 60000
                                              )
                                            : null))
                                    : null;
                              const isManageable = !!booking;
                              const isOrphanGcal = s.source === "gcal" && !booking;
                              const isClickable = isManageable || isOrphanGcal;
                              const tooltipContent = booking
                                ? `${booking.customer_name}${(booking.services as { name?: string })?.name ? ` · ${(booking.services as { name?: string }).name}` : ""}${(booking.staff as { name?: string })?.name ? ` · ${(booking.staff as { name?: string }).name}` : ""}\n${format(new Date(booking.start_time), "MMM d, h:mm a")} – ${format(new Date(booking.end_time), "h:mm a")}${booking.notes ? `\n${booking.notes}` : ""}`
                                : `${s.summary}\n${format(new Date(s.start), "MMM d, h:mm a")}${s.end ? ` – ${format(new Date(s.end), "h:mm a")}` : ""}`;
                              return (
                                <Tooltip key={getSlotKey(s)} delayDuration={300}>
                                  <TooltipTrigger asChild>
                                    <div
                                      role={isClickable ? "button" : undefined}
                                      tabIndex={isClickable ? 0 : undefined}
                                      className={`rounded-md border p-1.5 mb-1 text-xs shadow-sm min-w-0 overflow-hidden ${
                                        isManageable
                                          ? "bg-primary/10 border-primary/20 cursor-pointer hover:bg-primary/20 transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
                                          : isOrphanGcal
                                            ? "bg-muted border-border cursor-pointer hover:bg-muted/80 transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
                                            : "bg-muted border-border"
                                      }`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (booking) setSelectedBooking(booking);
                                        else if (isOrphanGcal) setSelectedOrphanGcalEvent({ id: s.id, summary: s.summary, start: s.start, end: s.end || s.start });
                                      }}
                                      onKeyDown={(e) => {
                                        if (isClickable && e.key === "Enter") {
                                          e.stopPropagation();
                                          if (booking) setSelectedBooking(booking);
                                          else if (isOrphanGcal) setSelectedOrphanGcalEvent({ id: s.id, summary: s.summary, start: s.start, end: s.end || s.start });
                                        }
                                      }}
                                    >
                                      <p className="font-medium truncate">{s.summary}</p>
                                      <p className="text-muted-foreground truncate">
                                        {format(new Date(s.start), "h:mm a")}
                                        {s.end ? ` — ${format(new Date(s.end), "h:mm a")}` : ""}
                                      </p>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-[280px] whitespace-pre-line text-xs">
                                    {tooltipContent}
                                  </TooltipContent>
                                </Tooltip>
                              );
                            })}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <RemoveGcalEventDialog
        event={selectedOrphanGcalEvent}
        open={!!selectedOrphanGcalEvent}
        onOpenChange={(open) => !open && setSelectedOrphanGcalEvent(null)}
        userId={user?.id ?? ""}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["gcal-events"] });
          refetchGcal();
          setSelectedOrphanGcalEvent(null);
        }}
      />

      <ManageBookingDialog
        booking={selectedBooking}
        open={!!selectedBooking}
        onOpenChange={(open) => !open && setSelectedBooking(null)}
        organizationId={organization?.id ?? ""}
        userId={user?.id ?? ""}
        gcalConnected={!!gcalConnected}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["calendar-bookings"] });
          queryClient.invalidateQueries({ queryKey: ["all-bookings"] });
          if (gcalConnected) refetchGcal();
          setSelectedBooking(null);
        }}
      />

      <AddBookingDialog
        open={addBookingOpen}
        onOpenChange={(open) => {
          if (!open) closeAddBooking();
        }}
        organizationId={organization?.id ?? ""}
        initialStart={slotStart}
        defaultLocationId={selectedLocationId}
        gcalConnected={!!gcalConnected}
        onSuccess={(bookingId) => {
          queryClient.invalidateQueries({ queryKey: ["calendar-bookings"] });
          if (bookingId && gcalConnected) {
            supabase.functions.invoke("sync-booking-to-gcal", { body: { booking_id: bookingId } }).then(() => {
              refetchGcal();
            });
          }
          closeAddBooking();
        }}
      />
    </div>
  );
}

type AddBookingDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  initialStart: Date | null;
  defaultLocationId?: string;
  gcalConnected?: boolean;
  onSuccess: (bookingId?: string) => void;
};

function AddBookingDialog({
  open,
  onOpenChange,
  organizationId,
  initialStart,
  defaultLocationId,
  gcalConnected,
  onSuccess,
}: AddBookingDialogProps) {
  const queryClient = useQueryClient();
  const [locationId, setLocationId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const STAFF_ANY = "__any__";
  const [customerFirstName, setCustomerFirstName] = useState("");
  const [customerLastName, setCustomerLastName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [startDate, setStartDate] = useState<Date>(() => initialStart ? new Date(initialStart) : new Date());
  const [startTime, setStartTime] = useState(() =>
    initialStart ? format(initialStart, "HH:mm") : format(new Date(Date.now() + 3600000), "HH:mm")
  );
  const [notes, setNotes] = useState("");
  const [customerSuggestionsOpen, setCustomerSuggestionsOpen] = useState(false);
  const customerName = [customerFirstName.trim(), customerLastName.trim()].filter(Boolean).join(" ").trim();

  const { data: existingCustomers = [] } = useQuery({
    queryKey: ["customers", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("confirmed_booking_customers")
        .select("customer_name, customer_email, customer_phone")
        .eq("organization_id", organizationId);
      if (error) throw error;
      return (data || []).map((row) => ({
        customer_name: row.customer_name || "",
        customer_email: row.customer_email || "",
        customer_phone: row.customer_phone ?? null,
      })).filter((c) => c.customer_name || c.customer_email);
    },
    enabled: !!organizationId && open,
  });

  useEffect(() => {
    if (open && initialStart) {
      setStartDate(new Date(initialStart));
      setStartTime(format(initialStart, "HH:mm"));
    } else if (open && !initialStart) {
      const now = new Date();
      const next = new Date(now.getTime() + 3600000);
      setStartDate(now);
      setStartTime(format(next, "HH:mm"));
    }
  }, [open, initialStart]);

  useEffect(() => {
    if (open && defaultLocationId) setLocationId(defaultLocationId);
  }, [open, defaultLocationId]);

  useEffect(() => {
    if (!open) {
      setCustomerFirstName("");
      setCustomerLastName("");
      setCustomerEmail("");
      setCustomerPhone("");
      setNotes("");
      setCustomerSuggestionsOpen(false);
      setServiceId("");
      setStaffId(STAFF_ANY);
      setLocationId("");
      const now = new Date();
      const next = new Date(now.getTime() + 3600000);
      setStartDate(now);
      setStartTime(format(next, "HH:mm"));
    }
  }, [open]);

  // When date is today, keep time from being in the past (enforce min time)
  useEffect(() => {
    if (!open || !startDate) return;
    const todayStart = startOfDay(new Date());
    if (startOfDay(startDate).getTime() !== todayStart.getTime()) return;
    const [h, m] = startTime.split(":").map(Number);
    const chosen = new Date(startDate);
    chosen.setHours(h, m, 0, 0);
    const now = new Date();
    if (!isBefore(chosen, now)) return;
    const min = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    if (startTime !== min) setStartTime(min);
  }, [open, startDate, startTime]);

  const { data: locations = [] } = useQuery({
    queryKey: ["locations", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId && open,
  });

  const { data: services = [] } = useQuery({
    queryKey: ["services", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId && open,
  });

  const { data: staffForLocation = [] } = useQuery({
    queryKey: ["staff-for-location", locationId],
    queryFn: async () => {
      const { data: sl, error } = await supabase
        .from("staff_locations")
        .select("staff_id")
        .eq("location_id", locationId);
      if (error) throw error;
      const ids = (sl || []).map((r) => r.staff_id);
      if (ids.length === 0) return [];
      const { data: staff, error: staffErr } = await supabase
        .from("staff")
        .select("id, name")
        .in("id", ids)
        .eq("is_active", true);
      if (staffErr) throw staffErr;
      return staff || [];
    },
    enabled: !!locationId && open,
  });

  const selectedService = useMemo(() => services.find((s) => s.id === serviceId), [services, serviceId]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const [h, m] = startTime.split(":").map(Number);
      const start = new Date(startDate);
      start.setHours(h, m, 0, 0);
      const duration = selectedService?.duration_minutes ?? 30;
      const end = new Date(start.getTime() + duration * 60000);

      const { data, error } = await supabase
        .from("bookings")
        .insert({
          organization_id: organizationId,
          location_id: locationId,
          service_id: serviceId,
          staff_id: (staffId && staffId !== "__any__") ? staffId : null,
          customer_name: customerName.trim(),
          customer_email: customerEmail.trim().toLowerCase(),
          customer_phone: customerPhone.trim() || null,
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          status: "confirmed",
          notes: notes.trim() || null,
        })
        .select("id")
        .single();
      if (error) throw error;
      const email = customerEmail.trim().toLowerCase();
      await supabase.from("confirmed_booking_customers").upsert(
        {
          organization_id: organizationId,
          customer_email: email,
          customer_name: customerName.trim() || null,
          customer_phone: customerPhone.trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,customer_email" }
      );
      return data?.id as string | undefined;
    },
    onSuccess: (bookingId) => {
      queryClient.invalidateQueries({ queryKey: ["calendar-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["all-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["gcal-events"] });
      queryClient.invalidateQueries({ queryKey: ["customers", organizationId] });
      toast({ title: "Booking created" });
      onSuccess(bookingId);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message ?? "Failed to create booking", variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!customerName) {
      toast({ title: "Enter customer first and/or last name", variant: "destructive" });
      return;
    }
    if (!customerEmail.trim()) {
      toast({ title: "Enter customer email", variant: "destructive" });
      return;
    }
    if (!locationId || !serviceId) {
      toast({ title: "Select location and service", variant: "destructive" });
      return;
    }
    const [h, m] = startTime.split(":").map(Number);
    const start = new Date(startDate);
    start.setHours(h, m, 0, 0);
    if (isBefore(start, new Date())) {
      toast({ title: "Start time must be in the future", variant: "destructive" });
      return;
    }
    createMutation.mutate();
  };

  const todayStart = startOfDay(new Date());
  const isSelectedToday = startDate && startOfDay(startDate).getTime() === todayStart.getTime();
  const now = new Date();
  const minTime = isSelectedToday
    ? `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
    : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add booking</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Location</Label>
            <Select value={locationId} onValueChange={(v) => { setLocationId(v); setStaffId(""); }}>
              <SelectTrigger>
                <SelectValue placeholder="Select location" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Service</Label>
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger>
                <SelectValue placeholder="Select service" />
              </SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.duration_minutes} min)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {locationId && (
            <div className="grid gap-2">
              <Label>Staff (optional)</Label>
              <Select value={staffId || STAFF_ANY} onValueChange={setStaffId}>
                <SelectTrigger>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={STAFF_ANY}>Any</SelectItem>
                  {staffForLocation.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2">
              <Label>First name</Label>
              <Input
                value={customerFirstName}
                onChange={(e) => setCustomerFirstName(e.target.value)}
                onFocus={() => setCustomerSuggestionsOpen(true)}
                onBlur={() => setTimeout(() => setCustomerSuggestionsOpen(false), 200)}
                placeholder="First name"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label>Last name</Label>
              <Input
                value={customerLastName}
                onChange={(e) => setCustomerLastName(e.target.value)}
                onFocus={() => setCustomerSuggestionsOpen(true)}
                onBlur={() => setTimeout(() => setCustomerSuggestionsOpen(false), 200)}
                placeholder="Last name"
                autoComplete="off"
              />
            </div>
            {customerSuggestionsOpen && existingCustomers.length > 0 && (
              <div className="col-span-2 relative">
                <div className="absolute left-0 right-0 top-0 z-50 mt-1 max-h-[220px] overflow-auto rounded-md border bg-popover py-1 shadow-md">
                  {existingCustomers
                    .filter(
                      (c) =>
                        !customerName ||
                        (c.customer_name || "").toLowerCase().includes(customerName.toLowerCase()) ||
                        (c.customer_email || "").toLowerCase().includes(customerName.toLowerCase()) ||
                        (c.customer_email || "").toLowerCase().includes(customerFirstName.toLowerCase()) ||
                        (c.customer_email || "").toLowerCase().includes(customerLastName.toLowerCase())
                    )
                    .slice(0, 8)
                    .map((c) => {
                      const parts = (c.customer_name || "").trim().split(/\s+/);
                      const first = parts[0] ?? "";
                      const last = parts.slice(1).join(" ") ?? "";
                      return (
                        <button
                          key={c.customer_email}
                          type="button"
                          className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setCustomerFirstName(first);
                            setCustomerLastName(last);
                            setCustomerEmail(c.customer_email);
                            setCustomerPhone(c.customer_phone || "");
                            setCustomerSuggestionsOpen(false);
                          }}
                        >
                          <span className="font-medium">{c.customer_name || c.customer_email}</span>
                          <span className="text-xs text-muted-foreground">{c.customer_email}</span>
                          {c.customer_phone && (
                            <span className="text-xs text-muted-foreground">{c.customer_phone}</span>
                          )}
                        </button>
                      );
                    })}
                  {existingCustomers.filter(
                    (c) =>
                      !customerName ||
                      (c.customer_name || "").toLowerCase().includes(customerName.toLowerCase()) ||
                      (c.customer_email || "").toLowerCase().includes(customerName.toLowerCase()) ||
                      (c.customer_email || "").toLowerCase().includes(customerFirstName.toLowerCase()) ||
                      (c.customer_email || "").toLowerCase().includes(customerLastName.toLowerCase())
                  ).length === 0 && (
                    <p className="px-3 py-2 text-sm text-muted-foreground">No matching customer</p>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="grid gap-2">
            <Label>Email</Label>
            <Input
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="email@example.com"
            />
          </div>
          <div className="grid gap-2">
            <Label>Phone (optional)</Label>
            <PhoneInput
              value={customerPhone}
              onChange={setCustomerPhone}
              placeholder="Contact number"
            />
          </div>
          {initialStart != null ? (
            <div className="grid gap-2">
              <Label>Date</Label>
              <p className="text-sm text-muted-foreground py-2 px-3 rounded-md border bg-muted/30">
                {format(startDate, "EEEE, MMM d, yyyy")}
              </p>
            </div>
          ) : (
            <div className="grid gap-2">
              <Label>Date</Label>
              <Input
                type="date"
                value={format(startDate, "yyyy-MM-dd")}
                onChange={(e) => setStartDate(e.target.value ? new Date(e.target.value) : startDate)}
                min={format(todayStart, "yyyy-MM-dd")}
              />
            </div>
          )}
          <div className="grid gap-2">
            <Label>Time</Label>
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} min={minTime} />
          </div>
          <div className="grid gap-2">
            <Label>Notes (optional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending}>
            {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Create booking
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type RemoveGcalEventDialogProps = {
  event: { id: string; summary: string; start: string; end: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  onSuccess: () => void;
};

function RemoveGcalEventDialog({ event, open, onOpenChange, userId, onSuccess }: RemoveGcalEventDialogProps) {
  const [removing, setRemoving] = useState(false);

  const handleRemove = async () => {
    if (!event || !userId) return;
    setRemoving(true);
    try {
      const { error } = await supabase.functions.invoke("delete-gcal-event", {
        body: { event_id: event.id, user_id: userId },
      });
      if (error) throw error;
      toast({ title: "Removed from Google Calendar" });
      onSuccess();
    } catch (err: any) {
      toast({ title: "Error", description: err?.message ?? "Could not remove event from Google Calendar", variant: "destructive" });
    } finally {
      setRemoving(false);
    }
  };

  if (!event) return null;

  return (
    <Dialog open={open} onOpenChange={(open) => !removing && onOpenChange(open)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Event from Google Calendar</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This event is only in Google Calendar (for example, from a booking that was deleted while disconnected). You can remove it from Google Calendar here.
        </p>
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <p className="font-medium truncate">{event.summary}</p>
          <p className="text-muted-foreground">
            {format(new Date(event.start), "MMM d, yyyy · h:mm a")}
            {event.end ? ` – ${format(new Date(event.end), "h:mm a")}` : ""}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={removing}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleRemove} disabled={removing} className="gap-2">
            {removing && <Loader2 className="h-4 w-4 animate-spin" />}
            {removing ? "Removing…" : "Remove from Google Calendar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ManageBookingDialogProps = {
  booking: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  userId: string;
  gcalConnected: boolean;
  onSuccess: () => void;
};

function ManageBookingDialog({
  booking,
  open,
  onOpenChange,
  organizationId,
  userId,
  gcalConnected,
  onSuccess,
}: ManageBookingDialogProps) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState<Date | undefined>();
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  useEffect(() => {
    if (open && booking) {
      setRescheduleDate(new Date(booking.start_time));
      setRescheduleTime(format(new Date(booking.start_time), "HH:mm"));
    }
  }, [open, booking]);

  const rescheduleMutation = useMutation({
    mutationFn: async () => {
      if (!booking || !rescheduleDate || !rescheduleTime) return;
      const duration = (booking.services as { duration_minutes?: number })?.duration_minutes ?? 30;
      const start = new Date(rescheduleDate);
      const [h, m] = rescheduleTime.split(":").map(Number);
      start.setHours(h, m, 0, 0);
      const end = new Date(start.getTime() + duration * 60000);
      const { error } = await supabase
        .from("bookings")
        .update({ start_time: start.toISOString(), end_time: end.toISOString(), status: "confirmed" })
        .eq("id", booking.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["all-bookings"] });
      if (gcalConnected) {
        supabase.functions.invoke("sync-booking-to-gcal", { body: { booking_id: booking?.id } }).then(() => {
          queryClient.invalidateQueries({ queryKey: ["gcal-events"] });
        });
      }
      toast({ title: "Booking rescheduled" });
      setRescheduleOpen(false);
      onSuccess();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message ?? "Failed to reschedule", variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ status }: { status: string }) => {
      if (!booking) return;
      const { error } = await supabase
        .from("bookings")
        .update({ status: status as any })
        .eq("id", booking.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["all-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["gcal-events"] });
      toast({ title: "Status updated" });
      onSuccess();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message ?? "Failed to update status", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!booking) return;
      const gcalEventId = booking.gcal_event_id ?? null;
      const organizationId = booking.organization_id ?? null;
      const { error } = await supabase.from("bookings").delete().eq("id", booking.id);
      if (error) throw error;
      return { gcalEventId, organizationId };
    },
    onSuccess: async (data) => {
      if (data?.gcalEventId && (userId || data.organizationId)) {
        try {
          await supabase.functions.invoke("delete-gcal-event", {
            body: data.organizationId
              ? { event_id: data.gcalEventId, organization_id: data.organizationId }
              : { event_id: data.gcalEventId, user_id: userId },
          });
        } catch (e) {
          console.error("Failed to delete from Google Calendar:", e);
        }
      }
      queryClient.invalidateQueries({ queryKey: ["calendar-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["all-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["gcal-events"] });
      toast({ title: "Booking deleted" });
      setDeleteConfirmOpen(false);
      onSuccess();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message ?? "Failed to delete", variant: "destructive" });
    },
  });

  const todayStart = startOfDay(new Date());
  const isSelectedToday = rescheduleDate && startOfDay(rescheduleDate).getTime() === todayStart.getTime();
  const now = new Date();
  const minTimeToday = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const handleReschedule = () => {
    if (!rescheduleDate || !rescheduleTime || !booking) return;
    const start = new Date(rescheduleDate);
    const [h, m] = rescheduleTime.split(":").map(Number);
    start.setHours(h, m, 0, 0);
    if (isBefore(start, new Date())) {
      toast({ title: "Choose a date and time in the future", variant: "destructive" });
      return;
    }
    rescheduleMutation.mutate();
  };

  if (!booking) return null;

  const svc = booking.services as { name?: string; duration_minutes?: number } | null;
  const staff = booking.staff as { name?: string } | null;
  const loc = booking.locations as { name?: string } | null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Manage booking</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 min-w-0 overflow-hidden">
            <div className="min-w-0 overflow-hidden">
              <p className="text-xs font-medium text-muted-foreground">Customer</p>
              <p className="font-medium truncate" title={booking.customer_name}>{booking.customer_name}</p>
              {booking.customer_email && (
                <p className="text-sm text-muted-foreground truncate" title={booking.customer_email}>{booking.customer_email}</p>
              )}
              {booking.customer_phone && (
                <p className="text-sm text-muted-foreground truncate" title={booking.customer_phone}>{booking.customer_phone}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="min-w-0 overflow-hidden">
                <p className="text-xs font-medium text-muted-foreground">Service</p>
                <p className="truncate" title={svc?.name ?? undefined}>{svc?.name ?? "—"}</p>
              </div>
              <div className="min-w-0 overflow-hidden">
                <p className="text-xs font-medium text-muted-foreground">Staff</p>
                <p className="truncate" title={staff?.name ?? undefined}>{staff?.name ?? "Unassigned"}</p>
              </div>
              <div className="min-w-0 overflow-hidden">
                <p className="text-xs font-medium text-muted-foreground">Location</p>
                <p className="truncate" title={loc?.name ?? undefined}>{loc?.name ?? "—"}</p>
              </div>
              <div className="min-w-0 overflow-hidden">
                <p className="text-xs font-medium text-muted-foreground">Date & time</p>
                <p className="truncate" title={`${format(new Date(booking.start_time), "MMM d, yyyy")} · ${format(new Date(booking.start_time), "h:mm a")} – ${format(new Date(booking.end_time), "h:mm a")}`}>
                  {format(new Date(booking.start_time), "MMM d, yyyy")} · {format(new Date(booking.start_time), "h:mm a")} – {format(new Date(booking.end_time), "h:mm a")}
                </p>
              </div>
              <div className="min-w-0 overflow-hidden col-span-2">
                <p className="text-xs font-medium text-muted-foreground">Status</p>
                <div className="flex items-center gap-2 mt-1 min-w-0">
                  <Badge variant="outline" className={`capitalize ${BOOKING_STATUS_COLORS[booking.status] ?? ""}`}>
                    {booking.status.replace("_", " ")}
                  </Badge>
                  <Select
                    value={booking.status}
                    onValueChange={(val) => statusMutation.mutate({ status: val })}
                    disabled={statusMutation.isPending}
                  >
                    <SelectTrigger className="w-[140px] h-8">
                      <SelectValue placeholder="Change status" />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        ...["pending", "confirmed", "paid"].includes(booking.status)
                          ? [{ value: booking.status, label: booking.status === "pending" ? "Pending" : booking.status === "confirmed" ? "Confirmed" : "Paid" }]
                          : [],
                        ...(booking.status !== "confirmed" ? [{ value: "confirmed", label: "Confirmed" }] : []),
                        ...BOOKING_STATUS_OPTIONS,
                      ].map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            {booking.notes && (
              <div className="min-w-0 overflow-hidden">
                <p className="text-xs font-medium text-muted-foreground">Notes</p>
                <p className="text-sm break-words" title={booking.notes}>{booking.notes}</p>
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditOpen(true)}>
                <Pencil className="h-3.5 w-3.5" />
                Edit booking
              </Button>
              {booking.status !== "cancelled" && booking.status !== "completed" && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setRescheduleOpen(true)}>
                  <CalendarClock className="h-3.5 w-3.5" />
                  Reschedule
                </Button>
              )}
              <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setDeleteConfirmOpen(true)}>
                <Trash2 className="h-3.5 w-3.5" />
                Delete permanently
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reschedule booking</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>New date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start mt-1">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {rescheduleDate ? format(rescheduleDate, "PPP") : "Pick date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={rescheduleDate}
                    onSelect={setRescheduleDate}
                    disabled={(date) => isBefore(startOfDay(date), todayStart)}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>New time</Label>
              <Input
                type="time"
                value={rescheduleTime}
                onChange={(e) => setRescheduleTime(e.target.value)}
                min={isSelectedToday ? minTimeToday : undefined}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRescheduleOpen(false)}>Cancel</Button>
            <Button onClick={handleReschedule} disabled={!rescheduleDate || !rescheduleTime || rescheduleMutation.isPending}>
              {rescheduleMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={(open) => !deleteMutation.isPending && setDeleteConfirmOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this booking permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the booking from the calendar and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Keep</AlertDialogCancel>
            <Button
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <EditBookingDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        organizationId={organizationId}
        booking={booking}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["calendar-bookings"] });
          queryClient.invalidateQueries({ queryKey: ["all-bookings"] });
          if (gcalConnected) {
            supabase.functions.invoke("sync-booking-to-gcal", { body: { booking_id: booking.id } }).then(() => {
              queryClient.invalidateQueries({ queryKey: ["gcal-events"] });
            });
          }
          setEditOpen(false);
          onSuccess();
        }}
      />
    </>
  );
}

type EditBookingDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  booking: any;
  onSuccess: () => void;
};

function EditBookingDialog({ open, onOpenChange, organizationId, booking, onSuccess }: EditBookingDialogProps) {
  const queryClient = useQueryClient();
  const [locationId, setLocationId] = useState(booking?.location_id ?? "");
  const [serviceId, setServiceId] = useState(booking?.service_id ?? "");
  const STAFF_ANY = "__any__";
  const [staffId, setStaffId] = useState(booking?.staff_id ?? STAFF_ANY);
  const parseFullName = (full: string) => {
    const parts = (full || "").trim().split(/\s+/);
    return { first: parts[0] ?? "", last: parts.slice(1).join(" ") ?? "" };
  };
  const [customerFirstName, setCustomerFirstName] = useState(() => parseFullName(booking?.customer_name ?? "").first);
  const [customerLastName, setCustomerLastName] = useState(() => parseFullName(booking?.customer_name ?? "").last);
  const [customerEmail, setCustomerEmail] = useState(booking?.customer_email ?? "");
  const [customerPhone, setCustomerPhone] = useState(booking?.customer_phone ?? "");
  const [startDate, setStartDate] = useState<Date>(() => (booking ? new Date(booking.start_time) : new Date()));
  const [startTime, setStartTime] = useState(() => (booking ? format(new Date(booking.start_time), "HH:mm") : "09:00"));
  const [notes, setNotes] = useState(booking?.notes ?? "");
  const customerName = [customerFirstName.trim(), customerLastName.trim()].filter(Boolean).join(" ").trim();

  useEffect(() => {
    if (open && booking) {
      setLocationId(booking.location_id ?? "");
      setServiceId(booking.service_id ?? "");
      setStaffId(booking.staff_id ?? STAFF_ANY);
      const { first, last } = parseFullName(booking.customer_name ?? "");
      setCustomerFirstName(first);
      setCustomerLastName(last);
      setCustomerEmail(booking.customer_email ?? "");
      setCustomerPhone(booking.customer_phone ?? "");
      setStartDate(new Date(booking.start_time));
      setStartTime(format(new Date(booking.start_time), "HH:mm"));
      setNotes(booking.notes ?? "");
    }
  }, [open, booking]);

  const { data: locations = [] } = useQuery({
    queryKey: ["locations", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId && open,
  });

  const { data: services = [] } = useQuery({
    queryKey: ["services", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId && open,
  });

  const { data: staffForLocation = [] } = useQuery({
    queryKey: ["staff-for-location", locationId],
    queryFn: async () => {
      const { data: sl, error } = await supabase
        .from("staff_locations")
        .select("staff_id")
        .eq("location_id", locationId);
      if (error) throw error;
      const ids = (sl || []).map((r) => r.staff_id);
      if (ids.length === 0) return [];
      const { data: staff, error: staffErr } = await supabase
        .from("staff")
        .select("id, name")
        .in("id", ids)
        .eq("is_active", true);
      if (staffErr) throw staffErr;
      return staff || [];
    },
    enabled: !!locationId && open,
  });

  const selectedService = useMemo(() => services.find((s) => s.id === serviceId), [services, serviceId]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const [h, m] = startTime.split(":").map(Number);
      const start = new Date(startDate);
      start.setHours(h, m, 0, 0);
      const duration = selectedService?.duration_minutes ?? 30;
      const end = new Date(start.getTime() + duration * 60000);
      const { error } = await supabase
        .from("bookings")
        .update({
          location_id: locationId,
          service_id: serviceId,
          staff_id: staffId && staffId !== STAFF_ANY ? staffId : null,
          customer_name: customerName.trim(),
          customer_email: customerEmail.trim().toLowerCase(),
          customer_phone: customerPhone.trim() || null,
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          notes: notes.trim() || null,
        })
        .eq("id", booking.id);
      if (error) throw error;
      const email = customerEmail.trim().toLowerCase();
      await supabase.from("confirmed_booking_customers").upsert(
        {
          organization_id: booking.organization_id,
          customer_email: email,
          customer_name: customerName.trim() || null,
          customer_phone: customerPhone.trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,customer_email" }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["all-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["customers", booking.organization_id] });
      toast({ title: "Booking updated" });
      onSuccess();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message ?? "Failed to update", variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!customerName) {
      toast({ title: "Enter customer first and/or last name", variant: "destructive" });
      return;
    }
    if (!customerEmail.trim()) {
      toast({ title: "Enter customer email", variant: "destructive" });
      return;
    }
    if (!locationId || !serviceId) {
      toast({ title: "Select location and service", variant: "destructive" });
      return;
    }
    const [h, m] = startTime.split(":").map(Number);
    const start = new Date(startDate);
    start.setHours(h, m, 0, 0);
    if (isBefore(start, new Date())) {
      toast({ title: "Start time must be in the future", variant: "destructive" });
      return;
    }
    updateMutation.mutate();
  };

  const todayStart = startOfDay(new Date());
  const isSelectedToday = startDate && startOfDay(startDate).getTime() === todayStart.getTime();
  const now = new Date();
  const minTime = isSelectedToday
    ? `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
    : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit booking</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Location</Label>
            <Select value={locationId} onValueChange={(v) => { setLocationId(v); setStaffId(STAFF_ANY); }}>
              <SelectTrigger>
                <SelectValue placeholder="Select location" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Service</Label>
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger>
                <SelectValue placeholder="Select service" />
              </SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name} ({s.duration_minutes} min)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {locationId && (
            <div className="grid gap-2">
              <Label>Staff (optional)</Label>
              <Select value={staffId || STAFF_ANY} onValueChange={setStaffId}>
                <SelectTrigger>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={STAFF_ANY}>Any</SelectItem>
                  {staffForLocation.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2">
              <Label>First name</Label>
              <Input value={customerFirstName} onChange={(e) => setCustomerFirstName(e.target.value)} placeholder="First name" />
            </div>
            <div className="grid gap-2">
              <Label>Last name</Label>
              <Input value={customerLastName} onChange={(e) => setCustomerLastName(e.target.value)} placeholder="Last name" />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Email</Label>
            <Input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="email@example.com" />
          </div>
          <div className="grid gap-2">
            <Label>Phone (optional)</Label>
            <PhoneInput value={customerPhone} onChange={setCustomerPhone} placeholder="Contact number" />
          </div>
          <div className="grid gap-2">
            <Label>Date</Label>
            <Input
              type="date"
              value={format(startDate, "yyyy-MM-dd")}
              onChange={(e) => setStartDate(e.target.value ? new Date(e.target.value) : startDate)}
              min={format(todayStart, "yyyy-MM-dd")}
            />
          </div>
          <div className="grid gap-2">
            <Label>Time</Label>
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} min={minTime} />
          </div>
          <div className="grid gap-2">
            <Label>Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={updateMutation.isPending}>
            {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
