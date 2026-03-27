import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { CalendarDays, Clock, Loader2, Plus, Trash2 } from "lucide-react";
import { format, isBefore, startOfDay } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const TIME_SLOTS_30 = (() => {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return out;
})();

function subtractClosureWindows(
  windows: { start_time: string; end_time: string }[],
  closures: { start_time: string; end_time: string }[]
): { start_time: string; end_time: string }[] {
  let result = windows.map((w) => ({
    start_time: w.start_time.slice(0, 5),
    end_time: w.end_time.slice(0, 5),
  }));
  for (const c of closures) {
    const cStart = c.start_time.slice(0, 5);
    const cEnd = c.end_time.slice(0, 5);
    const next: { start_time: string; end_time: string }[] = [];
    for (const r of result) {
      if (cEnd <= r.start_time || cStart >= r.end_time) {
        next.push(r);
        continue;
      }
      if (r.start_time < cStart) next.push({ start_time: r.start_time, end_time: cStart });
      if (cEnd < r.end_time) next.push({ start_time: cEnd, end_time: r.end_time });
    }
    result = next;
  }
  return result;
}

function unionAvailabilityWindows(
  rows: { start_time: string; end_time: string }[]
): { start_time: string; end_time: string }[] {
  if (rows.length === 0) return [];
  const parsed = rows
    .map((r) => ({
      start: r.start_time.slice(0, 5),
      end: r.end_time.slice(0, 5),
    }))
    .sort((a, b) => a.start.localeCompare(b.start));
  const out: { start_time: string; end_time: string }[] = [];
  let cur = { start: parsed[0].start, end: parsed[0].end };
  for (let i = 1; i < parsed.length; i++) {
    const n = parsed[i];
    if (n.start <= cur.end) {
      cur.end = n.end > cur.end ? n.end : cur.end;
    } else {
      out.push({ start_time: cur.start, end_time: cur.end });
      cur = { start: n.start, end: n.end };
    }
  }
  out.push({ start_time: cur.start, end_time: cur.end });
  return out;
}

type BreakRow = {
  id: string;
  is_recurring: boolean;
  applies_date: string | null;
  start_time: string;
  end_time: string;
  applies_whole_salon: boolean;
  location_id: string;
  organization_break_slot_staff: { staff_id: string }[] | null;
};

export function BookingBreakTimesSection() {
  const { organization } = useOrganization();
  const orgId = organization?.id ?? "";
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [recurring, setRecurring] = useState(false);
  const [breakDate, setBreakDate] = useState<Date | undefined>(undefined);
  const [breakCalendarOpen, setBreakCalendarOpen] = useState(false);
  const [breakLocationId, setBreakLocationId] = useState<string>("");
  const [wholeSalon, setWholeSalon] = useState(false);
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [startTime, setStartTime] = useState("12:00");
  const [endTime, setEndTime] = useState("14:00");
  const [timePopoverOpen, setTimePopoverOpen] = useState(false);
  const [staffPopoverOpen, setStaffPopoverOpen] = useState(false);

  const todayStr = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);

  const { data: locations = [] } = useQuery({
    queryKey: ["locations", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, name")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId,
  });

  const { data: breakRows = [], isLoading: loadingBreaks } = useQuery({
    queryKey: ["organization-break-slots", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_break_slots")
        .select(
          "id, is_recurring, applies_date, start_time, end_time, applies_whole_salon, location_id, organization_break_slot_staff(staff_id)"
        )
        .eq("organization_id", orgId)
        .order("is_recurring", { ascending: false })
        .order("applies_date", { ascending: true })
        .order("start_time", { ascending: true });
      if (error) throw error;
      return (data ?? []) as BreakRow[];
    },
    enabled: !!orgId,
  });

  const { data: staffAtLocation = [] } = useQuery({
    queryKey: ["break-staff-at-location", breakLocationId],
    queryFn: async () => {
      const { data: sl, error } = await supabase
        .from("staff_locations")
        .select("staff_id")
        .eq("location_id", breakLocationId);
      if (error) throw error;
      const ids = (sl ?? []).map((r) => r.staff_id);
      if (ids.length === 0) return [];
      const { data: staff, error: e2 } = await supabase
        .from("staff")
        .select("id, name")
        .in("id", ids)
        .eq("is_active", true)
        .eq("organization_id", orgId)
        .order("name");
      if (e2) throw e2;
      return staff ?? [];
    },
    enabled: !!orgId && !!breakLocationId,
  });

  const breakDayOfWeek = breakDate?.getDay() ?? null;

  const { data: dayAvailability = [] } = useQuery({
    queryKey: ["location-availability-break", breakLocationId, breakDayOfWeek],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("location_availability")
        .select("start_time, end_time")
        .eq("location_id", breakLocationId)
        .eq("day_of_week", breakDayOfWeek!)
        .order("start_time");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        start_time: (r.start_time as string).slice(0, 5),
        end_time: (r.end_time as string).slice(0, 5),
      }));
    },
    enabled: !!breakLocationId && breakDayOfWeek != null && !recurring,
  });

  const { data: allDaysAvailability = [] } = useQuery({
    queryKey: ["location-availability-break-all", breakLocationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("location_availability")
        .select("start_time, end_time")
        .eq("location_id", breakLocationId);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        start_time: (r.start_time as string).slice(0, 5),
        end_time: (r.end_time as string).slice(0, 5),
      }));
    },
    enabled: !!breakLocationId && recurring,
  });

  const openingWindows = useMemo(() => {
    if (!breakLocationId) return [];
    if (recurring) return unionAvailabilityWindows(allDaysAvailability);
    return dayAvailability;
  }, [breakLocationId, recurring, allDaysAvailability, dayAvailability]);

  const allowedTimeRange = useMemo(() => {
    if (openingWindows.length === 0) return null;
    const starts = openingWindows.map((s) => s.start_time);
    const ends = openingWindows.map((s) => s.end_time);
    return {
      minStart: starts.reduce((a, b) => (a < b ? a : b)),
      maxEnd: ends.reduce((a, b) => (a > b ? a : b)),
    };
  }, [openingWindows]);

  const existingIntervalsForPicker = useMemo(() => {
    if (!breakLocationId) return [];
    return breakRows
      .filter((b) => {
        if (b.location_id !== breakLocationId) return false;
        if (recurring) return b.is_recurring;
        return b.is_recurring || b.applies_date === format(breakDate ?? new Date(), "yyyy-MM-dd");
      })
      .map((b) => ({
        start_time: b.start_time.slice(0, 5),
        end_time: b.end_time.slice(0, 5),
      }));
  }, [breakRows, breakLocationId, recurring, breakDate]);

  const freeIntervalsForPicker = useMemo(() => {
    if (!allowedTimeRange) return [];
    const base =
      openingWindows.length > 0
        ? openingWindows
        : [{ start_time: allowedTimeRange.minStart, end_time: allowedTimeRange.maxEnd }];
    return subtractClosureWindows(base, existingIntervalsForPicker);
  }, [openingWindows, allowedTimeRange, existingIntervalsForPicker]);

  const timePickerEnabled =
    !!breakLocationId &&
    (recurring ? allDaysAvailability.length > 0 : !!breakDate && dayAvailability.length > 0) &&
    !!allowedTimeRange;

  const allowedFromSlots = useMemo(() => {
    if (!timePickerEnabled || freeIntervalsForPicker.length === 0) return [];
    return TIME_SLOTS_30.filter((t) =>
      freeIntervalsForPicker.some((int) => t >= int.start_time && t < int.end_time)
    );
  }, [timePickerEnabled, freeIntervalsForPicker]);

  const allowedToSlots = useMemo(() => {
    if (!timePickerEnabled || freeIntervalsForPicker.length === 0) return [];
    const existing = existingIntervalsForPicker;
    return TIME_SLOTS_30.filter((t) => {
      if (t <= startTime) return false;
      if (!freeIntervalsForPicker.some((int) => t > int.start_time && t <= int.end_time)) return false;
      const overlapsExisting = existing.some((c) => startTime < c.end_time && t > c.start_time);
      return !overlapsExisting;
    });
  }, [timePickerEnabled, freeIntervalsForPicker, existingIntervalsForPicker, startTime]);

  useEffect(() => {
    if (allowedFromSlots.length > 0 && !allowedFromSlots.includes(startTime)) {
      setStartTime(allowedFromSlots[0]);
    }
  }, [allowedFromSlots, startTime]);

  useEffect(() => {
    const validTo = allowedToSlots.length > 0 && allowedToSlots.includes(endTime);
    const afterStart = endTime > startTime;
    if (allowedToSlots.length > 0 && (!validTo || !afterStart)) {
      setEndTime(allowedToSlots[0]);
    }
  }, [allowedToSlots, startTime, endTime]);

  useEffect(() => {
    if (wholeSalon) setSelectedStaffIds([]);
  }, [wholeSalon]);

  useEffect(() => {
    setSelectedStaffIds((prev) => prev.filter((id) => staffAtLocation.some((s) => s.id === id)));
  }, [staffAtLocation]);

  const locationNameById = useMemo(() => {
    const m = new Map<string, string>();
    locations.forEach((l) => m.set(l.id, l.name ?? l.id));
    return m;
  }, [locations]);

  const allBreakStaffIds = useMemo(() => {
    const s = new Set<string>();
    for (const b of breakRows) {
      for (const row of b.organization_break_slot_staff ?? []) {
        s.add(row.staff_id);
      }
    }
    return [...s];
  }, [breakRows]);

  const { data: breakStaffNameById = {} } = useQuery({
    queryKey: ["break-staff-names", orgId, [...allBreakStaffIds].sort().join(",")],
    queryFn: async () => {
      if (allBreakStaffIds.length === 0) return {};
      const { data, error } = await supabase.from("staff").select("id, name").in("id", allBreakStaffIds);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((r) => [r.id, r.name ?? r.id]));
    },
    enabled: !!orgId && allBreakStaffIds.length > 0,
  });

  const addBreak = useMutation({
    mutationFn: async (payload: {
      is_recurring: boolean;
      applies_date: string | null;
      start_time: string;
      end_time: string;
      applies_whole_salon: boolean;
      location_id: string;
      staff_ids: string[];
    }) => {
      const st = payload.start_time.length === 5 ? `${payload.start_time}:00` : payload.start_time;
      const et = payload.end_time.length === 5 ? `${payload.end_time}:00` : payload.end_time;
      const { data: row, error } = await supabase
        .from("organization_break_slots")
        .insert({
          organization_id: orgId,
          location_id: payload.location_id,
          is_recurring: payload.is_recurring,
          applies_date: payload.applies_date,
          start_time: st,
          end_time: et,
          applies_whole_salon: payload.applies_whole_salon,
        })
        .select("id")
        .single();
      if (error) throw error;
      if (!payload.applies_whole_salon && payload.staff_ids.length > 0 && row?.id) {
        const { error: e2 } = await supabase.from("organization_break_slot_staff").insert(
          payload.staff_ids.map((staff_id) => ({ break_slot_id: row.id, staff_id }))
        );
        if (e2) throw e2;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-break-slots"] });
      queryClient.invalidateQueries({ queryKey: ["booking-slots"] });
      if (!recurring) {
        setBreakDate(undefined);
        setBreakCalendarOpen(false);
      }
      toast({ title: "Break time added" });
    },
    onError: (e) =>
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  const removeBreak = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("organization_break_slots").delete().eq("id", id).eq("organization_id", orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-break-slots"] });
      queryClient.invalidateQueries({ queryKey: ["booking-slots"] });
      toast({ title: "Break time removed" });
    },
    onError: (e) =>
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  const handleAdd = () => {
    if (!breakLocationId) {
      toast({ title: "Select a location", variant: "destructive" });
      return;
    }
    if (!recurring && !breakDate) {
      toast({ title: "Pick a date or turn on recurring", variant: "destructive" });
      return;
    }
    if (!wholeSalon && selectedStaffIds.length === 0) {
      toast({ title: "Select staff or enable whole salon", variant: "destructive" });
      return;
    }
    if (startTime >= endTime) {
      toast({ title: "End time must be after start time", variant: "destructive" });
      return;
    }
    if (!allowedTimeRange) {
      toast({
        title: "Location has no hours",
        description: recurring
          ? "Add opening hours for this location first."
          : "This location is closed on the selected day.",
        variant: "destructive",
      });
      return;
    }
    const { minStart, maxEnd } = allowedTimeRange;
    if (startTime < minStart || endTime > maxEnd) {
      toast({
        title: "Outside opening hours",
        description: `Break must fall within ${minStart} – ${maxEnd} for this context.`,
        variant: "destructive",
      });
      return;
    }
    if (!recurring && breakDate) {
      const ds = format(breakDate, "yyyy-MM-dd");
      if (ds < todayStr) {
        toast({ title: "Pick today or a future date", variant: "destructive" });
        return;
      }
    }
    addBreak.mutate({
      is_recurring: recurring,
      applies_date: recurring ? null : format(breakDate!, "yyyy-MM-dd"),
      start_time: startTime,
      end_time: endTime,
      applies_whole_salon: wholeSalon,
      location_id: breakLocationId,
      staff_ids: wholeSalon ? [] : selectedStaffIds,
    });
  };

  const canAdd =
    !!breakLocationId &&
    (recurring || !!breakDate) &&
    (wholeSalon || selectedStaffIds.length > 0) &&
    timePickerEnabled &&
    startTime < endTime;

  const toggleStaff = (id: string) => {
    setSelectedStaffIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          Break times
        </CardTitle>
        <CardDescription>
          Block time for lunch or breaks — for the whole salon or specific staff at one location. Recurring breaks apply every day; otherwise choose a single date.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
            <Switch id="break-recurring" checked={recurring} onCheckedChange={setRecurring} />
            <Label htmlFor="break-recurring" className="text-sm font-medium cursor-pointer">
              Recurring
            </Label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Popover open={breakCalendarOpen} onOpenChange={setBreakCalendarOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                disabled={recurring}
                className={cn(
                  "min-w-[200px] justify-start text-left font-normal",
                  (!breakDate || recurring) && "text-muted-foreground"
                )}
              >
                <CalendarDays className="mr-2 h-4 w-4" />
                {recurring ? "Date not used (daily)" : breakDate ? format(breakDate, "EEE, MMM d, yyyy") : "Pick date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={breakDate}
                onSelect={(d) => {
                  setBreakDate(d);
                  setBreakCalendarOpen(false);
                }}
                disabled={(date) => isBefore(startOfDay(date), startOfDay(new Date()))}
                defaultMonth={breakDate ?? new Date()}
              />
            </PopoverContent>
          </Popover>

          <div className="flex items-center gap-2">
            <Label htmlFor="break-location" className="text-sm font-medium shrink-0">
              Apply to
            </Label>
            <Select value={breakLocationId || "__none__"} onValueChange={(v) => setBreakLocationId(v === "__none__" ? "" : v)}>
              <SelectTrigger id="break-location" className="w-[180px]">
                <SelectValue placeholder="Select location" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" disabled>
                  Select location
                </SelectItem>
                {locations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.name ?? loc.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
              <Switch
                id="break-whole-salon"
                checked={wholeSalon}
                onCheckedChange={setWholeSalon}
                disabled={!breakLocationId}
              />
              <Label htmlFor="break-whole-salon" className="text-sm font-medium cursor-pointer whitespace-nowrap">
                Whole salon
              </Label>
            </div>
            <Popover open={staffPopoverOpen} onOpenChange={setStaffPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="min-w-[200px] justify-start font-normal"
                  disabled={!breakLocationId || wholeSalon}
                >
                  {wholeSalon
                    ? "All staff at location"
                    : selectedStaffIds.length === 0
                      ? "Select staff"
                      : `${selectedStaffIds.length} staff selected`}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[260px] p-0" align="start">
                <div className="max-h-[240px] overflow-y-auto p-2 space-y-2">
                  {staffAtLocation.length === 0 ? (
                    <p className="text-sm text-muted-foreground px-2 py-4 text-center">No staff at this location.</p>
                  ) : (
                    staffAtLocation.map((s) => (
                      <label
                        key={s.id}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted cursor-pointer text-sm"
                      >
                        <Checkbox checked={selectedStaffIds.includes(s.id)} onCheckedChange={() => toggleStaff(s.id)} />
                        <span>{s.name}</span>
                      </label>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <Popover open={timePopoverOpen} onOpenChange={setTimePopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="min-w-[200px] justify-start text-left font-normal"
                disabled={!timePickerEnabled}
              >
                <Clock className="mr-2 h-4 w-4" />
                {timePickerEnabled ? `${startTime} – ${endTime}` : "Pick date & location first"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <div className="p-3">
                {!timePickerEnabled ? (
                  <p className="text-sm text-muted-foreground py-4 px-2 text-center max-w-[260px]">
                    {recurring
                      ? "Select a location with opening hours to choose break times."
                      : "Pick a date and location to see available times for that day."}
                  </p>
                ) : (
                  <>
                    <p className="text-sm font-medium text-center mb-3">Break from – to</p>
                    {allowedTimeRange && (
                      <p className="text-xs text-muted-foreground text-center mb-2">
                        Within location hours ({allowedTimeRange.minStart} – {allowedTimeRange.maxEnd}
                        {recurring ? ", any day the salon is open" : " on this day"}).
                      </p>
                    )}
                    <div className="flex gap-6">
                      <div>
                        <p className="text-xs text-muted-foreground mb-2 text-center font-medium">From</p>
                        <div className="grid grid-cols-6 gap-1">
                          {allowedFromSlots.map((t) => (
                            <button
                              key={t}
                              type="button"
                              className={cn(
                                "h-9 min-w-[2.75rem] rounded-md text-xs font-normal transition-colors flex items-center justify-center",
                                startTime === t
                                  ? "bg-primary text-primary-foreground hover:bg-primary"
                                  : "hover:bg-accent hover:text-accent-foreground"
                              )}
                              onClick={() => setStartTime(t)}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-2 text-center font-medium">To</p>
                        <div className="grid grid-cols-6 gap-1">
                          {allowedToSlots.map((t) => (
                            <button
                              key={t}
                              type="button"
                              className={cn(
                                "h-9 min-w-[2.75rem] rounded-md text-xs font-normal transition-colors flex items-center justify-center",
                                endTime === t
                                  ? "bg-primary text-primary-foreground hover:bg-primary"
                                  : "hover:bg-accent hover:text-accent-foreground"
                              )}
                              onClick={() => setEndTime(t)}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </PopoverContent>
          </Popover>

          <Button
            onClick={handleAdd}
            disabled={!canAdd || addBreak.isPending}
            size="sm"
            className="gap-1"
          >
            {addBreak.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Add break
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Pick a location, choose recurring or a single date, set the break window, and either the whole salon or specific staff. Slots in that window are hidden on the booking page when no staff can take the appointment.
        </p>

        {loadingBreaks ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : breakRows.length > 0 ? (
          <ul className="space-y-2">
            {breakRows.map((b) => {
              const locName = locationNameById.get(b.location_id) ?? b.location_id;
              const staffNames =
                b.applies_whole_salon || !b.organization_break_slot_staff?.length
                  ? "Whole salon"
                  : b.organization_break_slot_staff
                      .map((x) => breakStaffNameById[x.staff_id] ?? x.staff_id)
                      .join(", ");
              return (
                <li
                  key={b.id}
                  className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm gap-2"
                >
                  <div>
                    <span className="font-medium">
                      {b.is_recurring ? "Every day" : format(new Date((b.applies_date ?? "") + "T12:00:00"), "EEE, MMM d, yyyy")}
                    </span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {b.start_time.slice(0, 5)}–{b.end_time.slice(0, 5)} · {locName} · {staffNames}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive shrink-0"
                    onClick={() => removeBreak.mutate(b.id)}
                    disabled={removeBreak.isPending}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No break times yet. Add a window above.</p>
        )}
      </CardContent>
    </Card>
  );
}
