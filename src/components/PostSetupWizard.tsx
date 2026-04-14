import { useState, useEffect } from "react";
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
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STEPS = 2;

/**
 * Salonized-style first-run setup: at least one service and one real staff member.
 * Shown only to the organization owner when either is missing.
 */
export function PostSetupWizard() {
  const { organization } = useOrganization();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
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
      if (!organization) return { needs: false, firstLocationId: null as string | null };
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
      const { data: loc } = await supabase
        .from("locations")
        .select("id")
        .eq("organization_id", organization.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      const needs = (serviceCount ?? 0) === 0 || (realStaffCount ?? 0) === 0;
      return {
        needs,
        firstLocationId: loc?.id ?? null,
        serviceCount: serviceCount ?? 0,
        realStaffCount: realStaffCount ?? 0,
      };
    },
    enabled: !!organization && isOwner,
  });

  useEffect(() => {
    if (!setupStatus?.needs) return;
    if (setupStatus.serviceCount > 0 && setupStatus.realStaffCount === 0) {
      setStep(2);
      setEmployeeName((user?.full_name ?? "").split(/\s+/)[0] || "");
    }
  }, [setupStatus?.needs, setupStatus?.serviceCount, setupStatus?.realStaffCount, user?.full_name]);

  const saveService = useMutation({
    mutationFn: async ({ skipStaffStep }: { skipStaffStep: boolean }) => {
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
      return { skipStaffStep };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["post-setup-check"] });
      queryClient.invalidateQueries({ queryKey: ["services"] });
      if (!data.skipStaffStep) {
        setStep(2);
        setEmployeeName((user?.full_name ?? "").split(/\s+/)[0] || "");
      }
    },
    onError: (e: Error) => toast({ title: "Could not save service", description: e.message, variant: "destructive" }),
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
      const locId = setupStatus?.firstLocationId;
      if (locId && row?.id) {
        await supabase.from("staff_locations").insert({ staff_id: row.id, location_id: locId });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["post-setup-check"] });
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["staff-locations"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-overview"] });
      toast({ title: "You're ready to go", description: "Service and team member are set up." });
    },
    onError: (e: Error) => toast({ title: "Could not save team member", description: e.message, variant: "destructive" }),
  });

  if (!isOwner || isLoading || !setupStatus?.needs) return null;

  const progress = `${step}/${STEPS}`;

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-lg"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? "Let's make your first appointment!" : "Who performs the service?"}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Add a service customers can book. You can add more later on the Services page."
              : "Add your first team member (you can invite more from Staff)."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 py-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${(step / STEPS) * 100}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">{progress}</span>
        </div>

        {step === 1 && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              saveService.mutate({ skipStaffStep: (setupStatus?.realStaffCount ?? 0) > 0 });
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
            <div className="flex justify-end gap-2 pt-2">
              <Button type="submit" disabled={saveService.isPending}>
                {saveService.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Next
              </Button>
            </div>
          </form>
        )}

        {step === 2 && (
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
              <Button type="button" variant="ghost" onClick={() => setStep(1)} disabled={saveStaff.isPending}>
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
