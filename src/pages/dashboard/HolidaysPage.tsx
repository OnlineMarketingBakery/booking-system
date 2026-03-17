import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  HOLIDAY_REGION_OPTIONS,
  getHolidayDatesForYears,
  getHolidaysWithNames,
} from "@/lib/holidays";
import { CalendarOff, CalendarDays, Clock, Loader2, Plus, Trash2 } from "lucide-react";
import { format, addDays, differenceInDays, isBefore, startOfDay } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import type { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";

/** 30-minute time slots from 00:00 to 23:30 as "HH:mm". */
const TIME_SLOTS_30 = (() => {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return out;
})();

/** Subtract closure time windows from availability windows; returns list of open intervals. */
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

/** YYYY-MM-DD from to to (inclusive). If from > to, returns []. */
function dateRangeInclusive(fromStr: string, toStr: string): string[] {
  const from = new Date(fromStr + "T12:00:00");
  const to = new Date(toStr + "T12:00:00");
  if (from.getTime() > to.getTime()) return [];
  const days = differenceInDays(to, from) + 1;
  return Array.from({ length: days }, (_, i) =>
    format(addDays(from, i), "yyyy-MM-dd")
  );
}

export default function HolidaysPage() {
  const { organization } = useOrganization();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [region, setRegion] = useState<string>("");
  const [customOffDateRange, setCustomOffDateRange] = useState<DateRange | undefined>(undefined);
  const [customOffCalendarOpen, setCustomOffCalendarOpen] = useState(false);
  const [customOffReason, setCustomOffReason] = useState("");
  const [customOffLocationId, setCustomOffLocationId] = useState<string | "all">("all");
  const [showFiveYears, setShowFiveYears] = useState(false);
  const [closureDate, setClosureDate] = useState<Date | undefined>(undefined);
  const [closureCalendarOpen, setClosureCalendarOpen] = useState(false);
  const [closureLocationId, setClosureLocationId] = useState<string>("");
  const [closureStartTime, setClosureStartTime] = useState("12:00");
  const [closureEndTime, setClosureEndTime] = useState("14:00");
  const [closureTimePopoverOpen, setClosureTimePopoverOpen] = useState(false);
  const [closureReason, setClosureReason] = useState("");

  const orgId = organization?.id ?? "";

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
  const holidayRegion = (organization as { holiday_region?: string } | null)?.holiday_region ?? "NL";
  const effectiveRegion = region || holidayRegion;

  const todayStr = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);

  const years = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const count = showFiveYears ? 5 : 2;
    return Array.from({ length: count }, (_, i) => currentYear + i);
  }, [showFiveYears]);

  const { data: overrides = [], isLoading: loadingOverrides } = useQuery({
    queryKey: ["organization-holiday-overrides", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_holiday_overrides")
        .select("date, is_working_day")
        .eq("organization_id", orgId);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        date: (r.date as string).slice(0, 10),
        is_working_day: r.is_working_day,
      }));
    },
    enabled: !!orgId,
  });

  const { data: offDays = [], isLoading: loadingOffDays } = useQuery({
    queryKey: ["organization-off-days", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_off_days")
        .select("id, date, reason, location_id")
        .eq("organization_id", orgId)
        .order("date", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        date: (r.date as string).slice(0, 10),
        reason: (r as { reason?: string | null }).reason ?? null,
        location_id: (r as { location_id?: string | null }).location_id ?? null,
      }));
    },
    enabled: !!orgId,
  });

  const locationNameById = useMemo(() => {
    const m = new Map<string, string>();
    locations.forEach((loc) => m.set(loc.id, loc.name ?? loc.id));
    return m;
  }, [locations]);

  const closureDayOfWeek = closureDate?.getDay() ?? null;
  const { data: closureLocationAvailability = [] } = useQuery({
    queryKey: ["location-availability", closureLocationId, closureDayOfWeek],
    queryFn: async () => {
      if (!closureLocationId || closureLocationId === "all" || closureDayOfWeek == null) return [];
      const { data, error } = await supabase
        .from("location_availability")
        .select("start_time, end_time")
        .eq("location_id", closureLocationId)
        .eq("day_of_week", closureDayOfWeek)
        .order("start_time");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        start_time: (r.start_time as string).slice(0, 5),
        end_time: (r.end_time as string).slice(0, 5),
      }));
    },
    enabled: !!closureLocationId && closureLocationId !== "all" && closureDayOfWeek != null,
  });

  const { data: allLocationsAvailabilityForDay = [] } = useQuery({
    queryKey: ["location-availability-all", orgId, locations.map((l) => l.id).join(","), closureDayOfWeek],
    queryFn: async () => {
      if (locations.length === 0 || closureDayOfWeek == null) return [];
      const { data, error } = await supabase
        .from("location_availability")
        .select("start_time, end_time")
        .in("location_id", locations.map((l) => l.id))
        .eq("day_of_week", closureDayOfWeek);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        start_time: (r.start_time as string).slice(0, 5),
        end_time: (r.end_time as string).slice(0, 5),
      }));
    },
    enabled: !!orgId && locations.length > 0 && closureDayOfWeek != null,
  });

  const closureAllowedTimeRange = useMemo(() => {
    if (closureLocationId !== "all") {
      if (closureLocationAvailability.length === 0) return null;
      const starts = closureLocationAvailability.map((s) => s.start_time);
      const ends = closureLocationAvailability.map((s) => s.end_time);
      return {
        minStart: starts.reduce((a, b) => (a < b ? a : b)),
        maxEnd: ends.reduce((a, b) => (a > b ? a : b)),
      };
    }
    if (allLocationsAvailabilityForDay.length === 0) return null;
    const starts = allLocationsAvailabilityForDay.map((s) => s.start_time);
    const ends = allLocationsAvailabilityForDay.map((s) => s.end_time);
    return {
      minStart: starts.reduce((a, b) => (a < b ? a : b)),
      maxEnd: ends.reduce((a, b) => (a > b ? a : b)),
    };
  }, [closureLocationId, closureLocationAvailability, allLocationsAvailabilityForDay]);

  const closureTimePickerEnabled =
    !!closureDate && closureLocationId !== "" && !!closureAllowedTimeRange;

  const { data: closureSlots = [], isLoading: loadingClosures, isError: closureSlotsError } = useQuery({
    queryKey: ["location-closure-slots", orgId, todayStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("location_closure_slots")
        .select("id, date, start_time, end_time, reason, location_id")
        .eq("organization_id", orgId)
        .gte("date", todayStr)
        .order("date", { ascending: true })
        .order("start_time", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        date: (r.date as string).slice(0, 10),
        start_time: (r.start_time as string).slice(0, 5),
        end_time: (r.end_time as string).slice(0, 5),
        reason: (r as { reason?: string | null }).reason ?? null,
        location_id: (r as { location_id?: string | null }).location_id ?? null,
      }));
    },
    enabled: !!orgId,
    retry: false,
  });

  const existingClosuresForPicker = useMemo(() => {
    if (!closureDate || !closureLocationId) return [];
    const dateStr = format(closureDate, "yyyy-MM-dd");
    return closureSlots.filter(
      (s) =>
        s.date === dateStr &&
        (closureLocationId === "all" ? s.location_id === null : s.location_id === closureLocationId || s.location_id === null)
    );
  }, [closureDate, closureLocationId, closureSlots]);

  const freeIntervalsForPicker = useMemo(() => {
    if (!closureAllowedTimeRange) return [];
    const openingWindows =
      closureLocationId === "all"
        ? [{ start_time: closureAllowedTimeRange.minStart, end_time: closureAllowedTimeRange.maxEnd }]
        : closureLocationAvailability.length > 0
          ? closureLocationAvailability
          : [{ start_time: closureAllowedTimeRange.minStart, end_time: closureAllowedTimeRange.maxEnd }];
    const existing = existingClosuresForPicker.map((s) => ({
      start_time: s.start_time,
      end_time: s.end_time,
    }));
    return subtractClosureWindows(openingWindows, existing);
  }, [
    closureAllowedTimeRange,
    closureLocationId,
    closureLocationAvailability,
    existingClosuresForPicker,
  ]);

  const allowedFromSlots = useMemo(() => {
    if (!closureDate || !closureAllowedTimeRange) return [];
    if (freeIntervalsForPicker.length === 0) return [];
    return TIME_SLOTS_30.filter((t) =>
      freeIntervalsForPicker.some((int) => t >= int.start_time && t < int.end_time)
    );
  }, [closureDate, closureAllowedTimeRange, freeIntervalsForPicker]);

  const allowedToSlots = useMemo(() => {
    if (!closureDate || !closureAllowedTimeRange) return [];
    if (freeIntervalsForPicker.length === 0) return [];
    const existing = existingClosuresForPicker.map((s) => ({ start_time: s.start_time, end_time: s.end_time }));
    return TIME_SLOTS_30.filter((t) => {
      if (t <= closureStartTime) return false;
      if (!freeIntervalsForPicker.some((int) => t > int.start_time && t <= int.end_time)) return false;
      const overlapsExisting = existing.some((c) => closureStartTime < c.end_time && t > c.start_time);
      return !overlapsExisting;
    });
  }, [
    closureDate,
    closureAllowedTimeRange,
    closureStartTime,
    freeIntervalsForPicker,
    existingClosuresForPicker,
  ]);

  useEffect(() => {
    if (allowedFromSlots.length > 0 && !allowedFromSlots.includes(closureStartTime)) {
      setClosureStartTime(allowedFromSlots[0]);
    }
  }, [allowedFromSlots]);

  useEffect(() => {
    const validTo = allowedToSlots.length > 0 && allowedToSlots.includes(closureEndTime);
    const afterStart = closureEndTime > closureStartTime;
    if (allowedToSlots.length > 0 && (!validTo || !afterStart)) {
      setClosureEndTime(allowedToSlots[0]);
    }
  }, [allowedToSlots, closureStartTime, closureEndTime]);

  const addClosureSlot = useMutation({
    mutationFn: async (payload: {
      date: string;
      start_time: string;
      end_time: string;
      reason?: string;
      locationId: string | null;
    }) => {
      const startTime = payload.start_time.length === 5 ? `${payload.start_time}:00` : payload.start_time;
      const endTime = payload.end_time.length === 5 ? `${payload.end_time}:00` : payload.end_time;
      const { error } = await supabase.from("location_closure_slots").insert({
        organization_id: orgId,
        location_id: payload.locationId,
        date: payload.date,
        start_time: startTime,
        end_time: endTime,
        reason: payload.reason?.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["location-closure-slots"] });
      setClosureDate(undefined);
      setClosureReason("");
      setClosureCalendarOpen(false);
      toast({ title: "Closure hours added" });
    },
    onError: (e) =>
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  const removeClosureSlot = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("location_closure_slots")
        .delete()
        .eq("id", id)
        .eq("organization_id", orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["location-closure-slots"] });
      toast({ title: "Closure hours removed" });
    },
    onError: (e) =>
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  const handleAddClosureSlot = () => {
    if (!closureDate) {
      toast({ title: "Pick a date", variant: "destructive" });
      return;
    }
    if (closureStartTime >= closureEndTime) {
      toast({ title: "End time must be after start time", variant: "destructive" });
      return;
    }
    const dateStr = format(closureDate, "yyyy-MM-dd");
    if (dateStr < todayStr) {
      toast({ title: "Please pick today or a future date", variant: "destructive" });
      return;
    }
    if (closureLocationId !== "all") {
      if (!closureAllowedTimeRange) {
        toast({
          title: "Location closed that day",
          description: "This location has no opening hours on the selected day. Pick another date or location.",
          variant: "destructive",
        });
        return;
      }
      const { minStart, maxEnd } = closureAllowedTimeRange;
      if (closureStartTime < minStart || closureEndTime > maxEnd) {
        toast({
          title: "Outside opening hours",
          description: `Closure must be within this location's hours on that day (${minStart} – ${maxEnd}).`,
          variant: "destructive",
        });
        return;
      }
    }
    if (!closureLocationId) {
      toast({ title: "Select a location", variant: "destructive" });
      return;
    }
    addClosureSlot.mutate({
      date: dateStr,
      start_time: closureStartTime,
      end_time: closureEndTime,
      reason: closureReason || undefined,
      locationId: closureLocationId === "all" ? null : closureLocationId,
    });
  };

  const overrideMap = useMemo(() => {
    const m = new Map<string, boolean>();
    overrides.forEach((o) => m.set(o.date, o.is_working_day));
    return m;
  }, [overrides]);

  const holidayDates = useMemo(
    () => getHolidayDatesForYears(effectiveRegion, years),
    [effectiveRegion, years]
  );

  const holidaysWithNamesRaw = useMemo(
    () => getHolidaysWithNames(effectiveRegion, years),
    [effectiveRegion, years]
  );

  const holidaysWithNames = useMemo(
    () => holidaysWithNamesRaw.filter((h) => h.date >= todayStr),
    [holidaysWithNamesRaw, todayStr]
  );

  const updateHolidayRegion = useMutation({
    mutationFn: async (code: string) => {
      const { error } = await supabase
        .from("organizations")
        .update({ holiday_region: code || null })
        .eq("id", orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization"] });
      toast({ title: "Default region saved" });
    },
    onError: (e) =>
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  const setOverride = useMutation({
    mutationFn: async ({
      date,
      is_working_day,
    }: { date: string; is_working_day: boolean }) => {
      if (is_working_day) {
        const { error } = await supabase.from("organization_holiday_overrides").upsert(
          {
            organization_id: orgId,
            date,
            is_working_day: true,
          },
          { onConflict: "organization_id,date" }
        );
        if (error) throw error;
      } else {
        // Remove override so the date is treated as a public holiday (off) again
        const { error } = await supabase
          .from("organization_holiday_overrides")
          .delete()
          .eq("organization_id", orgId)
          .eq("date", date);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-holiday-overrides"] });
    },
    onError: (e) =>
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  const addOffDays = useMutation({
    mutationFn: async ({
      dates,
      reason,
      locationId,
    }: { dates: string[]; reason?: string; locationId: string | null }) => {
      if (dates.length === 0) return;
      const reasonVal = reason?.trim() || null;
      const rows = dates.map((date) => ({
        organization_id: orgId,
        date,
        reason: reasonVal,
        location_id: locationId,
      }));
      const { error } = await supabase
        .from("organization_off_days")
        .upsert(rows, {
          onConflict: "organization_id,date,location_id",
          ignoreDuplicates: true,
        });
      if (error) throw error;
    },
    onSuccess: (_, { dates }) => {
      queryClient.invalidateQueries({ queryKey: ["organization-off-days"] });
      setCustomOffReason("");
      const n = dates.length;
      toast({
        title: n === 1 ? "Off day added" : `${n} off days added`,
      });
    },
    onError: (e) =>
      toast({
        title: "Error",
        description: (e as Error).message,
        variant: "destructive",
      }),
  });

  const removeOffDay = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("organization_off_days")
        .delete()
        .eq("id", id)
        .eq("organization_id", orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-off-days"] });
      toast({ title: "Off day removed" });
    },
    onError: (e) =>
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  const removeOffDaysRange = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase
        .from("organization_off_days")
        .delete()
        .in("id", ids)
        .eq("organization_id", orgId);
      if (error) throw error;
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ["organization-off-days"] });
      toast({ title: ids.length === 1 ? "Off day removed" : "Off days removed" });
    },
    onError: (e) =>
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  /** Group consecutive off days with same reason and location into ranges for display.
   * Sort by location_id then reason then date. Then merge ranges that are adjacent or have a 1-day gap (e.g. Mar 23–30 and Apr 1–6 → one range). */
  const offDaysRanges = useMemo(() => {
    const sorted = [...offDays].sort((a, b) => {
      const locA = a.location_id ?? "\uFFFF";
      const locB = b.location_id ?? "\uFFFF";
      if (locA !== locB) return locA.localeCompare(locB);
      const reasonA = a.reason ?? "";
      const reasonB = b.reason ?? "";
      if (reasonA !== reasonB) return reasonA.localeCompare(reasonB);
      return a.date.localeCompare(b.date);
    });
    const ranges: { fromDate: string; toDate: string; reason: string | null; location_id: string | null; ids: string[] }[] = [];
    for (const row of sorted) {
      const prev = ranges[ranges.length - 1];
      const nextDay = prev ? format(addDays(new Date(prev.toDate + "T12:00:00"), 1), "yyyy-MM-dd") : null;
      const sameGroup = prev && nextDay === row.date && prev.reason === row.reason && prev.location_id === row.location_id;
      if (sameGroup) {
        prev.toDate = row.date;
        prev.ids.push(row.id);
      } else {
        ranges.push({
          fromDate: row.date,
          toDate: row.date,
          reason: row.reason,
          location_id: row.location_id,
          ids: [row.id],
        });
      }
    }
    // Merge ranges that have same location+reason and are adjacent or 1 day apart (e.g. month boundary)
    const merged: typeof ranges = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      const gapDays = last
        ? differenceInDays(new Date(r.fromDate + "T12:00:00"), new Date(last.toDate + "T12:00:00"))
        : 0;
      const canMerge =
        last &&
        last.reason === r.reason &&
        last.location_id === r.location_id &&
        (gapDays === 1 || gapDays === 0);
      if (canMerge) {
        last.toDate = r.toDate;
        last.ids.push(...r.ids);
      } else {
        merged.push({ ...r, ids: [...r.ids] });
      }
    }
    return merged;
  }, [offDays]);

  const handleAddOffDays = () => {
    const from = customOffDateRange?.from;
    if (!from) {
      toast({ title: "Pick a date or range in the calendar", variant: "destructive" });
      return;
    }
    const to = customOffDateRange?.to ?? from;
    const fromStr = format(from, "yyyy-MM-dd");
    const toStr = format(to, "yyyy-MM-dd");
    const dates = dateRangeInclusive(fromStr, toStr);
    if (dates.length === 0) {
      toast({
        title: "Invalid range",
        description: "End date must be on or after start date.",
        variant: "destructive",
      });
      return;
    }
    const locationId = customOffLocationId === "all" ? null : customOffLocationId;
    addOffDays.mutate(
      { dates, reason: customOffReason, locationId },
      {
        onSuccess: () => {
          setCustomOffDateRange(undefined);
          setCustomOffCalendarOpen(false);
        },
      }
    );
  };

  if (!organization) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-muted-foreground">
        No organization.
      </div>
    );
  }

  const loading = loadingOverrides || loadingOffDays || loadingClosures;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <CalendarOff className="h-6 w-6 text-primary" />
          Holidays & off days
        </h1>
        <p className="text-muted-foreground">
          Public holidays are off by default. Turn a holiday to &quot;Working day&quot; to allow bookings. Add custom off days for any date.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Default holiday region</CardTitle>
          <CardDescription>
            Region used for public holidays when the customer has not chosen one. Customers can change region in the booking widget.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={region || holidayRegion || "NL"}
              onValueChange={(v) => {
                setRegion(v);
                updateHolidayRegion.mutate(v);
              }}
              disabled={updateHolidayRegion.isPending}
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Select region" />
              </SelectTrigger>
              <SelectContent>
                {HOLIDAY_REGION_OPTIONS.map((opt) => (
                  <SelectItem key={opt.code} value={opt.code}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {updateHolidayRegion.isPending && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle>Public holidays ({effectiveRegion})</CardTitle>
              <CardDescription>
                Holidays from today onward. By default these dates are off (no booking). Switch to &quot;Working day&quot; to allow bookings on that date.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Switch
                id="show-five-years"
                checked={showFiveYears}
                onCheckedChange={setShowFiveYears}
              />
              <label htmlFor="show-five-years" className="text-sm font-medium cursor-pointer whitespace-nowrap">
                Show next 5 years
              </label>
            </div>
          </div>
          {/* <p className="text-xs text-muted-foreground">
            Showing holidays from {format(new Date(todayStr + "T12:00:00"), "MMM d, yyyy")} for the next {showFiveYears ? "5" : "2"} years.
          </p> */}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <ul className="space-y-2 max-h-[400px] overflow-y-auto">
              {holidaysWithNames.map(({ date, name }) => {
                const isWorking = overrideMap.get(date) ?? false;
                return (
                  <li
                    key={date}
                    className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                  >
                    <div>
                      <span className="font-medium">{format(new Date(date + "T12:00:00"), "EEE, MMM d, yyyy")}</span>
                      {name && <span className="text-muted-foreground ml-2">— {name}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {isWorking ? "Working" : "Off"}
                      </span>
                      <Switch
                        checked={isWorking}
                        onCheckedChange={(checked) =>
                          setOverride.mutate({ date, is_working_day: checked })
                        }
                        disabled={setOverride.isPending}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {holidaysWithNames.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground py-2">
              No holidays found for this region. Check the region code.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Custom off days</CardTitle>
          <CardDescription>
            Mark any date as off so customers cannot book. Use for closures, events, etc.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Popover open={customOffCalendarOpen} onOpenChange={setCustomOffCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "min-w-[260px] justify-start text-left font-normal",
                      !customOffDateRange?.from && "text-muted-foreground"
                    )}
                  >
                    <CalendarDays className="mr-2 h-4 w-4" />
                    {customOffDateRange?.from ? (
                      customOffDateRange.to && customOffDateRange.to.getTime() !== customOffDateRange.from.getTime() ? (
                        `${format(customOffDateRange.from, "MMM d, yyyy")} – ${format(customOffDateRange.to, "MMM d, yyyy")}`
                      ) : (
                        format(customOffDateRange.from, "MMM d, yyyy")
                      )
                    ) : (
                      "Pick date or range"
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="range"
                    selected={customOffDateRange}
                    onSelect={setCustomOffDateRange}
                    numberOfMonths={2}
                    disabled={(date) => isBefore(startOfDay(date), startOfDay(new Date()))}
                    defaultMonth={customOffDateRange?.from ?? new Date()}
                  />
                </PopoverContent>
              </Popover>
              <div className="flex items-center gap-1.5">
                <label htmlFor="custom-off-location" className="text-xs text-muted-foreground whitespace-nowrap">Apply to</label>
                <Select
                  value={customOffLocationId}
                  onValueChange={(v) => setCustomOffLocationId(v as string | "all")}
                >
                  <SelectTrigger id="custom-off-location" className="w-[180px]">
                    <SelectValue placeholder="Location" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All locations</SelectItem>
                    {locations.map((loc) => (
                      <SelectItem key={loc.id} value={loc.id}>
                        {loc.name ?? loc.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                placeholder="Reason (optional)"
                value={customOffReason}
                onChange={(e) => setCustomOffReason(e.target.value)}
                className="max-w-[240px]"
              />
              <Button
                onClick={handleAddOffDays}
                disabled={!customOffDateRange?.from || addOffDays.isPending}
                size="sm"
                className="gap-1"
              >
                {addOffDays.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Add off days
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Click a date for a single off day, or click a start date then an end date for a range. Choose &quot;All locations&quot; or a specific salon. Add an optional reason so customers see why dates are unavailable.
            </p>
          </div>
          {offDaysRanges.length > 0 ? (
            <ul className="space-y-2">
              {offDaysRanges.map((range) => (
                <li
                  key={range.ids[0]}
                  className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                >
                  <div>
                    {range.fromDate === range.toDate ? (
                      <span>{format(new Date(range.fromDate + "T12:00:00"), "EEE, MMM d, yyyy")}</span>
                    ) : (
                      <span>
                        {format(new Date(range.fromDate + "T12:00:00"), "MMM d, yyyy")}
                        {" – "}
                        {format(new Date(range.toDate + "T12:00:00"), "MMM d, yyyy")}
                      </span>
                    )}
                    <span className="text-muted-foreground ml-2">
                      — {range.location_id ? locationNameById.get(range.location_id) ?? "Location" : "All locations"}
                    </span>
                    {range.reason && <span className="text-muted-foreground ml-2">— {range.reason}</span>}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => removeOffDaysRange.mutate(range.ids)}
                    disabled={removeOffDaysRange.isPending}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No custom off days added.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Closed for specific hours
          </CardTitle>
          <CardDescription>
            Block specific time windows on a date (e.g. 12:00–14:00 for lunch). Customers cannot book during these hours.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <Popover open={closureCalendarOpen} onOpenChange={setClosureCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "min-w-[200px] justify-start text-left font-normal",
                      !closureDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarDays className="mr-2 h-4 w-4" />
                    {closureDate ? format(closureDate, "EEE, MMM d, yyyy") : "Pick date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={closureDate}
                    onSelect={(d) => { setClosureDate(d); setClosureCalendarOpen(false); }}
                    disabled={(date) => isBefore(startOfDay(date), startOfDay(new Date()))}
                    defaultMonth={closureDate ?? new Date()}
                  />
                </PopoverContent>
              </Popover>
              <div className="flex items-center gap-2">
                <Label htmlFor="closure-location" className="text-sm font-medium shrink-0">Apply to</Label>
                <Select value={closureLocationId || "__none__"} onValueChange={(v) => setClosureLocationId(v === "__none__" ? "" : v)}>
                  <SelectTrigger id="closure-location" className="w-[180px]">
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" disabled>
                      Select location
                    </SelectItem>
                    <SelectItem value="all">All locations</SelectItem>
                    {locations.map((loc) => (
                      <SelectItem key={loc.id} value={loc.id}>{loc.name ?? loc.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Popover open={closureTimePopoverOpen} onOpenChange={setClosureTimePopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="min-w-[200px] justify-start text-left font-normal"
                    disabled={!closureTimePickerEnabled}
                  >
                    <Clock className="mr-2 h-4 w-4" />
                    {closureTimePickerEnabled
                      ? `${closureStartTime} – ${closureEndTime}`
                      : "Pick date & location first"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <div className="p-3">
                    {!closureTimePickerEnabled ? (
                      <p className="text-sm text-muted-foreground py-4 px-2 text-center">
                        Pick a date and select a location to see available times for that day.
                      </p>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-center mb-3">Closed from – to</p>
                        {closureAllowedTimeRange && (
                          <p className="text-xs text-muted-foreground text-center mb-2">
                            {closureLocationId === "all"
                              ? `On this day, at least one location is open between ${closureAllowedTimeRange.minStart} – ${closureAllowedTimeRange.maxEnd}. Only these times are shown.`
                              : `${locationNameById.get(closureLocationId) ?? "Location"} is open ${closureAllowedTimeRange.minStart} – ${closureAllowedTimeRange.maxEnd} on this day.`}
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
                                    closureStartTime === t
                                      ? "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                                      : "hover:bg-accent hover:text-accent-foreground"
                                  )}
                                  onClick={() => setClosureStartTime(t)}
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
                                    closureEndTime === t
                                      ? "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                                      : "hover:bg-accent hover:text-accent-foreground"
                                  )}
                                  onClick={() => setClosureEndTime(t)}
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
             
              {/* <Input
                placeholder="Reason (optional)"
                value={closureReason}
                onChange={(e) => setClosureReason(e.target.value)}
                className="max-w-[220px]"
              /> */}
              <Button
                onClick={handleAddClosureSlot}
                disabled={!closureDate || !closureLocationId || !closureTimePickerEnabled || addClosureSlot.isPending}
                size="sm"
                className="gap-1 shrink-0"
              >
                {addClosureSlot.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Add closure
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Pick a date, set the closed time range, and choose which location(s). Slots in this window will be hidden on the booking page.
            </p>
            {closureAllowedTimeRange && closureLocationId !== "all" && (
              <p className="text-xs text-muted-foreground rounded-md bg-muted/60 px-2 py-1.5">
                On this day, {locationNameById.get(closureLocationId) ?? "this location"} is open {closureAllowedTimeRange.minStart} – {closureAllowedTimeRange.maxEnd}. Closure must be within those hours.
              </p>
            )}
          </div>
          {closureSlotsError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Could not load closure hours. Ensure the database migration for &quot;location_closure_slots&quot; has been applied.
            </div>
          )}
          {loadingClosures ? (
            <div className="flex items-center gap-2 text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : closureSlots.length > 0 ? (
            <ul className="space-y-2">
              {closureSlots.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5 text-sm transition-colors hover:bg-muted/50"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-medium">{format(new Date(c.date + "T12:00:00"), "EEE, MMM d, yyyy")}</span>
                    <span className="text-muted-foreground">{c.start_time} – {c.end_time}</span>
                    <span className="text-muted-foreground">
                      · {c.location_id ? locationNameById.get(c.location_id) ?? "Location" : "All locations"}
                    </span>
                    {c.reason && <span className="text-muted-foreground">· {c.reason}</span>}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => removeClosureSlot.mutate(c.id)}
                    disabled={removeClosureSlot.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : !closureSlotsError ? (
            <p className="text-sm text-muted-foreground py-2">No closure hours yet. Add a date and time range above.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
