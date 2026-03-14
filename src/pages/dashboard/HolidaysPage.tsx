import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import { CalendarOff, Loader2, Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

export default function HolidaysPage() {
  const { organization } = useOrganization();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [region, setRegion] = useState<string>("");
  const [customOffDate, setCustomOffDate] = useState("");
  const [customOffReason, setCustomOffReason] = useState("");
  const [showFiveYears, setShowFiveYears] = useState(false);

  const orgId = organization?.id ?? "";
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
        .select("id, date, reason")
        .eq("organization_id", orgId)
        .order("date", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        date: (r.date as string).slice(0, 10),
        reason: (r as { reason?: string | null }).reason ?? null,
      }));
    },
    enabled: !!orgId,
  });

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

  const addOffDay = useMutation({
    mutationFn: async ({ date, reason }: { date: string; reason?: string }) => {
      const { error } = await supabase.from("organization_off_days").insert({
        organization_id: orgId,
        date,
        reason: reason?.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-off-days"] });
      setCustomOffDate("");
      setCustomOffReason("");
      toast({ title: "Off day added" });
    },
    onError: (e) =>
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
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

  const handleAddOffDay = () => {
    if (!customOffDate.trim()) {
      toast({ title: "Pick a date", variant: "destructive" });
      return;
    }
    addOffDay.mutate({ date: customOffDate, reason: customOffReason });
  };

  if (!organization) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-muted-foreground">
        No organization.
      </div>
    );
  }

  const loading = loadingOverrides || loadingOffDays;

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
              <Input
                type="date"
                value={customOffDate}
                onChange={(e) => setCustomOffDate(e.target.value)}
                className="w-[180px]"
              />
              <Input
                placeholder="Reason (optional)"
                value={customOffReason}
                onChange={(e) => setCustomOffReason(e.target.value)}
                className="max-w-[240px]"
              />
              <Button
                onClick={handleAddOffDay}
                disabled={!customOffDate || addOffDay.isPending}
                size="sm"
                className="gap-1"
              >
                {addOffDay.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Add off day
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Add an optional reason so customers see why this date is unavailable when they hover over it.</p>
          </div>
          {offDays.length > 0 ? (
            <ul className="space-y-2">
              {offDays.map(({ id, date, reason }) => (
                <li
                  key={id}
                  className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                >
                  <div>
                    <span>{format(new Date(date + "T12:00:00"), "EEE, MMM d, yyyy")}</span>
                    {reason && <span className="text-muted-foreground ml-2">— {reason}</span>}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => removeOffDay.mutate(id)}
                    disabled={removeOffDay.isPending}
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
    </div>
  );
}
