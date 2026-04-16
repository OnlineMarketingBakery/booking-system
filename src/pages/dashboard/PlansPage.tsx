import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { usePlanDefinitions } from "@/hooks/usePlanDefinitions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { displayNameForTier, maxLocationsForTier, type OrgTier } from "@/lib/tierLimits";
import { Check } from "lucide-react";

const TIERS: OrgTier[] = ["tier_1", "tier_2", "tier_3"];

function featureBullets(features: unknown): string[] {
  if (!features || typeof features !== "object" || Array.isArray(features)) return [];
  return Object.entries(features as Record<string, unknown>)
    .filter(([, v]) => Boolean(v))
    .map(([k]) => k.replace(/_/g, " "));
}

export default function PlansPage() {
  const { organization } = useOrganization();
  const tier = ((organization as { tier?: OrgTier } | null)?.tier ?? "tier_1") as OrgTier;
  const { data: planDefinitions = [] } = usePlanDefinitions();

  const { data: locationCount = 0 } = useQuery({
    queryKey: ["plans-location-count", organization?.id],
    queryFn: async () => {
      if (!organization) return 0;
      const { count, error } = await supabase
        .from("locations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organization.id)
        .eq("is_active", true);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!organization,
  });

  const maxLoc = maxLocationsForTier(tier, planDefinitions);
  const compareTiers: OrgTier[] =
    planDefinitions.length > 0 ? (planDefinitions.map((p) => p.tier as OrgTier) as OrgTier[]) : TIERS;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Plan & limits</h1>
        <p className="text-muted-foreground text-sm">
          Your subscription tier controls how many active locations you can run. Staff, services, and the booking widget are not limited by tier in this version.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Current plan</CardTitle>
          <CardDescription>
            You are on <strong>{displayNameForTier(tier, planDefinitions)}</strong> with{" "}
            <strong>
              {locationCount} / {maxLoc}
            </strong>{" "}
            active locations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Need more locations or a different plan? Contact us and we will adjust your account. Super admins can change tier from the admin panel.
          </p>
          <p>
            <Link to="/dashboard/settings/audit" className="text-primary underline-offset-4 hover:underline">
              View recent plan & location activity
            </Link>{" "}
            (audit log).
          </p>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Compare tiers</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {compareTiers.map((t) => {
            const limit = maxLocationsForTier(t, planDefinitions);
            const active = t === tier;
            const def = planDefinitions.find((p) => p.tier === t);
            const extras = featureBullets(def?.features);
            return (
              <Card key={t} className={active ? "border-primary ring-1 ring-primary/20" : ""}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">{displayNameForTier(t, planDefinitions)}</CardTitle>
                    {active ? <Badge>Current</Badge> : null}
                  </div>
                  <CardDescription>
                    Up to <strong>{limit}</strong> active location{limit === 1 ? "" : "s"}
                    {def?.description ? ` — ${def.description}` : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-1">
                  <div className="flex items-center gap-2">
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                    Booking widget
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                    Staff & calendar
                  </div>
                  {extras.map((label) => (
                    <div key={label} className="flex items-center gap-2 capitalize">
                      <Check className="h-4 w-4 shrink-0 text-primary" />
                      {label}
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
