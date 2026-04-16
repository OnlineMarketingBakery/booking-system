import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, MapPin } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errorMessage";
import {
  LocationHoursForm,
  getEmptySchedule,
  DAYS_LIST,
  type WeekSchedule,
} from "@/components/LocationHoursForm";

type WizardPanel = "location" | "service" | "staff";

function defaultWeekSchedule(): WeekSchedule {
  const s = getEmptySchedule();
  for (let d = 1; d <= 5; d++) {
    s[d] = { enabled: true, slots: [{ start_time: "09:00", end_time: "17:00" }] };
  }
  return s;
}

function validateSchedule(schedule: WeekSchedule): void {
  for (let day = 0; day < 7; day++) {
    if (!schedule[day].enabled) continue;
    for (const slot of schedule[day].slots) {
      if (slot.start_time >= slot.end_time) {
        throw new Error(`${DAYS_LIST[day]}: Start time must be before end time`);
      }
    }
  }
  const anyOpen = Object.values(schedule).some((d) => d.enabled && d.slots.length > 0);
  if (!anyOpen) throw new Error("Turn on at least one day your salon is open.");
}

/**
 * First-run setup: location (hours), service, and one real staff member.
 * Shown only to the organization owner when any of these are missing.
 */
export function PostSetupWizard() {
  const { organization } = useOrganization();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [panelIndex, setPanelIndex] = useState(0);
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [locationPhone, setLocationPhone] = useState("");
  const [locationSchedule, setLocationSchedule] = useState<WeekSchedule>(defaultWeekSchedule);
  const [serviceName, setServiceName] = useState("Haircut");
  const [servicePrice, setServicePrice] = useState("60");
  const [serviceDuration, setServiceDuration] = useState("60");
  const [employeeName, setEmployeeName] = useState("");

  const isOwner =
    !!organization &&
    !!user?.id &&
    (organization as { owner_id?: string }).owner_id === user.id;

  const { data: setupStatus, isLoading } = useQuery({
    queryKey: ["post-setup-check", organization?.id],
    queryFn: async () => {
      if (!organization) {
        return {
          needs: false,
          locationCount: 0,
          serviceCount: 0,
          realStaffCount: 0,
        };
      }
      const { count: locationCount } = await supabase
        .from("locations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organization.id)
        .eq("is_active", true);
      const { count: serviceCount } = await supabase
        .from("services")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organization.id)
        .eq("is_active", true);
      const { count: realStaffCount } = await supabase
        .from("staff")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organization.id)
        .eq("is_active", true)
        .or("is_owner_placeholder.eq.false,is_owner_placeholder.is.null");
      const needs =
        (locationCount ?? 0) === 0 || (serviceCount ?? 0) === 0 || (realStaffCount ?? 0) === 0;
      return {
        needs,
        locationCount: locationCount ?? 0,
        serviceCount: serviceCount ?? 0,
        realStaffCount: realStaffCount ?? 0,
      };
    },
    enabled: !!organization && isOwner,
  });

  const panels = useMemo((): WizardPanel[] => {
    if (!setupStatus?.needs) return [];
    const p: WizardPanel[] = [];
    if (setupStatus.locationCount === 0) p.push("location");
    if (setupStatus.serviceCount === 0) p.push("service");
    if (setupStatus.realStaffCount === 0) p.push("staff");
    return p;
  }, [setupStatus?.needs, setupStatus?.locationCount, setupStatus?.serviceCount, setupStatus?.realStaffCount]);

  const panelKey = `${setupStatus?.locationCount ?? 0}-${setupStatus?.serviceCount ?? 0}-${setupStatus?.realStaffCount ?? 0}`;
  useEffect(() => {
    setPanelIndex(0);
  }, [panelKey]);

  const panel = panels[panelIndex] ?? panels[0];

  useEffect(() => {
    if (panel !== "staff") return;
    setEmployeeName((prev) =>
      prev.trim() ? prev : (user?.full_name ?? "").split(/\s+/)[0] || "",
    );
  }, [panel, user?.full_name]);

  const saveLocation = useMutation({
    mutationFn: async () => {
      if (!organization) throw new Error("No organization");
      const name = locationName.trim();
      if (name.length < 2) throw new Error("Enter a location name");
      validateSchedule(locationSchedule);
      const { data: newLoc, error } = await supabase
        .from("locations")
        .insert({
          name,
          address: locationAddress.trim() || null,
          phone: locationPhone.trim() || null,
          organization_id: organization.id,
        })
        .select("id")
        .single();
      if (error) throw error;
      const inserts: { location_id: string; day_of_week: number; start_time: string; end_time: string }[] = [];
      for (let day = 0; day < 7; day++) {
        if (!locationSchedule[day].enabled) continue;
        for (const slot of locationSchedule[day].slots) {
          inserts.push({
            location_id: newLoc.id,
            day_of_week: day,
            start_time: slot.start_time,
            end_time: slot.end_time,
          });
        }
      }
      if (inserts.length > 0) {
        const { error: insErr } = await supabase.from("location_availability").insert(inserts);
        if (insErr) throw insErr;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["post-setup-check"] });
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      queryClient.invalidateQueries({ queryKey: ["location-availability"] });
      queryClient.invalidateQueries({ queryKey: ["organization-audit-log"] });
      setPanelIndex(0);
    },
    onError: (e: unknown) =>
      toast({
        title: "Could not save location",
        description: getErrorMessage(e, "Could not save location."),
        variant: "destructive",
      }),
  });

  const saveService = useMutation({
    mutationFn: async () => {
      if (!organization) throw new Error("No organization");
      const price = Number.parseFloat(String(servicePrice).replace(",", "."));
      const duration = Number.parseInt(String(serviceDuration), 10);
      if (!serviceName.trim() || serviceName.trim().length < 2) throw new Error("Enter a service name");
      if (!Number.isFinite(price) || price < 0) throw new Error("Enter a valid price");
      if (!Number.isFinite(duration) || duration < 5 || duration > 480) throw new Error("Enter duration 5–480 minutes");
      const { error } = await supabase.from("services").insert({
        organization_id: organization.id,
        name: serviceName.trim(),
        price,
        duration_minutes: duration,
        currency: "eur",
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["post-setup-check"] });
      queryClient.invalidateQueries({ queryKey: ["services"] });
      setPanelIndex(0);
    },
    onError: (e: unknown) =>
      toast({
        title: "Could not save service",
        description: getErrorMessage(e, "Could not save service."),
        variant: "destructive",
      }),
  });

  const saveStaff = useMutation({
    mutationFn: async () => {
      if (!organization) throw new Error("No organization");
      const name = employeeName.trim();
      if (name.length < 2) throw new Error("Enter the team member name");
      const { data: row, error } = await supabase
        .from("staff")
        .insert({
          organization_id: organization.id,
          name,
          is_active: true,
          is_owner_placeholder: false,
        })
        .select("id")
        .single();
      if (error) throw error;
      const { data: loc } = await supabase
        .from("locations")
        .select("id")
        .eq("organization_id", organization.id)
        .eq("is_active", true)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (loc?.id && row?.id) {
        await supabase.from("staff_locations").insert({ staff_id: row.id, location_id: loc.id });
      }
      const defId = (organization as { owner_default_staff_id?: string | null }).owner_default_staff_id;
      if (row?.id) {
        if (!defId) {
          await supabase.from("organizations").update({ owner_default_staff_id: row.id }).eq("id", organization.id);
        } else {
          const { data: cur } = await supabase.from("staff").select("is_owner_placeholder").eq("id", defId).maybeSingle();
          if (cur?.is_owner_placeholder) {
            await supabase.from("organizations").update({ owner_default_staff_id: row.id }).eq("id", organization.id);
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["post-setup-check"] });
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["staff-locations"] });
      queryClient.invalidateQueries({ queryKey: ["organization"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-overview"] });
      toast({
        title: "You're ready to go",
        description: "Location, service, and team member are set up.",
      });
    },
    onError: (e: unknown) =>
      toast({
        title: "Could not save team member",
        description: getErrorMessage(e, "Could not save team member."),
        variant: "destructive",
      }),
  });

  if (!isOwner || isLoading || !setupStatus?.needs || panels.length === 0) return null;

  const progress = `${panelIndex + 1}/${panels.length}`;
  const scheduleUpdater = (updater: (prev: WeekSchedule) => WeekSchedule) => {
    setLocationSchedule((prev) => updater(prev));
  };

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-lg max-h-[90vh] overflow-y-auto"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {panel === "location" && (
              <span className="flex items-center gap-2">
                <MapPin className="h-5 w-5 shrink-0 text-primary" />
                Where do customers visit?
              </span>
            )}
            {panel === "service" && "Let's make your first appointment!"}
            {panel === "staff" && "Who performs the service?"}
          </DialogTitle>
          <DialogDescription>
            {panel === "location" &&
              "Add your salon location and opening hours. You can edit details later on the Locations page."}
            {panel === "service" && "Add a service customers can book. You can add more later on the Services page."}
            {panel === "staff" && "Add your first team member (you can invite more from Staff)."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 py-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${((panelIndex + 1) / panels.length) * 100}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">{progress}</span>
        </div>

        {panel === "location" && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              saveLocation.mutate();
            }}
          >
            <div className="space-y-2">
              <Label>Location name *</Label>
              <Input
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                required
                minLength={2}
                maxLength={100}
                placeholder="e.g. Main salon"
              />
            </div>
            <div className="space-y-2">
              <Label>Address (optional)</Label>
              <Input
                value={locationAddress}
                onChange={(e) => setLocationAddress(e.target.value)}
                maxLength={500}
                placeholder="Street, city"
              />
            </div>
            <div className="space-y-2">
              <Label>Phone (optional)</Label>
              <Input
                value={locationPhone}
                onChange={(e) => setLocationPhone(e.target.value)}
                maxLength={20}
                pattern="[\+\d\s\-\(\)]*"
                title="Enter a valid phone number"
                placeholder="+31 6 12345678"
              />
            </div>
            <div className="space-y-2">
              <Label>Opening hours *</Label>
              <LocationHoursForm schedule={locationSchedule} onScheduleChange={scheduleUpdater} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="submit" disabled={saveLocation.isPending}>
                {saveLocation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Next
              </Button>
            </div>
          </form>
        )}

        {panel === "service" && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              saveService.mutate();
            }}
          >
            <div className="space-y-2">
              <Label>Service name *</Label>
              <Input value={serviceName} onChange={(e) => setServiceName(e.target.value)} required minLength={2} maxLength={100} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Price (€)</Label>
                <Input value={servicePrice} onChange={(e) => setServicePrice(e.target.value)} inputMode="decimal" required />
              </div>
              <div className="space-y-2">
                <Label>Duration (minutes) *</Label>
                <Input value={serviceDuration} onChange={(e) => setServiceDuration(e.target.value)} inputMode="numeric" required />
              </div>
            </div>
            <div className="flex justify-between gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setPanelIndex((i) => Math.max(0, i - 1))} disabled={saveService.isPending || panelIndex === 0}>
                Back
              </Button>
              <Button type="submit" disabled={saveService.isPending}>
                {saveService.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Next
              </Button>
            </div>
          </form>
        )}

        {panel === "staff" && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              saveStaff.mutate();
            }}
          >
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input value={employeeName} onChange={(e) => setEmployeeName(e.target.value)} required minLength={2} maxLength={100} />
            </div>
            <div className="flex justify-between gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setPanelIndex((i) => Math.max(0, i - 1))} disabled={saveStaff.isPending || panelIndex === 0}>
                Back
              </Button>
              <Button type="submit" disabled={saveStaff.isPending}>
                {saveStaff.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Done
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
