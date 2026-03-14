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
import { Loader2, ChevronLeft, ChevronRight, Calendar, Plus, ExternalLink } from "lucide-react";
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
        .select("*, services(name, duration_minutes), staff(name), gcal_event_id")
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

  // GCal event IDs that are already shown as our bookings (avoid duplicates)
  const syncedGcalIds = useMemo(() => {
    const ids = new Set<string>();
    orgBookings.forEach((b: any) => {
      if (b.gcal_event_id) ids.add(String(b.gcal_event_id));
    });
    return ids;
  }, [orgBookings]);

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

  const getSlotsForDayHour = (day: Date, hour: number): { id: string; source: SlotSource; summary: string; start: string; end: string }[] => {
    const slots: { id: string; source: SlotSource; summary: string; start: string; end: string }[] = [];
    const bookingStartTimestampsInSlot = new Set<number>();
    const TIME_TOLERANCE_MS = 60 * 1000; // 1 minute: treat as same event if within this window

    orgBookings.forEach((b: any) => {
      const start = new Date(b.start_time);
      if (isSameDay(start, day) && start.getHours() === hour) {
        bookingStartTimestampsInSlot.add(new Date(b.start_time).getTime());
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

    // Only show GCal events that are NOT our synced bookings — never show duplicates
    if (gcalConnected && gcalEvents) {
      gcalEvents.forEach((e: any) => {
        if (!e.start) return;
        if (e.id && syncedGcalIds.has(String(e.id))) return;
        const eDate = new Date(e.start);
        if (!isSameDay(eDate, day) || eDate.getHours() !== hour) return;
        const eTime = new Date(e.start).getTime();
        // Hide if any booking in this slot is at the same time (within 1 min) — guarantees no duplicate
        const overlapsBooking = [...bookingStartTimestampsInSlot].some(
          (bt) => Math.abs(eTime - bt) < TIME_TOLERANCE_MS
        );
        if (overlapsBooking) return;
        slots.push({
          id: e.id || `gcal-${e.start}`,
          source: "gcal",
          summary: e.summary || "Event",
          start: e.start,
          end: e.end || e.start,
        });
      });
    }

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
            <Calendar className="h-6 w-6 text-primary" />
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

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[800px]">
            <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b">
              <div className="p-2" />
              {weekDays.map((day) => (
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

            {HOURS.map((hour) => (
              <div key={hour} className="grid grid-cols-[60px_repeat(7,1fr)] border-b min-h-[80px]">
                <div className="p-1 text-xs text-muted-foreground text-right pr-2 pt-1">
                  {format(setHours(new Date(), hour), "h a")}
                </div>
                {weekDays.map((day) => {
                  const daySlots = getSlotsForDayHour(day, hour);
                  const slotTime = setMinutes(setHours(startOfDay(day), hour), 0);
                  const isPastSlot = isBefore(slotTime, new Date()); // past date or past time (hour)
                  return (
                    <div
                      key={day.toISOString() + hour}
                      role={isPastSlot ? undefined : "button"}
                      tabIndex={isPastSlot ? undefined : 0}
                      onClick={isPastSlot ? undefined : () => openAddBooking(day, hour)}
                      onKeyDown={isPastSlot ? undefined : (e) => e.key === "Enter" && openAddBooking(day, hour)}
                      className={`border-l p-1 text-left min-h-[80px] rounded-none ${isPastSlot ? "cursor-not-allowed opacity-75 bg-muted/30" : "cursor-pointer transition-colors hover:bg-primary/10 focus:outline-none focus:ring-1 focus:ring-ring focus:ring-inset"} ${isSameDay(day, new Date()) && !isPastSlot ? "bg-primary/5" : ""} ${isSameDay(day, new Date()) && isPastSlot ? "bg-muted/20" : ""}`}
                    >
                      {daySlots.map((s) => (
                        <div
                          key={getSlotKey(s)}
                          className={`rounded-md border p-1.5 mb-1 text-xs shadow-sm truncate ${
                            s.source === "booking"
                              ? "bg-primary/10 border-primary/20"
                              : "bg-muted border-border"
                          }`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <p className="font-medium truncate">{s.summary}</p>
                          <p className="text-muted-foreground">
                            {format(new Date(s.start), "h:mm a")}
                            {s.end ? ` — ${format(new Date(s.end), "h:mm a")}` : ""}
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

      <AddBookingDialog
        open={addBookingOpen}
        onOpenChange={(open) => {
          if (!open) closeAddBooking();
        }}
        organizationId={organization?.id ?? ""}
        initialStart={slotStart}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["calendar-bookings"] });
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
  onSuccess: () => void;
};

function AddBookingDialog({
  open,
  onOpenChange,
  organizationId,
  initialStart,
  onSuccess,
}: AddBookingDialogProps) {
  const queryClient = useQueryClient();
  const [locationId, setLocationId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const STAFF_ANY = "__any__";
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [startDate, setStartDate] = useState<Date>(() => initialStart ? new Date(initialStart) : new Date());
  const [startTime, setStartTime] = useState(() =>
    initialStart ? format(initialStart, "HH:mm") : format(new Date(Date.now() + 3600000), "HH:mm")
  );
  const [notes, setNotes] = useState("");

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

      const { error } = await supabase.from("bookings").insert({
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
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["all-bookings"] });
      toast({ title: "Booking created" });
      onSuccess();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message ?? "Failed to create booking", variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!customerName.trim()) {
      toast({ title: "Enter customer name", variant: "destructive" });
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
          <div className="grid gap-2">
            <Label>Customer name</Label>
            <Input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Full name"
            />
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
