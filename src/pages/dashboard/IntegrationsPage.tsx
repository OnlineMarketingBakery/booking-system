import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Calendar, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const ORG_TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "Europe/Amsterdam", label: "Amsterdam (CET/CEST)" },
  { value: "Europe/Brussels", label: "Brussels" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Paris", label: "Paris" },
  { value: "Europe/Berlin", label: "Berlin" },
  { value: "UTC", label: "UTC" },
];

type GcalListItem = {
  id: string;
  summary: string;
  accessRole: string;
  primary?: boolean;
  writable: boolean;
};

type StaffGcalRow = {
  id: string;
  name: string;
  gcal_secondary_calendar_id: string | null;
};

const DISABLED = "__disabled__";
const CREATE = "__create__";

export default function IntegrationsPage() {
  const { organization } = useOrganization();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: calData, isLoading: calLoading, refetch: refetchCalendars } = useQuery({
    queryKey: ["gcal-calendar-list", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("list-google-calendars", {
        body: { organization_id: organization!.id },
      });
      if (error) throw error;
      return data as { connected?: boolean; calendars?: GcalListItem[]; error?: string };
    },
    enabled: !!organization,
  });

  const { data: staffRows = [], isLoading: staffLoading } = useQuery({
    queryKey: ["staff", organization?.id, "integrations-gcal"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff")
        .select("id, name, gcal_secondary_calendar_id, is_owner_placeholder")
        .eq("organization_id", organization!.id)
        .eq("is_active", true)
        .order("created_at");
      if (error) throw error;
      return (data ?? []).filter((s) => !(s as { is_owner_placeholder?: boolean }).is_owner_placeholder) as StaffGcalRow[];
    },
    enabled: !!organization,
  });

  const calendars = calData?.calendars ?? [];
  const writableCalendars = calendars.filter((c) => c.writable);
  const readOnlyCount = calendars.length - writableCalendars.length;
  const connected = !!calData?.connected;

  const updateStaffCalendar = useMutation({
    mutationFn: async ({ staffId, calendarId }: { staffId: string; calendarId: string | null }) => {
      const { error } = await supabase
        .from("staff")
        .update({ gcal_secondary_calendar_id: calendarId })
        .eq("id", staffId)
        .eq("organization_id", organization!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      toast({ title: "Calendar updated" });
    },
    onError: (err: unknown) =>
      toast({
        title: "Could not save",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      }),
  });

  const createStaffCalendar = useMutation({
    mutationFn: async (staffId: string) => {
      const { data, error } = await supabase.functions.invoke("ensure-staff-gcal-calendars", {
        body: { organization_id: organization!.id, staff_id: staffId },
      });
      if (error) throw error;
      return data as { created?: number; skipped?: number; error?: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      refetchCalendars();
      toast({
        title: "Google Calendar",
        description: `Created ${data?.created ?? 0} calendar(s).`,
      });
    },
    onError: (err: unknown) =>
      toast({
        title: "Could not create calendar",
        description: err instanceof Error ? err.message : "Connect Google on the owner account first.",
        variant: "destructive",
      }),
  });

  const bulkCreate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("ensure-staff-gcal-calendars", {
        body: { organization_id: organization!.id },
      });
      if (error) throw error;
      return data as { created?: number };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      refetchCalendars();
      toast({ title: "Calendars", description: `Created ${data?.created ?? 0} calendar(s).` });
    },
    onError: (err: unknown) =>
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Could not create calendars",
        variant: "destructive",
      }),
  });

  if (!organization) {
    return <p className="text-sm text-muted-foreground">No organization selected.</p>;
  }

  const perStaff = !!(organization as { gcal_use_staff_secondary_calendars?: boolean }).gcal_use_staff_secondary_calendars;

  const selectValueForStaff = (s: StaffGcalRow) => {
    if (!s.gcal_secondary_calendar_id) return DISABLED;
    return s.gcal_secondary_calendar_id;
  };

  const onStaffSelect = (staffId: string, value: string) => {
    if (value === CREATE) {
      createStaffCalendar.mutate(staffId);
      return;
    }
    if (value === DISABLED) {
      updateStaffCalendar.mutate({ staffId, calendarId: null });
      return;
    }
    updateStaffCalendar.mutate({ staffId, calendarId: value });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Integrations</h2>
        <p className="text-sm text-muted-foreground">Google Calendar export and salon time zone.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-5 w-5 text-primary" />
            Salon time zone
          </CardTitle>
          <CardDescription>
            Used for confirmation emails, the dashboard calendar, and Google Calendar event times.
          </CardDescription>
        </CardHeader>
        <CardContent className="max-w-md space-y-2">
          <Label>Time zone</Label>
          <Select
            value={(organization as { timezone?: string }).timezone ?? "Europe/Amsterdam"}
            onValueChange={async (v) => {
              const { error } = await supabase.from("organizations").update({ timezone: v }).eq("id", organization.id);
              if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
              else {
                queryClient.invalidateQueries({ queryKey: ["organization"] });
                toast({ title: "Time zone updated" });
              }
            }}
          >
            <SelectTrigger className="bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ORG_TIMEZONE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Google Calendar — export</CardTitle>
          <CardDescription>
            Bookings update Google Calendar only (editing Google does not change appointments in Salonora).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!connected && !calLoading ? (
            <Alert>
              <AlertTitle>Google not connected</AlertTitle>
              <AlertDescription>
                Connect Google Calendar from your owner account (same flow as calendar busy times) to list calendars and
                sync bookings.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-3">
            <Label className="text-sm font-medium">Synchronization mode</Label>
            <RadioGroup
              value={perStaff ? "per_staff" : "single"}
              onValueChange={async (v) => {
                const usePerStaff = v === "per_staff";
                const { error } = await supabase
                  .from("organizations")
                  .update({ gcal_use_staff_secondary_calendars: usePerStaff })
                  .eq("id", organization.id);
                if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
                else {
                  queryClient.invalidateQueries({ queryKey: ["organization"] });
                  toast({ title: "Preference saved" });
                }
              }}
              className="grid gap-3"
            >
              <div className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/30">
                <RadioGroupItem value="single" id="gcal-single" className="mt-1" />
                <div className="min-w-0">
                  <Label htmlFor="gcal-single" className="cursor-pointer font-medium">
                    All appointments in one Google Calendar
                  </Label>
                  <p className="text-muted-foreground mt-1 text-xs">Uses your primary calendar for busy blocking and events.</p>
                </div>
              </div>
              <div className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/30">
                <RadioGroupItem value="per_staff" id="gcal-per" className="mt-1" />
                <div className="min-w-0">
                  <Label htmlFor="gcal-per" className="cursor-pointer font-medium">
                    Separate Google Calendar per staff member
                  </Label>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Pick an existing calendar or create &quot;Salonora — [name]&quot; for each employee.
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>

          {perStaff ? (
            <div className="space-y-4 border-t pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Label className="text-sm font-medium">Staff → target calendar</Label>
                  <p className="text-muted-foreground text-xs mt-1">Only calendars you can write to appear in the list.</p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!connected || bulkCreate.isPending}
                  onClick={() => bulkCreate.mutate()}
                >
                  {bulkCreate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create missing calendars
                </Button>
              </div>

              {readOnlyCount > 0 ? (
                <Alert className="border-blue-200 bg-blue-50/80 text-blue-950 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
                  <AlertDescription className="text-sm">
                    {readOnlyCount} calendar{readOnlyCount === 1 ? "" : "s"} can&apos;t be selected because they are not writable
                    by you.
                  </AlertDescription>
                </Alert>
              ) : null}

              {staffLoading || calLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : staffRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Add staff on the Staff page to assign calendars.</p>
              ) : (
                <ul className="space-y-3">
                  {staffRows.map((s) => {
                    const initials = s.name
                      .split(/\s+/)
                      .map((p) => p[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase();
                    const creatingThis =
                      createStaffCalendar.isPending && createStaffCalendar.variables === s.id;
                    const busy = updateStaffCalendar.isPending || creatingThis;
                    const current = selectValueForStaff(s);
                    const hasMatchingWritable =
                      !!s.gcal_secondary_calendar_id &&
                      writableCalendars.some((c) => c.id === s.gcal_secondary_calendar_id);
                    const showCurrentReadonly =
                      !!s.gcal_secondary_calendar_id && connected && !hasMatchingWritable;

                    return (
                      <li
                        key={s.id}
                        className="flex flex-col gap-2 rounded-lg border bg-background/50 p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar className="h-9 w-9 shrink-0">
                            <AvatarFallback className="text-xs">{initials || "?"}</AvatarFallback>
                          </Avatar>
                          <span className="truncate font-medium">{s.name}</span>
                        </div>
                        <div className="w-full min-w-0 sm:max-w-md">
                          <Select
                            value={current}
                            disabled={!connected || busy}
                            onValueChange={(v) => onStaffSelect(s.id, v)}
                          >
                            <SelectTrigger className="bg-background">
                              <SelectValue placeholder="Choose calendar" />
                            </SelectTrigger>
                            <SelectContent position="popper" className="max-h-[min(320px,70vh)]">
                              <SelectItem value={DISABLED}>— Disabled —</SelectItem>
                              <SelectItem value={CREATE}>Create new: Salonora — {s.name}</SelectItem>
                              {writableCalendars.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.summary}
                                  {c.primary ? " (primary)" : ""}
                                </SelectItem>
                              ))}
                              {showCurrentReadonly ? (
                                <SelectItem value={s.gcal_secondary_calendar_id!} disabled>
                                  Current (read-only in list)…
                                </SelectItem>
                              ) : null}
                            </SelectContent>
                          </Select>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
